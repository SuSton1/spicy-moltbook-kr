import assert from "node:assert/strict"

import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = [
  {
    token: "head_fast_singleton",
    positiveMatchCount: 540,
    negativeMatchCount: 0,
    positiveCount: 540,
    negativeCount: 0,
    positiveByteLength: 140_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 12_000,
    positiveLastRowIdx: 16_500,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.7,
  },
  {
    token: "head_medium_singleton",
    positiveMatchCount: 690,
    negativeMatchCount: 1,
    positiveCount: 690,
    negativeCount: 1,
    positiveByteLength: 460_000,
    negativeByteLength: 12_000,
    positiveFirstRowIdx: 18_000,
    positiveLastRowIdx: 72_000,
    negativeFirstRowIdx: 18_050,
    negativeLastRowIdx: 71_950,
    precision: 0.999,
    separationRatio: 3.1,
  },
  {
    token: "tail_rule_rich_but_slow_singleton",
    positiveMatchCount: 910,
    negativeMatchCount: 0,
    positiveCount: 910,
    negativeCount: 0,
    positiveByteLength: 8_600_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 32_000,
    positiveLastRowIdx: 4_900_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 6.4,
  },
  {
    token: "tail_fast_singleton",
    positiveMatchCount: 560,
    negativeMatchCount: 0,
    positiveCount: 560,
    negativeCount: 0,
    positiveByteLength: 125_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 44_000,
    positiveLastRowIdx: 49_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.9,
  },
]

const chunks = [
  { chunkIndex: 0, start: 0, end: 1, estimatedCost: 140, bootstrapHead: true },
  { chunkIndex: 1, start: 1, end: 2, estimatedCost: 330, bootstrapHead: true },
  { chunkIndex: 2, start: 2, end: 3, estimatedCost: 980, bootstrapHead: false },
  { chunkIndex: 3, start: 3, end: 4, estimatedCost: 150, bootstrapHead: false },
]

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.16,
      meanPositiveGap: 1.7,
      sampleExactByteLength: 140_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
  [
    1,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.02,
      meanPositiveGap: 16,
      sampleExactByteLength: 472_000,
      branchCandidateCount: 2,
      branchOverlapMass: 24,
    },
  ],
  [
    2,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.11,
      meanPositiveGap: 3.2,
      sampleExactByteLength: 8_600_000,
      branchCandidateCount: 11,
      branchOverlapMass: 880,
    },
  ],
  [
    3,
    {
      sampledRootCount: 1,
      meanPositiveDensity: 0.15,
      meanPositiveGap: 1.8,
      sampleExactByteLength: 125_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
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

  const slowTail = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 2)
  const fastHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 0)
  const fastTail = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 3)
  assert(slowTail, "slow singleton tail must remain in the queue")
  assert(fastHead, "fast singleton head must remain in the queue")
  assert(fastTail, "fast singleton tail must remain in the queue")
  assert(
    Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
      Number(slowTail?.dispatchPriorityIndex ?? -1),
    "calibrated singleton completion score must keep a fast singleton head ahead of a rule-rich slow singleton tail",
  )
  assert(
    Number(fastTail?.dispatchPriorityIndex ?? Infinity) <
      Number(slowTail?.dispatchPriorityIndex ?? -1),
    "calibrated singleton completion score must demote a rule-rich slow singleton tail behind a materially faster singleton tail",
  )
  assert(
    Number(fastTail?.singletonRootCompletionScore ?? 0) >
      Number(slowTail?.singletonRootCompletionScore ?? Number.POSITIVE_INFINITY),
    "fast singleton tail must have a better completion score than the slow rule-rich singleton tail",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_singleton_completion_score_calibration",
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
