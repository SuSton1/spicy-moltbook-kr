import assert from "node:assert/strict"

import { materializePerfectPrototypeSubgroupExactEntryState } from "../src/lib/perfect_prototype_subgroup_exact_entry.mjs"
import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"

const rowCount = 16

const buildRowset = (values) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize: rowCount,
    allowDense: true,
  })

const computePositiveHitStats = ({ rowIndexes }) => ({
  rawCount: rowIndexes.length,
  cappedCount: rowIndexes.length,
  distinctDateCount: rowIndexes.length,
  matchedMonthCount: Math.min(6, rowIndexes.length),
  matchedQuarterCount: Math.min(4, rowIndexes.length),
  matchedFoldCount: Math.min(4, rowIndexes.length),
  maxSymbolsMatchedPerDate: 1,
  top1DateHitShare: rowIndexes.length > 0 ? 1 / rowIndexes.length : 0,
  top3DateHitShare: rowIndexes.length > 0 ? Math.min(1, 3 / rowIndexes.length) : 0,
  top1FoldHitShare: rowIndexes.length > 0 ? 1 / rowIndexes.length : 0,
  top3FoldHitShare: rowIndexes.length > 0 ? Math.min(1, 3 / rowIndexes.length) : 0,
})

const seedPostingCache = {
  async getSeedPositiveRowset(seedIndex) {
    if (seedIndex === 2) return null
    if (seedIndex === 0) return buildRowset([0, 1, 2, 3])
    if (seedIndex === 1) return buildRowset([1, 2, 3])
    return buildRowset([])
  },
  async getSeedNegativeRowset(seedIndex) {
    if (seedIndex === 0) return buildRowset([10, 11])
    if (seedIndex === 1) return buildRowset([11])
    return buildRowset([])
  },
}

const accepted = await materializePerfectPrototypeSubgroupExactEntryState({
  manifest: {
    subgroupId: "SG_ACCEPT",
    bundleTokens: ["tag:test:a", "tag:test:b"],
    seedIndexes: [0, 1],
  },
  familyId: "low_gap_top_continuation",
  basePositiveRowset: buildRowset([0, 1, 2, 3]),
  baseNegativeRowset: buildRowset([10, 11, 12]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  hitCountMode: "DAY_CAPPED_SYMBOL",
  hitCountDaySymbolCap: 2,
  effectiveMinHitCount: 2,
  familyScopedMinHitApplied: true,
})

assert.equal(accepted.ok, true)
assert.deepEqual(Array.from(accepted.entrySeedIndexes), [0, 1])
assert.deepEqual(accepted.entrySeedTokens, ["tag:test:a", "tag:test:b"])
assert.deepEqual(Array.from(accepted.positiveRowIndexes), [1, 2, 3])
assert.deepEqual(Array.from(accepted.negativeRowIndexes), [11])
assert.equal(accepted.positiveEffectiveCount, 3)
assert.equal(accepted.entryEffectiveMinHitCount, 2)
assert.equal(accepted.entryFamilyScopedMinHitApplied, true)
assert.equal(accepted.nextStartAt, 2)

const belowMinHit = await materializePerfectPrototypeSubgroupExactEntryState({
  manifest: {
    subgroupId: "SG_MIN_HIT",
    bundleTokens: ["tag:test:a", "tag:test:b"],
    seedIndexes: [0, 1],
  },
  familyId: "low_gap_top_continuation",
  basePositiveRowset: buildRowset([0, 1, 2, 3]),
  baseNegativeRowset: buildRowset([10, 11, 12]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  hitCountMode: "DAY_CAPPED_SYMBOL",
  hitCountDaySymbolCap: 2,
  effectiveMinHitCount: 4,
  familyScopedMinHitApplied: true,
})

assert.equal(belowMinHit.ok, false)
assert.equal(belowMinHit.reason, "below_effective_min_hit")

const missingPosting = await materializePerfectPrototypeSubgroupExactEntryState({
  manifest: {
    subgroupId: "SG_MISSING",
    bundleTokens: ["tag:test:a", "tag:test:missing"],
    seedIndexes: [0, 2],
  },
  familyId: "low_gap_top_continuation",
  basePositiveRowset: buildRowset([0, 1, 2, 3]),
  baseNegativeRowset: buildRowset([10, 11, 12]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  hitCountMode: "DAY_CAPPED_SYMBOL",
  hitCountDaySymbolCap: 2,
  effectiveMinHitCount: 2,
  familyScopedMinHitApplied: true,
})

assert.equal(missingPosting.ok, false)
assert.equal(missingPosting.reason, "seed_rowset_unmaterialized")

console.log("ok")
