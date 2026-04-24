const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const clusterPressureFeatureKey = (clusterId) => `sig.vetoRegime.cluster.${clusterId}.pressure`

const recordReason = (counts, reason) => {
  counts[reason] = Number(counts[reason] ?? 0) + 1
}

const passesVeto = ({ row, artifact } = {}) => {
  const numericFeatureMap = row?.numericFeatureMap ?? {}
  for (const cluster of artifact?.clusters ?? []) {
    const pressure = Number(num(numericFeatureMap?.[clusterPressureFeatureKey(cluster.clusterId)]) ?? Number.POSITIVE_INFINITY)
    if (pressure > Number(cluster.threshold ?? 0)) return false
  }
  const maxPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.maxPressure"]) ?? Number.POSITIVE_INFINITY)
  const totalPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.totalPressure"]) ?? Number.POSITIVE_INFINITY)
  const cleanMargin = Number(num(numericFeatureMap?.["sig.vetoRegime.cleanMargin"]) ?? Number.NEGATIVE_INFINITY)
  return (
    maxPressure <= Number(artifact?.maxPressureThreshold ?? Number.POSITIVE_INFINITY) &&
    totalPressure <= Number(artifact?.totalPressureThreshold ?? Number.POSITIVE_INFINITY) &&
    cleanMargin >= Number(artifact?.cleanMarginThreshold ?? Number.NEGATIVE_INFINITY)
  )
}

const combinations = (items = [], minSize = 1, maxSize = 1) => {
  const out = []
  const walk = (start, bucket) => {
    if (bucket.length >= minSize && bucket.length <= maxSize) out.push([...bucket])
    if (bucket.length === maxSize) return
    for (let index = start; index < items.length; index += 1) {
      bucket.push(items[index])
      walk(index + 1, bucket)
      bucket.pop()
    }
  }
  walk(0, [])
  return out
}

const compareCandidates = (left, right) => {
  if (Number(left?.survivingNegativeSummary?.rowCount ?? 0) !== Number(right?.survivingNegativeSummary?.rowCount ?? 0)) {
    return Number(left?.survivingNegativeSummary?.rowCount ?? 0) - Number(right?.survivingNegativeSummary?.rowCount ?? 0)
  }
  if (Number(right?.survivingPositiveSummary?.matchedDateCount ?? 0) !== Number(left?.survivingPositiveSummary?.matchedDateCount ?? 0)) {
    return Number(right?.survivingPositiveSummary?.matchedDateCount ?? 0) - Number(left?.survivingPositiveSummary?.matchedDateCount ?? 0)
  }
  if (Number(right?.survivingPositiveSummary?.matchedFoldCount ?? 0) !== Number(left?.survivingPositiveSummary?.matchedFoldCount ?? 0)) {
    return Number(right?.survivingPositiveSummary?.matchedFoldCount ?? 0) - Number(left?.survivingPositiveSummary?.matchedFoldCount ?? 0)
  }
  return Number(left?.clusters?.length ?? 0) - Number(right?.clusters?.length ?? 0)
}

export const calibratePerfectPrototypeSupportNegativeRegimeVeto = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxClustersPerCandidate = 3,
  maxClusterUniverse = 4,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      candidatesEvaluated: [],
    }
  }

  const clusters = (family?.negativeRegimeClusters ?? []).slice(0, Math.max(1, Math.floor(Number(maxClusterUniverse) || 4)))
  if (clusters.length < 1) {
    return {
      ok: false,
      reason: "unsat_no_negative_regime_clusters",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_no_negative_regime_clusters: 1 },
      candidatesEvaluated: [],
    }
  }

  const positiveRows = family?.failureRegimePositiveRows ?? []
  const negativeRows = family?.failureRegimeNegativeRows ?? []
  const supportRows = family?.supportCaseViews ?? []
  const reasonCounts = {}
  const candidatesEvaluated = []
  const qualifiedCandidates = []
  let bestCandidate = null
  let candidateCount = 0

  const clusterCombos = combinations(clusters, 1, Math.min(clusters.length, Math.max(1, Math.floor(Number(maxClustersPerCandidate) || 3))))
  for (const clusterSet of clusterCombos) {
    const thresholdOptions = clusterSet.map((cluster) => {
      const featureKey = clusterPressureFeatureKey(cluster.clusterId)
      const positiveValues = positiveRows.map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
      const negativeValues = negativeRows.map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
      return uniqueNumbers([
        0,
        quantile(positiveValues, 0.75),
        quantile(positiveValues, 0.9),
        quantile(negativeValues, 0.1),
        quantile(negativeValues, 0.25),
      ]).filter(Number.isFinite)
    })
    const cleanMarginPositive = positiveRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.cleanMargin"]).filter(Number.isFinite)
    const cleanMarginNegative = negativeRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.cleanMargin"]).filter(Number.isFinite)
    const maxPressurePositive = positiveRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.maxPressure"]).filter(Number.isFinite)
    const maxPressureNegative = negativeRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.maxPressure"]).filter(Number.isFinite)
    const totalPressurePositive = positiveRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.totalPressure"]).filter(Number.isFinite)
    const totalPressureNegative = negativeRows.map((row) => row?.numericFeatureMap?.["sig.vetoRegime.totalPressure"]).filter(Number.isFinite)
    const cleanMarginThresholds = uniqueNumbers([
      0,
      quantile(cleanMarginPositive, 0.1),
      quantile(cleanMarginPositive, 0.25),
      quantile(cleanMarginNegative, 0.9),
    ]).filter(Number.isFinite)
    const maxPressureThresholds = uniqueNumbers([
      0,
      quantile(maxPressurePositive, 0.75),
      quantile(maxPressurePositive, 0.9),
      quantile(maxPressureNegative, 0.1),
      quantile(maxPressureNegative, 0.25),
    ]).filter(Number.isFinite)
    const totalPressureThresholds = uniqueNumbers([
      0,
      quantile(totalPressurePositive, 0.75),
      quantile(totalPressurePositive, 0.9),
      quantile(totalPressureNegative, 0.1),
      quantile(totalPressureNegative, 0.25),
    ]).filter(Number.isFinite)

    const walkThresholds = (index, clusterThresholds) => {
      if (index >= clusterSet.length) {
        for (const cleanMarginThreshold of cleanMarginThresholds) {
          for (const maxPressureThreshold of maxPressureThresholds) {
            for (const totalPressureThreshold of totalPressureThresholds) {
              candidateCount += 1
              const artifact = {
                familyId: family?.familyId ?? "support_failure_regime_veto_top1",
                clusters: clusterSet.map((cluster, clusterIndex) => ({
                  clusterId: cluster.clusterId,
                  threshold: clusterThresholds[clusterIndex],
                })),
                cleanMarginThreshold,
                maxPressureThreshold,
                totalPressureThreshold,
                supportAcceptanceOnly: true,
              }
              const survivingPositiveRows = positiveRows.filter((row) => passesVeto({ row, artifact }))
              const survivingNegativeRows = negativeRows.filter((row) => passesVeto({ row, artifact }))
              const survivingSupportRows = supportRows.filter((row) => passesVeto({ row, artifact }))
              const survivingPositiveSummary = summarizeRows(survivingPositiveRows)
              const survivingNegativeSummary = summarizeRows(survivingNegativeRows)
              const supportProjectionPositive = survivingSupportRows.length > 0
              const failureReason =
                survivingNegativeSummary.rowCount > 0
                  ? "unsat_veto_negative_leak"
                  : survivingPositiveSummary.matchedDateCount < Number(minTrainMatchedDates)
                    || survivingPositiveSummary.matchedMonthCount < Number(minTrainMatchedMonths)
                    || survivingPositiveSummary.matchedFoldCount < Number(minTrainMatchedFolds)
                    ? "unsat_veto_train_breadth"
                    : supportProjectionPositive !== true
                      ? "unsat_veto_support_projection"
                      : null
              const candidate = {
                clusters: artifact.clusters,
                cleanMarginThreshold,
                maxPressureThreshold,
                totalPressureThreshold,
                supportProjectionPositive,
                survivingPositiveSummary,
                survivingNegativeSummary,
                failureReason,
                artifact,
              }
              candidatesEvaluated.push(candidate)
              if (failureReason) {
                recordReason(reasonCounts, failureReason)
              } else {
                qualifiedCandidates.push(candidate)
              }
              if (!bestCandidate || compareCandidates(candidate, bestCandidate) < 0) {
                bestCandidate = candidate
              }
            }
          }
        }
        return
      }
      for (const threshold of thresholdOptions[index]) {
        clusterThresholds.push(threshold)
        walkThresholds(index + 1, clusterThresholds)
        clusterThresholds.pop()
      }
    }
    if (thresholdOptions.every((entry) => entry.length > 0) && cleanMarginThresholds.length > 0 && maxPressureThresholds.length > 0 && totalPressureThresholds.length > 0) {
      walkThresholds(0, [])
    }
  }

  const solution = qualifiedCandidates.sort(compareCandidates)[0] ?? null
  return {
    ok: solution != null,
    reason:
      solution != null
        ? null
        : Object.entries(reasonCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
          "unsat_no_negative_regime_veto_candidates",
    supportFitExcluded,
    candidateCount,
    qualifiedCandidateCount: qualifiedCandidates.length,
    selectedClusterUniverseCount: clusters.length,
    bestCandidate,
    artifact: solution?.artifact ?? null,
    supportProjectionPositive: solution?.supportProjectionPositive === true,
    survivingPositiveSummary: solution?.survivingPositiveSummary ?? null,
    survivingNegativeSummary: solution?.survivingNegativeSummary ?? null,
    unsatReasonCounts: reasonCounts,
    candidatesEvaluated: candidatesEvaluated.slice(0, 50),
  }
}
