#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12LabelEvents } from "../src/lib/tp12_label_event_builder.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-label-horizon-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  const outEventsPath = path.join(tmp, "labels.jsonl")
  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2024-12-23", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000001", dateKey: "2024-12-24", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000001", dateKey: "2024-12-25", open: 100, high: 113, low: 99, close: 110, volume: 1000 },
    { symbol: "000001", dateKey: "2024-12-26", open: 110, high: 111, low: 100, close: 105, volume: 1000 },
    { symbol: "000001", dateKey: "2024-12-27", open: 105, high: 106, low: 100, close: 102, volume: 1000 },
    { symbol: "000001", dateKey: "2024-12-30", open: 102, high: 103, low: 100, close: 101, volume: 1000 },
    { symbol: "000001", dateKey: "2025-01-02", open: 101, high: 130, low: 100, close: 120, volume: 1000 },
    { symbol: "000001", dateKey: "2025-01-03", open: 120, high: 121, low: 110, close: 115, volume: 1000 },
  ])
  const summary = await buildTp12LabelEvents({
    candlePath,
    outEventsPath,
    labelConfigId: "fixture_target12_horizon_guard",
    entryRule: "NEXT_DAY_OPEN",
    targetPct: 0.12,
    holdDays: 2,
    stopLossPct: 0,
    stopPolicy: "no_stop",
    sameBarPolicy: "fail",
    decisionDateFrom: "2024-12-23",
    decisionDateTo: "2024-12-30",
    labelHorizonDateTo: "2024-12-27",
    horizonBoundaryPolicy: "skip_cross_boundary",
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.candidateDecisionRowCount, 6)
  assert.equal(summary.decisionRowCount, 3)
  assert.equal(summary.horizonSkippedRowCount, 3)
  assert.equal(summary.horizonSkipReasonCounts.forward_horizon_crosses_label_boundary, 3)
  const rows = (await fs.readFile(outEventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.decisionDateKey), ["2024-12-23", "2024-12-24", "2024-12-25"])
  assert.equal(rows.some((row) => String(row.entryDateKey).startsWith("2025-")), false)

  await assert.rejects(
    () =>
      buildTp12LabelEvents({
        candlePath,
        outEventsPath: path.join(tmp, "labels_fail.jsonl"),
        labelConfigId: "fixture_target12_horizon_fail",
        entryRule: "NEXT_DAY_OPEN",
        targetPct: 0.12,
        holdDays: 2,
        stopLossPct: 0,
        stopPolicy: "no_stop",
        sameBarPolicy: "fail",
        decisionDateFrom: "2024-12-23",
        decisionDateTo: "2024-12-30",
        labelHorizonDateTo: "2024-12-27",
        horizonBoundaryPolicy: "fail_cross_boundary",
      }),
    /forward_horizon_crosses_label_boundary/,
  )

  const terminalCandlePath = path.join(tmp, "terminal_candles.jsonl")
  await writeJsonl(terminalCandlePath, [
    { symbol: "000002", dateKey: "2020-01-02", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-03", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-06", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
  ])
  const terminalSummary = await buildTp12LabelEvents({
    candlePath: terminalCandlePath,
    outEventsPath: path.join(tmp, "terminal_labels.jsonl"),
    labelConfigId: "fixture_terminal_forward_skip",
    entryRule: "NEXT_DAY_OPEN",
    targetPct: 0.12,
    holdDays: 2,
    stopLossPct: 0,
    stopPolicy: "no_stop",
    sameBarPolicy: "fail",
    decisionDateFrom: "2020-01-02",
    decisionDateTo: "2020-01-06",
    terminalForwardPolicy: "skip_terminal_incomplete_forward",
  })
  assert.equal(terminalSummary.status, "passed")
  assert.equal(terminalSummary.decisionRowCount, 1)
  assert.equal(terminalSummary.terminalForwardSkippedRowCount, 2)
  assert.equal(terminalSummary.terminalForwardSkipReasonCounts.insufficient_global_forward_sessions, 1)
  assert.equal(terminalSummary.terminalForwardSkipReasonCounts.missing_global_next_session, 1)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_label_horizon_boundary")
