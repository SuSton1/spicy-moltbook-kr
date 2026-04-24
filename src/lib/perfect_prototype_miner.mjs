import {
  buildPerfectPrototypeTokenizerSpec,
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  normalizePerfectPrototypeRow,
  resolvePerfectPrototypeFeaturePrefixes,
  summarizePerfectPrototypeTokenizerSpec,
  tokenizePerfectPrototypeRow,
} from "./perfect_prototype_tokenizer.mjs"
import {
  buildPerfectPrototypeChronologicalFoldLookup,
  buildPerfectPrototypeMatchedDateSignatureHash,
  buildPerfectPrototypeCalendarLookup,
  capPerfectPrototypeRulesPerMatchedMonthSignature,
  capPerfectPrototypeRulesPerMatchedQuarterSignature,
  capPerfectPrototypeRulesPerMatchedDateSignature,
  buildPerfectPrototypeMonthKey,
  buildPerfectPrototypeQuarterKey,
  comparePerfectPrototypeRules,
  createPerfectPrototypeRuleCore,
  evaluatePerfectPrototypeTrainDateBreadthGuards,
  materializePerfectPrototypeRule,
  PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
  PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  pickCanonicalPerfectPrototypeSameSignatureWinner,
  rankPerfectPrototypeRules,
  resolvePerfectPrototypeFoldScheme,
  resolvePerfectPrototypeHitCountDaySymbolCap,
  resolvePerfectPrototypeHitCountMode,
  selectTopPerfectPrototypeRulesDeterministically,
} from "./perfect_prototype_rule.mjs"
import {
  buildPerfectPrototypeRecentOnlyMiningFamilyIdSet,
  isPerfectPrototypeLowContinuationFamilyId,
  isPerfectPrototypeMidContinuationFamilyId,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  evaluatePerfectPrototypeRuleFamilyPurity,
  inferPerfectPrototypeRuleFamilyId,
  isPerfectPrototypeContinuationFamilyId,
} from "./perfect_prototype_rule_family_spec.mjs"
import { normalizePerfectPrototypeSupportCases } from "./perfect_prototype_support_case.mjs"
import { dedupePerfectPrototypeMatches } from "./perfect_prototype_dedupe.mjs"
import { buildPerfectPrototypeCatalog, buildPerfectPrototypeCoverageReport } from "./perfect_prototype_catalog.mjs"
import {
  applyPerfectPrototypeTemporalSignatureCaps,
  selectDiversePerfectPrototypeRules,
} from "./perfect_prototype_catalog_diversify.mjs"
import { selectPerfectPrototypeMdlRules } from "./perfect_prototype_catalog_mdl.mjs"
import {
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  getPerfectPrototypeRowsetRuntimeStats,
  intersectPerfectPrototypeRowsetsCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
  resetPerfectPrototypeRowsetRuntimeStats,
} from "./perfect_prototype_rowset.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  enrichPerfectPrototypeRowsWithContext,
} from "./perfect_prototype_contextual_features.mjs"
import { enrichPerfectPrototypeRowsWithDecisionContext } from "./perfect_prototype_decision_contextual_features.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  assertNoPrejumpLeakageRows,
} from "./perfect_prototype_prejump_contract.mjs"
import {
  PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON,
  evaluatePerfectPrototypeYearHitUpperBoundGuard,
} from "./perfect_prototype_year_hit_guard.mjs"

const clampInteger = (value, fallback, min, max) => {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const clampNumber = (value, fallback, min, max) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const clampOptionalInteger = (value, fallback = null, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback
  const numeric = Math.floor(Number(value))
  if (!Number.isInteger(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const clampOptionalNumber = (value, fallback = null, min = 0, max = 1) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

const buildPerfectPrototypeMatchCoverageAugment = ({
  coverage,
  matchRows,
  calendarDateKeys = [],
  calendarFoldKeys = [],
}) => {
  const baseCoverage = coverage && typeof coverage === "object" ? { ...coverage } : {}
  const normalizedRows = Array.isArray(matchRows) ? matchRows : []
  const foldKeyByDateKey = new Map()
  const orderedDateKeys = uniqueSorted(calendarDateKeys)
  for (let index = 0; index < orderedDateKeys.length; index += 1) {
    const dateKey = String(orderedDateKeys[index] ?? "").trim()
    if (!dateKey) continue
    foldKeyByDateKey.set(dateKey, calendarFoldKeys[index] ?? null)
  }
  const matchedFoldKeys = uniqueSorted(
    normalizedRows
      .map((row) => foldKeyByDateKey.get(String(row?.dateKey ?? "").trim()) ?? null)
      .filter(Boolean),
  )
  baseCoverage.uniqueMatchedFolds = matchedFoldKeys.length
  return baseCoverage
}

const buildPerfectPrototypeMatchMassTelemetry = ({ matchRows }) => {
  const normalizedRows = Array.isArray(matchRows) ? matchRows : []
  const dateCounts = new Map()
  const symbolCounts = new Map()
  for (const row of normalizedRows) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (dateKey) {
      dateCounts.set(dateKey, Number(dateCounts.get(dateKey) ?? 0) + 1)
    }
    const symbol = String(row?.symbol ?? "").trim()
    if (symbol) {
      symbolCounts.set(symbol, Number(symbolCounts.get(symbol) ?? 0) + 1)
    }
  }
  const computeTopMassShare = (values, topK) => {
    const sortedCounts = Array.from(values.values())
      .map((value) => Number(value ?? 0))
      .filter((value) => value > 0)
      .sort((left, right) => right - left)
    if (sortedCounts.length < 1) return 0
    const total = sortedCounts.reduce((sum, value) => sum + value, 0)
    if (total <= 0) return 0
    const topMass = sortedCounts.slice(0, Math.max(1, Math.floor(Number(topK) || 1))).reduce(
      (sum, value) => sum + value,
      0,
    )
    return safeRate(topMass, total)
  }
  return {
    topExactDateMassShare: computeTopMassShare(dateCounts, 1),
    top3ExactDateMassShare: computeTopMassShare(dateCounts, 3),
    topExactSymbolMassShare: computeTopMassShare(symbolCounts, 1),
    top3ExactSymbolMassShare: computeTopMassShare(symbolCounts, 3),
  }
}

const isTypedNumericArray = (value) =>
  ArrayBuffer.isView(value) && !(value instanceof DataView)

const EMPTY_UINT32 = new Uint32Array()

export const PERFECT_PROTOTYPE_TRAIN_PRECISION_1_ONLY_COLLECTION_MODE = "train_precision_1_only"
export const PERFECT_PROTOTYPE_TRAIN_PRECISION_GTE_THRESHOLD_COLLECTION_MODE =
  "train_precision_gte_threshold"

const hrtimeSecondsSince = (startedAt) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000

const toUint32Array = (value) => {
  if (value instanceof Uint32Array) return value
  return new Uint32Array(Array.isArray(value) || isTypedNumericArray(value) ? Array.from(value) : [])
}

export const PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE = "legacy_exact_catalog_v6"
export const PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE = "exact_indexed_kernel_v1"
const PERFECT_PROTOTYPE_SEARCH_MODES = new Set([
  PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
])

const getIndexCollectionLength = (value) =>
  Array.isArray(value) || isTypedNumericArray(value) ? value.length : 0

const iterateIndexCollection = (value) =>
  Array.isArray(value) || isTypedNumericArray(value) ? value : []

const collectSampleSourceIds = ({ rowIndexes, rows, limit = 10 }) => {
  const out = []
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0))
  if (safeLimit < 1) return out
  for (const rowIndex of iterateIndexCollection(rowIndexes)) {
    const sourceId = rows?.[Number(rowIndex)]?.sourceId
    if (!sourceId) continue
    out.push(sourceId)
    if (out.length >= safeLimit) break
  }
  return out
}

const compareIndexCollectionsExact = (left, right) => {
  const leftLength = getIndexCollectionLength(left)
  const rightLength = getIndexCollectionLength(right)
  if (leftLength !== rightLength) return false
  for (let index = 0; index < leftLength; index += 1) {
    if (Number(left[index]) !== Number(right[index])) return false
  }
  return true
}

const buildIndexCollectionHash = (value) => {
  let hashA = 2166136261 >>> 0
  let hashB = 0x9e3779b9 >>> 0
  let length = 0
  for (const rawItem of iterateIndexCollection(value)) {
    const item = Number(rawItem) >>> 0
    hashA ^= item
    hashA = Math.imul(hashA, 16777619) >>> 0
    hashB ^= (item + 0x7ed55d16 + ((hashB << 6) >>> 0) + (hashB >>> 2)) >>> 0
    hashB >>>= 0
    length += 1
  }
  return `${length}:${hashA.toString(16).padStart(8, "0")}:${hashB.toString(16).padStart(8, "0")}`
}

const toCompactObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : undefined

const toCompactArray = (value) => (Array.isArray(value) && value.length > 0 ? value : undefined)

export const compactPerfectPrototypeMiningSourceRow = (row) => {
  if (!row || typeof row !== "object") return row
  const compact = {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    templateId: row.templateId,
    seedKey: row.seedKey,
    symbol: row.symbol,
    dateKey: row.dateKey,
    eventDate: row.eventDate,
    decisionDateKey: row.decisionDateKey,
    asOfDateKey: row.asOfDateKey,
    asOfDate: row.asOfDate,
    strategyMode: row.strategyMode,
    contextSurface: row.contextSurface,
    featureVec: toCompactObject(row.featureVec),
    globalFeatureVec: toCompactObject(row.globalFeatureVec),
    eventFeatureVec: toCompactObject(row.eventFeatureVec),
    eventMeta: toCompactObject(row.eventMeta),
    marketContextVec: toCompactObject(row.marketContextVec),
    xsecEventVec: toCompactObject(row.xsecEventVec),
    seq40: toCompactArray(row.seq40),
    seq40q: toCompactArray(row.seq40q),
    seq40Scale: row.seq40Scale,
    seq150: toCompactArray(row.seq150),
    seq150q: toCompactArray(row.seq150q),
    seq150Scale: row.seq150Scale,
    outcomeHitTarget: row.outcomeHitTarget,
    eventOutcome: toCompactObject(row.eventOutcome),
    contextualTokens: toCompactArray(row.contextualTokens),
    categoricalTokens: toCompactArray(row.categoricalTokens),
    stepALaneId: row.stepALaneId,
    impulseLookbackDays: row.impulseLookbackDays,
  }
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined))
}

const compactPreparedMiningRow = (row, tokens, surfaceName) => {
  if (surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE) {
    return {
      ...row,
      tokens: Array.isArray(tokens) ? tokens : [],
    }
  }
  return {
    sourceType: String(row?.sourceType ?? "").trim(),
    sourceId: String(row?.sourceId ?? "").trim(),
    dateKey: String(row?.dateKey ?? "").trim(),
    symbol: String(row?.symbol ?? "").trim(),
    stepALaneId: String(row?.stepALaneId ?? "").trim() || null,
    impulseLookbackDays:
      Number.isInteger(Number(row?.impulseLookbackDays)) && Number(row?.impulseLookbackDays) >= 0
        ? Number(row.impulseLookbackDays)
        : null,
    outcomeHitTarget: typeof row?.outcomeHitTarget === "boolean" ? row.outcomeHitTarget : null,
    tokens: Array.isArray(tokens) ? tokens : [],
  }
}

export const safeRate = (numValue, denValue) => {
  const numerator = Number(numValue)
  const denominator = Number(denValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

const createPerfectPrototypeMatchedDateHitStatsComputer = ({
  rowCalendarIndexes = [],
  calendarDateKeys = [],
  calendarFoldKeys = [],
}) => {
  const calendarLength = Array.isArray(calendarDateKeys) ? calendarDateKeys.length : 0
  const dateCountsScratch = new Uint32Array(calendarLength)
  const touchedDateIndexesScratch = new Uint32Array(calendarLength)
  return ({ rowIndexes, hitCountMode, hitCountDaySymbolCap }) => {
    const resolvedHitCountMode = resolvePerfectPrototypeHitCountMode(hitCountMode)
    const resolvedHitCountDaySymbolCap = resolvePerfectPrototypeHitCountDaySymbolCap(
      hitCountDaySymbolCap,
      2,
    )
    const safeRowIndexes =
      Array.isArray(rowIndexes) || isTypedNumericArray(rowIndexes) ? rowIndexes : []
    let rawCount = 0
    let touchedDateCount = 0
    for (const rawRowIndex of safeRowIndexes) {
      const rowIndex = Number(rawRowIndex)
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCalendarIndexes.length) continue
      const dateIndex = Number(rowCalendarIndexes[rowIndex] ?? Number.NaN)
      if (!Number.isInteger(dateIndex) || dateIndex < 0 || dateIndex >= calendarLength) continue
      if (dateCountsScratch[dateIndex] === 0) {
        touchedDateIndexesScratch[touchedDateCount] = dateIndex
        touchedDateCount += 1
      }
      dateCountsScratch[dateIndex] += 1
      rawCount += 1
    }
    const hitDates = new Array(touchedDateCount)
    const effectiveCountsByDate = new Array(touchedDateCount)
    const effectiveCountsByFold = new Map()
    let cappedCount = 0
    let maxSymbolsMatchedPerDate = 0
    for (let index = 0; index < touchedDateCount; index += 1) {
      const dateIndex = touchedDateIndexesScratch[index]
      const count = Number(dateCountsScratch[dateIndex] ?? 0)
      dateCountsScratch[dateIndex] = 0
      const effectiveCount =
        resolvedHitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE
          ? Math.min(resolvedHitCountDaySymbolCap, count)
          : count
      cappedCount += effectiveCount
      maxSymbolsMatchedPerDate = Math.max(maxSymbolsMatchedPerDate, count)
      hitDates[index] = calendarDateKeys[dateIndex]
      effectiveCountsByDate[index] = effectiveCount
      const foldKey = String(calendarFoldKeys?.[dateIndex] ?? "").trim() || null
      if (foldKey) {
        effectiveCountsByFold.set(
          foldKey,
          Number(effectiveCountsByFold.get(foldKey) ?? 0) + effectiveCount,
        )
      }
    }
    hitDates.sort((left, right) => String(left).localeCompare(String(right)))
    effectiveCountsByDate.sort((left, right) => Number(right) - Number(left))
    const top1DateHitCount = Number(effectiveCountsByDate[0] ?? 0)
    const top3DateHitCount =
      Number(effectiveCountsByDate[0] ?? 0) +
      Number(effectiveCountsByDate[1] ?? 0) +
      Number(effectiveCountsByDate[2] ?? 0)
    const hitMonths = uniqueSorted(hitDates.map((dateKey) => buildPerfectPrototypeMonthKey(dateKey)).filter(Boolean))
    const hitQuarters = uniqueSorted(
      hitDates.map((dateKey) => buildPerfectPrototypeQuarterKey(dateKey)).filter(Boolean),
    )
    const hitFolds = uniqueSorted(Array.from(effectiveCountsByFold.keys()))
    const effectiveCountsByFoldSorted = Array.from(effectiveCountsByFold.values()).sort(
      (left, right) => Number(right) - Number(left),
    )
    const top1FoldHitCount = Number(effectiveCountsByFoldSorted[0] ?? 0)
    const top3FoldHitCount =
      Number(effectiveCountsByFoldSorted[0] ?? 0) +
      Number(effectiveCountsByFoldSorted[1] ?? 0) +
      Number(effectiveCountsByFoldSorted[2] ?? 0)
    return {
      hitCountMode: resolvedHitCountMode,
      hitCountDaySymbolCap: resolvedHitCountDaySymbolCap,
      rawCount,
      cappedCount,
      distinctDateCount: touchedDateCount,
      matchedMonthCount: hitMonths.length,
      matchedQuarterCount: hitQuarters.length,
      matchedFoldCount: hitFolds.length,
      maxSymbolsMatchedPerDate,
      hitDates,
      hitMonths,
      hitQuarters,
      hitFolds,
      top1DateHitCount,
      top3DateHitCount,
      top1DateHitShare: safeRate(top1DateHitCount, cappedCount),
      top3DateHitShare: safeRate(top3DateHitCount, cappedCount),
      top1FoldHitCount,
      top3FoldHitCount,
      top1FoldHitShare: safeRate(top1FoldHitCount, cappedCount),
      top3FoldHitShare: safeRate(top3FoldHitCount, cappedCount),
      matchedDateSignatureHash: buildPerfectPrototypeMatchedDateSignatureHash(hitDates),
      matchedMonthSignatureHash:
        hitMonths.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitMonths) : null,
      matchedQuarterSignatureHash:
        hitQuarters.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitQuarters) : null,
      matchedFoldSignatureHash:
        hitFolds.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitFolds) : null,
    }
  }
}

export const resolvePerfectPrototypeCollectionMode = (minTrainPrecision = 1) =>
  Number(minTrainPrecision) >= 1
    ? PERFECT_PROTOTYPE_TRAIN_PRECISION_1_ONLY_COLLECTION_MODE
    : PERFECT_PROTOTYPE_TRAIN_PRECISION_GTE_THRESHOLD_COLLECTION_MODE

export const mergeSortedIndexCollections = (...collections) => {
  const normalized = collections
    .flatMap((collection) =>
      Array.from(iterateIndexCollection(collection), (value) => Number(value)).filter(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    )
    .sort((left, right) => left - right)
  if (normalized.length < 2) {
    return Uint32Array.from(normalized)
  }
  const deduped = []
  let previous = null
  for (const value of normalized) {
    if (value === previous) continue
    deduped.push(value)
    previous = value
  }
  return Uint32Array.from(deduped)
}

export const intersectSortedIntegers = (left, right) => {
  const leftLength = getIndexCollectionLength(left)
  const rightLength = getIndexCollectionLength(right)
  if (leftLength < 1 || rightLength < 1) return []
  const smaller = leftLength <= rightLength ? left : right
  const larger = leftLength <= rightLength ? right : left
  const smallerLength = getIndexCollectionLength(smaller)
  const largerLength = getIndexCollectionLength(larger)
  const useGallop = largerLength >= smallerLength * 8
  const out = []
  let si = 0
  let li = 0
  const gallopToAtLeast = (array, startIndex, target) => {
    if (startIndex >= array.length) return array.length
    if (Number(array[startIndex]) >= target) return startIndex
    let low = startIndex
    let high = startIndex + 1
    while (high < array.length && Number(array[high]) < target) {
      low = high
      high = Math.min(array.length, startIndex + (high - startIndex + 1) * 2)
    }
    let leftCursor = startIndex
    let rightCursor = Math.min(high, array.length - 1)
    while (leftCursor <= rightCursor) {
      const mid = leftCursor + Math.floor((rightCursor - leftCursor) / 2)
      if (Number(array[mid]) < target) {
        leftCursor = mid + 1
      } else {
        rightCursor = mid - 1
      }
    }
    return leftCursor
  }
  while (si < smallerLength && li < largerLength) {
    const leftValue = Number(smaller[si])
    const rightValue = Number(larger[li])
    if (leftValue === rightValue) {
      out.push(leftValue)
      si += 1
      li += 1
      continue
    }
    if (leftValue < rightValue) {
      si += 1
      continue
    }
    li = useGallop ? gallopToAtLeast(larger, li + 1, leftValue) : li + 1
  }
  return out
}

export const countIntersectSortedIntegers = (left, right, stopAt = Number.POSITIVE_INFINITY) => {
  const leftLength = getIndexCollectionLength(left)
  const rightLength = getIndexCollectionLength(right)
  if (leftLength < 1 || rightLength < 1) return 0
  const smaller = leftLength <= rightLength ? left : right
  const larger = leftLength <= rightLength ? right : left
  const smallerLength = getIndexCollectionLength(smaller)
  const largerLength = getIndexCollectionLength(larger)
  const useGallop = largerLength >= smallerLength * 8
  const limit = Number.isFinite(Number(stopAt)) ? Math.max(0, Math.floor(Number(stopAt))) : Number.POSITIVE_INFINITY
  let si = 0
  let li = 0
  let count = 0
  const gallopToAtLeast = (array, startIndex, target) => {
    if (startIndex >= array.length) return array.length
    if (Number(array[startIndex]) >= target) return startIndex
    let low = startIndex
    let high = startIndex + 1
    while (high < array.length && Number(array[high]) < target) {
      low = high
      high = Math.min(array.length, startIndex + (high - startIndex + 1) * 2)
    }
    let leftCursor = startIndex
    let rightCursor = Math.min(high, array.length - 1)
    while (leftCursor <= rightCursor) {
      const mid = leftCursor + Math.floor((rightCursor - leftCursor) / 2)
      if (Number(array[mid]) < target) {
        leftCursor = mid + 1
      } else {
        rightCursor = mid - 1
      }
    }
    return leftCursor
  }
  while (si < smallerLength && li < largerLength) {
    const leftValue = Number(smaller[si])
    const rightValue = Number(larger[li])
    if (leftValue === rightValue) {
      count += 1
      if (count >= limit) return count
      si += 1
      li += 1
      continue
    }
    if (leftValue < rightValue) {
      si += 1
      continue
    }
    li = useGallop ? gallopToAtLeast(larger, li + 1, leftValue) : li + 1
  }
  return count
}

const normalizeDateKeyRange = (rows, { startDate, endDate } = {}) =>
  (Array.isArray(rows) ? rows : []).filter((row) => {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) return false
    if (startDate && dateKey < startDate) return false
    if (endDate && dateKey > endDate) return false
    return true
  })

const buildTokenStats = ({ rows }) => {
  const stats = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((row, rowIndex) => {
    for (const token of Array.isArray(row?.tokens) ? row.tokens : []) {
      const current = stats.get(token) ?? {
        token: String(token ?? "").trim(),
        positiveMatchCount: 0,
        negativeMatchCount: 0,
      }
      if (row?.outcomeHitTarget === true) {
        current.positiveMatchCount += 1
      } else if (row?.outcomeHitTarget === false) {
        current.negativeMatchCount += 1
      }
      stats.set(current.token, current)
    }
  })
  for (const current of stats.values()) {
    current.positiveRowIndexes = new Uint32Array(current.positiveMatchCount)
    current.negativeRowIndexes = new Uint32Array(current.negativeMatchCount)
    current.positiveWriteIndex = 0
    current.negativeWriteIndex = 0
  }
  ;(Array.isArray(rows) ? rows : []).forEach((row, rowIndex) => {
    for (const token of Array.isArray(row?.tokens) ? row.tokens : []) {
      const current = stats.get(String(token ?? "").trim())
      if (!current) continue
      if (row?.outcomeHitTarget === true) {
        current.positiveRowIndexes[current.positiveWriteIndex] = rowIndex
        current.positiveWriteIndex += 1
      } else if (row?.outcomeHitTarget === false) {
        current.negativeRowIndexes[current.negativeWriteIndex] = rowIndex
        current.negativeWriteIndex += 1
      }
    }
  })
  for (const current of stats.values()) {
    delete current.positiveWriteIndex
    delete current.negativeWriteIndex
  }
  return stats
}

const buildTokenStatsRowsets = ({ tokenStats, rowCount }) => {
  for (const current of tokenStats.values()) {
    current.positiveRowset = createPerfectPrototypeRowset({
      values: current.positiveRowIndexes,
      universeSize: rowCount,
      allowDense: true,
    })
    current.negativeRowset = createPerfectPrototypeRowset({
      values: current.negativeRowIndexes,
      universeSize: rowCount,
      allowDense: true,
    })
  }
  return tokenStats
}

const serializeTokenStatsEntries = (tokenStats) =>
  Array.from(tokenStats.values()).map((current) => ({
    token: String(current?.token ?? "").trim(),
    positiveMatchCount: Number(current?.positiveMatchCount ?? 0),
    negativeMatchCount: Number(current?.negativeMatchCount ?? 0),
    positiveRowIndexes: toUint32Array(current?.positiveRowIndexes),
    negativeRowIndexes: toUint32Array(current?.negativeRowIndexes),
  }))

const rebuildTokenStatsMapFromEntries = (tokenStatsEntries) => {
  const stats = new Map()
  for (const entry of Array.isArray(tokenStatsEntries) ? tokenStatsEntries : []) {
    const token = String(entry?.token ?? "").trim()
    if (!token) continue
    stats.set(token, {
      token,
      positiveMatchCount: Number(entry?.positiveMatchCount ?? 0),
      negativeMatchCount: Number(entry?.negativeMatchCount ?? 0),
      positiveRowIndexes: toUint32Array(entry?.positiveRowIndexes),
      negativeRowIndexes: toUint32Array(entry?.negativeRowIndexes),
    })
  }
  return stats
}

const normalizePreparePhaseTimings = (phaseTimings = {}) => ({
  prepareRowsSec: Number(phaseTimings?.prepareRowsSec ?? 0),
  buildTokenizerSpecSec: Number(phaseTimings?.buildTokenizerSpecSec ?? 0),
  tokenizeRowsSec: Number(phaseTimings?.tokenizeRowsSec ?? 0),
  buildTokenStatsSec: Number(phaseTimings?.buildTokenStatsSec ?? 0),
})

const countIntersectPerfectPrototypeRowsetsStopAt = (
  leftRowset,
  rightRowset,
  stopAt = Number.POSITIVE_INFINITY,
) => {
  const exactCount = intersectPerfectPrototypeRowsetsCount(leftRowset, rightRowset)
  const limit = Number.isFinite(Number(stopAt)) ? Math.max(0, Math.floor(Number(stopAt))) : Number.POSITIVE_INFINITY
  return Number.isFinite(limit) ? Math.min(exactCount, limit) : exactCount
}

const materializePerfectPrototypeRowsetValuesDetached = (rowset) => {
  const values = materializePerfectPrototypeRowsetValues(rowset)
  return values instanceof Uint32Array ? values.slice() : Uint32Array.from(values ?? [])
}

const releasePerfectPrototypeRowsetIfBorrowed = (rowset) => {
  if (!rowset || typeof rowset !== "object") return
  releasePerfectPrototypeBorrowedRowset(rowset)
}

const createOutcomeRowIndexArray = (rows, outcome) => {
  const collected = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rows[rowIndex]?.outcomeHitTarget === outcome) {
      collected.push(rowIndex)
    }
  }
  return Uint32Array.from(collected)
}

export const buildMatchRows = ({ rows, rules }) => {
  const matchRows = []
  const matchedRuleIdsByRow = new Map()
  for (const rule of rules) {
    const ruleMatchRowIndexes =
      rule?.matchRowIndexes ?? rule?.positiveMatchRowIndexes ?? EMPTY_UINT32
    for (const rowIndex of ruleMatchRowIndexes) {
      const list = matchedRuleIdsByRow.get(rowIndex) ?? []
      list.push(rule.ruleId)
      matchedRuleIdsByRow.set(rowIndex, list)
    }
  }
  for (const [rowIndex, matchedRuleIds] of matchedRuleIdsByRow.entries()) {
    const row = rows[rowIndex]
    if (!row) continue
    const uniqueRuleIds = uniqueSorted(matchedRuleIds)
    matchRows.push({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      dateKey: row.dateKey,
      symbol: row.symbol,
      outcomeHitTarget: row.outcomeHitTarget,
      matchedRuleIds: uniqueRuleIds,
      matchedRuleCount: uniqueRuleIds.length,
      primaryRuleId: uniqueRuleIds[0] ?? null,
    })
  }
  return matchRows.sort((left, right) => {
    if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey))
    return String(left.symbol).localeCompare(String(right.symbol))
  })
}

const defaultMinerOptions = {
  trainStartDate: null,
  trainEndDate: null,
  minHitCount: 6,
  minTrainPrecision: 1,
  maxTrainHitCount: null,
  enableTrainMatchedDatePrune: false,
  minTrainMatchedDates: null,
  minTrainMatchedMonths: null,
  minTrainMatchedQuarters: null,
  minTrainMatchedFolds: null,
  foldScheme: null,
  maxTop1DateHitShare: null,
  maxTop3DateHitShare: null,
  maxTop1FoldHitShare: null,
  maxTop3FoldHitShare: null,
  enablePromotableSearchPrune: false,
  enablePromotableSearchOrdering: false,
  enableYearHitUpperBoundPrune: false,
  coreYears: [],
  excludedBoundaryYears: [],
  minTrainHitsPerCoreYear: null,
  promotableMinTrainMatchedDates: null,
  promotableMinTrainMatchedMonths: null,
  promotableMinTrainMatchedFolds: null,
  promotableMaxTop1DateHitShare: null,
  promotableMaxTop3DateHitShare: null,
  promotableMaxTop1FoldHitShare: null,
  promotableMaxTop3FoldHitShare: null,
  maxRulesPerMatchedDateSignature: null,
  maxRulesPerMatchedMonthSignature: null,
  maxRulesPerMatchedQuarterSignature: null,
  enableDiverseSearchOrdering: false,
  diverseBeamMaxPerMonthSignature: null,
  diverseBeamMaxPerQuarterSignature: null,
  diverseBeamMaxPerAnchorFamily: null,
  enableLaneStratifiedMining: false,
  enableFamilyScopedMining: false,
  familySeedMaxTopBucket: null,
  familySeedMaxMidBucket: null,
  familySeedMaxLowBucket: null,
  midFamilyMinShare: 0.6,
  lowFamilyMinShare: 0.6,
  lowFamilySearchMinHitCount: null,
  lowFamilyMinTrainMatchedDates: null,
  lowFamilyMinTrainMatchedMonths: null,
  lowFamilyMinTrainMatchedFolds: null,
  recentOnlyFamilyIds: [],
  supportCases: [],
  supportCasesFile: null,
  supportFeatureCases: [],
  supportFeatureCasesFile: null,
  supportCaseMaxRootSeeds: null,
  supportCaseMaxEffectiveRootSeeds: null,
  supportCaseMinRootOverlap: null,
  supportCaseMinPrefixOverlap: null,
  supportCasePrefixDepthLimit: null,
  supportCaseMinDonorRootOverlap: null,
  supportCaseMinDonorPrefixOverlap: null,
  supportCaseDonorPrefixDepthLimit: null,
  supportCaseFailIfRootScopeUncompressed: false,
  enableSubgroupPrepass: false,
  enableSubgroupStability: false,
  enableSubgroupDiversity: false,
  subgroupMinMatchedDates: null,
  subgroupMinMatchedMonths: null,
  subgroupMinMatchedFolds: null,
  subgroupMaxRootSeeds: null,
  subgroupMaxManifests: null,
  subgroupMinSelectionFrequency: null,
  subgroupMinFoldPresenceCount: null,
  subgroupMinWindowPresenceCount: null,
  subgroupMaxTokenJaccard: null,
  subgroupMaxAxisOverlap: null,
  subgroupMaxDateCoverJaccard: null,
  subgroupEarlyDateRetentionRatio: null,
  subgroupEarlyMonthRetentionRatio: null,
  subgroupEarlyFoldRetentionRatio: null,
  enableExactCompletionSolver: false,
  exactCompletionMode: null,
  exactCompletionMaxCandidates: 24,
  exactCompletionMaxAdditionalTokens: 3,
  enableCrossfitHardNegativeRefinement: false,
  crossfitHoldoutWindows: 6,
  crossfitMinWindowSupport: 2,
  crossfitHardNegativeWeight: 4,
  enableJointFeasibilitySolver: false,
  jointFeasibilityMinCrossfitPositiveWindows: 2,
  jointFeasibilityMaxCrossfitNegativeWindows: 0,
  jointFeasibilityRequireHistoricalSupport: false,
  jointFeasibilityHistoricalSupportCaseIds: [],
  enableSupportManifoldSignature: false,
  enableSupportMetricFeatures: false,
  enableAdaptiveThresholdAtoms: false,
  maxGapTradingDays: 40,
  maxRuleSize: 4,
  maxSeedTokens: 192,
  maxRules: 500,
  maxSearchStates: 750000,
  maxRejectedRuleSamples: 1000,
  hitCountMode: PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  hitCountDaySymbolCap: 2,
  surfaceName: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
  enableDiverseCatalogSelection: false,
  enableMdlCatalogSelection: false,
  diverseCatalogTargetRules: null,
  diverseNoveltyWeight: 1,
  diverseOverlapPenaltyWeight: 1,
  diverseAnchorFamilyPenaltyWeight: 0.5,
  topFamilyMaxQuota: null,
  midFamilyMinQuota: null,
  lowFamilyMinQuota: null,
  mdlDescriptionLengthWeight: 1,
  mdlOverlapPenaltyWeight: 1,
  tokenizerOptions: {},
}

const prejumpPredictiveDefaultMinerOptions = {
  maxGapTradingDays: 100000,
  maxRuleSize: 6,
  maxSeedTokens: 4000,
  maxRules: 4000,
  maxSearchStates: 20000000,
}

export const normalizeMinerOptions = (options = {}) => {
  const surfaceName =
    String(options?.surfaceName ?? defaultMinerOptions.surfaceName).trim() ||
    PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
  const resolvedDefaultMinerOptions =
    surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE
      ? {
          ...defaultMinerOptions,
          ...prejumpPredictiveDefaultMinerOptions,
          surfaceName,
        }
      : defaultMinerOptions
  const resolvedMaxGapTradingDays = clampInteger(
    options?.maxGapTradingDays,
    resolvedDefaultMinerOptions.maxGapTradingDays,
    1,
    100000,
  )
  // Predictive mining intentionally runs a much larger no-gap search budget.
  // Legacy surfaces keep the narrower adaptive defaults.
  const adaptiveMaxSeedTokens =
    surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE
      ? resolvedDefaultMinerOptions.maxSeedTokens
      : resolvedMaxGapTradingDays >= 100000
        ? 512
        : resolvedDefaultMinerOptions.maxSeedTokens
  const adaptiveMaxRules =
    surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE
      ? resolvedDefaultMinerOptions.maxRules
      : resolvedMaxGapTradingDays >= 100000
        ? 2000
        : resolvedDefaultMinerOptions.maxRules
  const includeFeaturePrefixes =
    Array.isArray(options?.tokenizerOptions?.includeFeaturePrefixes) &&
    options.tokenizerOptions.includeFeaturePrefixes.length > 0
      ? options.tokenizerOptions.includeFeaturePrefixes
      : resolvePerfectPrototypeFeaturePrefixes(surfaceName)
  const enableIntervalAtoms = Boolean(
    options?.enableIntervalAtoms ?? options?.tokenizerOptions?.enableIntervalAtoms ?? false,
  )
  const enableMacroAtoms = Boolean(
    options?.enableMacroAtoms ?? options?.tokenizerOptions?.enableMacroAtoms ?? false,
  )
  const enableSupportAnchorAtoms = Boolean(
    options?.enableSupportAnchorAtoms ?? options?.tokenizerOptions?.enableSupportAnchorAtoms ?? false,
  )
  const enableSupportManifoldSignature = Boolean(
    options?.enableSupportManifoldSignature ??
      options?.tokenizerOptions?.enableSupportManifoldSignature ??
      false,
  )
  const enableAdaptiveThresholdAtoms = Boolean(
    options?.enableAdaptiveThresholdAtoms ??
      options?.tokenizerOptions?.enableAdaptiveThresholdAtoms ??
      false,
  )
  if (enableSupportAnchorAtoms && !enableMacroAtoms) {
    throw new Error(
      "Perfect prototype miner requires enableMacroAtoms=true when enableSupportAnchorAtoms=true",
    )
  }
  if (enableAdaptiveThresholdAtoms && !enableSupportManifoldSignature) {
    throw new Error(
      "Perfect prototype miner requires enableSupportManifoldSignature=true when enableAdaptiveThresholdAtoms=true",
    )
  }
  const requestedSearchMode = String(
    options?.searchMode ?? resolvedDefaultMinerOptions.searchMode,
  ).trim()
  if (!PERFECT_PROTOTYPE_SEARCH_MODES.has(requestedSearchMode)) {
    throw new Error(
      `unsupported perfect prototype search mode: ${requestedSearchMode || "<empty>"}`,
    )
  }
  const searchMode = requestedSearchMode
  const minTrainPrecision = clampNumber(
    options?.minTrainPrecision,
    resolvedDefaultMinerOptions.minTrainPrecision,
    0,
    1,
  )
  const maxTrainHitCount = clampOptionalInteger(
    options?.maxTrainHitCount,
    resolvedDefaultMinerOptions.maxTrainHitCount,
    1,
    100000,
  )
  const enableTrainMatchedDatePrune = Boolean(
    options?.enableTrainMatchedDatePrune ?? resolvedDefaultMinerOptions.enableTrainMatchedDatePrune,
  )
  const minTrainMatchedDates = clampOptionalInteger(
    options?.minTrainMatchedDates,
    resolvedDefaultMinerOptions.minTrainMatchedDates,
    1,
    100000,
  )
  const minTrainMatchedMonths = clampOptionalInteger(
    options?.minTrainMatchedMonths,
    resolvedDefaultMinerOptions.minTrainMatchedMonths,
    1,
    100000,
  )
  const minTrainMatchedQuarters = clampOptionalInteger(
    options?.minTrainMatchedQuarters,
    resolvedDefaultMinerOptions.minTrainMatchedQuarters,
    1,
    100000,
  )
  const minTrainMatchedFolds = clampOptionalInteger(
    options?.minTrainMatchedFolds,
    resolvedDefaultMinerOptions.minTrainMatchedFolds,
    1,
    100000,
  )
  const foldScheme =
    resolvePerfectPrototypeFoldScheme(options?.foldScheme ?? resolvedDefaultMinerOptions.foldScheme) ?? null
  if (
    enableTrainMatchedDatePrune &&
    !Number.isInteger(minTrainMatchedDates) &&
    !Number.isInteger(minTrainMatchedMonths) &&
    !Number.isInteger(minTrainMatchedQuarters) &&
    !Number.isInteger(minTrainMatchedFolds)
  ) {
    throw new Error(
      "Perfect prototype miner requires at least one of minTrainMatchedDates|minTrainMatchedMonths|minTrainMatchedQuarters|minTrainMatchedFolds when enableTrainMatchedDatePrune=true",
    )
  }
  const maxTop1DateHitShare = clampOptionalNumber(
    options?.maxTop1DateHitShare,
    resolvedDefaultMinerOptions.maxTop1DateHitShare,
    0,
    1,
  )
  const maxTop3DateHitShare = clampOptionalNumber(
    options?.maxTop3DateHitShare,
    resolvedDefaultMinerOptions.maxTop3DateHitShare,
    0,
    1,
  )
  const maxTop1FoldHitShare = clampOptionalNumber(
    options?.maxTop1FoldHitShare,
    resolvedDefaultMinerOptions.maxTop1FoldHitShare,
    0,
    1,
  )
  const maxTop3FoldHitShare = clampOptionalNumber(
    options?.maxTop3FoldHitShare,
    resolvedDefaultMinerOptions.maxTop3FoldHitShare,
    0,
    1,
  )
  const enablePromotableSearchPrune = Boolean(
    options?.enablePromotableSearchPrune ?? resolvedDefaultMinerOptions.enablePromotableSearchPrune,
  )
  const enablePromotableSearchOrdering = Boolean(
    options?.enablePromotableSearchOrdering ?? resolvedDefaultMinerOptions.enablePromotableSearchOrdering,
  )
  const enableYearHitUpperBoundPrune = Boolean(
    options?.enableYearHitUpperBoundPrune ?? resolvedDefaultMinerOptions.enableYearHitUpperBoundPrune,
  )
  const coreYears = uniqueSortedNumbers(
    options?.coreYears ?? resolvedDefaultMinerOptions.coreYears,
  )
  const excludedBoundaryYears = uniqueSortedNumbers(
    options?.excludedBoundaryYears ?? resolvedDefaultMinerOptions.excludedBoundaryYears,
  )
  const minTrainHitsPerCoreYear = clampOptionalInteger(
    options?.minTrainHitsPerCoreYear,
    resolvedDefaultMinerOptions.minTrainHitsPerCoreYear,
    1,
    100000,
  )
  const promotableMinTrainMatchedDates = clampOptionalInteger(
    options?.promotableMinTrainMatchedDates,
    resolvedDefaultMinerOptions.promotableMinTrainMatchedDates,
    1,
    100000,
  )
  const promotableMinTrainMatchedMonths = clampOptionalInteger(
    options?.promotableMinTrainMatchedMonths,
    resolvedDefaultMinerOptions.promotableMinTrainMatchedMonths,
    1,
    100000,
  )
  const promotableMinTrainMatchedFolds = clampOptionalInteger(
    options?.promotableMinTrainMatchedFolds,
    resolvedDefaultMinerOptions.promotableMinTrainMatchedFolds,
    1,
    100000,
  )
  const promotableMaxTop1DateHitShare = clampOptionalNumber(
    options?.promotableMaxTop1DateHitShare,
    resolvedDefaultMinerOptions.promotableMaxTop1DateHitShare,
    0,
    1,
  )
  const promotableMaxTop3DateHitShare = clampOptionalNumber(
    options?.promotableMaxTop3DateHitShare,
    resolvedDefaultMinerOptions.promotableMaxTop3DateHitShare,
    0,
    1,
  )
  const promotableMaxTop1FoldHitShare = clampOptionalNumber(
    options?.promotableMaxTop1FoldHitShare,
    resolvedDefaultMinerOptions.promotableMaxTop1FoldHitShare,
    0,
    1,
  )
  const promotableMaxTop3FoldHitShare = clampOptionalNumber(
    options?.promotableMaxTop3FoldHitShare,
    resolvedDefaultMinerOptions.promotableMaxTop3FoldHitShare,
    0,
    1,
  )
  if (
    (Number.isInteger(minTrainMatchedFolds) ||
      String(options?.maxTop1FoldHitShare ?? "").trim() ||
      String(options?.maxTop3FoldHitShare ?? "").trim() ||
      Number.isInteger(promotableMinTrainMatchedFolds) ||
      Number.isFinite(promotableMaxTop1FoldHitShare) ||
      Number.isFinite(promotableMaxTop3FoldHitShare)) &&
    !foldScheme
  ) {
    throw new Error(
      "Perfect prototype miner requires foldScheme=chronological_<N> when fold breadth or fold-share controls are enabled",
    )
  }
  const maxRulesPerMatchedDateSignature = clampOptionalInteger(
    options?.maxRulesPerMatchedDateSignature,
    resolvedDefaultMinerOptions.maxRulesPerMatchedDateSignature,
    1,
    100000,
  )
  const maxRulesPerMatchedMonthSignature = clampOptionalInteger(
    options?.maxRulesPerMatchedMonthSignature,
    resolvedDefaultMinerOptions.maxRulesPerMatchedMonthSignature,
    1,
    100000,
  )
  const maxRulesPerMatchedQuarterSignature = clampOptionalInteger(
    options?.maxRulesPerMatchedQuarterSignature,
    resolvedDefaultMinerOptions.maxRulesPerMatchedQuarterSignature,
    1,
    100000,
  )
  const enableDiverseCatalogSelection = Boolean(
    options?.enableDiverseCatalogSelection ?? resolvedDefaultMinerOptions.enableDiverseCatalogSelection,
  )
  const enableMdlCatalogSelection = Boolean(
    options?.enableMdlCatalogSelection ?? resolvedDefaultMinerOptions.enableMdlCatalogSelection,
  )
  const enableDiverseSearchOrdering = Boolean(
    options?.enableDiverseSearchOrdering ?? resolvedDefaultMinerOptions.enableDiverseSearchOrdering,
  )
  const enableLaneStratifiedMining = Boolean(
    options?.enableLaneStratifiedMining ?? resolvedDefaultMinerOptions.enableLaneStratifiedMining,
  )
  const enableFamilyScopedMining = Boolean(
    options?.enableFamilyScopedMining ?? resolvedDefaultMinerOptions.enableFamilyScopedMining,
  )
  const familySeedMaxTopBucket = clampOptionalInteger(
    options?.familySeedMaxTopBucket,
    resolvedDefaultMinerOptions.familySeedMaxTopBucket,
    1,
    100000,
  )
  const familySeedMaxMidBucket = clampOptionalInteger(
    options?.familySeedMaxMidBucket,
    resolvedDefaultMinerOptions.familySeedMaxMidBucket,
    1,
    100000,
  )
  const familySeedMaxLowBucket = clampOptionalInteger(
    options?.familySeedMaxLowBucket,
    resolvedDefaultMinerOptions.familySeedMaxLowBucket,
    1,
    100000,
  )
  const midFamilyMinShare = clampNumber(
    options?.midFamilyMinShare,
    resolvedDefaultMinerOptions.midFamilyMinShare,
    0,
    1,
  )
  const lowFamilyMinShare = clampNumber(
    options?.lowFamilyMinShare,
    resolvedDefaultMinerOptions.lowFamilyMinShare,
    0,
    1,
  )
  const lowFamilySearchMinHitCount = clampOptionalInteger(
    options?.lowFamilySearchMinHitCount,
    resolvedDefaultMinerOptions.lowFamilySearchMinHitCount,
    1,
    100000,
  )
  const lowFamilyMinTrainMatchedDatesExplicit = clampOptionalInteger(
    options?.lowFamilyMinTrainMatchedDates,
    resolvedDefaultMinerOptions.lowFamilyMinTrainMatchedDates,
    1,
    100000,
  )
  const lowFamilyMinTrainMatchedMonthsExplicit = clampOptionalInteger(
    options?.lowFamilyMinTrainMatchedMonths,
    resolvedDefaultMinerOptions.lowFamilyMinTrainMatchedMonths,
    1,
    100000,
  )
  const lowFamilyMinTrainMatchedFoldsExplicit = clampOptionalInteger(
    options?.lowFamilyMinTrainMatchedFolds,
    resolvedDefaultMinerOptions.lowFamilyMinTrainMatchedFolds,
    1,
    100000,
  )
  const lowFamilyMinTrainMatchedDates =
    lowFamilyMinTrainMatchedDatesExplicit ??
    (Number.isInteger(minTrainMatchedDates) ? minTrainMatchedDates + 1 : null)
  const lowFamilyMinTrainMatchedMonths =
    lowFamilyMinTrainMatchedMonthsExplicit ??
    (Number.isInteger(minTrainMatchedMonths) ? minTrainMatchedMonths + 1 : null)
  const lowFamilyMinTrainMatchedFolds =
    lowFamilyMinTrainMatchedFoldsExplicit ??
    (Number.isInteger(minTrainMatchedFolds) ? minTrainMatchedFolds + 1 : null)
  if (Number.isInteger(lowFamilyMinTrainMatchedFoldsExplicit) && !foldScheme) {
    throw new Error(
      "Perfect prototype miner requires foldScheme=chronological_<N> when lowFamilyMinTrainMatchedFolds is enabled",
    )
  }
  const recentOnlyFamilyIds = Array.from(
    buildPerfectPrototypeRecentOnlyMiningFamilyIdSet(options?.recentOnlyFamilyIds),
  )
  const supportCases = normalizePerfectPrototypeSupportCases(options?.supportCases)
  const supportCasesFile = String(options?.supportCasesFile ?? "").trim() || null
  const supportFeatureCases = normalizePerfectPrototypeSupportCases(options?.supportFeatureCases)
  const supportFeatureCasesFile = String(options?.supportFeatureCasesFile ?? "").trim() || null
  const resolvedSupportFeatureCases =
    supportFeatureCases.length > 0 ? supportFeatureCases : supportCases
  const supportSignatureConfig =
    enableSupportManifoldSignature === true
      ? buildPerfectPrototypeSupportSignatureTokenizerConfig({
          supportCases: resolvedSupportFeatureCases,
        })
      : null
  if (enableSupportManifoldSignature === true && !supportSignatureConfig) {
    throw new Error(
      "Perfect prototype miner requires supportFeatureCases/supportCases with numericFeatureMap/categoricalTokens when enableSupportManifoldSignature=true",
    )
  }
  const enableSupportMetricFeatures = Boolean(
    options?.enableSupportMetricFeatures ??
      options?.tokenizerOptions?.enableSupportMetricFeatures ??
      false,
  )
  if (enableSupportMetricFeatures && !enableSupportManifoldSignature) {
    throw new Error(
      "Perfect prototype miner requires enableSupportManifoldSignature=true when enableSupportMetricFeatures=true",
    )
  }
  const supportCaseMaxRootSeeds = clampOptionalInteger(
    options?.supportCaseMaxRootSeeds,
    resolvedDefaultMinerOptions.supportCaseMaxRootSeeds,
    1,
    4000,
  )
  const supportCaseMaxEffectiveRootSeeds = clampOptionalInteger(
    options?.supportCaseMaxEffectiveRootSeeds,
    resolvedDefaultMinerOptions.supportCaseMaxEffectiveRootSeeds,
    1,
    4000,
  )
  const supportCaseMinRootOverlap = clampOptionalInteger(
    options?.supportCaseMinRootOverlap,
    resolvedDefaultMinerOptions.supportCaseMinRootOverlap,
    0,
    8,
  )
  const supportCaseMinPrefixOverlap = clampOptionalInteger(
    options?.supportCaseMinPrefixOverlap,
    resolvedDefaultMinerOptions.supportCaseMinPrefixOverlap,
    0,
    8,
  )
  const supportCasePrefixDepthLimit = clampOptionalInteger(
    options?.supportCasePrefixDepthLimit,
    resolvedDefaultMinerOptions.supportCasePrefixDepthLimit,
    0,
    8,
  )
  const supportCaseMinDonorRootOverlap = clampOptionalInteger(
    options?.supportCaseMinDonorRootOverlap,
    resolvedDefaultMinerOptions.supportCaseMinDonorRootOverlap,
    0,
    8,
  )
  const supportCaseMinDonorPrefixOverlap = clampOptionalInteger(
    options?.supportCaseMinDonorPrefixOverlap,
    resolvedDefaultMinerOptions.supportCaseMinDonorPrefixOverlap,
    0,
    8,
  )
  const supportCaseDonorPrefixDepthLimit = clampOptionalInteger(
    options?.supportCaseDonorPrefixDepthLimit,
    resolvedDefaultMinerOptions.supportCaseDonorPrefixDepthLimit,
    0,
    8,
  )
  const supportCaseFailIfRootScopeUncompressed =
    options?.supportCaseFailIfRootScopeUncompressed ??
    resolvedDefaultMinerOptions.supportCaseFailIfRootScopeUncompressed
  const enableSubgroupPrepass = Boolean(
    options?.enableSubgroupPrepass ?? resolvedDefaultMinerOptions.enableSubgroupPrepass,
  )
  const subgroupMinMatchedDates = clampOptionalInteger(
    options?.subgroupMinMatchedDates,
    resolvedDefaultMinerOptions.subgroupMinMatchedDates,
    1,
    100000,
  )
  const subgroupMinMatchedMonths = clampOptionalInteger(
    options?.subgroupMinMatchedMonths,
    resolvedDefaultMinerOptions.subgroupMinMatchedMonths,
    1,
    100000,
  )
  const subgroupMinMatchedFolds = clampOptionalInteger(
    options?.subgroupMinMatchedFolds,
    resolvedDefaultMinerOptions.subgroupMinMatchedFolds,
    1,
    128,
  )
  const subgroupMaxRootSeeds = clampOptionalInteger(
    options?.subgroupMaxRootSeeds,
    resolvedDefaultMinerOptions.subgroupMaxRootSeeds,
    1,
    4000,
  )
  const enableSubgroupStability = Boolean(
    options?.enableSubgroupStability ?? resolvedDefaultMinerOptions.enableSubgroupStability,
  )
  const enableSubgroupDiversity = Boolean(
    options?.enableSubgroupDiversity ?? resolvedDefaultMinerOptions.enableSubgroupDiversity,
  )
  const subgroupMaxManifests = clampOptionalInteger(
    options?.subgroupMaxManifests,
    resolvedDefaultMinerOptions.subgroupMaxManifests,
    1,
    1024,
  )
  const subgroupMinSelectionFrequency = clampOptionalNumber(
    options?.subgroupMinSelectionFrequency,
    resolvedDefaultMinerOptions.subgroupMinSelectionFrequency,
    0,
    1,
  )
  const subgroupMinFoldPresenceCount = clampOptionalInteger(
    options?.subgroupMinFoldPresenceCount,
    resolvedDefaultMinerOptions.subgroupMinFoldPresenceCount,
    1,
    128,
  )
  const subgroupMinWindowPresenceCount = clampOptionalInteger(
    options?.subgroupMinWindowPresenceCount,
    resolvedDefaultMinerOptions.subgroupMinWindowPresenceCount,
    1,
    128,
  )
  const subgroupMaxTokenJaccard = clampOptionalNumber(
    options?.subgroupMaxTokenJaccard,
    resolvedDefaultMinerOptions.subgroupMaxTokenJaccard,
    0,
    1,
  )
  const subgroupMaxAxisOverlap = clampOptionalInteger(
    options?.subgroupMaxAxisOverlap,
    resolvedDefaultMinerOptions.subgroupMaxAxisOverlap,
    0,
    32,
  )
  const subgroupMaxDateCoverJaccard = clampOptionalNumber(
    options?.subgroupMaxDateCoverJaccard,
    resolvedDefaultMinerOptions.subgroupMaxDateCoverJaccard,
    0,
    1,
  )
  const subgroupEarlyDateRetentionRatio = clampOptionalNumber(
    options?.subgroupEarlyDateRetentionRatio,
    resolvedDefaultMinerOptions.subgroupEarlyDateRetentionRatio,
    0,
    1,
  )
  const subgroupEarlyMonthRetentionRatio = clampOptionalNumber(
    options?.subgroupEarlyMonthRetentionRatio,
    resolvedDefaultMinerOptions.subgroupEarlyMonthRetentionRatio,
    0,
    1,
  )
  const subgroupEarlyFoldRetentionRatio = clampOptionalNumber(
    options?.subgroupEarlyFoldRetentionRatio,
    resolvedDefaultMinerOptions.subgroupEarlyFoldRetentionRatio,
    0,
    1,
  )
  const enableExactCompletionSolver = Boolean(
    options?.enableExactCompletionSolver ?? resolvedDefaultMinerOptions.enableExactCompletionSolver,
  )
  const exactCompletionMode = String(
    options?.exactCompletionMode ?? resolvedDefaultMinerOptions.exactCompletionMode ?? "",
  ).trim() || null
  const exactCompletionMaxCandidates = clampOptionalInteger(
    options?.exactCompletionMaxCandidates,
    resolvedDefaultMinerOptions.exactCompletionMaxCandidates,
    1,
    512,
  )
  const exactCompletionMaxAdditionalTokens = clampOptionalInteger(
    options?.exactCompletionMaxAdditionalTokens,
    resolvedDefaultMinerOptions.exactCompletionMaxAdditionalTokens,
    0,
    6,
  )
  const enableCrossfitHardNegativeRefinement = Boolean(
    options?.enableCrossfitHardNegativeRefinement ??
      resolvedDefaultMinerOptions.enableCrossfitHardNegativeRefinement,
  )
  const crossfitHoldoutWindows = clampOptionalInteger(
    options?.crossfitHoldoutWindows,
    resolvedDefaultMinerOptions.crossfitHoldoutWindows,
    1,
    64,
  )
  const crossfitMinWindowSupport = clampOptionalInteger(
    options?.crossfitMinWindowSupport,
    resolvedDefaultMinerOptions.crossfitMinWindowSupport,
    1,
    1024,
  )
  const crossfitHardNegativeWeight = clampOptionalNumber(
    options?.crossfitHardNegativeWeight,
    resolvedDefaultMinerOptions.crossfitHardNegativeWeight,
    1,
    100,
  )
  const enableJointFeasibilitySolver = Boolean(
    options?.enableJointFeasibilitySolver ??
      resolvedDefaultMinerOptions.enableJointFeasibilitySolver,
  )
  const jointFeasibilityMinCrossfitPositiveWindows = clampOptionalInteger(
    options?.jointFeasibilityMinCrossfitPositiveWindows,
    resolvedDefaultMinerOptions.jointFeasibilityMinCrossfitPositiveWindows,
    1,
    64,
  )
  const jointFeasibilityMaxCrossfitNegativeWindows = clampOptionalInteger(
    options?.jointFeasibilityMaxCrossfitNegativeWindows,
    resolvedDefaultMinerOptions.jointFeasibilityMaxCrossfitNegativeWindows,
    0,
    64,
  )
  const jointFeasibilityRequireHistoricalSupport = Boolean(
    options?.jointFeasibilityRequireHistoricalSupport ??
      resolvedDefaultMinerOptions.jointFeasibilityRequireHistoricalSupport,
  )
  const jointFeasibilityHistoricalSupportCaseIds = uniqueSorted(
    options?.jointFeasibilityHistoricalSupportCaseIds,
  )
  if (
    enableSubgroupPrepass &&
    (!Number.isInteger(subgroupMinMatchedDates) ||
      !Number.isInteger(subgroupMinMatchedMonths) ||
      !Number.isInteger(subgroupMinMatchedFolds))
  ) {
    throw new Error(
      "Perfect prototype miner requires subgroupMinMatchedDates|subgroupMinMatchedMonths|subgroupMinMatchedFolds when enableSubgroupPrepass=true",
    )
  }
  if (
    enableSubgroupPrepass &&
    enableSubgroupStability &&
    (!Number.isFinite(subgroupMinSelectionFrequency) ||
      !Number.isInteger(subgroupMinFoldPresenceCount) ||
      !Number.isInteger(subgroupMinWindowPresenceCount))
  ) {
    throw new Error(
      "Perfect prototype miner requires subgroupMinSelectionFrequency|subgroupMinFoldPresenceCount|subgroupMinWindowPresenceCount when subgroup stability is enabled",
    )
  }
  if (
    enableSubgroupPrepass &&
    enableSubgroupDiversity &&
    (!Number.isFinite(subgroupMaxTokenJaccard) ||
      !Number.isInteger(subgroupMaxAxisOverlap) ||
      !Number.isFinite(subgroupMaxDateCoverJaccard))
  ) {
    throw new Error(
      "Perfect prototype miner requires subgroupMaxTokenJaccard|subgroupMaxAxisOverlap|subgroupMaxDateCoverJaccard when subgroup diversity is enabled",
    )
  }
  if (enableCrossfitHardNegativeRefinement && !enableExactCompletionSolver) {
    throw new Error(
      "Perfect prototype miner requires enableExactCompletionSolver=true when enableCrossfitHardNegativeRefinement=true",
    )
  }
  if (enableJointFeasibilitySolver && !enableExactCompletionSolver) {
    throw new Error(
      "Perfect prototype miner requires enableExactCompletionSolver=true when enableJointFeasibilitySolver=true",
    )
  }
  if (enableJointFeasibilitySolver && !enableCrossfitHardNegativeRefinement) {
    throw new Error(
      "Perfect prototype miner requires enableCrossfitHardNegativeRefinement=true when enableJointFeasibilitySolver=true",
    )
  }
  if (enableJointFeasibilitySolver && supportCases.length < 1) {
    throw new Error(
      "Perfect prototype miner requires supportCases/supportCasesFile when enableJointFeasibilitySolver=true",
    )
  }
  if (
    enableJointFeasibilitySolver &&
    jointFeasibilityRequireHistoricalSupport === true &&
    jointFeasibilityHistoricalSupportCaseIds.length < 1
  ) {
    throw new Error(
      "Perfect prototype miner requires jointFeasibilityHistoricalSupportCaseIds when jointFeasibilityRequireHistoricalSupport=true",
    )
  }
  if (
    enableSubgroupPrepass &&
    (!Number.isFinite(subgroupEarlyDateRetentionRatio) ||
      !Number.isFinite(subgroupEarlyMonthRetentionRatio) ||
      !Number.isFinite(subgroupEarlyFoldRetentionRatio))
  ) {
    throw new Error(
      "Perfect prototype miner requires subgroupEarlyDateRetentionRatio|subgroupEarlyMonthRetentionRatio|subgroupEarlyFoldRetentionRatio when subgroup prepass is enabled",
    )
  }
  if (Number.isInteger(subgroupMinMatchedFolds) && !foldScheme) {
    throw new Error(
      "Perfect prototype miner requires foldScheme=chronological_<N> when subgroupMinMatchedFolds is enabled",
    )
  }
  if (
    (Number.isInteger(supportCaseMaxRootSeeds) ||
      Number.isInteger(supportCaseMaxEffectiveRootSeeds) ||
      Number.isInteger(supportCaseMinRootOverlap) ||
      Number.isInteger(supportCaseMinPrefixOverlap) ||
      Number.isInteger(supportCasePrefixDepthLimit) ||
      Number.isInteger(supportCaseMinDonorRootOverlap) ||
      Number.isInteger(supportCaseMinDonorPrefixOverlap) ||
      Number.isInteger(supportCaseDonorPrefixDepthLimit) ||
      supportCaseFailIfRootScopeUncompressed === true) &&
    supportCases.length < 1
  ) {
    throw new Error(
      "Perfect prototype miner requires supportCases/supportCasesFile when support-case constrained search options are enabled",
    )
  }
  if (
    Number.isInteger(supportCaseMinPrefixOverlap) &&
    supportCaseMinPrefixOverlap > 0 &&
    (!Number.isInteger(supportCasePrefixDepthLimit) || supportCasePrefixDepthLimit < 1)
  ) {
    throw new Error(
      "Perfect prototype miner requires supportCasePrefixDepthLimit>=1 when supportCaseMinPrefixOverlap is enabled",
    )
  }
  if (
    Number.isInteger(supportCaseMinDonorPrefixOverlap) &&
    supportCaseMinDonorPrefixOverlap > 0 &&
    (!Number.isInteger(supportCaseDonorPrefixDepthLimit) || supportCaseDonorPrefixDepthLimit < 1)
  ) {
    throw new Error(
      "Perfect prototype miner requires supportCaseDonorPrefixDepthLimit>=1 when supportCaseMinDonorPrefixOverlap is enabled",
    )
  }
  const topFamilyMaxQuota = clampOptionalInteger(
    options?.topFamilyMaxQuota,
    resolvedDefaultMinerOptions.topFamilyMaxQuota,
    1,
    100000,
  )
  const midFamilyMinQuota = clampOptionalInteger(
    options?.midFamilyMinQuota,
    resolvedDefaultMinerOptions.midFamilyMinQuota,
    1,
    100000,
  )
  const lowFamilyMinQuota = clampOptionalInteger(
    options?.lowFamilyMinQuota,
    resolvedDefaultMinerOptions.lowFamilyMinQuota,
    1,
    100000,
  )
  const diverseBeamMaxPerMonthSignature = clampOptionalInteger(
    options?.diverseBeamMaxPerMonthSignature,
    resolvedDefaultMinerOptions.diverseBeamMaxPerMonthSignature,
    1,
    100000,
  )
  const diverseBeamMaxPerQuarterSignature = clampOptionalInteger(
    options?.diverseBeamMaxPerQuarterSignature,
    resolvedDefaultMinerOptions.diverseBeamMaxPerQuarterSignature,
    1,
    100000,
  )
  const diverseBeamMaxPerAnchorFamily = clampOptionalInteger(
    options?.diverseBeamMaxPerAnchorFamily,
    resolvedDefaultMinerOptions.diverseBeamMaxPerAnchorFamily,
    1,
    100000,
  )
  if (enableDiverseCatalogSelection && enableMdlCatalogSelection) {
    throw new Error(
      "Perfect prototype miner allows only one catalog selector mode at a time: diverse or MDL",
    )
  }
  if (
    enableDiverseSearchOrdering &&
    !Number.isInteger(diverseBeamMaxPerMonthSignature) &&
    !Number.isInteger(diverseBeamMaxPerQuarterSignature) &&
    !Number.isInteger(diverseBeamMaxPerAnchorFamily)
  ) {
    throw new Error(
      [
        "Perfect prototype miner requires at least one diverse-beam bucket limit when enableDiverseSearchOrdering=true.",
        "Set one or more of diverseBeamMaxPerMonthSignature|diverseBeamMaxPerQuarterSignature|diverseBeamMaxPerAnchorFamily.",
      ].join(" "),
    )
  }
  if (
    enablePromotableSearchPrune &&
    !Number.isInteger(promotableMinTrainMatchedDates) &&
    !Number.isInteger(promotableMinTrainMatchedMonths) &&
    !Number.isInteger(promotableMinTrainMatchedFolds) &&
    !Number.isFinite(promotableMaxTop1DateHitShare) &&
    !Number.isFinite(promotableMaxTop3DateHitShare) &&
    !Number.isFinite(promotableMaxTop1FoldHitShare) &&
    !Number.isFinite(promotableMaxTop3FoldHitShare)
  ) {
    throw new Error(
      "Perfect prototype miner requires promotable breadth/share thresholds when enablePromotableSearchPrune=true",
    )
  }
  if (enableYearHitUpperBoundPrune) {
    if (coreYears.length < 1) {
      throw new Error(
        "Perfect prototype miner requires coreYears when enableYearHitUpperBoundPrune=true",
      )
    }
    if (!Number.isInteger(minTrainHitsPerCoreYear) || minTrainHitsPerCoreYear < 1) {
      throw new Error(
        "Perfect prototype miner requires minTrainHitsPerCoreYear>=1 when enableYearHitUpperBoundPrune=true",
      )
    }
    if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
      throw new Error(
        "Perfect prototype miner requires excludedBoundaryYears to not overlap coreYears when enableYearHitUpperBoundPrune=true",
      )
    }
  }
  return {
    ...resolvedDefaultMinerOptions,
    ...options,
    minHitCount: clampInteger(
      options?.minHitCount,
      resolvedDefaultMinerOptions.minHitCount,
      1,
      100000,
    ),
    minTrainPrecision,
    maxTrainHitCount,
    enableTrainMatchedDatePrune,
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedQuarters,
    minTrainMatchedFolds,
    foldScheme,
    maxTop1DateHitShare,
    maxTop3DateHitShare,
    maxTop1FoldHitShare,
    maxTop3FoldHitShare,
    enablePromotableSearchPrune,
    enablePromotableSearchOrdering,
    enableYearHitUpperBoundPrune,
    coreYears,
    excludedBoundaryYears,
    minTrainHitsPerCoreYear,
    promotableMinTrainMatchedDates,
    promotableMinTrainMatchedMonths,
    promotableMinTrainMatchedFolds,
    promotableMaxTop1DateHitShare,
    promotableMaxTop3DateHitShare,
    promotableMaxTop1FoldHitShare,
    promotableMaxTop3FoldHitShare,
    maxRulesPerMatchedDateSignature,
    maxRulesPerMatchedMonthSignature,
    maxRulesPerMatchedQuarterSignature,
    enableLaneStratifiedMining,
    enableFamilyScopedMining,
    familySeedMaxTopBucket,
    familySeedMaxMidBucket,
    familySeedMaxLowBucket,
    midFamilyMinShare,
    lowFamilyMinShare,
    lowFamilySearchMinHitCount,
    lowFamilyMinTrainMatchedDates,
    lowFamilyMinTrainMatchedMonths,
    lowFamilyMinTrainMatchedFolds,
    recentOnlyFamilyIds,
    supportCases,
    supportCasesFile,
    supportFeatureCases: resolvedSupportFeatureCases,
    supportFeatureCasesFile,
    supportCaseMaxRootSeeds,
    supportCaseMaxEffectiveRootSeeds,
    supportCaseMinRootOverlap,
    supportCaseMinPrefixOverlap,
    supportCasePrefixDepthLimit,
    supportCaseMinDonorRootOverlap,
    supportCaseMinDonorPrefixOverlap,
    supportCaseDonorPrefixDepthLimit,
    supportCaseFailIfRootScopeUncompressed:
      supportCaseFailIfRootScopeUncompressed === true,
    enableSubgroupPrepass,
    enableSubgroupStability,
    enableSubgroupDiversity,
    subgroupMinMatchedDates,
    subgroupMinMatchedMonths,
    subgroupMinMatchedFolds,
    subgroupMaxRootSeeds,
    subgroupMaxManifests,
    subgroupMinSelectionFrequency,
    subgroupMinFoldPresenceCount,
    subgroupMinWindowPresenceCount,
    subgroupMaxTokenJaccard,
    subgroupMaxAxisOverlap,
    subgroupMaxDateCoverJaccard,
    subgroupEarlyDateRetentionRatio,
    subgroupEarlyMonthRetentionRatio,
    subgroupEarlyFoldRetentionRatio,
    enableExactCompletionSolver,
    exactCompletionMode,
    exactCompletionMaxCandidates,
    exactCompletionMaxAdditionalTokens,
    enableCrossfitHardNegativeRefinement,
    crossfitHoldoutWindows,
    crossfitMinWindowSupport,
    crossfitHardNegativeWeight,
    enableJointFeasibilitySolver,
    jointFeasibilityMinCrossfitPositiveWindows,
    jointFeasibilityMaxCrossfitNegativeWindows,
    jointFeasibilityRequireHistoricalSupport,
    jointFeasibilityHistoricalSupportCaseIds,
    enableIntervalAtoms,
    enableMacroAtoms,
    enableSupportAnchorAtoms,
    enableSupportManifoldSignature,
    enableSupportMetricFeatures,
    enableAdaptiveThresholdAtoms,
    maxGapTradingDays: resolvedMaxGapTradingDays,
    maxRuleSize: clampInteger(
      options?.maxRuleSize,
      resolvedDefaultMinerOptions.maxRuleSize,
      1,
      6,
    ),
    maxSeedTokens: clampInteger(options?.maxSeedTokens, adaptiveMaxSeedTokens, 8, 4000),
    maxRules: clampInteger(options?.maxRules, adaptiveMaxRules, 1, Number.MAX_SAFE_INTEGER),
    maxSearchStates: clampInteger(
      options?.maxSearchStates,
      resolvedDefaultMinerOptions.maxSearchStates,
      100,
      20000000,
    ),
    maxRejectedRuleSamples: clampInteger(
      options?.maxRejectedRuleSamples,
      resolvedDefaultMinerOptions.maxRejectedRuleSamples,
      10,
      100000,
    ),
    hitCountMode: resolvePerfectPrototypeHitCountMode(
      options?.hitCountMode ?? resolvedDefaultMinerOptions.hitCountMode,
    ),
    hitCountDaySymbolCap: resolvePerfectPrototypeHitCountDaySymbolCap(
      options?.hitCountDaySymbolCap,
      resolvedDefaultMinerOptions.hitCountDaySymbolCap,
    ),
    surfaceName,
    searchMode,
    enableDiverseSearchOrdering,
    diverseBeamMaxPerMonthSignature,
    diverseBeamMaxPerQuarterSignature,
    diverseBeamMaxPerAnchorFamily,
    enableDiverseCatalogSelection,
    enableMdlCatalogSelection,
    diverseCatalogTargetRules: clampOptionalInteger(
      options?.diverseCatalogTargetRules,
      resolvedDefaultMinerOptions.diverseCatalogTargetRules,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    diverseNoveltyWeight: clampNumber(
      options?.diverseNoveltyWeight,
      resolvedDefaultMinerOptions.diverseNoveltyWeight,
      0,
      100,
    ),
    diverseOverlapPenaltyWeight: clampNumber(
      options?.diverseOverlapPenaltyWeight,
      resolvedDefaultMinerOptions.diverseOverlapPenaltyWeight,
      0,
      100,
    ),
    diverseAnchorFamilyPenaltyWeight: clampNumber(
      options?.diverseAnchorFamilyPenaltyWeight,
      resolvedDefaultMinerOptions.diverseAnchorFamilyPenaltyWeight,
      0,
      100,
    ),
    topFamilyMaxQuota,
    midFamilyMinQuota,
    lowFamilyMinQuota,
    mdlDescriptionLengthWeight: clampNumber(
      options?.mdlDescriptionLengthWeight,
      resolvedDefaultMinerOptions.mdlDescriptionLengthWeight,
      0,
      100,
    ),
    mdlOverlapPenaltyWeight: clampNumber(
      options?.mdlOverlapPenaltyWeight,
      resolvedDefaultMinerOptions.mdlOverlapPenaltyWeight,
      0,
      100,
    ),
    tokenizerOptions: {
      ...(options?.tokenizerOptions ?? {}),
      surfaceName,
      includeFeaturePrefixes,
      enableIntervalAtoms,
      enableMacroAtoms,
      enableSupportAnchorAtoms,
      enableSupportManifoldSignature,
      enableSupportMetricFeatures,
      enableAdaptiveThresholdAtoms,
      supportSignatureConfig,
    },
  }
}

export const resolveFamilySpecificBreadthMinimums = ({ cfg, familyId }) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (isPerfectPrototypeLowContinuationFamilyId(normalizedFamilyId)) {
    return {
      minTrainMatchedDates: cfg.lowFamilyMinTrainMatchedDates ?? cfg.minTrainMatchedDates,
      minTrainMatchedMonths: cfg.lowFamilyMinTrainMatchedMonths ?? cfg.minTrainMatchedMonths,
      minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
      minTrainMatchedFolds: cfg.lowFamilyMinTrainMatchedFolds ?? cfg.minTrainMatchedFolds,
    }
  }
  if (isPerfectPrototypeMidContinuationFamilyId(normalizedFamilyId)) {
    return {
      minTrainMatchedDates: cfg.minTrainMatchedDates,
      minTrainMatchedMonths: cfg.minTrainMatchedMonths,
      minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
      minTrainMatchedFolds: cfg.minTrainMatchedFolds,
    }
  }
  return {
    minTrainMatchedDates: cfg.minTrainMatchedDates,
    minTrainMatchedMonths: cfg.minTrainMatchedMonths,
    minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
    minTrainMatchedFolds: cfg.minTrainMatchedFolds,
  }
}

export const resolveFamilySpecificSearchMinHitCount = ({ cfg, familyId }) => {
  const baseMinHitCount = Math.max(1, Number(cfg?.minHitCount ?? 1) || 1)
  if (isPerfectPrototypeLowContinuationFamilyId(familyId)) {
    const lowFamilySearchMinHitCount = Number(cfg?.lowFamilySearchMinHitCount ?? Number.NaN)
    if (Number.isInteger(lowFamilySearchMinHitCount) && lowFamilySearchMinHitCount > 0) {
      return Math.max(1, lowFamilySearchMinHitCount)
    }
  }
  return baseMinHitCount
}

export const enrichSeedEntry = (entry) => {
  const positiveMatchCount = Number(
    entry?.positiveMatchCount ??
      getIndexCollectionLength(entry?.positiveRowIndexes),
  )
  const negativeMatchCount = Number(
    entry?.negativeMatchCount ??
      getIndexCollectionLength(entry?.negativeRowIndexes),
  )
  const precision = safeRate(positiveMatchCount, positiveMatchCount + negativeMatchCount)
  return {
    ...entry,
    positiveMatchCount,
    negativeMatchCount,
    precision,
    separationRatio: positiveMatchCount / (negativeMatchCount + 1),
    separationLift: positiveMatchCount - negativeMatchCount,
  }
}

const enrichRowsForSurface = ({ rows, surfaceName }) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  if (surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE) {
    assertNoPrejumpLeakageRows(sourceRows)
    return enrichPerfectPrototypeRowsWithDecisionContext(sourceRows, {
      referenceRows: sourceRows,
      surfaceName,
      preserveExisting: true,
    })
  }
  return enrichPerfectPrototypeRowsWithContext(sourceRows, {
    referenceRows: sourceRows,
    surfaceName,
    replaceExistingContextualTokens: true,
  })
}

export const compareSeedByPrecision = (left, right) => {
  if (right.precision !== left.precision) return right.precision - left.precision
  if (right.positiveMatchCount !== left.positiveMatchCount) {
    return right.positiveMatchCount - left.positiveMatchCount
  }
  if (left.negativeMatchCount !== right.negativeMatchCount) {
    return left.negativeMatchCount - right.negativeMatchCount
  }
  return String(left.token).localeCompare(String(right.token))
}

export const compareSeedBySeparationRatio = (left, right) => {
  if (right.separationRatio !== left.separationRatio) {
    return right.separationRatio - left.separationRatio
  }
  return compareSeedByPrecision(left, right)
}

export const compareSeedBySeparationLift = (left, right) => {
  if (right.separationLift !== left.separationLift) return right.separationLift - left.separationLift
  return compareSeedByPrecision(left, right)
}

export const compareSeedByPositiveMatchCount = (left, right) => {
  if (right.positiveMatchCount !== left.positiveMatchCount) {
    return right.positiveMatchCount - left.positiveMatchCount
  }
  return compareSeedByPrecision(left, right)
}

export const PERFECT_PROTOTYPE_SEED_RANKING_SPECS = Object.freeze([
  Object.freeze({ key: "precision", compare: compareSeedByPrecision }),
  Object.freeze({ key: "separationRatio", compare: compareSeedBySeparationRatio }),
  Object.freeze({ key: "separationLift", compare: compareSeedBySeparationLift }),
  Object.freeze({ key: "positiveMatchCount", compare: compareSeedByPositiveMatchCount }),
])

export const mergeDiversifiedSeedRankedLists = ({ rankedLists, maxSeedTokens }) => {
  const safeMaxSeedTokens = Math.max(0, Math.floor(Number(maxSeedTokens) || 0))
  if (safeMaxSeedTokens < 1) return []
  const safeRankedLists = (Array.isArray(rankedLists) ? rankedLists : []).map((ranked) =>
    Array.isArray(ranked) ? ranked : [],
  )
  const selected = []
  const seen = new Set()
  const offsets = safeRankedLists.map(() => 0)
  while (selected.length < safeMaxSeedTokens) {
    let madeProgress = false
    for (let rankingIndex = 0; rankingIndex < safeRankedLists.length; rankingIndex += 1) {
      const ranked = safeRankedLists[rankingIndex]
      let cursor = offsets[rankingIndex]
      while (cursor < ranked.length && seen.has(ranked[cursor]?.token)) {
        cursor += 1
      }
      offsets[rankingIndex] = cursor
      if (cursor >= ranked.length) continue
      const entry = ranked[cursor]
      offsets[rankingIndex] += 1
      if (!entry || seen.has(entry.token)) continue
      selected.push(entry)
      seen.add(entry.token)
      madeProgress = true
      if (selected.length >= safeMaxSeedTokens) break
    }
    if (!madeProgress) break
  }
  return selected
}

export const mergeDiversifiedSeedRankedIndexes = ({ rankedIndexes, entries, maxSeedTokens }) => {
  const safeEntries = Array.isArray(entries) ? entries : []
  const safeMaxSeedTokens = Math.max(0, Math.floor(Number(maxSeedTokens) || 0))
  if (safeEntries.length < 1 || safeMaxSeedTokens < 1) return []
  const safeRankedIndexes = (Array.isArray(rankedIndexes) ? rankedIndexes : []).map((ranked) =>
    Array.isArray(ranked) || isTypedNumericArray(ranked) ? ranked : [],
  )
  const selected = []
  const seen = new Set()
  const offsets = safeRankedIndexes.map(() => 0)
  while (selected.length < safeMaxSeedTokens) {
    let madeProgress = false
    for (let rankingIndex = 0; rankingIndex < safeRankedIndexes.length; rankingIndex += 1) {
      const ranked = safeRankedIndexes[rankingIndex]
      let cursor = offsets[rankingIndex]
      while (cursor < ranked.length) {
        const entry = safeEntries[Number(ranked[cursor])]
        if (entry && !seen.has(entry.token)) break
        cursor += 1
      }
      offsets[rankingIndex] = cursor
      if (cursor >= ranked.length) continue
      const entry = safeEntries[Number(ranked[cursor])]
      offsets[rankingIndex] += 1
      if (!entry || seen.has(entry.token)) continue
      selected.push(entry)
      seen.add(entry.token)
      madeProgress = true
      if (selected.length >= safeMaxSeedTokens) break
    }
    if (!madeProgress) break
  }
  return selected
}

const isBetterSeedEntry = (compare, left, right) => compare(left, right) < 0

const siftUpWorstFirst = (heap, index, compare) => {
  let cursor = index
  while (cursor > 0) {
    const parent = Math.floor((cursor - 1) / 2)
    if (!isBetterSeedEntry(compare, heap[parent], heap[cursor])) break
    ;[heap[parent], heap[cursor]] = [heap[cursor], heap[parent]]
    cursor = parent
  }
}

const siftDownWorstFirst = (heap, index, compare) => {
  let cursor = index
  for (;;) {
    const left = cursor * 2 + 1
    const right = left + 1
    let worst = cursor
    if (left < heap.length && isBetterSeedEntry(compare, heap[worst], heap[left])) {
      worst = left
    }
    if (right < heap.length && isBetterSeedEntry(compare, heap[worst], heap[right])) {
      worst = right
    }
    if (worst === cursor) break
    ;[heap[cursor], heap[worst]] = [heap[worst], heap[cursor]]
    cursor = worst
  }
}

const pushBoundedWorstFirstHeap = (heap, entry, limit, compare) => {
  if (limit <= 0) return
  if (heap.length < limit) {
    heap.push(entry)
    siftUpWorstFirst(heap, heap.length - 1, compare)
    return
  }
  if (!heap[0]) return
  if (!isBetterSeedEntry(compare, entry, heap[0])) return
  heap[0] = entry
  siftDownWorstFirst(heap, 0, compare)
}

export const selectSeedEntries = (entries, maxSeedTokens, options = {}) => {
  const safeEntries = Array.isArray(entries) ? entries : []
  const safeMaxSeedTokens = Math.max(0, Math.floor(Number(maxSeedTokens) || 0))
  if (safeEntries.length < 1 || safeMaxSeedTokens < 1) return []
  const enrichedEntries = safeEntries.map((entry) => enrichSeedEntry(entry))
  const baseIndexes = new Uint32Array(enrichedEntries.length)
  for (let index = 0; index < baseIndexes.length; index += 1) baseIndexes[index] = index
  return mergeDiversifiedSeedRankedIndexes({
    entries: enrichedEntries,
    rankedIndexes: PERFECT_PROTOTYPE_SEED_RANKING_SPECS.map((ranking) =>
      Array.from(baseIndexes).sort((leftIndex, rightIndex) =>
        ranking.compare(enrichedEntries[leftIndex], enrichedEntries[rightIndex]),
      ),
    ),
    maxSeedTokens: safeMaxSeedTokens,
  })
}

export const buildNegativeSeparationReport = ({ seedEntries, rejectedRules, rejectionSummary, exploredStates }) => ({
  exploredStates,
  rejectionSummary,
  topSeedEntries: (Array.isArray(seedEntries) ? seedEntries : []).slice(0, 128).map((entry) => ({
    token: entry.token,
    positiveMatchCount: entry.positiveMatchCount,
    negativeMatchCount: entry.negativeMatchCount,
    precision: entry.precision,
    separationRatio: entry.separationRatio,
    separationLift: entry.separationLift,
  })),
  nearMissRules: (Array.isArray(rejectedRules) ? rejectedRules : [])
    .filter((rule) => String(rule?.reason ?? "").trim() === "NEGATIVE_MATCH")
    .slice()
    .sort((left, right) => {
      const leftNegatives = Number(left?.negativeMatchCount ?? 0)
      const rightNegatives = Number(right?.negativeMatchCount ?? 0)
      if (leftNegatives !== rightNegatives) return leftNegatives - rightNegatives
      const leftPositives = Number(left?.positiveMatchCount ?? 0)
      const rightPositives = Number(right?.positiveMatchCount ?? 0)
      if (rightPositives !== leftPositives) return rightPositives - leftPositives
      return String(left?.tokens?.join("|") ?? "").localeCompare(String(right?.tokens?.join("|") ?? ""))
    })
    .slice(0, 128),
})

export const preparePerfectPrototypeMiningRows = ({ rows, tokenizerSpec = null, options = {} }) => {
  const cfg = normalizeMinerOptions(options)
  const prepareRowsStartedAt = process.hrtime.bigint()
  const contextualizedRows = enrichRowsForSurface({
    rows,
    surfaceName: cfg.surfaceName,
  })
  const normalizedRows = []
  for (const row of contextualizedRows) {
    const normalized = normalizePerfectPrototypeRow(row, cfg.tokenizerOptions)
    if (!normalized?.dateKey || !normalized?.symbol || typeof normalized?.outcomeHitTarget !== "boolean") continue
    if (cfg.trainStartDate && normalized.dateKey < cfg.trainStartDate) continue
    if (cfg.trainEndDate && normalized.dateKey > cfg.trainEndDate) continue
    normalizedRows.push(normalized)
  }
  const prepareRowsSec = hrtimeSecondsSince(prepareRowsStartedAt)
  const buildTokenizerSpecStartedAt = process.hrtime.bigint()
  const effectiveTokenizerSpec =
    tokenizerSpec ?? buildPerfectPrototypeTokenizerSpec(normalizedRows, cfg.tokenizerOptions)
  const buildTokenizerSpecSec = tokenizerSpec ? 0 : hrtimeSecondsSince(buildTokenizerSpecStartedAt)
  const tokenizeRowsStartedAt = process.hrtime.bigint()
  const tokenizedRows = new Array(normalizedRows.length)
  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]
    const tokens = tokenizePerfectPrototypeRow(row, effectiveTokenizerSpec)
    tokenizedRows[index] = compactPreparedMiningRow(row, tokens, cfg.surfaceName)
  }
  const tokenizeRowsSec = hrtimeSecondsSince(tokenizeRowsStartedAt)
  return {
    rows: tokenizedRows,
    tokenizerSpec: effectiveTokenizerSpec,
    calendarDateKeys: uniqueSorted(tokenizedRows.map((row) => row.dateKey)),
    phaseTimings: {
      prepareRowsSec,
      buildTokenizerSpecSec,
      tokenizeRowsSec,
    },
  }
}

export const preparePerfectPrototypeMiningSnapshot = ({
  rows,
  tokenizerSpec = null,
  options = {},
}) => {
  const cfg = normalizeMinerOptions(options)
  const prepared = preparePerfectPrototypeMiningRows({ rows, tokenizerSpec, options: cfg })
  const datasetRows = prepared.rows
  const buildTokenStatsStartedAt = process.hrtime.bigint()
  const tokenStats = buildTokenStats({ rows: datasetRows })
  const allPositiveRowIndexes = createOutcomeRowIndexArray(datasetRows, true)
  const allNegativeRowIndexes = createOutcomeRowIndexArray(datasetRows, false)
  const buildTokenStatsSec = hrtimeSecondsSince(buildTokenStatsStartedAt)
  return {
    snapshot: {
      rows: datasetRows,
      tokenizerSpec: prepared.tokenizerSpec,
      calendarDateKeys: prepared.calendarDateKeys,
      tokenStatsEntries: serializeTokenStatsEntries(tokenStats),
      allPositiveRowIndexes,
      allNegativeRowIndexes,
    },
    phaseTimings: {
      ...normalizePreparePhaseTimings(prepared.phaseTimings),
      buildTokenStatsSec,
    },
  }
}

export const minePerfectPrototypesPrepared = ({
  snapshot,
  options = {},
  phaseTimings: preparePhaseTimings = {},
}) => {
  const cfg = normalizeMinerOptions(options)
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Perfect prototype prepared mining requires a snapshot object")
  }
  if (!snapshot?.tokenizerSpec || typeof snapshot.tokenizerSpec !== "object") {
    throw new Error("Perfect prototype prepared mining requires tokenizerSpec")
  }
  if (!Array.isArray(snapshot?.rows)) {
    throw new Error("Perfect prototype prepared mining requires rows")
  }
  const datasetRows = snapshot.rows
  const phaseTimings = {
    ...normalizePreparePhaseTimings(preparePhaseTimings),
    buildRowsetsSec: 0,
    seedSelectionSec: 0,
    searchSec: 0,
    emitSec: 0,
  }
  const rowCount = datasetRows.length
  const calendarDateKeys = uniqueSorted(
    Array.isArray(snapshot?.calendarDateKeys)
      ? snapshot.calendarDateKeys
      : datasetRows.map((row) => row?.dateKey),
  )
  const calendarLookup = buildPerfectPrototypeCalendarLookup(calendarDateKeys)
  const rowCalendarIndexes = new Int32Array(datasetRows.length)
  for (let rowIndex = 0; rowIndex < datasetRows.length; rowIndex += 1) {
    const calendarIndex = calendarLookup.calendarIndexByDateKey.get(datasetRows[rowIndex]?.dateKey)
    rowCalendarIndexes[rowIndex] = Number.isInteger(calendarIndex) ? calendarIndex : -1
  }
  const foldLookup = buildPerfectPrototypeChronologicalFoldLookup({
    calendarDateKeys,
    foldScheme: cfg.foldScheme,
  })
  const calendarFoldKeys = Array.isArray(foldLookup?.foldKeysByCalendarIndex)
    ? foldLookup.foldKeysByCalendarIndex
    : []
  const rowFoldKeys = new Array(datasetRows.length).fill(null)
  if (calendarFoldKeys.length > 0) {
    for (let rowIndex = 0; rowIndex < datasetRows.length; rowIndex += 1) {
      const calendarIndex = Number(rowCalendarIndexes[rowIndex] ?? Number.NaN)
      if (!Number.isInteger(calendarIndex) || calendarIndex < 0 || calendarIndex >= calendarFoldKeys.length) {
        continue
      }
      rowFoldKeys[rowIndex] = calendarFoldKeys[calendarIndex] ?? null
    }
  }
  const computePositiveHitStats = createPerfectPrototypeMatchedDateHitStatsComputer({
    rowCalendarIndexes,
    calendarDateKeys,
    calendarFoldKeys,
  })
  const trainMatchedDatePruneEnabled =
    cfg.enableTrainMatchedDatePrune === true &&
    (Number.isInteger(Number(cfg.minTrainMatchedDates)) ||
      Number.isInteger(Number(cfg.minTrainMatchedMonths)) ||
      Number.isInteger(Number(cfg.minTrainMatchedQuarters)) ||
      Number.isInteger(Number(cfg.minTrainMatchedFolds)))
  const isExactIndexedKernelMode =
    cfg.searchMode === PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE
  if (
    cfg.hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE &&
    !isExactIndexedKernelMode
  ) {
    throw new Error(
      [
        "Perfect prototype day-capped hit counting requires exact_indexed_kernel_v1 discovery.",
        `searchMode=${cfg.searchMode}`,
        `hitCountMode=${cfg.hitCountMode}`,
      ].join(" "),
    )
  }
  if (cfg.enableLaneStratifiedMining === true && !isExactIndexedKernelMode) {
    throw new Error(
      [
        "Perfect prototype lane-stratified mining requires exact_indexed_kernel_v1 discovery.",
        `searchMode=${cfg.searchMode}`,
        `enableLaneStratifiedMining=${cfg.enableLaneStratifiedMining}`,
      ].join(" "),
    )
  }
  const tokenStats = rebuildTokenStatsMapFromEntries(snapshot?.tokenStatsEntries)
  const allPositiveRowIndexes = toUint32Array(snapshot?.allPositiveRowIndexes)
  const allNegativeRowIndexes = toUint32Array(snapshot?.allNegativeRowIndexes)
  let allPositiveRowset = null
  let allNegativeRowset = null
  let emptyIndexedRowset = null
  if (isExactIndexedKernelMode) {
    const buildRowsetsStartedAt = process.hrtime.bigint()
    resetPerfectPrototypeRowsetRuntimeStats()
    buildTokenStatsRowsets({ tokenStats, rowCount })
    allPositiveRowset = createPerfectPrototypeRowset({
      values: allPositiveRowIndexes,
      universeSize: rowCount,
      allowDense: true,
    })
    allNegativeRowset = createPerfectPrototypeRowset({
      values: allNegativeRowIndexes,
      universeSize: rowCount,
      allowDense: true,
    })
    emptyIndexedRowset = createPerfectPrototypeRowset({
      values: EMPTY_UINT32,
      universeSize: rowCount,
      allowDense: true,
    })
    phaseTimings.buildRowsetsSec = hrtimeSecondsSince(buildRowsetsStartedAt)
  }
  const allTokenEntries = Array.from(tokenStats.values())
  const rejectionSummary = {
    surfaceName: cfg.surfaceName,
    searchMode: cfg.searchMode,
    collectionMode: resolvePerfectPrototypeCollectionMode(cfg.minTrainPrecision),
    minTrainPrecision: Number(cfg.minTrainPrecision ?? 1),
    enableTrainMatchedDatePrune: trainMatchedDatePruneEnabled,
    maxTrainHitCount:
      Number.isInteger(Number(cfg.maxTrainHitCount)) && Number(cfg.maxTrainHitCount) > 0
        ? Number(cfg.maxTrainHitCount)
        : null,
    minTrainMatchedDates:
      Number.isInteger(Number(cfg.minTrainMatchedDates)) && Number(cfg.minTrainMatchedDates) > 0
        ? Number(cfg.minTrainMatchedDates)
        : null,
    minTrainMatchedMonths:
      Number.isInteger(Number(cfg.minTrainMatchedMonths)) && Number(cfg.minTrainMatchedMonths) > 0
        ? Number(cfg.minTrainMatchedMonths)
        : null,
    minTrainMatchedQuarters:
      Number.isInteger(Number(cfg.minTrainMatchedQuarters)) && Number(cfg.minTrainMatchedQuarters) > 0
        ? Number(cfg.minTrainMatchedQuarters)
        : null,
    minTrainMatchedFolds:
      Number.isInteger(Number(cfg.minTrainMatchedFolds)) && Number(cfg.minTrainMatchedFolds) > 0
        ? Number(cfg.minTrainMatchedFolds)
        : null,
    foldScheme: String(cfg.foldScheme ?? "").trim() || null,
    maxTop1DateHitShare:
      Number.isFinite(cfg.maxTop1DateHitShare) ? Number(cfg.maxTop1DateHitShare) : null,
    maxTop3DateHitShare:
      Number.isFinite(cfg.maxTop3DateHitShare) ? Number(cfg.maxTop3DateHitShare) : null,
    maxTop1FoldHitShare:
      Number.isFinite(cfg.maxTop1FoldHitShare) ? Number(cfg.maxTop1FoldHitShare) : null,
    maxTop3FoldHitShare:
      Number.isFinite(cfg.maxTop3FoldHitShare) ? Number(cfg.maxTop3FoldHitShare) : null,
    maxRulesPerMatchedDateSignature:
      Number.isInteger(Number(cfg.maxRulesPerMatchedDateSignature)) &&
      Number(cfg.maxRulesPerMatchedDateSignature) > 0
        ? Number(cfg.maxRulesPerMatchedDateSignature)
        : null,
    maxRulesPerMatchedMonthSignature:
      Number.isInteger(Number(cfg.maxRulesPerMatchedMonthSignature)) &&
      Number(cfg.maxRulesPerMatchedMonthSignature) > 0
        ? Number(cfg.maxRulesPerMatchedMonthSignature)
        : null,
    maxRulesPerMatchedQuarterSignature:
      Number.isInteger(Number(cfg.maxRulesPerMatchedQuarterSignature)) &&
      Number(cfg.maxRulesPerMatchedQuarterSignature) > 0
        ? Number(cfg.maxRulesPerMatchedQuarterSignature)
        : null,
    tokenizer: summarizePerfectPrototypeTokenizerSpec(snapshot.tokenizerSpec),
    totalTokenCount: allTokenEntries.length,
    seedBelowMinHitCount: 0,
    searchBelowMinHitCount: 0,
    noMatchChangeCount: 0,
    noNegativeSeparationProgressCount: 0,
    precisionRegressionCount: 0,
    negativeMatchCount: 0,
    precisionBelowMinTrainPrecisionCount: 0,
    aboveMaxTrainHitCountCount: 0,
    belowMinTrainMatchedDatesCount: 0,
    seedBelowMinTrainMatchedDatesCount: 0,
    trainMatchedDatesPrunedStateCount: 0,
    collectionBelowMinTrainMatchedDatesCount: 0,
    belowMinTrainMatchedMonthsCount: 0,
    seedBelowMinTrainMatchedMonthsCount: 0,
    trainMatchedMonthsPrunedStateCount: 0,
    collectionBelowMinTrainMatchedMonthsCount: 0,
    belowMinTrainMatchedQuartersCount: 0,
    seedBelowMinTrainMatchedQuartersCount: 0,
    trainMatchedQuartersPrunedStateCount: 0,
    collectionBelowMinTrainMatchedQuartersCount: 0,
    belowMinTrainMatchedFoldsCount: 0,
    seedBelowMinTrainMatchedFoldsCount: 0,
    trainMatchedFoldsPrunedStateCount: 0,
    collectionBelowMinTrainMatchedFoldsCount: 0,
    top1DateHitShareAboveMaxCount: 0,
    top3DateHitShareAboveMaxCount: 0,
    top1FoldHitShareAboveMaxCount: 0,
    top3FoldHitShareAboveMaxCount: 0,
    yearHitUpperBoundPruneCount: 0,
    seedYearHitUpperBoundPruneCount: 0,
    stateYearHitUpperBoundPruneCount: 0,
    candidateYearHitUpperBoundPruneCount: 0,
    yearHitUpperBoundPruneCountByFamily: {},
    yearHitUpperBoundReasonCounts: {},
    matchedDateSignatureBucketCapCount: 0,
    matchedMonthSignatureBucketCapCount: 0,
    matchedQuarterSignatureBucketCapCount: 0,
    gapViolationCount: 0,
    dominatedBySmallerRuleCount: 0,
    collectedRuleCount: 0,
    truncatedByMaxSearchStates: false,
    catalogSelectionMode:
      cfg.enableMdlCatalogSelection === true
        ? "mdl_selector_v1"
        : cfg.enableDiverseCatalogSelection === true
          ? "diverse_set_v1"
          : "deterministic_topk",
  }
  const rejectedRules = []
  const recordRejectedRule = ({
    reason,
    tokens,
    positiveRowIndexes = [],
    negativeRowIndexes = [],
    positiveMatchCount = null,
    negativeMatchCount = null,
    maxGapTradingDays = null,
    metadata = null,
  }) => {
    if (rejectedRules.length >= cfg.maxRejectedRuleSamples) return
    const resolvedPositiveMatchCount =
      Number.isInteger(Number(positiveMatchCount))
        ? Number(positiveMatchCount)
        : getIndexCollectionLength(positiveRowIndexes)
    const resolvedNegativeMatchCount =
      Number.isInteger(Number(negativeMatchCount))
        ? Number(negativeMatchCount)
        : getIndexCollectionLength(negativeRowIndexes)
    const rejectedRule = {
      reason,
      tokens: uniqueSorted(tokens),
      ruleSize: Array.isArray(tokens) ? tokens.length : 0,
      positiveMatchCount: resolvedPositiveMatchCount,
      negativeMatchCount: resolvedNegativeMatchCount,
      maxGapTradingDays: Number.isFinite(Number(maxGapTradingDays)) ? Number(maxGapTradingDays) : null,
      samplePositiveIds: collectSampleSourceIds({
        rowIndexes: positiveRowIndexes,
        rows: datasetRows,
        limit: 10,
      }),
      sampleNegativeIds: collectSampleSourceIds({
        rowIndexes: negativeRowIndexes,
        rows: datasetRows,
        limit: 10,
      }),
    }
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata).length > 0) {
      rejectedRule.metadata = { ...metadata }
    }
    rejectedRules.push(rejectedRule)
  }
  const recordRejectedRuleFromRowsets = ({
    reason,
    tokens,
    positiveMatchCount = null,
    negativeMatchCount = null,
    positiveRowset = null,
    negativeRowset = null,
    maxGapTradingDays = null,
    metadata = null,
  }) =>
    recordRejectedRule({
      reason,
      tokens,
      positiveMatchCount,
      negativeMatchCount,
      positiveRowIndexes: positiveRowset
        ? materializePerfectPrototypeRowsetValuesDetached(positiveRowset)
        : EMPTY_UINT32,
      negativeRowIndexes: negativeRowset
        ? materializePerfectPrototypeRowsetValuesDetached(negativeRowset)
        : EMPTY_UINT32,
      maxGapTradingDays,
      metadata,
    })

  const recordTrainDateBreadthGuardRejection = ({
    reason,
    tokens,
    positiveMatchCount = null,
    negativeMatchCount = null,
    positiveRowIndexes = EMPTY_UINT32,
    negativeRowIndexes = EMPTY_UINT32,
    positiveRowset = null,
    negativeRowset = null,
  }) => {
    if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
      rejectionSummary.belowMinTrainMatchedDatesCount += 1
      rejectionSummary.collectionBelowMinTrainMatchedDatesCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
      rejectionSummary.belowMinTrainMatchedMonthsCount += 1
      rejectionSummary.collectionBelowMinTrainMatchedMonthsCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
      rejectionSummary.belowMinTrainMatchedQuartersCount += 1
      rejectionSummary.collectionBelowMinTrainMatchedQuartersCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
      rejectionSummary.belowMinTrainMatchedFoldsCount += 1
      rejectionSummary.collectionBelowMinTrainMatchedFoldsCount += 1
    } else if (reason === "TOP1_DATE_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top1DateHitShareAboveMaxCount += 1
    } else if (reason === "TOP3_DATE_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top3DateHitShareAboveMaxCount += 1
    } else if (reason === "TOP1_FOLD_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top1FoldHitShareAboveMaxCount += 1
    } else if (reason === "TOP3_FOLD_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top3FoldHitShareAboveMaxCount += 1
    } else {
      throw new Error(`unsupported train date breadth rejection reason: ${reason}`)
    }
    if (positiveRowset || negativeRowset) {
      recordRejectedRuleFromRowsets({
        reason,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return
    }
    recordRejectedRule({
      reason,
      tokens,
      positiveMatchCount,
      negativeMatchCount,
      positiveRowIndexes,
      negativeRowIndexes,
    })
  }

  const recordSeedTrainMatchedDatePruneRejection = ({
    reason = "BELOW_MIN_TRAIN_MATCHED_DATES",
    tokens,
    positiveMatchCount = null,
    negativeMatchCount = null,
    positiveRowIndexes = EMPTY_UINT32,
    negativeRowIndexes = EMPTY_UINT32,
  }) => {
    if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
      rejectionSummary.belowMinTrainMatchedDatesCount += 1
      rejectionSummary.seedBelowMinTrainMatchedDatesCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
      rejectionSummary.belowMinTrainMatchedMonthsCount += 1
      rejectionSummary.seedBelowMinTrainMatchedMonthsCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
      rejectionSummary.belowMinTrainMatchedQuartersCount += 1
      rejectionSummary.seedBelowMinTrainMatchedQuartersCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
      rejectionSummary.belowMinTrainMatchedFoldsCount += 1
      rejectionSummary.seedBelowMinTrainMatchedFoldsCount += 1
    } else {
      throw new Error(`unsupported seed train breadth prune reason: ${reason}`)
    }
    recordRejectedRule({
      reason:
        reason === "BELOW_MIN_TRAIN_MATCHED_DATES"
          ? "SEED_BELOW_MIN_TRAIN_MATCHED_DATES"
          : reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS"
            ? "SEED_BELOW_MIN_TRAIN_MATCHED_MONTHS"
            : reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS"
              ? "SEED_BELOW_MIN_TRAIN_MATCHED_QUARTERS"
              : "SEED_BELOW_MIN_TRAIN_MATCHED_FOLDS",
      tokens,
      positiveMatchCount,
      negativeMatchCount,
      positiveRowIndexes,
      negativeRowIndexes,
    })
  }

  const recordStateTrainMatchedDatePruneRejection = ({
    reason = "BELOW_MIN_TRAIN_MATCHED_DATES",
    tokens,
    positiveMatchCount = null,
    negativeMatchCount = null,
    positiveRowIndexes = EMPTY_UINT32,
    negativeRowIndexes = EMPTY_UINT32,
  }) => {
    if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
      rejectionSummary.belowMinTrainMatchedDatesCount += 1
      rejectionSummary.trainMatchedDatesPrunedStateCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
      rejectionSummary.belowMinTrainMatchedMonthsCount += 1
      rejectionSummary.trainMatchedMonthsPrunedStateCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
      rejectionSummary.belowMinTrainMatchedQuartersCount += 1
      rejectionSummary.trainMatchedQuartersPrunedStateCount += 1
    } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
      rejectionSummary.belowMinTrainMatchedFoldsCount += 1
      rejectionSummary.trainMatchedFoldsPrunedStateCount += 1
    } else if (reason === "TOP1_DATE_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top1DateHitShareAboveMaxCount += 1
    } else if (reason === "TOP3_DATE_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top3DateHitShareAboveMaxCount += 1
    } else if (reason === "TOP1_FOLD_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top1FoldHitShareAboveMaxCount += 1
    } else if (reason === "TOP3_FOLD_HIT_SHARE_ABOVE_MAX") {
      rejectionSummary.top3FoldHitShareAboveMaxCount += 1
    } else {
      throw new Error(`unsupported state train breadth prune reason: ${reason}`)
    }
    recordRejectedRule({
      reason:
        reason === "BELOW_MIN_TRAIN_MATCHED_DATES"
          ? "STATE_BELOW_MIN_TRAIN_MATCHED_DATES"
          : reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS"
            ? "STATE_BELOW_MIN_TRAIN_MATCHED_MONTHS"
            : reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS"
              ? "STATE_BELOW_MIN_TRAIN_MATCHED_QUARTERS"
              : reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS"
                ? "STATE_BELOW_MIN_TRAIN_MATCHED_FOLDS"
                : reason,
      tokens,
      positiveMatchCount,
      negativeMatchCount,
      positiveRowIndexes,
      negativeRowIndexes,
    })
  }

  const evaluatePositiveHitStatsBreadthGuard = (hitStats) =>
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: {
        matchedDateCount: Number(hitStats?.distinctDateCount ?? hitStats?.matchedDateCount ?? 0),
        matchedMonthCount: Number(hitStats?.matchedMonthCount ?? 0),
        matchedQuarterCount: Number(hitStats?.matchedQuarterCount ?? 0),
        matchedFoldCount: Number(hitStats?.matchedFoldCount ?? 0),
        top1FoldHitShare: Number(hitStats?.top1FoldHitShare ?? 0),
        top3FoldHitShare: Number(hitStats?.top3FoldHitShare ?? 0),
      },
      minTrainMatchedDates: cfg.minTrainMatchedDates,
      minTrainMatchedMonths: cfg.minTrainMatchedMonths,
      minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
      minTrainMatchedFolds: cfg.minTrainMatchedFolds,
      maxTop1DateHitShare: cfg.maxTop1DateHitShare,
      maxTop3DateHitShare: cfg.maxTop3DateHitShare,
      maxTop1FoldHitShare: cfg.maxTop1FoldHitShare,
      maxTop3FoldHitShare: cfg.maxTop3FoldHitShare,
    })

  const evaluatePositiveHitStatsYearGuard = (hitStats) =>
    evaluatePerfectPrototypeYearHitUpperBoundGuard({
      hitDates: Array.isArray(hitStats?.hitDates) ? hitStats.hitDates : [],
      coreYears: cfg.coreYears,
      excludedBoundaryYears: cfg.excludedBoundaryYears,
      minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
    })

  const recordYearHitUpperBoundPruneRejection = ({
    stage = "state",
    tokens,
    positiveMatchCount = null,
    negativeMatchCount = null,
    positiveRowIndexes = EMPTY_UINT32,
    negativeRowIndexes = EMPTY_UINT32,
    positiveRowset = null,
    negativeRowset = null,
    familyId = null,
    yearGuard = null,
  }) => {
    const normalizedStage = String(stage ?? "state").trim().toLowerCase() || "state"
    const resolvedYearGuard =
      yearGuard && typeof yearGuard === "object"
        ? yearGuard
        : evaluatePerfectPrototypeYearHitUpperBoundGuard({
            hitDates: [],
            coreYears: cfg.coreYears,
            excludedBoundaryYears: cfg.excludedBoundaryYears,
            minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
          })
    rejectionSummary.yearHitUpperBoundPruneCount += 1
    if (normalizedStage === "seed") {
      rejectionSummary.seedYearHitUpperBoundPruneCount += 1
    } else if (normalizedStage === "candidate") {
      rejectionSummary.candidateYearHitUpperBoundPruneCount += 1
    } else {
      rejectionSummary.stateYearHitUpperBoundPruneCount += 1
    }
    const normalizedFamilyId = String(familyId ?? "").trim() || "unknown"
    rejectionSummary.yearHitUpperBoundPruneCountByFamily[normalizedFamilyId] =
      Number(rejectionSummary.yearHitUpperBoundPruneCountByFamily[normalizedFamilyId] ?? 0) + 1
    const reason =
      String(resolvedYearGuard.reason ?? PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON).trim() ||
      PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON
    rejectionSummary.yearHitUpperBoundReasonCounts[reason] =
      Number(rejectionSummary.yearHitUpperBoundReasonCounts[reason] ?? 0) + 1
    const metadata = {
      coreYearSatisfiedCount: Number(resolvedYearGuard.coreYearSatisfiedCount ?? 0),
      minCoreYearHitCount: Number(resolvedYearGuard.minCoreYearHitCount ?? 0),
      violatingYears: Array.isArray(resolvedYearGuard.violatingYears)
        ? resolvedYearGuard.violatingYears.slice()
        : [],
      coreYearHitCounts:
        resolvedYearGuard.coreYearHitCounts && typeof resolvedYearGuard.coreYearHitCounts === "object"
          ? { ...resolvedYearGuard.coreYearHitCounts }
          : {},
    }
    if (positiveRowset || negativeRowset) {
      recordRejectedRuleFromRowsets({
        reason: `${normalizedStage.toUpperCase()}_${reason}`,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
        metadata,
      })
      return
    }
    recordRejectedRule({
      reason: `${normalizedStage.toUpperCase()}_${reason}`,
      tokens,
      positiveMatchCount,
      negativeMatchCount,
      positiveRowIndexes,
      negativeRowIndexes,
      metadata,
    })
  }

  const seedSelectionStartedAt = process.hrtime.bigint()
  const seedEntries = selectSeedEntries(
    allTokenEntries
      .filter((entry) => {
        const keep = Number(entry?.positiveMatchCount ?? 0) >= cfg.minHitCount
        if (!keep) {
          rejectionSummary.seedBelowMinHitCount += 1
          recordRejectedRule({
            reason: "SEED_BELOW_MIN_HIT_COUNT",
            tokens: [entry.token],
            positiveMatchCount: entry.positiveMatchCount,
            negativeMatchCount: entry.negativeMatchCount,
          })
        }
        return keep
      })
      .filter((entry) => {
        if (!trainMatchedDatePruneEnabled) return true
        const seedHitStats = computePositiveHitStats({
          rowIndexes: entry?.positiveRowIndexes ?? EMPTY_UINT32,
          hitCountMode: cfg.hitCountMode,
          hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        })
        const breadthGuard = evaluatePerfectPrototypeTrainDateBreadthGuards({
          rule: {
            matchedDateCount: seedHitStats.distinctDateCount,
            matchedMonthCount: seedHitStats.matchedMonthCount,
            matchedQuarterCount: seedHitStats.matchedQuarterCount,
            matchedFoldCount: seedHitStats.matchedFoldCount ?? 0,
          },
          minTrainMatchedDates: cfg.minTrainMatchedDates,
          minTrainMatchedMonths: cfg.minTrainMatchedMonths,
          minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
          minTrainMatchedFolds: cfg.minTrainMatchedFolds,
        })
        const keep = breadthGuard.ok
        if (!keep) {
          recordSeedTrainMatchedDatePruneRejection({
            reason: breadthGuard.reason,
            tokens: [entry.token],
            positiveMatchCount: entry?.positiveMatchCount,
            negativeMatchCount: entry?.negativeMatchCount,
            positiveRowIndexes: entry?.positiveRowIndexes ?? EMPTY_UINT32,
            negativeRowIndexes: entry?.negativeRowIndexes ?? EMPTY_UINT32,
          })
        }
        return keep
      })
      .filter((entry) => {
        if (cfg.enableYearHitUpperBoundPrune !== true) return true
        const seedHitStats = computePositiveHitStats({
          rowIndexes: entry?.positiveRowIndexes ?? EMPTY_UINT32,
          hitCountMode: cfg.hitCountMode,
          hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        })
        const yearGuard = evaluatePositiveHitStatsYearGuard(seedHitStats)
        const keep = yearGuard.ok
        if (!keep) {
          recordYearHitUpperBoundPruneRejection({
            stage: "seed",
            tokens: [entry.token],
            familyId: inferPerfectPrototypeRuleFamilyId({ tokens: [entry.token] }),
            positiveMatchCount: entry?.positiveMatchCount,
            negativeMatchCount: entry?.negativeMatchCount,
            positiveRowIndexes: entry?.positiveRowIndexes ?? EMPTY_UINT32,
            negativeRowIndexes: entry?.negativeRowIndexes ?? EMPTY_UINT32,
            yearGuard,
          })
        }
        return keep
      }),
    cfg.maxSeedTokens,
    cfg,
  )
  phaseTimings.seedSelectionSec = hrtimeSecondsSince(seedSelectionStartedAt)

  const collectedByMatchSignature = new Map()
  let collectedRuleCount = 0
  let exploredStates = 0

  const maybeCollectRule = ({
    tokens,
    positiveMatchCount,
    negativeMatchCount,
    positiveRowIndexes,
    negativeRowIndexes,
  }) => {
    if (positiveMatchCount < cfg.minHitCount) {
      rejectionSummary.searchBelowMinHitCount += 1
      recordRejectedRule({
        reason: "SEARCH_BELOW_MIN_HIT_COUNT",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (getIndexCollectionLength(positiveRowIndexes) < 1) {
      throw new Error("Perfect prototype exact rule collection requires positive row indexes")
    }
    const resolvedNegativeRowIndexes =
      Array.isArray(negativeRowIndexes) || isTypedNumericArray(negativeRowIndexes)
        ? negativeRowIndexes
        : EMPTY_UINT32
    const ruleCore = createPerfectPrototypeRuleCore({
      tokens,
      familyId: inferPerfectPrototypeRuleFamilyId({ tokens }),
      matchRowIndexes: mergeSortedIndexCollections(positiveRowIndexes, resolvedNegativeRowIndexes),
      positiveMatchRowIndexes: positiveRowIndexes,
      negativeMatchRowIndexes: resolvedNegativeRowIndexes,
      rows: datasetRows,
      calendarDateKeys,
      calendarIndexByDateKey: calendarLookup.calendarIndexByDateKey,
      rowCalendarIndexes,
      rowFoldKeys,
      hitCountMode: cfg.hitCountMode,
      hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
    })
    if (cfg.enableYearHitUpperBoundPrune === true) {
      const yearGuard = evaluatePositiveHitStatsYearGuard(
        computePositiveHitStats({
          rowIndexes: positiveRowIndexes,
          hitCountMode: cfg.hitCountMode,
          hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        }),
      )
      if (!yearGuard.ok) {
        recordYearHitUpperBoundPruneRejection({
          stage: "candidate",
          tokens,
          familyId: ruleCore.familyId,
          positiveMatchCount,
          negativeMatchCount,
          positiveRowIndexes,
          negativeRowIndexes: resolvedNegativeRowIndexes,
          yearGuard,
        })
        return { canDescendPastZeroNegative: false }
      }
    }
    const exactOnlyCollection = Number(cfg.minTrainPrecision) >= 1
    const familyPurity = evaluatePerfectPrototypeRuleFamilyPurity({
      familyId: ruleCore.familyId,
      tokens: ruleCore.tokens,
      stats: ruleCore,
      midMinShare: cfg.midFamilyMinShare,
      lowMinShare: cfg.lowFamilyMinShare,
    })
    if (!familyPurity.ok) {
      rejectionSummary.familyPurityRejectCount = Number(rejectionSummary.familyPurityRejectCount ?? 0) + 1
      rejectionSummary.familyPurityRejectCountByReason = {
        ...(rejectionSummary.familyPurityRejectCountByReason ?? {}),
        [familyPurity.reason]:
          Number(rejectionSummary.familyPurityRejectCountByReason?.[familyPurity.reason] ?? 0) + 1,
      }
      recordRejectedRule({
        reason: familyPurity.reason,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (exactOnlyCollection && negativeMatchCount > 0) {
      rejectionSummary.negativeMatchCount += 1
      recordRejectedRule({
        reason: "NEGATIVE_MATCH",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (Number(ruleCore.precision ?? 0) < cfg.minTrainPrecision) {
      rejectionSummary.precisionBelowMinTrainPrecisionCount += 1
      recordRejectedRule({
        reason: "TRAIN_PRECISION_BELOW_THRESHOLD",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
      })
      return { canDescendPastZeroNegative: false }
    }
    const familyBreadthMinimums = resolveFamilySpecificBreadthMinimums({
      cfg,
      familyId: ruleCore.familyId,
    })
    const dateBreadthGuard = evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: ruleCore,
      minTrainMatchedDates: familyBreadthMinimums.minTrainMatchedDates,
      minTrainMatchedMonths: familyBreadthMinimums.minTrainMatchedMonths,
      minTrainMatchedQuarters: familyBreadthMinimums.minTrainMatchedQuarters,
      minTrainMatchedFolds: familyBreadthMinimums.minTrainMatchedFolds,
      maxTop1DateHitShare: cfg.maxTop1DateHitShare,
      maxTop3DateHitShare: cfg.maxTop3DateHitShare,
      maxTop1FoldHitShare: cfg.maxTop1FoldHitShare,
      maxTop3FoldHitShare: cfg.maxTop3FoldHitShare,
    })
    if (!dateBreadthGuard.ok) {
      recordTrainDateBreadthGuardRejection({
        reason: dateBreadthGuard.reason,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
      })
      return { canDescendPastZeroNegative: false }
    }
    const exceedsMaxTrainHitCount =
      Number.isInteger(Number(cfg.maxTrainHitCount)) &&
      Number(cfg.maxTrainHitCount) > 0 &&
      Number(ruleCore.trainHitCount) > Number(cfg.maxTrainHitCount)
    if (exceedsMaxTrainHitCount) {
      rejectionSummary.aboveMaxTrainHitCountCount += 1
      recordRejectedRule({
        reason: "TRAIN_HIT_COUNT_ABOVE_MAX",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
      })
    }
    if (Number(ruleCore.maxGapTradingDays) > cfg.maxGapTradingDays) {
      rejectionSummary.gapViolationCount += 1
      recordRejectedRule({
        reason: "MAX_GAP_VIOLATION",
        tokens,
        positiveRowIndexes,
        negativeRowIndexes: resolvedNegativeRowIndexes,
        maxGapTradingDays: ruleCore.maxGapTradingDays,
      })
      return { canDescendPastZeroNegative: true }
    }
    if (exceedsMaxTrainHitCount) {
      return { canDescendPastZeroNegative: true }
    }
    const matchSignature = buildIndexCollectionHash(ruleCore.matchRowIndexes)
    const bucket = collectedByMatchSignature.get(matchSignature) ?? []
    const previousIndex = bucket.findIndex((candidate) =>
      compareIndexCollectionsExact(candidate?.matchRowIndexes, ruleCore.matchRowIndexes),
    )
    const previous = previousIndex >= 0 ? bucket[previousIndex] : null
    const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(previous, ruleCore)
    if (!previous) {
      bucket.push(ruleCore)
      collectedByMatchSignature.set(matchSignature, bucket)
      collectedRuleCount += 1
      return { canDescendPastZeroNegative: false }
    }
    if (winner === ruleCore) {
      bucket[previousIndex] = ruleCore
      return { canDescendPastZeroNegative: false }
    }
    rejectionSummary.dominatedBySmallerRuleCount += 1
    recordRejectedRule({
      reason: "DOMINATED_BY_SMALLER_RULE",
      tokens,
      positiveRowIndexes,
      negativeRowIndexes: resolvedNegativeRowIndexes,
      maxGapTradingDays: ruleCore.maxGapTradingDays,
    })
    return { canDescendPastZeroNegative: false }
  }

  const maybeCollectRuleFromRowsets = ({
    tokens,
    positiveMatchCount,
    negativeMatchCount,
    positiveRowset,
    negativeRowset,
  }) => {
    if (positiveMatchCount < cfg.minHitCount) {
      rejectionSummary.searchBelowMinHitCount += 1
      recordRejectedRuleFromRowsets({
        reason: "SEARCH_BELOW_MIN_HIT_COUNT",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (!positiveRowset || getPerfectPrototypeRowsetCount(positiveRowset) < 1) {
      throw new Error("Perfect prototype exact indexed rule collection requires positive rowset")
    }
    const positiveRowIndexes = materializePerfectPrototypeRowsetValuesDetached(positiveRowset)
    const negativeRowIndexes = negativeRowset
      ? materializePerfectPrototypeRowsetValuesDetached(negativeRowset)
      : EMPTY_UINT32
    const ruleCore = createPerfectPrototypeRuleCore({
      tokens,
      familyId: inferPerfectPrototypeRuleFamilyId({ tokens }),
      matchRowIndexes: mergeSortedIndexCollections(positiveRowIndexes, negativeRowIndexes),
      positiveMatchRowIndexes: positiveRowIndexes,
      negativeMatchRowIndexes: negativeRowIndexes,
      rows: datasetRows,
      calendarDateKeys,
      calendarIndexByDateKey: calendarLookup.calendarIndexByDateKey,
      rowCalendarIndexes,
      rowFoldKeys,
      hitCountMode: cfg.hitCountMode,
      hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
    })
    if (cfg.enableYearHitUpperBoundPrune === true) {
      const yearGuard = evaluatePositiveHitStatsYearGuard(
        computePositiveHitStats({
          rowIndexes: positiveRowIndexes,
          hitCountMode: cfg.hitCountMode,
          hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        }),
      )
      if (!yearGuard.ok) {
        recordYearHitUpperBoundPruneRejection({
          stage: "candidate",
          tokens,
          familyId: ruleCore.familyId,
          positiveMatchCount,
          negativeMatchCount,
          positiveRowset,
          negativeRowset,
          yearGuard,
        })
        return { canDescendPastZeroNegative: false }
      }
    }
    const exactOnlyCollection = Number(cfg.minTrainPrecision) >= 1
    const familyPurity = evaluatePerfectPrototypeRuleFamilyPurity({
      familyId: ruleCore.familyId,
      tokens: ruleCore.tokens,
      stats: ruleCore,
      midMinShare: cfg.midFamilyMinShare,
      lowMinShare: cfg.lowFamilyMinShare,
    })
    if (!familyPurity.ok) {
      rejectionSummary.familyPurityRejectCount = Number(rejectionSummary.familyPurityRejectCount ?? 0) + 1
      rejectionSummary.familyPurityRejectCountByReason = {
        ...(rejectionSummary.familyPurityRejectCountByReason ?? {}),
        [familyPurity.reason]:
          Number(rejectionSummary.familyPurityRejectCountByReason?.[familyPurity.reason] ?? 0) + 1,
      }
      recordRejectedRuleFromRowsets({
        reason: familyPurity.reason,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (exactOnlyCollection && negativeMatchCount > 0) {
      rejectionSummary.negativeMatchCount += 1
      recordRejectedRuleFromRowsets({
        reason: "NEGATIVE_MATCH",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return { canDescendPastZeroNegative: false }
    }
    if (Number(ruleCore.precision ?? 0) < cfg.minTrainPrecision) {
      rejectionSummary.precisionBelowMinTrainPrecisionCount += 1
      recordRejectedRuleFromRowsets({
        reason: "TRAIN_PRECISION_BELOW_THRESHOLD",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return { canDescendPastZeroNegative: false }
    }
    const familyBreadthMinimums = resolveFamilySpecificBreadthMinimums({
      cfg,
      familyId: ruleCore.familyId,
    })
    const dateBreadthGuard = evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: ruleCore,
      minTrainMatchedDates: familyBreadthMinimums.minTrainMatchedDates,
      minTrainMatchedMonths: familyBreadthMinimums.minTrainMatchedMonths,
      minTrainMatchedQuarters: familyBreadthMinimums.minTrainMatchedQuarters,
      minTrainMatchedFolds: familyBreadthMinimums.minTrainMatchedFolds,
      maxTop1DateHitShare: cfg.maxTop1DateHitShare,
      maxTop3DateHitShare: cfg.maxTop3DateHitShare,
      maxTop1FoldHitShare: cfg.maxTop1FoldHitShare,
      maxTop3FoldHitShare: cfg.maxTop3FoldHitShare,
    })
    if (!dateBreadthGuard.ok) {
      recordTrainDateBreadthGuardRejection({
        reason: dateBreadthGuard.reason,
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
      return { canDescendPastZeroNegative: false }
    }
    const exceedsMaxTrainHitCount =
      Number.isInteger(Number(cfg.maxTrainHitCount)) &&
      Number(cfg.maxTrainHitCount) > 0 &&
      Number(ruleCore.trainHitCount) > Number(cfg.maxTrainHitCount)
    if (exceedsMaxTrainHitCount) {
      rejectionSummary.aboveMaxTrainHitCountCount += 1
      recordRejectedRuleFromRowsets({
        reason: "TRAIN_HIT_COUNT_ABOVE_MAX",
        tokens,
        positiveMatchCount,
        negativeMatchCount,
        positiveRowset,
        negativeRowset,
      })
    }
    if (Number(ruleCore.maxGapTradingDays) > cfg.maxGapTradingDays) {
      rejectionSummary.gapViolationCount += 1
      recordRejectedRule({
        reason: "MAX_GAP_VIOLATION",
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        maxGapTradingDays: ruleCore.maxGapTradingDays,
      })
      return { canDescendPastZeroNegative: true }
    }
    if (exceedsMaxTrainHitCount) {
      return { canDescendPastZeroNegative: true }
    }
    const matchSignature = buildIndexCollectionHash(ruleCore.matchRowIndexes)
    const bucket = collectedByMatchSignature.get(matchSignature) ?? []
    const previousIndex = bucket.findIndex((candidate) =>
      compareIndexCollectionsExact(candidate?.matchRowIndexes, ruleCore.matchRowIndexes),
    )
    const previous = previousIndex >= 0 ? bucket[previousIndex] : null
    const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(previous, ruleCore)
    if (!previous) {
      bucket.push(ruleCore)
      collectedByMatchSignature.set(matchSignature, bucket)
      collectedRuleCount += 1
      return { canDescendPastZeroNegative: false }
    }
    if (winner === ruleCore) {
      bucket[previousIndex] = ruleCore
      return { canDescendPastZeroNegative: false }
    }
    rejectionSummary.dominatedBySmallerRuleCount += 1
    recordRejectedRule({
      reason: "DOMINATED_BY_SMALLER_RULE",
      tokens,
      positiveRowIndexes,
      negativeRowIndexes,
      maxGapTradingDays: ruleCore.maxGapTradingDays,
    })
    return { canDescendPastZeroNegative: false }
  }

  const tokenStack = []

  const searchLegacy = ({
    startAt,
    positiveRowIndexes,
    negativeRowIndexes,
    positiveHitStats = null,
  }) => {
    if (exploredStates >= cfg.maxSearchStates) {
      rejectionSummary.truncatedByMaxSearchStates = true
      return
    }
    const currentPositiveCount = getIndexCollectionLength(positiveRowIndexes)
    const currentNegativeCount = getIndexCollectionLength(negativeRowIndexes)
    const currentPositiveResolvedHitStats =
      positiveHitStats && typeof positiveHitStats === "object"
        ? positiveHitStats
        : trainMatchedDatePruneEnabled || cfg.enableYearHitUpperBoundPrune === true
          ? computePositiveHitStats({
              rowIndexes: positiveRowIndexes,
              hitCountMode: cfg.hitCountMode,
              hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
            })
          : null
    if (
      trainMatchedDatePruneEnabled &&
      tokenStack.length > 0 &&
      !evaluatePositiveHitStatsBreadthGuard(currentPositiveResolvedHitStats).ok
    ) {
      const breadthGuard = evaluatePositiveHitStatsBreadthGuard(currentPositiveResolvedHitStats)
      recordStateTrainMatchedDatePruneRejection({
        reason: breadthGuard.reason,
        tokens: tokenStack,
        positiveMatchCount: currentPositiveCount,
        negativeMatchCount: currentNegativeCount,
        positiveRowIndexes,
        negativeRowIndexes,
      })
      return
    }
    if (
      cfg.enableYearHitUpperBoundPrune === true &&
      tokenStack.length > 0
    ) {
      const yearGuard = evaluatePositiveHitStatsYearGuard(currentPositiveResolvedHitStats)
      if (!yearGuard.ok) {
        recordYearHitUpperBoundPruneRejection({
          stage: "state",
          tokens: tokenStack,
          familyId: inferPerfectPrototypeRuleFamilyId({ tokens: tokenStack }),
          positiveMatchCount: currentPositiveCount,
          negativeMatchCount: currentNegativeCount,
          positiveRowIndexes,
          negativeRowIndexes,
          yearGuard,
        })
        return
      }
    }
    for (let tokenIndex = startAt; tokenIndex < seedEntries.length; tokenIndex += 1) {
      const entry = seedEntries[tokenIndex]
      const isRoot = tokenStack.length < 1
      tokenStack.push(entry.token)
      let nextPositiveRowIndexes = null
      let nextNegativeRowIndexes = null
      let nextPositiveResolvedHitStats = null
      try {
        const nextPositiveMatchCount = isRoot
          ? Number(entry?.positiveMatchCount ?? 0)
          : countIntersectSortedIntegers(positiveRowIndexes, entry.positiveRowIndexes, cfg.minHitCount)
        if (nextPositiveMatchCount < cfg.minHitCount) {
          rejectionSummary.searchBelowMinHitCount += 1
          recordRejectedRule({
            reason: "SEARCH_BELOW_MIN_HIT_COUNT",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: null,
          })
          continue
        }
        const nextNegativeMatchCount =
          currentNegativeCount < 1
            ? 0
            : isRoot
              ? Number(entry?.negativeMatchCount ?? 0)
              : countIntersectSortedIntegers(negativeRowIndexes, entry.negativeRowIndexes)
        if (
          nextPositiveMatchCount === currentPositiveCount &&
          nextNegativeMatchCount === currentNegativeCount
        ) {
          rejectionSummary.noMatchChangeCount += 1
          recordRejectedRule({
            reason: "NO_MATCH_CHANGE",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: nextNegativeMatchCount,
          })
          continue
        }
        if (tokenStack.length > 1 && currentNegativeCount > 0 && nextNegativeMatchCount >= currentNegativeCount) {
          rejectionSummary.noNegativeSeparationProgressCount += 1
          recordRejectedRule({
            reason: "NO_NEGATIVE_SEPARATION_PROGRESS",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: nextNegativeMatchCount,
          })
          continue
        }
        exploredStates += 1
        const canAttemptZeroNegativeDescend =
          tokenStack.length < cfg.maxRuleSize &&
          Number.isInteger(Number(cfg.maxTrainHitCount)) &&
          Number(cfg.maxTrainHitCount) > 0
        const needsRelaxedPrecisionRowIndexes = Number(cfg.minTrainPrecision) < 1
        const shouldDescendByNegative = tokenStack.length < cfg.maxRuleSize && nextNegativeMatchCount > 0
        const shouldSampleRejectedRule = rejectedRules.length < cfg.maxRejectedRuleSamples
        const needsPositiveRowIndexes =
          trainMatchedDatePruneEnabled ||
          nextNegativeMatchCount === 0 ||
          shouldDescendByNegative ||
          canAttemptZeroNegativeDescend ||
          needsRelaxedPrecisionRowIndexes ||
          shouldSampleRejectedRule
        const needsNegativeRowIndexes =
          (shouldDescendByNegative ||
            needsRelaxedPrecisionRowIndexes ||
            (shouldSampleRejectedRule && nextNegativeMatchCount > 0)) &&
          nextNegativeMatchCount > 0
        if (needsPositiveRowIndexes) {
          nextPositiveRowIndexes = isRoot
            ? entry.positiveRowIndexes
            : intersectSortedIntegers(positiveRowIndexes, entry.positiveRowIndexes)
        }
        if (trainMatchedDatePruneEnabled || cfg.enableYearHitUpperBoundPrune === true) {
          if (!nextPositiveRowIndexes) {
            nextPositiveRowIndexes = isRoot
              ? entry.positiveRowIndexes
              : intersectSortedIntegers(positiveRowIndexes, entry.positiveRowIndexes)
          }
          nextPositiveResolvedHitStats = computePositiveHitStats({
            rowIndexes: nextPositiveRowIndexes,
            hitCountMode: cfg.hitCountMode,
            hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
          })
          if (trainMatchedDatePruneEnabled) {
            const breadthGuard = evaluatePositiveHitStatsBreadthGuard(nextPositiveResolvedHitStats)
            if (!breadthGuard.ok) {
              recordStateTrainMatchedDatePruneRejection({
                reason: breadthGuard.reason,
                tokens: tokenStack,
                positiveMatchCount: nextPositiveMatchCount,
                negativeMatchCount: nextNegativeMatchCount,
                positiveRowIndexes: nextPositiveRowIndexes,
                negativeRowIndexes: nextNegativeRowIndexes ?? EMPTY_UINT32,
              })
              continue
            }
          }
        }
        if (cfg.enableYearHitUpperBoundPrune === true) {
          const yearGuard = evaluatePositiveHitStatsYearGuard(nextPositiveResolvedHitStats)
          if (!yearGuard.ok) {
            recordYearHitUpperBoundPruneRejection({
              stage: "candidate",
              tokens: tokenStack,
              familyId: inferPerfectPrototypeRuleFamilyId({ tokens: tokenStack }),
              positiveMatchCount: nextPositiveMatchCount,
              negativeMatchCount: nextNegativeMatchCount,
              positiveRowIndexes: nextPositiveRowIndexes ?? EMPTY_UINT32,
              negativeRowIndexes: nextNegativeRowIndexes ?? EMPTY_UINT32,
              yearGuard,
            })
            continue
          }
        }
        if (needsNegativeRowIndexes && nextNegativeMatchCount > 0) {
          nextNegativeRowIndexes = isRoot
            ? entry.negativeRowIndexes
            : intersectSortedIntegers(negativeRowIndexes, entry.negativeRowIndexes)
        }
        const collectionOutcome = maybeCollectRule({
          tokens: tokenStack,
          positiveMatchCount: nextPositiveMatchCount,
          negativeMatchCount: nextNegativeMatchCount,
          positiveRowIndexes: nextPositiveRowIndexes,
          negativeRowIndexes: nextNegativeRowIndexes,
        })
        const shouldDescend =
          tokenStack.length < cfg.maxRuleSize &&
          (nextNegativeMatchCount > 0 || Boolean(collectionOutcome?.canDescendPastZeroNegative))
        if (shouldDescend && nextNegativeMatchCount === 0 && !nextNegativeRowIndexes) {
          nextNegativeRowIndexes = EMPTY_UINT32
        }
        if (!shouldDescend || !nextPositiveRowIndexes || !nextNegativeRowIndexes) continue
        searchLegacy({
          startAt: tokenIndex + 1,
          positiveRowIndexes: nextPositiveRowIndexes,
          negativeRowIndexes: nextNegativeRowIndexes,
          positiveHitStats: nextPositiveResolvedHitStats,
        })
        if (exploredStates >= cfg.maxSearchStates) {
          rejectionSummary.truncatedByMaxSearchStates = true
          return
        }
      } finally {
        tokenStack.pop()
      }
    }
  }

  const searchIndexed = ({ startAt, positiveRowset, negativeRowset, positiveHitStats = null }) => {
    if (exploredStates >= cfg.maxSearchStates) {
      rejectionSummary.truncatedByMaxSearchStates = true
      return
    }
    const currentPositiveCount = getPerfectPrototypeRowsetCount(positiveRowset)
    const currentNegativeCount = getPerfectPrototypeRowsetCount(negativeRowset)
    const currentPositiveResolvedHitStats =
      positiveHitStats && typeof positiveHitStats === "object"
        ? positiveHitStats
        : trainMatchedDatePruneEnabled || cfg.enableYearHitUpperBoundPrune === true
          ? computePositiveHitStats({
              rowIndexes: materializePerfectPrototypeRowsetValuesDetached(positiveRowset),
              hitCountMode: cfg.hitCountMode,
              hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
            })
          : null
    if (
      trainMatchedDatePruneEnabled &&
      tokenStack.length > 0 &&
      !evaluatePositiveHitStatsBreadthGuard(currentPositiveResolvedHitStats).ok
    ) {
      const breadthGuard = evaluatePositiveHitStatsBreadthGuard(currentPositiveResolvedHitStats)
      recordStateTrainMatchedDatePruneRejection({
        reason: breadthGuard.reason,
        tokens: tokenStack,
        positiveMatchCount: currentPositiveCount,
        negativeMatchCount: currentNegativeCount,
      })
      return
    }
    if (
      cfg.enableYearHitUpperBoundPrune === true &&
      tokenStack.length > 0
    ) {
      const yearGuard = evaluatePositiveHitStatsYearGuard(currentPositiveResolvedHitStats)
      if (!yearGuard.ok) {
        recordYearHitUpperBoundPruneRejection({
          stage: "state",
          tokens: tokenStack,
          familyId: inferPerfectPrototypeRuleFamilyId({ tokens: tokenStack }),
          positiveMatchCount: currentPositiveCount,
          negativeMatchCount: currentNegativeCount,
          positiveRowset,
          negativeRowset,
          yearGuard,
        })
        return
      }
    }
    for (let tokenIndex = startAt; tokenIndex < seedEntries.length; tokenIndex += 1) {
      const entry = seedEntries[tokenIndex]
      const isRoot = tokenStack.length < 1
      tokenStack.push(entry.token)
      let nextPositiveRowset = null
      let nextNegativeRowset = null
      let nextPositiveResolvedHitStats = null
      try {
        const nextPositiveMatchCount = isRoot
          ? Number(entry?.positiveMatchCount ?? 0)
          : (() => {
              const preparedPositive = intersectPerfectPrototypeRowsetsPrepared({
                leftRowset: positiveRowset,
                rightRowset: entry.positiveRowset,
                universeSize: rowCount,
                allowDense: true,
                resultOwnership: "borrowed",
              })
              nextPositiveRowset = preparedPositive.rowset
              return Number(preparedPositive.count ?? getPerfectPrototypeRowsetCount(preparedPositive.rowset))
            })()
        if (nextPositiveMatchCount < cfg.minHitCount) {
          rejectionSummary.searchBelowMinHitCount += 1
          recordRejectedRule({
            reason: "SEARCH_BELOW_MIN_HIT_COUNT",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: null,
          })
          continue
        }
        const nextNegativeMatchCount =
          currentNegativeCount < 1
            ? 0
            : isRoot
              ? Number(entry?.negativeMatchCount ?? 0)
              : countIntersectPerfectPrototypeRowsetsStopAt(
                  negativeRowset,
                  entry.negativeRowset,
                )
        if (
          nextPositiveMatchCount === currentPositiveCount &&
          nextNegativeMatchCount === currentNegativeCount
        ) {
          rejectionSummary.noMatchChangeCount += 1
          recordRejectedRule({
            reason: "NO_MATCH_CHANGE",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: nextNegativeMatchCount,
          })
          continue
        }
        if (tokenStack.length > 1 && currentNegativeCount > 0 && nextNegativeMatchCount >= currentNegativeCount) {
          rejectionSummary.noNegativeSeparationProgressCount += 1
          recordRejectedRule({
            reason: "NO_NEGATIVE_SEPARATION_PROGRESS",
            tokens: tokenStack,
            positiveMatchCount: nextPositiveMatchCount,
            negativeMatchCount: nextNegativeMatchCount,
          })
          continue
        }
        exploredStates += 1
        const canAttemptZeroNegativeDescend =
          tokenStack.length < cfg.maxRuleSize &&
          Number.isInteger(Number(cfg.maxTrainHitCount)) &&
          Number(cfg.maxTrainHitCount) > 0
        const needsRelaxedPrecisionRowsets = Number(cfg.minTrainPrecision) < 1
        const shouldDescendByNegative = tokenStack.length < cfg.maxRuleSize && nextNegativeMatchCount > 0
        const shouldSampleRejectedRule = rejectedRules.length < cfg.maxRejectedRuleSamples
        const needsPositiveRowset =
          trainMatchedDatePruneEnabled ||
          nextNegativeMatchCount === 0 ||
          shouldDescendByNegative ||
          canAttemptZeroNegativeDescend ||
          needsRelaxedPrecisionRowsets ||
          shouldSampleRejectedRule
        const needsNegativeRowset =
          (shouldDescendByNegative ||
            needsRelaxedPrecisionRowsets ||
            (shouldSampleRejectedRule && nextNegativeMatchCount > 0)) &&
          nextNegativeMatchCount > 0
        if (needsPositiveRowset && isRoot) {
          nextPositiveRowset = entry.positiveRowset
        }
        if (trainMatchedDatePruneEnabled || cfg.enableYearHitUpperBoundPrune === true) {
          if (!nextPositiveRowset) {
            nextPositiveRowset = isRoot
              ? entry.positiveRowset
              : intersectPerfectPrototypeRowsetsPrepared({
                  leftRowset: positiveRowset,
                  rightRowset: entry.positiveRowset,
                  universeSize: rowCount,
                  allowDense: true,
                  resultOwnership: "borrowed",
                }).rowset
          }
          nextPositiveResolvedHitStats = computePositiveHitStats({
            rowIndexes: materializePerfectPrototypeRowsetValuesDetached(nextPositiveRowset),
            hitCountMode: cfg.hitCountMode,
            hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
          })
          if (trainMatchedDatePruneEnabled) {
            const breadthGuard = evaluatePositiveHitStatsBreadthGuard(nextPositiveResolvedHitStats)
            if (!breadthGuard.ok) {
              recordStateTrainMatchedDatePruneRejection({
                reason: breadthGuard.reason,
                tokens: tokenStack,
                positiveMatchCount: nextPositiveMatchCount,
                negativeMatchCount: nextNegativeMatchCount,
              })
              releasePerfectPrototypeRowsetIfBorrowed(nextPositiveRowset)
              nextPositiveRowset = null
              continue
            }
          }
        }
        if (cfg.enableYearHitUpperBoundPrune === true) {
          const yearGuard = evaluatePositiveHitStatsYearGuard(nextPositiveResolvedHitStats)
          if (!yearGuard.ok) {
            recordYearHitUpperBoundPruneRejection({
              stage: "candidate",
              tokens: tokenStack,
              familyId: inferPerfectPrototypeRuleFamilyId({ tokens: tokenStack }),
              positiveMatchCount: nextPositiveMatchCount,
              negativeMatchCount: nextNegativeMatchCount,
              positiveRowset: nextPositiveRowset,
              negativeRowset: nextNegativeRowset,
              yearGuard,
            })
            releasePerfectPrototypeRowsetIfBorrowed(nextPositiveRowset)
            nextPositiveRowset = null
            continue
          }
        }
        if (needsNegativeRowset && nextNegativeMatchCount > 0) {
          if (isRoot) {
            nextNegativeRowset = entry.negativeRowset
          } else {
            const preparedNegative = intersectPerfectPrototypeRowsetsPrepared({
              leftRowset: negativeRowset,
              rightRowset: entry.negativeRowset,
              universeSize: rowCount,
              allowDense: true,
              resultOwnership: "borrowed",
            })
            nextNegativeRowset = preparedNegative.rowset
          }
        }
        const collectionOutcome = maybeCollectRuleFromRowsets({
          tokens: tokenStack,
          positiveMatchCount: nextPositiveMatchCount,
          negativeMatchCount: nextNegativeMatchCount,
          positiveRowset: nextPositiveRowset,
          negativeRowset: nextNegativeRowset,
        })
        const shouldDescend =
          tokenStack.length < cfg.maxRuleSize &&
          (nextNegativeMatchCount > 0 || Boolean(collectionOutcome?.canDescendPastZeroNegative))
        if (shouldDescend && nextNegativeMatchCount === 0 && !nextNegativeRowset) {
          nextNegativeRowset = emptyIndexedRowset
        }
        if (!shouldDescend || !nextPositiveRowset || !nextNegativeRowset) continue
        searchIndexed({
          startAt: tokenIndex + 1,
          positiveRowset: nextPositiveRowset,
          negativeRowset: nextNegativeRowset,
          positiveHitStats: nextPositiveResolvedHitStats,
        })
        if (exploredStates >= cfg.maxSearchStates) {
          rejectionSummary.truncatedByMaxSearchStates = true
          return
        }
      } finally {
        if (!isRoot) {
          releasePerfectPrototypeRowsetIfBorrowed(nextNegativeRowset)
          releasePerfectPrototypeRowsetIfBorrowed(nextPositiveRowset)
        }
        tokenStack.pop()
      }
    }
  }

  const searchStartedAt = process.hrtime.bigint()
  if (isExactIndexedKernelMode) {
    searchIndexed({
      startAt: 0,
      positiveRowset: allPositiveRowset,
      negativeRowset: allNegativeRowset,
    })
  } else {
    searchLegacy({
      startAt: 0,
      positiveRowIndexes: allPositiveRowIndexes,
      negativeRowIndexes: allNegativeRowIndexes,
    })
  }
  phaseTimings.searchSec = hrtimeSecondsSince(searchStartedAt)

  const emitStartedAt = process.hrtime.bigint()
  const rowsetRuntimeStats = isExactIndexedKernelMode ? getPerfectPrototypeRowsetRuntimeStats() : null
  rejectionSummary.collectedRuleCount = collectedRuleCount
  const cappedByTemporalSignature = applyPerfectPrototypeTemporalSignatureCaps({
    rules: Array.from(collectedByMatchSignature.values()).flat(),
    maxRulesPerMatchedDateSignature: cfg.maxRulesPerMatchedDateSignature,
    maxRulesPerMatchedMonthSignature: cfg.maxRulesPerMatchedMonthSignature,
    maxRulesPerMatchedQuarterSignature: cfg.maxRulesPerMatchedQuarterSignature,
  })
  rejectionSummary.matchedDateSignatureBucketCapCount = cappedByTemporalSignature.droppedByDateSignature
  rejectionSummary.matchedMonthSignatureBucketCapCount = cappedByTemporalSignature.droppedByMonthSignature
  rejectionSummary.matchedQuarterSignatureBucketCapCount = cappedByTemporalSignature.droppedByQuarterSignature
  let selectorReport = null
  let selectedRuleCores = cappedByTemporalSignature.rules
  if (cfg.enableDiverseCatalogSelection === true) {
    const diverseSelection = selectDiversePerfectPrototypeRules({
      rules: selectedRuleCores,
      rows: datasetRows,
      maxRules: cfg.diverseCatalogTargetRules ?? cfg.maxRules,
      noveltyWeight: cfg.diverseNoveltyWeight,
      overlapPenaltyWeight: cfg.diverseOverlapPenaltyWeight,
      anchorFamilyPenaltyWeight: cfg.diverseAnchorFamilyPenaltyWeight,
      topFamilyMaxQuota: cfg.topFamilyMaxQuota,
      midFamilyMinQuota: cfg.midFamilyMinQuota,
      lowFamilyMinQuota: cfg.lowFamilyMinQuota,
    })
    selectedRuleCores = diverseSelection.selectedRules
    selectorReport = diverseSelection.selectionReport
  } else if (cfg.enableMdlCatalogSelection === true) {
    const mdlSelection = selectPerfectPrototypeMdlRules({
      rules: selectedRuleCores,
      rows: datasetRows,
      maxRules: cfg.diverseCatalogTargetRules ?? cfg.maxRules,
      descriptionLengthWeight: cfg.mdlDescriptionLengthWeight,
      overlapPenaltyWeight: cfg.mdlOverlapPenaltyWeight,
    })
    selectedRuleCores = mdlSelection.selectedRules
    selectorReport = mdlSelection.selectionReport
  } else {
    selectedRuleCores = selectTopPerfectPrototypeRulesDeterministically(
      selectedRuleCores,
      cfg.maxRules,
    )
  }
  const collectedRuleCores = selectedRuleCores
  const collectedRules = collectedRuleCores.map((ruleCore) =>
    materializePerfectPrototypeRule({
      ruleCore,
      rows: datasetRows,
      calendarDateKeys,
    }),
  )
  const ruleCountByFamily = {}
  const continuationRuleCountByFamily = {}
  for (const rule of collectedRules) {
    const familyId = String(rule?.familyId ?? "").trim() || "unclassified"
    ruleCountByFamily[familyId] = Number(ruleCountByFamily[familyId] ?? 0) + 1
    if (isPerfectPrototypeContinuationFamilyId(rule?.familyId)) {
      continuationRuleCountByFamily[familyId] =
        Number(continuationRuleCountByFamily[familyId] ?? 0) + 1
    }
  }
  const matchRows = buildMatchRows({ rows: datasetRows, rules: collectedRules })
  const { dedupedMatches, overlapRows } = dedupePerfectPrototypeMatches({
    matches: matchRows,
    rules: collectedRules,
  })
  const coverage = buildPerfectPrototypeCoverageReport({
    rows: datasetRows,
    rules: collectedRules,
    matches: matchRows,
    dedupedMatches,
  })
  const augmentedCoverage = buildPerfectPrototypeMatchCoverageAugment({
    coverage,
    matchRows,
    calendarDateKeys,
    calendarFoldKeys,
  })
  const matchMassTelemetry = buildPerfectPrototypeMatchMassTelemetry({
    matchRows,
  })
  const catalog = buildPerfectPrototypeCatalog({
    tokenizerSpec: snapshot.tokenizerSpec,
    rules: collectedRules,
    rows: datasetRows,
    matches: matchRows,
    dedupedMatches,
    metadata: {
      trainStartDate: cfg.trainStartDate,
      trainEndDate: cfg.trainEndDate,
      minHitCount: cfg.minHitCount,
      minTrainPrecision: cfg.minTrainPrecision,
      maxTrainHitCount: cfg.maxTrainHitCount,
      enableTrainMatchedDatePrune: cfg.enableTrainMatchedDatePrune,
      minTrainMatchedDates: cfg.minTrainMatchedDates,
      minTrainMatchedMonths: cfg.minTrainMatchedMonths,
      minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
      maxTop1DateHitShare: cfg.maxTop1DateHitShare,
      maxTop3DateHitShare: cfg.maxTop3DateHitShare,
      maxRulesPerMatchedDateSignature: cfg.maxRulesPerMatchedDateSignature,
      maxRulesPerMatchedMonthSignature: cfg.maxRulesPerMatchedMonthSignature,
      maxRulesPerMatchedQuarterSignature: cfg.maxRulesPerMatchedQuarterSignature,
      enableDiverseSearchOrdering: cfg.enableDiverseSearchOrdering,
      diverseBeamMaxPerMonthSignature: cfg.diverseBeamMaxPerMonthSignature,
      diverseBeamMaxPerQuarterSignature: cfg.diverseBeamMaxPerQuarterSignature,
      diverseBeamMaxPerAnchorFamily: cfg.diverseBeamMaxPerAnchorFamily,
      enableDiverseCatalogSelection: cfg.enableDiverseCatalogSelection,
      enableMdlCatalogSelection: cfg.enableMdlCatalogSelection,
      diverseCatalogTargetRules: cfg.diverseCatalogTargetRules,
      diverseNoveltyWeight: cfg.diverseNoveltyWeight,
      diverseOverlapPenaltyWeight: cfg.diverseOverlapPenaltyWeight,
      diverseAnchorFamilyPenaltyWeight: cfg.diverseAnchorFamilyPenaltyWeight,
      mdlDescriptionLengthWeight: cfg.mdlDescriptionLengthWeight,
      mdlOverlapPenaltyWeight: cfg.mdlOverlapPenaltyWeight,
      maxGapTradingDays: cfg.maxGapTradingDays,
      maxRuleSize: cfg.maxRuleSize,
      maxSeedTokens: cfg.maxSeedTokens,
      maxRules: cfg.maxRules,
      maxSearchStates: cfg.maxSearchStates,
      exploredStates,
      surfaceName: cfg.surfaceName,
      searchMode: cfg.searchMode,
      collectionMode: resolvePerfectPrototypeCollectionMode(cfg.minTrainPrecision),
      enableFamilyScopedMining: cfg.enableFamilyScopedMining,
      familySeedMaxTopBucket: cfg.familySeedMaxTopBucket,
      familySeedMaxMidBucket: cfg.familySeedMaxMidBucket,
      familySeedMaxLowBucket: cfg.familySeedMaxLowBucket,
      midFamilyMinShare: cfg.midFamilyMinShare,
      lowFamilyMinShare: cfg.lowFamilyMinShare,
      lowFamilyMinTrainMatchedDates: cfg.lowFamilyMinTrainMatchedDates,
      lowFamilyMinTrainMatchedMonths: cfg.lowFamilyMinTrainMatchedMonths,
      lowFamilyMinTrainMatchedFolds: cfg.lowFamilyMinTrainMatchedFolds,
      topFamilyMaxQuota: cfg.topFamilyMaxQuota,
      midFamilyMinQuota: cfg.midFamilyMinQuota,
      lowFamilyMinQuota: cfg.lowFamilyMinQuota,
      ruleCountByFamily,
      continuationRuleCountByFamily,
      rejectionSummary,
      selectorReport,
      rowsetRuntimeStats,
    },
  })
  const negativeSeparationReport = buildNegativeSeparationReport({
    seedEntries,
    rejectedRules,
    rejectionSummary,
    exploredStates,
  })
  phaseTimings.emitSec = hrtimeSecondsSince(emitStartedAt)
  return {
    tokenizerSpec: snapshot.tokenizerSpec,
    rows: datasetRows,
    rules: collectedRules,
    matches: matchRows,
    dedupedMatches,
    overlapRows,
    coverage: augmentedCoverage,
    catalog,
    exploredStates,
    rejectionSummary,
    rowsetRuntimeStats,
    matchMassTelemetry,
    negativeSeparationReport,
    rejectedRules,
    phaseTimings,
  }
}

export const minePerfectPrototypes = ({ rows, tokenizerSpec = null, options = {} }) => {
  const cfg = normalizeMinerOptions(options)
  const prepared = preparePerfectPrototypeMiningSnapshot({ rows, tokenizerSpec, options: cfg })
  return minePerfectPrototypesPrepared({
    snapshot: prepared.snapshot,
    options: cfg,
    phaseTimings: prepared.phaseTimings,
  })
}
