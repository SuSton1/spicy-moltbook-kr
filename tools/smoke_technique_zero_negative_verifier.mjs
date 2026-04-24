#!/usr/bin/env node
import assert from "node:assert/strict"

import { verifyTechniquePatternsAgainstTrainNegatives } from "../src/lib/technique_zero_negative_verifier.mjs"

const report = verifyTechniquePatternsAgainstTrainNegatives({
  coreYears: [2017, 2018],
  minPositiveSupportPerYear: 2,
  patterns: [
    {
      patternId: "p_veto",
      partitionKey: "LOW_GAP_TOP__lb5",
      generatorAtomIds: ["a"],
      vetoAtomIds: ["x"],
    },
    {
      patternId: "p_bad",
      partitionKey: "LOW_GAP_TOP__lb5",
      generatorAtomIds: ["a"],
    },
  ],
  transactions: [
    { rowId: "r1", decisionDateKey: "2017-01-03", yearKey: 2017, symbol: "A", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: true, atomIds: ["a", "b"] },
    { rowId: "r2", decisionDateKey: "2017-02-03", yearKey: 2017, symbol: "B", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: true, atomIds: ["a", "b"] },
    { rowId: "r3", decisionDateKey: "2018-01-03", yearKey: 2018, symbol: "C", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: true, atomIds: ["a", "b"] },
    { rowId: "r4", decisionDateKey: "2018-03-03", yearKey: 2018, symbol: "D", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: true, atomIds: ["a", "b"] },
    { rowId: "r5", decisionDateKey: "2019-01-03", yearKey: 2019, symbol: "E", partitionKey: "LOW_GAP_TOP__lb5", hitTarget: false, atomIds: ["a", "x"] },
  ],
})

assert.equal(report.evaluatedPatternCount, 2)
assert.equal(report.verifiedPatternCount, 1)
assert.equal(report.verifiedPatterns[0].patternId, "p_veto")
assert.equal(report.verifiedPatterns[0].negativeCount, 0)
assert.deepEqual(report.verifiedPatterns[0].vetoAtomIds, ["x"])
console.log("ok smoke_technique_zero_negative_verifier")
