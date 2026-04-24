const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
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
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const eventNetRet = (row) =>
  num(row?.eventOutcome?.netRet) ??
  num(row?.numericFeatureMap?.["sig.dailyWinner.eventNetRet"]) ??
  (row?.outcomeHitTarget === true ? 0.01 : -0.01)

const mechanismScore = (row) => {
  const positive = average([
    row?.numericFeatureMap?.["sig.slateJoint.jointRarity"],
    row?.numericFeatureMap?.["sig.sponsor.upStrength"],
    row?.numericFeatureMap?.["sig.stateTrans.releaseQuality"],
    row?.numericFeatureMap?.["sig.phaseDiv.ignitionOnBase"],
    row?.numericFeatureMap?.["sig.liqPath.stability"],
  ]) ?? 0
  const negative = average([
    row?.numericFeatureMap?.["sig.sponsor.fragility"],
    row?.numericFeatureMap?.["sig.stateTrans.failPressure"],
    row?.numericFeatureMap?.["sig.phaseDiv.extensionRisk"],
    row?.numericFeatureMap?.["sig.liqPath.fragility"],
  ]) ?? 0
  return positive - negative
}

export const buildPerfectPrototypeDailyMechanismWinnerLabels = ({
  family,
  negativePoolPerDate = 2,
} = {}) => {
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const canonicalPositiveDateSet = new Set(
    (family?.canonicalPositiveDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
  )
  const winnerPositiveRows = []
  const winnerNegativeRows = []
  const queryPositiveDateKeys = []
  const queryNegativeDateKeys = []
  let sameDateRunnerUpNegativeCount = 0
  let missingPositiveWinnerDateCount = 0

  for (const [dateKey, rows] of byDate.entries()) {
    const positives = rows.filter((row) => row?.outcomeHitTarget === true)
    const sortedPositive = positives
      .map((row) => ({ row, netRet: eventNetRet(row), score: mechanismScore(row) }))
      .sort(
        (left, right) =>
          right.netRet - left.netRet ||
          right.score - left.score ||
          String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")),
      )
    const sortedByMechanism = rows
      .map((row) => ({ row, score: mechanismScore(row), netRet: eventNetRet(row) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.netRet - left.netRet ||
          String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")),
      )
    if (canonicalPositiveDateSet.has(dateKey)) {
      if (sortedPositive.length < 1) {
        missingPositiveWinnerDateCount += 1
        continue
      }
      winnerPositiveRows.push(sortedPositive[0].row)
      queryPositiveDateKeys.push(dateKey)
      const runnerUps = sortedByMechanism
        .filter((entry) => entry.row?.outcomeHitTarget !== true)
        .slice(0, Math.max(1, Math.floor(Number(negativePoolPerDate) || 2)))
        .map((entry) => entry.row)
      winnerNegativeRows.push(...runnerUps)
      sameDateRunnerUpNegativeCount += runnerUps.length
      continue
    }
    queryNegativeDateKeys.push(dateKey)
    winnerNegativeRows.push(
      ...sortedByMechanism
        .slice(0, Math.max(1, Math.floor(Number(negativePoolPerDate) || 2)))
        .map((entry) => entry.row),
    )
  }

  const ok = winnerPositiveRows.length > 0 && winnerNegativeRows.length > 0 && missingPositiveWinnerDateCount === 0
  return {
    ...family,
    ok,
    reason:
      missingPositiveWinnerDateCount > 0
        ? "unsat_missing_mechanism_positive_winners"
        : ok
          ? null
          : "unsat_no_mechanism_winner_labels",
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
      missingPositiveWinnerDateCount,
    },
  }
}
