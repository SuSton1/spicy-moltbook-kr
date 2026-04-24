#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12Year2hitOperationalFoldStabilityGate } from "../src/lib/tp12_year2hit_operational_fold_stability_gate.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const operationalRow = ({ patternId, symbol, decisionDateKey, chartHitTarget = true, entryExecutable = true }) => {
  const operationalHitTarget = chartHitTarget === true && entryExecutable === true
  const operationalMissReasons = operationalHitTarget
    ? []
    : [
        ...(chartHitTarget ? [] : ["not_chart_hit"]),
        ...(entryExecutable ? [] : ["entry_volume_lte_zero"]),
      ]
  return {
    patternId,
    symbol,
    decisionDateKey,
    entryDateKey: decisionDateKey,
    executionPolicyId: "tp12_executable_hit_next_open_gap29p5_volume_v1",
    chartHitTarget,
    entryExecutable,
    operationalHitTarget,
    operationalMissReasons,
  }
}

const assertRejectsMessage = async (fn, pattern) => {
  let thrown = null
  try {
    await fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error)
  assert.match(thrown.message, pattern)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-fold-stability-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  const eventsPath = path.join(tmp, "events.jsonl")
  const metadataPath = path.join(tmp, "metadata.jsonl")
  const summaryPath = path.join(tmp, "summary.json")
  const stablePath = path.join(tmp, "stable.jsonl")
  const rejectedPath = path.join(tmp, "rejected.jsonl")

  await writeJson(contractPath, {
    kind: "tp12_train_internal_validation_protocol_contract_v1",
    dateRanges: {
      internalValidation: { from: "2020-01-01", to: "2021-12-31" },
      lockedFuture: { from: "2025-01-02", to: null },
    },
    hitContract: { hitDefinition: "operational_hit_v1", hitField: "operationalHitTarget" },
    foldValidation: {
      coreYears: [2020, 2021],
      minValidationOperationalHitDatesPerYear: 2,
      minValidationOperationalHitSymbolDatesPerYear: 2,
      maxValidationOperationalMissRows: 0,
      maxValidationNotChartHitRows: 0,
      minStablePatternCount: 1,
      failOnGateFailure: true,
    },
    structuralFragilityGate: {
      requirePatternMetadata: true,
      rejectFlags: ["year_stitched_cover", "small_tile_dominated"],
    },
    monthlyGate: {
      requireMonthlyGate: true,
      requireExplicitFullMonthKeys: true,
      fullMonthKeys: ["2020-01", "2020-02", "2021-01", "2021-02"],
      targetRecommendationsPerFullMonth: 1,
      targetOperationalHitsPerFullMonth: 1,
      maxRecommendationsPerDecisionDate: 1,
    },
  })

  const rows = []
  for (const year of [2020, 2021]) {
    rows.push(operationalRow({ patternId: "P_STABLE", symbol: `ST${year}A`, decisionDateKey: `${year}-01-02` }))
    rows.push(operationalRow({ patternId: "P_STABLE", symbol: `ST${year}B`, decisionDateKey: `${year}-02-03` }))
    rows.push(operationalRow({ patternId: "P_MISS", symbol: `MS${year}A`, decisionDateKey: `${year}-01-06` }))
    rows.push(operationalRow({ patternId: "P_MISS", symbol: `MS${year}B`, decisionDateKey: `${year}-02-07` }))
    rows.push(operationalRow({ patternId: "P_STITCHED", symbol: `YS${year}A`, decisionDateKey: `${year}-01-08` }))
    rows.push(operationalRow({ patternId: "P_STITCHED", symbol: `YS${year}B`, decisionDateKey: `${year}-02-10` }))
  }
  rows.push(
    operationalRow({
      patternId: "P_MISS",
      symbol: "MSMISS",
      decisionDateKey: "2021-03-02",
      chartHitTarget: false,
      entryExecutable: true,
    }),
  )
  await writeJsonl(eventsPath, rows)
  await writeJsonl(metadataPath, [
    { patternId: "P_STABLE", tileDiagnostics: { flags: {} } },
    { patternId: "P_MISS", tileDiagnostics: { flags: {} } },
    { patternId: "P_STITCHED", tileDiagnostics: { flags: { stitchedYearCoverage: true } } },
  ])

  const summary = await buildTp12Year2hitOperationalFoldStabilityGate({
    operationalEventsPath: eventsPath,
    patternMetadataPath: metadataPath,
    contractPath,
    outSummaryPath: summaryPath,
    outStablePatternsPath: stablePath,
    outRejectedPatternsPath: rejectedPath,
  })
  assert.equal(summary.status, "passed")
  assert.deepEqual(summary.stablePatternIds, ["P_STABLE"])
  assert.equal(summary.monthlyGate.rejectReasons.length, 0)

  const failedSummaryPath = path.join(tmp, "failed_summary.json")
  await assertRejectsMessage(
    () =>
      buildTp12Year2hitOperationalFoldStabilityGate({
        operationalEventsPath: eventsPath,
        patternMetadataPath: metadataPath,
        contractPath,
        outSummaryPath: failedSummaryPath,
        minStablePatternCount: 2,
      }),
    /stable_pattern_count_below_min/,
  )

  const futureEventsPath = path.join(tmp, "future_events.jsonl")
  await writeJsonl(futureEventsPath, [
    operationalRow({ patternId: "P_FUTURE", symbol: "FUT", decisionDateKey: "2025-01-02" }),
  ])
  await assertRejectsMessage(
    () =>
      buildTp12Year2hitOperationalFoldStabilityGate({
        operationalEventsPath: futureEventsPath,
        contractPath,
        outSummaryPath: path.join(tmp, "future_summary.json"),
      }),
    /locked future row cannot enter train internal validation/,
  )

  console.log("ok smoke_tp12_year2hit_operational_fold_stability_gate")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
