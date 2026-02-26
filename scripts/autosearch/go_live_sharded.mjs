import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import os from "node:os"
import { spawn, spawnSync } from "node:child_process"

import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"
import { evaluateWorst2wDistribution } from "./worst2w_distribution.mjs"

const rootDir = process.cwd()

const toNumber = (value, fallback) => {
  const parsed = parseNumberArg(value)
  return parsed ?? fallback
}

const clampInt = (value, fallback, min, max) => {
  const n = toNumber(value, null)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const TRACKS = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]

const parseBooleanFlag = (value, fallback) => {
  if (value === null || value === undefined) return fallback
  const token = String(value).trim().toLowerCase()
  if (!token) return fallback
  return (
    token === "1" ||
    token === "true" ||
    token === "yes" ||
    token === "on" ||
    token === "y"
  )
}

const parseEncodedJsonMapArg = (rawValue) => {
  const raw = String(rawValue ?? "").trim()
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw)
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

const normalizeTrackIntMap = ({ source, defaults, min = 0, max = 10_000 }) => {
  const out = {}
  for (const track of TRACKS) {
    const fallback = Number(defaults?.[track] ?? 0) || 0
    const value = source && typeof source === "object" ? source[track] : null
    out[track] = clampInt(value, fallback, min, max)
  }
  return out
}

const normalizeTrackQuotaMap = ({ source, defaults }) => {
  const out = {}
  for (const track of TRACKS) {
    const fallback = defaults?.[track] ?? { chart: 0.5, rule: 0.5 }
    const raw = source && typeof source === "object" ? source[track] : null
    const rawChart = Number(raw?.chart)
    const rawRule = Number(raw?.rule)
    const chart = Number.isFinite(rawChart)
      ? Math.max(0, Math.min(1, rawChart))
      : Number(fallback?.chart ?? 0.5)
    const rule = Number.isFinite(rawRule)
      ? Math.max(0, Math.min(1, rawRule))
      : Number(fallback?.rule ?? 0.5)
    const sum = chart + rule
    if (!Number.isFinite(sum) || sum <= 0) {
      out[track] = { chart: 0.5, rule: 0.5 }
    } else {
      out[track] = { chart: chart / sum, rule: rule / sum }
    }
  }
  return out
}

const normalizeChampionDiscoveryBudgetSplit = ({
  source,
  defaults = { champion: 0.4, discovery: 0.6 },
}) => {
  const fallbackChampion = Number(defaults?.champion)
  const fallbackDiscovery = Number(defaults?.discovery)
  const rawChampion = Number(
    source && typeof source === "object" ? source.champion : Number.NaN,
  )
  const rawDiscovery = Number(
    source && typeof source === "object" ? source.discovery : Number.NaN,
  )
  const champion = Number.isFinite(rawChampion)
    ? Math.max(0, Math.min(1, rawChampion))
    : Number.isFinite(fallbackChampion)
      ? Math.max(0, Math.min(1, fallbackChampion))
      : 0.4
  const discovery = Number.isFinite(rawDiscovery)
    ? Math.max(0, Math.min(1, rawDiscovery))
    : Number.isFinite(fallbackDiscovery)
      ? Math.max(0, Math.min(1, fallbackDiscovery))
      : 0.6
  const sum = champion + discovery
  if (!Number.isFinite(sum) || sum <= 0) {
    return { champion: 0.4, discovery: 0.6 }
  }
  return {
    champion: champion / sum,
    discovery: discovery / sum,
  }
}

const decodePolicyKey = (raw, fallback) => {
  const token = String(raw ?? fallback)
    .trim()
    .toUpperCase()
  return token || fallback
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => getArgValue(args, key)
  const dryRunOnly =
    hasFlag(args, "--dryRunOnly") || toNumber(getValue("--dryRunOnly"), 0) === 1
  const stage1Only =
    hasFlag(args, "--stage1Only") || toNumber(getValue("--stage1Only"), 0) === 1
  const applyFlag = hasFlag(args, "--apply")
  const applyRaw = getValue("--apply")
  const applyRequested =
    applyFlag || (applyRaw !== null ? toNumber(applyRaw, 0) === 1 : false)
  const apply = !dryRunOnly && !stage1Only && applyRequested
  const batchIdRaw = String(getValue("--batchId") ?? "").trim()
  const batchId = batchIdRaw
    ? batchIdRaw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96)
    : null
  const prefilterEnabled =
    hasFlag(args, "--prefilter") || toNumber(getValue("--prefilter"), 0) === 1
  const rescueEnabledRaw = getValue("--rescueEnabled")
  const rescueEnabledToken = String(rescueEnabledRaw ?? "")
    .trim()
    .toLowerCase()
  const rescueEnabled =
    rescueEnabledRaw === null
      ? true
      : rescueEnabledToken === "1" ||
        rescueEnabledToken === "true" ||
        rescueEnabledToken === "yes" ||
        rescueEnabledToken === "on" ||
        rescueEnabledToken === "y"
  const rescueEarlyExitEnabledRaw = getValue("--rescueEarlyExitEnabled")
  const rescueEarlyExitEnabledToken = String(rescueEarlyExitEnabledRaw ?? "")
    .trim()
    .toLowerCase()
  const rescueEarlyExitEnabled =
    rescueEarlyExitEnabledRaw === null
      ? true
      : rescueEarlyExitEnabledToken === "1" ||
        rescueEarlyExitEnabledToken === "true" ||
        rescueEarlyExitEnabledToken === "yes" ||
        rescueEarlyExitEnabledToken === "on" ||
        rescueEarlyExitEnabledToken === "y"
  const rescueDeepAllowMoonshotDominantRaw = getValue(
    "--rescueDeepAllowMoonshotDominant",
  )
  const rescueDeepAllowMoonshotDominantToken = String(
    rescueDeepAllowMoonshotDominantRaw ?? "",
  )
    .trim()
    .toLowerCase()
  const rescueDeepAllowMoonshotDominant =
    rescueDeepAllowMoonshotDominantRaw === null
      ? false
      : rescueDeepAllowMoonshotDominantToken === "1" ||
        rescueDeepAllowMoonshotDominantToken === "true" ||
        rescueDeepAllowMoonshotDominantToken === "yes" ||
        rescueDeepAllowMoonshotDominantToken === "on" ||
        rescueDeepAllowMoonshotDominantToken === "y"
  const allowStage2OnLowQualityRequiredRaw = getValue(
    "--allowStage2OnLowQualityRequired",
  )
  const allowStage2OnLowQualityRequiredToken = String(
    allowStage2OnLowQualityRequiredRaw ?? "",
  )
    .trim()
    .toLowerCase()
  const allowStage2OnLowQualityRequired =
    allowStage2OnLowQualityRequiredRaw === null
      ? false
      : allowStage2OnLowQualityRequiredToken === "1" ||
        allowStage2OnLowQualityRequiredToken === "true" ||
        allowStage2OnLowQualityRequiredToken === "yes" ||
        allowStage2OnLowQualityRequiredToken === "on" ||
        allowStage2OnLowQualityRequiredToken === "y"
  const moonshotTrackRequiredForCorePassRaw = getValue(
    "--moonshotTrackRequiredForCorePass",
  )
  const moonshotTrackRequiredForCorePassToken = String(
    moonshotTrackRequiredForCorePassRaw ?? "",
  )
    .trim()
    .toLowerCase()
  const moonshotTrackRequiredForCorePass =
    moonshotTrackRequiredForCorePassRaw === null
      ? false
      : moonshotTrackRequiredForCorePassToken === "1" ||
        moonshotTrackRequiredForCorePassToken === "true" ||
        moonshotTrackRequiredForCorePassToken === "yes" ||
        moonshotTrackRequiredForCorePassToken === "on" ||
        moonshotTrackRequiredForCorePassToken === "y"
  const policyConflictResolution = decodePolicyKey(
    getValue("--policyConflictResolution"),
    "POOLSET_FIRST_STRICT",
  )
  const executionLaneRaw = String(getValue("--executionLane") ?? "server")
    .trim()
    .toLowerCase()
  const executionLane =
    executionLaneRaw === "codex_cloud" ? "codex_cloud" : "server"
  const isCodexCloudLane = executionLane === "codex_cloud"
  const laneMaxInt = isCodexCloudLane ? Number.MAX_SAFE_INTEGER : null
  const poolsetBatchCap = isCodexCloudLane ? laneMaxInt : 32
  const poolsetConcurrentCap = isCodexCloudLane ? laneMaxInt : 2
  const poolsetCountCap = isCodexCloudLane ? laneMaxInt : 32
  const poolsetCountMaxCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetSizeCap = isCodexCloudLane ? laneMaxInt : 64
  const stage2TopKCap = isCodexCloudLane ? laneMaxInt : 32
  const dailyPoolsetCountCap = isCodexCloudLane ? laneMaxInt : 32
  const dailyRecombineRoundsCap = isCodexCloudLane ? laneMaxInt : 5
  const shardCap = isCodexCloudLane ? laneMaxInt : 32
  const topPerTrackCap = isCodexCloudLane ? laneMaxInt : 200
  const maxParallelShardsCap = isCodexCloudLane ? laneMaxInt : 16
  const poolsetEnabled = parseBooleanFlag(getValue("--poolsetEnabled"), true)
  const poolsetBatchSize = clampInt(
    getValue("--poolsetBatchSize"),
    2,
    1,
    poolsetBatchCap,
  )
  const poolsetMaxConcurrentEval = clampInt(
    getValue("--poolsetMaxConcurrentEval"),
    1,
    1,
    poolsetConcurrentCap,
  )
  const poolsetCountByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetCountByTrack")),
    defaults: {
      SURGE_EOD: 6,
      GAP_15_BET: 4,
      MOONSHOT: 4,
    },
    min: 1,
    max: poolsetCountCap,
  })
  const poolsetCountMaxByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetCountMaxByTrack")),
    defaults: {
      SURGE_EOD: 12,
      GAP_15_BET: 8,
      MOONSHOT: 8,
    },
    min: 1,
    max: poolsetCountMaxCap,
  })
  const poolsetActiveSizeByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetActiveSizeByTrack")),
    defaults: {
      SURGE_EOD: 5,
      GAP_15_BET: 3,
      MOONSHOT: 2,
    },
    min: 1,
    max: poolsetSizeCap,
  })
  const poolsetBenchSizeByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetBenchSizeByTrack")),
    defaults: {
      SURGE_EOD: 7,
      GAP_15_BET: 5,
      MOONSHOT: 4,
    },
    min: 0,
    max: poolsetSizeCap,
  })
  const poolsetMinAliveByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetMinAliveByTrack")),
    defaults: {
      SURGE_EOD: 2,
      GAP_15_BET: 2,
      MOONSHOT: 1,
    },
    min: 1,
    max: poolsetSizeCap,
  })
  const poolsetRefillCountByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--poolsetRefillCountByTrack")),
    defaults: {
      SURGE_EOD: 2,
      GAP_15_BET: 2,
      MOONSHOT: 1,
    },
    min: 1,
    max: poolsetSizeCap,
  })
  const stage2TopKByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--stage2TopKByTrack")),
    defaults: {
      SURGE_EOD: 4,
      GAP_15_BET: 3,
      MOONSHOT: 2,
    },
    min: 1,
    max: stage2TopKCap,
  })
  const poolEngineQuotaByTrack = normalizeTrackQuotaMap({
    source: parseEncodedJsonMapArg(getValue("--poolEngineQuotaByTrack")),
    defaults: {
      SURGE_EOD: { chart: 0.6, rule: 0.4 },
      GAP_15_BET: { chart: 0.4, rule: 0.6 },
      MOONSHOT: { chart: 0.5, rule: 0.5 },
    },
  })
  const poolsetStage1WindowMonths = clampInt(
    getValue("--poolsetStage1WindowMonths"),
    4,
    1,
    24,
  )
  const poolsetStage2WindowMonths = clampInt(
    getValue("--poolsetStage2WindowMonths"),
    4,
    1,
    24,
  )
  const poolsetEvalMode = String(
    getValue("--poolsetEvalMode") ?? "daily_router_8m",
  )
    .trim()
    .toLowerCase()
  const dailyPassAvengersEnabled = parseBooleanFlag(
    getValue("--dailyPassAvengersEnabled"),
    true,
  )
  const dailyPassTopNByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--dailyPassTopNByTrack")),
    defaults: {
      SURGE_EOD: 48,
      GAP_15_BET: 32,
      MOONSHOT: 24,
    },
    min: 1,
    max: 5000,
  })
  const dailyPassPoolsetCountByTrack = normalizeTrackIntMap({
    source: parseEncodedJsonMapArg(getValue("--dailyPassPoolsetCountByTrack")),
    defaults: {
      SURGE_EOD: 2,
      GAP_15_BET: 2,
      MOONSHOT: 1,
    },
    min: 1,
    max: dailyPoolsetCountCap,
  })
  const dailyPassRecombineRounds = clampInt(
    getValue("--dailyPassRecombineRounds"),
    2,
    1,
    dailyRecombineRoundsCap,
  )
  const stage2ResultCacheEnabled = parseBooleanFlag(
    getValue("--stage2ResultCacheEnabled"),
    true,
  )
  const stage2ResultCacheTtlSec = clampInt(
    getValue("--stage2ResultCacheTtlSec"),
    86400,
    60,
    30 * 24 * 60 * 60,
  )
  const stage2SkipDuplicatePoolSetSignature = parseBooleanFlag(
    getValue("--stage2SkipDuplicatePoolSetSignature"),
    true,
  )
  const stage2ScheduleMode = String(
    getValue("--stage2ScheduleMode") ?? "champion_first",
  )
    .trim()
    .toLowerCase()
  const stage2ContinueAfterFirstPass = parseBooleanFlag(
    getValue("--stage2ContinueAfterFirstPass"),
    true,
  )
  const championDiscoveryBudgetSplit = normalizeChampionDiscoveryBudgetSplit({
    source: parseEncodedJsonMapArg(getValue("--championDiscoveryBudgetSplit")),
    defaults: {
      champion: 0.4,
      discovery: 0.6,
    },
  })
  return {
    policyConflictResolution,
    asOfInput: String(getValue("--asof") ?? "2026-02-13").trim(),
    tracks: String(getValue("--tracks") ?? "SURGE_EOD,GAP_15_BET,MOONSHOT")
      .trim()
      .toUpperCase(),
    passMode: String(getValue("--passMode") ?? "all")
      .trim()
      .toLowerCase(),
    moonshotTrackRequiredForCorePass,
    allowStage2OnLowQualityRequired,
    targetPct: clampInt(getValue("--targetPct"), 5, 1, 50),
    minWorst2wAvgPct: toNumber(getValue("--minWorst2wAvgPct"), -1.5),
    highWeekPct: Math.max(
      0,
      Math.min(100, Number(toNumber(getValue("--highWeekPct"), 10) ?? 10)),
    ),
    minHighWeeks: clampInt(getValue("--minHighWeeks"), 0, 0, 53),
    nearHighWeeks: clampInt(getValue("--nearHighWeeks"), 0, 0, 53),
    minOtherWeekPct: Math.max(
      0,
      Math.min(
        200,
        Number(toNumber(getValue("--minOtherWeekPct"), 0.01) ?? 0.01),
      ),
    ),
    requireCompletedTradesEveryWeek: clampInt(
      getValue("--requireCompletedTradesEveryWeek"),
      1,
      1,
      20,
    ),
    stage1MaxRounds: clampInt(getValue("--stage1MaxRounds"), 60, 1, 5000),
    stage2MaxRounds: clampInt(getValue("--stage2MaxRounds"), 160, 1, 5000),
    stage1PlateauRounds: clampInt(
      getValue("--stage1PlateauRounds"),
      80,
      5,
      5000,
    ),
    stage2PlateauRounds: clampInt(
      getValue("--stage2PlateauRounds"),
      240,
      5,
      5000,
    ),
    shards: clampInt(getValue("--shards"), 4, 1, shardCap),
    topPerTrack: clampInt(getValue("--topPerTrack"), 24, 1, topPerTrackCap),
    seedStart: clampInt(getValue("--seedStart"), 1, 1, 1_000_000_000),
    symbolSeedBase: String(getValue("--symbolSeedBase") ?? "1").trim(),
    symbolBucketTotal: clampInt(getValue("--symbolBucketTotal"), 1, 1, 1024),
    symbolBucketIndex: clampInt(getValue("--symbolBucketIndex"), 0, 0, 1023),
    printEvery: clampInt(getValue("--printEvery"), 20, 1, 1_000_000),
    maxParallelShards: clampInt(
      getValue("--maxParallelShards"),
      2,
      1,
      maxParallelShardsCap,
    ),
    minFreeMbForParallel: clampInt(
      getValue("--minFreeMbForParallel"),
      2200,
      512,
      65536,
    ),
    prefilterEnabled,
    prefilterWorst2wFloor: toNumber(getValue("--prefilterWorst2wFloor"), -10),
    prefilterStopLikeCeil: Math.max(
      0.01,
      Math.min(
        1,
        Number(toNumber(getValue("--prefilterStopLikeCeil"), 0.9) ?? 0.9),
      ),
    ),
    prefilterNoFillCeil: Math.max(
      0.01,
      Math.min(
        1,
        Number(toNumber(getValue("--prefilterNoFillCeil"), 0.95) ?? 0.95),
      ),
    ),
    minPoolPerTrackSurge: clampInt(
      getValue("--minPoolPerTrackSurge"),
      6,
      0,
      5000,
    ),
    minPoolPerTrackGap: clampInt(getValue("--minPoolPerTrackGap"), 8, 0, 5000),
    minWorst2wPassPerTrackSurge: clampInt(
      getValue("--minWorst2wPassPerTrackSurge"),
      2,
      0,
      5000,
    ),
    minWorst2wPassPerTrackGap: clampInt(
      getValue("--minWorst2wPassPerTrackGap"),
      2,
      0,
      5000,
    ),
    rescueEnabled,
    rescueTopK: clampInt(getValue("--rescueTopK"), 20, 1, 5000),
    rescueCheapB: clampInt(getValue("--rescueCheapB"), 300, 20, 20000),
    rescueCheapM: clampInt(getValue("--rescueCheapM"), 50, 1, 512),
    rescueDeepTopK: clampInt(getValue("--rescueDeepTopK"), 12, 1, 5000),
    rescueDeepB: clampInt(getValue("--rescueDeepB"), 600, 20, 50000),
    rescueDeepM: clampInt(getValue("--rescueDeepM"), 80, 1, 2048),
    rescueLogEvery: clampInt(getValue("--rescueLogEvery"), 5, 1, 500),
    rescueAlpha: Math.max(
      1e-6,
      Math.min(0.5, Number(toNumber(getValue("--rescueAlpha"), 0.05) ?? 0.05)),
    ),
    rescueP0: Math.max(
      0.5,
      Math.min(0.9999, Number(toNumber(getValue("--rescueP0"), 0.95) ?? 0.95)),
    ),
    rescueLcbQuantile: Math.max(
      0.01,
      Math.min(
        0.5,
        Number(toNumber(getValue("--rescueLcbQuantile"), 0.1) ?? 0.1),
      ),
    ),
    rescueEarlyExitEnabled,
    rescueEarlyExitNoPassMinEval: clampInt(
      getValue("--rescueEarlyExitNoPassMinEval"),
      12,
      1,
      5000,
    ),
    rescueEarlyExitNoPassMaxEval: clampInt(
      getValue("--rescueEarlyExitNoPassMaxEval"),
      64,
      1,
      5000,
    ),
    rescueEarlyExitMinEvalRatio: Math.max(
      0,
      Math.min(
        1,
        Number(
          toNumber(getValue("--rescueEarlyExitMinEvalRatio"), 0.25) ?? 0.25,
        ),
      ),
    ),
    rescueEarlyExitTerminalReasonRatio: Math.max(
      0.5,
      Math.min(
        1,
        Number(
          toNumber(getValue("--rescueEarlyExitTerminalReasonRatio"), 0.85) ??
            0.85,
        ),
      ),
    ),
    rescueDeepAllowMoonshotDominant,
    poolsetEnabled,
    poolsetBatchSize,
    poolsetMaxConcurrentEval,
    poolsetStage1WindowMonths,
    poolsetStage2WindowMonths,
    poolsetEvalMode,
    poolsetCountByTrack,
    poolsetCountMaxByTrack,
    poolsetActiveSizeByTrack,
    poolsetBenchSizeByTrack,
    poolsetMinAliveByTrack,
    poolsetRefillCountByTrack,
    stage2TopKByTrack,
    poolEngineQuotaByTrack,
    dailyPassAvengersEnabled,
    dailyPassTopNByTrack,
    dailyPassPoolsetCountByTrack,
    dailyPassRecombineRounds,
    stage2ResultCacheEnabled,
    stage2ResultCacheTtlSec,
    stage2SkipDuplicatePoolSetSignature,
    stage2ScheduleMode:
      stage2ScheduleMode === "champion_first" ? "champion_first" : "fifo",
    stage2ContinueAfterFirstPass,
    championDiscoveryBudgetSplit,
    executionLane,
    excludeFingerprintsPath: String(
      getValue("--excludeFingerprintsPath") ?? "",
    ).trim(),
    apply,
    stage1Only,
    batchId,
  }
}

const createBatchId = () => {
  const ts = Date.now().toString(36)
  const rand = crypto.randomBytes(3).toString("hex")
  return `golive_sharded_${ts}_${rand}`
}

const parseTracks = (raw) =>
  raw
    .split(",")
    .map((item) =>
      String(item ?? "")
        .trim()
        .toUpperCase(),
    )
    .filter((item) => TRACKS.includes(item))

const runChild = (scriptArgs) => {
  const result = spawnSync("node", scriptArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `child failed (${result.status}): node ${scriptArgs.join(" ")}`,
    )
  }
}

const runChildAsync = (scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn("node", scriptArgs, {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`child failed (${code}): node ${scriptArgs.join(" ")}`))
    })
  })

const resolveStage1Parallel = ({ args }) => {
  const minFreeMbForParallel = Math.max(
    512,
    Number(args?.minFreeMbForParallel ?? 2200) || 2200,
  )
  const freeMb = Math.floor((Number(os.freemem?.() ?? 0) || 0) / 1024 / 1024)
  if (freeMb < minFreeMbForParallel) {
    return 1
  }
  return Math.max(
    1,
    Math.min(
      Number(args?.maxParallelShards ?? 1) || 1,
      Number(args?.shards ?? 1) || 1,
    ),
  )
}

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const resolveMaybeAbsolutePath = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw)
}

const readNdjson = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return []
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\n+/)
  const rows = []
  for (const line of lines) {
    const value = String(line ?? "").trim()
    if (!value) continue
    try {
      rows.push(JSON.parse(value))
    } catch {
      // ignore malformed line
    }
  }
  return rows
}

const toFinite = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const incrementMapCounter = (map, key, amount = 1) => {
  if (!map || !key) return
  const prev = Number(map.get(key) ?? 0) || 0
  map.set(key, prev + Math.max(1, Number(amount) || 1))
}

const summarizeMapCounter = (counter) => {
  const entries = Array.from(counter?.entries?.() ?? [])
    .map(([reason, count]) => ({
      reason: String(reason ?? ""),
      count: Number(count ?? 0) || 0,
    }))
    .filter((row) => row.reason && row.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  return {
    totalKinds: entries.length,
    totalCount: entries.reduce((acc, row) => acc + row.count, 0),
    top: entries,
  }
}

const summarizeCounterByTrackReason = (counter) => {
  const grouped = new Map()
  for (const [key, rawCount] of counter?.entries?.() ?? []) {
    const count = Number(rawCount ?? 0) || 0
    if (count <= 0) continue
    const value = String(key ?? "")
    const sep = value.indexOf(":")
    const track =
      (sep >= 0 ? value.slice(0, sep) : "UNKNOWN").trim() || "UNKNOWN"
    const reason = (sep >= 0 ? value.slice(sep + 1) : value).trim() || "UNKNOWN"
    const list = grouped.get(track) ?? []
    list.push({ reason, count })
    grouped.set(track, list)
  }
  const sortedTracks = Array.from(grouped.keys()).sort((a, b) =>
    a.localeCompare(b),
  )
  return Object.fromEntries(
    sortedTracks.map((track) => [
      track,
      (grouped.get(track) ?? []).sort(
        (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
      ),
    ]),
  )
}

const canonicalizeJson = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(
    entries.map(([key, item]) => [key, canonicalizeJson(item)]),
  )
}

const stableStringify = (value) => JSON.stringify(canonicalizeJson(value))

const buildCandidateFingerprint = (row) => {
  const track = String(row?.track ?? "")
    .trim()
    .toUpperCase()
  if (!track || !row?.policyChoice || !row?.patternChoice) {
    return null
  }
  const digest = crypto
    .createHash("sha1")
    .update(
      stableStringify({
        track,
        policyChoice: row.policyChoice,
        patternChoice: row.patternChoice,
      }),
    )
    .digest("hex")
  return `fp_${digest.slice(0, 16)}`
}

const loadExcludedFingerprints = (filePathInput) => {
  const filePath = resolveMaybeAbsolutePath(filePathInput)
  if (!filePath || !fs.existsSync(filePath)) {
    return new Set()
  }
  const payload = readJsonSafe(filePath)
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.fingerprints)
      ? payload.fingerprints
      : []
  const set = new Set()
  for (const row of rows) {
    const value = String(row ?? "").trim()
    if (value) {
      set.add(value)
    }
  }
  return set
}

const evaluatePrefilter = ({ metrics, args }) => {
  if (!args.prefilterEnabled) {
    return { drop: false, reason: null }
  }
  const worst2wAvgPct = Number(metrics?.worst2wAvgPct ?? Number.NaN)
  if (
    Number.isFinite(worst2wAvgPct) &&
    worst2wAvgPct < Number(args.prefilterWorst2wFloor ?? -10)
  ) {
    return { drop: true, reason: "WORST2W_PREFILTER" }
  }
  const stopLikePct = Number(metrics?.stopLikePct ?? Number.NaN)
  if (
    Number.isFinite(stopLikePct) &&
    stopLikePct > Number(args.prefilterStopLikeCeil ?? 0.9)
  ) {
    return { drop: true, reason: "STOPLIKE_PREFILTER" }
  }
  const noFillRate = Number(metrics?.noFillRate ?? Number.NaN)
  if (
    Number.isFinite(noFillRate) &&
    noFillRate > Number(args.prefilterNoFillCeil ?? 0.95)
  ) {
    return { drop: true, reason: "NOFILL_PREFILTER" }
  }
  return { drop: false, reason: null }
}

const toBucketLabel = (value, boundaries) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return "na"
  for (const boundary of boundaries) {
    if (number <= boundary) return `le${boundary}`
  }
  return `gt${boundaries[boundaries.length - 1]}`
}

const buildDiversityKey = (row) => {
  const metrics = row?.metrics ?? {}
  return [
    toBucketLabel(metrics.completedTrades, [12, 24, 40, 60, 90]),
    toBucketLabel(metrics.countWeeksGE, [1, 3, 6, 9, 12]),
    toBucketLabel(metrics.minWeeklyPct, [-12, -8, -4, -2, 0, 2]),
    toBucketLabel(metrics.worst2wAvgPct, [-10, -6, -3, -1.5, 0]),
    toBucketLabel(metrics.stopLikePct, [0.1, 0.2, 0.35, 0.5, 0.7]),
    toBucketLabel(metrics.noFillRate, [0.05, 0.12, 0.2, 0.3, 0.45]),
  ].join("|")
}

const pickDiverseRows = ({ rows, topPerTrack }) => {
  const byDiversity = new Map()
  for (const row of rows) {
    const key = buildDiversityKey(row)
    const list = byDiversity.get(key) ?? []
    list.push(row)
    byDiversity.set(key, list)
  }
  const queue = Array.from(byDiversity.entries())
  queue.sort((a, b) => {
    const aTop = a[1]?.[0]
    const bTop = b[1]?.[0]
    return compareCandidateRows(aTop, bTop)
  })
  const selected = []
  let progressed = true
  while (selected.length < topPerTrack && progressed) {
    progressed = false
    for (const [, list] of queue) {
      if (!list.length || selected.length >= topPerTrack) continue
      selected.push(list.shift())
      progressed = true
    }
  }
  return {
    selected,
    diversityGroups: byDiversity.size,
  }
}

const compareCandidateRows = (a, b) => {
  const aPass = a?.pass === true
  const bPass = b?.pass === true
  if (aPass !== bPass) return aPass ? -1 : 1

  const aWorst2wGate = a?.metrics?.worst2wGatePass === true
  const bWorst2wGate = b?.metrics?.worst2wGatePass === true
  if (aWorst2wGate !== bWorst2wGate) return aWorst2wGate ? -1 : 1

  const aWorst2wRescue =
    a?.metrics?.worst2wRescuePass === true ||
    a?.metrics?.worst2wRescuePassDeep === true
  const bWorst2wRescue =
    b?.metrics?.worst2wRescuePass === true ||
    b?.metrics?.worst2wRescuePassDeep === true
  if (aWorst2wRescue !== bWorst2wRescue) return aWorst2wRescue ? -1 : 1

  const aMoonshotGate = a?.metrics?.moonshotGatePass === true
  const bMoonshotGate = b?.metrics?.moonshotGatePass === true
  if (aMoonshotGate !== bMoonshotGate) return aMoonshotGate ? -1 : 1

  const aTradeGate = a?.metrics?.tradeGatePass === true
  const bTradeGate = b?.metrics?.tradeGatePass === true
  if (aTradeGate !== bTradeGate) return aTradeGate ? -1 : 1

  const aWorst2w = toFinite(a?.metrics?.worst2wAvgPct, -1e9)
  const bWorst2w = toFinite(b?.metrics?.worst2wAvgPct, -1e9)
  if (bWorst2w !== aWorst2w) return bWorst2w - aWorst2w

  const aMin = toFinite(a?.metrics?.minWeeklyPct, -1e9)
  const bMin = toFinite(b?.metrics?.minWeeklyPct, -1e9)
  if (bMin !== aMin) return bMin - aMin

  const aStopLike = toFinite(a?.metrics?.stopLikePct, 1)
  const bStopLike = toFinite(b?.metrics?.stopLikePct, 1)
  if (aStopLike !== bStopLike) return aStopLike - bStopLike

  const aNoFill = toFinite(a?.metrics?.noFillRate, 1)
  const bNoFill = toFinite(b?.metrics?.noFillRate, 1)
  if (aNoFill !== bNoFill) return aNoFill - bNoFill

  const aTrades = toFinite(a?.metrics?.completedTrades, 0)
  const bTrades = toFinite(b?.metrics?.completedTrades, 0)
  if (bTrades !== aTrades) return bTrades - aTrades

  const aCountGE = toFinite(a?.metrics?.countWeeksGE, -1e9)
  const bCountGE = toFinite(b?.metrics?.countWeeksGE, -1e9)
  if (bCountGE !== aCountGE) return bCountGE - aCountGE

  const aSum = toFinite(a?.metrics?.totalWeeklySumPct, -1e9)
  const bSum = toFinite(b?.metrics?.totalWeeklySumPct, -1e9)
  if (bSum !== aSum) return bSum - aSum

  return 0
}

const pickRoundRobinRows = ({ rows, count, offset = 0 }) => {
  const list = Array.isArray(rows) ? rows : []
  const targetCount = Math.max(0, Number(count ?? 0) || 0)
  if (!list.length || targetCount <= 0) return []
  const picked = []
  const seen = new Set()
  let cursor = ((Math.floor(offset) % list.length) + list.length) % list.length
  while (picked.length < targetCount && seen.size < list.length) {
    const row = list[cursor]
    if (row && !seen.has(cursor)) {
      picked.push(row)
      seen.add(cursor)
    }
    cursor = (cursor + 1) % list.length
  }
  return picked
}

const computePoolSetCount = ({ tracks, args }) => {
  const configured = tracks.map(
    (track) => Number(args.poolsetCountByTrack?.[track] ?? 1) || 1,
  )
  const capped = tracks.map((track, index) =>
    Math.min(
      configured[index],
      Number(args.poolsetCountMaxByTrack?.[track] ?? configured[index]) ||
        configured[index],
    ),
  )
  return Math.max(1, ...capped)
}

const normalizeEngineType = (value) => {
  const token = String(value ?? "")
    .trim()
    .toLowerCase()
  return token === "chart" ? "chart" : "rule"
}

const resolveCandidateEngineType = (row) =>
  normalizeEngineType(
    row?.engineType ??
      row?.patternChoice?.engineType ??
      row?.policyChoice?.engineType,
  )

const poolDedupKey = (row) =>
  stableStringify({
    track: String(row?.track ?? "")
      .trim()
      .toUpperCase(),
    engineType: resolveCandidateEngineType(row),
    fingerprint: String(row?.fingerprint ?? "").trim() || null,
    policyChoice: row?.policyChoice ?? null,
    patternChoice: row?.patternChoice ?? null,
  })

const poolEntryKey = (row) =>
  stableStringify({
    track: String(row?.track ?? "")
      .trim()
      .toUpperCase(),
    engineType: normalizeEngineType(row?.engineType),
    version: Number(row?.version ?? 0) || 0,
    versionLabel: String(row?.versionLabel ?? "").trim() || null,
    fingerprint: String(row?.fingerprint ?? "").trim() || null,
    sourceRunId: String(row?.sourceRunId ?? row?.runId ?? "").trim() || null,
    sourceRound: Number(row?.sourceRound ?? 0) || 0,
  })

const dedupeRows = (rows) => {
  const out = []
  const seen = new Set()
  for (const row of rows ?? []) {
    const key = poolEntryKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

const computeDailyPassScore = (row) => {
  const metrics = row?.metrics ?? {}
  const passWeeks = Math.max(0, toFinite(metrics.countWeeksGE, 0))
  const worst2wAvgPct = toFinite(metrics.worst2wAvgPct, -1e9)
  const minWeeklyPct = toFinite(metrics.minWeeklyPct, -1e9)
  const completedTrades = Math.max(0, toFinite(metrics.completedTrades, 0))
  const noFillRate = Math.max(0, toFinite(metrics.noFillRate, 1))
  const worst2wGateBonus = metrics.worst2wGatePass === true ? 3 : 0
  const rescueBonus =
    metrics.worst2wRescuePass === true || metrics.worst2wRescuePassDeep === true
      ? 2
      : 0
  const tradeGateBonus = metrics.tradeGatePass === true ? 1 : 0
  return (
    passWeeks * 5 +
    worst2wGateBonus +
    rescueBonus +
    tradeGateBonus +
    worst2wAvgPct * 0.1 +
    minWeeklyPct * 0.05 +
    completedTrades * 0.02 -
    noFillRate * 2
  )
}

const computeDailyPassCompositeScore = (rows) => {
  const list = Array.isArray(rows) ? rows : []
  if (list.length <= 0) return 0
  const sum = list.reduce((acc, row) => acc + computeDailyPassScore(row), 0)
  return sum / list.length
}

const compareDailyPassRows = (a, b) => {
  const aScore = computeDailyPassScore(a)
  const bScore = computeDailyPassScore(b)
  if (bScore !== aScore) return bScore - aScore
  return compareCandidateRows(a, b)
}

const buildDailyPassRankedRowsByTrack = ({ tracks, poolEntries, args }) => {
  const byTrack = new Map(tracks.map((track) => [track, []]))
  for (const row of poolEntries ?? []) {
    const track = String(row?.track ?? "")
      .trim()
      .toUpperCase()
    if (!byTrack.has(track)) continue
    byTrack.get(track).push(row)
  }
  const ranked = new Map()
  for (const track of tracks) {
    const deduped = dedupeRows(byTrack.get(track) ?? [])
    deduped.sort(compareDailyPassRows)
    const topN = Math.max(
      1,
      Number(args?.dailyPassTopNByTrack?.[track] ?? deduped.length) ||
        deduped.length,
    )
    const selected = deduped.slice(0, topN).map((row, index) => ({
      ...row,
      dailyPassScore: computeDailyPassScore(row),
      dailyPassRank: index + 1,
    }))
    ranked.set(track, selected)
  }
  return ranked
}

const resolveTrackQuota = ({ args, track }) => {
  const raw = args?.poolEngineQuotaByTrack?.[track]
  const chart = Number(raw?.chart)
  const rule = Number(raw?.rule)
  const chartSafe = Number.isFinite(chart) ? Math.max(0, chart) : 0.5
  const ruleSafe = Number.isFinite(rule) ? Math.max(0, rule) : 0.5
  const sum = chartSafe + ruleSafe
  if (!Number.isFinite(sum) || sum <= 0) {
    return { chart: 0.5, rule: 0.5 }
  }
  return {
    chart: chartSafe / sum,
    rule: ruleSafe / sum,
  }
}

const summarizeEngineQuotaCoverage = ({ poolEntries, tracks, args }) => {
  const engineAvailabilityByTrack = {}
  const engineQuotaViolationByTrack = {}
  for (const track of tracks ?? []) {
    const rows = (poolEntries ?? []).filter(
      (row) =>
        String(row?.track ?? "")
          .trim()
          .toUpperCase() === track,
    )
    const chartCount = rows.filter(
      (row) => normalizeEngineType(row?.engineType) === "chart",
    ).length
    const ruleCount = rows.filter(
      (row) => normalizeEngineType(row?.engineType) === "rule",
    ).length
    const quota = resolveTrackQuota({ args, track })
    const violationCodes = []
    if (rows.length > 0 && quota.chart > 0 && chartCount <= 0) {
      violationCodes.push("CHART_QUOTA_UNMET")
    }
    if (rows.length > 0 && quota.rule > 0 && ruleCount <= 0) {
      violationCodes.push("RULE_QUOTA_UNMET")
    }
    engineAvailabilityByTrack[track] = {
      total: rows.length,
      chart: chartCount,
      rule: ruleCount,
      quota,
    }
    engineQuotaViolationByTrack[track] = violationCodes
  }
  return { engineAvailabilityByTrack, engineQuotaViolationByTrack }
}

const selectTrackRowsForPoolSet = ({ rows, targetCount, offset, quota }) => {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length || targetCount <= 0) {
    return { selected: [], engineMix: { chart: 0, rule: 0 } }
  }
  const chartRows = list.filter(
    (row) => normalizeEngineType(row?.engineType) === "chart",
  )
  const ruleRows = list.filter(
    (row) => normalizeEngineType(row?.engineType) === "rule",
  )
  const targetChart = Math.max(
    0,
    Math.min(
      targetCount,
      Math.round(targetCount * Number(quota?.chart ?? 0.5)),
    ),
  )
  const targetRule = Math.max(0, targetCount - targetChart)
  const chartPicked = pickRoundRobinRows({
    rows: chartRows,
    count: Math.min(targetChart, chartRows.length),
    offset,
  })
  const rulePicked = pickRoundRobinRows({
    rows: ruleRows,
    count: Math.min(targetRule, ruleRows.length),
    offset,
  })
  const selected = []
  const seen = new Set()
  let chartIdx = 0
  let ruleIdx = 0
  while (
    selected.length < targetCount &&
    (chartIdx < chartPicked.length || ruleIdx < rulePicked.length)
  ) {
    if (chartIdx < chartPicked.length) {
      const row = chartPicked[chartIdx]
      chartIdx += 1
      const key = poolEntryKey(row)
      if (!seen.has(key)) {
        seen.add(key)
        selected.push(row)
      }
    }
    if (selected.length >= targetCount) break
    if (ruleIdx < rulePicked.length) {
      const row = rulePicked[ruleIdx]
      ruleIdx += 1
      const key = poolEntryKey(row)
      if (!seen.has(key)) {
        seen.add(key)
        selected.push(row)
      }
    }
  }
  if (selected.length < targetCount) {
    const fallback = pickRoundRobinRows({
      rows: list,
      count: targetCount * 2,
      offset,
    })
    for (const row of fallback) {
      if (selected.length >= targetCount) break
      const key = poolEntryKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      selected.push(row)
    }
  }
  const engineMix = selected.reduce(
    (acc, row) => {
      const engine = normalizeEngineType(row?.engineType)
      acc[engine] += 1
      return acc
    },
    { chart: 0, rule: 0 },
  )
  return { selected, engineMix }
}

const summarizeMemberOrigins = (entries = []) => {
  const counter = new Map()
  for (const row of Array.isArray(entries) ? entries : []) {
    const runId = String(row?.sourceRunId ?? "").trim() || "unknown-run"
    const round = Number(row?.sourceRound ?? 0) || 0
    const key = `${runId}#${round}`
    counter.set(key, (counter.get(key) ?? 0) + 1)
  }
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([origin, count]) => ({ origin, count }))
}

const computeDailyPassPoolSetCount = ({ tracks, args }) => {
  const configured = tracks.map(
    (track) => Number(args.dailyPassPoolsetCountByTrack?.[track] ?? 1) || 1,
  )
  const capped = tracks.map((track, index) =>
    Math.min(
      configured[index],
      Number(args.poolsetCountMaxByTrack?.[track] ?? configured[index]) ||
        configured[index],
    ),
  )
  return Math.max(1, ...capped)
}

const buildDailyPassPoolSets = ({
  batchId,
  tracks,
  requiredTracks,
  poolEntries,
  args,
}) => {
  const rankedByTrack = buildDailyPassRankedRowsByTrack({
    tracks,
    poolEntries,
    args,
  })
  const poolSetCount = computeDailyPassPoolSetCount({ tracks, args })
  const poolSets = []
  for (let setIndex = 0; setIndex < poolSetCount; setIndex += 1) {
    const poolSetId = `${batchId}:POOLSET:DP01:${String(setIndex + 1).padStart(2, "0")}`
    const entries = []
    const countByTrack = {}
    const engineMixByTrack = {}
    for (const track of tracks) {
      const rows = rankedByTrack.get(track) ?? []
      const activeSize = Math.max(
        1,
        Number(args.poolsetActiveSizeByTrack?.[track] ?? 1) || 1,
      )
      const benchSize = Math.max(
        0,
        Number(args.poolsetBenchSizeByTrack?.[track] ?? 0) || 0,
      )
      const stage2TopK = Math.max(
        1,
        Number(args.stage2TopKByTrack?.[track] ?? activeSize) || activeSize,
      )
      const targetCount = Math.max(stage2TopK, activeSize + benchSize)
      const quota = resolveTrackQuota({ args, track })
      const { selected, engineMix } = selectTrackRowsForPoolSet({
        rows,
        targetCount,
        offset: setIndex * targetCount,
        quota,
      })
      countByTrack[track] = selected.length
      engineMixByTrack[track] = engineMix
      entries.push(...selected)
    }
    const missingRequiredTracks = requiredTracks.filter(
      (track) => Number(countByTrack[track] ?? 0) <= 0,
    )
    if (!entries.length) continue
    poolSets.push({
      poolSetId,
      entries,
      countByTrack,
      engineMixByTrack,
      missingRequiredTracks,
      valid: missingRequiredTracks.length <= 0,
      source: "DAILY_PASS_AVENGERS",
      parentPoolSetIds: [],
      memberOrigins: summarizeMemberOrigins(entries),
    })
  }
  const validSets = poolSets.filter(
    (row) => row.valid && Array.isArray(row.entries) && row.entries.length > 0,
  )
  if (validSets.length > 0) {
    return validSets
  }
  return poolSets.filter(
    (row) => Array.isArray(row.entries) && row.entries.length > 0,
  )
}

const buildPoolSets = ({
  batchId,
  tracks,
  requiredTracks,
  poolEntries,
  args,
}) => {
  const byTrack = new Map(tracks.map((track) => [track, []]))
  for (const row of poolEntries ?? []) {
    const track = String(row?.track ?? "")
      .trim()
      .toUpperCase()
    if (!byTrack.has(track)) continue
    byTrack.get(track).push(row)
  }
  for (const track of tracks) {
    const rows = dedupeRows(byTrack.get(track) ?? [])
    rows.sort(compareCandidateRows)
    byTrack.set(track, rows)
  }
  const poolSetCount = computePoolSetCount({ tracks, args })
  const poolSets = []
  for (let setIndex = 0; setIndex < poolSetCount; setIndex += 1) {
    const poolSetId = `${batchId}:POOLSET:${String(setIndex + 1).padStart(2, "0")}`
    const entries = []
    const countByTrack = {}
    const engineMixByTrack = {}
    for (const track of tracks) {
      const rows = byTrack.get(track) ?? []
      const activeSize = Math.max(
        1,
        Number(args.poolsetActiveSizeByTrack?.[track] ?? 1) || 1,
      )
      const benchSize = Math.max(
        0,
        Number(args.poolsetBenchSizeByTrack?.[track] ?? 0) || 0,
      )
      const stage2TopK = Math.max(
        1,
        Number(args.stage2TopKByTrack?.[track] ?? activeSize) || activeSize,
      )
      const targetCount = Math.max(stage2TopK, activeSize + benchSize)
      const quota = resolveTrackQuota({ args, track })
      const { selected, engineMix } = selectTrackRowsForPoolSet({
        rows,
        targetCount,
        offset: setIndex * targetCount,
        quota,
      })
      countByTrack[track] = selected.length
      engineMixByTrack[track] = engineMix
      for (const row of selected) {
        entries.push(row)
      }
    }
    const missingRequiredTracks = requiredTracks.filter(
      (track) => Number(countByTrack[track] ?? 0) <= 0,
    )
    poolSets.push({
      poolSetId,
      entries,
      countByTrack,
      engineMixByTrack,
      missingRequiredTracks,
      valid: missingRequiredTracks.length <= 0,
      source: "DISCOVERY_BASE",
      parentPoolSetIds: [],
      memberOrigins: summarizeMemberOrigins(entries),
    })
  }
  const validSets = poolSets.filter(
    (row) => row.valid && row.entries.length > 0,
  )
  if (validSets.length > 0) {
    return validSets
  }
  return poolSets.filter((row) => row.entries.length > 0)
}

const buildRecombinedPoolSets = ({
  batchId,
  tracks,
  requiredTracks,
  args,
  evaluatedPoolSetsById,
  stage2PoolResults,
  recombineRound = 1,
}) => {
  const topResults = (Array.isArray(stage2PoolResults) ? stage2PoolResults : [])
    .slice()
    .sort(comparePoolSetResults)
    .slice(0, 3)
  const parentPoolSetIds = topResults
    .map((row) => String(row?.poolSetId ?? "").trim())
    .filter(Boolean)
  if (topResults.length < 2) {
    return []
  }
  const byTrack = new Map(tracks.map((track) => [track, []]))
  for (const result of topResults) {
    const baseSet = evaluatedPoolSetsById.get(String(result?.poolSetId ?? ""))
    if (!baseSet) continue
    for (const row of baseSet.entries ?? []) {
      const track = String(row?.track ?? "")
        .trim()
        .toUpperCase()
      if (!byTrack.has(track)) continue
      byTrack.get(track).push(row)
    }
  }
  for (const track of tracks) {
    const deduped = dedupeRows(byTrack.get(track) ?? [])
    deduped.sort(compareCandidateRows)
    byTrack.set(track, deduped)
  }

  const recombined = []
  const recombineCountCap =
    args.executionLane === "codex_cloud" ? Number.MAX_SAFE_INTEGER : 3
  const recombineCount = Math.max(
    1,
    Math.min(recombineCountCap, Number(args.poolsetBatchSize ?? 2) || 2),
  )
  for (let setIndex = 0; setIndex < recombineCount; setIndex += 1) {
    const poolSetId = `${batchId}:POOLSET:RB${String(recombineRound).padStart(2, "0")}:${String(setIndex + 1).padStart(2, "0")}`
    if (evaluatedPoolSetsById.has(poolSetId)) {
      continue
    }
    const entries = []
    const countByTrack = {}
    const engineMixByTrack = {}
    for (const track of tracks) {
      const rows = byTrack.get(track) ?? []
      const activeSize = Math.max(
        1,
        Number(args.poolsetActiveSizeByTrack?.[track] ?? 1) || 1,
      )
      const benchSize = Math.max(
        0,
        Number(args.poolsetBenchSizeByTrack?.[track] ?? 0) || 0,
      )
      const stage2TopK = Math.max(
        1,
        Number(args.stage2TopKByTrack?.[track] ?? activeSize) || activeSize,
      )
      const targetCount = Math.max(stage2TopK, activeSize + benchSize)
      const quota = resolveTrackQuota({ args, track })
      const { selected, engineMix } = selectTrackRowsForPoolSet({
        rows,
        targetCount,
        offset: recombineRound * 97 + setIndex * targetCount,
        quota,
      })
      countByTrack[track] = selected.length
      engineMixByTrack[track] = engineMix
      entries.push(...selected)
    }
    const missingRequiredTracks = requiredTracks.filter(
      (track) => Number(countByTrack[track] ?? 0) <= 0,
    )
    if (!entries.length) continue
    recombined.push({
      poolSetId,
      entries,
      countByTrack,
      engineMixByTrack,
      missingRequiredTracks,
      valid: missingRequiredTracks.length <= 0,
      source: "RECOMBINED_TOP_POOLSETS",
      parentPoolSetIds,
      memberOrigins: summarizeMemberOrigins(entries),
    })
  }
  const validSets = recombined.filter((row) => row.valid === true)
  return validSets.length > 0 ? validSets : recombined
}

const summarizeStage2Result = ({
  runId,
  poolSetId,
  reportPath,
  report,
  requiredTracks,
}) => {
  const lockboxPassByTrack =
    report?.lockboxPassByTrack && typeof report.lockboxPassByTrack === "object"
      ? report.lockboxPassByTrack
      : {}
  const selectedPoolSetByTrack =
    report?.selectedPoolSetByTrack &&
    typeof report.selectedPoolSetByTrack === "object"
      ? report.selectedPoolSetByTrack
      : {}
  const selectedPoolSetPassByTrack = Object.fromEntries(
    Object.entries(selectedPoolSetByTrack).map(([track, entry]) => [
      track,
      entry?.passFinal === true,
    ]),
  )
  const requiredPassCount = requiredTracks.reduce((acc, track) => {
    const pass = selectedPoolSetPassByTrack[track] === true
    return acc + (pass ? 1 : 0)
  }, 0)
  const totalPassCount = Object.values(selectedPoolSetPassByTrack).filter(
    (value) => value === true,
  ).length
  const missingRequiredTracks = requiredTracks.filter(
    (track) => selectedPoolSetPassByTrack[track] !== true,
  )
  const passFinal =
    requiredTracks.length > 0
      ? requiredPassCount >= requiredTracks.length
      : totalPassCount > 0
  const peakRamMb = Math.max(
    0,
    Number(
      report?.runtime?.peakRamMb ??
        report?.resourceUsage?.peakRamMb ??
        report?.memory?.peakRamMb ??
        0,
    ) || 0,
  )
  return {
    runId: String(runId ?? "").trim() || null,
    poolSetId,
    reportPath,
    status: String(report?.status ?? "UNKNOWN").trim() || "UNKNOWN",
    selectionSource: String(report?.selectionSource ?? "").trim() || null,
    passFinal,
    requiredPassCount,
    requiredTrackCount: requiredTracks.length,
    totalPassCount,
    missingRequiredTracks,
    selectedPoolSetByTrack,
    lockboxPassByTrack,
    selectedPoolSetPassByTrack,
    blockedTracks: Array.isArray(report?.blockedTracks)
      ? report.blockedTracks.map((track) =>
          String(track ?? "")
            .trim()
            .toUpperCase(),
        )
      : [],
    blockedReasons: Array.isArray(report?.blockedReasons)
      ? report.blockedReasons.map((row) => String(row ?? ""))
      : [],
    primaryFailureReason:
      String(report?.primaryFailureReason ?? "").trim().toUpperCase() || null,
    peakRamMb,
    score:
      requiredPassCount * 100 +
      totalPassCount * 10 +
      (report?.lockboxOk === true ? 3 : 0),
  }
}

const isCoverageBlockedStage2Result = ({ result, requiredTracks }) => {
  const status = String(result?.status ?? "")
    .trim()
    .toUpperCase()
  if (status !== "BLOCKED_BY_DATA") {
    return false
  }
  const reason = String(result?.primaryFailureReason ?? "")
    .trim()
    .toUpperCase()
  if (reason && reason !== "DATA_COVERAGE_LOW" && reason !== "MISSING_DATA") {
    return false
  }
  const normalizedRequiredTracks = Array.isArray(requiredTracks)
    ? requiredTracks.map((track) =>
        String(track ?? "")
          .trim()
          .toUpperCase(),
      )
    : []
  if (normalizedRequiredTracks.length <= 0) {
    return false
  }
  const blockedTracks = new Set(
    Array.isArray(result?.blockedTracks)
      ? result.blockedTracks.map((track) =>
          String(track ?? "")
            .trim()
            .toUpperCase(),
        )
      : [],
  )
  if (blockedTracks.size <= 0) {
    return false
  }
  return normalizedRequiredTracks.every((track) => blockedTracks.has(track))
}

const comparePoolSetResults = (a, b) => {
  if (b.passFinal !== a.passFinal) return b.passFinal ? 1 : -1
  const dailyPassScoreDiff =
    (Number(b?.dailyPassCompositeScore ?? 0) || 0) -
    (Number(a?.dailyPassCompositeScore ?? 0) || 0)
  if (dailyPassScoreDiff !== 0) return dailyPassScoreDiff
  if (b.score !== a.score) return b.score - a.score
  return String(a.poolSetId ?? "").localeCompare(String(b.poolSetId ?? ""))
}

const cloneJson = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))

const STAGE2_RESULT_CACHE_VERSION = "stage2_result_cache_v1"

const resolveStage2ResultCachePath = ({ rootDir }) =>
  path.join(
    rootDir,
    "artifacts",
    "autosearch_sharded",
    "_cache",
    "stage2_result_cache.json",
  )

const loadStage2ResultCache = ({ cachePath, ttlSec }) => {
  const now = Date.now()
  const ttlMs = Math.max(60, Number(ttlSec ?? 86400) || 86400) * 1000
  const payload = readJsonSafe(cachePath)
  const rows =
    payload && payload.version === STAGE2_RESULT_CACHE_VERSION
      ? Array.isArray(payload.entries)
        ? payload.entries
        : []
      : []
  const map = new Map()
  for (const row of rows) {
    const key = String(row?.key ?? "").trim()
    if (!key) continue
    const updatedAtMs = Date.parse(String(row?.updatedAt ?? ""))
    if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > ttlMs) continue
    map.set(key, {
      updatedAt: new Date(updatedAtMs).toISOString(),
      value: cloneJson(row?.value ?? null),
    })
  }
  return map
}

const saveStage2ResultCache = ({ cachePath, cacheMap }) => {
  const entries = []
  for (const [key, row] of cacheMap.entries()) {
    const resolvedKey = String(key ?? "").trim()
    if (!resolvedKey) continue
    entries.push({
      key: resolvedKey,
      updatedAt: String(row?.updatedAt ?? new Date().toISOString()),
      value: cloneJson(row?.value ?? null),
    })
  }
  const payload = {
    version: STAGE2_RESULT_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    entries,
  }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const buildStage2PolicyHash = ({ args, effectiveTracks, requiredTracks }) =>
  crypto
    .createHash("sha1")
    .update(
      stableStringify({
        policyConflictResolution: args?.policyConflictResolution ?? null,
        asOfInput: args?.asOfInput ?? null,
        passMode: args?.passMode ?? null,
        moonshotTrackRequiredForCorePass:
          args?.moonshotTrackRequiredForCorePass === true,
        targetPct: Number(args?.targetPct ?? 0) || 0,
        minWorst2wAvgPct: Number(args?.minWorst2wAvgPct ?? 0) || 0,
        highWeekPct: Number(args?.highWeekPct ?? 0) || 0,
        minHighWeeks: Number(args?.minHighWeeks ?? 0) || 0,
        nearHighWeeks: Number(args?.nearHighWeeks ?? 0) || 0,
        minOtherWeekPct: Number(args?.minOtherWeekPct ?? 0) || 0,
        requireCompletedTradesEveryWeek:
          Number(args?.requireCompletedTradesEveryWeek ?? 0) || 0,
        poolsetStage1WindowMonths:
          Number(args?.poolsetStage1WindowMonths ?? 0) || 0,
        poolsetStage2WindowMonths:
          Number(args?.poolsetStage2WindowMonths ?? 0) || 0,
        poolsetEvalMode: String(args?.poolsetEvalMode ?? "").trim(),
        tracks: Array.isArray(effectiveTracks) ? [...effectiveTracks] : [],
        requiredTracks: Array.isArray(requiredTracks)
          ? [...requiredTracks]
          : [],
      }),
    )
    .digest("hex")

const buildPoolSetSignature = ({
  poolSet,
  args,
  effectiveTracks,
  requiredTracks,
}) => {
  const normalizedEntries = (
    Array.isArray(poolSet?.entries) ? poolSet.entries : []
  )
    .map((entry) => ({
      track: String(entry?.track ?? "")
        .trim()
        .toUpperCase(),
      engineType:
        String(entry?.engineType ?? "")
          .trim()
          .toLowerCase() === "chart"
          ? "chart"
          : "rule",
      fingerprint: String(entry?.fingerprint ?? "").trim(),
      versionLabel: String(entry?.versionLabel ?? "").trim(),
    }))
    .filter((entry) => entry.track && entry.fingerprint)
    .sort(
      (a, b) =>
        a.track.localeCompare(b.track) ||
        a.engineType.localeCompare(b.engineType) ||
        a.fingerprint.localeCompare(b.fingerprint) ||
        a.versionLabel.localeCompare(b.versionLabel),
    )
  const policyHash = buildStage2PolicyHash({
    args,
    effectiveTracks,
    requiredTracks,
  })
  return crypto
    .createHash("sha1")
    .update(
      stableStringify({
        policyHash,
        countByTrack: poolSet?.countByTrack ?? {},
        entries: normalizedEntries,
      }),
    )
    .digest("hex")
}

const orderPoolSetsForStage2 = ({
  poolSets,
  poolSetsById,
  scheduleMode,
  championDiscoveryBudgetSplit,
}) => {
  const list = Array.isArray(poolSets) ? poolSets.slice() : []
  if (
    String(scheduleMode ?? "")
      .trim()
      .toLowerCase() !== "champion_first"
  ) {
    return list
  }
  const priorityOf = (poolSet) => {
    const source = String(
      poolSetsById?.get?.(String(poolSet?.poolSetId ?? ""))?.source ??
        poolSet?.source ??
        "",
    )
      .trim()
      .toUpperCase()
    if (source.startsWith("CHAMPION")) return 0
    if (source === "DAILY_PASS_AVENGERS") return 1
    if (source === "DISCOVERY_BASE") return 2
    if (source.startsWith("RECOMBINED")) return 3
    return 9
  }
  const sorted = list.sort((a, b) => {
    const p = priorityOf(a) - priorityOf(b)
    if (p !== 0) return p
    return String(a?.poolSetId ?? "").localeCompare(String(b?.poolSetId ?? ""))
  })
  const champions = []
  const discovery = []
  for (const row of sorted) {
    const source = String(
      poolSetsById?.get?.(String(row?.poolSetId ?? ""))?.source ??
        row?.source ??
        "",
    )
      .trim()
      .toUpperCase()
    if (source.startsWith("CHAMPION")) {
      champions.push(row)
    } else {
      discovery.push(row)
    }
  }
  if (!champions.length || !discovery.length) {
    return sorted
  }
  const split = normalizeChampionDiscoveryBudgetSplit({
    source: championDiscoveryBudgetSplit,
    defaults: { champion: 0.4, discovery: 0.6 },
  })
  const merged = []
  let championUsed = 0
  while (champions.length || discovery.length) {
    const idx = merged.length + 1
    const championTarget = Math.max(
      0,
      Math.ceil(idx * Number(split.champion ?? 0)),
    )
    const shouldPickChampion =
      champions.length > 0 &&
      (discovery.length <= 0 || championUsed < championTarget)
    if (shouldPickChampion) {
      merged.push(champions.shift())
      championUsed += 1
      continue
    }
    if (discovery.length > 0) {
      merged.push(discovery.shift())
      continue
    }
    merged.push(champions.shift())
    championUsed += 1
  }
  return merged
}

const DEEP_RESCUE_REASON_ALLOWLIST = new Set([
  "WORST2W_PLOWER_BELOW_P0",
  "WORST2W_LCB_BELOW_THRESHOLD",
])

const shouldDeepRescueCandidate = (entry) => {
  const reason = String(entry?.metrics?.worst2wRescueReason ?? "")
    .trim()
    .toUpperCase()
  if (!reason) {
    return true
  }
  return DEEP_RESCUE_REASON_ALLOWLIST.has(reason)
}

const buildRescueSeed = (entry, track) => {
  const base = crypto
    .createHash("sha1")
    .update(
      stableStringify({
        track: String(track ?? "")
          .trim()
          .toUpperCase(),
        fingerprint: String(entry?.fingerprint ?? "").trim(),
        policyChoice: entry?.policyChoice ?? null,
        patternChoice: entry?.patternChoice ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 8)
  const parsed = Number.parseInt(base, 16)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 17
  }
  return Math.max(1, Math.min(0x7ffffffe, parsed))
}

const resolveRescueValSummaryPath = ({ entry, track }) => {
  const directPath = resolveMaybeAbsolutePath(entry?.valSummaryPath)
  if (directPath && fs.existsSync(directPath)) {
    return {
      path: directPath,
      source: "DIRECT",
      fallbackTried: false,
    }
  }
  const sourceRunId = String(entry?.sourceRunId ?? entry?.runId ?? "").trim()
  const sourceRound = Math.max(
    0,
    Math.floor(Number(entry?.sourceRound ?? 0) || 0),
  )
  if (!sourceRunId || sourceRound < 1) {
    return {
      path: directPath ?? null,
      source: directPath ? "DIRECT_MISSING" : "MISSING",
      fallbackTried: false,
    }
  }
  const fallbackPath = path.join(
    rootDir,
    "artifacts",
    "autosearch",
    sourceRunId,
    "summaries",
    "validation",
    String(track ?? "")
      .trim()
      .toUpperCase(),
    `round_${sourceRound}.json`,
  )
  if (fs.existsSync(fallbackPath)) {
    return {
      path: fallbackPath,
      source: "FALLBACK_FROM_SOURCE_RUN",
      fallbackTried: true,
    }
  }
  return {
    path: directPath ?? fallbackPath,
    source: "FALLBACK_MISSING",
    fallbackTried: true,
  }
}

const isRescueTerminalReason = (reasonToken, explicitReasonSet) => {
  const token = String(reasonToken ?? "")
    .trim()
    .toUpperCase()
  if (!token) return false
  if (explicitReasonSet?.has(token)) return true
  return (
    token.startsWith("WORST2W_") ||
    token.startsWith("WEEK_SERIES_") ||
    token.startsWith("VAL_SUMMARY_")
  )
}

const evaluateRescueDistGate = ({ entry, track, args, mode = "cheap" }) => {
  const resolvedValSummary = resolveRescueValSummaryPath({ entry, track })
  const valSummaryPath = resolvedValSummary.path
  if (!valSummaryPath || !fs.existsSync(valSummaryPath)) {
    return {
      pass: false,
      reason: "VAL_SUMMARY_MISSING",
      passProbLower: 0,
      lcb: null,
      sampleCount: 0,
      stage: "insufficient",
      diagnostics: null,
      valSummaryPath: valSummaryPath ?? null,
      valSummarySource: resolvedValSummary.source,
      fallbackTried: Boolean(resolvedValSummary.fallbackTried),
      weekSeriesLength: 0,
    }
  }
  let valSummary = null
  try {
    valSummary = JSON.parse(fs.readFileSync(valSummaryPath, "utf8"))
  } catch {
    return {
      pass: false,
      reason: "VAL_SUMMARY_PARSE_ERROR",
      passProbLower: 0,
      lcb: null,
      sampleCount: 0,
      stage: "insufficient",
      diagnostics: null,
      valSummaryPath,
      valSummarySource: resolvedValSummary.source,
      fallbackTried: Boolean(resolvedValSummary.fallbackTried),
      weekSeriesLength: 0,
    }
  }
  const weekSeries = Array.isArray(valSummary?.weekSeries)
    ? valSummary.weekSeries
    : []
  if (weekSeries.length < 2) {
    return {
      pass: false,
      reason: "WEEK_SERIES_TOO_SHORT",
      passProbLower: 0,
      lcb: null,
      sampleCount: 0,
      stage: "insufficient",
      diagnostics: null,
      valSummaryPath,
      valSummarySource: resolvedValSummary.source,
      fallbackTried: Boolean(resolvedValSummary.fallbackTried),
      weekSeriesLength: weekSeries.length,
    }
  }
  const rescueB =
    mode === "deep"
      ? Math.max(args.rescueCheapB, args.rescueDeepB)
      : args.rescueCheapB
  const rescueM =
    mode === "deep"
      ? Math.max(args.rescueCheapM, args.rescueDeepM)
      : args.rescueCheapM
  const threshold = Number(
    entry?.metrics?.minWorst2wAvgPct ?? args.minWorst2wAvgPct,
  )
  const dist = evaluateWorst2wDistribution({
    weekSeries,
    minWorst2wAvgPct: Number.isFinite(threshold) ? threshold : -1.5,
    config: {
      enabled: true,
      alpha: args.rescueAlpha,
      p0: args.rescueP0,
      lcbQuantile: args.rescueLcbQuantile,
      nRef: weekSeries.length,
      cheapB: rescueB,
      cheapM: rescueM,
      fullB: rescueB,
      fullM: rescueM,
      sequential: false,
      runWhenClassicFail: true,
      seed: buildRescueSeed(entry, track),
    },
  })
  return {
    pass: dist.pass === true,
    reason: dist.reason ?? null,
    passProbLower: Number(dist.passProbLower ?? 0) || 0,
    lcb: Number.isFinite(Number(dist.lcb)) ? Number(dist.lcb) : null,
    sampleCount: Number(dist.sampleCount ?? 0) || 0,
    stage: dist.stage ?? null,
    diagnostics: dist.diagnostics ?? null,
    valSummaryPath,
    valSummarySource: resolvedValSummary.source,
    fallbackTried: Boolean(resolvedValSummary.fallbackTried),
    weekSeriesLength: weekSeries.length,
    mode,
  }
}

const summarizeReasonCounts = (counter, limit = 24) =>
  Object.entries(counter ?? {})
    .map(([reason, count]) => ({
      reason,
      count: Number(count ?? 0) || 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, Math.max(1, limit))

const buildMoonshotGateDiagnostics = ({ rows, tracks }) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const trackList = Array.isArray(tracks) ? tracks : []
  const byTrack = {}
  const aggregateReasons = {}
  let totalRows = 0
  let passCount = 0
  let failCount = 0
  let unknownCount = 0

  for (const track of trackList) {
    const trackRows = sourceRows.filter((row) => row?.track === track)
    const reasonCounts = {}
    let trackPass = 0
    let trackFail = 0
    let trackUnknown = 0
    let signalsLoadedMin = null
    let signalsLoadedMax = null
    let signalsQualifiedMin = null
    let signalsQualifiedMax = null
    for (const row of trackRows) {
      const gatePass = row?.metrics?.moonshotGatePass
      const reason = String(
        row?.metrics?.moonshotGateReason ??
          (gatePass === true ? "PASS" : "MOONSHOT_GATE_UNKNOWN"),
      )
        .trim()
        .toUpperCase()
      const signalsLoaded = Number(row?.metrics?.moonshotSignalsLoaded ?? NaN)
      const signalsQualified = Number(
        row?.metrics?.moonshotSignalsQualified ?? NaN,
      )
      if (Number.isFinite(signalsLoaded)) {
        signalsLoadedMin =
          signalsLoadedMin === null
            ? signalsLoaded
            : Math.min(signalsLoadedMin, signalsLoaded)
        signalsLoadedMax =
          signalsLoadedMax === null
            ? signalsLoaded
            : Math.max(signalsLoadedMax, signalsLoaded)
      }
      if (Number.isFinite(signalsQualified)) {
        signalsQualifiedMin =
          signalsQualifiedMin === null
            ? signalsQualified
            : Math.min(signalsQualifiedMin, signalsQualified)
        signalsQualifiedMax =
          signalsQualifiedMax === null
            ? signalsQualified
            : Math.max(signalsQualifiedMax, signalsQualified)
      }
      if (gatePass === true) {
        trackPass += 1
      } else if (gatePass === false) {
        trackFail += 1
        reasonCounts[reason] = (Number(reasonCounts[reason] ?? 0) || 0) + 1
        aggregateReasons[reason] =
          (Number(aggregateReasons[reason] ?? 0) || 0) + 1
      } else {
        trackUnknown += 1
      }
    }
    byTrack[track] = {
      totalRows: trackRows.length,
      passCount: trackPass,
      failCount: trackFail,
      unknownCount: trackUnknown,
      signalsLoadedMin,
      signalsLoadedMax,
      signalsQualifiedMin,
      signalsQualifiedMax,
      topFailureReasons: summarizeReasonCounts(reasonCounts),
    }
    totalRows += trackRows.length
    passCount += trackPass
    failCount += trackFail
    unknownCount += trackUnknown
  }

  return {
    totalRows,
    passCount,
    failCount,
    unknownCount,
    byTrack,
    topFailureReasons: summarizeReasonCounts(aggregateReasons),
  }
}

const writeMoonshotGateDiagnostics = ({
  summaryDir,
  rows,
  tracks,
  context = {},
}) => {
  const diagnostics = buildMoonshotGateDiagnostics({ rows, tracks })
  const payload = {
    ...diagnostics,
    ...context,
    createdAt: new Date().toISOString(),
  }
  const diagPath = path.join(summaryDir, "moonshot_gate_diag.json")
  fs.writeFileSync(diagPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return { payload, path: diagPath }
}

const run = async () => {
  assertServerOnly({ script: "autosearch/go_live_sharded" })
  assertNoKisRuntime({ script: "autosearch/go_live_sharded" })
  const args = parseArgs()
  if (args.policyConflictResolution !== "POOLSET_FIRST_STRICT") {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED policyConflictResolution=${args.policyConflictResolution || "UNKNOWN"}`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (
    args.poolsetStage1WindowMonths !== 4 ||
    args.poolsetStage2WindowMonths !== 4
  ) {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED poolsetWindow=${args.poolsetStage1WindowMonths}/${args.poolsetStage2WindowMonths} expected=4/4`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (args.poolsetEvalMode !== "daily_router_8m") {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED poolsetEvalMode=${args.poolsetEvalMode || "UNKNOWN"} expected=daily_router_8m`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (args.poolsetEnabled !== true) {
    const error = new Error(
      "POLICY_CONFLICT_BLOCKED poolsetEnabled must be true",
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (
    args.executionLane !== "codex_cloud" &&
    Number(args.poolsetMaxConcurrentEval ?? 1) !== 1
  ) {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED poolsetMaxConcurrentEval=${args.poolsetMaxConcurrentEval} expected=1`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (args.moonshotTrackRequiredForCorePass === true) {
    const error = new Error(
      "POLICY_CONFLICT_BLOCKED moonshotTrackRequiredForCorePass must be false",
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (args.dailyPassAvengersEnabled !== true) {
    const error = new Error(
      "POLICY_CONFLICT_BLOCKED dailyPassAvengersEnabled must be true",
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  const tracks = parseTracks(args.tracks)
  if (!tracks.length) {
    throw new Error("tracks missing")
  }
  const bucketTotal = Math.max(1, Number(args.symbolBucketTotal ?? 1) || 1)
  const rawBucketIndex = Math.floor(Number(args.symbolBucketIndex ?? 0) || 0)
  const bucketIndex =
    ((rawBucketIndex % bucketTotal) + bucketTotal) % bucketTotal
  const requiredTracksRaw =
    args.passMode === "surge_only"
      ? ["SURGE_EOD"]
      : Array.from(new Set(tracks)).filter(
          (track) =>
            track !== "MOONSHOT" ||
            args.moonshotTrackRequiredForCorePass === true,
        )
  const requiredTracks = requiredTracksRaw.length
    ? requiredTracksRaw
    : Array.from(new Set(tracks))
  const stage1Parallel = resolveStage1Parallel({ args })
  const excludedFingerprints = loadExcludedFingerprints(
    args.excludeFingerprintsPath,
  )
  const batchId = args.batchId ?? createBatchId()
  const summaryDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_sharded",
    batchId,
  )
  fs.mkdirSync(summaryDir, { recursive: true })

  const stage1Runs = Array.from({ length: args.shards }, (_, shardIndex) => {
    const seed = args.seedStart + shardIndex
    const runId = `${batchId}_S1_sh${String(shardIndex + 1).padStart(2, "0")}`
    const symbolSeed = `${args.symbolSeedBase}:S1:${shardIndex}`
    const runDir = path.join(rootDir, "artifacts", "autosearch", runId)
    return {
      runId,
      shardIndex,
      seed,
      symbolSeed,
      runDir,
      reportPath: path.join(runDir, "final_report.json"),
      candidatesPath: path.join(runDir, "candidates.ndjson"),
    }
  })
  const buildStage1Args = (runEntry) => [
    "scripts/autosearch/go_live_autosearch.mjs",
    `--runId=${runEntry.runId}`,
    `--asof=${args.asOfInput}`,
    `--tracks=${tracks.join(",")}`,
    `--passMode=${args.passMode}`,
    `--moonshotTrackRequiredForCorePass=${args.moonshotTrackRequiredForCorePass ? 1 : 0}`,
    "--stage=stage1",
    `--targetPct=${args.targetPct}`,
    `--minWorst2wAvgPct=${args.minWorst2wAvgPct}`,
    `--highWeekPct=${args.highWeekPct}`,
    `--minHighWeeks=${args.minHighWeeks}`,
    `--nearHighWeeks=${args.nearHighWeeks}`,
    `--minOtherWeekPct=${args.minOtherWeekPct}`,
    `--requireCompletedTradesEveryWeek=${args.requireCompletedTradesEveryWeek}`,
    `--maxRounds=${args.stage1MaxRounds}`,
    `--plateauRounds=${args.stage1PlateauRounds}`,
    `--seed=${runEntry.seed}`,
    `--symbolSeed=${runEntry.symbolSeed}`,
    `--symbolShardTotal=${args.shards}`,
    `--symbolShardIndex=${runEntry.shardIndex}`,
    `--symbolBucketTotal=${bucketTotal}`,
    `--symbolBucketIndex=${bucketIndex}`,
    `--printEvery=${args.printEvery}`,
    "--dryRun=1",
  ]
  console.log(
    `[go-live-sharded] stage1 parallel=${stage1Parallel} shards=${args.shards} bucket=${bucketIndex + 1}/${bucketTotal}`,
  )
  if (excludedFingerprints.size > 0) {
    console.log(
      `[go-live-sharded] fingerprint exclude enabled count=${excludedFingerprints.size}`,
    )
  }
  if (stage1Parallel <= 1) {
    for (const runEntry of stage1Runs) {
      runChild(buildStage1Args(runEntry))
    }
  } else {
    const pending = [...stage1Runs]
    const running = new Set()
    const launch = (runEntry) => {
      const job = runChildAsync(buildStage1Args(runEntry))
        .catch((error) => {
          throw error
        })
        .finally(() => running.delete(job))
      running.add(job)
    }
    while (pending.length || running.size) {
      const freeMb = Math.floor(
        (Number(os.freemem?.() ?? 0) || 0) / 1024 / 1024,
      )
      const currentCap = freeMb < args.minFreeMbForParallel ? 1 : stage1Parallel
      while (pending.length && running.size < currentCap) {
        launch(pending.shift())
      }
      if (running.size > 0) {
        await Promise.race(running)
      }
    }
  }

  const stage1RowsByRun = stage1Runs.map((runEntry) => {
    const candidatesExists = fs.existsSync(runEntry.candidatesPath)
    const reportExists = fs.existsSync(runEntry.reportPath)
    const rows = candidatesExists ? readNdjson(runEntry.candidatesPath) : []
    const report = reportExists ? readJsonSafe(runEntry.reportPath) : null
    return {
      runEntry,
      candidatesExists,
      reportExists,
      rows,
      report,
    }
  })
  const stage1TotalRows = stage1RowsByRun.reduce(
    (acc, item) => acc + (Array.isArray(item.rows) ? item.rows.length : 0),
    0,
  )
  console.log(
    `[go-live-sharded] stage1 artifacts ready runs=${stage1RowsByRun.length} rows=${stage1TotalRows}`,
  )
  const stage1RowsByRunId = new Map(
    stage1RowsByRun.map((item) => [item.runEntry.runId, item]),
  )
  const missingStage1Artifacts = stage1RowsByRun.filter(
    (item) => !item.candidatesExists && !item.reportExists,
  )
  if (missingStage1Artifacts.length > 0) {
    const sample = missingStage1Artifacts
      .slice(0, 4)
      .map((item) => item.runEntry.runId)
      .join(",")
    throw new Error(
      `STAGE1_ARTIFACTS_MISSING missing=${missingStage1Artifacts.length}/${stage1Runs.length} sample=${sample}`,
    )
  }
  const emptyStage1CandidateArtifacts = stage1RowsByRun.filter(
    (item) => item.candidatesExists && item.rows.length < 1,
  )
  if (emptyStage1CandidateArtifacts.length > 0) {
    const sample = emptyStage1CandidateArtifacts
      .slice(0, 4)
      .map((item) => {
        const status = String(item?.report?.status ?? "UNKNOWN").trim()
        return `${item.runEntry.runId}:${status || "UNKNOWN"}`
      })
      .join(",")
    throw new Error(
      `STAGE1_CANDIDATES_EMPTY empty=${emptyStage1CandidateArtifacts.length}/${stage1Runs.length} sample=${sample}`,
    )
  }

  const allRows = []
  const prefilterCounter = new Map()
  const prefilterCounterByTrack = new Map()
  const inputRowsByTrack = new Map()
  const outputRowsByTrack = new Map()
  const prefilterDroppedRowsByTrack = new Map()
  const zeroTradeFallbackRowsByTrack = new Map()
  const zeroTradeChartFallbackRowsByTrack = new Map()
  const prefilterChartFallbackRowsByTrack = new Map()
  const prefilterDroppedCapPerTrack = Math.max(
    40,
    args.executionLane === "codex_cloud"
      ? Math.floor(args.topPerTrack * 8)
      : Math.min(400, Math.floor(args.topPerTrack * 8)),
  )
  let prefilterInputRows = 0
  let droppedByExcludedFingerprint = 0
  for (const stage1Entry of stage1RowsByRun) {
    const runEntry = stage1Entry.runEntry
    const rows = stage1Entry.rows
    for (const row of rows) {
      prefilterInputRows += 1
      const track = String(row?.track ?? "")
        .trim()
        .toUpperCase()
      if (!tracks.includes(track)) continue
      incrementMapCounter(inputRowsByTrack, track)
      if (!row?.policyChoice || !row?.patternChoice) continue
      const engineType = resolveCandidateEngineType(row)
      const fingerprint =
        String(row?.fingerprint ?? "").trim() ||
        buildCandidateFingerprint({
          track,
          policyChoice: row.policyChoice,
          patternChoice: row.patternChoice,
        })
      if (fingerprint && excludedFingerprints.has(fingerprint)) {
        droppedByExcludedFingerprint += 1
        continue
      }
      const completedTrades = toFinite(row?.metrics?.completedTrades, 0)
      if (completedTrades < 1) {
        const fallbackRows = zeroTradeFallbackRowsByTrack.get(track) ?? []
        if (fallbackRows.length < prefilterDroppedCapPerTrack) {
          fallbackRows.push({
            ...row,
            track,
            engineType,
            fingerprint: fingerprint || null,
            sourceRunId: runEntry.runId,
            sourceRound: Number(row?.round ?? 0) || 0,
          })
          zeroTradeFallbackRowsByTrack.set(track, fallbackRows)
        }
        if (engineType === "chart") {
          const chartFallbackRows =
            zeroTradeChartFallbackRowsByTrack.get(track) ?? []
          if (chartFallbackRows.length < prefilterDroppedCapPerTrack) {
            chartFallbackRows.push({
              ...row,
              track,
              engineType,
              fingerprint: fingerprint || null,
              sourceRunId: runEntry.runId,
              sourceRound: Number(row?.round ?? 0) || 0,
            })
            zeroTradeChartFallbackRowsByTrack.set(track, chartFallbackRows)
          }
        }
        continue
      }
      const prefilter = evaluatePrefilter({
        metrics: row?.metrics ?? null,
        args,
      })
      if (prefilter.drop) {
        incrementMapCounter(prefilterCounter, prefilter.reason)
        incrementMapCounter(
          prefilterCounterByTrack,
          `${track}:${prefilter.reason ?? "UNKNOWN"}`,
        )
        const dropped = prefilterDroppedRowsByTrack.get(track) ?? []
        if (dropped.length < prefilterDroppedCapPerTrack) {
          dropped.push({
            ...row,
            track,
            engineType,
            fingerprint: fingerprint || null,
            sourceRunId: runEntry.runId,
            sourceRound: Number(row?.round ?? 0) || 0,
          })
          prefilterDroppedRowsByTrack.set(track, dropped)
        }
        if (engineType === "chart") {
          const chartFallbackRows =
            prefilterChartFallbackRowsByTrack.get(track) ?? []
          if (chartFallbackRows.length < prefilterDroppedCapPerTrack) {
            chartFallbackRows.push({
              ...row,
              track,
              engineType,
              fingerprint: fingerprint || null,
              sourceRunId: runEntry.runId,
              sourceRound: Number(row?.round ?? 0) || 0,
            })
            prefilterChartFallbackRowsByTrack.set(track, chartFallbackRows)
          }
        }
        continue
      }
      allRows.push({
        ...row,
        track,
        engineType,
        fingerprint: fingerprint || null,
        sourceRunId: runEntry.runId,
        sourceRound: Number(row?.round ?? 0) || 0,
      })
      incrementMapCounter(outputRowsByTrack, track)
    }
  }

  const byTrack = new Map(tracks.map((track) => [track, []]))
  for (const row of allRows) {
    const list = byTrack.get(row.track) ?? []
    list.push(row)
    byTrack.set(row.track, list)
  }

  const poolEntries = []
  const poolDiversityByTrack = {}
  for (const track of tracks) {
    const rows = byTrack.get(track) ?? []
    rows.sort(compareCandidateRows)
    const deduped = []
    const seen = new Set()
    for (const row of rows) {
      const key = poolDedupKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push({
        track,
        engineType: resolveCandidateEngineType(row),
        fingerprint: row.fingerprint ?? null,
        policyChoice: row.policyChoice,
        patternChoice: row.patternChoice,
        metrics: row.metrics ?? null,
        valSummaryPath: row.valSummaryPath ?? null,
        lockboxSummaryPath: row.lockboxSummaryPath ?? null,
        runId: row.runId ?? null,
        sourceRunId: row.sourceRunId ?? null,
        sourceRound: row.sourceRound ?? 0,
      })
    }
    const diverseSelection = pickDiverseRows({
      rows: deduped,
      topPerTrack: args.topPerTrack,
    })
    poolDiversityByTrack[track] = {
      uniqueCandidates: deduped.length,
      selected: diverseSelection.selected.length,
      diversityGroups: diverseSelection.diversityGroups,
    }
    for (const row of diverseSelection.selected) {
      poolEntries.push(row)
    }
  }

  const trackZeroBackfillByTrack = {}
  const poolSeenBeforeBackfill = new Set(
    poolEntries.map((entry) => poolDedupKey(entry)),
  )
  for (const track of tracks) {
    const trackEntries = poolEntries.filter((entry) => entry.track === track)
    if (trackEntries.length > 0) continue
    const fallbackRows = [
      ...(zeroTradeFallbackRowsByTrack.get(track) ?? []),
      ...(prefilterDroppedRowsByTrack.get(track) ?? []),
    ].sort(compareCandidateRows)
    if (fallbackRows.length <= 0) continue
    const targetBackfill = Math.max(
      1,
      Math.min(
        6,
        Number(args.stage2TopKByTrack?.[track] ?? 1) || 1,
        fallbackRows.length,
      ),
    )
    let added = 0
    for (const row of fallbackRows) {
      if (added >= targetBackfill) break
      const key = poolDedupKey(row)
      if (poolSeenBeforeBackfill.has(key)) continue
      poolSeenBeforeBackfill.add(key)
      poolEntries.push({
        ...row,
        track,
        engineType: resolveCandidateEngineType(row),
        rescueSource: "TRACK_ZERO_BACKFILL",
      })
      added += 1
    }
    if (added > 0) {
      trackZeroBackfillByTrack[track] = {
        added,
        available: fallbackRows.length,
      }
    }
  }

  const engineQuotaBackfillByTrack = {}
  const poolSeenBeforeQuotaBackfill = new Set(poolSeenBeforeBackfill)
  for (const track of tracks) {
    const quota = resolveTrackQuota({ args, track })
    if (Number(quota.chart ?? 0) <= 0) continue
    const trackEntries = poolEntries.filter((entry) => entry.track === track)
    const hasChart = trackEntries.some(
      (entry) => resolveCandidateEngineType(entry) === "chart",
    )
    if (hasChart) continue
    const fallbackRows = [
      ...(zeroTradeChartFallbackRowsByTrack.get(track) ?? []).map((row) => ({
        ...row,
        __backfillSource: "ZERO_TRADE_CHART",
      })),
      ...(prefilterChartFallbackRowsByTrack.get(track) ?? []).map((row) => ({
        ...row,
        __backfillSource: "PREFILTER_CHART",
      })),
    ].sort(compareCandidateRows)
    if (fallbackRows.length <= 0) continue
    const targetBackfill = Math.max(
      1,
      Math.min(
        4,
        Number(args.stage2TopKByTrack?.[track] ?? 1) || 1,
        fallbackRows.length,
      ),
    )
    let added = 0
    for (const row of fallbackRows) {
      if (added >= targetBackfill) break
      const key = poolDedupKey(row)
      if (poolSeenBeforeQuotaBackfill.has(key)) continue
      poolSeenBeforeQuotaBackfill.add(key)
      poolEntries.push({
        ...row,
        track,
        engineType: resolveCandidateEngineType(row),
        rescueSource: `ENGINE_QUOTA_${String(row?.__backfillSource ?? "CHART").trim()}`,
      })
      added += 1
    }
    if (added > 0) {
      engineQuotaBackfillByTrack[track] = {
        added,
        available: fallbackRows.length,
        sources: {
          zeroTradeChart:
            zeroTradeChartFallbackRowsByTrack.get(track)?.length ?? 0,
          prefilterChart:
            prefilterChartFallbackRowsByTrack.get(track)?.length ?? 0,
        },
      }
    }
  }

  const rescueAddedByTrack = {}
  let stage1MissingTrackWarning = null
  let missingRequired = requiredTracks.filter((track) => {
    return !poolEntries.some((entry) => entry.track === track)
  })
  if (missingRequired.length && args.prefilterEnabled) {
    const poolSeen = new Set(poolEntries.map((entry) => poolDedupKey(entry)))
    for (const track of missingRequired) {
      const dropped = prefilterDroppedRowsByTrack.get(track) ?? []
      if (!dropped.length) continue
      dropped.sort(compareCandidateRows)
      const diverseSelection = pickDiverseRows({
        rows: dropped,
        topPerTrack: Math.max(2, Math.min(args.topPerTrack, 10)),
      })
      let added = 0
      for (const row of diverseSelection.selected) {
        const key = poolDedupKey(row)
        if (poolSeen.has(key)) continue
        poolSeen.add(key)
        poolEntries.push({
          ...row,
          engineType: resolveCandidateEngineType(row),
          rescueSource: "PREFILTER_RELAX",
        })
        added += 1
      }
      rescueAddedByTrack[track] = {
        droppedCandidates: dropped.length,
        added,
      }
    }
    missingRequired = requiredTracks.filter((track) => {
      return !poolEntries.some((entry) => entry.track === track)
    })
  }
  if (missingRequired.length) {
    const reason = `INSUFFICIENT_POOL no candidate pool entries for ${missingRequired.join(",")}`
    const availableRequiredTracks = requiredTracks.filter((track) => {
      return poolEntries.some((entry) => entry.track === track)
    })
    const severeMissingRequired = availableRequiredTracks.length <= 0
    const moonshotGateDiagnostics = writeMoonshotGateDiagnostics({
      summaryDir,
      rows: allRows,
      tracks,
      context: {
        status: "INSUFFICIENT_POOL",
        phase: "POOL_BUILD",
        reason,
      },
    })
    fs.writeFileSync(
      path.join(summaryDir, "summary.json"),
      `${JSON.stringify(
        {
          batchId,
          args,
          stage1Runs,
          stage1Candidates: allRows.length,
          poolCountByTrack: Object.fromEntries(
            tracks.map((track) => [
              track,
              poolEntries.filter((entry) => entry.track === track).length,
            ]),
          ),
          prefilter: {
            enabled: args.prefilterEnabled,
            inputRows: prefilterInputRows,
            inputRowsByTrack: Object.fromEntries(inputRowsByTrack.entries()),
            outputRows: allRows.length,
            outputRowsByTrack: Object.fromEntries(outputRowsByTrack.entries()),
            droppedByExcludedFingerprint,
            droppedByReason: summarizeMapCounter(prefilterCounter).top,
            droppedByReasonByTrack: summarizeCounterByTrackReason(
              prefilterCounterByTrack,
            ),
            excludedFingerprints: excludedFingerprints.size,
          },
          rescueAddedByTrack,
          moonshotPoolDiagnostics: moonshotGateDiagnostics.payload,
          moonshotPoolDiagnosticsPath: moonshotGateDiagnostics.path,
          stage2: null,
          status: "INSUFFICIENT_POOL",
          reason,
          missingRequiredTracks: missingRequired,
          availableRequiredTracks,
          severeMissingRequired,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    if (severeMissingRequired) {
      throw new Error(reason)
    }
    stage1MissingTrackWarning = {
      status: "POOL_TRACK_DEGRADED",
      reason,
      missingRequiredTracks: missingRequired,
      availableRequiredTracks,
      continueStage2: true,
    }
    console.warn(
      `[go-live-sharded] required track subset missing; continue stage2 with tracks=${availableRequiredTracks.join(",")} missing=${missingRequired.join(",")}`,
    )
  }

  const poolQualityByTrack = Object.fromEntries(
    tracks.map((track) => {
      const entries = poolEntries.filter((entry) => entry.track === track)
      const worst2wGatePassCount = entries.filter(
        (entry) => entry?.metrics?.worst2wGatePass === true,
      ).length
      return [
        track,
        {
          selected: entries.length,
          worst2wGatePassCount,
          minPoolRequired:
            track === "SURGE_EOD"
              ? args.minPoolPerTrackSurge
              : args.minPoolPerTrackGap,
          minWorst2wPassRequired:
            track === "SURGE_EOD"
              ? args.minWorst2wPassPerTrackSurge
              : args.minWorst2wPassPerTrackGap,
        },
      ]
    }),
  )
  const resolveRescueTargetPassCount = (quality) => {
    const configured = Math.max(
      0,
      Number(quality?.minWorst2wPassRequired ?? 0) || 0,
    )
    // Respect per-track configured floor (0 allowed).
    // Final acceptance remains governed by downstream stage2/lockbox rules.
    return configured
  }
  const lowQualityTracks = requiredTracks.filter((track) => {
    const quality = poolQualityByTrack[track]
    if (!quality) return true
    if (quality.selected < quality.minPoolRequired) return true
    if (
      Number(
        quality.worst2wEffectivePassCount ?? quality.worst2wGatePassCount,
      ) < resolveRescueTargetPassCount(quality)
    ) {
      return true
    }
    return false
  })
  const rescueDistByTrack = {}
  if (lowQualityTracks.length && args.rescueEnabled) {
    for (const track of lowQualityTracks) {
      const rescueTrackStartedAtMs = Date.now()
      const entries = poolEntries
        .filter((entry) => entry.track === track)
        .sort(compareCandidateRows)
      const inspectTopK = Math.max(1, Number(args.rescueTopK ?? 20) || 20)
      const inspectSelection = pickDiverseRows({
        rows: entries,
        topPerTrack: inspectTopK,
      })
      const inspect = inspectSelection.selected
      const rescueRows = []
      const quality = poolQualityByTrack[track]
      const basePassCount = Number(quality?.worst2wGatePassCount ?? 0) || 0
      const minPassRequired = resolveRescueTargetPassCount(quality)
      const rescuePassNeeded = Math.max(0, minPassRequired - basePassCount)
      const rescueEarlyExitReasonSet = new Set([
        "WORST2W_INSUFFICIENT_WEEKS",
        "WEEK_SERIES_TOO_SHORT",
        "VAL_SUMMARY_MISSING",
        "VAL_SUMMARY_PARSE_ERROR",
        "WORST2W_PLOWER_BELOW_P0",
        "WORST2W_LCB_BELOW_THRESHOLD",
      ])
      const rescueEarlyExitNoPassMinEval = Math.max(
        1,
        Number(args.rescueEarlyExitNoPassMinEval ?? 12) || 12,
      )
      const rescueEarlyExitNoPassMaxEval = Math.max(
        1,
        Number(args.rescueEarlyExitNoPassMaxEval ?? 64) || 64,
      )
      const rescueEarlyExitMinEvalRatio = Math.max(
        0,
        Math.min(1, Number(args.rescueEarlyExitMinEvalRatio ?? 0.25) || 0),
      )
      const cheapInspectCount = Math.max(0, inspect.length)
      const cheapEarlyExitNoPassMinEval =
        cheapInspectCount > 0
          ? Math.min(
              cheapInspectCount,
              rescueEarlyExitNoPassMaxEval,
              Math.max(
                rescueEarlyExitNoPassMinEval,
                Math.ceil(cheapInspectCount * rescueEarlyExitMinEvalRatio),
              ),
            )
          : 1
      const rescueEarlyExitTerminalReasonRatio = Math.max(
        0.5,
        Math.min(
          1,
          Number(args.rescueEarlyExitTerminalReasonRatio ?? 0.85) || 0.85,
        ),
      )
      console.log(
        `[go-live-sharded] rescue start track=${track} entries=${entries.length} inspectTopK=${inspectTopK} inspectSelected=${inspect.length} inspectGroups=${inspectSelection.diversityGroups} cheapMinEval=${cheapEarlyExitNoPassMinEval} basePass=${basePassCount} minPass=${minPassRequired}`,
      )
      let rescuedPassCount = 0
      let cheapInspected = 0
      let cheapTerminalReasonCount = 0
      let cheapStoppedByEnoughPass = false
      let cheapStoppedByEarlyExit = false
      for (const entry of inspect) {
        if (entry?.metrics?.worst2wGatePass === true) {
          continue
        }
        if (rescuePassNeeded > 0 && rescuedPassCount >= rescuePassNeeded) {
          cheapStoppedByEnoughPass = true
          break
        }
        cheapInspected += 1
        const gate = evaluateRescueDistGate({
          entry,
          track,
          args,
          mode: "cheap",
        })
        entry.metrics = {
          ...(entry?.metrics && typeof entry.metrics === "object"
            ? entry.metrics
            : {}),
          worst2wRescuePass: gate.pass,
          worst2wRescueReason: gate.reason,
          worst2wRescuePassProbLower: gate.passProbLower,
          worst2wRescueLcb: gate.lcb,
          worst2wRescueSampleCount: gate.sampleCount,
          worst2wRescueStage: gate.stage,
        }
        rescueRows.push({
          fingerprint: entry?.fingerprint ?? null,
          pass: gate.pass,
          reason: gate.reason,
          passProbLower: gate.passProbLower,
          lcb: gate.lcb,
          sampleCount: gate.sampleCount,
          stage: gate.stage,
          valSummaryPath: gate.valSummaryPath,
          valSummarySource: gate.valSummarySource ?? null,
          fallbackTried: Boolean(gate.fallbackTried),
          weekSeriesLength: Number(gate.weekSeriesLength ?? 0) || 0,
          mode: gate.mode ?? "cheap",
        })
        if (gate.pass) {
          rescuedPassCount += 1
        } else {
          const reasonToken = String(gate.reason ?? "")
            .trim()
            .toUpperCase()
          if (isRescueTerminalReason(reasonToken, rescueEarlyExitReasonSet)) {
            cheapTerminalReasonCount += 1
          }
        }
        if (
          args.rescueEarlyExitEnabled !== false &&
          rescuePassNeeded > 0 &&
          rescuedPassCount <= 0 &&
          cheapInspected >= cheapEarlyExitNoPassMinEval
        ) {
          const terminalRatio = cheapTerminalReasonCount / cheapInspected
          const reachedNoPassCap =
            cheapInspected >= Math.max(1, rescueEarlyExitNoPassMaxEval)
          if (
            terminalRatio >= rescueEarlyExitTerminalReasonRatio ||
            reachedNoPassCap
          ) {
            cheapStoppedByEarlyExit = true
            break
          }
        }
        if (
          args.rescueLogEvery > 0 &&
          cheapInspected % Math.max(1, Number(args.rescueLogEvery) || 1) === 0
        ) {
          console.log(
            `[go-live-sharded] rescue cheap progress track=${track} evaluated=${cheapInspected}/${inspect.length} pass=${rescuedPassCount}`,
          )
        }
      }
      if (quality) {
        quality.worst2wRescuePassCount = rescuedPassCount
        quality.worst2wEffectivePassCount =
          Number(quality.worst2wGatePassCount ?? 0) + rescuedPassCount
        quality.rescueTopKEvaluated = cheapInspected
        quality.rescueTopKTarget = inspectTopK
        quality.rescueTopKDiversityGroups = inspectSelection.diversityGroups
        quality.rescueCheapEarlyExitMinEval = cheapEarlyExitNoPassMinEval
        quality.rescueCheapStoppedByEnoughPass = cheapStoppedByEnoughPass
        quality.rescueCheapStoppedByEarlyExit = cheapStoppedByEarlyExit
        quality.rescueCheapTerminalReasonCount = cheapTerminalReasonCount
      }
      let deepInspected = 0
      let deepPassCount = 0
      let deepTerminalReasonCount = 0
      let deepSkippedByReason = 0
      let deepSkippedByCap = 0
      let deepStoppedByEnoughPass = false
      let deepStoppedByEarlyExit = false
      let deepTopK = Math.max(1, Number(args.rescueDeepTopK ?? 12) || 12)
      let deepDiversityGroups = 0
      let deepEarlyExitNoPassMinEval = rescueEarlyExitNoPassMinEval
      let deepSkippedByMoonshotDominant = false
      let moonshotEvaluatedCount = 0
      let moonshotFailCount = 0
      for (const candidate of entries) {
        const moonshotGatePass = candidate?.metrics?.moonshotGatePass
        if (typeof moonshotGatePass !== "boolean") continue
        moonshotEvaluatedCount += 1
        if (moonshotGatePass === false) {
          moonshotFailCount += 1
        }
      }
      const moonshotFailDominant =
        args.rescueDeepAllowMoonshotDominant !== true &&
        track === "SURGE_EOD" &&
        moonshotEvaluatedCount >= 4 &&
        moonshotFailCount >=
          Math.max(3, Math.ceil(moonshotEvaluatedCount * 0.9)) &&
        rescuedPassCount <= 0
      const needsDeepRecovery =
        quality &&
        Number(
          quality.worst2wEffectivePassCount ?? quality.worst2wGatePassCount,
        ) < minPassRequired
      if (needsDeepRecovery && !moonshotFailDominant) {
        const deepCandidates = entries.filter(
          (entry) =>
            entry?.metrics?.worst2wGatePass !== true &&
            entry?.metrics?.worst2wRescuePass !== true,
        )
        const deepEligible = deepCandidates.filter((entry) =>
          shouldDeepRescueCandidate(entry),
        )
        deepSkippedByReason = Math.max(
          0,
          deepCandidates.length - deepEligible.length,
        )
        const deepInspectSelection = pickDiverseRows({
          rows: deepEligible,
          topPerTrack: deepTopK,
        })
        const deepInspect = deepInspectSelection.selected
        deepDiversityGroups = deepInspectSelection.diversityGroups
        const deepInspectCount = Math.max(0, deepInspect.length)
        deepEarlyExitNoPassMinEval =
          deepInspectCount > 0
            ? Math.min(
                deepInspectCount,
                rescueEarlyExitNoPassMaxEval,
                Math.max(
                  rescueEarlyExitNoPassMinEval,
                  Math.ceil(deepInspectCount * rescueEarlyExitMinEvalRatio),
                ),
              )
            : 1
        deepSkippedByCap = Math.max(0, deepEligible.length - deepInspect.length)
        const deepPassNeeded = Math.max(
          0,
          Number(quality?.minWorst2wPassRequired ?? 0) -
            (Number(quality?.worst2wGatePassCount ?? 0) +
              Number(quality?.worst2wRescuePassCount ?? 0)),
        )
        for (const entry of deepInspect) {
          if (deepPassNeeded > 0 && deepPassCount >= deepPassNeeded) {
            deepStoppedByEnoughPass = true
            break
          }
          deepInspected += 1
          const gate = evaluateRescueDistGate({
            entry,
            track,
            args,
            mode: "deep",
          })
          entry.metrics = {
            ...(entry?.metrics && typeof entry.metrics === "object"
              ? entry.metrics
              : {}),
            worst2wRescuePassDeep: gate.pass,
            worst2wRescueReasonDeep: gate.reason,
            worst2wRescuePassProbLowerDeep: gate.passProbLower,
            worst2wRescueLcbDeep: gate.lcb,
            worst2wRescueSampleCountDeep: gate.sampleCount,
            worst2wRescueStageDeep: gate.stage,
          }
          rescueRows.push({
            fingerprint: entry?.fingerprint ?? null,
            pass: gate.pass,
            reason: gate.reason,
            passProbLower: gate.passProbLower,
            lcb: gate.lcb,
            sampleCount: gate.sampleCount,
            stage: gate.stage,
            valSummaryPath: gate.valSummaryPath,
            valSummarySource: gate.valSummarySource ?? null,
            fallbackTried: Boolean(gate.fallbackTried),
            weekSeriesLength: Number(gate.weekSeriesLength ?? 0) || 0,
            mode: gate.mode ?? "deep",
          })
          if (gate.pass) {
            deepPassCount += 1
            entry.metrics.worst2wRescuePass = true
            entry.metrics.worst2wRescueReason = gate.reason
            entry.metrics.worst2wRescuePassProbLower = gate.passProbLower
            entry.metrics.worst2wRescueLcb = gate.lcb
            entry.metrics.worst2wRescueSampleCount = gate.sampleCount
            entry.metrics.worst2wRescueStage = gate.stage
          } else {
            const reasonToken = String(gate.reason ?? "")
              .trim()
              .toUpperCase()
            if (isRescueTerminalReason(reasonToken, rescueEarlyExitReasonSet)) {
              deepTerminalReasonCount += 1
            }
          }
          if (
            args.rescueEarlyExitEnabled !== false &&
            deepPassNeeded > 0 &&
            deepPassCount <= 0 &&
            deepInspected >= deepEarlyExitNoPassMinEval
          ) {
            const terminalRatio = deepTerminalReasonCount / deepInspected
            const reachedNoPassCap =
              deepInspected >= Math.max(1, rescueEarlyExitNoPassMaxEval)
            if (
              terminalRatio >= rescueEarlyExitTerminalReasonRatio ||
              reachedNoPassCap
            ) {
              deepStoppedByEarlyExit = true
              break
            }
          }
          if (
            args.rescueLogEvery > 0 &&
            deepInspected % Math.max(1, Number(args.rescueLogEvery) || 1) === 0
          ) {
            console.log(
              `[go-live-sharded] rescue deep progress track=${track} evaluated=${deepInspected}/${deepInspect.length} pass=${deepPassCount}`,
            )
          }
        }
      } else if (needsDeepRecovery && moonshotFailDominant) {
        deepSkippedByMoonshotDominant = true
        console.log(
          `[go-live-sharded] rescue deep skipped track=${track} reason=MOONSHOT_GATE_DOMINANT fail=${moonshotFailCount}/${moonshotEvaluatedCount}`,
        )
      }
      if (quality) {
        quality.worst2wRescuePassCountDeep = deepPassCount
        quality.worst2wEffectivePassCount =
          Number(quality.worst2wGatePassCount ?? 0) +
          Number(quality.worst2wRescuePassCount ?? 0) +
          deepPassCount
        quality.rescueDeepEvaluated = deepInspected
        quality.rescueDeepTopK = deepTopK
        quality.rescueDeepDiversityGroups = deepDiversityGroups
        quality.rescueDeepEarlyExitMinEval = deepEarlyExitNoPassMinEval
        quality.rescueDeepSkippedByReason = deepSkippedByReason
        quality.rescueDeepSkippedByCap = deepSkippedByCap
        quality.rescueDeepSkippedByMoonshotDominant =
          deepSkippedByMoonshotDominant
        quality.moonshotEvaluatedCount = moonshotEvaluatedCount
        quality.moonshotFailCount = moonshotFailCount
        quality.rescueDeepTerminalReasonCount = deepTerminalReasonCount
        quality.rescueDeepStoppedByEnoughPass = deepStoppedByEnoughPass
        quality.rescueDeepStoppedByEarlyExit = deepStoppedByEarlyExit
      }
      const rescueTrackElapsedMs = Date.now() - rescueTrackStartedAtMs
      console.log(
        `[go-live-sharded] rescue done track=${track} cheapEvaluated=${cheapInspected} cheapPass=${rescuedPassCount} cheapEarlyExit=${cheapStoppedByEarlyExit ? 1 : 0} deepEvaluated=${deepInspected} deepPass=${deepPassCount} deepEarlyExit=${deepStoppedByEarlyExit ? 1 : 0} elapsedMs=${rescueTrackElapsedMs}`,
      )
      rescueDistByTrack[track] = {
        inspected: cheapInspected,
        rescuedPassCount,
        cheapStoppedByEnoughPass,
        cheapStoppedByEarlyExit,
        cheapEarlyExitNoPassMinEval,
        cheapTerminalReasonCount,
        cheapDiversityGroups: inspectSelection.diversityGroups,
        cheapTopKTarget: inspectTopK,
        deepInspected,
        deepPassCount,
        deepTerminalReasonCount,
        deepStoppedByEnoughPass,
        deepStoppedByEarlyExit,
        deepEarlyExitNoPassMinEval,
        deepDiversityGroups,
        deepTopKTarget: deepTopK,
        deepSkippedByReason,
        deepSkippedByCap,
        deepSkippedByMoonshotDominant,
        moonshotEvaluatedCount,
        moonshotFailCount,
        elapsedMs: rescueTrackElapsedMs,
        rows: rescueRows,
      }
    }
  }
  poolEntries.sort(compareCandidateRows)
  const { engineAvailabilityByTrack, engineQuotaViolationByTrack } =
    summarizeEngineQuotaCoverage({
      poolEntries,
      tracks,
      args,
    })
  for (const track of tracks) {
    const violations = engineQuotaViolationByTrack?.[track] ?? []
    if (!Array.isArray(violations) || violations.length <= 0) continue
    console.warn(
      `[go-live-sharded] engine quota violation track=${track} codes=${violations.join(",")}`,
    )
  }
  const lowQualityTracksAfterRescue = requiredTracks.filter((track) => {
    const quality = poolQualityByTrack[track]
    if (!quality) return true
    if (quality.selected < quality.minPoolRequired) return true
    if (
      Number(
        quality.worst2wEffectivePassCount ?? quality.worst2wGatePassCount,
      ) < resolveRescueTargetPassCount(quality)
    ) {
      return true
    }
    return false
  })
  let stage1QualityWarning = null
  if (lowQualityTracksAfterRescue.length) {
    const reason = `INSUFFICIENT_POOL insufficient pool quality for ${lowQualityTracksAfterRescue.join(",")}`
    const qualityReadyTracks = requiredTracks.filter(
      (track) => !lowQualityTracksAfterRescue.includes(track),
    )
    const blockOnLowQualityRequiredTracks =
      String(args.passMode ?? "all")
        .trim()
        .toLowerCase() === "all" &&
      lowQualityTracksAfterRescue.some((track) =>
        requiredTracks.includes(track),
      )
    const shouldBlockOnLowQualityRequired =
      blockOnLowQualityRequiredTracks &&
      args.allowStage2OnLowQualityRequired !== true
    if (qualityReadyTracks.length <= 0 || shouldBlockOnLowQualityRequired) {
      const moonshotGateDiagnostics = writeMoonshotGateDiagnostics({
        summaryDir,
        rows: poolEntries,
        tracks,
        context: {
          status: "INSUFFICIENT_POOL",
          phase: "POOL_QUALITY",
          reason,
        },
      })
      fs.writeFileSync(
        path.join(summaryDir, "summary.json"),
        `${JSON.stringify(
          {
            batchId,
            args,
            stage1Runs,
            stage1Candidates: allRows.length,
            poolCountByTrack: Object.fromEntries(
              tracks.map((track) => [
                track,
                poolEntries.filter((entry) => entry.track === track).length,
              ]),
            ),
            poolQualityByTrack,
            prefilter: {
              enabled: args.prefilterEnabled,
              inputRows: prefilterInputRows,
              inputRowsByTrack: Object.fromEntries(inputRowsByTrack.entries()),
              outputRows: allRows.length,
              outputRowsByTrack: Object.fromEntries(
                outputRowsByTrack.entries(),
              ),
              droppedByExcludedFingerprint,
              droppedByReason: summarizeMapCounter(prefilterCounter).top,
              droppedByReasonByTrack: summarizeCounterByTrackReason(
                prefilterCounterByTrack,
              ),
              excludedFingerprints: excludedFingerprints.size,
            },
            rescueAddedByTrack,
            rescueDistByTrack,
            moonshotPoolDiagnostics: moonshotGateDiagnostics.payload,
            moonshotPoolDiagnosticsPath: moonshotGateDiagnostics.path,
            stage2: null,
            status: "INSUFFICIENT_POOL",
            reason,
            lowQualityTracks: lowQualityTracksAfterRescue,
            qualityReadyTracks,
            blockOnLowQualityRequiredTracks,
            shouldBlockOnLowQualityRequired,
            allowStage2OnLowQualityRequired:
              args.allowStage2OnLowQualityRequired,
            passMode: args.passMode,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      throw new Error(reason)
    }
    stage1QualityWarning = {
      status: "POOL_QUALITY_DEGRADED",
      reason,
      lowQualityTracks: lowQualityTracksAfterRescue,
      qualityReadyTracks,
      continueStage2: !shouldBlockOnLowQualityRequired,
      blockOnLowQualityRequiredTracks,
      shouldBlockOnLowQualityRequired,
      allowStage2OnLowQualityRequired: args.allowStage2OnLowQualityRequired,
    }
    console.warn(
      `[go-live-sharded] stage1 quality degraded; continuing stage2 with warning lowQualityTracks=${lowQualityTracksAfterRescue.join(",")} readyTracks=${qualityReadyTracks.join(",")} passMode=${String(args.passMode ?? "all").toLowerCase()} allowStage2OnLowQualityRequired=${args.allowStage2OnLowQualityRequired ? 1 : 0}`,
    )
  }

  const poolPath = path.join(summaryDir, "candidate_pool.ndjson")
  fs.writeFileSync(
    poolPath,
    poolEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const moonshotGateDiagnostics = writeMoonshotGateDiagnostics({
    summaryDir,
    rows: poolEntries,
    tracks,
    context: {
      status: "STAGE1_READY",
      phase: "STAGE1_SUMMARY",
    },
  })
  const dailyPassRankedRowsByTrack = buildDailyPassRankedRowsByTrack({
    tracks,
    poolEntries,
    args,
  })

  const stage1Summary = {
    batchId,
    args,
    runtime: {
      stage1Parallel,
      symbolBucketTotal: bucketTotal,
      symbolBucketIndex: bucketIndex,
    },
    poolsetPolicy: {
      enabled: args.poolsetEnabled === true,
      dailyPassAvengersEnabled: args.dailyPassAvengersEnabled === true,
      dailyPassTopNByTrack: args.dailyPassTopNByTrack,
      dailyPassPoolsetCountByTrack: args.dailyPassPoolsetCountByTrack,
      dailyPassRecombineRounds: args.dailyPassRecombineRounds,
      poolsetCountByTrack: args.poolsetCountByTrack,
      poolsetCountMaxByTrack: args.poolsetCountMaxByTrack,
      poolsetActiveSizeByTrack: args.poolsetActiveSizeByTrack,
      poolsetBenchSizeByTrack: args.poolsetBenchSizeByTrack,
      poolsetMinAliveByTrack: args.poolsetMinAliveByTrack,
      poolsetRefillCountByTrack: args.poolsetRefillCountByTrack,
      stage2TopKByTrack: args.stage2TopKByTrack,
      poolEngineQuotaByTrack: args.poolEngineQuotaByTrack,
      poolsetBatchSize: args.poolsetBatchSize,
      poolsetMaxConcurrentEval: args.poolsetMaxConcurrentEval,
      poolsetStage1WindowMonths: args.poolsetStage1WindowMonths,
      poolsetStage2WindowMonths: args.poolsetStage2WindowMonths,
      poolsetEvalMode: args.poolsetEvalMode,
    },
    stage1Runs: stage1Runs.map((entry) => ({
      runId: entry.runId,
      shardIndex: entry.shardIndex,
      seed: entry.seed,
      symbolSeed: entry.symbolSeed,
      reportPath: entry.reportPath,
      status: stage1RowsByRunId.get(entry.runId)?.report?.status ?? null,
      candidatesPath: entry.candidatesPath,
      candidateRows: stage1RowsByRunId.get(entry.runId)?.rows?.length ?? 0,
    })),
    stage1Candidates: allRows.length,
    prefilter: {
      enabled: args.prefilterEnabled,
      worst2wFloor: args.prefilterWorst2wFloor,
      stopLikeCeil: args.prefilterStopLikeCeil,
      noFillCeil: args.prefilterNoFillCeil,
      inputRows: prefilterInputRows,
      inputRowsByTrack: Object.fromEntries(inputRowsByTrack.entries()),
      outputRows: allRows.length,
      outputRowsByTrack: Object.fromEntries(outputRowsByTrack.entries()),
      droppedByExcludedFingerprint,
      droppedByReason: summarizeMapCounter(prefilterCounter).top,
      droppedByReasonByTrack: summarizeCounterByTrackReason(
        prefilterCounterByTrack,
      ),
      excludedFingerprints: excludedFingerprints.size,
    },
    rescueAddedByTrack,
    rescueDistByTrack,
    moonshotPoolDiagnostics: moonshotGateDiagnostics.payload,
    moonshotPoolDiagnosticsPath: moonshotGateDiagnostics.path,
    poolPath,
    poolCount: poolEntries.length,
    poolCountByTrack: Object.fromEntries(
      tracks.map((track) => [
        track,
        poolEntries.filter((entry) => entry.track === track).length,
      ]),
    ),
    dailyPassTopByTrack: Object.fromEntries(
      tracks.map((track) => [
        track,
        (dailyPassRankedRowsByTrack.get(track) ?? [])
          .slice(0, 10)
          .map((row) => ({
            fingerprint: row?.fingerprint ?? null,
            sourceRunId: row?.sourceRunId ?? null,
            sourceRound: Number(row?.sourceRound ?? 0) || 0,
            countWeeksGE: Number(row?.metrics?.countWeeksGE ?? 0) || 0,
            dailyPassScore: Number(computeDailyPassScore(row).toFixed(4)) || 0,
          })),
      ]),
    ),
    engineAvailabilityByTrack,
    engineQuotaViolationByTrack,
    trackZeroBackfillByTrack,
    engineQuotaBackfillByTrack,
    poolQualityByTrack,
    poolDiversityByTrack,
    stage1MissingTrackWarning,
    stage1QualityWarning,
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(
    path.join(summaryDir, "stage1_summary.json"),
    `${JSON.stringify(stage1Summary, null, 2)}\n`,
    "utf8",
  )
  console.log(
    `[go-live-sharded] stage1 summary written poolCount=${poolEntries.length} summaryDir=${summaryDir}`,
  )

  if (args.stage1Only) {
    console.log("[go-live-sharded] stage1-only complete")
    console.log(`[go-live-sharded] candidate pool: ${poolPath}`)
    return
  }

  const stage2RunIdBase = `${batchId}_S2_${args.apply ? "APPLY" : "DRY"}`
  const stage2Seed = args.seedStart + args.shards + 1
  const stage2SymbolSeed = `${args.symbolSeedBase}:S2`
  let effectiveStage2Tracks = tracks.slice()
  if (
    stage1MissingTrackWarning?.continueStage2 === true &&
    Array.isArray(stage1MissingTrackWarning?.availableRequiredTracks)
  ) {
    const allowed = new Set(stage1MissingTrackWarning.availableRequiredTracks)
    effectiveStage2Tracks = effectiveStage2Tracks.filter((track) =>
      allowed.has(track),
    )
  }
  if (Array.isArray(stage1QualityWarning?.qualityReadyTracks)) {
    const ready = new Set(stage1QualityWarning.qualityReadyTracks)
    effectiveStage2Tracks = effectiveStage2Tracks.filter((track) =>
      ready.has(track),
    )
  }
  const optionalStage2TracksDropped = []
  if (effectiveStage2Tracks.length > 0) {
    const requiredTrackSet = new Set(requiredTracks)
    for (const track of effectiveStage2Tracks) {
      if (requiredTrackSet.has(track)) continue
      const trackEntries = poolEntries.filter((entry) => entry.track === track)
      if (trackEntries.length > 0) continue
      optionalStage2TracksDropped.push(track)
    }
    if (optionalStage2TracksDropped.length > 0) {
      const droppedSet = new Set(optionalStage2TracksDropped)
      effectiveStage2Tracks = effectiveStage2Tracks.filter(
        (track) => !droppedSet.has(track),
      )
      console.warn(
        `[go-live-sharded] stage2 optional tracks dropped due empty pool tracks=${optionalStage2TracksDropped.join(",")}`,
      )
    }
  }
  if (!effectiveStage2Tracks.length) {
    throw new Error(
      "INSUFFICIENT_POOL no stage2-ready tracks after stage1 degradation handling",
    )
  }
  const stage2RequiredTracks = requiredTracks.filter((track) =>
    effectiveStage2Tracks.includes(track),
  )
  const stage2PoolDir = path.join(summaryDir, "poolsets")
  fs.mkdirSync(stage2PoolDir, { recursive: true })
  const stage2PoolSets = args.poolsetEnabled
    ? buildPoolSets({
        batchId,
        tracks: effectiveStage2Tracks,
        requiredTracks: stage2RequiredTracks,
        poolEntries,
        args,
      })
    : [
        {
          poolSetId: `${batchId}:POOLSET:LEGACY`,
          entries: poolEntries.filter((entry) =>
            effectiveStage2Tracks.includes(
              String(entry?.track ?? "")
                .trim()
                .toUpperCase(),
            ),
          ),
          countByTrack: Object.fromEntries(
            effectiveStage2Tracks.map((track) => [
              track,
              poolEntries.filter((entry) => entry.track === track).length,
            ]),
          ),
          missingRequiredTracks: [],
          valid: true,
        },
      ]
  if (!stage2PoolSets.length) {
    throw new Error("INSUFFICIENT_POOL no stage2 poolset candidates")
  }
  const stage2PoolSetsById = new Map(
    stage2PoolSets.map((row) => [String(row.poolSetId), row]),
  )
  const stage2PoolSetSignatureById = new Map()
  const dailyPassPoolSetIds = []
  const dailyPassPoolSets =
    args.dailyPassAvengersEnabled === true
      ? buildDailyPassPoolSets({
          batchId,
          tracks: effectiveStage2Tracks,
          requiredTracks: stage2RequiredTracks,
          poolEntries,
          args,
        })
      : []
  for (const poolSet of dailyPassPoolSets) {
    const id = String(poolSet?.poolSetId ?? "").trim()
    if (!id || stage2PoolSetsById.has(id)) continue
    stage2PoolSetsById.set(id, poolSet)
    dailyPassPoolSetIds.push(id)
  }
  const stage2ResultCachePath = resolveStage2ResultCachePath({ rootDir })
  const stage2ResultCacheMap =
    args.stage2ResultCacheEnabled === true
      ? loadStage2ResultCache({
          cachePath: stage2ResultCachePath,
          ttlSec: args.stage2ResultCacheTtlSec,
        })
      : new Map()

  const buildStage2Args = ({ runId, candidatePoolPath, dryRun }) => {
    const out = [
      "scripts/autosearch/go_live_autosearch.mjs",
      `--runId=${runId}`,
      `--asof=${args.asOfInput}`,
      `--tracks=${effectiveStage2Tracks.join(",")}`,
      `--passMode=${args.passMode}`,
      `--moonshotTrackRequiredForCorePass=${args.moonshotTrackRequiredForCorePass ? 1 : 0}`,
      "--stage=stage2",
      `--candidatePoolPath=${candidatePoolPath}`,
      `--targetPct=${args.targetPct}`,
      `--minWorst2wAvgPct=${args.minWorst2wAvgPct}`,
      `--highWeekPct=${args.highWeekPct}`,
      `--minHighWeeks=${args.minHighWeeks}`,
      `--nearHighWeeks=${args.nearHighWeeks}`,
      `--minOtherWeekPct=${args.minOtherWeekPct}`,
      `--requireCompletedTradesEveryWeek=${args.requireCompletedTradesEveryWeek}`,
      `--maxRounds=${args.stage2MaxRounds}`,
      `--plateauRounds=${args.stage2PlateauRounds}`,
      `--seed=${stage2Seed}`,
      `--symbolSeed=${stage2SymbolSeed}`,
      `--symbolBucketTotal=${bucketTotal}`,
      `--symbolBucketIndex=${bucketIndex}`,
      `--printEvery=${args.printEvery}`,
    ]
    if (dryRun) {
      out.push("--dryRun=1")
    }
    return out
  }

  let stage2EvalCursor = 0
  let stage2ExecCount = 0
  let stage2CacheHitCount = 0
  let stage2DuplicateSkipCount = 0
  const stage2EvalStartedAtMs = Date.now()
  let firstStage2PassElapsedSec = null
  const stage2SignatureResultMap = new Map()
  const evaluatePoolSet = async ({ poolSet }) => {
    const poolSetId = String(poolSet?.poolSetId ?? "").trim()
    const stage2CacheKey = buildPoolSetSignature({
      poolSet,
      args,
      effectiveTracks: effectiveStage2Tracks,
      requiredTracks: stage2RequiredTracks,
    })
    if (poolSetId && stage2CacheKey) {
      stage2PoolSetSignatureById.set(poolSetId, stage2CacheKey)
    }
    if (
      args.stage2SkipDuplicatePoolSetSignature === true &&
      stage2CacheKey &&
      stage2SignatureResultMap.has(stage2CacheKey)
    ) {
      stage2DuplicateSkipCount += 1
      const baseResult = stage2SignatureResultMap.get(stage2CacheKey)
      return {
        ...cloneJson(baseResult),
        poolSetId,
        runId: `${stage2RunIdBase}_DUP_${String(stage2DuplicateSkipCount).padStart(2, "0")}`,
        evaluationSource: "DUPLICATE_SKIP",
        duplicateOfPoolSetId:
          String(baseResult?.poolSetId ?? "").trim() || null,
        stage2CacheKey,
      }
    }
    if (args.stage2ResultCacheEnabled === true && stage2CacheKey) {
      const cached = stage2ResultCacheMap.get(stage2CacheKey)
      if (cached?.value && typeof cached.value === "object") {
        stage2CacheHitCount += 1
        const cachedResult = {
          ...cloneJson(cached.value),
          poolSetId,
          runId: `${stage2RunIdBase}_HIT_${String(stage2CacheHitCount).padStart(2, "0")}`,
          evaluationSource: "CACHE_HIT",
          duplicateOfPoolSetId: null,
          stage2CacheKey,
        }
        stage2SignatureResultMap.set(stage2CacheKey, cachedResult)
        if (
          cachedResult?.passFinal === true &&
          firstStage2PassElapsedSec === null
        ) {
          firstStage2PassElapsedSec = Number(
            ((Date.now() - stage2EvalStartedAtMs) / 1000).toFixed(3),
          )
        }
        return cachedResult
      }
    }
    const evalIndex = stage2EvalCursor
    stage2EvalCursor += 1
    const runId = `${stage2RunIdBase}_PS${String(evalIndex + 1).padStart(2, "0")}`
    const candidatePoolPath = path.join(
      stage2PoolDir,
      `${String(evalIndex + 1).padStart(2, "0")}_${poolSet.poolSetId.replace(/[^A-Za-z0-9:_-]/g, "_")}.ndjson`,
    )
    const resolvedPoolSetId = poolSetId
    if (!resolvedPoolSetId) {
      const error = new Error(
        "POLICY_CONFLICT_BLOCKED stage2 export requires poolSetId",
      )
      error.code = "POLICY_CONFLICT_BLOCKED"
      throw error
    }
    const poolSetEntries = (poolSet.entries ?? []).map((entry) => ({
      ...(entry ?? {}),
      poolSetId: resolvedPoolSetId,
    }))
    fs.writeFileSync(
      candidatePoolPath,
      poolSetEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8",
    )
    console.log(
      `[go-live-sharded] stage2 poolset eval runId=${runId} poolSetId=${poolSet.poolSetId} entries=${poolSet.entries.length}`,
    )
    stage2ExecCount += 1
    runChild(buildStage2Args({ runId, candidatePoolPath, dryRun: true }))
    const reportPath = path.join(
      rootDir,
      "artifacts",
      "autosearch",
      runId,
      "final_report.json",
    )
    const report = readJsonSafe(reportPath)
    const result = summarizeStage2Result({
      runId,
      poolSetId: poolSet.poolSetId,
      reportPath,
      report,
      requiredTracks: stage2RequiredTracks,
    })
    result.dailyPassCompositeScore =
      computeDailyPassCompositeScore(poolSetEntries)
    result.evaluationSource = "EXECUTED"
    result.duplicateOfPoolSetId = null
    result.stage2CacheKey = stage2CacheKey || null
    if (result?.passFinal === true && firstStage2PassElapsedSec === null) {
      firstStage2PassElapsedSec = Number(
        ((Date.now() - stage2EvalStartedAtMs) / 1000).toFixed(3),
      )
    }
    if (stage2CacheKey) {
      stage2SignatureResultMap.set(stage2CacheKey, result)
      if (args.stage2ResultCacheEnabled === true) {
        stage2ResultCacheMap.set(stage2CacheKey, {
          updatedAt: new Date().toISOString(),
          value: {
            ...cloneJson(result),
            runId: null,
          },
        })
      }
    }
    return result
  }

  const stage2PoolResults = []
  const stage2RecombinedPoolSetIds = []
  let stage2ContinuedAfterFirstPass = false
  let stage2PassObserved = false
  let stage2CoverageBlockedEarlyStop = false
  const poolsetBatchStep = Math.max(
    1,
    Math.min(
      Number(args.poolsetBatchSize ?? 1) || 1,
      Number(args.poolsetMaxConcurrentEval ?? 1) || 1,
    ),
  )
  const evaluatePoolSetBatch = async (poolSets) => {
    let stoppedEarly = false
    for (
      let batchStart = 0;
      batchStart < poolSets.length;
      batchStart += poolsetBatchStep
    ) {
      const batch = poolSets.slice(batchStart, batchStart + poolsetBatchStep)
      for (let idx = 0; idx < batch.length; idx += 1) {
        const result = await evaluatePoolSet({
          poolSet: batch[idx],
        })
        stage2PoolResults.push(result)
        if (
          isCoverageBlockedStage2Result({
            result,
            requiredTracks: stage2RequiredTracks,
          })
        ) {
          stage2CoverageBlockedEarlyStop = true
          stoppedEarly = true
          break
        }
        if (result?.passFinal === true) {
          if (
            stage2PassObserved &&
            args.stage2ContinueAfterFirstPass === true
          ) {
            stage2ContinuedAfterFirstPass = true
          }
          stage2PassObserved = true
        }
        if (
          result?.passFinal === true &&
          args.stage2ContinueAfterFirstPass !== true
        ) {
          stoppedEarly = true
          break
        }
      }
      if (stoppedEarly) {
        break
      }
    }
    return { stoppedEarly }
  }

  const initialPoolSets = orderPoolSetsForStage2({
    poolSets: Array.from(stage2PoolSetsById.values()),
    poolSetsById: stage2PoolSetsById,
    scheduleMode: args.stage2ScheduleMode,
    championDiscoveryBudgetSplit: args.championDiscoveryBudgetSplit,
  })
  const initialEval = await evaluatePoolSetBatch(initialPoolSets)
  if (args.poolsetEnabled && initialEval.stoppedEarly !== true) {
    const maxRecombineRounds = Math.max(
      1,
      Number(args.dailyPassRecombineRounds ?? 2) || 2,
    )
    for (
      let recombineRound = 1;
      recombineRound <= maxRecombineRounds;
      recombineRound += 1
    ) {
      const recombinedSets = buildRecombinedPoolSets({
        batchId,
        tracks: effectiveStage2Tracks,
        requiredTracks: stage2RequiredTracks,
        args,
        evaluatedPoolSetsById: stage2PoolSetsById,
        stage2PoolResults,
        recombineRound,
      })
      if (recombinedSets.length <= 0) {
        break
      }
      for (const poolSet of recombinedSets) {
        stage2PoolSetsById.set(String(poolSet.poolSetId), poolSet)
        stage2RecombinedPoolSetIds.push(String(poolSet.poolSetId))
      }
      const recombinedEval = await evaluatePoolSetBatch(
        orderPoolSetsForStage2({
          poolSets: recombinedSets,
          poolSetsById: stage2PoolSetsById,
          scheduleMode: args.stage2ScheduleMode,
          championDiscoveryBudgetSplit: args.championDiscoveryBudgetSplit,
        }),
      )
      if (recombinedEval.stoppedEarly === true) {
        break
      }
    }
  }
  if (args.stage2ResultCacheEnabled === true) {
    saveStage2ResultCache({
      cachePath: stage2ResultCachePath,
      cacheMap: stage2ResultCacheMap,
    })
  }
  stage2PoolResults.sort(comparePoolSetResults)
  const stage2PassCount = stage2PoolResults.filter(
    (row) => row?.passFinal === true,
  ).length
  const stage2TotalCount = Math.max(1, stage2PoolResults.length)
  const stage2PassDensity = stage2PassCount / stage2TotalCount
  const stage2TerminalCount = stage2PoolResults.filter(
    (row) => row?.passFinal !== true,
  ).length
  const stage2TerminalRatio = stage2TerminalCount / stage2TotalCount
  const stage2PeakRamMb = stage2PoolResults.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.peakRamMb ?? 0) || 0),
    0,
  )
  const stage2CacheHitRate =
    stage2ExecCount + stage2CacheHitCount > 0
      ? stage2CacheHitCount / (stage2ExecCount + stage2CacheHitCount)
      : 0
  const stage2SchedulerReasonCodes = []
  if (
    String(args.stage2ScheduleMode ?? "").toLowerCase() === "champion_first"
  ) {
    stage2SchedulerReasonCodes.push("SCHEDULER_CHAMPION_FIRST")
  }
  if (stage2CoverageBlockedEarlyStop) {
    stage2SchedulerReasonCodes.push("EARLY_STOP_DATA_COVERAGE_BLOCKED")
  }
  if (stage2ContinuedAfterFirstPass) {
    stage2SchedulerReasonCodes.push("CONTINUATION_AFTER_FIRST_PASS")
  }
  const championPassCount = stage2PoolResults.filter((row) => {
    if (row?.passFinal !== true) return false
    const source = String(
      stage2PoolSetsById.get(String(row?.poolSetId ?? ""))?.source ?? "",
    )
      .trim()
      .toUpperCase()
    return source.startsWith("CHAMPION")
  }).length
  const discoveryPassCount = Math.max(0, stage2PassCount - championPassCount)
  const championVsDiscoveryPassShare = {
    championPassCount,
    discoveryPassCount,
    championShare:
      stage2PassCount > 0 ? championPassCount / stage2PassCount : 0,
    discoveryShare:
      stage2PassCount > 0 ? discoveryPassCount / stage2PassCount : 0,
  }
  const selectedPoolSetResult = stage2PoolResults[0] ?? null
  let selectedStage2Result = selectedPoolSetResult
  let applyFinalResult = null
  if (args.apply && selectedPoolSetResult?.passFinal === true) {
    const selectedPoolSet = stage2PoolSetsById.get(
      String(selectedPoolSetResult.poolSetId ?? ""),
    )
    if (selectedPoolSet) {
      const finalRunId = `${stage2RunIdBase}_FINAL`
      const finalPoolPath = path.join(
        stage2PoolDir,
        `final_${selectedPoolSet.poolSetId.replace(/[^A-Za-z0-9:_-]/g, "_")}.ndjson`,
      )
      const finalPoolSetId = String(selectedPoolSet?.poolSetId ?? "").trim()
      if (!finalPoolSetId) {
        const error = new Error(
          "POLICY_CONFLICT_BLOCKED stage2 final export requires poolSetId",
        )
        error.code = "POLICY_CONFLICT_BLOCKED"
        throw error
      }
      const finalPoolEntries = (selectedPoolSet.entries ?? []).map((entry) => ({
        ...(entry ?? {}),
        poolSetId: finalPoolSetId,
      }))
      fs.writeFileSync(
        finalPoolPath,
        finalPoolEntries.map((entry) => JSON.stringify(entry)).join("\n") +
          "\n",
        "utf8",
      )
      console.log(
        `[go-live-sharded] stage2 apply runId=${finalRunId} selectedPoolSetId=${selectedPoolSet.poolSetId}`,
      )
      runChild(
        buildStage2Args({
          runId: finalRunId,
          candidatePoolPath: finalPoolPath,
          dryRun: false,
        }),
      )
      const finalReportPath = path.join(
        rootDir,
        "artifacts",
        "autosearch",
        finalRunId,
        "final_report.json",
      )
      const finalReport = readJsonSafe(finalReportPath)
      applyFinalResult = summarizeStage2Result({
        runId: finalRunId,
        poolSetId: selectedPoolSet.poolSetId,
        reportPath: finalReportPath,
        report: finalReport,
        requiredTracks: stage2RequiredTracks,
      })
      selectedStage2Result = applyFinalResult
    }
  }
  const stage2ReportPath = String(selectedStage2Result?.reportPath ?? "").trim()
  const summary = {
    batchId,
    args,
    runtime: {
      stage1Parallel,
      symbolBucketTotal: bucketTotal,
      symbolBucketIndex: bucketIndex,
    },
    stage1SummaryPath: path.join(summaryDir, "stage1_summary.json"),
    poolPath,
    poolCount: poolEntries.length,
    engineAvailabilityByTrack,
    engineQuotaViolationByTrack,
    stage1MissingTrackWarning,
    stage1QualityWarning,
    stage2: {
      runId: selectedStage2Result?.runId ?? null,
      effectiveTracks: effectiveStage2Tracks,
      optionalTracksDropped: optionalStage2TracksDropped,
      seed: stage2Seed,
      symbolSeed: stage2SymbolSeed,
      reportPath: stage2ReportPath || null,
      status: selectedStage2Result?.status ?? null,
      selectionSource: selectedStage2Result?.selectionSource ?? null,
      selectedPoolSetId: selectedStage2Result?.poolSetId ?? null,
      passFinal: selectedStage2Result?.passFinal === true,
      requiredPassCount:
        Number(selectedStage2Result?.requiredPassCount ?? 0) || 0,
      requiredTrackCount:
        Number(selectedStage2Result?.requiredTrackCount ?? 0) || 0,
      missingRequiredTracks:
        selectedStage2Result?.missingRequiredTracks ?? stage2RequiredTracks,
      selectedPoolSetByTrack:
        selectedStage2Result?.selectedPoolSetByTrack ?? {},
      lockboxPassByTrack: selectedStage2Result?.lockboxPassByTrack ?? {},
      poolSetsEvaluated: stage2PoolResults.length,
      dailyPassPoolSetsEvaluated: dailyPassPoolSetIds.length,
      dailyPassPoolSetIds,
      dailyPassRecombineRounds: Math.max(
        1,
        Number(args.dailyPassRecombineRounds ?? 2) || 2,
      ),
      passDensity: Number(stage2PassDensity.toFixed(6)),
      terminalRatio: Number(stage2TerminalRatio.toFixed(6)),
      peakRamMb: Number(stage2PeakRamMb.toFixed(3)),
      timeToFirstPassSec:
        Number.isFinite(firstStage2PassElapsedSec) &&
        firstStage2PassElapsedSec !== null
          ? firstStage2PassElapsedSec
          : null,
      stage2ExecCount,
      stage2CacheHitCount,
      stage2CacheHitRate: Number(stage2CacheHitRate.toFixed(6)),
      duplicateSkipCount: stage2DuplicateSkipCount,
      scheduleMode: args.stage2ScheduleMode,
      continueAfterFirstPass: args.stage2ContinueAfterFirstPass === true,
      schedulerReasonCodes: stage2SchedulerReasonCodes,
      championDiscoveryBudgetSplit: args.championDiscoveryBudgetSplit,
      cacheEnabled: args.stage2ResultCacheEnabled === true,
      championVsDiscoveryPassShare,
      recombinedPoolSetsEvaluated: stage2RecombinedPoolSetIds.length,
      recombinedPoolSetIds: stage2RecombinedPoolSetIds,
      poolsetBatchStep,
      poolSetResults: stage2PoolResults.map((row) => ({
        runId: row.runId,
        poolSetId: row.poolSetId,
        source:
          stage2PoolSetsById.get(String(row.poolSetId ?? ""))?.source ??
          "UNKNOWN",
        status: row.status,
        passFinal: row.passFinal,
        requiredPassCount: row.requiredPassCount,
        requiredTrackCount: row.requiredTrackCount,
        totalPassCount: row.totalPassCount,
        peakRamMb: Number(row.peakRamMb ?? 0) || 0,
        dailyPassCompositeScore: Number(row.dailyPassCompositeScore ?? 0) || 0,
        evaluationSource:
          String(row.evaluationSource ?? "EXECUTED").trim() || "EXECUTED",
        duplicateOfPoolSetId:
          String(row.duplicateOfPoolSetId ?? "").trim() || null,
        stage2CacheKey: String(row.stage2CacheKey ?? "").trim() || null,
        missingRequiredTracks: row.missingRequiredTracks,
        reportPath: row.reportPath,
        poolSetSignature:
          stage2PoolSetSignatureById.get(String(row.poolSetId ?? "")) ?? null,
        parentPoolSetIds:
          stage2PoolSetsById.get(String(row.poolSetId ?? ""))
            ?.parentPoolSetIds ?? [],
        memberOrigins:
          stage2PoolSetsById.get(String(row.poolSetId ?? ""))?.memberOrigins ??
          [],
        countByTrack:
          stage2PoolSetsById.get(String(row.poolSetId ?? ""))?.countByTrack ??
          {},
        engineMixByTrack:
          stage2PoolSetsById.get(String(row.poolSetId ?? ""))
            ?.engineMixByTrack ?? {},
      })),
      applyFinalRun:
        applyFinalResult && args.apply
          ? {
              runId: applyFinalResult.runId,
              reportPath: applyFinalResult.reportPath,
              status: applyFinalResult.status,
              passFinal: applyFinalResult.passFinal,
            }
          : null,
    },
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(
    path.join(summaryDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  )
  console.log(`[go-live-sharded] done. summary: ${summaryDir}`)
}

run().catch((error) => {
  console.error("[go-live-sharded] failed", error)
  process.exitCode = 1
})
