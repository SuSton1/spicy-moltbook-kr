#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueAtomicTransactionRow } from "../src/lib/technique_atomic_transaction_builder.mjs"
import { techniquePatternDiscoveryFixtureContract } from "./_technique_pattern_contract_fixture.mjs"

const transaction = buildTechniqueAtomicTransactionRow({
  row: {
    symbol: "000660",
    decisionDateKey: "2023-11-07",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    labels: {
      tp12_no_stop_hit_3d: 1,
    },
    numericFeatureMap: {
      "tech.distanceToMa120": 0.02,
      "tech.daysSinceCrossAboveMa120": 3,
      "candle.bodyPct": 0.31,
      "tech.bodySignedPct": 0.24,
      "level.closeNearHigh20": 0.83,
      "level.closeNearLow20": 0.12,
      "candle.upperWickPct": 0.1,
      "tech.lowerWickPct": 0.2,
      "volume.valueRatio20": 1.8,
      "shape.failedBreakoutCount20": 0,
    },
  },
  contract: techniquePatternDiscoveryFixtureContract,
})

assert.equal(transaction.kind, "technique_atomic_transaction_v1")
assert.equal(transaction.hitTarget, true)
assert.equal(transaction.yearKey, 2023)
assert.equal(transaction.scopeId, "LOW_GAP_TOP")
assert.equal(transaction.lookbackCandidateId, "lb5")
assert.equal(transaction.partitionKey, "LOW_GAP_TOP__lb5__breakout__balanced__mid")
assert(transaction.atomCount >= 4)
assert(!transaction.atomIds.includes("scope:LOW_GAP_TOP"))
assert(transaction.baseFeatureIds.includes("tech.distanceToMa120"))
console.log("ok smoke_technique_atomic_transactions")
