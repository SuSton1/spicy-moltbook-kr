import {
  buildPerfectPrototypeSupportAtlasFeatureWeights,
  buildPerfectPrototypeSupportAtlasPrototype,
  scorePerfectPrototypeSupportAtlasPrototype,
  scorePerfectPrototypeSupportAtlasCell,
} from "./perfect_prototype_support_atlas_metric.mjs"
import { buildPerfectPrototypeSupportAtlasAnchorCover } from "./perfect_prototype_support_atlas_anchor_cover.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const compareCellCandidates = (left, right) => {
  if (toNumber(right?.cellScore, 0) !== toNumber(left?.cellScore, 0)) {
    return toNumber(right?.cellScore, 0) - toNumber(left?.cellScore, 0)
  }
  if (
    toNumber(right?.positiveSummary?.matchedDateCount, 0) !==
    toNumber(left?.positiveSummary?.matchedDateCount, 0)
  ) {
    return (
      toNumber(right?.positiveSummary?.matchedDateCount, 0) -
      toNumber(left?.positiveSummary?.matchedDateCount, 0)
    )
  }
  return String(left?.cellId ?? "").localeCompare(String(right?.cellId ?? ""))
}

const buildSupportCentroidPrototype = (dataset) => {
  const supportFitViews = Array.isArray(dataset?.supportFitViews) ? dataset.supportFitViews : []
  if (supportFitViews.length > 0) {
    return buildPerfectPrototypeSupportAtlasPrototype({
      rows: supportFitViews,
      featureKeys: dataset?.featureKeys ?? [],
    })
  }
  const supportCaseViews = Array.isArray(dataset?.supportCaseViews) ? dataset.supportCaseViews : []
  if (supportCaseViews.length > 0) {
    return buildPerfectPrototypeSupportAtlasPrototype({
      rows: supportCaseViews,
      featureKeys: dataset?.featureKeys ?? [],
    })
  }
  const positiveRows = Array.isArray(dataset?.calibrationPositiveRows) ? dataset.calibrationPositiveRows : []
  return buildPerfectPrototypeSupportAtlasPrototype({
    rows: positiveRows.slice(0, Math.min(16, positiveRows.length)),
    featureKeys: dataset?.featureKeys ?? [],
  })
}

const selectSeedRows = ({ dataset, positiveRows = [], maxCells = 4 } = {}) => {
  if (positiveRows.length < 1) return []
  const featureKeys = dataset?.featureKeys ?? []
  const featureScales = dataset?.featureScales ?? {}
  const supportCentroid = buildSupportCentroidPrototype(dataset)
  const seeds = []
  const pickedKeys = new Set()

  let firstSeed = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const row of positiveRows) {
    const distance = scorePerfectPrototypeSupportAtlasPrototype({
      row,
      prototype: supportCentroid,
      featureKeys,
      featureScales,
    })
    if (distance < bestDistance) {
      bestDistance = distance
      firstSeed = row
    }
  }
  if (firstSeed) {
    seeds.push(firstSeed)
    pickedKeys.add(firstSeed.rowKey)
  }
  while (seeds.length < Math.min(Math.max(1, maxCells), positiveRows.length)) {
    let nextSeed = null
    let nextDistance = Number.NEGATIVE_INFINITY
    for (const row of positiveRows) {
      if (pickedKeys.has(row.rowKey)) continue
      let minDistance = Number.POSITIVE_INFINITY
      for (const seed of seeds) {
        const seedPrototype = buildPerfectPrototypeSupportAtlasPrototype({
          rows: [seed],
          featureKeys,
        })
        const distance = scorePerfectPrototypeSupportAtlasPrototype({
          row,
          prototype: seedPrototype,
          featureKeys,
          featureScales,
        })
        if (distance < minDistance) minDistance = distance
      }
      if (minDistance > nextDistance) {
        nextDistance = minDistance
        nextSeed = row
      }
    }
    if (!nextSeed) break
    seeds.push(nextSeed)
    pickedKeys.add(nextSeed.rowKey)
  }
  return seeds
}

export const buildPerfectPrototypeSupportAtlasCandidateSpace = ({
  dataset,
  maxCells = 4,
  minCellRows = 6,
  minCellDates = 4,
  minNegativeRows = 8,
} = {}) => {
  const positiveRows =
    Array.isArray(dataset?.liftedBridgePositiveRows) && dataset.liftedBridgePositiveRows.length > 0
      ? dataset.liftedBridgePositiveRows
      : Array.isArray(dataset?.bridgePositiveRows) && dataset.bridgePositiveRows.length > 0
        ? dataset.bridgePositiveRows
      : Array.isArray(dataset?.calibrationPositiveRows)
        ? dataset.calibrationPositiveRows
        : []
  const negativeRows =
    Array.isArray(dataset?.liftedBridgeNegativeRows) && dataset.liftedBridgeNegativeRows.length > 0
      ? dataset.liftedBridgeNegativeRows
      : Array.isArray(dataset?.bridgeNegativeRows) && dataset.bridgeNegativeRows.length > 0
        ? dataset.bridgeNegativeRows
      : Array.isArray(dataset?.calibrationNegativeRows)
        ? dataset.calibrationNegativeRows
        : []
  const featureKeys = Array.isArray(dataset?.featureKeys) ? dataset.featureKeys : []
  const featureScales = dataset?.featureScales ?? {}
  if (positiveRows.length < 1 || featureKeys.length < 1) {
    return {
      cellCandidates: [],
      summary: {
        atlasCellCandidateCount: 0,
        atlasQualifiedCellCount: 0,
      },
    }
  }

  const uniqueDateCount = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const targetCellCount = Math.min(
    Math.max(1, Math.floor(Number(maxCells) || 4)),
    Math.max(1, Math.min(positiveRows.length, Math.round(uniqueDateCount / 45) + 1)),
  )
  const seeds = selectSeedRows({
    dataset,
    positiveRows,
    maxCells: Math.max(2, targetCellCount),
  })
  const provisionalCells = seeds.map((seed, index) => ({
    cellId: `ATLAS_CELL_${String(index + 1).padStart(2, "0")}`,
    seedRowKey: seed?.rowKey ?? null,
    seedSymbol: seed?.symbol ?? null,
    seedDateKey: seed?.dateKey ?? null,
    positiveRows: [],
  }))

  for (const row of positiveRows) {
    let bestCell = provisionalCells[0] ?? null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const cell of provisionalCells) {
      const seedRow = seeds.find((entry) => entry.rowKey === cell.seedRowKey)
      if (!seedRow) continue
      const distance = scorePerfectPrototypeSupportAtlasPrototype({
        row,
        prototype: buildPerfectPrototypeSupportAtlasPrototype({
          rows: [seedRow],
          featureKeys,
        }),
        featureKeys,
        featureScales,
      })
      if (distance < bestDistance) {
        bestDistance = distance
        bestCell = cell
      }
    }
    if (bestCell) bestCell.positiveRows.push(row)
  }

  const cellCandidates = provisionalCells
    .map((cell) => {
      const positiveSummary = summarizeRows(cell.positiveRows)
      if (
        positiveSummary.rowCount < Math.max(2, Math.floor(Number(minCellRows) || 6)) ||
        positiveSummary.matchedDateCount < Math.max(2, Math.floor(Number(minCellDates) || 4))
      ) {
        return null
      }
      const positivePrototype = buildPerfectPrototypeSupportAtlasPrototype({
        rows: cell.positiveRows,
        featureKeys,
      })
      const negativePoolTarget = Math.min(
        negativeRows.length,
        Math.max(Math.floor(Number(minNegativeRows) || 8), Math.ceil(cell.positiveRows.length * 0.75)),
      )
      const negativePool = negativeRows
        .map((row) => ({
          row,
          distance: scorePerfectPrototypeSupportAtlasPrototype({
            row,
            prototype: positivePrototype,
            featureKeys,
            featureScales,
          }),
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, Math.max(1, negativePoolTarget))
        .map((entry) => entry.row)
      const negativePrototype = buildPerfectPrototypeSupportAtlasPrototype({
        rows: negativePool,
        featureKeys,
      })
      const anchorCover = buildPerfectPrototypeSupportAtlasAnchorCover({
        cellId: cell.cellId,
        positiveRows: cell.positiveRows,
        negativeRows: negativePool,
        featureKeys,
        featureScales,
      })
      const featureWeights = buildPerfectPrototypeSupportAtlasFeatureWeights({
        positivePrototype,
        negativePrototype,
        featureKeys,
        featureScales,
      })
      const supportCaseEvaluations = (dataset?.supportCaseViews ?? []).map((row) =>
        scorePerfectPrototypeSupportAtlasCell({
          row,
          cell: {
            ...anchorCover,
            positivePrototype,
            negativePrototype,
            featureWeights: anchorCover.featureWeights ?? featureWeights,
          },
          dataset,
        }),
      )
      const supportCaseMarginMean =
        supportCaseEvaluations.reduce((sum, entry) => sum + toNumber(entry?.margin, 0), 0) /
        Math.max(1, supportCaseEvaluations.length)
      const supportCasePosDistanceMean =
        supportCaseEvaluations.reduce((sum, entry) => sum + toNumber(entry?.posDistance, 0), 0) /
        Math.max(1, supportCaseEvaluations.length)
      const cellScore =
        positiveSummary.matchedDateCount * 10 +
        positiveSummary.matchedMonthCount * 6 +
        positiveSummary.matchedFoldCount * 30 +
        supportCaseMarginMean * 18 -
        supportCasePosDistanceMean * 12
      return {
        cellId: cell.cellId,
        seedRowKey: cell.seedRowKey,
        seedSymbol: cell.seedSymbol,
        seedDateKey: cell.seedDateKey,
        positiveRows: cell.positiveRows,
        positiveSummary,
        negativePool,
        negativeSummary: summarizeRows(negativePool),
        positivePrototype,
        negativePrototype,
        featureWeights: anchorCover.featureWeights ?? featureWeights,
        positiveAnchors: anchorCover.positiveAnchors,
        negativeBorderAnchors: anchorCover.negativeBorderAnchors,
        kPositive: anchorCover.kPositive,
        minPositiveVotes: anchorCover.minPositiveVotes,
        anchorCoverageSummary: anchorCover.anchorCoverageSummary,
        negativeBorderSummary: anchorCover.negativeBorderSummary,
        supportCaseEvaluations,
        supportCaseMarginMean,
        supportCasePosDistanceMean,
        cellScore,
      }
    })
    .filter(Boolean)
    .sort(compareCellCandidates)

  return {
    cellCandidates,
    summary: {
      atlasCellCandidateCount: provisionalCells.length,
      atlasQualifiedCellCount: cellCandidates.length,
      atlasTargetCellCount: targetCellCount,
      atlasPositiveSupportMarginCellCount: cellCandidates.filter(
        (cell) => toNumber(cell?.supportCaseMarginMean, Number.NEGATIVE_INFINITY) > 0,
      ).length,
      atlasAnchorSetCount: cellCandidates.reduce(
        (sum, cell) => sum + (Array.isArray(cell?.positiveAnchors) ? cell.positiveAnchors.length : 0),
        0,
      ),
      atlasAnchorCoverageDateCount: Math.max(
        0,
        ...cellCandidates.map((cell) => toNumber(cell?.anchorCoverageSummary?.matchedDateCount, 0)),
      ),
      atlasAnchorCoverageMonthCount: Math.max(
        0,
        ...cellCandidates.map((cell) => toNumber(cell?.anchorCoverageSummary?.matchedMonthCount, 0)),
      ),
      atlasAnchorCoverageFoldCount: Math.max(
        0,
        ...cellCandidates.map((cell) => toNumber(cell?.anchorCoverageSummary?.matchedFoldCount, 0)),
      ),
      atlasBestTrainBreadthBeforeThreshold:
        cellCandidates.length > 0
          ? {
              matchedDateCount: Math.max(
                ...cellCandidates.map((cell) => toNumber(cell?.positiveSummary?.matchedDateCount, 0)),
              ),
              matchedMonthCount: Math.max(
                ...cellCandidates.map((cell) => toNumber(cell?.positiveSummary?.matchedMonthCount, 0)),
              ),
              matchedFoldCount: Math.max(
                ...cellCandidates.map((cell) => toNumber(cell?.positiveSummary?.matchedFoldCount, 0)),
              ),
            }
          : {},
      bridgeCompanionAcceptedCount: toNumber(
        dataset?.summary?.bridgeCompanionAcceptedCount,
        0,
      ),
      bridgeCompanionRejectReasonCounts: dataset?.summary?.bridgeCompanionRejectReasonCounts ?? {},
      bridgeLiftedPositiveSummary: dataset?.summary?.bridgeLiftedPositiveSummary ?? {},
      bridgeLiftedNegativeSummary: dataset?.summary?.bridgeLiftedNegativeSummary ?? {},
      atlasPositiveSource:
        Array.isArray(dataset?.liftedBridgePositiveRows) && dataset.liftedBridgePositiveRows.length > 0
          ? "lifted_bridge_positive_rows"
          : Array.isArray(dataset?.bridgePositiveRows) && dataset.bridgePositiveRows.length > 0
            ? "bridge_positive_rows"
          : "calibration_positive_rows",
      atlasNegativeSource:
        Array.isArray(dataset?.liftedBridgeNegativeRows) && dataset.liftedBridgeNegativeRows.length > 0
          ? "lifted_bridge_negative_rows"
          : Array.isArray(dataset?.bridgeNegativeRows) && dataset.bridgeNegativeRows.length > 0
            ? "bridge_negative_rows"
            : "calibration_negative_rows",
      supportFitExcluded: dataset?.supportFitExcluded === true,
      supportLeaveOneOutRecovered: dataset?.summary?.supportLeaveOneOutRecovered === true,
    },
  }
}
