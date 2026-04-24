#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildMatchedControlPuritySlice } from "../src/lib/technique_matched_control_purity_slice.mjs"

const rowsById = [
  { yearKey: 2017, currentAtomIds: ["core", "setup", "trend", "quality"] },
  { yearKey: 2017, currentAtomIds: ["core", "setup", "trend", "quality"] },
  { yearKey: 2017, currentAtomIds: ["core", "setup", "trend", "trap"] },
  { yearKey: 2017, currentAtomIds: ["core", "setup", "other"] },
]

const slice = buildMatchedControlPuritySlice({
  positiveRowIds: [0, 1],
  candidateNegativeRowIds: [2, 3],
  rowsById,
  atomField: "currentAtomIds",
  yearField: "yearKey",
  minConsensusShare: 0.5,
  minSharedAtoms: 3,
  minOverlapRatio: 0.75,
  maxControls: 0,
  distanceMetric: "consensus_jaccard",
  requireSameYearBand: true,
})

assert.deepEqual(slice.consensusAtomIds, ["core", "quality", "setup", "trend"])
assert.deepEqual(slice.supervisedNegativeIds, [2])
assert.equal(slice.matchedControlCount, 1)
assert.equal(slice.candidateNegativeCount, 2)
console.log("ok smoke_technique_matched_control_purity_slice")
