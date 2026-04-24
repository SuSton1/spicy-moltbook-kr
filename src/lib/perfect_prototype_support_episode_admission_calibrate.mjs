import crypto from "node:crypto"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const minValue = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.min(...filtered)
}

const maxValue = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.max(...filtered)
}

const quantile = (values = [], q = 0.5) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return filtered[lower]
  const fraction = position - lower
  return filtered[lower] + (filtered[upper] - filtered[lower]) * fraction
}

const uniqueNumbers = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .map((value) => Math.round(value * 1000) / 1000),
    ),
  ).sort((left, right) => left - right)

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const featureBucketOf = (featureKey) => String(featureKey ?? "").split(".").slice(0, 3).join(".")

const collectFeatureCandidates = ({ positiveEpisodes = [], negativeEpisodes = [], featureKeys = [], maxFeatures = 8 } = {}) => {
  const scored = []
  for (const featureKey of uniqueStrings(featureKeys)) {
    const positiveValues = positiveEpisodes.map((episode) => num(episode?.featureMap?.[featureKey])).filter(Number.isFinite)
    const negativeValues = negativeEpisodes.map((episode) => num(episode?.featureMap?.[featureKey])).filter(Number.isFinite)
    if (positiveValues.length < 3 || negativeValues.length < 3) continue
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const spread = Math.max(
      0.05,
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
      Math.abs(positiveMean - negativeMean),
    )
    const separation = Math.abs(positiveMean - negativeMean) / spread
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      direction: positiveMean >= negativeMean ? 1 : -1,
      center: (positiveMean + negativeMean) / 2,
      scale: spread,
      weight: Math.max(0.1, Math.min(3, separation)),
      separation,
      bucket: featureBucketOf(featureKey),
    })
  }
  scored.sort((left, right) => right.separation - left.separation || left.featureKey.localeCompare(right.featureKey))
  const bucketCounts = new Map()
  const selected = []
  for (const entry of scored) {
    const count = Number(bucketCounts.get(entry.bucket) ?? 0)
    if (count >= 2) continue
    selected.push(entry)
    bucketCounts.set(entry.bucket, count + 1)
    if (selected.length >= Math.max(2, Math.floor(Number(maxFeatures) || 8))) break
  }
  return selected
}

const scoreEpisode = ({ episode, selectedFeatures = [] } = {}) =>
  average(
    (Array.isArray(selectedFeatures) ? selectedFeatures : [])
      .map((feature) => {
        const rawValue = num(episode?.featureMap?.[feature?.featureKey])
        if (!Number.isFinite(rawValue)) return null
        return Number(feature?.weight ?? 1) * Number(feature?.direction ?? 1) * ((rawValue - Number(feature?.center ?? 0)) / Math.max(0.05, Number(feature?.scale ?? 1)))
      })
      .filter(Number.isFinite),
  ) ?? Number.NEGATIVE_INFINITY

const buildArtifactHash = (artifact) =>
  crypto.createHash("sha256").update(JSON.stringify(artifact)).digest("hex")

const buildArtifact = ({
  family,
  selectedFeatures,
  selectThreshold,
  riskThreshold,
} = {}) => ({
  familyId: family?.familyId ?? "low_gap_top_continuation",
  gateTokens: family?.gateTokens ?? [],
  selectedFeatures: (Array.isArray(selectedFeatures) ? selectedFeatures : []).map((feature) => ({
    featureKey: feature.featureKey,
    direction: feature.direction,
    center: feature.center,
    scale: feature.scale,
    weight: feature.weight,
    separation: feature.separation,
  })),
  riskFeatureKey: "sig.episodeAdm.pathLeakPressure",
  selectThreshold,
  riskThreshold,
  supportAcceptanceOnly: true,
})

export const applyPerfectPrototypeSupportEpisodeAdmission = ({
  artifact,
  episodes = [],
} = {}) =>
  (Array.isArray(episodes) ? episodes : []).map((episode) => {
    const score = scoreEpisode({ episode, selectedFeatures: artifact?.selectedFeatures ?? [] })
    const riskScore = Number(num(episode?.featureMap?.[artifact?.riskFeatureKey]) ?? 0)
    const selected =
      score >= Number(artifact?.selectThreshold ?? 0) && riskScore <= Number(artifact?.riskThreshold ?? Number.POSITIVE_INFINITY)
    return {
      episode,
      score,
      riskScore,
      selected,
    }
  })

const summarizeAdmission = ({ evaluations = [] } = {}) => {
  const selected = (Array.isArray(evaluations) ? evaluations : []).filter((entry) => entry.selected === true)
  const positive = selected.filter((entry) => entry?.episode?.label === "positive")
  const negative = selected.filter((entry) => entry?.episode?.label !== "positive")
  const positiveDateKeys = new Set(positive.map((entry) => entry?.episode?.dateKey).filter(Boolean))
  const positiveMonthKeys = new Set(positive.map((entry) => entry?.episode?.monthKey).filter(Boolean))
  const positiveFoldIds = new Set(
    positive.flatMap((entry) => entry?.episode?.foldIds ?? []).map((value) => Number(value)).filter((value) => value > 0),
  )
  const negativeWindowIds = new Set(
    negative.flatMap((entry) => entry?.episode?.windowIds ?? []).map((value) => Number(value)).filter((value) => value > 0),
  )
  const positiveWindowIds = new Set(
    positive.flatMap((entry) => entry?.episode?.windowIds ?? []).map((value) => Number(value)).filter((value) => value > 0),
  )
  return {
    selectedEpisodeCount: selected.length,
    positiveEpisodeCount: positive.length,
    negativeEpisodeCount: negative.length,
    precision: selected.length > 0 ? positive.length / selected.length : 0,
    trainMatchedDateCount: positiveDateKeys.size,
    trainMatchedMonthCount: positiveMonthKeys.size,
    trainMatchedFoldCount: positiveFoldIds.size,
    crossfitNegativeWindowCount: negativeWindowIds.size,
    crossfitRetainedPositiveWindowCount: positiveWindowIds.size,
    admittedDateKeys: Array.from(positiveDateKeys).sort((left, right) => left.localeCompare(right)),
  }
}

const buildCandidatePreview = (candidate) => ({
  admissionId: candidate?.admissionId ?? null,
  featureCount: candidate?.featureCount ?? 0,
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  riskThreshold: Number(candidate?.riskThreshold ?? 0),
  supportProjectionPositive: candidate?.supportProjectionPositive === true,
  trainSummary: candidate?.trainSummary ?? {},
  failureReason: candidate?.failureReason ?? null,
})

const compareSolutions = (left, right) => {
  if (Number(right?.trainSummary?.trainMatchedDateCount ?? 0) !== Number(left?.trainSummary?.trainMatchedDateCount ?? 0)) {
    return Number(right?.trainSummary?.trainMatchedDateCount ?? 0) - Number(left?.trainSummary?.trainMatchedDateCount ?? 0)
  }
  if (Number(right?.trainSummary?.trainMatchedMonthCount ?? 0) !== Number(left?.trainSummary?.trainMatchedMonthCount ?? 0)) {
    return Number(right?.trainSummary?.trainMatchedMonthCount ?? 0) - Number(left?.trainSummary?.trainMatchedMonthCount ?? 0)
  }
  return Number(left?.featureCount ?? 0) - Number(right?.featureCount ?? 0)
}

const derivePrimaryReason = (reasonCounts = {}) =>
  Object.entries(reasonCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_no_episode_admission_candidates"

export const calibratePerfectPrototypeSupportEpisodeAdmission = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
  maxFeatures = 8,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      supportProjectionPositive: false,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      candidatesEvaluated: [],
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
    }
  }

  const positiveEpisodes = (family?.trainEpisodeSummaries ?? []).filter((episode) => episode?.label === "positive")
  const negativeEpisodes = (family?.trainEpisodeSummaries ?? []).filter((episode) => episode?.label !== "positive")
  const supportEpisodes = Array.isArray(family?.supportEpisodeSummaries) ? family.supportEpisodeSummaries : []
  const selectedFeaturePool = collectFeatureCandidates({
    positiveEpisodes,
    negativeEpisodes,
    featureKeys: family?.admissionFeatureKeys ?? [],
    maxFeatures,
  })

  if (selectedFeaturePool.length < 2) {
    return {
      ok: false,
      reason: "unsat_no_episode_admission_candidates",
      supportFitExcluded,
      supportProjectionPositive: false,
      selectedFeaturePoolCount: selectedFeaturePool.length,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      candidatesEvaluated: [],
      unsatReasonCounts: { unsat_no_episode_admission_candidates: 1 },
    }
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  const qualifiedCandidates = []
  let candidateCount = 0
  let supportProjectionPositive = false
  let bestTrainSummary = null
  const subsetSizes = Array.from(
    { length: Math.max(0, Math.min(selectedFeaturePool.length, Math.max(2, Math.floor(Number(maxFeatures) || 8))) - 1) },
    (_, index) => index + 2,
  )

  for (const featureCount of subsetSizes) {
    const selectedFeatures = selectedFeaturePool.slice(0, featureCount)
    const positiveScores = positiveEpisodes.map((episode) => scoreEpisode({ episode, selectedFeatures })).filter(Number.isFinite)
    const negativeScores = negativeEpisodes.map((episode) => scoreEpisode({ episode, selectedFeatures })).filter(Number.isFinite)
    const positiveRisk = positiveEpisodes.map((episode) => num(episode?.featureMap?.["sig.episodeAdm.pathLeakPressure"])).filter(Number.isFinite)
    const negativeRisk = negativeEpisodes.map((episode) => num(episode?.featureMap?.["sig.episodeAdm.pathLeakPressure"])).filter(Number.isFinite)
    const selectThresholdCandidates = uniqueNumbers([
      0,
      minValue(positiveScores),
      quantile(positiveScores, 0.05),
      quantile(positiveScores, 0.15),
      quantile(negativeScores, 0.9),
      maxValue(negativeScores),
    ]).slice(0, 8)
    const riskThresholdCandidates = uniqueNumbers([
      maxValue(positiveRisk),
      quantile(positiveRisk, 0.9),
      quantile(negativeRisk, 0.1),
    ]).slice(0, 6)

    for (const selectThreshold of selectThresholdCandidates.length > 0 ? selectThresholdCandidates : [0]) {
      for (const riskThreshold of riskThresholdCandidates.length > 0 ? riskThresholdCandidates : [0]) {
        candidateCount += 1
        const artifact = buildArtifact({
          family,
          selectedFeatures,
          selectThreshold,
          riskThreshold,
        })
        const trainSummary = summarizeAdmission({
          evaluations: applyPerfectPrototypeSupportEpisodeAdmission({
            artifact,
            episodes: family?.trainEpisodeSummaries ?? [],
          }),
        })
        const supportEvaluations = applyPerfectPrototypeSupportEpisodeAdmission({
          artifact,
          episodes: supportEpisodes,
        })
        const supportSelected = supportEvaluations.some((entry) => entry?.selected === true)
        supportProjectionPositive = supportProjectionPositive || supportSelected
        const candidate = {
          admissionId: `EPISODE_ADMISSION_${String(candidateCount).padStart(3, "0")}`,
          artifact,
          featureCount,
          selectedFeatures,
          selectThreshold,
          riskThreshold,
          trainSummary,
          supportProjectionPositive: supportSelected,
          artifactHashBeforeAcceptance: buildArtifactHash(artifact),
          artifactHashAfterAcceptance: buildArtifactHash(artifact),
          failureReason: null,
        }
        if (Number(trainSummary.precision ?? 0) < 1) {
          candidate.failureReason = "unsat_episode_admission_train_precision"
        } else if (Number(trainSummary.trainMatchedDateCount ?? 0) < minTrainMatchedDates) {
          candidate.failureReason = "unsat_episode_admission_train_breadth"
        } else if (Number(trainSummary.trainMatchedMonthCount ?? 0) < minTrainMatchedMonths) {
          candidate.failureReason = "unsat_episode_admission_train_breadth"
        } else if (Number(trainSummary.trainMatchedFoldCount ?? 0) < minTrainMatchedFolds) {
          candidate.failureReason = "unsat_episode_admission_train_breadth"
        } else if (Number(trainSummary.crossfitNegativeWindowCount ?? 0) > maxCrossfitNegativeWindows) {
          candidate.failureReason = "unsat_episode_admission_crossfit"
        } else if (supportSelected !== true) {
          candidate.failureReason = "unsat_episode_admission_support_projection"
        }
        if (!candidate.failureReason) {
          qualifiedCandidates.push(candidate)
        } else {
          reasonCounts[candidate.failureReason] = Number(reasonCounts[candidate.failureReason] ?? 0) + 1
        }
        if (!bestTrainSummary || Number(candidate.trainSummary?.trainMatchedDateCount ?? 0) > Number(bestTrainSummary?.trainMatchedDateCount ?? 0)) {
          bestTrainSummary = candidate.trainSummary
        }
        if (candidatesEvaluated.length < 256) candidatesEvaluated.push(buildCandidatePreview(candidate))
      }
    }
  }

  if (qualifiedCandidates.length < 1) {
    return {
      ok: false,
      reason: derivePrimaryReason(reasonCounts),
      supportFitExcluded,
      supportProjectionPositive,
      selectedFeaturePoolCount: selectedFeaturePool.length,
      candidateCount,
      qualifiedCandidateCount: 0,
      bestTrainSummary,
      candidatesEvaluated,
      unsatReasonCounts: reasonCounts,
    }
  }

  qualifiedCandidates.sort(compareSolutions)
  const best = qualifiedCandidates[0]
  return {
    ok: true,
    supportFitExcluded,
    supportProjectionPositive: true,
    selectedFeaturePoolCount: selectedFeaturePool.length,
    candidateCount,
    qualifiedCandidateCount: qualifiedCandidates.length,
    artifact: best.artifact,
    artifactHashBeforeAcceptance: best.artifactHashBeforeAcceptance,
    artifactHashAfterAcceptance: best.artifactHashAfterAcceptance,
    trainSummary: best.trainSummary,
    admittedDateKeys: best.trainSummary?.admittedDateKeys ?? [],
    candidatesEvaluated,
  }
}
