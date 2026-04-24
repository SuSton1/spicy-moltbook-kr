#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { freezeTp12Year2hitSurvivorCatalog } from "../src/lib/tp12_survivor_catalog_freeze.mjs"
import { sha256TextLines } from "../src/lib/tp12_year2hit_train_gate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-survivor-freeze-"))
try {
  const candidateCatalogPath = path.join(tmp, "candidate_catalog.jsonl")
  const qualityGateSummaryPath = path.join(tmp, "quality_gate_summary.json")
  const outCatalogPath = path.join(tmp, "survivor_catalog.jsonl")
  const outManifestPath = path.join(tmp, "survivor_catalog_manifest.json")
  await fs.writeFile(
    candidateCatalogPath,
    [
      { patternId: "p_keep", tokenSet: ["px:ret1_ge_0p03", "vol:relvol20_ge_2"], year2hitPassed: true },
      { patternId: "p_drop", tokenSet: ["px:gap_ge_0p04"], year2hitPassed: true },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  )
  await writeJson(qualityGateSummaryPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    passedSurvivorCount: 1,
    rejectedSurvivorCount: 1,
    passedPatternIds: ["p_keep"],
    passedPatternIdsSha256: sha256TextLines(["p_keep"]),
    passed: [
      {
        patternId: "p_keep",
        tokenSet: ["vol:relvol20_ge_2", "px:ret1_ge_0p03"],
        matchRows: 30,
        hitRows: 12,
        rowPrecision: 0.4,
        matchedDateCount: 20,
        hitDateCount: 10,
        datePrecision: 0.5,
        uniqueMatchedSymbols: 18,
        uniqueHitSymbols: 9,
        top1HitDateShare: 0.1,
        top1MatchDateShare: 0.08,
      },
    ],
  })
  const { manifest } = await freezeTp12Year2hitSurvivorCatalog({
    candidateCatalogPath,
    qualityGateSummaryPath,
    outCatalogPath,
    outManifestPath,
  })
  const survivorRows = (await fs.readFile(outCatalogPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  assert.equal(manifest.status, "passed")
  assert.equal(manifest.survivorCount, 1)
  assert.equal(manifest.survivorPatternIdsSha256, sha256TextLines(["p_keep"]))
  assert.equal(survivorRows.length, 1)
  assert.equal(survivorRows[0].patternId, "p_keep")
  assert.deepEqual(survivorRows[0].tokenSet, ["px:ret1_ge_0p03", "vol:relvol20_ge_2"])

  await writeJson(qualityGateSummaryPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    passedSurvivorCount: 1,
    passedPatternIds: ["missing"],
    passedPatternIdsSha256: sha256TextLines(["missing"]),
    passed: [{ patternId: "missing", tokenSet: ["x"] }],
  })
  await assert.rejects(
    () =>
      freezeTp12Year2hitSurvivorCatalog({
        candidateCatalogPath,
        qualityGateSummaryPath,
        outCatalogPath,
        outManifestPath,
      }),
    /quality survivors missing from candidate catalog/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_survivor_catalog_freeze")
