#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const episodeRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({
    partitionKey: "p_ranked",
    episodeId: `pos_a_${yearKey}`,
    yearKey,
    hitTarget: true,
    currentAtomIds: ["core", "setup", "trend", "quality"],
    episodeAtomIds: ["curr:a_core", "curr:z_core", "prev1:trend", "curr:aaa_bad_veto"],
  })
  episodeRows.push({
    partitionKey: "p_ranked",
    episodeId: `pos_b_${yearKey}`,
    yearKey,
    hitTarget: true,
    currentAtomIds: ["core", "setup", "trend", "quality"],
    episodeAtomIds: ["curr:a_core", "curr:z_core", "prev1:trend"],
  })
  episodeRows.push({
    partitionKey: "p_ranked",
    episodeId: `near_neg_${yearKey}`,
    yearKey,
    hitTarget: false,
    currentAtomIds: ["core", "setup", "trend", "trap"],
    episodeAtomIds: ["curr:z_core", "prev1:trend", "curr:aaa_bad_veto", "curr:zzz_good_veto"],
  })
  episodeRows.push({
    partitionKey: "p_ranked",
    episodeId: `noise_a_1_${yearKey}`,
    yearKey,
    hitTarget: false,
    currentAtomIds: ["other"],
    episodeAtomIds: ["curr:a_core", "curr:noise_a_1"],
  })
  episodeRows.push({
    partitionKey: "p_ranked",
    episodeId: `noise_a_2_${yearKey}`,
    yearKey,
    hitTarget: false,
    currentAtomIds: ["other"],
    episodeAtomIds: ["curr:a_core", "curr:noise_a_2"],
  })
}

const report = searchTechniqueEpisodeSubstrates({
  episodeRows,
  contract: {
    contractId: "tp12_episode_nearmiss_ranked_enumeration_v9",
    labelId: "tp12_no_stop_hit_3d",
    coreYears: [2017, 2018],
    minPositiveEpisodeSupportPerYear: 2,
    maxAtomsToConsider: 16,
    maxCoreAtoms: 1,
    maxCoreCandidates: 1,
    maxVetoAtoms: 1,
    maxVetoCandidatesPerCore: 1,
    searchMode: "partitioned",
    partitionField: "partitionKey",
    maxPartitionsToSearch: 0,
    negativeSupervisionMode: "near_miss_current_overlap",
    nearMissPositiveConsensusMinShare: 0.5,
    nearMissMinCurrentAtomOverlapRatio: 0.75,
    nearMissMinSharedCurrentAtoms: 3,
    requireNearMissNegatives: true,
  },
})

assert.equal(report.partitionCount, 1)
assert.equal(report.eligiblePartitionCount, 1)
assert.equal(report.searchedPartitionCount, 1)
assert.equal(report.coreCandidateCount, 1)
assert.equal(report.verifiedPatternCount, 1)
assert.deepEqual(report.verifiedPatterns[0].coreAtomIds, ["curr:z_core"])
assert.deepEqual(report.verifiedPatterns[0].vetoAtomIds, ["curr:zzz_good_veto"])
assert.equal(report.verifiedPatterns[0].remainingSupervisedNegativeCount, 0)
assert.equal(report.verifiedPatterns[0].remainingNegativeCount, 0)
console.log("ok smoke_technique_episode_ranked_enumeration")
