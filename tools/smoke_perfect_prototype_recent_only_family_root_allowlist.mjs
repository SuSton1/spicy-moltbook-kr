import assert from "node:assert/strict"

import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  buildPerfectPrototypeRecentOnlyFamilyScopeSpec,
  isPerfectPrototypeContinuationFamilyRootTokenAllowed,
  scorePerfectPrototypeContinuationFamilyRootTokenPriority,
} from "../src/lib/perfect_prototype_rule_family_spec.mjs"
import { shouldRequirePerfectPrototypeIndexedLaneMeta } from "../src/lib/perfect_prototype_indexed_miner.mjs"

const families = [
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
]

for (const familyId of families) {
  const scopeSpec = buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId)
  assert.equal(scopeSpec.requiredLaneId, "recent_impulse_1d")
  assert.deepEqual(scopeSpec.excludedPositiveTokens, ["tag:xsecLane.pool:THIN_POOL"])
  assert.equal(scopeSpec.requiredPositiveTokens.length, 1)
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "tag:xsec.gapRank:TOP",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "tag:xsecLane.closeRank:HIGH",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.gap.closeVsPrevClose:B05",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.pattern.closeClusterTightness5:B05",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.shape.compression20:B05",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.volume.exhaustionProxy:B05",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.volume.ratio5Over20:B03",
    }),
    true,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:feature.volume.tradingValueToMarketCap:B01",
    }),
    false,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "num:seq150.stdev:B05",
    }),
    false,
  )
  assert.equal(
    isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId,
      token: "tag:stepa.lane:recent_impulse_1d",
    }),
    false,
  )
  assert.equal(
    scorePerfectPrototypeContinuationFamilyRootTokenPriority({
      familyId,
      token: "tag:xsec.gapRank:TOP",
    }),
    2,
  )
  assert.equal(
    scorePerfectPrototypeContinuationFamilyRootTokenPriority({
      familyId,
      token: "num:feature.shape.compression20:B05",
    }),
    1,
  )
}

assert.equal(
  shouldRequirePerfectPrototypeIndexedLaneMeta({
    cfg: {
      enableLaneStratifiedMining: false,
      surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
    },
    datasetContract: {
      discoveryUniverseId: "recent_impulse_upto_1d",
    },
  }),
  true,
)

assert.equal(
  shouldRequirePerfectPrototypeIndexedLaneMeta({
    cfg: {
      enableLaneStratifiedMining: false,
      surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
    },
    datasetContract: {
      discoveryUniverseId: "same_day_plus_recent_upto_1d",
    },
  }),
  false,
)

console.log("ok")
