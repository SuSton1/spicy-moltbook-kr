#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportCarrierGraphFamily } from "../src/lib/perfect_prototype_support_carrier_graph_family.mjs"

const gateTokens = ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  posNearestDistance,
  negNearestDistance,
  margin,
  recurrence,
  falsePositivePressure,
} = {}) => {
  const monthKey = String(dateKey).slice(0, 7)
  const knnPositiveShare = outcomeHitTarget ? 0.8 : 0.2
  const knnNegativeShare = 1 - knnPositiveShare
  const localPurityScore = knnPositiveShare - knnNegativeShare
  return {
    rowKey,
    symbol,
    dateKey,
    monthKey,
    outcomeHitTarget,
    foldId,
    windowId,
    tokenSet: new Set(gateTokens),
    categoricalTokens: gateTokens.slice(),
    numericFeatureMap: {
      "sig.bridge.posNearestDistance": posNearestDistance,
      "sig.bridge.posTop3MeanDistance": posNearestDistance + 0.02,
      "sig.bridge.negNearestDistance": negNearestDistance,
      "sig.bridge.negTop3MeanDistance": negNearestDistance + 0.03,
      "sig.bridge.posNegMargin": margin,
      "sig.bridge.posNegRatio": negNearestDistance / Math.max(0.05, posNearestDistance),
      "sig.bridge.knnPositiveShare": knnPositiveShare,
      "sig.bridge.knnNegativeShare": knnNegativeShare,
      "sig.bridge.localPurityScore": localPurityScore,
      "sig.bridge.group.support.posDistance": posNearestDistance,
      "sig.bridge.group.support.negDistance": negNearestDistance,
      "sig.bridge.group.support.margin": margin,
      "sig.bridge.group.supportMetric.posDistance": posNearestDistance * 0.9,
      "sig.bridge.group.supportMetric.negDistance": negNearestDistance * 1.05,
      "sig.bridge.group.supportMetric.margin": margin * 1.04,
      "sig.boundary.group.support.residualMargin": margin * 0.9,
      "sig.boundary.group.support.localBoundaryMargin": margin * 1.2,
      "sig.boundary.group.support.stabilityShare": recurrence,
      "sig.boundary.group.support.recurrenceCarry": recurrence,
      "sig.boundary.group.supportMetric.residualMargin": margin * 0.92,
      "sig.boundary.group.supportMetric.localBoundaryMargin": margin * 1.24,
      "sig.boundary.group.supportMetric.stabilityShare": recurrence * 0.98,
      "sig.boundary.group.supportMetric.recurrenceCarry": recurrence * 1.02,
      "sig.boundary.marginMean": margin * 0.95,
      "sig.boundary.marginMin": margin * 0.9,
      "sig.boundary.localBoundaryMean": margin * 1.22,
      "sig.boundary.positiveGroupCount": outcomeHitTarget ? 2 : 0,
      "sig.boundary.positiveGroupShare": outcomeHitTarget ? 1 : 0,
      "sig.boundary.stabilityScore": recurrence,
      "sig.boundary.recurrencePotential": recurrence + Math.max(0, margin),
      "sig.boundary.falsePositivePressure": falsePositivePressure,
      "sig.boundary.boundaryStrength": margin + recurrence,
      "sig.boundary.stabilityWeightedMargin": margin * recurrence,
      "sig.boundary.supportRecoveryPotential": recurrence + Math.max(0, margin) - falsePositivePressure,
    },
  }
}

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, posNearestDistance: 0.08, negNearestDistance: 0.92, margin: 0.84, recurrence: 0.92, falsePositivePressure: 0.05 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-01-17", outcomeHitTarget: true, foldId: 1, windowId: 1, posNearestDistance: 0.09, negNearestDistance: 0.91, margin: 0.82, recurrence: 0.90, falsePositivePressure: 0.05 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-02-05", outcomeHitTarget: true, foldId: 2, windowId: 2, posNearestDistance: 0.10, negNearestDistance: 0.90, margin: 0.80, recurrence: 0.89, falsePositivePressure: 0.05 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-02-21", outcomeHitTarget: true, foldId: 2, windowId: 2, posNearestDistance: 0.11, negNearestDistance: 0.88, margin: 0.77, recurrence: 0.88, falsePositivePressure: 0.06 }),
  makeRow({ rowKey: "p5", symbol: "A5", dateKey: "2026-03-07", outcomeHitTarget: true, foldId: 3, windowId: 3, posNearestDistance: 0.12, negNearestDistance: 0.86, margin: 0.74, recurrence: 0.86, falsePositivePressure: 0.06 }),
  makeRow({ rowKey: "p6", symbol: "A6", dateKey: "2026-03-24", outcomeHitTarget: true, foldId: 3, windowId: 3, posNearestDistance: 0.13, negNearestDistance: 0.85, margin: 0.72, recurrence: 0.85, falsePositivePressure: 0.06 }),
  makeRow({ rowKey: "p7", symbol: "A7", dateKey: "2026-04-11", outcomeHitTarget: true, foldId: 4, windowId: 4, posNearestDistance: 0.14, negNearestDistance: 0.83, margin: 0.69, recurrence: 0.84, falsePositivePressure: 0.06 }),
  makeRow({ rowKey: "p8", symbol: "A8", dateKey: "2026-04-25", outcomeHitTarget: true, foldId: 4, windowId: 4, posNearestDistance: 0.15, negNearestDistance: 0.82, margin: 0.67, recurrence: 0.83, falsePositivePressure: 0.07 }),
]

const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-09", outcomeHitTarget: false, foldId: 1, windowId: 1, posNearestDistance: 0.68, negNearestDistance: 0.12, margin: -0.56, recurrence: 0.16, falsePositivePressure: 0.84 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-01-22", outcomeHitTarget: false, foldId: 1, windowId: 1, posNearestDistance: 0.69, negNearestDistance: 0.11, margin: -0.58, recurrence: 0.15, falsePositivePressure: 0.85 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-02-08", outcomeHitTarget: false, foldId: 2, windowId: 2, posNearestDistance: 0.71, negNearestDistance: 0.10, margin: -0.61, recurrence: 0.14, falsePositivePressure: 0.86 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-02-26", outcomeHitTarget: false, foldId: 2, windowId: 2, posNearestDistance: 0.72, negNearestDistance: 0.10, margin: -0.62, recurrence: 0.14, falsePositivePressure: 0.87 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-03-10", outcomeHitTarget: false, foldId: 3, windowId: 3, posNearestDistance: 0.73, negNearestDistance: 0.09, margin: -0.64, recurrence: 0.13, falsePositivePressure: 0.88 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-03-28", outcomeHitTarget: false, foldId: 3, windowId: 3, posNearestDistance: 0.75, negNearestDistance: 0.09, margin: -0.66, recurrence: 0.13, falsePositivePressure: 0.89 }),
  makeRow({ rowKey: "n7", symbol: "N7", dateKey: "2026-04-13", outcomeHitTarget: false, foldId: 4, windowId: 4, posNearestDistance: 0.76, negNearestDistance: 0.08, margin: -0.68, recurrence: 0.12, falsePositivePressure: 0.90 }),
  makeRow({ rowKey: "n8", symbol: "N8", dateKey: "2026-04-27", outcomeHitTarget: false, foldId: 4, windowId: 4, posNearestDistance: 0.78, negNearestDistance: 0.08, margin: -0.70, recurrence: 0.12, falsePositivePressure: 0.91 }),
]

const supportCaseViews = [
  makeRow({
    rowKey: "support_case",
    symbol: "076610",
    dateKey: "2026-03-18",
    outcomeHitTarget: true,
    foldId: 0,
    windowId: 0,
    posNearestDistance: 0.11,
    negNearestDistance: 0.87,
    margin: 0.76,
    recurrence: 0.89,
    falsePositivePressure: 0.05,
  }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const cohort = {
  ok: true,
  familyId: "low_gap_top_continuation",
  surfaceName: "synthetic_v39_carrier_graph",
  gateTokens,
  bridgePositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  trainRows: [...positives, ...negatives],
  gatedTrainRows: [...positives, ...negatives],
  oosRows: [],
  supportCaseViews,
}

const carrier = buildPerfectPrototypeSupportCarrierGraphFamily({ cohort })

assert.equal(carrier.ok, true)
assert.ok(Number(carrier.summary?.carrierGraphFeatureCount ?? 0) > 0)
assert.ok(Number(carrier.summary?.carrierComponentCount ?? 0) >= 1)
assert.ok(Number(carrier.summary?.carrierEligibleComponentCount ?? 0) >= 1)
assert.ok(Number(carrier.summary?.supportCaseReachableComponentCount ?? 0) >= 1)
assert.ok(Array.isArray(carrier.summary?.supportCaseReachableComponentIds))
assert.ok(Number(carrier.summary?.carrierPositiveSummary?.matchedFoldCount ?? 0) >= 4)

console.log("ok: support carrier graph family")
