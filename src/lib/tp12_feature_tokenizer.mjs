import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  loadTp12CandlesBySymbol,
  loadTp12Contract,
} from "./tp12_label_event_builder.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const normalizeSymbol = (value) => toText(value).toUpperCase()
const KNOWN_BELOW_MIN_TOKEN_POLICIES = new Set(["fail", "skip_below_min"])
const finite = (value) => Number.isFinite(value)
const pct = (numerator, denominator) => (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator - 1 : null)

const avg = (values) => {
  const safe = values.filter((value) => Number.isFinite(value))
  return safe.length > 0 ? safe.reduce((sum, value) => sum + value, 0) / safe.length : null
}

const max = (values) => {
  const safe = values.filter((value) => Number.isFinite(value))
  return safe.length > 0 ? Math.max(...safe) : null
}

const min = (values) => {
  const safe = values.filter((value) => Number.isFinite(value))
  return safe.length > 0 ? Math.min(...safe) : null
}

const roundFeature = (value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : null)

export const deriveTp12FeatureTokenizerOptionsFromContract = (contract = {}) => {
  const config = contract.featureTokenizer ?? {}
  return {
    tokenizerVersion: config.tokenizerVersion,
    requireUniverse: config.requireUniverse,
    includeFeatureSnapshot: config.includeFeatureSnapshot,
    minTokenCount: config.minTokenCount,
    belowMinTokenPolicy: config.belowMinTokenPolicy,
  }
}

const resolveOptions = ({ contract, tokenizerVersion, requireUniverse, includeFeatureSnapshot, minTokenCount, belowMinTokenPolicy }) => {
  const contractOptions = contract ? deriveTp12FeatureTokenizerOptionsFromContract(contract) : {}
  const resolvedVersion = toText(tokenizerVersion ?? contractOptions.tokenizerVersion)
  if (!resolvedVersion) throw new Error("tokenizerVersion is required")
  const resolvedMinTokenCount = Number(minTokenCount ?? contractOptions.minTokenCount ?? 1)
  if (!Number.isInteger(resolvedMinTokenCount) || resolvedMinTokenCount < 0) {
    throw new Error(`minTokenCount must be a non-negative integer: ${minTokenCount}`)
  }
  const resolvedBelowMinTokenPolicy = toText(belowMinTokenPolicy ?? contractOptions.belowMinTokenPolicy ?? "fail")
  if (!KNOWN_BELOW_MIN_TOKEN_POLICIES.has(resolvedBelowMinTokenPolicy)) {
    throw new Error(`unsupported belowMinTokenPolicy: ${resolvedBelowMinTokenPolicy}`)
  }
  return {
    tokenizerVersion: resolvedVersion,
    requireUniverse: toBool(requireUniverse ?? contractOptions.requireUniverse, true),
    includeFeatureSnapshot: toBool(includeFeatureSnapshot ?? contractOptions.includeFeatureSnapshot, false),
    minTokenCount: resolvedMinTokenCount,
    belowMinTokenPolicy: resolvedBelowMinTokenPolicy,
  }
}

const loadUniverseByKey = async ({ universePath, required }) => {
  const pathText = toText(universePath)
  if (!pathText) {
    if (required) throw new Error("universePath is required by featureTokenizer.requireUniverse=true")
    return new Map()
  }
  const universe = new Map()
  await iterateJsonlMaybeGzip(pathText, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = normalizeSymbol(row?.symbol)
      const dateKey = toText(row?.tradingDateKey ?? row?.dateKey)
      if (!symbol) throw new Error(`missing universe symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) throw new Error(`invalid universe date at ${context.filePath}:${context.lineNumber}: ${dateKey}`)
      const key = `${symbol}::${dateKey}`
      if (universe.has(key)) throw new Error(`duplicate universe row for ${key}`)
      universe.set(key, {
        avgTradingValue20d: toNumber(row?.avgTradingValue20d, NaN),
        marketCapKrw: toNumber(row?.marketCapKrw, NaN),
      })
    },
  })
  return universe
}

const buildIndexBySymbolDate = (candlesBySymbol) => {
  const lookup = new Map()
  for (const [symbol, series] of candlesBySymbol.entries()) {
    const dateToIndex = new Map()
    for (const [index, row] of series.entries()) dateToIndex.set(row.dateKey, index)
    lookup.set(symbol, dateToIndex)
  }
  return lookup
}

const windowRows = (series, index, lookback) => {
  const start = Math.max(0, index - lookback + 1)
  return series.slice(start, index + 1)
}

const addThresholdTokens = ({ tokens, prefix, value, thresholds, direction = "ge" }) => {
  if (!Number.isFinite(value)) return
  for (const threshold of thresholds) {
    if (direction === "ge" && value >= threshold) tokens.push(`${prefix}_ge_${String(threshold).replace(".", "p")}`)
    if (direction === "le" && value <= threshold) tokens.push(`${prefix}_le_${String(threshold).replace("-", "m").replace(".", "p")}`)
  }
}

const computeFeatureSnapshot = ({ series, index, universeRow }) => {
  const row = series[index]
  const prev = index > 0 ? series[index - 1] : null
  const close = row.close
  const prevClose = prev?.close
  const w3 = windowRows(series, index, 3)
  const w5 = windowRows(series, index, 5)
  const w20 = windowRows(series, index, 20)
  const w60 = windowRows(series, index, 60)
  const ret1 = prev ? pct(close, prevClose) : null
  const ret3 = index >= 3 ? pct(close, series[index - 3].close) : null
  const ret5 = index >= 5 ? pct(close, series[index - 5].close) : null
  const ret20 = index >= 20 ? pct(close, series[index - 20].close) : null
  const gap = prev ? pct(row.open, prevClose) : null
  const rangePct = prev ? (row.high - row.low) / prevClose : null
  const closePos = row.high > row.low ? (row.close - row.low) / (row.high - row.low) : 0.5
  const avgVol20 = avg(w20.map((item) => item.volume))
  const relVol20 = avgVol20 && avgVol20 > 0 ? row.volume / avgVol20 : null
  const valueKrw = row.close * row.volume
  const ma20 = w20.length >= 20 ? avg(w20.map((item) => item.close)) : null
  const ma60 = w60.length >= 60 ? avg(w60.map((item) => item.close)) : null
  const high20 = w20.length >= 20 ? max(w20.map((item) => item.high)) : null
  const low20 = w20.length >= 20 ? min(w20.map((item) => item.low)) : null
  const closeNearHigh20 = high20 && low20 && high20 > low20 ? (close - low20) / (high20 - low20) : null
  const avgRange20 = avg(w20.map((item) => (item.high - item.low) / item.close))
  const rangeCompression20 = avgRange20 && avgRange20 > 0 ? ((row.high - row.low) / close) / avgRange20 : null
  const maxClose3 = max(w3.map((item) => item.close))
  const maxClose5 = max(w5.map((item) => item.close))
  return {
    ret1: roundFeature(ret1),
    ret3: roundFeature(ret3),
    ret5: roundFeature(ret5),
    ret20: roundFeature(ret20),
    gap: roundFeature(gap),
    rangePct: roundFeature(rangePct),
    closePos: roundFeature(closePos),
    relVol20: roundFeature(relVol20),
    valueKrw: roundFeature(valueKrw),
    closeOverMa20: ma20 ? roundFeature(close / ma20 - 1) : null,
    closeOverMa60: ma60 ? roundFeature(close / ma60 - 1) : null,
    closeNearHigh20: roundFeature(closeNearHigh20),
    high20Break: high20 ? row.high >= high20 : false,
    rangeCompression20: roundFeature(rangeCompression20),
    maxClose3Break: finite(maxClose3) ? close >= maxClose3 : false,
    maxClose5Break: finite(maxClose5) ? close >= maxClose5 : false,
    avgTradingValue20d: roundFeature(universeRow?.avgTradingValue20d),
    marketCapKrw: roundFeature(universeRow?.marketCapKrw),
  }
}

const buildTokens = (features) => {
  const tokens = []
  addThresholdTokens({ tokens, prefix: "px:ret1", value: features.ret1, thresholds: [0.03, 0.06, 0.1] })
  addThresholdTokens({ tokens, prefix: "px:ret3", value: features.ret3, thresholds: [0.06, 0.1, 0.18] })
  addThresholdTokens({ tokens, prefix: "px:ret5", value: features.ret5, thresholds: [0.08, 0.15, 0.25] })
  addThresholdTokens({ tokens, prefix: "px:ret20", value: features.ret20, thresholds: [0.1, 0.25, 0.5] })
  addThresholdTokens({ tokens, prefix: "px:gap", value: features.gap, thresholds: [0.02, 0.04, 0.08] })
  addThresholdTokens({ tokens, prefix: "px:gap", value: features.gap, thresholds: [-0.02, -0.04], direction: "le" })
  addThresholdTokens({ tokens, prefix: "shape:range", value: features.rangePct, thresholds: [0.04, 0.06, 0.1] })
  addThresholdTokens({ tokens, prefix: "shape:close_pos", value: features.closePos, thresholds: [0.65, 0.8, 0.9] })
  addThresholdTokens({ tokens, prefix: "vol:relvol20", value: features.relVol20, thresholds: [1.5, 2, 3, 5] })
  addThresholdTokens({ tokens, prefix: "trend:close_over_ma20", value: features.closeOverMa20, thresholds: [0, 0.05, 0.1] })
  addThresholdTokens({ tokens, prefix: "trend:close_over_ma60", value: features.closeOverMa60, thresholds: [0, 0.1, 0.25] })
  addThresholdTokens({ tokens, prefix: "level:close_near_high20", value: features.closeNearHigh20, thresholds: [0.75, 0.9] })
  addThresholdTokens({ tokens, prefix: "volatility:range_compression20", value: features.rangeCompression20, thresholds: [0.5, 0.8], direction: "le" })
  addThresholdTokens({ tokens, prefix: "liq:avg_trading_value20d", value: features.avgTradingValue20d, thresholds: [100_000_000, 500_000_000, 1_000_000_000, 5_000_000_000] })
  addThresholdTokens({ tokens, prefix: "cap:market_cap", value: features.marketCapKrw, thresholds: [50_000_000_000, 100_000_000_000, 500_000_000_000, 1_000_000_000_000] })
  addThresholdTokens({ tokens, prefix: "cap:market_cap", value: features.marketCapKrw, thresholds: [100_000_000_000], direction: "le" })
  if (features.high20Break) tokens.push("level:high20_break")
  if (features.maxClose3Break) tokens.push("level:max_close3_break")
  if (features.maxClose5Break) tokens.push("level:max_close5_break")
  return [...new Set(tokens)].sort()
}

const copyOptionalLabelMetrics = (event) => {
  const out = {}
  for (const key of [
    "entryPrice",
    "targetPrice",
    "hitDateKey",
    "stopHit",
    "stopDateKey",
    "targetBeforeStop",
    "stopBeforeTarget",
    "sameBarAmbiguous",
    "maxForwardReturn",
    "maxForwardHighPct",
    "minForwardReturn",
    "minForwardLowPct",
    "maxForwardDrawdown",
    "availableForwardBars",
  ]) {
    if (Object.prototype.hasOwnProperty.call(event, key)) out[key] = event[key]
  }
  return out
}

export const buildTp12TokenizedEvents = async ({
  labelEventsPath,
  candlePath,
  universePath = "",
  contractPath = null,
  outEventsPath,
  outSummaryPath,
  tokenizerVersion,
  requireUniverse,
  includeFeatureSnapshot,
  minTokenCount,
  belowMinTokenPolicy,
} = {}) => {
  if (!toText(labelEventsPath)) throw new Error("labelEventsPath is required")
  if (!toText(candlePath)) throw new Error("candlePath is required")
  if (!toText(outEventsPath)) throw new Error("outEventsPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveOptions({
    contract,
    tokenizerVersion,
    requireUniverse,
    includeFeatureSnapshot,
    minTokenCount,
    belowMinTokenPolicy,
  })
  const [candlesBySymbol, universeByKey] = await Promise.all([
    loadTp12CandlesBySymbol({ candlePath }),
    loadUniverseByKey({ universePath, required: options.requireUniverse }),
  ])
  const dateIndexBySymbol = buildIndexBySymbolDate(candlesBySymbol)
  await ensureDir(path.dirname(outEventsPath))
  const stream = fs.createWriteStream(outEventsPath, { encoding: "utf8" })
  const tokenCounts = new Map()
  const tokenFamilyCounts = new Map()
  let inputEventCount = 0
  let skippedInvalidLabelEventCount = 0
  let outputRowCount = 0
  let hitRowCount = 0
  let zeroTokenRowCount = 0
  let skippedBelowMinTokenRowCount = 0
  let skippedBelowMinTokenHitRowCount = 0
  try {
    await iterateJsonlMaybeGzip(labelEventsPath, {
      strict: true,
      onRow: async (event, context) => {
        if (toText(event?.labelStatus) && toText(event.labelStatus) !== "valid") {
          skippedInvalidLabelEventCount += 1
          return
        }
        const symbol = normalizeSymbol(event?.symbol)
        const decisionDateKey = toText(event?.decisionDateKey)
        if (!symbol) throw new Error(`missing label event symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`invalid label event decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (!Object.prototype.hasOwnProperty.call(event, "hitTarget")) {
          throw new Error(`label event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
        }
        inputEventCount += 1
        const series = candlesBySymbol.get(symbol)
        const index = dateIndexBySymbol.get(symbol)?.get(decisionDateKey)
        if (!series || index === undefined) throw new Error(`missing candle row for label event ${symbol}/${decisionDateKey}`)
        const universeKey = `${symbol}::${decisionDateKey}`
        const universeRow = universeByKey.get(universeKey)
        if (options.requireUniverse && !universeRow) throw new Error(`missing universe row for ${universeKey}`)
        const featureSnapshot = computeFeatureSnapshot({ series, index, universeRow })
        const tokens = buildTokens(featureSnapshot)
        if (tokens.length < options.minTokenCount) {
          zeroTokenRowCount += 1
          if (options.belowMinTokenPolicy === "skip_below_min") {
            skippedBelowMinTokenRowCount += 1
            if (event.hitTarget === true) skippedBelowMinTokenHitRowCount += 1
            return
          }
        }
        for (const token of tokens) {
          incrementMap(tokenCounts, token)
          incrementMap(tokenFamilyCounts, token.split(":")[0] || "unknown")
        }
        if (event.hitTarget === true) hitRowCount += 1
        const row = {
          kind: "tp12_tokenized_event_v1",
          tokenizerVersion: options.tokenizerVersion,
          eventId: event.eventId,
          labelConfigId: event.labelConfigId,
          symbol,
          decisionDateKey,
          asOfFeatureDateKey: event.asOfFeatureDateKey ?? decisionDateKey,
          entryDateKey: event.entryDateKey,
          hitTarget: event.hitTarget === true,
          ...copyOptionalLabelMetrics(event),
          tokens,
          tokenCount: tokens.length,
        }
        if (options.includeFeatureSnapshot) row.featureSnapshot = featureSnapshot
        await writeJsonlRow(stream, row)
        outputRowCount += 1
      },
    })
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
  const failures = []
  if (outputRowCount < 1) failures.push("zero_tokenized_events")
  if (zeroTokenRowCount > 0 && options.minTokenCount > 0 && options.belowMinTokenPolicy === "fail") {
    failures.push(`below_min_token_count_rows:${zeroTokenRowCount}`)
  }
  const summary = {
    kind: "tp12_tokenized_event_build_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    labelEventsPath: path.resolve(labelEventsPath),
    candlePath: path.resolve(candlePath),
    universePath: universePath ? path.resolve(universePath) : null,
    outEventsPath: path.resolve(outEventsPath),
    tokenizerVersion: options.tokenizerVersion,
    requireUniverse: options.requireUniverse,
    includeFeatureSnapshot: options.includeFeatureSnapshot,
    minTokenCount: options.minTokenCount,
    belowMinTokenPolicy: options.belowMinTokenPolicy,
    inputEventCount,
    skippedInvalidLabelEventCount,
    outputRowCount,
    hitRowCount,
    rowHitRate: outputRowCount > 0 ? hitRowCount / outputRowCount : 0,
    zeroTokenRowCount,
    skippedBelowMinTokenRowCount,
    skippedBelowMinTokenHitRowCount,
    tokenCount: tokenCounts.size,
    tokenFamilyCounts: mapToSortedObject(tokenFamilyCounts),
    topTokens: [...tokenCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 200)
      .map(([token, count]) => ({ token, count })),
    failures,
  }
  if (outSummaryPath) await writeJson(outSummaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 tokenized event build failed: ${failures.join("; ")}`)
  return summary
}
