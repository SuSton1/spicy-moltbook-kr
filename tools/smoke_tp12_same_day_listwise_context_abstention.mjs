#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runTp12SameDayListwiseContextAbstention } from "../src/lib/tp12_same_day_listwise_context_abstention.mjs"

const baseCandidate = (overrides = {}) => ({
  kind: "tp12_context_consensus_feature_v1",
  decisionDateKey: "2021-01-04",
  symbol: "000001",
  hitTarget: false,
  rawEventRowCount: 1,
  supportPatternIds: ["p1"],
  supportClusterIds: ["c1"],
  supportClusterSummaries: [{ clusterId: "c1", patternIds: ["p1"], patternCount: 1, maxRowEb: 0.2, maxDateEb: 0.4, maxRowWilsonLB: 0.1, maxDateWilsonLB: 0.3 }],
  tokenFamilies: ["px"],
  supportPatternCount: 1,
  supportClusterCount: 1,
  familyDiversity: 1,
  nearDuplicatePatternPenalty: 0,
  sumPatternRowEb: 0.2,
  meanPatternRowEb: 0.2,
  maxPatternRowEb: 0.2,
  sumPatternDateEb: 0.4,
  meanPatternDateEb: 0.4,
  maxPatternDateEb: 0.4,
  maxPatternRowWilsonLB: 0.1,
  maxPatternDateWilsonLB: 0.3,
  sumClusterRowEb: 0.2,
  meanClusterRowEb: 0.2,
  maxClusterRowEb: 0.2,
  sumClusterDateEb: 0.4,
  meanClusterDateEb: 0.4,
  maxClusterDateEb: 0.4,
  maxClusterRowWilsonLB: 0.1,
  maxClusterDateWilsonLB: 0.3,
  supportWeightedClusterRowEb: 0.3,
  selectorScore: 1,
  dayRank: 1,
  dayRawEventRows: 2,
  dayCandidateRows: 2,
  daySymbolDateCandidateRows: 2,
  dayUniqueSymbols: 2,
  dayUniquePatterns: 2,
  dayTopScore: 10,
  daySecondScore: 1,
  dayScoreMargin: 9,
  contextMode: "smoke",
  asOfFeatureDateKey: "2021-01-04",
  openToCloseReturn: 0,
  return1d: 0.01,
  return3d: 0.02,
  return5d: 0.03,
  return10d: 0.03,
  return20d: 0.05,
  gapPct: 0.01,
  rangePct: 0.04,
  closeLocation: 0.8,
  closeOverMa5: 0.03,
  closeOverMa20: 0.04,
  closeOverMa60: 0.05,
  tradedValue: 2000000000,
  tradedValueRel20: 0.4,
  tradedValueRel60: 0.3,
  rangeRel20: 0.3,
  returnVol20: 0.02,
  closeToHigh20Pct: -0.02,
  closeFromLow20Pct: 0.12,
  marketRowCount: 100,
  marketReturnCount: 100,
  marketUpRatio: 0.55,
  marketUpRatio5: 0.55,
  marketUpRatio20: 0.5,
  marketMeanReturn1d: 0.01,
  marketMeanReturn5: 0.01,
  marketMeanReturn20: 0.01,
  marketMeanTradedValue: 1000000000,
  limitUpProxyCount: 5,
  limitUpProxyAvg5: 4,
  limitUpProxyAvg20: 4,
  limitUpProxyRel20: 0.25,
  foldId: "outer_2021",
  ...overrides,
})

const writeJsonl = (filePath, rows) => {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

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

const labelFor = (row, maxForwardReturn, minForwardReturn = -0.02) => ({
  decisionDateKey: row.decisionDateKey,
  symbol: row.symbol,
  hitTarget: row.hitTarget,
  maxForwardReturn,
  minForwardReturn,
})

const main = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp12-listwise-context-"))
  const candidatesPath = path.join(dir, "candidates.jsonl")
  const labelsPath = path.join(dir, "labels.jsonl")
  const outSummaryPath = path.join(dir, "summary.json")
  const outSelectionsPath = path.join(dir, "selections.jsonl")
  const outFeaturesPath = path.join(dir, "features.jsonl.gz")

  const falseCrowded = (date, symbol) => baseCandidate({
    decisionDateKey: date,
    symbol,
    hitTarget: false,
    selectorScore: 10,
    supportPatternCount: 25,
    supportClusterCount: 25,
    supportClusterSummaries: [{ clusterId: "crowded", patternIds: ["p1"], patternCount: 25, maxRowEb: 0.25, maxDateEb: 0.4, maxRowWilsonLB: 0.15, maxDateWilsonLB: 0.3 }],
    sumClusterRowEb: 6,
    meanClusterRowEb: 0.24,
    maxClusterRowEb: 0.25,
    maxClusterRowWilsonLB: 0.15,
    supportWeightedClusterRowEb: 40,
    return1d: 0.14,
    return3d: 0.18,
    return5d: 0.22,
    gapPct: 0.09,
    return20d: 0.35,
    returnVol20: 0.08,
    closeToHigh20Pct: 0.01,
    closeLocation: 0.4,
    tradedValueRel20: -0.2,
  })
  const trueQuality = (date, symbol) => baseCandidate({
    decisionDateKey: date,
    symbol,
    hitTarget: true,
    selectorScore: 2,
    supportPatternCount: 4,
    supportClusterCount: 4,
    supportClusterSummaries: [
      { clusterId: "quality_a", patternIds: ["p2", "p3"], patternCount: 2, maxRowEb: 0.55, maxDateEb: 0.5, maxRowWilsonLB: 0.5, maxDateWilsonLB: 0.4 },
      { clusterId: "quality_b", patternIds: ["p4", "p5"], patternCount: 2, maxRowEb: 0.52, maxDateEb: 0.5, maxRowWilsonLB: 0.48, maxDateWilsonLB: 0.4 },
    ],
    sumClusterRowEb: 1.1,
    meanClusterRowEb: 0.55,
    maxClusterRowEb: 0.55,
    maxClusterRowWilsonLB: 0.5,
    supportWeightedClusterRowEb: 5,
    return1d: 0.01,
    return3d: 0.02,
    return5d: 0.04,
    gapPct: 0.005,
    return20d: 0.08,
    returnVol20: 0.015,
    closeToHigh20Pct: -0.03,
    closeLocation: 0.9,
    tradedValueRel20: 0.8,
    rangeRel20: 0.6,
  })
  const rows = [
    falseCrowded("2021-01-04", "000001"),
    trueQuality("2021-01-04", "000002"),
    falseCrowded("2021-01-05", "000003"),
    trueQuality("2021-01-05", "000004"),
    trueQuality("2021-01-06", "000005"),
    baseCandidate({ decisionDateKey: "2021-01-06", symbol: "000006", hitTarget: false, selectorScore: 0.5, maxClusterRowWilsonLB: 0.05 }),
  ]
  writeJsonl(candidatesPath, rows)
  writeJsonl(labelsPath, rows.map((row) => labelFor(row, row.hitTarget ? 0.15 : 0.03)))

  const summary = await runTp12SameDayListwiseContextAbstention({
    candidatesPath,
    pathLabelsPath: labelsPath,
    outSummaryPath,
    outSelectionsPath,
    outFeaturesPath,
    dateFrom: "2021-01-01",
    dateTo: "2021-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    minSelectedRows: 1,
    targetWilsonLower95: 0.8,
    primaryTopCutRows: 2,
    topCuts: [2, 3],
  })

  assert.equal(summary.candidateRows, 6)
  assert.equal(summary.candidateDateCount, 3)
  assert.equal(summary.dailyOracleHitRate, 1)
  assert.equal(summary.lockedSelectorEmitted, false)
  assert.equal(summary.baselineForced.hitRows, 1)
  assert.equal(summary.bestForced.hitRows > summary.baselineForced.hitRows, true)
  assert.equal(fs.existsSync(outSummaryPath), true)
  assert.equal(fs.existsSync(outSelectionsPath), true)
  assert.equal(fs.existsSync(outFeaturesPath), true)

  const oosCandidates = path.join(dir, "oos-candidates.jsonl")
  const oosLabels = path.join(dir, "oos-labels.jsonl")
  const oosRow = trueQuality("2025-01-02", "999999")
  writeJsonl(oosCandidates, [oosRow])
  writeJsonl(oosLabels, [labelFor(oosRow, 0.15)])
  await expectReject(() => runTp12SameDayListwiseContextAbstention({
    candidatesPath: oosCandidates,
    pathLabelsPath: oosLabels,
    outSummaryPath: path.join(dir, "bad-summary.json"),
    outSelectionsPath: path.join(dir, "bad-selections.jsonl"),
    outFeaturesPath: path.join(dir, "bad-features.jsonl.gz"),
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
  }), /inside forbidden range/)

  const missingLabels = path.join(dir, "missing-labels.jsonl")
  writeJsonl(missingLabels, [])
  await expectReject(() => runTp12SameDayListwiseContextAbstention({
    candidatesPath,
    pathLabelsPath: missingLabels,
    outSummaryPath: path.join(dir, "missing-summary.json"),
    outSelectionsPath: path.join(dir, "missing-selections.jsonl"),
    outFeaturesPath: path.join(dir, "missing-features.jsonl.gz"),
  }), /zero symbol\/date labels/)

  console.log("ok smoke_tp12_same_day_listwise_context_abstention")
}

main().catch((error) => {
  console.error(error.stack || String(error))
  process.exit(1)
})
