import crypto from "node:crypto"

import { pathExists } from "./io.mjs"
import { hashFileSha1 } from "./champion_bundle.mjs"

const digestMany = async (paths) => {
  const rows = []
  for (const filePath of Array.isArray(paths) ? paths : []) {
    const safePath = String(filePath ?? "").trim()
    if (!safePath || !pathExists(safePath)) {
      rows.push({ path: safePath, hash: null })
      continue
    }
    rows.push({
      path: safePath,
      hash: await hashFileSha1(safePath)
    })
  }
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

export const computeAuditDigest = async ({
  d1RankedCandidatesPath,
  d2ExecutionAuditPath,
  d1LockboxRankedCandidatesPath,
  d2LockboxExecutionAuditPath
}) =>
  digestMany([
    d1RankedCandidatesPath,
    d2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath
  ])

export const verifyChampionBundleParity = async ({
  bundle,
  loadedStepCLibraryPath,
  loadedStepCRuntimePath,
  loadedPolicyStatePath,
  loadedWeightsPath,
  loadedAuditPaths
}) => {
  const mismatches = []
  const expectedStepCLibraryHash = String(bundle?.stepC?.libraryHash ?? "").trim() || null
  const expectedStepCRuntimeHash = String(bundle?.stepC?.runtimeHash ?? "").trim() || null
  const expectedPolicyStateHash = String(bundle?.stepD?.policyStateHash ?? "").trim() || null
  const expectedWeightsHash = String(bundle?.stepD?.weightsHash ?? "").trim() || null
  const expectedAuditDigest = String(bundle?.stepD?.auditDigest ?? "").trim() || null

  const actualStepCLibraryHash = await hashFileSha1(loadedStepCLibraryPath)
  const actualStepCRuntimeHash = await hashFileSha1(loadedStepCRuntimePath)
  const actualPolicyStateHash = await hashFileSha1(loadedPolicyStatePath)
  const actualWeightsHash = await hashFileSha1(loadedWeightsPath)
  const actualAuditDigest = await computeAuditDigest(loadedAuditPaths)

  const compare = (field, expected, actual) => {
    if (!expected || !actual) return
    if (String(expected) !== String(actual)) {
      mismatches.push({
        field,
        expected,
        actual
      })
    }
  }

  compare("stepC.libraryHash", expectedStepCLibraryHash, actualStepCLibraryHash)
  compare("stepC.runtimeHash", expectedStepCRuntimeHash, actualStepCRuntimeHash)
  compare("stepD.policyStateHash", expectedPolicyStateHash, actualPolicyStateHash)
  compare("stepD.weightsHash", expectedWeightsHash, actualWeightsHash)
  compare("stepD.auditDigest", expectedAuditDigest, actualAuditDigest)

  return {
    ok: mismatches.length < 1,
    mismatches,
    actual: {
      stepCLibraryHash: actualStepCLibraryHash,
      stepCRuntimeHash: actualStepCRuntimeHash,
      policyStateHash: actualPolicyStateHash,
      weightsHash: actualWeightsHash,
      auditDigest: actualAuditDigest
    }
  }
}
