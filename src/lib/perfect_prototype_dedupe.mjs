import {
  buildPerfectPrototypeRuleRankLookup,
  comparePerfectPrototypeRules,
} from "./perfect_prototype_rule.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildSymbolDayKey = (row) => [String(row?.dateKey ?? "").trim(), String(row?.symbol ?? "").trim()].join("::")

const compareSelectionAwareRules = (left, right) => {
  const leftSelected = Number(left?.selectionOpenOosPrecision ?? Number.NaN)
  const rightSelected = Number(right?.selectionOpenOosPrecision ?? Number.NaN)
  if (Number.isFinite(leftSelected) || Number.isFinite(rightSelected)) {
    if ((Number.isFinite(rightSelected) ? rightSelected : -1) !== (Number.isFinite(leftSelected) ? leftSelected : -1)) {
      return (Number.isFinite(rightSelected) ? rightSelected : -1) - (Number.isFinite(leftSelected) ? leftSelected : -1)
    }
    const leftSelectionHits = Number(left?.selectionOpenOosHitCount ?? 0)
    const rightSelectionHits = Number(right?.selectionOpenOosHitCount ?? 0)
    if (rightSelectionHits !== leftSelectionHits) return rightSelectionHits - leftSelectionHits
    const leftSelectionDates = Number(left?.selectionOpenOosUniqueMatchedDates ?? 0)
    const rightSelectionDates = Number(right?.selectionOpenOosUniqueMatchedDates ?? 0)
    if (rightSelectionDates !== leftSelectionDates) return rightSelectionDates - leftSelectionDates
    const leftSelectionSymbols = Number(left?.selectionOpenOosUniqueMatchedSymbols ?? 0)
    const rightSelectionSymbols = Number(right?.selectionOpenOosUniqueMatchedSymbols ?? 0)
    if (rightSelectionSymbols !== leftSelectionSymbols) return rightSelectionSymbols - leftSelectionSymbols
  }
  return comparePerfectPrototypeRules(left, right)
}

const compareMatchRows = (left, right, rankedRuleLookup) => {
  const leftPrimary = rankedRuleLookup.get(String(left?.primaryRuleId ?? "")) ?? null
  const rightPrimary = rankedRuleLookup.get(String(right?.primaryRuleId ?? "")) ?? null
  if (leftPrimary || rightPrimary) {
    return compareSelectionAwareRules(leftPrimary ?? {}, rightPrimary ?? {})
  }
  const rightCount = Number(right?.matchedRuleCount ?? 0)
  const leftCount = Number(left?.matchedRuleCount ?? 0)
  if (rightCount !== leftCount) return rightCount - leftCount
  return String(left?.symbol ?? "").localeCompare(String(right?.symbol ?? ""))
}

export const createPerfectPrototypeMatchAccumulator = ({
  rules,
  selectionMode = "union_all",
  selectionMaxSymbolsPerDay = 2,
}) => {
  const normalizedSelectionMode =
    String(selectionMode ?? "union_all").trim().toLowerCase() || "union_all"
  if (
    ![
      "union_all",
      "champion_only",
      "top1_per_day_union",
      "top2_per_day_union",
    ].includes(normalizedSelectionMode)
  ) {
    throw new Error(`Unsupported perfect prototype selectionMode: ${selectionMode}`)
  }
  const resolvedSelectionMaxSymbolsPerDay =
    Number.isInteger(Math.floor(Number(selectionMaxSymbolsPerDay))) &&
    Math.floor(Number(selectionMaxSymbolsPerDay)) > 0
      ? Math.floor(Number(selectionMaxSymbolsPerDay))
      : normalizedSelectionMode === "top1_per_day_union"
        ? 1
        : 2
  const rankedRuleLookup = buildPerfectPrototypeRuleRankLookup(rules)
  const deduped = new Map()
  const overlapRows = []

  const sortRuleIdsByPriority = (matchedRuleIds) =>
    uniqueSorted(matchedRuleIds).sort((leftRuleId, rightRuleId) =>
      compareSelectionAwareRules(
        rankedRuleLookup.get(String(leftRuleId ?? "")) ?? { ruleId: leftRuleId },
        rankedRuleLookup.get(String(rightRuleId ?? "")) ?? { ruleId: rightRuleId },
      ),
    )

  const applyPrimaryRuleMetadata = (row, matchedRuleIds) => {
    const orderedRuleIds = sortRuleIdsByPriority(matchedRuleIds)
    const primaryRuleId = orderedRuleIds[0] ?? null
    const primaryRule = rankedRuleLookup.get(String(primaryRuleId ?? "")) ?? null
    return {
      ...row,
      matchedRuleIds: orderedRuleIds,
      matchedRuleCount: orderedRuleIds.length,
      primaryRuleId,
      supportingRuleIds: orderedRuleIds.slice(1),
      bestOpenOosPrecision:
        Number.isFinite(Number(primaryRule?.selectionOpenOosPrecision))
          ? Number(primaryRule.selectionOpenOosPrecision)
          : null,
      bestOpenOosHitCount:
        Number.isFinite(Number(primaryRule?.selectionOpenOosHitCount))
          ? Number(primaryRule.selectionOpenOosHitCount)
          : null,
      consensusScore: orderedRuleIds.length,
    }
  }

  const consume = (row) => {
    const key = buildSymbolDayKey(row)
    if (!key || key === "::") return
    const previous = deduped.get(key)
    if (!previous) {
      const initialRuleIds = Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : []
      deduped.set(key, applyPrimaryRuleMetadata({ ...row }, initialRuleIds))
      return
    }
    const mergedRuleIds = [...(previous?.matchedRuleIds ?? []), ...(row?.matchedRuleIds ?? [])]
    const preferred =
      compareMatchRows(previous, row, rankedRuleLookup) <= 0 ? previous : row
    const merged = applyPrimaryRuleMetadata({ ...preferred }, mergedRuleIds)
    deduped.set(key, merged)
    overlapRows.push({
      key,
      dateKey: merged.dateKey,
      symbol: merged.symbol,
      mergedRuleIds: merged.matchedRuleIds,
      mergedRuleCount: merged.matchedRuleCount,
      primaryRuleId: merged.primaryRuleId,
    })
  }

  const sortMatchesStable = (rows) =>
    (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
      if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey))
      return String(left.symbol).localeCompare(String(right.symbol))
    })

  const finalize = () => {
    const symbolDayDedupedMatches = sortMatchesStable(Array.from(deduped.values()))
    if (!["top1_per_day_union", "top2_per_day_union"].includes(normalizedSelectionMode)) {
      return {
        dedupedMatches: symbolDayDedupedMatches,
        symbolDayDedupedMatches,
        dayCapDroppedRows: [],
        topOverflowDates: [],
        overlapRows,
        selectionMode: normalizedSelectionMode,
        selectionMaxSymbolsPerDay: null,
      }
    }
    const rowsByDate = new Map()
    for (const row of symbolDayDedupedMatches) {
      const dateKey = String(row?.dateKey ?? "").trim()
      if (!dateKey) continue
      const bucket = rowsByDate.get(dateKey) ?? []
      bucket.push(row)
      rowsByDate.set(dateKey, bucket)
    }
    const selectedRows = []
    const droppedRows = []
    const topOverflowDates = []
    for (const dateKey of Array.from(rowsByDate.keys()).sort((left, right) => left.localeCompare(right))) {
      const rankedRows = rowsByDate
        .get(dateKey)
        .slice()
        .sort((left, right) => {
          const matchCompare = compareMatchRows(left, right, rankedRuleLookup)
          if (matchCompare !== 0) return matchCompare
          return String(left?.symbol ?? "").localeCompare(String(right?.symbol ?? ""))
        })
      selectedRows.push(...rankedRows.slice(0, resolvedSelectionMaxSymbolsPerDay))
      const overflowRows = rankedRows.slice(resolvedSelectionMaxSymbolsPerDay)
      if (overflowRows.length > 0) {
        droppedRows.push(
          ...overflowRows.map((row) => ({
            ...row,
            droppedBySelectionMode: normalizedSelectionMode,
          })),
        )
        topOverflowDates.push({
          dateKey,
          candidateCount: rankedRows.length,
          keptCount: Math.min(resolvedSelectionMaxSymbolsPerDay, rankedRows.length),
          droppedCount: overflowRows.length,
          keptSymbols: rankedRows
            .slice(0, resolvedSelectionMaxSymbolsPerDay)
            .map((row) => row?.symbol)
            .filter(Boolean),
          droppedSymbols: overflowRows.map((row) => row?.symbol).filter(Boolean).slice(0, 10),
        })
      }
    }
    return {
      dedupedMatches: sortMatchesStable(selectedRows),
      symbolDayDedupedMatches,
      dayCapDroppedRows: sortMatchesStable(droppedRows),
      topOverflowDates,
      overlapRows,
      selectionMode: normalizedSelectionMode,
      selectionMaxSymbolsPerDay: resolvedSelectionMaxSymbolsPerDay,
    }
  }

  return {
    consume,
    finalize,
  }
}

export const dedupePerfectPrototypeMatches = ({
  matches,
  rules,
  selectionMode = "union_all",
  selectionMaxSymbolsPerDay = 2,
}) => {
  const accumulator = createPerfectPrototypeMatchAccumulator({
    rules,
    selectionMode,
    selectionMaxSymbolsPerDay,
  })
  for (const row of Array.isArray(matches) ? matches : []) {
    accumulator.consume(row)
  }
  return accumulator.finalize()
}

export const annotatePerfectPrototypeMatch = ({
  row,
  matchedRuleIds = [],
  primaryRuleId = null,
  maxRulesPerSymbol = 8,
}) => {
  const limitedRuleIds = uniqueSorted(matchedRuleIds).slice(
    0,
    Math.max(1, Math.floor(Number(maxRulesPerSymbol) || 8)),
  )
  return {
    ...(row && typeof row === "object" ? row : {}),
    matchedPerfectPrototypeIds: limitedRuleIds,
    matchedPerfectPrototypeCount: limitedRuleIds.length,
    perfectPrototypePrimaryRuleId:
      String(primaryRuleId ?? "").trim() || limitedRuleIds[0] || null,
    perfectPrototypeGatePassed: limitedRuleIds.length > 0,
  }
}

export const dedupePerfectPrototypeCandidates = (rows, options = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  if (options?.dedupeSymbolsPerDay === false) return safeRows.slice()
  const dateKeyField = String(options?.dateKeyField ?? "decisionDateKey")
  const symbolField = String(options?.symbolField ?? "symbol")
  const deduped = new Map()
  for (const row of safeRows) {
    const key = [
      String(row?.[dateKeyField] ?? "").trim(),
      String(row?.[symbolField] ?? "").trim(),
    ].join("::")
    if (!key || key === "::") continue
    const previous = deduped.get(key)
    if (!previous) {
      deduped.set(key, row)
      continue
    }
    const previousCount = Number(previous?.matchedPerfectPrototypeCount ?? 0)
    const nextCount = Number(row?.matchedPerfectPrototypeCount ?? 0)
    if (nextCount > previousCount) {
      deduped.set(key, row)
      continue
    }
    if (nextCount === previousCount) {
      const previousDecisionIdx = Number(previous?.decisionIdx ?? Number.MAX_SAFE_INTEGER)
      const nextDecisionIdx = Number(row?.decisionIdx ?? Number.MAX_SAFE_INTEGER)
      if (nextDecisionIdx < previousDecisionIdx) {
        deduped.set(key, row)
      }
    }
  }
  return Array.from(deduped.values())
}
