import {
  buildTradingCalendarRange,
  normalizeDateKey,
  shiftDateKey,
} from "../ai-date-range.lib.mjs"

const LAST_TRADING_DAY_TOKEN = "last_trading_day"
const CALENDAR_FALLBACK_NOTE = "UNKNOWN_CALENDAR_FALLBACK"
const MIN_CALENDAR_FALLBACK_ROWS = 3

const attachFallbackNote = (calendar) => {
  if (Array.isArray(calendar)) {
    calendar.note = CALENDAR_FALLBACK_NOTE
  }
  return calendar
}

const toDateKeyKst = (ts) => {
  const kst = new Date(Number(ts) + 9 * 60 * 60_000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kst.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export const resolveTodayKstDateKey = () => toDateKeyKst(Date.now())

export const resolveAsOfDateKey = async ({
  prisma,
  asOfInput,
  fallbackDateKey,
  todayDateKey,
}) => {
  const raw = String(asOfInput ?? "")
    .trim()
    .toLowerCase()
  if (raw === LAST_TRADING_DAY_TOKEN) {
    const today = todayDateKey ?? resolveTodayKstDateKey()
    return resolveLastTradingDateKey({ prisma, asOfDateKey: today })
  }
  const normalized = normalizeDateKey(asOfInput)
  if (normalized) {
    return normalized
  }
  return normalizeDateKey(fallbackDateKey) ?? null
}

export const resolveLastTradingDateKey = async ({ prisma, asOfDateKey }) => {
  const target = normalizeDateKey(asOfDateKey)
  if (!target) {
    return null
  }
  if (prisma) {
    const row = await prisma.tradingCalendar.findFirst({
      where: { dateKey: { lte: target }, isTradingDay: true },
      orderBy: { dateKey: "desc" },
      select: { dateKey: true },
    })
    if (row?.dateKey) {
      return row.dateKey
    }

    const candleRow = await prisma.candleDaily
      .findFirst({
        where: { dateKey: { lte: target } },
        orderBy: { dateKey: "desc" },
        select: { dateKey: true },
      })
      .catch(() => null)
    if (candleRow?.dateKey) {
      return candleRow.dateKey
    }
  }
  // Fallback to weekday-only search.
  let probe = target
  for (let i = 0; i < 366; i += 1) {
    const calendar = buildTradingCalendarRange(probe, probe)
    if (calendar.length) {
      return calendar[calendar.length - 1]
    }
    probe = shiftDateKey(probe, -1) ?? probe
  }
  return target
}

export const resolveTradingWindow = async ({
  prisma,
  asOfDateKey,
  tradingDays,
  fallbackDays,
}) => {
  const target = normalizeDateKey(asOfDateKey)
  const days = Math.max(1, Math.floor(tradingDays ?? 1))
  if (!target) {
    return []
  }

  if (prisma) {
    const rows = await prisma.tradingCalendar.findMany({
      where: { dateKey: { lte: target }, isTradingDay: true },
      orderBy: { dateKey: "desc" },
      take: days,
      select: { dateKey: true },
    })
    if (rows.length) {
      return rows.map((row) => row.dateKey).reverse()
    }

    const candleRows = await prisma.candleDaily
      .findMany({
        where: { dateKey: { lte: target } },
        orderBy: { dateKey: "desc" },
        take: Math.max(days, MIN_CALENDAR_FALLBACK_ROWS),
        distinct: ["dateKey"],
        select: { dateKey: true },
      })
      .catch(() => [])
    if (candleRows.length >= MIN_CALENDAR_FALLBACK_ROWS) {
      const calendar = candleRows.map((row) => row.dateKey).reverse()
      return attachFallbackNote(calendar).slice(-days)
    }
  }

  const fallbackSpan = Math.max(days * 2, Math.floor(fallbackDays ?? 0))
  const fromDateKey = shiftDateKey(target, -fallbackSpan) ?? target
  const calendar = buildTradingCalendarRange(fromDateKey, target)
  return calendar.slice(-days)
}

export const resolveTradingCalendarRange = async ({
  prisma,
  fromDateKey,
  toDateKey,
}) => {
  const from = normalizeDateKey(fromDateKey)
  const to = normalizeDateKey(toDateKey)
  if (!from || !to) {
    return []
  }
  if (prisma) {
    const rows = await prisma.tradingCalendar.findMany({
      where: {
        dateKey: { gte: from, lte: to },
        isTradingDay: true,
      },
      orderBy: { dateKey: "asc" },
      select: { dateKey: true },
    })
    if (rows.length) {
      return rows.map((row) => row.dateKey)
    }

    const candleRows = await prisma.candleDaily
      .findMany({
        where: { dateKey: { gte: from, lte: to } },
        orderBy: { dateKey: "asc" },
        distinct: ["dateKey"],
        select: { dateKey: true },
      })
      .catch(() => [])
    if (candleRows.length >= MIN_CALENDAR_FALLBACK_ROWS) {
      return attachFallbackNote(candleRows.map((row) => row.dateKey))
    }
  }
  return buildTradingCalendarRange(from, to)
}

export const isLastTradingDayToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase() === LAST_TRADING_DAY_TOKEN
