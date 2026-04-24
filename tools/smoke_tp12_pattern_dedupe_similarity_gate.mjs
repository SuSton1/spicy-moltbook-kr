#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12PatternDedupeSimilarityGate } from "../src/lib/tp12_pattern_dedupe_similarity_gate.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-pattern-dedupe-gate-"))
try {
  const patternsPath = path.join(tmp, "patterns.jsonl")
  const operationalEventsPath = path.join(tmp, "events.jsonl")
  const outSurvivorsPath = path.join(tmp, "survivors.jsonl")
  const outRejectedPath = path.join(tmp, "rejected.jsonl")
  const outSummaryPath = path.join(tmp, "summary.json")
  await writeJsonl(patternsPath, [
    { patternId: "p_alpha_beta", tokenSet: ["a:alpha", "b:beta"] },
    { patternId: "p_alpha_gamma", tokenSet: ["a:alpha", "c:gamma"] },
    { patternId: "p_delta_epsilon", tokenSet: ["d:delta", "e:epsilon"] },
  ])
  const events = []
  for (let year = 2016; year <= 2024; year += 1) {
    for (const day of ["03", "17"]) {
      events.push({
        symbol: `AB${year}${day}`,
        decisionDateKey: `${year}-01-${day}`,
        entryExecutable: true,
        operationalHitTarget: true,
        tokens: ["a:alpha", "b:beta", "c:gamma"],
      })
      events.push({
        symbol: `DE${year}${day}`,
        decisionDateKey: `${year}-04-${day}`,
        entryExecutable: true,
        operationalHitTarget: true,
        tokens: ["d:delta", "e:epsilon"],
      })
    }
    events.push({
      symbol: `MISSA${year}`,
      decisionDateKey: `${year}-02-03`,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["a:alpha"],
    })
    events.push({
      symbol: `MISSB${year}`,
      decisionDateKey: `${year}-02-17`,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["b:beta"],
    })
    events.push({
      symbol: `MISSC${year}`,
      decisionDateKey: `${year}-03-03`,
      entryExecutable: true,
      operationalHitTarget: false,
      tokens: ["c:gamma"],
    })
  }
  await writeJsonl(operationalEventsPath, events)
  const { summary } = await buildTp12PatternDedupeSimilarityGate({
    patternsPath,
    operationalEventsPath,
    outSurvivorsPath,
    outRejectedPath,
    outSummaryPath,
    trainDateFrom: "2016-01-01",
    trainDateTo: "2024-12-31",
    lockedFutureFrom: "2025-01-02",
    sameFamilyJaccard: 0,
    tokenJaccard: 0,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.survivorCount, 2)
  assert.equal(summary.rejectedCount, 1)
  assert.equal(summary.rejectReasonCounts.exact_support_duplicate ?? 0, 1)
  const survivorRows = (await fs.readFile(outSurvivorsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    survivorRows.map((row) => row.patternId).sort(),
    ["p_alpha_beta", "p_delta_epsilon"],
  )

  const futureEventsPath = path.join(tmp, "events_future.jsonl")
  await writeJsonl(futureEventsPath, [
    ...events,
    {
      symbol: "FUT",
      decisionDateKey: "2025-01-02",
      entryExecutable: true,
      operationalHitTarget: true,
      tokens: ["a:alpha", "b:beta"],
    },
  ])
  await assert.rejects(
    buildTp12PatternDedupeSimilarityGate({
      patternsPath,
      operationalEventsPath: futureEventsPath,
      outSurvivorsPath: path.join(tmp, "future_survivors.jsonl"),
      outRejectedPath: path.join(tmp, "future_rejected.jsonl"),
      lockedFutureFrom: "2025-01-02",
    }),
    /forbidden future event/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_pattern_dedupe_similarity_gate")
