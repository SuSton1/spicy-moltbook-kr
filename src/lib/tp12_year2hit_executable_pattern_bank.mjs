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

const rowKeyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const loadContract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`pattern bank contract not found: ${resolvedPath}`)
  return contract
}

const normalizeYears = (value, fallbackFrom = 2016, fallbackTo = 2024) => {
  if (Array.isArray(value) && value.length > 0) {
    const years = [...new Set(value.map((year) => Number(year)).filter((year) => Number.isInteger(year)))].sort(
      (left, right) => left - right,
    )
    if (years.length > 0) return years.map(String)
  }
  const years = []
  for (let year = fallbackFrom; year <= fallbackTo; year += 1) years.push(String(year))
  return years
}

export const deriveTp12ExecutablePatternBankOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const bank = contract.patternBank ?? {}
  const hitContract = contract.hitContract ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    coreYears: bank.coreYears,
    minOperationalHitDatesPerYear: bank.minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear: bank.minOperationalHitSymbolDatesPerYear,
    failOnZeroSurvivors: bank.failOnZeroSurvivors,
    hitDefinition: hitContract.hitDefinition,
    hitField: hitContract.hitField,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveTp12ExecutablePatternBankOptionsFromContract(contract) : {}
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
    failOnZeroSurvivors: toBool(raw.failOnZeroSurvivors ?? contractOptions.failOnZeroSurvivors, true),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`executable pattern bank requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`executable pattern bank requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid pattern bank date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  for (const year of options.coreYears) {
    if (!/^\d{4}$/.test(year)) throw new Error(`invalid core year: ${year}`)
    if (`${year}-01-01` < options.dateFrom || `${year}-12-31` > options.dateTo) {
      throw new Error(`core year outside internal validation date range: ${year}`)
    }
  }
}

const emptyPatternState = (patternId, coreYears) => ({
  patternId,
  eventRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  entryExecutableRows: 0,
  nonExecutableRows: 0,
  chartHitRows: 0,
  chartMissRows: 0,
  symbols: new Set(),
  matchedDates: new Set(),
  operationalHitDates: new Set(),
  operationalHitSymbolDates: new Set(),
  hitDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  hitSymbolDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  missReasonCounts: new Map(),
})

const addPatternEvent = ({ state, event }) => {
  state.eventRows += 1
  state.symbols.add(event.symbol)
  state.matchedDates.add(event.decisionDateKey)
  if (event.chartHitTarget) state.chartHitRows += 1
  else state.chartMissRows += 1
  if (event.entryExecutable) state.entryExecutableRows += 1
  else state.nonExecutableRows += 1
  if (event.operationalHitTarget) {
    state.operationalHitRows += 1
    state.operationalHitDates.add(event.decisionDateKey)
    state.operationalHitSymbolDates.add(rowKeyOf(event))
    const year = event.decisionDateKey.slice(0, 4)
    const dates = state.hitDatesByYear.get(year) ?? new Set()
    dates.add(event.decisionDateKey)
    state.hitDatesByYear.set(year, dates)
    const symbolDates = state.hitSymbolDatesByYear.get(year) ?? new Set()
    symbolDates.add(rowKeyOf(event))
    state.hitSymbolDatesByYear.set(year, symbolDates)
    return
  }
  state.operationalMissRows += 1
  const reasons = Array.isArray(event.operationalMissReasons) ? event.operationalMissReasons : []
  for (const reason of reasons.length > 0 ? reasons : ["missing_operational_miss_reason"]) {
    incrementMap(state.missReasonCounts, reason)
  }
}

const finalizePatternState = ({ state, options }) => {
  const operationalHitDatesByYear = Object.fromEntries(
    options.coreYears.map((year) => [year, state.hitDatesByYear.get(year)?.size ?? 0]),
  )
  const operationalHitSymbolDatesByYear = Object.fromEntries(
    options.coreYears.map((year) => [year, state.hitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const belowMinOperationalHitYears = options.coreYears.filter(
    (year) => (operationalHitDatesByYear[year] ?? 0) < options.minOperationalHitDatesPerYear,
  )
  const belowMinOperationalHitSymbolYears = options.coreYears.filter(
    (year) => (operationalHitSymbolDatesByYear[year] ?? 0) < options.minOperationalHitSymbolDatesPerYear,
  )
  const rejectReasons = []
  if (belowMinOperationalHitYears.length > 0) rejectReasons.push("operational_hit_dates_below_min_year")
  if (belowMinOperationalHitSymbolYears.length > 0) rejectReasons.push("operational_hit_symbol_dates_below_min_year")
  return {
    kind: "tp12_year2hit_executable_pattern_bank_row_v1",
    patternId: state.patternId,
    status: rejectReasons.length > 0 ? "rejected" : "passed",
    eventRows: state.eventRows,
    operationalHitRows: state.operationalHitRows,
    operationalMissRows: state.operationalMissRows,
    operationalPrecision: safeRatio(state.operationalHitRows, state.eventRows),
    entryExecutableRows: state.entryExecutableRows,
    nonExecutableRows: state.nonExecutableRows,
    chartHitRows: state.chartHitRows,
    chartMissRows: state.chartMissRows,
    uniqueMatchedDates: state.matchedDates.size,
    uniqueMatchedSymbols: state.symbols.size,
    uniqueOperationalHitDates: state.operationalHitDates.size,
    uniqueOperationalHitSymbolDates: state.operationalHitSymbolDates.size,
    minOperationalHitDatesPerYear: Math.min(
      ...options.coreYears.map((year) => operationalHitDatesByYear[year] ?? 0),
    ),
    minOperationalHitSymbolDatesPerYear: Math.min(
      ...options.coreYears.map((year) => operationalHitSymbolDatesByYear[year] ?? 0),
    ),
    operationalHitDatesByYear,
    operationalHitSymbolDatesByYear,
    belowMinOperationalHitYears,
    belowMinOperationalHitSymbolYears,
    missReasonCounts: mapToSortedObject(state.missReasonCounts),
    rejectReasons,
  }
}

const normalizeEvent = ({ row, context, options }) => {
  const patternId = toText(row?.patternId)
  const symbol = toText(row?.symbol).toUpperCase()
  const decisionDateKey = toText(row?.decisionDateKey)
  if (!patternId) throw new Error(`operational event missing patternId at ${context}`)
  if (!symbol) throw new Error(`operational event missing symbol at ${context}`)
  if (!validDateKey(decisionDateKey)) throw new Error(`operational event invalid decisionDateKey at ${context}: ${decisionDateKey}`)
  if (decisionDateKey >= options.lockedFutureFrom) {
    throw new Error(`locked future row cannot enter executable pattern bank: ${decisionDateKey}::${symbol}`)
  }
  if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return null
  assertTp12OperationalHitRow(row, { context, hitField: options.hitField })
  return {
    patternId,
    symbol,
    decisionDateKey,
    chartHitTarget: row.chartHitTarget === true,
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget: row[options.hitField] === true,
    operationalMissReasons: Array.isArray(row.operationalMissReasons) ? row.operationalMissReasons : [],
  }
}

export const buildTp12Year2hitExecutablePatternBank = async ({
  operationalEventsPath,
  contractPath = "",
  outSummaryPath,
  outBankPath = "",
  outRejectedPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)

  const byPattern = new Map()
  const seenKeys = new Set()
  let inputRowCount = 0
  let outsideDateRowCount = 0
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
      const key = `${event.patternId}\t${event.decisionDateKey}\t${event.symbol}`
      if (seenKeys.has(key)) throw new Error(`duplicate operational event key in pattern bank: ${key}`)
      seenKeys.add(key)
      const state = byPattern.get(event.patternId) ?? emptyPatternState(event.patternId, options.coreYears)
      addPatternEvent({ state, event })
      byPattern.set(event.patternId, state)
    },
  })

  const rows = [...byPattern.values()]
    .map((state) => finalizePatternState({ state, options }))
    .sort(
      (left, right) =>
        right.minOperationalHitDatesPerYear - left.minOperationalHitDatesPerYear ||
        right.operationalHitRows - left.operationalHitRows ||
        left.operationalMissRows - right.operationalMissRows ||
        left.patternId.localeCompare(right.patternId),
    )
  const bankRows = rows.filter((row) => row.status === "passed")
  const rejectedRows = rows.filter((row) => row.status !== "passed")
  const survivorPatternIds = bankRows.map((row) => row.patternId).sort()
  const rejectReasonCounts = new Map()
  for (const row of rejectedRows) {
    for (const reason of row.rejectReasons) incrementMap(rejectReasonCounts, reason)
  }
  const failures = []
  if (options.failOnZeroSurvivors && survivorPatternIds.length < 1) failures.push("zero_executable_year2hit_patterns")
  const summary = {
    kind: "tp12_year2hit_executable_pattern_bank_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    operationalEventsPath: path.resolve(operationalEventsPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
      lockedFutureFrom: options.lockedFutureFrom,
    },
    coreYears: options.coreYears,
    minOperationalHitDatesPerYear: options.minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear: options.minOperationalHitSymbolDatesPerYear,
    inputRowCount,
    outsideDateRowCount,
    patternCount: rows.length,
    survivorCount: bankRows.length,
    rejectedPatternCount: rejectedRows.length,
    survivorPatternIds,
    survivorPatternIdsSha256: sha256TextLines(survivorPatternIds),
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    options,
    failures,
    topSurvivors: bankRows.slice(0, 50),
  }
  await writeJson(outSummaryPath, summary)
  if (toText(outBankPath)) await writeJsonlRows(outBankPath, bankRows)
  if (toText(outRejectedPath)) await writeJsonlRows(outRejectedPath, rejectedRows)
  if (failures.length > 0) throw new Error(`tp12 executable pattern bank failed: ${failures.join("; ")}`)
  return summary
}
