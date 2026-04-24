import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const spawnNode = async ({ cwd, scriptPath, args = [] }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.setEncoding("utf8")
    proc.stderr.setEncoding("utf8")
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    proc.once("error", reject)
    proc.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          [
            "Predictive indexed live partial floor smoke worker failed",
            `script=${scriptPath}`,
            `exitCode=${Number(code ?? 1)}`,
            stdout ? `stdout=${stdout.trim()}` : null,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    })
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readControlPlaneJsonSnapshot = async (filePath) => {
  const payload = await readJsonIfExistsStrict(filePath)
  if (payload !== null) return payload
  if (pathExists(filePath)) {
    throw new Error(`Parallel live partial floor smoke expected a JSON object but found null: ${filePath}`)
  }
  return null
}

const runParallelWithLivePartialFloorProbe = async ({
  cwd,
  indexDir,
  outDir,
  options,
  pollIntervalMs = 100,
}) => {
  let settled = false
  let result = null
  let failure = null
  const observedProgressSnapshots = []
  const observedLiveFloorSnapshots = []
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
  const liveFloorPath = path.join(outDir, "live_floor.json")
  while (!settled) {
    await sleep(pollIntervalMs)
    const progress = await readControlPlaneJsonSnapshot(progressPath)
    if (progress) {
      observedProgressSnapshots.push({
        phase: String(progress?.phase ?? ""),
        parallelCompletedChunkCount: Number(progress?.parallelCompletedChunkCount ?? 0),
        parallelGlobalKthHitFloor: Number(progress?.parallelGlobalKthHitFloor ?? 0),
        parallelLiveFloorRevision: Number(progress?.parallelLiveFloorRevision ?? 0),
        parallelLivePartialRuleRevisionCount: Number(
          progress?.parallelLivePartialRuleRevisionCount ?? 0,
        ),
        parallelLivePartialFloorUpdateCount: Number(
          progress?.parallelLivePartialFloorUpdateCount ?? 0,
        ),
        parallelActiveLiveRuleCount: Number(progress?.parallelActiveLiveRuleCount ?? 0),
      })
    }
    const liveFloor = await readControlPlaneJsonSnapshot(liveFloorPath)
    if (liveFloor) {
      observedLiveFloorSnapshots.push({
        revision: Number(liveFloor?.revision ?? 0),
        kthHitFloor: Number(liveFloor?.kthHitFloor ?? 0),
        observedRuleCount: Number(liveFloor?.observedRuleCount ?? 0),
      })
    }
  }
  await completionPromise
  return {
    result,
    failure,
    observedProgressSnapshots,
    observedLiveFloorSnapshots,
    finalProgress: await readControlPlaneJsonSnapshot(progressPath),
    manifest: await readControlPlaneJsonSnapshot(path.join(outDir, "parallel_manifest.json")),
  }
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_live_partial_floor",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_live_partial_floor",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Parallel live partial floor smoke missing rootDir from indexed adversarial smoke output")
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_live_partial_floor",
  })

  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_live_partial_floor")
  await ensureDir(rootDir)
  const options = {
    trainStartDate: "2024-01-02",
    trainEndDate: "2024-01-15",
    minHitCount: 1,
    maxGapTradingDays: 100000,
    maxRuleSize: 6,
    maxSeedTokens: 4000,
    maxRules: 1,
    maxSearchStates: 20000000,
    maxRejectedRuleSamples: 1000,
    searchStateCacheMaxBytes: 32 * 1024,
    orderingHeadWindow: 8,
    workers: 2,
  }

  const probe = await runParallelWithLivePartialFloorProbe({
    cwd,
    indexDir,
    outDir,
    options,
  })
  assert.equal(probe.failure, null, probe.failure?.stack ?? probe.failure?.message ?? null)
  assert(probe.result, "Parallel live partial floor smoke returned no result")
  assert(probe.manifest, "Parallel live partial floor smoke missing manifest")
  assert.equal(Number(probe.manifest?.version ?? 0), 6)
  assert(probe.observedProgressSnapshots.length > 0, "Parallel live partial floor smoke observed no progress snapshots")
  assert(
    Number(probe.manifest?.parallelBootstrapChunkCount ?? 0) > 0,
    "Parallel live partial floor smoke missing bootstrap chunk count",
  )
  assert(
    probe.observedLiveFloorSnapshots.some(
      (snapshot) => Number(snapshot?.revision ?? 0) > 0 && Number(snapshot?.kthHitFloor ?? 0) > 0,
    ),
    "Parallel live partial floor smoke observed no raised live floor snapshots",
  )
  const chunkRuns = Array.isArray(probe.manifest?.chunkRuns) ? probe.manifest.chunkRuns : []
  assert(chunkRuns.length > 0, "Parallel live partial floor smoke missing chunkRuns")
  const earliestChunkLaunchAtMs = Math.min(
    ...chunkRuns.map((chunkRun) => Date.parse(String(chunkRun?.launchedAt ?? ""))),
  )
  const floorSeededChunkRuns = chunkRuns.filter(
    (chunkRun) => Number(chunkRun?.initialKthHitFloor ?? 0) > 0,
  )
  assert(
    floorSeededChunkRuns.length > 0,
    "Parallel live partial floor smoke did not launch any floor-seeded later chunks",
  )
  const firstFloorSeededLaunchElapsedMs =
    Math.min(
      ...floorSeededChunkRuns.map((chunkRun) => Date.parse(String(chunkRun?.launchedAt ?? ""))),
    ) - earliestChunkLaunchAtMs
  assert(
    Number.isFinite(firstFloorSeededLaunchElapsedMs) && firstFloorSeededLaunchElapsedMs > 0,
    "Parallel live partial floor smoke could not derive floor-seeded launch timing",
  )
  const earlyLiveFloorSnapshot = probe.observedProgressSnapshots.find(
    (snapshot) =>
      Number(snapshot?.parallelGlobalKthHitFloor ?? 0) > 0 &&
      Number(snapshot?.parallelCompletedChunkCount ?? 0) === 0,
  )
  assert(
    Number(probe.manifest?.parallelFirstLivePartialFloorElapsedMs ?? 0) > 0,
    "Parallel live partial floor smoke did not record first live partial floor timing",
  )
  assert(
    Number(probe.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0) > 0,
    "Parallel live partial floor smoke did not record first chunk completion timing",
  )
  assert(
    Number(probe.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0) > 0,
    "Parallel live partial floor smoke did not record first bootstrap floor timing",
  )
  assert(
    Number(probe.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0) <=
      Number(probe.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0),
    "Parallel live partial floor smoke did not raise bootstrap floor before first chunk completion",
  )
  assert(
    Number(probe.manifest?.parallelFirstLivePartialFloorElapsedMs ?? 0) <
      firstFloorSeededLaunchElapsedMs,
    "Parallel live partial floor smoke did not raise a live partial floor before later seeded chunk launch",
  )
  if (earlyLiveFloorSnapshot) {
    assert(
      Number(earlyLiveFloorSnapshot?.parallelLivePartialFloorUpdateCount ?? 0) > 0,
      "Parallel live partial floor smoke did not record a live partial floor update before first chunk completion",
    )
    assert(
      Number(earlyLiveFloorSnapshot?.parallelLivePartialRuleRevisionCount ?? 0) > 0,
      "Parallel live partial floor smoke did not observe live partial-rule revisions before first chunk completion",
    )
    assert(
      Number(earlyLiveFloorSnapshot?.parallelActiveLiveRuleCount ?? 0) > 0,
      "Parallel live partial floor smoke did not observe active live rules before first chunk completion",
    )
  }
  assert(
    chunkRuns.some((chunkRun) => pathExists(String(chunkRun?.livePartialRulesPath ?? "").trim())),
    "Parallel live partial floor smoke missing live partial-rule snapshot files",
  )
  const workerSummaries = await Promise.all(
    chunkRuns
      .map((chunkRun) => String(chunkRun?.summaryPath ?? "").trim())
      .filter(Boolean)
      .map((summaryPath) => readJson(summaryPath, null)),
  )
  assert(
    workerSummaries.some(
      (summary) => Number(summary?.rejectionSummary?.livePartialRuleCheckpointCount ?? 0) > 0,
    ),
    "Parallel live partial floor smoke did not observe worker live partial-rule checkpoints",
  )
  assert(
    workerSummaries.some(
      (summary) => Number(summary?.rejectionSummary?.externalKthHitFloorAppliedCount ?? 0) > 0,
    ),
    "Parallel live partial floor smoke did not observe a worker applying a raised external kth-hit floor",
  )
  assert(
    workerSummaries.every(
      (summary) => Number(summary?.rejectionSummary?.livePartialBootstrapSnapshotCount ?? 0) >= 0,
    ),
    "Parallel live partial floor smoke observed invalid bootstrap live partial telemetry",
  )

  const summary = {
    status: "ok",
    rootDir,
    firstLivePartialFloorElapsedMs: Number(
      probe.manifest?.parallelFirstLivePartialFloorElapsedMs ?? 0,
    ),
    firstChunkCompletionElapsedMs: Number(
      probe.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0,
    ),
    firstBootstrapFloorElapsedMs: Number(
      probe.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0,
    ),
    firstFloorSeededLaunchElapsedMs,
    bootstrapChunkCount: Number(probe.manifest?.parallelBootstrapChunkCount ?? 0),
    bootstrapFloorSeededLaunchCount: Number(
      probe.manifest?.parallelBootstrapFloorSeededLaunchCount ?? 0,
    ),
    livePartialRuleRevisionCount: Number(
      probe.manifest?.parallelLivePartialRuleRevisionCount ?? 0,
    ),
    livePartialFloorUpdateCount: Number(
      probe.manifest?.parallelLivePartialFloorUpdateCount ?? 0,
    ),
    earlyGlobalKthHitFloor: Number(earlyLiveFloorSnapshot?.parallelGlobalKthHitFloor ?? 0),
    earlyCompletedChunkCount: Number(earlyLiveFloorSnapshot?.parallelCompletedChunkCount ?? 0),
    earlyActiveLiveRuleCount: Number(earlyLiveFloorSnapshot?.parallelActiveLiveRuleCount ?? 0),
    championRuleId: probe.result?.catalog?.champion?.ruleId ?? null,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
