#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, readJsonl } from "../src/lib/io.mjs"
import { main as buildTechniqueTemplateFilteredPackMain } from "./build_technique_template_filtered_pack.mjs"

const main = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "technique-template-filter-"))
  const inputDir = path.join(tempDir, "input")
  const inputPath = path.join(inputDir, "daily_pack.jsonl")
  const outDir = path.join(tempDir, "out")
  await fs.mkdir(inputDir, { recursive: true })
  await fs.writeFile(
    inputPath,
    [
      JSON.stringify({
        symbol: "005930",
        decisionDateKey: "2024-05-13",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        labels: { tp12_no_stop_hit_3d: true },
        numericFeatureMap: {
          "trend.closeOverMa120": 0.02,
          "level.closeNearHigh20": 0.88,
          "volume.valueRatio20": 1.42,
        },
      }),
      JSON.stringify({
        symbol: "000660",
        decisionDateKey: "2024-05-14",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        labels: { tp12_no_stop_hit_3d: false },
        numericFeatureMap: {
          "trend.closeOverMa120": -0.02,
          "level.closeNearHigh20": 0.55,
          "volume.valueRatio20": 0.8,
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  )

  const sourceSummary = {
    period: { from: "2024-05-01", to: "2024-05-31" },
    requestedPeriod: { from: "2024-05-01", to: "2024-05-31" },
    rowsWritten: 2,
    positiveRows: 1,
    negativeRows: 1,
    nullOutcomeRows: 0,
    uniqueSymbols: 2,
    selectedDecisionDateCount: 2,
    selectedDecisionMonthCount: 1,
    outputCoverage: { from: "2024-05-13", to: "2024-05-14", count: 2 },
    coverageComplete: true,
    outputPath: inputPath,
    summaryPath: path.join(inputDir, "summary.json"),
    discoveryUniverseId: "recent_impulse_upto_5d",
    requestedLookbackTradingDays: 5,
    enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d", "recent_impulse_3d", "recent_impulse_4d", "recent_impulse_5d"],
    allowedStepALanes: ["recent_impulse_1d", "recent_impulse_2d", "recent_impulse_3d", "recent_impulse_4d", "recent_impulse_5d"],
    includeSameDayHigh8: false,
    boundaryFilter: {
      rowsAfter: 2,
      droppedForBoundaryCount: 0,
      droppedEntryBeforeBoundaryCount: 0,
      droppedExitAfterBoundaryCount: 0,
      boundaryFilteringApplied: true,
    },
    datasetContract: {
      rowCount: 2,
      minDateKey: "2024-05-13",
      maxDateKey: "2024-05-14",
      discoveryUniverseId: "recent_impulse_upto_5d",
      requestedLookbackTradingDays: 5,
      enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d", "recent_impulse_3d", "recent_impulse_4d", "recent_impulse_5d"],
      allowedStepALanes: ["recent_impulse_1d", "recent_impulse_2d", "recent_impulse_3d", "recent_impulse_4d", "recent_impulse_5d"],
      includeSameDayHigh8: false,
    },
  }
  await fs.writeFile(path.join(inputDir, "summary.json"), `${JSON.stringify(sourceSummary, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(inputDir, "manifest.json"),
    `${JSON.stringify({
      outputPath: inputPath,
      summaryPath: path.join(inputDir, "summary.json"),
      datasetContract: sourceSummary.datasetContract,
      discoveryUniverseId: sourceSummary.discoveryUniverseId,
      requestedLookbackTradingDays: sourceSummary.requestedLookbackTradingDays,
      enabledRecentImpulseLanes: sourceSummary.enabledRecentImpulseLanes,
      allowedStepALanes: sourceSummary.allowedStepALanes,
      includeSameDayHigh8: sourceSummary.includeSameDayHigh8,
      summary: sourceSummary,
    }, null, 2)}\n`,
    "utf8",
  )

  await buildTechniqueTemplateFilteredPackMain(
    [
      `--input=${inputPath}`,
      `--out-dir=${outDir}`,
      "--candidate-template-id=tpl_smoke",
      "--mechanism-id=MA_RETEST",
      "--scope-id=LOW_GAP_TOP",
      "--lookback-candidate-id=lb5",
      "--anchor-clause-ids=anchor_ma120_break",
      "--confirm-clause-ids=confirm_close_near_high,confirm_value_ratio",
      "--require-nonempty=true",
    ],
    { cwd: process.cwd() },
  )

  const rows = await readJsonl(path.join(outDir, "daily_pack.jsonl"), { strict: true })
  const filterSummary = await readJson(path.join(outDir, "filter_summary.json"), null)
  const summary = await readJson(path.join(outDir, "summary.json"), null)
  const manifest = await readJson(path.join(outDir, "manifest.json"), null)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].symbol, "005930")
  assert.equal(filterSummary.matchedRows, 1)
  assert.equal(filterSummary.matchedHitRows, 1)
  assert.equal(filterSummary.candidateTemplateId, "tpl_smoke")
  assert.equal(summary.period.from, "2024-05-01")
  assert.equal(summary.period.to, "2024-05-31")
  assert.equal(summary.rowsWritten, 1)
  assert.equal(summary.outputCoverage.from, "2024-05-13")
  assert.equal(summary.outputCoverage.to, "2024-05-13")
  assert.equal(summary.datasetContract.rowCount, 1)
  assert.equal(summary.datasetContract.minDateKey, "2024-05-13")
  assert.equal(summary.datasetContract.maxDateKey, "2024-05-13")
  assert.equal(manifest.summaryPath, path.join(outDir, "summary.json"))
  assert.equal(manifest.summary.period.from, "2024-05-01")
  assert.equal(manifest.summary.outputCoverage.to, "2024-05-13")
  assert.equal(manifest.datasetContract.rowCount, 1)

  await fs.rm(tempDir, { recursive: true, force: true })
  console.log("ok smoke_technique_template_filtered_pack")
}

await main()
