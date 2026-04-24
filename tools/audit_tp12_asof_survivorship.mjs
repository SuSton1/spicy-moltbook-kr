#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, writeJson } from "../src/lib/io.mjs"
import { resolveTp12Year2hitDateKey } from "../src/lib/tp12_year2hit_train_gate.mjs"

const toText = (value) => String(value ?? "").trim()
const validDateKey = (dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(toText(dateKey))

const normalizeOpenEnd = (value) => {
  const text = toText(value)
  return text || null
}

const lifecycleActiveOn = (rows, dateKey) =>
  rows.some((row) => {
    const listedFrom = normalizeOpenEnd(row.listedFrom ?? row.effectiveFrom)
    const effectiveFrom = normalizeOpenEnd(row.effectiveFrom ?? row.listedFrom)
    const start = [listedFrom, effectiveFrom].filter(Boolean).sort().at(-1)
    const delistedOn = normalizeOpenEnd(row.delistedOn)
    const effectiveTo = normalizeOpenEnd(row.effectiveTo)
    if (start && dateKey < start) return false
    // KRX historical price endpoints stop at the trading day before `delistedOn`.
    // Keep `effectiveTo` inclusive, but treat raw `delistedOn` as an exclusive bound.
    if (effectiveTo && dateKey > effectiveTo) return false
    if (delistedOn && dateKey >= delistedOn) return false
    return true
  })

const incrementCount = (map, key) => {
  const text = toText(key)
  if (!text) return
  map.set(text, (map.get(text) ?? 0) + 1)
}

const topCounts = (map, limit = 100) =>
  [...map.entries()]
    .map(([symbol, rowCount]) => ({ symbol, rowCount }))
    .sort((left, right) => right.rowCount - left.rowCount || left.symbol.localeCompare(right.symbol))
    .slice(0, limit)

const summarizeLifecycleRows = (rows) =>
  rows.slice(0, 5).map((row) => ({
    listedFrom: normalizeOpenEnd(row.listedFrom),
    effectiveFrom: normalizeOpenEnd(row.effectiveFrom),
    effectiveTo: normalizeOpenEnd(row.effectiveTo),
    delistedOn: normalizeOpenEnd(row.delistedOn),
    source: normalizeOpenEnd(row.source),
  }))

export const auditTp12AsofSurvivorship = async ({
  eventsPath,
  lifecyclePath,
  dateFrom = "",
  dateTo = "",
  outPath = "",
} = {}) => {
  if (!toText(eventsPath)) throw new Error("eventsPath is required")
  if (!toText(lifecyclePath)) throw new Error("lifecyclePath is required")
  const lifecycleBySymbol = new Map()
  await iterateJsonl(lifecyclePath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      if (!symbol) return
      const rows = lifecycleBySymbol.get(symbol) ?? []
      rows.push(row)
      lifecycleBySymbol.set(symbol, rows)
    },
  })
  let inputRowCount = 0
  let auditedRowCount = 0
  let activeAsOfRowCount = 0
  let missingLifecycleRowCount = 0
  let inactiveAsOfRowCount = 0
  let listedFalseButActiveAsOfRowCount = 0
  const missingLifecycleSymbols = new Set()
  const missingLifecycleSymbolCounts = new Map()
  const inactiveAsOfSymbolCounts = new Map()
  const inactiveAsOfSamples = []
  const from = toText(dateFrom)
  const to = toText(dateTo)
  await iterateJsonl(eventsPath, {
    strict: true,
    onRow: async (row) => {
      inputRowCount += 1
      const symbol = toText(row?.symbol)
      const dateKey = resolveTp12Year2hitDateKey(row)
      if (!symbol || !validDateKey(dateKey)) return
      if (from && dateKey < from) return
      if (to && dateKey > to) return
      auditedRowCount += 1
      const lifecycleRows = lifecycleBySymbol.get(symbol) ?? []
      if (lifecycleRows.length < 1) {
        missingLifecycleRowCount += 1
        missingLifecycleSymbols.add(symbol)
        incrementCount(missingLifecycleSymbolCounts, symbol)
        return
      }
      const activeAsOf = lifecycleActiveOn(lifecycleRows, dateKey)
      if (!activeAsOf) {
        inactiveAsOfRowCount += 1
        incrementCount(inactiveAsOfSymbolCounts, symbol)
        if (inactiveAsOfSamples.length < 25) {
          inactiveAsOfSamples.push({ symbol, dateKey, lifecycleRows: summarizeLifecycleRows(lifecycleRows) })
        }
        return
      }
      activeAsOfRowCount += 1
      if (row?.isListed === false) listedFalseButActiveAsOfRowCount += 1
    },
  })
  const failures = []
  if (missingLifecycleRowCount > 0) failures.push(`missing_lifecycle_rows:${missingLifecycleRowCount}`)
  if (inactiveAsOfRowCount > 0) failures.push(`inactive_asof_rows:${inactiveAsOfRowCount}`)
  const payload = {
    kind: "tp12_asof_survivorship_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    dateRange: { from: from || null, to: to || null },
    inputRowCount,
    auditedRowCount,
    activeAsOfRowCount,
    lifecycleSymbolCount: lifecycleBySymbol.size,
    missingLifecycleRowCount,
    missingLifecycleSymbols: [...missingLifecycleSymbols].sort().slice(0, 100),
    missingLifecycleSymbolCounts: topCounts(missingLifecycleSymbolCounts),
    inactiveAsOfRowCount,
    inactiveAsOfSymbolCounts: topCounts(inactiveAsOfSymbolCounts),
    inactiveAsOfSamples,
    listedFalseButActiveAsOfRowCount,
    failures,
  }
  if (outPath) await writeJson(outPath, payload)
  if (failures.length > 0) throw new Error(`tp12 as-of survivorship audit failed: ${failures.join("; ")}`)
  return payload
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const eventsPath = toText(getFlag(flags, "events-path", ""))
  const lifecyclePath = toText(getFlag(flags, "lifecycle-path", "data/historical_symbol_lifecycle.jsonl"))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!eventsPath || !outPath) {
    throw new Error("audit_tp12_asof_survivorship requires --events-path and --out")
  }
  const summary = await auditTp12AsofSurvivorship({
    eventsPath: path.resolve(cwd, eventsPath),
    lifecyclePath: path.resolve(cwd, lifecyclePath),
    dateFrom: toText(getFlag(flags, "from", "")),
    dateTo: toText(getFlag(flags, "to", "")),
    outPath: path.resolve(cwd, outPath),
  })
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
