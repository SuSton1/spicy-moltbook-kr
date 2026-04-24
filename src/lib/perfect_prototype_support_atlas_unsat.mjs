const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const buildPerfectPrototypeSupportAtlasUnsat = ({
  reason = "unsat_no_local_prototype_atlas",
  reasonCounts = {},
  candidateSummary = {},
  triedCandidateCount = 0,
  candidatesEvaluated = [],
  extraSummary = {},
  preThresholdFrontier = [],
} = {}) => ({
  ok: false,
  reason,
  atlasSolvedCount: 0,
  atlasHistoricalSupportMatchedCount: 0,
  atlasCellCandidateCount: toNumber(candidateSummary?.atlasCellCandidateCount, 0),
  atlasQualifiedCellCount: toNumber(candidateSummary?.atlasQualifiedCellCount, 0),
  atlasPositiveSupportMarginCellCount: toNumber(
    candidateSummary?.atlasPositiveSupportMarginCellCount,
    0,
  ),
  atlasAnchorSetCount: toNumber(candidateSummary?.atlasAnchorSetCount, 0),
  atlasAnchorCoverageDateCount: toNumber(candidateSummary?.atlasAnchorCoverageDateCount, 0),
  atlasAnchorCoverageMonthCount: toNumber(candidateSummary?.atlasAnchorCoverageMonthCount, 0),
  atlasAnchorCoverageFoldCount: toNumber(candidateSummary?.atlasAnchorCoverageFoldCount, 0),
  bridgeCompanionAcceptedCount: toNumber(candidateSummary?.bridgeCompanionAcceptedCount, 0),
  bridgeLiftedPositiveSummary: candidateSummary?.bridgeLiftedPositiveSummary ?? null,
  bridgeLiftedNegativeSummary: candidateSummary?.bridgeLiftedNegativeSummary ?? null,
  supportFitExcluded: extraSummary?.supportFitExcluded === true,
  supportLeaveOneOutRecovered: extraSummary?.supportLeaveOneOutRecovered === true,
  preThresholdFrontierPointCount: toNumber(extraSummary?.preThresholdFrontierPointCount, 0),
  preThresholdBestBreadthCandidate: extraSummary?.preThresholdBestBreadthCandidate ?? null,
  boundaryVetoAppliedCount: toNumber(extraSummary?.boundaryVetoAppliedCount, 0),
  boundaryVetoBestPrecisionLift: toNumber(extraSummary?.boundaryVetoBestPrecisionLift, 0),
  boundaryVetoSupportLossCount: toNumber(extraSummary?.boundaryVetoSupportLossCount, 0),
  atlasUnsatReasonCounts: reasonCounts,
  triedCandidateCount: toNumber(triedCandidateCount, 0),
  candidatesEvaluated,
  preThresholdFrontier,
})
