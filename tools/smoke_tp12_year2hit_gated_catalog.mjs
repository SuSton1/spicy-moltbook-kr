#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitGatedCatalog } from "../src/lib/tp12_year2hit_gated_catalog.mjs"
import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-gated-catalog-"))
const eventsPath = path.join(tmp, "events.jsonl")
const gatePath = path.join(tmp, "gate.json")
const catalogPath = path.join(tmp, "catalog.jsonl")
const outCatalogPath = path.join(tmp, "gated.jsonl")
const outManifestPath = path.join(tmp, "manifest.json")

await fs.writeFile(
  eventsPath,
  [
    { patternId: "pass_a", decisionDateKey: "2022-01-03", hitTarget: true },
    { patternId: "pass_a", decisionDateKey: "2022-02-03", hitTarget: true },
    { patternId: "fail_a", decisionDateKey: "2022-01-03", hitTarget: true },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)
const gate = await buildTp12Year2hitTrainGateSummary({
  eventsPath,
  trainDateFrom: "2022-01-01",
  trainDateTo: "2022-12-31",
  coreYears: [2022],
  minHitsPerYear: 2,
  failOnZeroSurvivors: true,
  outPath: gatePath,
})
await fs.writeFile(
  catalogPath,
  [
    { ruleId: "pass_a", payload: "keep" },
    { ruleId: "fail_a", payload: "drop" },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8",
)

const { manifest } = await buildTp12Year2hitGatedCatalog({
  sourceCatalogPath: catalogPath,
  trainGateSummaryPath: gatePath,
  outCatalogPath,
  outManifestPath,
  expectedGateSha256: gate.survivorPatternIdsSha256,
})
const rows = (await fs.readFile(outCatalogPath, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))

assert.equal(manifest.status, "passed")
assert.equal(manifest.gatedPatternCount, 1)
assert.equal(rows.length, 1)
assert.equal(rows[0].ruleId, "pass_a")

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_gated_catalog")
