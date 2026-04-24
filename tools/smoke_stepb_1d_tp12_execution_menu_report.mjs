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

const buildPackRow = ({ rowKey, dateKey, symbol, decisionIdx = 0, cleanHit = false, tokens = [] } = {}) => ({
  rowKey,
  sourceId: rowKey,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  symbol,
  decisionIdx,
  outcomeHitTarget: cleanHit,
  categoricalTokens: tokens,
  contextualTokens: tokens,
  numericFeatureMap: {},
})

const buildSeries = ({ symbol, decisionDateKey, entryDateKey, day2DateKey, day3DateKey, pattern }) => {
  const base = [
    { symbol, dateKey: decisionDateKey, open: 95, high: 99, low: 90, close: 96 },
    { symbol, dateKey: entryDateKey, open: 100, high: 106, low: 97, close: 101 },
    { symbol, dateKey: day2DateKey, open: 101, high: 109, low: 99, close: 104 },
    { symbol, dateKey: day3DateKey, open: 104, high: 110, low: 100, close: 105 },
  ]
  if (pattern === "same_bar_stop_touch") {
    base[1] = { symbol, dateKey: entryDateKey, open: 100, high: 114, low: 94, close: 108 }
    return base
  }
  if (pattern === "stop_then_day2_touch") {
    base[1] = { symbol, dateKey: entryDateKey, open: 100, high: 106, low: 94, close: 97 }
    base[2] = { symbol, dateKey: day2DateKey, open: 98, high: 114, low: 99, close: 112 }
    return base
  }
  if (pattern === "day2_stop_day3_touch") {
    base[1] = { symbol, dateKey: entryDateKey, open: 100, high: 106, low: 97, close: 102 }
    base[2] = { symbol, dateKey: day2DateKey, open: 101, high: 110, low: 95, close: 98 }
    base[3] = { symbol, dateKey: day3DateKey, open: 99, high: 114, low: 100, close: 112 }
    return base
  }
  if (pattern === "no_touch_miss") {
    base[1] = { symbol, dateKey: entryDateKey, open: 100, high: 106, low: 97, close: 99 }
    base[2] = { symbol, dateKey: day2DateKey, open: 99, high: 107, low: 96, close: 98 }
    base[3] = { symbol, dateKey: day3DateKey, open: 98, high: 108, low: 95, close: 96 }
    return base
  }
  throw new Error(`unknown pattern=${pattern}`)
}

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
          ruleId: "RULE_TOUCH",
          familyId: "low_gap_top_continuation",
          tokens: ["tag:scope:gap_top"],
          precision: 1,
        },
      ],
    },
    sourceRunId: "smoke_tp12_execution_menu",
    selectionMode: "union_all",
    selectionLineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
    selectionSurface: "v3_contextual_plus_lite",
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-execution-menu-"))
  const dataDir = path.join(tempRoot, "data")
  const runId = "scope_gap_top"
  const runDir = path.join(tempRoot, "artifacts", "runs", runId)
  const trainPackDir = path.join(runDir, "step-perfect-prototype-open-train-pack")
  const oosPackDir = path.join(runDir, "step-perfect-prototype-open-oos-pack")
  const evalDir = path.join(runDir, "step-perfect-prototype-open-eval-report")
  const trainDir = path.join(runDir, "step-perfect-prototype-train")
  const recentPackDir = path.join(tempRoot, "artifacts", "runs", "recent_scope", "step-perfect-prototype-open-recent-low-gap-top-pack")
  const outDir = path.join(tempRoot, "artifacts", "runs", "parent", "step-perfect-prototype-1d-tp12-execution-menu-report")
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(trainPackDir, { recursive: true }),
    fs.mkdir(oosPackDir, { recursive: true }),
    fs.mkdir(evalDir, { recursive: true }),
    fs.mkdir(trainDir, { recursive: true }),
    fs.mkdir(recentPackDir, { recursive: true }),
    fs.mkdir(outDir, { recursive: true }),
  ])

  const catalogPath = path.join(trainDir, "catalog.json")
  await writeJson(catalogPath, buildCatalog())
  await writeJson(path.join(runDir, "freeze_result.json"), { outPath: catalogPath })
  await writeJson(path.join(evalDir, "open_eval_manifest.json"), {
    lineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
    selectionMode: "union_all",
  })
  await writeJson(path.join(evalDir, "selection_guardrail_summary.json"), {
    zeroNegativeRuleCount: 0,
    hit3ZeroNegativeRuleCount: 0,
    close28SelectedRows: 3,
    close28HitRows: 1,
    lineLevelHitRate: 1 / 3,
  })
  await writeJson(path.join(evalDir, "selection_leaderboard.json"), [
    {
      ruleId: "RULE_TOUCH",
      familyId: "low_gap_top_continuation",
      trainMatchedDateCount: 4,
      trainMatchedMonthCount: 4,
      trainMatchedFoldCount: 3,
      openOosMatchCount: 3,
      openOosHitCount: 1,
      openOosNegativeCount: 2,
      openOosPrecision: 1 / 3,
      openOosUniqueMatchedDates: 3,
    },
  ])

  const tokenList = ["tag:scope:gap_top"]
  const trainRows = [
    buildPackRow({ rowKey: "t1", dateKey: "2020-11-27", symbol: "T001", tokens: tokenList }),
    buildPackRow({ rowKey: "t2", dateKey: "2021-02-01", symbol: "T002", tokens: tokenList }),
    buildPackRow({ rowKey: "t3", dateKey: "2021-08-02", symbol: "T003", tokens: tokenList }),
    buildPackRow({ rowKey: "t4", dateKey: "2021-12-03", symbol: "T004", tokens: tokenList }),
  ]
  const oosRows = [
    buildPackRow({ rowKey: "o1", dateKey: "2025-01-02", symbol: "O001", tokens: tokenList }),
    buildPackRow({ rowKey: "o2", dateKey: "2025-04-02", symbol: "O002", tokens: tokenList }),
    buildPackRow({ rowKey: "o3", dateKey: "2025-08-04", symbol: "O003", tokens: tokenList }),
    buildPackRow({ rowKey: "o4", dateKey: "2025-10-06", symbol: "O004", tokens: tokenList }),
  ]
  const recentRows = [
    buildPackRow({ rowKey: "r1", dateKey: "2026-02-02", symbol: "R001", tokens: tokenList }),
    buildPackRow({ rowKey: "r2", dateKey: "2026-03-02", symbol: "R002", tokens: tokenList }),
    buildPackRow({ rowKey: "r3", dateKey: "2026-04-01", symbol: "R003", tokens: tokenList }),
  ]
  await writeJsonl(path.join(trainPackDir, "daily_pack.jsonl"), trainRows)
  await writeJsonl(path.join(oosPackDir, "daily_pack.jsonl"), oosRows)
  await writeJsonl(path.join(recentPackDir, "daily_pack.jsonl"), recentRows)
  await writeJson(path.join(recentPackDir, "summary.json"), {
    requestedPeriod: { from: "2026-02-01", to: "2026-04-02" },
    outputCoverage: { from: "2026-02-02", to: "2026-04-01", count: 3 },
    rowsWritten: 3,
  })

  const candleRows = [
    ...buildSeries({ symbol: "T001", decisionDateKey: "2020-11-27", entryDateKey: "2020-11-30", day2DateKey: "2020-12-01", day3DateKey: "2020-12-02", pattern: "same_bar_stop_touch" }),
    ...buildSeries({ symbol: "T002", decisionDateKey: "2021-02-01", entryDateKey: "2021-02-02", day2DateKey: "2021-02-03", day3DateKey: "2021-02-04", pattern: "stop_then_day2_touch" }),
    ...buildSeries({ symbol: "T003", decisionDateKey: "2021-08-02", entryDateKey: "2021-08-03", day2DateKey: "2021-08-04", day3DateKey: "2021-08-05", pattern: "day2_stop_day3_touch" }),
    ...buildSeries({ symbol: "T004", decisionDateKey: "2021-12-03", entryDateKey: "2021-12-06", day2DateKey: "2021-12-07", day3DateKey: "2021-12-08", pattern: "no_touch_miss" }),
    ...buildSeries({ symbol: "O001", decisionDateKey: "2025-01-02", entryDateKey: "2025-01-03", day2DateKey: "2025-01-06", day3DateKey: "2025-01-07", pattern: "same_bar_stop_touch" }),
    ...buildSeries({ symbol: "O002", decisionDateKey: "2025-04-02", entryDateKey: "2025-04-03", day2DateKey: "2025-04-04", day3DateKey: "2025-04-07", pattern: "stop_then_day2_touch" }),
    ...buildSeries({ symbol: "O003", decisionDateKey: "2025-08-04", entryDateKey: "2025-08-05", day2DateKey: "2025-08-06", day3DateKey: "2025-08-07", pattern: "day2_stop_day3_touch" }),
    ...buildSeries({ symbol: "O004", decisionDateKey: "2025-10-06", entryDateKey: "2025-10-07", day2DateKey: "2025-10-08", day3DateKey: "2025-10-10", pattern: "no_touch_miss" }),
    ...buildSeries({ symbol: "R001", decisionDateKey: "2026-02-02", entryDateKey: "2026-02-03", day2DateKey: "2026-02-04", day3DateKey: "2026-02-05", pattern: "same_bar_stop_touch" }),
    ...buildSeries({ symbol: "R002", decisionDateKey: "2026-03-02", entryDateKey: "2026-03-03", day2DateKey: "2026-03-04", day3DateKey: "2026-03-05", pattern: "stop_then_day2_touch" }),
    ...buildSeries({ symbol: "R003", decisionDateKey: "2026-04-01", entryDateKey: "2026-04-02", day2DateKey: "2026-04-03", day3DateKey: "2026-04-06", pattern: "day2_stop_day3_touch" }),
  ]
  await writeJsonl(path.join(dataDir, "candle_daily.jsonl"), candleRows)

  await runNode(
    [
      path.join(process.cwd(), "tools", "build_stepb_1d_tp12_execution_menu_report.mjs"),
      `--scope-run-id=${runId}`,
      `--scope-label=LOW_GAP_TOP`,
      `--recent-input=${path.join(recentPackDir, "daily_pack.jsonl")}`,
      `--out-dir=${outDir}`,
      `--candle-path=${path.join(dataDir, "candle_daily.jsonl")}`,
    ],
    tempRoot,
    {
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
      STOCKDESK_SERVER_HOST: "smoke-host",
    },
  )

  const summary = await readJson(path.join(outDir, "execution_menu_summary.json"), null)
  const bestStopAware = summary?.ranking?.bestStopAwarePolicyId
  const baseline = summary?.policyResults?.find((entry) => entry?.policyId === "baseline_tp12_sl4_stop_first_3d")
  const sl6Delay = summary?.policyResults?.find((entry) => entry?.policyId === "tp12_sl6_stop_delay1_3d")

  assert.equal(bestStopAware, "tp12_sl6_stop_delay1_3d")
  assert.equal(summary?.verdict?.code, "stop_recovery_policy_found")
  assert.ok(Number(sl6Delay?.recent?.targetHitRate ?? 0) > Number(baseline?.recent?.targetHitRate ?? 0))
  assert.ok(Number(sl6Delay?.oos?.targetHitRate ?? 0) > Number(baseline?.oos?.targetHitRate ?? 0))
  console.log("ok: smoke_stepb_1d_tp12_execution_menu_report")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
