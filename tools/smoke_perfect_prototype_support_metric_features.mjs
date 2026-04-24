import assert from "node:assert/strict"

import {
  buildPerfectPrototypeSupportMetricFeatures,
} from "../src/lib/perfect_prototype_support_metric_features.mjs"

const features = buildPerfectPrototypeSupportMetricFeatures({
  signatureMetrics: {
    posDistance: 0.22,
    margin: 0.9,
    densityRatio: 1.4,
    featureCoverage: 0.8,
    agreementShare: 0.85,
    nearShare: 0.75,
  },
})

assert.ok(Number.isFinite(Number(features.numericFeatureMap["sig.supportMetric.score"])))
assert.ok(
  features.categoricalTokens.some((token) => token.startsWith("sig:supportMetric.score:")),
)
assert.ok(
  features.categoricalTokens.some((token) =>
    token.startsWith("sig:supportMetric.compatibility:"),
  ),
)

console.log("ok")
