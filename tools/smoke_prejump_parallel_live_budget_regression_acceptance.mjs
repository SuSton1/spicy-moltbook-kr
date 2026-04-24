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
            "Predictive indexed live-budget regression smoke worker failed",
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

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_live_budget_regression_acceptance",
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
    toolName: "smoke_prejump_parallel_live_budget_regression_acceptance",
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
      "Parallel live-budget regression smoke missing rootDir from indexed adversarial smoke output",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_live_budget_regression_acceptance",
  })

  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "live_budget_regression_worker")
  await ensureDir(outDir)
  const liveBudgetPath = path.join(outDir, "live_budget.json")
  const budgetRequestPath = path.join(outDir, "budget_request.json")
  const budgetDecisionPath = path.join(outDir, "budget_decision.json")
  const budgetCommitPath = path.join(outDir, "budget_commit.json")
  const progressPath = path.join(outDir, "progress.json")
  const summaryPath = path.join(outDir, "summary.json")
  const workerChunkIndex = 0
  const initialAllocatedMaxSearchStates = 512

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
      "--min-hit-count=1",
      "--max-gap=100000",
      "--max-rule-size=6",
      "--max-seed-tokens=4000",
      "--max-rules=4000",
      `--max-search-states=${initialAllocatedMaxSearchStates}`,
      `--configured-max-search-states=${initialAllocatedMaxSearchStates}`,
      "--base-allocated-max-search-states=1",
      "--guard-band-allocated-search-states=0",
      `--allocated-max-search-states=${initialAllocatedMaxSearchStates}`,
      "--remaining-global-search-budget-at-launch=0",
      `--external-budget-path=${liveBudgetPath}`,
      `--external-budget-request-path=${budgetRequestPath}`,
      `--external-budget-decision-path=${budgetDecisionPath}`,
      `--external-budget-commit-path=${budgetCommitPath}`,
      "--external-budget-poll-ms=1",
      "--external-budget-decision-poll-ms=10",
      "--external-budget-state-interval=1",
      "--external-budget-request-headroom-states=1",
      "--external-budget-request-search-states=1",
      "--external-budget-request-wait-ms=5000",
      "--max-rejected-rule-samples=1000",
      "--root-start=0",
      "--root-end=29",
      `--worker-chunk-index=${workerChunkIndex}`,
      "--output-mode=partial",
      "--enable-partial-top-k-hit-bound=true",
      "--ordering-head-window=8",
    ],
  })
  let workerSettled = false
  const workerCompletion = worker.completionPromise.finally(() => {
    workerSettled = true
  })

  await sleep(25)
  const reclaimedAllocatedMaxSearchStates = 32
  await writeJsonAtomic(liveBudgetPath, {
    version: 1,
    revision: 1,
    chunkIndex: workerChunkIndex,
    allocatedMaxSearchStates: reclaimedAllocatedMaxSearchStates,
    updatedAt: new Date().toISOString(),
  })
  let lastDeniedRequestRevision = 0
  while (!workerSettled) {
    const budgetRequest = await readJsonIfExistsStrict(budgetRequestPath)
    const requestRevision = Math.floor(Number(budgetRequest?.revision ?? 0) || 0)
    if (requestRevision > lastDeniedRequestRevision) {
      lastDeniedRequestRevision = requestRevision
      await writeJsonAtomic(budgetDecisionPath, {
        version: 1,
        requestRevision,
        chunkIndex: workerChunkIndex,
        decision: "denied",
        allocatedMaxSearchStates: reclaimedAllocatedMaxSearchStates,
        approvedAdditionalSearchStates: 0,
        grantedAdditionalSearchStates: 0,
        reason: "live_budget_regression_acceptance_smoke",
        updatedAt: new Date().toISOString(),
      })
    }
    await sleep(10)
  }

  await workerCompletion

  const progress = await readJson(progressPath, null)
  const observedExploredStates = Number(progress?.exploredStates ?? 0)
  const summary = await readJson(summaryPath, null)
  assert(summary, "Parallel live-budget regression smoke missing worker summary.json")
  const rejectionSummary = summary?.rejectionSummary ?? {}
  const budgetStopReason = String(rejectionSummary?.budgetStopReason ?? "")
  assert.equal(Number(rejectionSummary?.externalBudgetDecreaseAppliedCount ?? 0) > 0, true)
  assert.equal(Number(rejectionSummary?.externalBudgetDecreaseSearchStates ?? 0) > 0, true)
  assert.equal(Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) <= reclaimedAllocatedMaxSearchStates, true)
  assert.equal(
    ["allocated_budget_exhausted", "global_budget_exhausted"].includes(budgetStopReason),
    true,
  )
  assert.equal(Boolean(rejectionSummary?.truncatedByMaxSearchStates), true)
  console.log(
    JSON.stringify({
      status: "ok",
      observedExploredStates,
      reclaimedAllocatedMaxSearchStates,
      exploredStates: Number(summary?.exploredStates ?? 0),
      externalBudgetDecreaseAppliedCount: Number(
        rejectionSummary?.externalBudgetDecreaseAppliedCount ?? 0,
      ),
      externalBudgetDecreaseSearchStates: Number(
        rejectionSummary?.externalBudgetDecreaseSearchStates ?? 0,
      ),
    }),
  )
}

await main()
