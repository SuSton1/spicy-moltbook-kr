import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  resolveParallelActiveChunkCompletionPollIntervalMs,
  resolveParallelBudgetFastpathIntervalMs,
  shouldServiceParallelBudgetRequestsFastpath,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const main = async () => {
  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stockdesk-parallel-control-plane-policy-"),
  )
  const budgetRequestPath = path.join(tempRoot, "budget_request.json")

  assert.equal(
    shouldServiceParallelBudgetRequestsFastpath({
      activeChunkRuns: [{ pendingBudgetRevision: 0, pendingBudgetRequestRevision: 0 }],
    }),
    false,
    "Parallel control-plane policy smoke expected idle fastpath without pending activity",
  )
  assert.equal(
    resolveParallelBudgetFastpathIntervalMs({
      activeChunkRuns: [{ pendingBudgetRevision: 0, pendingBudgetRequestRevision: 0 }],
    }),
    250,
    "Parallel control-plane policy smoke expected idle fastpath interval for no-activity state",
  )

  await fsp.writeFile(budgetRequestPath, "{\"revision\":1}\n", "utf8")
  assert.equal(
    shouldServiceParallelBudgetRequestsFastpath({
      activeChunkRuns: [{ budgetRequestPath }],
    }),
    true,
    "Parallel control-plane policy smoke expected service when a request artifact exists",
  )
  assert.equal(
    resolveParallelBudgetFastpathIntervalMs({
      activeChunkRuns: [{ budgetRequestPath }],
    }),
    25,
    "Parallel control-plane policy smoke expected hot fastpath interval when request activity exists",
  )

  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: { lastLiveState: null },
    }),
    250,
    "Parallel control-plane policy smoke expected default fast polling before live progress exists",
  )

  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: {
        lastLiveState: {
          observedProgressFile: true,
          phase: "search",
          progressAgeMs: 400,
          completionFraction: 0.42,
          etaSeconds: 38,
        },
      },
    }),
    1000,
    "Parallel control-plane policy smoke expected slow completion polling for healthy far-from-done search",
  )
  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: {
        lastLiveState: {
          observedProgressFile: true,
          phase: "search",
          progressAgeMs: 200,
          completionFraction: 0.42,
          etaSeconds: 38,
        },
        lastLiveStateObservedAtMs: Date.now() - 20000,
      },
    }),
    250,
    "Parallel control-plane policy smoke expected observation lag to reheat completion polling",
  )

  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: {
        lastLiveState: {
          observedProgressFile: true,
          phase: "search",
          progressAgeMs: 20000,
          completionFraction: 0.42,
          etaSeconds: 38,
        },
      },
    }),
    250,
    "Parallel control-plane policy smoke expected fast polling when progress is stale",
  )

  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: {
        lastLiveState: {
          observedProgressFile: true,
          phase: "search",
          progressAgeMs: 400,
          completionFraction: 0.985,
          etaSeconds: 1.5,
        },
      },
    }),
    250,
    "Parallel control-plane policy smoke expected fast polling near completion",
  )

  assert.equal(
    resolveParallelActiveChunkCompletionPollIntervalMs({
      chunkRun: {
        lastLiveState: {
          observedProgressFile: true,
          phase: "launch_pending_progress",
          progressAgeMs: 200,
          completionFraction: 0,
          etaSeconds: null,
        },
      },
    }),
    250,
    "Parallel control-plane policy smoke expected fast polling outside active search",
  )

  await fsp.rm(tempRoot, { recursive: true, force: true })

  console.log(
    JSON.stringify(
      {
        status: "ok",
        idleFastpathPolicy: "skip_service_without_pending_activity",
        farSearchCompletionPollMs: 1000,
        nearCompletionPollMs: 250,
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
