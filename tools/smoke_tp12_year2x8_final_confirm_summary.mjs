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

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2x8-final-smoke-"))
  const contractPath = path.join(tmpDir, "contract.json")
  const rollingSummaryPath = path.join(tmpDir, "rolling_summary.json")
  const outPath = path.join(tmpDir, "final_summary.json")
  const candlePath = path.join(tmpDir, "candle_daily.jsonl")

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
      finalMinSelectedRows: 4,
      finalMinSignalsPer20TradingDays: 4,
      finalMinUniqueMatchedDates: 4,
      finalMaxTop1DateShare: 0.4,
      finalSoftFailBelowHitRate: 0.4,
      liveLikeSignalsPer20TradingDaysMin: 8,
      liveLikeSignalsPer20TradingDaysMax: 12,
    },
  })

  await fs.writeFile(
    candlePath,
    ['{"symbol":"000001","dateKey":"2025-01-02"}', '{"symbol":"000001","dateKey":"2025-01-03"}', '{"symbol":"000001","dateKey":"2025-01-06"}', '{"symbol":"000001","dateKey":"2025-01-07"}'].join("\n") + "\n",
    "utf8",
  )
  await writeJson(rollingSummaryPath, {
    primaryLabelId: "tp12_no_stop_hit_3d",
    windows: [
      {
        kind: "final_confirm",
        kindWindow: "final_confirm",
        windowId: "final_confirm",
        sourceRunId: "source_smoke",
        scopeRunId: "scope_smoke",
        trainDateFrom: "2016-08-12",
        trainDateTo: "2024-12-27",
        oosDateFrom: "2025-01-02",
        oosDateTo: "2025-01-07",
        search: {
          leaderboardRowCount: 11,
          selectionMode: "union_all",
          lineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
        },
        oos: {
          metricsByLabel: {
            tp12_no_stop_hit_3d: {
              selectedRows: 4,
              hitRows: 2,
              hitRate: 0.5,
              uniqueMatchedDates: 4,
              uniqueMatchedSymbols: 4,
              top1DateShare: 0.25,
            },
          },
        },
      },
    ],
  })

  const run = spawnSync(
    "node",
    [
      "tools/build_tp12_year2x8_final_confirm_summary.mjs",
      `--contract-path=${contractPath}`,
      `--rolling-summary-path=${rollingSummaryPath}`,
      "--scope-id=LOW_GAP_TOP",
      "--candidate-id=lb5",
      "--run-id=smoke_final",
      `--out=${outPath}`,
      `--candle-path=${candlePath}`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
  assert.equal(run.status, 0, run.stderr || run.stdout)
  const summary = JSON.parse(await fs.readFile(outPath, "utf8"))
  assert.equal(summary.kind, "tp12_year2x8_final_confirm_summary_v1")
  assert.equal(summary.cellId, "low_gap_top_lb5")
  assert.equal(summary.sourceRunId, "source_smoke")
  assert.equal(summary.passFinal, true)
  assert.equal(summary.ruleCount, 11)
  console.log("ok smoke_tp12_year2x8_final_confirm_summary")
}

await main()
