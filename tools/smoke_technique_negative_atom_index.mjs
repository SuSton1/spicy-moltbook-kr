#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueNegativeAtomIndex } from "../src/lib/technique_negative_atom_index.mjs"

const { indexArtifact, negativeRowManifest } = buildTechniqueNegativeAtomIndex({
  contractId: "tp12_positive_first_partitioned_signature_preverify_v2",
  labelId: "tp12_no_stop_hit_3d",
  transactions: [
    { rowId: "n1", decisionDateKey: "2017-01-03", symbol: "A", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: false, atomIds: ["a", "b"] },
    { rowId: "n2", decisionDateKey: "2017-01-05", symbol: "B", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: false, atomIds: ["a"] },
    { rowId: "p1", decisionDateKey: "2017-01-07", symbol: "C", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: true, atomIds: ["a"] },
  ],
})

assert.equal(indexArtifact.negativeTransactionCount, 2)
assert.equal(indexArtifact.partitionCount, 1)
assert.deepEqual(indexArtifact.partitions["LOW_GAP_TOP__lb5"].atomNegativeTidsets.a, [0, 1])
assert.equal(negativeRowManifest.length, 2)
console.log("ok smoke_technique_negative_atom_index")
