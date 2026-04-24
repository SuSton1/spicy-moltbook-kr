import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
} from "./perfect_prototype_prejump_contract.mjs"
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

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

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

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = toText(row?.dateKey)
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey =
      toText(row?.rowKey) ??
      toText(row?.sourceId) ??
      `${toText(row?.symbol) ?? "?"}:${toText(row?.dateKey) ?? "?"}:${String(Boolean(row?.outcomeHitTarget))}`
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push(row)
  }
  return out
}

const PREJUMP_POSITIVE_BASE_AXES = [
  "seq40.mean",
  "seq40.delta",
  "seq40.last",
  "seq40.positiveShare",
  "seq150.mean",
  "seq150.delta",
  "seq150.last",
  "seq150.positiveShare",
]

const PREJUMP_NEGATIVE_BASE_AXES = [
  "seq40.stdev",
  "seq40.negativeShare",
  "seq150.stdev",
  "seq150.negativeShare",
]

const baseSelectionScore = (row) => {
  const numericFeatureMap = row?.numericFeatureMap ?? {}
  const positive = average(PREJUMP_POSITIVE_BASE_AXES.map((featureKey) => numericFeatureMap?.[featureKey])) ?? 0
  const negative = average(PREJUMP_NEGATIVE_BASE_AXES.map((featureKey) => numericFeatureMap?.[featureKey])) ?? 0
  return positive - negative
}

const eventNetRet = (row) => Number(num(row?.eventOutcome?.netRet) ?? 0)

const buildRowKey = (row) =>
  toText(row?.sourceId) ??
  `${toText(row?.symbol) ?? "?"}:${toText(row?.dateKey) ?? "?"}:${toText(row?.targetDateKey) ?? "?"}`

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
          targetDateKey: toText(row?.targetDateKey),
          numericFeatureMap: row?.numericFeatureMap ?? {},
          categoricalTokens: uniqueStrings(row?.categoricalTokens ?? []),
          outcomeHitTarget:
            typeof row?.outcomeHitTarget === "boolean"
              ? row.outcomeHitTarget
              : typeof row?.eventOutcome?.hitTarget === "boolean"
                ? row.eventOutcome.hitTarget
                : null,
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
  const numericFeatureMap = { ...(normalized?.numericFeatureMap ?? {}) }
  const rowKey = buildRowKey({ ...normalized, dateKey, symbol })
  numericFeatureMap["sig.prejump.baseSelectionScore"] = baseSelectionScore({ ...normalized, numericFeatureMap })
  return {
    rowKey,
    sourceId: toText(normalized?.sourceId) ?? rowKey,
    symbol,
    dateKey,
    monthKey: buildMonthKey(dateKey),
    targetDateKey: toText(normalized?.targetDateKey),
    outcomeHitTarget,
    foldId: Number(foldMap.get(dateKey) ?? 0),
    windowId: Number(windowMap.get(dateKey) ?? 0),
    eventOutcome: normalized?.eventOutcome ?? row?.eventOutcome ?? null,
    numericFeatureMap,
    categoricalTokens: uniqueStrings(normalized?.categoricalTokens ?? []),
    tokenSet: new Set(uniqueStrings(normalized?.categoricalTokens ?? [])),
    raw: row,
  }
}

const buildSupportCaseRowView = ({ supportCase } = {}) => ({
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
  categoricalTokens: uniqueStrings([
    ...(supportCase?.tokens ?? []),
    ...(supportCase?.categoricalTokens ?? []),
  ]),
  tokenSet: new Set(
    uniqueStrings([
      ...(supportCase?.tokens ?? []),
      ...(supportCase?.categoricalTokens ?? []),
    ]),
  ),
  queryId: supportCase?.dateKey ?? null,
  queryLabel: "support",
  raw: supportCase,
})

const buildDateSummary = (dateKey, rows = []) => {
  const scores = rows.map((row) => baseSelectionScore(row)).filter(Number.isFinite)
  return {
    dateKey,
    rowCount: rows.length,
    positiveRowCount: rows.filter((row) => row?.outcomeHitTarget === true).length,
    foldIds: Array.from(
      new Set(rows.map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0)),
    ).sort((left, right) => left - right),
    baseScoreMean: average(scores) ?? 0,
    baseScoreTop: Math.max(...scores, 0),
    seq40MeanMean: average(rows.map((row) => row?.numericFeatureMap?.["seq40.mean"])) ?? 0,
    seq40StdevMean: average(rows.map((row) => row?.numericFeatureMap?.["seq40.stdev"])) ?? 0,
    seq150MeanMean: average(rows.map((row) => row?.numericFeatureMap?.["seq150.mean"])) ?? 0,
    seq150StdevMean: average(rows.map((row) => row?.numericFeatureMap?.["seq150.stdev"])) ?? 0,
  }
}

const dateSummaryDistance = (left, right) => {
  const safeLeft = left ?? {}
  const safeRight = right ?? {}
  return (
    Math.abs(Number(safeLeft.rowCount ?? 0) - Number(safeRight.rowCount ?? 0)) +
    Math.abs(Number(safeLeft.baseScoreMean ?? 0) - Number(safeRight.baseScoreMean ?? 0)) +
    Math.abs(Number(safeLeft.baseScoreTop ?? 0) - Number(safeRight.baseScoreTop ?? 0)) +
    Math.abs(Number(safeLeft.seq40MeanMean ?? 0) - Number(safeRight.seq40MeanMean ?? 0)) +
    Math.abs(Number(safeLeft.seq40StdevMean ?? 0) - Number(safeRight.seq40StdevMean ?? 0)) +
    Math.abs(Number(safeLeft.seq150MeanMean ?? 0) - Number(safeRight.seq150MeanMean ?? 0)) +
    Math.abs(Number(safeLeft.seq150StdevMean ?? 0) - Number(safeRight.seq150StdevMean ?? 0))
  )
}

const buildPairRows = ({ positiveRow, negativeRows = [], pairType } = {}) =>
  (Array.isArray(negativeRows) ? negativeRows : [])
    .filter(Boolean)
    .map((negativeRow) => ({
      pairType,
      positiveRowKey: positiveRow?.rowKey ?? null,
      negativeRowKey: negativeRow?.rowKey ?? null,
      positiveDateKey: positiveRow?.dateKey ?? null,
      negativeDateKey: negativeRow?.dateKey ?? null,
      positiveFoldId: Number(positiveRow?.foldId ?? 0),
      negativeFoldId: Number(negativeRow?.foldId ?? 0),
    }))
    .filter((pair) => pair.positiveRowKey && pair.negativeRowKey)

const annotateQueryLabels = ({ rows = [], positiveDateKeys = new Set() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    queryId: row?.queryId ?? row?.dateKey ?? null,
    queryLabel: positiveDateKeys.has(String(row?.dateKey ?? "").trim()) ? "positive" : "negative",
  }))

export const buildPerfectPrototypePrejumpHypothesisPortfolioDataset = ({
  familyId = "prejump_predictive_hypothesis_portfolio",
  trainRows = [],
  oosRows = [],
  supportCases = [],
  crossfitWindowCount = 6,
  crossfitFoldCount = 4,
  sameDateNegativePoolSize = 2,
  matchedControlNegativePoolSize = 2,
  failureNegativePoolSize = 2,
  excludedFitSymbols = ["076610"],
} = {}) => {
  const tokenizerOptions = normalizePerfectPrototypeTokenizerOptions({
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
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
  const excludedSymbolSet = new Set(uniqueStrings(excludedFitSymbols))
  const fitTrainRows = normalizedTrainRows.filter((row) => !excludedSymbolSet.has(String(row?.symbol ?? "").trim()))
  const supportCaseViews = normalizedSupportCases.map((supportCase) => buildSupportCaseRowView({ supportCase }))

  const trainByDate = groupRowsByDate(fitTrainRows)
  const negativeDateSummaries = []
  const dateSummaryLookup = new Map()
  for (const [dateKey, rows] of trainByDate.entries()) {
    const summary = buildDateSummary(dateKey, rows)
    dateSummaryLookup.set(dateKey, summary)
    if ((summary?.positiveRowCount ?? 0) < 1) negativeDateSummaries.push(summary)
  }

  const calibrationPositiveRows = []
  const sameDateNegativeRows = []
  const matchedControlNegativeRows = []
  const failureNegativeRows = []
  const portfolioPairs = []
  const globalFailurePool = fitTrainRows
    .filter((row) => row?.outcomeHitTarget !== true)
    .sort(
      (left, right) =>
        baseSelectionScore(right) - baseSelectionScore(left) ||
        String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
    )

  for (const [dateKey, rows] of trainByDate.entries()) {
    const positiveRows = rows.filter((row) => row?.outcomeHitTarget === true)
    if (positiveRows.length < 1) continue
    const canonicalPositive = positiveRows
      .slice()
      .sort(
        (left, right) =>
          eventNetRet(right) - eventNetRet(left) ||
          baseSelectionScore(right) - baseSelectionScore(left) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )[0]
    if (!canonicalPositive) continue
    calibrationPositiveRows.push(canonicalPositive)

    const sameDateNegatives = rows
      .filter((row) => row?.rowKey !== canonicalPositive.rowKey)
      .sort(
        (left, right) =>
          baseSelectionScore(right) - baseSelectionScore(left) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
      .slice(0, Math.max(1, Math.floor(Number(sameDateNegativePoolSize) || 2)))
    sameDateNegativeRows.push(...sameDateNegatives)
    portfolioPairs.push(
      ...buildPairRows({
        positiveRow: canonicalPositive,
        negativeRows: sameDateNegatives,
        pairType: "same_date_runner_up",
      }),
    )

    const nearestNegativeDates = negativeDateSummaries
      .map((summary) => ({
        summary,
        distance: dateSummaryDistance(dateSummaryLookup.get(dateKey), summary),
      }))
      .sort((left, right) => left.distance - right.distance || String(left?.summary?.dateKey ?? "").localeCompare(String(right?.summary?.dateKey ?? "")))
      .map((entry) => entry.summary?.dateKey)
      .filter(Boolean)
    const matchedControlRows = uniqueRowsByKey(
      nearestNegativeDates
        .flatMap((negativeDateKey) => trainByDate.get(negativeDateKey) ?? [])
        .filter((row) => row?.outcomeHitTarget !== true && String(row?.dateKey ?? "").trim() !== dateKey)
        .sort(
          (left, right) =>
            baseSelectionScore(right) - baseSelectionScore(left) ||
            String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
        )
        .slice(0, Math.max(1, Math.floor(Number(matchedControlNegativePoolSize) || 2))),
    )
    matchedControlNegativeRows.push(...matchedControlRows)
    portfolioPairs.push(
      ...buildPairRows({
        positiveRow: canonicalPositive,
        negativeRows: matchedControlRows,
        pairType: "matched_control_impostor",
      }),
    )

    const excludedNegativeKeys = new Set(
      [canonicalPositive?.rowKey, ...sameDateNegatives.map((row) => row?.rowKey), ...matchedControlRows.map((row) => row?.rowKey)].filter(Boolean),
    )
    const selectedFailureRows = globalFailurePool
      .filter(
        (row) =>
          String(row?.dateKey ?? "").trim() !== dateKey &&
          !excludedNegativeKeys.has(row?.rowKey),
      )
      .slice(0, Math.max(1, Math.floor(Number(failureNegativePoolSize) || 2)))
    failureNegativeRows.push(...selectedFailureRows)
    portfolioPairs.push(
      ...buildPairRows({
        positiveRow: canonicalPositive,
        negativeRows: selectedFailureRows,
        pairType: "failure_impostor",
      }),
    )
  }

  const uniquePositiveRows = uniqueRowsByKey(calibrationPositiveRows)
  const uniqueSameDateNegativeRows = uniqueRowsByKey(sameDateNegativeRows)
  const uniqueMatchedControlNegativeRows = uniqueRowsByKey(matchedControlNegativeRows)
  const uniqueFailureNegativeRows = uniqueRowsByKey(failureNegativeRows)
  const calibrationNegativeRows = uniqueRowsByKey([
    ...uniqueSameDateNegativeRows,
    ...uniqueMatchedControlNegativeRows,
    ...uniqueFailureNegativeRows,
  ])
  const positiveDateKeys = new Set(uniquePositiveRows.map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean))
  const labeledTrainRows = annotateQueryLabels({ rows: fitTrainRows, positiveDateKeys })
  const ok = uniquePositiveRows.length > 0 && calibrationNegativeRows.length > 0 && portfolioPairs.length > 0

  return {
    ok,
    reason: ok ? null : "unsat_no_prejump_portfolio_dataset",
    familyId,
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    tokenizerOptions,
    supportFitExcluded: true,
    excludedFitSymbols: Array.from(excludedSymbolSet.values()),
    trainRows: labeledTrainRows,
    gatedTrainRows: labeledTrainRows,
    oosRows: normalizedOosRows.map((row) => ({
      ...row,
      queryId: row?.queryId ?? row?.dateKey ?? null,
      queryLabel: "unlabeled",
    })),
    supportCaseViews,
    bridgePositiveRows: uniquePositiveRows,
    supportNearHardNegativeRows: calibrationNegativeRows,
    calibrationPositiveRows: uniquePositiveRows,
    calibrationNegativeRows,
    sameDateRunnerUpRows: uniqueSameDateNegativeRows,
    matchedControlRows: uniqueMatchedControlNegativeRows,
    failureNegativeRows: uniqueFailureNegativeRows,
    portfolioPairs,
    summary: {
      familyId,
      supportFitExcluded: true,
      excludedFitSymbolCount: excludedSymbolSet.size,
      normalizedTrainRowCount: normalizedTrainRows.length,
      fitTrainRowCount: labeledTrainRows.length,
      normalizedOosRowCount: normalizedOosRows.length,
      supportCaseCount: supportCaseViews.length,
      positiveWinnerSummary: summarizeRows(uniquePositiveRows),
      sameDateRunnerUpSummary: summarizeRows(uniqueSameDateNegativeRows),
      matchedControlSummary: summarizeRows(uniqueMatchedControlNegativeRows),
      failureNegativeSummary: summarizeRows(uniqueFailureNegativeRows),
      calibrationNegativeSummary: summarizeRows(calibrationNegativeRows),
      winnerPositiveDateCount: positiveDateKeys.size,
      pairCount: portfolioPairs.length,
    },
  }
}
