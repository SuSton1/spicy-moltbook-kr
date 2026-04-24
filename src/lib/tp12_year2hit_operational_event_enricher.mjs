import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertTp12OperationalHitRow,
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"
import { sha256TextLines } from "./tp12_year2hit_train_gate.mjs"

const DEFAULT_FORBIDDEN_TOP_LEVEL_FIELDS = [
  "entryOpen",
  "entryHigh",
  "entryLow",
  "entryClose",
  "entryVolume",
  "entryGapPct",
  "hitDateKey",
  "futureHigh",
  "futureLow",
  "maxForwardReturn",
  "minForwardReturn",
  "chartMaxForwardReturn",
]

const resolveSymbol = (row) => toText(row?.symbol).toUpperCase()
const resolveDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey)

const normalizeArray = (value) => uniqueSorted(Array.isArray(value) ? value : [])

const loadContract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`operational event contract not found: ${resolvedPath}`)
  return contract
}

export const deriveTp12OperationalEventEnricherOptionsFromContract = (contract = {}) => {
  const dateRanges = contract.dateRanges ?? {}
  const builder = contract.operationalEventBuilder ?? {}
  const hitContract = contract.hitContract ?? {}
  return {
    dateFrom: dateRanges.internalValidation?.from,
    dateTo: dateRanges.internalValidation?.to,
    lockedFutureFrom: dateRanges.lockedFuture?.from,
    hitDefinition: hitContract.hitDefinition ?? contract.hitDefinition,
    hitField: hitContract.hitField ?? contract.hitField,
    chartHitField: hitContract.chartHitField,
    entryExecutableField: hitContract.entryExecutableField,
    executionPolicyId: hitContract.executionPolicyId,
    explodeSupportPatternIds: builder.explodeSupportPatternIds,
    keepNonExecutableRows: builder.keepNonExecutableRows,
    failOnZeroEvents: builder.failOnZeroEvents,
    forbiddenTopLevelFields: builder.forbiddenTopLevelFields,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveTp12OperationalEventEnricherOptionsFromContract(contract) : {}
  const forbiddenTopLevelFields = Array.isArray(raw.forbiddenTopLevelFields)
    ? raw.forbiddenTopLevelFields
    : Array.isArray(contractOptions.forbiddenTopLevelFields)
      ? contractOptions.forbiddenTopLevelFields
      : DEFAULT_FORBIDDEN_TOP_LEVEL_FIELDS
  return {
    dateFrom: toText(raw.dateFrom ?? contractOptions.dateFrom),
    dateTo: toText(raw.dateTo ?? contractOptions.dateTo),
    lockedFutureFrom: toText(raw.lockedFutureFrom ?? contractOptions.lockedFutureFrom ?? "2025-01-02"),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
    chartHitField: toText(raw.chartHitField ?? contractOptions.chartHitField ?? "chartHitTarget"),
    entryExecutableField: toText(raw.entryExecutableField ?? contractOptions.entryExecutableField ?? "entryExecutable"),
    executionPolicyId: toText(raw.executionPolicyId ?? contractOptions.executionPolicyId ?? TP12_EXECUTION_POLICY_ID),
    explodeSupportPatternIds: toBool(raw.explodeSupportPatternIds ?? contractOptions.explodeSupportPatternIds, true),
    keepNonExecutableRows: toBool(raw.keepNonExecutableRows ?? contractOptions.keepNonExecutableRows, true),
    failOnZeroEvents: toBool(raw.failOnZeroEvents ?? contractOptions.failOnZeroEvents, true),
    forbiddenTopLevelFields: uniqueSorted(forbiddenTopLevelFields),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`operational event builder requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`operational event builder requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.dateFrom) || !validDateKey(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error(`invalid internal validation date range: ${options.dateFrom}..${options.dateTo}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  if (!options.keepNonExecutableRows) throw new Error("keepNonExecutableRows=false would hide operational misses")
}

const assertNoForbiddenTopLevelFields = ({ row, forbiddenFields, context }) => {
  for (const field of forbiddenFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      throw new Error(`forbidden operational feature field at ${context}: ${field}`)
    }
  }
}

const resolvePatternIds = ({ row, explodeSupportPatternIds }) => {
  const explicit = toText(row?.patternId ?? row?.ruleId ?? row?.id)
  const support = explodeSupportPatternIds ? normalizeArray(row?.supportPatternIds) : []
  const patternIds = uniqueSorted([explicit, ...support])
  if (patternIds.length < 1) throw new Error("operational row missing patternId/supportPatternIds")
  return patternIds
}

const normalizeMissReasons = (row) => {
  const reasons = Array.isArray(row?.operationalMissReasons)
    ? row.operationalMissReasons
    : Array.isArray(row?.execution?.operationalMissReasons)
      ? row.execution.operationalMissReasons
      : Array.isArray(row?.execution?.nonExecutableReasons)
        ? row.execution.nonExecutableReasons
        : []
  return uniqueSorted(reasons)
}

const buildOperationalEventsForRow = ({ row, patternIds, symbol, decisionDateKey, options }) => {
  const entryDateKey = toText(row?.entryDateKey ?? row?.execution?.entryDateKey)
  const chartHitTarget = row[options.chartHitField] === true
  const entryExecutable = row[options.entryExecutableField] === true
  const operationalHitTarget = row[options.hitField] === true
  const operationalMissReasons = operationalHitTarget ? [] : normalizeMissReasons(row)
  return patternIds.map((patternId) => ({
    kind: "tp12_year2hit_operational_event_v1",
    patternId,
    symbol,
    decisionDateKey,
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
    executionPolicyId: options.executionPolicyId,
    entryDateKey,
    chartHitTarget,
    entryExecutable,
    operationalHitTarget,
    operationalMissReasons,
    operationalMissReason: operationalMissReasons[0] ?? null,
    labelClass: toText(row?.labelClass) || null,
    supportPatternIds: patternIds,
    supportClusterIds: normalizeArray(row?.supportClusterIds),
    supportTokenSet: normalizeArray(row?.supportTokenSet),
    tokenFamilies: normalizeArray(row?.tokenFamilies),
  }))
}

const emptyYearStats = () => ({
  eventRows: 0,
  operationalHitRows: 0,
  operationalMissRows: 0,
  entryExecutableRows: 0,
  nonExecutableRows: 0,
})

const addYearStats = (byYear, event) => {
  const year = event.decisionDateKey.slice(0, 4)
  const stats = byYear.get(year) ?? emptyYearStats()
  stats.eventRows += 1
  if (event.operationalHitTarget) stats.operationalHitRows += 1
  else stats.operationalMissRows += 1
  if (event.entryExecutable) stats.entryExecutableRows += 1
  else stats.nonExecutableRows += 1
  byYear.set(year, stats)
}

export const buildTp12Year2hitOperationalEvents = async ({
  inputPath,
  outEventsPath,
  outSummaryPath,
  contractPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(inputPath)) throw new Error("inputPath is required")
  if (!toText(outEventsPath)) throw new Error("outEventsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)

  await ensureDir(path.dirname(outEventsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outEventsPath)
  const duplicateKeys = new Set()
  const byYear = new Map()
  const patternIds = new Set()
  const invalidReasonCounts = new Map()
  let inputRowCount = 0
  let outsideDateRowCount = 0
  let outputEventRowCount = 0
  let sourceRowsWithMultiplePatterns = 0

  try {
    await iterateJsonlMaybeGzip(inputPath, {
      strict: true,
      onRow: async (row, context) => {
        inputRowCount += 1
        const symbol = resolveSymbol(row)
        const decisionDateKey = resolveDateKey(row)
        if (!symbol) throw new Error(`operational source row missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`operational source row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (decisionDateKey >= options.lockedFutureFrom) {
          throw new Error(`locked future row cannot enter pattern bank build: ${decisionDateKey}::${symbol}`)
        }
        if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) {
          outsideDateRowCount += 1
          return
        }
        const contextLabel = `${context.filePath}:${context.lineNumber}`
        assertNoForbiddenTopLevelFields({ row, forbiddenFields: options.forbiddenTopLevelFields, context: contextLabel })
        assertTp12OperationalHitRow(row, {
          context: contextLabel,
          hitField: options.hitField,
          chartHitField: options.chartHitField,
          entryExecutableField: options.entryExecutableField,
        })
        const rowPatternIds = resolvePatternIds({ row, explodeSupportPatternIds: options.explodeSupportPatternIds })
        if (rowPatternIds.length > 1) sourceRowsWithMultiplePatterns += 1
        const events = buildOperationalEventsForRow({ row, patternIds: rowPatternIds, symbol, decisionDateKey, options })
        for (const event of events) {
          const duplicateKey = `${event.patternId}\t${event.decisionDateKey}\t${event.symbol}`
          if (duplicateKeys.has(duplicateKey)) throw new Error(`duplicate operational event key: ${duplicateKey}`)
          duplicateKeys.add(duplicateKey)
          patternIds.add(event.patternId)
          addYearStats(byYear, event)
          if (!event.operationalHitTarget && event.operationalMissReasons.length < 1) {
            incrementMap(invalidReasonCounts, "miss_without_reason")
          }
          await writeJsonlRow(writer.stream, event)
          outputEventRowCount += 1
        }
      },
    })
  } finally {
    await writer.close()
  }

  const failures = []
  if (options.failOnZeroEvents && outputEventRowCount < 1) failures.push("zero_operational_events")
  if (invalidReasonCounts.size > 0) failures.push("invalid_operational_miss_reasons")
  const summary = {
    kind: "tp12_year2hit_operational_events_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    inputPath: path.resolve(inputPath),
    outEventsPath: path.resolve(outEventsPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
      lockedFutureFrom: options.lockedFutureFrom,
    },
    options,
    inputRowCount,
    outsideDateRowCount,
    outputEventRowCount,
    sourceRowsWithMultiplePatterns,
    patternCount: patternIds.size,
    patternIdsSha256: sha256TextLines([...patternIds]),
    invalidReasonCounts: mapToSortedObject(invalidReasonCounts),
    byYear: Object.fromEntries([...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))),
    failures,
  }
  await writeJson(outSummaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 operational event build failed: ${failures.join("; ")}`)
  return summary
}
