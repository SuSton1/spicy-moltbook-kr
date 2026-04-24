import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportBoundaryLocalExpert,
  summarizePerfectPrototypeSupportBoundaryLocalExpertSelections,
} from "./perfect_prototype_support_boundary_local_expert.mjs"
import { buildPerfectPrototypeSupportBoundaryExpertUnsat } from "./perfect_prototype_support_boundary_expert_unsat.mjs"
import { buildPerfectPrototypeSupportExpertComplementFrontier } from "./perfect_prototype_support_expert_complement_frontier.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildCombinationIndexes = (count, choose) => {
  const out = []
  const recurse = (start, remaining, picked) => {
    if (remaining === 0) {
      out.push(picked.slice())
      return
    }
    for (let index = start; index <= count - remaining; index += 1) {
      picked.push(index)
      recurse(index + 1, remaining - 1, picked)
      picked.pop()
    }
  }
  recurse(0, choose, [])
  return out
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_expert_union_train_breadth"

const rowUnionKey = (row) =>
  [
    String(row?.rowKey ?? "").trim(),
    String(row?.caseId ?? "").trim(),
    String(row?.dateKey ?? "").trim(),
    String(row?.symbol ?? "").trim(),
  ]
    .filter(Boolean)
    .join("::")

const summarizeUnion = ({ experts = [], rows = [], supportCaseIds = [] } = {}) => {
  const selectedMap = new Map()
  for (const expert of Array.isArray(experts) ? experts : []) {
    for (const evaluation of applyPerfectPrototypeSupportBoundaryLocalExpert({
      artifact: expert?.artifact,
      rows,
    })) {
      if (evaluation?.selected !== true) continue
      const key = rowUnionKey(evaluation.row)
      if (!key) continue
      selectedMap.set(key, { row: evaluation.row, selected: true })
    }
  }
  return summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
    evaluations: Array.from(selectedMap.values()),
    supportCaseIds,
  })
}

const collectSupportMatched = ({ experts = [], supportCaseViews = [] } = {}) => {
  const matched = new Set()
  for (const expert of Array.isArray(experts) ? experts : []) {
    for (const evaluation of applyPerfectPrototypeSupportBoundaryLocalExpert({
      artifact: expert?.artifact,
      rows: supportCaseViews,
    })) {
      if (evaluation?.selected === true && evaluation?.row?.caseId) matched.add(evaluation.row.caseId)
    }
  }
  return Array.from(matched).sort((left, right) => left.localeCompare(right))
}

const buildCandidatePreview = (candidate) => ({
  unionExpertIds: candidate?.unionExpertIds ?? [],
  expertCount: Number(candidate?.expertCount ?? 0),
  failureReason: candidate?.failureReason ?? null,
  supportMatched: candidate?.supportMatched ?? [],
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

const compareSolutions = (left, right) => {
  if (
    toNumber(right?.oosSummary?.positiveRowCount, 0) !==
    toNumber(left?.oosSummary?.positiveRowCount, 0)
  ) {
    return toNumber(right?.oosSummary?.positiveRowCount, 0) - toNumber(left?.oosSummary?.positiveRowCount, 0)
  }
  if (
    toNumber(right?.trainSummary?.trainMatchedDateCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedDateCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
    )
  }
  return Number(left?.expertCount ?? 0) - Number(right?.expertCount ?? 0)
}

export const solvePerfectPrototypeSupportBoundaryExpertUnion = ({
  family,
  groupDataset,
  localExpertCalibration,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
  maxExpertCount = 3,
  maxExpertsToSearch = 8,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  const qualifiedExperts = Array.isArray(localExpertCalibration?.qualifiedExperts)
    ? localExpertCalibration.qualifiedExperts
    : []
  const frontier = buildPerfectPrototypeSupportExpertComplementFrontier({
    experts: qualifiedExperts,
    maxExperts: Math.max(1, Math.floor(Number(maxExpertsToSearch) || 8)),
  })
  const experts = frontier.frontierExperts
  if (supportFitExcluded !== true) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: "unsat_support_acceptance_only_dependency",
      reasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      localExpertCandidateCount: localExpertCalibration?.localExpertCandidateCount,
      localExpertQualifiedCount: localExpertCalibration?.localExpertQualifiedCount,
      qualifiedExpertDistinctMatchedDateSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedDateSignatureCount,
      qualifiedExpertDistinctMatchedMonthSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedMonthSignatureCount,
      qualifiedExpertDistinctMatchedFoldSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedFoldSignatureCount,
      supportFitExcluded,
    })
  }
  if (experts.length < 1) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: "unsat_no_local_experts",
      reasonCounts: { unsat_no_local_experts: 1 },
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      localExpertCandidateCount: localExpertCalibration?.localExpertCandidateCount,
      localExpertQualifiedCount: localExpertCalibration?.localExpertQualifiedCount,
      qualifiedExpertDistinctMatchedDateSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedDateSignatureCount,
      qualifiedExpertDistinctMatchedMonthSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedMonthSignatureCount,
      qualifiedExpertDistinctMatchedFoldSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedFoldSignatureCount,
      coverageFrontierCandidateCount: frontier.coverageFrontierCandidateCount,
      coverageFrontierQualifiedCount: frontier.coverageFrontierQualifiedCount,
      distinctMatchedDateSignatureCount: frontier.distinctMatchedDateSignatureCount,
      distinctMatchedMonthSignatureCount: frontier.distinctMatchedMonthSignatureCount,
      distinctMatchedFoldSignatureCount: frontier.distinctMatchedFoldSignatureCount,
      supportFitExcluded,
      candidatesEvaluated: [...frontier.candidatesEvaluated, ...(localExpertCalibration?.candidatesEvaluated ?? [])].slice(0, 256),
    })
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  let expertUnionCandidateCount = 0
  let expertUnionQualifiedCount = 0
  let supportLeaveOneOutRecovered = false
  let bestTrainSummary = localExpertCalibration?.bestTrainSummary ?? null
  let bestOosSummary = localExpertCalibration?.bestOosSummary ?? null
  let bestSolution = null
  const bestSingleExpertTrainDateCount = Math.max(
    0,
    ...qualifiedExperts.map((expert) => toNumber(expert?.trainSummary?.trainMatchedDateCount, 0)),
  )
  const bestSingleExpertTrainMonthCount = Math.max(
    0,
    ...qualifiedExperts.map((expert) => toNumber(expert?.trainSummary?.trainMatchedMonthCount, 0)),
  )
  const bestSingleExpertTrainFoldCount = Math.max(
    0,
    ...qualifiedExperts.map((expert) => toNumber(expert?.trainSummary?.trainMatchedFoldCount, 0)),
  )
  let bestUnionDateGainOverBestSingleExpert = 0
  let bestUnionMonthGainOverBestSingleExpert = 0
  let bestUnionFoldGainOverBestSingleExpert = 0

  const expertCountMax = Math.min(Math.max(1, Math.floor(Number(maxExpertCount) || 3)), experts.length)
  for (let expertCount = 1; expertCount <= expertCountMax; expertCount += 1) {
    for (const indexes of buildCombinationIndexes(experts.length, expertCount)) {
      expertUnionCandidateCount += 1
      const selectedExperts = indexes.map((index) => experts[index])
      const unionExpertIds = selectedExperts.map((expert) => expert?.expertId).filter(Boolean)
      const trainSummary = summarizeUnion({
        experts: selectedExperts,
        rows: family?.gatedTrainRows ?? [],
      })
      const candidate = {
        unionExpertIds,
        expertCount,
        trainSummary,
        supportMatched: [],
        oosSummary: null,
        failureReason: null,
      }
      const dateGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedDateCount, 0) - bestSingleExpertTrainDateCount,
      )
      const monthGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedMonthCount, 0) - bestSingleExpertTrainMonthCount,
      )
      const foldGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedFoldCount, 0) - bestSingleExpertTrainFoldCount,
      )
      bestUnionDateGainOverBestSingleExpert = Math.max(bestUnionDateGainOverBestSingleExpert, dateGain)
      bestUnionMonthGainOverBestSingleExpert = Math.max(bestUnionMonthGainOverBestSingleExpert, monthGain)
      bestUnionFoldGainOverBestSingleExpert = Math.max(bestUnionFoldGainOverBestSingleExpert, foldGain)

      if (toNumber(trainSummary.precision, 0) < 1) {
        candidate.failureReason = "unsat_expert_union_train_precision"
      } else if (
        expertCount > 1 &&
        dateGain < 1 &&
        monthGain < 1 &&
        foldGain < 1 &&
        toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates
      ) {
        candidate.failureReason = "unsat_expert_union_no_complement_gain"
      } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
        candidate.failureReason = "unsat_expert_union_train_breadth"
      } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
        candidate.failureReason = "unsat_expert_union_train_breadth"
      } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
        candidate.failureReason = "unsat_expert_union_train_breadth"
      } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
        candidate.failureReason = "unsat_expert_union_crossfit_recurrence"
      } else if (
        toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
      ) {
        candidate.failureReason = "unsat_expert_union_crossfit_recurrence"
      }

      if (!candidate.failureReason) {
        candidate.supportMatched = collectSupportMatched({
          experts: selectedExperts,
          supportCaseViews: family?.supportCaseViews ?? [],
        })
        if (candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
          supportLeaveOneOutRecovered = true
        } else {
          candidate.failureReason = "unsat_support_recovery_after_leave_one_out"
        }
      }

      if (!candidate.failureReason) {
        candidate.oosSummary = summarizeUnion({
          experts: selectedExperts,
          rows: family?.oosRows ?? [],
          supportCaseIds: candidate.supportMatched,
        })
        if (toNumber(candidate.oosSummary.selectedRowCount, 0) < minOosMatchCount) {
          candidate.failureReason = "unsat_expert_union_oos_zero_match"
        } else if (toNumber(candidate.oosSummary.precision, 0) < 1) {
          candidate.failureReason = "unsat_expert_union_oos_precision"
        }
      }

      if (candidatesEvaluated.length < 256) {
        candidatesEvaluated.push(buildCandidatePreview(candidate))
      }
      if (candidate.failureReason) {
        recordReason(reasonCounts, candidate.failureReason)
        if (
          !bestTrainSummary ||
          toNumber(candidate.trainSummary?.trainMatchedDateCount, 0) >
            toNumber(bestTrainSummary?.trainMatchedDateCount, 0)
        ) {
          bestTrainSummary = candidate.trainSummary
        }
        if (
          candidate.oosSummary &&
          (!bestOosSummary ||
            toNumber(candidate.oosSummary?.positiveRowCount, 0) >
              toNumber(bestOosSummary?.positiveRowCount, 0))
        ) {
          bestOosSummary = candidate.oosSummary
        }
        continue
      }

      expertUnionQualifiedCount += 1
      if (!bestSolution || compareSolutions(candidate, bestSolution) < 0) {
        bestSolution = {
          ...candidate,
          selectedExperts,
        }
      }
    }
  }

  if (!bestSolution) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: derivePrimaryReason(reasonCounts),
      reasonCounts,
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      localExpertCandidateCount: localExpertCalibration?.localExpertCandidateCount,
      localExpertQualifiedCount: localExpertCalibration?.localExpertQualifiedCount,
      qualifiedExpertDistinctMatchedDateSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedDateSignatureCount,
      qualifiedExpertDistinctMatchedMonthSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedMonthSignatureCount,
      qualifiedExpertDistinctMatchedFoldSignatureCount:
        localExpertCalibration?.qualifiedExpertDistinctMatchedFoldSignatureCount,
      expertUnionCandidateCount,
      expertUnionQualifiedCount,
      coverageFrontierCandidateCount: frontier.coverageFrontierCandidateCount,
      coverageFrontierQualifiedCount: frontier.coverageFrontierQualifiedCount,
      distinctMatchedDateSignatureCount: frontier.distinctMatchedDateSignatureCount,
      distinctMatchedMonthSignatureCount: frontier.distinctMatchedMonthSignatureCount,
      distinctMatchedFoldSignatureCount: frontier.distinctMatchedFoldSignatureCount,
      bestSingleExpertTrainMatchedDateCount: bestSingleExpertTrainDateCount,
      bestSingleExpertTrainMatchedMonthCount: bestSingleExpertTrainMonthCount,
      bestSingleExpertTrainMatchedFoldCount: bestSingleExpertTrainFoldCount,
      expertUnionDateGainOverBestSingleExpert: bestUnionDateGainOverBestSingleExpert,
      expertUnionMonthGainOverBestSingleExpert: bestUnionMonthGainOverBestSingleExpert,
      expertUnionFoldGainOverBestSingleExpert: bestUnionFoldGainOverBestSingleExpert,
      supportFitExcluded,
      supportLeaveOneOutRecovered,
      bestTrainSummary,
      bestOosSummary,
      candidatesEvaluated: [...frontier.candidatesEvaluated, ...candidatesEvaluated].slice(0, 256),
    })
  }

  return {
    ok: true,
    supportFitExcluded,
    supportLeaveOneOutRecovered: true,
    localExpertCandidateCount: localExpertCalibration?.localExpertCandidateCount ?? 0,
    localExpertQualifiedCount: localExpertCalibration?.localExpertQualifiedCount ?? 0,
    expertUnionCandidateCount,
    expertUnionQualifiedCount,
    coverageFrontierCandidateCount: frontier.coverageFrontierCandidateCount,
    coverageFrontierQualifiedCount: frontier.coverageFrontierQualifiedCount,
    distinctMatchedDateSignatureCount: frontier.distinctMatchedDateSignatureCount,
    distinctMatchedMonthSignatureCount: frontier.distinctMatchedMonthSignatureCount,
    distinctMatchedFoldSignatureCount: frontier.distinctMatchedFoldSignatureCount,
    bestSingleExpertTrainMatchedDateCount: bestSingleExpertTrainDateCount,
    bestSingleExpertTrainMatchedMonthCount: bestSingleExpertTrainMonthCount,
    bestSingleExpertTrainMatchedFoldCount: bestSingleExpertTrainFoldCount,
    expertUnionDateGainOverBestSingleExpert: bestUnionDateGainOverBestSingleExpert,
    expertUnionMonthGainOverBestSingleExpert: bestUnionMonthGainOverBestSingleExpert,
    expertUnionFoldGainOverBestSingleExpert: bestUnionFoldGainOverBestSingleExpert,
    artifact: {
      artifactType:
        family?.localExpertArtifactType ?? "perfect_prototype_support_boundary_residual_experts",
      familyId: family?.familyId ?? "low_gap_top_continuation",
      surfaceName: family?.surfaceName ?? null,
      gateTokens: family?.gateTokens ?? [],
      supportCaseIds: bestSolution.supportMatched,
      unionExpertIds: bestSolution.unionExpertIds,
      localExperts: bestSolution.selectedExperts.map((expert) => expert?.artifact).filter(Boolean),
      historicalSupportAcceptanceContract: {
        supportFitExcluded,
        requiredSupportCaseIds: [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID],
      },
      fitDiagnostics: {
        supportFitExcluded,
        supportLeaveOneOutRecovered: true,
        ordinalMotifFeatureCount: Number(family?.summary?.ordinalMotifFeatureCount ?? 0),
        ordinalMotifGroupCount: Number(family?.summary?.ordinalMotifGroupCount ?? 0),
        corridorPositiveBasinCount: Number(family?.summary?.corridorPositiveBasinCount ?? 0),
        corridorPositiveSeedCount: Number(family?.summary?.corridorPositiveSeedCount ?? 0),
        supportCaseReachableBasinCount: Number(family?.summary?.supportCaseReachableBasinCount ?? 0),
        carrierGraphFeatureCount: Number(family?.summary?.carrierGraphFeatureCount ?? 0),
        carrierComponentCount: Number(family?.summary?.carrierComponentCount ?? 0),
        carrierEligibleComponentCount: Number(family?.summary?.carrierEligibleComponentCount ?? 0),
        supportCaseReachableComponentCount: Number(
          family?.summary?.supportCaseReachableComponentCount ?? 0,
        ),
        recurrencePurityFeatureCount: Number(family?.summary?.recurrencePurityFeatureCount ?? 0),
        recurrencePurityGroupCount: Number(family?.summary?.recurrencePurityGroupCount ?? 0),
        boundaryGroupEligibleCount: Number(groupDataset?.summary?.boundaryGroupEligibleCount ?? 0),
        localExpertQualifiedCount: Number(localExpertCalibration?.localExpertQualifiedCount ?? 0),
        distinctMatchedDateSignatureCount: Number(frontier.distinctMatchedDateSignatureCount ?? 0),
        coverageFrontierQualifiedCount: Number(frontier.coverageFrontierQualifiedCount ?? 0),
        expertUnionQualifiedCount,
      },
    },
    trainSummary: bestSolution.trainSummary,
    oosSummary: bestSolution.oosSummary,
    candidatesEvaluated: [...frontier.candidatesEvaluated, ...candidatesEvaluated].slice(0, 256),
    coverageFrontier: frontier,
  }
}
