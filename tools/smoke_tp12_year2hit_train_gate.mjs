#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-train-gate-"))
const eventsPath = path.join(tmp, "events.jsonl")
const rows = [
  { patternId: "pass_a", decisionDateKey: "2017-01-03", hitTarget: true },
  { patternId: "pass_a", decisionDateKey: "2017-02-03", hitTarget: true },
  { patternId: "pass_a", decisionDateKey: "2018-01-03", hitTarget: true },
  { patternId: "pass_a", decisionDateKey: "2018-02-03", hitTarget: true },
  { patternId: "fail_same_date", decisionDateKey: "2017-01-03", hitTarget: true },
  { patternId: "fail_same_date", decisionDateKey: "2017-01-03", hitTarget: true },
  { patternId: "fail_same_date", decisionDateKey: "2018-01-03", hitTarget: true },
  { patternId: "fail_same_date", decisionDateKey: "2018-02-03", hitTarget: true },
  { patternId: "ignored_oos", decisionDateKey: "2024-01-03", hitTarget: true },
]
await fs.writeFile(eventsPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")

const summary = await buildTp12Year2hitTrainGateSummary({
  eventsPath,
  trainDateFrom: "2017-01-01",
  trainDateTo: "2018-12-31",
  coreYears: [2017, 2018],
  minHitsPerYear: 2,
})

assert.equal(summary.yearHitMetric, "unique_decision_dates")
assert.equal(summary.survivorCount, 1)
assert.deepEqual(summary.survivors.map((row) => row.patternId), ["pass_a"])
const failed = summary.rejected.find((row) => row.patternId === "fail_same_date")
assert.ok(failed)
assert.equal(failed.yearHitCounts["2017"], 1)
assert.deepEqual(failed.belowMinYears, [2017])

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_train_gate")
