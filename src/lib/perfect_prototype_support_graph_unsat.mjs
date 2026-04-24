import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const buildPerfectPrototypeSupportGraphUnsat = ({
  reason = "unsat_graph_not_ready",
  reasonCounts = {},
  familySummary = {},
  supportFitExcluded = false,
  supportLeaveOneOutRecovered = false,
  graphPositiveSeedCount = 0,
  graphNegativeSeedCount = 0,
  corridorFeatureCount = 0,
  graphNodeCount = 0,
  graphEdgeCount = 0,
  scorerCandidateCount = 0,
  scorerQualifiedCount = 0,
  bestTrainSummary = null,
  bestOosSummary = null,
  supportCasePositivePotential = null,
  supportCaseNegativePotential = null,
  supportCaseSafeReachabilityScore = null,
  candidatesEvaluated = [],
} = {}) => ({
  ok: false,
  reason,
  supportFitExcluded: supportFitExcluded === true,
  supportLeaveOneOutRecovered: supportLeaveOneOutRecovered === true,
  graphPositiveSeedCount: toNumber(graphPositiveSeedCount, 0),
  graphNegativeSeedCount: toNumber(graphNegativeSeedCount, 0),
  corridorFeatureCount: toNumber(
    corridorFeatureCount,
    toNumber(familySummary?.corridorFeatureCount, 0),
  ),
  graphNodeCount: toNumber(graphNodeCount, toNumber(familySummary?.graphNodeCount, 0)),
  graphEdgeCount: toNumber(graphEdgeCount, toNumber(familySummary?.graphEdgeCount, 0)),
  scorerCandidateCount: toNumber(scorerCandidateCount, 0),
  scorerQualifiedCount: toNumber(scorerQualifiedCount, 0),
  supportCasePositivePotential:
    Number.isFinite(Number(supportCasePositivePotential)) ? Number(supportCasePositivePotential) : null,
  supportCaseNegativePotential:
    Number.isFinite(Number(supportCaseNegativePotential)) ? Number(supportCaseNegativePotential) : null,
  supportCaseSafeReachabilityScore:
    Number.isFinite(Number(supportCaseSafeReachabilityScore))
      ? Number(supportCaseSafeReachabilityScore)
      : null,
  supportAcceptanceRequiredCaseIds: [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID],
  unsatReasonCounts: reasonCounts,
  bestTrainSummary,
  bestOosSummary,
  candidatesEvaluated,
})
