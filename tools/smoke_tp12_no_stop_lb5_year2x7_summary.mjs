#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, pathExists, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadTp12NoStopLb5Year2x7ResearchContract } from "../src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"
import { buildTp12NoStopLb5Year2x7ReplaySummary } from "../src/lib/tp12_no_stop_lb5_year2x7_report.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoStopLb5Year2x7ResearchContract({ cwd })
  const outDir = path.join(cwd, "artifacts", "checks", "smoke_tp12_no_stop_lb5_year2x7_summary")
  const trainApplyDir = path.join(outDir, "train_apply")
  const oosApplyDir = path.join(outDir, "oos_apply")
  await ensureDir(trainApplyDir)
  await ensureDir(oosApplyDir)

  const auditSummaryPath = path.join(outDir, "year2x7_audit_summary.json")
  const freezeResultPath = path.join(outDir, "freeze_result.json")
  const outPath = path.join(outDir, "year2x7_replay_summary.json")
  await writeJson(auditSummaryPath, {
    survivorRuleCount: 2,
    totalRuleCount: 10,
    survivorShare: 0.2,
    coreYears: contract.yearCoverage.coreYears,
    minHitsPerCoreYear: contract.yearCoverage.minHitsPerCoreYear,
    ruleIdsWithZeroCoreYearHits: 4,
    ruleIdsBelowTargetButNonZeroCoreYears: 4,
  })
  await writeJson(freezeResultPath, {
    outPath: "/tmp/smoke/catalog.json",
    catalogContentSha256: "sha256_a",
    ruleIdsSha256: "sha256_b",
  })
  await writeJson(path.join(trainApplyDir, "summary.json"), { ok: true })
  await writeJson(path.join(oosApplyDir, "summary.json"), { ok: true })
  await writeJsonl(path.join(trainApplyDir, "deduped_symbols.jsonl"), [
    { dateKey: "2021-01-03", symbol: "000001", outcomeHitTarget: true },
    { dateKey: "2021-01-04", symbol: "000002", outcomeHitTarget: true },
    { dateKey: "2021-01-04", symbol: "000003", outcomeHitTarget: false },
  ])
  await writeJsonl(path.join(oosApplyDir, "deduped_symbols.jsonl"), [
    { dateKey: "2025-01-02", symbol: "100001", outcomeHitTarget: true },
    { dateKey: "2025-01-03", symbol: "100002", outcomeHitTarget: false },
    { dateKey: "2025-01-03", symbol: "100003", outcomeHitTarget: true },
    { dateKey: "2025-01-03", symbol: "100004", outcomeHitTarget: false },
  ])

  const result = await buildTp12NoStopLb5Year2x7ReplaySummary({
    contract,
    auditSummaryPath,
    freezeResultPath,
    trainApplyDir,
    oosApplyDir,
    outPath,
    runId: "smoke_year2x7",
  })
  const summary = await readJson(result.outPath, null)
  assert.equal(summary?.kind, "tp12_no_stop_lb5_year2x7_replay_summary_v1")
  assert.equal(summary?.status, "measured")
  assert.equal(summary?.frozenSubset?.survivorRuleCount, 2)
  assert.equal(summary?.train?.selectedRows, 3)
  assert.equal(summary?.train?.hitRows, 2)
  assert.equal(summary?.oos?.selectedRows, 4)
  assert.equal(summary?.oos?.hitRows, 2)
  assert.equal(summary?.oos?.uniqueMatchedDates, 2)
  assert.equal(pathExists(result.reportPath), true)
  console.log("ok smoke_tp12_no_stop_lb5_year2x7_summary")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
