const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const classifyBand = (value, thresholds, labels) => {
  const numeric = num(value)
  if (!Number.isFinite(numeric)) return null
  for (let index = 0; index < thresholds.length; index += 1) {
    if (numeric <= thresholds[index]) return labels[index] ?? null
  }
  return labels[labels.length - 1] ?? null
}

export const buildPerfectPrototypeSupportMetricFeatures = ({
  signatureMetrics = null,
} = {}) => {
  const posDistance = num(signatureMetrics?.posDistance)
  const margin = num(signatureMetrics?.margin)
  const densityRatio = num(signatureMetrics?.densityRatio)
  const featureCoverage = num(signatureMetrics?.featureCoverage)
  const agreementShare = num(signatureMetrics?.agreementShare)
  const nearShare = num(signatureMetrics?.nearShare)

  const score =
    Number(agreementShare ?? 0) +
    Number(nearShare ?? 0) +
    Math.min(1.5, Number(densityRatio ?? 0)) -
    Number(posDistance ?? 0)
  const coverageAdjustedMargin =
    Number.isFinite(margin) && Number.isFinite(featureCoverage)
      ? margin * featureCoverage
      : null
  const agreementDistanceRatio = safeDiv(
    Number(agreementShare ?? 0) + Number(nearShare ?? 0),
    Math.max(0.2, Number(posDistance ?? 0.2)),
  )
  const densityMarginGap =
    Number.isFinite(densityRatio) && Number.isFinite(margin)
      ? densityRatio + margin
      : null
  const prototypeCloseness =
    Number.isFinite(posDistance) ? 1 / (1 + Math.max(0, posDistance)) : null
  const supportCompatibility =
    Number.isFinite(coverageAdjustedMargin) && Number.isFinite(agreementDistanceRatio)
      ? coverageAdjustedMargin + agreementDistanceRatio
      : null

  const numericFeatureMap = Object.fromEntries(
    Object.entries({
      "sig.supportMetric.score": score,
      "sig.supportMetric.coverageAdjustedMargin": coverageAdjustedMargin,
      "sig.supportMetric.agreementDistanceRatio": agreementDistanceRatio,
      "sig.supportMetric.densityMarginGap": densityMarginGap,
      "sig.supportMetric.prototypeCloseness": prototypeCloseness,
      "sig.supportMetric.supportCompatibility": supportCompatibility,
    }).filter(([, value]) => Number.isFinite(num(value))),
  )

  const scoreBand = classifyBand(
    score,
    [-0.25, 0.5, 1.25],
    ["NEG", "MIXED", "POS", "STRONG_POS"],
  )
  const coverageBand = classifyBand(
    featureCoverage,
    [0.35, 0.7],
    ["LOW", "MID", "HIGH"],
  )
  const closenessBand = classifyBand(
    prototypeCloseness,
    [0.35, 0.6],
    ["LOW", "MID", "HIGH"],
  )
  const compatibilityBand = classifyBand(
    supportCompatibility,
    [0.5, 1.5],
    ["WEAK", "MID", "STRONG"],
  )

  const categoricalTokens = [
    scoreBand ? `sig:supportMetric.score:${scoreBand}` : null,
    coverageBand ? `sig:supportMetric.coverage:${coverageBand}` : null,
    closenessBand ? `sig:supportMetric.prototypeCloseness:${closenessBand}` : null,
    compatibilityBand ? `sig:supportMetric.compatibility:${compatibilityBand}` : null,
    Number(densityMarginGap ?? Number.NEGATIVE_INFINITY) >= 1
      ? "sig:supportMetric.densityMargin:STRONG"
      : Number(densityMarginGap ?? Number.NEGATIVE_INFINITY) >= 0
        ? "sig:supportMetric.densityMargin:POS"
        : "sig:supportMetric.densityMargin:NEG",
  ].filter(Boolean)

  return {
    numericFeatureMap,
    categoricalTokens,
    score: Number.isFinite(score) ? score : null,
    supportCompatibility:
      Number.isFinite(supportCompatibility) ? clamp(supportCompatibility, -10, 10) : null,
  }
}
