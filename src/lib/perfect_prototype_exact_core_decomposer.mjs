import { buildPerfectPrototypeExactCompletionCandidatePool } from "./perfect_prototype_exact_completion_candidate_pool.mjs"

const compareExactCores = (left, right) => {
  if (Number(right?.negativeEliminatedCount ?? 0) !== Number(left?.negativeEliminatedCount ?? 0)) {
    return Number(right?.negativeEliminatedCount ?? 0) - Number(left?.negativeEliminatedCount ?? 0)
  }
  if (
    Number(right?.entryPositiveHitStats?.distinctDateCount ?? 0) !==
    Number(left?.entryPositiveHitStats?.distinctDateCount ?? 0)
  ) {
    return (
      Number(right?.entryPositiveHitStats?.distinctDateCount ?? 0) -
      Number(left?.entryPositiveHitStats?.distinctDateCount ?? 0)
    )
  }
  if (
    Number(right?.entryPositiveHitStats?.matchedMonthCount ?? 0) !==
    Number(left?.entryPositiveHitStats?.matchedMonthCount ?? 0)
  ) {
    return (
      Number(right?.entryPositiveHitStats?.matchedMonthCount ?? 0) -
      Number(left?.entryPositiveHitStats?.matchedMonthCount ?? 0)
    )
  }
  if (
    Number(right?.entryPositiveHitStats?.matchedFoldCount ?? 0) !==
    Number(left?.entryPositiveHitStats?.matchedFoldCount ?? 0)
  ) {
    return (
      Number(right?.entryPositiveHitStats?.matchedFoldCount ?? 0) -
      Number(left?.entryPositiveHitStats?.matchedFoldCount ?? 0)
    )
  }
  if (Number(left?.positiveLossCount ?? 0) !== Number(right?.positiveLossCount ?? 0)) {
    return Number(left?.positiveLossCount ?? 0) - Number(right?.positiveLossCount ?? 0)
  }
  return String(left?.coreId ?? "").localeCompare(String(right?.coreId ?? ""))
}

const resolveFamilyExactCoreMinimums = ({
  familyId = null,
  cfg = null,
  familySearchMinHitCount = 1,
} = {}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  const isLowFamily = normalizedFamilyId.startsWith("low_")
  const minMatchedDates = Math.max(
    1,
    Number(
      isLowFamily
        ? cfg?.lowFamilyMinTrainMatchedDates
        : cfg?.minTrainMatchedDates,
    ) ||
      Number(familySearchMinHitCount ?? 1) ||
      1,
  )
  const minMatchedMonths = Math.max(
    1,
    Number(
      isLowFamily
        ? cfg?.lowFamilyMinTrainMatchedMonths
        : cfg?.minTrainMatchedMonths,
    ) || 1,
  )
  const minMatchedFolds = Math.max(
    1,
    Number(
      isLowFamily
        ? cfg?.lowFamilyMinTrainMatchedFolds
        : cfg?.minTrainMatchedFolds,
    ) || 1,
  )
  return {
    minMatchedDates,
    minMatchedMonths,
    minMatchedFolds,
  }
}

export const buildPerfectPrototypeExactCoreBreadthFloor = ({
  familyId = null,
  cfg = null,
  familySearchMinHitCount = 1,
} = {}) => {
  const minimums = resolveFamilyExactCoreMinimums({
    familyId,
    cfg,
    familySearchMinHitCount,
  })
  return {
    ...minimums,
    coverMatchedDates: 0,
    coverMatchedMonths: 0,
    coverMatchedFolds: 0,
    earlyDateRetentionRatio: 0,
    earlyMonthRetentionRatio: 0,
    earlyFoldRetentionRatio: 0,
  }
}

export const evaluatePerfectPrototypeExactCoreBreadthFloor = ({
  hitStats = null,
  exactCoreBreadthFloor = null,
} = {}) => {
  const minMatchedDates = Math.max(
    1,
    Number(exactCoreBreadthFloor?.minMatchedDates ?? 1) || 1,
  )
  const minMatchedMonths = Math.max(
    1,
    Number(exactCoreBreadthFloor?.minMatchedMonths ?? 1) || 1,
  )
  const minMatchedFolds = Math.max(
    1,
    Number(exactCoreBreadthFloor?.minMatchedFolds ?? 1) || 1,
  )
  if (Number(hitStats?.distinctDateCount ?? 0) < minMatchedDates) {
    return { ok: false, reason: "exact_core_dates_below_floor" }
  }
  if (Number(hitStats?.matchedMonthCount ?? 0) < minMatchedMonths) {
    return { ok: false, reason: "exact_core_months_below_floor" }
  }
  if (Number(hitStats?.matchedFoldCount ?? 0) < minMatchedFolds) {
    return { ok: false, reason: "exact_core_folds_below_floor" }
  }
  return { ok: true }
}

export const decomposePerfectPrototypeExactCores = async ({
  familyId = null,
  manifest = null,
  entryState = null,
  cfg = null,
  selectedSeedCount = 0,
  seedTokensOrdered = [],
  seedPositiveCounts = null,
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  familySearchMinHitCount = 1,
  candidateTokenPredicate = null,
  maxCandidates = 24,
  maxCores = 6,
} = {}) => {
  const exactCoreBreadthFloor = buildPerfectPrototypeExactCoreBreadthFloor({
    familyId,
    cfg,
    familySearchMinHitCount,
  })
  const poolResult = await buildPerfectPrototypeExactCompletionCandidatePool({
    tokens: Array.isArray(entryState?.entrySeedTokens) ? entryState.entrySeedTokens : [],
    excludedSeedIndexes: new Set(
      Array.isArray(entryState?.entrySeedIndexes) ? entryState.entrySeedIndexes : [],
    ),
    minCandidateSeedIndex: Number(entryState?.nextStartAt ?? 0) || 0,
    selectedSeedCount,
    seedTokensOrdered,
    seedPositiveCounts,
    seedPostingCache,
    currentPositiveRowset: entryState?.positiveRowset ?? null,
    currentNegativeRowset: entryState?.negativeRowset ?? null,
    currentPositiveHitStats: entryState?.positiveHitStats ?? null,
    rowCount,
    computePositiveHitStats,
    familySearchMinHitCount,
    generalizedSubgroupBreadthFloor: exactCoreBreadthFloor,
    evaluateBreadthFloor: ({ hitStats, generalizedSubgroupBreadthFloor }) =>
      evaluatePerfectPrototypeExactCoreBreadthFloor({
        hitStats,
        exactCoreBreadthFloor: generalizedSubgroupBreadthFloor,
      }),
    candidateTokenPredicate,
    maxCandidates: Math.max(
      maxCandidates,
      Math.max(1, Number(maxCores ?? 1) || 1) * 2,
    ),
  })

  const coreCandidates = (Array.isArray(poolResult?.candidates) ? poolResult.candidates : [])
    .map((candidate, index) => ({
      coreId:
        `${String(manifest?.subgroupId ?? "subgroup").trim() || "subgroup"}::core::${String(
          candidate?.seedIndex ?? index,
        ).padStart(3, "0")}`,
      familyId: String(familyId ?? "").trim() || null,
      manifestSubgroupId: manifest?.subgroupId ?? null,
      seedIndex: Number(candidate?.seedIndex ?? -1),
      seedToken: String(candidate?.token ?? "").trim() || null,
      entrySeedTokens: [
        ...(Array.isArray(entryState?.entrySeedTokens) ? entryState.entrySeedTokens : []),
        String(candidate?.token ?? "").trim(),
      ].filter(Boolean),
      entrySeedIndexes: [
        ...(Array.isArray(entryState?.entrySeedIndexes) ? entryState.entrySeedIndexes : []),
        Number(candidate?.seedIndex ?? -1),
      ].filter((value) => Number.isInteger(value) && value >= 0),
      positiveRowset: candidate?.nextPositiveRowset ?? null,
      positiveRowIndexes: candidate?.nextPositiveRowIndexes ?? null,
      positiveHitStats: candidate?.nextPositiveHitStats ?? null,
      negativeRowset: candidate?.nextNegativeRowset ?? null,
      negativeRowIndexes: candidate?.nextNegativeRowIndexes ?? null,
      entryPositiveHitStats: candidate?.nextPositiveHitStats ?? null,
      entryMatchedDateCount: Number(candidate?.nextPositiveHitStats?.distinctDateCount ?? 0) || 0,
      entryMatchedMonthCount: Number(candidate?.nextPositiveHitStats?.matchedMonthCount ?? 0) || 0,
      entryMatchedFoldCount: Number(candidate?.nextPositiveHitStats?.matchedFoldCount ?? 0) || 0,
      negativeEliminatedCount: Number(candidate?.negativeEliminatedCount ?? 0) || 0,
      positiveLossCount: Number(candidate?.positiveLossCount ?? 0) || 0,
      score: Number(candidate?.score ?? Number.NEGATIVE_INFINITY),
      entryBreadthFloor: exactCoreBreadthFloor,
    }))
    .filter((candidate) => candidate.seedToken)
    .sort(compareExactCores)

  const qualifiedCores = coreCandidates.slice(
    0,
    Math.max(1, Number(maxCores ?? 1) || 1),
  )

  return {
    ok: qualifiedCores.length > 0,
    familyId: String(familyId ?? "").trim() || null,
    subgroupId: manifest?.subgroupId ?? null,
    exactCoreBreadthFloor,
    exactCoreCandidateCount: coreCandidates.length,
    exactCoreQualifiedCount: qualifiedCores.length,
    candidatePoolSize: (Array.isArray(poolResult?.candidates) ? poolResult.candidates.length : 0),
    negativeFrontierSize: Number(poolResult?.frontierNegativeCount ?? 0) || 0,
    rejectReasonCounts:
      poolResult?.rejectReasonCounts && typeof poolResult.rejectReasonCounts === "object"
        ? poolResult.rejectReasonCounts
        : {},
    cores: qualifiedCores,
  }
}
