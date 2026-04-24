import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildPerfectPrototypeDailyPack } from "../src/lib/perfect_prototype_daily_pack.mjs"
import { minePerfectPrototypesPrepared } from "../src/lib/perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeStepbExactIndex,
  loadPerfectPrototypeStepbExactIndex,
} from "../src/lib/perfect_prototype_stepb_exact_index.mjs"
import { readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

const makeDate = (day) => `2024-03-${String(day).padStart(2, "0")}`

const buildConfig = (dataDir) => ({
  template: {
    localWindow: 3,
    globalWindow: 4,
    featureAsOf: "t-1",
  },
  backtest: {
    entry: "NEXT_DAY_OPEN",
    holdDays: 3,
    targetPct: 0.08,
    stopLossPct: 0.04,
  },
  event: {
    highJumpMode: "FROM_OPEN_EX_GAP",
    highJumpThreshold: 0.08,
    recentImpulseDiscovery: {
      enabled: true,
      lookbackTradingDays: 2,
    },
  },
  lightweight: {
    stepB: {
      perfectPrototypeBaseline: {
        enabled: true,
        contractVersion: 2,
        lineId: "stepb_dplus1_plus_lite",
        strategyMode: "STEPB_DPLUS1_BASELINE_V1",
        contextSurface: "v3_contextual_plus_lite",
        entryRule: "NEXT_DAY_OPEN",
        holdDays: 3,
        targetPct: 0.08,
        stopLossPct: 0.04,
        featureAsOf: "t-1",
        exactCollectionMode: "train_precision_1_only",
        maxGapTradingDays: 100000,
      },
    },
  },
  filters: {},
  periods: {
    warmup: { from: makeDate(1), to: makeDate(2) },
    discovery: { from: makeDate(5), to: makeDate(8) },
    online: { from: makeDate(9), to: makeDate(9) },
    lockbox: { from: makeDate(10), to: makeDate(10) },
  },
  dataPaths: {
    candleDailyJsonl: path.join(dataDir, "candles.jsonl"),
    universeJsonl: path.join(dataDir, "universe.jsonl"),
    symbolMasterJsonl: path.join(dataDir, "symbol_master.jsonl"),
    hourly60mJsonl: path.join(dataDir, "hourly60m.jsonl"),
    newsJsonl: path.join(dataDir, "optional_empty.jsonl"),
  },
})

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plus-lite-seeded-pack-"))
  const dataDir = path.join(tempRoot, "data")
  const outDir = path.join(tempRoot, "out")
  const seedInputPath = path.join(tempRoot, "stepa_events.jsonl")
  const prevServerRoot = process.env.STOCKDESK_SERVER_REPO_ROOT
  process.env.STOCKDESK_SERVER_REPO_ROOT = tempRoot
  await fs.mkdir(dataDir, { recursive: true })

  const candles = []
  const universe = []
  for (let index = 1; index <= 10; index += 1) {
    const dateKey = makeDate(index)
    const open = 100 + index
    const close = open + (index % 3 === 0 ? 1.5 : 0.7)
    candles.push({
      symbol: "000001",
      dateKey,
      open,
      high: close + 1.1,
      low: open - 0.5,
      close,
      volume: 1000000 - index * 2000,
    })
    universe.push({
      symbol: "000001",
      dateKey,
      marketCapKrw: 100000000000,
      avgTradingValue20d: 1000000000,
    })
  }

  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), [
    { symbol: "000001", name: "Alpha" },
  ])
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])
  await writeJsonl(path.join(dataDir, "optional_empty.jsonl"), [])
  await writeJsonl(seedInputPath, [
    {
      symbol: "000001",
      dateKey: makeDate(5),
      asOfDateKey: makeDate(4),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 0,
    },
    {
      symbol: "000001",
      dateKey: makeDate(6),
      asOfDateKey: makeDate(5),
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 1,
    },
    {
      symbol: "000001",
      dateKey: makeDate(7),
      asOfDateKey: makeDate(6),
      stepALaneId: "recent_impulse_2d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 2,
    },
    {
      symbol: "000001",
      dateKey: makeDate(8),
      asOfDateKey: makeDate(7),
      stepALaneId: "recent_impulse_3d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 3,
    },
  ])

  try {
    const result = await buildPerfectPrototypeDailyPack({
      cwd: tempRoot,
      config: buildConfig(dataDir),
      outDir,
      options: {
        startDate: makeDate(5),
        endDate: makeDate(8),
        surfaceName: "v3_contextual_plus_lite",
        sourceType: "perfect_prototype_stepb_open_eval_pack",
        lineId: "stepb_dplus1_plus_lite",
        seedInputPath,
        discoveryUniverseId: "recent_impulse_upto_2d",
        requestedLookbackTradingDays: 2,
        enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      },
    })
    await writeJson(path.join(outDir, "manifest.json"), {
      outputPath: result.outputPath,
      summaryPath: result.summaryPath,
      datasetContract: result.summary?.datasetContract ?? null,
      discoveryUniverseId: result.summary?.discoveryUniverseId ?? null,
      requestedLookbackTradingDays: result.summary?.requestedLookbackTradingDays ?? null,
      enabledRecentImpulseLanes: result.summary?.enabledRecentImpulseLanes ?? null,
      allowedStepALanes: result.summary?.allowedStepALanes ?? null,
      includeSameDayHigh8: result.summary?.includeSameDayHigh8 ?? null,
      summary: result.summary,
    })
  } finally {
    if (prevServerRoot == null) {
      delete process.env.STOCKDESK_SERVER_REPO_ROOT
    } else {
      process.env.STOCKDESK_SERVER_REPO_ROOT = prevServerRoot
    }
  }

  const summary = await readJson(path.join(outDir, "summary.json"), null)
  const manifest = await readJson(path.join(outDir, "manifest.json"), null)
  const rows = await readJsonl(path.join(outDir, "daily_pack.jsonl"))
  if (rows.length !== 2) {
    throw new Error(`expected exactly 2 seeded recent-impulse rows, got ${rows.length}`)
  }
  const decisionDates = rows.map((row) => row?.decisionDateKey).sort()
  if (JSON.stringify(decisionDates) !== JSON.stringify([makeDate(6), makeDate(7)])) {
    throw new Error(`unexpected seeded recent-impulse dates: ${JSON.stringify(decisionDates)}`)
  }
  if (!rows.every((row) => row?.discoveryUniverseId === "recent_impulse_upto_2d")) {
    throw new Error("expected every row to carry recent_impulse_upto_2d discovery provenance")
  }
  if (!rows.every((row) => Number(row?.requestedLookbackTradingDays ?? 0) === 2)) {
    throw new Error("expected every row to carry requestedLookbackTradingDays=2")
  }
  if (!rows.every((row) => JSON.stringify(row?.allowedStepALanes ?? []) === JSON.stringify(["recent_impulse_1d", "recent_impulse_2d"]))) {
    throw new Error("expected every recent-only row to carry allowedStepALanes without same_day_high8")
  }
  if (!rows.every((row) => row?.includeSameDayHigh8 === false)) {
    throw new Error("expected recent-only rows to carry includeSameDayHigh8=false")
  }
  if (!rows.every((row) => ["recent_impulse_1d", "recent_impulse_2d"].includes(String(row?.stepALaneId ?? "")))) {
    throw new Error("expected seeded rows to retain their Step-A lane ids")
  }
  if (summary?.discoveryUniverseId !== "recent_impulse_upto_2d") {
    throw new Error(`expected recent_impulse_upto_2d summary universe, got ${summary?.discoveryUniverseId ?? "null"}`)
  }
  if (summary?.seedInputRows !== 4 || summary?.seedAcceptedRows !== 2) {
    throw new Error("expected summary seedInputRows=4 and seedAcceptedRows=2")
  }
  if (Number(summary?.seedDroppedCounts?.LANE_OUTSIDE_DISCOVERY_UNIVERSE ?? 0) !== 2) {
    throw new Error("expected same-day and 3d seed rows to be dropped by discovery-universe lane filter")
  }
  if (summary?.datasetContract?.discoveryUniverseId !== "recent_impulse_upto_2d") {
    throw new Error("expected summary.datasetContract.discoveryUniverseId=recent_impulse_upto_2d")
  }
  if (Number(summary?.datasetContract?.requestedLookbackTradingDays ?? 0) !== 2) {
    throw new Error("expected summary.datasetContract.requestedLookbackTradingDays=2")
  }
  if (JSON.stringify(summary?.datasetContract?.enabledRecentImpulseLanes ?? []) !== JSON.stringify(["recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected summary.datasetContract.enabledRecentImpulseLanes to preserve cumulative lane set")
  }
  if (JSON.stringify(summary?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(["recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected summary.datasetContract.allowedStepALanes to preserve recent-only lane set")
  }
  if (summary?.datasetContract?.includeSameDayHigh8 !== false) {
    throw new Error("expected summary.datasetContract.includeSameDayHigh8=false for recent-only family")
  }
  if (manifest?.datasetContract?.discoveryUniverseId !== "recent_impulse_upto_2d") {
    throw new Error("expected manifest datasetContract discovery universe provenance")
  }
  if (JSON.stringify(manifest?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(["recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected manifest datasetContract.allowedStepALanes to preserve recent-only lane set")
  }

  const exactIndexOutDir = path.join(tempRoot, "recent_seed_exact_index")
  const exactRows = [
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "seeded-positive-a",
      symbol: "000001",
      dateKey: makeDate(6),
      asOfDateKey: makeDate(5),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: true,
      categoricalTokens: ["tag:test:shared", "tag:test:exact_only"],
      discoveryUniverseId: "recent_impulse_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: ["recent_impulse_1d", "recent_impulse_2d"],
      includeSameDayHigh8: false,
      stepALaneId: "recent_impulse_1d",
    },
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "seeded-positive-b",
      symbol: "000002",
      dateKey: makeDate(7),
      asOfDateKey: makeDate(6),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: true,
      categoricalTokens: ["tag:test:shared", "tag:test:exact_only"],
      discoveryUniverseId: "recent_impulse_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: ["recent_impulse_1d", "recent_impulse_2d"],
      includeSameDayHigh8: false,
      stepALaneId: "recent_impulse_2d",
    },
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "seeded-negative-c",
      symbol: "000003",
      dateKey: makeDate(8),
      asOfDateKey: makeDate(7),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: false,
      categoricalTokens: ["tag:test:shared", "tag:test:noisy"],
      discoveryUniverseId: "recent_impulse_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: ["recent_impulse_1d", "recent_impulse_2d"],
      includeSameDayHigh8: false,
      stepALaneId: "recent_impulse_2d",
    },
  ]
  await buildPerfectPrototypeStepbExactIndex({
    cwd: process.cwd(),
    rows: exactRows,
    outDir: exactIndexOutDir,
    surfaceName: "v3_contextual_plus_lite",
    options: {
      searchMode: "exact_indexed_kernel_v1",
      surfaceName: "v3_contextual_plus_lite",
      minHitCount: 2,
      maxRuleSize: 1,
      maxSeedTokens: 16,
      maxRules: 16,
      maxSearchStates: 128,
      maxRejectedRuleSamples: 0,
    },
  })
  const loadedIndex = await loadPerfectPrototypeStepbExactIndex({ indexDir: exactIndexOutDir })
  if (loadedIndex?.manifest?.datasetContract?.discoveryUniverseId !== "recent_impulse_upto_2d") {
    throw new Error("expected exact index manifest datasetContract.discoveryUniverseId=recent_impulse_upto_2d")
  }
  if (Number(loadedIndex?.manifest?.datasetContract?.requestedLookbackTradingDays ?? 0) !== 2) {
    throw new Error("expected exact index manifest datasetContract.requestedLookbackTradingDays=2")
  }
  if (JSON.stringify(loadedIndex?.manifest?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(["recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected exact index manifest datasetContract.allowedStepALanes to preserve recent-only lane set")
  }
  if (loadedIndex?.manifest?.datasetContract?.includeSameDayHigh8 !== false) {
    throw new Error("expected exact index manifest datasetContract.includeSameDayHigh8=false")
  }
  const exactMiningResult = minePerfectPrototypesPrepared({
    snapshot: loadedIndex.snapshot,
    options: {
      searchMode: "exact_indexed_kernel_v1",
      surfaceName: "v3_contextual_plus_lite",
      minHitCount: 2,
      maxRuleSize: 1,
      maxSeedTokens: 16,
      maxRules: 16,
      maxSearchStates: 128,
      maxRejectedRuleSamples: 0,
    },
  })
  const minedRules = Array.isArray(exactMiningResult?.catalog?.rules) ? exactMiningResult.catalog.rules : []
  if (minedRules.length < 1) {
    throw new Error("expected seeded recent exact-indexed mining smoke to collect at least one rule")
  }
  if (!minedRules.some((rule) => (rule?.tokens ?? []).includes("tag:test:exact_only"))) {
    throw new Error("expected seeded recent exact-indexed mining smoke to retain exact_only rule")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
