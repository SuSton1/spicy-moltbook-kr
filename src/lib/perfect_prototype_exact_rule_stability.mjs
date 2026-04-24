import { buildPerfectPrototypeCrossfitHoldoutWindows } from "./perfect_prototype_crossfit_holdout.mjs"
import { buildPerfectPrototypeSubgroupTemporalStability } from "./perfect_prototype_subgroup_stability.mjs"

const toNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizePositiveCoverage = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const byDate = new Map()
  for (const row of safeRows) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    byDate.set(dateKey, Number(byDate.get(dateKey) ?? 0) + 1)
  }
  const countsByDate = Array.from(byDate.values()).sort((left, right) => right - left)
  const positiveDateCount = byDate.size
  const top1DateHitShare =
    countsByDate.length > 0
      ? Number(countsByDate[0] ?? 0) / Math.max(1, safeRows.length)
      : 0
  return {
    matchedDateCount: positiveDateCount,
    matchedMonthCount: new Set(safeRows.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
    matchedFoldCount: new Set(safeRows.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
    top1DateHitShare,
  }
}

const buildHoldoutContext = ({
  matchedPositiveRows = [],
  matchedNegativeRows = [],
} = {}) => {
  const rows = [...(Array.isArray(matchedPositiveRows) ? matchedPositiveRows : []), ...(Array.isArray(matchedNegativeRows) ? matchedNegativeRows : [])]
  const calendarDateKeys = Array.from(
    new Set(rows.map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))
  const dateIndexByKey = new Map(calendarDateKeys.map((dateKey, index) => [dateKey, index]))
  const rowDateIndexes = rows.map((row) => Number(dateIndexByKey.get(String(row?.dateKey ?? "").trim()) ?? -1))
  const positiveRowIndexes = Uint32Array.from(
    Array.from({ length: matchedPositiveRows.length }, (_, index) => index),
  )
  const negativeRowIndexes = Uint32Array.from(
    Array.from({ length: matchedNegativeRows.length }, (_, index) => matchedPositiveRows.length + index),
  )
  return {
    rows,
    calendarDateKeys,
    rowDateIndexes,
    positiveRowIndexes,
    negativeRowIndexes,
  }
}

const selectRowsByIndexes = (rows = [], indexes = []) =>
  Array.from(indexes ?? []).map((index) => rows[index]).filter(Boolean)

const summarizeResamplePass = ({
  positiveRows = [],
  negativeRows = [],
  minMatchedDates = 4,
  minMatchedMonths = 4,
  minMatchedFolds = 3,
} = {}) => {
  const coverage = summarizePositiveCoverage(positiveRows)
  return (
    Array.isArray(negativeRows) &&
    negativeRows.length === 0 &&
    Number(coverage.matchedDateCount ?? 0) >= Math.max(1, Number(minMatchedDates) - 1) &&
    Number(coverage.matchedMonthCount ?? 0) >= Math.max(1, Number(minMatchedMonths) - 1) &&
    Number(coverage.matchedFoldCount ?? 0) >= Math.max(1, Number(minMatchedFolds) - 1)
  )
}

export const buildPerfectPrototypeExactRuleStability = ({
  matchedPositiveRows = [],
  matchedNegativeRows = [],
  minMatchedDates = 4,
  minMatchedMonths = 4,
  minMatchedFolds = 3,
  minSelectionFrequency = 0.6,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
  holdoutWindowCount = 4,
  crossfitMinWindowSupport = 2,
} = {}) => {
  const positiveCoverage = summarizePositiveCoverage(matchedPositiveRows)
  const holdoutContext = buildHoldoutContext({
    matchedPositiveRows,
    matchedNegativeRows,
  })
  const crossfit = buildPerfectPrototypeCrossfitHoldoutWindows({
    positiveRowIndexes: holdoutContext.positiveRowIndexes,
    negativeRowIndexes: holdoutContext.negativeRowIndexes,
    rowDateIndexes: holdoutContext.rowDateIndexes,
    calendarDateKeys: holdoutContext.calendarDateKeys,
    windowCount: holdoutWindowCount,
    minWindowSupport: crossfitMinWindowSupport,
  })
  const windowResults = (crossfit?.windows ?? []).map((window) => {
    const inSamplePositiveRows = selectRowsByIndexes(
      holdoutContext.rows,
      window?.inSamplePositiveRowIndexes ?? [],
    )
    const inSampleNegativeRows = selectRowsByIndexes(
      holdoutContext.rows,
      window?.inSampleNegativeRowIndexes ?? [],
    )
    return {
      windowId: window?.windowId ?? null,
      positiveRowCount: Number(window?.positiveRowCount ?? 0),
      negativeRowCount: Number(window?.negativeRowCount ?? 0),
      pass: summarizeResamplePass({
        positiveRows: inSamplePositiveRows,
        negativeRows: inSampleNegativeRows,
        minMatchedDates,
        minMatchedMonths,
        minMatchedFolds,
      }),
    }
  })
  const uniqueFoldIds = Array.from(
    new Set(
      (Array.isArray(matchedPositiveRows) ? matchedPositiveRows : [])
        .map((row) => Number(row?.foldId ?? 0))
        .filter((value) => value > 0),
    ),
  ).sort((left, right) => left - right)
  const foldResults = uniqueFoldIds.map((foldId) => {
    const inSamplePositiveRows = (matchedPositiveRows ?? []).filter((row) => Number(row?.foldId ?? 0) !== foldId)
    const inSampleNegativeRows = (matchedNegativeRows ?? []).filter((row) => Number(row?.foldId ?? 0) !== foldId)
    return {
      foldId,
      pass: summarizeResamplePass({
        positiveRows: inSamplePositiveRows,
        negativeRows: inSampleNegativeRows,
        minMatchedDates,
        minMatchedMonths,
        minMatchedFolds,
      }),
    }
  })
  const resamplePassCount =
    windowResults.filter((entry) => entry.pass === true).length +
    foldResults.filter((entry) => entry.pass === true).length
  const resampleCount = windowResults.length + foldResults.length
  const resampleSelectionFrequency = resampleCount > 0 ? resamplePassCount / resampleCount : 0
  const baseStability = buildPerfectPrototypeSubgroupTemporalStability({
    matchedDateCount: positiveCoverage.matchedDateCount,
    matchedMonthCount: positiveCoverage.matchedMonthCount,
    matchedFoldCount: positiveCoverage.matchedFoldCount,
    top1DateHitShare: positiveCoverage.top1DateHitShare,
    minMatchedDates,
    minMatchedMonths,
    minMatchedFolds,
    minSelectionFrequency,
    minFoldPresenceCount,
    minWindowPresenceCount,
  })
  const selectionFrequency = Math.max(
    0,
    Math.min(1, (Number(baseStability.selectionFrequency ?? 0) + Number(resampleSelectionFrequency ?? 0)) / 2),
  )
  const foldPresenceCount = uniqueFoldIds.length
  const windowPresenceCount = windowResults.filter((entry) => Number(entry?.positiveRowCount ?? 0) > 0).length
  const crossfitNegativeWindowCount = windowResults.filter((entry) => Number(entry?.negativeRowCount ?? 0) > 0).length
  const stabilityQualified =
    selectionFrequency >= Number(minSelectionFrequency) &&
    foldPresenceCount >= Number(minFoldPresenceCount) &&
    windowPresenceCount >= Number(minWindowPresenceCount)
  return {
    matchedDateCount: positiveCoverage.matchedDateCount,
    matchedMonthCount: positiveCoverage.matchedMonthCount,
    matchedFoldCount: positiveCoverage.matchedFoldCount,
    top1DateHitShare: positiveCoverage.top1DateHitShare,
    selectionFrequency,
    resampleSelectionFrequency,
    foldPresenceCount,
    windowPresenceCount,
    crossfitNegativeWindowCount,
    holdoutWindowCount: windowResults.length,
    holdoutWindowPassCount: windowResults.filter((entry) => entry.pass === true).length,
    holdoutFoldCount: foldResults.length,
    holdoutFoldPassCount: foldResults.filter((entry) => entry.pass === true).length,
    stabilityQualified,
    baseSelectionFrequency: Number(baseStability.selectionFrequency ?? 0),
    windowResults,
    foldResults,
  }
}
