#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { loadTp12NoStopLookbackLadderContract } from "../src/lib/tp12_no_stop_lookback_ladder_contract.mjs"
import { buildTp12NoStopLookbackLadderSummary } from "../src/lib/tp12_no_stop_lookback_ladder_report.mjs"

const main = async () => {
  const cwd = process.cwd()
  const ladderContract = await loadTp12NoStopLookbackLadderContract({ cwd })
  const outDir = path.join(cwd, "artifacts", "checks", "smoke_tp12_no_stop_lookback_ladder_summary")
  await ensureDir(outDir)

  const lb1SummaryPath = path.join(outDir, "lb1_rolling_summary.json")
  const lb3SummaryPath = path.join(outDir, "lb3_rolling_summary.json")
  await writeJson(lb1SummaryPath, {
    kind: "tp12_no_stop_rolling_summary_v1",
    contractId: "tp12_no_stop_low_gap_top_lookback_ladder_v1_lb1",
    screen: {
      primary: {
        windowCount: 6,
        usableWindowCount: 4,
        selectedRows: 20,
        hitRows: 6,
        hitRate: 0.3,
        avgWindowHitRate: 0.31,
        maxTop1DateShare: 0.4,
      },
      enoughUsableScreenWindows: true,
      earlyStopTriggered: false,
    },
    finalConfirm: {
      windowId: "final_confirm",
      primary: {
        selectedRows: 8,
        hitRows: 2,
        hitRate: 0.25,
      },
    },
  })
  await writeJson(lb3SummaryPath, {
    kind: "tp12_no_stop_rolling_summary_v1",
    contractId: "tp12_no_stop_low_gap_top_lookback_ladder_v1_lb3",
    screen: {
      primary: {
        windowCount: 6,
        usableWindowCount: 5,
        selectedRows: 30,
        hitRows: 12,
        hitRate: 0.4,
        avgWindowHitRate: 0.39,
        maxTop1DateShare: 0.25,
      },
      enoughUsableScreenWindows: true,
      earlyStopTriggered: false,
    },
    finalConfirm: {
      windowId: "final_confirm",
      primary: {
        selectedRows: 10,
        hitRows: 4,
        hitRate: 0.4,
      },
    },
  })

  const manifestPath = path.join(outDir, "lookback_ladder_manifest.json")
  await writeJson(manifestPath, {
    kind: "tp12_no_stop_lookback_ladder_manifest_v1",
    generatedAt: new Date().toISOString(),
    runId: "smoke_tp12_no_stop_lookback_ladder_summary",
    candidateGroup: "sparse",
    windowGroup: "screen",
    contractPath: ladderContract.contractPath,
    requestedCandidateIds: ["lb1", "lb3"],
    requestedWindowIds: ["w1", "w2", "w3", "w4", "w5", "w6"],
    candidates: [
      {
        candidateId: "lb1",
        candidateRunId: "smoke_lb1",
        candidateContractPath: path.join(outDir, "lb1_contract.json"),
        rollingSummaryPath: lb1SummaryPath,
        rollingReportPath: path.join(outDir, "lb1_report.md"),
      },
      {
        candidateId: "lb3",
        candidateRunId: "smoke_lb3",
        candidateContractPath: path.join(outDir, "lb3_contract.json"),
        rollingSummaryPath: lb3SummaryPath,
        rollingReportPath: path.join(outDir, "lb3_report.md"),
      },
    ],
  })

  const summaryPath = path.join(outDir, "lookback_ladder_summary.json")
  const result = await buildTp12NoStopLookbackLadderSummary({
    ladderContract,
    manifestPath,
    outPath: summaryPath,
  })
  const summary = await readJson(result.outPath, null)
  assert.equal(summary?.kind, "tp12_no_stop_lookback_ladder_summary_v1")
  assert.equal(summary?.candidateCount, 2)
  assert.equal(summary?.bestCandidateId, "lb3")
  assert.equal(summary?.candidates?.[0]?.candidateId, "lb3")
  assert.equal(summary?.candidates?.[1]?.candidateId, "lb1")
  console.log("ok smoke_tp12_no_stop_lookback_ladder_summary")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
