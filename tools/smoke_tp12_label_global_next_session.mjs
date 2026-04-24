#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12LabelEvents } from "../src/lib/tp12_label_event_builder.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-label-global-next-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2020-01-02", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000001", dateKey: "2020-01-03", open: 100, high: 113, low: 99, close: 110, volume: 1000 },
    { symbol: "000001", dateKey: "2020-01-06", open: 110, high: 111, low: 100, close: 105, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-02", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-06", open: 100, high: 130, low: 99, close: 120, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-07", open: 120, high: 121, low: 110, close: 115, volume: 1000 },
  ])

  const skipSummary = await buildTp12LabelEvents({
    candlePath,
    outEventsPath: path.join(tmp, "labels_skip.jsonl"),
    labelConfigId: "fixture_global_next_session_skip",
    entryRule: "NEXT_DAY_OPEN",
    targetPct: 0.12,
    holdDays: 2,
    stopLossPct: 0,
    stopPolicy: "no_stop",
    sameBarPolicy: "fail",
    decisionDateFrom: "2020-01-02",
    decisionDateTo: "2020-01-02",
    terminalForwardPolicy: "skip_terminal_incomplete_forward",
  })
  assert.equal(skipSummary.status, "passed")
  assert.equal(skipSummary.labelConfig.entryCalendarPolicy, "global_next_session")
  assert.equal(skipSummary.candidateDecisionRowCount, 2)
  assert.equal(skipSummary.decisionRowCount, 1)
  assert.equal(skipSummary.validLabelCount, 1)
  assert.equal(skipSummary.terminalForwardSkippedRowCount, 1)
  assert.equal(skipSummary.terminalForwardSkipReasonCounts.entry_not_global_next_session, 1)

  await assert.rejects(
    () =>
      buildTp12LabelEvents({
        candlePath,
        outEventsPath: path.join(tmp, "labels_fail.jsonl"),
        labelConfigId: "fixture_global_next_session_fail",
        entryRule: "NEXT_DAY_OPEN",
        targetPct: 0.12,
        holdDays: 2,
        stopLossPct: 0,
        stopPolicy: "no_stop",
        sameBarPolicy: "fail",
        decisionDateFrom: "2020-01-02",
        decisionDateTo: "2020-01-02",
        terminalForwardPolicy: "fail_invalid",
        failOnInvalidLabels: true,
      }),
    /invalid_labels:1/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_label_global_next_session")
