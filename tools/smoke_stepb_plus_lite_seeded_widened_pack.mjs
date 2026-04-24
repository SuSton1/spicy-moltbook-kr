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

const makeDate = (day) => `2024-05-${String(day).padStart(2, "0")}`

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
    warmup: { from: makeDate(1), to: makeDate(4) },
    discovery: { from: makeDate(6), to: makeDate(14) },
    online: { from: makeDate(15), to: makeDate(15) },
    lockbox: { from: makeDate(16), to: makeDate(16) },
  },
  dataPaths: {
    candleDailyJsonl: path.join(dataDir, "candles.jsonl"),
    universeJsonl: path.join(dataDir, "universe.jsonl"),
    symbolMasterJsonl: path.join(dataDir, "symbol_master.jsonl"),
    hourly60mJsonl: path.join(dataDir, "hourly60m.jsonl"),
    newsJsonl: path.join(dataDir, "optional_empty.jsonl"),
  },
})

const EXPECTED_ALLOWED_STEPA_LANES = ["recent_impulse_1d", "recent_impulse_2d", "same_day_high8"]

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plus-lite-widened-pack-"))
  const dataDir = path.join(tempRoot, "data")
  const outDir = path.join(tempRoot, "out")
  const seedInputPath = path.join(tempRoot, "stepa_events.jsonl")
  const prevServerRoot = process.env.STOCKDESK_SERVER_REPO_ROOT
  process.env.STOCKDESK_SERVER_REPO_ROOT = tempRoot
  await fs.mkdir(dataDir, { recursive: true })

  const candles = []
  const universe = []
  for (let index = 1; index <= 16; index += 1) {
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
      dateKey: makeDate(11),
      asOfDateKey: makeDate(10),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(11),
      impulseLookbackDays: 0,
    },
    {
      symbol: "000001",
      dateKey: makeDate(12),
      asOfDateKey: makeDate(11),
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(11),
      impulseLookbackDays: 1,
    },
    {
      symbol: "000001",
      dateKey: makeDate(13),
      asOfDateKey: makeDate(12),
      stepALaneId: "recent_impulse_2d",
      impulseSourceDateKey: makeDate(11),
      impulseLookbackDays: 2,
    },
    {
      symbol: "000001",
      dateKey: makeDate(14),
      asOfDateKey: makeDate(13),
      stepALaneId: "recent_impulse_3d",
      impulseSourceDateKey: makeDate(11),
      impulseLookbackDays: 3,
    },
  ])

  try {
    const result = await buildPerfectPrototypeDailyPack({
      cwd: tempRoot,
      config: buildConfig(dataDir),
      outDir,
      options: {
        startDate: makeDate(6),
        endDate: makeDate(14),
        surfaceName: "v3_contextual_plus_lite",
        sourceType: "perfect_prototype_stepb_open_eval_pack",
        lineId: "stepb_dplus1_plus_lite",
        seedInputPath,
        discoveryUniverseId: "same_day_plus_recent_upto_2d",
        requestedLookbackTradingDays: 2,
        enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
        allowedStepALanes: ["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"],
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
  if (rows.length !== 6) {
    throw new Error(`expected exactly 6 widened seeded rows including synthetic negatives, got ${rows.length}`)
  }
  const positiveRows = rows.filter((row) => row?.templateKind === "POSITIVE")
  const negativeRows = rows.filter((row) => row?.templateKind === "NEGATIVE")
  if (positiveRows.length !== 3 || negativeRows.length !== 3) {
    throw new Error(`expected 3 positive and 3 synthetic negative widened rows, got ${positiveRows.length} / ${negativeRows.length}`)
  }
  const positiveDecisionDates = positiveRows.map((row) => row?.decisionDateKey).sort()
  if (JSON.stringify(positiveDecisionDates) !== JSON.stringify([makeDate(11), makeDate(12), makeDate(13)])) {
    throw new Error(`unexpected widened positive decision dates: ${JSON.stringify(positiveDecisionDates)}`)
  }
  const negativeDecisionDates = negativeRows.map((row) => row?.decisionDateKey).sort()
  if (JSON.stringify(negativeDecisionDates) !== JSON.stringify([makeDate(6), makeDate(7), makeDate(8)])) {
    throw new Error(`unexpected widened synthetic negative dates: ${JSON.stringify(negativeDecisionDates)}`)
  }
  if (!rows.every((row) => row?.discoveryUniverseId === "same_day_plus_recent_upto_2d")) {
    throw new Error("expected every widened row to carry same_day_plus_recent_upto_2d discovery provenance")
  }
  if (!rows.every((row) => Number(row?.requestedLookbackTradingDays ?? 0) === 2)) {
    throw new Error("expected every widened row to carry requestedLookbackTradingDays=2")
  }
  if (!rows.every((row) => JSON.stringify(row?.allowedStepALanes ?? []) === JSON.stringify(EXPECTED_ALLOWED_STEPA_LANES))) {
    throw new Error("expected widened rows to carry same_day_high8 + recent cumulative allowedStepALanes")
  }
  if (!rows.every((row) => row?.includeSameDayHigh8 === true)) {
    throw new Error("expected widened rows to carry includeSameDayHigh8=true")
  }
  if (!positiveRows.every((row) => ["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"].includes(String(row?.stepALaneId ?? "")))) {
    throw new Error("expected widened positive rows to retain same-day and recent Step-A lane ids")
  }
  if (!negativeRows.every((row) => row?.label === 0 && row?.templateKind === "NEGATIVE")) {
    throw new Error("expected widened synthetic negatives to carry label=0 and templateKind=NEGATIVE")
  }
  if (summary?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error(`expected same_day_plus_recent_upto_2d summary universe, got ${summary?.discoveryUniverseId ?? "null"}`)
  }
  if (summary?.seedInputRows !== 4 || summary?.seedAcceptedRows !== 3) {
    throw new Error("expected widened summary seedInputRows=4 and seedAcceptedRows=3")
  }
  if (summary?.positiveSeedRowsWritten !== 3 || summary?.syntheticNegativeRows !== 3 || summary?.rowsWritten !== 6) {
    throw new Error("expected widened summary to preserve 3 seed rows plus 3 synthetic negatives")
  }
  if (summary?.templateKindCounts?.POSITIVE !== 3 || summary?.templateKindCounts?.NEGATIVE !== 3) {
    throw new Error("expected widened summary.templateKindCounts to preserve positive/negative split")
  }
  if (Number(summary?.seedDroppedCounts?.LANE_OUTSIDE_DISCOVERY_UNIVERSE ?? 0) !== 1) {
    throw new Error("expected only the 3d seed row to be dropped by widened discovery-universe lane filter")
  }
  if (JSON.stringify(summary?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(EXPECTED_ALLOWED_STEPA_LANES)) {
    throw new Error("expected widened summary.datasetContract.allowedStepALanes to preserve same-day plus recent lane set")
  }
  if (summary?.datasetContract?.includeSameDayHigh8 !== true) {
    throw new Error("expected widened summary.datasetContract.includeSameDayHigh8=true")
  }
  if (manifest?.datasetContract?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error("expected widened manifest datasetContract discovery universe provenance")
  }
  if (JSON.stringify(manifest?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(EXPECTED_ALLOWED_STEPA_LANES)) {
    throw new Error("expected widened manifest datasetContract.allowedStepALanes to preserve same-day plus recent lane set")
  }

  const exactIndexOutDir = path.join(tempRoot, "widened_exact_index")
  const exactRows = [
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "widened-positive-a",
      symbol: "000001",
      dateKey: makeDate(5),
      asOfDateKey: makeDate(4),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: true,
      categoricalTokens: ["tag:test:shared", "tag:test:widened_only"],
      discoveryUniverseId: "same_day_plus_recent_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: EXPECTED_ALLOWED_STEPA_LANES,
      includeSameDayHigh8: true,
      stepALaneId: "same_day_high8",
    },
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "widened-positive-b",
      symbol: "000002",
      dateKey: makeDate(6),
      asOfDateKey: makeDate(5),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: true,
      categoricalTokens: ["tag:test:shared", "tag:test:widened_only"],
      discoveryUniverseId: "same_day_plus_recent_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: EXPECTED_ALLOWED_STEPA_LANES,
      includeSameDayHigh8: true,
      stepALaneId: "recent_impulse_1d",
    },
    {
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      sourceId: "widened-negative-c",
      symbol: "000003",
      dateKey: makeDate(7),
      asOfDateKey: makeDate(6),
      strategyMode: "STEPB_DPLUS1_BASELINE_V1",
      outcomeHitTarget: false,
      categoricalTokens: ["tag:test:shared", "tag:test:noisy"],
      discoveryUniverseId: "same_day_plus_recent_upto_2d",
      requestedLookbackTradingDays: 2,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
      allowedStepALanes: EXPECTED_ALLOWED_STEPA_LANES,
      includeSameDayHigh8: true,
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
  if (loadedIndex?.manifest?.datasetContract?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error("expected widened exact index manifest datasetContract.discoveryUniverseId=same_day_plus_recent_upto_2d")
  }
  if (JSON.stringify(loadedIndex?.manifest?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify(EXPECTED_ALLOWED_STEPA_LANES)) {
    throw new Error("expected widened exact index manifest datasetContract.allowedStepALanes to preserve widened lane set")
  }
  if (loadedIndex?.manifest?.datasetContract?.includeSameDayHigh8 !== true) {
    throw new Error("expected widened exact index manifest datasetContract.includeSameDayHigh8=true")
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
    throw new Error("expected widened exact-indexed mining smoke to collect at least one rule")
  }
  if (!minedRules.some((rule) => (rule?.tokens ?? []).includes("tag:test:widened_only"))) {
    throw new Error("expected widened exact-indexed mining smoke to retain widened_only rule")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
