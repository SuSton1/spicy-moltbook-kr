#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const episodeRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_a_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "trend", "quality"], episodeAtomIds: ["curr:core", "curr:setup", "prev1:trend"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_b_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "trend", "quality"], episodeAtomIds: ["curr:core", "curr:setup", "prev1:trend", "curr:quality"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `near_neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "setup", "trend", "trap"], episodeAtomIds: ["curr:core", "curr:setup", "prev1:trend", "curr:trap"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `far_neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "setup", "other"], episodeAtomIds: ["curr:core", "curr:setup", "curr:other"] })
}

const report = searchTechniqueEpisodeSubstrates({
  episodeRows,
  contract: {
    contractId: "tp12_episode_nearmiss_supervision_v8",
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
    negativeSupervisionMode: "near_miss_current_overlap",
    nearMissPositiveConsensusMinShare: 0.5,
    nearMissMinCurrentAtomOverlapRatio: 0.5,
    nearMissMinSharedCurrentAtoms: 3,
    requireNearMissNegatives: true,
  },
})

assert.equal(report.partitionCount, 1)
assert.equal(report.eligiblePartitionCount, 1)
assert.equal(report.searchedPartitionCount, 1)
assert.equal(report.supervisedCoreCandidateCount > 0, true)
assert.equal(report.verifiedPatternCount >= 1, true)
assert.equal(report.verifiedPatterns.every((row) => row.remainingSupervisedNegativeCount === 0), true)
assert.equal(report.verifiedPatterns.some((row) => row.remainingNegativeCount > 0), true)
assert.equal(report.verifiedPatterns.some((row) => JSON.stringify(row.vetoAtomIds) === JSON.stringify(["curr:trap"])), true)
console.log("ok smoke_technique_episode_partitioned_substrate_search")
