const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
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

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const scoreRow = ({ row, featureSpecs = [] } = {}) => {
  const contributions = (Array.isArray(featureSpecs) ? featureSpecs : [])
    .map((feature) => {
      const rawValue = num(row?.numericFeatureMap?.[feature?.featureKey])
      if (!Number.isFinite(rawValue)) return null
      return Number(feature?.weight ?? 1) * Number(feature?.direction ?? 1) * ((rawValue - Number(feature?.center ?? 0)) / Math.max(0.05, Number(feature?.scale ?? 1)))
    })
    .filter(Number.isFinite)
  return average(contributions) ?? Number.NEGATIVE_INFINITY
}

const groupRowsByQuery = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    if (!queryId) continue
    const bucket = grouped.get(queryId) ?? []
    bucket.push(row)
    grouped.set(queryId, bucket)
  }
  return grouped
}

const summarizeSelectedQueries = (selected = []) => {
  const dateKeys = new Set()
  const monthKeys = new Set()
  const foldIds = new Set()
  const positiveWindowIds = new Set()
  const negativeWindowIds = new Set()
  let positiveCount = 0
  let negativeCount = 0
  for (const entry of Array.isArray(selected) ? selected : []) {
    const row = entry?.topRow
    if (!row) continue
    if (row.outcomeHitTarget === true) {
      positiveCount += 1
      if (row.dateKey) dateKeys.add(row.dateKey)
      const monthKey = row?.monthKey ?? buildMonthKey(row?.dateKey)
      if (monthKey) monthKeys.add(monthKey)
      const foldId = Number(row?.foldId ?? 0)
      if (foldId > 0) foldIds.add(foldId)
      const windowId = Number(row?.windowId ?? 0)
      if (windowId > 0) positiveWindowIds.add(windowId)
    } else {
      negativeCount += 1
      const windowId = Number(row?.windowId ?? 0)
      if (windowId > 0) negativeWindowIds.add(windowId)
    }
  }
  const total = positiveCount + negativeCount
  return {
    selectedRowCount: total,
    positiveRowCount: positiveCount,
    negativeRowCount: negativeCount,
    precision: total > 0 ? positiveCount / total : 0,
    trainMatchedDateCount: dateKeys.size,
    trainMatchedMonthCount: monthKeys.size,
    trainMatchedFoldCount: foldIds.size,
    crossfitPositiveWindowCount: positiveWindowIds.size,
    crossfitNegativeWindowCount: negativeWindowIds.size,
  }
}

const evaluateQueries = ({ rows = [], threshold = 0, gapThreshold = 0, featureSpecs = [] } = {}) => {
  const byQuery = groupRowsByQuery(rows)
  const selected = []
  const allQueryResults = []
  for (const [queryId, bucket] of byQuery.entries()) {
    const scored = bucket
      .map((row) => ({
        row,
        score: scoreRow({ row, featureSpecs }),
      }))
      .sort((left, right) => right.score - left.score || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))
    const top = scored[0]
    const runnerUp = scored[1]
    const gap = Number(top?.score ?? Number.NEGATIVE_INFINITY) - Number(runnerUp?.score ?? top?.score ?? Number.NEGATIVE_INFINITY)
    const accepted = Number(top?.score ?? Number.NEGATIVE_INFINITY) >= Number(threshold) && gap >= Number(gapThreshold)
    const result = {
      queryId,
      queryLabel: String(top?.row?.queryLabel ?? "unlabeled"),
      topRow: top?.row ?? null,
      topScore: top?.score ?? Number.NEGATIVE_INFINITY,
      runnerUpScore: runnerUp?.score ?? top?.score ?? Number.NEGATIVE_INFINITY,
      gap,
      accepted,
      topIsPositive: top?.row?.outcomeHitTarget === true,
    }
    allQueryResults.push(result)
    if (accepted) selected.push(result)
  }
  return { selected, allQueryResults }
}

const derivePrimaryReason = (reasonCounts = {}) =>
  Object.entries(reasonCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "unsat_no_query_candidate"

const previewCandidate = (candidate) => ({
  candidateId: candidate.candidateId,
  selectedFeatureKeys: candidate.selectedFeatureKeys,
  threshold: candidate.threshold,
  gapThreshold: candidate.gapThreshold,
  trainSummary: candidate.trainSummary,
  supportProjectionPositive: candidate.supportProjectionPositive,
  supportProjectionScore: candidate.supportProjectionScore,
  failureReason: candidate.failureReason,
})

export const auditPerfectPrototypeSupportSeparabilityQueries = ({
  family,
  pairwiseAudit,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      candidates: [],
      candidatePreviews: [],
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
    }
  }

  const sourceCandidates = (pairwiseAudit?.candidates ?? []).slice(0, 24)
  if (sourceCandidates.length < 1) {
    return {
      ok: false,
      reason: pairwiseAudit?.reason ?? "unsat_no_query_candidate",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      candidates: [],
      candidatePreviews: [],
      unsatReasonCounts: { [pairwiseAudit?.reason ?? "unsat_no_query_candidate"]: 1 },
    }
  }

  const unsatReasonCounts = {}
  const candidates = []
  for (const baseCandidate of sourceCandidates) {
    const featureSpecs = Array.isArray(baseCandidate?.featureSpecs) ? baseCandidate.featureSpecs : []
    const positiveQueryScores = evaluateQueries({
      rows: (family?.gatedTrainRows ?? []).filter((row) => String(row?.queryLabel ?? "") === "positive"),
      threshold: Number.NEGATIVE_INFINITY,
      gapThreshold: Number.NEGATIVE_INFINITY,
      featureSpecs,
    }).allQueryResults.map((entry) => Number(entry?.topScore ?? Number.NEGATIVE_INFINITY)).filter(Number.isFinite)
    const negativeQueryScores = evaluateQueries({
      rows: (family?.gatedTrainRows ?? []).filter((row) => String(row?.queryLabel ?? "") === "negative"),
      threshold: Number.NEGATIVE_INFINITY,
      gapThreshold: Number.NEGATIVE_INFINITY,
      featureSpecs,
    }).allQueryResults.map((entry) => Number(entry?.topScore ?? Number.NEGATIVE_INFINITY)).filter(Number.isFinite)
    const positiveGaps = evaluateQueries({
      rows: (family?.gatedTrainRows ?? []).filter((row) => String(row?.queryLabel ?? "") === "positive"),
      threshold: Number.NEGATIVE_INFINITY,
      gapThreshold: Number.NEGATIVE_INFINITY,
      featureSpecs,
    }).allQueryResults.map((entry) => Number(entry?.gap ?? 0)).filter(Number.isFinite)
    const thresholdCandidates = uniqueNumbers([
      quantile(positiveQueryScores, 0.1),
      quantile(positiveQueryScores, 0.25),
      quantile(positiveQueryScores, 0.5),
      0,
      (quantile(positiveQueryScores, 0.1) ?? 0) + ((quantile(negativeQueryScores, 0.9) ?? 0) - (quantile(positiveQueryScores, 0.1) ?? 0)) / 2,
    ])
    const gapThresholdCandidates = uniqueNumbers([0, quantile(positiveGaps, 0.1), quantile(positiveGaps, 0.25), quantile(positiveGaps, 0.5)])

    for (const threshold of thresholdCandidates) {
      for (const gapThreshold of gapThresholdCandidates) {
        const trainEval = evaluateQueries({
          rows: family?.gatedTrainRows ?? [],
          threshold,
          gapThreshold,
          featureSpecs,
        })
        const supportEval = evaluateQueries({
          rows: family?.supportCaseViews ?? [],
          threshold,
          gapThreshold,
          featureSpecs,
        })
        const trainSummary = summarizeSelectedQueries(trainEval.selected)
        const supportProjectionScore =
          supportEval.allQueryResults.length > 0 ? Number(supportEval.allQueryResults[0]?.topScore ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY
        const supportProjectionPositive =
          supportEval.selected.some((entry) => entry?.topRow?.outcomeHitTarget === true)
        let failureReason = null
        if (Number(trainSummary.precision ?? 0) < 1) {
          failureReason = "unsat_query_train_precision"
        } else if (Number(trainSummary.trainMatchedDateCount ?? 0) < Number(minTrainMatchedDates)) {
          failureReason = "unsat_query_train_breadth_dates"
        } else if (Number(trainSummary.trainMatchedMonthCount ?? 0) < Number(minTrainMatchedMonths)) {
          failureReason = "unsat_query_train_breadth_months"
        } else if (Number(trainSummary.trainMatchedFoldCount ?? 0) < Number(minTrainMatchedFolds)) {
          failureReason = "unsat_query_train_breadth_folds"
        } else if (Number(trainSummary.crossfitNegativeWindowCount ?? 0) > Number(maxCrossfitNegativeWindows)) {
          failureReason = "unsat_query_crossfit_negative_leak"
        } else if (!supportProjectionPositive) {
          failureReason = "unsat_query_support_projection"
        }
        if (failureReason) {
          unsatReasonCounts[failureReason] = Number(unsatReasonCounts[failureReason] ?? 0) + 1
        }
        candidates.push({
          candidateId: `${baseCandidate?.candidateId ?? "candidate"}:${threshold}:${gapThreshold}`,
          selectedFeatureKeys: baseCandidate?.selectedFeatureKeys ?? [],
          featureSpecs,
          threshold,
          gapThreshold,
          trainSummary,
          supportProjectionScore,
          supportProjectionPositive,
          failureReason,
          qualified: !failureReason,
        })
      }
    }
  }

  candidates.sort((left, right) => {
    if (Number(right.qualified) !== Number(left.qualified)) return Number(right.qualified) - Number(left.qualified)
    if (Number(right?.trainSummary?.precision ?? 0) !== Number(left?.trainSummary?.precision ?? 0)) {
      return Number(right?.trainSummary?.precision ?? 0) - Number(left?.trainSummary?.precision ?? 0)
    }
    if (Number(right?.trainSummary?.trainMatchedDateCount ?? 0) !== Number(left?.trainSummary?.trainMatchedDateCount ?? 0)) {
      return Number(right?.trainSummary?.trainMatchedDateCount ?? 0) - Number(left?.trainSummary?.trainMatchedDateCount ?? 0)
    }
    return String(left?.candidateId ?? "").localeCompare(String(right?.candidateId ?? ""))
  })

  return {
    ok: candidates.some((candidate) => candidate.qualified),
    reason: candidates.some((candidate) => candidate.qualified) ? null : derivePrimaryReason(unsatReasonCounts),
    supportFitExcluded,
    supportLeaveOneOutRecovered: candidates.some((candidate) => candidate.qualified && candidate.supportProjectionPositive),
    candidateCount: candidates.length,
    qualifiedCandidateCount: candidates.filter((candidate) => candidate.qualified).length,
    bestCandidate: candidates[0] ?? null,
    bestTrainSummary: candidates[0]?.trainSummary ?? null,
    candidates,
    candidatePreviews: candidates.slice(0, 40).map((candidate) => previewCandidate(candidate)),
    unsatReasonCounts,
  }
}

