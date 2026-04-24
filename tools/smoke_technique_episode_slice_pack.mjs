#!/usr/bin/env node
import assert from "node:assert/strict"

import { materializeTechniqueEpisodeSlicePack } from "../src/lib/technique_episode_slice_pack_builder.mjs"

const pack = materializeTechniqueEpisodeSlicePack({
  episodeRows: [
    { episodeId: "pos", hitTarget: true, symbol: "AAA", partitionKey: "p1", currentAtomIds: ["core", "setup"], episodeAtomIds: ["curr:core"] },
    { episodeId: "neg", hitTarget: false, symbol: "BBB", partitionKey: "p1", currentAtomIds: ["core", "trap"], episodeAtomIds: ["curr:core", "curr:trap"] },
  ],
  sliceContract: {
    sliceContractId: "slice_1",
    sliceSlug: "slice_1",
    contractAtomIds: ["forbid_current:trap"],
  },
})

assert.equal(pack.summary.episodeCount, 1)
assert.equal(pack.summary.positiveEpisodeCount, 1)
assert.deepEqual(pack.episodeRows.map((row) => row.episodeId), ["pos"])
console.log("ok smoke_technique_episode_slice_pack")
