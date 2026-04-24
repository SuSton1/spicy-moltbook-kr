import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import { scorePerfectPrototypeSupportCorridorMetricDistance } from "./perfect_prototype_support_corridor_metric_learning.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildNeighborScore = ({ row, trainNodes = [], featureEntries = [], neighborCount = 12 } = {}) => {
  const scored = (Array.isArray(trainNodes) ? trainNodes : [])
    .map((node) => {
      const distance = scorePerfectPrototypeSupportCorridorMetricDistance({
        left: row,
        right: { numericFeatureMap: node?.numericFeatureMap ?? {} },
        featureEntries,
      })
      if (!Number.isFinite(distance)) return null
      return {
        node,
        distance,
        weight: Math.exp(-distance),
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(1, Math.floor(Number(neighborCount) || 12)))
  const weightTotal = scored.reduce((sum, entry) => sum + Number(entry.weight ?? 0), 0)
  if (weightTotal <= 0) {
    return {
      positivePotential: null,
      negativePotential: null,
      safeReachabilityScore: null,
      uncertainty: null,
      positiveNeighborShare: null,
      negativeNeighborShare: null,
      neighborCount: scored.length,
    }
  }
  const positivePotential = scored.reduce(
    (sum, entry) => sum + Number(entry.weight ?? 0) * Number(entry.node?.positivePotential ?? 0),
    0,
  ) / weightTotal
  const negativePotential = scored.reduce(
    (sum, entry) => sum + Number(entry.weight ?? 0) * Number(entry.node?.negativePotential ?? 0),
    0,
  ) / weightTotal
  const positiveNeighborShare =
    scored.filter((entry) => entry.node?.isPositiveSeed === true).length / Math.max(1, scored.length)
  const negativeNeighborShare =
    scored.filter((entry) => entry.node?.isNegativeSeed === true).length / Math.max(1, scored.length)
  const potentialGap =
    Number.isFinite(num(positivePotential)) && Number.isFinite(num(negativePotential))
      ? positivePotential - negativePotential
      : null
  const uncertainty = Number.isFinite(num(potentialGap)) ? Math.max(0, 1 - Math.abs(potentialGap)) : null
  const safeReachabilityScore =
    Number.isFinite(num(potentialGap)) && Number.isFinite(num(uncertainty))
      ? potentialGap + positivePotential * 0.25 - uncertainty * 0.25 - negativeNeighborShare * 0.1
      : null
  return {
    positivePotential,
    negativePotential,
    safeReachabilityScore,
    uncertainty,
    positiveNeighborShare,
    negativeNeighborShare,
    neighborCount: scored.length,
  }
}

export const scorePerfectPrototypeSupportGraphRows = ({
  artifact,
  rows = [],
} = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
    const tokenSet =
      row?.tokenSet instanceof Set
        ? row.tokenSet
        : new Set(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : [])
    const gatePassed =
      gateTokens.length < 1 ? true : gateTokens.every((token) => tokenSet.has(token) === true)

    const directNode = (artifact?.trainNodes ?? []).find((node) => node?.rowKey === row?.rowKey)
    const metrics = directNode
      ? {
          positivePotential: directNode.positivePotential,
          negativePotential: directNode.negativePotential,
          safeReachabilityScore: directNode.safeReachabilityScore,
          uncertainty: directNode.uncertainty,
          positiveNeighborShare: directNode.positiveNeighborShare,
          negativeNeighborShare: directNode.negativeNeighborShare,
          neighborCount: directNode.neighborCount ?? 0,
        }
      : buildNeighborScore({
          row,
          trainNodes: artifact?.trainNodes ?? [],
          featureEntries: artifact?.featureEntries ?? [],
          neighborCount: artifact?.neighborCount ?? 12,
        })

    const margin = Number(metrics.positivePotential ?? Number.NaN) - Number(metrics.negativePotential ?? Number.NaN)
    const selected =
      gatePassed &&
      Number.isFinite(num(metrics.positivePotential)) &&
      Number(metrics.positivePotential) >= Number(artifact?.selectThreshold ?? 0) &&
      Number.isFinite(num(margin)) &&
      margin >= Number(artifact?.marginThreshold ?? 0) &&
      Number.isFinite(num(metrics.safeReachabilityScore)) &&
      Number(metrics.safeReachabilityScore) >= Number(artifact?.abstainThreshold ?? 0)

    return {
      row,
      gatePassed,
      positivePotential: Number.isFinite(num(metrics.positivePotential)) ? metrics.positivePotential : null,
      negativePotential: Number.isFinite(num(metrics.negativePotential)) ? metrics.negativePotential : null,
      margin: Number.isFinite(num(margin)) ? margin : null,
      safeReachabilityScore:
        Number.isFinite(num(metrics.safeReachabilityScore)) ? metrics.safeReachabilityScore : null,
      uncertainty: Number.isFinite(num(metrics.uncertainty)) ? metrics.uncertainty : null,
      positiveNeighborShare:
        Number.isFinite(num(metrics.positiveNeighborShare)) ? metrics.positiveNeighborShare : null,
      negativeNeighborShare:
        Number.isFinite(num(metrics.negativeNeighborShare)) ? metrics.negativeNeighborShare : null,
      neighborCount: Number(metrics.neighborCount ?? 0),
      selected,
    }
  })

export const summarizePerfectPrototypeSupportGraphSelections = ({
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
    crossfitPositiveWindowCount: positiveWindowCount,
    crossfitRetainedPositiveWindowCount: positiveWindowCount,
    crossfitNegativeWindowCount: negativeWindows.size,
    supportCaseIds,
    haesungSupport:
      Array.isArray(supportCaseIds) && supportCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
    matchedDateKeys: Array.from(dateKeys).sort((left, right) => left.localeCompare(right)),
    openOosPrecision: selectedRows.length > 0 ? positiveRows.length / selectedRows.length : 0,
    openOosMatchCount: positiveRows.length,
    openOosUniqueMatchedDates: dateKeys.size,
  }
}
