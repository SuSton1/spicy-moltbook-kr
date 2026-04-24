import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildPerfectPrototypeDailyPack } from "../src/lib/perfect_prototype_daily_pack.mjs"
import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"

const makeDate = (day) => `2024-02-${String(day).padStart(2, "0")}`

const PLUS_LITE_KEYS = [
  "pattern.insideBarCount3",
  "pattern.nr4",
  "pattern.nr7",
  "pattern.closeClusterTightness3",
  "pattern.closeClusterTightness5",
  "shape.sidewaysScore3",
  "shape.sidewaysScore5",
  "shape.sidewaysScore10",
  "volume.lowVolumeCount3",
  "volume.lowVolumeCount5",
  "volume.volumeVsRecentPeak",
  "level.closeNearHigh20",
  "level.closeNearHigh60",
  "level.touchRecentHighCount10",
  "level.rejectionFromRecentHighCount10",
]

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
      lookbackTradingDays: 3,
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plus-lite-open-pack-"))
  const dataDir = path.join(tempRoot, "data")
  const outDir = path.join(tempRoot, "out")
  const prevServerRoot = process.env.STOCKDESK_SERVER_REPO_ROOT
  process.env.STOCKDESK_SERVER_REPO_ROOT = tempRoot
  await fs.mkdir(dataDir, { recursive: true })

  const candles = []
  const universe = []
  for (const symbol of ["000001", "000002"]) {
    for (let index = 1; index <= 10; index += 1) {
      const dateKey = makeDate(index)
      const base = symbol === "000001" ? 100 : 140
      const open = base + index * 0.9
      const close = open + (index % 4 === 0 ? 1.8 : 0.6)
      candles.push({
        symbol,
        dateKey,
        open,
        high: close + 1.2,
        low: open - 0.8,
        close,
        volume: 1000000 - index * 5000,
      })
      universe.push({
        symbol,
        dateKey,
        marketCapKrw: 100000000000,
        avgTradingValue20dKrw: 1000000000,
        sharesOutstanding: 1000000,
      })
    }
  }

  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), [
    { symbol: "000001", name: "Alpha" },
    { symbol: "000002", name: "Beta" },
  ])
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])
  await writeJsonl(path.join(dataDir, "optional_empty.jsonl"), [])

  const config = buildConfig(dataDir)
  try {
    await buildPerfectPrototypeDailyPack({
      cwd: tempRoot,
      config,
      outDir,
      options: {
        startDate: makeDate(5),
        endDate: makeDate(8),
        surfaceName: "v3_contextual_plus_lite",
        sourceType: "perfect_prototype_stepb_open_eval_pack",
        lineId: "stepb_dplus1_plus_lite",
      },
    })
  } finally {
    if (prevServerRoot == null) {
      delete process.env.STOCKDESK_SERVER_REPO_ROOT
    } else {
      process.env.STOCKDESK_SERVER_REPO_ROOT = prevServerRoot
    }
  }

  const summary = await readJson(path.join(outDir, "summary.json"), null)
  const rows = await readJsonl(path.join(outDir, "daily_pack.jsonl"))
  if (summary?.surface !== "v3_contextual_plus_lite") {
    throw new Error(`expected plus-lite surface in summary, got ${summary?.surface ?? "null"}`)
  }
  if (summary?.sourceType !== "perfect_prototype_stepb_open_eval_pack") {
    throw new Error(`expected open-eval sourceType in summary, got ${summary?.sourceType ?? "null"}`)
  }
  if (summary?.baselineLineId !== "stepb_dplus1_plus_lite") {
    throw new Error(`expected plus-lite line id in summary, got ${summary?.baselineLineId ?? "null"}`)
  }
  if (summary?.discoveryUniverseId !== "afree_open") {
    throw new Error(`expected afree_open discovery universe in summary, got ${summary?.discoveryUniverseId ?? "null"}`)
  }
  if (Number(summary?.requestedLookbackTradingDays ?? 0) !== 3) {
    throw new Error(
      `expected requestedLookbackTradingDays=3 in summary, got ${summary?.requestedLookbackTradingDays ?? "null"}`,
    )
  }
  if (!summary?.datasetContract || summary.datasetContract?.discoveryUniverseId !== "afree_open") {
    throw new Error("expected summary.datasetContract.discoveryUniverseId=afree_open")
  }
  if (JSON.stringify(summary?.datasetContract?.allowedStepALanes ?? []) !== JSON.stringify([])) {
    throw new Error("expected afree_open datasetContract.allowedStepALanes=[]")
  }
  if (summary?.datasetContract?.includeSameDayHigh8 !== false) {
    throw new Error("expected afree_open datasetContract.includeSameDayHigh8=false")
  }
  if (rows.length < 1) {
    throw new Error("expected non-empty daily pack rows")
  }
  const featureKeys = Object.keys(rows[0]?.featureVec ?? {})
  for (const key of PLUS_LITE_KEYS) {
    if (!featureKeys.includes(key)) {
      throw new Error(`missing plus-lite feature key ${key}`)
    }
  }
  if (!rows.every((row) => row?.decisionDateKey && row?.asOfDateKey && row?.sourceType === "perfect_prototype_stepb_open_eval_pack")) {
    throw new Error("open-eval rows are missing decisionDateKey/asOfDateKey/sourceType")
  }
  if (!rows.every((row) => row?.discoveryUniverseId === "afree_open" && Number(row?.requestedLookbackTradingDays ?? 0) === 3)) {
    throw new Error("open-eval rows are missing afree_open discovery provenance")
  }
  if (!rows.every((row) => Array.isArray(row?.allowedStepALanes) && row.allowedStepALanes.length === 0)) {
    throw new Error("expected afree_open rows to carry allowedStepALanes=[]")
  }
  if (!rows.every((row) => row?.includeSameDayHigh8 === false)) {
    throw new Error("expected afree_open rows to carry includeSameDayHigh8=false")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
