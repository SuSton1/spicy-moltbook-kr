#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import {
  buildPerfectPrototypeSupportBridgeFrontierState,
  buildPerfectPrototypeSupportBridgeSelectedStats,
  scorePerfectPrototypeSupportBridgeFrontierCandidate,
} from "../src/lib/perfect_prototype_support_bridge_frontier_metric.mjs"

const makeRow = ({
  sourceId,
  dateKey,
  foldId,
  windowId,
  outcomeHitTarget = true,
  posDistance,
  margin,
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol: sourceId.toUpperCase(),
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget,
  numericFeatureMap: {
    "sig.support.posDistance": posDistance,
    "sig.support.margin": margin,
  },
})

const selectedRows = [
  makeRow({ sourceId: "p1", dateKey: "2026-01-03", foldId: 1, windowId: 1, posDistance: 0.12, margin: 1.2 }),
  makeRow({ sourceId: "p2", dateKey: "2026-02-03", foldId: 2, windowId: 2, posDistance: 0.14, margin: 1.16 }),
  makeRow({ sourceId: "p3", dateKey: "2026-03-03", foldId: 3, windowId: 3, posDistance: 0.16, margin: 1.12 }),
  makeRow({ sourceId: "p4", dateKey: "2026-04-03", foldId: 4, windowId: 4, posDistance: 0.18, margin: 1.08 }),
]
const candidate = makeRow({
  sourceId: "p5",
  dateKey: "2026-05-03",
  foldId: 1,
  windowId: 5,
  posDistance: 0.17,
  margin: 1.04,
})
const negatives = [
  makeRow({ sourceId: "n1", dateKey: "2026-01-07", foldId: 1, windowId: 1, outcomeHitTarget: false, posDistance: 0.42, margin: 0.1 }),
  makeRow({ sourceId: "n2", dateKey: "2026-02-07", foldId: 2, windowId: 2, outcomeHitTarget: false, posDistance: 0.44, margin: 0.08 }),
  makeRow({ sourceId: "n3", dateKey: "2026-03-07", foldId: 3, windowId: 3, outcomeHitTarget: false, posDistance: 0.46, margin: 0.06 }),
  makeRow({ sourceId: "n4", dateKey: "2026-04-07", foldId: 4, windowId: 4, outcomeHitTarget: false, posDistance: 0.48, margin: 0.04 }),
]
const supportCaseViews = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    numericFeatureMap: {
      "sig.support.posDistance": 0.15,
      "sig.support.margin": 1.18,
    },
  },
]

const state = buildPerfectPrototypeSupportBridgeFrontierState({
  selectedRows,
  negativeRows: negatives,
  supportCaseViews,
  featureKeys: ["sig.support.posDistance", "sig.support.margin"],
  featureScales: {
    "sig.support.posDistance": 0.2,
    "sig.support.margin": 0.4,
  },
})

assert.ok(Number(state?.supportRecoveredCount ?? 0) >= 1)

const diagnostics = scorePerfectPrototypeSupportBridgeFrontierCandidate({
  row: candidate,
  selectedStats: buildPerfectPrototypeSupportBridgeSelectedStats(selectedRows),
  state,
  selectedRows,
  featureKeys: ["sig.support.posDistance", "sig.support.margin"],
  featureScales: {
    "sig.support.posDistance": 0.2,
    "sig.support.margin": 0.4,
  },
})

assert.ok(Number(diagnostics?.marginalBreadthGain ?? 0) > 0)
assert.ok(Number(diagnostics?.negativeLeakCost ?? 999) < 1)

console.log("ok: support bridge frontier")
