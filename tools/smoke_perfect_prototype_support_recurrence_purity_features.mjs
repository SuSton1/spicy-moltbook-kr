#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualFamily } from "../src/lib/perfect_prototype_support_boundary_residual_features.mjs"
import { buildPerfectPrototypeSupportRecurrencePurityFamily } from "../src/lib/perfect_prototype_support_recurrence_purity_features.mjs"

const makeRow = ({
  sourceId,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  posDistance,
  margin,
  compatibility,
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  tokenSet: new Set(["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]),
  categoricalTokens: ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"],
  numericFeatureMap: {
    "sig.support.posDistance": posDistance,
    "sig.support.maxDistance": posDistance + 0.08,
    "sig.support.margin": margin,
    "sig.support.densityRatio": 2.2 + margin,
    "sig.support.prototypeAgreement": 0.82,
    "sig.support.featureCoverage": 0.84,
    "sig.support.nearShare": 0.86,
    "sig.supportMetric.score": compatibility,
    "sig.supportMetric.coverageAdjustedMargin": margin * 0.85,
    "sig.supportMetric.agreementDistanceRatio": 3.1 - posDistance,
    "sig.supportMetric.densityMarginGap": 2.1 + margin,
    "sig.supportMetric.prototypeCloseness": 1 / (1 + posDistance),
    "sig.supportMetric.supportCompatibility": compatibility,
  },
})

const trainPositives = [
  makeRow({ sourceId: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, posDistance: 0.10, margin: 1.30, compatibility: 4.3 }),
  makeRow({ sourceId: "p2", symbol: "A2", dateKey: "2026-01-12", outcomeHitTarget: true, foldId: 1, windowId: 1, posDistance: 0.11, margin: 1.28, compatibility: 4.2 }),
  makeRow({ sourceId: "p3", symbol: "A3", dateKey: "2026-02-06", outcomeHitTarget: true, foldId: 2, windowId: 2, posDistance: 0.14, margin: 1.24, compatibility: 4.0 }),
  makeRow({ sourceId: "p4", symbol: "A4", dateKey: "2026-02-17", outcomeHitTarget: true, foldId: 2, windowId: 2, posDistance: 0.15, margin: 1.20, compatibility: 3.9 }),
  makeRow({ sourceId: "p5", symbol: "A5", dateKey: "2026-03-05", outcomeHitTarget: true, foldId: 3, windowId: 3, posDistance: 0.17, margin: 1.18, compatibility: 3.8 }),
  makeRow({ sourceId: "p6", symbol: "A6", dateKey: "2026-03-18", outcomeHitTarget: true, foldId: 3, windowId: 3, posDistance: 0.18, margin: 1.16, compatibility: 3.7 }),
  makeRow({ sourceId: "p7", symbol: "A7", dateKey: "2026-04-04", outcomeHitTarget: true, foldId: 4, windowId: 4, posDistance: 0.20, margin: 1.12, compatibility: 3.6 }),
  makeRow({ sourceId: "p8", symbol: "A8", dateKey: "2026-04-16", outcomeHitTarget: true, foldId: 4, windowId: 4, posDistance: 0.22, margin: 1.08, compatibility: 3.5 }),
]

const trainNegatives = [
  makeRow({ sourceId: "n1", symbol: "N1", dateKey: "2026-01-05", outcomeHitTarget: false, foldId: 1, windowId: 1, posDistance: 0.34, margin: 0.16, compatibility: 1.9 }),
  makeRow({ sourceId: "n2", symbol: "N2", dateKey: "2026-01-16", outcomeHitTarget: false, foldId: 1, windowId: 1, posDistance: 0.36, margin: 0.12, compatibility: 1.8 }),
  makeRow({ sourceId: "n3", symbol: "N3", dateKey: "2026-02-09", outcomeHitTarget: false, foldId: 2, windowId: 2, posDistance: 0.38, margin: 0.10, compatibility: 1.7 }),
  makeRow({ sourceId: "n4", symbol: "N4", dateKey: "2026-02-20", outcomeHitTarget: false, foldId: 2, windowId: 2, posDistance: 0.39, margin: 0.08, compatibility: 1.6 }),
  makeRow({ sourceId: "n5", symbol: "N5", dateKey: "2026-03-08", outcomeHitTarget: false, foldId: 3, windowId: 3, posDistance: 0.41, margin: 0.05, compatibility: 1.5 }),
  makeRow({ sourceId: "n6", symbol: "N6", dateKey: "2026-03-20", outcomeHitTarget: false, foldId: 3, windowId: 3, posDistance: 0.42, margin: 0.04, compatibility: 1.4 }),
  makeRow({ sourceId: "n7", symbol: "N7", dateKey: "2026-04-06", outcomeHitTarget: false, foldId: 4, windowId: 4, posDistance: 0.44, margin: 0.03, compatibility: 1.3 }),
  makeRow({ sourceId: "n8", symbol: "N8", dateKey: "2026-04-18", outcomeHitTarget: false, foldId: 4, windowId: 4, posDistance: 0.45, margin: 0.02, compatibility: 1.2 }),
]

const cohort = {
  familyId: "low_gap_top_continuation",
  surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
  gateTokens: ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"],
  supportCaseViews: [
    {
      caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
      symbol: "076610",
      dateKey: "2026-03-18",
      monthKey: "2026-03",
      tokenSet: new Set(["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"]),
      categoricalTokens: ["tag:lowGapTop.gapContinuationRegime:GAP_FADE", "tag:xsec.gapRank:HIGH"],
      numericFeatureMap: {
        "sig.support.posDistance": 0.13,
        "sig.support.maxDistance": 0.21,
        "sig.support.margin": 1.25,
        "sig.support.densityRatio": 3.1,
        "sig.support.prototypeAgreement": 0.84,
        "sig.support.featureCoverage": 0.84,
        "sig.support.nearShare": 0.88,
        "sig.supportMetric.score": 4.1,
        "sig.supportMetric.coverageAdjustedMargin": 1.06,
        "sig.supportMetric.agreementDistanceRatio": 3.6,
        "sig.supportMetric.densityMarginGap": 3.2,
        "sig.supportMetric.prototypeCloseness": 0.88,
        "sig.supportMetric.supportCompatibility": 4.35,
      },
    },
  ],
  trainRows: [...trainPositives, ...trainNegatives],
  gatedTrainRows: [...trainPositives, ...trainNegatives],
  supportPositiveRows: trainPositives,
  hardNegativeRows: trainNegatives,
  backgroundRows: [],
  oosRows: [],
}

const bridge = buildPerfectPrototypeSupportContrastiveBridgeFamily({
  cohort,
  minBridgePositiveDates: 4,
  minBridgePositiveMonths: 4,
  minBridgePositiveFolds: 4,
  minBridgePositiveRows: 4,
  maxBridgePositiveRows: 16,
  minSupportNearHardNegativeRows: 4,
  maxSupportNearHardNegativeRows: 16,
  localBridgeCellCount: 2,
  excludeSupportCaseFromFit: true,
})
const boundary = buildPerfectPrototypeSupportBoundaryResidualFamily({ cohort: bridge })
const family = buildPerfectPrototypeSupportRecurrencePurityFamily({ cohort: boundary })

assert.equal(bridge.ok, true)
assert.equal(boundary.ok, true)
assert.equal(family.ok, true)
assert.ok(Number(family.summary?.recurrencePurityFeatureCount ?? 0) > 0)
assert.ok(Number(family.summary?.recurrencePurityGroupCount ?? 0) >= 2)
assert.ok(Array.isArray(family.summary?.supportCaseDominantGroups))
assert.ok((family.supportCaseViews?.[0]?.recurBoundaryDominantGroup ?? null) !== null)

console.log("ok: support recurrence purity features")
