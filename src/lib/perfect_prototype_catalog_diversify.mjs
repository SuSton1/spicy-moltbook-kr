import {
  buildPerfectPrototypeMonthKey,
  buildPerfectPrototypeQuarterKey,
  capPerfectPrototypeRulesPerMatchedDateSignature,
  capPerfectPrototypeRulesPerMatchedMonthSignature,
  capPerfectPrototypeRulesPerMatchedQuarterSignature,
  comparePerfectPrototypeRules,
} from "./perfect_prototype_rule.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
} from "./perfect_prototype_rule_family_spec.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toSortedIndexArray = (values) =>
  Array.from(Array.isArray(values) || ArrayBuffer.isView(values) ? values : [], (value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((left, right) => left - right)

const safeRate = (numValue, denValue) => {
  const numerator = Number(numValue)
  const denominator = Number(denValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

const normalizeRuleCountLimit = (value, fallback = null) => {
  const numeric = Math.floor(Number(value))
  if (!Number.isInteger(numeric) || numeric < 1) return fallback
  return numeric
}

const buildTokenFamilyKey = (token) => {
  const normalized = String(token ?? "").trim()
  if (!normalized) return null
  const lastSeparator = normalized.lastIndexOf(":")
  if (lastSeparator < 0) return normalized
  return normalized.slice(0, lastSeparator)
}

const extractRuleAnchorFamilies = (rule) =>
  uniqueSorted((Array.isArray(rule?.tokens) ? rule.tokens : []).map((token) => buildTokenFamilyKey(token)).filter(Boolean))

const extractRuleMarketRegimes = (rule) =>
  uniqueSorted(
    (Array.isArray(rule?.tokens) ? rule.tokens : []).filter((token) =>
      String(token ?? "").startsWith("tag:market.jumpRegime:"),
    ),
  )

const extractRuleLanes = ({ rule, rows = [] }) => {
  const positiveRowIndexes = toSortedIndexArray(rule?.positiveMatchRowIndexes)
  return uniqueSorted(
    positiveRowIndexes
      .map((rowIndex) => String(rows?.[rowIndex]?.stepALaneId ?? "").trim())
      .filter(Boolean),
  )
}

const countSortedIntersection = (left, right) => {
  const leftValues = toSortedIndexArray(left)
  const rightValues = toSortedIndexArray(right)
  let leftIndex = 0
  let rightIndex = 0
  let overlap = 0
  while (leftIndex < leftValues.length && rightIndex < rightValues.length) {
    if (leftValues[leftIndex] === rightValues[rightIndex]) {
      overlap += 1
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (leftValues[leftIndex] < rightValues[rightIndex]) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }
  return overlap
}

export const buildPerfectPrototypeRuleCoverageProfile = ({ rule, rows = [] }) => {
  const positiveRowIndexes = toSortedIndexArray(rule?.positiveMatchRowIndexes)
  const dates = uniqueSorted(
    positiveRowIndexes.map((rowIndex) => String(rows?.[rowIndex]?.dateKey ?? "").trim()).filter(Boolean),
  )
  const months = uniqueSorted(dates.map((dateKey) => buildPerfectPrototypeMonthKey(dateKey)).filter(Boolean))
  const quarters = uniqueSorted(dates.map((dateKey) => buildPerfectPrototypeQuarterKey(dateKey)).filter(Boolean))
  const anchorFamilies = extractRuleAnchorFamilies(rule)
  const marketRegimes = extractRuleMarketRegimes(rule)
  const lanes = extractRuleLanes({ rule, rows })
  return {
    ruleId: String(rule?.ruleId ?? "").trim() || null,
    familyId: String(rule?.familyId ?? "").trim() || null,
    positiveRowIndexes,
    dates,
    months,
    quarters,
    anchorFamilies,
    marketRegimes,
    lanes,
  }
}

export const applyPerfectPrototypeTemporalSignatureCaps = ({
  rules,
  maxRulesPerMatchedDateSignature = null,
  maxRulesPerMatchedMonthSignature = null,
  maxRulesPerMatchedQuarterSignature = null,
}) => {
  const dateCapped = capPerfectPrototypeRulesPerMatchedDateSignature({
    rules,
    maxRulesPerMatchedDateSignature,
  })
  const monthCapped = capPerfectPrototypeRulesPerMatchedMonthSignature({
    rules: dateCapped.rules,
    maxRulesPerMatchedMonthSignature,
  })
  const quarterCapped = capPerfectPrototypeRulesPerMatchedQuarterSignature({
    rules: monthCapped.rules,
    maxRulesPerMatchedQuarterSignature,
  })
  return {
    rules: quarterCapped.rules,
    droppedRuleCount:
      Number(dateCapped.droppedRuleCount ?? 0) +
      Number(monthCapped.droppedRuleCount ?? 0) +
      Number(quarterCapped.droppedRuleCount ?? 0),
    droppedByDateSignature: Number(dateCapped.droppedRuleCount ?? 0),
    droppedByMonthSignature: Number(monthCapped.droppedRuleCount ?? 0),
    droppedByQuarterSignature: Number(quarterCapped.droppedRuleCount ?? 0),
  }
}

const normalizeSelectorPool = ({ rules, rows = [] }) => {
  const safeRules = Array.isArray(rules) ? rules : []
  const profiles = safeRules.map((rule) => ({
    rule,
    profile: buildPerfectPrototypeRuleCoverageProfile({ rule, rows }),
  }))
  const maxima = {
    trainHitCount: Math.max(1, ...profiles.map(({ rule }) => Number(rule?.trainHitCount ?? 0))),
    matchedDateCount: Math.max(1, ...profiles.map(({ rule }) => Number(rule?.matchedDateCount ?? 0))),
    matchedMonthCount: Math.max(1, ...profiles.map(({ rule }) => Number(rule?.matchedMonthCount ?? 0))),
    matchedQuarterCount: Math.max(1, ...profiles.map(({ rule }) => Number(rule?.matchedQuarterCount ?? 0))),
    dateCount: Math.max(1, ...profiles.map(({ profile }) => profile.dates.length)),
    monthCount: Math.max(1, ...profiles.map(({ profile }) => profile.months.length)),
    quarterCount: Math.max(1, ...profiles.map(({ profile }) => profile.quarters.length)),
  }
  return {
    profiles,
    maxima,
  }
}

const buildCoverageState = () => ({
  dates: new Set(),
  months: new Set(),
  quarters: new Set(),
  anchorFamilies: new Set(),
  marketRegimes: new Set(),
  lanes: new Set(),
  families: new Set(),
  familySelectionCounts: new Map(),
})

const getFamilySelectionCount = ({ coverageState, familyId }) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (!normalizedFamilyId) return 0
  return Number(coverageState?.familySelectionCounts?.get(normalizedFamilyId) ?? 0)
}

const buildMinimumFamilyShortfalls = ({
  coverageState,
  midFamilyMinQuota = null,
  lowFamilyMinQuota = null,
}) => {
  const entries = [
    [PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION, normalizeRuleCountLimit(midFamilyMinQuota, 0) ?? 0],
    [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION, normalizeRuleCountLimit(lowFamilyMinQuota, 0) ?? 0],
  ]
  const shortfalls = new Map()
  for (const [familyId, minimumQuota] of entries) {
    if (!minimumQuota || minimumQuota < 1) continue
    const currentCount = getFamilySelectionCount({ coverageState, familyId })
    const shortfall = Math.max(0, minimumQuota - currentCount)
    if (shortfall > 0) shortfalls.set(familyId, shortfall)
  }
  return shortfalls
}

const computeCoverageOverlapPenalty = ({ selectedProfiles, candidateProfile }) => {
  if (!Array.isArray(selectedProfiles) || selectedProfiles.length < 1) return 0
  let maxOverlap = 0
  for (const selectedProfile of selectedProfiles) {
    const overlap = countSortedIntersection(
      selectedProfile?.profile?.positiveRowIndexes ?? [],
      candidateProfile?.profile?.positiveRowIndexes ?? [],
    )
    const denominator = Math.min(
      Math.max(1, Number(selectedProfile?.profile?.positiveRowIndexes?.length ?? 0)),
      Math.max(1, Number(candidateProfile?.profile?.positiveRowIndexes?.length ?? 0)),
    )
    maxOverlap = Math.max(maxOverlap, safeRate(overlap, denominator))
  }
  return maxOverlap
}

const computeNoveltyCounts = ({ coverageState, profile }) => {
  const newDates = profile.dates.filter((value) => !coverageState.dates.has(value))
  const newMonths = profile.months.filter((value) => !coverageState.months.has(value))
  const newQuarters = profile.quarters.filter((value) => !coverageState.quarters.has(value))
  const newAnchorFamilies = profile.anchorFamilies.filter((value) => !coverageState.anchorFamilies.has(value))
  const newMarketRegimes = profile.marketRegimes.filter((value) => !coverageState.marketRegimes.has(value))
  const newLanes = profile.lanes.filter((value) => !coverageState.lanes.has(value))
  const newFamilies = profile.familyId && !coverageState.families.has(profile.familyId) ? [profile.familyId] : []
  return {
    newDates,
    newMonths,
    newQuarters,
    newAnchorFamilies,
    newMarketRegimes,
    newLanes,
    newFamilies,
  }
}

const applyCoverageState = ({ coverageState, profile }) => {
  for (const value of profile.dates) coverageState.dates.add(value)
  for (const value of profile.months) coverageState.months.add(value)
  for (const value of profile.quarters) coverageState.quarters.add(value)
  for (const value of profile.anchorFamilies) coverageState.anchorFamilies.add(value)
  for (const value of profile.marketRegimes) coverageState.marketRegimes.add(value)
  for (const value of profile.lanes) coverageState.lanes.add(value)
  if (profile.familyId) {
    coverageState.families.add(profile.familyId)
    coverageState.familySelectionCounts.set(
      profile.familyId,
      getFamilySelectionCount({ coverageState, familyId: profile.familyId }) + 1,
    )
  }
}

export const selectDiversePerfectPrototypeRules = ({
  rules,
  rows = [],
  maxRules = Number.POSITIVE_INFINITY,
  noveltyWeight = 1,
  overlapPenaltyWeight = 1,
  anchorFamilyPenaltyWeight = 0.5,
  lanePenaltyWeight = 0.5,
  familyPenaltyWeight = 0.5,
  topFamilyMaxQuota = null,
  midFamilyMinQuota = null,
  lowFamilyMinQuota = null,
}) => {
  const resolvedMaxRules = normalizeRuleCountLimit(maxRules, Number.POSITIVE_INFINITY)
  const resolvedTopFamilyMaxQuota = normalizeRuleCountLimit(topFamilyMaxQuota, null)
  const resolvedMidFamilyMinQuota = normalizeRuleCountLimit(midFamilyMinQuota, null)
  const resolvedLowFamilyMinQuota = normalizeRuleCountLimit(lowFamilyMinQuota, null)
  const { profiles, maxima } = normalizeSelectorPool({ rules, rows })
  const remaining = profiles.slice()
  const selected = []
  const coverageState = buildCoverageState()
  const selectionRows = []

  while (remaining.length > 0 && selected.length < resolvedMaxRules) {
    let bestIndex = -1
    let bestScore = Number.NEGATIVE_INFINITY
    let bestDiagnostics = null
    const minimumFamilyShortfalls = buildMinimumFamilyShortfalls({
      coverageState,
      midFamilyMinQuota: resolvedMidFamilyMinQuota,
      lowFamilyMinQuota: resolvedLowFamilyMinQuota,
    })
    const requiredRemainingSlots = Array.from(minimumFamilyShortfalls.values()).reduce(
      (sum, value) => sum + Number(value ?? 0),
      0,
    )
    const remainingSlots = Number.isFinite(resolvedMaxRules) ? Math.max(0, resolvedMaxRules - selected.length) : Number.POSITIVE_INFINITY
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const candidateFamilyId = String(candidate.profile?.familyId ?? "").trim() || null
      const selectedFamilyCount = getFamilySelectionCount({
        coverageState,
        familyId: candidateFamilyId,
      })
      if (
        candidateFamilyId &&
        candidateFamilyId.startsWith("top_close_") &&
        Number.isInteger(resolvedTopFamilyMaxQuota) &&
        selectedFamilyCount >= resolvedTopFamilyMaxQuota
      ) {
        continue
      }
      if (
        Number.isFinite(remainingSlots) &&
        requiredRemainingSlots > 0 &&
        requiredRemainingSlots >= remainingSlots &&
        (!candidateFamilyId || !minimumFamilyShortfalls.has(candidateFamilyId))
      ) {
        continue
      }
      const novelty = computeNoveltyCounts({
        coverageState,
        profile: candidate.profile,
      })
      const overlapPenalty = computeCoverageOverlapPenalty({
        selectedProfiles: selected,
        candidateProfile: candidate,
      })
      const reusedAnchorCount =
        candidate.profile.anchorFamilies.length - novelty.newAnchorFamilies.length
      const reusedLaneCount = candidate.profile.lanes.length - novelty.newLanes.length
      const reusedFamilyCount =
        candidate.profile.familyId && coverageState.families.has(candidate.profile.familyId) ? 1 : 0
      const qualityScore =
        safeRate(Number(candidate.rule?.trainHitCount ?? 0), maxima.trainHitCount) * 0.45 +
        safeRate(Number(candidate.rule?.matchedDateCount ?? 0), maxima.matchedDateCount) * 0.15 +
        safeRate(Number(candidate.rule?.matchedMonthCount ?? 0), maxima.matchedMonthCount) * 0.2 +
        safeRate(Number(candidate.rule?.matchedQuarterCount ?? 0), maxima.matchedQuarterCount) * 0.15 +
        (1 - Math.max(0, Math.min(1, Number(candidate.rule?.top3DateHitShare ?? 1)))) * 0.05
      const noveltyScore =
        safeRate(novelty.newDates.length, maxima.dateCount) * 0.2 +
        safeRate(novelty.newMonths.length, maxima.monthCount) * 0.25 +
        safeRate(novelty.newQuarters.length, maxima.quarterCount) * 0.25 +
        safeRate(novelty.newAnchorFamilies.length, Math.max(1, candidate.profile.anchorFamilies.length)) * 0.1 +
        safeRate(novelty.newMarketRegimes.length, Math.max(1, candidate.profile.marketRegimes.length)) * 0.05 +
        safeRate(novelty.newLanes.length, Math.max(1, candidate.profile.lanes.length)) * 0.1 +
        safeRate(novelty.newFamilies.length, 1) * 0.05
      const score =
        qualityScore +
        Number(noveltyWeight) * noveltyScore -
        Number(overlapPenaltyWeight) * overlapPenalty -
        Number(anchorFamilyPenaltyWeight) *
          safeRate(reusedAnchorCount, Math.max(1, candidate.profile.anchorFamilies.length)) -
        Number(lanePenaltyWeight) *
          safeRate(reusedLaneCount, Math.max(1, candidate.profile.lanes.length)) -
        Number(familyPenaltyWeight) * safeRate(reusedFamilyCount, 1)
      if (
        score > bestScore ||
        (score === bestScore &&
          comparePerfectPrototypeRules(candidate.rule, remaining[bestIndex]?.rule) < 0)
      ) {
        bestIndex = index
        bestScore = score
        bestDiagnostics = {
          qualityScore,
          noveltyScore,
          overlapPenalty,
          reusedAnchorCount,
          reusedLaneCount,
          reusedFamilyCount,
          selectedFamilyCount,
          novelty,
        }
      }
    }
    if (bestIndex < 0) break
    const winner = remaining.splice(bestIndex, 1)[0]
    selected.push(winner)
    applyCoverageState({
      coverageState,
      profile: winner.profile,
    })
    selectionRows.push({
      ruleId: winner.rule?.ruleId ?? null,
      score: bestScore,
      qualityScore: bestDiagnostics?.qualityScore ?? 0,
      noveltyScore: bestDiagnostics?.noveltyScore ?? 0,
      overlapPenalty: bestDiagnostics?.overlapPenalty ?? 0,
      reusedAnchorCount: bestDiagnostics?.reusedAnchorCount ?? 0,
      reusedLaneCount: bestDiagnostics?.reusedLaneCount ?? 0,
      reusedFamilyCount: bestDiagnostics?.reusedFamilyCount ?? 0,
      selectedFamilyCountBeforePick: bestDiagnostics?.selectedFamilyCount ?? 0,
      addedDateCount: Number(bestDiagnostics?.novelty?.newDates?.length ?? 0),
      addedMonthCount: Number(bestDiagnostics?.novelty?.newMonths?.length ?? 0),
      addedQuarterCount: Number(bestDiagnostics?.novelty?.newQuarters?.length ?? 0),
      addedAnchorFamilyCount: Number(bestDiagnostics?.novelty?.newAnchorFamilies?.length ?? 0),
      addedMarketRegimeCount: Number(bestDiagnostics?.novelty?.newMarketRegimes?.length ?? 0),
      addedLaneCount: Number(bestDiagnostics?.novelty?.newLanes?.length ?? 0),
      addedFamilyCount: Number(bestDiagnostics?.novelty?.newFamilies?.length ?? 0),
      familyId: winner.profile?.familyId ?? null,
    })
  }

  const selectedRules = selected.map(({ rule }) => rule)
  return {
    selectedRules,
    selectionReport: {
      selectionMode: "diverse_set_v1",
      candidateRuleCount: profiles.length,
      selectedRuleCount: selectedRules.length,
      coveredDateCount: coverageState.dates.size,
      coveredMonthCount: coverageState.months.size,
      coveredQuarterCount: coverageState.quarters.size,
      coveredAnchorFamilyCount: coverageState.anchorFamilies.size,
      coveredMarketRegimeCount: coverageState.marketRegimes.size,
      coveredLaneCount: coverageState.lanes.size,
      coveredFamilyCount: coverageState.families.size,
      familySelectionCounts: Object.fromEntries(coverageState.familySelectionCounts.entries()),
      selectorQuotas: {
        topFamilyMaxQuota: resolvedTopFamilyMaxQuota,
        midFamilyMinQuota: resolvedMidFamilyMinQuota,
        lowFamilyMinQuota: resolvedLowFamilyMinQuota,
      },
      selectionRows,
    },
  }
}
