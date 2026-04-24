#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeFeatureBankContract } from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { resolvePerfectPrototype1dRegimeCellSpec } from "../src/lib/perfect_prototype_1d_regime_cell_contract.mjs"
import { buildPerfectPrototype1dRegimeCellDataset } from "../src/lib/perfect_prototype_1d_regime_cell_dataset.mjs"
import { buildPerfectPrototype1dRegimePositiveBank } from "../src/lib/perfect_prototype_1d_regime_positive_bank.mjs"
import { buildPerfectPrototype1dRegimeFailureBank } from "../src/lib/perfect_prototype_1d_regime_failure_bank.mjs"
import { buildPerfectPrototype1dRegimeVetoBank } from "../src/lib/perfect_prototype_1d_regime_veto_bank.mjs"
import { buildPerfectPrototype1dRegimeOosReport } from "../src/lib/perfect_prototype_1d_regime_oos_report.mjs"

const buildRow = ({
  rowKey,
  dateKey,
  monthKey,
  foldId,
  windowId,
  hit,
  extraTokens = [],
  bodyPct = 0.4,
  rangePct = 0.8,
  valueRatio20 = 1.8,
  closeNearHigh20 = 0.9,
  breakoutPauseScore = 0.6,
  failedBreakoutCount20 = 0,
  closeOverMa20 = 0.2,
  closeOverMa120 = 0.1,
  runUp10 = 0.25,
  liquidityStress = 0.1,
  globalValueRatio20Over150 = 1.5,
  avgTradingValue20dKrw = 5_000_000_000,
} = {}) => {
  const contextualTokens = [
    "tag:test:fixture",
    "tag:stepa.lane:same_day_high8",
    "tag:xsec.closeRank:TOP",
    ...extraTokens,
  ]
  return {
    rowKey,
    sourceId: rowKey,
    symbol: `SYM_${rowKey}`,
    dateKey,
    monthKey,
    foldId,
    windowId,
    outcomeHitTarget: hit,
    contextualTokens,
    featureVec: {
      "candle.bodyPct": bodyPct,
      "candle.rangePct": rangePct,
      "volume.valueRatio20": valueRatio20,
      "level.closeNearHigh20": closeNearHigh20,
      "shape.breakoutPauseScore": breakoutPauseScore,
      "shape.failedBreakoutCount20": failedBreakoutCount20,
      "trend.closeOverMa20": closeOverMa20,
      "trend.closeOverMa120": closeOverMa120,
      "trend.runUp10": runUp10,
      "volume.liquidityStress": liquidityStress,
      "volume.avgTradingValue20dKrw": avgTradingValue20dKrw,
    },
    globalFeatureVec: {
      "global.valueRatio20Over150": globalValueRatio20Over150,
    },
  }
}

const trainPositiveRows = [
  buildRow({ rowKey: "p1", dateKey: "2023-01-03", monthKey: "2023-01", foldId: 1, windowId: 1, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p2", dateKey: "2023-02-03", monthKey: "2023-02", foldId: 1, windowId: 2, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p3", dateKey: "2023-03-03", monthKey: "2023-03", foldId: 1, windowId: 3, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p4", dateKey: "2023-04-03", monthKey: "2023-04", foldId: 2, windowId: 4, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p5", dateKey: "2023-05-03", monthKey: "2023-05", foldId: 2, windowId: 5, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p6", dateKey: "2023-06-03", monthKey: "2023-06", foldId: 2, windowId: 6, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p7", dateKey: "2023-07-03", monthKey: "2023-07", foldId: 3, windowId: 7, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p8", dateKey: "2023-08-03", monthKey: "2023-08", foldId: 3, windowId: 8, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p9", dateKey: "2023-09-03", monthKey: "2023-09", foldId: 4, windowId: 9, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "p10", dateKey: "2023-10-03", monthKey: "2023-10", foldId: 4, windowId: 10, hit: true, extraTokens: ["tag:pattern:keep"] }),
]
const trainNegativeRows = [
  buildRow({ rowKey: "n1", dateKey: "2023-01-04", monthKey: "2023-01", foldId: 1, windowId: 1, hit: false, extraTokens: ["tag:pattern:bad"], liquidityStress: 0.8 }),
  buildRow({ rowKey: "n2", dateKey: "2023-02-04", monthKey: "2023-02", foldId: 2, windowId: 2, hit: false, extraTokens: ["tag:pattern:bad"], liquidityStress: 0.85 }),
  buildRow({ rowKey: "n3", dateKey: "2023-03-04", monthKey: "2023-03", foldId: 3, windowId: 3, hit: false, extraTokens: ["tag:pattern:bad"], liquidityStress: 0.9 }),
]
const oosRows = [
  buildRow({ rowKey: "o1", dateKey: "2025-01-03", monthKey: "2025-01", foldId: 1, windowId: 11, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "o2", dateKey: "2025-02-03", monthKey: "2025-02", foldId: 2, windowId: 12, hit: true, extraTokens: ["tag:pattern:keep"] }),
  buildRow({ rowKey: "o3", dateKey: "2025-03-03", monthKey: "2025-03", foldId: 3, windowId: 13, hit: false, extraTokens: ["tag:pattern:keep", "tag:pattern:bad"], liquidityStress: 0.88 }),
]

const bankContract = buildPerfectPrototypeFeatureBankContract({
  bankId: "smoke_v59a",
})
const sidecarStore = buildPerfectPrototypeFeatureBankSidecarStore({
  family: {
    trainRows: [...trainPositiveRows, ...trainNegativeRows],
    gatedTrainRows: [...trainPositiveRows, ...trainNegativeRows],
    oosRows,
  },
  bankContract,
})
const cellSpec = resolvePerfectPrototype1dRegimeCellSpec("TOP_1D")
const dataset = buildPerfectPrototype1dRegimeCellDataset({
  cellSpec,
  trainRows: trainPositiveRows,
  trainControlRows: trainNegativeRows,
  oosRows,
  oosControlRows: [],
  sidecarStore,
})
const positiveBank = buildPerfectPrototype1dRegimePositiveBank({
  cellDataset: dataset,
  minTrainDates: 10,
  minTrainMonths: 6,
  minTrainFolds: 4,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 1,
})
const failureBank = buildPerfectPrototype1dRegimeFailureBank({
  cellDataset: dataset,
})
const vetoBank = buildPerfectPrototype1dRegimeVetoBank({
  cellDataset: dataset,
})
const oosReport = buildPerfectPrototype1dRegimeOosReport({
  cellDataset: dataset,
  positiveBank,
  failureBank,
  vetoBank,
})

assert.equal(dataset.ok, true)
assert.equal(positiveBank.ok, true)
assert.equal(failureBank.ok, true)
assert.equal(oosReport.positiveOnly.selectedRows, 3)
assert.equal(oosReport.positivePlusFailure.selectedRows, 2)
assert.ok(oosReport.failureDelta.precisionLift > 0)
