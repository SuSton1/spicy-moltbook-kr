#!/usr/bin/env node
import assert from "node:assert/strict"

import { preverifyTechniquePatternCandidates } from "../src/lib/technique_pattern_preverifier.mjs"
import { normalizeTechniqueContrastiveCorePattern } from "../src/lib/technique_contrastive_veto_search.mjs"

const report = preverifyTechniquePatternCandidates({
  topKPerSignature: 1,
  negativeAtomIndex: {
    partitions: {
      P: {
        atomNegativeTidsets: {
          a: [0, 1],
          b: [0],
        },
      },
    },
  },
  patterns: [
    {
      patternId: "p1",
      partitionKey: "P",
      positiveSignatureId: "P::sig1",
      generatorAtomIds: ["a"],
      closureAtomIds: ["a", "b"],
      atomCount: 1,
      minYearSupport: 2,
      totalPositiveSupport: 16,
    },
  ],
})

assert.equal(report.retainedPatternCount, 1)
const row = report.retainedPatterns[0]
assert.equal(row.preverifyStrategy, "closure_augmented")
assert.deepEqual(row.seedGeneratorAtomIds, ["a"])
assert.deepEqual(row.generatorAtomIds, ["a"])
assert.deepEqual(row.atomIds, ["a"])
assert.deepEqual(row.preverifyAtomIds, ["a", "b"])
assert.equal(row.preverifyAtomCount, 2)

const normalized = normalizeTechniqueContrastiveCorePattern({
  ...row,
  generatorAtomIds: ["a", "b"],
})
assert.deepEqual(normalized.generatorAtomIds, ["a"])
assert.deepEqual(normalized.seedGeneratorAtomIds, ["a"])
console.log("ok smoke_technique_contrastive_core_generator_preservation")
