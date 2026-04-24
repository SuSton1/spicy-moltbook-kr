import assert from "node:assert/strict"

import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = [
  {
    token: "head_heavy_singleton",
    positiveMatchCount: 1600,
    negativeMatchCount: 0,
    positiveCount: 1600,
    negativeCount: 0,
    positiveByteLength: 9_000_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 0,
    positiveLastRowIdx: 4_800_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 6,
  },
  {
    token: "head_fast_singleton",
    positiveMatchCount: 620,
    negativeMatchCount: 0,
    positiveCount: 620,
    negativeCount: 0,
    positiveByteLength: 120_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 12_000,
    positiveLastRowIdx: 16_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5,
  },
  {
    token: "tail_fast_singleton",
    positiveMatchCount: 700,
    negativeMatchCount: 0,
    positiveCount: 700,
    negativeCount: 0,
    positiveByteLength: 100_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 24_000,
    positiveLastRowIdx: 28_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.5,
  },
  {
    token: "tail_mid_singleton",
    positiveMatchCount: 760,
    negativeMatchCount: 2,
    positiveCount: 760,
    negativeCount: 2,
    positiveByteLength: 450_000,
    negativeByteLength: 12_000,
    positiveFirstRowIdx: 42_000,
    positiveLastRowIdx: 86_000,
    negativeFirstRowIdx: 42_100,
    negativeLastRowIdx: 85_900,
    precision: 0.997,
    separationRatio: 3,
  },
]

const chunks = [
  { chunkIndex: 0, start: 0, end: 1, estimatedCost: 800, bootstrapHead: true },
  { chunkIndex: 1, start: 1, end: 2, estimatedCost: 140, bootstrapHead: true },
  { chunkIndex: 2, start: 2, end: 3, estimatedCost: 150, bootstrapHead: false },
  { chunkIndex: 3, start: 3, end: 4, estimatedCost: 260, bootstrapHead: false },
]

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.00025,
      meanPositiveGap: 3000,
      sampleExactByteLength: 9_000_000,
      branchCandidateCount: 9,
      branchOverlapMass: 800,
    },
  ],
  [
    1,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.18,
      meanPositiveGap: 1.5,
      sampleExactByteLength: 120_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
  [
    2,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.16,
      meanPositiveGap: 2,
      sampleExactByteLength: 100_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
  [
    3,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.017,
      meanPositiveGap: 28,
      sampleExactByteLength: 462_000,
      branchCandidateCount: 2,
      branchOverlapMass: 40,
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
  assert(heavyHead, "heavy head singleton must remain in the queue")
  assert(fastHead, "fast head singleton must remain in the queue")
  assert(fastTail, "fast tail singleton must remain in the queue")
  assert(
    Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
      Number(heavyHead?.dispatchPriorityIndex ?? -1),
    "completion ranking must demote the heavy singleton head behind a faster singleton head",
  )
  assert(
    Number(fastTail?.dispatchPriorityIndex ?? Infinity) <
      Number(heavyHead?.dispatchPriorityIndex ?? -1),
    "completion ranking must allow a fast singleton tail to preempt a slower singleton head",
  )
  assert(
    Number(fastHead?.firstWaveDispatchScore ?? 0) >
      Number(heavyHead?.firstWaveDispatchScore ?? Number.POSITIVE_INFINITY),
    "fast singleton head must have a better first-wave completion score than the heavy singleton head",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_single_root_completion_ranking",
        queue: readyQueue.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          bootstrapHead: chunk.bootstrapHead,
          dispatchPriorityIndex: chunk.dispatchPriorityIndex,
          dispatchScore: chunk.dispatchScore,
          firstWaveDispatchScore: chunk.firstWaveDispatchScore,
          singletonRootCompletionScore: chunk.singletonRootCompletionScore,
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
