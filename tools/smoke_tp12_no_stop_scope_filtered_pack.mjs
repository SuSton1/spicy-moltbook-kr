#!/usr/bin/env node
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, writeJsonl } from "../src/lib/io.mjs"
import { filterTp12NoStopScopePack } from "../src/lib/tp12_no_stop_scope_filter.mjs"

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-scope-filter-"))
  const inputPath = path.join(tempRoot, "daily_pack.jsonl")
  await writeJsonl(inputPath, [
    {
      rowKey: "low_gap_top",
      dateKey: "2024-01-02",
      decisionDateKey: "2024-01-02",
      symbol: "000001",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:xsec.gapRank:TOP"],
    },
    {
      rowKey: "mid",
      dateKey: "2024-01-03",
      decisionDateKey: "2024-01-03",
      symbol: "000002",
      outcomeHitTarget: false,
      contextualTokens: ["tag:xsec.closeRank:MID"],
    },
    {
      rowKey: "top",
      dateKey: "2024-01-04",
      decisionDateKey: "2024-01-04",
      symbol: "000003",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP"],
    },
  ])

  const lowGapTopOutDir = path.join(tempRoot, "low_gap_top")
  const lowOutDir = path.join(tempRoot, "low")
  const midOutDir = path.join(tempRoot, "mid")
  const topOutDir = path.join(tempRoot, "top")

  const lowGapTopSummary = await filterTp12NoStopScopePack({
    inputPath,
    outDir: lowGapTopOutDir,
    scopeId: "LOW_GAP_TOP",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  const lowSummary = await filterTp12NoStopScopePack({
    inputPath,
    outDir: lowOutDir,
    scopeId: "LOW",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  const midSummary = await filterTp12NoStopScopePack({
    inputPath,
    outDir: midOutDir,
    scopeId: "MID",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  const topSummary = await filterTp12NoStopScopePack({
    inputPath,
    outDir: topOutDir,
    scopeId: "TOP",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })

  const writtenLow = await readJson(path.join(lowOutDir, "filter_summary.json"), null)
  if (lowGapTopSummary.matchedRows !== 1) {
    throw new Error("expected LOW_GAP_TOP matchedRows=1")
  }
  if (lowSummary.matchedRows !== 1 || writtenLow?.scopeId !== "LOW") {
    throw new Error("expected LOW scope filter to persist scopeId=LOW and matchedRows=1")
  }
  if (midSummary.familyRowCounts?.mid_close_continuation !== 1) {
    throw new Error("expected MID family count=1")
  }
  if (topSummary.familyRowCounts?.top_close_recent !== 1) {
    throw new Error("expected TOP family count=1")
  }
  console.log("ok smoke_tp12_no_stop_scope_filtered_pack")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
