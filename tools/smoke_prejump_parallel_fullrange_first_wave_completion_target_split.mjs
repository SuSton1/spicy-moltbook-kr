import assert from "node:assert/strict"

import {
  buildDeterministicReadyQueue,
  splitFirstWaveLaunchChunksForCompletion,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const buildSyntheticSeedStats = () => {
  const entries = []
  for (let index = 0; index < 24; index += 1) {
    const isHeadHeavy = index < 4
    const isTailHeavy = index >= 8 && index < 20
    const positiveByteLength = isHeadHeavy
      ? 420_000
      : isTailHeavy
        ? 3_600_000
        : 120_000
    const rowSpan = isHeadHeavy ? 240_000 : isTailHeavy ? 1_600_000 : 16_000
    entries.push({
      token: `seed_${index.toString().padStart(4, "0")}`,
      positiveMatchCount: isTailHeavy ? 940 : 640,
      negativeMatchCount: isTailHeavy ? 3 : 0,
      positiveCount: isTailHeavy ? 940 : 640,
      negativeCount: isTailHeavy ? 3 : 0,
      positiveByteLength,
      negativeByteLength: isTailHeavy ? 12_000 : 0,
      positiveFirstRowIdx: index * 128,
      positiveLastRowIdx: index * 128 + rowSpan,
      negativeFirstRowIdx: isTailHeavy ? index * 128 + 8 : 0,
      negativeLastRowIdx: isTailHeavy ? index * 128 + rowSpan - 8 : 0,
      precision: isTailHeavy ? 0.997 : 1,
      separationRatio: isTailHeavy ? 3.5 : 5,
    })
  }
  return entries
}

const chunks = [
  { chunkIndex: 0, start: 0, end: 4, estimatedCost: 400, bootstrapHead: true },
  { chunkIndex: 1, start: 4, end: 8, estimatedCost: 110, bootstrapHead: true },
  { chunkIndex: 2, start: 8, end: 20, estimatedCost: 1800, bootstrapHead: false },
  { chunkIndex: 3, start: 20, end: 24, estimatedCost: 120, bootstrapHead: false },
]

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.001,
      meanPositiveGap: 1400,
      sampleExactByteLength: 1_200_000,
      branchCandidateCount: 8,
      branchOverlapMass: 320,
    },
  ],
  [
    1,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.42,
      meanPositiveGap: 4,
      sampleExactByteLength: 180_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
  [
    2,
    {
      sampledRootCount: 3,
      meanPositiveDensity: 0.0004,
      meanPositiveGap: 2600,
      sampleExactByteLength: 7_200_000,
      branchCandidateCount: 10,
      branchOverlapMass: 640,
    },
  ],
  [
    3,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.5,
      meanPositiveGap: 3,
      sampleExactByteLength: 90_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
])

const countChunksCoveringRange = (ranges, start, end, bootstrapHead = null) =>
  ranges.filter((chunk) => {
    const overlaps = Number(chunk?.start ?? 0) < end && Number(chunk?.end ?? 0) > start
    if (!overlaps) return false
    if (bootstrapHead === null) return true
    return chunk?.bootstrapHead === bootstrapHead
  }).length

const main = async () => {
  const seedStats = buildSyntheticSeedStats()
  const initialReadyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const initialFirstWave = initialReadyQueue.slice(0, 2)
  const { chunks: splitChunks, firstWaveLaunchSplitCount } =
    splitFirstWaveLaunchChunksForCompletion({
      chunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: 2,
      bootstrapHeadFirstWaveQuota: 1,
      chunkHeadMicroprobesByChunkIndex,
      targetLaunchChunkMultiplier: 4,
    })

  assert(
    firstWaveLaunchSplitCount >= 2,
    "completion-target split must split oversized first-launch chunks",
  )
  assert(
    splitChunks.length > chunks.length,
    "completion-target split must increase granularity of the first-launch chunks",
  )
  for (const initialChunk of initialFirstWave) {
    assert(
      countChunksCoveringRange(
        splitChunks,
        Number(initialChunk?.start ?? 0),
        Number(initialChunk?.end ?? 0),
        initialChunk?.bootstrapHead ?? null,
      ) >= 2,
      "each provisional first-wave launch chunk must be deterministically split",
    )
  }

  const readyQueue = buildDeterministicReadyQueue({
    chunks: splitChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: Math.min(
      2,
      splitChunks.filter((chunk) => chunk.bootstrapHead === true).length,
    ),
    bootstrapHeadFirstWaveQuota: 1,
  })
  const firstWave = readyQueue.slice(0, 2)
  assert(
    firstWave.every((chunk) => chunk?.firstWaveCompletionTarget === true),
    "completion-target split must bind the final first-wave launches to completion-target descendants/originals",
  )
  assert(
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    "completion-target split must preserve the mixed head launch quota",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_first_wave_completion_target_split",
        firstWaveLaunchSplitCount,
        splitChunkCount: splitChunks.length,
        initialFirstWave: initialFirstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
        })),
        firstWave: firstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
          firstWaveCompletionTarget: chunk.firstWaveCompletionTarget === true,
          dispatchPriorityIndex: chunk.dispatchPriorityIndex,
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
