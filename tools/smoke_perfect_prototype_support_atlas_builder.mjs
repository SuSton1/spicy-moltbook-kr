#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportAtlasDataset } from "../src/lib/perfect_prototype_support_atlas_dataset.mjs"
import { buildPerfectPrototypeSupportAtlasCandidateSpace } from "../src/lib/perfect_prototype_support_atlas_builder.mjs"

const makeRow = ({
  sourceId,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  baseX,
  baseY,
  gateToken = "tag:lowGapTop.gapContinuationRegime:GAP_FADE",
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  tokenSet: new Set([gateToken]),
  numericFeatureMap: {
    "sig.support.posDistance": baseX,
    "sig.support.margin": baseY,
    "sig.support.densityRatio": 1.5 + baseY,
    "sig.support.prototypeAgreement": 0.75 + baseY * 0.05,
    "sig.support.featureCoverage": 0.8,
    "sig.support.nearShare": 0.85,
    "sig.supportMetric.score": baseY - baseX,
    "sig.supportMetric.coverageAdjustedMargin": baseY * 0.8,
    "sig.supportMetric.agreementDistanceRatio": 2 - baseX,
    "sig.supportMetric.densityMarginGap": 1.2 + baseY,
    "sig.supportMetric.prototypeCloseness": 1 / (1 + baseX),
    "sig.supportMetric.supportCompatibility": 2.2 + baseY - baseX,
  },
})

const positives = [
  makeRow({ sourceId: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, baseX: 0.15, baseY: 1.3 }),
  makeRow({ sourceId: "p2", symbol: "A2", dateKey: "2026-01-10", outcomeHitTarget: true, foldId: 1, windowId: 1, baseX: 0.18, baseY: 1.25 }),
  makeRow({ sourceId: "p3", symbol: "A3", dateKey: "2026-02-04", outcomeHitTarget: true, foldId: 2, windowId: 2, baseX: 0.22, baseY: 1.15 }),
  makeRow({ sourceId: "p4", symbol: "A4", dateKey: "2026-02-13", outcomeHitTarget: true, foldId: 2, windowId: 2, baseX: 0.20, baseY: 1.1 }),
  makeRow({ sourceId: "p5", symbol: "B1", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, baseX: 0.75, baseY: 1.35 }),
  makeRow({ sourceId: "p6", symbol: "B2", dateKey: "2026-03-11", outcomeHitTarget: true, foldId: 3, windowId: 3, baseX: 0.78, baseY: 1.28 }),
  makeRow({ sourceId: "p7", symbol: "B3", dateKey: "2026-04-01", outcomeHitTarget: true, foldId: 4, windowId: 4, baseX: 0.82, baseY: 1.2 }),
  makeRow({ sourceId: "p8", symbol: "B4", dateKey: "2026-04-12", outcomeHitTarget: true, foldId: 4, windowId: 4, baseX: 0.8, baseY: 1.18 }),
]

const negatives = [
  makeRow({ sourceId: "n1", symbol: "N1", dateKey: "2026-01-06", outcomeHitTarget: false, foldId: 1, windowId: 1, baseX: 0.12, baseY: 0.2 }),
  makeRow({ sourceId: "n2", symbol: "N2", dateKey: "2026-01-17", outcomeHitTarget: false, foldId: 1, windowId: 1, baseX: 0.25, baseY: 0.15 }),
  makeRow({ sourceId: "n3", symbol: "N3", dateKey: "2026-02-07", outcomeHitTarget: false, foldId: 2, windowId: 2, baseX: 0.3, baseY: 0.1 }),
  makeRow({ sourceId: "n4", symbol: "N4", dateKey: "2026-02-19", outcomeHitTarget: false, foldId: 2, windowId: 2, baseX: 0.26, baseY: 0.18 }),
  makeRow({ sourceId: "n5", symbol: "N5", dateKey: "2026-03-05", outcomeHitTarget: false, foldId: 3, windowId: 3, baseX: 0.72, baseY: 0.22 }),
  makeRow({ sourceId: "n6", symbol: "N6", dateKey: "2026-03-17", outcomeHitTarget: false, foldId: 3, windowId: 3, baseX: 0.88, baseY: 0.12 }),
  makeRow({ sourceId: "n7", symbol: "N7", dateKey: "2026-04-04", outcomeHitTarget: false, foldId: 4, windowId: 4, baseX: 0.9, baseY: 0.18 }),
  makeRow({ sourceId: "n8", symbol: "N8", dateKey: "2026-04-15", outcomeHitTarget: false, foldId: 4, windowId: 4, baseX: 0.7, baseY: 0.25 }),
]

const supportCaseViews = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    tokenSet: new Set(["tag:lowGapTop.gapContinuationRegime:GAP_FADE"]),
    numericFeatureMap: {
      "sig.support.posDistance": 0.17,
      "sig.support.margin": 1.24,
      "sig.support.densityRatio": 2.6,
      "sig.support.prototypeAgreement": 0.84,
      "sig.support.featureCoverage": 0.82,
      "sig.support.nearShare": 0.86,
      "sig.supportMetric.score": 1.07,
      "sig.supportMetric.coverageAdjustedMargin": 0.98,
      "sig.supportMetric.agreementDistanceRatio": 3.4,
      "sig.supportMetric.densityMarginGap": 3.1,
      "sig.supportMetric.prototypeCloseness": 0.85,
      "sig.supportMetric.supportCompatibility": 4.2,
    },
  },
]

const cohort = {
  familyId: "low_gap_top_continuation",
  surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
  gateTokens: ["tag:lowGapTop.gapContinuationRegime:GAP_FADE"],
  supportCaseViews,
  gatedTrainRows: [...positives, ...negatives],
  supportPositiveRows: positives,
  hardNegativeRows: negatives,
  oosRows: [],
}

const dataset = buildPerfectPrototypeSupportAtlasDataset({ cohort })
const candidateSpace = buildPerfectPrototypeSupportAtlasCandidateSpace({
  dataset,
  maxCells: 4,
  minCellRows: 4,
  minCellDates: 4,
})

assert.ok(dataset.featureKeys.length >= 6)
assert.ok(candidateSpace.summary.atlasCellCandidateCount >= 1)
assert.ok(candidateSpace.summary.atlasQualifiedCellCount >= 1)

console.log("ok: support atlas builder")
