const toNumber = (value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? asNumber : null
}

export const MARKET_CAP_MIN_KRW = 30_000_000_000 // 300억
// See docs/STOCKDESK_AI_SIGNALS_MASTER_v6.md (MarketCap Filter).
export const MARKET_CAP_MAX_KRW = 1_000_000_000_000 // 1조

export const resolveMarketCapKrw = (row) => {
  if (!row) {
    return null
  }
  const raw =
    row.marketCapKrw ??
    row.marketCapKRW ??
    row.marketCap ??
    row.mcap ??
    row.mcapKrw
  return toNumber(raw)
}

export const evaluateMarketCap = ({
  marketCapKrw,
  minCap = MARKET_CAP_MIN_KRW,
  maxCap = MARKET_CAP_MAX_KRW,
  excludeUnknown = false,
}) => {
  const cap = toNumber(marketCapKrw)
  if (!Number.isFinite(cap)) {
    return { pass: !excludeUnknown, status: "UNKNOWN", cap: null }
  }
  if (cap <= minCap || cap >= maxCap) {
    return { pass: false, status: "OUT_OF_RANGE", cap }
  }
  return { pass: true, status: "PASS", cap }
}

export const initMarketCapStats = () => ({
  minCap: MARKET_CAP_MIN_KRW,
  maxCap: MARKET_CAP_MAX_KRW,
  knownCount: 0,
  unknownCount: 0,
  filteredCount: 0,
})

export const trackMarketCap = (stats, verdict) => {
  if (!stats || !verdict) {
    return stats
  }
  if (verdict.status === "UNKNOWN") {
    stats.unknownCount += 1
    if (!verdict.pass) {
      stats.filteredCount += 1
    }
    return stats
  }
  stats.knownCount += 1
  if (!verdict.pass) {
    stats.filteredCount += 1
  }
  return stats
}
