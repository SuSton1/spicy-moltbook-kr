import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import os from "node:os"
import v8 from "node:v8"
import readline from "node:readline"
import { spawnSync } from "node:child_process"
import dotenv from "dotenv"

import { PrismaClient } from "@prisma/client"

import {
  normalizeDateKey,
  shiftDateKeyByMonths,
} from "../ai-date-range.lib.mjs"
import {
  buildWeeklySeries,
  buildWeeklyMetrics,
  countNoFillResults,
  computeBigUpMetrics,
  runBacktest,
} from "../lib/backtest.mjs"
import {
  attachTrainRangeLabel,
  attachRegimeTag,
  selectPatternVersionLabel,
} from "../lib/patternVersions.mjs"
import { filterCandlesToPrevTradingDay } from "../lib/gap15.mjs"
import { buildLevelPlan, DEFAULT_LEVEL_POLICY } from "../lib/levelPolicy.mjs"
import { eligibleSymbolsForDate } from "../lib/eligibleSymbols.mjs"
import { resolveMarketRegimeForDate } from "../lib/marketRegimeDay.mjs"
import { recommendFromData } from "../lib/recommend.mjs"
import { isTradableAt1500 } from "../lib/tradability15.mjs"
import {
  isLastTradingDayToken,
  resolveLastTradingDateKey,
  resolveAsOfDateKey,
  resolveTradingCalendarRange,
  resolveTodayKstDateKey,
} from "../lib/tradingCalendar.mjs"
import { listWeekKeys, resolveValidationLockbox } from "../lib/weekWindow.mjs"
import {
  resolveTrainTestRanges,
  trainPatternsFromData,
} from "../lib/patternTraining.mjs"
import { isKrSixDigitSymbol } from "../lib/symbolMaster.mjs"
import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"
import {
  assertGapPatternSafe,
  buildGapDataForDate,
  resolvePrevTradingDay,
} from "./gapLookahead.mjs"
import {
  advanceTargetIfPassed,
  buildRng,
  evaluateWeeklySummary,
  guardLockboxPatterns,
  hashToVersion,
  invokeActivation,
  resolveRampCostModel,
  shouldTerminateSearch,
  updateBestState,
  updateFailStreak,
  updatePlateau,
} from "./lib.mjs"
import { computeMoonshot4wStats } from "./moonshot4wValidation.mjs"
import { pickPrimaryFailureReason } from "./failureReason.mjs"

const rootDir = process.cwd()
let runFailureContext = null
const FINAL_REPORT_SCHEMA_VERSION = "autosearch_final_report_v2"
const MOONSHOT_GATE_SCOPE = "validation_lockbox_deploy"
const MOONSHOT_GATE_FAILED = "MOONSHOT_GATE_FAILED"
const MOONSHOT_WINDOW_CACHE_MAX = 2000
const MAX_AUTSEARCH_RUN_ID_LEN = 64
const DEFAULT_RAMP_ASOF_DATE_KEY = "2026-02-13"
const moonshotWindowCache = new Map()
const FIXED_WINDOW_MONTHS = Object.freeze({
  trainMonths: 62, // 5y2m
  testMonths: 4, // validation span in month units
  validationWeeks: 16, // ~4m
  lockboxWeeks: 16, // ~4m
  historyMonths: 70, // train + validation + lockbox
})

const normalizeEngineType = (value) => {
  const token = String(value ?? "")
    .trim()
    .toLowerCase()
  return token === "chart" ? "chart" : "rule"
}

const resolveEntryEngineType = (entry) => {
  if (!entry || typeof entry !== "object") {
    return "rule"
  }
  return normalizeEngineType(
    entry.engineType ??
      entry.patternChoice?.engineType ??
      entry.policyChoice?.engineType,
  )
}

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  candidates.forEach((file) => {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  })
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => getArgValue(args, key)
  const toNumber = (key, fallback) => {
    const parsed = parseNumberArg(getValue(key))
    return parsed ?? fallback
  }
  const toBoundedInt = (value, fallback, min, max) => {
    const n = Number(value)
    if (!Number.isFinite(n)) {
      return fallback
    }
    return Math.max(min, Math.min(max, Math.floor(n)))
  }
  const toBoundedNumber = (value, fallback, min, max) => {
    const n = Number(value)
    if (!Number.isFinite(n)) {
      return fallback
    }
    return Math.max(min, Math.min(max, n))
  }
  const evalWeeks = FIXED_WINDOW_MONTHS.validationWeeks
  const dryRunValue = toNumber("--dryRun", null)
  const dryRun = hasFlag(args, "--dryRun") || dryRunValue === 1
  const maxRoundsRaw = toNumber("--maxRounds", null)
  const maxRounds = Number.isFinite(maxRoundsRaw)
    ? maxRoundsRaw
    : dryRun
      ? 1
      : null
  const targetStartRaw = toNumber("--targetPct", 5)
  const targetStart = Number.isFinite(targetStartRaw) ? targetStartRaw : 5
  const runIdRaw = String(getValue("--runId") ?? "").trim()
  const runId = runIdRaw || null
  const rawAsOfInput = getValue("--asof") ?? getValue("--asOf")
  const evalWeeksRaw = toNumber(
    "--evalWeeks",
    FIXED_WINDOW_MONTHS.validationWeeks,
  )
  const rawSymbolSeed = String(getValue("--symbolSeed") ?? "").trim()
  const symbolSeed = rawSymbolSeed || null
  const stageRaw = String(getValue("--stage") ?? "stage2")
    .trim()
    .toLowerCase()
  const stage = stageRaw === "stage1" ? "stage1" : "stage2"
  const symbolShardTotal = toNumber("--symbolShardTotal", 1)
  const symbolShardIndex = toNumber("--symbolShardIndex", 0)
  const symbolBucketTotal = toNumber("--symbolBucketTotal", 1)
  const symbolBucketIndex = toNumber("--symbolBucketIndex", 0)
  const rawCandidatePoolPath = String(
    getValue("--candidatePoolPath") ?? "",
  ).trim()
  const candidatePoolPath = rawCandidatePoolPath || null
  const highWeekPct = toBoundedNumber(toNumber("--highWeekPct", 10), 10, 0, 100)
  const minHighWeeks = toBoundedInt(
    toNumber("--minHighWeeks", 12),
    12,
    0,
    evalWeeks,
  )
  const minOtherWeekPct = toBoundedNumber(
    toNumber("--minOtherWeekPct", 0.01),
    0.01,
    0,
    200,
  )
  const requireCompletedTradesEveryWeek = toBoundedInt(
    toNumber("--requireCompletedTradesEveryWeek", 1),
    1,
    1,
    20,
  )
  const minWorst2wAvgPct = toBoundedNumber(
    toNumber("--minWorst2wAvgPct", -1.5),
    -1.5,
    -100,
    100,
  )
  const nearHighWeeks = toBoundedInt(
    toNumber("--nearHighWeeks", 11),
    11,
    0,
    evalWeeks,
  )
  const stage2FailFastEnabled =
    toBoundedInt(
      toNumber("--stage2FailFastEnabled", stage === "stage2" ? 1 : 0),
      stage === "stage2" ? 1 : 0,
      0,
      1,
    ) === 1
  const stage2FailFastMinRounds = toBoundedInt(
    toNumber("--stage2FailFastMinRounds", 120),
    120,
    20,
    2000,
  )
  const stage2FailFastWorst2wGap = toBoundedNumber(
    toNumber("--stage2FailFastWorst2wGap", 4.0),
    4.0,
    0.5,
    50,
  )
  const stage2FailFastMaxCountWeeksGE = toBoundedInt(
    toNumber("--stage2FailFastMaxCountWeeksGE", 2),
    2,
    0,
    evalWeeks,
  )
  const moonshotTrackRequiredForCorePass =
    toBoundedInt(toNumber("--moonshotTrackRequiredForCorePass", 0), 0, 0, 1) ===
    1
  return {
    runId,
    tracks: String(getValue("--tracks") ?? "SURGE_EOD,GAP_15_BET,MOONSHOT"),
    evalWeeks,
    evalWeeksRaw,
    highWeekPct,
    minHighWeeks,
    minOtherWeekPct,
    requireCompletedTradesEveryWeek,
    minWorst2wAvgPct,
    nearHighWeeks,
    stage2FailFastEnabled,
    stage2FailFastMinRounds,
    stage2FailFastWorst2wGap,
    stage2FailFastMaxCountWeeksGE,
    plateauRounds: toNumber("--plateauRounds", 200),
    improveEpsHighWeeks: toNumber("--improveEpsHighWeeks", 1),
    improveEpsSumPct: toNumber("--improveEpsSumPct", 5.0),
    seed: String(getValue("--seed") ?? "1"),
    symbolSeed: symbolSeed ?? String(getValue("--seed") ?? "1"),
    symbolShardTotal: Number.isFinite(symbolShardTotal) ? symbolShardTotal : 1,
    symbolShardIndex: Number.isFinite(symbolShardIndex) ? symbolShardIndex : 0,
    symbolBucketTotal: Number.isFinite(symbolBucketTotal)
      ? symbolBucketTotal
      : 1,
    symbolBucketIndex: Number.isFinite(symbolBucketIndex)
      ? symbolBucketIndex
      : 0,
    stage,
    candidatePoolPath,
    printEvery: toNumber("--printEvery", 1),
    asOfInput: String(rawAsOfInput ?? DEFAULT_RAMP_ASOF_DATE_KEY),
    asOfExplicit: rawAsOfInput !== null,
    passMode: String(getValue("--passMode") ?? "all")
      .trim()
      .toLowerCase(),
    moonshotTrackRequiredForCorePass,
    targetStart,
    dryRun,
    maxRounds,
  }
}

const resolveDataMode = () => {
  const raw = String(
    process.env.DATA_MODE ??
      process.env.E2E_DATA_MODE ??
      process.env.VITE_DATA_MODE ??
      "live",
  )
    .trim()
    .toLowerCase()
  if (raw.includes("contract") || raw.includes("fixture")) {
    return "contract"
  }
  return "live"
}

const pickTracks = (raw) =>
  raw
    .split(",")
    .map((item) =>
      String(item ?? "")
        .trim()
        .toUpperCase(),
    )
    .filter(
      (item) =>
        item === "SURGE_EOD" || item === "GAP_15_BET" || item === "MOONSHOT",
    )

const createRunId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 12)
  }
  return `run_${Date.now().toString(36)}`
}

const parseBooleanEnv = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const maxDateKey = (current, candidate) => {
  const normalized = normalizeDateKey(candidate)
  if (!normalized) {
    return current
  }
  if (!current || normalized > current) {
    return normalized
  }
  return current
}

const PATTERN_DB_TRACKS = new Set(["SURGE_EOD", "GAP_15_BET"])
const usesPatternDb = (track) =>
  PATTERN_DB_TRACKS.has(
    String(track ?? "")
      .trim()
      .toUpperCase(),
  )

const resolveLatestMarketDataDateKey = async (prisma) => {
  const [adjustedDateKey, candleDateKey, price15DateKey] = await Promise.all([
    prisma.candleDailyAdjusted
      .findFirst({
        orderBy: { dateKey: "desc" },
        select: { dateKey: true },
      })
      .then((row) => row?.dateKey ?? null)
      .catch(() => null),
    prisma.candleDaily
      .findFirst({
        orderBy: { dateKey: "desc" },
        select: { dateKey: true },
      })
      .then((row) => row?.dateKey ?? null)
      .catch(() => null),
    prisma.price15
      .findFirst({
        orderBy: { tradingDateKey: "desc" },
        select: { tradingDateKey: true },
      })
      .then((row) => row?.tradingDateKey ?? null)
      .catch(() => null),
  ])
  let latest = null
  latest = maxDateKey(latest, adjustedDateKey)
  latest = maxDateKey(latest, candleDateKey)
  latest = maxDateKey(latest, price15DateKey)
  return latest
}

const clampInt = (value, fallback, min, max) => {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

const clampRatio = (value, fallback) => {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(0, Math.min(1, raw))
}

const clampNumber = (value, fallback, min, max) => {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, raw))
}

const capNumberList = (values, cap, fallback) => {
  const list = (values ?? []).filter(
    (value) => Number.isFinite(value) && value > 0 && value <= cap,
  )
  if (list.length) return list
  return [Math.max(1, Math.min(cap, fallback))]
}

const incrementMapCounter = (targetMap, key) => {
  const safeKey = String(key ?? "UNKNOWN").trim() || "UNKNOWN"
  const prev = Number(targetMap.get(safeKey) ?? 0) || 0
  targetMap.set(safeKey, prev + 1)
}

const summarizeMapCounter = (targetMap, limit = 30) => {
  const entries = Array.from(targetMap.entries()).map(([reason, count]) => ({
    reason,
    count: Number(count ?? 0) || 0,
  }))
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.reason.localeCompare(b.reason)
  })
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 30))
  const top = entries.slice(0, safeLimit)
  return {
    totalKinds: entries.length,
    totalCount: entries.reduce((acc, row) => acc + row.count, 0),
    top,
  }
}

const evaluateValidationEarlyGate = ({
  diagnostics,
  validationTradeGatePass,
  minValidationTrades,
  weekSeries,
  evalWeeks,
  config,
}) => {
  const gateConfig = config ?? {}
  const enabled = gateConfig.enabled !== false
  if (!enabled) {
    return {
      enabled: false,
      pass: true,
      reasons: [],
      metrics: {
        disabled: true,
      },
    }
  }
  const signalsCount = Number(diagnostics?.signalsCount ?? 0) || 0
  const resultsCount = Number(diagnostics?.resultsCount ?? 0) || 0
  const completedTrades = Number(diagnostics?.completedTrades ?? 0) || 0
  const weeks = Array.isArray(weekSeries) ? weekSeries : []
  const configuredWindowWeeks = Math.max(
    1,
    Math.floor(Number(gateConfig.windowWeeks ?? 8) || 8),
  )
  const configuredMinWeeks = Math.max(
    1,
    Math.floor(Number(gateConfig.minWeeksForTradeCheck ?? 4) || 4),
  )
  const configuredMinCompletedTrades = Math.max(
    0,
    Math.floor(Number(gateConfig.minCompletedTradesInWindow ?? 1) || 1),
  )
  const weeksToInspect = Math.max(
    1,
    Math.min(Math.floor(Number(evalWeeks) || 0), weeks.length),
  )
  const earlyWindow = weeks.slice(
    0,
    Math.min(configuredWindowWeeks, weeksToInspect),
  )
  const earlyWindowCompletedTrades = earlyWindow.reduce(
    (acc, row) => acc + (Number(row?.completedTrades ?? 0) || 0),
    0,
  )

  const reasons = []
  if (signalsCount <= 0) reasons.push("EARLY_ZERO_SIGNALS")
  if (resultsCount <= 0) reasons.push("EARLY_ZERO_RESULTS")
  if (!validationTradeGatePass && completedTrades < minValidationTrades) {
    reasons.push("EARLY_TRADE_GATE_FAIL")
  }
  if (
    earlyWindow.length >= configuredMinWeeks &&
    earlyWindowCompletedTrades < configuredMinCompletedTrades
  ) {
    reasons.push("EARLY_ZERO_TRADES_FIRST_4W")
  }
  return {
    enabled: true,
    pass: reasons.length === 0,
    reasons,
    metrics: {
      signalsCount,
      resultsCount,
      completedTrades,
      earlyWindowWeeks: earlyWindow.length,
      earlyWindowCompletedTrades,
      minValidationTrades,
      configuredWindowWeeks,
      configuredMinWeeks,
      configuredMinCompletedTrades,
    },
  }
}

const collectFailureReasons = ({
  validationSummary,
  validationTradeGatePass,
  continuity,
  moonshotGatePass,
  moonshotGateReason,
  legacyWeeklyGate,
  validationEarlyGate,
  metrics,
}) => {
  const reasons = []
  if (!validationSummary?.pass) reasons.push("WEEKLY_SUMMARY_GATE")
  if (metrics?.worst2wGatePass === false) {
    reasons.push(String(metrics?.worst2wGateReason ?? "WORST2W_GATE"))
  }
  if (!validationTradeGatePass) reasons.push("TRADE_GATE")
  if (!validationEarlyGate?.pass) {
    for (const reason of validationEarlyGate.reasons ?? []) {
      reasons.push(reason)
    }
  }
  if (!continuity?.pass) {
    const continuityReasons =
      Array.isArray(continuity.reasons) && continuity.reasons.length
        ? continuity.reasons
        : ["UNKNOWN"]
    for (const reason of continuityReasons) {
      reasons.push(`CONTINUITY_${String(reason)}`)
    }
  }
  if (legacyWeeklyGate?.enabled && !legacyWeeklyGate?.pass) {
    const legacyReasons =
      Array.isArray(legacyWeeklyGate.reasons) && legacyWeeklyGate.reasons.length
        ? legacyWeeklyGate.reasons
        : ["LEGACY_GATE_FAILED"]
    for (const reason of legacyReasons) {
      reasons.push(String(reason))
    }
  }
  if (!moonshotGatePass) {
    reasons.push(String(moonshotGateReason ?? MOONSHOT_GATE_FAILED))
  }
  if ((Number(metrics?.countWeeksGE ?? 0) || 0) <= 0) {
    reasons.push("WEEKLY_COUNT_ZERO")
  }
  if ((Number(metrics?.emptyWeeksCount ?? 0) || 0) > 0) {
    reasons.push("WEEKLY_EMPTY_WEEKS")
  }
  if ((Number(metrics?.stopLikePct ?? 1) || 1) >= 0.8) {
    reasons.push("STOPLIKE_TOO_HIGH")
  }
  return Array.from(new Set(reasons))
}

const normalizeFailureReason = (reason) => {
  const raw = String(reason ?? "")
    .trim()
    .toUpperCase()
  if (!raw) {
    return { reasonCode: "UNKNOWN", reasonMeta: null, reasonRaw: "UNKNOWN" }
  }
  if (raw.startsWith("CONTINUITY_")) {
    const meta = raw.slice("CONTINUITY_".length) || null
    return { reasonCode: "CONTINUITY", reasonMeta: meta, reasonRaw: raw }
  }
  if (raw.startsWith("LOCKBOX_")) {
    const meta = raw.slice("LOCKBOX_".length) || null
    return { reasonCode: "LOCKBOX", reasonMeta: meta, reasonRaw: raw }
  }
  const colonIdx = raw.indexOf(":")
  if (colonIdx > 0) {
    const reasonCode = raw.slice(0, colonIdx) || "UNKNOWN"
    const reasonMeta = raw.slice(colonIdx + 1) || null
    return { reasonCode, reasonMeta, reasonRaw: raw }
  }
  return { reasonCode: raw, reasonMeta: null, reasonRaw: raw }
}

const normalizeFailureReasons = (reasons) => {
  const entries = Array.isArray(reasons)
    ? reasons.map((reason) => normalizeFailureReason(reason))
    : []
  const dedupe = new Set()
  const normalized = []
  for (const entry of entries) {
    const key = `${entry.reasonCode}|${entry.reasonMeta ?? ""}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    normalized.push(entry)
  }
  return normalized
}

const toFailureCounterKey = (entry) => {
  const reasonCode =
    String(entry?.reasonCode ?? "")
      .trim()
      .toUpperCase() || "UNKNOWN"
  const reasonMeta = String(entry?.reasonMeta ?? "")
    .trim()
    .toUpperCase()
  return reasonMeta ? `${reasonCode}:${reasonMeta}` : reasonCode
}

const runConfigSanityCheck = ({
  args,
  tracks,
  requiredTracks,
  minValidationTrades,
  noTradeTerminateRounds,
  weakSignalTerminateRounds,
  continuityGateEnabled,
  continuityThresholds,
  gapActivationMinCoverage,
  dataCoverageThresholds,
  symbolLimit,
  maxCandidateCount,
  maxRuleCandidates,
  maxShapeK,
  memoryHeadroomMb,
  maxRssMb,
  lowRamSafetyCaps,
  stage2FromPool,
  stage2PoolTrackLimit,
  stage2PoolJsonMaxBytes,
  earlyGateConfig,
}) => {
  const errors = []
  const warnings = []
  if (!Array.isArray(tracks) || tracks.length <= 0) {
    errors.push("TRACKS_EMPTY")
  }
  if (!Array.isArray(requiredTracks) || requiredTracks.length <= 0) {
    errors.push("REQUIRED_TRACKS_EMPTY")
  }
  if (
    Array.isArray(requiredTracks) &&
    requiredTracks.some((track) => !tracks.includes(track))
  ) {
    errors.push("REQUIRED_TRACK_NOT_IN_TRACKS")
  }
  if (
    (Number(args?.minHighWeeks ?? 0) || 0) > (Number(args?.evalWeeks ?? 0) || 0)
  ) {
    errors.push("MIN_HIGH_WEEKS_EXCEEDS_EVAL_WEEKS")
  }
  if (
    (Number(args?.nearHighWeeks ?? 0) || 0) >
    (Number(args?.evalWeeks ?? 0) || 0)
  ) {
    errors.push("NEAR_HIGH_WEEKS_EXCEEDS_EVAL_WEEKS")
  }
  if (
    (Number(args?.minOtherWeekPct ?? 0) || 0) >
    (Number(args?.highWeekPct ?? 0) || 0)
  ) {
    warnings.push("MIN_OTHER_WEEK_PCT_GT_HIGH_WEEK_PCT")
  }
  if ((Number(minValidationTrades ?? 0) || 0) <= 0) {
    errors.push("MIN_VALIDATION_TRADES_INVALID")
  }
  if (
    (Number(noTradeTerminateRounds ?? 0) || 0) >
    (Number(weakSignalTerminateRounds ?? 0) || 0)
  ) {
    warnings.push("NO_TRADE_TERMINATE_GT_WEAK_SIGNAL_TERMINATE")
  }
  if (continuityGateEnabled) {
    const regressWeeks = Number(
      continuityThresholds?.maxRegressCountWeeksGE ?? 0,
    )
    if (!Number.isFinite(regressWeeks) || regressWeeks < 0) {
      errors.push("CONTINUITY_MAX_REGRESS_COUNT_WEEKS_INVALID")
    }
  }
  if (
    (Number(gapActivationMinCoverage ?? 0) || 0) <
    (Number(dataCoverageThresholds?.price15VsUniverse ?? 0) || 0)
  ) {
    warnings.push("GAP_ACTIVATION_COVERAGE_LT_PRICE15_COVERAGE")
  }
  if (lowRamSafetyCaps && (Number(symbolLimit ?? 0) || 0) <= 0) {
    warnings.push("LOW_RAM_WITHOUT_SYMBOL_LIMIT")
  }
  if ((Number(maxCandidateCount ?? 0) || 0) < 100) {
    warnings.push("MAX_CANDIDATE_COUNT_TOO_LOW")
  }
  if ((Number(maxRuleCandidates ?? 0) || 0) < 5000) {
    warnings.push("MAX_RULE_CANDIDATES_TOO_LOW")
  }
  if ((Number(maxShapeK ?? 0) || 0) < 800) {
    warnings.push("MAX_SHAPE_K_TOO_LOW")
  }
  if ((Number(memoryHeadroomMb ?? 0) || 0) < 128) {
    warnings.push("MEMORY_HEADROOM_MB_TOO_LOW")
  }
  if ((Number(maxRssMb ?? 0) || 0) < 2048) {
    warnings.push("MAX_RSS_MB_TOO_LOW")
  }
  if (earlyGateConfig?.enabled) {
    const windowWeeks = Number(earlyGateConfig.windowWeeks ?? 0) || 0
    const minWeeks = Number(earlyGateConfig.minWeeksForTradeCheck ?? 0) || 0
    const evalWeeks = Number(args?.evalWeeks ?? 0) || 0
    if (windowWeeks > evalWeeks) {
      warnings.push("EARLY_GATE_WINDOW_GT_EVAL_WEEKS")
    }
    if (minWeeks > windowWeeks) {
      warnings.push("EARLY_GATE_MIN_WEEKS_GT_WINDOW")
    }
  }
  if (stage2FromPool && !args?.candidatePoolPath) {
    errors.push("STAGE2_POOL_PATH_MISSING")
  }
  if (stage2FromPool && (Number(stage2PoolTrackLimit ?? 0) || 0) < 500) {
    warnings.push("STAGE2_POOL_TRACK_LIMIT_LOW")
  }
  if (
    stage2FromPool &&
    (Number(stage2PoolJsonMaxBytes ?? 0) || 0) < 16 * 1024 * 1024
  ) {
    warnings.push("STAGE2_POOL_JSON_MAX_BYTES_LOW")
  }
  return {
    pass: errors.length === 0,
    errors,
    warnings,
    reviewedAt: new Date().toISOString(),
  }
}

const resolveAdaptiveBudgetMode = ({
  snap,
  previousMode,
  minHeadroomRatio,
  maxRssBytes,
}) => {
  const safeHeadroom = Number(snap?.headroomRatio ?? 1)
  const rss = Number(snap?.rss ?? 0)
  const rssRatio =
    Number.isFinite(maxRssBytes) && maxRssBytes > 0 ? rss / maxRssBytes : 0
  const targetMode =
    safeHeadroom < minHeadroomRatio + 0.02 || rssRatio >= 0.95
      ? "tight"
      : safeHeadroom < minHeadroomRatio + 0.06 || rssRatio >= 0.85
        ? "guarded"
        : "normal"
  if (previousMode === "tight" && targetMode === "guarded") {
    if (safeHeadroom < minHeadroomRatio + 0.1 || rssRatio > 0.8) {
      return "tight"
    }
  }
  if (previousMode === "guarded" && targetMode === "normal") {
    if (safeHeadroom < minHeadroomRatio + 0.12 || rssRatio > 0.72) {
      return "guarded"
    }
  }
  return targetMode
}

const ADAPTIVE_BUDGET_SCALES = Object.freeze({
  normal: Object.freeze({
    candidateScale: 1,
    ruleScale: 1,
    shapeScale: 1,
  }),
  guarded: Object.freeze({
    candidateScale: 0.85,
    ruleScale: 0.85,
    shapeScale: 0.9,
  }),
  tight: Object.freeze({
    candidateScale: 0.7,
    ruleScale: 0.65,
    shapeScale: 0.8,
  }),
})

const scaleNumberList = ({ values, scale, minimum = 1, cap = Infinity }) => {
  const list = Array.isArray(values) ? values : []
  const scaled = list
    .map((value) => {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) {
        return null
      }
      const adjusted = Math.floor(n * scale)
      return Math.max(minimum, Math.min(cap, adjusted))
    })
    .filter((value) => Number.isFinite(value) && value > 0)
  return Array.from(new Set(scaled)).sort((a, b) => a - b)
}

const pickNearestFromList = ({ list, value, fallback }) => {
  const values = Array.isArray(list)
    ? list.filter((item) => Number.isFinite(Number(item)))
    : []
  if (!values.length) {
    return fallback
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback ?? values[0]
  }
  let best = values[0]
  let bestDistance = Math.abs(n - Number(best))
  for (let i = 1; i < values.length; i += 1) {
    const candidate = values[i]
    const distance = Math.abs(n - Number(candidate))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

const sanitizePolicyChoiceWithSpace = ({ choice, policySpace }) => {
  const base = choice && typeof choice === "object" ? choice : {}
  return {
    candidateCount: pickNearestFromList({
      list: policySpace.candidateCount,
      value: base.candidateCount,
      fallback: policySpace.candidateCount[0],
    }),
    lookbackDays: pickNearestFromList({
      list: policySpace.lookbackDays,
      value: base.lookbackDays,
      fallback: policySpace.lookbackDays[0],
    }),
    entryWidthPct: pickNearestFromList({
      list: policySpace.entryWidthPct,
      value: base.entryWidthPct,
      fallback: policySpace.entryWidthPct[0],
    }),
    stopPct: pickNearestFromList({
      list: policySpace.stopPct,
      value: base.stopPct,
      fallback: policySpace.stopPct[0],
    }),
    targetPct: pickNearestFromList({
      list: policySpace.targetPct,
      value: base.targetPct,
      fallback: policySpace.targetPct[0],
    }),
    trailingPct: pickNearestFromList({
      list: policySpace.trailingPct,
      value: base.trailingPct,
      fallback: policySpace.trailingPct[0],
    }),
    minRewardPct: pickNearestFromList({
      list: policySpace.minRewardPct,
      value: base.minRewardPct,
      fallback: policySpace.minRewardPct[0],
    }),
    minLiquidityM: pickNearestFromList({
      list: policySpace.minLiquidityM,
      value: base.minLiquidityM,
      fallback: policySpace.minLiquidityM[0],
    }),
  }
}

const sanitizePatternChoiceWithSpace = ({ choice, patternSpace }) => {
  const base = choice && typeof choice === "object" ? choice : {}
  const rawEngineTypes = Array.isArray(patternSpace?.engineType)
    ? patternSpace.engineType
    : []
  const normalizedEngineTypes = rawEngineTypes
    .map((value) => normalizeEngineType(value))
    .filter((value, index, list) => list.indexOf(value) === index)
  const engineType = normalizedEngineTypes.includes(
    normalizeEngineType(base.engineType),
  )
    ? normalizeEngineType(base.engineType)
    : (normalizedEngineTypes[0] ?? "rule")
  const rawShapeKs = Array.isArray(base.shapeKList)
    ? base.shapeKList
    : Number.isFinite(Number(base.shapeKList))
      ? [base.shapeKList]
      : []
  const normalizedShapeKs = rawShapeKs
    .map((value) =>
      pickNearestFromList({
        list: patternSpace.shapeKList,
        value,
        fallback: null,
      }),
    )
    .filter((value) => Number.isFinite(Number(value)))
  const shapeKList = normalizedShapeKs.length
    ? Array.from(new Set(normalizedShapeKs)).sort((a, b) => a - b)
    : [...patternSpace.shapeKList]
  return {
    supportMin: pickNearestFromList({
      list: patternSpace.supportMin,
      value: base.supportMin,
      fallback: patternSpace.supportMin[0],
    }),
    ruleMaxCandidates: pickNearestFromList({
      list: patternSpace.ruleMaxCandidates,
      value: base.ruleMaxCandidates,
      fallback: patternSpace.ruleMaxCandidates[0],
    }),
    engineType,
    shapeKList,
  }
}

const scopePatternsByEngine = ({ patterns, requestedEngineType }) => {
  const engineType = normalizeEngineType(requestedEngineType)
  if (!patterns || typeof patterns !== "object") {
    return { engineType, patterns }
  }
  const rules = Array.isArray(patterns.rules) ? patterns.rules : []
  const shapes = Array.isArray(patterns.shapes) ? patterns.shapes : []
  if (engineType === "chart") {
    if (shapes.length > 0) {
      return {
        engineType: "chart",
        patterns: { ...patterns, rules: [] },
      }
    }
    if (rules.length > 0) {
      return {
        engineType: "rule",
        patterns: { ...patterns, shapes: [] },
      }
    }
    return { engineType: "chart", patterns: { ...patterns, rules: [] } }
  }
  if (rules.length > 0) {
    return {
      engineType: "rule",
      patterns: { ...patterns, shapes: [] },
    }
  }
  if (shapes.length > 0) {
    return {
      engineType: "chart",
      patterns: { ...patterns, rules: [] },
    }
  }
  return { engineType: "rule", patterns: { ...patterns, shapes: [] } }
}

const sanitizeRunId = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) {
    return null
  }
  const cleaned = raw.replaceAll(/[^a-zA-Z0-9_-]/g, "_")
  if (!cleaned) {
    return null
  }
  if (cleaned.length <= MAX_AUTSEARCH_RUN_ID_LEN) {
    return cleaned
  }
  // Keep deterministic uniqueness while preserving tail shard suffixes.
  const hash = crypto
    .createHash("sha1")
    .update(cleaned)
    .digest("hex")
    .slice(0, 12)
  const tailBudget = Math.max(
    8,
    Math.min(16, MAX_AUTSEARCH_RUN_ID_LEN - hash.length - 2),
  )
  const tail = cleaned.slice(-tailBudget)
  const headBudget = Math.max(
    0,
    MAX_AUTSEARCH_RUN_ID_LEN - hash.length - 2 - tail.length,
  )
  const head = cleaned.slice(0, headBudget)
  const compact = `${head}_${hash}_${tail}`.replaceAll(/_+/g, "_")
  return compact.slice(0, MAX_AUTSEARCH_RUN_ID_LEN) || null
}

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const appendNdjson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8")
}

const writeText = (filePath, lines) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8")
}

const resolveRecommendationModeTracks = (mode) => {
  const normalized = String(mode ?? "")
    .trim()
    .toUpperCase()
  if (normalized === "INTRADAY_1500") {
    return ["GAP_15_BET"]
  }
  if (normalized === "EOD_CLOSE") {
    return ["SURGE_EOD", "MOONSHOT"]
  }
  return []
}

const recommendationOutputSlug = (mode) =>
  String(mode ?? "")
    .trim()
    .toUpperCase() === "INTRADAY_1500"
    ? "intraday_1500"
    : "eod_close"

const normalizeRecommendationDateKey = (value) => {
  const direct = normalizeDateKey(value)
  if (direct) return direct
  return resolveTodayKstDateKey()
}

const writeZeroRecommendationOutput = ({
  mode,
  asOfDateKey,
  reasonCodes,
  runId,
  routerCloseDecisionTimeKST,
  source,
  details = {},
}) => {
  const normalizedMode = String(mode ?? "")
    .trim()
    .toUpperCase()
  const dateKey = normalizeRecommendationDateKey(asOfDateKey)
  const slug = recommendationOutputSlug(normalizedMode)
  const recommendationsDir = path.join(rootDir, "output", "recommendations")
  fs.mkdirSync(recommendationsDir, { recursive: true })
  const latestPath = path.join(recommendationsDir, `latest_${slug}.json`)
  const datedPath = path.join(
    recommendationsDir,
    `${dateKey.replace(/-/g, "")}_${slug}.json`,
  )
  const tracks = resolveRecommendationModeTracks(normalizedMode)
  const payload = {
    schemaVersion: "autosearch_recommendation_output_v1",
    generatedAt: new Date().toISOString(),
    generatedBy: source,
    runId: String(runId ?? "").trim() || null,
    status: "NO_MATCH",
    recommendationMode: normalizedMode,
    asOfDateKey: dateKey,
    routerCloseDecisionTimeKST,
    tracks,
    recommendations: [],
    emptyReasonCodes: Array.from(
      new Set(
        (Array.isArray(reasonCodes) ? reasonCodes : [])
          .map((row) =>
            String(row ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    ),
    details,
  }
  writeJson(latestPath, payload)
  writeJson(datedPath, payload)
  return {
    mode: normalizedMode,
    asOfDateKey: dateKey,
    latestPath,
    datedPath,
    reasonCodes: payload.emptyReasonCodes,
  }
}

const ensureActivationRecommendationOutputs = ({
  activationTracks,
  asOfByTrack,
  activationInvokeResults,
  gapActivationReady,
  runId,
  routerCloseDecisionTimeKST,
}) => {
  const out = []
  const invokedByMode = new Map()
  for (const row of activationInvokeResults ?? []) {
    const mode = String(row?.recommendationMode ?? "")
      .trim()
      .toUpperCase()
    if (!mode) continue
    invokedByMode.set(mode, row)
  }

  const requiredModes = []
  const trackSet = new Set(
    (Array.isArray(activationTracks) ? activationTracks : []).map((track) =>
      String(track ?? "")
        .trim()
        .toUpperCase(),
    ),
  )
  if (trackSet.has("GAP_15_BET")) {
    requiredModes.push({
      mode: "INTRADAY_1500",
      asOfDateKey: asOfByTrack?.GAP_15_BET ?? null,
    })
  }
  if (trackSet.has("SURGE_EOD") || trackSet.has("MOONSHOT")) {
    requiredModes.push({
      mode: "EOD_CLOSE",
      asOfDateKey: asOfByTrack?.SURGE_EOD ?? asOfByTrack?.MOONSHOT ?? null,
    })
  }

  for (const target of requiredModes) {
    const mode = target.mode
    const slug = recommendationOutputSlug(mode)
    const asOfDateKey = normalizeRecommendationDateKey(target.asOfDateKey)
    const recommendationsDir = path.join(rootDir, "output", "recommendations")
    const latestPath = path.join(recommendationsDir, `latest_${slug}.json`)
    const datedPath = path.join(
      recommendationsDir,
      `${asOfDateKey.replace(/-/g, "")}_${slug}.json`,
    )

    const invoked = invokedByMode.get(mode)
    const exists = fs.existsSync(latestPath) && fs.existsSync(datedPath)
    if (invoked?.ok === true && exists) {
      continue
    }

    const reasonCodes = []
    if (mode === "INTRADAY_1500" && gapActivationReady?.ok !== true) {
      reasonCodes.push("GAP_COVERAGE_LOW")
      if (gapActivationReady?.reason) {
        reasonCodes.push(String(gapActivationReady.reason).trim().toUpperCase())
      }
    }
    if (invoked?.ok === false) {
      reasonCodes.push("ACTIVATION_COMMAND_FAILED")
    }
    if (!invoked) {
      reasonCodes.push("ACTIVATION_NOT_INVOKED")
    }
    if (invoked?.ok === true && !exists) {
      reasonCodes.push("ACTIVATION_OUTPUT_MISSING")
    }
    if (!reasonCodes.length) {
      reasonCodes.push("ROUTER_NO_MATCH")
    }
    out.push(
      writeZeroRecommendationOutput({
        mode,
        asOfDateKey,
        reasonCodes,
        runId,
        routerCloseDecisionTimeKST,
        source: "go_live_autosearch",
        details: {
          invoked: invoked
            ? { ok: invoked.ok, error: invoked.error ?? null }
            : null,
          gapActivationReady,
        },
      }),
    )
  }

  return out
}
const buildFinalReportBase = ({
  runId,
  status,
  dataMode,
  tracks,
  passMode,
}) => ({
  reportSchemaVersion: FINAL_REPORT_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  runId,
  status,
  dataMode,
  tracks: Array.isArray(tracks) ? tracks : [],
  passMode: String(passMode ?? "all"),
})

const readMemorySnapshot = () => {
  const usage = process.memoryUsage()
  const stats = v8.getHeapStatistics()
  const heapUsed = Number(usage?.heapUsed ?? 0) || 0
  const rss = Number(usage?.rss ?? 0) || 0
  const heapLimit = Number(stats?.heap_size_limit ?? 0) || 0
  const headroom = heapLimit > 0 ? heapLimit - heapUsed : 0
  const headroomRatio = heapLimit > 0 ? headroom / heapLimit : 1
  return {
    heapUsed,
    rss,
    heapLimit,
    headroom,
    headroomRatio,
    heapUsedMb: Math.round(heapUsed / 1024 / 1024),
    rssMb: Math.round(rss / 1024 / 1024),
    heapLimitMb: Math.round(heapLimit / 1024 / 1024),
  }
}

const enforceMemoryHeadroom = ({
  stage,
  minHeadroomBytes,
  minHeadroomRatio,
  maxRssBytes,
}) => {
  const minBytes = Math.max(64 * 1024 * 1024, Number(minHeadroomBytes) || 0)
  const minRatio = Math.max(0.01, Number(minHeadroomRatio) || 0)
  const maxRss = Number.isFinite(Number(maxRssBytes))
    ? Math.max(512 * 1024 * 1024, Number(maxRssBytes))
    : Number.POSITIVE_INFINITY
  let snap = readMemorySnapshot()
  let enoughBytes = snap.headroom >= minBytes
  let enoughRatio = snap.headroomRatio >= minRatio
  let enoughRss = snap.rss <= maxRss
  if (!enoughBytes || !enoughRatio || !enoughRss) {
    if (typeof global.gc === "function") {
      try {
        global.gc()
      } catch {
        // best effort
      }
      snap = readMemorySnapshot()
      enoughBytes = snap.headroom >= minBytes
      enoughRatio = snap.headroomRatio >= minRatio
      enoughRss = snap.rss <= maxRss
    }
  }
  if (enoughBytes && enoughRatio && enoughRss) {
    return snap
  }
  const reason = [
    `stage=${stage}`,
    `heapUsedMb=${snap.heapUsedMb}`,
    `rssMb=${snap.rssMb}`,
    `heapLimitMb=${snap.heapLimitMb}`,
    `headroomMb=${Math.round(snap.headroom / 1024 / 1024)}`,
    `headroomRatio=${snap.headroomRatio.toFixed(3)}`,
    `minHeadroomMb=${Math.round(minBytes / 1024 / 1024)}`,
    `minHeadroomRatio=${minRatio.toFixed(3)}`,
    `maxRssMb=${Math.round(maxRss / 1024 / 1024)}`,
  ].join(" ")
  throw new Error(`MEMORY_GUARD_TRIGGERED ${reason}`)
}

const logMemorySnapshot = (stage, snap = readMemorySnapshot()) => {
  console.log(
    [
      `[memory] stage=${stage}`,
      `heapUsedMb=${snap.heapUsedMb}`,
      `rssMb=${snap.rssMb}`,
      `heapLimitMb=${snap.heapLimitMb}`,
      `headroomMb=${Math.round(snap.headroom / 1024 / 1024)}`,
      `headroomRatio=${snap.headroomRatio.toFixed(3)}`,
    ].join(" "),
  )
  return snap
}

const incrementCounter = (target, key) => {
  const safeKey = String(key ?? "UNKNOWN").trim() || "UNKNOWN"
  target[safeKey] = (target[safeKey] ?? 0) + 1
}

const summarizeEvaluation = (evaluation) => {
  const evalData = evaluation ?? {}
  const signals = Array.isArray(evalData.signals) ? evalData.signals : []
  const results = Array.isArray(evalData.results) ? evalData.results : []
  const weekSeries = Array.isArray(evalData.weekSeries)
    ? evalData.weekSeries
    : []

  const statusCounts = {}
  const outcomeCounts = {}
  const reasonCounts = {}
  const noFillReasonCounts = {}

  let closedCount = 0
  let noFillCount = 0
  let completedTrades = 0

  for (const row of results) {
    const status = String(row?.status ?? "UNKNOWN").trim() || "UNKNOWN"
    const outcome = String(row?.outcome ?? "UNKNOWN").trim() || "UNKNOWN"
    const reason = String(row?.reason ?? "UNKNOWN").trim() || "UNKNOWN"
    const filled = row?.filled === true

    incrementCounter(statusCounts, status)
    incrementCounter(outcomeCounts, outcome)
    incrementCounter(reasonCounts, reason)

    if (status === "NO_FILL") {
      noFillCount += 1
      incrementCounter(noFillReasonCounts, reason)
    }
    if (status === "CLOSED") {
      closedCount += 1
    }
    if (status === "CLOSED" && filled) {
      completedTrades += 1
    }
  }

  const emptyWeekCount = weekSeries.filter(
    (row) => (Number(row?.completedTrades ?? 0) || 0) === 0,
  ).length

  return {
    signalsCount: signals.length,
    resultsCount: results.length,
    completedTrades,
    closedCount,
    noFillCount,
    emptyWeekCount,
    statusCounts,
    outcomeCounts,
    reasonCounts,
    noFillReasonCounts,
  }
}

const computeStopLikePctFromDiagnostics = (diagnostics) => {
  const resultsCount = Number(diagnostics?.resultsCount ?? 0) || 0
  if (resultsCount <= 0) {
    return 1
  }
  const reasonCounts = diagnostics?.reasonCounts ?? {}
  const stopHit = Number(reasonCounts.STOP_HIT ?? 0) || 0
  const stopGap = Number(reasonCounts.STOP_GAP ?? 0) || 0
  return (stopHit + stopGap) / resultsCount
}

const resolveMaybeAbsolutePath = (input) => {
  const raw = String(input ?? "").trim()
  if (!raw) {
    return null
  }
  if (path.isAbsolute(raw)) {
    return raw
  }
  return path.join(rootDir, raw)
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

const buildCandidatePoolEntryKey = (entry) =>
  [
    String(entry?.track ?? "")
      .trim()
      .toUpperCase(),
    normalizeEngineType(entry?.engineType),
    stableStringify(entry?.policyChoice ?? null),
    stableStringify(entry?.patternChoice ?? null),
  ].join("|")

const buildFallbackCandidateFingerprint = ({
  track,
  policyChoice,
  patternChoice,
}) => {
  const trackKey = String(track ?? "")
    .trim()
    .toUpperCase()
  if (!trackKey || !policyChoice || !patternChoice) {
    return null
  }
  const baseKey = [
    trackKey,
    stableStringify(policyChoice),
    stableStringify(patternChoice),
  ].join("|")
  return `fp_${crypto
    .createHash("sha1")
    .update(baseKey)
    .digest("hex")
    .slice(0, 16)}`
}

const readFirstNonWhitespaceChar = (filePath) => {
  const fd = fs.openSync(filePath, "r")
  try {
    const fileSize = fs.statSync(filePath).size
    const chunkSize = 4096
    const buffer = Buffer.alloc(chunkSize)
    let position = 0
    while (position < fileSize) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, position)
      if (bytesRead <= 0) break
      const text = buffer.toString("utf8", 0, bytesRead)
      for (const ch of text) {
        if (!/\s/.test(ch)) {
          return ch
        }
      }
      position += bytesRead
    }
  } finally {
    fs.closeSync(fd)
  }
  return null
}

const normalizeCandidatePoolRows = (payload) => {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!payload || typeof payload !== "object") {
    return []
  }
  const keys = ["entries", "candidates", "pool", "items", "rows"]
  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key]
    }
  }
  return []
}

const extractCandidatePoolEntry = (row) => {
  const track = String(row?.track ?? row?.candidate?.track ?? "")
    .trim()
    .toUpperCase()
  const policyChoice =
    row?.policyChoice ??
    row?.config?.policyChoice ??
    row?.candidate?.policyChoice ??
    null
  const patternChoice =
    row?.patternChoice ??
    row?.config?.patternChoice ??
    row?.candidate?.patternChoice ??
    null
  if (!track || !policyChoice || !patternChoice) {
    return null
  }
  return {
    track,
    engineType: normalizeEngineType(
      row?.engineType ?? row?.candidate?.engineType,
    ),
    policyChoice,
    patternChoice,
    fingerprint: String(row?.fingerprint ?? "").trim() || null,
    metrics: row?.metrics ?? null,
    sourceRunId:
      row?.runId ?? row?.sourceRunId ?? row?.candidate?.runId ?? null,
    sourceRound:
      Number(row?.round ?? row?.sourceRound ?? row?.candidate?.round ?? 0) || 0,
    sourceSeed:
      Number(row?.sourceSeed ?? row?.candidate?.sourceSeed ?? 0) || null,
  }
}

const loadCandidatePool = async ({
  candidatePoolPath,
  requiredTracks,
  maxEntriesPerTrack = 5000,
  jsonModeMaxBytes = 64 * 1024 * 1024,
}) => {
  const filePath = resolveMaybeAbsolutePath(candidatePoolPath)
  const byTrack = new Map((requiredTracks ?? []).map((track) => [track, []]))
  if (!filePath) {
    return { byTrack, count: 0, filePath: null }
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Candidate pool missing: ${filePath}`)
  }
  const required = new Set(requiredTracks ?? [])
  const dedupe = new Set()
  const perTrackCount = new Map()
  let count = 0
  const readMetric = (entry, key, fallback) => {
    const value = Number(entry?.metrics?.[key])
    return Number.isFinite(value) ? value : fallback
  }
  const sortEntries = () => {
    for (const [track, rows] of byTrack.entries()) {
      if (!Array.isArray(rows) || rows.length <= 1) {
        continue
      }
      rows.sort((left, right) => {
        const worstDiff =
          readMetric(right, "worst2wAvgPct", -1e9) -
          readMetric(left, "worst2wAvgPct", -1e9)
        if (Math.abs(worstDiff) > 1e-9) {
          return worstDiff
        }
        const sumDiff =
          readMetric(right, "totalWeeklySumPct", -1e9) -
          readMetric(left, "totalWeeklySumPct", -1e9)
        if (Math.abs(sumDiff) > 1e-9) {
          return sumDiff
        }
        const stopDiff =
          readMetric(left, "stopLikePct", 1e9) -
          readMetric(right, "stopLikePct", 1e9)
        if (Math.abs(stopDiff) > 1e-9) {
          return stopDiff
        }
        return String(left?.fingerprint ?? "").localeCompare(
          String(right?.fingerprint ?? ""),
        )
      })
      byTrack.set(track, rows)
    }
  }
  const finalize = () => {
    sortEntries()
    return { byTrack, count, filePath }
  }

  const pushEntry = (row) => {
    const entry = extractCandidatePoolEntry(row)
    if (!entry) return
    if (required.size && !required.has(entry.track)) return
    const perTrack = Number(perTrackCount.get(entry.track) ?? 0) || 0
    if (perTrack >= maxEntriesPerTrack) return
    const key = buildCandidatePoolEntryKey(entry)
    if (dedupe.has(key)) return
    dedupe.add(key)
    const list = byTrack.get(entry.track) ?? []
    list.push(entry)
    byTrack.set(entry.track, list)
    perTrackCount.set(entry.track, perTrack + 1)
    count += 1
  }

  const firstChar = readFirstNonWhitespaceChar(filePath)
  if (!firstChar) {
    return finalize()
  }

  const loadAsNdjson = async () => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" })
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      const value = String(line ?? "").trim()
      if (!value) continue
      try {
        pushEntry(JSON.parse(value))
      } catch {
        // ignore malformed lines
      }
    }
    return finalize()
  }

  const ext = path.extname(filePath).toLowerCase()
  const preferNdjson = ext === ".ndjson" || ext === ".jsonl"
  if (!preferNdjson && (firstChar === "{" || firstChar === "[")) {
    let jsonError = null
    try {
      const fileSize = fs.statSync(filePath).size
      if (fileSize > jsonModeMaxBytes) {
        throw new Error(
          `STAGE2_POOL_JSON_TOO_LARGE bytes=${fileSize} max=${jsonModeMaxBytes} (use ndjson pool)`,
        )
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
      const rows = normalizeCandidatePoolRows(parsed)
      for (const row of rows) {
        pushEntry(row)
      }
      return finalize()
    } catch (error) {
      jsonError = error
    }
    const ndjsonResult = await loadAsNdjson()
    if (ndjsonResult.count > 0) {
      return ndjsonResult
    }
    if (jsonError) {
      throw jsonError
    }
    return ndjsonResult
  }

  return loadAsNdjson()
}

const STAGE2_POOL_PATTERN_CACHE_LIMIT = 96
const rememberStage2PoolPattern = ({ cache, fingerprint, patterns }) => {
  if (!cache || !fingerprint || !patterns) {
    return
  }
  const key = String(fingerprint).trim()
  if (!key) {
    return
  }
  cache.delete(key)
  cache.set(key, patterns)
  while (cache.size > STAGE2_POOL_PATTERN_CACHE_LIMIT) {
    const first = cache.keys().next().value
    if (!first) break
    cache.delete(first)
  }
}

const pickStage2CandidateFromPool = ({ entries, round, rng, triedKeys }) => {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) {
    return null
  }
  const triedSet =
    triedKeys instanceof Set ? triedKeys : triedKeys ? new Set(triedKeys) : null
  if (triedSet && triedSet.size < list.length) {
    const unseen = list.filter((entry) => {
      const key = buildCandidatePoolEntryKey(entry)
      return !triedSet.has(key)
    })
    if (unseen.length > 0) {
      const idxUnseen = Math.max(
        0,
        (Math.floor(Number(round) || 1) - 1) % unseen.length,
      )
      return unseen[idxUnseen] ?? unseen[0] ?? null
    }
  }
  const idxBase = Math.max(
    0,
    (Math.floor(Number(round) || 1) - 1) % list.length,
  )
  if (!rng || list.length <= 1) {
    return list[idxBase] ?? null
  }
  if (rng() < 0.65) {
    return list[idxBase] ?? null
  }
  const jitter = Math.floor(rng() * list.length)
  return list[(idxBase + jitter) % list.length] ?? null
}

const tryReadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const isPidAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const cmdlineHasRun = (cmdline, runId) => {
  const key = String(runId ?? "").trim()
  if (!key) return false
  const tokens = String(cmdline ?? "")
    .split("\u0000")
    .map((token) => String(token ?? "").trim())
    .filter(Boolean)
  if (!tokens.length) return false
  const joined = tokens.join(" ")
  const hasScript = tokens.some((token) =>
    token.includes("go_live_autosearch.mjs"),
  )
  if (!hasScript) return false
  return (
    joined.includes(`--runId=${key}`) ||
    joined.includes(`runId=${key}`) ||
    tokens.some((token) => token === key)
  )
}

const hasRunProcess = (runId) => {
  const key = String(runId ?? "").trim()
  if (!key) {
    return false
  }
  const procDir = "/proc"
  if (fs.existsSync(procDir)) {
    try {
      const entries = fs.readdirSync(procDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const pidText = entry.name
        if (!/^\d+$/.test(pidText)) continue
        const pid = Number(pidText)
        if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue
        const cmdlinePath = path.join(procDir, pidText, "cmdline")
        let cmdline = ""
        try {
          cmdline = fs.readFileSync(cmdlinePath, "utf8")
        } catch {
          continue
        }
        if (cmdlineHasRun(cmdline, key)) {
          return true
        }
      }
      return false
    } catch {
      // fallthrough to pgrep fallback
    }
  }
  try {
    const result = spawnSync("pgrep", ["-af", key], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
    const output = String(result?.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    return output.some(
      (line) =>
        line.includes("go_live_autosearch.mjs") &&
        (line.includes(`--runId=${key}`) || line.includes(`runId=${key}`)) &&
        !line.includes("pgrep -af"),
    )
  } catch {
    return false
  }
}

const resolveFinalStatus = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
  if (!raw) return null
  const allowed = new Set([
    "PASS",
    "FAIL",
    "DRY_RUN",
    "MAX_ROUNDS",
    "BLOCKED_BY_DATA",
    "NO_TRADES",
    "WEAK_SIGNALS",
    MOONSHOT_GATE_FAILED,
    "ABORTED",
  ])
  if (!allowed.has(raw)) {
    return null
  }
  return raw
}

const buildMoonshotWindowCacheKey = ({
  calendar,
  windowStartDateKey,
  windowEndDateKey,
  patternVersionLabel,
  strategyVersion,
  strategyVersionPrefix,
}) => {
  const list = Array.isArray(calendar) ? calendar : []
  const calendarSig =
    list.length > 0
      ? `${String(list[0] ?? "")}:${String(list[list.length - 1] ?? "")}:${list.length}`
      : "empty"
  return [
    normalizeDateKey(windowStartDateKey) ?? "",
    normalizeDateKey(windowEndDateKey) ?? "",
    String(patternVersionLabel ?? "").trim(),
    String(strategyVersion ?? "").trim(),
    String(strategyVersionPrefix ?? "").trim(),
    calendarSig,
  ].join("|")
}

const upsertMoonshotWindowCache = (key, value) => {
  if (!key) return
  if (moonshotWindowCache.has(key)) {
    moonshotWindowCache.delete(key)
  }
  moonshotWindowCache.set(key, value)
  while (moonshotWindowCache.size > MOONSHOT_WINDOW_CACHE_MAX) {
    const oldest = moonshotWindowCache.keys().next().value
    if (!oldest) break
    moonshotWindowCache.delete(oldest)
  }
}

const pickPrimaryBlockedReason = (reasons) => {
  const list = Array.from(
    new Set(
      (reasons ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  )
  if (!list.length) {
    return null
  }
  const score = (value) => {
    const raw = value.toUpperCase()
    if (raw === MOONSHOT_GATE_FAILED) return 0
    if (
      raw.includes("MISSING_DATA") ||
      raw.includes("DATA_COVERAGE_LOW") ||
      raw.includes("COVERAGE_LOW")
    ) {
      return 1
    }
    return 2
  }
  return list.sort((a, b) => score(a) - score(b))[0] ?? null
}

const resolveNextTradingDateKey = ({ calendar, dateKey }) => {
  const target = String(dateKey ?? "").trim()
  if (!target || !Array.isArray(calendar) || calendar.length === 0) {
    return null
  }
  const index = calendar.indexOf(target)
  if (index < 0 || index + 1 >= calendar.length) {
    return null
  }
  return String(calendar[index + 1] ?? "").trim() || null
}

const loadMoonshotWindowStats = async ({
  prisma,
  calendar,
  windowStartDateKey,
  windowEndDateKey,
  patternVersionLabel = null,
  strategyVersion = null,
  strategyVersionPrefix = null,
}) => {
  const cacheKey = buildMoonshotWindowCacheKey({
    calendar,
    windowStartDateKey,
    windowEndDateKey,
    patternVersionLabel,
    strategyVersion,
    strategyVersionPrefix,
  })
  if (cacheKey && moonshotWindowCache.has(cacheKey)) {
    return moonshotWindowCache.get(cacheKey)
  }
  const start = normalizeDateKey(windowStartDateKey)
  const end = normalizeDateKey(windowEndDateKey)
  const allowBlockedFallback = parseBooleanEnv(
    process.env.GOLIVE_MOONSHOT_GATE_ALLOW_BLOCKED ?? "1",
  )
  const failResult = {
    pass: false,
    reason: MOONSHOT_GATE_FAILED,
    stats: computeMoonshot4wStats([], start, end, calendar),
    outcomesCount: 0,
    signalsLoaded: 0,
    signalsQualified: 0,
    signalScope: {
      mode: allowBlockedFallback
        ? "EMITTED_THEN_BLOCKED_FALLBACK"
        : "EMITTED_ONLY",
      selectedEmitStatus: "NONE",
    },
  }
  if (!start || !end || !Array.isArray(calendar) || calendar.length === 0) {
    const result = {
      pass: false,
      reason: "MOONSHOT_WINDOW_INVALID",
      stats: null,
      outcomesCount: 0,
      signalsLoaded: 0,
      signalsQualified: 0,
    }
    upsertMoonshotWindowCache(cacheKey, result)
    return result
  }
  const signals = await prisma.aiSignal
    .findMany({
      where: {
        tradingDateKey: { gte: start, lte: end },
        track: "SURGE_EOD",
        role: "MOONSHOT",
        policyType: "RECOMMEND",
        mode: "EOD",
        status: "ACTIVE",
        ...(allowBlockedFallback
          ? { emitStatus: { in: ["EMITTED", "BLOCKED"] } }
          : { emitStatus: "EMITTED" }),
      },
      select: {
        symbol: true,
        emitStatus: true,
        tradingDateKey: true,
        detail: { select: { whyJson: true } },
      },
    })
    .catch(() => [])
  const strategyFilter = String(strategyVersion ?? "").trim()
  const strategyPrefixFilter = String(strategyVersionPrefix ?? "").trim()
  const patternFilter = String(patternVersionLabel ?? "").trim()
  const filterSignalsByScope = ({ ignorePattern = false } = {}) =>
    (signals ?? []).filter((row) => {
      const why = row?.detail?.whyJson
      const signalPattern = String(why?.patternVersionLabel ?? "").trim()
      const signalStrategy = String(why?.strategyVersion ?? "").trim()
      if (!ignorePattern && patternFilter && signalPattern !== patternFilter) {
        return false
      }
      if (
        strategyFilter &&
        (!signalStrategy || signalStrategy !== strategyFilter)
      ) {
        return false
      }
      if (
        strategyPrefixFilter &&
        (!signalStrategy || !signalStrategy.startsWith(strategyPrefixFilter))
      ) {
        return false
      }
      return true
    })
  const pickSignalsByEmitStatus = (rows) => {
    const emitted = rows.filter(
      (row) => String(row?.emitStatus ?? "").toUpperCase() === "EMITTED",
    )
    const blocked = rows.filter(
      (row) => String(row?.emitStatus ?? "").toUpperCase() === "BLOCKED",
    )
    const selected =
      emitted.length > 0 ? emitted : allowBlockedFallback ? blocked : []
    const selectedEmitStatus =
      emitted.length > 0 ? "EMITTED" : blocked.length > 0 ? "BLOCKED" : "NONE"
    return { selected, selectedEmitStatus }
  }
  let scopedSignals = filterSignalsByScope()
  let signalPick = pickSignalsByEmitStatus(scopedSignals)
  let patternFilterRelaxed = false
  if (signalPick.selected.length <= 0 && patternFilter) {
    const relaxedSignals = filterSignalsByScope({ ignorePattern: true })
    const relaxedPick = pickSignalsByEmitStatus(relaxedSignals)
    if (relaxedPick.selected.length > 0) {
      scopedSignals = relaxedSignals
      signalPick = relaxedPick
      patternFilterRelaxed = true
    }
  }
  const selectedSignals = signalPick.selected
  failResult.signalsLoaded = scopedSignals.length
  failResult.signalsQualified = selectedSignals.length
  failResult.signalScope.selectedEmitStatus = signalPick.selectedEmitStatus
  failResult.signalScope.patternFilterRelaxed = patternFilterRelaxed
  failResult.signalScope.patternFilter = patternFilter || null
  const signalRefs = []
  const neededSymbols = new Set()
  const neededDateKeys = new Set()
  for (const signal of selectedSignals) {
    const symbol = String(signal?.symbol ?? "").trim()
    const dateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) continue
    const nextDateKey = resolveNextTradingDateKey({ calendar, dateKey })
    if (!nextDateKey) continue
    signalRefs.push({ symbol, dateKey, nextDateKey })
    neededSymbols.add(symbol)
    neededDateKeys.add(dateKey)
    neededDateKeys.add(nextDateKey)
  }
  if (!signalRefs.length || !neededSymbols.size || !neededDateKeys.size) {
    upsertMoonshotWindowCache(cacheKey, failResult)
    return failResult
  }
  const neededDateList = Array.from(neededDateKeys).sort((a, b) =>
    String(a).localeCompare(String(b)),
  )
  const dateStart = neededDateList[0]
  const dateEnd = neededDateList[neededDateList.length - 1]
  const symbolList = Array.from(neededSymbols)
  const candleRowCap = clampInt(
    process.env.GOLIVE_MOONSHOT_CANDLE_ROW_CAP,
    300000,
    10000,
    2000000,
  )
  const adjustedRows = await prisma.candleDailyAdjusted
    .findMany({
      where: {
        tradingDateKey: { gte: dateStart, lte: dateEnd },
        symbol: { in: symbolList },
      },
      select: {
        symbol: true,
        tradingDateKey: true,
        ohlcv: true,
      },
      take: candleRowCap + 1,
    })
    .catch(() => [])
  if (adjustedRows.length > candleRowCap) {
    const result = {
      ...failResult,
      reason: "MOONSHOT_WINDOW_TOO_LARGE",
    }
    upsertMoonshotWindowCache(cacheKey, result)
    return result
  }
  const candles = adjustedRows.length
    ? adjustedRows.map((row) => ({
        symbol: row.symbol,
        dateKey: row.tradingDateKey,
        ...(row.ohlcv ?? {}),
      }))
    : await prisma.candleDaily
        .findMany({
          where: {
            dateKey: { gte: dateStart, lte: dateEnd },
            symbol: { in: symbolList },
          },
          select: {
            symbol: true,
            dateKey: true,
            open: true,
            high: true,
            low: true,
            close: true,
          },
          take: candleRowCap + 1,
        })
        .catch(() => [])
  if (candles.length > candleRowCap) {
    const result = {
      ...failResult,
      reason: "MOONSHOT_WINDOW_TOO_LARGE",
    }
    upsertMoonshotWindowCache(cacheKey, result)
    return result
  }
  const neededDateSet = new Set(neededDateList)
  const candleMap = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!symbol || !dateKey) continue
    if (!neededSymbols.has(symbol) || !neededDateSet.has(dateKey)) continue
    const byDate = candleMap.get(symbol) ?? new Map()
    byDate.set(dateKey, row)
    candleMap.set(symbol, byDate)
  }
  const outcomes = []
  for (const signal of signalRefs) {
    const symbol = signal.symbol
    const dateKey = signal.dateKey
    const nextDateKey = signal.nextDateKey
    const byDate = candleMap.get(symbol)
    const prev = byDate?.get(dateKey)
    const next = byDate?.get(nextDateKey)
    const prevClose = Number(prev?.close)
    const open = Number(next?.open)
    const high = Number(next?.high)
    if (
      !Number.isFinite(prevClose) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high)
    ) {
      continue
    }
    const highUpPct = high / prevClose - 1
    const openGapPct = open / prevClose - 1
    outcomes.push({
      tradingDateKey: dateKey,
      success: highUpPct >= 0.12 && openGapPct < 0.03,
    })
  }
  const stats = computeMoonshot4wStats(outcomes, start, end, calendar)
  const gatePass = Boolean(stats?.overallPass)
  const result = {
    pass: gatePass,
    reason: gatePass ? null : MOONSHOT_GATE_FAILED,
    stats,
    outcomesCount: outcomes.length,
    signalsLoaded: failResult.signalsLoaded,
    signalsQualified: failResult.signalsQualified,
    signalScope: failResult.signalScope,
    weeklySignalGate: {
      enabled: false,
      pass: true,
      minSignalsPerWeek: Number(stats?.minSignalsPerWeek ?? 0),
      weeksFailedMin: Number(stats?.weeklySignals?.weeksFailedMin ?? 0),
    },
  }
  upsertMoonshotWindowCache(cacheKey, result)
  return result
}

const reconcileOrphanRunningRuns = async ({
  prisma,
  hostName,
  staleRunningHours = 12,
}) => {
  const running = await prisma.autoSearchRun
    .findMany({
      where: { status: "RUNNING" },
      select: { runId: true, notes: true, updatedAt: true, startedAt: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => [])

  const cutoffTs =
    Date.now() - Math.max(1, Number(staleRunningHours) || 12) * 60 * 60 * 1000
  let reconciled = 0
  let failed = 0
  for (const row of running) {
    const runId = String(row?.runId ?? "").trim()
    if (!runId) continue

    const runDir = path.join(rootDir, "artifacts", "autosearch", runId)
    const finalReportPath = path.join(runDir, "final_report.json")
    const notes = row?.notes ?? {}
    const notePid = Number(notes?.pid)
    const noteHost = String(notes?.host ?? "").trim()

    let nextStatus = null
    let reason = null

    if (fs.existsSync(finalReportPath)) {
      const report = tryReadJson(finalReportPath)
      nextStatus = resolveFinalStatus(report?.status) ?? "ABORTED"
      reason = report?.status ? "FINAL_REPORT_FOUND" : "FINAL_REPORT_INVALID"
    } else if (
      Number.isFinite(notePid) &&
      (!noteHost || noteHost === hostName) &&
      Number(row?.updatedAt?.getTime?.() ?? 0) <= cutoffTs &&
      !isPidAlive(notePid)
    ) {
      nextStatus = "ABORTED"
      reason = "PID_NOT_ALIVE"
    } else if (
      Number(row?.updatedAt?.getTime?.() ?? 0) <= cutoffTs &&
      !Number.isFinite(notePid) &&
      !hasRunProcess(runId)
    ) {
      nextStatus = "ABORTED"
      reason = "STALE_WITHOUT_PID"
    }

    if (!nextStatus) {
      continue
    }

    const mergedNotes = {
      ...(typeof notes === "object" && notes !== null ? notes : {}),
      reconciledAt: new Date().toISOString(),
      reconciledReason: reason,
      reconciledBy: "go-live-autosearch",
      lastKnownUpdatedAt: row?.updatedAt?.toISOString?.() ?? null,
      lastKnownStartedAt: row?.startedAt?.toISOString?.() ?? null,
    }

    const updated = await prisma.autoSearchRun
      .update({
        where: { runId },
        data: {
          status: nextStatus,
          notes: mergedNotes,
        },
      })
      .then(() => true)
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown")
        console.log(
          `[golive] orphan reconcile failed runId=${runId} ${message}`,
        )
        return false
      })
    if (updated) {
      reconciled += 1
    } else {
      failed += 1
    }
  }
  return { scanned: running.length, reconciled, failed }
}

const toBandPct = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return n / 100
}

const toYearMonth = (dateKey) => {
  const raw = String(dateKey ?? "").trim()
  const match = raw.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null
  }
  if (month < 1 || month > 12) {
    return null
  }
  return { year, month }
}

const monthsBetweenInclusive = (fromDateKey, toDateKey) => {
  const from = toYearMonth(fromDateKey)
  const to = toYearMonth(toDateKey)
  if (!from || !to) {
    return null
  }
  const fromIndex = from.year * 12 + (from.month - 1)
  const toIndex = to.year * 12 + (to.month - 1)
  const diff = toIndex - fromIndex + 1
  return diff > 0 ? diff : null
}

const resolveAutosearchTrainTestMonths = ({
  horizonStart,
  trainAsOfDateKey,
}) => {
  const availableMonths = monthsBetweenInclusive(horizonStart, trainAsOfDateKey)
  return {
    trainMonths: FIXED_WINDOW_MONTHS.trainMonths,
    testMonths: FIXED_WINDOW_MONTHS.testMonths,
    availableMonths,
  }
}

const buildVersionLabel = (runId, track, round) =>
  `autosearch:${runId}:${track}:round:${round}`

const resolveTrainAsOf = (calendar, validationStart) => {
  const idx = calendar.findIndex((key) => key === validationStart)
  if (idx > 0) {
    return calendar[idx - 1]
  }
  return validationStart
}

const runCommand = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`)
  }
}

const shuffleInPlace = (list, rng) => {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = list[i]
    list[i] = list[j]
    list[j] = tmp
  }
  return list
}

const sampleSymbolsForLightMode = ({ allSymbols, symbolLimit, rng }) => {
  if (symbolLimit <= 0 || allSymbols.length <= symbolLimit) {
    return allSymbols
  }
  const byMarket = new Map()
  for (const item of allSymbols) {
    const market =
      String(item?.market ?? "")
        .trim()
        .toUpperCase() || "UNKNOWN"
    const list = byMarket.get(market) ?? []
    list.push(item)
    byMarket.set(market, list)
  }
  const marketKeys = Array.from(byMarket.keys()).sort()
  for (const key of marketKeys) {
    const rows = byMarket.get(key) ?? []
    shuffleInPlace(rows, rng)
  }
  const selected = []
  while (selected.length < symbolLimit) {
    let progressed = false
    for (const key of marketKeys) {
      const rows = byMarket.get(key) ?? []
      const next = rows.pop()
      if (!next) continue
      selected.push(next)
      progressed = true
      if (selected.length >= symbolLimit) {
        break
      }
    }
    if (!progressed) {
      break
    }
  }
  return selected
}

const normalizeShardConfig = ({ totalRaw, indexRaw }) => {
  const total = Math.max(1, Math.min(256, Math.floor(Number(totalRaw) || 1)))
  const rawIndex = Math.floor(Number(indexRaw) || 0)
  const index = ((rawIndex % total) + total) % total
  return { total, index }
}

const normalizeSymbolBucketConfig = ({ totalRaw, indexRaw }) => {
  const total = Math.max(1, Math.min(512, Math.floor(Number(totalRaw) || 1)))
  const rawIndex = Math.floor(Number(indexRaw) || 0)
  const index = ((rawIndex % total) + total) % total
  return { total, index }
}

const applySymbolBucket = ({ symbols, bucketTotal, bucketIndex }) => {
  const list = Array.isArray(symbols) ? [...symbols] : []
  if (!list.length || bucketTotal <= 1) {
    return list
  }
  list.sort((a, b) => {
    const left = String(a?.symbol ?? "").trim()
    const right = String(b?.symbol ?? "").trim()
    return left.localeCompare(right)
  })
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    if (i % bucketTotal === bucketIndex) {
      out.push(list[i])
    }
  }
  return out.length ? out : list
}

const applySymbolShard = ({ symbols, shardTotal, shardIndex, rng }) => {
  const list = Array.isArray(symbols) ? [...symbols] : []
  if (!list.length || shardTotal <= 1) {
    return list
  }
  shuffleInPlace(list, rng)
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    if (i % shardTotal === shardIndex) {
      out.push(list[i])
    }
  }
  return out
}

const countUniqueSymbolsAtDate = (rows, dateField, dateKey) => {
  const target = String(dateKey ?? "").trim()
  if (!target) {
    return 0
  }
  const set = new Set()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const rowDate = String(row?.[dateField] ?? "").trim()
    if (!symbol || rowDate !== target) continue
    set.add(symbol)
  }
  return set.size
}

const safeRatio = (num, den) => {
  const n = Number(num)
  const d = Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0
  }
  return n / d
}

const buildDataCoverageSnapshot = ({
  data,
  track,
  asOfDateKey,
  expectedSymbols,
}) => {
  const expectedRequested = Math.max(0, Number(expectedSymbols ?? 0) || 0)
  const candleAtAsOf = countUniqueSymbolsAtDate(
    data?.candles,
    "dateKey",
    asOfDateKey,
  )
  const expectedCount = Math.max(
    1,
    candleAtAsOf > 0 ? candleAtAsOf : expectedRequested,
  )
  const universeAtAsOf = countUniqueSymbolsAtDate(
    data?.universe,
    "tradingDateKey",
    asOfDateKey,
  )
  const featureAtAsOf = countUniqueSymbolsAtDate(
    data?.featureDays,
    "tradingDateKey",
    asOfDateKey,
  )
  const intradayAtAsOf = countUniqueSymbolsAtDate(
    data?.intradayProfiles,
    "tradingDateKey",
    asOfDateKey,
  )
  const price15AtAsOf =
    track === "GAP_15_BET"
      ? countUniqueSymbolsAtDate(data?.price15, "tradingDateKey", asOfDateKey)
      : 0
  const hourlyAtAsOf =
    track === "GAP_15_BET"
      ? countUniqueSymbolsAtDate(data?.hourly60m, "tradingDateKey", asOfDateKey)
      : 0
  return {
    expectedSymbolsRequested: expectedRequested,
    expectedSymbols: expectedCount,
    candleAtAsOf,
    universeAtAsOf,
    featureAtAsOf,
    intradayAtAsOf,
    price15AtAsOf,
    hourlyAtAsOf,
    universeVsExpected: safeRatio(universeAtAsOf, expectedCount),
    featureVsUniverse: safeRatio(featureAtAsOf, universeAtAsOf),
    intradayVsUniverse: safeRatio(intradayAtAsOf, universeAtAsOf),
    price15VsUniverse: safeRatio(price15AtAsOf, universeAtAsOf),
    hourlyVsUniverse: safeRatio(hourlyAtAsOf, universeAtAsOf),
  }
}

const validateDataCoverage = ({ track, coverage, thresholds }) => {
  const issues = []
  if (coverage.universeVsExpected < thresholds.universeVsExpected) {
    issues.push("UNIVERSE_COVERAGE_LOW")
  }
  if (coverage.featureVsUniverse < thresholds.featureVsUniverse) {
    issues.push("FEATURE_COVERAGE_LOW")
  }
  if (coverage.intradayVsUniverse < thresholds.intradayVsUniverse) {
    issues.push("INTRADAY_COVERAGE_LOW")
  }
  if (track === "GAP_15_BET") {
    if (coverage.price15VsUniverse < thresholds.price15VsUniverse) {
      issues.push("PRICE15_COVERAGE_LOW")
    }
    if (coverage.hourlyVsUniverse < thresholds.hourlyVsUniverse) {
      issues.push("HOURLY_COVERAGE_LOW")
    }
  }
  return {
    ok: issues.length === 0,
    issues,
  }
}

const resolveRunSummaryPath = ({ runDir, track, window, round }) =>
  path.join(
    runDir,
    "summaries",
    window,
    track,
    `round_${Math.max(1, Number(round ?? 1) || 1)}.json`,
  )

const resolveRunDiagnosticsPath = ({ runDir, track, window, round }) =>
  path.join(
    runDir,
    "diagnostics",
    window,
    track,
    `round_${Math.max(1, Number(round ?? 1) || 1)}.json`,
  )

const resolveLegacySummaryPath = ({ track, window }) =>
  path.join(rootDir, "artifacts", "backtest", track, `${window}_summary.json`)

const sampleRows = (rows, limit) => {
  const list = Array.isArray(rows) ? rows : []
  const cap = Math.max(0, Math.floor(Number(limit) || 0))
  if (cap <= 0 || list.length <= cap) {
    return {
      rows: list,
      total: list.length,
      truncated: false,
    }
  }
  return {
    rows: list.slice(0, cap),
    total: list.length,
    truncated: true,
  }
}

const writeEvaluationDiagnostics = ({
  runDir,
  track,
  window,
  round,
  evaluation,
  diagnostics,
  sampleLimit,
  meta,
}) => {
  const payloadDiagnostics = diagnostics ?? summarizeEvaluation(evaluation)
  const signalSample = sampleRows(evaluation?.signals, sampleLimit)
  const resultSample = sampleRows(evaluation?.results, sampleLimit)
  const output = {
    track,
    window,
    round,
    signalsCount: payloadDiagnostics.signalsCount ?? signalSample.total,
    resultsCount: payloadDiagnostics.resultsCount ?? resultSample.total,
    completedTrades: payloadDiagnostics.completedTrades ?? 0,
    noFillCount: payloadDiagnostics.noFillCount ?? 0,
    emptyWeekCount: payloadDiagnostics.emptyWeekCount ?? 0,
    reasonCounts: payloadDiagnostics.reasonCounts ?? {},
    noFillReasonCounts: payloadDiagnostics.noFillReasonCounts ?? {},
    statusCounts: payloadDiagnostics.statusCounts ?? {},
    outcomeCounts: payloadDiagnostics.outcomeCounts ?? {},
    signalsTotal: signalSample.total,
    signalsTruncated: signalSample.truncated,
    resultsTotal: resultSample.total,
    resultsTruncated: resultSample.truncated,
    signalsSample: signalSample.rows,
    resultsSample: resultSample.rows,
    ...(meta && typeof meta === "object" ? meta : {}),
  }
  const filePath = resolveRunDiagnosticsPath({
    runDir,
    track,
    window,
    round,
  })
  writeJson(filePath, output)
  return filePath
}

const toFiniteMetric = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const evaluateLegacyWeeklyGate = ({ track, weekSeries, targetPct, args }) => {
  if (track !== "SURGE_EOD") {
    return {
      enabled: false,
      pass: true,
      metrics: null,
      thresholds: null,
      reasons: [],
    }
  }

  const baseMinWeeksGE = 10
  const baseMinWeeklyPctThreshold = 0.1
  const baseRequireCompletedTradesEveryWeek = 1
  const minHighWeeks = Math.max(0, Math.floor(Number(args?.minHighWeeks) || 0))
  const nearHighWeeks = Math.max(
    0,
    Math.floor(Number(args?.nearHighWeeks) || 0),
  )
  const minOtherWeekPct = Number(args?.minOtherWeekPct ?? 0.01)
  const requireCompletedTradesEveryWeek = Math.max(
    1,
    Math.floor(Number(args?.requireCompletedTradesEveryWeek ?? 1) || 1),
  )
  const overlap = {
    minOtherWeekPctStrict:
      Number.isFinite(minOtherWeekPct) &&
      minOtherWeekPct > baseMinWeeklyPctThreshold,
    requireCompletedTradesStrict:
      requireCompletedTradesEveryWeek > baseRequireCompletedTradesEveryWeek,
    nearHighWeeksStrict: nearHighWeeks > baseMinWeeksGE,
  }
  const metrics = buildWeeklyMetrics({
    weekSeries,
    highWeekPct: Number(args?.highWeekPct ?? 10),
    minOtherWeekPct,
    requireCompletedTradesEveryWeek,
    targetPct,
  })
  const reasons = []
  if ((metrics.countHighWeeks ?? 0) < minHighWeeks) {
    reasons.push("LEGACY_MIN_HIGH_WEEKS")
  }
  if (
    overlap.minOtherWeekPctStrict &&
    (metrics.countWeeksBelowMinOther ?? 0) > 0
  ) {
    reasons.push("LEGACY_MIN_OTHER_WEEK_PCT")
  }
  if (
    overlap.requireCompletedTradesStrict &&
    (metrics.countWeeksMissingCompletedTrades ?? 0) > 0
  ) {
    reasons.push("LEGACY_MIN_COMPLETED_TRADES_EVERY_WEEK")
  }
  if (
    overlap.nearHighWeeksStrict &&
    (metrics.countWeeksGE ?? 0) < nearHighWeeks
  ) {
    reasons.push("LEGACY_NEAR_HIGH_WEEKS")
  }

  return {
    enabled: true,
    pass: reasons.length === 0,
    metrics,
    thresholds: {
      highWeekPct: Number(args?.highWeekPct ?? 10),
      minHighWeeks,
      minOtherWeekPct,
      requireCompletedTradesEveryWeek,
      nearHighWeeks,
      baseMinWeeksGE,
      baseMinWeeklyPctThreshold,
      baseRequireCompletedTradesEveryWeek,
      overlap,
      targetPct,
    },
    reasons,
  }
}

const buildContinuityGate = ({
  enabled,
  targetPct,
  targetStart,
  anchor,
  metrics,
  thresholds,
  isRequiredTrack,
}) => {
  if (!enabled || Number(targetPct) <= Number(targetStart)) {
    return { enabled, pass: true, reasons: [], compared: false }
  }
  if (!anchor?.metrics) {
    const missingAnchor = isRequiredTrack
    return {
      enabled,
      pass: !missingAnchor,
      reasons: missingAnchor ? ["MISSING_ANCHOR"] : [],
      compared: false,
    }
  }

  const anchorMetrics = anchor.metrics
  const currentMetrics = metrics ?? {}
  const reasons = []

  const minCountWeeksGE = Math.max(
    0,
    toFiniteMetric(anchorMetrics.countWeeksGE, 0) -
      toFiniteMetric(thresholds.maxRegressCountWeeksGE, 0),
  )
  if (toFiniteMetric(currentMetrics.countWeeksGE, 0) < minCountWeeksGE) {
    reasons.push("COUNT_WEEKS_REGRESS")
  }

  const minMinWeeklyPct =
    toFiniteMetric(anchorMetrics.minWeeklyPct, -999) -
    toFiniteMetric(thresholds.maxRegressMinWeeklyPct, 0)
  if (toFiniteMetric(currentMetrics.minWeeklyPct, -999) < minMinWeeklyPct) {
    reasons.push("MIN_WEEKLY_REGRESS")
  }

  const minTotalWeeklySumPct =
    toFiniteMetric(anchorMetrics.totalWeeklySumPct, -99999) -
    toFiniteMetric(thresholds.maxRegressTotalWeeklySumPct, 0)
  if (
    toFiniteMetric(currentMetrics.totalWeeklySumPct, -99999) <
    minTotalWeeklySumPct
  ) {
    reasons.push("TOTAL_WEEKLY_SUM_REGRESS")
  }

  const maxStopLikePct =
    toFiniteMetric(anchorMetrics.stopLikePct, 1) +
    toFiniteMetric(thresholds.maxRegressStopLikePct, 0)
  if (toFiniteMetric(currentMetrics.stopLikePct, 1) > maxStopLikePct) {
    reasons.push("STOP_LIKE_REGRESS")
  }

  const maxNoFillRate =
    toFiniteMetric(anchorMetrics.noFillRate, 1) +
    toFiniteMetric(thresholds.maxRegressNoFillRate, 0)
  if (toFiniteMetric(currentMetrics.noFillRate, 1) > maxNoFillRate) {
    reasons.push("NO_FILL_REGRESS")
  }

  return {
    enabled,
    pass: reasons.length === 0,
    reasons,
    compared: true,
    anchorTargetPct: anchor.targetPct ?? targetStart,
    anchorVersionLabel: anchor.versionLabel ?? null,
    anchorMetrics,
    thresholds,
  }
}

const computeDeployScore = ({ metrics, targetPct }) => {
  const m = metrics ?? {}
  return (
    toFiniteMetric(targetPct, 0) * 120 +
    toFiniteMetric(m.countWeeksGE, 0) * 6 +
    toFiniteMetric(m.totalWeeklySumPct, 0) * 1.5 +
    toFiniteMetric(m.minWeeklyPct, 0) * 4 +
    toFiniteMetric(m.completedTrades, 0) * 1.2 -
    toFiniteMetric(m.stopLikePct, 1) * 120 -
    toFiniteMetric(m.noFillRate, 1) * 80 -
    toFiniteMetric(m.emptyWeeksCount, 0) * 15
  )
}

const isLockboxCandidateViable = ({ entry, track }) => {
  const metrics =
    entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : null
  if (!metrics) return false
  const completedTrades = Number(metrics.completedTrades ?? 0) || 0
  const emptyWeeksCount = Number(metrics.emptyWeeksCount ?? 0) || 0
  const noFillRate = Number(metrics.noFillRate ?? Number.POSITIVE_INFINITY)
  const validationEarlyGatePass = metrics.validationEarlyGatePass !== false
  const countWeeksGE = Number(metrics.countWeeksGE ?? 0) || 0
  if (completedTrades <= 0) return false
  if (emptyWeeksCount >= 12) return false
  if (!Number.isFinite(noFillRate) || noFillRate >= 0.98) return false
  if (track === "GAP_15_BET" && !validationEarlyGatePass) return false
  if (track === "SURGE_EOD" && countWeeksGE <= 0 && completedTrades < 8) {
    return false
  }
  return true
}

const loadSymbols = async (prisma) => {
  const rows = await prisma.symbolMaster
    .findMany({
      where: { isListed: true },
      select: { symbol: true, name: true, market: true, type: true },
      orderBy: { symbol: "asc" },
    })
    .catch(() => [])
  return rows
    .filter((row) => isKrSixDigitSymbol(row.symbol))
    .filter((row) => {
      const type = String(row.type ?? "").toUpperCase()
      return type !== "ETF" && type !== "ETN"
    })
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      market: row.market,
    }))
}

const loadEligibleSymbols = async ({ prisma, asOfDateKey }) => {
  const dateKey = String(asOfDateKey ?? "").trim()
  if (!dateKey) {
    return []
  }
  const rows = await eligibleSymbolsForDate({
    dateKey,
    prisma,
    cfg: {
      excludeUnknownMarketCap: true,
    },
  }).catch(() => null)
  return Array.isArray(rows?.symbols)
    ? rows.symbols
        .filter((row) => isKrSixDigitSymbol(row?.symbol))
        .map((row) => ({
          symbol: String(row.symbol),
          name: String(row.name ?? ""),
          market: String(row.market ?? ""),
        }))
    : []
}

const buildCandleMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) continue
    const list = map.get(symbol) ?? []
    list.push({
      dateKey,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })
    map.set(symbol, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
  }
  return map
}

const buildPrice15Map = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    const price = Number(row?.price)
    if (!symbol || !dateKey || !Number.isFinite(price)) continue
    map.set(`${symbol}:${dateKey}`, price)
  }
  return map
}

const filterErrors = (rows, errorSet, dateField) => {
  return rows.filter((row) => {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.[dateField] ?? "").trim()
    if (!symbol || !dateKey) {
      return false
    }
    return !errorSet.has(`${symbol}:${dateKey}`)
  })
}

const loadTrackData = async ({
  prisma,
  track,
  asOfDateKey,
  horizonStart,
  windowEnd,
  symbols,
}) => {
  const symbolList = Array.isArray(symbols)
    ? symbols
        .map((symbol) => String(symbol ?? "").trim())
        .filter((symbol) => symbol.length > 0)
    : []
  const symbolWhere = symbolList.length ? { in: symbolList } : null
  const buildWhere = (dateField) => ({
    [dateField]: { gte: horizonStart, lte: windowEnd },
    ...(symbolWhere ? { symbol: symbolWhere } : {}),
  })
  const safeFindMany = async (label, task) => {
    try {
      return await task()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown")
      console.log(`[data-load] ${label} failed: ${message.slice(0, 240)}`)
      return []
    }
  }

  const errorRows = await safeFindMany("dataQualityFlagDay", () =>
    prisma.dataQualityFlagDay.findMany({
      where: {
        ...buildWhere("tradingDateKey"),
        severity: "ERROR",
      },
      select: { symbol: true, tradingDateKey: true },
    }),
  )
  const errorSet = new Set(
    errorRows.map((row) => `${row.symbol}:${row.tradingDateKey}`),
  )

  const adjustedRows = await safeFindMany("candleDailyAdjusted", () =>
    prisma.candleDailyAdjusted.findMany({
      where: buildWhere("tradingDateKey"),
      select: {
        symbol: true,
        tradingDateKey: true,
        ohlcv: true,
        adjFactor: true,
      },
    }),
  )
  const candles = adjustedRows.length
    ? adjustedRows.map((row) => ({
        symbol: row.symbol,
        dateKey: row.tradingDateKey,
        __adjusted: true,
        adjFactor: row.adjFactor ?? null,
        ...(row.ohlcv ?? {}),
      }))
    : await safeFindMany("candleDaily", () =>
        prisma.candleDaily.findMany({
          where: buildWhere("dateKey"),
          select: {
            symbol: true,
            dateKey: true,
            open: true,
            high: true,
            low: true,
            close: true,
            volume: true,
          },
        }),
      )

  const [universeRows, featureRows, intradayRows, price15Rows, hourlyRows] =
    await Promise.all([
      safeFindMany("universeKrxDay", () =>
        prisma.universeKrxDay.findMany({
          where: buildWhere("tradingDateKey"),
          select: {
            symbol: true,
            tradingDateKey: true,
            marketCapKrw: true,
            avgTradingValue20d: true,
          },
        }),
      ),
      safeFindMany("featureDay", () =>
        prisma.featureDay.findMany({
          where: buildWhere("tradingDateKey"),
          select: { symbol: true, tradingDateKey: true, features: true },
        }),
      ),
      safeFindMany("intradayProfileDay", () =>
        prisma.intradayProfileDay.findMany({
          where: buildWhere("tradingDateKey"),
          select: { symbol: true, tradingDateKey: true, seq: true },
        }),
      ),
      track === "GAP_15_BET"
        ? safeFindMany("price15", () =>
            prisma.price15.findMany({
              where: buildWhere("tradingDateKey"),
              select: { symbol: true, tradingDateKey: true, price: true },
            }),
          )
        : Promise.resolve([]),
      track === "GAP_15_BET"
        ? safeFindMany("candleHourly60m", () =>
            prisma.candleHourly60m.findMany({
              where: buildWhere("tradingDateKey"),
              select: {
                symbol: true,
                tradingDateKey: true,
                tsKst: true,
                open: true,
                high: true,
                low: true,
                close: true,
                volume: true,
              },
            }),
          )
        : Promise.resolve([]),
    ])

  return {
    candles: filterErrors(candles, errorSet, "dateKey"),
    universe: filterErrors(universeRows, errorSet, "tradingDateKey"),
    featureDays: filterErrors(featureRows, errorSet, "tradingDateKey"),
    intradayProfiles: filterErrors(intradayRows, errorSet, "tradingDateKey"),
    price15: filterErrors(price15Rows, errorSet, "tradingDateKey"),
    hourly60m: filterErrors(hourlyRows ?? [], errorSet, "tradingDateKey"),
  }
}

const loadLatestPatterns = async (
  prisma,
  track,
  asOfDateKey,
  latestDateKey,
  preferredRegime = null,
) => {
  // PatternRule/PatternShape are maintained only for PatternTrack enum values.
  // MOONSHOT runs via signal-gate flow and must not query these tables by track.
  if (!usesPatternDb(track)) {
    return null
  }
  const candidates = await prisma.patternRule.findMany({
    where: {
      track,
      NOT: { versionLabel: { startsWith: "autosearch:" } },
    },
    select: { version: true, versionLabel: true },
    orderBy: { version: "desc" },
  })
  const selection = selectPatternVersionLabel({
    candidates,
    asOfDateKey,
    // Prevent "historical asOf" from falling back to lookahead patterns.
    latestDateKey: latestDateKey ?? asOfDateKey,
    preferredRegime,
  })
  const version = selection?.version ?? null
  const versionLabel = selection?.versionLabel ?? null
  const useLabel = Boolean(versionLabel)
  if (!version && !versionLabel) {
    return null
  }
  const [rules, shapes] = await Promise.all([
    prisma.patternRule.findMany({
      where: { track, ...(useLabel ? { versionLabel } : { version }) },
      select: {
        payload: true,
        summary: true,
        precisionTest: true,
        supportTrain: true,
        precisionTrain: true,
      },
    }),
    prisma.patternShape.findMany({
      where: { track, ...(useLabel ? { versionLabel } : { version }) },
      select: {
        k: true,
        centroid: true,
        summary: true,
        precisionTest: true,
        supportTrain: true,
        precisionTrain: true,
      },
    }),
  ])
  return {
    version,
    versionLabel,
    rules: rules.map((row) => ({
      ...row.payload,
      summary: row.summary,
      precisionTest: row.precisionTest,
      supportTrain: row.supportTrain,
      precisionTrain: row.precisionTrain,
    })),
    shapes: shapes.map((row) => ({
      k: row.k,
      centroid: row.centroid,
      summary: row.summary,
      precisionTest: row.precisionTest,
      supportTrain: row.supportTrain,
      precisionTrain: row.precisionTrain,
    })),
  }
}

const loadPatternsByLabel = async (prisma, track, versionLabel) => {
  const label = String(versionLabel ?? "").trim()
  if (!label || !usesPatternDb(track)) {
    return null
  }
  const [rules, shapes] = await Promise.all([
    prisma.patternRule.findMany({
      where: { track, versionLabel: label },
      select: {
        payload: true,
        summary: true,
        precisionTest: true,
        supportTrain: true,
        precisionTrain: true,
      },
    }),
    prisma.patternShape.findMany({
      where: { track, versionLabel: label },
      select: {
        k: true,
        centroid: true,
        summary: true,
        precisionTest: true,
        supportTrain: true,
        precisionTrain: true,
      },
    }),
  ])
  if (!rules.length && !shapes.length) {
    return null
  }
  return {
    version: null,
    versionLabel: label,
    rules: rules.map((row) => ({
      ...row.payload,
      summary: row.summary,
      precisionTest: row.precisionTest,
      supportTrain: row.supportTrain,
      precisionTrain: row.precisionTrain,
    })),
    shapes: shapes.map((row) => ({
      k: row.k,
      centroid: row.centroid,
      summary: row.summary,
      precisionTest: row.precisionTest,
      supportTrain: row.supportTrain,
      precisionTrain: row.precisionTrain,
    })),
  }
}

const loadPatternPool = async ({
  prisma,
  track,
  asOfDateKey,
  latestDateKey,
  preferredRegime = null,
  maxLabels = 8,
}) => {
  if (!usesPatternDb(track)) {
    return []
  }
  const [rawRows, rawShapeRows] = await Promise.all([
    prisma.patternRule.findMany({
      where: {
        track,
        NOT: { versionLabel: { startsWith: "autosearch:" } },
      },
      select: { version: true, versionLabel: true },
      orderBy: { version: "desc" },
      take: Math.max(40, maxLabels * 12),
    }),
    prisma.patternShape.findMany({
      where: {
        track,
        NOT: { versionLabel: { startsWith: "autosearch:" } },
      },
      select: { version: true, versionLabel: true },
      orderBy: { version: "desc" },
      take: Math.max(24, maxLabels * 8),
    }),
  ])
  const seen = new Set()
  const candidates = []
  for (const row of rawRows) {
    const versionLabel = String(row?.versionLabel ?? "").trim()
    if (!versionLabel || seen.has(versionLabel)) {
      continue
    }
    seen.add(versionLabel)
    candidates.push({
      version: row?.version ?? null,
      versionLabel,
    })
  }
  if (!candidates.length) {
    return []
  }
  const shapeLabels = []
  const shapeSeen = new Set()
  for (const row of rawShapeRows) {
    const versionLabel = String(row?.versionLabel ?? "").trim()
    if (!versionLabel || shapeSeen.has(versionLabel)) {
      continue
    }
    shapeSeen.add(versionLabel)
    shapeLabels.push(versionLabel)
  }

  const labels = []
  const used = new Set()
  const pushLabel = (value) => {
    const label = String(value ?? "").trim()
    if (!label || used.has(label)) {
      return
    }
    used.add(label)
    labels.push(label)
  }

  const preferred = selectPatternVersionLabel({
    candidates,
    asOfDateKey,
    latestDateKey: latestDateKey ?? asOfDateKey,
    preferredRegime,
  })
  pushLabel(preferred?.versionLabel)
  const neutral = selectPatternVersionLabel({
    candidates,
    asOfDateKey,
    latestDateKey: latestDateKey ?? asOfDateKey,
    preferredRegime: null,
  })
  pushLabel(neutral?.versionLabel)
  for (const label of shapeLabels) {
    if (labels.length >= maxLabels) {
      break
    }
    pushLabel(label)
  }
  for (const candidate of candidates) {
    if (labels.length >= maxLabels) {
      break
    }
    pushLabel(candidate.versionLabel)
  }

  const pool = []
  for (const label of labels.slice(0, maxLabels)) {
    const snapshot = await loadPatternsByLabel(prisma, track, label)
    if (snapshot) {
      pool.push(snapshot)
    }
  }
  return pool
}

const persistPatterns = async ({
  prisma,
  track,
  version,
  versionLabel,
  patterns,
}) => {
  if (!usesPatternDb(track)) {
    return
  }
  await prisma.patternRule.deleteMany({
    where: { track, versionLabel },
  })
  await prisma.patternShape.deleteMany({
    where: { track, versionLabel },
  })
  if (patterns?.rules?.length) {
    await prisma.patternRule.createMany({
      data: patterns.rules.map((rule) => ({
        track,
        version,
        versionLabel,
        payload: { conditions: rule.conditions ?? [] },
        summary: String(rule.summary ?? "").slice(0, 180),
        supportTrain: Number(rule.supportTrain ?? 0) || 0,
        precisionTrain: Number(rule.precisionTrain ?? 0) || 0,
        precisionTest: Number(rule.precisionTest ?? 0) || 0,
      })),
    })
  }
  if (patterns?.shapes?.length) {
    await prisma.patternShape.createMany({
      data: patterns.shapes.map((shape) => ({
        track,
        version,
        versionLabel,
        k: Number(shape.k ?? 0) || 0,
        centroid: shape.centroid,
        summary: String(shape.summary ?? "").slice(0, 180),
        supportTrain: Number(shape.supportTrain ?? 0) || 0,
        precisionTrain: Number(shape.precisionTrain ?? 0) || 0,
        precisionTest: Number(shape.precisionTest ?? 0) || 0,
      })),
    })
  }
}

const normalizePolicyParamsForWindow = ({
  track,
  policyParams,
  policyChoice,
}) => {
  const choice =
    policyChoice && typeof policyChoice === "object" ? policyChoice : {}
  const params =
    policyParams && typeof policyParams === "object" ? policyParams : {}
  const fallbackCandidateCount = track === "SURGE_EOD" ? 200 : 500
  const fallbackLookback = track === "SURGE_EOD" ? 45 : 30
  const fallbackMinLiquidityM = track === "SURGE_EOD" ? 600 : 400
  return {
    candidateCount: Math.max(
      1,
      Math.floor(
        Number(
          params.candidateCount ??
            choice.candidateCount ??
            fallbackCandidateCount,
        ) || fallbackCandidateCount,
      ),
    ),
    lookbackDays: Math.max(
      5,
      Math.floor(
        Number(
          params.lookbackDays ?? choice.lookbackDays ?? fallbackLookback,
        ) || fallbackLookback,
      ),
    ),
    entryBandPct: toBandPct(params.entryBandPct ?? choice.entryWidthPct, 0.008),
    stopBandPct: toBandPct(params.stopBandPct ?? choice.stopPct, 0.03),
    targetBandPct: toBandPct(params.targetBandPct ?? choice.targetPct, 0.04),
    trailingPct: toBandPct(params.trailingPct ?? choice.trailingPct, 0.03),
    minRewardPct: toBandPct(
      params.minRewardPct ?? choice.minRewardPct,
      DEFAULT_LEVEL_POLICY.minRewardPct,
    ),
    minLiquidity: Math.max(
      100_000_000,
      Math.round(
        Number(
          params.minLiquidity ??
            (Number(choice.minLiquidityM ?? fallbackMinLiquidityM) || 0) *
              1_000_000,
        ) || 100_000_000,
      ),
    ),
    scoreEps: Math.max(0, Number(params.scoreEps ?? 1) || 1),
    vectorBins: Math.max(8, Math.floor(Number(params.vectorBins ?? 30) || 30)),
  }
}

const evaluateWindow = ({
  data,
  patterns,
  policyParams,
  policyChoice,
  entryWindowDays,
  track,
  calendar,
  weekKeys,
  windowStart,
  windowEnd,
  costModel,
}) => {
  const effectivePolicyParams = normalizePolicyParamsForWindow({
    track,
    policyParams,
    policyChoice,
  })
  const signals = []
  const candleMap = buildCandleMap(data.candles)
  const price15Map = buildPrice15Map(data.price15)
  let scopedPatterns = patterns
  if (track === "GAP_15_BET" && scopedPatterns) {
    try {
      assertGapPatternSafe({ patterns: scopedPatterns, windowStart })
    } catch (error) {
      const message = String(error?.message ?? "")
      if (message.startsWith("GAP_PATTERN_TRAIN_RANGE_MISSING")) {
        scopedPatterns = null
        console.warn(
          "[GAP] missing train range metadata; disabling GAP patterns for window " +
            String(windowStart),
        )
      } else if (message.startsWith("GAP_PATTERN_LOOKAHEAD")) {
        // In stage1 fallback flows, chart snapshots can be intentionally selected
        // before lookahead-safe filtering. Do not fail the whole run; disable GAP
        // patterns for this window and continue with non-pattern features.
        scopedPatterns = null
        console.warn(
          "[GAP] lookahead-unsafe pattern; disabling GAP patterns for window " +
            String(windowStart) +
            " (" +
            message +
            ")",
        )
      } else {
        throw error
      }
    }
  }

  for (const dateKey of calendar) {
    if (dateKey < windowStart || dateKey > windowEnd) {
      continue
    }
    const prevTradingDay =
      track === "GAP_15_BET"
        ? resolvePrevTradingDay({ calendar, dateKey })
        : null
    const gapData =
      track === "GAP_15_BET"
        ? buildGapDataForDate({
            data,
            symbols: data.symbols,
            dateKey,
            prevTradingDay,
            strictAfter1500: true,
          })
        : null
    const picks = recommendFromData({
      data:
        track === "GAP_15_BET"
          ? {
              ...data,
              featureDays: gapData?.featureDays ?? [],
              intradayProfiles: gapData?.intradayProfiles ?? [],
            }
          : data,
      asOfDateKey: dateKey,
      track,
      patterns: scopedPatterns,
      maxPicks: effectivePolicyParams.candidateCount,
      minLiquidity: effectivePolicyParams.minLiquidity,
      scoreEps: effectivePolicyParams.scoreEps,
      vectorBins: effectivePolicyParams.vectorBins,
      excludeUnknownMarketCap: true,
    })
    const maxDailyPicks = track === "SURGE_EOD" ? 1 : 1
    let emitted = 0
    for (const pick of picks) {
      if (emitted >= maxDailyPicks) {
        break
      }
      const rows = candleMap.get(pick.symbol) ?? []
      if (track === "GAP_15_BET") {
        const key = `${pick.symbol}:${dateKey}`
        const price15 = price15Map.get(key)
        if (!Number.isFinite(price15)) {
          continue
        }
        const prevClose = prevTradingDay
          ? (() => {
              for (let i = rows.length - 1; i >= 0; i -= 1) {
                const row = rows[i]
                if (row?.dateKey === prevTradingDay) {
                  const close = Number(row.close)
                  return Number.isFinite(close) ? close : null
                }
                if (row?.dateKey && row.dateKey < prevTradingDay) {
                  break
                }
              }
              return null
            })()
          : null
        const tradability = isTradableAt1500({
          price15,
          prevClose,
          lastHourCandle: gapData?.lastHourBySymbol?.get(pick.symbol) ?? null,
        })
        if (!tradability.tradable) {
          continue
        }
      }
      const planCandles =
        track === "GAP_15_BET"
          ? filterCandlesToPrevTradingDay({
              candles: rows,
              prevTradingDay,
            })
          : rows
      const plan = buildLevelPlan({
        candles: planCandles,
        asOfDateKey: dateKey,
        lookbackDays: effectivePolicyParams.lookbackDays,
        entryBandPct: effectivePolicyParams.entryBandPct,
        stopBandPct: effectivePolicyParams.stopBandPct,
        targetBandPct: effectivePolicyParams.targetBandPct,
        trailingPct: effectivePolicyParams.trailingPct,
        minRewardPct: effectivePolicyParams.minRewardPct,
      })
      if (!plan) {
        continue
      }
      const key = `${pick.symbol}:${dateKey}`
      if (track === "GAP_15_BET" && !price15Map.has(key)) {
        continue
      }
      signals.push({
        symbol: pick.symbol,
        tradingDateKey: dateKey,
        track,
        role: track === "SURGE_EOD" ? "CORE" : null,
        entryWindowDays,
        buyLow: plan.entryZone.low,
        buyHigh: plan.entryZone.high,
        stopLow: plan.stopZone.low,
        stopHigh: plan.stopZone.high,
        sellLow: plan.targetZone.low,
        sellHigh: plan.targetZone.high,
        rewardPct: plan.rewardPct,
      })
      emitted += 1
    }
  }

  const results = runBacktest({
    signals,
    candles: data.candles,
    price15: data.price15,
    calendar,
    costModel,
  })
  const weekSeries = buildWeeklySeries(results, {
    weekKeys,
    emptyWeekReturnPct: weekKeys ? -1 : null,
  })
  return { weekSeries, results, signals }
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "autosearch/go_live_autosearch" })
  assertNoKisRuntime({ script: "autosearch/go_live_autosearch" })
  const args = parseArgs()
  const stage = args.stage === "stage1" ? "stage1" : "stage2"
  const shardConfig = normalizeShardConfig({
    totalRaw: args.symbolShardTotal,
    indexRaw: args.symbolShardIndex,
  })
  const bucketConfig = normalizeSymbolBucketConfig({
    totalRaw: args.symbolBucketTotal,
    indexRaw: args.symbolBucketIndex,
  })
  const stage2FromPool = stage === "stage2" && Boolean(args.candidatePoolPath)
  const dataMode = resolveDataMode()
  const rampCostModel = resolveRampCostModel()
  const moonshotStrategyVersion = String(
    process.env.GOLIVE_MOONSHOT_STRATEGY_VERSION ??
      process.env.MOONSHOT_STRATEGY_VERSION ??
      "",
  ).trim()
  const moonshotStrategyPrefix = String(
    process.env.GOLIVE_MOONSHOT_STRATEGY_PREFIX ??
      process.env.MOONSHOT_STRATEGY_PREFIX ??
      "",
  ).trim()
  const allowUnscopedMoonshot = parseBooleanEnv(
    process.env.GOLIVE_ALLOW_UNSCOPED_MOONSHOT ?? "0",
  )
  const tracks = pickTracks(args.tracks)
  const passMode = args.passMode === "surge_only" ? "surge_only" : "all"
  const requiredTracksRaw =
    passMode === "surge_only"
      ? ["SURGE_EOD"]
      : tracks.filter(
          (track) =>
            track !== "MOONSHOT" ||
            args.moonshotTrackRequiredForCorePass === true,
        )
  const requiredTracks = requiredTracksRaw.length ? requiredTracksRaw : tracks
  if (!moonshotStrategyVersion && !moonshotStrategyPrefix) {
    const surgeRequired = requiredTracks.includes("SURGE_EOD")
    if (surgeRequired && !allowUnscopedMoonshot) {
      throw new Error(
        "MOONSHOT_STRATEGY_FILTER_REQUIRED (set GOLIVE_MOONSHOT_STRATEGY_VERSION or GOLIVE_MOONSHOT_STRATEGY_PREFIX, or set GOLIVE_ALLOW_UNSCOPED_MOONSHOT=1 explicitly)",
      )
    }
    console.log(
      "[golive] moonshot strategy filter disabled (no strategyVersion/prefix configured)",
    )
  }
  const runId = sanitizeRunId(args.runId) ?? createRunId()
  const runDir = path.join(rootDir, "artifacts", "autosearch", runId)
  const allowWrites = !args.dryRun
  runFailureContext = {
    runId,
    runDir,
    allowWrites,
    finalized: false,
  }
  const hostName = os.hostname()
  const totalMemBytes = os.totalmem() > 0 ? os.totalmem() : null
  const totalMemGi = totalMemBytes ? totalMemBytes / 1024 ** 3 : null
  const lowRam =
    Number.isFinite(totalMemGi) && totalMemGi !== null && totalMemGi <= 10
  const lightModeRequested = parseBooleanEnv(process.env.GOLIVE_LIGHT_MODE)
  const lightMode = false
  if (lightModeRequested) {
    console.log("[golive] GOLIVE_LIGHT_MODE ignored; light mode disabled")
  }
  if (lowRam) {
    console.log(
      `[golive] low RAM detected (${totalMemGi.toFixed(1)}Gi) but light mode is disabled`,
    )
    console.log("[golive] enabling low-RAM safety caps (search-space only)")
  }
  const lowRamSafetyCaps = lowRam
  if (
    Number.isFinite(args.evalWeeksRaw) &&
    args.evalWeeksRaw !== FIXED_WINDOW_MONTHS.validationWeeks
  ) {
    console.log(
      `[golive] --evalWeeks=${args.evalWeeksRaw} ignored; fixed evalWeeks=${FIXED_WINDOW_MONTHS.validationWeeks}`,
    )
  }
  const symbolLimit = clampInt(
    process.env.GOLIVE_SYMBOL_LIMIT,
    lowRamSafetyCaps ? 250 : 0,
    0,
    lowRamSafetyCaps ? 600 : 5000,
  )
  const maxCandidateCount = clampInt(
    process.env.GOLIVE_MAX_CANDIDATE_COUNT,
    lowRamSafetyCaps ? 500 : 2000,
    50,
    lowRamSafetyCaps ? 1000 : 5000,
  )
  const maxRuleCandidates = clampInt(
    process.env.GOLIVE_MAX_RULE_CANDIDATES,
    lowRamSafetyCaps ? 20000 : 100000,
    1000,
    lowRamSafetyCaps ? 40000 : 200000,
  )
  const maxShapeK = clampInt(
    process.env.GOLIVE_MAX_SHAPE_K,
    lowRamSafetyCaps ? 1400 : 3000,
    200,
    lowRamSafetyCaps ? 1800 : 5000,
  )
  const historyMonthsRequested = clampInt(
    process.env.GOLIVE_HISTORY_MONTHS,
    FIXED_WINDOW_MONTHS.historyMonths,
    12,
    120,
  )
  const historyMonths = FIXED_WINDOW_MONTHS.historyMonths
  if (historyMonthsRequested !== historyMonths) {
    console.log(
      `[golive] GOLIVE_HISTORY_MONTHS=${historyMonthsRequested} ignored; fixed historyMonths=${historyMonths}`,
    )
  }
  const disablePatternCache = parseBooleanEnv(
    process.env.GOLIVE_DISABLE_PATTERN_CACHE,
  )
  const entryWindowDays = clampInt(
    process.env.GOLIVE_EOD_ENTRY_WINDOW_DAYS,
    1,
    1,
    10,
  )
  const dataCoverageThresholds = {
    universeVsExpected: clampRatio(
      process.env.GOLIVE_MIN_UNIVERSE_COVERAGE,
      0.9,
    ),
    featureVsUniverse: clampRatio(process.env.GOLIVE_MIN_FEATURE_COVERAGE, 0.9),
    intradayVsUniverse: clampRatio(
      process.env.GOLIVE_MIN_INTRADAY_COVERAGE,
      0.9,
    ),
    price15VsUniverse: clampRatio(process.env.GOLIVE_MIN_PRICE15_COVERAGE, 0.9),
    hourlyVsUniverse: clampRatio(process.env.GOLIVE_MIN_HOURLY_COVERAGE, 0.85),
  }
  const gapActivationMinCoverage = clampRatio(
    process.env.GOLIVE_MIN_GAP_ACTIVATION_COVERAGE,
    dataCoverageThresholds.price15VsUniverse,
  )
  const minValidationTradesBase = clampInt(
    process.env.GOLIVE_MIN_VALIDATION_TRADES,
    1,
    1,
    100,
  )
  const minValidationTrades = stage2FromPool
    ? Math.max(minValidationTradesBase, 8)
    : minValidationTradesBase
  const minWorst2wAvgPct = clampNumber(
    process.env.GOLIVE_MIN_WORST2W_AVG_PCT,
    args.minWorst2wAvgPct,
    -100,
    100,
  )
  const worst2wDistEnabled = parseBooleanEnv(
    process.env.GOLIVE_WORST2W_DIST_ENABLED ?? (stage === "stage2" ? "1" : "0"),
  )
  const worst2wDistConfig = {
    enabled: worst2wDistEnabled,
    alpha: clampNumber(process.env.GOLIVE_WORST2W_DIST_ALPHA, 0.05, 1e-6, 0.5),
    p0: clampNumber(process.env.GOLIVE_WORST2W_DIST_P0, 0.95, 0.5, 0.9999),
    lcbQuantile: clampNumber(process.env.GOLIVE_WORST2W_DIST_Q, 0.1, 0.01, 0.5),
    nRef: clampInt(
      process.env.GOLIVE_WORST2W_DIST_NREF_WEEKS,
      args.evalWeeks,
      2,
      104,
    ),
    cheapB: clampInt(process.env.GOLIVE_WORST2W_DIST_CHEAP_B, 160, 20, 10000),
    cheapM: clampInt(process.env.GOLIVE_WORST2W_DIST_CHEAP_M, 8, 1, 256),
    fullB: clampInt(process.env.GOLIVE_WORST2W_DIST_FULL_B, 800, 40, 20000),
    fullM: clampInt(process.env.GOLIVE_WORST2W_DIST_FULL_M, 20, 1, 512),
    sequential: parseBooleanEnv(
      process.env.GOLIVE_WORST2W_DIST_SEQUENTIAL ?? "1",
    ),
    passProbMargin: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_PASS_MARGIN,
      0.02,
      0.001,
      0.2,
    ),
    lcbMarginPct: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_LCB_MARGIN_PCT,
      0.3,
      0.01,
      5,
    ),
    regimeShiftRatio: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_REGIME_SHIFT_RATIO,
      1.7,
      1.1,
      5,
    ),
    regimeMixWeight: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_REGIME_MIX_WEIGHT,
      0.7,
      0.5,
      1,
    ),
    recentSegmentSize: clampInt(
      process.env.GOLIVE_WORST2W_DIST_RECENT_SEGMENT_WEEKS,
      Math.max(6, Math.floor(args.evalWeeks / 2)),
      4,
      52,
    ),
    executionSigmaPct: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_EXEC_SIGMA_PCT,
      0.08,
      0,
      5,
    ),
    baseBps: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_BASE_BPS,
      0,
      -100,
      100,
    ),
    pessimisticBps: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_PESS_BPS,
      6,
      -100,
      200,
    ),
    optimisticBps: clampNumber(
      process.env.GOLIVE_WORST2W_DIST_OPT_BPS,
      -2,
      -200,
      100,
    ),
    seed: clampInt(process.env.GOLIVE_WORST2W_DIST_SEED, 17, 1, 0x7fffffff),
    runWhenClassicFail: parseBooleanEnv(
      process.env.GOLIVE_WORST2W_DIST_RUN_WHEN_CLASSIC_FAIL ?? "0",
    ),
  }
  const noTradeTerminateRounds = clampInt(
    process.env.GOLIVE_NO_TRADE_TERMINATE_ROUNDS,
    stage2FromPool ? 12 : 3,
    1,
    60,
  )
  const weakSignalTerminateRounds = clampInt(
    process.env.GOLIVE_WEAK_SIGNAL_TERMINATE_ROUNDS,
    stage2FromPool ? 16 : 8,
    2,
    50,
  )
  const minRoundsBeforeSurgeGateTerminate = clampInt(
    process.env.GOLIVE_MIN_ROUNDS_BEFORE_SURGE_GATE_TERMINATION,
    stage2FromPool ? 3 : 2,
    1,
    200,
  )
  const continuityGateEnabled = parseBooleanEnv(
    process.env.GOLIVE_CONTINUITY_GATE ?? "1",
  )
  const continuityMaxRegressMinWeeklyPctRaw = Number(
    process.env.GOLIVE_CONTINUITY_MAX_REGRESS_MIN_WEEKLY_PCT,
  )
  const continuityMaxRegressTotalWeeklySumPctRaw = Number(
    process.env.GOLIVE_CONTINUITY_MAX_REGRESS_TOTAL_WEEKLY_SUM_PCT,
  )
  const continuityThresholds = {
    maxRegressCountWeeksGE: clampInt(
      process.env.GOLIVE_CONTINUITY_MAX_REGRESS_COUNT_WEEKS,
      1,
      0,
      20,
    ),
    maxRegressMinWeeklyPct: Number.isFinite(continuityMaxRegressMinWeeklyPctRaw)
      ? Math.max(0, continuityMaxRegressMinWeeklyPctRaw)
      : 0.5,
    maxRegressTotalWeeklySumPct: Number.isFinite(
      continuityMaxRegressTotalWeeklySumPctRaw,
    )
      ? Math.max(0, continuityMaxRegressTotalWeeklySumPctRaw)
      : 8,
    maxRegressStopLikePct: clampRatio(
      process.env.GOLIVE_CONTINUITY_MAX_REGRESS_STOPLIKE_PCT,
      0.08,
    ),
    maxRegressNoFillRate: clampRatio(
      process.env.GOLIVE_CONTINUITY_MAX_REGRESS_NOFILL_RATE,
      0.08,
    ),
  }
  const deployPickMode =
    String(process.env.GOLIVE_DEPLOY_PICK_MODE ?? "stability")
      .trim()
      .toLowerCase() === "latest"
      ? "latest"
      : "stability"
  const poolActiveLimitByTrack = {
    SURGE_EOD: clampInt(process.env.GOLIVE_POOL_ACTIVE_LIMIT_SURGE, 5, 1, 32),
    GAP_15_BET: clampInt(process.env.GOLIVE_POOL_ACTIVE_LIMIT_GAP, 3, 1, 32),
  }
  const poolBenchLimitByTrack = {
    SURGE_EOD: clampInt(process.env.GOLIVE_POOL_BENCH_LIMIT_SURGE, 10, 0, 128),
    GAP_15_BET: clampInt(process.env.GOLIVE_POOL_BENCH_LIMIT_GAP, 6, 0, 128),
  }
  const poolMinAliveByTrack = {
    SURGE_EOD: clampInt(process.env.GOLIVE_POOL_MIN_ALIVE_SURGE, 3, 1, 32),
    GAP_15_BET: clampInt(process.env.GOLIVE_POOL_MIN_ALIVE_GAP, 2, 1, 32),
  }
  const stage2TopKByTrack = {
    SURGE_EOD: clampInt(process.env.GOLIVE_STAGE2_TOPK_SURGE, 4, 1, 32),
    GAP_15_BET: clampInt(process.env.GOLIVE_STAGE2_TOPK_GAP, 3, 1, 32),
  }
  const gapChartSafePoolCooldownRounds = clampInt(
    process.env.GOLIVE_GAP_CHART_SAFEPOOL_COOLDOWN_ROUNDS,
    6,
    1,
    120,
  )
  const poolHistoryLimitByTrack = {
    SURGE_EOD: clampInt(
      process.env.GOLIVE_POOL_HISTORY_LIMIT_SURGE,
      64,
      8,
      512,
    ),
    GAP_15_BET: clampInt(process.env.GOLIVE_POOL_HISTORY_LIMIT_GAP, 64, 8, 512),
  }
  const stabilityMinImproveScore = clampNumber(
    process.env.GOLIVE_STABILITY_MIN_IMPROVE_SCORE,
    8,
    0,
    5000,
  )
  const stabilityMinHoldRounds = clampInt(
    process.env.GOLIVE_STABILITY_MIN_HOLD_ROUNDS,
    2,
    0,
    50,
  )
  const adaptiveBudgetEnabled = parseBooleanEnv(
    process.env.GOLIVE_ADAPTIVE_BUDGET ?? "1",
  )
  const earlyGateEnabled = parseBooleanEnv(
    process.env.GOLIVE_EARLY_GATE_ENABLED ?? "1",
  )
  const earlyGateWindowWeeks = clampInt(
    process.env.GOLIVE_EARLY_GATE_WINDOW_WEEKS,
    8,
    1,
    args.evalWeeks,
  )
  const earlyGateMinWeeksForTradeCheck = clampInt(
    process.env.GOLIVE_EARLY_GATE_MIN_WEEKS,
    4,
    1,
    args.evalWeeks,
  )
  const earlyGateMinCompletedTradesInWindow = clampInt(
    process.env.GOLIVE_EARLY_GATE_MIN_COMPLETED_TRADES,
    1,
    0,
    20,
  )
  const earlyGateConfig = {
    enabled: earlyGateEnabled,
    windowWeeks: earlyGateWindowWeeks,
    minWeeksForTradeCheck: Math.min(
      earlyGateWindowWeeks,
      earlyGateMinWeeksForTradeCheck,
    ),
    minCompletedTradesInWindow: earlyGateMinCompletedTradesInWindow,
  }
  const evalDiagnosticSampleLimit = clampInt(
    process.env.GOLIVE_EVAL_DIAGNOSTIC_SAMPLE_LIMIT,
    200,
    20,
    5000,
  )
  const stage2PoolTrackLimit = clampInt(
    process.env.GOLIVE_STAGE2_POOL_TRACK_LIMIT,
    5000,
    100,
    50000,
  )
  const stage2PoolNoTradeCoverageFloor = clampNumber(
    process.env.GOLIVE_STAGE2_POOL_NOTRADE_COVERAGE_FLOOR,
    0.4,
    0.05,
    1,
  )
  const stage2PoolNoTradeMinRounds = clampInt(
    process.env.GOLIVE_STAGE2_POOL_NOTRADE_MIN_ROUNDS,
    stage2FromPool
      ? Math.max(12, noTradeTerminateRounds)
      : noTradeTerminateRounds,
    1,
    200,
  )
  const stage2PoolJsonMaxBytes =
    clampInt(process.env.GOLIVE_STAGE2_POOL_JSON_MAX_MB, 64, 1, 512) *
    1024 *
    1024
  const staleRunningHours = clampInt(
    process.env.GOLIVE_STALE_RUNNING_HOURS,
    12,
    1,
    168,
  )
  const memoryHeadroomMb = clampInt(
    process.env.GOLIVE_MIN_HEAP_HEADROOM_MB,
    lowRamSafetyCaps ? 320 : 256,
    64,
    2048,
  )
  const memoryHeadroomRatio = clampRatio(
    process.env.GOLIVE_MIN_HEAP_HEADROOM_RATIO,
    lowRamSafetyCaps ? 0.18 : 0.12,
  )
  const maxRssMb = clampInt(
    process.env.GOLIVE_MAX_RSS_MB,
    lowRamSafetyCaps ? 5600 : 12288,
    512,
    65536,
  )
  const maxRssRatio = Math.max(
    0.2,
    clampRatio(process.env.GOLIVE_MAX_RSS_RATIO, lowRamSafetyCaps ? 0.7 : 0.85),
  )
  const minHeadroomBytes = memoryHeadroomMb * 1024 * 1024
  const maxRssBytes = Math.min(
    maxRssMb * 1024 * 1024,
    totalMemBytes
      ? Math.floor(totalMemBytes * maxRssRatio)
      : Number.POSITIVE_INFINITY,
  )
  const configSanity = runConfigSanityCheck({
    args,
    tracks,
    requiredTracks,
    minValidationTrades,
    noTradeTerminateRounds,
    weakSignalTerminateRounds,
    continuityGateEnabled,
    continuityThresholds,
    gapActivationMinCoverage,
    dataCoverageThresholds,
    symbolLimit,
    maxCandidateCount,
    maxRuleCandidates,
    maxShapeK,
    memoryHeadroomMb,
    maxRssMb: Math.round(maxRssBytes / 1024 / 1024),
    lowRamSafetyCaps,
    stage2FromPool,
    stage2PoolTrackLimit,
    stage2PoolNoTradeCoverageFloor,
    stage2PoolNoTradeMinRounds,
    stage2PoolJsonMaxBytes,
    earlyGateConfig,
  })
  if (configSanity.warnings.length) {
    console.log(
      `[golive] config sanity warnings: ${configSanity.warnings.join(",")}`,
    )
  }
  writeJson(path.join(runDir, "run_config_sanity.json"), configSanity)
  if (!configSanity.pass) {
    throw new Error(
      `CONFIG_SANITY_FAILED ${configSanity.errors.join(",") || "UNKNOWN"}`,
    )
  }
  const checkMemory = (stage, { log = false } = {}) => {
    const snap = enforceMemoryHeadroom({
      stage,
      minHeadroomBytes,
      minHeadroomRatio: memoryHeadroomRatio,
      maxRssBytes,
    })
    if (log) {
      logMemorySnapshot(stage, snap)
    }
    return snap
  }

  const prisma = new PrismaClient()
  await prisma.$queryRaw`SELECT 1`
  checkMemory("bootstrap", { log: true })
  const staleDefaultAsOfGuard = parseBooleanEnv(
    process.env.GOLIVE_GUARD_STALE_DEFAULT_ASOF ?? "1",
  )
  const latestMarketDataDateKey = await resolveLatestMarketDataDateKey(prisma)
  const normalizedAsOfInput = normalizeDateKey(args.asOfInput)
  if (
    staleDefaultAsOfGuard &&
    !args.asOfExplicit &&
    normalizedAsOfInput &&
    latestMarketDataDateKey &&
    normalizedAsOfInput < latestMarketDataDateKey
  ) {
    throw new Error(
      `STALE_DEFAULT_ASOF script=go_live_autosearch defaultAsOf=${normalizedAsOfInput} latestData=${latestMarketDataDateKey} (pass --asof=YYYY-MM-DD explicitly or update DEFAULT_RAMP_ASOF_DATE_KEY)`,
    )
  }

  if (allowWrites) {
    const cleanup = await reconcileOrphanRunningRuns({
      prisma,
      hostName,
      staleRunningHours,
    })
    if (cleanup.reconciled > 0 || cleanup.failed > 0) {
      console.log(
        `[golive] reconciled orphan RUNNING runs: ${cleanup.reconciled}/${cleanup.scanned} failed=${cleanup.failed}`,
      )
    }
  }

  const configPayload = {
    runId,
    dataMode,
    tracks,
    passMode,
    args: {
      stage,
      evalWeeks: args.evalWeeks,
      evalWeeksRequested: args.evalWeeksRaw,
      highWeekPct: args.highWeekPct,
      minHighWeeks: args.minHighWeeks,
      minOtherWeekPct: args.minOtherWeekPct,
      requireCompletedTradesEveryWeek: args.requireCompletedTradesEveryWeek,
      minWorst2wAvgPct: args.minWorst2wAvgPct,
      nearHighWeeks: args.nearHighWeeks,
      plateauRounds: args.plateauRounds,
      improveEpsHighWeeks: args.improveEpsHighWeeks,
      improveEpsSumPct: args.improveEpsSumPct,
      seed: args.seed,
      symbolSeed: args.symbolSeed,
      symbolShardTotal: shardConfig.total,
      symbolShardIndex: shardConfig.index,
      symbolBucketTotal: bucketConfig.total,
      symbolBucketIndex: bucketConfig.index,
      candidatePoolPath: args.candidatePoolPath,
      printEvery: args.printEvery,
      asOfInput: args.asOfInput,
      asOfExplicit: args.asOfExplicit,
      targetStart: args.targetStart,
      dryRun: args.dryRun,
      maxRounds: args.maxRounds,
    },
    tuning: {
      lightMode,
      costModel: rampCostModel,
      moonshotStrategyVersion: moonshotStrategyVersion || null,
      moonshotStrategyPrefix: moonshotStrategyPrefix || null,
      allowUnscopedMoonshot,
      symbolLimit,
      maxCandidateCount,
      maxRuleCandidates,
      maxShapeK,
      historyMonths,
      historyMonthsRequested,
      disablePatternCache,
      entryWindowDays,
      dataCoverageThresholds,
      gapActivationMinCoverage,
      minValidationTradesBase,
      minValidationTrades,
      minWorst2wAvgPct,
      worst2wDistConfig,
      noTradeTerminateRounds,
      weakSignalTerminateRounds,
      minRoundsBeforeSurgeGateTerminate,
      continuityGateEnabled,
      continuityThresholds,
      deployPickMode,
      stabilityMinImproveScore,
      stabilityMinHoldRounds,
      adaptiveBudgetEnabled,
      adaptiveBudgetScales: ADAPTIVE_BUDGET_SCALES,
      earlyGateConfig,
      evalDiagnosticSampleLimit,
      staleRunningHours,
      lowRamSafetyCaps,
      stage2FromPool,
      stage2PoolTrackLimit,
      stage2PoolJsonMaxBytes,
      stage2PoolNoTradeCoverageFloor,
      stage2PoolNoTradeMinRounds,
      staleDefaultAsOfGuard,
      latestMarketDataDateKey,
      memoryHeadroomMb,
      memoryHeadroomRatio,
      maxRssMb,
      maxRssRatio,
      maxRssEffectiveMb: Math.round(maxRssBytes / 1024 / 1024),
      configSanity,
    },
  }

  writeJson(path.join(runDir, "run_config.json"), configPayload)

  if (allowWrites) {
    await prisma.autoSearchRun.create({
      data: {
        runId,
        status: "RUNNING",
        target: configPayload,
        notes: {
          pid: process.pid,
          host: hostName,
          lightModeForcedOff: true,
        },
      },
    })
  }

  const fallbackPrice15 = await prisma.price15
    .findFirst({
      orderBy: { tradingDateKey: "desc" },
      select: { tradingDateKey: true },
    })
    .then((row) => row?.tradingDateKey ?? null)
    .catch(() => null)
  const fallbackSurge = await resolveLastTradingDateKey({
    prisma,
    asOfDateKey: resolveTodayKstDateKey(),
  })
  const resolveTrackAsOfDateKey = async (track) => {
    if (track === "GAP_15_BET" && isLastTradingDayToken(args.asOfInput)) {
      return fallbackPrice15
    }
    return resolveAsOfDateKey({
      prisma,
      asOfInput: args.asOfInput,
      fallbackDateKey: track === "GAP_15_BET" ? fallbackPrice15 : fallbackSurge,
    })
  }

  const symbolAnchorTrack = tracks.includes("SURGE_EOD")
    ? "SURGE_EOD"
    : tracks[0]
  const symbolAnchorAsOf = symbolAnchorTrack
    ? await resolveTrackAsOfDateKey(symbolAnchorTrack)
    : null
  const eligibleSymbols = await loadEligibleSymbols({
    prisma,
    asOfDateKey: symbolAnchorAsOf,
  })
  const allSymbols = eligibleSymbols.length
    ? eligibleSymbols
    : await loadSymbols(prisma)
  const symbolRng = buildRng(`symbols:${args.symbolSeed}`)
  const bucketedSymbols = applySymbolBucket({
    symbols: allSymbols,
    bucketTotal: bucketConfig.total,
    bucketIndex: bucketConfig.index,
  })
  const sampledSymbols = sampleSymbolsForLightMode({
    allSymbols: bucketedSymbols,
    symbolLimit,
    rng: symbolRng,
  })
  let symbols = applySymbolShard({
    symbols: sampledSymbols,
    shardTotal: shardConfig.total,
    shardIndex: shardConfig.index,
    rng: symbolRng,
  })
  if (!symbols.length && sampledSymbols.length) {
    symbols = [sampledSymbols[shardConfig.index % sampledSymbols.length]]
  }
  if (!symbols.length) {
    throw new Error("SymbolMaster missing")
  }
  console.log(
    `[symbol-pool] source=${eligibleSymbols.length ? "eligible" : "symbolMaster"} anchorAsOf=${symbolAnchorAsOf ?? "NONE"} total=${allSymbols.length} bucket=${bucketConfig.index + 1}/${bucketConfig.total} bucketSymbols=${bucketedSymbols.length} sampled=${sampledSymbols.length} shard=${shardConfig.index + 1}/${shardConfig.total} shardSymbols=${symbols.length} symbolSeed=${args.symbolSeed}`,
  )
  checkMemory("post-symbol-pool", { log: true })
  const symbolCodes = symbols.map((item) => item.symbol)

  const trackContext = new Map()
  for (const track of tracks) {
    if (track === "GAP_15_BET" && !fallbackPrice15) {
      throw new Error("Price15 missing")
    }
    const asOfDateKey = await resolveTrackAsOfDateKey(track)
    if (!asOfDateKey) {
      throw new Error(`Missing asOfDateKey for ${track}`)
    }

    const regimeInfo = await resolveMarketRegimeForDate({
      prisma,
      dateKey: asOfDateKey,
    })
    const preferredRegime = regimeInfo.regime ?? null
    console.log(
      `[regime] track=${track} asOf=${asOfDateKey} regime=${preferredRegime ?? "UNKNOWN"} sourceDateKey=${regimeInfo.dateKey ?? "NONE"}`,
    )
    const horizonStart =
      shiftDateKeyByMonths(asOfDateKey, -historyMonths) ?? asOfDateKey
    const calendar = await resolveTradingCalendarRange({
      prisma,
      fromDateKey: horizonStart,
      toDateKey: asOfDateKey,
    })
    const availableWeeks = listWeekKeys({ calendar, asOfDateKey })
    const windows = resolveValidationLockbox({
      calendar,
      asOfDateKey,
      weekCount: FIXED_WINDOW_MONTHS.validationWeeks,
    })
    const windowMeta = windows
      ? { ok: true, reason: null, weeksFound: availableWeeks.length }
      : {
          ok: false,
          reason: "INSUFFICIENT_DATA_WEEKS",
          weeksFound: availableWeeks.length,
        }
    if (!windowMeta.ok) {
      trackContext.set(track, {
        asOfDateKey,
        regime: preferredRegime,
        regimeDateKey: regimeInfo.dateKey ?? null,
        horizonStart,
        trainAsOfDateKey: null,
        calendar,
        windows: null,
        windowMeta,
        data: null,
        patterns: null,
        patternPool: [],
        dataQuality: null,
      })
      continue
    }

    const trainAsOfDateKey = resolveTrainAsOf(
      calendar,
      windows.validation.fromDateKey,
    )
    const latestPatterns = await loadLatestPatterns(
      prisma,
      track,
      trainAsOfDateKey ?? asOfDateKey,
      asOfDateKey,
      preferredRegime,
    )
    const patternPool = lowRamSafetyCaps
      ? await loadPatternPool({
          prisma,
          track,
          asOfDateKey: trainAsOfDateKey ?? asOfDateKey,
          latestDateKey: asOfDateKey,
          preferredRegime,
          maxLabels: track === "SURGE_EOD" ? 8 : 4,
        })
      : []
    const initialPatterns = latestPatterns ?? patternPool[0] ?? null
    if (lowRamSafetyCaps && !initialPatterns && usesPatternDb(track)) {
      trackContext.set(track, {
        asOfDateKey,
        regime: preferredRegime,
        regimeDateKey: regimeInfo.dateKey ?? null,
        horizonStart,
        trainAsOfDateKey,
        calendar,
        windows,
        windowMeta: {
          ok: false,
          reason: "PATTERN_MISSING_LOW_RAM",
          weeksFound: availableWeeks.length,
          missing: ["PATTERN_MISSING"],
        },
        data: null,
        patterns: null,
        patternPool: [],
        dataQuality: null,
      })
      console.log(
        `[data-ready] blocked ${track} asOf=${asOfDateKey} reason=PATTERN_MISSING_LOW_RAM`,
      )
      continue
    } else if (lowRamSafetyCaps && !initialPatterns && !usesPatternDb(track)) {
      console.log(
        `[data-ready] pattern-bypass ${track} asOf=${asOfDateKey} reason=PATTERN_DB_UNSUPPORTED`,
      )
    }
    const compactStartCandidate = shiftDateKeyByMonths(
      windows.validation.fromDateKey,
      -8,
    )
    const dataHorizonStart =
      lowRamSafetyCaps && initialPatterns && compactStartCandidate
        ? compactStartCandidate > horizonStart
          ? compactStartCandidate
          : horizonStart
        : horizonStart
    if (dataHorizonStart !== horizonStart) {
      console.log(
        `[data-load] compact ${track} from=${dataHorizonStart} baseFrom=${horizonStart} validationFrom=${windows.validation.fromDateKey}`,
      )
    }
    const windowEnd = windows.lockbox.toDateKey
    const data = await loadTrackData({
      prisma,
      track,
      asOfDateKey,
      horizonStart: dataHorizonStart,
      windowEnd,
      symbols: symbolCodes,
    })
    checkMemory(`data-loaded:${track}`, { log: true })

    const dataCoverage = buildDataCoverageSnapshot({
      data,
      track,
      asOfDateKey,
      expectedSymbols: symbolCodes.length,
    })
    const coreMissing = []
    if (!data.candles.length) coreMissing.push("CANDLE_MISSING")
    if (!data.universe.length) coreMissing.push("UNIVERSE_MISSING")
    if (!data.featureDays.length) coreMissing.push("FEATURE_MISSING")
    if (!data.intradayProfiles.length) coreMissing.push("INTRADAY_MISSING")
    if (track === "GAP_15_BET" && !data.price15.length) {
      coreMissing.push("PRICE15_MISSING")
    }
    const readiness = validateDataCoverage({
      track,
      coverage: dataCoverage,
      thresholds: dataCoverageThresholds,
    })
    if (coreMissing.length || !readiness.ok) {
      const windowMetaWithData = {
        ok: false,
        reason: coreMissing.length ? "MISSING_DATA" : "DATA_COVERAGE_LOW",
        weeksFound: availableWeeks.length,
        missing: coreMissing,
        coverage: dataCoverage,
        coverageIssues: readiness.issues,
      }
      trackContext.set(track, {
        asOfDateKey,
        regime: preferredRegime,
        regimeDateKey: regimeInfo.dateKey ?? null,
        horizonStart,
        dataHorizonStart,
        trainAsOfDateKey: null,
        calendar,
        windows,
        windowMeta: windowMetaWithData,
        data: null,
        patterns: null,
        patternPool: [],
        dataQuality: {
          coverage: dataCoverage,
          coverageIssues: readiness.issues,
        },
      })
      console.log(
        "[data-ready] blocked " +
          track +
          " asOf=" +
          asOfDateKey +
          " reason=" +
          windowMetaWithData.reason +
          " missing=" +
          (coreMissing.join("|") || "NONE") +
          " issues=" +
          (readiness.issues.join("|") || "NONE"),
      )
      continue
    }

    trackContext.set(track, {
      asOfDateKey,
      regime: preferredRegime,
      regimeDateKey: regimeInfo.dateKey ?? null,
      horizonStart,
      dataHorizonStart,
      trainAsOfDateKey,
      calendar,
      windows,
      windowMeta,
      data: {
        ...data,
        symbols,
      },
      patterns: initialPatterns,
      patternPool,
      dataQuality: {
        coverage: dataCoverage,
        coverageIssues: [],
      },
    })
  }

  const blockedTracks = requiredTracks.filter((track) => {
    const ctx = trackContext.get(track)
    return !ctx || ctx.windowMeta?.ok === false
  })
  if (blockedTracks.length) {
    const blockedReasons = blockedTracks.map((track) => {
      const ctx = trackContext.get(track)
      const reason = String(ctx?.windowMeta?.reason ?? "UNKNOWN")
      const issues = Array.isArray(ctx?.windowMeta?.coverageIssues)
        ? ctx.windowMeta.coverageIssues.join("|")
        : ""
      return issues ? track + ":" + reason + ":" + issues : track + ":" + reason
    })
    const blockedFailureCounter = new Map()
    const blockedFailureByTrack = new Map()
    for (const track of blockedTracks) {
      const ctx = trackContext.get(track)
      const reason = String(ctx?.windowMeta?.reason ?? "UNKNOWN")
      const issues = Array.isArray(ctx?.windowMeta?.coverageIssues)
        ? ctx.windowMeta.coverageIssues
        : []
      const reasonKeys = [
        reason,
        ...issues.map((issue) => `COVERAGE_${String(issue ?? "").trim()}`),
      ].filter((item) => String(item ?? "").trim())
      const trackCounter = blockedFailureByTrack.get(track) ?? new Map()
      for (const reasonKey of reasonKeys) {
        incrementMapCounter(blockedFailureCounter, reasonKey)
        incrementMapCounter(trackCounter, reasonKey)
      }
      blockedFailureByTrack.set(track, trackCounter)
    }
    if (allowWrites) {
      await prisma.autoSearchRun.update({
        where: { runId },
        data: { status: "BLOCKED_BY_DATA" },
      })
    }
    if (runFailureContext && runFailureContext.runId === runId) {
      runFailureContext.finalized = true
    }
    const blockedFailureLeaderboard = summarizeMapCounter(blockedFailureCounter)
    const blockedPrimary = pickPrimaryFailureReason({
      terminationReason: "BLOCKED_BY_DATA",
      failureTopReasons: blockedFailureLeaderboard.top,
      lockboxBlockedReasons: blockedReasons,
    })
    writeJson(path.join(runDir, "final_report.json"), {
      ...buildFinalReportBase({
        runId,
        status: "BLOCKED_BY_DATA",
        dataMode,
        tracks,
        passMode,
      }),
      blockedTracks,
      blockedReasons,
      configSanity,
      stage2PoolLimits: {
        perTrack: stage2PoolTrackLimit,
        jsonModeMaxBytes: stage2PoolJsonMaxBytes,
      },
      primaryFailureReason: blockedPrimary.reason,
      primaryFailureSource: blockedPrimary.source,
      failureLeaderboard: blockedFailureLeaderboard,
      failureLeaderboardByTrack: Object.fromEntries(
        Array.from(blockedFailureByTrack.entries()).map(([track, counter]) => [
          track,
          summarizeMapCounter(counter),
        ]),
      ),
      endedRound: 0,
      endedAt: new Date().toISOString(),
    })
    writeText(path.join(runDir, "final_report.txt"), [
      `status=BLOCKED_BY_DATA`,
      `runId=${runId}`,
      `tracks=${tracks.join(",")}`,
      `blockedTracks=${blockedTracks.join(",")}`,
      `blockedReasons=${blockedReasons.join(",")}`,
      `primaryFailureReason=${blockedPrimary.reason ?? "NONE"}`,
      `failureLeaderboard=${JSON.stringify(blockedFailureLeaderboard.top)}`,
    ])
    await prisma.$disconnect()
    return
  }

  const stage2CandidatePool = stage2FromPool
    ? await loadCandidatePool({
        candidatePoolPath: args.candidatePoolPath,
        requiredTracks: tracks,
        maxEntriesPerTrack: stage2PoolTrackLimit,
        jsonModeMaxBytes: stage2PoolJsonMaxBytes,
      })
    : { byTrack: new Map(), count: 0, filePath: null }
  if (stage2FromPool) {
    console.log(
      `[candidate-pool] stage=stage2 path=${stage2CandidatePool.filePath ?? "NONE"} count=${stage2CandidatePool.count}`,
    )
    console.log(
      `[candidate-pool] limits perTrack=${stage2PoolTrackLimit} jsonModeMaxMb=${Math.round(stage2PoolJsonMaxBytes / 1024 / 1024)}`,
    )
    for (const track of tracks) {
      const entries = stage2CandidatePool.byTrack.get(track) ?? []
      console.log(`[candidate-pool] track=${track} entries=${entries.length}`)
    }
    const missingRequired = requiredTracks.filter((track) => {
      const entries = stage2CandidatePool.byTrack.get(track) ?? []
      return entries.length <= 0
    })
    if (missingRequired.length) {
      throw new Error(
        `STAGE2_POOL_MISSING_REQUIRED_TRACKS ${missingRequired.join(",")}`,
      )
    }
  }

  const stage2PoolPatternCacheByTrack = new Map(
    tracks.map((track) => [track, new Map()]),
  )
  const stage2PoolTriedKeysByTrack = new Map(
    tracks.map((track) => [track, new Set()]),
  )
  const stage2PoolSourceSeedByRunId = new Map()
  const resolveStage2PoolSourceSeed = (entry) => {
    if (!stage2FromPool || !entry) {
      return null
    }
    const directSeed = Number(entry?.sourceSeed ?? 0) || 0
    if (directSeed > 0) {
      return String(directSeed)
    }
    const sourceRunId = String(entry?.sourceRunId ?? "").trim()
    if (!sourceRunId) {
      return null
    }
    if (stage2PoolSourceSeedByRunId.has(sourceRunId)) {
      return stage2PoolSourceSeedByRunId.get(sourceRunId)
    }
    let resolved = null
    try {
      const sourceRunConfigPath = path.join(
        rootDir,
        "artifacts",
        "autosearch",
        sourceRunId,
        "run_config.json",
      )
      if (fs.existsSync(sourceRunConfigPath)) {
        const sourceRunConfig = readJsonSafe(sourceRunConfigPath)
        const seedText = String(sourceRunConfig?.args?.seed ?? "").trim()
        if (/^[-]?\d+$/.test(seedText)) {
          resolved = seedText
        }
      }
    } catch {
      resolved = null
    }
    stage2PoolSourceSeedByRunId.set(sourceRunId, resolved)
    return resolved
  }
  const buildStage2PoolTrainingSeed = ({ entry, round }) => {
    const fallbackSeed = `${args.seed}:${round}`
    if (!stage2FromPool || !entry) {
      return fallbackSeed
    }
    const sourceSeed = resolveStage2PoolSourceSeed(entry)
    const sourceRound = Math.max(
      1,
      Number(entry?.sourceRound ?? round) || round,
    )
    if (!sourceSeed) {
      return fallbackSeed
    }
    return `${sourceSeed}:${sourceRound}`
  }
  const bestByTrack = new Map()
  const anchorPassedByTrack = new Map()
  const stableBestByTrack = new Map()
  const lastPassedByTrack = new Map()
  const passHistoryByTrack = new Map(tracks.map((track) => [track, []]))
  const lastMetricsByTrack = new Map()
  const failureReasonCounterByTrack = new Map(
    tracks.map((track) => [track, new Map()]),
  )
  const failureReasonCounter = new Map()
  const failureFingerprintCounter = new Map()
  const noTradeStreakByTrack = new Map(
    requiredTracks.map((track) => [track, 0]),
  )
  const weakSignalStreakByTrack = new Map(tracks.map((track) => [track, 0]))
  const gapChartSafePoolCooldownUntilByTrack = new Map()
  const gapChartSafePoolCooldownNotifiedUntilByTrack = new Map()
  let adaptiveBudgetMode = adaptiveBudgetEnabled ? "guarded" : "normal"
  const adaptiveBudgetModeRounds = new Map([
    ["normal", 0],
    ["guarded", 0],
    ["tight", 0],
  ])
  let plateauCount = 0
  let failStreak = 0
  let targetPct = args.targetStart
  let maxTargetPassed = null
  let round = 0

  const recordPassedTrackCandidate = ({ track, roundEntry, roundNumber }) => {
    if (!roundEntry?.pass) {
      return
    }
    lastPassedByTrack.set(track, roundEntry)
    const history = passHistoryByTrack.get(track) ?? []
    history.push({
      round: roundNumber,
      passedAt: new Date().toISOString(),
      deployScore: computeDeployScore({
        metrics: roundEntry.metrics,
        targetPct: roundEntry.targetPct,
      }),
      entry: roundEntry,
    })
    const historyLimit = Number(poolHistoryLimitByTrack[track] ?? 64) || 64
    while (history.length > historyLimit) {
      history.shift()
    }
    passHistoryByTrack.set(track, history)
    if (
      Number(targetPct) === Number(args.targetStart) &&
      !anchorPassedByTrack.has(track)
    ) {
      anchorPassedByTrack.set(track, roundEntry)
    }
  }

  const evaluateLockboxForTrack = async ({ track, ctx, candidate }) => {
    if (!ctx?.windows || !ctx?.data || !candidate) {
      return { pass: false, summary: null, payload: null, path: null }
    }
    const patterns =
      (await loadPatternsByLabel(prisma, track, candidate.versionLabel)) ??
      (await loadLatestPatterns(
        prisma,
        track,
        ctx.trainAsOfDateKey ?? ctx.asOfDateKey,
        ctx.asOfDateKey,
        ctx.regime,
      )) ??
      ctx.patterns
    const guard = guardLockboxPatterns({
      patterns,
      asOfDateKey: ctx.asOfDateKey ?? ctx.trainAsOfDateKey,
    })
    const lockboxPath = resolveRunSummaryPath({
      runDir,
      track,
      window: "lockbox",
      round,
    })
    const legacyLockboxPath = resolveLegacySummaryPath({
      track,
      window: "lockbox",
    })
    if (guard.blocked) {
      const lockboxPayload = {
        track,
        window: "lockbox",
        ok: false,
        blocked: true,
        reason: guard.reason,
        hintCommand: guard.hintCommand ?? null,
        asOfDateKey: ctx.asOfDateKey ?? ctx.trainAsOfDateKey ?? null,
      }
      writeJson(lockboxPath, lockboxPayload)
      writeJson(legacyLockboxPath, lockboxPayload)
      console.log(
        `[lockbox] blocked ${track}: ${guard.reason} (${guard.hintCommand ?? "no hint"})`,
      )
      return {
        pass: false,
        summary: null,
        payload: lockboxPayload,
        path: lockboxPath,
        blocked: true,
        reason: guard.reason,
        hintCommand: guard.hintCommand ?? null,
      }
    }
    checkMemory(`lockbox-pre:${track}:r${round}`)
    const lockboxPatternScope = scopePatternsByEngine({
      patterns,
      requestedEngineType: resolveEntryEngineType(candidate),
    })
    const lockboxEval = evaluateWindow({
      data: ctx.data,
      patterns: lockboxPatternScope.patterns,
      policyParams: candidate.policyParams,
      policyChoice: candidate.policyChoice,
      entryWindowDays,
      track,
      calendar: ctx.calendar,
      weekKeys: ctx.windows.lockbox.weekKeys,
      windowStart: ctx.windows.lockbox.fromDateKey,
      windowEnd: ctx.windows.lockbox.toDateKey,
      costModel: rampCostModel,
    })
    const lockboxBigUp =
      track === "SURGE_EOD"
        ? computeBigUpMetrics({
            signals: lockboxEval.signals,
            candles: ctx.data.candles,
            calendar: ctx.calendar,
            weekKeys: ctx.windows.lockbox.weekKeys,
          })
        : {
            bigUpWeeksCount24: 0,
            bigUpExcludedByGapCount: 0,
            bigUpWeekKeys: [],
          }
    const lockboxNoFillRate =
      lockboxEval.results.length > 0
        ? countNoFillResults(lockboxEval.results) / lockboxEval.results.length
        : 0
    const lockboxDiagnostics = summarizeEvaluation(lockboxEval)
    const lockboxStopLikePct =
      computeStopLikePctFromDiagnostics(lockboxDiagnostics)
    const lockboxTradeGatePass =
      lockboxDiagnostics.completedTrades >= minValidationTrades
    const lockboxSummary = evaluateWeeklySummary({
      weekSeries: lockboxEval.weekSeries,
      targetPct: candidate.targetPct,
      targetStart: 5,
      minWeeksGE: 10,
      bigUpWeeksCount24: lockboxBigUp.bigUpWeeksCount24,
      requiredBigUpWeeks: track === "SURGE_EOD" ? 10 : 0,
      minWorst2wAvgPct,
      noFillRate: lockboxNoFillRate,
      noFillRateMax: 0.35,
      emptyWeekAllowed: 0,
      useRamp: true,
      worst2wDistributionConfig: worst2wDistConfig,
    })
    const lockboxLegacyWeeklyGate = evaluateLegacyWeeklyGate({
      track,
      weekSeries: lockboxEval.weekSeries,
      targetPct: candidate.targetPct,
      args,
    })
    const lockboxPayload = {
      track,
      window: "lockbox",
      ok: true,
      evalWeeks: args.evalWeeks,
      targetPct: candidate.targetPct,
      completedTrades: lockboxDiagnostics.completedTrades,
      minValidationTrades,
      tradeGatePass: lockboxTradeGatePass,
      diagnostics: lockboxDiagnostics,
      weekSeries: lockboxEval.weekSeries,
      metrics: lockboxSummary.metrics,
      countWeeksGE: lockboxSummary.metrics.countWeeksGE,
      emptyWeeksCount: lockboxSummary.metrics.emptyWeeksCount,
      minWeeklyPct: lockboxSummary.metrics.minWeeklyPct,
      stopLikePct: lockboxStopLikePct,
      noFillRate: lockboxSummary.metrics.noFillRate,
      maxTargetPct: lockboxSummary.metrics.maxTargetPct,
      worst2wAvgPct: lockboxSummary.metrics.worst2wAvgPct,
      worst2wWindowStart: lockboxSummary.metrics.worst2wWindowStart,
      worst2wWindowEnd: lockboxSummary.metrics.worst2wWindowEnd,
      worst2wGatePass: lockboxSummary.metrics.worst2wGatePass,
      worst2wGateReason: lockboxSummary.metrics.worst2wGateReason,
      minWorst2wAvgPct: lockboxSummary.metrics.minWorst2wAvgPct,
      bigUpWeeksCount24: lockboxBigUp.bigUpWeeksCount24,
      bigUpExcludedByGapCount: lockboxBigUp.bigUpExcludedByGapCount,
      ...(lockboxBigUp.bigUpWeekKeys?.length
        ? { bigUpWeekKeys: lockboxBigUp.bigUpWeekKeys }
        : {}),
      legacyWeeklyGate: lockboxLegacyWeeklyGate,
      worst2wGate: lockboxSummary.worst2wGate,
      worst2wDistGate: lockboxSummary.worst2wDist,
      ...lockboxSummary.metrics,
    }
    const lockboxDiagnosticsPath = writeEvaluationDiagnostics({
      runDir,
      track,
      window: "lockbox",
      round,
      evaluation: lockboxEval,
      diagnostics: lockboxDiagnostics,
      sampleLimit: evalDiagnosticSampleLimit,
      meta: {
        targetPct: candidate.targetPct,
        minValidationTrades,
        tradeGatePass: lockboxTradeGatePass,
        stopLikePct: lockboxStopLikePct,
      },
    })
    lockboxPayload.diagnosticsPath = lockboxDiagnosticsPath
    writeJson(lockboxPath, lockboxPayload)
    writeJson(legacyLockboxPath, lockboxPayload)
    const lockboxSignalsCount =
      Number(lockboxDiagnostics.signalsCount ?? 0) || 0
    const lockboxResultsCount =
      Number(lockboxDiagnostics.resultsCount ?? 0) || 0
    const lockboxFailureReasons = []
    if (lockboxSignalsCount <= 0)
      lockboxFailureReasons.push("EARLY_ZERO_SIGNALS")
    if (lockboxResultsCount <= 0)
      lockboxFailureReasons.push("EARLY_ZERO_RESULTS")
    if (!lockboxTradeGatePass) lockboxFailureReasons.push("TRADE_GATE")
    if (!lockboxSummary.pass) {
      if (lockboxSummary.metrics?.worst2wGatePass === false) {
        lockboxFailureReasons.push(
          String(lockboxSummary.metrics?.worst2wGateReason ?? "WORST2W_GATE"),
        )
      } else {
        lockboxFailureReasons.push("WEEKLY_SUMMARY_GATE")
      }
    }
    if (!lockboxLegacyWeeklyGate.pass) {
      const legacyReasons = Array.isArray(lockboxLegacyWeeklyGate.reasons)
        ? lockboxLegacyWeeklyGate.reasons
        : []
      if (legacyReasons.length) {
        for (const legacyReason of legacyReasons) {
          lockboxFailureReasons.push(String(legacyReason))
        }
      } else {
        lockboxFailureReasons.push("LEGACY_GATE_FAILED")
      }
    }
    const normalizedLockboxFailureReasons = Array.from(
      new Set(
        lockboxFailureReasons
          .map((reason) => String(reason ?? "").trim())
          .filter(Boolean),
      ),
    )
    const lockboxReason = normalizedLockboxFailureReasons[0] ?? null
    lockboxPayload.failureReasons = normalizedLockboxFailureReasons
    lockboxPayload.primaryFailureReason = lockboxReason
    checkMemory(`lockbox-post:${track}:r${round}`)
    return {
      pass:
        lockboxSummary.pass &&
        lockboxTradeGatePass &&
        lockboxLegacyWeeklyGate.pass,
      summary: lockboxSummary,
      payload: lockboxPayload,
      path: lockboxPath,
      diagnosticsPath: lockboxDiagnosticsPath,
      tradeGatePass: lockboxTradeGatePass,
      completedTrades: lockboxDiagnostics.completedTrades,
      stopLikePct: lockboxStopLikePct,
      signalsCount: lockboxSignalsCount,
      resultsCount: lockboxResultsCount,
      reason: lockboxReason,
      failureReasons: normalizedLockboxFailureReasons,
    }
  }

  const finalizeRun = async ({ terminationReason, statusOverride }) => {
    const extractTrainRangeFromLabel = (label) => {
      const raw = String(label ?? "")
      const fromMatch = raw.match(/@from=(\d{4}-\d{2}-\d{2})/)
      const toMatch = raw.match(/@to=(\d{4}-\d{2}-\d{2})/)
      return {
        trainFromDateKey: fromMatch?.[1] ?? null,
        trainToDateKey: toMatch?.[1] ?? null,
      }
    }
    const extractRegimeTagFromLabel = (label) => {
      const raw = String(label ?? "")
      const match = raw.match(/@regime[:=]([A-Z_]+)/i)
      return (
        String(match?.[1] ?? "")
          .trim()
          .toUpperCase() || null
      )
    }
    const normalizePoolState = (value) => {
      const state = String(value ?? "")
        .trim()
        .toUpperCase()
      if (state === "ACTIVE" || state === "BENCH" || state === "QUARANTINED") {
        return state
      }
      if (state === "DROPPED") {
        return "DROPPED"
      }
      return "BENCH"
    }
    const normalizePoolCandidate = (row, trackHint = null) => {
      if (!row || typeof row !== "object") return null
      const track =
        String(trackHint ?? row?.track ?? "")
          .trim()
          .toUpperCase() || null
      const version = Number(row?.version ?? 0) || 0
      const versionLabel = String(row?.versionLabel ?? "").trim() || null
      if (version <= 0 && !versionLabel) return null
      const fingerprint = String(row?.fingerprint ?? "").trim() || null
      const key = `${track ?? "UNKNOWN"}:${versionLabel ?? `v${version}`}:${fingerprint ?? "no-fp"}`
      const range = extractTrainRangeFromLabel(versionLabel)
      return {
        candidateId: String(row?.candidateId ?? "").trim() || key,
        track,
        engineType:
          String(row?.engineType ?? "")
            .trim()
            .toLowerCase() === "chart"
            ? "chart"
            : "rule",
        version: version > 0 ? version : null,
        versionLabel,
        fingerprint,
        deployScore: Number(row?.deployScore ?? 0) || 0,
        sourceRunId: String(row?.sourceRunId ?? "").trim() || null,
        sourceRound: Number(row?.sourceRound ?? 0) || null,
        trainFromDateKey:
          String(row?.trainFromDateKey ?? "").trim() || range.trainFromDateKey,
        trainToDateKey:
          String(row?.trainToDateKey ?? "").trim() || range.trainToDateKey,
        regimeTag:
          String(row?.regimeTag ?? "")
            .trim()
            .toUpperCase() || extractRegimeTagFromLabel(versionLabel),
        passedStage2At: String(row?.passedStage2At ?? "").trim() || null,
        state: normalizePoolState(row?.state),
        failStreak: Math.max(0, Number(row?.failStreak ?? 0) || 0),
        lastEvaluatedAt: String(row?.lastEvaluatedAt ?? "").trim() || null,
        minAliveProtected: Boolean(row?.minAliveProtected),
      }
    }
    const mergePoolRows = ({
      track,
      existingRows,
      verifiedRow,
      verifiedRows,
      activeLimit,
      benchLimit,
      minAlive,
    }) => {
      const dedup = new Map()
      const ingest = (row) => {
        const normalized = normalizePoolCandidate(row, track)
        if (!normalized) return
        if (
          normalized.state === "DROPPED" ||
          normalized.state === "QUARANTINED"
        ) {
          return
        }
        const key = [
          normalized.track ?? "",
          normalized.engineType ?? "rule",
          normalized.versionLabel ?? "",
          String(normalized.version ?? 0),
          normalized.fingerprint ?? "",
        ].join("|")
        const prev = dedup.get(key)
        const prevScore = Number(prev?.deployScore ?? -Infinity)
        const nextScore = Number(normalized.deployScore ?? -Infinity)
        if (!prev || nextScore >= prevScore) {
          dedup.set(key, normalized)
        }
      }
      const normalizedVerifiedRows = Array.isArray(verifiedRows)
        ? verifiedRows
        : [verifiedRow]
      for (const row of normalizedVerifiedRows) {
        ingest(row)
      }
      for (const row of existingRows) ingest(row)
      const rows = Array.from(dedup.values())
      rows.sort((a, b) => {
        const stateRank = (state) => (state === "ACTIVE" ? 2 : 1)
        const scoreDiff =
          (Number(b.deployScore ?? 0) || 0) - (Number(a.deployScore ?? 0) || 0)
        if (scoreDiff !== 0) return scoreDiff
        const stateDiff = stateRank(b.state) - stateRank(a.state)
        if (stateDiff !== 0) return stateDiff
        const tsA = Date.parse(String(a.passedStage2At ?? "")) || 0
        const tsB = Date.parse(String(b.passedStage2At ?? "")) || 0
        if (tsB !== tsA) return tsB - tsA
        return (Number(b.version ?? 0) || 0) - (Number(a.version ?? 0) || 0)
      })
      const keepCount = Math.max(activeLimit + benchLimit, minAlive, 1)
      const trimmed = rows.slice(0, keepCount)
      return trimmed.map((row, index) => ({
        ...row,
        state: index < activeLimit ? "ACTIVE" : "BENCH",
        minAliveProtected: index < minAlive,
      }))
    }
    const activationPoolByTrack = new Map()
    const activationCandidateByTrack = new Map()
    const activationStage2CandidatesByTrack = new Map()
    for (const track of tracks) {
      const shortlist = []
      const seen = new Set()
      const addCandidate = ({ entry, source, sourceRank, roundHint }) => {
        if (!entry) return
        const engineType = resolveEntryEngineType(entry)
        const candidateKey =
          String(entry?.versionLabel ?? "").trim() ||
          stableStringify({
            targetPct: entry?.targetPct ?? null,
            policyChoice: entry?.policyChoice ?? null,
            patternChoice: entry?.patternChoice ?? null,
          })
        const key = `${engineType}|${candidateKey}`
        if (!candidateKey || seen.has(key)) return
        seen.add(key)
        shortlist.push({
          entry,
          engineType,
          source,
          sourceRank,
          roundHint: Number(roundHint ?? 0) || 0,
          deployScore: computeDeployScore({
            metrics: entry?.metrics ?? null,
            targetPct: entry?.targetPct ?? null,
          }),
        })
      }
      const stable = stableBestByTrack.get(track)?.entry ?? null
      const latest = lastPassedByTrack.get(track) ?? null
      const history = passHistoryByTrack.get(track) ?? []
      const fallbackActiveLimit = Math.max(
        1,
        Number(poolActiveLimitByTrack[track] ?? 1) || 1,
      )
      const fallbackBenchLimit = Math.max(
        0,
        Number(poolBenchLimitByTrack[track] ?? 0) || 0,
      )
      const fallbackStage2TopK = Math.max(
        1,
        Number(stage2TopKByTrack[track] ?? fallbackActiveLimit) ||
          fallbackActiveLimit,
      )
      addCandidate({
        entry: stable,
        source: "stable",
        sourceRank: 3,
        roundHint: stableBestByTrack.get(track)?.updatedAtRound ?? 0,
      })
      addCandidate({
        entry: latest,
        source: "latest",
        sourceRank: 2,
        roundHint: round,
      })
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const row = history[i]
        addCandidate({
          entry: row?.entry ?? null,
          source: "history",
          sourceRank: 1,
          roundHint: row?.round ?? 0,
        })
      }
      if (stage2FromPool) {
        const poolFallbackRows = stage2CandidatePool.byTrack.get(track) ?? []
        const poolFallbackLimit = Math.max(
          fallbackActiveLimit + fallbackBenchLimit,
          fallbackStage2TopK,
        )
        const poolFallbackRowsTrimmed = poolFallbackRows.slice(
          0,
          Math.max(8, poolFallbackLimit * 2),
        )
        for (let i = 0; i < poolFallbackRowsTrimmed.length; i += 1) {
          const row = poolFallbackRowsTrimmed[i]
          addCandidate({
            entry: row,
            source: "stage2_pool",
            sourceRank: 0,
            roundHint: Number(row?.sourceRound ?? 0) || 0,
          })
        }
      }
      const scoredShortlist = shortlist.map((row) => ({
        ...row,
        lockboxViable: isLockboxCandidateViable({
          entry: row?.entry,
          track,
        }),
      }))
      scoredShortlist.sort((a, b) => {
        const viableDiff =
          (Number(b.lockboxViable ? 1 : 0) || 0) -
          (Number(a.lockboxViable ? 1 : 0) || 0)
        if (viableDiff !== 0) return viableDiff
        const scoreDiff =
          (Number(b.deployScore ?? 0) || 0) - (Number(a.deployScore ?? 0) || 0)
        if (scoreDiff !== 0) return scoreDiff
        const rankDiff =
          (Number(b.sourceRank ?? 0) || 0) - (Number(a.sourceRank ?? 0) || 0)
        if (rankDiff !== 0) return rankDiff
        return (Number(b.roundHint ?? 0) || 0) - (Number(a.roundHint ?? 0) || 0)
      })
      const activeLimit = Math.max(
        1,
        Number(poolActiveLimitByTrack[track] ?? 1) || 1,
      )
      const benchLimit = Math.max(
        0,
        Number(poolBenchLimitByTrack[track] ?? 0) || 0,
      )
      const selectedRows = scoredShortlist.slice(0, activeLimit + benchLimit)
      const poolRows = selectedRows.map((row, index) => {
        const label = String(row?.entry?.versionLabel ?? "").trim() || null
        const range = extractTrainRangeFromLabel(label)
        return {
          candidateId: `${track}:${label ?? `v${Number(row?.entry?.version ?? 0) || 0}`}:${index + 1}`,
          track,
          engineType: normalizeEngineType(row?.engineType),
          version: Number(row?.entry?.version ?? 0) || null,
          versionLabel: label,
          fingerprint: String(
            row?.entry?.fingerprint ??
              stableStringify({
                policyChoice: row?.entry?.policyChoice ?? null,
                patternChoice: row?.entry?.patternChoice ?? null,
              }),
          ).trim(),
          deployScore: Number(row.deployScore ?? 0) || 0,
          sourceRunId: row?.entry?.sourceRunId ?? null,
          sourceRound: Number(row?.entry?.sourceRound ?? 0) || null,
          trainFromDateKey: range.trainFromDateKey,
          trainToDateKey: range.trainToDateKey,
          regimeTag: extractRegimeTagFromLabel(label),
          passedStage2At: new Date().toISOString(),
          state: index < activeLimit ? "ACTIVE" : "BENCH",
          failStreak: 0,
          lastEvaluatedAt: new Date().toISOString(),
        }
      })
      activationPoolByTrack.set(track, poolRows)
      const stage2TopK = Math.max(
        1,
        Number(stage2TopKByTrack[track] ?? activeLimit) || activeLimit,
      )
      activationStage2CandidatesByTrack.set(
        track,
        selectedRows
          .slice(0, stage2TopK)
          .map((row) => row?.entry)
          .filter(Boolean),
      )
    }

    let lockboxOk = true
    const lockboxBlockedReasons = []
    const addLockboxBlockedReason = (reason) => {
      const value = String(reason ?? "").trim()
      if (!value) return
      if (!lockboxBlockedReasons.includes(value)) {
        lockboxBlockedReasons.push(value)
      }
    }
    const lockboxByTrack = new Map()
    const selectedPoolSetByTrack = new Map()
    const lockboxPassedPoolRowsByTrack = new Map()
    for (const track of tracks) {
      const ctx = trackContext.get(track)
      const stage2Candidates = Array.isArray(
        activationStage2CandidatesByTrack.get(track),
      )
        ? activationStage2CandidatesByTrack.get(track)
        : []
      if (!stage2Candidates.length) {
        const reason = `MISSING_TRACK_CANDIDATE:${track}`
        lockboxByTrack.set(track, {
          pass: false,
          blocked: true,
          reason,
          evaluatedCount: 0,
          candidateEvaluations: [],
        })
        addLockboxBlockedReason(reason)
        if (requiredTracks.includes(track)) {
          lockboxOk = false
        }
        continue
      }
      const candidateEvaluations = []
      let selectedPassingCandidate = null
      let selectedPassingEval = null
      for (const candidate of stage2Candidates) {
        let lockboxEval = null
        let moonshotGatePayload = null
        if (track === "SURGE_EOD" && ctx?.windows?.lockbox) {
          const moonshotGate = await loadMoonshotWindowStats({
            prisma,
            calendar: ctx.calendar,
            windowStartDateKey: ctx.windows.lockbox.fromDateKey,
            windowEndDateKey: ctx.windows.lockbox.toDateKey,
            patternVersionLabel: candidate?.versionLabel ?? null,
            strategyVersion: moonshotStrategyVersion || null,
            strategyVersionPrefix: moonshotStrategyPrefix,
          })
          moonshotGatePayload = {
            scope: MOONSHOT_GATE_SCOPE,
            pass: moonshotGate.pass === true,
            reason: moonshotGate.reason ?? MOONSHOT_GATE_FAILED,
            signalsLoaded: moonshotGate.signalsLoaded ?? 0,
            signalsQualified: moonshotGate.signalsQualified ?? 0,
            outcomesCount: moonshotGate.outcomesCount ?? 0,
            stats: moonshotGate.stats ?? null,
            requiredForCorePass: args.moonshotTrackRequiredForCorePass === true,
          }
          if (!moonshotGate.pass) {
            if (args.moonshotTrackRequiredForCorePass === true) {
              lockboxEval = {
                pass: false,
                blocked: true,
                reason: MOONSHOT_GATE_FAILED,
                moonshotGate: moonshotGatePayload,
              }
            }
          }
        }
        if (!lockboxEval) {
          lockboxEval = await evaluateLockboxForTrack({
            track,
            ctx,
            candidate,
          })
        }
        if (moonshotGatePayload && !lockboxEval?.moonshotGate) {
          lockboxEval = {
            ...lockboxEval,
            moonshotGate: moonshotGatePayload,
          }
        }
        const enrichedEval = {
          ...lockboxEval,
          candidate: {
            version: Number(candidate?.version ?? 0) || null,
            versionLabel: String(candidate?.versionLabel ?? "").trim() || null,
            engineType: resolveEntryEngineType(candidate),
            poolSetId: String(candidate?.poolSetId ?? "").trim() || null,
            sourceRunId: candidate?.sourceRunId ?? null,
            sourceRound: Number(candidate?.sourceRound ?? 0) || null,
          },
        }
        candidateEvaluations.push(enrichedEval)
        if (!enrichedEval.pass) {
          const candidateFingerprint =
            String(candidate?.fingerprint ?? "").trim() || null
          if (candidateFingerprint) {
            const reasonList = Array.isArray(enrichedEval.failureReasons)
              ? enrichedEval.failureReasons
              : []
            const fallbackReason = String(
              enrichedEval.reason ?? "LOCKBOX_POLICY_FAIL",
            )
              .trim()
              .toUpperCase()
            const normalizedReasons = (
              reasonList.length ? reasonList : [fallbackReason]
            )
              .map((reason) =>
                String(reason ?? "")
                  .trim()
                  .toUpperCase(),
              )
              .filter(Boolean)
            for (const reason of normalizedReasons.slice(0, 4)) {
              incrementMapCounter(
                failureFingerprintCounter,
                `${candidateFingerprint}|LOCKBOX_${reason}`,
              )
            }
          }
        }
        if (
          !selectedPassingCandidate &&
          enrichedEval.pass &&
          !enrichedEval.blocked
        ) {
          selectedPassingCandidate = candidate
          selectedPassingEval = enrichedEval
        }
      }
      const trackEval = selectedPassingEval ??
        candidateEvaluations[0] ?? {
          pass: false,
          blocked: true,
          reason: `MISSING_TRACK_CANDIDATE:${track}`,
        }
      lockboxByTrack.set(track, {
        ...trackEval,
        evaluatedCount: candidateEvaluations.length,
        candidateEvaluations,
      })
      if (selectedPassingCandidate) {
        activationCandidateByTrack.set(track, selectedPassingCandidate)
        const passingLabelSet = new Set(
          candidateEvaluations
            .filter((row) => row?.pass === true && row?.blocked !== true)
            .map((row) => String(row?.candidate?.versionLabel ?? "").trim())
            .filter(Boolean),
        )
        const passingPoolRows = (activationPoolByTrack.get(track) ?? []).filter(
          (row) => passingLabelSet.has(String(row?.versionLabel ?? "").trim()),
        )
        if (passingPoolRows.length) {
          lockboxPassedPoolRowsByTrack.set(track, passingPoolRows)
        }
        const selectedLabel = String(
          selectedPassingCandidate?.versionLabel ?? "",
        ).trim()
        const selectedPoolRows = (
          activationPoolByTrack.get(track) ?? []
        ).filter(
          (row) => String(row?.versionLabel ?? "").trim() === selectedLabel,
        )
        const selectedMemberCandidateId =
          selectedPoolRows.find((row) => row?.state === "ACTIVE")
            ?.candidateId ??
          selectedPoolRows[0]?.candidateId ??
          `${track}:${selectedLabel || `v${Number(selectedPassingCandidate?.version ?? 0) || 0}`}:selected`
        const selectedCandidatePoolSetId = String(
          selectedPassingCandidate?.poolSetId ??
            selectedPassingEval?.candidate?.poolSetId ??
            "",
        ).trim()
        selectedPoolSetByTrack.set(track, {
          poolSetId:
            selectedCandidatePoolSetId ||
            `${track}:POOLSET:CANDIDATE:${runId}:${String(round ?? 0)}`,
          state: "ACTIVE",
          passFinal: true,
          memberCount: Math.max(1, selectedPoolRows.length || 0),
          selectedMemberCandidateId,
          updatedAt: new Date().toISOString(),
        })
      } else {
        addLockboxBlockedReason(trackEval.reason ?? "LOCKBOX_BLOCKED")
        if (requiredTracks.includes(track)) {
          lockboxOk = false
        }
      }
    }
    const missingRequiredTracks = requiredTracks.filter(
      (track) => selectedPoolSetByTrack.get(track)?.passFinal !== true,
    )
    const hasPassed = missingRequiredTracks.length === 0
    const selectedPoolSetPass = requiredTracks.every(
      (track) => selectedPoolSetByTrack.get(track)?.passFinal === true,
    )
    if (selectedPoolSetPass !== hasPassed) {
      throw new Error(
        "POLICY_CONFLICT_BLOCKED selectedPoolSetByTrack pass invariant mismatch",
      )
    }
    for (const track of missingRequiredTracks) {
      addLockboxBlockedReason(`MISSING_TRACK_CANDIDATE:${track}`)
      lockboxOk = false
    }
    const primaryLockboxBlockedReason = pickPrimaryBlockedReason(
      lockboxBlockedReasons,
    )
    const lockboxEvaluated = lockboxByTrack.size > 0
    const status = statusOverride
      ? statusOverride
      : args.dryRun
        ? "DRY_RUN"
        : primaryLockboxBlockedReason
          ? primaryLockboxBlockedReason === MOONSHOT_GATE_FAILED
            ? MOONSHOT_GATE_FAILED
            : "BLOCKED_BY_DATA"
          : hasPassed && lockboxOk
            ? "PASS"
            : terminationReason || "FAIL"
    if (allowWrites) {
      await prisma.autoSearchRun.update({
        where: { runId },
        data: {
          status,
          notes: {
            finalizedAt: new Date().toISOString(),
            finalizedBy: "go-live-autosearch",
            terminationReason: terminationReason ?? null,
            statusOverride: statusOverride ?? null,
          },
        },
      })
    }
    if (runFailureContext && runFailureContext.runId === runId) {
      runFailureContext.finalized = true
    }
    const lastSurge = activationCandidateByTrack.get("SURGE_EOD") ?? null
    const lastMetrics = lastMetricsByTrack.get("SURGE_EOD") ?? null
    const lastPassedMetrics = lastSurge?.metrics ?? null

    const persistedPoolByTrack = new Map()
    const lockboxPassedTrackEntries = Array.from(
      lockboxPassedPoolRowsByTrack.entries(),
    )
    if (allowWrites && lockboxPassedTrackEntries.length) {
      for (const [track, passedRows] of lockboxPassedTrackEntries) {
        const entry = activationCandidateByTrack.get(track)
        if (!entry) continue
        const existing = await prisma.activeStrategy.findUnique({
          where: { track },
          select: { activeConfigJson: true },
        })
        const existingPoolRaw = Array.isArray(
          existing?.activeConfigJson?.poolCandidates,
        )
          ? existing.activeConfigJson.poolCandidates
          : []
        const nowIso = new Date().toISOString()
        const label = String(entry?.versionLabel ?? "").trim() || null
        const range = extractTrainRangeFromLabel(label)
        const activeLimit = Math.max(
          1,
          Number(poolActiveLimitByTrack[track] ?? 1) || 1,
        )
        const benchLimit = Math.max(
          0,
          Number(poolBenchLimitByTrack[track] ?? 0) || 0,
        )
        const minAlive = Math.max(
          1,
          Number(poolMinAliveByTrack[track] ?? activeLimit) || activeLimit,
        )
        const verifiedRows = (Array.isArray(passedRows) ? passedRows : [])
          .map((row) =>
            normalizePoolCandidate(
              {
                ...row,
                track,
                sourceRunId: row?.sourceRunId ?? runId,
                sourceRound:
                  Number(row?.sourceRound ?? round ?? 0) || Number(round ?? 0),
                passedStage2At: row?.passedStage2At ?? nowIso,
                lastEvaluatedAt: nowIso,
                failStreak: 0,
              },
              track,
            ),
          )
          .filter(Boolean)
        if (!verifiedRows.length) {
          verifiedRows.push(
            normalizePoolCandidate(
              {
                candidateId: `${track}:${label ?? `v${Number(entry?.version ?? 0) || 0}`}:lockbox`,
                track,
                engineType: resolveEntryEngineType(entry),
                version: Number(entry?.version ?? 0) || null,
                versionLabel: label,
                fingerprint: String(
                  entry?.fingerprint ??
                    stableStringify({
                      policyChoice: entry?.policyChoice ?? null,
                      patternChoice: entry?.patternChoice ?? null,
                    }),
                ).trim(),
                deployScore: computeDeployScore({
                  metrics: entry?.metrics ?? null,
                  targetPct: entry?.targetPct ?? null,
                }),
                sourceRunId: runId,
                sourceRound: Number(round ?? 0) || null,
                trainFromDateKey: range.trainFromDateKey,
                trainToDateKey: range.trainToDateKey,
                regimeTag: extractRegimeTagFromLabel(label),
                passedStage2At: nowIso,
                state: "ACTIVE",
                failStreak: 0,
                lastEvaluatedAt: nowIso,
                minAliveProtected: true,
              },
              track,
            ),
          )
        }
        const mergedPoolRows = mergePoolRows({
          track,
          existingRows: existingPoolRaw,
          verifiedRows,
          activeLimit,
          benchLimit,
          minAlive,
        })
        persistedPoolByTrack.set(track, mergedPoolRows)
        const primary =
          mergedPoolRows.find((row) => row.state === "ACTIVE") ??
          mergedPoolRows[0]
        const activeConfigJson =
          existing &&
          existing.activeConfigJson &&
          typeof existing.activeConfigJson === "object"
            ? { ...existing.activeConfigJson }
            : {}
        activeConfigJson.patternVersionLabel = primary.versionLabel
        activeConfigJson.policyVersionLabel = primary.versionLabel
        activeConfigJson.policyParams = entry.policyParams
        activeConfigJson.poolCandidates = mergedPoolRows
        activeConfigJson.poolPolicy = {
          mode: "pool-only",
          activeLimit,
          benchLimit,
          minAlive,
          source: "LOCKBOX_PASS_ONLY",
        }
        const poolSetId = `${track}:POOLSET:${runId}:${String(round ?? 0)}`
        const existingPoolSetsByTrack =
          activeConfigJson.poolSetsByTrack &&
          typeof activeConfigJson.poolSetsByTrack === "object" &&
          !Array.isArray(activeConfigJson.poolSetsByTrack)
            ? { ...activeConfigJson.poolSetsByTrack }
            : {}
        const previousTrackPoolSet = existingPoolSetsByTrack[track]
        const previousSets = Array.isArray(previousTrackPoolSet?.sets)
          ? previousTrackPoolSet.sets
          : []
        const freshPoolSet = {
          poolSetId,
          track,
          state: "ACTIVE",
          members: mergedPoolRows,
          stage1Score:
            Number(entry?.metrics?.worst2wAvg ?? entry?.metrics?.sumPct ?? 0) ||
            0,
          stage2Score:
            Number(
              lockboxByTrack.get(track)?.stats?.worst2wAvg ??
                lockboxByTrack.get(track)?.completedTrades ??
                0,
            ) || 0,
          passFinal: true,
          lastRoutedAt: nowIso,
          failStreak: 0,
          quarantineUntil: null,
          updatedAt: nowIso,
        }
        const mergedPoolSets = [freshPoolSet]
        const seenPoolSet = new Set([poolSetId])
        for (const row of previousSets) {
          const id = String(row?.poolSetId ?? "").trim()
          if (!id || seenPoolSet.has(id)) continue
          seenPoolSet.add(id)
          mergedPoolSets.push(row)
        }
        const cappedPoolSets = mergedPoolSets.slice(0, 6)
        existingPoolSetsByTrack[track] = {
          updatedAt: nowIso,
          selectedPoolSetId: poolSetId,
          selectedMemberCandidateId:
            mergedPoolRows.find((row) => row?.state === "ACTIVE")
              ?.candidateId ??
            mergedPoolRows[0]?.candidateId ??
            null,
          sets: cappedPoolSets,
        }
        activeConfigJson.poolSetsByTrack = existingPoolSetsByTrack
        selectedPoolSetByTrack.set(track, {
          poolSetId,
          state: "ACTIVE",
          passFinal: true,
          memberCount: mergedPoolRows.length,
          selectedMemberCandidateId:
            mergedPoolRows.find((row) => row?.state === "ACTIVE")
              ?.candidateId ??
            mergedPoolRows[0]?.candidateId ??
            null,
          updatedAt: nowIso,
        })
        await prisma.activeStrategy.upsert({
          where: { track },
          update: {
            activePatternVersion: primary.version,
            activePolicyVersion: primary.version,
            activePatternLabel: primary.versionLabel,
            activePolicyLabel: primary.versionLabel,
            activeConfigJson,
          },
          create: {
            track,
            activePatternVersion: primary.version,
            activePolicyVersion: primary.version,
            activePatternLabel: primary.versionLabel,
            activePolicyLabel: primary.versionLabel,
            activeConfigJson,
          },
        })
      }
    }

    const activationInvokeResults = []
    let activationOutputEnsured = []
    if (allowWrites && hasPassed && lockboxOk) {
      const activationTracks = tracks.filter(
        (track) => selectedPoolSetByTrack.get(track)?.passFinal === true,
      )
      const asOfByTrack = {}
      for (const track of activationTracks) {
        const ctx = trackContext.get(track)
        if (ctx?.asOfDateKey) {
          asOfByTrack[track] = ctx.asOfDateKey
        }
      }
      const gapCtx = trackContext.get("GAP_15_BET")
      const gapCoverage = gapCtx?.dataQuality?.coverage ?? null
      const gapActivationReady = (() => {
        if (!activationTracks.includes("GAP_15_BET")) {
          return { ok: true, reason: "NOT_REQUESTED" }
        }
        if (!gapCoverage) {
          return { ok: false, reason: "GAP_COVERAGE_MISSING" }
        }
        const universeCount = Number(gapCoverage.universeAtAsOf ?? 0) || 0
        const price15Count = Number(gapCoverage.price15AtAsOf ?? 0) || 0
        const ratio = Number(gapCoverage.price15VsUniverse ?? 0) || 0
        const ok =
          universeCount > 0 &&
          price15Count > 0 &&
          ratio >= gapActivationMinCoverage
        return {
          ok,
          reason: ok ? null : "PRICE15_COVERAGE_LOW:" + ratio.toFixed(3),
          ratio,
          universeCount,
          price15Count,
        }
      })()
      if (!gapActivationReady.ok) {
        console.log(
          "[activate] GAP skipped reason=" +
            (gapActivationReady.reason ?? "UNKNOWN") +
            " minCoverage=" +
            gapActivationMinCoverage.toFixed(3),
        )
      }
      activationInvokeResults.push(
        ...invokeActivation({
          tracks: activationTracks,
          asOfByTrack,
          allowGap: gapActivationReady.ok,
          runCommand,
          onCommandError: ({ recommendationMode, error }) => {
            const message =
              error instanceof Error
                ? error.message
                : String(error ?? "unknown")
            console.warn(
              `[activate] mode=${recommendationMode} status=failed error=${message}`,
            )
          },
        }),
      )
      activationOutputEnsured = ensureActivationRecommendationOutputs({
        activationTracks,
        asOfByTrack,
        activationInvokeResults,
        gapActivationReady,
        runId,
        routerCloseDecisionTimeKST: "15:30",
      })

      for (const track of activationTracks) {
        const asOfDateKey = asOfByTrack[track]
        if (!asOfDateKey) continue
        if (track === "GAP_15_BET" && !gapActivationReady.ok) {
          continue
        }
        const snapshot = await prisma.aiSnapshot.findFirst({
          where: {
            tradingDateKey: asOfDateKey,
            settingsHash: "recommend-v1",
          },
          orderBy: [{ computedAtTs: "desc" }, { id: "desc" }],
          select: { id: true },
        })
        const count = snapshot
          ? await prisma.aiSignal.count({
              where: { snapshotId: snapshot.id, track },
            })
          : 0
        console.log(
          `[first-signal] track=${track} asOf=${asOfDateKey} count=${count} view=AI Signals/Diagnostics`,
        )
      }
    }

    const lockboxSummaryFlags = Array.from(lockboxByTrack.entries()).map(
      ([track, entry]) => `${track}:${entry?.pass ? "PASS" : "FAIL"}`,
    )
    const mergedFailureCounter = new Map(failureReasonCounter)
    const mergedFailureCounterByTrack = new Map(
      Array.from(failureReasonCounterByTrack.entries()).map(
        ([track, counter]) => [track, new Map(counter)],
      ),
    )
    for (const reason of lockboxBlockedReasons) {
      incrementMapCounter(mergedFailureCounter, `LOCKBOX_${String(reason)}`)
    }
    for (const [track, entry] of lockboxByTrack.entries()) {
      if (!entry) continue
      const trackCounter = mergedFailureCounterByTrack.get(track) ?? new Map()
      if (entry.blocked) {
        const reason = String(entry.reason ?? "LOCKBOX_BLOCKED")
        incrementMapCounter(mergedFailureCounter, `LOCKBOX_${reason}`)
        incrementMapCounter(trackCounter, `LOCKBOX_${reason}`)
      } else if (requiredTracks.includes(track) && !entry.pass) {
        const reason = String(entry.reason ?? "LOCKBOX_POLICY_FAIL")
        incrementMapCounter(mergedFailureCounter, `LOCKBOX_${reason}`)
        incrementMapCounter(trackCounter, `LOCKBOX_${reason}`)
      }
      mergedFailureCounterByTrack.set(track, trackCounter)
    }
    const failureLeaderboardByTrack = Object.fromEntries(
      Array.from(mergedFailureCounterByTrack.entries()).map(
        ([track, counter]) => [track, summarizeMapCounter(counter)],
      ),
    )
    const failureLeaderboard = summarizeMapCounter(mergedFailureCounter)
    const failureFingerprintSummary = summarizeMapCounter(
      failureFingerprintCounter,
    )
    writeJson(
      path.join(runDir, "failure_fingerprint_top.json"),
      failureFingerprintSummary,
    )
    const primaryFailure = pickPrimaryFailureReason({
      terminationReason,
      failureTopReasons: failureLeaderboard.top,
      lockboxBlockedReasons,
    })
    const adaptiveBudgetRounds = Object.fromEntries(
      adaptiveBudgetModeRounds.entries(),
    )
    const activationCandidateByTrackJson = Object.fromEntries(
      Array.from(activationCandidateByTrack.entries()).map(([track, entry]) => [
        track,
        {
          targetPct: entry?.targetPct ?? null,
          version: entry?.version ?? null,
          versionLabel: entry?.versionLabel ?? null,
          engineType: entry?.engineType ?? null,
          metrics: entry?.metrics ?? null,
          sourceRunId: entry?.sourceRunId ?? null,
          sourceRound: entry?.sourceRound ?? null,
          poolSetId: String(entry?.poolSetId ?? "").trim() || null,
        },
      ]),
    )
    writeJson(path.join(runDir, "final_report.json"), {
      ...buildFinalReportBase({
        runId,
        status,
        dataMode,
        tracks,
        passMode,
      }),
      selectionSource: "POOLSET_STAGE2_ONLY",
      configSanity,
      evalWeeks: args.evalWeeks,
      targetStart: args.targetStart,
      maxRounds: args.maxRounds,
      plateauRounds: args.plateauRounds,
      improveEpsHighWeeks: args.improveEpsHighWeeks,
      improveEpsSumPct: args.improveEpsSumPct,
      maxTargetPassed,
      termination: terminationReason ?? null,
      finalTargetPct: targetPct,
      lockboxOk,
      lockboxEvaluated,
      missingRequiredTracks,
      lockboxBlockedReason: primaryLockboxBlockedReason ?? null,
      lockboxBlockedReasons,
      lockboxByTrack: Object.fromEntries(
        Array.from(lockboxByTrack.entries()).map(([track, entry]) => [
          track,
          {
            pass: Boolean(entry?.pass),
            blocked: Boolean(entry?.blocked),
            reason: entry?.reason ?? null,
            hintCommand: entry?.hintCommand ?? null,
            tradeGatePass: entry?.tradeGatePass ?? null,
            completedTrades: entry?.completedTrades ?? null,
            summaryPath: entry?.path ?? null,
            diagnosticsPath: entry?.diagnosticsPath ?? null,
            stopLikePct: entry?.stopLikePct ?? null,
            moonshotGate: entry?.moonshotGate ?? null,
          },
        ]),
      ),
      lockboxPassByTrack: Object.fromEntries(
        Array.from(lockboxByTrack.entries()).map(([track, entry]) => [
          track,
          Boolean(entry?.pass) && entry?.blocked !== true,
        ]),
      ),
      activationInvokeResults,
      activationOutputEnsured,
      activationCandidateByTrack: activationCandidateByTrackJson,
      diagnostics: {
        activationCandidateByTrack: activationCandidateByTrackJson,
      },
      activationPoolByTrack: Object.fromEntries(
        Array.from(activationPoolByTrack.entries()).map(([track, rows]) => [
          track,
          {
            total: Array.isArray(rows) ? rows.length : 0,
            active: (rows ?? []).filter((row) => row?.state === "ACTIVE")
              .length,
            bench: (rows ?? []).filter((row) => row?.state === "BENCH").length,
            rows: rows ?? [],
          },
        ]),
      ),
      persistedPoolByTrack: Object.fromEntries(
        Array.from(persistedPoolByTrack.entries()).map(([track, rows]) => [
          track,
          {
            total: Array.isArray(rows) ? rows.length : 0,
            active: (rows ?? []).filter((row) => row?.state === "ACTIVE")
              .length,
            bench: (rows ?? []).filter((row) => row?.state === "BENCH").length,
            rows: rows ?? [],
          },
        ]),
      ),
      selectedPoolSetByTrack: Object.fromEntries(
        Array.from(selectedPoolSetByTrack.entries()),
      ),
      deployPickMode,
      stabilityMinImproveScore,
      stabilityMinHoldRounds,
      adaptiveBudgetEnabled,
      adaptiveBudgetModeFinal: adaptiveBudgetMode,
      adaptiveBudgetRounds,
      earlyGateConfig,
      stage2PoolLimits: {
        perTrack: stage2PoolTrackLimit,
        jsonModeMaxBytes: stage2PoolJsonMaxBytes,
      },
      primaryFailureReason: primaryFailure.reason ?? null,
      primaryFailureSource: primaryFailure.source ?? null,
      failureLeaderboard,
      failureLeaderboardByTrack,
      failureFingerprintTop: failureFingerprintSummary.top.slice(0, 64),
      anchorPassedByTrack: Object.fromEntries(
        Array.from(anchorPassedByTrack.entries()).map(([track, entry]) => [
          track,
          {
            targetPct: entry?.targetPct ?? null,
            versionLabel: entry?.versionLabel ?? null,
            metrics: entry?.metrics ?? null,
          },
        ]),
      ),
      stableBestByTrack: Object.fromEntries(
        Array.from(stableBestByTrack.entries()).map(([track, entry]) => [
          track,
          {
            score: entry?.score ?? null,
            targetPct: entry?.entry?.targetPct ?? null,
            versionLabel: entry?.entry?.versionLabel ?? null,
            metrics: entry?.entry?.metrics ?? null,
          },
        ]),
      ),
      lastPassedByTrack: Object.fromEntries(
        Array.from(lastPassedByTrack.entries()).map(([track, entry]) => [
          track,
          {
            pass: Boolean(entry?.pass),
            targetPct: entry?.targetPct ?? null,
            version: entry?.version ?? null,
            versionLabel: entry?.versionLabel ?? null,
            metrics: entry?.metrics ?? null,
          },
        ]),
      ),
      finalMetricsByTrack: Object.fromEntries(
        Array.from(lastMetricsByTrack.entries()).map(([track, metrics]) => [
          track,
          metrics ?? null,
        ]),
      ),
      noTradeStreakByTrack: Object.fromEntries(noTradeStreakByTrack.entries()),
      weakSignalStreakByTrack: Object.fromEntries(
        weakSignalStreakByTrack.entries(),
      ),
      endedRound: round,
      endedAt: new Date().toISOString(),
    })
    writeText(path.join(runDir, "final_report.txt"), [
      `status=${status}`,
      `runId=${runId}`,
      `tracks=${tracks.join(",")}`,
      `maxTargetPassed=${maxTargetPassed ?? "NONE"}`,
      `termination=${terminationReason ?? "NONE"}`,
      `finalTargetPct=${targetPct}`,
      `lockboxOk=${lockboxOk}`,
      `lockboxEvaluated=${lockboxEvaluated}`,
      `lockboxBlockedReason=${primaryLockboxBlockedReason ?? "NONE"}`,
      `lockboxBlockedReasons=${lockboxBlockedReasons.join(",") || "NONE"}`,
      `lockboxMoonshotGate=${JSON.stringify(lockboxByTrack.get("SURGE_EOD")?.moonshotGate ?? null)}`,
      `lockboxByTrack=${lockboxSummaryFlags.join(",")}`,
      `deployPickMode=${deployPickMode}`,
      `stabilityMinImproveScore=${stabilityMinImproveScore}`,
      `stabilityMinHoldRounds=${stabilityMinHoldRounds}`,
      `adaptiveBudgetEnabled=${adaptiveBudgetEnabled}`,
      `adaptiveBudgetModeFinal=${adaptiveBudgetMode}`,
      `adaptiveBudgetRounds=${JSON.stringify(adaptiveBudgetRounds)}`,
      `earlyGateConfig=${JSON.stringify(earlyGateConfig)}`,
      `primaryFailureReason=${primaryFailure.reason ?? "NONE"}`,
      `primaryFailureSource=${primaryFailure.source ?? "NONE"}`,
      `failureLeaderboard=${JSON.stringify(failureLeaderboard.top)}`,
      `lastPassedConfig=${lastSurge ? `targetPct=${lastSurge.targetPct} versionLabel=${lastSurge.versionLabel}` : "NONE"}`,
      `lastPassedMetrics=${lastPassedMetrics ? JSON.stringify(lastPassedMetrics) : "NONE"}`,
      `finalMetrics=${lastMetrics ? JSON.stringify(lastMetrics) : "NONE"}`,
    ])
    await prisma.$disconnect()
  }

  checkMemory("pre-search-loop", { log: true })
  while (true) {
    round += 1
    const tier = lowRamSafetyCaps
      ? round <= 2
        ? 0
        : round <= 7
          ? 1
          : 2
      : lightMode
        ? round === 1
          ? 0
          : 1
        : round === 1
          ? 0
          : round === 2
            ? 1
            : round === 3
              ? 2
              : 3
    const roundMemorySnap = checkMemory(`round-start:${round}`, { log: true })
    if (adaptiveBudgetEnabled) {
      const nextMode = resolveAdaptiveBudgetMode({
        snap: roundMemorySnap,
        previousMode: adaptiveBudgetMode,
        minHeadroomRatio: memoryHeadroomRatio,
        maxRssBytes,
      })
      if (nextMode !== adaptiveBudgetMode) {
        console.log(
          `[adaptive-budget] round=${round} mode=${adaptiveBudgetMode} -> ${nextMode} headroomRatio=${roundMemorySnap.headroomRatio.toFixed(3)} rssMb=${roundMemorySnap.rssMb}`,
        )
      }
      adaptiveBudgetMode = nextMode
    } else {
      adaptiveBudgetMode = "normal"
    }
    incrementMapCounter(adaptiveBudgetModeRounds, adaptiveBudgetMode)
    const adaptiveBudgetScale =
      ADAPTIVE_BUDGET_SCALES[adaptiveBudgetMode] ??
      ADAPTIVE_BUDGET_SCALES.normal
    const rng = buildRng(`${args.seed}:${round}`)

    const passByTrack = new Map()
    const roundConfigByTrack = new Map()
    let plateauImproved = false
    for (const track of tracks) {
      const ctx = trackContext.get(track)
      if (!ctx || !ctx.windows || !ctx.data) {
        continue
      }
      const priorNoTradeStreak =
        Number(noTradeStreakByTrack.get(track) ?? 0) || 0
      const priorWeakSignalStreak =
        Number(weakSignalStreakByTrack.get(track) ?? 0) || 0
      const baseVersionLabel = buildVersionLabel(runId, track, round)
      const trainWindow = resolveAutosearchTrainTestMonths({
        horizonStart: ctx.horizonStart,
        trainAsOfDateKey: ctx.trainAsOfDateKey,
      })
      if (round === 1 && Number.isFinite(trainWindow.availableMonths)) {
        console.log(
          `[train-window] track=${track} trainAsOf=${ctx.trainAsOfDateKey} horizonStart=${ctx.horizonStart} availableMonths=${trainWindow.availableMonths} trainMonths=${trainWindow.trainMonths} testMonths=${trainWindow.testMonths}`,
        )
      }
      const ranges = resolveTrainTestRanges({
        asOfDateKey: ctx.trainAsOfDateKey,
        trainMonths: trainWindow.trainMonths,
        testMonths: trainWindow.testMonths,
      })
      const versionLabelWithRange = attachTrainRangeLabel({
        baseLabel: baseVersionLabel,
        trainFromDateKey: ranges.trainFromDateKey,
        trainToDateKey: ranges.trainToDateKey,
        track,
      })
      const versionLabel = attachRegimeTag({
        label: versionLabelWithRange,
        regime: ctx.regime,
      })
      const version = hashToVersion(versionLabel)
      const surgeExplorationBurst =
        track === "SURGE_EOD" &&
        lowRamSafetyCaps &&
        !stage2FromPool &&
        round % 5 === 0
      const stage2PoolEntry = stage2FromPool
        ? pickStage2CandidateFromPool({
            entries: stage2CandidatePool.byTrack.get(track) ?? [],
            round,
            rng,
            triedKeys: stage2PoolTriedKeysByTrack.get(track),
          })
        : null
      if (stage2FromPool && stage2PoolEntry) {
        const tried = stage2PoolTriedKeysByTrack.get(track) ?? new Set()
        tried.add(buildCandidatePoolEntryKey(stage2PoolEntry))
        stage2PoolTriedKeysByTrack.set(track, tried)
      }

      const policySpace = {
        candidateCount: capNumberList(
          tier === 0
            ? track === "SURGE_EOD"
              ? [80, 120, 200, 400, 500]
              : [200, 500]
            : tier === 1
              ? track === "SURGE_EOD"
                ? [120, 200, 400, 600, 800, 1000]
                : [500, 1000]
              : track === "SURGE_EOD"
                ? [120, 200, 400, 500, 1000, 2000]
                : [500, 1000, 2000],
          maxCandidateCount,
          track === "SURGE_EOD" ? 80 : 200,
        ),
        lookbackDays:
          track === "SURGE_EOD"
            ? tier === 0
              ? [20, 30, 45]
              : [20, 30, 45, 60, 75]
            : tier === 0
              ? [30, 45]
              : [30, 45, 60],
        entryWidthPct:
          track === "SURGE_EOD"
            ? [0.2, 0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 2.5, 3.0]
            : [0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 2.5, 3.0],
        stopPct:
          track === "SURGE_EOD"
            ? [0.4, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
            : [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
        targetPct: [1.0, 1.5, 2.0, 2.5],
        trailingPct: track === "SURGE_EOD" ? [0, 0.8, 1.5, 3.0] : [0, 1.5, 3.0],
        minRewardPct: track === "SURGE_EOD" ? [2.0, 3.0, 4.0, 5.0] : [5.0],
        minLiquidityM:
          track === "SURGE_EOD"
            ? [200, 300, 400, 600, 800, 1200]
            : [400, 600, 800],
      }

      const patternSpace = {
        supportMin: track === "SURGE_EOD" ? [8, 10, 20, 30] : [10, 20, 30],
        ruleMaxCandidates: capNumberList(
          tier <= 1 ? [5000, 20000] : [20000, 50000, 100000],
          maxRuleCandidates,
          5000,
        ),
        shapeKList: capNumberList(
          [800, 1200, 1600, 2000, 2400, 2800, 3000],
          maxShapeK,
          800,
        ),
        // Keep both engines alive to avoid getting trapped in single-engine
        // candidate loops during required-track zero-pass phases.
        engineType:
          track === "SURGE_EOD"
            ? ["chart", "rule", "chart", "rule"]
            : ["rule", "chart", "rule"],
      }
      if (adaptiveBudgetEnabled) {
        policySpace.candidateCount = scaleNumberList({
          values: policySpace.candidateCount,
          scale: adaptiveBudgetScale.candidateScale,
          minimum: track === "SURGE_EOD" ? 80 : 200,
          cap: maxCandidateCount,
        })
        patternSpace.ruleMaxCandidates = scaleNumberList({
          values: patternSpace.ruleMaxCandidates,
          scale: adaptiveBudgetScale.ruleScale,
          minimum: 5000,
          cap: maxRuleCandidates,
        })
        patternSpace.shapeKList = scaleNumberList({
          values: patternSpace.shapeKList,
          scale: adaptiveBudgetScale.shapeScale,
          minimum: 800,
          cap: maxShapeK,
        })
        if (!policySpace.candidateCount.length) {
          policySpace.candidateCount = [track === "SURGE_EOD" ? 80 : 200]
        }
        if (!patternSpace.ruleMaxCandidates.length) {
          patternSpace.ruleMaxCandidates = [5000]
        }
        if (!patternSpace.shapeKList.length) {
          patternSpace.shapeKList = [Math.min(maxShapeK, 800)]
        }
      }

      const pick = (list) => list[Math.floor(rng() * list.length)]

      const seedConfig = stage2PoolEntry
        ? stage2PoolEntry
        : surgeExplorationBurst
          ? null
          : (bestByTrack.get(track) ?? lastPassedByTrack.get(track))
      const fromStage2Pool = Boolean(stage2PoolEntry)
      const basePolicy =
        seedConfig && (!fromStage2Pool ? rng() < 0.5 : true)
          ? seedConfig.policyChoice
          : null
      const policyChoiceSeed = basePolicy
        ? { ...basePolicy }
        : {
            candidateCount: pick(policySpace.candidateCount),
            lookbackDays: pick(policySpace.lookbackDays),
            entryWidthPct: pick(policySpace.entryWidthPct),
            stopPct: pick(policySpace.stopPct),
            targetPct: pick(policySpace.targetPct),
            trailingPct: pick(policySpace.trailingPct),
            minRewardPct: pick(policySpace.minRewardPct),
            minLiquidityM: pick(policySpace.minLiquidityM),
          }
      let policyChoice = sanitizePolicyChoiceWithSpace({
        choice: policyChoiceSeed,
        policySpace,
      })

      if (basePolicy && !fromStage2Pool && rng() < 0.4) {
        const keys = [
          "candidateCount",
          "lookbackDays",
          "entryWidthPct",
          "stopPct",
          "targetPct",
          "trailingPct",
          "minRewardPct",
          "minLiquidityM",
        ]
        const key = keys[Math.floor(rng() * keys.length)]
        policyChoice[key] = pick(policySpace[key])
        policyChoice = sanitizePolicyChoiceWithSpace({
          choice: policyChoice,
          policySpace,
        })
      }

      const policyParams = {
        candidateCount: policyChoice.candidateCount,
        lookbackDays: policyChoice.lookbackDays,
        entryBandPct: toBandPct(policyChoice.entryWidthPct, 0.008),
        stopBandPct: toBandPct(policyChoice.stopPct, 0.03),
        targetBandPct: toBandPct(policyChoice.targetPct, 0.04),
        trailingPct: toBandPct(policyChoice.trailingPct, 0.03),
        minRewardPct: toBandPct(
          policyChoice.minRewardPct,
          DEFAULT_LEVEL_POLICY.minRewardPct,
        ),
        minLiquidity: Math.max(
          100_000_000,
          Math.round((Number(policyChoice.minLiquidityM) || 400) * 1_000_000),
        ),
        scoreEps: 1,
        vectorBins: 30,
      }

      const basePattern =
        seedConfig && (!fromStage2Pool ? rng() < 0.5 : true)
          ? seedConfig.patternChoice
          : null
      const patternChoiceSeed = basePattern
        ? { ...basePattern }
        : {
            supportMin: pick(patternSpace.supportMin),
            ruleMaxCandidates: pick(patternSpace.ruleMaxCandidates),
            engineType: pick(patternSpace.engineType),
            shapeKList: patternSpace.shapeKList,
          }
      let patternChoice = sanitizePatternChoiceWithSpace({
        choice: patternChoiceSeed,
        patternSpace,
      })

      if (basePattern && !fromStage2Pool && rng() < 0.4) {
        const key =
          rng() < 0.33
            ? "supportMin"
            : rng() < 0.66
              ? "ruleMaxCandidates"
              : "engineType"
        patternChoice[key] = pick(patternSpace[key])
        patternChoice = sanitizePatternChoiceWithSpace({
          choice: patternChoice,
          patternSpace,
        })
      }
      if (
        track === "GAP_15_BET" &&
        String(patternChoice.engineType ?? "").toLowerCase() === "chart"
      ) {
        const cooldownUntilRound =
          Number(gapChartSafePoolCooldownUntilByTrack.get(track) ?? 0) || 0
        if (cooldownUntilRound > round) {
          patternChoice = sanitizePatternChoiceWithSpace({
            choice: {
              ...patternChoice,
              engineType: "rule",
            },
            patternSpace,
          })
          const notedUntilRound =
            Number(
              gapChartSafePoolCooldownNotifiedUntilByTrack.get(track) ?? 0,
            ) || 0
          if (notedUntilRound !== cooldownUntilRound) {
            console.log(
              `[pattern-fallback] track=${track} requested=chart action=cooldown_to_rule untilRound=${cooldownUntilRound}`,
            )
            gapChartSafePoolCooldownNotifiedUntilByTrack.set(
              track,
              cooldownUntilRound,
            )
          }
        }
      }

      let patterns = ctx.patterns
      const stage2PoolFingerprint = String(
        stage2PoolEntry?.fingerprint ?? "",
      ).trim()
      const stage2PoolPatternCache =
        stage2PoolPatternCacheByTrack.get(track) ?? null
      const stage2PoolCachedPattern =
        stage2FromPool &&
        track === "GAP_15_BET" &&
        stage2PoolPatternCache &&
        stage2PoolFingerprint
          ? (stage2PoolPatternCache.get(stage2PoolFingerprint) ?? null)
          : null
      let patternSource = stage2PoolCachedPattern
        ? "stage2_pool_cache"
        : patterns
          ? "ctx_cache"
          : "none"
      if (stage2PoolCachedPattern) {
        patterns = stage2PoolCachedPattern
      }
      const patternPool =
        Array.isArray(ctx.patternPool) && ctx.patternPool.length
          ? ctx.patternPool
          : []
      if (lowRamSafetyCaps && patternPool.length) {
        const usePoolPattern =
          surgeExplorationBurst ||
          !patterns ||
          (track === "SURGE_EOD" && rng() < 0.45)
        if (usePoolPattern) {
          const poolPick = patternPool[Math.floor(rng() * patternPool.length)]
          if (poolPick) {
            patterns = poolPick
            patternSource = "pattern_pool"
            if (!disablePatternCache) {
              ctx.patterns = poolPick
            }
          }
        }
      }
      if (track === "GAP_15_BET" && patterns) {
        // GAP patterns must be explicitly labeled with a train cutoff to avoid lookahead.
        // If the cached/latest patterns are unsafe, force retraining with a safe versionLabel.
        try {
          assertGapPatternSafe({
            patterns,
            windowStart: ctx.windows.validation.fromDateKey,
          })
        } catch {
          patterns = null
          ctx.patterns = null
        }
      }
      const forceRetrainSurge =
        track === "SURGE_EOD" &&
        lowRamSafetyCaps &&
        priorNoTradeStreak >= 2 &&
        round % 3 === 0
      const forceRetrainWeakSignals =
        priorWeakSignalStreak >= 2 && round % 2 === 0
      const stage2PoolNeedsPatternTrain =
        stage2FromPool &&
        track === "GAP_15_BET" &&
        Boolean(stage2PoolEntry) &&
        !stage2PoolCachedPattern
      const stage2PoolTrainingSeed = buildStage2PoolTrainingSeed({
        entry: stage2PoolEntry,
        round,
      })
      if (stage2FromPool && stage2PoolEntry && round <= 2) {
        console.log(
          `[stage2-pool-seed] track=${track} sourceRunId=${String(stage2PoolEntry?.sourceRunId ?? "").trim() || "NONE"} sourceRound=${Number(stage2PoolEntry?.sourceRound ?? 0) || 0} trainSeed=${stage2PoolTrainingSeed}`,
        )
      }
      const shouldTrain = stage2FromPool
        ? stage2PoolNeedsPatternTrain ||
          !patterns ||
          forceRetrainSurge ||
          forceRetrainWeakSignals
        : (!lowRamSafetyCaps && tier >= 2) ||
          !patterns ||
          forceRetrainSurge ||
          forceRetrainWeakSignals
      if (shouldTrain) {
        checkMemory(`train-pre:${track}:r${round}`)
        const trained = trainPatternsFromData({
          data: ctx.data,
          track,
          ranges,
          seed: stage2FromPool
            ? stage2PoolTrainingSeed
            : `${args.seed}:${round}`,
          supportMin: patternChoice.supportMin,
          precisionMin: dataMode === "contract" ? 0.3 : 0.55,
          maxRules: patternChoice.ruleMaxCandidates,
          maxK: maxShapeK,
          candidateKs: patternChoice.shapeKList,
          vectorBins: 30,
        })
        checkMemory(`train-post:${track}:r${round}`, { log: true })
        const trainedWithLabel = {
          ...trained,
          versionLabel,
        }
        patterns = trainedWithLabel
        patternSource = "trained"
        if (
          stage2FromPool &&
          track === "GAP_15_BET" &&
          stage2PoolPatternCache &&
          stage2PoolFingerprint
        ) {
          rememberStage2PoolPattern({
            cache: stage2PoolPatternCache,
            fingerprint: stage2PoolFingerprint,
            patterns: trainedWithLabel,
          })
        }
        ctx.patterns = disablePatternCache ? null : trainedWithLabel
      }
      const requestedEngineType = normalizeEngineType(
        stage2PoolEntry?.engineType ?? patternChoice?.engineType,
      )
      const allowUnsafeGapChartFallback = parseBooleanEnv(
        process.env.GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK ?? "0",
      )
      if (requestedEngineType === "chart") {
        const hasChartShapes =
          Array.isArray(patterns?.shapes) && patterns.shapes.length > 0
        if (!hasChartShapes && patternPool.length) {
          const chartPoolRaw = patternPool.filter(
            (snapshot) =>
              Array.isArray(snapshot?.shapes) && snapshot.shapes.length > 0,
          )
          const chartPool =
            track === "GAP_15_BET"
              ? chartPoolRaw.filter((snapshot) => {
                  try {
                    assertGapPatternSafe({
                      patterns: snapshot,
                      windowStart: ctx.windows.validation.fromDateKey,
                    })
                    return true
                  } catch {
                    return false
                  }
                })
              : chartPoolRaw
          if (chartPool.length) {
            const fallbackChartSnapshot =
              chartPool[Math.floor(rng() * chartPool.length)]
            patterns = fallbackChartSnapshot
            patternSource = "chart_pool_fallback"
            if (track === "GAP_15_BET") {
              gapChartSafePoolCooldownUntilByTrack.delete(track)
              gapChartSafePoolCooldownNotifiedUntilByTrack.delete(track)
            }
            if (!disablePatternCache) {
              ctx.patterns = fallbackChartSnapshot
            }
          } else if (track === "GAP_15_BET" && chartPoolRaw.length) {
            if (allowUnsafeGapChartFallback && stage === "stage1") {
              const fallbackChartSnapshot =
                chartPoolRaw[Math.floor(rng() * chartPoolRaw.length)]
              patterns = fallbackChartSnapshot
              patternSource = "chart_pool_fallback_unsafe"
              gapChartSafePoolCooldownUntilByTrack.delete(track)
              gapChartSafePoolCooldownNotifiedUntilByTrack.delete(track)
              if (!disablePatternCache) {
                ctx.patterns = fallbackChartSnapshot
              }
              console.log(
                `[pattern-fallback] track=${track} requested=chart rawPool=${chartPoolRaw.length} safePool=0 action=use_unsafe_fallback_stage1`,
              )
            } else {
              const cooldownUntilRound = Math.max(
                round + 1,
                round + gapChartSafePoolCooldownRounds,
              )
              gapChartSafePoolCooldownUntilByTrack.set(
                track,
                cooldownUntilRound,
              )
              gapChartSafePoolCooldownNotifiedUntilByTrack.set(
                track,
                cooldownUntilRound,
              )
              console.log(
                `[pattern-fallback] track=${track} requested=chart rawPool=${chartPoolRaw.length} safePool=0 action=skip_unsafe_fallback cooldownToRound=${cooldownUntilRound}`,
              )
            }
          }
        }
      }

      if (patterns) {
        if (allowWrites) {
          await persistPatterns({
            prisma,
            track,
            version,
            versionLabel,
            patterns,
          })
        }
      }
      const scopedPatternSelection = scopePatternsByEngine({
        patterns,
        requestedEngineType,
      })
      patterns = scopedPatternSelection.patterns
      patternChoice = {
        ...patternChoice,
        engineType: scopedPatternSelection.engineType,
      }

      if (allowWrites) {
        await prisma.levelPolicy.deleteMany({
          where: { track, versionLabel },
        })
        await prisma.levelPolicy.create({
          data: {
            track,
            version,
            versionLabel,
            payload: {
              asOfDateKey: ctx.asOfDateKey,
              lookbackDays: policyParams.lookbackDays,
              entryBandPct: policyParams.entryBandPct,
              stopBandPct: policyParams.stopBandPct,
              targetBandPct: policyParams.targetBandPct,
              trailingPct: policyParams.trailingPct,
              minRewardPct: policyParams.minRewardPct,
              targets: [
                policyParams.targetBandPct,
                policyParams.targetBandPct * 1.5,
              ],
              trailingEnabled: policyParams.trailingPct > 0,
            },
            summary: `asOf=${ctx.asOfDateKey} lookback=${policyParams.lookbackDays}`,
          },
        })
      }

      const validationEval = evaluateWindow({
        data: ctx.data,
        patterns,
        policyParams,
        entryWindowDays,
        track,
        calendar: ctx.calendar,
        weekKeys: ctx.windows.validation.weekKeys,
        windowStart: ctx.windows.validation.fromDateKey,
        windowEnd: ctx.windows.validation.toDateKey,
        costModel: rampCostModel,
      })
      checkMemory(`validation-post:${track}:r${round}`)
      const requiredBigUpWeeks = track === "SURGE_EOD" ? 10 : 0
      const validationBigUp =
        track === "SURGE_EOD"
          ? computeBigUpMetrics({
              signals: validationEval.signals,
              candles: ctx.data.candles,
              calendar: ctx.calendar,
              weekKeys: ctx.windows.validation.weekKeys,
            })
          : {
              bigUpWeeksCount24: 0,
              bigUpExcludedByGapCount: 0,
              bigUpWeekKeys: [],
            }
      const validationNoFillRate =
        validationEval.results.length > 0
          ? countNoFillResults(validationEval.results) /
            validationEval.results.length
          : 0
      const validationDiagnostics = summarizeEvaluation(validationEval)
      const validationStopLikePct = computeStopLikePctFromDiagnostics(
        validationDiagnostics,
      )
      const validationTradeGatePass =
        validationDiagnostics.completedTrades >= minValidationTrades
      const validationEarlyGate = evaluateValidationEarlyGate({
        diagnostics: validationDiagnostics,
        validationTradeGatePass,
        minValidationTrades,
        weekSeries: validationEval.weekSeries,
        evalWeeks: args.evalWeeks,
        config: earlyGateConfig,
      })
      const validationSummary = evaluateWeeklySummary({
        weekSeries: validationEval.weekSeries,
        targetPct,
        targetStart: 5,
        minWeeksGE: 10,
        bigUpWeeksCount24: validationBigUp.bigUpWeeksCount24,
        requiredBigUpWeeks,
        minWorst2wAvgPct,
        noFillRate: validationNoFillRate,
        noFillRateMax: 0.35,
        emptyWeekAllowed: 0,
        useRamp: false,
        worst2wDistributionConfig: worst2wDistConfig,
      })
      const validationLegacyWeeklyGate = evaluateLegacyWeeklyGate({
        track,
        weekSeries: validationEval.weekSeries,
        targetPct,
        args,
      })

      const valPath = resolveRunSummaryPath({
        runDir,
        track,
        window: "validation",
        round,
      })
      const legacyValPath = resolveLegacySummaryPath({
        track,
        window: "validation",
      })
      const validationPayload = {
        track,
        window: "validation",
        ok: true,
        evalWeeks: args.evalWeeks,
        targetPct,
        completedTrades: validationDiagnostics.completedTrades,
        minValidationTrades,
        tradeGatePass: validationTradeGatePass,
        diagnostics: validationDiagnostics,
        weekSeries: validationEval.weekSeries,
        metrics: validationSummary.metrics,
        countWeeksGE: validationSummary.metrics.countWeeksGE,
        emptyWeeksCount: validationSummary.metrics.emptyWeeksCount,
        minWeeklyPct: validationSummary.metrics.minWeeklyPct,
        worst2wAvgPct: validationSummary.metrics.worst2wAvgPct,
        worst2wWindowStart: validationSummary.metrics.worst2wWindowStart,
        worst2wWindowEnd: validationSummary.metrics.worst2wWindowEnd,
        worst2wGatePass: validationSummary.metrics.worst2wGatePass,
        worst2wGateReason: validationSummary.metrics.worst2wGateReason,
        minWorst2wAvgPct: validationSummary.metrics.minWorst2wAvgPct,
        stopLikePct: validationStopLikePct,
        bigUpWeeksCount24: validationBigUp.bigUpWeeksCount24,
        bigUpExcludedByGapCount: validationBigUp.bigUpExcludedByGapCount,
        ...(validationBigUp.bigUpWeekKeys?.length
          ? { bigUpWeekKeys: validationBigUp.bigUpWeekKeys }
          : {}),
        validationEarlyGate,
        legacyWeeklyGate: validationLegacyWeeklyGate,
        worst2wGate: validationSummary.worst2wGate,
        worst2wDistGate: validationSummary.worst2wDist,
        ...validationSummary.metrics,
      }
      const validationDiagnosticsPath = writeEvaluationDiagnostics({
        runDir,
        track,
        window: "validation",
        round,
        evaluation: validationEval,
        diagnostics: validationDiagnostics,
        sampleLimit: evalDiagnosticSampleLimit,
        meta: {
          targetPct,
          minValidationTrades,
          tradeGatePass: validationTradeGatePass,
          stopLikePct: validationStopLikePct,
        },
      })
      validationPayload.diagnosticsPath = validationDiagnosticsPath

      const lockboxSummary = null
      const lockboxPath = null
      const lockboxPayload = null
      const basePass =
        validationSummary.pass &&
        validationTradeGatePass &&
        validationEarlyGate.pass
      const continuity = buildContinuityGate({
        enabled: continuityGateEnabled,
        targetPct,
        targetStart: args.targetStart,
        anchor: anchorPassedByTrack.get(track) ?? null,
        metrics: {
          ...validationSummary.metrics,
          completedTrades: validationDiagnostics.completedTrades,
          tradeGatePass: validationTradeGatePass,
          stopLikePct: validationStopLikePct,
          noFillRate: validationSummary.metrics.noFillRate,
        },
        thresholds: continuityThresholds,
        isRequiredTrack: requiredTracks.includes(track),
      })
      const skipMoonshotGate =
        track === "SURGE_EOD" && !validationEarlyGate.pass
      const moonshotGate =
        track === "SURGE_EOD" && !skipMoonshotGate
          ? await loadMoonshotWindowStats({
              prisma,
              calendar: ctx.calendar,
              windowStartDateKey: ctx.windows.validation.fromDateKey,
              windowEndDateKey: ctx.windows.validation.toDateKey,
              patternVersionLabel: versionLabel,
              strategyVersion: moonshotStrategyVersion || null,
              strategyVersionPrefix: moonshotStrategyPrefix,
            })
          : null
      const moonshotGatePass =
        track === "SURGE_EOD"
          ? skipMoonshotGate
            ? false
            : Boolean(moonshotGate?.pass)
          : true
      if (track === "SURGE_EOD" && moonshotGate && !moonshotGatePass) {
        const bucketsEvaluated =
          Number(moonshotGate?.stats?.bucketsEvaluated ?? 0) || 0
        const bucketsFailed =
          Number(moonshotGate?.stats?.bucketsFailed ?? 0) || 0
        console.log(
          `[moonshot-4w] pass=FAIL bucketsFailed=${bucketsFailed}/${bucketsEvaluated} reason=${moonshotGate?.reason ?? MOONSHOT_GATE_FAILED}`,
        )
      }
      const pass =
        basePass &&
        continuity.pass &&
        moonshotGatePass &&
        validationLegacyWeeklyGate.pass

      const metrics = {
        ...validationSummary.metrics,
        bigUpWeeksCount24: validationBigUp.bigUpWeeksCount24,
        bigUpExcludedByGapCount: validationBigUp.bigUpExcludedByGapCount,
        completedTrades: validationDiagnostics.completedTrades,
        tradeGatePass: validationTradeGatePass,
        stopLikePct: validationStopLikePct,
        continuityPass: continuity.pass,
        continuityReasons: continuity.reasons,
        moonshotGatePass,
        moonshotGateReason: moonshotGate?.reason ?? null,
        moonshotGateFailedWeeks: null,
        moonshotGateFailedBuckets: moonshotGate?.stats?.bucketsFailed ?? null,
        worst2wGatePass: validationSummary.metrics.worst2wGatePass,
        worst2wGateReason: validationSummary.metrics.worst2wGateReason,
        worst2wAvgPct: validationSummary.metrics.worst2wAvgPct,
        legacyWeeklyGatePass: validationLegacyWeeklyGate.pass,
        legacyWeeklyGateReasons: validationLegacyWeeklyGate.reasons,
        validationEarlyGatePass: validationEarlyGate.pass,
        validationEarlyGateReasons: validationEarlyGate.reasons,
        targetPct,
      }
      validationPayload.continuity = continuity
      validationPayload.validationEarlyGate = validationEarlyGate
      if (moonshotGate) {
        validationPayload.moonshotGate = {
          scope: MOONSHOT_GATE_SCOPE,
          pass: moonshotGatePass,
          reason: moonshotGate.reason ?? null,
          signalsLoaded: moonshotGate.signalsLoaded ?? 0,
          signalsQualified: moonshotGate.signalsQualified ?? 0,
          outcomesCount: moonshotGate.outcomesCount ?? 0,
          stats: moonshotGate.stats ?? null,
        }
      } else if (skipMoonshotGate) {
        validationPayload.moonshotGate = {
          scope: MOONSHOT_GATE_SCOPE,
          pass: false,
          reason: "SKIPPED_BY_EARLY_GATE",
          signalsLoaded: 0,
          signalsQualified: 0,
          outcomesCount: 0,
          stats: null,
        }
      }
      const failureReasons = pass
        ? []
        : collectFailureReasons({
            validationSummary,
            validationTradeGatePass,
            continuity,
            moonshotGatePass,
            moonshotGateReason: skipMoonshotGate
              ? "SKIPPED_BY_EARLY_GATE"
              : moonshotGate?.reason,
            legacyWeeklyGate: validationLegacyWeeklyGate,
            validationEarlyGate,
            metrics,
          })
      const failureReasonDetails = normalizeFailureReasons(failureReasons)
      metrics.failureReasons = failureReasons
      metrics.failureReasonDetails = failureReasonDetails
      validationPayload.failureReasons = failureReasons
      validationPayload.failureReasonDetails = failureReasonDetails
      const candidateFingerprint =
        String(stage2PoolEntry?.fingerprint ?? "").trim() ||
        buildFallbackCandidateFingerprint({
          track,
          policyChoice,
          patternChoice,
        })
      writeJson(valPath, validationPayload)
      writeJson(legacyValPath, validationPayload)
      if (!pass) {
        const trackCounter = failureReasonCounterByTrack.get(track)
        for (const detail of failureReasonDetails) {
          const reasonKey = toFailureCounterKey(detail)
          incrementMapCounter(failureReasonCounter, reasonKey)
          if (trackCounter) {
            incrementMapCounter(trackCounter, reasonKey)
          }
        }
        if (candidateFingerprint) {
          const primaryReason =
            failureReasonDetails[0]?.reasonCode ??
            failureReasons[0] ??
            "UNKNOWN_FAIL"
          incrementMapCounter(
            failureFingerprintCounter,
            `${String(candidateFingerprint)}|${String(primaryReason)}`,
          )
        }
      }
      lastMetricsByTrack.set(track, metrics)
      const bestEntry = bestByTrack.get(track)
      const bestUpdate = updateBestState({
        best: bestEntry?.metrics,
        candidate: metrics,
        eps: {
          countWeeksGE: args.improveEpsHighWeeks,
          totalWeeklySumPct: args.improveEpsSumPct,
          ...(track === "SURGE_EOD"
            ? {
                maxRegressCountWeeksGE: 1,
                maxRegressMinWeeklyPct: 0.5,
                maxRegressBigUpWeeksCount24: 1,
                maxRegressTotalWeeklySumPct: 8,
                stopLikePct: 0.02,
                maxRegressStopLikePct: 0.08,
              }
            : null),
        },
      })

      if (bestUpdate.improved) {
        bestByTrack.set(track, {
          metrics: bestUpdate.best,
          patternVersionLabel: versionLabel,
          policyVersionLabel: versionLabel,
          version,
          policyChoice,
          patternChoice,
        })
        writeJson(path.join(runDir, "best.json"), {
          tracks: Object.fromEntries(bestByTrack.entries()),
        })
        if (allowWrites) {
          await prisma.autoSearchRun.update({
            where: { runId },
            data: {
              best: { tracks: Object.fromEntries(bestByTrack.entries()) },
            },
          })
        }
      }

      if (requiredTracks.includes(track)) {
        plateauImproved = plateauImproved || bestUpdate.improved
      }
      if (track === "SURGE_EOD") {
        const line = `[T=${targetPct} r=${round} tier=${tier}] bigUpWeeks=${metrics.bigUpWeeksCount24 ?? 0} countGE=${metrics.countWeeksGE ?? 0} minWeek=${Number(metrics.minWeeklyPct ?? 0).toFixed(2)} stopLike=${Number(metrics.stopLikePct ?? 1).toFixed(2)} emptyWeeks=${metrics.emptyWeeksCount ?? 0} completedTrades=${metrics.completedTrades ?? 0} tradeGate=${metrics.tradeGatePass ? "PASS" : "FAIL"} continuity=${continuity.pass ? "PASS" : "FAIL"}${continuity.pass ? "" : `(${continuity.reasons.join("|") || "UNKNOWN"})`} moonshotGate=${moonshotGatePass ? "PASS" : "FAIL"} -> ${pass ? "PASS" : "FAIL"} | best: bigUpWeeks=${bestUpdate.best.bigUpWeeksCount24 ?? 0} countGE=${bestUpdate.best.countWeeksGE ?? 0} minWeek=${Number(bestUpdate.best.minWeeklyPct ?? 0).toFixed(2)} stopLike=${Number(bestUpdate.best.stopLikePct ?? 1).toFixed(2)}`
        if (round % Math.max(1, args.printEvery) === 0) {
          console.log(line)
        }
      }

      const weakSignal =
        !validationTradeGatePass ||
        !validationEarlyGate.pass ||
        !continuity.pass ||
        !moonshotGatePass ||
        (Number(metrics.countWeeksGE ?? 0) || 0) <= 0 ||
        Number(metrics.stopLikePct ?? 1) >= 0.8
      const nextWeakSignalStreak = weakSignal ? priorWeakSignalStreak + 1 : 0
      weakSignalStreakByTrack.set(track, nextWeakSignalStreak)

      if (allowWrites) {
        await prisma.autoSearchCandidate.create({
          data: {
            runId,
            round,
            track,
            tier,
            config: {
              patternVersionLabel: versionLabel,
              policyVersionLabel: versionLabel,
              policyParams,
              policyChoice,
              patternChoice,
              patternSource,
              engineType: normalizeEngineType(
                stage2PoolEntry?.engineType ?? patternChoice?.engineType,
              ),
              sourceRunId: stage2PoolEntry?.sourceRunId ?? null,
              sourceRound: stage2PoolEntry?.sourceRound ?? null,
            },
            valSummaryPath: valPath,
            lockboxSummaryPath: lockboxPath,
            metrics: {
              ...metrics,
              pass,
              lockboxPass: lockboxSummary?.pass ?? null,
            },
          },
        })
      }

      appendNdjson(path.join(runDir, "candidates.ndjson"), {
        round,
        track,
        tier,
        targetPct,
        pass,
        bestUpdated: bestUpdate.improved,
        metrics,
        fingerprint: candidateFingerprint ?? null,
        engineType: normalizeEngineType(
          stage2PoolEntry?.engineType ?? patternChoice?.engineType,
        ),
        policyChoice,
        patternChoice,
        patternSource,
        sourceRunId: stage2PoolEntry?.sourceRunId ?? null,
        sourceRound: stage2PoolEntry?.sourceRound ?? null,
        valSummaryPath: valPath,
        lockboxSummaryPath: lockboxPath,
      })

      passByTrack.set(track, pass)
      const roundEntry = {
        pass,
        targetPct,
        version,
        versionLabel,
        engineType: normalizeEngineType(
          stage2PoolEntry?.engineType ?? patternChoice?.engineType,
        ),
        policyChoice,
        patternChoice,
        patternSource,
        policyParams,
        metrics,
        sourceRunId: stage2PoolEntry?.sourceRunId ?? null,
        sourceRound: stage2PoolEntry?.sourceRound ?? null,
        diagnosticsPath: validationDiagnosticsPath,
        validation: validationPayload,
        completedTrades: validationDiagnostics.completedTrades,
        tradeGatePass: validationTradeGatePass,
        continuity,
        moonshotGate,
        failureReasons,
        weakSignal,
        lockbox: lockboxPayload,
      }
      roundConfigByTrack.set(track, roundEntry)
      recordPassedTrackCandidate({
        track,
        roundEntry,
        roundNumber: round,
      })
      if (pass) {
        const deployScore = computeDeployScore({
          metrics: roundEntry.metrics,
          targetPct: roundEntry.targetPct,
        })
        const prevStable = stableBestByTrack.get(track)
        const prevScore = Number(prevStable?.score ?? -Infinity)
        const scoreDelta = deployScore - prevScore
        const prevTargetPct = Number(prevStable?.entry?.targetPct ?? 0) || 0
        const targetImproved = Number(roundEntry.targetPct ?? 0) > prevTargetPct
        const heldRounds = prevStable
          ? Math.max(
              0,
              round - (Number(prevStable.updatedAtRound ?? round) || round),
            )
          : Number.POSITIVE_INFINITY
        const shouldPromote =
          !prevStable ||
          targetImproved ||
          (scoreDelta >= stabilityMinImproveScore &&
            heldRounds >= stabilityMinHoldRounds)
        if (shouldPromote) {
          stableBestByTrack.set(track, {
            score: deployScore,
            entry: roundEntry,
            updatedAtRound: round,
            scoreDelta,
            heldRounds,
          })
        }
      }
      checkMemory(`track-end:${track}:r${round}`)
    }

    const surgeRoundEntry = roundConfigByTrack.get("SURGE_EOD")
    const surgeMoonshotGate = surgeRoundEntry?.moonshotGate ?? null
    if (
      requiredTracks.includes("SURGE_EOD") &&
      surgeMoonshotGate &&
      surgeMoonshotGate.pass === false
    ) {
      if (round >= minRoundsBeforeSurgeGateTerminate) {
        await finalizeRun({
          terminationReason: MOONSHOT_GATE_FAILED,
          statusOverride: args.dryRun ? "DRY_RUN" : MOONSHOT_GATE_FAILED,
        })
        return
      }
      console.log(
        `[surge-gate] defer-termination round=${round}/${minRoundsBeforeSurgeGateTerminate} reason=${MOONSHOT_GATE_FAILED}`,
      )
    }

    if (allowWrites) {
      runCommand("node", [
        "scripts/autosearch/retention_cleanup.mjs",
        `--runId=${runId}`,
        "--keepLast=5",
      ])
    }

    const passRound = requiredTracks.every(
      (track) => passByTrack.get(track) === true,
    )
    let maxNoTradeStreak = 0
    let maxWeakSignalStreak = 0
    for (const track of requiredTracks) {
      const roundEntry = roundConfigByTrack.get(track)
      const completedTrades = Number(roundEntry?.completedTrades ?? 0) || 0
      const prevStreak = Number(noTradeStreakByTrack.get(track) ?? 0) || 0
      const nextStreak =
        completedTrades >= minValidationTrades ? 0 : prevStreak + 1
      noTradeStreakByTrack.set(track, nextStreak)
      if (nextStreak > maxNoTradeStreak) {
        maxNoTradeStreak = nextStreak
      }
      const weakStreak = Number(weakSignalStreakByTrack.get(track) ?? 0) || 0
      if (weakStreak > maxWeakSignalStreak) {
        maxWeakSignalStreak = weakStreak
      }
    }
    if (passRound) {
      maxTargetPassed = targetPct
      targetPct = advanceTargetIfPassed({ targetPct, pass: true })
      failStreak = 0
      plateauCount = 0
      bestByTrack.clear()
      for (const track of requiredTracks) {
        noTradeStreakByTrack.set(track, 0)
        weakSignalStreakByTrack.set(track, 0)
      }
    } else {
      failStreak = updateFailStreak({ failStreak, pass: false })
      plateauCount = updatePlateau({ plateauCount, improved: plateauImproved })
      if (maxNoTradeStreak >= noTradeTerminateRounds) {
        let deferNoTradeTermination = false
        if (stage2FromPool) {
          if (round < stage2PoolNoTradeMinRounds) {
            deferNoTradeTermination = true
            console.log(
              `[stage2-pool-no-trade-defer] reason=MIN_ROUNDS round=${round}/${stage2PoolNoTradeMinRounds} streak=${maxNoTradeStreak}/${noTradeTerminateRounds}`,
            )
          } else {
            const lowCoverageTracks = []
            for (const track of requiredTracks) {
              const streak = Number(noTradeStreakByTrack.get(track) ?? 0) || 0
              if (streak < noTradeTerminateRounds) continue
              const totalPool =
                (stage2CandidatePool.byTrack.get(track) ?? []).length || 0
              const triedPool =
                (stage2PoolTriedKeysByTrack.get(track) ?? new Set()).size || 0
              const coverage = totalPool > 0 ? triedPool / totalPool : 1
              if (coverage < stage2PoolNoTradeCoverageFloor) {
                lowCoverageTracks.push(
                  `${track}:${triedPool}/${totalPool}:${coverage.toFixed(3)}`,
                )
              }
            }
            if (lowCoverageTracks.length > 0) {
              deferNoTradeTermination = true
              console.log(
                `[stage2-pool-no-trade-defer] reason=POOL_COVERAGE coverageFloor=${stage2PoolNoTradeCoverageFloor.toFixed(2)} tracks=${lowCoverageTracks.join(",")}`,
              )
            }
          }
        }
        if (!deferNoTradeTermination) {
          await finalizeRun({ terminationReason: "NO_TRADES" })
          return
        }
      }
      if (maxWeakSignalStreak >= weakSignalTerminateRounds) {
        await finalizeRun({ terminationReason: "WEAK_SIGNALS" })
        return
      }
      if (
        stage === "stage2" &&
        args.stage2FailFastEnabled === true &&
        round >= args.stage2FailFastMinRounds &&
        requiredTracks.length > 0
      ) {
        const weakTracks = requiredTracks.filter((track) => {
          const bestMetrics = bestByTrack.get(track)?.metrics
          if (!bestMetrics) {
            return true
          }
          const bestWorst2wAvg = Number(bestMetrics.worst2wAvgPct)
          const bestCountWeeksGE = Number(bestMetrics.countWeeksGE ?? 0) || 0
          const hardWorst2wFail =
            Number.isFinite(bestWorst2wAvg) &&
            bestWorst2wAvg <=
              Number(args.minWorst2wAvgPct) - args.stage2FailFastWorst2wGap
          return (
            hardWorst2wFail &&
            bestCountWeeksGE <= args.stage2FailFastMaxCountWeeksGE
          )
        })
        if (weakTracks.length === requiredTracks.length) {
          console.log(
            `[stage2-fast-fail] reason=WORST2W_BELOW_THRESHOLD round=${round} weakTracks=${weakTracks.join(",")} threshold=${Number(args.minWorst2wAvgPct).toFixed(2)} gap=${Number(args.stage2FailFastWorst2wGap).toFixed(2)}`,
          )
          await finalizeRun({ terminationReason: "WORST2W_BELOW_THRESHOLD" })
          return
        }
      }
      const termination = shouldTerminateSearch({
        failStreak,
        plateauCount,
        blocked: false,
        plateauLimit: args.plateauRounds,
      })
      if (termination) {
        await finalizeRun({ terminationReason: termination })
        return
      }
    }

    if (args.maxRounds && round >= args.maxRounds) {
      await finalizeRun({
        terminationReason: "MAX_ROUNDS",
        statusOverride: args.dryRun ? "DRY_RUN" : "MAX_ROUNDS",
      })
      return
    }
    checkMemory(`round-end:${round}`, { log: true })
  }
}

run().catch(async (error) => {
  try {
    const ctx = runFailureContext
    if (ctx?.allowWrites && ctx?.runId && ctx?.finalized !== true) {
      const abortedMessage =
        error instanceof Error
          ? String(error.message ?? "").slice(0, 500)
          : String(error ?? "").slice(0, 500)
      const finalReportPath = path.join(ctx.runDir, "final_report.json")
      if (!fs.existsSync(finalReportPath)) {
        writeJson(finalReportPath, {
          ...buildFinalReportBase({
            runId: ctx.runId,
            status: "ABORTED",
            dataMode: "unknown",
            tracks: [],
            passMode: "all",
          }),
          termination: "UNHANDLED_ERROR",
          errorMessage: abortedMessage,
        })
      }
      const prisma = new PrismaClient()
      await prisma.autoSearchRun
        .updateMany({
          where: { runId: ctx.runId, status: "RUNNING" },
          data: {
            status: "ABORTED",
            notes: {
              abortedAt: new Date().toISOString(),
              abortedReason: "UNHANDLED_ERROR",
              errorMessage: abortedMessage,
            },
          },
        })
        .catch(() => null)
      await prisma.$disconnect().catch(() => undefined)
    }
  } catch {
    // best-effort cleanup
  }
  console.error("[go-live-autosearch] failed", error)
  process.exitCode = 1
})
