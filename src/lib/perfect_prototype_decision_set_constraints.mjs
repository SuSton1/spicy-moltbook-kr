const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const cloneMatchedRow = (row) => ({
  rowKey:
    toText(row?.rowKey) ??
    [
      toText(row?.sourceId) ?? "?",
      toText(row?.dateKey) ?? "?",
      toText(row?.symbol) ?? "?",
      String(Boolean(row?.outcomeHitTarget)),
    ].join("::"),
  sourceId: toText(row?.sourceId),
  dateKey: toText(row?.dateKey),
  monthKey: toText(row?.monthKey) ?? buildMonthKey(row?.dateKey),
  symbol: toText(row?.symbol),
  outcomeHitTarget: row?.outcomeHitTarget === true,
  foldId: toNumber(row?.foldId, 0),
  windowId: toNumber(row?.windowId, 0),
})

const buildUnionRows = (selectedClauses, fieldName) => {
  const rowsByKey = new Map()
  for (const clause of Array.isArray(selectedClauses) ? selectedClauses : []) {
    for (const row of Array.isArray(clause?.[fieldName]) ? clause[fieldName] : []) {
      const cloned = cloneMatchedRow(row)
      rowsByKey.set(cloned.rowKey, cloned)
    }
  }
  return Array.from(rowsByKey.values())
}

export const evaluatePerfectPrototypeDecisionSetUnion = ({
  selectedClauses = [],
  fieldName = "trainMatchedRows",
} = {}) => {
  const matchedRows = buildUnionRows(selectedClauses, fieldName)
  const dateKeys = new Set()
  const monthKeys = new Set()
  const symbolKeys = new Set()
  const foldIds = new Set()
  let hitCount = 0
  let negativeCount = 0
  for (const row of matchedRows) {
    if (row.dateKey) dateKeys.add(row.dateKey)
    if (row.monthKey) monthKeys.add(row.monthKey)
    if (row.symbol) symbolKeys.add(row.symbol)
    if (row.foldId > 0) foldIds.add(row.foldId)
    if (row.outcomeHitTarget === true) hitCount += 1
    else negativeCount += 1
  }
  const matchCount = matchedRows.length
  return {
    clauseIds: Array.from(
      new Set((Array.isArray(selectedClauses) ? selectedClauses : []).map((clause) => clause?.ruleId).filter(Boolean)),
    ),
    clauseCount: Array.isArray(selectedClauses) ? selectedClauses.length : 0,
    matchCount,
    hitCount,
    negativeCount,
    precision: matchCount > 0 ? hitCount / matchCount : 0,
    uniqueDateCount: dateKeys.size,
    uniqueMonthCount: monthKeys.size,
    uniqueSymbolCount: symbolKeys.size,
    matchedFoldCount: foldIds.size,
    matchedDateKeys: Array.from(dateKeys).sort((left, right) => left.localeCompare(right)),
    matchedMonthKeys: Array.from(monthKeys).sort((left, right) => left.localeCompare(right)),
    matchedSymbols: Array.from(symbolKeys).sort((left, right) => left.localeCompare(right)),
    matchedSourceIds: matchedRows
      .map((row) => row.sourceId)
      .filter(Boolean)
      .sort((left, right) => String(left).localeCompare(String(right))),
    matchedRows,
  }
}

export const evaluatePerfectPrototypeDecisionSetClauseCrossfit = ({
  selectedClauses = [],
  minPositiveWindowSupport = 2,
} = {}) => {
  const matchedRows = buildUnionRows(selectedClauses, "trainMatchedRows")
  const positiveByWindow = new Map()
  const negativeWindowIds = new Set()
  for (const row of matchedRows) {
    const windowId = toNumber(row?.windowId, 0)
    if (windowId < 1) continue
    if (row?.outcomeHitTarget === true) {
      positiveByWindow.set(windowId, Number(positiveByWindow.get(windowId) ?? 0) + 1)
    } else {
      negativeWindowIds.add(windowId)
    }
  }
  const positiveWindowIds = new Set()
  const minSupport = Math.max(1, Math.floor(Number(minPositiveWindowSupport) || 1))
  for (const [windowId, count] of positiveByWindow.entries()) {
    if (count >= minSupport) positiveWindowIds.add(windowId)
  }
  return {
    maxNegativeWindowCount: negativeWindowIds.size,
    maxPositiveWindowCount: positiveWindowIds.size,
    windowCount: new Set([
      ...Array.from(positiveByWindow.keys()),
      ...Array.from(negativeWindowIds.values()),
    ]).size,
  }
}
