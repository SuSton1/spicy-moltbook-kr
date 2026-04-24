#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniquePositiveYearIndex } from "../src/lib/technique_positive_year_index.mjs"

const { indexArtifact, positiveRowManifest } = buildTechniquePositiveYearIndex({
  coreYears: [2017, 2018],
  contractId: "tp12_positive_first_partitioned_signature_preverify_v2",
  labelId: "tp12_no_stop_hit_3d",
  minPositiveSupportPerYear: 2,
  enablePairAdmissibility: true,
  transactions: [
    {
      rowId: "r1",
      decisionDateKey: "2017-01-03",
      yearKey: 2017,
      symbol: "A",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      partitionKey: "LOW_GAP_TOP__lb5",
      hitTarget: true,
      atomIds: ["a", "b"],
      atomMetadataById: { a: { familyId: "trend", baseFeatureId: "fa" }, b: { familyId: "gap", baseFeatureId: "fb" } },
    },
    {
      rowId: "r2",
      decisionDateKey: "2017-02-03",
      yearKey: 2017,
      symbol: "B",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      partitionKey: "LOW_GAP_TOP__lb5",
      hitTarget: true,
      atomIds: ["a", "b"],
      atomMetadataById: { a: { familyId: "trend", baseFeatureId: "fa" }, b: { familyId: "gap", baseFeatureId: "fb" } },
    },
    {
      rowId: "r3",
      decisionDateKey: "2018-01-03",
      yearKey: 2018,
      symbol: "C",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      partitionKey: "LOW_GAP_TOP__lb5",
      hitTarget: true,
      atomIds: ["a", "b"],
      atomMetadataById: { a: { familyId: "trend", baseFeatureId: "fa" }, b: { familyId: "gap", baseFeatureId: "fb" } },
    },
    {
      rowId: "r4",
      decisionDateKey: "2018-03-03",
      yearKey: 2018,
      symbol: "D",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      partitionKey: "LOW_GAP_TOP__lb5",
      hitTarget: true,
      atomIds: ["a", "b"],
      atomMetadataById: { a: { familyId: "trend", baseFeatureId: "fa" }, b: { familyId: "gap", baseFeatureId: "fb" } },
    },
    {
      rowId: "r5",
      decisionDateKey: "2018-04-03",
      yearKey: 2018,
      symbol: "E",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      partitionKey: "LOW_GAP_TOP__lb5",
      hitTarget: false,
      atomIds: ["a"],
      atomMetadataById: { a: { familyId: "trend", baseFeatureId: "fa" } },
    },
  ],
})

assert.equal(indexArtifact.positiveTransactionCount, 4)
assert.equal(indexArtifact.partitionCount, 1)
assert.equal(indexArtifact.partitions["LOW_GAP_TOP__lb5"].yearPositiveCounts["2017"], 2)
assert.equal(indexArtifact.partitions["LOW_GAP_TOP__lb5"].yearPositiveCounts["2018"], 2)
assert.deepEqual(indexArtifact.partitions["LOW_GAP_TOP__lb5"].atomYearTidsets.a["2017"], [0, 1])
assert.deepEqual(indexArtifact.partitions["LOW_GAP_TOP__lb5"].pairAdmissibility.a, ["b"])
assert.equal(positiveRowManifest.length, 4)
console.log("ok smoke_technique_positive_year_index")
