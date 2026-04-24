#!/usr/bin/env node
import assert from "node:assert/strict"

import { preverifyTechniquePatternCandidates } from "../src/lib/technique_pattern_preverifier.mjs"

const report = preverifyTechniquePatternCandidates({
  topKPerSignature: 2,
  negativeAtomIndex: {
    partitions: {
      LOW_GAP_TOP__lb5: {
        atomNegativeTidsets: {
          a: [0, 1],
          b: [0],
          c: [1],
        },
      },
    },
  },
  patterns: [
    {
      patternId: "p_frontier",
      partitionKey: "LOW_GAP_TOP__lb5",
      positiveSignatureId: "LOW_GAP_TOP__lb5::sig1",
      generatorAtomIds: ["a"],
      closureAtomIds: ["a", "b", "c"],
      atomCount: 1,
      minYearSupport: 2,
      totalPositiveSupport: 16,
    },
  ],
})

assert.equal(report.zeroNegativeCandidateCount, 1)
assert.equal(report.retainedPatterns[0].preverifyStrategy, "closure_augmented")
assert.deepEqual(report.retainedPatterns[0].seedGeneratorAtomIds, ["a"])
assert.deepEqual(report.retainedPatterns[0].generatorAtomIds, ["a"])
assert.deepEqual(report.retainedPatterns[0].atomIds, ["a"])
assert.deepEqual(report.retainedPatterns[0].preverifyAtomIds, ["a", "b", "c"])
assert.equal(report.retainedPatterns[0].preverifyAtomCount, 3)
assert.equal(report.retainedPatterns[0].preverifiedNegativeCount, 0)
console.log("ok smoke_technique_closure_first_preverify")
