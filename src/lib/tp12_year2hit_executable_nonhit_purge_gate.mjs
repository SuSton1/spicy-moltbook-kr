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
  if (!contract) throw new Error(`non-hit purge contract not found: ${resolvedPath}`)
  return contract
}

const normalizeYears = (value) => {
  const years = uniqueSorted(Array.isArray(value) ? value.map(String) : [])
  return years.length > 0 ? years : ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]
}

export const deriveTp12ExecutableNonhitPurgeOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const bank = contract.patternBank ?? {}
  const purge = contract.nonhitPurgeGate ?? {}
  const hitContract = contract.hitContract ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    coreYears: bank.coreYears,
    minOperationalHitDatesPerYear: bank.minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear: bank.minOperationalHitSymbolDatesPerYear,
    maxOperationalMissRows: purge.maxOperationalMissRows,
    maxNonExecutableRows: purge.maxNonExecutableRows,
    requireYear2HitPreserved: purge.requireYear2HitPreserved,
    failOnZeroSurvivors: purge.failOnZeroSurvivors,
    hitDefinition: hitContract.hitDefinition,
    hitField: hitContract.hitField,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveTp12ExecutableNonhitPurgeOptionsFromContract(contract) : {}
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
    maxOperationalMissRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxOperationalMissRows ?? contractOptions.maxOperationalMissRows, 0)),
    ),
    maxNonExecutableRows: Math.max(0, Math.trunc(toNumber(raw.maxNonExecutableRows ?? contractOptions.maxNonExecutableRows, 0))),
    requireYear2HitPreserved: toBool(raw.requireYear2HitPreserved ?? contractOptions.requireYear2HitPreserved, true),
    failOnZeroSurvivors: toBool(raw.failOnZeroSurvivors ?? contractOptions.failOnZeroSurvivors, true),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`non-hit purge gate requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`non-hit purge gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid non-hit purge date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
}

const readBankRows = async (bankPath) => {
  const rows = []
  await iterateJsonlMaybeGzip(bankPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`bank row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (toText(row?.status) !== "passed") {
        throw new Error(`bank input must contain passed rows only at ${context.filePath}:${context.lineNumber}`)
      }
      rows.push({ ...row, patternId })
    },
  })
  if (rows.length < 1) throw new Error(`bank input has zero rows: ${bankPath}`)
  const ids = uniqueSorted(rows.map((row) => row.patternId))
  if (ids.length !== rows.length) throw new Error("bank input contains duplicate patternId rows")
  return { rows, ids, idSet: new Set(ids) }
}

const emptyState = (patternId, coreYears) => ({
  patternId,
  eventRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  nonExecutableRows: 0,
  hitDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  hitSymbolDatesByYear: new Map(coreYears.map((year) => [year, new Set()])),
  missReasonCounts: new Map(),
})

const addEvent = ({ state, event }) => {
  state.eventRows += 1
  if (!event.entryExecutable) state.nonExecutableRows += 1
  if (event.operationalHitTarget) {
    state.operationalHitRows += 1
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

const finalizeState = ({ state, bankRow, options }) => {
  const operationalHitDatesByYear = Object.fromEntries(
    options.coreYears.map((year) => [year, state.hitDatesByYear.get(year)?.size ?? 0]),
  )
  const operationalHitSymbolDatesByYear = Object.fromEntries(
    options.coreYears.map((year) => [year, state.hitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const minOperationalHitDatesPerYear = Math.min(
    ...options.coreYears.map((year) => operationalHitDatesByYear[year] ?? 0),
  )
  const minOperationalHitSymbolDatesPerYear = Math.min(
    ...options.coreYears.map((year) => operationalHitSymbolDatesByYear[year] ?? 0),
  )
  const rejectReasons = []
  if (state.operationalMissRows > options.maxOperationalMissRows) rejectReasons.push("operational_miss_rows_above_max")
  if (state.nonExecutableRows > options.maxNonExecutableRows) rejectReasons.push("non_executable_rows_above_max")
  if (options.requireYear2HitPreserved && minOperationalHitDatesPerYear < options.minOperationalHitDatesPerYear) {
    rejectReasons.push("year2_operational_hit_dates_not_preserved")
  }
  if (options.requireYear2HitPreserved && minOperationalHitSymbolDatesPerYear < options.minOperationalHitSymbolDatesPerYear) {
    rejectReasons.push("year2_operational_hit_symbol_dates_not_preserved")
  }
  return {
    kind: "tp12_year2hit_executable_nonhit_purge_row_v1",
    patternId: state.patternId,
    status: rejectReasons.length > 0 ? "rejected" : "passed",
    sourceBank: bankRow,
    eventRows: state.eventRows,
    operationalHitRows: state.operationalHitRows,
    operationalMissRows: state.operationalMissRows,
    operationalPrecision: safeRatio(state.operationalHitRows, state.eventRows),
    nonExecutableRows: state.nonExecutableRows,
    minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear,
    operationalHitDatesByYear,
    operationalHitSymbolDatesByYear,
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
    throw new Error(`locked future row cannot enter non-hit purge: ${decisionDateKey}::${symbol}`)
  }
  if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return null
  assertTp12OperationalHitRow(row, { context, hitField: options.hitField })
  return {
    patternId,
    symbol,
    decisionDateKey,
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget: row[options.hitField] === true,
    operationalMissReasons: Array.isArray(row.operationalMissReasons) ? row.operationalMissReasons : [],
  }
}

export const buildTp12Year2hitExecutableNonhitPurgeGate = async ({
  bankPath,
  operationalEventsPath,
  contractPath = "",
  outSummaryPath,
  outSurvivorsPath = "",
  outRejectedPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(bankPath)) throw new Error("bankPath is required")
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)
  const { rows: bankRows, ids: bankPatternIds, idSet: bankPatternIdSet } = await readBankRows(bankPath)
  const bankByPattern = new Map(bankRows.map((row) => [row.patternId, row]))
  const byPattern = new Map(bankPatternIds.map((patternId) => [patternId, emptyState(patternId, options.coreYears)]))
  let inputRowCount = 0
  let ignoredNonBankRowCount = 0
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
      if (!bankPatternIdSet.has(event.patternId)) {
        ignoredNonBankRowCount += 1
        return
      }
      addEvent({ state: byPattern.get(event.patternId), event })
    },
  })
  const rows = bankPatternIds
    .map((patternId) => finalizeState({ state: byPattern.get(patternId), bankRow: bankByPattern.get(patternId), options }))
    .sort(
      (left, right) =>
        left.operationalMissRows - right.operationalMissRows ||
        right.operationalHitRows - left.operationalHitRows ||
        left.patternId.localeCompare(right.patternId),
    )
  const survivors = rows.filter((row) => row.status === "passed")
  const rejected = rows.filter((row) => row.status !== "passed")
  const survivorPatternIds = survivors.map((row) => row.patternId).sort()
  const rejectedPatternIds = rejected.map((row) => row.patternId).sort()
  const rejectReasonCounts = new Map()
  for (const row of rejected) {
    for (const reason of row.rejectReasons) incrementMap(rejectReasonCounts, reason)
  }
  const failures = []
  if (options.failOnZeroSurvivors && survivors.length < 1) failures.push("zero_nonhit_purged_patterns")
  const summary = {
    kind: "tp12_year2hit_executable_nonhit_purge_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    bankPath: path.resolve(bankPath),
    operationalEventsPath: path.resolve(operationalEventsPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
      lockedFutureFrom: options.lockedFutureFrom,
    },
    coreYears: options.coreYears,
    inputRowCount,
    ignoredNonBankRowCount,
    outsideDateRowCount,
    bankPatternCount: bankPatternIds.length,
    survivorCount: survivors.length,
    rejectedPatternCount: rejected.length,
    survivorPatternIds,
    rejectedPatternIds,
    survivorPatternIdsSha256: sha256TextLines(survivorPatternIds),
    rejectedPatternIdsSha256: sha256TextLines(rejectedPatternIds),
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    options,
    failures,
    topSurvivors: survivors.slice(0, 50),
  }
  await writeJson(outSummaryPath, summary)
  if (toText(outSurvivorsPath)) await writeJsonlRows(outSurvivorsPath, survivors)
  if (toText(outRejectedPath)) await writeJsonlRows(outRejectedPath, rejected)
  if (failures.length > 0) throw new Error(`tp12 executable non-hit purge failed: ${failures.join("; ")}`)
  return summary
}
