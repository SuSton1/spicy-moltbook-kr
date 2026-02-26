import { shiftDateKey } from "../ai-date-range.lib.mjs"

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const isWeekend = (dateKey) => {
  const [y, m, d] = String(dateKey ?? "")
    .trim()
    .split("-")
    .map((v) => Number(v))
  if (!y || !m || !d) {
    return false
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6
}

export const krxTickSize = (price) => {
  const n = toNumber(price)
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  if (n < 1000) return 1
  if (n < 5000) return 5
  if (n < 10000) return 10
  if (n < 50000) return 50
  if (n < 100000) return 100
  if (n < 500000) return 500
  return 1000
}

export const roundToTick = (price, tick) => {
  const n = toNumber(price)
  const t = toNumber(tick)
  if (!Number.isFinite(n) || !Number.isFinite(t) || t <= 0) {
    return null
  }
  // Deterministic tick rounding (floor) for limit price computation.
  return Math.floor(n / t) * t
}

export const computeLimitPrices = (prevClose) => {
  const base = toNumber(prevClose)
  if (!Number.isFinite(base) || base <= 0) {
    return null
  }
  const upperRaw = base * 1.3
  const lowerRaw = base * 0.7
  const upperTick = krxTickSize(upperRaw)
  const lowerTick = krxTickSize(lowerRaw)
  const upperLimit = roundToTick(upperRaw, upperTick)
  const lowerLimit = roundToTick(lowerRaw, lowerTick)
  if (
    !Number.isFinite(upperLimit) ||
    !Number.isFinite(lowerLimit) ||
    !Number.isFinite(upperTick) ||
    !Number.isFinite(lowerTick)
  ) {
    return null
  }
  return { upperLimit, lowerLimit, upperTick, lowerTick }
}

export const isTradableAt1500 = ({ price15, prevClose, lastHourCandle }) => {
  const price = toNumber(price15)
  if (!Number.isFinite(price)) {
    return {
      tradable: false,
      reason: "MISSING_PRICE15",
      meta: null,
    }
  }
  const prev = toNumber(prevClose)
  if (!Number.isFinite(prev)) {
    return {
      tradable: false,
      reason: "MISSING_PREVCLOSE",
      meta: null,
    }
  }
  if (
    lastHourCandle &&
    typeof lastHourCandle === "object" &&
    "volume" in lastHourCandle
  ) {
    const volume = Number(lastHourCandle.volume ?? 0)
    if (!Number.isFinite(volume) || volume <= 0) {
      return {
        tradable: false,
        reason: "ZERO_VOLUME",
        meta: null,
      }
    }
  }
  const limits = computeLimitPrices(prev)
  if (!limits) {
    return {
      tradable: false,
      reason: "LIMITS_MISSING",
      meta: null,
    }
  }
  const { upperLimit, lowerLimit, upperTick, lowerTick } = limits
  if (Math.abs(price - upperLimit) <= upperTick) {
    return {
      tradable: false,
      reason: "LIMIT_UP",
      meta: limits,
    }
  }
  if (Math.abs(price - lowerLimit) <= lowerTick) {
    return {
      tradable: false,
      reason: "LIMIT_DOWN",
      meta: limits,
    }
  }
  return { tradable: true, reason: null, meta: limits }
}

export const buildCalendarIndex = (calendar) => {
  const list = Array.isArray(calendar) ? [...calendar] : []
  if (!list.length) {
    return null
  }
  list.sort((a, b) => String(a).localeCompare(String(b)))
  const index = new Map(list.map((key, idx) => [key, idx]))
  return { list, index }
}

export const resolvePrevTradingDay = (dateKey, calendarIndex) => {
  const target = String(dateKey ?? "").trim()
  if (!target) {
    return null
  }
  if (calendarIndex?.index?.has(target)) {
    const idx = calendarIndex.index.get(target)
    if (idx > 0) {
      return calendarIndex.list[idx - 1]
    }
  }
  let cursor = target
  for (let i = 0; i < 10; i += 1) {
    const prev = shiftDateKey(cursor, -1)
    if (!prev) {
      break
    }
    cursor = prev
    if (isWeekend(prev)) {
      continue
    }
    return prev
  }
  return null
}

export const filterGapCandidatesByTradability = ({
  candidates,
  price15Map,
  prevCloseBySymbol,
  lastHourBySymbol,
}) => {
  const stats = {
    filteredCount: 0,
    filteredByTradabilityCount: 0,
    filteredByUpperLimitCount: 0,
    filteredByLowerLimitCount: 0,
    filteredMissingPrice15Count: 0,
    filteredMissingPrevCloseCount: 0,
    filteredByZeroVolumeCount: 0,
  }
  const filtered = []
  for (const candidate of candidates ?? []) {
    const symbol = String(candidate?.symbol ?? "").trim()
    if (!symbol) {
      continue
    }
    const price15 = price15Map?.get(symbol) ?? null
    const prevClose = prevCloseBySymbol?.get(symbol) ?? null
    const lastHourCandle = lastHourBySymbol?.get(symbol) ?? null
    const verdict = isTradableAt1500({
      price15,
      prevClose,
      lastHourCandle,
    })
    if (verdict.tradable) {
      filtered.push(candidate)
      continue
    }
    stats.filteredCount += 1
    stats.filteredByTradabilityCount += 1
    switch (verdict.reason) {
      case "LIMIT_UP":
        stats.filteredByUpperLimitCount += 1
        break
      case "LIMIT_DOWN":
        stats.filteredByLowerLimitCount += 1
        break
      case "MISSING_PRICE15":
        stats.filteredMissingPrice15Count += 1
        break
      case "MISSING_PREVCLOSE":
        stats.filteredMissingPrevCloseCount += 1
        break
      case "ZERO_VOLUME":
        stats.filteredByZeroVolumeCount += 1
        break
      default:
        stats.filteredMissingPrice15Count += 1
        break
    }
  }
  return { candidates: filtered, stats }
}

export const filterGapSignalsByTradability = ({
  signals,
  price15Map,
  prevCloseByKey,
  calendarIndex,
  lastHourBySymbol,
}) => {
  const stats = {
    filteredCount: 0,
    filteredByTradabilityCount: 0,
    filteredByUpperLimitCount: 0,
    filteredByLowerLimitCount: 0,
    filteredMissingPrice15Count: 0,
    filteredMissingPrevCloseCount: 0,
    filteredByZeroVolumeCount: 0,
  }
  const filtered = []
  for (const signal of signals ?? []) {
    const track = String(signal?.track ?? "SURGE_EOD").toUpperCase()
    if (track !== "GAP_15_BET") {
      filtered.push(signal)
      continue
    }
    const symbol = String(signal?.symbol ?? "").trim()
    const dateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const prevDateKey = resolvePrevTradingDay(dateKey, calendarIndex)
    const prevClose = prevDateKey
      ? (prevCloseByKey?.get(`${symbol}:${prevDateKey}`) ?? null)
      : null
    const price15 = price15Map?.get(`${symbol}:${dateKey}`) ?? null
    const lastHourCandle = lastHourBySymbol?.get(symbol) ?? null
    const verdict = isTradableAt1500({
      price15,
      prevClose,
      lastHourCandle,
    })
    if (verdict.tradable) {
      filtered.push(signal)
      continue
    }
    stats.filteredCount += 1
    stats.filteredByTradabilityCount += 1
    switch (verdict.reason) {
      case "LIMIT_UP":
        stats.filteredByUpperLimitCount += 1
        break
      case "LIMIT_DOWN":
        stats.filteredByLowerLimitCount += 1
        break
      case "MISSING_PRICE15":
        stats.filteredMissingPrice15Count += 1
        break
      case "MISSING_PREVCLOSE":
        stats.filteredMissingPrevCloseCount += 1
        break
      case "ZERO_VOLUME":
        stats.filteredByZeroVolumeCount += 1
        break
      default:
        stats.filteredMissingPrice15Count += 1
        break
    }
  }
  return { signals: filtered, stats }
}
