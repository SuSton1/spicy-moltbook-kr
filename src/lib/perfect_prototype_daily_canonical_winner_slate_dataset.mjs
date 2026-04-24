import { PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE } from "./perfect_prototype_contextual_features.mjs"
import {
  normalizePerfectPrototypeRow,
  normalizePerfectPrototypeTokenizerOptions,
} from "./perfect_prototype_tokenizer.mjs"
import { normalizePerfectPrototypeSupportCases } from "./perfect_prototype_support_case.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const buildSortedDates = (rows = []) =>
  uniqueStrings((Array.isArray(rows) ? rows : []).map((row) => row?.dateKey).filter(Boolean))

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

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const dedupeRowsByKey = (rows = []) => {
  const deduped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? "").trim()
    if (!rowKey) continue
    deduped.set(rowKey, row)
  }
  return Array.from(deduped.values())
}

const buildRowKey = (row) =>
  toText(row?.sourceId) ??
  [
    toText(row?.dateKey) ?? "?",
    toText(row?.symbol) ?? "?",
    toText(row?.targetDateKey) ?? "?",
    String(Boolean(row?.outcomeHitTarget)),
  ].join("::")

const buildSupportCaseRowView = ({ supportCase } = {}) => {
  const tokens = uniqueStrings([
    ...(supportCase?.tokens ?? []),
    ...(supportCase?.categoricalTokens ?? []),
    ...(supportCase?.donorTokens ?? []),
  ])
  return {
    caseId: supportCase?.caseId ?? null,
    rowKey: supportCase?.caseId ?? null,
    sourceId: supportCase?.caseId ?? null,
    symbol: supportCase?.symbol ?? null,
    dateKey: supportCase?.dateKey ?? null,
    monthKey: buildMonthKey(supportCase?.dateKey),
    targetDateKey: null,
    outcomeHitTarget: true,
    foldId: 0,
    windowId: 0,
    eventOutcome: null,
    numericFeatureMap: {
      ...(supportCase?.numericFeatureMap ?? {}),
    },
    categoricalTokens: tokens,
    tokenSet: new Set(tokens),
    queryId: supportCase?.dateKey ?? null,
    queryLabel: "support",
    raw: supportCase,
  }
}

const buildNormalizedRowView = ({
  row,
  tokenizerOptions,
  foldMap,
  windowMap,
} = {}) => {
  const normalized =
    row?.numericFeatureMap && row?.dateKey && row?.symbol
      ? {
          ...row,
          sourceId: toText(row?.sourceId),
          symbol: toText(row?.symbol),
          dateKey: toText(row?.dateKey),
          targetDateKey:
            toText(row?.targetDateKey) ??
            toText(row?.eventOutcome?.entryDateKey) ??
            toText(row?.entryDateKey),
          numericFeatureMap: row?.numericFeatureMap ?? {},
          categoricalTokens: uniqueStrings(row?.categoricalTokens ?? []),
          outcomeHitTarget:
            typeof row?.outcomeHitTarget === "boolean"
              ? row.outcomeHitTarget
              : typeof row?.eventOutcome?.hitTarget === "boolean"
                ? row.eventOutcome.hitTarget
                : typeof row?.successInWindow === "boolean"
                  ? row.successInWindow
                  : null,
          eventOutcome: row?.eventOutcome ?? null,
        }
      : normalizePerfectPrototypeRow(row, tokenizerOptions)
  const dateKey = toText(normalized?.dateKey)
  const symbol = toText(normalized?.symbol)
  const outcomeHitTarget =
    typeof normalized?.outcomeHitTarget === "boolean"
      ? normalized.outcomeHitTarget
      : typeof normalized?.eventOutcome?.hitTarget === "boolean"
        ? normalized.eventOutcome.hitTarget
        : null
  if (!dateKey || !symbol || typeof outcomeHitTarget !== "boolean") return null
  const rowKey = buildRowKey({ ...normalized, dateKey, symbol, outcomeHitTarget })
  const numericFeatureMap = {
    ...(normalized?.numericFeatureMap ?? {}),
  }
  const eventNetRet =
    num(normalized?.eventOutcome?.netRet) ??
    num(normalized?.realizedNetRet) ??
    num(normalized?.netRet) ??
    (outcomeHitTarget === true ? 0.01 : -0.01)
  numericFeatureMap["sig.dailyWinner.eventNetRet"] = eventNetRet
  return {
    rowKey,
    sourceId: toText(normalized?.sourceId) ?? rowKey,
    symbol,
    dateKey,
    decisionDateKey: toText(normalized?.decisionDateKey) ?? dateKey,
    asOfDateKey: toText(normalized?.asOfDateKey),
    monthKey: buildMonthKey(dateKey),
    targetDateKey:
      toText(normalized?.targetDateKey) ??
      toText(normalized?.eventOutcome?.entryDateKey) ??
      toText(normalized?.entryDateKey),
    outcomeHitTarget,
    foldId: Number(foldMap.get(dateKey) ?? 0),
    windowId: Number(windowMap.get(dateKey) ?? 0),
    eventOutcome: normalized?.eventOutcome ?? row?.eventOutcome ?? null,
    numericFeatureMap,
    categoricalTokens: uniqueStrings(normalized?.categoricalTokens ?? []),
    tokenSet: new Set(uniqueStrings(normalized?.categoricalTokens ?? [])),
    seq40: Array.isArray(normalized?.seq40) ? normalized.seq40.slice() : [],
    seq150: Array.isArray(normalized?.seq150) ? normalized.seq150.slice() : [],
    queryId: dateKey,
    queryLabel: "unlabeled",
    raw: row,
  }
}

export const buildPerfectPrototypeDailyCanonicalWinnerSlateDataset = ({
  familyId = "daily_canonical_winner_slate_contrastive_top1",
  discoveryUniverseId = "same_day_plus_recent_upto_1d",
  trainRows = [],
  oosRows = [],
  controlTrainRows = [],
  controlOosRows = [],
  supportCases = [],
  surfaceName = PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  crossfitWindowCount = 6,
  crossfitFoldCount = 4,
  excludedFitSymbols = ["076610"],
} = {}) => {
  const tokenizerOptions = normalizePerfectPrototypeTokenizerOptions({
    surfaceName,
    includeCategoricalTokens: true,
  })
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases)
  const trainFoldMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitFoldCount)
  const trainWindowMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitWindowCount)

  const normalizedTrainRows = (Array.isArray(trainRows) ? trainRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        foldMap: trainFoldMap,
        windowMap: trainWindowMap,
      }),
    )
    .filter(Boolean)
  const normalizedOosRows = (Array.isArray(oosRows) ? oosRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        foldMap: new Map(),
        windowMap: new Map(),
      }),
    )
    .filter(Boolean)
  const normalizedControlTrainRows = (Array.isArray(controlTrainRows) ? controlTrainRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        foldMap: trainFoldMap,
        windowMap: trainWindowMap,
      }),
    )
    .filter(Boolean)
  const normalizedControlOosRows = (Array.isArray(controlOosRows) ? controlOosRows : [])
    .map((row) =>
      buildNormalizedRowView({
        row,
        tokenizerOptions,
        foldMap: new Map(),
        windowMap: new Map(),
      }),
    )
    .filter(Boolean)

  const excludedSymbolSet = new Set(uniqueStrings(excludedFitSymbols))
  const primaryFitTrainRows = normalizedTrainRows.filter(
    (row) => !excludedSymbolSet.has(String(row?.symbol ?? "").trim()),
  )
  const canonicalPositiveDateKeys = new Set(
    primaryFitTrainRows
      .filter((row) => row?.outcomeHitTarget === true)
      .map((row) => String(row?.dateKey ?? "").trim())
      .filter(Boolean),
  )
  const controlFitTrainRows = normalizedControlTrainRows.filter((row) => {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey || excludedSymbolSet.has(symbol)) return false
    return !canonicalPositiveDateKeys.has(dateKey)
  })
  const primaryNegativeDateRows = primaryFitTrainRows.filter(
    (row) => !canonicalPositiveDateKeys.has(String(row?.dateKey ?? "").trim()),
  )
  const fitTrainRows = dedupeRowsByKey([...primaryFitTrainRows, ...controlFitTrainRows])
  const controlOnlyDateKeys = uniqueStrings(controlFitTrainRows.map((row) => row?.dateKey).filter(Boolean))
  const supportCaseViews = normalizedSupportCases.map((supportCase) => buildSupportCaseRowView({ supportCase }))
  const bridgePositiveRows = primaryFitTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const supportNearHardNegativeRows = dedupeRowsByKey([...primaryNegativeDateRows, ...controlFitTrainRows])
  const ok = bridgePositiveRows.length > 0 && supportNearHardNegativeRows.length > 0

  return {
    ok,
    reason: ok ? null : "unsat_no_daily_canonical_winner_rows",
    familyId,
    discoveryUniverseId,
    surfaceName,
    tokenizerOptions,
    supportFitExcluded: true,
    excludedFitSymbols: Array.from(excludedSymbolSet.values()),
    canonicalPositiveDateKeys: Array.from(canonicalPositiveDateKeys.values()).sort((left, right) => left.localeCompare(right)),
    controlOnlyDateKeys,
    trainRows: fitTrainRows,
    gatedTrainRows: fitTrainRows,
    oosRows: dedupeRowsByKey([...normalizedOosRows, ...normalizedControlOosRows]),
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    summary: {
      familyId,
      discoveryUniverseId,
      supportFitExcluded: true,
      excludedFitSymbolCount: excludedSymbolSet.size,
      normalizedTrainRowCount: normalizedTrainRows.length,
      normalizedControlTrainRowCount: normalizedControlTrainRows.length,
      fitTrainRowCount: fitTrainRows.length,
      normalizedOosRowCount: normalizedOosRows.length,
      normalizedControlOosRowCount: normalizedControlOosRows.length,
      supportCaseCount: supportCaseViews.length,
      canonicalPositiveDateCount: canonicalPositiveDateKeys.size,
      controlOnlyDateCount: controlOnlyDateKeys.length,
      queryEligiblePositiveSummary: summarizeRows(bridgePositiveRows),
      queryEligibleNegativeSummary: summarizeRows(supportNearHardNegativeRows),
    },
  }
}
