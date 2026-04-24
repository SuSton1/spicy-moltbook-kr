const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const SUPPORT_COMPATIBLE_FEATURE_KEYS = new Set([
  "event.closeFromOpenPct",
  "event.closeMinusGapPct",
  "event.closeRetentionFromOpen",
  "event.closeRetentionFromPrevClose",
  "event.closeRetPct",
  "event.gapContributionShare",
  "event.gapOpenPct",
  "event.gapVsIntradayPct",
  "event.intradayContributionShare",
  "event.jumpPctFromOpen",
  "event.jumpPctFromPrevClose",
  "feature.candle.bodyPct",
  "feature.candle.closePos",
  "feature.candle.lowerWickPct",
  "feature.candle.rangePct",
  "feature.candle.upperWickPct",
  "feature.gap.closeVsPrevClose",
  "feature.gap.fillRatio",
  "feature.gap.fillThenContinueScore",
  "feature.gap.fillThenRevertScore",
  "feature.gap.openPct",
  "feature.level.closeNearHigh20",
  "feature.level.closeNearHigh60",
  "feature.shape.compression20",
  "feature.shape.sidewaysScore10",
  "feature.trend.runUp10",
  "feature.trend.slope10",
  "feature.volume.dryUp20Over40",
  "feature.volume.lowVolumeCount3",
  "feature.volume.lowVolumeCount5",
  "feature.volume.marketCapLog",
  "feature.volume.ratio40",
  "feature.volume.valueBurst20",
  "feature.volume.valueRatio20",
  "global.global.rangeCompression20Over150",
  "market.absGapMedian",
  "market.gapMedian",
  "market.jumpP90",
  "seq150.delta",
])

const SUPPORT_COMPATIBLE_PREFIXES = [
  "event.closeRetention",
  "event.closeRet",
  "event.gap",
  "feature.candle.",
  "feature.gap.",
  "feature.level.closeNearHigh",
  "feature.shape.sidewaysScore",
  "feature.shape.compression",
  "feature.trend.runUp",
  "feature.trend.slope",
  "feature.volume.lowVolumeCount",
  "feature.volume.ratio",
  "feature.volume.dryUp",
  "feature.volume.marketCapLog",
  "market.",
  "seq150.",
]

export const isPerfectPrototypeSupportCompatibleFeatureKey = (featureKey) => {
  const normalizedFeatureKey = toText(featureKey)
  if (!normalizedFeatureKey) return false
  if (SUPPORT_COMPATIBLE_FEATURE_KEYS.has(normalizedFeatureKey)) return true
  return SUPPORT_COMPATIBLE_PREFIXES.some((prefix) => normalizedFeatureKey.startsWith(prefix))
}

const formatBucketLabel = (bucketIndex) => `B${String(Number(bucketIndex) + 1).padStart(2, "0")}`

const resolveThresholdBuckets = (binCount) => {
  const safeBinCount = Math.max(2, Math.floor(Number(binCount) || 5))
  const thresholdSet = new Set([1, Math.floor((safeBinCount - 1) / 2), safeBinCount - 2])
  return Array.from(thresholdSet)
    .filter((bucketIndex) => Number.isInteger(bucketIndex) && bucketIndex > 0 && bucketIndex < safeBinCount)
    .sort((left, right) => left - right)
}

export const buildPerfectPrototypeIntervalTokens = ({
  featureKey,
  bucketIndex,
  binCount = 5,
} = {}) => {
  const normalizedFeatureKey = toText(featureKey)
  const resolvedBucketIndex = Math.floor(Number(bucketIndex))
  const safeBinCount = Math.max(2, Math.floor(Number(binCount) || 5))
  if (
    !normalizedFeatureKey ||
    !isPerfectPrototypeSupportCompatibleFeatureKey(normalizedFeatureKey) ||
    !Number.isInteger(resolvedBucketIndex) ||
    resolvedBucketIndex < 0 ||
    resolvedBucketIndex >= safeBinCount
  ) {
    return []
  }
  const tokens = []
  for (const thresholdBucketIndex of resolveThresholdBuckets(safeBinCount)) {
    if (resolvedBucketIndex <= thresholdBucketIndex) {
      tokens.push(`ival:${normalizedFeatureKey}:LE_${formatBucketLabel(thresholdBucketIndex)}`)
    }
    if (resolvedBucketIndex >= thresholdBucketIndex) {
      tokens.push(`ival:${normalizedFeatureKey}:GE_${formatBucketLabel(thresholdBucketIndex)}`)
    }
  }
  if (resolvedBucketIndex <= 1) tokens.push(`ival:${normalizedFeatureKey}:LOW`)
  if (resolvedBucketIndex >= safeBinCount - 2) tokens.push(`ival:${normalizedFeatureKey}:HIGH`)
  if (resolvedBucketIndex >= 1 && resolvedBucketIndex <= safeBinCount - 2) {
    tokens.push(`ival:${normalizedFeatureKey}:MID_BAND`)
  }
  return uniqueSortedStrings(tokens)
}
