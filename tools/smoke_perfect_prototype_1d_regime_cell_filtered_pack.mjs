import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, writeJsonl } from "../src/lib/io.mjs"
import { filterPerfectPrototype1dRegimeCellPack } from "../src/lib/perfect_prototype_1d_regime_cell_pack_filter.mjs"

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "regime-cell-filter-"))
  const inputPath = path.join(tempRoot, "daily_pack.jsonl")
  await writeJsonl(inputPath, [
    {
      rowKey: "top1",
      dateKey: "2024-01-02",
      decisionDateKey: "2024-01-02",
      symbol: "000001",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP"],
    },
    {
      rowKey: "mid1",
      dateKey: "2024-01-03",
      decisionDateKey: "2024-01-03",
      symbol: "000002",
      outcomeHitTarget: false,
      contextualTokens: ["tag:xsec.closeRank:MID"],
    },
    {
      rowKey: "low1",
      dateKey: "2024-01-04",
      decisionDateKey: "2024-01-04",
      symbol: "000003",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:xsec.gapRank:TOP"],
    },
  ])

  const topOutDir = path.join(tempRoot, "top")
  const lowOutDir = path.join(tempRoot, "low")
  const topSummary = await filterPerfectPrototype1dRegimeCellPack({
    inputPath,
    outDir: topOutDir,
    cellId: "TOP_1D",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  const lowSummary = await filterPerfectPrototype1dRegimeCellPack({
    inputPath,
    outDir: lowOutDir,
    cellId: "LOW_1D",
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  const writtenTop = await readJson(path.join(topOutDir, "filter_summary.json"), null)
  const writtenLow = await readJson(path.join(lowOutDir, "filter_summary.json"), null)
  if (topSummary.matchedRows !== 1 || writtenTop?.matchedRows !== 1) {
    throw new Error("expected TOP_1D matchedRows=1 under open_eval_recent_impulse_1d")
  }
  if (topSummary.familyRowCounts?.top_close_recent !== 1 || writtenTop?.familyRowCounts?.top_close_recent !== 1) {
    throw new Error("expected TOP_1D top_close_recent family count=1")
  }
  if (lowSummary.familyRowCounts?.low_gap_top_continuation !== 1 || writtenLow?.familyRowCounts?.low_gap_top_continuation !== 1) {
    throw new Error("expected LOW_1D low_gap_top_continuation family count=1")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
