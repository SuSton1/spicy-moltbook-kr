const toDate = (value) => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }
  const ts = Number(value)
  if (!Number.isFinite(ts)) {
    return null
  }
  const date = new Date(ts)
  if (!Number.isFinite(date.getTime())) {
    return null
  }
  return date
}

const normalizeOptions = (options) => {
  const preferHourUtcRaw = Number(options?.preferHourUtc)
  const preferHourUtc = Number.isFinite(preferHourUtcRaw)
    ? Math.max(0, Math.min(23, Math.floor(preferHourUtcRaw)))
    : 14
  const fallbackMode =
    String(options?.fallbackMode ?? "none")
      .trim()
      .toLowerCase() === "last"
      ? "last"
      : "none"
  return { preferHourUtc, fallbackMode }
}

export const selectPrice15MetaFromHourly = (candles, options = {}) => {
  const { preferHourUtc, fallbackMode } = normalizeOptions(options)
  let picked = null
  let pickedTs = null
  let last = null
  let lastTs = null

  for (const candle of candles ?? []) {
    const date = toDate(candle?.tsKst)
    if (!date) {
      continue
    }
    const ts = date.getTime()
    if (lastTs === null || ts > lastTs) {
      last = candle
      lastTs = ts
    }
    if (date.getUTCHours() !== preferHourUtc) {
      continue
    }
    if (pickedTs === null || ts > pickedTs) {
      picked = candle
      pickedTs = ts
    }
  }

  if (picked) {
    return { candle: picked, method: "preferred_hour" }
  }
  if (fallbackMode === "last" && last) {
    return { candle: last, method: "last_available" }
  }
  return { candle: null, method: "none" }
}

export const selectPrice15FromHourly = (candles, options = {}) => {
  const picked = selectPrice15MetaFromHourly(candles, options)
  return picked.candle
}
