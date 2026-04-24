#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-hitfield-"))
const eventsPath = path.join(tmp, "events.jsonl")
await fs.writeFile(
  eventsPath,
  [
    { patternId: "oos_only", decisionDateKey: "2021-01-05", oosHit: true },
    { patternId: "oos_only", decisionDateKey: "2021-02-05", oosHit: true },
    { patternId: "train_hit", decisionDateKey: "2021-01-05", hitTarget: true },
    { patternId: "train_hit", decisionDateKey: "2021-02-05", hitTarget: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

const summary = await buildTp12Year2hitTrainGateSummary({
  eventsPath,
  trainDateFrom: "2021-01-01",
  trainDateTo: "2021-12-31",
  coreYears: [2021],
  minHitsPerYear: 2,
  hitField: "hitTarget",
})

assert.equal(summary.status, "passed")
assert.equal(summary.invalidRowCount, 2)
assert.equal(summary.survivorCount, 1)
assert.deepEqual(summary.survivorPatternIds, ["train_hit"])
assert.ok(!summary.survivorPatternIds.includes("oos_only"))

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_hit_field_contract")
