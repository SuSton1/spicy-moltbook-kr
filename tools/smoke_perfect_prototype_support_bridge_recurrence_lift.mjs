#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { liftPerfectPrototypeSupportBridgeRecurrence } from "../src/lib/perfect_prototype_support_bridge_recurrence_lift.mjs"

const makeRow = ({
  sourceId,
  dateKey,
  foldId,
  windowId,
  outcomeHitTarget = true,
  posDistance,
  margin,
  purity,
  posShare,
  negShare,
  cellMargin = 0.6,
  cellGap = 0.4,
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol: sourceId.toUpperCase(),
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget,
  numericFeatureMap: {
    "sig.support.posDistance": posDistance,
    "sig.support.margin": margin,
    "sig.bridge.bestPositiveCellMargin": cellMargin,
    "sig.bridge.cellWinnerGap": cellGap,
    "sig.bridge.localPurityScore": purity,
    "sig.bridge.posNegMargin": margin,
    "sig.bridge.knnPositiveShare": posShare,
    "sig.bridge.knnNegativeShare": negShare,
  },
})

const seedRows = [
  makeRow({ sourceId: "p1", dateKey: "2026-01-03", foldId: 1, windowId: 1, posDistance: 0.12, margin: 1.2, purity: 0.6, posShare: 0.9, negShare: 0.1 }),
  makeRow({ sourceId: "p2", dateKey: "2026-02-03", foldId: 2, windowId: 2, posDistance: 0.14, margin: 1.15, purity: 0.58, posShare: 0.88, negShare: 0.12 }),
  makeRow({ sourceId: "p3", dateKey: "2026-03-03", foldId: 3, windowId: 3, posDistance: 0.15, margin: 1.12, purity: 0.56, posShare: 0.87, negShare: 0.13 }),
  makeRow({ sourceId: "p4", dateKey: "2026-04-03", foldId: 4, windowId: 4, posDistance: 0.17, margin: 1.1, purity: 0.55, posShare: 0.86, negShare: 0.14 }),
]

const companionRows = [
  makeRow({ sourceId: "p5", dateKey: "2026-05-03", foldId: 1, windowId: 5, posDistance: 0.16, margin: 1.08, purity: 0.54, posShare: 0.85, negShare: 0.15 }),
  makeRow({ sourceId: "p6", dateKey: "2026-06-03", foldId: 2, windowId: 6, posDistance: 0.18, margin: 1.05, purity: 0.53, posShare: 0.84, negShare: 0.16 }),
  makeRow({ sourceId: "p7", dateKey: "2026-07-03", foldId: 3, windowId: 7, posDistance: 0.19, margin: 1.03, purity: 0.52, posShare: 0.83, negShare: 0.17 }),
  makeRow({ sourceId: "p8", dateKey: "2026-08-03", foldId: 4, windowId: 8, posDistance: 0.2, margin: 1.01, purity: 0.51, posShare: 0.82, negShare: 0.18 }),
]

const negatives = [
  makeRow({ sourceId: "n1", dateKey: "2026-01-10", foldId: 1, windowId: 1, outcomeHitTarget: false, posDistance: 0.38, margin: 0.12, purity: -0.2, posShare: 0.35, negShare: 0.65 }),
  makeRow({ sourceId: "n2", dateKey: "2026-02-10", foldId: 2, windowId: 2, outcomeHitTarget: false, posDistance: 0.4, margin: 0.1, purity: -0.22, posShare: 0.34, negShare: 0.66 }),
  makeRow({ sourceId: "n3", dateKey: "2026-03-10", foldId: 3, windowId: 3, outcomeHitTarget: false, posDistance: 0.42, margin: 0.08, purity: -0.24, posShare: 0.33, negShare: 0.67 }),
  makeRow({ sourceId: "n4", dateKey: "2026-04-10", foldId: 4, windowId: 4, outcomeHitTarget: false, posDistance: 0.44, margin: 0.06, purity: -0.25, posShare: 0.32, negShare: 0.68 }),
]

const supportCaseViews = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    numericFeatureMap: {
      "sig.support.posDistance": 0.13,
      "sig.support.margin": 1.19,
    },
  },
]

const cohort = {
  bridgePositiveRows: seedRows,
  supportNearHardNegativeRows: negatives,
  gatedTrainRows: [...seedRows, ...companionRows, ...negatives],
  supportCaseViews,
  bridgePositiveCells: [
    {
      cellId: "BRIDGE_CELL_01",
      prototype: {
        "sig.support.posDistance": 0.15,
        "sig.support.margin": 1.12,
      },
    },
    {
      cellId: "BRIDGE_CELL_02",
      prototype: {
        "sig.support.posDistance": 0.75,
        "sig.support.margin": 0.55,
      },
    },
  ],
  bridgeBaseFeatureKeys: ["sig.support.posDistance", "sig.support.margin"],
  bridgeFeatureScales: {
    "sig.support.posDistance": 0.2,
    "sig.support.margin": 0.4,
  },
  summary: {},
}

const lifted = liftPerfectPrototypeSupportBridgeRecurrence({
  cohort,
  minTrainDates: 8,
  minTrainMonths: 8,
  minTrainFolds: 4,
})

assert.equal(lifted.ok, true)
assert.ok(Number(lifted.summary?.bridgeCompanionAcceptedCount ?? 0) >= 4)
assert.ok(Number(lifted.summary?.bridgeLiftedPositiveSummary?.matchedDateCount ?? 0) >= 8)
assert.ok(Number(lifted.summary?.bridgeLiftMarginalDateGain ?? 0) > 0)

console.log("ok: support bridge recurrence lift")
