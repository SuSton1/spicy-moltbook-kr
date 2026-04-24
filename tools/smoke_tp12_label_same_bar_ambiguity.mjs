#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12LabelEvents } from "../src/lib/tp12_label_event_builder.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-label-ambiguity-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  await fs.writeFile(
    candlePath,
    [
      { symbol: "000001", dateKey: "2016-01-04", open: 90, high: 100, low: 80, close: 90, volume: 1000 },
      { symbol: "000001", dateKey: "2016-01-05", open: 100, high: 113, low: 95, close: 100, volume: 1000 },
      { symbol: "000001", dateKey: "2016-01-06", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { symbol: "000001", dateKey: "2016-01-07", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  )
  await assert.rejects(
    () =>
      buildTp12LabelEvents({
        candlePath,
        outEventsPath: path.join(tmp, "labels.jsonl"),
        labelConfigId: "fixture_stop_aware",
        entryRule: "NEXT_DAY_OPEN",
        targetPct: 0.12,
        holdDays: 3,
        stopLossPct: 0.04,
        stopPolicy: "target_before_stop",
        sameBarPolicy: "fail",
        decisionDateFrom: "2016-01-04",
        decisionDateTo: "2016-01-04",
      }),
    /same-bar target\/stop ambiguity/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_label_same_bar_ambiguity")
