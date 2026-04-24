#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { runTp12Year2hitPrecisionFirstDailyOnly } from "../src/lib/tp12_year2hit_precision_first_daily_only.mjs"

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-precision-rule-"))
const contractPath = path.join(tmpDir, "contract.json")
const candidatesPath = path.join(tmpDir, "candidates.jsonl")
const outSummaryPath = path.join(tmpDir, "summary.json")
const outRuleReportPath = path.join(tmpDir, "rules.jsonl")

const contract = {
  kind: "tp12_year2hit_precision_first_daily_only_contract_v1",
  patchKey: "tp12_year2hit_precision_first_daily_only_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenOosDateRange: { from: "2025-01-02", to: "2026-04-17" },
  featureScope: {
    dailyOnly: true,
    sideDailyAllowed: false,
    intradayAllowed: false,
    themeAllowed: false,
    futureLabelFieldsAllowedAsLiveFeatures: false,
  },
  year2hitGate: { minHitsPerCoreYear: 2, relaxAllowed: false },
  acceptance: {
    minResearchRawPrecisionLift: 0.01,
    minResearchSymbolDatePrecisionLift: 0.01,
    minPromotionRawPrecisionLift: 0.02,
    minPromotionSymbolDatePrecisionLift: 0.02,
    minRawRows: 2,
    minRetainedRowShare: 0.2,
    minActiveYears: 1,
    minActiveMonths: 1,
    minActiveDates: 1,
    maxTopSymbolShare: 1,
    maxTopDateShare: 1,
    maxTopMonthShare: 1,
    maxTopPatternClusterShare: 1,
    minMatchedControlCoverage: 0,
    minMatchedControlAbsoluteLift: -1,
    minMatchedControlRelativeLift: 0,
  },
  lockRules: {
    emitLockedSelector: false,
    oosReplayAllowed: false,
    fallbackAllowed: false,
    oosTuningAllowed: false,
  },
}

const makeRow = ({ symbol, hitTarget, supportClusterCount, sumClusterRowEb, closeLocation, return5d }) => ({
  kind: "smoke",
  decisionDateKey: "2024-01-02",
  symbol,
  hitTarget,
  rawEventRowCount: 1,
  supportPatternIds: [`p_${symbol}`],
  supportClusterIds: [`c_${symbol}`],
  supportClusterSummaries: [{
    clusterId: `c_${symbol}`,
    patternIds: [`p_${symbol}`],
    patternCount: supportClusterCount,
    maxRowEb: sumClusterRowEb,
    maxDateEb: 0.4,
    maxRowWilsonLB: 0.15,
    maxDateWilsonLB: 0.3,
    hitRows: hitTarget ? 10 : 1,
    matchRows: 20,
  }],
  supportPatternCount: supportClusterCount,
  supportClusterCount,
  familyDiversity: 2,
  sumClusterRowEb,
  meanClusterRowEb: sumClusterRowEb / supportClusterCount,
  maxClusterRowEb: sumClusterRowEb,
  maxClusterRowWilsonLB: 0.15,
  supportWeightedClusterRowEb: sumClusterRowEb * 3,
  selectorScore: sumClusterRowEb,
  dayCandidateRows: 4,
  dayUniquePatterns: 4,
  dayUniqueSymbols: 4,
  dayTopScore: 3,
  daySecondScore: 2,
  dayScoreMargin: 1,
  openToCloseReturn: 0.01,
  return1d: 0.01,
  return3d: 0.02,
  return5d,
  return10d: 0.02,
  return20d: 0.03,
  gapPct: 0.01,
  rangePct: 0.05,
  closeLocation,
  closeOverMa5: 0.01,
  closeOverMa20: 0.02,
  closeOverMa60: 0.03,
  tradedValue: 1000000000,
  tradedValueRel20: 0.2,
  tradedValueRel60: 0.1,
  rangeRel20: 0.2,
  returnVol20: 0.02,
  closeToHigh20Pct: -0.02,
  closeFromLow20Pct: 0.2,
  marketUpRatio: 0.55,
  marketUpRatio5: 0.55,
  marketUpRatio20: 0.55,
  marketMeanReturn1d: 0.01,
  marketMeanReturn5: 0.02,
  marketMeanReturn20: 0.03,
  marketMeanTradedValue: 10000000000,
  limitUpProxyCount: 5,
  limitUpProxyAvg5: 3,
  limitUpProxyAvg20: 3,
  limitUpProxyRel20: 1.2,
  foldId: "outer_2024",
})

const rows = [
  makeRow({ symbol: "000001", hitTarget: true, supportClusterCount: 2, sumClusterRowEb: 2.2, closeLocation: 0.9, return5d: 0.04 }),
  makeRow({ symbol: "000002", hitTarget: true, supportClusterCount: 2, sumClusterRowEb: 2.0, closeLocation: 0.85, return5d: 0.03 }),
  makeRow({ symbol: "000003", hitTarget: false, supportClusterCount: 8, sumClusterRowEb: 0.8, closeLocation: 0.3, return5d: 0.25 }),
  makeRow({ symbol: "000004", hitTarget: false, supportClusterCount: 7, sumClusterRowEb: 0.7, closeLocation: 0.35, return5d: 0.22 }),
]

await fs.writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`)
await fs.writeFile(candidatesPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n")

const summary = await runTp12Year2hitPrecisionFirstDailyOnly({
  contractPath,
  candidatesPath,
  outSummaryPath,
  outRuleReportPath,
})

assert.equal(summary.oosRead, false)
assert.equal(summary.sideDailyUsed, false)
assert.equal(summary.lockedSelectorEmitted, false)
assert.equal(summary.candidateRows, 4)
assert(summary.ruleCount > 1)
assert(summary.bestRule)

console.log("[ok] tp12 precision-first rule grid smoke")

