export const buildPerfectPrototypeSupportSeparabilityUnsat = ({
  family,
  pairwiseAudit,
  queryAudit,
} = {}) => ({
  ok: false,
  reason: queryAudit?.reason ?? pairwiseAudit?.reason ?? "unsat_no_support_separability",
  supportFitExcluded: family?.supportFitExcluded === true,
  supportLeaveOneOutRecovered: queryAudit?.supportLeaveOneOutRecovered === true,
  supplierFeatureCount: Number(family?.supplierFeatureKeys?.length ?? 0),
  selectedFeaturePoolCount: Number(pairwiseAudit?.selectedFeaturePoolCount ?? 0),
  pairwiseCandidateCount: Number(pairwiseAudit?.candidateCount ?? 0),
  pairwiseQualifiedCandidateCount: Number(pairwiseAudit?.qualifiedCandidateCount ?? 0),
  queryCandidateCount: Number(queryAudit?.candidateCount ?? 0),
  queryQualifiedCandidateCount: Number(queryAudit?.qualifiedCandidateCount ?? 0),
  bestPairwiseCandidate: pairwiseAudit?.bestCandidate
    ? {
        selectedFeatureKeys: pairwiseAudit.bestCandidate.selectedFeatureKeys,
        pairwiseWinRate: pairwiseAudit.bestCandidate.pairwiseWinRate,
        sameDateRunnerUpBeatRate: pairwiseAudit.bestCandidate.sameDateRunnerUpBeatRate,
        minFoldPairwiseWinRate: pairwiseAudit.bestCandidate.minFoldPairwiseWinRate,
        hardNegativeLeakCount: pairwiseAudit.bestCandidate.hardNegativeLeakCount,
        distinctPositiveSignatureCount: pairwiseAudit.bestCandidate.distinctPositiveSignatureCount,
        supportProjectionScore: pairwiseAudit.bestCandidate.supportProjectionScore,
        supportProjectionPositive: pairwiseAudit.bestCandidate.supportProjectionPositive,
        failureReason: pairwiseAudit.bestCandidate.failureReason,
      }
    : null,
  bestQueryCandidate: queryAudit?.bestCandidate
    ? {
        selectedFeatureKeys: queryAudit.bestCandidate.selectedFeatureKeys,
        threshold: queryAudit.bestCandidate.threshold,
        gapThreshold: queryAudit.bestCandidate.gapThreshold,
        trainSummary: queryAudit.bestCandidate.trainSummary,
        supportProjectionScore: queryAudit.bestCandidate.supportProjectionScore,
        supportProjectionPositive: queryAudit.bestCandidate.supportProjectionPositive,
        failureReason: queryAudit.bestCandidate.failureReason,
      }
    : null,
  pairwiseUnsatReasonCounts: pairwiseAudit?.unsatReasonCounts ?? {},
  queryUnsatReasonCounts: queryAudit?.unsatReasonCounts ?? {},
})
