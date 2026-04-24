#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

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

const buildSelectedRow = ({ symbol, decisionDateKey, dateField = "decisionDateKey" }) => ({
  symbol,
  [dateField]: decisionDateKey,
})

const buildSeries = ({ symbol, decisionDateKey, entryDateKey, day2DateKey, day3DateKey, day4DateKey, pattern }) => {
  const rows = [
    { symbol, dateKey: decisionDateKey, open: 95, high: 99, low: 94, close: 96, volume: 1000 },
    { symbol, dateKey: entryDateKey, open: 100, high: 106, low: 97, close: 101, volume: 1000 },
    { symbol, dateKey: day2DateKey, open: 101, high: 108, low: 98, close: 102, volume: 1000 },
    { symbol, dateKey: day3DateKey, open: 102, high: 109, low: 99, close: 103, volume: 1000 },
    { symbol, dateKey: day4DateKey, open: 103, high: 110, low: 100, close: 104, volume: 1000 },
  ]
  if (pattern === "hit3") {
    rows[3].high = 113
    rows[3].close = 112
  } else if (pattern === "hit4_only") {
    rows[4].high = 113
    rows[4].close = 112
  } else if (pattern !== "miss") {
    throw new Error(`unknown pattern=${pattern}`)
  }
  return rows
}

const buildDateWindow = (year, month, baseDay) => {
  const pad = (value) => String(value).padStart(2, "0")
  return {
    decisionDateKey: `${year}-${pad(month)}-${pad(baseDay)}`,
    entryDateKey: `${year}-${pad(month)}-${pad(baseDay + 1)}`,
    day2DateKey: `${year}-${pad(month)}-${pad(baseDay + 2)}`,
    day3DateKey: `${year}-${pad(month)}-${pad(baseDay + 3)}`,
    day4DateKey: `${year}-${pad(month)}-${pad(baseDay + 4)}`,
  }
}

const main = async () => {
  const repoRoot = process.cwd()
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-no-stop-window-report-"))
  const metaDir = path.join(tempRoot, "meta")
  const dataDir = path.join(tempRoot, "data")
  const sourceRunId = "source_w1"
  const scopeRunId = "scope_w1"
  const sourceRunDir = path.join(tempRoot, "artifacts", "runs", sourceRunId)
  const scopeRunDir = path.join(tempRoot, "artifacts", "runs", scopeRunId)
  const outDir = path.join(tempRoot, "artifacts", "checks", "window_report")
  await Promise.all([
    fs.mkdir(metaDir, { recursive: true }),
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(path.join(sourceRunDir, "step-perfect-prototype-open-control-input-pack"), { recursive: true }),
    fs.mkdir(path.join(scopeRunDir, "step-perfect-prototype-open-eval-report"), { recursive: true }),
    fs.mkdir(path.join(scopeRunDir, "step-perfect-prototype-open-train-apply-raw"), { recursive: true }),
    fs.mkdir(path.join(scopeRunDir, "step-perfect-prototype-open-oos-apply-raw"), { recursive: true }),
    fs.mkdir(path.join(scopeRunDir, "step-perfect-prototype-train"), { recursive: true }),
    fs.mkdir(path.join(scopeRunDir, "step-perfect-prototype-index-train"), { recursive: true }),
    fs.mkdir(outDir, { recursive: true }),
  ])

  const contract = await readJson(path.join(repoRoot, "meta", "tp12_no_stop_rolling_research_contract.json"), null)
  await writeJson(path.join(metaDir, "tp12_no_stop_rolling_research_contract.json"), contract)
  await writeJson(path.join(sourceRunDir, "control_input_pipeline_summary.json"), {
    kind: "tp12_no_stop_source_control_input_pipeline_v1",
    runId: sourceRunId,
  })
  await writeJson(path.join(sourceRunDir, "step-perfect-prototype-open-control-input-pack", "control_input_summary.json"), {
    kind: "tp12_no_stop_source_control_input_summary_v1",
    runId: sourceRunId,
    rowCount: 104,
  })
  await writeJson(path.join(scopeRunDir, "step-perfect-prototype-open-eval-report", "open_eval_manifest.json"), {
    lineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
    selectionMode: "union_all",
  })
  await writeJson(path.join(scopeRunDir, "step-perfect-prototype-open-eval-report", "selection_guardrail_summary.json"), {
    zeroNegativeRuleCount: 1,
    hit3ZeroNegativeRuleCount: 1,
  })
  await writeJson(path.join(scopeRunDir, "step-perfect-prototype-open-eval-report", "selection_leaderboard.json"), [
    {
      ruleId: "RULE_A",
      trainMatchedDateCount: 5,
      trainMatchedMonthCount: 5,
      trainMatchedFoldCount: 3,
      openOosMatchCount: 3,
      openOosHitCount: 3,
      openOosNegativeCount: 0,
      openOosUniqueMatchedDates: 3,
    },
    {
      ruleId: "RULE_B",
      trainMatchedDateCount: 12,
      trainMatchedMonthCount: 7,
      trainMatchedFoldCount: 4,
      openOosMatchCount: 2,
      openOosHitCount: 1,
      openOosNegativeCount: 1,
      openOosUniqueMatchedDates: 2,
    },
  ])
  await writeJson(path.join(scopeRunDir, "step-perfect-prototype-train", "summary.json"), {
    minedRuleCount: 2,
  })
  await writeJson(path.join(scopeRunDir, "step-perfect-prototype-index-train", "summary.json"), {
    indexedRowCount: 104,
  })
  await writeJson(path.join(scopeRunDir, "freeze_result.json"), {
    outPath: path.join(scopeRunDir, "step-perfect-prototype-train", "catalog.json"),
  })
  await writeJson(path.join(scopeRunDir, "tp12_no_stop_window_runtime.json"), {
    sourceRunId,
    scopeRunId,
    status: "ok",
  })

  const trainRows = []
  const oosRows = []
  const candleRows = []
  const trainWindows = [
    buildDateWindow(2021, 1, 4),
    buildDateWindow(2021, 2, 1),
    buildDateWindow(2021, 3, 2),
    buildDateWindow(2021, 4, 5),
    buildDateWindow(2021, 5, 3),
  ]
  for (let index = 0; index < 101; index += 1) {
    const symbol = `T${String(index + 1).padStart(4, "0")}`
    const window = trainWindows[index % trainWindows.length]
    const pattern = index % 4 === 0 ? "hit3" : index % 4 === 1 ? "hit4_only" : "miss"
    const dateField = index % 2 === 0 ? "dateKey" : "decisionDateKey"
    trainRows.push(buildSelectedRow({ symbol, decisionDateKey: window.decisionDateKey, dateField }))
    candleRows.push(...buildSeries({ symbol, ...window, pattern }))
  }

  const oosWindows = [
    { ...buildDateWindow(2024, 1, 2), symbol: "O0001", pattern: "hit3", dateField: "decisionDateKey" },
    { ...buildDateWindow(2024, 2, 5), symbol: "O0002", pattern: "hit4_only", dateField: "recommendationDateKey" },
    { ...buildDateWindow(2024, 3, 4), symbol: "O0003", pattern: "miss", dateField: "dateKey" },
  ]
  for (const row of oosWindows) {
    oosRows.push(buildSelectedRow({ symbol: row.symbol, decisionDateKey: row.decisionDateKey, dateField: row.dateField }))
    candleRows.push(...buildSeries(row))
  }

  await writeJsonl(path.join(scopeRunDir, "step-perfect-prototype-open-train-apply-raw", "deduped_symbols.jsonl"), trainRows)
  await writeJsonl(path.join(scopeRunDir, "step-perfect-prototype-open-oos-apply-raw", "deduped_symbols.jsonl"), oosRows)
  await writeJsonl(path.join(dataDir, "candle_daily.jsonl"), candleRows)

  await runNode(
    [
      path.join(repoRoot, "tools", "build_stepb_1d_tp12_no_stop_window_report.mjs"),
      "--contract-path=meta/tp12_no_stop_rolling_research_contract.json",
      "--window-id=w1",
      `--source-run-id=${sourceRunId}`,
      `--scope-run-id=${scopeRunId}`,
      `--out-dir=${outDir}`,
      "--candle-path=data/candle_daily.jsonl",
    ],
    tempRoot,
    {
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
      STOCKDESK_SERVER_HOST: "smoke-host",
    },
  )

  const summary = await readJson(path.join(outDir, "window_summary.json"), null)
  const normalizedTrainRows = await readJsonl(path.join(outDir, "train_selected_rows.jsonl"))
  const normalizedOosRows = await readJsonl(path.join(outDir, "oos_selected_rows.jsonl"))

  assert.equal(summary?.kind, "tp12_no_stop_window_report_v1")
  assert.equal(summary?.windowId, "w1")
  assert.equal(summary?.status, "usable")
  assert.equal(summary?.train?.metricsByLabel?.tp12_no_stop_hit_3d?.selectedRows, 101)
  assert.equal(summary?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.selectedRows, 3)
  assert.equal(summary?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.hitRows, 1)
  assert.equal(summary?.oos?.metricsByLabel?.tp12_no_stop_hit_4d?.hitRows, 2)
  assert.equal(summary?.search?.trainBreadthQualifiedRuleCount, 2)
  assert.equal(summary?.search?.trainPromotableBreadthRuleCount, 1)
  assert.equal(summary?.search?.zeroNegativeRuleCount, 1)
  assert.equal(summary?.search?.oosPerfectDateFloor3RuleCount, 1)
  assert.equal(normalizedTrainRows.length, 101)
  assert.equal(normalizedTrainRows.some((row) => row?.symbol === "T0101"), true)
  assert.equal(normalizedOosRows.length, 3)
  assert.equal(normalizedOosRows[1]?.decisionDateKey, "2024-02-05")
  console.log("ok smoke_stepb_1d_tp12_no_stop_window_report")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
