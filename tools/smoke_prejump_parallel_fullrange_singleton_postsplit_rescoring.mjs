import assert from "node:assert/strict"

import {
  buildDeterministicReadyQueue,
  splitFirstWaveLaunchChunksIntoRootSeedMicroshards,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = [
  {
    token: "head_slow_root_0",
    positiveMatchCount: 1400,
    negativeMatchCount: 0,
    positiveCount: 1400,
    negativeCount: 0,
    positiveByteLength: 8_400_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 0,
    positiveLastRowIdx: 4_600_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.8,
  },
  {
    token: "head_fast_root_1",
    positiveMatchCount: 610,
    negativeMatchCount: 0,
    positiveCount: 610,
    negativeCount: 0,
    positiveByteLength: 120_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 10_000,
    positiveLastRowIdx: 15_500,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.9,
  },
  {
    token: "head_mid_root_2",
    positiveMatchCount: 720,
    negativeMatchCount: 1,
    positiveCount: 720,
    negativeCount: 1,
    positiveByteLength: 460_000,
    negativeByteLength: 12_000,
    positiveFirstRowIdx: 20_000,
    positiveLastRowIdx: 65_000,
    negativeFirstRowIdx: 20_100,
    negativeLastRowIdx: 64_900,
    precision: 0.999,
    separationRatio: 3.3,
  },
  {
    token: "head_mid_root_3",
    positiveMatchCount: 680,
    negativeMatchCount: 0,
    positiveCount: 680,
    negativeCount: 0,
    positiveByteLength: 310_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 24_000,
    positiveLastRowIdx: 52_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.2,
  },
  {
    token: "tail_fast_root_4",
    positiveMatchCount: 560,
    negativeMatchCount: 0,
    positiveCount: 560,
    negativeCount: 0,
    positiveByteLength: 110_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 40_000,
    positiveLastRowIdx: 45_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 5.1,
  },
  {
    token: "tail_mid_root_5",
    positiveMatchCount: 700,
    negativeMatchCount: 0,
    positiveCount: 700,
    negativeCount: 0,
    positiveByteLength: 320_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 52_000,
    positiveLastRowIdx: 80_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.4,
  },
  {
    token: "tail_mid_root_6",
    positiveMatchCount: 710,
    negativeMatchCount: 0,
    positiveCount: 710,
    negativeCount: 0,
    positiveByteLength: 350_000,
    negativeByteLength: 0,
    positiveFirstRowIdx: 60_000,
    positiveLastRowIdx: 92_000,
    negativeFirstRowIdx: 0,
    negativeLastRowIdx: 0,
    precision: 1,
    separationRatio: 4.1,
  },
  {
    token: "tail_mid_root_7",
    positiveMatchCount: 660,
    negativeMatchCount: 2,
    positiveCount: 660,
    negativeCount: 2,
    positiveByteLength: 500_000,
    negativeByteLength: 14_000,
    positiveFirstRowIdx: 72_000,
    positiveLastRowIdx: 126_000,
    negativeFirstRowIdx: 72_040,
    negativeLastRowIdx: 125_960,
    precision: 0.997,
    separationRatio: 3.1,
  },
]

const parentChunks = [
  {
    chunkIndex: 0,
    start: 0,
    end: 4,
    estimatedCost: 1200,
    bootstrapHead: true,
    firstWaveDispatchScoreOverride: 1_000_000,
  },
  {
    chunkIndex: 1,
    start: 4,
    end: 8,
    estimatedCost: 900,
    bootstrapHead: false,
    firstWaveDispatchScoreOverride: 999_999,
  },
]

const main = async () => {
  const {
    chunks: microshardChunks,
    firstWaveRootSeedMicroshardCount,
    firstWaveForcedSingletonMicroshardCount,
  } = splitFirstWaveLaunchChunksIntoRootSeedMicroshards({
    chunks: parentChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 1,
    bootstrapHeadFirstWaveQuota: 1,
    targetRootSeedMicroshardMultiplier: 6,
    maxMicroshardCountPerLaunchChunk: 8,
    forceSingletonFirstWaveLaunchChunkWidth: 4,
  })

  assert(firstWaveRootSeedMicroshardCount >= 2, "post-split rescoring fixture must create root-seed microshards")
  assert(firstWaveForcedSingletonMicroshardCount >= 8, "both selected parents must be forced to singleton-root children")

  const descendants = microshardChunks.filter((chunk) => chunk?.rootSeedMicroshard === true)
  assert.equal(descendants.length, 8, "all roots in the selected parents must become singleton children")
  assert(
    descendants.every((chunk) => chunk?.firstWaveDispatchScoreOverride == null),
    "post-split singleton children must not keep parent first-wave score overrides",
  )
  assert(
    descendants.every((chunk) => chunk?.dispatchScoreOverride == null),
    "post-split singleton children must not keep parent dispatch score overrides",
  )
  assert(
    descendants.every((chunk) => chunk?.headMicroprobeOverride == null),
    "post-split singleton children must not keep parent microprobe overrides",
  )

  const childMicroprobesByChunkIndex = new Map(
    descendants.map((chunk) => {
      const start = Number(chunk?.start ?? -1)
      if (start === 0) {
        return [
          Number(chunk?.chunkIndex ?? -1),
          {
            sampledRootCount: 1,
            meanPositiveDensity: 0.0002,
            meanPositiveGap: 3200,
            sampleExactByteLength: 8_400_000,
            branchCandidateCount: 10,
            branchOverlapMass: 900,
          },
        ]
      }
      if (start === 1) {
        return [
          Number(chunk?.chunkIndex ?? -1),
          {
            sampledRootCount: 1,
            meanPositiveDensity: 0.18,
            meanPositiveGap: 1.4,
            sampleExactByteLength: 120_000,
            branchCandidateCount: 0,
            branchOverlapMass: 0,
          },
        ]
      }
      if (start === 4) {
        return [
          Number(chunk?.chunkIndex ?? -1),
          {
            sampledRootCount: 1,
            meanPositiveDensity: 0.16,
            meanPositiveGap: 1.7,
            sampleExactByteLength: 110_000,
            branchCandidateCount: 0,
            branchOverlapMass: 0,
          },
        ]
      }
      return [
        Number(chunk?.chunkIndex ?? -1),
        {
          sampledRootCount: 1,
          meanPositiveDensity: 0.03,
          meanPositiveGap: 18,
          sampleExactByteLength: 420_000,
          branchCandidateCount: 2,
          branchOverlapMass: 30,
        },
      ]
    }),
  )

  const readyQueue = buildDeterministicReadyQueue({
    chunks: microshardChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 1,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex: childMicroprobesByChunkIndex,
  })

  const firstWave = readyQueue.slice(0, 2)
  assert.equal(
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length,
    1,
    "post-split rescoring must still preserve the first-wave bootstrap-head quota",
  )

  const slowHead = readyQueue.find((chunk) => Number(chunk?.start ?? -1) === 0)
  const fastHead = readyQueue.find((chunk) => Number(chunk?.start ?? -1) === 1)
  const fastTail = readyQueue.find((chunk) => Number(chunk?.start ?? -1) === 4)
  assert(slowHead, "slow head singleton must remain in the queue")
  assert(fastHead, "fast head singleton must remain in the queue")
  assert(fastTail, "fast tail singleton must remain in the queue")
  assert(
    Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
      Number(slowHead?.dispatchPriorityIndex ?? -1),
    "child-local rescoring must let a fast head singleton outrank a slow sibling from the same parent",
  )
  assert(
    Number(fastTail?.dispatchPriorityIndex ?? Infinity) <
      Number(slowHead?.dispatchPriorityIndex ?? -1),
    "child-local rescoring must let a fast tail singleton outrank a slow singleton from a higher-scored parent",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_singleton_postsplit_rescoring",
        firstWaveRootSeedMicroshardCount,
        firstWaveForcedSingletonMicroshardCount,
        queue: readyQueue.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          splitSourceChunkIndex: chunk.splitSourceChunkIndex ?? null,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
          dispatchPriorityIndex: chunk.dispatchPriorityIndex,
          firstWaveDispatchScore: chunk.firstWaveDispatchScore ?? null,
          singletonRootCompletionScore: chunk.singletonRootCompletionScore ?? null,
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
