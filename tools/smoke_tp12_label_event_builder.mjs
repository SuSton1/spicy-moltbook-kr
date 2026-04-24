#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12LabelEvents } from "../src/lib/tp12_label_event_builder.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-label-event-builder-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  const outEventsPath = path.join(tmp, "labels.jsonl")
  const outSummaryPath = path.join(tmp, "summary.json")
  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2016-01-04", open: 90, high: 100, low: 80, close: 90, volume: 1000 },
    { symbol: "000001", dateKey: "2016-01-05", open: 100, high: 113, low: 95, close: 110, volume: 2000 },
    { symbol: "000001", dateKey: "2016-01-06", open: 110, high: 111, low: 100, close: 105, volume: 1000 },
    { symbol: "000001", dateKey: "2016-01-07", open: 105, high: 106, low: 95, close: 100, volume: 1000 },
    { symbol: "000001", dateKey: "2016-01-08", open: 100, high: 101, low: 90, close: 95, volume: 1000 },
  ])
  const summary = await buildTp12LabelEvents({
    candlePath,
    outEventsPath,
    outSummaryPath,
    labelConfigId: "fixture_target12_next_open_hold3_no_stop",
    entryRule: "NEXT_DAY_OPEN",
    targetPct: 0.12,
    holdDays: 3,
    stopLossPct: 0,
    stopPolicy: "no_stop",
    sameBarPolicy: "fail",
    decisionDateFrom: "2016-01-04",
    decisionDateTo: "2016-01-05",
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.validLabelCount, 2)
  assert.equal(summary.hitRowCount, 1)
  const rows = (await fs.readFile(outEventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(rows[0].hitTarget, true)
  assert.equal(rows[0].hitDateKey, "2016-01-05")
  assert.equal(rows[1].hitTarget, false)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_label_event_builder")
