import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonl, writeJson, writeJsonl } from "../lib/io.mjs"

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

const average = (values) => {
  const list = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter(Number.isFinite)
  if (list.length < 1) return 0
  return list.reduce((acc, value) => acc + value, 0) / list.length
}

const jaccardSets = (leftValues, rightValues) => {
  const left = new Set((Array.isArray(leftValues) ? leftValues : []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const right = new Set((Array.isArray(rightValues) ? rightValues : []).map((value) => String(value ?? "").trim()).filter(Boolean))
  if (left.size < 1 && right.size < 1) return 0
  let intersection = 0
  for (const value of left) {
    if (right.has(value)) intersection += 1
  }
  const union = new Set([...left, ...right]).size
  return union > 0 ? intersection / union : 0
}

const resolveC2Config = (config) => {
  const raw = config?.pattern?.c2 ?? {}
  const representativePolicyRaw =
    String(raw?.representativePolicy ?? "quality_first_with_coverage_guard").trim() ||
    "quality_first_with_coverage_guard"
  const similarityPolicyVersionRaw =
    String(raw?.similarityPolicyVersion ?? "c2_overlap_graph_v1").trim() || "c2_overlap_graph_v1"
  return {
    enabled: raw?.enabled === true,
    minFamiliesForDedup: Math.max(2, Math.floor(Number(raw?.minFamiliesForDedup ?? 2) || 2)),
    maxFamiliesForPairwise: Math.max(2, Math.floor(Number(raw?.maxFamiliesForPairwise ?? 24) || 24)),
    similarityThreshold: clamp01(raw?.similarityThreshold ?? 0.72),
    top1AgreementThreshold: clamp01(raw?.top1AgreementThreshold ?? 0.7),
    symbolDayJaccardThreshold: clamp01(raw?.symbolDayJaccardThreshold ?? 0.65),
    pickedDayJaccardThreshold: clamp01(raw?.pickedDayJaccardThreshold ?? 0.65),
    executionOverlapThreshold: clamp01(raw?.executionOverlapThreshold ?? 0.55),
    maxBehaviorPenaltyDistance: clamp01(raw?.maxBehaviorPenaltyDistance ?? 0.3),
    retainShadowFamilies: raw?.retainShadowFamilies !== false,
    fallbackToC1IfTooSmall: raw?.fallbackToC1IfTooSmall !== false,
    minRepresentativeFamilies: Math.max(1, Math.floor(Number(raw?.minRepresentativeFamilies ?? 2) || 2)),
    representativePolicy:
      representativePolicyRaw === "coverage_first_with_quality_floor"
        ? "coverage_first_with_quality_floor"
        : "quality_first_with_coverage_guard",
    similarityPolicyVersion:
      similarityPolicyVersionRaw === "c2_overlap_graph_strict_v1"
        ? "c2_overlap_graph_strict_v1"
        : "c2_overlap_graph_v1",
    targetCoverageNorm: Math.max(0.01, Number(raw?.targetCoverageNorm ?? 1) || 1),
    rankOverlapThreshold: clamp01(raw?.rankOverlapThreshold ?? 0.55),
    minRepresentativeTargetsPer20EvalDays: Math.max(
      0,
      Number(raw?.minRepresentativeTargetsPer20EvalDays ?? 0.2) || 0,
    ),
    minRepresentativeExecutionCoverageEval: clamp01(
      raw?.minRepresentativeExecutionCoverageEval ?? 0.05,
    ),
    minRepresentativeScoreFloor: Math.max(0, Number(raw?.minRepresentativeScoreFloor ?? 0.18) || 0),
    scoreWeights: {
      symbolDay: Math.max(0, Number(raw?.scoreWeights?.symbolDay ?? 0.24) || 0),
      pickedDay: Math.max(0, Number(raw?.scoreWeights?.pickedDay ?? 0.18) || 0),
      top1: Math.max(0, Number(raw?.scoreWeights?.top1 ?? 0.18) || 0),
      rank: Math.max(0, Number(raw?.scoreWeights?.rank ?? 0.12) || 0),
      execution: Math.max(0, Number(raw?.scoreWeights?.execution ?? 0.14) || 0),
      regime: Math.max(0, Number(raw?.scoreWeights?.regime ?? 0.08) || 0),
      behaviorPenalty: Math.max(0, Number(raw?.scoreWeights?.behaviorPenalty ?? 0.06) || 0),
      precision: Math.max(0, Number(raw?.scoreWeights?.precision ?? 0.34) || 0),
      representativeExecution: Math.max(0, Number(raw?.scoreWeights?.executionQuality ?? 0.24) || 0),
      coverage: Math.max(0, Number(raw?.scoreWeights?.coverage ?? 0.22) || 0),
      representativeRank: Math.max(0, Number(raw?.scoreWeights?.rankQuality ?? 0.12) || 0),
      prototypeQuality: Math.max(0, Number(raw?.scoreWeights?.prototypeQuality ?? 0.08) || 0),
      coreShareBonus: Math.max(0, Number(raw?.scoreWeights?.coreShareBonus ?? 0.04) || 0),
      penaltyPenalty: Math.max(0, Number(raw?.scoreWeights?.penaltyPenalty ?? 0.03) || 0),
      quarantinePenalty: Math.max(0, Number(raw?.scoreWeights?.quarantinePenalty ?? 0.04) || 0),
      stopPenalty: Math.max(0, Number(raw?.scoreWeights?.stopPenalty ?? 0.05) || 0),
      timeoutPenalty: Math.max(0, Number(raw?.scoreWeights?.timeoutPenalty ?? 0.03) || 0)
    }
  }
}

const listToMap = (rows, key) =>
  new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [String(row?.[key] ?? "").trim(), row])
      .filter(([value]) => value),
  )

const arrayToDayMap = (rows, valueKey = "symbols") =>
  new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [String(row?.dayKey ?? "").trim(), row?.[valueKey]])
      .filter(([dayKey]) => dayKey),
  )

const computeTop1Agreement = (leftRows, rightRows) => {
  const left = arrayToDayMap(leftRows, "symbol")
  const right = arrayToDayMap(rightRows, "symbol")
  const sharedDays = Array.from(left.keys()).filter((dayKey) => right.has(dayKey))
  if (sharedDays.length < 1) return 0
  let agree = 0
  for (const dayKey of sharedDays) {
    if (String(left.get(dayKey) ?? "") === String(right.get(dayKey) ?? "")) agree += 1
  }
  return agree / sharedDays.length
}

const computeRankOverlapScore = (leftRows, rightRows) => {
  const left = arrayToDayMap(leftRows, "symbols")
  const right = arrayToDayMap(rightRows, "symbols")
  const sharedDays = Array.from(left.keys()).filter((dayKey) => right.has(dayKey))
  if (sharedDays.length < 1) return 0
  const scores = []
  for (const dayKey of sharedDays) {
    scores.push(jaccardSets(left.get(dayKey), right.get(dayKey)))
  }
  return average(scores)
}

const computeBehaviorPenaltyDistance = (left, right) => {
  const leftMetrics = left?.metrics ?? {}
  const rightMetrics = right?.metrics ?? {}
  return average([
    Math.abs((Number(leftMetrics?.stopRateEval ?? 0) || 0) - (Number(rightMetrics?.stopRateEval ?? 0) || 0)),
    Math.abs(
      (Number(leftMetrics?.timeoutNegativeRateEval ?? 0) || 0) -
        (Number(rightMetrics?.timeoutNegativeRateEval ?? 0) || 0),
    ),
    Math.abs(
      (Number(leftMetrics?.executionCoverageEval ?? 0) || 0) -
        (Number(rightMetrics?.executionCoverageEval ?? 0) || 0),
    )
  ])
}

const resolveRepresentativeRankMetric = (result) => {
  const resolved = Number(result?.selectionHitAt1ResolvedEval)
  if (Number.isFinite(resolved)) {
    return clamp01(resolved)
  }
  return clamp01(result?.selectionHitAt1Eval ?? 0)
}

const resolveRepresentativeRankMetricSource = (result) =>
  String(result?.selectionHitAt1MetricSourceEval ?? "RAW_TOP1").trim().toUpperCase() || "RAW_TOP1"

const computeRepresentativeScore = ({ result, cfg }) => {
  const weights = cfg.scoreWeights ?? {}
  return (
    (Number(weights.precision ?? 0) || 0) * clamp01(result?.targetHitRateEval ?? 0) +
    (Number(weights.representativeExecution ?? 0) || 0) * clamp01(result?.executedTargetHitRateEval ?? 0) +
    (Number(weights.coverage ?? 0) || 0) *
      Math.min(1, Math.max(0, Number(result?.targetsPer20EvalDays ?? 0) || 0) / cfg.targetCoverageNorm) +
    (Number(weights.representativeRank ?? 0) || 0) * resolveRepresentativeRankMetric(result) +
    (Number(weights.prototypeQuality ?? 0) || 0) *
      clamp01(Number(result?.c0PrototypeQualityMedian ?? 0) || 0) +
    (Number(weights.coreShareBonus ?? 0) || 0) *
      clamp01(Number(result?.c0CorePrototypeShare ?? 0) || 0) -
    (Number(weights.penaltyPenalty ?? 0) || 0) *
      clamp01(Number(result?.c0PenaltyPrototypeShare ?? 0) || 0) -
    (Number(weights.quarantinePenalty ?? 0) || 0) *
      clamp01(Number(result?.c0QuarantinePrototypeShare ?? 0) || 0) -
    (Number(weights.stopPenalty ?? 0) || 0) * clamp01(result?.stopRateEval ?? 0) -
    (Number(weights.timeoutPenalty ?? 0) || 0) * clamp01(result?.timeoutNegativeRateEval ?? 0)
  )
}

const meetsRepresentativeCoverageGuard = ({ result, cfg }) =>
  (Number(result?.targetsPer20EvalDays ?? 0) || 0) >=
    (Number(cfg?.minRepresentativeTargetsPer20EvalDays ?? 0) || 0) &&
  clamp01(result?.executionCoverageEval ?? 0) >=
    clamp01(cfg?.minRepresentativeExecutionCoverageEval ?? 0)

const qualifiesFamilyOverlap = ({ overlap, cfg }) => {
  const baseQualified =
    overlap.dedupSimilarity >= cfg.similarityThreshold &&
    overlap.symbolDayJaccard >= cfg.symbolDayJaccardThreshold &&
    overlap.pickedDayJaccard >= cfg.pickedDayJaccardThreshold &&
    overlap.top1Agreement >= cfg.top1AgreementThreshold &&
    overlap.executionOverlapScore >= cfg.executionOverlapThreshold &&
    overlap.behaviorPenaltyDistance <= cfg.maxBehaviorPenaltyDistance
  if (!baseQualified) return false
  if (cfg.similarityPolicyVersion === "c2_overlap_graph_strict_v1") {
    return (
      overlap.rankOverlapScore >= cfg.rankOverlapThreshold &&
      overlap.dedupSimilarity >= Math.max(cfg.similarityThreshold, 0.78)
    )
  }
  return true
}

const loadStepC2Inputs = async (ctx) => {
  const rootDir = path.join(ctx.runDir, "step-c1")
  const indexPath = path.join(rootDir, "c1_family_probe_index.json")
  const resultsPath = path.join(rootDir, "c1_family_probe_results.jsonl")
  const footprintsPath = path.join(rootDir, "c1_family_overlap_footprints.jsonl")
  const summaryPath = path.join(rootDir, "c1_summary.json")
  return {
    rootDir,
    indexPath,
    resultsPath,
    footprintsPath,
    summaryPath,
    index: pathExists(indexPath) ? await readJson(indexPath, null) : null,
    results: pathExists(resultsPath) ? await readJsonl(resultsPath) : [],
    footprints: pathExists(footprintsPath) ? await readJsonl(footprintsPath) : [],
    summary: pathExists(summaryPath) ? await readJson(summaryPath, null) : null
  }
}

const computeFamilyOverlap = (left, right, cfg) => {
  const symbolDayJaccard = jaccardSets(left?.footprint?.symbolDays, right?.footprint?.symbolDays)
  const pickedDayJaccard = jaccardSets(left?.footprint?.pickedDays, right?.footprint?.pickedDays)
  const top1Agreement = computeTop1Agreement(left?.footprint?.top1ByDay, right?.footprint?.top1ByDay)
  const rankOverlapScore = computeRankOverlapScore(left?.footprint?.topRanksByDay, right?.footprint?.topRanksByDay)
  const executionOverlapScore = jaccardSets(
    left?.footprint?.executionSymbolDays,
    right?.footprint?.executionSymbolDays,
  )
  const regimeOverlapScore = jaccardSets(left?.footprint?.regimes, right?.footprint?.regimes)
  const behaviorPenaltyDistance = computeBehaviorPenaltyDistance(left?.footprint, right?.footprint)
  const weights = cfg.scoreWeights ?? {}
  const dedupSimilarity = clamp01(
    (Number(weights.symbolDay ?? 0) || 0) * symbolDayJaccard +
      (Number(weights.pickedDay ?? 0) || 0) * pickedDayJaccard +
      (Number(weights.top1 ?? 0) || 0) * top1Agreement +
      (Number(weights.rank ?? 0) || 0) * rankOverlapScore +
      (Number(weights.execution ?? 0) || 0) * executionOverlapScore +
      (Number(weights.regime ?? 0) || 0) * regimeOverlapScore -
      (Number(weights.behaviorPenalty ?? 0) || 0) * behaviorPenaltyDistance,
  )
  const overlap = {
    leftFamilyId: left.familyId,
    rightFamilyId: right.familyId,
    symbolDayJaccard,
    pickedDayJaccard,
    top1Agreement,
    rankOverlapScore,
    executionOverlapScore,
    regimeOverlapScore,
    behaviorPenaltyDistance,
    dedupSimilarity
  }
  return {
    ...overlap,
    qualifies: qualifiesFamilyOverlap({ overlap, cfg })
  }
}

const clusterDedupFamilies = ({ familyIds, adjacency }) => {
  const visited = new Set()
  const groups = []
  for (const familyId of familyIds) {
    if (visited.has(familyId)) continue
    const queue = [familyId]
    const component = []
    visited.add(familyId)
    while (queue.length > 0) {
      const current = queue.shift()
      component.push(current)
      const nextIds = adjacency.get(current) ?? new Set()
      for (const nextId of nextIds) {
        if (visited.has(nextId)) continue
        visited.add(nextId)
        queue.push(nextId)
      }
    }
    groups.push(component.sort((a, b) => a.localeCompare(b)))
  }
  return groups
}

const selectRepresentativeFamily = ({ groupFamilyIds, resultByFamilyId, cfg }) => {
  const candidates = groupFamilyIds
    .map((familyId) => ({
      familyId,
      result: resultByFamilyId.get(familyId) ?? null,
      representativeScore: 0,
      coverageGuardPassed: false
    }))
    .map((row) => ({
      ...row,
      representativeScore: computeRepresentativeScore({ result: row.result, cfg }),
      coverageGuardPassed: meetsRepresentativeCoverageGuard({ result: row.result, cfg })
    }))
  const guardPreferred = candidates.filter((row) => row.coverageGuardPassed)
  const effectiveCandidates = guardPreferred.length > 0 ? guardPreferred : candidates
  const policyCandidates =
    cfg.representativePolicy === "coverage_first_with_quality_floor"
      ? (() => {
          const qualityFloor = Number(cfg?.minRepresentativeScoreFloor ?? 0) || 0
          const floorPassed = effectiveCandidates.filter(
            (row) => Number(row?.representativeScore ?? 0) >= qualityFloor,
          )
          return floorPassed.length > 0 ? floorPassed : effectiveCandidates
        })()
      : effectiveCandidates
  const sorted = policyCandidates.sort((left, right) => {
    if (cfg.representativePolicy === "coverage_first_with_quality_floor") {
      return (
        Number(right?.result?.targetsPer20EvalDays ?? 0) -
          Number(left?.result?.targetsPer20EvalDays ?? 0) ||
        Number(right?.result?.executionCoverageEval ?? 0) -
          Number(left?.result?.executionCoverageEval ?? 0) ||
        Number(right?.representativeScore ?? 0) - Number(left?.representativeScore ?? 0) ||
        Number(right?.result?.executedTargetHitRateEval ?? 0) -
          Number(left?.result?.executedTargetHitRateEval ?? 0) ||
        resolveRepresentativeRankMetric(right?.result) -
          resolveRepresentativeRankMetric(left?.result) ||
        Number(left?.result?.stopRateEval ?? 0) - Number(right?.result?.stopRateEval ?? 0) ||
        Number(left?.result?.timeoutNegativeRateEval ?? 0) -
          Number(right?.result?.timeoutNegativeRateEval ?? 0)
      )
    }
    return (
      Number(right?.representativeScore ?? 0) - Number(left?.representativeScore ?? 0) ||
      Number(right?.result?.executedTargetHitRateEval ?? 0) -
        Number(left?.result?.executedTargetHitRateEval ?? 0) ||
      resolveRepresentativeRankMetric(right?.result) - resolveRepresentativeRankMetric(left?.result) ||
      Number(left?.result?.stopRateEval ?? 0) - Number(right?.result?.stopRateEval ?? 0) ||
      Number(left?.result?.timeoutNegativeRateEval ?? 0) -
        Number(right?.result?.timeoutNegativeRateEval ?? 0)
    )
  })
  return sorted[0] ?? null
}

export const runStepC2 = async (ctx) => {
  const cfg = resolveC2Config(ctx.config)
  const outDir = path.join(ctx.runDir, "step-c2")
  await ensureDir(outDir)
  const indexPath = path.join(outDir, "c2_dedup_index.json")
  const groupsPath = path.join(outDir, "c2_dedup_groups.jsonl")
  const summaryPath = path.join(outDir, "c2_summary.json")

  const disabledPayload = {
    step: "C2",
    enabled: false,
    inputFamilies: 0,
    dedupedGroups: 0,
    representativeFamilies: 0,
    shadowFamilies: 0,
    fallbackUsed: false,
      gate: {
        enabled: false,
      failed: false,
      reason: "DISABLED",
      fallbackUsed: false
    },
    similarityPolicyVersion: cfg.similarityPolicyVersion,
    representativePolicy: cfg.representativePolicy
  }
  if (cfg.enabled !== true) {
    await writeJson(indexPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      inputPassedFamilyCount: 0,
      dedupedFamilyCount: 0,
      representativeFamilyCount: 0,
      shadowFamilyCount: 0,
      fallbackUsed: false,
      representativeFamilyIds: [],
      shadowFamilyIds: [],
      groupsPath,
      gate: disabledPayload.gate,
      similarityPolicyVersion: cfg.similarityPolicyVersion,
      representativePolicy: cfg.representativePolicy
    })
    await writeJsonl(groupsPath, [])
    await writeJson(summaryPath, disabledPayload)
    return {
      step: "C2",
      indexPath,
      groupsPath,
      summaryPath,
      summary: disabledPayload
    }
  }

  const inputs = await loadStepC2Inputs(ctx)
  const resultByFamilyId = listToMap(inputs.results, "familyId")
  const footprintByFamilyId = listToMap(inputs.footprints, "familyId")
  const inputFamilyIds = Array.from(
    new Set(
      []
        .concat(Array.isArray(inputs.index?.passedFamilyIds) ? inputs.index.passedFamilyIds : [])
        .concat(Array.isArray(inputs.index?.backfillFamilyIds) ? inputs.index.backfillFamilyIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  )
  if (inputFamilyIds.length < 1) {
    const summary = {
      ...disabledPayload,
      enabled: true,
      gate: {
        enabled: true,
        failed: true,
        reason: "NO_INPUT_FAMILIES",
        fallbackUsed: false
      }
    }
    await writeJson(indexPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      inputPassedFamilyCount: 0,
      dedupedFamilyCount: 0,
      representativeFamilyCount: 0,
      shadowFamilyCount: 0,
      fallbackUsed: false,
      representativeFamilyIds: [],
      shadowFamilyIds: [],
      groupsPath,
      gate: summary.gate,
      similarityPolicyVersion: cfg.similarityPolicyVersion,
      representativePolicy: cfg.representativePolicy
    })
    await writeJsonl(groupsPath, [])
    await writeJson(summaryPath, summary)
    return {
      step: "C2",
      indexPath,
      groupsPath,
      summaryPath,
      summary
    }
  }

  if (inputFamilyIds.length < cfg.minFamiliesForDedup) {
    const singletonGroups = inputFamilyIds.map((familyId, idx) => {
      const result = resultByFamilyId.get(familyId) ?? {}
      return {
        groupId: `G${String(idx + 1).padStart(3, "0")}`,
        memberFamilyIds: [familyId],
        representativeFamilyId: familyId,
        shadowFamilyIds: [],
        groupSize: 1,
        avgDedupSimilarity: 0,
        maxDedupSimilarity: 0,
        dedupReason: "NO_OP_TOO_SMALL",
        fallbackGroup: false,
        representativeScore: computeRepresentativeScore({ result, cfg }),
        representativeSelectionHitAt1Eval: resolveRepresentativeRankMetric(result),
        representativeSelectionHitAt1MetricSource: resolveRepresentativeRankMetricSource(result),
        representativeTargetHitRateEval: Number(result?.targetHitRateEval ?? 0) || 0,
        representativeExecutedTargetHitRateEval: Number(result?.executedTargetHitRateEval ?? 0) || 0,
        representativeTargetsPer20EvalDays: Number(result?.targetsPer20EvalDays ?? 0) || 0,
        representativeExecutionCoverageEval: Number(result?.executionCoverageEval ?? 0) || 0,
        representativePrototypeQualityMedian: Number(result?.c0PrototypeQualityMedian ?? 0) || 0,
        representativePrototypeLedgerMatchedCount:
          Number(result?.c0PrototypeLedgerMatchedCount ?? 0) || 0,
        representativePrototypeLedgerCoverage:
          Number(result?.c0PrototypeLedgerCoverage ?? 0) || 0,
        representativeCorePrototypeShare: Number(result?.c0CorePrototypeShare ?? 0) || 0,
        representativePenaltyPrototypeShare: Number(result?.c0PenaltyPrototypeShare ?? 0) || 0,
        representativeQuarantinePrototypeShare: Number(result?.c0QuarantinePrototypeShare ?? 0) || 0,
        representativeRetiredPrototypeShare: Number(result?.c0RetiredPrototypeShare ?? 0) || 0,
        representativePrototypeLedgerConfidenceMean:
          Number(result?.c0PrototypeLedgerConfidenceMean ?? 0) || 0
      }
    })
    const summary = {
      step: "C2",
      enabled: true,
      inputFamilies: inputFamilyIds.length,
      dedupedGroups: singletonGroups.length,
      representativeFamilies: inputFamilyIds.length,
      shadowFamilies: 0,
      fallbackUsed: false,
      gate: {
        enabled: true,
        failed: false,
        reason: "NO_OP_TOO_SMALL",
        fallbackUsed: false
      },
      representativeCoverageGuard: {
        minTargetsPer20EvalDays: cfg.minRepresentativeTargetsPer20EvalDays,
        minExecutionCoverageEval: cfg.minRepresentativeExecutionCoverageEval,
        minRepresentativeScoreFloor: cfg.minRepresentativeScoreFloor
      },
      similarityPolicyVersion: cfg.similarityPolicyVersion,
      representativePolicy: cfg.representativePolicy
    }
    await writeJson(indexPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      inputPassedFamilyCount: inputFamilyIds.length,
      dedupedFamilyCount: inputFamilyIds.length,
      representativeFamilyCount: inputFamilyIds.length,
      shadowFamilyCount: 0,
      fallbackUsed: false,
      representativeFamilyIds: inputFamilyIds,
      shadowFamilyIds: [],
      groupsPath,
      gate: summary.gate,
      similarityPolicyVersion: cfg.similarityPolicyVersion,
      representativePolicy: cfg.representativePolicy
    })
    await writeJsonl(groupsPath, singletonGroups)
    await writeJson(summaryPath, summary)
    return {
      step: "C2",
      indexPath,
      groupsPath,
      summaryPath,
      summary
    }
  }

  const rankedFamilies = inputFamilyIds
    .map((familyId) => ({
      familyId,
      result: resultByFamilyId.get(familyId) ?? {}
    }))
    .sort((left, right) => Number(right?.result?.familyQualityScore ?? 0) - Number(left?.result?.familyQualityScore ?? 0))
  const pairwiseFamilyIds = rankedFamilies.slice(0, cfg.maxFamiliesForPairwise).map((row) => row.familyId)
  const overflowFamilyIds = rankedFamilies.slice(cfg.maxFamiliesForPairwise).map((row) => row.familyId)
  const adjacency = new Map(pairwiseFamilyIds.map((familyId) => [familyId, new Set()]))
  const overlapRows = []

  for (let i = 0; i < pairwiseFamilyIds.length; i += 1) {
    for (let j = i + 1; j < pairwiseFamilyIds.length; j += 1) {
      const leftFamilyId = pairwiseFamilyIds[i]
      const rightFamilyId = pairwiseFamilyIds[j]
      const left = {
        familyId: leftFamilyId,
        footprint: footprintByFamilyId.get(leftFamilyId) ?? null
      }
      const right = {
        familyId: rightFamilyId,
        footprint: footprintByFamilyId.get(rightFamilyId) ?? null
      }
      const overlap = computeFamilyOverlap(left, right, cfg)
      overlapRows.push(overlap)
      if (overlap.qualifies) {
        adjacency.get(leftFamilyId)?.add(rightFamilyId)
        adjacency.get(rightFamilyId)?.add(leftFamilyId)
      }
    }
  }

  const components = clusterDedupFamilies({
    familyIds: pairwiseFamilyIds,
    adjacency
  })
  const groups = []
  components.forEach((groupFamilyIds, index) => {
    const representative = selectRepresentativeFamily({
      groupFamilyIds,
      resultByFamilyId,
      cfg
    })
    const representativeFamilyId = String(representative?.familyId ?? groupFamilyIds[0] ?? "").trim() || null
    const shadowFamilyIds = groupFamilyIds.filter((familyId) => familyId !== representativeFamilyId)
    const groupOverlaps = overlapRows.filter(
      (row) => groupFamilyIds.includes(row.leftFamilyId) && groupFamilyIds.includes(row.rightFamilyId),
    )
    const representativeResult = resultByFamilyId.get(representativeFamilyId) ?? {}
    groups.push({
      groupId: `G${String(index + 1).padStart(3, "0")}`,
      memberFamilyIds: groupFamilyIds,
      representativeFamilyId,
      shadowFamilyIds: cfg.retainShadowFamilies ? shadowFamilyIds : [],
      groupSize: groupFamilyIds.length,
      avgDedupSimilarity: average(groupOverlaps.map((row) => row.dedupSimilarity)),
      maxDedupSimilarity: Math.max(0, ...groupOverlaps.map((row) => Number(row?.dedupSimilarity ?? 0) || 0)),
      dedupReason: groupFamilyIds.length > 1 ? "OVERLAP_GRAPH_COMPONENT" : "SINGLETON",
      fallbackGroup: false,
      representativeScore: computeRepresentativeScore({ result: representativeResult, cfg }),
      representativeSelectionHitAt1Eval: resolveRepresentativeRankMetric(representativeResult),
      representativeSelectionHitAt1MetricSource: resolveRepresentativeRankMetricSource(
        representativeResult,
      ),
      representativeTargetHitRateEval: Number(representativeResult?.targetHitRateEval ?? 0) || 0,
      representativeExecutedTargetHitRateEval:
        Number(representativeResult?.executedTargetHitRateEval ?? 0) || 0,
      representativeTargetsPer20EvalDays: Number(representativeResult?.targetsPer20EvalDays ?? 0) || 0,
      representativeExecutionCoverageEval: Number(representativeResult?.executionCoverageEval ?? 0) || 0,
      representativePrototypeQualityMedian:
        Number(representativeResult?.c0PrototypeQualityMedian ?? 0) || 0,
      representativePrototypeLedgerMatchedCount:
        Number(representativeResult?.c0PrototypeLedgerMatchedCount ?? 0) || 0,
      representativePrototypeLedgerCoverage:
        Number(representativeResult?.c0PrototypeLedgerCoverage ?? 0) || 0,
      representativeCorePrototypeShare:
        Number(representativeResult?.c0CorePrototypeShare ?? 0) || 0,
      representativePenaltyPrototypeShare:
        Number(representativeResult?.c0PenaltyPrototypeShare ?? 0) || 0,
      representativeQuarantinePrototypeShare:
        Number(representativeResult?.c0QuarantinePrototypeShare ?? 0) || 0,
      representativeRetiredPrototypeShare:
        Number(representativeResult?.c0RetiredPrototypeShare ?? 0) || 0,
      representativePrototypeLedgerConfidenceMean:
        Number(representativeResult?.c0PrototypeLedgerConfidenceMean ?? 0) || 0
    })
  })

  overflowFamilyIds.forEach((familyId, index) => {
    const representativeResult = resultByFamilyId.get(familyId) ?? {}
    groups.push({
      groupId: `GX${String(index + 1).padStart(3, "0")}`,
      memberFamilyIds: [familyId],
      representativeFamilyId: familyId,
      shadowFamilyIds: [],
      groupSize: 1,
      avgDedupSimilarity: 0,
      maxDedupSimilarity: 0,
      dedupReason: "PAIRWISE_LIMIT_BYPASS",
      fallbackGroup: false,
      representativeScore: computeRepresentativeScore({ result: representativeResult, cfg }),
      representativeSelectionHitAt1Eval: resolveRepresentativeRankMetric(representativeResult),
      representativeSelectionHitAt1MetricSource: resolveRepresentativeRankMetricSource(
        representativeResult,
      ),
      representativeTargetHitRateEval: Number(representativeResult?.targetHitRateEval ?? 0) || 0,
      representativeExecutedTargetHitRateEval:
        Number(representativeResult?.executedTargetHitRateEval ?? 0) || 0,
      representativeTargetsPer20EvalDays: Number(representativeResult?.targetsPer20EvalDays ?? 0) || 0,
      representativeExecutionCoverageEval: Number(representativeResult?.executionCoverageEval ?? 0) || 0,
      representativePrototypeQualityMedian:
        Number(representativeResult?.c0PrototypeQualityMedian ?? 0) || 0,
      representativePrototypeLedgerMatchedCount:
        Number(representativeResult?.c0PrototypeLedgerMatchedCount ?? 0) || 0,
      representativePrototypeLedgerCoverage:
        Number(representativeResult?.c0PrototypeLedgerCoverage ?? 0) || 0,
      representativeCorePrototypeShare:
        Number(representativeResult?.c0CorePrototypeShare ?? 0) || 0,
      representativePenaltyPrototypeShare:
        Number(representativeResult?.c0PenaltyPrototypeShare ?? 0) || 0,
      representativeQuarantinePrototypeShare:
        Number(representativeResult?.c0QuarantinePrototypeShare ?? 0) || 0,
      representativeRetiredPrototypeShare:
        Number(representativeResult?.c0RetiredPrototypeShare ?? 0) || 0,
      representativePrototypeLedgerConfidenceMean:
        Number(representativeResult?.c0PrototypeLedgerConfidenceMean ?? 0) || 0
    })
  })

  let representativeFamilyIds = groups
    .map((row) => String(row?.representativeFamilyId ?? "").trim())
    .filter(Boolean)
  let shadowFamilyIds = groups.flatMap((row) => row?.shadowFamilyIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)
  let fallbackUsed = false
  let gateReason = "PASS"
  if (representativeFamilyIds.length < cfg.minRepresentativeFamilies && cfg.fallbackToC1IfTooSmall) {
    representativeFamilyIds = inputFamilyIds.slice()
    shadowFamilyIds = []
    fallbackUsed = true
    gateReason = "FALLBACK_TO_C1"
  }
  const gate = {
    enabled: true,
    failed: representativeFamilyIds.length < 1,
    reason: representativeFamilyIds.length < 1 ? "NO_REPRESENTATIVES" : gateReason,
    fallbackUsed
  }
  const summary = {
    step: "C2",
    enabled: true,
    inputFamilies: inputFamilyIds.length,
    dedupedGroups: groups.length,
    representativeFamilies: representativeFamilyIds.length,
    shadowFamilies: shadowFamilyIds.length,
    fallbackUsed,
    gate,
    representativeCoverageGuard: {
      minTargetsPer20EvalDays: cfg.minRepresentativeTargetsPer20EvalDays,
      minExecutionCoverageEval: cfg.minRepresentativeExecutionCoverageEval,
      minRepresentativeScoreFloor: cfg.minRepresentativeScoreFloor
    },
    similarityPolicyVersion: cfg.similarityPolicyVersion,
    representativePolicy: cfg.representativePolicy
  }
  const indexPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    inputPassedFamilyCount: inputFamilyIds.length,
    dedupedFamilyCount: groups.length,
    representativeFamilyCount: representativeFamilyIds.length,
    shadowFamilyCount: shadowFamilyIds.length,
    fallbackUsed,
    representativeFamilyIds,
    shadowFamilyIds,
    groupsPath,
    gate,
    similarityPolicyVersion: cfg.similarityPolicyVersion,
    representativePolicy: cfg.representativePolicy
  }
  await writeJson(indexPath, indexPayload)
  await writeJsonl(groupsPath, groups)
  await writeJson(summaryPath, summary)
  return {
    step: "C2",
    indexPath,
    groupsPath,
    summaryPath,
    summary
  }
}
