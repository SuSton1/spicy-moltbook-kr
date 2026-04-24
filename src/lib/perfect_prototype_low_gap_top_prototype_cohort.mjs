import {
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  normalizePerfectPrototypeRow,
  normalizePerfectPrototypeTokenizerOptions,
} from "./perfect_prototype_tokenizer.mjs"
import {
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  normalizePerfectPrototypeSupportCases,
} from "./perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportSignatureMetrics } from "./perfect_prototype_support_manifold_signature.mjs"
import { buildPerfectPrototypeSupportMetricFeatures } from "./perfect_prototype_support_metric_features.mjs"
import { buildPerfectPrototypeAdaptiveThresholdAtoms } from "./perfect_prototype_adaptive_threshold_atom_bank.mjs"

const DEFAULT_SURFACE_NAME = "v6_contextual_plus_lite_recent_only_lane_local_pool8"
const GATE_TOKEN_PREFIXES = ["tag:lowGapTop.", "tag:event.", "tag:xsec.", "tag:market."]

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

const isGateToken = (token) => {
  const normalized = toText(token) ?? ""
  return GATE_TOKEN_PREFIXES.some((prefix) => normalized.startsWith(prefix))
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
  const numericFeatureMap = {
    ...(supportCase?.numericFeatureMap ?? {}),
    ...(signatureMetrics?.numericFeatureMap ?? {}),
    ...(supportMetricFeatures?.numericFeatureMap ?? {}),
  }
  return {
    caseId: supportCase?.caseId ?? null,
    symbol: supportCase?.symbol ?? null,
    dateKey: supportCase?.dateKey ?? null,
    numericFeatureMap,
    categoricalTokens,
    tokenSet: new Set(categoricalTokens),
    supportCompatibility: num(numericFeatureMap["sig.supportMetric.supportCompatibility"]),
    supportMargin: num(numericFeatureMap["sig.support.margin"]),
    prototypeAgreement: num(numericFeatureMap["sig.support.prototypeAgreement"]),
    clusterCell:
      categoricalTokens
        .find((token) => token.startsWith("sig:support.clusterCell:"))
        ?.split(":")
        ?.at(-1) ?? null,
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
  const numericFeatureMap = normalized?.numericFeatureMap ?? {}
  return {
    rowKey: buildRowKey({ ...normalized, dateKey, symbol, outcomeHitTarget }),
    sourceId: toText(normalized?.sourceId) ?? `${symbol}:${dateKey}`,
    symbol,
    dateKey,
    monthKey: buildMonthKey(dateKey),
    outcomeHitTarget,
    foldId: Number(foldMap.get(dateKey) ?? 0),
    windowId: Number(windowMap.get(dateKey) ?? 0),
    numericFeatureMap,
    categoricalTokens,
    tokenSet: new Set(categoricalTokens),
    supportCompatibility: num(numericFeatureMap["sig.supportMetric.supportCompatibility"]),
    supportMargin: num(numericFeatureMap["sig.support.margin"]),
    prototypeAgreement: num(numericFeatureMap["sig.support.prototypeAgreement"]),
    clusterCell:
      categoricalTokens
        .find((token) => token.startsWith("sig:support.clusterCell:"))
        ?.split(":")
        ?.at(-1) ?? null,
    raw: row,
  }
}

const buildGateTokens = ({
  trainRows = [],
  supportCaseViews = [],
  maxGateTokens = 2,
} = {}) => {
  const candidateTokens = uniqueSortedStrings(
    supportCaseViews.flatMap((view) => view.categoricalTokens.filter(isGateToken)),
  )
  const scored = candidateTokens
    .map((token) => {
      const matchedRows = trainRows.filter((row) => row.tokenSet.has(token))
      const positiveRows = matchedRows.filter((row) => row.outcomeHitTarget === true)
      const negativeRows = matchedRows.filter((row) => row.outcomeHitTarget !== true)
      const positiveDateCount = new Set(positiveRows.map((row) => row.dateKey)).size
      const score = positiveDateCount * 6 + positiveRows.length * 2 - negativeRows.length * 2
      return {
        token,
        score,
        positiveRows: positiveRows.length,
        negativeRows: negativeRows.length,
        positiveDateCount,
      }
    })
    .filter((entry) => entry.positiveRows > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.positiveDateCount !== left.positiveDateCount) {
        return right.positiveDateCount - left.positiveDateCount
      }
      return left.token.localeCompare(right.token)
    })
  return scored.slice(0, Math.max(1, Math.floor(Number(maxGateTokens) || 2))).map((entry) => entry.token)
}

const passesGate = (row, gateTokens) =>
  !Array.isArray(gateTokens) || gateTokens.length < 1
    ? true
    : gateTokens.every((token) => row?.tokenSet?.has(token))

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set((rows ?? []).map((row) => row.foldId).filter((value) => value > 0)).size,
})

export const buildPerfectPrototypeLowGapTopPrototypeCohort = ({
  familyId = "low_gap_top_continuation",
  trainRows = [],
  oosRows = [],
  supportCases = [],
  surfaceName = DEFAULT_SURFACE_NAME,
  crossfitWindowCount = 6,
  crossfitFoldCount = 4,
} = {}) => {
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases).filter((entry) =>
    entry.familyIds.length < 1 || entry.familyIds.includes(familyId),
  )
  const supportSignatureConfig = buildPerfectPrototypeSupportSignatureTokenizerConfig({
    familyId,
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
  const supportCaseViews = normalizedSupportCases.map((supportCase) =>
    buildSupportCaseRowView({
      supportCase,
      supportSignatureConfig,
    }),
  )
  const gateTokens = buildGateTokens({
    trainRows: normalizedTrainRows,
    supportCaseViews,
  })
  const supportCompatibilityAnchor =
    average(supportCaseViews.map((view) => view.supportCompatibility)) ?? 0
  const supportMarginAnchor = average(supportCaseViews.map((view) => view.supportMargin)) ?? 0
  const gatedTrainRows = normalizedTrainRows.filter((row) => passesGate(row, gateTokens))
  const supportPositiveRows = normalizedTrainRows.filter((row) => {
    if (row.outcomeHitTarget !== true) return false
    if (passesGate(row, gateTokens)) return true
    if ((row.supportCompatibility ?? Number.NEGATIVE_INFINITY) >= supportCompatibilityAnchor - 0.35) {
      return true
    }
    if ((row.supportMargin ?? Number.NEGATIVE_INFINITY) >= supportMarginAnchor - 0.35) {
      return true
    }
    return ["CORE", "EDGE", "SUPPORT_SIDE"].includes(String(row.clusterCell ?? ""))
  })
  const hardNegativeRows = normalizedTrainRows.filter((row) => {
    if (row.outcomeHitTarget === true) return false
    if (passesGate(row, gateTokens)) return true
    if ((row.supportCompatibility ?? Number.NEGATIVE_INFINITY) >= supportCompatibilityAnchor - 0.5) {
      return true
    }
    return !["OUTLIER", null].includes(row.clusterCell)
  })
  const backgroundRows = normalizedTrainRows.filter(
    (row) =>
      !supportPositiveRows.some((entry) => entry.rowKey === row.rowKey) &&
      !hardNegativeRows.some((entry) => entry.rowKey === row.rowKey),
  )

  return {
    familyId,
    surfaceName,
    supportSignatureConfig,
    tokenizerOptions,
    supportCaseViews,
    supportCaseIds: supportCaseViews.map((view) => view.caseId).filter(Boolean),
    gateTokens,
    supportCompatibilityAnchor,
    supportMarginAnchor,
    trainRows: normalizedTrainRows,
    gatedTrainRows,
    oosRows: normalizedOosRows,
    supportPositiveRows,
    hardNegativeRows,
    backgroundRows,
    summary: {
      familyId,
      supportCaseCount: supportCaseViews.length,
      gateTokens,
      prototypeCohortPositiveCount: supportPositiveRows.length,
      prototypeCohortHardNegativeCount: hardNegativeRows.length,
      prototypeCohortBackgroundCount: backgroundRows.length,
      gatedTrainSummary: summarizeRows(gatedTrainRows.filter((row) => row.outcomeHitTarget === true)),
      supportPositiveSummary: summarizeRows(supportPositiveRows),
      hardNegativeSummary: summarizeRows(hardNegativeRows),
      supportHistoricalMatchedCount: supportCaseViews.filter(
        (view) => view.caseId === PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
      ).length,
    },
  }
}

