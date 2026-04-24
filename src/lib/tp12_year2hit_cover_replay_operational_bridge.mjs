import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRows,
} from "./tp12_year2hit_foundation_io.mjs"
import { sha256TextLines } from "./tp12_year2hit_train_gate.mjs"
import {
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
  assertTp12OperationalHitRow,
} from "./tp12_operational_hit_contract.mjs"

export const TP12_YEAR2HIT_COVER_REPLAY_OPERATIONAL_BRIDGE_KIND =
  "tp12_year2hit_cover_replay_operational_bridge_summary_v1"
export const TP12_YEAR2HIT_COVER_REPLAY_OPERATIONAL_BRIDGE_PATCH_KEY =
  "tp12_year2hit_train100_monthly_coverage_eval_v1"

const DEFAULT_CORE_YEARS = ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]

const hasOwn = (row, field) => Object.prototype.hasOwnProperty.call(row ?? {}, field)
const rowKeyOf = (row) => `${toText(row?.decisionDateKey)}\t${toText(row?.symbol).toUpperCase()}`
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const normalizeYears = (value) => {
  const years = uniqueSorted(Array.isArray(value) ? value.map(String) : [])
  return years.length > 0 ? years : DEFAULT_CORE_YEARS
}

const readRequiredNumber = (value, label) => {
  const number = toNumber(value)
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite: ${value}`)
  return number
}

const readRequiredInteger = (value, label) => {
  const number = readRequiredNumber(value, label)
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer: ${value}`)
  if (number < 0) throw new Error(`${label} must be non-negative: ${value}`)
  return number
}

const readFirstMetric = (metrics, fields, label) => {
  for (const field of fields) {
    if (!hasOwn(metrics, field)) continue
    return readRequiredInteger(metrics[field], `metrics.${field}`)
  }
  throw new Error(`cover replay metrics missing ${label}; expected one of: ${fields.join(",")}`)
}

const readOptionalIntegerMetric = (metrics, fields, label) => {
  for (const field of fields) {
    if (!hasOwn(metrics, field)) continue
    return readRequiredInteger(metrics[field], `metrics.${field}`)
  }
  throw new Error(`cover replay metrics missing ${label}; expected one of: ${fields.join(",")}`)
}

const readYearCountObject = (metrics, fields, label) => {
  for (const field of fields) {
    const value = metrics?.[field]
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    return Object.fromEntries(
      Object.entries(value)
        .map(([year, count]) => [toText(year), readRequiredInteger(count, `metrics.${field}.${year}`)])
        .sort(([left], [right]) => left.localeCompare(right)),
    )
  }
  throw new Error(`cover replay metrics missing ${label}; expected one of: ${fields.join(",")}`)
}

const countMinForYears = (countsByYear, coreYears) =>
  Math.min(...coreYears.map((year) => readRequiredInteger(countsByYear[year] ?? 0, `year count ${year}`)))

const buildPatternRejectReasons = ({
  totalRows,
  operationalHitRows,
  operationalMissRows,
  nonExecutableRows,
  operationalPrecision,
  minOperationalHitDatesPerYear,
  minOperationalHitSymbolDatesPerYear,
  matchedRowKeyCount,
  minOperationalHitDatesPerYearRequired,
  minOperationalHitSymbolDatesPerYearRequired,
}) => {
  const reasons = []
  if (totalRows < 1) reasons.push("cover_zero_rows")
  if (matchedRowKeyCount !== totalRows) reasons.push("matched_row_key_count_mismatch")
  if (operationalHitRows !== totalRows) reasons.push("cover_contains_non_hit_rows")
  if (operationalMissRows !== 0) reasons.push("cover_operational_miss_rows_nonzero")
  if (nonExecutableRows !== 0) reasons.push("cover_non_executable_rows_nonzero")
  if (operationalPrecision !== 1) reasons.push("cover_precision_below_100pct")
  if (minOperationalHitDatesPerYear < minOperationalHitDatesPerYearRequired) reasons.push("cover_hit_dates_below_year2_min")
  if (minOperationalHitSymbolDatesPerYear < minOperationalHitSymbolDatesPerYearRequired) {
    reasons.push("cover_hit_symbol_dates_below_year2_min")
  }
  return reasons
}

const normalizeMissReasons = (row) => {
  const explicit = row?.operationalMissReasons ?? row?.execution?.operationalMissReasons ?? row?.execution?.nonExecutableReasons
  if (Array.isArray(explicit) && explicit.length > 0) return explicit.map(toText).filter(Boolean)
  const reasons = []
  if (row?.chartHitTarget !== true) reasons.push("not_chart_hit")
  if (row?.entryExecutable !== true) {
    const executionReasons = Array.isArray(row?.execution?.nonExecutableReasons)
      ? row.execution.nonExecutableReasons.map(toText).filter(Boolean)
      : []
    reasons.push(...executionReasons)
  }
  if (reasons.length < 1) {
    throw new Error(`operational miss row lacks explicit miss reason: ${rowKeyOf(row)}`)
  }
  return uniqueSorted(reasons)
}

const normalizeMatchedRow = ({ row, context, lockedFutureFrom }) => {
  const decisionDateKey = toText(row?.decisionDateKey)
  const symbol = toText(row?.symbol).toUpperCase()
  if (!validDateKey(decisionDateKey)) throw new Error(`matched row invalid decisionDateKey at ${context}: ${decisionDateKey}`)
  if (decisionDateKey >= lockedFutureFrom) throw new Error(`matched row enters locked future at ${context}: ${decisionDateKey}`)
  if (!symbol) throw new Error(`matched row missing symbol at ${context}`)
  if (typeof row?.chartHitTarget !== "boolean") throw new Error(`matched row chartHitTarget must be boolean at ${context}`)
  if (typeof row?.entryExecutable !== "boolean") throw new Error(`matched row entryExecutable must be boolean at ${context}`)
  if (typeof row?.executableHitTarget !== "boolean") {
    throw new Error(`matched row executableHitTarget must be boolean at ${context}`)
  }
  const operationalHitTarget = row.chartHitTarget === true && row.entryExecutable === true
  if (row.executableHitTarget !== operationalHitTarget) {
    throw new Error(`matched row executableHitTarget invariant mismatch at ${context}: ${rowKeyOf(row)}`)
  }
  const executionPolicyId = toText(row?.executionPolicyId ?? row?.execution?.policyId)
  if (executionPolicyId !== TP12_EXECUTION_POLICY_ID) {
    throw new Error(`matched row executionPolicyId must be ${TP12_EXECUTION_POLICY_ID} at ${context}: ${executionPolicyId}`)
  }
  const entryDateKey = toText(row?.entryDateKey ?? row?.execution?.entryDateKey)
  if (!validDateKey(entryDateKey)) throw new Error(`matched row invalid entryDateKey at ${context}: ${entryDateKey}`)
  return {
    sourceRowKey: `${decisionDateKey}\t${symbol}`,
    decisionDateKey,
    symbol,
    executionPolicyId,
    entryDateKey,
    chartHitTarget: row.chartHitTarget === true,
    entryExecutable: row.entryExecutable === true,
    operationalHitTarget,
    operationalMissReasons: operationalHitTarget ? [] : normalizeMissReasons(row),
  }
}

const loadMatchedRows = async ({ matchedRowsPath, lockedFutureFrom }) => {
  const matchedRowsByKey = new Map()
  await iterateJsonlMaybeGzip(matchedRowsPath, {
    strict: true,
    onRow: async (row, context) => {
      const normalized = normalizeMatchedRow({
        row,
        context: `${context.filePath}:${context.lineNumber}`,
        lockedFutureFrom,
      })
      if (matchedRowsByKey.has(normalized.sourceRowKey)) {
        throw new Error(`duplicate matched row key: ${normalized.sourceRowKey}`)
      }
      matchedRowsByKey.set(normalized.sourceRowKey, normalized)
    },
  })
  if (matchedRowsByKey.size < 1) throw new Error(`matched rows input has zero rows: ${matchedRowsPath}`)
  return matchedRowsByKey
}

const normalizeCoverReplayRow = ({
  row,
  context,
  matchedRowsByKey,
  coreYears,
  minOperationalHitDatesPerYearRequired,
  minOperationalHitSymbolDatesPerYearRequired,
}) => {
  const coverId = toText(row?.coverId ?? row?.patternId)
  if (!coverId) throw new Error(`cover replay row missing coverId at ${context}`)
  const metrics = row?.metrics
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new Error(`cover replay row missing metrics at ${context}`)
  }
  const matchedRowKeys = Array.isArray(row?.matchedRowKeys) ? row.matchedRowKeys.map(toText).filter(Boolean) : []
  const totalRows = readFirstMetric(metrics, ["totalRows", "matchRows", "eventRows"], "total rows")
  const operationalHitRows = readFirstMetric(metrics, ["operationalHitRows", "executableHitRows", "hitRows"], "hit rows")
  const nonExecutableRows = readOptionalIntegerMetric(metrics, ["nonExecutableRows"], "non executable rows")
  const operationalMissRows = totalRows - operationalHitRows
  if (operationalMissRows < 0) throw new Error(`cover replay has hit rows greater than total rows at ${context}: ${coverId}`)
  const explicitMissRows = readFirstMetric(
    metrics,
    ["operationalMissRows", "executableMissRows", "operationalFalsePositiveRows", "falsePositiveRows"],
    "operational miss rows",
  )
  if (explicitMissRows !== operationalMissRows) {
    throw new Error(
      `cover replay miss row invariant mismatch at ${context}: explicit=${explicitMissRows}, total-hit=${operationalMissRows}`,
    )
  }
  const operationalHitDatesByYear = readYearCountObject(
    metrics,
    ["operationalHitDatesByYear", "executableHitDatesByYear", "hitDatesByYear"],
    "hit dates by year",
  )
  const operationalHitSymbolDatesByYear = readYearCountObject(
    metrics,
    ["operationalHitSymbolDatesByYear", "executableHitSymbolDatesByYear", "hitSymbolDatesByYear"],
    "hit symbol dates by year",
  )
  const minOperationalHitDatesPerYear = countMinForYears(operationalHitDatesByYear, coreYears)
  const minOperationalHitSymbolDatesPerYear = countMinForYears(operationalHitSymbolDatesByYear, coreYears)
  const operationalPrecision = safeRatio(operationalHitRows, totalRows)
  const rejectReasons = buildPatternRejectReasons({
    totalRows,
    operationalHitRows,
    operationalMissRows,
    nonExecutableRows,
    operationalPrecision,
    minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear,
    matchedRowKeyCount: matchedRowKeys.length,
    minOperationalHitDatesPerYearRequired,
    minOperationalHitSymbolDatesPerYearRequired,
  })
  const patternRow = {
    kind: "tp12_year2hit_cover_replay_operational_pattern_row_v1",
    patternId: coverId,
    coverId,
    sourceKind: toText(row?.kind),
    status: rejectReasons.length > 0 ? "rejected" : "passed",
    eventRows: totalRows,
    operationalHitRows,
    operationalMissRows,
    operationalPrecision,
    nonExecutableRows,
    minOperationalHitDatesPerYear,
    minOperationalHitSymbolDatesPerYear,
    operationalHitDatesByYear,
    operationalHitSymbolDatesByYear,
    bridgeRejectReasons: rejectReasons,
  }
  const eventRows = []
  const seenKeys = new Set()
  for (const sourceRowKey of matchedRowKeys) {
    if (seenKeys.has(sourceRowKey)) throw new Error(`duplicate matchedRowKey inside cover replay ${coverId}: ${sourceRowKey}`)
    seenKeys.add(sourceRowKey)
    const matched = matchedRowsByKey.get(sourceRowKey)
    if (!matched) throw new Error(`cover replay ${coverId} references missing matched row: ${sourceRowKey}`)
    const event = {
      kind: "tp12_year2hit_cover_replay_operational_event_v1",
      patternId: coverId,
      coverId,
      sourceRowKey,
      decisionDateKey: matched.decisionDateKey,
      symbol: matched.symbol,
      hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
      primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
      executionPolicyId: matched.executionPolicyId,
      entryDateKey: matched.entryDateKey,
      chartHitTarget: matched.chartHitTarget,
      entryExecutable: matched.entryExecutable,
      operationalHitTarget: matched.operationalHitTarget,
      operationalMissReasons: matched.operationalMissReasons,
    }
    assertTp12OperationalHitRow(event, { context: `${context}:${coverId}:${sourceRowKey}` })
    eventRows.push(event)
  }
  return { patternRow, eventRows }
}

const resolveOptions = (raw = {}) => ({
  lockedFutureFrom: toText(raw.lockedFutureFrom ?? "2025-01-02"),
  coreYears: normalizeYears(raw.coreYears),
  minOperationalHitDatesPerYearRequired: Math.max(1, Math.trunc(toNumber(raw.minOperationalHitDatesPerYearRequired, 2))),
  minOperationalHitSymbolDatesPerYearRequired: Math.max(
    1,
    Math.trunc(toNumber(raw.minOperationalHitSymbolDatesPerYearRequired, 2)),
  ),
})

const assertOptions = (options) => {
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
}

export const buildTp12Year2hitCoverReplayOperationalBridge = async ({
  coverReplayPath,
  matchedRowsPath,
  outSummaryPath,
  outPatternsPath,
  outEventsPath,
  ...rawOptions
} = {}) => {
  if (!toText(coverReplayPath)) throw new Error("coverReplayPath is required")
  if (!toText(matchedRowsPath)) throw new Error("matchedRowsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outPatternsPath)) throw new Error("outPatternsPath is required")
  if (!toText(outEventsPath)) throw new Error("outEventsPath is required")
  const options = resolveOptions(rawOptions)
  assertOptions(options)
  const matchedRowsByKey = await loadMatchedRows({ matchedRowsPath, lockedFutureFrom: options.lockedFutureFrom })
  const patternRows = []
  const eventRows = []
  const rejectReasonCounts = new Map()
  const eventRowKeys = new Set()
  await iterateJsonlMaybeGzip(coverReplayPath, {
    strict: true,
    onRow: async (row, context) => {
      const normalized = normalizeCoverReplayRow({
        row,
        context: `${context.filePath}:${context.lineNumber}`,
        matchedRowsByKey,
        coreYears: options.coreYears,
        minOperationalHitDatesPerYearRequired: options.minOperationalHitDatesPerYearRequired,
        minOperationalHitSymbolDatesPerYearRequired: options.minOperationalHitSymbolDatesPerYearRequired,
      })
      patternRows.push(normalized.patternRow)
      for (const reason of normalized.patternRow.bridgeRejectReasons) incrementMap(rejectReasonCounts, reason)
      for (const event of normalized.eventRows) {
        const eventKey = `${event.patternId}\t${event.decisionDateKey}\t${event.symbol}`
        if (eventRowKeys.has(eventKey)) throw new Error(`duplicate bridge event key: ${eventKey}`)
        eventRowKeys.add(eventKey)
        eventRows.push(event)
      }
    },
  })
  if (patternRows.length < 1) throw new Error(`cover replay input has zero rows: ${coverReplayPath}`)
  const passedPatternRows = patternRows.filter((row) => row.status === "passed")
  const operationalHitRows = eventRows.filter((row) => row.operationalHitTarget === true).length
  const nonExecutableRows = eventRows.filter((row) => row.entryExecutable !== true).length
  const summary = {
    kind: TP12_YEAR2HIT_COVER_REPLAY_OPERATIONAL_BRIDGE_KIND,
    patchKey: TP12_YEAR2HIT_COVER_REPLAY_OPERATIONAL_BRIDGE_PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status: passedPatternRows.length > 0 ? "passed" : "failed",
    sourcePaths: {
      coverReplayPath: path.resolve(coverReplayPath),
      matchedRowsPath: path.resolve(matchedRowsPath),
    },
    outputPaths: {
      outSummaryPath: path.resolve(outSummaryPath),
      outPatternsPath: path.resolve(outPatternsPath),
      outEventsPath: path.resolve(outEventsPath),
    },
    options,
    matchedRowCount: matchedRowsByKey.size,
    coverReplayRowCount: patternRows.length,
    passedPatternCount: passedPatternRows.length,
    rejectedPatternCount: patternRows.length - passedPatternRows.length,
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    eventRowCount: eventRows.length,
    eventOperationalHitRows: operationalHitRows,
    eventOperationalMissRows: eventRows.length - operationalHitRows,
    eventNonExecutableRows: nonExecutableRows,
    passedPatternIdsSha256: sha256TextLines(passedPatternRows.map((row) => row.patternId).sort()),
    eventRowKeysSha256: sha256TextLines([...eventRowKeys].sort()),
  }
  await ensureDir(path.dirname(outPatternsPath))
  await ensureDir(path.dirname(outEventsPath))
  await writeJsonlRows(outPatternsPath, patternRows)
  await writeJsonlRows(outEventsPath, eventRows)
  await writeJson(outSummaryPath, summary)
  return summary
}
