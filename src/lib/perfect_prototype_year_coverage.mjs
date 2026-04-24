import { normalizeDateKey } from "./date.mjs"

const toText = (value) => String(value ?? "").trim()

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

const resolveDecisionDateKey = (row) =>
  normalizeDateKey(row?.decisionDateKey ?? row?.dateKey ?? row?.recommendationDateKey ?? row?.eventDate ?? null)

export const buildPerfectPrototypeYearKey = (dateKey) => {
  const normalizedDateKey = normalizeDateKey(dateKey)
  if (!normalizedDateKey) return null
  const yearValue = Number(normalizedDateKey.slice(0, 4))
  return Number.isInteger(yearValue) ? yearValue : null
}

export const buildPerfectPrototypeYearHitCounts = ({ rowIndexes, rows }) => {
  const safeIndexes = Array.isArray(rowIndexes) ? rowIndexes : []
  const safeRows = Array.isArray(rows) ? rows : []
  const counts = new Map()
  const matchedDateKeys = []
  for (const rawIndex of safeIndexes) {
    const rowIndex = Number(rawIndex)
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= safeRows.length) {
      throw new Error(`rule row index is out of range: ${rawIndex}`)
    }
    const row = safeRows[rowIndex]
    const decisionDateKey = resolveDecisionDateKey(row)
    if (!decisionDateKey) {
      throw new Error(`rule matched row is missing decisionDateKey at index=${rowIndex}`)
    }
    matchedDateKeys.push(decisionDateKey)
    const yearKey = buildPerfectPrototypeYearKey(decisionDateKey)
    if (!Number.isInteger(yearKey)) {
      throw new Error(`could not derive yearKey from decisionDateKey=${decisionDateKey}`)
    }
    counts.set(yearKey, Number(counts.get(yearKey) ?? 0) + 1)
  }
  return {
    yearHitCounts: Object.fromEntries(
      Array.from(counts.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([yearKey, hitCount]) => [String(yearKey), hitCount]),
    ),
    matchedDateKeys: matchedDateKeys.sort((left, right) => left.localeCompare(right)),
  }
}

const buildPerfectPrototypeRuleMatchLookup = (matches) => {
  const lookup = new Map()
  for (const row of Array.isArray(matches) ? matches : []) {
    const matchedRuleIds = Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : []
    const decisionDateKey = resolveDecisionDateKey(row)
    const yearKey = buildPerfectPrototypeYearKey(decisionDateKey)
    const outcomeHitTarget = row?.outcomeHitTarget === true
    const outcomeMissTarget = row?.outcomeHitTarget === false
    for (const rawRuleId of matchedRuleIds) {
      const ruleId = toText(rawRuleId)
      if (!ruleId) continue
      const current = lookup.get(ruleId) ?? {
        positiveYearCounts: new Map(),
        positiveDateKeys: [],
        positiveMatchCount: 0,
        negativeMatchCount: 0,
      }
      if (outcomeHitTarget === true) {
        if (!decisionDateKey || !Number.isInteger(yearKey)) {
          throw new Error(`rule ${ruleId} matched positive row without valid decisionDateKey`)
        }
        current.positiveMatchCount += 1
        current.positiveDateKeys.push(decisionDateKey)
        current.positiveYearCounts.set(yearKey, Number(current.positiveYearCounts.get(yearKey) ?? 0) + 1)
      } else if (outcomeMissTarget === true) {
        current.negativeMatchCount += 1
      }
      lookup.set(ruleId, current)
    }
  }
  return lookup
}

export const buildPerfectPrototypeRuleYearCoverage = ({
  rule,
  rows,
  coreYears,
  minHitsPerCoreYear,
} = {}) => {
  const safeRule = rule ?? {}
  const ruleId = toText(safeRule?.ruleId)
  if (!ruleId) {
    throw new Error("rule.ruleId is required")
  }
  const positiveMatchRowIndexes = Array.isArray(safeRule?.positiveMatchRowIndexes)
    ? safeRule.positiveMatchRowIndexes
    : Array.isArray(safeRule?.matchRowIndexes)
      ? safeRule.matchRowIndexes
      : null
  if (!Array.isArray(positiveMatchRowIndexes)) {
    throw new Error(`rule ${ruleId} is missing positiveMatchRowIndexes`)
  }
  const resolvedCoreYears = uniqueSortedNumbers(coreYears)
  if (resolvedCoreYears.length < 1) {
    throw new Error(`rule ${ruleId} requires at least one core year`)
  }
  const resolvedMinHitsPerCoreYear = Number(minHitsPerCoreYear)
  if (!Number.isInteger(resolvedMinHitsPerCoreYear) || resolvedMinHitsPerCoreYear < 1) {
    throw new Error(`rule ${ruleId} requires minHitsPerCoreYear >= 1`)
  }
  const { yearHitCounts, matchedDateKeys } = buildPerfectPrototypeYearHitCounts({
    rowIndexes: positiveMatchRowIndexes,
    rows,
  })
  const coreYearHitCounts = Object.fromEntries(
    resolvedCoreYears.map((yearKey) => [String(yearKey), Number(yearHitCounts[String(yearKey)] ?? 0)]),
  )
  const violatingYears = resolvedCoreYears.filter(
    (yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0) < resolvedMinHitsPerCoreYear,
  )
  const matchedYears = uniqueSortedNumbers(Object.keys(yearHitCounts))
  const minCoreYearHitCount =
    resolvedCoreYears.length > 0
      ? Math.min(...resolvedCoreYears.map((yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0)))
      : 0
  return {
    ruleId,
    ruleSize: Number(safeRule?.ruleSize ?? (Array.isArray(safeRule?.tokens) ? safeRule.tokens.length : 0)),
    trainHitCount: Number(safeRule?.trainHitCount ?? safeRule?.matchHitCount ?? positiveMatchRowIndexes.length),
    matchedYears,
    matchedYearCount: matchedYears.length,
    yearHitCounts,
    coreYears: resolvedCoreYears,
    coreYearHitCounts,
    coreYearsSatisfiedCount: resolvedCoreYears.filter(
      (yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0) >= resolvedMinHitsPerCoreYear,
    ).length,
    minHitsPerCoreYear: resolvedMinHitsPerCoreYear,
    minCoreYearHitCount,
    violatingYears,
    passesMinHitsPerCoreYear: violatingYears.length < 1,
    firstMatchedDateKey: matchedDateKeys[0] ?? null,
    lastMatchedDateKey: matchedDateKeys[matchedDateKeys.length - 1] ?? null,
  }
}

export const buildPerfectPrototypeRuleYearCoverageFromMatches = ({
  rule,
  matchLookup,
  coreYears,
  minHitsPerCoreYear,
} = {}) => {
  const safeRule = rule ?? {}
  const ruleId = toText(safeRule?.ruleId)
  if (!ruleId) {
    throw new Error("rule.ruleId is required")
  }
  const resolvedCoreYears = uniqueSortedNumbers(coreYears)
  if (resolvedCoreYears.length < 1) {
    throw new Error(`rule ${ruleId} requires at least one core year`)
  }
  const resolvedMinHitsPerCoreYear = Number(minHitsPerCoreYear)
  if (!Number.isInteger(resolvedMinHitsPerCoreYear) || resolvedMinHitsPerCoreYear < 1) {
    throw new Error(`rule ${ruleId} requires minHitsPerCoreYear >= 1`)
  }
  const current = matchLookup instanceof Map ? matchLookup.get(ruleId) ?? null : null
  const positiveYearCounts = current?.positiveYearCounts instanceof Map ? current.positiveYearCounts : new Map()
  const yearHitCounts = Object.fromEntries(
    Array.from(positiveYearCounts.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([yearKey, hitCount]) => [String(yearKey), hitCount]),
  )
  const coreYearHitCounts = Object.fromEntries(
    resolvedCoreYears.map((yearKey) => [String(yearKey), Number(yearHitCounts[String(yearKey)] ?? 0)]),
  )
  const violatingYears = resolvedCoreYears.filter(
    (yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0) < resolvedMinHitsPerCoreYear,
  )
  const matchedYears = uniqueSortedNumbers(Object.keys(yearHitCounts))
  const positiveDateKeys = Array.isArray(current?.positiveDateKeys)
    ? [...current.positiveDateKeys].sort((left, right) => left.localeCompare(right))
    : []
  const negativeMatchCount = Number(current?.negativeMatchCount ?? 0)
  if (negativeMatchCount > 0 && Number(safeRule?.trainNegativeCount ?? 0) === 0) {
    throw new Error(`rule ${ruleId} has ${negativeMatchCount} negative train matches despite trainNegativeCount=0`)
  }
  const minCoreYearHitCount =
    resolvedCoreYears.length > 0
      ? Math.min(...resolvedCoreYears.map((yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0)))
      : 0
  return {
    ruleId,
    ruleSize: Number(safeRule?.ruleSize ?? (Array.isArray(safeRule?.tokens) ? safeRule.tokens.length : 0)),
    trainHitCount: Number(safeRule?.trainHitCount ?? current?.positiveMatchCount ?? 0),
    matchedYears,
    matchedYearCount: matchedYears.length,
    yearHitCounts,
    coreYears: resolvedCoreYears,
    coreYearHitCounts,
    coreYearsSatisfiedCount: resolvedCoreYears.filter(
      (yearKey) => Number(coreYearHitCounts[String(yearKey)] ?? 0) >= resolvedMinHitsPerCoreYear,
    ).length,
    minHitsPerCoreYear: resolvedMinHitsPerCoreYear,
    minCoreYearHitCount,
    violatingYears,
    passesMinHitsPerCoreYear: violatingYears.length < 1,
    firstMatchedDateKey: positiveDateKeys[0] ?? null,
    lastMatchedDateKey: positiveDateKeys[positiveDateKeys.length - 1] ?? null,
    positiveMatchCount: Number(current?.positiveMatchCount ?? 0),
    negativeMatchCount,
  }
}

export const buildPerfectPrototypeYearCoverageAudit = ({
  catalog,
  rows,
  coreYears,
  minHitsPerCoreYear,
} = {}) => {
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
  const resolvedCoreYears = uniqueSortedNumbers(coreYears)
  const coverageRows = rules.map((rule) =>
    buildPerfectPrototypeRuleYearCoverage({
      rule,
      rows,
      coreYears: resolvedCoreYears,
      minHitsPerCoreYear,
    }),
  )
  const survivorRuleIds = coverageRows
    .filter((row) => row.passesMinHitsPerCoreYear === true)
    .map((row) => row.ruleId)
  const minCoreYearHitCountValues = coverageRows.map((row) => Number(row.minCoreYearHitCount ?? 0))
  return {
    rows: coverageRows,
    summary: {
      totalRuleCount: rules.length,
      survivorRuleCount: survivorRuleIds.length,
      survivorShare: rules.length > 0 ? survivorRuleIds.length / rules.length : 0,
      coreYears: resolvedCoreYears,
      minHitsPerCoreYear: Number(minHitsPerCoreYear),
      ruleIdsWithZeroCoreYearHits: coverageRows.filter((row) => Number(row.minCoreYearHitCount ?? 0) < 1).length,
      ruleIdsBelowTargetButNonZeroCoreYears: coverageRows.filter(
        (row) =>
          Number(row.minCoreYearHitCount ?? 0) > 0 &&
          Number(row.minCoreYearHitCount ?? 0) < Number(minHitsPerCoreYear),
      ).length,
      minObservedCoreYearHitCount: minCoreYearHitCountValues.length > 0 ? Math.min(...minCoreYearHitCountValues) : 0,
      maxObservedCoreYearHitCount: minCoreYearHitCountValues.length > 0 ? Math.max(...minCoreYearHitCountValues) : 0,
      survivorRuleIds,
    },
  }
}

export const buildPerfectPrototypeYearCoverageAuditFromMatches = ({
  catalog,
  matches,
  coreYears,
  minHitsPerCoreYear,
} = {}) => {
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
  const resolvedCoreYears = uniqueSortedNumbers(coreYears)
  const matchLookup = buildPerfectPrototypeRuleMatchLookup(matches)
  const coverageRows = rules.map((rule) =>
    buildPerfectPrototypeRuleYearCoverageFromMatches({
      rule,
      matchLookup,
      coreYears: resolvedCoreYears,
      minHitsPerCoreYear,
    }),
  )
  const survivorRuleIds = coverageRows
    .filter((row) => row.passesMinHitsPerCoreYear === true)
    .map((row) => row.ruleId)
  const minCoreYearHitCountValues = coverageRows.map((row) => Number(row.minCoreYearHitCount ?? 0))
  return {
    rows: coverageRows,
    summary: {
      totalRuleCount: rules.length,
      survivorRuleCount: survivorRuleIds.length,
      survivorShare: rules.length > 0 ? survivorRuleIds.length / rules.length : 0,
      coreYears: resolvedCoreYears,
      minHitsPerCoreYear: Number(minHitsPerCoreYear),
      ruleIdsWithZeroCoreYearHits: coverageRows.filter((row) => Number(row.minCoreYearHitCount ?? 0) < 1).length,
      ruleIdsBelowTargetButNonZeroCoreYears: coverageRows.filter(
        (row) =>
          Number(row.minCoreYearHitCount ?? 0) > 0 &&
          Number(row.minCoreYearHitCount ?? 0) < Number(minHitsPerCoreYear),
      ).length,
      minObservedCoreYearHitCount: minCoreYearHitCountValues.length > 0 ? Math.min(...minCoreYearHitCountValues) : 0,
      maxObservedCoreYearHitCount: minCoreYearHitCountValues.length > 0 ? Math.max(...minCoreYearHitCountValues) : 0,
      survivorRuleIds,
    },
  }
}
