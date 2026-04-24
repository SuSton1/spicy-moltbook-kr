#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  assertTp12SelectorFeatureSourceRows,
  buildTp12SelectorFeatureSourceRepairRows,
} from "../src/lib/tp12_selector_feature_source_repair.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const baseRow = (symbol, decisionDateKey, overrides = {}) => ({
  kind: "tp12_context_consensus_feature_v1",
  symbol,
  decisionDateKey,
  hitTarget: Boolean(overrides.hitTarget),
  openToCloseReturn: 0.07,
  tradedValue: 1200000000,
  tradedValueRel20: 0.35,
  closeLocation: 0.88,
  rangePct: 0.09,
  selectorScore: 3,
  supportClusterCount: 2,
  ...overrides,
})

const sideRow = (symbol, decisionDateKey) => ({
  kind: "tp12_side_daily_feature_dataset_v1",
  symbol,
  decisionDateKey,
  gateId: "d0_close",
  featureCutoffDateKey: decisionDateKey,
  entryPriceMode: "next_day_open",
  features: {
    side_alignment_investor_program_d0_sign: 1,
    side_pressure_investor_program_d0_signed_log1p: 2.4,
    investor_d0_signed_log1p: 1.2,
    program_d0_signed_log1p: 1.1,
  },
})

const intradayRow = (symbol, decisionDateKey) => ({
  kind: "tp12_intraday_feature_dataset_v1",
  symbol,
  decisionDateKey,
  gateId: "d0_close",
  featureCutoffDateKey: decisionDateKey,
  featureCutoffTsKst: `${decisionDateKey}T15:30:00+09:00`,
  entryPriceMode: "next_day_open",
  entryDateKey: "2021-01-05",
  features: {
    d0_close_strength: 0.91,
    d0_close_strength_after_breakout: 0.72,
    d0_vwap_hold_ratio: 0.83,
  },
})

const expectReject = async (fn, pattern) => {
  let rejected = false
  try {
    await fn()
  } catch (error) {
    rejected = true
    assert.match(String(error.message || error), pattern)
  }
  assert.equal(rejected, true)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-selector-feature-source-"))
try {
  const basePath = path.join(tmp, "base.jsonl")
  const sidePath = path.join(tmp, "side.jsonl")
  const intradayPath = path.join(tmp, "intraday.jsonl")
  const outPath = path.join(tmp, "selector_source.jsonl")
  const summaryPath = path.join(tmp, "summary.json")
  await writeJsonl(basePath, [
    baseRow("000001", "2021-01-04", { hitTarget: true }),
    baseRow("000002", "2021-01-04", { hitTarget: false, openToCloseReturn: 0.02 }),
  ])
  await writeJsonl(sidePath, [sideRow("000001", "2021-01-04"), sideRow("000002", "2021-01-04")])
  await writeJsonl(intradayPath, [intradayRow("000001", "2021-01-04"), intradayRow("000002", "2021-01-04")])

  const summary = await buildTp12SelectorFeatureSourceRepairRows({
    baseFeaturePath: basePath,
    sideFeaturePath: sidePath,
    intradayFeaturePath: intradayPath,
    outPath,
    summaryPath,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.outputRowCount, 2)
  assert.equal(summary.coverage.status, "full_match")
  const assertion = await assertTp12SelectorFeatureSourceRows({ rowPath: outPath })
  assert.equal(assertion.rowCount, 2)
  const rows = await readJsonl(outPath)
  assert.equal(rows[0].d0ClosePressurePct, rows[0].openToCloseReturn)
  assert.equal(rows[0].d0SideDailyAlignment, 1)
  assert.equal(rows[0].d0IntradayCloseStrength, 0.91)
  assert.equal(rows[0].selectorFeatureSourceRepair.sourceAsOf, "D0_CLOSE_ONLY")
  assert.equal(rows[0].selectorFeatureVec["side.investor_d0_signed_log1p"], 1.2)
  assert.equal(rows[0].selectorFeatureVec["intraday.d0_vwap_hold_ratio"], 0.83)

  const missingSidePath = path.join(tmp, "missing_side.jsonl")
  await writeJsonl(missingSidePath, [sideRow("000001", "2021-01-04")])
  await expectReject(
    () =>
      buildTp12SelectorFeatureSourceRepairRows({
        baseFeaturePath: basePath,
        sideFeaturePath: missingSidePath,
        intradayFeaturePath: intradayPath,
        outPath: path.join(tmp, "missing_out.jsonl"),
        summaryPath: path.join(tmp, "missing_summary.json"),
      }),
    /missing side-daily D0 coverage/,
  )

  const forbiddenBasePath = path.join(tmp, "forbidden_base.jsonl")
  const forbiddenSidePath = path.join(tmp, "forbidden_side.jsonl")
  const forbiddenIntradayPath = path.join(tmp, "forbidden_intraday.jsonl")
  await writeJsonl(forbiddenBasePath, [baseRow("000001", "2021-01-04", { entryOpen: 120 })])
  await writeJsonl(forbiddenSidePath, [sideRow("000001", "2021-01-04")])
  await writeJsonl(forbiddenIntradayPath, [intradayRow("000001", "2021-01-04")])
  await expectReject(
    () =>
      buildTp12SelectorFeatureSourceRepairRows({
        baseFeaturePath: forbiddenBasePath,
        sideFeaturePath: forbiddenSidePath,
        intradayFeaturePath: forbiddenIntradayPath,
        outPath: path.join(tmp, "forbidden_out.jsonl"),
        summaryPath: path.join(tmp, "forbidden_summary.json"),
      }),
    /forbidden selector feature\/source field/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_selector_feature_source_repair")
