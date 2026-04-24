import path from "node:path"
import crypto from "node:crypto"
import { spawn } from "node:child_process"
import fsp from "node:fs/promises"

import {
  ensureDir,
  iterateJsonl,
  pathExists,
  readJson,
  readJsonIfExistsStrict,
  writeJsonAtomic,
} from "./io.mjs"
import { buildNegativeSeparationReport, normalizeMinerOptions } from "./perfect_prototype_miner.mjs"
import {
  finalizePerfectPrototypeIndexedRuleSet,
  LIVE_SEARCH_PROGRESS_CHECKPOINT_MS,
  LIVE_SEARCH_PROGRESS_STATE_INTERVAL,
  loadPerfectPrototypeIndexedRowMeta,
} from "./perfect_prototype_indexed_miner.mjs"
import { resolvePerfectPrototypeDuckdbCli } from "./perfect_prototype_duckdb.mjs"
import { validatePerfectPrototypeIndexProvenance } from "./perfect_prototype_index_provenance.mjs"
import { assertPerfectPrototypeTokenizerSpecIntegrity } from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import { streamSelectPerfectPrototypeSeedEntries } from "./perfect_prototype_seed_selector.mjs"
import { loadPerfectPrototypeTokenDictionaryEntriesByTokens } from "./perfect_prototype_token_index.mjs"
import {
  decodePerfectPrototypeDeltaPostingsToBitset,
  openPerfectPrototypePostingsFile,
  readPerfectPrototypePostingBufferFromFile,
  readPerfectPrototypeDeltaPostingsFromFile,
} from "./perfect_prototype_postings_codec.mjs"
import {
  loadPerfectPrototypeSingletonRootAdaptiveExactCompletionProbesByChunkIndex,
} from "./perfect_prototype_singleton_completion_probe.mjs"
import {
  PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME,
  PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME,
  readPerfectPrototypeLivePartialRulesSnapshotIfExists,
  streamPerfectPrototypePartialRulesParquet,
} from "./perfect_prototype_partial_rule_codec.mjs"
import {
  buildPerfectPrototypeWorkerSlotPaths,
  PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS,
  PERFECT_PROTOTYPE_WORKER_SLOT_READY_TIMEOUT_MS,
} from "./perfect_prototype_parallel_worker_slot.mjs"
import {
  createPerfectPrototypeRowsetModeStatsShape,
  normalizePerfectPrototypeRowsetModeStats,
  PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS,
  PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS,
} from "./perfect_prototype_rowset_mode_stats_schema.mjs"
import {
  createPerfectPrototypeBitsetRowsetFromWords,
  createPerfectPrototypeRowset,
  shouldPreferDensePerfectPrototypeRowset,
} from "./perfect_prototype_rowset.mjs"
import {
  pickCanonicalPerfectPrototypeSameSignatureWinner,
  selectTopPerfectPrototypeRulesDeterministically,
} from "./perfect_prototype_rule.mjs"
import { createPerfectPrototypeTopKHitTracker } from "./perfect_prototype_search_bounds.mjs"

const clampInteger = (value, fallback, min, max) => {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const areExactRowIndexArraysEqual = (left, right) => {
  const leftLength = Number(left?.length ?? 0)
  const rightLength = Number(right?.length ?? 0)
  if (leftLength !== rightLength) return false
  for (let index = 0; index < leftLength; index += 1) {
    if (Number(left[index]) !== Number(right[index])) return false
  }
  return true
}

const buildRuleMatchSignatureHash = (rowIndexes) => {
  const hash = crypto.createHash("sha1")
  for (const rawValue of Array.isArray(rowIndexes) || ArrayBuffer.isView(rowIndexes)
    ? Array.from(rowIndexes)
    : []) {
    const value = Number(rawValue)
    const buffer = Buffer.allocUnsafe(4)
    buffer.writeUInt32LE(Number.isInteger(value) && value >= 0 ? value : 0, 0)
    hash.update(buffer)
  }
  return hash.digest("hex")
}

const toFiniteNonNegativeMetric = (value, fallback = 0) => {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric
  }
  const fallbackNumeric = Number(fallback)
  return Number.isFinite(fallbackNumeric) && fallbackNumeric >= 0 ? fallbackNumeric : 0
}

const hasExplicitIntegerValue = (value) =>
  value !== null && value !== undefined && Number.isInteger(Number(value))

const computeChunkWidth = (chunk) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  return Math.max(0, end - start)
}

const isSingletonRootChunk = (chunk) => computeChunkWidth(chunk) === 1

const computePostingRowSpan = ({
  firstRowIdx,
  lastRowIdx,
  fallbackCount = 0,
}) => {
  const safeFirstRowIdx = Number(firstRowIdx)
  const safeLastRowIdx = Number(lastRowIdx)
  if (
    Number.isFinite(safeFirstRowIdx) &&
    Number.isFinite(safeLastRowIdx) &&
    safeFirstRowIdx >= 0 &&
    safeLastRowIdx >= safeFirstRowIdx
  ) {
    return Math.max(1, safeLastRowIdx - safeFirstRowIdx + 1)
  }
  return Math.max(0, toFiniteNonNegativeMetric(fallbackCount))
}

const computeSeedPartitionCost = (entry) => {
  const positiveMatchCount = Math.max(1, toFiniteNonNegativeMetric(entry?.positiveMatchCount))
  const negativeMatchCount = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeMatchCount))
  const positiveCount = Math.max(
    positiveMatchCount,
    toFiniteNonNegativeMetric(entry?.positiveCount, positiveMatchCount),
  )
  const negativeCount = Math.max(
    negativeMatchCount,
    toFiniteNonNegativeMetric(entry?.negativeCount, negativeMatchCount),
  )
  const positiveByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.positiveByteLength))
  const negativeByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeByteLength))
  const totalPostingCount = positiveCount + negativeCount
  const totalByteLength = positiveByteLength + negativeByteLength
  const maxRowSpan = Math.max(
    computePostingRowSpan({
      firstRowIdx: entry?.positiveFirstRowIdx,
      lastRowIdx: entry?.positiveLastRowIdx,
      fallbackCount: positiveCount,
    }),
    computePostingRowSpan({
      firstRowIdx: entry?.negativeFirstRowIdx,
      lastRowIdx: entry?.negativeLastRowIdx,
      fallbackCount: negativeCount,
    }),
  )
  const precision = Math.max(0, Math.min(1, Number(entry?.precision ?? 0) || 0))
  const separationRatio = Math.max(0, Number(entry?.separationRatio ?? 0) || 0)
  const postingLoad = Math.log2(totalPostingCount + 2)
  const positiveMatchLoad = Math.log2(positiveMatchCount + 2)
  const byteLoad = Math.log2(totalByteLength + 2)
  const rowSpanLoad = Math.log2(maxRowSpan + 2)
  const negativeBranchingPenalty =
    1 + Math.min(4, Math.log2(negativeCount + 2) / 4)
  const precisionBias = 1 + precision * 0.15
  const separationBias = 1 + Math.min(4, separationRatio) * 0.25
  return (
    (positiveMatchLoad + postingLoad + byteLoad + rowSpanLoad) *
    negativeBranchingPenalty *
    precisionBias *
    separationBias
  )
}

const incrementPlanningCounter = (planningReuseStats, key, delta = 1) => {
  if (!planningReuseStats || typeof planningReuseStats !== "object") return
  const numericDelta = Number(delta)
  if (!Number.isFinite(numericDelta) || numericDelta === 0) return
  planningReuseStats[key] = Math.max(
    0,
    Number(planningReuseStats?.[key] ?? 0) + numericDelta,
  )
}

const serializePlanningMetric = (value, digits = 6) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "null"
  return Number(numeric.toFixed(digits)).toString()
}

const buildPlanningChunkFingerprint = (chunk) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  return [
    start,
    end,
    chunk?.bootstrapHead === true ? 1 : 0,
    chunk?.firstWaveCompletionTarget === true ? 1 : 0,
    chunk?.rootSeedMicroshard === true ? 1 : 0,
    chunk?.rootSeedMicroshardSingleton === true ? 1 : 0,
    chunk?.rootSeedMicroshardForcedSingleton === true ? 1 : 0,
  ].join(":")
}

const buildPlanningMicroprobeCacheKey = ({
  chunk,
  minHitCount,
  neighborWindow = 4,
}) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  return [
    `${start}:${end}`,
    Math.max(1, Math.floor(Number(minHitCount) || 1)),
    Math.max(1, Math.floor(Number(neighborWindow) || 4)),
  ].join("|")
}

const buildDeterministicReadyQueueScoreCacheKey = ({
  chunk,
  headMicroprobe,
  singletonRootExactCompletionProbe,
  singletonRootAdaptiveExactCompletionProbe,
  singletonRootAdaptiveExactCompletionProbeFinalist,
  requireBoundSingletonExactCompletionProbe,
  requireBoundSingletonAdaptiveExactCompletionProbe,
}) =>
  [
    buildPlanningChunkFingerprint(chunk),
    `bootstrap=${serializePlanningMetric(chunk?.bootstrapScoreOverride)}`,
    `steady=${serializePlanningMetric(chunk?.steadyDispatchScoreOverride)}`,
    `bootstrapDispatch=${serializePlanningMetric(chunk?.bootstrapDispatchScoreOverride)}`,
    `dispatch=${serializePlanningMetric(chunk?.dispatchScoreOverride)}`,
    `firstWave=${serializePlanningMetric(chunk?.firstWaveDispatchScoreOverride)}`,
    `singleton=${serializePlanningMetric(chunk?.singletonRootCompletionScoreOverride)}`,
    `multi=${serializePlanningMetric(chunk?.multiRootCompletionScoreOverride)}`,
    `headRoots=${serializePlanningMetric(headMicroprobe?.sampledRootCount, 0)}`,
    `headDensity=${serializePlanningMetric(headMicroprobe?.meanPositiveDensity, 8)}`,
    `headGap=${serializePlanningMetric(headMicroprobe?.meanPositiveGap)}`,
    `headBranch=${serializePlanningMetric(headMicroprobe?.branchCandidateCount, 0)}`,
    `headOverlap=${serializePlanningMetric(headMicroprobe?.branchOverlapMass, 0)}`,
    `headBytes=${serializePlanningMetric(headMicroprobe?.sampleExactByteLength, 0)}`,
    `exact=${serializePlanningMetric(singletonRootExactCompletionProbe?.probeScore)}`,
    `adaptive=${serializePlanningMetric(singletonRootAdaptiveExactCompletionProbe?.probeScore)}`,
    `adaptiveFinalist=${singletonRootAdaptiveExactCompletionProbeFinalist === true ? 1 : 0}`,
    `requireExact=${requireBoundSingletonExactCompletionProbe === true ? 1 : 0}`,
    `requireAdaptive=${requireBoundSingletonAdaptiveExactCompletionProbe === true ? 1 : 0}`,
  ].join("|")

const compareScoredParallelChunks = (left, right) => {
  if (Number(right?.dispatchScore ?? 0) !== Number(left?.dispatchScore ?? 0)) {
    return Number(right?.dispatchScore ?? 0) - Number(left?.dispatchScore ?? 0)
  }
  if (Number(right?.bootstrapDispatchScore ?? 0) !== Number(left?.bootstrapDispatchScore ?? 0)) {
    return Number(right?.bootstrapDispatchScore ?? 0) - Number(left?.bootstrapDispatchScore ?? 0)
  }
  if (Number(right?.bootstrapScore ?? 0) !== Number(left?.bootstrapScore ?? 0)) {
    return Number(right?.bootstrapScore ?? 0) - Number(left?.bootstrapScore ?? 0)
  }
  if (Number(right?.steadyDispatchScore ?? 0) !== Number(left?.steadyDispatchScore ?? 0)) {
    return Number(right?.steadyDispatchScore ?? 0) - Number(left?.steadyDispatchScore ?? 0)
  }
  if (Number(left?.estimatedCost ?? 0) !== Number(right?.estimatedCost ?? 0)) {
    return Number(left?.estimatedCost ?? 0) - Number(right?.estimatedCost ?? 0)
  }
  if (Number(left?.start ?? 0) !== Number(right?.start ?? 0)) {
    return Number(left?.start ?? 0) - Number(right?.start ?? 0)
  }
  return Number(left?.chunkIndex ?? 0) - Number(right?.chunkIndex ?? 0)
}

const computeAveragePostingGap = (rowIndexes) => {
  const values = ArrayBuffer.isView(rowIndexes) || Array.isArray(rowIndexes) ? Array.from(rowIndexes) : []
  if (values.length < 2) return 0
  let totalGap = 0
  let gapCount = 0
  for (let index = 1; index < values.length; index += 1) {
    const previous = Number(values[index - 1])
    const current = Number(values[index])
    if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous) continue
    totalGap += current - previous
    gapCount += 1
  }
  return gapCount > 0 ? totalGap / gapCount : 0
}

const intersectSortedUint32ArraysCount = (leftValues, rightValues) => {
  const left = ArrayBuffer.isView(leftValues) || Array.isArray(leftValues) ? leftValues : []
  const right = ArrayBuffer.isView(rightValues) || Array.isArray(rightValues) ? rightValues : []
  let leftIndex = 0
  let rightIndex = 0
  let count = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = Number(left[leftIndex])
    const rightValue = Number(right[rightIndex])
    if (leftValue === rightValue) {
      count += 1
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (leftValue < rightValue) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }
  return count
}

const computeImbalanceRatio = (costs) => {
  const safeCosts = (Array.isArray(costs) ? costs : [])
    .map((value) => Number(value ?? 0))
    .filter((value) => Number.isFinite(value) && value >= 0)
  if (safeCosts.length < 1) return null
  const maxCost = Math.max(...safeCosts)
  const positiveCosts = safeCosts.filter((value) => value > 0)
  if (positiveCosts.length < 1) return null
  const minCost = Math.min(...positiveCosts)
  return minCost > 0 ? Number((maxCost / minCost).toFixed(4)) : null
}

const buildDeterministicCostAwareChunkRange = ({
  costs,
  chunkCount,
  startOffset = 0,
  chunkIndexBase = 0,
  targetCost,
  bootstrapHead = false,
}) => {
  const safeCosts = (Array.isArray(costs) ? costs : []).map((value) =>
    Math.max(0, Number(value ?? 0)),
  )
  const safeChunkCount = Math.max(1, Math.floor(Number(chunkCount) || 1))
  if (safeCosts.length < 1) {
    return [
      {
        chunkIndex: chunkIndexBase,
        start: startOffset,
        end: startOffset,
        estimatedCost: 0,
        bootstrapHead,
      },
    ]
  }
  const resolvedTargetCost = Math.max(
    1,
    Number(targetCost ?? safeCosts.reduce((sum, value) => sum + value, 0) / safeChunkCount) || 1,
  )
  const chunks = []
  let start = 0
  let runningCost = 0
  let remainingChunks = Math.min(safeChunkCount, safeCosts.length)
  for (let index = 0; index < safeCosts.length; index += 1) {
    runningCost += safeCosts[index]
    const remainingSeeds = safeCosts.length - (index + 1)
    const mustReserveAtLeastOnePerRemainingChunk =
      remainingSeeds >= Math.max(0, remainingChunks - 1)
    const shouldCut =
      remainingChunks > 1 &&
      mustReserveAtLeastOnePerRemainingChunk &&
      runningCost >= resolvedTargetCost
    if (!shouldCut) continue
    chunks.push({
      chunkIndex: chunkIndexBase + chunks.length,
      start: startOffset + start,
      end: startOffset + index + 1,
      estimatedCost: runningCost,
      bootstrapHead,
    })
    start = index + 1
    runningCost = 0
    remainingChunks -= 1
  }
  chunks.push({
    chunkIndex: chunkIndexBase + chunks.length,
    start: startOffset + start,
    end: startOffset + safeCosts.length,
    estimatedCost: runningCost,
    bootstrapHead,
  })
  return chunks.filter((chunk) => chunk.end >= chunk.start)
}

const computeChunkEstimatedCost = ({ costs, start, end }) => {
  let totalCost = 0
  for (let index = Math.max(0, start); index < Math.max(start, end); index += 1) {
    totalCost += Math.max(0, Number(costs[index] ?? 0))
  }
  return totalCost
}

const findDeterministicChunkSplitIndex = ({ chunk, costs }) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  if (end - start < 2) return null
  const totalCost = computeChunkEstimatedCost({ costs, start, end })
  let runningCost = 0
  let bestSplitIndex = null
  let bestDelta = Number.POSITIVE_INFINITY
  let bestLeftCost = Number.POSITIVE_INFINITY
  for (let splitIndex = start + 1; splitIndex < end; splitIndex += 1) {
    runningCost += Math.max(0, Number(costs[splitIndex - 1] ?? 0))
    const leftCost = runningCost
    const rightCost = Math.max(0, totalCost - runningCost)
    const delta = Math.abs(leftCost - rightCost)
    if (
      delta < bestDelta ||
      (delta === bestDelta && leftCost < bestLeftCost) ||
      (delta === bestDelta && leftCost === bestLeftCost && splitIndex < bestSplitIndex)
    ) {
      bestSplitIndex = splitIndex
      bestDelta = delta
      bestLeftCost = leftCost
    }
  }
  return bestSplitIndex
}

const buildDeterministicTargetChunkPlan = ({
  costs,
  chunkCount,
  startOffset = 0,
  chunkIndexBase = 0,
  targetCost = null,
  bootstrapHead = false,
}) => {
  const safeCosts = (Array.isArray(costs) ? costs : []).map((value) =>
    Math.max(0, Number(value ?? 0)),
  )
  const maxPossibleChunkCount = safeCosts.length > 0 ? safeCosts.length : 1
  const desiredChunkCount = Math.max(
    1,
    Math.min(maxPossibleChunkCount, Math.floor(Number(chunkCount) || 1)),
  )
  let chunks = buildDeterministicCostAwareChunkRange({
    costs: safeCosts,
    chunkCount: desiredChunkCount,
    startOffset,
    chunkIndexBase,
    targetCost,
    bootstrapHead,
  }).map((chunk) => ({
    ...chunk,
    estimatedCost: computeChunkEstimatedCost({
      costs: safeCosts,
      start: Number(chunk?.start ?? startOffset) - startOffset,
      end: Number(chunk?.end ?? startOffset) - startOffset,
    }),
  }))
  while (chunks.length < desiredChunkCount) {
    let selectedChunkIndex = -1
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const chunkWidth = Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0)
      if (chunkWidth < 2) continue
      if (selectedChunkIndex < 0) {
        selectedChunkIndex = index
        continue
      }
      const selectedChunk = chunks[selectedChunkIndex]
      const estimatedCost = Number(chunk?.estimatedCost ?? 0)
      const selectedEstimatedCost = Number(selectedChunk?.estimatedCost ?? 0)
      if (estimatedCost !== selectedEstimatedCost) {
        if (estimatedCost > selectedEstimatedCost) {
          selectedChunkIndex = index
        }
        continue
      }
      if (chunkWidth !== Number(selectedChunk?.end ?? 0) - Number(selectedChunk?.start ?? 0)) {
        if (chunkWidth > Number(selectedChunk?.end ?? 0) - Number(selectedChunk?.start ?? 0)) {
          selectedChunkIndex = index
        }
        continue
      }
      if (Number(chunk?.start ?? 0) < Number(selectedChunk?.start ?? 0)) {
        selectedChunkIndex = index
      }
    }
    if (selectedChunkIndex < 0) break
    const selectedChunk = chunks[selectedChunkIndex]
    const relativeStart = Number(selectedChunk?.start ?? startOffset) - startOffset
    const relativeEnd = Number(selectedChunk?.end ?? startOffset) - startOffset
    const splitIndex = findDeterministicChunkSplitIndex({
      chunk: {
        start: relativeStart,
        end: relativeEnd,
      },
      costs: safeCosts,
    })
    if (!Number.isInteger(splitIndex)) break
    const leftChunk = {
      start: startOffset + relativeStart,
      end: startOffset + splitIndex,
      estimatedCost: computeChunkEstimatedCost({
        costs: safeCosts,
        start: relativeStart,
        end: splitIndex,
      }),
      bootstrapHead,
    }
    const rightChunk = {
      start: startOffset + splitIndex,
      end: startOffset + relativeEnd,
      estimatedCost: computeChunkEstimatedCost({
        costs: safeCosts,
        start: splitIndex,
        end: relativeEnd,
      }),
      bootstrapHead,
    }
    chunks.splice(selectedChunkIndex, 1, leftChunk, rightChunk)
  }
  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: chunkIndexBase + index,
    bootstrapHead,
  }))
}

const resolveBootstrapHeadBoundarySeedCount = ({
  costs,
  chunkCount,
  bootstrapHeadChunkCount,
  targetCostPerChunk,
  bootstrapHeadTargetDivisor,
}) => {
  const safeCosts = (Array.isArray(costs) ? costs : []).map((value) =>
    Math.max(0, Number(value ?? 0)),
  )
  if (safeCosts.length < 1) return 0
  const safeChunkCount = Math.max(1, Math.floor(Number(chunkCount) || 1))
  const safeBootstrapHeadChunkCount = Math.max(
    1,
    Math.min(safeCosts.length, Math.floor(Number(bootstrapHeadChunkCount) || 1)),
  )
  const safeBootstrapHeadTargetDivisor = Math.max(
    1,
    Math.floor(Number(bootstrapHeadTargetDivisor) || 1),
  )
  const minBoundarySeedCount = safeBootstrapHeadChunkCount
  const maxBoundarySeedCount = Math.max(
    minBoundarySeedCount,
    safeCosts.length - Math.max(1, safeChunkCount - safeBootstrapHeadChunkCount),
  )
  const bootstrapHeadCostBudget = Math.max(
    1,
    (Math.max(1, Number(targetCostPerChunk) || 1) * safeBootstrapHeadChunkCount) /
      safeBootstrapHeadTargetDivisor,
  )
  let cumulativeCost = 0
  let boundarySeedCount = 0
  while (boundarySeedCount < maxBoundarySeedCount && cumulativeCost < bootstrapHeadCostBudget) {
    cumulativeCost += safeCosts[boundarySeedCount]
    boundarySeedCount += 1
  }
  return Math.max(minBoundarySeedCount, Math.min(boundarySeedCount, maxBoundarySeedCount))
}

const mergeSeedPlanningMetadata = ({ seedEntry, dictionaryEntry }) => ({
  ...seedEntry,
  positiveOffset: Number(dictionaryEntry?.positiveOffset ?? 0),
  positiveCount: Number(dictionaryEntry?.positiveCount ?? seedEntry?.positiveMatchCount ?? 0),
  positiveByteLength: Number(dictionaryEntry?.positiveByteLength ?? 0),
  positiveFirstRowIdx: Number(dictionaryEntry?.positiveFirstRowIdx ?? 0),
  positiveLastRowIdx: Number(dictionaryEntry?.positiveLastRowIdx ?? 0),
  negativeOffset: Number(dictionaryEntry?.negativeOffset ?? 0),
  negativeCount: Number(dictionaryEntry?.negativeCount ?? seedEntry?.negativeMatchCount ?? 0),
  negativeByteLength: Number(dictionaryEntry?.negativeByteLength ?? 0),
  negativeFirstRowIdx: Number(dictionaryEntry?.negativeFirstRowIdx ?? 0),
  negativeLastRowIdx: Number(dictionaryEntry?.negativeLastRowIdx ?? 0),
})

const loadSeedPlanningEntriesWithDictionaryMetadata = async ({
  cwd,
  duckdb,
  tokenDictionaryParquetPath,
  seedEntries,
}) => {
  const safeSeedEntries = Array.isArray(seedEntries) ? seedEntries : []
  if (safeSeedEntries.length < 1) return []
  const dictionaryByToken = await loadPerfectPrototypeTokenDictionaryEntriesByTokens({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens: safeSeedEntries.map((entry) => entry.token),
    expectedUniqueTokenCount: safeSeedEntries.length,
  })
  return safeSeedEntries.map((seedEntry) => {
    const dictionaryEntry = dictionaryByToken.get(seedEntry?.token)
    if (!dictionaryEntry) {
      throw new Error(`Missing planning dictionary entry for token=${seedEntry?.token ?? ""}`)
    }
    return mergeSeedPlanningMetadata({
      seedEntry,
      dictionaryEntry,
    })
  })
}

export const buildDeterministicCostAwareChunks = ({
  seedStats,
  chunkCount,
  bootstrapHeadChunkCount = 0,
  bootstrapHeadTargetDivisor = 4,
}) => {
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const safeChunkCount = Math.max(1, Math.floor(Number(chunkCount) || 1))
  if (safeSeedStats.length < 1) {
    return [{ chunkIndex: 0, start: 0, end: 0, estimatedCost: 0 }]
  }
  const costs = safeSeedStats.map((entry) => computeSeedPartitionCost(entry))
  const totalCost = costs.reduce((sum, value) => sum + value, 0)
  const targetCostPerChunk = totalCost / safeChunkCount
  const safeBootstrapHeadChunkCount = Math.max(
    0,
    Math.min(
      safeChunkCount > 1 ? safeChunkCount - 1 : 0,
      Math.floor(Number(bootstrapHeadChunkCount) || 0),
    ),
  )
  if (safeBootstrapHeadChunkCount < 1) {
    return buildDeterministicTargetChunkPlan({
      costs,
      chunkCount: safeChunkCount,
      startOffset: 0,
      chunkIndexBase: 0,
      targetCost: targetCostPerChunk,
      bootstrapHead: false,
    })
  }
  const bootstrapHeadBoundarySeedCount = resolveBootstrapHeadBoundarySeedCount({
    costs,
    chunkCount: safeChunkCount,
    bootstrapHeadChunkCount: safeBootstrapHeadChunkCount,
    targetCostPerChunk,
    bootstrapHeadTargetDivisor,
  })
  const bootstrapHeadPrefixCosts = costs.slice(0, bootstrapHeadBoundarySeedCount)
  const bootstrapHeadTargetCost = Math.max(
    1,
    bootstrapHeadPrefixCosts.reduce((sum, value) => sum + value, 0) /
      Math.max(1, safeBootstrapHeadChunkCount),
  )
  const headChunks = buildDeterministicTargetChunkPlan({
    costs: bootstrapHeadPrefixCosts,
    chunkCount: safeBootstrapHeadChunkCount,
    startOffset: 0,
    chunkIndexBase: 0,
    targetCost: bootstrapHeadTargetCost,
    bootstrapHead: true,
  })
  const consumedSeedCount = bootstrapHeadBoundarySeedCount
  const tailCosts = costs.slice(consumedSeedCount)
  const tailChunkCount = Math.max(1, safeChunkCount - headChunks.length)
  const tailTargetCost =
    tailCosts.reduce((sum, value) => sum + value, 0) / Math.max(1, tailChunkCount)
  const tailChunks = buildDeterministicTargetChunkPlan({
    costs: tailCosts,
    chunkCount: tailChunkCount,
    startOffset: consumedSeedCount,
    chunkIndexBase: headChunks.length,
    targetCost: tailTargetCost,
    bootstrapHead: false,
  })
  return [...headChunks, ...tailChunks].map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
  }))
}

const splitPathologicalBootstrapHeadChunks = ({
  chunks,
  seedStats,
  maxBootstrapHeadCostRatio = 4,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const bootstrapHeadChunks = safeChunks.filter((chunk) => chunk?.bootstrapHead === true)
  const bootstrapHeadCosts = bootstrapHeadChunks
    .map((chunk) => Number(chunk?.estimatedCost ?? 0))
    .filter((cost) => Number.isFinite(cost) && cost > 0)
    .sort((left, right) => left - right)
  if (bootstrapHeadCosts.length < 1) {
    return {
      chunks: safeChunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
      })),
      bootstrapHeadSplitCount: 0,
    }
  }
  const medianBootstrapHeadCost =
    bootstrapHeadCosts[Math.floor(bootstrapHeadCosts.length / 2)] ?? bootstrapHeadCosts[0]
  const safeMaxBootstrapHeadCostRatio = Math.max(
    1.5,
    Number(maxBootstrapHeadCostRatio ?? 4) || 4,
  )
  let bootstrapHeadSplitCount = 0
  const nextChunks = []
  for (const chunk of safeChunks) {
    const start = Math.max(0, Number(chunk?.start ?? 0))
    const end = Math.max(start, Number(chunk?.end ?? start))
    const chunkLength = end - start
    const estimatedCost = Math.max(0, Number(chunk?.estimatedCost ?? 0))
    const shouldSplit =
      chunk?.bootstrapHead === true &&
      chunkLength > 1 &&
      medianBootstrapHeadCost > 0 &&
      estimatedCost > medianBootstrapHeadCost * safeMaxBootstrapHeadCostRatio
    if (!shouldSplit) {
      nextChunks.push({
        ...chunk,
      })
      continue
    }
    const localCosts = safeSeedStats
      .slice(start, end)
      .map((entry) => computeSeedPartitionCost(entry))
    const splitChunks = buildDeterministicCostAwareChunkRange({
      costs: localCosts,
      chunkCount: 2,
      startOffset: start,
      chunkIndexBase: 0,
      targetCost: estimatedCost / 2,
      bootstrapHead: true,
    })
    if (splitChunks.length < 2) {
      nextChunks.push({
        ...chunk,
      })
      continue
    }
    bootstrapHeadSplitCount += splitChunks.length - 1
    nextChunks.push(
      ...splitChunks.map((splitChunk) => ({
        ...splitChunk,
        bootstrapHead: true,
      })),
    )
  }
  return {
    chunks: nextChunks.map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
    })),
    bootstrapHeadSplitCount,
  }
}

const computeMedianFinitePositiveValue = (values) => {
  const safeValues = (Array.isArray(values) ? values : [])
    .map((value) => Number(value ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
  if (safeValues.length < 1) return null
  return safeValues[Math.floor((safeValues.length - 1) / 2)] ?? safeValues[0]
}

const computeChunkFirstWaveFrontierSplitCost = ({
  chunk,
  microprobe,
}) => {
  const estimatedCost = Math.max(1, Number(chunk?.estimatedCost ?? 0))
  if (!microprobe) return estimatedCost
  const sampledRootCount = Math.max(0, Number(microprobe?.sampledRootCount ?? 0))
  const meanPositiveDensity = Math.max(0, Number(microprobe?.meanPositiveDensity ?? 0))
  const meanPositiveGap = Math.max(0, Number(microprobe?.meanPositiveGap ?? 0))
  const branchCandidateCount = Math.max(0, Number(microprobe?.branchCandidateCount ?? 0))
  const branchOverlapMass = Math.max(0, Number(microprobe?.branchOverlapMass ?? 0))
  const sampleExactByteLength = Math.max(0, Number(microprobe?.sampleExactByteLength ?? 0))
  const densityPenalty =
    sampledRootCount > 0
      ? 1 + Math.min(4, 1 / Math.max(Math.sqrt(meanPositiveDensity * 256), 0.5) - 0.5)
      : 2
  const gapPenalty = 1 + Math.min(4, Math.log2(meanPositiveGap + 2) / 6)
  const branchPenalty =
    1 + Math.min(4, branchCandidateCount * 0.25 + Math.log2(branchOverlapMass + 2) / 8)
  const bytePenalty = 1 + Math.min(4, Math.log2(sampleExactByteLength + 2) / 10)
  return Number((estimatedCost * densityPenalty * gapPenalty * branchPenalty * bytePenalty).toFixed(6))
}

const buildFirstWaveFrontierChunkIndexes = ({
  chunks,
  seedStats,
  workerCount,
  bootstrapHeadLaunchQuota,
  bootstrapHeadFirstWaveQuota,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  frontierDispatchBandMultiplier = 2,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const provisionalReadyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const frontierDispatchBandSize = Math.min(
    provisionalReadyQueue.length,
    Math.max(
      safeWorkerCount,
      safeWorkerCount * Math.max(1, Math.floor(Number(frontierDispatchBandMultiplier) || 1)),
    ),
  )
  return new Set(
    provisionalReadyQueue
      .slice(0, frontierDispatchBandSize)
      .map((chunk) => Number(chunk?.chunkIndex ?? -1))
      .filter((chunkIndex) => chunkIndex >= 0),
  )
}

export const splitPathologicalFirstWaveFrontierChunks = ({
  chunks,
  seedStats,
  workerCount,
  bootstrapHeadLaunchQuota,
  bootstrapHeadFirstWaveQuota,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  frontierDispatchBandMultiplier = 2,
  maxFrontierEffectiveCostRatio = 2,
  maxFrontierWidthRatio = 1.5,
  maxSplitChunkCountPerFrontierChunk = 4,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const scoredChunks = scoreDeterministicReadyQueueChunks({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const scoredChunksByChunkIndex = new Map(
    scoredChunks.map((chunk) => [Number(chunk?.chunkIndex ?? -1), chunk]),
  )
  if (safeChunks.length < 1) {
    return {
      chunks: [],
      firstWaveFrontierSplitCount: 0,
    }
  }
  const firstWaveFrontierChunkIndexes = buildFirstWaveFrontierChunkIndexes({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    workerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    chunkHeadMicroprobesByChunkIndex,
    frontierDispatchBandMultiplier,
    readyQueueScoreCache,
    planningReuseStats,
  })
  if (firstWaveFrontierChunkIndexes.size < 1) {
    return {
      chunks: safeChunks.map((chunk, chunkIndex) => {
        const scoredChunk = scoredChunksByChunkIndex.get(Number(chunk?.chunkIndex ?? -1)) ?? chunk
        return {
          ...chunk,
          headMicroprobeOverride: scoredChunk?.headMicroprobe ?? null,
          chunkIndex,
        }
      }),
      firstWaveFrontierSplitCount: 0,
    }
  }
  const frontierChunks = scoredChunks.filter((chunk) =>
    firstWaveFrontierChunkIndexes.has(Number(chunk?.chunkIndex ?? -1)),
  )
  const frontierMedianEffectiveCost = computeMedianFinitePositiveValue(
    frontierChunks.map((chunk) =>
      computeChunkFirstWaveFrontierSplitCost({
        chunk,
        microprobe: chunk?.headMicroprobe ?? null,
      }),
    ),
  )
  const frontierMedianWidth = computeMedianFinitePositiveValue(
    frontierChunks.map((chunk) =>
      Math.max(0, Number(chunk?.end ?? 0) - Number(chunk?.start ?? 0)),
    ),
  )
  if (!Number.isFinite(frontierMedianEffectiveCost) || frontierMedianEffectiveCost <= 0) {
    return {
      chunks: safeChunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
      })),
      firstWaveFrontierSplitCount: 0,
    }
  }
  const safeMaxFrontierEffectiveCostRatio = Math.max(
    1.25,
    Number(maxFrontierEffectiveCostRatio ?? 2) || 2,
  )
  const safeMaxFrontierWidthRatio = Math.max(
    1.1,
    Number(maxFrontierWidthRatio ?? 1.5) || 1.5,
  )
  const targetMaxFrontierEffectiveCost = frontierMedianEffectiveCost * safeMaxFrontierEffectiveCostRatio
  const targetMaxFrontierWidth = Math.max(
    1,
    (Number.isFinite(frontierMedianWidth) && frontierMedianWidth > 0 ? frontierMedianWidth : 1) *
      safeMaxFrontierWidthRatio,
  )
  let firstWaveFrontierSplitCount = 0
  const nextChunks = []
  for (const chunk of safeChunks) {
    const start = Math.max(0, Number(chunk?.start ?? 0))
    const end = Math.max(start, Number(chunk?.end ?? start))
    const chunkWidth = end - start
    const chunkIndex = Number(chunk?.chunkIndex ?? -1)
    const scoredChunk = scoredChunksByChunkIndex.get(chunkIndex) ?? chunk
    const microprobe = scoredChunk?.headMicroprobe ?? null
    const effectiveCost = computeChunkFirstWaveFrontierSplitCost({
      chunk: scoredChunk,
      microprobe,
    })
    const shouldConsiderSplit =
      firstWaveFrontierChunkIndexes.has(chunkIndex) &&
      chunkWidth > 1 &&
      (effectiveCost > targetMaxFrontierEffectiveCost || chunkWidth > targetMaxFrontierWidth)
    if (!shouldConsiderSplit) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
      })
      continue
    }
    const maxAllowedChunkCount = Math.max(
      2,
      Math.min(
        chunkWidth,
        Math.floor(Number(maxSplitChunkCountPerFrontierChunk) || 4),
      ),
    )
    const desiredChunkCount = Math.max(
      2,
      Math.min(
        maxAllowedChunkCount,
        Math.max(
          Math.ceil(effectiveCost / Math.max(1, targetMaxFrontierEffectiveCost)),
          Math.ceil(chunkWidth / Math.max(1, targetMaxFrontierWidth)),
        ),
      ),
    )
    if (desiredChunkCount < 2) {
      nextChunks.push({
        ...chunk,
      })
      continue
    }
    const localCosts = safeSeedStats.slice(start, end).map((entry) => computeSeedPartitionCost(entry))
    const splitChunks = buildDeterministicTargetChunkPlan({
      costs: localCosts,
      chunkCount: desiredChunkCount,
      startOffset: start,
      chunkIndexBase: 0,
      targetCost: Number(chunk?.estimatedCost ?? 0) / desiredChunkCount,
      bootstrapHead: chunk?.bootstrapHead === true,
    })
    if (splitChunks.length < 2) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
      })
      continue
    }
    const parentEstimatedCost = Math.max(1, Number(scoredChunk?.estimatedCost ?? chunk?.estimatedCost ?? 0))
    const parentDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.dispatchScore ?? scoredChunk?.bootstrapDispatchScore,
    )
    const parentFirstWaveDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.firstWaveDispatchScore,
    )
    const parentBootstrapDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.bootstrapDispatchScore,
    )
    const parentBootstrapScore = resolveChunkScoreOverride(scoredChunk?.bootstrapScore)
    const parentSteadyDispatchScore = resolveChunkScoreOverride(scoredChunk?.steadyDispatchScore)
    firstWaveFrontierSplitCount += splitChunks.length - 1
    nextChunks.push(
      ...splitChunks.map((splitChunk) => ({
        ...splitChunk,
        bootstrapHead: chunk?.bootstrapHead === true,
        headMicroprobeOverride: microprobe,
        bootstrapScoreOverride: parentBootstrapScore,
        steadyDispatchScoreOverride:
          parentSteadyDispatchScore == null
            ? null
            : Number(
                (
                  parentSteadyDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        bootstrapDispatchScoreOverride:
          parentBootstrapDispatchScore == null
            ? null
            : Number(
                (
                  parentBootstrapDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        dispatchScoreOverride:
          parentDispatchScore == null
            ? null
            : Number(
                (
                  parentDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        splitSourceChunkIndex: chunkIndex,
      })),
    )
  }
  return {
    chunks: nextChunks.map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
    })),
    firstWaveFrontierSplitCount,
  }
}

export const splitFirstWaveLaunchChunksForCompletion = ({
  chunks,
  seedStats,
  workerCount,
  bootstrapHeadLaunchQuota,
  bootstrapHeadFirstWaveQuota,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  targetLaunchChunkMultiplier = 4,
  maxSplitChunksPerLaunchChunk = 8,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  if (safeChunks.length < 1) {
    return {
      chunks: [],
      firstWaveLaunchSplitCount: 0,
    }
  }
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const scoredChunks = scoreDeterministicReadyQueueChunks({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const scoredChunksByChunkIndex = new Map(
    scoredChunks.map((chunk) => [Number(chunk?.chunkIndex ?? -1), chunk]),
  )
  const provisionalReadyQueue = buildDeterministicReadyQueue({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    workerCount: safeWorkerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const firstWaveLaunchChunkIndexes = new Set(
    provisionalReadyQueue
      .slice(0, safeWorkerCount)
      .map((chunk) => Number(chunk?.chunkIndex ?? -1))
      .filter((chunkIndex) => chunkIndex >= 0),
  )
  if (firstWaveLaunchChunkIndexes.size < 1) {
    return {
      chunks: safeChunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
      })),
      firstWaveLaunchSplitCount: 0,
    }
  }
  const firstWaveLaunchChunks = scoredChunks.filter((chunk) =>
    firstWaveLaunchChunkIndexes.has(Number(chunk?.chunkIndex ?? -1)),
  )
  const safeTargetLaunchChunkMultiplier = Math.max(
    2,
    Math.floor(Number(targetLaunchChunkMultiplier) || 4),
  )
  const totalFirstWaveLaunchEstimatedCost = firstWaveLaunchChunks.reduce(
    (sum, chunk) => sum + Math.max(0, Number(chunk?.estimatedCost ?? 0)),
    0,
  )
  const targetLaunchChunkCost = Math.max(
    1,
    totalFirstWaveLaunchEstimatedCost /
      Math.max(1, firstWaveLaunchChunks.length * safeTargetLaunchChunkMultiplier),
  )
  let firstWaveLaunchSplitCount = 0
  const nextChunks = []
  for (const chunk of safeChunks) {
    const start = Math.max(0, Number(chunk?.start ?? 0))
    const end = Math.max(start, Number(chunk?.end ?? start))
    const chunkWidth = end - start
    const chunkIndex = Number(chunk?.chunkIndex ?? -1)
    const firstWaveCompletionTarget = firstWaveLaunchChunkIndexes.has(chunkIndex)
    const scoredChunk = scoredChunksByChunkIndex.get(chunkIndex) ?? chunk
    const microprobe = scoredChunk?.headMicroprobe ?? null
    const estimatedCost = Math.max(0, Number(scoredChunk?.estimatedCost ?? chunk?.estimatedCost ?? 0))
    const shouldConsiderSplit =
      firstWaveCompletionTarget &&
      chunkWidth > 1 &&
      estimatedCost > targetLaunchChunkCost
    if (!shouldConsiderSplit) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex: firstWaveCompletionTarget ? chunkIndex : null,
      })
      continue
    }
    const maxAllowedChunkCount = Math.max(
      2,
      Math.min(
        chunkWidth,
        Math.floor(Number(maxSplitChunksPerLaunchChunk) || 8),
      ),
    )
    const desiredChunkCount = Math.max(
      2,
      Math.min(
        maxAllowedChunkCount,
        Math.ceil(estimatedCost / Math.max(1, targetLaunchChunkCost)),
      ),
    )
    if (desiredChunkCount < 2) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex: firstWaveCompletionTarget ? chunkIndex : null,
      })
      continue
    }
    const localCosts = safeSeedStats.slice(start, end).map((entry) => computeSeedPartitionCost(entry))
    const splitChunks = buildDeterministicTargetChunkPlan({
      costs: localCosts,
      chunkCount: desiredChunkCount,
      startOffset: start,
      chunkIndexBase: 0,
      targetCost: estimatedCost / desiredChunkCount,
      bootstrapHead: chunk?.bootstrapHead === true,
    })
    if (splitChunks.length < 2) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex: firstWaveCompletionTarget ? chunkIndex : null,
      })
      continue
    }
    const parentEstimatedCost = Math.max(1, estimatedCost)
    const parentDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.dispatchScore ?? scoredChunk?.bootstrapDispatchScore,
    )
    const parentFirstWaveDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.firstWaveDispatchScore,
    )
    const parentBootstrapDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.bootstrapDispatchScore,
    )
    const parentBootstrapScore = resolveChunkScoreOverride(scoredChunk?.bootstrapScore)
    const parentSteadyDispatchScore = resolveChunkScoreOverride(scoredChunk?.steadyDispatchScore)
    firstWaveLaunchSplitCount += splitChunks.length - 1
    nextChunks.push(
      ...splitChunks.map((splitChunk) => ({
        ...splitChunk,
        bootstrapHead: chunk?.bootstrapHead === true,
        headMicroprobeOverride: microprobe,
        bootstrapScoreOverride: parentBootstrapScore,
        steadyDispatchScoreOverride:
          parentSteadyDispatchScore == null
            ? null
            : Number(
                (
                  parentSteadyDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        bootstrapDispatchScoreOverride:
          parentBootstrapDispatchScore == null
            ? null
            : Number(
                (
                  parentBootstrapDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        dispatchScoreOverride:
          parentDispatchScore == null
            ? null
            : Number(
                (
                  parentDispatchScore *
                  Math.max(
                    1,
                    Math.sqrt(parentEstimatedCost / Math.max(1, Number(splitChunk?.estimatedCost ?? 0))),
                  )
                ).toFixed(6),
              ),
        splitSourceChunkIndex: chunkIndex,
        firstWaveCompletionTarget: true,
        firstWaveCompletionTargetSourceChunkIndex: chunkIndex,
      })),
    )
  }
  return {
    chunks: nextChunks.map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
    })),
    firstWaveLaunchSplitCount,
  }
}

const buildDeterministicRootSeedMicroshardsForChunk = ({
  chunk,
  seedCosts,
  startOffset,
  targetShardCost,
  heavySeedCostRatio = 2,
  maxHeavySingletonCount = 3,
  maxShardCount = 8,
  forceSingletonRoots = false,
}) => {
  const safeSeedCosts = (Array.isArray(seedCosts) ? seedCosts : []).map((value) =>
    Math.max(0, Number(value ?? 0)),
  )
  if (safeSeedCosts.length < 2) return null
  const cappedShardCount = Math.max(2, Math.floor(Number(maxShardCount) || 8))
  if (forceSingletonRoots === true) {
    if (safeSeedCosts.length > cappedShardCount) return null
    return safeSeedCosts.map((cost, index) => ({
      start: startOffset + index,
      end: startOffset + index + 1,
      estimatedCost: cost,
      bootstrapHead: chunk?.bootstrapHead === true,
      rootSeedMicroshardSingleton: true,
      rootSeedMicroshardForcedSingleton: true,
    }))
  }
  const safeTargetShardCost = Math.max(1, Number(targetShardCost ?? 1) || 1)
  const seedMedianCost = computeMedianFinitePositiveValue(safeSeedCosts) ?? safeTargetShardCost
  const heavySeedThreshold = Math.max(
    safeTargetShardCost,
    seedMedianCost * Math.max(1.25, Number(heavySeedCostRatio ?? 2) || 2),
  )
  const heavySeedIndexes = []
  for (let index = 0; index < safeSeedCosts.length; index += 1) {
    if (safeSeedCosts[index] <= heavySeedThreshold) continue
    heavySeedIndexes.push(index)
    if (heavySeedIndexes.length >= Math.max(1, Math.floor(Number(maxHeavySingletonCount) || 3))) {
      break
    }
  }
  const heavySeedIndexSet = new Set(heavySeedIndexes)
  const shards = []
  const appendResidualRange = (rangeStart, rangeEnd) => {
    if (rangeEnd <= rangeStart) return
    const residualCosts = safeSeedCosts.slice(rangeStart, rangeEnd)
    const residualTotalCost = residualCosts.reduce((sum, value) => sum + value, 0)
    const residualChunkCount = Math.max(
      1,
      Math.min(
        rangeEnd - rangeStart,
        Math.ceil(residualTotalCost / safeTargetShardCost),
      ),
    )
    const residualChunks = buildDeterministicTargetChunkPlan({
      costs: residualCosts,
      chunkCount: residualChunkCount,
      startOffset: startOffset + rangeStart,
      chunkIndexBase: 0,
      targetCost: safeTargetShardCost,
      bootstrapHead: chunk?.bootstrapHead === true,
    })
    shards.push(...residualChunks)
  }
  let residualStart = 0
  for (let index = 0; index < safeSeedCosts.length; index += 1) {
    if (!heavySeedIndexSet.has(index)) continue
    appendResidualRange(residualStart, index)
    shards.push({
      start: startOffset + index,
      end: startOffset + index + 1,
      estimatedCost: safeSeedCosts[index],
      bootstrapHead: chunk?.bootstrapHead === true,
      rootSeedMicroshardSingleton: true,
    })
    residualStart = index + 1
  }
  appendResidualRange(residualStart, safeSeedCosts.length)
  if (shards.length < 2 || shards.length > cappedShardCount) {
    const fallbackChunks = buildDeterministicTargetChunkPlan({
      costs: safeSeedCosts,
      chunkCount: Math.min(cappedShardCount, Math.max(2, Math.ceil(
        safeSeedCosts.reduce((sum, value) => sum + value, 0) / safeTargetShardCost,
      ))),
      startOffset,
      chunkIndexBase: 0,
      targetCost: safeTargetShardCost,
      bootstrapHead: chunk?.bootstrapHead === true,
    })
    return fallbackChunks.length >= 2 ? fallbackChunks : null
  }
  return shards
}

export const splitFirstWaveLaunchChunksIntoRootSeedMicroshards = ({
  chunks,
  seedStats,
  workerCount,
  bootstrapHeadLaunchQuota,
  bootstrapHeadFirstWaveQuota,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  targetRootSeedMicroshardMultiplier = 6,
  heavySeedCostRatio = 2,
  maxHeavySingletonCountPerChunk = 3,
  maxMicroshardCountPerLaunchChunk = 8,
  forceSingletonFirstWaveLaunchChunkWidth = 4,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  if (safeChunks.length < 1) {
    return {
      chunks: [],
      firstWaveRootSeedMicroshardCount: 0,
      firstWaveForcedSingletonMicroshardCount: 0,
    }
  }
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const scoredChunks = scoreDeterministicReadyQueueChunks({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const scoredChunksByChunkIndex = new Map(
    scoredChunks.map((chunk) => [Number(chunk?.chunkIndex ?? -1), chunk]),
  )
  const explicitFirstWaveCompletionTargetChunkIndexes = new Set(
    safeChunks
      .filter((chunk) => chunk?.firstWaveCompletionTarget === true)
      .map((chunk) => Number(chunk?.chunkIndex ?? -1))
      .filter((chunkIndex) => chunkIndex >= 0),
  )
  const provisionalReadyQueue = buildDeterministicReadyQueue({
    chunks: safeChunks,
    seedStats: safeSeedStats,
    workerCount: safeWorkerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    chunkHeadMicroprobesByChunkIndex,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const firstWaveLaunchChunkIndexes = new Set(
    provisionalReadyQueue
      .slice(0, safeWorkerCount)
      .map((chunk) => Number(chunk?.chunkIndex ?? -1))
      .filter((chunkIndex) => chunkIndex >= 0),
  )
  if (firstWaveLaunchChunkIndexes.size < 1) {
    return {
      chunks: safeChunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
      })),
      firstWaveRootSeedMicroshardCount: 0,
      firstWaveForcedSingletonMicroshardCount: 0,
    }
  }
  const firstWaveLaunchChunks = scoredChunks.filter((chunk) =>
    firstWaveLaunchChunkIndexes.has(Number(chunk?.chunkIndex ?? -1)),
  )
  const safeTargetRootSeedMicroshardMultiplier = Math.max(
    2,
    Math.floor(Number(targetRootSeedMicroshardMultiplier) || 6),
  )
  const safeForceSingletonFirstWaveLaunchChunkWidth = Math.max(
    2,
    Math.floor(Number(forceSingletonFirstWaveLaunchChunkWidth) || 4),
  )
  const totalFirstWaveLaunchEstimatedCost = firstWaveLaunchChunks.reduce(
    (sum, chunk) => sum + Math.max(0, Number(chunk?.estimatedCost ?? 0)),
    0,
  )
  const targetShardCost = Math.max(
    1,
    totalFirstWaveLaunchEstimatedCost /
      Math.max(1, firstWaveLaunchChunks.length * safeTargetRootSeedMicroshardMultiplier),
  )
  let firstWaveRootSeedMicroshardCount = 0
  let firstWaveForcedSingletonMicroshardCount = 0
  const nextChunks = []
  for (const chunk of safeChunks) {
    const start = Math.max(0, Number(chunk?.start ?? 0))
    const end = Math.max(start, Number(chunk?.end ?? start))
    const chunkWidth = end - start
    const chunkIndex = Number(chunk?.chunkIndex ?? -1)
    const firstWaveCompletionTarget =
      chunk?.firstWaveCompletionTarget === true ||
      firstWaveLaunchChunkIndexes.has(chunkIndex) ||
      explicitFirstWaveCompletionTargetChunkIndexes.has(chunkIndex)
    const scoredChunk = scoredChunksByChunkIndex.get(chunkIndex) ?? chunk
    const microprobe = scoredChunk?.headMicroprobe ?? null
    const shouldMicroshard =
      firstWaveCompletionTarget &&
      chunkWidth > 1
    if (!shouldMicroshard) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex:
          firstWaveCompletionTarget === true
            ? Number(chunk?.firstWaveCompletionTargetSourceChunkIndex ?? chunkIndex)
            : null,
      })
      continue
    }
    const localCosts = safeSeedStats.slice(start, end).map((entry) => computeSeedPartitionCost(entry))
    const forceSingletonRoots = chunkWidth <= safeForceSingletonFirstWaveLaunchChunkWidth
    const microshards = buildDeterministicRootSeedMicroshardsForChunk({
      chunk,
      seedCosts: localCosts,
      startOffset: start,
      targetShardCost,
      heavySeedCostRatio,
      maxHeavySingletonCount: maxHeavySingletonCountPerChunk,
      maxShardCount: maxMicroshardCountPerLaunchChunk,
      forceSingletonRoots,
    })
    if (!microshards || microshards.length < 2) {
      nextChunks.push({
        ...chunk,
        headMicroprobeOverride: microprobe,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex:
          firstWaveCompletionTarget === true
            ? Number(chunk?.firstWaveCompletionTargetSourceChunkIndex ?? chunkIndex)
            : null,
      })
      continue
    }
    const parentEstimatedCost = Math.max(1, Number(scoredChunk?.estimatedCost ?? chunk?.estimatedCost ?? 0))
    const parentDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.dispatchScore ?? scoredChunk?.bootstrapDispatchScore,
    )
    const parentFirstWaveDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.firstWaveDispatchScore,
    )
    const parentBootstrapDispatchScore = resolveChunkScoreOverride(
      scoredChunk?.bootstrapDispatchScore,
    )
    const parentBootstrapScore = resolveChunkScoreOverride(scoredChunk?.bootstrapScore)
    const parentSteadyDispatchScore = resolveChunkScoreOverride(scoredChunk?.steadyDispatchScore)
    firstWaveRootSeedMicroshardCount += microshards.length - 1
    if (forceSingletonRoots === true) {
      firstWaveForcedSingletonMicroshardCount += microshards.length
    }
    nextChunks.push(
      ...microshards.map((microshard) => ({
        ...microshard,
        bootstrapHead: chunk?.bootstrapHead === true,
        // Root-seed microshards must be rescored from child-local metadata/microprobes.
        headMicroprobeOverride: null,
        bootstrapScoreOverride: null,
        steadyDispatchScoreOverride: null,
        bootstrapDispatchScoreOverride: null,
        dispatchScoreOverride: null,
        firstWaveDispatchScoreOverride: null,
        microshardParentEstimatedCost: parentEstimatedCost,
        microshardParentDispatchScoreHint: parentDispatchScore,
        microshardParentFirstWaveDispatchScoreHint: parentFirstWaveDispatchScore,
        microshardParentBootstrapDispatchScoreHint: parentBootstrapDispatchScore,
        microshardParentBootstrapScoreHint: parentBootstrapScore,
        microshardParentSteadyDispatchScoreHint: parentSteadyDispatchScore,
        splitSourceChunkIndex: chunkIndex,
        rootSeedMicroshard: true,
        firstWaveCompletionTarget,
        firstWaveCompletionTargetSourceChunkIndex:
          firstWaveCompletionTarget === true
            ? Number(chunk?.firstWaveCompletionTargetSourceChunkIndex ?? chunkIndex)
            : null,
      })),
    )
  }
  return {
    chunks: nextChunks.map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
    })),
    firstWaveRootSeedMicroshardCount,
    firstWaveForcedSingletonMicroshardCount,
  }
}

const computeChunkBootstrapScore = ({ chunk, seedStats }) => {
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  let bestPrecision = 0
  let bestPositive = 0
  let bestSeparationRatio = 0
  let negativePenalty = 0
  let entryCount = 0
  for (let index = start; index < end; index += 1) {
    const entry = safeSeedStats[index]
    const precision = Math.max(0, Number(entry?.precision ?? 0))
    const positive = Math.max(0, Number(entry?.positiveMatchCount ?? 0))
    const negative = Math.max(0, Number(entry?.negativeMatchCount ?? 0))
    const separationRatio = Math.max(0, Number(entry?.separationRatio ?? 0))
    bestPrecision = Math.max(bestPrecision, precision)
    bestPositive = Math.max(bestPositive, positive)
    bestSeparationRatio = Math.max(bestSeparationRatio, separationRatio)
    negativePenalty += negative
    entryCount += 1
  }
  const averageNegativePenalty = negativePenalty / Math.max(1, entryCount)
  const costPenalty = Math.sqrt(Math.max(1, Number(chunk?.estimatedCost ?? 0)))
  return Number(
    (
      ((1 + bestPrecision) * (1 + bestPositive) * (1 + bestSeparationRatio)) /
      ((1 + averageNegativePenalty) * costPenalty)
    ).toFixed(6),
  )
}

const computeChunkSteadyDispatchScore = ({ chunk, seedStats }) => {
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  let precisionBias = 1
  let separationBias = 1
  for (let index = start; index < end; index += 1) {
    const entry = safeSeedStats[index]
    const precision = Math.max(0, Number(entry?.precision ?? 0))
    const separationRatio = Math.max(0, Number(entry?.separationRatio ?? 0))
    precisionBias = Math.max(precisionBias, 1 + precision)
    separationBias = Math.max(separationBias, 1 + separationRatio)
  }
  return Number((Number(chunk?.estimatedCost ?? 0) * precisionBias * separationBias).toFixed(6))
}

const computeChunkBootstrapDispatchScore = ({
  chunk,
  bootstrapScore,
  steadyDispatchScore,
}) => {
  const resolvedBootstrapScore = Math.max(0, Number(bootstrapScore ?? 0))
  const resolvedSteadyDispatchScore = Math.max(0, Number(steadyDispatchScore ?? 0))
  const estimatedCost = Math.max(1, Number(chunk?.estimatedCost ?? 0))
  return Number(
    (
      (resolvedBootstrapScore * resolvedSteadyDispatchScore) /
      Math.log2(estimatedCost + 2)
    ).toFixed(6),
  )
}

const computeChunkHeadMicroprobeDispatchScore = ({
  bootstrapDispatchScore,
  microprobe,
}) => {
  const resolvedBootstrapDispatchScore = Math.max(0, Number(bootstrapDispatchScore ?? 0))
  if (resolvedBootstrapDispatchScore <= 0 || !microprobe) {
    return Number(resolvedBootstrapDispatchScore.toFixed(6))
  }
  const meanPositiveDensity = Math.max(0, Number(microprobe?.meanPositiveDensity ?? 0))
  const meanPositiveGap = Math.max(0, Number(microprobe?.meanPositiveGap ?? 0))
  const branchCandidateCount = Math.max(0, Number(microprobe?.branchCandidateCount ?? 0))
  const branchOverlapMass = Math.max(0, Number(microprobe?.branchOverlapMass ?? 0))
  const sampleExactByteLength = Math.max(0, Number(microprobe?.sampleExactByteLength ?? 0))
  const densityBias = 1 + Math.min(3, meanPositiveDensity * 256)
  const gapPenalty = 1 + Math.min(4, Math.log2(meanPositiveGap + 2) / 5)
  const branchPenalty =
    1 + Math.min(4, branchCandidateCount * 0.35 + Math.log2(branchOverlapMass + 2) / 8)
  const bytePenalty = 1 + Math.min(4, Math.log2(sampleExactByteLength + 2) / 8)
  return Number(
    (
      (resolvedBootstrapDispatchScore * densityBias) /
      (gapPenalty * branchPenalty * bytePenalty)
    ).toFixed(6),
  )
}

const computeChunkSingletonRootCompletionScore = ({
  chunk,
  seedStats,
  microprobe,
}) => {
  if (!isSingletonRootChunk(chunk)) return null
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const seedIndex = Math.max(0, Number(chunk?.start ?? 0))
  const entry = safeSeedStats[seedIndex]
  if (!entry) return null
  const positiveCount = Math.max(1, toFiniteNonNegativeMetric(entry?.positiveCount, entry?.positiveMatchCount))
  const negativeCount = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeCount, entry?.negativeMatchCount))
  const totalPostingCount = positiveCount + negativeCount
  const positiveByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.positiveByteLength))
  const negativeByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeByteLength))
  const totalByteLength = positiveByteLength + negativeByteLength
  const seedPartitionCost = Math.max(1, computeSeedPartitionCost(entry))
  const rowSpan = Math.max(
    computePostingRowSpan({
      firstRowIdx: entry?.positiveFirstRowIdx,
      lastRowIdx: entry?.positiveLastRowIdx,
      fallbackCount: positiveCount,
    }),
    computePostingRowSpan({
      firstRowIdx: entry?.negativeFirstRowIdx,
      lastRowIdx: entry?.negativeLastRowIdx,
      fallbackCount: negativeCount,
    }),
  )
  const precision = Math.max(0, Math.min(1, Number(entry?.precision ?? 0) || 0))
  const separationRatio = Math.max(0, Number(entry?.separationRatio ?? 0) || 0)
  const estimatedCost = Math.max(1, Number(chunk?.estimatedCost ?? 0))
  const fallbackPositiveDensity = positiveCount / Math.max(1, rowSpan)
  const meanPositiveDensity = Math.max(
    0,
    Number(microprobe?.meanPositiveDensity ?? fallbackPositiveDensity) || fallbackPositiveDensity,
  )
  const fallbackPositiveGap = rowSpan / Math.max(1, positiveCount)
  const meanPositiveGap = Math.max(
    0,
    Number(microprobe?.meanPositiveGap ?? fallbackPositiveGap) || fallbackPositiveGap,
  )
  const branchCandidateCount = Math.max(0, Number(microprobe?.branchCandidateCount ?? 0))
  const branchOverlapMass = Math.max(0, Number(microprobe?.branchOverlapMass ?? 0))
  const sampleExactByteLength = Math.max(0, Number(microprobe?.sampleExactByteLength ?? totalByteLength))
  const densityBias = 1 + Math.min(2.5, meanPositiveDensity * 256)
  const precisionBias = 1 + precision * 0.2
  const separationBias = 1 + Math.min(4, separationRatio) * 0.08
  const postingPenalty = 1 + Math.log2(totalPostingCount + 2) / 4.5
  const bytePenalty = 1 + Math.log2(totalByteLength + 2) / 5.5
  const sampleBytePenalty = 1 + Math.log2(sampleExactByteLength + 2) / 5.5
  const rowSpanPenalty = 1 + Math.log2(rowSpan + 2) / 5.5
  const gapPenalty = 1 + Math.log2(meanPositiveGap + 2) / 5.5
  const branchPenalty =
    1 + Math.min(8, branchCandidateCount * 0.65 + Math.log2(branchOverlapMass + 2) / 4)
  const negativePenalty = 1 + Math.log2(negativeCount + 2) / 3.5
  const seedPartitionCostPenalty = 1 + Math.log2(seedPartitionCost + 2) / 4
  const estimatedCostPenalty = 1 + Math.log2(estimatedCost + 2) / 8
  return Number(
    (
      (densityBias * precisionBias * separationBias) /
      (postingPenalty *
        bytePenalty *
        sampleBytePenalty *
        rowSpanPenalty *
        gapPenalty *
        branchPenalty *
        negativePenalty *
        seedPartitionCostPenalty *
        estimatedCostPenalty)
    ).toFixed(6),
  )
}

const computeChunkMultiRootCompletionScore = ({
  chunk,
  seedStats,
  microprobe,
}) => {
  const chunkWidth = computeChunkWidth(chunk)
  if (chunkWidth <= 1) return null
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  let entryCount = 0
  let totalPositiveCount = 0
  let totalNegativeCount = 0
  let totalByteLength = 0
  let maxRowSpan = 1
  let totalSeedCost = 0
  let maxSeedCost = 0
  let bestPrecision = 0
  let bestSeparationRatio = 0
  for (let index = start; index < end; index += 1) {
    const entry = safeSeedStats[index]
    if (!entry) continue
    const positiveCount = Math.max(1, toFiniteNonNegativeMetric(entry?.positiveCount, entry?.positiveMatchCount))
    const negativeCount = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeCount, entry?.negativeMatchCount))
    const positiveByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.positiveByteLength))
    const negativeByteLength = Math.max(0, toFiniteNonNegativeMetric(entry?.negativeByteLength))
    const rowSpan = Math.max(
      computePostingRowSpan({
        firstRowIdx: entry?.positiveFirstRowIdx,
        lastRowIdx: entry?.positiveLastRowIdx,
        fallbackCount: positiveCount,
      }),
      computePostingRowSpan({
        firstRowIdx: entry?.negativeFirstRowIdx,
        lastRowIdx: entry?.negativeLastRowIdx,
        fallbackCount: negativeCount,
      }),
    )
    const seedCost = Math.max(1, computeSeedPartitionCost(entry))
    totalPositiveCount += positiveCount
    totalNegativeCount += negativeCount
    totalByteLength += positiveByteLength + negativeByteLength
    maxRowSpan = Math.max(maxRowSpan, rowSpan)
    totalSeedCost += seedCost
    maxSeedCost = Math.max(maxSeedCost, seedCost)
    bestPrecision = Math.max(bestPrecision, Math.max(0, Math.min(1, Number(entry?.precision ?? 0) || 0)))
    bestSeparationRatio = Math.max(bestSeparationRatio, Math.max(0, Number(entry?.separationRatio ?? 0) || 0))
    entryCount += 1
  }
  if (entryCount < 1) return null
  const meanPositiveDensity = Math.max(
    0,
    Number(microprobe?.meanPositiveDensity ?? (totalPositiveCount / Math.max(1, maxRowSpan))) ||
      totalPositiveCount / Math.max(1, maxRowSpan),
  )
  const meanPositiveGap = Math.max(
    0,
    Number(microprobe?.meanPositiveGap ?? (maxRowSpan / Math.max(1, totalPositiveCount))) ||
      maxRowSpan / Math.max(1, totalPositiveCount),
  )
  const branchCandidateCount = Math.max(0, Number(microprobe?.branchCandidateCount ?? 0))
  const branchOverlapMass = Math.max(0, Number(microprobe?.branchOverlapMass ?? 0))
  const estimatedCost = Math.max(1, Number(chunk?.estimatedCost ?? totalSeedCost))
  const averageSeedCost = totalSeedCost / Math.max(1, entryCount)
  const densityBias = 1 + Math.min(4, meanPositiveDensity * 768)
  const precisionBias = 1 + bestPrecision * 0.25
  const separationBias = 1 + Math.min(4, bestSeparationRatio) * 0.15
  const widthPenalty = 1 + Math.max(0, chunkWidth - 1) * 1.35
  const meanSeedCostPenalty = 1 + Math.log2(averageSeedCost + 2) / 6
  const maxSeedCostPenalty = 1 + Math.log2(maxSeedCost + 2) / 5
  const bytePenalty = 1 + Math.log2(totalByteLength + 2) / 8
  const rowSpanPenalty = 1 + Math.log2(maxRowSpan + 2) / 8
  const gapPenalty = 1 + Math.log2(meanPositiveGap + 2) / 6
  const branchPenalty =
    1 + Math.min(6, branchCandidateCount * 0.45 + Math.log2(branchOverlapMass + 2) / 6)
  const negativePenalty = 1 + Math.log2(totalNegativeCount + 2) / 4
  const estimatedCostPenalty = 1 + Math.log2(estimatedCost + 2) / 8
  return Number(
    (
      (densityBias * precisionBias * separationBias) /
      (widthPenalty *
        meanSeedCostPenalty *
        maxSeedCostPenalty *
        bytePenalty *
        rowSpanPenalty *
        gapPenalty *
        branchPenalty *
        negativePenalty *
        estimatedCostPenalty)
    ).toFixed(6),
  )
}

const resolveChunkScoreOverride = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(6)) : null
}

const compareScoredParallelChunksByPrimaryScore = ({
  left,
  right,
  primaryScoreKey = "dispatchScore",
}) => {
  const leftPrimary = Number(left?.[primaryScoreKey] ?? Number.NEGATIVE_INFINITY)
  const rightPrimary = Number(right?.[primaryScoreKey] ?? Number.NEGATIVE_INFINITY)
  if (rightPrimary !== leftPrimary) {
    return rightPrimary - leftPrimary
  }
  return compareScoredParallelChunks(left, right)
}

const scoreDeterministicReadyQueueChunks = ({
  chunks,
  seedStats,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  singletonRootExactCompletionProbesByChunkIndex = new Map(),
  singletonRootAdaptiveExactCompletionProbesByChunkIndex = new Map(),
  singletonRootAdaptiveExactCompletionFinalistChunkIndexes = new Set(),
  requireBoundSingletonExactCompletionProbe = false,
  requireBoundSingletonAdaptiveExactCompletionProbe = false,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  return safeChunks.map((chunk) => {
    const useChildLocalRescoring = chunk?.rootSeedMicroshard === true
    const bootstrapScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.bootstrapScoreOverride)
    const steadyDispatchScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.steadyDispatchScoreOverride)
    const bootstrapDispatchScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.bootstrapDispatchScoreOverride)
    const dispatchScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.dispatchScoreOverride)
    const singletonRootCompletionScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.singletonRootCompletionScoreOverride)
    const multiRootCompletionScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.multiRootCompletionScoreOverride)
    const firstWaveDispatchScoreOverride = useChildLocalRescoring
      ? null
      : resolveChunkScoreOverride(chunk?.firstWaveDispatchScoreOverride)
    const bootstrapScore =
      bootstrapScoreOverride ??
      Number(
        computeChunkBootstrapScore({
          chunk,
          seedStats,
        }).toFixed(6),
      )
    const steadyDispatchScore =
      steadyDispatchScoreOverride ??
      computeChunkSteadyDispatchScore({
        chunk,
        seedStats,
      })
    const bootstrapDispatchScore =
      bootstrapDispatchScoreOverride ??
      computeChunkBootstrapDispatchScore({
        chunk,
        bootstrapScore,
        steadyDispatchScore,
      })
    const headMicroprobe =
      (useChildLocalRescoring ? null : chunk?.headMicroprobeOverride) ??
      (chunkHeadMicroprobesByChunkIndex instanceof Map
        ? chunkHeadMicroprobesByChunkIndex.get(Number(chunk?.chunkIndex ?? -1)) ?? null
        : null)
    const headMicroprobeDispatchScore = computeChunkHeadMicroprobeDispatchScore({
      bootstrapDispatchScore,
      microprobe: headMicroprobe,
    })
    const singletonRootCompletionScore =
      singletonRootCompletionScoreOverride ??
      computeChunkSingletonRootCompletionScore({
        chunk,
        seedStats,
        microprobe: headMicroprobe,
      })
    const boundSingletonExactCompletionProbe =
      chunk?.firstWaveCompletionTarget === true && isSingletonRootChunk(chunk)
        ? singletonRootExactCompletionProbesByChunkIndex instanceof Map
          ? singletonRootExactCompletionProbesByChunkIndex.get(Number(chunk?.chunkIndex ?? -1)) ?? null
          : null
        : null
    const boundSingletonAdaptiveExactCompletionProbe =
      chunk?.firstWaveCompletionTarget === true && isSingletonRootChunk(chunk)
        ? singletonRootAdaptiveExactCompletionProbesByChunkIndex instanceof Map
          ? singletonRootAdaptiveExactCompletionProbesByChunkIndex.get(Number(chunk?.chunkIndex ?? -1)) ?? null
          : null
        : null
    const boundSingletonAdaptiveExactCompletionProbeFinalist =
      chunk?.firstWaveCompletionTarget === true && isSingletonRootChunk(chunk)
        ? singletonRootAdaptiveExactCompletionFinalistChunkIndexes instanceof Set
          ? singletonRootAdaptiveExactCompletionFinalistChunkIndexes.has(
              Number(chunk?.chunkIndex ?? -1),
            )
          : false
        : false
    if (
      requireBoundSingletonExactCompletionProbe === true &&
      chunk?.firstWaveCompletionTarget === true &&
      isSingletonRootChunk(chunk) &&
      !boundSingletonExactCompletionProbe
    ) {
      throw new Error(
        `Parallel indexed miner requires exact completion probe for bound singleton chunkIndex=${Number(chunk?.chunkIndex ?? -1)}`,
      )
    }
    if (
      requireBoundSingletonAdaptiveExactCompletionProbe === true &&
      boundSingletonAdaptiveExactCompletionProbeFinalist === true &&
      !boundSingletonAdaptiveExactCompletionProbe
    ) {
      throw new Error(
        `Parallel indexed miner requires adaptive exact completion probe for finalist singleton chunkIndex=${Number(chunk?.chunkIndex ?? -1)}`,
      )
    }
    const readyQueueScoreCacheKey =
      readyQueueScoreCache instanceof Map
        ? buildDeterministicReadyQueueScoreCacheKey({
            chunk,
            headMicroprobe,
            singletonRootExactCompletionProbe: boundSingletonExactCompletionProbe,
            singletonRootAdaptiveExactCompletionProbe: boundSingletonAdaptiveExactCompletionProbe,
            singletonRootAdaptiveExactCompletionProbeFinalist:
              boundSingletonAdaptiveExactCompletionProbeFinalist,
            requireBoundSingletonExactCompletionProbe,
            requireBoundSingletonAdaptiveExactCompletionProbe,
          })
        : null
    if (readyQueueScoreCacheKey && readyQueueScoreCache.has(readyQueueScoreCacheKey)) {
      return {
        ...chunk,
        ...readyQueueScoreCache.get(readyQueueScoreCacheKey),
      }
    }
    incrementPlanningCounter(planningReuseStats, "rescoredChunkCount", 1)
    const singletonRootExactCompletionScore = boundSingletonExactCompletionProbe
      ? Math.max(0, Number(boundSingletonExactCompletionProbe?.probeScore ?? 0))
      : null
    const singletonRootAdaptiveExactCompletionScore =
      boundSingletonAdaptiveExactCompletionProbe
        ? Math.max(0, Number(boundSingletonAdaptiveExactCompletionProbe?.probeScore ?? 0))
        : null
    const multiRootCompletionScore =
      multiRootCompletionScoreOverride ??
      computeChunkMultiRootCompletionScore({
        chunk,
        seedStats,
        microprobe: headMicroprobe,
      })
    const dispatchScore = dispatchScoreOverride ?? headMicroprobeDispatchScore
    const firstWaveDispatchScore = useChildLocalRescoring
      ? singletonRootAdaptiveExactCompletionScore ??
        singletonRootExactCompletionScore ??
        singletonRootCompletionScore ??
        multiRootCompletionScore ??
        dispatchScore
      : firstWaveDispatchScoreOverride ??
        (singletonRootAdaptiveExactCompletionScore ??
          singletonRootExactCompletionScore ??
          singletonRootCompletionScore ??
          multiRootCompletionScore ??
          dispatchScore)
    const scoredChunk = {
      ...chunk,
      bootstrapScore,
      steadyDispatchScore,
      bootstrapDispatchScore,
      headMicroprobeDispatchScore,
      headMicroprobe,
      singletonRootExactCompletionProbe: boundSingletonExactCompletionProbe,
      singletonRootAdaptiveExactCompletionProbe: boundSingletonAdaptiveExactCompletionProbe,
      singletonRootAdaptiveExactCompletionProbeFinalist:
        boundSingletonAdaptiveExactCompletionProbeFinalist,
      singletonRootExactCompletionScore,
      singletonRootAdaptiveExactCompletionScore,
      singletonRootCompletionScore,
      multiRootCompletionScore,
      firstWaveDispatchScore,
      dispatchScore,
    }
    if (readyQueueScoreCacheKey) {
      readyQueueScoreCache.set(readyQueueScoreCacheKey, {
        bootstrapScore,
        steadyDispatchScore,
        bootstrapDispatchScore,
        headMicroprobeDispatchScore,
        headMicroprobe,
        singletonRootExactCompletionProbe: boundSingletonExactCompletionProbe,
        singletonRootAdaptiveExactCompletionProbe: boundSingletonAdaptiveExactCompletionProbe,
        singletonRootAdaptiveExactCompletionProbeFinalist:
          boundSingletonAdaptiveExactCompletionProbeFinalist,
        singletonRootExactCompletionScore,
        singletonRootAdaptiveExactCompletionScore,
        singletonRootCompletionScore,
        multiRootCompletionScore,
        firstWaveDispatchScore,
        dispatchScore,
      })
    }
    return scoredChunk
  })
}

const selectNextQuotaAwareChunk = ({
  headChunks,
  tailChunks,
  dispatchBandIndex,
  initialDispatchBandSize,
  bootstrapHeadLaunchQuota,
  launchedBootstrapHeadChunkCount,
  primaryScoreKey = "dispatchScore",
}) => {
  const remainingBandSlots = Math.max(0, initialDispatchBandSize - dispatchBandIndex)
  const remainingBootstrapHeadQuota = Math.max(
    0,
    bootstrapHeadLaunchQuota - launchedBootstrapHeadChunkCount,
  )
  if (remainingBootstrapHeadQuota >= remainingBandSlots && headChunks.length > 0) {
    return headChunks.shift() ?? null
  }
  if (headChunks.length < 1) return tailChunks.shift() ?? null
  if (tailChunks.length < 1) return headChunks.shift() ?? null
  return compareScoredParallelChunksByPrimaryScore({
    left: headChunks[0],
    right: tailChunks[0],
    primaryScoreKey,
  }) <= 0
    ? headChunks.shift() ?? null
    : tailChunks.shift() ?? null
}

const appendQuotaAwareDispatchBand = ({
  readyQueue,
  headChunks,
  tailChunks,
  dispatchBandSize,
  bootstrapHeadLaunchQuota,
  primaryScoreKey = "dispatchScore",
}) => {
  const safeDispatchBandSize = Math.max(0, Math.floor(Number(dispatchBandSize) || 0))
  const safeBootstrapHeadLaunchQuota = Math.max(
    0,
    Math.floor(Number(bootstrapHeadLaunchQuota) || 0),
  )
  let launchedBootstrapHeadChunkCount = 0
  for (let dispatchBandIndex = 0; dispatchBandIndex < safeDispatchBandSize; dispatchBandIndex += 1) {
    const nextChunk = selectNextQuotaAwareChunk({
      headChunks,
      tailChunks,
      dispatchBandIndex,
      initialDispatchBandSize: safeDispatchBandSize,
      bootstrapHeadLaunchQuota: safeBootstrapHeadLaunchQuota,
      launchedBootstrapHeadChunkCount,
      primaryScoreKey,
    })
    if (!nextChunk) break
    if (nextChunk.bootstrapHead === true) {
      launchedBootstrapHeadChunkCount += 1
    }
    readyQueue.push(nextChunk)
  }
  return launchedBootstrapHeadChunkCount
}

export const buildDeterministicReadyQueue = ({
  chunks,
  seedStats,
  workerCount = 2,
  bootstrapHeadLaunchQuota = null,
  bootstrapHeadFirstWaveQuota = null,
  initialDispatchBandMultiplier = 2,
  chunkHeadMicroprobesByChunkIndex = new Map(),
  singletonRootExactCompletionProbesByChunkIndex = new Map(),
  singletonRootAdaptiveExactCompletionProbesByChunkIndex = new Map(),
  singletonRootAdaptiveExactCompletionFinalistChunkIndexes = new Set(),
  requireBoundSingletonExactCompletionProbe = false,
  requireBoundSingletonAdaptiveExactCompletionProbe = false,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  incrementPlanningCounter(planningReuseStats, "readyQueueRebuildCount", 1)
  const scoredChunks = scoreDeterministicReadyQueueChunks({
    chunks,
    seedStats,
    chunkHeadMicroprobesByChunkIndex,
    singletonRootExactCompletionProbesByChunkIndex,
    singletonRootAdaptiveExactCompletionProbesByChunkIndex,
    singletonRootAdaptiveExactCompletionFinalistChunkIndexes,
    requireBoundSingletonExactCompletionProbe,
    requireBoundSingletonAdaptiveExactCompletionProbe,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const headChunks = scoredChunks
    .filter((chunk) => chunk.bootstrapHead === true)
    .sort(compareScoredParallelChunks)
  const tailChunks = scoredChunks
    .filter((chunk) => chunk.bootstrapHead !== true)
    .sort(compareScoredParallelChunks)
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const resolvedBootstrapHeadLaunchQuota = Math.max(
    0,
    Math.min(
      headChunks.length,
      hasExplicitIntegerValue(bootstrapHeadLaunchQuota)
        ? Number(bootstrapHeadLaunchQuota)
        : safeWorkerCount,
    ),
  )
  const resolvedBootstrapHeadFirstWaveQuota = Math.max(
    0,
    Math.min(
      headChunks.length,
      resolvedBootstrapHeadLaunchQuota,
      hasExplicitIntegerValue(bootstrapHeadFirstWaveQuota)
        ? Number(bootstrapHeadFirstWaveQuota)
        : resolvedBootstrapHeadLaunchQuota > 0
          ? 1
          : 0,
    ),
  )
  // Completion-target descendants still get an explicit score boost, but they must not
  // structurally exclude higher-priority non-target chunks from winning the first wave.
  const firstWaveCandidateChunks = scoredChunks
  const firstWaveDispatchBandSize = Math.min(firstWaveCandidateChunks.length, safeWorkerCount)
  const initialDispatchBandSize = Math.min(
    scoredChunks.length,
    Math.max(
      resolvedBootstrapHeadLaunchQuota,
      safeWorkerCount * Math.max(1, Math.floor(Number(initialDispatchBandMultiplier) || 1)),
    ),
  )
  const firstWaveHeadChunks = firstWaveCandidateChunks
    .filter((chunk) => chunk.bootstrapHead === true)
    .sort((left, right) =>
      compareScoredParallelChunksByPrimaryScore({
        left,
        right,
        primaryScoreKey: "firstWaveDispatchScore",
      }),
    )
  const firstWaveTailChunks = firstWaveCandidateChunks
    .filter((chunk) => chunk.bootstrapHead !== true)
    .sort((left, right) =>
      compareScoredParallelChunksByPrimaryScore({
        left,
        right,
        primaryScoreKey: "firstWaveDispatchScore",
      }),
    )
  const firstWaveReadyQueue = []
  const launchedBootstrapHeadInFirstWave = appendQuotaAwareDispatchBand({
    readyQueue: firstWaveReadyQueue,
    headChunks: firstWaveHeadChunks,
    tailChunks: firstWaveTailChunks,
    dispatchBandSize: firstWaveDispatchBandSize,
    bootstrapHeadLaunchQuota: Math.min(
      resolvedBootstrapHeadFirstWaveQuota,
      firstWaveHeadChunks.length,
    ),
    primaryScoreKey: "firstWaveDispatchScore",
  })
  const launchedChunkIndexes = new Set(
    firstWaveReadyQueue
      .map((chunk) => Number(chunk?.chunkIndex ?? -1))
      .filter((chunkIndex) => chunkIndex >= 0),
  )
  const remainingHeadChunks = headChunks.filter(
    (chunk) => !launchedChunkIndexes.has(Number(chunk?.chunkIndex ?? -1)),
  )
  const remainingTailChunks = tailChunks.filter(
    (chunk) => !launchedChunkIndexes.has(Number(chunk?.chunkIndex ?? -1)),
  )
  const readyQueue = [...firstWaveReadyQueue]
  appendQuotaAwareDispatchBand({
    readyQueue,
    headChunks: remainingHeadChunks,
    tailChunks: remainingTailChunks,
    dispatchBandSize: Math.max(0, initialDispatchBandSize - firstWaveDispatchBandSize),
    bootstrapHeadLaunchQuota: Math.max(
      0,
      resolvedBootstrapHeadLaunchQuota - launchedBootstrapHeadInFirstWave,
    ),
  })
  readyQueue.push(
    ...remainingHeadChunks
      .concat(remainingTailChunks)
      .sort(compareScoredParallelChunks),
  )
  return readyQueue.map((chunk, dispatchPriorityIndex) => ({
    ...chunk,
    dispatchPriorityIndex,
  }))
}

const buildChunkHeadMicroprobeSeedIndexes = ({ chunk }) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  const indexes = []
  for (let index = start; index < Math.min(end, start + 2); index += 1) {
    indexes.push(index)
  }
  if (end - start > 4) {
    indexes.push(Math.floor((start + end - 1) / 2))
  }
  return Array.from(new Set(indexes)).sort((left, right) => left - right)
}

const buildChunkHeadMicroprobeFrontier = ({
  chunks,
  seedStats,
  workerCount,
  bootstrapHeadLaunchQuota = null,
  bootstrapHeadFirstWaveQuota = null,
  frontierDispatchBandMultiplier = 2,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const provisionalReadyQueue = buildDeterministicReadyQueue({
    chunks,
    seedStats,
    workerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    readyQueueScoreCache,
    planningReuseStats,
  })
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const frontierDispatchBandSize = Math.min(
    provisionalReadyQueue.length,
    Math.max(
      safeWorkerCount,
      safeWorkerCount * Math.max(1, Math.floor(Number(frontierDispatchBandMultiplier) || 1)),
    ),
  )
  return provisionalReadyQueue
    .slice(0, frontierDispatchBandSize)
    .sort((left, right) => Number(left?.chunkIndex ?? 0) - Number(right?.chunkIndex ?? 0))
}

const loadPlanningPositivePostingValues = async ({
  postingsHandle,
  dictionaryEntry,
  kind = "positive",
}) => {
  const normalizedKind = kind === "negative" ? "negative" : "positive"
  const count = Math.max(0, Number(dictionaryEntry?.[`${normalizedKind}Count`] ?? 0))
  const byteLength = Math.max(0, Number(dictionaryEntry?.[`${normalizedKind}ByteLength`] ?? 0))
  if (count < 1 || byteLength < 1) {
    return new Uint32Array()
  }
  return readPerfectPrototypeDeltaPostingsFromFile({
    fileHandle: postingsHandle,
    offset: Number(dictionaryEntry?.[`${normalizedKind}Offset`] ?? 0),
    byteLength,
    count,
  })
}

const createParallelPlanningPostingValueCache = ({
  postingsHandle,
  seedStats,
  rowUniverseSize = null,
}) => {
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const positiveCache = new Map()
  const negativeCache = new Map()
  const positiveRowsetCache = new Map()
  const negativeRowsetCache = new Map()
  const getPostingValues = async (seedIndex, kind = "positive") => {
    const resolvedSeedIndex = Math.max(0, Math.floor(Number(seedIndex) || 0))
    const cache = kind === "negative" ? negativeCache : positiveCache
    const cached = cache.get(resolvedSeedIndex)
    if (cached) return cached
    const dictionaryEntry = safeSeedStats[resolvedSeedIndex]
    if (!dictionaryEntry) {
      throw new Error(
        `Parallel indexed miner planning cache requires seed entry at seedIndex=${resolvedSeedIndex}`,
      )
    }
    const values = await loadPlanningPositivePostingValues({
      postingsHandle,
      dictionaryEntry,
      kind,
    })
    cache.set(resolvedSeedIndex, values)
    return values
  }
  const getPostingRowset = async (seedIndex, kind = "positive") => {
    const resolvedSeedIndex = Math.max(0, Math.floor(Number(seedIndex) || 0))
    const rowsetCache = kind === "negative" ? negativeRowsetCache : positiveRowsetCache
    const cached = rowsetCache.get(resolvedSeedIndex)
    if (cached) return cached
    const dictionaryEntry = safeSeedStats[resolvedSeedIndex]
    if (!dictionaryEntry) {
      throw new Error(
        `Parallel indexed miner planning cache requires seed entry at seedIndex=${resolvedSeedIndex}`,
      )
    }
    const normalizedKind = kind === "negative" ? "negative" : "positive"
    const count = Math.max(0, Number(dictionaryEntry?.[`${normalizedKind}Count`] ?? 0))
    const byteLength = Math.max(0, Number(dictionaryEntry?.[`${normalizedKind}ByteLength`] ?? 0))
    let rowset = null
    if (
      count > 0 &&
      byteLength > 0 &&
      Number.isInteger(rowUniverseSize) &&
      rowUniverseSize > 0 &&
      shouldPreferDensePerfectPrototypeRowset({
        count,
        universeSize: rowUniverseSize,
        allowDense: true,
      })
    ) {
      const decoded = decodePerfectPrototypeDeltaPostingsToBitset({
        buffer: await readPerfectPrototypePostingBufferFromFile({
          fileHandle: postingsHandle,
          offset: Number(dictionaryEntry?.[`${normalizedKind}Offset`] ?? 0),
          byteLength,
        }),
        count,
        universeSize: rowUniverseSize,
      })
      rowset = createPerfectPrototypeBitsetRowsetFromWords(decoded)
    } else {
      rowset = createPerfectPrototypeRowset({
        values: await getPostingValues(resolvedSeedIndex, normalizedKind),
        universeSize:
          Number.isInteger(rowUniverseSize) && rowUniverseSize > 0 ? rowUniverseSize : null,
        allowDense: true,
      })
    }
    rowsetCache.set(resolvedSeedIndex, rowset)
    return rowset
  }
  return {
    getPositivePostingValues: async (seedIndex) => getPostingValues(seedIndex, "positive"),
    getNegativePostingValues: async (seedIndex) => getPostingValues(seedIndex, "negative"),
    getPositivePostingRowset: async (seedIndex) => getPostingRowset(seedIndex, "positive"),
    getNegativePostingRowset: async (seedIndex) => getPostingRowset(seedIndex, "negative"),
  }
}

const summarizeChunkHeadMicroprobe = async ({
  chunk,
  seedStats,
  postingsHandle,
  minHitCount,
  neighborWindow = 4,
  postingValueCache = null,
}) => {
  const rootIndexes = buildChunkHeadMicroprobeSeedIndexes({ chunk })
  const cache =
    postingValueCache ??
    createParallelPlanningPostingValueCache({
      postingsHandle,
      seedStats,
    })
  const getPositivePostingValues = async (seedIndex) =>
    cache.getPositivePostingValues(seedIndex)
  let sampleExactByteLength = 0
  let totalPositiveDensity = 0
  let totalPositiveGap = 0
  let sampledRootCount = 0
  let branchCandidateCount = 0
  let branchOverlapMass = 0
  for (const rootIndex of rootIndexes) {
    const rootEntry = seedStats[rootIndex]
    const rootValues = await getPositivePostingValues(rootIndex)
    const rootCount = Number(rootValues?.length ?? 0)
    if (rootCount < 1) continue
    const rootSpan = computePostingRowSpan({
      firstRowIdx: rootValues[0],
      lastRowIdx: rootValues[rootCount - 1],
      fallbackCount: rootCount,
    })
    const rootDensity = rootCount / Math.max(1, rootSpan)
    const rootGap = computeAveragePostingGap(rootValues)
    totalPositiveDensity += rootDensity
    totalPositiveGap += rootGap
    sampleExactByteLength += Math.max(
      0,
      Number(rootEntry?.positiveByteLength ?? 0) + Number(rootEntry?.negativeByteLength ?? 0),
    )
    sampledRootCount += 1
    const neighborEnd = Math.min(
      Math.max(rootIndex + 1, Number(chunk?.end ?? rootIndex)),
      rootIndex + 1 + Math.max(1, Math.floor(Number(neighborWindow) || 1)),
    )
    for (let neighborIndex = rootIndex + 1; neighborIndex < neighborEnd; neighborIndex += 1) {
      const overlapCount = intersectSortedUint32ArraysCount(
        rootValues,
        await getPositivePostingValues(neighborIndex),
      )
      if (overlapCount >= Math.max(1, Math.floor(Number(minHitCount) || 1))) {
        branchCandidateCount += 1
      }
      branchOverlapMass += overlapCount
    }
  }
  return {
    sampledRootCount,
    meanPositiveDensity:
      sampledRootCount > 0 ? Number((totalPositiveDensity / sampledRootCount).toFixed(8)) : 0,
    meanPositiveGap:
      sampledRootCount > 0 ? Number((totalPositiveGap / sampledRootCount).toFixed(6)) : 0,
    sampleExactByteLength,
    branchCandidateCount,
    branchOverlapMass,
  }
}

const loadChunkHeadMicroprobesByChunkIndex = async ({
  chunks,
  seedStats,
  tokenPostingsBinPath,
  workerCount,
  minHitCount,
  bootstrapHeadLaunchQuota = null,
  bootstrapHeadFirstWaveQuota = null,
  frontierDispatchBandMultiplier = 2,
  postingsHandle = null,
  postingValueCache = null,
  microprobeCacheByFingerprint = null,
  readyQueueScoreCache = null,
  planningReuseStats = null,
}) => {
  const frontierChunks = buildChunkHeadMicroprobeFrontier({
    chunks,
    seedStats,
    workerCount,
    bootstrapHeadLaunchQuota,
    bootstrapHeadFirstWaveQuota,
    frontierDispatchBandMultiplier,
    readyQueueScoreCache,
    planningReuseStats,
  })
  if (frontierChunks.length < 1) return new Map()
  const ownsPostingsHandle = postingsHandle == null
  const resolvedPostingsHandle =
    postingsHandle ?? (await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r"))
  const resolvedPostingValueCache =
    postingValueCache ??
    createParallelPlanningPostingValueCache({
      postingsHandle: resolvedPostingsHandle,
      seedStats,
    })
  try {
    const byChunkIndex = new Map()
    for (const chunk of frontierChunks) {
      const chunkIndex = Number(chunk?.chunkIndex ?? -1)
      const microprobeCacheKey = buildPlanningMicroprobeCacheKey({
        chunk,
        minHitCount,
      })
      let microprobe =
        microprobeCacheByFingerprint instanceof Map
          ? microprobeCacheByFingerprint.get(microprobeCacheKey) ?? null
          : null
      if (microprobe) {
        incrementPlanningCounter(planningReuseStats, "microprobeReuseCount", 1)
      } else {
        microprobe = await summarizeChunkHeadMicroprobe({
          chunk,
          seedStats,
          postingsHandle: resolvedPostingsHandle,
          minHitCount,
          postingValueCache: resolvedPostingValueCache,
        })
        if (microprobeCacheByFingerprint instanceof Map) {
          microprobeCacheByFingerprint.set(microprobeCacheKey, microprobe)
        }
      }
      byChunkIndex.set(chunkIndex, microprobe)
    }
    return byChunkIndex
  } finally {
    if (ownsPostingsHandle) {
      await resolvedPostingsHandle.close()
    }
  }
}

const computeDeterministicPlannedWaveCount = ({ chunkCount, workerCount }) => {
  const safeChunkCount = Math.max(0, Math.floor(Number(chunkCount) || 0))
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  return safeChunkCount < 1 ? 0 : Math.ceil(safeChunkCount / safeWorkerCount)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const PARALLEL_ACTIVE_PROGRESS_POLL_INTERVAL_MS = 1000
const PARALLEL_BUDGET_REQUEST_FASTPATH_INTERVAL_MS = 25
const PARALLEL_BUDGET_REQUEST_FASTPATH_IDLE_INTERVAL_MS = 250
const PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS = 250
const PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_SLOW_INTERVAL_MS = Math.max(
  PARALLEL_ACTIVE_PROGRESS_POLL_INTERVAL_MS,
  PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS,
)
const PARALLEL_ACTIVE_CHUNK_COMPLETION_PROGRESS_STALE_MS = Math.max(
  LIVE_SEARCH_PROGRESS_CHECKPOINT_MS + PARALLEL_ACTIVE_PROGRESS_POLL_INTERVAL_MS * 2,
  PARALLEL_ACTIVE_PROGRESS_POLL_INTERVAL_MS * 2,
)
const PARALLEL_ACTIVE_RECLAIM_PROGRESS_MARGIN_STATES = LIVE_SEARCH_PROGRESS_STATE_INTERVAL + 1
const PARALLEL_ACTIVE_CHUNK_COMPLETION_NEAR_COMPLETION_FRACTION = 0.98
const PARALLEL_ACTIVE_CHUNK_COMPLETION_NEAR_COMPLETION_ETA_SECONDS = 2
const PARALLEL_EXTERNAL_KTH_HIT_FLOOR_POLL_MS = 1000
const PARALLEL_EXTERNAL_KTH_HIT_FLOOR_STATE_INTERVAL = 256
const PARALLEL_EXTERNAL_BUDGET_POLL_MS = 1000
const PARALLEL_EXTERNAL_BUDGET_DECISION_POLL_MS = 25
const PARALLEL_EXTERNAL_BUDGET_STATE_INTERVAL = 256
const PARALLEL_CHUNK_GUARD_BAND_SEARCH_STATES = 128
const PARALLEL_BUDGET_REQUEST_HEADROOM_STATES = 4096
const PARALLEL_BUDGET_TOPUP_TRANCHE_SEARCH_STATES = 8192
const PARALLEL_INITIAL_LEASE_TRANCHE_COUNT = 2
const PARALLEL_MIN_INITIAL_ACTIVE_CHUNK_SEARCH_STATES = 100000
const PARALLEL_BUDGET_REQUEST_WAIT_MS = 10000
const PARALLEL_ARTIFACT_MERGE_BUDGET_SERVICE_INTERVAL_MS = 100
const PARALLEL_LIVE_BUDGET_FILENAME = "live_budget.json"
const PARALLEL_BUDGET_REQUEST_FILENAME = "budget_request.json"
const PARALLEL_BUDGET_DECISION_FILENAME = "budget_decision.json"
const PARALLEL_BUDGET_COMMIT_FILENAME = "budget_commit.json"

export const allocateDeterministicChunkSearchBudgets = ({ chunks, totalBudget }) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeTotalBudget = Math.max(0, Math.floor(Number(totalBudget) || 0))
  if (safeChunks.length < 1) return []
  if (safeTotalBudget < safeChunks.length) {
    throw new Error(
      [
        "Parallel indexed miner cannot lease at least one search state per remaining chunk.",
        `remainingChunkCount=${safeChunks.length}`,
        `remainingGlobalSearchBudget=${safeTotalBudget}`,
      ].join("\n"),
    )
  }
  const weightedChunks = safeChunks.map((chunk) => ({
    ...chunk,
    estimatedCost: Math.max(1, Number(chunk?.estimatedCost ?? 0)),
  }))
  const baseBudget = 1
  const maxGuardBandPerChunk = Math.max(
    0,
    Math.floor((safeTotalBudget - weightedChunks.length) / weightedChunks.length),
  )
  const guardBandPerChunk = Math.min(
    PARALLEL_CHUNK_GUARD_BAND_SEARCH_STATES,
    maxGuardBandPerChunk,
  )
  const reservedGuardBandBudget = guardBandPerChunk * weightedChunks.length
  const remainingBudget = safeTotalBudget - weightedChunks.length - reservedGuardBandBudget
  const totalEstimatedCost = weightedChunks.reduce(
    (sum, chunk) => sum + Number(chunk?.estimatedCost ?? 0),
    0,
  )
  const allocations = weightedChunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    baseAllocatedMaxSearchStates: baseBudget,
    guardBandAllocatedSearchStates: guardBandPerChunk,
    allocatedMaxSearchStates: baseBudget + guardBandPerChunk,
    remainder: 0,
  }))
  if (remainingBudget > 0) {
    const safeTotalEstimatedCost = totalEstimatedCost > 0 ? totalEstimatedCost : weightedChunks.length
    let assignedRemainderBudget = 0
    for (const allocation of allocations) {
      const chunk = weightedChunks.find((entry) => entry.chunkIndex === allocation.chunkIndex)
      const rawShare = (remainingBudget * Number(chunk?.estimatedCost ?? 1)) / safeTotalEstimatedCost
      const extraBudget = Math.floor(rawShare)
      allocation.baseAllocatedMaxSearchStates += extraBudget
      allocation.allocatedMaxSearchStates += extraBudget
      allocation.remainder = rawShare - extraBudget
      assignedRemainderBudget += extraBudget
    }
    let leftoverBudget = remainingBudget - assignedRemainderBudget
    allocations
      .slice()
      .sort((left, right) => {
        if (right.remainder !== left.remainder) {
          return right.remainder - left.remainder
        }
        return left.chunkIndex - right.chunkIndex
      })
      .forEach((allocation) => {
        if (leftoverBudget < 1) return
        allocation.baseAllocatedMaxSearchStates += 1
        allocation.allocatedMaxSearchStates += 1
        leftoverBudget -= 1
      })
  }
  return allocations.map(({ remainder, ...rest }) => rest)
}

export const allocateDeterministicChunkSearchBudgetPlanByChunkIndex = ({
  chunks,
  totalBudget,
}) =>
  new Map(
    allocateDeterministicChunkSearchBudgets({
      chunks,
      totalBudget,
    }).map((budgetPlan) => [Number(budgetPlan?.chunkIndex ?? -1), budgetPlan]),
  )

const resolveParallelInitialChunkLeaseBudgetPlan = ({
  plannedBaseAllocatedMaxSearchStates = 1,
  plannedGuardBandAllocatedSearchStates = 0,
  plannedAllocatedMaxSearchStates = 1,
  externalBudgetRequestHeadroomStates = PARALLEL_BUDGET_REQUEST_HEADROOM_STATES,
  externalBudgetRequestSearchStates = PARALLEL_BUDGET_TOPUP_TRANCHE_SEARCH_STATES,
}) => {
  const normalizedGuardBand = Math.max(
    0,
    Math.floor(Number(plannedGuardBandAllocatedSearchStates) || 0),
  )
  const normalizedPlannedAllocated = Math.max(
    1,
    Math.floor(Number(plannedAllocatedMaxSearchStates) || 0),
  )
  const normalizedPlannedBase = Math.max(
    1,
    Math.floor(Number(plannedBaseAllocatedMaxSearchStates) || 0),
  )
  if (normalizedPlannedBase + normalizedGuardBand !== normalizedPlannedAllocated) {
    throw new Error(
      [
        "Parallel indexed miner initial lease resolver requires planned budget consistency.",
        `plannedBaseAllocatedMaxSearchStates=${normalizedPlannedBase}`,
        `plannedGuardBandAllocatedSearchStates=${normalizedGuardBand}`,
        `plannedAllocatedMaxSearchStates=${normalizedPlannedAllocated}`,
      ].join("\n"),
    )
  }
  const normalizedHeadroom = Math.max(
    1,
    Math.floor(Number(externalBudgetRequestHeadroomStates) || 0),
  )
  const normalizedTopupTranche = Math.max(
    1,
    Math.floor(Number(externalBudgetRequestSearchStates) || 0),
  )
  const initialLeaseCap = Math.max(
    normalizedGuardBand + 1,
    normalizedGuardBand +
      normalizedHeadroom +
      normalizedTopupTranche * PARALLEL_INITIAL_LEASE_TRANCHE_COUNT,
  )
  const initialAllocatedMaxSearchStates = Math.min(
    normalizedPlannedAllocated,
    initialLeaseCap,
  )
  const initialBaseAllocatedMaxSearchStates = Math.max(
    1,
    initialAllocatedMaxSearchStates - normalizedGuardBand,
  )
  return {
    plannedBaseAllocatedMaxSearchStates: normalizedPlannedBase,
    plannedGuardBandAllocatedSearchStates: normalizedGuardBand,
    plannedAllocatedMaxSearchStates: normalizedPlannedAllocated,
    initialBaseAllocatedMaxSearchStates,
    initialGuardBandAllocatedSearchStates: normalizedGuardBand,
    initialAllocatedMaxSearchStates:
      initialBaseAllocatedMaxSearchStates + normalizedGuardBand,
  }
}

const resolveParallelMaxObservedActiveSlackSearchBudget = ({
  activeChunkRunsCount = 0,
  externalBudgetRequestHeadroomStates = PARALLEL_BUDGET_REQUEST_HEADROOM_STATES,
  externalBudgetRequestSearchStates = PARALLEL_BUDGET_TOPUP_TRANCHE_SEARCH_STATES,
}) => {
  const normalizedActiveChunkRunsCount = Math.max(
    1,
    Math.floor(Number(activeChunkRunsCount) || 0),
  )
  const normalizedHeadroomStates = Math.max(
    1,
    Math.floor(Number(externalBudgetRequestHeadroomStates) || 0),
  )
  const normalizedTrancheStates = Math.max(
    1,
    Math.floor(Number(externalBudgetRequestSearchStates) || 0),
  )
  return normalizedActiveChunkRunsCount * (normalizedHeadroomStates + normalizedTrancheStates)
}

const resolveParallelInitialActiveChunkLimit = ({
  workerCount = 1,
  maxSearchStates = 0,
  firstChunkCompletionElapsedMs = null,
}) => {
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  if (Number.isFinite(Number(firstChunkCompletionElapsedMs)) && Number(firstChunkCompletionElapsedMs) >= 0) {
    return safeWorkerCount
  }
  const safeMaxSearchStates = Math.max(1, Math.floor(Number(maxSearchStates) || 0))
  const provisionalLimit = Math.max(
    1,
    Math.floor(safeMaxSearchStates / PARALLEL_MIN_INITIAL_ACTIVE_CHUNK_SEARCH_STATES),
  )
  return Math.max(1, Math.min(safeWorkerCount, provisionalLimit))
}

export const classifyParallelBudgetRecoveryWindow = ({
  remainingBudgetHeadroom = 0,
  completedUnreclaimedSearchBudget = 0,
  activeSiblingReclaimableSearchBudget = 0,
  requiredDelta = 0,
  fallbackReason = "awaiting_commit_budget_service",
}) => {
  const normalizedRemainingBudgetHeadroom = Math.max(
    0,
    Math.floor(Number(remainingBudgetHeadroom) || 0),
  )
  const normalizedCompletedUnreclaimedSearchBudget = Math.max(
    0,
    Math.floor(Number(completedUnreclaimedSearchBudget) || 0),
  )
  const normalizedActiveSiblingReclaimableSearchBudget = Math.max(
    0,
    Math.floor(Number(activeSiblingReclaimableSearchBudget) || 0),
  )
  const normalizedRequiredDelta = Math.max(0, Math.floor(Number(requiredDelta) || 0))
  const totalRecoverableSearchBudget =
    normalizedCompletedUnreclaimedSearchBudget + normalizedActiveSiblingReclaimableSearchBudget
  let reason = String(fallbackReason ?? "").trim() || "awaiting_commit_budget_service"
  if (
    normalizedCompletedUnreclaimedSearchBudget > 0 &&
    normalizedActiveSiblingReclaimableSearchBudget > 0
  ) {
    reason = "awaiting_combined_chunk_reclaim"
  } else if (normalizedCompletedUnreclaimedSearchBudget > 0) {
    reason = "awaiting_completed_chunk_reclaim"
  } else if (normalizedActiveSiblingReclaimableSearchBudget > 0) {
    reason = "awaiting_active_chunk_reclaim"
  }
  return {
    remainingBudgetHeadroom: normalizedRemainingBudgetHeadroom,
    completedUnreclaimedSearchBudget: normalizedCompletedUnreclaimedSearchBudget,
    activeSiblingReclaimableSearchBudget: normalizedActiveSiblingReclaimableSearchBudget,
    totalRecoverableSearchBudget,
    requiredDelta: normalizedRequiredDelta,
    canRecover:
      normalizedRemainingBudgetHeadroom + totalRecoverableSearchBudget >= normalizedRequiredDelta,
    reason,
  }
}

export const resolveParallelChunkRunObservedBudgetState = ({
  chunkRun = null,
  progressJson = null,
  summaryJson = null,
  budgetRequest = null,
  committedAllocatedMaxSearchStates = null,
}) => {
  const resolvedCommittedAllocatedMaxSearchStates = Math.max(
    0,
    Math.floor(
      Number(
        committedAllocatedMaxSearchStates ??
          chunkRun?.effectiveAllocatedMaxSearchStates ??
          chunkRun?.allocatedMaxSearchStates ??
          0,
      ) || 0,
    ),
  )
  const resolvedExploredStates = Math.max(
    0,
    Math.floor(Number(progressJson?.exploredStates ?? 0) || 0),
    Math.floor(Number(summaryJson?.exploredStates ?? 0) || 0),
    Math.floor(Number(budgetRequest?.exploredStatesAtRequest ?? 0) || 0),
  )
  const resolvedEffectiveAllocatedMaxSearchStates = Math.max(
    resolvedCommittedAllocatedMaxSearchStates,
    Math.floor(
      Number(
        progressJson?.effectiveAllocatedMaxSearchStates ??
          summaryJson?.rejectionSummary?.effectiveAllocatedMaxSearchStates ??
          0,
      ) || 0,
    ),
    Math.floor(Number(budgetRequest?.effectiveAllocatedMaxSearchStates ?? 0) || 0),
  )
  return {
    exploredStates: resolvedExploredStates,
    effectiveAllocatedMaxSearchStates: resolvedEffectiveAllocatedMaxSearchStates,
  }
}

const buildParallelTimedProgressPayload = ({
  payload,
  startedAtMs = null,
  completedEstimatedCost = null,
  totalEstimatedCost = null,
  activeEstimatedCost = 0,
}) => {
  const next = {
    ...payload,
    rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    updatedAt: new Date().toISOString(),
  }
  const elapsedSec =
    Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0.001, (Date.now() - startedAtMs) / 1000)
      : null
  if (!elapsedSec) {
    next.parallelEstimatedCostPerSec = null
    next.estimatedRemainingSeconds = null
    return next
  }
  const safeCompletedEstimatedCost = Number(completedEstimatedCost ?? 0)
  const safeActiveEstimatedCost = Math.max(0, Number(activeEstimatedCost ?? 0))
  const effectiveCompletedEstimatedCost = safeCompletedEstimatedCost + safeActiveEstimatedCost
  const costPerSec = effectiveCompletedEstimatedCost > 0 ? effectiveCompletedEstimatedCost / elapsedSec : 0
  next.parallelEstimatedCostPerSec = Number(costPerSec.toFixed(3))
  next.parallelEffectiveEstimatedCostCompleted = Number(effectiveCompletedEstimatedCost.toFixed(3))
  if (
    Number.isFinite(totalEstimatedCost) &&
    totalEstimatedCost > effectiveCompletedEstimatedCost &&
    costPerSec > 0
  ) {
    next.estimatedRemainingSeconds = Number(
      ((totalEstimatedCost - effectiveCompletedEstimatedCost) / costPerSec).toFixed(1),
    )
  } else {
    next.estimatedRemainingSeconds = payload?.phase === "completed" ? 0 : null
  }
  return next
}

const spawnNode = ({ cwd, scriptPath, args, env }) => {
  const proc = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let settled = false
  proc.stdout.setEncoding("utf8")
  proc.stderr.setEncoding("utf8")
  proc.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  proc.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const completionPromise = new Promise((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => {
      settled = true
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          [
            "Parallel indexed miner worker failed",
            `script=${scriptPath}`,
            `exitCode=${Number(code ?? 1)}`,
            stdout ? `stdout=${stdout.trim()}` : null,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    })
  })
  completionPromise.catch(() => {})
  return {
    pid: Number.isInteger(proc.pid) ? proc.pid : null,
    completionPromise,
    isSettled: () => settled,
  }
}

const readControlPlaneJsonIfExists = async (filePath, label) => {
  let payload = null
  try {
    payload = await readJsonIfExistsStrict(filePath)
  } catch (error) {
    throw new Error(
      [
        `${label} is unreadable or malformed.`,
        `path=${filePath}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    )
  }
  if (payload !== null) return payload
  if (pathExists(filePath)) {
    try {
      payload = await readJsonIfExistsStrict(filePath)
    } catch (error) {
      throw new Error(
        [
          `${label} is unreadable or malformed.`,
          `path=${filePath}`,
          `cause=${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      )
    }
    if (payload !== null) return payload
    if (pathExists(filePath)) {
      throw new Error(`${label} must contain a JSON object: ${filePath}`)
    }
  }
  return null
}

const removeControlPlaneJsonIfExists = async (filePath, label) => {
  const resolvedPath = typeof filePath === "string" ? filePath.trim() : ""
  if (!resolvedPath || !pathExists(resolvedPath)) return false
  try {
    await fsp.rm(resolvedPath, { force: true })
    return true
  } catch (error) {
    throw new Error(
      [
        `${label} could not be removed after it was fully processed.`,
        `path=${resolvedPath}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    )
  }
}

const hasParallelChunkRunBudgetActivity = (chunkRun) => {
  if (!chunkRun || typeof chunkRun !== "object") return false
  if (Number(chunkRun?.pendingBudgetRevision ?? 0) > 0) return true
  if (Number(chunkRun?.pendingBudgetRequestRevision ?? 0) > 0) return true
  if (Number(chunkRun?.lastLiveState?.externalBudgetRequestPendingCount ?? 0) > 0) return true
  if (String(chunkRun?.lastBudgetDecisionType ?? "").trim().toLowerCase() === "pending") {
    return true
  }
  const budgetRequestPath =
    typeof chunkRun?.budgetRequestPath === "string" && chunkRun.budgetRequestPath.length > 0
      ? chunkRun.budgetRequestPath
      : null
  if (budgetRequestPath && pathExists(budgetRequestPath)) return true
  const budgetCommitPath =
    typeof chunkRun?.budgetCommitPath === "string" && chunkRun.budgetCommitPath.length > 0
      ? chunkRun.budgetCommitPath
      : null
  if (budgetCommitPath && pathExists(budgetCommitPath)) return true
  return false
}

export const shouldServiceParallelBudgetRequestsFastpath = ({ activeChunkRuns }) => {
  const activeRuns = Array.isArray(activeChunkRuns) ? activeChunkRuns : []
  return activeRuns.some((chunkRun) => hasParallelChunkRunBudgetActivity(chunkRun))
}

export const resolveParallelBudgetFastpathIntervalMs = ({ activeChunkRuns }) => {
  return shouldServiceParallelBudgetRequestsFastpath({ activeChunkRuns })
    ? PARALLEL_BUDGET_REQUEST_FASTPATH_INTERVAL_MS
    : PARALLEL_BUDGET_REQUEST_FASTPATH_IDLE_INTERVAL_MS
}

export const resolveParallelActiveChunkCompletionPollIntervalMs = ({ chunkRun }) => {
  const lastLiveState =
    chunkRun && typeof chunkRun === "object" && chunkRun.lastLiveState
      ? chunkRun.lastLiveState
      : null
  if (!lastLiveState || lastLiveState.observedProgressFile !== true) {
    return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS
  }
  const phase = String(lastLiveState?.phase ?? "").trim().toLowerCase()
  if (phase !== "search") {
    return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS
  }
  const progressAgeMs = Number(lastLiveState?.progressAgeMs ?? Number.NaN)
  const lastObservedAtMs = Number(chunkRun?.lastLiveStateObservedAtMs ?? 0)
  const observationLagMs =
    Number.isFinite(lastObservedAtMs) && lastObservedAtMs > 0
      ? Math.max(0, Date.now() - lastObservedAtMs)
      : 0
  const effectiveProgressAgeMs = Number.isFinite(progressAgeMs)
    ? Math.max(0, progressAgeMs) + observationLagMs
    : Number.NaN
  if (
    !Number.isFinite(effectiveProgressAgeMs) ||
    effectiveProgressAgeMs > PARALLEL_ACTIVE_CHUNK_COMPLETION_PROGRESS_STALE_MS
  ) {
    return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS
  }
  const completionFraction = Number(lastLiveState?.completionFraction ?? Number.NaN)
  if (
    Number.isFinite(completionFraction) &&
    completionFraction >= PARALLEL_ACTIVE_CHUNK_COMPLETION_NEAR_COMPLETION_FRACTION
  ) {
    return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS
  }
  const etaSeconds = Number(lastLiveState?.etaSeconds ?? Number.NaN)
  if (
    Number.isFinite(etaSeconds) &&
    etaSeconds >= 0 &&
    etaSeconds <= PARALLEL_ACTIVE_CHUNK_COMPLETION_NEAR_COMPLETION_ETA_SECONDS
  ) {
    return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS
  }
  return PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_SLOW_INTERVAL_MS
}

const getPerfectPrototypeRuleHitCount = (rule) =>
  Number(rule?.trainHitCount ?? rule?.matchHitCount ?? 0)

const buildLivePartialRuleFloorAggregate = ({
  completedMergedBySignature,
  activeSnapshotsByChunk,
  maxRules,
}) => {
  const aggregateBySignature = new Map()
  const aggregateTopKTracker = createPerfectPrototypeTopKHitTracker({ maxRules })
  let observedRuleCount = 0
  let liveCanonicalRuleCount = 0
  const mergeRule = (rule) => {
    const ruleMatchRowIndexes = rule?.matchRowIndexes ?? rule?.positiveMatchRowIndexes ?? []
    const signature = buildRuleMatchSignatureHash(ruleMatchRowIndexes)
    const bucket = aggregateBySignature.get(signature) ?? []
    const existing = bucket.find((entry) =>
      areExactRowIndexArraysEqual(
        entry?.matchRowIndexes ?? entry?.positiveMatchRowIndexes ?? [],
        ruleMatchRowIndexes,
      ),
    )
    const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(existing ?? null, rule)
    if (!existing) {
      bucket.push(rule)
      aggregateBySignature.set(signature, bucket)
      observedRuleCount += 1
      liveCanonicalRuleCount += 1
      aggregateTopKTracker.observeHitCount(getPerfectPrototypeRuleHitCount(rule))
      return
    }
    if (winner === rule) {
      aggregateBySignature.set(
        signature,
        bucket.map((entry) => (entry === existing ? rule : entry)),
      )
    }
  }
  for (const bucket of completedMergedBySignature.values()) {
    if (!Array.isArray(bucket)) continue
    for (const rule of bucket) {
      mergeRule(rule)
    }
  }
  for (const snapshot of activeSnapshotsByChunk.values()) {
    const rules = Array.isArray(snapshot?.rules) ? snapshot.rules : []
    for (const rule of rules) {
      mergeRule(rule)
    }
  }
  return {
    kthHitFloor: aggregateTopKTracker.getKthHitFloor(),
    observedRuleCount,
    liveCanonicalRuleCount,
  }
}

const buildMergedLiveCanonicalRuleAggregate = ({
  completedMergedBySignature,
  activeSnapshotsByChunk,
}) => {
  const aggregateBySignature = new Map()
  let observedRuleCount = 0
  let liveCanonicalRuleCount = 0
  const mergeRule = (rule) => {
    const ruleMatchRowIndexes = rule?.matchRowIndexes ?? rule?.positiveMatchRowIndexes ?? []
    const signature = buildRuleMatchSignatureHash(ruleMatchRowIndexes)
    const bucket = aggregateBySignature.get(signature) ?? []
    const existing = bucket.find((entry) =>
      areExactRowIndexArraysEqual(
        entry?.matchRowIndexes ?? entry?.positiveMatchRowIndexes ?? [],
        ruleMatchRowIndexes,
      ),
    )
    const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(existing ?? null, rule)
    if (!existing) {
      bucket.push(rule)
      aggregateBySignature.set(signature, bucket)
      observedRuleCount += 1
      liveCanonicalRuleCount += 1
      return
    }
    if (winner === rule) {
      aggregateBySignature.set(
        signature,
        bucket.map((entry) => (entry === existing ? rule : entry)),
      )
    }
  }
  for (const bucket of completedMergedBySignature.values()) {
    if (!Array.isArray(bucket)) continue
    for (const rule of bucket) {
      mergeRule(rule)
    }
  }
  for (const snapshot of activeSnapshotsByChunk.values()) {
    const rules = Array.isArray(snapshot?.rules) ? snapshot.rules : []
    for (const rule of rules) {
      mergeRule(rule)
    }
  }
  const rules = []
  for (const bucket of aggregateBySignature.values()) {
    if (!Array.isArray(bucket)) continue
    for (const rule of bucket) {
      rules.push(rule)
    }
  }
  return {
    observedRuleCount,
    liveCanonicalRuleCount,
    rules,
  }
}

const normalizeRowsetModeStatsForMerge = (rowsetModeStats, label) => {
  return normalizePerfectPrototypeRowsetModeStats(rowsetModeStats, { label, strict: true })
}

const mergeRowsetModeStatsSummaries = (rowsetModeStatsList) => {
  const merged = createPerfectPrototypeRowsetModeStatsShape()
  const list = Array.isArray(rowsetModeStatsList) ? rowsetModeStatsList : []
  list.forEach((rowsetModeStats, index) => {
    const normalized = normalizeRowsetModeStatsForMerge(rowsetModeStats, `rowsetModeStats[${index}]`)
    for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS) {
      const currentValue = String(normalized[key] ?? "").trim()
      const mergedValue = String(merged[key] ?? "").trim()
      if (currentValue.length < 1) continue
      if (mergedValue.length < 1) {
        merged[key] = currentValue
        continue
      }
      if (mergedValue !== currentValue) {
        throw new Error(
          `Parallel indexed miner requires consistent rowsetModeStats.${key}: base=${mergedValue} current=${currentValue}`,
        )
      }
    }
    for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS) {
      merged[key] += Number(normalized[key] ?? 0)
    }
  })
  return merged
}

const mergeRejectionSummaries = (summaries) => {
  const list = Array.isArray(summaries) ? summaries.filter(Boolean) : []
  if (list.length < 1) return {}
  const base = { ...list[0] }
  const additiveKeys = [
    "searchBelowMinHitCount",
    "noMatchChangeCount",
    "noNegativeSeparationProgressCount",
    "precisionRegressionCount",
    "negativeMatchCount",
    "precisionBelowMinTrainPrecisionCount",
    "aboveMaxTrainHitCountCount",
    "gapViolationCount",
    "dominatedBySmallerRuleCount",
    "stateDominancePruneCount",
    "boundPruneCount",
    "memoHitCount",
    "memoLookupMs",
    "memoPositiveSignatureBucketCount",
    "memoFrontierInsertCount",
    "memoFrontierPruneCount",
    "memoFrontierScanCount",
    "memoFrontierDeleteCount",
    "memoFrontierSkippedBucketCount",
    "memoFrontierCompactionCount",
    "memoFrontierBucketCount",
    "memoFrontierTombstoneCount",
    "memoCacheBytes",
    "memoEvictedBucketCount",
    "memoEvictedFrontierEntryCount",
    "memoOversizeSkipCount",
    "memoRangeSkipPrefixCount",
    "memoRangeSkipSuffixCount",
    "memoRangeSummaryRebuildCount",
    "memoExactFingerprintFastHitCount",
    "memoExactFingerprintScanCount",
    "memoFingerprintMetadataRebuildCount",
    "budgetStopCount",
    "externalBudgetPollCount",
    "externalBudgetDecisionPollCount",
    "externalBudgetAppliedCount",
    "externalBudgetAllowanceAppliedCount",
    "externalBudgetAllowanceSeenCount",
    "externalBudgetAllowanceConsumedCount",
    "externalBudgetRequestCount",
    "externalBudgetRequestSatisfiedCount",
    "externalBudgetRequestDeniedCount",
    "externalBudgetRequestPendingCount",
    "externalBudgetRequestWaitMs",
    "externalBudgetPendingWaitMs",
    "externalBudgetCommitRequestCount",
    "externalKthHitFloorPollCount",
    "externalKthHitFloorAppliedCount",
    "rowsetBorrowHitCount",
    "rowsetBorrowMissCount",
    "rowsetOwnedAllocCount",
    "rowsetFinalizeCount",
    "sparseSparseIntersectionMs",
    "sparseBitmapIntersectionMs",
    "sparseEqualSizeMergeCount",
    "sparseAdaptiveGallopCount",
    "sparseCountFastPathCount",
    "sparseBitmapWordRunCount",
    "sparseBitmapSkippedRunCount",
    "sparseBitmapPartialRunCount",
    "sparseBitmapFullRunHitCount",
    "bitmapDenseDenseCount",
    "bitmapIntersectionMs",
    "bitmapMaterializeMs",
    "bitmapEdgeSummaryMs",
    "childOrderingMs",
    "orderingNegativeLoads",
    "orderingHeadExactLoads",
    "orderingHeadRerankMs",
    "livePartialBootstrapSnapshotCount",
    "livePartialBootstrapModeActive",
    "collectedRuleCount",
    "observedRuleCount",
    "liveCanonicalRuleCount",
    "finalSelectedRuleCount",
  ]
  const consistentStringKeys = ["sparseKernelMode", "bitmapKernelMode"]
  const mergedRowsetModeStats = mergeRowsetModeStatsSummaries(
    list.map((summary) => summary?.rowsetModeStats ?? {}),
  )
  for (let index = 1; index < list.length; index += 1) {
    const current = list[index]
    for (const key of additiveKeys) {
      base[key] = Number(base[key] ?? 0) + Number(current?.[key] ?? 0)
    }
    for (const key of consistentStringKeys) {
      const baseValue = String(base?.[key] ?? "").trim()
      const currentValue = String(current?.[key] ?? "").trim()
      if (baseValue.length < 1) {
        base[key] = currentValue
        continue
      }
      if (currentValue.length < 1) continue
      if (baseValue !== currentValue) {
        throw new Error(
          `Parallel indexed miner requires consistent ${key} across workers: base=${baseValue} current=${currentValue}`,
        )
      }
    }
    base.memoFingerprintBucketPeak = Math.max(
      Number(base?.memoFingerprintBucketPeak ?? 0),
      Number(current?.memoFingerprintBucketPeak ?? 0),
    )
    base.externalKthHitFloor = Math.max(
      Number(base?.externalKthHitFloor ?? 0),
      Number(current?.externalKthHitFloor ?? 0),
    )
    base.externalKthHitFloorRevision = Math.max(
      Number(base?.externalKthHitFloorRevision ?? 0),
      Number(current?.externalKthHitFloorRevision ?? 0),
    )
    base.effectiveKthHitFloor = Math.max(
      Number(base?.effectiveKthHitFloor ?? 0),
      Number(current?.effectiveKthHitFloor ?? 0),
    )
    base.externalAllocatedMaxSearchStates = Math.max(
      Number(base?.externalAllocatedMaxSearchStates ?? 0),
      Number(current?.externalAllocatedMaxSearchStates ?? 0),
    )
    base.externalBudgetRevision = Math.max(
      Number(base?.externalBudgetRevision ?? 0),
      Number(current?.externalBudgetRevision ?? 0),
    )
    base.externalBudgetCommitRevision = Math.max(
      Number(base?.externalBudgetCommitRevision ?? 0),
      Number(current?.externalBudgetCommitRevision ?? 0),
    )
    base.effectiveAllocatedMaxSearchStates = Math.max(
      Number(base?.effectiveAllocatedMaxSearchStates ?? 0),
      Number(current?.effectiveAllocatedMaxSearchStates ?? 0),
    )
    base.budgetStopExploredStates = Math.max(
      Number(base?.budgetStopExploredStates ?? 0),
      Number(current?.budgetStopExploredStates ?? 0),
    )
    const baseBudgetStopReason = String(base?.budgetStopReason ?? "").trim()
    const currentBudgetStopReason = String(current?.budgetStopReason ?? "").trim()
    if (baseBudgetStopReason.length < 1) {
      base.budgetStopReason = currentBudgetStopReason || null
    } else if (
      currentBudgetStopReason.length > 0 &&
      currentBudgetStopReason !== baseBudgetStopReason
    ) {
      base.budgetStopReason = "multiple"
    }
    if (current?.truncatedByMaxSearchStates === true) {
      base.truncatedByMaxSearchStates = true
    }
  }
  base.rowsetModeStats = mergedRowsetModeStats
  for (const key of consistentStringKeys) {
    if (String(base?.[key] ?? "").trim().length < 1) {
      throw new Error(`Parallel indexed miner requires non-empty ${key} in worker rejection summary`)
    }
  }
  return base
}

const resolveOrderingHeadWindow = (value) =>
  Math.max(0, Math.min(64, Math.floor(Number(value ?? 8) || 0)))

export const minePerfectPrototypeParallelIndexed = async ({
  cwd = process.cwd(),
  indexDir,
  outDir,
  options = {},
}) => {
  const resolveIndexArtifactPath = (value, fallbackName) => {
    const normalized = String(value ?? "").trim()
    if (!normalized) return path.join(resolvedIndexDir, fallbackName)
    return path.isAbsolute(normalized) ? normalized : path.join(resolvedIndexDir, normalized)
  }
  const partialMergeInPlacePruneEnabled =
    String(process.env.PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE ?? "true").trim().toLowerCase() ===
    "true"
  if (partialMergeInPlacePruneEnabled !== true) {
    throw new Error("Perfect prototype parallel indexed miner requires PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE=true")
  }
  const resolvedIndexDir = path.resolve(indexDir)
  const resolvedOutDir = path.resolve(outDir)
  await ensureDir(resolvedOutDir)
  const progressPath = path.join(resolvedOutDir, "progress.json")
  const parallelStartedAt = Date.now()

  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const partitionManifestPath = path.join(resolvedIndexDir, "partition_manifest.json")
  const tokenizerSpecPath = path.join(resolvedIndexDir, "tokenizer_spec.json")
  const tokenStatsPath = path.join(resolvedIndexDir, "token_stats.parquet")
  const rowMetaPath = path.join(resolvedIndexDir, "row_meta.parquet")
  const manifest = await readJson(manifestPath, null)
  const summary = await readJson(summaryPath, null)
  const partitionManifest = await readJson(partitionManifestPath, null)
  const tokenizerSpec = await readJson(tokenizerSpecPath, null)
  if (!manifest || !summary || !tokenizerSpec) {
    throw new Error(`Indexed predictive artifacts are incomplete: ${resolvedIndexDir}`)
  }
  const rowUniverseSize = Math.max(0, Math.floor(Number(manifest?.rowCount ?? 0) || 0))
  if (rowUniverseSize < 1) {
    throw new Error(`Parallel indexed miner requires a positive manifest.rowCount: ${resolvedIndexDir}`)
  }
  const tokenDictionaryParquetPath =
    resolveIndexArtifactPath(manifest?.tokenDictionaryParquetPath, "token_dictionary.parquet")
  const tokenPostingsBinPath =
    resolveIndexArtifactPath(manifest?.tokenPostingsBinPath, "token_postings.bin")
  assertPerfectPrototypeTokenizerSpecIntegrity({
    indexDir: resolvedIndexDir,
    tokenizerSpec,
    manifest,
    summary,
    partitionManifest,
  })

  const cfg = normalizeMinerOptions({
    ...options,
    surfaceName: tokenizerSpec?.surface ?? options?.surfaceName,
    tokenizerOptions: tokenizerSpec?.options ?? options?.tokenizerOptions,
  })
  const requestedWorkers = clampInteger(options?.workers, 2, 1, 16)
  const parallelStartupPhaseHistory = []
  let parallelFirstTopLevelProgressElapsedMs = null
  let parallelPlanningValidateIndexProvenanceMs = 0
  let parallelPlanningSeedSelectionMs = 0
  let parallelPlanningSeedDictionaryPlanningMs = 0
  let parallelPlanningHeadMicroprobePass1Ms = 0
  let parallelPlanningHeadMicroprobePass2Ms = 0
  let parallelPlanningFirstWaveFrontierSplitMs = 0
  let parallelPlanningFirstWaveLaunchSplitMs = 0
  let parallelPlanningRootSeedMicroshardMs = 0
  let parallelPlanningExactProbeStage1Ms = 0
  let parallelPlanningExactProbeStage2Ms = 0
  let parallelPlanningReadyQueueMs = 0
  const parallelPlanningReuseTelemetry = {
    readyQueueRebuildCount: 0,
    rescoredChunkCount: 0,
    microprobeReuseCount: 0,
  }
  const parallelPlanningExactProbeStage1LiveTelemetry = {
    elapsedMs: 0,
    chunksCompleted: 0,
    chunkCount: 0,
    exploredStates: 0,
    currentChunkIndex: null,
    inFlightChunkCount: 0,
    pendingChunkCount: 0,
    stage1Concurrency: null,
    heartbeatRevision: 0,
  }
  const buildParallelPlanningMetrics = () => ({
    parallelFirstTopLevelProgressElapsedMs,
    parallelPlanningValidateIndexProvenanceMs,
    parallelPlanningSeedSelectionMs,
    parallelPlanningSeedDictionaryPlanningMs,
    parallelPlanningHeadMicroprobePass1Ms,
    parallelPlanningHeadMicroprobePass2Ms,
    parallelPlanningFirstWaveFrontierSplitMs,
    parallelPlanningFirstWaveLaunchSplitMs,
    parallelPlanningRootSeedMicroshardMs,
    parallelPlanningExactProbeStage1Ms,
    parallelPlanningExactProbeStage1ElapsedMs:
      parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs,
    parallelPlanningExactProbeStage1ChunksCompleted:
      parallelPlanningExactProbeStage1LiveTelemetry.chunksCompleted,
    parallelPlanningExactProbeStage1ChunkCount:
      parallelPlanningExactProbeStage1LiveTelemetry.chunkCount,
    parallelPlanningExactProbeStage1ExploredStates:
      parallelPlanningExactProbeStage1LiveTelemetry.exploredStates,
    parallelPlanningExactProbeStage1CurrentChunkIndex:
      parallelPlanningExactProbeStage1LiveTelemetry.currentChunkIndex,
    parallelPlanningExactProbeStage1InFlightChunkCount:
      parallelPlanningExactProbeStage1LiveTelemetry.inFlightChunkCount,
    parallelPlanningExactProbeStage1PendingChunkCount:
      parallelPlanningExactProbeStage1LiveTelemetry.pendingChunkCount,
    parallelPlanningExactProbeStage1Concurrency:
      parallelPlanningExactProbeStage1LiveTelemetry.stage1Concurrency,
    parallelPlanningExactProbeStage1HeartbeatRevision:
      parallelPlanningExactProbeStage1LiveTelemetry.heartbeatRevision,
    parallelPlanningExactProbeStage2Ms,
    parallelPlanningReadyQueueMs,
    parallelPlanningReadyQueueRebuildCount:
      parallelPlanningReuseTelemetry.readyQueueRebuildCount,
    parallelPlanningRescoredChunkCount:
      parallelPlanningReuseTelemetry.rescoredChunkCount,
    parallelPlanningMicroprobeReuseCount:
      parallelPlanningReuseTelemetry.microprobeReuseCount,
    parallelStartupPhaseHistory: [...parallelStartupPhaseHistory],
  })
  const writeStartupProgress = async ({
    phase,
    workerCount = requestedWorkers,
    parallelChunkCount = 0,
    parallelWaveCount = 0,
    totalEstimatedCost = 0,
    parallelReadyQueueDepth = parallelChunkCount,
  }) => {
    if (!Number.isFinite(parallelFirstTopLevelProgressElapsedMs)) {
      parallelFirstTopLevelProgressElapsedMs = Math.max(1, Date.now() - parallelStartedAt)
    }
    const normalizedPhase = String(phase ?? "").trim()
    if (
      normalizedPhase.length > 0 &&
      parallelStartupPhaseHistory[parallelStartupPhaseHistory.length - 1] !== normalizedPhase
    ) {
      parallelStartupPhaseHistory.push(normalizedPhase)
    }
    await writeJsonAtomic(
      progressPath,
      buildParallelTimedProgressPayload({
        payload: {
          phase,
          workerCount,
          parallelConfiguredMaxSearchStates: cfg.maxSearchStates,
          parallelChunkCount,
          parallelWaveCount,
          parallelCompletedChunkCount: 0,
          parallelCompletedWaveCount: 0,
          completedEstimatedCost: 0,
          totalEstimatedCost,
          parallelReadyQueueDepth,
          mergedObservedRuleCount: 0,
          mergedLiveRuleCount: 0,
          exploredStates: 0,
          parallelActiveChunkCount: 0,
          parallelActiveWaveExploredStates: 0,
          parallelActiveWaveRulesCollected: 0,
          parallelActiveWaveMemoLookupMs: 0,
          parallelActiveWaveEtaSeconds: null,
          parallelRemainingSearchBudget: cfg.maxSearchStates,
          parallelRemainingGrantableSearchBudget: cfg.maxSearchStates,
          parallelActiveWaveEstimatedCost: 0,
          ...buildParallelPlanningMetrics(),
        },
        startedAtMs: parallelStartedAt,
        completedEstimatedCost: 0,
        totalEstimatedCost,
      }),
    )
  }
  await writeStartupProgress({
    phase: "startup_preflight",
    workerCount: requestedWorkers,
  })
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await writeStartupProgress({
    phase: "validate_index_provenance",
    workerCount: requestedWorkers,
  })
  const validateIndexProvenanceStartedAt = Date.now()
  await validatePerfectPrototypeIndexProvenance({
    indexDir: resolvedIndexDir,
    indexManifest: manifest,
    partitionManifest,
  })
  parallelPlanningValidateIndexProvenanceMs = Math.max(
    0,
    Date.now() - validateIndexProvenanceStartedAt,
  )
  await writeStartupProgress({
    phase: "seed_selection",
    workerCount: requestedWorkers,
  })
  const seedSelectionStartedAt = Date.now()
  const seedSelection = await streamSelectPerfectPrototypeSeedEntries({
    cwd,
    duckdb,
    tokenStatsPath,
    minHitCount: cfg.minHitCount,
    maxSeedTokens: cfg.maxSeedTokens,
    expectedTokenCount:
      Number.isInteger(Number(manifest?.tokenCount)) && Number(manifest?.tokenCount) >= 0
        ? Number(manifest.tokenCount)
        : null,
  })
  const seedSelectionMs = Date.now() - seedSelectionStartedAt
  parallelPlanningSeedSelectionMs = seedSelectionMs
  if (!pathExists(tokenDictionaryParquetPath)) {
    throw new Error(`Parallel indexed miner missing token_dictionary.parquet: ${tokenDictionaryParquetPath}`)
  }
  if (!pathExists(tokenPostingsBinPath)) {
    throw new Error(`Parallel indexed miner missing token_postings.bin: ${tokenPostingsBinPath}`)
  }
  await writeStartupProgress({
    phase: "seed_dictionary_planning",
    workerCount: requestedWorkers,
  })
  const seedDictionaryPlanningStartedAt = Date.now()
  const seedStats = await loadSeedPlanningEntriesWithDictionaryMetadata({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    seedEntries: seedSelection.seedEntries,
  })
  parallelPlanningSeedDictionaryPlanningMs = Math.max(
    0,
    Date.now() - seedDictionaryPlanningStartedAt,
  )
  const selectedSeedCount = seedStats.length
  const workerCount = Math.max(1, Math.min(requestedWorkers, selectedSeedCount || 1))
  let chunks = []
  let bootstrapHeadLaunchQuota = 0
  let bootstrapHeadFirstWaveQuota = 0
  let totalEstimatedCost = 0
  let readyQueuePlan = []
  let firstWaveFrontierSplitCount = 0
  let firstWaveLaunchSplitCount = 0
  let firstWaveRootSeedMicroshardCount = 0
  let firstWaveForcedSingletonMicroshardCount = 0
  let singletonRootExactCompletionProbesByChunkIndex = new Map()
  let singletonRootAdaptiveExactCompletionProbesByChunkIndex = new Map()
  let singletonRootAdaptiveExactCompletionFinalistChunkIndexes = new Set()
  let parallelFirstWaveExactCompletionProbeSingletonCandidateCount = 0
  let parallelFirstWaveExactCompletionProbeCount = 0
  let parallelFirstWaveExactCompletionProbeReachedTerminalCount = 0
  let parallelFirstWaveExactCompletionProbeFoundFirstRuleCount = 0
  let parallelFirstWaveExactCompletionProbeStateCap = null
  let parallelFirstWaveExactCompletionScoreMin = null
  let parallelFirstWaveExactCompletionScoreMax = null
  let parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount = 0
  let parallelFirstWaveAdaptiveExactCompletionProbeCount = 0
  let parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount = 0
  let parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount = 0
  let parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin = null
  let parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax = null
  let parallelFirstWaveAdaptiveExactCompletionScoreMin = null
  let parallelFirstWaveAdaptiveExactCompletionScoreMax = null
  const targetChunkCount = Math.max(workerCount, Math.min(selectedSeedCount || 1, Math.max(workerCount * 16, 32)))
  const bootstrapHeadChunkCount = Math.max(
    workerCount,
    Math.min(targetChunkCount, Math.max(workerCount * 4, 4)),
  )
  const bootstrapLivePartialMaxRules = Math.max(cfg.maxRules, cfg.maxRules * workerCount)
  const planningPostingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r")
  try {
    const planningPostingValueCache = createParallelPlanningPostingValueCache({
      postingsHandle: planningPostingsHandle,
      seedStats,
      rowUniverseSize,
    })
    const planningMicroprobeCacheByFingerprint = new Map()
    const planningReadyQueueScoreCache = new Map()
    const initialChunks = buildDeterministicCostAwareChunks({
      seedStats,
      chunkCount: targetChunkCount,
      bootstrapHeadChunkCount,
      bootstrapHeadTargetDivisor: 4,
    })
    const {
      chunks: bootstrapHeadSplitChunks,
    } = splitPathologicalBootstrapHeadChunks({
      chunks: initialChunks,
      seedStats,
    })
    const initialBootstrapHeadLaunchQuota = Math.min(
      workerCount,
      bootstrapHeadSplitChunks.filter((chunk) => chunk?.bootstrapHead === true).length,
    )
    const initialBootstrapHeadFirstWaveQuota = Math.min(1, initialBootstrapHeadLaunchQuota)
    await writeStartupProgress({
      phase: "head_microprobe_pass_1",
      workerCount,
      parallelChunkCount: bootstrapHeadSplitChunks.length,
      parallelReadyQueueDepth: bootstrapHeadSplitChunks.length,
    })
    const headMicroprobePass1StartedAt = Date.now()
    const initialChunkHeadMicroprobesByChunkIndex = await loadChunkHeadMicroprobesByChunkIndex({
      chunks: bootstrapHeadSplitChunks,
      seedStats,
      tokenPostingsBinPath,
      workerCount,
      minHitCount: cfg.minHitCount,
      bootstrapHeadLaunchQuota: initialBootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota: initialBootstrapHeadFirstWaveQuota,
      postingsHandle: planningPostingsHandle,
      postingValueCache: planningPostingValueCache,
      microprobeCacheByFingerprint: planningMicroprobeCacheByFingerprint,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningHeadMicroprobePass1Ms = Math.max(0, Date.now() - headMicroprobePass1StartedAt)
    const firstWaveFrontierSplitStartedAt = Date.now()
    const firstWaveFrontierSplitResult = splitPathologicalFirstWaveFrontierChunks({
      chunks: bootstrapHeadSplitChunks,
      seedStats,
      workerCount,
      bootstrapHeadLaunchQuota: initialBootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota: initialBootstrapHeadFirstWaveQuota,
      chunkHeadMicroprobesByChunkIndex: initialChunkHeadMicroprobesByChunkIndex,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningFirstWaveFrontierSplitMs = Math.max(
      0,
      Date.now() - firstWaveFrontierSplitStartedAt,
    )
    firstWaveFrontierSplitCount = firstWaveFrontierSplitResult.firstWaveFrontierSplitCount
    const firstWaveCompletionTargetSplitStartedAt = Date.now()
    const firstWaveCompletionTargetSplitResult = splitFirstWaveLaunchChunksForCompletion({
      chunks: firstWaveFrontierSplitResult.chunks,
      seedStats,
      workerCount,
      bootstrapHeadLaunchQuota: initialBootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota: initialBootstrapHeadFirstWaveQuota,
      chunkHeadMicroprobesByChunkIndex: initialChunkHeadMicroprobesByChunkIndex,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningFirstWaveLaunchSplitMs = Math.max(
      0,
      Date.now() - firstWaveCompletionTargetSplitStartedAt,
    )
    firstWaveLaunchSplitCount = firstWaveCompletionTargetSplitResult.firstWaveLaunchSplitCount
    const firstWaveRootSeedMicroshardStartedAt = Date.now()
    const firstWaveRootSeedMicroshardResult = splitFirstWaveLaunchChunksIntoRootSeedMicroshards({
      chunks: firstWaveCompletionTargetSplitResult.chunks,
      seedStats,
      workerCount,
      bootstrapHeadLaunchQuota: initialBootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota: initialBootstrapHeadFirstWaveQuota,
      chunkHeadMicroprobesByChunkIndex: initialChunkHeadMicroprobesByChunkIndex,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningRootSeedMicroshardMs = Math.max(
      0,
      Date.now() - firstWaveRootSeedMicroshardStartedAt,
    )
    firstWaveRootSeedMicroshardCount =
      firstWaveRootSeedMicroshardResult.firstWaveRootSeedMicroshardCount
    firstWaveForcedSingletonMicroshardCount =
      firstWaveRootSeedMicroshardResult.firstWaveForcedSingletonMicroshardCount
    chunks = firstWaveRootSeedMicroshardResult.chunks
    totalEstimatedCost = chunks.reduce(
      (sum, chunk) => sum + Number(chunk?.estimatedCost ?? 0),
      0,
    )
    bootstrapHeadLaunchQuota = Math.min(
      workerCount,
      chunks.filter((chunk) => chunk?.bootstrapHead === true).length,
    )
    bootstrapHeadFirstWaveQuota = Math.min(1, bootstrapHeadLaunchQuota)
    await writeStartupProgress({
      phase: "head_microprobe_pass_2",
      workerCount,
      parallelChunkCount: chunks.length,
      totalEstimatedCost,
      parallelReadyQueueDepth: chunks.length,
    })
    const headMicroprobePass2StartedAt = Date.now()
    const chunkHeadMicroprobesByChunkIndex = await loadChunkHeadMicroprobesByChunkIndex({
      chunks,
      seedStats,
      tokenPostingsBinPath,
      workerCount,
      minHitCount: cfg.minHitCount,
      bootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota,
      frontierDispatchBandMultiplier: 1,
      postingsHandle: planningPostingsHandle,
      postingValueCache: planningPostingValueCache,
      microprobeCacheByFingerprint: planningMicroprobeCacheByFingerprint,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningHeadMicroprobePass2Ms = Math.max(0, Date.now() - headMicroprobePass2StartedAt)
    await writeStartupProgress({
      phase: "singleton_exact_probe_stage1",
      workerCount,
      parallelChunkCount: chunks.length,
      totalEstimatedCost,
      parallelReadyQueueDepth: chunks.length,
    })
    const singletonProbeSummary =
      await loadPerfectPrototypeSingletonRootAdaptiveExactCompletionProbesByChunkIndex({
        chunks,
        seedStats,
        tokenPostingsBinPath,
        rowUniverseSize,
        minHitCount: cfg.minHitCount,
        maxRuleSize: cfg.maxRuleSize,
        workerCount,
        postingsHandle: planningPostingsHandle,
        postingValueCache: planningPostingValueCache,
        onStage1Progress: async (stage1Progress) => {
          parallelPlanningExactProbeStage1Ms = Math.max(
            parallelPlanningExactProbeStage1Ms,
            Math.max(0, Number(stage1Progress?.elapsedMs ?? 0)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs = Math.max(
            parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs,
            Math.max(0, Number(stage1Progress?.elapsedMs ?? 0)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.chunksCompleted = Math.max(
            parallelPlanningExactProbeStage1LiveTelemetry.chunksCompleted,
            Math.max(0, Number(stage1Progress?.completedChunkCount ?? 0)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.chunkCount = Math.max(
            parallelPlanningExactProbeStage1LiveTelemetry.chunkCount,
            Math.max(0, Number(stage1Progress?.candidateCount ?? 0)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.exploredStates = Math.max(
            parallelPlanningExactProbeStage1LiveTelemetry.exploredStates,
            Math.max(0, Number(stage1Progress?.cumulativeProbeExploredStates ?? 0)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.currentChunkIndex =
            Number.isInteger(Number(stage1Progress?.currentChunkIndex)) &&
            Number(stage1Progress?.currentChunkIndex) >= 0
              ? Number(stage1Progress.currentChunkIndex)
              : parallelPlanningExactProbeStage1LiveTelemetry.currentChunkIndex
          parallelPlanningExactProbeStage1LiveTelemetry.inFlightChunkCount = Math.max(
            0,
            Number(stage1Progress?.inFlightChunkCount ?? 0),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.pendingChunkCount = Math.max(
            0,
            Number(stage1Progress?.pendingChunkCount ?? 0),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.stage1Concurrency = Math.max(
            Number(parallelPlanningExactProbeStage1LiveTelemetry.stage1Concurrency ?? 0),
            Math.max(1, Number(stage1Progress?.stage1Concurrency ?? 1)),
          )
          parallelPlanningExactProbeStage1LiveTelemetry.heartbeatRevision += 1
          await writeStartupProgress({
            phase: "singleton_exact_probe_stage1",
            workerCount,
            parallelChunkCount: chunks.length,
            totalEstimatedCost,
            parallelReadyQueueDepth: chunks.length,
          })
        },
        onStageTransition: async ({ stage, stage1Ms = 0 }) => {
          if (stage !== "adaptive") return
          parallelPlanningExactProbeStage1Ms = Math.max(0, Number(stage1Ms ?? 0))
          parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs = Math.max(
            parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs,
            Math.max(0, Number(stage1Ms ?? 0)),
          )
          await writeStartupProgress({
            phase: "singleton_exact_probe_stage2",
            workerCount,
            parallelChunkCount: chunks.length,
            totalEstimatedCost,
            parallelReadyQueueDepth: chunks.length,
          })
        },
      })
    singletonRootExactCompletionProbesByChunkIndex =
      singletonProbeSummary.stage1ProbesByChunkIndex
    singletonRootAdaptiveExactCompletionProbesByChunkIndex =
      singletonProbeSummary.adaptiveProbesByChunkIndex
    singletonRootAdaptiveExactCompletionFinalistChunkIndexes =
      singletonProbeSummary.adaptiveFinalistChunkIndexes
    parallelFirstWaveExactCompletionProbeSingletonCandidateCount =
      singletonProbeSummary.probeCandidateCount
    parallelFirstWaveExactCompletionProbeCount = singletonProbeSummary.probeCount
    parallelFirstWaveExactCompletionProbeReachedTerminalCount =
      singletonProbeSummary.probeReachedTerminalCount
    parallelFirstWaveExactCompletionProbeFoundFirstRuleCount =
      singletonProbeSummary.probeFoundFirstRuleCount
    parallelFirstWaveExactCompletionProbeStateCap = singletonProbeSummary.probeStateCap
    parallelFirstWaveExactCompletionScoreMin = singletonProbeSummary.probeScoreMin
    parallelFirstWaveExactCompletionScoreMax = singletonProbeSummary.probeScoreMax
    parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount =
      singletonProbeSummary.adaptiveProbeFinalistCount
    parallelFirstWaveAdaptiveExactCompletionProbeCount =
      singletonProbeSummary.adaptiveProbeCount
    parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount =
      singletonProbeSummary.adaptiveProbeReachedTerminalCount
    parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount =
      singletonProbeSummary.adaptiveProbeFoundFirstRuleCount
    parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin =
      singletonProbeSummary.adaptiveProbeStateCapMin
    parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax =
      singletonProbeSummary.adaptiveProbeStateCapMax
    parallelFirstWaveAdaptiveExactCompletionScoreMin =
      singletonProbeSummary.adaptiveProbeScoreMin
    parallelFirstWaveAdaptiveExactCompletionScoreMax =
      singletonProbeSummary.adaptiveProbeScoreMax
    parallelPlanningExactProbeStage1Ms = Math.max(
      parallelPlanningExactProbeStage1Ms,
      Math.max(0, Number(singletonProbeSummary.stage1Ms ?? 0)),
    )
    parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs = Math.max(
      parallelPlanningExactProbeStage1LiveTelemetry.elapsedMs,
      Math.max(0, Number(singletonProbeSummary.stage1Ms ?? 0)),
    )
    parallelPlanningExactProbeStage1LiveTelemetry.chunkCount = Math.max(
      parallelPlanningExactProbeStage1LiveTelemetry.chunkCount,
      Math.max(0, Number(singletonProbeSummary.probeCandidateCount ?? 0)),
    )
    parallelPlanningExactProbeStage1LiveTelemetry.chunksCompleted = Math.max(
      parallelPlanningExactProbeStage1LiveTelemetry.chunksCompleted,
      Math.max(0, Number(singletonProbeSummary.probeCount ?? 0)),
    )
    parallelPlanningExactProbeStage2Ms = Math.max(
      0,
      Number(singletonProbeSummary.adaptiveStageMs ?? 0),
    )
    const readyQueueStartedAt = Date.now()
    readyQueuePlan = buildDeterministicReadyQueue({
      chunks,
      seedStats,
      workerCount,
      bootstrapHeadLaunchQuota,
      bootstrapHeadFirstWaveQuota,
      chunkHeadMicroprobesByChunkIndex,
      singletonRootExactCompletionProbesByChunkIndex,
      singletonRootAdaptiveExactCompletionProbesByChunkIndex,
      singletonRootAdaptiveExactCompletionFinalistChunkIndexes,
      requireBoundSingletonExactCompletionProbe: true,
      requireBoundSingletonAdaptiveExactCompletionProbe: true,
      readyQueueScoreCache: planningReadyQueueScoreCache,
      planningReuseStats: parallelPlanningReuseTelemetry,
    })
    parallelPlanningReadyQueueMs = Math.max(0, Date.now() - readyQueueStartedAt)
  } finally {
    await planningPostingsHandle.close()
  }
  const plannedWaveCount = computeDeterministicPlannedWaveCount({
    chunkCount: chunks.length,
    workerCount,
  })
  const workerEstimatedCosts = Array.from({ length: workerCount }, () => 0)
  readyQueuePlan.forEach((chunk, dispatchIndex) => {
    workerEstimatedCosts[dispatchIndex % workerCount] += Number(chunk?.estimatedCost ?? 0)
  })
  const logicalWaves = []
  for (let offset = 0; offset < readyQueuePlan.length; offset += workerCount) {
    const waveIndex = logicalWaves.length
    const waveChunks = readyQueuePlan.slice(offset, offset + workerCount)
    logicalWaves.push({
      waveIndex,
      estimatedCost: waveChunks.reduce((sum, chunk) => sum + Number(chunk?.estimatedCost ?? 0), 0),
      chunkIndexes: waveChunks.map((chunk) => Number(chunk?.chunkIndex ?? 0)),
    })
  }
  const workerImbalanceRatio = computeImbalanceRatio(workerEstimatedCosts)
  const parallelChunkPlannerImbalanceRatio = computeImbalanceRatio(
    chunks.map((chunk) => Number(chunk?.estimatedCost ?? 0)),
  )
  const firstWaveLaunchChunks = readyQueuePlan.slice(0, workerCount)
  const firstWaveCompletionTargetLaunchChunks = firstWaveLaunchChunks.filter(
    (chunk) => chunk?.firstWaveCompletionTarget === true,
  )
  const firstWaveSingletonRootLaunchChunks = firstWaveLaunchChunks.filter((chunk) =>
    isSingletonRootChunk(chunk),
  )
  const firstWaveMultiRootLaunchChunks = firstWaveLaunchChunks.filter((chunk) =>
    computeChunkWidth(chunk) > 1,
  )
  const firstWaveSingletonRootCompletionScores = firstWaveSingletonRootLaunchChunks
    .map((chunk) => Number(chunk?.singletonRootCompletionScore ?? Number.NaN))
    .filter((value) => Number.isFinite(value))
  const firstWaveSingletonRootExactCompletionScores = firstWaveSingletonRootLaunchChunks
    .map((chunk) => Number(chunk?.singletonRootExactCompletionScore ?? Number.NaN))
    .filter((value) => Number.isFinite(value))
  const firstWaveSingletonRootAdaptiveExactCompletionScores = firstWaveSingletonRootLaunchChunks
    .map((chunk) => Number(chunk?.singletonRootAdaptiveExactCompletionScore ?? Number.NaN))
    .filter((value) => Number.isFinite(value))
  const firstWaveMultiRootCompletionScores = firstWaveMultiRootLaunchChunks
    .map((chunk) => Number(chunk?.multiRootCompletionScore ?? Number.NaN))
    .filter((value) => Number.isFinite(value))
  const parallelBootstrapChunkCount = chunks.filter((chunk) => chunk.bootstrapHead === true).length
  const parallelFirstWaveFrontierSplitCount = firstWaveFrontierSplitCount
  const parallelFirstWaveLaunchSplitCount = firstWaveLaunchSplitCount
  const parallelFirstWaveRootSeedMicroshardCount = firstWaveRootSeedMicroshardCount
  const parallelFirstWaveForcedSingletonMicroshardCount = firstWaveForcedSingletonMicroshardCount
  const parallelFirstWaveCompletionTargetLaunchCount = firstWaveCompletionTargetLaunchChunks.length
  const parallelFirstWaveSingletonRootChunkCount = firstWaveSingletonRootLaunchChunks.length
  const parallelFirstWaveSingletonRootLaunchCount = firstWaveSingletonRootLaunchChunks.length
  const parallelFirstWaveMultiRootChunkCount = firstWaveMultiRootLaunchChunks.length
  const parallelFirstWaveMultiRootLaunchCount = firstWaveMultiRootLaunchChunks.length
  const parallelFirstWaveSingletonRootCompletionScoreMin =
    firstWaveSingletonRootCompletionScores.length > 0
      ? Number(Math.min(...firstWaveSingletonRootCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveSingletonRootCompletionScoreMax =
    firstWaveSingletonRootCompletionScores.length > 0
      ? Number(Math.max(...firstWaveSingletonRootCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveSingletonRootExactCompletionScoreMin =
    firstWaveSingletonRootExactCompletionScores.length > 0
      ? Number(Math.min(...firstWaveSingletonRootExactCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveSingletonRootExactCompletionScoreMax =
    firstWaveSingletonRootExactCompletionScores.length > 0
      ? Number(Math.max(...firstWaveSingletonRootExactCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMin =
    firstWaveSingletonRootAdaptiveExactCompletionScores.length > 0
      ? Number(Math.min(...firstWaveSingletonRootAdaptiveExactCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMax =
    firstWaveSingletonRootAdaptiveExactCompletionScores.length > 0
      ? Number(Math.max(...firstWaveSingletonRootAdaptiveExactCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveMultiRootCompletionScoreMin =
    firstWaveMultiRootCompletionScores.length > 0
      ? Number(Math.min(...firstWaveMultiRootCompletionScores).toFixed(6))
      : null
  const parallelFirstWaveMultiRootCompletionScoreMax =
    firstWaveMultiRootCompletionScores.length > 0
      ? Number(Math.max(...firstWaveMultiRootCompletionScores).toFixed(6))
      : null
  await writeStartupProgress({
    phase: "ready_queue_built",
    workerCount,
    parallelChunkCount: chunks.length,
    parallelWaveCount: plannedWaveCount,
    totalEstimatedCost,
    parallelReadyQueueDepth: chunks.length,
  })
  const workerRootDir = path.join(resolvedOutDir, "_parallel_workers")
  const liveFloorPath = path.join(resolvedOutDir, "live_floor.json")
  await ensureDir(workerRootDir)
  const workerScript = path.join(cwd, "tools", "mine_perfect_prototypes_indexed.mjs")
  const orderingHeadWindow = resolveOrderingHeadWindow(cfg?.orderingHeadWindow)
  const searchStateCacheMaxBytes = Math.max(
    0,
    Math.floor(
      Number(
        cfg?.searchStateCacheMaxBytes ??
          options?.searchStateCacheMaxBytes ??
          128 * 1024 * 1024,
      ) || 0,
    ),
  )
  const externalBudgetRequestHeadroomStates = Math.max(
    1,
    Math.floor(
      Number(options?.externalBudgetRequestHeadroomStates ?? PARALLEL_BUDGET_REQUEST_HEADROOM_STATES) ||
        0,
    ),
  )
  const externalBudgetRequestSearchStates = Math.max(
    1,
    Math.floor(
      Number(options?.externalBudgetRequestSearchStates ?? PARALLEL_BUDGET_TOPUP_TRANCHE_SEARCH_STATES) ||
        0,
    ),
  )
  const externalBudgetRequestWaitMs = Math.max(
    1,
    Math.floor(
      Number(options?.externalBudgetRequestWaitMs ?? PARALLEL_BUDGET_REQUEST_WAIT_MS) || 0,
    ),
  )
  const externalBudgetDecisionPollMs = Math.max(
    10,
    Math.floor(
      Number(
        options?.externalBudgetDecisionPollMs ?? PARALLEL_EXTERNAL_BUDGET_DECISION_POLL_MS,
      ) || 0,
    ),
  )
  const workerEnv = {
    PERFECT_PROTO_DUCKDB_THREADS: String(process.env.PERFECT_PROTO_DUCKDB_THREADS ?? "2"),
    PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB: String(
      process.env.PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB ?? "3",
    ),
    NODE_OPTIONS: String(process.env.NODE_OPTIONS ?? ""),
  }
  let parallelBudgetRequestCount = 0
  let parallelBudgetGrantCount = 0
  let parallelBudgetAllowanceCount = 0
  let parallelBudgetAllowanceSearchStates = 0
  let parallelBudgetDenyCount = 0
  let parallelBudgetPendingCount = 0
  let parallelBudgetPendingActiveReclaimCount = 0
  let parallelBudgetPendingCompletedReclaimCount = 0
  let parallelBudgetPendingRequiredDeltaPeak = 0
  let parallelBudgetPendingWaitMs = 0
  let parallelBudgetTopupCount = 0
  let parallelBudgetTopupSearchStates = 0
  let parallelBudgetCommitRequestCount = 0
  let parallelBudgetCommitCount = 0
  let parallelBudgetCommittedSearchStates = 0
  let parallelBudgetUnusedAllowanceCount = 0
  let parallelAllowanceToCommitLagMs = 0
  let parallelCompletedChunkReclaimCount = 0
  let parallelCompletedChunkReclaimSearchStates = 0
  let parallelActiveReclaimAttemptCount = 0
  let parallelActiveReclaimCommitCount = 0
  let parallelActiveReclaimSearchStates = 0
  let parallelActiveReclaimSkippedStaleChunkCount = 0
  let parallelBudgetFastpathTickCount = 0
  let parallelBudgetFastpathServiceCount = 0
  let parallelBudgetFastpathHotTickCount = 0
  let parallelBudgetFastpathIdleTickCount = 0
  let parallelBudgetFastpathIdleSkipCount = 0
  let parallelBudgetFastpathServiceMs = 0
  let parallelWorkerSlotCompletionPollCount = 0
  let parallelWorkerSlotCompletionHotPollCount = 0
  let parallelWorkerSlotCompletionSteadyPollCount = 0
  let parallelWorkerSlotCompletionPollServiceMs = 0
  let parallelActiveChunkTelemetryRevision = 0
  let parallelLastObservedActiveChunkSnapshots = []
  await writeJsonAtomic(
    progressPath,
    buildParallelTimedProgressPayload({
      payload: {
        phase: "spawn_worker_slots",
        workerCount,
        parallelConfiguredMaxSearchStates: cfg.maxSearchStates,
        parallelChunkCount: chunks.length,
        parallelWaveCount: plannedWaveCount,
        parallelCompletedChunkCount: 0,
        parallelCompletedWaveCount: 0,
        completedEstimatedCost: 0,
        totalEstimatedCost,
        parallelGlobalKthHitFloor: null,
        parallelFloorSeededChunkCount: 0,
        parallelWaveMergeMs: 0,
        parallelChunkPlannerImbalanceRatio,
        parallelFirstWaveFrontierSplitCount,
        parallelFirstWaveLaunchSplitCount,
        parallelFirstWaveRootSeedMicroshardCount,
        parallelFirstWaveForcedSingletonMicroshardCount,
        parallelFirstWaveCompletionTargetLaunchCount,
        parallelFirstWaveExactCompletionProbeCount,
        parallelFirstWaveExactCompletionProbeSingletonCandidateCount,
        parallelFirstWaveExactCompletionProbeReachedTerminalCount,
        parallelFirstWaveExactCompletionProbeFoundFirstRuleCount,
        parallelFirstWaveExactCompletionProbeStateCap,
        parallelFirstWaveExactCompletionScoreMin,
        parallelFirstWaveExactCompletionScoreMax,
        parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount,
        parallelFirstWaveAdaptiveExactCompletionProbeCount,
        parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount,
        parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount,
        parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin,
        parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax,
        parallelFirstWaveAdaptiveExactCompletionScoreMin,
        parallelFirstWaveAdaptiveExactCompletionScoreMax,
        parallelFirstWaveSingletonRootChunkCount,
        parallelFirstWaveSingletonRootLaunchCount,
        parallelFirstWaveSingletonRootExactCompletionScoreMin,
        parallelFirstWaveSingletonRootExactCompletionScoreMax,
        parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMin,
        parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMax,
        parallelFirstWaveSingletonRootCompletionScoreMin,
        parallelFirstWaveSingletonRootCompletionScoreMax,
        parallelFirstWaveMultiRootChunkCount,
        parallelFirstWaveMultiRootLaunchCount,
        parallelFirstWaveMultiRootCompletionScoreMin,
        parallelFirstWaveMultiRootCompletionScoreMax,
        parallelActiveProgressLiveSampleCount: 0,
        parallelReadyQueueDepth: chunks.length,
        parallelDispatchCount: 0,
        parallelImmediateRefillCount: 0,
        parallelLiveFloorUpdateCount: 0,
        parallelLiveFloorRevision: 0,
        parallelFirstGlobalFloorElapsedMs: null,
        parallelLivePartialRuleRevisionCount: 0,
        parallelLivePartialRuleMergeMs: 0,
        parallelLivePartialFloorUpdateCount: 0,
        parallelFirstLivePartialFloorElapsedMs: null,
        parallelBootstrapChunkCount,
        parallelFirstChunkCompletionElapsedMs: null,
        parallelFirstBootstrapFloorElapsedMs: null,
        parallelBootstrapFloorSeededLaunchCount: 0,
        parallelActiveLiveRuleCount: 0,
        parallelActiveAllocatedSearchBudget: 0,
        parallelActiveEffectiveAllocatedSearchBudget: 0,
        parallelBudgetRequestCount: 0,
        parallelBudgetGrantCount: 0,
        parallelBudgetAllowanceCount: 0,
        parallelBudgetAllowanceSearchStates: 0,
        parallelBudgetDenyCount: 0,
        parallelBudgetPendingCount: 0,
        parallelBudgetPendingActiveReclaimCount: 0,
        parallelBudgetPendingCompletedReclaimCount: 0,
        parallelBudgetPendingRequiredDeltaPeak: 0,
        parallelBudgetPendingWaitMs: 0,
        parallelBudgetTopupCount: 0,
        parallelBudgetTopupSearchStates: 0,
        parallelBudgetCommitRequestCount: 0,
        parallelBudgetCommitCount: 0,
        parallelBudgetCommittedSearchStates: 0,
        parallelBudgetUnusedAllowanceCount: 0,
        parallelOutstandingAllowanceSearchStates: 0,
        parallelOutstandingAllowanceChunkCount: 0,
        parallelAllowanceToCommitLagMs: 0,
        parallelBudgetFastpathTickCount: 0,
        parallelBudgetFastpathServiceCount: 0,
        parallelBudgetFastpathHotTickCount: 0,
        parallelBudgetFastpathIdleTickCount: 0,
        parallelBudgetFastpathIdleSkipCount: 0,
        parallelBudgetFastpathServiceMs: 0,
        parallelWorkerSlotCompletionPollCount: 0,
        parallelWorkerSlotCompletionHotPollCount: 0,
        parallelWorkerSlotCompletionSteadyPollCount: 0,
        parallelWorkerSlotCompletionPollServiceMs: 0,
        parallelActiveChunkTelemetryRevision: 0,
        parallelLastObservedActiveChunkSnapshots: [],
        parallelCompletedChunkReclaimCount: 0,
        parallelCompletedChunkReclaimSearchStates: 0,
        parallelActiveReclaimAttemptCount: 0,
        parallelActiveReclaimCommitCount: 0,
        parallelActiveReclaimSearchStates: 0,
        parallelActiveReclaimSkippedStaleChunkCount: 0,
        parallelSlotIdleMs: 0,
        parallelWorkerSpawnCount: 0,
        parallelWorkerSlotReuseCount: 0,
        parallelWorkerWarmLaunchCount: 0,
        parallelWorkerColdStartMs: 0,
        parallelWorkerWarmLaunchMs: 0,
        parallelActiveChunkSnapshots: [],
        mergedObservedRuleCount: 0,
        mergedLiveRuleCount: 0,
        exploredStates: 0,
        parallelActiveChunkCount: 0,
        parallelActiveWaveExploredStates: 0,
        parallelActiveWaveRulesCollected: 0,
        parallelActiveWaveMemoLookupMs: 0,
        parallelActiveWaveEtaSeconds: null,
        parallelRemainingSearchBudget: cfg.maxSearchStates,
        parallelRemainingGrantableSearchBudget: cfg.maxSearchStates,
        parallelActiveWaveEstimatedCost: 0,
        ...buildParallelPlanningMetrics(),
      },
      startedAtMs: parallelStartedAt,
      completedEstimatedCost: 0,
      totalEstimatedCost,
    }),
  )
  await writeJsonAtomic(liveFloorPath, {
    version: 1,
    revision: 0,
    kthHitFloor: null,
    observedRuleCount: 0,
    updatedAt: new Date().toISOString(),
  })

  const mergedBySignature = new Map()
  const workerSummaries = []
  const chunkRunRecords = []
  const rejectedRules = []
  let exploredStates = 0
  let workerTruncatedByMaxSearchStates = false
  let mergedObservedRuleCount = 0
  let mergedLiveRuleCount = 0
  let partialMergePeakBucketCount = 0
  let partialMergePeakLiveRuleCount = 0
  let partialMergeEvictedByHitFloorCount = 0
  let partialMergeTieBandRuleCount = 0
  let partialMergeTieBandBucketCount = 0
  let partialMergePeakTieBandRuleCount = 0
  let partialMergeCompactedBucketCount = 0
  let partialMergeCompactedRuleCount = 0
  let parallelCompletedChunkCount = 0
  let parallelCompletedWaveCount = 0
  let parallelFloorSeededChunkCount = 0
  let parallelWaveMergeMs = 0
  let completedEstimatedCost = 0
  let parallelActiveProgressLiveSampleCount = 0
  let parallelDispatchCount = 0
  let parallelImmediateRefillCount = 0
  let parallelLiveFloorUpdateCount = 0
  let parallelLiveFloorRevision = 0
  let parallelFirstGlobalFloorElapsedMs = null
  let parallelLivePartialRuleRevisionCount = 0
  let parallelLivePartialRuleMergeMs = 0
  let parallelLivePartialFloorUpdateCount = 0
  let parallelFirstLivePartialFloorElapsedMs = null
  let parallelFirstChunkCompletionElapsedMs = null
  let parallelFirstBootstrapFloorElapsedMs = null
  let parallelBootstrapFloorSeededLaunchCount = 0
  let parallelActiveLiveRuleCount = 0
  let parallelSlotIdleMs = 0
  let parallelWorkerSpawnCount = 0
  let parallelWorkerSlotReuseCount = 0
  let parallelWorkerWarmLaunchCount = 0
  let parallelWorkerColdStartMs = 0
  let parallelWorkerWarmLaunchMs = 0
  let parallelCurrentGlobalKthHitFloor = null
  const latestLivePartialSnapshotsByChunk = new Map()
  const partialMergeTopKTracker = createPerfectPrototypeTopKHitTracker({
    maxRules: cfg.maxRules,
  })
  const partialMergeRuleCountsByHit = new Map()
  const partialMergeBucketCountsByHit = new Map()
  const partialMergeSignatureHitCounts = new Map()
  const partialMergeSignaturesByHit = new Map()
  const getPartialMergeRuleHitCount = (rule) =>
    Number(rule?.trainHitCount ?? rule?.matchHitCount ?? 0)
  const adjustCountMap = (map, key, delta) => {
    if (!Number.isInteger(key) || key < 0 || delta === 0) return
    const nextValue = Number(map.get(key) ?? 0) + delta
    if (nextValue > 0) {
      map.set(key, nextValue)
    } else {
      map.delete(key)
    }
  }
  const adjustSignatureHitCount = (signature, hitCount, delta) => {
    if (!Number.isInteger(hitCount) || hitCount < 0 || delta === 0) return
    const perSignature = partialMergeSignatureHitCounts.get(signature) ?? new Map()
    const previousBucketValue = Number(perSignature.get(hitCount) ?? 0)
    const nextBucketValue = previousBucketValue + delta
    const signaturesForHit = partialMergeSignaturesByHit.get(hitCount) ?? new Set()
    if (nextBucketValue > 0) {
      perSignature.set(hitCount, nextBucketValue)
      partialMergeSignatureHitCounts.set(signature, perSignature)
    } else {
      perSignature.delete(hitCount)
      if (perSignature.size > 0) {
        partialMergeSignatureHitCounts.set(signature, perSignature)
      } else {
        partialMergeSignatureHitCounts.delete(signature)
      }
    }
    if (previousBucketValue < 1 && nextBucketValue > 0) {
      signaturesForHit.add(signature)
      partialMergeSignaturesByHit.set(hitCount, signaturesForHit)
    } else if (previousBucketValue > 0 && nextBucketValue < 1) {
      signaturesForHit.delete(signature)
      if (signaturesForHit.size > 0) {
        partialMergeSignaturesByHit.set(hitCount, signaturesForHit)
      } else {
        partialMergeSignaturesByHit.delete(hitCount)
      }
    }
    adjustCountMap(partialMergeRuleCountsByHit, hitCount, delta)
    if (previousBucketValue < 1 && nextBucketValue > 0) {
      adjustCountMap(partialMergeBucketCountsByHit, hitCount, 1)
    } else if (previousBucketValue > 0 && nextBucketValue < 1) {
      adjustCountMap(partialMergeBucketCountsByHit, hitCount, -1)
    }
  }
  const notePartialMergeRuleInserted = (signature, rule) => {
    mergedLiveRuleCount += 1
    adjustSignatureHitCount(signature, getPartialMergeRuleHitCount(rule), 1)
  }
  const notePartialMergeRuleRemoved = (signature, rule) => {
    mergedLiveRuleCount = Math.max(0, mergedLiveRuleCount - 1)
    adjustSignatureHitCount(signature, getPartialMergeRuleHitCount(rule), -1)
  }
  const notePartialMergeRuleReplaced = (signature, previousRule, nextRule) => {
    const previousHitCount = getPartialMergeRuleHitCount(previousRule)
    const nextHitCount = getPartialMergeRuleHitCount(nextRule)
    if (previousHitCount === nextHitCount) return
    adjustSignatureHitCount(signature, previousHitCount, -1)
    adjustSignatureHitCount(signature, nextHitCount, 1)
  }
  const updateTieBandStats = (kthHitFloor) => {
    if (!Number.isInteger(kthHitFloor) || kthHitFloor <= 0) {
      partialMergeTieBandRuleCount = 0
      partialMergeTieBandBucketCount = 0
      return
    }
    const tieRuleCount = Number(partialMergeRuleCountsByHit.get(kthHitFloor) ?? 0)
    const tieBucketCount = Number(partialMergeBucketCountsByHit.get(kthHitFloor) ?? 0)
    partialMergeTieBandRuleCount = tieRuleCount
    partialMergeTieBandBucketCount = tieBucketCount
    partialMergePeakTieBandRuleCount = Math.max(partialMergePeakTieBandRuleCount, tieRuleCount)
  }
  const updatePartialMergePeaks = () => {
    partialMergePeakBucketCount = Math.max(partialMergePeakBucketCount, mergedBySignature.size)
    partialMergePeakLiveRuleCount = Math.max(partialMergePeakLiveRuleCount, mergedLiveRuleCount)
    updateTieBandStats(partialMergeTopKTracker.getKthHitFloor())
  }
  const computeCompletedLogicalWaveCount = ({ totalCompletedChunkCount }) => {
    const completedDispatchGroups = new Set()
    for (const chunkRun of chunkRunRecords) {
      if (chunkRun.merged !== true) continue
      const dispatchOrder = Number(chunkRun?.dispatchOrder ?? -1)
      if (dispatchOrder < 0) continue
      completedDispatchGroups.add(Math.floor(dispatchOrder / workerCount))
    }
    let contiguousCompletedDispatchGroups = 0
    while (completedDispatchGroups.has(contiguousCompletedDispatchGroups)) {
      contiguousCompletedDispatchGroups += 1
    }
    if (totalCompletedChunkCount >= chunks.length) {
      return plannedWaveCount
    }
    return contiguousCompletedDispatchGroups
  }
  const getChunkRunCommittedAllocatedSearchBudget = (chunkRun) =>
    Math.max(0, Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? chunkRun?.allocatedMaxSearchStates ?? 0))
  const recordChunkRunBudgetRevisionSearchBudget = ({
    chunkRun,
    revision,
    allocatedMaxSearchStates,
  }) => {
    if (!chunkRun || typeof chunkRun !== "object") return
    const resolvedRevision = Math.floor(Number(revision) || 0)
    const resolvedAllocatedMaxSearchStates = Math.max(
      0,
      Math.floor(Number(allocatedMaxSearchStates) || 0),
    )
    if (!Number.isInteger(resolvedRevision) || resolvedRevision < 0) return
    if (!Number.isInteger(resolvedAllocatedMaxSearchStates) || resolvedAllocatedMaxSearchStates < 1) {
      return
    }
    if (!(chunkRun.budgetRevisionSearchBudgetHistory instanceof Map)) {
      chunkRun.budgetRevisionSearchBudgetHistory = new Map()
    }
    chunkRun.budgetRevisionSearchBudgetHistory.set(
      resolvedRevision,
      resolvedAllocatedMaxSearchStates,
    )
  }
  const resolveChunkRunBudgetRevisionSearchBudget = ({ chunkRun, revision }) => {
    const resolvedRevision = Math.floor(Number(revision) || 0)
    if (!Number.isInteger(resolvedRevision) || resolvedRevision < 0) {
      return null
    }
    const history = chunkRun?.budgetRevisionSearchBudgetHistory
    if (!(history instanceof Map)) return null
    if (history.has(resolvedRevision)) {
      return Math.max(0, Number(history.get(resolvedRevision) ?? 0))
    }
    return null
  }
  const getChunkRunApprovedAllocatedSearchBudget = (chunkRun) =>
    Math.max(
      getChunkRunCommittedAllocatedSearchBudget(chunkRun),
      Number(
        chunkRun?.pendingAllocatedMaxSearchStates ??
          chunkRun?.effectiveAllocatedMaxSearchStates ??
          chunkRun?.allocatedMaxSearchStates ??
          0,
      ),
    )
  const getActiveAllocatedSearchBudget = ({ activeChunkRuns }) =>
    activeChunkRuns.reduce(
      (sum, chunkRun) => sum + getChunkRunCommittedAllocatedSearchBudget(chunkRun),
      0,
    )
  const getChunkRunOutstandingAllowanceSearchBudget = (chunkRun) =>
    Math.max(
      0,
      getChunkRunApprovedAllocatedSearchBudget(chunkRun) -
        getChunkRunCommittedAllocatedSearchBudget(chunkRun),
    )
  const getActiveOutstandingAllowanceSearchBudget = ({ activeChunkRuns }) =>
    activeChunkRuns.reduce(
      (sum, chunkRun) => sum + getChunkRunOutstandingAllowanceSearchBudget(chunkRun),
      0,
    )
  const getActiveOutstandingAllowanceChunkCount = ({ activeChunkRuns }) =>
    activeChunkRuns.reduce(
      (sum, chunkRun) => sum + (getChunkRunOutstandingAllowanceSearchBudget(chunkRun) > 0 ? 1 : 0),
      0,
    )
  const getActiveInitialAllocatedSearchBudget = ({ activeChunkRuns }) =>
    activeChunkRuns.reduce(
      (sum, chunkRun) => sum + Number(chunkRun?.allocatedMaxSearchStates ?? 0),
      0,
    )
  const getRemainingGrantableSearchBudget = ({ activeChunkRuns }) =>
    Math.max(
      0,
      cfg.maxSearchStates - exploredStates - getActiveAllocatedSearchBudget({ activeChunkRuns }),
    )
  const resolveChunkRunObservedProgressAgeMs = ({ chunkRun, progressJson = null }) => {
    const progressUpdatedAtText = String(progressJson?.updatedAt ?? "").trim()
    const progressUpdatedAtMs =
      progressUpdatedAtText.length > 0 && Number.isFinite(Date.parse(progressUpdatedAtText))
        ? Date.parse(progressUpdatedAtText)
        : null
    const lastObservedAtMs = Number(chunkRun?.lastLiveStateObservedAtMs ?? 0)
    const observationLagMs =
      Number.isFinite(lastObservedAtMs) && lastObservedAtMs > 0
        ? Math.max(0, Date.now() - lastObservedAtMs)
        : 0
    if (!Number.isFinite(progressUpdatedAtMs) || progressUpdatedAtMs == null) {
      return Number.POSITIVE_INFINITY
    }
    return Math.max(0, Date.now() - progressUpdatedAtMs) + observationLagMs
  }
  const resolveChunkRunLiveBudgetFloorSearchBudget = ({
    chunkRun,
    observedBudgetState,
    progressAgeMs = Number.POSITIVE_INFINITY,
  }) => {
    const observedExploredStates = Math.max(
      0,
      Math.floor(Number(observedBudgetState?.exploredStates ?? 0) || 0),
    )
    const baseFloor = Math.max(1, Number(chunkRun?.guardBandAllocatedSearchStates ?? 0) + 1)
    const staleProgress = !Number.isFinite(progressAgeMs)
      ? true
      : progressAgeMs > PARALLEL_ACTIVE_CHUNK_COMPLETION_PROGRESS_STALE_MS
    if (staleProgress) {
      return {
        floorSearchBudget: getChunkRunCommittedAllocatedSearchBudget(chunkRun),
        staleProgress: true,
      }
    }
    return {
      floorSearchBudget: Math.max(
        baseFloor,
        observedExploredStates + PARALLEL_ACTIVE_RECLAIM_PROGRESS_MARGIN_STATES,
      ),
      staleProgress: false,
    }
  }
  const measureChunkRunReclaimableSearchBudget = ({
    chunkRun,
    exploredStates: candidateExploredStates,
    effectiveAllocatedMaxSearchStates: candidateEffectiveAllocatedMaxSearchStates,
  }) =>
    Math.max(
      0,
      Math.max(
        getChunkRunCommittedAllocatedSearchBudget(chunkRun),
        Number(candidateEffectiveAllocatedMaxSearchStates ?? 0),
      ) - Math.max(0, Number(candidateExploredStates ?? 0)),
    )
  const measureCompletedUnreclaimedSearchBudget = async () => {
    let completedUnreclaimedSearchBudget = 0
    for (const candidateChunkRun of chunkRunRecords) {
      if (candidateChunkRun?.completed !== true || candidateChunkRun?.reclaimed === true) continue
      const summaryJson =
        candidateChunkRun?.summaryJson ??
        (await readControlPlaneJsonIfExists(
          candidateChunkRun.summaryPath,
          "Parallel indexed miner completed chunk summary file",
        ))
      if (!summaryJson) continue
      completedUnreclaimedSearchBudget += measureChunkRunReclaimableSearchBudget({
        chunkRun: candidateChunkRun,
        exploredStates: Number(summaryJson?.exploredStates ?? 0),
        effectiveAllocatedMaxSearchStates: Number(
          summaryJson?.rejectionSummary?.effectiveAllocatedMaxSearchStates ??
            candidateChunkRun?.effectiveAllocatedMaxSearchStates ??
            candidateChunkRun?.allocatedMaxSearchStates ??
            0,
        ),
      })
    }
    return completedUnreclaimedSearchBudget
  }
  const measureActiveSiblingReclaimableSearchBudget = async ({
    requesterChunkRun,
    activeChunkRuns,
  }) => {
    let activeSiblingReclaimableSearchBudget = 0
    for (const candidateChunkRun of activeChunkRuns) {
      if (!candidateChunkRun || candidateChunkRun === requesterChunkRun) continue
      if (candidateChunkRun.completed === true) continue
      const progressJson = await readControlPlaneJsonIfExists(
        candidateChunkRun.progressPath,
        "Parallel indexed miner sibling chunk progress file",
      )
      const summaryJson =
        candidateChunkRun.completed === true ||
        (!progressJson && pathExists(candidateChunkRun.summaryPath))
          ? await readControlPlaneJsonIfExists(
              candidateChunkRun.summaryPath,
              "Parallel indexed miner sibling chunk summary file",
            )
          : null
      const budgetRequest = await readChunkRunBudgetRequest(candidateChunkRun)
      const observedBudgetState = resolveParallelChunkRunObservedBudgetState({
        chunkRun: candidateChunkRun,
        progressJson,
        summaryJson,
        budgetRequest,
        committedAllocatedMaxSearchStates: getChunkRunCommittedAllocatedSearchBudget(
          candidateChunkRun,
        ),
      })
      const observedProgressAgeMs = resolveChunkRunObservedProgressAgeMs({
        chunkRun: candidateChunkRun,
        progressJson,
      })
      const liveBudgetFloor = resolveChunkRunLiveBudgetFloorSearchBudget({
        chunkRun: candidateChunkRun,
        observedBudgetState,
        progressAgeMs: observedProgressAgeMs,
      })
      activeSiblingReclaimableSearchBudget += Math.max(
        0,
        getChunkRunCommittedAllocatedSearchBudget(candidateChunkRun) -
          liveBudgetFloor.floorSearchBudget,
      )
    }
    return activeSiblingReclaimableSearchBudget
  }
  const measureBudgetRecoveryWindow = async ({ requesterChunkRun = null, activeChunkRuns }) => {
    const completedUnreclaimedSearchBudget = await measureCompletedUnreclaimedSearchBudget()
    const activeSiblingReclaimableSearchBudget = await measureActiveSiblingReclaimableSearchBudget({
      requesterChunkRun,
      activeChunkRuns,
    })
    return {
      completedUnreclaimedSearchBudget,
      activeSiblingReclaimableSearchBudget,
      totalRecoverableSearchBudget:
        completedUnreclaimedSearchBudget + activeSiblingReclaimableSearchBudget,
    }
  }
  const notePendingBudgetRecoveryWindow = ({
    completedUnreclaimedSearchBudget = 0,
    activeSiblingReclaimableSearchBudget = 0,
    requiredDelta = 0,
  }) => {
    if (completedUnreclaimedSearchBudget > 0) {
      parallelBudgetPendingCompletedReclaimCount += 1
    }
    if (activeSiblingReclaimableSearchBudget > 0) {
      parallelBudgetPendingActiveReclaimCount += 1
    }
    parallelBudgetPendingRequiredDeltaPeak = Math.max(
      parallelBudgetPendingRequiredDeltaPeak,
      Math.max(0, Number(requiredDelta ?? 0)),
    )
  }
  const writeLiveFloor = async ({
    kthHitFloor,
    observedRuleCount = mergedObservedRuleCount,
    source = "completed",
  }) => {
    if (!Number.isInteger(kthHitFloor) || kthHitFloor < 1) return
    if (
      Number.isInteger(parallelCurrentGlobalKthHitFloor) &&
      parallelCurrentGlobalKthHitFloor > 0 &&
      kthHitFloor <= parallelCurrentGlobalKthHitFloor
    ) {
      return
    }
    parallelLiveFloorRevision += 1
    parallelLiveFloorUpdateCount += 1
    parallelCurrentGlobalKthHitFloor = kthHitFloor
    if (parallelFirstGlobalFloorElapsedMs == null) {
      parallelFirstGlobalFloorElapsedMs = Date.now() - parallelStartedAt
    }
    if (source === "live_partial") {
      parallelLivePartialFloorUpdateCount += 1
      if (parallelFirstLivePartialFloorElapsedMs == null) {
        parallelFirstLivePartialFloorElapsedMs = Date.now() - parallelStartedAt
      }
      if (
        parallelFirstChunkCompletionElapsedMs == null &&
        parallelFirstBootstrapFloorElapsedMs == null
      ) {
        parallelFirstBootstrapFloorElapsedMs = Date.now() - parallelStartedAt
      }
    }
    await writeJsonAtomic(liveFloorPath, {
      version: 1,
      revision: parallelLiveFloorRevision,
      kthHitFloor,
      observedRuleCount,
      updatedAt: new Date().toISOString(),
    })
  }
  const writeLiveBudget = async ({ chunkRun, nextAllocatedMaxSearchStates, revision = null }) => {
    const resolvedNextAllocatedMaxSearchStates = Math.floor(
      Number(nextAllocatedMaxSearchStates ?? 0) || 0,
    )
    const previousEffectiveAllocatedMaxSearchStates = getChunkRunCommittedAllocatedSearchBudget(chunkRun)
    const minimumAllocatedMaxSearchStates = Math.max(
      1,
      Number(chunkRun?.guardBandAllocatedSearchStates ?? 0) + 1,
    )
    if (
      !Number.isInteger(resolvedNextAllocatedMaxSearchStates) ||
      resolvedNextAllocatedMaxSearchStates < minimumAllocatedMaxSearchStates
    ) {
      throw new Error(
        [
          "Parallel indexed miner live budget revision fell below the chunk base allocation.",
          `chunkIndex=${Number(chunkRun?.chunkIndex ?? -1)}`,
          `baseAllocatedMaxSearchStates=${minimumAllocatedMaxSearchStates}`,
          `nextAllocatedMaxSearchStates=${resolvedNextAllocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    if (resolvedNextAllocatedMaxSearchStates === previousEffectiveAllocatedMaxSearchStates) {
      return false
    }
    const resolvedRevision =
      revision == null
        ? Number(chunkRun?.liveBudgetRevision ?? 0) + 1
        : Math.floor(Number(revision) || 0)
    if (!Number.isInteger(resolvedRevision) || resolvedRevision < 1) {
      throw new Error(
        `Parallel indexed miner requires a positive committed budget revision: ${resolvedRevision}`,
      )
    }
    if (resolvedRevision <= Number(chunkRun?.liveBudgetRevision ?? 0)) {
      throw new Error(
        [
          "Parallel indexed miner live budget revision must advance monotonically.",
          `chunkIndex=${Number(chunkRun?.chunkIndex ?? -1)}`,
          `previousRevision=${Number(chunkRun?.liveBudgetRevision ?? 0)}`,
          `nextRevision=${resolvedRevision}`,
        ].join("\n"),
      )
    }
    chunkRun.liveBudgetRevision = resolvedRevision
    chunkRun.effectiveAllocatedMaxSearchStates = resolvedNextAllocatedMaxSearchStates
    recordChunkRunBudgetRevisionSearchBudget({
      chunkRun,
      revision: resolvedRevision,
      allocatedMaxSearchStates: resolvedNextAllocatedMaxSearchStates,
    })
    await writeJsonAtomic(chunkRun.liveBudgetPath, {
      version: 1,
      revision: chunkRun.liveBudgetRevision,
      chunkIndex: chunkRun.chunkIndex,
      allocatedMaxSearchStates: resolvedNextAllocatedMaxSearchStates,
      updatedAt: new Date().toISOString(),
    })
    return true
  }
  const maybeReclaimActiveSiblingSearchBudget = async ({
    requesterChunkRun,
    activeChunkRuns,
    requiredDelta,
  }) => {
    const normalizedRequiredDelta = Math.max(0, Math.floor(Number(requiredDelta) || 0))
    if (normalizedRequiredDelta < 1) {
      return { reclaimedSearchStates: 0, reclaimedChunkCount: 0 }
    }
    parallelActiveReclaimAttemptCount += 1
    const donorCandidates = []
    for (const candidateChunkRun of activeChunkRuns) {
      if (!candidateChunkRun || candidateChunkRun === requesterChunkRun) continue
      if (candidateChunkRun.completed === true) continue
      const progressJson = await readControlPlaneJsonIfExists(
        candidateChunkRun.progressPath,
        "Parallel indexed miner sibling chunk progress file",
      )
      const summaryJson =
        candidateChunkRun.completed === true ||
        (!progressJson && pathExists(candidateChunkRun.summaryPath))
          ? await readControlPlaneJsonIfExists(
              candidateChunkRun.summaryPath,
              "Parallel indexed miner sibling chunk summary file",
            )
          : null
      const budgetRequest = await readChunkRunBudgetRequest(candidateChunkRun)
      const observedBudgetState = resolveParallelChunkRunObservedBudgetState({
        chunkRun: candidateChunkRun,
        progressJson,
        summaryJson,
        budgetRequest,
        committedAllocatedMaxSearchStates: getChunkRunCommittedAllocatedSearchBudget(
          candidateChunkRun,
        ),
      })
      const observedProgressAgeMs = resolveChunkRunObservedProgressAgeMs({
        chunkRun: candidateChunkRun,
        progressJson,
      })
      const liveBudgetFloor = resolveChunkRunLiveBudgetFloorSearchBudget({
        chunkRun: candidateChunkRun,
        observedBudgetState,
        progressAgeMs: observedProgressAgeMs,
      })
      const reclaimableSearchStates = Math.max(
        0,
        getChunkRunCommittedAllocatedSearchBudget(candidateChunkRun) -
          liveBudgetFloor.floorSearchBudget,
      )
      if (reclaimableSearchStates < 1) {
        if (liveBudgetFloor.staleProgress === true) {
          parallelActiveReclaimSkippedStaleChunkCount += 1
        }
        continue
      }
      donorCandidates.push({
        chunkRun: candidateChunkRun,
        reclaimableSearchStates,
        floorSearchBudget: liveBudgetFloor.floorSearchBudget,
        dispatchOrder: Number(candidateChunkRun?.dispatchOrder ?? 0),
        chunkIndex: Number(candidateChunkRun?.chunkIndex ?? -1),
      })
    }
    donorCandidates.sort((left, right) => {
      if (right.reclaimableSearchStates !== left.reclaimableSearchStates) {
        return right.reclaimableSearchStates - left.reclaimableSearchStates
      }
      if (right.dispatchOrder !== left.dispatchOrder) {
        return right.dispatchOrder - left.dispatchOrder
      }
      return right.chunkIndex - left.chunkIndex
    })
    let remainingDelta = normalizedRequiredDelta
    let reclaimedSearchStates = 0
    let reclaimedChunkCount = 0
    for (const donor of donorCandidates) {
      if (remainingDelta < 1) break
      const currentCommittedAllocatedMaxSearchStates = getChunkRunCommittedAllocatedSearchBudget(
        donor.chunkRun,
      )
      const reclaimDelta = Math.min(remainingDelta, donor.reclaimableSearchStates)
      if (reclaimDelta < 1) continue
      const nextAllocatedMaxSearchStates = Math.max(
        donor.floorSearchBudget,
        currentCommittedAllocatedMaxSearchStates - reclaimDelta,
      )
      const committed = await writeLiveBudget({
        chunkRun: donor.chunkRun,
        nextAllocatedMaxSearchStates,
      })
      if (committed !== true) continue
      reclaimedChunkCount += 1
      const actualReclaimDelta =
        currentCommittedAllocatedMaxSearchStates - nextAllocatedMaxSearchStates
      reclaimedSearchStates += actualReclaimDelta
      remainingDelta = Math.max(0, remainingDelta - actualReclaimDelta)
    }
    if (reclaimedSearchStates > 0) {
      parallelActiveReclaimCommitCount += 1
      parallelActiveReclaimSearchStates += reclaimedSearchStates
    }
    return {
      reclaimedSearchStates,
      reclaimedChunkCount,
    }
  }
  const writeBudgetDecision = async ({
    chunkRun,
    requestRevision,
    decision,
    allocatedMaxSearchStates,
    approvedAdditionalSearchStates = 0,
    budgetRevision = null,
    reason = null,
  }) => {
    const normalizedDecision = String(decision ?? "").trim().toLowerCase()
    if (!["granted", "pending", "denied"].includes(normalizedDecision)) {
      throw new Error(`Parallel indexed miner requires a valid budget decision: ${decision}`)
    }
    const updatedAt = new Date().toISOString()
    await writeJsonAtomic(chunkRun.budgetDecisionPath, {
      version: 1,
      requestRevision,
      chunkIndex: chunkRun.chunkIndex,
      decision: normalizedDecision,
      allocatedMaxSearchStates,
      approvedAdditionalSearchStates,
      grantedAdditionalSearchStates: approvedAdditionalSearchStates,
      budgetRevision,
      reason,
      updatedAt,
    })
    const previousDecisionType = String(chunkRun?.lastBudgetDecisionType ?? "")
      .trim()
      .toLowerCase()
    const previousDecisionRequestRevision = Number(chunkRun?.lastBudgetDecisionRequestRevision ?? 0)
    chunkRun.lastBudgetDecisionRequestRevision = requestRevision
    chunkRun.lastBudgetDecisionType = normalizedDecision
    chunkRun.lastBudgetDecisionUpdatedAt = updatedAt
    if (
      normalizedDecision === "pending" &&
      (previousDecisionType !== "pending" || previousDecisionRequestRevision !== requestRevision)
    ) {
      chunkRun.pendingBudgetDecisionStartedAtMs = Date.now()
      chunkRun.pendingBudgetDecisionRequestRevision = requestRevision
      parallelBudgetPendingCount += 1
    }
    if (
      normalizedDecision !== "pending" &&
      Number(chunkRun?.pendingBudgetDecisionRequestRevision ?? 0) === requestRevision &&
      Number.isFinite(Number(chunkRun?.pendingBudgetDecisionStartedAtMs))
    ) {
      parallelBudgetPendingWaitMs += Math.max(
        0,
        Date.now() - Number(chunkRun.pendingBudgetDecisionStartedAtMs),
      )
      chunkRun.pendingBudgetDecisionStartedAtMs = null
      chunkRun.pendingBudgetDecisionRequestRevision = 0
    }
    if (normalizedDecision === "denied") {
      chunkRun.budgetTopupDeniedCount = Math.max(
        0,
        Number(chunkRun?.budgetTopupDeniedCount ?? 0) + 1,
      )
      parallelBudgetDenyCount += 1
    }
    if (normalizedDecision !== "pending") {
      await removeControlPlaneJsonIfExists(
        chunkRun?.budgetRequestPath,
        "Parallel indexed miner chunk budget request file",
      )
    }
  }
  async function readChunkRunBudgetRequest(chunkRun) {
    const payload = await readControlPlaneJsonIfExists(
      chunkRun.budgetRequestPath,
      "Parallel indexed miner chunk budget request file",
    )
    if (!payload) return null
    const revision = Math.floor(Number(payload?.revision) || 0)
    const payloadChunkIndex =
      payload?.chunkIndex == null ? null : Math.floor(Number(payload.chunkIndex) || 0)
    const exploredStatesAtRequest = Math.floor(Number(payload?.exploredStates) || 0)
    const effectiveAllocatedMaxSearchStates = Math.floor(
      Number(payload?.effectiveAllocatedMaxSearchStates) || 0,
    )
    const requestedAdditionalSearchStates = Math.floor(
      Number(payload?.requestedAdditionalSearchStates) || 0,
    )
    const reason = String(payload?.reason ?? "").trim() || null
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error(
        `Parallel indexed miner chunk budget request has invalid revision: ${chunkRun.budgetRequestPath}`,
      )
    }
    if (!Number.isInteger(payloadChunkIndex) || payloadChunkIndex !== Number(chunkRun?.chunkIndex ?? -1)) {
      throw new Error(
        [
          "Parallel indexed miner chunk budget request has an unexpected chunkIndex.",
          `path=${chunkRun.budgetRequestPath}`,
          `expectedChunkIndex=${chunkRun.chunkIndex}`,
          `receivedChunkIndex=${payloadChunkIndex}`,
        ].join("\n"),
      )
    }
    if (!Number.isInteger(exploredStatesAtRequest) || exploredStatesAtRequest < 0) {
      throw new Error(
        `Parallel indexed miner chunk budget request has invalid exploredStates: ${chunkRun.budgetRequestPath}`,
      )
    }
    if (
      !Number.isInteger(effectiveAllocatedMaxSearchStates) ||
      effectiveAllocatedMaxSearchStates < Number(chunkRun?.allocatedMaxSearchStates ?? 1)
    ) {
      throw new Error(
        `Parallel indexed miner chunk budget request has invalid effectiveAllocatedMaxSearchStates: ${chunkRun.budgetRequestPath}`,
      )
    }
    if (!Number.isInteger(requestedAdditionalSearchStates) || requestedAdditionalSearchStates < 1) {
      throw new Error(
        `Parallel indexed miner chunk budget request has invalid requestedAdditionalSearchStates: ${chunkRun.budgetRequestPath}`,
      )
    }
    return {
      revision,
      exploredStatesAtRequest,
      effectiveAllocatedMaxSearchStates,
      requestedAdditionalSearchStates,
      reason,
    }
  }
  const readChunkRunBudgetCommit = async (chunkRun) => {
    const payload = await readControlPlaneJsonIfExists(
      chunkRun.budgetCommitPath,
      "Parallel indexed miner chunk budget commit file",
    )
    if (!payload) return null
    const requestRevision = Math.floor(Number(payload?.requestRevision) || 0)
    const payloadChunkIndex =
      payload?.chunkIndex == null ? null : Math.floor(Number(payload.chunkIndex) || 0)
    const budgetRevision = Math.floor(Number(payload?.budgetRevision) || 0)
    const allocatedMaxSearchStates = Math.floor(Number(payload?.allocatedMaxSearchStates) || 0)
    if (!Number.isInteger(requestRevision) || requestRevision < 1) {
      throw new Error(
        `Parallel indexed miner chunk budget commit has invalid requestRevision: ${chunkRun.budgetCommitPath}`,
      )
    }
    if (!Number.isInteger(payloadChunkIndex) || payloadChunkIndex !== Number(chunkRun?.chunkIndex ?? -1)) {
      throw new Error(
        [
          "Parallel indexed miner chunk budget commit has an unexpected chunkIndex.",
          `path=${chunkRun.budgetCommitPath}`,
          `expectedChunkIndex=${chunkRun.chunkIndex}`,
          `receivedChunkIndex=${payloadChunkIndex}`,
        ].join("\n"),
      )
    }
    if (!Number.isInteger(budgetRevision) || budgetRevision < 1) {
      throw new Error(
        `Parallel indexed miner chunk budget commit has invalid budgetRevision: ${chunkRun.budgetCommitPath}`,
      )
    }
    if (
      !Number.isInteger(allocatedMaxSearchStates) ||
      allocatedMaxSearchStates < Number(chunkRun?.allocatedMaxSearchStates ?? 1)
    ) {
      throw new Error(
        `Parallel indexed miner chunk budget commit has invalid allocatedMaxSearchStates: ${chunkRun.budgetCommitPath}`,
      )
    }
    return {
      requestRevision,
      budgetRevision,
      allocatedMaxSearchStates,
    }
  }
  const maybeCommitChunkRunBudget = async ({ chunkRun, activeChunkRuns }) => {
    const payload = await readChunkRunBudgetCommit(chunkRun)
    if (!payload) return false
    if (payload.budgetRevision <= Number(chunkRun?.liveBudgetRevision ?? 0)) {
      await removeControlPlaneJsonIfExists(
        chunkRun?.budgetCommitPath,
        "Parallel indexed miner chunk budget commit file",
      )
      return false
    }
    if (payload.budgetRevision > Number(chunkRun?.lastObservedBudgetCommitRevision ?? 0)) {
      chunkRun.lastObservedBudgetCommitRevision = payload.budgetRevision
      parallelBudgetCommitRequestCount += 1
    }
    const pendingBudgetRevision = Number(chunkRun?.pendingBudgetRevision ?? 0)
    const pendingAllocatedMaxSearchStates = Number(
      chunkRun?.pendingAllocatedMaxSearchStates ?? chunkRun?.effectiveAllocatedMaxSearchStates ?? 0,
    )
    if (
      pendingBudgetRevision > 0 &&
      payload.budgetRevision !== pendingBudgetRevision
    ) {
      throw new Error(
        [
          "Parallel indexed miner budget commit revision does not match the pending allowance.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `pendingBudgetRevision=${pendingBudgetRevision}`,
          `committedBudgetRevision=${payload.budgetRevision}`,
        ].join("\n"),
      )
    }
    if (
      pendingAllocatedMaxSearchStates > 0 &&
      payload.allocatedMaxSearchStates !== pendingAllocatedMaxSearchStates
    ) {
      throw new Error(
        [
          "Parallel indexed miner budget commit allocatedMaxSearchStates does not match the pending allowance.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `pendingAllocatedMaxSearchStates=${pendingAllocatedMaxSearchStates}`,
          `committedAllocatedMaxSearchStates=${payload.allocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    const previousCommittedAllocatedMaxSearchStates = getChunkRunCommittedAllocatedSearchBudget(chunkRun)
    const committedDelta =
      payload.allocatedMaxSearchStates - previousCommittedAllocatedMaxSearchStates
    if (committedDelta < 1) {
      chunkRun.pendingBudgetRevision = 0
      chunkRun.pendingBudgetRequestRevision = 0
      chunkRun.pendingAllocatedMaxSearchStates = null
      await removeControlPlaneJsonIfExists(
        chunkRun?.budgetCommitPath,
        "Parallel indexed miner chunk budget commit file",
      )
      return false
    }
    const activeChunkRunsSnapshot = Array.isArray(activeChunkRuns)
      ? activeChunkRuns
      : Array.from(activeChunkRunsBySlot.values())
    const remainingBudgetHeadroom = getRemainingGrantableSearchBudget({
      activeChunkRuns: activeChunkRunsSnapshot,
    })
    if (remainingBudgetHeadroom < committedDelta) {
      await maybeReclaimActiveSiblingSearchBudget({
        requesterChunkRun: chunkRun,
        activeChunkRuns: activeChunkRunsSnapshot,
        requiredDelta: committedDelta - remainingBudgetHeadroom,
      })
      const remainingBudgetHeadroomAfterActiveReclaim = getRemainingGrantableSearchBudget({
        activeChunkRuns: activeChunkRunsSnapshot,
      })
      if (remainingBudgetHeadroomAfterActiveReclaim >= committedDelta) {
        const committed = await writeLiveBudget({
          chunkRun,
          nextAllocatedMaxSearchStates: payload.allocatedMaxSearchStates,
          revision: payload.budgetRevision,
        })
        if (committed !== true) {
          chunkRun.pendingBudgetRevision = 0
          chunkRun.pendingBudgetRequestRevision = 0
          chunkRun.pendingAllocatedMaxSearchStates = null
          return false
        }
        chunkRun.pendingBudgetRevision = 0
        chunkRun.pendingBudgetRequestRevision = 0
        chunkRun.pendingAllocatedMaxSearchStates = null
        chunkRun.topupAllocatedSearchStates = Math.max(
          0,
          Number(chunkRun?.topupAllocatedSearchStates ?? 0) + committedDelta,
        )
        const lastBudgetDecisionUpdatedAtMs = Date.parse(String(chunkRun?.lastBudgetDecisionUpdatedAt ?? ""))
        if (Number.isFinite(lastBudgetDecisionUpdatedAtMs)) {
          parallelAllowanceToCommitLagMs += Math.max(0, Date.now() - lastBudgetDecisionUpdatedAtMs)
        }
        chunkRun.budgetTopupGrantedCount = Math.max(
          0,
          Number(chunkRun?.budgetTopupGrantedCount ?? 0) + 1,
        )
        parallelBudgetCommitCount += 1
        parallelBudgetCommittedSearchStates += committedDelta
        parallelBudgetTopupCount += 1
        parallelBudgetTopupSearchStates += committedDelta
        await removeControlPlaneJsonIfExists(
          chunkRun?.budgetCommitPath,
          "Parallel indexed miner chunk budget commit file",
        )
        return true
      }
      const recoveryWindow = await measureBudgetRecoveryWindow({
        requesterChunkRun: chunkRun,
        activeChunkRuns: activeChunkRunsSnapshot,
      })
      const classifiedRecoveryWindow = classifyParallelBudgetRecoveryWindow({
        remainingBudgetHeadroom,
        completedUnreclaimedSearchBudget: recoveryWindow.completedUnreclaimedSearchBudget,
        activeSiblingReclaimableSearchBudget:
          recoveryWindow.activeSiblingReclaimableSearchBudget,
        requiredDelta: committedDelta,
        fallbackReason: "awaiting_commit_budget_service",
      })
      if (classifiedRecoveryWindow.canRecover) {
        notePendingBudgetRecoveryWindow({
          completedUnreclaimedSearchBudget: classifiedRecoveryWindow.completedUnreclaimedSearchBudget,
          activeSiblingReclaimableSearchBudget:
            classifiedRecoveryWindow.activeSiblingReclaimableSearchBudget,
          requiredDelta: committedDelta,
        })
        await writeBudgetDecision({
          chunkRun,
          requestRevision: payload.requestRevision,
          decision: "pending",
          allocatedMaxSearchStates: pendingAllocatedMaxSearchStates,
          approvedAdditionalSearchStates: Math.max(
            0,
            pendingAllocatedMaxSearchStates - Number(chunkRun?.allocatedMaxSearchStates ?? 0),
          ),
          budgetRevision: pendingBudgetRevision > 0 ? pendingBudgetRevision : null,
          reason: classifiedRecoveryWindow.reason,
        })
        return false
      }
      await writeBudgetDecision({
        chunkRun,
        requestRevision: payload.requestRevision,
        decision: "denied",
        allocatedMaxSearchStates: pendingAllocatedMaxSearchStates,
        approvedAdditionalSearchStates: 0,
        budgetRevision: pendingBudgetRevision > 0 ? pendingBudgetRevision : null,
        reason: "global_budget_exhausted",
      })
      chunkRun.pendingBudgetRevision = 0
      chunkRun.pendingBudgetRequestRevision = 0
      chunkRun.pendingAllocatedMaxSearchStates = null
      await removeControlPlaneJsonIfExists(
        chunkRun?.budgetCommitPath,
        "Parallel indexed miner chunk budget commit file",
      )
      return false
    }
    const committed = await writeLiveBudget({
      chunkRun,
      nextAllocatedMaxSearchStates: payload.allocatedMaxSearchStates,
      revision: payload.budgetRevision,
    })
    if (committed !== true) {
      chunkRun.pendingBudgetRevision = 0
      chunkRun.pendingBudgetRequestRevision = 0
      chunkRun.pendingAllocatedMaxSearchStates = null
      return false
    }
    chunkRun.pendingBudgetRevision = 0
    chunkRun.pendingBudgetRequestRevision = 0
    chunkRun.pendingAllocatedMaxSearchStates = null
    chunkRun.topupAllocatedSearchStates = Math.max(
      0,
      Number(chunkRun?.topupAllocatedSearchStates ?? 0) + committedDelta,
    )
    const lastBudgetDecisionUpdatedAtMs = Date.parse(String(chunkRun?.lastBudgetDecisionUpdatedAt ?? ""))
    if (Number.isFinite(lastBudgetDecisionUpdatedAtMs)) {
      parallelAllowanceToCommitLagMs += Math.max(0, Date.now() - lastBudgetDecisionUpdatedAtMs)
    }
    chunkRun.budgetTopupGrantedCount = Math.max(
      0,
      Number(chunkRun?.budgetTopupGrantedCount ?? 0) + 1,
    )
    parallelBudgetCommitCount += 1
    parallelBudgetCommittedSearchStates += committedDelta
    parallelBudgetTopupCount += 1
    parallelBudgetTopupSearchStates += committedDelta
    await removeControlPlaneJsonIfExists(
      chunkRun?.budgetCommitPath,
      "Parallel indexed miner chunk budget commit file",
    )
    return true
  }
  const maybeServiceBudgetRequests = async ({ activeChunkRuns }) => {
    const sortedActiveChunkRuns = activeChunkRuns
      .slice()
      .sort((left, right) => Number(left?.dispatchOrder ?? 0) - Number(right?.dispatchOrder ?? 0))
    for (const chunkRun of sortedActiveChunkRuns) {
      if (chunkRun?.completed === true) continue
      await maybeCommitChunkRunBudget({ chunkRun, activeChunkRuns: sortedActiveChunkRuns })
      const request = await readChunkRunBudgetRequest(chunkRun)
      if (!request) continue
      const lastBudgetDecisionRequestRevision = Number(
        chunkRun?.lastBudgetDecisionRequestRevision ?? 0,
      )
      const lastBudgetDecisionType = String(chunkRun?.lastBudgetDecisionType ?? "")
        .trim()
        .toLowerCase()
      const pendingBudgetRevision = Number(chunkRun?.pendingBudgetRevision ?? 0)
      const pendingBudgetRequestRevision = Number(chunkRun?.pendingBudgetRequestRevision ?? 0)
      if (pendingBudgetRevision > 0 && pendingBudgetRequestRevision > 0) {
        if (request.revision > pendingBudgetRequestRevision) {
          chunkRun.pendingBudgetRequestRevision = request.revision
          await writeBudgetDecision({
            chunkRun,
            requestRevision: request.revision,
            decision: "granted",
            allocatedMaxSearchStates: Math.max(
              0,
              Number(
                chunkRun?.pendingAllocatedMaxSearchStates ??
                  chunkRun?.effectiveAllocatedMaxSearchStates ??
                  chunkRun?.allocatedMaxSearchStates ??
                  0,
              ),
            ),
            approvedAdditionalSearchStates: Math.max(
              0,
              Number(chunkRun?.pendingAllocatedMaxSearchStates ?? 0) -
                Number(chunkRun?.allocatedMaxSearchStates ?? 0),
            ),
            budgetRevision: pendingBudgetRevision,
            reason: "allowance_commit_pending",
          })
          continue
        }
        if (request.revision === pendingBudgetRequestRevision) {
          continue
        }
      }
      if (request.revision < lastBudgetDecisionRequestRevision) continue
      const isNewRequestRevision = request.revision > lastBudgetDecisionRequestRevision
      if (
        !isNewRequestRevision &&
        (lastBudgetDecisionType === "granted" || lastBudgetDecisionType === "denied")
      ) {
        continue
      }
      if (isNewRequestRevision) {
        parallelBudgetRequestCount += 1
      }
      const activeChunkRunsSnapshot = Array.from(activeChunkRunsBySlot.values())
      const activeObservedSlackSearchBudget =
        await measureActiveSiblingReclaimableSearchBudget({
          requesterChunkRun: null,
          activeChunkRuns: activeChunkRunsSnapshot,
        })
      const maxObservedActiveSlackSearchBudget =
        resolveParallelMaxObservedActiveSlackSearchBudget({
          activeChunkRunsCount: activeChunkRunsSnapshot.length,
          externalBudgetRequestHeadroomStates,
          externalBudgetRequestSearchStates,
        })
      if (activeObservedSlackSearchBudget > maxObservedActiveSlackSearchBudget) {
        await writeBudgetDecision({
          chunkRun,
          requestRevision: request.revision,
          decision: "pending",
          allocatedMaxSearchStates: getChunkRunApprovedAllocatedSearchBudget(chunkRun),
          approvedAdditionalSearchStates: 0,
          reason: "awaiting_active_slack_consumption",
        })
        continue
      }
      const remainingBudgetHeadroom = getRemainingGrantableSearchBudget({
        activeChunkRuns: activeChunkRunsSnapshot,
      })
      const requestedGrantDelta = Math.min(
        request.requestedAdditionalSearchStates,
        externalBudgetRequestSearchStates,
      )
      if (remainingBudgetHeadroom < requestedGrantDelta) {
        await maybeReclaimActiveSiblingSearchBudget({
          requesterChunkRun: chunkRun,
          activeChunkRuns: activeChunkRunsSnapshot,
          requiredDelta: requestedGrantDelta - remainingBudgetHeadroom,
        })
      }
      const remainingBudgetHeadroomAfterActiveReclaim = getRemainingGrantableSearchBudget({
        activeChunkRuns: activeChunkRunsSnapshot,
      })
      if (remainingBudgetHeadroomAfterActiveReclaim < 1) {
        const recoveryWindow = await measureBudgetRecoveryWindow({
          requesterChunkRun: chunkRun,
          activeChunkRuns: activeChunkRunsSnapshot,
        })
        const classifiedRecoveryWindow = classifyParallelBudgetRecoveryWindow({
          remainingBudgetHeadroom,
          completedUnreclaimedSearchBudget: recoveryWindow.completedUnreclaimedSearchBudget,
          activeSiblingReclaimableSearchBudget:
            recoveryWindow.activeSiblingReclaimableSearchBudget,
          requiredDelta: 1,
          fallbackReason: "awaiting_budget_request_service",
        })
        if (classifiedRecoveryWindow.canRecover) {
          notePendingBudgetRecoveryWindow({
            completedUnreclaimedSearchBudget: classifiedRecoveryWindow.completedUnreclaimedSearchBudget,
            activeSiblingReclaimableSearchBudget:
              classifiedRecoveryWindow.activeSiblingReclaimableSearchBudget,
            requiredDelta: 1,
          })
          await writeBudgetDecision({
            chunkRun,
            requestRevision: request.revision,
            decision: "pending",
            allocatedMaxSearchStates: getChunkRunApprovedAllocatedSearchBudget(chunkRun),
            approvedAdditionalSearchStates: 0,
            reason: classifiedRecoveryWindow.reason,
          })
          continue
        }
        await writeBudgetDecision({
          chunkRun,
          requestRevision: request.revision,
          decision: "denied",
          allocatedMaxSearchStates: getChunkRunApprovedAllocatedSearchBudget(chunkRun),
          approvedAdditionalSearchStates: 0,
          reason: "global_budget_exhausted",
        })
        continue
      }
      const grantedDelta = Math.min(
        request.requestedAdditionalSearchStates,
        externalBudgetRequestSearchStates,
        remainingBudgetHeadroomAfterActiveReclaim,
      )
      if (grantedDelta < 1) {
        await writeBudgetDecision({
          chunkRun,
          requestRevision: request.revision,
          decision: "denied",
          allocatedMaxSearchStates: getChunkRunApprovedAllocatedSearchBudget(chunkRun),
          approvedAdditionalSearchStates: 0,
          reason: "global_budget_exhausted",
        })
        continue
      }
      const currentApprovedAllocatedMaxSearchStates = Math.max(
        1,
        getChunkRunApprovedAllocatedSearchBudget(chunkRun),
      )
      const nextAllocatedMaxSearchStates =
        currentApprovedAllocatedMaxSearchStates + grantedDelta
      if (
        nextAllocatedMaxSearchStates <= currentApprovedAllocatedMaxSearchStates &&
        Number(chunkRun?.pendingBudgetRevision ?? 0) > 0
      ) {
        continue
      }
      chunkRun.pendingBudgetRevision = Number(chunkRun?.liveBudgetRevision ?? 0) + 1
      chunkRun.pendingBudgetRequestRevision = request.revision
      chunkRun.pendingAllocatedMaxSearchStates = nextAllocatedMaxSearchStates
      parallelBudgetGrantCount += 1
      parallelBudgetAllowanceCount += 1
      parallelBudgetAllowanceSearchStates += grantedDelta
      await writeBudgetDecision({
        chunkRun,
        requestRevision: request.revision,
        decision: "granted",
        allocatedMaxSearchStates: nextAllocatedMaxSearchStates,
        approvedAdditionalSearchStates: grantedDelta,
        budgetRevision: chunkRun.pendingBudgetRevision,
        reason: "request_ack",
      })
    }
  }
  const pruneMergedByHitFloor = (previousFloor, kthHitFloor) => {
    if (!Number.isInteger(kthHitFloor) || kthHitFloor <= 0) return
    const lowerBound = Number.isInteger(previousFloor) && previousFloor > 0 ? previousFloor : 0
    const signaturesToVisit = new Set()
    for (const [hitCount, signatures] of partialMergeSignaturesByHit.entries()) {
      if (!Number.isInteger(hitCount) || hitCount < lowerBound || hitCount >= kthHitFloor) continue
      for (const signature of signatures) {
        signaturesToVisit.add(signature)
      }
    }
    for (const signature of signaturesToVisit) {
      const bucket = mergedBySignature.get(signature)
      if (!Array.isArray(bucket) || bucket.length < 1) {
        mergedBySignature.delete(signature)
        continue
      }
      let writeIndex = 0
      let removedRules = 0
      for (let readIndex = 0; readIndex < bucket.length; readIndex += 1) {
        const rule = bucket[readIndex]
        const hitCount = Number(rule?.trainHitCount ?? rule?.matchHitCount ?? 0)
        if (hitCount >= kthHitFloor) {
          if (writeIndex !== readIndex) {
            bucket[writeIndex] = rule
          }
          writeIndex += 1
          continue
        }
        removedRules += 1
        notePartialMergeRuleRemoved(signature, rule)
      }
      if (removedRules < 1) continue
      partialMergeEvictedByHitFloorCount += removedRules
      partialMergeCompactedBucketCount += 1
      partialMergeCompactedRuleCount += removedRules
      if (writeIndex > 0) {
        bucket.length = writeIndex
        mergedBySignature.set(signature, bucket)
      } else {
        mergedBySignature.delete(signature)
      }
    }
  }
  const toYieldRateMetric = (numerator, denominator, digits = 6) =>
    Number(
      (
        toFiniteNonNegativeMetric(numerator, 0) /
        Math.max(1, toFiniteNonNegativeMetric(denominator, 0))
      ).toFixed(digits),
    )
  const buildChunkYieldTelemetryEntry = (chunk) => ({
    chunkIndex: Number(chunk?.chunkIndex ?? -1),
    dispatchPriorityIndex: Number(chunk?.dispatchPriorityIndex ?? -1),
    start: Number(chunk?.start ?? -1),
    end: Number(chunk?.end ?? -1),
    bootstrapHead: chunk?.bootstrapHead === true,
    firstWaveCompletionTarget: chunk?.firstWaveCompletionTarget === true,
    dispatchScore: toFiniteNonNegativeMetric(chunk?.dispatchScore, 0),
    firstWaveDispatchScore: toFiniteNonNegativeMetric(chunk?.firstWaveDispatchScore, 0),
    headMicroprobeDispatchScore: toFiniteNonNegativeMetric(
      chunk?.headMicroprobeDispatchScore,
      0,
    ),
    singletonRootCompletionScore: toFiniteNonNegativeMetric(
      chunk?.singletonRootCompletionScore,
      0,
    ),
    singletonRootExactCompletionScore: toFiniteNonNegativeMetric(
      chunk?.singletonRootExactCompletionScore,
      0,
    ),
    singletonRootAdaptiveExactCompletionScore: toFiniteNonNegativeMetric(
      chunk?.singletonRootAdaptiveExactCompletionScore,
      0,
    ),
    multiRootCompletionScore: toFiniteNonNegativeMetric(chunk?.multiRootCompletionScore, 0),
  })
  const buildReadyQueueHeadYieldTelemetry = ({ readyQueue, limit = 4 }) =>
    (Array.isArray(readyQueue) ? readyQueue : [])
      .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
      .map((chunk) => buildChunkYieldTelemetryEntry(chunk))
  const writeParallelProgress = async ({
    phase,
    activeDispatchGroupIndex = null,
    activeChunkCount = 0,
    activeSearchProgress = null,
    readyQueueHeadYieldTelemetry = null,
  }) => {
    const normalizedActiveSearchProgress = activeSearchProgress ?? {
      activeChunkCount: 0,
      activeWaveExploredStates: 0,
      activeWaveRulesCollected: 0,
      activeWaveMemoLookupMs: 0,
      activeWaveEtaSeconds: null,
      activeWaveEstimatedCost: 0,
      activeAllocatedSearchBudget: 0,
      activeEffectiveAllocatedSearchBudget: 0,
      activeChunkSnapshots: [],
      activeChunkTelemetry: [],
      remainingSearchBudget: Math.max(0, cfg.maxSearchStates - exploredStates),
      remainingGrantableSearchBudget: Math.max(0, cfg.maxSearchStates - exploredStates),
      observedProgressFileCount: 0,
    }
    const resolvedActiveChunkSnapshots = Array.isArray(
      normalizedActiveSearchProgress.activeChunkSnapshots,
    )
      ? normalizedActiveSearchProgress.activeChunkSnapshots.map((entry) => ({ ...entry }))
      : []
    const resolvedActiveChunkTelemetry = Array.isArray(
      normalizedActiveSearchProgress.activeChunkTelemetry,
    )
      ? normalizedActiveSearchProgress.activeChunkTelemetry.map((entry) => ({ ...entry }))
      : []
    const resolvedReadyQueueHeadYieldTelemetry = Array.isArray(readyQueueHeadYieldTelemetry)
      ? readyQueueHeadYieldTelemetry.map((entry) => ({ ...entry }))
      : []
    if (resolvedActiveChunkSnapshots.length > 0) {
      parallelLastObservedActiveChunkSnapshots = resolvedActiveChunkSnapshots.map((entry) => ({
        ...entry,
      }))
      parallelActiveChunkTelemetryRevision += 1
    }
    if (Number(normalizedActiveSearchProgress.observedProgressFileCount ?? 0) > 0) {
      parallelActiveProgressLiveSampleCount += 1
    }
    const liveExploredStates =
      exploredStates + Number(normalizedActiveSearchProgress.activeWaveExploredStates ?? 0)
    parallelCompletedWaveCount = computeCompletedLogicalWaveCount({
      totalCompletedChunkCount: parallelCompletedChunkCount,
    })
    await writeJsonAtomic(
      progressPath,
      buildParallelTimedProgressPayload({
        payload: {
          phase,
          workerCount,
          ...buildParallelPlanningMetrics(),
          parallelChunkCount: chunks.length,
          parallelWaveCount: plannedWaveCount,
          parallelCompletedChunkCount,
          parallelCompletedWaveCount,
          completedEstimatedCost,
          totalEstimatedCost,
          parallelGlobalKthHitFloor: parallelCurrentGlobalKthHitFloor,
          parallelFloorSeededChunkCount,
          parallelWaveMergeMs,
          parallelChunkPlannerImbalanceRatio,
          parallelFirstWaveFrontierSplitCount,
          parallelFirstWaveLaunchSplitCount,
          parallelFirstWaveRootSeedMicroshardCount,
          parallelFirstWaveForcedSingletonMicroshardCount,
          parallelFirstWaveCompletionTargetLaunchCount,
          parallelFirstWaveExactCompletionProbeCount,
          parallelFirstWaveExactCompletionProbeSingletonCandidateCount,
          parallelFirstWaveExactCompletionProbeReachedTerminalCount,
          parallelFirstWaveExactCompletionProbeFoundFirstRuleCount,
          parallelFirstWaveExactCompletionProbeStateCap,
          parallelFirstWaveExactCompletionScoreMin,
          parallelFirstWaveExactCompletionScoreMax,
          parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount,
          parallelFirstWaveAdaptiveExactCompletionProbeCount,
          parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount,
          parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount,
          parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin,
          parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax,
          parallelFirstWaveAdaptiveExactCompletionScoreMin,
          parallelFirstWaveAdaptiveExactCompletionScoreMax,
          parallelFirstWaveSingletonRootChunkCount,
          parallelFirstWaveSingletonRootLaunchCount,
          parallelFirstWaveSingletonRootExactCompletionScoreMin,
          parallelFirstWaveSingletonRootExactCompletionScoreMax,
          parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMin,
          parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMax,
          parallelFirstWaveSingletonRootCompletionScoreMin,
          parallelFirstWaveSingletonRootCompletionScoreMax,
          parallelFirstWaveMultiRootChunkCount,
          parallelFirstWaveMultiRootLaunchCount,
          parallelFirstWaveMultiRootCompletionScoreMin,
          parallelFirstWaveMultiRootCompletionScoreMax,
          parallelActiveProgressLiveSampleCount,
          parallelReadyQueueDepth: Math.max(0, chunks.length - parallelDispatchCount),
          parallelDispatchCount,
          parallelImmediateRefillCount,
          parallelLiveFloorUpdateCount,
          parallelLiveFloorRevision,
          parallelFirstGlobalFloorElapsedMs,
          parallelLivePartialRuleRevisionCount,
          parallelLivePartialRuleMergeMs,
          parallelLivePartialFloorUpdateCount,
          parallelFirstLivePartialFloorElapsedMs,
          parallelBootstrapChunkCount,
          parallelFirstChunkCompletionElapsedMs,
          parallelFirstBootstrapFloorElapsedMs,
          parallelBootstrapFloorSeededLaunchCount,
          parallelActiveLiveRuleCount,
          parallelActiveAllocatedSearchBudget: Number(
            normalizedActiveSearchProgress.activeAllocatedSearchBudget ?? 0,
          ),
          parallelActiveEffectiveAllocatedSearchBudget: Number(
            normalizedActiveSearchProgress.activeEffectiveAllocatedSearchBudget ??
              normalizedActiveSearchProgress.activeAllocatedSearchBudget ??
              0,
          ),
          parallelBudgetRequestCount,
          parallelBudgetGrantCount,
          parallelBudgetAllowanceCount,
          parallelBudgetAllowanceSearchStates,
          parallelBudgetDenyCount,
          parallelBudgetPendingCount,
          parallelBudgetPendingActiveReclaimCount,
          parallelBudgetPendingCompletedReclaimCount,
          parallelBudgetPendingRequiredDeltaPeak,
          parallelBudgetPendingWaitMs,
          parallelBudgetTopupCount,
          parallelBudgetTopupSearchStates,
          parallelBudgetCommitRequestCount,
          parallelBudgetCommitCount,
          parallelBudgetCommittedSearchStates,
          parallelBudgetUnusedAllowanceCount,
          parallelActiveReclaimAttemptCount,
          parallelActiveReclaimCommitCount,
          parallelActiveReclaimSearchStates,
          parallelActiveReclaimSkippedStaleChunkCount,
          parallelOutstandingAllowanceSearchStates: Number(
            normalizedActiveSearchProgress.outstandingAllowanceSearchStates ?? 0,
          ),
          parallelOutstandingAllowanceChunkCount: Number(
            normalizedActiveSearchProgress.outstandingAllowanceChunkCount ?? 0,
          ),
          parallelAllowanceToCommitLagMs,
          parallelBudgetFastpathTickCount,
          parallelBudgetFastpathServiceCount,
          parallelBudgetFastpathHotTickCount,
          parallelBudgetFastpathIdleTickCount,
          parallelBudgetFastpathIdleSkipCount,
          parallelBudgetFastpathServiceMs,
          parallelWorkerSlotCompletionPollCount,
          parallelWorkerSlotCompletionHotPollCount,
          parallelWorkerSlotCompletionSteadyPollCount,
          parallelWorkerSlotCompletionPollServiceMs,
          parallelActiveChunkTelemetryRevision,
          parallelCompletedChunkReclaimCount,
          parallelCompletedChunkReclaimSearchStates,
          parallelSlotIdleMs,
          parallelWorkerSpawnCount,
          parallelWorkerSlotReuseCount,
          parallelWorkerWarmLaunchCount,
          parallelWorkerColdStartMs,
          parallelWorkerWarmLaunchMs,
          parallelActiveChunkSnapshots: resolvedActiveChunkSnapshots,
          parallelLastObservedActiveChunkSnapshots:
            parallelLastObservedActiveChunkSnapshots.map((entry) => ({ ...entry })),
          parallelReadyQueueHeadYieldChunks: resolvedReadyQueueHeadYieldTelemetry,
          parallelConfiguredMaxSearchStates: cfg.maxSearchStates,
          mergedObservedRuleCount,
          mergedLiveRuleCount,
          exploredStates: liveExploredStates,
          activeWaveIndex: activeDispatchGroupIndex,
          activeWaveChunkCount: activeChunkCount,
          parallelActiveChunks: resolvedActiveChunkTelemetry,
          parallelActiveChunkCount: Number(normalizedActiveSearchProgress.activeChunkCount ?? 0),
          parallelActiveWaveExploredStates: Number(
            normalizedActiveSearchProgress.activeWaveExploredStates ?? 0,
          ),
          parallelActiveWaveRulesCollected: Number(
            normalizedActiveSearchProgress.activeWaveRulesCollected ?? 0,
          ),
          parallelActiveWaveMemoLookupMs: Number(
            normalizedActiveSearchProgress.activeWaveMemoLookupMs ?? 0,
          ),
          parallelActiveWaveEtaSeconds: Number.isFinite(
            Number(normalizedActiveSearchProgress.activeWaveEtaSeconds),
          )
            ? Number(normalizedActiveSearchProgress.activeWaveEtaSeconds)
            : null,
          parallelRemainingSearchBudget: Math.max(
            0,
            Number(normalizedActiveSearchProgress.remainingSearchBudget ?? 0),
          ),
          parallelRemainingGrantableSearchBudget: Math.max(
            0,
            Number(normalizedActiveSearchProgress.remainingGrantableSearchBudget ?? 0),
          ),
          parallelActiveWaveEstimatedCost: Number(
            normalizedActiveSearchProgress.activeWaveEstimatedCost ?? 0,
          ),
          completedEstimatedCost,
          totalEstimatedCost,
        },
        startedAtMs: parallelStartedAt,
        completedEstimatedCost,
        totalEstimatedCost,
        activeEstimatedCost: Number(normalizedActiveSearchProgress.activeWaveEstimatedCost ?? 0),
      }),
    )
  }
  const buildWorkerStaticArgs = ({ workerSlotDir, workerSlotIndex }) => {
    const args = [
      `--slot-mode=worker`,
      `--index-dir=${resolvedIndexDir}`,
      `--slot-dir=${workerSlotDir}`,
      `--worker-slot-index=${workerSlotIndex}`,
      `--train-start=${cfg.trainStartDate ?? ""}`,
      `--train-end=${cfg.trainEndDate ?? ""}`,
      `--min-hit-count=${cfg.minHitCount}`,
      `--min-train-precision=${cfg.minTrainPrecision}`,
      ...(cfg.enableTrainMatchedDatePrune === true ? [`--enable-train-matched-date-prune=true`] : []),
      ...(cfg.enableYearHitUpperBoundPrune === true ? [`--enable-year-hit-upper-bound-prune=true`] : []),
      ...(Array.isArray(cfg.coreYears) && cfg.coreYears.length > 0
        ? [`--core-years=${cfg.coreYears.join(",")}`]
        : []),
      ...(Array.isArray(cfg.excludedBoundaryYears) && cfg.excludedBoundaryYears.length > 0
        ? [`--excluded-boundary-years=${cfg.excludedBoundaryYears.join(",")}`]
        : []),
      ...(Number.isInteger(Number(cfg.minTrainHitsPerCoreYear)) && Number(cfg.minTrainHitsPerCoreYear) > 0
        ? [`--min-train-hits-per-core-year=${Number(cfg.minTrainHitsPerCoreYear)}`]
        : []),
      ...(Number.isInteger(Number(cfg.minTrainMatchedDates)) && Number(cfg.minTrainMatchedDates) > 0
        ? [`--min-train-matched-dates=${Number(cfg.minTrainMatchedDates)}`]
        : []),
      ...(Number.isFinite(cfg.maxTop1DateHitShare)
        ? [`--max-top1-date-hit-share=${Number(cfg.maxTop1DateHitShare)}`]
        : []),
      ...(Number.isFinite(cfg.maxTop3DateHitShare)
        ? [`--max-top3-date-hit-share=${Number(cfg.maxTop3DateHitShare)}`]
        : []),
      ...(Number.isInteger(Number(cfg.maxRulesPerMatchedDateSignature)) &&
      Number(cfg.maxRulesPerMatchedDateSignature) > 0
        ? [`--max-rules-per-matched-date-signature=${Number(cfg.maxRulesPerMatchedDateSignature)}`]
        : []),
      `--max-gap=${cfg.maxGapTradingDays}`,
      ...(Number.isInteger(Number(cfg.maxTrainHitCount)) && Number(cfg.maxTrainHitCount) > 0
        ? [`--max-train-hit-count=${Number(cfg.maxTrainHitCount)}`]
        : []),
      `--max-rule-size=${cfg.maxRuleSize}`,
      `--max-seed-tokens=${cfg.maxSeedTokens}`,
      `--max-rules=${cfg.maxRules}`,
      `--bootstrap-live-partial-max-rules=${bootstrapLivePartialMaxRules}`,
      `--max-search-states=${cfg.maxSearchStates}`,
      `--configured-max-search-states=${cfg.maxSearchStates}`,
      `--max-rejected-rule-samples=${cfg.maxRejectedRuleSamples}`,
      `--ordering-head-window=${orderingHeadWindow}`,
      `--search-state-cache-max-bytes=${searchStateCacheMaxBytes}`,
    ]
    if (
      Number.isInteger(Number(cfg?.rowProjectedCandidateThreshold)) &&
      Number(cfg?.rowProjectedCandidateThreshold) >= 0
    ) {
      args.push(
        `--row-projected-candidate-threshold=${Number(cfg.rowProjectedCandidateThreshold)}`,
      )
    }
    return args
  }
  const buildWorkerCommandOptions = ({
    chunk,
    initialKthHitFloor,
    baseAllocatedMaxSearchStates,
    guardBandAllocatedSearchStates,
    allocatedMaxSearchStates,
    remainingGlobalSearchBudgetAtLaunch,
    externalBudgetPath,
    workerOutDir,
  }) => {
    if (!Number.isInteger(baseAllocatedMaxSearchStates) || baseAllocatedMaxSearchStates < 1) {
      throw new Error(
        `Parallel indexed miner requires positive baseAllocatedMaxSearchStates: chunkIndex=${chunk.chunkIndex} baseAllocatedMaxSearchStates=${baseAllocatedMaxSearchStates}`,
      )
    }
    if (
      !Number.isInteger(guardBandAllocatedSearchStates) ||
      guardBandAllocatedSearchStates < 0
    ) {
      throw new Error(
        `Parallel indexed miner requires non-negative guardBandAllocatedSearchStates: chunkIndex=${chunk.chunkIndex} guardBandAllocatedSearchStates=${guardBandAllocatedSearchStates}`,
      )
    }
    if (!Number.isInteger(allocatedMaxSearchStates) || allocatedMaxSearchStates < 1) {
      throw new Error(
        `Parallel indexed miner requires positive allocatedMaxSearchStates: chunkIndex=${chunk.chunkIndex} allocatedMaxSearchStates=${allocatedMaxSearchStates}`,
      )
    }
    if (baseAllocatedMaxSearchStates + guardBandAllocatedSearchStates !== allocatedMaxSearchStates) {
      throw new Error(
        [
          "Parallel indexed miner requires effective allocatedMaxSearchStates to match base + guard band.",
          `chunkIndex=${chunk.chunkIndex}`,
          `baseAllocatedMaxSearchStates=${baseAllocatedMaxSearchStates}`,
          `guardBandAllocatedSearchStates=${guardBandAllocatedSearchStates}`,
          `allocatedMaxSearchStates=${allocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    const options = {
      trainStartDate: cfg.trainStartDate ?? null,
      trainEndDate: cfg.trainEndDate ?? null,
      minHitCount: cfg.minHitCount,
      minTrainPrecision: cfg.minTrainPrecision,
      maxTrainHitCount: cfg.maxTrainHitCount,
      maxGapTradingDays: cfg.maxGapTradingDays,
      maxRuleSize: cfg.maxRuleSize,
      maxSeedTokens: cfg.maxSeedTokens,
      maxRules: cfg.maxRules,
      bootstrapLivePartialMaxRules,
      maxSearchStates: allocatedMaxSearchStates,
      configuredMaxSearchStates: cfg.maxSearchStates,
      baseAllocatedMaxSearchStates,
      guardBandAllocatedSearchStates,
      allocatedMaxSearchStates,
      remainingGlobalSearchBudgetAtLaunch,
      externalKthHitFloorPath: liveFloorPath,
      externalKthHitFloorPollMs: PARALLEL_EXTERNAL_KTH_HIT_FLOOR_POLL_MS,
      externalKthHitFloorStateInterval: PARALLEL_EXTERNAL_KTH_HIT_FLOOR_STATE_INTERVAL,
      maxRejectedRuleSamples: cfg.maxRejectedRuleSamples,
      rootSeedStartIndex: chunk.start,
      rootSeedEndIndexExclusive: chunk.end,
      workerChunkIndex: chunk.chunkIndex,
      outputMode: "partial",
      enablePartialTopKHitBound: true,
      orderingHeadWindow,
      searchStateCacheMaxBytes,
    }
    if (
      Number.isInteger(Number(cfg?.rowProjectedCandidateThreshold)) &&
      Number(cfg?.rowProjectedCandidateThreshold) >= 0
    ) {
      options.rowProjectedCandidateThreshold = Number(cfg.rowProjectedCandidateThreshold)
    }
    if (Number.isInteger(initialKthHitFloor) && initialKthHitFloor > 0) {
      options.initialKthHitFloor = initialKthHitFloor
    }
    if (String(externalBudgetPath ?? "").trim().length > 0) {
      options.externalBudgetPath = externalBudgetPath
      options.externalBudgetPollMs = PARALLEL_EXTERNAL_BUDGET_POLL_MS
      options.externalBudgetDecisionPollMs = externalBudgetDecisionPollMs
      options.externalBudgetStateInterval = PARALLEL_EXTERNAL_BUDGET_STATE_INTERVAL
      options.externalBudgetRequestPath = path.join(
        workerOutDir,
        PARALLEL_BUDGET_REQUEST_FILENAME,
      )
      options.externalBudgetDecisionPath = path.join(
        workerOutDir,
        PARALLEL_BUDGET_DECISION_FILENAME,
      )
      options.externalBudgetCommitPath = path.join(
        workerOutDir,
        PARALLEL_BUDGET_COMMIT_FILENAME,
      )
      options.externalBudgetRequestHeadroomStates = externalBudgetRequestHeadroomStates
      options.externalBudgetRequestSearchStates = externalBudgetRequestSearchStates
      options.externalBudgetRequestWaitMs = externalBudgetRequestWaitMs
    }
    return options
  }
  const workerSlots = Array.from({ length: workerCount }, (_, workerSlotIndex) => {
    const workerSlotDir = path.join(
      workerRootDir,
      `worker_${String(workerSlotIndex).padStart(3, "0")}`,
    )
    const slotPaths = buildPerfectPrototypeWorkerSlotPaths(path.join(workerSlotDir, "_slot"))
    return {
      workerSlotIndex,
      workerSlotDir,
      ...slotPaths,
      processHandle: null,
      pid: null,
      nextCommandRevision: 0,
      launchedChunkCount: 0,
      completedChunkCount: 0,
      ready: false,
      sessionInfo: null,
    }
  })
  const readWorkerSlotState = async (slot) => {
    const payload = await readControlPlaneJsonIfExists(
      slot.statePath,
      "Parallel indexed miner worker slot state file",
    )
    if (!payload) return null
    const workerSlotIndex = Math.floor(Number(payload?.workerSlotIndex) || 0)
    if (workerSlotIndex !== slot.workerSlotIndex) {
      throw new Error(
        [
          "Parallel indexed miner worker slot state workerSlotIndex mismatch.",
          `expectedWorkerSlotIndex=${slot.workerSlotIndex}`,
          `receivedWorkerSlotIndex=${workerSlotIndex}`,
          `path=${slot.statePath}`,
        ].join("\n"),
      )
    }
    return payload
  }
  const dispatchWorkerSlotCommand = async ({ slot, command, commandPayload = {} }) => {
    const revision = Number(slot?.nextCommandRevision ?? 0) + 1
    slot.nextCommandRevision = revision
    await ensureDir(slot.workerSlotDir)
    await ensureDir(slot.slotDir)
    await writeJsonAtomic(slot.commandPath, {
      version: 1,
      revision,
      workerSlotIndex: slot.workerSlotIndex,
      command,
      ...commandPayload,
      updatedAt: new Date().toISOString(),
    })
    return revision
  }
  const waitForWorkerSlotReady = async (slot) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt <= PERFECT_PROTOTYPE_WORKER_SLOT_READY_TIMEOUT_MS) {
      if (slot.processHandle?.isSettled() === true) {
        await slot.processHandle.completionPromise
        throw new Error(
          `Parallel indexed miner worker slot exited before becoming ready: workerSlotIndex=${slot.workerSlotIndex}`,
        )
      }
      const state = await readWorkerSlotState(slot)
      if (state && String(state?.state ?? "").trim().toLowerCase() === "idle") {
        const sessionInfo = await readControlPlaneJsonIfExists(
          slot.sessionPath,
          "Parallel indexed miner worker slot session file",
        )
        if (!sessionInfo) {
          await sleep(PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS)
          continue
        }
        slot.ready = true
        slot.sessionInfo = sessionInfo
        return state
      }
      if (state && String(state?.state ?? "").trim().toLowerCase() === "failed") {
        throw new Error(
          [
            "Parallel indexed miner worker slot failed during initialization.",
            `workerSlotIndex=${slot.workerSlotIndex}`,
            `errorMessage=${String(state?.errorMessage ?? "").trim() || "unknown"}`,
          ].join("\n"),
        )
      }
      await sleep(PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS)
    }
    const elapsedMs = Math.max(0, Date.now() - startedAt)
    throw new Error(
      [
        "Timed out waiting for parallel indexed miner worker slot readiness.",
        `workerSlotIndex=${slot.workerSlotIndex}`,
        `elapsedMs=${elapsedMs}`,
        `readyTimeoutMs=${PERFECT_PROTOTYPE_WORKER_SLOT_READY_TIMEOUT_MS}`,
      ].join("\n"),
    )
  }
  const waitForWorkerSlotChunkCompletion = async ({ slot, chunkRun }) => {
    while (true) {
      if (slot.processHandle?.isSettled() === true) {
        await slot.processHandle.completionPromise.catch(() => {})
        if (chunkRun?.terminationRequested === true) {
          return
        }
        throw new Error(
          [
            "Parallel indexed miner worker slot exited while a chunk was still assigned.",
            `workerSlotIndex=${slot.workerSlotIndex}`,
            `chunkIndex=${chunkRun.chunkIndex}`,
          ].join("\n"),
        )
      }
      parallelWorkerSlotCompletionPollCount += 1
      const completionPollIntervalMs = resolveParallelActiveChunkCompletionPollIntervalMs({
        chunkRun,
      })
      if (completionPollIntervalMs <= PARALLEL_ACTIVE_CHUNK_COMPLETION_POLL_INTERVAL_MS) {
        parallelWorkerSlotCompletionHotPollCount += 1
      } else {
        parallelWorkerSlotCompletionSteadyPollCount += 1
      }
      const completionPollStartedAt = Date.now()
      const state = await readWorkerSlotState(slot)
      parallelWorkerSlotCompletionPollServiceMs += Math.max(0, Date.now() - completionPollStartedAt)
      const stateName = String(state?.state ?? "").trim().toLowerCase()
      const stateCommandRevision = Number(state?.commandRevision ?? 0)
      const lastCompletedCommandRevision = Number(state?.lastCompletedCommandRevision ?? 0)
      if (
        stateName === "failed" &&
        stateCommandRevision >= Number(chunkRun?.slotCommandRevision ?? 0)
      ) {
        if (chunkRun?.terminationRequested === true) {
          return
        }
        throw new Error(
          [
            "Parallel indexed miner worker slot failed while processing a chunk.",
            `workerSlotIndex=${slot.workerSlotIndex}`,
            `chunkIndex=${chunkRun.chunkIndex}`,
            `errorMessage=${String(state?.errorMessage ?? "").trim() || "unknown"}`,
          ].join("\n"),
        )
      }
      if (
        stateName === "idle" &&
        lastCompletedCommandRevision >= Number(chunkRun?.slotCommandRevision ?? 0) &&
        pathExists(chunkRun.summaryPath)
      ) {
        slot.completedChunkCount += 1
        return
      }
      await sleep(completionPollIntervalMs)
    }
  }
  const spawnPersistentWorkerSlot = async (slot) => {
    await ensureDir(slot.workerSlotDir)
    await ensureDir(slot.slotDir)
    const coldStartedAtMs = Date.now()
    const processHandle = spawnNode({
      cwd,
      scriptPath: workerScript,
      env: workerEnv,
      args: buildWorkerStaticArgs({
        workerSlotDir: slot.slotDir,
        workerSlotIndex: slot.workerSlotIndex,
      }),
    })
    slot.processHandle = processHandle
    slot.pid = processHandle.pid
    parallelWorkerSpawnCount += 1
    await waitForWorkerSlotReady(slot)
    parallelWorkerColdStartMs += Math.max(0, Date.now() - coldStartedAtMs)
  }
  const shutdownWorkerSlots = async () => {
    await Promise.allSettled(
      workerSlots.map(async (slot) => {
        if (!slot?.processHandle) return
        if (slot.processHandle.isSettled() === true) {
          await slot.processHandle.completionPromise.catch(() => {})
          return
        }
        try {
          await dispatchWorkerSlotCommand({
            slot,
            command: "shutdown",
          })
        } catch {}
        const outcome = await Promise.race([
          slot.processHandle.completionPromise.then(() => "completed").catch(() => "failed"),
          sleep(5000).then(() => "timeout"),
        ])
        if (outcome === "timeout" && Number.isInteger(slot.pid) && slot.pid > 0) {
          try {
            process.kill(slot.pid, "SIGTERM")
          } catch {}
          await slot.processHandle.completionPromise.catch(() => {})
        }
      }),
    )
  }
  const serializeChunkRunRecord = (chunkRun) => ({
    chunkIndex: chunkRun.chunkIndex,
    waveIndex: chunkRun.waveIndex,
    workerSlotIndex: chunkRun.workerSlotIndex,
    dispatchPriorityIndex: chunkRun.dispatchPriorityIndex,
    dispatchOrder: chunkRun.dispatchOrder,
    completionOrder: chunkRun.completionOrder,
    mergeOrder: chunkRun.mergeOrder,
    start: chunkRun.start,
    end: chunkRun.end,
    estimatedCost: chunkRun.estimatedCost,
    steadyDispatchScore: chunkRun.steadyDispatchScore,
    bootstrapScore: chunkRun.bootstrapScore,
    bootstrapDispatchScore: chunkRun.bootstrapDispatchScore,
    dispatchScore: chunkRun.dispatchScore,
    firstWaveDispatchScore: chunkRun.firstWaveDispatchScore,
    headMicroprobeDispatchScore: chunkRun.headMicroprobeDispatchScore,
    bootstrapHead: chunkRun.bootstrapHead === true,
    firstWaveCompletionTarget: chunkRun.firstWaveCompletionTarget === true,
    singletonRootCompletionScore: chunkRun.singletonRootCompletionScore ?? null,
    singletonRootExactCompletionScore: chunkRun.singletonRootExactCompletionScore ?? null,
    singletonRootAdaptiveExactCompletionScore:
      chunkRun.singletonRootAdaptiveExactCompletionScore ?? null,
    multiRootCompletionScore: chunkRun.multiRootCompletionScore ?? null,
    singletonRootAdaptiveExactCompletionProbeFinalist:
      chunkRun.singletonRootAdaptiveExactCompletionProbeFinalist === true,
    initialKthHitFloor: chunkRun.initialKthHitFloor,
    baseAllocatedMaxSearchStates: chunkRun.baseAllocatedMaxSearchStates,
    guardBandAllocatedSearchStates: chunkRun.guardBandAllocatedSearchStates,
    allocatedMaxSearchStates: chunkRun.allocatedMaxSearchStates,
    effectiveAllocatedMaxSearchStates:
      chunkRun.effectiveAllocatedMaxSearchStates ?? chunkRun.allocatedMaxSearchStates,
    topupAllocatedSearchStates: chunkRun.topupAllocatedSearchStates ?? 0,
    budgetTopupGrantedCount: chunkRun.budgetTopupGrantedCount ?? 0,
    pendingBudgetRevision: chunkRun.pendingBudgetRevision ?? 0,
    pendingBudgetRequestRevision: chunkRun.pendingBudgetRequestRevision ?? 0,
    pendingAllocatedMaxSearchStates: chunkRun.pendingAllocatedMaxSearchStates ?? null,
    lastObservedBudgetCommitRevision: chunkRun.lastObservedBudgetCommitRevision ?? 0,
    liveBudgetRevision: chunkRun.liveBudgetRevision ?? 0,
    remainingGlobalSearchBudgetAtLaunch: chunkRun.remainingGlobalSearchBudgetAtLaunch,
    launchedAt: chunkRun.launchedAt ?? null,
    completedAt: chunkRun.completedAt ?? null,
    durationMs: chunkRun.durationMs ?? null,
    pid: chunkRun.pid,
    slotCommandRevision: chunkRun.slotCommandRevision ?? null,
    outDir: chunkRun.outDir,
    summaryPath: chunkRun.summaryPath,
    progressPath: chunkRun.progressPath,
    liveBudgetPath: chunkRun.liveBudgetPath,
    budgetRequestPath: chunkRun.budgetRequestPath,
    budgetDecisionPath: chunkRun.budgetDecisionPath,
    budgetCommitPath: chunkRun.budgetCommitPath,
    rejectedRulesPath: chunkRun.rejectedRulesPath,
    partialRulesPath: chunkRun.partialRulesPath,
    livePartialRulesPath: chunkRun.livePartialRulesPath,
    truncatedByMaxSearchStates: chunkRun.truncatedByMaxSearchStates === true,
    budgetStopCount: chunkRun.budgetStopCount ?? 0,
    budgetStopExploredStates: chunkRun.budgetStopExploredStates ?? null,
    budgetStopReason: chunkRun.budgetStopReason ?? null,
    workerExploredStates: chunkRun.workerExploredStates ?? null,
    workerEffectiveAllocatedMaxSearchStates:
      chunkRun.workerEffectiveAllocatedMaxSearchStates ?? null,
    workerExternalAllocatedMaxSearchStates:
      chunkRun.workerExternalAllocatedMaxSearchStates ?? null,
    workerExternalBudgetRevision: chunkRun.workerExternalBudgetRevision ?? 0,
    workerExternalBudgetCommitRevision: chunkRun.workerExternalBudgetCommitRevision ?? 0,
    workerExternalBudgetAllowanceAppliedCount:
      chunkRun.workerExternalBudgetAllowanceAppliedCount ?? 0,
    workerExternalBudgetAllowanceSeenCount:
      chunkRun.workerExternalBudgetAllowanceSeenCount ?? 0,
    workerExternalBudgetAllowanceConsumedCount:
      chunkRun.workerExternalBudgetAllowanceConsumedCount ?? 0,
    workerExternalBudgetCommitRequestCount:
      chunkRun.workerExternalBudgetCommitRequestCount ?? 0,
    budgetTopupDeniedCount: chunkRun.budgetTopupDeniedCount ?? 0,
    lastBudgetDecisionRequestRevision: chunkRun.lastBudgetDecisionRequestRevision ?? 0,
    lastBudgetDecisionType: chunkRun.lastBudgetDecisionType ?? null,
    warmLaunchEligible: chunkRun.warmLaunchEligible === true,
    warmLaunchObserved: chunkRun.warmLaunchObserved === true,
    warmLaunchMs: chunkRun.warmLaunchMs ?? null,
    reclaimed: chunkRun.reclaimed === true,
  })
  const readChunkRunLivePartialRulesSnapshot = async (chunkRun) => {
    let payload = null
    try {
      payload = await readPerfectPrototypeLivePartialRulesSnapshotIfExists({
        snapshotPath: chunkRun.livePartialRulesPath,
      })
    } catch (error) {
      throw new Error(
        [
          "Parallel indexed miner live partial-rule snapshot is unreadable or malformed.",
          `path=${chunkRun.livePartialRulesPath}`,
          `cause=${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      )
    }
    if (payload == null) return null
    const revision = Math.floor(Number(payload?.revision) || 0)
    const observedRuleCount = Math.floor(Number(payload?.observedRuleCount) || 0)
    const liveCanonicalRuleCount = Math.floor(Number(payload?.liveCanonicalRuleCount) || 0)
    const rawLocalKthHitFloor = payload?.localKthHitFloor
    const localKthHitFloor =
      rawLocalKthHitFloor == null || String(rawLocalKthHitFloor).trim().length < 1
        ? null
        : Math.floor(Number(rawLocalKthHitFloor) || 0)
    const rules = Array.isArray(payload?.rules) ? payload.rules : null
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot has invalid revision: ${chunkRun.livePartialRulesPath}`,
      )
    }
    if (!Number.isInteger(observedRuleCount) || observedRuleCount < 0) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot has invalid observedRuleCount: ${chunkRun.livePartialRulesPath}`,
      )
    }
    if (!Number.isInteger(liveCanonicalRuleCount) || liveCanonicalRuleCount < 0) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot has invalid liveCanonicalRuleCount: ${chunkRun.livePartialRulesPath}`,
      )
    }
    if (rules == null) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot has invalid rules payload: ${chunkRun.livePartialRulesPath}`,
      )
    }
    if (revision === 0 && rules.length > 0) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot cannot contain rules at revision 0: ${chunkRun.livePartialRulesPath}`,
      )
    }
    if (
      localKthHitFloor != null &&
      (!Number.isInteger(localKthHitFloor) || localKthHitFloor < 1)
    ) {
      throw new Error(
        `Parallel indexed miner live partial-rule snapshot has invalid localKthHitFloor: ${chunkRun.livePartialRulesPath}`,
      )
    }
    return {
      revision,
      observedRuleCount,
      liveCanonicalRuleCount,
      localKthHitFloor,
      rules,
    }
  }
  const maybeRefreshActiveLivePartialRuleSnapshots = async ({
    activeChunkRuns,
    forceRebuild = false,
  }) => {
    let sawRevisionChange = false
    for (const chunkRun of activeChunkRuns) {
      const snapshot = await readChunkRunLivePartialRulesSnapshot(chunkRun)
      if (!snapshot) continue
      const previousSnapshot = latestLivePartialSnapshotsByChunk.get(chunkRun.chunkIndex) ?? null
      if (previousSnapshot && snapshot.revision < previousSnapshot.revision) {
        throw new Error(
          [
            "Parallel indexed miner live partial-rule snapshot revision regressed.",
            `chunkIndex=${chunkRun.chunkIndex}`,
            `previousRevision=${previousSnapshot.revision}`,
            `nextRevision=${snapshot.revision}`,
            `path=${chunkRun.livePartialRulesPath}`,
          ].join("\n"),
        )
      }
      if (!previousSnapshot || snapshot.revision > previousSnapshot.revision) {
        latestLivePartialSnapshotsByChunk.set(chunkRun.chunkIndex, snapshot)
        if (snapshot.revision > 0) {
          parallelLivePartialRuleRevisionCount += 1
        }
        sawRevisionChange = true
      }
    }
    if (sawRevisionChange !== true && forceRebuild !== true) return
    parallelActiveLiveRuleCount = Array.from(latestLivePartialSnapshotsByChunk.values()).reduce(
      (sum, snapshot) => sum + (Array.isArray(snapshot?.rules) ? snapshot.rules.length : 0),
      0,
    )
    if (latestLivePartialSnapshotsByChunk.size < 1) return
    const mergeStartedAt = Date.now()
    const aggregate = buildLivePartialRuleFloorAggregate({
      completedMergedBySignature: mergedBySignature,
      activeSnapshotsByChunk: latestLivePartialSnapshotsByChunk,
      maxRules: cfg.maxRules,
    })
    parallelLivePartialRuleMergeMs += Date.now() - mergeStartedAt
    if (
      Number.isInteger(aggregate.kthHitFloor) &&
      aggregate.kthHitFloor > 0 &&
      (!Number.isInteger(parallelCurrentGlobalKthHitFloor) ||
        aggregate.kthHitFloor > parallelCurrentGlobalKthHitFloor)
    ) {
      await writeLiveFloor({
        kthHitFloor: aggregate.kthHitFloor,
        observedRuleCount: aggregate.observedRuleCount,
        source: "live_partial",
      })
    }
  }
  const readChunkRunLiveState = async (chunkRun) => {
    const progressJson = await readControlPlaneJsonIfExists(
      chunkRun.progressPath,
      "Parallel indexed miner chunk progress file",
    )
    if (progressJson && chunkRun?.warmLaunchEligible === true && chunkRun?.warmLaunchObserved !== true) {
      chunkRun.warmLaunchObserved = true
      chunkRun.warmLaunchMs = Math.max(0, Date.now() - Number(chunkRun?.launchedAtMs ?? Date.now()))
      parallelWorkerWarmLaunchCount += 1
      parallelWorkerWarmLaunchMs += Number(chunkRun?.warmLaunchMs ?? 0)
    }
    const summaryJson =
      chunkRun.completed === true || (!progressJson && pathExists(chunkRun.summaryPath))
        ? await readControlPlaneJsonIfExists(
            chunkRun.summaryPath,
            "Parallel indexed miner chunk summary file",
          )
        : null
    const progressExploredStates = Number(progressJson?.exploredStates ?? 0)
    const summaryExploredStates = Number(summaryJson?.exploredStates ?? 0)
    const exploredStatesForProgress = Math.max(progressExploredStates, summaryExploredStates)
    const progressRulesCollected = Number(progressJson?.rulesCollected ?? 0)
    const summaryRulesCollected = Array.isArray(summaryJson?.rules)
      ? summaryJson.rules.length
      : Number(summaryJson?.rules ?? 0)
    const memoLookupMs = Math.max(
      Number(progressJson?.memoLookupMs ?? 0),
      Number(summaryJson?.rejectionSummary?.memoLookupMs ?? 0),
    )
    const progressPhase = String(
      progressJson?.phase ??
        (chunkRun.completed === true ? "completed" : "launch_pending_progress"),
    ).trim()
    const progressUpdatedAt =
      String(progressJson?.updatedAt ?? chunkRun?.launchedAt ?? "").trim() || null
    const progressUpdatedAtMs =
      progressUpdatedAt && Number.isFinite(Date.parse(progressUpdatedAt))
        ? Date.parse(progressUpdatedAt)
        : null
    const exploredStatesPerSec = Number(progressJson?.exploredStatesPerSec ?? Number.NaN)
    const seedCacheHitRate = Number(progressJson?.seedCacheHitRate ?? Number.NaN)
    const childOrderingMs = Math.max(
      Number(progressJson?.childOrderingMs ?? 0),
      Number(summaryJson?.rejectionSummary?.childOrderingMs ?? 0),
    )
    const orderingNegativeLoads = Math.max(
      Number(progressJson?.orderingNegativeLoads ?? 0),
      Number(summaryJson?.rejectionSummary?.orderingNegativeLoads ?? 0),
    )
    const boundPruneCount = Math.max(
      Number(progressJson?.boundPruneCount ?? 0),
      Number(summaryJson?.rejectionSummary?.boundPruneCount ?? 0),
    )
    const memoHitCount = Math.max(
      Number(progressJson?.memoHitCount ?? 0),
      Number(summaryJson?.rejectionSummary?.memoHitCount ?? 0),
    )
    const stateDominancePruneCount = Math.max(
      Number(progressJson?.stateDominancePruneCount ?? 0),
      Number(summaryJson?.rejectionSummary?.stateDominancePruneCount ?? 0),
    )
    const memoRangeSummaryRebuildCount = Math.max(
      Number(progressJson?.memoRangeSummaryRebuildCount ?? 0),
      Number(summaryJson?.rejectionSummary?.memoRangeSummaryRebuildCount ?? 0),
    )
    const memoRangeSkipPrefixCount = Math.max(
      Number(progressJson?.memoRangeSkipPrefixCount ?? 0),
      Number(summaryJson?.rejectionSummary?.memoRangeSkipPrefixCount ?? 0),
    )
    const memoRangeSkipSuffixCount = Math.max(
      Number(progressJson?.memoRangeSkipSuffixCount ?? 0),
      Number(summaryJson?.rejectionSummary?.memoRangeSkipSuffixCount ?? 0),
    )
    const livePartialRuleCount = Math.max(
      Number(progressJson?.livePartialRuleCount ?? 0),
      Number(summaryJson?.rejectionSummary?.livePartialRuleCount ?? 0),
    )
    const livePartialRuleRevision = Math.max(
      Number(progressJson?.livePartialRuleRevision ?? 0),
      Number(summaryJson?.rejectionSummary?.livePartialRuleRevision ?? 0),
    )
    const currentSearchDepth = Math.max(
      Number(progressJson?.currentSearchDepth ?? 0),
      Number(summaryJson?.rejectionSummary?.currentSearchDepth ?? 0),
    )
    const maxSearchDepth = Math.max(
      Number(progressJson?.maxSearchDepth ?? 0),
      Number(summaryJson?.rejectionSummary?.maxSearchDepth ?? 0),
    )
    const candidateDescriptorCount = Math.max(
      Number(progressJson?.candidateDescriptorCount ?? 0),
      Number(summaryJson?.rejectionSummary?.candidateDescriptorCount ?? 0),
    )
    const acceptedCandidateCount = Math.max(
      Number(progressJson?.acceptedCandidateCount ?? 0),
      Number(summaryJson?.rejectionSummary?.acceptedCandidateCount ?? 0),
    )
    const seedPostingCacheEntryLimit = Math.max(
      Number(progressJson?.seedPostingCacheEntryLimit ?? 0),
      Number(summaryJson?.rejectionSummary?.seedPostingCacheEntryLimit ?? 0),
    )
    const rowsetIntersectionMs = Math.max(
      Number(progressJson?.rowsetIntersectionMs ?? 0),
      Number(summaryJson?.rejectionSummary?.rowsetIntersectionMs ?? 0),
    )
    const seedPositiveLoadCount = Math.max(
      Number(progressJson?.seedPositiveLoadCount ?? 0),
      Number(summaryJson?.rejectionSummary?.seedPositiveLoadCount ?? 0),
    )
    const seedNegativeLoadCount = Math.max(
      Number(progressJson?.seedNegativeLoadCount ?? 0),
      Number(summaryJson?.rejectionSummary?.seedNegativeLoadCount ?? 0),
    )
    const seedPostingLoadMs = Math.max(
      Number(progressJson?.seedPostingLoadMs ?? 0),
      Number(summaryJson?.rejectionSummary?.seedPostingLoadMs ?? 0),
    )
    const candidateDescriptorBuildMs = Math.max(
      Number(progressJson?.candidateDescriptorBuildMs ?? 0),
      Number(summaryJson?.rejectionSummary?.candidateDescriptorBuildMs ?? 0),
    )
    const negativeCountResolutionMs = Math.max(
      Number(progressJson?.negativeCountResolutionMs ?? 0),
      Number(summaryJson?.rejectionSummary?.negativeCountResolutionMs ?? 0),
    )
    const childRowsetMaterializeMs = Math.max(
      Number(progressJson?.childRowsetMaterializeMs ?? 0),
      Number(summaryJson?.rejectionSummary?.childRowsetMaterializeMs ?? 0),
    )
    const externalBudgetRequestCount = Math.max(
      Number(progressJson?.externalBudgetRequestCount ?? 0),
      Number(summaryJson?.rejectionSummary?.externalBudgetRequestCount ?? 0),
    )
    const externalBudgetAppliedCount = Math.max(
      Number(progressJson?.externalBudgetAppliedCount ?? 0),
      Number(summaryJson?.rejectionSummary?.externalBudgetAppliedCount ?? 0),
    )
    const externalBudgetRequestPendingCount = Math.max(
      Number(progressJson?.externalBudgetRequestPendingCount ?? 0),
      Number(summaryJson?.rejectionSummary?.externalBudgetRequestPendingCount ?? 0),
    )
    const budgetStopCount = Math.max(
      Number(progressJson?.budgetStopCount ?? 0),
      Number(summaryJson?.rejectionSummary?.budgetStopCount ?? 0),
    )
    const budgetStopReason =
      String(
        progressJson?.budgetStopReason ?? summaryJson?.rejectionSummary?.budgetStopReason ?? "",
      ).trim() || null
    const etaSeconds =
      chunkRun.completed === true
        ? 0
        : Number.isFinite(Number(progressJson?.etaSeconds))
          ? Number(progressJson.etaSeconds)
          : null
    const effectiveAllocatedMaxSearchStates = Math.max(
      1,
      Number(
        progressJson?.effectiveAllocatedMaxSearchStates ??
          summaryJson?.rejectionSummary?.effectiveAllocatedMaxSearchStates ??
          chunkRun?.effectiveAllocatedMaxSearchStates ??
          chunkRun?.allocatedMaxSearchStates ??
          1,
      ),
    )
    const completionFraction =
      chunkRun.completed === true
        ? 1
        : Math.max(0, Math.min(1, exploredStatesForProgress / effectiveAllocatedMaxSearchStates))
    const dispatchScore = toFiniteNonNegativeMetric(chunkRun?.dispatchScore, 0)
    const firstWaveDispatchScore = toFiniteNonNegativeMetric(
      chunkRun?.firstWaveDispatchScore,
      0,
    )
    const headMicroprobeDispatchScore = toFiniteNonNegativeMetric(
      chunkRun?.headMicroprobeDispatchScore,
      0,
    )
    const singletonRootCompletionScore = toFiniteNonNegativeMetric(
      chunkRun?.singletonRootCompletionScore,
      0,
    )
    const singletonRootExactCompletionScore = toFiniteNonNegativeMetric(
      chunkRun?.singletonRootExactCompletionScore,
      0,
    )
    const singletonRootAdaptiveExactCompletionScore = toFiniteNonNegativeMetric(
      chunkRun?.singletonRootAdaptiveExactCompletionScore,
      0,
    )
    const multiRootCompletionScore = toFiniteNonNegativeMetric(
      chunkRun?.multiRootCompletionScore,
      0,
    )
    const yieldCandidateAcceptanceRate = toYieldRateMetric(
      acceptedCandidateCount,
      candidateDescriptorCount,
    )
    const yieldRulesPerAcceptedCandidate = toYieldRateMetric(
      Math.max(progressRulesCollected, summaryRulesCollected),
      acceptedCandidateCount,
    )
    const yieldLivePartialRulesPerAcceptedCandidate = toYieldRateMetric(
      livePartialRuleCount,
      acceptedCandidateCount,
    )
    const yieldRulesPerExploredState = toYieldRateMetric(
      Math.max(progressRulesCollected, summaryRulesCollected),
      exploredStatesForProgress,
    )
    const yieldLivePartialRulesPerExploredState = toYieldRateMetric(
      livePartialRuleCount,
      exploredStatesForProgress,
    )
    const liveState = {
      observedProgressFile: Boolean(progressJson),
      exploredStates: exploredStatesForProgress,
      rulesCollected: Math.max(progressRulesCollected, summaryRulesCollected),
      memoLookupMs,
      phase: progressPhase || (chunkRun.completed === true ? "completed" : null),
      progressUpdatedAt,
      progressAgeMs: progressUpdatedAtMs == null ? null : Math.max(0, Date.now() - progressUpdatedAtMs),
      exploredStatesPerSec: Number.isFinite(exploredStatesPerSec) ? exploredStatesPerSec : null,
      seedCacheHitRate: Number.isFinite(seedCacheHitRate) ? seedCacheHitRate : null,
      childOrderingMs,
      orderingNegativeLoads,
      boundPruneCount,
      memoHitCount,
      stateDominancePruneCount,
      memoRangeSummaryRebuildCount,
      memoRangeSkipPrefixCount,
      memoRangeSkipSuffixCount,
      livePartialRuleCount,
      livePartialRuleRevision,
      currentSearchDepth,
      maxSearchDepth,
      candidateDescriptorCount,
      acceptedCandidateCount,
      seedPostingCacheEntryLimit,
      seedPositiveLoadCount,
      seedNegativeLoadCount,
      seedPostingLoadMs,
      candidateDescriptorBuildMs,
      negativeCountResolutionMs,
      childRowsetMaterializeMs,
      rowsetIntersectionMs,
      externalBudgetRequestCount,
      externalBudgetAppliedCount,
      externalBudgetRequestPendingCount,
      budgetStopCount,
      budgetStopReason,
      etaSeconds,
      effectiveAllocatedMaxSearchStates,
      completionFraction,
      estimatedCostCompleted: Number(chunkRun?.estimatedCost ?? 0) * completionFraction,
      bootstrapDispatchScore: toFiniteNonNegativeMetric(chunkRun?.bootstrapDispatchScore, 0),
      dispatchScore,
      firstWaveDispatchScore,
      headMicroprobeDispatchScore,
      firstWaveCompletionTarget: chunkRun?.firstWaveCompletionTarget === true,
      singletonRootCompletionScore,
      singletonRootExactCompletionScore,
      singletonRootAdaptiveExactCompletionScore,
      multiRootCompletionScore,
      singletonRootAdaptiveExactCompletionProbeFinalist:
        chunkRun?.singletonRootAdaptiveExactCompletionProbeFinalist === true,
      yieldCandidateAcceptanceRate,
      yieldRulesPerAcceptedCandidate,
      yieldLivePartialRulesPerAcceptedCandidate,
      yieldRulesPerExploredState,
      yieldLivePartialRulesPerExploredState,
    }
    chunkRun.lastLiveState = liveState
    chunkRun.lastLiveStateObservedAtMs = Date.now()
    return liveState
  }
  const summarizeActiveChunkProgress = async ({ activeChunkRuns }) => {
    const liveStates = await Promise.all(
      activeChunkRuns.map((chunkRun) => readChunkRunLiveState(chunkRun)),
    )
    let activeChunkCount = 0
    let activeWaveExploredStates = 0
    let activeWaveRulesCollected = 0
    let activeWaveMemoLookupMs = 0
    let activeWaveEstimatedCost = 0
    let activeWaveEtaSeconds = null
    let observedProgressFileCount = 0
    const activeChunkTelemetry = []
    activeChunkRuns.forEach((chunkRun, index) => {
      const state = liveStates[index]
      if (chunkRun.completed !== true) {
        activeChunkCount += 1
        activeChunkTelemetry.push({
          chunkIndex: Number(chunkRun?.chunkIndex ?? -1),
          dispatchOrder: Number(chunkRun?.dispatchOrder ?? -1),
          dispatchPriorityIndex: Number(chunkRun?.dispatchPriorityIndex ?? -1),
          workerSlotIndex: Number(chunkRun?.workerSlotIndex ?? -1),
          waveIndex: Number(chunkRun?.waveIndex ?? -1),
          rootSeedStartIndex: Number(chunkRun?.start ?? -1),
          rootSeedEndIndexExclusive: Number(chunkRun?.end ?? -1),
          estimatedCost: Number(chunkRun?.estimatedCost ?? 0),
          bootstrapDispatchScore: Number(state?.bootstrapDispatchScore ?? 0),
          dispatchScore: Number(state?.dispatchScore ?? 0),
          firstWaveDispatchScore: Number(state?.firstWaveDispatchScore ?? 0),
          headMicroprobeDispatchScore: Number(state?.headMicroprobeDispatchScore ?? 0),
          baseAllocatedMaxSearchStates: Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0),
          guardBandAllocatedSearchStates: Number(
            chunkRun?.guardBandAllocatedSearchStates ?? 0,
          ),
          allocatedMaxSearchStates: Number(chunkRun?.allocatedMaxSearchStates ?? 0),
          effectiveAllocatedMaxSearchStates: Number(
            state?.effectiveAllocatedMaxSearchStates ??
              chunkRun?.effectiveAllocatedMaxSearchStates ??
              chunkRun?.allocatedMaxSearchStates ??
              0,
          ),
          liveBudgetRevision: Number(chunkRun?.liveBudgetRevision ?? 0),
          remainingGlobalSearchBudgetAtLaunch: Number(
            chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0,
          ),
          completionFraction: Number(state?.completionFraction ?? 0),
          firstWaveCompletionTarget: state?.firstWaveCompletionTarget === true,
          singletonRootCompletionScore: Number(state?.singletonRootCompletionScore ?? 0),
          singletonRootExactCompletionScore: Number(
            state?.singletonRootExactCompletionScore ?? 0,
          ),
          singletonRootAdaptiveExactCompletionScore: Number(
            state?.singletonRootAdaptiveExactCompletionScore ?? 0,
          ),
          multiRootCompletionScore: Number(state?.multiRootCompletionScore ?? 0),
          singletonRootAdaptiveExactCompletionProbeFinalist:
            state?.singletonRootAdaptiveExactCompletionProbeFinalist === true,
          phase: state?.phase ?? null,
          exploredStates: Number(state?.exploredStates ?? 0),
          exploredStatesPerSec: Number.isFinite(Number(state?.exploredStatesPerSec))
            ? Number(state.exploredStatesPerSec)
            : null,
          rulesCollected: Number(state?.rulesCollected ?? 0),
          etaSeconds: Number.isFinite(Number(state?.etaSeconds)) ? Number(state.etaSeconds) : null,
          memoLookupMs: Number(state?.memoLookupMs ?? 0),
          seedCacheHitRate: Number.isFinite(Number(state?.seedCacheHitRate))
            ? Number(state.seedCacheHitRate)
            : null,
          childOrderingMs: Number(state?.childOrderingMs ?? 0),
          orderingNegativeLoads: Number(state?.orderingNegativeLoads ?? 0),
          boundPruneCount: Number(state?.boundPruneCount ?? 0),
          memoHitCount: Number(state?.memoHitCount ?? 0),
          stateDominancePruneCount: Number(state?.stateDominancePruneCount ?? 0),
          memoRangeSummaryRebuildCount: Number(state?.memoRangeSummaryRebuildCount ?? 0),
          memoRangeSkipPrefixCount: Number(state?.memoRangeSkipPrefixCount ?? 0),
          memoRangeSkipSuffixCount: Number(state?.memoRangeSkipSuffixCount ?? 0),
          livePartialRuleCount: Number(state?.livePartialRuleCount ?? 0),
          livePartialRuleRevision: Number(state?.livePartialRuleRevision ?? 0),
          externalBudgetRequestCount: Number(state?.externalBudgetRequestCount ?? 0),
          externalBudgetAppliedCount: Number(state?.externalBudgetAppliedCount ?? 0),
          externalBudgetRequestPendingCount: Number(
            state?.externalBudgetRequestPendingCount ?? 0,
          ),
          budgetStopCount: Number(state?.budgetStopCount ?? 0),
          budgetStopReason: state?.budgetStopReason ?? null,
          progressUpdatedAt: state?.progressUpdatedAt ?? null,
          progressAgeMs: state?.progressAgeMs ?? null,
          currentSearchDepth: Number(state?.currentSearchDepth ?? 0),
          maxSearchDepth: Number(state?.maxSearchDepth ?? 0),
          candidateDescriptorCount: Number(state?.candidateDescriptorCount ?? 0),
          acceptedCandidateCount: Number(state?.acceptedCandidateCount ?? 0),
          seedPostingCacheEntryLimit: Number(state?.seedPostingCacheEntryLimit ?? 0),
          seedPositiveLoadCount: Number(state?.seedPositiveLoadCount ?? 0),
          seedNegativeLoadCount: Number(state?.seedNegativeLoadCount ?? 0),
          seedPostingLoadMs: Number(state?.seedPostingLoadMs ?? 0),
          candidateDescriptorBuildMs: Number(state?.candidateDescriptorBuildMs ?? 0),
          negativeCountResolutionMs: Number(state?.negativeCountResolutionMs ?? 0),
          childRowsetMaterializeMs: Number(state?.childRowsetMaterializeMs ?? 0),
          rowsetIntersectionMs: Number(state?.rowsetIntersectionMs ?? 0),
          yieldCandidateAcceptanceRate: Number(state?.yieldCandidateAcceptanceRate ?? 0),
          yieldRulesPerAcceptedCandidate: Number(state?.yieldRulesPerAcceptedCandidate ?? 0),
          yieldLivePartialRulesPerAcceptedCandidate: Number(
            state?.yieldLivePartialRulesPerAcceptedCandidate ?? 0,
          ),
          yieldRulesPerExploredState: Number(state?.yieldRulesPerExploredState ?? 0),
          yieldLivePartialRulesPerExploredState: Number(
            state?.yieldLivePartialRulesPerExploredState ?? 0,
          ),
        })
      }
      activeWaveExploredStates += Number(state?.exploredStates ?? 0)
      activeWaveRulesCollected += Number(state?.rulesCollected ?? 0)
      activeWaveMemoLookupMs += Number(state?.memoLookupMs ?? 0)
      activeWaveEstimatedCost += Number(state?.estimatedCostCompleted ?? 0)
      if (state?.observedProgressFile === true) {
        observedProgressFileCount += 1
      }
      if (chunkRun.completed === true) return
      const etaSeconds = Number(state?.etaSeconds)
      if (!Number.isFinite(etaSeconds) || etaSeconds < 0) return
      activeWaveEtaSeconds =
        activeWaveEtaSeconds == null ? etaSeconds : Math.max(activeWaveEtaSeconds, etaSeconds)
    })
    activeChunkTelemetry.sort(
      (left, right) => Number(left?.dispatchOrder ?? 0) - Number(right?.dispatchOrder ?? 0),
    )
    return {
      activeChunkCount,
      activeWaveExploredStates,
      activeWaveRulesCollected,
      activeWaveMemoLookupMs: Number(activeWaveMemoLookupMs.toFixed(3)),
      activeWaveEtaSeconds:
        activeWaveEtaSeconds == null ? null : Number(activeWaveEtaSeconds.toFixed(1)),
      activeWaveEstimatedCost: Number(activeWaveEstimatedCost.toFixed(3)),
      activeAllocatedSearchBudget: getActiveInitialAllocatedSearchBudget({ activeChunkRuns }),
      activeEffectiveAllocatedSearchBudget: getActiveAllocatedSearchBudget({ activeChunkRuns }),
      activeChunkSnapshots: activeChunkTelemetry.map((entry) => ({ ...entry })),
      activeChunkTelemetry,
      outstandingAllowanceSearchStates: getActiveOutstandingAllowanceSearchBudget({ activeChunkRuns }),
      outstandingAllowanceChunkCount: getActiveOutstandingAllowanceChunkCount({ activeChunkRuns }),
      remainingSearchBudget: Math.max(
        0,
        cfg.maxSearchStates - (exploredStates + activeWaveExploredStates),
      ),
      remainingGrantableSearchBudget: getRemainingGrantableSearchBudget({ activeChunkRuns }),
      observedProgressFileCount,
    }
  }
  const mergePartialRule = (rule) => {
    const ruleMatchRowIndexes = rule?.matchRowIndexes ?? rule?.positiveMatchRowIndexes ?? []
    const signature = buildRuleMatchSignatureHash(ruleMatchRowIndexes)
    const bucket = mergedBySignature.get(signature) ?? []
    const existing = bucket.find((entry) =>
      areExactRowIndexArraysEqual(
        entry?.matchRowIndexes ?? entry?.positiveMatchRowIndexes ?? [],
        ruleMatchRowIndexes,
      ),
    )
    const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(existing ?? null, rule)
    if (!existing) {
      const nextHitCount = Number(rule?.trainHitCount ?? rule?.matchHitCount ?? 0)
      const currentFloor = partialMergeTopKTracker.getKthHitFloor()
      mergedObservedRuleCount += 1
      if (Number.isInteger(currentFloor) && currentFloor > 0 && nextHitCount < currentFloor) {
        partialMergeEvictedByHitFloorCount += 1
        return
      }
      bucket.push(rule)
      mergedBySignature.set(signature, bucket)
      notePartialMergeRuleInserted(signature, rule)
      const previousFloor = partialMergeTopKTracker.getKthHitFloor()
      partialMergeTopKTracker.observeHitCount(nextHitCount)
      const nextFloor = partialMergeTopKTracker.getKthHitFloor()
      if (nextFloor !== previousFloor) {
        pruneMergedByHitFloor(previousFloor, nextFloor)
      }
      updatePartialMergePeaks()
      return
    }
    if (winner === rule) {
      notePartialMergeRuleReplaced(signature, existing, rule)
      mergedBySignature.set(
        signature,
        bucket.map((entry) => (entry === existing ? rule : entry)),
      )
      updatePartialMergePeaks()
    }
  }
  const readChunkRunSummaryAndReclaimBudget = async (chunkRun) => {
    if (chunkRun?.reclaimed === true && chunkRun?.summaryJson) {
      return chunkRun.summaryJson
    }
    await maybeCommitChunkRunBudget({
      chunkRun,
      activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
    })
    const summaryJson = await readControlPlaneJsonIfExists(
      chunkRun.summaryPath,
      "Parallel indexed miner chunk summary file",
    )
    if (!summaryJson) {
      throw new Error(`Parallel indexed miner missing chunk summary: ${chunkRun.summaryPath}`)
    }
    const workerAllocatedMaxSearchStates = Number(
      summaryJson?.rejectionSummary?.allocatedMaxSearchStates ?? 0,
    )
    if (workerAllocatedMaxSearchStates !== Number(chunkRun?.allocatedMaxSearchStates ?? 0)) {
      throw new Error(
        [
          "Parallel indexed miner worker allocatedMaxSearchStates mismatch.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerAllocatedMaxSearchStates=${workerAllocatedMaxSearchStates}`,
          `chunkAllocatedMaxSearchStates=${Number(chunkRun?.allocatedMaxSearchStates ?? 0)}`,
        ].join("\n"),
      )
    }
    const workerConfiguredMaxSearchStates = Number(
      summaryJson?.rejectionSummary?.configuredMaxSearchStates ?? 0,
    )
    if (workerConfiguredMaxSearchStates !== cfg.maxSearchStates) {
      throw new Error(
        [
          "Parallel indexed miner worker configuredMaxSearchStates mismatch.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerConfiguredMaxSearchStates=${workerConfiguredMaxSearchStates}`,
          `parallelConfiguredMaxSearchStates=${cfg.maxSearchStates}`,
        ].join("\n"),
      )
    }
    const workerBaseAllocatedMaxSearchStates = Number(
      summaryJson?.rejectionSummary?.baseAllocatedMaxSearchStates ?? 0,
    )
    const workerGuardBandAllocatedSearchStates = Number(
      summaryJson?.rejectionSummary?.guardBandAllocatedSearchStates ?? 0,
    )
    if (
      workerBaseAllocatedMaxSearchStates !==
      Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0)
    ) {
      throw new Error(
        [
          "Parallel indexed miner worker baseAllocatedMaxSearchStates mismatch.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerBaseAllocatedMaxSearchStates=${workerBaseAllocatedMaxSearchStates}`,
          `chunkBaseAllocatedMaxSearchStates=${Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0)}`,
        ].join("\n"),
      )
    }
    if (
      workerGuardBandAllocatedSearchStates !==
      Number(chunkRun?.guardBandAllocatedSearchStates ?? 0)
    ) {
      throw new Error(
        [
          "Parallel indexed miner worker guardBandAllocatedSearchStates mismatch.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerGuardBandAllocatedSearchStates=${workerGuardBandAllocatedSearchStates}`,
          `chunkGuardBandAllocatedSearchStates=${Number(chunkRun?.guardBandAllocatedSearchStates ?? 0)}`,
        ].join("\n"),
      )
    }
    if (workerBaseAllocatedMaxSearchStates + workerGuardBandAllocatedSearchStates !== workerAllocatedMaxSearchStates) {
      throw new Error(
        [
          "Parallel indexed miner worker effective allocated search-state budget is inconsistent.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerBaseAllocatedMaxSearchStates=${workerBaseAllocatedMaxSearchStates}`,
          `workerGuardBandAllocatedSearchStates=${workerGuardBandAllocatedSearchStates}`,
          `workerAllocatedMaxSearchStates=${workerAllocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    const workerRemainingGlobalSearchBudgetAtLaunch = Number(
      summaryJson?.rejectionSummary?.remainingGlobalSearchBudgetAtLaunch ?? 0,
    )
    if (
      workerRemainingGlobalSearchBudgetAtLaunch !==
      Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0)
    ) {
      throw new Error(
        [
          "Parallel indexed miner worker remainingGlobalSearchBudgetAtLaunch mismatch.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerRemainingGlobalSearchBudgetAtLaunch=${workerRemainingGlobalSearchBudgetAtLaunch}`,
          `chunkRemainingGlobalSearchBudgetAtLaunch=${Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0)}`,
        ].join("\n"),
      )
    }
    const workerExploredStates = Number(summaryJson?.exploredStates ?? 0)
    const workerExternalAllocatedMaxSearchStates =
      summaryJson?.rejectionSummary?.externalAllocatedMaxSearchStates == null
        ? null
        : Number(summaryJson?.rejectionSummary?.externalAllocatedMaxSearchStates ?? 0)
    const workerExternalBudgetRevision = Number(
      summaryJson?.rejectionSummary?.externalBudgetRevision ?? 0,
    )
    const workerExternalBudgetCommitRevision = Number(
      summaryJson?.rejectionSummary?.externalBudgetCommitRevision ?? 0,
    )
    const workerExternalBudgetAllowanceAppliedCount = Number(
      summaryJson?.rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0,
    )
    const workerExternalBudgetAllowanceSeenCount = Number(
      summaryJson?.rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0,
    )
    const workerExternalBudgetAllowanceConsumedCount = Number(
      summaryJson?.rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0,
    )
    const workerExternalBudgetCommitRequestCount = Number(
      summaryJson?.rejectionSummary?.externalBudgetCommitRequestCount ?? 0,
    )
    const workerEffectiveAllocatedMaxSearchStates = Number(
      summaryJson?.rejectionSummary?.effectiveAllocatedMaxSearchStates ??
        workerAllocatedMaxSearchStates,
    )
    chunkRun.workerExploredStates = workerExploredStates
    chunkRun.workerExternalAllocatedMaxSearchStates = workerExternalAllocatedMaxSearchStates
    chunkRun.workerExternalBudgetRevision = workerExternalBudgetRevision
    chunkRun.workerExternalBudgetCommitRevision = workerExternalBudgetCommitRevision
    chunkRun.workerExternalBudgetAllowanceAppliedCount =
      workerExternalBudgetAllowanceAppliedCount
    chunkRun.workerExternalBudgetAllowanceSeenCount = workerExternalBudgetAllowanceSeenCount
    chunkRun.workerExternalBudgetAllowanceConsumedCount =
      workerExternalBudgetAllowanceConsumedCount
    chunkRun.workerExternalBudgetCommitRequestCount = workerExternalBudgetCommitRequestCount
    chunkRun.workerEffectiveAllocatedMaxSearchStates = workerEffectiveAllocatedMaxSearchStates
    chunkRun.truncatedByMaxSearchStates =
      summaryJson?.rejectionSummary?.truncatedByMaxSearchStates === true
    chunkRun.budgetStopCount = Number(summaryJson?.rejectionSummary?.budgetStopCount ?? 0)
    chunkRun.budgetStopExploredStates =
      summaryJson?.rejectionSummary?.budgetStopExploredStates ?? null
    chunkRun.budgetStopReason =
      String(summaryJson?.rejectionSummary?.budgetStopReason ?? "").trim() || null
    if (
      !Number.isInteger(workerEffectiveAllocatedMaxSearchStates) ||
      workerEffectiveAllocatedMaxSearchStates < workerAllocatedMaxSearchStates
    ) {
      throw new Error(
        [
          "Parallel indexed miner worker effectiveAllocatedMaxSearchStates is invalid.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerAllocatedMaxSearchStates=${workerAllocatedMaxSearchStates}`,
          `workerEffectiveAllocatedMaxSearchStates=${workerEffectiveAllocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    if (
      workerExternalAllocatedMaxSearchStates != null &&
      workerExternalAllocatedMaxSearchStates > workerEffectiveAllocatedMaxSearchStates
    ) {
      throw new Error(
        [
          "Parallel indexed miner worker externalAllocatedMaxSearchStates exceeded its effective budget.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerExternalAllocatedMaxSearchStates=${workerExternalAllocatedMaxSearchStates}`,
          `workerEffectiveAllocatedMaxSearchStates=${workerEffectiveAllocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    if (
      workerEffectiveAllocatedMaxSearchStates >
      getChunkRunApprovedAllocatedSearchBudget(chunkRun)
    ) {
      const workerCommittedGrantedAllocatedMaxSearchStates =
        resolveChunkRunBudgetRevisionSearchBudget({
          chunkRun,
          revision: workerExternalBudgetCommitRevision,
        })
      const acceptedGrantedEffectiveAllocatedMaxSearchStates = Math.max(
        getChunkRunApprovedAllocatedSearchBudget(chunkRun),
        Math.max(0, Number(workerCommittedGrantedAllocatedMaxSearchStates ?? 0)),
      )
      if (workerEffectiveAllocatedMaxSearchStates <= acceptedGrantedEffectiveAllocatedMaxSearchStates) {
        // Worker completed under an earlier committed revision before a later reclaim lowered the live budget.
      } else {
      throw new Error(
        [
          "Parallel indexed miner worker effective allocated search-state budget exceeded the parent-granted budget.",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `workerEffectiveAllocatedMaxSearchStates=${workerEffectiveAllocatedMaxSearchStates}`,
          `grantedEffectiveAllocatedMaxSearchStates=${acceptedGrantedEffectiveAllocatedMaxSearchStates}`,
          `currentApprovedAllocatedMaxSearchStates=${getChunkRunApprovedAllocatedSearchBudget(chunkRun)}`,
          `workerExternalBudgetCommitRevision=${workerExternalBudgetCommitRevision}`,
        ].join("\n"),
      )
      }
    }
    if (
      workerExternalBudgetCommitRevision > Number(chunkRun?.liveBudgetRevision ?? 0) &&
      Number(chunkRun?.pendingBudgetRevision ?? 0) > 0
    ) {
      await maybeCommitChunkRunBudget({
        chunkRun,
        activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      })
      if (workerExternalBudgetCommitRevision > Number(chunkRun?.liveBudgetRevision ?? 0)) {
        throw new Error(
          [
            "Parallel indexed miner worker reported an applied external budget without a matching committed budget ack.",
            `chunkIndex=${chunkRun.chunkIndex}`,
            `workerExternalBudgetCommitRevision=${workerExternalBudgetCommitRevision}`,
            `committedLiveBudgetRevision=${Number(chunkRun?.liveBudgetRevision ?? 0)}`,
          ].join("\n"),
        )
      }
    }
    if (
      Number(chunkRun?.pendingBudgetRevision ?? 0) > 0 &&
      workerEffectiveAllocatedMaxSearchStates <= getChunkRunCommittedAllocatedSearchBudget(chunkRun)
    ) {
      parallelBudgetUnusedAllowanceCount += 1
      chunkRun.pendingBudgetRevision = 0
      chunkRun.pendingBudgetRequestRevision = 0
      chunkRun.pendingAllocatedMaxSearchStates = null
    }
    if (workerExploredStates > workerEffectiveAllocatedMaxSearchStates) {
      throw new Error(
        [
          "Parallel indexed miner worker exceeded its allocated search-state budget.",
          "failureReason=actual_budget_overrun",
          `chunkIndex=${chunkRun.chunkIndex}`,
          `dispatchOrder=${chunkRun.dispatchOrder}`,
          `start=${chunkRun.start}`,
          `end=${chunkRun.end}`,
          `estimatedCost=${Number(chunkRun?.estimatedCost ?? 0)}`,
          `baseAllocatedMaxSearchStates=${workerBaseAllocatedMaxSearchStates}`,
          `guardBandAllocatedSearchStates=${workerGuardBandAllocatedSearchStates}`,
          `workerExternalAllocatedMaxSearchStates=${workerExternalAllocatedMaxSearchStates}`,
          `workerExploredStates=${workerExploredStates}`,
          `effectiveAllocatedMaxSearchStates=${workerEffectiveAllocatedMaxSearchStates}`,
        ].join("\n"),
      )
    }
    const expectedWorkerRuleCount = Array.isArray(summaryJson?.rules)
      ? summaryJson.rules.length
      : Number(summaryJson?.rules ?? 0)
    if (!pathExists(chunkRun.partialRulesPath) && expectedWorkerRuleCount > 0) {
      throw new Error(`Parallel indexed miner missing partial rules: ${chunkRun.outDir}`)
    }
    chunkRun.summaryJson = summaryJson
    workerSummaries.push(summaryJson)
    exploredStates += Number(summaryJson?.exploredStates ?? 0)
    chunkRun.reclaimed = true
    parallelCompletedChunkReclaimCount += 1
    parallelCompletedChunkReclaimSearchStates += Number(summaryJson?.exploredStates ?? 0)
    if (summaryJson?.rejectionSummary?.truncatedByMaxSearchStates === true) {
      workerTruncatedByMaxSearchStates = true
    }
    return summaryJson
  }
  const mergeChunkRunArtifacts = async (chunkRun, { onArtifactProgress = null } = {}) => {
    await (chunkRun?.summaryJson ?? readChunkRunSummaryAndReclaimBudget(chunkRun))
    let nextArtifactBudgetServiceAt = 0
    let artifactProgressCount = 0
    const maybeOnArtifactProgress = async () => {
      if (typeof onArtifactProgress !== "function") return
      artifactProgressCount += 1
      if (
        artifactProgressCount % 64 !== 0 &&
        Date.now() < nextArtifactBudgetServiceAt
      ) {
        return
      }
      nextArtifactBudgetServiceAt =
        Date.now() + PARALLEL_ARTIFACT_MERGE_BUDGET_SERVICE_INTERVAL_MS
      await onArtifactProgress()
    }
    if (pathExists(chunkRun.rejectedRulesPath)) {
      await iterateJsonl(chunkRun.rejectedRulesPath, {
        strict: true,
        onRow: async (row) => {
          if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
            rejectedRules.push(row)
          }
          await maybeOnArtifactProgress()
        },
      })
    }
    if (pathExists(chunkRun.partialRulesPath)) {
      await streamPerfectPrototypePartialRulesParquet({
        cwd,
        parquetPath: chunkRun.partialRulesPath,
        onRule: async (rule) => {
          mergePartialRule(rule)
          await maybeOnArtifactProgress()
        },
      })
    }
    parallelCompletedChunkCount += 1
    completedEstimatedCost += Number(chunkRun?.estimatedCost ?? 0)
  }
  const launchChunkRun = async ({
    chunk,
    workerSlotIndex,
    dispatchOrder,
    baseAllocatedMaxSearchStates,
    guardBandAllocatedSearchStates,
    allocatedMaxSearchStates,
    plannedBaseAllocatedMaxSearchStates = baseAllocatedMaxSearchStates,
    plannedGuardBandAllocatedSearchStates = guardBandAllocatedSearchStates,
    plannedAllocatedMaxSearchStates = allocatedMaxSearchStates,
    remainingGlobalSearchBudgetAtLaunch,
  }) => {
    const initialKthHitFloor = parallelCurrentGlobalKthHitFloor
    const waveIndex = Math.floor(dispatchOrder / workerCount)
    const workerSlot = workerSlots[workerSlotIndex]
    if (!workerSlot?.processHandle) {
      throw new Error(
        `Parallel indexed miner worker slot is not initialized: workerSlotIndex=${workerSlotIndex}`,
      )
    }
    const workerSlotDir = workerSlot.workerSlotDir
    const workerOutDir = path.join(
      workerSlotDir,
      `wave_${String(waveIndex).padStart(3, "0")}_chunk_${String(chunk.chunkIndex).padStart(3, "0")}`,
    )
    const liveBudgetPath = path.join(workerOutDir, PARALLEL_LIVE_BUDGET_FILENAME)
    const budgetRequestPath = path.join(workerOutDir, PARALLEL_BUDGET_REQUEST_FILENAME)
    const budgetDecisionPath = path.join(workerOutDir, PARALLEL_BUDGET_DECISION_FILENAME)
    const budgetCommitPath = path.join(workerOutDir, PARALLEL_BUDGET_COMMIT_FILENAME)
    const launchedAtMs = Date.now()
    const warmLaunchEligible = Number(workerSlot?.launchedChunkCount ?? 0) > 0
    const run = {
      chunkIndex: chunk.chunkIndex,
      waveIndex,
      workerSlotIndex,
      dispatchPriorityIndex: chunk.dispatchPriorityIndex,
      dispatchOrder,
      completionOrder: null,
      mergeOrder: null,
      start: chunk.start,
      end: chunk.end,
      estimatedCost: chunk.estimatedCost,
      steadyDispatchScore: chunk.steadyDispatchScore,
      bootstrapScore: chunk.bootstrapScore,
      bootstrapDispatchScore: chunk.bootstrapDispatchScore,
      dispatchScore: chunk.dispatchScore,
      firstWaveDispatchScore: chunk.firstWaveDispatchScore,
      headMicroprobeDispatchScore: chunk.headMicroprobeDispatchScore,
      bootstrapHead: chunk.bootstrapHead === true,
      firstWaveCompletionTarget: chunk.firstWaveCompletionTarget === true,
      singletonRootCompletionScore: chunk.singletonRootCompletionScore,
      singletonRootExactCompletionScore: chunk.singletonRootExactCompletionScore,
      singletonRootAdaptiveExactCompletionScore:
        chunk.singletonRootAdaptiveExactCompletionScore,
      multiRootCompletionScore: chunk.multiRootCompletionScore,
      singletonRootAdaptiveExactCompletionProbeFinalist:
        chunk.singletonRootAdaptiveExactCompletionProbeFinalist === true,
      initialKthHitFloor:
        Number.isInteger(initialKthHitFloor) && initialKthHitFloor > 0 ? initialKthHitFloor : null,
      baseAllocatedMaxSearchStates,
      guardBandAllocatedSearchStates,
      allocatedMaxSearchStates,
      plannedBaseAllocatedMaxSearchStates,
      plannedGuardBandAllocatedSearchStates,
      plannedAllocatedMaxSearchStates,
      effectiveAllocatedMaxSearchStates: allocatedMaxSearchStates,
      topupAllocatedSearchStates: 0,
      budgetTopupGrantedCount: 0,
      liveBudgetRevision: 0,
      remainingGlobalSearchBudgetAtLaunch,
      pid: Number(workerSlot?.pid ?? 0) || null,
      slotCommandRevision: null,
      outDir: workerOutDir,
      summaryPath: path.join(workerOutDir, "summary.json"),
      progressPath: path.join(workerOutDir, "progress.json"),
      liveBudgetPath,
      budgetRequestPath,
      budgetDecisionPath,
      budgetCommitPath,
      rejectedRulesPath: path.join(workerOutDir, "rejected_rules.jsonl"),
      partialRulesPath: path.join(workerOutDir, PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME),
      livePartialRulesPath: path.join(workerOutDir, PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME),
      launchedAt: new Date(launchedAtMs).toISOString(),
      launchedAtMs,
      completedAt: null,
      durationMs: null,
      completedAtMs: null,
      completed: false,
      merged: false,
      budgetTopupDeniedCount: 0,
      pendingBudgetRevision: 0,
      pendingBudgetRequestRevision: 0,
      pendingAllocatedMaxSearchStates: null,
      lastObservedBudgetCommitRevision: 0,
      lastBudgetDecisionRequestRevision: 0,
      lastBudgetDecisionType: null,
      terminationRequested: false,
      terminationReason: null,
      reclaimed: false,
      completionPromise: null,
      processHandle: workerSlot.processHandle,
      warmLaunchEligible,
      warmLaunchObserved: false,
      warmLaunchMs: null,
      lastLiveState: null,
      budgetRevisionSearchBudgetHistory: new Map([[0, allocatedMaxSearchStates]]),
    }
    if (warmLaunchEligible) {
      parallelWorkerSlotReuseCount += 1
    }
    if (Number.isInteger(initialKthHitFloor) && initialKthHitFloor > 0) {
      parallelFloorSeededChunkCount += 1
      if (parallelFirstBootstrapFloorElapsedMs != null) {
        parallelBootstrapFloorSeededLaunchCount += 1
      }
    }
    run.completionPromise = (async () => {
      await ensureDir(workerSlotDir)
      await ensureDir(workerOutDir)
      await writeJsonAtomic(liveBudgetPath, {
        version: 1,
        revision: 0,
        chunkIndex: chunk.chunkIndex,
        allocatedMaxSearchStates,
        updatedAt: new Date().toISOString(),
      })
      run.slotCommandRevision = await dispatchWorkerSlotCommand({
        slot: workerSlot,
        command: "run_chunk",
        commandPayload: {
          chunkIndex: chunk.chunkIndex,
          outDir: workerOutDir,
          options: buildWorkerCommandOptions({
            chunk,
            workerOutDir,
            initialKthHitFloor,
            baseAllocatedMaxSearchStates,
            guardBandAllocatedSearchStates,
            allocatedMaxSearchStates,
            remainingGlobalSearchBudgetAtLaunch,
            externalBudgetPath: liveBudgetPath,
          }),
        },
      })
      workerSlot.launchedChunkCount += 1
      try {
        await waitForWorkerSlotChunkCompletion({
          slot: workerSlot,
          chunkRun: run,
        })
      } finally {
        const completedAtMs = Date.now()
        run.completed = true
        run.completedAtMs = completedAtMs
        run.completedAt = new Date(completedAtMs).toISOString()
        run.durationMs = Math.max(0, completedAtMs - launchedAtMs)
        if (run.warmLaunchEligible === true && run.warmLaunchObserved !== true) {
          run.warmLaunchObserved = true
          run.warmLaunchMs = run.durationMs
          parallelWorkerWarmLaunchCount += 1
          parallelWorkerWarmLaunchMs += Number(run.warmLaunchMs ?? 0)
        }
      }
    })()
    run.completionPromise.catch(() => {})
    chunkRunRecords.push(run)
    return run
  }
  const terminateActiveChunkRuns = async ({
    activeChunkRuns,
    reason = "parent_failfast",
  }) => {
    await Promise.allSettled(
      activeChunkRuns.map(async (chunkRun) => {
        if (chunkRun) {
          chunkRun.terminationRequested = true
          chunkRun.terminationReason = reason
        }
        const pid = Number(chunkRun?.pid ?? 0)
        if (chunkRun?.completed !== true && Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, "SIGTERM")
          } catch {}
        }
        await chunkRun?.completionPromise?.catch(() => {})
      }),
    )
  }
  const partialRuleMergeStartedAt = Date.now()
  const readyQueue = readyQueuePlan.slice()
  const availableWorkerSlots = Array.from({ length: workerCount }, (_, index) => index)
  const slotIdleStartedAtMs = Array.from({ length: workerCount }, () => null)
  const activeChunkRunsBySlot = new Map()
  let nextCompletionOrder = 0
  let nextMergeOrder = 0
  let budgetRequestServiceFastpathStopped = false
  let budgetRequestServiceFastpathLoopPromise = null
  let budgetRequestServiceFastpathInFlightPromise = null
  let budgetRequestServiceFastpathFailure = null
  let parallelAcceptedGlobalBudgetTruncation = false
  let parallelObservedTotalExploredStatesAtTruncation = null
  const assertBudgetRequestServiceFastpathHealthy = () => {
    if (!budgetRequestServiceFastpathFailure) return
    throw budgetRequestServiceFastpathFailure
  }
  const serviceBudgetRequestsFastpath = async () => {
    assertBudgetRequestServiceFastpathHealthy()
    if (budgetRequestServiceFastpathInFlightPromise) {
      return budgetRequestServiceFastpathInFlightPromise
    }
    budgetRequestServiceFastpathInFlightPromise = (async () => {
      parallelBudgetFastpathTickCount += 1
      parallelBudgetFastpathServiceCount += 1
      const serviceStartedAtMs = Date.now()
      try {
        await maybeServiceBudgetRequests({
          activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
        })
      } finally {
        parallelBudgetFastpathServiceMs += Math.max(0, Date.now() - serviceStartedAtMs)
        budgetRequestServiceFastpathInFlightPromise = null
      }
    })()
    return budgetRequestServiceFastpathInFlightPromise
  }
  const startBudgetRequestServiceFastpathLoop = () => {
    if (budgetRequestServiceFastpathLoopPromise) return
    budgetRequestServiceFastpathStopped = false
    budgetRequestServiceFastpathLoopPromise = (async () => {
      while (budgetRequestServiceFastpathStopped !== true) {
        assertBudgetRequestServiceFastpathHealthy()
        const activeChunkRuns = Array.from(activeChunkRunsBySlot.values())
        const fastpathIntervalMs = resolveParallelBudgetFastpathIntervalMs({
          activeChunkRuns,
        })
        const shouldServiceFastpath = shouldServiceParallelBudgetRequestsFastpath({
          activeChunkRuns,
        })
        if (shouldServiceFastpath) {
          parallelBudgetFastpathHotTickCount += 1
        } else {
          parallelBudgetFastpathIdleTickCount += 1
          parallelBudgetFastpathIdleSkipCount += 1
        }
        try {
          if (shouldServiceFastpath) {
            await serviceBudgetRequestsFastpath()
          }
        } catch (error) {
          budgetRequestServiceFastpathFailure = error
          return
        }
        await sleep(fastpathIntervalMs)
      }
    })()
    budgetRequestServiceFastpathLoopPromise.catch(() => {})
  }
  const stopBudgetRequestServiceFastpathLoop = async ({ suppressFailure = false } = {}) => {
    budgetRequestServiceFastpathStopped = true
    await budgetRequestServiceFastpathLoopPromise?.catch(() => {})
    await budgetRequestServiceFastpathInFlightPromise?.catch(() => {})
    if (suppressFailure !== true) {
      assertBudgetRequestServiceFastpathHealthy()
    }
  }
  const maybeLaunchReadyChunks = async () => {
    while (availableWorkerSlots.length > 0 && readyQueue.length > 0 && workerTruncatedByMaxSearchStates !== true) {
      const activeChunkRuns = Array.from(activeChunkRunsBySlot.values())
      const activeChunkLaunchLimit = resolveParallelInitialActiveChunkLimit({
        workerCount,
        maxSearchStates: cfg.maxSearchStates,
        firstChunkCompletionElapsedMs: parallelFirstChunkCompletionElapsedMs,
      })
      if (activeChunkRuns.length >= activeChunkLaunchLimit) {
        break
      }
      const remainingLaunchBudget = Math.max(
        0,
        cfg.maxSearchStates - exploredStates - getActiveAllocatedSearchBudget({ activeChunkRuns }),
      )
      const remainingChunkBudgetPlanByChunkIndex =
        allocateDeterministicChunkSearchBudgetPlanByChunkIndex({
        chunks: readyQueue,
        totalBudget: remainingLaunchBudget,
        })
      const nextChunk = readyQueue.shift()
      const nextChunkBudgetPlan =
        nextChunk == null
          ? null
          : remainingChunkBudgetPlanByChunkIndex.get(Number(nextChunk?.chunkIndex ?? -1)) ?? null
      if (!nextChunk || !nextChunkBudgetPlan) {
        throw new Error("Parallel indexed miner failed to resolve a budget plan for the next chunk launch.")
      }
      const nextChunkBaseBudget = Number(
        nextChunkBudgetPlan?.baseAllocatedMaxSearchStates ?? 0,
      )
      const nextChunkGuardBandBudget = Number(
        nextChunkBudgetPlan?.guardBandAllocatedSearchStates ?? 0,
      )
      const nextChunkBudget = Number(nextChunkBudgetPlan?.allocatedMaxSearchStates ?? 0)
      const nextChunkInitialLeasePlan = resolveParallelInitialChunkLeaseBudgetPlan({
        plannedBaseAllocatedMaxSearchStates: nextChunkBaseBudget,
        plannedGuardBandAllocatedSearchStates: nextChunkGuardBandBudget,
        plannedAllocatedMaxSearchStates: nextChunkBudget,
        externalBudgetRequestHeadroomStates,
        externalBudgetRequestSearchStates,
      })
      const workerSlotIndex = Number(availableWorkerSlots.shift())
      if (slotIdleStartedAtMs[workerSlotIndex] != null) {
        parallelSlotIdleMs += Math.max(0, Date.now() - slotIdleStartedAtMs[workerSlotIndex])
        slotIdleStartedAtMs[workerSlotIndex] = null
      }
      const dispatchOrder = parallelDispatchCount
      if (dispatchOrder >= workerCount) {
        parallelImmediateRefillCount += 1
      }
      const run = await launchChunkRun({
        chunk: nextChunk,
        workerSlotIndex,
        dispatchOrder,
        baseAllocatedMaxSearchStates:
          nextChunkInitialLeasePlan.initialBaseAllocatedMaxSearchStates,
        guardBandAllocatedSearchStates:
          nextChunkInitialLeasePlan.initialGuardBandAllocatedSearchStates,
        allocatedMaxSearchStates:
          nextChunkInitialLeasePlan.initialAllocatedMaxSearchStates,
        plannedBaseAllocatedMaxSearchStates:
          nextChunkInitialLeasePlan.plannedBaseAllocatedMaxSearchStates,
        plannedGuardBandAllocatedSearchStates:
          nextChunkInitialLeasePlan.plannedGuardBandAllocatedSearchStates,
        plannedAllocatedMaxSearchStates:
          nextChunkInitialLeasePlan.plannedAllocatedMaxSearchStates,
        remainingGlobalSearchBudgetAtLaunch: remainingLaunchBudget,
      })
      activeChunkRunsBySlot.set(workerSlotIndex, run)
      parallelDispatchCount += 1
    }
  }
  let parallelMainFailure = null
  try {
    await Promise.all(workerSlots.map((slot) => spawnPersistentWorkerSlot(slot)))
    for (const slot of workerSlots) {
      slotIdleStartedAtMs[slot.workerSlotIndex] = Date.now()
    }
    startBudgetRequestServiceFastpathLoop()
    await maybeLaunchReadyChunks()
    await maybeRefreshActiveLivePartialRuleSnapshots({
      activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      forceRebuild: true,
    })
    await serviceBudgetRequestsFastpath()
    await writeParallelProgress({
      phase: activeChunkRunsBySlot.size > 0 ? "search_ready_queue" : "completed",
      activeDispatchGroupIndex:
        activeChunkRunsBySlot.size > 0
          ? Math.min(
              ...Array.from(activeChunkRunsBySlot.values()).map((chunkRun) => Number(chunkRun?.waveIndex ?? 0)),
            )
          : null,
      activeChunkCount: activeChunkRunsBySlot.size,
      activeSearchProgress: await summarizeActiveChunkProgress({
        activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      }),
      readyQueueHeadYieldTelemetry: buildReadyQueueHeadYieldTelemetry({
        readyQueue,
      }),
    })
    while (activeChunkRunsBySlot.size > 0 || readyQueue.length > 0) {
      assertBudgetRequestServiceFastpathHealthy()
      const activeChunkRuns = Array.from(activeChunkRunsBySlot.values())
      const raceCandidates = [
        sleep(PARALLEL_ACTIVE_PROGRESS_POLL_INTERVAL_MS).then(() => ({ type: "poll" })),
        ...activeChunkRuns.map((chunkRun) =>
          chunkRun.completionPromise.then(
            () => ({ type: "completion", chunkIndex: chunkRun.chunkIndex }),
            (error) => ({ type: "worker_error", chunkRun, error }),
          ),
        ),
      ]
      const raceResult = await Promise.race(raceCandidates)
      assertBudgetRequestServiceFastpathHealthy()
      if (raceResult?.type === "worker_error") {
        await terminateActiveChunkRuns({
          activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
          reason: "worker_error",
        })
        throw raceResult.error
      }
      const completedChunkRuns = Array.from(activeChunkRunsBySlot.values())
        .filter((chunkRun) => chunkRun.completed === true && chunkRun.merged !== true)
        .sort((left, right) => {
          const leftCompletedAtMs = Number(left?.completedAtMs ?? 0)
          const rightCompletedAtMs = Number(right?.completedAtMs ?? 0)
          if (leftCompletedAtMs !== rightCompletedAtMs) {
            return leftCompletedAtMs - rightCompletedAtMs
          }
          return Number(left?.dispatchOrder ?? 0) - Number(right?.dispatchOrder ?? 0)
        })
      await maybeRefreshActiveLivePartialRuleSnapshots({
        activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      })
      if (completedChunkRuns.length > 0) {
        await serviceBudgetRequestsFastpath()
      }
      const reclaimedChunkRuns = []
      for (const chunkRun of completedChunkRuns) {
        activeChunkRunsBySlot.delete(chunkRun.workerSlotIndex)
        availableWorkerSlots.push(chunkRun.workerSlotIndex)
        slotIdleStartedAtMs[chunkRun.workerSlotIndex] = Date.now()
        if (parallelFirstChunkCompletionElapsedMs == null) {
          parallelFirstChunkCompletionElapsedMs = Math.max(0, Date.now() - parallelStartedAt)
        }
        latestLivePartialSnapshotsByChunk.delete(chunkRun.chunkIndex)
        parallelActiveLiveRuleCount = Array.from(latestLivePartialSnapshotsByChunk.values()).reduce(
          (sum, snapshot) => sum + (Array.isArray(snapshot?.rules) ? snapshot.rules.length : 0),
          0,
        )
        chunkRun.completionOrder = nextCompletionOrder
        nextCompletionOrder += 1
        await readChunkRunSummaryAndReclaimBudget(chunkRun)
        reclaimedChunkRuns.push(chunkRun)
      }
      await serviceBudgetRequestsFastpath()
      for (const chunkRun of reclaimedChunkRuns) {
        const previousFloor = partialMergeTopKTracker.getKthHitFloor()
        const mergeStartedAt = Date.now()
        await mergeChunkRunArtifacts(chunkRun, {
          onArtifactProgress: async () => {
            await serviceBudgetRequestsFastpath()
          },
        })
        parallelWaveMergeMs += Date.now() - mergeStartedAt
        chunkRun.mergeOrder = nextMergeOrder
        nextMergeOrder += 1
        chunkRun.merged = true
        const nextFloor = partialMergeTopKTracker.getKthHitFloor()
        if (
          Number.isInteger(nextFloor) &&
          nextFloor > 0 &&
          (!Number.isInteger(previousFloor) || nextFloor > previousFloor)
        ) {
          await writeLiveFloor({
            kthHitFloor: nextFloor,
            observedRuleCount: mergedObservedRuleCount,
            source: "completed",
          })
        }
        await maybeRefreshActiveLivePartialRuleSnapshots({
          activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
          forceRebuild: true,
        })
        await serviceBudgetRequestsFastpath()
      }
      if (workerTruncatedByMaxSearchStates === true) {
        const truncatedChunkRun =
          chunkRunRecords.find((chunkRun) => chunkRun?.truncatedByMaxSearchStates === true) ?? null
        const activeChunkRunsAtStop = Array.from(activeChunkRunsBySlot.values())
        const activeSearchProgressAtStop = await summarizeActiveChunkProgress({
          activeChunkRuns: activeChunkRunsAtStop,
        })
        const remainingBudgetHeadroomAtStop = Math.max(
          0,
          cfg.maxSearchStates -
            exploredStates -
            getActiveAllocatedSearchBudget({
              activeChunkRuns: activeChunkRunsAtStop,
            }),
        )
        if (remainingBudgetHeadroomAtStop > 0) {
          await terminateActiveChunkRuns({
            activeChunkRuns: activeChunkRunsAtStop,
            reason: "local_budget_exact_stop_without_topup",
          })
          await writeParallelProgress({
            phase: "failed_search_budget",
            activeDispatchGroupIndex:
              activeChunkRunsBySlot.size > 0
                ? Math.min(
                    ...Array.from(activeChunkRunsBySlot.values()).map((chunkRun) =>
                      Number(chunkRun?.waveIndex ?? 0),
                    ),
                  )
                : null,
            activeChunkCount: activeChunkRunsBySlot.size,
            activeSearchProgress: activeSearchProgressAtStop,
            readyQueueHeadYieldTelemetry: buildReadyQueueHeadYieldTelemetry({
              readyQueue,
            }),
          })
          throw new Error(
            [
              "Parallel indexed miner exhausted a leased chunk search-state budget before exact search completed.",
              "failureReason=local_budget_exact_stop_without_topup",
              `configuredMaxSearchStates=${cfg.maxSearchStates}`,
              `aggregateExploredStates=${exploredStates}`,
              `remainingBudgetHeadroomAtStop=${remainingBudgetHeadroomAtStop}`,
              `completedChunkCount=${parallelCompletedChunkCount}`,
              truncatedChunkRun
                ? `chunkIndex=${Number(truncatedChunkRun?.chunkIndex ?? -1)}`
                : null,
              truncatedChunkRun
                ? `dispatchOrder=${Number(truncatedChunkRun?.dispatchOrder ?? -1)}`
                : null,
              truncatedChunkRun ? `start=${Number(truncatedChunkRun?.start ?? -1)}` : null,
              truncatedChunkRun ? `end=${Number(truncatedChunkRun?.end ?? -1)}` : null,
              truncatedChunkRun
                ? `estimatedCost=${Number(truncatedChunkRun?.estimatedCost ?? 0)}`
                : null,
              truncatedChunkRun
                ? `baseAllocatedMaxSearchStates=${Number(truncatedChunkRun?.baseAllocatedMaxSearchStates ?? 0)}`
                : null,
              truncatedChunkRun
                ? `guardBandAllocatedSearchStates=${Number(truncatedChunkRun?.guardBandAllocatedSearchStates ?? 0)}`
                : null,
              truncatedChunkRun
                ? `effectiveAllocatedMaxSearchStates=${Number(truncatedChunkRun?.workerEffectiveAllocatedMaxSearchStates ?? truncatedChunkRun?.effectiveAllocatedMaxSearchStates ?? truncatedChunkRun?.allocatedMaxSearchStates ?? 0)}`
                : null,
              truncatedChunkRun
                ? `budgetStopExploredStates=${Number(truncatedChunkRun?.budgetStopExploredStates ?? 0)}`
                : null,
              truncatedChunkRun
                ? `budgetStopReason=${String(truncatedChunkRun?.budgetStopReason ?? "")}`
                : null,
              "Use a larger maxSearchStates budget that fully covers the exact search or run with --workers=1.",
            ]
              .filter(Boolean)
              .join("\n"),
          )
        }
        await maybeRefreshActiveLivePartialRuleSnapshots({
          activeChunkRuns: activeChunkRunsAtStop,
          forceRebuild: true,
        })
        await terminateActiveChunkRuns({
          activeChunkRuns: activeChunkRunsAtStop,
          reason: "global_budget_cap_reached",
        })
        await maybeRefreshActiveLivePartialRuleSnapshots({
          activeChunkRuns: activeChunkRunsAtStop,
          forceRebuild: true,
        })
        parallelAcceptedGlobalBudgetTruncation = true
        parallelObservedTotalExploredStatesAtTruncation = Math.max(
          exploredStates,
          Math.min(
            cfg.maxSearchStates,
            exploredStates + Number(activeSearchProgressAtStop?.activeWaveExploredStates ?? 0),
          ),
        )
        for (const [workerSlotIndex] of activeChunkRunsBySlot.entries()) {
          if (!availableWorkerSlots.includes(workerSlotIndex)) {
            availableWorkerSlots.push(workerSlotIndex)
          }
          slotIdleStartedAtMs[workerSlotIndex] = Date.now()
        }
        activeChunkRunsBySlot.clear()
        await writeParallelProgress({
          phase: "truncated_search_budget",
          activeDispatchGroupIndex: null,
          activeChunkCount: 0,
          activeSearchProgress: activeSearchProgressAtStop,
          readyQueueHeadYieldTelemetry: buildReadyQueueHeadYieldTelemetry({
            readyQueue,
          }),
        })
        break
      }
      await maybeLaunchReadyChunks()
      const activeSearchProgress = await summarizeActiveChunkProgress({
        activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      })
      await writeParallelProgress({
        phase: activeChunkRunsBySlot.size > 0 ? "search_ready_queue" : "merge_ready_queue",
        activeDispatchGroupIndex:
          activeChunkRunsBySlot.size > 0
            ? Math.min(
                ...Array.from(activeChunkRunsBySlot.values()).map((chunkRun) => Number(chunkRun?.waveIndex ?? 0)),
              )
            : null,
        activeChunkCount: activeChunkRunsBySlot.size,
        activeSearchProgress,
        readyQueueHeadYieldTelemetry: buildReadyQueueHeadYieldTelemetry({
          readyQueue,
        }),
      })
    }
    await stopBudgetRequestServiceFastpathLoop()

    const finalizedExploredStates =
      parallelAcceptedGlobalBudgetTruncation === true
        ? Math.max(0, Number(parallelObservedTotalExploredStatesAtTruncation ?? exploredStates))
        : exploredStates
    const mergedLiveAggregate = buildMergedLiveCanonicalRuleAggregate({
      completedMergedBySignature: mergedBySignature,
      activeSnapshotsByChunk:
        parallelAcceptedGlobalBudgetTruncation === true
          ? latestLivePartialSnapshotsByChunk
          : new Map(),
    })
    const mergedLiveRules = mergedLiveAggregate.rules
    const mergedRules = selectTopPerfectPrototypeRulesDeterministically(
      mergedLiveRules,
      cfg.maxRules,
    )
    const mergedRejectionSummary = mergeRejectionSummaries(
      workerSummaries.map((row) => row?.rejectionSummary),
    )
    const externalBudgetLastDecisions = Array.from(
      new Set(
        workerSummaries
          .map((row) => String(row?.rejectionSummary?.externalBudgetLastDecision ?? "").trim())
          .filter((value) => value.length > 0),
      ),
    )
    mergedRejectionSummary.externalBudgetLastDecision =
      externalBudgetLastDecisions.length === 1
        ? externalBudgetLastDecisions[0]
        : externalBudgetLastDecisions.length > 1
          ? "multiple"
          : null
    mergedRejectionSummary.orderingHeadWindow = orderingHeadWindow
    mergedRejectionSummary.observedRuleCount = mergedLiveAggregate.observedRuleCount
    mergedRejectionSummary.liveCanonicalRuleCount = mergedLiveAggregate.liveCanonicalRuleCount
    mergedRejectionSummary.collectedRuleCount = mergedLiveRules.length
    mergedRejectionSummary.finalSelectedRuleCount = mergedRules.length
    mergedRejectionSummary.truncatedByMaxSearchStates =
      mergedRejectionSummary.truncatedByMaxSearchStates === true ||
      parallelAcceptedGlobalBudgetTruncation === true
    mergedRejectionSummary.parallelAcceptedGlobalBudgetTruncation =
      parallelAcceptedGlobalBudgetTruncation
    mergedRejectionSummary.parallelObservedTotalExploredStatesAtTruncation =
      parallelObservedTotalExploredStatesAtTruncation
    mergedRejectionSummary.workerCount = workerCount
    mergedRejectionSummary.workerImbalanceRatio = workerImbalanceRatio
    mergedRejectionSummary.parallelChunkCount = chunks.length
    mergedRejectionSummary.parallelWaveCount = plannedWaveCount
    mergedRejectionSummary.parallelCompletedChunkCount = parallelCompletedChunkCount
    parallelCompletedWaveCount = computeCompletedLogicalWaveCount({
      totalCompletedChunkCount: parallelCompletedChunkCount,
    })
    mergedRejectionSummary.parallelCompletedWaveCount = parallelCompletedWaveCount
    mergedRejectionSummary.parallelGlobalKthHitFloor = parallelCurrentGlobalKthHitFloor
    mergedRejectionSummary.parallelFloorSeededChunkCount = parallelFloorSeededChunkCount
    mergedRejectionSummary.parallelWaveMergeMs = parallelWaveMergeMs
    mergedRejectionSummary.parallelChunkPlannerImbalanceRatio = parallelChunkPlannerImbalanceRatio
    mergedRejectionSummary.parallelFirstWaveFrontierSplitCount =
      parallelFirstWaveFrontierSplitCount
    mergedRejectionSummary.parallelFirstWaveLaunchSplitCount =
      parallelFirstWaveLaunchSplitCount
    mergedRejectionSummary.parallelFirstWaveRootSeedMicroshardCount =
      parallelFirstWaveRootSeedMicroshardCount
    mergedRejectionSummary.parallelFirstWaveForcedSingletonMicroshardCount =
      parallelFirstWaveForcedSingletonMicroshardCount
    mergedRejectionSummary.parallelFirstWaveCompletionTargetLaunchCount =
      parallelFirstWaveCompletionTargetLaunchCount
    mergedRejectionSummary.parallelFirstWaveExactCompletionProbeCount =
      parallelFirstWaveExactCompletionProbeCount
    mergedRejectionSummary.parallelFirstWaveExactCompletionProbeSingletonCandidateCount =
      parallelFirstWaveExactCompletionProbeSingletonCandidateCount
    mergedRejectionSummary.parallelFirstWaveExactCompletionProbeReachedTerminalCount =
      parallelFirstWaveExactCompletionProbeReachedTerminalCount
    mergedRejectionSummary.parallelFirstWaveExactCompletionProbeFoundFirstRuleCount =
      parallelFirstWaveExactCompletionProbeFoundFirstRuleCount
    mergedRejectionSummary.parallelFirstWaveExactCompletionProbeStateCap =
      parallelFirstWaveExactCompletionProbeStateCap
    mergedRejectionSummary.parallelFirstWaveExactCompletionScoreMin =
      parallelFirstWaveExactCompletionScoreMin
    mergedRejectionSummary.parallelFirstWaveExactCompletionScoreMax =
      parallelFirstWaveExactCompletionScoreMax
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount =
      parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeCount =
      parallelFirstWaveAdaptiveExactCompletionProbeCount
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount =
      parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount =
      parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin =
      parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax =
      parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionScoreMin =
      parallelFirstWaveAdaptiveExactCompletionScoreMin
    mergedRejectionSummary.parallelFirstWaveAdaptiveExactCompletionScoreMax =
      parallelFirstWaveAdaptiveExactCompletionScoreMax
    mergedRejectionSummary.parallelFirstWaveSingletonRootChunkCount =
      parallelFirstWaveSingletonRootChunkCount
    mergedRejectionSummary.parallelFirstWaveSingletonRootLaunchCount =
      parallelFirstWaveSingletonRootLaunchCount
    mergedRejectionSummary.parallelFirstWaveSingletonRootExactCompletionScoreMin =
      parallelFirstWaveSingletonRootExactCompletionScoreMin
    mergedRejectionSummary.parallelFirstWaveSingletonRootExactCompletionScoreMax =
      parallelFirstWaveSingletonRootExactCompletionScoreMax
    mergedRejectionSummary.parallelFirstWaveSingletonRootCompletionScoreMin =
      parallelFirstWaveSingletonRootCompletionScoreMin
    mergedRejectionSummary.parallelFirstWaveSingletonRootCompletionScoreMax =
      parallelFirstWaveSingletonRootCompletionScoreMax
    mergedRejectionSummary.parallelFirstWaveMultiRootChunkCount =
      parallelFirstWaveMultiRootChunkCount
    mergedRejectionSummary.parallelFirstWaveMultiRootLaunchCount =
      parallelFirstWaveMultiRootLaunchCount
    mergedRejectionSummary.parallelFirstWaveMultiRootCompletionScoreMin =
      parallelFirstWaveMultiRootCompletionScoreMin
    mergedRejectionSummary.parallelFirstWaveMultiRootCompletionScoreMax =
      parallelFirstWaveMultiRootCompletionScoreMax
    mergedRejectionSummary.parallelActiveProgressLiveSampleCount = parallelActiveProgressLiveSampleCount
    mergedRejectionSummary.parallelReadyQueueDepth = Math.max(0, chunks.length - parallelDispatchCount)
    mergedRejectionSummary.parallelDispatchCount = parallelDispatchCount
    mergedRejectionSummary.parallelImmediateRefillCount = parallelImmediateRefillCount
    mergedRejectionSummary.parallelLiveFloorUpdateCount = parallelLiveFloorUpdateCount
    mergedRejectionSummary.parallelLiveFloorRevision = parallelLiveFloorRevision
    mergedRejectionSummary.parallelFirstGlobalFloorElapsedMs = parallelFirstGlobalFloorElapsedMs
    mergedRejectionSummary.parallelLivePartialRuleRevisionCount = parallelLivePartialRuleRevisionCount
    mergedRejectionSummary.parallelLivePartialRuleMergeMs = parallelLivePartialRuleMergeMs
    mergedRejectionSummary.parallelLivePartialFloorUpdateCount = parallelLivePartialFloorUpdateCount
    mergedRejectionSummary.parallelFirstLivePartialFloorElapsedMs =
      parallelFirstLivePartialFloorElapsedMs
    mergedRejectionSummary.parallelBootstrapChunkCount = parallelBootstrapChunkCount
    mergedRejectionSummary.parallelFirstChunkCompletionElapsedMs =
      parallelFirstChunkCompletionElapsedMs
    mergedRejectionSummary.parallelFirstBootstrapFloorElapsedMs =
      parallelFirstBootstrapFloorElapsedMs
    mergedRejectionSummary.parallelBootstrapFloorSeededLaunchCount =
      parallelBootstrapFloorSeededLaunchCount
    mergedRejectionSummary.parallelActiveLiveRuleCount = parallelActiveLiveRuleCount
    mergedRejectionSummary.parallelActiveAllocatedSearchBudget = 0
    mergedRejectionSummary.parallelActiveEffectiveAllocatedSearchBudget = 0
    mergedRejectionSummary.parallelBudgetRequestCount = parallelBudgetRequestCount
    mergedRejectionSummary.parallelBudgetGrantCount = parallelBudgetGrantCount
    mergedRejectionSummary.parallelBudgetAllowanceCount = parallelBudgetAllowanceCount
    mergedRejectionSummary.parallelBudgetAllowanceSearchStates =
      parallelBudgetAllowanceSearchStates
    mergedRejectionSummary.parallelBudgetDenyCount = parallelBudgetDenyCount
    mergedRejectionSummary.parallelBudgetPendingCount = parallelBudgetPendingCount
    mergedRejectionSummary.parallelBudgetPendingActiveReclaimCount =
      parallelBudgetPendingActiveReclaimCount
    mergedRejectionSummary.parallelBudgetPendingCompletedReclaimCount =
      parallelBudgetPendingCompletedReclaimCount
    mergedRejectionSummary.parallelBudgetPendingRequiredDeltaPeak =
      parallelBudgetPendingRequiredDeltaPeak
    mergedRejectionSummary.parallelBudgetPendingWaitMs = parallelBudgetPendingWaitMs
    mergedRejectionSummary.parallelBudgetTopupCount = parallelBudgetTopupCount
    mergedRejectionSummary.parallelBudgetTopupSearchStates = parallelBudgetTopupSearchStates
    mergedRejectionSummary.parallelBudgetCommitRequestCount = parallelBudgetCommitRequestCount
    mergedRejectionSummary.parallelBudgetCommitCount = parallelBudgetCommitCount
    mergedRejectionSummary.parallelBudgetCommittedSearchStates =
      parallelBudgetCommittedSearchStates
    mergedRejectionSummary.parallelBudgetUnusedAllowanceCount =
      parallelBudgetUnusedAllowanceCount
    mergedRejectionSummary.parallelOutstandingAllowanceSearchStates = 0
    mergedRejectionSummary.parallelOutstandingAllowanceChunkCount = 0
    mergedRejectionSummary.parallelAllowanceToCommitLagMs = parallelAllowanceToCommitLagMs
    mergedRejectionSummary.parallelBudgetFastpathTickCount = parallelBudgetFastpathTickCount
    mergedRejectionSummary.parallelBudgetFastpathServiceCount =
      parallelBudgetFastpathServiceCount
    mergedRejectionSummary.parallelBudgetFastpathHotTickCount =
      parallelBudgetFastpathHotTickCount
    mergedRejectionSummary.parallelBudgetFastpathIdleTickCount =
      parallelBudgetFastpathIdleTickCount
    mergedRejectionSummary.parallelBudgetFastpathIdleSkipCount =
      parallelBudgetFastpathIdleSkipCount
    mergedRejectionSummary.parallelBudgetFastpathServiceMs = parallelBudgetFastpathServiceMs
    mergedRejectionSummary.parallelWorkerSlotCompletionPollCount =
      parallelWorkerSlotCompletionPollCount
    mergedRejectionSummary.parallelWorkerSlotCompletionHotPollCount =
      parallelWorkerSlotCompletionHotPollCount
    mergedRejectionSummary.parallelWorkerSlotCompletionSteadyPollCount =
      parallelWorkerSlotCompletionSteadyPollCount
    mergedRejectionSummary.parallelWorkerSlotCompletionPollServiceMs =
      parallelWorkerSlotCompletionPollServiceMs
    mergedRejectionSummary.parallelCompletedChunkReclaimCount =
      parallelCompletedChunkReclaimCount
    mergedRejectionSummary.parallelCompletedChunkReclaimSearchStates =
      parallelCompletedChunkReclaimSearchStates
    mergedRejectionSummary.parallelActiveReclaimAttemptCount =
      parallelActiveReclaimAttemptCount
    mergedRejectionSummary.parallelActiveReclaimCommitCount =
      parallelActiveReclaimCommitCount
    mergedRejectionSummary.parallelActiveReclaimSearchStates =
      parallelActiveReclaimSearchStates
    mergedRejectionSummary.parallelActiveReclaimSkippedStaleChunkCount =
      parallelActiveReclaimSkippedStaleChunkCount
    mergedRejectionSummary.parallelSlotIdleMs = parallelSlotIdleMs
    mergedRejectionSummary.parallelWorkerSpawnCount = parallelWorkerSpawnCount
    mergedRejectionSummary.parallelWorkerSlotReuseCount = parallelWorkerSlotReuseCount
    mergedRejectionSummary.parallelWorkerWarmLaunchCount = parallelWorkerWarmLaunchCount
    mergedRejectionSummary.parallelWorkerColdStartMs = parallelWorkerColdStartMs
    mergedRejectionSummary.parallelWorkerWarmLaunchMs = parallelWorkerWarmLaunchMs
    mergedRejectionSummary.parallelConfiguredMaxSearchStates = cfg.maxSearchStates
    mergedRejectionSummary.parallelRemainingSearchBudget = Math.max(
      0,
      cfg.maxSearchStates - finalizedExploredStates,
    )
    mergedRejectionSummary.parallelRemainingGrantableSearchBudget = Math.max(
      0,
      cfg.maxSearchStates - finalizedExploredStates,
    )
    Object.assign(mergedRejectionSummary, buildParallelPlanningMetrics())
    mergedRejectionSummary.seedSelectionMs = seedSelectionMs
    mergedRejectionSummary.partialRuleMergeMs = Date.now() - partialRuleMergeStartedAt
    mergedRejectionSummary.livePartialRuleRevision = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialRuleRevision ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialRuleCount = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialRuleCount ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialRuleCheckpointCount = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialRuleCheckpointCount ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialRuleWriteMs = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialRuleWriteMs ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialBootstrapSnapshotCount = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialBootstrapSnapshotCount ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialBootstrapRuleCount = workerSummaries.reduce(
      (sum, row) => Math.max(sum, Number(row?.rejectionSummary?.livePartialBootstrapRuleCount ?? 0)),
      0,
    )
    mergedRejectionSummary.livePartialBootstrapModeActive = workerSummaries.reduce(
      (sum, row) => sum + Number(row?.rejectionSummary?.livePartialBootstrapModeActive ?? 0),
      0,
    )
    mergedRejectionSummary.livePartialLocalKthHitFloor = workerSummaries.reduce((maxValue, row) => {
      const floor = Number(row?.rejectionSummary?.livePartialLocalKthHitFloor ?? 0)
      return Number.isInteger(floor) && floor > maxValue ? floor : maxValue
    }, 0) || null
    mergedRejectionSummary.partialMergePeakBucketCount = partialMergePeakBucketCount
    mergedRejectionSummary.partialMergePeakLiveRuleCount = partialMergePeakLiveRuleCount
    mergedRejectionSummary.partialMergeEvictedByHitFloorCount = partialMergeEvictedByHitFloorCount
    mergedRejectionSummary.partialMergeKthHitFloor = partialMergeTopKTracker.getKthHitFloor()
    mergedRejectionSummary.partialMergeTieBandRuleCount = partialMergeTieBandRuleCount
    mergedRejectionSummary.partialMergeTieBandBucketCount = partialMergeTieBandBucketCount
    mergedRejectionSummary.partialMergePeakTieBandRuleCount = partialMergePeakTieBandRuleCount
    mergedRejectionSummary.partialMergeCompactedBucketCount = partialMergeCompactedBucketCount
    mergedRejectionSummary.partialMergeCompactedRuleCount = partialMergeCompactedRuleCount
    if (
      (!parallelAcceptedGlobalBudgetTruncation && workerTruncatedByMaxSearchStates) ||
      finalizedExploredStates > cfg.maxSearchStates
    ) {
      throw new Error(
        [
          "Parallel indexed miner cannot guarantee exact global maxSearchStates semantics for this run.",
          `configuredMaxSearchStates=${cfg.maxSearchStates}`,
          `aggregateExploredStates=${finalizedExploredStates}`,
          `workerTruncatedByMaxSearchStates=${workerTruncatedByMaxSearchStates}`,
          `parallelAcceptedGlobalBudgetTruncation=${parallelAcceptedGlobalBudgetTruncation}`,
          "Use a larger maxSearchStates budget that fully covers the exact search or run with --workers=1.",
        ].join("\n"),
      )
    }

    const negativeSeparationReport = buildNegativeSeparationReport({
      seedEntries: seedStats,
      rejectedRules,
      rejectionSummary: mergedRejectionSummary,
      exploredStates: finalizedExploredStates,
    })

    const rowMeta = await loadPerfectPrototypeIndexedRowMeta({
      cwd,
      duckdb,
      rowMetaPath,
      manifest,
      summary,
    })
    const finalized = await finalizePerfectPrototypeIndexedRuleSet({
      resolvedIndexDir,
      resolvedOutDir,
      tokenizerSpec,
      manifestPath,
      summaryPath,
      manifest,
      summary,
      cfg,
      collectedRules: mergedRules,
      rejectedRules,
      rejectionSummary: mergedRejectionSummary,
      negativeSeparationReport,
      exploredStates: finalizedExploredStates,
      rowMeta,
    })
    await writeParallelProgress({
      phase: "completed",
      activeDispatchGroupIndex: plannedWaveCount > 0 ? plannedWaveCount - 1 : null,
      activeChunkCount: 0,
      readyQueueHeadYieldTelemetry: [],
    })
    await writeJsonAtomic(path.join(resolvedOutDir, "parallel_manifest.json"), {
      version: 14,
      generatedAt: new Date().toISOString(),
      ...buildParallelPlanningMetrics(),
      workerCount,
      requestedWorkers,
      parallelChunkCount: chunks.length,
      parallelWaveCount: plannedWaveCount,
      parallelCompletedChunkCount,
      parallelCompletedWaveCount,
      parallelGlobalKthHitFloor: parallelCurrentGlobalKthHitFloor,
      parallelFloorSeededChunkCount,
      parallelWaveMergeMs,
      parallelChunkPlannerImbalanceRatio,
      parallelFirstWaveFrontierSplitCount,
      parallelFirstWaveLaunchSplitCount,
      parallelFirstWaveRootSeedMicroshardCount,
      parallelFirstWaveForcedSingletonMicroshardCount,
      parallelFirstWaveCompletionTargetLaunchCount,
      parallelFirstWaveExactCompletionProbeCount,
      parallelFirstWaveExactCompletionProbeSingletonCandidateCount,
      parallelFirstWaveExactCompletionProbeReachedTerminalCount,
      parallelFirstWaveExactCompletionProbeFoundFirstRuleCount,
      parallelFirstWaveExactCompletionProbeStateCap,
      parallelFirstWaveExactCompletionScoreMin,
      parallelFirstWaveExactCompletionScoreMax,
      parallelFirstWaveAdaptiveExactCompletionProbeFinalistCount,
      parallelFirstWaveAdaptiveExactCompletionProbeCount,
      parallelFirstWaveAdaptiveExactCompletionProbeReachedTerminalCount,
      parallelFirstWaveAdaptiveExactCompletionProbeFoundFirstRuleCount,
      parallelFirstWaveAdaptiveExactCompletionProbeStateCapMin,
      parallelFirstWaveAdaptiveExactCompletionProbeStateCapMax,
      parallelFirstWaveAdaptiveExactCompletionScoreMin,
      parallelFirstWaveAdaptiveExactCompletionScoreMax,
      parallelFirstWaveSingletonRootChunkCount,
      parallelFirstWaveSingletonRootLaunchCount,
      parallelFirstWaveSingletonRootExactCompletionScoreMin,
      parallelFirstWaveSingletonRootExactCompletionScoreMax,
      parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMin,
      parallelFirstWaveSingletonRootAdaptiveExactCompletionScoreMax,
      parallelFirstWaveSingletonRootCompletionScoreMin,
      parallelFirstWaveSingletonRootCompletionScoreMax,
      parallelFirstWaveMultiRootChunkCount,
      parallelFirstWaveMultiRootLaunchCount,
      parallelFirstWaveMultiRootCompletionScoreMin,
      parallelFirstWaveMultiRootCompletionScoreMax,
      parallelActiveProgressLiveSampleCount,
      parallelReadyQueueDepth: Math.max(0, chunks.length - parallelDispatchCount),
      parallelDispatchCount,
      parallelImmediateRefillCount,
      parallelLiveFloorUpdateCount,
      parallelLiveFloorRevision,
      parallelFirstGlobalFloorElapsedMs,
      parallelLivePartialRuleRevisionCount,
      parallelLivePartialRuleMergeMs,
      parallelLivePartialFloorUpdateCount,
      parallelFirstLivePartialFloorElapsedMs,
      parallelBootstrapChunkCount,
      parallelFirstChunkCompletionElapsedMs,
      parallelFirstBootstrapFloorElapsedMs,
      parallelBootstrapFloorSeededLaunchCount,
      parallelActiveLiveRuleCount,
      parallelActiveAllocatedSearchBudget: 0,
      parallelActiveEffectiveAllocatedSearchBudget: 0,
      parallelBudgetRequestCount,
      parallelBudgetGrantCount,
      parallelBudgetAllowanceCount,
      parallelBudgetAllowanceSearchStates,
      parallelBudgetDenyCount,
      parallelBudgetPendingCount,
      parallelBudgetPendingActiveReclaimCount,
      parallelBudgetPendingCompletedReclaimCount,
      parallelBudgetPendingRequiredDeltaPeak,
      parallelBudgetPendingWaitMs,
      parallelBudgetTopupCount,
      parallelBudgetTopupSearchStates,
      parallelBudgetCommitRequestCount,
      parallelBudgetCommitCount,
      parallelBudgetCommittedSearchStates,
      parallelBudgetUnusedAllowanceCount,
      parallelActiveReclaimAttemptCount,
      parallelActiveReclaimCommitCount,
      parallelActiveReclaimSearchStates,
      parallelActiveReclaimSkippedStaleChunkCount,
      parallelOutstandingAllowanceSearchStates: 0,
      parallelOutstandingAllowanceChunkCount: 0,
      parallelAllowanceToCommitLagMs,
      parallelBudgetFastpathTickCount,
      parallelBudgetFastpathServiceCount,
      parallelBudgetFastpathHotTickCount,
      parallelBudgetFastpathIdleTickCount,
      parallelBudgetFastpathIdleSkipCount,
      parallelBudgetFastpathServiceMs,
      parallelWorkerSlotCompletionPollCount,
      parallelWorkerSlotCompletionHotPollCount,
      parallelWorkerSlotCompletionSteadyPollCount,
      parallelWorkerSlotCompletionPollServiceMs,
      parallelCompletedChunkReclaimCount,
      parallelCompletedChunkReclaimSearchStates,
      parallelSlotIdleMs,
      parallelWorkerSpawnCount,
      parallelWorkerSlotReuseCount,
      parallelWorkerWarmLaunchCount,
      parallelWorkerColdStartMs,
      parallelWorkerWarmLaunchMs,
      parallelConfiguredMaxSearchStates: cfg.maxSearchStates,
      parallelRemainingSearchBudget: Math.max(0, cfg.maxSearchStates - finalizedExploredStates),
      parallelRemainingGrantableSearchBudget: Math.max(
        0,
        cfg.maxSearchStates - finalizedExploredStates,
      ),
      parallelAcceptedGlobalBudgetTruncation,
      parallelObservedTotalExploredStatesAtTruncation,
      liveFloorPath,
      chunks,
      waves: logicalWaves.map((wave) => ({
        waveIndex: wave.waveIndex,
        estimatedCost: wave.estimatedCost,
        chunkIndexes: wave.chunkIndexes,
      })),
      chunkRuns: chunkRunRecords.map((chunkRun) => serializeChunkRunRecord(chunkRun)),
      selectedSeedCount,
      seedSelectionMs,
      partialRuleMergeMs: mergedRejectionSummary.partialRuleMergeMs,
      workerImbalanceRatio,
      boundPruneCount: mergedRejectionSummary.boundPruneCount ?? 0,
      memoHitCount: mergedRejectionSummary.memoHitCount ?? 0,
      memoLookupMs: mergedRejectionSummary.memoLookupMs ?? 0,
      memoPositiveSignatureBucketCount: mergedRejectionSummary.memoPositiveSignatureBucketCount ?? 0,
      memoFrontierInsertCount: mergedRejectionSummary.memoFrontierInsertCount ?? 0,
      memoFrontierPruneCount: mergedRejectionSummary.memoFrontierPruneCount ?? 0,
      memoFrontierScanCount: mergedRejectionSummary.memoFrontierScanCount ?? 0,
      memoFrontierDeleteCount: mergedRejectionSummary.memoFrontierDeleteCount ?? 0,
      memoFrontierSkippedBucketCount: mergedRejectionSummary.memoFrontierSkippedBucketCount ?? 0,
      memoFrontierCompactionCount: mergedRejectionSummary.memoFrontierCompactionCount ?? 0,
      memoFrontierBucketCount: mergedRejectionSummary.memoFrontierBucketCount ?? 0,
      memoFrontierTombstoneCount: mergedRejectionSummary.memoFrontierTombstoneCount ?? 0,
      memoFingerprintBucketPeak: mergedRejectionSummary.memoFingerprintBucketPeak ?? 0,
      stateDominancePruneCount: mergedRejectionSummary.stateDominancePruneCount ?? 0,
      memoCacheBytes: mergedRejectionSummary.memoCacheBytes ?? 0,
      memoEvictedBucketCount: mergedRejectionSummary.memoEvictedBucketCount ?? 0,
      memoEvictedFrontierEntryCount:
        mergedRejectionSummary.memoEvictedFrontierEntryCount ?? 0,
      memoOversizeSkipCount: mergedRejectionSummary.memoOversizeSkipCount ?? 0,
      memoRangeSkipPrefixCount: mergedRejectionSummary.memoRangeSkipPrefixCount ?? 0,
      memoRangeSkipSuffixCount: mergedRejectionSummary.memoRangeSkipSuffixCount ?? 0,
      memoRangeSummaryRebuildCount: mergedRejectionSummary.memoRangeSummaryRebuildCount ?? 0,
      memoExactFingerprintFastHitCount:
        mergedRejectionSummary.memoExactFingerprintFastHitCount ?? 0,
      memoExactFingerprintScanCount:
        mergedRejectionSummary.memoExactFingerprintScanCount ?? 0,
      memoFingerprintMetadataRebuildCount:
        mergedRejectionSummary.memoFingerprintMetadataRebuildCount ?? 0,
      livePartialRuleRevision: mergedRejectionSummary.livePartialRuleRevision ?? 0,
      livePartialRuleCount: mergedRejectionSummary.livePartialRuleCount ?? 0,
      livePartialRuleCheckpointCount: mergedRejectionSummary.livePartialRuleCheckpointCount ?? 0,
      livePartialRuleWriteMs: mergedRejectionSummary.livePartialRuleWriteMs ?? 0,
      livePartialBootstrapSnapshotCount:
        mergedRejectionSummary.livePartialBootstrapSnapshotCount ?? 0,
      livePartialBootstrapRuleCount:
        mergedRejectionSummary.livePartialBootstrapRuleCount ?? 0,
      livePartialBootstrapModeActive:
        mergedRejectionSummary.livePartialBootstrapModeActive ?? 0,
      livePartialLocalKthHitFloor: mergedRejectionSummary.livePartialLocalKthHitFloor ?? null,
      externalBudgetPollCount: mergedRejectionSummary.externalBudgetPollCount ?? 0,
      externalBudgetDecisionPollCount:
        mergedRejectionSummary.externalBudgetDecisionPollCount ?? 0,
      externalBudgetAppliedCount: mergedRejectionSummary.externalBudgetAppliedCount ?? 0,
      externalBudgetAllowanceAppliedCount:
        mergedRejectionSummary.externalBudgetAllowanceAppliedCount ?? 0,
      externalAllocatedMaxSearchStates:
        mergedRejectionSummary.externalAllocatedMaxSearchStates ?? 0,
      externalBudgetRevision: mergedRejectionSummary.externalBudgetRevision ?? 0,
      externalBudgetCommitRevision:
        mergedRejectionSummary.externalBudgetCommitRevision ?? 0,
      effectiveAllocatedMaxSearchStates:
        mergedRejectionSummary.effectiveAllocatedMaxSearchStates ?? 0,
      rowsetBorrowHitCount: mergedRejectionSummary.rowsetBorrowHitCount ?? 0,
      rowsetBorrowMissCount: mergedRejectionSummary.rowsetBorrowMissCount ?? 0,
      rowsetOwnedAllocCount: mergedRejectionSummary.rowsetOwnedAllocCount ?? 0,
      rowsetFinalizeCount: mergedRejectionSummary.rowsetFinalizeCount ?? 0,
      sparseKernelMode: mergedRejectionSummary.sparseKernelMode ?? "unknown",
      sparseSparseIntersectionMs: mergedRejectionSummary.sparseSparseIntersectionMs ?? 0,
      sparseBitmapIntersectionMs: mergedRejectionSummary.sparseBitmapIntersectionMs ?? 0,
      sparseEqualSizeMergeCount: mergedRejectionSummary.sparseEqualSizeMergeCount ?? 0,
      sparseAdaptiveGallopCount: mergedRejectionSummary.sparseAdaptiveGallopCount ?? 0,
      sparseCountFastPathCount: mergedRejectionSummary.sparseCountFastPathCount ?? 0,
      sparseBitmapWordRunCount: mergedRejectionSummary.sparseBitmapWordRunCount ?? 0,
      sparseBitmapSkippedRunCount: mergedRejectionSummary.sparseBitmapSkippedRunCount ?? 0,
      sparseBitmapPartialRunCount: mergedRejectionSummary.sparseBitmapPartialRunCount ?? 0,
      sparseBitmapFullRunHitCount: mergedRejectionSummary.sparseBitmapFullRunHitCount ?? 0,
      bitmapKernelMode: mergedRejectionSummary.bitmapKernelMode ?? "unknown",
      bitmapDenseDenseCount: mergedRejectionSummary.bitmapDenseDenseCount ?? 0,
      bitmapIntersectionMs: mergedRejectionSummary.bitmapIntersectionMs ?? 0,
      bitmapMaterializeMs: mergedRejectionSummary.bitmapMaterializeMs ?? 0,
      bitmapEdgeSummaryMs: mergedRejectionSummary.bitmapEdgeSummaryMs ?? 0,
      childOrderingMs: mergedRejectionSummary.childOrderingMs ?? 0,
      orderingNegativeLoads: mergedRejectionSummary.orderingNegativeLoads ?? 0,
      orderingHeadWindow: mergedRejectionSummary.orderingHeadWindow ?? 0,
      orderingHeadExactLoads: mergedRejectionSummary.orderingHeadExactLoads ?? 0,
      orderingHeadRerankMs: mergedRejectionSummary.orderingHeadRerankMs ?? 0,
      rowsetModeStats: mergedRejectionSummary.rowsetModeStats ?? {},
      partialMergePeakBucketCount,
      partialMergePeakLiveRuleCount,
      partialMergeEvictedByHitFloorCount,
      partialMergeKthHitFloor: partialMergeTopKTracker.getKthHitFloor(),
      partialMergeTieBandRuleCount,
      partialMergeTieBandBucketCount,
      partialMergePeakTieBandRuleCount,
      partialMergeCompactedBucketCount,
      partialMergeCompactedRuleCount,
      observedRuleCount: mergedLiveAggregate.observedRuleCount,
      liveCanonicalRuleCount: mergedLiveAggregate.liveCanonicalRuleCount,
      finalSelectedRuleCount: mergedRules.length,
    })
    return {
      tokenizerSpec,
      rules: mergedRules,
      matches: finalized.matchRows,
      dedupedMatches: finalized.dedupedMatches,
      coverage: finalized.coverage,
      catalog: finalized.catalog,
      exploredStates: finalizedExploredStates,
      rejectionSummary: mergedRejectionSummary,
      negativeSeparationReport,
      rejectedRules,
      workerImbalanceRatio,
      parallelChunkPlannerImbalanceRatio,
    }
  } catch (error) {
    parallelMainFailure = error
    await terminateActiveChunkRuns({
      activeChunkRuns: Array.from(activeChunkRunsBySlot.values()),
      reason: "parent_exception",
    })
    throw error
  } finally {
    await stopBudgetRequestServiceFastpathLoop({
      suppressFailure: parallelMainFailure != null,
    })
    await shutdownWorkerSlots()
  }
}
