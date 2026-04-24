import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { assertPerfectPrototypeServerWorkspace } from "../src/lib/perfect_prototype_server_policy.mjs"

const STARTUP_PHASES = Object.freeze([
  "startup_preflight",
  "validate_index_provenance",
  "seed_selection",
  "seed_dictionary_planning",
  "head_microprobe_pass_1",
  "head_microprobe_pass_2",
  "singleton_exact_probe_stage1",
  "singleton_exact_probe_stage2",
  "ready_queue_built",
  "spawn_worker_slots",
  "search_ready_queue",
])

const STARTUP_PHASE_RANK = new Map(STARTUP_PHASES.map((phase, index) => [phase, index]))

const MANDATORY_STARTUP_PHASE_SUBSET = Object.freeze([
  "startup_preflight",
  "validate_index_provenance",
  "seed_selection",
  "seed_dictionary_planning",
  "head_microprobe_pass_1",
  "head_microprobe_pass_2",
  "singleton_exact_probe_stage1",
])

const PLANNING_TIMING_KEYS = Object.freeze([
  "parallelPlanningValidateIndexProvenanceMs",
  "parallelPlanningSeedSelectionMs",
  "parallelPlanningSeedDictionaryPlanningMs",
  "parallelPlanningHeadMicroprobePass1Ms",
  "parallelPlanningHeadMicroprobePass2Ms",
  "parallelPlanningExactProbeStage1Ms",
  "parallelPlanningExactProbeStage2Ms",
  "parallelPlanningReadyQueueMs",
])

const STAGE1_PROGRESS_KEYS = Object.freeze([
  "parallelPlanningExactProbeStage1ElapsedMs",
  "parallelPlanningExactProbeStage1ChunksCompleted",
  "parallelPlanningExactProbeStage1ChunkCount",
  "parallelPlanningExactProbeStage1ExploredStates",
  "parallelPlanningExactProbeStage1CurrentChunkIndex",
  "parallelPlanningExactProbeStage1HeartbeatRevision",
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
    throw new Error(`Parallel startup progress smoke expected JSON but found null: ${filePath}`)
  }
  return null
}

const findLatestIndexedEquivalenceRoot = async ({ cwd }) => {
  const checksRoot = path.join(cwd, "artifacts", "checks")
  if (!pathExists(checksRoot)) {
    throw new Error(
      "Parallel startup progress smoke requires artifacts/checks from smoke_prejump_indexed_equivalence.mjs",
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
      "Parallel startup progress smoke could not find a prior indexed equivalence summary under artifacts/checks",
    )
  }
  const summary = await readJson(latest.summaryPath, null)
  const rootDir = path.resolve(String(summary?.rootDir ?? "").trim())
  if (!rootDir || !pathExists(path.join(rootDir, "index"))) {
    throw new Error(
      `Parallel startup progress smoke found an invalid indexed equivalence root: ${latest.summaryPath}`,
    )
  }
  return rootDir
}

const runParallelWithStartupProgressProbe = async ({
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
      const phase = String(progress?.phase ?? "")
      const updatedAt = String(progress?.updatedAt ?? "")
      const snapshotKey = JSON.stringify({
        updatedAt,
        phase,
        parallelPlanningExactProbeStage1ElapsedMs: Number(
          progress?.parallelPlanningExactProbeStage1ElapsedMs ?? 0,
        ),
        parallelPlanningExactProbeStage1ChunksCompleted: Number(
          progress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0,
        ),
        parallelPlanningExactProbeStage1HeartbeatRevision: Number(
          progress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0,
        ),
      })
      if (!seenSnapshotKeys.has(snapshotKey)) {
        seenSnapshotKeys.add(snapshotKey)
        observedProgressSnapshots.push({
          phase,
          updatedAt,
          parallelFirstTopLevelProgressElapsedMs: Number(
            progress?.parallelFirstTopLevelProgressElapsedMs ?? 0,
          ),
          parallelPlanningValidateIndexProvenanceMs: Number(
            progress?.parallelPlanningValidateIndexProvenanceMs ?? 0,
          ),
          parallelPlanningSeedSelectionMs: Number(progress?.parallelPlanningSeedSelectionMs ?? 0),
          parallelPlanningSeedDictionaryPlanningMs: Number(
            progress?.parallelPlanningSeedDictionaryPlanningMs ?? 0,
          ),
          parallelPlanningHeadMicroprobePass1Ms: Number(
            progress?.parallelPlanningHeadMicroprobePass1Ms ?? 0,
          ),
          parallelPlanningHeadMicroprobePass2Ms: Number(
            progress?.parallelPlanningHeadMicroprobePass2Ms ?? 0,
          ),
          parallelPlanningExactProbeStage1Ms: Number(
            progress?.parallelPlanningExactProbeStage1Ms ?? 0,
          ),
          parallelPlanningExactProbeStage2Ms: Number(
            progress?.parallelPlanningExactProbeStage2Ms ?? 0,
          ),
          parallelPlanningReadyQueueMs: Number(progress?.parallelPlanningReadyQueueMs ?? 0),
          parallelPlanningExactProbeStage1ElapsedMs: Number(
            progress?.parallelPlanningExactProbeStage1ElapsedMs ?? 0,
          ),
          parallelPlanningExactProbeStage1ChunksCompleted: Number(
            progress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0,
          ),
          parallelPlanningExactProbeStage1ChunkCount: Number(
            progress?.parallelPlanningExactProbeStage1ChunkCount ?? 0,
          ),
          parallelPlanningExactProbeStage1ExploredStates: Number(
            progress?.parallelPlanningExactProbeStage1ExploredStates ?? 0,
          ),
          parallelPlanningExactProbeStage1CurrentChunkIndex: Number(
            progress?.parallelPlanningExactProbeStage1CurrentChunkIndex ?? -1,
          ),
          parallelPlanningExactProbeStage1HeartbeatRevision: Number(
            progress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0,
          ),
        })
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
  }
}

const assertMonotonicStartupPhaseAdvance = (snapshots, finalProgress = null) => {
  const observedStartupPhases = snapshots
    .map((snapshot) => String(snapshot?.phase ?? ""))
    .filter((phase) => STARTUP_PHASE_RANK.has(phase))
  assert(
    observedStartupPhases.length > 0,
    "Parallel startup progress smoke did not observe any startup planning phase in progress.json",
  )
  const finalStartupPhaseHistory = Array.isArray(finalProgress?.parallelStartupPhaseHistory)
    ? finalProgress.parallelStartupPhaseHistory
        .map((phase) => String(phase ?? ""))
        .filter((phase) => STARTUP_PHASE_RANK.has(phase))
    : []
  const startupPhases =
    finalStartupPhaseHistory.length > 0 ? finalStartupPhaseHistory : observedStartupPhases
  const distinctStartupPhases = startupPhases.filter(
    (phase, index, list) => index === 0 || phase !== list[index - 1],
  )
  assert(
    distinctStartupPhases.length >= 2,
    "Parallel startup progress smoke expected progress.json to advance through at least two startup phases",
  )
  for (let index = 1; index < distinctStartupPhases.length; index += 1) {
    const previousRank = STARTUP_PHASE_RANK.get(distinctStartupPhases[index - 1])
    const currentRank = STARTUP_PHASE_RANK.get(distinctStartupPhases[index])
    assert(
      Number.isInteger(previousRank) &&
        Number.isInteger(currentRank) &&
        currentRank >= previousRank,
      `Parallel startup progress smoke observed non-monotonic startup phases: ${distinctStartupPhases.join(" -> ")}`,
    )
  }
  let cursor = 0
  for (const phase of MANDATORY_STARTUP_PHASE_SUBSET) {
    while (cursor < distinctStartupPhases.length && distinctStartupPhases[cursor] !== phase) {
      cursor += 1
    }
    assert(
      cursor < distinctStartupPhases.length,
      `Parallel startup progress smoke missing mandatory startup phase: ${phase}; observed=${distinctStartupPhases.join(" -> ")}`,
    )
    cursor += 1
  }
  return distinctStartupPhases
}

const assertPlanningTelemetry = (progress) => {
  assert(
    Number(progress?.parallelFirstTopLevelProgressElapsedMs ?? 0) > 0,
    "Parallel startup progress smoke missing positive parallelFirstTopLevelProgressElapsedMs",
  )
  for (const key of PLANNING_TIMING_KEYS) {
    const value = Number(progress?.[key] ?? Number.NaN)
    const isStrictlyPositive = key === "parallelPlanningExactProbeStage1Ms"
    assert(
      Number.isFinite(value) && (isStrictlyPositive ? value > 0 : value >= 0),
      `Parallel startup progress smoke expected ${
        isStrictlyPositive ? "positive" : "non-negative"
      } planning telemetry for ${key}: actual=${String(progress?.[key])}`,
    )
  }
}

const buildFinalStage1TelemetrySnapshot = (progress) => {
  if (!progress || typeof progress !== "object") return null
  const elapsedMs = Number(progress?.parallelPlanningExactProbeStage1ElapsedMs ?? 0)
  const chunksCompleted = Number(progress?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0)
  const heartbeatRevision = Number(progress?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0)
  const chunkCount = Number(progress?.parallelPlanningExactProbeStage1ChunkCount ?? 0)
  if (
    elapsedMs <= 0 &&
    chunksCompleted <= 0 &&
    heartbeatRevision <= 0 &&
    chunkCount <= 0
  ) {
    return null
  }
  return {
    phase: "singleton_exact_probe_stage1",
    updatedAt: String(progress?.updatedAt ?? ""),
    parallelPlanningExactProbeStage1ElapsedMs: elapsedMs,
    parallelPlanningExactProbeStage1ChunksCompleted: chunksCompleted,
    parallelPlanningExactProbeStage1ChunkCount: chunkCount,
    parallelPlanningExactProbeStage1ExploredStates: Number(
      progress?.parallelPlanningExactProbeStage1ExploredStates ?? 0,
    ),
    parallelPlanningExactProbeStage1CurrentChunkIndex: Number(
      progress?.parallelPlanningExactProbeStage1CurrentChunkIndex ?? -1,
    ),
    parallelPlanningExactProbeStage1HeartbeatRevision: heartbeatRevision,
  }
}

const assertStage1LiveHeartbeat = (snapshots, finalProgress = null) => {
  const stage1Snapshots = snapshots.filter(
    (snapshot) => String(snapshot?.phase ?? "") === "singleton_exact_probe_stage1",
  )
  assert(
    stage1Snapshots.length > 0,
    "Parallel startup progress smoke did not observe singleton_exact_probe_stage1 in progress.json",
  )
  const withPositiveChunkCount = stage1Snapshots.find(
    (snapshot) => Number(snapshot?.parallelPlanningExactProbeStage1ChunkCount ?? 0) > 0,
  )
  assert(
    withPositiveChunkCount,
    "Parallel startup progress smoke missing positive parallelPlanningExactProbeStage1ChunkCount during stage1",
  )
  for (const key of STAGE1_PROGRESS_KEYS) {
    const value = Number(
      stage1Snapshots.find((snapshot) => Number.isFinite(Number(snapshot?.[key] ?? Number.NaN)))?.[key] ??
        Number.NaN,
    )
    assert(
      Number.isFinite(value),
      `Parallel startup progress smoke missing stage1 progress telemetry for ${key}`,
    )
  }
  const heartbeatSnapshots = stage1Snapshots.filter(
    (snapshot) =>
      Number(snapshot?.parallelPlanningExactProbeStage1ElapsedMs ?? 0) > 0 ||
      Number(snapshot?.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) > 0,
  )
  const finalStage1TelemetrySnapshot = buildFinalStage1TelemetrySnapshot(finalProgress)
  const stableHeartbeatSnapshots =
    finalStage1TelemetrySnapshot == null
      ? heartbeatSnapshots
      : [...heartbeatSnapshots, finalStage1TelemetrySnapshot]
  assert(
    stableHeartbeatSnapshots.length > 0,
    "Parallel startup progress smoke did not observe a live singleton_exact_probe_stage1 heartbeat snapshot",
  )
  const withCompletedChunkProgress = stableHeartbeatSnapshots.find(
    (snapshot) => Number(snapshot?.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) > 0,
  )
  assert(
    withCompletedChunkProgress,
    "Parallel startup progress smoke did not observe stage1 chunk-completion progress during live heartbeat",
  )
  for (let index = 1; index < stage1Snapshots.length; index += 1) {
    const previous = stage1Snapshots[index - 1]
    const current = stage1Snapshots[index]
    assert(
      Number(current.parallelPlanningExactProbeStage1ElapsedMs ?? 0) >=
        Number(previous.parallelPlanningExactProbeStage1ElapsedMs ?? 0),
      "Parallel startup progress smoke observed stage1 elapsed regression across heartbeat snapshots",
    )
    assert(
      Number(current.parallelPlanningExactProbeStage1ChunksCompleted ?? 0) >=
        Number(previous.parallelPlanningExactProbeStage1ChunksCompleted ?? 0),
      "Parallel startup progress smoke observed stage1 completed chunk regression across heartbeat snapshots",
    )
    assert(
      Number(current.parallelPlanningExactProbeStage1ExploredStates ?? 0) >=
        Number(previous.parallelPlanningExactProbeStage1ExploredStates ?? 0),
      "Parallel startup progress smoke observed stage1 explored-state regression across heartbeat snapshots",
    )
    assert(
      Number(current.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0) >=
        Number(previous.parallelPlanningExactProbeStage1HeartbeatRevision ?? 0),
      "Parallel startup progress smoke observed stage1 heartbeat revision regression",
    )
  }
  return {
    stage1SnapshotCount: stage1Snapshots.length,
    stage1HeartbeatSnapshotCount: stableHeartbeatSnapshots.length,
    stage1HeartbeatUsedFinalProgressFallback:
      heartbeatSnapshots.length < stableHeartbeatSnapshots.length,
    lastStage1ElapsedMs: Number(
      stableHeartbeatSnapshots[stableHeartbeatSnapshots.length - 1]
        ?.parallelPlanningExactProbeStage1ElapsedMs ?? 0,
    ),
  }
}

const main = async () => {
  const cwd = process.cwd()
  assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_startup_progress_emission",
  })
  const rootDir = await findLatestIndexedEquivalenceRoot({ cwd })
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_startup_progress_emission")
  await ensureDir(rootDir)
  await fsp.rm(outDir, { recursive: true, force: true })

  const probe = await runParallelWithStartupProgressProbe({
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
    pollIntervalMs: 5,
  })

  assert.equal(probe.failure, null, probe.failure?.stack ?? probe.failure?.message ?? null)
  assert(probe.result, "Parallel startup progress smoke returned no result")
  assert(probe.finalProgress, "Parallel startup progress smoke missing final progress.json")
  assert(
    probe.observedProgressSnapshots.length > 0,
    "Parallel startup progress smoke observed no pre-completion progress snapshots",
  )
  const distinctStartupPhases = assertMonotonicStartupPhaseAdvance(
    probe.observedProgressSnapshots,
    probe.finalProgress,
  )
  const stage1Heartbeat = assertStage1LiveHeartbeat(
    probe.observedProgressSnapshots,
    probe.finalProgress,
  )
  assertPlanningTelemetry(probe.finalProgress)

  const summary = {
    status: "ok",
    rootDir,
    outDir,
    observedProgressSnapshotCount: probe.observedProgressSnapshots.length,
    observedStartupPhases: distinctStartupPhases,
    startupPhaseHistory: Array.isArray(probe.finalProgress?.parallelStartupPhaseHistory)
      ? probe.finalProgress.parallelStartupPhaseHistory
      : [],
    mandatoryStartupPhaseSubset: MANDATORY_STARTUP_PHASE_SUBSET,
    finalPhase: String(probe.finalProgress?.phase ?? ""),
    stage1Heartbeat,
    parallelFirstTopLevelProgressElapsedMs: Number(
      probe.finalProgress?.parallelFirstTopLevelProgressElapsedMs ?? 0,
    ),
    planningTelemetry: Object.fromEntries(
      PLANNING_TIMING_KEYS.map((key) => [key, Number(probe.finalProgress?.[key] ?? 0)]),
    ),
  }
  await writeJson(path.join(rootDir, "parallel_startup_progress_emission_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
