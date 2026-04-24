const EMPTY_ROW_INDEXES = new Uint32Array()

const normalizePositiveInteger = (value, fallback) => {
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric > 0) return numeric
  return fallback
}

const resolveDateKeyForRow = ({ rowIndex, rowDateIndexes, calendarDateKeys }) => {
  const dateIndex = Number(rowDateIndexes?.[rowIndex] ?? -1)
  if (!Number.isInteger(dateIndex) || dateIndex < 0) return null
  const dateKey = String(calendarDateKeys?.[dateIndex] ?? "").trim()
  return dateKey || null
}

const buildSortedMatchedDateKeys = ({
  positiveRowIndexes = EMPTY_ROW_INDEXES,
  negativeRowIndexes = EMPTY_ROW_INDEXES,
  rowDateIndexes = null,
  calendarDateKeys = null,
} = {}) => {
  const dateKeys = new Set()
  for (const rowIndex of [...Array.from(positiveRowIndexes ?? []), ...Array.from(negativeRowIndexes ?? [])]) {
    const dateKey = resolveDateKeyForRow({
      rowIndex,
      rowDateIndexes,
      calendarDateKeys,
    })
    if (dateKey) dateKeys.add(dateKey)
  }
  return Array.from(dateKeys).sort((left, right) => left.localeCompare(right))
}

const splitDateKeysIntoWindows = ({ dateKeys = [], windowCount = 6 } = {}) => {
  if (!Array.isArray(dateKeys) || dateKeys.length < 1) return []
  const resolvedWindowCount = Math.max(1, Math.min(dateKeys.length, normalizePositiveInteger(windowCount, 1)))
  const windows = []
  let offset = 0
  for (let index = 0; index < resolvedWindowCount; index += 1) {
    const remainingDates = dateKeys.length - offset
    const remainingWindows = resolvedWindowCount - index
    const chunkSize = Math.max(1, Math.ceil(remainingDates / remainingWindows))
    const chunk = dateKeys.slice(offset, offset + chunkSize)
    offset += chunkSize
    if (chunk.length < 1) continue
    windows.push({
      windowId: `crossfit_window_${String(index + 1).padStart(2, "0")}`,
      startDateKey: chunk[0],
      endDateKey: chunk[chunk.length - 1],
      dateKeys: chunk,
      dateKeySet: new Set(chunk),
    })
  }
  return windows
}

const filterRowIndexesByDateSet = ({
  rowIndexes = EMPTY_ROW_INDEXES,
  rowDateIndexes = null,
  calendarDateKeys = null,
  dateKeySet = null,
  include = true,
} = {}) => {
  if (!dateKeySet || dateKeySet.size < 1) {
    return include ? EMPTY_ROW_INDEXES : Uint32Array.from(Array.from(rowIndexes ?? []))
  }
  const kept = []
  for (const rowIndex of Array.from(rowIndexes ?? [])) {
    const dateKey = resolveDateKeyForRow({
      rowIndex,
      rowDateIndexes,
      calendarDateKeys,
    })
    const contained = Boolean(dateKey && dateKeySet.has(dateKey))
    if ((include && contained) || (!include && !contained)) kept.push(rowIndex)
  }
  return kept.length > 0 ? Uint32Array.from(kept) : EMPTY_ROW_INDEXES
}

const countDistinctDates = ({
  positiveRowIndexes = EMPTY_ROW_INDEXES,
  negativeRowIndexes = EMPTY_ROW_INDEXES,
  rowDateIndexes = null,
  calendarDateKeys = null,
} = {}) => {
  const dateKeys = new Set()
  for (const rowIndex of [...Array.from(positiveRowIndexes ?? []), ...Array.from(negativeRowIndexes ?? [])]) {
    const dateKey = resolveDateKeyForRow({
      rowIndex,
      rowDateIndexes,
      calendarDateKeys,
    })
    if (dateKey) dateKeys.add(dateKey)
  }
  return dateKeys.size
}

export const buildPerfectPrototypeCrossfitHoldoutWindows = ({
  positiveRowIndexes = EMPTY_ROW_INDEXES,
  negativeRowIndexes = EMPTY_ROW_INDEXES,
  rowDateIndexes = null,
  calendarDateKeys = null,
  windowCount = 6,
  minWindowSupport = 2,
} = {}) => {
  const matchedDateKeys = buildSortedMatchedDateKeys({
    positiveRowIndexes,
    negativeRowIndexes,
    rowDateIndexes,
    calendarDateKeys,
  })
  const windows = splitDateKeysIntoWindows({
    dateKeys: matchedDateKeys,
    windowCount,
  }).map((window) => {
    const holdoutPositiveRowIndexes = filterRowIndexesByDateSet({
      rowIndexes: positiveRowIndexes,
      rowDateIndexes,
      calendarDateKeys,
      dateKeySet: window.dateKeySet,
      include: true,
    })
    const holdoutNegativeRowIndexes = filterRowIndexesByDateSet({
      rowIndexes: negativeRowIndexes,
      rowDateIndexes,
      calendarDateKeys,
      dateKeySet: window.dateKeySet,
      include: true,
    })
    const inSamplePositiveRowIndexes = filterRowIndexesByDateSet({
      rowIndexes: positiveRowIndexes,
      rowDateIndexes,
      calendarDateKeys,
      dateKeySet: window.dateKeySet,
      include: false,
    })
    const inSampleNegativeRowIndexes = filterRowIndexesByDateSet({
      rowIndexes: negativeRowIndexes,
      rowDateIndexes,
      calendarDateKeys,
      dateKeySet: window.dateKeySet,
      include: false,
    })
    const matchedRowCount =
      holdoutPositiveRowIndexes.length + holdoutNegativeRowIndexes.length
    return {
      windowId: window.windowId,
      startDateKey: window.startDateKey,
      endDateKey: window.endDateKey,
      dateKeys: window.dateKeys.slice(),
      matchedDateCount: countDistinctDates({
        positiveRowIndexes: holdoutPositiveRowIndexes,
        negativeRowIndexes: holdoutNegativeRowIndexes,
        rowDateIndexes,
        calendarDateKeys,
      }),
      matchedRowCount,
      positiveRowCount: holdoutPositiveRowIndexes.length,
      negativeRowCount: holdoutNegativeRowIndexes.length,
      qualifies:
        matchedRowCount >= Math.max(1, normalizePositiveInteger(minWindowSupport, 1)),
      holdoutPositiveRowIndexes,
      holdoutNegativeRowIndexes,
      inSamplePositiveRowIndexes,
      inSampleNegativeRowIndexes,
    }
  })
  return {
    matchedDateKeyCount: matchedDateKeys.length,
    windowCount: windows.length,
    windows,
  }
}
