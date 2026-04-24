const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const safeDiv = (left, right, fallback = 0) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return fallback
  return l / r
}

const countMapMaxShare = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)
  if (filtered.length < 1) return 0
  const counts = new Map()
  for (const value of filtered) {
    counts.set(value, Number(counts.get(value) ?? 0) + 1)
  }
  return Math.max(...counts.values()) / filtered.length
}

const dedupeRows = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = `${row?.dateKey ?? ""}::${row?.symbol ?? ""}::${row?.rowKey ?? ""}`
    if (!key.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

const buildBoundaryVectorKeys = (groupStats = []) =>
  uniqueStrings(
    (Array.isArray(groupStats) ? groupStats : []).flatMap((groupStat) => [
      `sig.boundary.group.${groupStat.group}.residualMargin`,
      `sig.boundary.group.${groupStat.group}.localBoundaryMargin`,
    ]),
  )

const distanceBetweenRows = ({
  left,
  right,
  vectorKeys = [],
} = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(vectorKeys) ? vectorKeys : []) {
    const leftValue = num(left?.numericFeatureMap?.[featureKey])
    const rightValue = num(right?.numericFeatureMap?.[featureKey])
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue
    total += Math.abs(leftValue - rightValue)
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const buildDominantGroup = ({
  row,
  groupStats = [],
} = {}) => {
  let bestGroup = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const groupStat of Array.isArray(groupStats) ? groupStats : []) {
    const featureKey = `sig.boundary.group.${groupStat.group}.residualMargin`
    const value = num(row?.numericFeatureMap?.[featureKey])
    if (!Number.isFinite(value)) continue
    if (value > bestScore) {
      bestScore = value
      bestGroup = groupStat.group
    }
  }
  return {
    dominantGroup: bestGroup,
    dominantGroupScore: Number.isFinite(bestScore) ? bestScore : null,
  }
}

const pickNearestRows = ({
  row,
  rows = [],
  vectorKeys = [],
  limit = 12,
  preferredGroup = null,
} = {}) => {
  const safeRows = dedupeRows(Array.isArray(rows) ? rows : [])
    .filter((candidate) => candidate?.rowKey !== row?.rowKey)
  const scored = safeRows.map((candidate) => ({
    row: candidate,
    distance: distanceBetweenRows({
      left: row,
      right: candidate,
      vectorKeys,
    }),
  }))
  const preferred = []
  const fallback = []
  for (const entry of scored) {
    if (!Number.isFinite(entry.distance)) continue
    if (preferredGroup && candidateGroupOf(entry.row) === preferredGroup) preferred.push(entry)
    else fallback.push(entry)
  }
  preferred.sort((left, right) => left.distance - right.distance)
  fallback.sort((left, right) => left.distance - right.distance)
  return [...preferred, ...fallback].slice(0, Math.max(1, Math.floor(Number(limit) || 12)))
}

const candidateGroupOf = (row) => String(row?.recurBoundaryDominantGroup ?? row?.dominantGroup ?? "").trim() || null

const buildNeighborMetrics = ({
  row,
  positiveNeighbors = [],
  negativeNeighbors = [],
  groupIds = [],
} = {}) => {
  const posRows = positiveNeighbors.map((entry) => entry.row)
  const negRows = negativeNeighbors.map((entry) => entry.row)
  const nearestPosDistance = Number(positiveNeighbors[0]?.distance ?? Number.POSITIVE_INFINITY)
  const nearestNegDistance = Number(negativeNeighbors[0]?.distance ?? Number.POSITIVE_INFINITY)
  const localRecoveryMargin =
    Number.isFinite(nearestPosDistance) && Number.isFinite(nearestNegDistance)
      ? nearestNegDistance - nearestPosDistance
      : null

  const posDateBreadth = safeDiv(new Set(posRows.map((entry) => entry?.dateKey).filter(Boolean)).size, Math.max(1, posRows.length))
  const posMonthBreadth = safeDiv(
    new Set(posRows.map((entry) => entry?.monthKey).filter(Boolean)).size,
    Math.max(1, Math.min(6, posRows.length)),
  )
  const posFoldBreadth = safeDiv(
    new Set(posRows.map((entry) => Number(entry?.foldId ?? 0)).filter((value) => value > 0)).size,
    4,
  )
  const posWindowBreadth = safeDiv(
    new Set(posRows.map((entry) => Number(entry?.windowId ?? 0)).filter((value) => value > 0)).size,
    Math.max(1, Math.min(6, posRows.length)),
  )

  const negLeakShare = negativeNeighbors.length < 1 || !Number.isFinite(nearestPosDistance)
    ? 0
    : negativeNeighbors.filter((entry) => Number(entry.distance) <= nearestPosDistance * 1.15).length / negativeNeighbors.length
  const negDateConcentration = countMapMaxShare(negRows.map((entry) => entry?.dateKey))
  const negMonthConcentration = countMapMaxShare(negRows.map((entry) => entry?.monthKey))
  const negWindowLeak = countMapMaxShare(
    negRows.map((entry) => {
      const windowId = Number(entry?.windowId ?? 0)
      return windowId > 0 ? `W${windowId}` : null
    }),
  )

  const localBreadthPurityGap =
    posDateBreadth +
    posMonthBreadth +
    posFoldBreadth +
    posWindowBreadth +
    Math.max(0, Number(localRecoveryMargin ?? 0)) -
    negLeakShare -
    negDateConcentration * 0.5 -
    negMonthConcentration * 0.25 -
    negWindowLeak * 0.25
  const localWindowStabilityGap = posWindowBreadth - negWindowLeak
  const localFoldPersistenceGap = posFoldBreadth - Math.max(negDateConcentration, negMonthConcentration)
  const crossfitRecoveryShare = clamp((posWindowBreadth + posFoldBreadth) / 2, 0, 1)
  const crossfitLeakShare = clamp((negLeakShare + negWindowLeak) / 2, 0, 1)

  const groupFeatureMap = {}
  for (const groupId of Array.isArray(groupIds) ? groupIds : []) {
    const featureKey = `sig.boundary.group.${groupId}.residualMargin`
    const posValues = posRows.map((entry) => num(entry?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    const negValues = negRows.map((entry) => num(entry?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const posMean = average(posValues)
    const negMean = average(negValues)
    const neighborMargin =
      Number.isFinite(rowValue) && Number.isFinite(posMean) ? rowValue - posMean : null
    const neighborPurityGap =
      Number.isFinite(posMean) && Number.isFinite(negMean) ? posMean - negMean : null
    const neighborBreadthCarry =
      Number.isFinite(neighborPurityGap)
        ? neighborPurityGap * (posDateBreadth + posMonthBreadth + posFoldBreadth) / 3
        : null
    if (Number.isFinite(num(neighborMargin))) {
      groupFeatureMap[`sig.recurBoundary.group.${groupId}.neighborMargin`] = neighborMargin
    }
    if (Number.isFinite(num(neighborPurityGap))) {
      groupFeatureMap[`sig.recurBoundary.group.${groupId}.neighborPurityGap`] = neighborPurityGap
    }
    if (Number.isFinite(num(neighborBreadthCarry))) {
      groupFeatureMap[`sig.recurBoundary.group.${groupId}.neighborBreadthCarry`] = neighborBreadthCarry
    }
  }

  return {
    numericFeatureMap: {
      "sig.recurBoundary.posNeighborDateBreadth": posDateBreadth,
      "sig.recurBoundary.posNeighborMonthBreadth": posMonthBreadth,
      "sig.recurBoundary.posNeighborFoldBreadth": posFoldBreadth,
      "sig.recurBoundary.posNeighborWindowBreadth": posWindowBreadth,
      "sig.recurBoundary.negNeighborLeakShare": negLeakShare,
      "sig.recurBoundary.negNeighborDateConcentration": negDateConcentration,
      "sig.recurBoundary.negNeighborMonthConcentration": negMonthConcentration,
      "sig.recurBoundary.negNeighborWindowLeak": negWindowLeak,
      "sig.recurBoundary.localBreadthPurityGap": localBreadthPurityGap,
      "sig.recurBoundary.localWindowStabilityGap": localWindowStabilityGap,
      "sig.recurBoundary.localFoldPersistenceGap": localFoldPersistenceGap,
      "sig.recurBoundary.localRecoveryMargin": localRecoveryMargin,
      "sig.recurBoundary.crossfitRecoveryShare": crossfitRecoveryShare,
      "sig.recurBoundary.crossfitLeakShare": crossfitLeakShare,
      ...groupFeatureMap,
    },
    categoricalTokens: [
      `sig:recurBoundary.recovery:${Number(localRecoveryMargin ?? 0) >= 0 ? "POS" : "NEG"}`,
      `sig:recurBoundary.purity:${Number(localBreadthPurityGap ?? 0) >= 1 ? "HIGH" : Number(localBreadthPurityGap ?? 0) >= 0 ? "MID" : "LOW"}`,
    ],
  }
}

const collectRecurrenceFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.recurBoundary.")),
    ),
  )

export const buildPerfectPrototypeSupportRecurrencePurityFamily = ({
  cohort,
  positiveNeighborCount = 12,
  negativeNeighborCount = 12,
} = {}) => {
  const groupStats = Array.isArray(cohort?.boundaryResidualGroupStats) ? cohort.boundaryResidualGroupStats : []
  const groupIds = uniqueStrings(groupStats.map((entry) => entry?.group))
  if (!Array.isArray(cohort?.bridgePositiveRows) || cohort.bridgePositiveRows.length < 1 || groupIds.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_boundary_residual_not_separable",
      recurrencePurityFeatureKeys: [],
      recurrencePurityGroupIds: [],
      summary: {
        ...(cohort?.summary ?? {}),
        recurrencePurityReady: false,
        recurrencePurityReason: "unsat_boundary_residual_not_separable",
        recurrencePurityFeatureCount: 0,
        recurrencePurityGroupCount: 0,
      },
    }
  }

  const vectorKeys = buildBoundaryVectorKeys(groupStats)
  const bridgePositiveRows = Array.isArray(cohort?.bridgePositiveRows) ? cohort.bridgePositiveRows : []
  const supportNearHardNegativeRows = Array.isArray(cohort?.supportNearHardNegativeRows)
    ? cohort.supportNearHardNegativeRows
    : Array.isArray(cohort?.hardNegativeRows)
      ? cohort.hardNegativeRows
      : []

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const dominant = buildDominantGroup({
        row,
        groupStats,
      })
      const positiveNeighbors = pickNearestRows({
        row,
        rows: bridgePositiveRows,
        vectorKeys,
        preferredGroup: dominant.dominantGroup,
        limit: positiveNeighborCount,
      })
      const negativeNeighbors = pickNearestRows({
        row,
        rows: supportNearHardNegativeRows,
        vectorKeys,
        preferredGroup: dominant.dominantGroup,
        limit: negativeNeighborCount,
      })
      const neighborMetrics = buildNeighborMetrics({
        row,
        positiveNeighbors,
        negativeNeighbors,
        groupIds,
      })
      const dominantGroupToken = dominant.dominantGroup
        ? `sig:recurBoundary.dominantGroup:${dominant.dominantGroup}`
        : "sig:recurBoundary.dominantGroup:NONE"
      return {
        ...row,
        recurBoundaryDominantGroup: dominant.dominantGroup,
        recurBoundaryDominantGroupScore: dominant.dominantGroupScore,
        numericFeatureMap: {
          ...(row?.numericFeatureMap ?? {}),
          ...(neighborMetrics.numericFeatureMap ?? {}),
        },
        categoricalTokens: uniqueStrings([
          ...(row?.categoricalTokens ?? []),
          dominantGroupToken,
          ...(neighborMetrics.categoricalTokens ?? []),
        ]),
        tokenSet: new Set([
          ...(row?.categoricalTokens ?? []),
          dominantGroupToken,
          ...(neighborMetrics.categoricalTokens ?? []),
        ]),
      }
    })

  const trainRows = augmentRows(cohort?.trainRows)
  const gatedTrainRows = augmentRows(cohort?.gatedTrainRows)
  const oosRows = augmentRows(cohort?.oosRows)
  const supportCaseViews = augmentRows(cohort?.supportCaseViews)
  const rowByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const bridgePositiveByKey = new Map(gatedTrainRows.map((row) => [row.rowKey, row]))
  const bridgePositiveRowsAugmented = bridgePositiveRows.map((row) => bridgePositiveByKey.get(row.rowKey) ?? rowByKey.get(row.rowKey) ?? row)
  const supportNearHardNegativeAugmented = supportNearHardNegativeRows.map((row) => bridgePositiveByKey.get(row.rowKey) ?? rowByKey.get(row.rowKey) ?? row)
  const recurrencePurityFeatureKeys = collectRecurrenceFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViews,
  ])
  const supportCaseDominantGroups = uniqueStrings(supportCaseViews.map((row) => row?.recurBoundaryDominantGroup))

  return {
    ...cohort,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows: bridgePositiveRowsAugmented,
    supportNearHardNegativeRows: supportNearHardNegativeAugmented,
    recurrencePurityFeatureKeys,
    recurrencePurityGroupIds: groupIds,
    summary: {
      ...(cohort?.summary ?? {}),
      recurrencePurityReady: true,
      recurrencePurityReason: null,
      recurrencePurityFeatureCount: recurrencePurityFeatureKeys.length,
      recurrencePurityGroupCount: groupIds.length,
      recurrencePurityPositiveSummary: summarizeRows(bridgePositiveRowsAugmented),
      recurrencePurityNegativeSummary: summarizeRows(supportNearHardNegativeAugmented),
      supportCaseDominantGroups,
      supportCaseLocalRecoveryMarginMean: average(
        supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"]),
      ),
    },
  }
}

export { summarizeRows as summarizePerfectPrototypeSupportRecurrencePurityRows }
