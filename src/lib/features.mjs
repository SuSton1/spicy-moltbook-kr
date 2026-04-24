import { PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE } from "./perfect_prototype_prejump_contract.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE,
} from "./perfect_prototype_contextual_features.mjs"

const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_FEATURE_KEYS = Object.freeze([
  "pattern.insideBarCount3",
  "pattern.nr4",
  "pattern.nr7",
  "pattern.closeClusterTightness3",
  "pattern.closeClusterTightness5",
  "shape.sidewaysScore3",
  "shape.sidewaysScore5",
  "shape.sidewaysScore10",
  "volume.lowVolumeCount3",
  "volume.lowVolumeCount5",
  "volume.volumeVsRecentPeak",
  "level.closeNearHigh20",
  "level.closeNearHigh60",
  "level.touchRecentHighCount10",
  "level.rejectionFromRecentHighCount10",
])

const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_FEATURE_KEYS = Object.freeze([
  ...PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_FEATURE_KEYS,
  "candle.longLowerWickScore",
  "candle.lowerWickToBodyRatio",
  "candle.bullishCloseStrength",
  "pattern.longLowerWickCount3",
  "pattern.supportHoldAtMa60",
  "pattern.supportHoldAtMa120",
  "pattern.reboundFromMa60",
  "pattern.reboundFromMa120",
  "volume.decay3",
  "volume.decay5",
  "shape.coilScore",
  "shape.flagLikeScore",
  "shape.breakoutPauseScore",
  "shape.failedBreakoutCount20",
  "level.distanceToPivotHigh",
  "level.distanceToPivotLow",
  "anchor.daysSinceImpulseBar",
  "anchor.maxRunupSinceImpulse",
  "chain.impulseThenCompression3",
  "chain.impulseThenDryUp3",
  "chain.impulseThenDryUp5",
  "score.flagQuality",
  "score.rebreakPotential",
  "score.failedBreakRisk",
])

const pickFeatureKeys = (source, keys) => {
  const out = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source ?? {}, key)) {
      out[key] = source[key]
    }
  }
  return out
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const safeDiv = (a, b) => {
  const x = num(a)
  const y = num(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null
  return x / y
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

const mean = (values) => {
  const list = (values ?? []).map(num).filter(Number.isFinite)
  if (!list.length) return null
  return list.reduce((acc, v) => acc + v, 0) / list.length
}

const stdev = (values) => {
  const list = (values ?? []).map(num).filter(Number.isFinite)
  if (list.length < 2) return null
  const m = mean(list)
  const varSum = list.reduce((acc, v) => acc + (v - m) ** 2, 0) / list.length
  return Math.sqrt(varSum)
}

const ma = (series, endIdx, window) => {
  if (!Array.isArray(series) || endIdx < 0 || window <= 0) return null
  const start = Math.max(0, endIdx - window + 1)
  const closes = []
  for (let i = start; i <= endIdx; i += 1) {
    const c = num(series[i]?.close)
    if (Number.isFinite(c)) closes.push(c)
  }
  if (closes.length < Math.max(3, Math.floor(window * 0.6))) return null
  return mean(closes)
}

const returns = (series, endIdx, window) => {
  if (!Array.isArray(series) || endIdx <= 0) return []
  const start = Math.max(1, endIdx - window + 1)
  const out = []
  for (let i = start; i <= endIdx; i += 1) {
    const p = num(series[i - 1]?.close)
    const c = num(series[i]?.close)
    if (!Number.isFinite(p) || !Number.isFinite(c) || p === 0) {
      out.push(0)
    } else {
      out.push(c / p - 1)
    }
  }
  return out
}

const normalizeSeq = (values, length) => {
  const out = Array.isArray(values) ? values.slice(-length) : []
  while (out.length < length) out.unshift(0)
  const m = mean(out) ?? 0
  const s = stdev(out) ?? 0
  if (!s) return out.map((v) => Number(v) || 0)
  return out.map((v) => ((Number(v) || 0) - m) / s)
}

export const makeSequence = (series, endIdx, window) =>
  normalizeSeq(returns(series, endIdx, window), window)

const buildValuePrefix = (values) => {
  const sumPrefix = new Float64Array(values.length + 1)
  const countPrefix = new Uint32Array(values.length + 1)
  for (let i = 0; i < values.length; i += 1) {
    const current = values[i]
    sumPrefix[i + 1] = sumPrefix[i] + (Number.isFinite(current) ? current : 0)
    countPrefix[i + 1] = countPrefix[i] + (Number.isFinite(current) ? 1 : 0)
  }
  return { sumPrefix, countPrefix }
}

const prefixMean = (prefix, startIdx, endIdx, minCount = 1) => {
  if (!prefix || endIdx < startIdx) return null
  const start = Math.max(0, Number(startIdx) || 0)
  const end = Math.max(start, Number(endIdx) || 0)
  const count = Number(prefix.countPrefix?.[end + 1] ?? 0) - Number(prefix.countPrefix?.[start] ?? 0)
  if (count < Math.max(1, Number(minCount) || 1)) return null
  const sum = Number(prefix.sumPrefix?.[end + 1] ?? 0) - Number(prefix.sumPrefix?.[start] ?? 0)
  return sum / count
}

const buildReturnsCache = (series) => {
  const out = new Float64Array(Array.isArray(series) ? series.length : 0)
  for (let i = 1; i < out.length; i += 1) {
    const p = num(series[i - 1]?.close)
    const c = num(series[i]?.close)
    out[i] = Number.isFinite(p) && Number.isFinite(c) && p !== 0 ? c / p - 1 : 0
  }
  const sumPrefix = new Float64Array(out.length + 1)
  const sqPrefix = new Float64Array(out.length + 1)
  for (let i = 0; i < out.length; i += 1) {
    const v = out[i]
    sumPrefix[i + 1] = sumPrefix[i] + v
    sqPrefix[i + 1] = sqPrefix[i] + v * v
  }
  return {
    values: out,
    sumPrefix,
    sqPrefix
  }
}

const prefixStdev = (returnsCache, startIdx, endIdx) => {
  if (!returnsCache || endIdx < startIdx) return null
  const start = Math.max(0, Number(startIdx) || 0)
  const end = Math.max(start, Number(endIdx) || 0)
  const count = end - start + 1
  if (count < 2) return null
  const sum = returnsCache.sumPrefix[end + 1] - returnsCache.sumPrefix[start]
  const sqSum = returnsCache.sqPrefix[end + 1] - returnsCache.sqPrefix[start]
  const meanVal = sum / count
  const variance = sqSum / count - meanVal * meanVal
  return variance > 0 ? Math.sqrt(variance) : 0
}

const buildRollingExtrema = (values, window, mode = "max") => {
  const n = Array.isArray(values) ? values.length : 0
  const out = new Array(n).fill(null)
  const deque = []
  const isBetter =
    mode === "min"
      ? (left, right) => left >= right
      : (left, right) => left <= right
  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - window + 1)
    while (deque.length && deque[0] < start) deque.shift()
    const current = values[i]
    if (Number.isFinite(current)) {
      while (deque.length) {
        const tailIdx = deque[deque.length - 1]
        const tailVal = values[tailIdx]
        if (!Number.isFinite(tailVal) || isBetter(tailVal, current)) {
          deque.pop()
          continue
        }
        break
      }
      deque.push(i)
    }
    while (deque.length && deque[0] < start) deque.shift()
    out[i] = deque.length ? values[deque[0]] : null
  }
  return out
}

export const buildSeriesFeatureRuntimeCache = (series) => {
  const rows = Array.isArray(series) ? series : []
  const closeValues = rows.map((row) => num(row?.close))
  const volumeValues = rows.map((row) => num(row?.volume))
  const highValues = rows.map((row) => num(row?.high))
  const lowValues = rows.map((row) => num(row?.low))
  const tradingValueValues = rows.map((row) => {
    const close = num(row?.close)
    const volume = num(row?.volume)
    return Number.isFinite(close) && Number.isFinite(volume) ? close * volume : null
  })
  return {
    length: rows.length,
    closeValues,
    volumeValues,
    highValues,
    lowValues,
    tradingValueValues,
    closePrefix: buildValuePrefix(closeValues),
    volumePrefix: buildValuePrefix(volumeValues),
    tradingValuePrefix: buildValuePrefix(tradingValueValues),
    returnsCache: buildReturnsCache(rows),
    extremaByWindow: new Map()
  }
}

const resolveWindowExtrema = (cache, window) => {
  const safeWindow = Math.max(1, Number(window) || 1)
  const cached = cache?.extremaByWindow?.get(safeWindow)
  if (cached) return cached
  const built = {
    highMaxByEnd: buildRollingExtrema(cache?.highValues ?? [], safeWindow, "max"),
    lowMinByEnd: buildRollingExtrema(cache?.lowValues ?? [], safeWindow, "min")
  }
  cache?.extremaByWindow?.set(safeWindow, built)
  return built
}

const maFromCache = (cache, endIdx, window) => {
  if (!cache || endIdx < 0 || window <= 0) return null
  const start = Math.max(0, endIdx - window + 1)
  return prefixMean(cache.closePrefix, start, endIdx, Math.max(3, Math.floor(window * 0.6)))
}

const meanVolumeFromCache = (cache, startIdx, endIdx) =>
  prefixMean(cache?.volumePrefix, startIdx, endIdx, 1)

const meanTradingValueFromCache = (cache, startIdx, endIdx) =>
  prefixMean(cache?.tradingValuePrefix, startIdx, endIdx, 1)

const retOverFromCache = (cache, endIdx, lookback) => {
  if (!cache || !Number.isInteger(endIdx) || endIdx < 0) return null
  const lb = Math.max(1, Number(lookback) || 0)
  const prevIdx = endIdx - lb
  if (prevIdx < 0) return null
  const prevClose = cache.closeValues?.[prevIdx]
  const closeNow = cache.closeValues?.[endIdx]
  if (!Number.isFinite(prevClose) || !Number.isFinite(closeNow) || prevClose === 0) return null
  return closeNow / prevClose - 1
}

export const makeSequenceFromCache = ({ cache, series, endIdx, window }) => {
  if (!cache) {
    throw new Error("makeSequenceFromCache requires a series feature runtime cache")
  }
  if (endIdx <= 0) return normalizeSeq([], window)
  const start = Math.max(1, endIdx - window + 1)
  return normalizeSeq(Array.from(cache.returnsCache.values.slice(start, endIdx + 1)), window)
}

const retOver = (series, endIdx, lookback) => {
  if (!Array.isArray(series) || !Number.isInteger(endIdx) || endIdx < 0) return null
  const lb = Math.max(1, Number(lookback) || 0)
  if (lb < 1) return null
  const prevIdx = endIdx - lb
  if (prevIdx < 0) return null
  const prevClose = num(series[prevIdx]?.close)
  const closeNow = num(series[endIdx]?.close)
  if (!Number.isFinite(prevClose) || !Number.isFinite(closeNow) || prevClose === 0) return null
  return closeNow / prevClose - 1
}

const sliceHighLow = (series, startIdx, endIdx) => {
  let highMax = Number.NEGATIVE_INFINITY
  let lowMin = Number.POSITIVE_INFINITY
  let foundHigh = false
  let foundLow = false
  for (let i = startIdx; i <= endIdx; i += 1) {
    const h = num(series[i]?.high)
    const l = num(series[i]?.low)
    if (Number.isFinite(h) && h > highMax) {
      highMax = h
      foundHigh = true
    }
    if (Number.isFinite(l) && l < lowMin) {
      lowMin = l
      foundLow = true
    }
  }
  return {
    highMax: foundHigh ? highMax : null,
    lowMin: foundLow ? lowMin : null
  }
}

const meanVolume = (series, startIdx, endIdx) => {
  const values = []
  for (let i = startIdx; i <= endIdx; i += 1) {
    const v = num(series[i]?.volume)
    if (Number.isFinite(v)) values.push(v)
  }
  return mean(values)
}

const meanTradingValue = (series, startIdx, endIdx) => {
  const values = []
  for (let i = startIdx; i <= endIdx; i += 1) {
    const c = num(series[i]?.close)
    const v = num(series[i]?.volume)
    if (!Number.isFinite(c) || !Number.isFinite(v)) continue
    values.push(c * v)
  }
  return mean(values)
}

const resolveGapFillRatio = ({ prevClose, open, close }) => {
  const prev = num(prevClose)
  const o = num(open)
  const cl = num(close)
  if (!Number.isFinite(prev) || !Number.isFinite(o) || !Number.isFinite(cl) || prev === o) {
    return null
  }
  const gapSize = o - prev
  if (gapSize > 0) {
    return (o - cl) / gapSize
  }
  return (cl - o) / Math.abs(gapSize)
}

const resolveLiquidityStress = (avgTradingValue20d) => {
  const value = num(avgTradingValue20d)
  if (!Number.isFinite(value) || value <= 0) return null
  return clamp01((1_200_000_000 - value) / 1_200_000_000)
}

const resolveFailedBreakoutCount = ({
  series,
  asOfIdx,
  lookback = 20,
  breakoutWindow = 20
}) => {
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 1) return 0
  const safeLookback = Math.max(1, Number(lookback) || 20)
  const safeBreakoutWindow = Math.max(2, Number(breakoutWindow) || 20)
  const breakoutEpsilon = 0.001
  const reclaimEpsilon = 0.0005
  const startIdx = Math.max(1, asOfIdx - safeLookback + 1)
  let count = 0
  for (let i = startIdx; i <= asOfIdx; i += 1) {
    const currentHigh = num(series[i]?.high)
    const currentClose = num(series[i]?.close)
    const prevHigh = num(
      sliceHighLow(series, Math.max(0, i - safeBreakoutWindow), Math.max(0, i - 1))?.highMax,
    )
    if (!Number.isFinite(currentHigh) || !Number.isFinite(currentClose) || !Number.isFinite(prevHigh)) {
      continue
    }
    if (
      currentHigh > prevHigh * (1 + breakoutEpsilon) &&
      currentClose <= prevHigh * (1 + reclaimEpsilon)
    ) {
      count += 1
    }
  }
  return count
}

const resolveFailedBreakoutCountFromCache = ({
  cache,
  asOfIdx,
  lookback = 20,
  breakoutWindow = 20
}) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 1) return 0
  const safeLookback = Math.max(1, Number(lookback) || 20)
  const safeBreakoutWindow = Math.max(2, Number(breakoutWindow) || 20)
  const breakoutEpsilon = 0.001
  const reclaimEpsilon = 0.0005
  const extrema = resolveWindowExtrema(cache, safeBreakoutWindow)
  const startIdx = Math.max(1, asOfIdx - safeLookback + 1)
  let count = 0
  for (let i = startIdx; i <= asOfIdx; i += 1) {
    const currentHigh = cache?.highValues?.[i] ?? null
    const currentClose = cache?.closeValues?.[i] ?? null
    const prevHigh = i > 0 ? extrema?.highMaxByEnd?.[i - 1] ?? null : null
    if (!Number.isFinite(currentHigh) || !Number.isFinite(currentClose) || !Number.isFinite(prevHigh)) {
      continue
    }
    if (
      currentHigh > prevHigh * (1 + breakoutEpsilon) &&
      currentClose <= prevHigh * (1 + reclaimEpsilon)
    ) {
      count += 1
    }
  }
  return count
}

const resolveGapDirectionalScores = ({ prevClose, open, close }) => {
  const prev = num(prevClose)
  const o = num(open)
  const cl = num(close)
  if (!Number.isFinite(prev) || !Number.isFinite(o) || !Number.isFinite(cl) || prev === o) {
    return {
      gapFillThenContinueScore: null,
      gapFillThenRevertScore: null
    }
  }
  const gapSize = o - prev
  const gapAbs = Math.abs(gapSize)
  if (!Number.isFinite(gapAbs) || gapAbs <= 0) {
    return {
      gapFillThenContinueScore: null,
      gapFillThenRevertScore: null
    }
  }
  const fillRatio = resolveGapFillRatio({ prevClose: prev, open: o, close: cl })
  const fillStrength = clamp01(Math.max(0, Number(fillRatio ?? 0) || 0))
  const continuationNumerator = gapSize > 0 ? cl - prev : prev - cl
  const revertNumerator = gapSize > 0 ? prev - cl : cl - prev
  return {
    gapFillThenContinueScore: fillStrength * clamp(continuationNumerator / gapAbs, 0, 1),
    gapFillThenRevertScore: fillStrength * clamp(revertNumerator / gapAbs, 0, 1)
  }
}

const resolveExecutionFeasibilityScore = ({
  avgTradingValue20d,
  liquidityStress,
  exhaustionProxy,
  rangePct
}) => {
  const valueAdequacy = clamp01((Number(avgTradingValue20d) || 0) / 1_200_000_000)
  const liquidityStressValue = clamp01(
    Number.isFinite(Number(liquidityStress))
      ? Number(liquidityStress)
      : resolveLiquidityStress(avgTradingValue20d) ?? 1,
  )
  const exhaustionStress = clamp01((Number(exhaustionProxy) || 0) / 0.08)
  const spreadStress = clamp01((Number(rangePct) || 0) / 0.11)
  return clamp01(
    valueAdequacy * 0.4 +
      (1 - liquidityStressValue) * 0.25 +
      (1 - exhaustionStress) * 0.2 +
      (1 - spreadStress) * 0.15,
  )
}

const MA_PATTERN_PERIODS = [5, 10, 20, 60, 120]

const safeDelta = (left, right) => {
  const ratio = safeDiv(left, right)
  return Number.isFinite(ratio) ? ratio - 1 : null
}

const safeAbsDelta = (left, right) => {
  const delta = safeDelta(left, right)
  return Number.isFinite(delta) ? Math.abs(delta) : null
}

const toFlag = (condition) => (condition ? 1 : 0)

const boundedTightnessScore = (value, tolerance) => {
  const n = num(value)
  const t = Math.max(0.000001, Number(tolerance) || 0.01)
  if (!Number.isFinite(n)) return null
  return clamp01(1 - Math.abs(n) / t)
}

const dryUpScore = (value, scale) => {
  const n = num(value)
  const s = Math.max(0.000001, Number(scale) || 0.01)
  if (!Number.isFinite(n)) return null
  if (n >= 0) return 0
  return clamp01(Math.abs(n) / s)
}

const overlapRatio = (leftLow, leftHigh, rightLow, rightHigh) => {
  const lLow = num(leftLow)
  const lHigh = num(leftHigh)
  const rLow = num(rightLow)
  const rHigh = num(rightHigh)
  if (
    !Number.isFinite(lLow) ||
    !Number.isFinite(lHigh) ||
    !Number.isFinite(rLow) ||
    !Number.isFinite(rHigh)
  ) {
    return null
  }
  const overlap = Math.min(lHigh, rHigh) - Math.max(lLow, rLow)
  const union = Math.max(lHigh, rHigh) - Math.min(lLow, rLow)
  if (!Number.isFinite(union) || union <= 0) return null
  return clamp01(Math.max(0, overlap) / union)
}

const resolvePivotValueFromCache = ({ cache, asOfIdx, mode = "high", lookback = 20 }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 2) return null
  const values = mode === "low" ? cache.lowValues : cache.highValues
  const startIdx = Math.max(1, asOfIdx - Math.max(3, Number(lookback) || 20))
  for (let idx = asOfIdx - 1; idx >= startIdx; idx -= 1) {
    const prev = num(values?.[idx - 1])
    const current = num(values?.[idx])
    const next = num(values?.[idx + 1])
    if (!Number.isFinite(prev) || !Number.isFinite(current) || !Number.isFinite(next)) continue
    if (mode === "low") {
      if (current <= prev && current <= next) return current
      continue
    }
    if (current >= prev && current >= next) return current
  }
  return null
}

const resolveRangeMetrics = ({ close, high, low }) => {
  const cl = num(close)
  const h = num(high)
  const l = num(low)
  const range = Number.isFinite(h) && Number.isFinite(l) ? h - l : null
  const rangePct =
    Number.isFinite(range) && Number.isFinite(cl) && cl !== 0 ? range / cl : null
  return { range, rangePct }
}

const resolveCandleSignalMetrics = ({ open, high, low, close, prevClose = null }) => {
  const o = num(open)
  const h = num(high)
  const l = num(low)
  const cl = num(close)
  const prev = num(prevClose)
  const { range, rangePct } = resolveRangeMetrics({ close: cl, high: h, low: l })
  const body = Number.isFinite(cl) && Number.isFinite(o) ? cl - o : null
  const bodyAbs = Number.isFinite(body) ? Math.abs(body) : null
  const upperWick =
    Number.isFinite(h) && Number.isFinite(cl) && Number.isFinite(o) ? h - Math.max(cl, o) : null
  const lowerWick =
    Number.isFinite(l) && Number.isFinite(cl) && Number.isFinite(o) ? Math.min(cl, o) - l : null
  const bodyToRangeRatio =
    Number.isFinite(bodyAbs) && Number.isFinite(range) && range !== 0 ? bodyAbs / range : null
  const upperWickPct =
    Number.isFinite(upperWick) && Number.isFinite(range) && range !== 0 ? upperWick / range : null
  const lowerWickPct =
    Number.isFinite(lowerWick) && Number.isFinite(range) && range !== 0 ? lowerWick / range : null
  const closePos =
    Number.isFinite(cl) && Number.isFinite(l) && Number.isFinite(range) && range !== 0
      ? (cl - l) / range
      : null
  const bodyPct =
    Number.isFinite(body) && Number.isFinite(range) && range !== 0 ? body / range : null
  const bodyAbsPct =
    Number.isFinite(bodyAbs) && Number.isFinite(cl) && cl !== 0 ? bodyAbs / cl : null
  const dojiScore =
    Number.isFinite(bodyToRangeRatio) ? clamp01(1 - bodyToRangeRatio / 0.18) : null
  const longUpperWickScore =
    Number.isFinite(upperWickPct) ? clamp01((upperWickPct - 0.2) / 0.5) : null
  const longLowerWickScore =
    Number.isFinite(lowerWickPct) ? clamp01((lowerWickPct - 0.2) / 0.5) : null
  const upperWickToBodyRatio =
    Number.isFinite(upperWick) && Number.isFinite(bodyAbs) && bodyAbs > 0 ? upperWick / bodyAbs : null
  const lowerWickToBodyRatio =
    Number.isFinite(lowerWick) && Number.isFinite(bodyAbs) && bodyAbs > 0 ? lowerWick / bodyAbs : null
  const bullishCloseStrength =
    Number.isFinite(body) && body > 0 && Number.isFinite(closePos)
      ? clamp01(closePos * 0.7 + (1 - clamp01(bodyToRangeRatio ?? 0)) * 0.3)
      : 0
  const bearishCloseWeakness =
    Number.isFinite(body) && body < 0 && Number.isFinite(closePos)
      ? clamp01((1 - closePos) * 0.7 + (1 - clamp01(bodyToRangeRatio ?? 0)) * 0.3)
      : 0
  const closeRetPct = safeDelta(cl, prev)
  return {
    open: o,
    high: h,
    low: l,
    close: cl,
    prevClose: prev,
    range,
    rangePct,
    body,
    bodyPct,
    bodyAbsPct,
    upperWick,
    upperWickPct,
    lowerWick,
    lowerWickPct,
    bodyToRangeRatio,
    upperWickToBodyRatio,
    lowerWickToBodyRatio,
    closePos,
    dojiScore,
    longUpperWickScore,
    longLowerWickScore,
    bullishCloseStrength,
    bearishCloseWeakness,
    closeRetPct,
  }
}

const countWindowBy = ({ startIdx, endIdx, predicate }) => {
  let count = 0
  for (let idx = Math.max(0, startIdx); idx <= endIdx; idx += 1) {
    if (predicate(idx) === true) count += 1
  }
  return count
}

const consecutiveWindowBy = ({ endIdx, maxBars, predicate }) => {
  let count = 0
  const startIdx = Math.max(0, endIdx - Math.max(1, maxBars) + 1)
  for (let idx = endIdx; idx >= startIdx; idx -= 1) {
    if (predicate(idx) !== true) break
    count += 1
  }
  return count
}

const monotonicDeclineFromCache = ({ cache, asOfIdx, window }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 1) return 0
  const startIdx = Math.max(0, asOfIdx - Math.max(1, window) + 1)
  let previous = null
  for (let idx = startIdx; idx <= asOfIdx; idx += 1) {
    const current = num(cache?.volumeValues?.[idx])
    if (!Number.isFinite(current)) return 0
    if (Number.isFinite(previous) && current > previous) return 0
    previous = current
  }
  return 1
}

const daysSinceMatch = ({ asOfIdx, maxLookback, predicate }) => {
  const startIdx = Math.max(0, asOfIdx - Math.max(1, maxLookback) + 1)
  for (let idx = asOfIdx; idx >= startIdx; idx -= 1) {
    if (predicate(idx) === true) return asOfIdx - idx
  }
  return null
}

const windowBoxWidthFromCache = ({ cache, asOfIdx, window, closeValue }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 0) return null
  const safeWindow = Math.max(1, Number(window) || 1)
  const startIdx = Math.max(0, asOfIdx - safeWindow + 1)
  const { highMax, lowMin } = {
    highMax: resolveWindowExtrema(cache, safeWindow).highMaxByEnd?.[asOfIdx] ?? null,
    lowMin: resolveWindowExtrema(cache, safeWindow).lowMinByEnd?.[asOfIdx] ?? null,
  }
  const cl = num(closeValue)
  if (!Number.isFinite(highMax) || !Number.isFinite(lowMin) || !Number.isFinite(cl) || cl === 0) return null
  return (highMax - lowMin) / cl
}

const closeClusterTightnessFromCache = ({ cache, asOfIdx, window, closeValue }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 0) return null
  const startIdx = Math.max(0, asOfIdx - Math.max(1, window) + 1)
  const closes = []
  for (let idx = startIdx; idx <= asOfIdx; idx += 1) {
    const current = num(cache?.closeValues?.[idx])
    if (Number.isFinite(current)) closes.push(current)
  }
  const cl = num(closeValue)
  if (closes.length < 2 || !Number.isFinite(cl) || cl === 0) return null
  return (stdev(closes) ?? 0) / cl
}

const highLowOverlapFromCache = ({ cache, asOfIdx, window }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 1) return null
  const startIdx = Math.max(1, asOfIdx - Math.max(1, window) + 1)
  const overlaps = []
  for (let idx = startIdx; idx <= asOfIdx; idx += 1) {
    const ratio = overlapRatio(
      cache?.lowValues?.[idx - 1],
      cache?.highValues?.[idx - 1],
      cache?.lowValues?.[idx],
      cache?.highValues?.[idx],
    )
    if (Number.isFinite(ratio)) overlaps.push(ratio)
  }
  return overlaps.length ? mean(overlaps) : null
}

const recentWindowMetricsFromCache = ({ cache, asOfIdx, window, closeValue }) => {
  const boxWidth = windowBoxWidthFromCache({ cache, asOfIdx, window, closeValue })
  const closeClusterTightness = closeClusterTightnessFromCache({ cache, asOfIdx, window, closeValue })
  const startIdx = Math.max(0, asOfIdx - Math.max(1, window) + 1)
  const startClose = num(cache?.closeValues?.[startIdx])
  const closeNow = num(closeValue)
  const drift =
    Number.isFinite(closeNow) && Number.isFinite(startClose) && startClose !== 0
      ? closeNow / startClose - 1
      : null
  const sidewaysScore =
    Number.isFinite(boxWidth) && Number.isFinite(closeClusterTightness) && Number.isFinite(drift)
      ? clamp01(
        (boundedTightnessScore(boxWidth, 0.12) +
          boundedTightnessScore(closeClusterTightness, 0.04) +
          boundedTightnessScore(drift, 0.08)) /
          3,
      )
      : null
  return {
    boxWidth,
    closeClusterTightness,
    drift,
    sidewaysScore,
    overlap: highLowOverlapFromCache({ cache, asOfIdx, window }),
  }
}

const volumeDecayFromCache = ({ cache, asOfIdx, window }) => {
  const safeWindow = Math.max(1, Number(window) || 1)
  const recentStart = Math.max(0, asOfIdx - safeWindow + 1)
  const recentMean = meanVolumeFromCache(cache, recentStart, asOfIdx)
  const prevEnd = recentStart - 1
  const prevStart = Math.max(0, prevEnd - safeWindow + 1)
  const prevMean =
    prevEnd >= prevStart ? meanVolumeFromCache(cache, prevStart, prevEnd) : null
  return safeDelta(recentMean, prevMean)
}

const lowVolumeCountFromCache = ({ cache, asOfIdx, window, avgVolume20 }) =>
  countWindowBy({
    startIdx: Math.max(0, asOfIdx - Math.max(1, window) + 1),
    endIdx: asOfIdx,
    predicate: (idx) => {
      const current = num(cache?.volumeValues?.[idx])
      return Number.isFinite(current) && Number.isFinite(avgVolume20) && current < avgVolume20
    },
  })

const failedBreakCountAroundMaFromCache = ({ cache, asOfIdx, maPeriod, mode = "above", lookback = 10 }) => {
  if (!cache || !Number.isInteger(asOfIdx) || asOfIdx < 1) return 0
  const safeLookback = Math.max(1, Number(lookback) || 10)
  const startIdx = Math.max(1, asOfIdx - safeLookback + 1)
  let count = 0
  for (let idx = startIdx; idx <= asOfIdx; idx += 1) {
    const maValue = maFromCache(cache, idx, maPeriod)
    const closeValue = num(cache?.closeValues?.[idx])
    const highValue = num(cache?.highValues?.[idx])
    const lowValue = num(cache?.lowValues?.[idx])
    if (!Number.isFinite(maValue)) continue
    if (mode === "below") {
      if (
        Number.isFinite(lowValue) &&
        lowValue < maValue * 0.998 &&
        Number.isFinite(closeValue) &&
        closeValue >= maValue
      ) {
        count += 1
      }
      continue
    }
    if (
      Number.isFinite(highValue) &&
      highValue > maValue * 1.002 &&
      Number.isFinite(closeValue) &&
      closeValue <= maValue
    ) {
      count += 1
    }
  }
  return count
}

const resolveImpulseAnchorFromSeries = ({ series, asOfIdx }) => {
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 1) return null
  const startIdx = Math.max(1, asOfIdx - 20)
  let best = null
  for (let idx = startIdx; idx <= asOfIdx; idx += 1) {
    const row = series[idx]
    const metrics = resolveCandleSignalMetrics({
      open: row?.open,
      high: row?.high,
      low: row?.low,
      close: row?.close,
      prevClose: series[idx - 1]?.close,
    })
    const avgVol20 = meanVolume(series, Math.max(0, idx - 19), idx)
    const volumeRatio20 = safeDiv(row?.volume, avgVol20)
    const score =
      Math.max(0, Number(metrics.closeRetPct ?? 0)) * 0.5 +
      Math.max(0, Number(metrics.rangePct ?? 0)) * 0.2 +
      Math.max(0, Number(volumeRatio20 ?? 0) - 1) * 0.2 +
      Math.max(0, Number(metrics.bullishCloseStrength ?? 0)) * 0.1
    if (!best || score > best.score || (score === best.score && idx > best.idx)) {
      best = {
        idx,
        score,
        metrics,
        avgVol20,
        volumeRatio20,
      }
    }
  }
  if (!best || !Number.isFinite(best.score) || best.score < 0.05) return null
  return best
}

const buildExtendedSnapshotFeatureVecFromCache = ({
  cache,
  series,
  asOfIdx,
  closeValue,
  openValue,
  highValue,
  lowValue,
  volumeValue,
  avgVol20,
  avgValue20,
  valueRatio20,
  maValues,
  prevMaValues,
  selectionMode = "full",
}) => {
  const out = {}
  const close = num(closeValue)
  const open = num(openValue)
  const high = num(highValue)
  const low = num(lowValue)
  const volume = num(volumeValue)
  const currentCandle = resolveCandleSignalMetrics({
    open,
    high,
    low,
    close,
    prevClose: cache?.closeValues?.[asOfIdx - 1],
  })

  out["candle.dojiScore"] = currentCandle.dojiScore
  out["candle.longUpperWickScore"] = currentCandle.longUpperWickScore
  out["candle.longLowerWickScore"] = currentCandle.longLowerWickScore
  out["candle.bodyToRangeRatio"] = currentCandle.bodyToRangeRatio
  out["candle.upperWickToBodyRatio"] = currentCandle.upperWickToBodyRatio
  out["candle.lowerWickToBodyRatio"] = currentCandle.lowerWickToBodyRatio
  out["candle.bullishCloseStrength"] = currentCandle.bullishCloseStrength
  out["candle.bearishCloseWeakness"] = currentCandle.bearishCloseWeakness

  for (const period of MA_PATTERN_PERIODS) {
    const maValue = num(maValues?.[period])
    const prevMaValue = num(prevMaValues?.[period])
    const prevClose = num(cache?.closeValues?.[asOfIdx - 1])
    out[`trend.closeOverMa${period}`] = safeDelta(close, maValue)
    out[`trend.openOverMa${period}`] = safeDelta(open, maValue)
    out[`trend.highOverMa${period}`] = safeDelta(high, maValue)
    out[`trend.lowOverMa${period}`] = safeDelta(low, maValue)
    out[`trend.closeNearMa${period}Pct`] = safeAbsDelta(close, maValue)
    out[`trend.openNearMa${period}Pct`] = safeAbsDelta(open, maValue)
    out[`trend.lowNearMa${period}Pct`] = safeAbsDelta(low, maValue)
    out[`trend.highNearMa${period}Pct`] = safeAbsDelta(high, maValue)
    out[`trend.maTouch${period}`] =
      Number.isFinite(maValue) && Number.isFinite(low) && Number.isFinite(high)
        ? toFlag(low <= maValue && high >= maValue)
        : null
    out[`trend.maTouchCount${period}_3d`] = countWindowBy({
      startIdx: Math.max(0, asOfIdx - 2),
      endIdx: asOfIdx,
      predicate: (idx) => {
        const lowAt = num(cache?.lowValues?.[idx])
        const highAt = num(cache?.highValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(lowAt) && Number.isFinite(highAt) && Number.isFinite(maAt) && lowAt <= maAt && highAt >= maAt
      },
    })
    out[`trend.maTouchCount${period}_5d`] = countWindowBy({
      startIdx: Math.max(0, asOfIdx - 4),
      endIdx: asOfIdx,
      predicate: (idx) => {
        const lowAt = num(cache?.lowValues?.[idx])
        const highAt = num(cache?.highValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(lowAt) && Number.isFinite(highAt) && Number.isFinite(maAt) && lowAt <= maAt && highAt >= maAt
      },
    })
    out[`trend.daysSinceLastTouchMa${period}`] = daysSinceMatch({
      asOfIdx,
      maxLookback: 40,
      predicate: (idx) => {
        const lowAt = num(cache?.lowValues?.[idx])
        const highAt = num(cache?.highValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(lowAt) && Number.isFinite(highAt) && Number.isFinite(maAt) && lowAt <= maAt && highAt >= maAt
      },
    })
    out[`trend.holdAboveMa${period}Count3`] = consecutiveWindowBy({
      endIdx: asOfIdx,
      maxBars: 3,
      predicate: (idx) => {
        const closeAt = num(cache?.closeValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(closeAt) && Number.isFinite(maAt) && closeAt >= maAt
      },
    })
    out[`trend.holdAboveMa${period}Count5`] = consecutiveWindowBy({
      endIdx: asOfIdx,
      maxBars: 5,
      predicate: (idx) => {
        const closeAt = num(cache?.closeValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(closeAt) && Number.isFinite(maAt) && closeAt >= maAt
      },
    })
    out[`trend.holdBelowMa${period}Count3`] = consecutiveWindowBy({
      endIdx: asOfIdx,
      maxBars: 3,
      predicate: (idx) => {
        const closeAt = num(cache?.closeValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(closeAt) && Number.isFinite(maAt) && closeAt <= maAt
      },
    })
    out[`trend.holdBelowMa${period}Count5`] = consecutiveWindowBy({
      endIdx: asOfIdx,
      maxBars: 5,
      predicate: (idx) => {
        const closeAt = num(cache?.closeValues?.[idx])
        const maAt = maFromCache(cache, idx, period)
        return Number.isFinite(closeAt) && Number.isFinite(maAt) && closeAt <= maAt
      },
    })
    out[`trend.crossAboveMa${period}Today`] =
      Number.isFinite(prevClose) && Number.isFinite(prevMaValue) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(prevClose <= prevMaValue && close > maValue)
        : null
    out[`trend.crossBelowMa${period}Today`] =
      Number.isFinite(prevClose) && Number.isFinite(prevMaValue) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(prevClose >= prevMaValue && close < maValue)
        : null
    out[`trend.reclaimMa${period}Today`] =
      Number.isFinite(low) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(low < maValue && close > maValue)
        : null
    out[`trend.loseMa${period}Today`] =
      Number.isFinite(high) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(high > maValue && close < maValue)
        : null
    out[`trend.daysSinceCrossAboveMa${period}`] = daysSinceMatch({
      asOfIdx,
      maxLookback: 60,
      predicate: (idx) => {
        if (idx < 1) return false
        const closeAt = num(cache?.closeValues?.[idx])
        const prevCloseAt = num(cache?.closeValues?.[idx - 1])
        const maAt = maFromCache(cache, idx, period)
        const prevMaAt = maFromCache(cache, idx - 1, period)
        return (
          Number.isFinite(closeAt) &&
          Number.isFinite(prevCloseAt) &&
          Number.isFinite(maAt) &&
          Number.isFinite(prevMaAt) &&
          prevCloseAt <= prevMaAt &&
          closeAt > maAt
        )
      },
    })
    out[`trend.daysSinceCrossBelowMa${period}`] = daysSinceMatch({
      asOfIdx,
      maxLookback: 60,
      predicate: (idx) => {
        if (idx < 1) return false
        const closeAt = num(cache?.closeValues?.[idx])
        const prevCloseAt = num(cache?.closeValues?.[idx - 1])
        const maAt = maFromCache(cache, idx, period)
        const prevMaAt = maFromCache(cache, idx - 1, period)
        return (
          Number.isFinite(closeAt) &&
          Number.isFinite(prevCloseAt) &&
          Number.isFinite(maAt) &&
          Number.isFinite(prevMaAt) &&
          prevCloseAt >= prevMaAt &&
          closeAt < maAt
        )
      },
    })
    out[`trend.failedBreakAboveMa${period}Count10`] = failedBreakCountAroundMaFromCache({
      cache,
      asOfIdx,
      maPeriod: period,
      mode: "above",
      lookback: 10,
    })
    out[`trend.failedBreakBelowMa${period}Count10`] = failedBreakCountAroundMaFromCache({
      cache,
      asOfIdx,
      maPeriod: period,
      mode: "below",
      lookback: 10,
    })
    out[`trend.retestAfterBreakMa${period}`] =
      Number.isInteger(out[`trend.daysSinceCrossAboveMa${period}`]) &&
      out[`trend.daysSinceCrossAboveMa${period}`] <= 10 &&
      Number(out[`trend.maTouchCount${period}_5d`] ?? 0) > 0
        ? 1
        : 0
    out[`trend.breakAndHoldMa${period}`] =
      Number(out[`trend.crossAboveMa${period}Today`] ?? 0) > 0 &&
      Number.isFinite(low) &&
      Number.isFinite(maValue) &&
      low >= maValue * 0.995
        ? 1
        : 0

    const nearScore = boundedTightnessScore(out[`trend.closeNearMa${period}Pct`], 0.03)
    const lowNearScore = boundedTightnessScore(out[`trend.lowNearMa${period}Pct`], 0.03)
    out[`pattern.dojiNearMa${period}`] =
      Number.isFinite(currentCandle.dojiScore) && Number.isFinite(nearScore)
        ? currentCandle.dojiScore * nearScore
        : null
    out[`pattern.longUpperWickNearMa${period}`] =
      Number.isFinite(currentCandle.longUpperWickScore) && Number.isFinite(nearScore)
        ? currentCandle.longUpperWickScore * nearScore
        : null
    out[`pattern.longLowerWickNearMa${period}`] =
      Number.isFinite(currentCandle.longLowerWickScore) && Number.isFinite(nearScore)
        ? currentCandle.longLowerWickScore * nearScore
        : null
    out[`pattern.smallBodyNearMa${period}`] =
      Number.isFinite(currentCandle.dojiScore) && Number.isFinite(nearScore)
        ? currentCandle.dojiScore * nearScore
        : null
    out[`pattern.smallBodyNearMa${period}Count3`] = countWindowBy({
      startIdx: Math.max(0, asOfIdx - 2),
      endIdx: asOfIdx,
      predicate: (idx) => {
        const metrics = resolveCandleSignalMetrics({
          open: series?.[idx]?.open,
          high: series?.[idx]?.high,
          low: series?.[idx]?.low,
          close: series?.[idx]?.close,
          prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
        })
        const maAt = maFromCache(cache, idx, period)
        const closeAt = num(cache?.closeValues?.[idx])
        return (
          Number.isFinite(metrics.dojiScore) &&
          metrics.dojiScore >= 0.5 &&
          Number.isFinite(maAt) &&
          Number.isFinite(closeAt) &&
          Math.abs(closeAt / maAt - 1) <= 0.03
        )
      },
    })
    out[`pattern.supportHoldAtMa${period}`] =
      Number.isFinite(low) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(low <= maValue * 1.002 && close >= maValue)
        : null
    out[`pattern.resistanceRejectAtMa${period}`] =
      Number.isFinite(high) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(high >= maValue * 0.998 && close <= maValue)
        : null
    out[`pattern.lowPierceButCloseAboveMa${period}`] =
      Number.isFinite(low) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(low < maValue && close > maValue)
        : null
    out[`pattern.highPierceButCloseBelowMa${period}`] =
      Number.isFinite(high) && Number.isFinite(close) && Number.isFinite(maValue)
        ? toFlag(high > maValue && close < maValue)
        : null
    out[`pattern.reboundFromMa${period}`] =
      Number(out[`pattern.lowPierceButCloseAboveMa${period}`] ?? 0) > 0 &&
      Number(currentCandle.bullishCloseStrength ?? 0) > 0
        ? 1
        : 0
    out[`pattern.fadeFromMa${period}`] =
      Number(out[`pattern.highPierceButCloseBelowMa${period}`] ?? 0) > 0 &&
      Number(currentCandle.bearishCloseWeakness ?? 0) > 0
        ? 1
        : 0

    const dryUpBase =
      Number.isFinite(avgVol20) && avgVol20 > 0 && Number.isFinite(volume)
        ? clamp01((1 - volume / avgVol20) / 0.5)
        : null
    out[`volume.dryUpNearMa${period}Score`] =
      Number.isFinite(lowNearScore) && Number.isFinite(dryUpBase) ? lowNearScore * dryUpBase : null
  }

  out["trend.maGap5_10"] = safeDelta(maValues?.[5], maValues?.[10])
  out["trend.maGap10_20"] = safeDelta(maValues?.[10], maValues?.[20])
  out["trend.maGap20_60"] = safeDelta(maValues?.[20], maValues?.[60])
  out["trend.maGap60_120"] = safeDelta(maValues?.[60], maValues?.[120])

  const cluster5120 = [maValues?.[5], maValues?.[10], maValues?.[20]].map(num).filter(Number.isFinite)
  const cluster102060 = [maValues?.[10], maValues?.[20], maValues?.[60]].map(num).filter(Number.isFinite)
  const cluster2060120 = [maValues?.[20], maValues?.[60], maValues?.[120]].map(num).filter(Number.isFinite)
  const resolveClusterTightness = (list) =>
    list.length >= 2 && Number.isFinite(close) && close !== 0 ? (Math.max(...list) - Math.min(...list)) / close : null
  out["trend.maClusterTightness_5_10_20"] = resolveClusterTightness(cluster5120)
  out["trend.maClusterTightness_10_20_60"] = resolveClusterTightness(cluster102060)
  out["trend.maClusterTightness_20_60_120"] = resolveClusterTightness(cluster2060120)
  const fanOutParts = [
    out["trend.maGap5_10"],
    out["trend.maGap10_20"],
    out["trend.maGap20_60"],
    out["trend.maGap60_120"],
  ].filter(Number.isFinite)
  out["trend.maFanOutScore"] = fanOutParts.length ? mean(fanOutParts.map((value) => clamp01(value / 0.06))) : null
  out["trend.maCompressionScore"] =
    Number.isFinite(out["trend.maClusterTightness_20_60_120"])
      ? boundedTightnessScore(out["trend.maClusterTightness_20_60_120"], 0.08)
      : null
  out["trend.maSlope120"] = safeDelta(maValues?.[120], maFromCache(cache, asOfIdx - 1, 120))

  const patternMetrics3 = recentWindowMetricsFromCache({ cache, asOfIdx, window: 3, closeValue: close })
  const patternMetrics5 = recentWindowMetricsFromCache({ cache, asOfIdx, window: 5, closeValue: close })
  const patternMetrics10 = recentWindowMetricsFromCache({ cache, asOfIdx, window: 10, closeValue: close })
  out["pattern.consecutiveDoji2"] =
    countWindowBy({
      startIdx: Math.max(0, asOfIdx - 1),
      endIdx: asOfIdx,
      predicate: (idx) =>
        Number(resolveCandleSignalMetrics({
          open: series?.[idx]?.open,
          high: series?.[idx]?.high,
          low: series?.[idx]?.low,
          close: series?.[idx]?.close,
          prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
        }).dojiScore ?? 0) >= 0.7,
    }) >= 2
      ? 1
      : 0
  out["pattern.consecutiveDoji3"] =
    countWindowBy({
      startIdx: Math.max(0, asOfIdx - 2),
      endIdx: asOfIdx,
      predicate: (idx) =>
        Number(resolveCandleSignalMetrics({
          open: series?.[idx]?.open,
          high: series?.[idx]?.high,
          low: series?.[idx]?.low,
          close: series?.[idx]?.close,
          prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
        }).dojiScore ?? 0) >= 0.7,
    }) >= 3
      ? 1
      : 0
  out["pattern.smallBodyCount3"] = countWindowBy({
    startIdx: Math.max(0, asOfIdx - 2),
    endIdx: asOfIdx,
    predicate: (idx) =>
      Number(resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).dojiScore ?? 0) >= 0.5,
  })
  out["pattern.smallBodyCount5"] = countWindowBy({
    startIdx: Math.max(0, asOfIdx - 4),
    endIdx: asOfIdx,
    predicate: (idx) =>
      Number(resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).dojiScore ?? 0) >= 0.5,
  })
  out["pattern.longUpperWickCount3"] = countWindowBy({
    startIdx: Math.max(0, asOfIdx - 2),
    endIdx: asOfIdx,
    predicate: (idx) =>
      Number(resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).longUpperWickScore ?? 0) >= 0.5,
  })
  out["pattern.longLowerWickCount3"] = countWindowBy({
    startIdx: Math.max(0, asOfIdx - 2),
    endIdx: asOfIdx,
    predicate: (idx) =>
      Number(resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).longLowerWickScore ?? 0) >= 0.5,
  })
  out["pattern.insideBarCount3"] = countWindowBy({
    startIdx: Math.max(1, asOfIdx - 2),
    endIdx: asOfIdx,
    predicate: (idx) => {
      const highAt = num(cache?.highValues?.[idx])
      const lowAt = num(cache?.lowValues?.[idx])
      const prevHigh = num(cache?.highValues?.[idx - 1])
      const prevLow = num(cache?.lowValues?.[idx - 1])
      return Number.isFinite(highAt) && Number.isFinite(lowAt) && Number.isFinite(prevHigh) && Number.isFinite(prevLow) && highAt <= prevHigh && lowAt >= prevLow
    },
  })
  out["pattern.nr4"] = (() => {
    const todayRange = currentCandle.range
    if (!Number.isFinite(todayRange)) return null
    let minRange = Number.POSITIVE_INFINITY
    for (let idx = Math.max(0, asOfIdx - 3); idx <= asOfIdx; idx += 1) {
      const rangeAt = resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).range
      if (Number.isFinite(rangeAt) && rangeAt < minRange) minRange = rangeAt
    }
    return Number.isFinite(minRange) ? toFlag(todayRange <= minRange) : null
  })()
  out["pattern.nr7"] = (() => {
    const todayRange = currentCandle.range
    if (!Number.isFinite(todayRange)) return null
    let minRange = Number.POSITIVE_INFINITY
    for (let idx = Math.max(0, asOfIdx - 6); idx <= asOfIdx; idx += 1) {
      const rangeAt = resolveCandleSignalMetrics({
        open: series?.[idx]?.open,
        high: series?.[idx]?.high,
        low: series?.[idx]?.low,
        close: series?.[idx]?.close,
        prevClose: idx > 0 ? series?.[idx - 1]?.close : null,
      }).range
      if (Number.isFinite(rangeAt) && rangeAt < minRange) minRange = rangeAt
    }
    return Number.isFinite(minRange) ? toFlag(todayRange <= minRange) : null
  })()
  out["pattern.rangeCompression3"] = patternMetrics3.boxWidth
  out["pattern.rangeCompression5"] = patternMetrics5.boxWidth
  out["pattern.closeClusterTightness3"] = patternMetrics3.closeClusterTightness
  out["pattern.closeClusterTightness5"] = patternMetrics5.closeClusterTightness
  out["pattern.directionlessScore3"] =
    Number.isFinite(patternMetrics3.sidewaysScore) && Number.isFinite(out["pattern.smallBodyCount3"])
      ? clamp01((patternMetrics3.sidewaysScore + clamp01(out["pattern.smallBodyCount3"] / 3)) / 2)
      : null

  out["volume.decay3"] = volumeDecayFromCache({ cache, asOfIdx, window: 3 })
  out["volume.decay5"] = volumeDecayFromCache({ cache, asOfIdx, window: 5 })
  out["volume.monotonicDecline3"] = monotonicDeclineFromCache({ cache, asOfIdx, window: 3 })
  out["volume.monotonicDecline5"] = monotonicDeclineFromCache({ cache, asOfIdx, window: 5 })
  out["volume.lowVolumeCount3"] = lowVolumeCountFromCache({ cache, asOfIdx, window: 3, avgVolume20: avgVol20 })
  out["volume.lowVolumeCount5"] = lowVolumeCountFromCache({ cache, asOfIdx, window: 5, avgVolume20: avgVol20 })
  const recentPeakVolume = (() => {
    let maxVolume = Number.NEGATIVE_INFINITY
    for (let idx = Math.max(0, asOfIdx - 19); idx < asOfIdx; idx += 1) {
      const volAt = num(cache?.volumeValues?.[idx])
      if (Number.isFinite(volAt) && volAt > maxVolume) maxVolume = volAt
    }
    return Number.isFinite(maxVolume) ? maxVolume : null
  })()
  out["volume.volumeVsRecentPeak"] = safeDiv(volume, recentPeakVolume)
  const tradingValues3 = []
  const tradingValues5 = []
  for (let idx = Math.max(0, asOfIdx - 4); idx <= asOfIdx; idx += 1) {
    const closeAt = num(cache?.closeValues?.[idx])
    const volAt = num(cache?.volumeValues?.[idx])
    if (!Number.isFinite(closeAt) || !Number.isFinite(volAt)) continue
    const value = closeAt * volAt
    if (idx >= asOfIdx - 2) tradingValues3.push(value)
    tradingValues5.push(value)
  }
  out["volume.turnoverCompression3"] =
    tradingValues3.length >= 2 && mean(tradingValues3) > 0 ? (stdev(tradingValues3) ?? 0) / mean(tradingValues3) : null
  out["volume.turnoverCompression5"] =
    tradingValues5.length >= 2 && mean(tradingValues5) > 0 ? (stdev(tradingValues5) ?? 0) / mean(tradingValues5) : null

  out["shape.sidewaysScore3"] = patternMetrics3.sidewaysScore
  out["shape.sidewaysScore5"] = patternMetrics5.sidewaysScore
  out["shape.sidewaysScore10"] = patternMetrics10.sidewaysScore
  out["shape.boxWidth3"] = patternMetrics3.boxWidth
  out["shape.boxWidth5"] = patternMetrics5.boxWidth
  out["shape.boxWidth10"] = patternMetrics10.boxWidth
  out["shape.highLowOverlap3"] = patternMetrics3.overlap
  out["shape.highLowOverlap5"] = patternMetrics5.overlap
  out["shape.coilScore"] =
    Number.isFinite(patternMetrics3.sidewaysScore) && Number.isFinite(out["volume.decay3"])
      ? clamp01((patternMetrics3.sidewaysScore + dryUpScore(out["volume.decay3"], 0.4)) / 2)
      : null
  out["shape.flagLikeScore"] =
    Number.isFinite(patternMetrics5.sidewaysScore) && Number.isFinite(out["volume.decay5"])
      ? clamp01((patternMetrics5.sidewaysScore + dryUpScore(out["volume.decay5"], 0.5)) / 2)
      : null
  out["shape.breakoutPauseScore"] =
    Number.isFinite(patternMetrics3.sidewaysScore) && Number.isFinite(currentCandle.rangePct)
      ? clamp01((patternMetrics3.sidewaysScore + boundedTightnessScore(currentCandle.rangePct, 0.08)) / 2)
      : null

  const high20 = resolveWindowExtrema(cache, 20).highMaxByEnd?.[asOfIdx] ?? null
  const high60 = resolveWindowExtrema(cache, 60).highMaxByEnd?.[asOfIdx] ?? null
  const high120 = resolveWindowExtrema(cache, 120).highMaxByEnd?.[asOfIdx] ?? null
  const low20 = resolveWindowExtrema(cache, 20).lowMinByEnd?.[asOfIdx] ?? null
  out["level.distanceToHigh20"] = safeDelta(close, high20)
  out["level.distanceToHigh60"] = safeDelta(close, high60)
  out["level.distanceToHigh120"] = safeDelta(close, high120)
  out["level.distanceToLow20"] = safeDelta(close, low20)
  out["level.closeNearHigh20"] = boundedTightnessScore(out["level.distanceToHigh20"], 0.05)
  out["level.closeNearHigh60"] = boundedTightnessScore(out["level.distanceToHigh60"], 0.05)
  out["level.closeNearLow20"] = boundedTightnessScore(out["level.distanceToLow20"], 0.05)
  out["level.touchRecentHighCount10"] = countWindowBy({
    startIdx: Math.max(1, asOfIdx - 9),
    endIdx: asOfIdx,
    predicate: (idx) => {
      const highAt = num(cache?.highValues?.[idx])
      const prevHigh = idx > 0 ? resolveWindowExtrema(cache, 10).highMaxByEnd?.[idx - 1] ?? null : null
      return Number.isFinite(highAt) && Number.isFinite(prevHigh) && highAt >= prevHigh * 0.995
    },
  })
  out["level.rejectionFromRecentHighCount10"] = countWindowBy({
    startIdx: Math.max(1, asOfIdx - 9),
    endIdx: asOfIdx,
    predicate: (idx) => {
      const highAt = num(cache?.highValues?.[idx])
      const closeAt = num(cache?.closeValues?.[idx])
      const prevHigh = idx > 0 ? resolveWindowExtrema(cache, 10).highMaxByEnd?.[idx - 1] ?? null : null
      return Number.isFinite(highAt) && Number.isFinite(closeAt) && Number.isFinite(prevHigh) && highAt > prevHigh && closeAt <= prevHigh
    },
  })
  out["level.distanceToPivotHigh"] = safeDelta(close, resolvePivotValueFromCache({ cache, asOfIdx, mode: "high", lookback: 20 }))
  out["level.distanceToPivotLow"] = safeDelta(close, resolvePivotValueFromCache({ cache, asOfIdx, mode: "low", lookback: 20 }))

  if (selectionMode === "plus_lite") {
    return pickFeatureKeys(out, PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_FEATURE_KEYS)
  }

  const isTp12SelectionMode = selectionMode === "tp12"

  const anchor = resolveImpulseAnchorFromSeries({ series, asOfIdx })
  if (anchor) {
    const anchorClose = num(series?.[anchor.idx]?.close)
    const anchorHigh = num(series?.[anchor.idx]?.high)
    const anchorLow = num(series?.[anchor.idx]?.low)
    out["anchor.impulseBarRetPct"] = anchor.metrics.closeRetPct
    out["anchor.impulseBarRangePct"] = anchor.metrics.rangePct
    out["anchor.impulseBarUpperWickPct"] = anchor.metrics.upperWickPct
    out["anchor.impulseBarBodyPct"] = anchor.metrics.bodyPct
    out["anchor.impulseBarVolumeRatio20"] = anchor.volumeRatio20
    out["anchor.impulseBarCloseStrength"] = anchor.metrics.bullishCloseStrength
    out["anchor.daysSinceImpulseBar"] = asOfIdx - anchor.idx
    let maxRunup = null
    let maxPullback = null
    for (let idx = anchor.idx; idx <= asOfIdx; idx += 1) {
      const highAt = num(cache?.highValues?.[idx])
      const lowAt = num(cache?.lowValues?.[idx])
      if (Number.isFinite(highAt) && Number.isFinite(anchorClose) && anchorClose !== 0) {
        const runup = highAt / anchorClose - 1
        maxRunup = Number.isFinite(maxRunup) ? Math.max(maxRunup, runup) : runup
      }
      if (Number.isFinite(lowAt) && Number.isFinite(anchorClose) && anchorClose !== 0) {
        const pullback = lowAt / anchorClose - 1
        maxPullback = Number.isFinite(maxPullback) ? Math.min(maxPullback, pullback) : pullback
      }
    }
    out["anchor.maxRunupSinceImpulse"] = maxRunup
    out["anchor.maxPullbackSinceImpulse"] = maxPullback
    out["anchor.pullbackDepthSinceImpulse"] = Number.isFinite(maxPullback) ? Math.abs(Math.min(0, maxPullback)) : null
    out["anchor.consolidationDaysSinceImpulse"] = asOfIdx - anchor.idx
    const prevAnchorClose = anchor.idx > 0 ? num(cache?.closeValues?.[anchor.idx - 1]) : null
    const ma60AtAnchor = maFromCache(cache, anchor.idx, 60)
    const prevMa60AtAnchor = maFromCache(cache, anchor.idx - 1, 60)
    const ma120AtAnchor = maFromCache(cache, anchor.idx, 120)
    const prevMa120AtAnchor = maFromCache(cache, anchor.idx - 1, 120)
    out["anchor.didBreakMa60DuringImpulse"] =
      Number.isFinite(anchorClose) &&
      Number.isFinite(prevAnchorClose) &&
      Number.isFinite(ma60AtAnchor) &&
      Number.isFinite(prevMa60AtAnchor)
        ? toFlag(prevAnchorClose <= prevMa60AtAnchor && anchorClose > ma60AtAnchor)
        : null
    out["anchor.didBreakMa120DuringImpulse"] =
      Number.isFinite(anchorClose) &&
      Number.isFinite(prevAnchorClose) &&
      Number.isFinite(ma120AtAnchor) &&
      Number.isFinite(prevMa120AtAnchor)
        ? toFlag(prevAnchorClose <= prevMa120AtAnchor && anchorClose > ma120AtAnchor)
        : null
    const prev20HighAtAnchor = anchor.idx > 0 ? resolveWindowExtrema(cache, 20).highMaxByEnd?.[anchor.idx - 1] ?? null : null
    const prev60HighAtAnchor = anchor.idx > 0 ? resolveWindowExtrema(cache, 60).highMaxByEnd?.[anchor.idx - 1] ?? null : null
    out["anchor.impulseThroughRecentHigh20"] =
      Number.isFinite(anchorHigh) && Number.isFinite(prev20HighAtAnchor) ? toFlag(anchorHigh > prev20HighAtAnchor) : null
    out["anchor.impulseThroughRecentHigh60"] =
      Number.isFinite(anchorHigh) && Number.isFinite(prev60HighAtAnchor) ? toFlag(anchorHigh > prev60HighAtAnchor) : null

    out["chain.impulseThenSideways3"] =
      out["anchor.daysSinceImpulseBar"] <= 3 && Number.isFinite(out["shape.sidewaysScore3"])
        ? out["shape.sidewaysScore3"]
        : 0
    out["chain.impulseThenSideways5"] =
      out["anchor.daysSinceImpulseBar"] <= 5 && Number.isFinite(out["shape.sidewaysScore5"])
        ? out["shape.sidewaysScore5"]
        : 0
    out["chain.impulseThenDoji2"] =
      out["anchor.daysSinceImpulseBar"] <= 2 ? out["pattern.consecutiveDoji2"] : 0
    out["chain.impulseThenDojiNearMa60"] =
      out["anchor.daysSinceImpulseBar"] <= 5 && Number.isFinite(out["pattern.dojiNearMa60"])
        ? out["pattern.dojiNearMa60"]
        : 0
    out["chain.impulseThenDojiNearMa120"] =
      out["anchor.daysSinceImpulseBar"] <= 5 && Number.isFinite(out["pattern.dojiNearMa120"])
        ? out["pattern.dojiNearMa120"]
        : 0
    out["chain.impulseThenNearMa60_3d"] =
      out["anchor.daysSinceImpulseBar"] <= 3 ? clamp01((Number(out["trend.maTouchCount60_3d"] ?? 0)) / 3) : 0
    out["chain.impulseThenNearMa120_3d"] =
      out["anchor.daysSinceImpulseBar"] <= 3 ? clamp01((Number(out["trend.maTouchCount120_3d"] ?? 0)) / 3) : 0
    out["chain.impulseThenTouchMa60"] =
      out["anchor.daysSinceImpulseBar"] <= 5 ? Number(out["trend.maTouch60"] ?? 0) : 0
    out["chain.impulseThenTouchMa120"] =
      out["anchor.daysSinceImpulseBar"] <= 5 ? Number(out["trend.maTouch120"] ?? 0) : 0
    out["chain.impulseThenSupportHoldAtMa60"] =
      out["anchor.daysSinceImpulseBar"] <= 5 ? Number(out["pattern.supportHoldAtMa60"] ?? 0) : 0
    out["chain.impulseThenSupportHoldAtMa120"] =
      out["anchor.daysSinceImpulseBar"] <= 5 ? Number(out["pattern.supportHoldAtMa120"] ?? 0) : 0
    out["chain.impulseThenCompression3"] =
      out["anchor.daysSinceImpulseBar"] <= 3 && Number.isFinite(out["shape.boxWidth3"])
        ? boundedTightnessScore(out["shape.boxWidth3"], 0.1)
        : 0
    out["chain.impulseThenDryUp3"] =
      out["anchor.daysSinceImpulseBar"] <= 3 && Number.isFinite(out["volume.decay3"])
        ? dryUpScore(out["volume.decay3"], 0.4)
        : 0
    out["chain.impulseThenDryUp5"] =
      out["anchor.daysSinceImpulseBar"] <= 5 && Number.isFinite(out["volume.decay5"])
        ? dryUpScore(out["volume.decay5"], 0.5)
        : 0
  }

  out["score.prejumpCoilNearMa60AfterImpulse"] =
    Number.isFinite(out["shape.coilScore"]) &&
    Number.isFinite(out["volume.dryUpNearMa60Score"]) &&
    Number.isFinite(out["chain.impulseThenNearMa60_3d"])
      ? clamp01((out["shape.coilScore"] + out["volume.dryUpNearMa60Score"] + out["chain.impulseThenNearMa60_3d"]) / 3)
      : null
  out["score.prejumpCoilNearMa120AfterImpulse"] =
    Number.isFinite(out["shape.coilScore"]) &&
    Number.isFinite(out["volume.dryUpNearMa120Score"]) &&
    Number.isFinite(out["chain.impulseThenNearMa120_3d"])
      ? clamp01((out["shape.coilScore"] + out["volume.dryUpNearMa120Score"] + out["chain.impulseThenNearMa120_3d"]) / 3)
      : null
  out["score.supportAtMa60AfterBreakout"] =
    Number.isFinite(out["pattern.supportHoldAtMa60"]) &&
    Number.isFinite(out["chain.impulseThenSupportHoldAtMa60"])
      ? clamp01((out["pattern.supportHoldAtMa60"] + out["chain.impulseThenSupportHoldAtMa60"]) / 2)
      : null
  out["score.supportAtMa120AfterBreakout"] =
    Number.isFinite(out["pattern.supportHoldAtMa120"]) &&
    Number.isFinite(out["chain.impulseThenSupportHoldAtMa120"])
      ? clamp01((out["pattern.supportHoldAtMa120"] + out["chain.impulseThenSupportHoldAtMa120"]) / 2)
      : null
  out["score.dryUpConsolidationQuality"] =
    Number.isFinite(out["shape.sidewaysScore3"]) && Number.isFinite(out["volume.decay3"])
      ? clamp01((out["shape.sidewaysScore3"] + dryUpScore(out["volume.decay3"], 0.4)) / 2)
      : null
  out["score.flagQuality"] =
    Number.isFinite(out["shape.flagLikeScore"]) && Number.isFinite(out["volume.decay5"])
      ? clamp01((out["shape.flagLikeScore"] + dryUpScore(out["volume.decay5"], 0.5)) / 2)
      : null
  out["score.rebreakPotential"] =
    Number.isFinite(out["level.closeNearHigh20"]) && Number.isFinite(out["shape.breakoutPauseScore"])
      ? clamp01((out["level.closeNearHigh20"] + out["shape.breakoutPauseScore"]) / 2)
      : null
  out["score.upperWickTrapRisk"] =
    Number.isFinite(currentCandle.longUpperWickScore) && Number.isFinite(currentCandle.bearishCloseWeakness)
      ? clamp01((currentCandle.longUpperWickScore + currentCandle.bearishCloseWeakness) / 2)
      : null
  out["score.failedBreakRisk"] =
    Number.isFinite(out["trend.failedBreakAboveMa60Count10"]) && Number.isFinite(out["trend.failedBreakAboveMa120Count10"])
      ? clamp01((clamp01(out["trend.failedBreakAboveMa60Count10"] / 3) + clamp01(out["trend.failedBreakAboveMa120Count10"] / 3)) / 2)
      : null
  out["score.impulseContinuationReadiness"] =
    Number.isFinite(out["score.flagQuality"]) && Number.isFinite(out["score.rebreakPotential"])
      ? clamp01((out["score.flagQuality"] + out["score.rebreakPotential"]) / 2)
      : null
  if (isTp12SelectionMode) {
    return pickFeatureKeys(out, PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_FEATURE_KEYS)
  }
  return out
}

export const getPrevIndex = (indexMap, dateKey) => {
  const idx = indexMap?.get(dateKey)
  if (!Number.isInteger(idx)) return null
  return idx > 0 ? idx - 1 : null
}

export const extractSnapshotFeatures = ({
  series,
  asOfIdx,
  symbol,
  universeRow
}) => {
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 0) {
    return null
  }
  const c = series[asOfIdx]
  const o = num(c?.open)
  const h = num(c?.high)
  const l = num(c?.low)
  const cl = num(c?.close)
  const v = num(c?.volume)

  const ma5 = ma(series, asOfIdx, 5)
  const ma10 = ma(series, asOfIdx, 10)
  const ma20 = ma(series, asOfIdx, 20)
  const ma60 = ma(series, asOfIdx, 60)
  const ma120 = ma(series, asOfIdx, 120)
  const prevMa5 = ma(series, asOfIdx - 1, 5)
  const prevMa10 = ma(series, asOfIdx - 1, 10)
  const prevMa20 = ma(series, asOfIdx - 1, 20)
  const prevMa60 = ma(series, asOfIdx - 1, 60)

  const r40 = returns(series, asOfIdx, 40)
  const range = Number.isFinite(h) && Number.isFinite(l) ? h - l : null
  const body = Number.isFinite(cl) && Number.isFinite(o) ? cl - o : null
  const prevClose = asOfIdx > 0 ? num(series[asOfIdx - 1]?.close) : null
  const upperWick =
    Number.isFinite(h) && Number.isFinite(cl) && Number.isFinite(o) ? h - Math.max(cl, o) : null
  const lowerWick =
    Number.isFinite(l) && Number.isFinite(cl) && Number.isFinite(o) ? Math.min(cl, o) - l : null

  const valueNow = Number.isFinite(cl) && Number.isFinite(v) ? cl * v : null
  const avgValue20 = num(universeRow?.avgTradingValue20d)
  const marketCapKrw = num(universeRow?.marketCapKrw)
  const vol20 = []
  for (let i = Math.max(0, asOfIdx - 19); i <= asOfIdx; i += 1) {
    const vv = num(series[i]?.volume)
    if (Number.isFinite(vv)) vol20.push(vv)
  }
  const avgVol20 = mean(vol20)
  const vol5 = []
  for (let i = Math.max(0, asOfIdx - 4); i <= asOfIdx; i += 1) {
    const vv = num(series[i]?.volume)
    if (Number.isFinite(vv)) vol5.push(vv)
  }
  const avgVol5 = mean(vol5)
  const vol40 = []
  for (let i = Math.max(0, asOfIdx - 39); i <= asOfIdx; i += 1) {
    const vv = num(series[i]?.volume)
    if (Number.isFinite(vv)) vol40.push(vv)
  }
  const avgVol40 = mean(vol40)
  const prev20 = sliceHighLow(series, Math.max(0, asOfIdx - 20), Math.max(0, asOfIdx - 1))
  const recent20 = sliceHighLow(series, Math.max(0, asOfIdx - 19), asOfIdx)
  const breakoutDistance20 =
    safeDiv(cl, prev20?.highMax) !== null ? safeDiv(cl, prev20.highMax) - 1 : null
  const compression20 =
    Number.isFinite(recent20?.highMax) &&
    Number.isFinite(recent20?.lowMin) &&
    Number.isFinite(cl) &&
    cl !== 0
      ? (recent20.highMax - recent20.lowMin) / cl
      : null
  const gapOpenPct = safeDiv(o, prevClose) !== null ? safeDiv(o, prevClose) - 1 : null
  const gapCloseVsPrevClose = safeDiv(cl, prevClose) !== null ? safeDiv(cl, prevClose) - 1 : null
  const gapFillRatio = resolveGapFillRatio({
    prevClose,
    open: o,
    close: cl
  })
  const {
    gapFillThenContinueScore,
    gapFillThenRevertScore
  } = resolveGapDirectionalScores({
    prevClose,
    open: o,
    close: cl
  })
  const valueRatio20 = safeDiv(valueNow, avgValue20)
  const rangePct =
    Number.isFinite(range) && Number.isFinite(cl) && cl !== 0 ? range / cl : null
  const failedBreakoutCount20 = resolveFailedBreakoutCount({
    series,
    asOfIdx,
    lookback: 20,
    breakoutWindow: 20
  })
  const executionFeasibilityScore = resolveExecutionFeasibilityScore({
    avgTradingValue20d: avgValue20,
    liquidityStress: resolveLiquidityStress(avgValue20),
    exhaustionProxy:
      Number.isFinite(valueRatio20) && Number.isFinite(rangePct) ? valueRatio20 * rangePct : null,
    rangePct
  })
  const featureVec = {
    "trend.closeOverMa10": safeDiv(cl, ma10) !== null ? safeDiv(cl, ma10) - 1 : null,
    "trend.closeOverMa20": safeDiv(cl, ma20) !== null ? safeDiv(cl, ma20) - 1 : null,
    "trend.closeOverMa120": safeDiv(cl, ma120) !== null ? safeDiv(cl, ma120) - 1 : null,
    "trend.ma5OverMa10": safeDiv(ma5, ma10) !== null ? safeDiv(ma5, ma10) - 1 : null,
    "trend.ma10OverMa20": safeDiv(ma10, ma20) !== null ? safeDiv(ma10, ma20) - 1 : null,
    "trend.ma20OverMa60": safeDiv(ma20, ma60) !== null ? safeDiv(ma20, ma60) - 1 : null,
    "trend.ma60OverMa120": safeDiv(ma60, ma120) !== null ? safeDiv(ma60, ma120) - 1 : null,
    "trend.slope5": safeDiv(ma5, prevMa5) !== null ? safeDiv(ma5, prevMa5) - 1 : null,
    "trend.slope10": safeDiv(ma10, prevMa10) !== null ? safeDiv(ma10, prevMa10) - 1 : null,
    "trend.slope20": safeDiv(ma20, prevMa20) !== null ? safeDiv(ma20, prevMa20) - 1 : null,
    "trend.slope60": safeDiv(ma60, prevMa60) !== null ? safeDiv(ma60, prevMa60) - 1 : null,
    "trend.runUp5": retOver(series, asOfIdx, 5),
    "trend.runUp10": retOver(series, asOfIdx, 10),

    "candle.bodyPct": Number.isFinite(body) && Number.isFinite(range) && range !== 0 ? body / range : null,
    "candle.bodyAbsPct": Number.isFinite(body) && Number.isFinite(cl) && cl !== 0 ? Math.abs(body) / cl : null,
    "candle.upperWickPct": Number.isFinite(upperWick) && Number.isFinite(range) && range !== 0 ? upperWick / range : null,
    "candle.lowerWickPct": Number.isFinite(lowerWick) && Number.isFinite(range) && range !== 0 ? lowerWick / range : null,
    "candle.wickImbalance":
      Number.isFinite(upperWick) && Number.isFinite(lowerWick) && Number.isFinite(range) && range !== 0
        ? (upperWick - lowerWick) / range
        : null,
    "candle.closePos": Number.isFinite(cl) && Number.isFinite(l) && Number.isFinite(range) && range !== 0 ? (cl - l) / range : null,
    "candle.rangePct": rangePct,

    "gap.openPct": gapOpenPct,
    "gap.closeVsPrevClose": gapCloseVsPrevClose,
    "gap.fillRatio": gapFillRatio,
    "gap.fillThenContinueScore": gapFillThenContinueScore,
    "gap.fillThenRevertScore": gapFillThenRevertScore,

    "volume.ratio20": safeDiv(v, avgVol20),
    "volume.ratio40": safeDiv(v, avgVol40),
    "volume.ratio5Over20": safeDiv(avgVol5, avgVol20),
    "volume.dryUp20Over40": safeDiv(avgVol20, avgVol40),
    "volume.valueRatio20": valueRatio20,
    "volume.valueBurst20": valueRatio20,
    "volume.exhaustionProxy":
      Number.isFinite(valueRatio20) && Number.isFinite(rangePct) ? valueRatio20 * rangePct : null,
    "volume.spreadProxyPct":
      rangePct,
    "volume.avgTradingValue20dKrw": avgValue20,
    "volume.marketCapLog": Number.isFinite(marketCapKrw) && marketCapKrw > 0 ? Math.log(marketCapKrw) : null,
    "volume.tradingValueToMarketCap": safeDiv(avgValue20, marketCapKrw),
    "volume.liquidityStress": resolveLiquidityStress(avgValue20),

    "shape.retStdev40": stdev(r40),
    "shape.compression20": compression20,
    "shape.breakoutDistance20": breakoutDistance20,
    "shape.failedBreakoutCount20": failedBreakoutCount20,

    "execution.feasibilityScore": executionFeasibilityScore
  }

  return featureVec
}

export const extractGlobalContextFeatures = ({
  series,
  asOfIdx,
  globalWindow = 150
}) => {
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 0) {
    return null
  }
  const gWindow = Math.max(2, Number(globalWindow) || 150)
  const c = series[asOfIdx]
  const cl = num(c?.close)
  const ma120 = ma(series, asOfIdx, 120)
  const ma150 = ma(series, asOfIdx, 150)
  const ret40 = returns(series, asOfIdx, 40)
  const ret150 = returns(series, asOfIdx, gWindow)

  const startIdx = Math.max(0, asOfIdx - gWindow + 1)
  const endIdx = asOfIdx
  const { highMax, lowMin } = sliceHighLow(series, startIdx, endIdx)
  const range = Number.isFinite(highMax) && Number.isFinite(lowMin) ? highMax - lowMin : null

  const vol20 = meanVolume(series, Math.max(0, asOfIdx - 19), asOfIdx)
  const vol150 = meanVolume(series, startIdx, asOfIdx)
  const value20 = meanTradingValue(series, Math.max(0, asOfIdx - 19), asOfIdx)
  const value150 = meanTradingValue(series, startIdx, asOfIdx)
  const recent20 = sliceHighLow(series, Math.max(0, asOfIdx - 19), asOfIdx)
  const recent20Range =
    Number.isFinite(recent20?.highMax) && Number.isFinite(recent20?.lowMin)
      ? recent20.highMax - recent20.lowMin
      : null

  return {
    "global.ret20": retOver(series, asOfIdx, 20),
    "global.ret40": retOver(series, asOfIdx, 40),
    "global.ret60": retOver(series, asOfIdx, 60),
    "global.ret120": retOver(series, asOfIdx, 120),
    "global.ret150": retOver(series, asOfIdx, 150),
    "global.closeOverMa120": safeDiv(cl, ma120) !== null ? safeDiv(cl, ma120) - 1 : null,
    "global.closeOverMa150": safeDiv(cl, ma150) !== null ? safeDiv(cl, ma150) - 1 : null,
    "global.drawdownFromHigh150": safeDiv(cl, highMax) !== null ? safeDiv(cl, highMax) - 1 : null,
    "global.rangePos150":
      Number.isFinite(cl) && Number.isFinite(lowMin) && Number.isFinite(range) && range !== 0
        ? (cl - lowMin) / range
        : null,
    "global.rangePct150": Number.isFinite(range) && Number.isFinite(cl) && cl !== 0 ? range / cl : null,
    "global.volatility40": stdev(ret40),
    "global.volatility150": stdev(ret150),
    "global.volatilityExpansion40Over150": safeDiv(stdev(ret40), stdev(ret150)),
    "global.rangeCompression20Over150":
      Number.isFinite(recent20Range) && Number.isFinite(range) && range !== 0
        ? recent20Range / range
        : null,
    "global.volumeRatio20Over150": safeDiv(vol20, vol150),
    "global.valueRatio20Over150": safeDiv(value20, value150)
  }
}

export const extractSnapshotFeaturesFromCache = ({
  cache,
  series,
  asOfIdx,
  symbol,
  universeRow,
  surfaceName,
}) => {
  if (!cache) {
    throw new Error("extractSnapshotFeaturesFromCache requires a series feature runtime cache")
  }
  const normalizedSurfaceName = String(surfaceName ?? "").trim().toLowerCase()
  if (!normalizedSurfaceName) {
    throw new Error("extractSnapshotFeaturesFromCache requires an explicit surfaceName")
  }
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 0) {
    return null
  }
  const c = series[asOfIdx]
  const o = num(c?.open)
  const h = num(c?.high)
  const l = num(c?.low)
  const cl = num(c?.close)
  const v = num(c?.volume)

  const ma5 = maFromCache(cache, asOfIdx, 5)
  const ma10 = maFromCache(cache, asOfIdx, 10)
  const ma20 = maFromCache(cache, asOfIdx, 20)
  const ma60 = maFromCache(cache, asOfIdx, 60)
  const ma120 = maFromCache(cache, asOfIdx, 120)
  const prevMa5 = maFromCache(cache, asOfIdx - 1, 5)
  const prevMa10 = maFromCache(cache, asOfIdx - 1, 10)
  const prevMa20 = maFromCache(cache, asOfIdx - 1, 20)
  const prevMa60 = maFromCache(cache, asOfIdx - 1, 60)

  const ret40Start = Math.max(1, asOfIdx - 40 + 1)
  const r40 = Array.from(cache.returnsCache.values.slice(ret40Start, asOfIdx + 1))
  const range = Number.isFinite(h) && Number.isFinite(l) ? h - l : null
  const body = Number.isFinite(cl) && Number.isFinite(o) ? cl - o : null
  const prevClose = asOfIdx > 0 ? cache.closeValues?.[asOfIdx - 1] ?? null : null
  const upperWick =
    Number.isFinite(h) && Number.isFinite(cl) && Number.isFinite(o) ? h - Math.max(cl, o) : null
  const lowerWick =
    Number.isFinite(l) && Number.isFinite(cl) && Number.isFinite(o) ? Math.min(cl, o) - l : null

  const valueNow = Number.isFinite(cl) && Number.isFinite(v) ? cl * v : null
  const avgValue20 = num(universeRow?.avgTradingValue20d)
  const marketCapKrw = num(universeRow?.marketCapKrw)
  const avgVol20 = meanVolumeFromCache(cache, Math.max(0, asOfIdx - 19), asOfIdx)
  const avgVol5 = meanVolumeFromCache(cache, Math.max(0, asOfIdx - 4), asOfIdx)
  const avgVol40 = meanVolumeFromCache(cache, Math.max(0, asOfIdx - 39), asOfIdx)
  const prev20Extrema = resolveWindowExtrema(cache, 20)
  const recent20High = prev20Extrema.highMaxByEnd?.[asOfIdx] ?? null
  const recent20Low = prev20Extrema.lowMinByEnd?.[asOfIdx] ?? null
  const prev20High = asOfIdx > 0 ? prev20Extrema.highMaxByEnd?.[asOfIdx - 1] ?? null : null
  const recent20Range =
    Number.isFinite(recent20High) && Number.isFinite(recent20Low)
      ? recent20High - recent20Low
      : null
  const breakoutDistance20 =
    safeDiv(cl, prev20High) !== null ? safeDiv(cl, prev20High) - 1 : null
  const compression20 =
    Number.isFinite(recent20Range) && Number.isFinite(cl) && cl !== 0 ? recent20Range / cl : null
  const gapOpenPct = safeDiv(o, prevClose) !== null ? safeDiv(o, prevClose) - 1 : null
  const gapCloseVsPrevClose = safeDiv(cl, prevClose) !== null ? safeDiv(cl, prevClose) - 1 : null
  const gapFillRatio = resolveGapFillRatio({
    prevClose,
    open: o,
    close: cl
  })
  const {
    gapFillThenContinueScore,
    gapFillThenRevertScore
  } = resolveGapDirectionalScores({
    prevClose,
    open: o,
    close: cl
  })
  const valueRatio20 = safeDiv(valueNow, avgValue20)
  const rangePct =
    Number.isFinite(range) && Number.isFinite(cl) && cl !== 0 ? range / cl : null
  const failedBreakoutCount20 = resolveFailedBreakoutCountFromCache({
    cache,
    asOfIdx,
    lookback: 20,
    breakoutWindow: 20
  })
  const executionFeasibilityScore = resolveExecutionFeasibilityScore({
    avgTradingValue20d: avgValue20,
    liquidityStress: resolveLiquidityStress(avgValue20),
    exhaustionProxy:
      Number.isFinite(valueRatio20) && Number.isFinite(rangePct) ? valueRatio20 * rangePct : null,
    rangePct
  })

  const baseFeatureVec = {
    "trend.closeOverMa10": safeDiv(cl, ma10) !== null ? safeDiv(cl, ma10) - 1 : null,
    "trend.closeOverMa20": safeDiv(cl, ma20) !== null ? safeDiv(cl, ma20) - 1 : null,
    "trend.closeOverMa120": safeDiv(cl, ma120) !== null ? safeDiv(cl, ma120) - 1 : null,
    "trend.ma5OverMa10": safeDiv(ma5, ma10) !== null ? safeDiv(ma5, ma10) - 1 : null,
    "trend.ma10OverMa20": safeDiv(ma10, ma20) !== null ? safeDiv(ma10, ma20) - 1 : null,
    "trend.ma20OverMa60": safeDiv(ma20, ma60) !== null ? safeDiv(ma20, ma60) - 1 : null,
    "trend.ma60OverMa120": safeDiv(ma60, ma120) !== null ? safeDiv(ma60, ma120) - 1 : null,
    "trend.slope5": safeDiv(ma5, prevMa5) !== null ? safeDiv(ma5, prevMa5) - 1 : null,
    "trend.slope10": safeDiv(ma10, prevMa10) !== null ? safeDiv(ma10, prevMa10) - 1 : null,
    "trend.slope20": safeDiv(ma20, prevMa20) !== null ? safeDiv(ma20, prevMa20) - 1 : null,
    "trend.slope60": safeDiv(ma60, prevMa60) !== null ? safeDiv(ma60, prevMa60) - 1 : null,
    "trend.runUp5": retOverFromCache(cache, asOfIdx, 5),
    "trend.runUp10": retOverFromCache(cache, asOfIdx, 10),

    "candle.bodyPct": Number.isFinite(body) && Number.isFinite(range) && range !== 0 ? body / range : null,
    "candle.bodyAbsPct": Number.isFinite(body) && Number.isFinite(cl) && cl !== 0 ? Math.abs(body) / cl : null,
    "candle.upperWickPct": Number.isFinite(upperWick) && Number.isFinite(range) && range !== 0 ? upperWick / range : null,
    "candle.lowerWickPct": Number.isFinite(lowerWick) && Number.isFinite(range) && range !== 0 ? lowerWick / range : null,
    "candle.wickImbalance":
      Number.isFinite(upperWick) && Number.isFinite(lowerWick) && Number.isFinite(range) && range !== 0
        ? (upperWick - lowerWick) / range
        : null,
    "candle.closePos": Number.isFinite(cl) && Number.isFinite(l) && Number.isFinite(range) && range !== 0 ? (cl - l) / range : null,
    "candle.rangePct": rangePct,

    "gap.openPct": gapOpenPct,
    "gap.closeVsPrevClose": gapCloseVsPrevClose,
    "gap.fillRatio": gapFillRatio,
    "gap.fillThenContinueScore": gapFillThenContinueScore,
    "gap.fillThenRevertScore": gapFillThenRevertScore,

    "volume.ratio20": safeDiv(v, avgVol20),
    "volume.ratio40": safeDiv(v, avgVol40),
    "volume.ratio5Over20": safeDiv(avgVol5, avgVol20),
    "volume.dryUp20Over40": safeDiv(avgVol20, avgVol40),
    "volume.valueRatio20": valueRatio20,
    "volume.valueBurst20": valueRatio20,
    "volume.exhaustionProxy":
      Number.isFinite(valueRatio20) && Number.isFinite(rangePct) ? valueRatio20 * rangePct : null,
    "volume.spreadProxyPct":
      rangePct,
    "volume.avgTradingValue20dKrw": avgValue20,
    "volume.marketCapLog": Number.isFinite(marketCapKrw) && marketCapKrw > 0 ? Math.log(marketCapKrw) : null,
    "volume.tradingValueToMarketCap": safeDiv(avgValue20, marketCapKrw),
    "volume.liquidityStress": resolveLiquidityStress(avgValue20),

    "shape.retStdev40": stdev(r40),
    "shape.compression20": compression20,
    "shape.breakoutDistance20": breakoutDistance20,
    "shape.failedBreakoutCount20": failedBreakoutCount20,

    "execution.feasibilityScore": executionFeasibilityScore
  }

  if (
    normalizedSurfaceName !== PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE &&
    normalizedSurfaceName !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE &&
    normalizedSurfaceName !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE &&
    normalizedSurfaceName !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE &&
    normalizedSurfaceName !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE &&
    normalizedSurfaceName !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE
  ) {
    return baseFeatureVec
  }

  const extendedSelectionMode =
    normalizedSurfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE
      ? "full"
      : normalizedSurfaceName === PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE
        ? "tp12"
        : "plus_lite"

  return {
    ...baseFeatureVec,
    ...buildExtendedSnapshotFeatureVecFromCache({
      cache,
      series,
      asOfIdx,
      closeValue: cl,
      openValue: o,
      highValue: h,
      lowValue: l,
      volumeValue: v,
      avgVol20,
      avgValue20,
      valueRatio20,
      maValues: {
        5: ma5,
        10: ma10,
        20: ma20,
        60: ma60,
        120: ma120,
      },
      prevMaValues: {
        5: prevMa5,
        10: prevMa10,
        20: prevMa20,
        60: prevMa60,
        120: maFromCache(cache, asOfIdx - 1, 120),
      },
      selectionMode: extendedSelectionMode,
    }),
  }
}

export const extractGlobalContextFeaturesFromCache = ({
  cache,
  series,
  asOfIdx,
  globalWindow = 150
}) => {
  if (!cache) {
    throw new Error("extractGlobalContextFeaturesFromCache requires a series feature runtime cache")
  }
  if (!Array.isArray(series) || !Number.isInteger(asOfIdx) || asOfIdx < 0) {
    return null
  }
  const gWindow = Math.max(2, Number(globalWindow) || 150)
  const c = series[asOfIdx]
  const cl = num(c?.close)
  const ma120 = maFromCache(cache, asOfIdx, 120)
  const ma150 = maFromCache(cache, asOfIdx, 150)
  const ret40Start = Math.max(1, asOfIdx - 40 + 1)
  const ret150Start = Math.max(1, asOfIdx - gWindow + 1)
  const volatility40 = prefixStdev(cache.returnsCache, ret40Start, asOfIdx)
  const volatility150 = prefixStdev(cache.returnsCache, ret150Start, asOfIdx)

  const startIdx = Math.max(0, asOfIdx - gWindow + 1)
  const extrema = resolveWindowExtrema(cache, gWindow)
  const highMax = extrema.highMaxByEnd?.[asOfIdx] ?? null
  const lowMin = extrema.lowMinByEnd?.[asOfIdx] ?? null
  const range = Number.isFinite(highMax) && Number.isFinite(lowMin) ? highMax - lowMin : null

  const vol20 = meanVolumeFromCache(cache, Math.max(0, asOfIdx - 19), asOfIdx)
  const vol150 = meanVolumeFromCache(cache, startIdx, asOfIdx)
  const value20 = meanTradingValueFromCache(cache, Math.max(0, asOfIdx - 19), asOfIdx)
  const value150 = meanTradingValueFromCache(cache, startIdx, asOfIdx)
  const recent20Extrema = resolveWindowExtrema(cache, 20)
  const recent20High = recent20Extrema.highMaxByEnd?.[asOfIdx] ?? null
  const recent20Low = recent20Extrema.lowMinByEnd?.[asOfIdx] ?? null
  const recent20Range =
    Number.isFinite(recent20High) && Number.isFinite(recent20Low)
      ? recent20High - recent20Low
      : null

  return {
    "global.ret20": retOverFromCache(cache, asOfIdx, 20),
    "global.ret40": retOverFromCache(cache, asOfIdx, 40),
    "global.ret60": retOverFromCache(cache, asOfIdx, 60),
    "global.ret120": retOverFromCache(cache, asOfIdx, 120),
    "global.ret150": retOverFromCache(cache, asOfIdx, 150),
    "global.closeOverMa120": safeDiv(cl, ma120) !== null ? safeDiv(cl, ma120) - 1 : null,
    "global.closeOverMa150": safeDiv(cl, ma150) !== null ? safeDiv(cl, ma150) - 1 : null,
    "global.drawdownFromHigh150": safeDiv(cl, highMax) !== null ? safeDiv(cl, highMax) - 1 : null,
    "global.rangePos150":
      Number.isFinite(cl) && Number.isFinite(lowMin) && Number.isFinite(range) && range !== 0
        ? (cl - lowMin) / range
        : null,
    "global.rangePct150": Number.isFinite(range) && Number.isFinite(cl) && cl !== 0 ? range / cl : null,
    "global.volatility40": volatility40,
    "global.volatility150": volatility150,
    "global.volatilityExpansion40Over150": safeDiv(volatility40, volatility150),
    "global.rangeCompression20Over150":
      Number.isFinite(recent20Range) && Number.isFinite(range) && range !== 0
        ? recent20Range / range
        : null,
    "global.volumeRatio20Over150": safeDiv(vol20, vol150),
    "global.valueRatio20Over150": safeDiv(value20, value150)
  }
}
