export const collectStepDLockboxAuditArtifacts = (stepDResult) => ({
  policyStatePath: stepDResult?.policyStatePath ?? null,
  policyBundlePath: stepDResult?.policyBundlePath ?? null,
  weightsPath: stepDResult?.weightsPath ?? null,
  d1LockboxRankedCandidatesPath: stepDResult?.d1LockboxRankedCandidatesPath ?? null,
  d2LockboxExecutionAuditPath: stepDResult?.d2LockboxExecutionAuditPath ?? null
})
