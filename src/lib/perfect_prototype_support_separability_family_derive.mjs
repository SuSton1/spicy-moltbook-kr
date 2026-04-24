export const derivePerfectPrototypeSupportSeparabilityFamilyContract = ({
  family,
  pairwiseAudit,
  queryAudit,
} = {}) => {
  const bestPairwise = pairwiseAudit?.bestCandidate
  const bestQuery = queryAudit?.bestCandidate
  if (!pairwiseAudit?.ok || !queryAudit?.ok || !bestPairwise || !bestQuery || !bestQuery?.qualified) {
    return {
      ok: false,
      reason: queryAudit?.reason ?? pairwiseAudit?.reason ?? "unsat_no_derived_support_regime_family",
    }
  }

  return {
    ok: true,
    familyId: `${family?.familyId ?? "low_gap_top_continuation"}__support_regime_v46`,
    sourceFamilyId: family?.familyId ?? "low_gap_top_continuation",
    supportAcceptanceOnly: true,
    supportFitExcluded: family?.supportFitExcluded === true,
    supplierFeatureCount: Number(family?.supplierFeatureKeys?.length ?? 0),
    selectedFeatureKeys: bestQuery.selectedFeatureKeys ?? [],
    threshold: Number(bestQuery.threshold ?? 0),
    gapThreshold: Number(bestQuery.gapThreshold ?? 0),
    pairwiseWinRate: Number(bestPairwise.pairwiseWinRate ?? 0),
    sameDateRunnerUpBeatRate: Number(bestPairwise.sameDateRunnerUpBeatRate ?? 0),
    minFoldPairwiseWinRate: Number(bestPairwise.minFoldPairwiseWinRate ?? 0),
    hardNegativeLeakCount: Number(bestPairwise.hardNegativeLeakCount ?? 0),
    distinctPositiveSignatureCount: Number(bestPairwise.distinctPositiveSignatureCount ?? 0),
    supportProjectionScore: Number(bestQuery.supportProjectionScore ?? Number.NEGATIVE_INFINITY),
    supportProjectionPositive: bestQuery.supportProjectionPositive === true,
    trainSummary: bestQuery.trainSummary ?? null,
  }
}

