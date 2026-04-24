import {
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  normalizePerfectPrototypeRow,
  normalizePerfectPrototypeTokenizerOptions,
} from "./perfect_prototype_tokenizer.mjs"
import {
  normalizePerfectPrototypeSupportCases,
} from "./perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportSignatureMetrics } from "./perfect_prototype_support_manifold_signature.mjs"
import { buildPerfectPrototypeSupportMetricFeatures } from "./perfect_prototype_support_metric_features.mjs"
import { buildPerfectPrototypeAdaptiveThresholdAtoms } from "./perfect_prototype_adaptive_threshold_atom_bank.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN,
} from "./perfect_prototype_rule_family_spec.mjs"

const DEFAULT_SURFACE_NAME = "v6_contextual_plus_lite_recent_only_lane_local_pool8"
const RECENT_MID_LOW_QUERY_TOKEN = "sig:recentMidLow.queryEligible"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueSortedStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const buildSortedDates = (rows) =>
  uniqueSortedStrings((Array.isArray(rows) ? rows : []).map((row) => row?.dateKey).filter(Boolean))

const buildDateBucketMap = (sortedDates, bucketCount) => {
  const safeDates = Array.isArray(sortedDates) ? sortedDates : []
  const count = Math.max(1, Math.floor(Number(bucketCount) || 1))
  const out = new Map()
  for (let index = 0; index < safeDates.length; index += 1) {
    const bucket = Math.min(count - 1, Math.floor((index * count) / Math.max(1, safeDates.length)))
    out.set(String(safeDates[index]), bucket + 1)
  }
  return out
}

const buildRowKey = (row) =>
  toText(row?.sourceId) ??
  [toText(row?.dateKey) ?? "?", toText(row?.symbol) ?? "?", String(Boolean(row?.outcomeHitTarget))].join("::")

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => row?.foldId).filter((value) => Number(value) > 0)).size,
})

const passesRecentMidLowEligibility = (tokenSet) => {
  const set = tokenSet instanceof Set ? tokenSet : new Set(Array.isArray(tokenSet) ? tokenSet : [])
  const hasLane = set.has(PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN)
  const hasMidOrLow = set.has(PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN) || set.has(PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)
  const hasTop = set.has(PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN)
  const thinPool = set.has(PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN)
  return hasLane && hasMidOrLow && !hasTop && !thinPool
}

const buildSupportCaseRowView = ({
  supportCase,
  supportSignatureConfig,
} = {}) => {
  const baseCategoricalTokens = uniqueSortedStrings([
    ...(supportCase?.categoricalTokens ?? []),
    ...(supportCase?.donorTokens ?? []).filter((token) => {
      const text = toText(token) ?? ""
      return text.startsWith("tag:") || text.startsWith("macro:") || text.startsWith("sig:")
    }),
  ])
  const signatureMetrics = supportSignatureConfig
    ? buildPerfectPrototypeSupportSignatureMetrics({
        normalizedRow: {
          symbol: supportCase?.symbol,
          dateKey: supportCase?.dateKey,
          numericFeatureMap: supportCase?.numericFeatureMap ?? {},
          categoricalTokens: baseCategoricalTokens,
        },
        supportSignatureConfig,
      })
    : { numericFeatureMap: {}, categoricalTokens: [] }
  const supportMetricFeatures = buildPerfectPrototypeSupportMetricFeatures({
    signatureMetrics,
  })
  const adaptiveThresholdAtoms = buildPerfectPrototypeAdaptiveThresholdAtoms({
    signatureMetrics,
  })
  const categoricalTokens = uniqueSortedStrings([
    ...baseCategoricalTokens,
    ...(signatureMetrics?.categoricalTokens ?? []),
    ...(supportMetricFeatures?.categoricalTokens ?? []),
    ...adaptiveThresholdAtoms,
  ])
  const tokenSet = new Set(categoricalTokens)
  if (passesRecentMidLowEligibility(tokenSet)) {
    categoricalTokens.push(RECENT_MID_LOW_QUERY_TOKEN)
    tokenSet.add(RECENT_MID_LOW_QUERY_TOKEN)
  }
  return {
    caseId: supportCase?.caseId ?? null,
    symbol: supportCase?.symbol ?? null,
    dateKey: supportCase?.dateKey ?? null,
    monthKey: buildMonthKey(supportCase?.dateKey),
    foldId: 0,
    windowId: 0,
    outcomeHitTarget: true,
    numericFeatureMap: {
      ...(supportCase?.numericFeatureMap ?? {}),
      ...(signatureMetrics?.numericFeatureMap ?? {}),
      ...(supportMetricFeatures?.numericFeatureMap ?? {}),
    },
    categoricalTokens,
    tokenSet,
    raw: supportCase,
  }
}

const buildNormalizedRowView = ({
  row,
  tokenizerOptions,
  supportSignatureConfig,
  foldMap,
  windowMap,
} = {}) => {
  const normalized =
    row?.numericFeatureMap && row?.dateKey && row?.symbol
      ? {
          ...row,
          dateKey: toText(row.dateKey),
          symbol: toText(row.symbol),
          sourceId: toText(row?.sourceId),
          categoricalTokens: uniqueSortedStrings(row?.categoricalTokens ?? []),
          numericFeatureMap: row?.numericFeatureMap ?? {},
          outcomeHitTarget:
            typeof row?.outcomeHitTarget === "boolean"
              ? row.outcomeHitTarget
              : typeof row?.eventOutcome?.hitTarget === "boolean"
                ? row.eventOutcome.hitTarget
                : typeof row?.successInWindow === "boolean"
                  ? row.successInWindow
                  : null,
        }
      : normalizePerfectPrototypeRow(row, {
          ...tokenizerOptions,
          supportSignatureConfig,
        })
  const dateKey = toText(normalized?.dateKey)
  const symbol = toText(normalized?.symbol)
  const outcomeHitTarget =
    typeof normalized?.outcomeHitTarget === "boolean" ? normalized.outcomeHitTarget : null
  if (!dateKey || !symbol || typeof outcomeHitTarget !== "boolean") return null
  const categoricalTokens = uniqueSortedStrings(normalized?.categoricalTokens ?? [])
  const tokenSet = new Set(categoricalTokens)
  if (passesRecentMidLowEligibility(tokenSet)) {
    categoricalTokens.push(RECENT_MID_LOW_QUERY_TOKEN)
    tokenSet.add(RECENT_MID_LOW_QUERY_TOKEN)
  }
  return {
    rowKey: buildRowKey({ ...normalized, dateKey, symbol, outcomeHitTarget }),
    sourceId: toText(normalized?.sourceId) ?? `${symbol}:${dateKey}`,
    symbol,
    dateKey,
    monthKey: buildMonthKey(dateKey),
    outcomeHitTarget,
    foldId: Number(foldMap.get(dateKey) ?? 0),
    windowId: Number(windowMap.get(dateKey) ?? 0),
    numericFeatureMap: normalized?.numericFeatureMap ?? {},
    categoricalTokens,
    tokenSet,
    raw: row,
  }
}

export const buildPerfectPrototypeRecentMidLowWinnerQueryDataset = ({
  familyId = "recent_mid_low_same_date_winner_query",
  supportSignatureFamilyId = "low_gap_top_continuation",
  trainRows = [],
  oosRows = [],
  supportCases = [],
  surfaceName = DEFAULT_SURFACE_NAME,
  crossfitWindowCount = 6,
  crossfitFoldCount = 4,
  excludedFitSymbols = ["076610"],
} = {}) => {
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases)
  const supportSignatureConfig = buildPerfectPrototypeSupportSignatureTokenizerConfig({
    familyId: supportSignatureFamilyId,
    supportCases: normalizedSupportCases,
  })
  const tokenizerOptions = normalizePerfectPrototypeTokenizerOptions({
    surfaceName,
    enableSupportManifoldSignature: supportSignatureConfig != null,
    enableSupportMetricFeatures: true,
    enableAdaptiveThresholdAtoms: true,
    supportSignatureConfig,
  })
  const trainDateMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitFoldCount)
  const trainWindowMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitWindowCount)

  const normalizedTrainRows = (Array.isArray(trainRows) ? trainRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        supportSignatureConfig,
        foldMap: trainDateMap,
        windowMap: trainWindowMap,
      }),
    )
    .filter(Boolean)
  const normalizedOosRows = (Array.isArray(oosRows) ? oosRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        supportSignatureConfig,
        foldMap: new Map(),
        windowMap: new Map(),
      }),
    )
    .filter(Boolean)
  const excludedSymbolSet = new Set(uniqueSortedStrings(excludedFitSymbols))
  const fitTrainRows = normalizedTrainRows.filter((row) => !excludedSymbolSet.has(String(row?.symbol ?? "").trim()))
  const queryEligibleTrainRows = fitTrainRows.filter((row) => row?.tokenSet?.has(RECENT_MID_LOW_QUERY_TOKEN) === true)
  const queryEligibleOosRows = normalizedOosRows.filter((row) => row?.tokenSet?.has(RECENT_MID_LOW_QUERY_TOKEN) === true)
  const supportCaseViews = normalizedSupportCases.map((supportCase) =>
    buildSupportCaseRowView({
      supportCase,
      supportSignatureConfig,
    }),
  )

  const initialPositiveRows = queryEligibleTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const initialNegativeRows = queryEligibleTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  const ok = queryEligibleTrainRows.length > 0 && initialPositiveRows.length > 0 && initialNegativeRows.length > 0

  return {
    ok,
    reason: ok ? null : "unsat_no_recent_mid_low_query_rows",
    familyId,
    surfaceName,
    supportSignatureFamilyId,
    supportSignatureConfig,
    tokenizerOptions,
    gateTokens: [],
    supportFitExcluded: true,
    excludedFitSymbols: Array.from(excludedSymbolSet.values()),
    trainRows: queryEligibleTrainRows,
    gatedTrainRows: queryEligibleTrainRows,
    oosRows: queryEligibleOosRows,
    supportCaseViews,
    bridgePositiveRows: initialPositiveRows,
    supportNearHardNegativeRows: initialNegativeRows,
    queryGateToken: RECENT_MID_LOW_QUERY_TOKEN,
    summary: {
      familyId,
      supportFitExcluded: true,
      excludedFitSymbolCount: excludedSymbolSet.size,
      normalizedTrainRowCount: normalizedTrainRows.length,
      queryEligibleTrainRowCount: queryEligibleTrainRows.length,
      queryEligibleOosRowCount: queryEligibleOosRows.length,
      queryEligiblePositiveSummary: summarizeRows(initialPositiveRows),
      queryEligibleNegativeSummary: summarizeRows(initialNegativeRows),
      supportCaseCount: supportCaseViews.length,
      queryGateToken: RECENT_MID_LOW_QUERY_TOKEN,
      supportSignatureFamilyId,
    },
  }
}
