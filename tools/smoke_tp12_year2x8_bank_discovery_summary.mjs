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

const buildWindow = ({ windowId, oosFrom, oosTo, selectedRows, hitRows, ruleCount, top1DateShare = null }) => ({
  kind: "tp12_no_stop_window_report_v1",
  kindWindow: "screen",
  windowId,
  oosDateFrom: oosFrom,
  oosDateTo: oosTo,
  search: {
    leaderboardRowCount: ruleCount,
  },
  oos: {
    metricsByLabel: {
      tp12_no_stop_hit_3d: {
        selectedRows,
        hitRows,
        hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
        uniqueMatchedDates: selectedRows,
        uniqueMatchedSymbols: selectedRows,
        top1DateShare:
          Number.isFinite(Number(top1DateShare)) && Number(top1DateShare) >= 0
            ? Number(top1DateShare)
            : selectedRows > 0
              ? 1 / selectedRows
              : 0,
      },
    },
  },
})

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2x8-matrix-smoke-"))
  const contractPath = path.join(tmpDir, "contract.json")
  const manifestPath = path.join(tmpDir, "manifest.json")
  const outPath = path.join(tmpDir, "matrix_summary.json")
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
      scopeIds: ["LOW_GAP_TOP", "LOW"],
      lookbackCandidateIds: ["lb5"],
      screenWindowGroup: "screen",
      screenMaxSearchStates: 200000,
      dryRunCell: {
        scopeId: "LOW_GAP_TOP",
        candidateId: "lb5",
      },
    },
    promotion: {
      screenMinUsableWindows: 2,
      screenMinRollingOosHitRate: 0.28,
      screenMinSignalsPer20TradingDays: 4,
      screenMinYearsWithAtLeast2Hits: 2,
      screenMaxTop1DateShare: 0.2,
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

  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2023-01-02" },
    { symbol: "000001", dateKey: "2023-01-03" },
    { symbol: "000001", dateKey: "2024-01-02" },
    { symbol: "000001", dateKey: "2024-01-03" },
  ])

  const cellAPath = path.join(tmpDir, "low_gap_top_lb5_summary.json")
  const cellBPath = path.join(tmpDir, "low_lb5_summary.json")
  await writeJson(cellAPath, {
    primaryLabelId: "tp12_no_stop_hit_3d",
    windows: [
      buildWindow({
        windowId: "w5",
        oosFrom: "2023-01-02",
        oosTo: "2023-01-03",
        selectedRows: 6,
        hitRows: 3,
        ruleCount: 9,
      }),
      buildWindow({
        windowId: "w6",
        oosFrom: "2024-01-02",
        oosTo: "2024-01-03",
        selectedRows: 4,
        hitRows: 2,
        ruleCount: 8,
        top1DateShare: 0.2,
      }),
    ],
  })
  await writeJson(cellBPath, {
    primaryLabelId: "tp12_no_stop_hit_3d",
    windows: [
      buildWindow({
        windowId: "w5",
        oosFrom: "2023-01-02",
        oosTo: "2023-01-03",
        selectedRows: 5,
        hitRows: 1,
        ruleCount: 7,
      }),
      buildWindow({
        windowId: "w6",
        oosFrom: "2024-01-02",
        oosTo: "2024-01-03",
        selectedRows: 5,
        hitRows: 1,
        ruleCount: 6,
      }),
    ],
  })

  await writeJson(manifestPath, {
    kind: "tp12_year2x8_bank_discovery_manifest_v1",
    runId: "smoke_year2x8_matrix",
    contractPath,
    windowGroup: "screen",
    cells: [
      {
        cellId: "low_gap_top_lb5",
        scopeId: "LOW_GAP_TOP",
        candidateId: "lb5",
        lookbackTradingDays: 5,
        childRunId: "child_a",
        childContractPath: path.join(tmpDir, "child_a_contract.json"),
        rollingSummaryPath: cellAPath,
      },
      {
        cellId: "low_lb5",
        scopeId: "LOW",
        candidateId: "lb5",
        lookbackTradingDays: 5,
        childRunId: "child_b",
        childContractPath: path.join(tmpDir, "child_b_contract.json"),
        rollingSummaryPath: cellBPath,
      },
    ],
  })

  const run = spawnSync(
    "node",
    [
      "tools/build_tp12_year2x8_bank_discovery_summary.mjs",
      `--contract-path=${contractPath}`,
      `--manifest-path=${manifestPath}`,
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
  assert.equal(summary.kind, "tp12_year2x8_bank_discovery_summary_v1")
  assert.equal(summary.cellCount, 2)
  assert.equal(summary.cells[0].cellId, "low_gap_top_lb5")
  assert.equal(summary.cells[0].passScreen, true)
  assert.equal(summary.cells[0].yearsWithAtLeast2Hits, 2)
  assert.equal(summary.cells[1].passScreen, false)
  console.log("ok smoke_tp12_year2x8_bank_discovery_summary")
}

await main()
