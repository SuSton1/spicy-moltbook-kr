#!/usr/bin/env node
import assert from "node:assert/strict"

import { preverifyTechniquePatternCandidates } from "../src/lib/technique_pattern_preverifier.mjs"

const report = preverifyTechniquePatternCandidates({
  topKPerSignature: 1,
  negativeAtomIndex: {
    partitions: {
      LOW_GAP_TOP__lb5: {
        atomNegativeTidsets: {
          a: [0, 1],
          b: [0],
        },
      },
    },
  },
  patterns: [
    {
      patternId: "p_base",
      partitionKey: "LOW_GAP_TOP__lb5",
      positiveSignatureId: "LOW_GAP_TOP__lb5::sig1",
      generatorAtomIds: ["a"],
      closureAtomIds: ["a"],
      atomCount: 1,
      minYearSupport: 2,
      totalPositiveSupport: 16,
    },
    {
      patternId: "p_refined",
      partitionKey: "LOW_GAP_TOP__lb5",
      positiveSignatureId: "LOW_GAP_TOP__lb5::sig1",
      generatorAtomIds: ["a", "b"],
      closureAtomIds: ["a", "b"],
      atomCount: 2,
      minYearSupport: 2,
      totalPositiveSupport: 16,
    },
  ],
})

assert.equal(report.evaluatedPatternCount, 2)
assert.equal(report.retainedPatternCount, 1)
assert.equal(report.retainedPatterns[0].patternId, "p_refined")
assert.equal(report.retainedPatterns[0].preverifiedNegativeCount, 1)
assert.equal(report.retainedPatterns[0].preverifyStrategy, "generator_only")
console.log("ok smoke_technique_pattern_preverifier")
