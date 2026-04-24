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

const formatDateKey = (date) => date.toISOString().slice(0, 10)

const prevDateKey = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return formatDateKey(date)
}

const buildPackRow = ({
  rowKey,
  dateKey,
  symbol,
  hit,
  foldId,
  windowId,
  jumpPct = 0,
  closeRetPct = 0,
  gapOpenPct = 0,
  tokens = [],
} = {}) => ({
  rowKey,
  sourceId: rowKey,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  symbol,
  outcomeHitTarget: hit,
  foldId,
  windowId,
  jumpPct,
  closeRetPct,
  gapOpenPct,
  categoricalTokens: tokens,
  contextualTokens: tokens,
  numericFeatureMap: {},
})

const buildCatalog = () =>
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
          ruleId: "PP_TOP",
          familyId: "top_bundle",
          tokens: ["tag:donor:top"],
          precision: 1,
        },
        {
          ruleId: "PP_MID",
          familyId: "mid_bundle",
          tokens: ["tag:donor:mid"],
          precision: 1,
        },
        {
          ruleId: "PP_LOW",
          familyId: "low_gap_top_continuation",
          tokens: ["tag:donor:low"],
          precision: 1,
        },
      ],
    },
    sourceRunId: "smoke_8d_top_mid_low_subgroup",
  })

const seedDates = [
  "2024-01-02",
  "2024-01-09",
  "2024-02-06",
  "2024-02-13",
  "2024-03-05",
  "2024-03-12",
  "2024-04-02",
  "2024-04-09",
  "2024-05-07",
  "2024-06-04",
]

const buildScopeRows = () => {
  const rows = []
  const candles = []
  const pushRow = (row) => {
    rows.push(row)
    candles.push(
      { symbol: row.symbol, dateKey: prevDateKey(row.dateKey), close: 100 },
      { symbol: row.symbol, dateKey: row.dateKey, close: 110 },
    )
  }
  seedDates.forEach((dateKey, index) => {
    const foldId = (index % 4) + 1
    const windowId = Math.floor(index / 3) + 1
    pushRow(
      buildPackRow({
        rowKey: `top_${index}`,
        dateKey,
        symbol: `10${String(index).padStart(4, "0")}`,
        hit: true,
        foldId,
        windowId,
        jumpPct: 0.09,
        closeRetPct: 0.08,
        gapOpenPct: 0.05,
        tokens: [
          "tag:donor:top",
          "tag:stepa.lane:same_day_high8",
          "tag:signal.scope:STACK_TOP",
          "tag:event.breakout:STRONG",
        ],
      }),
    )
    pushRow(
      buildPackRow({
        rowKey: `mid_${index}`,
        dateKey,
        symbol: `20${String(index).padStart(4, "0")}`,
        hit: true,
        foldId,
        windowId,
        jumpPct: 0.035,
        closeRetPct: 0.03,
        gapOpenPct: 0.02,
        tokens: [
          "tag:donor:mid",
          "tag:stepa.lane:recent_impulse_8d",
          "tag:signal.scope:STACK_MID",
          "tag:event.continuation:STEADY",
        ],
      }),
    )
    pushRow(
      buildPackRow({
        rowKey: `low_${index}`,
        dateKey,
        symbol: `30${String(index).padStart(4, "0")}`,
        hit: true,
        foldId,
        windowId,
        jumpPct: -0.015,
        closeRetPct: -0.02,
        gapOpenPct: -0.08,
        tokens: [
          "tag:donor:low",
          "tag:stepa.lane:recent_impulse_8d",
          "tag:signal.scope:STACK_LOW",
        ],
      }),
    )
  })
  for (let index = 0; index < 3; index += 1) {
    const dateKey = seedDates[index]
    pushRow(
      buildPackRow({
        rowKey: `noise_top_${index}`,
        dateKey,
        symbol: `40${String(index).padStart(4, "0")}`,
        hit: false,
        foldId: (index % 4) + 1,
        windowId: 1,
        jumpPct: 0.02,
        closeRetPct: 0.015,
        gapOpenPct: 0.01,
        tokens: ["tag:noise"],
      }),
    )
    pushRow(
      buildPackRow({
        rowKey: `noise_mid_${index}`,
        dateKey,
        symbol: `50${String(index).padStart(4, "0")}`,
        hit: false,
        foldId: (index % 4) + 1,
        windowId: 1,
        jumpPct: 0.01,
        closeRetPct: 0.005,
        gapOpenPct: 0.005,
        tokens: ["tag:noise"],
      }),
    )
    pushRow(
      buildPackRow({
        rowKey: `noise_low_${index}`,
        dateKey,
        symbol: `60${String(index).padStart(4, "0")}`,
        hit: false,
        foldId: (index % 4) + 1,
        windowId: 1,
        jumpPct: -0.005,
        closeRetPct: -0.01,
        gapOpenPct: -0.02,
        tokens: ["tag:noise"],
      }),
    )
  }
  return { rows, candles }
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "subgroup-8d-"))
  const scopeManifestPath = path.join(tempRoot, "scope_manifest.json")
  const catalogPath = path.join(tempRoot, "catalog.json")
  const trainInput = path.join(tempRoot, "train_pack.jsonl")
  const candlePath = path.join(tempRoot, "candle_daily.jsonl")
  const outDir = path.join(tempRoot, "out")
  const { rows, candles } = buildScopeRows()

  await writeJson(catalogPath, buildCatalog())
  await writeJsonl(trainInput, rows)
  await writeJsonl(candlePath, candles)
  await writeJson(scopeManifestPath, {
    version: 1,
    scopes: [
      {
        scopeId: "same_day_plus_recent_upto_8d__lb8",
        discoveryUniverseId: "same_day_plus_recent_upto_8d",
        lookbackTradingDays: 8,
        trainInput,
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
        catalogPath,
        scopeId: "same_day_plus_recent_upto_8d__lb8",
      },
    ],
  })

  await runNode(
    [
      "tools/build_perfect_prototype_8d_top_mid_low_subgroup_system.mjs",
      `--scope-manifest=${scopeManifestPath}`,
      `--out-dir=${outDir}`,
      `--candle-path=${candlePath}`,
    ],
    path.resolve(process.cwd()),
  )

  const rollup = await readJson(path.join(outDir, "subgroup_rollup.json"), null)
  const donorWitness = await readJson(path.join(outDir, "line_8d_primary_donor_witness.json"), null)
  const subgroupSystem = await readJson(path.join(outDir, "line_8d_primary_subgroup_system.json"), null)

  assert.equal(Number(rollup?.lineCount ?? 0), 1)
  assert.ok(Number(rollup?.totalSelectedManifests ?? 0) > 0)
  assert.ok(Number(donorWitness?.regimes?.TOP?.donorSelectedRows ?? 0) >= 10)
  assert.ok(Number(donorWitness?.lowSubtypeCounts?.low_gap_top_continuation ?? 0) >= 10)
  const selectedScopes = (subgroupSystem?.scopes ?? []).filter((scope) => Number(scope?.selectedManifestCount ?? 0) > 0)
  assert.ok(selectedScopes.length > 0)
  const lowSubtypeScope = (subgroupSystem?.scopes ?? []).find((scope) => scope?.scopeId === "LOW__low_gap_top_continuation")
  assert.ok(Number(lowSubtypeScope?.selectedManifestCount ?? 0) > 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
