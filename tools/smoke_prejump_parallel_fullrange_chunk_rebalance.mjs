import assert from "node:assert/strict"

import {
  buildDeterministicCostAwareChunks,
  buildDeterministicReadyQueue,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const buildSyntheticSeedStats = () => {
  const entries = []
  for (let index = 0; index < 97; index += 1) {
    entries.push({
      positiveMatchCount: 1_000_000_000,
      negativeMatchCount: 0,
      precision: 1,
      separationRatio: 4,
    })
  }
  for (let index = 97; index < 1496; index += 1) {
    entries.push({
      positiveMatchCount: 1_000,
      negativeMatchCount: 0,
      precision: 1,
      separationRatio: 1,
    })
  }
  return entries
}

const main = async () => {
  const seedStats = buildSyntheticSeedStats()
  const workerCount = 2
  const targetChunkCount = Math.max(
    workerCount,
    Math.min(seedStats.length || 1, Math.max(workerCount * 16, 32)),
  )
  const bootstrapHeadChunkCount = Math.max(
    workerCount,
    Math.min(targetChunkCount, Math.max(workerCount * 4, 4)),
  )
  const chunks = buildDeterministicCostAwareChunks({
    seedStats,
    chunkCount: targetChunkCount,
    bootstrapHeadChunkCount,
    bootstrapHeadTargetDivisor: 4,
  })
  const readyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount,
    bootstrapHeadLaunchQuota: workerCount,
  })

  assert.equal(
    chunks.length,
    targetChunkCount,
    "full-range skewed planner must preserve the target chunk count",
  )
  assert.equal(
    chunks.filter((chunk) => chunk.bootstrapHead === true).length,
    bootstrapHeadChunkCount,
    "full-range skewed planner must preserve the bootstrap head chunk count",
  )
  assert(
    chunks.some((chunk) => chunk.bootstrapHead !== true),
    "full-range skewed planner must leave tail chunks after the bootstrap head",
  )
  assert(
    readyQueue.slice(0, Math.min(readyQueue.length, workerCount * 2)).filter((chunk) => chunk.bootstrapHead === true)
      .length >= workerCount,
    "bootstrap head chunks must satisfy the initial dispatch-band quota",
  )
  assert(
    readyQueue.slice(bootstrapHeadChunkCount).some((chunk) => chunk.bootstrapHead !== true),
    "tail chunks must remain schedulable after the bootstrap head",
  )

  const positiveCosts = chunks
    .map((chunk) => Number(chunk?.estimatedCost ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  const imbalanceRatio =
    positiveCosts.length > 0 ? Math.max(...positiveCosts) / Math.min(...positiveCosts) : null
  assert(
    Number.isFinite(imbalanceRatio) && imbalanceRatio <= 10,
    `full-range skewed planner imbalance must stay bounded: ${imbalanceRatio}`,
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_chunk_rebalance",
        chunkCount: chunks.length,
        bootstrapHeadChunkCount: chunks.filter((chunk) => chunk.bootstrapHead === true).length,
        tailChunkCount: chunks.filter((chunk) => chunk.bootstrapHead !== true).length,
        imbalanceRatio,
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
