#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniquePartitionDimensions, buildTechniquePartitionKey } from "../src/lib/technique_partition_key_builder.mjs"
import { techniquePatternDiscoveryFixtureContract } from "./_technique_pattern_contract_fixture.mjs"

const featureMap = {
  "gap.openPct": 0.05,
  "tech.gapRetention": 0.82,
  "tech.upperWickToBody": 1.6,
  "tech.lowerWickToBody": 0.2,
  "candle.bodyPct": 0.32,
  "tech.closeLocationInRange": 0.74,
  "tech.avgTradingValue20dKrw": 12000000000,
  "volume.liquidityStress": 0.18,
  "tech.sponsorFragility": 0.24,
  "sig.sponsor.quality": 0.71,
  "tech.anchorRecencyDays": 2,
}

const dimensions = buildTechniquePartitionDimensions({
  contract: techniquePatternDiscoveryFixtureContract,
  featureMap,
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
})

assert.deepEqual(dimensions, {
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
  regimeId: "gap_hold",
  shapeId: "upper_wick_dominant",
  liquidityId: "liquid_strong",
  anchorAgeId: null,
})
assert.equal(
  buildTechniquePartitionKey({
    contract: techniquePatternDiscoveryFixtureContract,
    featureMap,
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
  }),
  "LOW_GAP_TOP__lb5__gap_hold__upper_wick_dominant__liquid_strong",
)
console.log("ok smoke_technique_partition_key_builder")
