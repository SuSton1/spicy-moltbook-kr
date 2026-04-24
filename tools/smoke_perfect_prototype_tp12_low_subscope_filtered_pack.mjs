import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, writeJsonl } from "../src/lib/io.mjs"
import { filterPerfectPrototypeTp12LowSubscopePack } from "../src/lib/perfect_prototype_tp12_low_subscope_filter.mjs"

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-low-subscope-filter-"))
  const inputPath = path.join(tempRoot, "daily_pack.jsonl")
  await writeJsonl(inputPath, [
    {
      rowKey: "gap_high",
      dateKey: "2024-01-02",
      decisionDateKey: "2024-01-02",
      symbol: "000001",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:xsec.gapRank:TOP"],
    },
    {
      rowKey: "gap_high",
      dateKey: "2024-01-03",
      decisionDateKey: "2024-01-03",
      symbol: "000002",
      outcomeHitTarget: false,
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:xsec.gapRank:HIGH"],
    },
    {
      rowKey: "jump_below",
      dateKey: "2024-01-04",
      decisionDateKey: "2024-01-04",
      symbol: "000003",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:xsec.jumpVsMedian:BELOW"],
    },
    {
      rowKey: "non_top",
      dateKey: "2024-01-09",
      decisionDateKey: "2024-01-09",
      symbol: "000006",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:MID", "tag:xsec.gapRank:TOP", "tag:xsec.gapRank:HIGH"],
    },
  ])

  const expectations = [
    ["LOW_GAP_TOP", 1],
    ["LOW_GAP_HIGH", 1],
    ["LOW_JUMP_BELOW", 1],
  ]
  for (const [subscopeId, expectedRows] of expectations) {
    const outDir = path.join(tempRoot, subscopeId.toLowerCase())
    const summary = await filterPerfectPrototypeTp12LowSubscopePack({
      inputPath,
      outDir,
      subscopeId,
      rowContract: "open_eval_recent_impulse_1d",
      requireNonEmpty: true,
    })
    const written = await readJson(path.join(outDir, "filter_summary.json"), null)
    if (summary.matchedRows !== expectedRows || written?.matchedRows !== expectedRows) {
      throw new Error(`expected ${subscopeId} matchedRows=${expectedRows}`)
    }
    if (written?.familyRowCounts?.[subscopeId === "LOW_GAP_TOP" ? "low_gap_top_continuation" : subscopeId === "LOW_GAP_HIGH" ? "low_gap_high_continuation" : "low_jump_below_continuation"] !== expectedRows) {
      throw new Error(`expected ${subscopeId} family row count=${expectedRows}`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
