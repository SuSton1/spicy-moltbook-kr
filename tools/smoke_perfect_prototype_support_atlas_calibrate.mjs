#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { calibratePerfectPrototypeSupportAtlas } from "../src/lib/perfect_prototype_support_atlas_calibrate.mjs"

const makeRow = ({
  sourceId,
  symbol,
  dateKey,
  outcomeHitTarget,
  foldId,
  windowId,
  posDistance,
  margin,
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  outcomeHitTarget,
  foldId,
  windowId,
  tokenSet: new Set(["tag:lowGapTop.gapContinuationRegime:GAP_FADE"]),
  numericFeatureMap: {
    "sig.support.posDistance": posDistance,
    "sig.support.margin": margin,
  },
})

const positives = [
  makeRow({ sourceId: "p1", symbol: "A1", dateKey: "2026-01-03", outcomeHitTarget: true, foldId: 1, windowId: 1, posDistance: 0.12, margin: 1.28 }),
  makeRow({ sourceId: "p2", symbol: "A2", dateKey: "2026-02-03", outcomeHitTarget: true, foldId: 2, windowId: 2, posDistance: 0.14, margin: 1.22 }),
  makeRow({ sourceId: "p3", symbol: "A3", dateKey: "2026-03-03", outcomeHitTarget: true, foldId: 3, windowId: 3, posDistance: 0.17, margin: 1.18 }),
  makeRow({ sourceId: "p4", symbol: "A4", dateKey: "2026-04-03", outcomeHitTarget: true, foldId: 4, windowId: 4, posDistance: 0.19, margin: 1.12 }),
]

const negatives = [
  makeRow({ sourceId: "n1", symbol: "N1", dateKey: "2026-01-10", outcomeHitTarget: false, foldId: 1, windowId: 1, posDistance: 0.42, margin: 0.18 }),
  makeRow({ sourceId: "n2", symbol: "N2", dateKey: "2026-02-10", outcomeHitTarget: false, foldId: 2, windowId: 2, posDistance: 0.45, margin: 0.12 }),
  makeRow({ sourceId: "n3", symbol: "N3", dateKey: "2026-03-10", outcomeHitTarget: false, foldId: 3, windowId: 3, posDistance: 0.48, margin: 0.1 }),
  makeRow({ sourceId: "n4", symbol: "N4", dateKey: "2026-04-10", outcomeHitTarget: false, foldId: 4, windowId: 4, posDistance: 0.5, margin: 0.08 }),
]

const supportCaseViews = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    tokenSet: new Set(["tag:lowGapTop.gapContinuationRegime:GAP_FADE"]),
    numericFeatureMap: {
      "sig.support.posDistance": 0.15,
      "sig.support.margin": 1.24,
    },
  },
]

const dataset = {
  familyId: "low_gap_top_continuation",
  surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
  gateTokens: ["tag:lowGapTop.gapContinuationRegime:GAP_FADE"],
  supportCaseViews,
  supportFitViews: [],
  supportFitExcluded: true,
  featureKeys: ["sig.support.posDistance", "sig.support.margin"],
  featureScales: {
    "sig.support.posDistance": 0.25,
    "sig.support.margin": 0.5,
  },
  calibrationRows: [...positives, ...negatives],
  calibrationPositiveRows: positives,
  calibrationNegativeRows: negatives,
  summary: {
    supportLeaveOneOutRecovered: true,
  },
}

const candidateSpace = {
  cellCandidates: [
    {
      cellId: "ATLAS_CELL_01",
      positiveRows: positives,
      positiveSummary: {
        rowCount: 4,
        matchedDateCount: 4,
        matchedMonthCount: 4,
        matchedFoldCount: 4,
      },
      negativePool: negatives,
      negativeSummary: {
        rowCount: 4,
        matchedDateCount: 4,
        matchedMonthCount: 4,
        matchedFoldCount: 4,
      },
      positivePrototype: {
        "sig.support.posDistance": 0.155,
        "sig.support.margin": 1.2,
      },
      negativePrototype: {
        "sig.support.posDistance": 0.4625,
        "sig.support.margin": 0.12,
      },
      featureWeights: {
        "sig.support.posDistance": 1,
        "sig.support.margin": 1.5,
      },
      positiveAnchors: positives.slice(0, 3),
      negativeBorderAnchors: negatives.slice(0, 2),
      kPositive: 2,
      minPositiveVotes: 1,
      anchorCoverageSummary: {
        matchedDateCount: 4,
        matchedMonthCount: 4,
        matchedFoldCount: 4,
      },
      supportCaseEvaluations: [],
      supportCaseMarginMean: 0.8,
      supportCasePosDistanceMean: 0.12,
      cellScore: 120,
    },
  ],
  summary: {
    atlasCellCandidateCount: 1,
    atlasQualifiedCellCount: 1,
    atlasPositiveSupportMarginCellCount: 1,
    atlasAnchorSetCount: 3,
    atlasAnchorCoverageDateCount: 4,
    atlasAnchorCoverageMonthCount: 4,
    atlasAnchorCoverageFoldCount: 4,
    atlasBestTrainBreadthBeforeThreshold: {
      matchedDateCount: 4,
      matchedMonthCount: 4,
      matchedFoldCount: 4,
    },
    supportFitExcluded: true,
    supportLeaveOneOutRecovered: true,
  },
}

const solution = calibratePerfectPrototypeSupportAtlas({
  dataset,
  candidateSpace,
  maxActiveCells: 1,
  minTrainMatchedDates: 4,
  minTrainMatchedMonths: 4,
  minTrainMatchedFolds: 4,
  minCrossfitPositiveWindows: 1,
  maxCrossfitNegativeWindows: 0,
})

assert.equal(solution.ok, false)
assert.equal(String(solution.reason ?? ""), "unsat_historical_support")
assert.ok(Number(solution.preThresholdFrontierPointCount ?? 0) > 0)
assert.ok(Array.isArray(solution.preThresholdFrontier) && solution.preThresholdFrontier.length > 0)
assert.equal(solution.supportFitExcluded, true)

console.log("ok: support atlas calibrate")
