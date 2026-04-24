const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const hasBucketWhere = (bucketIndexesByFeature, featureKey, predicate) => {
  const bucketIndex =
    bucketIndexesByFeature instanceof Map ? bucketIndexesByFeature.get(String(featureKey ?? "").trim()) : undefined
  if (!Number.isInteger(bucketIndex)) return false
  return predicate(bucketIndex)
}

const hasAnyToken = (tokenSet, patterns) =>
  (Array.isArray(patterns) ? patterns : []).some((pattern) => tokenSet.has(String(pattern ?? "").trim()))

export const buildPerfectPrototypeLowGapTopMacroTokens = ({
  bucketIndexesByFeature = new Map(),
  categoricalTokens = [],
  enableSupportAnchorAtoms = false,
} = {}) => {
  const tokenSet = new Set((Array.isArray(categoricalTokens) ? categoricalTokens : []).filter(Boolean))
  const tokens = []

  const weakRetention =
    hasBucketWhere(bucketIndexesByFeature, "event.closeRetentionFromOpen", (bucketIndex) => bucketIndex <= 1) ||
    hasBucketWhere(bucketIndexesByFeature, "event.closeRetPct", (bucketIndex) => bucketIndex <= 1)
  const strongGap =
    hasBucketWhere(bucketIndexesByFeature, "feature.gap.openPct", (bucketIndex) => bucketIndex >= 3) ||
    hasBucketWhere(bucketIndexesByFeature, "event.gapOpenPct", (bucketIndex) => bucketIndex >= 3)
  const gapContinuation =
    hasBucketWhere(bucketIndexesByFeature, "feature.gap.fillRatio", (bucketIndex) => bucketIndex <= 1) &&
    hasBucketWhere(bucketIndexesByFeature, "feature.gap.fillThenContinueScore", (bucketIndex) => bucketIndex <= 1)
  const dryupLight =
    hasBucketWhere(bucketIndexesByFeature, "feature.volume.lowVolumeCount3", (bucketIndex) => bucketIndex <= 2) &&
    (hasBucketWhere(bucketIndexesByFeature, "feature.volume.ratio40", (bucketIndex) => bucketIndex <= 2) ||
      hasBucketWhere(bucketIndexesByFeature, "feature.volume.dryUp20Over40", (bucketIndex) => bucketIndex <= 1))
  const trendCoil =
    hasBucketWhere(bucketIndexesByFeature, "feature.trend.runUp10", (bucketIndex) => bucketIndex >= 1 && bucketIndex <= 3) &&
    hasBucketWhere(bucketIndexesByFeature, "feature.trend.slope10", (bucketIndex) => bucketIndex >= 1 && bucketIndex <= 3) &&
    hasBucketWhere(bucketIndexesByFeature, "feature.shape.sidewaysScore10", (bucketIndex) => bucketIndex <= 1)
  const xsecPullback = hasAnyToken(tokenSet, [
    "tag:xsec.closeVsMedian:BELOW",
    "tag:xsec.closeRank:LOW",
    "tag:xsecLane.closeRank:LOW",
  ])
  const nearHighCompression =
    hasBucketWhere(bucketIndexesByFeature, "feature.level.closeNearHigh20", (bucketIndex) => bucketIndex <= 1) &&
    hasBucketWhere(bucketIndexesByFeature, "feature.shape.compression20", (bucketIndex) => bucketIndex >= 3)

  if (weakRetention && strongGap) tokens.push("macro:lowGapTop:RETENTION_WEAK_GAP_HIGH")
  if (gapContinuation) tokens.push("macro:lowGapTop:GAP_CONTINUATION_SUPPORT")
  if (dryupLight) tokens.push("macro:lowGapTop:DRYUP_LIGHT")
  if (trendCoil) tokens.push("macro:lowGapTop:TREND_COIL")
  if (xsecPullback) tokens.push("macro:lowGapTop:XSEC_PULLBACK")
  if (nearHighCompression) tokens.push("macro:lowGapTop:NEAR_HIGH_COMPRESSION")

  if (enableSupportAnchorAtoms === true) {
    if (weakRetention && strongGap && dryupLight) {
      tokens.push("tag:lowGapTop.supportAnchor:RET_GAP_DRYUP")
    }
    if (xsecPullback && trendCoil) {
      tokens.push("tag:lowGapTop.supportAnchor:XSEC_COIL")
    }
    if (gapContinuation && xsecPullback) {
      tokens.push("tag:lowGapTop.supportAnchor:GAP_CONT_XSEC")
    }
    if (weakRetention && strongGap && xsecPullback && trendCoil) {
      tokens.push("tag:lowGapTop.supportAnchor:FULL_STACK")
    }
  }

  return uniqueSortedStrings(tokens)
}
