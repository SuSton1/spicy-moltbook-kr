import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const scoreSelectedFeature = ({ row, feature }) => {
  const rawValue = num(row?.numericFeatureMap?.[feature?.featureKey])
  if (!Number.isFinite(rawValue)) return null
  const direction = Number(feature?.direction ?? 1) >= 0 ? 1 : -1
  const center = Number(feature?.center ?? 0)
  const scale = Math.max(0.05, Number(feature?.scale ?? 1))
  const weight = Math.max(0.05, Number(feature?.weight ?? 1))
  return weight * direction * ((rawValue - center) / scale)
}

const groupByQuery = (rows = []) => {
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

export const applyPerfectPrototypeSupportTop1QueryRanker = ({
  artifact,
  rows = [],
} = {}) => {
  const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
  const selectedFeatures = Array.isArray(artifact?.selectedFeatures) ? artifact.selectedFeatures : []
  const byQuery = groupByQuery(rows)
  const evaluations = []
  for (const bucket of byQuery.values()) {
    const scored = bucket.map((row) => {
      const gatePassed = gateTokens.length < 1 ? true : gateTokens.every((token) => row?.tokenSet?.has(token) === true)
      const featureContributions = selectedFeatures
        .map((feature) => ({
          featureKey: feature?.featureKey ?? null,
          contribution: scoreSelectedFeature({ row, feature }),
        }))
        .filter((entry) => Number.isFinite(entry.contribution))
      const queryScore = featureContributions.reduce((sum, entry) => sum + Number(entry.contribution ?? 0), 0)
      const featureMatchCount = featureContributions.length
      const riskScore =
        Math.max(0, Number(num(row?.numericFeatureMap?.[artifact?.riskFeatureKey]) ?? 0)) +
        Math.max(0, Number(num(row?.numericFeatureMap?.[artifact?.peerPressureFeatureKey]) ?? 0))
      return {
        row,
        gatePassed,
        featureContributions,
        featureMatchCount,
        queryScore,
        riskScore,
      }
    })
    scored.sort((left, right) => {
      if (right.queryScore !== left.queryScore) return right.queryScore - left.queryScore
      return String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? ""))
    })
    const topScore = Number(scored[0]?.queryScore ?? Number.NEGATIVE_INFINITY)
    const hasRunnerUp = scored.length > 1
    const runnerUpScore = hasRunnerUp ? Number(scored[1]?.queryScore ?? topScore) : Number.NEGATIVE_INFINITY
    const queryGap = hasRunnerUp ? topScore - runnerUpScore : Number.POSITIVE_INFINITY
    for (let index = 0; index < scored.length; index += 1) {
      const entry = scored[index]
      const isTop1 = index === 0
      const abstainScore = entry.queryScore + Math.max(0, queryGap) - Number(artifact?.riskWeight ?? 1) * entry.riskScore
      const selected =
        isTop1 &&
        entry.gatePassed &&
        entry.featureMatchCount >= Math.max(1, Number(artifact?.minFeatureMatchCount ?? 1)) &&
        entry.queryScore >= Number(artifact?.selectThreshold ?? 0) &&
        queryGap >= Number(artifact?.gapThreshold ?? 0) &&
        entry.riskScore <= Number(artifact?.riskThreshold ?? Number.POSITIVE_INFINITY) &&
        abstainScore >= Number(artifact?.abstainThreshold ?? 0)
      evaluations.push({
        row: entry.row,
        gatePassed: entry.gatePassed,
        featureMatchCount: entry.featureMatchCount,
        featureContributions: entry.featureContributions,
        queryScore: entry.queryScore,
        runnerUpScore,
        queryGap,
        riskScore: entry.riskScore,
        abstainScore,
        isTop1,
        selected,
      })
    }
  }
  return evaluations
}

export const summarizePerfectPrototypeSupportTop1Selections = ({
  evaluations = [],
  supportCaseIds = [],
  minWindowSupport = 2,
} = {}) => {
  const selectedRows = (Array.isArray(evaluations) ? evaluations : [])
    .filter((entry) => entry.selected === true)
    .map((entry) => entry.row)
  const positiveRows = selectedRows.filter((row) => row.outcomeHitTarget === true)
  const negativeRows = selectedRows.filter((row) => row.outcomeHitTarget !== true)
  const dateKeys = new Set(positiveRows.map((row) => row.dateKey).filter(Boolean))
  const monthKeys = new Set(
    positiveRows.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  )
  const foldIds = new Set(
    positiveRows.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  )
  const positiveByWindow = new Map()
  const negativeWindows = new Set()
  for (const row of selectedRows) {
    const windowId = Number(row?.windowId ?? 0)
    if (windowId < 1) continue
    if (row.outcomeHitTarget === true) {
      positiveByWindow.set(windowId, Number(positiveByWindow.get(windowId) ?? 0) + 1)
    } else {
      negativeWindows.add(windowId)
    }
  }
  let positiveWindowCount = 0
  for (const count of positiveByWindow.values()) {
    if (count >= Math.max(1, Math.floor(Number(minWindowSupport) || 1))) positiveWindowCount += 1
  }
  return {
    selectedRowCount: selectedRows.length,
    positiveRowCount: positiveRows.length,
    negativeRowCount: negativeRows.length,
    precision: selectedRows.length > 0 ? positiveRows.length / selectedRows.length : 0,
    trainMatchedDateCount: dateKeys.size,
    trainMatchedMonthCount: monthKeys.size,
    trainMatchedFoldCount: foldIds.size,
    nonSupportTrainMatchedDateCount: dateKeys.size,
    nonSupportTrainMatchedMonthCount: monthKeys.size,
    nonSupportTrainMatchedFoldCount: foldIds.size,
    matchedDateKeys: Array.from(dateKeys).sort((left, right) => left.localeCompare(right)),
    matchedMonthKeys: Array.from(monthKeys).sort((left, right) => left.localeCompare(right)),
    matchedFoldIds: Array.from(foldIds).sort((left, right) => left - right),
    crossfitPositiveWindowCount: positiveWindowCount,
    crossfitRetainedPositiveWindowCount: positiveWindowCount,
    crossfitNegativeWindowCount: negativeWindows.size,
    supportCaseIds,
    haesungSupport:
      Array.isArray(supportCaseIds) && supportCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
  }
}
