import { buildPerfectPrototypeYearKey } from "./perfect_prototype_rule.mjs"

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

export const PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON =
  "YEAR_HIT_UPPER_BOUND_BELOW_CORE_MIN"

export const normalizePerfectPrototypeCoreYears = (values) =>
  uniqueSortedNumbers(values)

export const buildPerfectPrototypeYearHitCountsFromHitDates = ({
  hitDates,
  coreYears = [],
  excludedBoundaryYears = [],
} = {}) => {
  const safeHitDates = Array.isArray(hitDates) ? hitDates : []
  const resolvedCoreYears = normalizePerfectPrototypeCoreYears(coreYears)
  const resolvedExcludedBoundaryYears = normalizePerfectPrototypeCoreYears(excludedBoundaryYears)
  const excludedYearSet = new Set(resolvedExcludedBoundaryYears)
  const allYearHitCounts = new Map()
  const uniqueHitDates = Array.from(new Set(safeHitDates.map((value) => String(value ?? "").trim()).filter(Boolean)))
  for (const rawDateKey of uniqueHitDates) {
    const yearKey = buildPerfectPrototypeYearKey(rawDateKey)
    if (!Number.isInteger(yearKey)) continue
    if (excludedYearSet.has(yearKey)) continue
    allYearHitCounts.set(yearKey, Number(allYearHitCounts.get(yearKey) ?? 0) + 1)
  }
  const coreYearHitCounts = Object.fromEntries(
    resolvedCoreYears.map((yearKey) => [String(yearKey), Number(allYearHitCounts.get(yearKey) ?? 0)]),
  )
  return {
    coreYears: resolvedCoreYears,
    excludedBoundaryYears: resolvedExcludedBoundaryYears,
    allYearHitCounts: Object.fromEntries(
      Array.from(allYearHitCounts.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([yearKey, hitCount]) => [String(yearKey), hitCount]),
    ),
    coreYearHitCounts,
  }
}

export const evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts = ({
  coreYearHitCounts = {},
  coreYears = [],
  minTrainHitsPerCoreYear = null,
} = {}) => {
  const resolvedCoreYears = normalizePerfectPrototypeCoreYears(coreYears)
  const resolvedMinTrainHitsPerCoreYear = Number(minTrainHitsPerCoreYear)
  if (resolvedCoreYears.length < 1) {
    return {
      ok: true,
      reason: null,
      coreYears: [],
      coreYearHitCounts: {},
      coreYearSatisfiedCount: 0,
      minCoreYearHitCount: 0,
      violatingYears: [],
    }
  }
  if (!Number.isInteger(resolvedMinTrainHitsPerCoreYear) || resolvedMinTrainHitsPerCoreYear < 1) {
    throw new Error("minTrainHitsPerCoreYear must be a positive integer")
  }
  const normalizedCoreYearHitCounts = Object.fromEntries(
    resolvedCoreYears.map((yearKey) => [String(yearKey), Number(coreYearHitCounts?.[String(yearKey)] ?? 0)]),
  )
  const violatingYears = resolvedCoreYears.filter(
    (yearKey) => Number(normalizedCoreYearHitCounts[String(yearKey)] ?? 0) < resolvedMinTrainHitsPerCoreYear,
  )
  const minCoreYearHitCount =
    resolvedCoreYears.length > 0
      ? Math.min(...resolvedCoreYears.map((yearKey) => Number(normalizedCoreYearHitCounts[String(yearKey)] ?? 0)))
      : 0
  const coreYearSatisfiedCount = resolvedCoreYears.filter(
    (yearKey) => Number(normalizedCoreYearHitCounts[String(yearKey)] ?? 0) >= resolvedMinTrainHitsPerCoreYear,
  ).length
  return {
    ok: violatingYears.length < 1,
    reason: violatingYears.length < 1 ? null : PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON,
    coreYears: resolvedCoreYears,
    coreYearHitCounts: normalizedCoreYearHitCounts,
    coreYearSatisfiedCount,
    minCoreYearHitCount,
    violatingYears,
    minTrainHitsPerCoreYear: resolvedMinTrainHitsPerCoreYear,
  }
}

export const evaluatePerfectPrototypeYearHitUpperBoundGuard = ({
  hitDates,
  coreYears = [],
  excludedBoundaryYears = [],
  minTrainHitsPerCoreYear = null,
} = {}) => {
  const counts = buildPerfectPrototypeYearHitCountsFromHitDates({
    hitDates,
    coreYears,
    excludedBoundaryYears,
  })
  const guard = evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
    coreYearHitCounts: counts.coreYearHitCounts,
    coreYears: counts.coreYears,
    minTrainHitsPerCoreYear,
  })
  return {
    ...guard,
    allYearHitCounts: counts.allYearHitCounts,
    excludedBoundaryYears: counts.excludedBoundaryYears,
  }
}
