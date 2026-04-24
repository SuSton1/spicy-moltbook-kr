import assert from "node:assert/strict"

import {
  buildDeterministicReadyQueue,
  splitFirstWaveLaunchChunksForCompletion,
  splitFirstWaveLaunchChunksIntoRootSeedMicroshards,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const seedStats = Array.from({ length: 18 }, (_, index) => {
  const isHead = index < 9
  const isHeavy = index === 1 || index === 2 || index === 10 || index === 11
  return {
    token: `seed_${index.toString().padStart(4, "0")}`,
    positiveMatchCount: isHeavy ? 1100 : isHead ? 620 : 710,
    negativeMatchCount: isHeavy && !isHead ? 2 : 0,
    positiveCount: isHeavy ? 1100 : isHead ? 620 : 710,
    negativeCount: isHeavy && !isHead ? 2 : 0,
    positiveByteLength: isHeavy ? 5_800_000 : isHead ? 310_000 : 260_000,
    negativeByteLength: isHeavy && !isHead ? 11_000 : 0,
    positiveFirstRowIdx: index * 1024,
    positiveLastRowIdx: index * 1024 + (isHeavy ? 1_600_000 : isHead ? 120_000 : 90_000),
    negativeFirstRowIdx: isHeavy && !isHead ? index * 1024 + 8 : 0,
    negativeLastRowIdx: isHeavy && !isHead ? index * 1024 + 1_599_992 : 0,
    precision: isHeavy && !isHead ? 0.998 : 1,
    separationRatio: isHeavy ? 3.2 : 5.1,
  }
})

const chunkHeadMicroprobesByChunkIndex = new Map([
  [0, { sampledRootCount: 3, meanPositiveDensity: 0.004, meanPositiveGap: 900, sampleExactByteLength: 5_900_000, branchCandidateCount: 7, branchOverlapMass: 360 }],
  [1, { sampledRootCount: 3, meanPositiveDensity: 0.45, meanPositiveGap: 4, sampleExactByteLength: 180_000, branchCandidateCount: 0, branchOverlapMass: 0 }],
  [2, { sampledRootCount: 3, meanPositiveDensity: 0.003, meanPositiveGap: 1100, sampleExactByteLength: 5_700_000, branchCandidateCount: 9, branchOverlapMass: 440 }],
  [3, { sampledRootCount: 3, meanPositiveDensity: 0.41, meanPositiveGap: 5, sampleExactByteLength: 170_000, branchCandidateCount: 0, branchOverlapMass: 0 }],
])

const initialChunks = [
  { chunkIndex: 0, start: 0, end: 4, estimatedCost: 910, bootstrapHead: true },
  { chunkIndex: 1, start: 4, end: 9, estimatedCost: 180, bootstrapHead: true },
  { chunkIndex: 2, start: 9, end: 14, estimatedCost: 990, bootstrapHead: false },
  { chunkIndex: 3, start: 14, end: 18, estimatedCost: 220, bootstrapHead: false },
]

const main = async () => {
  const { chunks: completionSplitChunks } = splitFirstWaveLaunchChunksForCompletion({
    chunks: initialChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
    targetLaunchChunkMultiplier: 2,
  })

  const headCandidate = completionSplitChunks
    .filter((chunk) => {
      const width = Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0)
      return chunk?.firstWaveCompletionTarget === true && chunk?.bootstrapHead === true && width > 1 && width <= 4
    })
    .sort((left, right) => Number(right?.estimatedCost ?? 0) - Number(left?.estimatedCost ?? 0))[0]
  const tailCandidate = completionSplitChunks
    .filter((chunk) => {
      const width = Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0)
      return chunk?.firstWaveCompletionTarget === true && chunk?.bootstrapHead !== true && width > 1 && width <= 4
    })
    .sort((left, right) => Number(right?.estimatedCost ?? 0) - Number(left?.estimatedCost ?? 0))[0]

  assert(headCandidate, "fixture must retain a multi-root head completion-target chunk")
  assert(tailCandidate, "fixture must retain a multi-root tail completion-target chunk")

  const forcedFirstWaveSeedChunks = completionSplitChunks.map((chunk) => {
    const chunkIndex = Number(chunk?.chunkIndex ?? -1)
    if (chunkIndex === Number(headCandidate?.chunkIndex ?? -1)) {
      return { ...chunk, firstWaveDispatchScoreOverride: 1_000_000 }
    }
    if (chunkIndex === Number(tailCandidate?.chunkIndex ?? -1)) {
      return { ...chunk, firstWaveDispatchScoreOverride: 999_999 }
    }
    return chunk
  })

  const {
    chunks: microshardChunks,
    firstWaveRootSeedMicroshardCount,
    firstWaveForcedSingletonMicroshardCount,
  } = splitFirstWaveLaunchChunksIntoRootSeedMicroshards({
    chunks: forcedFirstWaveSeedChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: 2,
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
    targetRootSeedMicroshardMultiplier: 6,
    maxMicroshardCountPerLaunchChunk: 8,
    forceSingletonFirstWaveLaunchChunkWidth: 4,
  })

  assert(firstWaveRootSeedMicroshardCount >= 2, "forced singleton patch must add microshard launch granularity")
  assert(
    firstWaveForcedSingletonMicroshardCount >= 4,
    "first-wave completion-target launch chunks must be forced to singleton-root shards on this fixture",
  )

  const descendants = microshardChunks.filter((chunk) =>
    Number(chunk?.splitSourceChunkIndex ?? -1) === Number(headCandidate?.chunkIndex ?? -1) ||
    Number(chunk?.splitSourceChunkIndex ?? -1) === Number(tailCandidate?.chunkIndex ?? -1),
  )
  assert(descendants.length >= 4, "forced first-wave fixture must produce singleton descendants from both selected launch chunks")
  assert(
    descendants.every((chunk) => Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0) === 1),
    "all descendants of forced first-wave launch chunks must be singleton-root shards",
  )
  assert(
    descendants.every((chunk) => chunk?.firstWaveDispatchScoreOverride == null),
    "forced singleton descendants must not inherit parent first-wave score overrides",
  )
  assert(
    descendants.every((chunk) => chunk?.dispatchScoreOverride == null),
    "forced singleton descendants must not inherit parent dispatch score overrides",
  )
  assert(
    descendants.every((chunk) => chunk?.headMicroprobeOverride == null),
    "forced singleton descendants must be eligible for child-local microprobe rescoring",
  )

  const readyQueue = buildDeterministicReadyQueue({
    chunks: microshardChunks,
    seedStats,
    workerCount: 2,
    bootstrapHeadLaunchQuota: Math.min(2, microshardChunks.filter((chunk) => chunk.bootstrapHead === true).length),
    bootstrapHeadFirstWaveQuota: 1,
    chunkHeadMicroprobesByChunkIndex,
  })
  const firstWave = readyQueue.slice(0, 2)
  assert(
    firstWave.every((chunk) => chunk?.firstWaveCompletionTarget === true),
    "forced singleton microsharding must keep final first-wave launches bound to completion-target descendants/originals",
  )
  assert(
    firstWave.filter((chunk) => chunk.bootstrapHead === true).length >= 1,
    "forced singleton microsharding must keep at least one bootstrap-head launch in the first wave",
  )
  assert(
    firstWave.some((chunk) => Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0) === 1),
    "forced singleton microsharding must surface at least one singleton-root launch chunk in the first wave on this fixture",
  )
  assert(
    descendants.some((chunk) => Number(chunk?.splitSourceChunkIndex ?? -1) === Number(headCandidate?.chunkIndex ?? -1)),
    "forced singleton microsharding must still emit descendants for the selected head candidate",
  )
  assert(
    descendants.some((chunk) => Number(chunk?.splitSourceChunkIndex ?? -1) === Number(tailCandidate?.chunkIndex ?? -1)),
    "forced singleton microsharding must still emit descendants for the selected tail candidate",
  )

  console.log(JSON.stringify({
    smoke: "smoke_prejump_parallel_fullrange_forced_singleton_microshard",
    firstWaveRootSeedMicroshardCount,
    firstWaveForcedSingletonMicroshardCount,
    firstWave: firstWave.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      splitSourceChunkIndex: chunk.splitSourceChunkIndex ?? null,
        start: chunk.start,
        end: chunk.end,
        bootstrapHead: chunk.bootstrapHead,
        firstWaveCompletionTarget: chunk.firstWaveCompletionTarget === true,
        singletonRootCompletionScore: chunk.singletonRootCompletionScore ?? null,
      })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
