const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const collectCandidateFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter(
        (featureKey) =>
          featureKey.startsWith("sig.bridge.") ||
          featureKey.startsWith("sig.boundary.") ||
          featureKey.startsWith("sig.recurBoundary.") ||
          featureKey.startsWith("sig.ordinalMotif."),
      ),
    ),
  )

const featureBucketOf = (featureKey) => {
  const text = String(featureKey ?? "")
  const groupMatch = text.match(/^sig\.(bridge|boundary|recurBoundary)\.group\.([^.]+)\./)
  if (groupMatch) return `${groupMatch[1]}:group:${groupMatch[2]}`
  const ordinalGroupMatch = text.match(/^sig\.ordinalMotif\.group\.([^.]+)\./)
  if (ordinalGroupMatch) return `ordinalMotif:group:${ordinalGroupMatch[1]}`
  const topLevel = text.split(".").slice(0, 3).join(".")
  return topLevel || text
}

export const scorePerfectPrototypeSupportCorridorMetricDistance = ({
  left,
  right,
  featureEntries = [],
} = {}) => {
  let total = 0
  let weightTotal = 0
  for (const feature of Array.isArray(featureEntries) ? featureEntries : []) {
    const leftValue = num(left?.numericFeatureMap?.[feature?.featureKey])
    const rightValue = num(right?.numericFeatureMap?.[feature?.featureKey])
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue
    const scale = Math.max(0.05, Number(feature?.scale ?? 1))
    const weight = Math.max(0.05, Number(feature?.weight ?? 1))
    total += weight * (Math.abs(leftValue - rightValue) / scale)
    weightTotal += weight
  }
  if (weightTotal <= 0) return Number.POSITIVE_INFINITY
  return total / weightTotal
}

export const buildPerfectPrototypeSupportCorridorMetricLearning = ({
  family,
  maxFeatureCount = 24,
  minFeatureSupportCount = 6,
  maxBucketCount = 3,
} = {}) => {
  const positiveRows = Array.isArray(family?.graphPositiveReferenceRows)
    ? family.graphPositiveReferenceRows
    : Array.isArray(family?.graphPositiveSeedRows)
      ? family.graphPositiveSeedRows
      : []
  const negativeRows = Array.isArray(family?.graphNegativeReferenceRows)
    ? family.graphNegativeReferenceRows
    : Array.isArray(family?.graphNegativeSeedRows)
      ? family.graphNegativeSeedRows
      : []
  const candidateFeatureKeys = collectCandidateFeatureKeys([
    ...positiveRows,
    ...negativeRows,
    ...(Array.isArray(family?.supportCaseViews) ? family.supportCaseViews : []),
  ])

  const scored = []
  const requiredPositiveSupport = Math.max(
    2,
    Math.min(
      positiveRows.length,
      Math.max(3, Math.floor(Number(minFeatureSupportCount) || 6) - 1),
    ),
  )
  const requiredNegativeSupport = Math.max(
    2,
    Math.min(
      negativeRows.length,
      Math.max(3, Math.floor(Number(minFeatureSupportCount) || 6) - 1),
    ),
  )
  for (const featureKey of candidateFeatureKeys) {
    const positiveValues = positiveRows
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    const negativeValues = negativeRows
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    if (positiveValues.length < requiredPositiveSupport || negativeValues.length < requiredNegativeSupport) {
      continue
    }
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const scale = Math.max(
      0.05,
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
      Math.abs(positiveMean - negativeMean),
    )
    const separation = Math.abs(positiveMean - negativeMean) / scale
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      bucket: featureBucketOf(featureKey),
      weight: Math.max(0.1, Math.min(4, separation)),
      scale,
      separation,
      positiveMean,
      negativeMean,
    })
  }

  scored.sort((left, right) => {
    if (right.separation !== left.separation) return right.separation - left.separation
    return left.featureKey.localeCompare(right.featureKey)
  })

  const selected = []
  const bucketCounts = new Map()
  for (const feature of scored) {
    const count = Number(bucketCounts.get(feature.bucket) ?? 0)
    if (count >= Math.max(1, Math.floor(Number(maxBucketCount) || 3))) continue
    selected.push(feature)
    bucketCounts.set(feature.bucket, count + 1)
    if (selected.length >= Math.max(1, Math.floor(Number(maxFeatureCount) || 24))) break
  }

  const ok = selected.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_corridor_metric_features",
    corridorFeatureEntries: selected,
    corridorFeatureKeys: selected.map((entry) => entry.featureKey),
    summary: {
      ...(family?.summary ?? {}),
      corridorMetricReady: ok,
      corridorMetricReason: ok ? null : "unsat_no_corridor_metric_features",
      corridorFeatureCount: selected.length,
      corridorMetricPositiveReferenceCount: positiveRows.length,
      corridorMetricNegativeReferenceCount: negativeRows.length,
      corridorMetricRequiredPositiveSupport: requiredPositiveSupport,
      corridorMetricRequiredNegativeSupport: requiredNegativeSupport,
      corridorFeaturePreview: selected.slice(0, 8).map((entry) => ({
        featureKey: entry.featureKey,
        separation: entry.separation,
        weight: entry.weight,
      })),
    },
  }
}
