#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitQualityGateSummary } from "../src/lib/tp12_year2hit_quality_gate.mjs"
import { sha256TextLines } from "../src/lib/tp12_year2hit_train_gate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-quality-gate-"))
try {
  const trainGateSummaryPath = path.join(tmp, "train_gate.json")
  const candidateCatalogPath = path.join(tmp, "catalog.jsonl")
  const candidateEventsPath = path.join(tmp, "events.jsonl")
  const outSummaryPath = path.join(tmp, "quality.json")
  const outFilteredTrainGateSummaryPath = path.join(tmp, "quality_filtered_gate.json")
  const survivorPatternIds = ["pass_good", "reject_concentrated"]
  await writeJson(trainGateSummaryPath, {
    kind: "tp12_year2hit_train_gate_summary_v2",
    status: "passed",
    survivorPatternIds,
    survivorPatternIdsSha256: sha256TextLines(survivorPatternIds),
  })
  await writeJsonl(candidateCatalogPath, [
    { patternId: "pass_good", tokenSet: ["a", "b"], year2hitPassed: true },
    { patternId: "reject_concentrated", tokenSet: ["c", "d"], year2hitPassed: true },
  ])
  await writeJsonl(candidateEventsPath, [
    { patternId: "pass_good", symbol: "000001", decisionDateKey: "2020-01-03", hitTarget: true },
    { patternId: "pass_good", symbol: "000002", decisionDateKey: "2020-01-04", hitTarget: true },
    { patternId: "pass_good", symbol: "000003", decisionDateKey: "2020-01-05", hitTarget: true },
    { patternId: "pass_good", symbol: "000004", decisionDateKey: "2020-01-06", hitTarget: false },
    { patternId: "reject_concentrated", symbol: "000011", decisionDateKey: "2020-02-03", hitTarget: true },
    { patternId: "reject_concentrated", symbol: "000012", decisionDateKey: "2020-02-03", hitTarget: true },
    { patternId: "reject_concentrated", symbol: "000013", decisionDateKey: "2020-02-03", hitTarget: true },
    { patternId: "reject_concentrated", symbol: "000014", decisionDateKey: "2020-02-04", hitTarget: false },
  ])
  const summary = await buildTp12Year2hitQualityGateSummary({
    trainGateSummaryPath,
    candidateEventsPath,
    candidateCatalogPath,
    outSummaryPath,
    minRowPrecision: 0.5,
    minDatePrecision: 0.5,
    minHitRows: 3,
    minUniqueHitDates: 2,
    minUniqueHitSymbols: 3,
    maxTop1HitDateShare: 0.6,
    maxTop1MatchDateShare: 0.8,
    outFilteredTrainGateSummaryPath,
  })
  assert.equal(summary.status, "passed")
  assert.deepEqual(summary.passedPatternIds, ["pass_good"])
  assert.deepEqual(summary.rejectedPatternIds, ["reject_concentrated"])
  assert.equal(summary.passedPatternIdsSha256, sha256TextLines(["pass_good"]))
  assert.equal(summary.rejectReasonCounts.top1_hit_date_share_above_max, 1)
  const filteredGate = JSON.parse(await fs.readFile(outFilteredTrainGateSummaryPath, "utf8"))
  assert.equal(filteredGate.status, "passed")
  assert.deepEqual(filteredGate.survivorPatternIds, ["pass_good"])
  assert.equal(filteredGate.survivorPatternIdsSha256, sha256TextLines(["pass_good"]))
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_quality_gate")
