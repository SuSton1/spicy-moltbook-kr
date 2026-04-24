#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12MonthlyQuotaPrecisionSchedulerSummary } from "../src/lib/tp12_monthly_quota_precision_scheduler.mjs"
import { buildTp12Year2hitOperatingGateSummary } from "../src/lib/tp12_year2hit_operating_gate.mjs"
import {
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { writeJsonlRows } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-monthly-quota-scheduler-"))

const candidate = ({
  date,
  symbol,
  patternId,
  score,
  hit = true,
  executable = true,
}) => ({
  decisionDateKey: date,
  symbol,
  patternId,
  schedulerScore: score,
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  executionPolicyId: TP12_EXECUTION_POLICY_ID,
  chartHitTarget: hit,
  entryExecutable: executable,
  operationalHitTarget: hit && executable,
  entryDateKey: "2024-01-02",
  operationalMissReasons: hit && executable ? [] : [hit ? "entry_gap_gte_29p5pct" : "not_chart_hit"],
})

const goodRows = [
  candidate({ date: "2024-01-03", symbol: "000001", patternId: "P_A", score: 0.99 }),
  candidate({ date: "2024-01-04", symbol: "000002", patternId: "P_A", score: 0.98 }),
  candidate({ date: "2024-01-05", symbol: "000003", patternId: "P_B", score: 0.97 }),
  candidate({ date: "2024-01-08", symbol: "000004", patternId: "P_B", score: 0.96 }),
  candidate({ date: "2024-01-09", symbol: "000005", patternId: "P_C", score: 0.95 }),
  candidate({ date: "2024-02-01", symbol: "000006", patternId: "P_A", score: 0.94 }),
  candidate({ date: "2024-02-02", symbol: "000007", patternId: "P_A", score: 0.93 }),
  candidate({ date: "2024-02-05", symbol: "000008", patternId: "P_B", score: 0.92 }),
  candidate({ date: "2024-02-06", symbol: "000009", patternId: "P_B", score: 0.91 }),
  candidate({ date: "2024-02-07", symbol: "000010", patternId: "P_C", score: 0.9 }),
]

try {
  const goodPath = path.join(tmp, "good.jsonl")
  const goodSummaryPath = path.join(tmp, "good-summary.json")
  const goodSelectionsPath = path.join(tmp, "good-selections.jsonl")
  await writeJsonlRows(goodPath, goodRows)
  const good = await buildTp12MonthlyQuotaPrecisionSchedulerSummary({
    candidatesPath: goodPath,
    outSummaryPath: goodSummaryPath,
    outSelectionsPath: goodSelectionsPath,
    fullMonthKeys: ["2024-01", "2024-02"],
    minSelectedRows: 10,
    targetObservedHitRate: 1,
    minWilsonLowerBound95: 0,
    maxTopSymbolShare: 0.2,
    maxTopPatternShare: 0.4,
    maxTopMonthShare: 0.5,
    maxSymbolPerFullMonth: 1,
    maxPatternPerFullMonth: 2,
    failOnGateFailure: true,
  })
  assert.equal(good.status, "passed")
  assert.equal(good.monthlyQuotaSchedule.selectedRows, 10)
  assert.equal(good.monthlyCadence.fullMonthStats[0].executableRecommendationCount, 5)

  const operatingGatePath = path.join(tmp, "operating-gate.json")
  const operating = await buildTp12Year2hitOperatingGateSummary({
    replaySummaryPath: goodSummaryPath,
    outSummaryPath: operatingGatePath,
    targetSelectionKey: "monthlyQuotaSchedule",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    targetObservedHitRate: 1,
    minWilsonLowerBound95: 0,
    minSelectedRows: 10,
    minUniqueMatchedDates: 10,
    minUniqueMatchedSymbols: 10,
    maxTop1DateShare: 1,
    requireMonthlyCadence: true,
    minExecutableRecommendationsPerFullMonth: 5,
    failOnGateFailure: true,
  })
  assert.equal(operating.status, "passed")

  const lowScorePath = path.join(tmp, "low-score.jsonl")
  const lowScoreSummaryPath = path.join(tmp, "low-score-summary.json")
  await writeJsonlRows(lowScorePath, [
    ...goodRows.slice(0, 9),
    candidate({ date: "2024-02-08", symbol: "000011", patternId: "P_C", score: -0.1 }),
  ])
  await assert.rejects(
    () =>
      buildTp12MonthlyQuotaPrecisionSchedulerSummary({
        candidatesPath: lowScorePath,
        outSummaryPath: lowScoreSummaryPath,
        fullMonthKeys: ["2024-01", "2024-02"],
        minSchedulerScore: 0,
        targetObservedHitRate: 1,
        minWilsonLowerBound95: 0,
        maxTopSymbolShare: 1,
        maxTopPatternShare: 1,
        maxTopMonthShare: 1,
        maxSymbolPerFullMonth: 0,
        maxPatternPerFullMonth: 0,
        failOnGateFailure: true,
      }),
    /monthly_selected_recommendations_below_target:2024-02/,
  )

  const nonExecutablePath = path.join(tmp, "non-executable.jsonl")
  const nonExecutableSummaryPath = path.join(tmp, "non-executable-summary.json")
  await writeJsonlRows(nonExecutablePath, [
    ...goodRows.slice(0, 5),
    candidate({ date: "2024-02-01", symbol: "000006", patternId: "P_A", score: 0.99, executable: false }),
    candidate({ date: "2024-02-02", symbol: "000007", patternId: "P_A", score: 0.98 }),
    candidate({ date: "2024-02-05", symbol: "000008", patternId: "P_B", score: 0.97 }),
    candidate({ date: "2024-02-06", symbol: "000009", patternId: "P_B", score: 0.96 }),
    candidate({ date: "2024-02-07", symbol: "000010", patternId: "P_C", score: 0.95 }),
    candidate({ date: "2024-02-08", symbol: "000011", patternId: "P_C", score: 0.94 }),
  ])
  await assert.rejects(
    () =>
      buildTp12MonthlyQuotaPrecisionSchedulerSummary({
        candidatesPath: nonExecutablePath,
        outSummaryPath: nonExecutableSummaryPath,
        fullMonthKeys: ["2024-01", "2024-02"],
        targetObservedHitRate: 0.8,
        minWilsonLowerBound95: 0,
        maxTopSymbolShare: 1,
        maxTopPatternShare: 1,
        maxTopMonthShare: 1,
        maxSymbolPerFullMonth: 0,
        maxPatternPerFullMonth: 0,
        failOnGateFailure: true,
      }),
    /monthly_executable_recommendations_below_target:2024-02/,
  )

  await assert.rejects(
    () =>
      buildTp12MonthlyQuotaPrecisionSchedulerSummary({
        candidatesPath: goodPath,
        outSummaryPath: path.join(tmp, "bad-score-field.json"),
        fullMonthKeys: ["2024-01", "2024-02"],
        scoreField: "entryExecutable",
      }),
    /scoreField is forbidden/,
  )

  await writeJson(path.join(tmp, "smoke-summary.json"), {
    status: "ok",
    selectedRows: good.selectedRowCount,
    fullMonthCount: good.monthlyCadence.fullMonthCount,
  })
  console.log("ok smoke_tp12_monthly_quota_precision_scheduler")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
