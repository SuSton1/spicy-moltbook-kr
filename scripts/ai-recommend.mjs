import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import dotenv from "dotenv"

import { PrismaClient } from "@prisma/client"

import {
  buildTradingCalendarRange,
  normalizeDateKey,
  shiftDateKey,
} from "./ai-date-range.lib.mjs"
import { DEFAULT_LEVEL_POLICY, buildLevelPlan } from "./lib/levelPolicy.mjs"
import {
  DEFAULT_DISPLAY_LIQUIDITY_MIN,
  buildRecommendCandidates,
  scoreMoonshotCandidate,
} from "./lib/recommend.mjs"
import {
  extractPolicyParamsFromActiveConfig,
  extractPoolCandidatesFromActiveConfig,
  extractPoolSetsFromActiveConfig,
  prependActivePatternCandidate,
  resolveCandidatePolicy,
  selectPrimaryPoolSetFromTrack,
} from "./lib/activeStrategyPolicy.mjs"
import {
  evaluateMarketCap,
  resolveMarketCapKrw,
} from "./lib/marketCapFilter.mjs"
import { applyAsOfGuard } from "./lib/asOfGuard.mjs"
import {
  evaluateMinPlanProfit,
  getThresholdPct,
} from "./lib/minPlanProfitGate.mjs"
import {
  resolveTrainTestRanges,
  trainPatternsFromData,
} from "./lib/patternTraining.mjs"
import {
  extractRegimeTag,
  normalizeRegimeTag,
  rankPatternPoolCandidates,
  selectPatternFromPoolCandidates,
  selectPatternVersionLabel,
} from "./lib/patternVersions.mjs"
import { resolveMarketRegimeForDate } from "./lib/marketRegimeDay.mjs"
import {
  resolveAsOfDateKey,
  resolveLastTradingDateKey,
  resolveTodayKstDateKey,
  resolveTradingCalendarRange,
  resolveTradingWindow,
} from "./lib/tradingCalendar.mjs"
import { eligibleSymbolsForDate } from "./lib/eligibleSymbols.mjs"
import {
  buildGapFeatureDays,
  buildGapIntradaySeq,
  filterCandlesToPrevTradingDay,
} from "./lib/gap15.mjs"
import { filterGapCandidatesByTradability } from "./lib/tradability15.mjs"
import { assertServerOnly } from "./lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "./lib/noKisGuard.mjs"

const rootDir = process.cwd()

const DEFAULT_FIXTURE_PATH = path.join(
  rootDir,
  "scripts",
  "fixtures",
  "ai-recommend.contract.json",
)

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  candidates.forEach((file) => {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  })
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => {
    const match = args.find((arg) => arg.startsWith(`${key}=`))
    return match ? match.slice(key.length + 1) : null
  }
  const hasFlag = (key) => args.includes(key)

  const asOfInput = getValue("--asOf") ?? getValue("--asof")
  const asOfDateKey = normalizeDateKey(asOfInput)
  const fromDateKey = normalizeDateKey(getValue("--from"))
  const toDateKey = normalizeDateKey(getValue("--to"))
  const trackRaw = String(getValue("--track") ?? "")
    .trim()
    .toUpperCase()
  const minLiquidityFlag = getValue("--minLiquidity")
  const minLiquidityProvided = minLiquidityFlag !== null
  const minLiquidityRaw = minLiquidityProvided ? Number(minLiquidityFlag) : NaN
  const minLiquidity = Number.isFinite(minLiquidityRaw)
    ? minLiquidityRaw
    : Number(process.env.AI_DISPLAY_LIQUIDITY_MIN_KRW) ||
      DEFAULT_DISPLAY_LIQUIDITY_MIN
  const maxEod = Math.max(1, Math.min(2, Number(getValue("--maxEod")) || 2))
  // Operating rule: GAP_15_BET must emit at most one symbol per day.
  const maxGap = Math.max(0, Math.min(1, Number(getValue("--maxGap")) || 1))
  const maxRecommendationPerTrackRaw =
    getValue("--maxRecommendationPerTrack") ??
    process.env.MAX_RECOMMENDATION_PER_TRACK
  const moonshotMaxPicksPerDayRaw =
    getValue("--moonshotMaxPicksPerDay") ??
    process.env.MOONSHOT_MAX_PICKS_PER_DAY
  const keepZeroWhenNoMatchRaw =
    getValue("--keepZeroWhenNoMatch") ?? process.env.KEEP_ZERO_WHEN_NO_MATCH
  const routerCloseDecisionTimeKSTRaw =
    getValue("--routerCloseDecisionTimeKST") ??
    process.env.ROUTER_CLOSE_DECISION_TIME_KST
  const maxRecommendationPerTrack = 1
  const moonshotMaxPicksPerDay = 1
  const keepZeroWhenNoMatch = true
  const routerCloseDecisionTimeKST = "15:30"
  if (
    maxRecommendationPerTrackRaw !== null &&
    maxRecommendationPerTrackRaw !== undefined &&
    Number(maxRecommendationPerTrackRaw) !== maxRecommendationPerTrack
  ) {
    const error = new Error(
      "POLICY_CONFLICT_BLOCKED maxRecommendationPerTrack must be 1",
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (
    moonshotMaxPicksPerDayRaw !== null &&
    moonshotMaxPicksPerDayRaw !== undefined &&
    Number(moonshotMaxPicksPerDayRaw) !== moonshotMaxPicksPerDay
  ) {
    const error = new Error(
      "POLICY_CONFLICT_BLOCKED moonshotMaxPicksPerDay must be 1",
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  if (keepZeroWhenNoMatchRaw !== null && keepZeroWhenNoMatchRaw !== undefined) {
    const keepZeroToken = String(keepZeroWhenNoMatchRaw).trim().toLowerCase()
    const keepZeroValue =
      keepZeroToken === "1" ||
      keepZeroToken === "true" ||
      keepZeroToken === "yes" ||
      keepZeroToken === "on" ||
      keepZeroToken === "y"
    if (keepZeroValue !== true) {
      const error = new Error(
        "POLICY_CONFLICT_BLOCKED keepZeroWhenNoMatch must be true",
      )
      error.code = "POLICY_CONFLICT_BLOCKED"
      throw error
    }
  }
  if (
    routerCloseDecisionTimeKSTRaw !== null &&
    routerCloseDecisionTimeKSTRaw !== undefined &&
    String(routerCloseDecisionTimeKSTRaw).trim() !== routerCloseDecisionTimeKST
  ) {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED routerCloseDecisionTimeKST must be ${routerCloseDecisionTimeKST}`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  const scoreEpsFlag = getValue("--scoreEps")
  const scoreEpsProvided = scoreEpsFlag !== null
  const scoreEps = scoreEpsProvided ? Number(scoreEpsFlag) : Number.NaN
  const vectorBinsFlag = getValue("--vectorBins") ?? getValue("--bins")
  const vectorBinsProvided = vectorBinsFlag !== null
  const vectorBinsRaw = vectorBinsProvided ? Number(vectorBinsFlag) : NaN
  const vectorBins = Number.isFinite(vectorBinsRaw)
    ? Math.max(1, Math.floor(vectorBinsRaw))
    : null
  const settingsHash = String(getValue("--settingsHash") ?? "recommend-v1")
    .trim()
    .slice(0, 64)
  const dryRun = hasFlag("--dryRun")
  const reset = hasFlag("--no-reset") ? false : true
  const fixtureFlag = hasFlag("--fixture")
  const fixturePath = getValue("--fixture") ?? (fixtureFlag ? "default" : null)
  const ignoreActiveStrategy =
    hasFlag("--ignoreActiveStrategy") || hasFlag("--ignore-active-strategy")
  const requireActiveStrategy =
    !ignoreActiveStrategy &&
    !hasFlag("--no-requireActiveStrategy") &&
    !hasFlag("--no-require-active-strategy")
  const allowEmptyEligible =
    hasFlag("--allow-empty-eligible") || hasFlag("--allowEmptyEligible")
  const regimeOverride = normalizeRegimeTag(getValue("--regime"))
  const allowLegacyPatternFallback = (() => {
    if (
      hasFlag("--allow-legacy-pattern-fallback") ||
      hasFlag("--allowLegacyPatternFallback")
    ) {
      return true
    }
    const token = String(
      process.env.RECOMMEND_ALLOW_LEGACY_PATTERN_FALLBACK ?? "",
    )
      .trim()
      .toLowerCase()
    return (
      token === "1" ||
      token === "true" ||
      token === "yes" ||
      token === "on" ||
      token === "y"
    )
  })()
  const routerRequireTrainRangeValid = (() => {
    if (
      hasFlag("--router-require-train-range-valid") ||
      hasFlag("--routerRequireTrainRangeValid")
    ) {
      return true
    }
    if (
      hasFlag("--no-router-require-train-range-valid") ||
      hasFlag("--no-routerRequireTrainRangeValid")
    ) {
      return false
    }
    const token = String(process.env.ROUTER_REQUIRE_TRAIN_RANGE_VALID ?? "")
      .trim()
      .toLowerCase()
    if (!token) return true
    return (
      token === "1" ||
      token === "true" ||
      token === "yes" ||
      token === "on" ||
      token === "y"
    )
  })()
  const recommendationModeRaw = String(
    getValue("--recommendationMode") ??
      getValue("--mode") ??
      process.env.RECOMMENDATION_MODE ??
      "",
  )
    .trim()
    .toUpperCase()
  const recommendationMode =
    recommendationModeRaw === "INTRADAY_1500" ||
    recommendationModeRaw === "INTRADAY"
      ? "INTRADAY_1500"
      : recommendationModeRaw === "EOD_CLOSE" || recommendationModeRaw === "EOD"
        ? "EOD_CLOSE"
        : "ALL"

  return {
    asOfInput,
    asOfDateKey,
    fromDateKey,
    toDateKey,
    trackRaw,
    minLiquidity,
    maxEod,
    maxGap,
    maxRecommendationPerTrack,
    moonshotMaxPicksPerDay,
    keepZeroWhenNoMatch,
    routerCloseDecisionTimeKST,
    scoreEps,
    vectorBins,
    settingsHash,
    dryRun,
    reset,
    fixturePath,
    ignoreActiveStrategy,
    requireActiveStrategy,
    allowEmptyEligible,
    regimeOverride,
    allowLegacyPatternFallback,
    routerRequireTrainRangeValid,
    recommendationMode,
    cliProvided: {
      minLiquidity: minLiquidityProvided,
      scoreEps: scoreEpsProvided,
      vectorBins: vectorBinsProvided,
    },
  }
}

const resolveDataMode = () => {
  const raw = (
    process.env.DATA_MODE ||
    process.env.VITE_DATA_MODE ||
    process.env.E2E_DATA_MODE ||
    ""
  )
    .trim()
    .toLowerCase()
  if (!raw) {
    return "live"
  }
  if (raw.includes("contract") || raw.includes("fixture")) {
    return "contract"
  }
  if (raw.includes("kis") || raw.includes("live")) {
    return "live"
  }
  return "live"
}

const resolveFixturePath = (fixturePath) => {
  const raw = String(fixturePath ?? "").trim()
  if (!raw) {
    return null
  }
  if (raw === "default") {
    return DEFAULT_FIXTURE_PATH
  }
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw)
}

const readFixture = (fixturePath) => {
  const resolved = resolveFixturePath(fixturePath)
  if (!resolved) {
    return null
  }
  try {
    const raw = fs.readFileSync(resolved, "utf8")
    const parsed = JSON.parse(raw)
    const meta = parsed?.meta ?? {}
    return {
      path: resolved,
      fromDateKey: normalizeDateKey(meta.fromDateKey),
      toDateKey: normalizeDateKey(meta.toDateKey),
      symbols: Array.isArray(parsed?.symbols) ? parsed.symbols : [],
      candles: Array.isArray(parsed?.candles) ? parsed.candles : [],
      price15: Array.isArray(parsed?.price15) ? parsed.price15 : [],
      universe: Array.isArray(parsed?.universe) ? parsed.universe : [],
      featureDays: Array.isArray(parsed?.featureDays) ? parsed.featureDays : [],
      intradayProfiles: Array.isArray(parsed?.intradayProfiles)
        ? parsed.intradayProfiles
        : [],
    }
  } catch {
    return null
  }
}

const buildCandleMap = (candles) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const entry = map.get(symbol) ?? []
    entry.push({
      dateKey,
      open: row?.open,
      high: row?.high,
      low: row?.low,
      close: row?.close,
    })
    map.set(symbol, entry)
  }
  return map
}

const buildFeatureMap = (featureDays, asOfDateKey) =>
  new Map(
    (featureDays ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), row.features ?? null]),
  )

const buildIntradayMap = (intradayProfiles, asOfDateKey) =>
  new Map(
    (intradayProfiles ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), row.seq ?? null]),
  )

const buildStrategyVersion = ({ track, asOfDateKey, patternLabel }) => {
  const ruleset = track === "SURGE_EOD" ? "EOD_1x2" : "GAP_15_BET"
  const label = patternLabel ? String(patternLabel) : "unknown"
  return `vfinal7:${asOfDateKey}:${track}:${ruleset}:${label}`
}

const loadSymbolUniverse = async (
  prisma,
  asOfDateKey,
  { allowEmptyEligible = false } = {},
) => {
  if (!asOfDateKey) {
    throw new Error("asOfDateKey is required for eligible symbols")
  }
  const eligible = await eligibleSymbolsForDate({
    dateKey: asOfDateKey,
    prisma,
  })
  if (!eligible.symbols.length) {
    if (allowEmptyEligible) {
      return []
    }
    throw new Error("ELIGIBLE_SYMBOLS_EMPTY")
  }
  return eligible.symbols
}

const sliceTradingWindow = ({
  calendar,
  indexByDateKey,
  asOfDateKey,
  tradingDays,
}) => {
  const list = Array.isArray(calendar) ? calendar : []
  const index = indexByDateKey?.get(asOfDateKey)
  if (typeof index !== "number" || index < 0) {
    return []
  }
  const end = Math.min(list.length, index + 1)
  const start = Math.max(0, end - Math.max(1, tradingDays ?? 1))
  return list.slice(start, end)
}

const resolveRequiredTradingDays = (activeMap) => {
  const tracks = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  let required = 30
  for (const track of tracks) {
    const row = activeMap?.get(track) ?? null
    const params = extractPolicyParamsFromActiveConfig(row?.activeConfigJson)
    const lookback = Number(params?.lookbackDays)
    if (Number.isFinite(lookback)) {
      required = Math.max(required, Math.floor(lookback))
    }
  }
  return Math.max(30, Math.min(120, required))
}

const buildLevelPlanForSymbol = ({
  levelMap,
  policyParams,
  symbol,
  candles,
  asOfDateKey,
}) => {
  const policyEntry = levelMap?.get(symbol) ?? null
  if (policyEntry?.plan) {
    return policyEntry.plan
  }
  const toPctOrUndefined = (value) => {
    if (value === null || value === undefined) {
      return undefined
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  const toIntOrUndefined = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }
  const candleCount = Array.isArray(candles) ? candles.length : 0
  const minLookback = Math.min(
    DEFAULT_LEVEL_POLICY.minLookback,
    Math.max(5, candleCount),
  )
  const lookbackDays = Math.min(
    toIntOrUndefined(policyParams?.lookbackDays) ??
      DEFAULT_LEVEL_POLICY.lookbackDays,
    candleCount,
  )
  return buildLevelPlan({
    candles,
    asOfDateKey,
    lookbackDays,
    entryBandPct: toPctOrUndefined(policyParams?.entryBandPct),
    stopBandPct: toPctOrUndefined(policyParams?.stopBandPct),
    targetBandPct: toPctOrUndefined(policyParams?.targetBandPct),
    trailingPct: toPctOrUndefined(policyParams?.trailingPct),
    minRewardPct: toPctOrUndefined(policyParams?.minRewardPct),
    minLookback,
  })
}

const computeGrade = (score) => {
  if (score >= 80) return { grade: "A", gradeRank: 3 }
  if (score >= 60) return { grade: "B", gradeRank: 2 }
  return { grade: "C", gradeRank: 1 }
}

const buildMoonshotMeta = (candidate, featureMap, intradayMap) => {
  const features = featureMap.get(candidate.symbol) ?? null
  const seq = intradayMap.get(candidate.symbol) ?? null
  const scored = scoreMoonshotCandidate({ candidate, features, seq })
  return {
    featuresPresent: Boolean(features),
    intradayPresent: Boolean(seq),
    moonScore: scored.moonScore,
    moonComponents: scored.components,
  }
}

const normalizeTrack = (trackRaw) => {
  if (trackRaw === "SURGE_EOD" || trackRaw === "EOD") {
    return "SURGE_EOD"
  }
  if (trackRaw === "GAP_15_BET" || trackRaw === "GAP") {
    return "GAP_15_BET"
  }
  if (trackRaw === "MOONSHOT" || trackRaw === "MOON") {
    return "MOONSHOT"
  }
  return null
}

const resolveTargetTracksByMode = ({ trackRaw, recommendationMode }) => {
  if (recommendationMode === "INTRADAY_1500") {
    return ["GAP_15_BET"]
  }
  if (recommendationMode === "EOD_CLOSE") {
    return ["SURGE_EOD", "MOONSHOT"]
  }
  const normalized = normalizeTrack(trackRaw)
  if (normalized) {
    if (normalized === "MOONSHOT") {
      return ["SURGE_EOD", "MOONSHOT"]
    }
    return [normalized]
  }
  return ["SURGE_EOD", "MOONSHOT", "GAP_15_BET"]
}

const assertRequiredActiveStrategy = ({
  activeMap,
  tracks,
  enforce,
  context,
}) => {
  if (!enforce) {
    return
  }
  const requiredTracks = Array.isArray(tracks) ? tracks : []
  const effectiveTracks = Array.from(
    new Set(
      requiredTracks.map((track) =>
        String(track ?? "")
          .trim()
          .toUpperCase() === "MOONSHOT"
          ? "SURGE_EOD"
          : track,
      ),
    ),
  )
  const missing = effectiveTracks.filter((track) => {
    const row = activeMap?.get(track) ?? null
    const hasPatternVersion = Number.isFinite(Number(row?.activePatternVersion))
    const hasPatternLabel =
      String(row?.activePatternLabel ?? "").trim().length > 0
    const poolCandidates = extractPoolCandidatesFromActiveConfig(
      row?.activeConfigJson,
      { track },
    )
    const poolSets = extractPoolSetsFromActiveConfig(row?.activeConfigJson, {
      track,
    })
    const hasPoolSetMembers = poolSets.some(
      (set) => Array.isArray(set?.members) && set.members.length > 0,
    )
    const hasPoolCandidate = poolCandidates.length > 0
    return (
      !hasPatternVersion &&
      !hasPatternLabel &&
      !hasPoolCandidate &&
      !hasPoolSetMembers
    )
  })
  if (missing.length) {
    const error = new Error(
      `ACTIVE_STRATEGY_REQUIRED: missing active pattern for ${missing.join(", ")} (${context})`,
    )
    error.code = "ACTIVE_STRATEGY_REQUIRED"
    throw error
  }
}

const loadLevelPolicies = async (prisma, activeMap) => {
  const map = new Map()
  const toFiniteNumber = (value) => {
    if (value === null || value === undefined) {
      return null
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  const toFiniteInt = (value) => {
    const n = toFiniteNumber(value)
    return n === null ? null : Math.floor(n)
  }
  const tracks = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  for (const track of tracks) {
    const activeVersion = activeMap?.get(track)?.activePolicyVersion ?? null
    const activeLabel = activeMap?.get(track)?.activePolicyLabel ?? null
    const fallback = await prisma.levelPolicy.findFirst({
      where: {
        track,
        NOT: { versionLabel: { startsWith: "autosearch:" } },
      },
      orderBy: { version: "desc" },
      select: { version: true, versionLabel: true },
    })
    const versionLabel = activeLabel ?? fallback?.versionLabel ?? null
    const version = activeVersion ?? fallback?.version ?? null
    const useLabel = Boolean(versionLabel)
    if (!version && !versionLabel) {
      continue
    }
    const row = await prisma.levelPolicy.findFirst({
      where: {
        track,
        ...(useLabel ? { versionLabel } : { version }),
      },
      orderBy: { createdAt: "desc" },
    })
    if (!row) {
      continue
    }
    const levels = Array.isArray(row?.payload?.levels) ? row.payload.levels : []
    const levelMap = new Map(
      levels
        .map((entry) => [String(entry?.symbol ?? ""), entry])
        .filter(([symbol]) => symbol),
    )
    map.set(track, {
      version: row.version,
      versionLabel: row.versionLabel ?? null,
      levels: levelMap,
      policyParams: {
        lookbackDays: toFiniteInt(row?.payload?.lookbackDays),
        entryBandPct: toFiniteNumber(row?.payload?.entryBandPct),
        stopBandPct: toFiniteNumber(row?.payload?.stopBandPct),
        targetBandPct: toFiniteNumber(row?.payload?.targetBandPct),
        trailingPct: toFiniteNumber(row?.payload?.trailingPct),
        minRewardPct: toFiniteNumber(row?.payload?.minRewardPct),
      },
    })
  }
  return map
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "ai-recommend" })
  assertNoKisRuntime({ script: "ai-recommend" })
  const baseArgs = parseArgs()
  const dataMode = resolveDataMode()
  const fixture = readFixture(
    baseArgs.fixturePath ?? (dataMode === "contract" ? "default" : null),
  )
  if (dataMode === "contract" && !fixture) {
    throw new Error("contract mode requires fixture data")
  }

  const prisma = fixture ? null : new PrismaClient()

  if (baseArgs.fromDateKey && baseArgs.toDateKey) {
    if (baseArgs.fromDateKey > baseArgs.toDateKey) {
      throw new Error("--from must be <= --to")
    }
  }

  const dateKeys =
    baseArgs.fromDateKey && baseArgs.toDateKey
      ? fixture
        ? buildTradingCalendarRange(baseArgs.fromDateKey, baseArgs.toDateKey)
        : await resolveTradingCalendarRange({
            prisma,
            fromDateKey: baseArgs.fromDateKey,
            toDateKey: baseArgs.toDateKey,
          })
      : [null]

  const isRangeMode = Boolean(baseArgs.fromDateKey && baseArgs.toDateKey)
  const tracks = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  const targetTracks = resolveTargetTracksByMode({
    trackRaw: baseArgs.trackRaw,
    recommendationMode: baseArgs.recommendationMode,
  })
  let rangeShared = null

  if (
    !fixture &&
    prisma &&
    isRangeMode &&
    baseArgs.fromDateKey &&
    baseArgs.toDateKey
  ) {
    const windowCalendarFrom =
      shiftDateKey(baseArgs.fromDateKey, -90) ?? baseArgs.fromDateKey

    const [
      latestUniverse,
      latestCalendar,
      symbolMasterRows,
      activeRows,
      errorRows,
      calendarForWindows,
      surgeCandidates,
      gapCandidates,
      moonshotCandidates,
    ] = await Promise.all([
      prisma.universeKrxDay.findFirst({
        orderBy: { tradingDateKey: "desc" },
        select: { tradingDateKey: true },
      }),
      resolveLastTradingDateKey({
        prisma,
        asOfDateKey: resolveTodayKstDateKey(),
      }),
      prisma.symbolMaster
        .findMany({
          where: { isListed: true },
          select: {
            symbol: true,
            name: true,
            market: true,
            type: true,
            isListed: true,
          },
        })
        .catch(() => []),
      baseArgs.ignoreActiveStrategy
        ? []
        : prisma.activeStrategy
            .findMany({
              select: {
                track: true,
                activePatternVersion: true,
                activePolicyVersion: true,
                activePatternLabel: true,
                activePolicyLabel: true,
                activeConfigJson: true,
              },
            })
            .catch(() => []),
      prisma.dataQualityFlagDay
        .findMany({
          where: {
            tradingDateKey: {
              gte: windowCalendarFrom,
              lte: baseArgs.toDateKey,
            },
            severity: "ERROR",
          },
          select: { symbol: true, tradingDateKey: true },
        })
        .catch(() => []),
      resolveTradingCalendarRange({
        prisma,
        fromDateKey: windowCalendarFrom,
        toDateKey: baseArgs.toDateKey,
      }),
      prisma.patternRule
        .findMany({
          where: {
            track: "SURGE_EOD",
            NOT: { versionLabel: { startsWith: "autosearch:" } },
          },
          select: { version: true, versionLabel: true },
          orderBy: { version: "desc" },
        })
        .catch(() => []),
      prisma.patternRule
        .findMany({
          where: {
            track: "GAP_15_BET",
            NOT: { versionLabel: { startsWith: "autosearch:" } },
          },
          select: { version: true, versionLabel: true },
          orderBy: { version: "desc" },
        })
        .catch(() => []),
      prisma.patternRule
        .findMany({
          where: {
            track: "MOONSHOT",
            NOT: { versionLabel: { startsWith: "autosearch:" } },
          },
          select: { version: true, versionLabel: true },
          orderBy: { version: "desc" },
        })
        .catch(() => []),
    ])

    const latestDateKey =
      latestUniverse?.tradingDateKey ?? latestCalendar ?? null
    if (!latestDateKey) {
      throw new Error("No UniverseKrxDay data available")
    }
    const indexByDateKey = new Map(
      (calendarForWindows ?? []).map((key, idx) => [key, idx]),
    )
    const activeMap = new Map(activeRows.map((row) => [row.track, row]))
    assertRequiredActiveStrategy({
      activeMap,
      tracks: targetTracks,
      enforce: baseArgs.requireActiveStrategy,
      context: "range-shared",
    })
    const levelPolicyByTrack = await loadLevelPolicies(prisma, activeMap)
    const errorSet = new Set(
      errorRows.map((row) => `${row.symbol}:${row.tradingDateKey}`),
    )
    const mergePatternCandidates = ({ track, dbCandidates, activeRow }) => {
      const seen = new Set()
      const merged = []
      const pushUnique = (row, source) => {
        const version = Number(row?.version ?? 0) || 0
        const versionLabel = String(row?.versionLabel ?? "").trim() || null
        if (version <= 0 && !versionLabel) return
        const key = `${versionLabel ?? ""}|${version}`
        if (seen.has(key)) return
        seen.add(key)
        merged.push({
          version: version > 0 ? version : null,
          versionLabel,
          deployScore: Number(row?.deployScore ?? 0) || 0,
          regimeTag: row?.regimeTag ?? null,
          trainFromDateKey: row?.trainFromDateKey ?? null,
          trainToDateKey: row?.trainToDateKey ?? null,
          passedStage2At: row?.passedStage2At ?? null,
          state: row?.state ?? (source === "pool" ? "BENCH" : null),
          source,
          track,
        })
      }
      const poolCandidates = extractPoolCandidatesFromActiveConfig(
        activeRow?.activeConfigJson,
        { track },
      )
      for (const row of poolCandidates) {
        pushUnique(row, "pool")
      }
      const prepended = prependActivePatternCandidate({
        candidates: dbCandidates ?? [],
        activeVersion: activeRow?.activePatternVersion ?? null,
        activeLabel: activeRow?.activePatternLabel ?? null,
      })
      for (const row of prepended) {
        pushUnique(row, "db")
      }
      return merged
    }
    const patternCandidatesByTrack = new Map([
      [
        "SURGE_EOD",
        mergePatternCandidates({
          track: "SURGE_EOD",
          dbCandidates: surgeCandidates ?? [],
          activeRow: activeMap.get("SURGE_EOD") ?? null,
        }),
      ],
      [
        "GAP_15_BET",
        mergePatternCandidates({
          track: "GAP_15_BET",
          dbCandidates: gapCandidates ?? [],
          activeRow: activeMap.get("GAP_15_BET") ?? null,
        }),
      ],
      [
        "MOONSHOT",
        mergePatternCandidates({
          track: "MOONSHOT",
          dbCandidates: moonshotCandidates ?? [],
          activeRow: activeMap.get("MOONSHOT") ?? null,
        }),
      ],
    ])

    rangeShared = {
      latestDateKey,
      windowCalendarFrom,
      calendarForWindows: calendarForWindows ?? [],
      indexByDateKey,
      errorSet,
      symbolMasterRows,
      activeMap,
      levelPolicyByTrack,
      patternCandidatesByTrack,
      patternPayloadCache: new Map(),
    }
  }

  const results = []

  for (let idx = 0; idx < dateKeys.length; idx += 1) {
    const overrideDateKey = dateKeys[idx]
    if (overrideDateKey && dateKeys.length > 1) {
      console.log(
        `[ai-recommend] range ${idx + 1}/${dateKeys.length}: ${overrideDateKey}`,
      )
    }
    const args = overrideDateKey
      ? {
          ...baseArgs,
          asOfInput: overrideDateKey,
          asOfDateKey: normalizeDateKey(overrideDateKey),
        }
      : baseArgs
    const poolCascadeDepth = Math.max(
      1,
      Math.min(12, Number(process.env.RECOMMEND_POOL_CASCADE_DEPTH ?? 5) || 5),
    )

    let symbols = fixture?.symbols ?? []
    let candles = fixture?.candles ?? []
    let universe = fixture?.universe ?? []
    let featureDays = fixture?.featureDays ?? []
    let intradayProfiles = fixture?.intradayProfiles ?? []
    let price15 = fixture?.price15 ?? []
    let hourly60m = fixture?.hourly60m ?? []
    let latestDateKey = fixture?.toDateKey ?? null
    let asOfDateKey = fixture?.toDateKey ?? null
    let tradingWindow = []
    let prevTradingDay = null
    let prevCloseRows = []
    let patternsByTrack = null
    let levelPolicyByTrack = null
    let loadPatterns = null
    let activeMap = null
    let regimeContext = {
      regime: args.regimeOverride ?? null,
      sourceDateKey: null,
      source: args.regimeOverride ? "cli" : "none",
    }
    const patternSelectionIssuesByTrack = new Map()
    const addPatternSelectionIssue = (track, code) => {
      const trackKey = normalizeTrack(track) ?? String(track ?? "").trim()
      const normalizedCode = String(code ?? "")
        .trim()
        .toUpperCase()
      if (!trackKey || !normalizedCode) {
        return
      }
      const set = patternSelectionIssuesByTrack.get(trackKey) ?? new Set()
      set.add(normalizedCode)
      patternSelectionIssuesByTrack.set(trackKey, set)
    }

    if (!fixture) {
      if (rangeShared) {
        latestDateKey = rangeShared.latestDateKey
      } else {
        const latestUniverse = await prisma.universeKrxDay.findFirst({
          orderBy: { tradingDateKey: "desc" },
          select: { tradingDateKey: true },
        })
        const latestCalendar = await resolveLastTradingDateKey({
          prisma,
          asOfDateKey: resolveTodayKstDateKey(),
        })
        latestDateKey = latestUniverse?.tradingDateKey ?? latestCalendar ?? null
      }
      if (!latestDateKey) {
        throw new Error("No UniverseKrxDay data available")
      }

      const desiredAsOf = normalizeDateKey(args.asOfInput ?? args.asOfDateKey)
      asOfDateKey =
        rangeShared && desiredAsOf
          ? desiredAsOf
          : await resolveAsOfDateKey({
              prisma,
              asOfInput: args.asOfInput ?? args.asOfDateKey,
              fallbackDateKey: latestDateKey,
            })

      if (!asOfDateKey) {
        throw new Error("Unable to resolve asOfDateKey")
      }

      if (args.regimeOverride) {
        regimeContext = {
          regime: args.regimeOverride,
          sourceDateKey: asOfDateKey,
          source: "cli",
        }
      } else {
        const resolvedRegime = await resolveMarketRegimeForDate({
          prisma,
          dateKey: asOfDateKey,
        })
        regimeContext = {
          regime: resolvedRegime.regime,
          sourceDateKey: resolvedRegime.dateKey,
          source: resolvedRegime.regime ? "marketRegimeDay" : "none",
        }
      }

      activeMap = rangeShared
        ? rangeShared.activeMap
        : args.ignoreActiveStrategy
          ? new Map()
          : new Map(
              (
                await prisma.activeStrategy
                  .findMany({
                    select: {
                      track: true,
                      activePatternVersion: true,
                      activePolicyVersion: true,
                      activePatternLabel: true,
                      activePolicyLabel: true,
                      activeConfigJson: true,
                    },
                  })
                  .catch(() => [])
              ).map((row) => [row.track, row]),
            )
      assertRequiredActiveStrategy({
        activeMap,
        tracks: targetTracks,
        enforce: args.requireActiveStrategy,
        context: `daily:${asOfDateKey ?? "unknown"}`,
      })

      const requiredTradingDays = resolveRequiredTradingDays(activeMap)

      tradingWindow = rangeShared
        ? sliceTradingWindow({
            calendar: rangeShared.calendarForWindows,
            indexByDateKey: rangeShared.indexByDateKey,
            asOfDateKey,
            tradingDays: requiredTradingDays,
          })
        : []

      if (!tradingWindow.length) {
        tradingWindow = await resolveTradingWindow({
          prisma,
          asOfDateKey,
          tradingDays: requiredTradingDays,
        })
      }
      const windowStart =
        tradingWindow[0] ??
        shiftDateKey(asOfDateKey, -requiredTradingDays) ??
        asOfDateKey
      prevTradingDay =
        tradingWindow.length >= 2
          ? tradingWindow[tradingWindow.length - 2]
          : null

      const errorSet = rangeShared
        ? rangeShared.errorSet
        : new Set(
            (
              await prisma.dataQualityFlagDay
                .findMany({
                  where: {
                    tradingDateKey: { gte: windowStart, lte: asOfDateKey },
                    severity: "ERROR",
                  },
                  select: { symbol: true, tradingDateKey: true },
                })
                .catch(() => [])
            ).map((row) => `${row.symbol}:${row.tradingDateKey}`),
          )
      const filterErrors = (rows, keyField) =>
        rows.filter((row) => {
          const symbol = String(row?.symbol ?? "").trim()
          const dateKey = String(row?.[keyField] ?? "").trim()
          if (!symbol || !dateKey) {
            return false
          }
          return !errorSet.has(`${symbol}:${dateKey}`)
        })

      const adjustedRows = await prisma.candleDailyAdjusted
        .findMany({
          where: { tradingDateKey: { gte: windowStart, lte: asOfDateKey } },
          select: { symbol: true, tradingDateKey: true, ohlcv: true },
        })
        .catch(() => [])

      const candleRows = adjustedRows.length
        ? adjustedRows.map((row) => ({
            symbol: row.symbol,
            dateKey: row.tradingDateKey,
            ...(row.ohlcv ?? {}),
          }))
        : await prisma.candleDaily.findMany({
            where: { dateKey: { gte: windowStart, lte: asOfDateKey } },
            select: {
              symbol: true,
              dateKey: true,
              open: true,
              high: true,
              low: true,
              close: true,
            },
          })

      const [universeRows, featureRows, intradayRows, price15Rows, hourlyRows] =
        await Promise.all([
          prisma.universeKrxDay.findMany({
            where: { tradingDateKey: asOfDateKey },
            select: {
              symbol: true,
              tradingDateKey: true,
              avgTradingValue20d: true,
              marketCapKrw: true,
            },
          }),
          prisma.featureDay.findMany({
            where: { tradingDateKey: asOfDateKey },
            select: { symbol: true, tradingDateKey: true, features: true },
          }),
          prisma.intradayProfileDay.findMany({
            where: { tradingDateKey: asOfDateKey },
            select: { symbol: true, tradingDateKey: true, seq: true },
          }),
          prisma.price15.findMany({
            where: { tradingDateKey: asOfDateKey },
            select: { symbol: true, tradingDateKey: true, price: true },
          }),
          prisma.candleHourly60m
            .findMany({
              where: { tradingDateKey: asOfDateKey },
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
            .catch(() => []),
        ])

      candles = filterErrors(candleRows, "dateKey")
      universe = filterErrors(universeRows, "tradingDateKey")
      featureDays = filterErrors(featureRows, "tradingDateKey")
      intradayProfiles = filterErrors(intradayRows, "tradingDateKey")
      price15 = filterErrors(price15Rows, "tradingDateKey")
      hourly60m = filterErrors(hourlyRows ?? [], "tradingDateKey")

      if (!activeMap) {
        activeMap = rangeShared ? rangeShared.activeMap : new Map()
      }
      levelPolicyByTrack = rangeShared
        ? rangeShared.levelPolicyByTrack
        : await loadLevelPolicies(prisma, activeMap)

      if (rangeShared) {
        const eligible = await eligibleSymbolsForDate({
          dateKey: asOfDateKey,
          prisma: null,
          symbolMasterRows: rangeShared.symbolMasterRows,
          universeRows: universe,
        })
        if (!eligible.symbols.length) {
          if (!args.allowEmptyEligible) {
            throw new Error("ELIGIBLE_SYMBOLS_EMPTY")
          }
          console.warn(
            `[ai-recommend] allow-empty-eligible asOf=${asOfDateKey} (rangeShared path)`,
          )
        }
        symbols = eligible.symbols
      } else {
        symbols = await loadSymbolUniverse(prisma, asOfDateKey, {
          allowEmptyEligible: args.allowEmptyEligible,
        })
        if (!symbols.length && args.allowEmptyEligible) {
          console.warn(
            `[ai-recommend] allow-empty-eligible asOf=${asOfDateKey}`,
          )
        }
      }

      if (prevTradingDay) {
        const symbolList = (symbols ?? [])
          .map((row) => String(row?.symbol ?? "").trim())
          .filter(Boolean)
        const whereSymbol =
          symbolList.length && symbolList.length <= 1200
            ? { symbol: { in: symbolList } }
            : {}
        prevCloseRows = await prisma.candleDaily.findMany({
          where: { dateKey: prevTradingDay, ...whereSymbol },
          select: { symbol: true, dateKey: true, close: true },
        })
      }

      loadPatterns = async (track) => {
        patternSelectionIssuesByTrack.delete(track)
        const activeRow = activeMap.get(track) ?? null
        const activeVersion = activeRow?.activePatternVersion ?? null
        const activeLabel = activeRow?.activePatternLabel ?? null
        const baseCandidates = rangeShared
          ? (rangeShared.patternCandidatesByTrack.get(track) ?? [])
          : await prisma.patternRule.findMany({
              where: {
                track,
                NOT: { versionLabel: { startsWith: "autosearch:" } },
              },
              select: { version: true, versionLabel: true },
              orderBy: { version: "desc" },
            })
        const candidates = rangeShared
          ? baseCandidates
          : (() => {
              const seen = new Set()
              const merged = []
              const pushUnique = (row) => {
                const version = Number(row?.version ?? 0) || 0
                const versionLabel =
                  String(row?.versionLabel ?? "").trim() || null
                if (version <= 0 && !versionLabel) return
                const key = `${versionLabel ?? ""}|${version}`
                if (seen.has(key)) return
                seen.add(key)
                merged.push({
                  ...row,
                  version: version > 0 ? version : null,
                  versionLabel,
                })
              }
              const poolCandidates = extractPoolCandidatesFromActiveConfig(
                activeRow?.activeConfigJson,
                { track },
              )
              const poolSets = extractPoolSetsFromActiveConfig(
                activeRow?.activeConfigJson,
                { track },
              )
              const primaryPoolSet = selectPrimaryPoolSetFromTrack({
                poolSets,
                track,
              })
              const orderedPoolSets = [
                ...(primaryPoolSet ? [primaryPoolSet] : []),
                ...poolSets.filter(
                  (set) =>
                    String(set?.poolSetId ?? "") !==
                    String(primaryPoolSet?.poolSetId ?? ""),
                ),
              ]
              for (const set of orderedPoolSets) {
                const members = Array.isArray(set?.members) ? set.members : []
                for (const member of members) {
                  pushUnique({
                    ...member,
                    selectedFromPool: true,
                    selectedPoolSetId:
                      String(set?.poolSetId ?? "").trim() || null,
                  })
                }
              }
              for (const row of poolCandidates) {
                pushUnique(row)
              }
              const prepended = prependActivePatternCandidate({
                candidates: baseCandidates,
                activeVersion,
                activeLabel,
              })
              for (const row of prepended) {
                pushUnique(row)
              }
              return merged
            })()
        const poolRanked = rankPatternPoolCandidates({
          poolCandidates: candidates,
          track,
          asOfDateKey,
          latestDateKey,
          preferredRegime: regimeContext.regime,
          requireTrainRangeValid: args.routerRequireTrainRangeValid,
        })
        const poolSelection =
          poolRanked[0] ??
          selectPatternFromPoolCandidates({
            poolCandidates: candidates,
            track,
            asOfDateKey,
            latestDateKey,
            preferredRegime: regimeContext.regime,
            requireTrainRangeValid: args.routerRequireTrainRangeValid,
          })
        const fallbackSelection = args.allowLegacyPatternFallback
          ? selectPatternVersionLabel({
              candidates,
              asOfDateKey,
              latestDateKey,
              preferredLabel: activeLabel,
              preferredVersion: activeVersion,
              preferredRegime: regimeContext.regime,
            })
          : null
        if (!poolRanked.length) {
          addPatternSelectionIssue(track, "POOL_EMPTY_AT_RECOMMEND")
          addPatternSelectionIssue(track, "POOLSET_NO_MATCH")
        }
        const selectionQueue = []
        const selectionSeen = new Set()
        const pushSelection = (selection, reason) => {
          const version = Number(selection?.version ?? 0) || 0
          const versionLabel =
            String(selection?.versionLabel ?? "").trim() || null
          const engineType =
            String(selection?.engineType ?? "")
              .trim()
              .toLowerCase() === "chart"
              ? "chart"
              : "rule"
          if (version <= 0 && !versionLabel) return
          const key = `${engineType}|${versionLabel ?? ""}|${version}`
          if (selectionSeen.has(key)) return
          selectionSeen.add(key)
          selectionQueue.push({
            version: version > 0 ? version : null,
            versionLabel,
            engineType,
            selectedRegimeTag:
              String(selection?.selectedRegimeTag ?? "")
                .trim()
                .toUpperCase() || extractRegimeTag(versionLabel),
            selectedFromPool: Boolean(selection?.selectedFromPool),
            selectedMemberCandidateId:
              String(selection?.candidateId ?? "").trim() || null,
            selectedPoolSetId:
              String(selection?.selectedPoolSetId ?? "").trim() || null,
            poolRank: Number(selection?.poolRank ?? 0) || null,
            selectionReason: reason,
          })
        }
        for (const row of poolRanked.slice(0, poolCascadeDepth)) {
          const suffix =
            Number(row?.poolRank ?? 0) > 0 ? `#${Number(row.poolRank)}` : ""
          pushSelection(row, `POOL_SCORING${suffix}`)
        }
        if (args.allowLegacyPatternFallback) {
          pushSelection(fallbackSelection, "FALLBACK_VERSION_SELECTION")
        }
        if (!selectionQueue.length) {
          addPatternSelectionIssue(track, "POOL_EMPTY_AT_RECOMMEND")
          addPatternSelectionIssue(track, "POOLSET_NO_MATCH")
          return {
            rules: [],
            shapes: [],
            version: null,
            versionLabel: null,
            selectedRegimeTag: null,
            selectedFromPool: false,
            poolRank: null,
            selectionReason: "POOL_EMPTY_AT_RECOMMEND",
          }
        }
        const payloadCandidates = []
        for (let i = 0; i < selectionQueue.length; i += 1) {
          const pickedSelection = selectionQueue[i]
          const versionLabel = pickedSelection.versionLabel
          const version = pickedSelection.version
          const useLabel = Boolean(versionLabel)
          const cacheKey = rangeShared
            ? `${track}:${useLabel ? `label:${versionLabel}` : `ver:${version}`}`
            : null
          let payload = null
          if (
            rangeShared &&
            cacheKey &&
            rangeShared.patternPayloadCache.has(cacheKey)
          ) {
            payload = rangeShared.patternPayloadCache.get(cacheKey)
          } else {
            const [rules, shapes] = await Promise.all([
              prisma.patternRule.findMany({
                where: {
                  track,
                  ...(useLabel ? { versionLabel } : { version }),
                },
                select: {
                  payload: true,
                  summary: true,
                  precisionTest: true,
                },
              }),
              prisma.patternShape.findMany({
                where: {
                  track,
                  ...(useLabel ? { versionLabel } : { version }),
                },
                select: {
                  centroid: true,
                  summary: true,
                  precisionTest: true,
                },
              }),
            ])
            payload = {
              version,
              versionLabel: versionLabel ?? null,
              selectedRegimeTag:
                pickedSelection.selectedRegimeTag ??
                extractRegimeTag(versionLabel),
              rules: rules.map((row) => ({
                ...row.payload,
                summary: row.summary,
                precisionTest: row.precisionTest,
              })),
              shapes: shapes.map((row) => ({
                centroid: row.centroid,
                summary: row.summary,
                precisionTest: row.precisionTest,
              })),
            }
            if (rangeShared && cacheKey) {
              rangeShared.patternPayloadCache.set(cacheKey, payload)
            }
          }
          const hasPatternPayload =
            (Array.isArray(payload?.rules) && payload.rules.length > 0) ||
            (Array.isArray(payload?.shapes) && payload.shapes.length > 0)
          const isLastCandidate = i === selectionQueue.length - 1
          if (!hasPatternPayload && !isLastCandidate) {
            continue
          }
          if (!hasPatternPayload && isLastCandidate) {
            addPatternSelectionIssue(track, "ROUTER_NO_MATCH")
            continue
          }
          payloadCandidates.push({
            ...payload,
            engineType: pickedSelection.engineType ?? "rule",
            selectedFromPool: Boolean(pickedSelection.selectedFromPool),
            selectedMemberCandidateId:
              pickedSelection.selectedMemberCandidateId ?? null,
            selectedPoolSetId: pickedSelection.selectedPoolSetId ?? null,
            poolRank: pickedSelection.poolRank ?? null,
            selectionReason: pickedSelection.selectionReason,
          })
        }
        if (!payloadCandidates.length) {
          return {
            rules: [],
            shapes: [],
            version: null,
            versionLabel: null,
            engineType: "rule",
            selectedRegimeTag: null,
            selectedFromPool: false,
            poolRank: null,
            selectionReason: "ROUTER_NO_MATCH",
          }
        }
        const [selectedPayload, ...alternatePayloads] = payloadCandidates
        return {
          ...selectedPayload,
          alternates: alternatePayloads,
        }
      }

      patternsByTrack = new Map(
        await Promise.all(
          tracks.map(async (track) => [track, await loadPatterns(track)]),
        ),
      )
    } else if (args.asOfInput || args.asOfDateKey || !asOfDateKey) {
      asOfDateKey = await resolveAsOfDateKey({
        prisma: null,
        asOfInput: args.asOfInput ?? args.asOfDateKey,
        fallbackDateKey: asOfDateKey ?? fixture?.fromDateKey ?? latestDateKey,
      })
    }

    if (!asOfDateKey) {
      asOfDateKey = await resolveAsOfDateKey({
        prisma: null,
        asOfInput: args.asOfInput ?? args.asOfDateKey,
        fallbackDateKey: fixture?.toDateKey ?? latestDateKey,
      })
    }

    if (args.regimeOverride) {
      regimeContext = {
        regime: args.regimeOverride,
        sourceDateKey: asOfDateKey,
        source: "cli",
      }
    } else if (regimeContext.regime && !regimeContext.sourceDateKey) {
      regimeContext.sourceDateKey = asOfDateKey
    }

    if (!asOfDateKey) {
      throw new Error("Unable to resolve asOfDateKey")
    }

    const patternMetaByTrack = new Map()
    if (patternsByTrack) {
      for (const [track, entry] of patternsByTrack.entries()) {
        const selectedRegimeTag =
          entry?.selectedRegimeTag ?? extractRegimeTag(entry?.versionLabel)
        patternMetaByTrack.set(track, {
          version: entry?.version ?? null,
          versionLabel: entry?.versionLabel ?? null,
          engineType:
            String(entry?.engineType ?? "")
              .trim()
              .toLowerCase() === "chart"
              ? "chart"
              : "rule",
          selectedRegimeTag: selectedRegimeTag ?? null,
          regimeMatch: Boolean(
            regimeContext.regime && selectedRegimeTag === regimeContext.regime,
          ),
          selectedFromPool: Boolean(entry?.selectedFromPool),
          selectedMemberCandidateId:
            String(entry?.selectedMemberCandidateId ?? "").trim() || null,
          selectedPoolSetId:
            String(entry?.selectedPoolSetId ?? "").trim() || null,
          poolRank: Number(entry?.poolRank ?? 0) || null,
          selectionReason: String(entry?.selectionReason ?? "").trim() || null,
        })
      }
    }

    // Spec v6: enforce as-of cutoff to prevent future-data leakage.
    const asOfGuard = applyAsOfGuard({
      asOfDateKey,
      sets: {
        candles: { rows: candles, dateField: "dateKey" },
        universe: { rows: universe, dateField: "tradingDateKey" },
        featureDays: { rows: featureDays, dateField: "tradingDateKey" },
        intradayProfiles: {
          rows: intradayProfiles,
          dateField: "tradingDateKey",
        },
        price15: { rows: price15, dateField: "tradingDateKey" },
      },
    })

    candles = asOfGuard.filtered.candles
    universe = asOfGuard.filtered.universe
    featureDays = asOfGuard.filtered.featureDays
    intradayProfiles = asOfGuard.filtered.intradayProfiles
    price15 = asOfGuard.filtered.price15

    if (!tradingWindow.length) {
      const fromDateKey =
        fixture?.fromDateKey ?? shiftDateKey(asOfDateKey, -30) ?? asOfDateKey
      tradingWindow = buildTradingCalendarRange(fromDateKey, asOfDateKey)
      prevTradingDay =
        tradingWindow.length >= 2
          ? tradingWindow[tradingWindow.length - 2]
          : null
    }

    if (!prevCloseRows.length && prevTradingDay) {
      prevCloseRows = (candles ?? [])
        .filter((row) => row?.dateKey === prevTradingDay)
        .map((row) => ({
          symbol: row.symbol,
          dateKey: row.dateKey,
          close: row.close,
        }))
    }

    if (!patternsByTrack) {
      const ranges = resolveTrainTestRanges({
        asOfDateKey: asOfDateKey ?? fixture?.toDateKey ?? fixture?.fromDateKey,
        trainDays: 3,
        testDays: 2,
      })
      patternsByTrack = new Map([
        [
          "SURGE_EOD",
          trainPatternsFromData({
            data: {
              candles,
              price15,
              universe,
              featureDays,
              intradayProfiles,
            },
            track: "SURGE_EOD",
            ranges,
            seed: "contract",
            supportMin: 1,
            precisionMin: 0.1,
            maxRules: 5,
            maxK: 4,
            candidateKs: [2],
            vectorBins: 6,
          }),
        ],
        [
          "GAP_15_BET",
          trainPatternsFromData({
            data: {
              candles,
              price15,
              universe,
              featureDays,
              intradayProfiles,
            },
            track: "GAP_15_BET",
            ranges,
            seed: "contract",
            supportMin: 1,
            precisionMin: 0.1,
            maxRules: 5,
            maxK: 4,
            candidateKs: [2],
            vectorBins: 6,
          }),
        ],
      ])
    }

    const data = {
      symbols,
      candles,
      universe,
      featureDays,
      intradayProfiles,
    }

    const candleMap = buildCandleMap(candles)
    const levelMaps = new Map()
    const levelPolicyParamsByTrack = new Map()
    if (levelPolicyByTrack) {
      for (const [track, policy] of levelPolicyByTrack.entries()) {
        levelMaps.set(track, policy.levels)
        levelPolicyParamsByTrack.set(track, policy.policyParams ?? null)
      }
    }
    const activePolicyParamsByTrack = new Map()
    if (activeMap) {
      for (const track of tracks) {
        const entry = activeMap.get(track) ?? null
        activePolicyParamsByTrack.set(
          track,
          extractPolicyParamsFromActiveConfig(entry?.activeConfigJson),
        )
      }
    }
    const resolvePlanPolicyParams = (track) => {
      const level = levelPolicyParamsByTrack.get(track) ?? null
      const active = activePolicyParamsByTrack.get(track) ?? null
      if (!level && !active) {
        return null
      }
      const pick = (key) => {
        const levelValue = level?.[key]
        if (Number.isFinite(levelValue)) {
          return levelValue
        }
        const activeValue = active?.[key]
        return Number.isFinite(activeValue) ? activeValue : null
      }
      return {
        lookbackDays: pick("lookbackDays"),
        entryBandPct: pick("entryBandPct"),
        stopBandPct: pick("stopBandPct"),
        targetBandPct: pick("targetBandPct"),
        trailingPct: pick("trailingPct"),
        minRewardPct: pick("minRewardPct"),
      }
    }

    const candidatePolicyByTrack = new Map()
    const candidatePolicySourcesByTrack = new Map()
    for (const track of tracks) {
      const resolved = resolveCandidatePolicy({
        cli: {
          minLiquidity: args.minLiquidity,
          scoreEps: args.scoreEps,
          vectorBins: args.vectorBins,
        },
        cliProvided: args.cliProvided,
        activePolicyParams: activePolicyParamsByTrack.get(track),
      })
      candidatePolicyByTrack.set(track, resolved.values)
      candidatePolicySourcesByTrack.set(track, resolved.sources)
    }

    const featureMap = buildFeatureMap(featureDays, asOfDateKey)
    const intradayMap = buildIntradayMap(intradayProfiles, asOfDateKey)
    const symbolMetaMap = new Map(
      (symbols ?? []).map((row) => [String(row.symbol), row]),
    )
    const price15Map = new Map(
      (price15 ?? []).map((row) => [
        String(row.symbol ?? "").trim(),
        Number(row.price ?? 0),
      ]),
    )
    const planCache = new Map()
    const resolvePlan = (track, symbol) => {
      const key = `${track}:${symbol}`
      if (planCache.has(key)) {
        return planCache.get(key)
      }
      const candleSeries = candleMap.get(symbol) ?? []
      const planAsOf =
        track === "GAP_15_BET" && prevTradingDay ? prevTradingDay : asOfDateKey
      const planCandles =
        track === "GAP_15_BET"
          ? filterCandlesToPrevTradingDay({
              candles: candleSeries,
              prevTradingDay: planAsOf,
            })
          : candleSeries
      const levelMap = levelMaps.get(track) ?? null
      const planPolicyParams = resolvePlanPolicyParams(track)
      const plan = buildLevelPlanForSymbol({
        levelMap,
        policyParams: planPolicyParams,
        symbol,
        candles: planCandles,
        asOfDateKey: planAsOf,
      })
      if (plan && track === "GAP_15_BET") {
        const price15Value = price15Map.get(symbol)
        if (Number.isFinite(price15Value)) {
          plan.latestClose = price15Value
        }
      }
      planCache.set(key, plan ?? null)
      return plan
    }
    const pickWithPlan = ({ candidates, track, excludeSymbol }) => {
      for (const candidate of candidates ?? []) {
        if (excludeSymbol && candidate.symbol === excludeSymbol) {
          continue
        }
        if (resolvePlan(track, candidate.symbol)) {
          return candidate
        }
      }
      return null
    }
    const buildFallbackCandidate = ({ track, excludeSymbol }) => {
      const universeRows = (universe ?? [])
        .filter((row) => row?.tradingDateKey === asOfDateKey)
        .map((row) => ({
          symbol: String(row.symbol ?? "").trim(),
          liquidity: Number(row.avgTradingValue20d ?? 0),
          marketCapKrw: resolveMarketCapKrw(row),
        }))
        .filter((row) => row.symbol)
      universeRows.sort((a, b) => b.liquidity - a.liquidity)
      for (const row of universeRows) {
        if (excludeSymbol && row.symbol === excludeSymbol) {
          continue
        }
        const capVerdict = evaluateMarketCap({ marketCapKrw: row.marketCapKrw })
        if (!capVerdict.pass) {
          continue
        }
        if (!resolvePlan(track, row.symbol)) {
          continue
        }
        const meta = symbolMetaMap.get(row.symbol)
        return {
          symbol: row.symbol,
          name: String(meta?.name ?? row.symbol),
          market: String(meta?.market ?? "").trim() || null,
          track,
          score: 0,
          liquidity: row.liquidity,
          reasons: [],
          warnings: ["CORE_FALLBACK_USED"],
        }
      }
      return null
    }
    const buildMoonshotCandidates = ({
      candidates,
      requireFeatures,
      excludeSymbol,
    }) =>
      (candidates ?? [])
        .filter((candidate) =>
          excludeSymbol ? candidate.symbol !== excludeSymbol : true,
        )
        .map((candidate) => {
          const meta = buildMoonshotMeta(candidate, featureMap, intradayMap)
          return {
            ...candidate,
            moonScore: meta.moonScore,
            moonComponents: meta.moonComponents,
            featuresPresent: meta.featuresPresent,
            intradayPresent: meta.intradayPresent,
          }
        })
        .filter((candidate) =>
          requireFeatures
            ? candidate.featuresPresent || candidate.intradayPresent
            : true,
        )
    const sortMoonshotCandidates = (list) => {
      return [...list].sort((a, b) => {
        if (b.moonScore !== a.moonScore) {
          return b.moonScore - a.moonScore
        }
        if (b.score !== a.score) {
          return b.score - a.score
        }
        return (b.liquidity ?? 0) - (a.liquidity ?? 0)
      })
    }
    const pickMoonshot = ({ candidates, excludeSymbol }) => {
      const sorted = sortMoonshotCandidates(candidates ?? [])
      return pickWithPlan({
        candidates: sorted,
        track: "SURGE_EOD",
        excludeSymbol,
      })
    }

    const notes = []
    const emptyRecommendationReasonCodes = new Set()
    for (const issues of patternSelectionIssuesByTrack.values()) {
      for (const code of issues ?? []) {
        const normalizedCode = String(code ?? "")
          .trim()
          .toUpperCase()
        if (normalizedCode) {
          emptyRecommendationReasonCodes.add(normalizedCode)
        }
      }
    }
    if (!Array.isArray(symbols) || symbols.length === 0) {
      notes.push("ELIGIBLE_SYMBOLS_EMPTY_ALLOWED")
      emptyRecommendationReasonCodes.add("ELIGIBLE_SYMBOLS_EMPTY_ALLOWED")
    }
    const leakMeta = {
      asOfDateKey,
      maxUsedDateKey: asOfGuard.maxUsedDateKey ?? null,
      leakDetected: asOfGuard.leakDetected,
      removedBySet: asOfGuard.removedBySet,
    }
    if (leakMeta.leakDetected) {
      notes.push("LEAK_DETECTED")
      emptyRecommendationReasonCodes.add("LEAK_DETECTED")
    }
    const picksByTrack = new Map()
    const trackFilter = normalizeTrack(args.trackRaw)
    const prevCloseBySymbol = new Map(
      (prevCloseRows ?? []).map((row) => [
        String(row.symbol ?? "").trim(),
        Number(row.close ?? 0),
      ]),
    )
    const lastHourBySymbol = new Map()
    const hourlyBySymbol = new Map()
    for (const row of hourly60m ?? []) {
      const symbol = String(row?.symbol ?? "").trim()
      if (!symbol) {
        continue
      }
      const ts = row?.tsKst ? new Date(row.tsKst) : null
      if (!ts || Number.isNaN(ts.getTime())) {
        continue
      }
      const list = hourlyBySymbol.get(symbol) ?? []
      list.push(row)
      hourlyBySymbol.set(symbol, list)
      if (ts.getUTCHours() !== 14) {
        continue
      }
      lastHourBySymbol.set(symbol, row)
    }
    let gapTradabilityMeta = null
    let gapFeatureDays = featureDays
    let gapIntradayProfiles = intradayProfiles
    let surgeMarketCapStats = null
    let gapMarketCapStats = null
    const mode = String(args.recommendationMode ?? "ALL")
      .trim()
      .toUpperCase()
    const includeSurge =
      mode === "INTRADAY_1500"
        ? false
        : !trackFilter ||
          trackFilter === "SURGE_EOD" ||
          trackFilter === "MOONSHOT"
    const includeGap =
      mode === "EOD_CLOSE"
        ? false
        : !trackFilter || trackFilter === "GAP_15_BET"
    const resolvePatternVariants = (track) => {
      const primary = patternsByTrack?.get(track)
      if (!primary || typeof primary !== "object") {
        return []
      }
      const variants = [primary]
      if (Array.isArray(primary.alternates)) {
        variants.push(...primary.alternates.filter(Boolean))
      }
      return variants
    }
    const applyPatternMetaVariant = ({ track, pattern, variantIndex }) => {
      if (!patternMetaByTrack?.has(track) || !pattern) return
      const prev = patternMetaByTrack.get(track) ?? {}
      const selectionReasonBase =
        String(pattern.selectionReason ?? prev.selectionReason ?? "").trim() ||
        null
      const selectionReason =
        variantIndex > 0
          ? `${selectionReasonBase ?? "POOL_SCORING"}|CASCADE#${variantIndex + 1}`
          : selectionReasonBase
      patternMetaByTrack.set(track, {
        ...prev,
        version: pattern.version ?? prev.version ?? null,
        versionLabel: pattern.versionLabel ?? prev.versionLabel ?? null,
        engineType:
          String(pattern.engineType ?? "")
            .trim()
            .toLowerCase() === "chart"
            ? "chart"
            : (prev.engineType ?? "rule"),
        selectedRegimeTag:
          pattern.selectedRegimeTag ?? prev.selectedRegimeTag ?? null,
        selectedFromPool:
          pattern.selectedFromPool ?? prev.selectedFromPool ?? false,
        selectedMemberCandidateId:
          pattern.selectedMemberCandidateId ??
          prev.selectedMemberCandidateId ??
          null,
        selectedPoolSetId:
          pattern.selectedPoolSetId ?? prev.selectedPoolSetId ?? null,
        poolRank: pattern.poolRank ?? prev.poolRank ?? null,
        selectionReason,
      })
    }

    if (includeGap) {
      const prevFeatureMap = new Map(
        (featureDays ?? [])
          .filter((row) => row?.tradingDateKey === prevTradingDay)
          .map((row) => [String(row.symbol), row.features ?? null]),
      )
      const intradaySeqBySymbol = new Map()
      gapIntradayProfiles = []
      for (const meta of symbols ?? []) {
        const symbol = String(meta?.symbol ?? "").trim()
        if (!symbol) {
          continue
        }
        const rows = hourlyBySymbol.get(symbol) ?? []
        const result = buildGapIntradaySeq({
          rows,
          strictAfter1500: dataMode === "contract",
        })
        const seq = result.seq
        if (seq?.closeSeq?.length) {
          intradaySeqBySymbol.set(symbol, seq)
          gapIntradayProfiles.push({
            symbol,
            tradingDateKey: asOfDateKey,
            seq,
          })
        }
      }
      gapFeatureDays = buildGapFeatureDays({
        symbols,
        asOfDateKey,
        prevFeaturesBySymbol: prevFeatureMap,
        price15BySymbol: price15Map,
        prevCloseBySymbol,
        intradaySeqBySymbol,
      })
    }

    if (includeSurge) {
      const candidatePolicy = candidatePolicyByTrack.get("SURGE_EOD") ?? {}
      const surgePatternVariants = resolvePatternVariants("SURGE_EOD")
      const moonshotPatternVariants = resolvePatternVariants("MOONSHOT")
      const surgeVariantsToTry =
        surgePatternVariants.length > 0 ? surgePatternVariants : [null]
      const moonshotVariantsToTry =
        moonshotPatternVariants.length > 0
          ? moonshotPatternVariants
          : surgeVariantsToTry
      let chosenSurgePicks = []
      let chosenSurgeVariantIndex = 0
      for (
        let variantIndex = 0;
        variantIndex < surgeVariantsToTry.length;
        variantIndex += 1
      ) {
        const patterns = surgeVariantsToTry[variantIndex]
        const moonshotPatterns =
          moonshotVariantsToTry[
            Math.min(variantIndex, moonshotVariantsToTry.length - 1)
          ] ?? patterns
        const coreCandidates = buildRecommendCandidates({
          data,
          asOfDateKey,
          track: "SURGE_EOD",
          patterns,
          minLiquidity: candidatePolicy.minLiquidity,
          scoreEps: candidatePolicy.scoreEps,
          vectorBins: candidatePolicy.vectorBins,
        })
        surgeMarketCapStats = coreCandidates?.meta?.marketCapStats ?? null
        let usedCoreFallback = false
        let corePick = pickWithPlan({
          candidates: coreCandidates,
          track: "SURGE_EOD",
        })
        if (!corePick) {
          if (args.keepZeroWhenNoMatch !== true) {
            corePick = buildFallbackCandidate({ track: "SURGE_EOD" })
            if (corePick) {
              usedCoreFallback = true
            }
          }
          if (!corePick) {
            emptyRecommendationReasonCodes.add("CORE_EMPTY")
          }
        }
        if (corePick) {
          corePick = { ...corePick, role: "CORE" }
        }

        const baseMoonCandidates = buildMoonshotCandidates({
          candidates: coreCandidates,
          requireFeatures: true,
          excludeSymbol: corePick?.symbol ?? null,
        })
        let moonPick = pickMoonshot({
          candidates: baseMoonCandidates,
          excludeSymbol: corePick?.symbol ?? null,
        })
        if (!moonPick) {
          const relaxedCandidates = buildRecommendCandidates({
            data,
            asOfDateKey,
            track: "SURGE_EOD",
            patterns: moonshotPatterns,
            minLiquidity: 0,
            scoreEps: candidatePolicy.scoreEps,
            vectorBins: candidatePolicy.vectorBins,
            requireRuleInputs: false,
            requireShapeInputs: false,
            requirePatternMatch: false,
          })
          const relaxedMoonCandidates = buildMoonshotCandidates({
            candidates: relaxedCandidates,
            requireFeatures: true,
            excludeSymbol: corePick?.symbol ?? null,
          })
          moonPick = pickMoonshot({
            candidates: relaxedMoonCandidates,
            excludeSymbol: corePick?.symbol ?? null,
          })
          if (!moonPick) {
            const relaxedMissingCandidates = buildMoonshotCandidates({
              candidates: relaxedCandidates,
              requireFeatures: false,
              excludeSymbol: corePick?.symbol ?? null,
            })
            moonPick = pickMoonshot({
              candidates: relaxedMissingCandidates,
              excludeSymbol: corePick?.symbol ?? null,
            })
          }
        }
        let usedMoonFallback = false
        if (!moonPick) {
          if (args.keepZeroWhenNoMatch !== true) {
            const fallback = buildFallbackCandidate({
              track: "SURGE_EOD",
              excludeSymbol: corePick?.symbol ?? null,
            })
            if (fallback) {
              moonPick = {
                ...fallback,
                warnings: ["MOONSHOT_FALLBACK_USED"],
              }
              usedMoonFallback = true
            }
          }
        }
        if (moonPick) {
          moonPick = { ...moonPick, role: "MOONSHOT", track: "MOONSHOT" }
        } else {
          emptyRecommendationReasonCodes.add("MOONSHOT_EMPTY")
        }
        const cappedMaxEod = Math.max(0, Math.min(2, Number(args.maxEod ?? 2)))
        const cappedCorePerTrack = Math.max(
          0,
          Math.min(1, Number(args.maxRecommendationPerTrack ?? 1)),
        )
        const cappedMoonshotPerDay = Math.max(
          0,
          Math.min(1, Number(args.moonshotMaxPicksPerDay ?? 1)),
        )
        const surgePicks = []
        if (
          corePick &&
          cappedCorePerTrack > 0 &&
          surgePicks.length < cappedMaxEod
        ) {
          surgePicks.push(corePick)
        }
        if (
          moonPick &&
          cappedMoonshotPerDay > 0 &&
          surgePicks.length < cappedMaxEod
        ) {
          surgePicks.push(moonPick)
        }
        chosenSurgePicks = surgePicks
        chosenSurgeVariantIndex = variantIndex
        applyPatternMetaVariant({
          track: "SURGE_EOD",
          pattern: patterns,
          variantIndex,
        })
        applyPatternMetaVariant({
          track: "MOONSHOT",
          pattern: moonshotPatterns,
          variantIndex,
        })
        const shouldCascadeNext =
          variantIndex < surgeVariantsToTry.length - 1 &&
          usedCoreFallback &&
          usedMoonFallback
        if (!shouldCascadeNext) {
          break
        }
      }
      if (chosenSurgeVariantIndex > 0) {
        notes.push(`SURGE_PATTERN_CASCADE_USED#${chosenSurgeVariantIndex + 1}`)
      }
      if (chosenSurgePicks.length <= 0) {
        notes.push("CORE_EMPTY")
        notes.push("MOONSHOT_EMPTY")
      }
      picksByTrack.set("SURGE_EOD", chosenSurgePicks)
    }

    if (includeGap) {
      const candidatePolicy = candidatePolicyByTrack.get("GAP_15_BET") ?? {}
      const gapData = {
        ...data,
        featureDays: gapFeatureDays,
        intradayProfiles: gapIntradayProfiles,
      }
      const gapPatternVariants = resolvePatternVariants("GAP_15_BET")
      const gapVariantsToTry =
        gapPatternVariants.length > 0 ? gapPatternVariants : [null]
      let chosenGapPicks = []
      let chosenGapVariantIndex = 0
      for (
        let variantIndex = 0;
        variantIndex < gapVariantsToTry.length;
        variantIndex += 1
      ) {
        const patterns = gapVariantsToTry[variantIndex]
        const gapCandidates = buildRecommendCandidates({
          data: gapData,
          asOfDateKey,
          track: "GAP_15_BET",
          patterns,
          minLiquidity: candidatePolicy.minLiquidity,
          scoreEps: candidatePolicy.scoreEps,
          vectorBins: candidatePolicy.vectorBins,
        })
        gapMarketCapStats = gapCandidates?.meta?.marketCapStats ?? null
        const tradability = filterGapCandidatesByTradability({
          candidates: gapCandidates,
          price15Map,
          prevCloseBySymbol,
          lastHourBySymbol,
        })
        const cappedMaxGap = Math.max(
          0,
          Math.min(
            1,
            Number(args.maxGap ?? 1),
            Number(args.maxRecommendationPerTrack ?? 1),
          ),
        )
        const picks = tradability.candidates.slice(0, cappedMaxGap)
        gapTradabilityMeta = {
          asOfDateKey,
          prevTradingDay: prevTradingDay ?? null,
          totalCandidates: gapCandidates.length,
          filteredCount: tradability.stats.filteredCount,
          filteredByTradabilityCount:
            tradability.stats.filteredByTradabilityCount,
          filteredByUpperLimitCount:
            tradability.stats.filteredByUpperLimitCount,
          filteredByLowerLimitCount:
            tradability.stats.filteredByLowerLimitCount,
          filteredMissingPrice15Count:
            tradability.stats.filteredMissingPrice15Count,
          filteredMissingPrevCloseCount:
            tradability.stats.filteredMissingPrevCloseCount,
          filteredByZeroVolumeCount:
            tradability.stats.filteredByZeroVolumeCount,
          producedCount: picks.length,
        }
        chosenGapPicks = picks
        chosenGapVariantIndex = variantIndex
        applyPatternMetaVariant({
          track: "GAP_15_BET",
          pattern: patterns,
          variantIndex,
        })
        const shouldCascadeNext =
          picks.length <= 0 && variantIndex < gapVariantsToTry.length - 1
        if (!shouldCascadeNext) {
          if (
            tradability.stats.filteredByTradabilityCount > 0 &&
            picks.length <= 0
          ) {
            emptyRecommendationReasonCodes.add("ALL_FILTERED_BY_TRADABILITY")
          }
          break
        }
      }
      if (chosenGapVariantIndex > 0) {
        notes.push(`GAP_PATTERN_CASCADE_USED#${chosenGapVariantIndex + 1}`)
      }
      picksByTrack.set("GAP_15_BET", chosenGapPicks)
    }

    const allPicks = Array.from(picksByTrack.values()).flat()
    if (allPicks.length <= 0 && emptyRecommendationReasonCodes.size <= 0) {
      emptyRecommendationReasonCodes.add("ROUTER_NO_MATCH")
    }
    if (allPicks.length <= 0) {
      for (const reasonCode of emptyRecommendationReasonCodes) {
        if (!notes.includes(reasonCode)) {
          notes.push(reasonCode)
        }
      }
    }
    const minPlanProfitGateSummary = {
      thresholds: {
        corePct: getThresholdPct("CORE"),
        moonshotPct: getThresholdPct("MOONSHOT"),
      },
      eligibleCount: 0,
      excludedCount: 0,
      excludedByReason: {},
      note: "Strict gate enabled; may reduce signal count and increase empty-week risk.",
    }
    const bumpMinPlanProfitExcluded = (reason) => {
      const key = String(reason ?? "UNKNOWN")
      minPlanProfitGateSummary.excludedByReason[key] =
        (minPlanProfitGateSummary.excludedByReason[key] ?? 0) + 1
      minPlanProfitGateSummary.excludedCount += 1
    }
    const nowTs = Date.now()
    const evaluatedAtTs = BigInt(nowTs)
    const missingPickNotes = notes.filter(
      (note) =>
        note === "CORE_EMPTY" ||
        note === "MOONSHOT_EMPTY" ||
        note === "POOL_EMPTY_AT_RECOMMEND" ||
        note === "POOLSET_NO_MATCH" ||
        note === "ROUTER_NO_MATCH" ||
        note === "ALL_FILTERED_BY_TRADABILITY",
    )
    const snapshotData = {
      tradingDateKey: asOfDateKey,
      asOfBarTs5m: BigInt(0),
      computedAtTs: evaluatedAtTs,
      settingsHash: args.settingsHash || "recommend-v1",
      marketState: "RECOMMEND",
      candidateCount: allPicks.length,
      sourceMetaJson: {
        minLiquidity: args.minLiquidity,
        scoreEps: Number.isFinite(args.scoreEps) ? args.scoreEps : null,
        vectorBins: args.vectorBins,
        cliProvided: args.cliProvided,
        effectivePolicy: {
          candidates: Object.fromEntries(candidatePolicyByTrack.entries()),
          candidateSources: Object.fromEntries(
            candidatePolicySourcesByTrack.entries(),
          ),
          levels: Object.fromEntries(
            tracks.map((track) => [track, resolvePlanPolicyParams(track)]),
          ),
        },
        regimeSelection: {
          requestedRegime: args.regimeOverride ?? null,
          effectiveRegime: regimeContext.regime ?? null,
          source: regimeContext.source,
          sourceDateKey: regimeContext.sourceDateKey ?? null,
        },
        patternLibraries: Object.fromEntries(
          tracks.map((track) => {
            const meta = patternMetaByTrack.get(track) ?? {}
            return [
              track,
              {
                version: meta.version ?? null,
                versionLabel: meta.versionLabel ?? null,
                engineType: meta.engineType ?? "rule",
                selectedRegimeTag: meta.selectedRegimeTag ?? null,
                regimeMatch: Boolean(meta.regimeMatch),
                selectedFromPool: Boolean(meta.selectedFromPool),
                selectedPoolSetId: meta.selectedPoolSetId ?? null,
                selectedMemberCandidateId:
                  meta.selectedMemberCandidateId ?? null,
                poolRank: meta.poolRank ?? null,
                selectionReason: meta.selectionReason ?? null,
              },
            ]
          }),
        ),
        routerRequireTrainRangeValid: args.routerRequireTrainRangeValid,
        patternSelectionIssuesByTrack: Object.fromEntries(
          Array.from(patternSelectionIssuesByTrack.entries()).map(
            ([track, set]) => [track, Array.from(set ?? [])],
          ),
        ),
        maxEod: args.maxEod,
        maxGap: args.maxGap,
        maxRecommendationPerTrack: args.maxRecommendationPerTrack,
        moonshotMaxPicksPerDay: args.moonshotMaxPicksPerDay,
        keepZeroWhenNoMatch: args.keepZeroWhenNoMatch,
        routerCloseDecisionTimeKST: args.routerCloseDecisionTimeKST,
        asOfDateKey: leakMeta.asOfDateKey,
        maxUsedDateKey: leakMeta.maxUsedDateKey,
        leakDetected: leakMeta.leakDetected,
        leakRemovedBySet: leakMeta.removedBySet,
        missingPicks: missingPickNotes,
        emptyRecommendationReasons: Array.from(emptyRecommendationReasonCodes),
        gapTradability: gapTradabilityMeta,
        marketCap: {
          surge: surgeMarketCapStats,
          gap: gapMarketCapStats,
        },
        minPlanProfitGate: minPlanProfitGateSummary,
      },
      themeVersionId: null,
    }

    const surgePicks = picksByTrack.get("SURGE_EOD") ?? []
    const gapPicks = picksByTrack.get("GAP_15_BET") ?? []
    const recommendations = allPicks.map((pick) => {
      const meta = patternMetaByTrack.get(pick.track) ?? {}
      const laneTrack =
        pick.track === "SURGE_EOD" &&
        String(pick.role ?? "")
          .trim()
          .toUpperCase() === "MOONSHOT"
          ? "MOONSHOT"
          : pick.track
      return {
        mode: args.recommendationMode,
        track: laneTrack,
        role: pick.role ?? null,
        symbol: pick.symbol,
        name: pick.name ?? null,
        poolSetId: meta.selectedPoolSetId ?? null,
        memberCandidateId: meta.selectedMemberCandidateId ?? null,
        routerScore: Number(pick.score ?? 0) || 0,
        whyCodes: Array.isArray(pick.reasons) ? pick.reasons : [],
        riskFlags: Array.isArray(pick.warnings) ? pick.warnings : [],
      }
    })
    const resultSummary = {
      dataMode,
      recommendationMode: args.recommendationMode,
      routerCloseDecisionTimeKST: args.routerCloseDecisionTimeKST,
      asOfDateKey,
      regime: regimeContext.regime ?? null,
      regimeSource: regimeContext.source,
      maxUsedDateKey: leakMeta.maxUsedDateKey,
      leakDetected: leakMeta.leakDetected,
      emptyRecommendationReasons: Array.from(emptyRecommendationReasonCodes),
      picks: {
        SURGE_EOD: {
          core: surgePicks.filter((row) => row?.role === "CORE").length,
          moonshot: surgePicks.filter((row) => row?.role === "MOONSHOT").length,
          total: surgePicks.length,
        },
        GAP_15_BET: gapPicks.length,
      },
      recommendations,
      notes,
    }

    if (prisma && !args.dryRun) {
      const snapshot = await prisma.aiSnapshot.upsert({
        where: {
          tradingDateKey_asOfBarTs5m_settingsHash: {
            tradingDateKey: snapshotData.tradingDateKey,
            asOfBarTs5m: snapshotData.asOfBarTs5m,
            settingsHash: snapshotData.settingsHash,
          },
        },
        create: snapshotData,
        update: snapshotData,
        select: { id: true },
      })

      if (args.reset) {
        await prisma.aiSignalDetail.deleteMany({
          where: { signal: { snapshotId: snapshot.id } },
        })
        await prisma.aiSignal.deleteMany({ where: { snapshotId: snapshot.id } })
      }

      for (const pick of allPicks) {
        const candleSeries = candleMap.get(pick.symbol) ?? []
        const levelMap = levelMaps.get(pick.track)
        const planPolicyParams = resolvePlanPolicyParams(pick.track)
        const levelPlan = buildLevelPlanForSymbol({
          levelMap,
          policyParams: planPolicyParams,
          symbol: pick.symbol,
          candles: candleSeries,
          asOfDateKey,
        })
        if (!levelPlan) {
          continue
        }
        const tier = pick.role === "MOONSHOT" ? "MOONSHOT" : "CORE"
        const minPlanGate = evaluateMinPlanProfit(tier, levelPlan)
        if (!minPlanGate.ok) {
          bumpMinPlanProfitExcluded(minPlanGate.reasonCode)
        } else {
          minPlanProfitGateSummary.eligibleCount += 1
        }
        const zones = {
          buyLow: levelPlan.entryZone.low,
          buyHigh: levelPlan.entryZone.high,
          stopLow: levelPlan.stopZone.low,
          stopHigh: levelPlan.stopZone.high,
          sellLow: levelPlan.targetZone.low,
          sellHigh: levelPlan.targetZone.high,
        }
        const grade = computeGrade(pick.score)
        const signalId = `${pick.track}:${pick.symbol}:${asOfDateKey}`
        const leakWarnings = leakMeta.leakDetected ? ["LEAK_DETECTED"] : []
        const minPlanWarnings = minPlanGate.ok ? [] : [minPlanGate.reasonCode]
        const warnings = Array.isArray(pick.warnings)
          ? [...pick.warnings, ...leakWarnings, ...minPlanWarnings]
          : [...leakWarnings, ...minPlanWarnings]
        const blockedSummary = minPlanGate.ok
          ? leakMeta.leakDetected
            ? "데이터 누수 감지"
            : null
          : minPlanGate.messageKo
        const patternMeta = patternMetaByTrack.get(pick.track) ?? {}
        const strategyVersion = buildStrategyVersion({
          track: pick.track,
          asOfDateKey,
          patternLabel: patternMeta.versionLabel,
        })
        const ruleset = pick.track === "SURGE_EOD" ? "EOD_1x2" : "GAP_15_BET"
        const signalPayload = {
          id: signalId,
          snapshotId: snapshot.id,
          tradingDateKey: asOfDateKey,
          evaluatedAtTs,
          symbol: pick.symbol,
          name: pick.name,
          market: pick.market,
          cluster: pick.market,
          emitStatus:
            leakMeta.leakDetected || !minPlanGate.ok ? "BLOCKED" : "EMITTED",
          totalScore: Math.round(pick.score),
          grade: grade.grade,
          gradeRank: grade.gradeRank,
          rewardPct: levelPlan.rewardPct,
          riskPct: levelPlan.riskPct,
          rr: levelPlan.rr,
          entryKind: "PULLBACK",
          ...zones,
          reasonsJson: pick.reasons,
          warningsJson: warnings,
          blockedSummary,
          track: pick.track,
          role: pick.role ?? null,
          type: "LEVEL_POLICY",
          policyType: "RECOMMEND",
          mode: pick.track === "GAP_15_BET" ? "GAP_15" : "EOD",
          status: "ACTIVE",
          createdAtKst: new Date(nowTs + 9 * 60 * 60_000),
          activatedAtKst: new Date(nowTs + 9 * 60 * 60_000),
          expiresAtKst: null,
          expectedBars: 5,
          targetReturnPct: levelPlan.rewardPct,
        }

        await prisma.aiSignal.upsert({
          where: { id: signalId },
          create: signalPayload,
          update: signalPayload,
        })

        await prisma.aiSignalDetail.upsert({
          where: { signalId },
          create: {
            signalId,
            evidenceJson: [],
            dataHealthJson: {
              asOfDateKey: leakMeta.asOfDateKey,
              maxUsedDateKey: leakMeta.maxUsedDateKey,
              leakDetected: leakMeta.leakDetected,
            },
            planJson: {
              entry: levelPlan.entryZone,
              stop: levelPlan.stopZone,
              target: levelPlan.targetZone,
              trailing: levelPlan.trailing,
            },
            whyJson: {
              reasons: pick.reasons,
              warnings,
              score: pick.score,
              liquidity: pick.liquidity,
              role: pick.role ?? null,
              moonScore: pick.moonScore ?? null,
              moonComponents: pick.moonComponents ?? null,
              featureSnapshot: pick.featureSnapshot ?? null,
              patternVersionId: patternMeta.version ?? null,
              patternVersionLabel: patternMeta.versionLabel ?? null,
              regimeSelection: {
                effectiveRegime: regimeContext.regime ?? null,
                source: regimeContext.source,
                sourceDateKey: regimeContext.sourceDateKey ?? null,
              },
              patternLibrary: {
                engineType: patternMeta.engineType ?? "rule",
                selectedRegimeTag: patternMeta.selectedRegimeTag ?? null,
                regimeMatch: Boolean(patternMeta.regimeMatch),
                selectedFromPool: Boolean(patternMeta.selectedFromPool),
                selectedPoolSetId: patternMeta.selectedPoolSetId ?? null,
                selectedMemberCandidateId:
                  patternMeta.selectedMemberCandidateId ?? null,
                poolRank: patternMeta.poolRank ?? null,
                selectionReason: patternMeta.selectionReason ?? null,
              },
              strategyVersion,
              ruleset,
              minPlanProfitGate: minPlanGate,
            },
          },
          update: {
            evidenceJson: [],
            dataHealthJson: {
              asOfDateKey: leakMeta.asOfDateKey,
              maxUsedDateKey: leakMeta.maxUsedDateKey,
              leakDetected: leakMeta.leakDetected,
            },
            planJson: {
              entry: levelPlan.entryZone,
              stop: levelPlan.stopZone,
              target: levelPlan.targetZone,
              trailing: levelPlan.trailing,
            },
            whyJson: {
              reasons: pick.reasons,
              warnings,
              score: pick.score,
              liquidity: pick.liquidity,
              role: pick.role ?? null,
              moonScore: pick.moonScore ?? null,
              moonComponents: pick.moonComponents ?? null,
              featureSnapshot: pick.featureSnapshot ?? null,
              patternVersionId: patternMeta.version ?? null,
              patternVersionLabel: patternMeta.versionLabel ?? null,
              regimeSelection: {
                effectiveRegime: regimeContext.regime ?? null,
                source: regimeContext.source,
                sourceDateKey: regimeContext.sourceDateKey ?? null,
              },
              patternLibrary: {
                engineType: patternMeta.engineType ?? "rule",
                selectedRegimeTag: patternMeta.selectedRegimeTag ?? null,
                regimeMatch: Boolean(patternMeta.regimeMatch),
                selectedFromPool: Boolean(patternMeta.selectedFromPool),
                selectedPoolSetId: patternMeta.selectedPoolSetId ?? null,
                selectedMemberCandidateId:
                  patternMeta.selectedMemberCandidateId ?? null,
                poolRank: patternMeta.poolRank ?? null,
                selectionReason: patternMeta.selectionReason ?? null,
              },
              strategyVersion,
              ruleset,
              minPlanProfitGate: minPlanGate,
            },
          },
        })
      }
      await prisma.aiSnapshot.update({
        where: { id: snapshot.id },
        data: { sourceMetaJson: snapshotData.sourceMetaJson },
      })
    }

    results.push(resultSummary)
  }
  if (prisma) {
    await prisma.$disconnect()
  }
  const payload =
    results.length === 1
      ? results[0]
      : {
          dataMode,
          fromDateKey: baseArgs.fromDateKey,
          toDateKey: baseArgs.toDateKey,
          results,
        }
  const writeRecommendationOutputs = (entry) => {
    const mode = String(entry?.recommendationMode ?? "ALL")
      .trim()
      .toUpperCase()
    const dateKey = String(entry?.asOfDateKey ?? "").trim()
    if (!dateKey) return
    const recommendationRows = Array.isArray(entry?.recommendations)
      ? entry.recommendations
      : []
    const emptyReasons = Array.isArray(entry?.emptyRecommendationReasons)
      ? entry.emptyRecommendationReasons
      : []
    const outputDir = path.join(rootDir, "output", "recommendations")
    fs.mkdirSync(outputDir, { recursive: true })
    const emit = (targetMode, rows) => {
      const slug =
        targetMode === "INTRADAY_1500" ? "intraday_1500" : "eod_close"
      const latestPath = path.join(outputDir, `latest_${slug}.json`)
      const datedPath = path.join(
        outputDir,
        `${dateKey.replace(/-/g, "")}_${slug}.json`,
      )
      const output = {
        recommendationMode: targetMode,
        routerCloseDecisionTimeKST: args.routerCloseDecisionTimeKST,
        asOfDateKey: dateKey,
        recommendations: rows,
        emptyRecommendationReasons: emptyReasons,
        generatedAt: new Date().toISOString(),
      }
      fs.writeFileSync(
        latestPath,
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8",
      )
      fs.writeFileSync(
        datedPath,
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8",
      )
    }
    if (mode === "INTRADAY_1500") {
      emit("INTRADAY_1500", recommendationRows)
      return
    }
    if (mode === "EOD_CLOSE") {
      emit("EOD_CLOSE", recommendationRows)
      return
    }
    const intradayRows = recommendationRows.filter(
      (row) =>
        String(row?.track ?? "")
          .trim()
          .toUpperCase() === "GAP_15_BET",
    )
    const eodRows = recommendationRows.filter((row) => {
      const track = String(row?.track ?? "")
        .trim()
        .toUpperCase()
      return track === "SURGE_EOD" || track === "MOONSHOT"
    })
    emit("INTRADAY_1500", intradayRows)
    emit("EOD_CLOSE", eodRows)
  }
  if (Array.isArray(payload?.results)) {
    for (const row of payload.results) {
      writeRecommendationOutputs(row)
    }
  } else {
    writeRecommendationOutputs(payload)
  }
  console.log(JSON.stringify(payload, null, 2))
}

run().catch((error) => {
  console.error("[ai-recommend] failed", error)
  process.exitCode = 1
})
