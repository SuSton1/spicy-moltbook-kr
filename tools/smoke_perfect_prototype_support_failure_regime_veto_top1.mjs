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
import { buildPerfectPrototypeSupportFailureRegimeCorpus } from "../src/lib/perfect_prototype_support_failure_regime_corpus.mjs"
import { buildPerfectPrototypeSupportNegativeRegimeCluster } from "../src/lib/perfect_prototype_support_negative_regime_cluster.mjs"
import { buildPerfectPrototypeSupportNegativeRegimeVetoFeatures } from "../src/lib/perfect_prototype_support_negative_regime_veto_features.mjs"
import { calibratePerfectPrototypeSupportNegativeRegimeVeto } from "../src/lib/perfect_prototype_support_negative_regime_veto_calibrate.mjs"
import { buildPerfectPrototypeSupportVetoSurvivorQueryDataset } from "../src/lib/perfect_prototype_support_veto_survivor_query_dataset.mjs"
import { calibratePerfectPrototypeSupportVetoSurvivorTop1Ranker } from "../src/lib/perfect_prototype_support_veto_survivor_top1_ranker.mjs"
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
  positiveCarry,
  negativePressure,
  purityLift,
  breadthCarry,
  negativeRolePressure,
  roleCohesion,
  residualRank,
  residualRisk,
  nearestGap,
  consensusWinShare,
  peerPressure,
  gapToTop,
  carryNet,
  riskMargin,
  winnerResidual,
}) => ({
  rowKey,
  symbol,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget: hit === true,
  numericFeatureMap: {
    "sig.temporalEpisode.episodePositiveCarry": positiveCarry,
    "sig.temporalEpisode.episodeNegativePressure": negativePressure,
    "sig.temporalEpisode.currentPositiveShare": positiveCarry,
    "sig.roleTopo.rolePurityLift": purityLift,
    "sig.roleTopo.roleBreadthCarry": breadthCarry,
    "sig.roleTopo.negativeRolePressure": negativeRolePressure,
    "sig.roleTopo.roleCohesion": roleCohesion,
    "sig.roleTopo.complementPocketAffinity": purityLift,
    "sig.ctrlResidual.regimeResidualRank": residualRank,
    "sig.ctrlResidual.regimeResidualRisk": residualRisk,
    "sig.ctrlResidual.nearestNegativeGap": nearestGap,
    "sig.outRank.consensusWinShare": consensusWinShare,
    "sig.outRank.negativePeerPressure": peerPressure,
    "sig.slateArchetype.selection.gapToTop": gapToTop,
    "sig.slateArchetype.temporal.carryNet": carryNet,
    "sig.slateArchetype.border.riskMargin": riskMargin,
    "sig.slateArchetype.selection.winnerSupportResidual": winnerResidual,
  },
  categoricalTokens: [laneToken, closeRankToken],
  tokenSet: new Set([laneToken, closeRankToken]),
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
      positiveCarry: 2.1,
      negativePressure: 0.05,
      purityLift: 1.9,
      breadthCarry: 1.8,
      negativeRolePressure: 0.05,
      roleCohesion: 1.7,
      residualRank: 1.6,
      residualRisk: 0.01,
      nearestGap: 1.3,
      consensusWinShare: 0.95,
      peerPressure: 0.05,
      gapToTop: 0.02,
      carryNet: 2.0,
      riskMargin: 1.4,
      winnerResidual: 2.3,
    }),
    makeRow({
      rowKey: `${dateKey}::P2`,
      symbol: `Q${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      positiveCarry: 0.6,
      negativePressure: 1.1,
      purityLift: 0.4,
      breadthCarry: 0.3,
      negativeRolePressure: 1.0,
      roleCohesion: 0.2,
      residualRank: -0.2,
      residualRisk: 0.9,
      nearestGap: -0.4,
      consensusWinShare: 0.2,
      peerPressure: 1.0,
      gapToTop: 0.8,
      carryNet: -0.6,
      riskMargin: -0.7,
      winnerResidual: -0.5,
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
      positiveCarry: 0.1,
      negativePressure: 2.4,
      purityLift: 0.0,
      breadthCarry: 0.0,
      negativeRolePressure: 2.2,
      roleCohesion: 0.1,
      residualRank: -0.8,
      residualRisk: 1.9,
      nearestGap: -0.9,
      consensusWinShare: 0.05,
      peerPressure: 2.1,
      gapToTop: 1.4,
      carryNet: -1.8,
      riskMargin: -1.2,
      winnerResidual: -1.5,
    }),
    makeRow({
      rowKey: `${dateKey}::N2`,
      symbol: `M${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      positiveCarry: 0.2,
      negativePressure: 1.8,
      purityLift: 0.2,
      breadthCarry: 0.1,
      negativeRolePressure: 1.7,
      roleCohesion: 0.2,
      residualRank: -0.6,
      residualRisk: 1.5,
      nearestGap: -0.7,
      consensusWinShare: 0.08,
      peerPressure: 1.8,
      gapToTop: 1.1,
      carryNet: -1.2,
      riskMargin: -1.0,
      winnerResidual: -1.1,
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
      positiveCarry: 2.2,
      negativePressure: 0.04,
      purityLift: 2.0,
      breadthCarry: 1.9,
      negativeRolePressure: 0.03,
      roleCohesion: 1.8,
      residualRank: 1.7,
      residualRisk: 0.01,
      nearestGap: 1.4,
      consensusWinShare: 0.96,
      peerPressure: 0.04,
      gapToTop: 0.03,
      carryNet: 2.1,
      riskMargin: 1.5,
      winnerResidual: 2.4,
    }),
    makeRow({
      rowKey: `${dateKey}::OD`,
      symbol: `OD${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      closeRankToken,
      positiveCarry: 0.2,
      negativePressure: 1.7,
      purityLift: 0.2,
      breadthCarry: 0.1,
      negativeRolePressure: 1.6,
      roleCohesion: 0.1,
      residualRank: -0.4,
      residualRisk: 1.3,
      nearestGap: -0.6,
      consensusWinShare: 0.09,
      peerPressure: 1.7,
      gapToTop: 1.0,
      carryNet: -1.0,
      riskMargin: -0.8,
      winnerResidual: -1.0,
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
    "sig.temporalEpisode.episodePositiveCarry": 2.3,
    "sig.temporalEpisode.episodeNegativePressure": 0.03,
    "sig.temporalEpisode.currentPositiveShare": 2.3,
    "sig.roleTopo.rolePurityLift": 2.1,
    "sig.roleTopo.roleBreadthCarry": 1.9,
    "sig.roleTopo.negativeRolePressure": 0.03,
    "sig.roleTopo.roleCohesion": 1.9,
    "sig.roleTopo.complementPocketAffinity": 2.0,
    "sig.ctrlResidual.regimeResidualRank": 1.8,
    "sig.ctrlResidual.regimeResidualRisk": 0.01,
    "sig.ctrlResidual.nearestNegativeGap": 1.4,
    "sig.outRank.consensusWinShare": 0.97,
    "sig.outRank.negativePeerPressure": 0.03,
    "sig.slateArchetype.selection.gapToTop": 0.02,
    "sig.slateArchetype.temporal.carryNet": 2.2,
    "sig.slateArchetype.border.riskMargin": 1.5,
    "sig.slateArchetype.selection.winnerSupportResidual": 2.5,
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
family = buildPerfectPrototypeSupportFailureRegimeCorpus({ family })
family = buildPerfectPrototypeSupportNegativeRegimeCluster({ family })
family = buildPerfectPrototypeSupportNegativeRegimeVetoFeatures({ family })

assert.equal(family.ok, true)
assert.ok((family.summary?.negativeRegimeVetoFeatureCount ?? 0) > 0)

const veto = calibratePerfectPrototypeSupportNegativeRegimeVeto({
  family,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
})
assert.equal(veto.supportFitExcluded, true)
assert.ok(Number(veto.candidateCount ?? 0) > 0)
assert.ok(
  veto.ok === true ||
    [
      "unsat_veto_negative_leak",
      "unsat_veto_train_breadth",
      "unsat_veto_support_projection",
    ].includes(String(veto.reason ?? "")),
)
assert.ok(veto.bestCandidate != null)

if (veto.ok === true) {
  family = buildPerfectPrototypeSupportVetoSurvivorQueryDataset({
    family,
    vetoArtifact: veto.artifact,
  })
  assert.equal(family.ok, true)

  const solution = calibratePerfectPrototypeSupportVetoSurvivorTop1Ranker({
    family,
    minTrainMatchedDates: 10,
    minTrainMatchedMonths: 6,
    minTrainMatchedFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
  })
  assert.equal(solution.supportFitExcluded, true)
  assert.ok(solution.ok === true || String(solution.reason ?? "").startsWith("unsat_"))
}

console.log("ok: support failure regime veto top1")
