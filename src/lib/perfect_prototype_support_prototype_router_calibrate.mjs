import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportPrototypeRouter,
  summarizePerfectPrototypeSupportPrototypeRouterSelections,
} from "./perfect_prototype_support_prototype_router_apply.mjs"
import { buildPerfectPrototypeSupportPrototypeRouterUnsat } from "./perfect_prototype_support_prototype_router_unsat.mjs"

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

const buildCartesianProduct = (lists = []) => {
  const safeLists = Array.isArray(lists) ? lists : []
  if (safeLists.length < 1) return [[]]
  let out = [[]]
  for (const list of safeLists) {
    const next = []
    for (const prefix of out) {
      for (const item of Array.isArray(list) ? list : []) {
        next.push([...prefix, item])
      }
    }
    out = next
  }
  return out
}

const compareRouterSolutions = (left, right) => {
  if (
    toNumber(right?.trainSummary?.trainMatchedDateCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedDateCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
    )
  }
  if (
    toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
    )
  }
  if (toNumber(right?.abstainThreshold, 0) !== toNumber(left?.abstainThreshold, 0)) {
    return toNumber(right?.abstainThreshold, 0) - toNumber(left?.abstainThreshold, 0)
  }
  return toNumber(left?.thresholdCount, 0) - toNumber(right?.thresholdCount, 0)
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const buildCandidatePreview = (candidate) => ({
  thresholdCount: Number(candidate?.thresholdCount ?? 0),
  abstainThreshold: Number(candidate?.abstainThreshold ?? 0),
  selectedThresholdIds: (candidate?.monotoneThresholds ?? [])
    .map((entry) => entry?.thresholdId)
    .filter(Boolean),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
})

export const calibratePerfectPrototypeSupportPrototypeRouter = ({
  cohort,
  candidateSpace,
  maxThresholdFeatures = 4,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const gateTokens = Array.isArray(cohort?.gateTokens) ? cohort.gateTokens : []
  const calibrationRows = Array.isArray(cohort?.gatedTrainRows) && cohort.gatedTrainRows.length > 0
    ? cohort.gatedTrainRows
    : Array.isArray(cohort?.trainRows)
      ? cohort.trainRows
      : []
  if (gateTokens.length < 1) {
    return buildPerfectPrototypeSupportPrototypeRouterUnsat({
      reason: "unsat_no_gate",
      reasonCounts: { unsat_no_gate: 1 },
      candidateSummary: candidateSpace?.summary,
    })
  }

  const featureCandidates = Array.isArray(candidateSpace?.featureCandidates)
    ? candidateSpace.featureCandidates
    : []
  if (featureCandidates.length < 1) {
    return buildPerfectPrototypeSupportPrototypeRouterUnsat({
      reason: "unsat_no_monotone_threshold_router",
      reasonCounts: { unsat_no_monotone_threshold_router: 1 },
      candidateSummary: candidateSpace?.summary,
    })
  }

  const candidatesEvaluated = []
  const reasonCounts = {}
  let triedCandidateCount = 0
  let bestSolution = null
  const thresholdFeatureMax = Math.min(
    Math.max(1, Math.floor(Number(maxThresholdFeatures) || 4)),
    featureCandidates.length,
  )

  for (let featureCount = 1; featureCount <= thresholdFeatureMax; featureCount += 1) {
    for (const featureIndexes of buildCombinationIndexes(featureCandidates.length, featureCount)) {
      const selectedFeatures = featureIndexes.map((index) => featureCandidates[index])
      const thresholdProducts = buildCartesianProduct(
        selectedFeatures.map((entry) => entry.thresholdCandidates),
      )
      for (const monotoneThresholds of thresholdProducts) {
        for (let abstainThreshold = featureCount; abstainThreshold >= 1; abstainThreshold -= 1) {
          const artifact = {
            familyId: cohort?.familyId,
            surfaceName: cohort?.surfaceName,
            gateTokens,
            supportSignatureConfig: cohort?.supportSignatureConfig ?? null,
            monotoneThresholds,
            hardNegativeVeto: [],
            abstainThreshold,
          }
          const supportCaseEvaluations = applyPerfectPrototypeSupportPrototypeRouter({
            artifact,
            rows: cohort?.supportCaseViews ?? [],
          })
          const supportMatched = supportCaseEvaluations
            .filter((entry) => entry.selected === true)
            .map((entry) => entry.row.caseId)
            .filter(Boolean)
          const trainSummary = summarizePerfectPrototypeSupportPrototypeRouterSelections({
            evaluations: applyPerfectPrototypeSupportPrototypeRouter({
              artifact,
              rows: calibrationRows,
            }),
            supportCaseIds: supportMatched,
          })
          const candidate = {
            thresholdCount: monotoneThresholds.length,
            abstainThreshold,
            monotoneThresholds,
            supportMatched,
            trainSummary,
            failureReason: null,
          }
          triedCandidateCount += 1

          if (!supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
            candidate.failureReason = "unsat_historical_support"
          } else if (toNumber(trainSummary.precision, 0) < 1) {
            candidate.failureReason = "unsat_train_precision"
          } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
            candidate.failureReason = "unsat_train_breadth"
          } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
            candidate.failureReason = "unsat_train_breadth"
          } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
            candidate.failureReason = "unsat_train_breadth"
          } else if (
            toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows
          ) {
            candidate.failureReason = "unsat_crossfit_negatives"
          } else if (
            toNumber(trainSummary.crossfitPositiveWindowCount, 0) < minCrossfitPositiveWindows
          ) {
            candidate.failureReason = "unsat_crossfit_positive_windows"
          }

          if (candidatesEvaluated.length < 256) {
            candidatesEvaluated.push(buildCandidatePreview(candidate))
          }
          if (candidate.failureReason) {
            recordReason(reasonCounts, candidate.failureReason)
            continue
          }
          if (!bestSolution || compareRouterSolutions(candidate, bestSolution) < 0) {
            bestSolution = candidate
          }
        }
      }
    }
  }

  if (!bestSolution) {
    const reason =
      Object.keys(reasonCounts).length === 1 && reasonCounts.unsat_historical_support === 1
        ? "unsat_historical_support"
        : "unsat_no_monotone_threshold_router"
    return buildPerfectPrototypeSupportPrototypeRouterUnsat({
      reason,
      reasonCounts,
      candidateSummary: candidateSpace?.summary,
      triedCandidateCount,
      candidatesEvaluated,
    })
  }

  return {
    ok: true,
    routerSolvedCount: 1,
    routerHistoricalSupportMatchedCount: bestSolution.supportMatched.includes(
      PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    )
      ? 1
      : 0,
    artifact: {
      familyId: cohort?.familyId,
      surfaceName: cohort?.surfaceName,
      gateTokens,
      supportCaseIds: bestSolution.supportMatched,
      supportSignatureConfig: cohort?.supportSignatureConfig ?? null,
      monotoneThresholds: bestSolution.monotoneThresholds,
      hardNegativeVeto: [],
      abstainThreshold: bestSolution.abstainThreshold,
      fitDiagnostics: {
        routerCandidateCount: Number(candidateSpace?.summary?.routerCandidateCount ?? 0),
        routerFeatureCandidateCount: Number(
          candidateSpace?.summary?.routerFeatureCandidateCount ?? 0,
        ),
        routerThresholdCandidateCount: Number(
          candidateSpace?.summary?.routerThresholdCandidateCount ?? 0,
        ),
        calibrationRowCount: calibrationRows.length,
      },
    },
    trainSummary: bestSolution.trainSummary,
    triedCandidateCount,
    candidatesEvaluated,
  }
}
