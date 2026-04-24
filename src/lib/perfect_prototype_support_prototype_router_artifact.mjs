export const buildPerfectPrototypeSupportPrototypeRouterArtifact = ({
  solution,
  cohortSummary,
  candidateSummary,
} = {}) => ({
  familyId: solution?.artifact?.familyId ?? null,
  surfaceName: solution?.artifact?.surfaceName ?? null,
  gateTokens: solution?.artifact?.gateTokens ?? [],
  supportCaseIds: solution?.artifact?.supportCaseIds ?? [],
  supportSignatureConfig: solution?.artifact?.supportSignatureConfig ?? null,
  monotoneThresholds: solution?.artifact?.monotoneThresholds ?? [],
  hardNegativeVeto: solution?.artifact?.hardNegativeVeto ?? [],
  abstainThreshold: solution?.artifact?.abstainThreshold ?? null,
  fitDiagnostics: {
    ...(solution?.artifact?.fitDiagnostics ?? {}),
    prototypeCohortPositiveCount: Number(cohortSummary?.prototypeCohortPositiveCount ?? 0),
    prototypeCohortHardNegativeCount: Number(cohortSummary?.prototypeCohortHardNegativeCount ?? 0),
    routerCandidateCount: Number(candidateSummary?.routerCandidateCount ?? 0),
    routerFeatureCandidateCount: Number(candidateSummary?.routerFeatureCandidateCount ?? 0),
    routerThresholdCandidateCount: Number(candidateSummary?.routerThresholdCandidateCount ?? 0),
  },
})

