#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueEpisodeControlPairs } from "../src/lib/technique_episode_control_matcher.mjs"

const episodeRows = [
  { episodeId: "p1_a", partitionKey: "p1", yearKey: 2017, decisionDateKey: "2017-01-03", hitTarget: true, currentAtomIds: ["core", "setup", "trend"], episodeAtomIds: ["curr:core", "prev1:trend"] },
  { episodeId: "p1_b", partitionKey: "p1", yearKey: 2017, decisionDateKey: "2017-01-04", hitTarget: true, currentAtomIds: ["core", "setup", "trend"], episodeAtomIds: ["curr:core", "prev1:trend"] },
  { episodeId: "n_same_year", partitionKey: "p1", yearKey: 2017, decisionDateKey: "2017-01-05", hitTarget: false, currentAtomIds: ["core", "setup", "trap"], episodeAtomIds: ["curr:core", "prev1:trend", "curr:trap"] },
  { episodeId: "n_other_year", partitionKey: "p1", yearKey: 2018, decisionDateKey: "2018-01-05", hitTarget: false, currentAtomIds: ["core", "setup", "trap"], episodeAtomIds: ["curr:core", "prev1:trend", "curr:trap"] },
  { episodeId: "n_other_partition", partitionKey: "p2", yearKey: 2017, decisionDateKey: "2017-01-06", hitTarget: false, currentAtomIds: ["core", "setup", "trap"], episodeAtomIds: ["curr:core", "prev1:trend", "curr:trap"] },
]

const dataset = buildTechniqueEpisodeControlPairs({
  episodeRows,
  contract: {
    contractId: "tp12_episode_matched_control_purity_slice_v11",
    controlRequireSamePartition: true,
    controlRequireSameYear: true,
    maxMatchedControlsPerPositive: 1,
    controlMinCurrentAtomJaccard: 0.2,
    controlMinEpisodeAtomJaccard: 0.1,
    controlMinSharedCurrentAtoms: 2,
    controlMinSharedEpisodeAtoms: 2,
    controlCurrentAtomWeight: 1,
    controlEpisodeAtomWeight: 0.25,
  },
})

assert.equal(dataset.summary.pairedPositiveCount, 2)
assert.equal(dataset.summary.unmatchedPositiveCount, 0)
assert.ok(dataset.pairRows.every((row) => row.matchedNegativeEpisodeIds[0] === "n_same_year"))
console.log("ok smoke_technique_episode_control_matcher")
