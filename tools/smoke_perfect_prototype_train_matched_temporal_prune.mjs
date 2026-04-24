import assert from "node:assert/strict"

import {
  minePerfectPrototypes,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"

const makeBaseVectors = () => ({
  featureVec: {
    "candle.bodyPct": 0.04,
    "candle.rangePct": 0.07,
    "volume.ratio20": 1.1,
    "volume.valueRatio20": 1.05,
    "trend.runUp10": 0.18,
    "trend.closeOverMa20": 0.05,
    "trend.closeOverMa120": 0.02,
  },
  globalFeatureVec: {
    ret40: 0.11,
  },
  marketContextVec: {
    candidateCount: 24,
    uniqueSymbolCount: 24,
    bodyPctMedian: 0.03,
    rangePctMedian: 0.065,
    volumeRatio20Median: 1.08,
    valueRatio20Median: 1.04,
    runUp10Median: 0.12,
    ret40Median: 0.1,
    positiveBodyShare: 0.72,
    wideRangeShare: 0.35,
    elevatedVolumeShare: 0.42,
    closeOverMa20Share: 0.83,
    closeOverMa120Share: 0.67,
  },
  xsecEventVec: {
    bodyRankPct: 0.8,
    rangeRankPct: 0.8,
    volumeRankPct: 0.8,
    valueRatioRankPct: 0.8,
    runUp10RankPct: 0.8,
    ret40RankPct: 0.8,
    bodyVsMedian: 0.01,
    rangeVsMedian: 0.005,
    volumeVsMedian: 0.02,
    valueRatioVsMedian: 0.01,
    runUp10VsMedian: 0.06,
    ret40VsMedian: 0.01,
    isolationScore: 1 / 24,
  },
  seq40: [0.01, 0.02, 0.03, 0.04],
  seq150: [0.01, 0.015, 0.02, 0.03, 0.04],
})

const makeRow = ({ index, dateKey, positive, tokens }) => ({
  sourceType: "perfect_prototype_prejump_pack",
  sourceId: `temporal_prune_${positive ? "positive" : "negative"}_${String(index).padStart(2, "0")}`,
  symbol: `${positive ? "1" : "2"}${String(index).padStart(5, "0")}`,
  dateKey,
  decisionDateKey: dateKey,
  asOfDateKey: dateKey,
  strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
  contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  ...makeBaseVectors(),
  contextualTokens: ["tag:test:temporal_prune", ...(Array.isArray(tokens) ? tokens : [])],
  eventOutcome: {
    hitTarget: positive,
  },
})

const buildFixtureRows = () => {
  const positiveSpecs = [
    {
      dateKey: "2024-01-15",
      tokens: ["tag:temporal:root_wide", "tag:temporal:partner_wide"],
    },
    {
      dateKey: "2024-03-15",
      tokens: ["tag:temporal:root_wide", "tag:temporal:partner_wide", "tag:temporal:narrow_month"],
    },
    {
      dateKey: "2024-04-15",
      tokens: ["tag:temporal:root_wide", "tag:temporal:partner_wide", "tag:temporal:narrow_month"],
    },
    {
      dateKey: "2024-04-22",
      tokens: ["tag:temporal:root_wide", "tag:temporal:narrow_quarter"],
    },
    {
      dateKey: "2024-05-20",
      tokens: ["tag:temporal:root_wide", "tag:temporal:narrow_quarter"],
    },
    {
      dateKey: "2024-06-17",
      tokens: ["tag:temporal:root_wide", "tag:temporal:narrow_quarter"],
    },
  ]
  const negativeSpecs = [
    "2024-01-18",
    "2024-02-21",
    "2024-03-20",
    "2024-05-08",
    "2024-07-11",
  ]
  const positiveRows = positiveSpecs.map((spec, index) =>
    makeRow({
      index: index + 1,
      dateKey: spec.dateKey,
      positive: true,
      tokens: spec.tokens,
    }),
  )
  const negativeRows = negativeSpecs.map((dateKey, index) =>
    makeRow({
      index: index + 1,
      dateKey,
      positive: false,
      tokens: ["tag:temporal:background"],
    }),
  )
  return positiveRows.concat(negativeRows)
}

const normalizeRules = (rules) =>
  (Array.isArray(rules) ? rules : []).map((rule) => ({
    tokens: Array.isArray(rule?.tokens) ? [...rule.tokens].sort((left, right) => left.localeCompare(right)) : [],
    trainHitCount: Number(rule?.trainHitCount ?? 0),
    trainMatchCount: Number(rule?.trainMatchCount ?? 0),
    trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
    matchedDateCount: Number(rule?.matchedDateCount ?? 0),
    matchedMonthCount: Number(rule?.matchedMonthCount ?? 0),
    matchedQuarterCount: Number(rule?.matchedQuarterCount ?? 0),
    matchedFoldCount: Number(rule?.matchedFoldCount ?? 0),
    top1DateHitShare: Number(rule?.top1DateHitShare ?? 0),
    top3DateHitShare: Number(rule?.top3DateHitShare ?? 0),
    top1FoldHitShare: Number(rule?.top1FoldHitShare ?? 0),
    top3FoldHitShare: Number(rule?.top3FoldHitShare ?? 0),
  }))

const main = async () => {
  const rows = buildFixtureRows()
  const sharedOptions = {
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    minHitCount: 2,
    minTrainPrecision: 1,
    minTrainMatchedDates: 2,
    minTrainMatchedMonths: 3,
    minTrainMatchedQuarters: 2,
    minTrainMatchedFolds: 3,
    foldScheme: "chronological_4",
    maxRuleSize: 2,
    maxSeedTokens: 32,
    maxRules: 32,
    maxSearchStates: 256,
    maxRejectedRuleSamples: 64,
  }

  const finalGateOnly = minePerfectPrototypes({
    rows,
    options: {
      ...sharedOptions,
      enableTrainMatchedDatePrune: false,
    },
  })
  const pruned = minePerfectPrototypes({
    rows,
    options: {
      ...sharedOptions,
      enableTrainMatchedDatePrune: true,
    },
  })

  assert.deepEqual(
    normalizeRules(pruned.catalog?.rules),
    normalizeRules(finalGateOnly.catalog?.rules),
    "temporal search-time pruning must preserve the final rule set",
  )
  assert(pruned.exploredStates < finalGateOnly.exploredStates)
  assert(
    Number(finalGateOnly?.rejectionSummary?.collectionBelowMinTrainMatchedMonthsCount ?? 0) >= 1,
    "final-gate-only run must reject at least one narrow rule at month breadth collection time",
  )
  assert(
    Number(finalGateOnly?.rejectionSummary?.collectionBelowMinTrainMatchedQuartersCount ?? 0) >= 1,
    "final-gate-only run must reject at least one narrow rule at quarter breadth collection time",
  )
  assert(
    Number(finalGateOnly?.rejectionSummary?.collectionBelowMinTrainMatchedFoldsCount ?? 0) >= 1,
    "final-gate-only run must reject at least one narrow rule at fold breadth collection time",
  )
  assert(
    Number(pruned?.rejectionSummary?.seedBelowMinTrainMatchedMonthsCount ?? 0) >= 1,
    "pruned run must reject the narrow month seed at seed selection time",
  )
  assert(
    Number(pruned?.rejectionSummary?.seedBelowMinTrainMatchedQuartersCount ?? 0) >= 1,
    "pruned run must reject the narrow quarter seed at seed selection time",
  )
  assert(
    Number(pruned?.rejectionSummary?.seedBelowMinTrainMatchedFoldsCount ?? 0) >= 1,
    "pruned run must reject the narrow fold seed at seed selection time",
  )
  assert.equal(
    Number(pruned?.rejectionSummary?.collectionBelowMinTrainMatchedMonthsCount ?? 0),
    0,
    "month-pruned run should prevent narrow month rules from reaching final collection",
  )
  assert.equal(
    Number(pruned?.rejectionSummary?.collectionBelowMinTrainMatchedQuartersCount ?? 0),
    0,
    "quarter-pruned run should prevent narrow quarter rules from reaching final collection",
  )
  assert.equal(
    Number(pruned?.rejectionSummary?.collectionBelowMinTrainMatchedFoldsCount ?? 0),
    0,
    "fold-pruned run should prevent narrow fold rules from reaching final collection",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
