import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolvePeriods } from "../src/lib/config.mjs"
import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import {
  PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE,
  runStepB,
} from "../src/pipeline/step_b_template_build.mjs"

const makeDate = (day) => `2024-01-${String(day).padStart(2, "0")}`

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-dplus1-contract-"))
  const runDir = path.join(tempRoot, "run")
  const dataDir = path.join(tempRoot, "data")
  await fs.mkdir(path.join(runDir, "step-a"), { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  const symbol = "000001"
  const candles = []
  const universe = []
  for (let index = 1; index <= 8; index += 1) {
    const dateKey = makeDate(index)
    candles.push({
      symbol,
      dateKey,
      open: 100 + index,
      high: 103 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000000 + index * 1000,
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
  await writeJsonl(path.join(runDir, "step-a", "events_high8_lite.jsonl"), [
    {
      symbol,
      dateKey: makeDate(5),
      name: "Smoke",
      jumpPct: 0.09,
      jumpPctFromPrevClose: 0.09,
      jumpPctFromOpen: 0.08,
      closeRetPct: 0.04,
      gapOpenPct: 0.01,
    },
  ])

  const config = {
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
          lineId: "stepb_dplus1_baseline",
          strategyMode: PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE,
          contextSurface: "v3_contextual",
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
  }

  await runStepB({
    config,
    runDir,
    periods: resolvePeriods(config),
  })

  const summary = await readJson(path.join(runDir, "step-b", "step_b_summary.json"), null)
  const rows = await readJsonl(path.join(runDir, "step-b", "templates_lite.jsonl"))
  if (summary?.strategyMode !== PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE) {
    throw new Error(`summary.strategyMode mismatch: ${summary?.strategyMode ?? "null"}`)
  }
  if (summary?.contextSurface !== "v3_contextual") {
    throw new Error(`summary.contextSurface mismatch: ${summary?.contextSurface ?? "null"}`)
  }
  if (summary?.perfectPrototypeBaselineContract?.splitPolicy !== "decision_date_only") {
    throw new Error("baseline splitPolicy missing from step_b_summary.json")
  }
  if (summary?.entryRule !== "NEXT_DAY_OPEN") {
    throw new Error(`summary.entryRule mismatch: ${summary?.entryRule ?? "null"}`)
  }
  if (Number(summary?.holdDays) !== 3) {
    throw new Error(`summary.holdDays mismatch: ${summary?.holdDays ?? "null"}`)
  }
  if (Number(summary?.targetPct) !== 0.08) {
    throw new Error(`summary.targetPct mismatch: ${summary?.targetPct ?? "null"}`)
  }
  if (Number(summary?.stopLossPct) !== 0.04) {
    throw new Error(`summary.stopLossPct mismatch: ${summary?.stopLossPct ?? "null"}`)
  }
  if (summary?.featureAsOf !== "t-1") {
    throw new Error(`summary.featureAsOf mismatch: ${summary?.featureAsOf ?? "null"}`)
  }
  if (summary?.exactCollectionMode !== "train_precision_1_only") {
    throw new Error(`summary.exactCollectionMode mismatch: ${summary?.exactCollectionMode ?? "null"}`)
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`expected exactly one lite template row, got ${rows.length}`)
  }
  const row = rows[0]
  if (row?.strategyMode !== PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE) {
    throw new Error(`row.strategyMode mismatch: ${row?.strategyMode ?? "null"}`)
  }
  if (row?.contextSurface !== "v3_contextual") {
    throw new Error(`row.contextSurface mismatch: ${row?.contextSurface ?? "null"}`)
  }
  if (row?.baselineLineId !== "stepb_dplus1_baseline") {
    throw new Error(`row.baselineLineId mismatch: ${row?.baselineLineId ?? "null"}`)
  }
  if (row?.entryRule !== "NEXT_DAY_OPEN") {
    throw new Error(`row.entryRule mismatch: ${row?.entryRule ?? "null"}`)
  }
  if (Number(row?.holdDays) !== 3) {
    throw new Error(`row.holdDays mismatch: ${row?.holdDays ?? "null"}`)
  }
  if (Number(row?.targetPct) !== 0.08) {
    throw new Error(`row.targetPct mismatch: ${row?.targetPct ?? "null"}`)
  }
  if (Number(row?.stopLossPct) !== 0.04) {
    throw new Error(`row.stopLossPct mismatch: ${row?.stopLossPct ?? "null"}`)
  }
  if (row?.featureAsOf !== "t-1") {
    throw new Error(`row.featureAsOf mismatch: ${row?.featureAsOf ?? "null"}`)
  }
  if (row?.exactCollectionMode !== "train_precision_1_only") {
    throw new Error(`row.exactCollectionMode mismatch: ${row?.exactCollectionMode ?? "null"}`)
  }

  const invalidRunDir = path.join(tempRoot, "invalid-run")
  await fs.mkdir(path.join(invalidRunDir, "step-a"), { recursive: true })
  await fs.copyFile(
    path.join(runDir, "step-a", "events_high8_lite.jsonl"),
    path.join(invalidRunDir, "step-a", "events_high8_lite.jsonl"),
  )
  let invalidFeatureAsOfFailed = false
  try {
    await runStepB({
      config: {
        ...config,
        lightweight: {
          ...config.lightweight,
          stepB: {
            ...config.lightweight.stepB,
            perfectPrototypeBaseline: {
              ...config.lightweight.stepB.perfectPrototypeBaseline,
              featureAsOf: "t-2",
            },
          },
        },
      },
      runDir: invalidRunDir,
      periods: resolvePeriods(config),
    })
  } catch (error) {
    invalidFeatureAsOfFailed = /featureAsOf=t-1/i.test(String(error?.message ?? error))
  }
  if (!invalidFeatureAsOfFailed) {
    throw new Error("expected invalid baseline featureAsOf to fail fast")
  }

  const missingExactCollectionRunDir = path.join(tempRoot, "missing-exact-collection-run")
  await fs.mkdir(path.join(missingExactCollectionRunDir, "step-a"), { recursive: true })
  await fs.copyFile(
    path.join(runDir, "step-a", "events_high8_lite.jsonl"),
    path.join(missingExactCollectionRunDir, "step-a", "events_high8_lite.jsonl"),
  )
  let missingExactCollectionFailed = false
  try {
    const brokenBaseline = {
      ...config.lightweight.stepB.perfectPrototypeBaseline,
    }
    delete brokenBaseline.exactCollectionMode
    await runStepB({
      config: {
        ...config,
        lightweight: {
          ...config.lightweight,
          stepB: {
            ...config.lightweight.stepB,
            perfectPrototypeBaseline: brokenBaseline,
          },
        },
      },
      runDir: missingExactCollectionRunDir,
      periods: resolvePeriods(config),
    })
  } catch (error) {
    missingExactCollectionFailed = /missing required field\(s\): .*exactCollectionMode/i.test(
      String(error?.message ?? error),
    )
  }
  if (!missingExactCollectionFailed) {
    throw new Error("expected missing baseline exactCollectionMode to fail fast")
  }

  const invalidStrategyModeRunDir = path.join(tempRoot, "invalid-strategy-mode-run")
  await fs.mkdir(path.join(invalidStrategyModeRunDir, "step-a"), { recursive: true })
  await fs.copyFile(
    path.join(runDir, "step-a", "events_high8_lite.jsonl"),
    path.join(invalidStrategyModeRunDir, "step-a", "events_high8_lite.jsonl"),
  )
  let invalidStrategyModeFailed = false
  try {
    await runStepB({
      config: {
        ...config,
        lightweight: {
          ...config.lightweight,
          stepB: {
            ...config.lightweight.stepB,
            perfectPrototypeBaseline: {
              ...config.lightweight.stepB.perfectPrototypeBaseline,
              strategyMode: "BROKEN_STEPB_MODE",
            },
          },
        },
      },
      runDir: invalidStrategyModeRunDir,
      periods: resolvePeriods(config),
    })
  } catch (error) {
    invalidStrategyModeFailed = /strategyMode=STEPB_DPLUS1_BASELINE_V1/i.test(String(error?.message ?? error))
  }
  if (!invalidStrategyModeFailed) {
    throw new Error("expected invalid baseline strategyMode to fail fast")
  }

  const invalidContractVersionRunDir = path.join(tempRoot, "invalid-contract-version-run")
  await fs.mkdir(path.join(invalidContractVersionRunDir, "step-a"), { recursive: true })
  await fs.copyFile(
    path.join(runDir, "step-a", "events_high8_lite.jsonl"),
    path.join(invalidContractVersionRunDir, "step-a", "events_high8_lite.jsonl"),
  )
  let invalidContractVersionFailed = false
  try {
    await runStepB({
      config: {
        ...config,
        lightweight: {
          ...config.lightweight,
          stepB: {
            ...config.lightweight.stepB,
            perfectPrototypeBaseline: {
              ...config.lightweight.stepB.perfectPrototypeBaseline,
              contractVersion: 1,
            },
          },
        },
      },
      runDir: invalidContractVersionRunDir,
      periods: resolvePeriods(config),
    })
  } catch (error) {
    invalidContractVersionFailed = /contractVersion>=2/i.test(String(error?.message ?? error))
  }
  if (!invalidContractVersionFailed) {
    throw new Error("expected invalid baseline contractVersion to fail fast")
  }

  const invalidBacktestParityRunDir = path.join(tempRoot, "invalid-backtest-parity-run")
  await fs.mkdir(path.join(invalidBacktestParityRunDir, "step-a"), { recursive: true })
  await fs.copyFile(
    path.join(runDir, "step-a", "events_high8_lite.jsonl"),
    path.join(invalidBacktestParityRunDir, "step-a", "events_high8_lite.jsonl"),
  )
  let invalidBacktestParityFailed = false
  try {
    await runStepB({
      config: {
        ...config,
        backtest: {
          ...config.backtest,
          holdDays: 7,
        },
      },
      runDir: invalidBacktestParityRunDir,
      periods: resolvePeriods(config),
    })
  } catch (error) {
    invalidBacktestParityFailed = /backtest\.holdDays=3/i.test(String(error?.message ?? error))
  }
  if (!invalidBacktestParityFailed) {
    throw new Error("expected mismatched top-level backtest semantics to fail fast")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
