const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

export const scorePerfectPrototypeSupportAtlasAnchorDistance = ({
  row,
  anchor,
  featureKeys = [],
  featureScales = {},
  featureWeights = {},
} = {}) => {
  const weightedDistances = []
  let totalWeight = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const anchorValue = num(anchor?.numericFeatureMap?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(anchorValue)) continue
    const scale = Math.max(0.05, num(featureScales?.[featureKey]) ?? 1)
    const weight = Math.max(0.1, num(featureWeights?.[featureKey]) ?? 1)
    weightedDistances.push((Math.abs(rowValue - anchorValue) / scale) * weight)
    totalWeight += weight
  }
  if (weightedDistances.length < 1 || totalWeight <= 0) return Number.POSITIVE_INFINITY
  return weightedDistances.reduce((sum, value) => sum + value, 0) / totalWeight
}

export const scorePerfectPrototypeSupportAtlasAnchorCover = ({
  row,
  positiveAnchors = [],
  negativeBorderAnchors = [],
  featureKeys = [],
  featureScales = {},
  featureWeights = {},
  kPositive = 2,
  kNegative = 1,
} = {}) => {
  const positiveDistances = (Array.isArray(positiveAnchors) ? positiveAnchors : [])
    .map((anchor) =>
      scorePerfectPrototypeSupportAtlasAnchorDistance({
        row,
        anchor,
        featureKeys,
        featureScales,
        featureWeights,
      }),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const negativeDistances = (Array.isArray(negativeBorderAnchors) ? negativeBorderAnchors : [])
    .map((anchor) =>
      scorePerfectPrototypeSupportAtlasAnchorDistance({
        row,
        anchor,
        featureKeys,
        featureScales,
        featureWeights,
      }),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  const positiveK = Math.max(1, Math.min(Math.floor(Number(kPositive) || 2), positiveDistances.length || 1))
  const negativeK = Math.max(1, Math.min(Math.floor(Number(kNegative) || 1), negativeDistances.length || 1))
  const positiveDistance = average(positiveDistances.slice(0, positiveK))
  const negativeDistance = average(negativeDistances.slice(0, negativeK))
  const margin =
    Number.isFinite(num(negativeDistance)) && Number.isFinite(num(positiveDistance))
      ? negativeDistance - positiveDistance
      : null
  const score =
    Number.isFinite(num(margin)) && Number.isFinite(num(positiveDistance))
      ? margin - positiveDistance
      : null

  return {
    positiveDistances,
    negativeDistances,
    positiveNearestDistance: positiveDistances[0] ?? null,
    positiveKDistance: positiveDistances[Math.max(0, positiveK - 1)] ?? positiveDistances[0] ?? null,
    negativeNearestDistance: negativeDistances[0] ?? null,
    positiveDistance: Number.isFinite(num(positiveDistance)) ? positiveDistance : null,
    negativeDistance: Number.isFinite(num(negativeDistance)) ? negativeDistance : null,
    margin: Number.isFinite(num(margin)) ? margin : null,
    score: Number.isFinite(num(score)) ? score : null,
  }
}
