import {
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
} from "./perfect_prototype_rowset.mjs"
import { buildPerfectPrototypeCrossfitHoldoutWindows } from "./perfect_prototype_crossfit_holdout.mjs"

const EMPTY_ROW_INDEXES = new Uint32Array()

const buildOwnedRowset = ({ values = EMPTY_ROW_INDEXES, rowCount = 0, allowDense = true } = {}) =>
  createPerfectPrototypeRowset({
    values:
      Array.isArray(values) || ArrayBuffer.isView(values) ? values : EMPTY_ROW_INDEXES,
    universeSize: rowCount,
    allowDense,
  })

const intersectRowsetsOwned = ({
  leftRowset,
  rightRowset,
  rowCount,
  allowDense = true,
} = {}) => {
  if (
    !leftRowset ||
    !rightRowset ||
    getPerfectPrototypeRowsetCount(leftRowset) < 1 ||
    getPerfectPrototypeRowsetCount(rightRowset) < 1
  ) {
    return {
      rowIndexes: EMPTY_ROW_INDEXES,
      rowset: buildOwnedRowset({ values: EMPTY_ROW_INDEXES, rowCount, allowDense }),
      count: 0,
    }
  }
  const prepared = intersectPerfectPrototypeRowsetsPrepared({
    leftRowset,
    rightRowset,
    universeSize: rowCount,
    allowDense,
    resultOwnership: "borrowed",
  })
  try {
    const rowIndexes =
      prepared.count > 0 ? materializePerfectPrototypeRowsetValues(prepared.rowset) : EMPTY_ROW_INDEXES
    return {
      rowIndexes,
      rowset: buildOwnedRowset({ values: rowIndexes, rowCount, allowDense }),
      count: prepared.count,
    }
  } finally {
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
  }
}

const buildEmptyCover = ({ rowCount, allowDense = true } = {}) => ({
  rowIndexes: EMPTY_ROW_INDEXES,
  rowset: buildOwnedRowset({ values: EMPTY_ROW_INDEXES, rowCount, allowDense }),
  count: 0,
})

const buildEntryStateFromRowIndexes = ({
  entryState = null,
  positiveRowIndexes = EMPTY_ROW_INDEXES,
  negativeRowIndexes = EMPTY_ROW_INDEXES,
  rowCount,
  computePositiveHitStats,
  allowDense = true,
} = {}) => {
  const positiveRowset = buildOwnedRowset({
    values: positiveRowIndexes,
    rowCount,
    allowDense,
  })
  const negativeRowset = buildOwnedRowset({
    values: negativeRowIndexes,
    rowCount,
    allowDense,
  })
  return {
    entrySeedTokens: Array.isArray(entryState?.entrySeedTokens) ? entryState.entrySeedTokens.slice() : [],
    entrySeedIndexes: Array.isArray(entryState?.entrySeedIndexes) ? entryState.entrySeedIndexes.slice() : [],
    nextStartAt: Number(entryState?.nextStartAt ?? 0) || 0,
    positiveRowIndexes,
    positiveRowset,
    positiveHitStats: computePositiveHitStats({ rowIndexes: positiveRowIndexes }),
    negativeRowIndexes,
    negativeRowset,
  }
}

const buildCrossfitBreadthFloor = ({
  entryBreadthFloor = null,
  inSampleHitStats = null,
} = {}) => ({
  ...entryBreadthFloor,
  minMatchedDates: Math.max(
    1,
    Math.min(
      Number(entryBreadthFloor?.minMatchedDates ?? 1) || 1,
      Number(inSampleHitStats?.distinctDateCount ?? 0) || 1,
    ),
  ),
  minMatchedMonths: Math.max(
    1,
    Math.min(
      Number(entryBreadthFloor?.minMatchedMonths ?? 1) || 1,
      Number(inSampleHitStats?.matchedMonthCount ?? 0) || 1,
    ),
  ),
  minMatchedFolds: Math.max(
    1,
    Math.min(
      Number(entryBreadthFloor?.minMatchedFolds ?? 1) || 1,
      Number(inSampleHitStats?.matchedFoldCount ?? 0) || 1,
    ),
  ),
})

const evaluateCrossfitBreadthFloor = ({
  hitStats = null,
  generalizedSubgroupBreadthFloor = null,
} = {}) => {
  if (Number(hitStats?.distinctDateCount ?? 0) < Number(generalizedSubgroupBreadthFloor?.minMatchedDates ?? 1)) {
    return { ok: false, reason: "crossfit_dates_below_floor" }
  }
  if (Number(hitStats?.matchedMonthCount ?? 0) < Number(generalizedSubgroupBreadthFloor?.minMatchedMonths ?? 1)) {
    return { ok: false, reason: "crossfit_months_below_floor" }
  }
  if (Number(hitStats?.matchedFoldCount ?? 0) < Number(generalizedSubgroupBreadthFloor?.minMatchedFolds ?? 1)) {
    return { ok: false, reason: "crossfit_folds_below_floor" }
  }
  return { ok: true }
}

const applySolvedSeedIndexesToHoldout = async ({
  entrySeedIndexes = [],
  solvedSeedIndexes = [],
  holdoutPositiveRowIndexes = EMPTY_ROW_INDEXES,
  holdoutNegativeRowIndexes = EMPTY_ROW_INDEXES,
  seedPostingCache,
  rowCount,
  allowDense = true,
} = {}) => {
  let positiveCover = buildOwnedRowset({
    values: holdoutPositiveRowIndexes,
    rowCount,
    allowDense,
  })
  let negativeCover = buildOwnedRowset({
    values: holdoutNegativeRowIndexes,
    rowCount,
    allowDense,
  })
  const baseSeedIndexSet = new Set(
    (Array.isArray(entrySeedIndexes) ? entrySeedIndexes : []).filter((value) => Number.isInteger(value) && value >= 0),
  )
  const addedSeedIndexes = (Array.isArray(solvedSeedIndexes) ? solvedSeedIndexes : [])
    .filter((value) => Number.isInteger(value) && value >= 0 && !baseSeedIndexSet.has(value))
    .sort((left, right) => left - right)

  for (const seedIndex of addedSeedIndexes) {
    const positivePostingRowset = await seedPostingCache.getSeedPositiveRowset(seedIndex)
    const nextPositive = intersectRowsetsOwned({
      leftRowset: positiveCover,
      rightRowset: positivePostingRowset,
      rowCount,
      allowDense,
    })
    positiveCover = nextPositive.rowset

    const negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(seedIndex)
    const nextNegative =
      !negativePostingRowset || getPerfectPrototypeRowsetCount(negativePostingRowset) < 1
        ? buildEmptyCover({ rowCount, allowDense })
        : intersectRowsetsOwned({
            leftRowset: negativeCover,
            rightRowset: negativePostingRowset,
            rowCount,
            allowDense,
          })
    negativeCover = nextNegative.rowset
  }

  return {
    positiveRowIndexes: materializePerfectPrototypeRowsetValues(positiveCover),
    negativeRowIndexes: materializePerfectPrototypeRowsetValues(negativeCover),
  }
}

export const collectPerfectPrototypeCrossfitHardNegatives = async ({
  familyId = null,
  manifest = null,
  core = null,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  rowCount,
  rowDateIndexes = null,
  calendarDateKeys = null,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  candidateTokenPredicate = null,
  maxRuleSize = 6,
  maxCandidates = 24,
  windowCount = 6,
  minWindowSupport = 2,
  allowDense = true,
  solveExactCompletion = null,
} = {}) => {
  if (typeof solveExactCompletion !== "function") {
    throw new Error("Perfect prototype hard negative refinement requires solveExactCompletion()")
  }
  const windows = buildPerfectPrototypeCrossfitHoldoutWindows({
    positiveRowIndexes: core?.positiveRowIndexes ?? EMPTY_ROW_INDEXES,
    negativeRowIndexes: core?.negativeRowIndexes ?? EMPTY_ROW_INDEXES,
    rowDateIndexes,
    calendarDateKeys,
    windowCount,
    minWindowSupport,
  })
  const hardNegativeRowIndexSet = new Set()
  let crossfitMatchedWindowCount = 0
  let crossfitNegativeWindowCount = 0
  const windowSummaries = []

  for (const window of windows.windows ?? []) {
    const inSampleEntryState = buildEntryStateFromRowIndexes({
      entryState: core,
      positiveRowIndexes: window.inSamplePositiveRowIndexes,
      negativeRowIndexes: window.inSampleNegativeRowIndexes,
      rowCount,
      computePositiveHitStats,
      allowDense,
    })
    if (Number(inSampleEntryState?.positiveHitStats?.cappedCount ?? 0) < Math.max(1, Number(familySearchMinHitCount ?? 1) || 1)) {
      windowSummaries.push({
        windowId: window.windowId,
        solved: false,
        matched: false,
        negativeMatched: false,
        hardNegativeRowCount: 0,
        reason: "crossfit_in_sample_below_min_hit",
      })
      continue
    }
    const crossfitBreadthFloor = buildCrossfitBreadthFloor({
      entryBreadthFloor: core?.entryBreadthFloor ?? null,
      inSampleHitStats: inSampleEntryState.positiveHitStats,
    })
    const solvedOutcome = await solveExactCompletion({
      familyId,
      manifest,
      entryState: inSampleEntryState,
      selectedSeedCount,
      seedTokensOrdered,
      seedPositiveCounts,
      seedPostingCache,
      rowCount,
      computePositiveHitStats,
      familySearchMinHitCount,
      generalizedSubgroupBreadthFloor: crossfitBreadthFloor,
      evaluateBreadthFloor: ({ hitStats, generalizedSubgroupBreadthFloor }) =>
        evaluateCrossfitBreadthFloor({
          hitStats,
          generalizedSubgroupBreadthFloor,
        }),
      candidateTokenPredicate,
      maxRuleSize,
      maxCandidates,
    })
    if (!solvedOutcome?.ok) {
      windowSummaries.push({
        windowId: window.windowId,
        solved: false,
        matched: false,
        negativeMatched: false,
        hardNegativeRowCount: 0,
        reason: solvedOutcome?.reason ?? "crossfit_unsolved",
      })
      continue
    }
    const holdoutCoverage = await applySolvedSeedIndexesToHoldout({
      entrySeedIndexes: Array.isArray(core?.entrySeedIndexes) ? core.entrySeedIndexes : [],
      solvedSeedIndexes: Array.isArray(solvedOutcome?.seedIndexes) ? solvedOutcome.seedIndexes : [],
      holdoutPositiveRowIndexes: window.holdoutPositiveRowIndexes,
      holdoutNegativeRowIndexes: window.holdoutNegativeRowIndexes,
      seedPostingCache,
      rowCount,
      allowDense,
    })
    const matchedRowCount =
      holdoutCoverage.positiveRowIndexes.length + holdoutCoverage.negativeRowIndexes.length
    const matched = matchedRowCount >= Math.max(1, Number(minWindowSupport ?? 1) || 1)
    const negativeMatched = holdoutCoverage.negativeRowIndexes.length > 0
    if (matched) crossfitMatchedWindowCount += 1
    if (matched && negativeMatched) {
      crossfitNegativeWindowCount += 1
      for (const rowIndex of Array.from(holdoutCoverage.negativeRowIndexes ?? [])) {
        hardNegativeRowIndexSet.add(rowIndex)
      }
    }
    windowSummaries.push({
      windowId: window.windowId,
      solved: true,
      matched,
      negativeMatched,
      hardNegativeRowCount: holdoutCoverage.negativeRowIndexes.length,
      matchedRowCount,
      reason: null,
    })
  }

  const hardNegativeRowIndexes =
    hardNegativeRowIndexSet.size > 0
      ? Uint32Array.from(Array.from(hardNegativeRowIndexSet).sort((left, right) => left - right))
      : EMPTY_ROW_INDEXES

  return {
    familyId: String(familyId ?? "").trim() || null,
    subgroupId: manifest?.subgroupId ?? null,
    coreId: core?.coreId ?? null,
    crossfitWindowCount: Number(windows.windowCount ?? 0) || 0,
    crossfitMatchedWindowCount,
    crossfitNegativeWindowCount,
    crossfitFalsePositiveRowCount: hardNegativeRowIndexes.length,
    hardNegativeRowIndexes,
    hardNegativeAddedCount: hardNegativeRowIndexes.length,
    hardNegativeRefined: hardNegativeRowIndexes.length > 0,
    windowSummaries,
  }
}
