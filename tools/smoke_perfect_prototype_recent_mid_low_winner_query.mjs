#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeRecentMidLowWinnerQueryDataset } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_dataset.mjs"
import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerLabels } from "../src/lib/perfect_prototype_recent_mid_low_winner_labels.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerQueryFeatures } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_features.mjs"
import { calibratePerfectPrototypeRecentMidLowWinnerQuery } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_calibrate.mjs"
import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"

const laneToken = "tag:stepa.lane:recent_impulse_1d"
const midToken = "tag:xsec.closeRank:MID"
const lowToken = "tag:xsec.closeRank:LOW"

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  foldId,
  windowId,
  hit,
  closeRankToken,
  agreement,
  recovery,
  purityGap,
  localRecovery,
  leakShare,
  boundaryRecovery,
  caseId = null,
}) => ({
  rowKey,
  symbol,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget: hit === true,
  numericFeatureMap: {
    "sig.ordinalMotif.motifAgreement": agreement,
    "sig.ordinalMotif.supportRecoveryPotential": recovery,
    "sig.recurBoundary.localBreadthPurityGap": purityGap,
    "sig.recurBoundary.localRecoveryMargin": localRecovery,
    "sig.recurBoundary.crossfitLeakShare": leakShare,
    "sig.boundary.supportRecoveryPotential": boundaryRecovery,
  },
  categoricalTokens: [laneToken, closeRankToken],
  tokenSet: new Set([laneToken, closeRankToken]),
  caseId,
})

const positiveDates = [
  ["2021-01-11", 1, 1, lowToken], ["2021-02-12", 1, 1, midToken], ["2021-03-15", 2, 2, lowToken],
  ["2021-04-12", 2, 2, midToken], ["2021-05-17", 3, 3, lowToken], ["2021-06-14", 3, 3, midToken],
  ["2021-07-12", 4, 4, lowToken], ["2021-08-16", 4, 4, midToken], ["2021-09-13", 1, 5, lowToken],
  ["2021-10-18", 2, 5, midToken],
]
const negativeDates = [
  ["2021-01-25", 1, 1, lowToken], ["2021-03-29", 2, 2, midToken], ["2021-06-28", 3, 3, lowToken], ["2021-08-30", 4, 4, midToken],
]
const oosDates = [
  ["2025-02-03", 1, 1, lowToken], ["2025-04-14", 2, 2, midToken], ["2025-07-21", 3, 3, lowToken],
]

const trainRows = []
for (const [dateKey, foldId, windowId, closeRankToken] of positiveDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::P1`,
      symbol: `P${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      closeRankToken,
      agreement: 0.95,
      recovery: 2.2,
      purityGap: 2.0,
      localRecovery: 1.8,
      leakShare: 0.03,
      boundaryRecovery: 1.6,
    }),
    makeRow({
      rowKey: `${dateKey}::P2`,
      symbol: `Q${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      agreement: 0.4,
      recovery: 0.1,
      purityGap: 0.0,
      localRecovery: 0.0,
      leakShare: 0.35,
      boundaryRecovery: 0.0,
    }),
  )
}
for (const [dateKey, foldId, windowId, closeRankToken] of negativeDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::N1`,
      symbol: `N${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      agreement: 0.15,
      recovery: -0.8,
      purityGap: -1.0,
      localRecovery: -0.8,
      leakShare: 0.92,
      boundaryRecovery: -0.3,
    }),
    makeRow({
      rowKey: `${dateKey}::N2`,
      symbol: `M${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      agreement: 0.12,
      recovery: -0.6,
      purityGap: -0.7,
      localRecovery: -0.6,
      leakShare: 0.88,
      boundaryRecovery: -0.2,
    }),
  )
}

const oosRows = []
for (const [dateKey, foldId, windowId, closeRankToken] of oosDates) {
  oosRows.push(
    makeRow({
      rowKey: `${dateKey}::OP`,
      symbol: `OP${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      closeRankToken,
      agreement: 0.96,
      recovery: 2.1,
      purityGap: 2.1,
      localRecovery: 1.8,
      leakShare: 0.01,
      boundaryRecovery: 1.7,
    }),
    makeRow({
      rowKey: `${dateKey}::OD`,
      symbol: `OD${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      agreement: 0.18,
      recovery: -0.5,
      purityGap: -0.6,
      localRecovery: -0.5,
      leakShare: 0.82,
      boundaryRecovery: -0.2,
    }),
  )
}

const supportCases = [{
  caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  symbol: "076610",
  dateKey: "2026-03-18",
  tokens: [laneToken, lowToken],
  donorTokens: [laneToken, lowToken],
  numericFeatureMap: {
    "sig.ordinalMotif.motifAgreement": 0.97,
    "sig.ordinalMotif.supportRecoveryPotential": 2.3,
    "sig.recurBoundary.localBreadthPurityGap": 2.2,
    "sig.recurBoundary.localRecoveryMargin": 1.9,
    "sig.recurBoundary.crossfitLeakShare": 0.01,
    "sig.boundary.supportRecoveryPotential": 1.8,
  },
}]

let family = buildPerfectPrototypeRecentMidLowWinnerQueryDataset({
  trainRows,
  oosRows,
  supportCases,
})
family = buildPerfectPrototypeSupportTemporalEpisodeDataset({ family, lookbackTradingDays: 4 })
family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
family = buildPerfectPrototypeRecentMidLowWinnerLabels({ family })
family = buildPerfectPrototypeSupportDateQueryDataset({ family })
family = buildPerfectPrototypeSupportMatchedControlPool({ family, controlPoolSize: 3 })
family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
family = buildPerfectPrototypeRecentMidLowWinnerQueryFeatures({ family })

assert.equal(family.ok, true)
assert.ok((family.summary?.winnerQueryFeatureCount ?? 0) > 0)

const solution = calibratePerfectPrototypeRecentMidLowWinnerQuery({
  family,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 2,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 3,
})

assert.equal(solution.ok, true)
assert.equal(solution.supportFitExcluded, true)
assert.equal(solution.supportLeaveOneOutRecovered, true)
assert.equal(solution.trainSummary.precision, 1)
assert.ok(solution.trainSummary.trainMatchedDateCount >= 10)
assert.ok(solution.trainSummary.trainMatchedMonthCount >= 6)
assert.ok(solution.trainSummary.trainMatchedFoldCount >= 4)
assert.equal(solution.trainSummary.crossfitNegativeWindowCount, 0)
assert.equal(solution.oosSummary.openOosPrecision, 1)
assert.ok(solution.oosSummary.openOosMatchCount >= 3)
assert.ok(solution.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID))

console.log("ok: recent_mid_low winner query")
