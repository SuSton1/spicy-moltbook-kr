import { iterateJsonl } from "./io.mjs"

const normalizeTargetDatesBySymbol = (targetDatesBySymbol) => {
  const normalized = new Map()
  for (const [rawSymbol, rawDates] of targetDatesBySymbol ?? []) {
    const symbol = String(rawSymbol ?? "").trim()
    if (!symbol) continue
    const normalizedDates = new Set()
    for (const rawDate of rawDates ?? []) {
      const dateKey = String(rawDate ?? "").trim()
      if (dateKey) normalizedDates.add(dateKey)
    }
    if (normalizedDates.size > 0) {
      normalized.set(symbol, normalizedDates)
    }
  }
  return normalized
}

export const buildRecommendationCloseRetLookupForMatchTargets = async ({
  candlePath,
  targetDatesBySymbol,
}) => {
  const normalizedTargets = normalizeTargetDatesBySymbol(targetDatesBySymbol)
  if (normalizedTargets.size < 1) return new Map()

  const closesBySymbol = new Map()
  await iterateJsonl(candlePath, {
    strict: true,
    onRow: async (row) => {
      const symbol = String(row?.symbol ?? "").trim()
      if (!symbol || !normalizedTargets.has(symbol)) return
      const dateKey = String(row?.dateKey ?? row?.date ?? "").trim()
      const close = Number(row?.close)
      if (!dateKey || !Number.isFinite(close)) return
      const bucket = closesBySymbol.get(symbol) ?? []
      bucket.push({ dateKey, close })
      closesBySymbol.set(symbol, bucket)
    },
  })

  const lookup = new Map()
  for (const [symbol, rows] of closesBySymbol.entries()) {
    rows.sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    const targetDates = normalizedTargets.get(symbol)
    let previousClose = null
    for (const row of rows) {
      if (
        targetDates?.has(row.dateKey) &&
        Number.isFinite(previousClose) &&
        previousClose > 0
      ) {
        lookup.set(`${symbol}::${row.dateKey}`, ((row.close - previousClose) / previousClose) * 100)
      }
      previousClose = row.close
    }
  }
  return lookup
}
