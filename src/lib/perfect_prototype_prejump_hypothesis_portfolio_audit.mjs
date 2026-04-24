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

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const featureBucketOf = (featureKey) => {
  const parts = String(featureKey ?? "").trim().split(".").filter(Boolean)
  return parts.slice(0, Math.min(4, parts.length)).join(".")
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

const buildRowLookup = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

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

const deriveFailureReason = ({
  pairwiseWinRate,
  sameDateRunnerUpBeatRate,
  matchedControlBeatRate,
  failureImpostorBeatRate,
  minFoldPairwiseWinRate,
  hardNegativeLeakCount,
  supportProjectionPositive,
  thresholds,
} = {}) => {
  if (pairwiseWinRate < Number(thresholds?.minPairwiseWinRate ?? 0.9)) return "unsat_pairwise_win_rate"
  if (sameDateRunnerUpBeatRate < Number(thresholds?.minSameDateBeatRate ?? 0.9)) return "unsat_same_date_runner_up_beat_rate"
  if (matchedControlBeatRate < Number(thresholds?.minMatchedControlBeatRate ?? 0.85))
    return "unsat_matched_control_beat_rate"
  if (failureImpostorBeatRate < Number(thresholds?.minFailureBeatRate ?? 0.85)) return "unsat_failure_impostor_beat_rate"
  if (minFoldPairwiseWinRate < Number(thresholds?.minFoldPairwiseWinRate ?? 0.8)) return "unsat_min_fold_pairwise_win_rate"
  if (hardNegativeLeakCount > Number(thresholds?.maxHardNegativeLeakCount ?? 0)) return "unsat_hard_negative_leak"
  if (supportProjectionPositive !== true) return "unsat_support_projection"
  return null
}

export const auditPerfectPrototypePrejumpHypothesisPortfolio = ({
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
      queryCandidateCount: 0,
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      hypothesisReports: [],
    }
  }

  const positiveRows = Array.isArray(family?.calibrationPositiveRows) ? family.calibrationPositiveRows : []
  const negativeRows = Array.isArray(family?.calibrationNegativeRows) ? family.calibrationNegativeRows : []
  const allRows = [...positiveRows, ...negativeRows, ...(family?.supportCaseViews ?? [])]
  const rowLookup = buildRowLookup(allRows)
  const allPairs = Array.isArray(family?.portfolioPairs) ? family.portfolioPairs : []
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

  const thresholds = {
    minPairwiseWinRate,
    minSameDateBeatRate,
    minMatchedControlBeatRate,
    minFailureBeatRate,
    minFoldPairwiseWinRate,
    maxHardNegativeLeakCount,
  }

  const hypothesisReports = []
  const unsatReasonCounts = {}
  let pairwiseCandidateCount = 0
  let pairwiseQualifiedCandidateCount = 0
  let bestCandidate = null
  let bestQualified = null

  for (const hypothesis of Array.isArray(family?.portfolioHypotheses) ? family.portfolioHypotheses : []) {
    const selectedFeaturePool = collectFeatureCandidates({
      positiveRows,
      negativeRows,
      featureKeys: hypothesis?.featureKeys ?? [],
      maxFeatures,
    })
    const report = {
      hypothesisId: hypothesis?.id ?? null,
      label: hypothesis?.label ?? null,
      featurePoolCount: uniqueStrings(hypothesis?.featureKeys ?? []).length,
      auditFeaturePoolCount: selectedFeaturePool.length,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      bestCandidate: null,
      selectedFeatureKeys: [],
      reason: null,
    }
    if (selectedFeaturePool.length < 2) {
      report.reason = "unsat_no_hypothesis_feature_candidates"
      unsatReasonCounts[report.reason] = Number(unsatReasonCounts[report.reason] ?? 0) + 1
      hypothesisReports.push(report)
      continue
    }

    let bestForHypothesis = null
    let bestQualifiedForHypothesis = null
    for (let featureCount = 2; featureCount <= selectedFeaturePool.length; featureCount += 1) {
      const selectedFeatures = selectedFeaturePool.slice(0, featureCount)
      pairwiseCandidateCount += 1
      report.candidateCount += 1
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
      const failureReason = deriveFailureReason({
        pairwiseWinRate: pairwise.rate,
        sameDateRunnerUpBeatRate: sameDate.rate,
        matchedControlBeatRate: matchedControl.rate,
        failureImpostorBeatRate: failure.rate,
        minFoldPairwiseWinRate: minFoldRate,
        hardNegativeLeakCount,
        supportProjectionPositive,
        thresholds,
      })
      const candidate = {
        hypothesisId: hypothesis?.id ?? null,
        label: hypothesis?.label ?? null,
        featureCount,
        selectedFeatureKeys: selectedFeatures.map((feature) => feature.featureKey),
        selectedFeatures,
        pairwiseWinRate: pairwise.rate,
        sameDateRunnerUpBeatRate: sameDate.rate,
        matchedControlBeatRate: matchedControl.rate,
        failureImpostorBeatRate: failure.rate,
        minFoldPairwiseWinRate: minFoldRate,
        hardNegativeLeakCount,
        supportProjectionPositive,
        failureReason,
      }
      if (!bestForHypothesis || compareCandidates(candidate, bestForHypothesis) < 0) bestForHypothesis = candidate
      if (!bestCandidate || compareCandidates(candidate, bestCandidate) < 0) bestCandidate = candidate
      if (!failureReason) {
        report.qualifiedCandidateCount += 1
        pairwiseQualifiedCandidateCount += 1
        if (!bestQualifiedForHypothesis || compareCandidates(candidate, bestQualifiedForHypothesis) < 0) {
          bestQualifiedForHypothesis = candidate
        }
        if (!bestQualified || compareCandidates(candidate, bestQualified) < 0) bestQualified = candidate
      }
    }

    report.bestCandidate = bestQualifiedForHypothesis ?? bestForHypothesis
    report.selectedFeatureKeys = report.bestCandidate?.selectedFeatureKeys ?? []
    report.reason = report.bestCandidate?.failureReason ?? null
    if (report.reason) {
      unsatReasonCounts[report.reason] = Number(unsatReasonCounts[report.reason] ?? 0) + 1
    }
    hypothesisReports.push(report)
  }

  const chosen = bestQualified ?? bestCandidate
  return {
    ok: Boolean(bestQualified),
    reason: bestQualified ? null : chosen?.failureReason ?? "unsat_no_portfolio_hypotheses",
    supportFitExcluded,
    supportLeaveOneOutRecovered: false,
    pairwiseCandidateCount,
    pairwiseQualifiedCandidateCount,
    queryCandidateCount: bestQualified ? 1 : 0,
    selectedHypothesisId: bestQualified?.hypothesisId ?? null,
    selectedFeatureKeys: bestQualified?.selectedFeatureKeys ?? [],
    bestHypothesis: chosen ?? null,
    hypothesisReports,
    unsatReasonCounts,
  }
}
