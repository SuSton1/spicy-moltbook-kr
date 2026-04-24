#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const episodeRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_a_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "trend", "quality"], episodeAtomIds: ["curr:core", "prev1:trend"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `good_b_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "trend", "quality"], episodeAtomIds: ["curr:core", "prev1:trend"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `near_neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "setup", "trend", "trap"], episodeAtomIds: ["curr:core", "prev1:trend", "curr:trap_near"] })
  episodeRows.push({ partitionKey: "p_good", episodeId: `far_neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "setup", "other"], episodeAtomIds: ["curr:core", "prev1:trend", "curr:trap_far"] })
}

const report = searchTechniqueEpisodeSubstrates({
  episodeRows,
  contract: {
    contractId: "tp12_episode_matched_control_purity_slice_v11",
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
    negativeSupervisionMode: "matched_control_purity_slice",
    nearMissPositiveConsensusMinShare: 0.5,
    nearMissMinCurrentAtomOverlapRatio: 0.5,
    nearMissMinSharedCurrentAtoms: 1,
    matchedControlPositiveConsensusMinShare: 0.5,
    matchedControlMinCurrentAtomOverlapRatio: 0.75,
    matchedControlMinSharedCurrentAtoms: 3,
    matchedControlMaxControlsPerCore: 0,
    matchedControlDistanceMetric: "consensus_jaccard",
    matchedControlRequireSameYearBand: true,
    requireNearMissNegatives: true,
  },
})

const survivor = report.verifiedPatterns.find((row) => row.remainingSupervisedNegativeCount === 0 && row.remainingNegativeCount > 0)
assert.ok(survivor)
assert.deepEqual(survivor.consensusCurrentAtomIds, ["core", "quality", "setup", "trend"])
assert.equal(survivor.supervisedNegativeCount, 2)
assert.equal(survivor.remainingSupervisedNegativeCount, 0)
assert.equal(survivor.remainingNegativeCount, 2)
assert.deepEqual(survivor.vetoAtomIds, ["curr:trap_near"])
console.log("ok smoke_technique_episode_matched_control_supervision")
