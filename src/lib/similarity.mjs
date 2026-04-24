const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const GROUPS = [
  "trend",
  "candle",
  "volume",
  "shape",
  "gap"
]

const groupOf = (featureKey) => String(featureKey ?? "").split(".")[0]

const cosine = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return null
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i += 1) {
    const x = num(a[i]) ?? 0
    const y = num(b[i]) ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (!na || !nb) return null
  return (dot / (Math.sqrt(na) * Math.sqrt(nb)) + 1) / 2
}

const valueSimilarity = (x, y, std) => {
  const a = num(x)
  const b = num(y)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const s = Number.isFinite(std) && std > 0 ? std : Math.max(1e-6, Math.abs(b) * 0.1)
  const z = Math.abs((a - b) / s)
  return 1 / (1 + z)
}

const valueSimilarityByNumbers = (a, b, std) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const s = Number.isFinite(std) && std > 0 ? std : Math.max(1e-6, Math.abs(b) * 0.1)
  const z = Math.abs((a - b) / s)
  return 1 / (1 + z)
}

const normalizeWeights = (weights) => {
  const out = {}
  let sum = 0
  for (const g of GROUPS) {
    const w = Number(weights?.[g] ?? 0)
    const safe = Number.isFinite(w) && w > 0 ? w : 0
    out[g] = safe
    sum += safe
  }
  if (!sum) {
    const equal = 1 / GROUPS.length
    for (const g of GROUPS) out[g] = equal
    return out
  }
  for (const g of GROUPS) out[g] /= sum
  return out
}

const normalizeStageWeights = (raw) => {
  const out = {
    global: Number(raw?.global ?? 0.35),
    local: Number(raw?.local ?? 0.45),
    trigger: Number(raw?.trigger ?? 0.2)
  }
  for (const key of Object.keys(out)) {
    if (!Number.isFinite(out[key]) || out[key] < 0) out[key] = 0
  }
  const sum = out.global + out.local + out.trigger
  if (sum <= 0) return { global: 0.35, local: 0.45, trigger: 0.2 }
  return {
    global: out.global / sum,
    local: out.local / sum,
    trigger: out.trigger / sum
  }
}

const average = (list) => {
  if (!Array.isArray(list) || !list.length) return null
  let sum = 0
  let count = 0
  for (const value of list) {
    const n = num(value)
    if (!Number.isFinite(n)) continue
    sum += n
    count += 1
  }
  if (!count) return null
  return sum / count
}

const resolvePrototypeKeys = (prototype, pFeatures) => {
  const cached = prototype?._featureKeys
  if (Array.isArray(cached)) return cached
  const keys = Object.keys(pFeatures ?? {})
  if (prototype && typeof prototype === "object") {
    prototype._featureKeys = keys
  }
  return keys
}

const resolveGroupKeyMap = (prototype, pFeatures) => {
  const cached = prototype?._groupFeatureKeys
  if (cached && typeof cached === "object") return cached
  const out = Object.fromEntries(GROUPS.map((g) => [g, []]))
  for (const key of resolvePrototypeKeys(prototype, pFeatures)) {
    const g = groupOf(key)
    if (!Object.prototype.hasOwnProperty.call(out, g)) continue
    out[g].push(key)
  }
  if (prototype && typeof prototype === "object") {
    prototype._groupFeatureKeys = out
  }
  return out
}

const resolveGroupCompiled = (prototype, pFeatures, featureStats) => {
  const cached = prototype?._groupCompiled
  if (cached && typeof cached === "object") return cached
  const groupKeys = resolveGroupKeyMap(prototype, pFeatures)
  const out = Object.fromEntries(GROUPS.map((g) => [g, null]))
  for (const g of GROUPS) {
    const keys = groupKeys[g] ?? []
    if (!keys.length) continue
    const pVals = new Float64Array(keys.length)
    const stdVals = new Float64Array(keys.length)
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      const p = num(pFeatures?.[key])
      const s = num(featureStats?.[key]?.stdev)
      pVals[i] = Number.isFinite(p) ? p : Number.NaN
      stdVals[i] = Number.isFinite(s) ? s : Number.NaN
    }
    out[g] = { keys, pVals, stdVals }
  }
  if (prototype && typeof prototype === "object") {
    prototype._groupCompiled = out
  }
  return out
}

const resolveSeqCache = (holder, seqLike, key = "seq") => {
  const numsKey = `_${key}Nums`
  const suffixSqKey = `_${key}SuffixSq`
  if (holder && typeof holder === "object") {
    const hasNums = Array.isArray(holder[numsKey]) || ArrayBuffer.isView(holder[numsKey])
    const hasSuffix = Array.isArray(holder[suffixSqKey]) || ArrayBuffer.isView(holder[suffixSqKey])
    if (hasNums && hasSuffix) {
      return { seq: holder[numsKey], suffixSq: holder[suffixSqKey] }
    }
  }

  const seq = ArrayBuffer.isView(seqLike)
    ? seqLike
    : (Array.isArray(seqLike) ? seqLike : []).map((v) => num(v) ?? 0)
  const suffixSq = new Array(seq.length + 1).fill(0)
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    const x = num(seq[i]) ?? 0
    suffixSq[i] = suffixSq[i + 1] + x * x
  }
  if (holder && typeof holder === "object") {
    holder[numsKey] = seq
    holder[suffixSqKey] = suffixSq
  }
  return { seq, suffixSq }
}

const resolveActiveSet = (activeGroups) =>
  activeGroups instanceof Set ? activeGroups : Array.isArray(activeGroups) ? new Set(activeGroups) : null

const buildGroupDispersion = (featureStats) => {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 1]))
  const sums = Object.fromEntries(GROUPS.map((g) => [g, 0]))
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]))
  for (const [key, stat] of Object.entries(featureStats ?? {})) {
    const g = groupOf(key)
    if (!Object.prototype.hasOwnProperty.call(out, g)) continue
    const s = Math.abs(Number(stat?.stdev ?? 0))
    if (!Number.isFinite(s) || s <= 0) continue
    sums[g] += s
    counts[g] += 1
  }
  for (const g of GROUPS) {
    if (counts[g] > 0) out[g] = sums[g] / counts[g]
  }
  return out
}

export const buildScoreOptions = (raw) => {
  const enabled = raw?.enabled !== false
  const groupLevel = raw?.groupLevel !== false
  const featureLevel = raw?.featureLevel !== false
  const orderStrategy = String(raw?.orderStrategy ?? "weight_variance")
    .trim()
    .toLowerCase()
  const safeOrder =
    orderStrategy === "weight_only" || orderStrategy === "natural"
      ? orderStrategy
      : "weight_variance"
  return {
    enabled,
    groupLevel,
    featureLevel,
    orderStrategy: safeOrder
  }
}

const resolveGroupOrder = ({ weightNorm, groupDispersion, activeSet, orderStrategy }) => {
  const list = GROUPS.slice()
  if (orderStrategy === "natural") {
    return list.filter((g) => !activeSet || activeSet.has(g) || g === "shape")
  }
  const scored = list.map((g, idx) => {
    const w = Number(weightNorm?.[g] ?? 0)
    const d = Number(groupDispersion?.[g] ?? 1)
    let score = w
    if (orderStrategy === "weight_variance") score = w * (Number.isFinite(d) && d > 0 ? d : 1)
    return { g, score, idx }
  })
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.idx - b.idx
  })
  return scored
    .map((row) => row.g)
    .filter((g) => !activeSet || activeSet.has(g) || g === "shape")
}

const resolveGlobalKeys = (globalFeatureStats, prototypes) => {
  const fromStats = Object.keys(globalFeatureStats ?? {})
  if (fromStats.length) return fromStats.sort((a, b) => a.localeCompare(b))
  const set = new Set()
  for (const p of prototypes ?? []) {
    for (const key of Object.keys(p?.globalFeatureVec ?? {})) set.add(key)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

const resolveFeatureKeys = (featureStats, candidateFeatureKeys = null) => {
  if (Array.isArray(candidateFeatureKeys) && candidateFeatureKeys.length) {
    return candidateFeatureKeys
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
  }
  return Object.keys(featureStats ?? {}).sort((a, b) => a.localeCompare(b))
}

const buildIndexByKey = (keys) => {
  const out = {}
  for (let i = 0; i < (keys ?? []).length; i += 1) {
    const key = String(keys[i] ?? "").trim()
    if (!key) continue
    out[key] = i
  }
  return out
}

const buildCenterMap = ({ prototypes, clusterCenters, globalKeys }) => {
  const provided = new Map()
  for (const row of clusterCenters ?? []) {
    const clusterId = String(row?.clusterId ?? "").trim()
    if (!clusterId) continue
    provided.set(clusterId, row?.centerGlobalFeatureVec ?? {})
  }

  const byCluster = new Map()
  for (let i = 0; i < (prototypes ?? []).length; i += 1) {
    const clusterId = String(prototypes[i]?.clusterId ?? "").trim()
    if (!clusterId) continue
    const list = byCluster.get(clusterId) ?? []
    list.push(i)
    byCluster.set(clusterId, list)
  }

  const centers = new Map()
  for (const [clusterId, indices] of byCluster.entries()) {
    if (provided.has(clusterId)) {
      centers.set(clusterId, provided.get(clusterId))
      continue
    }
    const center = {}
    for (const key of globalKeys) {
      const values = indices
        .map((idx) => num(prototypes[idx]?.globalFeatureVec?.[key]))
        .filter(Number.isFinite)
      center[key] = average(values)
    }
    centers.set(clusterId, center)
  }
  return {
    centers,
    byCluster
  }
}

const toAlignedGlobalVals = (vec, globalKeys) => {
  const out = new Float64Array(globalKeys.length)
  for (let i = 0; i < globalKeys.length; i += 1) {
    const n = num(vec?.[globalKeys[i]])
    out[i] = Number.isFinite(n) ? n : Number.NaN
  }
  return out
}

const resolvePrototypeGlobalVals = (prototype, globalKeys) => {
  const cached = prototype?._globalVals
  if (cached && typeof cached.length === "number" && cached.length === globalKeys.length) {
    return cached
  }
  const vals = toAlignedGlobalVals(prototype?.globalFeatureVec ?? {}, globalKeys)
  if (prototype && typeof prototype === "object") {
    prototype._globalVals = vals
  }
  return vals
}

const resolveCandidateGlobalVals = (candidate, context) => {
  const packed = candidate?._globalVals
  if (packed && typeof packed.length === "number" && packed.length === context.globalKeys.length) {
    return packed
  }
  return toAlignedGlobalVals(candidate?.globalFeatureVec ?? {}, context.globalKeys)
}

const resolveCandidateFeatureNumber = (candidate, key, context, fallbackFeatureNums = null) => {
  if (fallbackFeatureNums && Object.prototype.hasOwnProperty.call(fallbackFeatureNums, key)) {
    return fallbackFeatureNums[key]
  }
  const packedFeatureVals = candidate?._featureVals
  const packedBase = Number(candidate?._featureBase ?? NaN)
  const featureIndex = Number(context?.featureIndexByKey?.[key] ?? NaN)
  if (
    ArrayBuffer.isView(packedFeatureVals) &&
    Number.isInteger(packedBase) &&
    Number.isInteger(featureIndex)
  ) {
    const n = Number(packedFeatureVals[packedBase + featureIndex])
    return Number.isFinite(n) ? n : Number.NaN
  }
  const n = num(candidate?.featureVec?.[key])
  return Number.isFinite(n) ? n : Number.NaN
}

const globalSimilarityByAligned = ({
  candidateVals,
  targetVals,
  globalStdVals
}) => {
  const sims = []
  const n = Math.min(
    Number(candidateVals?.length ?? 0),
    Number(targetVals?.length ?? 0),
    Number(globalStdVals?.length ?? 0)
  )
  for (let i = 0; i < n; i += 1) {
    const sim = valueSimilarityByNumbers(candidateVals[i], targetVals[i], globalStdVals[i])
    if (Number.isFinite(sim)) sims.push(sim)
  }
  const avg = average(sims)
  return Number.isFinite(avg) ? avg : null
}

const globalSimilarityByVec = ({
  candidateGlobalFeatureVec,
  targetGlobalFeatureVec,
  globalFeatureStats,
  globalKeys
}) => {
  const sims = []
  for (const key of globalKeys) {
    const sim = valueSimilarity(
      candidateGlobalFeatureVec?.[key],
      targetGlobalFeatureVec?.[key],
      globalFeatureStats?.[key]?.stdev,
    )
    if (Number.isFinite(sim)) sims.push(sim)
  }
  const avg = average(sims)
  return Number.isFinite(avg) ? avg : null
}

const globalSimilarityByPrototype = ({
  candidateGlobalVals,
  candidateSeq150,
  prototype,
  globalStdVals,
  globalKeys
}) => {
  const sims = []
  const vecSim = globalSimilarityByAligned({
    candidateVals: candidateGlobalVals,
    targetVals: resolvePrototypeGlobalVals(prototype, globalKeys),
    globalStdVals
  })
  if (Number.isFinite(vecSim)) sims.push(vecSim)
  const seqSim = cosine(candidateSeq150, prototype?._seq150Nums ?? prototype?.seq150)
  if (Number.isFinite(seqSim)) sims.push(seqSim)
  const avg = average(sims)
  return Number.isFinite(avg) ? avg : 0
}

const triggerSimilarity = (groupScores) => {
  const trigger = average([
    groupScores?.gap,
    groupScores?.volume,
    groupScores?.candle
  ])
  return Number.isFinite(trigger) ? trigger : 0
}

const scoreLocalAgainstPrototype = ({
  candidate,
  prototype,
  featureStats,
  scorerContext,
  weightNorm,
  activeSet,
  groupOrder,
  scoreOptions,
  bestFinalTotal,
  globalScore,
  stageWeights
}) => {
  const cFeatureNums = candidate?._featureNums ?? null
  const cSeq40 = candidate?._seq40Nums ?? candidate?.seq40 ?? candidate?.seq
  const pFeatures = prototype?.featureVec ?? {}
  const pGroupCompiled = resolveGroupCompiled(prototype, pFeatures, featureStats)
  const pSeq40 = prototype?._seq40Nums ?? prototype?.seq40 ?? prototype?.seq
  const groupScores = Object.fromEntries(GROUPS.map((g) => [g, null]))

  let runningTotal = 0
  let remainingUpper = 0
  for (const g of groupOrder) {
    const w = Number(weightNorm[g] ?? 0)
    if (w > 0) remainingUpper += w
  }

  let prunedByGroupBound = 0
  let prunedByFeatureBound = 0
  for (const g of groupOrder) {
    const w = Number(weightNorm[g] ?? 0)
    const remainingAfter = remainingUpper - (w > 0 ? w : 0)
    if (
      scoreOptions.enabled &&
      scoreOptions.groupLevel &&
      Number.isFinite(bestFinalTotal)
    ) {
      const optimisticLocal = runningTotal + remainingUpper
      const optimisticFinal =
        Number(stageWeights?.global ?? 0) * Number(globalScore ?? 0) +
        Number(stageWeights?.local ?? 1) * optimisticLocal +
        Number(stageWeights?.trigger ?? 0) * 1
      if (optimisticFinal <= bestFinalTotal) {
      prunedByGroupBound = 1
      return {
        pruned: true,
        prunedByGroupBound,
        prunedByFeatureBound,
        total: 0,
        groupScores
      }
      }
    }

    let sim = null
    if (g === "shape" || !activeSet || activeSet.has(g)) {
      const compiled = pGroupCompiled[g]
      const keys = compiled?.keys ?? []
      const pVals = compiled?.pVals ?? null
      const stdVals = compiled?.stdVals ?? null
      let sum = 0
      let count = 0
      if (keys.length) {
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i]
          const one = valueSimilarityByNumbers(
            resolveCandidateFeatureNumber(candidate, key, scorerContext, cFeatureNums),
            pVals?.[i],
            stdVals?.[i]
          )
          if (!Number.isFinite(one)) continue
          sum += one
          count += 1
          if (
            scoreOptions.enabled &&
            scoreOptions.featureLevel &&
            Number.isFinite(bestFinalTotal) &&
            w > 0
          ) {
            const optimisticGroup = count > 0 ? (sum + (keys.length - count)) / keys.length : 1
            const optimisticLocal = runningTotal + optimisticGroup * w + remainingAfter
            const optimisticFinal =
              Number(stageWeights?.global ?? 0) * Number(globalScore ?? 0) +
              Number(stageWeights?.local ?? 1) * optimisticLocal +
              Number(stageWeights?.trigger ?? 0) * 1
            if (optimisticFinal <= bestFinalTotal) {
              prunedByFeatureBound = 1
              return {
                pruned: true,
                prunedByGroupBound,
                prunedByFeatureBound,
                total: 0,
                groupScores
              }
            }
          }
        }
      }
      if (g === "shape") {
        const shapeSim = cosine(cSeq40, pSeq40)
        if (Number.isFinite(shapeSim)) {
          sum += shapeSim
          count += 1
        }
      }
      if (count > 0) sim = sum / count
    }
    groupScores[g] = Number.isFinite(sim) ? sim : null
    runningTotal += (Number.isFinite(sim) ? sim : 0) * w
    remainingUpper = remainingAfter
  }

  let total = 0
  for (const g of GROUPS) {
    total += (Number(groupScores[g]) || 0) * (Number(weightNorm[g]) || 0)
  }
  return {
    pruned: false,
    prunedByGroupBound,
    prunedByFeatureBound,
    total,
    groupScores
  }
}

export const buildScorerContext = ({
  prototypes,
  featureStats,
  globalFeatureStats = null,
  candidateFeatureKeys = null,
  candidateGlobalKeys = null,
  weights,
  activeGroups = null,
  scoreOptions = null,
  stageWeights = null,
  coarseTopN = null,
  coarseTopClusters = null,
  clusterCenters = null
}) => {
  const activeSet = resolveActiveSet(activeGroups)
  const weightNorm = normalizeWeights(weights)
  const opts = buildScoreOptions(scoreOptions)
  const groupDispersion = buildGroupDispersion(featureStats)
  const groupOrder = resolveGroupOrder({
    weightNorm,
    groupDispersion,
    activeSet,
    orderStrategy: opts.orderStrategy
  })
  const globalStats = globalFeatureStats ?? {}
  const featureKeys = resolveFeatureKeys(featureStats, candidateFeatureKeys)
  const featureIndexByKey = buildIndexByKey(featureKeys)
  const globalKeys =
    Array.isArray(candidateGlobalKeys) && candidateGlobalKeys.length
      ? candidateGlobalKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
      : resolveGlobalKeys(globalStats, prototypes)
  const globalStdVals = new Float64Array(globalKeys.length)
  for (let i = 0; i < globalKeys.length; i += 1) {
    const s = num(globalStats?.[globalKeys[i]]?.stdev)
    globalStdVals[i] = Number.isFinite(s) ? s : Number.NaN
  }
  const stageWeightNorm = normalizeStageWeights(stageWeights)
  const requireHybrid = stageWeightNorm.global > 0 || stageWeightNorm.trigger > 0

  for (const prototype of prototypes ?? []) {
    const pFeatures = prototype?.featureVec ?? {}
    resolvePrototypeKeys(prototype, pFeatures)
    resolveGroupCompiled(prototype, pFeatures, featureStats)
    resolvePrototypeGlobalVals(prototype, globalKeys)
    resolveSeqCache(prototype, prototype?.seq40 ?? prototype?.seq, "seq40")
    resolveSeqCache(prototype, prototype?.seq150, "seq150")
  }

  const clusterMeta = buildCenterMap({
    prototypes,
    clusterCenters,
    globalKeys
  })
  const clusterCenterVals = new Map()
  for (const [clusterId, centerVec] of clusterMeta.centers.entries()) {
    clusterCenterVals.set(clusterId, toAlignedGlobalVals(centerVec, globalKeys))
  }
  if (requireHybrid) {
    if (!globalKeys.length) {
      throw new Error("Hybrid exact scorer requires global feature keys in pattern library.")
    }
    const missingGlobalVec = (prototypes ?? []).find(
      (p) => !p?.globalFeatureVec || typeof p.globalFeatureVec !== "object" || !Object.keys(p.globalFeatureVec).length,
    )
    if (missingGlobalVec) {
      throw new Error(
        `Hybrid exact scorer requires prototype.globalFeatureVec. templateId=${missingGlobalVec?.templateId ?? "(unknown)"}`,
      )
    }
    const missingSeq150 = (prototypes ?? []).find(
      (p) => !Array.isArray(p?._seq150Nums) || p._seq150Nums.length < 1,
    )
    if (missingSeq150) {
      throw new Error(
        `Hybrid exact scorer requires prototype.seq150. templateId=${missingSeq150?.templateId ?? "(unknown)"}`,
      )
    }
  }
  const hybridEnabled = requireHybrid

  return {
    activeSet,
    weightNorm,
    scoreOptions: opts,
    groupDispersion,
    groupOrder,
    featureKeys,
    featureIndexByKey,
    globalFeatureStats: globalStats,
    globalKeys,
    globalStdVals,
    stageWeights: stageWeightNorm,
    coarseTopN: Math.max(1, Number(coarseTopN) || 120),
    coarseTopClusters: Math.max(1, Number(coarseTopClusters) || 6),
    clusterCenters: clusterMeta.centers,
    clusterCenterVals,
    prototypeIndicesByCluster: clusterMeta.byCluster,
    hybridEnabled
  }
}

const selectCoarseCandidates = ({
  candidate,
  prototypes,
  context
}) => {
  const candidateGlobalVals = resolveCandidateGlobalVals(candidate, context)
  const candidateSeq150 = candidate?._seq150Nums ?? candidate?.seq150
  const candidatePool = []
  const consideredClusters = []
  const totalClusters = context.prototypeIndicesByCluster.size
  if (totalClusters > 0) {
    const clusterScored = []
    for (const [clusterId, center] of context.clusterCenters.entries()) {
      const sim = globalSimilarityByAligned({
        candidateVals: candidateGlobalVals,
        targetVals: context.clusterCenterVals?.get(clusterId) ?? toAlignedGlobalVals(center, context.globalKeys),
        globalStdVals: context.globalStdVals
      })
      clusterScored.push({
        clusterId,
        score: Number.isFinite(sim) ? sim : 0
      })
    }
    clusterScored.sort((a, b) => b.score - a.score)
    const clusterRank = new Map(clusterScored.map((row, idx) => [String(row.clusterId), idx]))
    const requiredClusters = []
    let requiredProtoCount = 0
    const targetTopN = Math.max(1, Number(context.coarseTopN) || 120)
    for (const row of clusterScored) {
      const clusterId = String(row.clusterId)
      const clusterSize = (context.prototypeIndicesByCluster.get(clusterId) ?? []).length
      if (clusterSize <= 0) continue
      requiredClusters.push(clusterId)
      requiredProtoCount += clusterSize
      if (requiredProtoCount >= targetTopN) break
    }
    if (!requiredClusters.length) {
      for (const row of clusterScored.slice(0, Math.max(1, context.coarseTopClusters))) {
        requiredClusters.push(String(row.clusterId))
      }
    }
    const requiredClusterSet = new Set(requiredClusters)
    for (const clusterId of requiredClusters) consideredClusters.push(clusterId)
    for (let idx = 0; idx < (prototypes ?? []).length; idx += 1) {
      const p = prototypes[idx]
      const clusterId = String(p?.clusterId ?? "").trim()
      if (!requiredClusterSet.has(clusterId)) continue
      const globalSim = globalSimilarityByPrototype({
        candidateGlobalVals,
        candidateSeq150,
        prototype: p,
        globalStdVals: context.globalStdVals,
        globalKeys: context.globalKeys
      })
      candidatePool.push({
        idx,
        globalSim,
        clusterId,
        clusterRank: Number(clusterRank.get(clusterId) ?? Number.MAX_SAFE_INTEGER),
        inPriorityCluster: true
      })
    }
  } else {
    for (let idx = 0; idx < (prototypes ?? []).length; idx += 1) {
      const p = prototypes[idx]
      const globalSim = globalSimilarityByPrototype({
        candidateGlobalVals,
        candidateSeq150,
        prototype: p,
        globalStdVals: context.globalStdVals,
        globalKeys: context.globalKeys
      })
      candidatePool.push({
        idx,
        globalSim,
        clusterId: "",
        clusterRank: 0,
        inPriorityCluster: true
      })
    }
  }

  candidatePool.sort((a, b) => {
    if (a.clusterRank !== b.clusterRank) return a.clusterRank - b.clusterRank
    if (b.globalSim !== a.globalSim) return b.globalSim - a.globalSim
    return a.idx - b.idx
  })
  const priorityRows = Math.min(candidatePool.length, Math.max(1, context.coarseTopN))
  return {
    rows: candidatePool,
    priorityRows,
    totalClusters,
    consideredClusters: consideredClusters.length
  }
}

const optimisticPrototypeBound = ({ row, stageWeights, hybridEnabled }) => {
  if (!hybridEnabled) return 1
  const globalScore = Math.max(0, Math.min(1, Number(row?.globalSim ?? 0) || 0))
  const stage = stageWeights && typeof stageWeights === "object"
    ? stageWeights
    : { global: 0.35, local: 0.45, trigger: 0.2 }
  return (
    Number(stage?.global ?? 0) * globalScore +
    Number(stage?.local ?? 0) +
    Number(stage?.trigger ?? 0)
  )
}

const buildEmptyExactScoreResult = ({ weightNorm, stage }) => ({
  total: 0,
  groupScores: Object.fromEntries(GROUPS.map((g) => [g, null])),
  stageScores: {
    global: 0,
    local: 0,
    trigger: 0
  },
  weightNorm,
  stageWeights: stage,
  prototypeId: null,
  prototypeSymbol: null,
  prototypeEventDate: null,
  prototypeClusterId: null,
  prototypeKind: null,
  prototypeOutcomeBucket: null,
  prototypeExecutionFeasibilityBucket: null
})

const toPrototypeMatch = ({
  prototype,
  total,
  localScored,
  globalScore,
  triggerScore,
  weightNorm,
  stage
}) => ({
  total,
  groupScores: localScored.groupScores,
  stageScores: {
    global: globalScore,
    local: Number(localScored?.total ?? 0),
    trigger: triggerScore
  },
  weightNorm,
  stageWeights: stage,
  prototypeId: prototype?.templateId ?? prototype?.id ?? null,
  prototypeSymbol: prototype?.symbol ?? null,
  prototypeEventDate: prototype?.eventDate ?? null,
  prototypeClusterId: prototype?.clusterId ?? null,
  prototypeKind: String(prototype?.templateKind ?? "").trim().toUpperCase() || null,
  prototypeOutcomeBucket: String(prototype?.outcomeBucket ?? "").trim().toUpperCase() || null,
  prototypeExecutionFeasibilityBucket:
    String(prototype?.executionFeasibilityBucket ?? "").trim().toUpperCase() || null
})

const insertTopMatch = ({ matches, match, limit }) => {
  if (!match || !Array.isArray(matches)) return
  matches.push(match)
  matches.sort((left, right) => {
    const byTotal = Number(right?.total ?? 0) - Number(left?.total ?? 0)
    if (byTotal !== 0) return byTotal
    return String(left?.prototypeId ?? "").localeCompare(String(right?.prototypeId ?? ""))
  })
  if (matches.length > limit) matches.length = limit
}

const scoreCandidateExactCore = ({
  candidate,
  prototypes,
  featureStats,
  globalFeatureStats = null,
  weights,
  activeGroups = null,
  scoreOptions = null,
  scorerContext = null,
  stageWeights = null,
  coarseTopN = null,
  coarseTopClusters = null,
  clusterCenters = null,
  topMatches = 1,
  prototypeFilter = null
}) => {
  const context =
    scorerContext ??
    buildScorerContext({
      prototypes,
      featureStats,
      globalFeatureStats,
      candidateFeatureKeys: null,
      candidateGlobalKeys: null,
      weights,
      activeGroups,
      scoreOptions,
      stageWeights,
      coarseTopN,
      coarseTopClusters,
      clusterCenters
    })
  const weightNorm = context.weightNorm
  const activeSet = context.activeSet
  const opts = context.scoreOptions
  const groupOrder = Array.isArray(context.groupOrder) && context.groupOrder.length
    ? context.groupOrder
    : GROUPS
  const stage = context.stageWeights

  const c = { ...(candidate ?? {}) }
  if (!ArrayBuffer.isView(c._seq40Nums) && !Array.isArray(c._seq40Nums)) {
    c._seq40Nums = resolveSeqCache(null, candidate?.seq40 ?? candidate?.seq, "seq40").seq
  }
  if (!ArrayBuffer.isView(c._seq150Nums) && !Array.isArray(c._seq150Nums)) {
    c._seq150Nums = resolveSeqCache(null, candidate?.seq150, "seq150").seq
  }
  if (!ArrayBuffer.isView(c._featureVals)) {
    const cFeatureNums = {}
    for (const [key, value] of Object.entries(c?.featureVec ?? {})) {
      const n = num(value)
      cFeatureNums[key] = Number.isFinite(n) ? n : Number.NaN
    }
    c._featureNums = cFeatureNums
  }
  if (context.hybridEnabled) {
    const candidateGlobalVals = resolveCandidateGlobalVals(c, context)
    if (
      (!ArrayBuffer.isView(candidateGlobalVals) && !Array.isArray(candidateGlobalVals)) ||
      candidateGlobalVals.length < 1
    ) {
      throw new Error("Hybrid exact scorer requires candidate.globalFeatureVec.")
    }
    if (
      (!Array.isArray(c._seq150Nums) && !ArrayBuffer.isView(c._seq150Nums)) ||
      c._seq150Nums.length < 1
    ) {
      throw new Error("Hybrid exact scorer requires candidate.seq150.")
    }
  }

  const perf = {
    prototypesTotal: Array.isArray(prototypes) ? prototypes.length : 0,
    prototypesAfterCoarse: 0,
    coarsePruneRatio: 0,
    prototypesScored: 0,
    prototypesPrunedByGroupBound: 0,
    prototypesPrunedByFeatureBound: 0,
    clustersTotal: 0,
    clustersConsidered: 0
  }

  const candidateRows = context.hybridEnabled
    ? selectCoarseCandidates({ candidate: c, prototypes, context })
    : {
        rows: (prototypes ?? []).map((_, idx) => ({ idx, globalSim: 0 })),
        priorityRows: (prototypes ?? []).length,
        totalClusters: context.prototypeIndicesByCluster.size,
        consideredClusters: context.prototypeIndicesByCluster.size
      }
  const allRows = Array.isArray(candidateRows.rows) ? candidateRows.rows : []
  const coarseLimitRaw = Number(candidateRows.priorityRows ?? allRows.length)
  const coarseLimit = Number.isFinite(coarseLimitRaw)
    ? Math.max(1, Math.floor(coarseLimitRaw))
    : allRows.length
  const rowsToScore = allRows
    .slice(0, Math.min(allRows.length, coarseLimit))
    .sort((a, b) => {
      const boundDelta =
        optimisticPrototypeBound({
          row: b,
          stageWeights: stage,
          hybridEnabled: context.hybridEnabled
        }) -
        optimisticPrototypeBound({
          row: a,
          stageWeights: stage,
          hybridEnabled: context.hybridEnabled
        })
      if (boundDelta !== 0) return boundDelta
      if (Number(b?.globalSim ?? 0) !== Number(a?.globalSim ?? 0)) {
        return Number(b?.globalSim ?? 0) - Number(a?.globalSim ?? 0)
      }
      return Number(a?.idx ?? 0) - Number(b?.idx ?? 0)
    })
  perf.prototypesAfterCoarse = rowsToScore.length
  perf.coarsePruneRatio =
    perf.prototypesTotal > 0
      ? Math.max(0, Math.min(1, perf.prototypesAfterCoarse / perf.prototypesTotal))
      : 0
  perf.clustersTotal = candidateRows.totalClusters
  perf.clustersConsidered = candidateRows.consideredClusters

  const matches = []
  const stageForBound = context.hybridEnabled
    ? stage
    : { global: 0, local: 1, trigger: 0 }

  for (const row of rowsToScore) {
    const prototype = prototypes?.[row.idx]
    if (!prototype) continue
    if (typeof prototypeFilter === "function" && prototypeFilter(prototype) !== true) continue
    const optimisticTotal = optimisticPrototypeBound({
      row,
      stageWeights: stage,
      hybridEnabled: context.hybridEnabled
    })
    const currentFloor =
      matches.length >= Math.max(1, topMatches)
        ? Number(matches[matches.length - 1]?.total ?? Number.NEGATIVE_INFINITY)
        : Number.NEGATIVE_INFINITY
    if (Number.isFinite(currentFloor) && optimisticTotal <= currentFloor) {
      continue
    }
    perf.prototypesScored += 1

    const localScored = scoreLocalAgainstPrototype({
      candidate: c,
      prototype,
      featureStats,
      scorerContext: context,
      weightNorm,
      activeSet,
      groupOrder,
      scoreOptions: opts,
      bestFinalTotal: currentFloor,
      globalScore: Number(row.globalSim ?? 0),
      stageWeights: stageForBound
    })
    perf.prototypesPrunedByGroupBound += Number(localScored.prunedByGroupBound ?? 0)
    perf.prototypesPrunedByFeatureBound += Number(localScored.prunedByFeatureBound ?? 0)
    if (localScored.pruned) continue

    const localScore = Number(localScored.total ?? 0)
    const globalScore = context.hybridEnabled ? Number(row.globalSim ?? 0) : 0
    const triggerScore = triggerSimilarity(localScored.groupScores)
    const total = context.hybridEnabled
      ? stage.global * globalScore + stage.local * localScore + stage.trigger * triggerScore
      : localScore

    insertTopMatch({
      matches,
      match: toPrototypeMatch({
        prototype,
        total,
        localScored,
        globalScore,
        triggerScore,
        weightNorm,
        stage
      }),
      limit: Math.max(1, topMatches)
    })
  }

  return {
    matches,
    perf,
    weightNorm,
    stageWeights: stage
  }
}

export const scoreCandidateExactV2 = ({
  candidate,
  prototypes,
  featureStats,
  globalFeatureStats = null,
  weights,
  activeGroups = null,
  scoreOptions = null,
  scorerContext = null,
  stageWeights = null,
  coarseTopN = null,
  coarseTopClusters = null,
  clusterCenters = null
}) => {
  const core = scoreCandidateExactCore({
    candidate,
    prototypes,
    featureStats,
    globalFeatureStats,
    weights,
    activeGroups,
    scoreOptions,
    scorerContext,
    stageWeights,
    coarseTopN,
    coarseTopClusters,
    clusterCenters,
    topMatches: 1
  })
  const best = core.matches[0] ?? null
  if (!best) {
    return {
      ...buildEmptyExactScoreResult({
        weightNorm: core.weightNorm,
        stage: core.stageWeights
      }),
      perf: core.perf
    }
  }
  return {
    ...best,
    perf: core.perf
  }
}

const normalizeDisambiguationBucket = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (["STOP_FIRST", "TIMEOUT_NEGATIVE", "LOW_EXECUTION_QUALITY"].includes(text)) {
    return text
  }
  return null
}

const matchesNegativeBucket = (prototype, bucket) =>
  String(prototype?.outcomeBucket ?? "").trim().toUpperCase() === String(bucket ?? "").trim().toUpperCase()

const chooseBestMatch = (rows) =>
  (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
    const byTotal = Number(right?.total ?? 0) - Number(left?.total ?? 0)
    if (byTotal !== 0) return byTotal
    return String(left?.prototypeId ?? "").localeCompare(String(right?.prototypeId ?? ""))
  })[0] ?? null

export const scoreCandidateExactV3 = ({
  candidate,
  prototypes,
  negativePrototypes = null,
  featureStats,
  globalFeatureStats = null,
  weights,
  activeGroups = null,
  scoreOptions = null,
  scorerContext = null,
  negativeScorerContext = null,
  stageWeights = null,
  coarseTopN = null,
  coarseTopClusters = null,
  clusterCenters = null,
  negativeBuckets = null
}) => {
  const positive = scoreCandidateExactCore({
    candidate,
    prototypes,
    featureStats,
    globalFeatureStats,
    weights,
    activeGroups,
    scoreOptions,
    scorerContext,
    stageWeights,
    coarseTopN,
    coarseTopClusters,
    clusterCenters,
    topMatches: 2
  })
  const positiveTop1 = positive.matches[0] ?? null
  const positiveTop2 = positive.matches[1] ?? null
  if (!positiveTop1) {
    return {
      ...buildEmptyExactScoreResult({
        weightNorm: positive.weightNorm,
        stage: positive.stageWeights
      }),
      positiveTop1: null,
      positiveTop2: null,
      negativeTop1: null,
      negativeTop1Stop: null,
      negativeTop1TimeoutNegative: null,
      negativeTop1LowExecutionQuality: null,
      top1Top2PositiveGap: null,
      positiveVsNegativeGap: null,
      perf: positive.perf
    }
  }

  const safeNegativeBuckets = Array.from(
    new Set(
      (Array.isArray(negativeBuckets) ? negativeBuckets : ["STOP_FIRST", "TIMEOUT_NEGATIVE"])
        .map((value) => normalizeDisambiguationBucket(value))
        .filter(Boolean),
    ),
  )
  const negativeRows = Array.isArray(negativePrototypes) ? negativePrototypes : []
  let negativeTop1Stop = null
  let negativeTop1TimeoutNegative = null
  let negativeTop1LowExecutionQuality = null
  if (negativeRows.length > 0 && safeNegativeBuckets.length > 0) {
    const negativeCore = (bucket) =>
      scoreCandidateExactCore({
        candidate,
        prototypes: negativeRows,
        featureStats,
        globalFeatureStats,
        weights,
        activeGroups,
        scoreOptions,
        scorerContext: negativeScorerContext,
        stageWeights,
        coarseTopN,
        coarseTopClusters,
        clusterCenters: null,
        topMatches: 1,
        prototypeFilter: (prototype) => matchesNegativeBucket(prototype, bucket)
      }).matches[0] ?? null
    if (safeNegativeBuckets.includes("STOP_FIRST")) {
      negativeTop1Stop = negativeCore("STOP_FIRST")
    }
    if (safeNegativeBuckets.includes("TIMEOUT_NEGATIVE")) {
      negativeTop1TimeoutNegative = negativeCore("TIMEOUT_NEGATIVE")
    }
    if (safeNegativeBuckets.includes("LOW_EXECUTION_QUALITY")) {
      negativeTop1LowExecutionQuality = negativeCore("LOW_EXECUTION_QUALITY")
    }
  }
  const negativeTop1 = chooseBestMatch([
    negativeTop1Stop,
    negativeTop1TimeoutNegative,
    negativeTop1LowExecutionQuality
  ])
  const top1Top2PositiveGap = positiveTop2
    ? Number(positiveTop1.total ?? 0) - Number(positiveTop2.total ?? 0)
    : Number(positiveTop1.total ?? 0)
  const positiveVsNegativeGap = negativeTop1
    ? Number(positiveTop1.total ?? 0) - Number(negativeTop1.total ?? 0)
    : null

  return {
    ...positiveTop1,
    positiveTop1,
    positiveTop2,
    negativeTop1,
    negativeTop1Stop,
    negativeTop1TimeoutNegative,
    negativeTop1LowExecutionQuality,
    top1Top2PositiveGap,
    positiveVsNegativeGap,
    perf: positive.perf
  }
}

export const scoreAgainstPrototype = ({
  candidate,
  prototype,
  featureStats,
  weights,
  weightNormOverride,
  activeGroups
}) => {
  const weightNorm = weightNormOverride ?? normalizeWeights(weights)
  const activeSet = resolveActiveSet(activeGroups)
  const groupScores = Object.fromEntries(GROUPS.map((g) => [g, null]))
  const bucket = {
    trend: [],
    candle: [],
    volume: [],
    shape: [],
    gap: []
  }

  const cFeatures = candidate?.featureVec ?? {}
  const pFeatures = prototype?.featureVec ?? {}
  for (const key of resolvePrototypeKeys(prototype, pFeatures)) {
    const g = groupOf(key)
    if (!Object.prototype.hasOwnProperty.call(bucket, g)) continue
    if (activeSet && !activeSet.has(g)) continue
    const sim = valueSimilarity(cFeatures[key], pFeatures[key], featureStats?.[key]?.stdev)
    if (Number.isFinite(sim)) bucket[g].push(sim)
  }

  const shapeSim = cosine(
    candidate?.seq40 ?? candidate?.seq,
    prototype?.seq40 ?? prototype?.seq,
  )
  if (Number.isFinite(shapeSim)) bucket.shape.push(shapeSim)

  let total = 0
  for (const g of GROUPS) {
    const sim = average(bucket[g])
    groupScores[g] = Number.isFinite(sim) ? sim : null
    total += (Number.isFinite(sim) ? sim : 0) * (weightNorm[g] ?? 0)
  }

  return { total, groupScores, weightNorm }
}

export const scoreTemplatePairForFamily = ({
  left,
  right,
  featureStats,
  weights,
  activeGroups = null
}) =>
  scoreAgainstPrototype({
    candidate: left,
    prototype: right,
    featureStats,
    weights,
    activeGroups
  })

export const computeFamilyCohesion = ({
  rows,
  featureStats,
  weights,
  maxPairs = 24
}) => {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (safeRows.length < 2) {
    return {
      pairCount: 0,
      anchorTemplateId: safeRows[0]?.templateId ?? null,
      averageTotal: 1,
      groupScores: Object.fromEntries(GROUPS.map((g) => [g, 1])),
      shapeScore: 1
    }
  }
  const anchor = safeRows[0]
  const totals = []
  const shapeScores = []
  const grouped = Object.fromEntries(GROUPS.map((g) => [g, []]))
  const limit = Math.max(1, Number(maxPairs ?? 24) || 24)
  for (let idx = 1; idx < safeRows.length && totals.length < limit; idx += 1) {
    const scored = scoreAgainstPrototype({
      candidate: safeRows[idx],
      prototype: anchor,
      featureStats,
      weights
    })
    totals.push(Number(scored?.total ?? 0) || 0)
    for (const group of GROUPS) {
      grouped[group].push(Number(scored?.groupScores?.[group] ?? 0) || 0)
    }
    shapeScores.push(Number(scored?.groupScores?.shape ?? 0) || 0)
  }
  return {
    pairCount: totals.length,
    anchorTemplateId: anchor?.templateId ?? null,
    averageTotal: average(totals) ?? 0,
    groupScores: Object.fromEntries(GROUPS.map((g) => [g, average(grouped[g]) ?? 0])),
    shapeScore: average(shapeScores) ?? 0
  }
}

export const scoreCandidate = ({ candidate, prototypes, featureStats, weights, activeGroups = null }) => {
  const weightNorm = normalizeWeights(weights)
  let best = null
  for (const p of prototypes ?? []) {
    const scored = scoreAgainstPrototype({
      candidate,
      prototype: p,
      featureStats,
      weights,
      weightNormOverride: weightNorm,
      activeGroups
    })
    if (!best || scored.total > best.total) {
      best = {
        ...scored,
        prototypeId: p?.templateId ?? p?.id ?? null,
        prototypeSymbol: p?.symbol ?? null,
        prototypeEventDate: p?.eventDate ?? null
      }
    }
  }
  if (!best) {
    return {
      total: 0,
      groupScores: Object.fromEntries(GROUPS.map((g) => [g, null])),
      weightNorm,
      prototypeId: null,
      prototypeSymbol: null,
      prototypeEventDate: null
    }
  }
  return best
}

export const updateWeightsOnline = ({
  weights,
  pickGroupScores,
  altGroupScores,
  success,
  learningRate,
  reinforceBeta,
  floor,
  lockedZeroGroups = null
}) => {
  const lr = Number(learningRate ?? 0.03)
  const beta = Number(reinforceBeta ?? 0.2)
  const minW = Number(floor ?? 0.01)
  const locked = new Set(
    (Array.isArray(lockedZeroGroups) ? lockedZeroGroups : [])
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter((v) => v.length > 0),
  )
  const next = { ...normalizeWeights(weights) }

  if (success) {
    for (const g of GROUPS) {
      const s = Number(pickGroupScores?.[g] ?? 0)
      next[g] += lr * beta * (Number.isFinite(s) ? s : 0)
    }
  } else if (altGroupScores) {
    for (const g of GROUPS) {
      const p = Number(pickGroupScores?.[g] ?? 0)
      const a = Number(altGroupScores?.[g] ?? 0)
      next[g] += lr * ((Number.isFinite(a) ? a : 0) - (Number.isFinite(p) ? p : 0))
    }
  }

  for (const g of GROUPS) {
    if (locked.has(g)) {
      next[g] = 0
      continue
    }
    if (!Number.isFinite(next[g]) || next[g] < minW) next[g] = minW
  }
  for (const g of locked) {
    if (Object.prototype.hasOwnProperty.call(next, g)) next[g] = 0
  }
  return normalizeWeights(next)
}

export const quantile = (values, q) => {
  const list = (values ?? []).map(num).filter(Number.isFinite).sort((a, b) => a - b)
  if (!list.length) return null
  const qq = Math.max(0, Math.min(1, Number(q) || 0))
  const idx = Math.floor(qq * (list.length - 1))
  return list[idx]
}
