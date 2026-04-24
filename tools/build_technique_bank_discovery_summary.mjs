import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"

const TECHNIQUE_BANK_DISCOVERY_SUMMARY_KIND = "technique_bank_discovery_summary_v1"
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

const normalizeDateKey = (value) => {
  const text = toText(value)
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null
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

const isScreenWindow = (window) => {
  const windowKind = toText(window?.kindWindow)
  if (windowKind) return windowKind === SCREEN_WINDOW_KIND
  return toText(window?.kind) === SCREEN_WINDOW_KIND
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const manifestPath = toText(getFlag(flags, "manifest-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const candlePath = toText(getFlag(flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl")))
  if (!manifestPath || !outPath) {
    throw new Error("build_technique_bank_discovery_summary requires --manifest-path and --out")
  }
  return {
    cwd,
    manifestPath: path.resolve(cwd, manifestPath),
    outPath: path.resolve(cwd, outPath),
    candlePath: path.resolve(cwd, candlePath),
  }
}

const aggregateWindowMetrics = (windows = [], labelId) => {
  const rows = []
  for (const window of Array.isArray(windows) ? windows : []) {
    const metrics = window?.oos?.metricsByLabel?.[labelId] ?? null
    if (!metrics) continue
    rows.push({
      windowId: toText(window?.windowId),
      selectedRows: toNumber(metrics?.selectedRows, 0),
      hitRows: toNumber(metrics?.hitRows, 0),
      hitRate: toNumber(metrics?.hitRate, 0),
      top1DateShare: toNumber(metrics?.top1DateShare, 0),
      uniqueMatchedDates: toNumber(metrics?.uniqueMatchedDates, 0),
      uniqueMatchedSymbols: toNumber(metrics?.uniqueMatchedSymbols, 0),
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
  const manifest = await readJson(args.manifestPath, null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing technique bank discovery manifest: ${args.manifestPath}`)
  }
  const manifestBanks = Array.isArray(manifest?.banks) ? manifest.banks : []
  if (manifestBanks.length < 1) {
    throw new Error(`technique bank discovery manifest has no banks: ${args.manifestPath}`)
  }

  const loadedBanks = []
  let minDateKey = null
  let maxDateKey = null
  for (const entry of manifestBanks) {
    const rollingSummaryPath = path.resolve(toText(entry?.rollingSummaryPath))
    const rollingSummary = await readJson(rollingSummaryPath, null)
    if (!rollingSummary || typeof rollingSummary !== "object") {
      throw new Error(`Missing bank rolling summary: ${rollingSummaryPath}`)
    }
    const windows = Array.isArray(rollingSummary?.windows) ? rollingSummary.windows : []
    const screenWindows = windows.filter((window) => isScreenWindow(window))
    if (screenWindows.length < 1) {
      throw new Error(`Bank rolling summary has no screen windows: ${rollingSummaryPath}`)
    }
    for (const window of screenWindows) {
      const from = normalizeDateKey(window?.oosDateFrom)
      const to = normalizeDateKey(window?.oosDateTo)
      if (from && (!minDateKey || from < minDateKey)) minDateKey = from
      if (to && (!maxDateKey || to > maxDateKey)) maxDateKey = to
    }
    loadedBanks.push({
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

  const banks = loadedBanks.map((entry) => {
    const primaryLabelId = toText(entry?.rollingSummary?.primaryLabelId)
    if (!primaryLabelId) {
      throw new Error(`Bank rolling summary is missing primaryLabelId: ${entry.rollingSummaryPath}`)
    }
    const yearHitMetric = resolveYearHitMetric(entry.screenWindows)
    const primary = aggregateWindowMetrics(entry.screenWindows, primaryLabelId)
    const oosHitCountByYear = Object.fromEntries(
      entry.screenWindows.map((window) => [
        String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4),
        resolveWindowYearHitCount(window, primaryLabelId, yearHitMetric),
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
    const bankDiscoveryConfig = entry?.bankDiscoveryConfig ?? {}
    const passScreen =
      primary.usableWindowCount >= toNumber(bankDiscoveryConfig.minUsableWindows, 0) &&
      primary.hitRate >= toNumber(bankDiscoveryConfig.minRollingOosHitRate, 0) &&
      yearsWithAtLeast2Hits >= toNumber(bankDiscoveryConfig.minOosYearsWithHitGe2, 0) &&
      signalsPer20TradingDays >= toNumber(bankDiscoveryConfig.minSignalsPer20TradingDays, 0) &&
      primary.maxTop1DateShare <= toNumber(bankDiscoveryConfig.maxTop1DateShare, 1)
    return {
      clusterBankId: toText(entry?.clusterBankId) || null,
      entryType: toText(entry?.entryType) || null,
      selectionPolicy: toText(entry?.selectionPolicy) || null,
      bankId: toText(entry?.bankId),
      sourceBankId: toText(entry?.sourceBankId) || toText(entry?.bankId),
      clusterId: toText(entry?.clusterId) || null,
      mechanismId: toText(entry?.mechanismId),
      scopeId: toText(entry?.scopeId),
      lookbackCandidateId: toText(entry?.lookbackCandidateId),
      topTemplateId: toText(entry?.topTemplateId),
      leaderTemplateId: toText(entry?.leaderTemplateId) || null,
      breadthTemplateId: toText(entry?.breadthTemplateId) || null,
      shortlistedTemplateCount: toNumber(entry?.shortlistedTemplateCount, 0),
      shortlistedTemplateIds: Array.isArray(entry?.shortlistedTemplateIds) ? entry.shortlistedTemplateIds : [],
      selectedTemplateIds: Array.isArray(entry?.selectedTemplateIds) ? entry.selectedTemplateIds : [],
      selectedTemplateEntries: Array.isArray(entry?.selectedTemplateEntries) ? entry.selectedTemplateEntries : [],
      sourceBankSummary:
        entry?.sourceBankSummary && typeof entry.sourceBankSummary === "object"
          ? entry.sourceBankSummary
          : null,
      bankDiscoveryConfig:
        entry?.bankDiscoveryConfig && typeof entry.bankDiscoveryConfig === "object"
          ? entry.bankDiscoveryConfig
          : bankDiscoveryConfig,
      childRunId: toText(entry?.childRunId),
      rollingSummaryPath: entry.rollingSummaryPath,
      rollingReportPath: toText(entry?.rollingReportPath),
      yearHitMetric,
      oosSelectedRows: primary.selectedRows,
      oosHitRows: primary.hitRows,
      oosHitRate: round(primary.hitRate, 12),
      usableWindowCount: primary.usableWindowCount,
      signalsPer20TradingDays: round(signalsPer20TradingDays, 6),
      yearsWithAtLeast2Hits,
      oosHitCountByYear,
      tradingDaysByYear,
      top1DateShare: round(primary.maxTop1DateShare, 12),
      uniqueMatchedDates: primary.uniqueMatchedDates,
      uniqueMatchedSymbols: primary.uniqueMatchedSymbols,
      reserveBank: toText(entry?.entryType) === "reserve_bank",
      passScreen,
    }
  })

  banks.sort((left, right) => {
    if (Number(right.passScreen) !== Number(left.passScreen)) {
      return Number(right.passScreen) - Number(left.passScreen)
    }
    const hitRateDelta = Number(right.oosHitRate ?? 0) - Number(left.oosHitRate ?? 0)
    if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
    return String(left.bankId ?? "").localeCompare(String(right.bankId ?? ""))
  })

  const passBanks = banks.filter((bank) => bank.passScreen)
  const summary = {
    kind: TECHNIQUE_BANK_DISCOVERY_SUMMARY_KIND,
    generatedAt: new Date().toISOString(),
    runId: toText(manifest?.runId),
    planPath: toText(manifest?.planPath),
    planContractId: toText(manifest?.planContractId),
    yearHitMetric: banks[0]?.yearHitMetric ?? "hit_rows",
    selectedBankCount: banks.length,
    passBankCount: passBanks.length,
    topBankId: banks[0]?.bankId ?? null,
    topPassBankId: passBanks[0]?.bankId ?? null,
    banks,
  }
  await writeJson(args.outPath, summary)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        selectedBankCount: summary.selectedBankCount,
        passBankCount: summary.passBankCount,
        topBankId: summary.topBankId,
        topPassBankId: summary.topPassBankId,
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
