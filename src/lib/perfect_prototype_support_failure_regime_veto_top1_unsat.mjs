export const buildPerfectPrototypeSupportFailureRegimeVetoTop1Unsat = ({
  vetoResult = null,
  ranker = null,
} = {}) => {
  const base = ranker && ranker.ok === false ? ranker : {}
  return {
    ok: false,
    reason: base.reason ?? vetoResult?.reason ?? "unsat_no_failure_regime_veto_top1_solution",
    supportFitExcluded:
      base.supportFitExcluded === true || vetoResult?.supportFitExcluded === true,
    supportLeaveOneOutRecovered: base.supportLeaveOneOutRecovered === true,
    vetoCandidateCount: Number(vetoResult?.candidateCount ?? 0),
    vetoQualifiedCandidateCount: Number(vetoResult?.qualifiedCandidateCount ?? 0),
    selectedClusterUniverseCount: Number(vetoResult?.selectedClusterUniverseCount ?? 0),
    vetoBestCandidate: vetoResult?.bestCandidate ?? null,
    selectedFeaturePoolCount: Number(base.selectedFeaturePoolCount ?? 0),
    candidateCount: Number(base.candidateCount ?? 0),
    qualifiedCandidateCount: Number(base.qualifiedCandidateCount ?? 0),
    bestTrainSummary: base.bestTrainSummary ?? null,
    bestOosSummary: base.bestOosSummary ?? null,
    unsatReasonCounts: {
      ...(vetoResult?.unsatReasonCounts ?? {}),
      ...(base.unsatReasonCounts ?? {}),
    },
    candidatesEvaluated: base.candidatesEvaluated ?? vetoResult?.candidatesEvaluated ?? [],
  }
}
