#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { materializeTp12CandidateEvents } from "../src/lib/tp12_candidate_event_materializer.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-materializer-"))
try {
  const catalogPath = path.join(tmp, "catalog.jsonl")
  const tokenizedPath = path.join(tmp, "tokenized.jsonl")
  const outEventsPath = path.join(tmp, "candidate_events.jsonl")
  await writeJsonl(catalogPath, [
    {
      patternId: "pair_ab",
      patternKind: "pair_token",
      tokenSet: ["a", "b"],
      year2hitPassed: true,
      qualityPassed: true,
    },
    {
      patternId: "broad_a",
      patternKind: "single_token",
      tokenSet: ["a"],
      year2hitPassed: true,
      qualityPassed: false,
    },
  ])
  await writeJsonl(tokenizedPath, [
    {
      eventId: "e1",
      symbol: "000001",
      decisionDateKey: "2020-01-03",
      hitTarget: true,
      tokens: ["a", "b", "c"],
      maxForwardReturn: 0.13,
      minForwardReturn: -0.02,
      targetBeforeStop: true,
    },
    { eventId: "e2", symbol: "000002", decisionDateKey: "2020-01-04", hitTarget: false, tokens: ["a"] },
    { eventId: "e3", symbol: "000003", decisionDateKey: "2020-01-05", hitTarget: true, tokens: ["b", "a"] },
  ])
  const summary = await materializeTp12CandidateEvents({
    candidateCatalogPath: catalogPath,
    tokenizedEventsPath: tokenizedPath,
    outEventsPath,
    dateFrom: "2020-01-01",
    dateTo: "2020-12-31",
    requireCandidateQualityPassed: true,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.inputCandidateCount, 2)
  assert.equal(summary.candidateCount, 1)
  assert.equal(summary.rejectedByQualityCount, 1)
  assert.equal(summary.outputRowCount, 2)
  assert.equal(summary.hitRowCount, 2)
  const rows = (await fs.readFile(outEventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.sourceEventId).sort(), ["e1", "e3"])
  const rowE1 = rows.find((row) => row.sourceEventId === "e1")
  assert.equal(rowE1.maxForwardReturn, 0.13)
  assert.equal(rowE1.minForwardReturn, -0.02)
  assert.equal(rowE1.targetBeforeStop, true)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_candidate_event_materializer")
