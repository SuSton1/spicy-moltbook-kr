import { normalizeDateKey } from "../ai-date-range.lib.mjs"
import { buildGapFeatureDays, buildGapIntradaySeq } from "../lib/gap15.mjs"
import { extractTrainRange } from "../lib/patternVersions.mjs"

const asKey = (value) => {
  const key = normalizeDateKey(value)
  return key ? String(key) : null
}

export const resolvePrevTradingDay = ({ calendar, dateKey }) => {
  const list = Array.isArray(calendar) ? calendar : []
  const target = asKey(dateKey)
  if (!target) {
    return null
  }
  const idx = list.findIndex((item) => asKey(item) === target)
  if (idx <= 0) {
    return null
  }
  return asKey(list[idx - 1])
}

export const assertGapPatternSafe = ({ patterns, windowStart }) => {
  const label = patterns?.versionLabel ?? null
  const { trainToDateKey } = extractTrainRange(label)
  const startKey = asKey(windowStart)
  if (!trainToDateKey) {
    throw new Error("GAP_PATTERN_TRAIN_RANGE_MISSING")
  }
  if (startKey && trainToDateKey > startKey) {
    throw new Error(`GAP_PATTERN_LOOKAHEAD:${trainToDateKey}`)
  }
}

const ensureGapLookaheadCache = (data) => {
  const target = data && typeof data === "object" ? data : null
  if (!target) {
    return {
      hourlyByDate: null,
      featureByDate: null,
      candleByDate: null,
      price15ByDate: null,
    }
  }
  const existing = target.__gapLookaheadCache
  if (existing) {
    return existing
  }

  const indexByDate = (rows, dateField) => {
    const map = new Map()
    for (const row of rows ?? []) {
      const dateKey = asKey(row?.[dateField])
      if (!dateKey) continue
      const list = map.get(dateKey) ?? []
      list.push(row)
      map.set(dateKey, list)
    }
    return map
  }

  const cache = {
    hourlyByDate:
      target.hourly60mByDate && typeof target.hourly60mByDate.get === "function"
        ? target.hourly60mByDate
        : Array.isArray(target.hourly60m)
          ? indexByDate(target.hourly60m, "tradingDateKey")
          : null,
    featureByDate: indexByDate(target.featureDays, "tradingDateKey"),
    candleByDate: indexByDate(target.candles, "dateKey"),
    price15ByDate: indexByDate(target.price15, "tradingDateKey"),
  }

  Object.defineProperty(target, "__gapLookaheadCache", {
    value: cache,
    enumerable: false,
  })
  return cache
}

const buildPrice15Map = (cache, dateKey) => {
  const key = asKey(dateKey)
  if (!key) return new Map()
  const rows = cache?.price15ByDate?.get(key) ?? []
  return new Map(
    rows.map((row) => [
      String(row.symbol ?? "").trim(),
      Number(row.price ?? 0),
    ]),
  )
}

const buildPrevCloseMap = (cache, prevTradingDay) => {
  const key = asKey(prevTradingDay)
  if (!key) return new Map()
  const rows = cache?.candleByDate?.get(key) ?? []
  return new Map(
    rows.map((row) => [
      String(row.symbol ?? "").trim(),
      Number(row.close ?? 0),
    ]),
  )
}

const buildPrevFeatureMap = (cache, prevTradingDay) => {
  const key = asKey(prevTradingDay)
  if (!key) return new Map()
  const rows = cache?.featureByDate?.get(key) ?? []
  return new Map(
    rows.map((row) => [String(row.symbol ?? "").trim(), row.features ?? null]),
  )
}

const buildHourlyMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    if (!symbol) {
      continue
    }
    const list = map.get(symbol) ?? []
    list.push(row)
    map.set(symbol, list)
  }
  return map
}

export const buildGapDataForDate = ({
  data,
  symbols,
  dateKey,
  prevTradingDay,
  strictAfter1500 = true,
}) => {
  if (!prevTradingDay) {
    throw new Error("GAP_PREV_TRADING_DAY_REQUIRED")
  }
  const cache = ensureGapLookaheadCache(data)
  const hourlyKey = asKey(dateKey)
  if (!cache?.hourlyByDate) {
    throw new Error("GAP_HOURLY60M_REQUIRED")
  }
  const hourlyRows = hourlyKey ? (cache.hourlyByDate.get(hourlyKey) ?? []) : []
  const lastHourBySymbol = new Map()
  for (const row of hourlyRows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    if (!symbol) {
      continue
    }
    const ts = row?.tsKst ? new Date(row.tsKst) : null
    if (!ts || Number.isNaN(ts.getTime())) {
      continue
    }
    if (ts.getUTCHours() !== 14) {
      continue
    }
    lastHourBySymbol.set(symbol, row)
  }
  const hourlyBySymbol = buildHourlyMap(hourlyRows)
  const intradaySeqBySymbol = new Map()
  const intradayProfiles = []
  for (const meta of symbols ?? []) {
    const symbol = String(meta?.symbol ?? "").trim()
    if (!symbol) {
      continue
    }
    const rows = hourlyBySymbol.get(symbol) ?? []
    const result = buildGapIntradaySeq({
      rows,
      strictAfter1500,
    })
    const seq = result.seq
    if (seq?.closeSeq?.length) {
      intradaySeqBySymbol.set(symbol, seq)
      intradayProfiles.push({
        symbol,
        tradingDateKey: dateKey,
        seq,
      })
    }
  }

  const prevFeaturesBySymbol = buildPrevFeatureMap(cache, prevTradingDay)
  const price15BySymbol = buildPrice15Map(cache, dateKey)
  const prevCloseBySymbol = buildPrevCloseMap(cache, prevTradingDay)

  const featureDays = buildGapFeatureDays({
    symbols,
    asOfDateKey: dateKey,
    prevFeaturesBySymbol,
    price15BySymbol,
    prevCloseBySymbol,
    intradaySeqBySymbol,
  })

  return { featureDays, intradayProfiles, lastHourBySymbol }
}
