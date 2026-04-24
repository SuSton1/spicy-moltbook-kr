import assert from "node:assert/strict"

import {
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  normalizePerfectPrototypeRow,
  buildPerfectPrototypeTokenizerSpec,
  tokenizePerfectPrototypeRow,
} from "../src/lib/perfect_prototype_tokenizer.mjs"
import { countPerfectPrototypeAtomTypes } from "../src/lib/perfect_prototype_support_anchor_cohort.mjs"

const supportRow = {
  symbol: "076610",
  dateKey: "2026-03-18",
  outcomeHitTarget: true,
  featureVec: {
    "candle.bodyPct": 0.28,
    "candle.lowerWickPct": 0.11,
    "candle.upperWickPct": 0.07,
    "gap.fillRatio": 0.18,
    "trend.runUp10": 0.12,
    "trend.slope10": 0.03,
    "volume.lowVolumeCount3": 1,
    "volume.ratio40": 0.74,
  },
  eventFeatureVec: {
    closeRetentionFromOpen: 0.34,
    closeRetPct: 0.021,
    gapOpenPct: 0.082,
    jumpPctFromOpen: 0.037,
  },
  marketContextVec: {
    absGapMedian: 0.041,
  },
  xsecEventVec: {
    closeRankPct: 0.18,
  },
  contextualTokens: [
    "tag:xsec.closeRank:LOW",
    "tag:xsec.closeVsMedian:BELOW",
    "tag:event.gapProfile:GAP_DOMINANT",
    "tag:event.closeStrength:FADE",
    "tag:lowGapTop.retentionRegime:WEAK",
  ],
}

const nearRow = {
  ...supportRow,
  symbol: "111111",
  dateKey: "2026-03-19",
}

const supportNormalized = normalizePerfectPrototypeRow(supportRow, {})
const supportSignatureConfig = buildPerfectPrototypeSupportSignatureTokenizerConfig({
  familyId: "low_gap_top_continuation",
  supportCases: [
    {
      caseId: "076610:2026-03-18",
      symbol: "076610",
      dateKey: "2026-03-18",
      familyIds: ["low_gap_top_continuation"],
      tokens: ["seed:support_signature"],
      categoricalTokens: supportNormalized.categoricalTokens,
      numericFeatureMap: supportNormalized.numericFeatureMap,
    },
  ],
})

assert.ok(supportSignatureConfig)
assert.ok(Array.isArray(supportSignatureConfig.featureKeys))
assert.ok(supportSignatureConfig.featureKeys.length > 0)

const tokenizerOptions = {
  enableSupportManifoldSignature: true,
  enableAdaptiveThresholdAtoms: true,
  supportSignatureConfig,
}

const normalizedRows = [
  normalizePerfectPrototypeRow(supportRow, tokenizerOptions),
  normalizePerfectPrototypeRow(nearRow, tokenizerOptions),
]
const spec = buildPerfectPrototypeTokenizerSpec(normalizedRows, tokenizerOptions)
const tokens = tokenizePerfectPrototypeRow(nearRow, spec, tokenizerOptions)
const atomCounts = countPerfectPrototypeAtomTypes(tokens)

assert.ok(tokens.some((token) => token.startsWith("sig:support.clusterCell:")))
assert.ok(tokens.some((token) => token.startsWith("sig:support.margin:")))
assert.ok(tokens.some((token) => token.includes(":LE_T") || token.includes(":GE_T")))
assert.ok(Number(atomCounts.support_signature ?? 0) > 0)
assert.ok(Number(atomCounts.adaptive_threshold ?? 0) > 0)

console.log("ok")
