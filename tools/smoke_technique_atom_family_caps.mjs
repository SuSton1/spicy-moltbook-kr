#!/usr/bin/env node
import assert from "node:assert/strict"

import { canAppendTechniqueAtomToPattern } from "../src/lib/technique_closed_pattern_miner.mjs"

assert.equal(
  canAppendTechniqueAtomToPattern({
    nextAtom: { atomId: "trend_c", familyId: "trend", baseFeatureId: "fc" },
    prefixAtomIds: ["trend_a", "trend_b"],
    prefixFamilyCounts: { trend: 2 },
    prefixBaseFeatureIds: new Set(["fa", "fb"]),
    partitionPairAdmissibility: { trend_a: ["trend_c"], trend_b: ["trend_c"] },
    familyCaps: { trend: 2 },
  }),
  false,
)
assert.equal(
  canAppendTechniqueAtomToPattern({
    nextAtom: { atomId: "gap_c", familyId: "gap", baseFeatureId: "fc" },
    prefixAtomIds: ["trend_a"],
    prefixFamilyCounts: { trend: 1 },
    prefixBaseFeatureIds: new Set(["fa"]),
    partitionPairAdmissibility: { trend_a: ["gap_c"] },
    familyCaps: { trend: 2, gap: 2 },
  }),
  true,
)
console.log("ok smoke_technique_atom_family_caps")
