#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueEpisodeDeltaAtoms } from "../src/lib/technique_episode_delta_atom_builder.mjs"

const episodeRows = [
  { episodeId: "pos", partitionKey: "p1", yearKey: 2017, currentAtomIds: ["core", "setup", "quality"], episodeAtomIds: ["curr:core", "curr:quality"] },
  { episodeId: "neg", partitionKey: "p1", yearKey: 2017, currentAtomIds: ["core", "setup", "trap"], episodeAtomIds: ["curr:core", "curr:trap"] },
]
const controlPairRows = [
  {
    positiveEpisodeId: "pos",
    matchedControls: [{ negativeEpisodeId: "neg", combinedSimilarity: 0.7 }],
  },
]

const dataset = buildTechniqueEpisodeDeltaAtoms({
  episodeRows,
  controlPairRows,
  contract: { contractId: "tp12_episode_matched_control_purity_slice_v11" },
})

assert.equal(dataset.summary.pairCount, 1)
assert.deepEqual(dataset.deltaRows[0].deltaAtomIds, [
  "forbid_current:trap",
  "forbid_episode:curr:trap",
  "require_current:quality",
  "require_episode:curr:quality",
])
console.log("ok smoke_technique_episode_delta_atoms")
