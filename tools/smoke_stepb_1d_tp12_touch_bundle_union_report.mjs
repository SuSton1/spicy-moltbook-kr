#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"

const runNode = (args, cwd, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const buildPackRow = ({ rowKey, dateKey, symbol, tokens = [] } = {}) => ({
  rowKey,
  sourceId: rowKey,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  symbol,
  decisionIdx: 0,
  outcomeHitTarget: false,
  categoricalTokens: tokens,
  contextualTokens: tokens,
  numericFeatureMap: {},
})

const buildPositiveSeries = ({ symbol, decisionDateKey, entryDateKey, followDateKey, exitDateKey }) => [
  { symbol, dateKey: decisionDateKey, open: 95, high: 99, low: 90, close: 96 },
  { symbol, dateKey: entryDateKey, open: 100, high: 114, low: 96, close: 111 },
  { symbol, dateKey: followDateKey, open: 111, high: 113, low: 105, close: 110 },
  { symbol, dateKey: exitDateKey, open: 109, high: 111, low: 103, close: 107 },
]

const buildNegativeSeries = ({ symbol, decisionDateKey, entryDateKey, followDateKey, exitDateKey }) => [
  { symbol, dateKey: decisionDateKey, open: 95, high: 99, low: 90, close: 96 },
  { symbol, dateKey: entryDateKey, open: 100, high: 108, low: 97, close: 102 },
  { symbol, dateKey: followDateKey, open: 102, high: 106, low: 98, close: 101 },
  { symbol, dateKey: exitDateKey, open: 101, high: 107, low: 96, close: 98 },
]

const buildCatalog = () =>
  applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        version: 2,
        surface: "v3_contextual_plus_lite",
        numericFeatures: [],
        options: {
          includeCategoricalTokens: true,
          includeSymbolToken: false,
          binCount: 5,
          enableIntervalAtoms: false,
          enableMacroAtoms: false,
          enableSupportAnchorAtoms: false,
          enableSupportManifoldSignature: false,
          enableSupportMetricFeatures: false,
          enableAdaptiveThresholdAtoms: false,
        },
      },
      metadata: {
        selectionMode: "union_all",
        selectionLineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
      },
      rules: [
        {
          ruleId: "RULE_A",
          familyId: "low_gap_top_continuation",
          tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a"],
          precision: 1,
        },
        {
          ruleId: "RULE_B",
          familyId: "low_gap_top_continuation",
          tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:b"],
          precision: 1,
        },
        {
          ruleId: "RULE_C",
          familyId: "low_gap_top_continuation",
          tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:c"],
          precision: 1,
        },
      ],
    },
    sourceRunId: "smoke_tp12_touch_bundle_union",
    selectionMode: "union_all",
    selectionLineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
    selectionSurface: "v3_contextual_plus_lite",
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-touch-bundle-union-"))
  const dataDir = path.join(tempRoot, "data")
  const runId = "scope_gap_top"
  const runDir = path.join(tempRoot, "artifacts", "runs", runId)
  const trainPackDir = path.join(runDir, "step-perfect-prototype-open-train-pack")
  const oosPackDir = path.join(runDir, "step-perfect-prototype-open-oos-pack")
  const evalDir = path.join(runDir, "step-perfect-prototype-open-eval-report")
  const trainDir = path.join(runDir, "step-perfect-prototype-train")
  const outDir = path.join(tempRoot, "artifacts", "runs", "parent", "step-perfect-prototype-1d-tp12-touch-bundle-union-report")
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(trainPackDir, { recursive: true }),
    fs.mkdir(oosPackDir, { recursive: true }),
    fs.mkdir(evalDir, { recursive: true }),
    fs.mkdir(trainDir, { recursive: true }),
    fs.mkdir(outDir, { recursive: true }),
  ])

  const catalogPath = path.join(trainDir, "catalog.json")
  await writeJson(catalogPath, buildCatalog())
  await writeJson(path.join(runDir, "freeze_result.json"), { outPath: catalogPath })
  await writeJson(path.join(evalDir, "open_eval_manifest.json"), {
    lineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
    selectionMode: "union_all",
  })

  const trainRows = [
    buildPackRow({ rowKey: "t1", dateKey: "2020-11-27", symbol: "T001", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a", "tag:extra:b"] }),
    buildPackRow({ rowKey: "t2", dateKey: "2021-02-01", symbol: "T002", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a"] }),
    buildPackRow({ rowKey: "t3", dateKey: "2021-08-02", symbol: "T003", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:b"] }),
    buildPackRow({ rowKey: "t4", dateKey: "2021-12-03", symbol: "T004", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:b", "tag:extra:c"] }),
    buildPackRow({ rowKey: "t5", dateKey: "2022-04-11", symbol: "T005", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:c"] }),
    buildPackRow({ rowKey: "t6", dateKey: "2022-12-13", symbol: "T006", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a", "tag:extra:c"] }),
    buildPackRow({ rowKey: "t7", dateKey: "2023-05-02", symbol: "T007", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
    buildPackRow({ rowKey: "t8", dateKey: "2023-08-16", symbol: "T008", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
    buildPackRow({ rowKey: "t9", dateKey: "2024-01-03", symbol: "T009", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
    buildPackRow({ rowKey: "t10", dateKey: "2024-12-20", symbol: "T010", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
  ]
  const oosRows = [
    buildPackRow({ rowKey: "o1", dateKey: "2025-01-02", symbol: "O001", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a", "tag:extra:b"] }),
    buildPackRow({ rowKey: "o2", dateKey: "2025-04-02", symbol: "O002", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:b", "tag:extra:c"] }),
    buildPackRow({ rowKey: "o3", dateKey: "2025-08-04", symbol: "O003", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:extra:a", "tag:extra:c"] }),
    buildPackRow({ rowKey: "o4", dateKey: "2025-11-17", symbol: "O004", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
    buildPackRow({ rowKey: "o5", dateKey: "2025-12-09", symbol: "O005", tokens: ["tag:scope:gap_top", "tag:shape:reclaim", "tag:veto:bad"] }),
  ]
  await writeJsonl(path.join(trainPackDir, "daily_pack.jsonl"), trainRows)
  await writeJsonl(path.join(oosPackDir, "daily_pack.jsonl"), oosRows)

  const candleRows = [
    ...buildPositiveSeries({ symbol: "T001", decisionDateKey: "2020-11-27", entryDateKey: "2020-11-30", followDateKey: "2020-12-01", exitDateKey: "2020-12-02" }),
    ...buildPositiveSeries({ symbol: "T002", decisionDateKey: "2021-02-01", entryDateKey: "2021-02-02", followDateKey: "2021-02-03", exitDateKey: "2021-02-04" }),
    ...buildPositiveSeries({ symbol: "T003", decisionDateKey: "2021-08-02", entryDateKey: "2021-08-03", followDateKey: "2021-08-04", exitDateKey: "2021-08-05" }),
    ...buildPositiveSeries({ symbol: "T004", decisionDateKey: "2021-12-03", entryDateKey: "2021-12-06", followDateKey: "2021-12-07", exitDateKey: "2021-12-08" }),
    ...buildPositiveSeries({ symbol: "T005", decisionDateKey: "2022-04-11", entryDateKey: "2022-04-12", followDateKey: "2022-04-13", exitDateKey: "2022-04-14" }),
    ...buildPositiveSeries({ symbol: "T006", decisionDateKey: "2022-12-13", entryDateKey: "2022-12-14", followDateKey: "2022-12-15", exitDateKey: "2022-12-16" }),
    ...buildNegativeSeries({ symbol: "T007", decisionDateKey: "2023-05-02", entryDateKey: "2023-05-03", followDateKey: "2023-05-04", exitDateKey: "2023-05-05" }),
    ...buildNegativeSeries({ symbol: "T008", decisionDateKey: "2023-08-16", entryDateKey: "2023-08-17", followDateKey: "2023-08-18", exitDateKey: "2023-08-21" }),
    ...buildNegativeSeries({ symbol: "T009", decisionDateKey: "2024-01-03", entryDateKey: "2024-01-04", followDateKey: "2024-01-05", exitDateKey: "2024-01-08" }),
    ...buildNegativeSeries({ symbol: "T010", decisionDateKey: "2024-12-20", entryDateKey: "2024-12-23", followDateKey: "2024-12-24", exitDateKey: "2024-12-26" }),
    ...buildPositiveSeries({ symbol: "O001", decisionDateKey: "2025-01-02", entryDateKey: "2025-01-03", followDateKey: "2025-01-06", exitDateKey: "2025-01-07" }),
    ...buildPositiveSeries({ symbol: "O002", decisionDateKey: "2025-04-02", entryDateKey: "2025-04-03", followDateKey: "2025-04-04", exitDateKey: "2025-04-07" }),
    ...buildPositiveSeries({ symbol: "O003", decisionDateKey: "2025-08-04", entryDateKey: "2025-08-05", followDateKey: "2025-08-06", exitDateKey: "2025-08-07" }),
    ...buildNegativeSeries({ symbol: "O004", decisionDateKey: "2025-11-17", entryDateKey: "2025-11-18", followDateKey: "2025-11-19", exitDateKey: "2025-11-20" }),
    ...buildNegativeSeries({ symbol: "O005", decisionDateKey: "2025-12-09", entryDateKey: "2025-12-10", followDateKey: "2025-12-11", exitDateKey: "2025-12-12" }),
  ]
  await writeJsonl(path.join(dataDir, "candle_daily.jsonl"), candleRows)

  await runNode(
    [
      path.join(process.cwd(), "tools", "build_stepb_1d_tp12_touch_bundle_union_report.mjs"),
      `--scope-run-id=${runId}`,
      `--scope-label=LOW_GAP_TOP`,
      `--out-dir=${outDir}`,
      `--candle-path=${path.join(dataDir, "candle_daily.jsonl")}`,
      `--max-donor-terms=6`,
      `--max-cluster-terms=4`,
      `--max-bundle-candidate-terms=4`,
      `--max-positive-terms=4`,
      `--max-veto-tokens=2`,
      `--min-train-term-months=2`,
      `--min-train-term-folds=2`,
      `--min-selected-rows-after-veto=4`,
      `--min-selected-dates-after-veto=4`,
      `--min-veto-negative-hits=2`,
      `--min-verdict-oos-selected-rows=3`,
      `--min-verdict-oos-dates=3`,
      `--max-verdict-oos-top1-date-hit-share=0.5`,
    ],
    tempRoot,
    {
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
      STOCKDESK_SERVER_HOST: "smoke-host",
    },
  )

  const summary = await readJson(path.join(outDir, "touch_bundle_union_summary.json"), null)
  const verdict = await readJson(path.join(outDir, "touch_bundle_union_verdict.json"), null)
  assert.equal(summary?.termBank?.qualifiedTermCount >= 1, true)
  assert.equal(summary?.labelMatrix?.termCount >= 1, true)
  assert.equal(Number.isFinite(Number(summary?.bundleUnion?.positiveBundle?.termCount ?? Number.NaN)), true)
  assert.equal(Number.isFinite(Number(summary?.bundleUnion?.vetoBuilder?.candidateCount ?? Number.NaN)), true)
  assert.equal(Number.isFinite(Number(summary?.bundleUnion?.vetoBundle?.tokenCount ?? Number.NaN)), true)
  assert.equal(summary?.bundleUnion?.finalBundle?.oosSummary?.selectedRowCount >= 3, true)
  assert.equal(typeof verdict?.code, "string")
  console.log("ok: smoke_stepb_1d_tp12_touch_bundle_union_report")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
