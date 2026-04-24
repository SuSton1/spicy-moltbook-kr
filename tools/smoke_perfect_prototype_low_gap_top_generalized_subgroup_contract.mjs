import assert from "node:assert/strict"

import {
  buildPerfectPrototypeLowGapTopGeneralizationTagTokens,
  isPerfectPrototypeLowGapTopGeneralizedRootToken,
  scorePerfectPrototypeLowGapTopSubgroupCandidate,
  shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass,
} from "../src/lib/perfect_prototype_subgroup_prepass.mjs"

const tokens = buildPerfectPrototypeLowGapTopGeneralizationTagTokens({
  featureVec: {
    "volume.dryUp20Over40": 1.2,
    "volume.ratio40": 0.85,
    "volume.exhaustionProxy": 0.08,
    "trend.runUp10": 0.14,
    "trend.slope10": 0.004,
    "trend.closeOverMa10": 0.03,
    "volume.marketCapLog": 18.2,
    "candle.bodyPct": 0.38,
    "candle.lowerWickPct": 0.21,
  },
  eventFeatureVec: {
    gapContributionShare: 0.72,
    closeRetentionFromPrevClose: 0.81,
    closeRetentionFromOpen: 0.61,
  },
  xsecEventVec: {
    absGapRankPct: 0.94,
    closeRankPct: 0.22,
  },
})

assert(tokens.some((token) => token.startsWith("tag:lowGapTop.retentionRegime:")))
assert(tokens.some((token) => token.startsWith("tag:lowGapTop.fpRisk:")))
assert.equal(
  isPerfectPrototypeLowGapTopGeneralizedRootToken("tag:lowGapTop.retentionRegime:STICKY"),
  true,
)
assert.equal(
  isPerfectPrototypeLowGapTopGeneralizedRootToken("num:market.positiveCloseShare:B05"),
  false,
)
assert.equal(
  shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
    familyId: "low_gap_top_continuation",
    enabled: true,
  }),
  true,
)
assert.equal(
  shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
    familyId: "mid_close_continuation",
    enabled: true,
  }),
  false,
)
assert(
  scorePerfectPrototypeLowGapTopSubgroupCandidate({
    positiveCount: 12,
    negativeCount: 0,
    familyCohortPositiveCount: 48,
    negativeUniverseCount: 96,
    hitStats: {
      distinctDateCount: 12,
      matchedMonthCount: 7,
      matchedFoldCount: 4,
      top1DateHitShare: 0.18,
    },
  }) > 0,
)

console.log("ok")
