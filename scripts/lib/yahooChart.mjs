const readNumber = (value) => {
  if (value === null || value === undefined) {
    return null
  }
  return Number.isFinite(value) ? value : null
}

export const parseYahooChartToOhlcv = (payload) => {
  const result = payload?.chart?.result?.[0] ?? null
  const timestamps = result?.timestamp ?? null
  const quote = result?.indicators?.quote?.[0] ?? null
  if (!timestamps || !Array.isArray(timestamps) || !quote) {
    return []
  }

  const opens = quote.open ?? []
  const highs = quote.high ?? []
  const lows = quote.low ?? []
  const closes = quote.close ?? []
  const volumes = quote.volume ?? []

  const points = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const tsSeconds = timestamps[i]
    if (typeof tsSeconds !== "number" || !Number.isFinite(tsSeconds)) {
      continue
    }
    const open = readNumber(opens[i])
    const high = readNumber(highs[i])
    const low = readNumber(lows[i])
    const close = readNumber(closes[i])
    if (open === null || high === null || low === null || close === null) {
      continue
    }
    const volume = readNumber(volumes[i]) ?? 0
    points.push({
      ts: Math.round(tsSeconds * 1000),
      open,
      high,
      low,
      close,
      volume,
    })
  }
  return points
}
