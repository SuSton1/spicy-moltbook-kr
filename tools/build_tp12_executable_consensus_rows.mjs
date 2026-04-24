#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, writeJson } from "../src/lib/io.mjs"
import { loadTp12CandlesBySymbol } from "../src/lib/tp12_label_event_builder.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "../src/lib/tp12_year2hit_foundation_io.mjs"
import {
  buildTp12OperationalHitFields,
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import {
  buildConsensusRows,
  buildPatternReliability,
  loadClusterByPattern,
  loadContextBySymbolDate,
  loadLabelBySymbolDate,
  loadPatternTokens,
} from "./replay_tp12_zero_fp_rules_full_train.mjs"

const keyOf = (dateKey, symbol) => `${dateKey}\t${symbol}`
const symbolOf = (row) => toText(row?.symbol).toUpperCase()
const dateOf = (row) => toText(row?.decisionDateKey ?? row?.dateKey)
const safeRatio = (num, den) => (den > 0 ? num / den : 0)

const requirePath = (value, label, cwd) => {
  const resolved = path.resolve(cwd, toText(value))
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const requirePositiveNumber = (value, label) => {
  const numeric = toNumber(value, NaN)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be positive: ${value}`)
  return numeric
}

const buildCandleMap = async (candlePath) => {
  const bySymbol = await loadTp12CandlesBySymbol({ candlePath })
  const byKey = new Map()
  for (const [symbol, rows] of bySymbol.entries()) {
    for (const row of rows) byKey.set(keyOf(row.dateKey, symbol), row)
  }
  if (byKey.size < 1) throw new Error(`candle source produced zero rows: ${candlePath}`)
  return byKey
}

const loadLabelEventsByKey = async (labelEventsPath) => {
  const byKey = new Map()
  let rowCount = 0
  await iterateJsonlMaybeGzip(labelEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      rowCount += 1
      const symbol = symbolOf(row)
      const decisionDateKey = dateOf(row)
      if (!symbol) throw new Error(`label event missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`label event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      const key = keyOf(decisionDateKey, symbol)
      if (byKey.has(key)) throw new Error(`duplicate label event for ${decisionDateKey}::${symbol}`)
      byKey.set(key, row)
    },
  })
  if (rowCount < 1) throw new Error(`label event source produced zero rows: ${labelEventsPath}`)
  return byKey
}

const assertPriceMatches = ({ expected, actual, label }) => {
  if (!Number.isFinite(expected)) return
  const tolerance = Math.max(0.000001, Math.abs(actual) * 1e-8)
  if (Math.abs(expected - actual) > tolerance) {
    throw new Error(`${label} mismatch: expected=${expected} actual=${actual}`)
  }
}

const emptyYearStats = () => ({
  total: 0,
  chartHit: 0,
  chartMiss: 0,
  entryExecutable: 0,
  nonExecutable: 0,
  executableHit: 0,
  executableMiss: 0,
  nonExecutableChartHit: 0,
  nonExecutableChartMiss: 0,
})

const addYearStats = (stats, row) => {
  stats.total += 1
  if (row.chartHitTarget) stats.chartHit += 1
  else stats.chartMiss += 1
  if (row.entryExecutable) stats.entryExecutable += 1
  else stats.nonExecutable += 1
  if (row.executableHitTarget) stats.executableHit += 1
  else if (row.entryExecutable) stats.executableMiss += 1
  else if (row.chartHitTarget) stats.nonExecutableChartHit += 1
  else stats.nonExecutableChartMiss += 1
}

const writeRows = async (filePath, rows) => {
  if (!toText(filePath)) return
  await ensureDir(path.dirname(filePath))
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await closeWriteStream(stream)
  }
}

const enrichOperationalRow = ({ row, labelEvent, candleByKey, upperGapPct }) => {
  const symbol = symbolOf(row)
  const decisionDateKey = dateOf(row)
  const entryDateKey = toText(labelEvent?.entryDateKey)
  if (toText(labelEvent?.labelStatus) && toText(labelEvent.labelStatus) !== "valid") {
    throw new Error(`cannot operationalize invalid label event: ${decisionDateKey}::${symbol} ${labelEvent.labelStatus}`)
  }
  if (!validDateKey(entryDateKey)) throw new Error(`label event missing entryDateKey for ${decisionDateKey}::${symbol}`)
  const decisionCandle = candleByKey.get(keyOf(decisionDateKey, symbol))
  const entryCandle = candleByKey.get(keyOf(entryDateKey, symbol))
  if (!decisionCandle) throw new Error(`missing decision candle for ${decisionDateKey}::${symbol}`)
  if (!entryCandle) throw new Error(`missing entry candle for ${entryDateKey}::${symbol}`)

  const entryPrice = requirePositiveNumber(labelEvent?.entryPrice ?? labelEvent?.entryOpen ?? entryCandle.open, `entryPrice at ${decisionDateKey}::${symbol}`)
  assertPriceMatches({
    expected: entryPrice,
    actual: entryCandle.open,
    label: `entry open at ${decisionDateKey}::${symbol}`,
  })
  const decisionClose = requirePositiveNumber(decisionCandle.close, `decisionClose at ${decisionDateKey}::${symbol}`)
  const chartHitTarget = labelEvent.hitTarget === true
  if ((row.hitTarget === true) !== chartHitTarget) {
    throw new Error(`consensus/label hitTarget mismatch for ${decisionDateKey}::${symbol}`)
  }
  const operational = buildTp12OperationalHitFields({
    chartHitTarget,
    decisionClose,
    entryOpen: entryCandle.open,
    entryVolume: entryCandle.volume,
    entryDateKey,
    upperGapPctExclusive: upperGapPct,
  })
  const originalLabelClass = toText(row.labelClass || (chartHitTarget ? "positive" : "unknown"))
  const labelClass = operational.operationalHitTarget
    ? "positive"
    : operational.entryExecutable
      ? originalLabelClass === "positive"
        ? "execution_miss"
        : originalLabelClass
      : chartHitTarget
        ? "non_executable_chart_hit"
        : "non_executable_chart_miss"

  return {
    ...row,
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
    executionPolicyId: TP12_EXECUTION_POLICY_ID,
    chartHitTarget,
    executableHitTarget: operational.operationalHitTarget,
    operationalHitTarget: operational.operationalHitTarget,
    entryExecutable: operational.entryExecutable,
    operationalMissReasons: operational.operationalMissReasons,
    operationalMissReason: operational.operationalMissReason,
    labelClass,
    originalLabelClass,
    execution: {
      policyId: TP12_EXECUTION_POLICY_ID,
      entryDateKey,
      decisionClose,
      entryOpen: entryCandle.open,
      entryHigh: entryCandle.high,
      entryLow: entryCandle.low,
      entryClose: entryCandle.close,
      entryVolume: entryCandle.volume,
      entryGapPct: operational.entryGapPct,
      targetPrice: toNumber(labelEvent?.targetPrice, null),
      hitDateKey: toText(labelEvent?.hitDateKey) || null,
      chartMaxForwardReturn: toNumber(labelEvent?.maxForwardReturn ?? labelEvent?.maxForwardHighPct, null),
      nonExecutableReasons: operational.operationalMissReasons.filter((reason) => reason !== "not_chart_hit"),
      operationalMissReasons: operational.operationalMissReasons,
    },
  }
}

export const buildTp12ExecutableConsensusRows = async ({
  eventsPath,
  reliabilityEventsPath = "",
  contextPath,
  labelsPath,
  labelEventsPath,
  clustersPath,
  catalogPath,
  candlePath,
  dateFrom,
  dateTo,
  outEnrichedPath = "",
  outExecutablePath = "",
  outNonExecutablePath = "",
  outSummaryPath,
  patchKey = "tp12_executable_consensus_rows_v1",
  priorStrengthRow = 100,
  priorStrengthDate = 50,
  upperGapPct = 0.295,
} = {}) => {
  if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) {
    throw new Error(`invalid date range: ${dateFrom}..${dateTo}`)
  }
  const contextByKey = await loadContextBySymbolDate(contextPath)
  const labelByKey = await loadLabelBySymbolDate(labelsPath)
  const patternTokens = await loadPatternTokens(catalogPath)
  const clusterByPattern = await loadClusterByPattern(clustersPath)
  const reliability = await buildPatternReliability({
    eventsPath: reliabilityEventsPath || eventsPath,
    priorStrengthRow,
    priorStrengthDate,
  })
  const consensus = await buildConsensusRows({
    eventsPath,
    contextByKey,
    labelByKey,
    patternTokens,
    clusterByPattern,
    reliabilityByPattern: reliability.reliabilityByPattern,
  })
  const candleByKey = await buildCandleMap(candlePath)
  const labelEventsByKey = await loadLabelEventsByKey(labelEventsPath)
  const enrichedRows = []
  const executableRows = []
  const nonExecutableRows = []
  const byYear = new Map()
  const removedReasons = new Map()
  const nonExecutableHitSample = []
  const nonExecutableMissSample = []
  let scopedRows = 0
  for (const row of consensus.rows) {
    const decisionDateKey = dateOf(row)
    const symbol = symbolOf(row)
    if (decisionDateKey < dateFrom || decisionDateKey > dateTo) continue
    scopedRows += 1
    const labelEvent = labelEventsByKey.get(keyOf(decisionDateKey, symbol))
    if (!labelEvent) throw new Error(`missing label event for consensus row: ${decisionDateKey}::${symbol}`)
    const enriched = enrichOperationalRow({ row, labelEvent, candleByKey, upperGapPct })
    enrichedRows.push(enriched)
    const year = decisionDateKey.slice(0, 4)
    const stats = byYear.get(year) ?? emptyYearStats()
    addYearStats(stats, enriched)
    byYear.set(year, stats)
    if (enriched.entryExecutable) {
      executableRows.push(enriched)
    } else {
      nonExecutableRows.push(enriched)
      for (const reason of enriched.execution.nonExecutableReasons) incrementMap(removedReasons, reason)
      const sample = {
        decisionDateKey,
        symbol,
        entryDateKey: enriched.execution.entryDateKey,
        entryGapPct: enriched.execution.entryGapPct,
        entryOpen: enriched.execution.entryOpen,
        decisionClose: enriched.execution.decisionClose,
        entryVolume: enriched.execution.entryVolume,
        chartHitTarget: enriched.chartHitTarget,
        executableHitTarget: enriched.executableHitTarget,
        reasons: enriched.execution.nonExecutableReasons,
        labelClass: enriched.labelClass,
      }
      if (enriched.chartHitTarget && nonExecutableHitSample.length < 50) nonExecutableHitSample.push(sample)
      if (!enriched.chartHitTarget && nonExecutableMissSample.length < 50) nonExecutableMissSample.push(sample)
    }
  }
  if (scopedRows < 1) throw new Error(`consensus input produced zero scoped rows for ${dateFrom}..${dateTo}`)

  await writeRows(outEnrichedPath, enrichedRows)
  await writeRows(outExecutablePath, executableRows)
  await writeRows(outNonExecutablePath, nonExecutableRows)

  const executableHitRows = enrichedRows.filter((row) => row.executableHitTarget).length
  const chartHitRows = enrichedRows.filter((row) => row.chartHitTarget).length
  const summary = {
    kind: "tp12_executable_consensus_rows_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey,
    status: "passed",
    dateFrom,
    dateTo,
    entryExecutablePolicy: {
      mode: "operational_rows_keep_non_executable_as_misses",
      hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
      hitField: TP12_OPERATIONAL_HIT_FIELD,
      minEntryVolumeExclusive: 0,
      upperGapPctExclusive: upperGapPct,
      nonExecutableWhen: ["entryVolume <= 0", `entryOpen / decisionClose - 1 >= ${upperGapPct}`],
    },
    inputs: {
      eventsPath: path.resolve(eventsPath),
      reliabilityEventsPath: path.resolve(reliabilityEventsPath || eventsPath),
      contextPath: path.resolve(contextPath),
      labelsPath: path.resolve(labelsPath),
      labelEventsPath: path.resolve(labelEventsPath),
      catalogPath: path.resolve(catalogPath),
      clustersPath: path.resolve(clustersPath),
      candlePath: path.resolve(candlePath),
    },
    outputs: {
      enrichedPath: outEnrichedPath ? path.resolve(outEnrichedPath) : null,
      executablePath: outExecutablePath ? path.resolve(outExecutablePath) : null,
      nonExecutablePath: outNonExecutablePath ? path.resolve(outNonExecutablePath) : null,
      summaryPath: outSummaryPath ? path.resolve(outSummaryPath) : null,
    },
    reliabilitySummary: reliability.reliabilitySummary,
    consensusSummary: consensus.consensusSummary,
    scopedRows,
    enrichedRows: enrichedRows.length,
    executableRows: executableRows.length,
    nonExecutableRows: nonExecutableRows.length,
    chartHitRows,
    chartMissRows: enrichedRows.length - chartHitRows,
    operationalHitRows: executableHitRows,
    executableHitRows,
    operationalMissRows: enrichedRows.length - executableHitRows,
    executablePrecisionBaseRate: safeRatio(executableHitRows, enrichedRows.length),
    nonExecutableHitRows: nonExecutableRows.filter((row) => row.chartHitTarget).length,
    nonExecutableMissRows: nonExecutableRows.filter((row) => !row.chartHitTarget).length,
    removedReasons: mapToSortedObject(removedReasons),
    byYear: Object.fromEntries([...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))),
    nonExecutableHitSample,
    nonExecutableMissSample,
  }
  if (toText(outSummaryPath)) await writeJson(outSummaryPath, summary)
  return { summary, rows: enrichedRows, executableRows, nonExecutableRows }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  if (!outSummaryPath) throw new Error("--out-summary is required")
  const outEnrichedPath = maybePath(getFlag(flags, "out-enriched", getFlag(flags, "out", "")), cwd)
  if (!outEnrichedPath) throw new Error("--out-enriched is required")
  const eventsPath = requirePath(getFlag(flags, "events", ""), "events", cwd)
  const reliabilityEventsValue = toText(getFlag(flags, "reliability-events", ""))
  const reliabilityEventsPath = reliabilityEventsValue ? requirePath(reliabilityEventsValue, "reliability-events", cwd) : eventsPath
  const summary = await buildTp12ExecutableConsensusRows({
    eventsPath,
    reliabilityEventsPath,
    contextPath: requirePath(getFlag(flags, "context", ""), "context", cwd),
    labelsPath: requirePath(getFlag(flags, "labels", ""), "labels", cwd),
    labelEventsPath: requirePath(getFlag(flags, "label-events", getFlag(flags, "labels", "")), "label-events", cwd),
    clustersPath: requirePath(getFlag(flags, "clusters", ""), "clusters", cwd),
    catalogPath: requirePath(getFlag(flags, "catalog", ""), "catalog", cwd),
    candlePath: requirePath(getFlag(flags, "candles", getFlag(flags, "candle-path", "")), "candles", cwd),
    dateFrom: toText(getFlag(flags, "date-from", "")),
    dateTo: toText(getFlag(flags, "date-to", "")),
    outEnrichedPath,
    outExecutablePath: maybePath(getFlag(flags, "out-executable", ""), cwd),
    outNonExecutablePath: maybePath(getFlag(flags, "out-non-executable", ""), cwd),
    outSummaryPath,
    patchKey: toText(getFlag(flags, "patch-key", "tp12_executable_consensus_rows_v1")),
    priorStrengthRow: toNumber(getFlag(flags, "prior-strength-row", 100), 100),
    priorStrengthDate: toNumber(getFlag(flags, "prior-strength-date", 50), 50),
    upperGapPct: toNumber(getFlag(flags, "upper-gap-pct", 0.295), 0.295),
  }).then((result) => result.summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        scopedRows: summary.scopedRows,
        executableRows: summary.executableRows,
        nonExecutableRows: summary.nonExecutableRows,
        executableHitRows: summary.executableHitRows,
        operationalMissRows: summary.operationalMissRows,
        outSummaryPath,
        outEnrichedPath,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
