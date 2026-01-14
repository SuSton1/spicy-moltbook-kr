import { formatDateTimeInZone, toEpochMsInZone } from "./timezone"
import type { SessionWindow } from "./session"

export type IntradayCandle = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const pad2 = (value: number) => String(value).padStart(2, "0")

const normalizeTime = (value: string) => {
  const digits = value.replace(/\D/g, "")
  if (digits.length >= 12) {
    return digits.slice(0, 12)
  }
  if (digits.length >= 8) {
    return digits.slice(0, 8)
  }
  return ""
}

const buildSessionOpenKey = (date: string, session: SessionWindow) => {
  const safeDate = date.replace(/\D/g, "").slice(0, 8)
  if (safeDate.length < 8) {
    return ""
  }
  return `${safeDate}${pad2(session.open.hour)}${pad2(session.open.minute)}`
}

export const buildIntradayTimeKey = (dateRaw: string, timeRaw: string) => {
  const date = dateRaw.replace(/\D/g, "").slice(0, 8)
  if (date.length < 8) {
    return ""
  }
  const time = timeRaw.replace(/\D/g, "").padStart(6, "0").slice(0, 6)
  if (!time) {
    return date
  }
  return `${date}${time.slice(0, 4)}`
}

export const normalizeCandleSeries = (candles: IntradayCandle[]) => {
  const map = new Map<string, IntradayCandle>()
  candles.forEach((candle) => {
    const time = normalizeTime(candle.time)
    if (!time) {
      return
    }
    const open = Number(candle.open)
    const high = Number(candle.high)
    const low = Number(candle.low)
    const close = Number(candle.close)
    const volume = Number.isFinite(Number(candle.volume))
      ? Number(candle.volume)
      : 0
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      return
    }
    if (!map.has(time)) {
      map.set(time, {
        time,
        open,
        high,
        low,
        close,
        volume,
      })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time))
}

export const aggregateIntradayCandles = (
  candles: IntradayCandle[],
  intervalMinutes: number,
) => {
  if (intervalMinutes <= 1) {
    return normalizeCandleSeries(candles)
  }
  const normalized = normalizeCandleSeries(candles)
  const buckets = new Map<string, IntradayCandle>()
  normalized.forEach((candle) => {
    if (candle.time.length < 12) {
      buckets.set(candle.time, candle)
      return
    }
    const date = candle.time.slice(0, 8)
    const hour = Number(candle.time.slice(8, 10))
    const minute = Number(candle.time.slice(10, 12))
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return
    }
    const totalMinutes = hour * 60 + minute
    const bucketMinute =
      Math.floor(totalMinutes / intervalMinutes) * intervalMinutes
    const bucketHour = Math.floor(bucketMinute / 60)
    const bucketMin = bucketMinute % 60
    const bucketKey = `${date}${pad2(bucketHour)}${pad2(bucketMin)}`
    const existing = buckets.get(bucketKey)
    if (!existing) {
      buckets.set(bucketKey, { ...candle, time: bucketKey })
      return
    }
    existing.high = Math.max(existing.high, candle.high)
    existing.low = Math.min(existing.low, candle.low)
    existing.close = candle.close
    existing.volume += candle.volume
  })
  return Array.from(buckets.values()).sort((a, b) =>
    a.time.localeCompare(b.time),
  )
}

export const limitCandlesByDays = (candles: IntradayCandle[], days: number) => {
  if (days <= 0) {
    return normalizeCandleSeries(candles)
  }
  const normalized = normalizeCandleSeries(candles)
  const result: IntradayCandle[] = []
  const seenDates = new Set<string>()
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const candle = normalized[i]
    const date = candle.time.slice(0, 8)
    if (!seenDates.has(date) && seenDates.size >= days) {
      break
    }
    seenDates.add(date)
    result.push(candle)
  }
  return result.reverse()
}

export const shiftIntradayToSessionStart = (
  candles: IntradayCandle[],
  intervalMinutes: number,
  session: SessionWindow,
) => {
  const normalized = normalizeCandleSeries(candles)
  if (intervalMinutes <= 1 || normalized.length === 0) {
    return normalized
  }
  const firstDate = normalized[0].time.slice(0, 8)
  const openKey = buildSessionOpenKey(firstDate, session)
  const openEpoch = openKey ? toEpochMsInZone(openKey, session.timeZone) : null
  if (!openEpoch) {
    return normalized
  }
  const intervalMs = intervalMinutes * 60_000
  let hasOpen = false
  let hasOpenPlus = false
  const epochs = normalized.map((candle) =>
    toEpochMsInZone(candle.time, session.timeZone),
  )
  epochs.forEach((epoch) => {
    if (!epoch) {
      return
    }
    if (epoch === openEpoch) {
      hasOpen = true
    }
    if (epoch === openEpoch + intervalMs) {
      hasOpenPlus = true
    }
  })
  if (hasOpen || !hasOpenPlus) {
    return normalized
  }
  const shifted = normalized.map((candle, index) => {
    const epoch = epochs[index]
    if (!epoch) {
      return candle
    }
    const shiftedTime = formatDateTimeInZone(
      new Date(epoch - intervalMs),
      session.timeZone,
    )
    return { ...candle, time: shiftedTime }
  })
  return normalizeCandleSeries(shifted)
}
