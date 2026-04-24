import assert from "node:assert/strict"

import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = [
  {
    token: "target_root_a",
    positiveMatchCount: 600,
    negativeMatchCount: 0,
    positiveCount: 600,
    negativeCount: 0,
    positiveByteLength: 220_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 1_000,
    positiveLastRowIdx: 11_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.2,
  },
  {
    token: "target_root_b",
    positiveMatchCount: 610,
    negativeMatchCount: 0,
    positiveCount: 610,
    negativeCount: 0,
    positiveByteLength: 210_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 12_000,
    positiveLastRowIdx: 21_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.1,
  },
  {
    token: "non_target_fast_root",
    positiveMatchCount: 650,
    negativeMatchCount: 0,
    positiveCount: 650,
    negativeCount: 0,
    positiveByteLength: 80_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 22_000,
    positiveLastRowIdx: 25_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.4,
  },
]

const chunks = [
  {
    chunkIndex: 0,
    start: 0,
    end: 1,
    estimatedCost: 400,
    bootstrapHead: false,
    firstWaveCompletionTarget: true,
    firstWaveDispatchScoreOverride: 90,
  },
  {
    chunkIndex: 1,
    start: 1,
    end: 2,
    estimatedCost: 420,
    bootstrapHead: false,
    firstWaveCompletionTarget: true,
    firstWaveDispatchScoreOverride: 20,
  },
  {
    chunkIndex: 2,
    start: 2,
    end: 3,
    estimatedCost: 120,
    bootstrapHead: false,
    firstWaveCompletionTarget: false,
    firstWaveDispatchScoreOverride: 100,
  },
]

const main = async () => {
  const readyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 0,
    bootstrapHeadFirstWaveQuota: 0,
  })

  assert.equal(readyQueue.length, 3, "synthetic ready queue must keep all chunks")
  assert.deepEqual(
    readyQueue.slice(0, 2).map((chunk) => Number(chunk?.chunkIndex ?? -1)),
    [2, 0],
    "first-wave competition must allow a higher-scoring non-target chunk to preempt a lower-scoring completion target",
  )
}

await main()

