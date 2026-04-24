import assert from "node:assert/strict"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportScorecardTermBank } from "../src/lib/perfect_prototype_support_scorecard_term_bank.mjs"
import { solvePerfectPrototypeSupportScorecard } from "../src/lib/perfect_prototype_support_scorecard_solver.mjs"

const supportCases = [
  {
    caseId: "076610:2026-03-18",
    symbol: "076610",
    dateKey: "2026-03-18",
    familyIds: ["low_gap_top_continuation"],
    tokens: ["tag:lowGapTop.gapContinuationRegime:GAP_STABLE"],
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
      "tag:event.gapProfile:GAP_DOMINANT",
      "sig:support.clusterCell:CORE",
      "sig:supportMetric.compatibility:STRONG",
    ],
    donorRuleIds: [],
    donorTokens: [],
    numericFeatureMap: {
      "sig.support.posDistance": 0.16,
      "sig.support.margin": 0.94,
      "sig.support.prototypeAgreement": 0.86,
      "sig.support.featureCoverage": 0.82,
      "sig.support.nearShare": 0.8,
      "sig.supportMetric.score": 2.0,
      "sig.supportMetric.supportCompatibility": 2.2,
      "sig.supportMetric.prototypeCloseness": 0.85,
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
    compatibility >= 1.6 ? "sig:supportMetric.compatibility:STRONG" : "sig:supportMetric.compatibility:MID",
    margin >= 0.7 ? "sig:support.clusterCell:CORE" : "sig:support.clusterCell:EDGE",
  ],
  numericFeatureMap: {
    "sig.support.posDistance": 0.2 + (2 - compatibility) * 0.1,
    "sig.support.margin": margin,
    "sig.support.prototypeAgreement": 0.78,
    "sig.support.featureCoverage": 0.8,
    "sig.support.nearShare": 0.75,
    "sig.supportMetric.score": compatibility,
    "sig.supportMetric.supportCompatibility": compatibility,
    "sig.supportMetric.prototypeCloseness": 0.8,
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
    compatibility > 0.7 ? "sig:supportMetric.compatibility:MID" : "sig:supportMetric.compatibility:WEAK",
  ],
  numericFeatureMap: {
    "sig.support.posDistance": 1.3 - compatibility * 0.2,
    "sig.support.margin": -0.4 + compatibility * 0.2,
    "sig.support.prototypeAgreement": 0.25,
    "sig.support.featureCoverage": 0.45,
    "sig.support.nearShare": 0.25,
    "sig.supportMetric.score": compatibility - 0.5,
    "sig.supportMetric.supportCompatibility": compatibility,
    "sig.supportMetric.prototypeCloseness": 0.35,
  },
})

const trainRows = [
  makePositive("p1", "111111", "2024-01-02", 1, 1, 1.9, 0.9),
  makePositive("p2", "222222", "2024-02-05", 1, 1, 1.8, 0.85),
  makePositive("p3", "333333", "2024-03-06", 2, 2, 1.7, 0.82),
  makePositive("p4", "444444", "2024-04-08", 2, 2, 1.7, 0.78),
  makePositive("p5", "555555", "2024-05-07", 3, 3, 1.6, 0.76),
  makePositive("p6", "666666", "2024-06-10", 3, 3, 1.6, 0.74),
  makePositive("p7", "777777", "2024-07-09", 4, 4, 1.6, 0.75),
  makePositive("p8", "888888", "2024-08-09", 4, 4, 1.7, 0.8),
  makePositive("p9", "999999", "2024-09-10", 4, 5, 1.8, 0.83),
  makePositive("p10", "121212", "2024-10-11", 4, 6, 1.85, 0.86),
  makeNegative("n1", "131313", "2024-01-15", 1, 1, 0.9),
  makeNegative("n2", "141414", "2024-04-15", 2, 2, 0.2),
]

const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
  familyId: "low_gap_top_continuation",
  trainRows,
  oosRows: [],
  supportCases,
})
const termBank = buildPerfectPrototypeSupportScorecardTermBank({ cohort })
const solution = solvePerfectPrototypeSupportScorecard({
  cohort,
  termBank,
})

assert.equal(solution.ok, true)
assert.ok(solution.scorecardHistoricalSupportMatchedCount > 0)
assert.ok(Number(solution.trainSummary.trainMatchedDateCount ?? 0) >= 10)
assert.equal(Number(solution.trainSummary.crossfitNegativeWindowCount ?? 0), 0)
assert.ok(Number(solution.trainSummary.crossfitPositiveWindowCount ?? 0) >= 2)

console.log("ok: support scorecard solver")
