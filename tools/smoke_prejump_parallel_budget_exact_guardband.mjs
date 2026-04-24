import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
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
            "Predictive indexed budget guard-band smoke worker failed",
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

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_budget_exact_guardband",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_equivalence.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_budget_exact_guardband",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Parallel budget guard-band smoke missing rootDir from indexed equivalence smoke")
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_budget_exact_guardband",
  })

  const indexDir = path.join(rootDir, "index")
  const exactStopDir = path.join(rootDir, "indexed_budget_exact_stop")
  const parallelDir = path.join(rootDir, "parallel_budget_guardband")
  await ensureDir(rootDir)

  await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: exactStopDir,
    options: {
      trainStartDate: "2024-01-02",
      trainEndDate: "2024-01-15",
      minHitCount: 1,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 100,
      configuredMaxSearchStates: 20000000,
      baseAllocatedMaxSearchStates: 20,
      guardBandAllocatedSearchStates: 0,
      allocatedMaxSearchStates: 20,
      maxRejectedRuleSamples: 1000,
      outputMode: "partial",
      enablePartialTopKHitBound: true,
      orderingHeadWindow: 8,
      searchStateCacheMaxBytes: 32 * 1024,
    },
  })

  const exactStopSummary = await readJson(path.join(exactStopDir, "summary.json"), null)
  assert(exactStopSummary, "Budget exact-stop smoke missing worker summary")
  assert.equal(Number(exactStopSummary?.exploredStates ?? 0), 20)
  assert.equal(Number(exactStopSummary?.allocatedMaxSearchStates ?? 0), 20)
  assert.equal(Number(exactStopSummary?.baseAllocatedMaxSearchStates ?? 0), 20)
  assert.equal(Number(exactStopSummary?.guardBandAllocatedSearchStates ?? 0), 0)
  assert.equal(exactStopSummary?.rejectionSummary?.truncatedByMaxSearchStates, true)
  assert.equal(Number(exactStopSummary?.rejectionSummary?.budgetStopCount ?? 0), 1)
  assert.equal(
    String(exactStopSummary?.rejectionSummary?.budgetStopReason ?? ""),
    "allocated_budget_exhausted",
  )
  assert.equal(
    Number(exactStopSummary?.rejectionSummary?.budgetStopExploredStates ?? 0),
    20,
  )

  const parallel = await minePerfectPrototypeParallelIndexed({
    cwd,
    indexDir,
    outDir: parallelDir,
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
  assert(parallel, "Budget guard-band smoke parallel run did not return a result")

  const parallelManifest = await readJson(path.join(parallelDir, "parallel_manifest.json"), null)
  assert(parallelManifest, "Budget guard-band smoke missing parallel manifest")
  assert.equal(Number(parallelManifest?.version ?? 0), 14)
  assert(Number(parallelManifest?.parallelBudgetFastpathTickCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathServiceMs ?? 0) >= 0)
  const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
  assert(chunkRuns.length > 0, "Budget guard-band smoke chunkRuns are missing")
  assert(
    chunkRuns.every(
      (chunkRun) =>
        Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0) > 0 &&
        Number(chunkRun?.guardBandAllocatedSearchStates ?? 0) >= 0 &&
        Number(chunkRun?.allocatedMaxSearchStates ?? 0) ===
          Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0) +
            Number(chunkRun?.guardBandAllocatedSearchStates ?? 0),
    ),
    "Budget guard-band smoke requires base/guard/effective chunk allocations",
  )
  assert(
    chunkRuns.some((chunkRun) => Number(chunkRun?.guardBandAllocatedSearchStates ?? 0) > 0),
    "Budget guard-band smoke expected a positive per-chunk guard band",
  )

  for (const chunkRun of chunkRuns) {
    const workerSummary = await readJson(String(chunkRun?.summaryPath ?? ""), null)
    assert(workerSummary, `Budget guard-band smoke missing worker summary: ${chunkRun?.summaryPath}`)
    const rejectionSummary = workerSummary?.rejectionSummary ?? {}
    assert.equal(
      Number(rejectionSummary?.baseAllocatedMaxSearchStates ?? 0),
      Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0),
    )
    assert.equal(
      Number(rejectionSummary?.guardBandAllocatedSearchStates ?? 0),
      Number(chunkRun?.guardBandAllocatedSearchStates ?? 0),
    )
    assert.equal(
      Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
      Number(chunkRun?.allocatedMaxSearchStates ?? 0),
    )
    assert(
      Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >=
        Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
    )
    assert(
      Number(workerSummary?.exploredStates ?? 0) <=
        Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0),
      `Budget guard-band smoke worker exceeded effective allocation: summary=${chunkRun?.summaryPath}`,
    )
    assert(Number(rejectionSummary?.externalBudgetDecisionPollCount ?? 0) >= 0)
  }

  const summary = {
    status: "ok",
    rootDir,
    exactStopExploredStates: Number(exactStopSummary?.exploredStates ?? 0),
    exactStopBudgetStopCount: Number(exactStopSummary?.rejectionSummary?.budgetStopCount ?? 0),
    exactStopBudgetStopReason: String(
      exactStopSummary?.rejectionSummary?.budgetStopReason ?? "",
    ),
    parallelChunkCount: chunkRuns.length,
    parallelGuardBandPerChunk: chunkRuns.map((chunkRun) =>
      Number(chunkRun?.guardBandAllocatedSearchStates ?? 0),
    ),
    parallelDispatchCount: Number(parallelManifest?.parallelDispatchCount ?? 0),
    parallelCompletedChunkCount: Number(parallelManifest?.parallelCompletedChunkCount ?? 0),
  }
  await writeJson(path.join(rootDir, "parallel_budget_exact_guardband_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
