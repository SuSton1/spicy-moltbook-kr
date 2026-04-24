import assert from "node:assert/strict"

import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const buildSyntheticSeedStats = () => [
  {
    token: "head_strong_000",
    positiveMatchCount: 1200,
    negativeMatchCount: 0,
    positiveCount: 1200,
    negativeCount: 0,
    positiveByteLength: 180_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 0,
    positiveLastRowIdx: 2_400,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5,
  },
  {
    token: "head_strong_001",
    positiveMatchCount: 1100,
    negativeMatchCount: 0,
    positiveCount: 1100,
    negativeCount: 0,
    positiveByteLength: 170_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 16,
    positiveLastRowIdx: 2_200,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.5,
  },
  {
    token: "head_weak_000",
    positiveMatchCount: 520,
    negativeMatchCount: 8,
    positiveCount: 520,
    negativeCount: 8,
    positiveByteLength: 750_000,
    negativeByteLength: 48_000,
    positiveFirstRowIdx: 100_000,
    positiveLastRowIdx: 480_000,
    negativeFirstRowIdx: 100_010,
    negativeLastRowIdx: 480_040,
    precision: 0.985,
    separationRatio: 1.4,
  },
  {
    token: "head_weak_001",
    positiveMatchCount: 500,
    negativeMatchCount: 6,
    positiveCount: 500,
    negativeCount: 6,
    positiveByteLength: 710_000,
    negativeByteLength: 40_000,
    positiveFirstRowIdx: 120_000,
    positiveLastRowIdx: 520_000,
    negativeFirstRowIdx: 120_020,
    negativeLastRowIdx: 520_040,
    precision: 0.988,
    separationRatio: 1.2,
  },
  {
    token: "tail_strong_000",
    positiveMatchCount: 900,
    negativeMatchCount: 0,
    positiveCount: 900,
    negativeCount: 0,
    positiveByteLength: 120_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 10_000,
    positiveLastRowIdx: 12_200,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.5,
  },
  {
    token: "tail_strong_001",
    positiveMatchCount: 880,
    negativeMatchCount: 0,
    positiveCount: 880,
    negativeCount: 0,
    positiveByteLength: 115_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 10_020,
    positiveLastRowIdx: 12_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.2,
  },
  {
    token: "tail_mid_000",
    positiveMatchCount: 700,
    negativeMatchCount: 2,
    positiveCount: 700,
    negativeCount: 2,
    positiveByteLength: 220_000,
    negativeByteLength: 8_000,
    positiveFirstRowIdx: 40_000,
    positiveLastRowIdx: 52_500,
    negativeFirstRowIdx: 40_100,
    negativeLastRowIdx: 52_200,
    precision: 0.997,
    separationRatio: 3.8,
  },
  {
    token: "tail_mid_001",
    positiveMatchCount: 680,
    negativeMatchCount: 2,
    positiveCount: 680,
    negativeCount: 2,
    positiveByteLength: 210_000,
    negativeByteLength: 8_000,
    positiveFirstRowIdx: 42_000,
    positiveLastRowIdx: 54_000,
    negativeFirstRowIdx: 42_100,
    negativeLastRowIdx: 53_800,
    precision: 0.997,
    separationRatio: 3.6,
  },
]

const chunks = [
  { chunkIndex: 0, start: 0, end: 2, estimatedCost: 100, bootstrapHead: true },
  { chunkIndex: 1, start: 2, end: 4, estimatedCost: 120, bootstrapHead: true },
  { chunkIndex: 2, start: 4, end: 6, estimatedCost: 110, bootstrapHead: false },
  { chunkIndex: 3, start: 6, end: 8, estimatedCost: 130, bootstrapHead: false },
]

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.48,
      meanPositiveGap: 2.1,
      sampleExactByteLength: 150_000,
      branchCandidateCount: 1,
      branchOverlapMass: 20,
    },
  ],
  [
    1,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.0015,
      meanPositiveGap: 950,
      sampleExactByteLength: 1_800_000,
      branchCandidateCount: 7,
      branchOverlapMass: 180,
    },
  ],
  [
    2,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.55,
      meanPositiveGap: 1.7,
      sampleExactByteLength: 95_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
])

const main = async () => {
  const readyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats: buildSyntheticSeedStats(),
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    chunkHeadMicroprobesByChunkIndex,
  })

  const firstWave = readyQueue.slice(0, 2)
  assert.equal(
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length,
    1,
    "first workerCount launches must contain at least one bootstrap-head chunk",
  )

  const initialBand = readyQueue.slice(0, 4)
  assert.equal(
    initialBand.filter((chunk) => chunk.bootstrapHead === true).length,
    2,
    "initial dispatch band must preserve the bootstrap-head launch quota",
  )

  const weakHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 1)
  const strongTail = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 2)
  assert(weakHead, "weak bootstrap-head chunk must remain in the ready queue")
  assert(strongTail, "strong tail chunk must remain in the ready queue")
  assert(
    Number(strongTail?.dispatchPriorityIndex ?? Infinity) <
      Number(weakHead?.dispatchPriorityIndex ?? -1),
    "stronger tail chunk must be allowed to preempt a weaker bootstrap-head chunk",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_head_microprobe_dispatch",
        queue: readyQueue.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          bootstrapHead: chunk.bootstrapHead,
          dispatchPriorityIndex: chunk.dispatchPriorityIndex,
          dispatchScore: chunk.dispatchScore,
          bootstrapDispatchScore: chunk.bootstrapDispatchScore,
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
