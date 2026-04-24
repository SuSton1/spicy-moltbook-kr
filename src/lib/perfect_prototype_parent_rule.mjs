import crypto from "node:crypto"

import { computePerfectPrototypeGapStats, matchPerfectPrototypeRule } from "./perfect_prototype_rule.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const safeRate = (numValue, denValue) => {
  const numerator = Number(numValue)
  const denominator = Number(denValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

const buildParentRuleId = (tokens) => {
  const normalized = uniqueSorted(tokens)
  const hash = crypto.createHash("sha1").update(normalized.join("||")).digest("hex").slice(0, 12)
  return `PPR_${hash}`
}

export const resolvePerfectPrototypeRowPartition = (dateKey, split = {}) => {
  const key = String(dateKey ?? "").trim()
  if (!key) return null
  const searchStart = String(split?.searchStart ?? "").trim()
  const searchEnd = String(split?.searchEnd ?? "").trim()
  const validationStart = String(split?.validationStart ?? "").trim()
  const validationEnd = String(split?.validationEnd ?? "").trim()
  const oosStart = String(split?.oosStart ?? "").trim()
  const oosEnd = String(split?.oosEnd ?? "").trim()
  if (searchStart && key >= searchStart && searchEnd && key <= searchEnd) return "search"
  if (validationStart && key >= validationStart && validationEnd && key <= validationEnd) return "validation"
  if (oosStart && key >= oosStart && (!oosEnd || key <= oosEnd)) return "oos"
  return null
}

export const splitPerfectPrototypeRows = (rows, split) => {
  const out = {
    search: [],
    validation: [],
    oos: [],
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const partition = resolvePerfectPrototypeRowPartition(row?.dateKey, split)
    if (!partition) continue
    out[partition].push(row)
  }
  return out
}

const evaluateCandidateAgainstRows = ({ tokens, rows, calendarDateKeys }) => {
  const normalizedTokens = uniqueSorted(tokens)
  const positiveDates = []
  const matchedSymbols = new Set()
  const sampleMatchIds = []
  let matchCount = 0
  let hitCount = 0
  let negativeCount = 0

  for (const row of Array.isArray(rows) ? rows : []) {
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.tokens ?? [])
    if (!matchPerfectPrototypeRule(tokenSet, { tokens: normalizedTokens })) continue
    matchCount += 1
    if (sampleMatchIds.length < 20 && row?.sourceId) sampleMatchIds.push(row.sourceId)
    if (row?.outcomeHitTarget === true) {
      hitCount += 1
      if (row?.dateKey) positiveDates.push(String(row.dateKey))
      if (row?.symbol) matchedSymbols.add(String(row.symbol))
    } else if (row?.outcomeHitTarget === false) {
      negativeCount += 1
    }
  }

  const gapStats = computePerfectPrototypeGapStats({
    dateKeys: positiveDates,
    calendarDateKeys,
  })

  return {
    matchCount,
    hitCount,
    negativeCount,
    precision: safeRate(hitCount, matchCount),
    matchedDateCount: gapStats.hitDates.length,
    maxGapTradingDays: gapStats.maxGapTradingDays,
    firstHitDate: gapStats.hitDates[0] ?? null,
    lastHitDate: gapStats.hitDates[gapStats.hitDates.length - 1] ?? null,
    matchedSymbolCount: matchedSymbols.size,
    matchedSymbols: uniqueSorted(Array.from(matchedSymbols)),
    sampleMatchIds: uniqueSorted(sampleMatchIds),
  }
}

const createMetricsAccumulator = () => ({
  matchCount: 0,
  hitCount: 0,
  negativeCount: 0,
  positiveDates: [],
  matchedSymbols: new Set(),
  sampleMatchIds: [],
})

const updateMetricsAccumulator = (accumulator, row) => {
  accumulator.matchCount += 1
  if (accumulator.sampleMatchIds.length < 20 && row?.sourceId) {
    accumulator.sampleMatchIds.push(String(row.sourceId))
  }
  if (row?.outcomeHitTarget === true) {
    accumulator.hitCount += 1
    if (row?.dateKey) accumulator.positiveDates.push(String(row.dateKey))
    if (row?.symbol) accumulator.matchedSymbols.add(String(row.symbol))
  } else if (row?.outcomeHitTarget === false) {
    accumulator.negativeCount += 1
  }
}

const finalizeMetricsAccumulator = (accumulator, calendarDateKeys) => {
  const gapStats = computePerfectPrototypeGapStats({
    dateKeys: accumulator.positiveDates,
    calendarDateKeys,
  })
  return {
    matchCount: accumulator.matchCount,
    hitCount: accumulator.hitCount,
    negativeCount: accumulator.negativeCount,
    precision: safeRate(accumulator.hitCount, accumulator.matchCount),
    matchedDateCount: gapStats.hitDates.length,
    maxGapTradingDays: gapStats.maxGapTradingDays,
    firstHitDate: gapStats.hitDates[0] ?? null,
    lastHitDate: gapStats.hitDates[gapStats.hitDates.length - 1] ?? null,
    matchedSymbolCount: accumulator.matchedSymbols.size,
    matchedSymbols: uniqueSorted(Array.from(accumulator.matchedSymbols)),
    sampleMatchIds: uniqueSorted(accumulator.sampleMatchIds),
  }
}

const evaluateParentCandidate = ({ candidate, partitions, split, options }) => {
  const searchCalendar = uniqueSorted(partitions.search.map((row) => row.dateKey).filter(Boolean))
  const validationCalendar = uniqueSorted(partitions.validation.map((row) => row.dateKey).filter(Boolean))
  const oosCalendar = uniqueSorted(partitions.oos.map((row) => row.dateKey).filter(Boolean))
  const searchMetrics = evaluateCandidateAgainstRows({
    tokens: candidate.tokens,
    rows: partitions.search,
    calendarDateKeys: searchCalendar,
  })
  const validationMetrics = evaluateCandidateAgainstRows({
    tokens: candidate.tokens,
    rows: partitions.validation,
    calendarDateKeys: validationCalendar,
  })
  const oosMetrics = evaluateCandidateAgainstRows({
    tokens: candidate.tokens,
    rows: partitions.oos,
    calendarDateKeys: oosCalendar,
  })

  const minSearchHits = Math.max(1, Number(options?.minSearchHits ?? 6) || 6)
  const minValidationHits = Math.max(1, Number(options?.minValidationHits ?? 2) || 2)
  const maxValidationGap = Math.max(1, Number(options?.maxValidationGapTradingDays ?? 40) || 40)

  const searchPassed =
    searchMetrics.negativeCount === 0 &&
    searchMetrics.hitCount >= minSearchHits
  const validationWindowExists =
    !!String(split?.validationStart ?? "").trim() && !!String(split?.validationEnd ?? "").trim()
  const validationPassed = validationWindowExists
    ? validationMetrics.negativeCount === 0 &&
      validationMetrics.hitCount >= minValidationHits &&
      Number(validationMetrics.maxGapTradingDays ?? Number.POSITIVE_INFINITY) <= maxValidationGap
    : false
  const oosWindowExists = !!String(split?.oosStart ?? "").trim()
  const oosPassed = oosWindowExists
    ? oosMetrics.negativeCount === 0 && oosMetrics.hitCount >= Math.max(1, Number(options?.minOosHits ?? 2) || 2)
    : false

  return {
    ruleId: buildParentRuleId(candidate.tokens),
    ruleLevel: "parent",
    tokens: candidate.tokens,
    ruleSize: candidate.tokens.length,
    overlapClusterId: candidate.overlapClusterId,
    sourceChildRuleIds: candidate.sourceChildRuleIds,
    sourceChildRuleCount: candidate.sourceChildRuleIds.length,
    supportRatio: candidate.supportRatio,
    searchMetrics,
    validationMetrics,
    oosMetrics,
    trainMatchCount: searchMetrics.matchCount,
    trainHitCount: searchMetrics.hitCount,
    trainNegativeCount: searchMetrics.negativeCount,
    precision: validationPassed ? validationMetrics.precision : searchMetrics.precision,
    matchedDateCount: validationPassed ? validationMetrics.matchedDateCount : searchMetrics.matchedDateCount,
    maxGapTradingDays:
      validationPassed && Number.isFinite(Number(validationMetrics.maxGapTradingDays))
        ? validationMetrics.maxGapTradingDays
        : searchMetrics.maxGapTradingDays,
    matchedSymbolCount:
      validationPassed && validationMetrics.matchedSymbolCount > 0
        ? validationMetrics.matchedSymbolCount
        : searchMetrics.matchedSymbolCount,
    promotionStatus: validationPassed ? "validated" : searchPassed ? "candidate" : "rejected",
    statusFlags: {
      searchPassed,
      validationPassed,
      oosPassed,
    },
  }
}

const compareParentRules = (left, right) => {
  const leftValidationDates = Number(left?.validationMetrics?.matchedDateCount ?? 0)
  const rightValidationDates = Number(right?.validationMetrics?.matchedDateCount ?? 0)
  if (rightValidationDates !== leftValidationDates) return rightValidationDates - leftValidationDates
  const leftSearchDates = Number(left?.searchMetrics?.matchedDateCount ?? 0)
  const rightSearchDates = Number(right?.searchMetrics?.matchedDateCount ?? 0)
  if (rightSearchDates !== leftSearchDates) return rightSearchDates - leftSearchDates
  const leftGap = Number(left?.maxGapTradingDays ?? Number.POSITIVE_INFINITY)
  const rightGap = Number(right?.maxGapTradingDays ?? Number.POSITIVE_INFINITY)
  if (leftGap !== rightGap) return leftGap - rightGap
  const leftHits = Number(left?.trainHitCount ?? 0)
  const rightHits = Number(right?.trainHitCount ?? 0)
  if (rightHits !== leftHits) return rightHits - leftHits
  if (left?.ruleSize !== right?.ruleSize) return left.ruleSize - right.ruleSize
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

export const rankPerfectPrototypeParentRules = (rules) =>
  (Array.isArray(rules) ? rules : [])
    .slice()
    .sort(compareParentRules)
    .map((rule, index) => ({
      ...rule,
      rank: index + 1,
    }))

export const buildPerfectPrototypeParentCandidates = ({
  clusters,
  childRulesById,
  minSupportRatio = 0.5,
  maxRuleSize = 6,
}) => {
  const supportRatios = uniqueSorted([1, 0.75, minSupportRatio].filter((value) => Number(value) > 0))
    .map((value) => Number(value))
    .sort((left, right) => right - left)
  const deduped = new Map()

  for (const cluster of Array.isArray(clusters) ? clusters : []) {
    const childRuleIds = Array.isArray(cluster?.childRuleIds) ? cluster.childRuleIds : []
    if (childRuleIds.length < 1) continue
    const tokenCounts = new Map()
    for (const childRuleId of childRuleIds) {
      const childRule = childRulesById.get(childRuleId)
      for (const token of childRule?.tokens ?? []) {
        tokenCounts.set(token, Number(tokenCounts.get(token) ?? 0) + 1)
      }
    }
    for (const ratio of supportRatios) {
      const minCount = Math.max(1, Math.ceil(childRuleIds.length * ratio))
      const tokens = Array.from(tokenCounts.entries())
        .filter(([, count]) => count >= minCount)
        .map(([token]) => token)
        .sort((left, right) => String(left).localeCompare(String(right)))
        .slice(0, maxRuleSize)
      if (tokens.length < 1) continue
      const key = tokens.join("||")
      if (deduped.has(key)) continue
      deduped.set(key, {
        tokens,
        overlapClusterId: String(cluster.clusterId ?? "").trim() || null,
        sourceChildRuleIds: childRuleIds.slice(),
        supportRatio: ratio,
      })
    }
  }

  return Array.from(deduped.values())
}

export const createPerfectPrototypeParentRuleAccumulator = (candidate) => ({
  candidate,
  search: createMetricsAccumulator(),
  validation: createMetricsAccumulator(),
  oos: createMetricsAccumulator(),
})

export const updatePerfectPrototypeParentRuleAccumulator = (accumulator, row, partition) => {
  if (!partition) return false
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.tokens ?? [])
  if (!matchPerfectPrototypeRule(tokenSet, { tokens: accumulator?.candidate?.tokens ?? [] })) return false
  updateMetricsAccumulator(accumulator[partition], row)
  return true
}

export const finalizePerfectPrototypeParentRuleAccumulator = ({
  accumulator,
  split,
  options = {},
  partitionCalendars = {},
}) => {
  const candidate = accumulator?.candidate ?? {}
  const searchMetrics = finalizeMetricsAccumulator(
    accumulator?.search ?? createMetricsAccumulator(),
    uniqueSorted(Array.from(partitionCalendars?.search ?? [])),
  )
  const validationMetrics = finalizeMetricsAccumulator(
    accumulator?.validation ?? createMetricsAccumulator(),
    uniqueSorted(Array.from(partitionCalendars?.validation ?? [])),
  )
  const oosMetrics = finalizeMetricsAccumulator(
    accumulator?.oos ?? createMetricsAccumulator(),
    uniqueSorted(Array.from(partitionCalendars?.oos ?? [])),
  )

  const minSearchHits = Math.max(1, Number(options?.minSearchHits ?? 6) || 6)
  const minValidationHits = Math.max(1, Number(options?.minValidationHits ?? 2) || 2)
  const maxValidationGap = Math.max(1, Number(options?.maxValidationGapTradingDays ?? 40) || 40)

  const searchPassed = searchMetrics.negativeCount === 0 && searchMetrics.hitCount >= minSearchHits
  const validationWindowExists =
    !!String(split?.validationStart ?? "").trim() && !!String(split?.validationEnd ?? "").trim()
  const validationPassed = validationWindowExists
    ? validationMetrics.negativeCount === 0 &&
      validationMetrics.hitCount >= minValidationHits &&
      Number(validationMetrics.maxGapTradingDays ?? Number.POSITIVE_INFINITY) <= maxValidationGap
    : false
  const oosWindowExists = !!String(split?.oosStart ?? "").trim()
  const oosPassed = oosWindowExists
    ? oosMetrics.negativeCount === 0 && oosMetrics.hitCount >= Math.max(1, Number(options?.minOosHits ?? 2) || 2)
    : false

  return {
    ruleId: buildParentRuleId(candidate.tokens),
    ruleLevel: "parent",
    tokens: candidate.tokens,
    ruleSize: candidate.tokens.length,
    overlapClusterId: candidate.overlapClusterId,
    sourceChildRuleIds: candidate.sourceChildRuleIds,
    sourceChildRuleCount: candidate.sourceChildRuleIds.length,
    supportRatio: candidate.supportRatio,
    searchMetrics,
    validationMetrics,
    oosMetrics,
    trainMatchCount: searchMetrics.matchCount,
    trainHitCount: searchMetrics.hitCount,
    trainNegativeCount: searchMetrics.negativeCount,
    precision: validationPassed ? validationMetrics.precision : searchMetrics.precision,
    matchedDateCount: validationPassed ? validationMetrics.matchedDateCount : searchMetrics.matchedDateCount,
    maxGapTradingDays:
      validationPassed && Number.isFinite(Number(validationMetrics.maxGapTradingDays))
        ? validationMetrics.maxGapTradingDays
        : searchMetrics.maxGapTradingDays,
    matchedSymbolCount:
      validationPassed && validationMetrics.matchedSymbolCount > 0
        ? validationMetrics.matchedSymbolCount
        : searchMetrics.matchedSymbolCount,
    promotionStatus: validationPassed ? "validated" : searchPassed ? "candidate" : "rejected",
    statusFlags: {
      searchPassed,
      validationPassed,
      oosPassed,
    },
  }
}

export const minePerfectPrototypeParentRules = ({
  rows,
  childClusters,
  childRules,
  split,
  options = {},
}) => {
  const partitions = splitPerfectPrototypeRows(rows, split)
  const childRulesById = new Map(
    (Array.isArray(childRules) ? childRules : []).map((rule) => [String(rule?.ruleId ?? "").trim(), rule]),
  )
  const parentCandidates = buildPerfectPrototypeParentCandidates({
    clusters: childClusters,
    childRulesById,
    minSupportRatio: Number(options?.minSupportRatio ?? 0.5),
    maxRuleSize: Math.max(1, Number(options?.maxRuleSize ?? 6) || 6),
  })
  const evaluatedRules = parentCandidates
    .map((candidate) =>
      evaluateParentCandidate({
        candidate,
        partitions,
        split,
        options,
      }),
    )
  const rankedRules = rankPerfectPrototypeParentRules(evaluatedRules)

  const validatedRules = rankedRules.filter((rule) => rule?.promotionStatus === "validated")
  const candidateRules = rankedRules.filter((rule) => rule?.promotionStatus === "candidate")
  const champion = validatedRules[0] ?? null
  const catalogMetadata = {
    split,
    rowCounts: {
      search: partitions.search.length,
      validation: partitions.validation.length,
      oos: partitions.oos.length,
    },
    clusterCount: Array.isArray(childClusters) ? childClusters.length : 0,
    childRuleCount: Array.isArray(childRules) ? childRules.length : 0,
    evaluatedParentRuleCount: rankedRules.length,
    validatedParentRuleCount: validatedRules.length,
    candidateParentRuleCount: candidateRules.length,
  }

  return {
    partitions,
    parentCandidates,
    rules: rankedRules,
    validatedRules,
    candidateRules,
    champion,
    metadata: catalogMetadata,
  }
}
