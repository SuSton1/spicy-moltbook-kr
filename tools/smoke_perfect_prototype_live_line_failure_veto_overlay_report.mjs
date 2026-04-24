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
  score = 0.5,
  risk = 0.2,
} = {}) => ({
  rowKey,
  sourceId: rowKey,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  symbol,
  outcomeHitTarget: hit,
  categoricalTokens: tokens,
  contextualTokens: tokens,
  numericFeatureMap: {
    score,
    risk,
  },
})

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-report-"))
  const registryPath = path.join(tempRoot, "registry.json")
  const scopeManifestPath = path.join(tempRoot, "scope_manifest.json")
  const catalogPath = path.join(tempRoot, "catalog.json")
  const trainInput = path.join(tempRoot, "train_pack.jsonl")
  const oosInput = path.join(tempRoot, "oos_pack.jsonl")
  const candlePath = path.join(tempRoot, "candle_daily.jsonl")
  const outDir = path.join(tempRoot, "out")

  const frozenCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
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
          ruleId: "PP_ALPHA",
          tokens: ["tag:test:alpha"],
          precision: 1,
        },
        {
          ruleId: "PP_BETA",
          tokens: ["tag:test:beta"],
          precision: 0.8,
        },
      ],
    },
    sourceRunId: "smoke_v60b_overlay",
  })

  await writeJson(catalogPath, frozenCatalog)
  await writeJsonl(trainInput, [
    buildPackRow({ rowKey: "t1", dateKey: "2024-01-02", symbol: "000001", hit: true, tokens: ["tag:test:alpha"], score: 0.9, risk: 0.2 }),
    buildPackRow({ rowKey: "t2", dateKey: "2024-01-03", symbol: "000002", hit: true, tokens: ["tag:test:alpha"], score: 0.92, risk: 0.2 }),
    buildPackRow({ rowKey: "t3", dateKey: "2024-01-04", symbol: "000003", hit: true, tokens: ["tag:test:alpha"], score: 0.91, risk: 0.21 }),
    buildPackRow({ rowKey: "t4", dateKey: "2024-01-05", symbol: "000004", hit: true, tokens: ["tag:test:alpha"], score: 0.93, risk: 0.22 }),
    buildPackRow({ rowKey: "t5", dateKey: "2024-01-08", symbol: "000005", hit: false, tokens: ["tag:test:beta", "tag:bad:risk"], score: 0.4, risk: 0.9 }),
    buildPackRow({ rowKey: "t6", dateKey: "2024-01-09", symbol: "000006", hit: false, tokens: ["tag:test:beta", "tag:bad:risk"], score: 0.38, risk: 0.88 }),
  ])
  await writeJsonl(oosInput, [
    buildPackRow({ rowKey: "o1", dateKey: "2025-01-02", symbol: "000001", hit: true, tokens: ["tag:test:alpha"], score: 0.94, risk: 0.2 }),
    buildPackRow({ rowKey: "o2", dateKey: "2025-01-03", symbol: "000002", hit: false, tokens: ["tag:test:beta", "tag:bad:risk"], score: 0.35, risk: 0.91 }),
    buildPackRow({ rowKey: "o3", dateKey: "2025-01-06", symbol: "000003", hit: true, tokens: ["tag:test:alpha"], score: 0.95, risk: 0.22 }),
  ])
  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2025-01-01", close: 100 },
    { symbol: "000001", dateKey: "2025-01-02", close: 105 },
    { symbol: "000002", dateKey: "2025-01-02", close: 100 },
    { symbol: "000002", dateKey: "2025-01-03", close: 140 },
    { symbol: "000003", dateKey: "2025-01-03", close: 100 },
    { symbol: "000003", dateKey: "2025-01-06", close: 110 },
    { symbol: "000001", dateKey: "2024-01-01", close: 100 },
    { symbol: "000001", dateKey: "2024-01-02", close: 103 },
    { symbol: "000002", dateKey: "2024-01-02", close: 100 },
    { symbol: "000002", dateKey: "2024-01-03", close: 103 },
    { symbol: "000003", dateKey: "2024-01-03", close: 100 },
    { symbol: "000003", dateKey: "2024-01-04", close: 102 },
    { symbol: "000004", dateKey: "2024-01-04", close: 100 },
    { symbol: "000004", dateKey: "2024-01-05", close: 102 },
    { symbol: "000005", dateKey: "2024-01-05", close: 100 },
    { symbol: "000005", dateKey: "2024-01-08", close: 135 },
    { symbol: "000006", dateKey: "2024-01-08", close: 100 },
    { symbol: "000006", dateKey: "2024-01-09", close: 138 },
  ])
  await writeJson(registryPath, {
    registryId: "smoke_registry_v60b",
  })
  await writeJson(scopeManifestPath, {
    scopes: [
      {
        scopeId: "same_day_plus_recent_upto_1d__lb1",
        discoveryUniverseId: "same_day_plus_recent_upto_1d",
        lookbackTradingDays: 1,
        trainInput,
        oosInput,
      },
    ],
    lines: [
      {
        lineId: "1d_primary",
        priority: 1,
        reportLabel: "1D Primary",
        runnerType: "plus_lite_same_day_recent",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogPath,
        scopeId: "same_day_plus_recent_upto_1d__lb1",
      },
    ],
  })

  await runNode(
    [
      "tools/build_perfect_prototype_live_line_failure_veto_overlay_report.mjs",
      `--registry=${registryPath}`,
      `--scope-manifest=${scopeManifestPath}`,
      `--out-dir=${outDir}`,
      `--candle-path=${candlePath}`,
    ],
    path.resolve(process.cwd()),
  )

  const rollup = await readJson(path.join(outDir, "overlay_rollup.json"), null)
  const overlayReport = await readJson(path.join(outDir, "line_1d_primary_overlay_oos_report.json"), null)
  assert.equal(Number(rollup?.lineCount ?? 0), 1)
  assert.equal(Number(overlayReport?.operatingBenchmark?.positiveOnly?.selectedRows ?? 0), 2)
  assert.ok(Number(overlayReport?.operatingBenchmark?.positivePlusFailurePlusVeto?.precision ?? 0) >= Number(overlayReport?.operatingBenchmark?.positiveOnly?.precision ?? 0))
  assert.equal(overlayReport?.exactOnlyBenchmark?.sameAsOperating, undefined)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
