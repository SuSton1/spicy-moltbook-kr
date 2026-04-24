import assert from "node:assert/strict"

import {
  buildDeterministicCostAwareChunks,
  buildDeterministicReadyQueue,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const buildSyntheticSeedStats = () => {
  const entries = []
  for (let index = 0; index < 64; index += 1) {
    entries.push({
      token: `moderate_${index.toString().padStart(4, "0")}`,
      positiveMatchCount: 1000,
      negativeMatchCount: 0,
      positiveCount: 1000,
      negativeCount: 0,
      positiveByteLength: 180_000,
      negativeByteLength: 0,
      positiveFirstRowIdx: index * 200,
      positiveLastRowIdx: index * 200 + 2_500,
      negativeFirstRowIdx: 0,
      negativeLastRowIdx: 0,
      precision: 1,
      separationRatio: 4,
    })
  }
  for (let index = 64; index < 128; index += 1) {
    entries.push({
      token: `heavy_${index.toString().padStart(4, "0")}`,
      positiveMatchCount: 1000,
      negativeMatchCount: 0,
      positiveCount: 1000,
      negativeCount: 0,
      positiveByteLength: 9_000_000,
      negativeByteLength: 0,
      positiveFirstRowIdx: index * 25_000,
      positiveLastRowIdx: index * 25_000 + 900_000,
      negativeFirstRowIdx: 0,
      negativeLastRowIdx: 0,
      precision: 1,
      separationRatio: 4,
    })
  }
  return entries
}

const computeImbalanceRatio = (costs) => {
  const safeCosts = (Array.isArray(costs) ? costs : [])
    .map((value) => Number(value ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (safeCosts.length < 1) return null
  return Math.max(...safeCosts) / Math.min(...safeCosts)
}

const main = async () => {
  const seedStats = buildSyntheticSeedStats()
  const workerCount = 2
  const targetChunkCount = 8
  const bootstrapHeadChunkCount = 2
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

  assert.equal(chunks.length, targetChunkCount, "cost-calibrated planner must preserve target chunk count")
  assert.equal(
    chunks.filter((chunk) => chunk.bootstrapHead === true).length,
    bootstrapHeadChunkCount,
    "cost-calibrated planner must preserve bootstrap head chunk count",
  )
  assert(
    readyQueue.slice(0, Math.min(readyQueue.length, workerCount)).filter((chunk) => chunk.bootstrapHead === true)
      .length >= 1,
    "first workerCount launches must contain at least one bootstrap-head chunk",
  )
  assert(
    readyQueue.slice(0, Math.min(readyQueue.length, workerCount * 2)).filter((chunk) => chunk.bootstrapHead === true)
      .length >= workerCount,
    "bootstrap head quota must be preserved inside the initial ready-queue band",
  )

  const bootstrapHeadChunks = chunks.filter((chunk) => chunk.bootstrapHead === true)
  assert(
    bootstrapHeadChunks.every((chunk) => Number(chunk?.end ?? 0) <= 64),
    "dictionary-aware head planning must keep giant high-byte seeds out of the bootstrap head prefix",
  )

  const chunkCosts = chunks.map((chunk) => Number(chunk?.estimatedCost ?? 0))
  const imbalanceRatio = computeImbalanceRatio(chunkCosts)
  assert(
    Number.isFinite(imbalanceRatio) && imbalanceRatio <= 8,
    `dictionary-aware planner imbalance must stay bounded on skewed byte/span fixtures: ${imbalanceRatio}`,
  )

  const moderateHeavyCostDelta =
    Math.max(...chunkCosts.slice(bootstrapHeadChunkCount)) -
    Math.min(...bootstrapHeadChunks.map((chunk) => Number(chunk?.estimatedCost ?? 0)))
  assert(
    moderateHeavyCostDelta > 0,
    "high-byte/high-span chunks must remain more expensive than bootstrap-head moderate chunks",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_cost_calibration",
        chunkCount: chunks.length,
        bootstrapHeadChunkCount: bootstrapHeadChunks.length,
        imbalanceRatio,
        bootstrapHeadRanges: bootstrapHeadChunks.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          estimatedCost: chunk.estimatedCost,
        })),
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
