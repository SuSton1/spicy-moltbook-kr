import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  loadTp12CandlesBySymbol,
  loadTp12Contract,
} from "./tp12_label_event_builder.mjs"
import {
  TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES,
  TP12_DAILY_OHLCV_D0_TOKEN_VOCABULARY,
  TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION,
  assertDailyOhlcvD0TokenVocabulary,
} from "./tp12_daily_ohlcv_d0_feature_whitelist.mjs"
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
    featureSurfaceId: config.featureSurfaceId,
    minDistinctTokenCount: config.minDistinctTokenCount,
    maxDistinctTokenCount: config.maxDistinctTokenCount,
    forbiddenTokenFamilies: config.forbiddenTokenFamilies,
  }
}

const parseStringList = (value) => {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean)
  return toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

const resolveOptions = ({
  contract,
  tokenizerVersion,
  requireUniverse,
  includeFeatureSnapshot,
  minTokenCount,
  belowMinTokenPolicy,
  featureSurfaceId,
  minDistinctTokenCount,
  maxDistinctTokenCount,
  forbiddenTokenFamilies,
}) => {
  const contractOptions = contract ? deriveTp12FeatureTokenizerOptionsFromContract(contract) : {}
  const resolvedVersion = toText(tokenizerVersion ?? contractOptions.tokenizerVersion)
  if (!resolvedVersion) throw new Error("tokenizerVersion is required")
  if (resolvedVersion === TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION) assertDailyOhlcvD0TokenVocabulary()
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
    featureSurfaceId: toText(featureSurfaceId ?? contractOptions.featureSurfaceId),
    requireUniverse: toBool(
      requireUniverse ?? contractOptions.requireUniverse,
      resolvedVersion === TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION ? false : true,
    ),
    includeFeatureSnapshot: toBool(includeFeatureSnapshot ?? contractOptions.includeFeatureSnapshot, false),
    minTokenCount: resolvedMinTokenCount,
    belowMinTokenPolicy: resolvedBelowMinTokenPolicy,
    minDistinctTokenCount: Math.max(0, Math.trunc(toNumber(minDistinctTokenCount ?? contractOptions.minDistinctTokenCount, 0))),
    maxDistinctTokenCount: Math.max(0, Math.trunc(toNumber(maxDistinctTokenCount ?? contractOptions.maxDistinctTokenCount, 0))),
    forbiddenTokenFamilies: parseStringList(
      forbiddenTokenFamilies ??
        contractOptions.forbiddenTokenFamilies ??
        (resolvedVersion === TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION
          ? TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES
          : []),
    ),
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

const windowRowsBefore = (series, index, lookback) => {
  const end = Math.max(0, index)
  const start = Math.max(0, end - lookback)
  return series.slice(start, end)
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
  const w10 = windowRows(series, index, 10)
  const w120 = windowRows(series, index, 120)
  const prev20 = windowRowsBefore(series, index, 20)
  const prev60 = windowRowsBefore(series, index, 60)
  const ret1 = prev ? pct(close, prevClose) : null
  const ret3 = index >= 3 ? pct(close, series[index - 3].close) : null
  const ret5 = index >= 5 ? pct(close, series[index - 5].close) : null
  const ret20 = index >= 20 ? pct(close, series[index - 20].close) : null
  const gap = prev ? pct(row.open, prevClose) : null
  const rangePct = prev ? (row.high - row.low) / prevClose : null
  const closePos = row.high > row.low ? (row.close - row.low) / (row.high - row.low) : 0.5
  const avgVol20 = avg(w20.map((item) => item.volume))
  const avgVol5 = avg(w5.map((item) => item.volume))
  const avgVol60 = avg(w60.map((item) => item.volume))
  const avgVol120 = avg(w120.map((item) => item.volume))
  const relVol20 = avgVol20 && avgVol20 > 0 ? row.volume / avgVol20 : null
  const valueKrw = row.close * row.volume
  const valueRows5 = w5.map((item) => item.close * item.volume)
  const valueRows20 = w20.map((item) => item.close * item.volume)
  const valueRows60 = w60.map((item) => item.close * item.volume)
  const valueRows120 = w120.map((item) => item.close * item.volume)
  const avgValue5 = avg(valueRows5)
  const avgValue20 = avg(valueRows20)
  const avgValue60 = avg(valueRows60)
  const avgValue120 = avg(valueRows120)
  const ma5 = w5.length >= 5 ? avg(w5.map((item) => item.close)) : null
  const ma10 = w10.length >= 10 ? avg(w10.map((item) => item.close)) : null
  const ma20 = w20.length >= 20 ? avg(w20.map((item) => item.close)) : null
  const ma60 = w60.length >= 60 ? avg(w60.map((item) => item.close)) : null
  const ma120 = w120.length >= 120 ? avg(w120.map((item) => item.close)) : null
  const high20 = w20.length >= 20 ? max(w20.map((item) => item.high)) : null
  const low20 = w20.length >= 20 ? min(w20.map((item) => item.low)) : null
  const previousHigh20 = prev20.length >= 20 ? max(prev20.map((item) => item.high)) : null
  const previousHigh60 = prev60.length >= 60 ? max(prev60.map((item) => item.high)) : null
  const prevMa20 = index > 0 ? avg(windowRows(series, index - 1, 20).map((item) => item.close)) : null
  const prevMa60 = index > 0 ? avg(windowRows(series, index - 1, 60).map((item) => item.close)) : null
  const closeNearHigh20 = high20 && low20 && high20 > low20 ? (close - low20) / (high20 - low20) : null
  const avgRange20 = avg(w20.map((item) => (item.high - item.low) / item.close))
  const rangeCompression20 = avgRange20 && avgRange20 > 0 ? ((row.high - row.low) / close) / avgRange20 : null
  const maxClose3 = max(w3.map((item) => item.close))
  const maxClose5 = max(w5.map((item) => item.close))
  const rangeAbs = row.high - row.low
  const bodyAbs = Math.abs(row.close - row.open)
  const upperWickAbs = row.high - Math.max(row.open, row.close)
  const lowerWickAbs = Math.min(row.open, row.close) - row.low
  return {
    ret1: roundFeature(ret1),
    ret3: roundFeature(ret3),
    ret5: roundFeature(ret5),
    ret20: roundFeature(ret20),
    gap: roundFeature(gap),
    rangePct: roundFeature(rangePct),
    closePos: roundFeature(closePos),
    relVol20: roundFeature(relVol20),
    relVol5: avgVol5 && avgVol5 > 0 ? roundFeature(row.volume / avgVol5) : null,
    relVol60: avgVol60 && avgVol60 > 0 ? roundFeature(row.volume / avgVol60) : null,
    relVol120: avgVol120 && avgVol120 > 0 ? roundFeature(row.volume / avgVol120) : null,
    valueKrw: roundFeature(valueKrw),
    relValue20: avgValue20 && avgValue20 > 0 ? roundFeature(valueKrw / avgValue20) : null,
    relValue60: avgValue60 && avgValue60 > 0 ? roundFeature(valueKrw / avgValue60) : null,
    relValue120: avgValue120 && avgValue120 > 0 ? roundFeature(valueKrw / avgValue120) : null,
    ma5: roundFeature(ma5),
    ma10: roundFeature(ma10),
    ma20: roundFeature(ma20),
    ma60: roundFeature(ma60),
    ma120: roundFeature(ma120),
    volMa5: roundFeature(avgVol5),
    volMa20: roundFeature(avgVol20),
    volMa60: roundFeature(avgVol60),
    volMa120: roundFeature(avgVol120),
    valueMa5: roundFeature(avgValue5),
    valueMa20: roundFeature(avgValue20),
    valueMa60: roundFeature(avgValue60),
    valueMa120: roundFeature(avgValue120),
    bodyPctOfRange: rangeAbs > 0 ? roundFeature(bodyAbs / rangeAbs) : null,
    upperWickPctOfRange: rangeAbs > 0 ? roundFeature(upperWickAbs / rangeAbs) : null,
    lowerWickPctOfRange: rangeAbs > 0 ? roundFeature(lowerWickAbs / rangeAbs) : null,
    bullBodyPctOfRange: rangeAbs > 0 && row.close > row.open ? roundFeature(bodyAbs / rangeAbs) : null,
    bearBodyPctOfRange: rangeAbs > 0 && row.close < row.open ? roundFeature(bodyAbs / rangeAbs) : null,
    closeOverMa20: ma20 ? roundFeature(close / ma20 - 1) : null,
    closeOverMa60: ma60 ? roundFeature(close / ma60 - 1) : null,
    closeOverMa5: ma5 ? roundFeature(close / ma5 - 1) : null,
    closeOverMa120: ma120 ? roundFeature(close / ma120 - 1) : null,
    closeNearHigh20: roundFeature(closeNearHigh20),
    high20Break: high20 ? row.high >= high20 : false,
    closeBreakPreviousHigh20: previousHigh20 ? close > previousHigh20 : false,
    closeBreakPreviousHigh60: previousHigh60 ? close > previousHigh60 : false,
    highBreakPreviousHigh20: previousHigh20 ? row.high > previousHigh20 : false,
    closeReclaimMa20: prev && prevMa20 && ma20 ? prev.close <= prevMa20 && close > ma20 : false,
    closeReclaimMa60: prev && prevMa60 && ma60 ? prev.close <= prevMa60 && close > ma60 : false,
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

const gt = (left, right) => Number.isFinite(left) && Number.isFinite(right) && left > right
const lt = (left, right) => Number.isFinite(left) && Number.isFinite(right) && left < right

const DAILY_OHLCV_D0_TOKEN_RENAMES = new Map([
  ["shape:close_pos_ge_0p8", "shape:close_pos_ge_0p80"],
  ["shape:close_pos_ge_0p9", "shape:close_pos_ge_0p90"],
  ["pxma:close_over_ma20_ge_0p1", "pxma:close_over_ma20_ge_0p10"],
  ["pxma:close_under_ma60_le_m0p1", "pxma:close_under_ma60_le_m0p10"],
])

const buildDailyOhlcvD0Tokens = (features) => {
  const tokens = []
  addThresholdTokens({ tokens, prefix: "shape:range", value: features.rangePct, thresholds: [0.04, 0.07] })
  addThresholdTokens({ tokens, prefix: "shape:body", value: features.bodyPctOfRange, thresholds: [0.45, 0.65] })
  if (Number.isFinite(features.bodyPctOfRange) && features.bodyPctOfRange <= 0.2) tokens.push("shape:body_le_0p20")
  addThresholdTokens({ tokens, prefix: "shape:upper_wick", value: features.upperWickPctOfRange, thresholds: [0.35, 0.55] })
  addThresholdTokens({ tokens, prefix: "shape:lower_wick", value: features.lowerWickPctOfRange, thresholds: [0.35, 0.55] })
  addThresholdTokens({ tokens, prefix: "shape:close_pos", value: features.closePos, thresholds: [0.65, 0.8, 0.9] })
  if (Number.isFinite(features.closePos) && features.closePos <= 0.35) tokens.push("shape:close_pos_le_0p35")
  if (Number.isFinite(features.closePos) && features.closePos <= 0.2) tokens.push("shape:close_pos_le_0p20")
  addThresholdTokens({ tokens, prefix: "shape:bull_body", value: features.bullBodyPctOfRange, thresholds: [0.45] })
  addThresholdTokens({ tokens, prefix: "shape:bear_body", value: features.bearBodyPctOfRange, thresholds: [0.45] })

  addThresholdTokens({ tokens, prefix: "vol:rel5", value: features.relVol5, thresholds: [1.5, 2.5] })
  addThresholdTokens({ tokens, prefix: "vol:rel20", value: features.relVol20, thresholds: [1.5, 2.5, 4] })
  addThresholdTokens({ tokens, prefix: "vol:rel20", value: features.relVol20, thresholds: [0.5], direction: "le" })
  addThresholdTokens({ tokens, prefix: "vol:rel60", value: features.relVol60, thresholds: [1.5, 2.5] })
  addThresholdTokens({ tokens, prefix: "vol:rel60", value: features.relVol60, thresholds: [0.5], direction: "le" })
  addThresholdTokens({ tokens, prefix: "vol:rel120", value: features.relVol120, thresholds: [1.5] })
  addThresholdTokens({ tokens, prefix: "vol:rel120", value: features.relVol120, thresholds: [0.5], direction: "le" })
  if (gt(features.volMa5, features.volMa20)) tokens.push("vol:ma5_gt_ma20")
  if (gt(features.volMa20, features.volMa60)) tokens.push("vol:ma20_gt_ma60")
  if (gt(features.volMa60, features.volMa120)) tokens.push("vol:ma60_gt_ma120")
  if (gt(features.volMa5, features.volMa20) && gt(features.volMa20, features.volMa60) && gt(features.volMa60, features.volMa120)) {
    tokens.push("vol:ma5_gt_ma20_gt_ma60_gt_ma120")
  }
  if (lt(features.volMa5, features.volMa20) && lt(features.volMa20, features.volMa60) && lt(features.volMa60, features.volMa120)) {
    tokens.push("vol:ma5_lt_ma20_lt_ma60_lt_ma120")
  }
  if (gt(features.volMa20, 0) && features.volMa5 / features.volMa20 <= 0.7) tokens.push("vol:compress5_20_le_0p7")
  if (gt(features.volMa20, 0) && features.volMa5 / features.volMa20 <= 0.7 && gt(features.relVol20, 1.5)) {
    tokens.push("vol:reexpand_after_compress")
  }

  addThresholdTokens({ tokens, prefix: "amt:rel20", value: features.relValue20, thresholds: [1.5, 3] })
  addThresholdTokens({ tokens, prefix: "amt:rel20", value: features.relValue20, thresholds: [0.5], direction: "le" })
  addThresholdTokens({ tokens, prefix: "amt:rel60", value: features.relValue60, thresholds: [1.5] })
  addThresholdTokens({ tokens, prefix: "amt:rel120", value: features.relValue120, thresholds: [1.5] })
  if (gt(features.valueMa5, features.valueMa20)) tokens.push("amt:ma5_gt_ma20")
  if (gt(features.valueMa20, features.valueMa60)) tokens.push("amt:ma20_gt_ma60")
  if (gt(features.valueMa5, features.valueMa20) && gt(features.valueMa20, features.valueMa60)) {
    tokens.push("amt:ma5_gt_ma20_gt_ma60")
  }
  if (gt(features.valueMa20, 0) && features.valueMa5 / features.valueMa20 <= 0.7) tokens.push("amt:compress5_20_le_0p7")
  if (gt(features.valueMa20, 0) && features.valueMa5 / features.valueMa20 <= 0.7 && gt(features.relValue20, 1.5)) {
    tokens.push("amt:reexpand_after_compress")
  }

  if (gt(features.closeOverMa5, 0)) tokens.push("pxma:close_gt_ma5")
  if (gt(features.closeOverMa20, 0)) tokens.push("pxma:close_gt_ma20")
  if (gt(features.closeOverMa60, 0)) tokens.push("pxma:close_gt_ma60")
  if (gt(features.closeOverMa120, 0)) tokens.push("pxma:close_gt_ma120")
  addThresholdTokens({ tokens, prefix: "pxma:close_over_ma20", value: features.closeOverMa20, thresholds: [0.05, 0.1] })
  addThresholdTokens({ tokens, prefix: "pxma:close_over_ma60", value: features.closeOverMa60, thresholds: [0.05, 0.15] })
  addThresholdTokens({ tokens, prefix: "pxma:close_under_ma20", value: features.closeOverMa20, thresholds: [-0.05], direction: "le" })
  addThresholdTokens({ tokens, prefix: "pxma:close_under_ma60", value: features.closeOverMa60, thresholds: [-0.1], direction: "le" })
  if (gt(features.ma5, features.ma20)) tokens.push("pxma:ma5_gt_ma20")
  if (gt(features.ma20, features.ma60)) tokens.push("pxma:ma20_gt_ma60")
  if (gt(features.ma60, features.ma120)) tokens.push("pxma:ma60_gt_ma120")
  if (gt(features.ma5, features.ma20) && gt(features.ma20, features.ma60) && gt(features.ma60, features.ma120)) {
    tokens.push("pxma:ma5_gt_ma20_gt_ma60_gt_ma120")
  }

  if (features.closeBreakPreviousHigh20) tokens.push("level:close_break_high20")
  if (features.closeBreakPreviousHigh60) tokens.push("level:close_break_high60")
  if (features.highBreakPreviousHigh20) tokens.push("level:high_break_high20")
  if (features.closeReclaimMa20) tokens.push("recover:close_reclaim_ma20")
  if (features.closeReclaimMa60) tokens.push("recover:close_reclaim_ma60")
  const uniqueTokens = [...new Set(tokens.map((token) => DAILY_OHLCV_D0_TOKEN_RENAMES.get(token) ?? token))].sort()
  const vocabulary = new Set(TP12_DAILY_OHLCV_D0_TOKEN_VOCABULARY)
  const unknownTokens = uniqueTokens.filter((token) => !vocabulary.has(token))
  if (unknownTokens.length > 0) {
    throw new Error(`daily OHLCV D0 tokenizer emitted tokens outside contract vocabulary: ${unknownTokens.join(", ")}`)
  }
  return uniqueTokens
}

const copyOptionalLabelMetrics = (event) => {
  const out = {}
  for (const key of [
    "hitDefinition",
    "executionPolicyId",
    "chartHitTarget",
    "entryExecutable",
    "operationalHitTarget",
    "executableHitTarget",
    "operationalMissReasons",
    "operationalMissReason",
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
  featureSurfaceId,
  minDistinctTokenCount,
  maxDistinctTokenCount,
  forbiddenTokenFamilies,
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
    featureSurfaceId,
    minDistinctTokenCount,
    maxDistinctTokenCount,
    forbiddenTokenFamilies,
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
        const tokens =
          options.tokenizerVersion === TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION
            ? buildDailyOhlcvD0Tokens(featureSnapshot)
            : buildTokens(featureSnapshot)
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
  if (options.minDistinctTokenCount > 0 && tokenCounts.size < options.minDistinctTokenCount) {
    failures.push(`distinct_token_count_below_min:${tokenCounts.size}<${options.minDistinctTokenCount}`)
  }
  if (options.maxDistinctTokenCount > 0 && tokenCounts.size > options.maxDistinctTokenCount) {
    failures.push(`distinct_token_count_above_max:${tokenCounts.size}>${options.maxDistinctTokenCount}`)
  }
  for (const family of options.forbiddenTokenFamilies) {
    if (tokenFamilyCounts.has(family)) failures.push(`forbidden_token_family_present:${family}`)
  }
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
    featureSurfaceId: options.featureSurfaceId,
    requireUniverse: options.requireUniverse,
    includeFeatureSnapshot: options.includeFeatureSnapshot,
    minTokenCount: options.minTokenCount,
    belowMinTokenPolicy: options.belowMinTokenPolicy,
    minDistinctTokenCount: options.minDistinctTokenCount,
    maxDistinctTokenCount: options.maxDistinctTokenCount,
    forbiddenTokenFamilies: options.forbiddenTokenFamilies,
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
