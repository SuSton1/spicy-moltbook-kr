import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  assertTp12OperationalHitRow,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"
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

export const TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_KIND =
  "tp12_year2hit_operational_fold_stability_gate_summary_v1"
export const TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_PATCH_KEY =
  "tp12_train_internal_validation_protocol_v1"
export const DEFAULT_TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_CONTRACT_PATH =
  "meta/tp12_train_internal_validation_protocol_contract.json"

const rowKeyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`
const monthKeyOf = (dateKey) => toText(dateKey).slice(0, 7)
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

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
  if (!contract) throw new Error(`train internal validation protocol contract not found: ${resolvedPath}`)
  return contract
}

const deriveOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const hitContract = contract.hitContract ?? {}
  const fold = contract.foldValidation ?? {}
  const fragility = contract.structuralFragilityGate ?? {}
  const monthly = contract.monthlyGate ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    coreYears: fold.coreYears,
    minValidationOperationalHitDatesPerYear: fold.minValidationOperationalHitDatesPerYear,
    minValidationOperationalHitSymbolDatesPerYear: fold.minValidationOperationalHitSymbolDatesPerYear,
    maxValidationOperationalMissRows: fold.maxValidationOperationalMissRows,
    maxValidationNotChartHitRows: fold.maxValidationNotChartHitRows,
    minStablePatternCount: fold.minStablePatternCount,
    failOnGateFailure: fold.failOnGateFailure,
    requirePatternMetadata: fragility.requirePatternMetadata,
    rejectStructuralFlags: fragility.rejectFlags,
    requireExplicitFullMonthKeys: monthly.requireExplicitFullMonthKeys,
    requireMonthlyGate: monthly.requireMonthlyGate,
    fullMonthKeys: monthly.fullMonthKeys,
    targetRecommendationsPerFullMonth: monthly.targetRecommendationsPerFullMonth,
    targetOperationalHitsPerFullMonth: monthly.targetOperationalHitsPerFullMonth,
    maxRecommendationsPerDecisionDate: monthly.maxRecommendationsPerDecisionDate,
    hitDefinition: hitContract.hitDefinition,
    hitField: hitContract.hitField,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveOptionsFromContract(contract) : {}
  return {
    dateFrom: toText(raw.dateFrom ?? contractOptions.dateFrom ?? "2016-01-04"),
    dateTo: toText(raw.dateTo ?? contractOptions.dateTo ?? "2024-12-30"),
    lockedFutureFrom: toText(raw.lockedFutureFrom ?? contractOptions.lockedFutureFrom ?? "2025-01-02"),
    coreYears: normalizeYears(raw.coreYears ?? contractOptions.coreYears),
    minValidationOperationalHitDatesPerYear: Math.max(
      1,
      Math.trunc(
        toNumber(
          raw.minValidationOperationalHitDatesPerYear ?? contractOptions.minValidationOperationalHitDatesPerYear,
          2,
        ),
      ),
    ),
    minValidationOperationalHitSymbolDatesPerYear: Math.max(
      1,
      Math.trunc(
        toNumber(
          raw.minValidationOperationalHitSymbolDatesPerYear ??
            contractOptions.minValidationOperationalHitSymbolDatesPerYear,
          2,
        ),
      ),
    ),
    maxValidationOperationalMissRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxValidationOperationalMissRows ?? contractOptions.maxValidationOperationalMissRows, 0)),
    ),
    maxValidationNotChartHitRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxValidationNotChartHitRows ?? contractOptions.maxValidationNotChartHitRows, 0)),
    ),
    minStablePatternCount: Math.max(
      0,
      Math.trunc(toNumber(raw.minStablePatternCount ?? contractOptions.minStablePatternCount, 1)),
    ),
    requirePatternMetadata: toBool(raw.requirePatternMetadata ?? contractOptions.requirePatternMetadata, false),
    rejectStructuralFlags: uniqueSorted(
      raw.rejectStructuralFlags ?? contractOptions.rejectStructuralFlags ?? [
        "small_tile_dominated",
        "year_stitched_cover",
        "all_tiles_year2_incomplete",
        "extreme_rank_heavy",
        "single_tile_drop_year_zero",
      ],
    ),
    requireExplicitFullMonthKeys: toBool(
      raw.requireExplicitFullMonthKeys ?? contractOptions.requireExplicitFullMonthKeys,
      true,
    ),
    requireMonthlyGate: toBool(raw.requireMonthlyGate ?? contractOptions.requireMonthlyGate, false),
    fullMonthKeys: normalizeMonthKeys(raw.fullMonthKeys ?? contractOptions.fullMonthKeys),
    targetRecommendationsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetRecommendationsPerFullMonth ?? contractOptions.targetRecommendationsPerFullMonth, 5)),
    ),
    targetOperationalHitsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetOperationalHitsPerFullMonth ?? contractOptions.targetOperationalHitsPerFullMonth, 5)),
    ),
    maxRecommendationsPerDecisionDate: Math.max(
      1,
      Math.trunc(toNumber(raw.maxRecommendationsPerDecisionDate ?? contractOptions.maxRecommendationsPerDecisionDate, 1)),
    ),
    failOnGateFailure: toBool(raw.failOnGateFailure ?? contractOptions.failOnGateFailure, true),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`operational fold stability gate requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`operational fold stability gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid internal validation date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  for (const year of options.coreYears) {
    if (!/^\d{4}$/.test(year)) throw new Error(`invalid core year: ${year}`)
  }
  if (options.requireMonthlyGate && options.requireExplicitFullMonthKeys && options.fullMonthKeys.length < 1) {
    throw new Error("fullMonthKeys are required when monthly gate is enabled")
  }
}

export const buildYearHoldoutFolds = (coreYears = []) =>
  normalizeYears(coreYears).map((year) => ({
    foldId: `leave_one_year_out_${year}`,
    mode: "leave_one_year_out",
    validationYear: year,
    trainYears: normalizeYears(coreYears).filter((candidate) => candidate !== year),
  }))

const emptyYearStats = () => ({
  eventRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  notChartHitRows: 0,
  nonExecutableRows: 0,
  matchedDates: new Set(),
  operationalHitDates: new Set(),
  operationalHitSymbolDates: new Set(),
})

const emptyPatternState = (patternId, coreYears) => ({
  patternId,
  eventRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  notChartHitRows: 0,
  nonExecutableRows: 0,
  symbols: new Set(),
  matchedDates: new Set(),
  matchedMonths: new Set(),
  hitMonthsByYear: new Map(coreYears.map((year) => [year, new Set()])),
  yearStats: new Map(coreYears.map((year) => [year, emptyYearStats()])),
  rows: [],
  missReasonCounts: new Map(),
})

const addPatternEvent = ({ state, event }) => {
  state.eventRows += 1
  state.rows.push(event)
  state.symbols.add(event.symbol)
  state.matchedDates.add(event.decisionDateKey)
  state.matchedMonths.add(monthKeyOf(event.decisionDateKey))
  const year = event.decisionDateKey.slice(0, 4)
  const stats = state.yearStats.get(year) ?? emptyYearStats()
  stats.eventRows += 1
  stats.matchedDates.add(event.decisionDateKey)
  if (event.entryExecutable !== true) {
    state.nonExecutableRows += 1
    stats.nonExecutableRows += 1
  }
  if (event.operationalHitTarget === true) {
    state.operationalHitRows += 1
    stats.operationalHitRows += 1
    stats.operationalHitDates.add(event.decisionDateKey)
    stats.operationalHitSymbolDates.add(rowKeyOf(event))
    const months = state.hitMonthsByYear.get(year) ?? new Set()
    months.add(monthKeyOf(event.decisionDateKey))
    state.hitMonthsByYear.set(year, months)
  } else {
    state.operationalMissRows += 1
    stats.operationalMissRows += 1
    if (event.chartHitTarget !== true || event.operationalMissReasons.includes("not_chart_hit")) {
      state.notChartHitRows += 1
      stats.notChartHitRows += 1
    }
    for (const reason of event.operationalMissReasons.length > 0 ? event.operationalMissReasons : ["missing_reason"]) {
      incrementMap(state.missReasonCounts, reason)
    }
  }
  state.yearStats.set(year, stats)
}

const normalizeEvent = ({ row, context, options }) => {
  const patternId = toText(row?.patternId ?? row?.coverId ?? row?.ruleId ?? row?.id)
  const symbol = toText(row?.symbol).toUpperCase()
  const decisionDateKey = toText(row?.decisionDateKey ?? row?.dateKey)
  if (!patternId) throw new Error(`operational fold row missing patternId at ${context}`)
  if (!symbol) throw new Error(`operational fold row missing symbol at ${context}`)
  if (!validDateKey(decisionDateKey)) throw new Error(`operational fold row invalid decisionDateKey at ${context}: ${decisionDateKey}`)
  if (decisionDateKey >= options.lockedFutureFrom) {
    throw new Error(`locked future row cannot enter train internal validation: ${decisionDateKey}::${symbol}`)
  }
  if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return null
  assertTp12OperationalHitRow(row, { context, hitField: options.hitField })
  const operationalMissReasons = Array.isArray(row.operationalMissReasons)
    ? row.operationalMissReasons.map(toText).filter(Boolean)
    : []
  return {
    patternId,
    symbol,
    decisionDateKey,
    chartHitTarget: row.chartHitTarget === true,
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget: row[options.hitField] === true,
    operationalMissReasons,
  }
}

const readPatternMetadata = async (patternMetadataPath) => {
  const sourcePath = toText(patternMetadataPath)
  if (!sourcePath) return new Map()
  if (!fs.existsSync(sourcePath)) throw new Error(`pattern metadata path not found: ${sourcePath}`)
  const metadata = new Map()
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId ?? row?.coverId ?? row?.ruleId ?? row?.id)
      if (!patternId) throw new Error(`pattern metadata row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (metadata.has(patternId)) throw new Error(`duplicate pattern metadata row: ${patternId}`)
      metadata.set(patternId, row)
    },
  })
  return metadata
}

const hasFlag = (row, flag) => {
  if (!row) return false
  const directKeys = {
    small_tile_dominated: ["smallTileDominated", "smallTileDominatedLt8", "smallTileDominatedLt10"],
    year_stitched_cover: ["yearStitchedCover", "stitchedYearCoverage"],
    all_tiles_year2_incomplete: ["allTilesYear2Incomplete"],
    extreme_rank_heavy: ["extremeRankHeavy"],
    single_tile_drop_year_zero: ["singleTileDropYearZero"],
  }[flag] ?? [flag]
  for (const key of directKeys) {
    if (row[key] === true) return true
    if (row.flags?.[key] === true) return true
    if (row.tileDiagnostics?.flags?.[key] === true) return true
    if (row.structuralFragilityProfile?.flags?.[key] === true) return true
  }
  const arrays = [row.fragilityFlags, row.rejectReasons, row.structuralRejectReasons]
  return arrays.some((items) => Array.isArray(items) && items.map(toText).includes(flag))
}

export const canonicalCoverSignature = (metadata = {}) => {
  const payload = {
    patternId: toText(metadata.patternId ?? metadata.coverId ?? metadata.ruleId ?? metadata.id),
    sourceBaseIds: uniqueSorted(metadata.sourceBaseIds ?? metadata.baseIds ?? []),
    tileIds: uniqueSorted(metadata.tileIds ?? metadata.tiles?.map((tile) => tile.tileId) ?? []),
    atomSignatureHash: toText(metadata.atomSignatureHash ?? metadata.coverSignatureHash ?? metadata.signatureHash),
    tokenSet: uniqueSorted(metadata.tokenSet ?? metadata.tokens ?? []),
  }
  return sha256TextLines([JSON.stringify(payload)])
}

export const buildStructuralFragilityProfile = ({ metadata = null, options } = {}) => {
  const flags = {}
  for (const flag of options.rejectStructuralFlags) flags[flag] = hasFlag(metadata, flag)
  if (metadata) {
    const minAfterDrop = toNumber(
      metadata.minHitDatesPerYearAfterSingleTileDrop ??
        metadata.tileDiagnostics?.minHitDatesPerYearAfterSingleTileDrop ??
        metadata.stabilityGate?.minHitDatesPerYearAfterSingleTileDrop,
      NaN,
    )
    if (Number.isFinite(minAfterDrop) && minAfterDrop < options.minValidationOperationalHitDatesPerYear) {
      flags.single_tile_drop_year_zero = true
    }
  }
  const rejectReasons = Object.entries(flags)
    .filter(([, value]) => value === true)
    .map(([flag]) => flag)
  return {
    metadataPresent: metadata !== null,
    coverSignatureHash: metadata ? canonicalCoverSignature(metadata) : null,
    flags,
    rejectReasons,
  }
}

export const evaluateCoverOnFold = ({ state, fold, options }) => {
  const stats = state.yearStats.get(fold.validationYear) ?? emptyYearStats()
  const rejectReasons = []
  if (stats.operationalMissRows > options.maxValidationOperationalMissRows) {
    rejectReasons.push("fold_validation_operational_miss")
  }
  if (stats.notChartHitRows > options.maxValidationNotChartHitRows) {
    rejectReasons.push("fold_validation_not_chart_hit")
  }
  if (stats.operationalHitDates.size < options.minValidationOperationalHitDatesPerYear) {
    rejectReasons.push("fold_validation_hit_dates_below_min_year")
  }
  if (stats.operationalHitSymbolDates.size < options.minValidationOperationalHitSymbolDatesPerYear) {
    rejectReasons.push("fold_validation_hit_symbol_dates_below_min_year")
  }
  return {
    foldId: fold.foldId,
    validationYear: fold.validationYear,
    trainYears: fold.trainYears,
    eventRows: stats.eventRows,
    operationalHitRows: stats.operationalHitRows,
    operationalMissRows: stats.operationalMissRows,
    notChartHitRows: stats.notChartHitRows,
    nonExecutableRows: stats.nonExecutableRows,
    uniqueMatchedDates: stats.matchedDates.size,
    uniqueOperationalHitDates: stats.operationalHitDates.size,
    uniqueOperationalHitSymbolDates: stats.operationalHitSymbolDates.size,
    status: rejectReasons.length > 0 ? "failed" : "passed",
    rejectReasons,
  }
}

const finalizePattern = ({ state, metadata, options, folds }) => {
  const foldResults = folds.map((fold) => evaluateCoverOnFold({ state, fold, options }))
  const structuralFragilityProfile = buildStructuralFragilityProfile({ metadata, options })
  const hitMonthsByYear = Object.fromEntries(
    options.coreYears.map((year) => [year, state.hitMonthsByYear.get(year)?.size ?? 0]),
  )
  const rejectReasons = []
  if (options.requirePatternMetadata && !metadata) rejectReasons.push("pattern_metadata_missing")
  for (const fold of foldResults) rejectReasons.push(...fold.rejectReasons)
  rejectReasons.push(...structuralFragilityProfile.rejectReasons)
  const uniqueRejectReasons = uniqueSorted(rejectReasons)
  return {
    kind: "tp12_year2hit_operational_fold_stability_pattern_v1",
    patternId: state.patternId,
    status: uniqueRejectReasons.length > 0 ? "rejected" : "passed",
    eventRows: state.eventRows,
    operationalHitRows: state.operationalHitRows,
    operationalMissRows: state.operationalMissRows,
    operationalPrecision: safeRatio(state.operationalHitRows, state.eventRows),
    notChartHitRows: state.notChartHitRows,
    nonExecutableRows: state.nonExecutableRows,
    uniqueMatchedDates: state.matchedDates.size,
    uniqueMatchedMonths: state.matchedMonths.size,
    uniqueMatchedSymbols: state.symbols.size,
    hitMonthsByYear,
    minHitMonthsPerYear: Math.min(...options.coreYears.map((year) => hitMonthsByYear[year] ?? 0)),
    missReasonCounts: mapToSortedObject(state.missReasonCounts),
    structuralFragilityProfile,
    foldResults,
    rejectReasons: uniqueRejectReasons,
  }
}

const buildMonthlyGate = ({ stablePatternIds, patternStates, options }) => {
  const stableSet = new Set(stablePatternIds)
  const byRowKey = new Map()
  const byDecisionDate = new Map()
  for (const state of patternStates.values()) {
    if (!stableSet.has(state.patternId)) continue
    for (const row of state.rows) {
      const key = rowKeyOf(row)
      const existing = byRowKey.get(key)
      if (existing) {
        existing.supportPatternIds.push(state.patternId)
        continue
      }
      byRowKey.set(key, { ...row, supportPatternIds: [state.patternId] })
      incrementMap(byDecisionDate, row.decisionDateKey)
    }
  }
  const unionRows = [...byRowKey.values()].sort(
    (left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol),
  )
  const requiredMonths = new Set(options.fullMonthKeys)
  const observedMonths = new Set(unionRows.map((row) => monthKeyOf(row.decisionDateKey)))
  const monthKeys = uniqueSorted([...requiredMonths, ...observedMonths])
  const fullMonthStats = monthKeys.map((monthKey) => {
    const rows = unionRows.filter((row) => monthKeyOf(row.decisionDateKey) === monthKey)
    const recommendationsByDate = new Map()
    for (const row of rows) incrementMap(recommendationsByDate, row.decisionDateKey)
    const dateCapViolations = [...recommendationsByDate.entries()]
      .filter(([, count]) => count > options.maxRecommendationsPerDecisionDate)
      .map(([decisionDateKey, count]) => ({ decisionDateKey, count }))
    const fullMonthEligible = requiredMonths.size > 0 ? requiredMonths.has(monthKey) : true
    const operationalHitRows = rows.filter((row) => row.operationalHitTarget === true).length
    const executableRecommendationCount = rows.filter((row) => row.entryExecutable === true).length
    const rejectReasons = []
    if (fullMonthEligible && rows.length < options.targetRecommendationsPerFullMonth) {
      rejectReasons.push("monthly_recommendations_below_min")
    }
    if (fullMonthEligible && operationalHitRows < options.targetOperationalHitsPerFullMonth) {
      rejectReasons.push("monthly_operational_hits_below_min")
    }
    if (dateCapViolations.length > 0) rejectReasons.push("monthly_same_day_recommendation_cap_exceeded")
    return {
      monthKey,
      fullMonthEligible,
      selectedRows: rows.length,
      executableRecommendationCount,
      operationalHitRows,
      uniqueDecisionDates: recommendationsByDate.size,
      targetRecommendationsPerFullMonth: options.targetRecommendationsPerFullMonth,
      targetOperationalHitsPerFullMonth: options.targetOperationalHitsPerFullMonth,
      maxRecommendationsPerDecisionDate: options.maxRecommendationsPerDecisionDate,
      dateCapViolations,
      status: rejectReasons.length > 0 ? "failed" : "passed",
      rejectReasons,
    }
  })
  const monthlyRejectReasons = options.requireMonthlyGate
    ? uniqueSorted(fullMonthStats.flatMap((row) => (row.fullMonthEligible ? row.rejectReasons : [])))
    : []
  return {
    kind: "tp12_year2hit_operational_fold_monthly_gate_v1",
    enabled: options.requireMonthlyGate,
    unionRows: unionRows.length,
    fullMonthKeys: options.fullMonthKeys,
    fullMonthStats,
    rejectReasons: monthlyRejectReasons,
  }
}

export const buildTp12Year2hitOperationalFoldStabilityGate = async ({
  operationalEventsPath,
  patternMetadataPath = "",
  contractPath = DEFAULT_TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_CONTRACT_PATH,
  outSummaryPath,
  outStablePatternsPath = "",
  outRejectedPatternsPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!fs.existsSync(operationalEventsPath)) throw new Error(`operational events path not found: ${operationalEventsPath}`)
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)
  const metadataByPattern = await readPatternMetadata(patternMetadataPath)
  const folds = buildYearHoldoutFolds(options.coreYears)
  const patternStates = new Map()
  let inputRows = 0
  let outsideDateRows = 0
  await iterateJsonlMaybeGzip(operationalEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRows += 1
      const event = normalizeEvent({
        row,
        context: `${context.filePath}:${context.lineNumber}`,
        options,
      })
      if (!event) {
        outsideDateRows += 1
        return
      }
      const state = patternStates.get(event.patternId) ?? emptyPatternState(event.patternId, options.coreYears)
      addPatternEvent({ state, event })
      patternStates.set(event.patternId, state)
    },
  })
  if (patternStates.size < 1) throw new Error(`operational fold stability gate read zero patterns: ${operationalEventsPath}`)
  const patternRows = [...patternStates.values()]
    .map((state) =>
      finalizePattern({
        state,
        metadata: metadataByPattern.get(state.patternId) ?? null,
        options,
        folds,
      }),
    )
    .sort((left, right) => left.patternId.localeCompare(right.patternId))
  const stablePatterns = patternRows.filter((row) => row.status === "passed")
  const rejectedPatterns = patternRows.filter((row) => row.status !== "passed")
  const rejectReasonCounts = new Map()
  for (const row of rejectedPatterns) {
    for (const reason of row.rejectReasons) incrementMap(rejectReasonCounts, reason)
  }
  const monthlyGate = buildMonthlyGate({
    stablePatternIds: stablePatterns.map((row) => row.patternId),
    patternStates,
    options,
  })
  const gateRejectReasons = []
  if (stablePatterns.length < options.minStablePatternCount) gateRejectReasons.push("stable_pattern_count_below_min")
  gateRejectReasons.push(...monthlyGate.rejectReasons)
  const stablePatternIds = stablePatterns.map((row) => row.patternId)
  const payload = {
    kind: TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_KIND,
    patchKey: TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status: gateRejectReasons.length > 0 ? "failed" : "passed",
    verdict: gateRejectReasons.length > 0 ? "not_ready_for_locked_future_eval" : "internal_validation_passed",
    contractPath: contractPath ? path.resolve(contractPath) : null,
    operationalEventsPath: path.resolve(operationalEventsPath),
    patternMetadataPath: patternMetadataPath ? path.resolve(patternMetadataPath) : null,
    dateRange: { from: options.dateFrom, to: options.dateTo },
    lockedFutureFrom: options.lockedFutureFrom,
    hitDefinition: options.hitDefinition,
    hitField: options.hitField,
    inputRows,
    outsideDateRows,
    patternCount: patternRows.length,
    stablePatternCount: stablePatterns.length,
    rejectedPatternCount: rejectedPatterns.length,
    stablePatternIds,
    selectedPatternIdsSha256: sha256TextLines(stablePatternIds),
    foldAuditHash: sha256TextLines(
      patternRows.flatMap((row) =>
        row.foldResults.map((fold) => `${row.patternId}\t${fold.foldId}\t${fold.status}\t${fold.rejectReasons.join(",")}`),
      ),
    ),
    structuralRejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    monthlyGate,
    options,
    rejectReasons: uniqueSorted(gateRejectReasons),
  }
  await writeJson(outSummaryPath, payload)
  if (toText(outStablePatternsPath)) await writeJsonlRows(outStablePatternsPath, stablePatterns)
  if (toText(outRejectedPatternsPath)) await writeJsonlRows(outRejectedPatternsPath, rejectedPatterns)
  if (payload.status !== "passed" && options.failOnGateFailure) {
    throw new Error(`tp12 train internal validation gate failed: ${payload.rejectReasons.join("; ")}`)
  }
  return payload
}
