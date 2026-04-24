#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12ContextFeatures } from "../src/lib/tp12_context_feature_builder.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-context-features-"))
try {
  const candlePath = path.join(tmp, "candles.jsonl")
  const candidatePath = path.join(tmp, "candidates.jsonl")
  await writeJsonl(candlePath, [
    { symbol: "000001", dateKey: "2020-01-02", open: 100, high: 105, low: 95, close: 100, volume: 1000 },
    { symbol: "000002", dateKey: "2020-01-02", open: 50, high: 55, low: 49, close: 54, volume: 2000 },
    { symbol: "000001", dateKey: "2020-01-03", open: 100, high: 112, low: 99, close: 110, volume: 3000 },
    { symbol: "000002", dateKey: "2020-01-03", open: 54, high: 55, low: 50, close: 52, volume: 1000 },
  ])
  await writeJsonl(candidatePath, [
    { symbol: "000001", decisionDateKey: "2020-01-03", hitTarget: true },
    { symbol: "000002", decisionDateKey: "2020-01-03", hitTarget: false },
  ])
  const manifest = await buildTp12ContextFeatures({
    candidatePath,
    candlePath,
    outPath: path.join(tmp, "context.jsonl"),
    manifestPath: path.join(tmp, "manifest.json"),
  })
  assert.equal(manifest.status, "passed")
  assert.equal(manifest.outputRowCount, 2)
  const rows = (await fs.readFile(path.join(tmp, "context.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const first = rows.find((row) => row.symbol === "000001")
  assert.ok(first.return1d > 0.09)
  assert.ok(first.return1d < 0.11)
  assert.ok(first.gapPct === 0)
  assert.equal(first.d0ClosePressurePct, first.openToCloseReturn)
  assert.equal(first.d0TradingValue, first.tradedValue)
  assert.equal(first.d0CloseLocation, first.closeLocation)
  assert.equal(first.d0RangePct, first.rangePct)
  assert.equal(first.d0TradingValueRankPct, 0)
  assert.equal(first.tradedValueRank, 1)
  assert.equal(first.marketRowCount, 2)
  assert.equal(first.marketUpRatio, 0.5)
  assert.equal(first.return3d, null)
  assert.equal(first.closeOverMa5, null)

  const sortedCandlePath = path.join(tmp, "candles_sorted.jsonl")
  const sortedDuplicateCandidatePath = path.join(tmp, "candidates_sorted_with_duplicate.jsonl")
  await writeJsonl(sortedCandlePath, [
    { symbol: "000001", dateKey: "2020-01-02", open: 100, high: 105, low: 95, close: 100, volume: 1000 },
    { symbol: "000001", dateKey: "2020-01-03", open: 100, high: 112, low: 99, close: 110, volume: 3000 },
    { symbol: "000002", dateKey: "2020-01-02", open: 50, high: 55, low: 49, close: 54, volume: 2000 },
    { symbol: "000002", dateKey: "2020-01-03", open: 54, high: 55, low: 50, close: 52, volume: 1000 },
  ])
  await writeJsonl(sortedDuplicateCandidatePath, [
    { symbol: "000001", decisionDateKey: "2020-01-03", hitTarget: true },
    { symbol: "000001", decisionDateKey: "2020-01-03", hitTarget: true, duplicatePatternId: "same_symbol_date" },
    { symbol: "000002", decisionDateKey: "2020-01-03", hitTarget: false },
  ])
  const streamManifest = await buildTp12ContextFeatures({
    candidatePath: sortedDuplicateCandidatePath,
    candlePath: sortedCandlePath,
    outPath: path.join(tmp, "context_stream.jsonl"),
    manifestPath: path.join(tmp, "manifest_stream.json"),
    streamBySymbol: true,
  })
  assert.equal(streamManifest.status, "passed")
  assert.equal(streamManifest.contextMode, "stream_by_symbol_v1")
  assert.equal(streamManifest.candidateRowCount, 2)
  assert.equal(streamManifest.outputRowCount, 2)
  const streamRows = (await fs.readFile(path.join(tmp, "context_stream.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const streamFirst = streamRows.find((row) => row.symbol === "000001")
  assert.equal(streamFirst.contextMode, "stream_by_symbol_v1")
  assert.equal(streamFirst.d0ClosePressurePct, streamFirst.openToCloseReturn)
  assert.equal(streamFirst.d0TradingValue, streamFirst.tradedValue)
  assert.equal(streamFirst.d0CloseLocation, streamFirst.closeLocation)
  assert.ok(streamFirst.marketMeanReturn1d > 0.02)
  assert.ok(!Object.prototype.hasOwnProperty.call(streamFirst, "tradedValueRankPct"))

  await writeJsonl(path.join(tmp, "bad_candidates.jsonl"), [
    { symbol: "000003", decisionDateKey: "2020-01-03" },
  ])
  await assert.rejects(
    () =>
      buildTp12ContextFeatures({
        candidatePath: path.join(tmp, "bad_candidates.jsonl"),
        candlePath,
        outPath: path.join(tmp, "bad_context.jsonl"),
        manifestPath: path.join(tmp, "bad_manifest.json"),
      }),
    /missing_candidate_candle_rows/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_context_features")
