#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  buildPerfectPrototypeSupportAtlasBoundaryVetoOptions,
  buildPerfectPrototypeSupportAtlasPrethresholdCellOption,
} from "../src/lib/perfect_prototype_support_boundary_veto.mjs"

const cellCandidate = {
  cellId: "ATLAS_CELL_01",
  positiveRows: [
    {
      atlasMetricsByCell: {
        ATLAS_CELL_01: { positiveKDistance: 0.18, posDistance: 0.17, margin: 0.9, score: 0.7 },
      },
    },
    {
      atlasMetricsByCell: {
        ATLAS_CELL_01: { positiveKDistance: 0.22, posDistance: 0.2, margin: 0.84, score: 0.64 },
      },
    },
  ],
}

const dataset = {
  supportCaseViews: [
    {
      atlasMetricsByCell: {
        ATLAS_CELL_01: { positiveKDistance: 0.2, posDistance: 0.18, margin: 0.88, score: 0.68 },
      },
    },
  ],
}

const baseOption = buildPerfectPrototypeSupportAtlasPrethresholdCellOption({
  dataset,
  cellCandidate,
})
assert.ok(Number(baseOption?.positiveRadius ?? 0) >= 0.2)

const options = buildPerfectPrototypeSupportAtlasBoundaryVetoOptions({
  selectedNegatives: [
    { positiveKDistance: 0.24, posDistance: 0.22, margin: 0.32, score: 0.2 },
    { positiveKDistance: 0.26, posDistance: 0.24, margin: 0.28, score: 0.18 },
  ],
  supportEvaluations: [
    { positiveKDistance: 0.2, posDistance: 0.18, margin: 0.88, score: 0.68 },
  ],
  baseOption,
})

assert.ok(Array.isArray(options) && options.length > 0)
assert.ok(options.some((entry) => Number(entry?.vetoMargin ?? -1) >= 0.28))

console.log("ok: support boundary veto")
