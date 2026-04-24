#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-core-leak-"))
const eventsPath = path.join(tmp, "events.jsonl")
await fs.writeFile(
  eventsPath,
  [
    { patternId: "a", decisionDateKey: "2023-01-03", hitTarget: true },
    { patternId: "a", decisionDateKey: "2023-02-03", hitTarget: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

await assert.rejects(
  () =>
    buildTp12Year2hitTrainGateSummary({
      eventsPath,
      trainDateFrom: "2023-01-01",
      trainDateTo: "2023-12-31",
      coreYears: [2023, 2024],
      minHitsPerYear: 2,
      requireCoreYearsWithinTrain: true,
    }),
  /core years outside train date range: 2024/,
)

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_core_year_leakage")
