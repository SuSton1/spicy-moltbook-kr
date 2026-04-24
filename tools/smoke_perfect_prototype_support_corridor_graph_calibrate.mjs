#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportCorridorGraphDataset } from "../src/lib/perfect_prototype_support_corridor_graph_dataset.mjs"
import { buildPerfectPrototypeSupportCorridorMetricLearning } from "../src/lib/perfect_prototype_support_corridor_metric_learning.mjs"
import { buildPerfectPrototypeSupportCorridorGraphBuilder } from "../src/lib/perfect_prototype_support_corridor_graph_builder.mjs"
import { propagatePerfectPrototypeSupportCorridorGraph } from "../src/lib/perfect_prototype_support_graph_propagation.mjs"
import { calibratePerfectPrototypeSupportGraph } from "../src/lib/perfect_prototype_support_graph_calibrate.mjs"

const gateTokens = ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  bridge = 1,
  boundary = 1,
  recur = 1,
  leak = 0.05,
} = {}) => ({
  rowKey,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  categoricalTokens: gateTokens.slice(),
  tokenSet: new Set(gateTokens),
  numericFeatureMap: {
    "sig.bridge.posNegMargin": bridge,
    "sig.bridge.bestPositiveCellMargin": bridge,
    "sig.bridge.localPurityScore": bridge * 0.5,
    "sig.boundary.marginMean": boundary,
    "sig.boundary.marginMin": boundary,
    "sig.boundary.supportRecoveryPotential": boundary + recur,
    "sig.boundary.falsePositivePressure": leak,
    "sig.recurBoundary.localBreadthPurityGap": recur,
    "sig.recurBoundary.localRecoveryMargin": recur,
    "sig.recurBoundary.crossfitRecoveryShare": 0.9,
    "sig.recurBoundary.crossfitLeakShare": leak,
    "sig.recurBoundary.negNeighborLeakShare": leak,
  },
})

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, bridge: 1.5, boundary: 1.35, recur: 1.25 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, bridge: 1.45, boundary: 1.3, recur: 1.2 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, bridge: 1.4, boundary: 1.25, recur: 1.15 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, bridge: 1.35, boundary: 1.2, recur: 1.1 }),
  makeRow({ rowKey: "p5", symbol: "A5", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 5, bridge: 1.3, boundary: 1.15, recur: 1.05 }),
  makeRow({ rowKey: "p6", symbol: "A6", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 6, bridge: 1.28, boundary: 1.13, recur: 1.03 }),
  makeRow({ rowKey: "p7", symbol: "A7", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 1, bridge: 1.26, boundary: 1.11, recur: 1.01 }),
  makeRow({ rowKey: "p8", symbol: "A8", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 2, bridge: 1.24, boundary: 1.09, recur: 0.99 }),
  makeRow({ rowKey: "p9", symbol: "A9", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 3, bridge: 1.22, boundary: 1.07, recur: 0.97 }),
  makeRow({ rowKey: "p10", symbol: "A10", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 4, bridge: 1.2, boundary: 1.05, recur: 0.95 }),
]

const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-12", outcomeHitTarget: false, foldId: 1, windowId: 1, bridge: -0.9, boundary: -0.95, recur: -0.8, leak: 0.85 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-12", outcomeHitTarget: false, foldId: 2, windowId: 2, bridge: -0.88, boundary: -0.93, recur: -0.78, leak: 0.84 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-03-12", outcomeHitTarget: false, foldId: 3, windowId: 3, bridge: -0.86, boundary: -0.91, recur: -0.76, leak: 0.83 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-04-12", outcomeHitTarget: false, foldId: 4, windowId: 4, bridge: -0.84, boundary: -0.89, recur: -0.74, leak: 0.82 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-05-12", outcomeHitTarget: false, foldId: 1, windowId: 5, bridge: -0.82, boundary: -0.87, recur: -0.72, leak: 0.81 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-06-12", outcomeHitTarget: false, foldId: 2, windowId: 6, bridge: -0.8, boundary: -0.85, recur: -0.7, leak: 0.8 }),
]

const oosRows = [
  makeRow({ rowKey: "o1", symbol: "O1", dateKey: "2026-11-03", outcomeHitTarget: true, foldId: 0, windowId: 0, bridge: 1.32, boundary: 1.18, recur: 1.08 }),
  makeRow({ rowKey: "o2", symbol: "O2", dateKey: "2026-11-10", outcomeHitTarget: true, foldId: 0, windowId: 0, bridge: 1.27, boundary: 1.12, recur: 1.02 }),
  makeRow({ rowKey: "o3", symbol: "O3", dateKey: "2026-11-17", outcomeHitTarget: true, foldId: 0, windowId: 0, bridge: 1.22, boundary: 1.07, recur: 0.97 }),
]

const supportCaseViews = [
  makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, bridge: 1.36, boundary: 1.22, recur: 1.12 }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  surfaceName: "synthetic_v40_corridor_graph_calibrate",
  gateTokens,
  supportFitExcluded: true,
  gatedTrainRows: [...positives, ...negatives],
  bridgePositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  hardNegativeRows: negatives,
  supportCaseViews,
  oosRows,
  summary: {},
}

const dataset = buildPerfectPrototypeSupportCorridorGraphDataset({ family })
const metric = buildPerfectPrototypeSupportCorridorMetricLearning({ family: dataset })
const graph = buildPerfectPrototypeSupportCorridorGraphBuilder({ family: metric })
const propagated = propagatePerfectPrototypeSupportCorridorGraph({ family: graph })
const solution = calibratePerfectPrototypeSupportGraph({
  family: propagated,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 3,
})

assert.equal(solution.ok, true)
assert.equal(solution.supportFitExcluded, true)
assert.equal(solution.supportLeaveOneOutRecovered, true)
assert.equal(solution.trainSummary.precision, 1)
assert.ok(Number(solution.trainSummary.trainMatchedDateCount ?? 0) >= 10)
assert.equal(solution.oosSummary.precision, 1)
assert.ok(Number(solution.oosSummary.selectedRowCount ?? 0) >= 3)

console.log("ok: support corridor graph calibrate")
