import fs from "node:fs"
import path from "node:path"

const MAX_QUARANTINE_ENTRIES_DEFAULT = 5000

const toUpper = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

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

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const deepClone = (value) => JSON.parse(JSON.stringify(value ?? null))

const stableStringify = (value) => JSON.stringify(value)

export const ROOT_CAUSE_CLASS_CATALOG = Object.freeze([
  {
    classId: "INPUT_DERIVE",
    symptom: "signalsLoaded/signalsQualified/universe/weekCount 저하",
    rootCause: "입력/파생 결손 또는 기간 불일치",
    recurrencePattern: "동일 날짜·동일 윈도우에서 반복 FAIL",
    preventRule: "PRECHECK 불변조건 강제 + schema 검증",
    detectMetric: "signalsLoaded, signalsQualified, universeSize, weekCount",
    autoMitigation: "AUTO_RECOVERY 1회 후 즉시 STOP",
  },
  {
    classId: "EVAL_GATE",
    symptom: "후보는 있으나 Stage1/Stage2 통과 0",
    rootCause: "평가 예산 부족 또는 경계선 후보 조기 탈락",
    recurrencePattern: "INSUFFICIENT_POOL 반복",
    preventRule: "Stage1 pass=0 시 rescue/재평가 필수",
    detectMetric: "candidateCount, passCount, rescuePromoted",
    autoMitigation: "QUALITY 1회 재평가 후 STOP",
  },
  {
    classId: "SEARCH_STUCK",
    symptom: "동일 실패 고착, 신규 후보 다양성 저하",
    rootCause: "탐색 정책 고착, fingerprint 반복",
    recurrencePattern: "동일 fingerprint 재실패",
    preventRule: "quarantine + novelty anneal + feasibility 결합",
    detectMetric: "sameFailureStreak, signatureStreak, fingerprintRepeat",
    autoMitigation: "반복 fingerprint 자동 격리(TTL)",
  },
  {
    classId: "SAFETY_GUARD",
    symptom: "무한 반복 또는 타임아웃 누적",
    rootCause: "maxAttempts/sameFailureLimit/TTL 미강제",
    recurrencePattern: "세션 장시간 점유",
    preventRule: "circuit breaker + failure class policy",
    detectMetric: "attempts, sameFailure, runtimeMinutes",
    autoMitigation: "class별 즉시 STOP 또는 제한 재시도",
  },
  {
    classId: "LOW_RAM",
    symptom: "OOM/스왑 상승/탐색 폭 급축소",
    rootCause: "동시성 과다 또는 예산 과대",
    recurrencePattern: "메모리 경고 후 실패 재발",
    preventRule: "7.8GB 안전 기본값 고정",
    detectMetric: "freeMb/freeRatio, maxParallelShards, OOM",
    autoMitigation: "동시성 1~2 고정 + TopK 선택 평가",
  },
  {
    classId: "REPRO_VERSION",
    symptom: "실패 재현 불가/롤백 어려움",
    rootCause: "manifest 미기록, dirty tree 실행",
    recurrencePattern: "동일 조건 재실행 결과 불일치",
    preventRule: "dirty tree 금지 + manifest 필수",
    detectMetric: "gitClean, commitHash, runManifestSaved",
    autoMitigation: "실행 차단 + replay 제공",
  },
  {
    classId: "OBSERVABILITY",
    symptom: "어디서 0이 되는지 원인 불명",
    rootCause: "funnel/상태전이/예산 로그 부족",
    recurrencePattern: "같은 장애 분석 반복",
    preventRule: "표준 메트릭 + postmortem 자동 생성",
    detectMetric: "funnel drop, stage transitions, budgets",
    autoMitigation: "다음 액션 가이드 자동 출력",
  },
  {
    classId: "SECURITY_NOKIS",
    symptom: "NO_KIS 위반 가능성, 비밀 노출 위험",
    rootCause: "env 키 노출/설정 오염",
    recurrencePattern: "실행 로그에 민감정보 잔존",
    preventRule: "NO_KIS 강제 + 비밀 마스킹",
    detectMetric: "NO_KIS guard, secret file scan",
    autoMitigation: "SECURITY 분류 즉시 STOP",
  },
])

export const AUTOMATION_STATES = Object.freeze([
  "PRECHECK",
  "BUILD_INPUTS",
  "GENERATE_POOL",
  "GENERATE_CANDIDATES",
  "STAGE0_FILTER",
  "STAGE1_EVAL",
  "STAGE2_EVAL",
  "POOL_MAINTAIN",
  "ROUTE_RECOMMEND",
  "FINALIZE",
  "STOP",
])

const ALLOWED_TRANSITIONS = Object.freeze({
  PRECHECK: new Set(["BUILD_INPUTS", "STOP"]),
  BUILD_INPUTS: new Set([
    "GENERATE_POOL",
    "GENERATE_CANDIDATES",
    "PRECHECK",
    "STOP",
  ]),
  GENERATE_POOL: new Set(["STAGE0_FILTER", "STAGE1_EVAL", "PRECHECK", "STOP"]),
  GENERATE_CANDIDATES: new Set([
    "STAGE0_FILTER",
    "STAGE1_EVAL",
    "PRECHECK",
    "STOP",
  ]),
  STAGE0_FILTER: new Set(["STAGE1_EVAL", "PRECHECK", "STOP"]),
  STAGE1_EVAL: new Set(["STAGE2_EVAL", "PRECHECK", "STOP"]),
  STAGE2_EVAL: new Set([
    "POOL_MAINTAIN",
    "ROUTE_RECOMMEND",
    "FINALIZE",
    "PRECHECK",
    "STOP",
  ]),
  POOL_MAINTAIN: new Set(["ROUTE_RECOMMEND", "FINALIZE", "PRECHECK", "STOP"]),
  ROUTE_RECOMMEND: new Set(["FINALIZE", "PRECHECK", "STOP"]),
  FINALIZE: new Set(["STOP"]),
  STOP: new Set(),
})

export const createStateMachine = ({
  initialState = "PRECHECK",
  startedAt = new Date().toISOString(),
} = {}) => {
  const initial = AUTOMATION_STATES.includes(initialState)
    ? initialState
    : "PRECHECK"
  const history = [{ ts: startedAt, from: null, to: initial, note: "INIT" }]
  let current = initial
  return {
    get current() {
      return current
    },
    get history() {
      return [...history]
    },
    transition(nextState, note = "") {
      const next = AUTOMATION_STATES.includes(nextState) ? nextState : "STOP"
      const allowed = ALLOWED_TRANSITIONS[current] ?? new Set()
      if (current === next) {
        history.push({
          ts: new Date().toISOString(),
          from: current,
          to: next,
          note: note || "NOOP",
          accepted: true,
        })
        return { ok: true, from: current, to: next }
      }
      if (!allowed.has(next)) {
        history.push({
          ts: new Date().toISOString(),
          from: current,
          to: next,
          note: note || "INVALID_TRANSITION",
          accepted: false,
        })
        return {
          ok: false,
          code: "STATE_MACHINE_VIOLATION",
          detail: `${current}->${next}`,
        }
      }
      history.push({
        ts: new Date().toISOString(),
        from: current,
        to: next,
        note: note || "",
        accepted: true,
      })
      current = next
      return { ok: true, from: history[history.length - 1].from, to: next }
    },
  }
}

const SECURITY_CODES = new Set([
  "NO_KIS_REQUIRED",
  "KIS_ENABLED_BLOCKED",
  "DIRTY_TREE_BLOCKED",
  "SCHEMA_INVALID",
  "RUN_LOCK_HELD",
  "SECRET_FILE_DETECTED",
  "NO_KIS_PATH_VIOLATION",
])

const STRUCTURAL_CODES = new Set([
  "SURGE_POOL_EMPTY",
  "POOL_EMPTY",
  "SIGNAL_PREFLIGHT_FAIL",
  "SIGNAL_GAP",
  "ACTIVE_STRATEGY_MISSING",
  "MOONSHOT_OUTCOME_EMPTY",
  "MOONSHOT_SIGNAL_MISMATCH",
  "DATA_COVERAGE_LOW",
  "REPORT_MISSING",
  "STALE_ASOF",
  "PREFLIGHT_INVARIANT_FAIL",
  "STATE_MACHINE_VIOLATION",
])

const QUALITY_CODES = new Set([
  "INSUFFICIENT_POOL",
  "INSUFFICIENT_POOL_MOONSHOT_GATE",
  "INSUFFICIENT_POOL_SURGE_ONLY",
  "INSUFFICIENT_POOL_GAP_ONLY",
  "INSUFFICIENT_POOL_BOTH_TRACKS",
  "WORST2W_BELOW_THRESHOLD",
  "WORST2W_TRACK_ZERO_PASS",
  "TRADE_GATE_FAIL",
  "MOONSHOT_GATE_FAIL",
  "PERFORMANCE_NOT_PASS",
])

const isInsufficientPoolCode = (code) =>
  String(code ?? "")
    .trim()
    .toUpperCase()
    .startsWith("INSUFFICIENT_POOL")

export const classifyFailureType = (failureCode) => {
  const code = toUpper(failureCode)
  if (!code) return "TRANSIENT"
  if (SECURITY_CODES.has(code)) return "SECURITY"
  if (STRUCTURAL_CODES.has(code)) return "STRUCTURAL"
  if (isInsufficientPoolCode(code)) return "QUALITY"
  if (QUALITY_CODES.has(code)) return "QUALITY"
  return "TRANSIENT"
}

export const evaluateCircuitBreaker = ({
  failureType,
  structuralFailures = 0,
  qualityFailures = 0,
  transientFailures = 0,
  sameFailureStreak = 0,
  maxAttempts = 30,
  attempt = 1,
  runtimeLimitHit = false,
  structuralRecoveryLimit = 1,
  qualityRecoveryLimit = 1,
  transientRetryLimit = 6,
  sameFailureLimit = 3,
}) => {
  if (runtimeLimitHit) {
    return { stop: true, status: "STOPPED_BY_RUNTIME_LIMIT" }
  }
  if (maxAttempts > 0 && attempt >= maxAttempts) {
    return { stop: true, status: "STOPPED_BY_MAX_ATTEMPTS" }
  }
  if (
    sameFailureLimit > 0 &&
    sameFailureStreak >= Math.max(1, Math.floor(Number(sameFailureLimit) || 0))
  ) {
    return { stop: true, status: "STOPPED_BY_SAME_FAILURE_LIMIT" }
  }
  if (failureType === "SECURITY") {
    return { stop: true, status: "STOPPED_BY_SECURITY_GUARD" }
  }
  if (
    failureType === "STRUCTURAL" &&
    structuralFailures >
      Math.max(0, Math.floor(Number(structuralRecoveryLimit)))
  ) {
    return { stop: true, status: "STOPPED_BY_STRUCTURAL_GUARD" }
  }
  if (
    failureType === "QUALITY" &&
    qualityFailures > Math.max(0, Math.floor(Number(qualityRecoveryLimit)))
  ) {
    return { stop: true, status: "STOPPED_BY_QUALITY_GUARD" }
  }
  if (
    failureType === "TRANSIENT" &&
    transientFailures > Math.max(0, Math.floor(Number(transientRetryLimit)))
  ) {
    return { stop: true, status: "STOPPED_BY_TRANSIENT_LIMIT" }
  }
  return { stop: false, status: "CONTINUE" }
}

const ensureObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {}

const pushTypeError = (errors, key, expected, actual) => {
  errors.push(`${key}: expected ${expected}, got ${actual}`)
}

const pushRangeError = (errors, key, min, max, actual) => {
  errors.push(`${key}: out_of_range (${actual}) expected ${min}..${max}`)
}

const readFieldType = (value) => {
  if (Array.isArray(value)) return "array"
  return typeof value
}

const validateNumberField = ({
  source,
  key,
  errors,
  min,
  max,
  integer = true,
}) => {
  const value = source[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    pushTypeError(
      errors,
      key,
      integer ? "number(int)" : "number",
      readFieldType(value),
    )
    return
  }
  if (integer && !Number.isInteger(value)) {
    pushTypeError(errors, key, "number(int)", "number(float)")
    return
  }
  if (value < min || value > max) {
    pushRangeError(errors, key, min, max, value)
  }
}

const validateBooleanField = ({ source, key, errors }) => {
  const value = source[key]
  if (typeof value !== "boolean") {
    pushTypeError(errors, key, "boolean", readFieldType(value))
  }
}

const validateArrayField = ({ source, key, errors }) => {
  if (!Array.isArray(source[key])) {
    pushTypeError(errors, key, "array", readFieldType(source[key]))
  }
}

const TRACK_KEYS = ["SURGE_EOD", "GAP_15_BET"]
const TRACK_KEYS_WITH_MOONSHOT = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
const FAILURE_CLASS_KEYS = ["STRUCTURAL", "QUALITY", "TRANSIENT"]
const HARD_STAGE2_TOPK_BY_TRACK = Object.freeze({
  SURGE_EOD: 4,
  GAP_15_BET: 3,
  MOONSHOT: 2,
})
const HARD_ROUTER_CLOSE_TIME = "15:30"
const HARD_MAX_RECOMMENDATION_PER_TRACK = 1
const HARD_MOONSHOT_MAX_PICKS_PER_DAY = 1

const validateTrackNumberMap = ({
  source,
  key,
  errors,
  min,
  max,
  integer = true,
}) => {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushTypeError(errors, key, "object", readFieldType(value))
    return
  }
  for (const track of TRACK_KEYS_WITH_MOONSHOT) {
    if (!(track in value)) {
      errors.push(`${key}.${track}: missing`)
      continue
    }
    const field = value[track]
    if (typeof field !== "number" || !Number.isFinite(field)) {
      pushTypeError(
        errors,
        `${key}.${track}`,
        integer ? "number(int)" : "number",
        readFieldType(field),
      )
      continue
    }
    if (integer && !Number.isInteger(field)) {
      pushTypeError(errors, `${key}.${track}`, "number(int)", "number(float)")
      continue
    }
    if (field < min || field > max) {
      pushRangeError(errors, `${key}.${track}`, min, max, field)
    }
  }
}

const validateTrackNumberMapByKeys = ({
  source,
  key,
  errors,
  min,
  max,
  integer = true,
  tracks = TRACK_KEYS,
}) => {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushTypeError(errors, key, "object", readFieldType(value))
    return
  }
  for (const track of tracks) {
    if (!(track in value)) {
      errors.push(`${key}.${track}: missing`)
      continue
    }
    const field = value[track]
    if (typeof field !== "number" || !Number.isFinite(field)) {
      pushTypeError(
        errors,
        `${key}.${track}`,
        integer ? "number(int)" : "number",
        readFieldType(field),
      )
      continue
    }
    if (integer && !Number.isInteger(field)) {
      pushTypeError(errors, `${key}.${track}`, "number(int)", "number(float)")
      continue
    }
    if (field < min || field > max) {
      pushRangeError(errors, `${key}.${track}`, min, max, field)
    }
  }
}

function validateFailureTtlMap({ source, key, errors, min, max }) {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushTypeError(errors, key, "object", readFieldType(value))
    return
  }
  for (const failureClass of FAILURE_CLASS_KEYS) {
    if (!(failureClass in value)) {
      errors.push(key + "." + failureClass + ": missing")
      continue
    }
    const field = value[failureClass]
    if (typeof field !== "number" || !Number.isFinite(field)) {
      pushTypeError(
        errors,
        key + "." + failureClass,
        "number(int)",
        readFieldType(field),
      )
      continue
    }
    if (!Number.isInteger(field)) {
      pushTypeError(
        errors,
        key + "." + failureClass,
        "number(int)",
        "number(float)",
      )
      continue
    }
    if (field < min || field > max) {
      pushRangeError(errors, key + "." + failureClass, min, max, field)
    }
  }
}
const validateTrackEngineQuotaMap = ({ source, key, errors }) => {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushTypeError(errors, key, "object", readFieldType(value))
    return
  }
  for (const track of TRACK_KEYS_WITH_MOONSHOT) {
    if (!(track in value)) {
      errors.push(`${key}.${track}: missing`)
      continue
    }
    const quota = value[track]
    if (!quota || typeof quota !== "object" || Array.isArray(quota)) {
      pushTypeError(errors, `${key}.${track}`, "object", readFieldType(quota))
      continue
    }
    for (const engineType of ["chart", "rule"]) {
      if (!(engineType in quota)) {
        errors.push(`${key}.${track}.${engineType}: missing`)
        continue
      }
      const ratio = quota[engineType]
      if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
        pushTypeError(
          errors,
          `${key}.${track}.${engineType}`,
          "number",
          readFieldType(ratio),
        )
        continue
      }
      if (ratio < 0 || ratio > 1) {
        pushRangeError(errors, `${key}.${track}.${engineType}`, 0, 1, ratio)
      }
    }
  }
}

const validateChampionDiscoveryBudgetSplit = ({ source, key, errors }) => {
  const value = source[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushTypeError(errors, key, "object", readFieldType(value))
    return
  }
  const champion = Number(value?.champion)
  const discovery = Number(value?.discovery)
  if (!Number.isFinite(champion)) {
    pushTypeError(
      errors,
      `${key}.champion`,
      "number",
      readFieldType(value?.champion),
    )
    return
  }
  if (!Number.isFinite(discovery)) {
    pushTypeError(
      errors,
      `${key}.discovery`,
      "number",
      readFieldType(value?.discovery),
    )
    return
  }
  if (champion < 0 || champion > 1) {
    pushRangeError(errors, `${key}.champion`, 0, 1, champion)
  }
  if (discovery < 0 || discovery > 1) {
    pushRangeError(errors, `${key}.discovery`, 0, 1, discovery)
  }
  const sum = champion + discovery
  if (sum <= 0) {
    errors.push(`${key}: champion+discovery must be > 0`)
  }
}

export const validateRulesSchema = (rawRules) => {
  const src = ensureObject(rawRules)
  const errors = []
  validateArrayField({ source: src, key: "tracks", errors })
  validateArrayField({ source: src, key: "requiredTracks", errors })
  validateNumberField({
    source: src,
    key: "targetPct",
    errors,
    min: 1,
    max: 100,
    integer: true,
  })
  validateNumberField({
    source: src,
    key: "minWorst2wAvgPct",
    errors,
    min: -100,
    max: 100,
    integer: false,
  })
  if (typeof src.noKisRequired !== "boolean" || src.noKisRequired !== true) {
    errors.push("noKisRequired: must be true")
  }
  return {
    ok: errors.length === 0,
    errors,
  }
}

export const DEFAULT_AUTOTUNE_ALLOWLIST = Object.freeze([
  "coverageSeedLanes",
  "failureFingerprintCarryLimit",
  "sameFailureSignatureJumpThreshold",
  "sameFailureSignatureCursorMultiplier",
  "qualityRecoveryLimit",
  "rescueEarlyExitEnabled",
  "explorationBanditUcbC",
  "explorationBanditPriorMean",
  "explorationBanditPriorWeight",
  "explorationBanditMinSamples",
  "runtimeBudgetBiasMin",
  "runtimeBudgetBiasMax",
  "prefilterEnabled",
  "prefilterWorst2wBuffer",
  "prefilterStopLikeCeil",
  "prefilterNoFillCeil",
  "allowUnsafeGapChartFallbackStage1",
  "shards",
  "topPerTrack",
  "stage1MaxRounds",
  "stage2MaxRounds",
  "stage1PlateauRounds",
  "stage2PlateauRounds",
  "seedStart",
  "symbolBucketStride",
  "symbolBucketTotal",
  "rescueTopK",
  "rescueCheapB",
  "rescueCheapM",
  "rescueDeepTopK",
  "rescueDeepB",
  "rescueDeepM",
  "rescueDeepAllowMoonshotDominant",
  "rescueP0",
  "rescueLcbQuantile",
  "policyEvalEnabled",
  "policyEvalTopKSurge",
  "policyEvalTopKGap",
  "policyEvalMinWeeks",
  "policyEvalLookbackWeeks",
  "policyEvalMinDistinctCandidates",
  "policyEvalMaxConsecutiveDays",
  "policyEvalMaxConsecutiveWeeks",
  "rescueEarlyExitNoPassMinEval",
  "rescueEarlyExitNoPassMaxEval",
  "rescueEarlyExitMinEvalRatio",
  "rescueEarlyExitTerminalReasonRatio",
  "minPoolPerTrackSurge",
  "minPoolPerTrackGap",
  "minWorst2wPassPerTrackSurge",
  "minWorst2wPassPerTrackGap",
  "retryBackoffMs",
  "forceDataSyncNextAttempt",
  "signalGapRepairFromDateKey",
  "signalGapRepairToDateKey",
  "signalGapRepairStopAfter",
  "dataSyncMode",
  "poolActiveLimitByTrack",
  "poolBenchLimitByTrack",
  "poolMinAliveByTrack",
  "poolRefillCountByTrack",
  "stage2TopKByTrack",
  "poolExpandEnabled",
  "poolExpandMinPassDensity",
  "poolExpandMaxTerminalRatio",
  "poolExpandStepTopPerTrack",
  "poolExpandCapTopPerTrack",
  "poolExpandCapStage2TopK",
  "adaptivePoolTuningMode",
  "previousPassDensity",
  "previousTerminalRatio",
  "poolsetEnabled",
  "poolsetCountByTrack",
  "poolsetCountMaxByTrack",
  "poolsetActiveSizeByTrack",
  "poolsetBenchSizeByTrack",
  "poolsetMinAliveByTrack",
  "poolsetRefillCountByTrack",
  "poolsetMaxConcurrentEval",
  "poolsetBatchSize",
  "stage2ResultCacheEnabled",
  "stage2ResultCacheTtlSec",
  "stage2SkipDuplicatePoolSetSignature",
  "stage2ScheduleMode",
  "stage2ContinueAfterFirstPass",
  "poolsetStage1WindowMonths",
  "poolsetStage2WindowMonths",
  "poolsetEvalMode",
  "dailyPassAvengersEnabled",
  "dailyPassTopNByTrack",
  "dailyPassPoolsetCountByTrack",
  "dailyPassRecombineRounds",
  "poolEngineQuotaByTrack",
  "routerUseRegime",
  "routerRequireTrainRangeValid",
  "routerRecencyHalfLifeDays",
  "routerMode1500Track",
  "routerModeCloseTrack",
  "routerCloseDecisionTimeKST",
  "maxRecommendationPerTrack",
  "keepZeroWhenNoMatch",
  "moonshotMaxPicksPerDay",
  "runLockEnabled",
  "qualityCollapseResetLimit",
  "quarantineTtlByFailureType",
  "policyConflictResolution",
  "moonshotRecommendEnabled",
  "moonshotTrackRequiredForCorePass",
  "championDiscoveryBudgetSplit",
  "requirementEvidenceEnabled",
  "policyDocSyncEnabled",
  "allowStage2OnLowQualityRequiredDry",
  "disableStage2OnLowQualityRequiredDryOnZeroPass",
  "speedProfileEnabled",
  "speedProfileRequireParity",
  "speedProfileExpansionGuard",
  "speedProfileMaxStage2TopK",
  "gapChartUnsafeCooldownRounds",
  "moonshotPatternMissingCooldownRounds",
  "executionLane",
])

export const normalizeAutotuneAllowlist = (raw) => {
  const list = Array.isArray(raw) ? raw : DEFAULT_AUTOTUNE_ALLOWLIST
  const clean = Array.from(
    new Set(list.map((item) => String(item ?? "").trim()).filter(Boolean)),
  )
  return clean.length > 0 ? clean : [...DEFAULT_AUTOTUNE_ALLOWLIST]
}

export const validateTuningSchema = (rawTuning) => {
  const src = ensureObject(rawTuning)
  const errors = []
  const executionLaneRaw = String(src.executionLane ?? "server")
    .trim()
    .toLowerCase()
  const executionLane =
    executionLaneRaw === "codex_cloud" ? "codex_cloud" : "server"
  const isCodexCloudLane = executionLane === "codex_cloud"
  if (
    Object.hasOwn(src, "executionLane") &&
    executionLaneRaw !== "server" &&
    executionLaneRaw !== "codex_cloud"
  ) {
    errors.push("executionLane must be one of: server, codex_cloud")
  }
  const laneMaxInt = isCodexCloudLane ? Number.MAX_SAFE_INTEGER : null
  const maxParallelShardsCap = isCodexCloudLane ? laneMaxInt : 2
  const maxWorkersCap = isCodexCloudLane ? laneMaxInt : 2
  const stage2ConcurrencyCap = isCodexCloudLane ? laneMaxInt : 1
  const poolsetBatchCap = isCodexCloudLane ? laneMaxInt : 16
  const speedProfileTopKCap = isCodexCloudLane ? laneMaxInt : 64
  const poolTrackCap = isCodexCloudLane ? laneMaxInt : 64
  const poolBenchCap = isCodexCloudLane ? laneMaxInt : 256
  const poolsetCountCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetCountMaxCap = isCodexCloudLane ? laneMaxInt : 96
  const poolsetActiveCap = isCodexCloudLane ? laneMaxInt : 32
  const poolsetBenchCap = isCodexCloudLane ? laneMaxInt : 64
  const poolsetMinAliveCap = isCodexCloudLane ? laneMaxInt : 16
  const poolsetRefillCap = isCodexCloudLane ? laneMaxInt : 16
  const stage2TopKCap = isCodexCloudLane ? laneMaxInt : 64
  const dailyPassPoolsetCountCap = isCodexCloudLane ? laneMaxInt : 32
  const dailyPassRecombineRoundsCap = isCodexCloudLane ? laneMaxInt : 5
  validateNumberField({
    source: src,
    key: "maxAttempts",
    errors,
    min: 1,
    max: 100000,
  })
  validateNumberField({
    source: src,
    key: "sameFailureLimit",
    errors,
    min: 1,
    max: 1000,
  })
  validateNumberField({
    source: src,
    key: "sameFailureSignatureJumpThreshold",
    errors,
    min: 2,
    max: 50,
  })
  validateNumberField({
    source: src,
    key: "sameFailureSignatureCursorMultiplier",
    errors,
    min: 2,
    max: 32,
  })
  validateNumberField({
    source: src,
    key: "maxRuntimeMinutes",
    errors,
    min: 1,
    max: 20160,
  })
  validateNumberField({
    source: src,
    key: "maxParallelShards",
    errors,
    min: 1,
    max: maxParallelShardsCap,
  })
  validateNumberField({
    source: src,
    key: "maxWorkers",
    errors,
    min: 1,
    max: maxWorkersCap,
  })
  if (
    Object.hasOwn(src, "maxWorkers") &&
    Object.hasOwn(src, "maxParallelShards")
  ) {
    const workers = Number(src.maxWorkers)
    const shards = Number(src.maxParallelShards)
    if (
      Number.isFinite(workers) &&
      Number.isFinite(shards) &&
      workers !== shards
    ) {
      errors.push("maxWorkers must equal maxParallelShards")
    }
  }
  validateNumberField({
    source: src,
    key: "minFreeMbForParallelShards",
    errors,
    min: 1024,
    max: 65536,
  })
  validateNumberField({
    source: src,
    key: "minPoolPerTrackSurge",
    errors,
    min: 0,
    max: 5000,
  })
  validateNumberField({
    source: src,
    key: "minPoolPerTrackGap",
    errors,
    min: 0,
    max: 5000,
  })
  validateNumberField({
    source: src,
    key: "minWorst2wPassPerTrackSurge",
    errors,
    min: 0,
    max: 5000,
  })
  validateNumberField({
    source: src,
    key: "minWorst2wPassPerTrackGap",
    errors,
    min: 0,
    max: 5000,
  })
  validateBooleanField({ source: src, key: "rescueEarlyExitEnabled", errors })
  validateBooleanField({ source: src, key: "policyEvalEnabled", errors })
  validateBooleanField({
    source: src,
    key: "disableStage2OnLowQualityRequiredDryOnZeroPass",
    errors,
  })
  validateNumberField({
    source: src,
    key: "policyEvalTopKSurge",
    errors,
    min: 1,
    max: 200,
  })
  validateNumberField({
    source: src,
    key: "policyEvalTopKGap",
    errors,
    min: 1,
    max: 200,
  })
  validateNumberField({
    source: src,
    key: "policyEvalMinWeeks",
    errors,
    min: 2,
    max: 52,
  })
  validateNumberField({
    source: src,
    key: "policyEvalLookbackWeeks",
    errors,
    min: 1,
    max: 16,
  })
  validateNumberField({
    source: src,
    key: "policyEvalMinDistinctCandidates",
    errors,
    min: 1,
    max: 16,
  })
  validateNumberField({
    source: src,
    key: "policyEvalMaxConsecutiveDays",
    errors,
    min: 1,
    max: 80,
  })
  validateNumberField({
    source: src,
    key: "policyEvalMaxConsecutiveWeeks",
    errors,
    min: 1,
    max: 16,
  })
  validateBooleanField({ source: src, key: "explorationBanditEnabled", errors })
  validateNumberField({
    source: src,
    key: "explorationBanditUcbC",
    errors,
    min: 0.05,
    max: 4,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "explorationBanditPriorMean",
    errors,
    min: -5,
    max: 5,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "explorationBanditPriorWeight",
    errors,
    min: 0,
    max: 500,
  })
  validateNumberField({
    source: src,
    key: "explorationBanditMinSamples",
    errors,
    min: 1,
    max: 1000,
  })
  validateBooleanField({ source: src, key: "runtimeBudgetBiasEnabled", errors })
  validateNumberField({
    source: src,
    key: "runtimeBudgetBiasMin",
    errors,
    min: 0.4,
    max: 1,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "runtimeBudgetBiasMax",
    errors,
    min: 1,
    max: 2,
    integer: false,
  })
  validateBooleanField({ source: src, key: "dataSyncEnabled", errors })
  validateBooleanField({ source: src, key: "deriveEnabled", errors })
  validateBooleanField({ source: src, key: "speedProfileEnabled", errors })
  validateBooleanField({
    source: src,
    key: "speedProfileRequireParity",
    errors,
  })
  validateBooleanField({
    source: src,
    key: "speedProfileExpansionGuard",
    errors,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "speedProfileMaxStage2TopK",
    errors,
    min: 1,
    max: speedProfileTopKCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateNumberField({
    source: src,
    key: "gapChartUnsafeCooldownRounds",
    errors,
    min: 0,
    max: 128,
  })
  validateNumberField({
    source: src,
    key: "moonshotPatternMissingCooldownRounds",
    errors,
    min: 0,
    max: 128,
  })
  validateTrackNumberMap({
    source: src,
    key: "poolActiveLimitByTrack",
    errors,
    min: 1,
    max: poolTrackCap,
  })
  validateTrackNumberMap({
    source: src,
    key: "poolBenchLimitByTrack",
    errors,
    min: 0,
    max: poolBenchCap,
  })
  validateTrackNumberMap({
    source: src,
    key: "poolMinAliveByTrack",
    errors,
    min: 1,
    max: poolTrackCap,
  })
  validateTrackNumberMap({
    source: src,
    key: "poolRefillCountByTrack",
    errors,
    min: 1,
    max: poolTrackCap,
  })
  validateTrackNumberMap({
    source: src,
    key: "stage2TopKByTrack",
    errors,
    min: 1,
    max: stage2TopKCap,
  })
  if (
    !isCodexCloudLane &&
    src.stage2TopKByTrack &&
    typeof src.stage2TopKByTrack === "object" &&
    !Array.isArray(src.stage2TopKByTrack)
  ) {
    for (const track of TRACK_KEYS_WITH_MOONSHOT) {
      const expected = HARD_STAGE2_TOPK_BY_TRACK[track]
      const actual = Number(src.stage2TopKByTrack?.[track])
      if (Number.isFinite(actual) && actual !== expected) {
        errors.push(`stage2TopKByTrack.${track}: must be ${expected}`)
      }
    }
  }
  validateBooleanField({ source: src, key: "poolsetEnabled", errors })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetCountByTrack",
    errors,
    min: 1,
    max: poolsetCountCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetCountMaxByTrack",
    errors,
    min: 1,
    max: poolsetCountMaxCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetActiveSizeByTrack",
    errors,
    min: 1,
    max: poolsetActiveCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetBenchSizeByTrack",
    errors,
    min: 0,
    max: poolsetBenchCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetMinAliveByTrack",
    errors,
    min: 1,
    max: poolsetMinAliveCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "poolsetRefillCountByTrack",
    errors,
    min: 1,
    max: poolsetRefillCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateNumberField({
    source: src,
    key: "poolsetMaxConcurrentEval",
    errors,
    min: 1,
    max: stage2ConcurrencyCap,
  })
  validateNumberField({
    source: src,
    key: "stage2EvalConcurrency",
    errors,
    min: 1,
    max: stage2ConcurrencyCap,
  })
  if (
    Object.hasOwn(src, "stage2EvalConcurrency") &&
    Object.hasOwn(src, "poolsetMaxConcurrentEval")
  ) {
    const stage2Concurrency = Number(src.stage2EvalConcurrency)
    const poolsetConcurrency = Number(src.poolsetMaxConcurrentEval)
    if (
      Number.isFinite(stage2Concurrency) &&
      Number.isFinite(poolsetConcurrency) &&
      stage2Concurrency !== poolsetConcurrency
    ) {
      errors.push("stage2EvalConcurrency must equal poolsetMaxConcurrentEval")
    }
  }
  validateNumberField({
    source: src,
    key: "poolsetBatchSize",
    errors,
    min: 1,
    max: poolsetBatchCap,
  })
  validateBooleanField({
    source: src,
    key: "stage2ResultCacheEnabled",
    errors,
  })
  validateNumberField({
    source: src,
    key: "stage2ResultCacheTtlSec",
    errors,
    min: 60,
    max: 30 * 24 * 60 * 60,
  })
  validateBooleanField({
    source: src,
    key: "stage2SkipDuplicatePoolSetSignature",
    errors,
  })
  validateBooleanField({
    source: src,
    key: "stage2ContinueAfterFirstPass",
    errors,
  })
  if (Object.hasOwn(src, "stage2ScheduleMode")) {
    const mode = String(src.stage2ScheduleMode ?? "")
      .trim()
      .toLowerCase()
    if (mode !== "champion_first" && mode !== "fifo") {
      errors.push('stage2ScheduleMode: must be "champion_first" or "fifo"')
    }
  }
  validateNumberField({
    source: src,
    key: "poolsetStage1WindowMonths",
    errors,
    min: 1,
    max: 12,
  })
  validateNumberField({
    source: src,
    key: "poolsetStage2WindowMonths",
    errors,
    min: 1,
    max: 12,
  })
  if (Object.hasOwn(src, "poolsetEvalMode")) {
    const token = String(src.poolsetEvalMode ?? "")
      .trim()
      .toLowerCase()
    if (token !== "daily_router_8m") {
      errors.push('poolsetEvalMode: must be "daily_router_8m"')
    }
  }
  validateBooleanField({ source: src, key: "dailyPassAvengersEnabled", errors })
  if (Object.hasOwn(src, "dailyPassAvengersEnabled")) {
    const value = src.dailyPassAvengersEnabled
    if (value !== true) {
      errors.push("dailyPassAvengersEnabled must be true")
    }
  }
  validateTrackNumberMapByKeys({
    source: src,
    key: "dailyPassTopNByTrack",
    errors,
    min: 1,
    max: 5000,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateTrackNumberMapByKeys({
    source: src,
    key: "dailyPassPoolsetCountByTrack",
    errors,
    min: 1,
    max: dailyPassPoolsetCountCap,
    tracks: TRACK_KEYS_WITH_MOONSHOT,
  })
  validateNumberField({
    source: src,
    key: "dailyPassRecombineRounds",
    errors,
    min: 1,
    max: dailyPassRecombineRoundsCap,
  })
  validateTrackEngineQuotaMap({
    source: src,
    key: "poolEngineQuotaByTrack",
    errors,
  })
  validateBooleanField({ source: src, key: "routerUseRegime", errors })
  validateBooleanField({
    source: src,
    key: "routerRequireTrainRangeValid",
    errors,
  })
  validateNumberField({
    source: src,
    key: "routerRecencyHalfLifeDays",
    errors,
    min: 1,
    max: 365,
  })
  validateArrayField({ source: src, key: "routerMode1500Track", errors })
  if (Array.isArray(src.routerMode1500Track)) {
    const invalid = src.routerMode1500Track
      .map((item) =>
        String(item ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean)
      .filter((item) => item !== "GAP_15_BET")
    if (invalid.length > 0) {
      errors.push(
        `routerMode1500Track: only GAP_15_BET allowed (invalid: ${invalid.join(",")})`,
      )
    }
  }
  validateArrayField({ source: src, key: "routerModeCloseTrack", errors })
  if (Array.isArray(src.routerModeCloseTrack)) {
    const invalid = src.routerModeCloseTrack
      .map((item) =>
        String(item ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean)
      .filter((item) => item !== "SURGE_EOD" && item !== "MOONSHOT")
    if (invalid.length > 0) {
      errors.push(
        `routerModeCloseTrack: only SURGE_EOD,MOONSHOT allowed (invalid: ${invalid.join(",")})`,
      )
    }
  }
  if (Object.hasOwn(src, "routerCloseDecisionTimeKST")) {
    const token = String(src.routerCloseDecisionTimeKST ?? "").trim()
    const isValid = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(token)
    if (!isValid) {
      errors.push("routerCloseDecisionTimeKST: must be HH:MM")
    } else if (token !== HARD_ROUTER_CLOSE_TIME) {
      errors.push(
        `routerCloseDecisionTimeKST: must be ${HARD_ROUTER_CLOSE_TIME}`,
      )
    }
  }
  validateNumberField({
    source: src,
    key: "maxRecommendationPerTrack",
    errors,
    min: 1,
    max: 1,
  })
  validateBooleanField({ source: src, key: "keepZeroWhenNoMatch", errors })
  if (src.keepZeroWhenNoMatch !== true) {
    errors.push("keepZeroWhenNoMatch: must be true")
  }
  validateNumberField({
    source: src,
    key: "moonshotMaxPicksPerDay",
    errors,
    min: 0,
    max: 1,
  })
  if (Number(src.moonshotMaxPicksPerDay) !== HARD_MOONSHOT_MAX_PICKS_PER_DAY) {
    errors.push(
      `moonshotMaxPicksPerDay: must be ${HARD_MOONSHOT_MAX_PICKS_PER_DAY}`,
    )
  }
  if (
    Number(src.maxRecommendationPerTrack) !== HARD_MAX_RECOMMENDATION_PER_TRACK
  ) {
    errors.push(
      `maxRecommendationPerTrack: must be ${HARD_MAX_RECOMMENDATION_PER_TRACK}`,
    )
  }
  validateBooleanField({ source: src, key: "runLockEnabled", errors })
  validateBooleanField({
    source: src,
    key: "allowUnsafeGapChartFallbackStage1",
    errors,
  })
  validateBooleanField({ source: src, key: "poolExpandEnabled", errors })
  validateNumberField({
    source: src,
    key: "poolExpandMinPassDensity",
    errors,
    min: 0,
    max: 1,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "poolExpandMaxTerminalRatio",
    errors,
    min: 0,
    max: 1,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "poolExpandStepTopPerTrack",
    errors,
    min: 1,
    max: 128,
  })
  validateNumberField({
    source: src,
    key: "poolExpandCapTopPerTrack",
    errors,
    min: 1,
    max: 1000,
  })
  validateNumberField({
    source: src,
    key: "poolExpandCapStage2TopK",
    errors,
    min: 1,
    max: 128,
  })
  if (
    Object.hasOwn(src, "adaptivePoolTuningMode") &&
    !["AUTO", "OFF"].includes(
      String(src.adaptivePoolTuningMode ?? "")
        .trim()
        .toUpperCase(),
    )
  ) {
    errors.push("adaptivePoolTuningMode: must be AUTO or OFF")
  }
  validateNumberField({
    source: src,
    key: "previousPassDensity",
    errors,
    min: 0,
    max: 1,
    integer: false,
  })
  validateNumberField({
    source: src,
    key: "previousTerminalRatio",
    errors,
    min: 0,
    max: 1,
    integer: false,
  })
  validateBooleanField({ source: src, key: "moonshotRecommendEnabled", errors })
  validateBooleanField({
    source: src,
    key: "moonshotTrackRequiredForCorePass",
    errors,
  })
  validateChampionDiscoveryBudgetSplit({
    source: src,
    key: "championDiscoveryBudgetSplit",
    errors,
  })
  validateBooleanField({
    source: src,
    key: "requirementEvidenceEnabled",
    errors,
  })
  validateBooleanField({
    source: src,
    key: "policyDocSyncEnabled",
    errors,
  })
  validateBooleanField({ source: src, key: "forceDataSyncNextAttempt", errors })
  validateBooleanField({
    source: src,
    key: "dataSyncSkipRetryAttempts",
    errors,
  })
  validateNumberField({
    source: src,
    key: "preflightMinSignalsLoaded",
    errors,
    min: 1,
    max: 1_000_000,
  })
  validateNumberField({
    source: src,
    key: "preflightMinUniverseSize",
    errors,
    min: 1,
    max: 1_000_000,
  })
  validateNumberField({
    source: src,
    key: "preflightMinTradingDays",
    errors,
    min: 1,
    max: 252,
  })
  validateNumberField({
    source: src,
    key: "preflightMinWeekCount",
    errors,
    min: 1,
    max: 104,
  })
  validateNumberField({
    source: src,
    key: "dataSyncNoOutputTimeoutMs",
    errors,
    min: 0,
    max: 24 * 60 * 60 * 1000,
  })
  validateNumberField({
    source: src,
    key: "dataSyncForcedNoOutputTimeoutMs",
    errors,
    min: 0,
    max: 24 * 60 * 60 * 1000,
  })
  validateNumberField({
    source: src,
    key: "dataSyncNoOutputMinElapsedMs",
    errors,
    min: 0,
    max: 24 * 60 * 60 * 1000,
  })
  validateNumberField({
    source: src,
    key: "structuralRecoveryLimit",
    errors,
    min: 0,
    max: 3,
  })
  validateNumberField({
    source: src,
    key: "qualityRecoveryLimit",
    errors,
    min: 0,
    max: 3,
  })
  validateNumberField({
    source: src,
    key: "qualityCollapseResetLimit",
    errors,
    min: 0,
    max: 10,
  })
  validateNumberField({
    source: src,
    key: "transientRetryLimit",
    errors,
    min: 1,
    max: 20,
  })
  validateNumberField({
    source: src,
    key: "quarantineFailThreshold",
    errors,
    min: 2,
    max: 100,
  })
  validateNumberField({
    source: src,
    key: "quarantineTtlMinutes",
    errors,
    min: 1,
    max: 60 * 24 * 30,
  })
  validateFailureTtlMap({
    source: src,
    key: "quarantineTtlByFailureType",
    errors,
    min: 60,
    max: 60 * 60 * 24 * 30,
  })
  validateNumberField({
    source: src,
    key: "quarantineMaxEntries",
    errors,
    min: 1,
    max: 100_000,
  })
  validateBooleanField({ source: src, key: "precheckRequireCleanGit", errors })
  validateBooleanField({
    source: src,
    key: "precheckBlockOnSecretFiles",
    errors,
  })
  validateBooleanField({ source: src, key: "quarantineEnabled", errors })
  validateNumberField({
    source: src,
    key: "rescueEarlyExitNoPassMaxEval",
    errors,
    min: 1,
    max: 5000,
  })
  validateNumberField({
    source: src,
    key: "rescueEarlyExitMinEvalRatio",
    errors,
    min: 0,
    max: 1,
    integer: false,
  })
  validateBooleanField({ source: src, key: "autotuneDeterministic", errors })
  validateNumberField({
    source: src,
    key: "autotuneMaxAdjustmentsPerRun",
    errors,
    min: 1,
    max: 100,
  })
  validateArrayField({ source: src, key: "autotuneAllowlist", errors })
  const runtimeBudgetBiasMin = Number(src.runtimeBudgetBiasMin)
  const runtimeBudgetBiasMax = Number(src.runtimeBudgetBiasMax)
  if (
    Number.isFinite(runtimeBudgetBiasMin) &&
    Number.isFinite(runtimeBudgetBiasMax) &&
    runtimeBudgetBiasMax < runtimeBudgetBiasMin
  ) {
    errors.push(
      `runtimeBudgetBiasMax: must be >= runtimeBudgetBiasMin (min=${runtimeBudgetBiasMin}, max=${runtimeBudgetBiasMax})`,
    )
  }
  if (Object.hasOwn(src, "policyConflictResolution")) {
    const token = String(src.policyConflictResolution ?? "")
      .trim()
      .toUpperCase()
    if (token !== "POOLSET_FIRST_STRICT") {
      errors.push('policyConflictResolution: must be "POOLSET_FIRST_STRICT"')
    }
  }
  const envOverrides = ensureObject(src.envOverrides)
  const noKis = parseBoolean(envOverrides.NO_KIS)
  const disableKis = parseBoolean(envOverrides.BACKFILL_DISABLE_KIS)
  const kisEnabled = parseBoolean(envOverrides.BACKFILL_KIS_ENABLED)
  if (!noKis || !disableKis || kisEnabled) {
    errors.push(
      "envOverrides: NO_KIS=1, BACKFILL_DISABLE_KIS=1, BACKFILL_KIS_ENABLED=0 required",
    )
  }
  return {
    ok: errors.length === 0,
    errors,
  }
}

const AUTOTUNE_PRIORITY_ORDER = [
  "stage1MaxRounds",
  "stage2MaxRounds",
  "stage1PlateauRounds",
  "stage2PlateauRounds",
  "minWorst2wPassPerTrackSurge",
  "minWorst2wPassPerTrackGap",
  "rescueTopK",
  "rescueCheapB",
  "rescueCheapM",
  "rescueDeepTopK",
  "rescueDeepB",
  "rescueDeepM",
  "rescueEarlyExitNoPassMinEval",
  "rescueEarlyExitNoPassMaxEval",
  "rescueEarlyExitMinEvalRatio",
  "rescueEarlyExitTerminalReasonRatio",
  "symbolBucketTotal",
  "symbolBucketStride",
  "topPerTrack",
  "coverageSeedLanes",
  "poolRefillCountByTrack",
  "stage2TopKByTrack",
  "prefilterWorst2wBuffer",
  "prefilterStopLikeCeil",
  "prefilterNoFillCeil",
  "failureFingerprintCarryLimit",
  "sameFailureSignatureJumpThreshold",
  "sameFailureSignatureCursorMultiplier",
  "seedStart",
]

const buildAutotunePriorityMap = () =>
  new Map(AUTOTUNE_PRIORITY_ORDER.map((key, index) => [key, index]))

export const applyAutotuneAllowlist = ({
  previousTuning,
  candidateTuning,
  allowlist,
  maxAdjustmentsPerRun,
}) => {
  const prev = ensureObject(previousTuning)
  const next = deepClone(candidateTuning) ?? {}
  const allowed = new Set(normalizeAutotuneAllowlist(allowlist))
  const maxAdjust = Math.max(
    1,
    Math.floor(Number(maxAdjustmentsPerRun ?? 1) || 1),
  )
  const changedKeys = []
  const blockedKeys = []
  const priorityMap = buildAutotunePriorityMap()
  for (const key of Object.keys(next)) {
    const before = stableStringify(prev[key])
    const after = stableStringify(next[key])
    if (before === after) continue
    if (!allowed.has(key)) {
      next[key] = deepClone(prev[key])
      blockedKeys.push(key)
      continue
    }
    changedKeys.push(key)
  }
  const sorted = [...changedKeys].sort((a, b) => {
    const aPriority = priorityMap.has(a)
      ? Number(priorityMap.get(a))
      : Number.MAX_SAFE_INTEGER
    const bPriority = priorityMap.has(b)
      ? Number(priorityMap.get(b))
      : Number.MAX_SAFE_INTEGER
    if (aPriority !== bPriority) return aPriority - bPriority
    return a.localeCompare(b)
  })
  const kept = sorted.slice(0, maxAdjust)
  const truncated = sorted.slice(maxAdjust)
  for (const key of truncated) {
    next[key] = deepClone(prev[key])
  }
  return {
    nextTuning: next,
    appliedKeys: kept,
    blockedKeys,
    truncatedKeys: truncated,
  }
}

const DEFAULT_REDACT_PATTERNS = [
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PASSWD",
  "API_KEY",
  "APP_KEY",
  "APP_SECRET",
  "PRIVATE_KEY",
]

const shouldRedactKey = (key) => {
  const upper = toUpper(key)
  if (!upper) return false
  if (upper === "NO_KIS") return false
  if (upper === "BACKFILL_DISABLE_KIS") return false
  if (upper === "BACKFILL_KIS_ENABLED") return false
  return DEFAULT_REDACT_PATTERNS.some((pattern) => upper.includes(pattern))
}

export const redactSensitiveObject = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      out[key] = "***REDACTED***"
      continue
    }
    out[key] = redactSensitiveObject(item)
  }
  return out
}

export const detectSecretEnvFiles = ({
  rootDir,
  files = [".env.local", "env.local", ".env"],
} = {}) => {
  const matches = []
  for (const file of files) {
    const filePath = path.join(rootDir ?? process.cwd(), file)
    if (!fs.existsSync(filePath)) continue
    let text = ""
    try {
      text = fs.readFileSync(filePath, "utf8")
    } catch {
      text = ""
    }
    if (!text) continue
    const lines = text.split(/\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] ?? "").trim()
      if (!line || line.startsWith("#")) continue
      if (
        line.includes("KIS_APP_KEY=") ||
        line.includes("KIS_APP_SECRET=") ||
        line.includes("OPENAI_API_KEY=") ||
        line.includes("AWS_SECRET_ACCESS_KEY=")
      ) {
        matches.push({
          file,
          line: i + 1,
          token: line.split("=", 1)[0],
        })
      }
    }
  }
  return matches
}

const normalizeIso = (value) => {
  const ts = String(value ?? "").trim()
  if (!ts) return null
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export const normalizeQuarantineStore = (
  raw,
  maxEntries = MAX_QUARANTINE_ENTRIES_DEFAULT,
) => {
  const source = ensureObject(raw)
  const entriesSrc = ensureObject(source.entries)
  const entries = {}
  for (const [fingerprint, row] of Object.entries(entriesSrc)) {
    const key = String(fingerprint ?? "").trim()
    if (!key) continue
    const item = ensureObject(row)
    const failCount = clampInt(item.failCount, 0, 0, 1_000_000)
    const lastFailureCode = toUpper(item.lastFailureCode) || null
    const lastSeenAt = normalizeIso(item.lastSeenAt)
    const expiresAt = normalizeIso(item.expiresAt)
    const quarantined = Boolean(
      expiresAt && Date.parse(expiresAt) > Date.now() && failCount > 0,
    )
    entries[key] = {
      fingerprint: key,
      failCount,
      lastFailureCode,
      lastSeenAt,
      expiresAt,
      quarantined,
    }
  }
  const cappedEntries = Object.fromEntries(
    Object.entries(entries)
      .sort(([, a], [, b]) =>
        String(a.lastSeenAt ?? "").localeCompare(String(b.lastSeenAt ?? "")),
      )
      .slice(-Math.max(1, Math.floor(Number(maxEntries) || 1))),
  )
  return {
    version: "autosearch_quarantine_v1",
    updatedAt: new Date().toISOString(),
    entries: cappedEntries,
  }
}

export const updateQuarantineStoreOnFailure = ({
  store,
  fingerprints,
  failureCode,
  failThreshold,
  ttlMinutes,
  maxEntries = MAX_QUARANTINE_ENTRIES_DEFAULT,
  nowIso = new Date().toISOString(),
}) => {
  const failureCodeUpper = toUpper(failureCode)
  const threshold = Math.max(2, Math.floor(Number(failThreshold) || 2))
  const ttlMs = Math.max(60_000, Math.floor(Number(ttlMinutes) || 0) * 60_000)
  const isMoonshotInsufficientPool =
    failureCodeUpper === "INSUFFICIENT_POOL_MOONSHOT_GATE"
  const effectiveThreshold = isMoonshotInsufficientPool
    ? threshold + 1
    : threshold
  const effectiveTtlMs = isMoonshotInsufficientPool
    ? Math.max(60_000, Math.floor(ttlMs * 0.5))
    : ttlMs
  const next = normalizeQuarantineStore(store, maxEntries)
  const seen = new Set()
  const items = Array.isArray(fingerprints)
    ? fingerprints.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  const touched = []
  for (const fp of items) {
    if (seen.has(fp)) continue
    seen.add(fp)
    const prev = ensureObject(next.entries[fp])
    const failCount = clampInt(Number(prev.failCount ?? 0) + 1, 1, 1, 1_000_000)
    const shouldQuarantine = failCount >= effectiveThreshold
    const expiresAt = shouldQuarantine
      ? new Date(Date.parse(nowIso) + effectiveTtlMs).toISOString()
      : null
    const row = {
      fingerprint: fp,
      failCount,
      lastFailureCode: toUpper(failureCode) || null,
      lastSeenAt: nowIso,
      expiresAt,
      quarantined: Boolean(
        expiresAt && Date.parse(expiresAt) > Date.now() && shouldQuarantine,
      ),
    }
    next.entries[fp] = row
    touched.push(row)
  }
  return normalizeQuarantineStore(next, maxEntries)
}

export const resolveActiveQuarantineFingerprints = ({
  store,
  nowIso = new Date().toISOString(),
  maxEntries = MAX_QUARANTINE_ENTRIES_DEFAULT,
}) => {
  const next = normalizeQuarantineStore(store, maxEntries)
  const nowMs = Date.parse(nowIso)
  const active = []
  for (const [key, row] of Object.entries(next.entries)) {
    const expiresMs = Date.parse(String(row.expiresAt ?? ""))
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      active.push(key)
    }
  }
  return {
    activeFingerprints: active,
    nextStore: next,
  }
}
