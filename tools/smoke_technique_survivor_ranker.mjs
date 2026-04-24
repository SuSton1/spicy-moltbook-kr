#!/usr/bin/env node
import assert from "node:assert/strict"

import { rankTechniqueVerifiedPatterns } from "../src/lib/technique_survivor_ranker.mjs"

const ranked = rankTechniqueVerifiedPatterns({
  topK: 2,
  patterns: [
    {
      patternId: "p2",
      atomIds: ["a", "b", "c"],
      atomCount: 3,
      minYearPositiveSupport: 2,
      totalPositiveSupport: 20,
      maxYearShare: 0.35,
      top1DateShare: 0.15,
      top1SymbolShare: 0.20,
      negativeCount: 0,
      pass: true,
    },
    {
      patternId: "p1",
      atomIds: ["a", "b"],
      atomCount: 2,
      minYearPositiveSupport: 3,
      totalPositiveSupport: 18,
      maxYearShare: 0.25,
      top1DateShare: 0.10,
      top1SymbolShare: 0.12,
      negativeCount: 0,
      pass: true,
    },
  ],
})

assert.equal(ranked.verifiedPatternCount, 2)
assert.equal(ranked.topPatternIds[0], "p1")
assert.equal(ranked.topPatterns.length, 2)
console.log("ok smoke_technique_survivor_ranker")
