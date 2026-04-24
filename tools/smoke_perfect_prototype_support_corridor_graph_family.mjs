#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportCorridorGraphDataset } from "../src/lib/perfect_prototype_support_corridor_graph_dataset.mjs"
import { buildPerfectPrototypeSupportCorridorMetricLearning } from "../src/lib/perfect_prototype_support_corridor_metric_learning.mjs"
import { buildPerfectPrototypeSupportCorridorGraphBuilder } from "../src/lib/perfect_prototype_support_corridor_graph_builder.mjs"
import { propagatePerfectPrototypeSupportCorridorGraph } from "../src/lib/perfect_prototype_support_graph_propagation.mjs"

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
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, bridge: 1.4, boundary: 1.3, recur: 1.2 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, bridge: 1.35, boundary: 1.25, recur: 1.15 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, bridge: 1.3, boundary: 1.2, recur: 1.1 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, bridge: 1.25, boundary: 1.15, recur: 1.05 }),
  makeRow({ rowKey: "p5", symbol: "A5", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 5, bridge: 1.2, boundary: 1.1, recur: 1.0 }),
  makeRow({ rowKey: "p6", symbol: "A6", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 6, bridge: 1.18, boundary: 1.08, recur: 0.98 }),
  makeRow({ rowKey: "p7", symbol: "A7", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 1, bridge: 1.16, boundary: 1.06, recur: 0.96 }),
  makeRow({ rowKey: "p8", symbol: "A8", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 2, bridge: 1.14, boundary: 1.04, recur: 0.94 }),
  makeRow({ rowKey: "p9", symbol: "A9", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 3, bridge: 1.12, boundary: 1.02, recur: 0.92 }),
  makeRow({ rowKey: "p10", symbol: "A10", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 4, bridge: 1.1, boundary: 1.0, recur: 0.9 }),
]

const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-12", outcomeHitTarget: false, foldId: 1, windowId: 1, bridge: -0.8, boundary: -0.9, recur: -0.7, leak: 0.7 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-12", outcomeHitTarget: false, foldId: 2, windowId: 2, bridge: -0.75, boundary: -0.85, recur: -0.65, leak: 0.7 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-03-12", outcomeHitTarget: false, foldId: 3, windowId: 3, bridge: -0.7, boundary: -0.8, recur: -0.6, leak: 0.68 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-04-12", outcomeHitTarget: false, foldId: 4, windowId: 4, bridge: -0.68, boundary: -0.78, recur: -0.58, leak: 0.68 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-05-12", outcomeHitTarget: false, foldId: 1, windowId: 5, bridge: -0.66, boundary: -0.76, recur: -0.56, leak: 0.67 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-06-12", outcomeHitTarget: false, foldId: 2, windowId: 6, bridge: -0.64, boundary: -0.74, recur: -0.54, leak: 0.67 }),
]

const supportCaseViews = [
  makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, bridge: 1.28, boundary: 1.18, recur: 1.08 }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  surfaceName: "synthetic_v40_corridor_graph",
  gateTokens,
  supportFitExcluded: true,
  gatedTrainRows: [...positives, ...negatives],
  bridgePositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  hardNegativeRows: negatives,
  supportCaseViews,
  oosRows: [],
  summary: {},
}

const dataset = buildPerfectPrototypeSupportCorridorGraphDataset({ family })
const metric = buildPerfectPrototypeSupportCorridorMetricLearning({ family: dataset })
const graph = buildPerfectPrototypeSupportCorridorGraphBuilder({ family: metric })
const propagated = propagatePerfectPrototypeSupportCorridorGraph({ family: graph })

assert.equal(dataset.ok, true)
assert.equal(metric.ok, true)
assert.equal(graph.ok, true)
assert.equal(propagated.ok, true)
assert.ok(Number(propagated.summary.graphNodeCount ?? 0) > 0)
assert.ok(
  Number(propagated.summary.supportCasePositivePotential ?? 0) >
    Number(propagated.summary.supportCaseNegativePotential ?? 0),
)

const lowSeedPositives = positives.map((row, index) => ({
  ...row,
  numericFeatureMap: {
    ...row.numericFeatureMap,
    "sig.recurBoundary.localBreadthPurityGap": index < 2 ? row.numericFeatureMap["sig.recurBoundary.localBreadthPurityGap"] : -0.2,
  },
}))
const lowSeedFamily = {
  ...family,
  gatedTrainRows: [...lowSeedPositives, ...negatives],
  bridgePositiveRows: lowSeedPositives,
}
const lowSeedDataset = buildPerfectPrototypeSupportCorridorGraphDataset({ family: lowSeedFamily })
const lowSeedMetric = buildPerfectPrototypeSupportCorridorMetricLearning({ family: lowSeedDataset })

assert.equal(lowSeedDataset.summary.graphPositiveSeedCount, 2)
assert.ok(Number(lowSeedDataset.summary.graphPositiveReferenceCount ?? 0) >= positives.length)
assert.equal(lowSeedMetric.ok, true)
assert.ok(Number(lowSeedMetric.summary.corridorMetricPositiveReferenceCount ?? 0) >= positives.length)

console.log("ok: support corridor graph family")
