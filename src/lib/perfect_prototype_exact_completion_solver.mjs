import {
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
} from "./perfect_prototype_rowset.mjs"
import { buildPerfectPrototypeExactCompletionCandidatePool } from "./perfect_prototype_exact_completion_candidate_pool.mjs"
import { decomposePerfectPrototypeExactCores } from "./perfect_prototype_exact_core_decomposer.mjs"
import { collectPerfectPrototypeCrossfitHardNegatives } from "./perfect_prototype_hard_negative_refinement.mjs"
import { countPerfectPrototypeAtomTypes } from "./perfect_prototype_support_anchor_cohort.mjs"

const incrementReason = (reasonCounts, reason) => {
  const key = String(reason ?? "").trim() || "unknown"
  reasonCounts[key] = Number(reasonCounts[key] ?? 0) + 1
}

const mergeReasonCounts = (target, source) => {
  for (const [reason, count] of Object.entries(source ?? {})) {
    target[reason] = Number(target[reason] ?? 0) + Number(count ?? 0)
  }
}

const mergeAtomTypeCounts = (target, source) => {
  for (const [atomType, count] of Object.entries(source ?? {})) {
    target[atomType] = Number(target[atomType] ?? 0) + Number(count ?? 0)
  }
}

const resolveUnsatReason = (rejectReasonCounts = {}) => {
  if (
    Number(rejectReasonCounts.breadth_floor_conflict ?? 0) > 0 ||
    Number(rejectReasonCounts.subgroupMatchedDatesBelowFloor ?? 0) > 0 ||
    Number(rejectReasonCounts.subgroupMatchedMonthsBelowFloor ?? 0) > 0 ||
    Number(rejectReasonCounts.subgroupMatchedFoldsBelowFloor ?? 0) > 0 ||
    Number(rejectReasonCounts.below_effective_min_hit ?? 0) > 0
  ) {
    return "unsat_breadth_retention"
  }
  if (Number(rejectReasonCounts.no_negative_elimination ?? 0) > 0) {
    return "unsat_negative_separation"
  }
  return "unsat_candidate_pool_empty"
}

const compareFrontierSolutions = (left, right) => {
  if (
    Number(left?.crossfitNegativeWindowCount ?? 0) !==
    Number(right?.crossfitNegativeWindowCount ?? 0)
  ) {
    return (
      Number(left?.crossfitNegativeWindowCount ?? 0) -
      Number(right?.crossfitNegativeWindowCount ?? 0)
    )
  }
  if (
    Number(right?.crossfitMatchedWindowCount ?? 0) !==
    Number(left?.crossfitMatchedWindowCount ?? 0)
  ) {
    return (
      Number(right?.crossfitMatchedWindowCount ?? 0) -
      Number(left?.crossfitMatchedWindowCount ?? 0)
    )
  }
  if (
    Number(right?.positiveHitStats?.distinctDateCount ?? 0) !==
    Number(left?.positiveHitStats?.distinctDateCount ?? 0)
  ) {
    return (
      Number(right?.positiveHitStats?.distinctDateCount ?? 0) -
      Number(left?.positiveHitStats?.distinctDateCount ?? 0)
    )
  }
  if (
    Number(right?.positiveHitStats?.matchedMonthCount ?? 0) !==
    Number(left?.positiveHitStats?.matchedMonthCount ?? 0)
  ) {
    return (
      Number(right?.positiveHitStats?.matchedMonthCount ?? 0) -
      Number(left?.positiveHitStats?.matchedMonthCount ?? 0)
    )
  }
  if (
    Number(right?.positiveHitStats?.matchedFoldCount ?? 0) !==
    Number(left?.positiveHitStats?.matchedFoldCount ?? 0)
  ) {
    return (
      Number(right?.positiveHitStats?.matchedFoldCount ?? 0) -
      Number(left?.positiveHitStats?.matchedFoldCount ?? 0)
    )
  }
  if (Number(left?.addedTokenCount ?? 0) !== Number(right?.addedTokenCount ?? 0)) {
    return Number(left?.addedTokenCount ?? 0) - Number(right?.addedTokenCount ?? 0)
  }
  return String(left?.coreId ?? "").localeCompare(String(right?.coreId ?? ""))
}

export const solvePerfectPrototypeExactCompletion = async ({
  familyId = null,
  manifest = null,
  entryState = null,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  generalizedSubgroupBreadthFloor = null,
  evaluateBreadthFloor = null,
  candidateTokenPredicate = null,
  maxRuleSize = 6,
  maxCandidates = 24,
  hardNegativeRowIndexes = null,
  hardNegativeRowset = null,
  hardNegativeWeight = 1,
} = {}) => {
  const initialTokens = Array.isArray(entryState?.entrySeedTokens) ? entryState.entrySeedTokens.slice() : []
  const initialSeedIndexes = Array.isArray(entryState?.entrySeedIndexes)
    ? entryState.entrySeedIndexes.filter((value) => Number.isInteger(value) && value >= 0)
    : []
  const initialNegativeCount = Math.max(0, getPerfectPrototypeRowsetCount(entryState?.negativeRowset))
  const initialHardNegativeRowIndexes =
    Array.isArray(hardNegativeRowIndexes) || ArrayBuffer.isView(hardNegativeRowIndexes)
      ? hardNegativeRowIndexes
      : Array.isArray(entryState?.hardNegativeRowIndexes) || ArrayBuffer.isView(entryState?.hardNegativeRowIndexes)
        ? entryState.hardNegativeRowIndexes
        : new Uint32Array()
  const initialHardNegativeRowset =
    hardNegativeRowset ??
    entryState?.hardNegativeRowset ??
    (Array.isArray(initialHardNegativeRowIndexes) || ArrayBuffer.isView(initialHardNegativeRowIndexes)
      ? createPerfectPrototypeRowset({
          values: initialHardNegativeRowIndexes,
          universeSize: rowCount,
          allowDense: true,
        })
      : null)
  const initialHardNegativeCount = Math.max(
    0,
    getPerfectPrototypeRowsetCount(initialHardNegativeRowset),
  )
  const maxAdditionalTokens = Math.max(0, Number(maxRuleSize ?? 0) - initialTokens.length)
  const unsatReasonCounts = {}
  const aggregatedCandidateRejectReasonCounts = {}
  let exploredStates = 0
  let maxCandidatePoolSize = 0
  let maxNegativeFrontierSize = initialNegativeCount
  const aggregatedCandidateAtomTypeCounts = {}
  const baseState = {
    tokens: initialTokens,
    seedIndexes: initialSeedIndexes,
    positiveRowset: entryState?.positiveRowset ?? null,
    positiveRowIndexes: entryState?.positiveRowIndexes ?? null,
    positiveHitStats: entryState?.positiveHitStats ?? null,
    negativeRowset: entryState?.negativeRowset ?? null,
    negativeRowIndexes: entryState?.negativeRowIndexes ?? null,
    hardNegativeRowset: initialHardNegativeRowset,
    hardNegativeRowIndexes: initialHardNegativeRowIndexes,
    hardNegativeCount: initialHardNegativeCount,
    minCandidateSeedIndex: 0,
  }

  const search = async (state, depth) => {
    exploredStates += 1
    const negativeCount = Math.max(0, getPerfectPrototypeRowsetCount(state?.negativeRowset))
    if (negativeCount < 1) {
      return state
    }
    if (depth >= maxAdditionalTokens) {
      incrementReason(unsatReasonCounts, "unsat_rule_size_limit")
      return null
    }
    const poolResult = await buildPerfectPrototypeExactCompletionCandidatePool({
      tokens: state.tokens,
      excludedSeedIndexes: new Set(state.seedIndexes),
      minCandidateSeedIndex: state.minCandidateSeedIndex,
      selectedSeedCount,
      seedTokensOrdered,
      seedPositiveCounts,
      seedPostingCache,
      currentPositiveRowset: state.positiveRowset,
      currentNegativeRowset: state.negativeRowset,
      currentHardNegativeRowset: state.hardNegativeRowset,
      currentHardNegativeCount: state.hardNegativeCount,
      currentPositiveHitStats: state.positiveHitStats,
      rowCount,
      computePositiveHitStats,
      familySearchMinHitCount,
      generalizedSubgroupBreadthFloor,
      evaluateBreadthFloor,
      candidateTokenPredicate,
      maxCandidates,
      hardNegativeWeight,
    })
    maxCandidatePoolSize = Math.max(maxCandidatePoolSize, poolResult.candidates.length)
    maxNegativeFrontierSize = Math.max(
      maxNegativeFrontierSize,
      Number(poolResult.frontierNegativeCount ?? negativeCount) || negativeCount,
    )
    mergeReasonCounts(aggregatedCandidateRejectReasonCounts, poolResult.rejectReasonCounts)
    mergeAtomTypeCounts(aggregatedCandidateAtomTypeCounts, poolResult.candidateAtomTypeCounts)
    if ((poolResult.candidates ?? []).length < 1) {
      incrementReason(unsatReasonCounts, resolveUnsatReason(poolResult.rejectReasonCounts))
      return null
    }
    for (const candidate of poolResult.candidates) {
      const solved = await search(
        {
          tokens: [...state.tokens, candidate.token],
          seedIndexes: [...state.seedIndexes, candidate.seedIndex],
          positiveRowset: candidate.nextPositiveRowset,
          positiveRowIndexes: candidate.nextPositiveRowIndexes,
          positiveHitStats: candidate.nextPositiveHitStats,
          negativeRowset: candidate.nextNegativeRowset,
          negativeRowIndexes: candidate.nextNegativeRowIndexes,
          hardNegativeRowset: candidate.nextHardNegativeRowset,
          hardNegativeRowIndexes: candidate.nextHardNegativeRowIndexes,
          hardNegativeCount: candidate.nextHardNegativeCount,
          minCandidateSeedIndex: candidate.seedIndex + 1,
        },
        depth + 1,
      )
      if (solved) return solved
    }
    incrementReason(unsatReasonCounts, "unsat_negative_separation")
    return null
  }

  const solvedState =
    initialNegativeCount < 1
      ? baseState
      : maxAdditionalTokens < 1
        ? null
        : await search(baseState, 0)

  if (!solvedState) {
    if (initialNegativeCount > 0 && Object.keys(unsatReasonCounts).length < 1) {
      incrementReason(unsatReasonCounts, "unsat_negative_separation")
    }
    return {
      ok: false,
      familyId: String(familyId ?? "").trim() || null,
      subgroupId: manifest?.subgroupId ?? null,
      exploredStates,
      unsatReasonCounts,
      candidateRejectReasonCounts: aggregatedCandidateRejectReasonCounts,
      candidateAtomTypeCounts: aggregatedCandidateAtomTypeCounts,
      candidatePoolSize: maxCandidatePoolSize,
      negativeFrontierSize: maxNegativeFrontierSize,
      hardNegativeAddedCount: initialHardNegativeCount,
      hardNegativeWeight: Math.max(1, Number(hardNegativeWeight ?? 1) || 1),
      reason:
        Object.entries(unsatReasonCounts).sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] ??
        "unsat_negative_separation",
    }
  }

  return {
    solutionAtomTypeCounts: countPerfectPrototypeAtomTypes(solvedState.tokens),
    ok: true,
    familyId: String(familyId ?? "").trim() || null,
    subgroupId: manifest?.subgroupId ?? null,
    exploredStates,
    candidatePoolSize: maxCandidatePoolSize,
    negativeFrontierSize: maxNegativeFrontierSize,
    tokens: solvedState.tokens,
    seedIndexes: solvedState.seedIndexes,
    positiveRowset: solvedState.positiveRowset,
    positiveRowIndexes: solvedState.positiveRowIndexes,
    positiveHitStats: solvedState.positiveHitStats,
    negativeRowset: solvedState.negativeRowset,
    negativeRowIndexes: solvedState.negativeRowIndexes,
    negativeCount: Math.max(0, getPerfectPrototypeRowsetCount(solvedState.negativeRowset)),
    addedTokenCount: Math.max(0, solvedState.tokens.length - initialTokens.length),
    hardNegativeAddedCount: initialHardNegativeCount,
    hardNegativeWeight: Math.max(1, Number(hardNegativeWeight ?? 1) || 1),
    candidateRejectReasonCounts: aggregatedCandidateRejectReasonCounts,
    candidateAtomTypeCounts: aggregatedCandidateAtomTypeCounts,
  }
}

export const solvePerfectPrototypeExactCompletionFrontier = async ({
  familyId = null,
  manifest = null,
  entryState = null,
  cfg = null,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  candidateTokenPredicate = null,
  maxRuleSize = 6,
  maxCandidates = 24,
  maxCores = 6,
  rowDateIndexes = null,
  calendarDateKeys = null,
  enableCrossfitHardNegativeRefinement = false,
  crossfitHoldoutWindows = 6,
  crossfitMinWindowSupport = 2,
  crossfitHardNegativeWeight = 1,
} = {}) => {
  const decomposition = await decomposePerfectPrototypeExactCores({
    familyId,
    manifest,
    entryState,
    cfg,
    selectedSeedCount,
    seedTokensOrdered,
    seedPositiveCounts,
    seedPostingCache,
    rowCount,
    computePositiveHitStats,
    familySearchMinHitCount,
    candidateTokenPredicate,
    maxCandidates,
    maxCores,
  })

  const exactCoreCandidateCount = Number(decomposition?.exactCoreCandidateCount ?? 0) || 0
  const exactCoreQualifiedCount = Number(decomposition?.exactCoreQualifiedCount ?? 0) || 0
  const exactCoreUnsatReasonCounts = {}
  const exactCoreRejectReasonCounts = {}
  mergeReasonCounts(
    exactCoreRejectReasonCounts,
    decomposition?.rejectReasonCounts ?? {},
  )
  let exploredStates = 0
  let exactCoreSolvedCount = 0
  let exactCoreUnsatCount = 0
  let maxCandidatePoolSize = Math.max(0, Number(decomposition?.candidatePoolSize ?? 0) || 0)
  let maxNegativeFrontierSize = Math.max(0, Number(decomposition?.negativeFrontierSize ?? 0) || 0)
  let bestRetainedDateCount = 0
  let bestRetainedMonthCount = 0
  let bestRetainedFoldCount = 0
  let crossfitWindowCount = 0
  let crossfitMatchedWindowCount = 0
  let crossfitNegativeWindowCount = 0
  let crossfitFalsePositiveRowCount = 0
  let hardNegativeAddedCount = 0
  let hardNegativeRefinedRuleCount = 0

  if (exactCoreQualifiedCount < 1) {
    return {
      ok: false,
      familyId: String(familyId ?? "").trim() || null,
      subgroupId: manifest?.subgroupId ?? null,
      reason: "no_exactable_cores",
      exploredStates,
      candidatePoolSize: maxCandidatePoolSize,
      negativeFrontierSize: maxNegativeFrontierSize,
      exactCoreCandidateCount,
      exactCoreQualifiedCount,
      exactCoreSolvedCount,
      exactCoreUnsatCount,
      exactCoreUnsatReasonCounts,
      exactCoreRejectReasonCounts,
      exactCoreFrontierBestRetainedDateCount: bestRetainedDateCount,
      exactCoreFrontierBestRetainedMonthCount: bestRetainedMonthCount,
      exactCoreFrontierBestRetainedFoldCount: bestRetainedFoldCount,
      crossfitWindowCount,
      crossfitMatchedWindowCount,
      crossfitNegativeWindowCount,
      crossfitFalsePositiveRowCount,
      hardNegativeAddedCount,
      hardNegativeRefinedRuleCount,
    }
  }

  const solvedOutcomes = []
  for (const core of decomposition.cores ?? []) {
    bestRetainedDateCount = Math.max(bestRetainedDateCount, Number(core?.entryMatchedDateCount ?? 0) || 0)
    bestRetainedMonthCount = Math.max(bestRetainedMonthCount, Number(core?.entryMatchedMonthCount ?? 0) || 0)
    bestRetainedFoldCount = Math.max(bestRetainedFoldCount, Number(core?.entryMatchedFoldCount ?? 0) || 0)
    const hardNegativeRefinement =
      enableCrossfitHardNegativeRefinement === true
        ? await collectPerfectPrototypeCrossfitHardNegatives({
            familyId,
            manifest,
            core,
            selectedSeedCount,
            seedTokensOrdered,
            seedPositiveCounts,
            seedPostingCache,
            rowCount,
            rowDateIndexes,
            calendarDateKeys,
            computePositiveHitStats,
            familySearchMinHitCount,
            candidateTokenPredicate,
            maxRuleSize,
            maxCandidates,
            windowCount: crossfitHoldoutWindows,
            minWindowSupport: crossfitMinWindowSupport,
            solveExactCompletion: async (solveArgs) =>
              solvePerfectPrototypeExactCompletion({
                ...solveArgs,
                hardNegativeWeight: Math.max(1, Number(crossfitHardNegativeWeight ?? 1) || 1),
              }),
          })
        : null
    crossfitWindowCount += Math.max(0, Number(hardNegativeRefinement?.crossfitWindowCount ?? 0) || 0)
    crossfitMatchedWindowCount +=
      Math.max(0, Number(hardNegativeRefinement?.crossfitMatchedWindowCount ?? 0) || 0)
    crossfitNegativeWindowCount +=
      Math.max(0, Number(hardNegativeRefinement?.crossfitNegativeWindowCount ?? 0) || 0)
    crossfitFalsePositiveRowCount +=
      Math.max(0, Number(hardNegativeRefinement?.crossfitFalsePositiveRowCount ?? 0) || 0)
    hardNegativeAddedCount +=
      Math.max(0, Number(hardNegativeRefinement?.hardNegativeAddedCount ?? 0) || 0)
    const completionOutcome = await solvePerfectPrototypeExactCompletion({
      familyId,
      manifest,
      entryState: {
        entrySeedTokens: Array.isArray(core?.entrySeedTokens) ? core.entrySeedTokens : [],
        entrySeedIndexes: Array.isArray(core?.entrySeedIndexes) ? core.entrySeedIndexes : [],
        positiveRowset: core?.positiveRowset ?? null,
        positiveRowIndexes: core?.positiveRowIndexes ?? null,
        positiveHitStats: core?.positiveHitStats ?? null,
        negativeRowset: core?.negativeRowset ?? null,
        negativeRowIndexes: core?.negativeRowIndexes ?? null,
      },
      selectedSeedCount,
      seedTokensOrdered,
      seedPositiveCounts,
      seedPostingCache,
      rowCount,
      computePositiveHitStats,
      familySearchMinHitCount,
      generalizedSubgroupBreadthFloor: core?.entryBreadthFloor ?? null,
      evaluateBreadthFloor: ({ hitStats, generalizedSubgroupBreadthFloor }) => {
        const minMatchedDates = Math.max(
          1,
          Number(generalizedSubgroupBreadthFloor?.minMatchedDates ?? 1) || 1,
        )
        const minMatchedMonths = Math.max(
          1,
          Number(generalizedSubgroupBreadthFloor?.minMatchedMonths ?? 1) || 1,
        )
        const minMatchedFolds = Math.max(
          1,
          Number(generalizedSubgroupBreadthFloor?.minMatchedFolds ?? 1) || 1,
        )
        if (Number(hitStats?.distinctDateCount ?? 0) < minMatchedDates) {
          return { ok: false, reason: "exact_core_dates_below_floor" }
        }
        if (Number(hitStats?.matchedMonthCount ?? 0) < minMatchedMonths) {
          return { ok: false, reason: "exact_core_months_below_floor" }
        }
        if (Number(hitStats?.matchedFoldCount ?? 0) < minMatchedFolds) {
          return { ok: false, reason: "exact_core_folds_below_floor" }
        }
        return { ok: true }
      },
      candidateTokenPredicate,
      maxRuleSize,
      maxCandidates,
      hardNegativeRowIndexes: hardNegativeRefinement?.hardNegativeRowIndexes ?? null,
      hardNegativeWeight: Math.max(1, Number(crossfitHardNegativeWeight ?? 1) || 1),
    })
    exploredStates += Math.max(0, Number(completionOutcome?.exploredStates ?? 0) || 0)
    maxCandidatePoolSize = Math.max(maxCandidatePoolSize, Number(completionOutcome?.candidatePoolSize ?? 0) || 0)
    maxNegativeFrontierSize = Math.max(
      maxNegativeFrontierSize,
      Number(completionOutcome?.negativeFrontierSize ?? 0) || 0,
    )
    if (!completionOutcome?.ok) {
      exactCoreUnsatCount += 1
      incrementReason(exactCoreUnsatReasonCounts, completionOutcome?.reason ?? "no_core_frontier_solutions")
      mergeReasonCounts(exactCoreRejectReasonCounts, completionOutcome?.candidateRejectReasonCounts ?? {})
      continue
    }
    exactCoreSolvedCount += 1
    if (Number(hardNegativeRefinement?.hardNegativeAddedCount ?? 0) > 0) {
      hardNegativeRefinedRuleCount += 1
    }
    solvedOutcomes.push({
      ...completionOutcome,
      coreId: core?.coreId ?? null,
      coreSeedToken: core?.seedToken ?? null,
      coreRetainedDateCount: Number(core?.entryMatchedDateCount ?? 0) || 0,
      coreRetainedMonthCount: Number(core?.entryMatchedMonthCount ?? 0) || 0,
      coreRetainedFoldCount: Number(core?.entryMatchedFoldCount ?? 0) || 0,
      crossfitWindowCount: Number(hardNegativeRefinement?.crossfitWindowCount ?? 0) || 0,
      crossfitMatchedWindowCount:
        Number(hardNegativeRefinement?.crossfitMatchedWindowCount ?? 0) || 0,
      crossfitNegativeWindowCount:
        Number(hardNegativeRefinement?.crossfitNegativeWindowCount ?? 0) || 0,
      crossfitFalsePositiveRowCount:
        Number(hardNegativeRefinement?.crossfitFalsePositiveRowCount ?? 0) || 0,
      hardNegativeAddedCount:
        Number(hardNegativeRefinement?.hardNegativeAddedCount ?? 0) || 0,
      hardNegativeRefined:
        Number(hardNegativeRefinement?.hardNegativeAddedCount ?? 0) > 0,
      postRefineTrainMatchedDateCount:
        Number(completionOutcome?.positiveHitStats?.distinctDateCount ?? 0) || 0,
      postRefineTrainMatchedMonthCount:
        Number(completionOutcome?.positiveHitStats?.matchedMonthCount ?? 0) || 0,
      postRefineTrainMatchedFoldCount:
        Number(completionOutcome?.positiveHitStats?.matchedFoldCount ?? 0) || 0,
    })
  }

  if (solvedOutcomes.length < 1) {
    return {
      ok: false,
      familyId: String(familyId ?? "").trim() || null,
      subgroupId: manifest?.subgroupId ?? null,
      reason: "no_core_frontier_solutions",
      exploredStates,
      candidatePoolSize: maxCandidatePoolSize,
      negativeFrontierSize: maxNegativeFrontierSize,
      exactCoreCandidateCount,
      exactCoreQualifiedCount,
      exactCoreSolvedCount,
      exactCoreUnsatCount,
      exactCoreUnsatReasonCounts,
      exactCoreRejectReasonCounts,
      exactCoreFrontierBestRetainedDateCount: bestRetainedDateCount,
      exactCoreFrontierBestRetainedMonthCount: bestRetainedMonthCount,
      exactCoreFrontierBestRetainedFoldCount: bestRetainedFoldCount,
      crossfitWindowCount,
      crossfitMatchedWindowCount,
      crossfitNegativeWindowCount,
      crossfitFalsePositiveRowCount,
      hardNegativeAddedCount,
      hardNegativeRefinedRuleCount,
    }
  }

  solvedOutcomes.sort(compareFrontierSolutions)
  const bestOutcome = solvedOutcomes[0]
  bestRetainedDateCount = Math.max(
    bestRetainedDateCount,
    Number(bestOutcome?.positiveHitStats?.distinctDateCount ?? bestOutcome?.coreRetainedDateCount ?? 0) || 0,
  )
  bestRetainedMonthCount = Math.max(
    bestRetainedMonthCount,
    Number(bestOutcome?.positiveHitStats?.matchedMonthCount ?? bestOutcome?.coreRetainedMonthCount ?? 0) || 0,
  )
  bestRetainedFoldCount = Math.max(
    bestRetainedFoldCount,
    Number(bestOutcome?.positiveHitStats?.matchedFoldCount ?? bestOutcome?.coreRetainedFoldCount ?? 0) || 0,
  )

  return {
    ...bestOutcome,
    ok: true,
    reason: null,
    exactCoreCandidateCount,
    exactCoreQualifiedCount,
    exactCoreSolvedCount,
    exactCoreUnsatCount,
    exactCoreUnsatReasonCounts,
    exactCoreRejectReasonCounts,
    exactCoreFrontierBestRetainedDateCount: bestRetainedDateCount,
    exactCoreFrontierBestRetainedMonthCount: bestRetainedMonthCount,
    exactCoreFrontierBestRetainedFoldCount: bestRetainedFoldCount,
    candidatePoolSize: maxCandidatePoolSize,
    negativeFrontierSize: maxNegativeFrontierSize,
    exploredStates,
    crossfitWindowCount,
    crossfitMatchedWindowCount,
    crossfitNegativeWindowCount,
    crossfitFalsePositiveRowCount,
    hardNegativeAddedCount,
    hardNegativeRefinedRuleCount,
  }
}
