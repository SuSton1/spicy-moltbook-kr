#!/usr/bin/env node
import assert from "node:assert/strict"

import { searchTechniqueContrastiveVetoCandidates } from "../src/lib/technique_contrastive_veto_search.mjs"

const report = searchTechniqueContrastiveVetoCandidates({
  coreYears: [2017, 2018],
  minPositiveSupportPerYear: 2,
  topPatternsPerPartition: 4,
  maxVetoAtomCount: 2,
  patterns: [
    {
      patternId: "core_a",
      partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid",
      generatorAtomIds: ["a"],
      preverifiedNegativeCount: 2,
      minYearSupport: 2,
      totalPositiveSupport: 4,
    },
  ],
  transactions: [
    { rowId: "p1", decisionDateKey: "2017-01-03", yearKey: 2017, symbol: "A", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p2", decisionDateKey: "2017-02-03", yearKey: 2017, symbol: "B", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p3", decisionDateKey: "2018-01-03", yearKey: 2018, symbol: "C", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p4", decisionDateKey: "2018-02-03", yearKey: 2018, symbol: "D", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "n1", decisionDateKey: "2019-01-03", yearKey: 2019, symbol: "E", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: false, atomIds: ["a", "x"] },
    { rowId: "n2", decisionDateKey: "2019-02-03", yearKey: 2019, symbol: "F", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: false, atomIds: ["a", "y"] },
  ],
})

assert.equal(report.evaluatedCorePatternCount, 1)
assert.equal(report.contrastiveCandidateCount, 1)
assert.deepEqual(report.vetoPatterns[0].vetoAtomIds, ["x", "y"])
assert.equal(report.vetoPatterns[0].negativeCount, 0)
console.log("ok smoke_technique_contrastive_veto_search")
