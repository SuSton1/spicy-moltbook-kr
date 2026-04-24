const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

export const evaluatePerfectPrototypeSupportScorecardTerm = (term, row) => {
  if (!term || !row) return false
  if (term.kind === "categorical_present") {
    return row?.tokenSet?.has(term.token) === true
  }
  const value = Number(row?.numericFeatureMap?.[term.featureKey])
  const threshold = Number(term?.threshold)
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false
  if (term.operator === ">=") return value >= threshold
  if (term.operator === "<=") return value <= threshold
  return false
}

export const scorePerfectPrototypeSupportScorecardRow = ({
  artifact,
  row,
} = {}) => {
  const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
  const gatePassed =
    gateTokens.length < 1 ? true : gateTokens.every((token) => row?.tokenSet?.has(token) === true)
  const matchedTerms = []
  let score = 0
  for (const term of Array.isArray(artifact?.terms) ? artifact.terms : []) {
    if (!evaluatePerfectPrototypeSupportScorecardTerm(term, row)) continue
    matchedTerms.push(term.termId)
    score += toNumber(term.weight, 0)
  }
  const threshold = toNumber(artifact?.threshold, 1)
  return {
    gatePassed,
    matchedTerms,
    score,
    selected: gatePassed && score >= threshold,
  }
}

export const applyPerfectPrototypeSupportScorecard = ({
  artifact,
  rows = [],
} = {}) => {
  const evaluations = (Array.isArray(rows) ? rows : []).map((row) => ({
    row,
    ...scorePerfectPrototypeSupportScorecardRow({
      artifact,
      row,
    }),
  }))
  return evaluations
}

export const summarizePerfectPrototypeSupportScorecardSelections = ({
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
  const foldIds = new Set(positiveRows.map((row) => Number(row.foldId ?? 0)).filter((value) => value > 0))
  const symbolKeys = new Set(selectedRows.map((row) => row.symbol).filter(Boolean))
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
    uniqueMatchedSymbols: symbolKeys.size,
    crossfitPositiveWindowCount: positiveWindowCount,
    crossfitNegativeWindowCount: negativeWindows.size,
    supportCaseIds,
    haesungSupport: Array.isArray(supportCaseIds) && supportCaseIds.includes("076610:2026-03-18"),
    matchedSourceIds: selectedRows.map((row) => row.sourceId).filter(Boolean).sort(),
    matchedDateKeys: Array.from(dateKeys).sort((left, right) => left.localeCompare(right)),
  }
}

