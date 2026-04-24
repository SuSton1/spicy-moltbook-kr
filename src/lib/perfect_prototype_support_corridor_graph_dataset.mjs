const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
  matchedWindowCount: new Set(
      (rows ?? []).map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0),
  ).size,
})

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const unique = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? "").trim()
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    unique.push(row)
  }
  return unique
}

const safeDiv = (left, right, fallback = 0) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return fallback
  return l / r
}

const comparePositiveSeeds = (left, right) => {
  const leftScore = Number(left?.corridorPositiveSeedScore ?? Number.NEGATIVE_INFINITY)
  const rightScore = Number(right?.corridorPositiveSeedScore ?? Number.NEGATIVE_INFINITY)
  if (rightScore !== leftScore) return rightScore - leftScore
  return String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? ""))
}

const compareNegativeSeeds = (left, right) => {
  const leftScore = Number(left?.corridorNegativeSeedScore ?? Number.NEGATIVE_INFINITY)
  const rightScore = Number(right?.corridorNegativeSeedScore ?? Number.NEGATIVE_INFINITY)
  if (rightScore !== leftScore) return rightScore - leftScore
  return String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? ""))
}

const scorePositiveSeed = (row) =>
  Math.max(0, Number(row?.numericFeatureMap?.["sig.bridge.posNegMargin"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.bridge.bestPositiveCellMargin"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.bridge.localPurityScore"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.boundary.supportRecoveryPotential"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.crossfitRecoveryShare"] ?? 0)) -
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.crossfitLeakShare"] ?? 0)) -
  Math.max(0, Number(row?.numericFeatureMap?.["sig.boundary.falsePositivePressure"] ?? 0))

const scoreNegativeSeed = (row) =>
  Math.max(0, Number(row?.numericFeatureMap?.["sig.boundary.falsePositivePressure"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.crossfitLeakShare"] ?? 0)) +
  Math.max(0, Number(row?.numericFeatureMap?.["sig.recurBoundary.negNeighborLeakShare"] ?? 0)) +
  Math.max(0, -Number(row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"] ?? 0)) +
  Math.max(0, -Number(row?.numericFeatureMap?.["sig.bridge.posNegMargin"] ?? 0))

const selectPositiveSeeds = ({
  rows = [],
  minDates = 10,
  minMonths = 6,
  minFolds = 4,
  minRows = 12,
  maxRows = 96,
} = {}) => {
  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      corridorPositiveSeedScore: scorePositiveSeed(row),
    }))
    .filter(
      (row) =>
        Number(row.corridorPositiveSeedScore) > 0 &&
        Number(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"] ?? Number.NEGATIVE_INFINITY) >= 0,
    )
    .sort(comparePositiveSeeds)
  const prefixMax = Math.min(ranked.length, Math.max(1, Math.floor(Number(maxRows) || 96)))
  let selected = ranked.slice(0, Math.min(prefixMax, Math.max(1, Math.floor(Number(minRows) || 12))))
  for (let count = Math.max(1, Math.floor(Number(minRows) || 12)); count <= prefixMax; count += 1) {
    const candidate = ranked.slice(0, count)
    const summary = summarizeRows(candidate)
    selected = candidate
    if (
      summary.matchedDateCount >= minDates &&
      summary.matchedMonthCount >= minMonths &&
      summary.matchedFoldCount >= minFolds
    ) {
      return { rows: candidate, summary, ok: true }
    }
  }
  return { rows: selected, summary: summarizeRows(selected), ok: selected.length > 0 }
}

const selectNegativeSeeds = ({
  rows = [],
  minRows = 24,
  maxRows = 144,
  minFolds = 4,
} = {}) => {
  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      corridorNegativeSeedScore: scoreNegativeSeed(row),
    }))
    .sort(compareNegativeSeeds)
  const prefixMax = Math.min(ranked.length, Math.max(1, Math.floor(Number(maxRows) || 144)))
  let selected = ranked.slice(0, Math.min(prefixMax, Math.max(1, Math.floor(Number(minRows) || 24))))
  for (let count = Math.max(1, Math.floor(Number(minRows) || 24)); count <= prefixMax; count += 1) {
    const candidate = ranked.slice(0, count)
    const summary = summarizeRows(candidate)
    selected = candidate
    if (summary.matchedFoldCount >= minFolds) {
      return { rows: candidate, summary, ok: true }
    }
  }
  return { rows: selected, summary: summarizeRows(selected), ok: selected.length > 0 }
}

export const buildPerfectPrototypeSupportCorridorGraphDataset = ({
  family,
  minPositiveSeedDates = 10,
  minPositiveSeedMonths = 6,
  minPositiveSeedFolds = 4,
  minPositiveSeedRows = 12,
  maxPositiveSeedRows = 96,
  minNegativeSeedRows = 24,
  maxNegativeSeedRows = 144,
} = {}) => {
  const graphTrainRows = Array.isArray(family?.gatedTrainRows) ? family.gatedTrainRows : []
  const supportCaseViews = Array.isArray(family?.supportCaseViews) ? family.supportCaseViews : []
  const oosRows = Array.isArray(family?.oosRows) ? family.oosRows : []
  const bridgePositiveRows = Array.isArray(family?.graphPositiveReferenceRows)
    ? family.graphPositiveReferenceRows
    : Array.isArray(family?.bridgePositiveRows)
    ? family.bridgePositiveRows
    : graphTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const supportNearHardNegativeRows = Array.isArray(family?.supportNearHardNegativeRows)
    ? family.supportNearHardNegativeRows
    : graphTrainRows.filter((row) => row?.outcomeHitTarget !== true)

  const positiveSeedSelection =
    Array.isArray(family?.graphPositiveSeedRows) && family.graphPositiveSeedRows.length > 0
      ? {
          rows: uniqueRowsByKey(family.graphPositiveSeedRows),
          summary: summarizeRows(family.graphPositiveSeedRows),
          ok: true,
        }
      : selectPositiveSeeds({
          rows: bridgePositiveRows,
          minDates: minPositiveSeedDates,
          minMonths: minPositiveSeedMonths,
          minFolds: minPositiveSeedFolds,
          minRows: minPositiveSeedRows,
          maxRows: maxPositiveSeedRows,
        })
  const negativeSeedSelection = selectNegativeSeeds({
    rows: supportNearHardNegativeRows,
    minRows: minNegativeSeedRows,
    maxRows: maxNegativeSeedRows,
  })
  const graphPositiveReferenceRows = Array.isArray(family?.graphPositiveReferenceRows)
    ? uniqueRowsByKey(family.graphPositiveReferenceRows)
    : uniqueRowsByKey([...bridgePositiveRows, ...positiveSeedSelection.rows])
  const graphNegativeReferenceRows = uniqueRowsByKey([
    ...supportNearHardNegativeRows,
    ...negativeSeedSelection.rows,
  ])
  const supportCasePositiveSeedScoreMean = average(
    supportCaseViews.map((row) => scorePositiveSeed(row)),
  )
  const supportCaseNegativeSeedScoreMean = average(
    supportCaseViews.map((row) => scoreNegativeSeed(row)),
  )

  const ok =
    family?.supportFitExcluded === true &&
    graphTrainRows.length > 0 &&
    positiveSeedSelection.ok === true &&
    negativeSeedSelection.ok === true &&
    supportCaseViews.length > 0
  const reason =
    family?.supportFitExcluded !== true
      ? "unsat_support_acceptance_only_dependency"
      : graphTrainRows.length < 1
        ? "unsat_no_graph_train_rows"
        : positiveSeedSelection.rows.length < 1
          ? "unsat_no_positive_graph_seeds"
          : negativeSeedSelection.rows.length < 1
            ? "unsat_no_negative_graph_seeds"
            : supportCaseViews.length < 1
              ? "unsat_no_support_acceptance_views"
              : null

  return {
    ...family,
    ok,
    reason,
    graphTrainRows,
    graphPositiveSeedRows: positiveSeedSelection.rows,
    graphNegativeSeedRows: negativeSeedSelection.rows,
    graphPositiveReferenceRows,
    graphNegativeReferenceRows,
    supportCaseViews,
    oosRows,
    summary: {
      ...(family?.summary ?? {}),
      corridorGraphDatasetReady: ok,
      corridorGraphDatasetReason: reason,
      graphTrainRowCount: graphTrainRows.length,
      graphPositiveSeedCount: positiveSeedSelection.rows.length,
      graphNegativeSeedCount: negativeSeedSelection.rows.length,
      graphPositiveReferenceCount: graphPositiveReferenceRows.length,
      graphNegativeReferenceCount: graphNegativeReferenceRows.length,
      graphPositiveSeedSummary: positiveSeedSelection.summary,
      graphNegativeSeedSummary: negativeSeedSelection.summary,
      graphPositiveReferenceSummary: summarizeRows(graphPositiveReferenceRows),
      graphNegativeReferenceSummary: summarizeRows(graphNegativeReferenceRows),
      graphTrainPositiveRate: safeDiv(
        graphTrainRows.filter((row) => row?.outcomeHitTarget === true).length,
        graphTrainRows.length,
        0,
      ),
      supportCasePositiveSeedScoreMean,
      supportCaseNegativeSeedScoreMean,
    },
  }
}

export { summarizeRows as summarizePerfectPrototypeSupportCorridorGraphRows }
