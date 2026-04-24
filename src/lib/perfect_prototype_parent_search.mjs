const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const clampInt = (value, fallback, min, max) => {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const sortTokenEntries = (entries) =>
  (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return String(left.token).localeCompare(String(right.token))
    })

const candidateKey = (clusterId, tokens) =>
  `${String(clusterId ?? "").trim()}::${uniqueSorted(tokens).join("||")}`

const toComparableGap = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

export const DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS = Object.freeze({
  minSupportRatio: 0.5,
  maxRuleSize: 6,
  beamSize: 8,
  maxRounds: 4,
  maxSeedChildRulesPerCluster: 8,
  maxAddTokensPerCandidate: 6,
  maxDropTokensPerCandidate: 3,
  maxSwapTokensPerCandidate: 4,
  stagnationRounds: 2,
})

export const normalizeNegativeFirstParentSearchOptions = (options = {}) => ({
  ...DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS,
  ...options,
  maxRuleSize: clampInt(options?.maxRuleSize, DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxRuleSize, 1, 8),
  beamSize: clampInt(options?.beamSize, DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.beamSize, 1, 32),
  maxRounds: clampInt(options?.maxRounds, DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxRounds, 1, 12),
  maxSeedChildRulesPerCluster: clampInt(
    options?.maxSeedChildRulesPerCluster,
    DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxSeedChildRulesPerCluster,
    1,
    32,
  ),
  maxAddTokensPerCandidate: clampInt(
    options?.maxAddTokensPerCandidate,
    DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxAddTokensPerCandidate,
    1,
    24,
  ),
  maxDropTokensPerCandidate: clampInt(
    options?.maxDropTokensPerCandidate,
    DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxDropTokensPerCandidate,
    1,
    12,
  ),
  maxSwapTokensPerCandidate: clampInt(
    options?.maxSwapTokensPerCandidate,
    DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.maxSwapTokensPerCandidate,
    1,
    24,
  ),
  stagnationRounds: clampInt(
    options?.stagnationRounds,
    DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.stagnationRounds,
    1,
    8,
  ),
  minSupportRatio: Number.isFinite(Number(options?.minSupportRatio))
    ? Math.max(0.1, Math.min(1, Number(options.minSupportRatio)))
    : DEFAULT_NEGATIVE_FIRST_PARENT_SEARCH_OPTIONS.minSupportRatio,
})

const compareChildEvaluations = (left, right) => {
  const leftHits = Number(left?.positiveMatchCount ?? 0)
  const rightHits = Number(right?.positiveMatchCount ?? 0)
  if (rightHits !== leftHits) return rightHits - leftHits
  const leftNegatives = Number(left?.negativeMatchCount ?? 0)
  const rightNegatives = Number(right?.negativeMatchCount ?? 0)
  if (leftNegatives !== rightNegatives) return leftNegatives - rightNegatives
  const leftSize = Array.isArray(left?.tokens) ? left.tokens.length : Number.POSITIVE_INFINITY
  const rightSize = Array.isArray(right?.tokens) ? right.tokens.length : Number.POSITIVE_INFINITY
  if (leftSize !== rightSize) return leftSize - rightSize
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

const compareSearchResults = (left, right) => {
  const leftValidationNegatives = Number(left?.validationMetrics?.negativeCount ?? Number.POSITIVE_INFINITY)
  const rightValidationNegatives = Number(right?.validationMetrics?.negativeCount ?? Number.POSITIVE_INFINITY)
  if (leftValidationNegatives !== rightValidationNegatives) {
    return leftValidationNegatives - rightValidationNegatives
  }
  const leftValidationGap = toComparableGap(left?.validationMetrics?.maxGapTradingDays)
  const rightValidationGap = toComparableGap(right?.validationMetrics?.maxGapTradingDays)
  if (leftValidationGap !== rightValidationGap) return leftValidationGap - rightValidationGap
  const leftValidationDates = Number(left?.validationMetrics?.matchedDateCount ?? 0)
  const rightValidationDates = Number(right?.validationMetrics?.matchedDateCount ?? 0)
  if (rightValidationDates !== leftValidationDates) return rightValidationDates - leftValidationDates
  const leftSearchHits = Number(left?.searchMetrics?.hitCount ?? 0)
  const rightSearchHits = Number(right?.searchMetrics?.hitCount ?? 0)
  if (rightSearchHits !== leftSearchHits) return rightSearchHits - leftSearchHits
  const leftSearchNegatives = Number(left?.searchMetrics?.negativeCount ?? Number.POSITIVE_INFINITY)
  const rightSearchNegatives = Number(right?.searchMetrics?.negativeCount ?? Number.POSITIVE_INFINITY)
  if (leftSearchNegatives !== rightSearchNegatives) return leftSearchNegatives - rightSearchNegatives
  const leftSize = Number(left?.ruleSize ?? Number.POSITIVE_INFINITY)
  const rightSize = Number(right?.ruleSize ?? Number.POSITIVE_INFINITY)
  if (leftSize !== rightSize) return leftSize - rightSize
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

const createClusterCandidate = ({
  clusterId,
  tokens,
  sourceChildRuleIds,
  operation,
  generation,
  parentTokenSupport,
}) => ({
  clusterId,
  tokens: uniqueSorted(tokens),
  sourceChildRuleIds: uniqueSorted(sourceChildRuleIds),
  operation,
  generation,
  key: candidateKey(clusterId, tokens),
  parentTokenSupport,
})

const selectTopTokensBySupport = ({ tokenSupportEntries, existingTokens, limit }) => {
  const existing = new Set(Array.isArray(existingTokens) ? existingTokens : [])
  return sortTokenEntries(tokenSupportEntries)
    .filter((entry) => !existing.has(entry.token))
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((entry) => entry.token)
}

const selectLowSupportTokens = ({ tokenSupportMap, tokens, limit }) =>
  uniqueSorted(tokens)
    .map((token) => ({
      token,
      count: Number(tokenSupportMap.get(token) ?? 0),
    }))
    .sort((left, right) => {
      if (left.count !== right.count) return left.count - right.count
      return String(left.token).localeCompare(String(right.token))
    })
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((entry) => entry.token)

const generateDropNeighbors = ({ state, clusterPlan, options }) => {
  if ((state?.tokens?.length ?? 0) <= 1) return []
  const removableTokens = selectLowSupportTokens({
    tokenSupportMap: clusterPlan.tokenSupportMap,
    tokens: state.tokens,
    limit: options.maxDropTokensPerCandidate,
  })
  return removableTokens.map((token) =>
    createClusterCandidate({
      clusterId: clusterPlan.clusterId,
      tokens: state.tokens.filter((value) => value !== token),
      sourceChildRuleIds: state.sourceChildRuleIds,
      operation: "drop",
      generation: Number(state.generation ?? 0) + 1,
      parentTokenSupport: clusterPlan.tokenSupportEntries,
    }),
  )
}

const generateAddNeighbors = ({ state, clusterPlan, options }) => {
  if ((state?.tokens?.length ?? 0) >= options.maxRuleSize) return []
  const addTokens = selectTopTokensBySupport({
    tokenSupportEntries: clusterPlan.tokenSupportEntries,
    existingTokens: state.tokens,
    limit: options.maxAddTokensPerCandidate,
  })
  return addTokens.map((token) =>
    createClusterCandidate({
      clusterId: clusterPlan.clusterId,
      tokens: [...state.tokens, token],
      sourceChildRuleIds: state.sourceChildRuleIds,
      operation: "add",
      generation: Number(state.generation ?? 0) + 1,
      parentTokenSupport: clusterPlan.tokenSupportEntries,
    }),
  )
}

const generateSwapNeighbors = ({ state, clusterPlan, options }) => {
  const removableTokens = selectLowSupportTokens({
    tokenSupportMap: clusterPlan.tokenSupportMap,
    tokens: state.tokens,
    limit: options.maxDropTokensPerCandidate,
  })
  const addTokens = selectTopTokensBySupport({
    tokenSupportEntries: clusterPlan.tokenSupportEntries,
    existingTokens: state.tokens,
    limit: options.maxSwapTokensPerCandidate,
  })
  const out = []
  for (const removeToken of removableTokens) {
    for (const addToken of addTokens) {
      const nextTokens = state.tokens.filter((token) => token !== removeToken)
      nextTokens.push(addToken)
      out.push(
        createClusterCandidate({
          clusterId: clusterPlan.clusterId,
          tokens: nextTokens,
          sourceChildRuleIds: state.sourceChildRuleIds,
          operation: "swap",
          generation: Number(state.generation ?? 0) + 1,
          parentTokenSupport: clusterPlan.tokenSupportEntries,
        }),
      )
    }
  }
  return out
}

export const buildNegativeFirstParentClusterPlans = ({
  childClusters,
  childRulesById,
  childEvaluationLookup,
  options = {},
}) => {
  const cfg = normalizeNegativeFirstParentSearchOptions(options)
  return (Array.isArray(childClusters) ? childClusters : []).map((cluster) => {
    const childRuleIds = uniqueSorted(cluster?.childRuleIds ?? [])
    const childEvaluations = childRuleIds
      .map((ruleId) => childEvaluationLookup.get(ruleId))
      .filter(Boolean)
      .sort(compareChildEvaluations)
    const tokenSupportMap = new Map()
    for (const ruleId of childRuleIds) {
      const childRule = childRulesById.get(ruleId)
      for (const token of childRule?.tokens ?? []) {
        tokenSupportMap.set(token, Number(tokenSupportMap.get(token) ?? 0) + 1)
      }
    }
    const tokenSupportEntries = sortTokenEntries(
      Array.from(tokenSupportMap.entries()).map(([token, count]) => ({ token, count })),
    )
    const seedCandidates = []
    for (const evaluation of childEvaluations.slice(0, cfg.maxSeedChildRulesPerCluster)) {
      seedCandidates.push(
        createClusterCandidate({
          clusterId: cluster.clusterId,
          tokens: evaluation.tokens,
          sourceChildRuleIds: [evaluation.ruleId],
          operation: "seed_child",
          generation: 0,
          parentTokenSupport: tokenSupportEntries,
        }),
      )
    }
    const supportRatios = uniqueSorted([1, 0.75, cfg.minSupportRatio].filter((value) => Number(value) > 0))
      .map((value) => Number(value))
      .sort((left, right) => right - left)
    for (const ratio of supportRatios) {
      const minCount = Math.max(1, Math.ceil(childRuleIds.length * ratio))
      const tokens = tokenSupportEntries
        .filter((entry) => entry.count >= minCount)
        .map((entry) => entry.token)
        .slice(0, cfg.maxRuleSize)
      if (tokens.length < 1) continue
      seedCandidates.push(
        createClusterCandidate({
          clusterId: cluster.clusterId,
          tokens,
          sourceChildRuleIds: childRuleIds,
          operation: `seed_support_${ratio}`,
          generation: 0,
          parentTokenSupport: tokenSupportEntries,
        }),
      )
    }
    const seedMap = new Map()
    for (const candidate of seedCandidates) {
      if (!candidate.tokens.length) continue
      seedMap.set(candidate.key, candidate)
    }
    return {
      clusterId: String(cluster?.clusterId ?? "").trim(),
      childRuleIds,
      childEvaluations,
      tokenSupportEntries,
      tokenSupportMap,
      seedCandidates: Array.from(seedMap.values()),
    }
  })
}

export const createNegativeFirstParentSearchState = (candidate) => ({
  ...candidate,
  metrics: null,
})

export const rankNegativeFirstParentSearchStates = (states) =>
  (Array.isArray(states) ? states : [])
    .slice()
    .sort((left, right) => compareSearchResults(left?.metrics ?? {}, right?.metrics ?? {}))

export const generateNegativeFirstParentNeighbors = ({
  clusterPlan,
  state,
  options = {},
}) => {
  const cfg = normalizeNegativeFirstParentSearchOptions(options)
  const validationNegativeCount = Number(state?.metrics?.validationMetrics?.negativeCount ?? 0)
  const searchNegativeCount = Number(state?.metrics?.searchMetrics?.negativeCount ?? 0)
  const zeroNegatives = validationNegativeCount === 0 && searchNegativeCount === 0
  const out = []
  if (zeroNegatives) {
    out.push(...generateDropNeighbors({ state, clusterPlan, options: cfg }))
    out.push(...generateSwapNeighbors({ state, clusterPlan, options: cfg }).slice(0, cfg.maxDropTokensPerCandidate))
  } else {
    out.push(...generateAddNeighbors({ state, clusterPlan, options: cfg }))
    out.push(...generateSwapNeighbors({ state, clusterPlan, options: cfg }))
  }
  const deduped = new Map()
  for (const candidate of out) {
    if ((candidate?.tokens?.length ?? 0) < 1) continue
    if ((candidate?.tokens?.length ?? 0) > cfg.maxRuleSize) continue
    deduped.set(candidate.key, candidate)
  }
  return Array.from(deduped.values())
}

export const summarizeNegativeFirstParentSearchFailures = (states, options = {}) => {
  const ranked = rankNegativeFirstParentSearchStates(states)
  const best = ranked[0] ?? null
  const maxValidationGapTradingDays = clampInt(options?.maxValidationGapTradingDays, 40, 1, 9999)
  if (!best) {
    return {
      failureReason: "NO_CANDIDATES",
      bestCandidate: null,
    }
  }
  const validationNegatives = Number(best?.metrics?.validationMetrics?.negativeCount ?? 0)
  const validationGap = toComparableGap(best?.metrics?.validationMetrics?.maxGapTradingDays)
  if (validationNegatives > 0) {
    return {
      failureReason: "VALIDATION_NEGATIVES",
      bestCandidate: best,
    }
  }
  if (validationGap > maxValidationGapTradingDays) {
    return {
      failureReason: "VALIDATION_GAP",
      bestCandidate: best,
    }
  }
  return {
    failureReason: "VALIDATION_HIT_FLOOR",
    bestCandidate: best,
  }
}
