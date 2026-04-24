import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, writeJsonl } from "../src/lib/io.mjs"
import { filterPerfectPrototypeTp12TopSubscopePack } from "../src/lib/perfect_prototype_tp12_top_subscope_filter.mjs"

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-top-subscope-filter-"))
  const inputPath = path.join(tempRoot, "daily_pack.jsonl")
  await writeJsonl(inputPath, [
    {
      rowKey: "gap_high",
      dateKey: "2024-01-02",
      decisionDateKey: "2024-01-02",
      symbol: "000001",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP", "tag:xsec.gapRank:HIGH"],
    },
    {
      rowKey: "close_above",
      dateKey: "2024-01-03",
      decisionDateKey: "2024-01-03",
      symbol: "000002",
      outcomeHitTarget: false,
      contextualTokens: ["tag:xsec.closeRank:TOP", "tag:xsec.closeVsMedian:ABOVE"],
    },
    {
      rowKey: "jump_above",
      dateKey: "2024-01-04",
      decisionDateKey: "2024-01-04",
      symbol: "000003",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP", "tag:xsec.jumpVsMedian:ABOVE"],
    },
    {
      rowKey: "crowding_high",
      dateKey: "2024-01-05",
      decisionDateKey: "2024-01-05",
      symbol: "000004",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP", "tag:market.crowding:HIGH"],
    },
    {
      rowKey: "crowding_low",
      dateKey: "2024-01-08",
      decisionDateKey: "2024-01-08",
      symbol: "000005",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:TOP", "tag:market.crowding:LOW"],
    },
    {
      rowKey: "non_top",
      dateKey: "2024-01-09",
      decisionDateKey: "2024-01-09",
      symbol: "000006",
      outcomeHitTarget: true,
      contextualTokens: ["tag:xsec.closeRank:MID", "tag:xsec.gapRank:TOP", "tag:xsec.closeVsMedian:ABOVE"],
    },
  ])

  const expectations = [
    ["TOP_RECENT_GAP_TOPHIGH", 1],
    ["TOP_RECENT_CLOSE_ABOVE", 1],
    ["TOP_RECENT_JUMP_ABOVE", 1],
    ["TOP_RECENT_CROWDING_HIGH", 1],
    ["TOP_RECENT_CROWDING_LOWMID", 1],
  ]
  for (const [subscopeId, expectedRows] of expectations) {
    const outDir = path.join(tempRoot, subscopeId.toLowerCase())
    const summary = await filterPerfectPrototypeTp12TopSubscopePack({
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
    if (written?.familyRowCounts?.top_close_recent !== expectedRows) {
      throw new Error(`expected ${subscopeId} familyRowCounts.top_close_recent=${expectedRows}`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
