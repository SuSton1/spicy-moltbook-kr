import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import {
  ensureDir,
  pathExists,
  readJson,
  readJsonIfExistsStrict,
  writeJson,
} from "../src/lib/io.mjs"
import {
  allocateDeterministicChunkSearchBudgetPlanByChunkIndex,
  minePerfectPrototypeParallelIndexed,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
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
            "Predictive indexed live-budget top-up smoke worker failed",
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
    throw new Error(`Parallel live-budget top-up smoke expected a JSON object but found null: ${filePath}`)
  }
  return null
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
      exploredStates: Number(progress?.exploredStates ?? 0),
      parallelBudgetRequestCount: Number(progress?.parallelBudgetRequestCount ?? 0),
      parallelBudgetGrantCount: Number(progress?.parallelBudgetGrantCount ?? 0),
      parallelBudgetDenyCount: Number(progress?.parallelBudgetDenyCount ?? 0),
      parallelBudgetTopupCount: Number(progress?.parallelBudgetTopupCount ?? 0),
      parallelBudgetTopupSearchStates: Number(progress?.parallelBudgetTopupSearchStates ?? 0),
      parallelRemainingSearchBudget: Number(progress?.parallelRemainingSearchBudget ?? 0),
      parallelRemainingGrantableSearchBudget: Number(
        progress?.parallelRemainingGrantableSearchBudget ?? 0,
      ),
      parallelActiveAllocatedSearchBudget: Number(
        progress?.parallelActiveAllocatedSearchBudget ?? 0,
      ),
      parallelActiveEffectiveAllocatedSearchBudget: Number(
        progress?.parallelActiveEffectiveAllocatedSearchBudget ?? 0,
      ),
    })
  }
  await completionPromise
  return {
    result,
    failure,
    observedProgressSnapshots,
    finalProgress: await readControlPlaneJsonSnapshot(path.join(outDir, "progress.json")),
    finalManifest: await readJson(path.join(outDir, "parallel_manifest.json"), null),
  }
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_live_budget_topup",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_live_budget_topup",
  })

  const syntheticChunks = [
    { chunkIndex: 7, estimatedCost: 11 },
    { chunkIndex: 2, estimatedCost: 29 },
    { chunkIndex: 5, estimatedCost: 17 },
  ]
  const syntheticPlanByChunkIndex = allocateDeterministicChunkSearchBudgetPlanByChunkIndex({
    chunks: syntheticChunks,
    totalBudget: 600,
  })
  assert.equal(syntheticPlanByChunkIndex.size, syntheticChunks.length)
  for (const chunk of syntheticChunks) {
    const allocation = syntheticPlanByChunkIndex.get(chunk.chunkIndex) ?? null
    assert(allocation, `Missing synthetic allocation for chunkIndex=${chunk.chunkIndex}`)
    assert.equal(Number(allocation?.chunkIndex ?? -1), Number(chunk.chunkIndex))
    assert(Number(allocation?.allocatedMaxSearchStates ?? 0) > 0)
  }

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Parallel live-budget top-up smoke missing rootDir from predictive indexed smoke output")
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_live_budget_topup",
  })

  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "parallel_live_budget_topup")
  await ensureDir(rootDir)

  const probe = await runParallelWithLiveProgressProbe({
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
      externalBudgetRequestHeadroomStates: 1_000_000,
      externalBudgetRequestSearchStates: 1_000_000,
      externalBudgetRequestWaitMs: 10000,
    },
    pollIntervalMs: 100,
  })

  const finalProgress = probe.finalProgress
  assert(finalProgress, "Parallel live-budget top-up smoke missing final progress.json")
  assert(Number(finalProgress?.parallelBudgetRequestCount ?? 0) >= 0)
  assert(Number(finalProgress?.parallelBudgetGrantCount ?? 0) >= 0)
  assert(Number(finalProgress?.parallelBudgetCommitCount ?? 0) >= 0)
  assert(Number(finalProgress?.parallelBudgetTopupCount ?? 0) >= 0)
  assert(Number(finalProgress?.parallelBudgetTopupSearchStates ?? 0) >= 0)
  assert(Number(finalProgress?.parallelBudgetCommittedSearchStates ?? 0) >= 0)
  assert(
    Number(finalProgress?.parallelActiveEffectiveAllocatedSearchBudget ?? 0) >=
      Number(finalProgress?.parallelActiveAllocatedSearchBudget ?? 0),
  )
  const observedCommittedTopup = Number(finalProgress?.parallelBudgetCommitCount ?? 0) > 0
  if (probe.observedProgressSnapshots.length > 1) {
    for (let index = 1; index < probe.observedProgressSnapshots.length; index += 1) {
      const previous = probe.observedProgressSnapshots[index - 1]
      const current = probe.observedProgressSnapshots[index]
      assert(
        current.parallelBudgetRequestCount >= previous.parallelBudgetRequestCount,
        `parallelBudgetRequestCount regressed: previous=${previous.parallelBudgetRequestCount} current=${current.parallelBudgetRequestCount}`,
      )
      assert(
        current.parallelBudgetGrantCount >= previous.parallelBudgetGrantCount,
        `parallelBudgetGrantCount regressed: previous=${previous.parallelBudgetGrantCount} current=${current.parallelBudgetGrantCount}`,
      )
      assert(
        current.parallelBudgetTopupCount >= previous.parallelBudgetTopupCount,
        `parallelBudgetTopupCount regressed: previous=${previous.parallelBudgetTopupCount} current=${current.parallelBudgetTopupCount}`,
      )
      assert(
        current.parallelBudgetTopupSearchStates >= previous.parallelBudgetTopupSearchStates,
        `parallelBudgetTopupSearchStates regressed: previous=${previous.parallelBudgetTopupSearchStates} current=${current.parallelBudgetTopupSearchStates}`,
      )
      assert(
        current.parallelRemainingSearchBudget >= 0,
        `parallelRemainingSearchBudget became negative: ${current.parallelRemainingSearchBudget}`,
      )
      assert(
        current.parallelRemainingGrantableSearchBudget >= 0,
        `parallelRemainingGrantableSearchBudget became negative: ${current.parallelRemainingGrantableSearchBudget}`,
      )
      assert(
        current.parallelActiveEffectiveAllocatedSearchBudget >=
          current.parallelActiveAllocatedSearchBudget,
        "parallel active effective allocation regressed below initial allocation",
      )
    }
  }

  const failureMessage = String(probe.failure?.message ?? "")
  if (probe.failure instanceof Error) {
    assert.match(failureMessage, /global_budget_exhausted/i)
    assert.doesNotMatch(failureMessage, /local_budget_exact_stop_without_topup/i)
  } else {
    assert.equal(String(finalProgress?.phase ?? ""), "completed")
  }

  const parallelManifest = probe.finalManifest
  if (parallelManifest) {
    assert.equal(Number(parallelManifest?.version ?? 0), 14)
    assert(Number(parallelManifest?.parallelBudgetRequestCount ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetGrantCount ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetCommitCount ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetTopupCount ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetTopupSearchStates ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetCommittedSearchStates ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelBudgetFastpathTickCount ?? 0) > 0)
    assert(Number(parallelManifest?.parallelBudgetFastpathServiceMs ?? 0) >= 0)
    assert(Number(parallelManifest?.parallelCompletedChunkReclaimCount ?? 0) > 0)
    assert(Number(parallelManifest?.parallelCompletedChunkReclaimSearchStates ?? 0) > 0)
    const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
    assert(chunkRuns.length > 0, "Parallel live-budget top-up smoke missing chunkRuns")
    const topupChunkRuns = chunkRuns.filter(
      (chunkRun) => Number(chunkRun?.topupAllocatedSearchStates ?? 0) > 0,
    )
    if (observedCommittedTopup) {
      assert(
        topupChunkRuns.length > 0,
        "Parallel live-budget top-up smoke expected a top-up chunk when commit counters are positive",
      )
    } else {
      assert.equal(
        topupChunkRuns.length,
        0,
        "Parallel live-budget top-up smoke must not record phantom top-up chunks when commit counters are zero",
      )
    }
    for (const chunkRun of chunkRuns) {
      assert(
        Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? 0) >=
          Number(chunkRun?.allocatedMaxSearchStates ?? 0),
      )
      assert(path.resolve(String(chunkRun?.budgetRequestPath ?? "")).length > 0)
      assert(path.resolve(String(chunkRun?.budgetDecisionPath ?? "")).length > 0)
      assert(Number(chunkRun?.budgetTopupGrantedCount ?? 0) >= 0)
      assert(String(chunkRun?.budgetCommitPath ?? "").trim().length > 0)
      const workerSummary = await readJson(String(chunkRun?.summaryPath ?? ""), null)
      if (!workerSummary) continue
      const rejectionSummary = workerSummary?.rejectionSummary ?? {}
      assert(
        Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >=
          Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
      )
      assert(Number(rejectionSummary?.externalBudgetRequestCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetRequestSatisfiedCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetRequestDeniedCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetDecisionPollCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? 0) >= 0)
      assert(Number(rejectionSummary?.externalBudgetCommitRevision ?? 0) >= 0)
      if (Number(chunkRun?.topupAllocatedSearchStates ?? 0) > 0) {
        assert(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0) > 0)
        assert(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0) > 0)
        assert(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0) > 0)
        assert(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? 0) > 0)
        assert(Number(rejectionSummary?.externalBudgetCommitRevision ?? 0) > 0)
      }
    }
  }

  const summary = {
    status: "ok",
    rootDir,
    failureMessage,
    completed: probe.failure == null,
    observedCommittedTopup,
    parallelBudgetTopupCount: Number(finalProgress?.parallelBudgetTopupCount ?? 0),
    parallelBudgetTopupSearchStates: Number(
      finalProgress?.parallelBudgetTopupSearchStates ?? 0,
    ),
    parallelBudgetRequestCount: Number(finalProgress?.parallelBudgetRequestCount ?? 0),
    parallelBudgetGrantCount: Number(finalProgress?.parallelBudgetGrantCount ?? 0),
    parallelBudgetCommitCount: Number(finalProgress?.parallelBudgetCommitCount ?? 0),
    parallelBudgetDenyCount: Number(finalProgress?.parallelBudgetDenyCount ?? 0),
    parallelRemainingSearchBudget: Number(finalProgress?.parallelRemainingSearchBudget ?? 0),
    parallelRemainingGrantableSearchBudget: Number(
      finalProgress?.parallelRemainingGrantableSearchBudget ?? 0,
    ),
    manifestBudgetTopupCount: Number(parallelManifest?.parallelBudgetTopupCount ?? 0),
    manifestBudgetTopupSearchStates: Number(
      parallelManifest?.parallelBudgetTopupSearchStates ?? 0,
    ),
    manifestBudgetRequestCount: Number(parallelManifest?.parallelBudgetRequestCount ?? 0),
    manifestBudgetGrantCount: Number(parallelManifest?.parallelBudgetGrantCount ?? 0),
    manifestBudgetCommitCount: Number(parallelManifest?.parallelBudgetCommitCount ?? 0),
    manifestBudgetDenyCount: Number(parallelManifest?.parallelBudgetDenyCount ?? 0),
  }
  await writeJson(path.join(rootDir, "parallel_live_budget_topup_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
