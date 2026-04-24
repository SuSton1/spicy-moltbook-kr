import assert from "node:assert/strict"

import {
  buildDeterministicReadyQueue,
  splitFirstWaveLaunchChunksForCompletion,
  splitFirstWaveLaunchChunksIntoRootSeedMicroshards,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const buildSyntheticSeedStats = () => {
  const entries = []
  for (let index = 0; index < 24; index += 1) {
    const headHeavy = index === 1 || index === 6
    const tailHeavy = index === 10 || index === 13
    const headRoot = index < 8
    const positiveByteLength = headHeavy
      ? 7_200_000
      : tailHeavy
        ? 5_400_000
        : headRoot
          ? 420_000
          : 320_000
    const rowSpan = headHeavy
      ? 2_600_000
      : tailHeavy
        ? 1_900_000
        : headRoot
          ? 180_000
          : 90_000
    const positiveMatchCount = headHeavy ? 1400 : tailHeavy ? 1180 : headRoot ? 720 : 860
    const negativeMatchCount = tailHeavy ? 3 : 0
    entries.push({
      token: `seed_${index.toString().padStart(4, "0")}`,
      positiveMatchCount,
      negativeMatchCount,
      positiveCount: positiveMatchCount,
      negativeCount: negativeMatchCount,
      positiveByteLength,
      negativeByteLength: tailHeavy ? 12_000 : 0,
      positiveFirstRowIdx: index * 512,
      positiveLastRowIdx: index * 512 + rowSpan,
      negativeFirstRowIdx: tailHeavy ? index * 512 + 16 : 0,
      negativeLastRowIdx: tailHeavy ? index * 512 + rowSpan - 16 : 0,
      precision: tailHeavy ? 0.997 : 1,
      separationRatio: tailHeavy ? 3.4 : 5.2,
    })
  }
  return entries
}

const chunkHeadMicroprobesByChunkIndex = new Map([
  [
    0,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.002,
      meanPositiveGap: 1800,
      sampleExactByteLength: 7_800_000,
      branchCandidateCount: 8,
      branchOverlapMass: 420,
    },
  ],
  [
    1,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.38,
      meanPositiveGap: 5,
      sampleExactByteLength: 220_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
  [
    2,
    {
      sampledRootCount: 3,
      meanPositiveDensity: 0.0015,
      meanPositiveGap: 2100,
      sampleExactByteLength: 6_400_000,
      branchCandidateCount: 10,
      branchOverlapMass: 600,
    },
  ],
  [
    3,
    {
      sampledRootCount: 2,
      meanPositiveDensity: 0.44,
      meanPositiveGap: 4,
      sampleExactByteLength: 180_000,
      branchCandidateCount: 0,
      branchOverlapMass: 0,
    },
  ],
])

const initialChunks = [
  { chunkIndex: 0, start: 0, end: 4, estimatedCost: 820, bootstrapHead: true },
  { chunkIndex: 1, start: 4, end: 8, estimatedCost: 180, bootstrapHead: true },
  { chunkIndex: 2, start: 8, end: 16, estimatedCost: 960, bootstrapHead: false },
  { chunkIndex: 3, start: 16, end: 24, estimatedCost: 220, bootstrapHead: false },
]

const countDescendantsForSource = (chunks, splitSourceChunkIndex) =>
  chunks.filter((chunk) => Number(chunk?.splitSourceChunkIndex ?? -1) === splitSourceChunkIndex)

const main = async () => {
  const seedStats = buildSyntheticSeedStats()
  const initialReadyQueue = buildDeterministicReadyQueue({
    chunks: initialChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const initialFirstWave = initialReadyQueue.slice(0, 2)
  assert.equal(
    initialFirstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    true,
    "initial first wave must remain mixed before microsharding",
  )

  const { chunks: completionSplitChunks, firstWaveLaunchSplitCount } =
    splitFirstWaveLaunchChunksForCompletion({
      chunks: initialChunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: 2,
      bootstrapHeadFirstWaveQuota: 1,
      chunkHeadMicroprobesByChunkIndex,
      targetLaunchChunkMultiplier: 2,
    })

  assert(
    firstWaveLaunchSplitCount >= 2,
    "completion-target split must produce finer-grained first-wave launch chunks before microsharding",
  )

  const completionSplitReadyQueue = buildDeterministicReadyQueue({
    chunks: completionSplitChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: Math.min(
      2,
      completionSplitChunks.filter((chunk) => chunk.bootstrapHead === true).length,
    ),
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const completionSplitFirstWave = completionSplitReadyQueue.slice(0, 2)
  assert.equal(
    completionSplitFirstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    true,
    "completion-target split must preserve mixed head/tail first-wave launches",
  )

  const completionSplitHeadCandidates = completionSplitChunks
    .filter(
      (chunk) =>
        chunk?.bootstrapHead === true &&
        Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0) > 1,
    )
    .sort((left, right) => Number(right?.estimatedCost ?? 0) - Number(left?.estimatedCost ?? 0))
  const completionSplitTailCandidates = completionSplitChunks
    .filter(
      (chunk) =>
        chunk?.bootstrapHead !== true &&
        Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0) > 1,
    )
    .sort((left, right) => Number(right?.estimatedCost ?? 0) - Number(left?.estimatedCost ?? 0))
  assert(
    completionSplitHeadCandidates.length >= 1 && completionSplitTailCandidates.length >= 1,
    "completion-target split fixture must retain at least one multi-root head candidate and one multi-root tail candidate",
  )
  const forcedFirstWaveChunkIndexes = new Set([
    Number(completionSplitHeadCandidates[0]?.chunkIndex ?? -1),
    Number(completionSplitTailCandidates[0]?.chunkIndex ?? -1),
  ])
  const microshardSeedChunks = completionSplitChunks.map((chunk) => {
    const chunkIndex = Number(chunk?.chunkIndex ?? -1)
    if (!forcedFirstWaveChunkIndexes.has(chunkIndex)) return chunk
    const rankBoost =
      chunk?.bootstrapHead === true
        ? 1_000_000
        : 999_999
    return {
      ...chunk,
      firstWaveDispatchScoreOverride: rankBoost,
    }
  })

  const forcedFirstWaveReadyQueue = buildDeterministicReadyQueue({
    chunks: microshardSeedChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: Math.min(
      2,
      microshardSeedChunks.filter((chunk) => chunk.bootstrapHead === true).length,
    ),
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const forcedFirstWave = forcedFirstWaveReadyQueue.slice(0, 2)
  assert.equal(
    forcedFirstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    true,
    "forced microshard fixture must still preserve mixed head/tail first-wave launches",
  )

  const {
    chunks: microshardChunks,
    firstWaveRootSeedMicroshardCount,
    firstWaveForcedSingletonMicroshardCount,
  } =
    splitFirstWaveLaunchChunksIntoRootSeedMicroshards({
      chunks: microshardSeedChunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: Math.min(
        2,
        microshardSeedChunks.filter((chunk) => chunk.bootstrapHead === true).length,
      ),
      bootstrapHeadFirstWaveQuota: 1,
      chunkHeadMicroprobesByChunkIndex,
      targetRootSeedMicroshardMultiplier: 6,
      heavySeedCostRatio: 1.35,
      maxHeavySingletonCountPerChunk: 2,
      maxMicroshardCountPerLaunchChunk: 8,
    })

  assert(
    firstWaveRootSeedMicroshardCount >= 1,
    "root-seed microsharding must split heavy first-wave launch chunks into additional shards",
  )
  assert(
    firstWaveForcedSingletonMicroshardCount >= 1,
    "first-wave completion-target microsharding must force at least one launch chunk down to singleton-root shards",
  )
  assert(
    microshardChunks.length > completionSplitChunks.length,
    "root-seed microsharding must increase first-wave launch granularity",
  )

  const microshardDescendants = forcedFirstWave.map((chunk) => ({
    sourceChunkIndex: chunk.chunkIndex,
    descendants: countDescendantsForSource(microshardChunks, chunk.chunkIndex),
  }))
  assert(
    microshardDescendants.some((row) => row.descendants.length >= 2),
    "at least one completion-target first-wave launch chunk must be deterministically microsharded",
  )
  assert(
    microshardDescendants.some((row) =>
      row.descendants.some(
        (chunk) =>
          chunk?.rootSeedMicroshard === true &&
          Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0) <= 1,
      ),
    ),
    "heavy root seeds must be isolated into root-level microshards for the first wave",
  )
  assert(
    microshardDescendants.some((row) =>
      row.descendants.some((chunk) => chunk?.rootSeedMicroshardForcedSingleton === true),
    ),
    "first-wave completion-target microsharding must mark at least one descendant as a forced singleton-root launch shard",
  )

  const microshardReadyQueue = buildDeterministicReadyQueue({
    chunks: microshardChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: Math.min(
      2,
      microshardChunks.filter((chunk) => chunk.bootstrapHead === true).length,
    ),
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const microshardFirstWave = microshardReadyQueue.slice(0, 2)
  assert.equal(
    microshardFirstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    true,
    "root-seed microsharding must preserve the mixed bootstrap-head first-wave quota",
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_parallel_fullrange_root_seed_microshard",
        firstWaveLaunchSplitCount,
        firstWaveRootSeedMicroshardCount,
        firstWaveForcedSingletonMicroshardCount,
        initialFirstWave: initialFirstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
        })),
        completionSplitFirstWave: completionSplitFirstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
          splitSourceChunkIndex: chunk.splitSourceChunkIndex ?? null,
        })),
        forcedFirstWave: forcedFirstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
          splitSourceChunkIndex: chunk.splitSourceChunkIndex ?? null,
          firstWaveDispatchScore: chunk.firstWaveDispatchScore,
        })),
        microshardFirstWave: microshardFirstWave.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          bootstrapHead: chunk.bootstrapHead,
          splitSourceChunkIndex: chunk.splitSourceChunkIndex ?? null,
          rootSeedMicroshardSingleton: chunk.rootSeedMicroshardSingleton === true,
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
