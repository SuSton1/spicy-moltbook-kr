#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  minePerfectPrototypes,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  evaluatePerfectPrototypeYearHitUpperBoundGuard,
} from "../src/lib/perfect_prototype_year_hit_guard.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"

const CORE_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

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
  sourceId: `year_hit_prune_${positive ? "positive" : "negative"}_${String(index).padStart(3, "0")}`,
  symbol: `${positive ? "1" : "2"}${String(index).padStart(5, "0")}`,
  dateKey,
  decisionDateKey: dateKey,
  asOfDateKey: dateKey,
  strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
  contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  ...makeBaseVectors(),
  contextualTokens: ["tag:test:year_hit_prune", ...(Array.isArray(tokens) ? tokens : [])],
  eventOutcome: {
    hitTarget: positive,
  },
})

const buildFixtureRows = () => {
  const rows = []
  let index = 0
  for (const year of CORE_YEARS) {
    rows.push(
      makeRow({
        index: ++index,
        dateKey: `${year}-02-05`,
        positive: true,
        tokens: ["tag:year2x8:anchor", "tag:year2x8:partner", "tag:year2x8:narrow_seed"],
      }),
    )
    rows.push(
      makeRow({
        index: ++index,
        dateKey: `${year}-08-05`,
        positive: true,
        tokens: ["tag:year2x8:anchor", "tag:year2x8:partner"],
      }),
    )
  }
  rows.push(
    makeRow({
      index: ++index,
      dateKey: "2017-11-10",
      positive: false,
      tokens: ["tag:year2x8:background"],
    }),
  )
  rows.push(
    makeRow({
      index: ++index,
      dateKey: "2019-11-10",
      positive: false,
      tokens: ["tag:year2x8:background"],
    }),
  )
  rows.push(
    makeRow({
      index: ++index,
      dateKey: "2021-11-10",
      positive: false,
      tokens: ["tag:year2x8:background"],
    }),
  )
  rows.push(
    makeRow({
      index: ++index,
      dateKey: "2024-11-10",
      positive: false,
      tokens: ["tag:year2x8:background"],
    }),
  )
  return rows
}

const sharedOptions = {
  surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
  minHitCount: 2,
  minTrainPrecision: 1,
  minTrainMatchedDates: 8,
  minTrainMatchedMonths: 8,
  minTrainMatchedFolds: 3,
  foldScheme: "chronological_4",
  maxRuleSize: 2,
  maxSeedTokens: 32,
  maxRules: 64,
  maxSearchStates: 1024,
  maxRejectedRuleSamples: 64,
}

const main = async () => {
  const rows = buildFixtureRows()
  const withoutPrune = minePerfectPrototypes({
    rows,
    options: {
      ...sharedOptions,
      enableYearHitUpperBoundPrune: false,
    },
  })
  const withPrune = minePerfectPrototypes({
    rows,
    options: {
      ...sharedOptions,
      enableYearHitUpperBoundPrune: true,
      coreYears: CORE_YEARS,
      excludedBoundaryYears: [2016],
      minTrainHitsPerCoreYear: 2,
    },
  })

  const withoutTokens = new Set(
    (withoutPrune.catalog?.rules ?? []).map((rule) => (Array.isArray(rule?.tokens) ? rule.tokens.join("|") : "")),
  )
  const withTokens = new Set(
    (withPrune.catalog?.rules ?? []).map((rule) => (Array.isArray(rule?.tokens) ? rule.tokens.join("|") : "")),
  )

  assert(withoutTokens.has("tag:year2x8:anchor"))
  assert(withoutTokens.has("tag:year2x8:narrow_seed"))
  assert(withTokens.has("tag:year2x8:anchor"))
  assert(!withTokens.has("tag:year2x8:narrow_seed"))

  for (const rule of withPrune.catalog?.rules ?? []) {
    const guard = evaluatePerfectPrototypeYearHitUpperBoundGuard({
      hitDates: Array.isArray(rule?.hitDates) ? rule.hitDates : [],
      coreYears: CORE_YEARS,
      excludedBoundaryYears: [2016],
      minTrainHitsPerCoreYear: 2,
    })
    assert.equal(guard.ok, true)
  }

  assert(Number(withPrune?.rejectionSummary?.yearHitUpperBoundPruneCount ?? 0) >= 1)
  assert(withPrune.exploredStates < withoutPrune.exploredStates)
  console.log("ok smoke_perfect_prototype_year_hit_prune")
}

await main()
