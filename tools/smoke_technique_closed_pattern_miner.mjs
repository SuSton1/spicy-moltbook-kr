#!/usr/bin/env node
import assert from "node:assert/strict"

import { mineTechniqueClosedPatterns } from "../src/lib/technique_closed_pattern_miner.mjs"

const mined = mineTechniqueClosedPatterns({
  positiveYearIndex: {
    contractId: "tp12_positive_first_partitioned_signature_preverify_v2",
    labelId: "tp12_no_stop_hit_3d",
    coreYears: [2017, 2018],
    partitions: {
      LOW_GAP_TOP__lb5: {
        atomMetadataById: {
          a: { familyId: "trend", baseFeatureId: "fa" },
          b: { familyId: "gap", baseFeatureId: "fb" },
          c: { familyId: "trend", baseFeatureId: "fc" },
        },
        atomYearTidsets: {
          a: { 2017: [0, 1], 2018: [2, 3] },
          b: { 2017: [0, 1], 2018: [2, 3] },
          c: { 2017: [0, 1], 2018: [2] },
        },
        pairAdmissibility: {
          a: ["b"],
          b: ["a"],
          c: [],
        },
      },
    },
  },
  coreYears: [2017, 2018],
  minPositiveSupportPerYear: 2,
  maxPatternSize: 3,
  maxGeneratorsPerSignature: 1,
  familyCaps: { trend: 2, gap: 2, candles: 2, closeLocation: 1, liquidity: 1, failure: 1, intraday: 0, movingAverage: 2 },
})

assert.equal(mined.partitionCount, 1)
assert.equal(mined.positiveSignatureCount, 1)
assert.equal(mined.closedPatternCount, 1)
assert.deepEqual(mined.patterns[0].generatorAtomIds, ["a", "b"])
assert.deepEqual(mined.patterns[0].yearSupportVector, [2, 2])
console.log("ok smoke_technique_closed_pattern_miner")
