#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportDateBagDataset } from "../src/lib/perfect_prototype_support_date_bag_dataset.mjs"
import { buildPerfectPrototypeSupportContrastiveMotifLatticeFeatures } from "../src/lib/perfect_prototype_support_contrastive_motif_lattice_features.mjs"
import { buildPerfectPrototypeSupportBagWitnessSelector } from "../src/lib/perfect_prototype_support_bag_witness_selector.mjs"
import { buildPerfectPrototypeSupportMilMotifPrototypes } from "../src/lib/perfect_prototype_support_mil_motif_prototypes.mjs"
import { calibratePerfectPrototypeSupportBagLocalDetectors } from "../src/lib/perfect_prototype_support_bag_local_detector.mjs"
import { solvePerfectPrototypeSupportBagCover } from "../src/lib/perfect_prototype_support_bag_cover_solver.mjs"

const gateTokens = ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  dominantGroup,
  signature,
  recovery,
  leak,
  purity,
  agreement,
} = {}) => {
  const categoricalTokens = [...gateTokens, `sig:ordinalMotif.signature:${signature}`]
  return {
    rowKey,
    symbol,
    dateKey,
    monthKey: String(dateKey).slice(0, 7),
    outcomeHitTarget,
    foldId,
    windowId,
    ordinalMotifDominantGroup: dominantGroup,
    ordinalMotifSignature: signature,
    categoricalTokens,
    tokenSet: new Set(categoricalTokens),
    numericFeatureMap: {
      "sig.ordinalMotif.motifAgreement": agreement,
      "sig.ordinalMotif.negativeMotifConflict": leak * 0.2,
      "sig.ordinalMotif.recurrenceBreadthCarry": purity,
      "sig.ordinalMotif.recurrenceLeakPressure": leak,
      "sig.ordinalMotif.supportRecoveryPotential": recovery,
      "sig.recurBoundary.localRecoveryMargin": recovery * 0.8,
      "sig.recurBoundary.localBreadthPurityGap": purity,
      "sig.recurBoundary.crossfitRecoveryShare": 0.85,
      "sig.recurBoundary.crossfitLeakShare": leak,
    },
  }
}

const positives = [
  makeRow({ rowKey: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, dominantGroup: "candle", signature: "candle>volume", recovery: 1.4, leak: 0.03, purity: 1.2, agreement: 0.92 }),
  makeRow({ rowKey: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, dominantGroup: "candle", signature: "candle>volume", recovery: 1.35, leak: 0.03, purity: 1.15, agreement: 0.91 }),
  makeRow({ rowKey: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, dominantGroup: "candle", signature: "candle>volume", recovery: 1.3, leak: 0.04, purity: 1.1, agreement: 0.9 }),
  makeRow({ rowKey: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, dominantGroup: "candle", signature: "candle>volume", recovery: 1.28, leak: 0.04, purity: 1.08, agreement: 0.89 }),
  makeRow({ rowKey: "p5", symbol: "B1", dateKey: "2026-05-03", outcomeHitTarget: true, foldId: 1, windowId: 1, dominantGroup: "volume", signature: "volume>candle", recovery: 1.4, leak: 0.03, purity: 1.18, agreement: 0.92 }),
  makeRow({ rowKey: "p6", symbol: "B2", dateKey: "2026-06-03", outcomeHitTarget: true, foldId: 2, windowId: 2, dominantGroup: "volume", signature: "volume>candle", recovery: 1.36, leak: 0.03, purity: 1.14, agreement: 0.91 }),
  makeRow({ rowKey: "p7", symbol: "B3", dateKey: "2026-07-03", outcomeHitTarget: true, foldId: 3, windowId: 3, dominantGroup: "volume", signature: "volume>candle", recovery: 1.31, leak: 0.04, purity: 1.09, agreement: 0.9 }),
  makeRow({ rowKey: "p8", symbol: "B4", dateKey: "2026-08-03", outcomeHitTarget: true, foldId: 4, windowId: 4, dominantGroup: "volume", signature: "volume>candle", recovery: 1.29, leak: 0.04, purity: 1.05, agreement: 0.89 }),
  makeRow({ rowKey: "p9", symbol: "C1", dateKey: "2026-09-03", outcomeHitTarget: true, foldId: 1, windowId: 1, dominantGroup: "candle", signature: "candle>volume", recovery: 1.22, leak: 0.05, purity: 1.01, agreement: 0.87 }),
  makeRow({ rowKey: "p10", symbol: "C2", dateKey: "2026-10-03", outcomeHitTarget: true, foldId: 2, windowId: 2, dominantGroup: "volume", signature: "volume>candle", recovery: 1.21, leak: 0.05, purity: 1.0, agreement: 0.87 }),
]
const negatives = [
  makeRow({ rowKey: "n1", symbol: "N1", dateKey: "2026-01-10", outcomeHitTarget: false, foldId: 1, windowId: 1, dominantGroup: "candle", signature: "candle>volume", recovery: -0.2, leak: 0.7, purity: -0.3, agreement: 0.2 }),
  makeRow({ rowKey: "n2", symbol: "N2", dateKey: "2026-02-10", outcomeHitTarget: false, foldId: 2, windowId: 2, dominantGroup: "candle", signature: "candle>volume", recovery: -0.15, leak: 0.68, purity: -0.28, agreement: 0.22 }),
  makeRow({ rowKey: "n3", symbol: "N3", dateKey: "2026-03-10", outcomeHitTarget: false, foldId: 3, windowId: 3, dominantGroup: "volume", signature: "volume>candle", recovery: -0.18, leak: 0.7, purity: -0.3, agreement: 0.2 }),
  makeRow({ rowKey: "n4", symbol: "N4", dateKey: "2026-04-10", outcomeHitTarget: false, foldId: 4, windowId: 4, dominantGroup: "volume", signature: "volume>candle", recovery: -0.14, leak: 0.68, purity: -0.28, agreement: 0.22 }),
]
const oosRows = [
  makeRow({ rowKey: "o1", symbol: "O1", dateKey: "2026-11-03", outcomeHitTarget: true, foldId: 0, windowId: 0, dominantGroup: "candle", signature: "candle>volume", recovery: 1.26, leak: 0.04, purity: 1.04, agreement: 0.88 }),
  makeRow({ rowKey: "o2", symbol: "O2", dateKey: "2026-12-03", outcomeHitTarget: true, foldId: 0, windowId: 0, dominantGroup: "volume", signature: "volume>candle", recovery: 1.24, leak: 0.04, purity: 1.02, agreement: 0.88 }),
]
const supportCaseViews = [
  {
    ...makeRow({ rowKey: "s1", symbol: "076610", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 0, windowId: 0, dominantGroup: "candle", signature: "candle>volume", recovery: 1.25, leak: 0.04, purity: 1.03, agreement: 0.88 }),
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  },
]

let family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  gateTokens,
  supportFitExcluded: true,
  trainRows: [...positives, ...negatives],
  gatedTrainRows: [...positives, ...negatives],
  oosRows,
  supportCaseViews,
  bridgePositiveRows: positives,
  supportNearHardNegativeRows: negatives,
  summary: {},
}
family = buildPerfectPrototypeSupportDateBagDataset({ family })
family = buildPerfectPrototypeSupportContrastiveMotifLatticeFeatures({ family })
family = buildPerfectPrototypeSupportBagWitnessSelector({ family })
family = buildPerfectPrototypeSupportMilMotifPrototypes({ family, minPositiveBags: 2 })
const detectors = calibratePerfectPrototypeSupportBagLocalDetectors({
  family,
  minTrainMatchedDates: 3,
  minTrainMatchedMonths: 3,
  minTrainMatchedFolds: 2,
  minCrossfitPositiveWindows: 1,
  maxCrossfitNegativeWindows: 0,
})
const union = solvePerfectPrototypeSupportBagCover({
  family,
  bagLocalDetectorCalibration: detectors,
  minTrainMatchedDates: 8,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 2,
})

assert.equal(family.ok, true)
assert.ok(Number(family.summary.positiveBagCount ?? 0) >= 10)
assert.ok(Number(family.summary.motifBundleCount ?? 0) >= 2)
assert.ok(Number(family.summary.motifPrototypeCount ?? 0) >= 2)
assert.equal(detectors.ok, true)
assert.ok(Number(detectors.bagLocalDetectorQualifiedCount ?? 0) >= 2)
assert.equal(union.ok, true)
assert.equal(Number(union.trainSummary?.precision ?? 0), 1)
assert.ok(Number(union.trainSummary?.trainMatchedDateCount ?? 0) >= 8)
assert.equal(union.supportLeaveOneOutRecovered, true)
assert.equal(Number(union.oosSummary?.openOosPrecision ?? 0), 1)
assert.ok(Number(union.oosSummary?.openOosMatchCount ?? 0) >= 2)

console.log("ok: support bag cover")
