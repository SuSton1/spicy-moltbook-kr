#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { buildTp12TokenizedEvents } from "../src/lib/tp12_feature_tokenizer.mjs"

const execFileAsync = promisify(execFile)

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-feature-tokenizer-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  const universePath = path.join(tmp, "universe.jsonl")
  const labelEventsPath = path.join(tmp, "labels.jsonl")
  const outEventsPath = path.join(tmp, "tokenized.jsonl")
  const candles = []
  for (let day = 1; day <= 25; day += 1) {
    const dateKey = `2020-01-${String(day).padStart(2, "0")}`
    const close = day === 25 ? 120 : 100 + day * 0.2
    const high = day === 25 ? 121 : close + 1
    const low = day === 25 ? 109 : close - 1
    candles.push({
      symbol: "000001",
      dateKey,
      open: day === 25 ? 110 : close - 0.5,
      high,
      low,
      close,
      volume: day === 25 ? 100000 : 1000,
    })
  }
  await writeJsonl(candlePath, candles)
  await writeJsonl(universePath, [
    { symbol: "000001", tradingDateKey: "2020-01-01", avgTradingValue20d: 1, marketCapKrw: 1 },
    { symbol: "000001", tradingDateKey: "2020-01-25", avgTradingValue20d: 2_000_000_000, marketCapKrw: 300_000_000_000 },
  ])
  await writeJsonl(labelEventsPath, [
    {
      eventId: "e1",
      labelConfigId: "fixture",
      symbol: "000001",
      decisionDateKey: "2020-01-25",
      asOfFeatureDateKey: "2020-01-25",
      entryDateKey: "2020-01-26",
      hitTarget: true,
      labelStatus: "valid",
      maxForwardReturn: 0.13,
      minForwardReturn: -0.02,
      availableForwardBars: 3,
    },
  ])
  const summary = await buildTp12TokenizedEvents({
    labelEventsPath,
    candlePath,
    universePath,
    outEventsPath,
    tokenizerVersion: "fixture_tokenizer",
    requireUniverse: true,
    includeFeatureSnapshot: true,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.outputRowCount, 1)
  const row = JSON.parse((await fs.readFile(outEventsPath, "utf8")).trim())
  assert.ok(row.tokens.includes("vol:relvol20_ge_5"))
  assert.ok(row.tokens.includes("shape:close_pos_ge_0p8"))
  assert.ok(row.tokens.includes("liq:avg_trading_value20d_ge_1000000000"))
  assert.equal(row.asOfFeatureDateKey <= row.decisionDateKey, true)
  assert.equal(row.maxForwardReturn, 0.13)
  assert.equal(row.minForwardReturn, -0.02)
  assert.equal(row.availableForwardBars, 3)

  const sparseLabelsPath = path.join(tmp, "sparse_labels.jsonl")
  const sparseOutPath = path.join(tmp, "sparse_tokenized.jsonl")
  await writeJsonl(sparseLabelsPath, [
    {
      eventId: "sparse",
      labelConfigId: "fixture",
      symbol: "000001",
      decisionDateKey: "2020-01-01",
      hitTarget: false,
      labelStatus: "valid",
    },
    {
      eventId: "dense",
      labelConfigId: "fixture",
      symbol: "000001",
      decisionDateKey: "2020-01-25",
      hitTarget: true,
      labelStatus: "valid",
    },
  ])
  const sparseSummary = await buildTp12TokenizedEvents({
    labelEventsPath: sparseLabelsPath,
    candlePath,
    universePath,
    outEventsPath: sparseOutPath,
    tokenizerVersion: "fixture_tokenizer",
    requireUniverse: true,
    minTokenCount: 10,
    belowMinTokenPolicy: "skip_below_min",
  })
  assert.equal(sparseSummary.status, "passed")
  assert.equal(sparseSummary.outputRowCount, 1)
  assert.equal(sparseSummary.skippedBelowMinTokenRowCount, 1)

  const cliContractPath = path.join(tmp, "contract_require_universe.json")
  const cliMissingUniverseLabelsPath = path.join(tmp, "cli_missing_universe_labels.jsonl")
  const cliOutPath = path.join(tmp, "cli_tokenized.jsonl")
  const cliSummaryPath = path.join(tmp, "cli_tokenized_summary.json")
  await writeJsonl(cliMissingUniverseLabelsPath, [
    {
      eventId: "cli_missing_universe",
      labelConfigId: "fixture",
      symbol: "000001",
      decisionDateKey: "2020-01-02",
      hitTarget: false,
      labelStatus: "valid",
    },
  ])
  await fs.writeFile(
    cliContractPath,
    `${JSON.stringify(
      {
        featureTokenizer: {
          tokenizerVersion: "fixture_tokenizer",
          requireUniverse: true,
          includeFeatureSnapshot: false,
          minTokenCount: 1,
          belowMinTokenPolicy: "skip_below_min",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  await assert.rejects(
    execFileAsync(process.execPath, [
      "tools/build_tp12_tokenized_events.mjs",
      `--contract-path=${cliContractPath}`,
      `--label-events=${cliMissingUniverseLabelsPath}`,
      `--candle-path=${candlePath}`,
      `--universe-path=${universePath}`,
      `--out-events=${cliOutPath}`,
      `--out-summary=${cliSummaryPath}`,
    ]),
    /missing universe row for 000001::2020-01-25|missing universe row/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_feature_asof_tokenizer")
