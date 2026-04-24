import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"
import { loadTp12Year2x8BankDiscoveryContract } from "../src/lib/tp12_year2x8_contract.mjs"
import { buildTp12Year2x8BankDiscoveryCellId } from "../src/lib/tp12_bank_grid_contracts.mjs"

const FINAL_SUMMARY_KIND = "tp12_year2x8_final_confirm_summary_v1"
const FINAL_WINDOW_KIND = "final_confirm"

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
const normalizeDateKey = (value) => {
  const text = toText(value)
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const rollingSummaryPath = toText(getFlag(flags, "rolling-summary-path", ""))
  const scopeId = toText(getFlag(flags, "scope-id", ""))
  const candidateId = toText(getFlag(flags, "candidate-id", ""))
  const runId = toText(getFlag(flags, "run-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const candlePath = toText(getFlag(flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl")))
  if (!rollingSummaryPath || !scopeId || !candidateId || !runId || !outPath) {
    throw new Error(
      "build_tp12_year2x8_final_confirm_summary requires --rolling-summary-path, --scope-id, --candidate-id, --run-id, and --out",
    )
  }
  return {
    cwd,
    contractPath,
    rollingSummaryPath: path.resolve(cwd, rollingSummaryPath),
    scopeId,
    candidateId,
    runId,
    outPath: path.resolve(cwd, outPath),
    candlePath: path.resolve(cwd, candlePath),
  }
}

const countTradingDatesInRange = async ({ candlePath, from, to }) => {
  const start = normalizeDateKey(from)
  const end = normalizeDateKey(to)
  if (!start || !end || start > end) return 0
  const dateSet = new Set()
  await iterateJsonl(candlePath, {
    strict: true,
    onRow: async (row) => {
      const dateKey = normalizeDateKey(row?.dateKey ?? row?.date)
      if (!dateKey) return
      if (dateKey < start) return
      if (dateKey > end) return
      dateSet.add(dateKey)
    },
  })
  return dateSet.size
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const contract = await loadTp12Year2x8BankDiscoveryContract({
    contractPath: args.contractPath,
    cwd,
  })
  const rollingSummary = await readJson(args.rollingSummaryPath, null)
  if (!rollingSummary || typeof rollingSummary !== "object") {
    throw new Error(`Missing rolling summary: ${args.rollingSummaryPath}`)
  }
  const primaryLabelId = toText(rollingSummary?.primaryLabelId)
  if (!primaryLabelId) {
    throw new Error(`Rolling summary is missing primaryLabelId: ${args.rollingSummaryPath}`)
  }
  const windows = Array.isArray(rollingSummary?.windows) ? rollingSummary.windows : []
  const finalWindow = windows.find((window) => toText(window?.kind ?? window?.kindWindow) === FINAL_WINDOW_KIND) ?? null
  if (!finalWindow) {
    throw new Error(`Rolling summary does not contain final confirm window: ${args.rollingSummaryPath}`)
  }
  const finalMetrics = finalWindow?.oos?.metricsByLabel?.[primaryLabelId] ?? null
  if (!finalMetrics || typeof finalMetrics !== "object") {
    throw new Error(`Final confirm window is missing primary metrics: ${args.rollingSummaryPath}`)
  }
  const tradingDays = await countTradingDatesInRange({
    candlePath: args.candlePath,
    from: finalWindow.oosDateFrom,
    to: finalWindow.oosDateTo,
  })
  const signalsPer20TradingDays =
    tradingDays > 0 ? (toNumber(finalMetrics.selectedRows, 0) / tradingDays) * 20 : 0
  const cellId = buildTp12Year2x8BankDiscoveryCellId({
    scopeId: args.scopeId,
    candidateId: args.candidateId,
  })
  const hitRate = toNumber(finalMetrics.hitRate, 0)
  const selectedRows = toNumber(finalMetrics.selectedRows, 0)
  const uniqueMatchedDates = toNumber(finalMetrics.uniqueMatchedDates, 0)
  const top1DateShare = toNumber(finalMetrics.top1DateShare, 0)
  const passFinal =
    hitRate >= contract.promotion.finalMinOosHitRate &&
    selectedRows >= contract.promotion.finalMinSelectedRows &&
    signalsPer20TradingDays >= contract.promotion.finalMinSignalsPer20TradingDays &&
    uniqueMatchedDates >= contract.promotion.finalMinUniqueMatchedDates &&
    top1DateShare <= contract.promotion.finalMaxTop1DateShare

  const summary = {
    kind: FINAL_SUMMARY_KIND,
    contractId: contract.contractId,
    contractPath: contract.contractPath,
    runId: args.runId,
    cellId,
    scopeId: args.scopeId,
    candidateId: args.candidateId,
    rollingSummaryPath: args.rollingSummaryPath,
    sourceRunId: toText(finalWindow?.sourceRunId),
    scopeRunId: toText(finalWindow?.scopeRunId),
    windowId: toText(finalWindow?.windowId),
    trainDateFrom: normalizeDateKey(finalWindow?.trainDateFrom),
    trainDateTo: normalizeDateKey(finalWindow?.trainDateTo),
    oosDateFrom: normalizeDateKey(finalWindow?.oosDateFrom),
    oosDateTo: normalizeDateKey(finalWindow?.oosDateTo),
    selectionMode: toText(finalWindow?.search?.selectionMode),
    lineId: toText(finalWindow?.search?.lineId),
    ruleCount: toNumber(finalWindow?.search?.leaderboardRowCount, 0),
    year2x8CandidateRuleCount: toNumber(finalWindow?.search?.leaderboardRowCount, 0),
    oosSelectedRows: selectedRows,
    oosHitRows: toNumber(finalMetrics.hitRows, 0),
    oosHitRate: round(hitRate, 12),
    uniqueMatchedDates,
    uniqueMatchedSymbols: toNumber(finalMetrics.uniqueMatchedSymbols, 0),
    top1DateShare: round(top1DateShare, 12),
    signalsPer20TradingDays: round(signalsPer20TradingDays, 6),
    tradingDays,
    passFinal,
    softFailBelowHitRate: hitRate < contract.promotion.finalSoftFailBelowHitRate,
    thresholds: {
      finalMinOosHitRate: contract.promotion.finalMinOosHitRate,
      finalMinSelectedRows: contract.promotion.finalMinSelectedRows,
      finalMinSignalsPer20TradingDays: contract.promotion.finalMinSignalsPer20TradingDays,
      finalMinUniqueMatchedDates: contract.promotion.finalMinUniqueMatchedDates,
      finalMaxTop1DateShare: contract.promotion.finalMaxTop1DateShare,
      finalSoftFailBelowHitRate: contract.promotion.finalSoftFailBelowHitRate,
    },
  }

  await writeJson(args.outPath, summary)
  const reportPath = path.join(path.dirname(args.outPath), "final_confirm_report.md")
  const reportLines = [
    "# TP12 Year2x8 Final Confirm Summary",
    "",
    `- cellId: \`${summary.cellId}\``,
    `- runId: \`${summary.runId}\``,
    `- sourceRunId: \`${summary.sourceRunId}\``,
    `- scopeRunId: \`${summary.scopeRunId}\``,
    `- OOS: ${summary.oosHitRows}/${summary.oosSelectedRows} = ${pct(summary.oosHitRate)}`,
    `- signalsPer20TradingDays: ${round(summary.signalsPer20TradingDays, 2) ?? 0}`,
    `- uniqueMatchedDates: ${summary.uniqueMatchedDates}`,
    `- top1DateShare: ${pct(summary.top1DateShare)}`,
    `- passFinal: ${summary.passFinal}`,
    "",
  ]
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        reportPath,
        cellId: summary.cellId,
        passFinal: summary.passFinal,
        oosHitRate: summary.oosHitRate,
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
