const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

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

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const QUERY_SUMMARY_AXES = [
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.roleCohesion",
  "sig.roleTopo.complementPocketAffinity",
]

const buildQuerySummaries = ({ rows = [], positiveDateKeys = new Set(), negativeDateKeys = new Set() } = {}) => {
  const byDate = groupRowsByDate(rows)
  const summaries = []
  for (const [dateKey, bucket] of byDate.entries()) {
    const monthKey = buildMonthKey(dateKey)
    const foldIds = Array.from(
      new Set(bucket.map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0)),
    ).sort((left, right) => left - right)
    const queryLabel = positiveDateKeys.has(dateKey) ? "positive" : negativeDateKeys.has(dateKey) ? "negative" : "unlabeled"
    const summary = {
      queryId: dateKey,
      dateKey,
      monthKey,
      foldIds,
      queryLabel,
      rowCount: bucket.length,
      positiveRowCount: bucket.filter((row) => row?.outcomeHitTarget === true).length,
      roleSignatures: uniqueStrings(bucket.map((row) => row?.roleTopologySignature)),
      axisMeans: Object.fromEntries(
        QUERY_SUMMARY_AXES.map((featureKey) => [
          featureKey,
          average(bucket.map((row) => row?.numericFeatureMap?.[featureKey])),
        ]),
      ),
    }
    summaries.push(summary)
  }
  summaries.sort((left, right) => left.dateKey.localeCompare(right.dateKey))
  return summaries
}

const annotateRowsWithQuery = ({ rows = [], queryLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const dateKey = String(row?.dateKey ?? "").trim()
    const query = queryLookup.get(dateKey) ?? {
      queryId: dateKey,
      queryLabel: "unlabeled",
      rowCount: 0,
      positiveRowCount: 0,
      roleSignatures: [],
      foldIds: [],
    }
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    numericFeatureMap["sig.query.rowCount"] = Number(query.rowCount ?? 0)
    numericFeatureMap["sig.query.positiveRowCount"] = Number(query.positiveRowCount ?? 0)
    numericFeatureMap["sig.query.positiveRowShare"] =
      Number(query.rowCount ?? 0) > 0 ? Number(query.positiveRowCount ?? 0) / Number(query.rowCount ?? 1) : 0
    numericFeatureMap["sig.query.roleSignatureCount"] = Number((query.roleSignatures ?? []).length)
    numericFeatureMap["sig.query.foldSpan"] = Number((query.foldIds ?? []).length)
    row.queryId = query.queryId
    row.queryLabel = query.queryLabel
    row.queryRowCount = query.rowCount
    row.numericFeatureMap = numericFeatureMap
    return row
  })

const collectQueryFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.query.")),
    ),
  )

export const buildPerfectPrototypeSupportDateQueryDataset = ({ family } = {}) => {
  const positiveDateKeys = new Set((family?.bridgePositiveRows ?? []).map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean))
  const negativeDateKeys = new Set(
    (family?.supportNearHardNegativeRows ?? []).map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean),
  )

  const trainQuerySummaries = buildQuerySummaries({
    rows: family?.gatedTrainRows ?? [],
    positiveDateKeys,
    negativeDateKeys,
  })
  const oosQuerySummaries = buildQuerySummaries({
    rows: family?.oosRows ?? [],
    positiveDateKeys: new Set(),
    negativeDateKeys: new Set(),
  })
  const supportQuerySummaries = buildQuerySummaries({
    rows: family?.supportCaseViews ?? [],
    positiveDateKeys: new Set(),
    negativeDateKeys: new Set(),
  })

  const trainQueryLookup = new Map(trainQuerySummaries.map((summary) => [summary.queryId, summary]))
  const oosQueryLookup = new Map(oosQuerySummaries.map((summary) => [summary.queryId, summary]))
  const supportQueryLookup = new Map(supportQuerySummaries.map((summary) => [summary.queryId, summary]))

  const trainRows = annotateRowsWithQuery({ rows: family?.trainRows ?? [], queryLookup: trainQueryLookup })
  const gatedTrainRows = annotateRowsWithQuery({ rows: family?.gatedTrainRows ?? [], queryLookup: trainQueryLookup })
  const oosRows = annotateRowsWithQuery({ rows: family?.oosRows ?? [], queryLookup: oosQueryLookup })
  const supportCaseViews = annotateRowsWithQuery({ rows: family?.supportCaseViews ?? [], queryLookup: supportQueryLookup })

  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )

  const queryFeatureKeys = collectQueryFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  return {
    ...family,
    ok: trainQuerySummaries.length > 0,
    reason: trainQuerySummaries.length > 0 ? null : "unsat_no_date_queries",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    trainQuerySummaries,
    oosQuerySummaries,
    supportQuerySummaries,
    queryFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      dateQueryReady: trainQuerySummaries.length > 0,
      trainQueryCount: trainQuerySummaries.length,
      positiveQueryCount: trainQuerySummaries.filter((entry) => entry.queryLabel === "positive").length,
      negativeQueryCount: trainQuerySummaries.filter((entry) => entry.queryLabel === "negative").length,
      supportQueryCount: supportQuerySummaries.length,
      queryFeatureCount: queryFeatureKeys.length,
      queryPositiveSummary: summarizeRows(bridgePositiveRows),
      queryNegativeSummary: summarizeRows(supportNearHardNegativeRows),
    },
  }
}
