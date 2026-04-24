export const collectStepDEvalAuditArtifacts = (stepDResult) => ({
  summaryPath: stepDResult?.summaryPath ?? null,
  policyStatePath: stepDResult?.policyStatePath ?? null,
  policyBundlePath: stepDResult?.policyBundlePath ?? null,
  weightsPath: stepDResult?.weightsPath ?? null,
  d1RankedCandidatesPath: stepDResult?.d1RankedCandidatesPath ?? null,
  d2ExecutionAuditPath: stepDResult?.d2ExecutionAuditPath ?? null
})
