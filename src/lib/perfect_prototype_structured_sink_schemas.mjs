const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value)

const cloneDefaultValue = (value) => {
  if (Array.isArray(value)) return value.slice()
  if (isPlainObject(value)) return { ...value }
  return value
}

const parseStructuredJsonColumn = ({ value, columnName, defaultValue }) => {
  if (value == null) {
    return cloneDefaultValue(defaultValue)
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    return value
  }
  const text = String(value)
  try {
    return JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Perfect prototype structured parquet field must contain valid JSON text: column=${columnName} cause=${reason}`,
    )
  }
}

const serializeArrayOrEmpty = (values) =>
  Array.isArray(values) || ArrayBuffer.isView(values) ? Array.from(values) : []

export const PERFECT_PROTOTYPE_TYPED_WRAPPER_STRUCTURED_FIELDS = Object.freeze([
  { name: "featureVec", defaultValue: {} },
  { name: "globalFeatureVec", defaultValue: {} },
  { name: "eventFeatureVec", defaultValue: {} },
  { name: "marketContextVec", defaultValue: {} },
  { name: "xsecEventVec", defaultValue: {} },
  { name: "seq40", defaultValue: [] },
  { name: "seq150", defaultValue: [] },
  { name: "eventOutcome", defaultValue: null },
  { name: "raw", defaultValue: null },
  { name: "categoricalTokens", defaultValue: [] },
  { name: "numericFeatureMap", defaultValue: {} },
])

export const PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA = Object.freeze([
  { name: "rowOrdinal", duckdbType: "BIGINT" },
  { name: "sourceType", duckdbType: "TEXT" },
  { name: "sourceId", duckdbType: "TEXT" },
  { name: "symbol", duckdbType: "TEXT" },
  { name: "dateKey", duckdbType: "TEXT" },
  { name: "asOfDateKey", duckdbType: "TEXT" },
  { name: "strategyMode", duckdbType: "TEXT" },
  { name: "featureVec", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "globalFeatureVec", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "eventFeatureVec", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "marketContextVec", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "xsecEventVec", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "seq40", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "seq150", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "outcomeHitTarget", duckdbType: "BOOLEAN" },
  { name: "eventOutcome", duckdbType: "TEXT", structured: true, defaultValue: null },
  { name: "raw", duckdbType: "TEXT", structured: true, defaultValue: null },
  { name: "categoricalTokens", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "numericFeatureMap", duckdbType: "TEXT", structured: true, defaultValue: {} },
  { name: "name", duckdbType: "TEXT" },
  { name: "targetDateKey", duckdbType: "TEXT" },
  { name: "contextSurface", duckdbType: "TEXT" },
])

export const deserializePerfectPrototypeTypedWrapperRow = (wrapper) => {
  if (!wrapper || typeof wrapper !== "object") return {}
  const row = {
    ...wrapper,
  }
  for (const field of PERFECT_PROTOTYPE_TYPED_WRAPPER_STRUCTURED_FIELDS) {
    row[field.name] = parseStructuredJsonColumn({
      value: row[field.name],
      columnName: field.name,
      defaultValue: field.defaultValue,
    })
  }
  return row
}

export const PERFECT_PROTOTYPE_FEATURE_STATS_SINK_SCHEMA = Object.freeze([
  { name: "featureKey", duckdbType: "TEXT" },
  { name: "count", duckdbType: "BIGINT" },
  { name: "min", duckdbType: "DOUBLE" },
  { name: "max", duckdbType: "DOUBLE" },
])

export const PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_SINK_SCHEMA = Object.freeze([
  { name: "featureKey", duckdbType: "TEXT" },
  { name: "offset", duckdbType: "BIGINT" },
  { name: "count", duckdbType: "BIGINT" },
  { name: "min", duckdbType: "DOUBLE" },
  { name: "max", duckdbType: "DOUBLE" },
])

export const PERFECT_PROTOTYPE_PARTIAL_RULES_SINK_SCHEMA = Object.freeze([
  { name: "ruleId", duckdbType: "TEXT" },
  { name: "familyId", duckdbType: "TEXT" },
  { name: "tokens", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "rank", duckdbType: "BIGINT" },
  { name: "ruleSize", duckdbType: "BIGINT" },
  { name: "trainMatchCount", duckdbType: "BIGINT" },
  { name: "trainHitCount", duckdbType: "BIGINT" },
  { name: "trainHitCountRaw", duckdbType: "BIGINT" },
  { name: "trainHitCountCapped", duckdbType: "BIGINT" },
  { name: "trainNegativeCount", duckdbType: "BIGINT" },
  { name: "hitCountMode", duckdbType: "TEXT" },
  { name: "hitCountDaySymbolCap", duckdbType: "BIGINT" },
  { name: "precision", duckdbType: "DOUBLE" },
  { name: "maxGapTradingDays", duckdbType: "BIGINT" },
  { name: "startGapTradingDays", duckdbType: "BIGINT" },
  { name: "endGapTradingDays", duckdbType: "BIGINT" },
  { name: "firstHitDate", duckdbType: "TEXT" },
  { name: "lastHitDate", duckdbType: "TEXT" },
  { name: "maxSymbolsMatchedPerDate", duckdbType: "BIGINT" },
  { name: "matchedSymbolCount", duckdbType: "BIGINT" },
  { name: "matchedSymbols", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "matchedDateCount", duckdbType: "BIGINT" },
  { name: "matchedMonthCount", duckdbType: "BIGINT" },
  { name: "matchedQuarterCount", duckdbType: "BIGINT" },
  { name: "matchedFoldCount", duckdbType: "BIGINT" },
  { name: "matchedGlobalTopCount", duckdbType: "BIGINT" },
  { name: "matchedGlobalHighCount", duckdbType: "BIGINT" },
  { name: "matchedGlobalMidCount", duckdbType: "BIGINT" },
  { name: "matchedGlobalLowCount", duckdbType: "BIGINT" },
  { name: "matchedGlobalTopShare", duckdbType: "DOUBLE" },
  { name: "matchedGlobalHighShare", duckdbType: "DOUBLE" },
  { name: "matchedGlobalMidShare", duckdbType: "DOUBLE" },
  { name: "matchedGlobalLowShare", duckdbType: "DOUBLE" },
  { name: "matchedLaneTopCount", duckdbType: "BIGINT" },
  { name: "matchedLaneHighCount", duckdbType: "BIGINT" },
  { name: "matchedLaneMidCount", duckdbType: "BIGINT" },
  { name: "matchedLaneLowCount", duckdbType: "BIGINT" },
  { name: "matchedLaneTopShare", duckdbType: "DOUBLE" },
  { name: "matchedLaneHighShare", duckdbType: "DOUBLE" },
  { name: "matchedLaneMidShare", duckdbType: "DOUBLE" },
  { name: "matchedLaneLowShare", duckdbType: "DOUBLE" },
  { name: "matchedLaneThinPoolCount", duckdbType: "BIGINT" },
  { name: "matchedLaneThinPoolShare", duckdbType: "DOUBLE" },
  { name: "matchedSameDayHigh8Count", duckdbType: "BIGINT" },
  { name: "matchedSameDayHigh8Share", duckdbType: "DOUBLE" },
  { name: "matchedRecentImpulse1dCount", duckdbType: "BIGINT" },
  { name: "matchedRecentImpulse1dShare", duckdbType: "DOUBLE" },
  { name: "matchedGapRankTopCount", duckdbType: "BIGINT" },
  { name: "matchedGapRankTopShare", duckdbType: "DOUBLE" },
  { name: "matchedGapRankHighCount", duckdbType: "BIGINT" },
  { name: "matchedGapRankHighShare", duckdbType: "DOUBLE" },
  { name: "matchedJumpVsMedianBelowCount", duckdbType: "BIGINT" },
  { name: "matchedJumpVsMedianBelowShare", duckdbType: "DOUBLE" },
  { name: "top1DateHitCount", duckdbType: "BIGINT" },
  { name: "top3DateHitCount", duckdbType: "BIGINT" },
  { name: "top1DateHitShare", duckdbType: "DOUBLE" },
  { name: "top3DateHitShare", duckdbType: "DOUBLE" },
  { name: "top1FoldHitCount", duckdbType: "BIGINT" },
  { name: "top3FoldHitCount", duckdbType: "BIGINT" },
  { name: "top1FoldHitShare", duckdbType: "DOUBLE" },
  { name: "top3FoldHitShare", duckdbType: "DOUBLE" },
  { name: "matchedDateSignatureHash", duckdbType: "TEXT" },
  { name: "matchedMonthSignatureHash", duckdbType: "TEXT" },
  { name: "matchedQuarterSignatureHash", duckdbType: "TEXT" },
  { name: "matchedFoldSignatureHash", duckdbType: "TEXT" },
  { name: "sampleMatchIds", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "matchRowIndexes", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "positiveMatchRowIndexes", duckdbType: "TEXT", structured: true, defaultValue: [] },
  { name: "negativeMatchRowIndexes", duckdbType: "TEXT", structured: true, defaultValue: [] },
])

const PARTIAL_RULE_ARRAY_FIELDS = Object.freeze([
  { name: "tokens", defaultValue: [] },
  { name: "matchedSymbols", defaultValue: [] },
  { name: "sampleMatchIds", defaultValue: [] },
  { name: "matchRowIndexes", defaultValue: [] },
  { name: "positiveMatchRowIndexes", defaultValue: [] },
  { name: "negativeMatchRowIndexes", defaultValue: [] },
])

const PARTIAL_RULE_OPTIONAL_SCALAR_FIELDS = Object.freeze([
  "familyId",
  "trainHitCountRaw",
  "trainHitCountCapped",
  "hitCountMode",
  "hitCountDaySymbolCap",
  "maxSymbolsMatchedPerDate",
  "matchedMonthCount",
  "matchedQuarterCount",
  "matchedFoldCount",
  "matchedGlobalTopCount",
  "matchedGlobalHighCount",
  "matchedGlobalMidCount",
  "matchedGlobalLowCount",
  "matchedGlobalTopShare",
  "matchedGlobalHighShare",
  "matchedGlobalMidShare",
  "matchedGlobalLowShare",
  "matchedLaneTopCount",
  "matchedLaneHighCount",
  "matchedLaneMidCount",
  "matchedLaneLowCount",
  "matchedLaneTopShare",
  "matchedLaneHighShare",
  "matchedLaneMidShare",
  "matchedLaneLowShare",
  "matchedLaneThinPoolCount",
  "matchedLaneThinPoolShare",
  "matchedSameDayHigh8Count",
  "matchedSameDayHigh8Share",
  "matchedRecentImpulse1dCount",
  "matchedRecentImpulse1dShare",
  "matchedGapRankTopCount",
  "matchedGapRankTopShare",
  "matchedGapRankHighCount",
  "matchedGapRankHighShare",
  "matchedJumpVsMedianBelowCount",
  "matchedJumpVsMedianBelowShare",
  "top1DateHitCount",
  "top3DateHitCount",
  "top1DateHitShare",
  "top3DateHitShare",
  "top1FoldHitCount",
  "top3FoldHitCount",
  "top1FoldHitShare",
  "top3FoldHitShare",
  "matchedDateSignatureHash",
  "matchedMonthSignatureHash",
  "matchedQuarterSignatureHash",
  "matchedFoldSignatureHash",
])

export const serializePerfectPrototypePartialRuleRow = (rule) => ({
  ...rule,
  tokens: serializeArrayOrEmpty(rule?.tokens),
  matchedSymbols: serializeArrayOrEmpty(rule?.matchedSymbols),
  sampleMatchIds: serializeArrayOrEmpty(rule?.sampleMatchIds),
  matchRowIndexes: serializeArrayOrEmpty(rule?.matchRowIndexes),
  positiveMatchRowIndexes: serializeArrayOrEmpty(rule?.positiveMatchRowIndexes),
  negativeMatchRowIndexes: serializeArrayOrEmpty(rule?.negativeMatchRowIndexes),
})

export const deserializePerfectPrototypePartialRuleRow = (row) => {
  const next = {
    ...(row && typeof row === "object" ? row : {}),
  }
  for (const field of PARTIAL_RULE_ARRAY_FIELDS) {
    next[field.name] = parseStructuredJsonColumn({
      value: next[field.name],
      columnName: field.name,
      defaultValue: field.defaultValue,
    })
  }
  for (const fieldName of PARTIAL_RULE_OPTIONAL_SCALAR_FIELDS) {
    if (next[fieldName] == null) {
      delete next[fieldName]
    }
  }
  return next
}
