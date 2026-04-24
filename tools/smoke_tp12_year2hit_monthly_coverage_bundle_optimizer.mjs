#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12Year2hitMonthlyCoverageBundleOptimizer } from "../src/lib/tp12_year2hit_monthly_coverage_bundle_optimizer.mjs"
import {
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { writeJsonlRows } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-monthly-coverage-bundle-"))

const patternRow = ({
  patternId,
  operationalHitRows,
  operationalMissRows = 0,
  nonExecutableRows = 0,
  precision = 1,
  minYearHits = 2,
}) => ({
  kind: "tp12_year2hit_executable_nonhit_purge_row_v1",
  patternId,
  status: "passed",
  eventRows: operationalHitRows + operationalMissRows,
  operationalHitRows,
  operationalMissRows,
  operationalPrecision: precision,
  nonExecutableRows,
  minOperationalHitDatesPerYear: minYearHits,
  minOperationalHitSymbolDatesPerYear: minYearHits,
})

const eventRow = ({ patternId, symbol, date, hit = true, executable = true }) => ({
  kind: "tp12_year2hit_operational_event_v1",
  patternId,
  symbol,
  decisionDateKey: date,
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  primaryHitField: TP12_OPERATIONAL_HIT_FIELD,
  executionPolicyId: TP12_EXECUTION_POLICY_ID,
  entryDateKey: "2020-01-02",
  chartHitTarget: hit,
  entryExecutable: executable,
  operationalHitTarget: hit && executable,
  operationalMissReasons: hit && executable ? [] : [hit ? "entry_gap_gte_29p5pct" : "not_chart_hit"],
})

const writeBaseContract = async (contractPath) =>
  writeJson(contractPath, {
    kind: "tp12_year2hit_monthly_coverage_bundle_optimizer_contract_v1",
    patchKey: "tp12_year2hit_monthly_coverage_bundle_optimizer_v1",
    dateRanges: {
      internalValidation: { from: "2020-01-01", to: "2020-12-31" },
      lockedFuture: { from: "2025-01-02", to: null },
    },
    hitContract: {
      hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
      hitField: TP12_OPERATIONAL_HIT_FIELD,
    },
    patternEligibility: {
      coreYears: [2020],
      minOperationalHitDatesPerYear: 2,
      minOperationalHitSymbolDatesPerYear: 2,
      minPatternOperationalPrecision: 1,
      maxPatternOperationalMissRows: 0,
      maxPatternNonExecutableRows: 0,
      minPatternOperationalHitRows: 4,
    },
    monthlyCoverage: {
      requireExplicitFullMonthKeys: true,
      fullMonthKeys: ["2020-01", "2020-02"],
      targetRecommendationsPerFullMonth: 5,
      targetOperationalHitsPerFullMonth: 5,
      minBundleOperationalPrecision: 1,
      minPatterns: 2,
      maxPatterns: 4,
      failOnGateFailure: true,
    },
    concentrationGate: {
      maxTopPatternHitShare: 0.7,
      maxTopPatternRecommendationShare: 0.7,
      maxTopSymbolRecommendationShare: 0.2,
    },
  })

try {
  const contractPath = path.join(tmp, "contract.json")
  const patternsPath = path.join(tmp, "patterns.jsonl")
  const eventsPath = path.join(tmp, "events.jsonl")
  const summaryPath = path.join(tmp, "summary.json")
  const bundlePath = path.join(tmp, "bundle.jsonl")
  const selectedPath = path.join(tmp, "selected.jsonl")
  const unionPath = path.join(tmp, "union.jsonl")
  const rejectedPath = path.join(tmp, "rejected.jsonl")
  await writeBaseContract(contractPath)

  await writeJsonlRows(patternsPath, [
    patternRow({ patternId: "P_A", operationalHitRows: 5 }),
    patternRow({ patternId: "P_B", operationalHitRows: 5 }),
    patternRow({
      patternId: "P_MISS",
      operationalHitRows: 5,
      operationalMissRows: 1,
      precision: 5 / 6,
    }),
  ])

  const rows = [
    eventRow({ patternId: "P_A", symbol: "A001", date: "2020-01-02" }),
    eventRow({ patternId: "P_A", symbol: "A002", date: "2020-01-03" }),
    eventRow({ patternId: "P_A", symbol: "A003", date: "2020-01-06" }),
    eventRow({ patternId: "P_A", symbol: "A004", date: "2020-02-03" }),
    eventRow({ patternId: "P_A", symbol: "A005", date: "2020-02-04" }),
    eventRow({ patternId: "P_B", symbol: "B001", date: "2020-01-07" }),
    eventRow({ patternId: "P_B", symbol: "B002", date: "2020-01-08" }),
    eventRow({ patternId: "P_B", symbol: "B003", date: "2020-02-05" }),
    eventRow({ patternId: "P_B", symbol: "B004", date: "2020-02-06" }),
    eventRow({ patternId: "P_B", symbol: "B005", date: "2020-02-07" }),
    eventRow({ patternId: "P_MISS", symbol: "M001", date: "2020-01-09" }),
    eventRow({ patternId: "P_MISS", symbol: "M002", date: "2020-02-10", hit: false }),
  ]
  await writeJsonlRows(eventsPath, rows)

  const summary = await buildTp12Year2hitMonthlyCoverageBundleOptimizer({
    eligiblePatternsPath: patternsPath,
    operationalEventsPath: eventsPath,
    contractPath,
    outSummaryPath: summaryPath,
    outBundlePath: bundlePath,
    outSelectedPatternsPath: selectedPath,
    outUnionRowsPath: unionPath,
    outRejectedPatternsPath: rejectedPath,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.bundleCount, 1)
  assert.deepEqual(summary.selectedPatternIds.sort(), ["P_A", "P_B"])
  assert.equal(summary.bundle.unionMetrics.operationalPrecision, 1)
  assert.equal(summary.bundle.unionMetrics.minRecommendationsPerFullMonth, 5)
  assert.equal(summary.bundle.unionMetrics.minOperationalHitsPerFullMonth, 5)
  assert.equal(summary.rejectedPatternRejectReasonCounts.pattern_precision_below_100pct_gate, 1)

  await assert.rejects(
    () =>
      buildTp12Year2hitMonthlyCoverageBundleOptimizer({
        eligiblePatternsPath: patternsPath,
        operationalEventsPath: eventsPath,
        contractPath,
        outSummaryPath: path.join(tmp, "bad-month-summary.json"),
        fullMonthKeys: ["2020-01", "2020-02", "2020-03"],
      }),
    /monthly_operational_hits_below_target:2020-03/,
  )

  const futureEventsPath = path.join(tmp, "future-events.jsonl")
  await writeJsonlRows(futureEventsPath, [
    eventRow({ patternId: "P_A", symbol: "F001", date: "2025-01-02" }),
  ])
  await assert.rejects(
    () =>
      buildTp12Year2hitMonthlyCoverageBundleOptimizer({
        eligiblePatternsPath: patternsPath,
        operationalEventsPath: futureEventsPath,
        contractPath,
        outSummaryPath: path.join(tmp, "future-summary.json"),
      }),
    /locked future row cannot enter monthly coverage optimizer/,
  )

  console.log("ok smoke_tp12_year2hit_monthly_coverage_bundle_optimizer")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
