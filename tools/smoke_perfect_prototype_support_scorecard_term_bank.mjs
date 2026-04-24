import assert from "node:assert/strict"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportScorecardTermBank } from "../src/lib/perfect_prototype_support_scorecard_term_bank.mjs"

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
    ],
    donorRuleIds: [],
    donorTokens: [],
    numericFeatureMap: {
      "sig.support.posDistance": 0.18,
      "sig.support.margin": 0.92,
      "sig.support.prototypeAgreement": 0.85,
      "sig.support.featureCoverage": 0.8,
      "sig.support.nearShare": 0.8,
      "sig.supportMetric.score": 1.8,
      "sig.supportMetric.supportCompatibility": 2.1,
      "sig.supportMetric.prototypeCloseness": 0.82,
    },
    supportSignatureFeatureKeys: [],
  },
]

const trainRows = [
  {
    sourceId: "p1",
    symbol: "111111",
    dateKey: "2024-01-02",
    outcomeHitTarget: true,
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
      "tag:event.gapProfile:GAP_DOMINANT",
      "sig:support.clusterCell:CORE",
      "sig:supportMetric.compatibility:STRONG",
    ],
    numericFeatureMap: {
      "sig.support.posDistance": 0.2,
      "sig.support.margin": 0.8,
      "sig.support.prototypeAgreement": 0.8,
      "sig.support.featureCoverage": 0.78,
      "sig.support.nearShare": 0.75,
      "sig.supportMetric.score": 1.7,
      "sig.supportMetric.supportCompatibility": 1.9,
      "sig.supportMetric.prototypeCloseness": 0.8,
    },
  },
  {
    sourceId: "p2",
    symbol: "222222",
    dateKey: "2024-02-02",
    outcomeHitTarget: true,
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
      "tag:event.gapProfile:GAP_DOMINANT",
      "sig:support.clusterCell:EDGE",
      "sig:supportMetric.compatibility:STRONG",
    ],
    numericFeatureMap: {
      "sig.support.posDistance": 0.28,
      "sig.support.margin": 0.7,
      "sig.support.prototypeAgreement": 0.7,
      "sig.support.featureCoverage": 0.7,
      "sig.support.nearShare": 0.7,
      "sig.supportMetric.score": 1.5,
      "sig.supportMetric.supportCompatibility": 1.7,
      "sig.supportMetric.prototypeCloseness": 0.72,
    },
  },
  {
    sourceId: "n1",
    symbol: "333333",
    dateKey: "2024-03-04",
    outcomeHitTarget: false,
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_FADE",
      "sig:support.clusterCell:MIXED",
      "sig:supportMetric.compatibility:WEAK",
    ],
    numericFeatureMap: {
      "sig.support.posDistance": 1.4,
      "sig.support.margin": -0.6,
      "sig.support.prototypeAgreement": 0.2,
      "sig.support.featureCoverage": 0.4,
      "sig.support.nearShare": 0.2,
      "sig.supportMetric.score": -0.4,
      "sig.supportMetric.supportCompatibility": 0.2,
      "sig.supportMetric.prototypeCloseness": 0.3,
    },
  },
  {
    sourceId: "n2",
    symbol: "444444",
    dateKey: "2024-04-04",
    outcomeHitTarget: false,
    categoricalTokens: [
      "tag:lowGapTop.gapContinuationRegime:GAP_FADE",
      "sig:support.clusterCell:OUTLIER",
      "sig:supportMetric.compatibility:WEAK",
    ],
    numericFeatureMap: {
      "sig.support.posDistance": 1.1,
      "sig.support.margin": -0.4,
      "sig.support.prototypeAgreement": 0.25,
      "sig.support.featureCoverage": 0.45,
      "sig.support.nearShare": 0.25,
      "sig.supportMetric.score": -0.2,
      "sig.supportMetric.supportCompatibility": 0.3,
      "sig.supportMetric.prototypeCloseness": 0.35,
    },
  },
]

const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
  familyId: "low_gap_top_continuation",
  trainRows,
  oosRows: [],
  supportCases,
})
const termBank = buildPerfectPrototypeSupportScorecardTermBank({ cohort })

assert.ok(termBank.summary.scorecardTermCandidateCount > 0)
assert.ok(termBank.summary.scorecardTermQualifiedCount > 0)
assert.ok(termBank.summary.supportAnchorTermCount > 0)
assert.ok(termBank.summary.breadthExtenderTermCount > 0)

console.log("ok: support scorecard term bank")

