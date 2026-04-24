#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-invalid-"))
const eventsPath = path.join(tmp, "events.jsonl")
await fs.writeFile(
  eventsPath,
  [
    { patternId: "valid_a", decisionDateKey: "2020-01-03", hitTarget: true },
    { patternId: "valid_a", decisionDateKey: "2020-02-03", hitTarget: true },
    { patternId: "missing_hit_field", decisionDateKey: "2020-03-03", oosHit: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

await assert.rejects(
  () =>
    buildTp12Year2hitTrainGateSummary({
      eventsPath,
      trainDateFrom: "2020-01-01",
      trainDateTo: "2020-12-31",
      coreYears: [2020],
      minHitsPerYear: 2,
      hitField: "hitTarget",
      failOnInvalidRows: true,
      failOnZeroSurvivors: true,
    }),
  /invalid_rows:1/,
)

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_invalid_row_failfast")
