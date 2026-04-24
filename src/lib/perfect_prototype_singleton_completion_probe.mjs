import { safeRate } from "./perfect_prototype_miner.mjs"
import {
  decodePerfectPrototypeDeltaPostingsToBitset,
  openPerfectPrototypePostingsFile,
  readPerfectPrototypePostingBufferFromFile,
  readPerfectPrototypeDeltaPostingsFromFile,
} from "./perfect_prototype_postings_codec.mjs"
import { comparePerfectPrototypeChildCandidates } from "./perfect_prototype_search_ordering.mjs"
import {
  createPerfectPrototypeBitsetRowsetFromWords,
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsets,
  intersectPerfectPrototypeRowsetsCount,
  releasePerfectPrototypeBorrowedRowset,
  shouldPreferDensePerfectPrototypeRowset,
} from "./perfect_prototype_rowset.mjs"

const EMPTY_UINT32 = new Uint32Array()

const computeChunkWidth = (chunk) => {
  const start = Math.max(0, Number(chunk?.start ?? 0))
  const end = Math.max(start, Number(chunk?.end ?? start))
  return Math.max(0, end - start)
}

const isSingletonRootChunk = (chunk) => computeChunkWidth(chunk) === 1

const toPositiveInteger = (value, fallback = 0) => {
  const numeric = Math.floor(Number(value))
  if (Number.isInteger(numeric) && numeric >= 0) return numeric
  return Math.max(0, Math.floor(Number(fallback) || 0))
}

const hasExplicitIntegerValue = (value) => {
  if (value == null) return false
  if (typeof value === "string" && value.trim().length < 1) return false
  return Number.isInteger(Number(value))
}

const getOrCreatePromiseCachedValue = async ({
  cache,
  cacheKey,
  load,
}) => {
  if (!(cache instanceof Map)) {
    return await load()
  }
  const cached = cache.get(cacheKey)
  if (cached) {
    return await cached
  }
  const pending = Promise.resolve().then(load)
  cache.set(cacheKey, pending)
  try {
    const value = await pending
    cache.set(cacheKey, Promise.resolve(value))
    return value
  } catch (error) {
    cache.delete(cacheKey)
    throw error
  }
}

const resolveStage1ProbeConcurrency = ({
  stage1ProbeMaxConcurrency = null,
  workerCount = 2,
  candidateCount = 0,
}) => {
  const safeCandidateCount = Math.max(0, Math.floor(Number(candidateCount) || 0))
  if (safeCandidateCount < 1) return 1
  if (hasExplicitIntegerValue(stage1ProbeMaxConcurrency)) {
    return Math.max(
      1,
      Math.min(safeCandidateCount, Math.floor(Number(stage1ProbeMaxConcurrency))),
    )
  }
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  return Math.max(1, Math.min(safeCandidateCount, Math.max(4, safeWorkerCount * 2)))
}

const readPostingValuesFromSeedEntry = async ({
  postingsHandle,
  entry,
  kind,
}) => {
  const prefix = kind === "negative" ? "negative" : "positive"
  const count = toPositiveInteger(entry?.[`${prefix}Count`])
  const byteLength = toPositiveInteger(entry?.[`${prefix}ByteLength`])
  if (count < 1 || byteLength < 1) {
    return EMPTY_UINT32
  }
  return readPerfectPrototypeDeltaPostingsFromFile({
    fileHandle: postingsHandle,
    offset: Number(entry?.[`${prefix}Offset`] ?? 0),
    byteLength,
    count,
  })
}

const createPlanningPostingValueCache = ({
  postingsHandle,
  seedStats,
  rowUniverseSize = null,
}) => {
  const positiveCache = new Map()
  const negativeCache = new Map()
  const positiveRowsetCache = new Map()
  const negativeRowsetCache = new Map()
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const getPostingValues = async (tokenIndex, kind) => {
    const resolvedTokenIndex = Math.max(0, Math.floor(Number(tokenIndex) || 0))
    const cache = kind === "negative" ? negativeCache : positiveCache
    return getOrCreatePromiseCachedValue({
      cache,
      cacheKey: resolvedTokenIndex,
      load: async () => {
        const entry = safeSeedStats[resolvedTokenIndex]
        if (!entry) {
          throw new Error(`Singleton completion probe requires seed entry at tokenIndex=${resolvedTokenIndex}`)
        }
        return readPostingValuesFromSeedEntry({
          postingsHandle,
          entry,
          kind,
        })
      },
    })
  }
  const getPostingRowset = async (tokenIndex, kind) => {
    const resolvedTokenIndex = Math.max(0, Math.floor(Number(tokenIndex) || 0))
    const rowsetCache = kind === "negative" ? negativeRowsetCache : positiveRowsetCache
    return getOrCreatePromiseCachedValue({
      cache: rowsetCache,
      cacheKey: resolvedTokenIndex,
      load: async () => {
        const entry = safeSeedStats[resolvedTokenIndex]
        if (!entry) {
          throw new Error(`Singleton completion probe requires seed entry at tokenIndex=${resolvedTokenIndex}`)
        }
        const prefix = kind === "negative" ? "negative" : "positive"
        const count = toPositiveInteger(entry?.[`${prefix}Count`])
        const byteLength = toPositiveInteger(entry?.[`${prefix}ByteLength`])
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
              offset: Number(entry?.[`${prefix}Offset`] ?? 0),
              byteLength,
            }),
            count,
            universeSize: rowUniverseSize,
          })
          return createPerfectPrototypeBitsetRowsetFromWords(decoded)
        }
        const values = await getPostingValues(resolvedTokenIndex, kind)
        return createPerfectPrototypeRowset({
          values,
          universeSize:
            Number.isInteger(rowUniverseSize) && rowUniverseSize > 0 ? rowUniverseSize : null,
          allowDense: true,
        })
      },
    })
  }
  return {
    getPositivePostingValues: async (tokenIndex) => getPostingValues(tokenIndex, "positive"),
    getNegativePostingValues: async (tokenIndex) => getPostingValues(tokenIndex, "negative"),
    getPositivePostingRowset: async (tokenIndex) => getPostingRowset(tokenIndex, "positive"),
    getNegativePostingRowset: async (tokenIndex) => getPostingRowset(tokenIndex, "negative"),
  }
}

const resolvePlanningProbeResources = async ({
  tokenPostingsBinPath = null,
  postingsHandle = null,
  postingValueCache = null,
  seedStats,
  rowUniverseSize = null,
}) => {
  const safeRowUniverseSize = Math.max(0, Math.floor(Number(rowUniverseSize) || 0))
  if (safeRowUniverseSize < 1) {
    throw new Error(
      "Singleton completion probe requires a positive rowUniverseSize for the canonical rowset path",
    )
  }
  const ownsPostingsHandle = postingsHandle == null && postingValueCache == null
  const resolvedPostingsHandle =
    postingsHandle ??
    (postingValueCache == null
      ? await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r")
      : null)
  if (resolvedPostingsHandle == null && postingValueCache == null) {
    throw new Error(
      "Singleton completion probe requires tokenPostingsBinPath, postingsHandle, or postingValueCache",
    )
  }
  const basePostingValueCache =
    postingValueCache ??
    createPlanningPostingValueCache({
      postingsHandle: resolvedPostingsHandle,
      seedStats,
      rowUniverseSize: safeRowUniverseSize,
    })
  const positiveRowsetCache = new Map()
  const negativeRowsetCache = new Map()
  const getPostingRowset = async (tokenIndex, kind) => {
    const resolvedTokenIndex = Math.max(0, Math.floor(Number(tokenIndex) || 0))
    const rowsetCache = kind === "negative" ? negativeRowsetCache : positiveRowsetCache
    return getOrCreatePromiseCachedValue({
      cache: rowsetCache,
      cacheKey: resolvedTokenIndex,
      load: async () => {
        const nativeGetter =
          kind === "negative"
            ? basePostingValueCache.getNegativePostingRowset
            : basePostingValueCache.getPositivePostingRowset
        if (typeof nativeGetter === "function") {
          return await nativeGetter(resolvedTokenIndex)
        }
        const values =
          kind === "negative"
            ? await basePostingValueCache.getNegativePostingValues(resolvedTokenIndex)
            : await basePostingValueCache.getPositivePostingValues(resolvedTokenIndex)
        return createPerfectPrototypeRowset({
          values,
          universeSize: safeRowUniverseSize,
          allowDense: true,
        })
      },
    })
  }
  return {
    postingsHandle: resolvedPostingsHandle,
    postingValueCache: {
      ...basePostingValueCache,
      getPositivePostingRowset: async (tokenIndex) => getPostingRowset(tokenIndex, "positive"),
      getNegativePostingRowset: async (tokenIndex) => getPostingRowset(tokenIndex, "negative"),
    },
    ownsPostingsHandle,
  }
}

const buildStage1ProgressPayload = ({
  stage1StartedAt,
  candidateCount,
  completedChunkCount,
  currentChunkIndex,
  currentChunkOrdinal,
  inFlightChunkCount = null,
  pendingChunkCount = null,
  stage1Concurrency = null,
  cumulativeCompletedMetrics,
  currentChunkMetrics = null,
  chunkCompleted = false,
}) => {
  const safeCompletedMetrics = cumulativeCompletedMetrics ?? {}
  const safeCurrentChunkMetrics = currentChunkMetrics ?? {}
  return {
    stage: "stage1",
    elapsedMs: Math.max(0, Date.now() - stage1StartedAt),
    candidateCount: Math.max(0, Number(candidateCount ?? 0)),
    completedChunkCount: Math.max(0, Number(completedChunkCount ?? 0)),
    currentChunkIndex: Number(currentChunkIndex ?? -1),
    currentChunkOrdinal: Math.max(0, Number(currentChunkOrdinal ?? 0)),
    inFlightChunkCount: Math.max(0, Number(inFlightChunkCount ?? 0)),
    pendingChunkCount: Math.max(0, Number(pendingChunkCount ?? 0)),
    stage1Concurrency: Math.max(1, Number(stage1Concurrency ?? 1)),
    chunkCompleted: chunkCompleted === true,
    cumulativeProbeExploredStates:
      Math.max(0, Number(safeCompletedMetrics.probeExploredStates ?? 0)) +
      Math.max(0, Number(safeCurrentChunkMetrics.probeExploredStates ?? 0)),
    cumulativeProbeBranchExpansionCount:
      Math.max(0, Number(safeCompletedMetrics.probeBranchExpansionCount ?? 0)) +
      Math.max(0, Number(safeCurrentChunkMetrics.probeBranchExpansionCount ?? 0)),
    cumulativeProbeNegativeLoads:
      Math.max(0, Number(safeCompletedMetrics.probeNegativeLoads ?? 0)) +
      Math.max(0, Number(safeCurrentChunkMetrics.probeNegativeLoads ?? 0)),
    cumulativeProbeCollectedRuleCount:
      Math.max(0, Number(safeCompletedMetrics.probeCollectedRuleCount ?? 0)) +
      Math.max(0, Number(safeCurrentChunkMetrics.probeCollectedRuleCount ?? 0)),
    cumulativeProbeReachedTerminalCount:
      Math.max(0, Number(safeCompletedMetrics.probeReachedTerminalCount ?? 0)) +
      (safeCurrentChunkMetrics.probeReachedTerminal === true ? 1 : 0),
    cumulativeProbeFoundFirstRuleCount:
      Math.max(0, Number(safeCompletedMetrics.probeFoundFirstRuleCount ?? 0)) +
      (Number.isFinite(Number(safeCurrentChunkMetrics.probeStatesToFirstRule)) ? 1 : 0),
    currentChunkProbeExploredStates: Math.max(
      0,
      Number(safeCurrentChunkMetrics.probeExploredStates ?? 0),
    ),
    currentChunkProbeBranchExpansionCount: Math.max(
      0,
      Number(safeCurrentChunkMetrics.probeBranchExpansionCount ?? 0),
    ),
    currentChunkProbeFrontierRemainingCount: Math.max(
      0,
      Number(safeCurrentChunkMetrics.probeFrontierRemainingCount ?? 0),
    ),
    currentChunkProbeNegativeLoads: Math.max(
      0,
      Number(safeCurrentChunkMetrics.probeNegativeLoads ?? 0),
    ),
    currentChunkProbeCollectedRuleCount: Math.max(
      0,
      Number(safeCurrentChunkMetrics.probeCollectedRuleCount ?? 0),
    ),
    currentChunkProbeReachedTerminal: safeCurrentChunkMetrics.probeReachedTerminal === true,
    currentChunkProbeStatesToFirstRule: Number.isFinite(
      Number(safeCurrentChunkMetrics.probeStatesToFirstRule),
    )
      ? Math.max(1, Number(safeCurrentChunkMetrics.probeStatesToFirstRule))
      : null,
    currentChunkProbeScore: Number.isFinite(Number(safeCurrentChunkMetrics.probeScore))
      ? Number(Number(safeCurrentChunkMetrics.probeScore).toFixed(6))
      : null,
  }
}

const buildSingletonRootExactChildCandidates = async ({
  positiveRowset,
  negativeRowset,
  startAt,
  seedStats,
  minHitCount,
  tokensLength,
  getPositivePostingRowset,
  getNegativePostingRowset,
  metrics,
}) => {
  const currentPositiveCount = getPerfectPrototypeRowsetCount(positiveRowset)
  const currentNegativeCount = getPerfectPrototypeRowsetCount(negativeRowset)
  const currentPrecision = safeRate(
    currentPositiveCount,
    currentPositiveCount + currentNegativeCount,
  )
  const descriptors = []
  for (let tokenIndex = Math.max(0, startAt); tokenIndex < seedStats.length; tokenIndex += 1) {
    const positivePostingRowset = await getPositivePostingRowset(tokenIndex)
    const nextPositiveCount = intersectPerfectPrototypeRowsetsCount(
      positiveRowset,
      positivePostingRowset,
    )
    if (nextPositiveCount < minHitCount) continue
    let exactNextNegativeCount = 0
    if (currentNegativeCount > 0) {
      metrics.probeNegativeLoads += 1
      exactNextNegativeCount = intersectPerfectPrototypeRowsetsCount(
        negativeRowset,
        await getNegativePostingRowset(tokenIndex),
      )
    }
    if (
      nextPositiveCount === currentPositiveCount &&
      exactNextNegativeCount === currentNegativeCount
    ) {
      continue
    }
    if (tokensLength > 0 && currentNegativeCount > 0 && exactNextNegativeCount >= currentNegativeCount) {
      continue
    }
    const nextPrecision = safeRate(
      nextPositiveCount,
      nextPositiveCount + exactNextNegativeCount,
    )
    if (tokensLength > 0 && nextPrecision < currentPrecision) {
      continue
    }
    descriptors.push({
      tokenIndex,
      nextPositiveCount,
      exactNextNegativeCount,
      negativeDrop: Math.max(0, currentNegativeCount - exactNextNegativeCount),
      precisionUpperBound: nextPrecision,
      positiveLoss: Math.max(0, currentPositiveCount - nextPositiveCount),
      positiveCount: nextPositiveCount,
    })
  }
  return descriptors.sort(comparePerfectPrototypeChildCandidates)
}

const computeSingletonRootExactCompletionScore = (probe) => {
  const exploredStates = Math.max(1, Number(probe?.probeExploredStates ?? 0))
  const branchExpansionCount = Math.max(0, Number(probe?.probeBranchExpansionCount ?? 0))
  const frontierRemainingCount = Math.max(0, Number(probe?.probeFrontierRemainingCount ?? 0))
  const negativeLoads = Math.max(0, Number(probe?.probeNegativeLoads ?? 0))
  const collectedRuleCount = Math.max(0, Number(probe?.probeCollectedRuleCount ?? 0))
  const terminalLeafCount = Math.max(0, Number(probe?.probeTerminalLeafCount ?? 0))
  const statesToFirstRule =
    Number.isFinite(Number(probe?.probeStatesToFirstRule))
      ? Math.max(1, Number(probe?.probeStatesToFirstRule))
      : null
  const reachedTerminal = probe?.probeReachedTerminal === true
  const terminalBonus = reachedTerminal ? 2.5 : 1
  const firstRuleBonus =
    statesToFirstRule == null ? 1 : 1 + 1 / Math.max(1, Math.log2(statesToFirstRule + 2))
  const ruleBonus = 1 + Math.min(4, collectedRuleCount) / 10
  const terminalLeafBonus = 1 + Math.min(4, terminalLeafCount) / 16
  const statePenalty = 1 + Math.log2(exploredStates + 2) / 2.2
  const branchPenalty = 1 + Math.log2(branchExpansionCount + 2) / 2.1
  const frontierPenalty = 1 + Math.log2(frontierRemainingCount + 2) / 1.9
  const negativePenalty = 1 + Math.log2(negativeLoads + 2) / 3.2
  return Number(
    (
      (terminalBonus * firstRuleBonus * ruleBonus * terminalLeafBonus) /
      (statePenalty * branchPenalty * frontierPenalty * negativePenalty)
    ).toFixed(6),
  )
}

const compareSingletonProbeCandidates = (left, right) => {
  const leftScore = Math.max(0, Number(left?.probe?.probeScore ?? 0))
  const rightScore = Math.max(0, Number(right?.probe?.probeScore ?? 0))
  if (rightScore !== leftScore) return rightScore - leftScore
  return Number(left?.chunk?.chunkIndex ?? 0) - Number(right?.chunk?.chunkIndex ?? 0)
}

const buildProbeSummary = ({ probesByChunkIndex, probeStateCaps = [] }) => {
  const safeMap = probesByChunkIndex instanceof Map ? probesByChunkIndex : new Map()
  const probeScores = Array.from(safeMap.values())
    .map((probe) => Number(probe?.probeScore ?? Number.NaN))
    .filter((value) => Number.isFinite(value))
  const normalizedStateCaps = Array.isArray(probeStateCaps)
    ? probeStateCaps.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    : []
  return {
    probeCount: safeMap.size,
    probeReachedTerminalCount: Array.from(safeMap.values()).filter(
      (probe) => probe?.probeReachedTerminal === true,
    ).length,
    probeFoundFirstRuleCount: Array.from(safeMap.values()).filter((probe) =>
      Number.isFinite(Number(probe?.probeStatesToFirstRule)),
    ).length,
    probeStateCapMin:
      normalizedStateCaps.length > 0
        ? Math.min(...normalizedStateCaps.map((value) => Math.floor(Number(value))))
        : null,
    probeStateCapMax:
      normalizedStateCaps.length > 0
        ? Math.max(...normalizedStateCaps.map((value) => Math.floor(Number(value))))
        : null,
    probeScoreMin:
      probeScores.length > 0 ? Number(Math.min(...probeScores).toFixed(6)) : null,
    probeScoreMax:
      probeScores.length > 0 ? Number(Math.max(...probeScores).toFixed(6)) : null,
  }
}

const resolveAdaptiveExactCompletionProbeStateCap = ({
  probe,
  baseStateCap = 96,
  maxStateCap = 384,
}) => {
  const stage1Cap = Math.max(1, Math.floor(Number(probe?.probeStateCap) || 1))
  const safeBaseStateCap = Math.max(stage1Cap, Math.floor(Number(baseStateCap) || 96))
  const safeMaxStateCap = Math.max(safeBaseStateCap, Math.floor(Number(maxStateCap) || 384))
  const frontierRemainingCount = Math.max(0, Number(probe?.probeFrontierRemainingCount ?? 0))
  const branchExpansionCount = Math.max(0, Number(probe?.probeBranchExpansionCount ?? 0))
  const collectedRuleCount = Math.max(0, Number(probe?.probeCollectedRuleCount ?? 0))
  const reachedTerminal = probe?.probeReachedTerminal === true
  const base = Math.max(safeBaseStateCap, stage1Cap * 4)
  const frontierExpansion = Math.min(128, frontierRemainingCount * 4)
  const branchExpansion = Math.min(
    96,
    Math.floor(Math.log2(branchExpansionCount + 2) * 20),
  )
  const terminalExpansion = reachedTerminal ? 0 : 64
  const ruleExpansion = collectedRuleCount > 0 ? 0 : 64
  return Math.min(
    safeMaxStateCap,
    base + frontierExpansion + branchExpansion + terminalExpansion + ruleExpansion,
  )
}

const selectAdaptiveExactCompletionProbeFinalists = ({
  boundSingletonChunks,
  stage1ProbesByChunkIndex,
  workerCount = 2,
  minimumFinalistCount = null,
  maximumFinalistCount = null,
  scoreBandRatio = 0.85,
}) => {
  const safeChunks = Array.isArray(boundSingletonChunks) ? boundSingletonChunks : []
  if (safeChunks.length < 1) {
    return {
      finalistChunks: [],
      finalistChunkIndexes: new Set(),
    }
  }
  const safeWorkerCount = Math.max(1, Math.floor(Number(workerCount) || 1))
  const resolvedMinimumFinalistCount = Math.max(
    1,
    Math.min(
      safeChunks.length,
      hasExplicitIntegerValue(minimumFinalistCount)
        ? Number(minimumFinalistCount)
        : Math.max(safeWorkerCount * 3, 6),
    ),
  )
  const resolvedMaximumFinalistCount = Math.max(
    resolvedMinimumFinalistCount,
    Math.min(
      safeChunks.length,
      hasExplicitIntegerValue(maximumFinalistCount)
        ? Number(maximumFinalistCount)
        : Math.max(safeWorkerCount * 5, 10),
    ),
  )
  const scoredCandidates = safeChunks
    .map((chunk) => ({
      chunk,
      probe:
        stage1ProbesByChunkIndex instanceof Map
          ? stage1ProbesByChunkIndex.get(Number(chunk?.chunkIndex ?? -1)) ?? null
          : null,
    }))
    .sort(compareSingletonProbeCandidates)
  const maxScore = Math.max(0, Number(scoredCandidates[0]?.probe?.probeScore ?? 0))
  const finalistChunks = []
  const finalistChunkIndexes = new Set()
  for (const candidate of scoredCandidates) {
    const candidateChunkIndex = Number(candidate?.chunk?.chunkIndex ?? -1)
    const candidateScore = Math.max(0, Number(candidate?.probe?.probeScore ?? 0))
    const insideScoreBand =
      finalistChunks.length < resolvedMinimumFinalistCount ||
      finalistChunks.length < resolvedMaximumFinalistCount &&
        candidateScore >= maxScore * Math.max(0, Math.min(1, Number(scoreBandRatio) || 0))
    if (!insideScoreBand) continue
    finalistChunks.push(candidate.chunk)
    finalistChunkIndexes.add(candidateChunkIndex)
  }
  if (finalistChunks.length < resolvedMinimumFinalistCount) {
    for (const candidate of scoredCandidates) {
      const candidateChunkIndex = Number(candidate?.chunk?.chunkIndex ?? -1)
      if (finalistChunkIndexes.has(candidateChunkIndex)) continue
      finalistChunks.push(candidate.chunk)
      finalistChunkIndexes.add(candidateChunkIndex)
      if (finalistChunks.length >= resolvedMinimumFinalistCount) break
    }
  }
  return {
    finalistChunks,
    finalistChunkIndexes,
  }
}

export const probePerfectPrototypeSingletonRootExactCompletion = async ({
  chunk,
  seedStats,
  postingsHandle,
  rowUniverseSize,
  minHitCount,
  maxRuleSize,
  probeStateCap = 24,
  postingValueCache = null,
  onProgress = null,
  progressIntervalMs = 250,
}) => {
  if (!isSingletonRootChunk(chunk)) {
    throw new Error("Singleton completion probe requires singleton-root chunk input")
  }
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const safeMinHitCount = Math.max(1, Math.floor(Number(minHitCount) || 1))
  const safeMaxRuleSize = Math.max(1, Math.floor(Number(maxRuleSize) || 1))
  const safeProbeStateCap = Math.max(1, Math.floor(Number(probeStateCap) || 1))
  const safeRowUniverseSize = Math.max(0, Math.floor(Number(rowUniverseSize) || 0))
  if (safeRowUniverseSize < 1) {
    throw new Error(
      "Singleton completion probe requires a positive rowUniverseSize on the canonical rowset path",
    )
  }
  const rootTokenIndex = Math.max(0, Math.floor(Number(chunk?.start ?? 0) || 0))
  const rootEntry = safeSeedStats[rootTokenIndex]
  if (!rootEntry) {
    throw new Error(`Singleton completion probe requires seed entry for rootTokenIndex=${rootTokenIndex}`)
  }
  const cache =
    postingValueCache ??
    createPlanningPostingValueCache({
      postingsHandle,
      seedStats: safeSeedStats,
      rowUniverseSize: safeRowUniverseSize,
    })
  const rootPositiveRowset = await cache.getPositivePostingRowset(rootTokenIndex)
  const rootNegativeRowset = await cache.getNegativePostingRowset(rootTokenIndex)
  const rootPositiveCount = getPerfectPrototypeRowsetCount(rootPositiveRowset)
  const rootNegativeCount = getPerfectPrototypeRowsetCount(rootNegativeRowset)
  const metrics = {
    probeRootTokenIndex: rootTokenIndex,
    probeRootPositiveCount: rootPositiveCount,
    probeRootNegativeCount: rootNegativeCount,
    probeExploredStates: 0,
    probeReachedTerminal: true,
    probeCollectedRuleCount: 0,
    probeNegativeLoads: 0,
    probeBranchExpansionCount: 0,
    probeFrontierRemainingCount: 0,
    probeStatesToFirstRule: null,
    probeTerminalLeafCount: 0,
    probeStateCap: safeProbeStateCap,
  }
  const probeStartedAt = Date.now()
  const safeProgressIntervalMs = Math.max(1, Math.floor(Number(progressIntervalMs) || 250))
  let lastProgressReportedAt = 0
  const reportProgress = async ({ force = false } = {}) => {
    if (typeof onProgress !== "function") return
    const now = Date.now()
    if (!force && now - lastProgressReportedAt < safeProgressIntervalMs) return
    lastProgressReportedAt = now
    await onProgress({
      ...metrics,
      probeElapsedMs: Math.max(0, now - probeStartedAt),
      probeScore: computeSingletonRootExactCompletionScore(metrics),
      probeFinal: force === true,
    })
  }
  if (rootPositiveCount < safeMinHitCount) {
    await reportProgress({ force: true })
    return {
      ...metrics,
      probeScore: computeSingletonRootExactCompletionScore(metrics),
    }
  }
  metrics.probeExploredStates = 1
  if (rootNegativeCount === 0) {
    metrics.probeCollectedRuleCount = 1
    metrics.probeStatesToFirstRule = 1
    metrics.probeTerminalLeafCount = 1
    await reportProgress({ force: true })
    return {
      ...metrics,
      probeScore: computeSingletonRootExactCompletionScore(metrics),
    }
  }
  if (safeMaxRuleSize <= 1) {
    metrics.probeTerminalLeafCount = 1
    await reportProgress({ force: true })
    return {
      ...metrics,
      probeScore: computeSingletonRootExactCompletionScore(metrics),
    }
  }
  let capHit = false
  const probeState = async ({
    tokensLength,
    startAt,
    positiveRowset,
    negativeRowset,
  }) => {
    if (capHit) return
    const orderedCandidates = await buildSingletonRootExactChildCandidates({
      positiveRowset,
      negativeRowset,
      startAt,
      seedStats: safeSeedStats,
      minHitCount: safeMinHitCount,
      tokensLength,
      getPositivePostingRowset: cache.getPositivePostingRowset,
      getNegativePostingRowset: cache.getNegativePostingRowset,
      metrics,
    })
    if (orderedCandidates.length < 1) {
      metrics.probeTerminalLeafCount += 1
      return
    }
    for (let index = 0; index < orderedCandidates.length; index += 1) {
      if (metrics.probeExploredStates >= safeProbeStateCap) {
        capHit = true
        metrics.probeFrontierRemainingCount += orderedCandidates.length - index
        return
      }
      const candidate = orderedCandidates[index]
      metrics.probeExploredStates += 1
      metrics.probeBranchExpansionCount += 1
      await reportProgress()
      if (candidate.exactNextNegativeCount === 0) {
        metrics.probeCollectedRuleCount += 1
        if (!Number.isFinite(metrics.probeStatesToFirstRule)) {
          metrics.probeStatesToFirstRule = metrics.probeExploredStates
        }
        await reportProgress()
        continue
      }
      if (tokensLength + 1 >= safeMaxRuleSize) {
        metrics.probeTerminalLeafCount += 1
        await reportProgress()
        continue
      }
      const positivePostingRowset = await cache.getPositivePostingRowset(candidate.tokenIndex)
      const nextPositiveRowset = intersectPerfectPrototypeRowsets({
        leftRowset: positiveRowset,
        rightRowset: positivePostingRowset,
        countHint: candidate.nextPositiveCount,
        universeSize: safeRowUniverseSize,
        allowDense: true,
        resultOwnership: "borrowed",
      })
      let nextNegativeRowset = null
      try {
        if (candidate.exactNextNegativeCount > 0) {
          metrics.probeNegativeLoads += 1
          nextNegativeRowset = intersectPerfectPrototypeRowsets({
            leftRowset: negativeRowset,
            rightRowset: await cache.getNegativePostingRowset(candidate.tokenIndex),
            countHint: candidate.exactNextNegativeCount,
            universeSize: safeRowUniverseSize,
            allowDense: true,
            resultOwnership: "borrowed",
          })
        }
        await probeState({
          tokensLength: tokensLength + 1,
          startAt: candidate.tokenIndex + 1,
          positiveRowset: nextPositiveRowset,
          negativeRowset: nextNegativeRowset,
        })
        if (capHit) return
      } finally {
        releasePerfectPrototypeBorrowedRowset(nextPositiveRowset)
        if (nextNegativeRowset) {
          releasePerfectPrototypeBorrowedRowset(nextNegativeRowset)
        }
      }
    }
  }
  await probeState({
    tokensLength: 1,
    startAt: rootTokenIndex + 1,
    positiveRowset: rootPositiveRowset,
    negativeRowset: rootNegativeRowset,
  })
  metrics.probeReachedTerminal = capHit !== true
  await reportProgress({ force: true })
  return {
    ...metrics,
    probeScore: computeSingletonRootExactCompletionScore(metrics),
  }
}

const loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndexWithHandle = async ({
  boundSingletonChunks,
  seedStats,
  postingsHandle,
  rowUniverseSize,
  minHitCount,
  maxRuleSize,
  probeStateCap = 24,
  postingValueCache = null,
  onStage1Progress = null,
  stage1ProbeMaxConcurrency = null,
  workerCount = 2,
}) => {
  const safeChunks = Array.isArray(boundSingletonChunks) ? boundSingletonChunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  if (safeChunks.length < 1) {
    return {
      probesByChunkIndex: new Map(),
      probeCandidateCount: 0,
      probeCount: 0,
      probeReachedTerminalCount: 0,
      probeFoundFirstRuleCount: 0,
      probeStateCapMin: null,
      probeStateCapMax: null,
      probeScoreMin: null,
      probeScoreMax: null,
    }
  }
  const cache =
    postingValueCache ??
    createPlanningPostingValueCache({
      postingsHandle,
      seedStats: safeSeedStats,
      rowUniverseSize,
    })
  const probesByChunkIndex = new Map()
  const probeStateCaps = []
  const stage1StartedAt = Date.now()
  const stage1Concurrency = resolveStage1ProbeConcurrency({
    stage1ProbeMaxConcurrency,
    workerCount,
    candidateCount: safeChunks.length,
  })
  const cumulativeCompletedMetrics = {
    probeExploredStates: 0,
    probeBranchExpansionCount: 0,
    probeNegativeLoads: 0,
    probeCollectedRuleCount: 0,
    probeReachedTerminalCount: 0,
    probeFoundFirstRuleCount: 0,
  }
  let nextChunkOrdinal = 0
  let completedChunkCount = 0
  let inFlightChunkCount = 0
  const runStage1ProbeWorker = async () => {
    while (true) {
      const chunkOrdinal = nextChunkOrdinal
      nextChunkOrdinal += 1
      if (chunkOrdinal >= safeChunks.length) return
      const chunk = safeChunks[chunkOrdinal]
      const resolvedProbeStateCap = Math.max(1, Math.floor(Number(probeStateCap) || 1))
      const currentChunkIndex = Number(chunk?.chunkIndex ?? -1)
      inFlightChunkCount += 1
      try {
        const probe = await probePerfectPrototypeSingletonRootExactCompletion({
          chunk,
          seedStats: safeSeedStats,
          postingsHandle,
          rowUniverseSize,
          minHitCount,
          maxRuleSize,
          probeStateCap: resolvedProbeStateCap,
          postingValueCache: cache,
          onProgress:
            typeof onStage1Progress === "function"
              ? async (currentChunkMetrics) => {
                  await onStage1Progress(
                    buildStage1ProgressPayload({
                      stage1StartedAt,
                      candidateCount: safeChunks.length,
                      completedChunkCount,
                      currentChunkIndex,
                      currentChunkOrdinal: chunkOrdinal + 1,
                      inFlightChunkCount,
                      pendingChunkCount: Math.max(
                        0,
                        safeChunks.length - completedChunkCount - inFlightChunkCount,
                      ),
                      stage1Concurrency,
                      cumulativeCompletedMetrics,
                      currentChunkMetrics,
                    }),
                  )
                }
              : null,
        })
        probesByChunkIndex.set(currentChunkIndex, probe)
        cumulativeCompletedMetrics.probeExploredStates += Math.max(
          0,
          Number(probe?.probeExploredStates ?? 0),
        )
        cumulativeCompletedMetrics.probeBranchExpansionCount += Math.max(
          0,
          Number(probe?.probeBranchExpansionCount ?? 0),
        )
        cumulativeCompletedMetrics.probeNegativeLoads += Math.max(
          0,
          Number(probe?.probeNegativeLoads ?? 0),
        )
        cumulativeCompletedMetrics.probeCollectedRuleCount += Math.max(
          0,
          Number(probe?.probeCollectedRuleCount ?? 0),
        )
        cumulativeCompletedMetrics.probeReachedTerminalCount += probe?.probeReachedTerminal === true ? 1 : 0
        cumulativeCompletedMetrics.probeFoundFirstRuleCount += Number.isFinite(
          Number(probe?.probeStatesToFirstRule),
        )
          ? 1
          : 0
        completedChunkCount += 1
        probeStateCaps.push(resolvedProbeStateCap)
        if (typeof onStage1Progress === "function") {
          const postCompletionInFlightChunkCount = Math.max(0, inFlightChunkCount - 1)
          await onStage1Progress(
            buildStage1ProgressPayload({
              stage1StartedAt,
              candidateCount: safeChunks.length,
              completedChunkCount,
              currentChunkIndex,
              currentChunkOrdinal: chunkOrdinal + 1,
              inFlightChunkCount: postCompletionInFlightChunkCount,
              pendingChunkCount: Math.max(
                0,
                safeChunks.length - completedChunkCount - postCompletionInFlightChunkCount,
              ),
              stage1Concurrency,
              cumulativeCompletedMetrics,
              currentChunkMetrics: null,
              chunkCompleted: true,
            }),
          )
        }
      } finally {
        inFlightChunkCount = Math.max(0, inFlightChunkCount - 1)
      }
    }
  }
  await Promise.all(
    Array.from({ length: stage1Concurrency }, () => runStage1ProbeWorker()),
  )
  const summary = buildProbeSummary({
    probesByChunkIndex,
    probeStateCaps,
  })
  return {
    probesByChunkIndex,
    probeCandidateCount: safeChunks.length,
    probeCount: summary.probeCount,
    probeReachedTerminalCount: summary.probeReachedTerminalCount,
    probeFoundFirstRuleCount: summary.probeFoundFirstRuleCount,
    probeStateCapMin: summary.probeStateCapMin,
    probeStateCapMax: summary.probeStateCapMax,
    probeScoreMin: summary.probeScoreMin,
    probeScoreMax: summary.probeScoreMax,
  }
}

export const loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndex = async ({
  chunks,
  seedStats,
  tokenPostingsBinPath,
  rowUniverseSize,
  minHitCount,
  maxRuleSize,
  probeStateCap = 24,
  workerCount = 2,
  stage1ProbeMaxConcurrency = null,
  postingsHandle = null,
  postingValueCache = null,
  onStage1Progress = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const boundSingletonChunks = safeChunks
    .filter((chunk) => chunk?.firstWaveCompletionTarget === true)
    .filter((chunk) => isSingletonRootChunk(chunk))
    .sort((left, right) => Number(left?.chunkIndex ?? 0) - Number(right?.chunkIndex ?? 0))
  if (boundSingletonChunks.length < 1) {
    return {
      probesByChunkIndex: new Map(),
      probeCandidateCount: 0,
      probeCount: 0,
      probeReachedTerminalCount: 0,
      probeStateCap: Math.max(1, Math.floor(Number(probeStateCap) || 1)),
      probeScoreMin: null,
      probeScoreMax: null,
    }
  }
  const planningResources = await resolvePlanningProbeResources({
    tokenPostingsBinPath,
    postingsHandle,
    postingValueCache,
    seedStats: safeSeedStats,
    rowUniverseSize,
  })
  try {
    const summary = await loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndexWithHandle({
      boundSingletonChunks,
      seedStats: safeSeedStats,
      postingsHandle: planningResources.postingsHandle,
      rowUniverseSize,
      minHitCount,
      maxRuleSize,
      probeStateCap,
      workerCount,
      stage1ProbeMaxConcurrency,
      postingValueCache: planningResources.postingValueCache,
      onStage1Progress,
    })
    return {
      ...summary,
      probeStateCap: Math.max(1, Math.floor(Number(probeStateCap) || 1)),
    }
  } finally {
    if (planningResources.ownsPostingsHandle) {
      await planningResources.postingsHandle.close()
    }
  }
}

export const loadPerfectPrototypeSingletonRootAdaptiveExactCompletionProbesByChunkIndex = async ({
  chunks,
  seedStats,
  tokenPostingsBinPath,
  rowUniverseSize,
  minHitCount,
  maxRuleSize,
  workerCount = 2,
  probeStateCap = 24,
  adaptiveProbeBaseStateCap = 96,
  adaptiveProbeMaxStateCap = 384,
  adaptiveProbeMinimumFinalistCount = null,
  adaptiveProbeMaximumFinalistCount = null,
  onStageTransition = null,
  onStage1Progress = null,
  stage1ProbeMaxConcurrency = null,
  postingsHandle = null,
  postingValueCache = null,
}) => {
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const safeSeedStats = Array.isArray(seedStats) ? seedStats : []
  const boundSingletonChunks = safeChunks
    .filter((chunk) => chunk?.firstWaveCompletionTarget === true)
    .filter((chunk) => isSingletonRootChunk(chunk))
    .sort((left, right) => Number(left?.chunkIndex ?? 0) - Number(right?.chunkIndex ?? 0))
  if (boundSingletonChunks.length < 1) {
    return {
      stage1ProbesByChunkIndex: new Map(),
      adaptiveProbesByChunkIndex: new Map(),
      adaptiveFinalistChunkIndexes: new Set(),
      probeCandidateCount: 0,
      probeCount: 0,
      probeReachedTerminalCount: 0,
      probeFoundFirstRuleCount: 0,
      probeStateCapMin: null,
      probeStateCapMax: null,
      probeScoreMin: null,
      probeScoreMax: null,
      adaptiveProbeFinalistCount: 0,
      adaptiveProbeCount: 0,
      adaptiveProbeReachedTerminalCount: 0,
      adaptiveProbeFoundFirstRuleCount: 0,
      adaptiveProbeStateCapMin: null,
      adaptiveProbeStateCapMax: null,
      adaptiveProbeScoreMin: null,
      adaptiveProbeScoreMax: null,
      stage1Ms: 0,
      adaptiveStageMs: 0,
    }
  }
  const planningResources = await resolvePlanningProbeResources({
    tokenPostingsBinPath,
    postingsHandle,
    postingValueCache,
    seedStats: safeSeedStats,
    rowUniverseSize,
  })
  try {
    const stage1StartedAt = Date.now()
    const stage1Summary = await loadPerfectPrototypeSingletonRootExactCompletionProbesByChunkIndexWithHandle({
      boundSingletonChunks,
      seedStats: safeSeedStats,
      postingsHandle: planningResources.postingsHandle,
      rowUniverseSize,
      minHitCount,
      maxRuleSize,
      probeStateCap,
      workerCount,
      stage1ProbeMaxConcurrency,
      postingValueCache: planningResources.postingValueCache,
      onStage1Progress,
    })
    const { finalistChunks, finalistChunkIndexes } = selectAdaptiveExactCompletionProbeFinalists({
      boundSingletonChunks,
      stage1ProbesByChunkIndex: stage1Summary.probesByChunkIndex,
      workerCount,
      minimumFinalistCount: adaptiveProbeMinimumFinalistCount,
      maximumFinalistCount: adaptiveProbeMaximumFinalistCount,
    })
    const stage1Ms = Math.max(0, Date.now() - stage1StartedAt)
    if (typeof onStageTransition === "function") {
      await onStageTransition({
        stage: "adaptive",
        stage1Ms,
        finalistCount: finalistChunks.length,
      })
    }
    const adaptiveProbesByChunkIndex = new Map()
    const adaptiveProbeStateCaps = []
    const adaptiveStartedAt = Date.now()
    for (const chunk of finalistChunks) {
      const stage1Probe = stage1Summary.probesByChunkIndex.get(Number(chunk?.chunkIndex ?? -1))
      if (!stage1Probe) {
        throw new Error(
          `Adaptive singleton completion probe requires stage1 probe for chunkIndex=${Number(chunk?.chunkIndex ?? -1)}`,
        )
      }
      const resolvedAdaptiveProbeStateCap = resolveAdaptiveExactCompletionProbeStateCap({
        probe: stage1Probe,
        baseStateCap: adaptiveProbeBaseStateCap,
        maxStateCap: adaptiveProbeMaxStateCap,
      })
      adaptiveProbesByChunkIndex.set(
        Number(chunk?.chunkIndex ?? -1),
        await probePerfectPrototypeSingletonRootExactCompletion({
          chunk,
          seedStats: safeSeedStats,
          postingsHandle: planningResources.postingsHandle,
          rowUniverseSize,
          minHitCount,
          maxRuleSize,
          probeStateCap: resolvedAdaptiveProbeStateCap,
          postingValueCache: planningResources.postingValueCache,
        }),
      )
      adaptiveProbeStateCaps.push(resolvedAdaptiveProbeStateCap)
    }
    const adaptiveStageMs = Math.max(0, Date.now() - adaptiveStartedAt)
    const adaptiveSummary = buildProbeSummary({
      probesByChunkIndex: adaptiveProbesByChunkIndex,
      probeStateCaps: adaptiveProbeStateCaps,
    })
    return {
      stage1ProbesByChunkIndex: stage1Summary.probesByChunkIndex,
      adaptiveProbesByChunkIndex,
      adaptiveFinalistChunkIndexes: finalistChunkIndexes,
      probeCandidateCount: stage1Summary.probeCandidateCount,
      probeCount: stage1Summary.probeCount,
      probeReachedTerminalCount: stage1Summary.probeReachedTerminalCount,
      probeFoundFirstRuleCount: stage1Summary.probeFoundFirstRuleCount,
      probeStateCap: Math.max(1, Math.floor(Number(probeStateCap) || 1)),
      probeStateCapMin: stage1Summary.probeStateCapMin,
      probeStateCapMax: stage1Summary.probeStateCapMax,
      probeScoreMin: stage1Summary.probeScoreMin,
      probeScoreMax: stage1Summary.probeScoreMax,
      adaptiveProbeFinalistCount: finalistChunks.length,
      adaptiveProbeCount: adaptiveSummary.probeCount,
      adaptiveProbeReachedTerminalCount: adaptiveSummary.probeReachedTerminalCount,
      adaptiveProbeFoundFirstRuleCount: adaptiveSummary.probeFoundFirstRuleCount,
      adaptiveProbeStateCapMin: adaptiveSummary.probeStateCapMin,
      adaptiveProbeStateCapMax: adaptiveSummary.probeStateCapMax,
      adaptiveProbeScoreMin: adaptiveSummary.probeScoreMin,
      adaptiveProbeScoreMax: adaptiveSummary.probeScoreMax,
      stage1Ms,
      adaptiveStageMs,
    }
  } finally {
    if (planningResources.ownsPostingsHandle) {
      await planningResources.postingsHandle.close()
    }
  }
}
