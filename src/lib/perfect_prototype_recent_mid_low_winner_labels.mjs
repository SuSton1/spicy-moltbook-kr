const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

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

const WINNER_POSITIVE_AXES = [
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.temporalEpisode.currentPositiveShare",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.complementPocketAffinity",
  "sig.roleTopo.roleCohesion",
]

const WINNER_NEGATIVE_AXES = [
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleUncertainty",
]

const winnerBaseScore = (row) => {
  const positive = average(WINNER_POSITIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  const negative = average(WINNER_NEGATIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  return positive - negative
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

export const buildPerfectPrototypeRecentMidLowWinnerLabels = ({
  family,
  negativePoolPerDate = 2,
} = {}) => {
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const winnerPositiveRows = []
  const winnerNegativeRows = []
  const queryPositiveDateKeys = []
  const queryNegativeDateKeys = []
  let sameDateRunnerUpNegativeCount = 0

  for (const [dateKey, rows] of byDate.entries()) {
    const positives = rows.filter((row) => row?.outcomeHitTarget === true)
    const negatives = rows.filter((row) => row?.outcomeHitTarget !== true)
    const sortedPositive = positives
      .map((row) => ({ row, score: winnerBaseScore(row) }))
      .sort((left, right) => right.score - left.score || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))
    const sortedNegative = negatives
      .map((row) => ({ row, score: winnerBaseScore(row) }))
      .sort((left, right) => right.score - left.score || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))

    if (sortedPositive.length > 0) {
      winnerPositiveRows.push(sortedPositive[0].row)
      queryPositiveDateKeys.push(dateKey)
      const runnerUps = sortedNegative.slice(0, Math.max(1, Math.floor(Number(negativePoolPerDate) || 2))).map((entry) => entry.row)
      winnerNegativeRows.push(...runnerUps)
      sameDateRunnerUpNegativeCount += runnerUps.length
      continue
    }

    queryNegativeDateKeys.push(dateKey)
    winnerNegativeRows.push(
      ...sortedNegative.slice(0, Math.max(1, Math.floor(Number(negativePoolPerDate) || 2))).map((entry) => entry.row),
    )
  }

  const ok = winnerPositiveRows.length > 0 && winnerNegativeRows.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_recent_mid_low_winner_labels",
    bridgePositiveRows: winnerPositiveRows,
    supportNearHardNegativeRows: winnerNegativeRows,
    winnerPositiveRows,
    winnerNegativeRows,
    queryPositiveDateKeys,
    queryNegativeDateKeys,
    summary: {
      ...(family?.summary ?? {}),
      winnerLabelReady: ok,
      winnerPositiveSummary: summarizeRows(winnerPositiveRows),
      winnerNegativeSummary: summarizeRows(winnerNegativeRows),
      winnerPositiveDateCount: queryPositiveDateKeys.length,
      winnerNegativeDateCount: queryNegativeDateKeys.length,
      sameDateRunnerUpNegativeCount,
    },
  }
}
