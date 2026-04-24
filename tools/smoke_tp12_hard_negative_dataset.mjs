#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12HardNegativeDataset } from "../src/lib/tp12_hard_negative_dataset.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-hard-negative-"))
try {
  const inputPath = path.join(tmp, "features.jsonl")
  await writeJsonl(inputPath, [
    { symbol: "000001", decisionDateKey: "2020-01-02", hitTarget: true, maxForwardReturn: 0.14, minForwardReturn: -0.01 },
    { symbol: "000002", decisionDateKey: "2020-01-03", hitTarget: false, maxForwardReturn: 0.09, minForwardReturn: -0.02 },
    { symbol: "000003", decisionDateKey: "2020-01-06", hitTarget: false, maxForwardReturn: 0.02, minForwardReturn: -0.08 },
    { symbol: "000004", decisionDateKey: "2020-01-07", hitTarget: false, maxForwardReturn: 0.06, minForwardReturn: -0.03 },
    { symbol: "000005", decisionDateKey: "2020-01-08", hitTarget: false, maxForwardReturn: 0.1200000000000001, minForwardReturn: -0.01 },
  ])
  const manifest = await buildTp12HardNegativeDataset({
    inputPath,
    outPath: path.join(tmp, "hard_negative.jsonl"),
    manifestPath: path.join(tmp, "manifest.json"),
    dateFrom: "2020-01-01",
    dateTo: "2020-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    targetPct: 0.12,
    nearMissMinPct: 0.08,
    hardNegativeMaxForwardReturnPct: 0.04,
  })
  assert.equal(manifest.status, "passed")
  assert.deepEqual(manifest.labelClassCounts, {
    easy_negative: 1,
    hard_negative: 1,
    near_miss: 2,
    positive: 1,
  })

  await writeJsonl(path.join(tmp, "bad.jsonl"), [
    { symbol: "000006", decisionDateKey: "2020-01-09", hitTarget: false },
  ])
  await assert.rejects(
    () =>
      buildTp12HardNegativeDataset({
        inputPath: path.join(tmp, "bad.jsonl"),
        outPath: path.join(tmp, "bad_out.jsonl"),
        manifestPath: path.join(tmp, "bad_manifest.json"),
      }),
    /requires maxForwardReturn/,
  )

  await writeJsonl(path.join(tmp, "bad_boundary.jsonl"), [
    { symbol: "000007", decisionDateKey: "2020-01-10", hitTarget: false, maxForwardReturn: 0.121, minForwardReturn: -0.01 },
  ])
  await assert.rejects(
    () =>
      buildTp12HardNegativeDataset({
        inputPath: path.join(tmp, "bad_boundary.jsonl"),
        outPath: path.join(tmp, "bad_boundary_out.jsonl"),
        manifestPath: path.join(tmp, "bad_boundary_manifest.json"),
        targetBoundaryTolerance: 1e-9,
      }),
    /hitTarget=false but maxForwardReturn reaches targetPct/,
  )

  await writeJsonl(path.join(tmp, "bad_oos.jsonl"), [
    { symbol: "000008", decisionDateKey: "2025-01-02", hitTarget: true, maxForwardReturn: 0.15, minForwardReturn: -0.01 },
  ])
  await assert.rejects(
    () =>
      buildTp12HardNegativeDataset({
        inputPath: path.join(tmp, "bad_oos.jsonl"),
        outPath: path.join(tmp, "bad_oos_out.jsonl"),
        manifestPath: path.join(tmp, "bad_oos_manifest.json"),
        forbiddenDateFrom: "2025-01-02",
        forbiddenDateTo: "2026-04-17",
      }),
    /forbidden date range/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_hard_negative_dataset")
