type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const parseParts = (value?: string | number) => {
  if (value === undefined || value === null) {
    return null
  }
  const digits = String(value).replace(/\D/g, "")
  if (digits.length < 8) {
    return null
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const hour = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0
  const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0
  const second = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0
  if (
    [year, month, day, hour, minute, second].some((part) => Number.isNaN(part))
  ) {
    return null
  }
  return { year, month, day, hour, minute, second }
}

const buildUtcFromParts = (parts: DateParts) =>
  Date.UTC(
    parts.year,
    Math.max(0, parts.month - 1),
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )

export const getTimeZoneOffsetMs = (timeZone: string, date: Date) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const lookup = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value
    }
    return acc
  }, {})
  const parsed = parseParts(
    `${lookup.year ?? ""}${lookup.month ?? ""}${lookup.day ?? ""}${lookup.hour ?? ""}${lookup.minute ?? ""}${lookup.second ?? ""}`,
  )
  if (!parsed) {
    return 0
  }
  const zonedUtc = buildUtcFromParts(parsed)
  return zonedUtc - date.getTime()
}

export const toEpochMsInZone = (value: string | number, timeZone: string) => {
  const parsed = parseParts(value)
  if (!parsed) {
    return null
  }
  const utcGuess = buildUtcFromParts(parsed)
  const offset = getTimeZoneOffsetMs(timeZone, new Date(utcGuess))
  return utcGuess - offset
}

export const formatTimeInZone = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const lookup = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value
    }
    return acc
  }, {})
  return `${lookup.hour ?? "00"}${lookup.minute ?? "00"}${lookup.second ?? "00"}`
}

export const parseCompactDateTime = (value?: string | number) =>
  parseParts(value)
