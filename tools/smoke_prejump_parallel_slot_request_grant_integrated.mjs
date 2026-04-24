import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import { ensureDir, iterateJsonl, readJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

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

const readJsonlRows = async (filePath) => {
  const rows = []
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  return rows
}

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
            "Predictive indexed persistent-slot request/grant integrated smoke setup failed",
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
    toolName: "smoke_prejump_parallel_slot_request_grant_integrated",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_slot_request_grant_integrated",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error(
      "Persistent-slot request/grant integrated smoke missing rootDir from indexed adversarial smoke output",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_slot_request_grant_integrated",
  })

  const indexDir = path.join(rootDir, "index")
  const indexedDir = path.join(rootDir, "indexed")
  const parallelDir = path.join(rootDir, "parallel_slot_request_grant_integrated")
  await ensureDir(rootDir)

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
      externalBudgetRequestHeadroomStates: 1_000_000,
      externalBudgetRequestSearchStates: 1_000_000,
      externalBudgetRequestWaitMs: 10000,
    },
  })
  assert(parallel, "Persistent-slot request/grant integrated smoke parallel run did not return a result")

  const indexedCatalog = await readJson(path.join(indexedDir, "catalog.json"), null)
  const indexedCoverage = await readJson(path.join(indexedDir, "coverage.json"), null)
  const indexedMatches = await readJsonlRows(path.join(indexedDir, "matches.jsonl"))
  const indexedDeduped = await readJsonlRows(path.join(indexedDir, "deduped_matches.jsonl"))
  const parallelManifest = await readJson(path.join(parallelDir, "parallel_manifest.json"), null)
  assert(parallelManifest, "Persistent-slot request/grant integrated smoke missing parallel manifest")
  assert.equal(Number(parallelManifest?.version ?? 0), 14)
  assert.equal(Number(parallelManifest?.parallelWorkerSpawnCount ?? 0), 2)
  assert(Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelWorkerWarmLaunchCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetRequestCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetGrantCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetCommitCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetTopupCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetTopupSearchStates ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetCommittedSearchStates ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathTickCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathServiceMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelRemainingGrantableSearchBudget ?? 0) >= 0)
  const observedCommittedTopup = Number(parallelManifest?.parallelBudgetCommitCount ?? 0) > 0

  const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
  assert(chunkRuns.length > 2, "Persistent-slot request/grant integrated smoke expected more chunkRuns than workers")
  const chunkRunsBySlot = new Map()
  for (const chunkRun of chunkRuns) {
    const workerSlotIndex = Number(chunkRun?.workerSlotIndex ?? -1)
    const bucket = chunkRunsBySlot.get(workerSlotIndex) ?? []
    bucket.push(chunkRun)
    chunkRunsBySlot.set(workerSlotIndex, bucket)
  }
  const reusedSlotBuckets = Array.from(chunkRunsBySlot.values()).filter((bucket) => bucket.length > 1)
  assert(reusedSlotBuckets.length > 0, "Persistent-slot request/grant integrated smoke expected slot reuse")
  for (const bucket of reusedSlotBuckets) {
    const pidSet = new Set(bucket.map((chunkRun) => Number(chunkRun?.pid ?? 0)))
    assert.equal(pidSet.size, 1, "Persistent-slot request/grant integrated smoke expected stable pid per reused slot")
  }

  const topupChunkRuns = chunkRuns.filter(
    (chunkRun) => Number(chunkRun?.topupAllocatedSearchStates ?? 0) > 0,
  )
  if (observedCommittedTopup) {
    assert(
      topupChunkRuns.length > 0,
      "Persistent-slot request/grant integrated smoke expected at least one granted top-up chunk when commit counters are positive",
    )
  } else {
    assert.equal(
      topupChunkRuns.length,
      0,
      "Persistent-slot request/grant integrated smoke must not record phantom top-up chunks when commit counters are zero",
    )
  }
  for (const chunkRun of topupChunkRuns) {
    const workerSummary = await readJson(String(chunkRun?.summaryPath ?? ""), null)
    assert(workerSummary, `Persistent-slot request/grant integrated smoke missing worker summary: ${chunkRun?.summaryPath}`)
    assert(Number(chunkRun?.budgetTopupGrantedCount ?? 0) > 0)
    assert(Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? 0) >
      Number(chunkRun?.allocatedMaxSearchStates ?? 0))
    assert(Number(chunkRun?.pendingBudgetRevision ?? 0) === 0)
    const rejectionSummary = workerSummary?.rejectionSummary ?? {}
    assert(Number(rejectionSummary?.externalBudgetAppliedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetCommitRevision ?? 0) > 0)
    assert(
      Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >
        Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
    )
  }

  assert.equal(
    parallel.catalog?.champion?.ruleId ?? null,
    indexedCatalog?.champion?.ruleId ?? null,
  )
  assert.deepStrictEqual(normalizeCoverage(parallel.coverage), normalizeCoverage(indexedCoverage))
  assert.deepStrictEqual(
    (parallel.matches ?? []).map(normalizeMatchRow),
    indexedMatches.map(normalizeMatchRow),
  )
  assert.deepStrictEqual(
    (parallel.dedupedMatches ?? []).map(normalizeMatchRow),
    indexedDeduped.map(normalizeMatchRow),
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        rootDir,
        parallelWorkerSpawnCount: Number(parallelManifest?.parallelWorkerSpawnCount ?? 0),
        parallelWorkerSlotReuseCount: Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0),
        parallelBudgetRequestCount: Number(parallelManifest?.parallelBudgetRequestCount ?? 0),
        parallelBudgetGrantCount: Number(parallelManifest?.parallelBudgetGrantCount ?? 0),
        parallelBudgetCommitCount: Number(parallelManifest?.parallelBudgetCommitCount ?? 0),
        parallelBudgetTopupCount: Number(parallelManifest?.parallelBudgetTopupCount ?? 0),
        observedCommittedTopup,
        parallelBudgetFastpathTickCount: Number(
          parallelManifest?.parallelBudgetFastpathTickCount ?? 0,
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
