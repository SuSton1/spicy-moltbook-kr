import { scorePerfectPrototypeSupportAtlasCell } from "./perfect_prototype_support_atlas_metric.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const evaluateCell = ({ artifact, cell, row } = {}) => {
  const precomputed = row?.atlasMetricsByCell?.[cell?.cellId]
  const evaluation =
    precomputed ??
    scorePerfectPrototypeSupportAtlasCell({
      row,
      cell,
      dataset: {
        featureKeys: artifact?.featureKeys ?? [],
        featureScales: artifact?.featureScales ?? {},
      },
    })
  const posDistance = Number(evaluation?.posDistance)
  const margin = Number(evaluation?.margin)
  const score = Number(evaluation?.score)
  const positiveRadius = Number(cell?.positiveRadius ?? cell?.acceptanceRadius)
  const vetoMargin = Number(cell?.negativeMargin ?? cell?.vetoMargin)
  const scoreThreshold = Number(cell?.scoreThreshold ?? 0)
  const minPositiveVotes = Math.max(1, Number(cell?.minPositiveVotes ?? 1))
  const positiveDistances = Array.isArray(evaluation?.positiveDistances) ? evaluation.positiveDistances : null
  const positiveVoteCount = Array.isArray(positiveDistances)
    ? positiveDistances.filter((distance) => Number(distance) <= positiveRadius).length
    : minPositiveVotes
  return (
    Number.isFinite(posDistance) &&
    Number.isFinite(margin) &&
    Number.isFinite(score) &&
    Number.isFinite(positiveRadius) &&
    Number.isFinite(vetoMargin) &&
    Number.isFinite(scoreThreshold) &&
    positiveVoteCount >= minPositiveVotes &&
    posDistance <= positiveRadius &&
    margin >= vetoMargin &&
    score >= scoreThreshold
  )
}

export const applyPerfectPrototypeSupportAtlas = ({
  artifact,
  rows = [],
} = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
    const gatePassed =
      gateTokens.length < 1 ? true : gateTokens.every((token) => row?.tokenSet?.has(token) === true)
    const matchedCellIds = []
    let bestScore = Number.NEGATIVE_INFINITY
    for (const cell of Array.isArray(artifact?.cells) ? artifact.cells : []) {
      const evaluation =
        row?.atlasMetricsByCell?.[cell?.cellId] ??
        scorePerfectPrototypeSupportAtlasCell({
          row,
          cell,
          dataset: {
            featureKeys: artifact?.featureKeys ?? [],
            featureScales: artifact?.featureScales ?? {},
          },
        })
      const rowScore = Number(evaluation?.score)
      if (Number.isFinite(rowScore) && rowScore > bestScore) bestScore = rowScore
      if (evaluateCell({ artifact, cell, row })) matchedCellIds.push(cell.cellId)
    }
    const abstainThreshold = toNumber(artifact?.abstainThreshold, 0)
    const selected = gatePassed && matchedCellIds.length > 0 && bestScore >= abstainThreshold
    return {
      row,
      gatePassed,
      matchedCellIds,
      bestScore: Number.isFinite(bestScore) ? bestScore : null,
      selected,
    }
  })

export const summarizePerfectPrototypeSupportAtlasSelections = ({
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
    crossfitPositiveWindowCount: positiveWindowCount,
    crossfitNegativeWindowCount: negativeWindows.size,
    supportCaseIds,
    haesungSupport: Array.isArray(supportCaseIds) && supportCaseIds.includes("076610:2026-03-18"),
    matchedDateKeys: Array.from(dateKeys).sort((left, right) => left.localeCompare(right)),
  }
}
