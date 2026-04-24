import assert from "node:assert/strict"

import {
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
} from "../src/lib/perfect_prototype_contextual_features.mjs"
import { tokenizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const spec = {
  surface: PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
  options: {
    binCount: 5,
    includeCategoricalTokens: true,
    enableIntervalAtoms: true,
    enableMacroAtoms: true,
    enableSupportAnchorAtoms: true,
  },
  numericFeatures: [
    { featureKey: "event.closeRetentionFromOpen", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "event.closeRetPct", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.gap.openPct", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.gap.fillRatio", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.gap.fillThenContinueScore", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.volume.lowVolumeCount3", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.volume.ratio40", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.trend.runUp10", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.trend.slope10", edges: [0.1, 0.2, 0.3, 0.4] },
    { featureKey: "feature.shape.sidewaysScore10", edges: [0.1, 0.2, 0.3, 0.4] },
  ],
}

const row = {
  dateKey: "2026-03-18",
  symbol: "076610",
  numericFeatureMap: {
    "event.closeRetentionFromOpen": 0.05,
    "event.closeRetPct": 0.05,
    "feature.gap.openPct": 0.45,
    "feature.gap.fillRatio": 0.05,
    "feature.gap.fillThenContinueScore": 0.05,
    "feature.volume.lowVolumeCount3": 0.05,
    "feature.volume.ratio40": 0.05,
    "feature.trend.runUp10": 0.25,
    "feature.trend.slope10": 0.25,
    "feature.shape.sidewaysScore10": 0.05,
  },
  categoricalTokens: ["tag:xsec.closeVsMedian:BELOW"],
}

const tokens = tokenizePerfectPrototypeRow(row, spec)

assert.ok(tokens.includes("num:event.closeRetentionFromOpen:B01"))
assert.ok(tokens.includes("ival:event.closeRetentionFromOpen:LE_B02"))
assert.ok(tokens.includes("ival:feature.gap.openPct:GE_B04"))
assert.ok(tokens.includes("macro:lowGapTop:RETENTION_WEAK_GAP_HIGH"))
assert.ok(tokens.includes("macro:lowGapTop:DRYUP_LIGHT"))
assert.ok(tokens.includes("macro:lowGapTop:TREND_COIL"))
assert.ok(tokens.includes("macro:lowGapTop:XSEC_PULLBACK"))
assert.ok(tokens.includes("tag:lowGapTop.supportAnchor:RET_GAP_DRYUP"))
assert.ok(tokens.includes("tag:lowGapTop.supportAnchor:XSEC_COIL"))

console.log("ok")
