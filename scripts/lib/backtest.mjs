import { parseDateKey, shiftDateKey } from "../ai-date-range.lib.mjs"
import { toWeekKeyKst } from "./weekKey.mjs"
import { applyCostsToGrossPct } from "./costModel.mjs"
import { getEvalOhlc } from "./priceAdjust.mjs"

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const createAdjustedMetaTracker = () => {
  let adjustedMetaMissingReason = null
  let adjustedSource = null
  let adjustedFactor = null
  return {
    track(candle) {
      if (!candle) return
      if (!adjustedSource && candle.adjustedSource) {
        adjustedSource = candle.adjustedSource
      }
      if (!adjustedFactor && Number.isFinite(candle.adjustedFactor)) {
        adjustedFactor = candle.adjustedFactor
      }
      if (!adjustedMetaMissingReason && candle.adjustedMetaMissingReason) {
        adjustedMetaMissingReason = candle.adjustedMetaMissingReason
      }
    },
    summary() {
      return { adjustedMetaMissingReason, adjustedSource, adjustedFactor }
    },
  }
}

const applyCosts = (grossReturnPct, costModel) =>
  applyCostsToGrossPct(grossReturnPct, costModel)

const isWeekend = (dateKey) => {
  const parts = parseDateKey(dateKey)
  if (!parts) {
    return false
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6
}

const buildCalendarIndex = (calendar) => {
  const list = Array.isArray(calendar) ? [...calendar] : []
  if (!list.length) {
    return null
  }
  list.sort((a, b) => String(a).localeCompare(String(b)))
  const index = new Map(list.map((key, idx) => [key, idx]))
  return { list, index }
}

const buildNextTradingDays = (fromDateKey, count, calendarIndex) => {
  const out = []
  if (calendarIndex?.index?.has(fromDateKey)) {
    const start = calendarIndex.index.get(fromDateKey)
    for (let i = start + 1; i < calendarIndex.list.length; i += 1) {
      out.push(calendarIndex.list[i])
      if (out.length >= count) {
        break
      }
    }
    return out
  }

  let cursor = fromDateKey
  while (out.length < count) {
    const next = shiftDateKey(cursor, 1)
    if (!next) {
      break
    }
    cursor = next
    if (isWeekend(next)) {
      continue
    }
    out.push(next)
  }
  return out
}

export const buildCandleMap = (candles) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const evalOhlc = getEvalOhlc(row)
    const entry = map.get(symbol) ?? new Map()
    entry.set(dateKey, {
      open: evalOhlc.open,
      high: evalOhlc.high,
      low: evalOhlc.low,
      close: evalOhlc.close,
      adjustedFactor: evalOhlc.adjustedFactor,
      adjustedSource: evalOhlc.adjustedSource,
      adjustedMetaMissingReason: evalOhlc.adjustedMetaMissingReason,
    })
    map.set(symbol, entry)
  }
  return map
}

export const buildPrice15Map = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(`${symbol}:${dateKey}`, toNumber(row?.price))
  }
  return map
}

const entryTouched = (candle, buyLow, buyHigh) => {
  if (!candle) {
    return false
  }
  if (!Number.isFinite(buyLow) || !Number.isFinite(buyHigh)) {
    return false
  }
  return candle.low <= buyHigh && candle.high >= buyLow
}

const targetTouched = (candle, targetLow) => {
  if (!candle || !Number.isFinite(targetLow)) {
    return false
  }
  return candle.high >= targetLow
}

const stopTouched = (candle, stopHigh) => {
  if (!candle || !Number.isFinite(stopHigh)) {
    return false
  }
  return candle.low <= stopHigh
}

const resolveEntryPrice = (candle, buyLow, buyHigh) => {
  if (!candle) {
    return null
  }
  const open = toNumber(candle.open)
  if (
    Number.isFinite(open) &&
    Number.isFinite(buyLow) &&
    Number.isFinite(buyHigh) &&
    open >= buyLow &&
    open <= buyHigh
  ) {
    return open
  }
  const touched = entryTouched(candle, buyLow, buyHigh)
  if (!touched) {
    return null
  }
  if (Number.isFinite(buyHigh)) {
    return buyHigh
  }
  if (Number.isFinite(buyLow)) {
    return buyLow
  }
  return null
}

const resolveExitForDay = ({ candle, stopHigh, sellLow }) => {
  if (!candle) {
    return null
  }
  const open = toNumber(candle.open)
  const high = toNumber(candle.high)
  const low = toNumber(candle.low)
  if (Number.isFinite(stopHigh) && Number.isFinite(open) && open <= stopHigh) {
    return { outcome: "FAIL", exitPrice: open, reason: "STOP_GAP" }
  }
  if (Number.isFinite(sellLow) && Number.isFinite(open) && open >= sellLow) {
    return { outcome: "WIN", exitPrice: sellLow, reason: "TARGET_GAP" }
  }
  if (Number.isFinite(stopHigh) && Number.isFinite(low) && low <= stopHigh) {
    return { outcome: "FAIL", exitPrice: stopHigh, reason: "STOP_HIT" }
  }
  if (Number.isFinite(sellLow) && Number.isFinite(high) && high >= sellLow) {
    return { outcome: "WIN", exitPrice: sellLow, reason: "TARGET_HIT" }
  }
  return null
}

export const evaluateEodSignal = ({
  signal,
  candleMap,
  calendarIndex,
  costModel,
}) => {
  const symbol = String(signal.symbol ?? "").trim()
  const dateKey = String(signal.tradingDateKey ?? "").trim()
  const buyLow = toNumber(signal.buyLow)
  const buyHigh = toNumber(signal.buyHigh)
  const stopHigh = toNumber(signal.stopHigh)
  const sellLow = toNumber(signal.sellLow)
  const adjustedMeta = createAdjustedMetaTracker()
  const withAdjustedMeta = (payload) => ({
    ...payload,
    ...adjustedMeta.summary(),
  })

  if (!symbol || !dateKey || !candleMap.has(symbol)) {
    return withAdjustedMeta({
      outcome: "FAIL",
      returnPct: -1,
      grossReturnPct: -1,
      reason: "MISSING_CANDLE",
      mfePct: null,
      filled: false,
      status: "NO_FILL",
      entryDateKey: null,
      exitDateKey: null,
    })
  }

  const entryWindowDaysRaw = Number(signal.entryWindowDays)
  const entryWindowDays = Number.isFinite(entryWindowDaysRaw)
    ? Math.max(1, Math.min(10, Math.floor(entryWindowDaysRaw)))
    : 1
  const entryWindow = buildNextTradingDays(
    dateKey,
    entryWindowDays,
    calendarIndex,
  )
  const candleByDate = candleMap.get(symbol)

  let entryFilled = false
  let entryDate = null
  let entryRef = null

  for (const day of entryWindow) {
    const candle = candleByDate?.get(day) ?? null
    adjustedMeta.track(candle)
    const entryPrice = resolveEntryPrice(candle, buyLow, buyHigh)
    if (!entryFilled && targetTouched(candle, sellLow) && !entryPrice) {
      return withAdjustedMeta({
        outcome: "FAIL",
        returnPct: -1,
        grossReturnPct: -1,
        reason: "TARGET_BEFORE_ENTRY",
        mfePct: null,
        filled: false,
        status: "NO_FILL",
        entryDateKey: null,
        exitDateKey: null,
      })
    }
    if (Number.isFinite(entryPrice)) {
      entryFilled = true
      entryDate = day
      entryRef = entryPrice
      break
    }
  }

  if (!entryFilled || !entryDate || !Number.isFinite(entryRef)) {
    return withAdjustedMeta({
      outcome: "FAIL",
      returnPct: -1,
      grossReturnPct: -1,
      reason: "NO_FILL",
      mfePct: null,
      filled: false,
      status: "NO_FILL",
      entryDateKey: null,
      exitDateKey: null,
    })
  }

  const evalWindow = [
    entryDate,
    ...buildNextTradingDays(entryDate, 1, calendarIndex),
  ]
  let mfe = 0

  for (const day of evalWindow) {
    const candle = candleByDate?.get(day) ?? null
    if (!candle) {
      continue
    }
    adjustedMeta.track(candle)
    const dayMfe = (candle.high - entryRef) / entryRef
    if (Number.isFinite(dayMfe)) {
      mfe = Math.max(mfe, dayMfe)
    }

    const exit = resolveExitForDay({
      candle,
      stopHigh,
      sellLow,
    })
    if (exit) {
      const grossReturnPct = Number.isFinite(exit.exitPrice)
        ? ((exit.exitPrice - entryRef) / entryRef) * 100
        : -1
      const netReturnPct = applyCosts(grossReturnPct, costModel)
      return withAdjustedMeta({
        outcome: exit.outcome,
        returnPct: netReturnPct,
        grossReturnPct,
        reason: exit.reason,
        mfePct: mfe * 100,
        filled: true,
        status: "CLOSED",
        entryDateKey: entryDate,
        exitDateKey: day,
      })
    }
  }

  const lastDay = evalWindow[evalWindow.length - 1] ?? entryDate
  const lastCandle = candleByDate?.get(lastDay) ?? null
  adjustedMeta.track(lastCandle)
  const lastClose = toNumber(lastCandle?.close)
  const grossReturnPct = Number.isFinite(lastClose)
    ? ((lastClose - entryRef) / entryRef) * 100
    : -1
  const netReturnPct = applyCosts(grossReturnPct, costModel)
  return withAdjustedMeta({
    outcome: "FAIL",
    returnPct: netReturnPct,
    grossReturnPct,
    reason: "EXPIRE_NO_EXIT",
    mfePct: mfe * 100,
    filled: true,
    status: "CLOSED",
    entryDateKey: entryDate,
    exitDateKey: lastDay,
  })
}

export const evaluateGapSignal = ({
  signal,
  candleMap,
  price15Map,
  calendarIndex,
  costModel,
}) => {
  const symbol = String(signal.symbol ?? "").trim()
  const dateKey = String(signal.tradingDateKey ?? "").trim()
  const adjustedMeta = createAdjustedMetaTracker()
  const withAdjustedMeta = (payload) => ({
    ...payload,
    ...adjustedMeta.summary(),
  })
  if (!symbol || !dateKey) {
    return withAdjustedMeta({
      outcome: "FAIL",
      returnPct: -1,
      grossReturnPct: -1,
      reason: "MISSING_SYMBOL",
      mfePct: null,
      filled: false,
      status: "NO_FILL",
      entryDateKey: null,
      exitDateKey: null,
    })
  }
  const price15Raw = price15Map.get(`${symbol}:${dateKey}`)
  const baseCandle = candleMap.get(symbol)?.get(dateKey) ?? null
  adjustedMeta.track(baseCandle)
  const price15Factor = Number.isFinite(baseCandle?.adjustedFactor)
    ? baseCandle.adjustedFactor
    : 1
  const price15 = Number.isFinite(price15Raw)
    ? price15Raw * price15Factor
    : price15Raw
  if (!Number.isFinite(price15)) {
    return withAdjustedMeta({
      outcome: "FAIL",
      returnPct: -1,
      grossReturnPct: -1,
      reason: "PRICE15_MISSING",
      mfePct: null,
      filled: false,
      status: "NO_FILL",
      entryDateKey: null,
      exitDateKey: null,
    })
  }

  const nextDay = buildNextTradingDays(dateKey, 1, calendarIndex)[0]
  const candle = nextDay ? (candleMap.get(symbol)?.get(nextDay) ?? null) : null
  adjustedMeta.track(candle)
  if (!candle || !Number.isFinite(candle.open)) {
    return withAdjustedMeta({
      outcome: "FAIL",
      returnPct: -1,
      grossReturnPct: -1,
      reason: "NEXT_OPEN_MISSING",
      mfePct: null,
      filled: false,
      status: "NO_FILL",
      entryDateKey: null,
      exitDateKey: null,
    })
  }

  const grossReturnPct = ((candle.open - price15) / price15) * 100
  const netReturnPct = applyCosts(grossReturnPct, costModel)
  const win = candle.open >= price15 * 1.01
  return withAdjustedMeta({
    outcome: win ? "WIN" : "FAIL",
    returnPct: netReturnPct,
    grossReturnPct,
    reason: win ? "GAP_OK" : "GAP_MISS",
    mfePct: ((candle.open - price15) / price15) * 100,
    filled: true,
    status: "CLOSED",
    entryDateKey: dateKey,
    exitDateKey: nextDay ?? null,
  })
}

export const runBacktest = ({
  signals,
  candles,
  price15,
  calendar,
  costModel,
}) => {
  const candleMap = buildCandleMap(candles)
  const price15Map = buildPrice15Map(price15)
  const calendarIndex = buildCalendarIndex(calendar)

  const results = []
  for (const signal of signals ?? []) {
    const track = String(signal.track ?? "SURGE_EOD").toUpperCase()
    const result =
      track === "GAP_15_BET"
        ? evaluateGapSignal({
            signal,
            candleMap,
            price15Map,
            calendarIndex,
            costModel,
          })
        : evaluateEodSignal({ signal, candleMap, calendarIndex, costModel })

    results.push({
      id: String(signal.id ?? ""),
      symbol: String(signal.symbol ?? ""),
      tradingDateKey: String(signal.tradingDateKey ?? ""),
      track,
      role: signal.role ?? null,
      outcome: result.outcome,
      returnPct: result.returnPct,
      grossReturnPct: result.grossReturnPct ?? null,
      adjustedMetaMissingReason: result.adjustedMetaMissingReason ?? null,
      adjustedSource: result.adjustedSource ?? null,
      adjustedFactor: result.adjustedFactor ?? null,
      reason: result.reason,
      mfePct: result.mfePct,
      filled: result.filled,
      status: result.status ?? (result.filled ? "CLOSED" : "NO_FILL"),
      entryDateKey: result.entryDateKey ?? null,
      exitDateKey: result.exitDateKey ?? null,
    })
  }
  return results
}

export const buildWeeklySeries = (results, options = {}) => {
  const weekKeys = Array.isArray(options.weekKeys) ? options.weekKeys : null
  const emptyWeekReturnPct = Number.isFinite(options.emptyWeekReturnPct)
    ? options.emptyWeekReturnPct
    : null
  const roleFilter = options.roleFilter ?? null
  const weekSet = weekKeys ? new Set(weekKeys) : null
  const weekly = new Map()
  for (const row of results ?? []) {
    const role = String(row.role ?? "").toUpperCase()
    if (roleFilter === "CORE_ONLY" && role === "MOONSHOT") {
      continue
    }
    const exitDateKey = String(row.exitDateKey ?? "").trim()
    const closed = row.status === "CLOSED" && row.filled === true && exitDateKey
    if (!closed) {
      continue
    }
    const weekKey = toWeekKeyKst(exitDateKey)
    if (weekSet && !weekSet.has(weekKey)) {
      continue
    }
    const entry = weekly.get(weekKey) ?? {
      weekKey,
      weeklyReturnPct: 0,
      completedTrades: 0,
      trades: 0,
    }
    entry.trades += 1
    entry.completedTrades += 1
    entry.weeklyReturnPct += Number(row.returnPct ?? 0) || 0
    weekly.set(weekKey, entry)
  }
  if (weekKeys) {
    return weekKeys.map((weekKey) => {
      return (
        weekly.get(weekKey) ?? {
          weekKey,
          weeklyReturnPct: emptyWeekReturnPct !== null ? emptyWeekReturnPct : 0,
          completedTrades: 0,
          trades: 0,
        }
      )
    })
  }
  return Array.from(weekly.values()).sort((a, b) =>
    String(a.weekKey).localeCompare(String(b.weekKey)),
  )
}

export const countNoFillResults = (results) =>
  (results ?? []).filter((row) => row?.status === "NO_FILL").length

export const buildWeeklyMetrics = ({
  weekSeries,
  highWeekPct,
  minOtherWeekPct,
  requireCompletedTradesEveryWeek,
  targetPct,
}) => {
  const list = Array.isArray(weekSeries) ? weekSeries : []
  const highs = Number(highWeekPct ?? 10)
  const minOther = Number(minOtherWeekPct ?? 0.01)
  const minTrades = Number.isFinite(requireCompletedTradesEveryWeek)
    ? requireCompletedTradesEveryWeek
    : 1
  const target = Number(targetPct ?? NaN)
  const targetReady = Number.isFinite(target)

  let countHighWeeks = 0
  let countWeeksBelowMinOther = 0
  let countWeeksMissingCompletedTrades = 0
  let countWeeksGE = 0
  let emptyWeeksCount = 0
  let totalWeeklySumPct = 0
  const values = []

  for (const row of list) {
    const pct = Number(row.weeklyReturnPct ?? 0) || 0
    const completed = Number(row.completedTrades ?? 0) || 0
    if (completed === 0) {
      emptyWeeksCount += 1
    }
    if (pct >= highs) {
      countHighWeeks += 1
    }
    if (pct < minOther) {
      countWeeksBelowMinOther += 1
    }
    if (completed < minTrades) {
      countWeeksMissingCompletedTrades += 1
    }
    if (targetReady && pct >= target) {
      countWeeksGE += 1
    }
    totalWeeklySumPct += pct
    values.push(pct)
  }

  const sorted = [...values].sort((a, b) => a - b)
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

  return {
    countHighWeeks,
    countWeeksBelowMinOther,
    countWeeksMissingCompletedTrades,
    countWeeksGE: targetReady ? countWeeksGE : null,
    emptyWeeksCount,
    totalWeeklySumPct,
    minWeeklyPct: sorted.length ? sorted[0] : 0,
    medianWeeklyPct: median,
    maxWeeklyPct: sorted.length ? sorted[sorted.length - 1] : 0,
  }
}

const buildCandleIndex = (candles) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const evalOhlc = getEvalOhlc(row)
    const entry = map.get(symbol) ?? new Map()
    entry.set(dateKey, {
      open: evalOhlc.open,
      high: evalOhlc.high,
      low: evalOhlc.low,
      close: evalOhlc.close,
      adjustedFactor: evalOhlc.adjustedFactor,
      adjustedSource: evalOhlc.adjustedSource,
      adjustedMetaMissingReason: evalOhlc.adjustedMetaMissingReason,
    })
    map.set(symbol, entry)
  }
  return map
}

const buildDateKeyListFromCandles = (candles) => {
  const out = new Set()
  for (const row of candles ?? []) {
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (dateKey) {
      out.add(dateKey)
    }
  }
  return Array.from(out).sort((a, b) => String(a).localeCompare(String(b)))
}

const resolveNextTradingDateKey = (dateKey, calendar, fallbackKeys) => {
  const target = String(dateKey ?? "").trim()
  if (!target) {
    return null
  }
  const list = Array.isArray(calendar) ? calendar : []
  if (list.length) {
    const idx = list.findIndex((key) => key === target)
    if (idx >= 0) {
      return idx + 1 < list.length ? list[idx + 1] : null
    }
    for (const key of list) {
      if (String(key) > target) {
        return key
      }
    }
  }
  const fallback = Array.isArray(fallbackKeys) ? fallbackKeys : []
  for (const key of fallback) {
    if (String(key) > target) {
      return key
    }
  }
  return null
}

export const computeBigUpMetrics = ({
  signals,
  candles,
  calendar,
  weekKeys,
  highUpThreshold = 0.1,
  gapThreshold = 0.03,
}) => {
  const weekSet = Array.isArray(weekKeys) ? new Set(weekKeys) : null
  const candleIndex = buildCandleIndex(candles)
  const fallbackKeys = buildDateKeyListFromCandles(candles)
  const bigUpWeekKeys = new Set()
  let bigUpExcludedByGapCount = 0

  for (const signal of signals ?? []) {
    const symbol = String(signal?.symbol ?? "").trim()
    const signalDateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!symbol || !signalDateKey) {
      continue
    }
    const evalDateKey = resolveNextTradingDateKey(
      signalDateKey,
      calendar,
      fallbackKeys,
    )
    if (!evalDateKey) {
      continue
    }
    const weekKey = toWeekKeyKst(evalDateKey)
    if (weekSet && !weekSet.has(weekKey)) {
      continue
    }
    const symbolMap = candleIndex.get(symbol)
    const prev = symbolMap?.get(signalDateKey)
    const evalCandle = symbolMap?.get(evalDateKey)
    const prevClose = prev?.close
    const open = evalCandle?.open
    const high = evalCandle?.high
    if (
      !Number.isFinite(prevClose) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high)
    ) {
      continue
    }
    const highUpPct = high / prevClose - 1
    const openGapPct = open / prevClose - 1
    if (highUpPct >= highUpThreshold) {
      if (openGapPct >= gapThreshold) {
        bigUpExcludedByGapCount += 1
        continue
      }
      if (weekKey && weekKey !== "unknown") {
        bigUpWeekKeys.add(weekKey)
      }
    }
  }

  return {
    bigUpWeeksCount24: bigUpWeekKeys.size,
    bigUpExcludedByGapCount,
    bigUpWeekKeys: Array.from(bigUpWeekKeys).sort((a, b) =>
      String(a).localeCompare(String(b)),
    ),
  }
}
