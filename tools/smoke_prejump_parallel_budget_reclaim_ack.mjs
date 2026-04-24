import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import {
  ensureDir,
  readJson,
  readJsonIfExistsStrict,
  writeJsonAtomic,
} from "../src/lib/io.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const spawnNodeCapture = ({ cwd, scriptPath, args = [] }) => {
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
  const completionPromise = new Promise((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          [
            "Predictive indexed budget reclaim/ack smoke worker failed",
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
  return {
    proc,
    completionPromise,
  }
}

const waitForJson = async (filePath, { timeoutMs = 10000, pollMs = 25 } = {}) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const payload = await readJsonIfExistsStrict(filePath)
    if (payload != null) {
      return payload
    }
    await sleep(pollMs)
  }
  throw new Error(`Timed out waiting for JSON file: ${filePath}`)
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_budget_reclaim_ack",
  })
  const adversarialSmokeScriptPath = path.join(
    cwd,
    "tools",
    "smoke_prejump_indexed_acceleration_adversarial.mjs",
  )
  const workerScriptPath = path.join(cwd, "tools", "mine_perfect_prototypes_indexed.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "adversarialSmokeScriptPath", filePath: adversarialSmokeScriptPath },
      { label: "workerScriptPath", filePath: workerScriptPath },
    ],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_budget_reclaim_ack",
  })

  const adversarialSmoke = spawnNodeCapture({
    cwd,
    scriptPath: adversarialSmokeScriptPath,
  })
  const adversarialSmokeResult = await adversarialSmoke.completionPromise
  const adversarialSummary = JSON.parse(String(adversarialSmokeResult.stdout ?? "").trim())
  const rootDir = path.resolve(String(adversarialSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error(
      "Parallel budget reclaim/ack smoke missing rootDir from indexed adversarial smoke output",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_budget_reclaim_ack",
  })

  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "budget_reclaim_ack_worker")
  await ensureDir(outDir)
  const liveBudgetPath = path.join(outDir, "live_budget.json")
  const budgetRequestPath = path.join(outDir, "budget_request.json")
  const budgetDecisionPath = path.join(outDir, "budget_decision.json")
  const budgetCommitPath = path.join(outDir, "budget_commit.json")
  const summaryPath = path.join(outDir, "summary.json")
  const workerChunkIndex = 0
  const initialAllocatedMaxSearchStates = 1
  const grantedAllocatedMaxSearchStates = 64
  const requestedAdditionalSearchStates =
    grantedAllocatedMaxSearchStates - initialAllocatedMaxSearchStates

  await writeJsonAtomic(liveBudgetPath, {
    version: 1,
    revision: 0,
    chunkIndex: workerChunkIndex,
    allocatedMaxSearchStates: initialAllocatedMaxSearchStates,
    updatedAt: new Date().toISOString(),
  })

  const worker = spawnNodeCapture({
    cwd,
    scriptPath: workerScriptPath,
    args: [
      `--index-dir=${indexDir}`,
      `--out-dir=${outDir}`,
      "--train-start=2024-01-02",
      "--train-end=2024-01-15",
      "--min-hit-count=6",
      "--max-gap=100000",
      "--max-rule-size=6",
      "--max-seed-tokens=4000",
      "--max-rules=4000",
      "--max-search-states=1",
      "--configured-max-search-states=256",
      "--base-allocated-max-search-states=1",
      "--guard-band-allocated-search-states=0",
      "--allocated-max-search-states=1",
      "--remaining-global-search-budget-at-launch=256",
      `--external-budget-path=${liveBudgetPath}`,
      "--external-budget-poll-ms=1000000",
      "--external-budget-state-interval=1000000",
      `--external-budget-request-path=${budgetRequestPath}`,
      `--external-budget-decision-path=${budgetDecisionPath}`,
      `--external-budget-commit-path=${budgetCommitPath}`,
      "--external-budget-request-headroom-states=1",
      `--external-budget-request-search-states=${requestedAdditionalSearchStates}`,
      "--external-budget-request-wait-ms=5000",
      "--max-rejected-rule-samples=1000",
      "--root-start=0",
      "--root-end=8",
      `--worker-chunk-index=${workerChunkIndex}`,
      "--output-mode=partial",
      "--enable-partial-top-k-hit-bound=true",
      "--ordering-head-window=8",
    ],
  })

  const budgetRequest = await waitForJson(budgetRequestPath, {
    timeoutMs: 10000,
    pollMs: 25,
  })
  assert.equal(Number(budgetRequest?.chunkIndex ?? -1), workerChunkIndex)
  assert(Number(budgetRequest?.revision ?? 0) >= 1)
  assert.equal(
    Number(budgetRequest?.requestedAdditionalSearchStates ?? 0),
    requestedAdditionalSearchStates,
  )

  const requestRevision = Number(budgetRequest?.revision ?? 0)
  await writeJsonAtomic(budgetDecisionPath, {
    version: 1,
    requestRevision,
    chunkIndex: workerChunkIndex,
    decision: "pending",
    allocatedMaxSearchStates: initialAllocatedMaxSearchStates,
    approvedAdditionalSearchStates: 0,
    grantedAdditionalSearchStates: 0,
    reason: "awaiting_completed_chunk_reclaim",
    updatedAt: new Date().toISOString(),
  })
  await sleep(150)
  await writeJsonAtomic(budgetDecisionPath, {
    version: 1,
    requestRevision,
    chunkIndex: workerChunkIndex,
    decision: "pending",
    allocatedMaxSearchStates: initialAllocatedMaxSearchStates,
    approvedAdditionalSearchStates: 0,
    grantedAdditionalSearchStates: 0,
    reason: "awaiting_completed_chunk_reclaim",
    updatedAt: new Date().toISOString(),
  })
  await sleep(150)
  await writeJsonAtomic(budgetDecisionPath, {
    version: 1,
    requestRevision,
    chunkIndex: workerChunkIndex,
    decision: "granted",
    allocatedMaxSearchStates: grantedAllocatedMaxSearchStates,
    approvedAdditionalSearchStates: requestedAdditionalSearchStates,
    grantedAdditionalSearchStates: requestedAdditionalSearchStates,
    budgetRevision: 1,
    reason: "reclaim_ack_smoke",
    updatedAt: new Date().toISOString(),
  })
  const budgetCommit = await waitForJson(budgetCommitPath, {
    timeoutMs: 10000,
    pollMs: 25,
  })
  assert.equal(Number(budgetCommit?.chunkIndex ?? -1), workerChunkIndex)
  assert.equal(Number(budgetCommit?.budgetRevision ?? 0), 1)
  assert.equal(
    Number(budgetCommit?.allocatedMaxSearchStates ?? 0),
    grantedAllocatedMaxSearchStates,
  )
  await writeJsonAtomic(liveBudgetPath, {
    version: 1,
    revision: 1,
    chunkIndex: workerChunkIndex,
    allocatedMaxSearchStates: grantedAllocatedMaxSearchStates,
    updatedAt: new Date().toISOString(),
  })

  await worker.completionPromise

  const summary = await readJson(summaryPath, null)
  assert(summary, "Parallel budget reclaim/ack smoke missing worker summary.json")
  const rejectionSummary = summary?.rejectionSummary ?? {}
  assert.equal(summary?.exploredStates > initialAllocatedMaxSearchStates, true)
  assert.equal(rejectionSummary?.truncatedByMaxSearchStates, false)
  assert.equal(Number(rejectionSummary?.budgetStopCount ?? 0), 0)
  assert(Number(rejectionSummary?.externalBudgetRequestCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetRequestSatisfiedCount ?? 0) > 0)
  assert.equal(Number(rejectionSummary?.externalBudgetRequestDeniedCount ?? 0), 0)
  assert(Number(rejectionSummary?.externalBudgetRequestPendingCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetPendingWaitMs ?? 0) > 0)
  assert.equal(String(rejectionSummary?.externalBudgetLastDecision ?? ""), "granted")
  assert(Number(rejectionSummary?.externalBudgetAppliedCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetRevision ?? 0) > 0)
  assert(Number(rejectionSummary?.externalBudgetCommitRevision ?? 0) > 0)
  assert(
    Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >
      Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        rootDir,
        workerChunkIndex,
        exploredStates: Number(summary?.exploredStates ?? 0),
        externalBudgetRequestCount: Number(rejectionSummary?.externalBudgetRequestCount ?? 0),
        externalBudgetRequestSatisfiedCount: Number(
          rejectionSummary?.externalBudgetRequestSatisfiedCount ?? 0,
        ),
        externalBudgetRequestPendingCount: Number(
          rejectionSummary?.externalBudgetRequestPendingCount ?? 0,
        ),
        externalBudgetPendingWaitMs: Number(
          rejectionSummary?.externalBudgetPendingWaitMs ?? 0,
        ),
        externalBudgetAppliedCount: Number(rejectionSummary?.externalBudgetAppliedCount ?? 0),
        externalBudgetAllowanceAppliedCount: Number(
          rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0,
        ),
        externalBudgetAllowanceSeenCount: Number(
          rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0,
        ),
        externalBudgetAllowanceConsumedCount: Number(
          rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0,
        ),
        externalBudgetCommitRequestCount: Number(
          rejectionSummary?.externalBudgetCommitRequestCount ?? 0,
        ),
        externalBudgetRevision: Number(rejectionSummary?.externalBudgetRevision ?? 0),
        externalBudgetCommitRevision: Number(rejectionSummary?.externalBudgetCommitRevision ?? 0),
        budgetCommitRevision: Number(budgetCommit?.budgetRevision ?? 0),
        effectiveAllocatedMaxSearchStates: Number(
          rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0,
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
