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
import { buildPerfectPrototypeShadowWinnerSlateDataset } from "../src/lib/perfect_prototype_shadow_winner_slate_dataset.mjs"
import { buildPerfectPrototypeShadowWinnerSlateFeatures } from "../src/lib/perfect_prototype_shadow_winner_slate_features.mjs"
import { auditPerfectPrototypeShadowWinnerSlateSeparability } from "../src/lib/perfect_prototype_shadow_winner_slate_separability_audit.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"

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
    "sig.ordinalMotif.motifAgreement": carry,
    "sig.ordinalMotif.supportRecoveryPotential": carry * 1.1,
    "sig.recurBoundary.localBreadthPurityGap": carry * 0.9,
    "sig.recurBoundary.localRecoveryMargin": carry * 0.8,
    "sig.recurBoundary.crossfitLeakShare": risk,
  },
  categoricalTokens: [sameDayToken, recentToken],
  tokenSet: new Set([sameDayToken, recentToken]),
})

const positiveDates = [
  ["2021-01-11", 1, 1],
  ["2021-02-15", 1, 1],
  ["2021-03-15", 2, 2],
  ["2021-04-12", 2, 2],
  ["2021-05-17", 3, 3],
  ["2021-06-14", 3, 3],
  ["2021-07-12", 4, 4],
  ["2021-08-16", 4, 4],
  ["2021-09-13", 1, 5],
  ["2021-10-18", 2, 5],
  ["2021-11-15", 3, 6],
  ["2021-12-13", 4, 6],
]
const abstainDates = [
  ["2021-01-25", 1, 1],
  ["2021-03-29", 2, 2],
  ["2021-06-28", 3, 3],
  ["2021-08-30", 4, 4],
]
const oosDates = [
  ["2025-02-03", 1, 1],
  ["2025-04-14", 2, 2],
  ["2025-07-21", 3, 3],
]

const trainRows = []
for (const [dateKey, foldId, windowId] of positiveDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::W`,
      symbol: `W${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.18,
      carry: 1.8,
      risk: 0.02,
    }),
    makeRow({
      rowKey: `${dateKey}::R`,
      symbol: `R${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.03,
      carry: 0.8,
      risk: 0.15,
    }),
  )
}
for (const [dateKey, foldId, windowId] of abstainDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::A1`,
      symbol: `A${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.05,
      carry: 0.5,
      risk: 0.24,
    }),
    makeRow({
      rowKey: `${dateKey}::A2`,
      symbol: `B${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.07,
      carry: 0.45,
      risk: 0.28,
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
      carry: 1.75,
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
      risk: 0.16,
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
      "sig.boundary.supportRecoveryPotential": 1.9,
      "sig.ordinalMotif.motifAgreement": 1.85,
      "sig.ordinalMotif.supportRecoveryPotential": 2.05,
      "sig.recurBoundary.localBreadthPurityGap": 1.7,
      "sig.recurBoundary.localRecoveryMargin": 1.55,
      "sig.recurBoundary.crossfitLeakShare": 0.01,
      "feature.avgTradingValue20d": 5.2,
      "global.avgTradingValue20d": 4.9,
    },
  },
  {
    caseId: "support-peer-secondary",
    symbol: "000999",
    dateKey: "2026-03-18",
    tokens: [sameDayToken, recentToken],
    donorTokens: [sameDayToken, recentToken],
    numericFeatureMap: {
      "sig.boundary.supportRecoveryPotential": 1.1,
      "sig.ordinalMotif.motifAgreement": 1.05,
      "sig.ordinalMotif.supportRecoveryPotential": 1.15,
      "sig.recurBoundary.localBreadthPurityGap": 0.95,
      "sig.recurBoundary.localRecoveryMargin": 0.85,
      "sig.recurBoundary.crossfitLeakShare": 0.12,
      "feature.avgTradingValue20d": 3.4,
      "global.avgTradingValue20d": 3.1,
    },
  },
]

let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
  trainRows,
  oosRows,
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
family = buildPerfectPrototypeShadowWinnerSlateDataset({ family })
family = buildPerfectPrototypeShadowWinnerSlateFeatures({ family })

assert.equal(family.ok, true)
assert.ok((family.summary?.shadowWinnerSlateFeatureCount ?? 0) > 0)

const audit = auditPerfectPrototypeShadowWinnerSlateSeparability({
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
  shadowWinnerSlateAuditFeatureKeys: audit.selectedFeatureKeys,
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

console.log("ok: daily canonical winner slate")
