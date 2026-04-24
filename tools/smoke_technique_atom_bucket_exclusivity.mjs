#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueStructuralAtomsForRow } from "../src/lib/technique_structural_atom_builder.mjs"
import { techniquePatternDiscoveryFixtureContract } from "./_technique_pattern_contract_fixture.mjs"

const atomRow = buildTechniqueStructuralAtomsForRow({
  contract: techniquePatternDiscoveryFixtureContract,
  row: {
    symbol: "035420",
    decisionDateKey: "2024-06-03",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    labels: { tp12_no_stop_hit_3d: false },
    numericFeatureMap: {
      "tech.distanceTo52wHigh": -0.02,
      "gap.fillRatio": 0.12,
      "tech.gapRetention": 0.88,
      "trend.slope20": 0.03,
      "candle.bodyPct": 0.44,
      "tech.bodySignedPct": 0.31,
    },
  },
})

const baseFeatureCounts = new Map()
for (const atomId of atomRow.atomIds) {
  const baseFeatureId = atomRow.atomMetadataById?.[atomId]?.baseFeatureId
  baseFeatureCounts.set(baseFeatureId, (baseFeatureCounts.get(baseFeatureId) ?? 0) + 1)
}
assert(Math.max(...baseFeatureCounts.values()) <= 1)
console.log("ok smoke_technique_atom_bucket_exclusivity")
