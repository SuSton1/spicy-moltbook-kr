const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const buildPerfectPrototypeSupportBoundaryResidualUnsat = ({
  reason = "unsat_boundary_residual_not_separable",
  reasonCounts = {},
  familySummary = {},
  supportFitExcluded = false,
  supportLeaveOneOutRecovered = false,
  scorerCandidateCount = 0,
  scorerQualifiedCount = 0,
  scorerHistoricalSupportMatchedCount = 0,
  triedCandidateCount = 0,
  candidatesEvaluated = [],
  bestTrainSummary = null,
  bestOosSummary = null,
} = {}) => ({
  ok: false,
  reason,
  supportFitExcluded: supportFitExcluded === true,
  supportLeaveOneOutRecovered: supportLeaveOneOutRecovered === true,
  boundaryResidualFeatureCount: toNumber(familySummary?.boundaryResidualFeatureCount, 0),
  boundaryResidualPositiveGroupCount: toNumber(familySummary?.boundaryResidualPositiveGroupCount, 0),
  boundaryResidualFalsePositivePressure: Number(familySummary?.boundaryResidualFalsePositivePressure ?? 0),
  scorerCandidateCount: toNumber(scorerCandidateCount, 0),
  scorerQualifiedCount: toNumber(scorerQualifiedCount, 0),
  scorerHistoricalSupportMatchedCount: toNumber(scorerHistoricalSupportMatchedCount, 0),
  triedCandidateCount: toNumber(triedCandidateCount, 0),
  scorerUnsatReasonCounts: reasonCounts,
  bestTrainSummary,
  bestOosSummary,
  candidatesEvaluated,
})
