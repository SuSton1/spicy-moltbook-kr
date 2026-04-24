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

const maxValue = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.max(...filtered)
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
    const dateKey = toText(row?.dateKey)
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const unionTokenSet = (rows = []) => new Set(uniqueStrings((rows ?? []).flatMap((row) => Array.from(row?.tokenSet ?? []))))

const SUMMARY_AXES = [
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.temporalEpisode.currentPositiveShare",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.roleCohesion",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.complementPocketAffinity",
  "sig.outRank.consensusWinShare",
  "sig.outRank.peerGapToRunnerUp",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.ctrlResidual.nearestNegativeGap",
  "sig.dailyWinner.eventNetRet",
]

const buildSummaryFeatureMap = (rows = []) => {
  const featureMap = {
    "sig.tradeAbstain.rowCount": Number(rows.length ?? 0),
    "sig.tradeAbstain.positiveRowCount": Number(rows.filter((row) => row?.outcomeHitTarget === true).length),
    "sig.tradeAbstain.negativeRowCount": Number(rows.filter((row) => row?.outcomeHitTarget !== true).length),
  }
  featureMap["sig.tradeAbstain.positiveRowShare"] =
    featureMap["sig.tradeAbstain.rowCount"] > 0
      ? featureMap["sig.tradeAbstain.positiveRowCount"] / featureMap["sig.tradeAbstain.rowCount"]
      : 0
  for (const featureKey of SUMMARY_AXES) {
    const axisValues = rows.map((row) => row?.numericFeatureMap?.[featureKey])
    const normalizedKey = featureKey.replace(/^sig\./, "").replace(/^feature\./, "").replace(/^global\./, "")
    featureMap[`sig.tradeAbstain.mean.${normalizedKey}`] = average(axisValues) ?? 0
    featureMap[`sig.tradeAbstain.max.${normalizedKey}`] = maxValue(axisValues) ?? 0
  }
  return featureMap
}

const buildDateSummaryRow = ({ dateKey, rows = [], label = "unlabeled" } = {}) => {
  const safeDateKey = toText(dateKey)
  if (!safeDateKey) return null
  const foldIds = uniqueStrings(rows.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0))
  return {
    rowKey: `trade-abstain::${safeDateKey}`,
    sourceId: `trade-abstain::${safeDateKey}`,
    symbol: "__DATE_SLATE__",
    dateKey: safeDateKey,
    monthKey: buildMonthKey(safeDateKey),
    targetDateKey: null,
    outcomeHitTarget: label === "trade",
    foldId: Number(foldIds[0] ?? 0),
    windowId: 0,
    eventOutcome: null,
    numericFeatureMap: buildSummaryFeatureMap(rows),
    categoricalTokens: [label === "trade" ? "tag:tradeAbstain:trade" : label === "abstain" ? "tag:tradeAbstain:abstain" : "tag:tradeAbstain:unlabeled"],
    tokenSet: unionTokenSet(rows),
    queryId: safeDateKey,
    queryLabel: label,
    rawRows: rows,
  }
}

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.tradeAbstain.")),
    ),
  )

export const buildPerfectPrototypeDailyTradeAbstainSlateDataset = ({ family } = {}) => {
  const positiveDateSet = new Set((family?.queryPositiveDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const tradeDateRows = []
  const abstainDateRows = []
  const allDateRows = []

  for (const [dateKey, rows] of byDate.entries()) {
    if (positiveDateSet.has(dateKey)) {
      const summaryRow = buildDateSummaryRow({ dateKey, rows, label: "trade" })
      if (summaryRow) {
        tradeDateRows.push(summaryRow)
        allDateRows.push(summaryRow)
      }
      continue
    }
    if (controlOnlyDateSet.has(dateKey)) {
      const summaryRow = buildDateSummaryRow({ dateKey, rows, label: "abstain" })
      if (summaryRow) {
        abstainDateRows.push(summaryRow)
        allDateRows.push(summaryRow)
      }
    }
  }

  const supportDateRows = groupRowsByDate(family?.supportCaseViews ?? [])
  const supportTradeDateRows = Array.from(supportDateRows.entries())
    .map(([dateKey, rows]) => buildDateSummaryRow({ dateKey, rows, label: "support" }))
    .filter(Boolean)
  const tradeGateFeatureKeys = collectFeatureKeys([...allDateRows, ...supportTradeDateRows])
  const ok = tradeDateRows.length > 0 && abstainDateRows.length > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_trade_abstain_date_rows",
    tradeDateRows,
    abstainDateRows,
    supportTradeDateRows,
    tradeAbstainDateRows: allDateRows,
    tradeGateFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      tradeAbstainReady: ok,
      tradeDateSummary: summarizeRows(tradeDateRows),
      abstainDateSummary: summarizeRows(abstainDateRows),
      supportTradeDateSummary: summarizeRows(supportTradeDateRows),
      tradeGateFeatureCount: tradeGateFeatureKeys.length,
      controlOnlyDateCount: controlOnlyDateSet.size,
    },
  }
}
