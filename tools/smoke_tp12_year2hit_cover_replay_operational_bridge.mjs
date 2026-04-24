#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, readJsonl } from "../src/lib/io.mjs"
import { buildTp12Year2hitCoverReplayOperationalBridge } from "../src/lib/tp12_year2hit_cover_replay_operational_bridge.mjs"
import { TP12_EXECUTION_POLICY_ID } from "../src/lib/tp12_operational_hit_contract.mjs"
import { writeJsonlRows } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-cover-replay-operational-bridge-"))

const matchedRow = ({ decisionDateKey, symbol, hit = true }) => ({
  kind: "tp12_context_consensus_feature_full_train_replay_v1",
  decisionDateKey,
  symbol,
  chartHitTarget: hit,
  executableHitTarget: hit,
  entryExecutable: true,
  execution: {
    policyId: TP12_EXECUTION_POLICY_ID,
    entryDateKey: decisionDateKey,
    nonExecutableReasons: [],
  },
})

const coverRow = ({ coverId, keys, hitDatesByYear }) => ({
  kind: "tp12_micro_split_executable_cover_replay_v1",
  coverId,
  metrics: {
    totalRows: keys.length,
    executableHitRows: keys.length,
    executableMissRows: 0,
    nonExecutableRows: 0,
    executableHitDatesByYear: hitDatesByYear,
    executableHitSymbolDatesByYear: hitDatesByYear,
  },
  matchedRowKeys: keys,
})

try {
  const matchedRowsPath = path.join(tmp, "matched.jsonl")
  const coverReplayPath = path.join(tmp, "covers.jsonl")
  const outSummaryPath = path.join(tmp, "out", "summary.json")
  const outPatternsPath = path.join(tmp, "out", "patterns.jsonl")
  const outEventsPath = path.join(tmp, "out", "events.jsonl")

  await writeJsonlRows(matchedRowsPath, [
    matchedRow({ decisionDateKey: "2020-01-02", symbol: "A001" }),
    matchedRow({ decisionDateKey: "2021-01-04", symbol: "B001" }),
    matchedRow({ decisionDateKey: "2020-02-03", symbol: "C001" }),
  ])
  await writeJsonlRows(coverReplayPath, [
    coverRow({
      coverId: "C_PASS",
      keys: ["2020-01-02\tA001", "2021-01-04\tB001"],
      hitDatesByYear: { 2020: 1, 2021: 1 },
    }),
    coverRow({
      coverId: "C_REJECT",
      keys: ["2020-02-03\tC001"],
      hitDatesByYear: { 2020: 1, 2021: 0 },
    }),
  ])

  const summary = await buildTp12Year2hitCoverReplayOperationalBridge({
    coverReplayPath,
    matchedRowsPath,
    outSummaryPath,
    outPatternsPath,
    outEventsPath,
    coreYears: ["2020", "2021"],
    minOperationalHitDatesPerYearRequired: 1,
    minOperationalHitSymbolDatesPerYearRequired: 1,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.coverReplayRowCount, 2)
  assert.equal(summary.passedPatternCount, 1)
  assert.equal(summary.rejectedPatternCount, 1)
  assert.equal(summary.eventRowCount, 3)
  assert.equal(summary.eventOperationalMissRows, 0)

  const summaryFromDisk = await readJson(outSummaryPath)
  assert.equal(summaryFromDisk.passedPatternCount, 1)
  const patterns = await readJsonl(outPatternsPath, { strict: true })
  assert.equal(patterns.find((row) => row.patternId === "C_PASS")?.status, "passed")
  assert.equal(patterns.find((row) => row.patternId === "C_REJECT")?.status, "rejected")
  assert.deepEqual(patterns.find((row) => row.patternId === "C_REJECT")?.bridgeRejectReasons, [
    "cover_hit_dates_below_year2_min",
    "cover_hit_symbol_dates_below_year2_min",
  ])
  const events = await readJsonl(outEventsPath, { strict: true })
  assert.equal(events[0].hitDefinition, "operational_hit_v1")
  assert.equal(events[0].primaryHitField, "operationalHitTarget")
  assert.equal(events[0].operationalHitTarget, true)
  assert.equal(events[0].entryExecutable, true)
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], "entryOpen"), false)

  const duplicateMatchedRowsPath = path.join(tmp, "duplicate-matched.jsonl")
  await writeJsonlRows(duplicateMatchedRowsPath, [
    matchedRow({ decisionDateKey: "2020-01-02", symbol: "A001" }),
    matchedRow({ decisionDateKey: "2020-01-02", symbol: "A001" }),
  ])
  await assert.rejects(
    () =>
      buildTp12Year2hitCoverReplayOperationalBridge({
        coverReplayPath,
        matchedRowsPath: duplicateMatchedRowsPath,
        outSummaryPath: path.join(tmp, "dup-summary.json"),
        outPatternsPath: path.join(tmp, "dup-patterns.jsonl"),
        outEventsPath: path.join(tmp, "dup-events.jsonl"),
        coreYears: ["2020", "2021"],
      }),
    /duplicate matched row key/,
  )

  const futureMatchedRowsPath = path.join(tmp, "future-matched.jsonl")
  await writeJsonlRows(futureMatchedRowsPath, [matchedRow({ decisionDateKey: "2025-01-02", symbol: "F001" })])
  await assert.rejects(
    () =>
      buildTp12Year2hitCoverReplayOperationalBridge({
        coverReplayPath,
        matchedRowsPath: futureMatchedRowsPath,
        outSummaryPath: path.join(tmp, "future-summary.json"),
        outPatternsPath: path.join(tmp, "future-patterns.jsonl"),
        outEventsPath: path.join(tmp, "future-events.jsonl"),
      }),
    /matched row enters locked future/,
  )

  console.log("ok smoke_tp12_year2hit_cover_replay_operational_bridge")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
