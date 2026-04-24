import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  scorePerfectPrototypeSupportGraphRows,
  summarizePerfectPrototypeSupportGraphSelections,
} from "./perfect_prototype_support_graph_apply.mjs"
import { buildPerfectPrototypeSupportGraphUnsat } from "./perfect_prototype_support_graph_unsat.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value * 1000) / 1000),
    ),
  ).sort((left, right) => left - right)

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_graph_train_precision"

const buildArtifact = ({
  family,
  trainNodes,
  selectThreshold,
  marginThreshold,
  abstainThreshold,
  neighborCount = 12,
} = {}) => ({
  artifactType: "perfect_prototype_support_corridor_graph_propagation",
  familyId: family?.familyId ?? "low_gap_top_continuation",
  surfaceName: family?.surfaceName ?? null,
  gateTokens: family?.gateTokens ?? [],
  supportCaseIds: [],
  featureEntries: (family?.corridorFeatureEntries ?? []).map((entry) => ({
    featureKey: entry.featureKey,
    weight: entry.weight,
    scale: entry.scale,
    separation: entry.separation,
  })),
  trainNodes,
  neighborCount,
  selectThreshold,
  marginThreshold,
  abstainThreshold,
  historicalSupportAcceptanceContract: {
    supportFitExcluded: family?.supportFitExcluded === true,
    requiredSupportCaseIds: [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID],
  },
})

const buildCandidatePreview = (candidate) => ({
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  marginThreshold: Number(candidate?.marginThreshold ?? 0),
  abstainThreshold: Number(candidate?.abstainThreshold ?? 0),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
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
  return Number(left?.selectThreshold ?? 0) - Number(right?.selectThreshold ?? 0)
}

export const calibratePerfectPrototypeSupportGraph = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
  neighborCount = 12,
} = {}) => {
  const trainNodes = Array.isArray(family?.propagatedTrainNodes) ? family.propagatedTrainNodes : []
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return buildPerfectPrototypeSupportGraphUnsat({
      reason: "unsat_support_acceptance_only_dependency",
      reasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      familySummary: family?.summary,
      supportFitExcluded,
    })
  }
  if (trainNodes.length < 1) {
    return buildPerfectPrototypeSupportGraphUnsat({
      reason: "unsat_no_graph_nodes",
      reasonCounts: { unsat_no_graph_nodes: 1 },
      familySummary: family?.summary,
      supportFitExcluded,
    })
  }

  const positiveTrainNodes = trainNodes.filter((row) => row?.outcomeHitTarget === true)
  const negativeTrainNodes = trainNodes.filter((row) => row?.outcomeHitTarget !== true)
  const supportEvaluationsRaw = scorePerfectPrototypeSupportGraphRows({
    artifact: buildArtifact({
      family,
      trainNodes,
      selectThreshold: -1,
      marginThreshold: -1,
      abstainThreshold: -1,
      neighborCount,
    }),
    rows: family?.supportCaseViews ?? [],
  })
  const supportCasePositivePotential = supportEvaluationsRaw[0]?.positivePotential ?? null
  const supportCaseNegativePotential = supportEvaluationsRaw[0]?.negativePotential ?? null
  const supportCaseSafeReachabilityScore = supportEvaluationsRaw[0]?.safeReachabilityScore ?? null
  if (
    !Number.isFinite(num(supportCasePositivePotential)) ||
    !Number.isFinite(num(supportCaseNegativePotential)) ||
    Number(supportCasePositivePotential) <= Number(supportCaseNegativePotential)
  ) {
    return buildPerfectPrototypeSupportGraphUnsat({
      reason: "unsat_support_case_not_corridor_reachable",
      reasonCounts: { unsat_support_case_not_corridor_reachable: 1 },
      familySummary: family?.summary,
      supportFitExcluded,
      graphPositiveSeedCount: family?.summary?.graphPositiveSeedCount,
      graphNegativeSeedCount: family?.summary?.graphNegativeSeedCount,
      corridorFeatureCount: family?.summary?.corridorFeatureCount,
      graphNodeCount: trainNodes.length,
      graphEdgeCount: family?.summary?.graphEdgeCount,
      supportCasePositivePotential,
      supportCaseNegativePotential,
      supportCaseSafeReachabilityScore,
    })
  }

  const positivePotentials = positiveTrainNodes.map((row) => row?.positivePotential).filter(Number.isFinite)
  const negativePotentials = negativeTrainNodes.map((row) => row?.positivePotential).filter(Number.isFinite)
  const positiveMargins = positiveTrainNodes.map((row) => row?.margin).filter(Number.isFinite)
  const negativeMargins = negativeTrainNodes.map((row) => row?.margin).filter(Number.isFinite)
  const positiveAbstainScores = positiveTrainNodes
    .map((row) => row?.safeReachabilityScore)
    .filter(Number.isFinite)
  const negativeAbstainScores = negativeTrainNodes
    .map((row) => row?.safeReachabilityScore)
    .filter(Number.isFinite)

  const selectThresholdCandidates = uniqueNumbers([
    quantile(positivePotentials, 0.15),
    quantile(positivePotentials, 0.25),
    quantile(positivePotentials, 0.35),
    Math.max(...negativePotentials, Number.NEGATIVE_INFINITY) + 0.001,
  ])
  const marginThresholdCandidates = uniqueNumbers([
    quantile(positiveMargins, 0.15),
    quantile(positiveMargins, 0.25),
    quantile(positiveMargins, 0.35),
    Math.max(...negativeMargins, Number.NEGATIVE_INFINITY) + 0.001,
  ])
  const abstainThresholdCandidates = uniqueNumbers([
    quantile(positiveAbstainScores, 0.15),
    quantile(positiveAbstainScores, 0.25),
    quantile(positiveAbstainScores, 0.35),
    Math.max(...negativeAbstainScores, Number.NEGATIVE_INFINITY) + 0.001,
  ])

  const reasonCounts = {}
  const candidatesEvaluated = []
  let triedCandidateCount = 0
  let scorerQualifiedCount = 0
  let supportLeaveOneOutRecovered = false
  let bestTrainSummary = null
  let bestOosSummary = null
  let bestSolution = null

  for (const selectThreshold of selectThresholdCandidates) {
    for (const marginThreshold of marginThresholdCandidates) {
      for (const abstainThreshold of abstainThresholdCandidates) {
        const artifact = buildArtifact({
          family,
          trainNodes,
          selectThreshold,
          marginThreshold,
          abstainThreshold,
          neighborCount,
        })
        const trainSummary = summarizePerfectPrototypeSupportGraphSelections({
          evaluations: scorePerfectPrototypeSupportGraphRows({
            artifact,
            rows: family?.graphTrainRows ?? [],
          }),
          supportCaseIds: [],
        })
        const candidate = {
          selectThreshold,
          marginThreshold,
          abstainThreshold,
          trainSummary,
          supportMatched: [],
          oosSummary: null,
          failureReason: null,
        }
        triedCandidateCount += 1

        if (toNumber(trainSummary.precision, 0) < 1) {
          candidate.failureReason = "unsat_scorer_train_precision"
        } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
          candidate.failureReason = "unsat_non_support_train_breadth"
        } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
          candidate.failureReason = "unsat_non_support_train_breadth"
        } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
          candidate.failureReason = "unsat_non_support_train_breadth"
        } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
          candidate.failureReason = "unsat_non_support_crossfit_recurrence"
        } else if (
          toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
        ) {
          candidate.failureReason = "unsat_non_support_crossfit_recurrence"
        }

        if (!candidate.failureReason) {
          const supportEvaluations = scorePerfectPrototypeSupportGraphRows({
            artifact,
            rows: family?.supportCaseViews ?? [],
          })
          candidate.supportMatched = supportEvaluations
            .filter((entry) => entry.selected === true && entry?.row?.caseId)
            .map((entry) => entry.row.caseId)
          if (candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
            supportLeaveOneOutRecovered = true
          } else {
            candidate.failureReason = "unsat_support_recovery_after_leave_one_out"
          }
        }

        if (!candidate.failureReason) {
          candidate.oosSummary = summarizePerfectPrototypeSupportGraphSelections({
            evaluations: scorePerfectPrototypeSupportGraphRows({
              artifact,
              rows: family?.oosRows ?? [],
            }),
            supportCaseIds: candidate.supportMatched,
          })
          if (toNumber(candidate.oosSummary.selectedRowCount, 0) < minOosMatchCount) {
            candidate.failureReason = "unsat_scorer_oos_zero_match"
          } else if (toNumber(candidate.oosSummary.precision, 0) < 1) {
            candidate.failureReason = "unsat_scorer_oos_precision"
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

        scorerQualifiedCount += 1
        if (!bestSolution || compareSolutions(candidate, bestSolution) < 0) {
          bestSolution = {
            ...candidate,
            artifact,
          }
        }
      }
    }
  }

  if (!bestSolution) {
    return buildPerfectPrototypeSupportGraphUnsat({
      reason: derivePrimaryReason(reasonCounts),
      reasonCounts,
      familySummary: family?.summary,
      supportFitExcluded,
      supportLeaveOneOutRecovered,
      graphPositiveSeedCount: family?.summary?.graphPositiveSeedCount,
      graphNegativeSeedCount: family?.summary?.graphNegativeSeedCount,
      corridorFeatureCount: family?.summary?.corridorFeatureCount,
      graphNodeCount: trainNodes.length,
      graphEdgeCount: family?.summary?.graphEdgeCount,
      scorerCandidateCount: triedCandidateCount,
      scorerQualifiedCount,
      bestTrainSummary,
      bestOosSummary,
      supportCasePositivePotential,
      supportCaseNegativePotential,
      supportCaseSafeReachabilityScore,
      candidatesEvaluated,
    })
  }

  bestSolution.artifact.supportCaseIds = bestSolution.supportMatched
  bestSolution.artifact.fitDiagnostics = {
    supportFitExcluded,
    supportLeaveOneOutRecovered: true,
    graphPositiveSeedCount: Number(family?.summary?.graphPositiveSeedCount ?? 0),
    graphNegativeSeedCount: Number(family?.summary?.graphNegativeSeedCount ?? 0),
    corridorFeatureCount: Number(family?.summary?.corridorFeatureCount ?? 0),
    graphNodeCount: Number(trainNodes.length),
    graphEdgeCount: Number(family?.summary?.graphEdgeCount ?? 0),
    supportCasePositivePotential,
    supportCaseNegativePotential,
    supportCaseSafeReachabilityScore,
    scorerQualifiedCount,
  }

  return {
    ok: true,
    supportFitExcluded,
    supportLeaveOneOutRecovered: true,
    scorerCandidateCount: triedCandidateCount,
    scorerQualifiedCount,
    graphPositiveSeedCount: family?.summary?.graphPositiveSeedCount ?? 0,
    graphNegativeSeedCount: family?.summary?.graphNegativeSeedCount ?? 0,
    artifact: bestSolution.artifact,
    trainSummary: bestSolution.trainSummary,
    oosSummary: bestSolution.oosSummary,
    candidatesEvaluated,
  }
}
