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

export const applyPerfectPrototypeSupportTemporalAnchorScorer = ({
  artifact,
  rows = [],
} = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
    const gatePassed =
      gateTokens.length < 1 ? true : gateTokens.every((token) => row?.tokenSet?.has(token) === true)
    const selectedFeatures = Array.isArray(artifact?.selectedFeatures) ? artifact.selectedFeatures : []
    const featureContributions = selectedFeatures
      .map((feature) => ({
        featureKey: feature?.featureKey ?? null,
        contribution: scoreSelectedFeature({ row, feature }),
      }))
      .filter((entry) => Number.isFinite(entry.contribution))
    const anchorScore = featureContributions.reduce((sum, entry) => sum + Number(entry.contribution ?? 0), 0)
    const featureMatchCount = featureContributions.length
    const riskScore =
      Math.max(0, Number(num(row?.numericFeatureMap?.[artifact?.riskFeatureKey]) ?? 0)) +
      Math.max(0, Number(num(row?.numericFeatureMap?.[artifact?.falsePositivePressureFeatureKey]) ?? 0))
    const purityMargin = num(row?.numericFeatureMap?.[artifact?.marginFeatureKey])
    const uncertainty = Math.max(0, Number(num(row?.numericFeatureMap?.[artifact?.uncertaintyFeatureKey]) ?? 0))
    const decisionScore = anchorScore - Number(artifact?.riskWeight ?? 1) * riskScore
    const abstainScore = decisionScore + Math.max(0, Number(purityMargin ?? 0)) - Number(artifact?.uncertaintyWeight ?? 0.5) * uncertainty
    const selected =
      gatePassed &&
      featureMatchCount >= Math.max(1, Number(artifact?.minFeatureMatchCount ?? 1)) &&
      Number.isFinite(anchorScore) &&
      decisionScore >= Number(artifact?.selectThreshold ?? 0) &&
      Number.isFinite(purityMargin) &&
      purityMargin >= Number(artifact?.marginThreshold ?? 0) &&
      riskScore <= Number(artifact?.riskThreshold ?? Number.POSITIVE_INFINITY) &&
      abstainScore >= Number(artifact?.abstainThreshold ?? 0)
    return {
      row,
      gatePassed,
      featureMatchCount,
      anchorScore,
      riskScore,
      purityMargin,
      uncertainty,
      decisionScore,
      abstainScore,
      selected,
    }
  })

export const summarizePerfectPrototypeSupportTemporalAnchorSelections = ({
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
    positiveRows.map((row) => row.monthKey ?? buildMonthKey(row.dateKey)).filter(Boolean),
  )
  const foldIds = new Set(
    positiveRows.map((row) => Number(row.foldId ?? 0)).filter((value) => value > 0),
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

