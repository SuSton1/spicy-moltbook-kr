import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import os from "node:os"
import dotenv from "dotenv"
import { spawnSync } from "node:child_process"

import { PrismaClient } from "@prisma/client"

import {
  firstDayOfMonth,
  normalizeDateKey,
  shiftDateKeyByMonths,
} from "../ai-date-range.lib.mjs"
import {
  resolveLastTradingDateKey,
  resolveTradingCalendarRange,
} from "../lib/tradingCalendar.mjs"
import {
  buildWeeklySeries,
  buildWeeklyMetrics,
  countNoFillResults,
  computeBigUpMetrics,
  runBacktest,
  buildCandleMap,
} from "../lib/backtest.mjs"
import { buildLevelPlan, DEFAULT_LEVEL_POLICY } from "../lib/levelPolicy.mjs"
import {
  evaluateMinPlanProfit,
  getThresholdPct,
} from "../lib/minPlanProfitGate.mjs"
import { recommendFromData } from "../lib/recommend.mjs"
import { selectPatternVersionLabel } from "../lib/patternVersions.mjs"
import { filterCandlesToPrevTradingDay } from "../lib/gap15.mjs"
import { isTradableAt1500 } from "../lib/tradability15.mjs"
import { requireAdminIfConfigured } from "../lib/adminGuard.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"
import { toWeekKeyKst } from "../lib/weekKey.mjs"
import {
  assertGapPatternSafe,
  buildGapDataForDate,
  resolvePrevTradingDay,
} from "./gapLookahead.mjs"
import {
  evaluateWeeklySummary,
  hashToVersion,
  resolveRampCostModel,
} from "./lib.mjs"
import { computeMoonshot4wStats } from "./moonshot4wValidation.mjs"
import { meanLowerBound, safeNumber, wilsonLowerBound } from "./lcb.mjs"
import {
  BASE_BRAND_PREFIXES,
  discoverBrandPrefixes,
  resolveBrandPrefixes,
} from "../lib/krxInstrumentHeuristics.mjs"
import {
  instrumentExclusionReasons,
  marketCapExclusionReasons,
} from "../lib/eligibilityPolicy.mjs"
import {
  buildNextCyclePlan,
  buildNextCyclePlanPayload,
  buildWeekKeysForRange,
  detectFreezeViolation,
  detectWindowDrift,
  listWeekKeysForCalendar,
  normalizeCalendar,
  resolveWeekWindowFromCalendar,
  resolveCycleWindows,
} from "./cycleUtils.mjs"
import {
  cycleStatePath,
  ensureReviewDir,
  formatKstStamp,
  hashPayload,
  readCycleState,
  resolveGitInfo,
  reviewDir,
} from "./cycleState.mjs"
import { buildPostmortemReport } from "../reports/lockbox_postmortem.mjs"

const rootDir = process.cwd()
const DEFAULT_RAMP_ASOF_DATE_KEY = "2026-02-13"
const MOONSHOT_GATE_SCOPE = "validation_lockbox_deploy"
const MOONSHOT_GATE_FAILED = "MOONSHOT_GATE_FAILED"
const MOONSHOT_STRATEGY_PREFIX = String(
  process.env.CYCLE_MOONSHOT_STRATEGY_PREFIX ??
    process.env.MOONSHOT_STRATEGY_PREFIX ??
    "",
).trim()

const hasSurgeCandidate = (candidates) =>
  (candidates ?? []).some(
    (row) =>
      String(row?.track ?? "").toUpperCase() === "SURGE_EOD" && !row?.blocked,
  )

const selectSurgePatternVersionLabel = (candidates) => {
  const surge = (candidates ?? []).find(
    (row) => String(row?.track ?? "").toUpperCase() === "SURGE_EOD",
  )
  const label = String(surge?.patternVersionLabel ?? "").trim()
  return label || null
}

const parseBooleanEnv = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  for (const file of candidates) {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  }
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => {
    const match = args.find((arg) => arg.startsWith(`${key}=`))
    return match ? match.slice(key.length + 1) : null
  }
  const hasFlag = (key) => args.includes(key)
  const rawAsOfArg = getValue("--asOf") ?? getValue("--asof")
  const rawAsOf = rawAsOfArg ?? DEFAULT_RAMP_ASOF_DATE_KEY
  const dryRun = hasFlag("--dryRun") || getValue("--dryRun") === "1"
  const enableAutoAdvance = hasFlag("--enableAutoAdvance")
  const disableAutoAdvance = hasFlag("--disableAutoAdvance")
  const autoAdvance = hasFlag("--autoAdvance")
  const adminKey = getValue("--adminKey") ?? getValue("--admin-key") ?? null
  const minWorst2wAvgPctRaw = Number(getValue("--minWorst2wAvgPct"))
  const minWorst2wAvgPct = Number.isFinite(minWorst2wAvgPctRaw)
    ? minWorst2wAvgPctRaw
    : -1.5
  return {
    rawAsOf: normalizeDateKey(rawAsOf) ?? rawAsOf,
    asOfExplicit: rawAsOfArg !== null,
    minWorst2wAvgPct,
    dryRun,
    enableAutoAdvance,
    disableAutoAdvance,
    autoAdvance,
    adminKey,
  }
}

const clampMemoryNumber = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.max(min, Math.min(max, n))
}

const maxDateKey = (current, candidate) => {
  const normalized = normalizeDateKey(candidate)
  if (!normalized) {
    return current
  }
  if (!current || normalized > current) {
    return normalized
  }
  return current
}

const resolveLatestMarketDataDateKey = async (prisma) => {
  const [adjustedDateKey, candleDateKey, price15DateKey] = await Promise.all([
    prisma.candleDailyAdjusted
      .findFirst({
        orderBy: { dateKey: "desc" },
        select: { dateKey: true },
      })
      .then((row) => row?.dateKey ?? null)
      .catch(() => null),
    prisma.candleDaily
      .findFirst({
        orderBy: { dateKey: "desc" },
        select: { dateKey: true },
      })
      .then((row) => row?.dateKey ?? null)
      .catch(() => null),
    prisma.price15
      .findFirst({
        orderBy: { tradingDateKey: "desc" },
        select: { tradingDateKey: true },
      })
      .then((row) => row?.tradingDateKey ?? null)
      .catch(() => null),
  ])
  let latest = null
  latest = maxDateKey(latest, adjustedDateKey)
  latest = maxDateKey(latest, candleDateKey)
  latest = maxDateKey(latest, price15DateKey)
  return latest
}

const checkSystemMemoryHeadroom = ({
  stage,
  minFreeRatio = 0.08,
  minFreeMb = 1024,
}) => {
  const total = Number(os.totalmem() ?? 0) || 0
  const free = Number(os.freemem() ?? 0) || 0
  if (total <= 0 || free <= 0) {
    return { totalMb: 0, freeMb: 0, freeRatio: 0 }
  }
  const freeRatio = free / total
  const freeMb = Math.round(free / 1024 / 1024)
  const totalMb = Math.round(total / 1024 / 1024)
  const ratioOk = freeRatio >= minFreeRatio
  const mbOk = freeMb >= minFreeMb
  if (!ratioOk && !mbOk) {
    throw new Error(
      `CYCLE_MEMORY_GUARD stage=${stage} freeMb=${freeMb} totalMb=${totalMb} freeRatio=${freeRatio.toFixed(3)} minFreeMb=${minFreeMb} minFreeRatio=${minFreeRatio.toFixed(3)}`,
    )
  }
  return { totalMb, freeMb, freeRatio }
}

const acquireLock = () => {
  ensureReviewDir()
  const lockPath = path.join(reviewDir, ".cycle_run.lock")
  const now = Date.now()
  const staleMs = 6 * 60 * 60_000
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath)
    if (now - stat.mtimeMs > staleMs) {
      fs.unlinkSync(lockPath)
    }
  }
  const fd = fs.openSync(lockPath, "wx")
  const release = () => {
    try {
      fs.closeSync(fd)
    } catch {}
    try {
      fs.unlinkSync(lockPath)
    } catch {}
  }
  process.on("exit", release)
  process.on("SIGINT", () => {
    release()
    process.exit(1)
  })
  process.on("SIGTERM", () => {
    release()
    process.exit(1)
  })
  return { lockPath, release }
}

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeText = (filePath, lines) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8")
}

const writeJsonGuarded = (filePath, payload, adminKey) => {
  requireAdminIfConfigured(adminKey)
  writeJson(filePath, payload)
}

const writeTextGuarded = (filePath, lines, adminKey) => {
  requireAdminIfConfigured(adminKey)
  writeText(filePath, lines)
}

const buildPrice15Map = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    const price = Number(row?.price)
    if (!symbol || !dateKey || !Number.isFinite(price)) continue
    map.set(`${symbol}:${dateKey}`, price)
  }
  return map
}

const buildCandleSeriesMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) continue
    const list = map.get(symbol) ?? []
    list.push({
      dateKey,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })
    map.set(symbol, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
  }
  return map
}

const resolveNextTradingDateKey = ({ calendar, dateKey }) => {
  const target = String(dateKey ?? "").trim()
  const list = Array.isArray(calendar) ? calendar : []
  if (!target || list.length === 0) {
    return null
  }
  const idx = list.findIndex((key) => key === target)
  if (idx >= 0) {
    return idx + 1 < list.length ? list[idx + 1] : null
  }
  for (const key of list) {
    if (String(key) > target) {
      return key
    }
  }
  return null
}

const clampRatio = (value, fallback) => {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return fallback
  }
  return Math.max(0, Math.min(1, raw))
}

const clampInt = (value, fallback, min, max) => {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

const incrementReasonCounter = (counter, reason) => {
  const key = String(reason ?? "UNKNOWN").trim() || "UNKNOWN"
  counter.set(key, (Number(counter.get(key) ?? 0) || 0) + 1)
}

const summarizeReasonCounter = (counter, limit = 20) => {
  const rows = Array.from(counter.entries()).map(([reason, count]) => ({
    reason,
    count: Number(count ?? 0) || 0,
  }))
  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.reason.localeCompare(b.reason)
  })
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 20))
  return {
    totalKinds: rows.length,
    totalCount: rows.reduce((acc, row) => acc + row.count, 0),
    top: rows.slice(0, safeLimit),
  }
}

const buildRunCycleConfigSanity = ({
  status,
  asOfDateKey,
  validation,
  lockbox,
  trainFromDateKey,
  trainToDateKey,
}) => {
  const errors = []
  const warnings = []
  const safeStatus = String(status ?? "")
    .trim()
    .toUpperCase()
  if (!asOfDateKey) errors.push("ASOF_EMPTY")
  if (!validation?.fromDateKey || !validation?.toDateKey) {
    errors.push("VALIDATION_WINDOW_MISSING")
  }
  if (!lockbox?.fromDateKey || !lockbox?.toDateKey) {
    errors.push("LOCKBOX_WINDOW_MISSING")
  }
  if (validation?.fromDateKey && validation?.toDateKey) {
    if (validation.fromDateKey > validation.toDateKey) {
      errors.push("VALIDATION_WINDOW_REVERSED")
    }
    if ((validation.weekKeys ?? []).length < 4) {
      warnings.push("VALIDATION_WEEKS_SHORT")
    }
  }
  if (lockbox?.fromDateKey && lockbox?.toDateKey) {
    if (lockbox.fromDateKey > lockbox.toDateKey) {
      errors.push("LOCKBOX_WINDOW_REVERSED")
    }
    if ((lockbox.weekKeys ?? []).length < 4) {
      warnings.push("LOCKBOX_WEEKS_SHORT")
    }
  }
  if (validation?.toDateKey && lockbox?.fromDateKey) {
    if (validation.toDateKey > lockbox.fromDateKey) {
      warnings.push("VALIDATION_LOCKBOX_OVERLAP")
    }
  }
  if (!trainFromDateKey || !trainToDateKey) {
    errors.push("TRAIN_RANGE_MISSING")
  } else if (trainFromDateKey > trainToDateKey) {
    errors.push("TRAIN_RANGE_REVERSED")
  }
  const allowedStatuses = new Set([
    "VALIDATION_TUNING",
    "WAITING_FOR_MORE_DATA",
    "LOCKBOX_IN_PROGRESS",
    "LOCKBOX_PASSED",
    "LOCKBOX_FAILED",
    "BLOCKED_BY_DATA",
    MOONSHOT_GATE_FAILED,
    "FREEZE_VIOLATION",
  ])
  if (safeStatus && !allowedStatuses.has(safeStatus)) {
    warnings.push("STATUS_UNKNOWN")
  }
  return {
    pass: errors.length === 0,
    errors,
    warnings,
    reviewedAt: new Date().toISOString(),
  }
}

const summarizeRunCycleFailures = ({
  status,
  passFailSummary,
  attemptLogSummary,
}) => {
  const globalCounter = new Map()
  const byTrack = new Map()
  const add = (reason, track = null) => {
    incrementReasonCounter(globalCounter, reason)
    if (!track) return
    const key = String(track).trim()
    if (!key) return
    const trackCounter = byTrack.get(key) ?? new Map()
    incrementReasonCounter(trackCounter, reason)
    byTrack.set(key, trackCounter)
  }

  const summary = passFailSummary ?? {}
  const blockedReason = String(summary?.reason ?? "").trim()
  if (blockedReason) {
    add(blockedReason, summary?.track ?? null)
  }
  for (const issue of summary?.coverageIssues ?? []) {
    add(`COVERAGE_${String(issue ?? "").trim()}`, summary?.track ?? null)
  }
  const resultRows = Array.isArray(summary?.results) ? summary.results : []
  for (const row of resultRows) {
    if (row?.pass === true) continue
    const track = String(row?.track ?? "").trim() || null
    const reason =
      String(row?.reason ?? "").trim() ||
      (row?.moonshotGate?.pass === false
        ? MOONSHOT_GATE_FAILED
        : "LOCKBOX_POLICY_FAIL")
    add(reason, track)
  }
  const moonshotReason = String(
    attemptLogSummary?.moonshotGateReason ?? "",
  ).trim()
  if (moonshotReason) {
    add(moonshotReason, "SURGE_EOD")
  }
  if (
    String(status ?? "")
      .trim()
      .toUpperCase() === MOONSHOT_GATE_FAILED
  ) {
    add(MOONSHOT_GATE_FAILED, "SURGE_EOD")
  }
  return {
    global: summarizeReasonCounter(globalCounter),
    byTrack: Object.fromEntries(
      Array.from(byTrack.entries()).map(([track, counter]) => [
        track,
        summarizeReasonCounter(counter),
      ]),
    ),
  }
}

const countUniqueSymbolsAtDate = (rows, dateField, dateKey) => {
  const target = String(dateKey ?? "").trim()
  if (!target) {
    return 0
  }
  const set = new Set()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const rowDate = String(row?.[dateField] ?? "").trim()
    if (!symbol || rowDate !== target) {
      continue
    }
    set.add(symbol)
  }
  return set.size
}

const safeRatio = (num, den) => {
  const n = Number(num)
  const d = Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0
  }
  return n / d
}

const buildDataCoverageSnapshot = ({ data, track, asOfDateKey }) => {
  const universeAtAsOf = countUniqueSymbolsAtDate(
    data?.universe,
    "tradingDateKey",
    asOfDateKey,
  )
  const featureAtAsOf = countUniqueSymbolsAtDate(
    data?.featureDays,
    "tradingDateKey",
    asOfDateKey,
  )
  const intradayAtAsOf = countUniqueSymbolsAtDate(
    data?.intradayProfiles,
    "tradingDateKey",
    asOfDateKey,
  )
  const price15AtAsOf =
    track === "GAP_15_BET"
      ? countUniqueSymbolsAtDate(data?.price15, "tradingDateKey", asOfDateKey)
      : 0
  const hourlyAtAsOf =
    track === "GAP_15_BET"
      ? countUniqueSymbolsAtDate(data?.hourly60m, "tradingDateKey", asOfDateKey)
      : 0
  return {
    universeAtAsOf,
    featureAtAsOf,
    intradayAtAsOf,
    price15AtAsOf,
    hourlyAtAsOf,
    featureVsUniverse: safeRatio(featureAtAsOf, universeAtAsOf),
    intradayVsUniverse: safeRatio(intradayAtAsOf, universeAtAsOf),
    price15VsUniverse: safeRatio(price15AtAsOf, universeAtAsOf),
    hourlyVsUniverse: safeRatio(hourlyAtAsOf, universeAtAsOf),
  }
}

const assessTrackDataReadiness = ({ track, data, asOfDateKey, thresholds }) => {
  const missing = []
  if (!data?.candles?.length) missing.push("CANDLE_MISSING")
  if (!data?.universe?.length) missing.push("UNIVERSE_MISSING")
  if (!data?.featureDays?.length) missing.push("FEATURE_MISSING")
  if (!data?.intradayProfiles?.length) missing.push("INTRADAY_MISSING")
  if (track === "GAP_15_BET" && !data?.price15?.length) {
    missing.push("PRICE15_MISSING")
  }
  const coverage = buildDataCoverageSnapshot({ data, track, asOfDateKey })
  const coverageIssues = []
  if (coverage.universeAtAsOf <= 0) {
    coverageIssues.push("UNIVERSE_ASOF_EMPTY")
  }
  if (coverage.featureVsUniverse < thresholds.featureVsUniverse) {
    coverageIssues.push("FEATURE_COVERAGE_LOW")
  }
  if (coverage.intradayVsUniverse < thresholds.intradayVsUniverse) {
    coverageIssues.push("INTRADAY_COVERAGE_LOW")
  }
  if (track === "GAP_15_BET") {
    if (coverage.price15VsUniverse < thresholds.price15VsUniverse) {
      coverageIssues.push("PRICE15_COVERAGE_LOW")
    }
    if (coverage.hourlyVsUniverse < thresholds.hourlyVsUniverse) {
      coverageIssues.push("HOURLY_COVERAGE_LOW")
    }
  }
  const ok = missing.length === 0 && coverageIssues.length === 0
  return {
    ok,
    reason: missing.length
      ? "MISSING_DATA"
      : coverageIssues.length
        ? "DATA_COVERAGE_LOW"
        : null,
    missing,
    coverage,
    coverageIssues,
  }
}

const loadMoonshotValidationOutcomes = async ({
  prisma,
  validationStartDateKey,
  validationEndDateKey,
  calendar,
  strategyVersion = null,
  strategyVersionPrefix = null,
  patternVersionLabel = null,
  activeOnly = true,
}) => {
  const start = normalizeDateKey(validationStartDateKey)
  const end = normalizeDateKey(validationEndDateKey)
  if (!start || !end) {
    return []
  }
  const signals = await prisma.aiSignal
    .findMany({
      where: {
        tradingDateKey: { gte: start, lte: end },
        track: "SURGE_EOD",
        role: "MOONSHOT",
        policyType: "RECOMMEND",
        mode: "EOD",
        ...(activeOnly
          ? {
              status: "ACTIVE",
              emitStatus: "EMITTED",
            }
          : {}),
      },
      select: {
        symbol: true,
        tradingDateKey: true,
        detail: { select: { whyJson: true } },
      },
    })
    .catch(() => [])
  if (!signals.length) {
    return []
  }
  const strategyFilter = String(strategyVersion ?? "").trim()
  const strategyPrefixFilter = String(strategyVersionPrefix ?? "").trim()
  const patternFilter = String(patternVersionLabel ?? "").trim()
  const filteredSignals = signals.filter((row) => {
    const why = row?.detail?.whyJson
    const signalPattern = String(why?.patternVersionLabel ?? "").trim()
    const signalStrategy = String(why?.strategyVersion ?? "").trim()
    if (patternFilter && signalPattern !== patternFilter) {
      return false
    }
    if (
      strategyFilter &&
      (!signalStrategy || signalStrategy !== strategyFilter)
    ) {
      return false
    }
    if (
      strategyPrefixFilter &&
      (!signalStrategy || !signalStrategy.startsWith(strategyPrefixFilter))
    ) {
      return false
    }
    return true
  })
  if (!filteredSignals.length) {
    return []
  }
  const signalRefs = []
  const neededSymbols = new Set()
  const neededDateKeys = new Set()
  for (const signal of filteredSignals) {
    const symbol = String(signal?.symbol ?? "").trim()
    const dateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const nextDateKey = resolveNextTradingDateKey({ calendar, dateKey })
    if (!nextDateKey) {
      continue
    }
    signalRefs.push({ symbol, dateKey, nextDateKey })
    neededSymbols.add(symbol)
    neededDateKeys.add(dateKey)
    neededDateKeys.add(nextDateKey)
  }
  if (!signalRefs.length || !neededSymbols.size || !neededDateKeys.size) {
    return []
  }
  const neededDateList = Array.from(neededDateKeys).sort((a, b) =>
    String(a).localeCompare(String(b)),
  )
  const dateStart = neededDateList[0]
  const dateEnd = neededDateList[neededDateList.length - 1]
  const symbolList = Array.from(neededSymbols)
  const candleRowCap = clampInt(
    process.env.CYCLE_MOONSHOT_CANDLE_ROW_CAP,
    300000,
    10000,
    2000000,
  )
  const adjustedRows = await prisma.candleDailyAdjusted
    .findMany({
      where: {
        tradingDateKey: { gte: dateStart, lte: dateEnd },
        symbol: { in: symbolList },
      },
      select: {
        symbol: true,
        tradingDateKey: true,
        ohlcv: true,
        adjFactor: true,
      },
      take: candleRowCap + 1,
    })
    .catch(() => [])
  if (adjustedRows.length > candleRowCap) {
    return []
  }
  const candles = adjustedRows.length
    ? adjustedRows.map((row) => ({
        symbol: row.symbol,
        dateKey: row.tradingDateKey,
        __adjusted: true,
        adjFactor: row.adjFactor ?? null,
        ...(row.ohlcv ?? {}),
      }))
    : await prisma.candleDaily.findMany({
        where: {
          dateKey: { gte: dateStart, lte: dateEnd },
          symbol: { in: symbolList },
        },
        select: {
          symbol: true,
          dateKey: true,
          open: true,
          high: true,
          low: true,
          close: true,
        },
        take: candleRowCap + 1,
      })
  if (candles.length > candleRowCap) {
    return []
  }
  const neededDateSet = new Set(neededDateList)
  const candleMap = buildCandleMap(
    (candles ?? []).filter((row) => {
      const symbol = String(row?.symbol ?? "").trim()
      const dateKey = String(row?.dateKey ?? "").trim()
      return neededSymbols.has(symbol) && neededDateSet.has(dateKey)
    }),
  )
  const outcomes = []
  for (const signal of signalRefs) {
    const symbol = signal.symbol
    const dateKey = signal.dateKey
    const nextDateKey = signal.nextDateKey
    const prev = candleMap.get(symbol)?.get(dateKey)
    const next = candleMap.get(symbol)?.get(nextDateKey)
    const prevClose = prev?.close
    const open = next?.open
    const high = next?.high
    if (
      !Number.isFinite(prevClose) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high)
    ) {
      continue
    }
    const highUpPct = high / prevClose - 1
    const openGapPct = open / prevClose - 1
    outcomes.push({
      tradingDateKey: dateKey,
      success: highUpPct >= 0.12 && openGapPct < 0.03,
    })
  }
  return outcomes
}

const buildInstrumentExclusionMap = (symbolMasterRows, brandConfig) => {
  const map = new Map()
  for (const row of symbolMasterRows ?? []) {
    const verdict = instrumentExclusionReasons(row, {
      brandPrefixes: Array.from(brandConfig.all),
      autoBrandPrefixes: Array.from(brandConfig.auto),
    })
    map.set(row.symbol, verdict)
  }
  return map
}

const loadTrackData = async ({
  prisma,
  track,
  horizonStart,
  windowEnd,
  instrumentExclusionMap,
}) => {
  const errorRows = await prisma.dataQualityFlagDay
    .findMany({
      where: {
        tradingDateKey: { gte: horizonStart, lte: windowEnd },
        severity: "ERROR",
      },
      select: { symbol: true, tradingDateKey: true },
    })
    .catch(() => [])
  const errorSet = new Set(
    errorRows.map((row) => `${row.symbol}:${row.tradingDateKey}`),
  )
  const filterErrors = (rows, dateField) =>
    (rows ?? []).filter((row) => {
      const symbol = String(row?.symbol ?? "").trim()
      const dateKey = String(row?.[dateField] ?? "").trim()
      return symbol && dateKey && !errorSet.has(`${symbol}:${dateKey}`)
    })

  const adjustedRows = await prisma.candleDailyAdjusted
    .findMany({
      where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
      select: {
        symbol: true,
        tradingDateKey: true,
        ohlcv: true,
        adjFactor: true,
      },
    })
    .catch(() => [])
  const candles = adjustedRows.length
    ? adjustedRows.map((row) => ({
        symbol: row.symbol,
        dateKey: row.tradingDateKey,
        __adjusted: true,
        adjFactor: row.adjFactor ?? null,
        ...(row.ohlcv ?? {}),
      }))
    : await prisma.candleDaily.findMany({
        where: { dateKey: { gte: horizonStart, lte: windowEnd } },
        select: {
          symbol: true,
          dateKey: true,
          open: true,
          high: true,
          low: true,
          close: true,
          volume: true,
        },
      })

  const [universeRows, featureRows, intradayRows, price15Rows, hourlyRows] =
    await Promise.all([
      prisma.universeKrxDay.findMany({
        where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
        select: {
          symbol: true,
          tradingDateKey: true,
          avgTradingValue20d: true,
          marketCapKrw: true,
        },
      }),
      prisma.featureDay.findMany({
        where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
        select: { symbol: true, tradingDateKey: true, features: true },
      }),
      prisma.intradayProfileDay.findMany({
        where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
        select: { symbol: true, tradingDateKey: true, seq: true },
      }),
      track === "GAP_15_BET"
        ? prisma.price15.findMany({
            where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
            select: { symbol: true, tradingDateKey: true, price: true },
          })
        : Promise.resolve([]),
      track === "GAP_15_BET"
        ? prisma.candleHourly60m
            .findMany({
              where: { tradingDateKey: { gte: horizonStart, lte: windowEnd } },
              select: {
                symbol: true,
                tradingDateKey: true,
                tsKst: true,
                open: true,
                high: true,
                low: true,
                close: true,
                volume: true,
              },
            })
            .catch(() => [])
        : Promise.resolve([]),
    ])

  const filteredUniverse = filterErrors(universeRows, "tradingDateKey").filter(
    (row) => {
      if (instrumentExclusionMap) {
        const verdict = instrumentExclusionMap.get(row.symbol)
        if (!verdict || verdict.excluded) {
          return false
        }
      }
      const capVerdict = marketCapExclusionReasons(row.marketCapKrw)
      return !capVerdict.excluded
    },
  )

  return {
    candles: filterErrors(candles, "dateKey"),
    universe: filteredUniverse,
    featureDays: filterErrors(featureRows, "tradingDateKey"),
    intradayProfiles: filterErrors(intradayRows, "tradingDateKey"),
    price15: filterErrors(price15Rows, "tradingDateKey"),
    hourly60m: filterErrors(hourlyRows ?? [], "tradingDateKey"),
  }
}

const loadPatternsByLabel = async (prisma, track, versionLabel) => {
  if (!versionLabel) return null
  return loadPatternsByLabelAndVersion(prisma, track, versionLabel)
}

const loadPatternsByLabelAndVersion = async (prisma, track, versionLabel) => {
  if (!versionLabel) return null
  const rules = await prisma.patternRule
    .findMany({
      where: { track, versionLabel },
      select: {
        payload: true,
        summary: true,
        supportTrain: true,
        precisionTest: true,
      },
    })
    .catch(() => [])
  const shapes = await prisma.patternShape
    .findMany({
      where: { track, versionLabel },
      select: {
        centroid: true,
        summary: true,
        supportTrain: true,
        precisionTest: true,
      },
    })
    .catch(() => [])
  if (!rules.length && !shapes.length) {
    return null
  }
  return {
    versionLabel,
    rules: rules.map((row) => ({
      conditions: row.payload?.conditions ?? [],
      summary: row.summary,
      supportTrain: row.supportTrain,
      precisionTest: row.precisionTest,
    })),
    shapes: shapes.map((row) => ({
      centroid: row.centroid,
      summary: row.summary,
      supportTrain: row.supportTrain,
      precisionTest: row.precisionTest,
    })),
  }
}

const evaluateWindow = ({
  data,
  patterns,
  policyParams,
  track,
  calendar,
  weekKeys,
  windowStart,
  windowEnd,
  costModel,
}) => {
  const signals = []
  const minPlanProfitGate = {
    thresholds: {
      corePct: getThresholdPct("CORE"),
      moonshotPct: getThresholdPct("MOONSHOT"),
    },
    eligibleCount: 0,
    excludedCount: 0,
    excludedByReason: {},
    note: "Strict gate enabled; may reduce signal count and increase empty-week risk.",
  }
  const candleSeriesMap = buildCandleSeriesMap(data.candles)
  const price15Map = buildPrice15Map(data.price15)
  if (track === "GAP_15_BET") {
    assertGapPatternSafe({ patterns, windowStart })
  }
  for (const dateKey of calendar) {
    if (dateKey < windowStart || dateKey > windowEnd) {
      continue
    }
    const prevTradingDay =
      track === "GAP_15_BET"
        ? resolvePrevTradingDay({ calendar, dateKey })
        : null
    const gapData =
      track === "GAP_15_BET"
        ? buildGapDataForDate({
            data,
            symbols: data.symbols,
            dateKey,
            prevTradingDay,
            strictAfter1500: true,
          })
        : null
    const picks = recommendFromData({
      data:
        track === "GAP_15_BET"
          ? {
              ...data,
              featureDays: gapData?.featureDays ?? [],
              intradayProfiles: gapData?.intradayProfiles ?? [],
            }
          : data,
      asOfDateKey: dateKey,
      track,
      patterns,
      maxPicks: policyParams.candidateCount,
      minLiquidity: policyParams.minLiquidity,
      scoreEps: policyParams.scoreEps,
      vectorBins: policyParams.vectorBins,
    })
    const maxDailyPicks = track === "SURGE_EOD" ? 1 : 1
    let emitted = 0
    for (const pick of picks) {
      if (emitted >= maxDailyPicks) {
        break
      }
      const rows = candleSeriesMap.get(pick.symbol) ?? []
      const planCandles =
        track === "GAP_15_BET"
          ? filterCandlesToPrevTradingDay({
              candles: rows,
              prevTradingDay,
            })
          : rows
      const plan = buildLevelPlan({
        candles: planCandles,
        asOfDateKey: dateKey,
        lookbackDays: policyParams.lookbackDays,
        entryBandPct: policyParams.entryBandPct,
        stopBandPct: policyParams.stopBandPct,
        targetBandPct: policyParams.targetBandPct,
        trailingPct: policyParams.trailingPct,
        minRewardPct: policyParams.minRewardPct,
      })
      if (!plan) continue
      const key = `${pick.symbol}:${dateKey}`
      if (track === "GAP_15_BET") {
        const price15 = price15Map.get(key)
        if (!Number.isFinite(price15)) {
          continue
        }
        const prevClose = prevTradingDay
          ? (() => {
              for (let i = rows.length - 1; i >= 0; i -= 1) {
                const row = rows[i]
                if (row?.dateKey === prevTradingDay) {
                  const close = Number(row.close)
                  return Number.isFinite(close) ? close : null
                }
                if (row?.dateKey && row.dateKey < prevTradingDay) {
                  break
                }
              }
              return null
            })()
          : null
        const tradability = isTradableAt1500({
          price15,
          prevClose,
          lastHourCandle: gapData?.lastHourBySymbol?.get(pick.symbol) ?? null,
        })
        if (!tradability.tradable) {
          continue
        }
      }
      const tier = track === "SURGE_EOD" ? "CORE" : "CORE"
      const gate = evaluateMinPlanProfit(tier, plan)
      if (!gate.ok) {
        const reasonKey = String(gate.reasonCode ?? "UNKNOWN")
        minPlanProfitGate.excludedByReason[reasonKey] =
          (minPlanProfitGate.excludedByReason[reasonKey] ?? 0) + 1
        minPlanProfitGate.excludedCount += 1
        continue
      }
      minPlanProfitGate.eligibleCount += 1
      signals.push({
        symbol: pick.symbol,
        tradingDateKey: dateKey,
        track,
        role: track === "SURGE_EOD" ? "CORE" : null,
        reasons: Array.isArray(pick.reasons) ? pick.reasons : [],
        warnings: Array.isArray(pick.warnings) ? pick.warnings : [],
        featureSnapshot: pick.featureSnapshot ?? null,
        buyLow: plan.entryZone.low,
        buyHigh: plan.entryZone.high,
        stopLow: plan.stopZone.low,
        stopHigh: plan.stopZone.high,
        sellLow: plan.targetZone.low,
        sellHigh: plan.targetZone.high,
        rewardPct: plan.rewardPct,
      })
      emitted += 1
    }
  }
  const results = runBacktest({
    signals,
    candles: data.candles,
    price15: data.price15,
    calendar,
    costModel,
  })
  const weekSeries = buildWeeklySeries(results, {
    weekKeys,
    emptyWeekReturnPct: weekKeys ? -1 : null,
  })
  return { weekSeries, results, signals, minPlanProfitGate }
}

const meanValues = (values) => {
  const nums = (values ?? [])
    .map((value) => safeNumber(value))
    .filter((n) => n !== null)
  if (!nums.length) {
    return null
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

const deriveWeeksTotal = (weekSeries) => {
  const set = new Set()
  for (const row of weekSeries ?? []) {
    const weekKey = String(row?.weekKey ?? "").trim()
    if (weekKey) {
      set.add(weekKey)
    }
  }
  return set.size
}

const buildBigUpMetricsForWindow = ({
  signals,
  candles,
  calendar,
  weekKeys,
  windowStart,
  windowEnd,
}) => {
  const list = Array.isArray(signals) ? signals : []
  if (!list.length) {
    return {
      bigUpWeeksCount24: 0,
      bigUpExcludedByGapCount: 0,
      bigUpWeekKeys: [],
      excludedOutsideWindow: 0,
      totalSignals: 0,
    }
  }
  const filtered = []
  let excludedOutsideWindow = 0
  for (const signal of list) {
    const dateKey = String(signal?.tradingDateKey ?? "").trim()
    if (!dateKey) {
      continue
    }
    const nextDateKey = resolveNextTradingDateKey({ calendar, dateKey })
    if (
      !nextDateKey ||
      (windowStart && nextDateKey < windowStart) ||
      (windowEnd && nextDateKey > windowEnd)
    ) {
      excludedOutsideWindow += 1
      continue
    }
    filtered.push(signal)
  }
  const metrics = computeBigUpMetrics({
    signals: filtered,
    candles,
    calendar,
    weekKeys,
  })
  return {
    ...metrics,
    excludedOutsideWindow,
    totalSignals: list.length,
  }
}

const evaluateCandidateWindow = ({
  candidate,
  data,
  patterns,
  calendar,
  weekKeys,
  windowStart,
  windowEnd,
  costModel,
  minWorst2wAvgPct,
}) => {
  const track = candidate.track
  const windowEval = evaluateWindow({
    data: {
      ...data,
      symbols: data.universe.map((row) => ({
        symbol: row.symbol,
        tradingDateKey: row.tradingDateKey,
        avgTradingValue20d: row.avgTradingValue20d,
      })),
    },
    patterns,
    policyParams: candidate.policyParams,
    track,
    calendar,
    weekKeys,
    windowStart,
    windowEnd,
    costModel,
  })
  const bigUpMetrics =
    track === "SURGE_EOD"
      ? buildBigUpMetricsForWindow({
          signals: windowEval.signals,
          candles: data.candles,
          calendar,
          weekKeys,
          windowStart,
          windowEnd,
        })
      : {
          bigUpWeeksCount24: 0,
          bigUpExcludedByGapCount: 0,
          bigUpWeekKeys: [],
          excludedOutsideWindow: 0,
          totalSignals: 0,
        }
  const noFillRate =
    windowEval.results.length > 0
      ? countNoFillResults(windowEval.results) / windowEval.results.length
      : 0
  const summary = evaluateWeeklySummary({
    weekSeries: windowEval.weekSeries,
    targetStart: 5,
    minWeeksGE: 10,
    bigUpWeeksCount24: bigUpMetrics.bigUpWeeksCount24,
    requiredBigUpWeeks: track === "SURGE_EOD" ? 10 : 0,
    minWorst2wAvgPct,
    noFillRate,
    noFillRateMax: 0.35,
    emptyWeekAllowed: 0,
    useRamp: true,
  })
  const weeklyReturnPcts = (windowEval.weekSeries ?? []).map(
    (row) => row?.weeklyReturnPct,
  )
  const weeksTotal = deriveWeeksTotal(windowEval.weekSeries)
  const meanWeeklyReturnPct = meanValues(weeklyReturnPcts)
  const lcbMeanWeeklyReturnPct = meanLowerBound(weeklyReturnPcts)
  const lcbBigUpWeekRate = wilsonLowerBound(
    bigUpMetrics.bigUpWeeksCount24,
    weeksTotal,
  )
  const existingPrimaryScore = safeNumber(summary.metrics?.countWeeksGE, 0)
  return {
    candidate,
    windowEval,
    summary,
    bigUpMetrics,
    noFillRate,
    weeksTotal,
    meanWeeklyReturnPct,
    lcbMeanWeeklyReturnPct,
    lcbBigUpWeekRate,
    existingPrimaryScore,
    minPlanProfitGate: windowEval.minPlanProfitGate,
  }
}

const buildCandidateKey = (candidate) => {
  const track = String(candidate?.track ?? "").trim() || "UNKNOWN"
  const label =
    String(candidate?.patternVersionLabel ?? "NONE").trim() || "NONE"
  return `${track}:${label}`
}

const formatNumber = (value, digits = 4) => {
  if (!Number.isFinite(value)) {
    return "NA"
  }
  const n = Number(value)
  return digits === 0 ? String(Math.round(n)) : n.toFixed(digits)
}

const buildRangeHint = (values) => {
  const nums = (values ?? []).filter((value) => Number.isFinite(value))
  if (!nums.length) {
    return { min: null, max: null }
  }
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
  }
}

const minOfNumbers = (values) => {
  const nums = (values ?? []).filter((value) => Number.isFinite(value))
  if (!nums.length) {
    return null
  }
  return Math.min(...nums)
}

const maxOfNumbers = (values) => {
  const nums = (values ?? []).filter((value) => Number.isFinite(value))
  if (!nums.length) {
    return null
  }
  return Math.max(...nums)
}

const countWeeksWithTrades = (weekSeries) => {
  let count = 0
  for (const row of weekSeries ?? []) {
    const completed = Number(row?.completedTrades ?? 0) || 0
    if (completed > 0) {
      count += 1
    }
  }
  return count
}

const computeRequiredWeeksMin = (weeksTotal) => {
  const total = Number(weeksTotal ?? 0) || 0
  if (total <= 0) {
    return 0
  }
  return Math.ceil(total * (10 / 16))
}

const computeRampTFromWeekSeries = ({
  weekSeries,
  requiredWeeksMin,
  targetStart = 5,
  targetStep = 1,
}) => {
  const required = Number(requiredWeeksMin ?? 0) || 0
  if (!Array.isArray(weekSeries) || weekSeries.length === 0 || required <= 0) {
    return { rampT: 0, countWeeksGE: 0 }
  }
  let target = Number(targetStart ?? 5) || 5
  let lastPassed = 0
  let lastCount = 0
  while (true) {
    const metrics = buildWeeklyMetrics({ weekSeries, targetPct: target })
    const countWeeksGE = Number(metrics.countWeeksGE ?? 0) || 0
    if (countWeeksGE >= required) {
      lastPassed = target
      lastCount = countWeeksGE
      target += Number(targetStep ?? 1) || 1
      continue
    }
    break
  }
  return { rampT: lastPassed ?? 0, countWeeksGE: lastCount }
}

const buildWindowFromWeekKeys = ({ calendar, weekKeys }) => {
  const clean = normalizeCalendar(
    calendar,
    weekKeys?.[weekKeys.length - 1] ?? null,
  )
  const set = new Set(weekKeys ?? [])
  const windowDates = clean.filter((key) => set.has(toWeekKeyKst(key)))
  if (!windowDates.length) {
    return null
  }
  return {
    fromDateKey: windowDates[0],
    toDateKey: windowDates[windowDates.length - 1],
  }
}

const buildValidationMultiSliceWindows = ({
  calendar,
  validation,
  sliceCount = 3,
}) => {
  const clean = normalizeCalendar(calendar, validation?.toDateKey ?? null)
  const validationWeekKeys = Array.isArray(validation?.weekKeys)
    ? validation.weekKeys
    : []
  const allWeekKeys = listWeekKeysForCalendar({
    calendar: clean,
    asOfDateKey: validation?.toDateKey,
  })
  const firstWeekKey = validationWeekKeys[0] ?? null
  const startIdx = firstWeekKey
    ? allWeekKeys.findIndex((key) => key === firstWeekKey)
    : -1
  const slices = []
  const addBlocked = (name, reason) => {
    slices.push({ name, blocked: true, reason })
  }
  if (!validationWeekKeys.length) {
    addBlocked("val_slice0", "VALIDATION_WEEKKEYS_MISSING")
  } else {
    const window = buildWindowFromWeekKeys({
      calendar: clean,
      weekKeys: validationWeekKeys,
    })
    if (!window) {
      addBlocked("val_slice0", "VALIDATION_WINDOW_NOT_FOUND")
    } else {
      slices.push({
        name: "val_slice0",
        blocked: false,
        weekKeys: validationWeekKeys,
        ...window,
      })
    }
  }
  const count = Math.max(0, Math.floor(sliceCount ?? 0))
  for (let idx = 1; idx <= count; idx += 1) {
    const name = `val_slice${idx}`
    if (startIdx < 0) {
      addBlocked(name, "VALIDATION_WEEKKEY_NOT_FOUND")
      continue
    }
    const end = startIdx - 16 * (idx - 1)
    const start = startIdx - 16 * idx
    const sliceWeekKeys = allWeekKeys.slice(start, end)
    if (sliceWeekKeys.length !== validationWeekKeys.length) {
      addBlocked(name, "INSUFFICIENT_WEEK_KEYS")
      continue
    }
    const window = buildWindowFromWeekKeys({
      calendar: clean,
      weekKeys: sliceWeekKeys,
    })
    if (!window) {
      addBlocked(name, "WINDOW_NOT_FOUND")
      continue
    }
    slices.push({
      name,
      blocked: false,
      weekKeys: sliceWeekKeys,
      ...window,
    })
  }
  return slices
}

const writeValidationMultiSliceWindows = ({ meta, slices, adminKey }) => {
  const jsonPath = path.join(
    reviewDir,
    `validation_multislice_windows_${meta.asOfDateKey}.json`,
  )
  const payload = {
    meta,
    slices,
  }
  writeJsonGuarded(jsonPath, payload, adminKey)
  return { jsonPath }
}

const writeValidationMultiSliceCandidates = ({
  meta,
  slices,
  entries,
  adminKey,
}) => {
  const jsonPath = path.join(
    reviewDir,
    `validation_multislice_rampT_candidates_${meta.asOfDateKey}.json`,
  )
  const mdPath = path.join(
    reviewDir,
    `validation_multislice_rampT_candidates_${meta.asOfDateKey}.md`,
  )
  const topN = entries.slice(0, Math.min(entries.length, 20))
  const sliceNames = slices.map((slice) => slice.name)
  const header = [
    "candidateKey",
    "primaryScore",
    "rampT_worst",
    ...sliceNames.map((name) => `rampT_${name}`),
    ...sliceNames.map((name) => `weeks_${name}`),
    ...sliceNames.map((name) => `empty_${name}`),
    ...sliceNames.map((name) => `minWeekly_${name}`),
    ...sliceNames.map((name) => `noFill_${name}`),
  ]
  const rows = topN.map((entry) => {
    const stats = entry.multislice?.sliceStats ?? []
    const lookup = (name) => stats.find((row) => row.name === name) ?? null
    const rampCells = sliceNames.map((name) => {
      const row = lookup(name)
      if (!row || row.blocked) return "BLOCKED"
      return formatNumber(row.rampT, 1)
    })
    const weekCells = sliceNames.map((name) => {
      const row = lookup(name)
      if (!row || row.blocked) return "BLOCKED"
      return `${formatNumber(row.weeksTotal, 0)}/${formatNumber(
        row.requiredWeeksMin,
        0,
      )}`
    })
    const emptyCells = sliceNames.map((name) => {
      const row = lookup(name)
      if (!row || row.blocked) return "BLOCKED"
      return formatNumber(row.emptyWeeks, 0)
    })
    const minWeeklyCells = sliceNames.map((name) => {
      const row = lookup(name)
      if (!row || row.blocked) return "BLOCKED"
      return formatNumber(row.minWeeklyPct, 2)
    })
    const noFillCells = sliceNames.map((name) => {
      const row = lookup(name)
      if (!row || row.blocked) return "BLOCKED"
      return formatNumber(row.noFillRate, 3)
    })
    return [
      entry.candidateKey,
      formatNumber(entry.existingPrimaryScore, 2),
      formatNumber(entry.rampTWorst, 1),
      ...rampCells,
      ...weekCells,
      ...emptyCells,
      ...minWeeklyCells,
      ...noFillCells,
    ]
  })
  const payload = {
    meta,
    note: "These multislice artifacts drive validation selection (not diagnostics-only).",
    slices,
    entries,
  }
  writeJsonGuarded(jsonPath, payload, adminKey)
  const mdLines = [
    `# Validation multislice Ramp-T candidates (${meta.cycleId})`,
    ``,
    meta ? `- meta: ${JSON.stringify(meta)}` : `- meta: (none)`,
    `- note: These multislice artifacts drive validation selection (not diagnostics-only).`,
    ``,
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ]
  writeTextGuarded(mdPath, mdLines, adminKey)
  return { jsonPath, mdPath }
}

const writeValidationLcbArtifacts = ({ meta, entries, adminKey }) => {
  const jsonPath = path.join(
    reviewDir,
    `validation_lcb_candidates_${meta.asOfDateKey}.json`,
  )
  const mdPath = path.join(
    reviewDir,
    `validation_lcb_candidates_${meta.asOfDateKey}.md`,
  )
  const topN = entries.slice(0, Math.min(entries.length, 20))
  const rangeHints = {
    meanWeeklyReturnPct: buildRangeHint(
      topN.map((row) => row.meanWeeklyReturnPct),
    ),
    lcbMeanWeeklyReturnPct: buildRangeHint(
      topN.map((row) => row.lcbMeanWeeklyReturnPct),
    ),
    lcbBigUpWeekRate: buildRangeHint(topN.map((row) => row.lcbBigUpWeekRate)),
  }
  const payload = {
    meta,
    note: "LCB affects validation selection only.",
    entries,
    rangeHints,
  }
  writeJsonGuarded(jsonPath, payload, adminKey)
  const minPlanGate = meta?.minPlanProfitGate ?? null
  const minPlanLines = minPlanGate
    ? [
        `- minPlanProfitGate: core=${formatNumber(
          minPlanGate.thresholds?.corePct,
          1,
        )}%, moon=${formatNumber(
          minPlanGate.thresholds?.moonshotPct,
          1,
        )}%, eligible=${formatNumber(minPlanGate.eligibleCount, 0)}, excluded=${formatNumber(
          minPlanGate.excludedCount,
          0,
        )}`,
        `- minPlanProfitGateByReason: ${JSON.stringify(
          minPlanGate.excludedByReason ?? {},
        )}`,
        minPlanGate.note ? `- note: ${minPlanGate.note}` : null,
      ].filter(Boolean)
    : []
  writeTextGuarded(
    mdPath,
    [
      `# Validation LCB candidates (${meta.cycleId})`,
      ``,
      meta ? `- meta: ${JSON.stringify(meta)}` : `- meta: (none)`,
      `- LCB affects validation selection only.`,
      `- bigUp edge rule: exclude samples whose next trading day is outside the evaluated window.`,
      ...minPlanLines,
      ``,
      `| candidateKey | existingPrimaryScore | bigUpWeeksCount | weeksTotal | meanWeeklyReturnPct | lcbBigUpWeekRate | lcbMeanWeeklyReturnPct | noFillRate |`,
      `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
      ...topN.map(
        (row) =>
          `| ${row.candidateKey} | ${formatNumber(
            row.existingPrimaryScore,
            0,
          )} | ${formatNumber(row.bigUpWeeksCount, 0)} | ${formatNumber(
            row.weeksTotal,
            0,
          )} | ${formatNumber(row.meanWeeklyReturnPct)} | ${formatNumber(
            row.lcbBigUpWeekRate,
          )} | ${formatNumber(row.lcbMeanWeeklyReturnPct)} | ${formatNumber(
            row.noFillRate,
          )} |`,
      ),
      ``,
      `## Range hints (TopN)`,
      `- meanWeeklyReturnPct: ${formatNumber(
        rangeHints.meanWeeklyReturnPct.min,
      )} ~ ${formatNumber(rangeHints.meanWeeklyReturnPct.max)}`,
      `- lcbMeanWeeklyReturnPct: ${formatNumber(
        rangeHints.lcbMeanWeeklyReturnPct.min,
      )} ~ ${formatNumber(rangeHints.lcbMeanWeeklyReturnPct.max)}`,
      `- lcbBigUpWeekRate: ${formatNumber(
        rangeHints.lcbBigUpWeekRate.min,
      )} ~ ${formatNumber(rangeHints.lcbBigUpWeekRate.max)}`,
    ],
    adminKey,
  )
  return { jsonPath, mdPath, rangeHints }
}

const buildShadowSlices = ({ calendar, asOfDateKey, weekCount = 16 }) => {
  const offsets = [weekCount * 2, weekCount * 3, weekCount * 4]
  return offsets.map((offset, idx) => {
    const window = resolveWeekWindowFromCalendar({
      calendar,
      asOfDateKey,
      weekCount,
      offsetWeeks: offset,
    })
    if (!window) {
      return {
        name: `shadow${idx + 1}`,
        offsetWeeks: offset,
        blocked: true,
        reason: "WINDOW_UNAVAILABLE",
      }
    }
    return {
      name: `shadow${idx + 1}`,
      offsetWeeks: offset,
      blocked: false,
      ...window,
    }
  })
}

const writeShadowSliceArtifacts = ({ meta, slices, adminKey }) => {
  const jsonPath = path.join(
    reviewDir,
    `shadow_slices_${meta.asOfDateKey}.json`,
  )
  const mdPath = path.join(reviewDir, `shadow_slices_${meta.asOfDateKey}.md`)
  const payload = {
    meta,
    note: "Diagnostics only. Does not affect chosenCandidates or lockbox.",
    slices,
  }
  writeJsonGuarded(jsonPath, payload, adminKey)
  const mdLines = [
    `# Shadow slices (${meta.cycleId})`,
    ``,
    meta ? `- meta: ${JSON.stringify(meta)}` : `- meta: (none)`,
    `**Diagnostics only. Does not affect chosenCandidates or lockbox.**`,
    ``,
  ]
  for (const slice of slices) {
    mdLines.push(`## ${slice.name}`)
    mdLines.push(
      slice.blocked
        ? `- BLOCKED BY DATA: ${slice.reason ?? "UNKNOWN"}`
        : `- window: ${slice.window?.fromDateKey ?? "?"} ~ ${slice.window?.toDateKey ?? "?"}`,
    )
    if (slice.blocked) {
      mdLines.push("")
      continue
    }
    for (const track of slice.tracks ?? []) {
      mdLines.push(`### ${track.track}`)
      mdLines.push(
        `| sliceName | bigUpWeeksCount | weeksTotal | meanWeeklyReturnPct | minWeeklyPct | noFillRate | notes |`,
      )
      mdLines.push(`| --- | ---: | ---: | ---: | ---: | ---: | --- |`)
      mdLines.push(
        `| ${slice.name} | ${formatNumber(
          track.bigUpWeeksCount,
          0,
        )} | ${formatNumber(track.weeksTotal, 0)} | ${formatNumber(
          track.meanWeeklyReturnPct,
        )} | ${formatNumber(track.minWeeklyPct)} | ${formatNumber(
          track.noFillRate,
        )} | ${track.notes ?? ""} |`,
      )
      mdLines.push("")
    }
  }
  writeTextGuarded(mdPath, mdLines, adminKey)
  return { jsonPath, mdPath }
}

const buildPolicyParams = () => ({
  candidateCount: 500,
  lookbackDays: DEFAULT_LEVEL_POLICY.lookbackDays,
  entryBandPct: DEFAULT_LEVEL_POLICY.entryBandPct,
  stopBandPct: DEFAULT_LEVEL_POLICY.stopBandPct,
  targetBandPct: DEFAULT_LEVEL_POLICY.targetBandPct,
  trailingPct: DEFAULT_LEVEL_POLICY.trailingPct,
  minRewardPct: DEFAULT_LEVEL_POLICY.minRewardPct,
  minLiquidity: 400_000_000,
  scoreEps: 1,
  vectorBins: 30,
})

const resolveCandidateForTrack = async ({ prisma, track, asOfDateKey }) => {
  const candidates = await prisma.patternRule.findMany({
    where: {
      track,
      NOT: { versionLabel: { startsWith: "autosearch:" } },
    },
    select: { version: true, versionLabel: true },
    orderBy: { version: "desc" },
  })
  const selection = selectPatternVersionLabel({
    candidates,
    asOfDateKey,
    latestDateKey: asOfDateKey,
  })
  const versionLabel = selection?.versionLabel ?? null
  const version =
    selection?.version ?? (versionLabel ? hashToVersion(versionLabel) : null)
  if (!versionLabel || !version) {
    return {
      track,
      patternVersionLabel: null,
      patternVersionId: null,
      policyParams: buildPolicyParams(),
      policyChoice: null,
      patternChoice: null,
      blocked: true,
      reason: "PATTERN_MISSING",
      hintCommand: `npm run ai:patterns:train -- --asOf=${asOfDateKey}`,
    }
  }
  return {
    track,
    patternVersionLabel: versionLabel,
    patternVersionId: version,
    policyParams: buildPolicyParams(),
    policyChoice: null,
    patternChoice: null,
  }
}

const resolveCandidatesForTracks = async ({ prisma, asOfDateKey }) => {
  const tracks = ["SURGE_EOD", "GAP_15_BET"]
  const candidates = []
  for (const track of tracks) {
    const candidate = await resolveCandidateForTrack({
      prisma,
      track,
      asOfDateKey,
    })
    candidates.push(candidate)
  }
  const blockedCandidate = candidates.find((row) => row?.blocked)
  return { candidates, blockedCandidate }
}

const writeLeaderboardArtifacts = ({
  cycleId,
  candidates,
  attemptLogSummary,
  gitShort,
  meta,
  adminKey,
}) => {
  const stamp = formatKstStamp()
  const jsonPath = path.join(
    reviewDir,
    `validation_leaderboard_${cycleId}_${stamp}_${gitShort}.json`,
  )
  const mdPath = path.join(
    reviewDir,
    `validation_leaderboard_${cycleId}_${stamp}_${gitShort}.md`,
  )
  const payload = {
    cycleId,
    meta: meta ?? null,
    attemptLogSummary,
    candidates,
  }
  writeJsonGuarded(jsonPath, payload, adminKey)
  const moonshotFailed = attemptLogSummary?.moonshot4wFailedBuckets ?? []
  const moonshotSummary =
    attemptLogSummary?.moonshot4wPass === undefined
      ? []
      : [
          `- moonshot4wPass: ${attemptLogSummary.moonshot4wPass}`,
          `- moonshotGate: enforced=${attemptLogSummary.moonshotGateEnforced ? "yes" : "no"}, scope=${attemptLogSummary.moonshotGateScope ?? "none"}, reason=${attemptLogSummary.moonshotGateReason ?? "none"}`,
          `- moonshot4w: evaluated=${attemptLogSummary.moonshot4w?.bucketsEvaluated ?? 0}, failed=${attemptLogSummary.moonshot4w?.bucketsFailed ?? 0}`,
          `- moonshot4wFailedBuckets: ${
            moonshotFailed.length
              ? moonshotFailed
                  .map(
                    (bucket) =>
                      `${bucket.bucketStartDateKey}~${bucket.bucketEndDateKey}`,
                  )
                  .join(", ")
              : "0"
          }`,
        ]
  const minPlanGate = attemptLogSummary?.minPlanProfitGate ?? null
  const minPlanGateSummary = minPlanGate
    ? [
        `- minPlanProfitGate: core=${formatNumber(
          minPlanGate.thresholds?.corePct,
          1,
        )}%, moon=${formatNumber(
          minPlanGate.thresholds?.moonshotPct,
          1,
        )}%, eligible=${formatNumber(minPlanGate.eligibleCount, 0)}, excluded=${formatNumber(
          minPlanGate.excludedCount,
          0,
        )}`,
        `- minPlanProfitGateByReason: ${JSON.stringify(
          minPlanGate.excludedByReason ?? {},
        )}`,
        minPlanGate.note ? `- note: ${minPlanGate.note}` : null,
      ].filter(Boolean)
    : []
  writeTextGuarded(
    mdPath,
    [
      `# Validation leaderboard (${cycleId})`,
      ``,
      meta ? `- meta: ${JSON.stringify(meta)}` : `- meta: (none)`,
      `- total: ${attemptLogSummary.candidateCountTotal}`,
      `- evaluated: ${attemptLogSummary.evaluatedCount}`,
      `- selected: ${attemptLogSummary.selectedCount}`,
      `- attempts: ${attemptLogSummary.attempts}`,
      `- seed: ${attemptLogSummary.seed}`,
      ...moonshotSummary,
      ...minPlanGateSummary,
      ``,
      `| track | pattern | candidateCount |`,
      `| --- | --- | ---: |`,
      ...candidates.map(
        (row) =>
          `| ${row.track} | ${row.patternVersionLabel ?? "NONE"} | ${row.policyParams?.candidateCount ?? 0} |`,
      ),
    ],
    adminKey,
  )
  return { jsonPath, mdPath }
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "autosearch/run_cycle" })
  assertNoKisRuntime({ script: "autosearch/run_cycle" })
  const args = parseArgs()
  const cycleMinFreeMemRatio = clampMemoryNumber(
    process.env.CYCLE_MIN_FREE_MEM_RATIO,
    0.08,
    0.01,
    0.5,
  )
  const cycleMinFreeMemMb = Math.floor(
    clampMemoryNumber(process.env.CYCLE_MIN_FREE_MEM_MB, 1024, 128, 32768),
  )
  const memorySnapBootstrap = checkSystemMemoryHeadroom({
    stage: "bootstrap",
    minFreeRatio: cycleMinFreeMemRatio,
    minFreeMb: cycleMinFreeMemMb,
  })
  console.log(
    `[cycle] memory bootstrap free=${memorySnapBootstrap.freeMb}MB/${memorySnapBootstrap.totalMb}MB ratio=${memorySnapBootstrap.freeRatio.toFixed(3)}`,
  )
  const coverageThresholds = {
    featureVsUniverse: clampRatio(process.env.CYCLE_MIN_FEATURE_COVERAGE, 0.9),
    intradayVsUniverse: clampRatio(
      process.env.CYCLE_MIN_INTRADAY_COVERAGE,
      0.9,
    ),
    price15VsUniverse: clampRatio(process.env.CYCLE_MIN_PRICE15_COVERAGE, 0.9),
    hourlyVsUniverse: clampRatio(process.env.CYCLE_MIN_HOURLY_COVERAGE, 0.85),
  }
  const minWorst2wAvgPct = clampMemoryNumber(
    process.env.CYCLE_MIN_WORST2W_AVG_PCT,
    args.minWorst2wAvgPct,
    -100,
    100,
  )
  const { release } = acquireLock()
  const prisma = new PrismaClient()
  await prisma.$queryRaw`SELECT 1`
  const staleDefaultAsOfGuard = parseBooleanEnv(
    process.env.CYCLE_GUARD_STALE_DEFAULT_ASOF ?? "1",
  )
  const latestMarketDataDateKey = await resolveLatestMarketDataDateKey(prisma)
  const symbolMasterRows = await prisma.symbolMaster
    .findMany({
      select: {
        symbol: true,
        name: true,
        market: true,
        type: true,
        isListed: true,
      },
    })
    .catch(() => [])
  const discovery = discoverBrandPrefixes(symbolMasterRows)
  const brandConfig = resolveBrandPrefixes({
    basePrefixes: BASE_BRAND_PREFIXES,
    autoPrefixes: discovery.prefixes,
  })
  const instrumentExclusionMap = buildInstrumentExclusionMap(
    symbolMasterRows,
    brandConfig,
  )

  const baseAsOf = args.rawAsOf ?? DEFAULT_RAMP_ASOF_DATE_KEY
  if (
    staleDefaultAsOfGuard &&
    !args.asOfExplicit &&
    baseAsOf &&
    latestMarketDataDateKey &&
    baseAsOf < latestMarketDataDateKey
  ) {
    throw new Error(
      `STALE_DEFAULT_ASOF script=run_cycle defaultAsOf=${baseAsOf} latestData=${latestMarketDataDateKey} (pass --asOf=YYYY-MM-DD explicitly or update DEFAULT_RAMP_ASOF_DATE_KEY)`,
    )
  }
  const asOfDateKey =
    (await resolveLastTradingDateKey({ prisma, asOfDateKey: baseAsOf })) ??
    normalizeDateKey(baseAsOf)
  if (!asOfDateKey) {
    throw new Error("Missing asOfDateKey")
  }

  const horizonStart = shiftDateKeyByMonths(asOfDateKey, -70) ?? asOfDateKey
  const calendar = await resolveTradingCalendarRange({
    prisma,
    fromDateKey: horizonStart,
    toDateKey: asOfDateKey,
  })
  const windowState = resolveCycleWindows({
    calendar,
    asOfDateKey,
    weekCount: 16,
    trainMonths: 62,
  })
  if (!windowState) {
    throw new Error("Unable to resolve cycle windows")
  }
  const priorState = readCycleState()
  const storedLockboxStart = priorState?.lockboxStartDateKey ?? null
  const storedLockboxEnd = priorState?.lockboxEndDateKey ?? null
  const storedValidationStart = priorState?.validationStartDateKey ?? null
  const storedValidationEnd = priorState?.validationEndDateKey ?? null
  const storedTrainFrom = priorState?.trainStartDateKey ?? null
  const storedTrainTo = priorState?.trainEndDateKey ?? null
  const hasStoredWindows =
    storedLockboxStart &&
    storedLockboxEnd &&
    storedValidationStart &&
    storedValidationEnd
  const baseWindows = hasStoredWindows
    ? {
        asOfTrading: windowState.asOfTrading,
        lockbox: {
          fromDateKey: storedLockboxStart,
          toDateKey: storedLockboxEnd,
          weekKeys: buildWeekKeysForRange({
            calendar,
            startDateKey: storedLockboxStart,
            endDateKey: storedLockboxEnd,
          }),
        },
        validation: {
          fromDateKey: storedValidationStart,
          toDateKey: storedValidationEnd,
          weekKeys: buildWeekKeysForRange({
            calendar,
            startDateKey: storedValidationStart,
            endDateKey: storedValidationEnd,
          }),
        },
        trainFromDateKey: storedTrainFrom ?? windowState.trainFromDateKey,
        trainToDateKey: storedTrainTo ?? windowState.trainToDateKey,
      }
    : windowState
  if (
    detectWindowDrift({
      status: priorState?.status,
      stored: baseWindows,
      computed: windowState,
    })
  ) {
    throw new Error("CYCLE_WINDOW_DRIFT")
  }
  const { asOfTrading, lockbox, validation, trainFromDateKey, trainToDateKey } =
    baseWindows

  const cycleId = `cycle_${lockbox.fromDateKey}_${lockbox.toDateKey}`
  const gitInfo = resolveGitInfo()
  const autoAdvanceEnabled = args.enableAutoAdvance
    ? true
    : args.disableAutoAdvance
      ? false
      : Boolean(priorState?.autoAdvanceEnabled)
  const baseState = {
    cycleId,
    strategyVersion:
      priorState?.strategyVersion ?? `vfinal8_multislice:${cycleId}`,
    gitSha: gitInfo.sha ?? null,
    branch: gitInfo.branch ?? null,
    asOfDateKey: asOfTrading,
    trainStartDateKey: trainFromDateKey,
    trainEndDateKey: trainToDateKey,
    validationStartDateKey: validation.fromDateKey,
    validationEndDateKey: validation.toDateKey,
    lockboxStartDateKey: lockbox.fromDateKey,
    lockboxEndDateKey: lockbox.toDateKey,
    selectionRule: "validation_multislice_ramp_t",
    autoAdvanceEnabled,
  }
  const rampCostModel = resolveRampCostModel()

  let status = priorState?.status ?? "VALIDATION_TUNING"
  let chosenCandidates = Array.isArray(priorState?.chosenCandidates)
    ? priorState.chosenCandidates
    : []
  let chosenHash = priorState?.chosenHash ?? null
  let attemptLogSummary = priorState?.attemptLogSummary ?? null
  let passFailSummary = priorState?.passFailSummary ?? null
  let shadowSlices = priorState?.shadowSlices ?? null
  let artifactLinks = Array.isArray(priorState?.artifactLinks)
    ? priorState.artifactLinks
    : []
  let nextCyclePlan = priorState?.nextCyclePlan ?? null
  const runCycleConfigSanity = buildRunCycleConfigSanity({
    status,
    asOfDateKey: asOfTrading,
    validation,
    lockbox,
    trainFromDateKey,
    trainToDateKey,
  })
  if (runCycleConfigSanity.warnings.length) {
    console.log(
      `[cycle] config sanity warnings: ${runCycleConfigSanity.warnings.join(",")}`,
    )
  }
  if (!runCycleConfigSanity.pass) {
    throw new Error(
      `CYCLE_CONFIG_SANITY_FAILED ${runCycleConfigSanity.errors.join(",") || "UNKNOWN"}`,
    )
  }

  if (status === MOONSHOT_GATE_FAILED) {
    status = "VALIDATION_TUNING"
    passFailSummary = {
      ...(typeof passFailSummary === "object" && passFailSummary !== null
        ? passFailSummary
        : {}),
      lastBlockedReason: MOONSHOT_GATE_FAILED,
      resumedFromBlockedStatus: true,
    }
  }

  if (status === "VALIDATION_TUNING") {
    const { candidates: nextCandidates, blockedCandidate } =
      await resolveCandidatesForTracks({
        prisma,
        asOfDateKey: trainToDateKey,
      })
    if (blockedCandidate) {
      status = "BLOCKED_BY_DATA"
      passFailSummary = {
        blocked: true,
        reason: blockedCandidate.reason ?? "PATTERN_MISSING",
        hintCommand: blockedCandidate.hintCommand ?? null,
      }
      chosenCandidates = []
      chosenHash = null
      attemptLogSummary = null
    } else {
      const moonshotOutcomes = await loadMoonshotValidationOutcomes({
        prisma,
        validationStartDateKey: validation.fromDateKey,
        validationEndDateKey: validation.toDateKey,
        calendar,
        strategyVersion: baseState.strategyVersion,
        strategyVersionPrefix: MOONSHOT_STRATEGY_PREFIX,
        patternVersionLabel: selectSurgePatternVersionLabel(nextCandidates),
        activeOnly: true,
      })
      const moonshot4wStats = computeMoonshot4wStats(
        moonshotOutcomes,
        validation.fromDateKey,
        validation.toDateKey,
        calendar,
      )
      const moonshot4wPass = moonshot4wStats.overallPass
      const baseCandidates = nextCandidates.map((row) =>
        row.track === "SURGE_EOD"
          ? {
              ...row,
              moonshotEnabled: moonshot4wPass,
              moonshot4wPass,
            }
          : row,
      )
      const calendarRange = normalizeCalendar(calendar, validation.toDateKey)
      const validationSlices = buildValidationMultiSliceWindows({
        calendar,
        validation,
        sliceCount: 3,
      })
      const multisliceWindowsMeta = {
        gitSha: gitInfo.sha ?? null,
        strategyVersion: baseState.strategyVersion,
        cycleId,
        asOfDateKey: asOfTrading,
        validationWindow: {
          fromDateKey: validation.fromDateKey,
          toDateKey: validation.toDateKey,
        },
        slicePolicy: "contiguous_16w_multi_slice",
        requiredWeeksMinPolicy: "ceil(weeksTotal*10/16)",
      }
      const multisliceWindowsArtifacts = writeValidationMultiSliceWindows({
        meta: multisliceWindowsMeta,
        slices: validationSlices,
        adminKey: args.adminKey,
      })
      artifactLinks = [
        ...artifactLinks.filter(
          (entry) => entry?.type !== "validation_multislice_windows",
        ),
        {
          type: "validation_multislice_windows",
          path: multisliceWindowsArtifacts.jsonPath,
        },
      ]
      const lcbEntries = []
      const minPlanProfitGateTotals = {
        thresholds: {
          corePct: getThresholdPct("CORE"),
          moonshotPct: getThresholdPct("MOONSHOT"),
        },
        eligibleCount: 0,
        excludedCount: 0,
        excludedByReason: {},
        note: "Strict gate enabled; may reduce signal count and increase empty-week risk.",
      }
      const moonshotGateEnforced = hasSurgeCandidate(baseCandidates)
      let validationBlocked =
        moonshotGateEnforced && !moonshot4wPass
          ? {
              reason: MOONSHOT_GATE_FAILED,
              track: "SURGE_EOD",
              moonshotGate: {
                scope: MOONSHOT_GATE_SCOPE,
                pass: moonshot4wPass,
                failedWeeks: null,
                failedBuckets: moonshot4wStats.bucketsFailed ?? null,
                minSignalsPerWeek: moonshot4wStats.minSignalsPerWeek ?? null,
                preferredSignalsPerWeek:
                  moonshot4wStats.preferredSignalsPerWeek ?? null,
              },
            }
          : null
      for (const candidate of baseCandidates) {
        if (validationBlocked) {
          break
        }
        const track = candidate.track
        const data = await loadTrackData({
          prisma,
          track,
          horizonStart: trainFromDateKey,
          windowEnd: validation.toDateKey,
          instrumentExclusionMap,
        })
        const readiness = assessTrackDataReadiness({
          track,
          data,
          asOfDateKey: validation.toDateKey,
          thresholds: coverageThresholds,
        })
        if (!readiness.ok) {
          validationBlocked = {
            reason: readiness.reason ?? "MISSING_DATA",
            track,
            missing: readiness.missing,
            coverage: readiness.coverage,
            coverageIssues: readiness.coverageIssues,
          }
          break
        }
        const patterns =
          (await loadPatternsByLabelAndVersion(
            prisma,
            track,
            candidate.patternVersionLabel,
          )) ?? null
        if (!patterns) {
          validationBlocked = {
            reason: "PATTERN_MISSING",
            track,
          }
          break
        }
        const metrics = evaluateCandidateWindow({
          candidate,
          data,
          patterns,
          calendar: calendarRange,
          weekKeys: validation.weekKeys,
          windowStart: validation.fromDateKey,
          windowEnd: validation.toDateKey,
          costModel: rampCostModel,
          minWorst2wAvgPct,
        })
        if (metrics.minPlanProfitGate) {
          minPlanProfitGateTotals.eligibleCount +=
            metrics.minPlanProfitGate.eligibleCount ?? 0
          minPlanProfitGateTotals.excludedCount +=
            metrics.minPlanProfitGate.excludedCount ?? 0
          const reasons = metrics.minPlanProfitGate.excludedByReason ?? {}
          for (const [reason, count] of Object.entries(reasons)) {
            minPlanProfitGateTotals.excludedByReason[reason] =
              (minPlanProfitGateTotals.excludedByReason[reason] ?? 0) +
              (count ?? 0)
          }
        }
        const sliceStats = []
        for (const slice of validationSlices) {
          if (slice.blocked) {
            sliceStats.push({
              name: slice.name,
              blocked: true,
              reason: slice.reason,
            })
            continue
          }
          const sliceMetrics =
            slice.name === "val_slice0"
              ? metrics
              : evaluateCandidateWindow({
                  candidate,
                  data,
                  patterns,
                  calendar: normalizeCalendar(calendar, slice.toDateKey),
                  weekKeys: slice.weekKeys,
                  windowStart: slice.fromDateKey,
                  windowEnd: slice.toDateKey,
                  costModel: rampCostModel,
                  minWorst2wAvgPct,
                })
          const weekSeries = sliceMetrics.windowEval?.weekSeries ?? []
          const weeksTotal = deriveWeeksTotal(weekSeries)
          const requiredWeeksMin = computeRequiredWeeksMin(weeksTotal)
          const weeklyMetrics = buildWeeklyMetrics({
            weekSeries,
            targetPct: 5,
          })
          const weeksWithTrades = countWeeksWithTrades(weekSeries)
          const ramp =
            weeksWithTrades === 0
              ? { rampT: 0, countWeeksGE: 0 }
              : computeRampTFromWeekSeries({
                  weekSeries,
                  requiredWeeksMin,
                })
          sliceStats.push({
            name: slice.name,
            blocked: false,
            rampT: ramp.rampT,
            countWeeksGE: ramp.countWeeksGE,
            weeksTotal,
            requiredWeeksMin,
            emptyWeeks: weeklyMetrics.emptyWeeksCount ?? 0,
            minWeeklyPct: weeklyMetrics.minWeeklyPct ?? null,
            noFillRate: sliceMetrics.noFillRate,
          })
        }
        const availableSlices = sliceStats.filter((slice) => !slice.blocked)
        const rampTWorst = minOfNumbers(
          availableSlices.map((slice) => slice.rampT),
        )
        const minWeeklyPctWorst = minOfNumbers(
          availableSlices.map((slice) => slice.minWeeklyPct),
        )
        const noFillRateWorst = maxOfNumbers(
          availableSlices.map((slice) => slice.noFillRate),
        )
        lcbEntries.push({
          candidate,
          candidateKey: buildCandidateKey(candidate),
          existingPrimaryScore: metrics.existingPrimaryScore,
          bigUpWeeksCount: metrics.bigUpMetrics.bigUpWeeksCount24,
          weeksTotal: metrics.weeksTotal,
          meanWeeklyReturnPct: metrics.meanWeeklyReturnPct,
          lcbBigUpWeekRate: metrics.lcbBigUpWeekRate,
          lcbMeanWeeklyReturnPct: metrics.lcbMeanWeeklyReturnPct,
          noFillRate: metrics.noFillRate,
          bigUpEdgeExcluded: metrics.bigUpMetrics.excludedOutsideWindow,
          minPlanProfitGate: metrics.minPlanProfitGate ?? null,
          rampTWorst: rampTWorst ?? 0,
          minWeeklyPctWorst,
          noFillRateWorst,
          multislice: {
            sliceStats,
          },
        })
      }
      if (validationBlocked) {
        status = "BLOCKED_BY_DATA"
        if (
          String(validationBlocked.reason ?? "")
            .trim()
            .toUpperCase() === MOONSHOT_GATE_FAILED
        ) {
          status = MOONSHOT_GATE_FAILED
        }
        passFailSummary = {
          blocked: true,
          reason: validationBlocked.reason ?? "MISSING_DATA",
          track: validationBlocked.track ?? null,
          missing: validationBlocked.missing ?? [],
          coverageIssues: validationBlocked.coverageIssues ?? [],
          coverage: validationBlocked.coverage ?? null,
          moonshotGate: validationBlocked.moonshotGate ?? null,
        }
        chosenCandidates = []
        chosenHash = null
        attemptLogSummary = {
          candidateCountTotal: baseCandidates.length,
          evaluatedCount: 0,
          selectedCount: 0,
          attempts: 1,
          seed: "default",
          costModel: rampCostModel,
          moonshot4wPass,
          moonshot4w: {
            bucketsEvaluated: moonshot4wStats.bucketsEvaluated,
            bucketsFailed: moonshot4wStats.bucketsFailed,
            buckets: moonshot4wStats.buckets,
            partialBuckets: moonshot4wStats.partialBuckets,
            rule: moonshot4wStats.rule,
            bucketPolicy: moonshot4wStats.bucketPolicy,
          },
          moonshot4wFailedBuckets: (moonshot4wStats.buckets ?? []).filter(
            (bucket) => bucket?.evaluated && !bucket?.pass,
          ),
          moonshotGateEnforced,
          moonshotGateScope: MOONSHOT_GATE_SCOPE,
          moonshotGateReason: validationBlocked.reason ?? null,
        }
      } else {
        const compareDesc = (a, b) => {
          if (a === b) return 0
          if (a === null || a === undefined) return 1
          if (b === null || b === undefined) return -1
          return b - a
        }
        const compareAsc = (a, b) => {
          if (a === b) return 0
          if (a === null || a === undefined) return 1
          if (b === null || b === undefined) return -1
          return a - b
        }
        const ranked = [...lcbEntries].sort((left, right) => {
          const ramp = compareDesc(left.rampTWorst, right.rampTWorst)
          if (ramp) return ramp
          const minWeekly = compareDesc(
            left.minWeeklyPctWorst,
            right.minWeeklyPctWorst,
          )
          if (minWeekly) return minWeekly
          const noFillWorst = compareAsc(
            left.noFillRateWorst,
            right.noFillRateWorst,
          )
          if (noFillWorst) return noFillWorst
          const primary = compareDesc(
            left.existingPrimaryScore,
            right.existingPrimaryScore,
          )
          if (primary) return primary
          const bigUp = compareDesc(
            left.lcbBigUpWeekRate,
            right.lcbBigUpWeekRate,
          )
          if (bigUp) return bigUp
          const meanLcb = compareDesc(
            left.lcbMeanWeeklyReturnPct,
            right.lcbMeanWeeklyReturnPct,
          )
          if (meanLcb) return meanLcb
          const mean = compareDesc(
            left.meanWeeklyReturnPct,
            right.meanWeeklyReturnPct,
          )
          if (mean) return mean
          return compareAsc(left.noFillRate, right.noFillRate)
        })
        chosenCandidates = ranked.map((entry) => entry.candidate)
        chosenHash = hashPayload(chosenCandidates)
        const lcbMeta = {
          gitSha: gitInfo.sha ?? null,
          strategyVersion: baseState.strategyVersion,
          cycleId,
          asOfDateKey: asOfTrading,
          chosenHash,
          validationWindow: {
            fromDateKey: validation.fromDateKey,
            toDateKey: validation.toDateKey,
          },
          weeksTotal:
            ranked[0]?.weeksTotal ??
            (validation.weekKeys ? validation.weekKeys.length : null),
          weeksTotalPolicy: "derived_from_weekKeys",
          bigUpEdgeRule:
            "exclude next-day samples that fall outside validation window",
          minPlanProfitGate: minPlanProfitGateTotals,
        }
        const lcbArtifacts = writeValidationLcbArtifacts({
          meta: lcbMeta,
          entries: ranked,
          adminKey: args.adminKey,
        })
        const multisliceMeta = {
          gitSha: gitInfo.sha ?? null,
          strategyVersion: baseState.strategyVersion,
          cycleId,
          asOfDateKey: asOfTrading,
          chosenHash,
          validationWindow: {
            fromDateKey: validation.fromDateKey,
            toDateKey: validation.toDateKey,
          },
          selectionRule: "multi_slice_worst_ramp_t",
          requiredWeeksMinPolicy: "ceil(weeksTotal*10/16)",
        }
        const multisliceArtifacts = writeValidationMultiSliceCandidates({
          meta: multisliceMeta,
          slices: validationSlices,
          entries: ranked,
          adminKey: args.adminKey,
        })
        artifactLinks = [
          ...artifactLinks.filter(
            (entry) =>
              entry?.type !== "validation_lcb_candidates" &&
              entry?.type !== "validation_multislice_rampT_candidates" &&
              entry?.type !== "validation_multislice_rampT_candidates_md",
          ),
          { type: "validation_lcb_candidates", path: lcbArtifacts.jsonPath },
          {
            type: "validation_lcb_candidates_md",
            path: lcbArtifacts.mdPath,
          },
          {
            type: "validation_multislice_rampT_candidates",
            path: multisliceArtifacts.jsonPath,
          },
          {
            type: "validation_multislice_rampT_candidates_md",
            path: multisliceArtifacts.mdPath,
          },
        ]
        attemptLogSummary = {
          candidateCountTotal: baseCandidates.length,
          evaluatedCount: baseCandidates.length,
          selectedCount: chosenCandidates.length,
          attempts: 1,
          seed: "default",
          costModel: rampCostModel,
          minPlanProfitGate: minPlanProfitGateTotals,
          moonshot4wPass,
          moonshot4w: {
            bucketsEvaluated: moonshot4wStats.bucketsEvaluated,
            bucketsFailed: moonshot4wStats.bucketsFailed,
            buckets: moonshot4wStats.buckets,
            partialBuckets: moonshot4wStats.partialBuckets,
            rule: moonshot4wStats.rule,
            bucketPolicy: moonshot4wStats.bucketPolicy,
          },
          moonshot4wFailedBuckets: (moonshot4wStats.buckets ?? []).filter(
            (bucket) => bucket?.evaluated && !bucket?.pass,
          ),
          moonshotGateEnforced,
          moonshotGateScope: MOONSHOT_GATE_SCOPE,
          moonshotGateReason: null,
          topN: baseCandidates.map((row) => ({
            track: row.track,
            patternVersionLabel: row.patternVersionLabel,
            candidateCount: row.policyParams?.candidateCount ?? null,
          })),
        }
        const leaderboardMeta = {
          asOfDateKey: asOfTrading,
          strategyVersion: baseState.strategyVersion,
          chosenHash,
          validationWindow: {
            fromDateKey: validation.fromDateKey,
            toDateKey: validation.toDateKey,
          },
          lockboxWindow: {
            fromDateKey: lockbox.fromDateKey,
            toDateKey: lockbox.toDateKey,
          },
          gitSha: gitInfo.sha ?? null,
          minPlanProfitGate: minPlanProfitGateTotals,
        }
        const leaderboard = writeLeaderboardArtifacts({
          cycleId,
          candidates: baseCandidates,
          attemptLogSummary,
          gitShort: gitInfo.shortSha ?? "nogit",
          meta: leaderboardMeta,
          adminKey: args.adminKey,
        })
        artifactLinks = [
          ...artifactLinks.filter(
            (entry) => entry?.type !== "validation_leaderboard",
          ),
          { type: "validation_leaderboard", path: leaderboard.jsonPath },
          { type: "validation_leaderboard_md", path: leaderboard.mdPath },
        ]
        if (shadowSlices?.cycleId !== cycleId) {
          const sliceDefs = buildShadowSlices({
            calendar,
            asOfDateKey: asOfTrading,
            weekCount: 16,
          })
          const sliceResults = []
          for (const slice of sliceDefs) {
            if (slice.blocked) {
              sliceResults.push({
                name: slice.name,
                blocked: true,
                reason: slice.reason,
              })
              continue
            }
            const sliceCalendar = normalizeCalendar(calendar, slice.toDateKey)
            const trackRows = []
            let sliceBlockedReason = null
            for (const candidate of chosenCandidates) {
              const track = candidate.track
              const data = await loadTrackData({
                prisma,
                track,
                horizonStart: trainFromDateKey,
                windowEnd: slice.toDateKey,
                instrumentExclusionMap,
              })
              const readiness = assessTrackDataReadiness({
                track,
                data,
                asOfDateKey: slice.toDateKey,
                thresholds: coverageThresholds,
              })
              if (!readiness.ok) {
                const detail =
                  readiness.reason === "DATA_COVERAGE_LOW"
                    ? readiness.coverageIssues.join("|")
                    : readiness.missing.join("|")
                sliceBlockedReason =
                  (readiness.reason ?? "MISSING_DATA") +
                  ":" +
                  track +
                  ":" +
                  (detail || "NONE")
                break
              }
              const patterns =
                (await loadPatternsByLabelAndVersion(
                  prisma,
                  track,
                  candidate.patternVersionLabel,
                )) ?? null
              if (!patterns) {
                sliceBlockedReason = `PATTERN_MISSING:${track}`
                break
              }
              const metrics = evaluateCandidateWindow({
                candidate,
                data,
                patterns,
                calendar: sliceCalendar,
                weekKeys: slice.weekKeys,
                windowStart: slice.fromDateKey,
                windowEnd: slice.toDateKey,
                costModel: rampCostModel,
                minWorst2wAvgPct,
              })
              const notes =
                metrics.bigUpMetrics.excludedOutsideWindow > 0
                  ? `edgeExcluded=${metrics.bigUpMetrics.excludedOutsideWindow}`
                  : ""
              trackRows.push({
                track,
                bigUpWeeksCount: metrics.bigUpMetrics.bigUpWeeksCount24,
                weeksTotal: metrics.weeksTotal,
                meanWeeklyReturnPct: metrics.meanWeeklyReturnPct,
                minWeeklyPct: metrics.summary.metrics?.minWeeklyPct ?? null,
                noFillRate: metrics.noFillRate,
                notes,
              })
            }
            if (sliceBlockedReason) {
              sliceResults.push({
                name: slice.name,
                blocked: true,
                reason: sliceBlockedReason,
              })
              continue
            }
            sliceResults.push({
              name: slice.name,
              blocked: false,
              window: {
                fromDateKey: slice.fromDateKey,
                toDateKey: slice.toDateKey,
                weekKeys: slice.weekKeys,
              },
              tracks: trackRows,
            })
          }
          const shadowMeta = {
            gitSha: gitInfo.sha ?? null,
            strategyVersion: baseState.strategyVersion,
            cycleId,
            asOfDateKey: asOfTrading,
            chosenHash,
            validationWindow: {
              fromDateKey: validation.fromDateKey,
              toDateKey: validation.toDateKey,
            },
          }
          const shadowArtifacts = writeShadowSliceArtifacts({
            meta: shadowMeta,
            slices: sliceResults,
            adminKey: args.adminKey,
          })
          shadowSlices = {
            cycleId,
            generatedAt: formatKstStamp(),
            asOfDateKey: asOfTrading,
            artifacts: shadowArtifacts,
          }
          artifactLinks = [
            ...artifactLinks.filter((entry) => entry?.type !== "shadow_slices"),
            { type: "shadow_slices", path: shadowArtifacts.jsonPath },
            { type: "shadow_slices_md", path: shadowArtifacts.mdPath },
          ]
        }
        status =
          asOfTrading >= lockbox.fromDateKey
            ? "LOCKBOX_IN_PROGRESS"
            : "WAITING_FOR_MORE_DATA"
      }
    }
  }

  if (status === "WAITING_FOR_MORE_DATA") {
    if (asOfTrading >= lockbox.fromDateKey) {
      status = "LOCKBOX_IN_PROGRESS"
    }
  }

  if (status === "LOCKBOX_IN_PROGRESS") {
    if (
      detectFreezeViolation({
        status,
        previousHash: priorState?.chosenHash,
        nextHash: chosenHash,
      })
    ) {
      status = "FREEZE_VIOLATION"
      passFailSummary = {
        blocked: true,
        reason: "FREEZE_VIOLATION",
      }
    } else if (asOfTrading >= lockbox.toDateKey) {
      const calendarRange = normalizeCalendar(calendar, lockbox.toDateKey)
      const lockboxMoonshotOutcomes = await loadMoonshotValidationOutcomes({
        prisma,
        validationStartDateKey: lockbox.fromDateKey,
        validationEndDateKey: lockbox.toDateKey,
        calendar,
        strategyVersion: baseState.strategyVersion,
        strategyVersionPrefix: MOONSHOT_STRATEGY_PREFIX,
        patternVersionLabel: selectSurgePatternVersionLabel(chosenCandidates),
        activeOnly: true,
      })
      const lockboxMoonshot4wStats = computeMoonshot4wStats(
        lockboxMoonshotOutcomes,
        lockbox.fromDateKey,
        lockbox.toDateKey,
        calendar,
      )
      const lockboxMoonshot4wPass = lockboxMoonshot4wStats.overallPass
      const lockboxMoonshotGateEnforced = hasSurgeCandidate(chosenCandidates)
      const lockboxMoonshotGateFailed =
        lockboxMoonshotGateEnforced && !lockboxMoonshot4wPass
      const policyResults = []
      let moonshotGateFailureRecorded = false
      for (const candidate of chosenCandidates) {
        const track = candidate.track
        if (track === "SURGE_EOD" && lockboxMoonshotGateFailed) {
          if (!moonshotGateFailureRecorded) {
            policyResults.push({
              track,
              pass: false,
              blocked: true,
              reason: MOONSHOT_GATE_FAILED,
              moonshotGate: {
                scope: MOONSHOT_GATE_SCOPE,
                pass: lockboxMoonshot4wPass,
                failedWeeks: null,
                failedBuckets: lockboxMoonshot4wStats.bucketsFailed ?? null,
                minSignalsPerWeek:
                  lockboxMoonshot4wStats.minSignalsPerWeek ?? null,
                preferredSignalsPerWeek:
                  lockboxMoonshot4wStats.preferredSignalsPerWeek ?? null,
              },
            })
            moonshotGateFailureRecorded = true
          }
          continue
        }
        const data = await loadTrackData({
          prisma,
          track,
          horizonStart: trainFromDateKey,
          windowEnd: lockbox.toDateKey,
          instrumentExclusionMap,
        })
        const readiness = assessTrackDataReadiness({
          track,
          data,
          asOfDateKey: lockbox.toDateKey,
          thresholds: coverageThresholds,
        })
        if (!readiness.ok) {
          policyResults.push({
            track,
            pass: false,
            blocked: true,
            reason: readiness.reason ?? "MISSING_DATA",
            missing: readiness.missing,
            coverage: readiness.coverage,
            coverageIssues: readiness.coverageIssues,
          })
          continue
        }
        const patterns =
          (await loadPatternsByLabelAndVersion(
            prisma,
            track,
            candidate.patternVersionLabel,
          )) ?? null
        if (!patterns) {
          policyResults.push({
            track,
            pass: false,
            blocked: true,
            reason: "PATTERN_MISSING",
          })
          continue
        }
        const windowEval = evaluateWindow({
          data: {
            ...data,
            symbols: data.universe.map((row) => ({
              symbol: row.symbol,
              tradingDateKey: row.tradingDateKey,
              avgTradingValue20d: row.avgTradingValue20d,
            })),
          },
          patterns,
          policyParams: candidate.policyParams,
          track,
          calendar: calendarRange,
          weekKeys: lockbox.weekKeys,
          windowStart: lockbox.fromDateKey,
          windowEnd: lockbox.toDateKey,
          costModel: rampCostModel,
        })
        const bigUpMetrics =
          track === "SURGE_EOD"
            ? computeBigUpMetrics({
                signals: windowEval.signals,
                candles: data.candles,
                calendar: calendarRange,
                weekKeys: lockbox.weekKeys,
              })
            : {
                bigUpWeeksCount24: 0,
                bigUpExcludedByGapCount: 0,
                bigUpWeekKeys: [],
              }
        const noFillRate =
          windowEval.results.length > 0
            ? countNoFillResults(windowEval.results) / windowEval.results.length
            : 0
        const summary = evaluateWeeklySummary({
          weekSeries: windowEval.weekSeries,
          targetStart: 5,
          minWeeksGE: 10,
          bigUpWeeksCount24: bigUpMetrics.bigUpWeeksCount24,
          requiredBigUpWeeks: track === "SURGE_EOD" ? 10 : 0,
          minWorst2wAvgPct,
          noFillRate,
          noFillRateMax: 0.35,
          emptyWeekAllowed: 0,
          useRamp: true,
        })
        policyResults.push({
          track,
          pass: summary.pass,
          metrics: summary.metrics,
          bigUp: bigUpMetrics,
          noFillRate,
          minPlanProfitGate: windowEval.minPlanProfitGate ?? null,
          weekSeries: windowEval.weekSeries,
          results: windowEval.results,
          signals: windowEval.signals,
          patternVersionId: candidate.patternVersionId ?? null,
          patternVersionLabel: candidate.patternVersionLabel ?? null,
          strategyVersion: baseState.strategyVersion,
        })
      }
      const lockboxPass = policyResults.every((row) => row.pass)
      passFailSummary = {
        lockboxPass,
        moonshotGate: {
          scope: MOONSHOT_GATE_SCOPE,
          enforced: lockboxMoonshotGateEnforced,
          pass: lockboxMoonshot4wPass,
          failedWeeks: null,
          failedBuckets: lockboxMoonshot4wStats.bucketsFailed ?? null,
        },
        results: policyResults.map((row) => ({
          track: row.track,
          pass: row.pass,
          metrics: row.metrics ?? null,
          bigUpWeeksCount24: row.bigUp?.bigUpWeeksCount24 ?? null,
          noFillRate: row.noFillRate ?? null,
          blocked: row.blocked ?? false,
          reason: row.reason ?? null,
          minPlanProfitGate: row.minPlanProfitGate ?? null,
          moonshotGate: row.moonshotGate ?? null,
        })),
      }
      if (lockboxPass) {
        status = "LOCKBOX_PASSED"
      } else {
        status = "LOCKBOX_FAILED"
        const nextPlan = buildNextCyclePlan({
          lockboxWindow: lockbox,
          calendar,
        })
        let nextCandidates = []
        let nextBlocked = null
        let nextChosenHash = null
        let nextAttemptLogSummary = null
        if (nextPlan) {
          const nextCandidateResult = await resolveCandidatesForTracks({
            prisma,
            asOfDateKey: lockbox.toDateKey,
          })
          const moonshotOutcomes = await loadMoonshotValidationOutcomes({
            prisma,
            validationStartDateKey: nextPlan.nextValidation.fromDateKey,
            validationEndDateKey: nextPlan.nextValidation.toDateKey,
            calendar,
            strategyVersion: baseState.strategyVersion,
            strategyVersionPrefix: MOONSHOT_STRATEGY_PREFIX,
            patternVersionLabel: selectSurgePatternVersionLabel(
              nextCandidateResult.candidates,
            ),
            activeOnly: true,
          })
          const moonshot4wStats = computeMoonshot4wStats(
            moonshotOutcomes,
            nextPlan.nextValidation.fromDateKey,
            nextPlan.nextValidation.toDateKey,
            calendar,
          )
          const moonshot4wPass = moonshot4wStats.overallPass
          nextCandidates = nextCandidateResult.candidates.map((row) =>
            row.track === "SURGE_EOD"
              ? {
                  ...row,
                  moonshotEnabled: moonshot4wPass,
                  moonshot4wPass,
                }
              : row,
          )
          nextBlocked = nextCandidateResult.blockedCandidate
          const nextMoonshotGateEnforced = hasSurgeCandidate(nextCandidates)
          if (!nextBlocked && nextMoonshotGateEnforced && !moonshot4wPass) {
            nextBlocked = {
              reason: MOONSHOT_GATE_FAILED,
              track: "SURGE_EOD",
              moonshotGate: {
                scope: MOONSHOT_GATE_SCOPE,
                pass: moonshot4wPass,
                failedWeeks: null,
                failedBuckets: moonshot4wStats.bucketsFailed ?? null,
                minSignalsPerWeek: moonshot4wStats.minSignalsPerWeek ?? null,
                preferredSignalsPerWeek:
                  moonshot4wStats.preferredSignalsPerWeek ?? null,
              },
            }
          }
          if (!nextBlocked) {
            nextChosenHash = hashPayload(nextCandidates)
            nextAttemptLogSummary = {
              candidateCountTotal: nextCandidates.length,
              evaluatedCount: nextCandidates.length,
              selectedCount: nextCandidates.length,
              attempts: 1,
              seed: "default",
              costModel: rampCostModel,
              moonshot4wPass,
              moonshot4w: {
                bucketsEvaluated: moonshot4wStats.bucketsEvaluated,
                bucketsFailed: moonshot4wStats.bucketsFailed,
                buckets: moonshot4wStats.buckets,
                partialBuckets: moonshot4wStats.partialBuckets,
                rule: moonshot4wStats.rule,
                bucketPolicy: moonshot4wStats.bucketPolicy,
              },
              moonshot4wFailedBuckets: (moonshot4wStats.buckets ?? []).filter(
                (bucket) => bucket?.evaluated && !bucket?.pass,
              ),
              moonshotGateEnforced: nextMoonshotGateEnforced,
              moonshotGateScope: MOONSHOT_GATE_SCOPE,
              moonshotGateReason: null,
              topN: nextCandidates.map((row) => ({
                track: row.track,
                patternVersionLabel: row.patternVersionLabel,
                candidateCount: row.policyParams?.candidateCount ?? null,
              })),
            }
          } else {
            nextCandidates = []
            nextChosenHash = null
            nextAttemptLogSummary = {
              candidateCountTotal: nextCandidateResult.candidates.length,
              evaluatedCount: 0,
              selectedCount: 0,
              attempts: 1,
              seed: "default",
              costModel: rampCostModel,
              moonshot4wPass,
              moonshot4w: {
                bucketsEvaluated: moonshot4wStats.bucketsEvaluated,
                bucketsFailed: moonshot4wStats.bucketsFailed,
                buckets: moonshot4wStats.buckets,
                partialBuckets: moonshot4wStats.partialBuckets,
                rule: moonshot4wStats.rule,
                bucketPolicy: moonshot4wStats.bucketPolicy,
              },
              moonshot4wFailedBuckets: (moonshot4wStats.buckets ?? []).filter(
                (bucket) => bucket?.evaluated && !bucket?.pass,
              ),
              moonshotGateEnforced: nextMoonshotGateEnforced,
              moonshotGateScope: MOONSHOT_GATE_SCOPE,
              moonshotGateReason: nextBlocked.reason ?? null,
            }
          }
        }
        const nextCycleId = nextPlan
          ? `cycle_${nextPlan.nextLockbox.fromDateKey}_${nextPlan.nextLockbox.toDateKey}`
          : null
        let nextLeaderboard = null
        if (nextPlan && nextAttemptLogSummary && nextCycleId) {
          const leaderboardMeta = {
            asOfDateKey: asOfTrading,
            strategyVersion: baseState.strategyVersion,
            chosenHash: nextChosenHash,
            validationWindow: {
              fromDateKey: nextPlan.nextValidation.fromDateKey,
              toDateKey: nextPlan.nextValidation.toDateKey,
            },
            lockboxWindow: {
              fromDateKey: nextPlan.nextLockbox.fromDateKey,
              toDateKey: nextPlan.nextLockbox.toDateKey,
            },
            gitSha: gitInfo.sha ?? null,
          }
          nextLeaderboard = writeLeaderboardArtifacts({
            cycleId: nextCycleId,
            candidates: nextCandidates,
            attemptLogSummary: nextAttemptLogSummary,
            gitShort: gitInfo.shortSha ?? "nogit",
            meta: leaderboardMeta,
            adminKey: args.adminKey,
          })
        }
        nextCyclePlan = buildNextCyclePlanPayload({
          nextPlan,
          nextCandidates,
          nextChosenHash,
          nextAttemptLogSummary,
          nextBlocked,
          nextLeaderboard,
        })
        const postmortem = buildPostmortemReport({
          cycleId,
          lockboxWindow: lockbox,
          policyResults,
          meta: {
            asOfDateKey: asOfTrading,
            strategyVersion: baseState.strategyVersion,
            chosenHash,
            gitSha: gitInfo.sha ?? null,
          },
        })
        const stamp = formatKstStamp()
        const gitShort = gitInfo.shortSha ?? "nogit"
        const postmortemJson = path.join(
          reviewDir,
          `lockbox_postmortem_${cycleId}_${stamp}_${gitShort}.json`,
        )
        const postmortemMd = path.join(
          reviewDir,
          `lockbox_postmortem_${cycleId}_${stamp}_${gitShort}.md`,
        )
        const patternInputs = path.join(
          reviewDir,
          `pattern_mining_inputs_${cycleId}_${stamp}_${gitShort}.json`,
        )
        writeJsonGuarded(postmortemJson, postmortem.json, args.adminKey)
        writeTextGuarded(postmortemMd, postmortem.md, args.adminKey)
        writeJsonGuarded(patternInputs, postmortem.patternInputs, args.adminKey)
        artifactLinks = [
          ...artifactLinks.filter(
            (entry) =>
              entry?.type !== "lockbox_postmortem" &&
              entry?.type !== "pattern_mining_inputs",
          ),
          { type: "lockbox_postmortem", path: postmortemJson },
          { type: "lockbox_postmortem_md", path: postmortemMd },
          { type: "pattern_mining_inputs", path: patternInputs },
        ]
      }
    }
  }

  if (status === "LOCKBOX_FAILED" && autoAdvanceEnabled && args.autoAdvance) {
    if (
      nextCyclePlan?.lockboxStartDateKey &&
      nextCyclePlan?.lockboxEndDateKey &&
      !nextCyclePlan.estimated &&
      asOfTrading >= nextCyclePlan.lockboxStartDateKey
    ) {
      const nextCycleId = `cycle_${nextCyclePlan.lockboxStartDateKey}_${nextCyclePlan.lockboxEndDateKey ?? "unknown"}`
      const nextCalendar = normalizeCalendar(
        calendar,
        nextCyclePlan.lockboxEndDateKey,
      )
      const nextTrainTo =
        resolvePrevTradingDay({
          calendar: nextCalendar,
          dateKey: nextCyclePlan.validationStartDateKey,
        }) ?? nextCyclePlan.validationStartDateKey
      const nextTrainFrom =
        firstDayOfMonth(
          shiftDateKeyByMonths(nextCyclePlan.validationStartDateKey, -62),
        ) ?? nextTrainTo
      status = nextCyclePlan.nextStatus ?? "WAITING_FOR_MORE_DATA"
      chosenCandidates =
        Array.isArray(nextCyclePlan.nextChosenCandidates) &&
        nextCyclePlan.nextChosenCandidates.length
          ? nextCyclePlan.nextChosenCandidates
          : []
      chosenHash = nextCyclePlan.nextChosenHash ?? null
      attemptLogSummary = nextCyclePlan.nextAttemptLogSummary ?? null
      passFailSummary = null
      artifactLinks = []
      const adoptedNextCyclePlan = nextCyclePlan
      nextCyclePlan = null
      const snapshot = {
        cycleId: nextCycleId,
        ...baseState,
        asOfDateKey: asOfTrading,
        trainStartDateKey: nextTrainFrom,
        trainEndDateKey: nextTrainTo,
        validationStartDateKey: adoptedNextCyclePlan.validationStartDateKey,
        validationEndDateKey: adoptedNextCyclePlan.validationEndDateKey,
        lockboxStartDateKey: adoptedNextCyclePlan.lockboxStartDateKey,
        lockboxEndDateKey: adoptedNextCyclePlan.lockboxEndDateKey,
        status,
        chosenCandidates,
        chosenHash,
        attemptLogSummary,
        passFailSummary,
        runCycleConfigSanity,
        failureLeaderboard: summarizeRunCycleFailures({
          status,
          passFailSummary,
          attemptLogSummary,
        }),
        shadowSlices: null,
        artifactLinks,
        nextCyclePlan,
      }
      writeJsonGuarded(cycleStatePath, snapshot, args.adminKey)
      writeJsonGuarded(
        path.join(
          reviewDir,
          `cycle_state_${nextCycleId}_${formatKstStamp()}_${gitInfo.shortSha ?? "nogit"}.json`,
        ),
        snapshot,
        args.adminKey,
      )
    }
  }

  const nextState = {
    ...baseState,
    status,
    chosenCandidates,
    chosenHash,
    attemptLogSummary,
    passFailSummary,
    runCycleConfigSanity,
    failureLeaderboard: summarizeRunCycleFailures({
      status,
      passFailSummary,
      attemptLogSummary,
    }),
    shadowSlices,
    artifactLinks,
    nextCyclePlan,
  }
  writeJsonGuarded(cycleStatePath, nextState, args.adminKey)
  writeJsonGuarded(
    path.join(
      reviewDir,
      `cycle_state_${cycleId}_${formatKstStamp()}_${gitInfo.shortSha ?? "nogit"}.json`,
    ),
    nextState,
    args.adminKey,
  )

  if (!args.dryRun) {
    const memorySnapBeforeReport = checkSystemMemoryHeadroom({
      stage: "fill-signal-stats",
      minFreeRatio: cycleMinFreeMemRatio,
      minFreeMb: cycleMinFreeMemMb,
    })
    console.log(
      `[cycle] memory before-report free=${memorySnapBeforeReport.freeMb}MB/${memorySnapBeforeReport.totalMb}MB ratio=${memorySnapBeforeReport.freeRatio.toFixed(3)}`,
    )
    const childArgs = [
      "scripts/reports/fill-signal-stats.mjs",
      `--asOf=${asOfTrading}`,
      "--strictMeta",
    ]
    if (args.adminKey) {
      childArgs.push(`--adminKey=${args.adminKey}`)
    }
    const result = spawnSync("node", childArgs, { stdio: "inherit" })
    if (!result || result.status !== 0) {
      console.log("[cycle] trial report fill failed")
    }
  }

  await prisma.$disconnect()
  release()
}

run().catch((error) => {
  console.error("[cycle-run] failed", error)
  process.exitCode = 1
})
