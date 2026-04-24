import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolvePeriods } from "../src/lib/config.mjs"
import { readJsonl, writeJsonl } from "../src/lib/io.mjs"
import {
  PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE,
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID,
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID,
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID,
  runStepB,
} from "../src/pipeline/step_b_template_build.mjs"

const makeDate = (day) => `2024-01-${String(day).padStart(2, "0")}`

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

const buildConfig = ({ dataDir, contextSurface, lineId }) => ({
  template: {
    localWindow: 2,
    globalWindow: 3,
    featureAsOf: "t-1",
    negativeSampling: {
      enabled: false,
    },
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
  },
  lightweight: {
    pipeline: {
      preferLiteArtifacts: true,
    },
    stepB: {
      inputMode: "lite",
      outputMode: "lite",
      runtimePack: {
        enabled: false,
      },
      perfectPrototypeBaseline: {
        enabled: true,
        contractVersion: 2,
        lineId,
        strategyMode: PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE,
        contextSurface,
        entryRule: "NEXT_DAY_OPEN",
        holdDays: 3,
        targetPct: 0.08,
        stopLossPct: 0.04,
        featureAsOf: "t-1",
        exactCollectionMode: "train_precision_1_only",
        maxGapTradingDays: 100000,
        splitPolicy: "decision_date_only",
      },
    },
  },
  dataPaths: {
    candleDailyJsonl: path.join(dataDir, "candles.jsonl"),
    universeJsonl: path.join(dataDir, "universe.jsonl"),
    symbolMasterJsonl: path.join(dataDir, "symbol_master.jsonl"),
    hourly60mJsonl: path.join(dataDir, "hourly60m.jsonl"),
    newsJsonl: path.join(dataDir, "hourly60m.jsonl"),
  },
  periods: {
    warmup: { from: makeDate(1), to: makeDate(2) },
    discovery: { from: makeDate(5), to: makeDate(5) },
    online: { from: makeDate(6), to: makeDate(6) },
    lockbox: { from: makeDate(7), to: makeDate(8) },
  },
})

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-dplus1-plus-lite-"))
  const dataDir = path.join(tempRoot, "data")
  const baselineRunDir = path.join(tempRoot, "baseline-run")
  const plusLiteRunDir = path.join(tempRoot, "plus-lite-run")
  const laneLocalRunDir = path.join(tempRoot, "lane-local-run")
  const recentOnlyRunDir = path.join(tempRoot, "recent-only-run")
  await fs.mkdir(path.join(baselineRunDir, "step-a"), { recursive: true })
  await fs.mkdir(path.join(plusLiteRunDir, "step-a"), { recursive: true })
  await fs.mkdir(path.join(laneLocalRunDir, "step-a"), { recursive: true })
  await fs.mkdir(path.join(recentOnlyRunDir, "step-a"), { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  const symbol = "000001"
  const candles = []
  const universe = []
  for (let index = 1; index <= 8; index += 1) {
    const dateKey = makeDate(index)
    const open = 100 + index * 0.8
    const close = open + (index % 3 === 0 ? 2.5 : 0.8)
    const high = close + 1.4
    const low = open - 1.1
    candles.push({
      symbol,
      dateKey,
      open,
      high,
      low,
      close,
      volume: 1000000 - index * 12000,
    })
    universe.push({
      symbol,
      dateKey,
      marketCapKrw: 100000000000,
      avgTradingValue20dKrw: 1000000000,
      sharesOutstanding: 1000000,
    })
  }

  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), [{ symbol, name: "Smoke" }])
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])
  const events = [
    {
      symbol,
      dateKey: makeDate(5),
      name: "Smoke",
      stepALaneId: "same_day_high8",
      jumpPct: 0.09,
      jumpPctFromPrevClose: 0.09,
      jumpPctFromOpen: 0.08,
      closeRetPct: 0.04,
      gapOpenPct: 0.01,
    },
  ]
  await writeJsonl(path.join(baselineRunDir, "step-a", "events_high8_lite.jsonl"), events)
  await writeJsonl(path.join(plusLiteRunDir, "step-a", "events_high8_lite.jsonl"), events)
  await writeJsonl(path.join(laneLocalRunDir, "step-a", "events_high8_lite.jsonl"), events)
  await writeJsonl(path.join(recentOnlyRunDir, "step-a", "events_high8_lite.jsonl"), [
    {
      ...events[0],
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(4),
      impulseLookbackDays: 1,
    },
  ])

  const baselineConfig = buildConfig({
    dataDir,
    contextSurface: "v3_contextual",
    lineId: "stepb_dplus1_baseline",
  })
  const plusLiteConfig = buildConfig({
    dataDir,
    contextSurface: "v3_contextual_plus_lite",
    lineId: PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID,
  })
  const laneLocalConfig = buildConfig({
    dataDir,
    contextSurface: "v5_contextual_plus_lite_lane_local_pool8",
    lineId: PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID,
  })
  const recentOnlyConfig = buildConfig({
    dataDir,
    contextSurface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
    lineId: PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID,
  })

  await runStepB({
    config: baselineConfig,
    runDir: baselineRunDir,
    periods: resolvePeriods(baselineConfig),
  })
  await runStepB({
    config: plusLiteConfig,
    runDir: plusLiteRunDir,
    periods: resolvePeriods(plusLiteConfig),
  })
  await runStepB({
    config: laneLocalConfig,
    runDir: laneLocalRunDir,
    periods: resolvePeriods(laneLocalConfig),
  })
  await runStepB({
    config: recentOnlyConfig,
    runDir: recentOnlyRunDir,
    periods: resolvePeriods(recentOnlyConfig),
  })

  const baselineRows = await readJsonl(path.join(baselineRunDir, "step-b", "templates_lite.jsonl"))
  const plusLiteRows = await readJsonl(path.join(plusLiteRunDir, "step-b", "templates_lite.jsonl"))
  const laneLocalRows = await readJsonl(path.join(laneLocalRunDir, "step-b", "templates_lite.jsonl"))
  const recentOnlyRows = await readJsonl(path.join(recentOnlyRunDir, "step-b", "templates_lite.jsonl"))
  if (baselineRows.length !== 1 || plusLiteRows.length !== 1 || laneLocalRows.length !== 1 || recentOnlyRows.length !== 1) {
    throw new Error(
      `expected one template row per run, got baseline=${baselineRows.length} plusLite=${plusLiteRows.length} laneLocal=${laneLocalRows.length} recentOnly=${recentOnlyRows.length}`,
    )
  }
  const baselineRow = baselineRows[0]
  const plusLiteRow = plusLiteRows[0]
  const laneLocalRow = laneLocalRows[0]
  const recentOnlyRow = recentOnlyRows[0]
  const baselineFeatureKeys = Object.keys(baselineRow?.featureVec ?? {}).sort()
  const plusLiteFeatureKeys = Object.keys(plusLiteRow?.featureVec ?? {}).sort()
  const laneLocalFeatureKeys = Object.keys(laneLocalRow?.featureVec ?? {}).sort()
  const recentOnlyFeatureKeys = Object.keys(recentOnlyRow?.featureVec ?? {}).sort()

  if (plusLiteFeatureKeys.length !== baselineFeatureKeys.length + PLUS_LITE_KEYS.length) {
    throw new Error(
      `expected plus-lite featureVec to grow by ${PLUS_LITE_KEYS.length}, got baseline=${baselineFeatureKeys.length} plusLite=${plusLiteFeatureKeys.length}`,
    )
  }
  for (const key of PLUS_LITE_KEYS) {
    if (baselineFeatureKeys.includes(key)) {
      throw new Error(`baseline surface should not include plus-lite key ${key}`)
    }
    if (!plusLiteFeatureKeys.includes(key)) {
      throw new Error(`plus-lite surface is missing required key ${key}`)
    }
  }
  if (String(plusLiteRow?.contextSurface ?? "") !== "v3_contextual_plus_lite") {
    throw new Error(`plus-lite row contextSurface mismatch: ${plusLiteRow?.contextSurface ?? "null"}`)
  }
  if (String(plusLiteRow?.baselineLineId ?? "") !== PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID) {
    throw new Error(`plus-lite row baselineLineId mismatch: ${plusLiteRow?.baselineLineId ?? "null"}`)
  }
  if (laneLocalFeatureKeys.length !== plusLiteFeatureKeys.length) {
    throw new Error(
      `expected lane-local featureVec to keep plus-lite width, got plusLite=${plusLiteFeatureKeys.length} laneLocal=${laneLocalFeatureKeys.length}`,
    )
  }
  if (String(laneLocalRow?.contextSurface ?? "") !== "v5_contextual_plus_lite_lane_local_pool8") {
    throw new Error(`lane-local row contextSurface mismatch: ${laneLocalRow?.contextSurface ?? "null"}`)
  }
  if (String(laneLocalRow?.baselineLineId ?? "") !== PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID) {
    throw new Error(`lane-local row baselineLineId mismatch: ${laneLocalRow?.baselineLineId ?? "null"}`)
  }
  if (Number(laneLocalRow?.xsecEventVec?.laneEventCount ?? 0) !== 1) {
    throw new Error(`lane-local row laneEventCount mismatch: ${laneLocalRow?.xsecEventVec?.laneEventCount ?? "null"}`)
  }
  if (!Array.isArray(laneLocalRow?.contextualTokens) || !laneLocalRow.contextualTokens.includes("tag:xsecLane.pool:THIN_POOL")) {
    throw new Error("expected lane-local row contextualTokens to include tag:xsecLane.pool:THIN_POOL")
  }
  if (recentOnlyFeatureKeys.length !== plusLiteFeatureKeys.length) {
    throw new Error(
      `expected recent-only featureVec to keep plus-lite width, got plusLite=${plusLiteFeatureKeys.length} recentOnly=${recentOnlyFeatureKeys.length}`,
    )
  }
  if (String(recentOnlyRow?.contextSurface ?? "") !== "v6_contextual_plus_lite_recent_only_lane_local_pool8") {
    throw new Error(`recent-only row contextSurface mismatch: ${recentOnlyRow?.contextSurface ?? "null"}`)
  }
  if (String(recentOnlyRow?.baselineLineId ?? "") !== PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID) {
    throw new Error(`recent-only row baselineLineId mismatch: ${recentOnlyRow?.baselineLineId ?? "null"}`)
  }
  if (String(recentOnlyRow?.stepALaneId ?? "") !== "recent_impulse_1d") {
    throw new Error(`recent-only row stepALaneId mismatch: ${recentOnlyRow?.stepALaneId ?? "null"}`)
  }
  if (Number(recentOnlyRow?.xsecEventVec?.laneEventCount ?? 0) !== 1) {
    throw new Error(`recent-only row laneEventCount mismatch: ${recentOnlyRow?.xsecEventVec?.laneEventCount ?? "null"}`)
  }
  if (
    !Array.isArray(recentOnlyRow?.contextualTokens) ||
    !recentOnlyRow.contextualTokens.includes("tag:xsecLane.pool:THIN_POOL")
  ) {
    throw new Error("expected recent-only row contextualTokens to include tag:xsecLane.pool:THIN_POOL")
  }

  let invalidContractFailed = false
  try {
    const invalidRunDir = path.join(tempRoot, "invalid-run")
    await fs.mkdir(path.join(invalidRunDir, "step-a"), { recursive: true })
    await writeJsonl(path.join(invalidRunDir, "step-a", "events_high8_lite.jsonl"), events)
    await runStepB({
      config: buildConfig({
        dataDir,
        contextSurface: "v3_contextual_plus_lite",
        lineId: "stepb_dplus1_baseline",
      }),
      runDir: invalidRunDir,
      periods: resolvePeriods(baselineConfig),
    })
  } catch (error) {
    invalidContractFailed = /stepb_dplus1_baseline only supports contextSurface=v3_contextual/i.test(
      String(error?.message ?? error),
    )
  }
  if (!invalidContractFailed) {
    throw new Error("expected baseline line id + plus-lite surface mismatch to fail fast")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
