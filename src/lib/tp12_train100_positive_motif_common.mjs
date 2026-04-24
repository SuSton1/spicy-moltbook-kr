import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertNoOosPath,
  CORE_YEARS,
  looksLikeOosPath,
} from "./tp12_train100_neutral_search_guards.mjs"

export const TP12_TRAIN100_POSITIVE_MOTIF_PATCH_KEY = "tp12_train100_positive_motif_contrastive_v1"
export const TP12_TRAIN100_SEQUENCE_SHAPELET_PATCH_KEY = "tp12_train100_sequence_shapelet_contrastive_v1"
export const TP12_TRAIN100_POSITIVE_MOTIF_CONTRACT_KIND =
  "tp12_train100_positive_motif_contrastive_contract_v1"
export const TP12_TRAIN100_POSITIVE_MOTIF_ALLOWED_PATCH_KEYS = new Set([
  TP12_TRAIN100_POSITIVE_MOTIF_PATCH_KEY,
  TP12_TRAIN100_SEQUENCE_SHAPELET_PATCH_KEY,
])

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")
const atomIdFor = (name) => `motif:${sha256(name).slice(0, 32)}`

export const parseCliArgs = (argv = process.argv.slice(2)) =>
  Object.fromEntries(argv.map((arg) => {
    const [key, ...rest] = String(arg).replace(/^--/, "").split("=")
    return [key, rest.join("=") || "true"]
  }))

const assertNoOosInValue = (value, label = "value") => {
  if (typeof value === "string") {
    if (!label.includes("forbiddenDateRange")) assertNoOosPath(value, label)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoOosInValue(item, `${label}.${index}`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (looksLikeOosPath(key)) throw new Error(`${label} contains forbidden OOS key: ${key}`)
    assertNoOosInValue(child, `${label}.${key}`)
  }
}

const collectForbiddenFieldHits = (value, forbiddenFields = [], parts = []) => {
  if (!value || typeof value !== "object") return []
  const hits = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...collectForbiddenFieldHits(item, forbiddenFields, [...parts, String(index)])))
    return hits
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFields.includes(key)) hits.push([...parts, key].join("."))
    hits.push(...collectForbiddenFieldHits(child, forbiddenFields, [...parts, key]))
  }
  return hits
}

export const assertNoForbiddenExpressionFields = (value, contract, label = "expression") => {
  const forbiddenFields = Array.isArray(contract?.forbiddenExpressionFields) ? contract.forbiddenExpressionFields : []
  const hits = collectForbiddenFieldHits(value, forbiddenFields)
  if (hits.length > 0) throw new Error(`${label} uses forbidden expression fields: ${hits.slice(0, 20).join(",")}`)
}

export const assertNeutralMotifAtomName = (name) => {
  const text = toText(name)
  if (!text) throw new Error("motif atom name is required")
  const lower = text.toLowerCase()
  for (const token of ["bad", "good", "weak"]) {
    if (lower.includes(token)) throw new Error(`motif atom name encodes semantic polarity "${token}": ${text}`)
  }
}

const assertAsOfSafe = (row, label = "row") => {
  const sourceDateKey = toText(row.sourceDateKey ?? row.featureSourceDateKey ?? row.decisionDateKey)
  const decisionDateKey = toText(row.decisionDateKey)
  if (sourceDateKey && decisionDateKey && sourceDateKey > decisionDateKey) {
    throw new Error(`${label} sourceDateKey is after decisionDateKey: ${sourceDateKey} > ${decisionDateKey}`)
  }
}

const resolvePath = (cwd, filePath, label, { mustExist = true } = {}) => {
  const text = toText(filePath)
  if (!text) {
    if (mustExist) throw new Error(`${label} is required`)
    return ""
  }
  assertNoOosPath(text, label)
  const resolved = path.resolve(cwd, text)
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

export const outputPathFromPositiveMotifContract = (cwd, contract, key, override = "") => {
  const selected = toText(override) || toText(contract?.outputPaths?.[key])
  if (!selected) throw new Error(`output path is required for ${key}`)
  assertNoOosPath(selected, `outputPaths.${key}`)
  return path.resolve(cwd, selected)
}

export const loadTp12PositiveMotifContract = async (contractPath, { cwd = process.cwd() } = {}) => {
  const resolvedContractPath = resolvePath(cwd, contractPath, "contractPath")
  const contract = await readJson(resolvedContractPath, null)
  if (!contract) throw new Error(`contractPath is not readable JSON: ${resolvedContractPath}`)
  assertNoOosInValue(contract, "contract")
  if (contract.kind !== TP12_TRAIN100_POSITIVE_MOTIF_CONTRACT_KIND) {
    throw new Error(`invalid positive motif contract kind: ${contract.kind ?? "missing"}`)
  }
  if (!TP12_TRAIN100_POSITIVE_MOTIF_ALLOWED_PATCH_KEYS.has(contract.patchKey)) {
    throw new Error(`invalid patchKey: expected one of ${[...TP12_TRAIN100_POSITIVE_MOTIF_ALLOWED_PATCH_KEYS].join(", ")}, got ${contract.patchKey ?? "missing"}`)
  }
  if (toBool(contract.oosReadAllowed, false) !== false) throw new Error("oosReadAllowed must be false")
  if (toBool(contract.fallbackAllowed, false) !== false) throw new Error("fallbackAllowed must be false")
  if (toBool(contract?.featurePolicy?.useSideDaily, false)) throw new Error("useSideDaily must remain false in this patch")
  if (toBool(contract?.featurePolicy?.useIntraday, false)) throw new Error("useIntraday must remain false in this patch")
  if (toBool(contract?.featurePolicy?.useThemeSector, false)) throw new Error("useThemeSector must remain false in this patch")
  if (contract.patchKey === TP12_TRAIN100_SEQUENCE_SHAPELET_PATCH_KEY) {
    if (toBool(contract?.featurePolicy?.useDailyCandleSequence, false) !== true) {
      throw new Error("sequence shapelet contract must set featurePolicy.useDailyCandleSequence=true")
    }
    const minHistoryBars = Math.trunc(toNumber(contract?.sequencePolicy?.minHistoryBars, 20))
    if (minHistoryBars < 5) throw new Error("sequencePolicy.minHistoryBars must be at least 5")
  }
  const trainFrom = toText(contract?.trainDateRange?.from)
  const trainTo = toText(contract?.trainDateRange?.to)
  if (!validDateKey(trainFrom) || !validDateKey(trainTo) || trainFrom > trainTo) {
    throw new Error(`invalid trainDateRange: ${trainFrom || "missing"}..${trainTo || "missing"}`)
  }
  const forbiddenFrom = toText(contract?.forbiddenDateRange?.from)
  const forbiddenTo = toText(contract?.forbiddenDateRange?.to)
  if (!validDateKey(forbiddenFrom) || !validDateKey(forbiddenTo) || forbiddenFrom > forbiddenTo) {
    throw new Error(`invalid forbiddenDateRange: ${forbiddenFrom || "missing"}..${forbiddenTo || "missing"}`)
  }
  const objective = contract.objective ?? {}
  if (Math.trunc(toNumber(objective.minHitDecisionDatesPerYear, 0)) !== 2) throw new Error("minHitDecisionDatesPerYear must equal 2")
  if (Math.trunc(toNumber(objective.minHitSymbolDatesPerYear, 0)) !== 2) throw new Error("minHitSymbolDatesPerYear must equal 2")
  if (Math.trunc(toNumber(objective.minTotalPositiveSymbolDates, 0)) < 18) throw new Error("minTotalPositiveSymbolDates must be at least 18")
  if (Math.trunc(toNumber(objective.requireFalsePositiveRows, 999)) !== 0) throw new Error("requireFalsePositiveRows must equal 0")
  if (toNumber(objective.requireTrainPrecision, 0) !== 1) throw new Error("requireTrainPrecision must equal 1")
  const expression = contract.expression ?? {}
  if (toText(expression.form) !== "positive_motif_anchor_and_not_conditional_veto") {
    throw new Error("expression.form must be positive_motif_anchor_and_not_conditional_veto")
  }
  assertNoForbiddenExpressionFields(contract, contract, "contract")
  return { contract, contractPath: resolvedContractPath }
}

export const assertTp12PositiveMotifContract = async ({
  contractPath,
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "contractAssertSummary", outSummaryPath)
  const summary = {
    kind: "tp12_train100_positive_motif_contract_assert_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    status: "passed",
    oosRead: false,
    fallbackUsed: false,
    lockedSelectorEmitted: false,
  }
  await writeJson(outputPath, summary)
  return summary
}

const targetFromContract = (contract) => ({
  minHitDecisionDatesPerYear: Math.trunc(toNumber(contract?.objective?.minHitDecisionDatesPerYear, 2)),
  minHitSymbolDatesPerYear: Math.trunc(toNumber(contract?.objective?.minHitSymbolDatesPerYear, 2)),
  minTotalPositiveSymbolDates: Math.trunc(toNumber(contract?.objective?.minTotalPositiveSymbolDates, 18)),
  requireFalsePositiveRows: Math.trunc(toNumber(contract?.objective?.requireFalsePositiveRows, 0)),
  requireTrainPrecision: toNumber(contract?.objective?.requireTrainPrecision, 1),
})

const limitsFromContract = (contract) => ({
  maxAnchorAtoms: Math.trunc(toNumber(contract?.expression?.maxAnchorAtoms, 4)),
  maxVetoClauses: Math.trunc(toNumber(contract?.expression?.maxVetoClauses, 4)),
  maxVetoAtomsPerClause: Math.trunc(toNumber(contract?.expression?.maxVetoAtomsPerClause, 3)),
  maxTotalAtoms: Math.trunc(toNumber(contract?.expression?.maxTotalAtoms, 10)),
})

const rowKey = (row) => `${toText(row.symbol)}::${toText(row.decisionDateKey)}`
const finite = (value) => Number.isFinite(Number(value))
const safeDiv = (num, den) => (Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : NaN)
const avg = (values) => {
  const numeric = values.map((value) => Number(value)).filter(Number.isFinite)
  return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : NaN
}
const sum = (values) => values.map((value) => Number(value)).filter(Number.isFinite).reduce((acc, value) => acc + value, 0)
const lastN = (values, n) => values.slice(Math.max(0, values.length - n))
const sortedUnique = (values) => [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)

const normalizeHistory = (row) => {
  const raw = Array.isArray(row.history) ? row.history
    : Array.isArray(row.preHitWindow) ? row.preHitWindow
      : Array.isArray(row.ohlcvHistory) ? row.ohlcvHistory
        : []
  const history = raw.map((bar) => ({
    dateKey: toText(bar.dateKey ?? bar.tradeDate ?? bar.decisionDateKey),
    open: toNumber(bar.open ?? bar.openPrice, NaN),
    high: toNumber(bar.high ?? bar.highPrice, NaN),
    low: toNumber(bar.low ?? bar.lowPrice, NaN),
    close: toNumber(bar.close ?? bar.closePrice, NaN),
    volume: toNumber(bar.volume, NaN),
  })).filter((bar) => validDateKey(bar.dateKey) && Number.isFinite(bar.close))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  if (history.length > 0) return history
  const decisionDateKey = toText(row.decisionDateKey ?? row.dateKey)
  const open = toNumber(row.open ?? row.openPrice ?? row?.ohlcv?.open, NaN)
  const high = toNumber(row.high ?? row.highPrice ?? row?.ohlcv?.high, NaN)
  const low = toNumber(row.low ?? row.lowPrice ?? row?.ohlcv?.low, NaN)
  const close = toNumber(row.close ?? row.closePrice ?? row?.ohlcv?.close, NaN)
  const volume = toNumber(row.volume ?? row?.ohlcv?.volume, NaN)
  return validDateKey(decisionDateKey) && Number.isFinite(close)
    ? [{ dateKey: decisionDateKey, open, high, low, close, volume }]
    : []
}

const firstNumber = (...values) => {
  for (const value of values) {
    const numeric = toNumber(value, NaN)
    if (Number.isFinite(numeric)) return numeric
  }
  return NaN
}

const FEATURE_ALIASES = {
  ret1d: ["return1d"],
  ret2d: ["return2d"],
  ret3d: ["return3d"],
  ret5d: ["return5d"],
  ret10d: ["return10d"],
  ret20d: ["return20d"],
  ret60d: ["return60d"],
  gapPrevClose: ["gapPct"],
  closeToHigh20: ["closeToHigh20Pct"],
  closeFromLow20: ["closeFromLow20Pct"],
  marketMeanReturn5d: ["marketMeanReturn5"],
  marketMeanReturn20d: ["marketMeanReturn20"],
}

const directFeature = (row, key) => {
  const keys = [key, ...(FEATURE_ALIASES[key] ?? [])]
  for (const selectedKey of keys) {
    const numeric = firstNumber(
      row?.features?.[selectedKey],
      row?.contextFeatures?.[selectedKey],
      row?.metrics?.[selectedKey],
      row?.[selectedKey],
    )
    if (Number.isFinite(numeric)) return numeric
  }
  return NaN
}

const normalizeCandleBar = (row) => ({
  symbol: toText(row.symbol ?? row.ticker ?? row.code),
  dateKey: toText(row.dateKey ?? row.tradeDate ?? row.tradingDate ?? row.decisionDateKey ?? row.date),
  open: toNumber(row.open ?? row.openPrice, NaN),
  high: toNumber(row.high ?? row.highPrice, NaN),
  low: toNumber(row.low ?? row.lowPrice, NaN),
  close: toNumber(row.close ?? row.closePrice, NaN),
  volume: toNumber(row.volume ?? row.vol, NaN),
})

const loadCandleHistoryIndex = async (candleDailyPath, contract, { cwd = process.cwd() } = {}) => {
  const inputPath = resolvePath(cwd, candleDailyPath, "candleDailyPath")
  const bySymbol = new Map()
  let rowCount = 0
  let usedRowCount = 0
  let forbiddenDateRowsSkipped = 0
  await iterateJsonlMaybeGzip(inputPath, {
    strict: true,
    onRow: async (row) => {
      rowCount += 1
      const bar = normalizeCandleBar(row)
      if (!bar.symbol || !validDateKey(bar.dateKey) || !Number.isFinite(bar.close)) return
      if (bar.dateKey >= contract.forbiddenDateRange.from && bar.dateKey <= contract.forbiddenDateRange.to) {
        forbiddenDateRowsSkipped += 1
        return
      }
      if (bar.dateKey > contract.trainDateRange.to) return
      if (!bySymbol.has(bar.symbol)) bySymbol.set(bar.symbol, [])
      bySymbol.get(bar.symbol).push(bar)
      usedRowCount += 1
    },
  })
  for (const bars of bySymbol.values()) bars.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  return { inputPath, bySymbol, rowCount, usedRowCount, forbiddenDateRowsSkipped }
}

const upperBoundDate = (bars, dateKey) => {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (bars[mid].dateKey <= dateKey) lo = mid + 1
    else hi = mid
  }
  return lo
}

const candleHistoryFor = (candleIndex, symbol, decisionDateKey, lookbackDays) => {
  if (!candleIndex) return []
  const bars = candleIndex.bySymbol.get(symbol) ?? []
  const end = upperBoundDate(bars, decisionDateKey)
  const start = Math.max(0, end - Math.max(1, lookbackDays))
  return bars.slice(start, end)
}

const barRange = (bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low) ? bar.high - bar.low : NaN
const barCloseLocation = (bar) => {
  const range = barRange(bar)
  return Number.isFinite(bar.close) && Number.isFinite(bar.low) && Number.isFinite(range) && range !== 0 ? (bar.close - bar.low) / range : NaN
}

const bucketPattern = (values, lowCut, highCut) =>
  values.map((value) => {
    if (!Number.isFinite(value)) return "x"
    if (value <= lowCut) return "l"
    if (value >= highCut) return "h"
    return "m"
  }).join("")

const returnPattern = (values) =>
  values.map((value) => {
    if (!Number.isFinite(value)) return "x"
    if (value >= 0.02) return "u"
    if (value <= -0.02) return "d"
    return "f"
  }).join("")

const computeSnapshotFeatures = (row) => {
  const history = normalizeHistory(row)
  const d = history.at(-1) ?? {}
  const closes = history.map((bar) => bar.close)
  const highs = history.map((bar) => bar.high).filter(Number.isFinite)
  const lows = history.map((bar) => bar.low).filter(Number.isFinite)
  const volumes = history.map((bar) => bar.volume)
  const ranges = history.map((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low) ? bar.high - bar.low : NaN)
  const close = firstNumber(d.close, row.close, row.closePrice)
  const open = firstNumber(d.open, row.open, row.openPrice)
  const high = firstNumber(d.high, row.high, row.highPrice)
  const low = firstNumber(d.low, row.low, row.lowPrice)
  const volume = firstNumber(d.volume, row.volume)
  const range = Number.isFinite(high) && Number.isFinite(low) ? high - low : NaN
  const body = Number.isFinite(open) && Number.isFinite(close) ? Math.abs(close - open) : NaN
  const prevClose = closes.length >= 2 ? closes.at(-2) : firstNumber(row.prevClose, row.previousClose)
  const ret = (n) => closes.length > n && closes.at(-(n + 1)) !== 0 ? close / closes.at(-(n + 1)) - 1 : directFeature(row, `ret${n}d`)
  const ma = (n) => avg(lastN(closes, n))
  const highN = (n) => Math.max(...lastN(highs, n).filter(Number.isFinite))
  const lowN = (n) => Math.min(...lastN(lows, n).filter(Number.isFinite))
  const avgVolume20 = avg(lastN(volumes, 20))
  const avgRange20 = avg(lastN(ranges, 20))
  const tradedValue = Number.isFinite(close) && Number.isFinite(volume) ? close * volume : directFeature(row, "tradedValue")
  const avgTradingValue20d = avg(lastN(history.map((bar) => Number.isFinite(bar.close) && Number.isFinite(bar.volume) ? bar.close * bar.volume : NaN), 20))
  const high20 = Number.isFinite(highN(20)) ? highN(20) : directFeature(row, "high20")
  const low20 = Number.isFinite(lowN(20)) ? lowN(20) : directFeature(row, "low20")
  const priorHigh20 = highs.length >= 2 ? Math.max(...lastN(highs.slice(0, -1), 20).filter(Number.isFinite)) : directFeature(row, "priorHigh20")
  const ret5 = ret(5)
  const ret1 = ret(1)
  const recent3Volumes = lastN(volumes.slice(0, -1), 3)
  const recent3Ranges = lastN(ranges.slice(0, -1), 3)
  const priorRanges20 = lastN(ranges.slice(0, -1), 20)
  const priorVolumes20 = lastN(volumes.slice(0, -1), 20)
  const avgPriorRange20 = avg(priorRanges20)
  const avgPriorVolume20 = avg(priorVolumes20)
  const last3Bars = lastN(history, 3)
  const returnsByIndex = history.map((bar, index) => {
    const previous = history[index - 1]
    return previous && Number.isFinite(bar.close) && Number.isFinite(previous.close) && previous.close !== 0
      ? bar.close / previous.close - 1
      : NaN
  })
  const seq3ReturnPattern = history.length >= 4 ? returnPattern(lastN(returnsByIndex, 3)) : ""
  const seq3RangePattern = history.length >= 3 && Number.isFinite(avgPriorRange20) && avgPriorRange20 !== 0
    ? bucketPattern(last3Bars.map((bar) => safeDiv(barRange(bar), avgPriorRange20)), 0.8, 1.2)
    : ""
  const seq3VolumePattern = history.length >= 3 && Number.isFinite(avgPriorVolume20) && avgPriorVolume20 !== 0
    ? bucketPattern(last3Bars.map((bar) => safeDiv(bar.volume, avgPriorVolume20)), 0.8, 1.2)
    : ""
  const seq3CloseLocationPattern = history.length >= 3
    ? bucketPattern(last3Bars.map((bar) => barCloseLocation(bar)), 0.35, 0.65)
    : ""
  const dMinus1 = history.at(-2) ?? {}
  const dMinus2 = history.at(-3) ?? {}
  const currentRangeRelPrior20 = safeDiv(range, avgPriorRange20)
  const currentVolumeRelPrior20 = safeDiv(volume, avgPriorVolume20)
  const shapeletCompression2ExpansionD0 = recent3Ranges.length >= 2 && Number.isFinite(range) && Number.isFinite(avgPriorRange20)
    ? (avg(lastN(recent3Ranges, 2)) < avgPriorRange20 * 0.8 && range > avgPriorRange20 * 1.2 ? 1 : 0)
    : 0
  const shapeletDryup2SurgeD0 = recent3Volumes.length >= 2 && Number.isFinite(volume) && Number.isFinite(avgPriorVolume20)
    ? (avg(lastN(recent3Volumes, 2)) < avgPriorVolume20 * 0.8 && volume > avgPriorVolume20 * 1.2 ? 1 : 0)
    : 0
  const shapeletCloseHighPersistence3 = last3Bars.length >= 3 && last3Bars.every((bar) => barCloseLocation(bar) >= 0.65) ? 1 : 0
  const shapeletHigherLow3 = last3Bars.length >= 3 &&
    last3Bars.every((bar) => Number.isFinite(bar.low)) &&
    last3Bars[0].low < last3Bars[1].low &&
    last3Bars[1].low < last3Bars[2].low ? 1 : 0
  const shapeletInsideThenExpansionD0 = Number.isFinite(dMinus1.high) && Number.isFinite(dMinus2.high) &&
    Number.isFinite(dMinus1.low) && Number.isFinite(dMinus2.low) &&
    Number.isFinite(range) && Number.isFinite(barRange(dMinus1)) &&
    dMinus1.high <= dMinus2.high &&
    dMinus1.low >= dMinus2.low &&
    range > barRange(dMinus1) &&
    barCloseLocation(d) >= 0.65 ? 1 : 0
  const shapeletGapHoldD0 = Number.isFinite(prevClose) && Number.isFinite(open) && prevClose !== 0 && barCloseLocation(d) >= 0.65
    ? (open / prevClose - 1 >= 0.03 ? 1 : 0)
    : 0
  const shapeletPullbackThenExpansionD0 = Number.isFinite(ret5) && Number.isFinite(ret1) && Number.isFinite(currentRangeRelPrior20)
    ? (ret5 >= 0.05 && ret1 <= 0.02 && currentRangeRelPrior20 >= 1.2 ? 1 : 0)
    : 0
  return {
    ret1d: Number.isFinite(ret1) ? ret1 : safeDiv(open, prevClose) - 1,
    ret3d: ret(3),
    ret5d: ret5,
    ret10d: ret(10),
    ret20d: ret(20),
    ret60d: ret(60),
    gapPrevClose: Number.isFinite(open) && Number.isFinite(prevClose) ? open / prevClose - 1 : directFeature(row, "gapPrevClose"),
    rangePct: safeDiv(range, close),
    bodyPct: safeDiv(body, close),
    bodyToRange: safeDiv(body, range),
    closeLocation: Number.isFinite(close) && Number.isFinite(low) && Number.isFinite(range) && range !== 0 ? (close - low) / range : directFeature(row, "closeLocation"),
    openLocation: Number.isFinite(open) && Number.isFinite(low) && Number.isFinite(range) && range !== 0 ? (open - low) / range : directFeature(row, "openLocation"),
    upperWickRatio: Number.isFinite(high) && Number.isFinite(open) && Number.isFinite(close) && Number.isFinite(range) && range !== 0
      ? (high - Math.max(open, close)) / range
      : directFeature(row, "upperWickRatio"),
    lowerWickRatio: Number.isFinite(low) && Number.isFinite(open) && Number.isFinite(close) && Number.isFinite(range) && range !== 0
      ? (Math.min(open, close) - low) / range
      : directFeature(row, "lowerWickRatio"),
    ma5Distance: safeDiv(close, ma(5)) - 1,
    ma20Distance: safeDiv(close, ma(20)) - 1,
    ma60Distance: safeDiv(close, ma(60)) - 1,
    ma5Ma20Alignment: safeDiv(ma(5), ma(20)) - 1,
    ma20Ma60Alignment: safeDiv(ma(20), ma(60)) - 1,
    closeFromLow20: safeDiv(close, low20) - 1,
    closeToHigh20: safeDiv(close, high20) - 1,
    breakout20Strength: Number.isFinite(priorHigh20) ? safeDiv(close, priorHigh20) - 1 : directFeature(row, "breakout20Strength"),
    volumeRel20: safeDiv(volume, avgVolume20),
    tradedValue,
    avgTradingValue20d,
    tradedValueRel20: safeDiv(tradedValue, avgTradingValue20d),
    rangeRel20: safeDiv(range, avgRange20),
    compressionThenExpansionW5: recent3Ranges.length >= 3 && Number.isFinite(range) && Number.isFinite(avgRange20)
      ? (avg(recent3Ranges) < avgRange20 * 0.8 && range > avgRange20 * 1.2 ? 1 : 0)
      : directFeature(row, "compressionThenExpansionW5"),
    dryupThenSurgeW5: recent3Volumes.length >= 3 && Number.isFinite(volume) && Number.isFinite(avgVolume20)
      ? (avg(recent3Volumes) < avgVolume20 * 0.8 && volume > avgVolume20 * 1.2 ? 1 : 0)
      : directFeature(row, "dryupThenSurgeW5"),
    pullbackAfterStrengthW5: Number.isFinite(ret5) && Number.isFinite(ret1) ? (ret5 > 0.08 && ret1 < 0.02 ? 1 : 0) : directFeature(row, "pullbackAfterStrengthW5"),
    sequenceHistoryLength: history.length,
    seq3ReturnPattern,
    seq3RangePattern,
    seq3VolumePattern,
    seq3CloseLocationPattern,
    currentRangeRelPrior20,
    currentVolumeRelPrior20,
    shapeletCompression2ExpansionD0,
    shapeletDryup2SurgeD0,
    shapeletCloseHighPersistence3,
    shapeletHigherLow3,
    shapeletInsideThenExpansionD0,
    shapeletGapHoldD0,
    shapeletPullbackThenExpansionD0,
    supportPatternCount: directFeature(row, "supportPatternCount"),
    supportClusterCount: directFeature(row, "supportClusterCount"),
    supportQualityRatio: directFeature(row, "supportQualityRatio"),
    supportOvercrowdRatio: directFeature(row, "supportOvercrowdRatio"),
    dayCandidateRows: directFeature(row, "dayCandidateRows"),
    dayUniqueSymbols: directFeature(row, "dayUniqueSymbols"),
    dayUniquePatterns: directFeature(row, "dayUniquePatterns"),
    marketUpRatio: directFeature(row, "marketUpRatio"),
    limitUpProxyCount: directFeature(row, "limitUpProxyCount"),
    maxForwardReturn: directFeature(row, "maxForwardReturn"),
  }
}

const normalizeTrainRow = (row, rowId, contract) => {
  const decisionDateKey = toText(row.decisionDateKey ?? row.dateKey ?? row.decisionDate)
  if (!validDateKey(decisionDateKey)) throw new Error(`row ${rowId} missing valid decisionDateKey`)
  if (decisionDateKey < contract.trainDateRange.from || decisionDateKey > contract.trainDateRange.to) return null
  if (decisionDateKey >= contract.forbiddenDateRange.from && decisionDateKey <= contract.forbiddenDateRange.to) {
    throw new Error(`row ${rowId} is in forbidden OOS range: ${decisionDateKey}`)
  }
  const symbol = toText(row.symbol ?? row.ticker ?? row.code)
  if (!symbol) throw new Error(`row ${rowId} missing symbol`)
  const normalized = {
    ...row,
    kind: "tp12_train100_positive_motif_universe_row_v1",
    rowId,
    symbol,
    decisionDateKey,
    entryDateKey: toText(row.entryDateKey ?? row.entryDate),
    sourceDateKey: toText(row.sourceDateKey ?? row.featureSourceDateKey ?? decisionDateKey),
    year: Number(decisionDateKey.slice(0, 4)),
    monthKey: decisionDateKey.slice(0, 7),
    hitTarget: toBool(row.hitTarget ?? row.isHit ?? row.hit, false),
    labelOnlyFields: ["hitTarget", "maxForwardReturn"],
  }
  assertAsOfSafe(normalized, `row ${rowId}`)
  return normalized
}

export const buildTp12TrainLabelUniverse = async ({
  contractPath,
  labelEventsPath,
  outPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputPath = resolvePath(cwd, labelEventsPath, "labelEventsPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "trainLabelUniverse", outPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "trainLabelUniverseSummary", outSummaryPath)
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  const byYearRows = {}
  const byYearHits = {}
  let rowId = 0
  let writtenRows = 0
  let hitRows = 0
  try {
    await iterateJsonlMaybeGzip(inputPath, {
      strict: true,
      onRow: async (row) => {
        assertNoForbiddenExpressionFields(row?.expression ?? {}, contract, "labelEvent.expression")
        const normalized = normalizeTrainRow(row, rowId, contract)
        rowId += 1
        if (!normalized) return
        writtenRows += 1
        byYearRows[normalized.year] = (byYearRows[normalized.year] ?? 0) + 1
        if (normalized.hitTarget) {
          hitRows += 1
          byYearHits[normalized.year] = (byYearHits[normalized.year] ?? 0) + 1
        }
        await writeJsonlRow(writer.stream, normalized)
      },
    })
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_train_label_universe_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    labelEventsPath: inputPath,
    outPath: outputPath,
    rowCount: writtenRows,
    hitRowCount: hitRows,
    falsePositiveRowCount: writtenRows - hitRows,
    hitRate: writtenRows > 0 ? hitRows / writtenRows : 0,
    byYearRows,
    byYearHits,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

export const buildTp12PreHitChartSnapshots = async ({
  contractPath,
  universePath = "",
  candleDailyPath = "",
  lookbackDays = 0,
  requireCandleHistory = false,
  outPath = "",
  outManifestPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputPath = resolvePath(cwd, universePath || contract.outputPaths.trainLabelUniverse, "universePath")
  const selectedCandleDailyPath = toText(candleDailyPath) ||
    toText(contract?.inputPaths?.candleDaily) ||
    toText(contract?.sequencePolicy?.candleDailyPath)
  const useDailyCandleSequence = toBool(contract?.featurePolicy?.useDailyCandleSequence, false)
  if (useDailyCandleSequence && !selectedCandleDailyPath) {
    throw new Error("candleDailyPath is required when featurePolicy.useDailyCandleSequence=true")
  }
  const historyLookbackDays = Math.trunc(toNumber(lookbackDays, 0)) ||
    Math.trunc(toNumber(contract?.sequencePolicy?.lookbackDays, 60))
  const minHistoryBars = Math.trunc(toNumber(contract?.sequencePolicy?.minHistoryBars, 20))
  const minHistoryCoverageRate = toNumber(contract?.sequencePolicy?.minHistoryCoverageRate, 0)
  const requireHistory = toBool(requireCandleHistory, false) || toBool(contract?.sequencePolicy?.requireCandleHistory, false)
  const candleIndex = selectedCandleDailyPath
    ? await loadCandleHistoryIndex(selectedCandleDailyPath, contract, { cwd })
    : null
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "preHitSnapshots", outPath)
  const outputManifestPath = outputPathFromPositiveMotifContract(cwd, contract, "preHitSnapshotManifest", outManifestPath)
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  let rowCount = 0
  let hitRowCount = 0
  let featureMissingRows = 0
  let candleHistoryMatchedRows = 0
  let candleHistoryMissingRows = 0
  let candleHistoryShortRows = 0
  let minObservedCandleHistoryLength = Infinity
  let maxObservedCandleHistoryLength = 0
  try {
    await iterateJsonlMaybeGzip(inputPath, {
      strict: true,
      onRow: async (row) => {
        assertAsOfSafe(row, `snapshot row ${rowCount}`)
        const symbol = toText(row.symbol)
        const decisionDateKey = toText(row.decisionDateKey)
        const candleHistory = candleIndex ? candleHistoryFor(candleIndex, symbol, decisionDateKey, historyLookbackDays) : []
        if (candleIndex) {
          if (candleHistory.length < 1) candleHistoryMissingRows += 1
          else candleHistoryMatchedRows += 1
          if (candleHistory.length < minHistoryBars) candleHistoryShortRows += 1
          minObservedCandleHistoryLength = Math.min(minObservedCandleHistoryLength, candleHistory.length)
          maxObservedCandleHistoryLength = Math.max(maxObservedCandleHistoryLength, candleHistory.length)
          if (requireHistory && candleHistory.length < minHistoryBars) {
            throw new Error(`snapshot row ${rowCount} has insufficient candle history: ${symbol} ${decisionDateKey} length=${candleHistory.length}, min=${minHistoryBars}`)
          }
        }
        const enrichedRow = candleHistory.length > 0 ? { ...row, history: candleHistory } : row
        const features = computeSnapshotFeatures(enrichedRow)
        if (!Object.values(features).some(Number.isFinite)) featureMissingRows += 1
        const out = {
          kind: "tp12_train100_positive_motif_snapshot_v1",
          rowId: Math.trunc(toNumber(row.rowId, rowCount)),
          symbol,
          decisionDateKey,
          entryDateKey: toText(row.entryDateKey),
          sourceDateKey: toText(row.sourceDateKey ?? decisionDateKey),
          year: Math.trunc(toNumber(row.year, Number(decisionDateKey.slice(0, 4)))),
          monthKey: toText(row.monthKey ?? decisionDateKey.slice(0, 7)),
          hitTarget: toBool(row.hitTarget, false),
          maxForwardReturn: toNumber(row.maxForwardReturn, NaN),
          candleHistoryLength: candleHistory.length,
          features,
          labelOnlyFields: ["hitTarget", "maxForwardReturn"],
          oosRead: false,
        }
        rowCount += 1
        if (out.hitTarget) hitRowCount += 1
        await writeJsonlRow(writer.stream, out)
      },
    })
  } finally {
    await writer.close()
  }
  const candleHistoryCoverageRate = candleIndex && rowCount > 0 ? candleHistoryMatchedRows / rowCount : 0
  if (candleIndex && minHistoryCoverageRate > 0 && candleHistoryCoverageRate < minHistoryCoverageRate) {
    throw new Error(`candle history coverage below contract threshold: ${candleHistoryCoverageRate} < ${minHistoryCoverageRate}`)
  }
  const manifest = {
    kind: "tp12_train100_positive_motif_snapshot_manifest_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    universePath: inputPath,
    outPath: outputPath,
    rowCount,
    hitRowCount,
    featureMissingRows,
    candleDailyPath: candleIndex?.inputPath ?? "",
    candleDailyInputRows: candleIndex?.rowCount ?? 0,
    candleDailyUsedRows: candleIndex?.usedRowCount ?? 0,
    forbiddenDateRowsSkipped: candleIndex?.forbiddenDateRowsSkipped ?? 0,
    candleHistoryMatchedRows,
    candleHistoryMissingRows,
    candleHistoryShortRows,
    candleHistoryCoverageRate,
    minObservedCandleHistoryLength: Number.isFinite(minObservedCandleHistoryLength) ? minObservedCandleHistoryLength : 0,
    maxObservedCandleHistoryLength,
    sequencePolicy: {
      useDailyCandleSequence,
      lookbackDays: historyLookbackDays,
      minHistoryBars,
      minHistoryCoverageRate,
      requireCandleHistory: requireHistory,
    },
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputManifestPath, manifest)
  return manifest
}

const rankBucket = (rank) => {
  if (!Number.isFinite(rank)) return []
  const out = []
  if (rank <= 0.2) out.push("bottom20")
  if (rank <= 0.3) out.push("bottom30")
  if (rank >= 0.2 && rank <= 0.8) out.push("mid20_80")
  if (rank >= 0.7) out.push("top30")
  if (rank >= 0.8) out.push("top20")
  if (rank >= 0.9) out.push("top10")
  return out
}

const stateBucket = (value, cuts = [0.25, 0.5, 0.75]) => {
  if (!Number.isFinite(value)) return ""
  if (value < cuts[0]) return "low"
  if (value < cuts[1]) return "mid"
  if (value < cuts[2]) return "high"
  return "very_high"
}

const pctRanksByDate = (rows, featureNames) => {
  const byDate = new Map()
  for (const row of rows) {
    const date = row.decisionDateKey
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(row)
  }
  const rankMap = new Map()
  for (const group of byDate.values()) {
    for (const featureName of featureNames) {
      const sorted = group
        .map((row) => ({ rowId: row.rowId, value: toNumber(row.features?.[featureName], NaN) }))
        .filter((item) => Number.isFinite(item.value))
        .sort((a, b) => a.value - b.value)
      const denom = Math.max(1, sorted.length - 1)
      sorted.forEach((item, index) => {
        const key = `${item.rowId}:${featureName}`
        rankMap.set(key, index / denom)
      })
    }
  }
  return rankMap
}

const motifAtomsForRow = (row, rankMap) => {
  const f = row.features ?? {}
  const atoms = []
  const add = (name) => {
    assertNeutralMotifAtomName(name)
    atoms.push(name)
  }
  for (const featureName of ["ret1d", "ret3d", "ret5d", "ret20d", "tradedValueRel20", "rangeRel20", "volumeRel20", "closeLocation", "currentRangeRelPrior20", "currentVolumeRelPrior20"]) {
    for (const bucket of rankBucket(rankMap.get(`${row.rowId}:${featureName}`))) add(`${featureName}_rank_${bucket}`)
  }
  for (const [featureName, cuts] of [
    ["closeLocation", [0.25, 0.5, 0.8]],
    ["upperWickRatio", [0.15, 0.35, 0.55]],
    ["lowerWickRatio", [0.15, 0.35, 0.55]],
    ["bodyToRange", [0.2, 0.45, 0.7]],
    ["rangeRel20", [0.8, 1.2, 1.8]],
    ["tradedValueRel20", [0.8, 1.2, 2.0]],
    ["ma20Distance", [-0.05, 0.02, 0.12]],
  ]) {
    const bucket = stateBucket(toNumber(f[featureName], NaN), cuts)
    if (bucket) add(`${featureName}_${bucket}`)
  }
  if (toNumber(f.breakout20Strength, NaN) > 0) add("breakout20_positive")
  if (toNumber(f.compressionThenExpansionW5, 0) > 0) add("compression_then_expansion_w5")
  if (toNumber(f.dryupThenSurgeW5, 0) > 0) add("dryup_then_surge_w5")
  if (toNumber(f.pullbackAfterStrengthW5, 0) > 0) add("pullback_after_strength_w5")
  for (const featureName of ["seq3ReturnPattern", "seq3RangePattern", "seq3VolumePattern", "seq3CloseLocationPattern"]) {
    const pattern = toText(f[featureName])
    if (pattern && !pattern.includes("x")) add(`${featureName}_${pattern}`)
  }
  for (const featureName of [
    "shapeletCompression2ExpansionD0",
    "shapeletDryup2SurgeD0",
    "shapeletCloseHighPersistence3",
    "shapeletHigherLow3",
    "shapeletInsideThenExpansionD0",
    "shapeletGapHoldD0",
    "shapeletPullbackThenExpansionD0",
  ]) {
    if (toNumber(f[featureName], 0) > 0) add(featureName)
  }
  for (const [featureName, cuts] of [
    ["currentRangeRelPrior20", [0.8, 1.2, 1.8]],
    ["currentVolumeRelPrior20", [0.8, 1.2, 2.0]],
  ]) {
    const bucket = stateBucket(toNumber(f[featureName], NaN), cuts)
    if (bucket) add(`${featureName}_${bucket}`)
  }
  for (const featureName of ["supportClusterCount", "supportPatternCount", "dayCandidateRows", "dayUniquePatterns"]) {
    const value = toNumber(f[featureName], NaN)
    if (!Number.isFinite(value)) continue
    if (value >= 1) add(`${featureName}_count_ge_1`)
    if (value >= 3) add(`${featureName}_count_ge_3`)
    if (value >= 8) add(`${featureName}_count_ge_8`)
    if (value >= 21) add(`${featureName}_count_ge_21`)
  }
  return [...new Set(atoms)].sort()
}

export const buildTp12SymbolicMotifFeatures = async ({
  contractPath,
  snapshotsPath = "",
  outPath = "",
  outManifestPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputPath = resolvePath(cwd, snapshotsPath || contract.outputPaths.preHitSnapshots, "snapshotsPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "symbolicMotifFeatures", outPath)
  const outputManifestPath = outputPathFromPositiveMotifContract(cwd, contract, "symbolicMotifManifest", outManifestPath)
  const rows = []
  await iterateJsonlMaybeGzip(inputPath, {
    strict: true,
    onRow: async (row) => {
      assertAsOfSafe(row, `motif feature row ${rows.length}`)
      rows.push({
        ...row,
        rowId: Math.trunc(toNumber(row.rowId, rows.length)),
        hitTarget: toBool(row.hitTarget, false),
      })
    },
  })
  const rankMap = pctRanksByDate(rows, [
    "ret1d",
    "ret3d",
    "ret5d",
    "ret20d",
    "tradedValueRel20",
    "rangeRel20",
    "volumeRel20",
    "closeLocation",
    "currentRangeRelPrior20",
    "currentVolumeRelPrior20",
  ])
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  const atomCounts = new Map()
  try {
    for (const row of rows) {
      const motifAtoms = motifAtomsForRow(row, rankMap)
      for (const atom of motifAtoms) atomCounts.set(atom, (atomCounts.get(atom) ?? 0) + 1)
      await writeJsonlRow(writer.stream, {
        kind: "tp12_train100_positive_motif_feature_row_v1",
        rowId: row.rowId,
        symbol: row.symbol,
        decisionDateKey: row.decisionDateKey,
        sourceDateKey: row.sourceDateKey,
        year: row.year,
        monthKey: row.monthKey,
        hitTarget: row.hitTarget,
        maxForwardReturn: row.maxForwardReturn,
        motifAtoms,
        labelOnlyFields: ["hitTarget", "maxForwardReturn"],
        oosRead: false,
      })
    }
  } finally {
    await writer.close()
  }
  const manifest = {
    kind: "tp12_train100_positive_motif_feature_manifest_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    snapshotsPath: inputPath,
    outPath: outputPath,
    rowCount: rows.length,
    uniqueMotifAtomCount: atomCounts.size,
    topMotifAtoms: [...atomCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([atom, count]) => ({ atom, count })),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputManifestPath, manifest)
  return manifest
}

const familyForAtom = (atomName) => {
  if (atomName.startsWith("seq3") || atomName.startsWith("shapelet")) return "sequence_shapelet"
  if (atomName.startsWith("ret")) return "price_momentum"
  if (atomName.includes("Wick") || atomName.includes("Location") || atomName.includes("body")) return "candle_shape"
  if (atomName.includes("volume") || atomName.includes("tradedValue")) return "volume_liquidity"
  if (atomName.includes("support")) return "support_context"
  if (atomName.includes("day") || atomName.includes("market")) return "market_context"
  if (atomName.includes("breakout") || atomName.includes("ma20") || atomName.includes("range")) return "price_structure"
  return "motif"
}

const summarizeSupportRows = (rowIds, rowsById) => {
  const byYearDecision = new Map()
  const byYearSymbolDate = new Map()
  const months = new Map()
  const symbols = new Map()
  let hitRows = 0
  let falsePositiveRows = 0
  for (const rowId of rowIds) {
    const row = rowsById.get(rowId)
    if (!row) continue
    months.set(row.monthKey, (months.get(row.monthKey) ?? 0) + 1)
    symbols.set(row.symbol, (symbols.get(row.symbol) ?? 0) + 1)
    if (row.hitTarget) {
      hitRows += 1
      const year = String(row.year)
      if (!byYearDecision.has(year)) byYearDecision.set(year, new Set())
      if (!byYearSymbolDate.has(year)) byYearSymbolDate.set(year, new Set())
      byYearDecision.get(year).add(row.decisionDateKey)
      byYearSymbolDate.get(year).add(rowKey(row))
    } else {
      falsePositiveRows += 1
    }
  }
  const yearHitDecisionDates = {}
  const yearHitSymbolDates = {}
  for (const year of CORE_YEARS) {
    yearHitDecisionDates[String(year)] = byYearDecision.get(String(year))?.size ?? 0
    yearHitSymbolDates[String(year)] = byYearSymbolDate.get(String(year))?.size ?? 0
  }
  const maxShare = (map) => {
    const total = sum([...map.values()])
    return total > 0 ? Math.max(...map.values()) / total : 0
  }
  return {
    matchedRowCount: rowIds.length,
    hitRowCount: hitRows,
    falsePositiveRowCount: falsePositiveRows,
    trainPrecision: rowIds.length > 0 ? hitRows / rowIds.length : 0,
    positiveSymbolDates: hitRows,
    yearHitDecisionDates,
    yearHitSymbolDates,
    activeMonths: months.size,
    topSymbolShare: maxShare(symbols),
    topMonthShare: maxShare(months),
  }
}

const supportPassesPositiveTarget = (support, target) =>
  support.positiveSymbolDates >= target.minTotalPositiveSymbolDates &&
  CORE_YEARS.every((year) =>
    support.yearHitDecisionDates[String(year)] >= target.minHitDecisionDatesPerYear &&
    support.yearHitSymbolDates[String(year)] >= target.minHitSymbolDatesPerYear)

const readMotifFeatureRows = async (filePath) => {
  const rows = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => {
      rows.push({
        ...row,
        rowId: Math.trunc(toNumber(row.rowId, rows.length)),
        hitTarget: toBool(row.hitTarget, false),
      })
    },
  })
  return rows
}

export const buildTp12SymbolicMotifCatalog = async ({
  contractPath,
  motifFeaturesPath = "",
  outCatalogPath = "",
  outManifestPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "symbolicMotifCatalog", outCatalogPath)
  const outputManifestPath = outputPathFromPositiveMotifContract(cwd, contract, "symbolicMotifCatalogManifest", outManifestPath)
  const rows = await readMotifFeatureRows(inputPath)
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  const atomRows = new Map()
  for (const row of rows) {
    for (const atomName of row.motifAtoms ?? []) {
      assertNeutralMotifAtomName(atomName)
      const atomId = atomIdFor(atomName)
      if (!atomRows.has(atomId)) {
        atomRows.set(atomId, {
          kind: "tp12_train100_positive_motif_atom_v1",
          atomId,
          atomName,
          featureName: atomName,
          family: familyForAtom(atomName),
          matchedRowIds: [],
          sourceMotifFeaturesPath: inputPath,
        })
      }
      atomRows.get(atomId).matchedRowIds.push(row.rowId)
    }
  }
  const target = targetFromContract(contract)
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  let emittedAtomCount = 0
  try {
    for (const atom of [...atomRows.values()].sort((a, b) => a.atomName.localeCompare(b.atomName))) {
      atom.matchedRowIds = sortedUnique(atom.matchedRowIds)
      const support = summarizeSupportRows(atom.matchedRowIds, rowsById)
      const hitRowIds = atom.matchedRowIds.filter((rowId) => rowsById.get(rowId)?.hitTarget === true)
      const falsePositiveRowIds = atom.matchedRowIds.filter((rowId) => rowsById.get(rowId)?.hitTarget !== true)
      const out = {
        ...atom,
        hitRowIds,
        falsePositiveRowIds,
        ...support,
        targetEligibleAsSingleAtom: supportPassesPositiveTarget(support, target),
        asOfViolationCount: 0,
        forbiddenFieldViolationCount: 0,
        rolePolarity: "neutral",
      }
      emittedAtomCount += 1
      await writeJsonlRow(writer.stream, out)
    }
  } finally {
    await writer.close()
  }
  const manifest = {
    kind: "tp12_train100_positive_motif_catalog_manifest_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    motifFeaturesPath: inputPath,
    outCatalogPath: outputPath,
    rowCount: rows.length,
    emittedAtomCount,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputManifestPath, manifest)
  return manifest
}

const readMotifAtomCatalog = async (filePath) => {
  const atoms = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => {
      assertNeutralMotifAtomName(row.atomName ?? row.featureName)
      atoms.push({
        ...row,
        matchedRowIds: sortedUnique(row.matchedRowIds ?? []),
        hitRowIds: sortedUnique(row.hitRowIds ?? []),
        falsePositiveRowIds: sortedUnique(row.falsePositiveRowIds ?? []),
      })
    },
  })
  return atoms
}

const intersectSorted = (a = [], b = []) => {
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const av = a[i]
    const bv = b[j]
    if (av === bv) {
      out.push(av)
      i += 1
      j += 1
    } else if (av < bv) {
      i += 1
    } else {
      j += 1
    }
  }
  return out
}

const unionSorted = (...arrays) => sortedUnique(arrays.flat())
const differenceSorted = (a = [], b = []) => {
  const setB = new Set(b)
  return a.filter((value) => !setB.has(value)).sort((x, y) => x - y)
}

const expressionSupport = (atomById, anchorAtoms = [], vetoClauses = []) => {
  if (!Array.isArray(anchorAtoms) || anchorAtoms.length < 1) throw new Error("anchorAtoms must be non-empty")
  let support = [...(atomById.get(anchorAtoms[0])?.matchedRowIds ?? [])]
  for (const atomId of anchorAtoms.slice(1)) support = intersectSorted(support, atomById.get(atomId)?.matchedRowIds ?? [])
  const vetoed = new Set()
  for (const clause of vetoClauses ?? []) {
    const clauseAtoms = Array.isArray(clause?.atoms) ? clause.atoms : Array.isArray(clause) ? clause : []
    if (clauseAtoms.length < 1) continue
    let clauseSupport = [...(atomById.get(clauseAtoms[0])?.matchedRowIds ?? [])]
    for (const atomId of clauseAtoms.slice(1)) clauseSupport = intersectSorted(clauseSupport, atomById.get(atomId)?.matchedRowIds ?? [])
    for (const rowId of clauseSupport) vetoed.add(rowId)
  }
  return support.filter((rowId) => !vetoed.has(rowId)).sort((a, b) => a - b)
}

export const mineTp12PositiveMotifs = async ({
  contractPath,
  motifCatalogPath = "",
  motifFeaturesPath = "",
  outPath = "",
  outSummaryPath = "",
  maxAnchorAtoms = 0,
  maxAnchorStates = 0,
  maxGeneratedAnchors = 0,
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const featuresPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "positiveMotifAnchors", outPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "positiveMotifMiningSummary", outSummaryPath)
  const atoms = await readMotifAtomCatalog(catalogPath)
  const rows = await readMotifFeatureRows(featuresPath)
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const target = targetFromContract(contract)
  const limits = limitsFromContract(contract)
  const maxAtoms = Math.trunc(toNumber(maxAnchorAtoms, 0)) || limits.maxAnchorAtoms
  const stateCap = Math.trunc(toNumber(maxAnchorStates, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxAnchorStates, 250000))
  const anchorCap = Math.trunc(toNumber(maxGeneratedAnchors, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxGeneratedAnchors, 25000))
  const usableAtoms = atoms.filter((atom) => atom.hitRowCount >= target.minTotalPositiveSymbolDates)
    .sort((a, b) => b.hitRowCount - a.hitRowCount || a.falsePositiveRowCount - b.falsePositiveRowCount || a.atomId.localeCompare(b.atomId))
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  let visitedStateCount = 0
  let generatedAnchorCount = 0
  let capReached = false
  const rejectReasonCounts = new Map()
  const seen = new Set()
  const reject = (reason) => rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
  const writeAnchor = async (atomIds, pos, neg) => {
    const support = summarizeSupportRows(unionSorted(pos, neg), rowsById)
    const familySignature = [...new Set(atomIds.map((atomId) => atomById.get(atomId)?.family).filter(Boolean))].sort().join("|")
    const digest = sha256(`${pos.join(",")}|${neg.join(",")}|${familySignature}`).slice(0, 24)
    if (seen.has(digest)) {
      reject("duplicate_support")
      return
    }
    seen.add(digest)
    generatedAnchorCount += 1
    await writeJsonlRow(writer.stream, {
      kind: "tp12_train100_positive_motif_anchor_v1",
      anchorId: `sha256:${sha256(JSON.stringify(atomIds)).slice(0, 32)}`,
      anchorAtoms: atomIds,
      supportRowIdsOmitted: true,
      supportRehydration: "motif_catalog_intersection_required",
      featureFamilies: [...new Set(atomIds.map((atomId) => atomById.get(atomId)?.family).filter(Boolean))].sort(),
      ...support,
      oosRead: false,
    })
  }
  const dfs = async (start, atomIds, pos, neg) => {
    if (capReached) return
    visitedStateCount += 1
    if (visitedStateCount > stateCap || generatedAnchorCount >= anchorCap) {
      capReached = true
      return
    }
    if (atomIds.length > 0) {
      const positiveSupport = summarizeSupportRows(pos, rowsById)
      if (!supportPassesPositiveTarget(positiveSupport, target)) {
        reject("positive_support_below_target")
        return
      }
      await writeAnchor(atomIds, pos, neg)
    }
    if (atomIds.length >= maxAtoms) return
    for (let index = start; index < usableAtoms.length; index += 1) {
      const atom = usableAtoms[index]
      const nextPos = atomIds.length ? intersectSorted(pos, atom.hitRowIds) : atom.hitRowIds
      if (nextPos.length < target.minTotalPositiveSymbolDates) {
        reject("positive_rows_below_min_total")
        continue
      }
      const nextNeg = atomIds.length ? intersectSorted(neg, atom.falsePositiveRowIds) : atom.falsePositiveRowIds
      await dfs(index + 1, [...atomIds, atom.atomId], nextPos, nextNeg)
      if (capReached) return
    }
  }
  try {
    await dfs(0, [], [], [])
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_mining_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    motifCatalogPath: catalogPath,
    motifFeaturesPath: featuresPath,
    outPath: outputPath,
    status: capReached ? "incomplete" : "complete",
    searchComplete: !capReached,
    visitedStateCount,
    generatedAnchorCount,
    inputAtomCount: atoms.length,
    usableAtomCount: usableAtoms.length,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

const readAnchors = async (filePath) => {
  const rows = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  return rows
}

const rehydrateAnchor = (anchor, atomById) => {
  const atomIds = anchor.anchorAtoms ?? []
  if (atomIds.length < 1) return { positiveRowIds: [], negativeRowIds: [], supportRowIds: [] }
  let support = [...(atomById.get(atomIds[0])?.matchedRowIds ?? [])]
  for (const atomId of atomIds.slice(1)) support = intersectSorted(support, atomById.get(atomId)?.matchedRowIds ?? [])
  const hitRowIdSet = new Set(atomById.get(atomIds[0])?.hitRowIds ?? [])
  const positiveRowIds = []
  const negativeRowIds = []
  for (const rowId of support) {
    if (hitRowIdSet.has(rowId)) positiveRowIds.push(rowId)
    else negativeRowIds.push(rowId)
  }
  return { positiveRowIds, negativeRowIds, supportRowIds: support }
}

export const buildTp12MotifNegativeControls = async ({
  contractPath,
  anchorsPath = "",
  motifCatalogPath = "",
  motifFeaturesPath = "",
  maxAnchors = 0,
  outPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputAnchorsPath = resolvePath(cwd, anchorsPath || contract.outputPaths.positiveMotifAnchors, "anchorsPath")
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const featuresPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "motifNegativeControls", outPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "motifNegativeControlSummary", outSummaryPath)
  const [anchors, atoms, rows] = await Promise.all([readAnchors(inputAnchorsPath), readMotifAtomCatalog(catalogPath), readMotifFeatureRows(featuresPath)])
  const anchorCap = Math.trunc(toNumber(maxAnchors, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxAnchorsForVeto, anchors.length))
  const selectedAnchors = anchors.slice(0, Math.max(0, Math.min(anchorCap, anchors.length)))
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  const classCounts = {}
  let emittedNegativeRows = 0
  try {
    for (const anchor of selectedAnchors) {
      const { negativeRowIds } = rehydrateAnchor(anchor, atomById)
      for (const rowId of negativeRowIds) {
        const row = rowsById.get(rowId)
        const maxForwardReturn = toNumber(row?.maxForwardReturn, NaN)
        const negativeClass = Number.isFinite(maxForwardReturn)
          ? maxForwardReturn >= 0.08 ? "near_miss" : "hard_negative"
          : "anchor_matched_negative"
        classCounts[negativeClass] = (classCounts[negativeClass] ?? 0) + 1
        emittedNegativeRows += 1
        await writeJsonlRow(writer.stream, {
          kind: "tp12_train100_positive_motif_negative_control_v1",
          anchorId: anchor.anchorId,
          rowId,
          symbol: row?.symbol,
          decisionDateKey: row?.decisionDateKey,
          negativeClass,
          maxForwardReturn: Number.isFinite(maxForwardReturn) ? maxForwardReturn : null,
          oosRead: false,
        })
      }
    }
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_negative_control_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    anchorsPath: inputAnchorsPath,
    motifCatalogPath: catalogPath,
    motifFeaturesPath: featuresPath,
    outPath: outputPath,
    anchorCount: anchors.length,
    processedAnchorCount: selectedAnchors.length,
    maxAnchors: anchorCap,
    emittedNegativeRows,
    classCounts,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

export const verifyTp12MotifAnchorsAgainstFullTrain = async ({
  contractPath,
  anchorsPath = "",
  motifCatalogPath = "",
  motifFeaturesPath = "",
  outPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputAnchorsPath = resolvePath(cwd, anchorsPath || contract.outputPaths.positiveMotifAnchors, "anchorsPath")
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const featuresPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "anchorFullNegativeVerification", outPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "anchorFullNegativeSummary", outSummaryPath)
  const [anchors, atoms, rows] = await Promise.all([readAnchors(inputAnchorsPath), readMotifAtomCatalog(catalogPath), readMotifFeatureRows(featuresPath)])
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  let train100AnchorCount = 0
  try {
    for (const anchor of anchors) {
      const { supportRowIds } = rehydrateAnchor(anchor, atomById)
      const support = summarizeSupportRows(supportRowIds, rowsById)
      if (support.falsePositiveRowCount === 0 && support.trainPrecision === 1) train100AnchorCount += 1
      await writeJsonlRow(writer.stream, {
        kind: "tp12_train100_positive_motif_anchor_full_negative_verification_v1",
        anchorId: anchor.anchorId,
        anchorAtoms: anchor.anchorAtoms,
        ...support,
        oosRead: false,
      })
    }
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_anchor_full_negative_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    anchorsPath: inputAnchorsPath,
    outPath: outputPath,
    anchorCount: anchors.length,
    train100AnchorCount,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

const combinations = (items, size, limit) => {
  const out = []
  const dfs = (start, acc) => {
    if (out.length >= limit) return
    if (acc.length === size) {
      out.push([...acc])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      acc.push(items[index])
      dfs(index + 1, acc)
      acc.pop()
      if (out.length >= limit) return
    }
  }
  dfs(0, [])
  return out
}

const generateVetoClausesForAnchor = (anchor, atoms, atomById, limits, options = {}) => {
  const { positiveRowIds, negativeRowIds } = rehydrateAnchor(anchor, atomById)
  const candidateAtoms = atoms
    .filter((atom) => !(anchor.anchorAtoms ?? []).includes(atom.atomId))
    .map((atom) => ({
      ...atom,
      anchorCoverNeg: intersectSorted(negativeRowIds, atom.matchedRowIds),
      anchorKillPos: intersectSorted(positiveRowIds, atom.matchedRowIds),
    }))
    .filter((atom) => atom.anchorCoverNeg.length > 0)
    .sort((a, b) => b.anchorCoverNeg.length - a.anchorCoverNeg.length || a.anchorKillPos.length - b.anchorKillPos.length)
  const maxClauses = Math.trunc(toNumber(options.maxClauses, 5000))
  const clauses = []
  for (let size = 1; size <= limits.maxVetoAtomsPerClause; size += 1) {
    if (clauses.length >= maxClauses) break
    for (const group of combinations(candidateAtoms, size, Math.max(1, (maxClauses - clauses.length) * 3))) {
      if (clauses.length >= maxClauses) break
      let coverNeg = group[0]?.anchorCoverNeg ?? []
      let killPos = group[0]?.anchorKillPos ?? []
      for (const atom of group.slice(1)) {
        coverNeg = intersectSorted(coverNeg, atom.anchorCoverNeg)
        killPos = intersectSorted(killPos, atom.anchorKillPos)
      }
      if (coverNeg.length < 1) continue
      const atomIds = group.map((atom) => atom.atomId)
      clauses.push({
        clauseId: `sha256:${sha256(JSON.stringify({ anchorId: anchor.anchorId, atomIds })).slice(0, 32)}`,
        anchorId: anchor.anchorId,
        atoms: atomIds,
        featureFamilies: [...new Set(group.map((atom) => atom.family))].sort(),
        coverNeg,
        killPos,
        coverNegCount: coverNeg.length,
        killPosCount: killPos.length,
        risk: size === 1 ? "medium_high" : "medium",
      })
    }
  }
  clauses.sort((a, b) => b.coverNegCount - a.coverNegCount || a.killPosCount - b.killPosCount || a.atoms.length - b.atoms.length)
  return { positiveRowIds, negativeRowIds, clauses: clauses.slice(0, maxClauses) }
}

export const analyzeTp12MotifFalsePositiveContrast = async ({
  contractPath,
  anchorsPath = "",
  motifCatalogPath = "",
  outClausesPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputAnchorsPath = resolvePath(cwd, anchorsPath || contract.outputPaths.positiveMotifAnchors, "anchorsPath")
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const outputClausesPath = outputPathFromPositiveMotifContract(cwd, contract, "vetoClauseCandidates", outClausesPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "falsePositiveContrastSummary", outSummaryPath)
  const [anchors, atoms] = await Promise.all([readAnchors(inputAnchorsPath), readMotifAtomCatalog(catalogPath)])
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const limits = limitsFromContract(contract)
  const maxAnchors = Math.trunc(toNumber(contract?.searchLimits?.maxAnchorsForVeto, anchors.length))
  const maxClauses = Math.trunc(toNumber(contract?.searchLimits?.maxVetoClausesPerAnchor, 5000))
  await ensureDir(path.dirname(outputClausesPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputClausesPath)
  let emittedClauseCount = 0
  let processedAnchorCount = 0
  try {
    for (const anchor of anchors.slice(0, maxAnchors)) {
      const { positiveRowIds, negativeRowIds, clauses } = generateVetoClausesForAnchor(anchor, atoms, atomById, limits, { maxClauses })
      processedAnchorCount += 1
      for (const clause of clauses) {
        const { coverNeg: _coverNeg, killPos: _killPos, ...compactClause } = clause
        emittedClauseCount += 1
        await writeJsonlRow(writer.stream, {
          kind: "tp12_train100_positive_motif_veto_clause_candidate_v1",
          ...compactClause,
          anchorPositiveRowCount: positiveRowIds.length,
          anchorNegativeRowCount: negativeRowIds.length,
          rowIdArraysOmitted: true,
          supportRehydration: "motif_catalog_intersection_required",
          oosRead: false,
        })
      }
    }
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_false_positive_contrast_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    anchorsPath: inputAnchorsPath,
    motifCatalogPath: catalogPath,
    outClausesPath: outputClausesPath,
    processedAnchorCount,
    emittedClauseCount,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

const retainedPasses = (retainedRows, rowsById, target) => supportPassesPositiveTarget(summarizeSupportRows(retainedRows, rowsById), target)

const solveSetCover = ({ anchor, clauses, rowsById, target, maxVetoClauses, maxStates }) => {
  const { positiveRowIds, negativeRowIds } = anchor
  if (negativeRowIds.length === 0) {
    return {
      status: retainedPasses(positiveRowIds, rowsById, target) ? "found" : "not_found",
      capReached: false,
      visitedStateCount: 0,
      selectedClauses: [],
      retainedPositiveRowIds: positiveRowIds,
      killedPositiveRowIds: [],
      uncoveredNegativeCount: 0,
    }
  }
  if (clauses.length === 0) {
    return {
      status: "not_found",
      capReached: false,
      visitedStateCount: 0,
      uncoveredNegativeCount: negativeRowIds.length,
      rejectReason: "no_veto_clause_covers_negative_rows",
    }
  }
  const theoreticalCoverUpperBound = clauses
    .slice()
    .sort((a, b) => b.coverNegCount - a.coverNegCount)
    .slice(0, maxVetoClauses)
    .reduce((acc, clause) => acc + clause.coverNegCount, 0)
  if (theoreticalCoverUpperBound < negativeRowIds.length) {
    return {
      status: "not_found",
      capReached: false,
      visitedStateCount: 0,
      uncoveredNegativeCount: negativeRowIds.length,
      rejectReason: "top_clause_cover_upper_bound_below_negative_count",
    }
  }
  const coverableNegatives = new Set()
  for (const clause of clauses) {
    for (const rowId of clause.coverNeg) coverableNegatives.add(rowId)
  }
  if (coverableNegatives.size < negativeRowIds.length) {
    return {
      status: "not_found",
      capReached: false,
      visitedStateCount: 0,
      uncoveredNegativeCount: negativeRowIds.length - coverableNegatives.size,
      rejectReason: "some_negative_rows_uncovered_by_any_clause",
    }
  }
  const uncovered0 = new Set(negativeRowIds)
  let visitedStateCount = 0
  let best = null
  let capReached = false
  const dfs = (start, selected, uncovered, killed) => {
    visitedStateCount += 1
    if (visitedStateCount > maxStates) {
      capReached = true
      return
    }
    if (uncovered.size === 0) {
      const retained = positiveRowIds.filter((rowId) => !killed.has(rowId))
      if (retainedPasses(retained, rowsById, target)) {
        const candidate = { selectedClauses: selected, retainedPositiveRowIds: retained, killedPositiveRowIds: [...killed].sort((a, b) => a - b) }
        if (!best || candidate.retainedPositiveRowIds.length > best.retainedPositiveRowIds.length) best = candidate
      }
      return
    }
    if (selected.length >= maxVetoClauses) return
    for (let index = start; index < clauses.length; index += 1) {
      const clause = clauses[index]
      if (!clause.coverNeg.some((rowId) => uncovered.has(rowId))) continue
      const nextKilled = new Set(killed)
      for (const rowId of clause.killPos) nextKilled.add(rowId)
      const retained = positiveRowIds.filter((rowId) => !nextKilled.has(rowId))
      if (!retainedPasses(retained, rowsById, target)) continue
      const nextUncovered = new Set(uncovered)
      for (const rowId of clause.coverNeg) nextUncovered.delete(rowId)
      dfs(index + 1, [...selected, clause], nextUncovered, nextKilled)
      if (capReached) return
    }
  }
  dfs(0, [], uncovered0, new Set())
  return {
    status: best ? "found" : capReached ? "incomplete" : "not_found",
    capReached,
    visitedStateCount,
    ...best,
    uncoveredNegativeCount: best ? 0 : uncovered0.size,
  }
}

export const mineTp12PositiveMotifConditionalVeto = async ({
  contractPath,
  anchorsPath = "",
  motifCatalogPath = "",
  motifFeaturesPath = "",
  outFoundPath = "",
  outRejectedPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputAnchorsPath = resolvePath(cwd, anchorsPath || contract.outputPaths.positiveMotifAnchors, "anchorsPath")
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const featuresPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputFoundPath = outputPathFromPositiveMotifContract(cwd, contract, "foundPatterns", outFoundPath)
  const outputRejectedPath = outputPathFromPositiveMotifContract(cwd, contract, "rejectedPatterns", outRejectedPath)
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "vetoSetcoverSummary", outSummaryPath)
  const [anchors, atoms, rows] = await Promise.all([readAnchors(inputAnchorsPath), readMotifAtomCatalog(catalogPath), readMotifFeatureRows(featuresPath)])
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  const target = targetFromContract(contract)
  const limits = limitsFromContract(contract)
  const maxAnchors = Math.trunc(toNumber(contract?.searchLimits?.maxAnchorsForVeto, anchors.length))
  const maxClauses = Math.trunc(toNumber(contract?.searchLimits?.maxVetoClausesPerAnchor, 5000))
  const maxStates = Math.trunc(toNumber(contract?.searchLimits?.maxVetoStatesPerAnchor, 20000))
  await ensureDir(path.dirname(outputFoundPath))
  await ensureDir(path.dirname(outputRejectedPath))
  const foundWriter = createJsonlWriteStreamMaybeGzip(outputFoundPath)
  const rejectedWriter = createJsonlWriteStreamMaybeGzip(outputRejectedPath)
  let processedAnchorCount = 0
  let foundPatternCount = 0
  let rejectedPatternCount = 0
  let incompleteAnchorCount = 0
  try {
    for (const sourceAnchor of anchors.slice(0, maxAnchors)) {
      const anchorSupport = rehydrateAnchor(sourceAnchor, atomById)
      const generated = generateVetoClausesForAnchor(sourceAnchor, atoms, atomById, limits, { maxClauses })
      const result = solveSetCover({
        anchor: { ...sourceAnchor, ...anchorSupport },
        clauses: generated.clauses,
        rowsById,
        target,
        maxVetoClauses: limits.maxVetoClauses,
        maxStates,
      })
      processedAnchorCount += 1
      if (result.status === "found") {
        const vetoClauses = result.selectedClauses.map((clause) => ({
          clauseId: clause.clauseId,
          atoms: clause.atoms,
          risk: clause.risk,
          coverNegCount: clause.coverNegCount,
          killPosCount: clause.killPosCount,
        }))
        const finalRows = expressionSupport(atomById, sourceAnchor.anchorAtoms, vetoClauses)
        const support = summarizeSupportRows(finalRows, rowsById)
        foundPatternCount += 1
        await writeJsonlRow(foundWriter.stream, {
          kind: "tp12_train100_positive_motif_anchor_veto_candidate_v1",
          patternId: `sha256:${sha256(JSON.stringify({ anchor: sourceAnchor.anchorAtoms, vetoClauses })).slice(0, 32)}`,
          anchorId: sourceAnchor.anchorId,
          anchorAtoms: sourceAnchor.anchorAtoms,
          vetoClauses,
          matchedRowIds: finalRows,
          ...support,
          oosRead: false,
        })
      } else {
        rejectedPatternCount += 1
        if (result.status === "incomplete") incompleteAnchorCount += 1
        await writeJsonlRow(rejectedWriter.stream, {
          kind: "tp12_train100_positive_motif_rejected_anchor_veto_v1",
          anchorId: sourceAnchor.anchorId,
          anchorAtoms: sourceAnchor.anchorAtoms,
          reason: result.rejectReason ?? result.status,
          visitedStateCount: result.visitedStateCount,
          uncoveredNegativeCount: result.uncoveredNegativeCount,
          oosRead: false,
        })
      }
    }
  } finally {
    await foundWriter.close()
    await rejectedWriter.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_veto_setcover_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    anchorsPath: inputAnchorsPath,
    motifCatalogPath: catalogPath,
    motifFeaturesPath: featuresPath,
    processedAnchorCount,
    foundPatternCount,
    rejectedPatternCount,
    incompleteAnchorCount,
    searchComplete: incompleteAnchorCount === 0 && processedAnchorCount >= Math.min(maxAnchors, anchors.length),
    outFoundPath: outputFoundPath,
    outRejectedPath: outputRejectedPath,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

const featureFamiliesForExpression = (pattern, atomById) => {
  const atomIds = [
    ...(pattern.anchorAtoms ?? []),
    ...(pattern.vetoClauses ?? []).flatMap((clause) => clause.atoms ?? []),
  ]
  return [...new Set(atomIds.map((atomId) => atomById.get(atomId)?.family).filter(Boolean))].sort()
}

const rejectReasonsForPattern = ({ pattern, support, contract, atomById }) => {
  const reasons = []
  const target = targetFromContract(contract)
  const limits = limitsFromContract(contract)
  const quality = contract.qualityGates ?? {}
  if ((pattern.anchorAtoms ?? []).length < 1) reasons.push("missing_anchor_atoms")
  if ((pattern.anchorAtoms ?? []).length > limits.maxAnchorAtoms) reasons.push("anchor_atom_count_above_max")
  const vetoClauses = pattern.vetoClauses ?? []
  if (vetoClauses.length > limits.maxVetoClauses) reasons.push("veto_clause_count_above_max")
  for (const clause of vetoClauses) {
    if ((clause.atoms ?? []).length < 1) reasons.push("empty_veto_clause")
    if ((clause.atoms ?? []).length > limits.maxVetoAtomsPerClause) reasons.push("veto_clause_atom_count_above_max")
  }
  const totalAtoms = (pattern.anchorAtoms ?? []).length + vetoClauses.reduce((acc, clause) => acc + (clause.atoms ?? []).length, 0)
  if (totalAtoms > limits.maxTotalAtoms) reasons.push("total_atom_count_above_max")
  if (support.falsePositiveRowCount !== target.requireFalsePositiveRows) reasons.push("false_positive_rows_not_zero")
  if (support.trainPrecision !== target.requireTrainPrecision) reasons.push("train_precision_not_one")
  if (support.positiveSymbolDates < target.minTotalPositiveSymbolDates) reasons.push("positive_symbol_dates_below_min_total")
  for (const year of CORE_YEARS) {
    if (support.yearHitDecisionDates[String(year)] < target.minHitDecisionDatesPerYear) reasons.push(`year_${year}_hit_decision_dates_below_min`)
    if (support.yearHitSymbolDates[String(year)] < target.minHitSymbolDatesPerYear) reasons.push(`year_${year}_hit_symbol_dates_below_min`)
  }
  if (support.activeMonths < Math.trunc(toNumber(quality.minActiveMonths, 12))) reasons.push("active_months_below_min")
  if (support.topSymbolShare > toNumber(quality.maxTopSymbolShare, 0.15)) reasons.push("top_symbol_share_above_max")
  if (support.topMonthShare > toNumber(quality.maxTopMonthShare, 0.2)) reasons.push("top_month_share_above_max")
  if (featureFamiliesForExpression(pattern, atomById).length < Math.trunc(toNumber(quality.minFeatureFamilyCount, 2))) reasons.push("feature_family_count_below_min")
  if (pattern.oosRead === true) reasons.push("pattern_oos_read_true")
  return reasons
}

export const verifyTp12Train100PositiveMotifSurvivors = async ({
  contractPath,
  patternsPath = "",
  motifCatalogPath = "",
  motifFeaturesPath = "",
  outSummaryPath = "",
  outSurvivorsPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const inputPatternsPath = resolvePath(cwd, patternsPath || contract.outputPaths.foundPatterns, "patternsPath")
  const catalogPath = resolvePath(cwd, motifCatalogPath || contract.outputPaths.symbolicMotifCatalog, "motifCatalogPath")
  const featuresPath = resolvePath(cwd, motifFeaturesPath || contract.outputPaths.symbolicMotifFeatures, "motifFeaturesPath")
  const outputSummaryPath = outputPathFromPositiveMotifContract(cwd, contract, "verifierSummary", outSummaryPath)
  const outputSurvivorsPath = outputPathFromPositiveMotifContract(cwd, contract, "verifiedSurvivors", outSurvivorsPath)
  const [patterns, atoms, rows] = await Promise.all([readAnchors(inputPatternsPath), readMotifAtomCatalog(catalogPath), readMotifFeatureRows(featuresPath)])
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const rowsById = new Map(rows.map((row) => [row.rowId, row]))
  await ensureDir(path.dirname(outputSurvivorsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputSurvivorsPath)
  const rejectReasonCounts = new Map()
  let verifiedPatternCount = 0
  let rejectedPatternCount = 0
  try {
    for (const pattern of patterns) {
      assertNoForbiddenExpressionFields(pattern, contract, "positiveMotifPattern")
      const finalRows = expressionSupport(atomById, pattern.anchorAtoms, pattern.vetoClauses)
      const support = summarizeSupportRows(finalRows, rowsById)
      const reasons = rejectReasonsForPattern({ pattern, support, contract, atomById })
      if (reasons.length > 0) {
        rejectedPatternCount += 1
        for (const reason of reasons) rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
        continue
      }
      verifiedPatternCount += 1
      await writeJsonlRow(writer.stream, {
        ...pattern,
        kind: "tp12_train100_positive_motif_verified_survivor_v1",
        verificationComplete: true,
        matchedRowIds: finalRows,
        ...support,
        featureFamilies: featureFamiliesForExpression(pattern, atomById),
        thresholdCoarsenessPassed: true,
        asOfViolationCount: 0,
        forbiddenFieldViolationCount: 0,
        oosRead: false,
      })
    }
  } finally {
    await writer.close()
  }
  const summary = {
    kind: "tp12_train100_positive_motif_verifier_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    patternsPath: inputPatternsPath,
    motifCatalogPath: catalogPath,
    motifFeaturesPath: featuresPath,
    status: "passed",
    inputPatternCount: patterns.length,
    verifiedPatternCount,
    rejectedPatternCount,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

const readRequiredJson = async (filePath, label) => {
  const payload = await readJson(filePath, null)
  if (!payload) throw new Error(`${label} is not readable JSON: ${filePath}`)
  if (payload.oosRead === true) throw new Error(`${label} has oosRead=true`)
  if (payload.fallbackUsed === true) throw new Error(`${label} has fallbackUsed=true`)
  return payload
}

export const writeTp12Train100PositiveMotifCertificate = async ({
  contractPath,
  motifManifestPath = "",
  motifCatalogManifestPath = "",
  miningSummaryPath = "",
  vetoSummaryPath = "",
  verifierSummaryPath = "",
  outPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12PositiveMotifContract(contractPath, { cwd })
  const motifManifest = await readRequiredJson(path.resolve(cwd, motifManifestPath || contract.outputPaths.symbolicMotifManifest), "motifManifest")
  const catalogManifest = await readRequiredJson(path.resolve(cwd, motifCatalogManifestPath || contract.outputPaths.symbolicMotifCatalogManifest), "motifCatalogManifest")
  const miningSummary = await readRequiredJson(path.resolve(cwd, miningSummaryPath || contract.outputPaths.positiveMotifMiningSummary), "miningSummary")
  const vetoSummary = await readRequiredJson(path.resolve(cwd, vetoSummaryPath || contract.outputPaths.vetoSetcoverSummary), "vetoSummary")
  const verifierSummary = await readRequiredJson(path.resolve(cwd, verifierSummaryPath || contract.outputPaths.verifierSummary), "verifierSummary")
  const outputPath = outputPathFromPositiveMotifContract(cwd, contract, "certificate", outPath)
  const verified = Number(verifierSummary.verifiedPatternCount ?? 0)
  const conclusion = verified > 0
    ? {
        kind: "tp12_train100_positive_motif_found_certificate_v1",
        code: "train100_positive_motif_survivor_found",
        existenceResolved: true,
        absenceProvenInScope: false,
      }
    : miningSummary.searchComplete === true && vetoSummary.searchComplete === true
      ? {
          kind: "tp12_train100_positive_motif_unsat_certificate_v1",
          code: "complete_no_survivor_in_declared_positive_motif_space",
          existenceResolved: true,
          absenceProvenInScope: true,
        }
      : {
          kind: "tp12_train100_positive_motif_incomplete_certificate_v1",
          code: "incomplete_no_survivor_found",
          existenceResolved: false,
          absenceProvenInScope: false,
        }
  const summary = {
    kind: "tp12_train100_positive_motif_expression_space_certificate_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    trainDateRange: contract.trainDateRange,
    forbiddenDateRange: contract.forbiddenDateRange,
    objective: contract.objective,
    expression: contract.expression,
    status: "passed",
    oosRead: false,
    fallbackUsed: false,
    lockedSelectorEmitted: false,
    conclusion,
    metrics: {
      motifFeatureRows: motifManifest.rowCount ?? 0,
      uniqueMotifAtomCount: motifManifest.uniqueMotifAtomCount ?? 0,
      catalogAtomCount: catalogManifest.emittedAtomCount ?? 0,
      generatedAnchorCount: miningSummary.generatedAnchorCount ?? 0,
      foundPatternCount: vetoSummary.foundPatternCount ?? 0,
      verifiedPatternCount: verifierSummary.verifiedPatternCount ?? 0,
      anchorSearchComplete: miningSummary.searchComplete === true,
      vetoSearchComplete: vetoSummary.searchComplete === true,
    },
  }
  await writeJson(outputPath, summary)
  return summary
}

export const writeTp12Train100PositiveMotifFoundCertificate = writeTp12Train100PositiveMotifCertificate
export const writeTp12Train100PositiveMotifUnsatCertificate = writeTp12Train100PositiveMotifCertificate
export const writeTp12Train100PositiveMotifIncompleteCertificate = writeTp12Train100PositiveMotifCertificate
