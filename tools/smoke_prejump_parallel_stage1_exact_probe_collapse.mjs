import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { assertPerfectPrototypeServerWorkspace } from "../src/lib/perfect_prototype_server_policy.mjs"

const STAGE1_KEYS = Object.freeze([
  "parallelPlanningExactProbeStage1Ms",
  "parallelPlanningExactProbeStage1ElapsedMs",
  "parallelPlanningExactProbeStage1ChunksCompleted",
  "parallelPlanningExactProbeStage1ChunkCount",
  "parallelPlanningExactProbeStage1ExploredStates",
  "parallelPlanningExactProbeStage1CurrentChunkIndex",
  "parallelPlanningExactProbeStage1InFlightChunkCount",
  "parallelPlanningExactProbeStage1PendingChunkCount",
  "parallelPlanningExactProbeStage1Concurrency",
  "parallelPlanningExactProbeStage1HeartbeatRevision",
])

const REUSE_KEYS = Object.freeze([
  "parallelPlanningReadyQueueRebuildCount",
  "parallelPlanningRescoredChunkCount",
  "parallelPlanningMicroprobeReuseCount",
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readControlPlaneJsonSnapshot = async (filePath, retryCount = 2) => {
  const payload = await readJsonIfExistsStrict(filePath)
  if (payload !== null) return payload
  if (pathExists(filePath)) {
    if (retryCount > 0) {
      await sleep(5)
      return readControlPlaneJsonSnapshot(filePath, retryCount - 1)
    }
    throw new Error(`Parallel stage1 exact-probe collapse smoke expected JSON but found null: ${filePath}`)
  }
  return null
}

const findLatestIndexedEquivalenceRoot = async ({ cwd }) => {
  const checksRoot = path.join(cwd, "artifacts", "checks")
  if (!pathExists(checksRoot)) {
    throw new Error(
      "Parallel stage1 exact-probe collapse smoke requires artifacts/checks from smoke_prejump_indexed_equivalence.mjs",
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
      "Parallel stage1 exact-probe collapse smoke could not find a prior indexed equivalence summary under artifacts/checks",
    )
  }
  const summary = await readJson(latest.summaryPath, null)
  const rootDir = path.resolve(String(summary?.rootDir ?? "").trim())
  if (!rootDir || !pathExists(path.join(rootDir, "index"))) {
    throw new Error(
      `Parallel stage1 exact-probe collapse smoke found an invalid indexed equivalence root: ${latest.summaryPath}`,
    )
  }
  return rootDir
}

const runParallelStage1CollapseProbe = async ({
  cwd,
  indexDir,
  outDir,
  options,
  pollIntervalMs = 5,
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
        parallelPlanningExactProbeStage1ElapsedMs: Number(
          progress?.parallelPlanningExactProbeStage1ElapsedMs ?? 0,
        ),
        parallelPlanningExactProbeStage1ChunksCompleted: Number(
          progress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0,
        ),
        parallelPlanningExactProbeStage1ChunkCount: Number(
          progress?.parallelPlanningExactProbeStage1ChunkCount ?? 0,
        ),
        parallelPlanningExactProbeStage1CurrentChunkIndex: Number(
          progress?.parallelPlanningExactProbeStage1CurrentChunkIndex ?? -1,
        ),
        parallelPlanningExactProbeStage1InFlightChunkCount: Number(
          progress?.parallelPlanningExactProbeStage1InFlightChunkCount ?? 0,
        ),
        parallelPlanningExactProbeStage1PendingChunkCount: Number(
          progress?.parallelPlanningExactProbeStage1PendingChunkCount ?? 0,
        ),
        parallelPlanningExactProbeStage1Concurrency: Number(
          progress?.parallelPlanningExactProbeStage1Concurrency ?? 1,
        ),
        parallelPlanningExactProbeStage1HeartbeatRevision: Number(
          progress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0,
        ),
        parallelPlanningMicroprobeReuseCount: Number(
          progress?.parallelPlanningMicroprobeReuseCount ?? 0,
        ),
      }
      const snapshotKey = JSON.stringify(snapshot)
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

const assertFiniteNonNegative = ({ payload, keys, label }) => {
  for (const key of keys) {
    const value = Number(payload?.[key] ?? Number.NaN)
    assert(
      Number.isFinite(value) && value >= 0,
      `${label} missing non-negative telemetry for ${key}: actual=${String(payload?.[key])}`,
    )
  }
}

const assertObservedStage1Progress = ({ snapshots, finalProgress = null }) => {
  const stage1Snapshots = snapshots.filter(
    (snapshot) => String(snapshot?.phase ?? "") === "singleton_exact_probe_stage1",
  )
  assert(
    stage1Snapshots.length > 0,
    "Parallel stage1 exact-probe collapse smoke did not observe singleton_exact_probe_stage1 snapshots",
  )
  const heartbeatSnapshot = stage1Snapshots.find(
    (snapshot) =>
      Number(snapshot?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) > 0 &&
      Number(snapshot?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) > 0,
  )
  const finalHeartbeatWithCompletedChunks =
    Number(finalProgress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) > 0 &&
    Number(finalProgress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) > 0
  assert(
    heartbeatSnapshot || finalHeartbeatWithCompletedChunks,
    "Parallel stage1 exact-probe collapse smoke did not observe live stage1 heartbeat with completed chunk progress",
  )
  return {
    stage1SnapshotCount: stage1Snapshots.length,
    heartbeatSnapshotCount: stage1Snapshots.filter(
      (snapshot) => Number(snapshot?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) > 0,
    ).length,
    concurrentStage1SnapshotCount: stage1Snapshots.filter(
      (snapshot) =>
        Number(snapshot?.parallelPlanningExactProbeStage1Concurrency ?? 1) > 1 &&
        Number(snapshot?.parallelPlanningExactProbeStage1InFlightChunkCount ?? 0) > 1,
    ).length,
  }
}

const assertFinalStage1CollapseTelemetry = ({ finalProgress, finalManifest }) => {
  assert(finalProgress, "Parallel stage1 exact-probe collapse smoke missing final progress.json")
  assert(finalManifest, "Parallel stage1 exact-probe collapse smoke missing parallel_manifest.json")
  assertFiniteNonNegative({
    payload: finalProgress,
    keys: [...STAGE1_KEYS, ...REUSE_KEYS],
    label: "Parallel stage1 exact-probe collapse smoke final progress",
  })
  assertFiniteNonNegative({
    payload: finalManifest,
    keys: [...STAGE1_KEYS, ...REUSE_KEYS],
    label: "Parallel stage1 exact-probe collapse smoke final manifest",
  })
  for (const key of [...STAGE1_KEYS, ...REUSE_KEYS]) {
    assert.equal(
      Number(finalProgress?.[key] ?? Number.NaN),
      Number(finalManifest?.[key] ?? Number.NaN),
      `Parallel stage1 exact-probe collapse smoke expected matching ${key} between progress.json and parallel_manifest.json`,
    )
  }
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1Ms ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected positive stage1 planning time",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1ElapsedMs ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected positive live stage1 elapsed time",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1ChunkCount ?? 0) > 1,
    "Parallel stage1 exact-probe collapse smoke expected more than one stage1 chunk candidate in the small fixture",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected completed stage1 chunk progress",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) <=
      Number(finalProgress?.parallelPlanningExactProbeStage1ChunkCount ?? 0),
    "Parallel stage1 exact-probe collapse smoke observed completed stage1 chunks above chunk count",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected positive stage1 heartbeat revision",
  )
  assert(
    Number(finalProgress?.parallelPlanningExactProbeStage1Concurrency ?? 1) > 1,
    "Parallel stage1 exact-probe collapse smoke expected stage1 concurrency above 1 on the canonical runtime path",
  )
  assert(
    Number(finalProgress?.parallelPlanningMicroprobeReuseCount ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected positive microprobe reuse telemetry",
  )
  assert(
    Number(finalProgress?.parallelPlanningReadyQueueRebuildCount ?? 0) >= 1,
    "Parallel stage1 exact-probe collapse smoke expected at least one ready-queue rebuild",
  )
  assert(
    Number(finalProgress?.parallelPlanningRescoredChunkCount ?? 0) > 0,
    "Parallel stage1 exact-probe collapse smoke expected positive rescored chunk count",
  )
  const currentChunkIndex = Number(finalProgress?.parallelPlanningExactProbeStage1CurrentChunkIndex ?? -1)
  const chunkCount = Number(finalProgress?.parallelPlanningExactProbeStage1ChunkCount ?? 0)
  assert(
    currentChunkIndex === -1 || (currentChunkIndex >= 0 && currentChunkIndex < chunkCount),
    "Parallel stage1 exact-probe collapse smoke observed invalid current stage1 chunk index",
  )
}

const main = async () => {
  const cwd = process.cwd()
  assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_stage1_exact_probe_collapse",
  })
  const rootDir = await findLatestIndexedEquivalenceRoot({ cwd })
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_stage1_exact_probe_collapse")
  await ensureDir(rootDir)
  await fsp.rm(outDir, { recursive: true, force: true })

  const probe = await runParallelStage1CollapseProbe({
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

  assert.equal(probe.failure, null, probe.failure?.stack ?? probe.failure?.message ?? null)
  assert(probe.result, "Parallel stage1 exact-probe collapse smoke returned no result")
  assert(
    probe.observedProgressSnapshots.length > 0,
    "Parallel stage1 exact-probe collapse smoke observed no pre-completion progress snapshots",
  )
  const observedStage1 = assertObservedStage1Progress({
    snapshots: probe.observedProgressSnapshots,
    finalProgress: probe.finalProgress,
  })
  assertFinalStage1CollapseTelemetry({
    finalProgress: probe.finalProgress,
    finalManifest: probe.finalManifest,
  })

  const summary = {
    status: "ok",
    rootDir,
    outDir,
    observedProgressSnapshotCount: probe.observedProgressSnapshots.length,
    observedStage1,
    finalPhase: String(probe.finalProgress?.phase ?? ""),
    stage1: Object.fromEntries(STAGE1_KEYS.map((key) => [key, Number(probe.finalProgress?.[key] ?? 0)])),
    reuse: Object.fromEntries(REUSE_KEYS.map((key) => [key, Number(probe.finalProgress?.[key] ?? 0)])),
  }
  await writeJson(path.join(rootDir, "parallel_stage1_exact_probe_collapse_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
