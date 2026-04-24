#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueStructuralAtomsForRow } from "../src/lib/technique_structural_atom_builder.mjs"
import { techniquePatternDiscoveryFixtureContract } from "./_technique_pattern_contract_fixture.mjs"

const row = {
  symbol: "005930",
  decisionDateKey: "2024-05-13",
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
  labels: {
    tp12_no_stop_hit_3d: true,
  },
  numericFeatureMap: {
    "tech.distanceToMa20": 0.04,
    "tech.distanceToMa60": 0.01,
    "tech.distanceToMa120": 0.03,
    "tech.distanceToMa240": -0.01,
    "tech.daysSinceCrossAboveMa120": 4,
    "candle.bodyPct": 0.74,
    "tech.bodySignedPct": 0.61,
    "candle.upperWickPct": 0.62,
    "tech.lowerWickPct": 0.08,
    "tech.wickSkew": -0.54,
    "level.closeNearHigh20": 0.91,
    "level.closeNearLow20": 0.08,
    "gap.openPct": 0.04,
    "gap.fillRatio": 0.18,
    "tech.gapRetention": 0.82,
    "volume.valueRatio20": 2.4,
    "volume.avgTradingValue20dKrw": 3500000000,
    "volume.liquidityStress": 0.12,
    "sig.sponsor.quality": 0.78,
    "sig.sponsor.fragility": 0.16,
    "tech.distanceTo52wHigh": -0.03,
    "trend.slope20": 0.03,
    "shape.failedBreakoutCount20": 0,
    "shape.compression20": 0.81,
    "shape.sidewaysScore3": 0.66,
    "shape.breakoutPauseScore": 0.72,
    "shape.higherLowCount": 2,
    "pattern.supportHoldAtMa60": 0.84,
  },
}

const atomRow = buildTechniqueStructuralAtomsForRow({ row, contract: techniquePatternDiscoveryFixtureContract })
assert.equal(atomRow.hitTarget, true)
assert.equal(atomRow.yearKey, 2024)
assert.equal(atomRow.partitionKey, "LOW_GAP_TOP__lb5__gap_hold__body_dominant__mid")
assert(!atomRow.atomIds.includes("scope:LOW_GAP_TOP"))
assert(!atomRow.atomIds.includes("lookback:lb5"))
assert(atomRow.atomIds.includes("ma_state120:above_very_recent"))
assert(!atomRow.atomIds.includes("anchor_ma120_break"))
assert(atomRow.atomIds.includes("upper_wick:extreme"))
assert(atomRow.atomIds.includes("upper_to_body:balanced"))
assert(atomRow.atomIds.some((atomId) => atomId.startsWith("close_loc:")))
assert(atomRow.atomIds.includes("close_near_high20:elite"))
assert(atomRow.atomIds.includes("gap_open:up_small"))
assert(atomRow.atomIds.includes("sponsor_quality:elite"))
console.log("ok smoke_technique_structural_atom_builder")
