import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { assertPerfectPrototypeServerWorkspace } from "../src/lib/perfect_prototype_server_policy.mjs"

const COUNTER_KEYS = Object.freeze([
  "parallelPlanningReadyQueueRebuildCount",
  "parallelPlanningRescoredChunkCount",
  "parallelPlanningMicroprobeReuseCount",
])

const SPLIT_TIMING_KEYS = Object.freeze([
  "parallelPlanningFirstWaveFrontierSplitMs",
  "parallelPlanningFirstWaveLaunchSplitMs",
  "parallelPlanningRootSeedMicroshardMs",
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
    throw new Error(`Parallel prelaunch reuse smoke expected JSON but found null: ${filePath}`)
  }
  return null
}

const findLatestIndexedEquivalenceRoot = async ({ cwd }) => {
  const checksRoot = path.join(cwd, "artifacts", "checks")
  if (!pathExists(checksRoot)) {
    throw new Error(
      "Parallel prelaunch reuse smoke requires artifacts/checks from smoke_prejump_indexed_equivalence.mjs",
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
      "Parallel prelaunch reuse smoke could not find a prior indexed equivalence summary under artifacts/checks",
    )
  }
  const summary = await readJson(latest.summaryPath, null)
  const rootDir = path.resolve(String(summary?.rootDir ?? "").trim())
  if (!rootDir || !pathExists(path.join(rootDir, "index"))) {
    throw new Error(
      `Parallel prelaunch reuse smoke found an invalid indexed equivalence root: ${latest.summaryPath}`,
    )
  }
  return rootDir
}

const runParallelReuseAccountingProbe = async ({
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
        parallelPlanningReadyQueueRebuildCount: Number(
          progress?.parallelPlanningReadyQueueRebuildCount ?? 0,
        ),
        parallelPlanningRescoredChunkCount: Number(
          progress?.parallelPlanningRescoredChunkCount ?? 0,
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

const assertNonNegativeFiniteTelemetry = ({ payload, keys, label }) => {
  for (const key of keys) {
    const value = Number(payload?.[key] ?? Number.NaN)
    assert(
      Number.isFinite(value) && value >= 0,
      `${label} missing non-negative telemetry for ${key}: actual=${String(payload?.[key])}`,
    )
  }
}

const assertMonotonicAccountingSnapshots = (snapshots) => {
  let previous = null
  for (const snapshot of snapshots) {
    if (previous) {
      for (const key of COUNTER_KEYS) {
        assert(
          Number(snapshot?.[key] ?? 0) >= Number(previous?.[key] ?? 0),
          `Parallel prelaunch reuse smoke observed ${key} regression across progress snapshots`,
        )
      }
    }
    previous = snapshot
  }
}

const assertConsistentFinalAccounting = ({ finalProgress, finalManifest }) => {
  assert(finalProgress, "Parallel prelaunch reuse smoke missing final progress.json")
  assert(finalManifest, "Parallel prelaunch reuse smoke missing parallel_manifest.json")
  assertNonNegativeFiniteTelemetry({
    payload: finalProgress,
    keys: [...COUNTER_KEYS, ...SPLIT_TIMING_KEYS],
    label: "Parallel prelaunch reuse smoke final progress",
  })
  assertNonNegativeFiniteTelemetry({
    payload: finalManifest,
    keys: [...COUNTER_KEYS, ...SPLIT_TIMING_KEYS],
    label: "Parallel prelaunch reuse smoke final manifest",
  })
  for (const key of [...COUNTER_KEYS, ...SPLIT_TIMING_KEYS]) {
    assert.equal(
      Number(finalProgress?.[key] ?? Number.NaN),
      Number(finalManifest?.[key] ?? Number.NaN),
      `Parallel prelaunch reuse smoke expected matching ${key} between progress.json and parallel_manifest.json`,
    )
  }
  assert(
    Number(finalProgress?.parallelPlanningReadyQueueRebuildCount ?? 0) >= 1,
    "Parallel prelaunch reuse smoke expected at least one ready-queue rebuild",
  )
  assert(
    Number(finalProgress?.parallelPlanningRescoredChunkCount ?? 0) > 0,
    "Parallel prelaunch reuse smoke expected positive rescored chunk count",
  )
  assert(
    Number(finalProgress?.parallelPlanningMicroprobeReuseCount ?? 0) > 0,
    "Parallel prelaunch reuse smoke expected positive microprobe reuse count",
  )
}

const main = async () => {
  const cwd = process.cwd()
  assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_prelaunch_probe_reuse_accounting",
  })
  const rootDir = await findLatestIndexedEquivalenceRoot({ cwd })
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_prelaunch_probe_reuse_accounting")
  await ensureDir(rootDir)
  await fsp.rm(outDir, { recursive: true, force: true })

  const probe = await runParallelReuseAccountingProbe({
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
  assert(probe.result, "Parallel prelaunch reuse smoke returned no result")
  assert(
    probe.observedProgressSnapshots.length > 0,
    "Parallel prelaunch reuse smoke observed no pre-completion progress snapshots",
  )
  assertMonotonicAccountingSnapshots(probe.observedProgressSnapshots)
  assertConsistentFinalAccounting({
    finalProgress: probe.finalProgress,
    finalManifest: probe.finalManifest,
  })

  const summary = {
    status: "ok",
    rootDir,
    outDir,
    observedProgressSnapshotCount: probe.observedProgressSnapshots.length,
    finalPhase: String(probe.finalProgress?.phase ?? ""),
    counters: Object.fromEntries(
      COUNTER_KEYS.map((key) => [key, Number(probe.finalProgress?.[key] ?? 0)]),
    ),
    splitTimings: Object.fromEntries(
      SPLIT_TIMING_KEYS.map((key) => [key, Number(probe.finalProgress?.[key] ?? 0)]),
    ),
  }
  await writeJson(path.join(rootDir, "parallel_prelaunch_probe_reuse_accounting_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
