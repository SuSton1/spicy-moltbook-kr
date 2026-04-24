#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"

const TECHNIQUE_TEMPLATE_SCREEN_SUMMARY_KIND = "technique_template_screen_summary_v1"
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
const isScreenWindow = (window) => {
  const windowKind = toText(window?.kindWindow)
  if (windowKind) return windowKind === SCREEN_WINDOW_KIND
  return toText(window?.kind) === SCREEN_WINDOW_KIND
}

const resolveYearHitMetric = (windows = [], childContract = null) =>
  toText(
    (Array.isArray(windows) ? windows : [])[0]?.yearHitMetric ||
      childContract?.yearHitMetric ||
      childContract?.searchContract?.yearHitMetric ||
      "hit_rows",
  ).toLowerCase() || "hit_rows"

const resolveWindowYearHitCount = (window, labelId, yearHitMetric) => {
  const metrics = window?.oos?.metricsByLabel?.[labelId] ?? null
  if (!metrics) return 0
  const yearKey = String(normalizeDateKey(window?.oosDateFrom) ?? "").slice(0, 4)
  if (yearHitMetric === "unique_decision_dates") {
    return toNumber(metrics?.hitDateCountByYear?.[yearKey], 0)
  }
  return toNumber(metrics?.hitRows, 0)
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const manifestPath = toText(getFlag(flags, "manifest-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const candlePath = toText(getFlag(flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl")))
  if (!manifestPath || !outPath) {
    throw new Error("build_technique_template_screen_summary requires --manifest-path and --out")
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

const buildScreenGateStatus = ({
  primary,
  yearsWithAtLeast2Hits,
  signalsPer20TradingDays,
  templateScreenConfig,
} = {}) => {
  const gateStatus = {
    minUsableWindows: {
      actual: primary.usableWindowCount,
      required: toNumber(templateScreenConfig?.minUsableWindows, 0),
    },
    minRollingOosHitRate: {
      actual: round(primary.hitRate, 12),
      required: round(toNumber(templateScreenConfig?.minRollingOosHitRate, 0), 12),
    },
    minOosYearsWithHitGe2: {
      actual: yearsWithAtLeast2Hits,
      required: toNumber(templateScreenConfig?.minOosYearsWithHitGe2, 0),
    },
    minSignalsPer20TradingDays: {
      actual: round(signalsPer20TradingDays, 6),
      required: round(toNumber(templateScreenConfig?.minSignalsPer20TradingDays, 0), 6),
    },
    maxSignalsPer20TradingDays: {
      actual: round(signalsPer20TradingDays, 6),
      required: round(toNumber(templateScreenConfig?.maxSignalsPer20TradingDays, Number.POSITIVE_INFINITY), 6),
    },
    maxTop1DateShare: {
      actual: round(primary.maxTop1DateShare, 12),
      required: round(toNumber(templateScreenConfig?.maxTop1DateShare, 1), 12),
    },
  }
  gateStatus.minUsableWindows.pass =
    gateStatus.minUsableWindows.actual >= gateStatus.minUsableWindows.required
  gateStatus.minRollingOosHitRate.pass =
    toNumber(primary.hitRate, 0) >= toNumber(templateScreenConfig?.minRollingOosHitRate, 0)
  gateStatus.minOosYearsWithHitGe2.pass =
    yearsWithAtLeast2Hits >= toNumber(templateScreenConfig?.minOosYearsWithHitGe2, 0)
  gateStatus.minSignalsPer20TradingDays.pass =
    signalsPer20TradingDays >= toNumber(templateScreenConfig?.minSignalsPer20TradingDays, 0)
  gateStatus.maxSignalsPer20TradingDays.pass =
    signalsPer20TradingDays <=
    toNumber(templateScreenConfig?.maxSignalsPer20TradingDays, Number.POSITIVE_INFINITY)
  gateStatus.maxTop1DateShare.pass =
    primary.maxTop1DateShare <= toNumber(templateScreenConfig?.maxTop1DateShare, 1)
  const blockingGateIds = Object.entries(gateStatus)
    .filter(([, gate]) => gate?.pass !== true)
    .map(([gateId]) => gateId)
  return {
    gateStatus,
    blockingGateIds,
    passScreen: blockingGateIds.length === 0,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const manifest = await readJson(args.manifestPath, null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing technique template screen manifest: ${args.manifestPath}`)
  }
  const manifestTemplates = Array.isArray(manifest?.templates) ? manifest.templates : []
  if (manifestTemplates.length < 1) {
    throw new Error(`technique template screen manifest has no templates: ${args.manifestPath}`)
  }

  const loadedTemplates = []
  let minDateKey = null
  let maxDateKey = null
  for (const entry of manifestTemplates) {
    const rollingSummaryPath = path.resolve(toText(entry?.rollingSummaryPath))
    const childContractPath = path.resolve(toText(entry?.childContractPath))
    const rollingSummary = await readJson(rollingSummaryPath, null)
    const childContract = await readJson(childContractPath, null)
    if (!rollingSummary || typeof rollingSummary !== "object") {
      throw new Error(`Missing template rolling summary: ${rollingSummaryPath}`)
    }
    if (!childContract || typeof childContract !== "object") {
      throw new Error(`Missing template child contract: ${childContractPath}`)
    }
    const windows = Array.isArray(rollingSummary?.windows) ? rollingSummary.windows : []
    const screenWindows = windows.filter((window) => isScreenWindow(window))
    if (screenWindows.length < 1) {
      throw new Error(`Template rolling summary has no screen windows: ${rollingSummaryPath}`)
    }
    for (const window of screenWindows) {
      const from = normalizeDateKey(window?.oosDateFrom)
      const to = normalizeDateKey(window?.oosDateTo)
      if (from && (!minDateKey || from < minDateKey)) minDateKey = from
      if (to && (!maxDateKey || to > maxDateKey)) maxDateKey = to
    }
    loadedTemplates.push({
      ...entry,
      rollingSummaryPath,
      childContractPath,
      rollingSummary,
      childContract,
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

  const templates = loadedTemplates.map((entry) => {
    const primaryLabelId = toText(entry?.rollingSummary?.primaryLabelId)
    if (!primaryLabelId) {
      throw new Error(`Template rolling summary is missing primaryLabelId: ${entry.rollingSummaryPath}`)
    }
    const yearHitMetric = resolveYearHitMetric(entry.screenWindows, entry.childContract)
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
    const signalsPer20TradingDays = totalTradingDays > 0 ? (primary.selectedRows / totalTradingDays) * 20 : 0
    const yearsWithAtLeast2Hits = Object.values(oosHitCountByYear).filter((value) => toNumber(value, 0) >= 2).length
    const templateContext =
      entry?.childContract?.techniqueClusterTemplateScreen ??
      entry?.childContract?.techniqueTemplateScreen ??
      null
    const templateScreenConfig = templateContext?.templateScreenConfig
    if (!templateScreenConfig || typeof templateScreenConfig !== "object") {
      throw new Error(`Template child contract is missing templateScreenConfig: ${entry.childContractPath}`)
    }
    const screenEvaluation = buildScreenGateStatus({
      primary,
      yearsWithAtLeast2Hits,
      signalsPer20TradingDays,
      templateScreenConfig,
    })
    const concentrationReject =
      screenEvaluation.passScreen !== true &&
      screenEvaluation.blockingGateIds.length > 0 &&
      screenEvaluation.blockingGateIds.every((gateId) => gateId === "maxTop1DateShare")
    return {
      candidateTemplateId: toText(entry?.candidateTemplateId),
      bankId: toText(entry?.bankId),
      sourceBankId: toText(templateContext?.sourceBankId) || toText(entry?.bankId),
      sourceClusterBankId: toText(templateContext?.sourceClusterBankId) || null,
      clusterId: toText(templateContext?.clusterId) || null,
      clusterRole: toText(templateContext?.clusterRole) || null,
      selectionReason: toText(templateContext?.selectionReason) || null,
      entryType: toText(templateContext?.entryType) || null,
      mechanismId: toText(entry?.mechanismId),
      scopeId: toText(entry?.scopeId),
      lookbackCandidateId: toText(entry?.lookbackCandidateId),
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
      templateScreenConfig,
      screenGateStatus: screenEvaluation.gateStatus,
      blockingGateIds: screenEvaluation.blockingGateIds,
      screenRejectReasonCodes: screenEvaluation.blockingGateIds.slice(),
      concentrationReject,
      passScreen: screenEvaluation.passScreen,
    }
  })

  templates.sort((left, right) => {
    if (Number(right.passScreen) !== Number(left.passScreen)) {
      return Number(right.passScreen) - Number(left.passScreen)
    }
    const hitRateDelta = Number(right.oosHitRate ?? 0) - Number(left.oosHitRate ?? 0)
    if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
    return String(left.candidateTemplateId ?? "").localeCompare(String(right.candidateTemplateId ?? ""))
  })

  const passTemplates = templates.filter((template) => template.passScreen)
  const laneMap = new Map()
  for (const template of templates) {
    const laneKey = toText(template.sourceClusterBankId) || toText(template.bankId)
    if (!laneKey) continue
    if (!laneMap.has(laneKey)) {
      laneMap.set(laneKey, {
        laneId: laneKey,
        sourceBankId: toText(template.sourceBankId) || toText(template.bankId),
        clusterId: toText(template.clusterId) || null,
        entryType: toText(template.entryType) || null,
        templateIds: [],
        clusterRoles: new Set(),
        templateCount: 0,
        passTemplateCount: 0,
        concentrationRejectCount: 0,
      })
    }
    const lane = laneMap.get(laneKey)
    lane.templateIds.push(template.candidateTemplateId)
    if (template.clusterRole) lane.clusterRoles.add(template.clusterRole)
    lane.templateCount += 1
    if (template.passScreen === true) lane.passTemplateCount += 1
    if (template.concentrationReject === true) lane.concentrationRejectCount += 1
  }
  const summary = {
    kind: TECHNIQUE_TEMPLATE_SCREEN_SUMMARY_KIND,
    generatedAt: new Date().toISOString(),
    runId: toText(manifest?.runId),
    planPath: toText(manifest?.planPath),
    planContractId: toText(manifest?.planContractId),
    sourceBankId: toText(manifest?.sourceBankId),
    yearHitMetric: templates[0]?.yearHitMetric ?? "hit_rows",
    selectedTemplateCount: templates.length,
    passTemplateCount: passTemplates.length,
    concentrationRejectCount: templates.filter((template) => template.concentrationReject === true).length,
    topTemplateId: templates[0]?.candidateTemplateId ?? null,
    topPassTemplateId: passTemplates[0]?.candidateTemplateId ?? null,
    lanes: Array.from(laneMap.values()).map((lane) => ({
      laneId: lane.laneId,
      sourceBankId: lane.sourceBankId,
      clusterId: lane.clusterId,
      entryType: lane.entryType,
      templateIds: lane.templateIds,
      clusterRoles: Array.from(lane.clusterRoles).sort((left, right) => left.localeCompare(right)),
      templateCount: lane.templateCount,
      passTemplateCount: lane.passTemplateCount,
      concentrationRejectCount: lane.concentrationRejectCount,
    })),
    templates,
  }
  await writeJson(args.outPath, summary)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        selectedTemplateCount: summary.selectedTemplateCount,
        passTemplateCount: summary.passTemplateCount,
        topTemplateId: summary.topTemplateId,
        topPassTemplateId: summary.topPassTemplateId,
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
