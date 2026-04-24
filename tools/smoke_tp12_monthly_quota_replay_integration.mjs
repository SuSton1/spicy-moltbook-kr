#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { materializeTp12CandidateEvents } from "../src/lib/tp12_candidate_event_materializer.mjs"
import { buildTp12MonthlyQuotaPrecisionSchedulerSummary } from "../src/lib/tp12_monthly_quota_precision_scheduler.mjs"
import {
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { buildTp12Year2hitCandidateReplayReport } from "../src/lib/tp12_year2hit_candidate_replay_report.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const operationalTokenizedRow = ({ date, symbol, eventId }) => ({
  eventId,
  symbol,
  decisionDateKey: date,
  entryDateKey: `${date.slice(0, 8)}28`,
  hitTarget: true,
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  executionPolicyId: TP12_EXECUTION_POLICY_ID,
  chartHitTarget: true,
  entryExecutable: true,
  operationalHitTarget: true,
  executableHitTarget: true,
  operationalMissReasons: [],
  operationalMissReason: null,
  tokens: ["core", "weak"],
})

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-monthly-quota-replay-integration-"))
try {
  const catalogPath = path.join(tmp, "catalog.jsonl")
  const tokenizedPath = path.join(tmp, "tokenized.jsonl")
  const candidateEventsPath = path.join(tmp, "candidate_events.jsonl")
  const replaySummaryPath = path.join(tmp, "replay_summary.json")
  const onePickPath = path.join(tmp, "one_pick.jsonl")
  const schedulerSummaryPath = path.join(tmp, "scheduler_summary.json")
  const schedulerSelectionsPath = path.join(tmp, "scheduler_selections.jsonl")

  await writeJsonl(catalogPath, [
    {
      patternId: "P_STRONG",
      patternKind: "single_token",
      tokenSet: ["core"],
      matchRows: 31,
      hitRows: 30,
      rowPrecision: 30 / 31,
      matchedDateCount: 20,
      hitDateCount: 19,
      datePrecision: 0.95,
      minYearHitDates: 3,
      year2hitPassed: true,
      qualityPassed: true,
    },
    {
      patternId: "P_WEAK",
      patternKind: "single_token",
      tokenSet: ["weak"],
      matchRows: 50,
      hitRows: 25,
      rowPrecision: 0.5,
      matchedDateCount: 20,
      hitDateCount: 10,
      datePrecision: 0.5,
      minYearHitDates: 2,
      year2hitPassed: true,
      qualityPassed: true,
    },
  ])

  await writeJsonl(tokenizedPath, [
    operationalTokenizedRow({ date: "2024-01-03", symbol: "000001", eventId: "e01" }),
    operationalTokenizedRow({ date: "2024-01-04", symbol: "000002", eventId: "e02" }),
    operationalTokenizedRow({ date: "2024-01-05", symbol: "000003", eventId: "e03" }),
    operationalTokenizedRow({ date: "2024-01-08", symbol: "000004", eventId: "e04" }),
    operationalTokenizedRow({ date: "2024-01-09", symbol: "000005", eventId: "e05" }),
    operationalTokenizedRow({ date: "2024-02-01", symbol: "000006", eventId: "e06" }),
    operationalTokenizedRow({ date: "2024-02-02", symbol: "000007", eventId: "e07" }),
    operationalTokenizedRow({ date: "2024-02-05", symbol: "000008", eventId: "e08" }),
    operationalTokenizedRow({ date: "2024-02-06", symbol: "000009", eventId: "e09" }),
    operationalTokenizedRow({ date: "2024-02-07", symbol: "000010", eventId: "e10" }),
  ])

  const materialize = await materializeTp12CandidateEvents({
    candidateCatalogPath: catalogPath,
    tokenizedEventsPath: tokenizedPath,
    outEventsPath: candidateEventsPath,
    dateFrom: "2024-01-01",
    dateTo: "2024-02-29",
    requireCandidateQualityPassed: true,
  })
  assert.equal(materialize.status, "passed")
  assert.equal(materialize.outputRowCount, 20)

  const replay = await buildTp12Year2hitCandidateReplayReport({
    candidateEventsPath,
    candidateCatalogPath: catalogPath,
    outSummaryPath: replaySummaryPath,
    outOnePickPerDayPath: onePickPath,
    dateFrom: "2024-01-01",
    dateTo: "2024-02-29",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    fullMonthKeys: ["2024-01", "2024-02"],
  })
  assert.equal(replay.status, "measured")
  assert.equal(replay.onePickPerDay.selectedRows, 10)
  assert.equal(replay.onePickPerDay.hitRows, 10)

  const onePickRows = await readJsonl(onePickPath)
  assert.equal(onePickRows.length, 10)
  assert.ok(onePickRows.every((row) => row.patternId === "P_STRONG"))
  assert.ok(onePickRows.every((row) => Number.isFinite(row.schedulerScore) && row.schedulerScore > 0))
  assert.ok(onePickRows.every((row) => row.schedulerScoreSource === "train_catalog_quality_v1"))
  assert.ok(onePickRows.every((row) => row.hitDefinition === TP12_OPERATIONAL_HIT_DEFINITION))
  assert.ok(onePickRows.every((row) => row.executionPolicyId === TP12_EXECUTION_POLICY_ID))
  assert.ok(onePickRows.every((row) => row.entryExecutable === true))
  assert.ok(onePickRows.every((row) => row.operationalHitTarget === true))

  const scheduled = await buildTp12MonthlyQuotaPrecisionSchedulerSummary({
    candidatesPath: onePickPath,
    outSummaryPath: schedulerSummaryPath,
    outSelectionsPath: schedulerSelectionsPath,
    fullMonthKeys: ["2024-01", "2024-02"],
    minSelectedRows: 10,
    targetObservedHitRate: 1,
    minWilsonLowerBound95: 0,
    maxTopSymbolShare: 1,
    maxTopPatternShare: 1,
    maxTopMonthShare: 0.5,
    maxSymbolPerFullMonth: 1,
    maxPatternPerFullMonth: 0,
    failOnGateFailure: true,
  })
  assert.equal(scheduled.status, "passed")
  assert.equal(scheduled.monthlyQuotaSchedule.selectedRows, 10)
  assert.equal(scheduled.monthlyCadence.fullMonthStats[0].executableRecommendationCount, 5)
  assert.equal(scheduled.monthlyCadence.fullMonthStats[1].executableRecommendationCount, 5)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_monthly_quota_replay_integration")
