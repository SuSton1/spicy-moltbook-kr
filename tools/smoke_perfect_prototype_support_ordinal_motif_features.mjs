#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeSupportOrdinalMotifFeatures } from "../src/lib/perfect_prototype_support_ordinal_motif_features.mjs"

const makeRow = ({ rowKey, groupA, groupB, recovery, leak, dateKey, foldId } = {}) => ({
  rowKey,
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  foldId,
  numericFeatureMap: {
    "sig.boundary.group.candle.residualMargin": groupA,
    "sig.boundary.group.volume.residualMargin": groupB,
    "sig.boundary.supportRecoveryPotential": recovery,
    "sig.recurBoundary.localBreadthPurityGap": recovery,
    "sig.recurBoundary.localRecoveryMargin": recovery * 0.8,
    "sig.recurBoundary.crossfitRecoveryShare": 0.8,
    "sig.recurBoundary.crossfitLeakShare": leak,
    "sig.boundary.falsePositivePressure": leak,
  },
  categoricalTokens: [],
  tokenSet: new Set(),
})

const positives = [
  makeRow({ rowKey: "p1", groupA: 1.2, groupB: 0.4, recovery: 1.1, leak: 0.05, dateKey: "2026-01-03", foldId: 1 }),
  makeRow({ rowKey: "p2", groupA: 1.1, groupB: 0.5, recovery: 1.0, leak: 0.05, dateKey: "2026-02-03", foldId: 2 }),
  makeRow({ rowKey: "p3", groupA: 1.0, groupB: 0.45, recovery: 0.9, leak: 0.06, dateKey: "2026-03-03", foldId: 3 }),
]
const negatives = [
  makeRow({ rowKey: "n1", groupA: -0.4, groupB: 0.8, recovery: -0.3, leak: 0.6, dateKey: "2026-01-12", foldId: 1 }),
  makeRow({ rowKey: "n2", groupA: -0.35, groupB: 0.75, recovery: -0.25, leak: 0.6, dateKey: "2026-02-12", foldId: 2 }),
  makeRow({ rowKey: "n3", groupA: -0.3, groupB: 0.7, recovery: -0.2, leak: 0.55, dateKey: "2026-03-12", foldId: 3 }),
]

const family = buildPerfectPrototypeSupportOrdinalMotifFeatures({
  cohort: {
    ok: true,
    trainRows: [...positives, ...negatives],
    gatedTrainRows: [...positives, ...negatives],
    oosRows: [],
    supportCaseViews: [makeRow({ rowKey: "s1", groupA: 1.05, groupB: 0.42, recovery: 1.0, leak: 0.05, dateKey: "2026-03-18", foldId: 0 })],
    bridgePositiveRows: positives,
    supportNearHardNegativeRows: negatives,
    boundaryResidualGroupStats: [
      { group: "candle", recurrenceShare: 0.9, falsePositiveShare: 0.1, separation: 1.0 },
      { group: "volume", recurrenceShare: 0.6, falsePositiveShare: 0.4, separation: 0.6 },
    ],
    summary: {},
  },
})

assert.equal(family.ok, true)
assert.ok(Number(family.summary.ordinalMotifFeatureCount ?? 0) > 0)
assert.equal(family.gatedTrainRows[0].ordinalMotifDominantGroup, "candle")
assert.ok(
  Number(family.supportCaseViews[0]?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"] ?? 0) > 0,
)

console.log("ok: support ordinal motif features")
