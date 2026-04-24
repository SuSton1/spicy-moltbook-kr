import assert from "node:assert/strict"

import {
  PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  buildPerfectPrototypeSupportCaseFamilyLookup,
  evaluatePerfectPrototypeRuleSupportCases,
  normalizePerfectPrototypeSupportCases,
} from "../src/lib/perfect_prototype_support_case.mjs"

const supportCases = normalizePerfectPrototypeSupportCases([
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    familyIds: ["low_gap_top_continuation"],
    tokens: [
      "tag:xsec.closeRank:LOW",
      "tag:xsec.gapRank:TOP",
      "tag:stepa.lane:recent_impulse_1d",
      "num:feature.gap.closeVsPrevClose:B05",
    ],
    donorRuleIds: ["PP_DONOR"],
    donorTokens: [
      "num:feature.gap.closeVsPrevClose:B05",
      "num:xsec.gapRankPct:B05",
    ],
  },
])

assert.equal(PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID, "haesung_low_gap_top_oos100_v1")
assert.equal(supportCases.length, 1)

const familyLookup = buildPerfectPrototypeSupportCaseFamilyLookup(supportCases)
assert.deepEqual(Array.from(familyLookup.get("low_gap_top_continuation")?.caseIds ?? []), [
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
])
assert.deepEqual(Array.from(familyLookup.get("low_gap_top_continuation")?.donorRuleIds ?? []), [
  "PP_DONOR",
])
assert.deepEqual(
  Array.from(familyLookup.get("low_gap_top_continuation")?.donorTokenSet ?? []).sort(),
  ["num:feature.gap.closeVsPrevClose:B05", "num:xsec.gapRankPct:B05"],
)

const supportedRule = {
  familyId: "low_gap_top_continuation",
  tokens: [
    "tag:xsec.gapRank:TOP",
    "num:feature.gap.closeVsPrevClose:B05",
  ],
}
const unsupportedRule = {
  familyId: "low_gap_high_continuation",
  tokens: ["tag:xsec.gapRank:HIGH"],
}

const supported = evaluatePerfectPrototypeRuleSupportCases({
  rule: supportedRule,
  supportCases,
})
const unsupported = evaluatePerfectPrototypeRuleSupportCases({
  rule: unsupportedRule,
  supportCases,
})

assert.equal(supported.matchesSupportCases, true)
assert.equal(supported.haesungSupport, true)
assert.deepEqual(supported.supportCaseIds, [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID])
assert.equal(unsupported.matchesSupportCases, false)
assert.equal(unsupported.haesungSupport, false)
assert.deepEqual(unsupported.supportCaseIds, [])

console.log("ok")
