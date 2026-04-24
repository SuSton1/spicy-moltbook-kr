import { toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"

export const TP12_OPERATIONAL_MICRO_FEATURE_BANK_ID = "tp12_operational_micro_feature_bank_v1"

const finite = (value) => Number.isFinite(value)
const roundFeature = (value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : null)
const safeDiv = (left, right) => (finite(left) && finite(right) && right !== 0 ? left / right : null)
const pct = (left, right) => {
  const ratio = safeDiv(left, right)
  return ratio === null ? null : ratio - 1
}

const avg = (values) => {
  const safe = values.filter(finite)
  return safe.length > 0 ? safe.reduce((sum, value) => sum + value, 0) / safe.length : null
}

const max = (values) => {
  const safe = values.filter(finite)
  return safe.length > 0 ? Math.max(...safe) : null
}

const min = (values) => {
  const safe = values.filter(finite)
  return safe.length > 0 ? Math.min(...safe) : null
}

const windowRows = (series, index, lookback) => {
  const start = Math.max(0, index - lookback + 1)
  return series.slice(start, index + 1)
}

const windowRowsBefore = (series, index, lookback) => {
  const start = Math.max(0, index - lookback)
  return series.slice(start, index)
}

const normalizeThreshold = (threshold) => String(threshold).replace("-", "m").replace(".", "p")

const addThresholdTerms = ({ terms, prefix, value, thresholds, direction = "ge" }) => {
  if (!finite(value)) return
  for (const threshold of thresholds) {
    if (direction === "ge" && value >= threshold) terms.push(`${prefix}_ge_${normalizeThreshold(threshold)}`)
    if (direction === "le" && value <= threshold) terms.push(`${prefix}_le_${normalizeThreshold(threshold)}`)
  }
}

const gt = (left, right) => finite(left) && finite(right) && left > right
const lt = (left, right) => finite(left) && finite(right) && left < right

export const buildTp12OperationalMicroFeatureSnapshot = ({ series, index }) => {
  if (!Array.isArray(series) || !Number.isInteger(index) || index < 0 || index >= series.length) {
    throw new Error("valid series and index are required for TP12 operational micro features")
  }
  const row = series[index]
  const prev = index > 0 ? series[index - 1] : null
  const close = toNumber(row?.close, NaN)
  const open = toNumber(row?.open, NaN)
  const high = toNumber(row?.high, NaN)
  const low = toNumber(row?.low, NaN)
  const volume = toNumber(row?.volume, NaN)
  const w3 = windowRows(series, index, 3)
  const w5 = windowRows(series, index, 5)
  const w10 = windowRows(series, index, 10)
  const w20 = windowRows(series, index, 20)
  const w60 = windowRows(series, index, 60)
  const w120 = windowRows(series, index, 120)
  const p20 = windowRowsBefore(series, index, 20)
  const p60 = windowRowsBefore(series, index, 60)
  const p120 = windowRowsBefore(series, index, 120)
  const value = finite(close) && finite(volume) ? close * volume : null
  const valueRows = (rows) => rows.map((item) => toNumber(item?.close, NaN) * toNumber(item?.volume, NaN))
  const avgVol5 = avg(w5.map((item) => toNumber(item?.volume, NaN)))
  const avgVol10 = avg(w10.map((item) => toNumber(item?.volume, NaN)))
  const avgVol20 = avg(w20.map((item) => toNumber(item?.volume, NaN)))
  const avgVol60 = avg(w60.map((item) => toNumber(item?.volume, NaN)))
  const avgVol120 = avg(w120.map((item) => toNumber(item?.volume, NaN)))
  const avgValue5 = avg(valueRows(w5))
  const avgValue20 = avg(valueRows(w20))
  const avgValue60 = avg(valueRows(w60))
  const avgValue120 = avg(valueRows(w120))
  const ma5 = w5.length >= 5 ? avg(w5.map((item) => toNumber(item?.close, NaN))) : null
  const ma10 = w10.length >= 10 ? avg(w10.map((item) => toNumber(item?.close, NaN))) : null
  const ma20 = w20.length >= 20 ? avg(w20.map((item) => toNumber(item?.close, NaN))) : null
  const ma60 = w60.length >= 60 ? avg(w60.map((item) => toNumber(item?.close, NaN))) : null
  const ma120 = w120.length >= 120 ? avg(w120.map((item) => toNumber(item?.close, NaN))) : null
  const prevHigh20 = p20.length >= 20 ? max(p20.map((item) => toNumber(item?.high, NaN))) : null
  const prevHigh60 = p60.length >= 60 ? max(p60.map((item) => toNumber(item?.high, NaN))) : null
  const prevHigh120 = p120.length >= 120 ? max(p120.map((item) => toNumber(item?.high, NaN))) : null
  const high20 = w20.length >= 20 ? max(w20.map((item) => toNumber(item?.high, NaN))) : null
  const low20 = w20.length >= 20 ? min(w20.map((item) => toNumber(item?.low, NaN))) : null
  const high60 = w60.length >= 60 ? max(w60.map((item) => toNumber(item?.high, NaN))) : null
  const low60 = w60.length >= 60 ? min(w60.map((item) => toNumber(item?.low, NaN))) : null
  const rangeAbs = finite(high) && finite(low) ? high - low : null
  const bodyAbs = finite(open) && finite(close) ? Math.abs(close - open) : null
  const upperWickAbs = finite(high) && finite(open) && finite(close) ? high - Math.max(open, close) : null
  const lowerWickAbs = finite(low) && finite(open) && finite(close) ? Math.min(open, close) - low : null
  const prevClose = prev ? toNumber(prev.close, NaN) : null
  const prevMa20 = index > 0 ? avg(windowRows(series, index - 1, 20).map((item) => toNumber(item?.close, NaN))) : null
  const prevMa60 = index > 0 ? avg(windowRows(series, index - 1, 60).map((item) => toNumber(item?.close, NaN))) : null
  return {
    ret1: roundFeature(prevClose ? pct(close, prevClose) : null),
    ret3: roundFeature(index >= 3 ? pct(close, toNumber(series[index - 3]?.close, NaN)) : null),
    ret5: roundFeature(index >= 5 ? pct(close, toNumber(series[index - 5]?.close, NaN)) : null),
    ret10: roundFeature(index >= 10 ? pct(close, toNumber(series[index - 10]?.close, NaN)) : null),
    ret20: roundFeature(index >= 20 ? pct(close, toNumber(series[index - 20]?.close, NaN)) : null),
    gap: roundFeature(prevClose ? pct(open, prevClose) : null),
    rangePct: roundFeature(prevClose && finite(rangeAbs) ? rangeAbs / prevClose : null),
    closePos: roundFeature(finite(rangeAbs) && rangeAbs > 0 ? (close - low) / rangeAbs : null),
    bodyPctOfRange: roundFeature(finite(rangeAbs) && rangeAbs > 0 ? bodyAbs / rangeAbs : null),
    upperWickPctOfRange: roundFeature(finite(rangeAbs) && rangeAbs > 0 ? upperWickAbs / rangeAbs : null),
    lowerWickPctOfRange: roundFeature(finite(rangeAbs) && rangeAbs > 0 ? lowerWickAbs / rangeAbs : null),
    bullBodyPctOfRange: roundFeature(finite(rangeAbs) && rangeAbs > 0 && close > open ? bodyAbs / rangeAbs : null),
    bearBodyPctOfRange: roundFeature(finite(rangeAbs) && rangeAbs > 0 && close < open ? bodyAbs / rangeAbs : null),
    relVol5: roundFeature(safeDiv(volume, avgVol5)),
    relVol10: roundFeature(safeDiv(volume, avgVol10)),
    relVol20: roundFeature(safeDiv(volume, avgVol20)),
    relVol60: roundFeature(safeDiv(volume, avgVol60)),
    relVol120: roundFeature(safeDiv(volume, avgVol120)),
    relValue5: roundFeature(safeDiv(value, avgValue5)),
    relValue20: roundFeature(safeDiv(value, avgValue20)),
    relValue60: roundFeature(safeDiv(value, avgValue60)),
    relValue120: roundFeature(safeDiv(value, avgValue120)),
    volMa5Over20: roundFeature(safeDiv(avgVol5, avgVol20)),
    volMa20Over60: roundFeature(safeDiv(avgVol20, avgVol60)),
    volMa60Over120: roundFeature(safeDiv(avgVol60, avgVol120)),
    valueMa5Over20: roundFeature(safeDiv(avgValue5, avgValue20)),
    valueMa20Over60: roundFeature(safeDiv(avgValue20, avgValue60)),
    closeOverMa5: roundFeature(ma5 ? close / ma5 - 1 : null),
    closeOverMa10: roundFeature(ma10 ? close / ma10 - 1 : null),
    closeOverMa20: roundFeature(ma20 ? close / ma20 - 1 : null),
    closeOverMa60: roundFeature(ma60 ? close / ma60 - 1 : null),
    closeOverMa120: roundFeature(ma120 ? close / ma120 - 1 : null),
    ma5Over20: roundFeature(safeDiv(ma5, ma20)),
    ma20Over60: roundFeature(safeDiv(ma20, ma60)),
    ma60Over120: roundFeature(safeDiv(ma60, ma120)),
    closeNearHigh20: roundFeature(high20 && low20 && high20 > low20 ? (close - low20) / (high20 - low20) : null),
    closeNearHigh60: roundFeature(high60 && low60 && high60 > low60 ? (close - low60) / (high60 - low60) : null),
    closeBreakPreviousHigh20: prevHigh20 ? close > prevHigh20 : false,
    closeBreakPreviousHigh60: prevHigh60 ? close > prevHigh60 : false,
    closeBreakPreviousHigh120: prevHigh120 ? close > prevHigh120 : false,
    highBreakPreviousHigh20: prevHigh20 ? high > prevHigh20 : false,
    highBreakPreviousHigh60: prevHigh60 ? high > prevHigh60 : false,
    closeReclaimMa20: prev && prevMa20 && ma20 ? toNumber(prev.close, NaN) <= prevMa20 && close > ma20 : false,
    closeReclaimMa60: prev && prevMa60 && ma60 ? toNumber(prev.close, NaN) <= prevMa60 && close > ma60 : false,
  }
}

export const buildTp12OperationalMicroFeatureTerms = ({ series, index }) => {
  const features = buildTp12OperationalMicroFeatureSnapshot({ series, index })
  const terms = []
  addThresholdTerms({ terms, prefix: "micro:return:ret1", value: features.ret1, thresholds: [0.02, 0.04, 0.07, 0.1] })
  addThresholdTerms({ terms, prefix: "micro:return:ret1", value: features.ret1, thresholds: [-0.02, -0.04, -0.07], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:return:ret3", value: features.ret3, thresholds: [0.04, 0.08, 0.12, 0.18] })
  addThresholdTerms({ terms, prefix: "micro:return:ret5", value: features.ret5, thresholds: [0.06, 0.1, 0.18, 0.25] })
  addThresholdTerms({ terms, prefix: "micro:return:ret20", value: features.ret20, thresholds: [0.1, 0.25, 0.5] })
  addThresholdTerms({ terms, prefix: "micro:return:gap", value: features.gap, thresholds: [0.02, 0.04, 0.07] })
  addThresholdTerms({ terms, prefix: "micro:return:gap", value: features.gap, thresholds: [-0.02, -0.04], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:range:range", value: features.rangePct, thresholds: [0.03, 0.05, 0.08, 0.12] })
  addThresholdTerms({ terms, prefix: "micro:shape:close_pos", value: features.closePos, thresholds: [0.65, 0.75, 0.85, 0.95] })
  addThresholdTerms({ terms, prefix: "micro:shape:close_pos", value: features.closePos, thresholds: [0.35, 0.25, 0.15], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:shape:body", value: features.bodyPctOfRange, thresholds: [0.25, 0.45, 0.65, 0.8] })
  addThresholdTerms({ terms, prefix: "micro:shape:body", value: features.bodyPctOfRange, thresholds: [0.15], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:shape:upper_wick", value: features.upperWickPctOfRange, thresholds: [0.15, 0.25, 0.4, 0.6] })
  addThresholdTerms({ terms, prefix: "micro:shape:upper_wick", value: features.upperWickPctOfRange, thresholds: [0.1], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:shape:lower_wick", value: features.lowerWickPctOfRange, thresholds: [0.15, 0.25, 0.4, 0.6] })
  addThresholdTerms({ terms, prefix: "micro:shape:lower_wick", value: features.lowerWickPctOfRange, thresholds: [0.1], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:shape:bull_body", value: features.bullBodyPctOfRange, thresholds: [0.25, 0.45, 0.65] })
  addThresholdTerms({ terms, prefix: "micro:shape:bear_body", value: features.bearBodyPctOfRange, thresholds: [0.25, 0.45, 0.65] })
  for (const [name, value] of [
    ["rel5", features.relVol5],
    ["rel10", features.relVol10],
    ["rel20", features.relVol20],
    ["rel60", features.relVol60],
    ["rel120", features.relVol120],
  ]) {
    addThresholdTerms({ terms, prefix: `micro:volume:${name}`, value, thresholds: [1.25, 1.5, 2, 3, 5] })
    addThresholdTerms({ terms, prefix: `micro:volume:${name}`, value, thresholds: [0.75, 0.5, 0.35], direction: "le" })
  }
  addThresholdTerms({ terms, prefix: "micro:volume:ma5_over20", value: features.volMa5Over20, thresholds: [1.2, 1.5, 2] })
  addThresholdTerms({ terms, prefix: "micro:volume:ma5_over20", value: features.volMa5Over20, thresholds: [0.8, 0.6], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:volume:ma20_over60", value: features.volMa20Over60, thresholds: [1.2, 1.5] })
  addThresholdTerms({ terms, prefix: "micro:volume:ma20_over60", value: features.volMa20Over60, thresholds: [0.8, 0.6], direction: "le" })
  addThresholdTerms({ terms, prefix: "micro:volume:ma60_over120", value: features.volMa60Over120, thresholds: [1.2] })
  addThresholdTerms({ terms, prefix: "micro:volume:ma60_over120", value: features.volMa60Over120, thresholds: [0.8], direction: "le" })
  for (const [name, value] of [
    ["rel5", features.relValue5],
    ["rel20", features.relValue20],
    ["rel60", features.relValue60],
    ["rel120", features.relValue120],
  ]) {
    addThresholdTerms({ terms, prefix: `micro:amount:${name}`, value, thresholds: [1.25, 1.5, 2, 3] })
    addThresholdTerms({ terms, prefix: `micro:amount:${name}`, value, thresholds: [0.75, 0.5], direction: "le" })
  }
  addThresholdTerms({ terms, prefix: "micro:amount:ma5_over20", value: features.valueMa5Over20, thresholds: [1.2, 1.5, 2] })
  addThresholdTerms({ terms, prefix: "micro:amount:ma5_over20", value: features.valueMa5Over20, thresholds: [0.8, 0.6], direction: "le" })
  for (const [name, value] of [
    ["close_over_ma5", features.closeOverMa5],
    ["close_over_ma10", features.closeOverMa10],
    ["close_over_ma20", features.closeOverMa20],
    ["close_over_ma60", features.closeOverMa60],
    ["close_over_ma120", features.closeOverMa120],
  ]) {
    addThresholdTerms({ terms, prefix: `micro:moving_average:${name}`, value, thresholds: [0, 0.03, 0.07, 0.12, 0.2] })
    addThresholdTerms({ terms, prefix: `micro:moving_average:${name}`, value, thresholds: [-0.03, -0.07, -0.12], direction: "le" })
  }
  addThresholdTerms({ terms, prefix: "micro:moving_average:ma5_over20", value: features.ma5Over20, thresholds: [1, 1.03, 1.07] })
  addThresholdTerms({ terms, prefix: "micro:moving_average:ma20_over60", value: features.ma20Over60, thresholds: [1, 1.03] })
  addThresholdTerms({ terms, prefix: "micro:moving_average:ma60_over120", value: features.ma60Over120, thresholds: [1] })
  addThresholdTerms({ terms, prefix: "micro:breakout:close_near_high20", value: features.closeNearHigh20, thresholds: [0.75, 0.9, 0.97] })
  addThresholdTerms({ terms, prefix: "micro:breakout:close_near_high60", value: features.closeNearHigh60, thresholds: [0.75, 0.9, 0.97] })
  if (features.closeBreakPreviousHigh20) terms.push("micro:breakout:close_break_prev_high20")
  if (features.closeBreakPreviousHigh60) terms.push("micro:breakout:close_break_prev_high60")
  if (features.closeBreakPreviousHigh120) terms.push("micro:breakout:close_break_prev_high120")
  if (features.highBreakPreviousHigh20) terms.push("micro:breakout:high_break_prev_high20")
  if (features.highBreakPreviousHigh60) terms.push("micro:breakout:high_break_prev_high60")
  if (features.closeReclaimMa20) terms.push("micro:reclaim:close_reclaim_ma20")
  if (features.closeReclaimMa60) terms.push("micro:reclaim:close_reclaim_ma60")
  return [...new Set(terms)].sort()
}

export const assertTp12OperationalMicroTermsAllowed = (terms) => {
  if (!Array.isArray(terms)) throw new Error("micro terms must be an array")
  const forbiddenWords = [
    "entry",
    "hitdate",
    "future",
    "forward",
    "oos",
    `fl${"ow"}`,
    `pro${"gram"}`,
    `ne${"ws"}`,
    `the${"me"}`,
    `sec${"tor"}`,
  ]
  const bad = terms.filter((term) => {
    const text = toText(term).toLowerCase()
    return !text.startsWith("micro:") || forbiddenWords.some((word) => text.includes(word))
  })
  if (bad.length > 0) throw new Error(`forbidden operational micro feature terms: ${bad.slice(0, 10).join(", ")}`)
}
