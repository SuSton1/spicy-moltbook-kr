import { normalizeDateKey, uniqueSortedDateKeys } from "./date.mjs"
import { readJsonl } from "./io.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveSymbolAllowSet = (symbolAllowSet) =>
  symbolAllowSet instanceof Set ? symbolAllowSet : null

const symbolFilter = (symbolAllowSet) => {
  const allow = resolveSymbolAllowSet(symbolAllowSet)
  if (!allow) return null
  return (row) => {
    const symbol = String(row?.symbol ?? "").trim()
    return symbol.length > 0 && allow.has(symbol)
  }
}

export const loadRawData = async (dataPaths) => {
  const candles = await readJsonl(dataPaths.candleDailyJsonl)
  const universe = await readJsonl(dataPaths.universeJsonl)
  const symbolMaster = await readJsonl(dataPaths.symbolMasterJsonl)
  const hourly60m = await readJsonl(dataPaths.hourly60mJsonl)

  return {
    candles,
    universe,
    symbolMaster,
    hourly60m
  }
}

export const loadStepAData = async (dataPaths, options = {}) => {
  const includeHourly60m = options?.includeHourly60m !== false
  const bySymbol = symbolFilter(options?.symbolAllowSet)
  const candles = await readJsonl(dataPaths.candleDailyJsonl, { filter: bySymbol })
  const universe = await readJsonl(dataPaths.universeJsonl, { filter: bySymbol })
  const symbolMaster = await readJsonl(dataPaths.symbolMasterJsonl, { filter: bySymbol })
  const hourly60m = includeHourly60m
    ? await readJsonl(dataPaths.hourly60mJsonl, { filter: bySymbol })
    : []

  return {
    candles,
    universe,
    symbolMaster,
    hourly60m
  }
}

export const loadStepASupplementalData = async (dataPaths, options = {}) => {
  const includeHourly60m = options?.includeHourly60m !== false
  const bySymbol = symbolFilter(options?.symbolAllowSet)
  const symbolMaster = await readJsonl(dataPaths.symbolMasterJsonl, { filter: bySymbol })
  const hourly60m = includeHourly60m
    ? await readJsonl(dataPaths.hourly60mJsonl, { filter: bySymbol })
    : []
  return {
    symbolMaster,
    hourly60m
  }
}

export const loadStepBData = async (dataPaths, options = {}) => {
  const bySymbol = symbolFilter(options?.symbolAllowSet)
  const candles = await readJsonl(dataPaths.candleDailyJsonl, { filter: bySymbol })
  const universe = await readJsonl(dataPaths.universeJsonl, { filter: bySymbol })

  return {
    candles,
    universe
  }
}

export const loadStepDEData = async (dataPaths, options = {}) => {
  const bySymbol = symbolFilter(options?.symbolAllowSet)
  const includeCandles = options?.includeCandles !== false
  const includeUniverse = options?.includeUniverse !== false
  const includeSymbolMaster = options?.includeSymbolMaster !== false
  const includeHourly60m = options?.includeHourly60m !== false
  const candles = includeCandles ? await readJsonl(dataPaths.candleDailyJsonl, { filter: bySymbol }) : []
  const universe = includeUniverse ? await readJsonl(dataPaths.universeJsonl, { filter: bySymbol }) : []
  const symbolMaster = includeSymbolMaster
    ? await readJsonl(dataPaths.symbolMasterJsonl, { filter: bySymbol })
    : []
  const hourly60m = includeHourly60m
    ? await readJsonl(dataPaths.hourly60mJsonl, { filter: bySymbol })
    : []

  return {
    candles,
    universe,
    symbolMaster,
    hourly60m
  }
}

export const buildCandleSeriesMap = (candles, symbolAllowSet = null) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    if (symbolAllowSet && !symbolAllowSet.has(symbol)) continue
    const dateKey = normalizeDateKey(row?.dateKey ?? row?.tradingDateKey)
    if (!symbol || !dateKey) continue
    const list = map.get(symbol) ?? []
    row.symbol = symbol
    row.dateKey = dateKey
    row.open = num(row?.open)
    row.high = num(row?.high)
    row.low = num(row?.low)
    row.close = num(row?.close)
    row.volume = num(row?.volume)
    list.push(row)
    map.set(symbol, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  }
  return map
}

export const buildCandleDateIndexMap = (seriesMap) => {
  const out = new Map()
  for (const [symbol, series] of seriesMap.entries()) {
    const idx = new Map()
    for (let i = 0; i < series.length; i += 1) {
      idx.set(series[i].dateKey, i)
    }
    out.set(symbol, idx)
  }
  return out
}

export const buildUniverseMap = (rows, symbolAllowSet = null) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    if (symbolAllowSet && !symbolAllowSet.has(symbol)) continue
    const dateKey = normalizeDateKey(row?.tradingDateKey ?? row?.dateKey)
    if (!symbol || !dateKey) continue
    row.symbol = symbol
    row.dateKey = dateKey
    row.marketCapKrw = num(row?.marketCapKrw ?? row?.marketCapKRW ?? row?.marketCap)
    row.avgTradingValue20d = num(row?.avgTradingValue20d)
    row.tradingValue = num(row?.tradingValue)
    map.set(`${symbol}:${dateKey}`, row)
  }
  return map
}

export const buildSymbolMasterMap = (rows, symbolAllowSet = null) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    if (symbolAllowSet && !symbolAllowSet.has(symbol)) continue
    if (!symbol) continue
    row.symbol = symbol
    row.name = String(row?.name ?? "").trim()
    row.type = String(row?.type ?? "").trim().toUpperCase()
    row.isListed = row?.isListed !== false
    map.set(symbol, row)
  }
  return map
}

export const collectTradingDates = (candles) => uniqueSortedDateKeys(candles, "dateKey")
