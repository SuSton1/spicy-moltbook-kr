import assert from "node:assert/strict"

import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  buildPerfectPrototypeSupportCaseTargetedRootTokenSet,
  isPerfectPrototypeSupportCaseTargetedFamilyId,
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed,
} from "../src/lib/perfect_prototype_rule_family_spec.mjs"

assert.equal(
  isPerfectPrototypeSupportCaseTargetedFamilyId(
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  ),
  true,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "tag:xsec.gapRank:TOP",
  }),
  false,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "num:event.closeRetentionFromPrevClose:B05",
  }),
  true,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "num:feature.shape.breakoutDistance20:B01",
  }),
  true,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "num:xsec.gapRankPct:B05",
  }),
  true,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "num:feature.volume.ratio5Over20:B03",
  }),
  false,
)
assert.equal(
  isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    token: "num:market.positiveCloseShare:B05",
  }),
  false,
)

const constrainedRootTokens = buildPerfectPrototypeSupportCaseTargetedRootTokenSet({
  familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  tokens: [
    "tag:xsec.gapRank:TOP",
    "tag:xsec.closeVsMedian:BELOW",
    "num:event.closeRetentionFromPrevClose:B05",
    "num:feature.shape.breakoutDistance20:B01",
    "num:feature.candle.rangePct:B05",
    "num:xsec.gapRankPct:B05",
    "num:feature.volume.ratio5Over20:B03",
    "num:market.positiveCloseShare:B05",
  ],
})

assert.deepEqual(constrainedRootTokens, [
  "num:event.closeRetentionFromPrevClose:B05",
  "num:feature.candle.rangePct:B05",
  "num:feature.shape.breakoutDistance20:B01",
  "num:xsec.gapRankPct:B05",
  "tag:xsec.closeVsMedian:BELOW",
])

console.log("ok")
