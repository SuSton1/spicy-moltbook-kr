import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { encodePerfectPrototypeDeltaPostings } from "../src/lib/perfect_prototype_postings_codec.mjs"
import { buildDeterministicReadyQueue } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  loadPerfectPrototypeSingletonRootAdaptiveExactCompletionProbesByChunkIndex,
} from "../src/lib/perfect_prototype_singleton_completion_probe.mjs"

const buildPostingEntry = async ({ handle, cursor, values }) => {
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
      negativeValues: [100, 101, 102, 103, 104],
      precision: 0.55,
      separationRatio: 3.2,
    },
    {
      token: "slow_immediate_rule",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [],
      precision: 1,
      separationRatio: 4.5,
    },
    {
      token: "slow_branch_keep4",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101, 102, 103],
      precision: 0.6,
      separationRatio: 3.1,
    },
    {
      token: "slow_branch_keep3",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101, 102],
      precision: 0.666667,
      separationRatio: 3,
    },
    {
      token: "slow_branch_keep2",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100, 101],
      precision: 0.75,
      separationRatio: 2.9,
    },
    {
      token: "slow_branch_keep1",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [100],
      precision: 0.857143,
      separationRatio: 2.8,
    },
    {
      token: "slow_branch_terminal",
      positiveValues: [1, 2, 3, 4, 5, 6],
      negativeValues: [],
      precision: 1,
      separationRatio: 2.7,
    },
    {
      token: "fast_head_chain",
      positiveValues: [200, 201, 202, 203, 204, 205],
      negativeValues: [300, 301],
      precision: 0.75,
      separationRatio: 2.4,
    },
    {
      token: "fast_branch_keep1",
      positiveValues: [200, 201, 202, 203, 204, 205],
      negativeValues: [300],
      precision: 0.857143,
      separationRatio: 3.6,
    },
    {
      token: "fast_branch_terminal",
      positiveValues: [200, 201, 202, 203, 204, 205],
      negativeValues: [],
      precision: 1,
      separationRatio: 4.1,
    },
    {
      token: "tail_immediate",
      positiveValues: [400, 401, 402, 403, 404, 405],
      negativeValues: [],
      precision: 1,
      separationRatio: 3.8,
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
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "singleton-adaptive-exact-"))
  try {
    const tokenPostingsBinPath = path.join(tempRoot, "token_postings.bin")
    const seedStats = await buildSeedStatsWithPostings({ tokenPostingsBinPath })
    const rowUniverseSize = 512
    let maxStage1ConcurrencyObserved = 0
    let maxStage1InFlightObserved = 0
    const chunks = [
      {
        chunkIndex: 0,
        start: 0,
        end: 1,
        estimatedCost: 220,
        bootstrapHead: true,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
      {
        chunkIndex: 1,
        start: 7,
        end: 8,
        estimatedCost: 180,
        bootstrapHead: true,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
      {
        chunkIndex: 2,
        start: 10,
        end: 11,
        estimatedCost: 140,
        bootstrapHead: false,
        firstWaveCompletionTarget: true,
        rootSeedMicroshard: true,
      },
    ]

    const {
      stage1ProbesByChunkIndex,
      adaptiveProbesByChunkIndex,
      adaptiveFinalistChunkIndexes,
      probeCandidateCount,
      probeCount,
      probeReachedTerminalCount,
      adaptiveProbeFinalistCount,
      adaptiveProbeCount,
      adaptiveProbeReachedTerminalCount,
      adaptiveProbeFoundFirstRuleCount,
    } = await loadPerfectPrototypeSingletonRootAdaptiveExactCompletionProbesByChunkIndex({
      chunks,
      seedStats,
      tokenPostingsBinPath,
      rowUniverseSize,
      minHitCount: 6,
      maxRuleSize: 6,
      workerCount: 2,
      probeStateCap: 2,
      adaptiveProbeBaseStateCap: 8,
      adaptiveProbeMaxStateCap: 16,
      adaptiveProbeMinimumFinalistCount: 3,
      adaptiveProbeMaximumFinalistCount: 3,
      onStage1Progress: async (payload) => {
        maxStage1ConcurrencyObserved = Math.max(
          maxStage1ConcurrencyObserved,
          Math.max(1, Number(payload?.stage1Concurrency ?? 1)),
        )
        maxStage1InFlightObserved = Math.max(
          maxStage1InFlightObserved,
          Math.max(0, Number(payload?.inFlightChunkCount ?? 0)),
        )
      },
    })

    assert.equal(probeCandidateCount, 3)
    assert.equal(probeCount, 3)
    assert.equal(adaptiveProbeFinalistCount, 3)
    assert.equal(adaptiveProbeCount, 3)
    assert(probeReachedTerminalCount < adaptiveProbeReachedTerminalCount)
    assert(adaptiveProbeFoundFirstRuleCount >= 1)
    assert(
      maxStage1ConcurrencyObserved > 1,
      "adaptive singleton exact completion probe must expose bounded-concurrent stage1 planning",
    )
    assert(
      maxStage1InFlightObserved > 1,
      "adaptive singleton exact completion probe must observe more than one in-flight stage1 chunk on this fixture",
    )

    const misleadingStage1Probes = new Map(stage1ProbesByChunkIndex)
    misleadingStage1Probes.set(0, {
      ...misleadingStage1Probes.get(0),
      probeScore: 0.999999,
    })
    misleadingStage1Probes.set(1, {
      ...misleadingStage1Probes.get(1),
      probeScore: 0.000001,
    })

    const incompleteAdaptiveProbes = new Map(adaptiveProbesByChunkIndex)
    incompleteAdaptiveProbes.delete(1)
    assert.throws(
      () =>
        buildDeterministicReadyQueue({
          chunks,
          seedStats,
          workerCount: 2,
          bootstrapHeadLaunchQuota: 2,
          bootstrapHeadFirstWaveQuota: 1,
          singletonRootExactCompletionProbesByChunkIndex: misleadingStage1Probes,
          singletonRootAdaptiveExactCompletionProbesByChunkIndex: incompleteAdaptiveProbes,
          singletonRootAdaptiveExactCompletionFinalistChunkIndexes: adaptiveFinalistChunkIndexes,
          requireBoundSingletonExactCompletionProbe: true,
          requireBoundSingletonAdaptiveExactCompletionProbe: true,
        }),
      /requires adaptive exact completion probe/,
      "live queue must fail fast if any adaptive finalist singleton is missing its stage-2 probe",
    )

    const readyQueue = buildDeterministicReadyQueue({
      chunks,
      seedStats,
      workerCount: 2,
      bootstrapHeadLaunchQuota: 2,
      bootstrapHeadFirstWaveQuota: 1,
      singletonRootExactCompletionProbesByChunkIndex: misleadingStage1Probes,
      singletonRootAdaptiveExactCompletionProbesByChunkIndex: adaptiveProbesByChunkIndex,
      singletonRootAdaptiveExactCompletionFinalistChunkIndexes: adaptiveFinalistChunkIndexes,
      requireBoundSingletonExactCompletionProbe: true,
      requireBoundSingletonAdaptiveExactCompletionProbe: true,
    })

    const slowHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 0)
    const fastHead = readyQueue.find((chunk) => Number(chunk?.chunkIndex ?? -1) === 1)
    assert(slowHead, "slow head must remain in queue")
    assert(fastHead, "fast head must remain in queue")
    assert(
      Number(slowHead?.singletonRootExactCompletionScore ?? 0) >
        Number(fastHead?.singletonRootExactCompletionScore ?? Number.POSITIVE_INFINITY),
      "misleading stage-1 score should overrate the slow rule-rich singleton on this fixture",
    )
    assert(
      Number(fastHead?.singletonRootAdaptiveExactCompletionScore ?? 0) >
        Number(slowHead?.singletonRootAdaptiveExactCompletionScore ?? Number.POSITIVE_INFINITY),
      "stage-2 adaptive probe must promote the faster singleton head above the slower rule-rich singleton",
    )
    assert(
      Number(fastHead?.dispatchPriorityIndex ?? Infinity) <
        Number(slowHead?.dispatchPriorityIndex ?? -1),
      "adaptive exact completion probe must rerank the fast singleton head ahead of the slower rule-rich singleton",
    )

    console.log(
      JSON.stringify(
        {
          smoke: "smoke_prejump_parallel_fullrange_singleton_adaptive_exact_completion_probe",
          probeCandidateCount,
          probeCount,
          probeReachedTerminalCount,
          adaptiveProbeFinalistCount,
          adaptiveProbeCount,
          adaptiveProbeReachedTerminalCount,
          adaptiveProbeFoundFirstRuleCount,
          maxStage1ConcurrencyObserved,
          maxStage1InFlightObserved,
          queue: readyQueue.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            dispatchPriorityIndex: chunk.dispatchPriorityIndex,
            singletonRootExactCompletionScore:
              chunk.singletonRootExactCompletionScore ?? null,
            singletonRootAdaptiveExactCompletionScore:
              chunk.singletonRootAdaptiveExactCompletionScore ?? null,
            singletonRootAdaptiveExactCompletionProbeFinalist:
              chunk.singletonRootAdaptiveExactCompletionProbeFinalist === true,
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
