#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJsonl } from "../src/lib/io.mjs"
import { buildTp12ExecutableGlobalGreedyStabilityAudit } from "./audit_tp12_executable_global_greedy_stability.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-greedy-stability-audit-"))

const metrics = ({
  totalRows,
  hits,
  falsePositives,
  executableHitDatesByYear,
  year2Passed,
}) => ({
  totalRows,
  chartHitRows: hits,
  chartFalseRows: falsePositives,
  executableRows: totalRows,
  nonExecutableRows: 0,
  executableHitRows: hits,
  operationalFalsePositiveRows: falsePositives,
  executableMissRows: falsePositives,
  nonExecutableChartHitRows: 0,
  nonExecutableChartMissRows: 0,
  executablePrecisionPenalizingNonExecutable: totalRows > 0 ? hits / totalRows : 0,
  executableHitDatesByYear,
  executableHitSymbolDatesByYear: executableHitDatesByYear,
  minExecutableHitDatesPerObservedYear: Math.min(...Object.values(executableHitDatesByYear)),
  minExecutableHitSymbolDatesPerObservedYear: Math.min(...Object.values(executableHitDatesByYear)),
  year2ExecutableHitPassedOnObservedYears: year2Passed,
})

try {
  const survivorsPath = path.join(tmp, "survivors.jsonl")
  const trainReplayPath = path.join(tmp, "train_replay.jsonl")
  const oosReplayPath = path.join(tmp, "oos_replay.jsonl")
  const outDir = path.join(tmp, "audit")

  await writeJsonl(survivorsPath, [
    {
      coverId: "cover_small_stitched",
      baseType: "all_year2hit_rows",
      baseId: "global_zero_fp_tile_union",
      tiles: [
        {
          tileId: "tile_2016",
          baseType: "pattern",
          baseId: "P1",
          includeAtoms: [{ type: "pattern_include", item: "P1" }],
          vetoAtoms: [{ type: "feature_rank", field: "gapPct", direction: "ge", threshold: 0.95 }],
          metrics: {
            matchRows: 4,
            hitRows: 4,
            falsePositiveRows: 0,
            hitDatesByYear: { 2016: 2, 2017: 0, 2018: 0 },
            hitSymbolDatesByYear: { 2016: 2, 2017: 0, 2018: 0 },
          },
        },
        {
          tileId: "tile_2017",
          baseType: "cluster",
          baseId: "C2",
          includeAtoms: [{ type: "cluster_include", item: "C2" }],
          vetoAtoms: [],
          metrics: {
            matchRows: 4,
            hitRows: 4,
            falsePositiveRows: 0,
            hitDatesByYear: { 2016: 0, 2017: 2, 2018: 0 },
            hitSymbolDatesByYear: { 2016: 0, 2017: 2, 2018: 0 },
          },
        },
        {
          tileId: "tile_2018",
          baseType: "pattern",
          baseId: "P3",
          includeAtoms: [{ type: "token_include", item: "shape:x" }],
          vetoAtoms: [],
          metrics: {
            matchRows: 4,
            hitRows: 4,
            falsePositiveRows: 0,
            hitDatesByYear: { 2016: 0, 2017: 0, 2018: 2 },
            hitSymbolDatesByYear: { 2016: 0, 2017: 0, 2018: 2 },
          },
        },
      ],
    },
  ])

  await writeJsonl(trainReplayPath, [
    {
      coverId: "cover_small_stitched",
      metrics: metrics({
        totalRows: 12,
        hits: 12,
        falsePositives: 0,
        executableHitDatesByYear: { 2016: 2, 2017: 2, 2018: 2 },
        year2Passed: true,
      }),
    },
  ])

  await writeJsonl(oosReplayPath, [
    {
      coverId: "cover_small_stitched",
      metrics: metrics({
        totalRows: 5,
        hits: 1,
        falsePositives: 4,
        executableHitDatesByYear: { 2025: 1, 2026: 0 },
        year2Passed: false,
      }),
    },
  ])

  const summary = await buildTp12ExecutableGlobalGreedyStabilityAudit({
    survivorsPath,
    trainReplayPath,
    oosReplayPath,
    outDir,
    patchKey: "smoke",
  })

  assert.equal(summary.status, "completed")
  assert.equal(summary.survivorCoverCount, 1)
  assert.equal(summary.allCoversTrainOperationalZeroFpYear2, true)
  assert.equal(summary.fragilityCounts.smallTileDominatedLt8, 1)
  assert.equal(summary.fragilityCounts.allTilesYear2Incomplete, 1)
  assert.equal(summary.fragilityCounts.stitchedYearCoverage, 1)
  assert.equal(summary.oosDiagnostic.zeroOperationalFalsePositiveYear2CoverCount, 0)
  assert.equal(summary.verdict, "train_survivors_fragile_oos_failed")

  const scoresRaw = await fs.readFile(path.join(outDir, "stability_audit_cover_scores.jsonl"), "utf8")
  const score = JSON.parse(scoresRaw.trim())
  assert.equal(score.tileDiagnostics.tileSupport.medianMatchRows, 4)
  assert.equal(score.tileDiagnostics.uniqueBaseCount, 3)

  console.log("ok smoke_tp12_executable_global_greedy_stability_audit")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
