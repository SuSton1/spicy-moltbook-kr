import assert from "node:assert/strict"

import {
  buildDeterministicReadyQueue,
  splitPathologicalFirstWaveFrontierChunks,
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
  const { chunks: splitChunks, firstWaveFrontierSplitCount } =
    splitPathologicalFirstWaveFrontierChunks({
      chunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: 2,
      bootstrapHeadFirstWaveQuota: 1,
      chunkHeadMicroprobesByChunkIndex,
    })

  assert(
    firstWaveFrontierSplitCount >= 2,
    "first-wave frontier micro-split must split oversized frontier chunks",
  )
  assert(
    splitChunks.length > chunks.length,
    "frontier micro-split must increase chunk granularity for oversized first-wave chunks",
  )
  assert(
    countChunksCoveringRange(splitChunks, 0, 4, true) >= 2,
    "heavy bootstrap-head frontier chunk must be deterministically micro-split",
  )
  assert(
    countChunksCoveringRange(splitChunks, 8, 20, false) >= 2,
    "heavy tail frontier chunk must be deterministically micro-split",
  )

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
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    "first-wave frontier micro-splitting must preserve the mixed head launch quota",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_first_wave_chunk_micro_split",
        firstWaveFrontierSplitCount,
        splitChunkCount: splitChunks.length,
        firstWave: firstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
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
