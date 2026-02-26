import { normalizeDateKey } from "../ai-date-range.lib.mjs"
import { toWeekKeyKst } from "./weekKey.mjs"

const compareKey = (a, b) => String(a).localeCompare(String(b))

const normalizeCalendar = (calendar, asOfDateKey) => {
  const asOf = normalizeDateKey(asOfDateKey)
  const list = Array.isArray(calendar) ? calendar : []
  return list
    .map((key) => normalizeDateKey(key))
    .filter((key) => key && (!asOf || key <= asOf))
    .sort(compareKey)
}

const uniqueWeekKeys = (calendar) => {
  const out = []
  let last = null
  for (const dateKey of calendar) {
    const weekKey = toWeekKeyKst(dateKey)
    if (!weekKey || weekKey === "unknown") {
      continue
    }
    if (weekKey !== last) {
      out.push(weekKey)
      last = weekKey
    }
  }
  return out
}

export const listWeekKeys = ({ calendar, asOfDateKey }) => {
  const cleanCalendar = normalizeCalendar(calendar, asOfDateKey)
  return uniqueWeekKeys(cleanCalendar)
}

export const resolveWeekWindow = ({
  calendar,
  asOfDateKey,
  weekCount,
  offsetWeeks = 0,
}) => {
  const cleanCalendar = normalizeCalendar(calendar, asOfDateKey)
  const weeks = uniqueWeekKeys(cleanCalendar)
  const count = Math.max(1, Math.floor(weekCount ?? 1))
  const offset = Math.max(0, Math.floor(offsetWeeks ?? 0))
  const end = weeks.length - offset
  const start = end - count
  if (start < 0 || end <= 0 || start >= end) {
    return null
  }
  const selected = weeks.slice(start, end)
  const weekSet = new Set(selected)
  const windowDates = cleanCalendar.filter((key) =>
    weekSet.has(toWeekKeyKst(key)),
  )
  if (!windowDates.length) {
    return null
  }
  return {
    weekKeys: selected,
    fromDateKey: windowDates[0],
    toDateKey: windowDates[windowDates.length - 1],
  }
}

export const resolveValidationLockbox = ({
  calendar,
  asOfDateKey,
  weekCount,
}) => {
  const lockbox = resolveWeekWindow({
    calendar,
    asOfDateKey,
    weekCount,
    offsetWeeks: 0,
  })
  const validation = resolveWeekWindow({
    calendar,
    asOfDateKey,
    weekCount,
    offsetWeeks: weekCount,
  })
  if (!lockbox || !validation) {
    return null
  }
  return { lockbox, validation }
}
