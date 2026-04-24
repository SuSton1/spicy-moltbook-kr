import assert from "node:assert/strict"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportPrototypeRouterCandidateSpace } from "../src/lib/perfect_prototype_support_prototype_router_builder.mjs"
import { calibratePerfectPrototypeSupportPrototypeRouter } from "../src/lib/perfect_prototype_support_prototype_router_calibrate.mjs"
import {
  applyPerfectPrototypeSupportPrototypeRouter,
  summarizePerfectPrototypeSupportPrototypeRouterSelections,
} from "../src/lib/perfect_prototype_support_prototype_router_apply.mjs"

const supportCases = [
  {
    caseId: "076610:2026-03-18",
    symbol: "076610",
    dateKey: "2026-03-18",
    familyIds: ["low_gap_top_continuation"],
    tokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
      "tag:event.gapProfile:GAP_DOMINANT",
    ],
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
      "tag:event.gapProfile:GAP_DOMINANT",
      "sig:support.clusterCell:CORE",
    ],
    donorRuleIds: [],
    donorTokens: [],
    numericFeatureMap: {
      "sig.support.posDistance": 0.16,
      "sig.support.maxDistance": 0.32,
      "sig.support.margin": 0.94,
      "sig.support.densityRatio": 1.82,
      "sig.support.prototypeAgreement": 0.88,
      "sig.support.featureCoverage": 0.84,
      "sig.support.nearShare": 0.82,
      "sig.supportMetric.score": 2.08,
      "sig.supportMetric.coverageAdjustedMargin": 0.79,
      "sig.supportMetric.agreementDistanceRatio": 3.5,
      "sig.supportMetric.densityMarginGap": 2.1,
      "sig.supportMetric.prototypeCloseness": 0.86,
      "sig.supportMetric.supportCompatibility": 2.28,
    },
    supportSignatureFeatureKeys: [],
  },
]

const makePositive = (id, symbol, dateKey, foldId, windowId, compatibility, margin) => ({
  sourceId: id,
  symbol,
  dateKey,
  outcomeHitTarget: true,
  foldId,
  windowId,
  categoricalTokens: [
    "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
    "tag:event.gapProfile:GAP_DOMINANT",
    margin >= 0.8 ? "sig:support.clusterCell:CORE" : "sig:support.clusterCell:EDGE",
  ],
  numericFeatureMap: {
    "sig.support.posDistance": 0.18 + (2.1 - compatibility) * 0.08,
    "sig.support.maxDistance": 0.34 + (2.1 - compatibility) * 0.1,
    "sig.support.margin": margin,
    "sig.support.densityRatio": 1.45 + (compatibility - 1.4) * 0.4,
    "sig.support.prototypeAgreement": 0.72 + (compatibility - 1.4) * 0.08,
    "sig.support.featureCoverage": 0.74,
    "sig.support.nearShare": 0.72,
    "sig.supportMetric.score": compatibility + 0.15,
    "sig.supportMetric.coverageAdjustedMargin": margin * 0.8,
    "sig.supportMetric.agreementDistanceRatio": 2.2 + (compatibility - 1.4) * 0.7,
    "sig.supportMetric.densityMarginGap": 1.2 + margin,
    "sig.supportMetric.prototypeCloseness": 0.74 + (compatibility - 1.4) * 0.06,
    "sig.supportMetric.supportCompatibility": compatibility,
  },
})

const makeNegative = (id, symbol, dateKey, foldId, windowId, compatibility) => ({
  sourceId: id,
  symbol,
  dateKey,
  outcomeHitTarget: false,
  foldId,
  windowId,
  categoricalTokens: [
    compatibility > 0.7
      ? "tag:lowGapTop.gapContinuationRegime:GAP_STABLE"
      : "tag:lowGapTop.gapContinuationRegime:GAP_FADE",
    compatibility > 0.7 ? "sig:support.clusterCell:MIXED" : "sig:support.clusterCell:OUTLIER",
  ],
  numericFeatureMap: {
    "sig.support.posDistance": 1.2 - compatibility * 0.15,
    "sig.support.maxDistance": 1.4 - compatibility * 0.12,
    "sig.support.margin": -0.45 + compatibility * 0.18,
    "sig.support.densityRatio": 0.55 + compatibility * 0.2,
    "sig.support.prototypeAgreement": 0.18 + compatibility * 0.12,
    "sig.support.featureCoverage": 0.46,
    "sig.support.nearShare": 0.28,
    "sig.supportMetric.score": compatibility - 0.4,
    "sig.supportMetric.coverageAdjustedMargin": (-0.45 + compatibility * 0.18) * 0.46,
    "sig.supportMetric.agreementDistanceRatio": 0.55 + compatibility * 0.5,
    "sig.supportMetric.densityMarginGap": 0.1 + compatibility * 0.2,
    "sig.supportMetric.prototypeCloseness": 0.4 + compatibility * 0.08,
    "sig.supportMetric.supportCompatibility": compatibility,
  },
})

const trainRows = [
  makePositive("p1", "111111", "2024-01-02", 1, 1, 1.95, 0.92),
  makePositive("p2", "222222", "2024-02-05", 1, 1, 1.9, 0.88),
  makePositive("p3", "333333", "2024-03-06", 2, 2, 1.82, 0.84),
  makePositive("p4", "444444", "2024-04-08", 2, 2, 1.8, 0.82),
  makePositive("p5", "555555", "2024-05-07", 3, 3, 1.75, 0.8),
  makePositive("p6", "666666", "2024-06-10", 3, 3, 1.74, 0.79),
  makePositive("p7", "777777", "2024-07-09", 4, 4, 1.78, 0.81),
  makePositive("p8", "888888", "2024-08-09", 4, 4, 1.83, 0.85),
  makePositive("p9", "999999", "2024-09-10", 4, 5, 1.86, 0.87),
  makePositive("p10", "121212", "2024-10-11", 4, 6, 1.9, 0.9),
  makeNegative("n1", "131313", "2024-01-15", 1, 1, 0.9),
  makeNegative("n2", "141414", "2024-04-15", 2, 2, 0.25),
]

const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
  familyId: "low_gap_top_continuation",
  trainRows,
  oosRows: [],
  supportCases,
})
const candidateSpace = buildPerfectPrototypeSupportPrototypeRouterCandidateSpace({ cohort })
const solution = calibratePerfectPrototypeSupportPrototypeRouter({
  cohort,
  candidateSpace,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
})

assert.equal(solution.ok, true)
assert.ok(solution.routerHistoricalSupportMatchedCount > 0)

const evaluations = applyPerfectPrototypeSupportPrototypeRouter({
  artifact: solution.artifact,
  rows: cohort.trainRows,
})
const summary = summarizePerfectPrototypeSupportPrototypeRouterSelections({
  evaluations,
  supportCaseIds: solution.artifact.supportCaseIds,
})

assert.equal(Number(summary.crossfitNegativeWindowCount ?? 0), 0)
assert.ok(Number(summary.crossfitPositiveWindowCount ?? 0) >= 2)
assert.ok(Number(summary.trainMatchedDateCount ?? 0) >= 10)
assert.equal(Number(summary.negativeRowCount ?? 0), 0)

console.log("ok: support prototype router calibrate")
