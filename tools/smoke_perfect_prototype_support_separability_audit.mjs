#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { buildPerfectPrototypeSupportFeatureSupplierUnion } from "../src/lib/perfect_prototype_support_feature_supplier_union.mjs"
import { buildPerfectPrototypeSupportSeparabilityDataset } from "../src/lib/perfect_prototype_support_separability_dataset.mjs"
import { auditPerfectPrototypeSupportSeparabilityPairwise } from "../src/lib/perfect_prototype_support_separability_pairwise_audit.mjs"
import { auditPerfectPrototypeSupportSeparabilityQueries } from "../src/lib/perfect_prototype_support_separability_query_audit.mjs"
import { derivePerfectPrototypeSupportSeparabilityFamilyContract } from "../src/lib/perfect_prototype_support_separability_family_derive.mjs"
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

const trainRows = []
for (const [dateKey, foldId, windowId] of positiveDates) {
  trainRows.push(
    makeRow({
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
    }),
    makeRow({
      rowKey: `${dateKey}::D`,
      symbol: `D${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      agreement: 0.12,
      recovery: -0.3,
      purityGap: -0.6,
      localRecovery: -0.6,
      leakShare: 0.91,
      boundaryRecovery: -0.2,
    }),
  )
}
for (const [dateKey, foldId, windowId] of negativeDates) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::N1`,
      symbol: `N${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      agreement: 0.08,
      recovery: -0.8,
      purityGap: -1.0,
      localRecovery: -0.8,
      leakShare: 0.95,
      boundaryRecovery: -0.4,
    }),
    makeRow({
      rowKey: `${dateKey}::N2`,
      symbol: `M${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      agreement: 0.1,
      recovery: -0.7,
      purityGap: -0.9,
      localRecovery: -0.7,
      leakShare: 0.9,
      boundaryRecovery: -0.3,
    }),
  )
}

const oosRows = [
  makeRow({
    rowKey: "2025-02-03::OP",
    symbol: "OP03",
    dateKey: "2025-02-03",
    foldId: 1,
    windowId: 1,
    hit: true,
    agreement: 0.95,
    recovery: 2.2,
    purityGap: 2.0,
    localRecovery: 1.8,
    leakShare: 0.02,
    boundaryRecovery: 1.7,
  }),
  makeRow({
    rowKey: "2025-02-03::OD",
    symbol: "OD03",
    dateKey: "2025-02-03",
    foldId: 1,
    windowId: 1,
    hit: false,
    agreement: 0.11,
    recovery: -0.2,
    purityGap: -0.5,
    localRecovery: -0.4,
    leakShare: 0.89,
    boundaryRecovery: -0.1,
  }),
]

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
    agreement: 0.1,
    recovery: -0.4,
    purityGap: -0.6,
    localRecovery: -0.7,
    leakShare: 0.92,
    boundaryRecovery: -0.2,
  }),
]

let family = {
  ok: true,
  familyId: "low_gap_top_continuation",
  gateTokens: [gateToken],
  supportFitExcluded: true,
  trainRows,
  gatedTrainRows: trainRows,
  oosRows,
  supportCaseViews,
  bridgePositiveRows: trainRows.filter((row) => row.outcomeHitTarget === true),
  supportNearHardNegativeRows: trainRows.filter(
    (row) => row.outcomeHitTarget !== true && row.numericFeatureMap["sig.recurBoundary.crossfitLeakShare"] > 0.85,
  ),
  summary: {},
}

family = buildPerfectPrototypeSupportTemporalEpisodeDataset({ family, lookbackTradingDays: 4 })
family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
family = buildPerfectPrototypeSupportDateQueryDataset({ family })
family = buildPerfectPrototypeSupportMatchedControlPool({ family, controlPoolSize: 3 })
family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })

const dataset = buildPerfectPrototypeSupportSeparabilityDataset({ family })
const pairwise = auditPerfectPrototypeSupportSeparabilityPairwise({
  family,
  dataset,
  minHeldoutPairwiseWinRate: 0.75,
  minFoldPairwiseWinRate: 0.6,
  minRunnerUpBeatRate: 0.75,
  minPositiveSignatureCount: 1,
})
const query = auditPerfectPrototypeSupportSeparabilityQueries({
  family,
  pairwiseAudit: pairwise,
  minTrainMatchedDates: 8,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
})
const contract = derivePerfectPrototypeSupportSeparabilityFamilyContract({
  family,
  pairwiseAudit: pairwise,
  queryAudit: query,
})

assert.equal(dataset.ok, true)
assert.ok((family.summary?.supplierUnionFeatureCount ?? 0) > 0)
assert.ok((pairwise.selectedFeaturePoolCount ?? 0) >= 2)
assert.equal(query.ok, true)
assert.equal(contract.ok, true)

console.log("ok: support separability audit")

