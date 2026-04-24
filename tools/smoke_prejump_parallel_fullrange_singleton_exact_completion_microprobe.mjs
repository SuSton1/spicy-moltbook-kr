import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { encodePerfectPrototypeDeltaPostings } from "../src/lib/perfect_prototype_postings_codec.mjs"
import {
  buildDeterministicReadyQueue,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  getPerfectPrototypeRowsetRuntimeStats,
  resetPerfectPrototypeRowsetRuntimeStats,
} from "../src/lib/perfect_prototype_rowset.mjs"
import {
  loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndex,
} from "../src/lib/perfect_prototype_singleton_completion_probe.mjs"

const buildPostingEntry = async ({
  handle,
  cursor,
  values,
}) => {
  const normalizedValues = Uint32Array.from(values)
  const buffer = encodePerfectPrototypeDeltaPostings(normalizedValues, { preSorted: true })
  await handle.write(buffer, 0, buffer.length, cursor)
  return {
    offset: cursor,
    byteLength: buffer.length,
    count: normalizedValues.length,
    firstRowIdx: normalizedValues.length > 0 ? Number(normalizedValues[0]) : 0,
    lastRowIdx:
      normalizedValues.length > 0 ? Number(normalizedValues[normalizedValues.length - 1]) : 0,
    nextCursor: cursor + buffer.length,
  }
}

const buildSeedStatsWithPostings = async ({ tokenPostingsBinPath }) => {
  const postingSpecs = [
    {
      token: "slow_head_rule_rich",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101, 102, 103],
      precision: 0.6,
      separationRatio: 3.5,
    },
    {
      token: "fast_head_completion",
      positiveValues: [200, 201, 202, 203, 204, 205],
      negativeValues: [300],
      precision: 0.857143,
      separationRatio: 2.8,
    },
    {
      token: "fast_tail_immediate",
      positiveValues: [400, 401, 402, 403, 404, 405],
      negativeValues: [],
      precision: 1,
      separationRatio: 4.2,
    },
    {
      token: "slow_branch_a",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101, 102],
      precision: 0.666667,
      separationRatio: 3.1,
    },
    {
      token: "slow_branch_b",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101],
      precision: 0.75,
      separationRatio: 3.2,
    },
    {
      token: "slow_branch_c",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100],
      precision: 0.857143,
      separationRatio: 3.3,
    },
    {
      token: "slow_branch_d",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [],
      precision: 1,
      separationRatio: 3.4,
    },
    {
      token: "fast_head_child",
      positiveValues: [200, 201, 202, 203, 204, 205],
      negativeValues: [],
      precision: 1,
      separationRatio: 3.9,
    },
  ]
  const handle = await fsp.open(tokenPostingsBinPath, "w")
  try {
    let cursor = 0
    const seedStats = []
    for (const spec of postingSpecs) {
      const positiveMeta = await buildPostingEntry({
        handle,
        cursor,
        values: spec.positiveValues,
      })
      cursor = positiveMeta.nextCursor
      const negativeMeta = await buildPostingEntry({
        handle,
        cursor,
        values: spec.negativeValues,
      })
      cursor = negativeMeta.nextCursor
      seedStats.push({
        token: spec.token,
        positiveMatchCount: spec.positiveValues.length,
        negativeMatchCount: spec.negativeValues.length,
        positiveCount: positiveMeta.count,
        negativeCount: negativeMeta.count,
        positiveOffset: positiveMeta.offset,
        negativeOffset: negativeMeta.offset,
        positiveByteLength: positiveMeta.byteLength,
        negativeByteLength: negativeMeta.byteLength,
        positiveFirstRowIdx: positiveMeta.firstRowIdx,
        positiveLastRowIdx: positiveMeta.lastRowIdx,
        negativeFirstRowIdx: negativeMeta.count > 0 ? negativeMeta.firstRowIdx : 0,
        negativeLastRowIdx: negativeMeta.count > 0 ? negativeMeta.lastRowIdx : 0,
        precision: spec.precision,
        separationRatio: spec.separationRatio,
      })
    }
    return seedStats
  } finally {
    await handle.close()
  }
}

const main = async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "singleton-exact-completion-"))
  try {
    const tokenPostingsBinPath = path.join(tempRoot, "token_postings.bin")
    const seedStats = await buildSeedStatsWithPostings({ tokenPostingsBinPath })
    const rowUniverseSize = 512
    const chunks = [
      {
        chunkIndex: 0,
        start: 0,
        end: 1,
        estimatedCost: 120,
        bootstrapHead: true,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
      {
        chunkIndex: 1,
        start: 1,
        end: 2,
        estimatedCost: 140,
        bootstrapHead: true,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
      {
        chunkIndex: 2,
        start: 2,
        end: 3,
        estimatedCost: 150,
        bootstrapHead: false,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
    ]
    const chunkHeadMicroprobesByChunkIndex = new Map([
      [
        0,
        {
          sampledRootCount: 1,
          meanPositiveDensity: 0.4,
          meanPositiveGap: 1,
          sampleExactByteLength: 96,
          branchCandidateCount: 0,
          branchOverlapMass: 0,
        },
      ],
      [
        1,
        {
          sampledRootCount: 1,
          meanPositiveDensity: 0.01,
          meanPositiveGap: 120,
          sampleExactByteLength: 1024,
          branchCandidateCount: 4,
          branchOverlapMass: 32,
        },
      ],
      [
        2,
        {
          sampledRootCount: 1,
          meanPositiveDensity: 0.02,
          meanPositiveGap: 80,
          sampleExactByteLength: 512,
          branchCandidateCount: 2,
          branchOverlapMass: 16,
        },
      ],
    ])

    resetPerfectPrototypeRowsetRuntimeStats()
    const {
      probesByChunkIndex,
      probeCandidateCount,
      probeCount,
      probeReachedTerminalCount,
      probeStateCap,
      probeScoreMin,
      probeScoreMax,
    } = await loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndex({
      chunks,
      seedStats,
      tokenPostingsBinPath,
      rowUniverseSize,
      minHitCount: 6,
      maxRuleSize: 4,
      probeStateCap: 24,
    })

    assert.equal(
      probeCandidateCount,
      3,
      "full bound singleton first-wave candidate pool must be probed on this fixture",
    )
    assert.equal(
      probeCount,
      3,
      "all bound singleton first-wave candidates must receive an exact completion probe",
    )
    assert(probeReachedTerminalCount >= 1, "at least one bound singleton should reach terminal during the exact completion probe on this fixture")
    assert.equal(probeStateCap, 24)
    assert(Number.isFinite(probeScoreMin))
    assert(Number.isFinite(probeScoreMax))
    const rowsetRuntimeStats = getPerfectPrototypeRowsetRuntimeStats()
    assert(
      Number(rowsetRuntimeStats?.sparseSparseIntersectionMs ?? 0) > 0 ||
        Number(rowsetRuntimeStats?.sparseCountFastPathCount ?? 0) > 0 ||
        Number(rowsetRuntimeStats?.sparseAdaptiveGallopCount ?? 0) > 0,
      "singleton exact completion probe must exercise the native rowset intersection path",
    )

    const incompleteProbes = new Map(probesByChunkIndex)
    incompleteProbes.delete(2)
    assert.throws(
      () =>
        buildDeterministicReadyQueue({
          chunks,
          seedStats,
          workerCount: 2,
          bootstrapHeadLaunchQuota: 2,
          bootstrapHeadFirstWaveQuota: 1,
          chunkHeadMicroprobesByChunkIndex,
          singletonRootExactCompletionProbesByChunkIndex: incompleteProbes,
          requireBoundSingletonExactCompletionProbe: true,
        }),
      /requires exact completion probe/,
      "live queue must fail fast if any bound singleton completion target is missing its exact completion probe",
    )

    const readyQueue = buildDeterministicReadyQueue({
      chunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: 2,
      bootstrapHeadFirstWaveQuota: 1,
      chunkHeadMicroprobesByChunkIndex,
      singletonRootExactCompletionProbesByChunkIndex: probesByChunkIndex,
      requireBoundSingletonExactCompletionProbe: true,
    })

    const slowHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 0)
    const fastHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 1)
    const fastTail = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 2)
    assert(slowHead, "slow head singleton must remain in the queue")
    assert(fastHead, "fast head singleton must remain in the queue")
    assert(fastTail, "fast tail singleton must remain in the queue")
    assert(
      Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
        Number(slowHead?.dispatchPriorityIndex ?? -1),
      "exact completion probe must promote a faster singleton head ahead of the slower rule-rich singleton head",
    )
    assert(
      Number(fastTail?.dispatchPriorityIndex ?? Infinity) <
        Number(slowHead?.dispatchPriorityIndex ?? -1),
      "exact completion probe must demote the slower rule-rich singleton head behind a faster singleton tail",
    )
    assert(
      Number(fastHead?.singletonRootExactCompletionScore ?? 0) >
        Number(slowHead?.singletonRootExactCompletionScore ?? Number.POSITIVE_INFINITY),
      "fast singleton head must carry a better exact completion score than the slower rule-rich singleton head",
    )

    console.log(
      JSON.stringify(
        {
          smoke: "smoke_prejump_parallel_fullrange_singleton_exact_completion_microprobe",
          probeCandidateCount,
          probeCount,
          probeReachedTerminalCount,
          probeStateCap,
          rowsetRuntimeStats: {
            sparseSparseIntersectionMs: Number(rowsetRuntimeStats?.sparseSparseIntersectionMs ?? 0),
            sparseCountFastPathCount: Number(rowsetRuntimeStats?.sparseCountFastPathCount ?? 0),
            sparseAdaptiveGallopCount: Number(rowsetRuntimeStats?.sparseAdaptiveGallopCount ?? 0),
          },
          queue: readyQueue.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            dispatchPriorityIndex: chunk.dispatchPriorityIndex,
            bootstrapHead: chunk.bootstrapHead === true,
            singletonRootCompletionScore: chunk.singletonRootCompletionScore ?? null,
            singletonRootExactCompletionScore: chunk.singletonRootExactCompletionScore ?? null,
          })),
        },
        null,
        2,
      ),
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
