import path from "node:path"

import { ensureDir, writeJson } from "../lib/io.mjs"
import { hashFileSha1, hashJsonStableSha1 } from "../lib/champion_bundle.mjs"
import { computeAuditDigest } from "../lib/policy_parity.mjs"

export const buildStepDPolicyBundle = async ({
  runId,
  summaryPath,
  policyStatePath,
  weightsPath,
  artifactManifestPath,
  sampledDebugPath,
  d1RankedCandidatesPath,
  d2ExecutionAuditPath,
  d1LockboxRankedCandidatesPath,
  d2LockboxExecutionAuditPath,
  policyContract = null,
  policyFingerprint = null,
  lineageKey = null
}) => {
  const summaryHash = await hashFileSha1(summaryPath)
  const policyStateHash = await hashFileSha1(policyStatePath)
  const weightsHash = await hashFileSha1(weightsPath)
  const artifactManifestHash = await hashFileSha1(artifactManifestPath)
  const sampledDebugHash = await hashFileSha1(sampledDebugPath)
  const auditDigest = await computeAuditDigest({
    d1RankedCandidatesPath,
    d2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath
  })
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    runId: String(runId ?? "").trim() || null,
    lineageKey: String(lineageKey ?? "").trim() || null,
    policyFingerprint: policyFingerprint ?? null,
    summaryPath,
    summaryHash,
    policyStatePath,
    policyStateHash,
    weightsPath,
    weightsHash,
    artifactManifestPath,
    artifactManifestHash,
    sampledDebugPath,
    sampledDebugHash,
    d1RankedCandidatesPath,
    d2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath,
    auditDigest,
    policyContract,
    policyContractHash: hashJsonStableSha1(policyContract)
  }
}

export const writeStepDPolicyBundle = async ({ bundlePath, bundle }) => {
  await ensureDir(path.dirname(bundlePath))
  await writeJson(bundlePath, bundle)
  return bundlePath
}
