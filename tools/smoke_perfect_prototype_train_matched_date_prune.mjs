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
    candidateCount: 32,
    uniqueSymbolCount: 32,
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
    isolationScore: 1 / 32,
  },
  seq40: [0.01, 0.02, 0.03, 0.04],
  seq150: [0.01, 0.015, 0.02, 0.03, 0.04],
})

const buildDateKeys = (count) => {
  const out = []
  const cursor = new Date("2024-01-02T00:00:00Z")
  while (out.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const buildFixtureRows = () => {
  const positiveDates = [
    ...buildDateKeys(11),
  ]
  const negativeDates = buildDateKeys(24).slice(11, 15)
  const positiveRows = positiveDates.map((dateKey, index) => ({
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `breadth_prune_positive_${String(index + 1).padStart(2, "0")}`,
    symbol: `100${String(index + 1).padStart(3, "0")}`,
    dateKey,
    decisionDateKey: dateKey,
    asOfDateKey: dateKey,
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    ...makeBaseVectors(),
    contextualTokens: [
      "tag:test:fixture",
      ...(index < 10 ? ["tag:prune:root"] : []),
      ...(index < 9 ? ["tag:prune:partner_wide"] : []),
      ...((index < 8 || index === 9) ? ["tag:prune:seed_narrow"] : []),
    ],
    eventOutcome: {
      hitTarget: true,
    },
  }))
  const negativeRows = negativeDates.map((dateKey, index) => ({
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `breadth_prune_negative_${String(index + 1).padStart(2, "0")}`,
    symbol: `200${String(index + 1).padStart(3, "0")}`,
    dateKey,
    decisionDateKey: dateKey,
    asOfDateKey: dateKey,
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    ...makeBaseVectors(),
    contextualTokens: ["tag:test:fixture", "tag:prune:background"],
    eventOutcome: {
      hitTarget: false,
    },
  }))
  return positiveRows.concat(negativeRows)
}

const normalizeRules = (rules) =>
  (Array.isArray(rules) ? rules : []).map((rule) => ({
    tokens: Array.isArray(rule?.tokens) ? [...rule.tokens].sort((left, right) => left.localeCompare(right)) : [],
    trainHitCount: Number(rule?.trainHitCount ?? 0),
    trainMatchCount: Number(rule?.trainMatchCount ?? 0),
    trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
    matchedDateCount: Number(rule?.matchedDateCount ?? 0),
    top1DateHitShare: Number(rule?.top1DateHitShare ?? 0),
    top3DateHitShare: Number(rule?.top3DateHitShare ?? 0),
  }))

const main = async () => {
  const rows = buildFixtureRows()
  const sharedOptions = {
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    minHitCount: 2,
    minTrainPrecision: 1,
    minTrainMatchedDates: 10,
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
    "search-time breadth pruning must preserve the final rule set",
  )
  assert(pruned.exploredStates < finalGateOnly.exploredStates)
  assert(
    Number(finalGateOnly?.rejectionSummary?.collectionBelowMinTrainMatchedDatesCount ?? 1) >= 1,
    "final-gate-only run must reject at least one narrow rule at collection time",
  )
  assert(
    Number(pruned?.rejectionSummary?.seedBelowMinTrainMatchedDatesCount ?? 0) >= 1,
    "pruned run must reject the narrow seed at seed selection time",
  )
  assert.equal(
    Number(pruned?.rejectionSummary?.collectionBelowMinTrainMatchedDatesCount ?? 0),
    0,
    "pruned run should prevent the narrow rule from reaching final collection",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
