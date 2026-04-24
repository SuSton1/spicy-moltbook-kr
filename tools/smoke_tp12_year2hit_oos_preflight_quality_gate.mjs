#!/usr/bin/env node

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12Year2hitOosPreflight } from "./assert_tp12_year2hit_oos_preflight.mjs"
import { sha256TextLines } from "../src/lib/tp12_year2hit_train_gate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const fileSha = async (filePath) => createHash("sha256").update(await fs.readFile(filePath)).digest("hex")

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-oos-preflight-quality-"))
try {
  const gatePath = path.join(tmp, "gate.json")
  const catalogPath = path.join(tmp, "gated.jsonl")
  const manifestPath = path.join(tmp, "manifest.json")
  const qualityPath = path.join(tmp, "quality.json")
  const survivorPatternIds = ["p"]
  const survivorPatternIdsSha256 = sha256TextLines(survivorPatternIds)
  await writeJson(gatePath, {
    kind: "tp12_year2hit_train_gate_summary_v2",
    status: "passed",
    survivorCount: 1,
    survivorPatternIds,
    survivorPatternIdsSha256,
    trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  })
  await fs.writeFile(catalogPath, `${JSON.stringify({ patternId: "p" })}\n`, "utf8")
  await writeJson(manifestPath, {
    kind: "tp12_year2hit_gated_catalog_manifest_v1",
    status: "passed",
    outCatalogPath: catalogPath,
    outCatalogSha256: await fileSha(catalogPath),
    survivorCount: 1,
    survivorPatternIdsSha256,
  })
  await writeJson(qualityPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    survivorPatternIdsSha256,
    passedPatternIdsSha256: survivorPatternIdsSha256,
    passedSurvivorCount: 1,
  })
  const summary = await assertTp12Year2hitOosPreflight({
    trainGateSummaryPath: gatePath,
    gatedCatalogPath: catalogPath,
    gatedCatalogManifestPath: manifestPath,
    qualityGateSummaryPath: qualityPath,
    oosFrom: "2025-01-02",
    oosTo: "2026-04-17",
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.qualityPassedSurvivorCount, 1)
  await writeJson(qualityPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    survivorPatternIdsSha256,
    passedPatternIdsSha256: survivorPatternIdsSha256,
    passedSurvivorCount: 0,
  })
  await assert.rejects(
    () =>
      assertTp12Year2hitOosPreflight({
        trainGateSummaryPath: gatePath,
        gatedCatalogPath: catalogPath,
        gatedCatalogManifestPath: manifestPath,
        qualityGateSummaryPath: qualityPath,
      }),
    /quality gate summary has zero passed survivors/,
  )
  await writeJson(qualityPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    survivorPatternIdsSha256,
    passedPatternIdsSha256: sha256TextLines(["other"]),
    passedSurvivorCount: 1,
  })
  await assert.rejects(
    () =>
      assertTp12Year2hitOosPreflight({
        trainGateSummaryPath: gatePath,
        gatedCatalogPath: catalogPath,
        gatedCatalogManifestPath: manifestPath,
        qualityGateSummaryPath: qualityPath,
      }),
    /quality gate passed survivor hash mismatch/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_oos_preflight_quality_gate")
