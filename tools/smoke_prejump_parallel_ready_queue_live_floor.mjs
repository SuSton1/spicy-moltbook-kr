import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"
import fsp from "node:fs/promises"

import { ensureDir, pathExists, readJson, readJsonIfExistsStrict } from "../src/lib/io.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const normalizeRule = (rule) => ({
  ruleId: rule?.ruleId ?? null,
  tokens: Array.isArray(rule?.tokens) ? [...rule.tokens] : [],
  trainHitCount: Number(rule?.trainHitCount ?? 0),
  trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
})

const normalizeCoverage = (coverage) => ({
  rowCount: Number(coverage?.rowCount ?? 0),
  matchCount: Number(coverage?.matchCount ?? 0),
  dedupedMatchCount: Number(coverage?.dedupedMatchCount ?? 0),
  matchedRuleCount: Number(coverage?.matchedRuleCount ?? 0),
  matchedDateCount: Number(coverage?.matchedDateCount ?? 0),
  matchedSymbolCount: Number(coverage?.matchedSymbolCount ?? 0),
})

const normalizeMatchRow = (row) => ({
  sourceId: row?.sourceId ?? null,
  ruleId: row?.ruleId ?? null,
  dateKey: row?.dateKey ?? null,
  symbol: row?.symbol ?? null,
  outcomeHitTarget:
    row?.outcomeHitTarget === true ? true : row?.outcomeHitTarget === false ? false : null,
})

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
            "Predictive indexed ready-queue smoke worker failed",
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
    throw new Error(`Ready-queue smoke expected a JSON object but found null: ${filePath}`)
  }
  return null
}

const waitForValue = async ({ label, resolveValue, timeoutMs = 10000, pollIntervalMs = 50 }) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = await resolveValue()
    if (value) return value
    await sleep(pollIntervalMs)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const startMalformedJsonLoop = ({ filePath, intervalMs = 25 }) => {
  const timer = setInterval(() => {
    void fsp.writeFile(filePath, "{\n", "utf8").catch(() => {})
  }, intervalMs)
  return async () => {
    clearInterval(timer)
  }
}

const findFirstWorkerControlPlanePath = async (parallelOutDir, fileName) => {
  const workerRootDir = path.join(parallelOutDir, "_parallel_workers")
  if (!pathExists(workerRootDir)) return null
  const workerEntries = await fsp.readdir(workerRootDir, { withFileTypes: true })
  const matchingPaths = []
  for (const workerEntry of workerEntries) {
    if (!workerEntry.isDirectory()) continue
    const slotDir = path.join(workerRootDir, workerEntry.name)
    const slotEntries = await fsp.readdir(slotDir, { withFileTypes: true })
    for (const slotEntry of slotEntries) {
      if (!slotEntry.isDirectory()) continue
      const candidatePath = path.join(slotDir, slotEntry.name, fileName)
      if (pathExists(candidatePath)) {
        matchingPaths.push(candidatePath)
      }
    }
  }
  return matchingPaths.sort()[0] ?? null
}

const runParallelExpectControlPlaneFailure = async ({
  cwd,
  indexDir,
  outDir,
  options,
  resolveTargetPath,
  expectedMessagePattern,
}) => {
  let settled = false
  let result = null
  let failure = null
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
  const targetPath = await waitForValue({
    label: "control-plane target path",
    resolveValue: async () => resolveTargetPath(outDir),
  })
  const stopCorrupting = await startMalformedJsonLoop({ filePath: targetPath })
  const startedAt = Date.now()
  while (!settled && Date.now() - startedAt < 15000) {
    await sleep(50)
  }
  await stopCorrupting()
  if (!settled) {
    throw new Error(`Timed out waiting for control-plane corruption failure: ${targetPath}`)
  }
  await completionPromise
  assert.equal(result, null, "Control-plane corruption smoke must not succeed")
  assert(failure instanceof Error, "Control-plane corruption smoke must fail")
  const message = String(failure?.stack || failure?.message || failure)
  assert(
    expectedMessagePattern.test(message),
    `Unexpected control-plane corruption failure: ${message}`,
  )
  return failure
}

const runIndexedExpectExternalFloorFailure = async ({
  cwd,
  indexDir,
  outDir,
  options,
  externalFloorPath,
  expectedMessagePattern,
}) => {
  let result = null
  let failure = null
  try {
    await minePerfectPrototypeIndexed({
      cwd,
      indexDir,
      outDir,
      options: {
        ...options,
        outputMode: "partial",
        externalKthHitFloorPath: externalFloorPath,
        externalKthHitFloorPollMs: 1,
        externalKthHitFloorStateInterval: 1,
      },
    })
    result = true
  } catch (error) {
    failure = error
  }
  assert.equal(result, null, "External floor corruption smoke must not succeed")
  assert(failure instanceof Error, "External floor corruption smoke must fail")
  const message = String(failure?.stack || failure?.message || failure)
  assert(
    expectedMessagePattern.test(message),
    `Unexpected external floor corruption failure: ${message}`,
  )
  return failure
}

const runParallelWithLiveProgressProbe = async ({
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
  while (!settled) {
    await sleep(pollIntervalMs)
    const progress = await readControlPlaneJsonSnapshot(path.join(outDir, "progress.json"))
    if (!progress) continue
    observedProgressSnapshots.push({
      phase: String(progress?.phase ?? ""),
      parallelCompletedChunkCount: Number(progress?.parallelCompletedChunkCount ?? 0),
      parallelDispatchCount: Number(progress?.parallelDispatchCount ?? 0),
      parallelReadyQueueDepth: Number(progress?.parallelReadyQueueDepth ?? 0),
      parallelActiveChunkCount: Number(progress?.parallelActiveChunkCount ?? 0),
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
  await completionPromise
  return {
    result,
    failure,
    observedProgressSnapshots,
    finalProgress: await readControlPlaneJsonSnapshot(path.join(outDir, "progress.json")),
    manifest: await readControlPlaneJsonSnapshot(path.join(outDir, "parallel_manifest.json")),
  }
}

const compareParallelResults = ({ left, right }) => {
  assert.deepStrictEqual(
    (left.rules ?? []).map(normalizeRule),
    (right.rules ?? []).map(normalizeRule),
  )
  assert.equal(left.catalog?.champion?.ruleId ?? null, right.catalog?.champion?.ruleId ?? null)
  assert.deepStrictEqual(normalizeCoverage(left.coverage), normalizeCoverage(right.coverage))
  assert.deepStrictEqual(
    (left.matches ?? []).map(normalizeMatchRow),
    (right.matches ?? []).map(normalizeMatchRow),
  )
  assert.deepStrictEqual(
    (left.dedupedMatches ?? []).map(normalizeMatchRow),
    (right.dedupedMatches ?? []).map(normalizeMatchRow),
  )
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_ready_queue_live_floor",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_ready_queue_live_floor",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Parallel ready-queue smoke missing rootDir from indexed adversarial smoke output")
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_ready_queue_live_floor",
  })

  const indexDir = path.join(rootDir, "index")
  const runADir = path.join(rootDir, "parallel_ready_queue_a")
  const runBDir = path.join(rootDir, "parallel_ready_queue_b")
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

  const runA = await runParallelWithLiveProgressProbe({
    cwd,
    indexDir,
    outDir: runADir,
    options,
  })
  assert.equal(runA.failure, null, runA.failure?.stack ?? runA.failure?.message ?? null)
  assert(runA.result, "Ready-queue smoke run A returned no result")
  assert(runA.manifest, "Ready-queue smoke run A missing manifest")
  assert(runA.observedProgressSnapshots.length > 0, "Ready-queue smoke did not observe progress snapshots")
  assert.equal(Number(runA.manifest?.version ?? 0), 6)
  assert(pathExists(String(runA.manifest?.liveFloorPath ?? "")), "Ready-queue smoke live floor path is missing")
  assert(
    Number(runA.manifest?.parallelBootstrapChunkCount ?? 0) > 0,
    "Ready-queue smoke did not record bootstrap head chunks",
  )
  assert(Number(runA.manifest?.parallelDispatchCount ?? 0) > 2, "Ready-queue smoke did not dispatch enough chunks")
  assert(Number(runA.manifest?.parallelImmediateRefillCount ?? 0) > 0, "Ready-queue smoke did not record immediate refill")
  assert(Number(runA.manifest?.parallelLiveFloorUpdateCount ?? 0) > 0, "Ready-queue smoke did not record live floor updates")
  assert(Number(runA.manifest?.parallelLiveFloorRevision ?? 0) >= Number(runA.manifest?.parallelLiveFloorUpdateCount ?? 0))
  assert(
    Number(runA.manifest?.parallelLivePartialRuleRevisionCount ?? 0) > 0,
    "Ready-queue smoke did not record live partial-rule revisions",
  )
  assert(
    Number(runA.manifest?.parallelLivePartialRuleMergeMs ?? 0) >= 0,
    "Ready-queue smoke missing live partial-rule merge timing",
  )
  assert(
    Number(runA.manifest?.parallelLivePartialFloorUpdateCount ?? 0) > 0,
    "Ready-queue smoke did not record live partial-rule floor updates",
  )
  assert(
    Number(runA.manifest?.parallelLiveFloorUpdateCount ?? 0) >=
      Number(runA.manifest?.parallelLivePartialFloorUpdateCount ?? 0),
    "Ready-queue smoke recorded more live partial floor updates than total live floor updates",
  )
  assert(
    Number(runA.manifest?.parallelFirstLivePartialFloorElapsedMs ?? 0) > 0,
    "Ready-queue smoke missing first live partial floor timing",
  )
  assert(
    Number(runA.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0) > 0,
    "Ready-queue smoke missing first chunk completion timing",
  )
  assert(
    Number(runA.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0) > 0,
    "Ready-queue smoke missing first bootstrap floor timing",
  )
  assert(
    Number(runA.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0) <=
      Number(runA.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0),
    "Ready-queue smoke did not raise a bootstrap floor before first chunk completion",
  )
  assert(
    Number(runA.manifest?.parallelBootstrapFloorSeededLaunchCount ?? 0) > 0,
    "Ready-queue smoke did not record any bootstrap-floor-seeded later launches",
  )

  const chunkRuns = Array.isArray(runA.manifest?.chunkRuns) ? runA.manifest.chunkRuns : []
  const bootstrapChunkRuns = chunkRuns.filter((chunkRun) => chunkRun?.bootstrapHead === true)
  const nonBootstrapChunkRuns = chunkRuns.filter((chunkRun) => chunkRun?.bootstrapHead !== true)
  assert(
    bootstrapChunkRuns.length === Number(runA.manifest?.parallelBootstrapChunkCount ?? 0),
    "Ready-queue smoke bootstrap chunk count mismatched manifest",
  )
  assert(bootstrapChunkRuns.length > 0, "Ready-queue smoke did not tag any bootstrap chunk runs")
  if (nonBootstrapChunkRuns.length > 0) {
    const firstNonBootstrapDispatchOrder = Math.min(
      ...nonBootstrapChunkRuns.map((chunkRun) => Number(chunkRun?.dispatchOrder ?? Number.MAX_SAFE_INTEGER)),
    )
    const lastBootstrapDispatchOrder = Math.max(
      ...bootstrapChunkRuns.map((chunkRun) => Number(chunkRun?.dispatchOrder ?? -1)),
    )
    assert(
      lastBootstrapDispatchOrder < firstNonBootstrapDispatchOrder,
      "Ready-queue smoke did not dispatch bootstrap head chunks ahead of tail chunks",
    )
  }
  const initialBatchRuns = chunkRuns
    .filter((chunkRun) => Number(chunkRun?.dispatchOrder ?? 0) < 2)
    .sort((left, right) => Number(left?.dispatchOrder ?? 0) - Number(right?.dispatchOrder ?? 0))
  const laterRuns = chunkRuns.filter((chunkRun) => Number(chunkRun?.dispatchOrder ?? 0) >= 2)
  assert(initialBatchRuns.length === 2, "Ready-queue smoke expected two initial batch runs")
  assert(laterRuns.length > 0, "Ready-queue smoke expected later dispatched chunks")
  assert(
    laterRuns.some((laterRun) => {
      const laterDispatchOrder = Number(laterRun?.dispatchOrder ?? -1)
      const laterWorkerSlotIndex = Number(laterRun?.workerSlotIndex ?? -1)
      const laterLaunchedAtMs = Date.parse(String(laterRun?.launchedAt ?? ""))
      if (!Number.isFinite(laterLaunchedAtMs)) return false
      return chunkRuns.some((earlierRun) => {
        const earlierDispatchOrder = Number(earlierRun?.dispatchOrder ?? -1)
        if (!Number.isInteger(earlierDispatchOrder) || earlierDispatchOrder >= laterDispatchOrder) return false
        if (Number(earlierRun?.workerSlotIndex ?? -1) === laterWorkerSlotIndex) return false
        const earlierLaunchedAtMs = Date.parse(String(earlierRun?.launchedAt ?? ""))
        const earlierCompletedAtMs = Date.parse(String(earlierRun?.completedAt ?? ""))
        return (
          Number.isFinite(earlierLaunchedAtMs) &&
          Number.isFinite(earlierCompletedAtMs) &&
          earlierLaunchedAtMs <= laterLaunchedAtMs &&
          laterLaunchedAtMs < earlierCompletedAtMs
        )
      })
    }),
    "Ready-queue smoke did not refill a freed slot while a sibling chunk was still running",
  )

  const runAWorkerSummaryPaths = chunkRuns
    .map((chunkRun) => String(chunkRun?.summaryPath ?? "").trim())
    .filter(Boolean)
  const runAWorkerSummaries = await Promise.all(
    runAWorkerSummaryPaths.map((summaryPath) => readJson(summaryPath, null)),
  )
  assert(
    runAWorkerSummaries.some(
      (summary) => Number(summary?.rejectionSummary?.livePartialRuleCheckpointCount ?? 0) > 0,
    ),
    "Ready-queue smoke did not observe worker live partial-rule checkpoints",
  )
  assert(
    runAWorkerSummaries.some(
      (summary) => Number(summary?.rejectionSummary?.externalKthHitFloorAppliedCount ?? 0) > 0,
    ),
    "Ready-queue smoke did not observe a running worker applying an external kth-hit floor",
  )
  assert(
    runAWorkerSummaries.every(
      (summary) => Number(summary?.rejectionSummary?.livePartialBootstrapSnapshotCount ?? 0) >= 0,
    ),
    "Ready-queue smoke observed invalid bootstrap live partial snapshot telemetry",
  )

  const corruptIndexedOutDir = path.join(rootDir, "indexed_corrupt_live_floor")
  const corruptLiveFloorPath = path.join(rootDir, "corrupt_live_floor.json")
  await fsp.writeFile(corruptLiveFloorPath, "{\n", "utf8")
  await runIndexedExpectExternalFloorFailure({
    cwd,
    indexDir,
    outDir: corruptIndexedOutDir,
    options: {
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
    },
    externalFloorPath: corruptLiveFloorPath,
    expectedMessagePattern:
      /Indexed miner failed to read control-plane JSON|corrupt_live_floor\.json|external kth-hit-floor/i,
  })

  await runParallelExpectControlPlaneFailure({
    cwd,
    indexDir,
    outDir: path.join(rootDir, "parallel_ready_queue_corrupt_progress"),
    options,
    resolveTargetPath: async (parallelOutDir) =>
      findFirstWorkerControlPlanePath(parallelOutDir, "live_partial_rules.json"),
    expectedMessagePattern:
      /Parallel indexed miner live partial-rule snapshot is unreadable or malformed|live_partial_rules\.json/i,
  })

  const runB = await runParallelWithLiveProgressProbe({
    cwd,
    indexDir,
    outDir: runBDir,
    options,
  })
  assert.equal(runB.failure, null, runB.failure?.stack ?? runB.failure?.message ?? null)
  assert(runB.result, "Ready-queue smoke run B returned no result")
  compareParallelResults({
    left: runA.result,
    right: runB.result,
  })

  const summary = {
    status: "ok",
    rootDir,
    readyQueueDispatchCount: Number(runA.manifest?.parallelDispatchCount ?? 0),
    readyQueueImmediateRefillCount: Number(runA.manifest?.parallelImmediateRefillCount ?? 0),
    liveFloorUpdateCount: Number(runA.manifest?.parallelLiveFloorUpdateCount ?? 0),
    livePartialRuleRevisionCount: Number(runA.manifest?.parallelLivePartialRuleRevisionCount ?? 0),
    livePartialFloorUpdateCount: Number(runA.manifest?.parallelLivePartialFloorUpdateCount ?? 0),
    liveFloorRevision: Number(runA.manifest?.parallelLiveFloorRevision ?? 0),
    firstGlobalFloorElapsedMs: Number(runA.manifest?.parallelFirstGlobalFloorElapsedMs ?? 0),
    firstLivePartialFloorElapsedMs: Number(
      runA.manifest?.parallelFirstLivePartialFloorElapsedMs ?? 0,
    ),
    bootstrapChunkCount: Number(runA.manifest?.parallelBootstrapChunkCount ?? 0),
    firstChunkCompletionElapsedMs: Number(
      runA.manifest?.parallelFirstChunkCompletionElapsedMs ?? 0,
    ),
    firstBootstrapFloorElapsedMs: Number(
      runA.manifest?.parallelFirstBootstrapFloorElapsedMs ?? 0,
    ),
    bootstrapFloorSeededLaunchCount: Number(
      runA.manifest?.parallelBootstrapFloorSeededLaunchCount ?? 0,
    ),
    championRuleId: runA.result?.catalog?.champion?.ruleId ?? null,
    ruleCount: Array.isArray(runA.result?.rules) ? runA.result.rules.length : 0,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
