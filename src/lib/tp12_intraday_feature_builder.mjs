import path from "node:path"

import { compareDateKey, normalizeDateKey } from "./date.mjs"
import { ensureDir, iterateJsonl, pathExists, writeJson, writeJsonl } from "./io.mjs"


export const TP12_INTRADAY_FEATURE_DATASET_KIND = "tp12_intraday_feature_dataset_v1"

export const TP12_INTRADAY_GATE_SPECS = [
  {
    gateId: "d0_close",
    decisionCutoff: { dateRef: "d0", time: "15:30:00" },
    entryMode: "next_day_open",
  },
  {
    gateId: "d1_0905",
    decisionCutoff: { dateRef: "d1", time: "09:05:00" },
    entryMode: "cutoff_close",
  },
  {
    gateId: "d1_0915",
    decisionCutoff: { dateRef: "d1", time: "09:15:00" },
    entryMode: "cutoff_close",
  },
  {
    gateId: "d1_0930",
    decisionCutoff: { dateRef: "d1", time: "09:30:00" },
    entryMode: "cutoff_close",
  },
]

const DEFAULT_MINUTE_CACHE_DATE_LIMIT = 16
const MINUTE_PART_BASENAME = "part-000.jsonl"
const SIDE_DATASET_IDS = ["investor_daily", "program_daily", "trade_strength_daily"]

const SIDE_VALUE_CANDIDATES = {
  investor_daily: ["ind_invsr", "ind_netprps_amt", "ind_netprps_qty"],
  program_daily: ["prm_netprps_amt", "prm_netprps_qty"],
  trade_strength_daily: ["cntr_str", "tday_cntr_str"],
}

const toText = (value) => String(value ?? "").trim()

const toNumber = (value) => {
  const text = String(value ?? "").replaceAll(",", "").trim()
  if (!text) return null
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric : null
}

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, dateKey) => `${symbol}::${dateKey}`

const minutePartitionPath = (minuteRoot, dateKey) => path.join(minuteRoot, `date=${dateKey}`, MINUTE_PART_BASENAME)

const isoTsForDateTime = (dateKey, timeText) => `${assertDateKey(dateKey, "dateKey")}T${String(timeText).trim()}+09:00`

const parseTsMs = (tsKst) => {
  const tsMs = Date.parse(String(tsKst ?? ""))
  if (!Number.isFinite(tsMs)) {
    throw new Error(`Invalid tsKst: ${tsKst ?? "<null>"}`)
  }
  return tsMs
}

const safeDiv = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return 0
  return numerator / denominator
}

const percentFromBase = (value, base) => safeDiv(Number(value) - Number(base), Number(base))

const sum = (values) => (Array.isArray(values) ? values : []).reduce((acc, value) => acc + Number(value || 0), 0)

const maxValue = (values) => {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value))
  return filtered.length > 0 ? Math.max(...filtered) : null
}

const minValue = (values) => {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value))
  return filtered.length > 0 ? Math.min(...filtered) : null
}

const chooseBestPolicy = (returnsByPolicy) => {
  const policyOrder = ["delay1_4d", "touch_anchor", "stop_first", "abstain"]
  const candidates = policyOrder
    .map((policyId) => ({ policyId, netRet: returnsByPolicy[policyId] }))
    .filter((entry) => Number.isFinite(entry.netRet))
  if (candidates.length < 1) {
    return {
      bestPolicyChoice: null,
      bestPolicyNetRet: null,
    }
  }
  candidates.sort((left, right) => {
    if (right.netRet !== left.netRet) return right.netRet - left.netRet
    return policyOrder.indexOf(left.policyId) - policyOrder.indexOf(right.policyId)
  })
  return {
    bestPolicyChoice: candidates[0].policyId,
    bestPolicyNetRet: candidates[0].netRet,
  }
}

const readManifestRows = async (manifestPath, { decisionFrom = null, decisionTo = null } = {}) => {
  if (!pathExists(manifestPath)) {
    throw new Error(`Missing manifest path: ${manifestPath}`)
  }
  const rows = []
  await iterateJsonl(manifestPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const requestId = toText(row?.requestId)
      const decisionDateKey = assertDateKey(row?.decisionDateKey, "manifest decisionDateKey")
      if (decisionFrom && decisionDateKey < decisionFrom) return
      if (decisionTo && decisionDateKey > decisionTo) return
      const prevDateKey = assertDateKey(row?.prevDateKey, "manifest prevDateKey")
      const asOfDateKey = assertDateKey(row?.asOfDateKey ?? prevDateKey, "manifest asOfDateKey")
      const stepALaneId = toText(row?.stepALaneId)
      const runId = toText(row?.runId)
      const eventLabel = toText(row?.eventLabel)
      const windowDateKeys = Array.from(new Set((Array.isArray(row?.windowDateKeys) ? row.windowDateKeys : []).map((value) => assertDateKey(value, "manifest windowDateKey")))).sort(compareDateKey)
      if (!symbol || !requestId || !stepALaneId || !runId || !eventLabel) {
        throw new Error(`Malformed manifest row missing identifiers for symbol=${symbol || "<empty>"} decision=${decisionDateKey}`)
      }
      if (windowDateKeys.length < 6) {
        throw new Error(`Manifest row requires full D-1..D+4 window for ${requestId}`)
      }
      if (windowDateKeys[0] !== prevDateKey || windowDateKeys[1] !== decisionDateKey) {
        throw new Error(`Manifest row date contract mismatch for ${requestId}`)
      }
      rows.push({
        requestId,
        symbol,
        decisionDateKey,
        prevDateKey,
        asOfDateKey,
        stepALaneId,
        runId,
        eventLabel,
        highJumpThreshold: Number(row?.highJumpThreshold ?? NaN),
        highJumpMode: toText(row?.highJumpMode),
        impulseSourceDateKey: assertDateKey(row?.impulseSourceDateKey, "manifest impulseSourceDateKey"),
        impulseLookbackDays: Number(row?.impulseLookbackDays ?? NaN),
        recentImpulseLookbackTradingDays: Number(row?.recentImpulseLookbackTradingDays ?? NaN),
        windowDateKeys: windowDateKeys.slice(0, 6),
      })
    },
  })
  if (rows.length < 1) {
    throw new Error(`No manifest rows loaded from ${manifestPath}`)
  }
  rows.sort((left, right) => {
    const dateCmp = left.decisionDateKey.localeCompare(right.decisionDateKey)
    if (dateCmp !== 0) return dateCmp
    const symbolCmp = left.symbol.localeCompare(right.symbol)
    if (symbolCmp !== 0) return symbolCmp
    return left.requestId.localeCompare(right.requestId)
  })
  return rows
}

const buildRequestedSets = (manifestRows) => {
  const symbolSet = new Set()
  const requestedDateSet = new Set()
  const requestedPairSet = new Set()
  for (const row of manifestRows) {
    symbolSet.add(row.symbol)
    for (const dateKey of row.windowDateKeys) {
      requestedDateSet.add(dateKey)
      requestedPairSet.add(pairKey(row.symbol, dateKey))
    }
  }
  return {
    symbolSet,
    requestedDateSet,
    requestedPairSet,
  }
}

const loadPresenceIndex = async (presencePath, requestedPairSet) => {
  if (!pathExists(presencePath)) {
    throw new Error(`Missing minute presence path: ${presencePath}`)
  }
  const presence = new Map()
  await iterateJsonl(presencePath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const tradingDateKey = assertDateKey(row?.tradingDateKey, "presence tradingDateKey")
      const key = pairKey(symbol, tradingDateKey)
      if (!requestedPairSet.has(key)) return
      if (presence.has(key)) {
        throw new Error(`Duplicate minute presence row for ${key}`)
      }
      const status = toText(row?.status)
      if (status !== "completed") {
        throw new Error(`Minute presence row is not completed for ${key}: ${status || "<empty>"}`)
      }
      presence.set(key, {
        symbol,
        tradingDateKey,
        barCount: Number(row?.barCount ?? NaN),
        firstTsKst: toText(row?.firstTsKst),
        lastTsKst: toText(row?.lastTsKst),
        status,
        source: toText(row?.source),
      })
    },
  })
  for (const key of requestedPairSet) {
    if (!presence.has(key)) {
      throw new Error(`Missing minute presence coverage for ${key}`)
    }
  }
  return presence
}

const loadSideDailyIndex = async (datasetId, filePath, symbolSet) => {
  if (!pathExists(filePath)) {
    throw new Error(`Missing side-daily canonical file for ${datasetId}: ${filePath}`)
  }
  const candidateFields = SIDE_VALUE_CANDIDATES[datasetId]
  if (!candidateFields) {
    throw new Error(`Unsupported side-daily dataset for feature builder: ${datasetId}`)
  }
  const bySymbol = new Map()
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      const dataset = toText(row?.dataset)
      if (dataset && dataset !== datasetId) {
        throw new Error(`Dataset mismatch inside ${filePath}: expected ${datasetId} got ${dataset}`)
      }
      const symbol = toText(row?.symbol)
      if (!symbolSet.has(symbol)) return
      const dateKey = assertDateKey(row?.dateKey, `${datasetId} dateKey`)
      const rawRow = row?.rawRow ?? {}
      let numericValue = null
      for (const field of candidateFields) {
        numericValue = toNumber(rawRow?.[field])
        if (numericValue !== null) break
      }
      if (numericValue === null) {
        throw new Error(`${datasetId} row missing supported numeric field for ${symbol}:${dateKey}`)
      }
      const symbolMap = bySymbol.get(symbol) ?? new Map()
      if (symbolMap.has(dateKey)) {
        throw new Error(`Duplicate ${datasetId} row for ${symbol}:${dateKey}`)
      }
      symbolMap.set(dateKey, numericValue)
      bySymbol.set(symbol, symbolMap)
    },
  })
  return bySymbol
}

const normalizeMinuteRow = (row, expectedDateKey) => {
  const symbol = toText(row?.symbol)
  const tradingDateKey = assertDateKey(row?.tradingDateKey, "minute tradingDateKey")
  if (expectedDateKey && tradingDateKey !== expectedDateKey) {
    throw new Error(`Minute partition/date mismatch for ${symbol}:${tradingDateKey}, expected ${expectedDateKey}`)
  }
  const tsKst = toText(row?.tsKst)
  const open = Number(row?.open ?? NaN)
  const high = Number(row?.high ?? NaN)
  const low = Number(row?.low ?? NaN)
  const close = Number(row?.close ?? NaN)
  const volume = Number(row?.volume ?? NaN)
  const valueKrw = Number.isFinite(Number(row?.valueKrw)) ? Number(row?.valueKrw) : close * volume
  if (!symbol || !tsKst || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
    throw new Error(`Malformed minute row for ${symbol || "<empty>"}:${tradingDateKey}`)
  }
  return {
    symbol,
    tradingDateKey,
    tsKst,
    tsMs: parseTsMs(tsKst),
    open,
    high,
    low,
    close,
    volume,
    valueKrw,
  }
}

const createMinutePartitionCache = ({ minuteRoot, symbolSet, cacheDateLimit = DEFAULT_MINUTE_CACHE_DATE_LIMIT }) => {
  const cache = new Map()
  const touch = (dateKey) => {
    const value = cache.get(dateKey)
    if (!value) return null
    cache.delete(dateKey)
    cache.set(dateKey, value)
    return value
  }
  const evictIfNeeded = () => {
    while (cache.size > cacheDateLimit) {
      const oldestKey = cache.keys().next().value
      cache.delete(oldestKey)
    }
  }
  const loadDatePartition = async (dateKey) => {
    const existing = touch(dateKey)
    if (existing) return existing
    const filePath = minutePartitionPath(minuteRoot, dateKey)
    if (!pathExists(filePath)) {
      throw new Error(`Missing minute partition for ${dateKey}: ${filePath}`)
    }
    const bySymbol = new Map()
    await iterateJsonl(filePath, {
      strict: true,
      onRow: async (row) => {
        const symbol = toText(row?.symbol)
        if (!symbolSet.has(symbol)) return
        const normalized = normalizeMinuteRow(row, dateKey)
        const rows = bySymbol.get(symbol) ?? []
        rows.push(normalized)
        bySymbol.set(symbol, rows)
      },
    })
    for (const [symbol, rows] of bySymbol.entries()) {
      rows.sort((left, right) => left.tsMs - right.tsMs)
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index - 1].tsMs >= rows[index].tsMs) {
          throw new Error(`Minute rows are not strictly increasing for ${symbol}:${dateKey}`)
        }
      }
    }
    cache.set(dateKey, bySymbol)
    evictIfNeeded()
    return bySymbol
  }
  return {
    async getBars(symbol, dateKey) {
      const bySymbol = await loadDatePartition(dateKey)
      const rows = bySymbol.get(symbol)
      if (!Array.isArray(rows) || rows.length < 1) {
        throw new Error(`Missing minute rows for ${symbol}:${dateKey}`)
      }
      return rows
    },
  }
}

const last = (rows) => rows[rows.length - 1] ?? null

const rowsUntilCutoff = (rows, cutoffTsMs) => rows.filter((row) => row.tsMs <= cutoffTsMs)

const rowsAfterTs = (rows, cutoffTsMs, { includeEqual = false } = {}) =>
  rows.filter((row) => (includeEqual ? row.tsMs >= cutoffTsMs : row.tsMs > cutoffTsMs))

const buildDayContext = (bars) => {
  if (!Array.isArray(bars) || bars.length < 1) {
    throw new Error("Day context requires at least one bar")
  }
  const openPrice = bars[0].open
  const closePrice = last(bars).close
  const highPrice = maxValue(bars.map((row) => row.high))
  const lowPrice = minValue(bars.map((row) => row.low))
  const totalVolume = sum(bars.map((row) => row.volume))
  return {
    openPrice,
    closePrice,
    highPrice,
    lowPrice,
    totalVolume,
  }
}

const computeDMinus1Features = (bars) => {
  const context = buildDayContext(bars)
  const trailingWindow = bars.slice(-Math.min(30, bars.length))
  return {
    dminus1_close_runup_pct: percentFromBase(context.closePrice, context.openPrice),
    dminus1_last30m_volume_burst: safeDiv(sum(trailingWindow.map((row) => row.volume)), context.totalVolume),
  }
}

const computeD0Features = (bars) => {
  const context = buildDayContext(bars)
  const openPrice = context.openPrice
  const first5 = rowsUntilCutoff(bars, parseTsMs(isoTsForDateTime(bars[0].tradingDateKey, "09:05:00")))
  const first15 = rowsUntilCutoff(bars, parseTsMs(isoTsForDateTime(bars[0].tradingDateKey, "09:15:00")))
  const first30 = rowsUntilCutoff(bars, parseTsMs(isoTsForDateTime(bars[0].tradingDateKey, "09:30:00")))
  const morningRows = bars.slice(0, Math.min(60, bars.length))
  let cumulativeValue = 0
  let cumulativeVolume = 0
  let vwapHoldCount = 0
  for (const row of bars) {
    cumulativeValue += Number.isFinite(row.valueKrw) ? row.valueKrw : row.close * row.volume
    cumulativeVolume += row.volume
    const vwap = safeDiv(cumulativeValue, cumulativeVolume)
    if (row.close >= vwap) vwapHoldCount += 1
  }
  const morningHigh = maxValue(morningRows.map((row) => row.high)) ?? context.highPrice
  const breakoutDenominator = morningHigh - openPrice
  return {
    d0_first5m_ret: percentFromBase(last(first5)?.close ?? openPrice, openPrice),
    d0_first15m_ret: percentFromBase(last(first15)?.close ?? openPrice, openPrice),
    d0_first30m_high_pct: percentFromBase(maxValue(first30.map((row) => row.high)) ?? openPrice, openPrice),
    d0_first30m_low_pct: percentFromBase(minValue(first30.map((row) => row.low)) ?? openPrice, openPrice),
    d0_vwap_hold_ratio: safeDiv(vwapHoldCount, bars.length),
    d0_morning_breakout_strength: percentFromBase(morningHigh, openPrice),
    d0_close_strength_after_breakout:
      breakoutDenominator > 0 ? safeDiv(context.closePrice - openPrice, breakoutDenominator) : 0,
    d0_close_strength:
      context.highPrice > context.lowPrice ? safeDiv(context.closePrice - context.lowPrice, context.highPrice - context.lowPrice) : 0,
  }
}

const computeD1CutoffFeatures = ({ barsD1, barsD0, cutoffTsMs }) => {
  const cutoffRows = rowsUntilCutoff(barsD1, cutoffTsMs)
  if (cutoffRows.length < 1) {
    throw new Error(`D+1 cutoff produced zero rows for ${barsD1[0]?.symbol ?? "<unknown>"}:${barsD1[0]?.tradingDateKey ?? "<unknown>"}`)
  }
  const openPrice = barsD1[0].open
  const lowToCutoff = minValue(cutoffRows.map((row) => row.low)) ?? openPrice
  const highToCutoff = maxValue(cutoffRows.map((row) => row.high)) ?? openPrice
  const closeToCutoff = last(cutoffRows)?.close ?? openPrice
  const d0ComparableRows = barsD0.slice(0, cutoffRows.length)
  return {
    d1_open_flush_depth: Math.max(0, safeDiv(openPrice - lowToCutoff, openPrice)),
    d1_open_flush_reclaim: safeDiv(closeToCutoff - lowToCutoff, openPrice),
    d1_high_pct_to_cutoff: percentFromBase(highToCutoff, openPrice),
    d1_low_pct_to_cutoff: percentFromBase(lowToCutoff, openPrice),
    d1_close_ret_to_cutoff: percentFromBase(closeToCutoff, openPrice),
    d1_volume_ratio_to_cutoff: safeDiv(
      sum(cutoffRows.map((row) => row.volume)),
      sum(d0ComparableRows.map((row) => row.volume)),
    ),
    d1_cutoff_bar_count: cutoffRows.length,
  }
}

const scanBarriers = ({
  futureBars,
  entryPrice,
  stopEnabledDateKey = null,
}) => {
  const tpPrice = entryPrice * 1.12
  const slPrice = entryPrice * 0.96
  let firstTpTs = null
  let firstSlTs = null
  for (const row of futureBars) {
    if (!firstTpTs && row.high >= tpPrice) {
      firstTpTs = row.tsKst
    }
    const stopEnabled = stopEnabledDateKey ? row.tradingDateKey >= stopEnabledDateKey : true
    if (stopEnabled && !firstSlTs && row.low <= slPrice) {
      firstSlTs = row.tsKst
    }
    if (firstTpTs && firstSlTs) break
  }
  let firstBarrierOutcome = "no_barrier_hit"
  if (firstTpTs && firstSlTs) {
    if (firstTpTs < firstSlTs) firstBarrierOutcome = "tp12_first"
    else if (firstSlTs < firstTpTs) firstBarrierOutcome = "sl4_first"
    else firstBarrierOutcome = "same_bar_conflict"
  } else if (firstTpTs) {
    firstBarrierOutcome = "tp12_first"
  } else if (firstSlTs) {
    firstBarrierOutcome = "sl4_first"
  }
  return {
    tpPrice,
    slPrice,
    firstTpTs,
    firstSlTs,
    firstBarrierOutcome,
  }
}

const computeExecutionLabels = ({
  futureBars,
  entryPrice,
  entryTsKst,
  entryDateKey,
}) => {
  if (!Array.isArray(futureBars) || futureBars.length < 1) {
    throw new Error(`Missing future bars for entry ${entryDateKey}:${entryTsKst}`)
  }
  const entryTsMs = parseTsMs(entryTsKst)
  const day1Bars = futureBars.filter((row) => row.tradingDateKey === entryDateKey)
  const finalClose = last(futureBars)?.close
  const finalCloseRet = percentFromBase(finalClose, entryPrice)
  const immediate = scanBarriers({
    futureBars,
    entryPrice,
    stopEnabledDateKey: entryDateKey,
  })
  const delay1 = scanBarriers({
    futureBars,
    entryPrice,
    stopEnabledDateKey: futureBars.find((row) => row.tradingDateKey > entryDateKey)?.tradingDateKey ?? "9999-12-31",
  })
  const tpOnly = scanBarriers({
    futureBars,
    entryPrice,
    stopEnabledDateKey: "9999-12-31",
  })
  const minutesToTp12 = immediate.firstTpTs ? Math.round((parseTsMs(immediate.firstTpTs) - entryTsMs) / 60000) : null
  const minutesToSl4 = immediate.firstSlTs ? Math.round((parseTsMs(immediate.firstSlTs) - entryTsMs) / 60000) : null
  const day1Mfe = day1Bars.length > 0 ? percentFromBase(maxValue(day1Bars.map((row) => row.high)) ?? entryPrice, entryPrice) : 0
  const day1Mae = day1Bars.length > 0 ? percentFromBase(minValue(day1Bars.map((row) => row.low)) ?? entryPrice, entryPrice) : 0
  const stopFirstNetRet =
    immediate.firstBarrierOutcome === "tp12_first"
      ? 0.12
      : immediate.firstBarrierOutcome === "sl4_first"
        ? -0.04
        : immediate.firstBarrierOutcome === "same_bar_conflict"
          ? null
          : finalCloseRet
  const delay1NetRet =
    delay1.firstBarrierOutcome === "tp12_first"
      ? 0.12
      : delay1.firstBarrierOutcome === "sl4_first"
        ? -0.04
        : delay1.firstBarrierOutcome === "same_bar_conflict"
          ? null
          : finalCloseRet
  const touchAnchorNetRet = tpOnly.firstTpTs ? 0.12 : finalCloseRet
  const bestChoice = chooseBestPolicy({
    stop_first: stopFirstNetRet,
    delay1_4d: delay1NetRet,
    touch_anchor: touchAnchorNetRet,
    abstain: 0,
  })
  return {
    entryPrice,
    tp12Price: immediate.tpPrice,
    sl4Price: immediate.slPrice,
    tp12Hit: Boolean(immediate.firstTpTs),
    sl4Hit: Boolean(immediate.firstSlTs),
    tp12HitTsKst: immediate.firstTpTs,
    sl4HitTsKst: immediate.firstSlTs,
    firstBarrierOutcome: immediate.firstBarrierOutcome,
    delay1FirstBarrierOutcome: delay1.firstBarrierOutcome,
    minutesToTp12,
    minutesToSl4,
    day1MFE: day1Mfe,
    day1MAE: day1Mae,
    finalCloseRet,
    stop_first_net_ret: stopFirstNetRet,
    delay1_4d_net_ret: delay1NetRet,
    touch_anchor_net_ret: touchAnchorNetRet,
    ...bestChoice,
  }
}

const flattenFutureBars = ({ dayBarsByKey, fromDateKey, entryTsKst, includeEntryBar }) => {
  const orderedDateKeys = Object.keys(dayBarsByKey).sort(compareDateKey).filter((dateKey) => dateKey >= fromDateKey)
  const rows = []
  for (const dateKey of orderedDateKeys) {
    const dayBars = dayBarsByKey[dateKey] ?? []
    if (dateKey === fromDateKey) {
      rows.push(...rowsAfterTs(dayBars, parseTsMs(entryTsKst), { includeEqual: includeEntryBar }))
      continue
    }
    rows.push(...dayBars)
  }
  return rows
}

const loadBarsForManifestRow = async (minuteCache, manifestRow) => {
  const [dminus1, d0, d1, d2, d3, d4] = manifestRow.windowDateKeys
  const symbolsBars = {
    [dminus1]: await minuteCache.getBars(manifestRow.symbol, dminus1),
    [d0]: await minuteCache.getBars(manifestRow.symbol, d0),
    [d1]: await minuteCache.getBars(manifestRow.symbol, d1),
    [d2]: await minuteCache.getBars(manifestRow.symbol, d2),
    [d3]: await minuteCache.getBars(manifestRow.symbol, d3),
    [d4]: await minuteCache.getBars(manifestRow.symbol, d4),
  }
  return {
    dminus1,
    d0,
    d1,
    d2,
    d3,
    d4,
    dayBarsByKey: symbolsBars,
  }
}

const buildBaseFlowFeatures = ({ investorDailyIndex, programDailyIndex, tradeStrengthDailyIndex, symbol, prevDateKey, decisionDateKey }) => {
  const requireSideValue = (index, label, dateKey) => {
    const symbolMap = index.get(symbol)
    if (!symbolMap || !symbolMap.has(dateKey)) {
      throw new Error(`Missing ${label} coverage for ${symbol}:${dateKey}`)
    }
    return symbolMap.get(dateKey)
  }
  const investorPrev = requireSideValue(investorDailyIndex, "investor_daily", prevDateKey)
  const investorDecision = requireSideValue(investorDailyIndex, "investor_daily", decisionDateKey)
  const programPrev = requireSideValue(programDailyIndex, "program_daily", prevDateKey)
  const programDecision = requireSideValue(programDailyIndex, "program_daily", decisionDateKey)
  const strengthPrev = requireSideValue(tradeStrengthDailyIndex, "trade_strength_daily", prevDateKey)
  const strengthDecision = requireSideValue(tradeStrengthDailyIndex, "trade_strength_daily", decisionDateKey)
  return {
    investor_dminus1_netbuy: investorPrev,
    investor_d0_netbuy: investorDecision,
    investor_day_delta: investorDecision - investorPrev,
    program_dminus1_netbuy: programPrev,
    program_d0_netbuy: programDecision,
    program_day_delta: programDecision - programPrev,
    trade_strength_dminus1: strengthPrev,
    trade_strength_d0: strengthDecision,
    trade_strength_day_delta: strengthDecision - strengthPrev,
  }
}

export const buildTp12IntradayFeatureDataset = async ({
  manifestPath,
  minuteRoot,
  minutePresencePath,
  investorDailyPath,
  programDailyPath,
  tradeStrengthDailyPath,
  outPath,
  summaryOutPath,
  decisionFrom = null,
  decisionTo = null,
  gateIds = TP12_INTRADAY_GATE_SPECS.map((spec) => spec.gateId),
  minuteCacheDateLimit = DEFAULT_MINUTE_CACHE_DATE_LIMIT,
} = {}) => {
  const resolvedManifestPath = path.resolve(manifestPath)
  const resolvedMinuteRoot = path.resolve(minuteRoot)
  const resolvedPresencePath = path.resolve(minutePresencePath)
  const resolvedInvestorPath = path.resolve(investorDailyPath)
  const resolvedProgramPath = path.resolve(programDailyPath)
  const resolvedTradeStrengthPath = path.resolve(tradeStrengthDailyPath)
  const resolvedOutPath = path.resolve(outPath)
  const resolvedSummaryOutPath = path.resolve(summaryOutPath)
  const normalizedDecisionFrom = decisionFrom ? assertDateKey(decisionFrom, "decisionFrom") : null
  const normalizedDecisionTo = decisionTo ? assertDateKey(decisionTo, "decisionTo") : null
  const gateSpecById = new Map(TP12_INTRADAY_GATE_SPECS.map((spec) => [spec.gateId, spec]))
  const selectedGateIds = Array.from(new Set((Array.isArray(gateIds) ? gateIds : []).map((value) => toText(value)).filter(Boolean)))
  if (selectedGateIds.length < 1) {
    throw new Error("At least one gateId is required")
  }
  for (const gateId of selectedGateIds) {
    if (!gateSpecById.has(gateId)) {
      throw new Error(`Unsupported gateId=${gateId}`)
    }
  }

  const manifestRows = await readManifestRows(resolvedManifestPath, {
    decisionFrom: normalizedDecisionFrom,
    decisionTo: normalizedDecisionTo,
  })
  const requestedSets = buildRequestedSets(manifestRows)
  await loadPresenceIndex(resolvedPresencePath, requestedSets.requestedPairSet)
  const investorDailyIndex = await loadSideDailyIndex("investor_daily", resolvedInvestorPath, requestedSets.symbolSet)
  const programDailyIndex = await loadSideDailyIndex("program_daily", resolvedProgramPath, requestedSets.symbolSet)
  const tradeStrengthDailyIndex = await loadSideDailyIndex("trade_strength_daily", resolvedTradeStrengthPath, requestedSets.symbolSet)
  const minuteCache = createMinutePartitionCache({
    minuteRoot: resolvedMinuteRoot,
    symbolSet: requestedSets.symbolSet,
    cacheDateLimit: minuteCacheDateLimit,
  })

  const featureRows = []
  const gateCounts = new Map()
  const ambiguousCounts = new Map()
  for (const manifestRow of manifestRows) {
    const barsByWindow = await loadBarsForManifestRow(minuteCache, manifestRow)
    const baseMinuteFeatures = {
      ...computeDMinus1Features(barsByWindow.dayBarsByKey[barsByWindow.dminus1]),
      ...computeD0Features(barsByWindow.dayBarsByKey[barsByWindow.d0]),
    }
    const baseFlowFeatures = buildBaseFlowFeatures({
      investorDailyIndex,
      programDailyIndex,
      tradeStrengthDailyIndex,
      symbol: manifestRow.symbol,
      prevDateKey: barsByWindow.dminus1,
      decisionDateKey: barsByWindow.d0,
    })
    const entryDayBars = barsByWindow.dayBarsByKey[barsByWindow.d1]
    const dayBarsByKey = {
      [barsByWindow.d1]: entryDayBars,
      [barsByWindow.d2]: barsByWindow.dayBarsByKey[barsByWindow.d2],
      [barsByWindow.d3]: barsByWindow.dayBarsByKey[barsByWindow.d3],
      [barsByWindow.d4]: barsByWindow.dayBarsByKey[barsByWindow.d4],
    }
    for (const gateId of selectedGateIds) {
      const gateSpec = gateSpecById.get(gateId)
      const cutoffDateKey = gateSpec.decisionCutoff.dateRef === "d0" ? barsByWindow.d0 : barsByWindow.d1
      const cutoffTsKst = gateSpec.entryMode === "next_day_open"
        ? last(barsByWindow.dayBarsByKey[barsByWindow.d0])?.tsKst ?? isoTsForDateTime(barsByWindow.d0, gateSpec.decisionCutoff.time)
        : isoTsForDateTime(cutoffDateKey, gateSpec.decisionCutoff.time)
      let entryPrice = null
      let entryTsKst = null
      let gateFeatures = {
        ...baseMinuteFeatures,
        ...baseFlowFeatures,
      }
      let futureBars = []
      if (gateSpec.entryMode === "next_day_open") {
        entryPrice = entryDayBars[0]?.open
        entryTsKst = entryDayBars[0]?.tsKst
        futureBars = flattenFutureBars({
          dayBarsByKey,
          fromDateKey: barsByWindow.d1,
          entryTsKst,
          includeEntryBar: true,
        })
      } else {
        const cutoffRows = rowsUntilCutoff(entryDayBars, parseTsMs(cutoffTsKst))
        if (cutoffRows.length < 1) {
          throw new Error(`Gate ${gateId} has no D+1 rows up to cutoff for ${manifestRow.requestId}`)
        }
        entryPrice = last(cutoffRows)?.close
        entryTsKst = last(cutoffRows)?.tsKst
        gateFeatures = {
          ...gateFeatures,
          ...computeD1CutoffFeatures({
            barsD1: entryDayBars,
            barsD0: barsByWindow.dayBarsByKey[barsByWindow.d0],
            cutoffTsMs: parseTsMs(cutoffTsKst),
          }),
        }
        futureBars = flattenFutureBars({
          dayBarsByKey,
          fromDateKey: barsByWindow.d1,
          entryTsKst,
          includeEntryBar: false,
        })
      }
      if (!Number.isFinite(entryPrice) || !entryTsKst) {
        throw new Error(`Gate ${gateId} could not determine entry contract for ${manifestRow.requestId}`)
      }
      const labels = computeExecutionLabels({
        futureBars,
        entryPrice,
        entryTsKst,
        entryDateKey: barsByWindow.d1,
      })
      if (labels.firstBarrierOutcome === "same_bar_conflict") {
        ambiguousCounts.set(gateId, Number(ambiguousCounts.get(gateId) ?? 0) + 1)
      }
      featureRows.push({
        kind: TP12_INTRADAY_FEATURE_DATASET_KIND,
        requestId: manifestRow.requestId,
        symbol: manifestRow.symbol,
        decisionDateKey: manifestRow.decisionDateKey,
        prevDateKey: manifestRow.prevDateKey,
        asOfDateKey: manifestRow.asOfDateKey,
        stepALaneId: manifestRow.stepALaneId,
        runId: manifestRow.runId,
        eventLabel: manifestRow.eventLabel,
        highJumpThreshold: manifestRow.highJumpThreshold,
        highJumpMode: manifestRow.highJumpMode,
        impulseSourceDateKey: manifestRow.impulseSourceDateKey,
        impulseLookbackDays: manifestRow.impulseLookbackDays,
        recentImpulseLookbackTradingDays: manifestRow.recentImpulseLookbackTradingDays,
        windowDateKeys: manifestRow.windowDateKeys,
        gateId,
        featureCutoffDateKey: cutoffDateKey,
        featureCutoffTsKst: cutoffTsKst,
        entryPriceMode: gateSpec.entryMode,
        entryDateKey: barsByWindow.d1,
        entryTsKst,
        entryPrice,
        features: gateFeatures,
        labels,
      })
      gateCounts.set(gateId, Number(gateCounts.get(gateId) ?? 0) + 1)
    }
  }

  const summary = {
    status: "ok",
    kind: TP12_INTRADAY_FEATURE_DATASET_KIND,
    manifestPath: resolvedManifestPath,
    outPath: resolvedOutPath,
    rowCount: featureRows.length,
    requestCount: manifestRows.length,
    decisionDateFrom: manifestRows[0]?.decisionDateKey ?? null,
    decisionDateTo: manifestRows[manifestRows.length - 1]?.decisionDateKey ?? null,
    gateCounts: Object.fromEntries(Array.from(gateCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    ambiguousCounts: Object.fromEntries(Array.from(ambiguousCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    featureFamilies: [
      "dminus1_minute_path",
      "d0_full_session_path",
      "d1_cutoff_path",
      "investor_daily_delta",
      "program_daily_delta",
      "trade_strength_daily_delta",
      "execution_policy_labels",
    ],
    supportedSideDatasets: SIDE_DATASET_IDS,
    gateIds: selectedGateIds,
  }

  await ensureDir(path.dirname(resolvedOutPath))
  await writeJsonl(resolvedOutPath, featureRows)
  await writeJson(resolvedSummaryOutPath, summary)

  return {
    outPath: resolvedOutPath,
    summaryOutPath: resolvedSummaryOutPath,
    summary,
  }
}
