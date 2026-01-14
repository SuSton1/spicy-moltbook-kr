export const INTRADAY_INTERVALS = [
  { key: "1m", label: "1분", minutes: 1, pollMs: 10000 },
  { key: "3m", label: "3분", minutes: 3, pollMs: 12000 },
  { key: "5m", label: "5분", minutes: 5, pollMs: 12000 },
  { key: "10m", label: "10분", minutes: 10, pollMs: 15000 },
  { key: "15m", label: "15분", minutes: 15, pollMs: 15000 },
  { key: "30m", label: "30분", minutes: 30, pollMs: 20000 },
  { key: "1h", label: "1시간", minutes: 60, pollMs: 20000 },
  { key: "4h", label: "4시간", minutes: 240, pollMs: 30000 },
] as const

export type IntradayIntervalKey = (typeof INTRADAY_INTERVALS)[number]["key"]
export type IntradayInterval = (typeof INTRADAY_INTERVALS)[number]

export const isIntradayInterval = (
  value?: string | null,
): value is IntradayIntervalKey =>
  INTRADAY_INTERVALS.some((item) => item.key === value)

export const resolveIntradayInterval = (value?: string | null) =>
  INTRADAY_INTERVALS.find((item) => item.key === value) ?? INTRADAY_INTERVALS[0]

export const resolveUsProviderMinutes = (value?: string | null) => {
  const interval = resolveIntradayInterval(value)
  const providerMinutes = interval.key === "4h" ? 60 : interval.minutes
  return {
    interval,
    providerMinutes,
    aggregateMinutes: interval.minutes,
  }
}

export const resolveKrProviderMinutes = (value?: string | null, days = 1) => {
  const interval = resolveIntradayInterval(value)
  const clampedDays = Math.min(Math.max(days, 1), 5)
  return {
    interval,
    requestMinutes: 1,
    aggregateMinutes: interval.minutes,
    days: clampedDays,
  }
}
