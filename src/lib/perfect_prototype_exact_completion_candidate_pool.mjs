import {
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
} from "./perfect_prototype_rowset.mjs"
import { classifyPerfectPrototypeSupportAtomType } from "./perfect_prototype_support_anchor_cohort.mjs"

const EMPTY_ROW_INDEXES = new Uint32Array()

const buildOwnedRowset = ({ values = EMPTY_ROW_INDEXES, rowCount = 0, allowDense = true } = {}) =>
  createPerfectPrototypeRowset({
    values:
      Array.isArray(values) || ArrayBuffer.isView(values) ? values : EMPTY_ROW_INDEXES,
    universeSize: rowCount,
    allowDense,
  })

const intersectRowsetsOwned = ({
  leftRowset,
  rightRowset,
  rowCount,
  allowDense = true,
} = {}) => {
  if (
    !leftRowset ||
    !rightRowset ||
    getPerfectPrototypeRowsetCount(leftRowset) < 1 ||
    getPerfectPrototypeRowsetCount(rightRowset) < 1
  ) {
    return {
      rowIndexes: EMPTY_ROW_INDEXES,
      rowset: buildOwnedRowset({ values: EMPTY_ROW_INDEXES, rowCount, allowDense }),
      count: 0,
    }
  }
  const prepared = intersectPerfectPrototypeRowsetsPrepared({
    leftRowset,
    rightRowset,
    universeSize: rowCount,
    allowDense,
    resultOwnership: "borrowed",
  })
  try {
    const rowIndexes =
      prepared.count > 0 ? materializePerfectPrototypeRowsetValues(prepared.rowset) : EMPTY_ROW_INDEXES
    return {
      rowIndexes,
      rowset: buildOwnedRowset({ values: rowIndexes, rowCount, allowDense }),
      count: prepared.count,
    }
  } finally {
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
  }
}

const buildEmptyNegativeCover = ({ rowCount, allowDense = true } = {}) => ({
  rowIndexes: EMPTY_ROW_INDEXES,
  rowset: buildOwnedRowset({ values: EMPTY_ROW_INDEXES, rowCount, allowDense }),
  count: 0,
})

const safeRate = (left, right) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= 0) return 0
  return l / r
}

const compareCandidates = (left, right) => {
  if (Number(right?.hardNegativeEliminatedCount ?? 0) !== Number(left?.hardNegativeEliminatedCount ?? 0)) {
    return Number(right?.hardNegativeEliminatedCount ?? 0) - Number(left?.hardNegativeEliminatedCount ?? 0)
  }
  if (Number(right?.negativeEliminatedCount ?? 0) !== Number(left?.negativeEliminatedCount ?? 0)) {
    return Number(right?.negativeEliminatedCount ?? 0) - Number(left?.negativeEliminatedCount ?? 0)
  }
  if (Number(left?.positiveLossCount ?? 0) !== Number(right?.positiveLossCount ?? 0)) {
    return Number(left?.positiveLossCount ?? 0) - Number(right?.positiveLossCount ?? 0)
  }
  if (
    Number(right?.nextPositiveHitStats?.distinctDateCount ?? 0) !==
    Number(left?.nextPositiveHitStats?.distinctDateCount ?? 0)
  ) {
    return (
      Number(right?.nextPositiveHitStats?.distinctDateCount ?? 0) -
      Number(left?.nextPositiveHitStats?.distinctDateCount ?? 0)
    )
  }
  if (
    Number(right?.nextPositiveHitStats?.matchedMonthCount ?? 0) !==
    Number(left?.nextPositiveHitStats?.matchedMonthCount ?? 0)
  ) {
    return (
      Number(right?.nextPositiveHitStats?.matchedMonthCount ?? 0) -
      Number(left?.nextPositiveHitStats?.matchedMonthCount ?? 0)
    )
  }
  if (
    Number(right?.nextPositiveHitStats?.matchedFoldCount ?? 0) !==
    Number(left?.nextPositiveHitStats?.matchedFoldCount ?? 0)
  ) {
    return (
      Number(right?.nextPositiveHitStats?.matchedFoldCount ?? 0) -
      Number(left?.nextPositiveHitStats?.matchedFoldCount ?? 0)
    )
  }
  if (Number(right?.score ?? Number.NEGATIVE_INFINITY) !== Number(left?.score ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.score ?? Number.NEGATIVE_INFINITY) - Number(left?.score ?? Number.NEGATIVE_INFINITY)
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const incrementReason = (rejectReasonCounts, reason) => {
  const key = String(reason ?? "").trim() || "unknown"
  rejectReasonCounts[key] = Number(rejectReasonCounts[key] ?? 0) + 1
}

const incrementAtomType = (counts, atomType) => {
  const key = String(atomType ?? "").trim() || "other"
  counts[key] = Number(counts[key] ?? 0) + 1
}

const resolveAtomTypeBonus = (atomType) => {
  switch (String(atomType ?? "").trim()) {
    case "support_signature":
      return 16000
    case "adaptive_threshold":
      return 12000
    case "support_anchor":
      return 14000
    case "macro":
      return 9000
    case "interval":
      return 4000
    default:
      return 0
  }
}

export const buildPerfectPrototypeExactCompletionCandidatePool = async ({
  tokens,
  excludedSeedIndexes = null,
  minCandidateSeedIndex = 0,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  currentPositiveRowset,
  currentNegativeRowset,
  currentHardNegativeRowset = null,
  currentHardNegativeCount = 0,
  currentPositiveHitStats = null,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  generalizedSubgroupBreadthFloor = null,
  evaluateBreadthFloor = null,
  candidateTokenPredicate = null,
  maxCandidates = 24,
  hardNegativeWeight = 1,
  allowDense = true,
} = {}) => {
  const rejectReasonCounts = {}
  const currentTokenSet = new Set((Array.isArray(tokens) ? tokens : []).filter(Boolean))
  const excludedSeedIndexSet =
    excludedSeedIndexes instanceof Set
      ? excludedSeedIndexes
      : new Set((Array.isArray(excludedSeedIndexes) ? excludedSeedIndexes : []).filter(Number.isInteger))
  const currentPositiveEffectiveCount = Math.max(
    0,
    Number(
      currentPositiveHitStats?.cappedCount ?? getPerfectPrototypeRowsetCount(currentPositiveRowset),
    ) || 0,
  )
  const currentNegativeCount = Math.max(0, getPerfectPrototypeRowsetCount(currentNegativeRowset))
  const effectiveMinHitCount = Math.max(1, Number(familySearchMinHitCount ?? 1) || 1)
  const candidates = []
  const candidateAtomTypeCounts = {}
  for (
    let seedIndex = Math.max(0, Number(minCandidateSeedIndex ?? 0) || 0);
    seedIndex < Math.max(0, Number(selectedSeedCount ?? 0) || 0);
    seedIndex += 1
  ) {
    if (excludedSeedIndexSet.has(seedIndex)) continue
    if (ArrayBuffer.isView(seedPositiveCounts) || Array.isArray(seedPositiveCounts)) {
      const globalPositiveCount = Number(seedPositiveCounts[seedIndex] ?? 0) || 0
      if (globalPositiveCount < effectiveMinHitCount) {
        incrementReason(rejectReasonCounts, "below_effective_min_hit")
        continue
      }
    }
    const token = String(seedTokensOrdered[seedIndex] ?? "").trim()
    if (!token || currentTokenSet.has(token)) {
      incrementReason(rejectReasonCounts, "bundle_seed_invalid")
      continue
    }
    const atomType = classifyPerfectPrototypeSupportAtomType(token)
    if (typeof candidateTokenPredicate === "function") {
      const predicate = candidateTokenPredicate({ token, tokens, seedIndex })
      if (predicate && predicate.ok === false) {
        incrementReason(rejectReasonCounts, predicate.reason ?? "token_predicate_reject")
        continue
      }
    }
    const positivePostingRowset = await seedPostingCache.getSeedPositiveRowset(seedIndex)
    if (!positivePostingRowset || getPerfectPrototypeRowsetCount(positivePostingRowset) < 1) {
      incrementReason(rejectReasonCounts, "seed_rowset_unmaterialized")
      continue
    }
    const nextPositive = intersectRowsetsOwned({
      leftRowset: currentPositiveRowset,
      rightRowset: positivePostingRowset,
      rowCount,
      allowDense,
    })
    if (nextPositive.count < 1) {
      incrementReason(rejectReasonCounts, "empty_positive_cover")
      continue
    }
    const nextPositiveHitStats = computePositiveHitStats({
      rowIndexes: nextPositive.rowIndexes,
    })
    const nextPositiveEffectiveCount = Math.max(
      0,
      Number(nextPositiveHitStats?.cappedCount ?? nextPositive.count) || 0,
    )
    if (nextPositiveEffectiveCount < effectiveMinHitCount) {
      incrementReason(rejectReasonCounts, "below_effective_min_hit")
      continue
    }
    if (typeof evaluateBreadthFloor === "function") {
      const breadthFloor = evaluateBreadthFloor({
        hitStats: nextPositiveHitStats,
        generalizedSubgroupBreadthFloor,
      })
      if (breadthFloor?.ok === false) {
        incrementReason(rejectReasonCounts, breadthFloor.reason ?? "breadth_floor_conflict")
        continue
      }
    }
    const negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(seedIndex)
    const nextNegative =
      !negativePostingRowset || getPerfectPrototypeRowsetCount(negativePostingRowset) < 1
        ? buildEmptyNegativeCover({ rowCount, allowDense })
        : intersectRowsetsOwned({
            leftRowset: currentNegativeRowset,
            rightRowset: negativePostingRowset,
            rowCount,
            allowDense,
          })
    const nextHardNegative =
      !currentHardNegativeRowset || getPerfectPrototypeRowsetCount(currentHardNegativeRowset) < 1
        ? buildEmptyNegativeCover({ rowCount, allowDense })
        : !negativePostingRowset || getPerfectPrototypeRowsetCount(negativePostingRowset) < 1
          ? buildEmptyNegativeCover({ rowCount, allowDense })
          : intersectRowsetsOwned({
              leftRowset: currentHardNegativeRowset,
              rightRowset: negativePostingRowset,
              rowCount,
              allowDense,
            })
    const negativeEliminatedCount = Math.max(0, currentNegativeCount - nextNegative.count)
    if (currentNegativeCount > 0 && negativeEliminatedCount < 1) {
      incrementReason(rejectReasonCounts, "no_negative_elimination")
      continue
    }
    const hardNegativeEliminatedCount = Math.max(
      0,
      Math.max(0, Number(currentHardNegativeCount ?? 0) || 0) - nextHardNegative.count,
    )
    const positiveLossCount = Math.max(0, currentPositiveEffectiveCount - nextPositiveEffectiveCount)
    const score =
      hardNegativeEliminatedCount * Math.max(1, Number(hardNegativeWeight ?? 1) || 1) * 40000 +
      negativeEliminatedCount * 10000 -
      positiveLossCount * 750 +
      Number(nextPositiveHitStats?.distinctDateCount ?? 0) * 120 +
      Number(nextPositiveHitStats?.matchedMonthCount ?? 0) * 80 +
      Number(nextPositiveHitStats?.matchedFoldCount ?? 0) * 160 -
      safeRate(
        nextPositiveHitStats?.top1DateHitShare ?? 0,
        1,
      ) *
        25 +
      resolveAtomTypeBonus(atomType)
    incrementAtomType(candidateAtomTypeCounts, atomType)
    candidates.push({
      seedIndex,
      token,
      atomType,
      nextPositiveRowset: nextPositive.rowset,
      nextPositiveRowIndexes: nextPositive.rowIndexes,
      nextPositiveHitStats,
      nextPositiveEffectiveCount,
      nextNegativeRowset: nextNegative.rowset,
      nextNegativeRowIndexes: nextNegative.rowIndexes,
      nextNegativeCount: nextNegative.count,
      nextHardNegativeRowset: nextHardNegative.rowset,
      nextHardNegativeRowIndexes: nextHardNegative.rowIndexes,
      nextHardNegativeCount: nextHardNegative.count,
      hardNegativeEliminatedCount,
      negativeEliminatedCount,
      positiveLossCount,
      score,
    })
  }
  candidates.sort(compareCandidates)
  return {
    candidates: candidates.slice(0, Math.max(1, Number(maxCandidates ?? 24) || 24)),
    rejectReasonCounts,
    frontierNegativeCount: currentNegativeCount,
    candidateAtomTypeCounts,
  }
}
