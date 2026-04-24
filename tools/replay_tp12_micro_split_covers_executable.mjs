#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "../src/lib/tp12_year2hit_foundation_io.mjs"

const rowKeyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`
const safeRatio = (num, den) => (den > 0 ? num / den : 0)
const toBoolean = (value, fallback = false) => {
  const text = toText(value).toLowerCase()
  if (!text) return fallback
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const requirePath = (value, label, cwd) => {
  const resolved = path.resolve(cwd, toText(value))
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

const readJsonlRows = async (filePath) => {
  const rows = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  return rows
}

const normalizeArray = (value) => uniqueSorted(Array.isArray(value) ? value : [])

const addFeatureRanks = (dateRows) => {
  const fields = new Set()
  for (const row of dateRows) {
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) fields.add(field)
    }
  }
  for (const field of fields) {
    const sorted = dateRows
      .filter((row) => Number.isFinite(row[field]))
      .sort((left, right) => left[field] - right[field] || left.symbol.localeCompare(right.symbol))
    const denom = Math.max(1, sorted.length - 1)
    for (const [index, row] of sorted.entries()) row.__featureRanks[field] = sorted.length > 1 ? index / denom : 1
  }
}

const hydrateRows = ({ rows, dateFrom, dateTo }) => {
  const scoped = []
  for (const row of rows) {
    const decisionDateKey = toText(row?.decisionDateKey ?? row?.dateKey)
    const symbol = toText(row?.symbol).toUpperCase()
    if (!validDateKey(decisionDateKey)) throw new Error(`invalid row decisionDateKey: ${decisionDateKey}`)
    if (!symbol) throw new Error(`row missing symbol for ${decisionDateKey}`)
    if (decisionDateKey < dateFrom || decisionDateKey > dateTo) continue
    for (const field of ["chartHitTarget", "executableHitTarget", "entryExecutable"]) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) {
        throw new Error(`executable cover replay row missing required field: ${decisionDateKey}::${symbol} ${field}`)
      }
    }
    row.decisionDateKey = decisionDateKey
    row.symbol = symbol
    row.hitTarget = row.executableHitTarget === true
    row.chartHitTarget = row.chartHitTarget === true
    row.executableHitTarget = row.executableHitTarget === true
    row.entryExecutable = row.entryExecutable === true
    if (row.executableHitTarget && (!row.chartHitTarget || !row.entryExecutable)) {
      throw new Error(`invalid executableHitTarget invariant at ${decisionDateKey}::${symbol}`)
    }
    row.supportPatternIds = normalizeArray(row.supportPatternIds)
    row.supportClusterIds = normalizeArray(row.supportClusterIds)
    row.supportTokenSet = normalizeArray(row.supportTokenSet)
    row.tokenFamilies = normalizeArray(row.tokenFamilies)
    row.__featureRanks = {}
    scoped.push(row)
  }
  if (scoped.length < 1) throw new Error(`enriched input produced zero scoped rows for ${dateFrom}..${dateTo}`)
  const byDate = new Map()
  for (const row of scoped) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) addFeatureRanks(dateRows)
  scoped.sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol))
  return scoped
}

const normalizeAtom = (atom) => ({
  type: toText(atom?.type),
  field: toText(atom?.field),
  item: toText(atom?.item),
  direction: toText(atom?.direction),
  threshold: toNumber(atom?.threshold, NaN),
})

const rowMatchesAtom = (row, atom) => {
  const normalized = normalizeAtom(atom)
  if (normalized.type === "token_include") {
    if (!normalized.item) throw new Error("token_include atom missing item")
    if (normalized.item.startsWith("family:")) return row.tokenFamilies.includes(normalized.item.slice("family:".length))
    return row.supportTokenSet.includes(normalized.item)
  }
  if (normalized.type === "family_include") {
    if (!normalized.item) throw new Error("family_include atom missing item")
    return row.tokenFamilies.includes(normalized.item)
  }
  if (normalized.type === "pattern_include") {
    if (!normalized.item) throw new Error("pattern_include atom missing item")
    return row.supportPatternIds.includes(normalized.item)
  }
  if (normalized.type === "cluster_include") {
    if (!normalized.item) throw new Error("cluster_include atom missing item")
    return row.supportClusterIds.includes(normalized.item)
  }
  if (normalized.type === "feature_rank") {
    if (!normalized.field || !["ge", "le"].includes(normalized.direction) || !Number.isFinite(normalized.threshold)) {
      throw new Error(`invalid feature_rank atom: ${JSON.stringify(atom)}`)
    }
    const rank = row.__featureRanks?.[normalized.field]
    if (!Number.isFinite(rank)) return false
    return normalized.direction === "ge" ? rank >= normalized.threshold : rank <= normalized.threshold
  }
  throw new Error(`unknown atom type: ${normalized.type}`)
}

const rowMatchesBase = (row, baseType, baseId) => {
  if (baseType === "pattern") return row.supportPatternIds.includes(baseId)
  if (baseType === "cluster") return row.supportClusterIds.includes(baseId)
  if (baseType === "all_year2hit_rows") return true
  throw new Error(`unknown baseType: ${baseType}`)
}

const rowMatchesAtoms = (row, includeAtoms = [], vetoAtoms = []) => {
  for (const atom of includeAtoms) if (!rowMatchesAtom(row, atom)) return false
  for (const atom of vetoAtoms) if (rowMatchesAtom(row, atom)) return false
  return true
}

const rowMatchesCover = (row, cover) => {
  const baseType = toText(cover?.baseType)
  const baseId = toText(cover?.baseId)
  if (!rowMatchesBase(row, baseType, baseId)) return false
  const tiles = Array.isArray(cover?.tiles) ? cover.tiles : []
  if (tiles.length > 0) {
    return tiles.some((tile) => {
      const tileBaseType = toText(tile?.baseType || baseType)
      const tileBaseId = toText(tile?.baseId || baseId)
      return rowMatchesBase(row, tileBaseType, tileBaseId) && rowMatchesAtoms(row, tile.includeAtoms ?? [], tile.vetoAtoms ?? [])
    })
  }
  if (Array.isArray(cover?.includeAtoms)) return rowMatchesAtoms(row, cover.includeAtoms, cover.vetoAtoms ?? [])
  throw new Error(`cover has no replayable atoms/tiles: ${toText(cover?.coverId)}`)
}

const emptyMetrics = (observedYears) => ({
  totalRows: 0,
  chartHitRows: 0,
  chartFalseRows: 0,
  executableRows: 0,
  nonExecutableRows: 0,
  executableHitRows: 0,
  executableMissRows: 0,
  nonExecutableChartHitRows: 0,
  nonExecutableChartMissRows: 0,
  executableHitDateSet: new Set(),
  executableHitRowKeySet: new Set(),
  executableHitDatesByYear: new Map(observedYears.map((year) => [year, new Set()])),
  executableHitSymbolDatesByYear: new Map(observedYears.map((year) => [year, new Set()])),
})

const addRowToMetrics = (metrics, row) => {
  metrics.totalRows += 1
  if (row.chartHitTarget) metrics.chartHitRows += 1
  else metrics.chartFalseRows += 1
  if (row.entryExecutable) metrics.executableRows += 1
  else metrics.nonExecutableRows += 1
  if (row.executableHitTarget) {
    metrics.executableHitRows += 1
    metrics.executableHitDateSet.add(row.decisionDateKey)
    metrics.executableHitRowKeySet.add(rowKeyOf(row))
    const year = row.decisionDateKey.slice(0, 4)
    const dates = metrics.executableHitDatesByYear.get(year) ?? new Set()
    dates.add(row.decisionDateKey)
    metrics.executableHitDatesByYear.set(year, dates)
    const symbolDates = metrics.executableHitSymbolDatesByYear.get(year) ?? new Set()
    symbolDates.add(rowKeyOf(row))
    metrics.executableHitSymbolDatesByYear.set(year, symbolDates)
    return
  }
  if (row.entryExecutable) metrics.executableMissRows += 1
  else if (row.chartHitTarget) metrics.nonExecutableChartHitRows += 1
  else metrics.nonExecutableChartMissRows += 1
}

const finalizeMetrics = (metrics, observedYears) => {
  const executableHitDatesByYear = Object.fromEntries(
    observedYears.map((year) => [year, metrics.executableHitDatesByYear.get(year)?.size ?? 0]),
  )
  const executableHitSymbolDatesByYear = Object.fromEntries(
    observedYears.map((year) => [year, metrics.executableHitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const minExecutableHitDatesPerObservedYear =
    observedYears.length > 0 ? Math.min(...observedYears.map((year) => executableHitDatesByYear[year] ?? 0)) : 0
  const minExecutableHitSymbolDatesPerObservedYear =
    observedYears.length > 0 ? Math.min(...observedYears.map((year) => executableHitSymbolDatesByYear[year] ?? 0)) : 0
  return {
    totalRows: metrics.totalRows,
    chartHitRows: metrics.chartHitRows,
    chartFalseRows: metrics.chartFalseRows,
    executableRows: metrics.executableRows,
    nonExecutableRows: metrics.nonExecutableRows,
    executableHitRows: metrics.executableHitRows,
    operationalFalsePositiveRows: metrics.totalRows - metrics.executableHitRows,
    executableMissRows: metrics.executableMissRows,
    nonExecutableChartHitRows: metrics.nonExecutableChartHitRows,
    nonExecutableChartMissRows: metrics.nonExecutableChartMissRows,
    chartPrecision: safeRatio(metrics.chartHitRows, metrics.totalRows),
    executablePrecisionExcludingNonExecutable: safeRatio(metrics.executableHitRows, metrics.executableRows),
    executablePrecisionPenalizingNonExecutable: safeRatio(metrics.executableHitRows, metrics.totalRows),
    totalExecutableHitDates: metrics.executableHitDateSet.size,
    totalExecutableHitSymbolDates: metrics.executableHitRowKeySet.size,
    executableHitDatesByYear,
    executableHitSymbolDatesByYear,
    minExecutableHitDatesPerObservedYear,
    minExecutableHitSymbolDatesPerObservedYear,
    year2ExecutableHitPassedOnObservedYears:
      minExecutableHitDatesPerObservedYear >= 2 && minExecutableHitSymbolDatesPerObservedYear >= 2,
  }
}

const metricsForRows = (rows, observedYears) => {
  const metrics = emptyMetrics(observedYears)
  for (const row of rows) addRowToMetrics(metrics, row)
  return finalizeMetrics(metrics, observedYears)
}

const sampleRows = (rows, limit = 20) =>
  rows.slice(0, limit).map((row) => ({
    decisionDateKey: row.decisionDateKey,
    symbol: row.symbol,
    chartHitTarget: row.chartHitTarget,
    executableHitTarget: row.executableHitTarget,
    entryExecutable: row.entryExecutable,
    labelClass: row.labelClass,
    execution: row.execution ?? null,
  }))

const writeRows = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath))
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await closeWriteStream(stream)
  }
}

const yearsInRange = (dateFrom, dateTo) => {
  const startYear = Number(dateFrom.slice(0, 4))
  const endYear = Number(dateTo.slice(0, 4))
  const years = []
  for (let year = startYear; year <= endYear; year += 1) years.push(String(year))
  return years
}

const writeEmptySurvivorReplay = async ({
  outDir,
  dateFrom,
  dateTo,
  survivorsPath,
  enrichedPath,
  contractPathValue,
  cwd,
}) => {
  const observedYears = yearsInRange(dateFrom, dateTo)
  const outputPaths = {
    summary: path.join(outDir, "executable_cover_replay_summary.json"),
    coverReplay: path.join(outDir, "executable_cover_replay.jsonl"),
    uniqueMatchedRows: path.join(outDir, "executable_cover_unique_matched_rows.jsonl"),
  }
  await writeRows(outputPaths.coverReplay, [])
  await writeRows(outputPaths.uniqueMatchedRows, [])
  const summary = {
    kind: "tp12_micro_split_executable_cover_replay_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    verdict: "no_survivor_covers",
    dateFrom,
    dateTo,
    observedYears,
    inputs: {
      survivorsPath,
      enrichedPath,
      contractPath: contractPathValue ? path.resolve(cwd, contractPathValue) : null,
    },
    survivorCoverCount: 0,
    scopedRowCount: null,
    coverCountWithMatches: 0,
    coverCountWithExecutableHits: 0,
    zeroOperationalFalsePositiveCoverCount: 0,
    zeroOperationalFalsePositiveYear2CoverCount: 0,
    unionMetrics: metricsForRows([], observedYears),
    topCovers: [],
    sampleExecutableHitRows: [],
    sampleOperationalFalsePositiveRows: [],
    outputPaths,
  }
  await writeJson(outputPaths.summary, summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        survivorCoverCount: summary.survivorCoverCount,
        zeroOperationalFalsePositiveYear2CoverCount:
          summary.zeroOperationalFalsePositiveYear2CoverCount,
        unionRows: summary.unionMetrics.totalRows,
        unionExecutableHitRows: summary.unionMetrics.executableHitRows,
        unionOperationalFalsePositiveRows: summary.unionMetrics.operationalFalsePositiveRows,
        summaryPath: outputPaths.summary,
      },
      null,
      2,
    ),
  )
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const survivorsPath = requirePath(getFlag(flags, "survivors", getFlag(flags, "covers", "")), "survivors", cwd)
  const enrichedPath = requirePath(getFlag(flags, "enriched", ""), "enriched", cwd)
  const outDir = path.resolve(cwd, toText(getFlag(flags, "out-dir", "")))
  if (!toText(outDir)) throw new Error("--out-dir is required")
  const contractPathValue = toText(getFlag(flags, "contract", ""))
  const contract = contractPathValue ? await readJson(requirePath(contractPathValue, "contract", cwd)) : {}
  const dateFrom = toText(getFlag(flags, "date-from", contract?.trainDateRange?.from ?? contract?.oosDateRange?.from ?? ""))
  const dateTo = toText(getFlag(flags, "date-to", contract?.trainDateRange?.to ?? contract?.oosDateRange?.to ?? ""))
  if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) throw new Error(`invalid date range: ${dateFrom}..${dateTo}`)
  const covers = await readJsonlRows(survivorsPath)
  if (covers.length < 1) {
    if (toBoolean(getFlag(flags, "allow-empty-survivors", false), false)) {
      await writeEmptySurvivorReplay({
        outDir,
        dateFrom,
        dateTo,
        survivorsPath,
        enrichedPath,
        contractPathValue,
        cwd,
      })
      return
    }
    throw new Error(`survivor cover input produced zero rows: ${survivorsPath}`)
  }
  const rows = hydrateRows({ rows: await readJsonlRows(enrichedPath), dateFrom, dateTo })
  const observedYears = uniqueSorted(rows.map((row) => row.decisionDateKey.slice(0, 4)))
  const coverOutputs = []
  const unionKeys = new Set()
  for (const cover of covers) {
    const matchedRows = rows.filter((row) => rowMatchesCover(row, cover))
    for (const row of matchedRows) unionKeys.add(rowKeyOf(row))
    const metrics = metricsForRows(matchedRows, observedYears)
    coverOutputs.push({
      kind: "tp12_micro_split_executable_cover_replay_v1",
      coverId: toText(cover.coverId),
      baseType: toText(cover.baseType),
      baseId: toText(cover.baseId),
      tileCount: Array.isArray(cover.tiles) ? cover.tiles.length : toNumber(cover.tileCount, 0),
      metrics,
      matchedRowKeys: uniqueSorted(matchedRows.map(rowKeyOf)),
      sampleExecutableHitRows: sampleRows(matchedRows.filter((row) => row.executableHitTarget)),
      sampleOperationalFalsePositiveRows: sampleRows(matchedRows.filter((row) => !row.executableHitTarget)),
    })
  }
  const rowByKey = new Map(rows.map((row) => [rowKeyOf(row), row]))
  const unionRows = uniqueSorted([...unionKeys]).map((key) => rowByKey.get(key)).filter(Boolean)
  const unionMetrics = metricsForRows(unionRows, observedYears)
  coverOutputs.sort(
    (left, right) =>
      right.metrics.executablePrecisionPenalizingNonExecutable - left.metrics.executablePrecisionPenalizingNonExecutable ||
      right.metrics.executableHitRows - left.metrics.executableHitRows ||
      left.metrics.operationalFalsePositiveRows - right.metrics.operationalFalsePositiveRows ||
      left.coverId.localeCompare(right.coverId),
  )
  const outputPaths = {
    summary: path.join(outDir, "executable_cover_replay_summary.json"),
    coverReplay: path.join(outDir, "executable_cover_replay.jsonl"),
    uniqueMatchedRows: path.join(outDir, "executable_cover_unique_matched_rows.jsonl"),
  }
  await writeRows(outputPaths.coverReplay, coverOutputs)
  await writeRows(outputPaths.uniqueMatchedRows, unionRows)
  const summary = {
    kind: "tp12_micro_split_executable_cover_replay_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    dateFrom,
    dateTo,
    observedYears,
    inputs: {
      survivorsPath,
      enrichedPath,
      contractPath: contractPathValue ? path.resolve(cwd, contractPathValue) : null,
    },
    survivorCoverCount: covers.length,
    scopedRowCount: rows.length,
    coverCountWithMatches: coverOutputs.filter((row) => row.metrics.totalRows > 0).length,
    coverCountWithExecutableHits: coverOutputs.filter((row) => row.metrics.executableHitRows > 0).length,
    zeroOperationalFalsePositiveCoverCount: coverOutputs.filter((row) => row.metrics.operationalFalsePositiveRows === 0).length,
    zeroOperationalFalsePositiveYear2CoverCount: coverOutputs.filter(
      (row) => row.metrics.operationalFalsePositiveRows === 0 && row.metrics.year2ExecutableHitPassedOnObservedYears,
    ).length,
    unionMetrics,
    topCovers: coverOutputs.slice(0, 30).map((row) => ({
      coverId: row.coverId,
      baseType: row.baseType,
      baseId: row.baseId,
      tileCount: row.tileCount,
      metrics: row.metrics,
    })),
    sampleExecutableHitRows: sampleRows(unionRows.filter((row) => row.executableHitTarget)),
    sampleOperationalFalsePositiveRows: sampleRows(unionRows.filter((row) => !row.executableHitTarget)),
    outputPaths,
  }
  await writeJson(outputPaths.summary, summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        survivorCoverCount: summary.survivorCoverCount,
        coverCountWithMatches: summary.coverCountWithMatches,
        zeroOperationalFalsePositiveYear2CoverCount: summary.zeroOperationalFalsePositiveYear2CoverCount,
        unionRows: summary.unionMetrics.totalRows,
        unionExecutableHitRows: summary.unionMetrics.executableHitRows,
        unionOperationalFalsePositiveRows: summary.unionMetrics.operationalFalsePositiveRows,
        summaryPath: outputPaths.summary,
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
