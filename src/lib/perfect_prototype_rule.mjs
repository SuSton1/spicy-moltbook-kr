import crypto from "node:crypto"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toIndexArray = (values) =>
  Array.from(
    Array.isArray(values) || (ArrayBuffer.isView(values) && !(values instanceof DataView))
      ? values
      : [],
    (value) => Number(value),
  ).filter(Number.isInteger)

const safeRate = (numValue, denValue) => {
  const numerator = Number(numValue)
  const denominator = Number(denValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

const sumTopCounts = (counts, limit = 1) =>
  (Array.isArray(counts) ? counts : [])
    .slice()
    .sort((left, right) => Number(right) - Number(left))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
    .reduce((sum, value) => sum + Number(value || 0), 0)

const clampOptionalRate = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(1, numeric))
}

const rowHasContextualToken = (rows, rowIndex, token) => {
  const contextualTokens = rows?.[rowIndex]?.contextualTokens
  return Array.isArray(contextualTokens) && contextualTokens.includes(token)
}

const buildMatchedRankDistributionStats = ({ positiveMatchRowIndexes, rows }) => {
  const positiveCount = Array.isArray(positiveMatchRowIndexes) ? positiveMatchRowIndexes.length : 0
  const countToken = (token) => {
    let count = 0
    for (const rowIndex of positiveMatchRowIndexes) {
      if (rowHasContextualToken(rows, rowIndex, token)) count += 1
    }
    return count
  }
  const matchedGlobalTopCount = countToken("tag:xsec.closeRank:TOP")
  const matchedGlobalHighCount = countToken("tag:xsec.closeRank:HIGH")
  const matchedGlobalMidCount = countToken("tag:xsec.closeRank:MID")
  const matchedGlobalLowCount = countToken("tag:xsec.closeRank:LOW")
  const matchedLaneTopCount = countToken("tag:xsecLane.closeRank:TOP")
  const matchedLaneHighCount = countToken("tag:xsecLane.closeRank:HIGH")
  const matchedLaneMidCount = countToken("tag:xsecLane.closeRank:MID")
  const matchedLaneLowCount = countToken("tag:xsecLane.closeRank:LOW")
  const matchedLaneThinPoolCount = countToken("tag:xsecLane.pool:THIN_POOL")
  const matchedSameDayHigh8Count = countToken("tag:stepa.lane:same_day_high8")
  const matchedRecentImpulse1dCount = countToken("tag:stepa.lane:recent_impulse_1d")
  return {
    matchedGlobalTopCount,
    matchedGlobalHighCount,
    matchedGlobalMidCount,
    matchedGlobalLowCount,
    matchedGlobalTopShare: safeRate(matchedGlobalTopCount, positiveCount),
    matchedGlobalHighShare: safeRate(matchedGlobalHighCount, positiveCount),
    matchedGlobalMidShare: safeRate(matchedGlobalMidCount, positiveCount),
    matchedGlobalLowShare: safeRate(matchedGlobalLowCount, positiveCount),
    matchedLaneTopCount,
    matchedLaneHighCount,
    matchedLaneMidCount,
    matchedLaneLowCount,
    matchedLaneTopShare: safeRate(matchedLaneTopCount, positiveCount),
    matchedLaneHighShare: safeRate(matchedLaneHighCount, positiveCount),
    matchedLaneMidShare: safeRate(matchedLaneMidCount, positiveCount),
    matchedLaneLowShare: safeRate(matchedLaneLowCount, positiveCount),
    matchedLaneThinPoolCount,
    matchedLaneThinPoolShare: safeRate(matchedLaneThinPoolCount, positiveCount),
    matchedSameDayHigh8Count,
    matchedSameDayHigh8Share: safeRate(matchedSameDayHigh8Count, positiveCount),
    matchedRecentImpulse1dCount,
    matchedRecentImpulse1dShare: safeRate(matchedRecentImpulse1dCount, positiveCount),
  }
}

export const PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE = "raw_row_count"
export const PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE = "day_capped_symbol_count"
export const PERFECT_PROTOTYPE_CHRONOLOGICAL_FOLD_SCHEME_PREFIX = "chronological_"

export const buildPerfectPrototypeMatchedTemporalSignatureHash = (bucketKeys) => {
  const normalizedBucketKeys = uniqueSorted(bucketKeys)
  if (normalizedBucketKeys.length < 1) return null
  return crypto.createHash("sha1").update(normalizedBucketKeys.join("||")).digest("hex")
}

export const buildPerfectPrototypeMonthKey = (dateKey) => {
  const normalized = String(dateKey ?? "").trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/)
  return match ? `${match[1]}-${match[2]}` : null
}

export const buildPerfectPrototypeYearKey = (dateKey) => {
  const normalized = String(dateKey ?? "").trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) return null
  const year = Number(match[1])
  return Number.isInteger(year) ? year : null
}

export const buildPerfectPrototypeQuarterKey = (dateKey) => {
  const normalized = String(dateKey ?? "").trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) return null
  const month = Number(match[2])
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  const quarter = Math.floor((month - 1) / 3) + 1
  return `${match[1]}-Q${quarter}`
}

export const resolvePerfectPrototypeFoldScheme = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase()
  const match = normalized.match(/^chronological_(\d+)$/u)
  if (!match) return null
  const foldCount = Number(match[1])
  if (!Number.isInteger(foldCount) || foldCount < 2 || foldCount > 128) return null
  return `${PERFECT_PROTOTYPE_CHRONOLOGICAL_FOLD_SCHEME_PREFIX}${foldCount}`
}

export const buildPerfectPrototypeChronologicalFoldLookup = ({
  calendarDateKeys,
  foldScheme,
}) => {
  const resolvedFoldScheme = resolvePerfectPrototypeFoldScheme(foldScheme)
  const orderedCalendarDateKeys = uniqueSorted(calendarDateKeys)
  if (!resolvedFoldScheme || orderedCalendarDateKeys.length < 1) {
    return {
      foldScheme: resolvedFoldScheme,
      foldCount: 0,
      foldKeysByCalendarIndex: [],
      uniqueFoldKeys: [],
    }
  }
  const foldCount = Number(resolvedFoldScheme.split("_").at(-1) ?? 0)
  const foldKeysByCalendarIndex = new Array(orderedCalendarDateKeys.length)
  const uniqueFoldKeys = new Array(foldCount)
  for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
    uniqueFoldKeys[foldIndex] = `${resolvedFoldScheme}:F${String(foldIndex + 1).padStart(2, "0")}`
  }
  for (let calendarIndex = 0; calendarIndex < orderedCalendarDateKeys.length; calendarIndex += 1) {
    const foldIndex = Math.min(
      foldCount - 1,
      Math.floor((calendarIndex * foldCount) / Math.max(1, orderedCalendarDateKeys.length)),
    )
    foldKeysByCalendarIndex[calendarIndex] = uniqueFoldKeys[foldIndex]
  }
  return {
    foldScheme: resolvedFoldScheme,
    foldCount,
    foldKeysByCalendarIndex,
    uniqueFoldKeys,
  }
}

export const resolvePerfectPrototypeHitCountMode = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE) {
    return PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE
  }
  return PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE
}

export const resolvePerfectPrototypeHitCountDaySymbolCap = (value, fallback = 2) => {
  const numeric = Math.floor(Number(value))
  if (!Number.isInteger(numeric) || numeric < 1) {
    return Math.max(1, Math.floor(Number(fallback) || 1))
  }
  return numeric
}

export const buildPerfectPrototypeMatchedDateSignatureHash = (dateKeys) => {
  return buildPerfectPrototypeMatchedTemporalSignatureHash(dateKeys)
}

export const computePerfectPrototypeDayCappedHitStats = ({
  dateKeys,
  foldKeys = [],
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  hitCountDaySymbolCap = 2,
}) => {
  const normalizedHitCountMode = resolvePerfectPrototypeHitCountMode(hitCountMode)
  const cap = resolvePerfectPrototypeHitCountDaySymbolCap(hitCountDaySymbolCap, 2)
  const rawDateKeys = Array.isArray(dateKeys) ? dateKeys : []
  const rawFoldKeys = Array.isArray(foldKeys) || (ArrayBuffer.isView(foldKeys) && !(foldKeys instanceof DataView))
    ? foldKeys
    : []
  const normalizedDateKeys = []
  const normalizedFoldKeys = []
  for (let index = 0; index < rawDateKeys.length; index += 1) {
    const dateKey = String(rawDateKeys[index] ?? "").trim()
    if (!dateKey) continue
    const foldKey = String(rawFoldKeys[index] ?? "").trim() || null
    normalizedDateKeys.push(dateKey)
    normalizedFoldKeys.push(foldKey)
  }
  const countsByDateKey = new Map()
  const foldKeyByDateKey = new Map()
  for (let index = 0; index < normalizedDateKeys.length; index += 1) {
    const dateKey = normalizedDateKeys[index]
    const foldKey = normalizedFoldKeys[index]
    countsByDateKey.set(dateKey, Number(countsByDateKey.get(dateKey) ?? 0) + 1)
    if (foldKey && !foldKeyByDateKey.has(dateKey)) {
      foldKeyByDateKey.set(dateKey, foldKey)
    }
  }
  const hitDates = Array.from(countsByDateKey.keys()).sort((left, right) => left.localeCompare(right))
  const effectiveCountsByDate = []
  let cappedCount = 0
  let maxSymbolsMatchedPerDate = 0
  const effectiveCountsByFold = new Map()
  for (const dateKey of hitDates) {
    const count = Number(countsByDateKey.get(dateKey) ?? 0)
    cappedCount += Math.min(cap, count)
    maxSymbolsMatchedPerDate = Math.max(maxSymbolsMatchedPerDate, count)
    const effectiveCount =
      normalizedHitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE
        ? Math.min(cap, count)
        : count
    effectiveCountsByDate.push(effectiveCount)
    const foldKey = foldKeyByDateKey.get(dateKey)
    if (foldKey) {
      effectiveCountsByFold.set(foldKey, Number(effectiveCountsByFold.get(foldKey) ?? 0) + effectiveCount)
    }
  }
  const rawCount = normalizedDateKeys.length
  const effectiveTotal =
    normalizedHitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE ? cappedCount : rawCount
  const top1DateHitCount = sumTopCounts(effectiveCountsByDate, 1)
  const top3DateHitCount = sumTopCounts(effectiveCountsByDate, 3)
  const hitMonths = uniqueSorted(hitDates.map((dateKey) => buildPerfectPrototypeMonthKey(dateKey)).filter(Boolean))
  const hitQuarters = uniqueSorted(
    hitDates.map((dateKey) => buildPerfectPrototypeQuarterKey(dateKey)).filter(Boolean),
  )
  const hitFolds = uniqueSorted(Array.from(effectiveCountsByFold.keys()))
  const effectiveCountsByFoldSorted = Array.from(effectiveCountsByFold.values()).sort((left, right) =>
    Number(right) - Number(left),
  )
  const top1FoldHitCount = sumTopCounts(effectiveCountsByFoldSorted, 1)
  const top3FoldHitCount = sumTopCounts(effectiveCountsByFoldSorted, 3)
  return {
    hitCountMode: normalizedHitCountMode,
    hitCountDaySymbolCap: cap,
    rawCount,
    cappedCount: effectiveTotal,
    distinctDateCount: hitDates.length,
    matchedMonthCount: hitMonths.length,
    matchedQuarterCount: hitQuarters.length,
    matchedFoldCount: hitFolds.length,
    hitDates,
    hitMonths,
    hitQuarters,
    hitFolds,
    maxSymbolsMatchedPerDate,
    top1DateHitCount,
    top3DateHitCount,
    top1DateHitShare: safeRate(top1DateHitCount, effectiveTotal),
    top3DateHitShare: safeRate(top3DateHitCount, effectiveTotal),
    top1FoldHitCount,
    top3FoldHitCount,
    top1FoldHitShare: safeRate(top1FoldHitCount, effectiveTotal),
    top3FoldHitShare: safeRate(top3FoldHitCount, effectiveTotal),
    matchedDateSignatureHash: buildPerfectPrototypeMatchedDateSignatureHash(hitDates),
    matchedMonthSignatureHash: buildPerfectPrototypeMatchedTemporalSignatureHash(hitMonths),
    matchedQuarterSignatureHash: buildPerfectPrototypeMatchedTemporalSignatureHash(hitQuarters),
    matchedFoldSignatureHash: buildPerfectPrototypeMatchedTemporalSignatureHash(hitFolds),
  }
}

const comparePerfectPrototypeRulePrecisionGapSize = (left, right) => {
  const leftPrecision = Number(left?.precision ?? 0)
  const rightPrecision = Number(right?.precision ?? 0)
  if (rightPrecision !== leftPrecision) return rightPrecision - leftPrecision
  const leftGap = Number(left?.maxGapTradingDays ?? Number.POSITIVE_INFINITY)
  const rightGap = Number(right?.maxGapTradingDays ?? Number.POSITIVE_INFINITY)
  if (leftGap !== rightGap) return leftGap - rightGap
  const leftSize = Number(left?.ruleSize ?? (Array.isArray(left?.tokens) ? left.tokens.length : 0))
  const rightSize = Number(right?.ruleSize ?? (Array.isArray(right?.tokens) ? right.tokens.length : 0))
  if (leftSize !== rightSize) return leftSize - rightSize
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

const shouldUsePromotableRuleOrdering = (left, right) =>
  left?.promotableOrdering === true || right?.promotableOrdering === true

export const comparePerfectPrototypePromotableRules = (left, right) => {
  const leftMatchedFolds = Number(left?.matchedFoldCount ?? 0)
  const rightMatchedFolds = Number(right?.matchedFoldCount ?? 0)
  if (rightMatchedFolds !== leftMatchedFolds) return rightMatchedFolds - leftMatchedFolds
  const leftMatchedMonths = Number(left?.matchedMonthCount ?? 0)
  const rightMatchedMonths = Number(right?.matchedMonthCount ?? 0)
  if (rightMatchedMonths !== leftMatchedMonths) return rightMatchedMonths - leftMatchedMonths
  const leftMatchedDates = Number(left?.matchedDateCount ?? 0)
  const rightMatchedDates = Number(right?.matchedDateCount ?? 0)
  if (rightMatchedDates !== leftMatchedDates) return rightMatchedDates - leftMatchedDates
  const leftTop1DateShare = Number(left?.top1DateHitShare ?? Number.POSITIVE_INFINITY)
  const rightTop1DateShare = Number(right?.top1DateHitShare ?? Number.POSITIVE_INFINITY)
  if (leftTop1DateShare !== rightTop1DateShare) return leftTop1DateShare - rightTop1DateShare
  const leftTop3DateShare = Number(left?.top3DateHitShare ?? Number.POSITIVE_INFINITY)
  const rightTop3DateShare = Number(right?.top3DateHitShare ?? Number.POSITIVE_INFINITY)
  if (leftTop3DateShare !== rightTop3DateShare) return leftTop3DateShare - rightTop3DateShare
  const leftTop1FoldShare = Number(left?.top1FoldHitShare ?? Number.POSITIVE_INFINITY)
  const rightTop1FoldShare = Number(right?.top1FoldHitShare ?? Number.POSITIVE_INFINITY)
  if (leftTop1FoldShare !== rightTop1FoldShare) return leftTop1FoldShare - rightTop1FoldShare
  const leftTop3FoldShare = Number(left?.top3FoldHitShare ?? Number.POSITIVE_INFINITY)
  const rightTop3FoldShare = Number(right?.top3FoldHitShare ?? Number.POSITIVE_INFINITY)
  if (leftTop3FoldShare !== rightTop3FoldShare) return leftTop3FoldShare - rightTop3FoldShare
  const leftCappedHits = Number(left?.trainHitCountCapped ?? left?.trainHitCount ?? left?.matchHitCount ?? 0)
  const rightCappedHits = Number(right?.trainHitCountCapped ?? right?.trainHitCount ?? right?.matchHitCount ?? 0)
  if (rightCappedHits !== leftCappedHits) return rightCappedHits - leftCappedHits
  const leftRawHits = Number(left?.trainHitCountRaw ?? left?.trainHitCount ?? left?.matchHitCount ?? 0)
  const rightRawHits = Number(right?.trainHitCountRaw ?? right?.trainHitCount ?? right?.matchHitCount ?? 0)
  if (rightRawHits !== leftRawHits) return rightRawHits - leftRawHits
  return comparePerfectPrototypeRulePrecisionGapSize(left, right)
}

export const comparePerfectPrototypeRules = (left, right) => {
  if (shouldUsePromotableRuleOrdering(left, right)) {
    return comparePerfectPrototypePromotableRules(left, right)
  }
  const leftMode = resolvePerfectPrototypeHitCountMode(left?.hitCountMode)
  const rightMode = resolvePerfectPrototypeHitCountMode(right?.hitCountMode)
  const usesDayCappedOrdering =
    leftMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE ||
    rightMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE
  if (usesDayCappedOrdering) {
    const leftCappedHits = Number(left?.trainHitCountCapped ?? left?.trainHitCount ?? left?.matchHitCount ?? 0)
    const rightCappedHits = Number(right?.trainHitCountCapped ?? right?.trainHitCount ?? right?.matchHitCount ?? 0)
    if (rightCappedHits !== leftCappedHits) return rightCappedHits - leftCappedHits
    const leftMatchedDates = Number(left?.matchedDateCount ?? 0)
    const rightMatchedDates = Number(right?.matchedDateCount ?? 0)
    if (rightMatchedDates !== leftMatchedDates) return rightMatchedDates - leftMatchedDates
    const leftRawHits = Number(left?.trainHitCountRaw ?? left?.trainHitCount ?? left?.matchHitCount ?? 0)
    const rightRawHits = Number(right?.trainHitCountRaw ?? right?.trainHitCount ?? right?.matchHitCount ?? 0)
    if (rightRawHits !== leftRawHits) return rightRawHits - leftRawHits
    return comparePerfectPrototypeRulePrecisionGapSize(left, right)
  }
  const leftHits = Number(left?.trainHitCount ?? left?.matchHitCount ?? 0)
  const rightHits = Number(right?.trainHitCount ?? right?.matchHitCount ?? 0)
  if (rightHits !== leftHits) return rightHits - leftHits
  return comparePerfectPrototypeRulePrecisionGapSize(left, right)
}

export const comparePerfectPrototypeMatchedDateSignatureBucketRules = (left, right) => {
  if (shouldUsePromotableRuleOrdering(left, right)) {
    return comparePerfectPrototypePromotableRules(left, right)
  }
  const leftHits = Number(left?.trainHitCount ?? left?.matchHitCount ?? 0)
  const rightHits = Number(right?.trainHitCount ?? right?.matchHitCount ?? 0)
  if (rightHits !== leftHits) return rightHits - leftHits
  const leftMatchedDates = Number(left?.matchedDateCount ?? 0)
  const rightMatchedDates = Number(right?.matchedDateCount ?? 0)
  if (rightMatchedDates !== leftMatchedDates) return rightMatchedDates - leftMatchedDates
  const leftTop3Share = Number(left?.top3DateHitShare ?? Number.POSITIVE_INFINITY)
  const rightTop3Share = Number(right?.top3DateHitShare ?? Number.POSITIVE_INFINITY)
  if (leftTop3Share !== rightTop3Share) return leftTop3Share - rightTop3Share
  const leftPrecision = Number(left?.precision ?? 0)
  const rightPrecision = Number(right?.precision ?? 0)
  if (rightPrecision !== leftPrecision) return rightPrecision - leftPrecision
  const leftSize = Number(left?.ruleSize ?? (Array.isArray(left?.tokens) ? left.tokens.length : 0))
  const rightSize = Number(right?.ruleSize ?? (Array.isArray(right?.tokens) ? right.tokens.length : 0))
  if (leftSize !== rightSize) return leftSize - rightSize
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

export const comparePerfectPrototypeTemporalSignatureBucketRules = (left, right) =>
  comparePerfectPrototypeMatchedDateSignatureBucketRules(left, right)

export const evaluatePerfectPrototypeTrainDateBreadthGuards = ({
  rule,
  minTrainMatchedDates = null,
  minTrainMatchedMonths = null,
  minTrainMatchedQuarters = null,
  minTrainMatchedFolds = null,
  maxTop1DateHitShare = null,
  maxTop3DateHitShare = null,
  maxTop1FoldHitShare = null,
  maxTop3FoldHitShare = null,
}) => {
  const matchedDateCount = Number(rule?.matchedDateCount ?? 0)
  const matchedMonthCount = Number(rule?.matchedMonthCount ?? 0)
  const matchedQuarterCount = Number(rule?.matchedQuarterCount ?? 0)
  const matchedFoldCount = Number(rule?.matchedFoldCount ?? 0)
  const top1DateHitShare = Number(rule?.top1DateHitShare ?? 0)
  const top3DateHitShare = Number(rule?.top3DateHitShare ?? 0)
  const top1FoldHitShare = Number(rule?.top1FoldHitShare ?? 0)
  const top3FoldHitShare = Number(rule?.top3FoldHitShare ?? 0)
  const resolvedMinTrainMatchedDates =
    Number.isInteger(Number(minTrainMatchedDates)) && Number(minTrainMatchedDates) > 0
      ? Number(minTrainMatchedDates)
      : null
  const resolvedMinTrainMatchedMonths =
    Number.isInteger(Number(minTrainMatchedMonths)) && Number(minTrainMatchedMonths) > 0
      ? Number(minTrainMatchedMonths)
      : null
  const resolvedMinTrainMatchedQuarters =
    Number.isInteger(Number(minTrainMatchedQuarters)) && Number(minTrainMatchedQuarters) > 0
      ? Number(minTrainMatchedQuarters)
      : null
  const resolvedMinTrainMatchedFolds =
    Number.isInteger(Number(minTrainMatchedFolds)) && Number(minTrainMatchedFolds) > 0
      ? Number(minTrainMatchedFolds)
      : null
  const resolvedMaxTop1DateHitShare = clampOptionalRate(maxTop1DateHitShare)
  const resolvedMaxTop3DateHitShare = clampOptionalRate(maxTop3DateHitShare)
  const resolvedMaxTop1FoldHitShare = clampOptionalRate(maxTop1FoldHitShare)
  const resolvedMaxTop3FoldHitShare = clampOptionalRate(maxTop3FoldHitShare)
  if (
    Number.isInteger(resolvedMinTrainMatchedDates) &&
    resolvedMinTrainMatchedDates > 0 &&
    matchedDateCount < resolvedMinTrainMatchedDates
  ) {
    return { ok: false, reason: "BELOW_MIN_TRAIN_MATCHED_DATES" }
  }
  if (
    Number.isInteger(resolvedMinTrainMatchedMonths) &&
    resolvedMinTrainMatchedMonths > 0 &&
    matchedMonthCount < resolvedMinTrainMatchedMonths
  ) {
    return { ok: false, reason: "BELOW_MIN_TRAIN_MATCHED_MONTHS" }
  }
  if (
    Number.isInteger(resolvedMinTrainMatchedQuarters) &&
    resolvedMinTrainMatchedQuarters > 0 &&
    matchedQuarterCount < resolvedMinTrainMatchedQuarters
  ) {
    return { ok: false, reason: "BELOW_MIN_TRAIN_MATCHED_QUARTERS" }
  }
  if (
    Number.isInteger(resolvedMinTrainMatchedFolds) &&
    resolvedMinTrainMatchedFolds > 0 &&
    matchedFoldCount < resolvedMinTrainMatchedFolds
  ) {
    return { ok: false, reason: "BELOW_MIN_TRAIN_MATCHED_FOLDS" }
  }
  if (
    Number.isFinite(resolvedMaxTop1DateHitShare) &&
    top1DateHitShare > resolvedMaxTop1DateHitShare
  ) {
    return { ok: false, reason: "TOP1_DATE_HIT_SHARE_ABOVE_MAX" }
  }
  if (
    Number.isFinite(resolvedMaxTop3DateHitShare) &&
    top3DateHitShare > resolvedMaxTop3DateHitShare
  ) {
    return { ok: false, reason: "TOP3_DATE_HIT_SHARE_ABOVE_MAX" }
  }
  if (
    Number.isFinite(resolvedMaxTop1FoldHitShare) &&
    top1FoldHitShare > resolvedMaxTop1FoldHitShare
  ) {
    return { ok: false, reason: "TOP1_FOLD_HIT_SHARE_ABOVE_MAX" }
  }
  if (
    Number.isFinite(resolvedMaxTop3FoldHitShare) &&
    top3FoldHitShare > resolvedMaxTop3FoldHitShare
  ) {
    return { ok: false, reason: "TOP3_FOLD_HIT_SHARE_ABOVE_MAX" }
  }
  return { ok: true, reason: null }
}

const capPerfectPrototypeRulesPerSignature = ({
  rules,
  signatureFieldName,
  maxRulesPerSignature = null,
}) => {
  const resolvedMaxRulesPerSignature =
    Number.isInteger(Number(maxRulesPerSignature)) && Number(maxRulesPerSignature) > 0
      ? Number(maxRulesPerSignature)
      : null
  const safeRules = Array.isArray(rules) ? rules : []
  if (!Number.isInteger(resolvedMaxRulesPerSignature)) {
    return {
      rules: safeRules.slice(),
      droppedRuleCount: 0,
    }
  }
  const buckets = new Map()
  for (const rule of safeRules) {
    const signatureKey =
      String(rule?.[signatureFieldName] ?? "").trim() || `__no_signature__:${String(rule?.ruleId ?? "")}`
    const bucket = buckets.get(signatureKey) ?? []
    bucket.push(rule)
    buckets.set(signatureKey, bucket)
  }
  const cappedRules = []
  let droppedRuleCount = 0
  for (const signatureKey of Array.from(buckets.keys()).sort((left, right) => left.localeCompare(right))) {
    const bucket = buckets.get(signatureKey) ?? []
    const rankedBucket = bucket
      .slice()
      .sort(comparePerfectPrototypeTemporalSignatureBucketRules)
    const kept = rankedBucket.slice(0, resolvedMaxRulesPerSignature)
    cappedRules.push(...kept)
    droppedRuleCount += Math.max(0, rankedBucket.length - kept.length)
  }
  return {
    rules: cappedRules,
    droppedRuleCount,
  }
}

export const capPerfectPrototypeRulesPerMatchedDateSignature = ({
  rules,
  maxRulesPerMatchedDateSignature = null,
}) =>
  capPerfectPrototypeRulesPerSignature({
    rules,
    signatureFieldName: "matchedDateSignatureHash",
    maxRulesPerSignature: maxRulesPerMatchedDateSignature,
  })

export const capPerfectPrototypeRulesPerMatchedMonthSignature = ({
  rules,
  maxRulesPerMatchedMonthSignature = null,
}) =>
  capPerfectPrototypeRulesPerSignature({
    rules,
    signatureFieldName: "matchedMonthSignatureHash",
    maxRulesPerSignature: maxRulesPerMatchedMonthSignature,
  })

export const capPerfectPrototypeRulesPerMatchedQuarterSignature = ({
  rules,
  maxRulesPerMatchedQuarterSignature = null,
}) =>
  capPerfectPrototypeRulesPerSignature({
    rules,
    signatureFieldName: "matchedQuarterSignatureHash",
    maxRulesPerSignature: maxRulesPerMatchedQuarterSignature,
  })

export const rankPerfectPrototypeRules = (rules) =>
  (Array.isArray(rules) ? rules : [])
    .slice()
    .sort(comparePerfectPrototypeRules)
    .map((rule, index) => ({
      ...rule,
      rank: index + 1,
    }))

export const comparePerfectPrototypeSameSignatureWinners = (left, right) => {
  const leftSize = Number(left?.ruleSize ?? (Array.isArray(left?.tokens) ? left.tokens.length : 0))
  const rightSize = Number(right?.ruleSize ?? (Array.isArray(right?.tokens) ? right.tokens.length : 0))
  if (leftSize !== rightSize) return leftSize - rightSize
  return comparePerfectPrototypeRules(left, right)
}

export const pickCanonicalPerfectPrototypeSameSignatureWinner = (left, right) => {
  if (!left) return right ?? null
  if (!right) return left ?? null
  return comparePerfectPrototypeSameSignatureWinners(left, right) <= 0 ? left : right
}

export const selectTopPerfectPrototypeRulesDeterministically = (rules, maxRules = Number.POSITIVE_INFINITY) =>
  rankPerfectPrototypeRules(rules).slice(
    0,
    Number.isFinite(Number(maxRules)) ? Math.max(0, Math.floor(Number(maxRules))) : undefined,
  )

export const buildPerfectPrototypeRuleId = (tokens) => {
  const normalized = uniqueSorted(tokens)
  const hash = crypto.createHash("sha1").update(normalized.join("||")).digest("hex").slice(0, 12)
  return `PP_${hash}`
}

export const buildPerfectPrototypeCalendarLookup = (calendarDateKeys) => {
  const orderedCalendarDateKeys = uniqueSorted(calendarDateKeys)
  return {
    orderedCalendarDateKeys,
    calendarIndexByDateKey: new Map(
      orderedCalendarDateKeys.map((dateKey, index) => [dateKey, index]),
    ),
  }
}

export const computePerfectPrototypeGapStatsFromCalendarIndexes = ({
  hitCalendarIndexes,
  calendarDateKeys,
}) => {
  const orderedCalendarDateKeys = uniqueSorted(calendarDateKeys)
  const orderedHits = uniqueSorted(
    toIndexArray(hitCalendarIndexes).filter(
      (index) => index >= 0 && index < orderedCalendarDateKeys.length,
    ),
  )
    .map((index) => Number(index))
    .sort((left, right) => left - right)
  if (orderedHits.length < 1 || orderedCalendarDateKeys.length < 1) {
    return {
      maxGapTradingDays: null,
      startGapTradingDays: null,
      endGapTradingDays: null,
      firstHitCalendarIndex: null,
      lastHitCalendarIndex: null,
      hitCalendarIndexes: [],
      hitDates: [],
    }
  }
  let maxGap = orderedHits[0]
  for (let index = 1; index < orderedHits.length; index += 1) {
    maxGap = Math.max(maxGap, orderedHits[index] - orderedHits[index - 1] - 1)
  }
  maxGap = Math.max(maxGap, orderedCalendarDateKeys.length - orderedHits[orderedHits.length - 1] - 1)
  return {
    maxGapTradingDays: maxGap,
    startGapTradingDays: orderedHits[0],
    endGapTradingDays: orderedCalendarDateKeys.length - orderedHits[orderedHits.length - 1] - 1,
    firstHitCalendarIndex: orderedHits[0],
    lastHitCalendarIndex: orderedHits[orderedHits.length - 1],
    hitCalendarIndexes: orderedHits,
    hitDates: orderedHits.map((index) => orderedCalendarDateKeys[index]),
  }
}

export const computePerfectPrototypeGapStats = ({ dateKeys, calendarDateKeys }) => {
  const calendarLookup = buildPerfectPrototypeCalendarLookup(calendarDateKeys)
  return computePerfectPrototypeGapStatsFromCalendarIndexes({
    hitCalendarIndexes: uniqueSorted(dateKeys)
      .map((dateKey) => calendarLookup.calendarIndexByDateKey.get(dateKey))
      .filter(Number.isInteger),
    calendarDateKeys: calendarLookup.orderedCalendarDateKeys,
  })
}

const resolvePositiveHitCalendarIndexes = ({
  positiveMatchRowIndexes,
  rows,
  rowCalendarIndexes,
  calendarIndexByDateKey,
}) => {
  const out = []
  const seen = new Set()
  for (const rowIndex of positiveMatchRowIndexes) {
    let calendarIndex = Number(rowCalendarIndexes?.[rowIndex])
    if (!Number.isInteger(calendarIndex) || calendarIndex < 0) {
      const dateKey = rows?.[rowIndex]?.dateKey
      calendarIndex =
        dateKey && calendarIndexByDateKey instanceof Map ? calendarIndexByDateKey.get(dateKey) : null
    }
    if (!Number.isInteger(calendarIndex) || calendarIndex < 0 || seen.has(calendarIndex)) continue
    seen.add(calendarIndex)
    out.push(calendarIndex)
  }
  out.sort((left, right) => left - right)
  return out
}

export const createPerfectPrototypeRuleCore = ({
  tokens,
  matchRowIndexes = [],
  positiveMatchRowIndexes = [],
  negativeMatchRowIndexes = [],
  familyId = null,
  rows = [],
  calendarDateKeys = [],
  calendarIndexByDateKey = null,
  rowCalendarIndexes = null,
  rowFoldKeys = null,
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  hitCountDaySymbolCap = 2,
}) => {
  const normalizedMatchRowIndexes = toIndexArray(matchRowIndexes)
  const normalizedPositiveMatchRowIndexes = toIndexArray(positiveMatchRowIndexes)
  const normalizedNegativeMatchRowIndexes = toIndexArray(negativeMatchRowIndexes)
  const normalizedTokens = uniqueSorted(tokens)
  const positiveDateKeys = normalizedPositiveMatchRowIndexes
    .map((rowIndex) => String(rows?.[rowIndex]?.dateKey ?? "").trim())
    .filter(Boolean)
  const positiveFoldKeys = normalizedPositiveMatchRowIndexes.map((rowIndex) =>
    String(rowFoldKeys?.[rowIndex] ?? "").trim() || null,
  )
  const hitStats = computePerfectPrototypeDayCappedHitStats({
    dateKeys: positiveDateKeys,
    foldKeys: positiveFoldKeys,
    hitCountMode,
    hitCountDaySymbolCap,
  })
  const hitCalendarIndexes = resolvePositiveHitCalendarIndexes({
    positiveMatchRowIndexes: normalizedPositiveMatchRowIndexes,
    rows,
    rowCalendarIndexes,
    calendarIndexByDateKey,
  })
  const gapStats = computePerfectPrototypeGapStatsFromCalendarIndexes({
    hitCalendarIndexes,
    calendarDateKeys,
  })
  const rankDistributionStats = buildMatchedRankDistributionStats({
    positiveMatchRowIndexes: normalizedPositiveMatchRowIndexes,
    rows,
  })
  return {
    ruleId: buildPerfectPrototypeRuleId(normalizedTokens),
    familyId: String(familyId ?? "").trim() || null,
    tokens: normalizedTokens,
    ruleSize: normalizedTokens.length,
    trainMatchCount: normalizedMatchRowIndexes.length,
    trainHitCount: hitStats.cappedCount,
    trainHitCountRaw: hitStats.rawCount,
    trainHitCountCapped: hitStats.cappedCount,
    trainNegativeCount: normalizedNegativeMatchRowIndexes.length,
    precision: safeRate(normalizedPositiveMatchRowIndexes.length, normalizedMatchRowIndexes.length),
    hitCountMode: hitStats.hitCountMode,
    hitCountDaySymbolCap: hitStats.hitCountDaySymbolCap,
    maxSymbolsMatchedPerDate: hitStats.maxSymbolsMatchedPerDate,
    top1DateHitCount: hitStats.top1DateHitCount,
    top3DateHitCount: hitStats.top3DateHitCount,
    top1DateHitShare: hitStats.top1DateHitShare,
    top3DateHitShare: hitStats.top3DateHitShare,
    hitDates: Array.isArray(hitStats.hitDates) ? hitStats.hitDates.slice() : [],
    hitMonths: Array.isArray(hitStats.hitMonths) ? hitStats.hitMonths.slice() : [],
    hitQuarters: Array.isArray(hitStats.hitQuarters) ? hitStats.hitQuarters.slice() : [],
    hitFolds: Array.isArray(hitStats.hitFolds) ? hitStats.hitFolds.slice() : [],
    matchedDateSignatureHash: hitStats.matchedDateSignatureHash,
    matchedMonthCount: hitStats.matchedMonthCount,
    matchedQuarterCount: hitStats.matchedQuarterCount,
    matchedFoldCount: hitStats.matchedFoldCount,
    matchedMonthSignatureHash: hitStats.matchedMonthSignatureHash,
    matchedQuarterSignatureHash: hitStats.matchedQuarterSignatureHash,
    matchedFoldSignatureHash: hitStats.matchedFoldSignatureHash,
    top1FoldHitCount: hitStats.top1FoldHitCount,
    top3FoldHitCount: hitStats.top3FoldHitCount,
    top1FoldHitShare: hitStats.top1FoldHitShare,
    top3FoldHitShare: hitStats.top3FoldHitShare,
    maxGapTradingDays: gapStats.maxGapTradingDays,
    startGapTradingDays: gapStats.startGapTradingDays,
    endGapTradingDays: gapStats.endGapTradingDays,
    firstHitCalendarIndex: gapStats.firstHitCalendarIndex,
    lastHitCalendarIndex: gapStats.lastHitCalendarIndex,
    matchedDateCount: hitStats.distinctDateCount,
    ...rankDistributionStats,
    matchRowIndexes: normalizedMatchRowIndexes.slice(),
    positiveMatchRowIndexes: normalizedPositiveMatchRowIndexes.slice(),
    negativeMatchRowIndexes: normalizedNegativeMatchRowIndexes.slice(),
  }
}

export const materializePerfectPrototypeRule = ({
  ruleCore,
  rows = [],
  calendarDateKeys = [],
}) => {
  const rule = ruleCore && typeof ruleCore === "object" ? ruleCore : {}
  const positiveMatchRowIndexes = toIndexArray(rule.positiveMatchRowIndexes)
  const normalizedCalendarDateKeys = uniqueSorted(calendarDateKeys)
  const matchedSymbols = uniqueSorted(
    positiveMatchRowIndexes.map((rowIndex) => rows[rowIndex]?.symbol).filter(Boolean),
  )
  return {
    ...rule,
    firstHitCalendarIndex:
      Number.isInteger(rule?.firstHitCalendarIndex) && Number(rule.firstHitCalendarIndex) >= 0
        ? Number(rule.firstHitCalendarIndex)
        : null,
    lastHitCalendarIndex:
      Number.isInteger(rule?.lastHitCalendarIndex) && Number(rule.lastHitCalendarIndex) >= 0
        ? Number(rule.lastHitCalendarIndex)
        : null,
    firstHitDate:
      Number.isInteger(rule?.firstHitCalendarIndex) &&
      Number(rule.firstHitCalendarIndex) >= 0 &&
      Number(rule.firstHitCalendarIndex) < normalizedCalendarDateKeys.length
        ? normalizedCalendarDateKeys[Number(rule.firstHitCalendarIndex)]
        : null,
    lastHitDate:
      Number.isInteger(rule?.lastHitCalendarIndex) &&
      Number(rule.lastHitCalendarIndex) >= 0 &&
      Number(rule.lastHitCalendarIndex) < normalizedCalendarDateKeys.length
        ? normalizedCalendarDateKeys[Number(rule.lastHitCalendarIndex)]
        : null,
    matchedSymbolCount: matchedSymbols.length,
    matchedSymbols,
    sampleMatchIds: positiveMatchRowIndexes
      .slice(0, 10)
      .map((rowIndex) => rows[rowIndex]?.sourceId)
      .filter(Boolean),
  }
}

export const createPerfectPrototypeRule = ({
  tokens,
  matchRowIndexes = [],
  positiveMatchRowIndexes = [],
  negativeMatchRowIndexes = [],
  familyId = null,
  rows = [],
  calendarDateKeys = [],
  calendarIndexByDateKey = null,
  rowCalendarIndexes = null,
  rowFoldKeys = null,
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  hitCountDaySymbolCap = 2,
}) =>
  materializePerfectPrototypeRule({
    ruleCore: createPerfectPrototypeRuleCore({
      tokens,
      matchRowIndexes,
      positiveMatchRowIndexes,
      negativeMatchRowIndexes,
      familyId,
      rows,
      calendarDateKeys,
      calendarIndexByDateKey,
      rowCalendarIndexes,
      rowFoldKeys,
      hitCountMode,
      hitCountDaySymbolCap,
    }),
    rows,
    calendarDateKeys,
  })

export const matchPerfectPrototypeRule = (rowTokens, rule) => {
  const tokenSet = rowTokens instanceof Set ? rowTokens : new Set(Array.isArray(rowTokens) ? rowTokens : [])
  for (const token of Array.isArray(rule?.tokens) ? rule.tokens : []) {
    if (!tokenSet.has(token)) return false
  }
  return true
}

export const buildPerfectPrototypeRuleRankLookup = (rules) => {
  const lookup = new Map()
  for (const rule of rankPerfectPrototypeRules(rules)) {
    lookup.set(String(rule?.ruleId ?? ""), rule)
  }
  return lookup
}

export const pickChampionPerfectPrototypeRule = (rules) => rankPerfectPrototypeRules(rules)[0] ?? null
