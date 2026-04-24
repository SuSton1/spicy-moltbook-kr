const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
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
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const unionTokenSet = (rows = []) =>
  new Set(uniqueStrings((rows ?? []).flatMap((row) => Array.from(row?.tokenSet ?? row?.categoricalTokens ?? []))))

const normalizeTradeSlateKey = (featureKey) => {
  const text = String(featureKey ?? "").trim()
  if (!text.startsWith("sig.")) return null
  const [, family, ...rest] = text.split(".")
  if (!family || rest.length < 1) return null
  return {
    family,
    suffix: rest.join("."),
  }
}

const buildSummaryFeatureMap = ({ rows = [], featureKeys = [] } = {}) => {
  const out = {
    "sig.tradeSlate.meta.rowCount": Number(rows.length ?? 0),
    "sig.tradeSlate.meta.positiveRowCount": Number(rows.filter((row) => row?.outcomeHitTarget === true).length),
    "sig.tradeSlate.meta.negativeRowCount": Number(rows.filter((row) => row?.outcomeHitTarget !== true).length),
  }
  out["sig.tradeSlate.meta.positiveRowShare"] =
    out["sig.tradeSlate.meta.rowCount"] > 0
      ? out["sig.tradeSlate.meta.positiveRowCount"] / out["sig.tradeSlate.meta.rowCount"]
      : 0
  for (const featureKey of uniqueStrings(featureKeys)) {
    const normalized = normalizeTradeSlateKey(featureKey)
    if (!normalized) continue
    const axisValues = rows.map((row) => row?.numericFeatureMap?.[featureKey])
    out[`sig.tradeSlate.${normalized.family}.mean.${normalized.suffix}`] = average(axisValues) ?? 0
    out[`sig.tradeSlate.${normalized.family}.max.${normalized.suffix}`] = maxValue(axisValues) ?? 0
  }
  return out
}

const buildDateSummaryRow = ({ dateKey, rows = [], featureKeys = [], label = "unlabeled", targetUniverseId } = {}) => {
  const safeDateKey = String(dateKey ?? "").trim()
  if (!safeDateKey) return null
  return {
    rowKey: `trade-slate::${safeDateKey}`,
    sourceId: `trade-slate::${safeDateKey}`,
    symbol: "__DATE_SLATE__",
    dateKey: safeDateKey,
    monthKey: buildMonthKey(safeDateKey),
    targetDateKey: null,
    outcomeHitTarget: label === "trade",
    foldId: Number(rows?.[0]?.foldId ?? 0),
    windowId: Number(rows?.[0]?.windowId ?? 0),
    eventOutcome: null,
    numericFeatureMap: {
      ...buildSummaryFeatureMap({ rows, featureKeys }),
      "sig.tradeSlate.meta.targetUniverseHash": Number(String(targetUniverseId ?? "").length || 0),
    },
    categoricalTokens: [`tag:tradeSlate:${label}`],
    tokenSet: unionTokenSet(rows),
    queryId: safeDateKey,
    queryLabel: label,
    rawRows: rows,
  }
}

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.tradeSlate.")),
    ),
  )

export const buildPerfectPrototypeDailyTradeSlateDataset = ({ family, targetUniverseId = "daily_trade_slate_v1" } = {}) => {
  const tradeDateSet = new Set((family?.canonicalPositiveDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const featureKeys = Array.isArray(family?.mechanismFeatureKeys) ? family.mechanismFeatureKeys : []
  const tradeDateRows = []
  const abstainDateRows = []

  for (const [dateKey, rows] of byDate.entries()) {
    if (tradeDateSet.has(dateKey)) {
      const summaryRow = buildDateSummaryRow({ dateKey, rows, featureKeys, label: "trade", targetUniverseId })
      if (summaryRow) tradeDateRows.push(summaryRow)
      continue
    }
    if (controlOnlyDateSet.has(dateKey)) {
      const summaryRow = buildDateSummaryRow({ dateKey, rows, featureKeys, label: "abstain", targetUniverseId })
      if (summaryRow) abstainDateRows.push(summaryRow)
    }
  }

  const supportTradeDateRows = Array.from(groupRowsByDate(family?.supportCaseViews ?? []).entries())
    .map(([dateKey, rows]) => buildDateSummaryRow({ dateKey, rows, featureKeys, label: "support", targetUniverseId }))
    .filter(Boolean)
  const tradeSlateFeatureKeys = collectFeatureKeys([...tradeDateRows, ...abstainDateRows, ...supportTradeDateRows])
  const ok = tradeDateRows.length > 0 && abstainDateRows.length > 0 && tradeSlateFeatureKeys.length > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_trade_slate_rows",
    targetUniverseId,
    tradeDateRows,
    abstainDateRows,
    supportTradeDateRows,
    tradeGateFeatureKeys: tradeSlateFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      targetUniverseId,
      tradeSlateReady: ok,
      tradeDateSummary: summarizeRows(tradeDateRows),
      abstainDateSummary: summarizeRows(abstainDateRows),
      supportTradeDateSummary: summarizeRows(supportTradeDateRows),
      tradeSlateFeatureCount: tradeSlateFeatureKeys.length,
    },
  }
}
