import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, writeJson, writeJsonAtomic, writeJsonl } from "./io.mjs"

export const DAILY_OPS_SUMMARY_VERSION = 1
export const DAILY_OPS_STATUS_COMPLETED = "completed"
export const DAILY_OPS_STATUS_NOOP_ALREADY_PROCESSED = "noop_already_processed"
export const DAILY_OPS_STATUS_FAILED_FILL = "failed_fill"
export const DAILY_OPS_STATUS_FAILED_LIVE = "failed_live"
export const DAILY_OPS_STATUS_FAILED_RUNTIME = "failed_runtime"

const normalizeText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toCount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export const buildDailyOpsSummary = ({
  status,
  runId,
  targetDate = null,
  fill = null,
  live = null,
  failureReason = null,
  finalUnionRows = [],
  fillSummaryPath = null,
  liveSummaryPath = null,
  liveFinalUnionPath = null,
  dailyStatePath = null,
} = {}) => {
  const fillSummary = fill?.summary ?? null
  const liveSummary = live?.summary ?? null
  const lineResults = Array.isArray(liveSummary?.lineResults) ? liveSummary.lineResults : []
  return {
    version: DAILY_OPS_SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    status: normalizeText(status),
    runId: normalizeText(runId),
    targetDate:
      normalizeText(targetDate) ??
      normalizeText(liveSummary?.targetDate) ??
      normalizeText(fillSummary?.latestWrittenDate),
    failureReason: normalizeText(failureReason),
    fill: {
      runId: normalizeText(fill?.runId),
      exitCode: fill?.exitCode ?? null,
      summaryPath: normalizeText(fillSummaryPath),
      status: normalizeText(fillSummary?.status),
      latestCandleBefore: normalizeText(fillSummary?.latestCandleBefore),
      latestUniverseBefore: normalizeText(fillSummary?.latestUniverseBefore),
      latestCandleAfter: normalizeText(fillSummary?.latestCandleAfter),
      latestUniverseAfter: normalizeText(fillSummary?.latestUniverseAfter),
      latestWrittenDate: normalizeText(fillSummary?.latestWrittenDate),
      validCandleRows: toCount(fillSummary?.validCandleRows),
      validUniverseRows: toCount(fillSummary?.validUniverseRows),
      nonTradingSymbolCount: toCount(fillSummary?.nonTradingSymbolCount),
      nonTradingRowCount: toCount(fillSummary?.nonTradingRowCount),
      fatalInvalidSymbolCount: toCount(fillSummary?.fatalInvalidSymbolCount),
      fatalInvalidRowCount: toCount(fillSummary?.fatalInvalidRowCount),
      nonTradingPath: normalizeText(fillSummary?.nonTradingPath),
      auditPaths: fillSummary?.auditPaths ?? {},
      failureReason: normalizeText(fillSummary?.failureReason),
    },
    live: {
      runId: normalizeText(live?.runId),
      exitCode: live?.exitCode ?? null,
      summaryPath: normalizeText(liveSummaryPath),
      finalUnionPath: normalizeText(liveFinalUnionPath),
      status: normalizeText(liveSummary?.status),
      targetDate: normalizeText(liveSummary?.targetDate),
      candleLatestDate: normalizeText(liveSummary?.candleLatestDate),
      universeLatestDate: normalizeText(liveSummary?.universeLatestDate),
      latestCommonDate: normalizeText(liveSummary?.latestCommonDate),
      finalUnionCount: toCount(liveSummary?.finalUnionCount),
      priorityCounts: liveSummary?.priorityCounts ?? { priority1: 0, priority2: 0, priority3: 0 },
      lineResults,
      failureReason: normalizeText(liveSummary?.failureReason),
      lineFailure: liveSummary?.lineFailure ?? null,
    },
    finalUnionCount: Array.isArray(finalUnionRows) ? finalUnionRows.length : 0,
    finalUnionRows,
    dailyStatePath: normalizeText(dailyStatePath),
  }
}

export const renderDailyOpsReportMarkdown = ({ summary } = {}) => {
  const finalUnionRows = Array.isArray(summary?.finalUnionRows) ? summary.finalUnionRows : []
  const lineResults = Array.isArray(summary?.live?.lineResults) ? summary.live.lineResults : []
  const lines = [
    "# Daily Ops Report",
    "",
    `- status: ${summary?.status ?? "unknown"}`,
    `- runId: ${summary?.runId ?? "null"}`,
    `- targetDate: ${summary?.targetDate ?? "null"}`,
  ]
  if (summary?.failureReason) {
    lines.push(`- failureReason: ${summary.failureReason}`)
  }
  lines.push(
    "",
    "## Fill",
    "",
    `- status: ${summary?.fill?.status ?? "null"}`,
    `- exitCode: ${summary?.fill?.exitCode ?? "null"}`,
    `- latestCandleBefore: ${summary?.fill?.latestCandleBefore ?? "null"}`,
    `- latestUniverseBefore: ${summary?.fill?.latestUniverseBefore ?? "null"}`,
    `- latestCandleAfter: ${summary?.fill?.latestCandleAfter ?? "null"}`,
    `- latestUniverseAfter: ${summary?.fill?.latestUniverseAfter ?? "null"}`,
    `- latestWrittenDate: ${summary?.fill?.latestWrittenDate ?? "null"}`,
    `- validCandleRows: ${summary?.fill?.validCandleRows ?? 0}`,
    `- validUniverseRows: ${summary?.fill?.validUniverseRows ?? 0}`,
    `- nonTradingSymbolCount: ${summary?.fill?.nonTradingSymbolCount ?? 0}`,
    `- nonTradingRowCount: ${summary?.fill?.nonTradingRowCount ?? 0}`,
    `- fatalInvalidSymbolCount: ${summary?.fill?.fatalInvalidSymbolCount ?? 0}`,
    `- fatalInvalidRowCount: ${summary?.fill?.fatalInvalidRowCount ?? 0}`,
    `- summaryPath: ${summary?.fill?.summaryPath ?? "null"}`,
  )
  if (summary?.fill?.failureReason) {
    lines.push(`- fillFailureReason: ${summary.fill.failureReason}`)
  }
  lines.push(
    "",
    "## Live",
    "",
    `- status: ${summary?.live?.status ?? "not_run"}`,
    `- exitCode: ${summary?.live?.exitCode ?? "null"}`,
    `- targetDate: ${summary?.live?.targetDate ?? "null"}`,
    `- candleLatestDate: ${summary?.live?.candleLatestDate ?? "null"}`,
    `- universeLatestDate: ${summary?.live?.universeLatestDate ?? "null"}`,
    `- latestCommonDate: ${summary?.live?.latestCommonDate ?? "null"}`,
    `- finalUnionCount: ${summary?.live?.finalUnionCount ?? 0}`,
    `- priority1Count: ${summary?.live?.priorityCounts?.priority1 ?? 0}`,
    `- priority2Count: ${summary?.live?.priorityCounts?.priority2 ?? 0}`,
    `- priority3Count: ${summary?.live?.priorityCounts?.priority3 ?? 0}`,
    `- summaryPath: ${summary?.live?.summaryPath ?? "null"}`,
    `- finalUnionPath: ${summary?.live?.finalUnionPath ?? "null"}`,
  )
  if (summary?.live?.failureReason) {
    lines.push(`- liveFailureReason: ${summary.live.failureReason}`)
  }
  lines.push("", "## Lines", "")
  if (lineResults.length < 1) {
    lines.push("No live line results.")
  } else {
    lines.push("| priority | lineId | rawMatchedRows | dedupedRows | rowsWritten |")
    lines.push("| --- | --- | ---: | ---: | ---: |")
    for (const row of lineResults) {
      lines.push(
        `| ${row.priority ?? ""} | ${row.lineId ?? ""} | ${row.rawMatchedRows ?? 0} | ${row.dedupedRows ?? 0} | ${row.rowsWritten ?? 0} |`,
      )
    }
  }
  lines.push("", "## Final Union", "")
  if (finalUnionRows.length < 1) {
    lines.push("No symbols selected.")
  } else {
    lines.push("| priority | lineId | symbol | name | primaryRuleId |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const row of finalUnionRows) {
      lines.push(
        `| ${row.priority ?? ""} | ${row.lineId ?? ""} | ${row.symbol ?? ""} | ${row.name ?? ""} | ${row.primaryRuleId ?? ""} |`,
      )
    }
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

export const buildDailyOpsStatePayload = ({ summary }) => ({
  version: DAILY_OPS_SUMMARY_VERSION,
  updatedAt: new Date().toISOString(),
  status: normalizeText(summary?.status) ?? DAILY_OPS_STATUS_COMPLETED,
  lastSuccessfulTargetDate: normalizeText(summary?.targetDate),
  lastSuccessfulFillStatus: normalizeText(summary?.fill?.status),
  lastSuccessfulLiveStatus: normalizeText(summary?.live?.status),
  lastRunId: normalizeText(summary?.runId),
  lastFinalUnionCount: toCount(summary?.finalUnionCount),
})

export const writeDailyOpsArtifacts = async ({
  outDir,
  summary,
  fillSummary = null,
  liveSummary = null,
  finalUnionRows = [],
} = {}) => {
  const resolvedOutDir = path.resolve(String(outDir ?? "").trim())
  if (!resolvedOutDir) {
    throw new Error("writeDailyOpsArtifacts requires outDir")
  }
  const fillDir = path.join(resolvedOutDir, "fill")
  const liveDir = path.join(resolvedOutDir, "live")
  await ensureDir(fillDir)
  await ensureDir(liveDir)
  if (fillSummary) {
    await writeJson(path.join(fillDir, "fill_summary.json"), fillSummary)
  }
  await writeJson(path.join(liveDir, "final_summary.json"), liveSummary ?? { status: "not_run" })
  await writeJsonl(path.join(liveDir, "final_union.jsonl"), finalUnionRows)
  await writeJson(path.join(resolvedOutDir, "daily_ops_summary.json"), summary)
  await writeJson(path.join(resolvedOutDir, "report_summary.json"), {
    status: summary?.status ?? null,
    targetDate: summary?.targetDate ?? null,
    finalUnionCount: summary?.finalUnionCount ?? 0,
  })
  await writeJson(path.join(resolvedOutDir, "artifacts_manifest.json"), {
    fillSummaryPath: "fill/fill_summary.json",
    liveSummaryPath: "live/final_summary.json",
    liveFinalUnionPath: "live/final_union.jsonl",
    dailyOpsSummaryPath: "daily_ops_summary.json",
    reportPath: "report.md",
  })
  await fs.writeFile(path.join(resolvedOutDir, "report.md"), renderDailyOpsReportMarkdown({ summary }), "utf8")
}

export const writeDailyOpsReport = async ({ outDir, summary }) => {
  const resolvedOutDir = path.resolve(String(outDir ?? "").trim())
  await ensureDir(resolvedOutDir)
  const reportPath = path.join(resolvedOutDir, "report.md")
  await fs.writeFile(reportPath, renderDailyOpsReportMarkdown({ summary }), "utf8")
  return reportPath
}

export const writeDailyOpsState = async ({ statePath, summary }) => {
  const payload = buildDailyOpsStatePayload({ summary })
  await writeJsonAtomic(statePath, payload)
  return payload
}
