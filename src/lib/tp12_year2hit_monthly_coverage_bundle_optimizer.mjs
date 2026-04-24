import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRows,
} from "./tp12_year2hit_foundation_io.mjs"
import { sha256TextLines } from "./tp12_year2hit_train_gate.mjs"
import {
  assertTp12OperationalHitRow,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

export const TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_KIND =
  "tp12_year2hit_monthly_coverage_bundle_optimizer_summary_v1"
export const TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_PATCH_KEY =
  "tp12_year2hit_monthly_coverage_bundle_optimizer_v1"
export const DEFAULT_TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_CONTRACT_PATH =
  "meta/tp12_year2hit_monthly_coverage_bundle_optimizer_contract.json"

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)
const rowKeyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`
const monthKeyOf = (dateKey) => toText(dateKey).slice(0, 7)

const normalizeYears = (value) => {
  const years = uniqueSorted(Array.isArray(value) ? value.map(String) : [])
  return years.length > 0 ? years : ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]
}

const parseList = (value) => {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean)
  return toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

const normalizeMonthKeys = (value) => {
  const keys = uniqueSorted(parseList(value))
  for (const key of keys) {
    if (!/^\d{4}-\d{2}$/.test(key)) throw new Error(`fullMonthKeys must be YYYY-MM: ${key}`)
  }
  return keys
}

const loadContract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`monthly coverage bundle optimizer contract not found: ${resolvedPath}`)
  if (toText(contract.patchKey) && toText(contract.patchKey) !== TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_PATCH_KEY) {
    throw new Error(`unexpected monthly coverage bundle optimizer patchKey: ${contract.patchKey}`)
  }
  return contract
}

export const deriveTp12Year2hitMonthlyCoverageBundleOptimizerOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const hitContract = contract.hitContract ?? {}
  const eligibility = contract.patternEligibility ?? {}
  const monthly = contract.monthlyCoverage ?? {}
  const concentration = contract.concentrationGate ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    coreYears: eligibility.coreYears,
    minOperationalHitDatesPerYear: eligibility.minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear: eligibility.minOperationalHitSymbolDatesPerYear,
    minPatternOperationalPrecision: eligibility.minPatternOperationalPrecision,
    maxPatternOperationalMissRows: eligibility.maxPatternOperationalMissRows,
    maxPatternNonExecutableRows: eligibility.maxPatternNonExecutableRows,
    minPatternOperationalHitRows: eligibility.minPatternOperationalHitRows,
    minPatterns: monthly.minPatterns,
    maxPatterns: monthly.maxPatterns,
    fullMonthKeys: monthly.fullMonthKeys,
    targetRecommendationsPerFullMonth: monthly.targetRecommendationsPerFullMonth,
    targetOperationalHitsPerFullMonth: monthly.targetOperationalHitsPerFullMonth,
    minBundleOperationalPrecision: monthly.minBundleOperationalPrecision,
    requireExplicitFullMonthKeys: monthly.requireExplicitFullMonthKeys,
    failOnGateFailure: monthly.failOnGateFailure,
    maxTopPatternHitShare: concentration.maxTopPatternHitShare,
    maxTopPatternRecommendationShare: concentration.maxTopPatternRecommendationShare,
    maxTopSymbolRecommendationShare: concentration.maxTopSymbolRecommendationShare,
    hitDefinition: hitContract.hitDefinition,
    hitField: hitContract.hitField,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveTp12Year2hitMonthlyCoverageBundleOptimizerOptionsFromContract(contract) : {}
  return {
    dateFrom: toText(raw.dateFrom ?? contractOptions.dateFrom ?? "2016-01-01"),
    dateTo: toText(raw.dateTo ?? contractOptions.dateTo ?? "2024-12-31"),
    lockedFutureFrom: toText(raw.lockedFutureFrom ?? contractOptions.lockedFutureFrom ?? "2025-01-02"),
    coreYears: normalizeYears(raw.coreYears ?? contractOptions.coreYears),
    minOperationalHitDatesPerYear: Math.max(
      1,
      Math.trunc(toNumber(raw.minOperationalHitDatesPerYear ?? contractOptions.minOperationalHitDatesPerYear, 2)),
    ),
    minOperationalHitSymbolDatesPerYear: Math.max(
      1,
      Math.trunc(toNumber(raw.minOperationalHitSymbolDatesPerYear ?? contractOptions.minOperationalHitSymbolDatesPerYear, 2)),
    ),
    minPatternOperationalPrecision: Math.min(
      1,
      Math.max(0, toNumber(raw.minPatternOperationalPrecision ?? contractOptions.minPatternOperationalPrecision, 1)),
    ),
    maxPatternOperationalMissRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxPatternOperationalMissRows ?? contractOptions.maxPatternOperationalMissRows, 0)),
    ),
    maxPatternNonExecutableRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxPatternNonExecutableRows ?? contractOptions.maxPatternNonExecutableRows, 0)),
    ),
    minPatternOperationalHitRows: Math.max(
      0,
      Math.trunc(toNumber(raw.minPatternOperationalHitRows ?? contractOptions.minPatternOperationalHitRows, 0)),
    ),
    minPatterns: Math.max(1, Math.trunc(toNumber(raw.minPatterns ?? contractOptions.minPatterns, 2))),
    maxPatterns: Math.max(1, Math.trunc(toNumber(raw.maxPatterns ?? contractOptions.maxPatterns, 50))),
    fullMonthKeys: normalizeMonthKeys(raw.fullMonthKeys ?? contractOptions.fullMonthKeys),
    targetRecommendationsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetRecommendationsPerFullMonth ?? contractOptions.targetRecommendationsPerFullMonth, 5)),
    ),
    targetOperationalHitsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetOperationalHitsPerFullMonth ?? contractOptions.targetOperationalHitsPerFullMonth, 5)),
    ),
    minBundleOperationalPrecision: Math.min(
      1,
      Math.max(0, toNumber(raw.minBundleOperationalPrecision ?? contractOptions.minBundleOperationalPrecision, 1)),
    ),
    requireExplicitFullMonthKeys: toBool(
      raw.requireExplicitFullMonthKeys ?? contractOptions.requireExplicitFullMonthKeys,
      true,
    ),
    failOnGateFailure: toBool(raw.failOnGateFailure ?? contractOptions.failOnGateFailure, true),
    maxTopPatternHitShare: Math.min(
      1,
      Math.max(0, toNumber(raw.maxTopPatternHitShare ?? contractOptions.maxTopPatternHitShare, 0.75)),
    ),
    maxTopPatternRecommendationShare: Math.min(
      1,
      Math.max(0, toNumber(raw.maxTopPatternRecommendationShare ?? contractOptions.maxTopPatternRecommendationShare, 0.75)),
    ),
    maxTopSymbolRecommendationShare: Math.min(
      1,
      Math.max(0, toNumber(raw.maxTopSymbolRecommendationShare ?? contractOptions.maxTopSymbolRecommendationShare, 1)),
    ),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`monthly coverage bundle optimizer requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`monthly coverage bundle optimizer requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid monthly coverage optimizer date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  if (options.maxPatterns < options.minPatterns) throw new Error("maxPatterns must be >= minPatterns")
  if (options.requireExplicitFullMonthKeys && options.fullMonthKeys.length < 1) {
    throw new Error("fullMonthKeys are required; monthly coverage must not infer full months")
  }
}

const buildPatternRejectReasons = ({ row, options }) => {
  const reasons = []
  if (toText(row?.status) !== "passed") reasons.push("pattern_status_not_passed")
  if (toNumber(row?.minOperationalHitDatesPerYear, 0) < options.minOperationalHitDatesPerYear) {
    reasons.push("pattern_hit_dates_below_year2_min")
  }
  if (toNumber(row?.minOperationalHitSymbolDatesPerYear, 0) < options.minOperationalHitSymbolDatesPerYear) {
    reasons.push("pattern_hit_symbol_dates_below_year2_min")
  }
  if (toNumber(row?.operationalPrecision, 0) < options.minPatternOperationalPrecision) {
    reasons.push("pattern_precision_below_100pct_gate")
  }
  if (toNumber(row?.operationalMissRows, 0) > options.maxPatternOperationalMissRows) {
    reasons.push("pattern_operational_miss_rows_above_max")
  }
  if (toNumber(row?.nonExecutableRows, 0) > options.maxPatternNonExecutableRows) {
    reasons.push("pattern_non_executable_rows_above_max")
  }
  if (toNumber(row?.operationalHitRows, 0) < options.minPatternOperationalHitRows) {
    reasons.push("pattern_operational_hit_rows_below_min")
  }
  return reasons
}

const readCandidatePatterns = async ({ eligiblePatternsPath, options }) => {
  const candidates = []
  const rejected = []
  const rejectReasonCounts = new Map()
  await iterateJsonlMaybeGzip(eligiblePatternsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`eligible pattern row missing patternId at ${context.filePath}:${context.lineNumber}`)
      const rejectReasons = buildPatternRejectReasons({ row, options })
      const enriched = {
        ...row,
        patternId,
        optimizerPatternScore:
          toNumber(row?.operationalPrecision, 0) * 1_000_000 +
          toNumber(row?.minOperationalHitDatesPerYear, 0) * 10_000 +
          toNumber(row?.operationalHitRows, 0),
        optimizerRejectReasons: rejectReasons,
      }
      if (rejectReasons.length > 0) {
        rejected.push(enriched)
        for (const reason of rejectReasons) incrementMap(rejectReasonCounts, reason)
        return
      }
      candidates.push(enriched)
    },
  })
  if (candidates.length + rejected.length < 1) throw new Error(`eligible pattern input has zero rows: ${eligiblePatternsPath}`)
  const candidateIds = uniqueSorted(candidates.map((row) => row.patternId))
  if (candidateIds.length !== candidates.length) throw new Error("eligible pattern input contains duplicate passed patternId rows")
  return {
    candidates: candidates.sort(comparePatternRows),
    rejected: rejected.sort(comparePatternRows),
    rejectReasonCounts,
  }
}

const comparePatternRows = (left, right) =>
  toNumber(right.optimizerPatternScore, 0) - toNumber(left.optimizerPatternScore, 0) ||
  toNumber(right.operationalHitRows, 0) - toNumber(left.operationalHitRows, 0) ||
  toText(left.patternId).localeCompare(toText(right.patternId))

const normalizeEvent = ({ row, context, options }) => {
  const patternId = toText(row?.patternId)
  const symbol = toText(row?.symbol).toUpperCase()
  const decisionDateKey = toText(row?.decisionDateKey)
  if (!patternId) throw new Error(`monthly coverage event missing patternId at ${context}`)
  if (!symbol) throw new Error(`monthly coverage event missing symbol at ${context}`)
  if (!validDateKey(decisionDateKey)) throw new Error(`monthly coverage event invalid decisionDateKey at ${context}: ${decisionDateKey}`)
  if (decisionDateKey >= options.lockedFutureFrom) {
    throw new Error(`locked future row cannot enter monthly coverage optimizer: ${decisionDateKey}::${symbol}`)
  }
  if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return null
  assertTp12OperationalHitRow(row, { context, hitField: options.hitField })
  return {
    patternId,
    symbol,
    decisionDateKey,
    monthKey: monthKeyOf(decisionDateKey),
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget: row[options.hitField] === true,
  }
}

const loadEventsByPattern = async ({ operationalEventsPath, candidatePatternIds, options }) => {
  const candidateSet = new Set(candidatePatternIds)
  const fullMonthSet = new Set(options.fullMonthKeys)
  const byPattern = new Map(candidatePatternIds.map((patternId) => [patternId, []]))
  const seen = new Set()
  let inputRowCount = 0
  let ignoredNonCandidateRowCount = 0
  let outsideDateRowCount = 0
  let outsideFullMonthRowCount = 0
  await iterateJsonlMaybeGzip(operationalEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const event = normalizeEvent({
        row,
        context: `${context.filePath}:${context.lineNumber}`,
        options,
      })
      if (!event) {
        outsideDateRowCount += 1
        return
      }
      if (!candidateSet.has(event.patternId)) {
        ignoredNonCandidateRowCount += 1
        return
      }
      if (fullMonthSet.size > 0 && !fullMonthSet.has(event.monthKey)) {
        outsideFullMonthRowCount += 1
        return
      }
      const key = `${event.patternId}\t${event.decisionDateKey}\t${event.symbol}`
      if (seen.has(key)) throw new Error(`duplicate monthly coverage operational event key: ${key}`)
      seen.add(key)
      byPattern.get(event.patternId).push(event)
    },
  })
  return {
    byPattern,
    inputRowCount,
    ignoredNonCandidateRowCount,
    outsideDateRowCount,
    outsideFullMonthRowCount,
  }
}

const initMonthlyStats = (fullMonthKeys) =>
  new Map(
    fullMonthKeys.map((monthKey) => [
      monthKey,
      {
        monthKey,
        recommendationRows: 0,
        operationalHitRows: 0,
        operationalMissRows: 0,
      },
    ]),
  )

const initUnionState = (fullMonthKeys) => ({
  rowsByKey: new Map(),
  monthlyStats: initMonthlyStats(fullMonthKeys),
})

const addUnionEvent = ({ unionState, event, patternRow }) => {
  const key = rowKeyOf(event)
  const existing = unionState.rowsByKey.get(key)
  if (existing) {
    if (existing.operationalHitTarget !== event.operationalHitTarget) {
      throw new Error(`conflicting operationalHitTarget for monthly coverage union row: ${key}`)
    }
    if (existing.entryExecutable !== event.entryExecutable) {
      throw new Error(`conflicting entryExecutable for monthly coverage union row: ${key}`)
    }
    existing.supportPatternIds = uniqueSorted([...existing.supportPatternIds, event.patternId])
    existing.supportPatternCount = existing.supportPatternIds.length
    existing.schedulerScore = Math.max(existing.schedulerScore, toNumber(patternRow?.optimizerPatternScore, 0))
    return false
  }
  const monthStats = unionState.monthlyStats.get(event.monthKey)
  if (!monthStats) throw new Error(`event month is not an explicit full month: ${event.monthKey}`)
  monthStats.recommendationRows += 1
  if (event.operationalHitTarget) monthStats.operationalHitRows += 1
  else monthStats.operationalMissRows += 1
  unionState.rowsByKey.set(key, {
    kind: "tp12_year2hit_monthly_coverage_bundle_union_row_v1",
    decisionDateKey: event.decisionDateKey,
    monthKey: event.monthKey,
    symbol: event.symbol,
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
    operationalHitTarget: event.operationalHitTarget,
    entryExecutable: event.entryExecutable,
    supportPatternIds: [event.patternId],
    supportPatternCount: 1,
    schedulerScore: toNumber(patternRow?.optimizerPatternScore, 0),
  })
  return true
}

const monthDeficitUtility = ({ before, addedRecommendations, addedHits, options }) => {
  const recommendationDeficit = Math.max(0, options.targetRecommendationsPerFullMonth - before.recommendationRows)
  const hitDeficit = Math.max(0, options.targetOperationalHitsPerFullMonth - before.operationalHitRows)
  return {
    recommendationDeficitReduced: Math.min(recommendationDeficit, addedRecommendations),
    hitDeficitReduced: Math.min(hitDeficit, addedHits),
  }
}

const scoreCandidatePattern = ({ unionState, events, options }) => {
  const addedByMonth = new Map()
  let addedRows = 0
  let addedHits = 0
  let addedMisses = 0
  let overlapRows = 0
  for (const event of events) {
    if (unionState.rowsByKey.has(rowKeyOf(event))) {
      overlapRows += 1
      continue
    }
    addedRows += 1
    if (event.operationalHitTarget) addedHits += 1
    else addedMisses += 1
    const stats = addedByMonth.get(event.monthKey) ?? { recommendationRows: 0, operationalHitRows: 0 }
    stats.recommendationRows += 1
    if (event.operationalHitTarget) stats.operationalHitRows += 1
    addedByMonth.set(event.monthKey, stats)
  }
  let recommendationDeficitReduced = 0
  let hitDeficitReduced = 0
  for (const [monthKey, added] of addedByMonth.entries()) {
    const before = unionState.monthlyStats.get(monthKey)
    if (!before) continue
    const utility = monthDeficitUtility({
      before,
      addedRecommendations: added.recommendationRows,
      addedHits: added.operationalHitRows,
      options,
    })
    recommendationDeficitReduced += utility.recommendationDeficitReduced
    hitDeficitReduced += utility.hitDeficitReduced
  }
  const score =
    hitDeficitReduced * 1_000_000 +
    recommendationDeficitReduced * 100_000 +
    addedHits * 100 -
    addedMisses * 1_000_000 -
    overlapRows
  return {
    score,
    addedRows,
    addedHits,
    addedMisses,
    overlapRows,
    recommendationDeficitReduced,
    hitDeficitReduced,
  }
}

const pickNextPattern = ({ remainingPatternRows, eventsByPattern, unionState, options }) => {
  let best = null
  for (const patternRow of remainingPatternRows) {
    const events = eventsByPattern.get(patternRow.patternId) ?? []
    const score = scoreCandidatePattern({ unionState, events, options })
    if (score.addedRows < 1) continue
    const candidate = { patternRow, score }
    if (!best) {
      best = candidate
      continue
    }
    if (score.score !== best.score.score) {
      if (score.score > best.score.score) best = candidate
      continue
    }
    if (score.addedMisses !== best.score.addedMisses) {
      if (score.addedMisses < best.score.addedMisses) best = candidate
      continue
    }
    if (toNumber(patternRow.optimizerPatternScore, 0) !== toNumber(best.patternRow.optimizerPatternScore, 0)) {
      if (toNumber(patternRow.optimizerPatternScore, 0) > toNumber(best.patternRow.optimizerPatternScore, 0)) best = candidate
      continue
    }
    if (patternRow.patternId.localeCompare(best.patternRow.patternId) < 0) best = candidate
  }
  return best
}

const finalizeUnionMetrics = ({ unionRows, selectedPatternIds, fullMonthKeys, coreYears }) => {
  const hitDatesByYear = new Map(coreYears.map((year) => [year, new Set()]))
  const hitSymbolDatesByYear = new Map(coreYears.map((year) => [year, new Set()]))
  const hitRowsByPattern = new Map()
  const recommendationRowsByPattern = new Map()
  const recommendationRowsBySymbol = new Map()
  const monthly = initMonthlyStats(fullMonthKeys)
  let operationalHitRows = 0
  let operationalMissRows = 0
  let entryExecutableRows = 0
  let nonExecutableRows = 0
  for (const row of unionRows) {
    incrementMap(recommendationRowsBySymbol, row.symbol)
    const monthStats = monthly.get(row.monthKey)
    if (!monthStats) throw new Error(`union row month is not an explicit full month: ${row.monthKey}`)
    monthStats.recommendationRows += 1
    if (row.entryExecutable) entryExecutableRows += 1
    else nonExecutableRows += 1
    for (const patternId of row.supportPatternIds) incrementMap(recommendationRowsByPattern, patternId)
    if (!row.operationalHitTarget) {
      operationalMissRows += 1
      monthStats.operationalMissRows += 1
      continue
    }
    operationalHitRows += 1
    monthStats.operationalHitRows += 1
    const year = row.decisionDateKey.slice(0, 4)
    const hitDates = hitDatesByYear.get(year) ?? new Set()
    hitDates.add(row.decisionDateKey)
    hitDatesByYear.set(year, hitDates)
    const hitSymbolDates = hitSymbolDatesByYear.get(year) ?? new Set()
    hitSymbolDates.add(rowKeyOf(row))
    hitSymbolDatesByYear.set(year, hitSymbolDates)
    for (const patternId of row.supportPatternIds) incrementMap(hitRowsByPattern, patternId)
  }
  const operationalHitDatesByYear = Object.fromEntries(coreYears.map((year) => [year, hitDatesByYear.get(year)?.size ?? 0]))
  const operationalHitSymbolDatesByYear = Object.fromEntries(
    coreYears.map((year) => [year, hitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const topPatternHitRows = hitRowsByPattern.size > 0 ? Math.max(0, ...hitRowsByPattern.values()) : 0
  const topPatternRecommendationRows =
    recommendationRowsByPattern.size > 0 ? Math.max(0, ...recommendationRowsByPattern.values()) : 0
  const topSymbolRecommendationRows =
    recommendationRowsBySymbol.size > 0 ? Math.max(0, ...recommendationRowsBySymbol.values()) : 0
  return {
    totalRows: unionRows.length,
    operationalHitRows,
    operationalMissRows,
    operationalPrecision: safeRatio(operationalHitRows, unionRows.length),
    entryExecutableRows,
    nonExecutableRows,
    selectedPatternCount: selectedPatternIds.length,
    operationalHitDatesByYear,
    operationalHitSymbolDatesByYear,
    minOperationalHitDatesPerYear: Math.min(...coreYears.map((year) => operationalHitDatesByYear[year] ?? 0)),
    minOperationalHitSymbolDatesPerYear: Math.min(...coreYears.map((year) => operationalHitSymbolDatesByYear[year] ?? 0)),
    monthlyStats: [...monthly.values()],
    minRecommendationsPerFullMonth: Math.min(...[...monthly.values()].map((row) => row.recommendationRows)),
    minOperationalHitsPerFullMonth: Math.min(...[...monthly.values()].map((row) => row.operationalHitRows)),
    hitRowsByPattern: mapToSortedObject(hitRowsByPattern),
    recommendationRowsByPattern: mapToSortedObject(recommendationRowsByPattern),
    topPatternHitRows,
    topPatternHitShare: safeRatio(topPatternHitRows, operationalHitRows),
    topPatternRecommendationRows,
    topPatternRecommendationShare: safeRatio(topPatternRecommendationRows, unionRows.length),
    topSymbolRecommendationRows,
    topSymbolRecommendationShare: safeRatio(topSymbolRecommendationRows, unionRows.length),
  }
}

const buildRejectReasons = ({ selectedPatternRows, unionMetrics, options }) => {
  const reasons = []
  if (selectedPatternRows.length < options.minPatterns) reasons.push("selected_patterns_below_min")
  if (unionMetrics.totalRows < 1) reasons.push("bundle_zero_recommendation_rows")
  if (unionMetrics.operationalPrecision < options.minBundleOperationalPrecision) {
    reasons.push("bundle_operational_precision_below_100pct_gate")
  }
  if (unionMetrics.minOperationalHitDatesPerYear < options.minOperationalHitDatesPerYear) {
    reasons.push("bundle_year2_hit_dates_below_min")
  }
  if (unionMetrics.minOperationalHitSymbolDatesPerYear < options.minOperationalHitSymbolDatesPerYear) {
    reasons.push("bundle_year2_hit_symbol_dates_below_min")
  }
  for (const month of unionMetrics.monthlyStats) {
    if (month.recommendationRows < options.targetRecommendationsPerFullMonth) {
      reasons.push(`monthly_recommendations_below_target:${month.monthKey}`)
    }
    if (month.operationalHitRows < options.targetOperationalHitsPerFullMonth) {
      reasons.push(`monthly_operational_hits_below_target:${month.monthKey}`)
    }
  }
  if (selectedPatternRows.length > 1 && unionMetrics.topPatternHitShare > options.maxTopPatternHitShare) {
    reasons.push("top_pattern_hit_share_above_max")
  }
  if (selectedPatternRows.length > 1 && unionMetrics.topPatternRecommendationShare > options.maxTopPatternRecommendationShare) {
    reasons.push("top_pattern_recommendation_share_above_max")
  }
  if (unionMetrics.topSymbolRecommendationShare > options.maxTopSymbolRecommendationShare) {
    reasons.push("top_symbol_recommendation_share_above_max")
  }
  return reasons
}

export const buildTp12Year2hitMonthlyCoverageBundleOptimizer = async ({
  eligiblePatternsPath,
  operationalEventsPath,
  contractPath = "",
  outSummaryPath,
  outBundlePath = "",
  outSelectedPatternsPath = "",
  outUnionRowsPath = "",
  outRejectedPatternsPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(eligiblePatternsPath)) throw new Error("eligiblePatternsPath is required")
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)

  const { candidates, rejected, rejectReasonCounts } = await readCandidatePatterns({ eligiblePatternsPath, options })
  const candidatePatternIds = candidates.map((row) => row.patternId)
  const eventStats = await loadEventsByPattern({ operationalEventsPath, candidatePatternIds, options })
  const eventsByPattern = eventStats.byPattern
  const patternsWithoutEvents = candidatePatternIds.filter((patternId) => (eventsByPattern.get(patternId) ?? []).length < 1)
  const selectedPatternRows = []
  const selectedPatternIdSet = new Set()
  const unionState = initUnionState(options.fullMonthKeys)
  const selectionSteps = []

  while (selectedPatternRows.length < options.maxPatterns) {
    const remaining = candidates.filter((row) => !selectedPatternIdSet.has(row.patternId))
    if (remaining.length < 1) break
    const next = pickNextPattern({ remainingPatternRows: remaining, eventsByPattern, unionState, options })
    if (!next || next.score.score <= 0) break
    const patternRow = next.patternRow
    selectedPatternRows.push(patternRow)
    selectedPatternIdSet.add(patternRow.patternId)
    for (const event of eventsByPattern.get(patternRow.patternId) ?? []) addUnionEvent({ unionState, event, patternRow })
    selectionSteps.push({
      rank: selectionSteps.length + 1,
      patternId: patternRow.patternId,
      optimizerPatternScore: patternRow.optimizerPatternScore,
      incremental: next.score,
    })
    const unionRows = [...unionState.rowsByKey.values()]
    const unionMetrics = finalizeUnionMetrics({
      unionRows,
      selectedPatternIds: selectedPatternRows.map((row) => row.patternId),
      fullMonthKeys: options.fullMonthKeys,
      coreYears: options.coreYears,
    })
    if (buildRejectReasons({ selectedPatternRows, unionMetrics, options }).length === 0) break
  }

  const selectedPatternIds = selectedPatternRows.map((row) => row.patternId).sort()
  const bundleId = `monthly_bundle_${sha256TextLines(selectedPatternIds).slice(0, 16)}`
  const unionRows = [...unionState.rowsByKey.values()]
    .sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol))
    .map((row) => ({
      ...row,
      bundleId,
      supportPatternIds: uniqueSorted(row.supportPatternIds),
      supportPatternCount: uniqueSorted(row.supportPatternIds).length,
    }))
  const unionMetrics = finalizeUnionMetrics({
    unionRows,
    selectedPatternIds,
    fullMonthKeys: options.fullMonthKeys,
    coreYears: options.coreYears,
  })
  const rejectReasons = buildRejectReasons({ selectedPatternRows, unionMetrics, options })
  if (candidates.length < 1) rejectReasons.push("zero_eligible_100pct_year2hit_patterns")
  if (patternsWithoutEvents.length > 0) rejectReasons.push("eligible_patterns_without_operational_events")
  const bundle = {
    kind: "tp12_year2hit_monthly_coverage_bundle_row_v1",
    bundleId,
    status: rejectReasons.length > 0 ? "rejected" : "passed",
    selectedPatternIds,
    selectedPatternCount: selectedPatternIds.length,
    selectedPatternIdsSha256: sha256TextLines(selectedPatternIds),
    unionMetrics,
    rejectReasons,
  }
  const bundles = bundle.status === "passed" ? [bundle] : []
  const failures = []
  if (options.failOnGateFailure && bundles.length < 1) failures.push(`zero_monthly_coverage_bundles:${rejectReasons.join(",")}`)
  const summary = {
    kind: TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_KIND,
    patchKey: TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    eligiblePatternsPath: path.resolve(eligiblePatternsPath),
    operationalEventsPath: path.resolve(operationalEventsPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
      lockedFutureFrom: options.lockedFutureFrom,
    },
    coreYears: options.coreYears,
    fullMonthKeys: options.fullMonthKeys,
    candidatePatternCount: candidates.length,
    rejectedPatternCount: rejected.length,
    candidatePatternIdsSha256: sha256TextLines(candidatePatternIds),
    rejectedPatternRejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    patternsWithoutEvents,
    selectedPatternCount: selectedPatternIds.length,
    selectedPatternIds,
    selectedPatternIdsSha256: sha256TextLines(selectedPatternIds),
    bundleCount: bundles.length,
    unionRowCount: unionRows.length,
    selectionSteps,
    eventStats: {
      inputRowCount: eventStats.inputRowCount,
      ignoredNonCandidateRowCount: eventStats.ignoredNonCandidateRowCount,
      outsideDateRowCount: eventStats.outsideDateRowCount,
      outsideFullMonthRowCount: eventStats.outsideFullMonthRowCount,
    },
    options,
    bundle,
    failures,
  }
  await writeJson(outSummaryPath, summary)
  if (toText(outBundlePath)) await writeJsonlRows(outBundlePath, bundles)
  if (toText(outSelectedPatternsPath)) await writeJsonlRows(outSelectedPatternsPath, selectedPatternRows)
  if (toText(outUnionRowsPath)) await writeJsonlRows(outUnionRowsPath, unionRows)
  if (toText(outRejectedPatternsPath)) await writeJsonlRows(outRejectedPatternsPath, rejected)
  if (failures.length > 0) throw new Error(`tp12 monthly coverage bundle optimizer failed: ${failures.join("; ")}`)
  return summary
}
