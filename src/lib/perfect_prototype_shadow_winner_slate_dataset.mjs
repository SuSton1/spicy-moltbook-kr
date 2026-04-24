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

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = toText(row?.rowKey) ?? toText(row?.sourceId) ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push(row)
  }
  return out
}

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

const groupRowsByQuery = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const queryId = toText(row?.queryId) ?? toText(row?.dateKey)
    if (!queryId) continue
    const bucket = grouped.get(queryId) ?? []
    bucket.push(row)
    grouped.set(queryId, bucket)
  }
  return grouped
}

const POSITIVE_AXES = [
  "sig.slateArchetype.selection.winnerSupportResidual",
  "sig.slateArchetype.selection.baseScore",
  "sig.outRank.top1SelectionPotential",
  "sig.outRank.consensusWinShare",
  "sig.outRank.peerGapToRunnerUp",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.ctrlResidual.nearestNegativeGap",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.complementPocketAffinity",
]

const NEGATIVE_AXES = [
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.outRank.negativePeerPressure",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleUncertainty",
]

const shadowWinnerScore = (row) => {
  const positive = average(POSITIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  const negative = average(NEGATIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  return positive - negative
}

const sortRowsByShadowScore = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      row,
      score: shadowWinnerScore(row),
    }))
    .sort((left, right) => right.score - left.score || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))

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
    queryLabel: positiveDateKeys.has(String(row?.dateKey ?? "").trim()) ? "positive" : "negative",
  }))

export const buildPerfectPrototypeShadowWinnerSlateDataset = ({
  family,
  sameDateNegativePoolSize = 2,
  matchedControlNegativePoolSize = 2,
  failureNegativePoolSize = 2,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ...family,
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      summary: {
        ...(family?.summary ?? {}),
        shadowWinnerSlateReady: false,
      },
    }
  }

  const trainRows = Array.isArray(family?.gatedTrainRows) ? family.gatedTrainRows : []
  const trainByDate = groupRowsByDate(trainRows)
  const trainByQuery = groupRowsByQuery(trainRows)
  const winnerPositiveLookup = new Map(
    (family?.winnerPositiveRows ?? []).map((row) => [String(row?.dateKey ?? "").trim(), row]),
  )
  const sameDateNegativeLookup = new Map()
  for (const row of family?.winnerNegativeRows ?? []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    const bucket = sameDateNegativeLookup.get(dateKey) ?? []
    bucket.push(row)
    sameDateNegativeLookup.set(dateKey, bucket)
  }

  const globalFailureNegativePool = sortRowsByShadowScore(
    (family?.supportNearHardNegativeRows ?? []).length > 0
      ? family.supportNearHardNegativeRows
      : trainRows.filter((row) => row?.outcomeHitTarget !== true),
  ).map((entry) => entry.row)

  const calibrationPositiveRows = []
  const sameDateNegativeRows = []
  const matchedControlNegativeRows = []
  const failureNegativeRows = []
  const shadowWinnerSlatePairs = []

  for (const [dateKey, rows] of trainByDate.entries()) {
    const positiveRows = rows.filter((row) => row?.outcomeHitTarget === true)
    if (positiveRows.length < 1) continue
    const canonicalPositive =
      winnerPositiveLookup.get(dateKey) ??
      sortRowsByShadowScore(positiveRows)[0]?.row ??
      positiveRows[0]
    if (!canonicalPositive) continue
    calibrationPositiveRows.push(canonicalPositive)

    const sameDateNegatives = sortRowsByShadowScore(
      (sameDateNegativeLookup.get(dateKey) ?? []).filter((row) => row?.outcomeHitTarget !== true),
    )
      .slice(0, Math.max(1, Math.floor(Number(sameDateNegativePoolSize) || 2)))
      .map((entry) => entry.row)
    sameDateNegativeRows.push(...sameDateNegatives)
    shadowWinnerSlatePairs.push(
      ...buildPairRows({
        positiveRow: canonicalPositive,
        negativeRows: sameDateNegatives,
        pairType: "same_date_runner_up",
      }),
    )

    const matchedControlRows = uniqueRowsByKey(
      uniqueStrings(canonicalPositive?.matchedControlQueryIds ?? [])
        .flatMap((queryId) => trainByQuery.get(queryId) ?? [])
        .filter((row) => row?.outcomeHitTarget !== true && String(row?.dateKey ?? "").trim() !== dateKey),
    )
    const selectedMatchedControlRows = sortRowsByShadowScore(matchedControlRows)
      .slice(0, Math.max(1, Math.floor(Number(matchedControlNegativePoolSize) || 2)))
      .map((entry) => entry.row)
    matchedControlNegativeRows.push(...selectedMatchedControlRows)
    shadowWinnerSlatePairs.push(
      ...buildPairRows({
        positiveRow: canonicalPositive,
        negativeRows: selectedMatchedControlRows,
        pairType: "matched_control_impostor",
      }),
    )

    const excludedNegativeKeys = new Set(
      [
        canonicalPositive?.rowKey,
        ...sameDateNegatives.map((row) => row?.rowKey),
        ...selectedMatchedControlRows.map((row) => row?.rowKey),
      ].filter(Boolean),
    )
    const selectedFailureRows = globalFailureNegativePool
      .filter(
        (row) =>
          row?.outcomeHitTarget !== true &&
          String(row?.dateKey ?? "").trim() !== dateKey &&
          !excludedNegativeKeys.has(row?.rowKey),
      )
      .slice(0, Math.max(1, Math.floor(Number(failureNegativePoolSize) || 2)))
    failureNegativeRows.push(...selectedFailureRows)
    shadowWinnerSlatePairs.push(
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
  const labeledTrainRows = annotateQueryLabels({ rows: family?.trainRows ?? [], positiveDateKeys })
  const labeledGatedTrainRows = annotateQueryLabels({ rows: family?.gatedTrainRows ?? [], positiveDateKeys })
  const ok = uniquePositiveRows.length > 0 && calibrationNegativeRows.length > 0 && shadowWinnerSlatePairs.length > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_shadow_winner_slate_dataset",
    trainRows: labeledTrainRows,
    gatedTrainRows: labeledGatedTrainRows,
    shadowWinnerSlatePositiveRows: uniquePositiveRows,
    shadowWinnerSlateSameDateNegativeRows: uniqueSameDateNegativeRows,
    shadowWinnerSlateMatchedControlNegativeRows: uniqueMatchedControlNegativeRows,
    shadowWinnerSlateFailureNegativeRows: uniqueFailureNegativeRows,
    shadowWinnerSlatePairs,
    calibrationPositiveRows: uniquePositiveRows,
    calibrationNegativeRows,
    summary: {
      ...(family?.summary ?? {}),
      shadowWinnerSlateReady: ok,
      shadowWinnerSlatePositiveSummary: summarizeRows(uniquePositiveRows),
      shadowWinnerSlateSameDateNegativeSummary: summarizeRows(uniqueSameDateNegativeRows),
      shadowWinnerSlateMatchedControlNegativeSummary: summarizeRows(uniqueMatchedControlNegativeRows),
      shadowWinnerSlateFailureNegativeSummary: summarizeRows(uniqueFailureNegativeRows),
      shadowWinnerSlateCalibrationNegativeSummary: summarizeRows(calibrationNegativeRows),
      shadowWinnerSlatePairCount: shadowWinnerSlatePairs.length,
      shadowWinnerSlatePositiveDateCount: positiveDateKeys.size,
      shadowWinnerSlateCalibrationNegativeDateCount: new Set(
        calibrationNegativeRows.map((row) => row?.dateKey).filter(Boolean),
      ).size,
    },
  }
}
