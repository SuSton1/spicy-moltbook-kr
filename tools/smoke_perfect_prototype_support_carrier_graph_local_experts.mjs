#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportBoundaryGroupDataset } from "../src/lib/perfect_prototype_support_boundary_group_dataset.mjs"
import { calibratePerfectPrototypeSupportBoundaryLocalExperts } from "../src/lib/perfect_prototype_support_boundary_local_expert_calibrate.mjs"
import { solvePerfectPrototypeSupportBoundaryExpertUnion } from "../src/lib/perfect_prototype_support_boundary_expert_union.mjs"

const gateTokens = ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  componentId,
  connectivity,
  boundaryGap,
  purity,
  breadthCarry,
  recurrenceScore,
  risk,
} = {}) => ({
  rowKey,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  carrierDominantComponent: componentId,
  carrierReachableComponentIds: [componentId],
  carrierBorderComponent: componentId,
  tokenSet: new Set(gateTokens),
  categoricalTokens: gateTokens.slice(),
  numericFeatureMap: {
    "sig.carrierGraph.posComponentEdgeMargin": connectivity,
    "sig.carrierGraph.negBorderEdgePressure": risk,
    "sig.carrierGraph.componentPurity": purity,
    "sig.carrierGraph.componentDateBreadth": 10,
    "sig.carrierGraph.componentMonthBreadth": 6,
    "sig.carrierGraph.componentFoldBreadth": 4,
    "sig.carrierGraph.componentWindowBreadth": 4,
    "sig.carrierGraph.componentPersistenceShare": breadthCarry,
    "sig.carrierGraph.componentBoundaryGap": boundaryGap,
    "sig.carrierGraph.falsePositivePressure": risk,
    "sig.carrierGraph.recurrenceCarrierScore": recurrenceScore,
    [`sig.carrierGraph.component.${componentId}.connectivity`]: connectivity,
    [`sig.carrierGraph.component.${componentId}.boundaryGap`]: boundaryGap,
    [`sig.carrierGraph.component.${componentId}.purity`]: purity,
    [`sig.carrierGraph.component.${componentId}.breadthCarry`]: breadthCarry,
  },
})

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, componentId: "CARRIER_COMPONENT_01", connectivity: 1.25, boundaryGap: 1.05, purity: 0.92, breadthCarry: 0.88, recurrenceScore: 3.1, risk: 0.05 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, componentId: "CARRIER_COMPONENT_01", connectivity: 1.20, boundaryGap: 1.00, purity: 0.91, breadthCarry: 0.86, recurrenceScore: 3.0, risk: 0.05 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, componentId: "CARRIER_COMPONENT_01", connectivity: 1.16, boundaryGap: 0.96, purity: 0.90, breadthCarry: 0.85, recurrenceScore: 2.9, risk: 0.06 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, componentId: "CARRIER_COMPONENT_01", connectivity: 1.12, boundaryGap: 0.92, purity: 0.89, breadthCarry: 0.84, recurrenceScore: 2.8, risk: 0.06 }),
  makeRow({ rowKey: "p5", symbol: "B1", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 1, componentId: "CARRIER_COMPONENT_02", connectivity: 1.22, boundaryGap: 1.02, purity: 0.92, breadthCarry: 0.87, recurrenceScore: 3.0, risk: 0.05 }),
  makeRow({ rowKey: "p6", symbol: "B2", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 2, componentId: "CARRIER_COMPONENT_02", connectivity: 1.18, boundaryGap: 0.98, purity: 0.91, breadthCarry: 0.86, recurrenceScore: 2.95, risk: 0.05 }),
  makeRow({ rowKey: "p7", symbol: "B3", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 3, componentId: "CARRIER_COMPONENT_02", connectivity: 1.14, boundaryGap: 0.94, purity: 0.90, breadthCarry: 0.84, recurrenceScore: 2.85, risk: 0.06 }),
  makeRow({ rowKey: "p8", symbol: "B4", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 4, componentId: "CARRIER_COMPONENT_02", connectivity: 1.10, boundaryGap: 0.90, purity: 0.89, breadthCarry: 0.83, recurrenceScore: 2.75, risk: 0.06 }),
  makeRow({ rowKey: "p9", symbol: "C1", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 1, componentId: "CARRIER_COMPONENT_01", connectivity: 1.08, boundaryGap: 0.88, purity: 0.88, breadthCarry: 0.82, recurrenceScore: 2.70, risk: 0.06 }),
  makeRow({ rowKey: "p10", symbol: "D1", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 2, componentId: "CARRIER_COMPONENT_02", connectivity: 1.06, boundaryGap: 0.86, purity: 0.88, breadthCarry: 0.81, recurrenceScore: 2.65, risk: 0.06 }),
]

const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-09", outcomeHitTarget: false, foldId: 1, windowId: 1, componentId: "CARRIER_COMPONENT_01", connectivity: 0.08, boundaryGap: -0.50, purity: 0.20, breadthCarry: 0.10, recurrenceScore: -0.6, risk: 0.72 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-09", outcomeHitTarget: false, foldId: 2, windowId: 2, componentId: "CARRIER_COMPONENT_01", connectivity: 0.10, boundaryGap: -0.46, purity: 0.22, breadthCarry: 0.10, recurrenceScore: -0.55, risk: 0.70 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-03-09", outcomeHitTarget: false, foldId: 3, windowId: 3, componentId: "CARRIER_COMPONENT_01", connectivity: 0.12, boundaryGap: -0.42, purity: 0.24, breadthCarry: 0.10, recurrenceScore: -0.50, risk: 0.69 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-05-09", outcomeHitTarget: false, foldId: 1, windowId: 1, componentId: "CARRIER_COMPONENT_02", connectivity: 0.08, boundaryGap: -0.48, purity: 0.20, breadthCarry: 0.10, recurrenceScore: -0.58, risk: 0.71 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-06-09", outcomeHitTarget: false, foldId: 2, windowId: 2, componentId: "CARRIER_COMPONENT_02", connectivity: 0.10, boundaryGap: -0.44, purity: 0.22, breadthCarry: 0.10, recurrenceScore: -0.54, risk: 0.69 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-07-09", outcomeHitTarget: false, foldId: 3, windowId: 3, componentId: "CARRIER_COMPONENT_02", connectivity: 0.12, boundaryGap: -0.40, purity: 0.24, breadthCarry: 0.10, recurrenceScore: -0.49, risk: 0.68 }),
]

const oosRows = [
  makeRow({ rowKey: "o1", symbol: "O1", dateKey: "2026-11-03", outcomeHitTarget: true, foldId: 0, windowId: 0, componentId: "CARRIER_COMPONENT_01", connectivity: 1.14, boundaryGap: 0.96, purity: 0.90, breadthCarry: 0.84, recurrenceScore: 2.9, risk: 0.05 }),
  makeRow({ rowKey: "o2", symbol: "O2", dateKey: "2026-11-10", outcomeHitTarget: true, foldId: 0, windowId: 0, componentId: "CARRIER_COMPONENT_02", connectivity: 1.12, boundaryGap: 0.94, purity: 0.90, breadthCarry: 0.84, recurrenceScore: 2.85, risk: 0.05 }),
  makeRow({ rowKey: "o3", symbol: "X1", dateKey: "2026-11-05", outcomeHitTarget: false, foldId: 0, windowId: 0, componentId: "CARRIER_COMPONENT_01", connectivity: 0.10, boundaryGap: -0.45, purity: 0.21, breadthCarry: 0.10, recurrenceScore: -0.52, risk: 0.70 }),
]

const supportCaseViews = [
  makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, componentId: "CARRIER_COMPONENT_01", connectivity: 1.18, boundaryGap: 1.00, purity: 0.91, breadthCarry: 0.86, recurrenceScore: 3.0, risk: 0.05 }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  surfaceName: "synthetic_v39_local_experts",
  gateTokens,
  supportFitExcluded: true,
  localExpertFeatureKeys: [
    "sig.carrierGraph.posComponentEdgeMargin",
    "sig.carrierGraph.componentBoundaryGap",
    "sig.carrierGraph.componentPurity",
    "sig.carrierGraph.componentPersistenceShare",
    "sig.carrierGraph.recurrenceCarrierScore",
    "sig.carrierGraph.component.CARRIER_COMPONENT_01.connectivity",
    "sig.carrierGraph.component.CARRIER_COMPONENT_01.boundaryGap",
    "sig.carrierGraph.component.CARRIER_COMPONENT_01.purity",
    "sig.carrierGraph.component.CARRIER_COMPONENT_01.breadthCarry",
    "sig.carrierGraph.component.CARRIER_COMPONENT_02.connectivity",
    "sig.carrierGraph.component.CARRIER_COMPONENT_02.boundaryGap",
    "sig.carrierGraph.component.CARRIER_COMPONENT_02.purity",
    "sig.carrierGraph.component.CARRIER_COMPONENT_02.breadthCarry",
  ],
  localExpertDefaults: {
    requiredGroupType: "carrierComponent",
    marginFeatureKey: "sig.carrierGraph.componentBoundaryGap",
    riskFeatureKey: "sig.carrierGraph.negBorderEdgePressure",
    falsePositivePressureFeatureKey: "sig.carrierGraph.falsePositivePressure",
  },
  localExpertArtifactType: "perfect_prototype_support_carrier_graph_local_experts",
  carrierComponentIds: ["CARRIER_COMPONENT_01", "CARRIER_COMPONENT_02"],
  carrierEligibleComponentIds: ["CARRIER_COMPONENT_01", "CARRIER_COMPONENT_02"],
  bridgePositiveRows: positives,
  carrierPositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  hardNegativeRows: negatives,
  gatedTrainRows: [...positives, ...negatives],
  oosRows,
  supportCaseViews,
  summary: {
    carrierGraphFeatureCount: 13,
    carrierComponentCount: 2,
    carrierEligibleComponentCount: 2,
    supportCaseReachableComponentCount: 1,
  },
}

const groupDataset = buildPerfectPrototypeSupportBoundaryGroupDataset({
  family,
  minNegativeRows: 3,
})
const localExperts = calibratePerfectPrototypeSupportBoundaryLocalExperts({
  family,
  groupDataset,
  minTrainMatchedDates: 3,
  minTrainMatchedMonths: 3,
  minTrainMatchedFolds: 2,
  minCrossfitPositiveWindows: 1,
  maxCrossfitNegativeWindows: 0,
})
const union = solvePerfectPrototypeSupportBoundaryExpertUnion({
  family,
  groupDataset,
  localExpertCalibration: localExperts,
  minTrainMatchedDates: 8,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 3,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 2,
})

assert.equal(groupDataset.ok, true)
assert.equal(localExperts.ok, true)
assert.ok(Number(localExperts.localExpertQualifiedCount ?? 0) >= 2)
assert.equal(union.ok, true)
assert.equal(union.supportFitExcluded, true)
assert.equal(union.supportLeaveOneOutRecovered, true)
assert.equal(union.trainSummary.precision, 1)
assert.ok(Number(union.trainSummary.trainMatchedDateCount ?? 0) >= 8)
assert.equal(union.oosSummary.precision, 1)
assert.ok(Number(union.oosSummary.selectedRowCount ?? 0) >= 2)

console.log("ok: support carrier graph local experts")
