#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"
import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"

const gateToken = "tag:lowGapTop.gapContinuationRegime:GAP_FADE"

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  foldId,
  windowId,
  hit,
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
  caseId,
  numericFeatureMap: {
    "sig.ordinalMotif.motifAgreement": agreement,
    "sig.ordinalMotif.supportRecoveryPotential": recovery,
    "sig.recurBoundary.localBreadthPurityGap": purityGap,
    "sig.recurBoundary.localRecoveryMargin": localRecovery,
    "sig.recurBoundary.crossfitLeakShare": leakShare,
    "sig.boundary.supportRecoveryPotential": boundaryRecovery,
  },
  categoricalTokens: [gateToken],
  tokenSet: new Set([gateToken]),
})

const positiveDates = [
  ["2021-01-11", 1, 1], ["2021-02-12", 1, 1], ["2021-03-15", 2, 2], ["2021-04-12", 2, 2],
  ["2021-05-17", 3, 3], ["2021-06-14", 3, 3], ["2021-07-12", 4, 4], ["2021-08-16", 4, 4],
  ["2021-09-13", 1, 5], ["2021-10-18", 2, 5],
]
const negativeDates = [
  ["2021-01-25", 1, 1], ["2021-03-29", 2, 2], ["2021-06-28", 3, 3], ["2021-08-30", 4, 4],
]
const oosDates = [
  ["2025-02-03", 1, 1], ["2025-04-14", 2, 2], ["2025-07-21", 3, 3],
]

const gatedTrainRows = []
const trainRows = []
for (const [dateKey, foldId, windowId] of positiveDates) {
  const posRow = makeRow({
    rowKey: `${dateKey}::P`,
    symbol: `P${dateKey.slice(-2)}`,
    dateKey,
    foldId,
    windowId,
    hit: true,
    agreement: 0.95,
    recovery: 2.2,
    purityGap: 2.1,
    localRecovery: 1.8,
    leakShare: 0.02,
    boundaryRecovery: 1.7,
  })
  const decoy = makeRow({
    rowKey: `${dateKey}::D`,
    symbol: `D${dateKey.slice(-2)}`,
    dateKey,
    foldId,
    windowId,
    hit: false,
    agreement: 0.2,
    recovery: -0.3,
    purityGap: -0.4,
    localRecovery: -0.5,
    leakShare: 0.8,
    boundaryRecovery: -0.2,
  })
  gatedTrainRows.push(posRow, decoy)
  trainRows.push(posRow, decoy)
}
for (const [dateKey, foldId, windowId] of negativeDates) {
  const negRow = makeRow({
    rowKey: `${dateKey}::N`,
    symbol: `N${dateKey.slice(-2)}`,
    dateKey,
    foldId,
    windowId,
    hit: false,
    agreement: 0.1,
    recovery: -0.8,
    purityGap: -1.0,
    localRecovery: -0.9,
    leakShare: 0.95,
    boundaryRecovery: -0.4,
  })
  const peer = makeRow({
    rowKey: `${dateKey}::X`,
    symbol: `X${dateKey.slice(-2)}`,
    dateKey,
    foldId,
    windowId,
    hit: false,
    agreement: 0.05,
    recovery: -0.4,
    purityGap: -0.8,
    localRecovery: -0.7,
    leakShare: 0.88,
    boundaryRecovery: -0.1,
  })
  gatedTrainRows.push(negRow, peer)
  trainRows.push(negRow, peer)
}

const oosRows = []
for (const [dateKey, foldId, windowId] of oosDates) {
  oosRows.push(
    makeRow({
      rowKey: `${dateKey}::OP`,
      symbol: `OP${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      agreement: 0.96,
      recovery: 2.1,
      purityGap: 2.0,
      localRecovery: 1.7,
      leakShare: 0.01,
      boundaryRecovery: 1.6,
    }),
    makeRow({
      rowKey: `${dateKey}::OD`,
      symbol: `OD${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      agreement: 0.15,
      recovery: -0.4,
      purityGap: -0.5,
      localRecovery: -0.5,
      leakShare: 0.84,
      boundaryRecovery: -0.2,
    }),
  )
}

const supportCaseViews = [
  makeRow({
    rowKey: `${PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID}::S`,
    symbol: "076610",
    dateKey: "2026-03-18",
    foldId: 0,
    windowId: 0,
    hit: true,
    agreement: 0.97,
    recovery: 2.3,
    purityGap: 2.2,
    localRecovery: 1.9,
    leakShare: 0.01,
    boundaryRecovery: 1.8,
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  }),
  makeRow({
    rowKey: `${PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID}::D`,
    symbol: "000000",
    dateKey: "2026-03-18",
    foldId: 0,
    windowId: 0,
    hit: false,
    agreement: 0.12,
    recovery: -0.4,
    purityGap: -0.6,
    localRecovery: -0.6,
    leakShare: 0.9,
    boundaryRecovery: -0.2,
  }),
]

const bridgePositiveRows = gatedTrainRows.filter((row) => row.outcomeHitTarget === true)
const supportNearHardNegativeRows = gatedTrainRows.filter(
  (row) => row.outcomeHitTarget !== true && row.numericFeatureMap["sig.recurBoundary.crossfitLeakShare"] > 0.8,
)

let family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  gateTokens: [gateToken],
  supportFitExcluded: true,
  trainRows,
  gatedTrainRows,
  oosRows,
  supportCaseViews,
  bridgePositiveRows,
  supportNearHardNegativeRows,
  summary: {},
}

family = buildPerfectPrototypeSupportTemporalEpisodeDataset({ family, lookbackTradingDays: 4 })
family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
family = buildPerfectPrototypeSupportDateQueryDataset({ family })
family = buildPerfectPrototypeSupportMatchedControlPool({ family, controlPoolSize: 3 })
family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })

assert.equal(family.ok, true)
assert.ok((family.summary?.counterfactualOutrankingFeatureCount ?? 0) > 0)

const solution = calibratePerfectPrototypeSupportTop1QueryRanker({
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

console.log("ok: support top1 query")
