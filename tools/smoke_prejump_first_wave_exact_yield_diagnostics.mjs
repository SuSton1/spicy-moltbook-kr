import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { assertPerfectPrototypeServerWorkspace } from "../src/lib/perfect_prototype_server_policy.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readControlPlaneJsonSnapshot = async (filePath, retryCount = 2) => {
  const payload = await readJsonIfExistsStrict(filePath)
  if (payload !== null) return payload
  if (pathExists(filePath)) {
    if (retryCount > 0) {
      await sleep(5)
      return readControlPlaneJsonSnapshot(filePath, retryCount - 1)
    }
    throw new Error(
      `First-wave exact-yield diagnostics smoke expected JSON but found null: ${filePath}`,
    )
  }
  return null
}

const findLatestIndexedEquivalenceRoot = async ({ cwd }) => {
  const checksRoot = path.join(cwd, "artifacts", "checks")
  if (!pathExists(checksRoot)) {
    throw new Error(
      "First-wave exact-yield diagnostics smoke requires artifacts/checks from smoke_prejump_indexed_equivalence.mjs",
    )
  }
  const entries = await fsp.readdir(checksRoot, { withFileTypes: true })
  let latest = null
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const summaryPath = path.join(checksRoot, entry.name, "equivalence_summary.json")
    if (!pathExists(summaryPath)) continue
    const stat = await fsp.stat(summaryPath)
    if (!latest || Number(stat.mtimeMs ?? 0) > Number(latest.mtimeMs ?? 0)) {
      latest = { summaryPath, mtimeMs: Number(stat.mtimeMs ?? 0) }
    }
  }
  if (!latest) {
    throw new Error(
      "First-wave exact-yield diagnostics smoke could not find a prior indexed equivalence summary under artifacts/checks",
    )
  }
  const summary = await readJson(latest.summaryPath, null)
  const rootDir = path.resolve(String(summary?.rootDir ?? "").trim())
  if (!rootDir || !pathExists(path.join(rootDir, "index"))) {
    throw new Error(
      `First-wave exact-yield diagnostics smoke found an invalid indexed equivalence root: ${latest.summaryPath}`,
    )
  }
  return rootDir
}

const runParallelYieldProbe = async ({
  cwd,
  indexDir,
  outDir,
  options,
  pollIntervalMs = 10,
}) => {
  let settled = false
  let result = null
  let failure = null
  const observedProgressSnapshots = []
  const seenSnapshotKeys = new Set()
  const completionPromise = minePerfectPrototypeParallelIndexed({
    cwd,
    indexDir,
    outDir,
    options,
  })
    .then((value) => {
      result = value
    })
    .catch((error) => {
      failure = error
    })
    .finally(() => {
      settled = true
    })
  const progressPath = path.join(outDir, "progress.json")
  while (!settled) {
    const progress = await readControlPlaneJsonSnapshot(progressPath)
    if (progress) {
      const snapshot = {
        phase: String(progress?.phase ?? ""),
        updatedAt: String(progress?.updatedAt ?? ""),
        parallelReadyQueueHeadYieldChunks: Array.isArray(progress?.parallelReadyQueueHeadYieldChunks)
          ? progress.parallelReadyQueueHeadYieldChunks
          : [],
        parallelActiveChunks: Array.isArray(progress?.parallelActiveChunks)
          ? progress.parallelActiveChunks
          : [],
      }
      const snapshotKey = JSON.stringify({
        phase: snapshot.phase,
        updatedAt: snapshot.updatedAt,
        activeChunkCount: snapshot.parallelActiveChunks.length,
        headChunkCount: snapshot.parallelReadyQueueHeadYieldChunks.length,
      })
      if (!seenSnapshotKeys.has(snapshotKey)) {
        seenSnapshotKeys.add(snapshotKey)
        observedProgressSnapshots.push(snapshot)
      }
    }
    await sleep(pollIntervalMs)
  }
  await completionPromise
  return {
    result,
    failure,
    observedProgressSnapshots,
    finalProgress: await readControlPlaneJsonSnapshot(progressPath),
    finalManifest: await readControlPlaneJsonSnapshot(path.join(outDir, "parallel_manifest.json")),
  }
}

const assertNonNegativeMetric = (value, label) => {
  assert(Number.isFinite(Number(value)) && Number(value) >= 0, `${label} must be non-negative`)
}

const assertHeadYieldEntry = (entry, label) => {
  assert(Number.isInteger(Number(entry?.chunkIndex)) && Number(entry.chunkIndex) >= 0, `${label} missing chunkIndex`)
  assert(Number(entry?.dispatchPriorityIndex ?? -1) >= -1, `${label} missing dispatchPriorityIndex`)
  assert(Number(entry?.end ?? -1) > Number(entry?.start ?? -1), `${label} invalid chunk span`)
  for (const key of [
    "dispatchScore",
    "firstWaveDispatchScore",
    "headMicroprobeDispatchScore",
    "singletonRootCompletionScore",
    "singletonRootExactCompletionScore",
    "singletonRootAdaptiveExactCompletionScore",
    "multiRootCompletionScore",
  ]) {
    assertNonNegativeMetric(entry?.[key], `${label}.${key}`)
  }
}

const assertActiveYieldEntry = (entry, label) => {
  for (const key of [
    "dispatchScore",
    "firstWaveDispatchScore",
    "headMicroprobeDispatchScore",
    "singletonRootCompletionScore",
    "singletonRootExactCompletionScore",
    "singletonRootAdaptiveExactCompletionScore",
    "multiRootCompletionScore",
    "yieldCandidateAcceptanceRate",
    "yieldRulesPerAcceptedCandidate",
    "yieldLivePartialRulesPerAcceptedCandidate",
    "yieldRulesPerExploredState",
    "yieldLivePartialRulesPerExploredState",
  ]) {
    assertNonNegativeMetric(entry?.[key], `${label}.${key}`)
  }
  assert(
    Number(entry?.yieldCandidateAcceptanceRate ?? 0) <= 1,
    `${label}.yieldCandidateAcceptanceRate must be <= 1`,
  )
  const expectedAcceptanceRate =
    Number(entry?.acceptedCandidateCount ?? 0) /
    Math.max(1, Number(entry?.candidateDescriptorCount ?? 0))
  assert.equal(
    Number(entry?.yieldCandidateAcceptanceRate ?? 0).toFixed(6),
    expectedAcceptanceRate.toFixed(6),
    `${label}.yieldCandidateAcceptanceRate mismatch`,
  )
}

const main = async () => {
  const cwd = process.cwd()
  assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_first_wave_exact_yield_diagnostics",
  })

  const rootDir = await findLatestIndexedEquivalenceRoot({ cwd })
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_first_wave_exact_yield_diagnostics")
  await ensureDir(rootDir)
  await fsp.rm(outDir, { recursive: true, force: true })
  await writeJson(path.join(rootDir, "parallel_first_wave_exact_yield_diagnostics_marker.json"), {
    createdAt: new Date().toISOString(),
  })

  const probe = await runParallelYieldProbe({
    cwd,
    indexDir,
    outDir,
    options: {
      trainStartDate: "2024-01-02",
      trainEndDate: "2024-01-15",
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 20000000,
      maxRejectedRuleSamples: 1000,
      searchStateCacheMaxBytes: 32 * 1024,
      orderingHeadWindow: 8,
      workers: 2,
    },
  })
  assert.ifError(probe.failure)
  assert(probe.result, "First-wave exact-yield diagnostics smoke parallel run did not return a result")
  assert(probe.finalManifest, "First-wave exact-yield diagnostics smoke missing parallel_manifest.json")

  const activeSnapshots = probe.observedProgressSnapshots.filter(
    (snapshot) =>
      String(snapshot?.phase ?? "") === "search_ready_queue" &&
      Array.isArray(snapshot?.parallelActiveChunks) &&
      snapshot.parallelActiveChunks.length > 0,
  )
  assert(
    activeSnapshots.length > 0,
    "First-wave exact-yield diagnostics smoke did not observe active search_ready_queue snapshots",
  )
  const yieldSnapshots = probe.observedProgressSnapshots.filter(
    (snapshot) => Array.isArray(snapshot?.parallelReadyQueueHeadYieldChunks) && snapshot.parallelReadyQueueHeadYieldChunks.length > 0,
  )
  assert(
    yieldSnapshots.length > 0,
    "First-wave exact-yield diagnostics smoke did not observe parallelReadyQueueHeadYieldChunks",
  )

  const activeEntries = activeSnapshots.flatMap((snapshot) => snapshot.parallelActiveChunks)
  assert(activeEntries.length > 0, "First-wave exact-yield diagnostics smoke missing active chunk entries")
  activeEntries.forEach((entry, index) => {
    assertActiveYieldEntry(entry, `first-wave active entry[${index}]`)
  })

  const headEntries = yieldSnapshots.flatMap((snapshot) => snapshot.parallelReadyQueueHeadYieldChunks)
  headEntries.forEach((entry, index) => {
    assertHeadYieldEntry(entry, `first-wave ready-queue entry[${index}]`)
  })

  assert(Array.isArray(probe.finalManifest?.chunkRuns), "First-wave exact-yield diagnostics smoke missing chunkRuns")
  assert(
    probe.finalManifest.chunkRuns.length > 0,
    "First-wave exact-yield diagnostics smoke expected at least one chunk run in final manifest",
  )
  probe.finalManifest.chunkRuns.forEach((entry, index) => {
    assertHeadYieldEntry(entry, `first-wave manifest chunkRun[${index}]`)
  })

  console.log(
    JSON.stringify(
      {
        status: "ok",
        observedActiveSnapshotCount: activeSnapshots.length,
        observedReadyQueueHeadSnapshotCount: yieldSnapshots.length,
        manifestChunkRunCount: probe.finalManifest.chunkRuns.length,
        maxYieldRulesPerAcceptedCandidate: Math.max(
          ...activeEntries.map((entry) => Number(entry?.yieldRulesPerAcceptedCandidate ?? 0)),
        ),
        maxYieldLivePartialRulesPerAcceptedCandidate: Math.max(
          ...activeEntries.map((entry) =>
            Number(entry?.yieldLivePartialRulesPerAcceptedCandidate ?? 0),
          ),
        ),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
