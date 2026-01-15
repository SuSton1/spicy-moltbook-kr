import type { UTCTimestamp } from "lightweight-charts"
import type { IntradayIntervalKey } from "../../../lib/chartIntervals"

export type BrokerChartPane = "price" | "volume"

export type BrokerChartTimeframe = "1d" | "1w" | "1mo" | IntradayIntervalKey

export type BrokerCandle = {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ChangeMetrics = {
  change: number
  changeRate: number
}

export const resolvePrevClose = (
  quote?: { price?: number | null; change?: number | null } | null,
  fallback?: number | null,
) => {
  const quotePrice = quote?.price ?? null
  const quoteChange = quote?.change ?? null
  if (
    typeof quotePrice === "number" &&
    quotePrice > 0 &&
    typeof quoteChange === "number"
  ) {
    return quotePrice - quoteChange
  }
  if (typeof fallback === "number" && fallback > 0) {
    return fallback
  }
  return null
}

export const calcChangeMetrics = (
  value: number,
  prevClose: number,
): ChangeMetrics => {
  const change = value - prevClose
  const changeRate = prevClose ? (change / prevClose) * 100 : 0
  return { change, changeRate }
}
