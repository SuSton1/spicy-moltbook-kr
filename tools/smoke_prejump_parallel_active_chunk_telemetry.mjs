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
    throw new Error(`Parallel active-chunk telemetry smoke expected JSON but found null: ${filePath}`)
  }
  return null
}

const findLatestIndexedEquivalenceRoot = async ({ cwd }) => {
  const checksRoot = path.join(cwd, "artifacts", "checks")
  if (!pathExists(checksRoot)) {
    throw new Error(
      "Parallel active-chunk telemetry smoke requires artifacts/checks from smoke_prejump_indexed_equivalence.mjs",
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
      "Parallel active-chunk telemetry smoke could not find a prior indexed equivalence summary under artifacts/checks",
    )
  }
  const summary = await readJson(latest.summaryPath, null)
  const rootDir = path.resolve(String(summary?.rootDir ?? "").trim())
  if (!rootDir || !pathExists(path.join(rootDir, "index"))) {
    throw new Error(
      `Parallel active-chunk telemetry smoke found an invalid indexed equivalence root: ${latest.summaryPath}`,
    )
  }
  return rootDir
}

const runParallelActiveChunkProbe = async ({
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
        parallelBudgetFastpathTickCount: Number(progress?.parallelBudgetFastpathTickCount ?? 0),
        parallelBudgetFastpathServiceCount: Number(
          progress?.parallelBudgetFastpathServiceCount ?? 0,
        ),
        parallelBudgetFastpathHotTickCount: Number(
          progress?.parallelBudgetFastpathHotTickCount ?? 0,
        ),
        parallelBudgetFastpathIdleTickCount: Number(
          progress?.parallelBudgetFastpathIdleTickCount ?? 0,
        ),
        parallelBudgetFastpathIdleSkipCount: Number(
          progress?.parallelBudgetFastpathIdleSkipCount ?? 0,
        ),
        parallelWorkerSlotCompletionPollCount: Number(
          progress?.parallelWorkerSlotCompletionPollCount ?? 0,
        ),
        parallelWorkerSlotCompletionHotPollCount: Number(
          progress?.parallelWorkerSlotCompletionHotPollCount ?? 0,
        ),
        parallelWorkerSlotCompletionSteadyPollCount: Number(
          progress?.parallelWorkerSlotCompletionSteadyPollCount ?? 0,
        ),
        parallelActiveChunkCount: Number(progress?.parallelActiveChunkCount ?? 0),
        parallelActiveChunks: Array.isArray(progress?.parallelActiveChunks)
          ? progress.parallelActiveChunks
          : [],
        parallelActiveChunkSnapshots: Array.isArray(progress?.parallelActiveChunkSnapshots)
          ? progress.parallelActiveChunkSnapshots
          : [],
        parallelLastObservedActiveChunkSnapshots: Array.isArray(
          progress?.parallelLastObservedActiveChunkSnapshots,
        )
          ? progress.parallelLastObservedActiveChunkSnapshots
          : [],
      }
      const snapshotKey = JSON.stringify({
        updatedAt: snapshot.updatedAt,
        phase: snapshot.phase,
        activeChunkCount: snapshot.parallelActiveChunkCount,
        firstChunkIndex:
          snapshot.parallelActiveChunks[0]?.chunkIndex ??
          snapshot.parallelActiveChunkSnapshots[0]?.chunkIndex ??
          null,
        firstExploredStates:
          snapshot.parallelActiveChunks[0]?.exploredStates ??
          snapshot.parallelActiveChunkSnapshots[0]?.exploredStates ??
          null,
        fastpathTickCount: snapshot.parallelBudgetFastpathTickCount,
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

const assertActiveChunkEntry = (entry, label) => {
  assert(Number.isInteger(Number(entry?.chunkIndex)) && Number(entry.chunkIndex) >= 0, `${label} missing chunkIndex`)
  assert(
    Number.isInteger(Number(entry?.workerSlotIndex)) && Number(entry.workerSlotIndex) >= 0,
    `${label} missing workerSlotIndex`,
  )
  assert(Number(entry?.rootSeedStartIndex ?? entry?.start ?? -1) >= 0, `${label} missing rootSeedStartIndex`)
  assert(
    Number(entry?.rootSeedEndIndexExclusive ?? entry?.end ?? -1) >
      Number(entry?.rootSeedStartIndex ?? entry?.start ?? -1),
    `${label} missing rootSeedEndIndexExclusive`,
  )
  assert(String(entry?.phase ?? "").trim().length > 0, `${label} missing phase`)
  assert(Number(entry?.exploredStates ?? -1) >= 0, `${label} missing exploredStates`)
  assert(Number(entry?.baseAllocatedMaxSearchStates ?? 0) > 0, `${label} missing baseAllocatedMaxSearchStates`)
  assert(
    Number(entry?.guardBandAllocatedSearchStates ?? -1) >= 0,
    `${label} missing guardBandAllocatedSearchStates`,
  )
  assert(Number(entry?.effectiveAllocatedMaxSearchStates ?? 0) > 0, `${label} missing effectiveAllocatedMaxSearchStates`)
  assert.equal(
    Number(entry?.baseAllocatedMaxSearchStates ?? 0) +
      Number(entry?.guardBandAllocatedSearchStates ?? 0),
    Number(entry?.allocatedMaxSearchStates ?? 0),
    `${label} requires allocatedMaxSearchStates = base + guard band`,
  )
  assert(
    Number(entry?.remainingGlobalSearchBudgetAtLaunch ?? -1) >= 0,
    `${label} missing remainingGlobalSearchBudgetAtLaunch`,
  )
  assert(Number(entry?.completionFraction ?? 0) >= 0, `${label} missing completionFraction`)
  assert(Number(entry?.currentSearchDepth ?? -1) >= 0, `${label} missing currentSearchDepth`)
  assert(Number(entry?.maxSearchDepth ?? -1) >= 0, `${label} missing maxSearchDepth`)
  assert(
    Number(entry?.maxSearchDepth ?? -1) >= Number(entry?.currentSearchDepth ?? 0),
    `${label} requires maxSearchDepth >= currentSearchDepth`,
  )
  assert(
    Number(entry?.candidateDescriptorCount ?? -1) >= 0,
    `${label} missing candidateDescriptorCount`,
  )
  assert(
    Number(entry?.acceptedCandidateCount ?? -1) >= 0,
    `${label} missing acceptedCandidateCount`,
  )
  assert(
    Number(entry?.candidateDescriptorCount ?? -1) >= Number(entry?.acceptedCandidateCount ?? 0),
    `${label} requires candidateDescriptorCount >= acceptedCandidateCount`,
  )
  assert(
    Number(entry?.seedPostingCacheEntryLimit ?? -1) >= 0,
    `${label} missing seedPostingCacheEntryLimit`,
  )
  assert(Number(entry?.seedPositiveLoadCount ?? -1) >= 0, `${label} missing seedPositiveLoadCount`)
  assert(Number(entry?.seedNegativeLoadCount ?? -1) >= 0, `${label} missing seedNegativeLoadCount`)
  assert(Number(entry?.seedPostingLoadMs ?? -1) >= 0, `${label} missing seedPostingLoadMs`)
  assert(
    Number(entry?.candidateDescriptorBuildMs ?? -1) >= 0,
    `${label} missing candidateDescriptorBuildMs`,
  )
  assert(
    Number(entry?.negativeCountResolutionMs ?? -1) >= 0,
    `${label} missing negativeCountResolutionMs`,
  )
  assert(
    Number(entry?.childRowsetMaterializeMs ?? -1) >= 0,
    `${label} missing childRowsetMaterializeMs`,
  )
  assert(Number(entry?.rowsetIntersectionMs ?? -1) >= 0, `${label} missing rowsetIntersectionMs`)
  if (entry?.progressAgeMs != null) {
    assert(Number(entry?.progressAgeMs ?? -1) >= 0, `${label} invalid progressAgeMs`)
  }
}

const main = async () => {
  const cwd = process.cwd()
  assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_active_chunk_telemetry",
  })

  const rootDir = await findLatestIndexedEquivalenceRoot({ cwd })
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_active_chunk_telemetry")
  await ensureDir(rootDir)
  await fsp.rm(outDir, { recursive: true, force: true })
  await writeJson(path.join(rootDir, "parallel_active_chunk_telemetry_smoke_marker.json"), {
    createdAt: new Date().toISOString(),
  })

  const probe = await runParallelActiveChunkProbe({
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
  assert(probe.result, "Parallel active-chunk telemetry smoke parallel run did not return a result")
  assert(probe.finalManifest, "Parallel active-chunk telemetry smoke missing parallel_manifest.json")
  assert.equal(Number(probe.finalManifest?.version ?? 0), 14)
  assert(
    Number(probe.finalManifest?.parallelBudgetFastpathTickCount ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelBudgetFastpathTickCount",
  )
  assert(
    Number(probe.finalManifest?.parallelBudgetFastpathIdleTickCount ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelBudgetFastpathIdleTickCount",
  )
  assert(
    Number(probe.finalManifest?.parallelBudgetFastpathIdleSkipCount ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelBudgetFastpathIdleSkipCount",
  )
  assert(
    Number(probe.finalManifest?.parallelBudgetFastpathServiceCount ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelBudgetFastpathServiceCount",
  )
  assert(
    Number(probe.finalManifest?.parallelWorkerSlotCompletionPollCount ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelWorkerSlotCompletionPollCount",
  )
  assert(
    Number(probe.finalManifest?.parallelWorkerSlotCompletionSteadyPollCount ?? 0) >= 0,
    "Parallel active-chunk telemetry smoke expected non-negative parallelWorkerSlotCompletionSteadyPollCount",
  )

  const activeSnapshots = probe.observedProgressSnapshots.filter(
    (snapshot) =>
      String(snapshot?.phase ?? "") === "search_ready_queue" &&
      Number(snapshot?.parallelActiveChunkCount ?? 0) > 0,
  )
  assert(
    activeSnapshots.length > 0,
    "Parallel active-chunk telemetry smoke did not observe active search_ready_queue snapshots",
  )
  const activeSnapshot =
    activeSnapshots.find((snapshot) => snapshot.parallelActiveChunkSnapshots.length > 0) ??
    activeSnapshots.find((snapshot) => snapshot.parallelActiveChunks.length > 0) ??
    null
  assert(
    activeSnapshot,
    "Parallel active-chunk telemetry smoke did not observe parent-emitted active chunk telemetry",
  )
  const activeEntries =
    activeSnapshot.parallelActiveChunkSnapshots.length > 0
      ? activeSnapshot.parallelActiveChunkSnapshots
      : activeSnapshot.parallelActiveChunks
  assert(
    activeEntries.length === Number(activeSnapshot?.parallelActiveChunkCount ?? 0),
    "Parallel active-chunk telemetry smoke observed active chunk count mismatch",
  )
  activeEntries.forEach((entry, index) => {
    assertActiveChunkEntry(entry, `Parallel active-chunk telemetry smoke entry[${index}]`)
  })
  const allObservedActiveEntries = activeSnapshots.flatMap((snapshot) =>
    snapshot.parallelActiveChunkSnapshots.length > 0
      ? snapshot.parallelActiveChunkSnapshots
      : snapshot.parallelActiveChunks,
  )
  assert(
    allObservedActiveEntries.some((entry) => Number(entry?.seedPositiveLoadCount ?? 0) > 0),
    "Parallel active-chunk telemetry smoke expected seedPositiveLoadCount to become positive on the live worker path",
  )
  assert(
    allObservedActiveEntries.some((entry) => Number(entry?.seedPostingCacheEntryLimit ?? 0) > 0),
    "Parallel active-chunk telemetry smoke expected seedPostingCacheEntryLimit to become positive on the live worker path",
  )
  assert(
    allObservedActiveEntries.some((entry) => Number(entry?.seedPostingLoadMs ?? 0) > 0),
    "Parallel active-chunk telemetry smoke expected seedPostingLoadMs to become positive on the live worker path",
  )
  assert(
    activeEntries.some((entry) => String(entry?.progressUpdatedAt ?? "").trim().length > 0),
    "Parallel active-chunk telemetry smoke expected at least one active chunk with progressUpdatedAt",
  )
  assert(
    Number(activeSnapshot?.parallelBudgetFastpathHotTickCount ?? 0) <=
      Number(activeSnapshot?.parallelBudgetFastpathTickCount ?? 0),
    "Parallel active-chunk telemetry smoke observed hot fastpath ticks above serviced fastpath ticks",
  )
  assert(
    Number(activeSnapshot?.parallelBudgetFastpathServiceCount ?? 0) <=
      Number(activeSnapshot?.parallelBudgetFastpathTickCount ?? 0),
    "Parallel active-chunk telemetry smoke observed fastpath service count above serviced fastpath ticks",
  )
  assert(
    Number(activeSnapshot?.parallelBudgetFastpathIdleSkipCount ?? 0) <=
      Number(activeSnapshot?.parallelBudgetFastpathIdleTickCount ?? 0),
    "Parallel active-chunk telemetry smoke observed idle fastpath skips above idle ticks",
  )
  assert(
    Number(activeSnapshot?.parallelBudgetFastpathTickCount ?? 0) +
      Number(activeSnapshot?.parallelBudgetFastpathIdleSkipCount ?? 0) >=
      Number(activeSnapshot?.parallelBudgetFastpathIdleTickCount ?? 0) +
        Number(activeSnapshot?.parallelBudgetFastpathHotTickCount ?? 0),
    "Parallel active-chunk telemetry smoke observed inconsistent fastpath tick accounting",
  )
  assert(
    Number(activeSnapshot?.parallelWorkerSlotCompletionPollCount ?? 0) >=
      Number(activeSnapshot?.parallelWorkerSlotCompletionHotPollCount ?? 0) +
        Number(activeSnapshot?.parallelWorkerSlotCompletionSteadyPollCount ?? 0),
    "Parallel active-chunk telemetry smoke observed inconsistent worker-slot completion poll accounting",
  )
  const expectedSteadyPoll =
    activeEntries.some((entry) => {
      const phase = String(entry?.phase ?? "").trim().toLowerCase()
      const progressAgeMs = Number(entry?.progressAgeMs ?? Number.NaN)
      const completionFraction = Number(entry?.completionFraction ?? Number.NaN)
      const etaSeconds = Number(entry?.etaSeconds ?? Number.NaN)
      return (
        phase === "search" &&
        Number.isFinite(progressAgeMs) &&
        progressAgeMs <= 17000 &&
        Number.isFinite(completionFraction) &&
        completionFraction < 0.98 &&
        (!Number.isFinite(etaSeconds) || etaSeconds > 2)
      )
    }) ||
    activeSnapshots.some(
      (snapshot) => Number(snapshot?.parallelWorkerSlotCompletionSteadyPollCount ?? 0) > 0,
    )
  if (expectedSteadyPoll) {
    assert(
      Number(probe.finalManifest?.parallelWorkerSlotCompletionSteadyPollCount ?? 0) > 0,
      "Parallel active-chunk telemetry smoke expected positive steady completion polls once a long-running live search snapshot was observed",
    )
  }
  assert(
    Array.isArray(probe.finalProgress?.parallelLastObservedActiveChunkSnapshots) &&
      probe.finalProgress.parallelLastObservedActiveChunkSnapshots.length > 0,
    "Parallel active-chunk telemetry smoke expected final progress to retain the last observed active chunk snapshots",
  )
  assert(
    Number(probe.finalProgress?.parallelActiveChunkTelemetryRevision ?? 0) > 0,
    "Parallel active-chunk telemetry smoke expected positive parallelActiveChunkTelemetryRevision",
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        observedActiveSnapshotCount: activeSnapshots.length,
        activeChunkCount: Number(activeSnapshot?.parallelActiveChunkCount ?? 0),
        parallelBudgetFastpathTickCount: Number(
          probe.finalManifest?.parallelBudgetFastpathTickCount ?? 0,
        ),
        parallelBudgetFastpathIdleTickCount: Number(
          probe.finalManifest?.parallelBudgetFastpathIdleTickCount ?? 0,
        ),
        parallelBudgetFastpathIdleSkipCount: Number(
          probe.finalManifest?.parallelBudgetFastpathIdleSkipCount ?? 0,
        ),
        parallelBudgetFastpathServiceCount: Number(
          probe.finalManifest?.parallelBudgetFastpathServiceCount ?? 0,
        ),
        parallelWorkerSlotCompletionPollCount: Number(
          probe.finalManifest?.parallelWorkerSlotCompletionPollCount ?? 0,
        ),
        parallelWorkerSlotCompletionSteadyPollCount: Number(
          probe.finalManifest?.parallelWorkerSlotCompletionSteadyPollCount ?? 0,
        ),
        maxSeedPositiveLoadCount: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.seedPositiveLoadCount ?? 0)),
        ),
        maxSeedPostingCacheEntryLimit: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.seedPostingCacheEntryLimit ?? 0)),
        ),
        maxSeedNegativeLoadCount: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.seedNegativeLoadCount ?? 0)),
        ),
        maxSeedPostingLoadMs: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.seedPostingLoadMs ?? 0)),
        ),
        maxCandidateDescriptorBuildMs: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.candidateDescriptorBuildMs ?? 0)),
        ),
        maxNegativeCountResolutionMs: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.negativeCountResolutionMs ?? 0)),
        ),
        maxChildRowsetMaterializeMs: Math.max(
          ...allObservedActiveEntries.map((entry) => Number(entry?.childRowsetMaterializeMs ?? 0)),
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
