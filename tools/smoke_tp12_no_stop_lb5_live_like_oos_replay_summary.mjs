#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const lines = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row))
  await fs.writeFile(filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8")
}

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-live-like-oos-smoke-"))
  const contractPath = path.join(tmpDir, "contract.json")
  const dateListPath = path.join(tmpDir, "requested_dates.txt")
  const batchApplyDir = path.join(tmpDir, "batch_apply")
  const dayRunRoot = path.join(tmpDir, "day_runs")
  const outPath = path.join(tmpDir, "summary.json")

  await writeJson(contractPath, {
    kind: "tp12_no_stop_lb5_live_like_oos_replay_contract_v1",
    contractId: "smoke_live_like_replay",
    updatedAt: "2026-04-11T00:00:00+09:00",
    scopeId: "LOW_GAP_TOP",
    baseCandidateId: "lb5",
    lookbackTradingDays: 5,
    selectionMode: "union_all",
    baseRollingContractPath: "meta/tp12_no_stop_rolling_research_contract.json",
    trainWindow: {
      from: "2016-08-12",
      to: "2024-12-27",
    },
    oosWindow: {
      from: "2025-01-02",
      to: "2026-03-27",
    },
    labelContract: {
      primaryLabelId: "tp12_no_stop_hit_3d",
      secondaryLabelId: "tp12_no_stop_hit_4d",
    },
    baselineRunIds: {
      baseRunId: "smoke",
      sourceRunId: "smoke_source",
      scopeRunId: "smoke_scope",
    },
    baselineMetrics: {
      curatedRuleCount: 2,
      oosCandidateRows: 4,
      oosSelectedRows: 2,
      oosHitRows: 1,
      oosHitRate: 0.5,
      oosUniqueMatchedDates: 2,
      oosUniqueMatchedSymbols: 2,
      oosTop1DateShare: 0.5,
    },
  })
  await fs.writeFile(dateListPath, "2025-01-02\n2025-01-03\n", "utf8")

  const sharedRows = [
    {
      dateKey: "2025-01-02",
      recommendationDateKey: "2025-01-02",
      symbol: "000001",
      name: "SmokeOne",
      outcomeHitTarget: true,
      matchedRuleIds: ["PP_A", "PP_B"],
      matchedRuleCount: 2,
      primaryRuleId: "PP_A",
      supportingRuleIds: ["PP_B"],
      bestOpenOosPrecision: 1,
      bestOpenOosHitCount: 3,
      consensusScore: 2,
    },
    {
      dateKey: "2025-01-03",
      recommendationDateKey: "2025-01-03",
      symbol: "000002",
      name: "SmokeTwo",
      outcomeHitTarget: false,
      matchedRuleIds: ["PP_C"],
      matchedRuleCount: 1,
      primaryRuleId: "PP_C",
      supportingRuleIds: [],
      bestOpenOosPrecision: 0.5,
      bestOpenOosHitCount: 2,
      consensusScore: 1,
    },
  ]
  await writeJson(path.join(batchApplyDir, "summary.json"), {
    selectionMode: "union_all",
    dedupedMatches: 2,
    lineLevelHitCount: 1,
  })
  await writeJsonl(path.join(batchApplyDir, "matches.jsonl"), sharedRows)
  await writeJsonl(path.join(batchApplyDir, "deduped_symbols.jsonl"), sharedRows)

  for (const row of sharedRows) {
    const dayDir = path.join(dayRunRoot, `date=${row.dateKey}`)
    await writeJson(path.join(dayDir, "summary.json"), {
      sourceRows: 2,
      rawMatches: 1,
      dedupedMatches: 1,
      lineLevelHitCount: row.outcomeHitTarget === true ? 1 : 0,
      lineLevelHitRate: row.outcomeHitTarget === true ? 1 : 0,
    })
    await writeJsonl(path.join(dayDir, "matches.jsonl"), [row])
    await writeJsonl(path.join(dayDir, "deduped_symbols.jsonl"), [row])
  }

  const successRun = spawnSync(
    "node",
    [
      "tools/build_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs",
      `--contract-path=${contractPath}`,
      `--date-list-file=${dateListPath}`,
      `--day-run-root=${dayRunRoot}`,
      `--batch-apply-dir=${batchApplyDir}`,
      `--out=${outPath}`,
      "--run-id=smoke_run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
  assert.equal(successRun.status, 0, successRun.stderr || successRun.stdout)
  const summary = JSON.parse(await fs.readFile(outPath, "utf8"))
  assert.equal(summary.status, "equivalent")
  assert.equal(summary.equality.rawSetMatch, true)
  assert.equal(summary.equality.dedupedSetMatch, true)

  await writeJsonl(path.join(dayRunRoot, "date=2025-01-03", "deduped_symbols.jsonl"), [])
  const mismatchRun = spawnSync(
    "node",
    [
      "tools/build_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs",
      `--contract-path=${contractPath}`,
      `--date-list-file=${dateListPath}`,
      `--day-run-root=${dayRunRoot}`,
      `--batch-apply-dir=${batchApplyDir}`,
      `--out=${path.join(tmpDir, "mismatch_summary.json")}`,
      "--run-id=smoke_run_mismatch",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
  assert.notEqual(mismatchRun.status, 0, "mismatch run should fail")
  assert.match(
    `${mismatchRun.stderr}\n${mismatchRun.stdout}`,
    /Live-like OOS replay mismatch detected/i,
  )

  console.log("ok smoke_tp12_no_stop_lb5_live_like_oos_replay_summary")
}

await main()
