import path from "node:path"
import fs from "node:fs"
import readline from "node:readline"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import { isInRange } from "../lib/date.mjs"
import {
  buildCandleSeriesMap,
  buildSymbolMasterMap,
  buildUniverseMap,
  loadStepAData,
  loadStepASupplementalData
} from "../lib/data.mjs"
import {
  probeDuckdbCli,
  runDuckdbStepACandidateQuery
} from "../lib/duckdb_cli.mjs"
import {
  normalizeOutputMode,
  shouldWriteFull,
  shouldWriteLite
} from "../lib/lightweight.mjs"
import {
  evaluateCoreFilters,
  evaluateGapTradabilityFilter,
  evaluateInstrumentFilter
} from "../lib/filters.mjs"
import { createJsonlWriter, ensureDir, pathExists, writeJson } from "../lib/io.mjs"
import {
  buildRecentImpulseLaneId,
  MAX_RECENT_IMPULSE_LOOKBACK_DAYS,
} from "../lib/perfect_prototype_multiline_contract.mjs"

const bump = (map, key) => {
  map[key] = (map[key] ?? 0) + 1
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const calcEventTradingValue = (close, volume) => {
  const c = num(close)
  const v = num(volume)
  if (!Number.isFinite(c) || !Number.isFinite(v)) return null
  return c * v
}

const evaluateEventTradingValueFilter = ({ cfg, eventTradingValueKrw }) => {
  const minValue = Number(cfg?.minEventTradingValueKrw)
  if (!Number.isFinite(minValue) || minValue <= 0) {
    return { pass: true, reasons: [] }
  }
  const tv = num(eventTradingValueKrw)
  if (!Number.isFinite(tv)) {
    return { pass: false, reasons: ["EVENT_TRADING_VALUE_MISSING"] }
  }
  if (tv < minValue) {
    return { pass: false, reasons: ["EVENT_TRADING_VALUE_BELOW_MIN"] }
  }
  return { pass: true, reasons: [] }
}

const boolFromInt = (value) => {
  const t = String(value ?? "").trim().toLowerCase()
  return t === "1" || t === "true"
}

const resolveHighJumpMode = (raw) => {
  const mode = String(raw ?? "FROM_OPEN_EX_GAP").trim().toUpperCase()
  if (mode === "FROM_PREV_CLOSE") return mode
  return "FROM_OPEN_EX_GAP"
}

const resolveStepAEngine = (raw) => {
  const mode = String(raw ?? "duckdb").trim().toLowerCase()
  if (mode === "classic" || mode === "bitset" || mode === "duckdb") return mode
  return "duckdb"
}

const STEP_A_SAME_DAY_HIGH8_LANE_ID = "same_day_high8"
const STEP_A_RECENT_IMPULSE_LANE_BY_LOOKBACK = new Map(
  Array.from({ length: MAX_RECENT_IMPULSE_LOOKBACK_DAYS }, (_, index) => {
    const lookback = index + 1
    return [lookback, buildRecentImpulseLaneId(lookback)]
  }),
)
const STEP_A_RECENT_IMPULSE_LOOKBACK_BY_LANE_ID = new Map(
  Array.from(STEP_A_RECENT_IMPULSE_LANE_BY_LOOKBACK.entries(), ([lookback, laneId]) => [laneId, lookback]),
)

const resolveRecentImpulseDiscovery = (raw) => {
  const enabled = raw?.enabled === true
  if (!enabled) {
    return {
      enabled: false,
      lookbackTradingDays: 0,
    }
  }
  const lookbackTradingDays = Number(raw?.lookbackTradingDays)
  if (
    !Number.isInteger(lookbackTradingDays) ||
    lookbackTradingDays < 1 ||
    lookbackTradingDays > MAX_RECENT_IMPULSE_LOOKBACK_DAYS
  ) {
    throw new Error(
      `recentImpulseDiscovery.lookbackTradingDays must be an integer in [1,${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}], got ${raw?.lookbackTradingDays ?? "null"}`,
    )
  }
  return {
    enabled: true,
    lookbackTradingDays,
  }
}

const calcSeriesDecisionJumpMeta = ({ series, decisionIdx, highJumpMode }) => {
  if (!Array.isArray(series) || !Number.isInteger(decisionIdx) || decisionIdx < 1 || decisionIdx >= series.length) {
    return null
  }
  const today = series[decisionIdx]
  const prev = series[decisionIdx - 1]
  const prevClose = num(prev?.close)
  const open = num(today?.open)
  const high = num(today?.high)
  if (!Number.isFinite(prevClose) || !Number.isFinite(high) || prevClose <= 0) return null
  if (highJumpMode === "FROM_OPEN_EX_GAP" && (!Number.isFinite(open) || open <= 0)) return null
  const jumpBase = highJumpMode === "FROM_PREV_CLOSE" ? prevClose : open
  const jumpPct = high / jumpBase - 1
  return {
    dateKey: String(today?.dateKey ?? "").trim() || null,
    jumpPct,
    jumpPctFromPrevClose: high / prevClose - 1,
    jumpPctFromOpen: Number.isFinite(open) && open > 0 ? high / open - 1 : null,
  }
}

const resolveStepAEventLaneMeta = ({
  series,
  decisionIdx,
  highThreshold,
  highJumpMode,
  recentImpulseDiscovery,
}) => {
  const currentJumpMeta = calcSeriesDecisionJumpMeta({
    series,
    decisionIdx,
    highJumpMode,
  })
  if (!currentJumpMeta) return null
  if (Number.isFinite(currentJumpMeta.jumpPct) && currentJumpMeta.jumpPct >= highThreshold) {
    return {
      stepALaneId: STEP_A_SAME_DAY_HIGH8_LANE_ID,
      jumpPct: currentJumpMeta.jumpPct,
      jumpPctFromPrevClose: currentJumpMeta.jumpPctFromPrevClose,
      jumpPctFromOpen: currentJumpMeta.jumpPctFromOpen,
      impulseSourceDateKey: currentJumpMeta.dateKey,
      impulseLookbackDays: 0,
      impulseJumpPct: currentJumpMeta.jumpPct,
      impulseJumpPctFromPrevClose: currentJumpMeta.jumpPctFromPrevClose,
      impulseJumpPctFromOpen: currentJumpMeta.jumpPctFromOpen,
    }
  }
  if (recentImpulseDiscovery?.enabled !== true) return null
  for (let lookback = 1; lookback <= Number(recentImpulseDiscovery.lookbackTradingDays ?? 0); lookback += 1) {
    const impulseJumpMeta = calcSeriesDecisionJumpMeta({
      series,
      decisionIdx: decisionIdx - lookback,
      highJumpMode,
    })
    if (!impulseJumpMeta) continue
    if (!Number.isFinite(impulseJumpMeta.jumpPct) || impulseJumpMeta.jumpPct < highThreshold) continue
    return {
      stepALaneId: STEP_A_RECENT_IMPULSE_LANE_BY_LOOKBACK.get(lookback) ?? `recent_impulse_${lookback}d`,
      jumpPct: currentJumpMeta.jumpPct,
      jumpPctFromPrevClose: currentJumpMeta.jumpPctFromPrevClose,
      jumpPctFromOpen: currentJumpMeta.jumpPctFromOpen,
      impulseSourceDateKey: impulseJumpMeta.dateKey,
      impulseLookbackDays: lookback,
      impulseJumpPct: impulseJumpMeta.jumpPct,
      impulseJumpPctFromPrevClose: impulseJumpMeta.jumpPctFromPrevClose,
      impulseJumpPctFromOpen: impulseJumpMeta.jumpPctFromOpen,
    }
  }
  return null
}

const bumpStepALaneStats = (stats, laneId, phase) => {
  const normalizedLaneId = String(laneId ?? "").trim()
  if (!normalizedLaneId) return
  const prefix = phase === "passed" ? "passed" : "candidate"
  if (normalizedLaneId === STEP_A_SAME_DAY_HIGH8_LANE_ID) {
    stats[`${prefix}SameDayHigh8Count`] = Number(stats[`${prefix}SameDayHigh8Count`] ?? 0) + 1
    return
  }
  const recentImpulseLookback = STEP_A_RECENT_IMPULSE_LOOKBACK_BY_LANE_ID.get(normalizedLaneId) ?? null
  if (!Number.isInteger(recentImpulseLookback)) {
    return
  }
  stats[`${prefix}RecentImpulse${recentImpulseLookback}dCount`] =
    Number(stats[`${prefix}RecentImpulse${recentImpulseLookback}dCount`] ?? 0) + 1
  stats[`${prefix}RecentImpulseDedupedCount`] = Number(stats[`${prefix}RecentImpulseDedupedCount`] ?? 0) + 1
}

const setBit = (words, index) => {
  const wordIdx = index >>> 5
  const bit = index & 31
  words[wordIdx] |= 1 << bit
}

const parseDuckdbTsvLine = (rawLine) => {
  const line = String(rawLine ?? "").replace(/\r$/, "")
  if (!line.trim()) return null
  const cols = line.split("\t")
  // Keep trailing empty fields from DuckDB TSV (e.g., nullable liquidity/cap/lane columns).
  while (cols.length < 28) cols.push("")
  if (cols.length < 28) {
    throw new Error(
      `Invalid duckdb raw candidate row column count: expected >=28, got ${cols.length}`,
    )
  }
  return {
    symbol: String(cols[0] ?? "").trim(),
    dateKey: String(cols[1] ?? "").trim(),
    prevDateKey: String(cols[2] ?? "").trim(),
    asOfDateKey: String(cols[3] ?? "").trim(),
    prevClose: num(cols[4]),
    prevCloseForGap: num(cols[5]),
    open: num(cols[6]),
    high: num(cols[7]),
    low: num(cols[8]),
    close: num(cols[9]),
    volume: num(cols[10]),
    jumpPctFromPrevClose: num(cols[11]),
    jumpPctFromOpen: num(cols[12]),
    jumpPct: num(cols[13]),
    closeRetPct: num(cols[14]),
    gapOpenPct: num(cols[15]),
    hasLookback40d: boolFromInt(cols[16]),
    hasLookback150d: boolFromInt(cols[17]),
    hasLookbackMinWindow: boolFromInt(cols[18]),
    corePass: boolFromInt(cols[19]),
    avgTradingValue20d: num(cols[20]),
    marketCapKrw: num(cols[21]),
    stepALaneId: String(cols[22] ?? "").trim() || null,
    impulseSourceDateKey: String(cols[23] ?? "").trim() || null,
    impulseLookbackDays: num(cols[24]),
    impulseJumpPctFromPrevClose: num(cols[25]),
    impulseJumpPctFromOpen: num(cols[26]),
    impulseJumpPct: num(cols[27]),
  }
}

const streamDuckdbRowsBySymbol = async (filePath, onRows) => {
  if (!pathExists(filePath)) return
  let currentSymbol = null
  let bucket = []
  for await (const rawLine of readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  })) {
    const row = parseDuckdbTsvLine(rawLine)
    if (!row) continue
    if (!row.symbol || !row.dateKey) continue
    if (currentSymbol === null) {
      currentSymbol = row.symbol
    } else if (row.symbol !== currentSymbol) {
      if (bucket.length > 0) {
        await onRows(currentSymbol, bucket)
      }
      currentSymbol = row.symbol
      bucket = []
    }
    bucket.push(row)
  }
  if (currentSymbol !== null && bucket.length > 0) {
    await onRows(currentSymbol, bucket)
  }
}

const emitEventRow = async ({
  candidate,
  meta,
  universeRow,
  highJumpMode,
  fullWriter,
  liteWriter
}) => {
  const eventRow = {
    dateKey: candidate.dateKey,
    symbol: candidate.symbol,
    name: meta.name ?? candidate.symbol,
    prevDateKey: candidate.prevDateKey,
    asOfDateKey: candidate.asOfDateKey,
    prevClose: candidate.prevClose,
    open: candidate.open,
    high: candidate.high,
    low: candidate.low,
    close: candidate.close,
    volume: candidate.volume,
    jumpPct: candidate.jumpPct,
    jumpPctFromPrevClose: candidate.jumpPctFromPrevClose,
    jumpPctFromOpen: candidate.jumpPctFromOpen,
    highJumpMode,
    closeRetPct: candidate.closeRetPct,
    gapOpenPct: candidate.gapOpenPct,
    eventTradingValueKrw: candidate.eventTradingValueKrw,
    hasLookback40d: Boolean(candidate.hasLookback40d),
    hasLookback150d: Boolean(candidate.hasLookback150d),
    hasLookbackMinWindow: Boolean(candidate.hasLookbackMinWindow),
    stepALaneId: candidate.stepALaneId ?? null,
    impulseSourceDateKey: candidate.impulseSourceDateKey ?? null,
    impulseLookbackDays: candidate.impulseLookbackDays ?? null,
    impulseJumpPct: candidate.impulseJumpPct ?? null,
    impulseJumpPctFromPrevClose: candidate.impulseJumpPctFromPrevClose ?? null,
    impulseJumpPctFromOpen: candidate.impulseJumpPctFromOpen ?? null,
    avgTradingValue20d:
      candidate.avgTradingValue20d ?? universeRow?.avgTradingValue20d ?? null,
    marketCapKrw: candidate.marketCapKrw ?? universeRow?.marketCapKrw ?? null
  }

  if (fullWriter) {
    await fullWriter.writeRow(eventRow)
  }
  if (liteWriter) {
    await liteWriter.writeRow({
      dateKey: eventRow.dateKey,
      symbol: eventRow.symbol,
      prevDateKey: eventRow.prevDateKey,
      asOfDateKey: eventRow.asOfDateKey,
      jumpPct: eventRow.jumpPct,
      jumpPctFromPrevClose: eventRow.jumpPctFromPrevClose,
      jumpPctFromOpen: eventRow.jumpPctFromOpen,
      highJumpMode: eventRow.highJumpMode,
      closeRetPct: eventRow.closeRetPct,
      gapOpenPct: eventRow.gapOpenPct,
      eventTradingValueKrw: eventRow.eventTradingValueKrw,
      hasLookback40d: eventRow.hasLookback40d,
      hasLookback150d: eventRow.hasLookback150d,
      hasLookbackMinWindow: eventRow.hasLookbackMinWindow,
      stepALaneId: eventRow.stepALaneId,
      impulseSourceDateKey: eventRow.impulseSourceDateKey,
      impulseLookbackDays: eventRow.impulseLookbackDays,
      impulseJumpPct: eventRow.impulseJumpPct,
      impulseJumpPctFromPrevClose: eventRow.impulseJumpPctFromPrevClose,
      impulseJumpPctFromOpen: eventRow.impulseJumpPctFromOpen,
    })
  }
}

const buildStepARecentImpulseStats = (prefix) => {
  const out = {
    [`${prefix}RecentImpulseDedupedCount`]: 0,
  }
  for (let lookback = 1; lookback <= MAX_RECENT_IMPULSE_LOOKBACK_DAYS; lookback += 1) {
    out[`${prefix}RecentImpulse${lookback}dCount`] = 0
  }
  return out
}

const buildStepARecentImpulseSummaryFields = (stats, prefix) => {
  const out = {
    [`${prefix}RecentImpulseDedupedCount`]: Number(stats[`${prefix}RecentImpulseDedupedCount`] ?? 0),
  }
  for (let lookback = 1; lookback <= MAX_RECENT_IMPULSE_LOOKBACK_DAYS; lookback += 1) {
    out[`${prefix}RecentImpulse${lookback}dCount`] = Number(
      stats[`${prefix}RecentImpulse${lookback}dCount`] ?? 0,
    )
  }
  return out
}

const makeStepAStats = () => ({
  rawEventCandidates: 0,
  passedEvents: 0,
  passedEventsEligible40d: 0,
  passedEventsEligible150d: 0,
  passedEventsEligibleMinWindow: 0,
  closeJumpPassCount: 0,
  candidateSameDayHigh8Count: 0,
  ...buildStepARecentImpulseStats("candidate"),
  passedSameDayHigh8Count: 0,
  ...buildStepARecentImpulseStats("passed"),
})

const collectClassic = async ({
  ctx,
  seriesMap,
  symbolMap,
  universeMap,
  highThreshold,
  closeThreshold,
  requireCloseJump,
  highJumpMode,
  recentImpulseDiscovery,
  localWindow,
  globalWindow,
  minWindow,
  reasonCounts,
  fullWriter,
  liteWriter
}) => {
  const stats = makeStepAStats()
  const symbolList = Array.from(seriesMap.keys()).sort((a, b) => a.localeCompare(b))
  const instrumentCache = new Map()

  for (const symbol of symbolList) {
    const series = seriesMap.get(symbol) ?? []
    const meta = symbolMap.get(symbol) ?? {
      symbol,
      name: symbol,
      type: "UNKNOWN",
      isListed: true
    }

    let inst = instrumentCache.get(symbol)
    if (!inst) {
      inst = evaluateInstrumentFilter({
        symbol,
        meta,
        cfg: ctx.config.filters
      })
      instrumentCache.set(symbol, inst)
    }

    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1]
      const today = series[i]
      const prevClose = num(prev.close)
      if (!isInRange(today.dateKey, ctx.periods.discovery)) continue

      const laneMeta = resolveStepAEventLaneMeta({
        series,
        decisionIdx: i,
        highThreshold,
        highJumpMode,
        recentImpulseDiscovery,
      })
      if (!laneMeta) continue
      stats.rawEventCandidates += 1
      bumpStepALaneStats(stats, laneMeta.stepALaneId, "candidate")

      if (!inst.pass) {
        for (const reason of inst.reasons) bump(reasonCounts, reason)
        continue
      }

      const universeRow = universeMap.get(`${symbol}:${prev.dateKey}`) ?? null
      const core = evaluateCoreFilters({
        cfg: ctx.config.filters,
        universeRow
      })
      if (!core.pass) {
        for (const reason of core.reasons) bump(reasonCounts, reason)
        continue
      }

      const asOfDateKey = String(prev.dateKey ?? "").trim()
      const prevCloseForGap = num(series[i - 2]?.close)
      const gap = evaluateGapTradabilityFilter({
        cfg: ctx.config.filters,
        prevClose: prevCloseForGap
      })
      if (!gap.pass) {
        for (const reason of gap.reasons) bump(reasonCounts, reason)
        continue
      }

      const close = Number(today.close)
      const eventTradingValueKrw = calcEventTradingValue(close, today.volume)
      const eventTvFilter = evaluateEventTradingValueFilter({
        cfg: ctx.config.filters,
        eventTradingValueKrw
      })
      if (!eventTvFilter.pass) {
        for (const reason of eventTvFilter.reasons) bump(reasonCounts, reason)
        continue
      }

      const closeRetPct = Number.isFinite(close) ? close / prevClose - 1 : null
      if (Number.isFinite(closeRetPct) && closeRetPct >= closeThreshold) {
        stats.closeJumpPassCount += 1
      }
      if (requireCloseJump && (!Number.isFinite(closeRetPct) || closeRetPct < closeThreshold)) {
        bump(reasonCounts, "CLOSE_JUMP_BELOW_THRESHOLD")
        continue
      }

      const hasLookback40d = i >= localWindow + 1
      const hasLookback150d = i >= globalWindow + 1
      const hasLookbackMinWindow = i >= minWindow + 1
      if (hasLookback40d) stats.passedEventsEligible40d += 1
      if (hasLookback150d) stats.passedEventsEligible150d += 1
      if (hasLookbackMinWindow) stats.passedEventsEligibleMinWindow += 1

      const candidate = {
        dateKey: today.dateKey,
        symbol,
        prevDateKey: prev.dateKey,
        asOfDateKey,
        prevClose,
        open: num(today.open),
        high: num(today.high),
        low: num(today.low),
        close: Number.isFinite(close) ? close : null,
        volume: num(today.volume),
        jumpPct: laneMeta.jumpPct,
        jumpPctFromPrevClose: laneMeta.jumpPctFromPrevClose,
        jumpPctFromOpen: laneMeta.jumpPctFromOpen,
        closeRetPct,
        gapOpenPct: Number.isFinite(num(today.open)) ? num(today.open) / prevClose - 1 : null,
        eventTradingValueKrw,
        hasLookback40d,
        hasLookback150d,
        hasLookbackMinWindow,
        stepALaneId: laneMeta.stepALaneId,
        impulseSourceDateKey: laneMeta.impulseSourceDateKey,
        impulseLookbackDays: laneMeta.impulseLookbackDays,
        impulseJumpPct: laneMeta.impulseJumpPct,
        impulseJumpPctFromPrevClose: laneMeta.impulseJumpPctFromPrevClose,
        impulseJumpPctFromOpen: laneMeta.impulseJumpPctFromOpen,
      }

      await emitEventRow({
        candidate,
        meta,
        universeRow,
        highJumpMode,
        fullWriter,
        liteWriter
      })
      stats.passedEvents += 1
      bumpStepALaneStats(stats, laneMeta.stepALaneId, "passed")
    }
  }

  return stats
}

const collectBitset = async ({
  ctx,
  seriesMap,
  symbolMap,
  universeMap,
  highThreshold,
  closeThreshold,
  requireCloseJump,
  highJumpMode,
  recentImpulseDiscovery,
  localWindow,
  globalWindow,
  minWindow,
  reasonCounts,
  fullWriter,
  liteWriter
}) => {
  const stats = makeStepAStats()
  const symbolList = Array.from(seriesMap.keys()).sort((a, b) => a.localeCompare(b))
  const instrumentCache = new Map()

  for (const symbol of symbolList) {
    const series = seriesMap.get(symbol) ?? []
    if (series.length < 2) continue

    const meta = symbolMap.get(symbol) ?? {
      symbol,
      name: symbol,
      type: "UNKNOWN",
      isListed: true
    }

    let inst = instrumentCache.get(symbol)
    if (!inst) {
      inst = evaluateInstrumentFilter({
        symbol,
        meta,
        cfg: ctx.config.filters
      })
      instrumentCache.set(symbol, inst)
    }

    const wordCount = Math.ceil(series.length / 32)
    const candidateBits = new Uint32Array(wordCount)
    const coreBits = new Uint32Array(wordCount)
    const gapBits = new Uint32Array(wordCount)
    const closeBits = requireCloseJump ? new Uint32Array(wordCount) : null
    const eventTvBits = new Uint32Array(wordCount)
    const candidateLaneMetaByIndex = new Array(series.length)

    for (let i = 1; i < series.length; i += 1) {
      const prev = series[i - 1]
      const today = series[i]
      const prevClose = num(prev.close)
      if (!isInRange(today.dateKey, ctx.periods.discovery)) continue

      const laneMeta = resolveStepAEventLaneMeta({
        series,
        decisionIdx: i,
        highThreshold,
        highJumpMode,
        recentImpulseDiscovery,
      })
      if (!laneMeta) continue
      stats.rawEventCandidates += 1
      bumpStepALaneStats(stats, laneMeta.stepALaneId, "candidate")
      setBit(candidateBits, i)
      candidateLaneMetaByIndex[i] = laneMeta

      if (!inst.pass) {
        for (const reason of inst.reasons) bump(reasonCounts, reason)
        continue
      }

      const universeRow = universeMap.get(`${symbol}:${prev.dateKey}`) ?? null
      const core = evaluateCoreFilters({
        cfg: ctx.config.filters,
        universeRow
      })
      if (!core.pass) {
        for (const reason of core.reasons) bump(reasonCounts, reason)
        continue
      }
      setBit(coreBits, i)

      const asOfDateKey = String(prev.dateKey ?? "").trim()
      const prevCloseForGap = num(series[i - 2]?.close)
      const gap = evaluateGapTradabilityFilter({
        cfg: ctx.config.filters,
        prevClose: prevCloseForGap
      })
      if (!gap.pass) {
        for (const reason of gap.reasons) bump(reasonCounts, reason)
        continue
      }
      setBit(gapBits, i)

      const close = num(today.close)
      const eventTradingValueKrw = calcEventTradingValue(close, today.volume)
      const eventTvFilter = evaluateEventTradingValueFilter({
        cfg: ctx.config.filters,
        eventTradingValueKrw
      })
      if (!eventTvFilter.pass) {
        for (const reason of eventTvFilter.reasons) bump(reasonCounts, reason)
        continue
      }
      setBit(eventTvBits, i)
      const closeRetPct = Number.isFinite(close) ? close / prevClose - 1 : null
      if (Number.isFinite(closeRetPct) && closeRetPct >= closeThreshold) {
        stats.closeJumpPassCount += 1
      }
      if (requireCloseJump) {
        if (!Number.isFinite(closeRetPct) || closeRetPct < closeThreshold) {
          bump(reasonCounts, "CLOSE_JUMP_BELOW_THRESHOLD")
          continue
        }
        setBit(closeBits, i)
      }
    }

    if (!inst.pass) continue

    for (let wordIdx = 0; wordIdx < wordCount; wordIdx += 1) {
      const closeWord = requireCloseJump ? closeBits[wordIdx] : 0xffffffff
      let word =
        (candidateBits[wordIdx] & coreBits[wordIdx] & gapBits[wordIdx] & eventTvBits[wordIdx] & closeWord) >>> 0
      while (word !== 0) {
        const lsb = word & -word
        const bitIdx = 31 - Math.clz32(lsb)
        const i = (wordIdx << 5) + bitIdx
        word = (word ^ lsb) >>> 0
        if (i < 1 || i >= series.length) continue
        const laneMeta = candidateLaneMetaByIndex[i]
        if (!laneMeta) continue

        const prev = series[i - 1]
        const today = series[i]
        const prevClose = num(prev.close)
        const open = num(today.open)
        const high = num(today.high)
        const close = num(today.close)
        const eventTradingValueKrw = calcEventTradingValue(close, today.volume)
        if (!Number.isFinite(prevClose) || !Number.isFinite(high)) continue

        const hasLookback40d = i >= localWindow + 1
        const hasLookback150d = i >= globalWindow + 1
        const hasLookbackMinWindow = i >= minWindow + 1
        if (hasLookback40d) stats.passedEventsEligible40d += 1
        if (hasLookback150d) stats.passedEventsEligible150d += 1
        if (hasLookbackMinWindow) stats.passedEventsEligibleMinWindow += 1

        const candidate = {
          dateKey: today.dateKey,
          symbol,
          prevDateKey: prev.dateKey,
          asOfDateKey: prev.dateKey,
          prevClose,
          open: open ?? null,
          high,
          low: num(today.low),
          close: close ?? null,
          volume: num(today.volume),
          jumpPct: laneMeta.jumpPct,
          jumpPctFromPrevClose: laneMeta.jumpPctFromPrevClose,
          jumpPctFromOpen: laneMeta.jumpPctFromOpen,
          closeRetPct: Number.isFinite(close) ? close / prevClose - 1 : null,
          gapOpenPct: Number.isFinite(open) ? open / prevClose - 1 : null,
          eventTradingValueKrw,
          hasLookback40d,
          hasLookback150d,
          hasLookbackMinWindow,
          stepALaneId: laneMeta.stepALaneId,
          impulseSourceDateKey: laneMeta.impulseSourceDateKey,
          impulseLookbackDays: laneMeta.impulseLookbackDays,
          impulseJumpPct: laneMeta.impulseJumpPct,
          impulseJumpPctFromPrevClose: laneMeta.impulseJumpPctFromPrevClose,
          impulseJumpPctFromOpen: laneMeta.impulseJumpPctFromOpen,
        }
        const universeRow = universeMap.get(`${symbol}:${prev.dateKey}`) ?? null

        await emitEventRow({
          candidate,
          meta,
          universeRow,
          highJumpMode,
          fullWriter,
          liteWriter
        })
        stats.passedEvents += 1
        bumpStepALaneStats(stats, laneMeta.stepALaneId, "passed")
      }
    }
  }
  return stats
}

const collectDuckdbBitset = async ({
  ctx,
  candidateTsvPath,
  symbolMap,
  closeThreshold,
  requireCloseJump,
  highJumpMode,
  reasonCounts,
  fullWriter,
  liteWriter
}) => {
  const stats = makeStepAStats()
  const instrumentCache = new Map()
  await streamDuckdbRowsBySymbol(candidateTsvPath, async (symbol, rawRows) => {
    const rows = rawRows
    if (!rows.length) return

    const meta = symbolMap.get(symbol) ?? {
      symbol,
      name: symbol,
      type: "UNKNOWN",
      isListed: true
    }
    let inst = instrumentCache.get(symbol)
    if (!inst) {
      inst = evaluateInstrumentFilter({
        symbol,
        meta,
        cfg: ctx.config.filters
      })
      instrumentCache.set(symbol, inst)
    }

    const wordCount = Math.ceil(rows.length / 32)
    const coreBits = new Uint32Array(wordCount)
    const gapBits = new Uint32Array(wordCount)
    const closeBits = requireCloseJump ? new Uint32Array(wordCount) : null
    const eventTvBits = new Uint32Array(wordCount)

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i]
      const dateKey = String(raw?.dateKey ?? "").trim()
      if (!isInRange(dateKey, ctx.periods.discovery)) continue
      const stepALaneId = String(raw?.stepALaneId ?? "").trim()
      if (!stepALaneId) {
        throw new Error(`DuckDB Step A candidate row missing stepALaneId for ${symbol}:${dateKey}`)
      }
      stats.rawEventCandidates += 1
      bumpStepALaneStats(stats, stepALaneId, "candidate")
      if (!inst.pass) {
        for (const reason of inst.reasons) bump(reasonCounts, reason)
        continue
      }

      const prevDateKey = String(raw?.prevDateKey ?? "").trim()
      const asOfDateKey = String(raw?.asOfDateKey ?? prevDateKey).trim()
      if (!raw?.corePass) {
        bump(reasonCounts, "CORE_FILTER_FAIL")
        continue
      }
      setBit(coreBits, i)

      const gap = evaluateGapTradabilityFilter({
        cfg: ctx.config.filters,
        prevClose: num(raw?.prevCloseForGap)
      })
      if (!gap.pass) {
        for (const reason of gap.reasons) bump(reasonCounts, reason)
        continue
      }
      setBit(gapBits, i)

      const closeRetPct = num(raw?.closeRetPct)
      const eventTradingValueKrw = calcEventTradingValue(num(raw?.close), num(raw?.volume))
      const eventTvFilter = evaluateEventTradingValueFilter({
        cfg: ctx.config.filters,
        eventTradingValueKrw
      })
      if (!eventTvFilter.pass) {
        for (const reason of eventTvFilter.reasons) bump(reasonCounts, reason)
        continue
      }
      setBit(eventTvBits, i)
      if (Number.isFinite(closeRetPct) && closeRetPct >= closeThreshold) {
        stats.closeJumpPassCount += 1
      }
      if (requireCloseJump) {
        if (!Number.isFinite(closeRetPct) || closeRetPct < closeThreshold) {
          bump(reasonCounts, "CLOSE_JUMP_BELOW_THRESHOLD")
          continue
        }
        setBit(closeBits, i)
      }
    }

    for (let wordIdx = 0; wordIdx < wordCount; wordIdx += 1) {
      const closeWord = requireCloseJump ? closeBits[wordIdx] : 0xffffffff
      let word = (coreBits[wordIdx] & gapBits[wordIdx] & eventTvBits[wordIdx] & closeWord) >>> 0
      while (word !== 0) {
        const lsb = word & -word
        const bitIdx = 31 - Math.clz32(lsb)
        const i = (wordIdx << 5) + bitIdx
        word = (word ^ lsb) >>> 0
        if (i < 0 || i >= rows.length) continue

        const raw = rows[i]
        const prevDateKey = String(raw?.prevDateKey ?? "").trim()
        const asOfDateKey = String(raw?.asOfDateKey ?? prevDateKey).trim()
        const stepALaneId = String(raw?.stepALaneId ?? "").trim() || null
        const candidate = {
          dateKey: String(raw?.dateKey ?? "").trim(),
          symbol,
          prevDateKey,
          asOfDateKey,
          prevClose: num(raw?.prevClose),
          open: num(raw?.open),
          high: num(raw?.high),
          low: num(raw?.low),
          close: num(raw?.close),
          volume: num(raw?.volume),
          jumpPct: num(raw?.jumpPct),
          jumpPctFromPrevClose: num(raw?.jumpPctFromPrevClose),
          jumpPctFromOpen: num(raw?.jumpPctFromOpen),
          closeRetPct: num(raw?.closeRetPct),
          gapOpenPct: num(raw?.gapOpenPct),
          eventTradingValueKrw: calcEventTradingValue(num(raw?.close), num(raw?.volume)),
          hasLookback40d: Boolean(raw?.hasLookback40d),
          hasLookback150d: Boolean(raw?.hasLookback150d),
          hasLookbackMinWindow: Boolean(raw?.hasLookbackMinWindow),
          avgTradingValue20d: num(raw?.avgTradingValue20d),
          marketCapKrw: num(raw?.marketCapKrw),
          stepALaneId,
          impulseSourceDateKey: String(raw?.impulseSourceDateKey ?? "").trim() || null,
          impulseLookbackDays: num(raw?.impulseLookbackDays),
          impulseJumpPct: num(raw?.impulseJumpPct),
          impulseJumpPctFromPrevClose: num(raw?.impulseJumpPctFromPrevClose),
          impulseJumpPctFromOpen: num(raw?.impulseJumpPctFromOpen),
        }
        if (candidate.hasLookback40d) {
          stats.passedEventsEligible40d += 1
        }
        if (candidate.hasLookback150d) {
          stats.passedEventsEligible150d += 1
        }
        if (candidate.hasLookbackMinWindow) {
          stats.passedEventsEligibleMinWindow += 1
        }

        await emitEventRow({
          candidate,
          meta,
          universeRow: null,
          highJumpMode,
          fullWriter,
          liteWriter
        })
        stats.passedEvents += 1
        bumpStepALaneStats(stats, stepALaneId, "passed")
      }
    }
  })

  return stats
}

export const runStepA = async (ctx) => {
  const outDir = path.join(ctx.runDir, "step-a")
  await ensureDir(outDir)

  const highThreshold = Number(ctx.config.event.highJumpThreshold ?? 0.08)
  const closeThreshold = Number(ctx.config.event.closeJumpThreshold ?? 0.08)
  const requireCloseJump = Boolean(ctx.config.event?.requireCloseJump)
  const highJumpMode = resolveHighJumpMode(ctx.config.event?.highJumpMode)
  const recentImpulseDiscovery = resolveRecentImpulseDiscovery(ctx.config.event?.recentImpulseDiscovery)
  const reasonCounts = {}
  const localWindow = resolveLocalWindow(ctx.config)
  const globalWindow = resolveGlobalWindow(ctx.config)
  const minWindow = Math.max(localWindow, globalWindow)
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const stepACfg = lightweightCfg?.stepA ?? {}
  const outputMode = normalizeOutputMode(lightweightCfg?.stepA?.outputMode, "both")
  const writeFull = shouldWriteFull(outputMode)
  const writeLite = shouldWriteLite(outputMode)
  const requestedEngine = resolveStepAEngine(stepACfg?.engine)
  if (ctx.config?.guardrails?.enforceStepAEngineDuckdb !== false && requestedEngine !== "duckdb") {
    throw new Error(
      `Strict mode: lightweight.stepA.engine must be duckdb, got ${requestedEngine}`,
    )
  }
  const bitsetEnabled = stepACfg?.bitset?.enabled !== false
  const duckdbEnabled = stepACfg?.duckdb?.enabled !== false
  const duckdbCliPath = String(stepACfg?.duckdb?.cliPath ?? "duckdb")
  const duckdbDatabasePath = String(stepACfg?.duckdb?.databasePath ?? ":memory:")

  const eventsPath = writeFull ? path.join(outDir, "events_high8.jsonl") : null
  const eventsLitePath = writeLite ? path.join(outDir, "events_high8_lite.jsonl") : null
  const summaryPath = path.join(outDir, "step_a_summary.json")
  const fullWriter = writeFull ? await createJsonlWriter(eventsPath) : null
  const liteWriter = writeLite ? await createJsonlWriter(eventsLitePath) : null

  let resolvedEngine = requestedEngine
  let duckdbProbe = { ok: false, cliPath: duckdbCliPath, argsStyle: null }
  if (resolvedEngine === "duckdb") {
    if (!duckdbEnabled) {
      throw new Error("Step A engine=duckdb but lightweight.stepA.duckdb.enabled is false")
    }
    duckdbProbe = await probeDuckdbCli({
      cliPath: duckdbCliPath,
      cwd: ctx.cwd
    })
    if (!duckdbProbe.ok) {
      throw new Error(
        [
          "Step A requires duckdb CLI but it is not available.",
          `cliPath=${duckdbCliPath}`,
          "Fix root cause: install duckdb on server or set lightweight.stepA.engine to bitset/classic explicitly."
        ].join(" "),
      )
    }
  }
  if (resolvedEngine === "bitset" && !bitsetEnabled) {
    throw new Error("Step A engine=bitset but lightweight.stepA.bitset.enabled is false")
  }

  let data = null
  let universeMap = null
  let symbolMap = null
  let seriesMap = null
  let stats = makeStepAStats()
  let duckdbMeta = null
  try {
    if (resolvedEngine === "duckdb") {
      const supplemental = await loadStepASupplementalData(ctx.config.dataPaths, {
        includeHourly60m: false
      })
      data = { ...supplemental, candles: [] }
      symbolMap = buildSymbolMasterMap(data.symbolMaster)

      const rawPath = path.join(outDir, "duckdb_raw_candidates.tsv")
      const q = await runDuckdbStepACandidateQuery({
        cliPath: duckdbCliPath,
        argsStyle: duckdbProbe.argsStyle ?? "implicit-db",
        databasePath: duckdbDatabasePath,
        candlesPath: path.resolve(ctx.cwd, ctx.config.dataPaths.candleDailyJsonl),
        universePath: path.resolve(ctx.cwd, ctx.config.dataPaths.universeJsonl),
        outPath: rawPath,
        dateFrom: ctx.periods.discovery.from,
        dateTo: ctx.periods.discovery.to,
        highThreshold,
        highJumpMode,
        recentImpulseLookbackTradingDays: recentImpulseDiscovery.lookbackTradingDays,
        localWindow,
        globalWindow,
        minWindow,
        coreFilter: ctx.config?.filters
      })
      duckdbMeta = {
        cliPath: duckdbCliPath,
        argsStyle: duckdbProbe.argsStyle,
        rawPath: q.outPath,
        rawCandidates: null
      }
      stats = await collectDuckdbBitset({
        ctx,
        candidateTsvPath: q.outPath,
        symbolMap,
        closeThreshold,
        requireCloseJump,
        highJumpMode,
        reasonCounts,
        fullWriter,
        liteWriter
      })
      duckdbMeta.rawCandidates = stats.rawEventCandidates
    }

    if (resolvedEngine === "classic" || resolvedEngine === "bitset") {
      data = await loadStepAData(ctx.config.dataPaths, {
        includeHourly60m: false
      })
      seriesMap = buildCandleSeriesMap(data.candles)
      universeMap = buildUniverseMap(data.universe)
      symbolMap = buildSymbolMasterMap(data.symbolMaster)

      if (resolvedEngine === "bitset") {
        stats = await collectBitset({
          ctx,
          seriesMap,
          symbolMap,
          universeMap,
          highThreshold,
          closeThreshold,
          requireCloseJump,
          highJumpMode,
          recentImpulseDiscovery,
          localWindow,
          globalWindow,
          minWindow,
          reasonCounts,
          fullWriter,
          liteWriter
        })
      } else {
        stats = await collectClassic({
          ctx,
          seriesMap,
          symbolMap,
          universeMap,
          highThreshold,
          closeThreshold,
          requireCloseJump,
          highJumpMode,
          recentImpulseDiscovery,
          localWindow,
          globalWindow,
          minWindow,
          reasonCounts,
          fullWriter,
          liteWriter
        })
      }
    }
  } finally {
    if (fullWriter) await fullWriter.close()
    if (liteWriter) await liteWriter.close()
  }

  const summary = {
    step: "A",
    eventLabel: ctx.config.event.labelName,
    highJumpThreshold: highThreshold,
    highJumpMode,
    recentImpulseDiscovery,
    outputMode,
    engineRequested: requestedEngine,
    engineResolved: resolvedEngine,
    duckdb: {
      enabled: duckdbEnabled,
      available: duckdbProbe.ok,
      cliPath: duckdbCliPath,
      argsStyle: duckdbProbe.argsStyle,
      query: duckdbMeta
    },
    engineComposition: resolvedEngine === "duckdb" ? "duckdb+bitset" : resolvedEngine,
    closeJumpThreshold: closeThreshold,
    minEventTradingValueKrw: Number(ctx.config?.filters?.minEventTradingValueKrw ?? 0),
    requireCloseJump,
    localWindow,
    globalWindow,
    minWindow,
    period: ctx.periods.discovery,
    rawEventCandidates: stats.rawEventCandidates,
    passedEvents: stats.passedEvents,
    passedEventsEligible40d: stats.passedEventsEligible40d,
    passedEventsEligible150d: stats.passedEventsEligible150d,
    passedEventsEligibleMinWindow: stats.passedEventsEligibleMinWindow,
    passedEventsNotEligibleBy40d: Math.max(0, stats.passedEvents - stats.passedEventsEligible40d),
    passedEventsNotEligibleBy150d: Math.max(0, stats.passedEvents - stats.passedEventsEligible150d),
    passedEventsNotEligibleByMinWindow: Math.max(
      0,
      stats.passedEvents - stats.passedEventsEligibleMinWindow,
    ),
    closeJumpPassCount: stats.closeJumpPassCount,
    candidateSameDayHigh8Count: stats.candidateSameDayHigh8Count,
    passedSameDayHigh8Count: stats.passedSameDayHigh8Count,
    ...buildStepARecentImpulseSummaryFields(stats, "candidate"),
    ...buildStepARecentImpulseSummaryFields(stats, "passed"),
    droppedByReason: reasonCounts,
    datasetRows: {
      candles: data?.candles?.length ?? null,
      universe: data?.universe?.length ?? null,
      symbolMaster: data?.symbolMaster?.length ?? 0,
      hourly60m: data?.hourly60m?.length ?? 0
    },
    outputs: {
      eventsPath,
      eventsLitePath
    }
  }

  await writeJson(summaryPath, summary)

  return {
    step: "A",
    eventsPath,
    eventsLitePath,
    summaryPath,
    summary
  }
}
