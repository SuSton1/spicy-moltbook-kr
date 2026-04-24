import assert from "node:assert/strict"

import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = [
  {
    token: "head_heavy_a",
    positiveMatchCount: 1800,
    negativeMatchCount: 0,
    positiveCount: 1800,
    negativeCount: 0,
    positiveByteLength: 8_000_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 0,
    positiveLastRowIdx: 4_600_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.5,
  },
  {
    token: "head_heavy_b",
    positiveMatchCount: 1550,
    negativeMatchCount: 0,
    positiveCount: 1550,
    negativeCount: 0,
    positiveByteLength: 6_500_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 12_000,
    positiveLastRowIdx: 4_200_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5,
  },
  {
    token: "head_heavy_c",
    positiveMatchCount: 1420,
    negativeMatchCount: 2,
    positiveCount: 1420,
    negativeCount: 2,
    positiveByteLength: 5_800_000,
    negativeByteLength: 9_000,
    positiveFirstRowIdx: 40_000,
    positiveLastRowIdx: 3_800_000,
    negativeFirstRowIdx: 40_100,
    negativeLastRowIdx: 3_799_900,
    precision: 0.998,
    separationRatio: 4.2,
  },
  {
    token: "head_heavy_d",
    positiveMatchCount: 1280,
    negativeMatchCount: 3,
    positiveCount: 1280,
    negativeCount: 3,
    positiveByteLength: 5_200_000,
    negativeByteLength: 11_000,
    positiveFirstRowIdx: 60_000,
    positiveLastRowIdx: 3_100_000,
    negativeFirstRowIdx: 60_150,
    negativeLastRowIdx: 3_099_850,
    precision: 0.997,
    separationRatio: 3.8,
  },
  {
    token: "head_fast_a",
    positiveMatchCount: 510,
    negativeMatchCount: 0,
    positiveCount: 510,
    negativeCount: 0,
    positiveByteLength: 140_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 8_000,
    positiveLastRowIdx: 12_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.8,
  },
  {
    token: "head_fast_b",
    positiveMatchCount: 530,
    negativeMatchCount: 0,
    positiveCount: 530,
    negativeCount: 0,
    positiveByteLength: 150_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 14_000,
    positiveLastRowIdx: 18_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.6,
  },
  {
    token: "tail_fast_a",
    positiveMatchCount: 560,
    negativeMatchCount: 0,
    positiveCount: 560,
    negativeCount: 0,
    positiveByteLength: 130_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 24_000,
    positiveLastRowIdx: 29_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.1,
  },
  {
    token: "tail_fast_b",
    positiveMatchCount: 575,
    negativeMatchCount: 0,
    positiveCount: 575,
    negativeCount: 0,
    positiveByteLength: 135_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 31_000,
    positiveLastRowIdx: 36_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.2,
  },
  {
    token: "tail_mid_a",
    positiveMatchCount: 800,
    negativeMatchCount: 5,
    positiveCount: 800,
    negativeCount: 5,
    positiveByteLength: 520_000,
    negativeByteLength: 18_000,
    positiveFirstRowIdx: 52_000,
    positiveLastRowIdx: 130_000,
    negativeFirstRowIdx: 52_100,
    negativeLastRowIdx: 129_900,
    precision: 0.994,
    separationRatio: 3,
  },
  {
    token: "tail_mid_b",
    positiveMatchCount: 770,
    negativeMatchCount: 6,
    positiveCount: 770,
    negativeCount: 6,
    positiveByteLength: 500_000,
    negativeByteLength: 20_000,
    positiveFirstRowIdx: 132_000,
    positiveLastRowIdx: 220_000,
    negativeFirstRowIdx: 132_100,
    negativeLastRowIdx: 219_900,
    precision: 0.993,
    separationRatio: 2.8,
  },
]

const chunks = [
  { chunkIndex: 0, start: 0, end: 4, estimatedCost: 1_200, bootstrapHead: true },
  { chunkIndex: 1, start: 4, end: 6, estimatedCost: 180, bootstrapHead: true },
  { chunkIndex: 2, start: 6, end: 8, estimatedCost: 185, bootstrapHead: false },
  { chunkIndex: 3, start: 8, end: 10, estimatedCost: 320, bootstrapHead: false },
]

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.00018,
      meanPositiveGap: 2500,
      sampleExactByteLength: 14_000_000,
      branchCandidateCount: 10,
      branchOverlapMass: 900,
    },
  ],
  [
    1,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.12,
      meanPositiveGap: 1.8,
      sampleExactByteLength: 290_000,
      branchCandidateCount: 1,
      branchOverlapMass: 6,
    },
  ],
  [
    2,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.115,
      meanPositiveGap: 2,
      sampleExactByteLength: 265_000,
      branchCandidateCount: 1,
      branchOverlapMass: 4,
    },
  ],
  [
    3,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.016,
      meanPositiveGap: 34,
      sampleExactByteLength: 1_058_000,
      branchCandidateCount: 4,
      branchOverlapMass: 120,
    },
  ],
])

const main = async () => {
  const readyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })

  const firstWave = readyQueue.slice(0, 2)
  assert.equal(
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length,
    1,
    "first workerCount launches must still contain exactly one bootstrap-head chunk on this fixture",
  )

  const heavyHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 0)
  const fastHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 1)
  const fastTail = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 2)
  assert(heavyHead, "heavy multi-root head must remain in the queue")
  assert(fastHead, "fast multi-root head must remain in the queue")
  assert(fastTail, "fast multi-root tail must remain in the queue")
  assert(
    Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
      Number(heavyHead?.dispatchPriorityIndex ?? -1),
    "completion ranking must demote the heavy multi-root head behind a faster multi-root head",
  )
  assert(
    Number(fastTail?.dispatchPriorityIndex ?? Infinity) <
      Number(heavyHead?.dispatchPriorityIndex ?? -1),
    "completion ranking must allow a fast multi-root tail to preempt a slower multi-root head",
  )
  assert(
    Number(fastHead?.multiRootCompletionScore ?? 0) >
      Number(heavyHead?.multiRootCompletionScore ?? Number.POSITIVE_INFINITY),
    "fast multi-root head must have a better completion score than the heavy multi-root head",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_multi_root_completion_ranking",
        queue: readyQueue.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          bootstrapHead: chunk.bootstrapHead,
          dispatchPriorityIndex: chunk.dispatchPriorityIndex,
          dispatchScore: chunk.dispatchScore,
          firstWaveDispatchScore: chunk.firstWaveDispatchScore,
          multiRootCompletionScore: chunk.multiRootCompletionScore,
          width: Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0),
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
