#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerLabels } from "../src/lib/perfect_prototype_daily_canonical_winner_labels.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerQueryFeatures } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_features.mjs"
import { buildPerfectPrototypeSupportFeatureSupplierUnion } from "../src/lib/perfect_prototype_support_feature_supplier_union.mjs"
import { buildPerfectPrototypeDailyTradeAbstainSlateDataset } from "../src/lib/perfect_prototype_daily_trade_abstain_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGate } from "../src/lib/perfect_prototype_daily_trade_abstain_gate.mjs"
import { buildPerfectPrototypeDailyWinnerArchetypeRouter } from "../src/lib/perfect_prototype_daily_winner_archetype_router.mjs"
import { buildPerfectPrototypeDailyArchetypeRuleBank } from "../src/lib/perfect_prototype_daily_archetype_rule_bank.mjs"

const sameDayToken = "tag:stepa.lane:same_day_high8"
const recentToken = "tag:stepa.lane:recent_impulse_1d"

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  foldId,
  windowId,
  hit,
  netRet,
  carry,
  breadth,
  purity,
  risk,
}) => ({
  rowKey,
  sourceId: rowKey,
  symbol,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget: hit === true,
  eventOutcome: {
    hitTarget: hit === true,
    netRet,
    entryDateKey: `${dateKey.slice(0, 8)}20`,
  },
  numericFeatureMap: {
    "feature.avgTradingValue20d": carry * 3,
    "global.avgTradingValue20d": carry * 2.8,
    "sig.boundary.supportRecoveryPotential": carry,
    "sig.ordinalMotif.motifAgreement": purity,
    "sig.ordinalMotif.supportRecoveryPotential": carry * 1.05,
    "sig.recurBoundary.localBreadthPurityGap": breadth,
    "sig.recurBoundary.localRecoveryMargin": purity * 0.9,
    "sig.recurBoundary.crossfitLeakShare": risk,
  },
  categoricalTokens: [sameDayToken, recentToken],
  tokenSet: new Set([sameDayToken, recentToken]),
})

const archetypeAPositiveDates = [
  ["2021-01-11", 1, 1],
  ["2021-02-15", 1, 1],
  ["2021-03-15", 2, 2],
  ["2021-04-12", 2, 2],
  ["2021-05-17", 3, 3],
  ["2021-06-14", 3, 3],
]
const archetypeBPositiveDates = [
  ["2021-07-12", 4, 4],
  ["2021-08-16", 4, 4],
  ["2021-09-13", 1, 5],
  ["2021-10-18", 2, 5],
  ["2021-11-15", 3, 6],
  ["2021-12-13", 4, 6],
]
const controlDates = [
  ["2021-01-25", 1, 1],
  ["2021-03-29", 2, 2],
  ["2021-06-28", 3, 3],
  ["2021-08-30", 4, 4],
  ["2021-10-25", 2, 5],
  ["2021-12-27", 4, 6],
]
const oosDates = [
  ["2025-02-03", 1, 1],
  ["2025-04-14", 2, 2],
  ["2025-07-21", 3, 3],
]

const trainRows = []
for (const [dateKey, foldId, windowId] of archetypeAPositiveDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::WA`,
      symbol: `WA${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.18,
      carry: 2.0,
      breadth: 1.8,
      purity: 1.7,
      risk: 0.02,
    }),
    makeRow({
      rowKey: `${dateKey}::RA`,
      symbol: `RA${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.03,
      carry: 0.9,
      breadth: 0.8,
      purity: 0.7,
      risk: 0.14,
    }),
  )
}
for (const [dateKey, foldId, windowId] of archetypeBPositiveDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::WB`,
      symbol: `WB${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.16,
      carry: 1.25,
      breadth: 1.15,
      purity: 2.0,
      risk: 0.02,
    }),
    makeRow({
      rowKey: `${dateKey}::RB`,
      symbol: `RB${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      carry: 0.7,
      breadth: 0.55,
      purity: 0.8,
      risk: 0.16,
    }),
  )
}

const controlTrainRows = []
for (const [dateKey, foldId, windowId] of controlDates) {
  controlTrainRows.push(
    makeRow({
      rowKey: `${dateKey}::C1`,
      symbol: `C${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.05,
      carry: 0.45,
      breadth: 0.35,
      purity: 0.4,
      risk: 0.22,
    }),
    makeRow({
      rowKey: `${dateKey}::C2`,
      symbol: `D${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.06,
      carry: 0.4,
      breadth: 0.3,
      purity: 0.35,
      risk: 0.25,
    }),
  )
}

const oosRows = []
for (const [dateKey, foldId, windowId] of oosDates) {
  oosRows.push(
    makeRow({
      rowKey: `${dateKey}::OW`,
      symbol: `OW${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.17,
      carry: 1.9,
      breadth: 1.65,
      purity: 1.75,
      risk: 0.02,
    }),
    makeRow({
      rowKey: `${dateKey}::OR`,
      symbol: `OR${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      carry: 0.75,
      breadth: 0.6,
      purity: 0.7,
      risk: 0.15,
    }),
  )
}

const supportCases = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    tokens: [sameDayToken, recentToken],
    donorTokens: [sameDayToken, recentToken],
    numericFeatureMap: {
      "sig.boundary.supportRecoveryPotential": 1.95,
      "sig.ordinalMotif.motifAgreement": 1.8,
      "sig.ordinalMotif.supportRecoveryPotential": 2.05,
      "sig.recurBoundary.localBreadthPurityGap": 1.6,
      "sig.recurBoundary.localRecoveryMargin": 1.65,
      "sig.recurBoundary.crossfitLeakShare": 0.01,
      "feature.avgTradingValue20d": 5.4,
      "global.avgTradingValue20d": 5.1,
    },
  },
]

let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
  trainRows,
  controlTrainRows,
  oosRows,
  controlOosRows: [],
  supportCases,
})
family = buildPerfectPrototypeSupportTemporalEpisodeDataset({ family, lookbackTradingDays: 4 })
family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
family = buildPerfectPrototypeDailyCanonicalWinnerLabels({ family })
family = buildPerfectPrototypeSupportDateQueryDataset({ family })
family = buildPerfectPrototypeSupportMatchedControlPool({ family, controlPoolSize: 3 })
family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
family = buildPerfectPrototypeRecentMidLowWinnerQueryFeatures({ family })
family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })
family = buildPerfectPrototypeDailyTradeAbstainSlateDataset({ family })

assert.equal(family.ok, true)
assert.ok((family.summary?.controlOnlyDateCount ?? 0) > 0)

family = calibratePerfectPrototypeDailyTradeAbstainGate({
  family,
  minTradeDates: 10,
  minTradeMonths: 6,
  minTradeFolds: 4,
})
assert.equal(family.ok, true)
assert.equal(family.summary.tradeGateControlLeakCount, 0)
assert.ok((family.admittedTradeDateKeys ?? []).length >= 10)

family = buildPerfectPrototypeDailyWinnerArchetypeRouter({ family, minArchetypeDates: 2, maxArchetypes: 4 })
assert.equal(family.ok, true)
assert.ok((family.summary?.winnerArchetypeCount ?? 0) >= 2)

family = buildPerfectPrototypeDailyArchetypeRuleBank({
  family,
  minTrainMatchedDates: 5,
  minTrainMatchedMonths: 4,
  minTrainMatchedFolds: 2,
  minCrossfitPositiveWindows: 1,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 0,
})
assert.ok((family.summary?.archetypeRuleBankCandidateCount ?? 0) >= 2)
assert.ok((family.summary?.archetypeRuleBankBestCandidate ?? null) !== null)

console.log("ok: trade abstain archetype winner bank")
