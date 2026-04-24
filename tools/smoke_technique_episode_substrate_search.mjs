#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const episodeRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_a_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup"], episodeAtomIds: ["curr:core", "prev1:setup"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_b_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "trend"], episodeAtomIds: ["curr:core", "prev1:setup", "transition:ma_state60->body_signed"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "trap"], episodeAtomIds: ["curr:core", "prev1:setup", "curr:trap"] })
  episodeRows.push({ partitionKey: "p_skip", episodeId: `skip_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["noise"], episodeAtomIds: ["curr:noise"] })
}

const report = searchTechniqueEpisodeSubstrates({
  episodeRows,
  contract: {
    contractId: "tp12_episode_partitioned_substrate_slice_v7",
    labelId: "tp12_no_stop_hit_3d",
    coreYears: [2017, 2018],
    minPositiveEpisodeSupportPerYear: 2,
    maxAtomsToConsider: 16,
    maxCoreAtoms: 2,
    maxCoreCandidates: 128,
    maxVetoAtoms: 2,
    maxVetoCandidatesPerCore: 8,
    searchMode: "partitioned",
    partitionField: "partitionKey",
    maxPartitionsToSearch: 0,
    negativeSupervisionMode: "all",
    nearMissPositiveConsensusMinShare: 0.5,
    nearMissMinCurrentAtomOverlapRatio: 0.5,
    nearMissMinSharedCurrentAtoms: 1,
    requireNearMissNegatives: true,
  },
})

assert.equal(report.partitionCount, 2)
assert.equal(report.eligiblePartitionCount, 1)
assert.equal(report.searchedPartitionCount, 1)
assert.equal(report.verifiedPatternCount >= 1, true)
assert.equal(report.verifiedPatterns[0].partitionKey, "p_good")
assert.deepEqual(report.verifiedPatterns[0].coreAtomIds, ["curr:core"])
assert.deepEqual(report.verifiedPatterns[0].vetoAtomIds, ["curr:trap"])
assert.equal(report.verifiedPatterns[0].remainingNegativeCount, 0)
assert.equal(report.verifiedPatterns[0].remainingSupervisedNegativeCount, 0)
console.log("ok smoke_technique_episode_substrate_search")
