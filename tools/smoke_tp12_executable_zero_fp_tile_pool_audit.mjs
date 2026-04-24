#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJsonl } from "../src/lib/io.mjs"
import { buildTp12ExecutableZeroFpTilePoolAudit } from "./audit_tp12_executable_zero_fp_tile_pool.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-zero-fp-tile-pool-audit-"))

try {
  const tilesPath = path.join(tmp, "tiles.jsonl")
  const outDir = path.join(tmp, "audit")

  await writeJsonl(tilesPath, [
    {
      tileId: "tile_one_year_small",
      baseType: "pattern",
      baseId: "P1",
      metrics: {
        matchRows: 6,
        hitRows: 6,
        falsePositiveRows: 0,
        totalHitSymbolDates: 6,
        minHitDatesPerYear: 0,
        year2hitPassed: false,
        hitDatesByYear: { 2016: 2, 2017: 0, 2018: 0 },
        hitSymbolDatesByYear: { 2016: 2, 2017: 0, 2018: 0 },
      },
    },
    {
      tileId: "tile_two_year_large",
      baseType: "cluster",
      baseId: "C2",
      metrics: {
        matchRows: 12,
        hitRows: 12,
        falsePositiveRows: 0,
        totalHitSymbolDates: 12,
        minHitDatesPerYear: 0,
        year2hitPassed: false,
        hitDatesByYear: { 2016: 2, 2017: 2, 2018: 0 },
        hitSymbolDatesByYear: { 2016: 2, 2017: 2, 2018: 0 },
      },
    },
    {
      tileId: "tile_three_year_year2",
      baseType: "pattern",
      baseId: "P3",
      metrics: {
        matchRows: 18,
        hitRows: 18,
        falsePositiveRows: 0,
        totalHitSymbolDates: 18,
        minHitDatesPerYear: 2,
        year2hitPassed: true,
        hitDatesByYear: { 2016: 2, 2017: 2, 2018: 2 },
        hitSymbolDatesByYear: { 2016: 2, 2017: 2, 2018: 2 },
      },
    },
  ])

  const summary = await buildTp12ExecutableZeroFpTilePoolAudit({
    tilesPath,
    outDir,
    patchKey: "smoke",
    thresholds: {
      minMatchRows: 10,
      minHitRows: 10,
      minPositiveYears: 2,
      minPositiveSymbolDateYears: 2,
      requireYear2Hit: false,
    },
  })

  assert.equal(summary.tilePoolCount, 3)
  assert.equal(summary.stableTileCandidateCount, 2)
  assert.equal(summary.thresholdDiagnostics.minPositiveYearsGe2, 2)
  assert.equal(summary.thresholdDiagnostics.matchRowsGe10AndPositiveYearsGe2, 2)
  assert.equal(summary.thresholdDiagnostics.matchRowsGe10AndYear2HitPassed, 1)

  const stableRows = (await fs.readFile(path.join(outDir, "stable_tile_candidates.jsonl"), "utf8")).trim().split(/\n/).map(JSON.parse)
  assert.deepEqual(stableRows.map((row) => row.tileId), ["tile_three_year_year2", "tile_two_year_large"])

  console.log("ok smoke_tp12_executable_zero_fp_tile_pool_audit")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
