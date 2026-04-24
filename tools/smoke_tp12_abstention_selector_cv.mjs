#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { runTp12AbstentionSelectorCv } from "../src/lib/tp12_abstention_selector_cv.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-abstention-selector-"))
try {
  const featuresPath = path.join(tmp, "features.jsonl")
  const configPath = path.join(tmp, "selector.json")
  await writeJson(configPath, {
    selectionPolicyId: "fixture_cluster_score_v1",
    scoreField: "selectorScore",
    minScore: 1,
    minSupportClusterCount: 1,
    minDayScoreMargin: 0,
  })
  await writeJsonl(featuresPath, [
    {
      symbol: "000001",
      decisionDateKey: "2020-01-02",
      hitTarget: true,
      selectorScore: 2,
      supportClusterCount: 1,
      supportClusterIds: ["c1"],
      dayScoreMargin: 0.5,
      regimeId: "mid",
    },
    {
      symbol: "000002",
      decisionDateKey: "2020-01-02",
      hitTarget: false,
      selectorScore: 1.5,
      supportClusterCount: 1,
      supportClusterIds: ["c2"],
      dayScoreMargin: 0,
      regimeId: "mid",
    },
    {
      symbol: "000003",
      decisionDateKey: "2020-01-03",
      hitTarget: false,
      selectorScore: 0.5,
      supportClusterCount: 1,
      supportClusterIds: ["c3"],
      dayScoreMargin: 0,
      regimeId: "low",
    },
  ])
  const summary = await runTp12AbstentionSelectorCv({
    featuresPath,
    selectorConfigPath: configPath,
    outPredictionsPath: path.join(tmp, "predictions.jsonl"),
    outSummaryPath: path.join(tmp, "summary.json"),
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.selectedRows, 1)
  assert.equal(summary.hitRows, 1)
  assert.equal(summary.abstainedDateCount, 1)
  assert.equal(summary.concentration.topSymbolShare, 1)
  assert.equal(summary.concentration.topPatternClusterShare, 1)
  assert.equal(summary.concentration.topRegimeShare, 1)
  assert.equal(summary.concentration.topMonthShare, 1)
  assert.equal(summary.coverage.activeYearCount, 1)
  assert.equal(summary.coverage.activeMonthCount, 1)
  assert.deepEqual(summary.coverage.selectedByYear, { 2020: 1 })
  assert.deepEqual(summary.coverage.selectedByMonth, { "2020-01": 1 })

  await writeJson(path.join(tmp, "bad_selector.json"), { scoreField: "selectorScore" })
  await assert.rejects(
    () =>
      runTp12AbstentionSelectorCv({
        featuresPath,
        selectorConfigPath: path.join(tmp, "bad_selector.json"),
        outPredictionsPath: path.join(tmp, "bad_predictions.jsonl"),
        outSummaryPath: path.join(tmp, "bad_summary.json"),
      }),
    /selectionPolicyId/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_abstention_selector_cv")
