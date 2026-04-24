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
  groupId,
  positiveHeadBase,
  riskBase,
  marginBase,
} = {}) => ({
  rowKey,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  recurBoundaryDominantGroup: groupId,
  tokenSet: new Set(gateTokens),
  categoricalTokens: gateTokens.slice(),
  numericFeatureMap: {
    "sig.recurBoundary.localBreadthPurityGap": positiveHeadBase - riskBase,
    "sig.recurBoundary.localRecoveryMargin": marginBase,
    "sig.recurBoundary.localFoldPersistenceGap": positiveHeadBase * 0.5,
    "sig.recurBoundary.localWindowStabilityGap": positiveHeadBase * 0.5,
    "sig.recurBoundary.posNeighborDateBreadth": positiveHeadBase,
    "sig.recurBoundary.posNeighborMonthBreadth": positiveHeadBase,
    "sig.recurBoundary.posNeighborFoldBreadth": positiveHeadBase,
    "sig.recurBoundary.posNeighborWindowBreadth": positiveHeadBase,
    "sig.recurBoundary.negNeighborLeakShare": riskBase,
    "sig.boundary.falsePositivePressure": riskBase * 0.5,
    [`sig.recurBoundary.group.${groupId}.neighborMargin`]: marginBase,
    [`sig.recurBoundary.group.${groupId}.neighborPurityGap`]: positiveHeadBase - riskBase,
    [`sig.recurBoundary.group.${groupId}.neighborBreadthCarry`]: positiveHeadBase,
  },
})

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupId: "G1", positiveHeadBase: 1.20, riskBase: 0.02, marginBase: 1.1 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupId: "G1", positiveHeadBase: 1.16, riskBase: 0.03, marginBase: 1.0 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, groupId: "G1", positiveHeadBase: 1.12, riskBase: 0.03, marginBase: 0.96 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, groupId: "G1", positiveHeadBase: 1.08, riskBase: 0.04, marginBase: 0.92 }),
  makeRow({ rowKey: "p5", symbol: "B1", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupId: "G2", positiveHeadBase: 1.18, riskBase: 0.02, marginBase: 1.05 }),
  makeRow({ rowKey: "p6", symbol: "B2", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupId: "G2", positiveHeadBase: 1.14, riskBase: 0.03, marginBase: 1.0 }),
  makeRow({ rowKey: "p7", symbol: "B3", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 3, groupId: "G2", positiveHeadBase: 1.10, riskBase: 0.03, marginBase: 0.94 }),
  makeRow({ rowKey: "p8", symbol: "B4", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 4, groupId: "G2", positiveHeadBase: 1.06, riskBase: 0.04, marginBase: 0.90 }),
  makeRow({ rowKey: "p9", symbol: "C1", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupId: "G1", positiveHeadBase: 1.04, riskBase: 0.03, marginBase: 0.90 }),
  makeRow({ rowKey: "p10", symbol: "D1", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupId: "G2", positiveHeadBase: 1.02, riskBase: 0.03, marginBase: 0.88 }),
]

const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-08", outcomeHitTarget: false, foldId: 1, windowId: 1, groupId: "G1", positiveHeadBase: 0.16, riskBase: 0.72, marginBase: -0.2 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-08", outcomeHitTarget: false, foldId: 2, windowId: 2, groupId: "G1", positiveHeadBase: 0.18, riskBase: 0.74, marginBase: -0.18 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-03-08", outcomeHitTarget: false, foldId: 3, windowId: 3, groupId: "G1", positiveHeadBase: 0.17, riskBase: 0.73, marginBase: -0.19 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-05-08", outcomeHitTarget: false, foldId: 1, windowId: 1, groupId: "G2", positiveHeadBase: 0.15, riskBase: 0.71, marginBase: -0.21 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-06-08", outcomeHitTarget: false, foldId: 2, windowId: 2, groupId: "G2", positiveHeadBase: 0.17, riskBase: 0.73, marginBase: -0.19 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-07-08", outcomeHitTarget: false, foldId: 3, windowId: 3, groupId: "G2", positiveHeadBase: 0.16, riskBase: 0.72, marginBase: -0.2 }),
]

const oosRows = [
  makeRow({ rowKey: "o1", symbol: "O1", dateKey: "2026-11-03", outcomeHitTarget: true, foldId: 0, windowId: 0, groupId: "G1", positiveHeadBase: 1.11, riskBase: 0.03, marginBase: 0.95 }),
  makeRow({ rowKey: "o2", symbol: "O2", dateKey: "2026-11-10", outcomeHitTarget: true, foldId: 0, windowId: 0, groupId: "G2", positiveHeadBase: 1.09, riskBase: 0.03, marginBase: 0.93 }),
  makeRow({ rowKey: "o3", symbol: "O3", dateKey: "2026-11-17", outcomeHitTarget: true, foldId: 0, windowId: 0, groupId: "G1", positiveHeadBase: 1.08, riskBase: 0.04, marginBase: 0.91 }),
  makeRow({ rowKey: "o4", symbol: "X1", dateKey: "2026-11-05", outcomeHitTarget: false, foldId: 0, windowId: 0, groupId: "G1", positiveHeadBase: 0.16, riskBase: 0.72, marginBase: -0.2 }),
]

const supportCaseViews = [
  makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, groupId: "G1", positiveHeadBase: 1.13, riskBase: 0.03, marginBase: 0.97 }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  surfaceName: "synthetic_v38",
  gateTokens,
  supportFitExcluded: true,
  recurrencePurityFeatureKeys: [
    "sig.recurBoundary.localBreadthPurityGap",
    "sig.recurBoundary.localRecoveryMargin",
    "sig.recurBoundary.localFoldPersistenceGap",
    "sig.recurBoundary.localWindowStabilityGap",
    "sig.recurBoundary.posNeighborDateBreadth",
    "sig.recurBoundary.posNeighborMonthBreadth",
    "sig.recurBoundary.posNeighborFoldBreadth",
    "sig.recurBoundary.posNeighborWindowBreadth",
    "sig.recurBoundary.negNeighborLeakShare",
    "sig.recurBoundary.group.G1.neighborMargin",
    "sig.recurBoundary.group.G1.neighborPurityGap",
    "sig.recurBoundary.group.G1.neighborBreadthCarry",
    "sig.recurBoundary.group.G2.neighborMargin",
    "sig.recurBoundary.group.G2.neighborPurityGap",
    "sig.recurBoundary.group.G2.neighborBreadthCarry",
  ],
  recurrencePurityGroupIds: ["G1", "G2"],
  bridgePositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  hardNegativeRows: negatives,
  gatedTrainRows: [...positives, ...negatives],
  oosRows,
  supportCaseViews,
  summary: {
    recurrencePurityFeatureCount: 15,
    recurrencePurityGroupCount: 2,
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

console.log("ok: support boundary local experts")
