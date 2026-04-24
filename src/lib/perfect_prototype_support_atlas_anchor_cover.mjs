import {
  buildPerfectPrototypeSupportAtlasFeatureWeights,
  buildPerfectPrototypeSupportAtlasPrototype,
  scorePerfectPrototypeSupportAtlasPrototype,
} from "./perfect_prototype_support_atlas_metric.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const selectDiverseAnchors = ({
  rows = [],
  featureKeys = [],
  featureScales = {},
  maxAnchors = 6,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeRows.length < 1) return []
  const anchors = [safeRows[0]]
  while (anchors.length < Math.min(safeRows.length, Math.max(1, Math.floor(Number(maxAnchors) || 6)))) {
    let bestRow = null
    let bestDistance = Number.NEGATIVE_INFINITY
    for (const row of safeRows) {
      if (anchors.some((anchor) => anchor.rowKey === row.rowKey)) continue
      let minDistance = Number.POSITIVE_INFINITY
      for (const anchor of anchors) {
        const distance = scorePerfectPrototypeSupportAtlasPrototype({
          row,
          prototype: anchor?.numericFeatureMap ?? {},
          featureKeys,
          featureScales,
        })
        if (distance < minDistance) minDistance = distance
      }
      const diversityScore =
        minDistance +
        (anchors.some((anchor) => anchor?.dateKey === row?.dateKey) ? 0 : 0.5) +
        (anchors.some((anchor) => (anchor?.monthKey ?? buildMonthKey(anchor?.dateKey)) === (row?.monthKey ?? buildMonthKey(row?.dateKey)))
          ? 0
          : 0.4) +
        (anchors.some((anchor) => Number(anchor?.foldId ?? 0) === Number(row?.foldId ?? 0)) ? 0 : 0.6)
      if (diversityScore > bestDistance) {
        bestDistance = diversityScore
        bestRow = row
      }
    }
    if (!bestRow) break
    anchors.push(bestRow)
  }
  return anchors
}

export const buildPerfectPrototypeSupportAtlasAnchorCover = ({
  cellId,
  positiveRows = [],
  negativeRows = [],
  featureKeys = [],
  featureScales = {},
  maxPositiveAnchors = 6,
  maxNegativeAnchors = 6,
} = {}) => {
  const positiveSummary = summarizeRows(positiveRows)
  const negativeSummary = summarizeRows(negativeRows)
  const positivePrototype = buildPerfectPrototypeSupportAtlasPrototype({
    rows: positiveRows,
    featureKeys,
  })
  const negativePrototype = buildPerfectPrototypeSupportAtlasPrototype({
    rows: negativeRows,
    featureKeys,
  })
  const featureWeights = buildPerfectPrototypeSupportAtlasFeatureWeights({
    positivePrototype,
    negativePrototype,
    featureKeys,
    featureScales,
  })
  const positiveAnchors = selectDiverseAnchors({
    rows: positiveRows,
    featureKeys,
    featureScales,
    maxAnchors: maxPositiveAnchors,
  })
  const negativeBorderAnchors = (Array.isArray(negativeRows) ? negativeRows : [])
    .map((row) => ({
      row,
      distance: scorePerfectPrototypeSupportAtlasPrototype({
        row,
        prototype: positivePrototype,
        featureKeys,
        featureScales,
        featureWeights,
      }),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(1, Math.min(Math.floor(Number(maxNegativeAnchors) || 6), negativeRows.length)))
    .map((entry) => entry.row)

  return {
    cellId,
    positiveRows,
    negativePool: negativeRows,
    positiveSummary,
    negativeSummary,
    positivePrototype,
    negativePrototype,
    featureWeights,
    positiveAnchors,
    negativeBorderAnchors,
    kPositive: Math.max(1, Math.min(3, positiveAnchors.length)),
    minPositiveVotes: Math.max(1, Math.min(2, positiveAnchors.length)),
    anchorCoverageSummary: summarizeRows(positiveAnchors),
    negativeBorderSummary: summarizeRows(negativeBorderAnchors),
  }
}
