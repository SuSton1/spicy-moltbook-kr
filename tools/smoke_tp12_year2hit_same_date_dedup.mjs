#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-dedup-"))
const eventsPath = path.join(tmp, "events.jsonl")
await fs.writeFile(
  eventsPath,
  [
    { patternId: "same_day_multi_symbol", decisionDateKey: "2019-03-04", symbol: "000001", hitTarget: true },
    { patternId: "same_day_multi_symbol", decisionDateKey: "2019-03-04", symbol: "000002", hitTarget: true },
    { patternId: "same_day_multi_symbol", decisionDateKey: "2019-03-04", symbol: "000003", hitTarget: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

const summary = await buildTp12Year2hitTrainGateSummary({
  eventsPath,
  trainDateFrom: "2019-01-01",
  trainDateTo: "2019-12-31",
  coreYears: [2019],
  minHitsPerYear: 2,
})

assert.equal(summary.survivorCount, 0)
assert.equal(summary.rejected[0].trainHitRowCount, 3)
assert.equal(summary.rejected[0].yearHitCounts["2019"], 1)

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_same_date_dedup")
