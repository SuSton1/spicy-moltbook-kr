import fsp from "node:fs/promises"
import { parentPort, workerData } from "node:worker_threads"

import { buildCandidateSchema } from "../lib/candidate_schema.mjs"
import { buildScoreOptions, buildScorerContext, scoreCandidateExactV2, scoreCandidateExactV3 } from "../lib/similarity.mjs"

const ensureObject = (value, fallback = {}) =>
  value && typeof value === "object" ? value : fallback

const hashKey = (value) => JSON.stringify(value)

const readJson = async (filePath) => {
  const raw = await fsp.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

const state = {
  ready: false,
  library: null,
  runtimeMeta: null,
  candidateSchema: null,
  contextKey: "",
  scorerContext: null,
  negativeContextKey: "",
  negativeScorerContext: null
}

const resolveRuntimeHybrid = (runtimeMeta) => {
  const runtimeOverrides = ensureObject(workerData?.runtimeOverrides)
  const stageWeights = ensureObject(runtimeOverrides?.stageWeights ?? runtimeMeta?.stageWeights)
  const coarseTopN = Number(runtimeOverrides?.coarseTopN ?? runtimeMeta?.coarseTopN ?? 120)
  const coarseTopClusters = Number(
    runtimeOverrides?.coarseTopClusters ?? runtimeMeta?.coarseTopClusters ?? 6,
  )
  return {
    stageWeights: {
      global: Number(stageWeights?.global ?? 0.35),
      local: Number(stageWeights?.local ?? 0.45),
      trigger: Number(stageWeights?.trigger ?? 0.2)
    },
    coarseTopN: Number.isInteger(coarseTopN) && coarseTopN > 0 ? coarseTopN : 120,
    coarseTopClusters:
      Number.isInteger(coarseTopClusters) && coarseTopClusters > 0 ? coarseTopClusters : 6
  }
}

const init = async () => {
  const libraryPath = String(workerData?.libraryPath ?? "").trim()
  const runtimePath = String(workerData?.runtimePath ?? "").trim()
  if (!libraryPath || !runtimePath) {
    throw new Error("worker init requires libraryPath and runtimePath")
  }
  const library = await readJson(libraryPath)
  const runtimeMeta = await readJson(runtimePath)
  state.library = library
  state.runtimeMeta = runtimeMeta
  state.candidateSchema = buildCandidateSchema({
    runtimeMeta,
    featureStats: library?.featureStats ?? {},
    globalFeatureStats: library?.globalFeatureStats ?? {}
  })
  state.ready = true
}

const resolveContext = ({ weights, activeGroups, scoreOptions }) => {
  const normalizedScoreOptions = buildScoreOptions(scoreOptions)
  const key = hashKey({
    weights,
    activeGroups: Array.isArray(activeGroups) ? activeGroups.slice().sort() : [],
    scoreOptions: normalizedScoreOptions
  })
  if (state.scorerContext && state.contextKey === key) {
    return state.scorerContext
  }
  const runtimeHybrid = resolveRuntimeHybrid(state.runtimeMeta)
  const context = buildScorerContext({
    prototypes: state.library?.prototypes ?? [],
    featureStats: state.library?.featureStats ?? {},
    globalFeatureStats: state.library?.globalFeatureStats ?? {},
    candidateFeatureKeys: state.candidateSchema?.featureKeys ?? null,
    candidateGlobalKeys: state.candidateSchema?.globalFeatureKeys ?? null,
    weights,
    activeGroups,
    scoreOptions: normalizedScoreOptions,
    stageWeights: runtimeHybrid.stageWeights,
    coarseTopN: runtimeHybrid.coarseTopN,
    coarseTopClusters: runtimeHybrid.coarseTopClusters,
    clusterCenters: state.runtimeMeta?.clusterCenters ?? state.library?.globalClusters
  })
  state.contextKey = key
  state.scorerContext = context
  return context
}

const resolveNegativeContext = ({ weights, activeGroups, scoreOptions }) => {
  const normalizedScoreOptions = buildScoreOptions(scoreOptions)
  const key = hashKey({
    weights,
    activeGroups: Array.isArray(activeGroups) ? activeGroups.slice().sort() : [],
    scoreOptions: normalizedScoreOptions,
    negative: true
  })
  if (state.negativeScorerContext && state.negativeContextKey === key) {
    return state.negativeScorerContext
  }
  const negativePrototypes = Array.isArray(state.library?.negativePrototypes)
    ? state.library.negativePrototypes
    : []
  if (negativePrototypes.length < 1) {
    state.negativeContextKey = key
    state.negativeScorerContext = null
    return null
  }
  const runtimeHybrid = resolveRuntimeHybrid(state.runtimeMeta)
  const context = buildScorerContext({
    prototypes: negativePrototypes,
    featureStats: state.library?.featureStats ?? {},
    globalFeatureStats: state.library?.globalFeatureStats ?? {},
    candidateFeatureKeys: state.candidateSchema?.featureKeys ?? null,
    candidateGlobalKeys: state.candidateSchema?.globalFeatureKeys ?? null,
    weights,
    activeGroups,
    scoreOptions: normalizedScoreOptions,
    stageWeights: runtimeHybrid.stageWeights,
    coarseTopN: runtimeHybrid.coarseTopN,
    coarseTopClusters: runtimeHybrid.coarseTopClusters,
    clusterCenters: null
  })
  state.negativeContextKey = key
  state.negativeScorerContext = context
  return context
}

const resolveSimilarityDisambiguation = (raw) => {
  const cfg = raw && typeof raw === "object" ? raw : {}
  return {
    enabled: cfg?.enabled === true,
    negativeBuckets: Array.isArray(cfg?.negativeBuckets)
      ? cfg.negativeBuckets.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
      : []
  }
}

const resolvePackedCandidates = (packed) => {
  const src = packed && typeof packed === "object" ? packed : null
  if (!src) return null
  const rowCountRaw = Number(src.rowCount ?? 0)
  const rowCount = Number.isInteger(rowCountRaw) && rowCountRaw >= 0 ? rowCountRaw : 0
  const featureKeys = Array.isArray(src.featureKeys)
    ? src.featureKeys.map((k) => String(k ?? ""))
    : (state.candidateSchema?.featureKeys ?? [])
  const globalFeatureKeys = Array.isArray(src.globalFeatureKeys)
    ? src.globalFeatureKeys.map((k) => String(k ?? ""))
    : (state.candidateSchema?.globalFeatureKeys ?? [])
  const featureVals = ArrayBuffer.isView(src.featureVals) ? src.featureVals : null
  const globalFeatureVals = ArrayBuffer.isView(src.globalFeatureVals) ? src.globalFeatureVals : null
  const seq40Offsets = ArrayBuffer.isView(src.seq40Offsets) ? src.seq40Offsets : null
  const seq150Offsets = ArrayBuffer.isView(src.seq150Offsets) ? src.seq150Offsets : null
  const seq40Flat = ArrayBuffer.isView(src.seq40Flat) ? src.seq40Flat : null
  const seq150Flat = ArrayBuffer.isView(src.seq150Flat) ? src.seq150Flat : null
  if (!featureVals || !globalFeatureVals || !seq40Offsets || !seq150Offsets || !seq40Flat || !seq150Flat) {
    return null
  }
  const featureWidth = featureKeys.length
  const globalFeatureWidth = globalFeatureKeys.length
  if (
    Number(featureVals.length) < rowCount * featureWidth ||
    Number(globalFeatureVals.length) < rowCount * globalFeatureWidth ||
    Number(seq40Offsets.length) < rowCount + 1 ||
    Number(seq150Offsets.length) < rowCount + 1
  ) {
    return null
  }
  return {
    rowCount,
    featureKeys,
    globalFeatureKeys,
    featureVals,
    globalFeatureVals,
    featureWidth,
    globalFeatureWidth,
    seq40Offsets,
    seq150Offsets,
    seq40Flat,
    seq150Flat
  }
}

const resolvePackedCandidate = (packed, idx) => {
  const featureBase = idx * packed.featureWidth
  const globalBase = idx * packed.globalFeatureWidth
  const seq40Begin = Number(packed.seq40Offsets[idx] ?? 0) || 0
  const seq40End = Number(packed.seq40Offsets[idx + 1] ?? seq40Begin) || seq40Begin
  const seq150Begin = Number(packed.seq150Offsets[idx] ?? 0) || 0
  const seq150End = Number(packed.seq150Offsets[idx + 1] ?? seq150Begin) || seq150Begin
  return {
    _featureVals: packed.featureVals,
    _featureBase: featureBase,
    _globalVals: packed.globalFeatureVals.subarray(
      globalBase,
      Math.max(globalBase, globalBase + packed.globalFeatureWidth),
    ),
    _seq40Nums: packed.seq40Flat.subarray(seq40Begin, Math.max(seq40Begin, seq40End)),
    _seq150Nums: packed.seq150Flat.subarray(seq150Begin, Math.max(seq150Begin, seq150End))
  }
}

const handleTask = ({
  taskId,
  candidatesPacked,
  candidates,
  weights,
  activeGroups,
  scoreOptions,
  similarityDisambiguation
}) => {
  const started = Date.now()
  const packed = resolvePackedCandidates(candidatesPacked)
  const list = packed ? null : (Array.isArray(candidates) ? candidates : [])
  const rowCount = packed ? packed.rowCount : list.length
  const taskWeights = ensureObject(weights)
  const taskActiveGroups = Array.isArray(activeGroups) ? activeGroups : []
  const taskScoreOptions = buildScoreOptions(ensureObject(scoreOptions))
  const taskSimilarityDisambiguation = resolveSimilarityDisambiguation(similarityDisambiguation)
  const prototypes = state.library?.prototypes ?? []
  const negativePrototypes = state.library?.negativePrototypes ?? []
  const featureStats = state.library?.featureStats ?? {}
  const globalFeatureStats = state.library?.globalFeatureStats ?? {}
  const context = resolveContext({
    weights: taskWeights,
    activeGroups: taskActiveGroups,
    scoreOptions: taskScoreOptions
  })
  const negativeContext =
    taskSimilarityDisambiguation.enabled === true
      ? resolveNegativeContext({
        weights: taskWeights,
        activeGroups: taskActiveGroups,
        scoreOptions: taskScoreOptions
      })
      : null
  const rows = new Array(rowCount)
  const perf = {
    totalCandidatesScored: 0,
    totalPrototypes: 0,
    totalPrototypesAfterCoarse: 0,
    coarsePruneRatioSum: 0,
    coarsePruneRatioCount: 0,
    totalPrototypeComparisons: 0,
    prototypesPrunedByGroupBound: 0,
    prototypesPrunedByFeatureBound: 0,
    totalClusters: 0,
    totalClustersConsidered: 0
  }
  for (let i = 0; i < rowCount; i += 1) {
    const candidate = packed
      ? resolvePackedCandidate(packed, i)
      : ensureObject(list[i], {})
    const scored =
      taskSimilarityDisambiguation.enabled === true
        ? scoreCandidateExactV3({
          candidate,
          prototypes,
          negativePrototypes,
          featureStats,
          globalFeatureStats,
          weights: taskWeights,
          activeGroups: taskActiveGroups,
          scoreOptions: taskScoreOptions,
          scorerContext: context,
          negativeScorerContext: negativeContext,
          negativeBuckets: taskSimilarityDisambiguation.negativeBuckets
        })
        : scoreCandidateExactV2({
          candidate,
          prototypes,
          featureStats,
          globalFeatureStats,
          weights: taskWeights,
          activeGroups: taskActiveGroups,
          scoreOptions: taskScoreOptions,
          scorerContext: context
        })
    perf.totalCandidatesScored += 1
    perf.totalPrototypes += Number(scored?.perf?.prototypesTotal ?? 0)
    perf.totalPrototypesAfterCoarse += Number(scored?.perf?.prototypesAfterCoarse ?? 0)
    const coarsePruneRatio = Number(scored?.perf?.coarsePruneRatio)
    if (Number.isFinite(coarsePruneRatio)) {
      perf.coarsePruneRatioSum += coarsePruneRatio
      perf.coarsePruneRatioCount += 1
    }
    perf.totalPrototypeComparisons += Number(scored?.perf?.prototypesScored ?? 0)
    perf.prototypesPrunedByGroupBound += Number(scored?.perf?.prototypesPrunedByGroupBound ?? 0)
    perf.prototypesPrunedByFeatureBound += Number(scored?.perf?.prototypesPrunedByFeatureBound ?? 0)
    perf.totalClusters += Number(scored?.perf?.clustersTotal ?? 0)
    perf.totalClustersConsidered += Number(scored?.perf?.clustersConsidered ?? 0)
    rows[i] = {
      total: scored?.total ?? 0,
      groupScores: scored?.groupScores ?? {},
      stageScores: scored?.stageScores ?? {},
      prototypeId: scored?.prototypeId ?? null,
      prototypeSymbol: scored?.prototypeSymbol ?? null,
      prototypeClusterId: scored?.prototypeClusterId ?? null,
      positiveTop1: scored?.positiveTop1 ?? null,
      positiveTop2: scored?.positiveTop2 ?? null,
      negativeTop1: scored?.negativeTop1 ?? null,
      negativeTop1Stop: scored?.negativeTop1Stop ?? null,
      negativeTop1TimeoutNegative: scored?.negativeTop1TimeoutNegative ?? null,
      negativeTop1LowExecutionQuality: scored?.negativeTop1LowExecutionQuality ?? null,
      top1Top2PositiveGap: Number.isFinite(Number(scored?.top1Top2PositiveGap))
        ? Number(scored.top1Top2PositiveGap)
        : null,
      positiveVsNegativeGap: Number.isFinite(Number(scored?.positiveVsNegativeGap))
        ? Number(scored.positiveVsNegativeGap)
        : null
    }
  }
  return {
    taskId,
    rows,
    perf,
    computeMs: Math.max(0, Date.now() - started)
  }
}

const start = async () => {
  await init()
  parentPort.on("message", (task) => {
    try {
      const result = handleTask(task ?? {})
      parentPort.postMessage(result)
    } catch (error) {
      parentPort.postMessage({
        taskId: task?.taskId ?? null,
        error: error instanceof Error ? `${error.message}` : String(error)
      })
    }
  })
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  parentPort?.postMessage({
    taskId: null,
    error: `worker_init_failed:${message}`
  })
})
