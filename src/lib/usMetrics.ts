export type NasdaqQuoteInfoPayload = {
  data?: {
    primaryData?: {
      lastSalePrice?: string | number | null
      netChange?: string | number | null
      percentageChange?: string | number | null
      volume?: string | number | null
    }
  }
}

export type NasdaqQuoteSummaryPayload = {
  data?: {
    summaryData?: {
      MarketCap?: { value?: string | number | null }
    }
  }
}

export type NasdaqQuoteMetrics = {
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  marketCap: number | null
  missingKeys: string[]
}

const parseNasdaqNumber = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") {
    return null
  }
  const cleaned = String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim()
  if (!cleaned) {
    return null
  }
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export const normalizeNasdaqQuote = (
  info: NasdaqQuoteInfoPayload = {},
  summary: NasdaqQuoteSummaryPayload = {},
): NasdaqQuoteMetrics => {
  const missingKeys: string[] = []
  const primary = info.data?.primaryData ?? {}
  const summaryData = summary.data?.summaryData ?? {}

  const price = parseNasdaqNumber(primary.lastSalePrice)
  if (price === null) {
    missingKeys.push("primaryData.lastSalePrice")
  }
  const change = parseNasdaqNumber(primary.netChange)
  if (change === null) {
    missingKeys.push("primaryData.netChange")
  }
  const changeRate = parseNasdaqNumber(primary.percentageChange)
  if (changeRate === null) {
    missingKeys.push("primaryData.percentageChange")
  }
  const volume = parseNasdaqNumber(primary.volume)
  if (volume === null) {
    missingKeys.push("primaryData.volume")
  }
  const marketCap = parseNasdaqNumber(summaryData.MarketCap?.value)
  if (marketCap === null) {
    missingKeys.push("summaryData.MarketCap.value")
  }

  return {
    price,
    change,
    changeRate,
    volume,
    marketCap,
    missingKeys,
  }
}
