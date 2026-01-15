export const numberFormat = new Intl.NumberFormat("ko-KR")
const fixedNumberFormats = new Map<number, Intl.NumberFormat>()

const getFixedNumberFormat = (digits: number) => {
  const normalized = Math.max(0, Math.min(6, Math.floor(digits)))
  const cached = fixedNumberFormats.get(normalized)
  if (cached) {
    return cached
  }
  const formatter = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: normalized,
    maximumFractionDigits: normalized,
  })
  fixedNumberFormats.set(normalized, formatter)
  return formatter
}

export const formatNumber = (value?: number, fallback = "-") => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback
  }
  return numberFormat.format(value)
}

export const formatSigned = (value?: number, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-"
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${getFixedNumberFormat(digits).format(Math.abs(value))}`
}

export const formatSignedPercent = (value?: number, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-"
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${getFixedNumberFormat(digits).format(Math.abs(value))}%`
}

export const formatDateLabel = (value?: string) => {
  if (!value) {
    return "-"
  }
  if (value.length >= 8) {
    const year = value.slice(0, 4)
    const month = value.slice(4, 6)
    const day = value.slice(6, 8)
    return `${year}.${month}.${day}`
  }
  return value
}

export const formatTimeLabel = (value?: string | number, timeZone?: string) => {
  if (!value) {
    return "-"
  }
  if (typeof value === "number") {
    const date = new Date(value * 1000)
    if (timeZone) {
      const formatter = new Intl.DateTimeFormat("ko-KR", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      const parts = formatter.formatToParts(date)
      const lookup = parts.reduce<Record<string, string>>((acc, part) => {
        if (part.type !== "literal") {
          acc[part.type] = part.value
        }
        return acc
      }, {})
      if (lookup.year && lookup.month && lookup.day && lookup.hour) {
        return `${lookup.year}.${lookup.month}.${lookup.day} ${lookup.hour}:${lookup.minute ?? "00"}`
      }
    }
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")
    return `${year}.${month}.${day} ${hours}:${minutes}`
  }
  if (value.length >= 12) {
    const date = formatDateLabel(value.slice(0, 8))
    const hour = value.slice(8, 10)
    const minute = value.slice(10, 12)
    return `${date} ${hour}:${minute}`
  }
  return value
}
