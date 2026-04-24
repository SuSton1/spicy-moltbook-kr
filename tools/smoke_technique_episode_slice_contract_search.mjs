#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueEpisodeSliceContracts } from "../src/lib/technique_episode_slice_contract_search.mjs"

const episodeRows = []
const deltaRows = []
for (const yearKey of [2017, 2018]) {
  episodeRows.push({ episodeId: `pos_a_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "quality"], episodeAtomIds: ["curr:core", "curr:quality"] })
  episodeRows.push({ episodeId: `pos_b_${yearKey}`, yearKey, hitTarget: true, currentAtomIds: ["core", "setup", "quality"], episodeAtomIds: ["curr:core", "curr:quality"] })
  episodeRows.push({ episodeId: `neg_${yearKey}`, yearKey, hitTarget: false, currentAtomIds: ["core", "setup", "trap"], episodeAtomIds: ["curr:core", "curr:trap"] })
  deltaRows.push({ positiveEpisodeId: `pos_a_${yearKey}`, negativeEpisodeId: `neg_${yearKey}`, deltaAtomIds: ["forbid_current:trap", "require_current:quality"] })
  deltaRows.push({ positiveEpisodeId: `pos_b_${yearKey}`, negativeEpisodeId: `neg_${yearKey}`, deltaAtomIds: ["forbid_current:trap", "require_current:quality"] })
}

const report = searchTechniqueEpisodeSliceContracts({
  episodeRows,
  deltaRows,
  contract: {
    contractId: "tp12_episode_matched_control_purity_slice_v11",
    labelId: "tp12_no_stop_hit_3d",
    coreYears: [2017, 2018],
    minPositiveSupportPerYear: 2,
    maxSliceAtoms: 2,
    topDeltaAtomsToConsider: 8,
    maxSliceContracts: 4,
  },
})

assert.equal(report.summary.qualifiedContractCount >= 1, true)
assert.equal(report.sliceContracts[0].minYearSupport, 2)
assert.equal(report.sliceContracts[0].fullNegativeResidueCount, 0)
assert.ok(report.sliceContracts[0].contractAtomIds.includes("forbid_current:trap") || report.sliceContracts[0].contractAtomIds.includes("require_current:quality"))
console.log("ok smoke_technique_episode_slice_contract_search")
