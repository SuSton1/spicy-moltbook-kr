import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

const runNode = ({ cwd, env, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "live-priority-merge-"))
  const outDir = path.join(tempRoot, "out")
  const manifestPath = path.join(tempRoot, "line_results_manifest.json")
  const primaryDir = path.join(tempRoot, "line_primary")
  const secondaryDir = path.join(tempRoot, "line_secondary")
  const shadowDir = path.join(tempRoot, "line_shadow")
  const primaryCatalogPath = path.join(tempRoot, "artifacts", "curated", "frozen", "primary", "catalog.json")
  const secondaryCatalogPath = path.join(tempRoot, "artifacts", "curated", "frozen", "secondary", "catalog.json")
  const shadowCatalogPath = path.join(tempRoot, "artifacts", "curated", "frozen", "shadow", "catalog.json")

  await writeJson(primaryCatalogPath, { version: 1, rules: [] })
  await writeJson(secondaryCatalogPath, { version: 1, rules: [] })
  await writeJson(shadowCatalogPath, { version: 1, rules: [] })
  await writeJson(path.join(primaryDir, "pack_summary.json"), { rowsWritten: 86, uniqueSymbols: 86 })
  await writeJson(path.join(primaryDir, "apply_summary.json"), { rawMatchedRows: 1, dedupedMatches: 1 })
  await writeJsonl(path.join(primaryDir, "deduped_symbols.jsonl"), [
    {
      recommendationDateKey: "2026-03-23",
      symbol: "123456",
      name: "Alpha",
      matchedRuleIds: ["PP_ALPHA"],
      primaryRuleId: "PP_ALPHA",
    },
  ])

  await writeJson(path.join(secondaryDir, "pack_summary.json"), { rowsWritten: 140, uniqueSymbols: 140 })
  await writeJson(path.join(secondaryDir, "apply_summary.json"), { rawMatchedRows: 2, dedupedMatches: 2 })
  await writeJsonl(path.join(secondaryDir, "deduped_symbols.jsonl"), [
    {
      recommendationDateKey: "2026-03-23",
      symbol: "123456",
      name: "Alpha",
      matchedRuleIds: ["PP_BETA"],
      primaryRuleId: "PP_BETA",
    },
    {
      recommendationDateKey: "2026-03-23",
      symbol: "654321",
      name: "Beta",
      matchedRuleIds: ["PP_GAMMA"],
      primaryRuleId: "PP_GAMMA",
    },
  ])
  await writeJson(path.join(shadowDir, "pack_summary.json"), { rowsWritten: 21, uniqueSymbols: 21 })
  await writeJson(path.join(shadowDir, "apply_summary.json"), { rawMatchedRows: 1, dedupedMatches: 1 })
  await writeJsonl(path.join(shadowDir, "deduped_symbols.jsonl"), [
    {
      recommendationDateKey: "2026-03-23",
      symbol: "999999",
      name: "Shadow",
      matchedRuleIds: ["PP_DELTA"],
      primaryRuleId: "PP_DELTA",
    },
  ])

  await writeJson(manifestPath, {
    version: 1,
    runId: "smoke_merge_live_priority_results",
    targetDate: "2026-03-23",
    candleLatestDate: "2026-03-23",
    universeLatestDate: "2026-03-23",
    latestCommonDate: "2026-03-23",
    registryId: "smoke_registry",
    registryPath: path.join(tempRoot, "config", "ops", "live_priority_registry.server.json"),
    registrySha256: "e".repeat(64),
    lines: [
      {
        lineId: "1d_primary",
        priority: 1,
        lineOrder: 20,
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        catalogLabel: "primary_catalog",
        catalogPath: primaryCatalogPath,
        discoveryUniverseId: "same_day_plus_recent_upto_1d",
        lookbackTradingDays: 1,
        runId: "smoke_line_primary",
        packSummaryPath: path.join(primaryDir, "pack_summary.json"),
        applySummaryPath: path.join(primaryDir, "apply_summary.json"),
        dedupedInputPath: path.join(primaryDir, "deduped_symbols.jsonl"),
      },
      {
        lineId: "1d_secondary",
        priority: 2,
        lineOrder: 120,
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        catalogLabel: "secondary_catalog",
        catalogPath: secondaryCatalogPath,
        discoveryUniverseId: "same_day_plus_recent_upto_1d",
        lookbackTradingDays: 1,
        runId: "smoke_line_secondary",
        packSummaryPath: path.join(secondaryDir, "pack_summary.json"),
        applySummaryPath: path.join(secondaryDir, "apply_summary.json"),
        dedupedInputPath: path.join(secondaryDir, "deduped_symbols.jsonl"),
      },
      {
        lineId: "1d_mid_recent_shadow",
        priority: 3,
        lineOrder: 220,
        lineRole: "shadow",
        runnerType: "plus_lite_recent_mid_low",
        selectionMode: "union_all",
        catalogLabel: "shadow_catalog",
        catalogPath: shadowCatalogPath,
        discoveryUniverseId: "recent_impulse_upto_1d",
        lookbackTradingDays: 1,
        runId: "smoke_line_shadow",
        packSummaryPath: path.join(shadowDir, "pack_summary.json"),
        applySummaryPath: path.join(shadowDir, "apply_summary.json"),
        dedupedInputPath: path.join(shadowDir, "deduped_symbols.jsonl"),
      },
    ],
  })

  await runNode({
    cwd: tempRoot,
    env: {
      ...process.env,
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
    },
    args: [
      path.join(path.dirname(new URL(import.meta.url).pathname), "merge_live_priority_results.mjs"),
      `--manifest=${manifestPath}`,
      `--out-dir=${outDir}`,
    ],
  })

  const finalUnion = await readJsonl(path.join(outDir, "final_union.jsonl"))
  const finalSummary = await readJson(path.join(outDir, "final_summary.json"), null)

  assert.equal(finalUnion.length, 3)
  assert.equal(finalUnion[0].symbol, "123456")
  assert.equal(finalUnion[0].priority, 1)
  assert.equal(finalUnion[0].lineId, "1d_primary")
  assert.equal(finalUnion[0].supportingLines.length, 1)
  assert.equal(finalUnion[0].supportingLines[0].lineId, "1d_secondary")
  assert.equal(finalSummary?.finalUnionCount, 3)
  assert.equal(finalSummary?.priorityCounts?.priority1, 1)
  assert.equal(finalSummary?.priorityCounts?.priority2, 1)
  assert.equal(finalSummary?.priorityCounts?.priority3, 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
