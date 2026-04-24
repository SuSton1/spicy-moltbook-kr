import { selectDiversePerfectPrototypeSubgroupManifests } from "./perfect_prototype_subgroup_diversity.mjs"
import { buildPerfectPrototypeSubgroupManifestRecord } from "./perfect_prototype_subgroup_manifest.mjs"

const LOW_GAP_TOP_FAMILY_ID = "low_gap_top_continuation"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const safeRate = (left, right) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= 0) return 0
  return l / r
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const normalizeToken = (value) => String(value ?? "").trim().toLowerCase()

const tokenMatchesPattern = (token, pattern) => {
  const normalizedToken = normalizeToken(token)
  const normalizedPattern = normalizeToken(pattern)
  if (!normalizedToken || !normalizedPattern) return false
  if (normalizedPattern.endsWith("*")) {
    return normalizedToken.startsWith(normalizedPattern.slice(0, -1))
  }
  return normalizedToken === normalizedPattern
}

const classifyRetentionRegime = (eventFeatureVec) => {
  const retentionFromPrev = num(eventFeatureVec?.closeRetentionFromPrevClose)
  const retentionFromOpen = num(eventFeatureVec?.closeRetentionFromOpen)
  if (!Number.isFinite(retentionFromPrev) || !Number.isFinite(retentionFromOpen)) return "UNKNOWN"
  if (retentionFromPrev >= 0.8 && retentionFromOpen >= 0.55) return "STICKY"
  if (retentionFromPrev >= 0.5 && retentionFromOpen >= 0.2) return "BALANCED"
  if (retentionFromPrev >= 0 && retentionFromOpen >= -0.05) return "FRAGILE"
  return "REVERSAL"
}

const classifyGapContinuationRegime = (eventFeatureVec) => {
  const gapShare = num(eventFeatureVec?.gapContributionShare)
  const retentionFromPrev = num(eventFeatureVec?.closeRetentionFromPrevClose)
  if (!Number.isFinite(gapShare) || !Number.isFinite(retentionFromPrev)) return "UNKNOWN"
  if (gapShare >= 0.67 && retentionFromPrev >= 0.55) return "GAP_STABLE"
  if (gapShare >= 0.67 && retentionFromPrev >= 0.25) return "GAP_BALANCED"
  if (gapShare >= 0.67) return "GAP_FADE"
  if (gapShare >= 0.33 && retentionFromPrev >= 0.45) return "MIXED_CONTINUATION"
  return "INTRADAY_OR_FADE"
}

const classifyVolumeRegime = (featureVec) => {
  const dryUp = num(featureVec?.["volume.dryUp20Over40"])
  const volumeRatio40 = num(featureVec?.["volume.ratio40"])
  const exhaustionProxy = num(featureVec?.["volume.exhaustionProxy"])
  if (!Number.isFinite(dryUp) || !Number.isFinite(volumeRatio40) || !Number.isFinite(exhaustionProxy)) {
    return "UNKNOWN"
  }
  if (dryUp >= 1 && volumeRatio40 <= 0.9 && exhaustionProxy <= 0.12) return "QUIET_CONTINUATION"
  if (dryUp >= 1 && volumeRatio40 <= 1.3) return "DRY_BALANCED"
  if (volumeRatio40 >= 1.6 && exhaustionProxy >= 0.18) return "EXHAUSTED_SPIKE"
  return "MIXED"
}

const classifyTrendRegime = (featureVec) => {
  const runUp10 = num(featureVec?.["trend.runUp10"])
  const slope10 = num(featureVec?.["trend.slope10"])
  const closeOverMa10 = num(featureVec?.["trend.closeOverMa10"])
  if (!Number.isFinite(runUp10) || !Number.isFinite(slope10) || !Number.isFinite(closeOverMa10)) {
    return "UNKNOWN"
  }
  if (runUp10 >= 0.08 && runUp10 <= 0.35 && slope10 >= 0.002 && closeOverMa10 >= 0.01) {
    return "STEADY_BASE"
  }
  if (runUp10 > 0.35 || slope10 > 0.01) return "EXTENDED"
  if (runUp10 >= 0 && closeOverMa10 >= 0) return "WEAK_UP"
  return "WEAK_OR_DOWN"
}

const classifyIsolationRegime = ({ featureVec, xsecEventVec }) => {
  const marketCapLog = num(featureVec?.["volume.marketCapLog"])
  const gapRankPct = num(xsecEventVec?.absGapRankPct)
  const closeRankPct = num(xsecEventVec?.closeRankPct)
  if (!Number.isFinite(marketCapLog) || !Number.isFinite(gapRankPct) || !Number.isFinite(closeRankPct)) {
    return "UNKNOWN"
  }
  if (marketCapLog <= 18.5 && gapRankPct >= 0.9 && closeRankPct <= 0.34) return "SMALL_EXTREME_GAP"
  if (marketCapLog <= 19.5 && gapRankPct >= 0.85) return "SMALL_HIGH_GAP"
  return "BROAD_OR_LARGE"
}

const classifyBodyWickRegime = (featureVec) => {
  const bodyPct = num(featureVec?.["candle.bodyPct"])
  const lowerWickPct = num(featureVec?.["candle.lowerWickPct"])
  if (!Number.isFinite(bodyPct) || !Number.isFinite(lowerWickPct)) return "UNKNOWN"
  if (bodyPct >= 0.35 && lowerWickPct >= 0.15) return "BODY_WITH_BID"
  if (bodyPct >= 0.25) return "BODY_DOMINANT"
  if (lowerWickPct >= 0.2) return "WICKY_SUPPORT"
  return "WEAK_BODY"
}

const classifyFpRisk = ({ eventFeatureVec, featureVec }) => {
  const gapShare = num(eventFeatureVec?.gapContributionShare)
  const retentionFromPrev = num(eventFeatureVec?.closeRetentionFromPrevClose)
  const dryUp = num(featureVec?.["volume.dryUp20Over40"])
  const runUp10 = num(featureVec?.["trend.runUp10"])
  const slope10 = num(featureVec?.["trend.slope10"])
  if (
    !Number.isFinite(gapShare) ||
    !Number.isFinite(retentionFromPrev) ||
    !Number.isFinite(dryUp) ||
    !Number.isFinite(runUp10) ||
    !Number.isFinite(slope10)
  ) {
    return "UNKNOWN"
  }
  if (gapShare >= 0.67 && retentionFromPrev < 0.35 && dryUp >= 1.05) return "HIGH"
  if (runUp10 < 0.03 && slope10 < 0.001 && retentionFromPrev < 0.45) return "HIGH"
  if (gapShare >= 0.67 && retentionFromPrev < 0.5) return "ELEVATED"
  return "LOW"
}

export const buildPerfectPrototypeLowGapTopGeneralizationTagTokens = ({
  featureVec,
  eventFeatureVec,
  xsecEventVec,
}) =>
  uniqueSortedStrings([
    `tag:lowGapTop.retentionRegime:${classifyRetentionRegime(eventFeatureVec)}`,
    `tag:lowGapTop.gapContinuationRegime:${classifyGapContinuationRegime(eventFeatureVec)}`,
    `tag:lowGapTop.volumeRegime:${classifyVolumeRegime(featureVec)}`,
    `tag:lowGapTop.trendRegime:${classifyTrendRegime(featureVec)}`,
    `tag:lowGapTop.isolationRegime:${classifyIsolationRegime({ featureVec, xsecEventVec })}`,
    `tag:lowGapTop.bodyWickRegime:${classifyBodyWickRegime(featureVec)}`,
    `tag:lowGapTop.fpRisk:${classifyFpRisk({ eventFeatureVec, featureVec })}`,
  ])

const LOW_GAP_TOP_FP_RISK_PATTERN = "tag:lowgaptop.fprisk:*"
const LOW_GAP_TOP_GENERALIZED_ROOT_AXIS_DEFINITIONS = Object.freeze([
  {
    axis: "retention",
    patterns: ["tag:lowgaptop.retentionregime:*"],
  },
  {
    axis: "gapContinuation",
    patterns: ["tag:lowgaptop.gapcontinuationregime:*"],
  },
  {
    axis: "volume",
    patterns: ["tag:lowgaptop.volumeregime:*"],
  },
  {
    axis: "trend",
    patterns: ["tag:lowgaptop.trendregime:*"],
  },
  {
    axis: "isolation",
    patterns: ["tag:lowgaptop.isolationregime:*"],
  },
  {
    axis: "bodyWick",
    patterns: ["tag:lowgaptop.bodywickregime:*"],
  },
  {
    axis: "eventProfile",
    patterns: ["tag:event.gapprofile:*", "tag:event.closestrength:*"],
  },
  {
    axis: "xsecRank",
    patterns: ["tag:xsec.closevsmedian:*", "tag:xsec.gaprank:*", "tag:xseclane.closerank:*"],
  },
])

const LOW_GAP_TOP_GENERALIZED_ROOT_PATTERNS = Object.freeze([
  "tag:lowgaptop.retentionregime:*",
  "tag:lowgaptop.gapcontinuationregime:*",
  "tag:lowgaptop.volumeregime:*",
  "tag:lowgaptop.trendregime:*",
  "tag:lowgaptop.isolationregime:*",
  "tag:lowgaptop.bodywickregime:*",
  "tag:event.gapprofile:*",
  "tag:event.closestrength:*",
  "tag:xsec.closevsmedian:*",
  "tag:xsec.gaprank:*",
  "tag:xseclane.closerank:*",
])

export const isPerfectPrototypeLowGapTopGeneralizedRootToken = (token) =>
  LOW_GAP_TOP_GENERALIZED_ROOT_PATTERNS.some((pattern) => tokenMatchesPattern(token, pattern))

export const isPerfectPrototypeLowGapTopFpRiskToken = (token) =>
  tokenMatchesPattern(token, LOW_GAP_TOP_FP_RISK_PATTERN)

export const classifyPerfectPrototypeLowGapTopGeneralizedRootAxis = (token) => {
  for (const definition of LOW_GAP_TOP_GENERALIZED_ROOT_AXIS_DEFINITIONS) {
    if ((definition.patterns ?? []).some((pattern) => tokenMatchesPattern(token, pattern))) {
      return definition.axis
    }
  }
  return null
}

export const shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass = ({
  familyId,
  enabled,
}) => enabled === true && String(familyId ?? "").trim() === LOW_GAP_TOP_FAMILY_ID

export const scorePerfectPrototypeLowGapTopSubgroupCandidate = ({
  positiveCount,
  negativeCount,
  familyCohortPositiveCount,
  negativeUniverseCount,
  hitStats = null,
}) => {
  const precision = safeRate(positiveCount, positiveCount + negativeCount)
  const baseRate = safeRate(
    familyCohortPositiveCount,
    Number(familyCohortPositiveCount ?? 0) + Number(negativeUniverseCount ?? 0),
  )
  const coverage = safeRate(positiveCount, Math.max(1, Number(familyCohortPositiveCount ?? 0)))
  const wracc = coverage * (precision - baseRate)
  const distinctDateCount = Number(hitStats?.distinctDateCount ?? 0)
  const matchedMonthCount = Number(hitStats?.matchedMonthCount ?? 0)
  const matchedFoldCount = Number(hitStats?.matchedFoldCount ?? 0)
  const top1DateHitShare = Number(hitStats?.top1DateHitShare ?? 0)
  return (
    wracc * 1000 +
    distinctDateCount * 2 +
    matchedMonthCount * 1.5 +
    matchedFoldCount * 4 -
    top1DateHitShare * 12 -
    Number(negativeCount ?? 0) * 0.5
  )
}

const comparePerfectPrototypeLowGapTopBundleCandidates = (left, right) => {
  if (Number(right?.subgroupDistinctDateCount ?? 0) !== Number(left?.subgroupDistinctDateCount ?? 0)) {
    return Number(right?.subgroupDistinctDateCount ?? 0) - Number(left?.subgroupDistinctDateCount ?? 0)
  }
  if (Number(right?.subgroupMatchedMonthCount ?? 0) !== Number(left?.subgroupMatchedMonthCount ?? 0)) {
    return Number(right?.subgroupMatchedMonthCount ?? 0) - Number(left?.subgroupMatchedMonthCount ?? 0)
  }
  if (Number(right?.subgroupMatchedFoldCount ?? 0) !== Number(left?.subgroupMatchedFoldCount ?? 0)) {
    return Number(right?.subgroupMatchedFoldCount ?? 0) - Number(left?.subgroupMatchedFoldCount ?? 0)
  }
  if (Number(right?.cohortCoverageShare ?? Number.NEGATIVE_INFINITY) !== Number(left?.cohortCoverageShare ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.cohortCoverageShare ?? Number.NEGATIVE_INFINITY) - Number(left?.cohortCoverageShare ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(right?.subgroupWracc ?? Number.NEGATIVE_INFINITY) !== Number(left?.subgroupWracc ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.subgroupWracc ?? Number.NEGATIVE_INFINITY) - Number(left?.subgroupWracc ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(right?.subgroupTpLift ?? Number.NEGATIVE_INFINITY) !== Number(left?.subgroupTpLift ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.subgroupTpLift ?? Number.NEGATIVE_INFINITY) - Number(left?.subgroupTpLift ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(left?.subgroupFpPenalty ?? Number.POSITIVE_INFINITY) !== Number(right?.subgroupFpPenalty ?? Number.POSITIVE_INFINITY)) {
    return Number(left?.subgroupFpPenalty ?? Number.POSITIVE_INFINITY) - Number(right?.subgroupFpPenalty ?? Number.POSITIVE_INFINITY)
  }
  if (Number(right?.priority ?? 0) !== Number(left?.priority ?? 0)) {
    return Number(right?.priority ?? 0) - Number(left?.priority ?? 0)
  }
  if (Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) !== Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) - Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

export const buildPerfectPrototypeLowGapTopSubgroupBundleManifests = ({
  candidatePool,
  maxBundles = 6,
  maxTokensPerBundle = 3,
  minMatchedDates = 10,
  minMatchedMonths = 6,
  minMatchedFolds = 4,
  minSelectionFrequency = 0.5,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
  maxTokenJaccard = 0.8,
  maxAxisOverlap = 2,
  maxDateCoverJaccard = 0.9,
} = {}) => {
  const usableCandidates = (Array.isArray(candidatePool) ? candidatePool : [])
    .filter(
      (entry) =>
        entry?.subgroupManifestEligible === true &&
        !isPerfectPrototypeLowGapTopFpRiskToken(entry?.token) &&
        isPerfectPrototypeLowGapTopGeneralizedRootToken(entry?.token),
    )
    .map((entry) => ({
      ...entry,
      bundleAxis:
        entry?.bundleAxis ?? classifyPerfectPrototypeLowGapTopGeneralizedRootAxis(entry?.token),
    }))
    .sort(comparePerfectPrototypeLowGapTopBundleCandidates)
  if (usableCandidates.length < 1) {
    return {
      candidateCount: 0,
      manifestCandidateCount: 0,
      stableManifestCount: 0,
      diverseManifestCount: 0,
      manifests: [],
    }
  }
  const groupedByAxis = new Map()
  for (const entry of usableCandidates) {
    const bundleAxis = String(entry?.bundleAxis ?? "").trim()
    if (!bundleAxis) continue
    const bucket = groupedByAxis.get(bundleAxis) ?? []
    bucket.push(entry)
    groupedByAxis.set(bundleAxis, bucket)
  }
  const axisPriority = LOW_GAP_TOP_GENERALIZED_ROOT_AXIS_DEFINITIONS.map((definition) => definition.axis)
  const axisAnchors = axisPriority
    .flatMap((axis) => (groupedByAxis.get(axis) ?? []).slice(0, 2))
    .filter(Boolean)
    .sort(comparePerfectPrototypeLowGapTopBundleCandidates)
  if (axisAnchors.length < 1) {
    return {
      candidateCount: usableCandidates.length,
      manifestCandidateCount: 0,
      stableManifestCount: 0,
      diverseManifestCount: 0,
      manifests: [],
    }
  }
  const manifestCandidates = []
  const seen = new Set()
  const maxCandidateBundles = Math.max(Math.max(1, Number(maxBundles) || 1) * 8, 24)
  const pushManifest = (entries) => {
    const normalizedEntries = uniqueSortedStrings((Array.isArray(entries) ? entries : []).map((entry) => entry?.token).filter(Boolean)).map(
      (token) => usableCandidates.find((candidate) => candidate.token === token) ?? { token, tokenIndex: null },
    )
    const bundleKey = normalizedEntries.map((entry) => entry.token).filter(Boolean).join("|")
    if (!bundleKey || seen.has(bundleKey)) return
    seen.add(bundleKey)
    const manifest = buildPerfectPrototypeSubgroupManifestRecord({
      subgroupId: `low_gap_top_generalized_bundle_${String(manifestCandidates.length + 1).padStart(3, "0")}`,
      familyId: LOW_GAP_TOP_FAMILY_ID,
      entries: normalizedEntries,
      minMatchedDates,
      minMatchedMonths,
      minMatchedFolds,
      minSelectionFrequency,
      minFoldPresenceCount,
      minWindowPresenceCount,
    })
    if (manifest) manifestCandidates.push(manifest)
  }
  for (const anchor of axisAnchors) {
    if (manifestCandidates.length >= maxCandidateBundles) break
    pushManifest([anchor])
  }
  for (let leftIndex = 0; leftIndex < axisAnchors.length; leftIndex += 1) {
    if (manifestCandidates.length >= maxCandidateBundles) break
    for (let rightIndex = leftIndex + 1; rightIndex < axisAnchors.length; rightIndex += 1) {
      pushManifest([axisAnchors[leftIndex], axisAnchors[rightIndex]].slice(0, maxTokensPerBundle))
      if (manifestCandidates.length >= maxCandidateBundles) break
    }
  }
  for (let firstIndex = 0; firstIndex < axisAnchors.length; firstIndex += 1) {
    if (manifestCandidates.length >= maxCandidateBundles) break
    for (let secondIndex = firstIndex + 1; secondIndex < axisAnchors.length; secondIndex += 1) {
      if (manifestCandidates.length >= maxCandidateBundles) break
      for (let thirdIndex = secondIndex + 1; thirdIndex < axisAnchors.length; thirdIndex += 1) {
        pushManifest(
          [
            axisAnchors[firstIndex],
            axisAnchors[secondIndex],
            axisAnchors[thirdIndex],
          ].slice(0, maxTokensPerBundle),
        )
        if (manifestCandidates.length >= maxCandidateBundles) break
      }
    }
  }
  const stableManifests = manifestCandidates.filter((entry) => entry?.stabilityQualified === true)
  const diverseManifests = selectDiversePerfectPrototypeSubgroupManifests({
    manifests: stableManifests,
    maxManifests: maxBundles,
    maxTokenJaccard,
    maxAxisOverlap,
    maxDateCoverJaccard,
  })
  return {
    candidateCount: usableCandidates.length,
    manifestCandidateCount: manifestCandidates.length,
    stableManifestCount: stableManifests.length,
    diverseManifestCount: diverseManifests.length,
    manifests: diverseManifests.slice(0, Math.max(1, Number(maxBundles) || 1)),
  }
}
