#!/usr/bin/env node
import assert from "node:assert/strict"

import { PREJUMP_PREDICTIVE_STRATEGY_MODE } from "../src/lib/perfect_prototype_prejump_contract.mjs"
import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypePrejumpHypothesisPortfolioDataset } from "../src/lib/perfect_prototype_prejump_hypothesis_portfolio_dataset.mjs"
import { buildPerfectPrototypePrejumpHypothesisPortfolioFeatures } from "../src/lib/perfect_prototype_prejump_hypothesis_portfolio_features.mjs"
import { auditPerfectPrototypePrejumpHypothesisPortfolio } from "../src/lib/perfect_prototype_prejump_hypothesis_portfolio_audit.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"

const laneToken = "tag:stepa.lane:afree_open"
const prejumpToken = "tag:strategy.mode:prejump_predictive_v1"

const makeRow = ({
  symbol,
  dateKey,
  targetDateKey,
  hit,
  netRet,
  base,
  carry,
  risk,
  tokenSet = [],
}) => ({
  sourceId: `${symbol}:${dateKey}`,
  symbol,
  dateKey,
  decisionDateKey: dateKey,
  asOfDateKey: dateKey,
  targetDateKey,
  strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
  outcomeHitTarget: hit === true,
  eventOutcome: {
    netRet,
    hitTarget: hit === true,
    hitStop: hit !== true,
    exitReason: hit === true ? "TARGET" : "STOP",
  },
  numericFeatureMap: {
    "seq40.mean": carry,
    "seq40.delta": carry * 0.8,
    "seq40.last": carry * 0.9,
    "seq40.positiveShare": hit ? 0.9 : 0.2,
    "seq40.negativeShare": risk,
    "seq40.stdev": risk,
    "seq150.mean": carry * 0.9,
    "seq150.delta": carry * 0.7,
    "seq150.last": carry * 0.8,
    "seq150.positiveShare": hit ? 0.88 : 0.25,
    "seq150.negativeShare": risk * 0.9,
    "seq150.stdev": risk * 1.1,
    "feature.avgTradingValue20d": hit ? 4.2 : 2.1,
    "feature.marketCapKrw": hit ? 3.6 : 2.2,
  },
  categoricalTokens: [laneToken, prejumpToken, ...tokenSet],
})

const positiveDates = [
  "2021-01-11",
  "2021-02-15",
  "2021-03-15",
  "2021-04-12",
  "2021-05-17",
  "2021-06-14",
  "2021-07-12",
  "2021-08-16",
  "2021-09-13",
  "2021-10-18",
  "2021-11-15",
  "2021-12-13",
]
const negativeDates = ["2021-01-25", "2021-03-29", "2021-06-28", "2021-08-30", "2021-11-29"]
const oosDates = ["2025-02-03", "2025-04-14", "2025-07-21"]

const trainRows = []
for (const [index, dateKey] of positiveDates.entries()) {
  trainRows.push(
    makeRow({
      symbol: `P${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: true,
      netRet: 0.18,
      base: 1.8,
      carry: 1.7,
      risk: 0.08,
      tokenSet: ["tag:portfolio.cluster:positive", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
    makeRow({
      symbol: `Q${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.05,
      base: -0.4,
      carry: -0.3,
      risk: 0.72,
      tokenSet: ["tag:portfolio.cluster:runnerup", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
  )
}
for (const [index, dateKey] of negativeDates.entries()) {
  trainRows.push(
    makeRow({
      symbol: `N${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.06,
      base: -0.6,
      carry: -0.5,
      risk: 0.82,
      tokenSet: ["tag:portfolio.cluster:negative", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
    makeRow({
      symbol: `M${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.07,
      base: -0.55,
      carry: -0.45,
      risk: 0.78,
      tokenSet: ["tag:portfolio.cluster:negative", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
  )
}

const oosRows = []
for (const [index, dateKey] of oosDates.entries()) {
  oosRows.push(
    makeRow({
      symbol: `OP${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: true,
      netRet: 0.16,
      base: 1.75,
      carry: 1.62,
      risk: 0.07,
      tokenSet: ["tag:portfolio.cluster:positive", `tag:oos.bucket:${index + 1}`],
    }),
    makeRow({
      symbol: `ON${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.04,
      base: -0.45,
      carry: -0.28,
      risk: 0.76,
      tokenSet: ["tag:portfolio.cluster:runnerup", `tag:oos.bucket:${index + 1}`],
    }),
  )
}

const supportCases = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    tokens: [laneToken, prejumpToken, "tag:portfolio.cluster:positive", "tag:month.bucket:03"],
    numericFeatureMap: {
      "seq40.mean": 1.92,
      "seq40.delta": 1.56,
      "seq40.last": 1.68,
      "seq40.positiveShare": 0.91,
      "seq40.negativeShare": 0.06,
      "seq40.stdev": 0.06,
      "seq150.mean": 1.78,
      "seq150.delta": 1.41,
      "seq150.last": 1.52,
      "seq150.positiveShare": 0.89,
      "seq150.negativeShare": 0.05,
      "seq150.stdev": 0.07,
      "feature.avgTradingValue20d": 4.4,
      "feature.marketCapKrw": 3.9,
    },
  },
]

let family = buildPerfectPrototypePrejumpHypothesisPortfolioDataset({
  trainRows,
  oosRows,
  supportCases,
})
assert.equal(family.ok, true)

family = buildPerfectPrototypePrejumpHypothesisPortfolioFeatures({ family })
assert.equal(family.ok, true)
assert.ok((family.summary?.portfolioFeatureCount ?? 0) >= 10)

const audit = auditPerfectPrototypePrejumpHypothesisPortfolio({
  family,
  minPairwiseWinRate: 0.9,
  minSameDateBeatRate: 0.9,
  minMatchedControlBeatRate: 0.85,
  minFailureBeatRate: 0.85,
  minFoldPairwiseWinRate: 0.8,
  maxHardNegativeLeakCount: 0,
})
assert.equal(audit.ok, true)
assert.ok((audit.selectedFeatureKeys ?? []).length >= 2)

family = {
  ...family,
  portfolioSelectedHypothesisId: audit.selectedHypothesisId,
  portfolioSelectedFeatureKeys: audit.selectedFeatureKeys,
}
const solution = calibratePerfectPrototypeSupportTop1QueryRanker({
  family,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 3,
})

assert.equal(solution.supportFitExcluded, true)
assert.ok(Number(solution.candidateCount ?? 0) > 0)
assert.equal(solution.bestTrainSummary.precision, 1)
assert.ok(solution.bestTrainSummary.trainMatchedDateCount >= 10)
assert.ok(solution.bestTrainSummary.trainMatchedMonthCount >= 6)
assert.ok(solution.bestTrainSummary.trainMatchedFoldCount >= 4)
assert.equal(solution.bestTrainSummary.crossfitNegativeWindowCount, 0)
assert.equal(solution.bestOosSummary.openOosPrecision, 1)
assert.ok(solution.bestOosSummary.openOosMatchCount >= 3)

console.log("ok: prejump predictive hypothesis portfolio")
