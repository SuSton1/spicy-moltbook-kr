const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
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

const featureBucketOf = (featureKey) => {
  const parts = String(featureKey ?? "").trim().split(".").filter(Boolean)
  return parts.slice(0, Math.min(3, parts.length)).join(".")
}

const collectFeatureCandidates = ({
  positiveRows = [],
  negativeRows = [],
  featureKeys = [],
  maxFeatures = 8,
} = {}) => {
  const scored = []
  for (const featureKey of uniqueStrings(featureKeys)) {
    const positiveValues = positiveRows.map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
    const negativeValues = negativeRows.map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
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
  const out = []
  const bucketCounts = new Map()
  for (const entry of scored) {
    const bucketCount = Number(bucketCounts.get(entry.bucket) ?? 0)
    if (bucketCount >= 2) continue
    out.push(entry)
    bucketCounts.set(entry.bucket, bucketCount + 1)
    if (out.length >= Math.max(2, Math.floor(Number(maxFeatures) || 8))) break
  }
  return out
}

const scoreRow = ({ row, features = [] } = {}) =>
  (Array.isArray(features) ? features : []).reduce((sum, feature) => {
    const rawValue = num(row?.numericFeatureMap?.[feature?.featureKey])
    if (!Number.isFinite(rawValue)) return sum
    const direction = Number(feature?.direction ?? 1) >= 0 ? 1 : -1
    const center = Number(feature?.center ?? 0)
    const scale = Math.max(0.05, Number(feature?.scale ?? 1))
    const weight = Math.max(0.05, Number(feature?.weight ?? 1))
    return sum + weight * direction * ((rawValue - center) / scale)
  }, 0)

const buildPairLookup = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

const rateOfPairs = ({ pairs = [], rowLookup = new Map(), features = [] } = {}) => {
  const total = Array.isArray(pairs) ? pairs.length : 0
  if (total < 1) return { total: 0, wins: 0, rate: 0 }
  let wins = 0
  for (const pair of pairs) {
    const positiveRow = rowLookup.get(pair?.positiveRowKey)
    const negativeRow = rowLookup.get(pair?.negativeRowKey)
    if (!positiveRow || !negativeRow) continue
    if (scoreRow({ row: positiveRow, features }) > scoreRow({ row: negativeRow, features })) wins += 1
  }
  return {
    total,
    wins,
    rate: total > 0 ? wins / total : 0,
  }
}

const buildCandidatePreview = (candidate) => ({
  featureCount: Number(candidate?.featureCount ?? 0),
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  pairwiseWinRate: Number(candidate?.pairwiseWinRate ?? 0),
  sameDateRunnerUpBeatRate: Number(candidate?.sameDateRunnerUpBeatRate ?? 0),
  matchedControlBeatRate: Number(candidate?.matchedControlBeatRate ?? 0),
  failureImpostorBeatRate: Number(candidate?.failureImpostorBeatRate ?? 0),
  minFoldPairwiseWinRate: Number(candidate?.minFoldPairwiseWinRate ?? 0),
  hardNegativeLeakCount: Number(candidate?.hardNegativeLeakCount ?? 0),
  supportProjectionPositive: candidate?.supportProjectionPositive === true,
  failureReason: candidate?.failureReason ?? null,
})

const compareCandidates = (left, right) => {
  if (Number(left?.hardNegativeLeakCount ?? 0) !== Number(right?.hardNegativeLeakCount ?? 0)) {
    return Number(left?.hardNegativeLeakCount ?? 0) - Number(right?.hardNegativeLeakCount ?? 0)
  }
  if (Number(right?.sameDateRunnerUpBeatRate ?? 0) !== Number(left?.sameDateRunnerUpBeatRate ?? 0)) {
    return Number(right?.sameDateRunnerUpBeatRate ?? 0) - Number(left?.sameDateRunnerUpBeatRate ?? 0)
  }
  if (Number(right?.matchedControlBeatRate ?? 0) !== Number(left?.matchedControlBeatRate ?? 0)) {
    return Number(right?.matchedControlBeatRate ?? 0) - Number(left?.matchedControlBeatRate ?? 0)
  }
  if (Number(right?.pairwiseWinRate ?? 0) !== Number(left?.pairwiseWinRate ?? 0)) {
    return Number(right?.pairwiseWinRate ?? 0) - Number(left?.pairwiseWinRate ?? 0)
  }
  return Number(left?.featureCount ?? 0) - Number(right?.featureCount ?? 0)
}

const derivePrimaryReason = (reasonCounts = {}) =>
  Object.entries(reasonCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_shadow_winner_slate_audit"

export const auditPerfectPrototypeShadowWinnerSlateSeparability = ({
  family,
  minPairwiseWinRate = 0.9,
  minSameDateBeatRate = 0.9,
  minMatchedControlBeatRate = 0.85,
  minFailureBeatRate = 0.85,
  minFoldPairwiseWinRate = 0.8,
  maxHardNegativeLeakCount = 0,
  maxFeatures = 8,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      pairwiseCandidateCount: 0,
      pairwiseQualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      candidatesEvaluated: [],
    }
  }

  const positiveRows = Array.isArray(family?.calibrationPositiveRows) ? family.calibrationPositiveRows : []
  const negativeRows = Array.isArray(family?.calibrationNegativeRows) ? family.calibrationNegativeRows : []
  const featurePool = uniqueStrings([
    ...(family?.shadowWinnerSlateFeatureKeys ?? []),
    ...(family?.winnerQueryFeatureKeys ?? []),
    ...(family?.outrankFeatureKeys ?? []),
    ...(family?.residualFeatureKeys ?? []),
  ])
  const selectedFeaturePool = collectFeatureCandidates({
    positiveRows,
    negativeRows,
    featureKeys: featurePool,
    maxFeatures,
  })
  if (selectedFeaturePool.length < 2) {
    return {
      ok: false,
      reason: "unsat_no_shadow_winner_slate_audit_candidates",
      supportFitExcluded,
      auditFeaturePoolCount: featurePool.length,
      pairwiseCandidateCount: 0,
      pairwiseQualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_no_shadow_winner_slate_audit_candidates: 1 },
      candidatesEvaluated: [],
    }
  }

  const rowLookup = buildPairLookup([...positiveRows, ...negativeRows, ...(family?.supportCaseViews ?? [])])
  const allPairs = family?.shadowWinnerSlatePairs ?? []
  const sameDatePairs = allPairs.filter((pair) => pair?.pairType === "same_date_runner_up")
  const matchedControlPairs = allPairs.filter((pair) => pair?.pairType === "matched_control_impostor")
  const failurePairs = allPairs.filter((pair) => pair?.pairType === "failure_impostor")
  const pairwiseByFold = new Map()
  for (const pair of allPairs) {
    const foldId = Number(pair?.positiveFoldId ?? 0)
    if (foldId < 1) continue
    const bucket = pairwiseByFold.get(foldId) ?? []
    bucket.push(pair)
    pairwiseByFold.set(foldId, bucket)
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  const qualifiedCandidates = []
  let pairwiseCandidateCount = 0
  let bestCandidate = null

  for (let featureCount = 2; featureCount <= selectedFeaturePool.length; featureCount += 1) {
    const selectedFeatures = selectedFeaturePool.slice(0, featureCount)
    pairwiseCandidateCount += 1
    const pairwise = rateOfPairs({ pairs: allPairs, rowLookup, features: selectedFeatures })
    const sameDate = rateOfPairs({ pairs: sameDatePairs, rowLookup, features: selectedFeatures })
    const matchedControl = rateOfPairs({ pairs: matchedControlPairs, rowLookup, features: selectedFeatures })
    const failure = rateOfPairs({ pairs: failurePairs, rowLookup, features: selectedFeatures })
    const minFoldRate =
      pairwiseByFold.size > 0
        ? Math.min(
            ...Array.from(pairwiseByFold.values()).map((pairs) => rateOfPairs({ pairs, rowLookup, features: selectedFeatures }).rate),
          )
        : 0
    const positiveScores = positiveRows.map((row) => scoreRow({ row, features: selectedFeatures })).filter(Number.isFinite)
    const negativeScores = negativeRows.map((row) => scoreRow({ row, features: selectedFeatures })).filter(Number.isFinite)
    const positiveThreshold = quantile(positiveScores, 0.1)
    const hardNegativeLeakCount = negativeScores.filter(
      (value) => Number.isFinite(value) && value >= Number(positiveThreshold ?? Number.POSITIVE_INFINITY),
    ).length
    const supportScores = (family?.supportCaseViews ?? [])
      .map((row) => scoreRow({ row, features: selectedFeatures }))
      .filter(Number.isFinite)
    const supportProjectionPositive =
      supportScores.length > 0 &&
      Math.max(...supportScores) >=
        Math.max(
          Number(positiveThreshold ?? Number.NEGATIVE_INFINITY),
          Number(quantile(negativeScores, 0.9) ?? Number.NEGATIVE_INFINITY),
        )
    const candidate = {
      featureCount,
      selectedFeatures,
      pairwiseWinRate: pairwise.rate,
      sameDateRunnerUpBeatRate: sameDate.rate,
      matchedControlBeatRate: matchedControl.rate,
      failureImpostorBeatRate: failure.rate,
      minFoldPairwiseWinRate: minFoldRate,
      hardNegativeLeakCount,
      supportProjectionPositive,
      failureReason: null,
    }
    if (candidate.pairwiseWinRate < Number(minPairwiseWinRate)) {
      candidate.failureReason = "unsat_pairwise_win_rate"
    } else if (candidate.sameDateRunnerUpBeatRate < Number(minSameDateBeatRate)) {
      candidate.failureReason = "unsat_same_date_runner_up_beat_rate"
    } else if (candidate.matchedControlBeatRate < Number(minMatchedControlBeatRate)) {
      candidate.failureReason = "unsat_matched_control_beat_rate"
    } else if (candidate.failureImpostorBeatRate < Number(minFailureBeatRate)) {
      candidate.failureReason = "unsat_failure_impostor_beat_rate"
    } else if (candidate.minFoldPairwiseWinRate < Number(minFoldPairwiseWinRate)) {
      candidate.failureReason = "unsat_min_fold_pairwise_win_rate"
    } else if (candidate.hardNegativeLeakCount > Number(maxHardNegativeLeakCount)) {
      candidate.failureReason = "unsat_hard_negative_leak"
    } else if (candidate.supportProjectionPositive !== true) {
      candidate.failureReason = "unsat_support_projection"
    }
    if (candidate.failureReason) {
      reasonCounts[candidate.failureReason] = Number(reasonCounts[candidate.failureReason] ?? 0) + 1
    } else {
      qualifiedCandidates.push(candidate)
    }
    if (!bestCandidate || compareCandidates(candidate, bestCandidate) < 0) bestCandidate = candidate
    if (candidatesEvaluated.length < 128) candidatesEvaluated.push(buildCandidatePreview(candidate))
  }

  const best = qualifiedCandidates.sort(compareCandidates)[0] ?? null
  return {
    ok: best != null,
    reason: best != null ? null : derivePrimaryReason(reasonCounts),
    supportFitExcluded,
    auditFeaturePoolCount: featurePool.length,
    selectedFeaturePoolCount: selectedFeaturePool.length,
    pairwiseCandidateCount,
    pairwiseQualifiedCandidateCount: qualifiedCandidates.length,
    bestCandidate: bestCandidate ? buildCandidatePreview(bestCandidate) : null,
    selectedFeatureKeys: (best?.selectedFeatures ?? []).map((feature) => feature.featureKey),
    unsatReasonCounts: reasonCounts,
    candidatesEvaluated,
  }
}
