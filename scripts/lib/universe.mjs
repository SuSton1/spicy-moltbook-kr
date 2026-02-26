const toNumber = (value, fallback = null) => {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : fallback
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? asNumber : fallback
}

const resolveTradingValue = (row) => {
  const direct = toNumber(row?.tradingValue)
  if (Number.isFinite(direct)) {
    return direct
  }
  const close = toNumber(row?.close, 0) ?? 0
  const volume = toNumber(row?.volume, 0) ?? 0
  const computed = close * volume
  return Number.isFinite(computed) ? computed : 0
}

const resolveMarketCapKrw = (row) => {
  const raw =
    row?.marketCapKrw ?? row?.marketCapKRW ?? row?.marketCap ?? row?.mcap
  return toNumber(raw)
}

export const buildUniverseRows = (dailyRows, window = 20) => {
  const rows = Array.isArray(dailyRows) ? [...dailyRows] : []
  rows.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))

  const values = []
  const output = []
  for (const row of rows) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) {
      continue
    }
    const tradingValue = resolveTradingValue(row)
    const marketCapKrw = resolveMarketCapKrw(row)
    values.push(tradingValue)
    const slice = values.slice(Math.max(0, values.length - window))
    const avg =
      slice.length > 0
        ? slice.reduce((acc, value) => acc + value, 0) / slice.length
        : 0
    output.push({
      dateKey,
      tradingValue,
      avgTradingValue20d: avg,
      marketCapKrw,
    })
  }
  return output
}
