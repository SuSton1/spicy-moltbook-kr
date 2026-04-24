import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonl, writeJson } from "./io.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}

const resolveOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const resolveApplyDateKey = (row) =>
  toText(row?.dateKey ?? row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.eventDate) || null

export const buildTp12NoStopLb5Year2x7ReplayMetrics = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const countsByDate = new Map()
  const symbolSet = new Set()
  let hitRows = 0
  for (const row of safeRows) {
    const dateKey = resolveApplyDateKey(row)
    if (dateKey) {
      countsByDate.set(dateKey, Number(countsByDate.get(dateKey) ?? 0) + 1)
    }
    const symbol = toText(row?.symbol)
    if (symbol) symbolSet.add(symbol)
    if (resolveOutcomeHitTarget(row) === true) hitRows += 1
  }
  const orderedDateKeys = Array.from(countsByDate.keys()).sort((left, right) => left.localeCompare(right))
  const selectedRows = safeRows.length
  const maxDateCount = countsByDate.size > 0 ? Math.max(...countsByDate.values()) : 0
  return {
    selectedRows,
    hitRows,
    hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
    uniqueMatchedDates: orderedDateKeys.length,
    uniqueMatchedSymbols: symbolSet.size,
    top1DateShare: selectedRows > 0 ? maxDateCount / selectedRows : 0,
    dateFrom: orderedDateKeys[0] ?? null,
    dateTo: orderedDateKeys[orderedDateKeys.length - 1] ?? null,
  }
}

export const buildTp12NoStopLb5Year2x7ReplaySummary = async ({
  contract,
  auditSummaryPath,
  freezeResultPath,
  trainApplyDir,
  oosApplyDir,
  outPath,
  runId,
} = {}) => {
  const auditSummary = await readJson(path.resolve(auditSummaryPath ?? ""), null)
  if (!auditSummary || typeof auditSummary !== "object") {
    throw new Error(`Missing year2x7 audit summary: ${auditSummaryPath}`)
  }
  const freezeResult = freezeResultPath ? await readJson(path.resolve(freezeResultPath), null) : null
  const resolvedTrainApplyDir = trainApplyDir ? path.resolve(trainApplyDir) : null
  const resolvedOosApplyDir = oosApplyDir ? path.resolve(oosApplyDir) : null
  const survivorRuleCount = toNumber(auditSummary?.survivorRuleCount, 0)
  if (survivorRuleCount > 0) {
    const requiredTrainDedupedPath = path.join(resolvedTrainApplyDir ?? "", "deduped_symbols.jsonl")
    const requiredOosDedupedPath = path.join(resolvedOosApplyDir ?? "", "deduped_symbols.jsonl")
    if (!resolvedTrainApplyDir || !pathExists(requiredTrainDedupedPath)) {
      throw new Error(`strict year2x7 replay is missing train apply output: ${requiredTrainDedupedPath}`)
    }
    if (!resolvedOosApplyDir || !pathExists(requiredOosDedupedPath)) {
      throw new Error(`strict year2x7 replay is missing oos apply output: ${requiredOosDedupedPath}`)
    }
  }
  const trainDedupedRows =
    survivorRuleCount > 0 && resolvedTrainApplyDir
      ? await readJsonl(path.join(resolvedTrainApplyDir, "deduped_symbols.jsonl"))
      : []
  const oosDedupedRows =
    survivorRuleCount > 0 && resolvedOosApplyDir
      ? await readJsonl(path.join(resolvedOosApplyDir, "deduped_symbols.jsonl"))
      : []
  const trainMetrics = buildTp12NoStopLb5Year2x7ReplayMetrics(trainDedupedRows)
  const oosMetrics = buildTp12NoStopLb5Year2x7ReplayMetrics(oosDedupedRows)
  const baselineMetrics = contract?.baselineMetrics ?? {}
  const status =
    survivorRuleCount < 1 ? "no_rules" : oosMetrics.selectedRows < 1 ? "no_oos_selection" : "measured"
  const summary = {
    kind: "tp12_no_stop_lb5_year2x7_replay_summary_v1",
    contractId: toText(contract?.contractId),
    contractPath: toText(contract?.contractPath),
    runId: toText(runId),
    status,
    baseCandidateId: toText(contract?.baseCandidateId),
    scopeId: toText(contract?.scopeId),
    lookbackTradingDays: toNumber(contract?.lookbackTradingDays, 0),
    coreYears: Array.isArray(contract?.yearCoverage?.coreYears) ? contract.yearCoverage.coreYears : [],
    minHitsPerCoreYear: toNumber(contract?.yearCoverage?.minHitsPerCoreYear, 0),
    baselineRunIds: contract?.baselineRunIds ?? null,
    audit: auditSummary,
    frozenSubset: {
      outPath: toText(freezeResult?.outPath) || null,
      catalogContentSha256: toText(freezeResult?.catalogContentSha256) || null,
      ruleIdsSha256: toText(freezeResult?.ruleIdsSha256) || null,
      survivorRuleCount,
    },
    train: trainMetrics,
    oos: oosMetrics,
    baseline: baselineMetrics,
    deltaVsBaseline: {
      oosSelectedRows: oosMetrics.selectedRows - toNumber(baselineMetrics?.oosSelectedRows, 0),
      oosHitRows: oosMetrics.hitRows - toNumber(baselineMetrics?.oosHitRows, 0),
      oosHitRate: oosMetrics.hitRate - toNumber(baselineMetrics?.oosHitRate, 0),
      oosUniqueMatchedDates: oosMetrics.uniqueMatchedDates - toNumber(baselineMetrics?.oosUniqueMatchedDates, 0),
      oosUniqueMatchedSymbols: oosMetrics.uniqueMatchedSymbols - toNumber(baselineMetrics?.oosUniqueMatchedSymbols, 0),
      oosTop1DateShare: oosMetrics.top1DateShare - toNumber(baselineMetrics?.oosTop1DateShare, 0),
    },
  }

  const reportLines = [
    "# TP12 No-Stop lb5 strict year2x7 replay",
    "",
    "## Contract",
    "",
    `- contractId: \`${summary.contractId}\``,
    `- runId: \`${summary.runId}\``,
    `- baseCandidateId: \`${summary.baseCandidateId}\``,
    `- scopeId: \`${summary.scopeId}\``,
    `- lookbackTradingDays: ${summary.lookbackTradingDays}`,
    `- coreYears: ${summary.coreYears.join(", ")}`,
    `- minHitsPerCoreYear: ${summary.minHitsPerCoreYear}`,
    "",
    "## Audit",
    "",
    `- survivor rules: ${summary.frozenSubset.survivorRuleCount}/${toNumber(summary.audit?.totalRuleCount, 0)} = ${pct(summary.audit?.survivorShare)}`,
    `- zero-core-year-hit rules: ${toNumber(summary.audit?.ruleIdsWithZeroCoreYearHits, 0)}`,
    `- below-target-but-nonzero rules: ${toNumber(summary.audit?.ruleIdsBelowTargetButNonZeroCoreYears, 0)}`,
    "",
    "## OOS",
    "",
    `- strict subset OOS: ${summary.oos.hitRows}/${summary.oos.selectedRows} = ${pct(summary.oos.hitRate)}`,
    `- baseline OOS: ${toNumber(summary.baseline?.oosHitRows, 0)}/${toNumber(summary.baseline?.oosSelectedRows, 0)} = ${pct(summary.baseline?.oosHitRate)}`,
    `- delta hit-rate: ${pct(summary.deltaVsBaseline.oosHitRate)}`,
    `- delta selected rows: ${summary.deltaVsBaseline.oosSelectedRows}`,
    `- delta unique dates: ${summary.deltaVsBaseline.oosUniqueMatchedDates}`,
    `- delta unique symbols: ${summary.deltaVsBaseline.oosUniqueMatchedSymbols}`,
    `- delta top1DateShare: ${pct(summary.deltaVsBaseline.oosTop1DateShare)}`,
    "",
    "## Train",
    "",
    `- strict subset train: ${summary.train.hitRows}/${summary.train.selectedRows} = ${pct(summary.train.hitRate)}`,
    "",
    `- status: \`${summary.status}\``,
    "",
  ]

  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required")
  }
  await ensureDir(path.dirname(resolvedOutPath))
  await writeJson(resolvedOutPath, summary)
  const reportPath = path.join(path.dirname(resolvedOutPath), "year2x7_replay_report.md")
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")
  return {
    outPath: resolvedOutPath,
    reportPath,
    summary,
  }
}
