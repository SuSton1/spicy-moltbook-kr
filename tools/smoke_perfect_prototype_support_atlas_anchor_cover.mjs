#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeSupportAtlasAnchorCover } from "../src/lib/perfect_prototype_support_atlas_anchor_cover.mjs"
import { scorePerfectPrototypeSupportAtlasCell } from "../src/lib/perfect_prototype_support_atlas_metric.mjs"

const makeRow = ({
  sourceId,
  dateKey,
  foldId,
  f1,
  f2,
} = {}) => ({
  rowKey: sourceId,
  sourceId,
  symbol: sourceId.toUpperCase(),
  dateKey,
  monthKey: String(dateKey).slice(0, 7),
  foldId,
  numericFeatureMap: {
    "sig.support.posDistance": f1,
    "sig.support.margin": f2,
    "sig.bridge.bestPositiveCellMargin": f2 - f1,
  },
})

const positives = [
  makeRow({ sourceId: "p1", dateKey: "2026-01-03", foldId: 1, f1: 0.12, f2: 1.2 }),
  makeRow({ sourceId: "p2", dateKey: "2026-02-03", foldId: 2, f1: 0.14, f2: 1.18 }),
  makeRow({ sourceId: "p3", dateKey: "2026-03-03", foldId: 3, f1: 0.16, f2: 1.15 }),
  makeRow({ sourceId: "p4", dateKey: "2026-04-03", foldId: 4, f1: 0.18, f2: 1.12 }),
  makeRow({ sourceId: "p5", dateKey: "2026-05-03", foldId: 1, f1: 0.15, f2: 1.1 }),
  makeRow({ sourceId: "p6", dateKey: "2026-06-03", foldId: 2, f1: 0.17, f2: 1.08 }),
]

const negatives = [
  makeRow({ sourceId: "n1", dateKey: "2026-01-10", foldId: 1, f1: 0.4, f2: 0.2 }),
  makeRow({ sourceId: "n2", dateKey: "2026-02-10", foldId: 2, f1: 0.42, f2: 0.18 }),
  makeRow({ sourceId: "n3", dateKey: "2026-03-10", foldId: 3, f1: 0.45, f2: 0.15 }),
  makeRow({ sourceId: "n4", dateKey: "2026-04-10", foldId: 4, f1: 0.48, f2: 0.12 }),
]

const cell = buildPerfectPrototypeSupportAtlasAnchorCover({
  cellId: "ATLAS_CELL_01",
  positiveRows: positives,
  negativeRows: negatives,
  featureKeys: ["sig.support.posDistance", "sig.support.margin", "sig.bridge.bestPositiveCellMargin"],
  featureScales: {
    "sig.support.posDistance": 0.2,
    "sig.support.margin": 0.4,
    "sig.bridge.bestPositiveCellMargin": 0.4,
  },
})

const evaluation = scorePerfectPrototypeSupportAtlasCell({
  row: positives[0],
  cell,
  dataset: {
    featureKeys: ["sig.support.posDistance", "sig.support.margin", "sig.bridge.bestPositiveCellMargin"],
    featureScales: {
      "sig.support.posDistance": 0.2,
      "sig.support.margin": 0.4,
      "sig.bridge.bestPositiveCellMargin": 0.4,
    },
  },
})

assert.ok((cell.positiveAnchors ?? []).length >= 2)
assert.ok((cell.negativeBorderAnchors ?? []).length >= 1)
assert.ok(Number(cell.anchorCoverageSummary?.matchedFoldCount ?? 0) >= 4)
assert.ok(Number(evaluation?.margin ?? Number.NEGATIVE_INFINITY) > 0)
assert.ok(Array.isArray(evaluation?.positiveDistances))

console.log("ok: support atlas anchor cover")
