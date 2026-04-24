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
  matchedWindowCount: new Set(
    (rows ?? []).map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0),
  ).size,
})

const collectBasinFeatureKeys = (rows = []) =>
  uniqueStrings(
    [
      "sig.ordinalMotif.motifAgreement",
      "sig.ordinalMotif.negativeMotifConflict",
      "sig.ordinalMotif.recurrenceBreadthCarry",
      "sig.ordinalMotif.recurrenceLeakPressure",
      "sig.ordinalMotif.supportRecoveryPotential",
      "sig.recurBoundary.localBreadthPurityGap",
      "sig.recurBoundary.localRecoveryMargin",
      "sig.recurBoundary.crossfitRecoveryShare",
      "sig.boundary.supportRecoveryPotential",
      "sig.bridge.posNegMargin",
      "sig.bridge.bestPositiveCellMargin",
      ...(Array.isArray(rows) ? rows : []).flatMap((row) =>
        Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.ordinalMotif.group.")),
      ),
    ].filter(Boolean),
  )

const buildPrototype = ({ rows = [], featureKeys = [] } = {}) =>
  Object.fromEntries(
    (Array.isArray(featureKeys) ? featureKeys : [])
      .map((featureKey) => [featureKey, average((rows ?? []).map((row) => row?.numericFeatureMap?.[featureKey]))])
      .filter(([, value]) => Number.isFinite(num(value))),
  )

const distanceToPrototype = ({ row, prototype = {}, featureKeys = [] } = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    total += Math.abs(rowValue - prototypeValue)
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const buildRadius = ({ rows = [], prototype = {}, featureKeys = [] } = {}) => {
  const distances = (Array.isArray(rows) ? rows : [])
    .map((row) => distanceToPrototype({ row, prototype, featureKeys }))
    .filter(Number.isFinite)
  if (distances.length < 1) return 0.5
  return Math.max(0.2, average(distances) ?? 0.5)
}

const supportReachableBasinIds = ({ basins = [], supportCaseViews = [], featureKeys = [] } = {}) =>
  uniqueStrings(
    (Array.isArray(supportCaseViews) ? supportCaseViews : []).flatMap((row) =>
      (Array.isArray(basins) ? basins : [])
        .filter((basin) => {
          if (String(row?.ordinalMotifDominantGroup ?? "").trim() === basin.dominantGroup) return true
          const distance = distanceToPrototype({
            row,
            prototype: basin.prototype,
            featureKeys,
          })
          return Number.isFinite(distance) && distance <= basin.radius * 1.75
        })
        .map((basin) => basin.basinId),
    ),
  )

export const buildPerfectPrototypeSupportCorridorPositiveBasins = ({
  family,
  minBasinDates = 3,
  minBasinMonths = 3,
  minBasinFolds = 2,
} = {}) => {
  const positiveRows = Array.isArray(family?.bridgePositiveRows) ? family.bridgePositiveRows : []
  const basinFeatureKeys = collectBasinFeatureKeys(positiveRows)
  if (positiveRows.length < 1 || basinFeatureKeys.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_corridor_positive_basins",
      corridorPositiveBasins: [],
      corridorPositiveBasinIds: [],
      corridorPositiveEligibleBasinIds: [],
      summary: {
        ...(family?.summary ?? {}),
        corridorPositiveBasinsReady: false,
        corridorPositiveBasinReason: "unsat_no_corridor_positive_basins",
        corridorPositiveBasinCount: 0,
        corridorPositiveEligibleBasinCount: 0,
        supportCaseReachableBasinCount: 0,
      },
    }
  }

  const basinRowsById = new Map()
  for (const row of positiveRows) {
    const groupId =
      String(row?.ordinalMotifDominantGroup ?? "").trim() ||
      String(row?.recurBoundaryDominantGroup ?? "").trim() ||
      String(row?.dominantGroup ?? "").trim() ||
      "GLOBAL"
    if (!basinRowsById.has(groupId)) basinRowsById.set(groupId, [])
    basinRowsById.get(groupId)?.push(row)
  }

  const basins = Array.from(basinRowsById.entries())
    .map(([dominantGroup, rows], index) => {
      const basinId = `CORRIDOR_BASIN_${String(index + 1).padStart(2, "0")}`
      const prototype = buildPrototype({ rows, featureKeys: basinFeatureKeys })
      const summary = summarizeRows(rows)
      return {
        basinId,
        dominantGroup,
        rows,
        prototype,
        radius: buildRadius({ rows, prototype, featureKeys: basinFeatureKeys }),
        summary,
        eligible:
          summary.matchedDateCount >= minBasinDates &&
          summary.matchedMonthCount >= minBasinMonths &&
          summary.matchedFoldCount >= minBasinFolds,
      }
    })
    .sort(
      (left, right) =>
        right.summary.matchedDateCount - left.summary.matchedDateCount ||
        right.summary.matchedMonthCount - left.summary.matchedMonthCount ||
        left.basinId.localeCompare(right.basinId),
    )

  const reachableBasinIds = supportReachableBasinIds({
    basins,
    supportCaseViews: family?.supportCaseViews,
    featureKeys: basinFeatureKeys,
  })

  return {
    ...family,
    ok: basins.length > 0,
    reason: basins.length > 0 ? null : "unsat_no_corridor_positive_basins",
    corridorPositiveBasins: basins,
    corridorPositiveBasinIds: basins.map((basin) => basin.basinId),
    corridorPositiveEligibleBasinIds: basins.filter((basin) => basin.eligible).map((basin) => basin.basinId),
    corridorPositiveBasinFeatureKeys: basinFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      corridorPositiveBasinsReady: basins.length > 0,
      corridorPositiveBasinReason: basins.length > 0 ? null : "unsat_no_corridor_positive_basins",
      corridorPositiveBasinCount: basins.length,
      corridorPositiveEligibleBasinCount: basins.filter((basin) => basin.eligible).length,
      corridorPositiveBasinSummaries: basins.map((basin) => ({
        basinId: basin.basinId,
        dominantGroup: basin.dominantGroup,
        eligible: basin.eligible,
        summary: basin.summary,
      })),
      supportCaseReachableBasinCount: reachableBasinIds.length,
      supportCaseReachableBasinIds: reachableBasinIds,
    },
  }
}
