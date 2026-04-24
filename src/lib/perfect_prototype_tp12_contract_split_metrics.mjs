import {
  buildPerfectPrototypeChronologicalFoldLookup,
  computePerfectPrototypeDayCappedHitStats,
} from "./perfect_prototype_rule.mjs"
import { round, ratio, toNumber } from "./perfect_prototype_tp12_probe_metrics.mjs"

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildSet = (values = []) => new Set(uniqueSorted(values))

export const buildTp12TouchFoldKeyLookup = ({ rows, foldScheme = "chronological_4" } = {}) => {
  const calendarDateKeys = uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.dateKey).filter(Boolean))
  const foldLookup = buildPerfectPrototypeChronologicalFoldLookup({
    calendarDateKeys,
    foldScheme,
  })
  const dateToFoldKey = new Map()
  for (let index = 0; index < calendarDateKeys.length; index += 1) {
    const dateKey = calendarDateKeys[index]
    const foldKey = foldLookup?.foldKeysByCalendarIndex?.[index] ?? null
    if (dateKey && foldKey) dateToFoldKey.set(dateKey, foldKey)
  }
  return {
    calendarDateKeys,
    foldLookup,
    dateToFoldKey,
  }
}

export const buildTp12TouchRuleSummaries = ({
  rules,
  ruleStats,
  dateToFoldKey,
  promotableMinMatchedDates = 10,
  promotableMinMatchedMonths = 6,
  promotableMinMatchedFolds = 4,
  includeDateDetails = false,
} = {}) => {
  const safeRules = Array.isArray(rules) ? rules : []
  const safeStats = ruleStats instanceof Map ? ruleStats : new Map()
  const rows = safeRules.map((rule) => {
    const ruleId = String(rule?.ruleId ?? "").trim()
    const stat = safeStats.get(ruleId) ?? {
      matchCount: 0,
      hitCount: 0,
      negativeCount: 0,
      matchedDates: [],
      hitDates: [],
    }
    const hitDates = uniqueSorted(stat.hitDates)
    const foldKeys = hitDates.map((dateKey) => dateToFoldKey?.get(dateKey) ?? null)
    const hitStats = computePerfectPrototypeDayCappedHitStats({
      dateKeys: hitDates,
      foldKeys,
    })
    const matchCount = toNumber(stat.matchCount, 0)
    const hitCount = toNumber(stat.hitCount, 0)
    const negativeCount = toNumber(stat.negativeCount, 0)
    const zeroNegative = matchCount > 0 && negativeCount === 0
    const promotableTrainBreadth =
      zeroNegative &&
      toNumber(hitStats?.distinctDateCount, 0) >= promotableMinMatchedDates &&
      toNumber(hitStats?.matchedMonthCount, 0) >= promotableMinMatchedMonths &&
      toNumber(hitStats?.matchedFoldCount, 0) >= promotableMinMatchedFolds
    const perfectDateFloor3 =
      zeroNegative && hitCount >= 3 && toNumber(hitStats?.distinctDateCount, 0) >= 3
    const row = {
      ruleId,
      familyId: String(rule?.familyId ?? "").trim() || null,
      tokens: Array.isArray(rule?.tokens) ? rule.tokens : [],
      touchMatchCount: matchCount,
      touchHitCount: hitCount,
      touchNegativeCount: negativeCount,
      touchPrecision: matchCount > 0 ? hitCount / matchCount : 0,
      touchMatchedDateCount: uniqueSorted(stat.matchedDates).length,
      touchMatchedMonthCount: toNumber(hitStats?.matchedMonthCount, 0),
      touchMatchedFoldCount: toNumber(hitStats?.matchedFoldCount, 0),
      touchTop1DateHitShare: round(hitStats?.top1DateHitShare),
      touchTop3DateHitShare: round(hitStats?.top3DateHitShare),
      touchMaxSymbolsMatchedPerDate: toNumber(hitStats?.maxSymbolsMatchedPerDate, 0),
      touchZeroNegative: zeroNegative,
      touchPromotableBreadth: promotableTrainBreadth,
      touchPerfectDateFloor3: perfectDateFloor3,
    }
    if (includeDateDetails) {
      row.touchMatchedDates = uniqueSorted(stat.matchedDates)
      row.touchHitDates = hitDates
      row.touchHitMonths = uniqueSorted(hitDates.map((dateKey) => String(dateKey ?? "").slice(0, 7)).filter(Boolean))
      row.touchHitFoldKeys = uniqueSorted(foldKeys.filter(Boolean))
    }
    return row
  })
  const touchZeroNegativeRuleIds = rows.filter((row) => row.touchZeroNegative).map((row) => row.ruleId)
  const touchPromotableRuleIds = rows.filter((row) => row.touchPromotableBreadth).map((row) => row.ruleId)
  const touchPerfectDateFloor3RuleIds = rows.filter((row) => row.touchPerfectDateFloor3).map((row) => row.ruleId)
  return {
    rows,
    aggregate: {
      ruleCount: rows.length,
      zeroNegativeRuleCount: touchZeroNegativeRuleIds.length,
      promotableBreadthRuleCount: touchPromotableRuleIds.length,
      perfectDateFloor3RuleCount: touchPerfectDateFloor3RuleIds.length,
    },
    touchZeroNegativeRuleIds,
    touchPromotableRuleIds,
    touchPerfectDateFloor3RuleIds,
  }
}

export const buildTp12TouchLineSummary = ({ dedupedMatches } = {}) => {
  const safeRows = Array.isArray(dedupedMatches) ? dedupedMatches : []
  const hitRows = safeRows.filter((row) => row?.outcomeHitTarget === true)
  return {
    selectedRows: safeRows.length,
    hitRows: hitRows.length,
    hitRate: safeRows.length > 0 ? hitRows.length / safeRows.length : 0,
    uniqueMatchedDates: uniqueSorted(safeRows.map((row) => row?.dateKey).filter(Boolean)).length,
  }
}

export const buildTp12CleanRuleSets = (cleanLeaderboardRows = []) => {
  const rows = Array.isArray(cleanLeaderboardRows) ? cleanLeaderboardRows : []
  const cleanTrainPromotableRuleIds = rows
    .filter(
      (row) =>
        toNumber(row?.trainMatchedDateCount, 0) >= 10 &&
        toNumber(row?.trainMatchedMonthCount, 0) >= 6 &&
        toNumber(row?.trainMatchedFoldCount, 0) >= 4,
    )
    .map((row) => String(row?.ruleId ?? "").trim())
    .filter(Boolean)
  const cleanOosZeroNegativeRuleIds = rows
    .filter(
      (row) =>
        toNumber(row?.openOosMatchCount, 0) > 0 &&
        toNumber(row?.openOosNegativeCount, 0) === 0,
    )
    .map((row) => String(row?.ruleId ?? "").trim())
    .filter(Boolean)
  const cleanOosPerfectDateFloor3RuleIds = rows
    .filter(
      (row) =>
        toNumber(row?.openOosMatchCount, 0) > 0 &&
        toNumber(row?.openOosNegativeCount, 0) === 0 &&
        toNumber(row?.openOosHitCount, 0) >= 3 &&
        toNumber(row?.openOosUniqueMatchedDates, 0) >= 3,
    )
    .map((row) => String(row?.ruleId ?? "").trim())
    .filter(Boolean)
  return {
    cleanTrainPromotableRuleIds: uniqueSorted(cleanTrainPromotableRuleIds),
    cleanOosZeroNegativeRuleIds: uniqueSorted(cleanOosZeroNegativeRuleIds),
    cleanOosPerfectDateFloor3RuleIds: uniqueSorted(cleanOosPerfectDateFloor3RuleIds),
  }
}

export const buildTp12ContractSplitBridgeMetrics = ({
  touchTrainPromotableRuleIds,
  touchOosZeroNegativeRuleIds,
  touchOosPerfectDateFloor3RuleIds,
  cleanTrainPromotableRuleIds,
  cleanOosZeroNegativeRuleIds,
  cleanOosPerfectDateFloor3RuleIds,
} = {}) => {
  const touchTrainPromotable = buildSet(touchTrainPromotableRuleIds)
  const touchOosZeroNegative = buildSet(touchOosZeroNegativeRuleIds)
  const touchOosPerfectDateFloor3 = buildSet(touchOosPerfectDateFloor3RuleIds)
  const cleanTrainPromotable = buildSet(cleanTrainPromotableRuleIds)
  const cleanOosZeroNegative = buildSet(cleanOosZeroNegativeRuleIds)
  const cleanOosPerfectDateFloor3 = buildSet(cleanOosPerfectDateFloor3RuleIds)

  const intersectionCount = (left, right) => {
    let count = 0
    for (const value of left) {
      if (right.has(value)) count += 1
    }
    return count
  }

  const retainedTrainPromotableRuleCount = intersectionCount(touchTrainPromotable, cleanTrainPromotable)
  const retainedOosZeroNegativeRuleCount = intersectionCount(touchOosZeroNegative, cleanOosZeroNegative)
  const retainedOosPerfectDateFloor3RuleCount = intersectionCount(
    touchOosPerfectDateFloor3,
    cleanOosPerfectDateFloor3,
  )

  return {
    touchTrainPromotableRuleCount: touchTrainPromotable.size,
    cleanTrainPromotableRuleCount: cleanTrainPromotable.size,
    retainedTrainPromotableRuleCount,
    cleanRetentionFromTouchTrainPromotableRate: round(ratio(retainedTrainPromotableRuleCount, Math.max(1, touchTrainPromotable.size))),
    touchOosZeroNegativeRuleCount: touchOosZeroNegative.size,
    cleanOosZeroNegativeRuleCount: cleanOosZeroNegative.size,
    retainedOosZeroNegativeRuleCount,
    cleanRetentionFromTouchOosZeroNegativeRate: round(ratio(retainedOosZeroNegativeRuleCount, Math.max(1, touchOosZeroNegative.size))),
    touchOosPerfectDateFloor3RuleCount: touchOosPerfectDateFloor3.size,
    cleanOosPerfectDateFloor3RuleCount: cleanOosPerfectDateFloor3.size,
    retainedOosPerfectDateFloor3RuleCount,
    cleanRetentionFromTouchOosPerfectDateFloor3Rate: round(
      ratio(retainedOosPerfectDateFloor3RuleCount, Math.max(1, touchOosPerfectDateFloor3.size)),
    ),
  }
}
