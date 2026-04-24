#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12PathQualityLabelAudit } from "../src/lib/tp12_path_quality_label_audit.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-path-quality-audit-"))
try {
  const labelsPath = path.join(tmp, "candidate_events.jsonl")
  const candidatesPath = path.join(tmp, "candidate_universe.jsonl")
  const predictionsPath = path.join(tmp, "selector_predictions.jsonl")
  await writeJsonl(labelsPath, [
    {
      symbol: "000001",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2021-01-05",
      hitTarget: false,
      maxForwardReturn: 0.09,
      minForwardReturn: -0.02,
      maxForwardDrawdown: -0.02,
    },
    {
      symbol: "000002",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2021-01-05",
      hitTarget: true,
      hitDateKey: "2021-01-05",
      maxForwardReturn: 0.16,
      minForwardReturn: -0.01,
      maxForwardDrawdown: -0.01,
    },
    {
      symbol: "000003",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2021-01-05",
      hitTarget: false,
      maxForwardReturn: 0.02,
      minForwardReturn: -0.09,
      maxForwardDrawdown: -0.09,
    },
    {
      symbol: "000004",
      decisionDateKey: "2021-01-05",
      entryDateKey: "2021-01-06",
      hitTarget: false,
      maxForwardReturn: 0.03,
      minForwardReturn: -0.13,
      maxForwardDrawdown: -0.13,
    },
    {
      symbol: "000001",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2021-01-05",
      hitTarget: false,
      maxForwardReturn: 0.09,
      minForwardReturn: -0.02,
      maxForwardDrawdown: -0.02,
    },
  ])
  await writeJsonl(candidatesPath, [
    {
      symbol: "000001",
      decisionDateKey: "2021-01-04",
      hitTarget: false,
      selectorScore: 3,
      supportClusterCount: 2,
      liveStrongFeature: 1,
      liveWeakFeature: 10,
    },
    {
      symbol: "000002",
      decisionDateKey: "2021-01-04",
      hitTarget: true,
      selectorScore: 2,
      supportClusterCount: 1,
      liveStrongFeature: 5,
      liveWeakFeature: 3,
    },
    {
      symbol: "000003",
      decisionDateKey: "2021-01-04",
      hitTarget: false,
      selectorScore: 1,
      supportClusterCount: 1,
      liveStrongFeature: 0,
      liveWeakFeature: 12,
    },
    {
      symbol: "000004",
      decisionDateKey: "2021-01-05",
      hitTarget: false,
      selectorScore: 4,
      supportClusterCount: 1,
      liveStrongFeature: 2,
      liveWeakFeature: 8,
    },
  ])
  await writeJsonl(predictionsPath, [
    {
      action: "select",
      symbol: "000001",
      decisionDateKey: "2021-01-04",
      hitTarget: false,
      score: 3,
      supportClusterCount: 2,
      candidateCount: 3,
    },
    {
      action: "select",
      symbol: "000004",
      decisionDateKey: "2021-01-05",
      hitTarget: false,
      score: 4,
      supportClusterCount: 1,
      candidateCount: 1,
    },
  ])
  const summary = await buildTp12PathQualityLabelAudit({
    pathLabelPath: labelsPath,
    candidatePath: candidatesPath,
    predictionsPath,
    outSummaryPath: path.join(tmp, "summary.json"),
    outSelectedPath: path.join(tmp, "selected.jsonl"),
    outDailyPath: path.join(tmp, "daily.jsonl"),
    dateFrom: "2021-01-01",
    dateTo: "2021-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    separabilityMinComparisonCount: 1,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.pathLabelRowCount, 5)
  assert.equal(summary.pathLabelSymbolDateCount, 4)
  assert.equal(summary.candidateRows, 4)
  assert.equal(summary.candidateDateCount, 2)
  assert.equal(summary.datesWithPositiveCandidate, 1)
  assert.equal(summary.dailyOracleHitRate, 0.5)
  assert.equal(summary.selectedRows, 2)
  assert.equal(summary.hitRows, 0)
  assert.equal(summary.falsePositiveWithSameDateHitCount, 1)
  assert.equal(summary.falsePositiveNoSameDateHitCount, 1)
  assert.deepEqual(summary.selectedFalsePositivePathQuality.reasonCounts, {
    candidate_generation_no_hit_that_day: 1,
    ranker_missed_same_date_hit: 1,
  })
  assert.deepEqual(summary.selectedFalsePositivePathQuality.classCounts, {
    hard_negative: 1,
    near_miss: 1,
  })
  assert(summary.sameDatePositiveAsOfFeatureSeparability.topPositiveGreaterFields.some((row) => row.field === "liveStrongFeature" && row.positiveGreaterShare === 1))
  assert(summary.sameDatePositiveAsOfFeatureSeparability.topPositiveLessFields.some((row) => row.field === "liveWeakFeature" && row.positiveLessShare === 1))

  const smallThresholdSummary = await buildTp12PathQualityLabelAudit({
    pathLabelPath: labelsPath,
    candidatePath: candidatesPath,
    predictionsPath,
    outSummaryPath: path.join(tmp, "summary_small_threshold.json"),
    outSelectedPath: path.join(tmp, "selected_small_threshold.jsonl"),
    outDailyPath: path.join(tmp, "daily_small_threshold.jsonl"),
    dateFrom: "2021-01-01",
    dateTo: "2021-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    separabilityMinComparisonCount: 1,
  })
  const greaterFields = smallThresholdSummary.sameDatePositiveAsOfFeatureSeparability.topPositiveGreaterFields
  assert(greaterFields.some((row) => row.field === "liveStrongFeature" && row.positiveGreaterShare === 1))
  const lessFields = smallThresholdSummary.sameDatePositiveAsOfFeatureSeparability.topPositiveLessFields
  assert(lessFields.some((row) => row.field === "liveWeakFeature" && row.positiveLessShare === 1))

  await writeJsonl(path.join(tmp, "bad_oos.jsonl"), [
    { symbol: "000009", decisionDateKey: "2025-01-02", hitTarget: false, maxForwardReturn: 0.01, minForwardReturn: -0.01 },
  ])
  await assert.rejects(
    () =>
      buildTp12PathQualityLabelAudit({
        pathLabelPath: path.join(tmp, "bad_oos.jsonl"),
        candidatePath: candidatesPath,
        predictionsPath,
        outSummaryPath: path.join(tmp, "bad_summary.json"),
        outSelectedPath: path.join(tmp, "bad_selected.jsonl"),
        outDailyPath: path.join(tmp, "bad_daily.jsonl"),
        forbiddenDateFrom: "2025-01-02",
        forbiddenDateTo: "2026-04-17",
      }),
    /forbidden date range/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_path_quality_label_audit")
