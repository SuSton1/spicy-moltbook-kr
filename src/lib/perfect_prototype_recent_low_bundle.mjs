import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
} from "./perfect_prototype_rule_family_spec.mjs"

export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID = "recent_only_low_shadow_bundle_v1"

export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS = Object.freeze([
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
])

export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_SELECTED_ROWS = 4
export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_HIT_ROWS = 2
export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_UNIQUE_DATES = 4
export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_HIT_RATE = 0.5
export const PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MAX_TOP1_DATE_SHARE = 0.5

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toBoolean = (value) => {
  if (typeof value === "boolean") return value
  return null
}

const resolveOutcomeHitTarget = (row) => {
  const direct = toBoolean(row?.outcomeHitTarget)
  if (direct != null) return direct
  return toBoolean(row?.eventOutcome?.hitTarget)
}

const resolveRowKey = (row) => {
  const explicit = toText(row?.sourceId)
  if (explicit) return explicit
  const dateKey = toText(row?.dateKey) ?? toText(row?.recommendationDateKey) ?? "null"
  const symbol = toText(row?.symbol) ?? "null"
  return `${dateKey}::${symbol}`
}

export const buildPerfectPrototypeRecentLowBundleFamilyIdSet = (familyIds) =>
  new Set(
    (Array.isArray(familyIds) ? familyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter((value) => PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.includes(value)),
  )

export const isPerfectPrototypeRecentLowBundleFamilyId = (familyId) =>
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.includes(String(familyId ?? "").trim())

export const buildRecentLowRuleCoverageLookup = ({ rows, candidateRuleIds }) => {
  const candidateRuleIdSet = new Set(
    (Array.isArray(candidateRuleIds) ? candidateRuleIds : [])
      .map((ruleId) => String(ruleId ?? "").trim())
      .filter(Boolean),
  )
  const rowLookup = new Map()
  const ruleCoverageLookup = new Map(
    Array.from(candidateRuleIdSet).map((ruleId) => [ruleId, new Set()]),
  )
  for (const row of Array.isArray(rows) ? rows : []) {
    const matchedRuleIds = uniqueSorted(
      (Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : [])
        .map((ruleId) => String(ruleId ?? "").trim())
        .filter((ruleId) => candidateRuleIdSet.has(ruleId)),
    )
    if (matchedRuleIds.length < 1) continue
    const rowKey = resolveRowKey(row)
    rowLookup.set(rowKey, {
      rowKey,
      dateKey: toText(row?.dateKey) ?? toText(row?.recommendationDateKey),
      symbol: toText(row?.symbol),
      outcomeHitTarget: resolveOutcomeHitTarget(row) === true,
      primaryRuleId: toText(row?.primaryRuleId),
      matchedRuleIds,
    })
    for (const ruleId of matchedRuleIds) {
      const bucket = ruleCoverageLookup.get(ruleId) ?? new Set()
      bucket.add(rowKey)
      ruleCoverageLookup.set(ruleId, bucket)
    }
  }
  return {
    candidateRuleIds: uniqueSorted(Array.from(candidateRuleIdSet)),
    rowLookup,
    ruleCoverageLookup,
  }
}

export const computeRecentLowBundleMetrics = ({ ruleIds, coverageLookup }) => {
  const safeRuleIds = uniqueSorted(ruleIds)
  const rowLookup = coverageLookup?.rowLookup instanceof Map ? coverageLookup.rowLookup : new Map()
  const ruleCoverageLookup = coverageLookup?.ruleCoverageLookup instanceof Map ? coverageLookup.ruleCoverageLookup : new Map()
  const selectedRowKeys = new Set()
  for (const ruleId of safeRuleIds) {
    for (const rowKey of ruleCoverageLookup.get(ruleId) ?? []) {
      selectedRowKeys.add(rowKey)
    }
  }
  const selectedRows = []
  for (const rowKey of selectedRowKeys) {
    const row = rowLookup.get(rowKey)
    if (row) selectedRows.push(row)
  }
  const hitRows = selectedRows.filter((row) => row.outcomeHitTarget === true)
  const dateCounts = new Map()
  for (const row of selectedRows) {
    const dateKey = toText(row?.dateKey)
    if (!dateKey) continue
    dateCounts.set(dateKey, Number(dateCounts.get(dateKey) ?? 0) + 1)
  }
  const uniqueDates = uniqueSorted(Array.from(dateCounts.keys()))
  const top1DateCount = Array.from(dateCounts.values()).reduce((max, value) => Math.max(max, Number(value ?? 0)), 0)
  const selectedRowCount = selectedRows.length
  const hitRowCount = hitRows.length
  return {
    ruleIds: safeRuleIds,
    ruleCount: safeRuleIds.length,
    selectedRows: selectedRowCount,
    hitRows: hitRowCount,
    hitRate: selectedRowCount > 0 ? hitRowCount / selectedRowCount : 0,
    uniqueDates,
    uniqueDateCount: uniqueDates.length,
    top1DateCount,
    top1DateShare: selectedRowCount > 0 ? top1DateCount / selectedRowCount : 0,
    selectedRowKeys: uniqueSorted(Array.from(selectedRowKeys)),
  }
}

export const evaluateRecentLowShadowBundleMetrics = (metrics) => {
  const rejectReasons = []
  if (Number(metrics?.selectedRows ?? 0) < PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_SELECTED_ROWS) {
    rejectReasons.push("bundle_insufficient_close28_rows")
  }
  if (Number(metrics?.hitRows ?? 0) < PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_HIT_ROWS) {
    rejectReasons.push("bundle_insufficient_close28_hits")
  }
  if (Number(metrics?.uniqueDateCount ?? 0) < PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_UNIQUE_DATES) {
    rejectReasons.push("bundle_insufficient_unique_dates")
  }
  if (Number(metrics?.hitRate ?? 0) < PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MIN_HIT_RATE) {
    rejectReasons.push("bundle_low_hit_rate")
  }
  if (Number(metrics?.top1DateShare ?? 0) > PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_MAX_TOP1_DATE_SHARE) {
    rejectReasons.push("bundle_overlap_too_high")
  }
  return {
    promotable: rejectReasons.length < 1,
    rejectReasons,
  }
}

const compareRecentLowBundleMetrics = (left, right) => {
  const safeLeft = left ?? {
    hitRows: 0,
    hitRate: 0,
    uniqueDateCount: 0,
    selectedRows: 0,
    top1DateShare: 1,
    ruleCount: 0,
    ruleIds: [],
  }
  const safeRight = right ?? {
    hitRows: 0,
    hitRate: 0,
    uniqueDateCount: 0,
    selectedRows: 0,
    top1DateShare: 1,
    ruleCount: 0,
    ruleIds: [],
  }
  if (Number(safeLeft.hitRows ?? 0) !== Number(safeRight.hitRows ?? 0)) {
    return Number(safeLeft.hitRows ?? 0) - Number(safeRight.hitRows ?? 0)
  }
  if (Number(safeLeft.hitRate ?? 0) !== Number(safeRight.hitRate ?? 0)) {
    return Number(safeLeft.hitRate ?? 0) - Number(safeRight.hitRate ?? 0)
  }
  if (Number(safeLeft.uniqueDateCount ?? 0) !== Number(safeRight.uniqueDateCount ?? 0)) {
    return Number(safeLeft.uniqueDateCount ?? 0) - Number(safeRight.uniqueDateCount ?? 0)
  }
  if (Number(safeLeft.selectedRows ?? 0) !== Number(safeRight.selectedRows ?? 0)) {
    return Number(safeRight.selectedRows ?? 0) - Number(safeLeft.selectedRows ?? 0)
  }
  if (Number(safeLeft.top1DateShare ?? 1) !== Number(safeRight.top1DateShare ?? 1)) {
    return Number(safeRight.top1DateShare ?? 1) - Number(safeLeft.top1DateShare ?? 1)
  }
  if (Number(safeLeft.ruleCount ?? 0) !== Number(safeRight.ruleCount ?? 0)) {
    return Number(safeRight.ruleCount ?? 0) - Number(safeLeft.ruleCount ?? 0)
  }
  return uniqueSorted(safeRight.ruleIds).join("::").localeCompare(uniqueSorted(safeLeft.ruleIds).join("::"))
}

export const selectRecentLowShadowBundleCandidate = ({ rows, candidateRuleIds }) => {
  const coverageLookup = buildRecentLowRuleCoverageLookup({ rows, candidateRuleIds })
  const remainingRuleIds = new Set(coverageLookup.candidateRuleIds)
  const perRuleMetrics = coverageLookup.candidateRuleIds
    .map((ruleId) => computeRecentLowBundleMetrics({ ruleIds: [ruleId], coverageLookup }))
    .sort((left, right) => {
      const compare = compareRecentLowBundleMetrics(left, right)
      if (compare !== 0) return -compare
      return String(left.ruleIds?.[0] ?? "").localeCompare(String(right.ruleIds?.[0] ?? ""))
    })
  let current = computeRecentLowBundleMetrics({ ruleIds: [], coverageLookup })
  while (remainingRuleIds.size > 0) {
    let bestRuleId = null
    let bestMetrics = null
    for (const ruleId of Array.from(remainingRuleIds).sort((left, right) => left.localeCompare(right))) {
      const nextMetrics = computeRecentLowBundleMetrics({
        ruleIds: [...current.ruleIds, ruleId],
        coverageLookup,
      })
      if (compareRecentLowBundleMetrics(nextMetrics, current) <= 0) continue
      if (!bestMetrics || compareRecentLowBundleMetrics(nextMetrics, bestMetrics) > 0) {
        bestRuleId = ruleId
        bestMetrics = nextMetrics
      }
    }
    if (!bestRuleId || !bestMetrics) break
    current = bestMetrics
    remainingRuleIds.delete(bestRuleId)
  }
  const evaluation = evaluateRecentLowShadowBundleMetrics(current)
  return {
    contractId: PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
    candidateRuleIds: coverageLookup.candidateRuleIds,
    selectedRuleIds: current.ruleIds,
    metrics: current,
    promotable: evaluation.promotable,
    rejectReasons: evaluation.rejectReasons,
    perRuleMetrics,
  }
}
