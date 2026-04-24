#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12Year2hitOosPreflight } from "./assert_tp12_year2hit_oos_preflight.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-oos-block-"))
const gatePath = path.join(tmp, "failed_gate.json")
const catalogPath = path.join(tmp, "gated.jsonl")
const manifestPath = path.join(tmp, "manifest.json")
await fs.writeFile(
  gatePath,
  JSON.stringify(
    {
      kind: "tp12_year2hit_train_gate_summary_v2",
      status: "failed",
      survivorCount: 0,
      survivorPatternIds: [],
      survivorPatternIdsSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
    },
    null,
    2,
  ) + "\n",
  "utf8",
)
await fs.writeFile(catalogPath, "", "utf8")
await fs.writeFile(
  manifestPath,
  JSON.stringify(
    {
      kind: "tp12_year2hit_gated_catalog_manifest_v1",
      status: "passed",
      outCatalogPath: catalogPath,
      outCatalogSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      survivorCount: 0,
      survivorPatternIdsSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    null,
    2,
  ) + "\n",
  "utf8",
)

await assert.rejects(
  () =>
    assertTp12Year2hitOosPreflight({
      trainGateSummaryPath: gatePath,
      gatedCatalogPath: catalogPath,
      gatedCatalogManifestPath: manifestPath,
    }),
  /train gate summary status is not passed/,
)

await fs.rm(tmp, { recursive: true, force: true })
console.log("ok smoke_tp12_year2hit_oos_blocked_without_train_gate")
