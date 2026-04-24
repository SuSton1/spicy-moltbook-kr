const pad2 = (n) => String(n).padStart(2, "0")

export const normalizeDateKey = (value) => {
  const t = String(value ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = pad2(d.getUTCMonth() + 1)
  const day = pad2(d.getUTCDate())
  return `${y}-${m}-${day}`
}

export const parseDateKey = (value) => {
  const key = normalizeDateKey(value)
  if (!key) return null
  return new Date(`${key}T00:00:00Z`)
}

export const formatDateKey = (dateObj) => {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null
  return `${dateObj.getUTCFullYear()}-${pad2(dateObj.getUTCMonth() + 1)}-${pad2(dateObj.getUTCDate())}`
}

export const compareDateKey = (a, b) => String(a ?? "").localeCompare(String(b ?? ""))

export const shiftDays = (dateKey, days) => {
  const d = parseDateKey(dateKey)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + Number(days || 0))
  return formatDateKey(d)
}

export const shiftMonths = (dateKey, months) => {
  const d = parseDateKey(dateKey)
  if (!d) return null
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0))
  return formatDateKey(d)
}

export const isInRange = (dateKey, range) => {
  const d = normalizeDateKey(dateKey)
  if (!d) return false
  if (!range?.from || !range?.to) return false
  return d >= range.from && d <= range.to
}

export const computeTimelinePeriods = (timeline) => {
  const anchor = normalizeDateKey(timeline?.anchorDateKey)
  if (!anchor) {
    throw new Error("timeline.anchorDateKey is required")
  }
  const warmupMonths = Math.max(1, Number(timeline?.warmupMonths ?? 12))
  const discoveryMonths = Math.max(1, Number(timeline?.discoveryMonths ?? 50))
  const onlineMonths = Math.max(1, Number(timeline?.onlineMonths ?? 4))
  const lockboxMonths = Math.max(1, Number(timeline?.lockboxMonths ?? 4))

  const lockboxTo = anchor
  const lockboxFrom = shiftDays(shiftMonths(lockboxTo, -lockboxMonths), 1)

  const onlineTo = shiftDays(lockboxFrom, -1)
  const onlineFrom = shiftDays(shiftMonths(onlineTo, -onlineMonths), 1)

  const discoveryTo = shiftDays(onlineFrom, -1)
  const discoveryFrom = shiftDays(shiftMonths(discoveryTo, -discoveryMonths), 1)

  const warmupTo = shiftDays(discoveryFrom, -1)
  const warmupFrom = shiftDays(shiftMonths(warmupTo, -warmupMonths), 1)

  return {
    warmup: { from: warmupFrom, to: warmupTo },
    discovery: { from: discoveryFrom, to: discoveryTo },
    online: { from: onlineFrom, to: onlineTo },
    lockbox: { from: lockboxFrom, to: lockboxTo }
  }
}

export const uniqueSortedDateKeys = (rows, field) => {
  const set = new Set()
  for (const row of rows ?? []) {
    const key = normalizeDateKey(row?.[field])
    if (key) set.add(key)
  }
  return Array.from(set).sort(compareDateKey)
}
