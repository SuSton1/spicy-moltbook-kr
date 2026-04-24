#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12TokenizedEvents } from "../src/lib/tp12_feature_tokenizer.mjs"
import {
  TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES,
  TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION,
} from "../src/lib/tp12_daily_ohlcv_d0_feature_whitelist.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const dateKeyAt = (offset) => {
  const date = new Date(Date.UTC(2020, 0, 2 + offset))
  return date.toISOString().slice(0, 10)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-daily-ohlcv-token-surface-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  const labelEventsPath = path.join(tmp, "labels.jsonl")
  const leakChangedLabelsPath = path.join(tmp, "labels_leak_changed.jsonl")
  const outEventsPath = path.join(tmp, "tokenized.jsonl")
  const leakChangedOutEventsPath = path.join(tmp, "tokenized_leak_changed.jsonl")
  const summaryPath = path.join(tmp, "summary.json")
  const candles = []
  for (let index = 0; index < 130; index += 1) {
    const close = 100 + index * 0.02
    candles.push({
      symbol: "000001",
      dateKey: dateKeyAt(index),
      open: close - 0.2,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 1000,
    })
  }
  candles[candles.length - 1] = {
    symbol: "000001",
    dateKey: dateKeyAt(129),
    open: 100,
    high: 115,
    low: 95,
    close: 112,
    volume: 3000,
  }
  await writeJsonl(candlePath, candles)
  const baseLabel = {
    eventId: "d0",
    labelConfigId: "fixture",
    symbol: "000001",
    decisionDateKey: dateKeyAt(129),
    asOfFeatureDateKey: dateKeyAt(129),
    entryDateKey: "2020-05-12",
    hitTarget: true,
    chartHitTarget: true,
    entryExecutable: true,
    operationalHitTarget: true,
    labelStatus: "valid",
    maxForwardReturn: 0.13,
    maxForwardHighPct: 0.14,
    hitDateKey: "2020-05-13",
  }
  await writeJsonl(labelEventsPath, [baseLabel])
  await writeJsonl(leakChangedLabelsPath, [
    {
      ...baseLabel,
      eventId: "d0_changed",
      maxForwardReturn: 9.99,
      maxForwardHighPct: 9.99,
      hitDateKey: "2099-01-01",
    },
  ])
  const summary = await buildTp12TokenizedEvents({
    labelEventsPath,
    candlePath,
    outEventsPath,
    outSummaryPath: summaryPath,
    tokenizerVersion: TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION,
    requireUniverse: false,
    includeFeatureSnapshot: true,
    maxDistinctTokenCount: 63,
    forbiddenTokenFamilies: TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES,
  })
  await buildTp12TokenizedEvents({
    labelEventsPath: leakChangedLabelsPath,
    candlePath,
    outEventsPath: leakChangedOutEventsPath,
    tokenizerVersion: TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION,
    requireUniverse: false,
    includeFeatureSnapshot: false,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.tokenFamilyCounts.liq ?? 0, 0)
  assert.equal(summary.tokenFamilyCounts.cap ?? 0, 0)
  const row = JSON.parse((await fs.readFile(outEventsPath, "utf8")).trim())
  const leakChangedRow = JSON.parse((await fs.readFile(leakChangedOutEventsPath, "utf8")).trim())
  assert.ok(row.tokens.includes("shape:range_ge_0p07"))
  assert.ok(row.tokens.includes("shape:close_pos_ge_0p80"))
  assert.ok(row.tokens.includes("shape:bull_body_ge_0p45"))
  assert.ok(row.tokens.includes("vol:rel20_ge_2p5"))
  assert.ok(row.tokens.includes("amt:rel20_ge_1p5"))
  assert.ok(row.tokens.includes("pxma:close_gt_ma20"))
  assert.ok(row.tokens.includes("level:close_break_high20"))
  for (const token of row.tokens) {
    assert.equal(TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES.includes(token.split(":")[0]), false)
  }
  assert.deepEqual(leakChangedRow.tokens, row.tokens)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_daily_ohlcv_d0_token_surface")
