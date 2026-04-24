#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"

const runNode = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const buildPackRow = ({
  rowKey,
  dateKey,
  symbol,
  hit,
  tokens = [],
} = {}) => ({
  rowKey,
  sourceId: rowKey,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  symbol,
  outcomeHitTarget: hit,
  categoricalTokens: tokens,
  contextualTokens: tokens,
  numericFeatureMap: {},
})

const buildCatalog = ({ ruleId, token }) =>
  applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v3_contextual_plus_lite",
        options: {
          includeCategoricalTokens: true,
        },
      },
      metadata: {},
      rules: [
        {
          ruleId,
          tokens: [token],
          precision: 1,
        },
      ],
    },
    sourceRunId: `smoke_${ruleId.toLowerCase()}`,
  })

const buildCandleRows = (pairs) =>
  pairs.flatMap(({ symbol, prevDateKey, dateKey, prevClose = 100, close = 110 }) => [
    { symbol, dateKey: prevDateKey, close: prevClose },
    { symbol, dateKey, close },
  ])

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "selection-contract-replay-"))
  const registryPath = path.join(tempRoot, "registry.json")
  const scopeManifestPath = path.join(tempRoot, "scope_manifest.json")
  const primaryCatalogPath = path.join(tempRoot, "primary_catalog.json")
  const secondaryCatalogPath = path.join(tempRoot, "secondary_catalog.json")
  const trainInput = path.join(tempRoot, "train_pack.jsonl")
  const oosInput = path.join(tempRoot, "oos_pack.jsonl")
  const recentInput = path.join(tempRoot, "recent_pack.jsonl")
  const candlePath = path.join(tempRoot, "candle_daily.jsonl")
  const outDir = path.join(tempRoot, "out")

  await writeJson(primaryCatalogPath, buildCatalog({ ruleId: "PP_PRIMARY", token: "tag:line:primary" }))
  await writeJson(
    secondaryCatalogPath,
    buildCatalog({ ruleId: "PP_SECONDARY", token: "tag:line:secondary" }),
  )

  await writeJsonl(trainInput, [
    buildPackRow({ rowKey: "t1", dateKey: "2024-01-02", symbol: "000001", hit: true, tokens: ["tag:line:primary", "tag:xsec.closeRank:TOP"] }),
    buildPackRow({ rowKey: "t2", dateKey: "2024-01-03", symbol: "000002", hit: true, tokens: ["tag:line:secondary", "tag:xsec.closeRank:MID"] }),
    buildPackRow({ rowKey: "t3", dateKey: "2024-01-04", symbol: "000003", hit: false, tokens: ["tag:noise"] }),
  ])
  await writeJsonl(oosInput, [
    buildPackRow({
      rowKey: "o1",
      dateKey: "2025-01-02",
      symbol: "000001",
      hit: true,
      tokens: ["tag:line:primary", "tag:line:secondary", "tag:xsec.closeRank:TOP", "tag:event.breakout:STRONG"],
    }),
    buildPackRow({
      rowKey: "o2",
      dateKey: "2025-01-03",
      symbol: "000002",
      hit: true,
      tokens: ["tag:line:secondary", "tag:xsec.closeRank:MID", "tag:event.continuation:STEADY"],
    }),
    buildPackRow({
      rowKey: "o3",
      dateKey: "2025-01-06",
      symbol: "000003",
      hit: true,
      tokens: ["tag:line:secondary", "tag:xsec.closeRank:LOW", "tag:xsec.gapRank:TOP"],
    }),
    buildPackRow({
      rowKey: "o4",
      dateKey: "2025-01-07",
      symbol: "000004",
      hit: true,
      tokens: ["tag:line:secondary", "tag:xsec.closeRank:LOW", "tag:xsec.gapRank:HIGH"],
    }),
    buildPackRow({
      rowKey: "o4b",
      dateKey: "2025-01-07",
      symbol: "000006",
      hit: true,
      tokens: ["tag:line:secondary", "tag:xsec.closeRank:LOW", "tag:xsec.gapRank:TOP"],
    }),
    buildPackRow({
      rowKey: "o5",
      dateKey: "2025-01-08",
      symbol: "000005",
      hit: false,
      tokens: ["tag:noise"],
    }),
  ])
  await writeJsonl(recentInput, [
    buildPackRow({ rowKey: "r1", dateKey: "2026-02-03", symbol: "000010", hit: true, tokens: ["tag:line:primary"] }),
    buildPackRow({ rowKey: "r2", dateKey: "2026-03-10", symbol: "000011", hit: true, tokens: ["tag:line:primary"] }),
  ])
  await writeJsonl(
    candlePath,
    buildCandleRows([
      { symbol: "000001", prevDateKey: "2025-01-01", dateKey: "2025-01-02" },
      { symbol: "000002", prevDateKey: "2025-01-02", dateKey: "2025-01-03" },
      { symbol: "000003", prevDateKey: "2025-01-03", dateKey: "2025-01-06" },
      { symbol: "000004", prevDateKey: "2025-01-06", dateKey: "2025-01-07" },
      { symbol: "000006", prevDateKey: "2025-01-06", dateKey: "2025-01-07" },
      { symbol: "000005", prevDateKey: "2025-01-07", dateKey: "2025-01-08" },
      { symbol: "000010", prevDateKey: "2026-02-02", dateKey: "2026-02-03" },
      { symbol: "000011", prevDateKey: "2026-03-09", dateKey: "2026-03-10" },
      { symbol: "000001", prevDateKey: "2024-01-01", dateKey: "2024-01-02" },
      { symbol: "000002", prevDateKey: "2024-01-02", dateKey: "2024-01-03" },
      { symbol: "000003", prevDateKey: "2024-01-03", dateKey: "2024-01-04" },
    ]),
  )

  await writeJson(registryPath, {
    registryId: "smoke_v61r_registry",
  })
  await writeJson(scopeManifestPath, {
    version: 1,
    scopes: [
      {
        scopeId: "same_day_plus_recent_upto_8d__lb8",
        discoveryUniverseId: "same_day_plus_recent_upto_8d",
        lookbackTradingDays: 8,
        trainInput,
        oosInput,
        recentInput,
      },
    ],
    lines: [
      {
        lineId: "8d_primary",
        priority: 1,
        lineOrder: 40,
        lineRole: "same_day_plus_recent_primary_subset",
        status: "active",
        reportLabel: "8D Primary",
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogLabel: "dual80_recent80_live0323_v1",
        catalogPath: primaryCatalogPath,
        scopeId: "same_day_plus_recent_upto_8d__lb8",
      },
      {
        lineId: "8d_secondary",
        priority: 2,
        lineOrder: 140,
        lineRole: "same_day_plus_recent_secondary_subset",
        status: "active",
        reportLabel: "8D Secondary",
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogLabel: "second_priority_hitge4_100pct_daydedup_live0323_v1",
        catalogPath: secondaryCatalogPath,
        scopeId: "same_day_plus_recent_upto_8d__lb8",
      },
    ],
  })

  await runNode(
    [
      "tools/build_live_priority_selection_contract_report.mjs",
      `--registry=${registryPath}`,
      `--scope-manifest=${scopeManifestPath}`,
      `--out-dir=${outDir}`,
      `--candle-path=${candlePath}`,
    ],
    path.resolve(process.cwd()),
  )

  const rollup = await readJson(path.join(outDir, "selection_contract_rollup.json"), null)
  const primaryVerdict = await readJson(path.join(outDir, "line_8d_primary_contract_verdict.json"), null)
  const secondaryVerdict = await readJson(path.join(outDir, "line_8d_secondary_contract_verdict.json"), null)
  const secondaryContractReplay = await readJson(path.join(outDir, "line_8d_secondary_contract_oos_replay_summary.json"), null)
  const ownership = await readJson(path.join(outDir, "ownership_aware_summary.json"), null)

  assert.equal(Number(rollup?.lineCount ?? 0), 2)
  assert.equal(primaryVerdict?.satisfied, true)
  assert.equal(secondaryVerdict?.satisfied, true)
  assert.equal(secondaryVerdict?.evaluationSelectionMode, "top1_per_day_union")
  assert.equal(Number(secondaryVerdict?.rawLineSelectedRows ?? 0), 5)
  assert.equal(Number(secondaryVerdict?.actualSelectedRows ?? 0), 4)
  assert.equal(Number(secondaryVerdict?.actualHitDateCount ?? 0), 4)
  assert.equal(Number(secondaryContractReplay?.dedupedSummary?.selectedRowCount ?? 0), 4)
  assert.equal(Number(ownership?.finalUnionCount ?? 0), 5)
  const secondaryOwnership = (ownership?.lineOwnership ?? []).find((entry) => entry?.lineId === "8d_secondary")
  assert.equal(Number(secondaryOwnership?.owned?.selectedRows ?? 0), 4)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
