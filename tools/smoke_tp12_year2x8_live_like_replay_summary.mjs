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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2x8-live-like-smoke-"))
  const contractPath = path.join(tmpDir, "contract.json")
  const finalSummaryPath = path.join(tmpDir, "final_summary.json")
  const dateListPath = path.join(tmpDir, "requested_dates.txt")
  const batchApplyDir = path.join(tmpDir, "batch_apply")
  const dayRunRoot = path.join(tmpDir, "day_runs")
  const outPath = path.join(tmpDir, "summary.json")

  await writeJson(contractPath, {
    kind: "tp12_year2x8_bank_discovery_research_contract_v1",
    contractId: "smoke_tp12_year2x8_bank_discovery",
    updatedAt: "2026-04-11T23:59:00+09:00",
    baseLookbackLadderContractPath: "meta/tp12_no_stop_lookback_ladder_contract.json",
    canonicalBaseline: {
      scopeId: "LOW_GAP_TOP",
      candidateId: "lb5",
      screenHitRate: 0.31,
      screenHitRows: 115,
      screenSelectedRows: 370,
      finalHitRate: 0.2857142857142857,
      finalHitRows: 30,
      finalSelectedRows: 105,
    },
    yearHitPrune: {
      enableYearHitUpperBoundPrune: true,
      coreYears: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
      excludedBoundaryYears: [2016],
      minTrainHitsPerCoreYear: 2,
    },
    bankDiscovery: {
      scopeIds: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      screenWindowGroup: "screen",
      screenMaxSearchStates: 200000,
      dryRunCell: {
        scopeId: "LOW_GAP_TOP",
        candidateId: "lb5",
      },
    },
    promotion: {
      screenMinUsableWindows: 5,
      screenMinRollingOosHitRate: 0.2857142857142857,
      screenMinSignalsPer20TradingDays: 6,
      screenMinYearsWithAtLeast2Hits: 4,
      screenMaxTop1DateShare: 0.1,
      finalMinOosHitRate: 0.5,
      finalMinSelectedRows: 80,
      finalMinSignalsPer20TradingDays: 8,
      finalMinUniqueMatchedDates: 70,
      finalMaxTop1DateShare: 0.06,
      finalSoftFailBelowHitRate: 0.4,
      liveLikeSignalsPer20TradingDaysMin: 8,
      liveLikeSignalsPer20TradingDaysMax: 12,
    },
  })
  await writeJson(finalSummaryPath, {
    kind: "tp12_year2x8_final_confirm_summary_v1",
    contractId: "smoke_tp12_year2x8_bank_discovery",
    contractPath,
    runId: "smoke_final",
    cellId: "low_gap_top_lb5",
    scopeId: "LOW_GAP_TOP",
    candidateId: "lb5",
    sourceRunId: "source_smoke",
    scopeRunId: "scope_smoke",
    oosDateFrom: "2025-01-02",
    oosDateTo: "2025-01-03",
    selectionMode: "union_all",
    oosSelectedRows: 2,
    oosHitRows: 1,
    oosHitRate: 0.5,
    uniqueMatchedDates: 2,
    uniqueMatchedSymbols: 2,
    top1DateShare: 0.5,
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
      "tools/build_tp12_year2x8_live_like_replay_summary.mjs",
      `--contract-path=${contractPath}`,
      `--final-summary-path=${finalSummaryPath}`,
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
  assert.equal(summary.equality.setEquality, true)
  assert.equal(summary.operational.passesOperationalFit, false)

  await writeJsonl(path.join(dayRunRoot, "date=2025-01-03", "deduped_symbols.jsonl"), [])
  const mismatchRun = spawnSync(
    "node",
    [
      "tools/build_tp12_year2x8_live_like_replay_summary.mjs",
      `--contract-path=${contractPath}`,
      `--final-summary-path=${finalSummaryPath}`,
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
  assert.notEqual(mismatchRun.status, 0)
  assert.match(`${mismatchRun.stderr}\n${mismatchRun.stdout}`, /Year2x8 live-like replay mismatch detected/i)
  console.log("ok smoke_tp12_year2x8_live_like_replay_summary")
}

await main()
