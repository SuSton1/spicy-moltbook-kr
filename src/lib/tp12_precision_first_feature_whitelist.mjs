import { toText } from "./tp12_year2hit_foundation_io.mjs"

export const PATCH_KEY = "tp12_year2hit_precision_first_daily_only_v1"

export const REQUIRED_ID_FIELDS = [
  "decisionDateKey",
  "symbol",
  "hitTarget",
]

export const LIVE_FEATURE_FIELDS = [
  "supportPatternCount",
  "supportClusterCount",
  "familyDiversity",
  "sumClusterRowEb",
  "meanClusterRowEb",
  "maxClusterRowEb",
  "maxClusterRowWilsonLB",
  "supportWeightedClusterRowEb",
  "selectorScore",
  "dayCandidateRows",
  "dayUniquePatterns",
  "dayUniqueSymbols",
  "dayTopScore",
  "daySecondScore",
  "dayScoreMargin",
  "openToCloseReturn",
  "return1d",
  "return3d",
  "return5d",
  "return10d",
  "return20d",
  "gapPct",
  "rangePct",
  "closeLocation",
  "closeOverMa5",
  "closeOverMa20",
  "closeOverMa60",
  "tradedValue",
  "tradedValueRel20",
  "tradedValueRel60",
  "rangeRel20",
  "returnVol20",
  "closeToHigh20Pct",
  "closeFromLow20Pct",
  "marketUpRatio",
  "marketUpRatio5",
  "marketUpRatio20",
  "marketMeanReturn1d",
  "marketMeanReturn5",
  "marketMeanReturn20",
  "marketMeanTradedValue",
  "limitUpProxyCount",
  "limitUpProxyAvg5",
  "limitUpProxyAvg20",
  "limitUpProxyRel20",
  "supportSaturated",
  "supportQualityRatio",
  "supportWeightedPerCluster",
  "supportOvercrowdRatio",
  "effectiveClusterSupport",
  "topClusterWeightShare",
  "closeNearHigh20",
  "qualityScoreRaw",
  "liquidityScoreRaw",
  "exhaustionScoreRaw",
  "correctedExhaustionScore",
]

export const LABEL_ONLY_FIELDS = [
  "hitTarget",
  "labelClass",
  "maxForwardReturn",
  "minForwardReturn",
  "hitDateKey",
  "targetBeforeStop",
  "stopBeforeTarget",
  "sameBarAmbiguous",
  "availableForwardBars",
  "dailyOracleHitRate",
  "falsePositiveWithSameDateHitCount",
  "falsePositiveNoSameDateHitCount",
  "selectedFalsePositiveHardNegativeCount",
  "selectedFalsePositiveNearMissCount",
  "selectedFalsePositiveEasyNegativeCount",
]

const FORBIDDEN_SCOPE_KEY_PATTERNS = [
  /^sideDaily$/i,
  /^side_daily$/i,
  /^investor/i,
  /^program/i,
  /^tradeStrength/i,
  /^trade_strength/i,
  /^intraday/i,
  /^minute/i,
  /^theme/i,
  /^sector/i,
]

const liveFeatureSet = new Set(LIVE_FEATURE_FIELDS)
const labelOnlySet = new Set(LABEL_ONLY_FIELDS)

export const isLabelOnlyField = (field) => labelOnlySet.has(toText(field))

export const isLiveFeatureField = (field) => liveFeatureSet.has(toText(field))

export const assertNoForbiddenScopeFields = (row = {}, { contextLabel = "row" } = {}) => {
  for (const key of Object.keys(row ?? {})) {
    if (FORBIDDEN_SCOPE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(`${contextLabel} contains forbidden non-daily-only field: ${key}`)
    }
  }
}

export const assertLiveFeatureFieldList = (fields = [], { contextLabel = "feature list" } = {}) => {
  const unknown = []
  const labelOnly = []
  const forbiddenScope = []
  for (const rawField of fields) {
    const field = toText(rawField)
    if (!field) continue
    if (LABEL_ONLY_FIELDS.includes(field)) labelOnly.push(field)
    if (FORBIDDEN_SCOPE_KEY_PATTERNS.some((pattern) => pattern.test(field))) forbiddenScope.push(field)
    if (!LIVE_FEATURE_FIELDS.includes(field)) unknown.push(field)
  }
  if (labelOnly.length > 0) {
    throw new Error(`${contextLabel} uses label-only fields as live features: ${labelOnly.sort().join(",")}`)
  }
  if (forbiddenScope.length > 0) {
    throw new Error(`${contextLabel} uses forbidden non-daily-only fields: ${forbiddenScope.sort().join(",")}`)
  }
  if (unknown.length > 0) {
    throw new Error(`${contextLabel} uses unknown live feature fields: ${unknown.sort().join(",")}`)
  }
}

