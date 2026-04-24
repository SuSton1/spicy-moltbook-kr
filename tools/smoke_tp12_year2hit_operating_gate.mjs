#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import {
  buildTp12Year2hitOperatingGateSummary,
  wilsonInterval,
} from "../src/lib/tp12_year2hit_operating_gate.mjs"

const execFileAsync = promisify(execFile)

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-operating-gate-"))
try {
  const replaySummaryPath = path.join(tmp, "replay_summary.json")
  const contractPath = path.join(tmp, "contract.json")
  const outSummaryPath = path.join(tmp, "operating_gate_summary.json")
  const outReportPath = path.join(tmp, "operating_gate_report.md")
  await writeJson(contractPath, {
    kind: "tp12_year2hit_train_first_contract_v1",
    oosResultGate: {
      targetSelectionKey: "onePickPerDay",
      targetObservedHitRate: 0.8,
      minWilsonLowerBound95: 0.8,
      minSelectedRows: 50,
      minUniqueMatchedDates: 50,
      minUniqueMatchedSymbols: 10,
      maxTop1DateShare: 0.12,
    },
  })
  await writeJson(replaySummaryPath, {
    kind: "tp12_year2hit_candidate_replay_summary_v1",
    status: "measured",
    dateRange: { from: "2025-01-02", to: "2026-04-17" },
    catalogPatternCount: 93,
    catalogMatchedPatternCount: 93,
    rawPatternMatch: { selectedRows: 10, hitRows: 5, hitRate: 0.5 },
    symbolDateUnion: { selectedRows: 10, hitRows: 5, hitRate: 0.5 },
    onePickPerDay: {
      selectedRows: 100,
      hitRows: 90,
      hitRate: 0.9,
      uniqueMatchedDates: 100,
      uniqueHitDates: 90,
      uniqueMatchedSymbols: 25,
      uniqueHitSymbols: 20,
      top1DateShare: 0.01,
    },
  })
  const passed = await buildTp12Year2hitOperatingGateSummary({
    replaySummaryPath,
    contractPath,
    outSummaryPath,
    outReportPath,
  })
  assert.equal(passed.status, "passed")
  assert.ok(passed.selected.wilsonLower95 >= 0.8)
  assert.ok((await fs.readFile(outReportPath, "utf8")).includes("Wilson lower95"))
  const cliResult = await execFileAsync(process.execPath, [
    path.resolve("tools/build_tp12_year2hit_operating_gate_summary.mjs"),
    `--replay-summary=${replaySummaryPath}`,
    `--contract-path=${contractPath}`,
    `--out-summary=${outSummaryPath}`,
  ])
  const cliPayload = JSON.parse(cliResult.stdout)
  assert.equal(cliPayload.selectionKey, "onePickPerDay")
  assert.equal(cliPayload.status, "passed")

  await writeJson(replaySummaryPath, {
    kind: "tp12_year2hit_candidate_replay_summary_v1",
    status: "measured",
    onePickPerDay: {
      selectedRows: 311,
      hitRows: 152,
      hitRate: 152 / 311,
      uniqueMatchedDates: 311,
      uniqueHitDates: 152,
      uniqueMatchedSymbols: 120,
      uniqueHitSymbols: 80,
      top1DateShare: 1 / 311,
    },
  })
  const failed = await buildTp12Year2hitOperatingGateSummary({
    replaySummaryPath,
    contractPath,
    outSummaryPath,
  })
  assert.equal(failed.status, "failed")
  assert.ok(failed.rejectReasons.includes("observed_hit_rate_below_target"))
  assert.ok(failed.rejectReasons.includes("wilson_lower95_below_target"))
  await assert.rejects(
    () =>
      buildTp12Year2hitOperatingGateSummary({
        replaySummaryPath,
        contractPath,
        outSummaryPath,
        failOnGateFailure: true,
      }),
    /operating gate failed/,
  )

  const interval = wilsonInterval({ hitRows: 90, selectedRows: 100 })
  assert.ok(interval.lower > 0.8)
  assert.ok(interval.upper <= 1)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_operating_gate")
