import { readJson } from "./io.mjs"
import { hashFileSha1, writeChampionBundle } from "./champion_bundle.mjs"
import { hashJsonStableSha1 } from "./champion_bundle.mjs"
import { computeAuditDigest } from "./policy_parity.mjs"

export const buildChampionBundle = async ({
  bundlePath,
  lineageKey,
  abRunId,
  runId,
  sessionId,
  champion,
  lockboxSummaryPath = null
}) => {
  if (!champion) {
    throw new Error("buildChampionBundle requires champion")
  }
  const stepC = {
    cTag: String(champion?.cTag ?? "").trim() || null,
    libraryPath: String(champion?.stepCLibraryPath ?? "").trim() || null,
    runtimePath: String(champion?.stepCRuntimePath ?? "").trim() || null,
    summaryPath: String(champion?.stepCSummaryPath ?? "").trim() || null,
    indexManifestPath: String(champion?.stepCIndexManifestPath ?? "").trim() || null,
    shapingStatePath: String(champion?.stepCShapingStatePath ?? "").trim() || null,
    c0FamilyIndexPath: String(champion?.stepC0FamilyIndexPath ?? "").trim() || null,
    c0MembershipPath: String(champion?.stepC0MembershipPath ?? "").trim() || null,
    c0SummaryPath: String(champion?.stepC0SummaryPath ?? "").trim() || null,
    c1IndexPath: String(champion?.stepC1IndexPath ?? "").trim() || null,
    c1ResultsPath: String(champion?.stepC1ResultsPath ?? "").trim() || null,
    c1SummaryPath: String(champion?.stepC1SummaryPath ?? "").trim() || null,
    c2IndexPath: String(champion?.stepC2IndexPath ?? "").trim() || null,
    c2GroupsPath: String(champion?.stepC2GroupsPath ?? "").trim() || null,
    c2SummaryPath: String(champion?.stepC2SummaryPath ?? "").trim() || null
  }
  stepC.libraryHash = await hashFileSha1(stepC.libraryPath)
  stepC.runtimeHash = await hashFileSha1(stepC.runtimePath)
  stepC.summaryHash = await hashFileSha1(stepC.summaryPath)
  stepC.indexManifestHash = await hashFileSha1(stepC.indexManifestPath)
  stepC.shapingStateHash = await hashFileSha1(stepC.shapingStatePath)
  stepC.c0FamilyIndexHash = await hashFileSha1(stepC.c0FamilyIndexPath)
  stepC.c0MembershipHash = await hashFileSha1(stepC.c0MembershipPath)
  stepC.c0SummaryHash = await hashFileSha1(stepC.c0SummaryPath)
  stepC.c1IndexHash = await hashFileSha1(stepC.c1IndexPath)
  stepC.c1ResultsHash = await hashFileSha1(stepC.c1ResultsPath)
  stepC.c1SummaryHash = await hashFileSha1(stepC.c1SummaryPath)
  stepC.c2IndexHash = await hashFileSha1(stepC.c2IndexPath)
  stepC.c2GroupsHash = await hashFileSha1(stepC.c2GroupsPath)
  stepC.c2SummaryHash = await hashFileSha1(stepC.c2SummaryPath)

  const stepD = {
    summaryPath: String(champion?.summaryPath ?? "").trim() || null,
    policyStatePath: String(champion?.policyStatePath ?? "").trim() || null,
    policyBundlePath: String(champion?.policyBundlePath ?? "").trim() || null,
    weightsPath: String(champion?.weightsPath ?? "").trim() || null,
    artifactManifestPath: String(champion?.artifactManifestPath ?? "").trim() || null,
    sampledDebugPath: String(champion?.sampledDebugPath ?? "").trim() || null,
    d1RankedCandidatesPath: String(champion?.d1RankedCandidatesPath ?? "").trim() || null,
    d2ExecutionAuditPath: String(champion?.d2ExecutionAuditPath ?? "").trim() || null,
    d1LockboxRankedCandidatesPath: String(champion?.d1LockboxRankedCandidatesPath ?? "").trim() || null,
    d2LockboxExecutionAuditPath: String(champion?.d2LockboxExecutionAuditPath ?? "").trim() || null,
    policyFingerprint: champion?.policyFingerprint ?? null
  }
  stepD.summaryHash = await hashFileSha1(stepD.summaryPath)
  stepD.policyStateHash = await hashFileSha1(stepD.policyStatePath)
  stepD.policyBundleHash = await hashFileSha1(stepD.policyBundlePath)
  stepD.weightsHash = await hashFileSha1(stepD.weightsPath)
  stepD.artifactManifestHash = await hashFileSha1(stepD.artifactManifestPath)
  stepD.sampledDebugHash = await hashFileSha1(stepD.sampledDebugPath)
  const policyBundleObject = stepD.policyBundlePath
    ? await readJson(stepD.policyBundlePath, null)
    : null
  stepD.auditDigest = await computeAuditDigest({
    d1RankedCandidatesPath: stepD.d1RankedCandidatesPath,
    d2ExecutionAuditPath: stepD.d2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath: stepD.d1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath: stepD.d2LockboxExecutionAuditPath
  })

  const promotionContractDigest =
    String(policyBundleObject?.policyContractHash ?? "").trim() ||
    hashJsonStableSha1({
      metrics: champion?.metrics ?? null,
      lockboxSummaryPath: String(lockboxSummaryPath ?? "").trim() || null
    })

  const bundle = {
    version: 1,
    generatedAt: new Date().toISOString(),
    lineageKey: String(lineageKey ?? "").trim() || null,
    abRunId: String(abRunId ?? "").trim() || null,
    runId: String(runId ?? "").trim() || null,
    sessionId: String(sessionId ?? "").trim() || null,
    champion: {
      round: champion?.round ?? null,
      roundTag: champion?.roundTag ?? null,
      bestEpoch: champion?.bestEpoch ?? null,
      cTag: champion?.cTag ?? null,
      metrics: champion?.metrics ?? null
    },
    stepC,
    stepD,
    promotionContractDigest,
    lockboxSummaryPath: String(lockboxSummaryPath ?? "").trim() || null
  }
  await writeChampionBundle({ bundlePath, bundle })
  return bundle
}
