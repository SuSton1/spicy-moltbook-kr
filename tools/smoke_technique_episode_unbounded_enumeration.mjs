#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const episodeRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({
    partitionKey: "p_unbounded",
    episodeId: `pos_a_${yearKey}`,
    yearKey,
    hitTarget: true,
    currentAtomIds: ["core", "setup", "trend", "quality"],
    episodeAtomIds: ["curr:a_core", "curr:z_core", "prev1:trend", "curr:aaa_bad_veto"],
  })
  episodeRows.push({
    partitionKey: "p_unbounded",
    episodeId: `pos_b_${yearKey}`,
    yearKey,
    hitTarget: true,
    currentAtomIds: ["core", "setup", "trend", "quality"],
    episodeAtomIds: ["curr:a_core", "curr:z_core", "prev1:trend"],
  })
  episodeRows.push({
    partitionKey: "p_unbounded",
    episodeId: `near_neg_${yearKey}`,
    yearKey,
    hitTarget: false,
    currentAtomIds: ["core", "setup", "trend", "trap"],
    episodeAtomIds: ["curr:z_core", "prev1:trend", "curr:aaa_bad_veto", "curr:zzz_good_veto"],
  })
  episodeRows.push({
    partitionKey: "p_unbounded",
    episodeId: `noise_a_1_${yearKey}`,
    yearKey,
    hitTarget: false,
    currentAtomIds: ["other"],
    episodeAtomIds: ["curr:a_core", "curr:noise_a_1"],
  })
  episodeRows.push({
    partitionKey: "p_unbounded",
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
    contractId: "tp12_episode_nearmiss_unbounded_enumeration_v10",
    labelId: "tp12_no_stop_hit_3d",
    coreYears: [2017, 2018],
    minPositiveEpisodeSupportPerYear: 2,
    maxAtomsToConsider: 16,
    maxCoreAtoms: 1,
    maxCoreCandidates: 0,
    maxVetoAtoms: 1,
    maxVetoCandidatesPerCore: 0,
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
assert.equal(report.coreCandidateCount, 3)
assert.equal(report.partitionSummaries[0].coreCandidateCount, 3)
assert.equal(report.partitionSummaries[0].supervisedCoreCandidateCount, 2)
assert.equal(report.verifiedPatternCount, 2)
assert.deepEqual(report.verifiedPatterns.map((row) => row.coreAtomIds), [["curr:z_core"], ["prev1:trend"]])
assert.deepEqual(report.verifiedPatterns.map((row) => row.vetoAtomIds), [["curr:zzz_good_veto"], ["curr:zzz_good_veto"]])
assert.ok(report.verifiedPatterns.every((row) => row.remainingSupervisedNegativeCount === 0))
assert.ok(report.verifiedPatterns.every((row) => row.remainingNegativeCount === 0))
console.log("ok smoke_technique_episode_unbounded_enumeration")
