import { calibratePerfectPrototypeSupportTop1QueryRanker } from "./perfect_prototype_support_top1_query_calibrate.mjs"

export const calibratePerfectPrototypeSupportAdmittedTop1Ranker = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  if ((family?.gatedTrainRows ?? []).length < 1 || (family?.bridgePositiveRows ?? []).length < 1) {
    return {
      ok: false,
      reason: "unsat_no_admitted_queries",
      supportFitExcluded: family?.supportFitExcluded === true,
      supportLeaveOneOutRecovered: false,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_no_admitted_queries: 1 },
      candidatesEvaluated: [],
    }
  }

  return calibratePerfectPrototypeSupportTop1QueryRanker({
    family,
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedFolds,
    minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows,
    minOosMatchCount,
  })
}
