export const buildPerfectPrototypeSupportScorecardArtifact = ({
  solution,
  cohortSummary,
  termBankSummary,
} = {}) => ({
  familyId: solution?.artifact?.familyId ?? null,
  surfaceName: solution?.artifact?.surfaceName ?? null,
  gateTokens: solution?.artifact?.gateTokens ?? [],
  threshold: solution?.artifact?.threshold ?? null,
  terms: solution?.artifact?.terms ?? [],
  supportCaseIds: solution?.artifact?.supportCaseIds ?? [],
  supportSignatureConfig: solution?.artifact?.supportSignatureConfig ?? null,
  fitDiagnostics: {
    ...(solution?.artifact?.fitDiagnostics ?? {}),
    prototypeCohortPositiveCount: Number(cohortSummary?.prototypeCohortPositiveCount ?? 0),
    prototypeCohortHardNegativeCount: Number(cohortSummary?.prototypeCohortHardNegativeCount ?? 0),
    scorecardTermCandidateCount: Number(termBankSummary?.scorecardTermCandidateCount ?? 0),
    scorecardTermQualifiedCount: Number(termBankSummary?.scorecardTermQualifiedCount ?? 0),
  },
})

