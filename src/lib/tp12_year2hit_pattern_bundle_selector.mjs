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
  if (!contract) throw new Error(`bundle selector contract not found: ${resolvedPath}`)
  return contract
}

const normalizeYears = (value) => {
  const years = uniqueSorted(Array.isArray(value) ? value.map(String) : [])
  return years.length > 0 ? years : ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]
}

export const deriveTp12PatternBundleSelectorOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const bank = contract.patternBank ?? {}
  const selector = contract.bundleSelector ?? {}
  const hitContract = contract.hitContract ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    coreYears: bank.coreYears,
    minOperationalHitDatesPerYear: selector.minOperationalHitDatesPerYear ?? bank.minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear:
      selector.minOperationalHitSymbolDatesPerYear ?? bank.minOperationalHitSymbolDatesPerYear,
    minPatterns: selector.minPatterns,
    maxPatterns: selector.maxPatterns,
    maxTopPatternHitShare: selector.maxTopPatternHitShare,
    forbidYearFillerFragments: selector.forbidYearFillerFragments,
    failOnZeroBundles: selector.failOnZeroBundles,
    hitDefinition: hitContract.hitDefinition,
    hitField: hitContract.hitField,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveTp12PatternBundleSelectorOptionsFromContract(contract) : {}
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
    minPatterns: Math.max(1, Math.trunc(toNumber(raw.minPatterns ?? contractOptions.minPatterns, 1))),
    maxPatterns: Math.max(1, Math.trunc(toNumber(raw.maxPatterns ?? contractOptions.maxPatterns, 25))),
    maxTopPatternHitShare: Math.min(1, Math.max(0, toNumber(raw.maxTopPatternHitShare ?? contractOptions.maxTopPatternHitShare, 1))),
    forbidYearFillerFragments: toBool(raw.forbidYearFillerFragments ?? contractOptions.forbidYearFillerFragments, true),
    failOnZeroBundles: toBool(raw.failOnZeroBundles ?? contractOptions.failOnZeroBundles, true),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`pattern bundle selector requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`pattern bundle selector requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid bundle selector date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  if (options.maxPatterns < options.minPatterns) throw new Error("maxPatterns must be >= minPatterns")
}

const readPurgedRows = async (purgedPatternsPath) => {
  const rows = []
  await iterateJsonlMaybeGzip(purgedPatternsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`purged pattern row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (toText(row?.status) !== "passed") {
        throw new Error(`purged pattern input must contain passed rows only at ${context.filePath}:${context.lineNumber}`)
      }
      rows.push({ ...row, patternId })
    },
  })
  if (rows.length < 1) throw new Error(`purged pattern input has zero rows: ${purgedPatternsPath}`)
  const ids = uniqueSorted(rows.map((row) => row.patternId))
  if (ids.length !== rows.length) throw new Error("purged pattern input contains duplicate patternId rows")
  return rows
}

const assertNotYearFillerFragment = ({ row, options }) => {
  if (!options.forbidYearFillerFragments) return
  const minDateCount = Math.trunc(toNumber(row?.minOperationalHitDatesPerYear, 0))
  const minSymbolDateCount = Math.trunc(toNumber(row?.minOperationalHitSymbolDatesPerYear, 0))
  if (minDateCount < options.minOperationalHitDatesPerYear) {
    throw new Error(`purged pattern is a year-filler fragment by date coverage: ${row.patternId}`)
  }
  if (minSymbolDateCount < options.minOperationalHitSymbolDatesPerYear) {
    throw new Error(`purged pattern is a year-filler fragment by symbol-date coverage: ${row.patternId}`)
  }
}

const compareCandidateRows = (left, right) =>
  toNumber(left.operationalMissRows, 0) - toNumber(right.operationalMissRows, 0) ||
  toNumber(right.operationalPrecision, 0) - toNumber(left.operationalPrecision, 0) ||
  toNumber(right.minOperationalHitDatesPerYear, 0) - toNumber(left.minOperationalHitDatesPerYear, 0) ||
  toNumber(right.operationalHitRows, 0) - toNumber(left.operationalHitRows, 0) ||
  toText(left.patternId).localeCompare(toText(right.patternId))

const emptyUnionMetrics = (coreYears) => ({
  totalRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  entryExecutableRows: 0,
  nonExecutableRows: 0,
  symbols: new Set(),
  matchedDates: new Set(),
  hitDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  hitSymbolDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  hitRowsByPattern: new Map(),
})

const addUnionRow = ({ metrics, row }) => {
  metrics.totalRows += 1
  metrics.symbols.add(row.symbol)
  metrics.matchedDates.add(row.decisionDateKey)
  if (row.entryExecutable) metrics.entryExecutableRows += 1
  else metrics.nonExecutableRows += 1
  if (!row.operationalHitTarget) {
    metrics.operationalMissRows += 1
    return
  }
  metrics.operationalHitRows += 1
  const year = row.decisionDateKey.slice(0, 4)
  const dates = metrics.hitDatesByYear.get(year) ?? new Set()
  dates.add(row.decisionDateKey)
  metrics.hitDatesByYear.set(year, dates)
  const symbolDates = metrics.hitSymbolDatesByYear.get(year) ?? new Set()
  symbolDates.add(rowKeyOf(row))
  metrics.hitSymbolDatesByYear.set(year, symbolDates)
  for (const patternId of row.supportPatternIds) incrementMap(metrics.hitRowsByPattern, patternId)
}

const finalizeUnionMetrics = (metrics, coreYears) => {
  const operationalHitDatesByYear = Object.fromEntries(
    coreYears.map((year) => [year, metrics.hitDatesByYear.get(year)?.size ?? 0]),
  )
  const operationalHitSymbolDatesByYear = Object.fromEntries(
    coreYears.map((year) => [year, metrics.hitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const topPatternHitRows = metrics.hitRowsByPattern.size > 0 ? Math.max(0, ...metrics.hitRowsByPattern.values()) : 0
  return {
    totalRows: metrics.totalRows,
    operationalHitRows: metrics.operationalHitRows,
    operationalMissRows: metrics.operationalMissRows,
    operationalPrecision: safeRatio(metrics.operationalHitRows, metrics.totalRows),
    entryExecutableRows: metrics.entryExecutableRows,
    nonExecutableRows: metrics.nonExecutableRows,
    uniqueMatchedDates: metrics.matchedDates.size,
    uniqueMatchedSymbols: metrics.symbols.size,
    operationalHitDatesByYear,
    operationalHitSymbolDatesByYear,
    minOperationalHitDatesPerYear: Math.min(...coreYears.map((year) => operationalHitDatesByYear[year] ?? 0)),
    minOperationalHitSymbolDatesPerYear: Math.min(
      ...coreYears.map((year) => operationalHitSymbolDatesByYear[year] ?? 0),
    ),
    hitRowsByPattern: mapToSortedObject(metrics.hitRowsByPattern),
    topPatternHitRows,
    topPatternHitShare: safeRatio(topPatternHitRows, metrics.operationalHitRows),
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
    throw new Error(`locked future row cannot enter bundle selector: ${decisionDateKey}::${symbol}`)
  }
  if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return null
  assertTp12OperationalHitRow(row, { context, hitField: options.hitField })
  return {
    patternId,
    symbol,
    decisionDateKey,
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget: row[options.hitField] === true,
  }
}

const buildBundleRejectReasons = ({ selectedPatternRows, unionMetrics, options }) => {
  const reasons = []
  if (selectedPatternRows.length < options.minPatterns) reasons.push("selected_patterns_below_min")
  if (unionMetrics.minOperationalHitDatesPerYear < options.minOperationalHitDatesPerYear) {
    reasons.push("bundle_operational_hit_dates_below_min_year")
  }
  if (unionMetrics.minOperationalHitSymbolDatesPerYear < options.minOperationalHitSymbolDatesPerYear) {
    reasons.push("bundle_operational_hit_symbol_dates_below_min_year")
  }
  if (selectedPatternRows.length > 1 && unionMetrics.topPatternHitShare > options.maxTopPatternHitShare) {
    reasons.push("top_pattern_hit_share_above_max")
  }
  if (unionMetrics.totalRows < 1) reasons.push("bundle_zero_matched_rows")
  return reasons
}

export const buildTp12Year2hitPatternBundleBank = async ({
  purgedPatternsPath,
  operationalEventsPath,
  contractPath = "",
  outSummaryPath,
  outBundlesPath = "",
  outSelectedPatternsPath = "",
  outUnionRowsPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(purgedPatternsPath)) throw new Error("purgedPatternsPath is required")
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)
  const candidateRows = await readPurgedRows(purgedPatternsPath)
  for (const row of candidateRows) assertNotYearFillerFragment({ row, options })
  const selectedPatternRows = [...candidateRows].sort(compareCandidateRows).slice(0, options.maxPatterns)
  const selectedPatternIds = selectedPatternRows.map((row) => row.patternId).sort()
  const selectedPatternIdSet = new Set(selectedPatternIds)
  const unionBySymbolDate = new Map()
  let inputRowCount = 0
  let ignoredNonSelectedRowCount = 0
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
      if (!selectedPatternIdSet.has(event.patternId)) {
        ignoredNonSelectedRowCount += 1
        return
      }
      const key = `${event.decisionDateKey}\t${event.symbol}`
      const existing = unionBySymbolDate.get(key)
      if (existing) {
        if (existing.operationalHitTarget !== event.operationalHitTarget) {
          throw new Error(`conflicting operationalHitTarget for bundle union row: ${key}`)
        }
        if (existing.entryExecutable !== event.entryExecutable) {
          throw new Error(`conflicting entryExecutable for bundle union row: ${key}`)
        }
        existing.supportPatternIds = uniqueSorted([...existing.supportPatternIds, event.patternId])
        existing.supportPatternCount = existing.supportPatternIds.length
        return
      }
      unionBySymbolDate.set(key, {
        kind: "tp12_year2hit_pattern_bundle_union_row_v1",
        decisionDateKey: event.decisionDateKey,
        symbol: event.symbol,
        hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
        primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
        operationalHitTarget: event.operationalHitTarget,
        entryExecutable: event.entryExecutable,
        supportPatternIds: [event.patternId],
        supportPatternCount: 1,
      })
    },
  })
  const unionRows = [...unionBySymbolDate.values()].sort(
    (left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol),
  )
  const metrics = emptyUnionMetrics(options.coreYears)
  for (const row of unionRows) addUnionRow({ metrics, row })
  const unionMetrics = finalizeUnionMetrics(metrics, options.coreYears)
  const rejectReasons = buildBundleRejectReasons({ selectedPatternRows, unionMetrics, options })
  const bundleId = `bundle_${sha256TextLines(selectedPatternIds).slice(0, 16)}`
  const bundle = {
    kind: "tp12_year2hit_pattern_bundle_bank_row_v1",
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
  if (options.failOnZeroBundles && bundles.length < 1) failures.push(`zero_pattern_bundles:${rejectReasons.join(",")}`)
  const summary = {
    kind: "tp12_year2hit_pattern_bundle_bank_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    purgedPatternsPath: path.resolve(purgedPatternsPath),
    operationalEventsPath: path.resolve(operationalEventsPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
      lockedFutureFrom: options.lockedFutureFrom,
    },
    coreYears: options.coreYears,
    candidatePatternCount: candidateRows.length,
    selectedPatternCount: selectedPatternRows.length,
    bundleCount: bundles.length,
    inputRowCount,
    ignoredNonSelectedRowCount,
    outsideDateRowCount,
    unionRowCount: unionRows.length,
    selectedPatternIds,
    selectedPatternIdsSha256: sha256TextLines(selectedPatternIds),
    options,
    bundle,
    failures,
  }
  await writeJson(outSummaryPath, summary)
  if (toText(outBundlesPath)) await writeJsonlRows(outBundlesPath, bundles)
  if (toText(outSelectedPatternsPath)) await writeJsonlRows(outSelectedPatternsPath, selectedPatternRows)
  if (toText(outUnionRowsPath)) await writeJsonlRows(outUnionRowsPath, unionRows)
  if (failures.length > 0) throw new Error(`tp12 pattern bundle selector failed: ${failures.join("; ")}`)
  return summary
}
