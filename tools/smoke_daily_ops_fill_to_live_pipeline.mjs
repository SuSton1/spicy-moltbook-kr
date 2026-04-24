import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  buildDailyOpsSummary,
  DAILY_OPS_STATUS_COMPLETED,
  renderDailyOpsReportMarkdown,
  writeDailyOpsArtifacts,
} from "../src/lib/daily_ops_stack.mjs"
import { pathExists, readJson, readJsonl } from "../src/lib/io.mjs"

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daily-ops-smoke-"))
try {
  const outDir = path.join(tempRoot, "artifacts", "runs", "daily_ops_smoke")
  const fillSummary = {
    status: "completed_with_nontrading_status",
    latestCandleBefore: "2026-03-23",
    latestUniverseBefore: "2026-03-23",
    latestCandleAfter: "2026-03-24",
    latestUniverseAfter: "2026-03-24",
    latestWrittenDate: "2026-03-24",
    validCandleRows: 10,
    validUniverseRows: 10,
    nonTradingSymbolCount: 2,
    nonTradingRowCount: 2,
    fatalInvalidSymbolCount: 0,
    fatalInvalidRowCount: 0,
    auditPaths: {
      nonTradingStatus: "artifacts/data_quality/fill_nontrading.json",
      fatalInvalid: null,
    },
  }
  const liveSummary = {
    status: "completed",
    targetDate: "2026-03-24",
    candleLatestDate: "2026-03-24",
    universeLatestDate: "2026-03-24",
    latestCommonDate: "2026-03-24",
    finalUnionCount: 0,
    priorityCounts: { priority1: 0, priority2: 0, priority3: 0 },
    lineResults: [
      {
        priority: 1,
        lineId: "afree_primary",
        rawMatchedRows: 0,
        dedupedRows: 0,
        rowsWritten: 1200,
      },
    ],
  }
  const summary = buildDailyOpsSummary({
    status: DAILY_OPS_STATUS_COMPLETED,
    runId: "daily_ops_smoke",
    fill: {
      runId: "daily_ops_smoke_fill",
      exitCode: 0,
      summary: fillSummary,
    },
    live: {
      runId: "daily_ops_smoke_live",
      exitCode: 0,
      summary: liveSummary,
    },
    finalUnionRows: [],
    fillSummaryPath: path.join(outDir, "fill", "fill_summary.json"),
    liveSummaryPath: path.join(outDir, "live", "final_summary.json"),
    liveFinalUnionPath: path.join(outDir, "live", "final_union.jsonl"),
    dailyStatePath: path.join(tempRoot, "artifacts", "ops", "daily_ops_state", "latest_success.json"),
  })
  const report = renderDailyOpsReportMarkdown({ summary })
  assert.match(report, /nonTradingSymbolCount: 2/u)
  assert.match(report, /No symbols selected\./u)

  await writeDailyOpsArtifacts({
    outDir,
    summary,
    fillSummary,
    liveSummary,
    finalUnionRows: [],
  })

  assert.equal(pathExists(path.join(outDir, "fill", "fill_summary.json")), true)
  assert.equal(pathExists(path.join(outDir, "live", "final_summary.json")), true)
  assert.equal(pathExists(path.join(outDir, "live", "final_union.jsonl")), true)
  assert.equal(pathExists(path.join(outDir, "daily_ops_summary.json")), true)
  assert.equal(pathExists(path.join(outDir, "report.md")), true)

  const writtenSummary = await readJson(path.join(outDir, "daily_ops_summary.json"))
  const writtenFill = await readJson(path.join(outDir, "fill", "fill_summary.json"))
  const writtenLive = await readJson(path.join(outDir, "live", "final_summary.json"))
  const writtenUnion = await readJsonl(path.join(outDir, "live", "final_union.jsonl"))
  assert.equal(writtenSummary.status, DAILY_OPS_STATUS_COMPLETED)
  assert.equal(writtenFill.status, "completed_with_nontrading_status")
  assert.equal(writtenLive.status, "completed")
  assert.equal(writtenUnion.length, 0)

  console.log("ok smoke_daily_ops_fill_to_live_pipeline")
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
