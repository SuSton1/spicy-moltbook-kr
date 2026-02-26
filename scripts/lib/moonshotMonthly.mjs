import { parseDateKey, shiftDateKey } from "../ai-date-range.lib.mjs"
import { toWeekKeyKst } from "./weekKey.mjs"
import { getEvalOhlc } from "./priceAdjust.mjs"

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const toMonthKey = (dateKey) => {
  const raw = String(dateKey ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null
  }
  return raw.slice(0, 7)
}

export const listRecentMonths = ({ asOfDateKey, months = 6 }) => {
  const parts = parseDateKey(asOfDateKey)
  if (!parts) {
    return []
  }
  const out = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1 - i, 1))
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    out.push(`${year}-${month}`)
  }
  return out
}

export const buildCandleMap = (candles) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const evalOhlc = getEvalOhlc(row)
    const entry = map.get(symbol) ?? new Map()
    entry.set(dateKey, {
      open: evalOhlc.open,
      high: evalOhlc.high,
      close: evalOhlc.close,
    })
    map.set(symbol, entry)
  }
  return map
}

const buildCalendarIndex = (calendar) => {
  const list = Array.isArray(calendar) ? [...calendar] : []
  if (!list.length) {
    return null
  }
  list.sort((a, b) => String(a).localeCompare(String(b)))
  const index = new Map(list.map((key, idx) => [key, idx]))
  return { list, index }
}

export const resolveNextTradingDateKey = (dateKey, calendar, fallbackKeys) => {
  const target = String(dateKey ?? "").trim()
  if (!target) {
    return null
  }
  const calendarIndex = buildCalendarIndex(calendar)
  if (calendarIndex?.index?.has(target)) {
    const idx = calendarIndex.index.get(target)
    if (idx + 1 < calendarIndex.list.length) {
      return calendarIndex.list[idx + 1]
    }
  }
  const fallback = Array.isArray(fallbackKeys) ? fallbackKeys : []
  for (const key of fallback) {
    if (String(key) > target) {
      return key
    }
  }
  const next = shiftDateKey(target, 1)
  return next
}

export const computeMoonshotMonthlyReport = ({
  signals,
  candles,
  calendar,
  asOfDateKey,
  monthCount = 6,
  highThreshold = 0.12,
  gapThreshold = 0.03,
}) => {
  const monthList = listRecentMonths({
    asOfDateKey,
    months: monthCount,
  })
  const monthSet = new Set(monthList)
  const candleMap = buildCandleMap(candles)
  const fallbackKeys = Array.isArray(candles)
    ? Array.from(
        new Set(
          candles
            .map((row) => String(row?.dateKey ?? row?.tradingDateKey ?? ""))
            .filter(Boolean),
        ),
      ).sort((a, b) => String(a).localeCompare(String(b)))
    : []

  const monthStats = new Map(
    monthList.map((monthKey) => [
      monthKey,
      {
        monthKey,
        totalSignals: 0,
        successCount: 0,
        excludedByGapCount: 0,
        successRate: 0,
        monthlyPass: false,
      },
    ]),
  )

  for (const signal of signals ?? []) {
    const symbol = String(signal?.symbol ?? "").trim()
    const dateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const monthKey = toMonthKey(dateKey)
    if (!monthKey || !monthSet.has(monthKey)) {
      continue
    }
    const evalDateKey = resolveNextTradingDateKey(
      dateKey,
      calendar,
      fallbackKeys,
    )
    if (!evalDateKey) {
      continue
    }
    const symbolMap = candleMap.get(symbol)
    const prev = symbolMap?.get(dateKey)
    const evalCandle = symbolMap?.get(evalDateKey)
    const prevClose = toNumber(prev?.close)
    const open = toNumber(evalCandle?.open)
    const high = toNumber(evalCandle?.high)
    if (
      !Number.isFinite(prevClose) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high)
    ) {
      continue
    }
    const openGapPct = open / prevClose - 1
    const highUpPct = high / prevClose - 1
    const bucket = monthStats.get(monthKey)
    if (!bucket) {
      continue
    }
    bucket.totalSignals += 1
    if (openGapPct >= gapThreshold) {
      bucket.excludedByGapCount += 1
      continue
    }
    if (highUpPct >= highThreshold) {
      bucket.successCount += 1
    }
  }

  const months = monthList.map((monthKey) => {
    const entry = monthStats.get(monthKey)
    if (!entry) {
      return {
        monthKey,
        totalSignals: 0,
        successCount: 0,
        excludedByGapCount: 0,
        successRate: 0,
        monthlyPass: false,
      }
    }
    const successRate =
      entry.totalSignals > 0 ? entry.successCount / entry.totalSignals : 0
    const monthlyPass = entry.successCount >= 2
    return {
      ...entry,
      successRate,
      monthlyPass,
    }
  })

  const passedMonths = months.filter((row) => row.monthlyPass).length
  const overallPass = months.length > 0 && passedMonths === months.length

  return {
    asOfDateKey,
    monthList,
    totalMonths: months.length,
    passedMonths,
    overallPass,
    months,
    meta: {
      highThreshold,
      gapThreshold,
      weekKey: toWeekKeyKst(asOfDateKey),
    },
  }
}
