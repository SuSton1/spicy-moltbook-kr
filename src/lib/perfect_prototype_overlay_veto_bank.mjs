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

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const deriveFeatureKeys = (rows = []) =>
  Array.from(
    new Set(
      (Array.isArray(rows) ? rows : []).flatMap((row) => Object.keys(row?.numericFeatureMap ?? {})),
    ),
  ).sort((left, right) => left.localeCompare(right))

export const matchesPerfectPrototypeOverlayVetoRule = (row, rule) => {
  const featureKey = String(rule?.featureKey ?? "").trim()
  const operator = String(rule?.operator ?? "").trim()
  const threshold = num(rule?.threshold)
  const value = num(row?.numericFeatureMap?.[featureKey])
  if (!featureKey || !Number.isFinite(threshold) || !Number.isFinite(value)) return false
  if (operator === ">=") return value >= threshold
  if (operator === "<=") return value <= threshold
  return false
}

const evaluateCandidate = ({ dataset, featureKey, operator, threshold, minNegativeRowCount = 2, minPositiveRetention = 0.75 } = {}) => {
  const vetoedTrainRows = (dataset?.trainRows ?? []).filter((row) =>
    matchesPerfectPrototypeOverlayVetoRule(row, { featureKey, operator, threshold }),
  )
  const vetoedPositiveRows = vetoedTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const vetoedNegativeRows = vetoedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  const totalPositiveCount = Math.max(1, Number(dataset?.trainPositiveRows?.length ?? 0))
  const totalNegativeCount = Math.max(1, Number(dataset?.trainNegativeRows?.length ?? 0))
  const positiveRetention = 1 - vetoedPositiveRows.length / totalPositiveCount
  const negativeRemovalRate = vetoedNegativeRows.length / totalNegativeCount
  return {
    featureKey,
    operator,
    threshold,
    vetoedPositiveSummary: summarizeRows(vetoedPositiveRows),
    vetoedNegativeSummary: summarizeRows(vetoedNegativeRows),
    positiveRetention,
    negativeRemovalRate,
    margin: negativeRemovalRate - (1 - positiveRetention),
    ok:
      vetoedNegativeRows.length >= Number(minNegativeRowCount) &&
      negativeRemovalRate > (1 - positiveRetention) &&
      positiveRetention >= Number(minPositiveRetention),
  }
}

const compareCandidates = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  if (Number(right?.margin ?? 0) !== Number(left?.margin ?? 0)) return Number(right?.margin ?? 0) - Number(left?.margin ?? 0)
  if (Number(right?.vetoedNegativeSummary?.matchedDateCount ?? 0) !== Number(left?.vetoedNegativeSummary?.matchedDateCount ?? 0)) {
    return Number(right?.vetoedNegativeSummary?.matchedDateCount ?? 0) - Number(left?.vetoedNegativeSummary?.matchedDateCount ?? 0)
  }
  return String(left?.featureKey ?? "").localeCompare(String(right?.featureKey ?? ""))
}

export const buildPerfectPrototypeOverlayVetoBank = ({
  dataset,
  maxQualifiedRules = 6,
  minNegativeRowCount = 2,
  minPositiveRetention = 0.75,
} = {}) => {
  const derivedFeatureKeys =
    Array.isArray(dataset?.derivedFeatureKeys) && dataset.derivedFeatureKeys.length > 0
      ? dataset.derivedFeatureKeys
      : deriveFeatureKeys(dataset?.trainRows ?? [])
  const candidates = []
  for (const featureKey of derivedFeatureKeys) {
    const positiveValues = (dataset?.trainPositiveRows ?? []).map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
    const negativeValues = (dataset?.trainNegativeRows ?? []).map((row) => row?.numericFeatureMap?.[featureKey]).filter(Number.isFinite)
    if (positiveValues.length < 4 || negativeValues.length < 4) continue
    const positiveMedian = quantile(positiveValues, 0.5)
    const negativeMedian = quantile(negativeValues, 0.5)
    if (!Number.isFinite(positiveMedian) || !Number.isFinite(negativeMedian) || positiveMedian === negativeMedian) continue
    const operator = negativeMedian > positiveMedian ? ">=" : "<="
    const thresholdCandidates =
      operator === ">="
        ? [quantile(negativeValues, 0.5), quantile(negativeValues, 0.75), quantile(positiveValues, 0.75)]
        : [quantile(negativeValues, 0.5), quantile(negativeValues, 0.25), quantile(positiveValues, 0.25)]
    for (const threshold of thresholdCandidates) {
      if (!Number.isFinite(num(threshold))) continue
      candidates.push(
        evaluateCandidate({
          dataset,
          featureKey,
          operator,
          threshold,
          minNegativeRowCount,
          minPositiveRetention,
        }),
      )
    }
  }
  candidates.sort(compareCandidates)
  const qualifiedRules = candidates.filter((candidate) => candidate?.ok === true).slice(0, Math.max(1, Math.floor(Number(maxQualifiedRules) || 6)))
  return {
    ok: qualifiedRules.length > 0,
    reason: qualifiedRules.length > 0 ? null : "unsat_no_veto_bank_rules",
    candidateCount: candidates.length,
    qualifiedRuleCount: qualifiedRules.length,
    qualifiedRules,
    bestCandidate: candidates[0] ?? null,
  }
}
