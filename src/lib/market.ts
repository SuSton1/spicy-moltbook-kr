import { resolveSessionWindow, type SessionWindow } from "./session"
import { getZonedDateParts } from "./timezone"

export type MarketSession = {
  label: string
  isOpen: boolean
}

const weekdayLookup: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const resolveWeekdayInZone = (date: Date, timeZone: string) => {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date)
  return weekdayLookup[value.slice(0, 3)] ?? 0
}

export const getMarketSession = (
  session: SessionWindow = resolveSessionWindow("KR", "KRX"),
  now = new Date(),
): MarketSession => {
  const parts = getZonedDateParts(now, session.timeZone)
  const minutes = parts.hour * 60 + parts.minute
  const day = resolveWeekdayInZone(now, session.timeZone)
  const isWeekday = day >= 1 && day <= 5
  const openMinutes = session.open.hour * 60 + session.open.minute
  const closeMinutes = session.close.hour * 60 + session.close.minute
  const isOpen = isWeekday && minutes >= openMinutes && minutes <= closeMinutes
  return {
    label: isOpen ? "장중" : "장마감",
    isOpen,
  }
}
