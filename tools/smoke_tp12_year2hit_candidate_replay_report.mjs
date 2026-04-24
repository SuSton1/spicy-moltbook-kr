#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-year2hit-replay-"))
try {
  const catalogPath = path.join(tmp, "gated_catalog.jsonl")
  const eventsPath = path.join(tmp, "candidate_events.jsonl")
  const outSummaryPath = path.join(tmp, "summary.json")
  const outUnionPath = path.join(tmp, "union.jsonl")
  const outOnePickPath = path.join(tmp, "one_pick.jsonl")
  await writeJsonl(catalogPath, [
    {
      patternId: "p_high_train",
      tokenSet: ["a", "b"],
      matchRows: 100,
      hitRows: 90,
      rowPrecision: 0.9,
      matchedDateCount: 20,
      hitDateCount: 18,
      datePrecision: 0.9,
      minYearHitDates: 4,
      year2hitPassed: true,
      qualityPassed: true,
    },
    {
      patternId: "p_lower_train",
      tokenSet: ["a"],
      matchRows: 50,
      hitRows: 20,
      rowPrecision: 0.4,
      matchedDateCount: 15,
      hitDateCount: 8,
      datePrecision: 0.5333333333333333,
      minYearHitDates: 2,
      year2hitPassed: true,
      qualityPassed: true,
    },
  ])
  await writeJsonl(eventsPath, [
    { patternId: "p_high_train", symbol: "aaa", decisionDateKey: "2025-01-02", hitTarget: true },
    { patternId: "p_lower_train", symbol: "aaa", decisionDateKey: "2025-01-02", hitTarget: true },
    { patternId: "p_lower_train", symbol: "bbb", decisionDateKey: "2025-01-02", hitTarget: false },
    { patternId: "p_high_train", symbol: "ccc", decisionDateKey: "2025-01-03", hitTarget: false },
    { patternId: "p_lower_train", symbol: "ddd", decisionDateKey: "2025-01-03", hitTarget: true },
    { patternId: "p_lower_train", symbol: "eee", decisionDateKey: "2025-01-04", hitTarget: true },
  ])
  const summary = await buildTp12Year2hitCandidateReplayReport({
    candidateEventsPath: eventsPath,
    candidateCatalogPath: catalogPath,
    outSummaryPath,
    outSymbolDateUnionPath: outUnionPath,
    outOnePickPerDayPath: outOnePickPath,
    dateFrom: "2025-01-02",
    dateTo: "2025-01-04",
  })
  assert.equal(summary.status, "measured")
  assert.equal(summary.catalogPatternCount, 2)
  assert.equal(summary.rawPatternMatch.selectedRows, 6)
  assert.equal(summary.rawPatternMatch.hitRows, 4)
  assert.equal(summary.symbolDateUnion.selectedRows, 5)
  assert.equal(summary.symbolDateUnion.hitRows, 3)
  assert.equal(summary.onePickPerDay.selectedRows, 3)
  assert.equal(summary.onePickPerDay.hitRows, 2)
  const onePickRows = await readJsonl(outOnePickPath)
  assert.deepEqual(
    onePickRows.map((row) => `${row.decisionDateKey}:${row.patternId}:${row.symbol}:${row.hitTarget}`),
    [
      "2025-01-02:p_high_train:AAA:true",
      "2025-01-03:p_high_train:CCC:false",
      "2025-01-04:p_lower_train:EEE:true",
    ],
  )
  await writeJsonl(eventsPath, [
    { patternId: "not_gated", symbol: "aaa", decisionDateKey: "2025-01-02", hitTarget: true },
  ])
  await assert.rejects(
    () =>
      buildTp12Year2hitCandidateReplayReport({
        candidateEventsPath: eventsPath,
        candidateCatalogPath: catalogPath,
        outSummaryPath,
      }),
    /outside gated catalog/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_candidate_replay_report")
