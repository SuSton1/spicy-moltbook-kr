import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { materializePerfectPrototypeSubgroupExactEntryState } from "../src/lib/perfect_prototype_subgroup_exact_entry.mjs"
import {
  solvePerfectPrototypeExactCompletion,
  solvePerfectPrototypeExactCompletionFrontier,
} from "../src/lib/perfect_prototype_exact_completion_solver.mjs"

const rowCount = 48

const positiveDateByRow = new Map([
  [0, "2025-01-03"],
  [1, "2025-01-06"],
  [2, "2025-01-07"],
  [3, "2025-02-03"],
  [4, "2025-02-04"],
  [5, "2025-02-05"],
  [6, "2025-03-03"],
  [7, "2025-03-04"],
  [8, "2025-03-05"],
  [9, "2025-04-01"],
  [10, "2025-04-02"],
  [11, "2025-04-03"],
])

const positiveMonthByRow = new Map([
  [0, "2025-01"],
  [1, "2025-01"],
  [2, "2025-01"],
  [3, "2025-02"],
  [4, "2025-02"],
  [5, "2025-02"],
  [6, "2025-03"],
  [7, "2025-03"],
  [8, "2025-03"],
  [9, "2025-04"],
  [10, "2025-04"],
  [11, "2025-04"],
])

const positiveFoldByRow = new Map([
  [0, "F1"],
  [1, "F1"],
  [2, "F1"],
  [3, "F2"],
  [4, "F2"],
  [5, "F2"],
  [6, "F3"],
  [7, "F3"],
  [8, "F3"],
  [9, "F4"],
  [10, "F4"],
  [11, "F4"],
])

const buildRowset = (values) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize: rowCount,
    allowDense: true,
  })

const computePositiveHitStats = ({ rowIndexes }) => {
  const values = Array.from(rowIndexes ?? [])
  const dateKeys = new Set(values.map((value) => positiveDateByRow.get(value)).filter(Boolean))
  const monthKeys = new Set(values.map((value) => positiveMonthByRow.get(value)).filter(Boolean))
  const foldKeys = new Set(values.map((value) => positiveFoldByRow.get(value)).filter(Boolean))
  const top1DateHitShare = dateKeys.size > 0 ? 1 / dateKeys.size : 0
  return {
    rawCount: values.length,
    cappedCount: values.length,
    distinctDateCount: dateKeys.size,
    matchedMonthCount: monthKeys.size,
    matchedQuarterCount: monthKeys.size,
    matchedFoldCount: foldKeys.size,
    maxSymbolsMatchedPerDate: 1,
    top1DateHitShare,
    top3DateHitShare: Math.min(1, top1DateHitShare * 3),
    top1FoldHitShare: foldKeys.size > 0 ? 1 / foldKeys.size : 0,
    top3FoldHitShare: foldKeys.size > 0 ? Math.min(1, 3 / foldKeys.size) : 0,
  }
}

const seedPostingCache = {
  async getSeedPositiveRowset(seedIndex) {
    if (seedIndex === 0 || seedIndex === 1) return buildRowset([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    if (seedIndex === 2) return buildRowset([0, 1, 3, 4, 6, 7, 9, 10])
    if (seedIndex === 3) return buildRowset([0, 1, 3, 4, 6, 7, 9, 10])
    return buildRowset([])
  },
  async getSeedNegativeRowset(seedIndex) {
    if (seedIndex === 0 || seedIndex === 1) return buildRowset([30, 31])
    if (seedIndex === 2) return buildRowset([30])
    if (seedIndex === 3) return buildRowset([])
    return buildRowset([])
  },
}

const entryState = await materializePerfectPrototypeSubgroupExactEntryState({
  manifest: {
    subgroupId: "SG_CORE_FRONTIER",
    bundleTokens: ["tag:test:base:a", "tag:test:base:b"],
    seedIndexes: [0, 1],
  },
  familyId: "low_gap_top_continuation",
  basePositiveRowset: buildRowset([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  baseNegativeRowset: buildRowset([30, 31]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  hitCountMode: "DAY_CAPPED_SYMBOL",
  hitCountDaySymbolCap: 2,
  effectiveMinHitCount: 4,
  familyScopedMinHitApplied: true,
})
assert.equal(entryState.ok, true)

const baseUnsat = await solvePerfectPrototypeExactCompletion({
  familyId: "low_gap_top_continuation",
  manifest: { subgroupId: "SG_CORE_FRONTIER" },
  entryState,
  selectedSeedCount: 4,
  seedTokensOrdered: [
    "tag:test:base:a",
    "tag:test:base:b",
    "tag:test:core:anchor",
    "tag:test:core:kill",
  ],
  seedPositiveCounts: Uint32Array.from([12, 12, 8, 8]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount: 4,
  generalizedSubgroupBreadthFloor: {
    minMatchedDates: 10,
    minMatchedMonths: 4,
    minMatchedFolds: 4,
    coverMatchedDates: 12,
    coverMatchedMonths: 4,
    coverMatchedFolds: 4,
    earlyDateRetentionRatio: 0.8,
    earlyMonthRetentionRatio: 1,
    earlyFoldRetentionRatio: 1,
  },
  evaluateBreadthFloor: ({ hitStats, generalizedSubgroupBreadthFloor }) => ({
    ok:
      Number(hitStats?.distinctDateCount ?? 0) >= Number(generalizedSubgroupBreadthFloor?.minMatchedDates ?? 10) &&
      Number(hitStats?.matchedMonthCount ?? 0) >= Number(generalizedSubgroupBreadthFloor?.minMatchedMonths ?? 4) &&
      Number(hitStats?.matchedFoldCount ?? 0) >= Number(generalizedSubgroupBreadthFloor?.minMatchedFolds ?? 4),
  }),
  maxRuleSize: 4,
  maxCandidates: 8,
})

assert.equal(baseUnsat.ok, false)

const frontierSolved = await solvePerfectPrototypeExactCompletionFrontier({
  familyId: "low_gap_top_continuation",
  manifest: { subgroupId: "SG_CORE_FRONTIER" },
  entryState,
  cfg: {
    lowFamilyMinTrainMatchedDates: 4,
    lowFamilyMinTrainMatchedMonths: 4,
    lowFamilyMinTrainMatchedFolds: 4,
  },
  selectedSeedCount: 4,
  seedTokensOrdered: [
    "tag:test:base:a",
    "tag:test:base:b",
    "tag:test:core:anchor",
    "tag:test:core:kill",
  ],
  seedPositiveCounts: Uint32Array.from([12, 12, 8, 8]),
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount: 4,
  maxRuleSize: 4,
  maxCandidates: 8,
  maxCores: 4,
})

assert.equal(frontierSolved.ok, true)
assert.ok(Number(frontierSolved.exactCoreCandidateCount) > 0)
assert.ok(Number(frontierSolved.exactCoreQualifiedCount) > 0)
assert.ok(Number(frontierSolved.exactCoreSolvedCount) > 0)
assert.ok(Array.isArray(frontierSolved.tokens))
assert.ok(frontierSolved.tokens.includes("tag:test:base:a"))
assert.ok(frontierSolved.tokens.includes("tag:test:base:b"))
assert.ok(frontierSolved.tokens.includes("tag:test:core:kill"))
assert.equal(frontierSolved.negativeCount, 0)
assert.ok(Number(frontierSolved.exactCoreFrontierBestRetainedDateCount) >= 8)

console.log("ok")
