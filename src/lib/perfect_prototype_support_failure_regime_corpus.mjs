const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
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

export const buildPerfectPrototypeSupportFailureRegimeCorpus = ({ family } = {}) => {
  const positiveRows = uniqueRowsByKey(
    (family?.bridgePositiveRows ?? []).length > 0
      ? family?.bridgePositiveRows ?? []
      : (family?.gatedTrainRows ?? []).filter((row) => row?.outcomeHitTarget === true),
  )
  const sameDateRunnerUpRows = family?.winnerNegativeRows ?? []
  const trainNegativeRows = (family?.gatedTrainRows ?? []).filter((row) => row?.outcomeHitTarget !== true)
  const hardNegativeRows = uniqueRowsByKey([
    ...(family?.supportNearHardNegativeRows ?? []),
    ...sameDateRunnerUpRows,
    ...trainNegativeRows,
  ])
  const matchedControlNegativeRows = hardNegativeRows.filter(
    (row) => Array.isArray(row?.matchedControlQueryIds) && row.matchedControlQueryIds.length > 0,
  )
  const ok = positiveRows.length > 0 && hardNegativeRows.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_failure_regime_corpus",
    failureRegimePositiveRows: positiveRows,
    failureRegimeNegativeRows: hardNegativeRows,
    failureRegimeSameDateRunnerUpRows: uniqueRowsByKey(sameDateRunnerUpRows),
    failureRegimeMatchedControlNegativeRows: matchedControlNegativeRows,
    summary: {
      ...(family?.summary ?? {}),
      failureRegimeCorpusReady: ok,
      failureRegimePositiveSummary: summarizeRows(positiveRows),
      failureRegimeNegativeSummary: summarizeRows(hardNegativeRows),
      failureRegimeSameDateRunnerUpSummary: summarizeRows(sameDateRunnerUpRows),
      failureRegimeMatchedControlSummary: summarizeRows(matchedControlNegativeRows),
    },
  }
}
