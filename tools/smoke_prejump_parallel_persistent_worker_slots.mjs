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
            "Predictive indexed persistent-worker smoke setup failed",
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
    toolName: "smoke_prejump_parallel_persistent_worker_slots",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_persistent_worker_slots",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error(
      "Persistent-worker slot smoke missing rootDir from indexed adversarial smoke output",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_persistent_worker_slots",
  })

  const indexDir = path.join(rootDir, "index")
  const indexedDir = path.join(rootDir, "indexed")
  const parallelDir = path.join(rootDir, "parallel_persistent_slots")
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
    },
  })
  assert(parallel, "Persistent-worker slot smoke parallel run did not return a result")

  const indexedCatalog = await readJson(path.join(indexedDir, "catalog.json"), null)
  const indexedCoverage = await readJson(path.join(indexedDir, "coverage.json"), null)
  const indexedMatches = await readJsonlRows(path.join(indexedDir, "matches.jsonl"))
  const indexedDeduped = await readJsonlRows(path.join(indexedDir, "deduped_matches.jsonl"))
  const parallelManifest = await readJson(path.join(parallelDir, "parallel_manifest.json"), null)
  assert(parallelManifest, "Persistent-worker slot smoke missing parallel manifest")
  assert.equal(Number(parallelManifest?.version ?? 0), 14)
  assert.equal(Number(parallelManifest?.parallelWorkerSpawnCount ?? 0), 2)
  assert(Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelWorkerWarmLaunchCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelWorkerColdStartMs ?? 0) > 0)
  assert(Number(parallelManifest?.parallelWorkerWarmLaunchMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathTickCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathIdleTickCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathServiceMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelWorkerSlotCompletionPollCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelWorkerSlotCompletionPollServiceMs ?? 0) >= 0)

  const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
  assert(chunkRuns.length > 2, "Persistent-worker slot smoke expected more chunkRuns than workers")

  const chunkRunsBySlot = new Map()
  for (const chunkRun of chunkRuns) {
    const workerSlotIndex = Number(chunkRun?.workerSlotIndex ?? -1)
    const bucket = chunkRunsBySlot.get(workerSlotIndex) ?? []
    bucket.push(chunkRun)
    chunkRunsBySlot.set(workerSlotIndex, bucket)
  }
  const reusedSlotBuckets = Array.from(chunkRunsBySlot.values()).filter((bucket) => bucket.length > 1)
  assert(reusedSlotBuckets.length > 0, "Persistent-worker slot smoke expected slot reuse")
  for (const bucket of reusedSlotBuckets) {
    const pidSet = new Set(bucket.map((chunkRun) => Number(chunkRun?.pid ?? 0)))
    assert.equal(pidSet.size, 1, "Persistent-worker slot smoke expected stable pid per reused slot")
    const commandRevisions = bucket.map((chunkRun) => Number(chunkRun?.slotCommandRevision ?? 0))
    assert(commandRevisions.every((value) => Number.isInteger(value) && value > 0))
    const uniqueCommandRevisions = new Set(commandRevisions)
    assert.equal(
      uniqueCommandRevisions.size,
      commandRevisions.length,
      "Persistent-worker slot smoke expected unique slot command revisions per slot",
    )
  }
  assert(
    chunkRuns.some(
      (chunkRun) => chunkRun?.warmLaunchEligible === true && Number(chunkRun?.warmLaunchMs ?? 0) >= 0,
    ),
    "Persistent-worker slot smoke expected at least one warm launch chunk",
  )

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
        parallelWorkerWarmLaunchCount: Number(parallelManifest?.parallelWorkerWarmLaunchCount ?? 0),
        parallelWorkerColdStartMs: Number(parallelManifest?.parallelWorkerColdStartMs ?? 0),
        parallelWorkerWarmLaunchMs: Number(parallelManifest?.parallelWorkerWarmLaunchMs ?? 0),
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
