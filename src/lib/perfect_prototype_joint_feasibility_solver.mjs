import { decomposePerfectPrototypeExactCores } from "./perfect_prototype_exact_core_decomposer.mjs"
import { solvePerfectPrototypeExactCompletion } from "./perfect_prototype_exact_completion_solver.mjs"
import { collectPerfectPrototypeCrossfitHardNegatives } from "./perfect_prototype_hard_negative_refinement.mjs"
import {
  buildPerfectPrototypeJointFeasibilityBounds,
  evaluatePerfectPrototypeJointFeasibilityBounds,
} from "./perfect_prototype_joint_feasibility_bounds.mjs"
import {
  buildPerfectPrototypeJointUnsatCertificate,
  recordPerfectPrototypeJointUnsatReasons,
} from "./perfect_prototype_joint_unsat_certificate.mjs"
import {
  resolvePerfectPrototypeHistoricalSupportContract,
} from "./perfect_prototype_historical_support_contract.mjs"

const mergeReasonCounts = (target, source) => {
  for (const [reason, count] of Object.entries(source ?? {})) {
    target[reason] = Number(target[reason] ?? 0) + Number(count ?? 0)
  }
}

const compareJointSolutions = (left, right) => {
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
    Number(left?.addedTokenCount ?? 0) !==
    Number(right?.addedTokenCount ?? 0)
  ) {
    return Number(left?.addedTokenCount ?? 0) - Number(right?.addedTokenCount ?? 0)
  }
  return String(left?.coreId ?? "").localeCompare(String(right?.coreId ?? ""))
}

export const solvePerfectPrototypeJointFeasibility = async ({
  familyId = null,
  manifest = null,
  entryState = null,
  cfg = null,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  rowCount,
  rowDateIndexes = null,
  calendarDateKeys = null,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  candidateTokenPredicate = null,
  maxRuleSize = 6,
  maxCandidates = 24,
  maxCores = 6,
  supportCases = [],
} = {}) => {
  const jointBounds = buildPerfectPrototypeJointFeasibilityBounds({
    cfg,
    familyId,
  })
  const supportContract = resolvePerfectPrototypeHistoricalSupportContract({
    familyId,
    supportCases,
    requiredSupportCaseIds: jointBounds.historicalSupportCaseIds,
    requireHistoricalSupport: jointBounds.requireHistoricalSupport,
  })
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
  const jointUnsatReasonCounts = {}
  const jointRejectReasonCounts = {}
  mergeReasonCounts(jointRejectReasonCounts, decomposition?.rejectReasonCounts ?? {})
  let exploredStates = 0
  let jointHistoricalSupportMatchedCount = 0
  let jointCrossfitRetainedPositiveWindowCount = 0
  let jointCrossfitNegativeWindowCount = 0
  let hardNegativeAddedCount = 0
  const candidateAtomTypeCounts = {}
  const solvedOutcomes = []
  if (Number(decomposition?.exactCoreQualifiedCount ?? 0) < 1) {
    recordPerfectPrototypeJointUnsatReasons(jointUnsatReasonCounts, ["no_exactable_cores"])
    const certificate = buildPerfectPrototypeJointUnsatCertificate({
      familyId,
      subgroupId: manifest?.subgroupId ?? null,
      reasonCounts: jointUnsatReasonCounts,
    })
    return {
      ok: false,
      familyId: certificate.familyId,
      subgroupId: certificate.subgroupId,
      reason: certificate.primaryReason,
      jointFeasibilityManifestCount: 1,
      jointFeasibilitySolvedCount: 0,
      jointFeasibilityUnsatCount: 1,
      jointFeasibilityUnsatReasonCounts: certificate.reasonCounts,
      jointHistoricalSupportMatchedCount: 0,
      jointCrossfitRetainedPositiveWindowCount: 0,
      jointCrossfitNegativeWindowCount: 0,
      candidateRejectReasonCounts: jointRejectReasonCounts,
      exactCoreCandidateCount: Number(decomposition?.exactCoreCandidateCount ?? 0) || 0,
      exactCoreQualifiedCount: Number(decomposition?.exactCoreQualifiedCount ?? 0) || 0,
      exactCoreSolvedCount: 0,
      exactCoreUnsatCount: 0,
      exactCoreUnsatReasonCounts: {},
      exploredStates: 0,
      candidatePoolSize: Number(decomposition?.candidatePoolSize ?? 0) || 0,
      negativeFrontierSize: Number(decomposition?.negativeFrontierSize ?? 0) || 0,
      hardNegativeAddedCount: 0,
      candidateAtomTypeCounts,
    }
  }

  for (const core of decomposition.cores ?? []) {
    const coreSupportCheck = evaluatePerfectPrototypeJointFeasibilityBounds({
      familyId,
      tokens: core?.entrySeedTokens ?? [],
      positiveHitStats: core?.positiveHitStats ?? null,
      crossfitMatchedWindowCount: jointBounds.minCrossfitRetainedPositiveWindows,
      crossfitNegativeWindowCount: 0,
      supportCases,
      bounds: {
        ...jointBounds,
        minCrossfitRetainedPositiveWindows: 0,
      },
    })
    if (
      jointBounds.requireHistoricalSupport === true &&
      coreSupportCheck.historicalSupportMatched !== true
    ) {
      recordPerfectPrototypeJointUnsatReasons(
        jointUnsatReasonCounts,
        [coreSupportCheck.reasons?.includes("unsat_historical_support") ? "unsat_historical_support" : "unsat_historical_support"],
      )
      continue
    }

    const historicalTokenSet = supportContract.tokenSet
    const jointCandidatePredicate = ({ token, tokens, seedIndex }) => {
      if (
        jointBounds.requireHistoricalSupport === true &&
        historicalTokenSet instanceof Set &&
        historicalTokenSet.size > 0 &&
        !historicalTokenSet.has(token)
      ) {
        return { ok: false, reason: "unsat_historical_support" }
      }
      if (typeof candidateTokenPredicate === "function") {
        return candidateTokenPredicate({ token, tokens, seedIndex })
      }
      return { ok: true }
    }

    const hardNegativeRefinement =
      cfg?.enableCrossfitHardNegativeRefinement === true
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
            candidateTokenPredicate: jointCandidatePredicate,
            maxRuleSize,
            maxCandidates,
            windowCount: Math.max(1, Number(cfg?.crossfitHoldoutWindows ?? 6) || 6),
            minWindowSupport: Math.max(1, Number(cfg?.crossfitMinWindowSupport ?? 2) || 2),
            solveExactCompletion: async (solveArgs) =>
              solvePerfectPrototypeExactCompletion({
                ...solveArgs,
                candidateTokenPredicate: jointCandidatePredicate,
                hardNegativeWeight: Math.max(
                  1,
                  Number(cfg?.crossfitHardNegativeWeight ?? 1) || 1,
                ),
              }),
          })
        : null
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
      candidateTokenPredicate: jointCandidatePredicate,
      maxRuleSize,
      maxCandidates,
      hardNegativeRowIndexes: hardNegativeRefinement?.hardNegativeRowIndexes ?? null,
      hardNegativeWeight: Math.max(
        1,
        Number(cfg?.crossfitHardNegativeWeight ?? 1) || 1,
      ),
    })
    exploredStates += Math.max(0, Number(completionOutcome?.exploredStates ?? 0) || 0)
    mergeReasonCounts(candidateAtomTypeCounts, completionOutcome?.candidateAtomTypeCounts ?? {})
    if (!completionOutcome?.ok) {
      recordPerfectPrototypeJointUnsatReasons(jointUnsatReasonCounts, [
        completionOutcome?.reason ?? "no_joint_feasible_rules",
      ])
      mergeReasonCounts(jointRejectReasonCounts, completionOutcome?.candidateRejectReasonCounts ?? {})
      continue
    }
    const jointEvaluation = evaluatePerfectPrototypeJointFeasibilityBounds({
      familyId,
      tokens: completionOutcome?.tokens ?? core?.entrySeedTokens ?? [],
      positiveHitStats: completionOutcome?.positiveHitStats ?? null,
      crossfitMatchedWindowCount: Number(
        hardNegativeRefinement?.crossfitMatchedWindowCount ?? 0,
      ) || 0,
      crossfitNegativeWindowCount: Number(
        hardNegativeRefinement?.crossfitNegativeWindowCount ?? 0,
      ) || 0,
      supportCases,
      bounds: jointBounds,
    })
    jointCrossfitRetainedPositiveWindowCount = Math.max(
      jointCrossfitRetainedPositiveWindowCount,
      Number(jointEvaluation.crossfitRetainedPositiveWindowCount ?? 0) || 0,
    )
    jointCrossfitNegativeWindowCount = Math.max(
      jointCrossfitNegativeWindowCount,
      Number(jointEvaluation.crossfitNegativeWindowCount ?? 0) || 0,
    )
    if (jointEvaluation.historicalSupportMatched === true) {
      jointHistoricalSupportMatchedCount += 1
    }
    if (jointEvaluation.ok !== true) {
      recordPerfectPrototypeJointUnsatReasons(
        jointUnsatReasonCounts,
        jointEvaluation.reasons ?? ["no_joint_feasible_rules"],
      )
      continue
    }
    solvedOutcomes.push({
      ...completionOutcome,
      coreId: core?.coreId ?? null,
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
      jointFeasibilitySolved: true,
      jointUnsatReason: null,
      jointHistoricalSupportMatched: jointEvaluation.historicalSupportMatched === true,
      jointHistoricalSupportCaseIds: jointEvaluation.historicalSupportCaseIds ?? [],
      jointCrossfitRetainedPositiveWindowCount:
        Number(jointEvaluation.crossfitRetainedPositiveWindowCount ?? 0) || 0,
      jointCrossfitNegativeWindowCount:
        Number(jointEvaluation.crossfitNegativeWindowCount ?? 0) || 0,
      candidateAtomTypeCounts:
        completionOutcome?.candidateAtomTypeCounts &&
        typeof completionOutcome.candidateAtomTypeCounts === "object"
          ? { ...completionOutcome.candidateAtomTypeCounts }
          : {},
      solutionAtomTypeCounts:
        completionOutcome?.solutionAtomTypeCounts &&
        typeof completionOutcome.solutionAtomTypeCounts === "object"
          ? { ...completionOutcome.solutionAtomTypeCounts }
          : {},
      supportSignatureAtomCount:
        Number(completionOutcome?.solutionAtomTypeCounts?.support_signature ?? 0) || 0,
      adaptiveThresholdAtomCount:
        Number(completionOutcome?.solutionAtomTypeCounts?.adaptive_threshold ?? 0) || 0,
      intervalAtomCount: Number(completionOutcome?.solutionAtomTypeCounts?.interval ?? 0) || 0,
      macroAtomCount: Number(completionOutcome?.solutionAtomTypeCounts?.macro ?? 0) || 0,
      supportAnchorAtomCount:
        Number(completionOutcome?.solutionAtomTypeCounts?.support_anchor ?? 0) || 0,
    })
  }

  if (solvedOutcomes.length < 1) {
    recordPerfectPrototypeJointUnsatReasons(jointUnsatReasonCounts, ["no_joint_feasible_rules"])
    const certificate = buildPerfectPrototypeJointUnsatCertificate({
      familyId,
      subgroupId: manifest?.subgroupId ?? null,
      reasonCounts: jointUnsatReasonCounts,
    })
    return {
      ok: false,
      familyId: certificate.familyId,
      subgroupId: certificate.subgroupId,
      reason: certificate.primaryReason,
      jointFeasibilityManifestCount: 1,
      jointFeasibilitySolvedCount: 0,
      jointFeasibilityUnsatCount: 1,
      jointFeasibilityUnsatReasonCounts: certificate.reasonCounts,
      jointHistoricalSupportMatchedCount,
      jointCrossfitRetainedPositiveWindowCount,
      jointCrossfitNegativeWindowCount,
      candidateRejectReasonCounts: jointRejectReasonCounts,
      exactCoreCandidateCount: Number(decomposition?.exactCoreCandidateCount ?? 0) || 0,
      exactCoreQualifiedCount: Number(decomposition?.exactCoreQualifiedCount ?? 0) || 0,
      exactCoreSolvedCount: 0,
      exactCoreUnsatCount: 0,
      exactCoreUnsatReasonCounts: {},
      exploredStates,
      candidatePoolSize: Number(decomposition?.candidatePoolSize ?? 0) || 0,
      negativeFrontierSize: Number(decomposition?.negativeFrontierSize ?? 0) || 0,
      hardNegativeAddedCount,
      candidateAtomTypeCounts,
    }
  }

  solvedOutcomes.sort(compareJointSolutions)
  const bestOutcome = solvedOutcomes[0]
  return {
    ...bestOutcome,
    ok: true,
    reason: null,
    jointFeasibilityManifestCount: 1,
    jointFeasibilitySolvedCount: solvedOutcomes.length,
    jointFeasibilityUnsatCount: 0,
    jointFeasibilityUnsatReasonCounts: jointUnsatReasonCounts,
    jointHistoricalSupportMatchedCount,
    jointCrossfitRetainedPositiveWindowCount,
    jointCrossfitNegativeWindowCount,
    exploredStates,
    hardNegativeAddedCount,
    candidateAtomTypeCounts:
      bestOutcome?.candidateAtomTypeCounts &&
      typeof bestOutcome.candidateAtomTypeCounts === "object"
        ? { ...bestOutcome.candidateAtomTypeCounts }
        : { ...candidateAtomTypeCounts },
    exactCoreCandidateCount: Number(decomposition?.exactCoreCandidateCount ?? 0) || 0,
    exactCoreQualifiedCount: Number(decomposition?.exactCoreQualifiedCount ?? 0) || 0,
    exactCoreSolvedCount: solvedOutcomes.length,
    exactCoreUnsatCount: Math.max(
      0,
      Number(decomposition?.exactCoreQualifiedCount ?? 0) - solvedOutcomes.length,
    ),
    exactCoreUnsatReasonCounts: {},
  }
}
