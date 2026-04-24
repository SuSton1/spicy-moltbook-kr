const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => num(value))
        .filter((value) => Number.isFinite(value)),
    ),
  ).sort((left, right) => Number(left) - Number(right))

const uniqueSortedBooleans = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "boolean"),
    ),
  ).sort((left, right) => Number(left) - Number(right))

const hasMeaningfulValue = (value) => {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item))
  if (typeof value === "object") {
    return Object.values(value).some((item) => hasMeaningfulValue(item))
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  return String(value).trim().length > 0
}

const PREJUMP_FORBIDDEN_DIRECT_KEYS = Object.freeze([
  "eventDate",
  "jumpPct",
  "jumpPctFromPrevClose",
  "jumpPctFromOpen",
  "closeRetPct",
  "gapOpenPct",
])

const PREJUMP_FORBIDDEN_MARKET_KEYS = new Set([
  "jumpMedian",
  "jumpP75",
  "jumpP90",
  "closeMedian",
  "closeP75",
  "gapMedian",
  "absGapMedian",
  "strongCloseShare",
  "gapUpShare",
  "wideGapShare",
])

const PREJUMP_FORBIDDEN_XSEC_KEYS = new Set([
  "jumpRankPct",
  "closeRankPct",
  "gapRankPct",
  "absGapRankPct",
  "jumpVsMedian",
  "closeVsMedian",
  "gapVsMedian",
  "jumpVsP90",
  "closeVsP75",
])

const PREJUMP_FORBIDDEN_TAG_PREFIXES = Object.freeze([
  "tag:event.",
  "tag:market.jumpRegime:",
  "tag:xsec.jumpRank:",
  "tag:xsec.closeRank:",
  "tag:xsec.gapRank:",
  "tag:xsec.jumpVsMedian:",
  "tag:xsec.closeVsMedian:",
])

export const PREJUMP_PREDICTIVE_STRATEGY_MODE = "PREJUMP_PREDICTIVE_V1"
export const PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE = "v5_prejump_contextual"

export const isPrejumpPredictiveStrategyMode = (value) =>
  String(value ?? "").trim().toUpperCase() === PREJUMP_PREDICTIVE_STRATEGY_MODE

export const isPrejumpPredictiveSurface = (value) =>
  String(value ?? "").trim().toLowerCase() === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE

export const assertNoPrejumpLeakageRow = (row, options = {}) => {
  const label =
    String(options?.label ?? "").trim() ||
    `${String(row?.symbol ?? "?")}:${String(row?.dateKey ?? row?.decisionDateKey ?? "?")}`

  if (!isPrejumpPredictiveStrategyMode(row?.strategyMode)) {
    return row
  }

  if (hasMeaningfulValue(row?.eventMeta)) {
    throw new Error(`Prejump predictive row leaked eventMeta: ${label}`)
  }
  if (hasMeaningfulValue(row?.eventFeatureVec)) {
    throw new Error(`Prejump predictive row leaked eventFeatureVec: ${label}`)
  }

  for (const key of PREJUMP_FORBIDDEN_DIRECT_KEYS) {
    if (key === "eventDate") {
      if (String(row?.eventDate ?? "").trim()) {
        throw new Error(`Prejump predictive row leaked eventDate: ${label}`)
      }
      continue
    }
    if (Number.isFinite(num(row?.[key]))) {
      throw new Error(`Prejump predictive row leaked direct ${key}: ${label}`)
    }
  }

  const decisionDateKey = String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()
  const asOfDateKey = String(row?.asOfDateKey ?? "").trim()
  if (decisionDateKey && asOfDateKey && decisionDateKey !== asOfDateKey) {
    throw new Error(`Prejump predictive row has mismatched decision/as-of dates: ${label}`)
  }

  const marketContextKeys = Object.keys(row?.marketContextVec ?? {})
  for (const key of marketContextKeys) {
    if (PREJUMP_FORBIDDEN_MARKET_KEYS.has(key)) {
      throw new Error(`Prejump predictive row leaked market context key ${key}: ${label}`)
    }
  }

  const xsecKeys = Object.keys(row?.xsecEventVec ?? {})
  for (const key of xsecKeys) {
    if (PREJUMP_FORBIDDEN_XSEC_KEYS.has(key)) {
      throw new Error(`Prejump predictive row leaked xsec context key ${key}: ${label}`)
    }
  }

  const tags = [
    ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
    ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
  ]
  for (const token of tags) {
    if (PREJUMP_FORBIDDEN_TAG_PREFIXES.some((prefix) => String(token).startsWith(prefix))) {
      throw new Error(`Prejump predictive row leaked forbidden categorical token ${token}: ${label}`)
    }
  }

  return row
}

export const assertNoPrejumpLeakageRows = (rows, options = {}) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  for (let index = 0; index < sourceRows.length; index += 1) {
    assertNoPrejumpLeakageRow(sourceRows[index], {
      ...options,
      label: options?.labelBuilder ? options.labelBuilder(sourceRows[index], index) : undefined,
    })
  }
  return sourceRows
}

export const normalizePerfectPrototypeDatasetContract = (contract) => {
  const source = contract && typeof contract === "object" ? contract : {}
  const strategyModes = uniqueSortedStrings([
    ...((Array.isArray(source?.strategyModes) ? source.strategyModes : [])),
    source?.strategyMode,
  ])
  const baselineLineIds = uniqueSortedStrings([
    ...((Array.isArray(source?.baselineLineIds) ? source.baselineLineIds : [])),
    source?.baselineLineId,
  ])
  const discoveryUniverseIds = uniqueSortedStrings([
    ...((Array.isArray(source?.discoveryUniverseIds) ? source.discoveryUniverseIds : [])),
    source?.discoveryUniverseId,
  ])
  const requestedLookbackTradingDaysValues = uniqueSortedNumbers([
    ...((Array.isArray(source?.requestedLookbackTradingDaysValues)
      ? source.requestedLookbackTradingDaysValues
      : [])),
    source?.requestedLookbackTradingDays,
  ])
  const enabledRecentImpulseLanes = uniqueSortedStrings(
    (Array.isArray(source?.enabledRecentImpulseLanes) ? source.enabledRecentImpulseLanes : [source?.enabledRecentImpulseLanes])
      .flat(),
  )
  const allowedStepALanes = uniqueSortedStrings(
    (Array.isArray(source?.allowedStepALanes) ? source.allowedStepALanes : [source?.allowedStepALanes]).flat(),
  )
  const includeSameDayHigh8Values = uniqueSortedBooleans([
    ...((Array.isArray(source?.includeSameDayHigh8Values) ? source.includeSameDayHigh8Values : [])),
    source?.includeSameDayHigh8,
  ])
  return {
    rowCount: Number(source?.rowCount ?? 0) || 0,
    strategyModes,
    strategyMode: strategyModes.length === 1 ? strategyModes[0] : null,
    minDateKey: String(source?.minDateKey ?? "").trim() || null,
    maxDateKey: String(source?.maxDateKey ?? "").trim() || null,
    hasMeaningfulEventMetaRows: source?.hasMeaningfulEventMetaRows === true,
    hasMeaningfulEventFeatureRows: source?.hasMeaningfulEventFeatureRows === true,
    hasForbiddenPredictiveTags: source?.hasForbiddenPredictiveTags === true,
    baselineLineIds,
    baselineLineId: baselineLineIds.length === 1 ? baselineLineIds[0] : null,
    discoveryUniverseIds,
    discoveryUniverseId: discoveryUniverseIds.length === 1 ? discoveryUniverseIds[0] : null,
    requestedLookbackTradingDaysValues,
    requestedLookbackTradingDays:
      requestedLookbackTradingDaysValues.length === 1 ? requestedLookbackTradingDaysValues[0] : null,
    enabledRecentImpulseLanes,
    allowedStepALanes,
    includeSameDayHigh8Values,
    includeSameDayHigh8: includeSameDayHigh8Values.length === 1 ? includeSameDayHigh8Values[0] : null,
  }
}

const valuesMatch = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : [])
  }
  return left === right
}

export const assertPerfectPrototypeDatasetContractCompatible = ({
  expected,
  actual,
  expectedLabel = "catalog",
  actualLabel = "input",
} = {}) => {
  const normalizedExpected = normalizePerfectPrototypeDatasetContract(expected)
  const normalizedActual = normalizePerfectPrototypeDatasetContract(actual)
  const mismatches = []
  const comparableFields = [
    ["strategyModes", "strategyModes"],
    ["baselineLineIds", "baselineLineIds"],
    ["discoveryUniverseIds", "discoveryUniverseIds"],
    ["requestedLookbackTradingDaysValues", "requestedLookbackTradingDaysValues"],
    ["enabledRecentImpulseLanes", "enabledRecentImpulseLanes"],
    ["allowedStepALanes", "allowedStepALanes"],
    ["includeSameDayHigh8Values", "includeSameDayHigh8Values"],
  ]
  for (const [field, label] of comparableFields) {
    const expectedValue = normalizedExpected[field]
    const actualValue = normalizedActual[field]
    if (!hasMeaningfulValue(expectedValue) || !hasMeaningfulValue(actualValue)) continue
    if (valuesMatch(expectedValue, actualValue)) continue
    mismatches.push(
      `${label} mismatch: ${expectedLabel}=${JSON.stringify(expectedValue)} ${actualLabel}=${JSON.stringify(actualValue)}`,
    )
  }
  if (mismatches.length > 0) {
    throw new Error(
      [
        "Perfect prototype dataset contract mismatch.",
        ...mismatches,
      ].join(" "),
    )
  }
  return {
    expected: normalizedExpected,
    actual: normalizedActual,
  }
}

export const inferPerfectPrototypeDatasetContract = (rows) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const strategyModes = uniqueSortedStrings(sourceRows.map((row) => row?.strategyMode))
  const dateKeys = uniqueSortedStrings(
    sourceRows.map((row) => row?.dateKey ?? row?.decisionDateKey ?? row?.eventDate),
  )
  return normalizePerfectPrototypeDatasetContract({
    rowCount: sourceRows.length,
    strategyModes,
    minDateKey: dateKeys[0] ?? null,
    maxDateKey: dateKeys[dateKeys.length - 1] ?? null,
    hasMeaningfulEventMetaRows: sourceRows.some((row) => hasMeaningfulValue(row?.eventMeta)),
    hasMeaningfulEventFeatureRows: sourceRows.some((row) => hasMeaningfulValue(row?.eventFeatureVec)),
    hasForbiddenPredictiveTags: sourceRows.some((row) => {
      const tags = [
        ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
        ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
      ]
      return tags.some((token) =>
        PREJUMP_FORBIDDEN_TAG_PREFIXES.some((prefix) => String(token).startsWith(prefix)),
      )
    }),
    baselineLineIds: sourceRows.map((row) => row?.baselineLineId),
    discoveryUniverseIds: sourceRows.map((row) => row?.discoveryUniverseId),
    requestedLookbackTradingDaysValues: sourceRows.map((row) => row?.requestedLookbackTradingDays),
    enabledRecentImpulseLanes: sourceRows.flatMap((row) =>
      Array.isArray(row?.enabledRecentImpulseLanes) ? row.enabledRecentImpulseLanes : [row?.enabledRecentImpulseLanes],
    ),
    allowedStepALanes: sourceRows.flatMap((row) =>
      Array.isArray(row?.allowedStepALanes) ? row.allowedStepALanes : [row?.allowedStepALanes],
    ),
    includeSameDayHigh8Values: sourceRows.map((row) => row?.includeSameDayHigh8),
  })
}
