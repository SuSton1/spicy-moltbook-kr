import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { materializePerfectPrototypeSubgroupExactEntryState } from "../src/lib/perfect_prototype_subgroup_exact_entry.mjs"
import { solvePerfectPrototypeExactCompletion } from "../src/lib/perfect_prototype_exact_completion_solver.mjs"

const rowCount = 24

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

const buildEntryState = async ({ seedPostingCache }) =>
  materializePerfectPrototypeSubgroupExactEntryState({
    manifest: {
      subgroupId: "SG_SOLVER",
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

const solvingPostingCache = {
  async getSeedPositiveRowset(seedIndex) {
    if (seedIndex === 0) return buildRowset([0, 1, 2, 3])
    if (seedIndex === 1) return buildRowset([1, 2, 3])
    if (seedIndex === 2) return buildRowset([1, 2, 3])
    if (seedIndex === 3) return buildRowset([1, 2])
    return buildRowset([])
  },
  async getSeedNegativeRowset(seedIndex) {
    if (seedIndex === 0) return buildRowset([10, 11])
    if (seedIndex === 1) return buildRowset([11])
    if (seedIndex === 2) return buildRowset([])
    if (seedIndex === 3) return buildRowset([11])
    return buildRowset([])
  },
}

const unsatPostingCache = {
  async getSeedPositiveRowset(seedIndex) {
    if (seedIndex === 0) return buildRowset([0, 1, 2, 3])
    if (seedIndex === 1) return buildRowset([1, 2, 3])
    if (seedIndex === 2) return buildRowset([1, 2, 3])
    return buildRowset([])
  },
  async getSeedNegativeRowset(seedIndex) {
    if (seedIndex === 0) return buildRowset([10, 11])
    if (seedIndex === 1) return buildRowset([11])
    if (seedIndex === 2) return buildRowset([11])
    return buildRowset([])
  },
}

const solvingEntry = await buildEntryState({ seedPostingCache: solvingPostingCache })
assert.equal(solvingEntry.ok, true)

const solved = await solvePerfectPrototypeExactCompletion({
  familyId: "low_gap_top_continuation",
  manifest: { subgroupId: "SG_SOLVER" },
  entryState: solvingEntry,
  selectedSeedCount: 4,
  seedTokensOrdered: ["tag:test:a", "tag:test:b", "tag:test:c", "tag:test:d"],
  seedPositiveCounts: Uint32Array.from([4, 3, 3, 2]),
  seedPostingCache: solvingPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount: 2,
  generalizedSubgroupBreadthFloor: {
    coverMatchedDates: 3,
    coverMatchedMonths: 3,
    coverMatchedFolds: 3,
    earlyDateRetentionRatio: 0.5,
    earlyMonthRetentionRatio: 0.5,
    earlyFoldRetentionRatio: 0.5,
  },
  evaluateBreadthFloor: ({ hitStats }) => ({
    ok:
      Number(hitStats?.distinctDateCount ?? 0) >= 2 &&
      Number(hitStats?.matchedMonthCount ?? 0) >= 2 &&
      Number(hitStats?.matchedFoldCount ?? 0) >= 2,
  }),
  maxRuleSize: 4,
  maxCandidates: 8,
  hardNegativeRowIndexes: Uint32Array.from([11]),
  hardNegativeWeight: 4,
})

assert.equal(solved.ok, true)
assert.deepEqual(solved.tokens, ["tag:test:a", "tag:test:b", "tag:test:c"])
assert.equal(solved.negativeCount, 0)
assert.equal(solved.addedTokenCount, 1)
assert.equal(solved.hardNegativeAddedCount, 1)
assert.ok(Number(solved.exploredStates) > 0)

const unsatEntry = await buildEntryState({ seedPostingCache: unsatPostingCache })
assert.equal(unsatEntry.ok, true)

const unsat = await solvePerfectPrototypeExactCompletion({
  familyId: "low_gap_top_continuation",
  manifest: { subgroupId: "SG_UNSAT" },
  entryState: unsatEntry,
  selectedSeedCount: 3,
  seedTokensOrdered: ["tag:test:a", "tag:test:b", "tag:test:c"],
  seedPositiveCounts: Uint32Array.from([4, 3, 3]),
  seedPostingCache: unsatPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount: 2,
  generalizedSubgroupBreadthFloor: {
    coverMatchedDates: 3,
    coverMatchedMonths: 3,
    coverMatchedFolds: 3,
    earlyDateRetentionRatio: 0.5,
    earlyMonthRetentionRatio: 0.5,
    earlyFoldRetentionRatio: 0.5,
  },
  evaluateBreadthFloor: ({ hitStats }) => ({
    ok:
      Number(hitStats?.distinctDateCount ?? 0) >= 2 &&
      Number(hitStats?.matchedMonthCount ?? 0) >= 2 &&
      Number(hitStats?.matchedFoldCount ?? 0) >= 2,
  }),
  maxRuleSize: 4,
  maxCandidates: 8,
})

assert.equal(unsat.ok, false)
assert.equal(unsat.reason, "unsat_negative_separation")
assert.ok(Number(unsat.exploredStates) > 0)

console.log("ok")
