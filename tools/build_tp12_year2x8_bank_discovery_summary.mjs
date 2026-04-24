import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"
import { loadTp12Year2x8BankDiscoveryContract } from "../src/lib/tp12_year2x8_contract.mjs"

const MATRIX_SUMMARY_KIND = "tp12_year2x8_bank_discovery_summary_v1"
const SCREEN_WINDOW_KIND = "screen"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const round = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}
const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}

const resolveYearHitMetric = (windows = []) =>
  toText((Array.isArray(windows) ? windows : [])[0]?.yearHitMetric || "hit_rows").toLowerCase() || "hit_rows"

const resolveWindowYearHitCount = (window, labelId, yearHitMetric) => {
  const metrics = window?.oos?.metricsByLabel?.[labelId] ?? null
  if (!metrics) return 0
  const yearKey = String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4)
  if (yearHitMetric === "unique_decision_dates") {
    return toNumber(metrics?.hitDateCountByYear?.[yearKey], 0)
  }
  return toNumber(metrics?.hitRows, 0)
}

const normalizeDateKey = (value) => {
  const text = toText(value)
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null
}

const isScreenWindow = (window) => {
  const windowKind = toText(window?.kindWindow)
  if (windowKind) return windowKind === SCREEN_WINDOW_KIND
  return toText(window?.kind) === SCREEN_WINDOW_KIND
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const manifestPath = toText(getFlag(flags, "manifest-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const candlePath = toText(getFlag(flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl")))
  if (!manifestPath || !outPath) {
    throw new Error(
      "build_tp12_year2x8_bank_discovery_summary requires --manifest-path and --out",
    )
  }
  return {
    cwd,
    contractPath,
    manifestPath: path.resolve(cwd, manifestPath),
    outPath: path.resolve(cwd, outPath),
    candlePath: path.resolve(cwd, candlePath),
  }
}

const aggregateWindowMetrics = (windows = [], labelId) => {
  const safeWindows = Array.isArray(windows) ? windows : []
  const rows = []
  for (const window of safeWindows) {
    const metrics = window?.oos?.metricsByLabel?.[labelId] ?? null
    if (!metrics) continue
    rows.push({
      windowId: toText(window?.windowId),
      selectedRows: toNumber(metrics?.selectedRows, 0),
      hitRows: toNumber(metrics?.hitRows, 0),
      hitRate: toNumber(metrics?.hitRate, 0),
      uniqueMatchedDates: toNumber(metrics?.uniqueMatchedDates, 0),
      uniqueMatchedSymbols: toNumber(metrics?.uniqueMatchedSymbols, 0),
      top1DateShare: toNumber(metrics?.top1DateShare, 0),
      dateFrom: normalizeDateKey(metrics?.dateFrom ?? window?.oosDateFrom),
      dateTo: normalizeDateKey(metrics?.dateTo ?? window?.oosDateTo),
    })
  }
  const selectedRows = rows.reduce((sum, row) => sum + row.selectedRows, 0)
  const hitRows = rows.reduce((sum, row) => sum + row.hitRows, 0)
  return {
    windowCount: rows.length,
    usableWindowCount: rows.filter((row) => row.selectedRows > 0).length,
    selectedRows,
    hitRows,
    hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
    uniqueMatchedDates: rows.reduce((sum, row) => sum + row.uniqueMatchedDates, 0),
    uniqueMatchedSymbols: rows.reduce((sum, row) => sum + row.uniqueMatchedSymbols, 0),
    maxTop1DateShare: rows.length > 0 ? Math.max(...rows.map((row) => row.top1DateShare)) : 0,
  }
}

const buildTradingDateSet = async ({ candlePath, minDateKey, maxDateKey }) => {
  const dateSet = new Set()
  await iterateJsonl(candlePath, {
    strict: true,
    onRow: async (row) => {
      const dateKey = normalizeDateKey(row?.dateKey ?? row?.date)
      if (!dateKey) return
      if (minDateKey && dateKey < minDateKey) return
      if (maxDateKey && dateKey > maxDateKey) return
      dateSet.add(dateKey)
    },
  })
  return dateSet
}

const countTradingDatesInRange = (tradingDateSet, from, to) => {
  const start = normalizeDateKey(from)
  const end = normalizeDateKey(to)
  if (!start || !end || start > end) return 0
  let count = 0
  for (const dateKey of tradingDateSet) {
    if (dateKey < start) continue
    if (dateKey > end) continue
    count += 1
  }
  return count
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const contract = await loadTp12Year2x8BankDiscoveryContract({
    contractPath: args.contractPath,
    cwd,
  })
  const manifest = await readJson(args.manifestPath, null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing year2x8 bank discovery manifest: ${args.manifestPath}`)
  }
  const manifestCells = Array.isArray(manifest?.cells) ? manifest.cells : []
  if (manifestCells.length < 1) {
    throw new Error(`year2x8 bank discovery manifest has no cells: ${args.manifestPath}`)
  }

  const loadedCells = []
  let minDateKey = null
  let maxDateKey = null
  for (const entry of manifestCells) {
    const rollingSummaryPath = path.resolve(toText(entry?.rollingSummaryPath))
    const rollingSummary = await readJson(rollingSummaryPath, null)
    if (!rollingSummary || typeof rollingSummary !== "object") {
      throw new Error(`Missing cell rolling summary: ${rollingSummaryPath}`)
    }
    const windows = Array.isArray(rollingSummary?.windows) ? rollingSummary.windows : []
    const screenWindows = windows.filter((window) => isScreenWindow(window))
    if (screenWindows.length < 1) {
      throw new Error(`Cell summary has no screen windows: ${rollingSummaryPath}`)
    }
    for (const window of screenWindows) {
      const from = normalizeDateKey(window?.oosDateFrom)
      const to = normalizeDateKey(window?.oosDateTo)
      if (from && (!minDateKey || from < minDateKey)) minDateKey = from
      if (to && (!maxDateKey || to > maxDateKey)) maxDateKey = to
    }
    loadedCells.push({
      ...entry,
      rollingSummaryPath,
      rollingSummary,
      screenWindows,
    })
  }

  const tradingDateSet = await buildTradingDateSet({
    candlePath: args.candlePath,
    minDateKey,
    maxDateKey,
  })
  if (tradingDateSet.size < 1) {
    throw new Error(`Unable to resolve trading dates from candle path: ${args.candlePath}`)
  }

  const cells = loadedCells.map((entry) => {
    const rollingSummary = entry.rollingSummary
    const primaryLabelId = toText(rollingSummary?.primaryLabelId)
    if (!primaryLabelId) {
      throw new Error(`Cell summary is missing primaryLabelId: ${entry.rollingSummaryPath}`)
    }
    const yearHitMetric = resolveYearHitMetric(entry.screenWindows)
    const primary = aggregateWindowMetrics(entry.screenWindows, primaryLabelId)
    const yearRuleCount = entry.screenWindows.reduce(
      (sum, window) => sum + toNumber(window?.search?.leaderboardRowCount, 0),
      0,
    )
    const oosHitCountByYear = Object.fromEntries(
      entry.screenWindows.map((window) => [
        String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4),
        resolveWindowYearHitCount(window, primaryLabelId, yearHitMetric),
      ]),
    )
    const selectedRowsByYear = Object.fromEntries(
      entry.screenWindows.map((window) => [
        String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4),
        toNumber(window?.oos?.metricsByLabel?.[primaryLabelId]?.selectedRows, 0),
      ]),
    )
    const tradingDaysByYear = Object.fromEntries(
      entry.screenWindows.map((window) => {
        const yearKey = String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4)
        return [
          yearKey,
          countTradingDatesInRange(tradingDateSet, window?.oosDateFrom, window?.oosDateTo),
        ]
      }),
    )
    const totalTradingDays = Object.values(tradingDaysByYear).reduce((sum, value) => sum + toNumber(value, 0), 0)
    const signalsPer20TradingDays =
      totalTradingDays > 0 ? (primary.selectedRows / totalTradingDays) * 20 : 0
    const yearsWithAtLeast2Hits = Object.values(oosHitCountByYear).filter((value) => toNumber(value, 0) >= 2).length
    const passScreen =
      primary.usableWindowCount >= contract.promotion.screenMinUsableWindows &&
      yearRuleCount > 0 &&
      primary.hitRate >= contract.promotion.screenMinRollingOosHitRate &&
      signalsPer20TradingDays >= contract.promotion.screenMinSignalsPer20TradingDays &&
      yearsWithAtLeast2Hits >= contract.promotion.screenMinYearsWithAtLeast2Hits &&
      primary.maxTop1DateShare <= contract.promotion.screenMaxTop1DateShare
    return {
      cellId: toText(entry?.cellId),
      scopeId: toText(entry?.scopeId),
      candidateId: toText(entry?.candidateId),
      lookbackTradingDays: toNumber(entry?.lookbackTradingDays, 0),
      childRunId: toText(entry?.childRunId),
      childContractPath: toText(entry?.childContractPath),
      rollingSummaryPath: entry.rollingSummaryPath,
      ruleCount: yearRuleCount,
      year2x8CandidateRuleCount: yearRuleCount,
      yearHitMetric,
      oosSelectedRows: primary.selectedRows,
      oosHitRows: primary.hitRows,
      oosHitRate: round(primary.hitRate, 12),
      usableWindowCount: primary.usableWindowCount,
      signalsPer20TradingDays: round(signalsPer20TradingDays, 6),
      oosHitCountByYear,
      selectedRowsByYear,
      tradingDaysByYear,
      top1DateShare: round(primary.maxTop1DateShare, 12),
      yearsWithAtLeast2Hits,
      passScreen,
    }
  })

  cells.sort((left, right) => {
    if (Number(right.passScreen) !== Number(left.passScreen)) {
      return Number(right.passScreen) - Number(left.passScreen)
    }
    if (toNumber(right.oosHitRate, 0) !== toNumber(left.oosHitRate, 0)) {
      return toNumber(right.oosHitRate, 0) - toNumber(left.oosHitRate, 0)
    }
    if (toNumber(right.signalsPer20TradingDays, 0) !== toNumber(left.signalsPer20TradingDays, 0)) {
      return toNumber(right.signalsPer20TradingDays, 0) - toNumber(left.signalsPer20TradingDays, 0)
    }
    return String(left.cellId).localeCompare(String(right.cellId))
  })

  const summary = {
    kind: MATRIX_SUMMARY_KIND,
    contractId: contract.contractId,
    contractPath: contract.contractPath,
    runId: toText(manifest?.runId),
    manifestPath: args.manifestPath,
    cellCount: cells.length,
    canonicalBaseline: contract.canonicalBaseline,
    promotion: contract.promotion,
    cells,
  }

  await writeJson(args.outPath, summary)
  const reportPath = path.join(path.dirname(args.outPath), "matrix_report.md")
  const reportLines = [
    "# TP12 Year2x8 Bank Discovery Matrix",
    "",
    `- contractId: \`${summary.contractId}\``,
    `- runId: \`${summary.runId}\``,
    `- canonical baseline: \`${contract.canonicalBaseline.scopeId} + ${contract.canonicalBaseline.candidateId}\` final ${pct(contract.canonicalBaseline.finalHitRate)}`,
    "",
    "## Cells",
    "",
    ...cells.map(
      (cell) =>
        `- ${cell.cellId}: ${cell.oosHitRows}/${cell.oosSelectedRows} = ${pct(cell.oosHitRate)}, usable=${cell.usableWindowCount}/6, signalsPer20=${round(cell.signalsPer20TradingDays, 2) ?? 0}, years>=2hit=${cell.yearsWithAtLeast2Hits}, top1DateShare=${pct(cell.top1DateShare)}, pass=${cell.passScreen}`,
    ),
    "",
  ]
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        reportPath,
        contractId: summary.contractId,
        cellCount: summary.cellCount,
        passingCellCount: cells.filter((cell) => cell.passScreen).length,
        topCellId: cells[0]?.cellId ?? null,
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
