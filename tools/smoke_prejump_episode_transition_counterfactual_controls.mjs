#!/usr/bin/env node
import assert from "node:assert/strict"

import { PREJUMP_PREDICTIVE_STRATEGY_MODE } from "../src/lib/perfect_prototype_prejump_contract.mjs"
import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions } from "../src/lib/perfect_prototype_prejump_decision_date_stratified_sampler.mjs"
import { buildPerfectPrototypePrejumpEpisodeTransitionControlDataset } from "../src/lib/perfect_prototype_prejump_episode_transition_control_dataset.mjs"
import { buildPerfectPrototypePrejumpHypothesisPortfolioFeatures } from "../src/lib/perfect_prototype_prejump_hypothesis_portfolio_features.mjs"
import { auditPerfectPrototypePrejumpEpisodeTransition } from "../src/lib/perfect_prototype_prejump_episode_transition_audit.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"

const laneToken = "tag:stepa.lane:afree_open"
const prejumpToken = "tag:strategy.mode:prejump_predictive_v1"

const makeRow = ({
  symbol,
  dateKey,
  targetDateKey,
  hit,
  netRet,
  carry,
  risk,
  liquidity = 4,
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
    "seq40.positiveShare": hit ? 0.92 : 0.22,
    "seq40.negativeShare": risk,
    "seq40.stdev": risk,
    "seq150.mean": carry * 0.88,
    "seq150.delta": carry * 0.72,
    "seq150.last": carry * 0.8,
    "seq150.positiveShare": hit ? 0.9 : 0.24,
    "seq150.negativeShare": risk * 0.95,
    "seq150.stdev": risk * 1.05,
    "feature.avgTradingValue20d": liquidity,
    "global.avgTradingValue20d": liquidity * 0.95,
    "feature.marketCapKrw": liquidity * 0.85,
    "global.marketCapKrw": liquidity * 0.8,
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
const oosDates = ["2025-02-03", "2025-04-14", "2025-07-21"]

const trainRows = []
for (const [index, dateKey] of positiveDates.entries()) {
  trainRows.push(
    makeRow({
      symbol: `P${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: true,
      netRet: 0.17,
      carry: 1.75,
      risk: 0.05,
      tokenSet: ["tag:portfolio.cluster:positive", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
    makeRow({
      symbol: `R${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.04,
      carry: 0.95,
      risk: 0.08,
      tokenSet: ["tag:portfolio.cluster:runnerup", `tag:month.bucket:${dateKey.slice(5, 7)}`],
    }),
    makeRow({
      symbol: `N${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.07,
      carry: -0.2,
      risk: 0.16,
      liquidity: 2.2,
      tokenSet: ["tag:portfolio.cluster:failure", `tag:month.bucket:${dateKey.slice(5, 7)}`],
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
      carry: 1.7,
      risk: 0.04,
      tokenSet: ["tag:portfolio.cluster:positive", `tag:oos.bucket:${index + 1}`],
    }),
    makeRow({
      symbol: `OR${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.05,
      carry: 0.92,
      risk: 0.08,
      tokenSet: ["tag:portfolio.cluster:runnerup", `tag:oos.bucket:${index + 1}`],
    }),
    makeRow({
      symbol: `ON${index + 1}`,
      dateKey,
      targetDateKey: `${dateKey.slice(0, 8)}20`,
      hit: false,
      netRet: -0.08,
      carry: -0.24,
      risk: 0.16,
      liquidity: 2.1,
      tokenSet: ["tag:portfolio.cluster:failure", `tag:oos.bucket:${index + 1}`],
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
      "seq40.mean": 1.88,
      "seq40.delta": 1.5,
      "seq40.last": 1.66,
      "seq40.positiveShare": 0.93,
      "seq40.negativeShare": 0.05,
      "seq40.stdev": 0.05,
      "seq150.mean": 1.78,
      "seq150.delta": 1.4,
      "seq150.last": 1.55,
      "seq150.positiveShare": 0.9,
      "seq150.negativeShare": 0.05,
      "seq150.stdev": 0.06,
      "feature.avgTradingValue20d": 4.6,
      "global.avgTradingValue20d": 4.2,
      "feature.marketCapKrw": 3.8,
      "global.marketCapKrw": 3.5,
    },
  },
]

const samplerInput = []
for (let month = 1; month <= 12; month += 1) {
  const monthText = String(month).padStart(2, "0")
  samplerInput.push(
    { dateKey: `2021-${monthText}-05`, parquetPath: `/tmp/${monthText}-a.parquet` },
    { dateKey: `2021-${monthText}-19`, parquetPath: `/tmp/${monthText}-b.parquet` },
  )
}
const selection = selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions({
  partitions: samplerInput,
  maxDecisionDates: 12,
})
assert.equal(selection.selectedDecisionDateCount, 12)
assert.equal(selection.selectedDecisionMonthCount, 12)

let family = buildPerfectPrototypePrejumpEpisodeTransitionControlDataset({
  trainRows,
  oosRows,
  supportCases,
})
assert.equal(family.ok, true)
assert.ok((family.summary?.matchedControlSummary?.rowCount ?? 0) >= 2)

family = buildPerfectPrototypePrejumpHypothesisPortfolioFeatures({ family })
assert.equal(family.ok, true)
assert.ok((family.summary?.portfolioFeatureCount ?? 0) >= 10)

const audit = auditPerfectPrototypePrejumpEpisodeTransition({
  family,
  minPairwiseWinRate: 0.95,
  minSameDateBeatRate: 0.95,
  minMatchedControlBeatRate: 0.9,
  minFailureBeatRate: 0.9,
  minFoldPairwiseWinRate: 0.9,
  maxHardNegativeLeakCount: 0,
})
assert.equal(audit.ok, true)
assert.equal(audit.canonicalHypothesisId, "H2")
assert.ok((audit.selectedFeatureKeys ?? []).length >= 2)

family = {
  ...family,
  portfolioSelectedHypothesisId: audit.canonicalHypothesisId,
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

console.log("ok: prejump episode-transition counterfactual controls")
