const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const buildPerfectPrototypeSupportPrototypeRouterUnsat = ({
  reason = "unsat_no_monotone_threshold_router",
  reasonCounts = {},
  candidateSummary = {},
  triedCandidateCount = 0,
  candidatesEvaluated = [],
} = {}) => ({
  ok: false,
  reason,
  routerSolvedCount: 0,
  routerHistoricalSupportMatchedCount: 0,
  routerCandidateCount: toNumber(candidateSummary?.routerCandidateCount, 0),
  routerFeatureCandidateCount: toNumber(candidateSummary?.routerFeatureCandidateCount, 0),
  routerThresholdCandidateCount: toNumber(candidateSummary?.routerThresholdCandidateCount, 0),
  routerUnsatReasonCounts: reasonCounts,
  triedCandidateCount: toNumber(triedCandidateCount, 0),
  candidatesEvaluated,
})

