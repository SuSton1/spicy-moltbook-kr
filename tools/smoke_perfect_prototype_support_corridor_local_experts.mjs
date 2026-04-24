#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportOrdinalMotifFeatures } from "../src/lib/perfect_prototype_support_ordinal_motif_features.mjs"
import { buildPerfectPrototypeSupportCorridorPositiveBasins } from "../src/lib/perfect_prototype_support_corridor_positive_basins.mjs"
import { buildPerfectPrototypeSupportCorridorSeedCover } from "../src/lib/perfect_prototype_support_corridor_seed_cover.mjs"
import { propagatePerfectPrototypeSupportCorridorGraph } from "../src/lib/perfect_prototype_support_graph_propagation.mjs"
import { buildPerfectPrototypeSupportCorridorBasinProjection } from "../src/lib/perfect_prototype_support_corridor_basin_projection.mjs"
import { buildPerfectPrototypeSupportMultibasinSimplexFeatures } from "../src/lib/perfect_prototype_support_multibasin_simplex_features.mjs"
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
  groupA,
  groupB,
  recovery,
  leak,
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
    "sig.boundary.group.candle.residualMargin": groupA,
    "sig.boundary.group.volume.residualMargin": groupB,
    "sig.boundary.supportRecoveryPotential": recovery,
    "sig.boundary.falsePositivePressure": leak,
    "sig.recurBoundary.localBreadthPurityGap": recovery,
    "sig.recurBoundary.localRecoveryMargin": recovery * 0.8,
    "sig.recurBoundary.crossfitRecoveryShare": 0.85,
    "sig.recurBoundary.crossfitLeakShare": leak,
    "sig.bridge.posNegMargin": recovery,
    "sig.bridge.bestPositiveCellMargin": recovery * 0.75,
  },
})

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupA: 1.2, groupB: 0.4, recovery: 1.2, leak: 0.04 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupA: 1.15, groupB: 0.42, recovery: 1.15, leak: 0.04 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, groupA: 1.1, groupB: 0.45, recovery: 1.1, leak: 0.05 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, groupA: 1.05, groupB: 0.46, recovery: 1.05, leak: 0.05 }),
  makeRow({ rowKey: "p5", symbol: "B1", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupA: 0.38, groupB: 1.15, recovery: 1.18, leak: 0.04 }),
  makeRow({ rowKey: "p6", symbol: "B2", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupA: 0.4, groupB: 1.1, recovery: 1.14, leak: 0.04 }),
  makeRow({ rowKey: "p7", symbol: "B3", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 3, groupA: 0.42, groupB: 1.05, recovery: 1.1, leak: 0.05 }),
  makeRow({ rowKey: "p8", symbol: "B4", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 4, groupA: 0.44, groupB: 1.0, recovery: 1.05, leak: 0.05 }),
  makeRow({ rowKey: "p9", symbol: "C1", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 1, groupA: 1.0, groupB: 0.43, recovery: 1.0, leak: 0.05 }),
  makeRow({ rowKey: "p10", symbol: "C2", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 2, groupA: 0.43, groupB: 0.98, recovery: 1.0, leak: 0.05 }),
]
const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-10", outcomeHitTarget: false, foldId: 1, windowId: 1, groupA: -0.3, groupB: 0.8, recovery: -0.2, leak: 0.7 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-10", outcomeHitTarget: false, foldId: 2, windowId: 2, groupA: -0.25, groupB: 0.75, recovery: -0.18, leak: 0.68 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-03-10", outcomeHitTarget: false, foldId: 3, windowId: 3, groupA: -0.2, groupB: 0.7, recovery: -0.15, leak: 0.66 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-04-10", outcomeHitTarget: false, foldId: 4, windowId: 4, groupA: -0.18, groupB: 0.68, recovery: -0.12, leak: 0.65 }),
  makeRow({ rowKey: "n5", symbol: "N5", dateKey: "2026-05-10", outcomeHitTarget: false, foldId: 1, windowId: 1, groupA: 0.75, groupB: -0.25, recovery: -0.2, leak: 0.7 }),
  makeRow({ rowKey: "n6", symbol: "N6", dateKey: "2026-06-10", outcomeHitTarget: false, foldId: 2, windowId: 2, groupA: 0.72, groupB: -0.2, recovery: -0.18, leak: 0.68 }),
]
const oosRows = [
  makeRow({ rowKey: "o1", symbol: "O1", dateKey: "2026-11-03", outcomeHitTarget: true, foldId: 0, windowId: 0, groupA: 1.08, groupB: 0.44, recovery: 1.05, leak: 0.04 }),
  makeRow({ rowKey: "o2", symbol: "O2", dateKey: "2026-11-10", outcomeHitTarget: true, foldId: 0, windowId: 0, groupA: 0.43, groupB: 1.06, recovery: 1.04, leak: 0.04 }),
]
const supportCaseViews = [
  makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, groupA: 1.12, groupB: 0.43, recovery: 1.08, leak: 0.04 }),
]
supportCaseViews[0].caseId = PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID

const ordinalFamily = buildPerfectPrototypeSupportOrdinalMotifFeatures({
  cohort: {
    ok: true,
    familyId: "low_gap_top_continuation",
    surfaceName: "synthetic_v41_corridor_local_experts",
    gateTokens,
    supportFitExcluded: true,
    trainRows: [...positives, ...negatives],
    gatedTrainRows: [...positives, ...negatives],
    oosRows,
    supportCaseViews,
    bridgePositiveRows: positives,
    supportNearHardNegativeRows: negatives,
    boundaryResidualGroupStats: [
      { group: "candle", recurrenceShare: 0.9, falsePositiveShare: 0.2, separation: 1.1 },
      { group: "volume", recurrenceShare: 0.85, falsePositiveShare: 0.25, separation: 1.0 },
    ],
    summary: {},
  },
})
const basins = buildPerfectPrototypeSupportCorridorPositiveBasins({ family: ordinalFamily })
const seeds = buildPerfectPrototypeSupportCorridorSeedCover({ family: basins })

const graphNodes = [...ordinalFamily.gatedTrainRows].map((row, index, rows) => ({
  index,
  row,
  neighbors: rows
    .map((candidate, candidateIndex) => {
      if (candidateIndex === index) return null
      const sameGroup = row.ordinalMotifDominantGroup === candidate.ordinalMotifDominantGroup
      return {
        index: candidateIndex,
        weight: sameGroup ? 1 : 0.15,
      }
    })
    .filter(Boolean),
  isPositiveSeed: (seeds.graphPositiveSeedRows ?? []).some((seed) => seed.rowKey === row.rowKey),
  isNegativeSeed: negatives.some((negative) => negative.rowKey === row.rowKey),
}))
const propagated = propagatePerfectPrototypeSupportCorridorGraph({
  family: {
    ...seeds,
    graphNodes,
    corridorFeatureEntries: [
      { featureKey: "sig.ordinalMotif.motifAgreement", scale: 1, weight: 1.2 },
      { featureKey: "sig.ordinalMotif.supportRecoveryPotential", scale: 1, weight: 1.2 },
      { featureKey: "sig.recurBoundary.localRecoveryMargin", scale: 1, weight: 1.1 },
      { featureKey: "sig.bridge.posNegMargin", scale: 1, weight: 1.0 },
    ],
  },
})
const projected = buildPerfectPrototypeSupportCorridorBasinProjection({
  family: {
    ...propagated,
    ...seeds,
    ...basins,
    ordinalMotifFeatureKeys: ordinalFamily.ordinalMotifFeatureKeys,
    recurrencePurityFeatureKeys: [],
    trainRows: ordinalFamily.trainRows,
    gatedTrainRows: ordinalFamily.gatedTrainRows,
    oosRows: ordinalFamily.oosRows,
    supportCaseViews: ordinalFamily.supportCaseViews,
    bridgePositiveRows: ordinalFamily.bridgePositiveRows,
    supportNearHardNegativeRows: ordinalFamily.supportNearHardNegativeRows,
  },
})
const simplex = buildPerfectPrototypeSupportMultibasinSimplexFeatures({ family: projected })
const groupDataset = buildPerfectPrototypeSupportBoundaryGroupDataset({ family: simplex, minNegativeRows: 2 })
const localExperts = calibratePerfectPrototypeSupportBoundaryLocalExperts({
  family: simplex,
  groupDataset,
  minTrainMatchedDates: 3,
  minTrainMatchedMonths: 3,
  minTrainMatchedFolds: 2,
  minCrossfitPositiveWindows: 1,
  maxCrossfitNegativeWindows: 0,
})
const union = solvePerfectPrototypeSupportBoundaryExpertUnion({
  family: simplex,
  groupDataset,
  localExpertCalibration: localExperts,
  minTrainMatchedDates: 8,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 3,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 2,
})

assert.equal(ordinalFamily.ok, true)
assert.equal(basins.ok, true)
assert.ok(Number(seeds.summary.corridorPositiveSeedCount ?? 0) >= 3)
assert.equal(projected.ok, true)
assert.equal(simplex.ok, true)
assert.ok(Number(projected.summary.supportCaseReachableBasinCount ?? 0) > 0)
assert.equal(groupDataset.ok, true)
assert.equal(localExperts.ok, true)
assert.ok(Number(localExperts.localExpertQualifiedCount ?? 0) >= 1)
assert.ok(Number(union.coverageFrontierCandidateCount ?? 0) >= 1)
assert.ok(Number(union.coverageFrontierQualifiedCount ?? 0) >= 1)
assert.ok(Number(union.bestSingleExpertTrainMatchedDateCount ?? 0) >= 3)
assert.ok(
  union.ok === true ||
    String(union.reason ?? "") === "unsat_expert_union_train_breadth" ||
    String(union.reason ?? "") === "unsat_expert_union_no_complement_gain",
)

console.log("ok: support corridor local experts")
