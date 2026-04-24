import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { collectPerfectPrototypeCrossfitHardNegatives } from "../src/lib/perfect_prototype_hard_negative_refinement.mjs"

const rowCount = 20

const calendarDateKeys = [
  "2025-01-02",
  "2025-01-03",
  "2025-02-03",
  "2025-02-04",
]

const rowDateIndexes = new Uint32Array(rowCount)
rowDateIndexes[0] = 0
rowDateIndexes[10] = 0
rowDateIndexes[1] = 1
rowDateIndexes[2] = 2
rowDateIndexes[11] = 2
rowDateIndexes[3] = 3

const buildRowset = (values) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize: rowCount,
    allowDense: true,
  })

const computePositiveHitStats = ({ rowIndexes }) => {
  const dateKeys = new Set(
    Array.from(rowIndexes ?? [])
      .map((rowIndex) => calendarDateKeys[rowDateIndexes[rowIndex]])
      .filter(Boolean),
  )
  return {
    rawCount: rowIndexes.length,
    cappedCount: rowIndexes.length,
    distinctDateCount: dateKeys.size,
    matchedMonthCount: dateKeys.size,
    matchedQuarterCount: dateKeys.size,
    matchedFoldCount: dateKeys.size,
    maxSymbolsMatchedPerDate: 1,
    top1DateHitShare: dateKeys.size > 0 ? 1 / dateKeys.size : 0,
    top3DateHitShare: dateKeys.size > 0 ? Math.min(1, 3 / dateKeys.size) : 0,
    top1FoldHitShare: dateKeys.size > 0 ? 1 / dateKeys.size : 0,
    top3FoldHitShare: dateKeys.size > 0 ? Math.min(1, 3 / dateKeys.size) : 0,
  }
}

const seedPostingCache = {
  async getSeedPositiveRowset(seedIndex) {
    if (seedIndex === 1) return buildRowset([0, 2])
    return buildRowset([])
  },
  async getSeedNegativeRowset(seedIndex) {
    if (seedIndex === 1) return buildRowset([10, 11])
    return buildRowset([])
  },
}

const refinement = await collectPerfectPrototypeCrossfitHardNegatives({
  familyId: "low_gap_top_continuation",
  manifest: { subgroupId: "SG_CROSSFIT" },
  core: {
    coreId: "SG_CROSSFIT::core::001",
    entrySeedTokens: ["tag:test:base"],
    entrySeedIndexes: [0],
    positiveRowIndexes: Uint32Array.from([0, 1, 2, 3]),
    negativeRowIndexes: Uint32Array.from([10, 11]),
    entryBreadthFloor: {
      minMatchedDates: 1,
      minMatchedMonths: 1,
      minMatchedFolds: 1,
    },
  },
  selectedSeedCount: 2,
  seedTokensOrdered: ["tag:test:base", "tag:test:refine"],
  seedPositiveCounts: Uint32Array.from([4, 2]),
  seedPostingCache,
  rowCount,
  rowDateIndexes,
  calendarDateKeys,
  computePositiveHitStats,
  familySearchMinHitCount: 1,
  maxRuleSize: 2,
  maxCandidates: 4,
  windowCount: 2,
  minWindowSupport: 1,
  solveExactCompletion: async () => ({
    ok: true,
    seedIndexes: [0, 1],
  }),
})

assert.equal(refinement.crossfitWindowCount, 2)
assert.equal(refinement.crossfitMatchedWindowCount, 2)
assert.equal(refinement.crossfitNegativeWindowCount, 2)
assert.equal(refinement.crossfitFalsePositiveRowCount, 2)
assert.equal(refinement.hardNegativeAddedCount, 2)
assert.equal(refinement.hardNegativeRefined, true)
assert.deepEqual(Array.from(refinement.hardNegativeRowIndexes), [10, 11])

console.log("ok")
