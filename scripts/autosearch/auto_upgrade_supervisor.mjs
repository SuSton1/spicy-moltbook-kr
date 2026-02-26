import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import dotenv from "dotenv"

import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"

const rootDir = process.cwd()

const toNumber = (value, fallback) => parseNumberArg(value) ?? fallback

const toBoolean = (value, fallback = false) => {
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

const clampInt = (value, fallback, min, max) => {
  if (value === null || value === undefined) return fallback
  if (typeof value === "string" && value.trim() === "") return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const isoNow = () => new Date().toISOString()

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0)))
  })

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

const writeJson = (filePath, payload) => {
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonIfChanged = (filePath, payload) => {
  const next = `${JSON.stringify(payload, null, 2)}\n`
  let prev = null
  try {
    prev = fs.readFileSync(filePath, "utf8")
  } catch {
    prev = null
  }
  if (prev === next) return
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, next, "utf8")
}

const appendNdjson = (filePath, payload) => {
  ensureParentDir(filePath)
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8")
}

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const isProcessAlive = (pid) => {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 1) return false
  try {
    process.kill(Math.floor(n), 0)
    return true
  } catch {
    return false
  }
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

const resolveAbsolutePath = (filePath) => {
  const value = String(filePath ?? "").trim()
  if (!value) return ""
  return path.isAbsolute(value) ? value : path.join(rootDir, value)
}

const createSupervisorId = () => {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
  const rand = crypto.randomBytes(3).toString("hex")
  return `sup_${ts}_${rand}`
}

const createSessionId = (sequence, supervisorId, prefix = "auto") => {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
  const seq = String(Math.max(1, sequence)).padStart(4, "0")
  const short = String(supervisorId ?? "")
    .replace(/^sup_/, "")
    .slice(-6)
  return `${prefix}_${ts}_${seq}_${short}`
}

const expectedTuningPath = "scripts/autosearch/config/tuning.mutable.json"

const NON_RETRYABLE_SESSION_STATUSES = new Set([
  "STOPPED_BY_SECURITY_GUARD",
  "STOPPED_BY_SCHEMA_VALIDATION",
  "STOPPED_BY_RUN_LOCK",
])

const STRUCTURAL_ROTATE_SESSION_STATUSES = new Set([
  "STOPPED_BY_STRUCTURAL_GUARD",
  "STOPPED_BY_PREFLIGHT_INVARIANT",
  "STOPPED_BY_STATE_MACHINE",
  "STOPPED_BY_POOL_EMPTY_LIMIT",
  "STOPPED_BY_INSUFFICIENT_POOL_RECYCLE",
  "STOPPED_BY_SAME_FAILURE_LIMIT",
  "STOPPED_BY_DATA_SYNC_LIMIT",
])

const QUALITY_SIGNAL_GAP_CODES = new Set([
  "SIGNAL_GAP",
  "SIGNAL_GAP_EVAL_WINDOW",
  "MOONSHOT_SIGNAL_MISMATCH",
  "MOONSHOT_OUTCOME_EMPTY",
])

const PATCH_REQUIRED_FAILURE_CODES = new Set([
  "SURGE_POOL_EMPTY",
  "SIGNAL_GAP",
  "SIGNAL_GAP_EVAL_WINDOW",
  "MOONSHOT_SIGNAL_MISMATCH",
  "MOONSHOT_OUTCOME_EMPTY",
  "WORST2W_BELOW_THRESHOLD",
  "TRADE_GATE_FAIL",
  "MOONSHOT_GATE_FAIL",
  "PERFORMANCE_NOT_PASS",
  "DATA_COVERAGE_LOW",
  "PREFLIGHT_INVARIANT_FAIL",
  "STATE_MACHINE_VIOLATION",
  "OOM_RISK",
])

const TIME_RESOLVABLE_FAILURE_CODES = new Set([
  "DATA_SYNC_FAIL",
  "DATA_SYNC_STALL",
  "PROCESS_TIMEOUT",
  "DERIVE_FAIL",
  "VERIFY_FAIL",
  "WAITING_APPLY_GATE",
  "RUN_LOCK_HELD",
  "INFLIGHT_SYNC_LOCKED",
])

const SECURITY_FAILURE_CODES = new Set([
  "DIRTY_TREE_BLOCKED",
  "SCHEMA_INVALID",
  "NO_KIS_REQUIRED",
  "KIS_ENABLED_BLOCKED",
  "SECRET_FILE_DETECTED",
  "RUN_LOCK_HELD",
])

const AUTO_PATCH_ALLOWLIST = new Set([
  "retryBackoffMs",
  "coverageSeedLanes",
  "seedStart",
  "topPerTrack",
  "symbolBucketTotal",
  "symbolBucketStride",
  "failureFingerprintCarryLimit",
  "prefilterWorst2wBuffer",
  "prefilterStopLikeCeil",
  "prefilterNoFillCeil",
  "allowUnsafeGapChartFallbackStage1",
  "rescueEnabled",
  "rescueTopK",
  "rescueCheapB",
  "rescueCheapM",
  "rescueDeepTopK",
  "rescueDeepB",
  "rescueDeepM",
  "rescueDeepAllowMoonshotDominant",
  "rescueEarlyExitNoPassMinEval",
  "rescueEarlyExitMinEvalRatio",
  "rescueEarlyExitTerminalReasonRatio",
  "minPoolPerTrackSurge",
  "minPoolPerTrackGap",
  "minWorst2wPassPerTrackSurge",
  "minWorst2wPassPerTrackGap",
  "dataSyncEnabled",
  "dataSyncMode",
  "dataSyncTradingDayOnly",
  "dataSyncOncePerTradingDay",
  "dataSyncSkipRetryAttempts",
  "forceDataSyncNextAttempt",
  "signalGapRepairEnabled",
  "maxParallelShards",
  "shards",
])

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

const isInsufficientPoolFailureCode = (code) =>
  normalizeCode(code).startsWith("INSUFFICIENT_POOL")

const isSecurityFailureCode = (code) =>
  SECURITY_FAILURE_CODES.has(normalizeCode(code))

const isNonRetryableSessionStatus = (status) =>
  NON_RETRYABLE_SESSION_STATUSES.has(
    String(status ?? "")
      .trim()
      .toUpperCase(),
  )

const isSuccessStatus = (status) => {
  const code = normalizeCode(status)
  return code === "SUCCESS" || code === "SUCCESS_DRY"
}

const parseArgs = () => {
  const argv = process.argv.slice(2)
  const getValue = (key) => getArgValue(argv, key)
  const dryRunOnly =
    hasFlag(argv, "--dryRunOnly") || toNumber(getValue("--dryRunOnly"), 0) === 1
  const autoApplyRaw = getValue("--autoApply")
  const rulesMutableRaw =
    getValue("--rulesMutable") ?? process.env.AUTOSEARCH_RULES_MUTABLE
  return {
    rulesPath: String(
      getValue("--rulesPath") ?? "scripts/autosearch/config/rules.lock.json",
    ).trim(),
    tuningPath: String(getValue("--tuningPath") ?? expectedTuningPath).trim(),
    maxAttemptsOverride:
      toNumber(getValue("--maxAttempts"), null) === null
        ? null
        : clampInt(toNumber(getValue("--maxAttempts"), 1), 1, 1, 100_000),
    autoApply: dryRunOnly ? false : toBoolean(autoApplyRaw, true),
    rulesMutable: toBoolean(rulesMutableRaw, false),
    dryRunOnly,
    minRestartDelayMs: clampInt(
      getValue("--minRestartDelayMs"),
      2000,
      0,
      60 * 60 * 1000,
    ),
    crashRestartDelayMs: clampInt(
      getValue("--crashRestartDelayMs"),
      15000,
      1000,
      60 * 60 * 1000,
    ),
    readyTimeoutMs: clampInt(
      getValue("--readyTimeoutMs"),
      90_000,
      2000,
      60 * 60 * 1000,
    ),
    noLoopPollMs: clampInt(getValue("--noLoopPollMs"), 2000, 500, 60_000),
    qualityGuardCooldownMs: clampInt(
      getValue("--qualityGuardCooldownMs"),
      10 * 60 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
    structuralGuardCooldownMs: clampInt(
      getValue("--structuralGuardCooldownMs"),
      2 * 60 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
    timeResolvableCooldownMs: clampInt(
      getValue("--timeResolvableCooldownMs"),
      15 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
    patchRequiredCooldownMs: clampInt(
      getValue("--patchRequiredCooldownMs"),
      2 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
    autoPatchEnabled:
      !hasFlag(argv, "--autoPatchOff") &&
      toNumber(getValue("--autoPatchEnabled"), 1) !== 0,
    autoPatchCooldownMs: clampInt(
      getValue("--autoPatchCooldownMs"),
      30 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
    autoPatchMaxPerHour: clampInt(
      getValue("--autoPatchMaxPerHour"),
      24,
      0,
      10_000,
    ),
    liveMonitorPollMs: clampInt(
      getValue("--liveMonitorPollMs"),
      3000,
      500,
      60_000,
    ),
    maxSessions: clampInt(getValue("--maxSessions"), 0, 0, 1_000_000),
    maxConsecutiveCrashLike: clampInt(
      getValue("--maxConsecutiveCrashLike"),
      3,
      1,
      50,
    ),
    stopOnSuccess:
      hasFlag(argv, "--stopOnSuccess") ||
      toNumber(getValue("--stopOnSuccess"), 0) === 1,
    sessionPrefix:
      String(getValue("--sessionPrefix") ?? "auto")
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .slice(0, 32) || "auto",
  }
}

const classifyRecoveryDecision = ({
  sessionStatus,
  failureCode,
  crashLike,
}) => {
  const status = normalizeCode(sessionStatus)
  const code = normalizeCode(failureCode)
  if (isSuccessStatus(status)) {
    return { mode: "SUCCESS", reason: "SESSION_SUCCESS" }
  }
  if (isNonRetryableSessionStatus(status) || isSecurityFailureCode(code)) {
    return { mode: "CRITICAL_STOP", reason: "SECURITY_OR_NON_RETRYABLE" }
  }
  if (
    PATCH_REQUIRED_FAILURE_CODES.has(code) ||
    isInsufficientPoolFailureCode(code)
  ) {
    return { mode: "PATCH_REQUIRED", reason: "PATCH_REQUIRED_FAILURE_CODE" }
  }
  if (
    status === "STOPPED_BY_QUALITY_GUARD" ||
    STRUCTURAL_ROTATE_SESSION_STATUSES.has(status)
  ) {
    return { mode: "PATCH_REQUIRED", reason: "GUARD_STOP_REQUIRES_PATCH" }
  }
  if (TIME_RESOLVABLE_FAILURE_CODES.has(code)) {
    return { mode: "TIME_RESOLVABLE", reason: "TIME_RESOLVABLE_FAILURE_CODE" }
  }
  if (crashLike) {
    return { mode: "TIME_RESOLVABLE", reason: "CRASH_LIKE_RETRY" }
  }
  return { mode: "TIME_RESOLVABLE", reason: "DEFAULT_RETRY" }
}

const isObjectRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const normalizePatchHistory = (value, nowMs = Date.now()) => {
  const raw = Array.isArray(value) ? value : []
  const next = raw
    .map((ts) => Number(ts))
    .filter((ts) => Number.isFinite(ts) && ts > 0 && ts <= nowMs + 60_000)
  next.sort((left, right) => left - right)
  return next
}

const buildAutoPatchPlan = ({
  failureCode,
  sessionStatus,
  tuning,
  recentPatchCount = 0,
}) => {
  const current = isObjectRecord(tuning) ? tuning : {}
  const code = normalizeCode(failureCode)
  const status = normalizeCode(sessionStatus)
  const patch = {}
  const reasons = []
  const setField = (key, nextValue, reason) => {
    if (!AUTO_PATCH_ALLOWLIST.has(key)) return
    const prevValue = current[key]
    if (jsonEqual(prevValue, nextValue)) return
    patch[key] = nextValue
    reasons.push(reason || key)
  }
  const currentInt = (key, fallback, min, max) =>
    clampInt(current[key], fallback, min, max)
  const bumpInt = (key, fallback, min, max, step = 1) => {
    const prev = currentInt(key, fallback, min, max)
    if (prev >= max) return prev
    return Math.max(min, Math.min(max, prev + Math.max(1, step)))
  }

  // Always keep public-only synchronization path active.
  setField("dataSyncEnabled", true, "ENSURE_DATA_SYNC_ENABLED")

  if (isInsufficientPoolFailureCode(code) || code === "SURGE_POOL_EMPTY") {
    setField("rescueEnabled", true, "ENABLE_RESCUE_FOR_POOL_SHORTAGE")
    setField(
      "seedStart",
      bumpInt("seedStart", 1, 1, 1_000_000_000, 1009),
      "ADVANCE_SEED_CURSOR",
    )
    setField(
      "topPerTrack",
      bumpInt("topPerTrack", 24, 8, 96, 4),
      "EXPAND_TOP_PER_TRACK",
    )
    setField(
      "coverageSeedLanes",
      bumpInt("coverageSeedLanes", 4, 1, 32, 2),
      "EXPAND_COVERAGE_SEED_LANES",
    )
    setField(
      "symbolBucketTotal",
      bumpInt("symbolBucketTotal", 8, 1, 24, 2),
      "EXPAND_SYMBOL_BUCKET_TOTAL",
    )
    setField(
      "symbolBucketStride",
      bumpInt("symbolBucketStride", 1, 1, 8, 1),
      "ROTATE_SYMBOL_BUCKET_STRIDE",
    )
    setField(
      "failureFingerprintCarryLimit",
      Math.max(
        24,
        currentInt("failureFingerprintCarryLimit", 320, 8, 5000) - 24,
      ),
      "REDUCE_FINGERPRINT_CARRY_STICKINESS",
    )
    setField(
      "prefilterWorst2wBuffer",
      bumpInt("prefilterWorst2wBuffer", 4, 0, 80, 6),
      "WIDEN_PREFILTER_WORST2W_BUFFER",
    )
    setField(
      "prefilterStopLikeCeil",
      Math.min(0.995, Number(current.prefilterStopLikeCeil ?? 0.9) + 0.02),
      "RELAX_PREFILTER_STOP_LIKE_CEIL",
    )
    setField(
      "prefilterNoFillCeil",
      Math.min(0.999, Number(current.prefilterNoFillCeil ?? 0.95) + 0.02),
      "RELAX_PREFILTER_NO_FILL_CEIL",
    )
    setField(
      "rescueTopK",
      bumpInt("rescueTopK", 20, 1, 64, 6),
      "EXPAND_RESCUE_TOPK",
    )
    setField(
      "rescueCheapB",
      bumpInt("rescueCheapB", 300, 20, 3600, 200),
      "EXPAND_RESCUE_CHEAP_B",
    )
    setField(
      "rescueCheapM",
      bumpInt("rescueCheapM", 50, 1, 256, 16),
      "EXPAND_RESCUE_CHEAP_M",
    )
    setField(
      "rescueDeepTopK",
      bumpInt("rescueDeepTopK", 12, 1, 128, 8),
      "EXPAND_RESCUE_DEEP_TOPK",
    )
    setField(
      "rescueDeepB",
      bumpInt("rescueDeepB", 600, 20, 4800, 300),
      "EXPAND_RESCUE_DEEP_B",
    )
    setField(
      "rescueDeepM",
      bumpInt("rescueDeepM", 80, 1, 256, 16),
      "EXPAND_RESCUE_DEEP_M",
    )
    setField(
      "rescueEarlyExitNoPassMinEval",
      bumpInt("rescueEarlyExitNoPassMinEval", 12, 1, 256, 6),
      "EXPAND_RESCUE_EARLY_EXIT_MIN_EVAL",
    )
    setField(
      "rescueEarlyExitMinEvalRatio",
      Math.max(
        0.45,
        Math.min(
          1,
          Number(current.rescueEarlyExitMinEvalRatio ?? 0.25) || 0.25,
        ),
      ),
      "RAISE_RESCUE_EARLY_EXIT_MIN_EVAL_RATIO",
    )
    setField(
      "rescueEarlyExitTerminalReasonRatio",
      Math.max(
        0.75,
        Math.min(
          0.95,
          Number(current.rescueEarlyExitTerminalReasonRatio ?? 0.85) || 0.85,
        ),
      ),
      "KEEP_RESCUE_EARLY_EXIT_RATIO_STABLE",
    )
    setField(
      "minWorst2wPassPerTrackSurge",
      Math.max(0, currentInt("minWorst2wPassPerTrackSurge", 2, 0, 5000) - 1),
      "KEEP_SURGE_STAGE1_MIN_PASS_GATE_FLOOR",
    )
    setField(
      "minWorst2wPassPerTrackGap",
      Math.max(0, currentInt("minWorst2wPassPerTrackGap", 2, 0, 5000) - 1),
      "KEEP_GAP_STAGE1_MIN_PASS_GATE_FLOOR",
    )
    if (code === "INSUFFICIENT_POOL_SURGE_ONLY") {
      setField(
        "minWorst2wPassPerTrackSurge",
        0,
        "ALLOW_SURGE_STAGE1_MIN_PASS_ZERO_FOR_TRACK_ISOLATION",
      )
      setField(
        "minWorst2wPassPerTrackGap",
        Math.max(1, currentInt("minWorst2wPassPerTrackGap", 1, 0, 5000)),
        "KEEP_GAP_STAGE1_MIN_PASS_GATE",
      )
    } else if (code === "INSUFFICIENT_POOL_GAP_ONLY") {
      setField(
        "minWorst2wPassPerTrackGap",
        0,
        "ALLOW_GAP_STAGE1_MIN_PASS_ZERO_FOR_TRACK_ISOLATION",
      )
      setField(
        "minWorst2wPassPerTrackSurge",
        Math.max(1, currentInt("minWorst2wPassPerTrackSurge", 1, 0, 5000)),
        "KEEP_SURGE_STAGE1_MIN_PASS_GATE",
      )
    }
    if (code === "INSUFFICIENT_POOL_MOONSHOT_GATE") {
      setField(
        "rescueDeepAllowMoonshotDominant",
        true,
        "ALLOW_DEEP_RESCUE_ON_MOONSHOT_DOMINANT",
      )
      if (Number(recentPatchCount) >= 2) {
        setField("signalGapRepairEnabled", true, "ENABLE_SIGNAL_GAP_REPAIR")
        setField(
          "forceDataSyncNextAttempt",
          false,
          "KEEP_NEXT_DATA_SYNC_OPTIONAL_FOR_QUALITY",
        )
        setField("dataSyncMode", "smart", "KEEP_DATA_SYNC_SMART_FOR_QUALITY")
        setField(
          "dataSyncSkipRetryAttempts",
          true,
          "SKIP_REDUNDANT_SYNC_ON_RETRY",
        )
      }
    }
    setField(
      "retryBackoffMs",
      Math.max(
        8000,
        Math.min(45_000, currentInt("retryBackoffMs", 120000, 0, 86_400_000)),
      ),
      "LOWER_BACKOFF_FOR_FAST_RECOVERY",
    )
  }

  if (QUALITY_SIGNAL_GAP_CODES.has(code) || code === "SIGNAL_GAP_EVAL_WINDOW") {
    setField("signalGapRepairEnabled", true, "ENABLE_SIGNAL_GAP_REPAIR")
    setField("forceDataSyncNextAttempt", true, "FORCE_NEXT_DATA_SYNC")
    setField("dataSyncMode", "weekly_strict", "SET_DATA_SYNC_WEEKLY_STRICT")
    setField("dataSyncTradingDayOnly", true, "KEEP_TRADING_DAY_ONLY_SYNC")
    setField(
      "dataSyncOncePerTradingDay",
      true,
      "KEEP_ONCE_PER_TRADING_DAY_SYNC",
    )
    setField("dataSyncSkipRetryAttempts", true, "SKIP_REDUNDANT_SYNC_ON_RETRY")
  }

  if (
    code === "OOM_RISK" ||
    code === "PROCESS_TIMEOUT" ||
    code === "DATA_SYNC_FAIL" ||
    code === "DATA_SYNC_STALL"
  ) {
    setField("maxParallelShards", 1, "LOW_RAM_FORCE_SINGLE_PARALLEL_SHARD")
    setField(
      "shards",
      Math.max(2, Math.min(4, currentInt("shards", 4, 1, 128))),
      "LOW_RAM_LIMIT_SHARDS",
    )
    setField(
      "rescueDeepB",
      Math.max(800, Math.min(2400, currentInt("rescueDeepB", 600, 1, 100000))),
      "LOW_RAM_CAP_RESCUE_DEEP_B",
    )
    setField(
      "rescueDeepM",
      Math.max(80, Math.min(192, currentInt("rescueDeepM", 80, 1, 100000))),
      "LOW_RAM_CAP_RESCUE_DEEP_M",
    )
  }

  if (
    code === "WORST2W_BELOW_THRESHOLD" ||
    code === "TRADE_GATE_FAIL" ||
    code === "MOONSHOT_GATE_FAIL" ||
    code === "PERFORMANCE_NOT_PASS"
  ) {
    setField("rescueEnabled", true, "ENABLE_RESCUE_FOR_GATE_FAILURE")
    setField(
      "minWorst2wPassPerTrackSurge",
      Math.max(0, currentInt("minWorst2wPassPerTrackSurge", 2, 0, 5000)),
      "KEEP_SURGE_STAGE1_MIN_PASS_GATE",
    )
    setField(
      "minWorst2wPassPerTrackGap",
      Math.max(0, currentInt("minWorst2wPassPerTrackGap", 2, 0, 5000)),
      "KEEP_GAP_STAGE1_MIN_PASS_GATE",
    )
    setField(
      "prefilterStopLikeCeil",
      Math.max(
        0.6,
        Math.min(0.98, Number(current.prefilterStopLikeCeil ?? 0.9) - 0.03),
      ),
      "TIGHTEN_PREFILTER_STOP_LIKE_CEIL",
    )
    setField(
      "prefilterNoFillCeil",
      Math.max(
        0.75,
        Math.min(0.99, Number(current.prefilterNoFillCeil ?? 0.95) - 0.03),
      ),
      "TIGHTEN_PREFILTER_NO_FILL_CEIL",
    )
    setField(
      "rescueDeepTopK",
      Math.min(24, currentInt("rescueDeepTopK", 12, 1, 500) + 2),
      "EXPAND_RESCUE_DEEP_TOPK",
    )
    setField(
      "rescueDeepB",
      Math.min(3600, currentInt("rescueDeepB", 600, 1, 100000) + 200),
      "EXPAND_RESCUE_DEEP_B",
    )
    setField(
      "rescueDeepM",
      Math.min(320, currentInt("rescueDeepM", 80, 1, 100000) + 16),
      "EXPAND_RESCUE_DEEP_M",
    )
    setField(
      "allowUnsafeGapChartFallbackStage1",
      true,
      "ENABLE_UNSAFE_GAP_CHART_FALLBACK_STAGE1_FOR_QUALITY_RECOVERY",
    )
  }

  if (
    status === "STOPPED_BY_QUALITY_GUARD" &&
    !isInsufficientPoolFailureCode(code) &&
    !QUALITY_SIGNAL_GAP_CODES.has(code)
  ) {
    setField(
      "retryBackoffMs",
      Math.max(
        5000,
        Math.min(30_000, currentInt("retryBackoffMs", 120000, 0, 86_400_000)),
      ),
      "QUALITY_GUARD_FAST_RETRY",
    )
  }

  return {
    patch,
    patchKeys: Object.keys(patch),
    reasons,
    code,
    status,
  }
}

const applyAutoPatchFromFailure = ({
  enabled,
  tuningPath,
  sessionStatus,
  failureCode,
  nowMs = Date.now(),
  patchHistory = [],
  lastPatchAtMs = 0,
  cooldownMs = 30_000,
  maxPerHour = 24,
}) => {
  const history = normalizePatchHistory(patchHistory, nowMs).filter(
    (ts) => nowMs - ts <= 60 * 60 * 1000,
  )
  const nextState = {
    patchHistory: history,
    lastPatchAtMs: Number(lastPatchAtMs) || 0,
  }
  if (!enabled) {
    return {
      applied: false,
      reason: "AUTO_PATCH_DISABLED",
      ...nextState,
    }
  }
  const decision = classifyRecoveryDecision({
    sessionStatus,
    failureCode,
    crashLike: false,
  })
  if (decision.mode !== "PATCH_REQUIRED") {
    return {
      applied: false,
      reason: "RECOVERY_MODE_NOT_PATCH_REQUIRED",
      decision,
      ...nextState,
    }
  }
  if (cooldownMs > 0 && nowMs - (Number(lastPatchAtMs) || 0) < cooldownMs) {
    return {
      applied: false,
      reason: "AUTO_PATCH_COOLDOWN",
      cooldownRemainingMs: Math.max(
        0,
        cooldownMs - (nowMs - (Number(lastPatchAtMs) || 0)),
      ),
      decision,
      ...nextState,
    }
  }
  if (maxPerHour > 0 && history.length >= maxPerHour) {
    return {
      applied: false,
      reason: "AUTO_PATCH_RATE_LIMIT",
      decision,
      patchesLastHour: history.length,
      ...nextState,
    }
  }
  const absTuningPath = resolveAbsolutePath(tuningPath)
  if (!absTuningPath) {
    return {
      applied: false,
      reason: "INVALID_TUNING_PATH",
      decision,
      ...nextState,
    }
  }
  const absExpectedTuningPath = resolveAbsolutePath(expectedTuningPath)
  if (
    absExpectedTuningPath &&
    path.resolve(absTuningPath) !== path.resolve(absExpectedTuningPath)
  ) {
    return {
      applied: false,
      reason: "POLICY_CONFLICT_BLOCKED",
      detail: `tuningPath must be ${expectedTuningPath}`,
      decision,
      ...nextState,
    }
  }
  const current = readJsonSafe(absTuningPath)
  if (!isObjectRecord(current)) {
    return {
      applied: false,
      reason: "TUNING_FILE_INVALID",
      decision,
      tuningPath: absTuningPath,
      ...nextState,
    }
  }
  const plan = buildAutoPatchPlan({
    failureCode,
    sessionStatus,
    tuning: current,
    recentPatchCount: history.length,
  })
  if (!plan.patchKeys.length) {
    return {
      applied: false,
      reason: "NO_PATCH_NEEDED",
      decision,
      plan,
      tuningPath: absTuningPath,
      ...nextState,
    }
  }
  const nextTuning = { ...current, ...plan.patch }
  writeJsonIfChanged(absTuningPath, nextTuning)
  const updatedHistory = [...history, nowMs]
  return {
    applied: true,
    reason: "PATCH_APPLIED",
    decision,
    plan,
    tuningPath: absTuningPath,
    patchHistory: updatedHistory,
    lastPatchAtMs: nowMs,
  }
}

const resolveAdaptiveRestartDelayMs = ({
  args,
  decisionMode,
  failureCode,
  crashLike,
  patchApplied,
  consecutiveSignalGapQualityStops,
  consecutiveStructuralStops,
}) => {
  const code = normalizeCode(failureCode)
  let delayMs = crashLike ? args.crashRestartDelayMs : args.minRestartDelayMs
  if (decisionMode === "PATCH_REQUIRED") {
    delayMs = patchApplied
      ? Math.max(0, args.patchRequiredCooldownMs)
      : Math.max(delayMs, args.patchRequiredCooldownMs)
  } else if (decisionMode === "TIME_RESOLVABLE") {
    if (
      code === "RUN_LOCK_HELD" ||
      code === "INFLIGHT_SYNC_LOCKED" ||
      code === "LOCK_HELD"
    ) {
      delayMs = Math.max(delayMs, 5000)
    } else if (
      code === "DATA_SYNC_FAIL" ||
      code === "DATA_SYNC_STALL" ||
      code === "PROCESS_TIMEOUT" ||
      code === "DERIVE_FAIL" ||
      code === "VERIFY_FAIL"
    ) {
      delayMs = Math.max(delayMs, args.timeResolvableCooldownMs)
    } else if (code === "WAITING_APPLY_GATE") {
      delayMs = Math.max(delayMs, 2000)
    }
  }
  if (consecutiveSignalGapQualityStops >= 2) {
    delayMs = Math.max(delayMs, args.qualityGuardCooldownMs)
  }
  if (consecutiveStructuralStops >= 2) {
    delayMs = Math.max(delayMs, args.structuralGuardCooldownMs)
  }
  return Math.max(0, Math.floor(Number(delayMs) || 0))
}

const acquireSupervisorLock = ({
  lockPath,
  supervisorId,
  staleMs = 8 * 60 * 60 * 1000,
}) => {
  ensureParentDir(lockPath)
  const payload = {
    supervisorId,
    pid: process.pid,
    startedAt: isoNow(),
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      })
      return { acquired: true, payload, lockPath }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error
      }
      const existing = readJsonSafe(lockPath)
      const holderPid = Number(existing?.pid ?? 0) || 0
      const startedAtMs = Date.parse(String(existing?.startedAt ?? ""))
      const stale =
        Number.isFinite(startedAtMs) && Date.now() - startedAtMs > staleMs
      if (!isProcessAlive(holderPid) || stale) {
        try {
          fs.unlinkSync(lockPath)
          continue
        } catch {
          // keep evaluating holder below
        }
      }
      return {
        acquired: false,
        reason: "LOCK_HELD",
        holderPid,
        existing,
        lockPath,
      }
    }
  }
  return { acquired: false, reason: "LOCK_CONFLICT_RETRY_EXHAUSTED", lockPath }
}

const releaseSupervisorLock = ({ lockPath, supervisorId }) => {
  if (!lockPath || !fs.existsSync(lockPath)) return
  const existing = readJsonSafe(lockPath)
  const owner = String(existing?.supervisorId ?? "").trim()
  const pid = Number(existing?.pid ?? 0) || 0
  if (
    (owner && owner !== String(supervisorId ?? "").trim()) ||
    (pid > 0 && pid !== process.pid)
  ) {
    return
  }
  try {
    fs.unlinkSync(lockPath)
  } catch {
    // ignore
  }
}

const listAutoUpgradeLoopPids = () => {
  const probe = spawnSync(
    "pgrep",
    ["-f", "scripts/autosearch/auto_upgrade_loop.mjs"],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  )
  if (probe.error) {
    return []
  }
  const raw = String(probe.stdout ?? "").trim()
  if (!raw) {
    return []
  }
  return raw
    .split(/\s+/)
    .map((row) => Number(row))
    .filter((pid) => Number.isFinite(pid) && pid > 1)
}

const waitForNoOtherLoopProcess = async ({
  timeoutMs,
  pollMs,
  allowedPids = [],
}) => {
  const allowed = new Set(
    allowedPids
      .map((pid) => Number(pid))
      .filter((pid) => Number.isFinite(pid) && pid > 1),
  )
  const startedAt = Date.now()
  let foreign = []
  do {
    foreign = listAutoUpgradeLoopPids().filter((pid) => !allowed.has(pid))
    if (foreign.length === 0) {
      return { ready: true, waitedMs: Date.now() - startedAt, foreignPids: [] }
    }
    await sleep(pollMs)
  } while (Date.now() - startedAt < timeoutMs)
  return {
    ready: false,
    waitedMs: Date.now() - startedAt,
    foreignPids: foreign,
  }
}

const cleanupStaleDataSyncLock = ({ lockPath }) => {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { removed: false, reason: "LOCK_NOT_FOUND" }
  }
  const payload = readJsonSafe(lockPath) ?? {}
  const pid = Number(payload?.pid ?? 0) || 0
  if (pid > 1 && isProcessAlive(pid)) {
    return { removed: false, reason: "LOCK_OWNER_ALIVE", pid }
  }
  try {
    fs.unlinkSync(lockPath)
    return { removed: true, reason: "STALE_LOCK_REMOVED", pid }
  } catch (error) {
    return {
      removed: false,
      reason: "LOCK_REMOVE_FAILED",
      pid,
      error: String(error?.message ?? error ?? "unknown"),
    }
  }
}

const cleanupStaleLoopRunLock = ({ lockPath, minAgeMs = 60_000 } = {}) => {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { removed: false, reason: "LOCK_NOT_FOUND" }
  }
  const payload = readJsonSafe(lockPath) ?? {}
  const pid = Number(payload?.pid ?? 0) || 0
  if (pid > 1 && isProcessAlive(pid)) {
    return { removed: false, reason: "LOCK_OWNER_ALIVE", pid }
  }
  const lockTsMs = Math.max(
    parseIsoMs(payload?.updatedAt),
    parseIsoMs(payload?.createdAt),
    safeMtimeMs(lockPath),
  )
  const ageMs = Number.isFinite(lockTsMs) ? Date.now() - lockTsMs : Number.NaN
  if (
    Number.isFinite(ageMs) &&
    ageMs < Math.max(30_000, Number(minAgeMs) || 0)
  ) {
    return {
      removed: false,
      reason: "LOCK_OWNER_DEAD_BUT_TOO_FRESH",
      pid,
      ageMs,
      sessionId: String(payload?.sessionId ?? "").trim() || null,
    }
  }
  try {
    fs.unlinkSync(lockPath)
    return {
      removed: true,
      reason: "STALE_LOOP_RUN_LOCK_REMOVED",
      pid,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      sessionId: String(payload?.sessionId ?? "").trim() || null,
    }
  } catch (error) {
    return {
      removed: false,
      reason: "LOCK_REMOVE_FAILED",
      pid,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      sessionId: String(payload?.sessionId ?? "").trim() || null,
      error: String(error?.message ?? error ?? "unknown"),
    }
  }
}

const safeMtimeMs = (filePath) => {
  try {
    return Number(fs.statSync(filePath).mtimeMs)
  } catch {
    return Number.NaN
  }
}

const parseIsoMs = (value) => {
  const ts = String(value ?? "").trim()
  if (!ts) return Number.NaN
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : Number.NaN
}

const markStaleRunningSessions = ({
  automationRootDir,
  sessionsIndexPath,
  staleThresholdMs = 2 * 60 * 1000,
}) => {
  if (!fs.existsSync(automationRootDir)) {
    return { scanned: 0, reconciled: [] }
  }
  const dirs = fs
    .readdirSync(automationRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_index")
    .map((entry) => entry.name)
  const reconciled = []
  for (const sessionId of dirs) {
    const sessionDir = path.join(automationRootDir, sessionId)
    const finalPath = path.join(sessionDir, "final_result.json")
    if (fs.existsSync(finalPath)) {
      continue
    }
    const progressPath = path.join(sessionDir, "session_progress.json")
    const progress = readJsonSafe(progressPath)
    if (!progress || typeof progress !== "object") {
      continue
    }
    const status = String(progress.status ?? "")
      .trim()
      .toUpperCase()
    if (status !== "RUNNING") {
      continue
    }
    const pid = Number(progress.pid ?? 0) || 0
    if (pid > 1 && isProcessAlive(pid)) {
      continue
    }
    const updatedAtMs = Math.max(
      parseIsoMs(progress.lastUpdatedAt),
      parseIsoMs(progress.startedAt),
      safeMtimeMs(progressPath),
    )
    if (!Number.isFinite(updatedAtMs)) {
      continue
    }
    const ageMs = Date.now() - updatedAtMs
    if (ageMs < Math.max(60_000, Number(staleThresholdMs) || 0)) {
      continue
    }
    const endedAt = isoNow()
    const staleSeconds = Math.floor(ageMs / 1000)
    const nextProgress = {
      ...progress,
      status: "ABORTED_STALE",
      lastFailureCode: "ABORTED_STALE",
      lastFailureDetail: `dead pid stale=${staleSeconds}s`,
      lastUpdatedAt: endedAt,
    }
    writeJson(progressPath, nextProgress)
    writeJson(finalPath, {
      sessionId,
      endedAt,
      result: {
        status: "ABORTED_STALE",
        reason: "RUNNING_WITH_DEAD_PID",
        staleSeconds,
      },
    })
    appendNdjson(sessionsIndexPath, {
      ts: endedAt,
      sessionId,
      event: "ABORTED_STALE",
      status: "ABORTED_STALE",
      sessionDir,
      staleSeconds,
    })
    reconciled.push({ sessionId, pid, staleSeconds })
  }
  return { scanned: dirs.length, reconciled }
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "autosearch/auto_upgrade_supervisor" })
  assertNoKisRuntime({ script: "autosearch/auto_upgrade_supervisor" })

  const args = parseArgs()
  const supervisorId = createSupervisorId()
  const automationRootDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_automation",
  )
  const compatSupervisorDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_supervisor",
  )
  const indexDir = path.join(automationRootDir, "_index")
  fs.mkdirSync(indexDir, { recursive: true })
  fs.mkdirSync(compatSupervisorDir, { recursive: true })
  const statePath = path.join(indexDir, "supervisor_state.json")
  const eventsPath = path.join(indexDir, "supervisor_events.ndjson")
  const compatLatestPidPath = path.join(
    compatSupervisorDir,
    "supervisor.latest.pid",
  )
  const compatLatestStatePath = path.join(
    compatSupervisorDir,
    "supervisor.latest.json",
  )
  const sessionsIndexPath = path.join(indexDir, "sessions.ndjson")
  const lockPath = path.join(indexDir, "auto_upgrade_supervisor.lock")
  const dataSyncLockPath = path.join(indexDir, "data_sync.lock")
  const loopRunLockPath = path.join(indexDir, "auto_upgrade_loop.lock")
  const lock = acquireSupervisorLock({ lockPath, supervisorId })
  if (lock.acquired !== true) {
    throw new Error(
      `[auto-supervisor] another supervisor is running pid=${lock.holderPid ?? "unknown"} lock=${lockPath}`,
    )
  }

  let activeChild = null
  let stopRequested = false
  let sessionsStarted = 0
  let sessionsCompleted = 0
  let lastSessionStatus = null
  let lastSessionId = null
  let lastExitCode = null
  let lastExitSignal = null
  let consecutiveCrashCount = 0
  let consecutiveSignalGapQualityStops = 0
  let consecutiveStructuralStops = 0
  let autoPatchHistory = []
  let lastAutoPatchAtMs = 0
  let autoPatchAppliedCount = 0
  let lastAutoPatchResult = null

  fs.writeFileSync(compatLatestPidPath, `${process.pid}\n`, "utf8")

  const updateState = (patch = {}) => {
    const payload = {
      supervisorId,
      pid: process.pid,
      startedAt: state.startedAt,
      status: state.status,
      sessionPrefix: args.sessionPrefix,
      sessionsStarted,
      sessionsCompleted,
      lastSessionId,
      lastSessionStatus,
      lastExitCode,
      lastExitSignal,
      consecutiveCrashCount,
      consecutiveSignalGapQualityStops,
      consecutiveStructuralStops,
      autoPatchEnabled: args.autoPatchEnabled,
      autoPatchAppliedCount,
      lastAutoPatchAt:
        lastAutoPatchAtMs > 0
          ? new Date(lastAutoPatchAtMs).toISOString()
          : null,
      patchesLastHour: normalizePatchHistory(autoPatchHistory).filter(
        (ts) => Date.now() - ts <= 60 * 60 * 1000,
      ).length,
      lastAutoPatchResult,
      updatedAt: isoNow(),
      ...patch,
    }
    writeJsonIfChanged(statePath, payload)
    writeJsonIfChanged(compatLatestStatePath, payload)
  }

  const appendEvent = (event, extra = {}) => {
    appendNdjson(eventsPath, {
      ts: isoNow(),
      supervisorId,
      pid: process.pid,
      event,
      sessionsStarted,
      sessionsCompleted,
      lastSessionId,
      lastSessionStatus,
      ...extra,
    })
  }

  const state = {
    startedAt: isoNow(),
    status: "RUNNING",
  }

  const requestStop = (signal) => {
    stopRequested = true
    state.status = "STOPPING"
    updateState({ status: state.status, stopSignal: signal })
    appendEvent("SUPERVISOR_STOP_SIGNAL", { signal })
    if (activeChild && isProcessAlive(activeChild.pid)) {
      try {
        activeChild.kill("SIGTERM")
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (activeChild && isProcessAlive(activeChild.pid)) {
          try {
            activeChild.kill("SIGKILL")
          } catch {
            // ignore
          }
        }
      }, 20_000).unref?.()
    }
  }

  process.on("SIGINT", () => requestStop("SIGINT"))
  process.on("SIGTERM", () => requestStop("SIGTERM"))

  const pulse = setInterval(() => {
    updateState({ status: state.status })
    const loopLockCleanup = cleanupStaleLoopRunLock({
      lockPath: loopRunLockPath,
      minAgeMs: 5000,
    })
    if (loopLockCleanup.removed) {
      appendEvent("STALE_LOOP_RUN_LOCK_CLEANED", loopLockCleanup)
    }
    const pulseReconcile = markStaleRunningSessions({
      automationRootDir,
      sessionsIndexPath,
    })
    if ((pulseReconcile?.reconciled?.length ?? 0) > 0) {
      appendEvent("STALE_RUNNING_RECONCILED", {
        count: pulseReconcile.reconciled.length,
        scanned: pulseReconcile.scanned,
        sessions: pulseReconcile.reconciled,
      })
    }
  }, 15_000)
  if (typeof pulse.unref === "function") {
    pulse.unref()
  }

  appendEvent("SUPERVISOR_STARTED", {
    rulesPath: args.rulesPath,
    tuningPath: args.tuningPath,
    minRestartDelayMs: args.minRestartDelayMs,
    crashRestartDelayMs: args.crashRestartDelayMs,
    timeResolvableCooldownMs: args.timeResolvableCooldownMs,
    patchRequiredCooldownMs: args.patchRequiredCooldownMs,
    autoPatchEnabled: args.autoPatchEnabled,
    autoPatchCooldownMs: args.autoPatchCooldownMs,
    autoPatchMaxPerHour: args.autoPatchMaxPerHour,
    liveMonitorPollMs: args.liveMonitorPollMs,
    readyTimeoutMs: args.readyTimeoutMs,
    maxSessions: args.maxSessions,
    maxConsecutiveCrashLike: args.maxConsecutiveCrashLike,
    qualityGuardCooldownMs: args.qualityGuardCooldownMs,
    structuralGuardCooldownMs: args.structuralGuardCooldownMs,
  })
  updateState({ status: state.status })
  const startupReconcile = markStaleRunningSessions({
    automationRootDir,
    sessionsIndexPath,
  })
  const startupLoopLockCleanup = cleanupStaleLoopRunLock({
    lockPath: loopRunLockPath,
    minAgeMs: 5000,
  })
  if (startupLoopLockCleanup.removed) {
    appendEvent("STALE_LOOP_RUN_LOCK_CLEANED", startupLoopLockCleanup)
  }
  if ((startupReconcile?.reconciled?.length ?? 0) > 0) {
    appendEvent("STALE_RUNNING_RECONCILED", {
      count: startupReconcile.reconciled.length,
      scanned: startupReconcile.scanned,
      sessions: startupReconcile.reconciled,
    })
  }

  try {
    while (!stopRequested) {
      if (args.maxSessions > 0 && sessionsStarted >= args.maxSessions) {
        appendEvent("SUPERVISOR_MAX_SESSIONS_REACHED", {
          maxSessions: args.maxSessions,
        })
        break
      }

      const readyGate = await waitForNoOtherLoopProcess({
        timeoutMs: args.readyTimeoutMs,
        pollMs: args.noLoopPollMs,
      })
      if (!readyGate.ready) {
        appendEvent("READINESS_WAIT_TIMEOUT", {
          waitedMs: readyGate.waitedMs,
          foreignPids: readyGate.foreignPids,
        })
        await sleep(args.crashRestartDelayMs)
        continue
      }

      const lockCleanup = cleanupStaleDataSyncLock({
        lockPath: dataSyncLockPath,
      })
      if (lockCleanup.removed) {
        appendEvent("STALE_DATA_SYNC_LOCK_CLEANED", lockCleanup)
      }
      const loopLockCleanup = cleanupStaleLoopRunLock({
        lockPath: loopRunLockPath,
        minAgeMs: 5000,
      })
      if (loopLockCleanup.removed) {
        appendEvent("STALE_LOOP_RUN_LOCK_CLEANED", loopLockCleanup)
      }
      const loopReconcile = markStaleRunningSessions({
        automationRootDir,
        sessionsIndexPath,
      })
      if ((loopReconcile?.reconciled?.length ?? 0) > 0) {
        appendEvent("STALE_RUNNING_RECONCILED", {
          count: loopReconcile.reconciled.length,
          scanned: loopReconcile.scanned,
          sessions: loopReconcile.reconciled,
        })
      }

      sessionsStarted += 1
      const sessionId = createSessionId(
        sessionsStarted,
        supervisorId,
        args.sessionPrefix,
      )
      lastSessionId = sessionId

      const loopScriptPath = resolveAbsolutePath(
        "scripts/autosearch/auto_upgrade_loop.mjs",
      )
      const childArgs = [
        loopScriptPath,
        `--sessionId=${sessionId}`,
        `--rulesPath=${args.rulesPath}`,
        `--tuningPath=${args.tuningPath}`,
        `--autoApply=${args.autoApply ? 1 : 0}`,
      ]
      if (args.rulesMutable) {
        childArgs.push("--rulesMutable=1")
      }
      if (args.dryRunOnly) {
        childArgs.push("--dryRunOnly")
      }
      if (args.maxAttemptsOverride !== null) {
        childArgs.push(`--maxAttempts=${args.maxAttemptsOverride}`)
      }

      appendEvent("SESSION_SPAWN", {
        sessionId,
        childArgs,
      })
      updateState({
        status: "RUNNING",
        activeSessionId: sessionId,
      })

      activeChild = spawn(process.execPath, childArgs, {
        cwd: rootDir,
        stdio: "inherit",
        env: {
          ...process.env,
          NO_KIS: "1",
          BACKFILL_DISABLE_KIS: "1",
          BACKFILL_KIS_ENABLED: "0",
        },
      })
      const activePid = Number(activeChild.pid ?? 0) || 0
      updateState({
        activeSessionId: sessionId,
        activeChildPid: activePid || null,
      })

      const sessionDir = path.join(automationRootDir, sessionId)
      const sessionProgressPath = path.join(sessionDir, "session_progress.json")
      const sessionRiskPath = path.join(sessionDir, "risk_events.ndjson")
      let liveProgressSignature = null
      let liveRiskSignature = null
      const liveMonitor = setInterval(() => {
        const progress = readJsonSafe(sessionProgressPath)
        if (!isObjectRecord(progress)) {
          return
        }
        const progressSignature = [
          normalizeCode(progress.status),
          Number(progress.currentAttempt ?? 0) || 0,
          String(progress.lastStage ?? "").trim(),
          normalizeCode(progress.lastRiskCode),
          String(progress.lastRiskAt ?? "").trim(),
        ].join("|")
        if (progressSignature !== liveProgressSignature) {
          liveProgressSignature = progressSignature
          appendEvent("SESSION_LIVE_PROGRESS", {
            sessionId,
            status: String(progress.status ?? "").trim(),
            currentAttempt: Number(progress.currentAttempt ?? 0) || 0,
            lastStage: String(progress.lastStage ?? "").trim() || null,
            lastRiskCode: normalizeCode(progress.lastRiskCode) || null,
            riskEventsCount: Number(progress.riskEventsCount ?? 0) || 0,
          })
        }
        const riskCode = normalizeCode(progress.lastRiskCode)
        if (riskCode) {
          const riskSignature = `${riskCode}|${String(progress.lastRiskAt ?? "").trim()}`
          if (riskSignature !== liveRiskSignature) {
            liveRiskSignature = riskSignature
            const riskDecision = classifyRecoveryDecision({
              sessionStatus: progress.status,
              failureCode: riskCode,
              crashLike: false,
            })
            appendEvent("SESSION_LIVE_RISK_CLASSIFIED", {
              sessionId,
              riskCode,
              riskAt: String(progress.lastRiskAt ?? "").trim() || null,
              riskStage: String(progress.lastRiskStage ?? "").trim() || null,
              decision: riskDecision.mode,
              reason: riskDecision.reason,
              progressPath: sessionProgressPath,
              riskPath: sessionRiskPath,
            })
            if (
              riskDecision.mode === "CRITICAL_STOP" &&
              activeChild &&
              isProcessAlive(activeChild.pid)
            ) {
              appendEvent("SESSION_LIVE_CRITICAL_TERMINATE", {
                sessionId,
                riskCode,
              })
              try {
                activeChild.kill("SIGTERM")
              } catch {
                // ignore and let normal exit path handle it
              }
            }
          }
        }
      }, args.liveMonitorPollMs)
      if (typeof liveMonitor.unref === "function") {
        liveMonitor.unref()
      }

      const childExit = await new Promise((resolve) => {
        activeChild.once("error", (error) => {
          resolve({
            code: null,
            signal: null,
            error: String(error?.message ?? error ?? "unknown"),
          })
        })
        activeChild.once("exit", (code, signal) => {
          resolve({
            code: Number.isFinite(code) ? Number(code) : null,
            signal: signal ?? null,
            error: null,
          })
        })
      })
      clearInterval(liveMonitor)
      activeChild = null
      sessionsCompleted += 1

      const finalPayload = readJsonSafe(
        path.join(sessionDir, "final_result.json"),
      )
      const progressPayload = readJsonSafe(
        path.join(sessionDir, "session_progress.json"),
      )
      const sessionStatus = String(
        finalPayload?.result?.status ?? progressPayload?.status ?? "UNKNOWN",
      ).trim()
      const sessionFailureCode = String(finalPayload?.result?.failureCode ?? "")
        .trim()
        .toUpperCase()
      const crashLike =
        childExit.code !== 0 ||
        sessionStatus === "FAILED_CRASH" ||
        !finalPayload?.result

      const signalGapQualityStop =
        sessionStatus === "STOPPED_BY_QUALITY_GUARD" &&
        QUALITY_SIGNAL_GAP_CODES.has(sessionFailureCode)
      if (signalGapQualityStop) {
        consecutiveSignalGapQualityStops += 1
      } else {
        consecutiveSignalGapQualityStops = 0
      }
      const structuralRotateStop = STRUCTURAL_ROTATE_SESSION_STATUSES.has(
        String(sessionStatus ?? "")
          .trim()
          .toUpperCase(),
      )
      if (structuralRotateStop) {
        consecutiveStructuralStops += 1
      } else {
        consecutiveStructuralStops = 0
      }

      lastSessionStatus = sessionStatus
      lastExitCode = childExit.code
      lastExitSignal = childExit.signal
      consecutiveCrashCount = crashLike ? consecutiveCrashCount + 1 : 0

      appendEvent("SESSION_EXIT", {
        sessionId,
        sessionStatus,
        finalResult: finalPayload?.result ?? null,
        exitCode: childExit.code,
        exitSignal: childExit.signal,
        childError: childExit.error,
        crashLike,
        consecutiveCrashCount,
        sessionFailureCode: sessionFailureCode || null,
        signalGapQualityStop,
        consecutiveSignalGapQualityStops,
        structuralRotateStop,
        consecutiveStructuralStops,
      })
      updateState({
        activeSessionId: null,
        activeChildPid: null,
        lastSessionId: sessionId,
        lastSessionStatus: sessionStatus,
        lastExitCode: childExit.code,
        lastExitSignal: childExit.signal,
        consecutiveCrashCount,
        consecutiveSignalGapQualityStops,
        consecutiveStructuralStops,
      })

      if (stopRequested) {
        break
      }
      if (args.stopOnSuccess && isSuccessStatus(sessionStatus)) {
        appendEvent("SUPERVISOR_STOP_ON_SUCCESS", {
          sessionId,
          sessionStatus,
        })
        break
      }
      const recoveryDecision = classifyRecoveryDecision({
        sessionStatus,
        failureCode: sessionFailureCode,
        crashLike,
      })
      appendEvent("SESSION_RECOVERY_CLASSIFIED", {
        sessionId,
        sessionStatus,
        sessionFailureCode: sessionFailureCode || null,
        decision: recoveryDecision.mode,
        reason: recoveryDecision.reason,
      })
      if (recoveryDecision.mode === "CRITICAL_STOP") {
        appendEvent("SUPERVISOR_STOP_ON_CRITICAL_RISK", {
          sessionId,
          sessionStatus,
          sessionFailureCode: sessionFailureCode || null,
          reason: recoveryDecision.reason,
        })
        break
      }
      if (
        crashLike &&
        consecutiveCrashCount >= Math.max(1, args.maxConsecutiveCrashLike)
      ) {
        appendEvent("SUPERVISOR_STOP_ON_CRASH_LOOP", {
          sessionId,
          sessionStatus,
          crashLike,
          consecutiveCrashCount,
          limit: args.maxConsecutiveCrashLike,
        })
        break
      }

      let patchOutcome = {
        applied: false,
        reason: "PATCH_NOT_TRIGGERED",
      }
      if (recoveryDecision.mode === "PATCH_REQUIRED") {
        patchOutcome = applyAutoPatchFromFailure({
          enabled: args.autoPatchEnabled,
          tuningPath: args.tuningPath,
          sessionStatus,
          failureCode: sessionFailureCode,
          nowMs: Date.now(),
          patchHistory: autoPatchHistory,
          lastPatchAtMs: lastAutoPatchAtMs,
          cooldownMs: args.autoPatchCooldownMs,
          maxPerHour: args.autoPatchMaxPerHour,
        })
        autoPatchHistory = normalizePatchHistory(patchOutcome.patchHistory)
        if (
          Number.isFinite(Number(patchOutcome.lastPatchAtMs)) &&
          Number(patchOutcome.lastPatchAtMs) > 0
        ) {
          lastAutoPatchAtMs = Number(patchOutcome.lastPatchAtMs)
        }
        if (patchOutcome.applied) {
          autoPatchAppliedCount += 1
        }
        lastAutoPatchResult = {
          ts: isoNow(),
          sessionId,
          sessionStatus,
          failureCode: sessionFailureCode || null,
          applied: patchOutcome.applied === true,
          reason: patchOutcome.reason,
          patchKeys: Array.isArray(patchOutcome?.plan?.patchKeys)
            ? patchOutcome.plan.patchKeys
            : [],
        }
        appendEvent("SESSION_AUTO_PATCH", {
          sessionId,
          sessionStatus,
          sessionFailureCode: sessionFailureCode || null,
          applied: patchOutcome.applied === true,
          reason: patchOutcome.reason,
          decision: recoveryDecision.mode,
          patchKeys: Array.isArray(patchOutcome?.plan?.patchKeys)
            ? patchOutcome.plan.patchKeys
            : [],
          patchReasons: Array.isArray(patchOutcome?.plan?.reasons)
            ? patchOutcome.plan.reasons
            : [],
          tuningPath: patchOutcome?.tuningPath
            ? path.relative(rootDir, patchOutcome.tuningPath)
            : args.tuningPath,
        })
      }

      const restartDelayMs = resolveAdaptiveRestartDelayMs({
        args,
        decisionMode: recoveryDecision.mode,
        failureCode: sessionFailureCode,
        crashLike,
        patchApplied: patchOutcome.applied === true,
        consecutiveSignalGapQualityStops,
        consecutiveStructuralStops,
      })
      updateState({
        autoPatchAppliedCount,
        lastAutoPatchResult,
      })
      appendEvent("SESSION_RESTART_WAIT", {
        sessionId,
        delayMs: restartDelayMs,
        reason: crashLike ? "CRASH_LIKE" : "NORMAL_ROTATE",
        decision: recoveryDecision.mode,
        decisionReason: recoveryDecision.reason,
        patchApplied: patchOutcome.applied === true,
        patchReason: patchOutcome.reason,
      })
      if (restartDelayMs > 0) {
        await sleep(restartDelayMs)
      }
    }
  } finally {
    clearInterval(pulse)
    state.status = "STOPPED"
    updateState({
      status: state.status,
      stoppedAt: isoNow(),
      activeSessionId: null,
      activeChildPid: null,
    })
    appendEvent("SUPERVISOR_STOPPED", {
      stopRequested,
    })
    try {
      fs.unlinkSync(compatLatestPidPath)
    } catch {
      // ignore cleanup failures
    }
    releaseSupervisorLock({ lockPath, supervisorId })
  }
}

run().catch((error) => {
  console.error(
    `[auto-supervisor] fatal: ${error?.stack ?? error?.message ?? error}`,
  )
  process.exitCode = 1
})
