import assert from "node:assert/strict"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportPrototypeRouterCandidateSpace } from "../src/lib/perfect_prototype_support_prototype_router_builder.mjs"

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
      "sig.support.posDistance": 0.18,
      "sig.support.maxDistance": 0.34,
      "sig.support.margin": 0.88,
      "sig.support.densityRatio": 1.7,
      "sig.support.prototypeAgreement": 0.85,
      "sig.support.featureCoverage": 0.8,
      "sig.support.nearShare": 0.8,
      "sig.supportMetric.score": 1.9,
      "sig.supportMetric.coverageAdjustedMargin": 0.72,
      "sig.supportMetric.agreementDistanceRatio": 3.3,
      "sig.supportMetric.densityMarginGap": 2.0,
      "sig.supportMetric.prototypeCloseness": 0.84,
      "sig.supportMetric.supportCompatibility": 2.15,
    },
    supportSignatureFeatureKeys: [],
  },
]

const makeRow = ({ id, symbol, dateKey, hit, extraTokens = [], numericFeatureMap = {} }) => ({
  sourceId: id,
  symbol,
  dateKey,
  outcomeHitTarget: hit,
  categoricalTokens: [
    "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
    "tag:event.gapProfile:GAP_DOMINANT",
    ...extraTokens,
  ],
  numericFeatureMap,
})

const trainRows = [
  makeRow({
    id: "p1",
    symbol: "111111",
    dateKey: "2024-01-03",
    hit: true,
    extraTokens: ["sig:support.clusterCell:CORE"],
    numericFeatureMap: {
      "sig.support.posDistance": 0.2,
      "sig.support.maxDistance": 0.4,
      "sig.support.margin": 0.82,
      "sig.support.densityRatio": 1.55,
      "sig.support.prototypeAgreement": 0.78,
      "sig.support.featureCoverage": 0.8,
      "sig.support.nearShare": 0.75,
      "sig.supportMetric.score": 1.72,
      "sig.supportMetric.coverageAdjustedMargin": 0.64,
      "sig.supportMetric.agreementDistanceRatio": 2.95,
      "sig.supportMetric.densityMarginGap": 1.84,
      "sig.supportMetric.prototypeCloseness": 0.81,
      "sig.supportMetric.supportCompatibility": 1.98,
    },
  }),
  makeRow({
    id: "p2",
    symbol: "222222",
    dateKey: "2024-02-06",
    hit: true,
    extraTokens: ["sig:support.clusterCell:EDGE"],
    numericFeatureMap: {
      "sig.support.posDistance": 0.28,
      "sig.support.maxDistance": 0.48,
      "sig.support.margin": 0.68,
      "sig.support.densityRatio": 1.35,
      "sig.support.prototypeAgreement": 0.72,
      "sig.support.featureCoverage": 0.74,
      "sig.support.nearShare": 0.71,
      "sig.supportMetric.score": 1.48,
      "sig.supportMetric.coverageAdjustedMargin": 0.52,
      "sig.supportMetric.agreementDistanceRatio": 2.42,
      "sig.supportMetric.densityMarginGap": 1.55,
      "sig.supportMetric.prototypeCloseness": 0.74,
      "sig.supportMetric.supportCompatibility": 1.73,
    },
  }),
  makeRow({
    id: "n1",
    symbol: "333333",
    dateKey: "2024-03-07",
    hit: false,
    extraTokens: ["sig:support.clusterCell:MIXED"],
    numericFeatureMap: {
      "sig.support.posDistance": 0.95,
      "sig.support.maxDistance": 1.3,
      "sig.support.margin": -0.1,
      "sig.support.densityRatio": 0.8,
      "sig.support.prototypeAgreement": 0.4,
      "sig.support.featureCoverage": 0.55,
      "sig.support.nearShare": 0.4,
      "sig.supportMetric.score": 0.3,
      "sig.supportMetric.coverageAdjustedMargin": -0.05,
      "sig.supportMetric.agreementDistanceRatio": 0.9,
      "sig.supportMetric.densityMarginGap": 0.7,
      "sig.supportMetric.prototypeCloseness": 0.52,
      "sig.supportMetric.supportCompatibility": 0.74,
    },
  }),
  makeRow({
    id: "n2",
    symbol: "444444",
    dateKey: "2024-04-08",
    hit: false,
    extraTokens: ["sig:support.clusterCell:OUTLIER"],
    numericFeatureMap: {
      "sig.support.posDistance": 1.45,
      "sig.support.maxDistance": 1.7,
      "sig.support.margin": -0.45,
      "sig.support.densityRatio": 0.45,
      "sig.support.prototypeAgreement": 0.18,
      "sig.support.featureCoverage": 0.42,
      "sig.support.nearShare": 0.24,
      "sig.supportMetric.score": -0.25,
      "sig.supportMetric.coverageAdjustedMargin": -0.18,
      "sig.supportMetric.agreementDistanceRatio": 0.42,
      "sig.supportMetric.densityMarginGap": 0.0,
      "sig.supportMetric.prototypeCloseness": 0.34,
      "sig.supportMetric.supportCompatibility": 0.28,
    },
  }),
]

const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
  familyId: "low_gap_top_continuation",
  trainRows,
  oosRows: [],
  supportCases,
})
const candidateSpace = buildPerfectPrototypeSupportPrototypeRouterCandidateSpace({ cohort })

assert.ok(candidateSpace.summary.routerFeatureCandidateCount > 0)
assert.ok(candidateSpace.summary.routerThresholdCandidateCount > 0)
assert.ok(candidateSpace.featureCandidates.some((entry) => entry.featureKey === "sig.support.margin"))

console.log("ok: support prototype router builder")
