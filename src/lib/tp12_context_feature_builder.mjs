import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import zlib from "node:zlib"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const rowDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey)
const keyOf = (symbol, dateKey) => `${symbol}\t${dateKey}`

const requirePositive = (value, label) => {
  const numeric = toNumber(value, NaN)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be positive: ${value}`)
  return numeric
}

const requireNonNegative = (value, label) => {
  const numeric = toNumber(value, NaN)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${label} must be non-negative: ${value}`)
  return numeric
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length < 1) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const average = (values) => {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 1) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

const averageWindow = (prefix, index, windowSize) => {
  if (index + 1 < windowSize) return null
  return (prefix[index + 1] - prefix[index + 1 - windowSize]) / windowSize
}

const countedAverageWindow = (sumPrefix, countPrefix, index, windowSize) => {
  if (index + 1 < windowSize) return null
  const count = countPrefix[index + 1] - countPrefix[index + 1 - windowSize]
  if (count !== windowSize) return null
  return (sumPrefix[index + 1] - sumPrefix[index + 1 - windowSize]) / windowSize
}

const windowRows = (rows, index, windowSize) => {
  if (index + 1 < windowSize) return []
  return rows.slice(index + 1 - windowSize, index + 1)
}

const normalizeCandle = (row, context) => {
  const symbol = rowSymbol(row)
  const dateKey = rowDateKey(row)
  if (!symbol) throw new Error(`candle row missing symbol at ${context.filePath}:${context.lineNumber}`)
  if (!validDateKey(dateKey)) throw new Error(`candle row invalid dateKey at ${context.filePath}:${context.lineNumber}: ${dateKey || "missing"}`)
  const open = requirePositive(row?.open, `open at ${symbol}/${dateKey}`)
  const high = requirePositive(row?.high, `high at ${symbol}/${dateKey}`)
  const low = requirePositive(row?.low, `low at ${symbol}/${dateKey}`)
  const close = requirePositive(row?.close, `close at ${symbol}/${dateKey}`)
  const volume = requireNonNegative(row?.volume ?? 0, `volume at ${symbol}/${dateKey}`)
  if (high < low) throw new Error(`invalid high<low at ${symbol}/${dateKey}`)
  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    throw new Error(`invalid OHLC envelope at ${symbol}/${dateKey}`)
  }
  return {
    symbol,
    dateKey,
    open,
    high,
    low,
    close,
    volume,
    tradedValue: close * volume,
    rangePct: high / low - 1,
    closeLocation: high > low ? (close - low) / (high - low) : 0.5,
    openToCloseReturn: close / open - 1,
  }
}

const loadCandidateKeys = async (candidatePath) => {
  const keys = new Map()
  await iterateJsonlMaybeGzip(candidatePath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`candidate row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      keys.set(keyOf(symbol, decisionDateKey), { symbol, decisionDateKey })
    },
  })
  if (keys.size < 1) throw new Error(`candidate source produced zero symbol/date keys: ${candidatePath}`)
  return [...keys.values()].sort(
    (left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol),
  )
}

const findCandleByDateKey = (series, dateKey) => {
  if (!series) return null
  let left = 0
  let right = series.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const row = series[mid]
    if (row.dateKey === dateKey) return row
    if (row.dateKey < dateKey) left = mid + 1
    else right = mid - 1
  }
  return null
}

async function* jsonlRows(filePath) {
  const sourcePath = toText(filePath)
  if (!sourcePath) throw new Error("JSONL input path is required")
  const source = fs.createReadStream(sourcePath)
  const input = sourcePath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of rl) {
      lineNumber += 1
      const text = String(line ?? "")
      if (!text.trim()) continue
      let row = null
      try {
        row = JSON.parse(text)
      } catch (error) {
        throw new Error(`Malformed JSONL at ${sourcePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`)
      }
      yield { row, context: { lineNumber, filePath: sourcePath } }
    }
  } finally {
    rl.close()
    source.destroy()
    if (input !== source && typeof input.destroy === "function") input.destroy()
  }
}

const normalizeCandidate = (row, context) => {
  const symbol = rowSymbol(row)
  const decisionDateKey = rowDateKey(row)
  if (!symbol) throw new Error(`candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
  if (!validDateKey(decisionDateKey)) {
    throw new Error(`candidate row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
  }
  return { symbol, decisionDateKey }
}

const ensureSortedSymbolDate = (previousKey, symbol, dateKey, label, context) => {
  const key = keyOf(symbol, dateKey)
  if (previousKey && key < previousKey) {
    throw new Error(`${label} must be sorted by symbol/date for streaming mode; violation at ${context.filePath}:${context.lineNumber}`)
  }
  return key
}

async function* sortedCandidateGroups(candidatePath) {
  let previousKey = ""
  let previousCandidateKey = ""
  let currentSymbol = ""
  let rows = []
  for await (const { row, context } of jsonlRows(candidatePath)) {
    const candidate = normalizeCandidate(row, context)
    const candidateKey = keyOf(candidate.symbol, candidate.decisionDateKey)
    previousKey = ensureSortedSymbolDate(previousKey, candidate.symbol, candidate.decisionDateKey, "candidate input", context)
    if (candidateKey === previousCandidateKey) continue
    previousCandidateKey = candidateKey
    if (currentSymbol && candidate.symbol !== currentSymbol) {
      yield { symbol: currentSymbol, rows }
      rows = []
    }
    currentSymbol = candidate.symbol
    rows.push(candidate)
  }
  if (currentSymbol) yield { symbol: currentSymbol, rows }
}

async function* sortedCandleGroups(candlePath) {
  let previousKey = ""
  let currentSymbol = ""
  let rows = []
  for await (const { row, context } of jsonlRows(candlePath)) {
    const candle = normalizeCandle(row, context)
    previousKey = ensureSortedSymbolDate(previousKey, candle.symbol, candle.dateKey, "candle input", context)
    if (currentSymbol && candle.symbol !== currentSymbol) {
      yield { symbol: currentSymbol, rows }
      rows = []
    }
    currentSymbol = candle.symbol
    rows.push(candle)
  }
  if (currentSymbol) yield { symbol: currentSymbol, rows }
}

const enrichSymbolSeries = (rows) => {
  rows.sort((left, right) => left.dateKey.localeCompare(right.dateKey))
  let previousClose = null
  for (const row of rows) {
    row.prevClose = previousClose
    row.return1d = previousClose ? row.close / previousClose - 1 : null
    row.gapPct = previousClose ? row.open / previousClose - 1 : null
    previousClose = row.close
  }
  const closePrefix = [0]
  const tradedPrefix = [0]
  const rangePrefix = [0]
  const returnPrefix = [0]
  const returnSqPrefix = [0]
  const returnCountPrefix = [0]
  for (const row of rows) {
    closePrefix.push(closePrefix.at(-1) + row.close)
    tradedPrefix.push(tradedPrefix.at(-1) + row.tradedValue)
    rangePrefix.push(rangePrefix.at(-1) + row.rangePct)
    if (Number.isFinite(row.return1d)) {
      returnPrefix.push(returnPrefix.at(-1) + row.return1d)
      returnSqPrefix.push(returnSqPrefix.at(-1) + row.return1d * row.return1d)
      returnCountPrefix.push(returnCountPrefix.at(-1) + 1)
    } else {
      returnPrefix.push(returnPrefix.at(-1))
      returnSqPrefix.push(returnSqPrefix.at(-1))
      returnCountPrefix.push(returnCountPrefix.at(-1))
    }
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    row.return3d = index >= 3 ? row.close / rows[index - 3].close - 1 : null
    row.return5d = index >= 5 ? row.close / rows[index - 5].close - 1 : null
    row.return10d = index >= 10 ? row.close / rows[index - 10].close - 1 : null
    row.return20d = index >= 20 ? row.close / rows[index - 20].close - 1 : null
    const ma5 = averageWindow(closePrefix, index, 5)
    const ma20 = averageWindow(closePrefix, index, 20)
    const ma60 = averageWindow(closePrefix, index, 60)
    row.closeOverMa5 = ma5 ? row.close / ma5 - 1 : null
    row.closeOverMa20 = ma20 ? row.close / ma20 - 1 : null
    row.closeOverMa60 = ma60 ? row.close / ma60 - 1 : null
    const traded20 = averageWindow(tradedPrefix, index, 20)
    const traded60 = averageWindow(tradedPrefix, index, 60)
    row.tradedValueRel20 = traded20 ? row.tradedValue / traded20 - 1 : null
    row.tradedValueRel60 = traded60 ? row.tradedValue / traded60 - 1 : null
    const range20 = averageWindow(rangePrefix, index, 20)
    row.rangeRel20 = range20 ? row.rangePct / range20 - 1 : null
    const meanReturn20 = countedAverageWindow(returnPrefix, returnCountPrefix, index, 20)
    const meanReturnSq20 = countedAverageWindow(returnSqPrefix, returnCountPrefix, index, 20)
    row.returnVol20 =
      meanReturn20 === null || meanReturnSq20 === null ? null : Math.sqrt(Math.max(0, meanReturnSq20 - meanReturn20 * meanReturn20))
    const last20 = windowRows(rows, index, 20)
    if (last20.length === 20) {
      const high20 = Math.max(...last20.map((item) => item.high))
      const low20 = Math.min(...last20.map((item) => item.low))
      row.closeToHigh20Pct = high20 > 0 ? row.close / high20 - 1 : null
      row.closeFromLow20Pct = low20 > 0 ? row.close / low20 - 1 : null
    } else {
      row.closeToHigh20Pct = null
      row.closeFromLow20Pct = null
    }
  }
  return rows
}

const loadCandles = async (candlePath) => {
  const bySymbol = new Map()
  const byDate = new Map()
  await iterateJsonlMaybeGzip(candlePath, {
    strict: true,
    onRow: async (row, context) => {
      const candle = normalizeCandle(row, context)
      const series = bySymbol.get(candle.symbol) ?? []
      series.push(candle)
      bySymbol.set(candle.symbol, series)
      const dateRows = byDate.get(candle.dateKey) ?? []
      dateRows.push(candle)
      byDate.set(candle.dateKey, dateRows)
    },
  })
  for (const [symbol, rows] of bySymbol.entries()) {
    enrichSymbolSeries(rows)
  }
  return { bySymbol, byDate }
}

const buildDateContext = (byDate) => {
  const contextByDate = new Map()
  for (const [dateKey, rows] of byDate.entries()) {
    const returns = rows.map((row) => row.return1d).filter(Number.isFinite)
    const upCount = returns.filter((value) => value > 0).length
    const limitUpProxyCount = returns.filter((value) => value >= 0.29).length
    const tradedValues = rows.map((row) => row.tradedValue).sort((left, right) => right - left)
    const tradedValueRankBySymbol = new Map()
    rows
      .slice()
      .sort((left, right) => right.tradedValue - left.tradedValue || left.symbol.localeCompare(right.symbol))
      .forEach((row, index) => {
        tradedValueRankBySymbol.set(row.symbol, {
          tradedValueRank: index + 1,
          tradedValueRankPct: rows.length > 1 ? index / (rows.length - 1) : 0,
        })
      })
    contextByDate.set(dateKey, {
      marketRowCount: rows.length,
      marketReturnCount: returns.length,
      marketUpRatio: returns.length > 0 ? upCount / returns.length : null,
      marketMedianReturn1d: median(returns),
      marketMedianTradedValue: median(tradedValues),
      limitUpProxyCount,
      tradedValueRankBySymbol,
    })
  }
  const sortedDates = [...contextByDate.keys()].sort()
  for (let index = 0; index < sortedDates.length; index += 1) {
    const last5 = windowRows(sortedDates, index, 5).map((dateKey) => contextByDate.get(dateKey))
    const last20 = windowRows(sortedDates, index, 20).map((dateKey) => contextByDate.get(dateKey))
    const current = contextByDate.get(sortedDates[index])
    current.marketUpRatio5 = last5.length === 5 ? average(last5.map((row) => row.marketUpRatio)) : null
    current.marketUpRatio20 = last20.length === 20 ? average(last20.map((row) => row.marketUpRatio)) : null
    current.marketMedianReturn5 = last5.length === 5 ? average(last5.map((row) => row.marketMedianReturn1d)) : null
    current.marketMedianReturn20 = last20.length === 20 ? average(last20.map((row) => row.marketMedianReturn1d)) : null
    current.limitUpProxyAvg5 = last5.length === 5 ? average(last5.map((row) => row.limitUpProxyCount)) : null
    current.limitUpProxyAvg20 = last20.length === 20 ? average(last20.map((row) => row.limitUpProxyCount)) : null
    current.limitUpProxyRel20 =
      current.limitUpProxyAvg20 && current.limitUpProxyAvg20 > 0 ? current.limitUpProxyCount / current.limitUpProxyAvg20 - 1 : null
  }
  return contextByDate
}

const buildStreamingDateContext = async (candlePath) => {
  const aggregates = new Map()
  const previousCloseBySymbol = new Map()
  let candleRowCount = 0
  for await (const { row, context } of jsonlRows(candlePath)) {
    const candle = normalizeCandle(row, context)
    candleRowCount += 1
    const previousClose = previousCloseBySymbol.get(candle.symbol) ?? null
    const return1d = previousClose ? candle.close / previousClose - 1 : null
    previousCloseBySymbol.set(candle.symbol, candle.close)
    const aggregate =
      aggregates.get(candle.dateKey) ??
      {
        dateKey: candle.dateKey,
        marketRowCount: 0,
        marketReturnCount: 0,
        returnSum: 0,
        upCount: 0,
        limitUpProxyCount: 0,
        tradedValueSum: 0,
      }
    aggregate.marketRowCount += 1
    aggregate.tradedValueSum += candle.tradedValue
    if (Number.isFinite(return1d)) {
      aggregate.marketReturnCount += 1
      aggregate.returnSum += return1d
      if (return1d > 0) aggregate.upCount += 1
      if (return1d >= 0.29) aggregate.limitUpProxyCount += 1
    }
    aggregates.set(candle.dateKey, aggregate)
  }
  const contextByDate = new Map()
  for (const [dateKey, aggregate] of aggregates.entries()) {
    contextByDate.set(dateKey, {
      marketRowCount: aggregate.marketRowCount,
      marketReturnCount: aggregate.marketReturnCount,
      marketUpRatio: aggregate.marketReturnCount > 0 ? aggregate.upCount / aggregate.marketReturnCount : null,
      marketMeanReturn1d: aggregate.marketReturnCount > 0 ? aggregate.returnSum / aggregate.marketReturnCount : null,
      marketMeanTradedValue: aggregate.marketRowCount > 0 ? aggregate.tradedValueSum / aggregate.marketRowCount : null,
      limitUpProxyCount: aggregate.limitUpProxyCount,
    })
  }
  const sortedDates = [...contextByDate.keys()].sort()
  for (let index = 0; index < sortedDates.length; index += 1) {
    const last5 = windowRows(sortedDates, index, 5).map((dateKey) => contextByDate.get(dateKey))
    const last20 = windowRows(sortedDates, index, 20).map((dateKey) => contextByDate.get(dateKey))
    const current = contextByDate.get(sortedDates[index])
    current.marketUpRatio5 = last5.length === 5 ? average(last5.map((row) => row.marketUpRatio)) : null
    current.marketUpRatio20 = last20.length === 20 ? average(last20.map((row) => row.marketUpRatio)) : null
    current.marketMeanReturn5 = last5.length === 5 ? average(last5.map((row) => row.marketMeanReturn1d)) : null
    current.marketMeanReturn20 = last20.length === 20 ? average(last20.map((row) => row.marketMeanReturn1d)) : null
    current.limitUpProxyAvg5 = last5.length === 5 ? average(last5.map((row) => row.limitUpProxyCount)) : null
    current.limitUpProxyAvg20 = last20.length === 20 ? average(last20.map((row) => row.limitUpProxyCount)) : null
    current.limitUpProxyRel20 =
      current.limitUpProxyAvg20 && current.limitUpProxyAvg20 > 0 ? current.limitUpProxyCount / current.limitUpProxyAvg20 - 1 : null
  }
  return { contextByDate, candleRowCount, marketDateCount: sortedDates.length }
}

const contextFeatureRow = ({ candidate, candle, dateContext, contextMode }) => ({
  kind: "tp12_context_feature_v1",
  contextMode,
  symbol: candidate.symbol,
  decisionDateKey: candidate.decisionDateKey,
  asOfFeatureDateKey: candidate.decisionDateKey,
  openToCloseReturn: candle.openToCloseReturn,
  return1d: candle.return1d,
  return3d: candle.return3d,
  return5d: candle.return5d,
  return10d: candle.return10d,
  return20d: candle.return20d,
  gapPct: candle.gapPct,
  rangePct: candle.rangePct,
  closeLocation: candle.closeLocation,
  closeOverMa5: candle.closeOverMa5,
  closeOverMa20: candle.closeOverMa20,
  closeOverMa60: candle.closeOverMa60,
  tradedValue: candle.tradedValue,
  tradedValueRel20: candle.tradedValueRel20,
  tradedValueRel60: candle.tradedValueRel60,
  rangeRel20: candle.rangeRel20,
  returnVol20: candle.returnVol20,
  closeToHigh20Pct: candle.closeToHigh20Pct,
  closeFromLow20Pct: candle.closeFromLow20Pct,
  marketRowCount: dateContext.marketRowCount,
  marketReturnCount: dateContext.marketReturnCount,
  marketUpRatio: dateContext.marketUpRatio,
  marketUpRatio5: dateContext.marketUpRatio5,
  marketUpRatio20: dateContext.marketUpRatio20,
  marketMeanReturn1d: dateContext.marketMeanReturn1d,
  marketMeanReturn5: dateContext.marketMeanReturn5,
  marketMeanReturn20: dateContext.marketMeanReturn20,
  marketMeanTradedValue: dateContext.marketMeanTradedValue,
  limitUpProxyCount: dateContext.limitUpProxyCount,
  limitUpProxyAvg5: dateContext.limitUpProxyAvg5,
  limitUpProxyAvg20: dateContext.limitUpProxyAvg20,
  limitUpProxyRel20: dateContext.limitUpProxyRel20,
})

const buildTp12ContextFeaturesStreaming = async ({ candidatePath, candlePath, outPath, manifestPath } = {}) => {
  const { contextByDate, candleRowCount, marketDateCount } = await buildStreamingDateContext(candlePath)
  await ensureDir(path.dirname(outPath))
  const writer = createJsonlWriteStreamMaybeGzip(outPath)
  const candleIterator = sortedCandleGroups(candlePath)[Symbol.asyncIterator]()
  let candleState = await candleIterator.next()
  let candidateRowCount = 0
  let outputRowCount = 0
  let missingCandleRowCount = 0
  const missingSamples = []
  try {
    for await (const candidateGroup of sortedCandidateGroups(candidatePath)) {
      while (!candleState.done && candleState.value.symbol < candidateGroup.symbol) {
        candleState = await candleIterator.next()
      }
      let candleSeries = []
      if (!candleState.done && candleState.value.symbol === candidateGroup.symbol) {
        candleSeries = enrichSymbolSeries(candleState.value.rows)
      }
      for (const candidate of candidateGroup.rows) {
        candidateRowCount += 1
        const candle = findCandleByDateKey(candleSeries, candidate.decisionDateKey)
        if (!candle) {
          missingCandleRowCount += 1
          if (missingSamples.length < 20) missingSamples.push(candidate)
          continue
        }
        const dateContext = contextByDate.get(candidate.decisionDateKey)
        if (!dateContext) throw new Error(`missing date context for ${candidate.decisionDateKey}`)
        await writeJsonlRow(
          writer.stream,
          contextFeatureRow({
            candidate,
            candle,
            dateContext,
            contextMode: "stream_by_symbol_v1",
          }),
        )
        outputRowCount += 1
      }
    }
  } finally {
    if (typeof candleIterator.return === "function") await candleIterator.return()
    await writer.close()
  }
  const failures = []
  if (missingCandleRowCount > 0) failures.push(`missing_candidate_candle_rows:${missingCandleRowCount}`)
  const manifest = {
    kind: "tp12_context_feature_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contextMode: "stream_by_symbol_v1",
    candidatePath: path.resolve(candidatePath),
    candlePath: path.resolve(candlePath),
    outPath: path.resolve(outPath),
    candleRowCount,
    marketDateCount,
    candidateRowCount,
    outputRowCount,
    missingCandleRowCount,
    missingSamples,
    failures,
  }
  await writeJson(manifestPath, manifest)
  if (failures.length > 0) throw new Error(`tp12 context feature build failed: ${failures.join("; ")}`)
  return manifest
}

export const buildTp12ContextFeatures = async ({
  candidatePath,
  candlePath,
  outPath,
  manifestPath,
  streamBySymbol = false,
} = {}) => {
  if (!toText(candidatePath)) throw new Error("candidatePath is required")
  if (!fs.existsSync(candidatePath)) throw new Error(`candidate path not found: ${candidatePath}`)
  if (!toText(candlePath)) throw new Error("candlePath is required")
  if (!fs.existsSync(candlePath)) throw new Error(`candle path not found: ${candlePath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(manifestPath)) throw new Error("manifestPath is required")
  if (streamBySymbol) return buildTp12ContextFeaturesStreaming({ candidatePath, candlePath, outPath, manifestPath })
  const candles = await loadCandles(candlePath)
  const dateContextByDate = buildDateContext(candles.byDate)
  await ensureDir(path.dirname(outPath))
  const writer = createJsonlWriteStreamMaybeGzip(outPath)
  let candidateRowCount = 0
  let outputRowCount = 0
  let missingCandleRowCount = 0
  const missingSamples = []
  try {
    await iterateJsonlMaybeGzip(candidatePath, {
      strict: true,
      onRow: async (row, context) => {
      candidateRowCount += 1
      const candidate = {
        symbol: rowSymbol(row),
        decisionDateKey: rowDateKey(row),
      }
      if (!candidate.symbol) throw new Error(`candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(candidate.decisionDateKey)) {
        throw new Error(
          `candidate row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${
            candidate.decisionDateKey || "missing"
          }`,
        )
      }
      const candle = findCandleByDateKey(candles.bySymbol.get(candidate.symbol), candidate.decisionDateKey)
      if (!candle) {
        missingCandleRowCount += 1
        if (missingSamples.length < 20) missingSamples.push(candidate)
        return
      }
      const dateContext = dateContextByDate.get(candidate.decisionDateKey)
      if (!dateContext) throw new Error(`missing date context for ${candidate.decisionDateKey}`)
      const rank = dateContext.tradedValueRankBySymbol.get(candidate.symbol)
      if (!rank) throw new Error(`missing traded value rank for ${candidate.symbol}/${candidate.decisionDateKey}`)
      await writeJsonlRow(writer.stream, {
        kind: "tp12_context_feature_v1",
        symbol: candidate.symbol,
        decisionDateKey: candidate.decisionDateKey,
        asOfFeatureDateKey: candidate.decisionDateKey,
        openToCloseReturn: candle.openToCloseReturn,
        return1d: candle.return1d,
        return3d: candle.return3d,
        return5d: candle.return5d,
        return10d: candle.return10d,
        return20d: candle.return20d,
        gapPct: candle.gapPct,
        rangePct: candle.rangePct,
        closeLocation: candle.closeLocation,
        closeOverMa5: candle.closeOverMa5,
        closeOverMa20: candle.closeOverMa20,
        closeOverMa60: candle.closeOverMa60,
        tradedValue: candle.tradedValue,
        tradedValueRel20: candle.tradedValueRel20,
        tradedValueRel60: candle.tradedValueRel60,
        tradedValueRank: rank.tradedValueRank,
        tradedValueRankPct: rank.tradedValueRankPct,
        rangeRel20: candle.rangeRel20,
        returnVol20: candle.returnVol20,
        closeToHigh20Pct: candle.closeToHigh20Pct,
        closeFromLow20Pct: candle.closeFromLow20Pct,
        marketRowCount: dateContext.marketRowCount,
        marketReturnCount: dateContext.marketReturnCount,
        marketUpRatio: dateContext.marketUpRatio,
        marketUpRatio5: dateContext.marketUpRatio5,
        marketUpRatio20: dateContext.marketUpRatio20,
        marketMedianReturn1d: dateContext.marketMedianReturn1d,
        marketMedianReturn5: dateContext.marketMedianReturn5,
        marketMedianReturn20: dateContext.marketMedianReturn20,
        marketMedianTradedValue: dateContext.marketMedianTradedValue,
        limitUpProxyCount: dateContext.limitUpProxyCount,
        limitUpProxyAvg5: dateContext.limitUpProxyAvg5,
        limitUpProxyAvg20: dateContext.limitUpProxyAvg20,
        limitUpProxyRel20: dateContext.limitUpProxyRel20,
      })
      outputRowCount += 1
      },
    })
  } finally {
    await writer.close()
  }
  const failures = []
  if (missingCandleRowCount > 0) failures.push(`missing_candidate_candle_rows:${missingCandleRowCount}`)
  const manifest = {
    kind: "tp12_context_feature_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    candidatePath: path.resolve(candidatePath),
    candlePath: path.resolve(candlePath),
    outPath: path.resolve(outPath),
    candidateRowCount,
    outputRowCount,
    missingCandleRowCount,
    missingSamples,
    failures,
  }
  await writeJson(manifestPath, manifest)
  if (failures.length > 0) throw new Error(`tp12 context feature build failed: ${failures.join("; ")}`)
  return manifest
}
