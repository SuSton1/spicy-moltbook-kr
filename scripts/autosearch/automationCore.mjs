import {
  mapPrimaryReasonToFailureCode,
  normalizeFailureReasonCode,
} from "./failureReason.mjs"
import { DEFAULT_AUTOTUNE_ALLOWLIST } from "./riskClosure.mjs"

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const parseBoolean = (value, fallback = false) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const normalizeDateKeyToken = (value) => {
  const digits = String(value ?? "").replace(/[^0-9]/g, "")
  if (digits.length !== 8) return ""
  const y = digits.slice(0, 4)
  const m = digits.slice(4, 6)
  const d = digits.slice(6, 8)
  return `${y}-${m}-${d}`
}

const normalizeTrack = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

const normalizeStringList = (value) => {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
  return Array.from(
    new Set(list.map((item) => String(item ?? "").trim()).filter(Boolean)),
  )
}

const normalizeTracks = (tracks) => {
  const list = Array.isArray(tracks)
    ? tracks
    : String(tracks ?? "")
        .split(",")
        .map((item) => item.trim())
  return Array.from(
    new Set(
      list
        .map((item) => normalizeTrack(item))
        .filter(
          (item) =>
            item === "SURGE_EOD" ||
            item === "GAP_15_BET" ||
            item === "MOONSHOT",
        ),
    ),
  )
}

const TRACK_KEYS_WITH_MOONSHOT = Object.freeze([
  "SURGE_EOD",
  "GAP_15_BET",
  "MOONSHOT",
])

const normalizeRecommendationTracks = (value, fallback, allowedTracks) => {
  const allowed = new Set(Array.isArray(allowedTracks) ? allowedTracks : [])
  const list = normalizeStringList(value)
    .map((item) => normalizeTrack(item))
    .filter((item) => allowed.has(item))
  if (list.length > 0) {
    return list
  }
  const fallbackList = normalizeStringList(fallback)
    .map((item) => normalizeTrack(item))
    .filter((item) => allowed.has(item))
  return fallbackList.length > 0 ? fallbackList : Array.from(allowed)
}

const normalizeCloseDecisionTime = (value, fallback = "15:30") => {
  const token = String(value ?? "")
    .trim()
    .replace(".", ":")
  if (!token) return fallback
  const match = token.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return fallback
  const hh = String(match[1]).padStart(2, "0")
  const mm = String(match[2]).padStart(2, "0")
  return `${hh}:${mm}`
}

const normalizeEngineQuotaPair = (value, fallback) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const chartRaw = clampNumber(
    Object.hasOwn(source, "chart") ? source.chart : fallback.chart,
    fallback.chart,
    0,
    1,
  )
  const ruleRaw = clampNumber(
    Object.hasOwn(source, "rule") ? source.rule : fallback.rule,
    fallback.rule,
    0,
    1,
  )
  const sum = chartRaw + ruleRaw
  if (sum <= 0) {
    return { chart: fallback.chart, rule: fallback.rule }
  }
  return { chart: chartRaw / sum, rule: ruleRaw / sum }
}

const normalizeChampionDiscoveryBudgetSplit = (value, fallback) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const championRaw = clampNumber(
    Object.hasOwn(source, "champion") ? source.champion : fallback.champion,
    fallback.champion,
    0,
    1,
  )
  const discoveryRaw = clampNumber(
    Object.hasOwn(source, "discovery") ? source.discovery : fallback.discovery,
    fallback.discovery,
    0,
    1,
  )
  const sum = championRaw + discoveryRaw
  if (sum <= 0) {
    return { champion: fallback.champion, discovery: fallback.discovery }
  }
  return { champion: championRaw / sum, discovery: discoveryRaw / sum }
}

const DEFAULT_DATA_SYNC_FULL_COMMAND = Object.freeze([
  "node",
  "scripts/autosearch/data_sync_orchestrator.mjs",
  "--window=6y",
  "--market=KR",
  "--symbol-limit=all",
  "--skip-train",
  "--stopAfter=derived",
  "--no-kis",
  "--mode=weekly_strict",
  "--minCoverage=0.985",
  "--minTradingDays=16",
  "--minUniverseSize=1",
  "--signalWindowTradingDays=28",
  "--requireSignals=1",
  "--minSignalsLoaded=1",
  "--strict=1",
])

const DEFAULT_DATA_SYNC_DAILY_COMMAND = Object.freeze([
  "node",
  "scripts/autosearch/data_sync_orchestrator.mjs",
  "--window=2y",
  "--market=KR",
  "--symbol-limit=all",
  "--skip-train",
  "--stopAfter=derived",
  "--no-kis",
  "--mode=smart",
  "--minCoverage=0.985",
  "--minTradingDays=16",
  "--minUniverseSize=1",
  "--signalWindowTradingDays=28",
  "--requireSignals=1",
  "--minSignalsLoaded=1",
  "--strict=1",
])

const DEFAULT_DATA_SYNC_COMMAND = DEFAULT_DATA_SYNC_FULL_COMMAND

const DEFAULT_TIMEOUTS_MS = Object.freeze({
  dataSync: 5 * 60 * 60 * 1000,
  derive: 3 * 60 * 60 * 1000,
  signalPreflight: 20 * 60 * 1000,
  trainValidate: 8 * 60 * 60 * 1000,
  deployApply: 6 * 60 * 60 * 1000,
  verify: 45 * 60 * 1000,
})

const DEFAULT_RULE_AUTO_TUNE = Object.freeze({
  enabled: false,
  triggerFailureStreak: 2,
  worst2wStep: 0.2,
  minWorst2wAvgPctFloor: -2.5,
  requireMaxTargetStep: 1,
  minRequireMaxTargetPassed: 4,
})

const DEFAULT_MEMORY_GUARD = Object.freeze({
  enabled: true,
  minFreeRatio: 0.08,
  minFreeMb: 1024,
  cooldownMs: 120000,
})

export const DEFAULT_RULES_LOCK = Object.freeze({
  version: "autosearch_automation_rules_v1",
  asOfInput: "2026-02-13",
  tracks: ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"],
  requiredTracks: ["SURGE_EOD", "GAP_15_BET"],
  passMode: "all",
  targetPct: 5,
  minWorst2wAvgPct: -1.5,
  highWeekPct: 10,
  minHighWeeks: 0,
  nearHighWeeks: 0,
  minOtherWeekPct: 0.01,
  requireCompletedTradesEveryWeek: 1,
  requireLockboxOk: true,
  requireMaxTargetPassed: 5,
  noKisRequired: true,
})

export const DEFAULT_TUNING = Object.freeze({
  policyConflictResolution: "POOLSET_FIRST_STRICT",
  version: "autosearch_automation_tuning_v1",
  executionLane: "server",
  shards: 4,
  topPerTrack: 24,
  seedStart: 1,
  symbolSeedBase: "auto",
  symbolBucketTotal: 8,
  symbolBucketStride: 1,
  coverageSeedLanes: 4,
  sameFailureSignatureJumpThreshold: 3,
  sameFailureSignatureCursorMultiplier: 3,
  failureFingerprintCarryLimit: 320,
  explorationBanditEnabled: true,
  explorationBanditUcbC: 0.75,
  explorationBanditPriorMean: 0.25,
  explorationBanditPriorWeight: 2,
  explorationBanditMinSamples: 3,
  runtimeBudgetBiasEnabled: true,
  runtimeBudgetBiasMin: 0.75,
  runtimeBudgetBiasMax: 1.2,
  prefilterEnabled: true,
  prefilterWorst2wBuffer: 4,
  prefilterStopLikeCeil: 0.9,
  prefilterNoFillCeil: 0.95,
  allowUnsafeGapChartFallbackStage1: true,
  applyAfterDryPassStreak: 2,
  maxParallelShards: 2,
  maxWorkers: 2,
  minFreeMbForParallelShards: 2200,
  stage1MaxRounds: 60,
  stage2MaxRounds: 160,
  stage1PlateauRounds: 80,
  stage2PlateauRounds: 240,
  printEvery: 20,
  retryBackoffMs: 120000,
  maxAttempts: 30,
  sameFailureLimit: 3,
  structuralRecoveryLimit: 1,
  qualityRecoveryLimit: 1,
  transientRetryLimit: 6,
  qualityCollapseResetEnabled: true,
  qualityCollapseResetStreak: 3,
  qualityCollapseResetLimit: 1,
  dataSyncFailMaxConsecutive: 2,
  insufficientPoolRecycleLimit: 4,
  poolEmptyMaxConsecutive: 2,
  maxRuntimeMinutes: 240,
  runLockStaleMs: 6 * 60 * 60 * 1000,
  runLockAcquireRetries: 0,
  runLockRetryDelayMs: 5000,
  runLockEnabled: true,
  preflightEnabled: true,
  preflightSignalWindowTradingDays: 28,
  preflightMinTradingDays: 16,
  preflightMinWeekCount: 16,
  preflightMinUniverseSize: 1,
  preflightMinSignalsLoaded: 1,
  preflightRequireQualifiedSignals: false,
  preflightMinQualifiedSignals: 0,
  allowStage2OnLowQualityRequiredDry: true,
  disableStage2OnLowQualityRequiredDryOnZeroPass: true,
  precheckStructuralRecoveryAttempts: 1,
  precheckRequireCleanGit: true,
  precheckBlockOnSecretFiles: true,
  quarantineEnabled: true,
  quarantineFailThreshold: 3,
  quarantineTtlMinutes: 6 * 60,
  quarantineTtlByFailureType: {
    STRUCTURAL: 86400,
    QUALITY: 43200,
    TRANSIENT: 3600,
  },
  quarantineMaxEntries: 5000,
  autotuneAllowlist: [...DEFAULT_AUTOTUNE_ALLOWLIST],
  autotuneMaxAdjustmentsPerRun: 12,
  autotuneDeterministic: true,
  rescueEnabled: true,
  rescueTopK: 20,
  rescueCheapB: 300,
  rescueCheapM: 50,
  rescueDeepTopK: 12,
  rescueDeepB: 600,
  rescueDeepM: 80,
  rescueDeepAllowMoonshotDominant: false,
  rescueAlpha: 0.05,
  rescueP0: 0.95,
  rescueLcbQuantile: 0.1,
  policyEvalEnabled: true,
  policyEvalTopKSurge: 10,
  policyEvalTopKGap: 8,
  policyEvalMinWeeks: 8,
  policyEvalLookbackWeeks: 4,
  policyEvalMinDistinctCandidates: 2,
  policyEvalMaxConsecutiveDays: 4,
  policyEvalMaxConsecutiveWeeks: 2,
  rescueEarlyExitEnabled: true,
  rescueEarlyExitNoPassMinEval: 12,
  rescueEarlyExitNoPassMaxEval: 64,
  rescueEarlyExitMinEvalRatio: 0.25,
  rescueEarlyExitTerminalReasonRatio: 0.85,
  minPoolPerTrackSurge: 6,
  minPoolPerTrackGap: 8,
  minWorst2wPassPerTrackSurge: 2,
  minWorst2wPassPerTrackGap: 2,
  poolActiveLimitByTrack: {
    SURGE_EOD: 5,
    GAP_15_BET: 3,
    MOONSHOT: 2,
  },
  poolBenchLimitByTrack: {
    SURGE_EOD: 10,
    GAP_15_BET: 6,
    MOONSHOT: 4,
  },
  poolMinAliveByTrack: {
    SURGE_EOD: 3,
    GAP_15_BET: 2,
    MOONSHOT: 1,
  },
  poolRefillCountByTrack: {
    SURGE_EOD: 4,
    GAP_15_BET: 3,
    MOONSHOT: 1,
  },
  stage2TopKByTrack: {
    SURGE_EOD: 4,
    GAP_15_BET: 3,
    MOONSHOT: 2,
  },
  poolExpandEnabled: true,
  poolExpandMinPassDensity: 0.02,
  poolExpandMaxTerminalRatio: 0.8,
  poolExpandStepTopPerTrack: 12,
  poolExpandCapTopPerTrack: 140,
  poolExpandCapStage2TopK: 12,
  adaptivePoolTuningMode: "AUTO",
  previousPassDensity: 0,
  previousTerminalRatio: 1,
  poolsetEnabled: true,
  poolsetCountByTrack: {
    SURGE_EOD: 6,
    GAP_15_BET: 4,
    MOONSHOT: 4,
  },
  poolsetCountMaxByTrack: {
    SURGE_EOD: 12,
    GAP_15_BET: 8,
    MOONSHOT: 8,
  },
  poolsetActiveSizeByTrack: {
    SURGE_EOD: 5,
    GAP_15_BET: 3,
    MOONSHOT: 2,
  },
  poolsetBenchSizeByTrack: {
    SURGE_EOD: 7,
    GAP_15_BET: 5,
    MOONSHOT: 4,
  },
  poolsetMinAliveByTrack: {
    SURGE_EOD: 2,
    GAP_15_BET: 2,
    MOONSHOT: 1,
  },
  poolsetRefillCountByTrack: {
    SURGE_EOD: 2,
    GAP_15_BET: 2,
    MOONSHOT: 1,
  },
  poolsetMaxConcurrentEval: 1,
  stage2EvalConcurrency: 1,
  poolsetBatchSize: 2,
  stage2ResultCacheEnabled: true,
  stage2ResultCacheTtlSec: 86400,
  stage2SkipDuplicatePoolSetSignature: true,
  stage2ScheduleMode: "champion_first",
  stage2ContinueAfterFirstPass: true,
  poolsetStage1WindowMonths: 4,
  poolsetStage2WindowMonths: 4,
  poolsetEvalMode: "daily_router_8m",
  dailyPassAvengersEnabled: true,
  dailyPassTopNByTrack: {
    SURGE_EOD: 48,
    GAP_15_BET: 32,
    MOONSHOT: 24,
  },
  dailyPassPoolsetCountByTrack: {
    SURGE_EOD: 2,
    GAP_15_BET: 2,
    MOONSHOT: 1,
  },
  dailyPassRecombineRounds: 2,
  moonshotRecommendEnabled: true,
  moonshotTrackRequiredForCorePass: false,
  championDiscoveryBudgetSplit: { champion: 0.4, discovery: 0.6 },
  requirementEvidenceEnabled: true,
  policyDocSyncEnabled: true,
  poolEngineQuotaByTrack: {
    SURGE_EOD: { chart: 0.6, rule: 0.4 },
    GAP_15_BET: { chart: 0.4, rule: 0.6 },
    MOONSHOT: { chart: 0.5, rule: 0.5 },
  },
  routerUseRegime: true,
  routerRequireTrainRangeValid: true,
  routerRecencyHalfLifeDays: 20,
  routerMode1500Track: ["GAP_15_BET"],
  routerModeCloseTrack: ["SURGE_EOD", "MOONSHOT"],
  routerCloseDecisionTimeKST: "15:30",
  maxRecommendationPerTrack: 1,
  keepZeroWhenNoMatch: true,
  moonshotMaxPicksPerDay: 1,
  moonshotDiagnosticsMaxRows: 40,
  moonshotOutcomeEmptyFailEnabled: true,
  moonshotOutcomeEmptyMinSamples: 4,
  moonshotSignalMismatchMaxGapDays: 60,
  signalGapRepairEnabled: true,
  signalGapRepairPaddingDays: 7,
  signalGapRepairFromDateKey: "",
  signalGapRepairToDateKey: "",
  signalGapRepairStopAfter: "recommend",
  dataSyncEnabled: true,
  dataSyncTradingDayOnly: true,
  dataSyncOncePerTradingDay: true,
  dataSyncSkipRetryAttempts: true,
  speedProfileEnabled: true,
  speedProfileRequireParity: true,
  speedProfileExpansionGuard: true,
  speedProfileMaxStage2TopK: {
    SURGE_EOD: 4,
    GAP_15_BET: 3,
    MOONSHOT: 2,
  },
  gapChartUnsafeCooldownRounds: 6,
  moonshotPatternMissingCooldownRounds: 12,
  forceDataSyncNextAttempt: false,
  dataSyncMode: "weekly_strict",
  dataSyncFullEveryTradingDays: 5,
  dataSyncWeeklyTradingDays: 5,
  dataSyncNoOutputTimeoutMs: 90 * 60 * 1000,
  dataSyncForcedNoOutputTimeoutMs: 90 * 60 * 1000,
  dataSyncNoOutputMinElapsedMs: 5 * 60 * 1000,
  deriveEnabled: false,
  dataSyncCommand: [...DEFAULT_DATA_SYNC_COMMAND],
  dataSyncFullCommand: [...DEFAULT_DATA_SYNC_FULL_COMMAND],
  dataSyncDailyCommand: [...DEFAULT_DATA_SYNC_DAILY_COMMAND],
  deriveCommand: [],
  timeoutsMs: { ...DEFAULT_TIMEOUTS_MS },
  ruleAutoTune: { ...DEFAULT_RULE_AUTO_TUNE },
  memoryGuard: { ...DEFAULT_MEMORY_GUARD },
  envOverrides: {
    NO_KIS: "1",
    BACKFILL_DISABLE_KIS: "1",
    BACKFILL_KIS_ENABLED: "0",
    GOLIVE_MAX_RULE_CANDIDATES: "25000",
    GOLIVE_MAX_CANDIDATE_COUNT: "700",
    GOLIVE_MAX_SHAPE_K: "1400",
    GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK: "1",
    CORP_ACTIONS_YAHOO_CONCURRENCY: "6",
    CORP_ACTIONS_YAHOO_RPS: "3",
    CORP_ACTIONS_YAHOO_BURST: "6",
  },
  limits: {
    minShards: 2,
    maxShards: 12,
    minTopPerTrack: 8,
    maxTopPerTrack: 96,
    maxStage1MaxRounds: 300,
    maxStage2MaxRounds: 800,
  },
})

export const normalizeRulesLock = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const tracks = normalizeTracks(source.tracks ?? DEFAULT_RULES_LOCK.tracks)
  const requiredTracks = normalizeTracks(
    source.requiredTracks ?? source.tracks ?? tracks,
  )
  const normalized = {
    version: String(source.version ?? DEFAULT_RULES_LOCK.version),
    asOfInput: String(source.asOfInput ?? DEFAULT_RULES_LOCK.asOfInput)
      .trim()
      .slice(0, 16),
    tracks: tracks.length ? tracks : [...DEFAULT_RULES_LOCK.tracks],
    requiredTracks: requiredTracks.length
      ? requiredTracks
      : [...DEFAULT_RULES_LOCK.requiredTracks],
    passMode:
      String(source.passMode ?? DEFAULT_RULES_LOCK.passMode)
        .trim()
        .toLowerCase() === "surge_only"
        ? "surge_only"
        : "all",
    targetPct: clampInt(source.targetPct, DEFAULT_RULES_LOCK.targetPct, 1, 50),
    minWorst2wAvgPct: clampNumber(
      source.minWorst2wAvgPct,
      DEFAULT_RULES_LOCK.minWorst2wAvgPct,
      -100,
      100,
    ),
    highWeekPct: clampNumber(
      source.highWeekPct,
      DEFAULT_RULES_LOCK.highWeekPct,
      0,
      100,
    ),
    minHighWeeks: clampInt(
      source.minHighWeeks,
      DEFAULT_RULES_LOCK.minHighWeeks,
      0,
      53,
    ),
    nearHighWeeks: clampInt(
      source.nearHighWeeks,
      DEFAULT_RULES_LOCK.nearHighWeeks,
      0,
      53,
    ),
    minOtherWeekPct: clampNumber(
      source.minOtherWeekPct,
      DEFAULT_RULES_LOCK.minOtherWeekPct,
      0,
      200,
    ),
    requireCompletedTradesEveryWeek: clampInt(
      source.requireCompletedTradesEveryWeek,
      DEFAULT_RULES_LOCK.requireCompletedTradesEveryWeek,
      1,
      20,
    ),
    requireLockboxOk: parseBoolean(
      source.requireLockboxOk,
      DEFAULT_RULES_LOCK.requireLockboxOk,
    ),
    requireMaxTargetPassed: clampInt(
      source.requireMaxTargetPassed,
      DEFAULT_RULES_LOCK.requireMaxTargetPassed,
      0,
      100,
    ),
    noKisRequired: parseBoolean(
      source.noKisRequired,
      DEFAULT_RULES_LOCK.noKisRequired,
    ),
  }
  return normalized
}

const normalizeCommandItems = (command) =>
  Array.isArray(command)
    ? command.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []

const findCommandArgValue = (command, prefix) => {
  const list = normalizeCommandItems(command)
  const found = list.find((item) => item.startsWith(prefix))
  if (!found) return ""
  return String(found.slice(prefix.length)).trim()
}

const isLegacyDataFillCommand = (command) => {
  const list = normalizeCommandItems(command)
  return (
    list.length >= 3 &&
    list[0] === "npm" &&
    list[1] === "run" &&
    list[2] === "data:fill"
  )
}

const buildOrchestratorCommandFromLegacy = ({ command, tier }) => {
  const list = normalizeCommandItems(command)
  const isDaily = String(tier ?? "FULL").toUpperCase() === "DAILY"
  const defaultWindow = isDaily ? "2y" : "6y"
  const mode = isDaily ? "smart" : "weekly_strict"
  const window = findCommandArgValue(list, "--window=") || defaultWindow
  const market = findCommandArgValue(list, "--market=") || "KR"
  const symbolLimit =
    findCommandArgValue(list, "--symbol-limit=") ||
    findCommandArgValue(list, "--symbolLimit=") ||
    "all"
  const stopAfter = findCommandArgValue(list, "--stopAfter=") || "derived"

  return [
    "node",
    "scripts/autosearch/data_sync_orchestrator.mjs",
    "--window=" + window,
    "--market=" + market,
    "--symbol-limit=" + symbolLimit,
    "--skip-train",
    "--stopAfter=" + stopAfter,
    "--no-kis",
    "--mode=" + mode,
    "--minCoverage=0.985",
    "--minTradingDays=16",
    "--minUniverseSize=1",
    "--signalWindowTradingDays=28",
    "--requireSignals=1",
    "--minSignalsLoaded=1",
    "--strict=1",
  ]
}

const normalizeDataSyncCommand = ({ command, tier }) => {
  const list = normalizeCommandItems(command)
  if (list.length < 2) {
    return String(tier ?? "FULL").toUpperCase() === "DAILY"
      ? [...DEFAULT_DATA_SYNC_DAILY_COMMAND]
      : [...DEFAULT_DATA_SYNC_FULL_COMMAND]
  }
  if (isLegacyDataFillCommand(list)) {
    return buildOrchestratorCommandFromLegacy({ command: list, tier })
  }
  return list
}

export const normalizeTuning = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const executionLaneRaw = String(
    source.executionLane ?? DEFAULT_TUNING.executionLane,
  )
    .trim()
    .toLowerCase()
  const executionLane =
    executionLaneRaw === "codex_cloud" ? "codex_cloud" : "server"
  const isCodexCloudLane = executionLane === "codex_cloud"
  const laneMaxInt = isCodexCloudLane ? Number.MAX_SAFE_INTEGER : null
  const maxParallelShardsCap = isCodexCloudLane ? laneMaxInt : 2
  const maxWorkersCap = isCodexCloudLane ? laneMaxInt : 2
  const stage2ConcurrencyCap = isCodexCloudLane ? laneMaxInt : 1
  const poolsetBatchCap = isCodexCloudLane ? laneMaxInt : 16
  const limitsMaxShardsCap = isCodexCloudLane ? laneMaxInt : 64
  const limitsMaxTopPerTrackCap = isCodexCloudLane ? laneMaxInt : 1000
  const poolActiveCap = isCodexCloudLane ? laneMaxInt : 64
  const poolBenchCap = isCodexCloudLane ? laneMaxInt : 256
  const poolMinAliveCap = isCodexCloudLane ? laneMaxInt : 64
  const poolRefillCap = isCodexCloudLane ? laneMaxInt : 64
  const stage2TopKCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetCountCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetCountMaxCap = isCodexCloudLane ? laneMaxInt : 96
  const poolsetActiveCap = isCodexCloudLane ? laneMaxInt : 32
  const poolsetBenchCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetMinAliveCap = isCodexCloudLane ? laneMaxInt : 16
  const poolsetRefillCap = isCodexCloudLane ? laneMaxInt : 16
  const speedProfileTopKCap = isCodexCloudLane ? laneMaxInt : 64
  const dailyPassPoolsetCountCap = isCodexCloudLane ? laneMaxInt : 32
  const dailyPassRecombineRoundsCap = isCodexCloudLane ? laneMaxInt : 5
  const limitsInput =
    source.limits && typeof source.limits === "object" ? source.limits : {}
  const limits = {
    minShards: clampInt(
      limitsInput.minShards,
      DEFAULT_TUNING.limits.minShards,
      1,
      32,
    ),
    maxShards: clampInt(
      limitsInput.maxShards,
      DEFAULT_TUNING.limits.maxShards,
      1,
      limitsMaxShardsCap,
    ),
    minTopPerTrack: clampInt(
      limitsInput.minTopPerTrack,
      DEFAULT_TUNING.limits.minTopPerTrack,
      1,
      500,
    ),
    maxTopPerTrack: clampInt(
      limitsInput.maxTopPerTrack,
      DEFAULT_TUNING.limits.maxTopPerTrack,
      1,
      limitsMaxTopPerTrackCap,
    ),
    maxStage1MaxRounds: clampInt(
      limitsInput.maxStage1MaxRounds,
      DEFAULT_TUNING.limits.maxStage1MaxRounds,
      10,
      10000,
    ),
    maxStage2MaxRounds: clampInt(
      limitsInput.maxStage2MaxRounds,
      DEFAULT_TUNING.limits.maxStage2MaxRounds,
      10,
      10000,
    ),
  }
  const minShards = Math.min(limits.minShards, limits.maxShards)
  const maxShards = Math.max(limits.minShards, limits.maxShards)
  const minTopPerTrack = Math.min(limits.minTopPerTrack, limits.maxTopPerTrack)
  const maxTopPerTrack = Math.max(limits.minTopPerTrack, limits.maxTopPerTrack)

  const envOverridesInput =
    source.envOverrides && typeof source.envOverrides === "object"
      ? source.envOverrides
      : {}
  const envOverrides = Object.fromEntries(
    Object.entries(envOverridesInput)
      .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
      .filter(([key]) => key.length > 0),
  )
  if (!("NO_KIS" in envOverrides)) {
    envOverrides.NO_KIS = "1"
  }
  if (!("BACKFILL_DISABLE_KIS" in envOverrides)) {
    envOverrides.BACKFILL_DISABLE_KIS = "1"
  }
  if (!("BACKFILL_KIS_ENABLED" in envOverrides)) {
    envOverrides.BACKFILL_KIS_ENABLED = "0"
  }
  if (!("GOLIVE_MAX_RULE_CANDIDATES" in envOverrides)) {
    envOverrides.GOLIVE_MAX_RULE_CANDIDATES = isCodexCloudLane
      ? "1000000"
      : "25000"
  }
  if (!("GOLIVE_MAX_CANDIDATE_COUNT" in envOverrides)) {
    envOverrides.GOLIVE_MAX_CANDIDATE_COUNT = isCodexCloudLane
      ? "100000"
      : "700"
  }
  if (!("GOLIVE_MAX_SHAPE_K" in envOverrides)) {
    envOverrides.GOLIVE_MAX_SHAPE_K = isCodexCloudLane ? "200000" : "1400"
  }
  if (!("GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK" in envOverrides)) {
    envOverrides.GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK = "1"
  }
  if (!("CORP_ACTIONS_YAHOO_CONCURRENCY" in envOverrides)) {
    envOverrides.CORP_ACTIONS_YAHOO_CONCURRENCY = "6"
  }
  if (!("CORP_ACTIONS_YAHOO_RPS" in envOverrides)) {
    envOverrides.CORP_ACTIONS_YAHOO_RPS = "3"
  }
  if (!("CORP_ACTIONS_YAHOO_BURST" in envOverrides)) {
    envOverrides.CORP_ACTIONS_YAHOO_BURST = "6"
  }

  const dataSyncCommandInput = normalizeCommandItems(source.dataSyncCommand)
  const dataSyncCommand = normalizeDataSyncCommand({
    command:
      dataSyncCommandInput.length >= 2
        ? dataSyncCommandInput
        : [...DEFAULT_DATA_SYNC_COMMAND],
    tier: "FULL",
  })
  const dataSyncFullCommandInput = normalizeCommandItems(
    source.dataSyncFullCommand,
  )
  const dataSyncFullCommand = normalizeDataSyncCommand({
    command:
      dataSyncFullCommandInput.length >= 2
        ? dataSyncFullCommandInput
        : [...DEFAULT_DATA_SYNC_FULL_COMMAND],
    tier: "FULL",
  })
  const dataSyncDailyCommandInput = normalizeCommandItems(
    source.dataSyncDailyCommand,
  )
  const dataSyncDailyCommand = normalizeDataSyncCommand({
    command:
      dataSyncDailyCommandInput.length >= 2
        ? dataSyncDailyCommandInput
        : [...DEFAULT_DATA_SYNC_DAILY_COMMAND],
    tier: "DAILY",
  })
  const deriveCommand = Array.isArray(source.deriveCommand)
    ? source.deriveCommand.map((item) => String(item ?? "")).filter(Boolean)
    : []
  const timeoutsInput =
    source.timeoutsMs && typeof source.timeoutsMs === "object"
      ? source.timeoutsMs
      : {}
  const timeoutsMs = {
    dataSync: clampInt(
      timeoutsInput.dataSync,
      DEFAULT_TIMEOUTS_MS.dataSync,
      0,
      48 * 60 * 60 * 1000,
    ),
    derive: clampInt(
      timeoutsInput.derive,
      DEFAULT_TIMEOUTS_MS.derive,
      0,
      48 * 60 * 60 * 1000,
    ),
    signalPreflight: clampInt(
      timeoutsInput.signalPreflight,
      DEFAULT_TIMEOUTS_MS.signalPreflight,
      0,
      8 * 60 * 60 * 1000,
    ),
    trainValidate: clampInt(
      timeoutsInput.trainValidate,
      DEFAULT_TIMEOUTS_MS.trainValidate,
      0,
      48 * 60 * 60 * 1000,
    ),
    deployApply: clampInt(
      timeoutsInput.deployApply,
      DEFAULT_TIMEOUTS_MS.deployApply,
      0,
      48 * 60 * 60 * 1000,
    ),
    verify: clampInt(
      timeoutsInput.verify,
      DEFAULT_TIMEOUTS_MS.verify,
      0,
      8 * 60 * 60 * 1000,
    ),
  }
  const ruleAutoTuneInput =
    source.ruleAutoTune && typeof source.ruleAutoTune === "object"
      ? source.ruleAutoTune
      : {}
  const ruleAutoTune = {
    enabled: parseBoolean(
      ruleAutoTuneInput.enabled,
      DEFAULT_RULE_AUTO_TUNE.enabled,
    ),
    triggerFailureStreak: clampInt(
      ruleAutoTuneInput.triggerFailureStreak,
      DEFAULT_RULE_AUTO_TUNE.triggerFailureStreak,
      1,
      50,
    ),
    worst2wStep: clampNumber(
      ruleAutoTuneInput.worst2wStep,
      DEFAULT_RULE_AUTO_TUNE.worst2wStep,
      0.01,
      5,
    ),
    minWorst2wAvgPctFloor: clampNumber(
      ruleAutoTuneInput.minWorst2wAvgPctFloor,
      DEFAULT_RULE_AUTO_TUNE.minWorst2wAvgPctFloor,
      -50,
      50,
    ),
    requireMaxTargetStep: clampInt(
      ruleAutoTuneInput.requireMaxTargetStep,
      DEFAULT_RULE_AUTO_TUNE.requireMaxTargetStep,
      1,
      10,
    ),
    minRequireMaxTargetPassed: clampInt(
      ruleAutoTuneInput.minRequireMaxTargetPassed,
      DEFAULT_RULE_AUTO_TUNE.minRequireMaxTargetPassed,
      0,
      100,
    ),
  }
  const memoryGuardInput =
    source.memoryGuard && typeof source.memoryGuard === "object"
      ? source.memoryGuard
      : {}
  const memoryGuard = {
    enabled: parseBoolean(
      memoryGuardInput.enabled,
      DEFAULT_MEMORY_GUARD.enabled,
    ),
    minFreeRatio: clampNumber(
      memoryGuardInput.minFreeRatio,
      DEFAULT_MEMORY_GUARD.minFreeRatio,
      0.01,
      0.9,
    ),
    minFreeMb: clampInt(
      memoryGuardInput.minFreeMb,
      DEFAULT_MEMORY_GUARD.minFreeMb,
      128,
      32768,
    ),
    cooldownMs: clampInt(
      memoryGuardInput.cooldownMs,
      DEFAULT_MEMORY_GUARD.cooldownMs,
      0,
      24 * 60 * 60 * 1000,
    ),
  }

  const dataSyncModeRaw = String(
    source.dataSyncMode ?? DEFAULT_TUNING.dataSyncMode,
  )
    .trim()
    .toLowerCase()
  const dataSyncMode =
    dataSyncModeRaw === "legacy"
      ? "legacy"
      : dataSyncModeRaw === "weekly" || dataSyncModeRaw === "weekly_strict"
        ? "weekly_strict"
        : "smart"
  const signalGapRepairStopAfterRaw = String(
    source.signalGapRepairStopAfter ?? DEFAULT_TUNING.signalGapRepairStopAfter,
  )
    .trim()
    .toLowerCase()
  const signalGapRepairStopAfter =
    signalGapRepairStopAfterRaw === "recommend" ? "recommend" : "derived"

  const normalized = {
    policyConflictResolution:
      String(
        source.policyConflictResolution ??
          DEFAULT_TUNING.policyConflictResolution,
      )
        .trim()
        .toUpperCase() === "POOLSET_FIRST_STRICT"
        ? "POOLSET_FIRST_STRICT"
        : DEFAULT_TUNING.policyConflictResolution,
    version: String(source.version ?? DEFAULT_TUNING.version),
    executionLane,
    shards: clampInt(
      source.shards,
      DEFAULT_TUNING.shards,
      minShards,
      maxShards,
    ),
    topPerTrack: clampInt(
      source.topPerTrack,
      DEFAULT_TUNING.topPerTrack,
      minTopPerTrack,
      maxTopPerTrack,
    ),
    seedStart: clampInt(
      source.seedStart,
      DEFAULT_TUNING.seedStart,
      1,
      1_000_000_000,
    ),
    symbolSeedBase: String(
      source.symbolSeedBase ?? DEFAULT_TUNING.symbolSeedBase,
    )
      .trim()
      .slice(0, 64),
    symbolBucketTotal: clampInt(
      source.symbolBucketTotal,
      DEFAULT_TUNING.symbolBucketTotal,
      1,
      1024,
    ),
    symbolBucketStride: clampInt(
      source.symbolBucketStride,
      DEFAULT_TUNING.symbolBucketStride,
      1,
      128,
    ),
    coverageSeedLanes: clampInt(
      source.coverageSeedLanes,
      DEFAULT_TUNING.coverageSeedLanes,
      1,
      32,
    ),
    sameFailureSignatureJumpThreshold: clampInt(
      source.sameFailureSignatureJumpThreshold,
      DEFAULT_TUNING.sameFailureSignatureJumpThreshold,
      2,
      50,
    ),
    sameFailureSignatureCursorMultiplier: clampInt(
      source.sameFailureSignatureCursorMultiplier,
      DEFAULT_TUNING.sameFailureSignatureCursorMultiplier,
      2,
      32,
    ),
    failureFingerprintCarryLimit: clampInt(
      source.failureFingerprintCarryLimit,
      DEFAULT_TUNING.failureFingerprintCarryLimit,
      0,
      20_000,
    ),
    explorationBanditEnabled: parseBoolean(
      source.explorationBanditEnabled,
      DEFAULT_TUNING.explorationBanditEnabled,
    ),
    explorationBanditUcbC: clampNumber(
      source.explorationBanditUcbC,
      DEFAULT_TUNING.explorationBanditUcbC,
      0.05,
      4,
    ),
    explorationBanditPriorMean: clampNumber(
      source.explorationBanditPriorMean,
      DEFAULT_TUNING.explorationBanditPriorMean,
      -5,
      5,
    ),
    explorationBanditPriorWeight: clampInt(
      source.explorationBanditPriorWeight,
      DEFAULT_TUNING.explorationBanditPriorWeight,
      0,
      500,
    ),
    explorationBanditMinSamples: clampInt(
      source.explorationBanditMinSamples,
      DEFAULT_TUNING.explorationBanditMinSamples,
      1,
      1000,
    ),
    runtimeBudgetBiasEnabled: parseBoolean(
      source.runtimeBudgetBiasEnabled,
      DEFAULT_TUNING.runtimeBudgetBiasEnabled,
    ),
    runtimeBudgetBiasMin: clampNumber(
      source.runtimeBudgetBiasMin,
      DEFAULT_TUNING.runtimeBudgetBiasMin,
      0.4,
      1,
    ),
    runtimeBudgetBiasMax: clampNumber(
      source.runtimeBudgetBiasMax,
      DEFAULT_TUNING.runtimeBudgetBiasMax,
      1,
      2,
    ),
    prefilterEnabled: parseBoolean(
      source.prefilterEnabled,
      DEFAULT_TUNING.prefilterEnabled,
    ),
    prefilterWorst2wBuffer: clampNumber(
      source.prefilterWorst2wBuffer,
      DEFAULT_TUNING.prefilterWorst2wBuffer,
      0,
      40,
    ),
    prefilterStopLikeCeil: clampNumber(
      source.prefilterStopLikeCeil,
      DEFAULT_TUNING.prefilterStopLikeCeil,
      0.01,
      1,
    ),
    prefilterNoFillCeil: clampNumber(
      source.prefilterNoFillCeil,
      DEFAULT_TUNING.prefilterNoFillCeil,
      0.01,
      1,
    ),
    allowUnsafeGapChartFallbackStage1: parseBoolean(
      source.allowUnsafeGapChartFallbackStage1,
      DEFAULT_TUNING.allowUnsafeGapChartFallbackStage1,
    ),
    applyAfterDryPassStreak: clampInt(
      source.applyAfterDryPassStreak,
      DEFAULT_TUNING.applyAfterDryPassStreak,
      1,
      20,
    ),
    maxParallelShards: clampInt(
      source.maxParallelShards ?? source.maxWorkers,
      DEFAULT_TUNING.maxParallelShards,
      1,
      maxParallelShardsCap,
    ),
    maxWorkers: clampInt(
      source.maxWorkers ?? source.maxParallelShards,
      DEFAULT_TUNING.maxWorkers,
      1,
      maxWorkersCap,
    ),
    minFreeMbForParallelShards: clampInt(
      source.minFreeMbForParallelShards,
      DEFAULT_TUNING.minFreeMbForParallelShards,
      512,
      65536,
    ),
    stage1MaxRounds: clampInt(
      source.stage1MaxRounds,
      DEFAULT_TUNING.stage1MaxRounds,
      10,
      limits.maxStage1MaxRounds,
    ),
    stage2MaxRounds: clampInt(
      source.stage2MaxRounds,
      DEFAULT_TUNING.stage2MaxRounds,
      10,
      limits.maxStage2MaxRounds,
    ),
    stage1PlateauRounds: clampInt(
      source.stage1PlateauRounds,
      DEFAULT_TUNING.stage1PlateauRounds,
      5,
      5000,
    ),
    stage2PlateauRounds: clampInt(
      source.stage2PlateauRounds,
      DEFAULT_TUNING.stage2PlateauRounds,
      5,
      5000,
    ),
    printEvery: clampInt(
      source.printEvery,
      DEFAULT_TUNING.printEvery,
      1,
      1_000_000,
    ),
    retryBackoffMs: clampInt(
      source.retryBackoffMs,
      DEFAULT_TUNING.retryBackoffMs,
      0,
      24 * 60 * 60 * 1000,
    ),
    maxAttempts: clampInt(
      source.maxAttempts,
      DEFAULT_TUNING.maxAttempts,
      1,
      100_000,
    ),
    sameFailureLimit: clampInt(
      source.sameFailureLimit,
      DEFAULT_TUNING.sameFailureLimit,
      1,
      1000,
    ),
    structuralRecoveryLimit: clampInt(
      source.structuralRecoveryLimit,
      DEFAULT_TUNING.structuralRecoveryLimit,
      0,
      3,
    ),
    qualityRecoveryLimit: clampInt(
      source.qualityRecoveryLimit,
      DEFAULT_TUNING.qualityRecoveryLimit,
      0,
      3,
    ),
    transientRetryLimit: clampInt(
      source.transientRetryLimit,
      DEFAULT_TUNING.transientRetryLimit,
      1,
      20,
    ),
    qualityCollapseResetEnabled: parseBoolean(
      source.qualityCollapseResetEnabled,
      DEFAULT_TUNING.qualityCollapseResetEnabled,
    ),
    qualityCollapseResetStreak: clampInt(
      source.qualityCollapseResetStreak,
      DEFAULT_TUNING.qualityCollapseResetStreak,
      2,
      1000,
    ),
    qualityCollapseResetLimit: clampInt(
      source.qualityCollapseResetLimit,
      DEFAULT_TUNING.qualityCollapseResetLimit,
      0,
      10,
    ),
    dataSyncFailMaxConsecutive: clampInt(
      source.dataSyncFailMaxConsecutive,
      DEFAULT_TUNING.dataSyncFailMaxConsecutive,
      1,
      1000,
    ),
    insufficientPoolRecycleLimit: clampInt(
      source.insufficientPoolRecycleLimit,
      DEFAULT_TUNING.insufficientPoolRecycleLimit,
      0,
      1000,
    ),
    poolEmptyMaxConsecutive: clampInt(
      source.poolEmptyMaxConsecutive,
      DEFAULT_TUNING.poolEmptyMaxConsecutive,
      0,
      1000,
    ),
    maxRuntimeMinutes: clampInt(
      source.maxRuntimeMinutes,
      DEFAULT_TUNING.maxRuntimeMinutes,
      1,
      14 * 24 * 60,
    ),
    runLockStaleMs: clampInt(
      source.runLockStaleMs,
      DEFAULT_TUNING.runLockStaleMs,
      60_000,
      24 * 60 * 60 * 1000,
    ),
    runLockAcquireRetries: clampInt(
      source.runLockAcquireRetries,
      DEFAULT_TUNING.runLockAcquireRetries,
      0,
      120,
    ),
    runLockRetryDelayMs: clampInt(
      source.runLockRetryDelayMs,
      DEFAULT_TUNING.runLockRetryDelayMs,
      1000,
      60_000,
    ),
    runLockEnabled: parseBoolean(
      source.runLockEnabled,
      DEFAULT_TUNING.runLockEnabled,
    ),
    preflightEnabled: parseBoolean(
      source.preflightEnabled,
      DEFAULT_TUNING.preflightEnabled,
    ),
    preflightSignalWindowTradingDays: clampInt(
      source.preflightSignalWindowTradingDays,
      DEFAULT_TUNING.preflightSignalWindowTradingDays,
      1,
      252,
    ),
    preflightMinTradingDays: clampInt(
      source.preflightMinTradingDays,
      DEFAULT_TUNING.preflightMinTradingDays,
      1,
      252,
    ),
    preflightMinWeekCount: clampInt(
      source.preflightMinWeekCount,
      DEFAULT_TUNING.preflightMinWeekCount,
      1,
      104,
    ),
    preflightMinUniverseSize: clampInt(
      source.preflightMinUniverseSize,
      DEFAULT_TUNING.preflightMinUniverseSize,
      1,
      1000000,
    ),
    preflightMinSignalsLoaded: clampInt(
      source.preflightMinSignalsLoaded,
      DEFAULT_TUNING.preflightMinSignalsLoaded,
      1,
      1_000_000,
    ),
    preflightRequireQualifiedSignals: parseBoolean(
      source.preflightRequireQualifiedSignals,
      DEFAULT_TUNING.preflightRequireQualifiedSignals,
    ),
    preflightMinQualifiedSignals: clampInt(
      source.preflightMinQualifiedSignals,
      DEFAULT_TUNING.preflightMinQualifiedSignals,
      0,
      1_000_000,
    ),
    allowStage2OnLowQualityRequiredDry: parseBoolean(
      source.allowStage2OnLowQualityRequiredDry,
      DEFAULT_TUNING.allowStage2OnLowQualityRequiredDry,
    ),
    disableStage2OnLowQualityRequiredDryOnZeroPass: parseBoolean(
      source.disableStage2OnLowQualityRequiredDryOnZeroPass,
      DEFAULT_TUNING.disableStage2OnLowQualityRequiredDryOnZeroPass,
    ),
    precheckStructuralRecoveryAttempts: clampInt(
      source.precheckStructuralRecoveryAttempts,
      DEFAULT_TUNING.precheckStructuralRecoveryAttempts,
      0,
      3,
    ),
    precheckRequireCleanGit: parseBoolean(
      source.precheckRequireCleanGit,
      DEFAULT_TUNING.precheckRequireCleanGit,
    ),
    precheckBlockOnSecretFiles: parseBoolean(
      source.precheckBlockOnSecretFiles,
      DEFAULT_TUNING.precheckBlockOnSecretFiles,
    ),
    quarantineEnabled: parseBoolean(
      source.quarantineEnabled,
      DEFAULT_TUNING.quarantineEnabled,
    ),
    quarantineFailThreshold: clampInt(
      source.quarantineFailThreshold,
      DEFAULT_TUNING.quarantineFailThreshold,
      2,
      100,
    ),
    quarantineTtlMinutes: clampInt(
      source.quarantineTtlMinutes,
      DEFAULT_TUNING.quarantineTtlMinutes,
      1,
      60 * 24 * 30,
    ),
    quarantineTtlByFailureType: {
      STRUCTURAL: clampInt(
        source.quarantineTtlByFailureType?.STRUCTURAL,
        DEFAULT_TUNING.quarantineTtlByFailureType.STRUCTURAL,
        60,
        60 * 60 * 24 * 30,
      ),
      QUALITY: clampInt(
        source.quarantineTtlByFailureType?.QUALITY,
        DEFAULT_TUNING.quarantineTtlByFailureType.QUALITY,
        60,
        60 * 60 * 24 * 30,
      ),
      TRANSIENT: clampInt(
        source.quarantineTtlByFailureType?.TRANSIENT,
        DEFAULT_TUNING.quarantineTtlByFailureType.TRANSIENT,
        60,
        60 * 60 * 24 * 30,
      ),
    },
    quarantineMaxEntries: clampInt(
      source.quarantineMaxEntries,
      DEFAULT_TUNING.quarantineMaxEntries,
      1,
      100_000,
    ),
    autotuneAllowlist: (() => {
      const list = normalizeStringList(
        source.autotuneAllowlist ?? DEFAULT_TUNING.autotuneAllowlist,
      )
      const merged = Array.from(
        new Set([...list, ...DEFAULT_AUTOTUNE_ALLOWLIST]),
      )
      return merged.length > 0 ? merged : [...DEFAULT_TUNING.autotuneAllowlist]
    })(),
    autotuneMaxAdjustmentsPerRun: clampInt(
      source.autotuneMaxAdjustmentsPerRun,
      DEFAULT_TUNING.autotuneMaxAdjustmentsPerRun,
      1,
      100,
    ),
    autotuneDeterministic: parseBoolean(
      source.autotuneDeterministic,
      DEFAULT_TUNING.autotuneDeterministic,
    ),
    rescueEnabled: parseBoolean(
      source.rescueEnabled,
      DEFAULT_TUNING.rescueEnabled,
    ),
    rescueTopK: clampInt(source.rescueTopK, DEFAULT_TUNING.rescueTopK, 1, 5000),
    rescueCheapB: clampInt(
      source.rescueCheapB,
      DEFAULT_TUNING.rescueCheapB,
      20,
      20_000,
    ),
    rescueCheapM: clampInt(
      source.rescueCheapM,
      DEFAULT_TUNING.rescueCheapM,
      1,
      512,
    ),
    rescueDeepTopK: clampInt(
      source.rescueDeepTopK,
      DEFAULT_TUNING.rescueDeepTopK,
      1,
      5000,
    ),
    rescueDeepB: clampInt(
      source.rescueDeepB,
      DEFAULT_TUNING.rescueDeepB,
      20,
      50_000,
    ),
    rescueDeepM: clampInt(
      source.rescueDeepM,
      DEFAULT_TUNING.rescueDeepM,
      1,
      2048,
    ),
    rescueDeepAllowMoonshotDominant: parseBoolean(
      source.rescueDeepAllowMoonshotDominant,
      DEFAULT_TUNING.rescueDeepAllowMoonshotDominant,
    ),
    rescueAlpha: clampNumber(
      source.rescueAlpha,
      DEFAULT_TUNING.rescueAlpha,
      1e-6,
      0.5,
    ),
    rescueP0: clampNumber(
      source.rescueP0,
      DEFAULT_TUNING.rescueP0,
      0.5,
      0.9999,
    ),
    rescueLcbQuantile: clampNumber(
      source.rescueLcbQuantile,
      DEFAULT_TUNING.rescueLcbQuantile,
      0.01,
      0.5,
    ),
    policyEvalEnabled: parseBoolean(
      source.policyEvalEnabled,
      DEFAULT_TUNING.policyEvalEnabled,
    ),
    policyEvalTopKSurge: clampInt(
      source.policyEvalTopKSurge,
      DEFAULT_TUNING.policyEvalTopKSurge,
      1,
      200,
    ),
    policyEvalTopKGap: clampInt(
      source.policyEvalTopKGap,
      DEFAULT_TUNING.policyEvalTopKGap,
      1,
      200,
    ),
    policyEvalMinWeeks: clampInt(
      source.policyEvalMinWeeks,
      DEFAULT_TUNING.policyEvalMinWeeks,
      2,
      52,
    ),
    policyEvalLookbackWeeks: clampInt(
      source.policyEvalLookbackWeeks,
      DEFAULT_TUNING.policyEvalLookbackWeeks,
      1,
      16,
    ),
    policyEvalMinDistinctCandidates: clampInt(
      source.policyEvalMinDistinctCandidates,
      DEFAULT_TUNING.policyEvalMinDistinctCandidates,
      1,
      16,
    ),
    policyEvalMaxConsecutiveDays: clampInt(
      source.policyEvalMaxConsecutiveDays,
      DEFAULT_TUNING.policyEvalMaxConsecutiveDays,
      1,
      80,
    ),
    policyEvalMaxConsecutiveWeeks: clampInt(
      source.policyEvalMaxConsecutiveWeeks,
      DEFAULT_TUNING.policyEvalMaxConsecutiveWeeks,
      1,
      16,
    ),
    rescueEarlyExitEnabled: parseBoolean(
      source.rescueEarlyExitEnabled,
      DEFAULT_TUNING.rescueEarlyExitEnabled,
    ),
    rescueEarlyExitNoPassMinEval: clampInt(
      source.rescueEarlyExitNoPassMinEval,
      DEFAULT_TUNING.rescueEarlyExitNoPassMinEval,
      1,
      5000,
    ),
    rescueEarlyExitNoPassMaxEval: clampInt(
      source.rescueEarlyExitNoPassMaxEval,
      DEFAULT_TUNING.rescueEarlyExitNoPassMaxEval,
      1,
      5000,
    ),
    rescueEarlyExitMinEvalRatio: clampNumber(
      source.rescueEarlyExitMinEvalRatio,
      DEFAULT_TUNING.rescueEarlyExitMinEvalRatio,
      0,
      1,
    ),
    rescueEarlyExitTerminalReasonRatio: clampNumber(
      source.rescueEarlyExitTerminalReasonRatio,
      DEFAULT_TUNING.rescueEarlyExitTerminalReasonRatio,
      0.5,
      1,
    ),
    minPoolPerTrackSurge: clampInt(
      source.minPoolPerTrackSurge,
      DEFAULT_TUNING.minPoolPerTrackSurge,
      0,
      5000,
    ),
    minPoolPerTrackGap: clampInt(
      source.minPoolPerTrackGap,
      DEFAULT_TUNING.minPoolPerTrackGap,
      0,
      5000,
    ),
    minWorst2wPassPerTrackSurge: clampInt(
      source.minWorst2wPassPerTrackSurge,
      DEFAULT_TUNING.minWorst2wPassPerTrackSurge,
      0,
      5000,
    ),
    minWorst2wPassPerTrackGap: clampInt(
      source.minWorst2wPassPerTrackGap,
      DEFAULT_TUNING.minWorst2wPassPerTrackGap,
      0,
      5000,
    ),
    poolActiveLimitByTrack: {
      SURGE_EOD: clampInt(
        source.poolActiveLimitByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolActiveLimitByTrack.SURGE_EOD,
        1,
        poolActiveCap,
      ),
      GAP_15_BET: clampInt(
        source.poolActiveLimitByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolActiveLimitByTrack.GAP_15_BET,
        1,
        poolActiveCap,
      ),
      MOONSHOT: clampInt(
        source.poolActiveLimitByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolActiveLimitByTrack.MOONSHOT,
        1,
        poolActiveCap,
      ),
    },
    poolBenchLimitByTrack: {
      SURGE_EOD: clampInt(
        source.poolBenchLimitByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolBenchLimitByTrack.SURGE_EOD,
        0,
        poolBenchCap,
      ),
      GAP_15_BET: clampInt(
        source.poolBenchLimitByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolBenchLimitByTrack.GAP_15_BET,
        0,
        poolBenchCap,
      ),
      MOONSHOT: clampInt(
        source.poolBenchLimitByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolBenchLimitByTrack.MOONSHOT,
        0,
        poolBenchCap,
      ),
    },
    poolMinAliveByTrack: {
      SURGE_EOD: clampInt(
        source.poolMinAliveByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolMinAliveByTrack.SURGE_EOD,
        1,
        poolMinAliveCap,
      ),
      GAP_15_BET: clampInt(
        source.poolMinAliveByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolMinAliveByTrack.GAP_15_BET,
        1,
        poolMinAliveCap,
      ),
      MOONSHOT: clampInt(
        source.poolMinAliveByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolMinAliveByTrack.MOONSHOT,
        1,
        poolMinAliveCap,
      ),
    },
    poolRefillCountByTrack: {
      SURGE_EOD: clampInt(
        source.poolRefillCountByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolRefillCountByTrack.SURGE_EOD,
        1,
        poolRefillCap,
      ),
      GAP_15_BET: clampInt(
        source.poolRefillCountByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolRefillCountByTrack.GAP_15_BET,
        1,
        poolRefillCap,
      ),
      MOONSHOT: clampInt(
        source.poolRefillCountByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolRefillCountByTrack.MOONSHOT,
        1,
        poolRefillCap,
      ),
    },
    stage2TopKByTrack: {
      SURGE_EOD: clampInt(
        source.stage2TopKByTrack?.SURGE_EOD,
        DEFAULT_TUNING.stage2TopKByTrack.SURGE_EOD,
        isCodexCloudLane ? 1 : DEFAULT_TUNING.stage2TopKByTrack.SURGE_EOD,
        isCodexCloudLane
          ? stage2TopKCap
          : DEFAULT_TUNING.stage2TopKByTrack.SURGE_EOD,
      ),
      GAP_15_BET: clampInt(
        source.stage2TopKByTrack?.GAP_15_BET,
        DEFAULT_TUNING.stage2TopKByTrack.GAP_15_BET,
        isCodexCloudLane ? 1 : DEFAULT_TUNING.stage2TopKByTrack.GAP_15_BET,
        isCodexCloudLane
          ? stage2TopKCap
          : DEFAULT_TUNING.stage2TopKByTrack.GAP_15_BET,
      ),
      MOONSHOT: clampInt(
        source.stage2TopKByTrack?.MOONSHOT,
        DEFAULT_TUNING.stage2TopKByTrack.MOONSHOT,
        isCodexCloudLane ? 1 : DEFAULT_TUNING.stage2TopKByTrack.MOONSHOT,
        isCodexCloudLane
          ? stage2TopKCap
          : DEFAULT_TUNING.stage2TopKByTrack.MOONSHOT,
      ),
    },
    poolExpandEnabled: parseBoolean(
      source.poolExpandEnabled,
      DEFAULT_TUNING.poolExpandEnabled,
    ),
    poolExpandMinPassDensity: clampNumber(
      source.poolExpandMinPassDensity,
      DEFAULT_TUNING.poolExpandMinPassDensity,
      0,
      1,
    ),
    poolExpandMaxTerminalRatio: clampNumber(
      source.poolExpandMaxTerminalRatio,
      DEFAULT_TUNING.poolExpandMaxTerminalRatio,
      0,
      1,
    ),
    poolExpandStepTopPerTrack: clampInt(
      source.poolExpandStepTopPerTrack,
      DEFAULT_TUNING.poolExpandStepTopPerTrack,
      1,
      128,
    ),
    poolExpandCapTopPerTrack: clampInt(
      source.poolExpandCapTopPerTrack,
      DEFAULT_TUNING.poolExpandCapTopPerTrack,
      1,
      1000,
    ),
    poolExpandCapStage2TopK: clampInt(
      source.poolExpandCapStage2TopK,
      DEFAULT_TUNING.poolExpandCapStage2TopK,
      1,
      128,
    ),
    adaptivePoolTuningMode:
      String(
        source.adaptivePoolTuningMode ?? DEFAULT_TUNING.adaptivePoolTuningMode,
      )
        .trim()
        .toUpperCase() === "OFF"
        ? "OFF"
        : "AUTO",
    previousPassDensity: clampNumber(
      source.previousPassDensity,
      DEFAULT_TUNING.previousPassDensity,
      0,
      1,
    ),
    previousTerminalRatio: clampNumber(
      source.previousTerminalRatio,
      DEFAULT_TUNING.previousTerminalRatio,
      0,
      1,
    ),
    poolsetEnabled: parseBoolean(
      source.poolsetEnabled,
      DEFAULT_TUNING.poolsetEnabled,
    ),
    poolsetCountByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetCountByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetCountByTrack.SURGE_EOD,
        1,
        poolsetCountCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetCountByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetCountByTrack.GAP_15_BET,
        1,
        poolsetCountCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetCountByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetCountByTrack.MOONSHOT,
        1,
        poolsetCountCap,
      ),
    },
    poolsetCountMaxByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetCountMaxByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetCountMaxByTrack.SURGE_EOD,
        1,
        poolsetCountMaxCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetCountMaxByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetCountMaxByTrack.GAP_15_BET,
        1,
        poolsetCountMaxCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetCountMaxByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetCountMaxByTrack.MOONSHOT,
        1,
        poolsetCountMaxCap,
      ),
    },
    poolsetActiveSizeByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetActiveSizeByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetActiveSizeByTrack.SURGE_EOD,
        1,
        poolsetActiveCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetActiveSizeByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetActiveSizeByTrack.GAP_15_BET,
        1,
        poolsetActiveCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetActiveSizeByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetActiveSizeByTrack.MOONSHOT,
        1,
        poolsetActiveCap,
      ),
    },
    poolsetBenchSizeByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetBenchSizeByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetBenchSizeByTrack.SURGE_EOD,
        0,
        poolsetBenchCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetBenchSizeByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetBenchSizeByTrack.GAP_15_BET,
        0,
        poolsetBenchCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetBenchSizeByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetBenchSizeByTrack.MOONSHOT,
        0,
        poolsetBenchCap,
      ),
    },
    poolsetMinAliveByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetMinAliveByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetMinAliveByTrack.SURGE_EOD,
        1,
        poolsetMinAliveCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetMinAliveByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetMinAliveByTrack.GAP_15_BET,
        1,
        poolsetMinAliveCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetMinAliveByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetMinAliveByTrack.MOONSHOT,
        1,
        poolsetMinAliveCap,
      ),
    },
    poolsetRefillCountByTrack: {
      SURGE_EOD: clampInt(
        source.poolsetRefillCountByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolsetRefillCountByTrack.SURGE_EOD,
        1,
        poolsetRefillCap,
      ),
      GAP_15_BET: clampInt(
        source.poolsetRefillCountByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolsetRefillCountByTrack.GAP_15_BET,
        1,
        poolsetRefillCap,
      ),
      MOONSHOT: clampInt(
        source.poolsetRefillCountByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolsetRefillCountByTrack.MOONSHOT,
        1,
        poolsetRefillCap,
      ),
    },
    poolsetMaxConcurrentEval: clampInt(
      source.poolsetMaxConcurrentEval ?? source.stage2EvalConcurrency,
      DEFAULT_TUNING.poolsetMaxConcurrentEval,
      1,
      stage2ConcurrencyCap,
    ),
    stage2EvalConcurrency: clampInt(
      source.stage2EvalConcurrency ?? source.poolsetMaxConcurrentEval,
      DEFAULT_TUNING.stage2EvalConcurrency,
      1,
      stage2ConcurrencyCap,
    ),
    poolsetBatchSize: clampInt(
      source.poolsetBatchSize,
      DEFAULT_TUNING.poolsetBatchSize,
      1,
      poolsetBatchCap,
    ),
    stage2ResultCacheEnabled: parseBoolean(
      source.stage2ResultCacheEnabled,
      DEFAULT_TUNING.stage2ResultCacheEnabled,
    ),
    stage2ResultCacheTtlSec: clampInt(
      source.stage2ResultCacheTtlSec,
      DEFAULT_TUNING.stage2ResultCacheTtlSec,
      60,
      30 * 24 * 60 * 60,
    ),
    stage2SkipDuplicatePoolSetSignature: parseBoolean(
      source.stage2SkipDuplicatePoolSetSignature,
      DEFAULT_TUNING.stage2SkipDuplicatePoolSetSignature,
    ),
    stage2ScheduleMode:
      String(source.stage2ScheduleMode ?? DEFAULT_TUNING.stage2ScheduleMode)
        .trim()
        .toLowerCase() === "fifo"
        ? "fifo"
        : "champion_first",
    stage2ContinueAfterFirstPass: parseBoolean(
      source.stage2ContinueAfterFirstPass,
      DEFAULT_TUNING.stage2ContinueAfterFirstPass,
    ),
    poolsetStage1WindowMonths: clampInt(
      source.poolsetStage1WindowMonths,
      DEFAULT_TUNING.poolsetStage1WindowMonths,
      1,
      12,
    ),
    poolsetStage2WindowMonths: clampInt(
      source.poolsetStage2WindowMonths,
      DEFAULT_TUNING.poolsetStage2WindowMonths,
      1,
      12,
    ),
    poolsetEvalMode:
      String(source.poolsetEvalMode ?? DEFAULT_TUNING.poolsetEvalMode)
        .trim()
        .toLowerCase() === "daily_router_8m"
        ? "daily_router_8m"
        : DEFAULT_TUNING.poolsetEvalMode,
    dailyPassAvengersEnabled: parseBoolean(
      source.dailyPassAvengersEnabled,
      DEFAULT_TUNING.dailyPassAvengersEnabled,
    ),
    dailyPassTopNByTrack: {
      SURGE_EOD: clampInt(
        source.dailyPassTopNByTrack?.SURGE_EOD,
        DEFAULT_TUNING.dailyPassTopNByTrack.SURGE_EOD,
        1,
        5000,
      ),
      GAP_15_BET: clampInt(
        source.dailyPassTopNByTrack?.GAP_15_BET,
        DEFAULT_TUNING.dailyPassTopNByTrack.GAP_15_BET,
        1,
        5000,
      ),
      MOONSHOT: clampInt(
        source.dailyPassTopNByTrack?.MOONSHOT,
        DEFAULT_TUNING.dailyPassTopNByTrack.MOONSHOT,
        1,
        5000,
      ),
    },
    dailyPassPoolsetCountByTrack: {
      SURGE_EOD: clampInt(
        source.dailyPassPoolsetCountByTrack?.SURGE_EOD,
        DEFAULT_TUNING.dailyPassPoolsetCountByTrack.SURGE_EOD,
        1,
        dailyPassPoolsetCountCap,
      ),
      GAP_15_BET: clampInt(
        source.dailyPassPoolsetCountByTrack?.GAP_15_BET,
        DEFAULT_TUNING.dailyPassPoolsetCountByTrack.GAP_15_BET,
        1,
        dailyPassPoolsetCountCap,
      ),
      MOONSHOT: clampInt(
        source.dailyPassPoolsetCountByTrack?.MOONSHOT,
        DEFAULT_TUNING.dailyPassPoolsetCountByTrack.MOONSHOT,
        1,
        dailyPassPoolsetCountCap,
      ),
    },
    dailyPassRecombineRounds: clampInt(
      source.dailyPassRecombineRounds,
      DEFAULT_TUNING.dailyPassRecombineRounds,
      1,
      dailyPassRecombineRoundsCap,
    ),
    moonshotRecommendEnabled: parseBoolean(
      source.moonshotRecommendEnabled,
      DEFAULT_TUNING.moonshotRecommendEnabled,
    ),
    moonshotTrackRequiredForCorePass: parseBoolean(
      source.moonshotTrackRequiredForCorePass,
      DEFAULT_TUNING.moonshotTrackRequiredForCorePass,
    ),
    championDiscoveryBudgetSplit: normalizeChampionDiscoveryBudgetSplit(
      source.championDiscoveryBudgetSplit,
      DEFAULT_TUNING.championDiscoveryBudgetSplit,
    ),
    requirementEvidenceEnabled: parseBoolean(
      source.requirementEvidenceEnabled,
      DEFAULT_TUNING.requirementEvidenceEnabled,
    ),
    policyDocSyncEnabled: parseBoolean(
      source.policyDocSyncEnabled,
      DEFAULT_TUNING.policyDocSyncEnabled,
    ),
    poolEngineQuotaByTrack: {
      SURGE_EOD: normalizeEngineQuotaPair(
        source.poolEngineQuotaByTrack?.SURGE_EOD,
        DEFAULT_TUNING.poolEngineQuotaByTrack.SURGE_EOD,
      ),
      GAP_15_BET: normalizeEngineQuotaPair(
        source.poolEngineQuotaByTrack?.GAP_15_BET,
        DEFAULT_TUNING.poolEngineQuotaByTrack.GAP_15_BET,
      ),
      MOONSHOT: normalizeEngineQuotaPair(
        source.poolEngineQuotaByTrack?.MOONSHOT,
        DEFAULT_TUNING.poolEngineQuotaByTrack.MOONSHOT,
      ),
    },
    routerUseRegime: parseBoolean(
      source.routerUseRegime,
      DEFAULT_TUNING.routerUseRegime,
    ),
    routerRequireTrainRangeValid: parseBoolean(
      source.routerRequireTrainRangeValid,
      DEFAULT_TUNING.routerRequireTrainRangeValid,
    ),
    routerRecencyHalfLifeDays: clampInt(
      source.routerRecencyHalfLifeDays,
      DEFAULT_TUNING.routerRecencyHalfLifeDays,
      1,
      365,
    ),
    routerMode1500Track: normalizeRecommendationTracks(
      source.routerMode1500Track,
      DEFAULT_TUNING.routerMode1500Track,
      ["GAP_15_BET"],
    ),
    routerModeCloseTrack: normalizeRecommendationTracks(
      source.routerModeCloseTrack,
      DEFAULT_TUNING.routerModeCloseTrack,
      ["SURGE_EOD", "MOONSHOT"],
    ),
    routerCloseDecisionTimeKST: DEFAULT_TUNING.routerCloseDecisionTimeKST,
    maxRecommendationPerTrack: clampInt(
      source.maxRecommendationPerTrack,
      DEFAULT_TUNING.maxRecommendationPerTrack,
      1,
      1,
    ),
    keepZeroWhenNoMatch: true,
    moonshotMaxPicksPerDay: clampInt(
      source.moonshotMaxPicksPerDay,
      DEFAULT_TUNING.moonshotMaxPicksPerDay,
      DEFAULT_TUNING.moonshotMaxPicksPerDay,
      DEFAULT_TUNING.moonshotMaxPicksPerDay,
    ),
    moonshotDiagnosticsMaxRows: clampInt(
      source.moonshotDiagnosticsMaxRows,
      DEFAULT_TUNING.moonshotDiagnosticsMaxRows,
      0,
      1024,
    ),
    moonshotOutcomeEmptyFailEnabled: parseBoolean(
      source.moonshotOutcomeEmptyFailEnabled,
      DEFAULT_TUNING.moonshotOutcomeEmptyFailEnabled,
    ),
    moonshotOutcomeEmptyMinSamples: clampInt(
      source.moonshotOutcomeEmptyMinSamples,
      DEFAULT_TUNING.moonshotOutcomeEmptyMinSamples,
      1,
      256,
    ),
    moonshotSignalMismatchMaxGapDays: clampInt(
      source.moonshotSignalMismatchMaxGapDays,
      DEFAULT_TUNING.moonshotSignalMismatchMaxGapDays,
      0,
      3650,
    ),
    signalGapRepairEnabled: parseBoolean(
      source.signalGapRepairEnabled,
      DEFAULT_TUNING.signalGapRepairEnabled,
    ),
    signalGapRepairPaddingDays: clampInt(
      source.signalGapRepairPaddingDays,
      DEFAULT_TUNING.signalGapRepairPaddingDays,
      0,
      120,
    ),
    signalGapRepairFromDateKey: normalizeDateKeyToken(
      source.signalGapRepairFromDateKey,
    ),
    signalGapRepairToDateKey: normalizeDateKeyToken(
      source.signalGapRepairToDateKey,
    ),
    signalGapRepairStopAfter,
    dataSyncEnabled: parseBoolean(
      source.dataSyncEnabled,
      DEFAULT_TUNING.dataSyncEnabled,
    ),
    dataSyncTradingDayOnly: parseBoolean(
      source.dataSyncTradingDayOnly,
      DEFAULT_TUNING.dataSyncTradingDayOnly,
    ),
    dataSyncOncePerTradingDay: parseBoolean(
      source.dataSyncOncePerTradingDay,
      DEFAULT_TUNING.dataSyncOncePerTradingDay,
    ),
    dataSyncSkipRetryAttempts: parseBoolean(
      source.dataSyncSkipRetryAttempts,
      DEFAULT_TUNING.dataSyncSkipRetryAttempts,
    ),
    speedProfileEnabled: parseBoolean(
      source.speedProfileEnabled,
      DEFAULT_TUNING.speedProfileEnabled,
    ),
    speedProfileRequireParity: parseBoolean(
      source.speedProfileRequireParity,
      DEFAULT_TUNING.speedProfileRequireParity,
    ),
    speedProfileExpansionGuard: parseBoolean(
      source.speedProfileExpansionGuard,
      DEFAULT_TUNING.speedProfileExpansionGuard,
    ),
    speedProfileMaxStage2TopK: {
      SURGE_EOD: clampInt(
        source.speedProfileMaxStage2TopK?.SURGE_EOD,
        DEFAULT_TUNING.speedProfileMaxStage2TopK.SURGE_EOD,
        1,
        speedProfileTopKCap,
      ),
      GAP_15_BET: clampInt(
        source.speedProfileMaxStage2TopK?.GAP_15_BET,
        DEFAULT_TUNING.speedProfileMaxStage2TopK.GAP_15_BET,
        1,
        speedProfileTopKCap,
      ),
      MOONSHOT: clampInt(
        source.speedProfileMaxStage2TopK?.MOONSHOT,
        DEFAULT_TUNING.speedProfileMaxStage2TopK.MOONSHOT,
        1,
        speedProfileTopKCap,
      ),
    },
    gapChartUnsafeCooldownRounds: clampInt(
      source.gapChartUnsafeCooldownRounds,
      DEFAULT_TUNING.gapChartUnsafeCooldownRounds,
      0,
      128,
    ),
    moonshotPatternMissingCooldownRounds: clampInt(
      source.moonshotPatternMissingCooldownRounds,
      DEFAULT_TUNING.moonshotPatternMissingCooldownRounds,
      0,
      128,
    ),
    forceDataSyncNextAttempt: parseBoolean(
      source.forceDataSyncNextAttempt,
      DEFAULT_TUNING.forceDataSyncNextAttempt,
    ),
    dataSyncMode,
    dataSyncFullEveryTradingDays: clampInt(
      source.dataSyncFullEveryTradingDays,
      DEFAULT_TUNING.dataSyncFullEveryTradingDays,
      1,
      252,
    ),
    dataSyncWeeklyTradingDays: clampInt(
      source.dataSyncWeeklyTradingDays,
      DEFAULT_TUNING.dataSyncWeeklyTradingDays,
      1,
      252,
    ),
    dataSyncNoOutputTimeoutMs: clampInt(
      source.dataSyncNoOutputTimeoutMs,
      DEFAULT_TUNING.dataSyncNoOutputTimeoutMs,
      0,
      24 * 60 * 60 * 1000,
    ),
    dataSyncForcedNoOutputTimeoutMs: clampInt(
      source.dataSyncForcedNoOutputTimeoutMs,
      DEFAULT_TUNING.dataSyncForcedNoOutputTimeoutMs,
      0,
      24 * 60 * 60 * 1000,
    ),
    dataSyncNoOutputMinElapsedMs: clampInt(
      source.dataSyncNoOutputMinElapsedMs,
      DEFAULT_TUNING.dataSyncNoOutputMinElapsedMs,
      0,
      24 * 60 * 60 * 1000,
    ),
    deriveEnabled: parseBoolean(
      source.deriveEnabled,
      DEFAULT_TUNING.deriveEnabled,
    ),
    dataSyncCommand,
    dataSyncFullCommand,
    dataSyncDailyCommand,
    deriveCommand,
    timeoutsMs,
    ruleAutoTune,
    memoryGuard,
    envOverrides,
    limits: {
      minShards,
      maxShards,
      minTopPerTrack,
      maxTopPerTrack,
      maxStage1MaxRounds: limits.maxStage1MaxRounds,
      maxStage2MaxRounds: limits.maxStage2MaxRounds,
    },
  }
  const maxPreflightTradingDays = Math.max(
    1,
    normalized.preflightSignalWindowTradingDays,
  )
  normalized.preflightMinTradingDays = Math.min(
    normalized.preflightMinTradingDays,
    maxPreflightTradingDays,
  )
  const requiredWindowFromWeekCount =
    Math.max(1, normalized.preflightMinWeekCount) * 5
  normalized.preflightSignalWindowTradingDays = Math.min(
    252,
    Math.max(
      normalized.preflightSignalWindowTradingDays,
      requiredWindowFromWeekCount,
    ),
  )
  normalized.preflightMinTradingDays = Math.max(
    normalized.preflightMinTradingDays,
    Math.min(252, requiredWindowFromWeekCount),
  )
  normalized.preflightMinTradingDays = Math.min(
    normalized.preflightMinTradingDays,
    normalized.preflightSignalWindowTradingDays,
  )
  normalized.runtimeBudgetBiasMax = Math.max(
    normalized.runtimeBudgetBiasMin,
    normalized.runtimeBudgetBiasMax,
  )
  normalized.rescueEarlyExitNoPassMaxEval = Math.max(
    normalized.rescueEarlyExitNoPassMinEval,
    normalized.rescueEarlyExitNoPassMaxEval,
  )
  if (normalized.speedProfileExpansionGuard === true) {
    for (const track of ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]) {
      const cap =
        Number(normalized.speedProfileMaxStage2TopK?.[track] ?? 1) || 1
      normalized.stage2TopKByTrack[track] = Math.min(
        Number(normalized.stage2TopKByTrack?.[track] ?? cap) || cap,
        cap,
      )
    }
  }
  return normalized
}

const hasReasonPrefix = (topReasons, prefix) =>
  (topReasons ?? []).some((reason) =>
    String(reason ?? "")
      .toUpperCase()
      .startsWith(prefix),
  )

const includesAny = (text, patterns) => {
  const body = String(text ?? "").toUpperCase()
  return (patterns ?? []).some((pattern) =>
    body.includes(String(pattern).toUpperCase()),
  )
}

const normalizeFailureCodeToken = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

export const isInsufficientPoolFailureCode = (failureCode) =>
  normalizeFailureCodeToken(failureCode).startsWith("INSUFFICIENT_POOL")

const normalizePoolDetailToken = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_,]+/g, "_")
    .replace(/^_+|_+$/g, "")

const extractPoolTracks = (text, regex) => {
  const match = String(text ?? "").match(regex)
  if (!match?.[1]) return null
  const token = normalizePoolDetailToken(match[1]).replace(/_+/g, "_")
  return token || null
}

const detectPoolFailure = ({ logs, summary }) => {
  const summaryStatus = String(summary?.status ?? "").trim()
  const summaryReason = String(summary?.reason ?? "").trim()
  const body = `${logs ?? ""}\n${summaryStatus}\n${summaryReason}`

  if (
    includesAny(body, [
      "NO CANDIDATE POOL ENTRIES FOR",
      "NO_CANDIDATE_POOL_ENTRIES_FOR",
    ])
  ) {
    const tracks =
      extractPoolTracks(
        body,
        /NO CANDIDATE POOL ENTRIES FOR\s+([A-Z0-9_,\s-]+)/i,
      ) ??
      extractPoolTracks(
        body,
        /NO_CANDIDATE_POOL_ENTRIES_FOR[_\s:]+([A-Z0-9_,\s-]+)/i,
      )
    return {
      code: "SURGE_POOL_EMPTY",
      detail: tracks
        ? `NO_CANDIDATE_POOL_ENTRIES_FOR_${tracks}`
        : "NO_CANDIDATE_POOL_ENTRIES",
    }
  }

  if (
    includesAny(body, [
      "INSUFFICIENT_POOL INSUFFICIENT POOL QUALITY FOR",
      "INSUFFICIENT_POOL_QUALITY",
      'STATUS: "INSUFFICIENT_POOL"',
      "INSUFFICIENT_POOL",
    ])
  ) {
    const tracks =
      extractPoolTracks(
        body,
        /INSUFFICIENT_POOL\s+INSUFFICIENT POOL QUALITY FOR\s+([A-Z0-9_,\s-]+)/i,
      ) ??
      extractPoolTracks(
        body,
        /INSUFFICIENT_POOL_QUALITY[_\s:]+([A-Z0-9_,\s-]+)/i,
      )
    const trackToken = String(tracks ?? "")
      .trim()
      .toUpperCase()
    const hasSurgeTrack = trackToken.includes("SURGE_EOD")
    const hasGapTrack = trackToken.includes("GAP_15_BET")
    const summaryMoonshotFailCount =
      Number(
        summary?.moonshotPoolDiagnostics?.byTrack?.SURGE_EOD?.failCount ?? 0,
      ) || 0
    const moonshotContext =
      hasSurgeTrack &&
      (summaryMoonshotFailCount > 0 ||
        includesAny(body, [
          "MOONSHOT_GATE_FAILED",
          "MOONSHOT_GATE_FAIL",
          "MOONSHOT_GATE=FAIL",
          "MOONSHOT_4W",
          "SURGE-GATE",
          "SURGE_MOONSHOT_GATE",
        ]))
    const summaryQuality =
      summary && typeof summary === "object" ? summary.poolQualityByTrack : null
    const zeroPassTracksFromSummary = Array.isArray(summary?.lowQualityTracks)
      ? summary.lowQualityTracks
      : []
    const qualityTracks = Array.from(
      new Set(
        (tracks ? tracks.split(/[,\s]+/) : [])
          .concat(zeroPassTracksFromSummary)
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    )
    const zeroPassTracks = qualityTracks.filter((track) => {
      if (!summaryQuality || typeof summaryQuality !== "object") return false
      const quality = summaryQuality?.[track]
      if (!quality || typeof quality !== "object") return false
      const selected = Number(quality.selected ?? 0) || 0
      const passCount = Number(
        quality.worst2wEffectivePassCount ?? quality.worst2wGatePassCount ?? 0,
      )
      return selected > 0 && passCount <= 0
    })
    if (!moonshotContext && zeroPassTracks.length > 0) {
      return {
        code: "WORST2W_TRACK_ZERO_PASS",
        detail: `TRACK_ZERO_PASS:${zeroPassTracks.join(",")}`,
      }
    }

    let code = "INSUFFICIENT_POOL"
    if (moonshotContext) {
      code = "INSUFFICIENT_POOL_MOONSHOT_GATE"
    } else if (hasSurgeTrack && hasGapTrack) {
      code = "INSUFFICIENT_POOL_BOTH_TRACKS"
    } else if (hasSurgeTrack) {
      code = "INSUFFICIENT_POOL_SURGE_ONLY"
    } else if (hasGapTrack) {
      code = "INSUFFICIENT_POOL_GAP_ONLY"
    }
    const detailBase = tracks
      ? `INSUFFICIENT_POOL_QUALITY_FOR_${tracks}`
      : "INSUFFICIENT_POOL_QUALITY"
    return {
      code,
      detail: moonshotContext ? `${detailBase}_MOONSHOT_GATE` : detailBase,
    }
  }

  return null
}

export const evaluateAttemptSuccess = ({ report, rules }) => {
  const policy = normalizeRulesLock(rules)
  if (!report || typeof report !== "object") {
    return { pass: false, reasons: ["REPORT_MISSING"] }
  }
  const reasons = []
  const lockboxOk = Boolean(report.lockboxOk)
  if (policy.requireLockboxOk && !lockboxOk) {
    reasons.push("LOCKBOX_NOT_OK")
  }
  const maxTargetPassed = Number(report.maxTargetPassed ?? 0) || 0
  if (maxTargetPassed < policy.requireMaxTargetPassed) {
    reasons.push("TARGET_NOT_REACHED")
  }
  for (const track of policy.requiredTracks) {
    const lockboxTrack = report.lockboxByTrack?.[track]
    if (!lockboxTrack || lockboxTrack.pass !== true) {
      reasons.push(`REQUIRED_TRACK_FAIL:${track}`)
    }
  }
  return {
    pass: reasons.length === 0,
    reasons,
    metrics: {
      status: report.status ?? null,
      lockboxOk,
      maxTargetPassed,
    },
  }
}

export const classifyAttemptFailure = ({
  exitCode,
  report,
  summary = null,
  stdout,
  stderr,
  successEval,
}) => {
  const logs = `${stdout ?? ""}\n${stderr ?? ""}`
  const poolFailure = detectPoolFailure({ logs, summary })
  const stage1QualityWarning =
    summary && typeof summary === "object" ? summary.stage1QualityWarning : null
  const detectStage1QualityCollapse = () => {
    if (!stage1QualityWarning || typeof stage1QualityWarning !== "object") {
      return null
    }
    const status = String(stage1QualityWarning.status ?? "")
      .trim()
      .toUpperCase()
    if (status !== "POOL_QUALITY_DEGRADED") {
      return null
    }
    const lowQualityTracks = Array.isArray(
      stage1QualityWarning.lowQualityTracks,
    )
      ? stage1QualityWarning.lowQualityTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    if (lowQualityTracks.length <= 0) {
      return null
    }
    const shouldBlock =
      stage1QualityWarning.shouldBlockOnLowQualityRequired === true ||
      stage1QualityWarning.allowStage2OnLowQualityRequired === false
    if (!shouldBlock) {
      return null
    }
    const hasSurge = lowQualityTracks.includes("SURGE_EOD")
    const hasGap = lowQualityTracks.includes("GAP_15_BET")
    const trackToken = lowQualityTracks.join(",")
    let code = "INSUFFICIENT_POOL"
    if (hasSurge && hasGap) {
      code = "INSUFFICIENT_POOL_BOTH_TRACKS"
    } else if (hasSurge) {
      code = "INSUFFICIENT_POOL_SURGE_ONLY"
    } else if (hasGap) {
      code = "INSUFFICIENT_POOL_GAP_ONLY"
    }
    return {
      code,
      detail: `INSUFFICIENT_POOL_QUALITY_FOR_${trackToken}`,
    }
  }
  const topReasons = (report?.failureLeaderboard?.top ?? [])
    .map((row) =>
      String(row?.reason ?? "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
  if (Number(exitCode ?? 0) !== 0) {
    if (poolFailure) return poolFailure
    if (includesAny(logs, ["NO_KIS_REQUIRED"])) {
      return { code: "NO_KIS_REQUIRED", detail: "NO_KIS_REQUIRED" }
    }
    if (includesAny(logs, ["KIS_ENABLED_BLOCKED", "BACKFILL_KIS_ENABLED"])) {
      return { code: "KIS_ENABLED_BLOCKED", detail: "KIS_ENABLED_BLOCKED" }
    }
    if (includesAny(logs, ["ACTIVE_STRATEGY_REQUIRED"])) {
      return {
        code: "ACTIVE_STRATEGY_MISSING",
        detail: "ACTIVE_STRATEGY_REQUIRED",
      }
    }
    if (includesAny(logs, ["PROCESS_TIMEOUT", "ETIMEDOUT", "TIMED_OUT"])) {
      return { code: "PROCESS_TIMEOUT", detail: "PROCESS_TIMED_OUT" }
    }
    if (
      includesAny(logs, [
        "HEAP OUT OF MEMORY",
        "JAVASCRIPT HEAP OUT OF MEMORY",
        "CYCLE_MEMORY_GUARD",
        "ENOMEM",
        "KILLED",
      ])
    ) {
      return { code: "OOM_RISK", detail: "PROCESS_MEMORY_LIMIT" }
    }
    if (includesAny(logs, ["STALE_DEFAULT_ASOF"])) {
      return { code: "STALE_ASOF", detail: "DEFAULT_ASOF_OLDER_THAN_DATA" }
    }
    if (includesAny(logs, ["SIGNAL_GAP", "EVAL_SIGNAL_PREFLIGHT_FAIL"])) {
      return { code: "SIGNAL_GAP", detail: "EVAL_WINDOW_SIGNAL_GAP" }
    }
    return { code: "PROCESS_ERROR", detail: `EXIT_${exitCode}` }
  }
  if (poolFailure) return poolFailure
  if (!report) {
    return { code: "REPORT_MISSING", detail: "FINAL_REPORT_NOT_FOUND" }
  }
  const stage1QualityCollapse = detectStage1QualityCollapse()
  if (stage1QualityCollapse) {
    return stage1QualityCollapse
  }
  const primaryReasonNormalized = normalizeFailureReasonCode(
    report?.primaryFailureReason,
  )
  const detectWorst2wTrackZeroPass = () => {
    const topReasons = (report?.failureLeaderboard?.top ?? [])
      .map((row) =>
        String(row?.reason ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean)
    const worst2wContext =
      primaryReasonNormalized === "WORST2W_BELOW_THRESHOLD" ||
      hasReasonPrefix(topReasons, "WORST2W_") ||
      includesAny(report?.termination, ["WORST2W"])
    const poolQualityByTrack =
      summary && typeof summary === "object" ? summary.poolQualityByTrack : null
    if (!poolQualityByTrack || typeof poolQualityByTrack !== "object") {
      return null
    }
    const requiredTracksFromSummary = Array.isArray(
      summary?.stage2?.missingRequiredTracks,
    )
      ? summary.stage2.missingRequiredTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const requiredTracksFromReport = Array.isArray(
      report?.missingRequiredTracks,
    )
      ? report.missingRequiredTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const declaredRequiredTracks = Array.isArray(report?.requiredTracks)
      ? report.requiredTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const requiredTracksFromAllTracks = Array.isArray(report?.tracks)
      ? report.tracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const requiredTracks =
      requiredTracksFromSummary.length > 0
        ? requiredTracksFromSummary
        : requiredTracksFromReport.length > 0
          ? requiredTracksFromReport
          : declaredRequiredTracks.length > 0
            ? declaredRequiredTracks
            : requiredTracksFromAllTracks
    const requiredTrackSet = new Set(requiredTracks)
    const tracks = Array.from(
      new Set(
        requiredTracks.length > 0
          ? requiredTracks
          : Object.keys(poolQualityByTrack),
      ),
    )
      .map((track) =>
        String(track ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean)
    const selectedTracks = tracks.filter((track) => {
      const quality = poolQualityByTrack[track]
      return (Number(quality?.selected ?? 0) || 0) > 0
    })
    if (selectedTracks.length <= 0) return null
    const finalMetricsByTrack =
      report?.finalMetricsByTrack &&
      typeof report.finalMetricsByTrack === "object"
        ? report.finalMetricsByTrack
        : {}
    const failureByTrack =
      report?.failureLeaderboardByTrack &&
      typeof report.failureLeaderboardByTrack === "object"
        ? report.failureLeaderboardByTrack
        : {}
    const lockboxByTrack =
      report?.lockboxByTrack && typeof report.lockboxByTrack === "object"
        ? report.lockboxByTrack
        : {}
    const activationCandidateByTrack =
      report?.activationCandidateByTrack &&
      typeof report.activationCandidateByTrack === "object"
        ? report.activationCandidateByTrack
        : {}
    const activationPoolByTrack =
      report?.activationPoolByTrack &&
      typeof report.activationPoolByTrack === "object"
        ? report.activationPoolByTrack
        : {}
    const selectedPoolSetByTrack =
      report?.selectedPoolSetByTrack &&
      typeof report.selectedPoolSetByTrack === "object"
        ? report.selectedPoolSetByTrack
        : {}
    const hasExplicitActivationState =
      Object.keys(activationCandidateByTrack).length > 0 ||
      Object.keys(activationPoolByTrack).length > 0 ||
      Object.keys(selectedPoolSetByTrack).length > 0
    const activatedTrackSet = new Set(
      Object.keys(activationCandidateByTrack)
        .concat(
          Object.entries(activationPoolByTrack)
            .filter(([, value]) => {
              if (!value || typeof value !== "object") return false
              const total = Number(value.total ?? 0) || 0
              const active = Number(value.active ?? 0) || 0
              const rows = Array.isArray(value.rows) ? value.rows.length : 0
              return total > 0 || active > 0 || rows > 0
            })
            .map(([track]) => String(track ?? "")),
        )
        .concat(Object.keys(selectedPoolSetByTrack))
        .map((track) =>
          String(track ?? "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    )
    const zeroPassTrackSet = new Set()
    for (const track of selectedTracks) {
      const quality = poolQualityByTrack[track]
      const passCount =
        Number(
          quality?.worst2wEffectivePassCount ??
            quality?.worst2wGatePassCount ??
            0,
        ) || 0
      const minPassRequired = Math.max(
        0,
        Number(
          quality?.minWorst2wPassRequired ?? quality?.minWorst2wRequired ?? 1,
        ) || 0,
      )
      if (passCount <= 0 && minPassRequired > 0) {
        zeroPassTrackSet.add(track)
        continue
      }
      if (hasExplicitActivationState && !activatedTrackSet.has(track)) {
        continue
      }
      const lockboxTrack =
        lockboxByTrack?.[track] && typeof lockboxByTrack[track] === "object"
          ? lockboxByTrack[track]
          : null
      const lockboxReason = String(lockboxTrack?.reason ?? "")
        .trim()
        .toUpperCase()
      const lockboxCompletedTradesKnown =
        lockboxTrack?.completedTrades !== null &&
        lockboxTrack?.completedTrades !== undefined &&
        Number.isFinite(Number(lockboxTrack.completedTrades))
      const lockboxCompletedTrades = lockboxCompletedTradesKnown
        ? Number(lockboxTrack.completedTrades) || 0
        : null
      const lockboxShowsTradeButRiskFail =
        lockboxCompletedTradesKnown &&
        (lockboxCompletedTrades ?? 0) > 0 &&
        lockboxReason.includes("WORST2W")
      if (lockboxShowsTradeButRiskFail) {
        continue
      }
      const metrics = finalMetricsByTrack?.[track]
      const metricsObj = metrics && typeof metrics === "object" ? metrics : null
      const completedTradesKnown =
        metricsObj?.completedTrades !== null &&
        metricsObj?.completedTrades !== undefined &&
        Number.isFinite(Number(metricsObj.completedTrades))
      const completedTrades = completedTradesKnown
        ? Number(metricsObj.completedTrades) || 0
        : null
      const tradeGatePass = metricsObj?.tradeGatePass
      const validationEarlyGatePass = metricsObj?.validationEarlyGatePass
      const hasMetricEvidence =
        completedTradesKnown ||
        typeof tradeGatePass === "boolean" ||
        typeof validationEarlyGatePass === "boolean"
      if (
        hasMetricEvidence &&
        ((completedTradesKnown && (completedTrades ?? 0) <= 0) ||
          tradeGatePass === false ||
          validationEarlyGatePass === false)
      ) {
        zeroPassTrackSet.add(track)
        continue
      }
      const trackReasons = (failureByTrack?.[track]?.top ?? [])
        .map((row) =>
          String(row?.reason ?? "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean)
      if (
        trackReasons.length > 0 &&
        (hasReasonPrefix(trackReasons, "TRADE_GATE") ||
          hasReasonPrefix(trackReasons, "EARLY_ZERO_TRADES") ||
          includesAny(trackReasons.join(","), [
            "EARLY_ZERO_SIGNALS",
            "EARLY_ZERO_RESULTS",
            "WEEKLY_COUNT_ZERO",
            "WEEKLY_EMPTY_WEEKS",
          ]))
      ) {
        zeroPassTrackSet.add(track)
      }
    }
    const zeroPassTracks = Array.from(zeroPassTrackSet)
    if (zeroPassTracks.length <= 0) return null
    const requiredZeroPassTracks =
      requiredTrackSet.size > 0
        ? zeroPassTracks.filter((track) => requiredTrackSet.has(track))
        : []
    if (requiredTrackSet.size > 0) {
      if (requiredZeroPassTracks.length <= 0) {
        return null
      }
      return {
        code: "WORST2W_TRACK_ZERO_PASS",
        detail: `TRACK_ZERO_PASS:${requiredZeroPassTracks.join(",")}`,
      }
    }
    if (!worst2wContext) {
      return null
    }
    return {
      code: "WORST2W_TRACK_ZERO_PASS",
      detail: `TRACK_ZERO_PASS:${zeroPassTracks.join(",")}`,
    }
  }
  const worst2wTrackZeroPass = detectWorst2wTrackZeroPass()
  if (worst2wTrackZeroPass) {
    return worst2wTrackZeroPass
  }
  const detectRequiredTrackWorst2wFailure = () => {
    const missingRequiredTracksFromSummary = Array.isArray(
      summary?.stage2?.missingRequiredTracks,
    )
      ? summary.stage2.missingRequiredTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const missingRequiredTracksFromReport = Array.isArray(
      report?.missingRequiredTracks,
    )
      ? report.missingRequiredTracks
          .map((track) =>
            String(track ?? "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : []
    const missingRequiredTracks =
      missingRequiredTracksFromSummary.length > 0
        ? missingRequiredTracksFromSummary
        : missingRequiredTracksFromReport
    if (missingRequiredTracks.length <= 0) {
      return null
    }
    const hasWorst2wContext =
      primaryReasonNormalized === "WORST2W_BELOW_THRESHOLD" ||
      hasReasonPrefix(topReasons, "WORST2W_") ||
      includesAny(report?.termination, ["WORST2W"])
    if (!hasWorst2wContext) {
      return null
    }
    return {
      code: "WORST2W_BELOW_THRESHOLD",
      detail: `WORST2W_REQUIRED_TRACKS:${missingRequiredTracks.join(",")}`,
    }
  }
  const requiredTrackWorst2wFailure = detectRequiredTrackWorst2wFailure()
  if (requiredTrackWorst2wFailure) {
    return requiredTrackWorst2wFailure
  }
  if (primaryReasonNormalized && primaryReasonNormalized !== "UNKNOWN") {
    const mapped = mapPrimaryReasonToFailureCode(primaryReasonNormalized)
    if (mapped?.code) {
      return mapped
    }
  }
  if (
    hasReasonPrefix(topReasons, "WORST2W_") ||
    includesAny(report?.termination, ["WORST2W"])
  ) {
    return { code: "WORST2W_BELOW_THRESHOLD", detail: "WORST2W_GATE_FAIL" }
  }
  if (
    hasReasonPrefix(topReasons, "TRADE_GATE") ||
    hasReasonPrefix(topReasons, "EARLY_ZERO_TRADES") ||
    includesAny(report?.termination, ["NO_TRADES", "WEAK_SIGNALS"])
  ) {
    return { code: "TRADE_GATE_FAIL", detail: "LOW_COMPLETED_TRADES" }
  }
  if (includesAny(report?.status, ["MOONSHOT_GATE_FAILED"])) {
    return { code: "MOONSHOT_GATE_FAIL", detail: "SURGE_MOONSHOT_GATE" }
  }
  if (
    includesAny(report?.status, ["SIGNAL_GAP"]) ||
    includesAny(report?.termination, ["SIGNAL_GAP"])
  ) {
    return { code: "SIGNAL_GAP", detail: "EVAL_WINDOW_SIGNAL_GAP" }
  }
  if (
    includesAny(report?.status, ["BLOCKED_BY_DATA"]) ||
    includesAny(report?.termination, ["BLOCKED_BY_DATA"]) ||
    includesAny(JSON.stringify(report?.lockboxBlockedReasons ?? []), [
      "PATTERN_MISSING",
      "COVERAGE",
      "DATA",
    ])
  ) {
    return { code: "DATA_COVERAGE_LOW", detail: "DATA_OR_PATTERN_BLOCKED" }
  }
  if (!successEval?.pass) {
    return {
      code: "PERFORMANCE_NOT_PASS",
      detail: (successEval?.reasons ?? []).join(",") || "POLICY_FAIL",
    }
  }
  return { code: "UNKNOWN_FAIL", detail: "UNCLASSIFIED" }
}

const applySurgePoolRecovery = (tuning) => {
  const t = normalizeTuning(tuning)
  const nextFingerprintCarryLimit = Math.max(
    0,
    Math.floor((Number(t.failureFingerprintCarryLimit ?? 320) || 320) * 0.6),
  )
  return normalizeTuning({
    ...t,
    shards: Math.min(t.limits.maxShards, t.shards + 1),
    topPerTrack: Math.min(t.limits.maxTopPerTrack, t.topPerTrack + 10),
    stage1MaxRounds: Math.min(
      t.limits.maxStage1MaxRounds,
      t.stage1MaxRounds + 30,
    ),
    stage2MaxRounds: Math.min(
      t.limits.maxStage2MaxRounds,
      t.stage2MaxRounds + 20,
    ),
    coverageSeedLanes: Math.min(32, t.coverageSeedLanes + 1),
    prefilterEnabled: true,
    prefilterWorst2wBuffer: Math.min(40, t.prefilterWorst2wBuffer + 2),
    prefilterStopLikeCeil: Math.min(1, t.prefilterStopLikeCeil + 0.05),
    prefilterNoFillCeil: Math.min(1, t.prefilterNoFillCeil + 0.03),
    symbolBucketTotal: Math.max(
      8,
      Math.min(12, Number(t.symbolBucketTotal ?? 8) || 8),
    ),
    symbolBucketStride: 1,
    failureFingerprintCarryLimit: nextFingerprintCarryLimit,
    seedStart: t.seedStart + 131,
  })
}

const applyInsufficientPoolRecovery = (tuning) => {
  const current = normalizeTuning(tuning)
  const base = applySurgePoolRecovery(current)
  const carryFloor = Math.max(
    8,
    Math.floor(Number(current.failureFingerprintCarryLimit ?? 0) || 0),
  )
  const currentEarlyExitMinEval = Math.max(
    6,
    Math.min(256, Number(base.rescueEarlyExitNoPassMinEval ?? 12) || 12),
  )
  const currentRescueP0 = Math.max(
    0.5,
    Math.min(0.99, Number(current.rescueP0 ?? base.rescueP0 ?? 0.95) || 0.95),
  )
  const currentRescueLcbQuantile = Math.max(
    0.01,
    Math.min(
      0.5,
      Number(current.rescueLcbQuantile ?? base.rescueLcbQuantile ?? 0.1) || 0.1,
    ),
  )
  const currentMinWorst2wPassPerTrackSurge = Math.max(
    0,
    Number(
      current.minWorst2wPassPerTrackSurge ??
        base.minWorst2wPassPerTrackSurge ??
        2,
    ) || 0,
  )
  const currentMinWorst2wPassPerTrackGap = Math.max(
    0,
    Number(
      current.minWorst2wPassPerTrackGap ?? base.minWorst2wPassPerTrackGap ?? 2,
    ) || 0,
  )
  const nextRescueTopK = Math.max(
    48,
    Math.min(120, (Number(base.rescueTopK ?? 20) || 20) + 8),
  )
  const nextRescueDeepTopK = Math.max(
    nextRescueTopK,
    Math.min(144, (Number(base.rescueDeepTopK ?? 12) || 12) + 8),
  )
  const nextStage1MaxRounds = Math.max(
    220,
    Math.min(
      260,
      Number(current.stage1MaxRounds ?? base.stage1MaxRounds ?? 240) || 240,
    ),
  )
  const nextStage2MaxRounds = Math.max(
    420,
    Math.min(
      500,
      Number(current.stage2MaxRounds ?? base.stage2MaxRounds ?? 460) || 460,
    ),
  )
  const nextTopPerTrack = Math.max(
    96,
    Math.min(140, Number(base.topPerTrack ?? current.topPerTrack ?? 96) || 96),
  )
  const nextPrefilterWorst2wBuffer = Math.max(
    16,
    Math.min(24, Number(base.prefilterWorst2wBuffer ?? 18) || 18),
  )
  const targetEarlyExitMinEval = Math.max(
    currentEarlyExitMinEval,
    Math.ceil(nextRescueTopK * 0.4),
  )
  return normalizeTuning({
    ...base,
    stage1MaxRounds: nextStage1MaxRounds,
    stage2MaxRounds: nextStage2MaxRounds,
    topPerTrack: nextTopPerTrack,
    prefilterWorst2wBuffer: nextPrefilterWorst2wBuffer,
    prefilterStopLikeCeil: Math.max(
      0.74,
      Math.min(0.99, Number(base.prefilterStopLikeCeil ?? 1) || 1),
    ),
    prefilterNoFillCeil: Math.max(
      0.86,
      Math.min(0.999, Number(base.prefilterNoFillCeil ?? 1) || 1),
    ),
    failureFingerprintCarryLimit: Math.max(
      carryFloor,
      Math.floor(Number(base.failureFingerprintCarryLimit ?? 0) || 0),
    ),
    rescueTopK: nextRescueTopK,
    rescueCheapB: Math.max(
      1000,
      Math.min(2400, (Number(base.rescueCheapB ?? 300) || 300) + 80),
    ),
    rescueCheapM: Math.max(
      96,
      Math.min(256, (Number(base.rescueCheapM ?? 50) || 50) + 8),
    ),
    rescueDeepTopK: nextRescueDeepTopK,
    rescueDeepB: Math.max(
      1800,
      Math.min(4200, (Number(base.rescueDeepB ?? 1000) || 1000) + 140),
    ),
    rescueDeepM: Math.max(
      160,
      Math.min(320, (Number(base.rescueDeepM ?? 80) || 80) + 12),
    ),
    rescueEarlyExitEnabled: true,
    rescueEarlyExitNoPassMinEval: Math.max(
      6,
      Math.min(nextRescueTopK, Math.min(96, targetEarlyExitMinEval)),
    ),
    rescueEarlyExitMinEvalRatio: Math.max(
      0.35,
      Math.min(0.65, Number(base.rescueEarlyExitMinEvalRatio ?? 0.25) || 0.25),
    ),
    rescueEarlyExitTerminalReasonRatio: Math.max(
      0.7,
      Math.min(
        0.95,
        Number(base.rescueEarlyExitTerminalReasonRatio ?? 0.85) || 0.85,
      ),
    ),
    // Stage2/final gates stay fixed; this only relaxes stage1 rescue enough to avoid 0-pass lock.
    rescueP0: Math.max(0.9, Math.min(0.95, currentRescueP0 - 0.02)),
    rescueLcbQuantile: Math.max(
      0.12,
      Math.min(0.2, currentRescueLcbQuantile + 0.02),
    ),
    sameFailureSignatureJumpThreshold: 1,
    sameFailureSignatureCursorMultiplier: Math.max(
      6,
      Number(base.sameFailureSignatureCursorMultiplier ?? 3) || 3,
    ),
    minWorst2wPassPerTrackSurge: Math.max(
      0,
      currentMinWorst2wPassPerTrackSurge - 1,
    ),
    minWorst2wPassPerTrackGap: Math.max(
      0,
      currentMinWorst2wPassPerTrackGap - 1,
    ),
    symbolBucketStride: 1,
    retryBackoffMs: Math.max(
      15_000,
      Math.min(60_000, Math.floor(Number(base.retryBackoffMs ?? 0) || 0)),
    ),
    seedStart: base.seedStart + 197,
  })
}

const applyMoonshotPoolQualityRecovery = (tuning) => {
  const current = normalizeTuning(tuning)
  const base = applySurgePoolRecovery(current)
  return normalizeTuning({
    ...base,
    // Moonshot-gate failures often recur with zero SURGE passes; move faster by capping expensive rescue MC.
    rescueEnabled: true,
    rescueTopK: Math.max(
      32,
      Math.min(192, Number(current.rescueTopK ?? 20) || 20),
    ),
    rescueCheapB: Math.max(
      300,
      Math.min(1200, Number(current.rescueCheapB ?? 300) || 300),
    ),
    rescueCheapM: Math.max(
      50,
      Math.min(160, Number(current.rescueCheapM ?? 50) || 50),
    ),
    rescueDeepTopK: Math.max(
      24,
      Math.min(96, Number(current.rescueDeepTopK ?? 12) || 12),
    ),
    rescueDeepB: Math.max(
      600,
      Math.min(2400, Number(current.rescueDeepB ?? 600) || 600),
    ),
    rescueDeepM: Math.max(
      80,
      Math.min(192, Number(current.rescueDeepM ?? 80) || 80),
    ),
    failureFingerprintCarryLimit: Math.max(
      12,
      Math.min(96, Number(current.failureFingerprintCarryLimit ?? 320) || 320),
    ),
    coverageSeedLanes: Math.min(
      32,
      Math.max(8, Number(current.coverageSeedLanes ?? 4) + 2),
    ),
    topPerTrack: Math.min(
      current.limits.maxTopPerTrack,
      Math.max(
        Number(current.topPerTrack ?? base.topPerTrack) || base.topPerTrack,
        96,
      ),
    ),
    // Widen bucket coverage per session to avoid repeated moonshot-zero pools.
    symbolBucketTotal: Math.max(
      8,
      Math.min(
        12,
        Number(current.symbolBucketTotal ?? base.symbolBucketTotal) ||
          base.symbolBucketTotal,
      ),
    ),
    symbolBucketStride: 1,
    forceDataSyncNextAttempt: false,
    retryBackoffMs: Math.max(
      15_000,
      Math.min(45_000, Number(current.retryBackoffMs ?? 0) || 0),
    ),
    seedStart: current.seedStart + 211,
  })
}

const applyMoonshotOutcomeRecovery = (tuning) => {
  const current = normalizeTuning(tuning)
  const fallbackDataSyncCommand =
    current.dataSyncCommand.length >= 2
      ? current.dataSyncCommand
      : [...DEFAULT_DATA_SYNC_COMMAND]
  const fallbackDailyCommand =
    current.dataSyncDailyCommand.length >= 2
      ? current.dataSyncDailyCommand
      : fallbackDataSyncCommand
  return normalizeTuning({
    ...current,
    dataSyncEnabled: true,
    forceDataSyncNextAttempt: true,
    dataSyncCommand: fallbackDataSyncCommand,
    dataSyncDailyCommand: fallbackDailyCommand,
    retryBackoffMs: Math.max(60_000, Number(current.retryBackoffMs ?? 0) || 0),
    seedStart: current.seedStart + 73,
  })
}

const parseSignalGapWindow = (detail) => {
  const text = String(detail ?? "")
  const matches = Array.from(text.matchAll(/(\d{4}-\d{2}-\d{2})/g))
    .map((row) => normalizeDateKeyToken(row?.[1]))
    .filter(Boolean)
  if (matches.length < 2) {
    return { fromDateKey: "", toDateKey: "" }
  }
  const fromDateKey = matches[0]
  const toDateKey = matches[1]
  if (!fromDateKey || !toDateKey || toDateKey < fromDateKey) {
    return { fromDateKey: "", toDateKey: "" }
  }
  return { fromDateKey, toDateKey }
}

const applySignalGapRecovery = (tuning, failureDetail = null) => {
  const current = normalizeTuning(tuning)
  const range = parseSignalGapWindow(failureDetail)
  return normalizeTuning({
    ...current,
    dataSyncEnabled: true,
    dataSyncMode: "smart",
    forceDataSyncNextAttempt: true,
    signalGapRepairEnabled: true,
    signalGapRepairFromDateKey:
      range.fromDateKey || current.signalGapRepairFromDateKey,
    signalGapRepairToDateKey:
      range.toDateKey || current.signalGapRepairToDateKey,
    signalGapRepairStopAfter: "recommend",
    retryBackoffMs: Math.max(
      15_000,
      Math.min(60_000, Number(current.retryBackoffMs ?? 0) || 0),
    ),
    seedStart: current.seedStart + 59,
  })
}

const applyDiversityUpgrade = (tuning) => {
  const t = normalizeTuning(tuning)
  return normalizeTuning({
    ...t,
    shards: Math.min(t.limits.maxShards, t.shards + 1),
    topPerTrack: Math.min(t.limits.maxTopPerTrack, t.topPerTrack + 8),
    stage1MaxRounds: Math.min(
      t.limits.maxStage1MaxRounds,
      t.stage1MaxRounds + 20,
    ),
    stage2MaxRounds: Math.min(
      t.limits.maxStage2MaxRounds,
      t.stage2MaxRounds + 40,
    ),
    seedStart: t.seedStart + 97,
  })
}

const applyGateFailureRecovery = (tuning) => {
  const current = normalizeTuning(tuning)
  const diversified = applyDiversityUpgrade(current)
  const currentBucketTotal = Math.max(
    1,
    Number(current.symbolBucketTotal ?? diversified.symbolBucketTotal ?? 8) ||
      8,
  )
  const nextBucketTotal =
    currentBucketTotal > 12 ? 12 : Math.max(8, Math.min(12, currentBucketTotal))
  const currentBucketStride = Math.max(
    1,
    Number(current.symbolBucketStride ?? diversified.symbolBucketStride ?? 1) ||
      1,
  )
  return normalizeTuning({
    ...diversified,
    rescueEnabled: true,
    // Keep stage1 quality guard active so rescue really runs instead of being bypassed at 0.
    minWorst2wPassPerTrackSurge: Math.max(
      1,
      Number(
        current.minWorst2wPassPerTrackSurge ??
          diversified.minWorst2wPassPerTrackSurge ??
          1,
      ) || 1,
    ),
    minWorst2wPassPerTrackGap: Math.max(
      1,
      Number(
        current.minWorst2wPassPerTrackGap ??
          diversified.minWorst2wPassPerTrackGap ??
          1,
      ) || 1,
    ),
    // Keep prefilter thresholds non-decreasing for deterministic recovery behavior.
    prefilterEnabled: true,
    prefilterStopLikeCeil: Math.max(
      0.72,
      Math.min(
        0.98,
        Math.max(
          Number(current.prefilterStopLikeCeil ?? 0.9) || 0.9,
          (Number(current.prefilterStopLikeCeil ?? 0.9) || 0.9) + 0.03,
        ),
      ),
    ),
    prefilterNoFillCeil: Math.max(
      0.84,
      Math.min(
        0.99,
        Math.max(
          Number(current.prefilterNoFillCeil ?? 0.95) || 0.95,
          (Number(current.prefilterNoFillCeil ?? 0.95) || 0.95) + 0.03,
        ),
      ),
    ),
    symbolBucketTotal: nextBucketTotal,
    symbolBucketStride: Math.max(1, Math.min(currentBucketStride, 2)),
    coverageSeedLanes: Math.min(
      64,
      Math.max(4, Number(current.coverageSeedLanes ?? 4) + 2),
    ),
  })
}

const boostDailyPassAvengers = (
  tuning,
  { weakTracks = [], aggressive = false } = {},
) => {
  const t = normalizeTuning(tuning)
  const weakSet = new Set(
    (Array.isArray(weakTracks) ? weakTracks : [])
      .map((row) =>
        String(row ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  )
  const topCaps = {
    SURGE_EOD: 96,
    GAP_15_BET: 72,
    MOONSHOT: 48,
  }
  const nextTopN = { ...t.dailyPassTopNByTrack }
  const nextPoolsetCount = { ...t.dailyPassPoolsetCountByTrack }
  const nextStage2TopK = { ...t.stage2TopKByTrack }
  for (const track of TRACK_KEYS_WITH_MOONSHOT) {
    const isWeak = weakSet.has(track)
    const topStep = aggressive ? (isWeak ? 16 : 10) : isWeak ? 12 : 6
    const currentTop = Math.max(
      1,
      Math.floor(Number(nextTopN?.[track] ?? 1) || 1),
    )
    const topCap = Math.max(
      1,
      Math.floor(
        Number(topCaps[track] ?? DEFAULT_TUNING.dailyPassTopNByTrack[track]) ||
          1,
      ),
    )
    nextTopN[track] = Math.min(topCap, currentTop + topStep)

    const currentPoolsetCount = Math.max(
      1,
      Math.floor(Number(nextPoolsetCount?.[track] ?? 1) || 1),
    )
    const configuredMax = Math.max(
      1,
      Math.floor(Number(t.poolsetCountMaxByTrack?.[track] ?? 1) || 1),
    )
    const poolsetStep = isWeak ? 1 : aggressive ? 1 : 0
    nextPoolsetCount[track] = Math.min(
      configuredMax,
      currentPoolsetCount + poolsetStep,
    )

    if (isWeak) {
      nextStage2TopK[track] = Math.min(
        12,
        Math.max(1, Number(nextStage2TopK?.[track] ?? 1) + 1),
      )
    }
  }

  const nextRecombineRounds = Math.min(
    aggressive ? 4 : 3,
    Math.max(1, Number(t.dailyPassRecombineRounds ?? 2) + 1),
  )
  return normalizeTuning({
    ...t,
    dailyPassTopNByTrack: nextTopN,
    dailyPassPoolsetCountByTrack: nextPoolsetCount,
    dailyPassRecombineRounds: nextRecombineRounds,
    stage2TopKByTrack: nextStage2TopK,
  })
}

const parseTrackListFromFailureDetail = (failureDetail) => {
  const text = String(failureDetail ?? "")
    .trim()
    .toUpperCase()
  const marker = "TRACK_ZERO_PASS:"
  const idx = text.indexOf(marker)
  if (idx < 0) return []
  return text
    .slice(idx + marker.length)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

const applyGateFailureTrackZeroPassRecovery = (
  tuning,
  failureDetail = null,
) => {
  const current = normalizeTuning(tuning)
  const base = applyGateFailureRecovery(current)
  const weakTracks = parseTrackListFromFailureDetail(failureDetail)
  const weakTrackSet = new Set(weakTracks)
  const stage2TopKByTrack = {
    ...base.stage2TopKByTrack,
  }
  const poolRefillCountByTrack = {
    ...base.poolRefillCountByTrack,
  }
  for (const track of ["SURGE_EOD", "GAP_15_BET"]) {
    if (!weakTrackSet.has(track)) continue
    stage2TopKByTrack[track] = Math.min(
      6,
      Math.max(3, Number(stage2TopKByTrack?.[track] ?? 3) + 1),
    )
    poolRefillCountByTrack[track] = Math.min(
      6,
      Math.max(3, Number(poolRefillCountByTrack?.[track] ?? 3) + 1),
    )
  }
  const currentBucketTotal = Math.max(
    8,
    Math.floor(Number(current.symbolBucketTotal ?? 8) || 8),
  )
  const nextStage1MaxRounds = Math.max(
    200,
    Math.min(
      260,
      Math.min(
        Number(base.stage1MaxRounds ?? 260) || 260,
        Number(current.stage1MaxRounds ?? 260) || 260,
      ),
    ),
  )
  const nextStage2MaxRounds = Math.max(
    260,
    Math.min(
      360,
      Math.max(
        Number(base.stage2MaxRounds ?? 420) || 420,
        Number(current.stage2MaxRounds ?? 420) || 420,
      ),
    ),
  )
  const nextStage2PlateauRounds = Math.max(
    120,
    Math.min(
      160,
      Math.min(
        Number(
          current.stage2PlateauRounds ?? base.stage2PlateauRounds ?? 240,
        ) || 240,
        Number(base.stage2PlateauRounds ?? 240) || 240,
      ),
    ),
  )
  const minWorst2wPassPerTrackSurge = weakTrackSet.has("SURGE_EOD")
    ? Math.max(
        1,
        Number(base.minWorst2wPassPerTrackSurge ?? 0) || 0,
        Number(current.minWorst2wPassPerTrackSurge ?? 0) || 0,
      )
    : Math.max(
        0,
        Number(base.minWorst2wPassPerTrackSurge ?? 0) || 0,
        Number(current.minWorst2wPassPerTrackSurge ?? 0) || 0,
      )
  const minWorst2wPassPerTrackGap = weakTrackSet.has("GAP_15_BET")
    ? Math.max(
        1,
        Number(base.minWorst2wPassPerTrackGap ?? 0) || 0,
        Number(current.minWorst2wPassPerTrackGap ?? 0) || 0,
      )
    : Math.max(
        0,
        Number(base.minWorst2wPassPerTrackGap ?? 0) || 0,
        Number(current.minWorst2wPassPerTrackGap ?? 0) || 0,
      )

  return normalizeTuning({
    ...base,
    minWorst2wPassPerTrackSurge,
    minWorst2wPassPerTrackGap,
    topPerTrack: Math.min(
      base.limits.maxTopPerTrack,
      Math.max(base.topPerTrack, current.topPerTrack) + 8,
    ),
    stage1MaxRounds: nextStage1MaxRounds,
    stage2MaxRounds: nextStage2MaxRounds,
    stage2PlateauRounds: nextStage2PlateauRounds,
    symbolBucketTotal: Math.min(12, currentBucketTotal + 1),
    symbolBucketStride: 2,
    prefilterWorst2wBuffer: Math.min(
      32,
      Math.max(
        Number(base.prefilterWorst2wBuffer ?? 18) || 18,
        (Number(current.prefilterWorst2wBuffer ?? 18) || 18) + 2,
      ),
    ),
    prefilterStopLikeCeil: Math.max(
      0.6,
      Math.min(
        0.95,
        Math.max(
          Number(base.prefilterStopLikeCeil ?? 0.9) || 0.9,
          (Number(current.prefilterStopLikeCeil ?? 0.9) || 0.9) + 0.05,
        ),
      ),
    ),
    prefilterNoFillCeil: Math.max(
      0.75,
      Math.min(
        0.95,
        Math.max(
          Number(base.prefilterNoFillCeil ?? 0.95) || 0.95,
          (Number(current.prefilterNoFillCeil ?? 0.95) || 0.95) + 0.04,
        ),
      ),
    ),
    coverageSeedLanes: Math.min(
      64,
      Math.max(base.coverageSeedLanes, Number(current.coverageSeedLanes ?? 0)) +
        4,
    ),
    failureFingerprintCarryLimit: Math.max(
      16,
      Math.min(
        32,
        Math.floor(
          (Number(current.failureFingerprintCarryLimit ?? 48) || 48) * 0.8,
        ),
      ),
    ),
    stage2TopKByTrack,
    poolRefillCountByTrack,
    seedStart: current.seedStart + 173,
  })
}

const applyTrackZeroPassFastCycle = (tuning) => {
  const t = normalizeTuning(tuning)
  return normalizeTuning({
    ...t,
    // Zero-pass loops need more stage1 discovery, but keep stage2 bounded.
    stage1MaxRounds: Math.max(
      180,
      Math.min(240, (Number(t.stage1MaxRounds ?? 180) || 180) + 20),
    ),
    stage2MaxRounds: Math.max(200, Math.min(260, t.stage2MaxRounds)),
    stage2PlateauRounds: Math.max(80, Math.min(110, t.stage2PlateauRounds)),
    retryBackoffMs: Math.max(
      15_000,
      Math.min(30_000, Number(t.retryBackoffMs ?? 30_000) || 30_000),
    ),
    seedStart: t.seedStart + 211,
  })
}

const applyTrackZeroPassDiversityBoost = (
  tuning,
  failureDetail = null,
  options = {},
) => {
  const t = normalizeTuning(tuning)
  const weakTracks = parseTrackListFromFailureDetail(failureDetail)
  const weakTrackSet = new Set(weakTracks)
  const weakSurge = weakTrackSet.has("SURGE_EOD")
  const weakGap = weakTrackSet.has("GAP_15_BET")
  const fastNoPassExitRequested = Boolean(options?.fastNoPassExit)
  const preserveDeepForWeakSurge = options?.preserveDeepForWeakSurge !== false
  // For SURGE zero-pass loops, fast early-exit keeps collapsing on the same terminal set.
  // Keep at least one deep cycle first, then allow fast cycles on repeated streaks.
  const fastNoPassExit =
    fastNoPassExitRequested && !(preserveDeepForWeakSurge && weakSurge)
  const policyEvalTopKSurgeBase = Number(t.policyEvalTopKSurge ?? 10) || 10
  const policyEvalTopKGapBase = Number(t.policyEvalTopKGap ?? 8) || 8
  const policyEvalMaxConsecutiveDaysBase =
    Number(t.policyEvalMaxConsecutiveDays ?? 7) || 7
  const policyEvalMaxConsecutiveWeeksBase =
    Number(t.policyEvalMaxConsecutiveWeeks ?? 4) || 4
  const policyEvalTopKSurge = weakSurge
    ? Math.min(20, Math.max(12, policyEvalTopKSurgeBase + 2))
    : policyEvalTopKSurgeBase
  const policyEvalTopKGap = weakGap
    ? Math.min(16, Math.max(10, policyEvalTopKGapBase + 1))
    : policyEvalTopKGapBase
  const policyEvalMaxConsecutiveDays =
    weakSurge || weakGap
      ? Math.max(2, Math.min(3, policyEvalMaxConsecutiveDaysBase - 2))
      : policyEvalMaxConsecutiveDaysBase
  const policyEvalMaxConsecutiveWeeks =
    weakSurge || weakGap
      ? Math.max(1, Math.min(2, policyEvalMaxConsecutiveWeeksBase - 1))
      : policyEvalMaxConsecutiveWeeksBase
  const stage2TopKByTrack = {
    ...t.stage2TopKByTrack,
  }
  const poolRefillCountByTrack = {
    ...t.poolRefillCountByTrack,
  }
  for (const track of ["SURGE_EOD", "GAP_15_BET"]) {
    if (!weakTrackSet.has(track)) continue
    stage2TopKByTrack[track] = Math.min(
      12,
      Math.max(8, Number(stage2TopKByTrack?.[track] ?? 3) + 2),
    )
    poolRefillCountByTrack[track] = Math.min(
      12,
      Math.max(8, Number(poolRefillCountByTrack?.[track] ?? 3) + 2),
    )
  }
  const currentCarry = Number(t.failureFingerprintCarryLimit ?? 48) || 48
  const nextCarry = Math.max(12, Math.min(32, Math.floor(currentCarry * 0.5)))
  const fastRescueTopFloor = weakSurge ? 24 : 32
  const fastRescueTopCap = weakSurge ? 56 : 96
  const fastRescueDeepFloor = weakSurge ? 24 : 48
  const fastRescueDeepCap = weakSurge ? 48 : 96
  const fastNoPassMinFloor = weakSurge ? 16 : 24
  const fastNoPassMinCap = weakSurge ? 32 : 48
  const fastNoPassEvalRatioCap = weakSurge ? 0.25 : 0.3
  return normalizeTuning({
    ...t,
    sameFailureSignatureJumpThreshold: 2,
    sameFailureSignatureCursorMultiplier: Math.min(
      16,
      Math.max(8, Number(t.sameFailureSignatureCursorMultiplier ?? 3) + 2),
    ),
    failureFingerprintCarryLimit: nextCarry,
    coverageSeedLanes: Math.min(
      32,
      Math.max(12, Number(t.coverageSeedLanes ?? 4) + 4),
    ),
    symbolBucketTotal: Math.min(
      24,
      Math.max(14, Number(t.symbolBucketTotal ?? 8) + 3),
    ),
    symbolBucketStride: Math.max(
      2,
      Math.min(3, Number(t.symbolBucketStride ?? 1) || 1),
    ),
    rescueTopK: Math.max(
      fastRescueTopFloor,
      Math.min(fastRescueTopCap, Number(t.rescueTopK ?? 20) + 4),
    ),
    rescueDeepTopK: Math.max(
      fastRescueDeepFloor,
      Math.min(fastRescueDeepCap, Number(t.rescueDeepTopK ?? 12) + 4),
    ),
    rescueDeepB: Math.max(
      1200,
      Math.min(2800, Number(t.rescueDeepB ?? 1200) || 1200),
    ),
    rescueDeepM: Math.max(96, Math.min(192, Number(t.rescueDeepM ?? 96) || 96)),
    rescueEarlyExitNoPassMinEval: fastNoPassExit
      ? Math.max(
          fastNoPassMinFloor,
          Math.min(
            fastNoPassMinCap,
            Math.floor(
              (Number(t.rescueEarlyExitNoPassMinEval ?? 48) || 48) * 0.5,
            ),
          ),
        )
      : Math.max(
          96,
          Math.min(160, Number(t.rescueEarlyExitNoPassMinEval ?? 96) || 96),
        ),
    rescueEarlyExitMinEvalRatio: fastNoPassExit
      ? Math.max(
          0.2,
          Math.min(
            fastNoPassEvalRatioCap,
            Number(t.rescueEarlyExitMinEvalRatio ?? 0.3) || 0.3,
          ),
        )
      : Math.max(
          0.55,
          Math.min(0.75, Number(t.rescueEarlyExitMinEvalRatio ?? 0.55) || 0.55),
        ),
    rescueEarlyExitTerminalReasonRatio: fastNoPassExit
      ? Math.max(
          0.7,
          Math.min(
            0.85,
            Number(t.rescueEarlyExitTerminalReasonRatio ?? 0.8) || 0.8,
          ),
        )
      : Math.max(
          0.9,
          Math.min(
            0.98,
            Number(t.rescueEarlyExitTerminalReasonRatio ?? 0.9) || 0.9,
          ),
        ),
    rescueP0: fastNoPassExit
      ? weakSurge && !weakGap
        ? Math.max(0.7, Math.min(0.9, Number(t.rescueP0 ?? 0.95) - 0.08))
        : Math.max(0.78, Math.min(0.9, Number(t.rescueP0 ?? 0.95) - 0.05))
      : Number(t.rescueP0 ?? 0.95),
    rescueLcbQuantile: fastNoPassExit
      ? weakSurge && !weakGap
        ? Math.max(
            0.14,
            Math.min(0.3, Number(t.rescueLcbQuantile ?? 0.1) + 0.06),
          )
        : Math.max(
            0.12,
            Math.min(0.28, Number(t.rescueLcbQuantile ?? 0.1) + 0.04),
          )
      : Number(t.rescueLcbQuantile ?? 0.1),
    shards:
      weakSurge || weakGap
        ? Math.min(
            t.limits.maxShards,
            Math.max(14, (Number(t.shards ?? 8) || 8) + 1),
          )
        : t.shards,
    topPerTrack: weakSurge
      ? Math.min(
          t.limits.maxTopPerTrack,
          Math.max(110, (Number(t.topPerTrack ?? 80) || 80) + 16),
        )
      : weakGap
        ? Math.min(
            t.limits.maxTopPerTrack,
            Math.max(96, (Number(t.topPerTrack ?? 80) || 80) + 10),
          )
        : t.topPerTrack,
    stage1MaxRounds: weakSurge
      ? Math.max(
          200,
          Math.min(260, (Number(t.stage1MaxRounds ?? 180) || 180) + 20),
        )
      : Math.max(180, Number(t.stage1MaxRounds ?? 180) || 180),
    policyEvalTopKSurge,
    policyEvalTopKGap,
    policyEvalMaxConsecutiveDays,
    policyEvalMaxConsecutiveWeeks,
    stage2TopKByTrack,
    poolRefillCountByTrack,
    seedStart: t.seedStart + 307,
  })
}

const applyTrackZeroPassProfileSwing = (
  tuning,
  failureDetail = null,
  zeroPassStreak = 0,
) => {
  const t = normalizeTuning(tuning)
  const weakTracks = parseTrackListFromFailureDetail(failureDetail)
  const weakTrackSet = new Set(weakTracks)
  const surgeOnlyWeak =
    weakTrackSet.has("SURGE_EOD") && !weakTrackSet.has("GAP_15_BET")
  // First SURGE-only miss: keep expansion to widen discovery.
  // Repeated SURGE-only misses: switch to conservative quality filter to escape all-bad pools.
  const swingConservative = surgeOnlyWeak
    ? zeroPassStreak >= 2
    : zeroPassStreak % 2 === 1
  const stage2TopKByTrack = {
    ...t.stage2TopKByTrack,
  }
  const poolRefillCountByTrack = {
    ...t.poolRefillCountByTrack,
  }
  for (const track of ["SURGE_EOD", "GAP_15_BET"]) {
    if (!weakTrackSet.has(track)) continue
    stage2TopKByTrack[track] = Math.min(
      12,
      Math.max(8, Number(stage2TopKByTrack?.[track] ?? 3) + 1),
    )
    poolRefillCountByTrack[track] = Math.min(
      12,
      Math.max(8, Number(poolRefillCountByTrack?.[track] ?? 3) + 1),
    )
  }

  const currentWorst2wBuffer = Number(t.prefilterWorst2wBuffer ?? 18) || 18
  const currentStopLikeCeil = Number(t.prefilterStopLikeCeil ?? 0.9) || 0.9
  const currentNoFillCeil = Number(t.prefilterNoFillCeil ?? 0.95) || 0.95
  const currentCarry = Number(t.failureFingerprintCarryLimit ?? 48) || 48
  const currentTopPerTrack = Number(t.topPerTrack ?? t.limits.minTopPerTrack)
  const conservativeTopPerTrack = Math.max(
    t.limits.minTopPerTrack,
    Math.min(t.limits.maxTopPerTrack, currentTopPerTrack - 20),
  )
  const expansiveTopPerTrack = Math.max(
    t.limits.minTopPerTrack,
    Math.min(t.limits.maxTopPerTrack, currentTopPerTrack + 8),
  )

  return normalizeTuning({
    ...t,
    prefilterEnabled: true,
    prefilterWorst2wBuffer: swingConservative
      ? Math.max(4, Math.min(18, currentWorst2wBuffer - 10))
      : Math.min(34, Math.max(18, currentWorst2wBuffer + 3)),
    prefilterStopLikeCeil: swingConservative
      ? Math.max(0.72, Math.min(0.86, currentStopLikeCeil - 0.08))
      : Math.min(0.97, Math.max(0.74, currentStopLikeCeil + 0.05)),
    prefilterNoFillCeil: swingConservative
      ? Math.max(0.84, Math.min(0.92, currentNoFillCeil - 0.08))
      : Math.min(0.98, Math.max(0.86, currentNoFillCeil + 0.04)),
    topPerTrack: swingConservative
      ? conservativeTopPerTrack
      : expansiveTopPerTrack,
    stage2TopKByTrack,
    poolRefillCountByTrack,
    sameFailureSignatureJumpThreshold: 2,
    sameFailureSignatureCursorMultiplier: Math.min(
      24,
      Math.max(10, Number(t.sameFailureSignatureCursorMultiplier ?? 3) + 3),
    ),
    failureFingerprintCarryLimit: Math.max(
      10,
      Math.min(24, Math.floor(currentCarry * 0.75)),
    ),
    coverageSeedLanes: Math.min(
      48,
      Math.max(16, Number(t.coverageSeedLanes ?? 4) + 4),
    ),
    seedStart: t.seedStart + 401,
  })
}

const applyMemorySafeFallback = (tuning) => {
  const t = normalizeTuning(tuning)
  return normalizeTuning({
    ...t,
    shards: Math.max(t.limits.minShards, t.shards - 1),
    topPerTrack: Math.max(t.limits.minTopPerTrack, t.topPerTrack - 6),
    stage1MaxRounds: Math.max(30, t.stage1MaxRounds - 10),
    stage2MaxRounds: Math.max(60, t.stage2MaxRounds - 20),
    envOverrides: {
      ...t.envOverrides,
      GOLIVE_MAX_RULE_CANDIDATES: "30000",
      GOLIVE_MAX_CANDIDATE_COUNT: "800",
      GOLIVE_MAX_SHAPE_K: "1500",
      BACKFILL_KIS_ENABLED: "0",
    },
  })
}

const applyTimeoutFallback = (tuning) => {
  const t = normalizeTuning(tuning)
  return normalizeTuning({
    ...t,
    shards: Math.max(t.limits.minShards, t.shards - 1),
    topPerTrack: Math.max(t.limits.minTopPerTrack, t.topPerTrack - 4),
    stage1MaxRounds: Math.max(30, t.stage1MaxRounds - 8),
    stage2MaxRounds: Math.max(80, t.stage2MaxRounds - 16),
    printEvery: Math.max(5, t.printEvery - 2),
  })
}

const round2 = (value) => Number(value.toFixed(2))

const planRuleAdjustments = ({
  failureCode,
  tuning,
  rules,
  sameFailureStreak,
  successEval,
}) => {
  const t = normalizeTuning(tuning)
  const currentRules = normalizeRulesLock(rules)
  const autoTune = t.ruleAutoTune
  if (!autoTune.enabled) {
    return { nextRules: currentRules, actions: [] }
  }
  if (sameFailureStreak < autoTune.triggerFailureStreak) {
    return { nextRules: currentRules, actions: [] }
  }

  const actions = []
  let nextRules = currentRules

  if (failureCode === "WORST2W_BELOW_THRESHOLD") {
    const floor = autoTune.minWorst2wAvgPctFloor
    const nextValue = Math.max(
      floor,
      round2(currentRules.minWorst2wAvgPct - autoTune.worst2wStep),
    )
    if (nextValue < currentRules.minWorst2wAvgPct) {
      nextRules = normalizeRulesLock({
        ...nextRules,
        minWorst2wAvgPct: nextValue,
      })
      actions.push({
        type: "ADJUST_RULES_SAFE",
        reason: "WORST2W_BELOW_THRESHOLD",
        summary: `minWorst2wAvgPct ${currentRules.minWorst2wAvgPct} -> ${nextValue}`,
      })
    }
  }

  if (
    failureCode === "PERFORMANCE_NOT_PASS" &&
    (successEval?.reasons ?? []).includes("TARGET_NOT_REACHED")
  ) {
    const safeFloor = Math.max(
      0,
      Math.min(currentRules.targetPct, autoTune.minRequireMaxTargetPassed),
    )
    const nextValue = Math.max(
      safeFloor,
      currentRules.requireMaxTargetPassed - autoTune.requireMaxTargetStep,
    )
    if (nextValue < currentRules.requireMaxTargetPassed) {
      nextRules = normalizeRulesLock({
        ...nextRules,
        requireMaxTargetPassed: nextValue,
      })
      actions.push({
        type: "ADJUST_RULES_SAFE",
        reason: "TARGET_NOT_REACHED",
        summary: `requireMaxTargetPassed ${currentRules.requireMaxTargetPassed} -> ${nextValue}`,
      })
    }
  }

  return { nextRules, actions }
}

export const planAutoActions = ({
  failureCode,
  failureDetail = null,
  tuning,
  rules,
  sameFailureStreak = 0,
  sameFailureSignatureStreak = 0,
  successEval = null,
}) => {
  const current = normalizeTuning(tuning)
  const currentRules = normalizeRulesLock(rules ?? DEFAULT_RULES_LOCK)
  const normalizedFailureCode = normalizeFailureCodeToken(failureCode)
  let nextTuning = current
  const actions = []

  if (failureCode === "OOM_RISK") {
    nextTuning = applyMemorySafeFallback(current)
    actions.push({
      type: "ADJUST_TUNING",
      reason: "OOM_RISK",
      summary: "Reduce shard parallelism and search-space caps.",
    })
  } else if (failureCode === "PROCESS_TIMEOUT") {
    nextTuning = applyTimeoutFallback(current)
    actions.push({
      type: "ADJUST_TUNING",
      reason: "PROCESS_TIMEOUT",
      summary: "Trim rounds/pool and shard width to fit timeout.",
    })
  } else if (failureCode === "DATA_COVERAGE_LOW") {
    nextTuning = normalizeTuning({
      ...current,
      dataSyncEnabled: true,
      forceDataSyncNextAttempt: true,
      deriveEnabled: false,
      dataSyncCommand:
        current.dataSyncCommand.length >= 2
          ? current.dataSyncCommand
          : [...DEFAULT_DATA_SYNC_COMMAND],
    })
    actions.push({
      type: "ENABLE_DATA_REPAIR",
      reason: "DATA_COVERAGE_LOW",
      summary: "Enable data sync stage before next attempt.",
    })
  } else if (failureCode === "ACTIVE_STRATEGY_MISSING") {
    nextTuning = normalizeTuning({
      ...current,
      forceDataSyncNextAttempt: false,
      signalGapRepairFromDateKey: "",
      signalGapRepairToDateKey: "",
      retryBackoffMs: Math.max(
        60_000,
        Number(current.retryBackoffMs ?? 0) || 0,
      ),
      seedStart: current.seedStart + 17,
    })
    actions.push({
      type: "DISABLE_FORCED_DATA_SYNC",
      reason: "ACTIVE_STRATEGY_MISSING",
      summary:
        "Stop forced data sync retries and continue candidate search while rules stay fixed.",
    })
  } else if (
    failureCode === "SURGE_POOL_EMPTY" ||
    failureCode === "POOL_EMPTY"
  ) {
    nextTuning = applySurgePoolRecovery(current)
    actions.push({
      type: "RECOVER_SURGE_POOL",
      reason: failureCode,
      summary:
        "Relax prefilter/selectivity and widen stage1 exploration to rebuild SURGE candidate pool.",
    })
  } else if (isInsufficientPoolFailureCode(normalizedFailureCode)) {
    const moonshotHeavyInsufficient =
      normalizedFailureCode === "INSUFFICIENT_POOL_MOONSHOT_GATE" ||
      includesAny(failureDetail, ["MOONSHOT"])
    nextTuning = moonshotHeavyInsufficient
      ? applyMoonshotPoolQualityRecovery(current)
      : applyInsufficientPoolRecovery(current)
    if (moonshotHeavyInsufficient) {
      nextTuning = normalizeTuning({
        ...nextTuning,
        seedStart: nextTuning.seedStart + 41,
      })
    }
    actions.push({
      type: moonshotHeavyInsufficient
        ? "RECOVER_POOL_QUALITY_MOONSHOT"
        : "RECOVER_POOL_QUALITY",
      reason: failureCode,
      summary: moonshotHeavyInsufficient
        ? "Keep rules fixed and diversify seeds/lanes with deeper rescue while avoiding redundant forced data sync."
        : "Keep rules fixed but widen rescue depth and bucket stride to find passable candidates.",
    })
    if (
      normalizedFailureCode === "INSUFFICIENT_POOL_SURGE_ONLY" ||
      normalizedFailureCode === "INSUFFICIENT_POOL_GAP_ONLY" ||
      normalizedFailureCode === "INSUFFICIENT_POOL_BOTH_TRACKS"
    ) {
      // Relax stage1 per-track floor to unblock poolset discovery path.
      nextTuning = normalizeTuning({
        ...nextTuning,
        minWorst2wPassPerTrackSurge: 0,
        minWorst2wPassPerTrackGap: 0,
      })
      actions.push({
        type: "RELAX_STAGE1_MIN_PASS_FOR_POOLSET",
        reason: failureCode,
        summary:
          "Set stage1 min-pass floor to zero for both required tracks to unblock poolset generation.",
      })

      const impliedWeakTracks =
        normalizedFailureCode === "INSUFFICIENT_POOL_SURGE_ONLY"
          ? "TRACK_ZERO_PASS:SURGE_EOD"
          : normalizedFailureCode === "INSUFFICIENT_POOL_GAP_ONLY"
            ? "TRACK_ZERO_PASS:GAP_15_BET"
            : "TRACK_ZERO_PASS:SURGE_EOD,GAP_15_BET"
      const trackZeroPassStreak = Math.max(
        Number(sameFailureStreak ?? 0) || 0,
        Number(sameFailureSignatureStreak ?? 0) || 0,
      )
      nextTuning = applyTrackZeroPassFastCycle(nextTuning)
      actions.push({
        type: "FAST_TRACK_ZERO_PASS_CYCLE",
        reason: failureCode,
        summary:
          "Track-specific insufficient pool: shorten stage2 cycle immediately for faster candidate turnover.",
      })
      nextTuning = applyTrackZeroPassDiversityBoost(
        nextTuning,
        impliedWeakTracks,
        { fastNoPassExit: true },
      )
      actions.push({
        type: "BOOST_TRACK_ZERO_PASS_DIVERSITY",
        reason: failureCode,
        summary:
          "Track-specific insufficient pool: widen seed/bucket exploration to break repeated zero-pass signatures.",
      })
      if (trackZeroPassStreak >= 1) {
        nextTuning = applyTrackZeroPassProfileSwing(
          nextTuning,
          impliedWeakTracks,
          trackZeroPassStreak,
        )
        actions.push({
          type: "SWING_TRACK_ZERO_PASS_PROFILE",
          reason: failureCode,
          summary:
            "Persistent track-specific insufficient pool: alternate conservative/expansive profile to escape lock-in.",
        })
      }
    }
  } else if (failureCode === "MOONSHOT_OUTCOME_EMPTY") {
    nextTuning = applyMoonshotOutcomeRecovery(current)
    actions.push({
      type: "RECOVER_MOONSHOT_OUTCOME_EMPTY",
      reason: failureCode,
      summary:
        "Force one data sync repair on next attempt when moonshot signals exist but outcomes are empty.",
    })
  } else if (failureCode === "MOONSHOT_SIGNAL_MISMATCH") {
    nextTuning = applySignalGapRecovery(current, failureDetail)
    actions.push({
      type: "RECOVER_MOONSHOT_SIGNAL_MISMATCH",
      reason: failureCode,
      summary:
        "Force one data sync repair and refresh seed/cursor behavior when preflight signals are present but evaluation sees zero.",
    })
  } else if (
    failureCode === "SIGNAL_GAP" ||
    failureCode === "SIGNAL_GAP_EVAL_WINDOW"
  ) {
    const range = parseSignalGapWindow(failureDetail)
    const hasCurrentWindow = Boolean(
      current.signalGapRepairFromDateKey && current.signalGapRepairToDateKey,
    )
    const isSameWindow =
      !range.fromDateKey ||
      (range.fromDateKey === current.signalGapRepairFromDateKey &&
        range.toDateKey === current.signalGapRepairToDateKey)

    if (
      failureCode === "SIGNAL_GAP_EVAL_WINDOW" &&
      current.forceDataSyncNextAttempt &&
      hasCurrentWindow &&
      isSameWindow
    ) {
      nextTuning = applyDiversityUpgrade({
        ...current,
        forceDataSyncNextAttempt: false,
      })
    } else {
      nextTuning = applySignalGapRecovery(current, failureDetail)
    }

    actions.push({
      type:
        failureCode === "SIGNAL_GAP_EVAL_WINDOW"
          ? "RECOVER_SIGNAL_GAP_EVAL_WINDOW"
          : "RECOVER_SIGNAL_GAP",
      reason: failureCode,
      summary:
        "Force one targeted data sync on missing evaluation window and rebuild recommend signals in no-KIS mode.",
    })
  } else if (failureCode === "WORST2W_TRACK_ZERO_PASS") {
    const zeroPassStreak = Math.max(
      Number(sameFailureStreak ?? 0) || 0,
      Number(sameFailureSignatureStreak ?? 0) || 0,
    )
    nextTuning = applyGateFailureTrackZeroPassRecovery(current, failureDetail)
    nextTuning = applyTrackZeroPassFastCycle(nextTuning)
    actions.push({
      type: "FAST_TRACK_ZERO_PASS_CYCLE",
      reason: failureCode,
      summary:
        "Track-level zero-pass: shorten stage2 loop immediately to iterate seeds/buckets faster while keeping rules fixed.",
    })
    nextTuning = applyTrackZeroPassDiversityBoost(nextTuning, failureDetail, {
      fastNoPassExit: true,
      preserveDeepForWeakSurge: zeroPassStreak <= 0,
    })
    nextTuning = boostDailyPassAvengers(nextTuning, {
      weakTracks: parseTrackListFromFailureDetail(failureDetail),
      aggressive: true,
    })
    actions.push({
      type: "BOOST_TRACK_ZERO_PASS_DIVERSITY",
      reason: failureCode,
      summary:
        "Track-level zero-pass: increase cursor jumps and trim carried fingerprints to force fresher candidate coverage.",
    })
    actions.push({
      type: "BOOST_DAILY_PASS_AVENGERS",
      reason: failureCode,
      summary:
        "Track-level zero-pass: widen daily-pass top roster, add poolsets, and raise recombine rounds for stronger poolset candidates.",
    })
    if (zeroPassStreak >= 1) {
      nextTuning = applyTrackZeroPassProfileSwing(
        nextTuning,
        failureDetail,
        zeroPassStreak,
      )
      actions.push({
        type: "SWING_TRACK_ZERO_PASS_PROFILE",
        reason: failureCode,
        summary:
          "Persistent zero-pass: alternate conservative/expansive prefilter profile to break repeated failure signature lock-in.",
      })
    }
    const forceDisableStage2OnZeroPass =
      String(currentRules.passMode ?? "all").toLowerCase() === "all" &&
      current?.disableStage2OnLowQualityRequiredDryOnZeroPass === true
    nextTuning = normalizeTuning({
      ...nextTuning,
      qualityCollapseResetStreak: Math.max(
        2,
        Math.min(3, Number(nextTuning.qualityCollapseResetStreak ?? 3) || 3),
      ),
    })
    if (forceDisableStage2OnZeroPass) {
      nextTuning = normalizeTuning({
        ...nextTuning,
        // In passMode=all, required-track zero-pass guarantees final fail.
        // Skip expensive dry stage2 continuation and rotate attempts faster.
        allowStage2OnLowQualityRequiredDry: false,
      })
      actions.push({
        type: "DISABLE_STAGE2_ON_LOW_QUALITY_REQUIRED_DRY",
        reason: failureCode,
        summary:
          "passMode=all zero-pass: disable dry stage2 continuation on low-quality required tracks to shorten retry cycle.",
      })
    }
    actions.push({
      type: "RECOVER_WORST2W_TRACK_ZERO_PASS",
      reason: failureCode,
      summary:
        "Track-level WORST2W zero-pass detected: widen bucket stride/lanes and raise weak-track refill+stage2 TopK while keeping rules fixed.",
    })
  } else if (
    failureCode === "WORST2W_BELOW_THRESHOLD" ||
    failureCode === "TRADE_GATE_FAIL" ||
    failureCode === "MOONSHOT_GATE_FAIL"
  ) {
    const qualityStreak = Number(sameFailureStreak ?? 0) || 0
    const parsedWeakTracks = parseTrackListFromFailureDetail(failureDetail)
    const weakTrackDetail =
      parsedWeakTracks.length > 0
        ? "TRACK_ZERO_PASS:" + parsedWeakTracks.join(",")
        : "TRACK_ZERO_PASS:SURGE_EOD,GAP_15_BET"
    nextTuning = applyGateFailureRecovery(current)
    nextTuning = applyTrackZeroPassFastCycle(nextTuning)
    nextTuning = applyTrackZeroPassDiversityBoost(nextTuning, weakTrackDetail, {
      fastNoPassExit: true,
      preserveDeepForWeakSurge: false,
      fastNoPassMinFloor: 16,
      fastNoPassMinCap: 32,
      fastNoPassEvalRatioCap: 0.2,
      fastRescueTopCap: 40,
      fastRescueDeepCap: 36,
    })
    nextTuning = boostDailyPassAvengers(nextTuning, {
      weakTracks: parsedWeakTracks,
      aggressive: qualityStreak >= 2,
    })
    nextTuning = normalizeTuning({
      ...nextTuning,
      qualityCollapseResetStreak: Math.max(
        2,
        Math.min(3, Number(nextTuning.qualityCollapseResetStreak ?? 3) || 3),
      ),
    })
    actions.push({
      type: "BOOST_QUALITY_TRACK_DIVERSITY",
      reason: failureCode,
      summary:
        "Repeated quality fail: force weak-track diversity boost (SURGE/GAP) for stage2 TopK and refill expansion.",
    })
    actions.push({
      type: "BOOST_DAILY_PASS_AVENGERS",
      reason: failureCode,
      summary:
        "Repeated quality fail: expand daily-pass ranked roster and poolset recombination depth while keeping rules fixed.",
    })
    if (qualityStreak >= 2) {
      nextTuning = applyTrackZeroPassProfileSwing(
        nextTuning,
        weakTrackDetail,
        qualityStreak,
      )
      actions.push({
        type: "SWING_QUALITY_PROFILE",
        reason: failureCode,
        summary:
          "Repeated quality fail: alternate prefilter profile and cursor jump behavior to break lock-in before expensive retries.",
      })
    }
    actions.push({
      type: "FAST_QUALITY_CYCLE",
      reason: failureCode,
      summary:
        "Quality fail detected: shorten stage2 loop to rotate seeds/buckets faster without changing rules.",
    })
    actions.push({
      type: "RECOVER_WORST2W_QUALITY",
      reason: failureCode,
      summary:
        "Increase search diversity and enforce stage1 rescue quality gate before expensive retries.",
    })
  } else if (failureCode === "PERFORMANCE_NOT_PASS") {
    nextTuning = applyDiversityUpgrade(current)
    actions.push({
      type: "EXPAND_SEARCH",
      reason: failureCode,
      summary: "Increase shards, pool width, and search rounds for diversity.",
    })
  } else {
    actions.push({
      type: "NOOP",
      reason: failureCode,
      summary: "Keep tuning unchanged due to unknown failure.",
    })
  }

  const rulePlan = planRuleAdjustments({
    failureCode,
    tuning: nextTuning,
    rules: currentRules,
    sameFailureStreak,
    successEval,
  })
  return {
    actions: [...actions, ...rulePlan.actions],
    nextTuning,
    nextRules: rulePlan.nextRules,
  }
}
