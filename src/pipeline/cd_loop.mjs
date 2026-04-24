import path from "node:path"
import fsp from "node:fs/promises"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"

import { readJsonl, writeJson, readJson, ensureDir, pathExists } from "../lib/io.mjs"
import { resolveActiveAbBinding } from "../lib/ab_manifest.mjs"
import { buildChampionBundle } from "../lib/champion_bundle_emit.mjs"
import {
  buildFamilyPoolManifest,
  resolveFamilyPoolConfig
} from "../lib/family_pool.mjs"
import {
  createEmptyDropRegistry,
  readDropRegistry,
  resolveDropRegistrySnapshotPath,
  resolveEffectiveDropTemplateIds,
  writeDropRegistry
} from "../lib/drop_registry.mjs"
import {
  buildCdLoopLineageSnapshot,
  computeLineageKey,
  resolveLineageStatePaths
} from "../lib/lineage_state.mjs"
import {
  buildPrototypeContributionLedger,
  loadPrototypeContributionLedger,
  resolvePrototypeLedgerPath
} from "../lib/prototype_ledger.mjs"
import {
  evaluateDeploymentDebt,
  evaluateStepELockboxGate
} from "../lib/lockbox_gate.mjs"
import { buildSelectionHitAt1Snapshot } from "../lib/selection_metric.mjs"
import { GROUPS } from "../lib/similarity.mjs"
import { buildCdLoopStepDLightProfile } from "./step_d_profile.mjs"
import { runStepC0 } from "./step_c0_family_mine.mjs"
import { runStepC1 } from "./step_c1_family_probe.mjs"
import { runStepC2 } from "./step_c2_family_dedup.mjs"
import { runStepC } from "./step_c_pattern_mine.mjs"
import { buildStepDPolicyBundle, writeStepDPolicyBundle } from "./step_d_policy_bundle.mjs"
import { runStepDTrainOnlinePolicy } from "./step_d_train_online_policy.mjs"
import { runStepE } from "./step_e_lockbox_backtest.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const clampSigned = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < -1) return -1
  if (n > 1) return 1
  return n
}

const GROUP_KEYS = Array.isArray(GROUPS) && GROUPS.length
  ? GROUPS.slice()
  : ["trend", "candle", "volume", "shape", "gap"]
const HIT_RATE_TIE_BAND = 0.01
const WILSON_Z_95 = 1.959963984540054
const DEFAULT_PROMOTION_PICKED_FLOOR = 60

const resolvePromotionPickedFloor = (cfg) =>
  Math.max(
    0,
    Math.floor(Number(cfg?.minPickedCountForPromotion ?? DEFAULT_PROMOTION_PICKED_FLOOR) || 0),
  )

const resolveOptionalNonNegativeInt = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return Math.max(0, Math.floor(Number(fallback) || 0))
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return Math.max(0, Math.floor(Number(fallback) || 0))
  }
  return Math.max(0, Math.floor(n))
}

const resolveOptionalNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const resolveOptionalRate = (value, fallback = null) => {
  const n = resolveOptionalNumber(value, fallback)
  if (!Number.isFinite(n)) return null
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const resolveGoalMode = (value) => {
  const text = String(value ?? "LEGACY_PNL_V1").trim().toUpperCase()
  if (text === "TARGET_FIRST_V2") return "TARGET_FIRST_V2"
  return "LEGACY_PNL_V1"
}

const resolvePositionSemantics = (value) => {
  const text = String(value ?? "SINGLE_POSITION_V1").trim().toUpperCase()
  if (text === "OVERLAP_DAILY_ONE_PICK_V2") return "OVERLAP_DAILY_ONE_PICK_V2"
  return "SINGLE_POSITION_V1"
}

const averageFinite = (values) => {
  const list = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
  if (list.length < 1) return 0
  return list.reduce((acc, value) => acc + value, 0) / list.length
}

const buildDGateMetrics = (metrics) => {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(source)
  return {
    targetHitRateEval:
      Number(
        source?.targetHitRateEval ?? source?.targetHitRate ?? source?.pickHitRateEval ?? source?.pickHitRate ?? 0,
      ) || 0,
    selectionHitAt1Eval: selectionHitAt1.resolved,
    selectionHitAt1RawEval: selectionHitAt1.raw,
    selectionHitAt1ResolvedEval: selectionHitAt1.resolved,
    selectionHitAt1MetricSourceEval: selectionHitAt1.source,
    selectionHitAt1AgreementFallbackAwareEval: selectionHitAt1.agreementFallbackAware,
    executedTargetHitRateEval:
      Number(
        source?.executedTargetHitRateEval ??
          source?.executedTargetHitRate ??
          source?.executedHitRateEval ??
          source?.executedHitRate ??
          0,
      ) || 0,
    stopRateEval: Number(source?.stopRateEval ?? source?.stopRate ?? 0) || 0,
    timeoutNegativeRateEval:
      Number(source?.timeoutNegativeRateEval ?? source?.timeoutNegativeRate ?? 0) || 0,
    oracleHitRateTopKEval:
      Number(source?.oracleHitRateTopKEval ?? source?.oracleHitRateTopK ?? 0) || 0
  }
}

const buildEGateMetrics = (metrics) => {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return {
    targetHitRate: Number(source?.targetHitRate ?? 0) || 0,
    targetHitCount: Math.max(0, Number(source?.targetHitCount ?? 0) || 0),
    stopRate: Number(source?.stopRate ?? 0) || 0,
    timeoutNegativeRate: Number(source?.timeoutNegativeRate ?? 0) || 0,
    winRate: Number(source?.winRate ?? 0) || 0,
    avgNetRet: Number(source?.avgNetRet ?? 0) || 0,
    cumulativeReturn: Number(source?.cumulativeReturn ?? 0) || 0,
    totalTrades: Math.max(0, Number(source?.totalTrades ?? 0) || 0)
  }
}

const resolveResearchDGateThresholds = ({ gateCfg, fallbackMinD, profile }) => {
  const safeGateCfg = gateCfg && typeof gateCfg === "object" ? gateCfg : {}
  const baseMin = clamp01(safeGateCfg?.minTargetHitRateEval ?? safeGateCfg?.minD ?? fallbackMinD ?? 0)
  const selectionDefault = profile === "promotion" ? baseMin * 0.6 : baseMin * 0.5
  const executedDefault = profile === "promotion" ? baseMin * 0.45 : baseMin * 0.35
  const stopDefault = profile === "promotion" ? 0.55 : 0.6
  const timeoutDefault = profile === "promotion" ? 0.45 : 0.6
  return {
    minTargetHitRateEval: baseMin,
    minSelectionHitAt1Eval: clamp01(
      safeGateCfg?.minSelectionHitAt1Eval ?? selectionDefault,
    ),
    minExecutedTargetHitRateEval: clamp01(
      safeGateCfg?.minExecutedTargetHitRateEval ?? executedDefault,
    ),
    maxStopRateEval: clamp01(safeGateCfg?.maxStopRateEval ?? stopDefault),
    maxTimeoutNegativeRateEval: clamp01(
      safeGateCfg?.maxTimeoutNegativeRateEval ?? timeoutDefault,
    )
  }
}

const evaluateResearchDGate = ({ metrics, gateCfg, fallbackMinD, profile = "discard" }) => {
  const thresholds = resolveResearchDGateThresholds({ gateCfg, fallbackMinD, profile })
  const checks = {
    targetHitRateEval:
      Number(metrics?.targetHitRateEval ?? 0) >= thresholds.minTargetHitRateEval,
    selectionHitAt1Eval:
      Number(metrics?.selectionHitAt1Eval ?? 0) >= thresholds.minSelectionHitAt1Eval,
    executedTargetHitRateEval:
      Number(metrics?.executedTargetHitRateEval ?? 0) >= thresholds.minExecutedTargetHitRateEval,
    stopRateEval:
      Number(metrics?.stopRateEval ?? 1) <= thresholds.maxStopRateEval,
    timeoutNegativeRateEval:
      Number(metrics?.timeoutNegativeRateEval ?? 1) <= thresholds.maxTimeoutNegativeRateEval
  }
  const reason = (() => {
    if (!checks.targetHitRateEval) return "TARGET_HIT_RATE_EVAL_LOW"
    if (!checks.selectionHitAt1Eval) return "SELECTION_HIT_AT_1_EVAL_LOW"
    if (!checks.executedTargetHitRateEval) return "EXECUTED_TARGET_HIT_RATE_EVAL_LOW"
    if (!checks.stopRateEval) return "STOP_RATE_EVAL_HIGH"
    if (!checks.timeoutNegativeRateEval) return "TIMEOUT_NEGATIVE_RATE_EVAL_HIGH"
    return "PASS"
  })()
  const passed = Object.values(checks).every((value) => value === true)
  return {
    enabled: true,
    failed: passed !== true,
    passed,
    reason,
    checks,
    thresholds,
    metrics
  }
}

const resolveResearchEGateThresholds = ({ gateCfg, fallbackMinE, cfg, profile }) => {
  const safeGateCfg = gateCfg && typeof gateCfg === "object" ? gateCfg : {}
  const lockboxGateCfg = cfg?.lockboxGate ?? {}
  const stopDefault = profile === "promotion"
    ? clamp01(lockboxGateCfg?.maxStopRate ?? 0.45)
    : clamp01(lockboxGateCfg?.maxStopRate ?? 0.6)
  const timeoutDefault = profile === "promotion"
    ? clamp01(lockboxGateCfg?.maxTimeoutNegativeRate ?? 0.35)
    : clamp01(lockboxGateCfg?.maxTimeoutNegativeRate ?? 0.6)
  return {
    minTargetHitRate: clamp01(
      safeGateCfg?.minTargetHitRate ?? safeGateCfg?.minE ?? fallbackMinE ?? 0,
    ),
    maxStopRate: clamp01(safeGateCfg?.maxStopRate ?? stopDefault),
    maxTimeoutNegativeRate: clamp01(
      safeGateCfg?.maxTimeoutNegativeRate ?? timeoutDefault,
    ),
    requireZeroLookahead:
      safeGateCfg?.requireZeroLookahead !== false,
    requireLockboxEligible:
      profile === "promotion"
        ? safeGateCfg?.requireLockboxEligible !== false
        : safeGateCfg?.requireLockboxEligible === true
  }
}

const evaluateResearchEGate = ({
  metrics,
  gateCfg,
  fallbackMinE,
  cfg,
  lockboxGateEval,
  executed,
  cGateFailed,
  profile = "discard"
}) => {
  const thresholds = resolveResearchEGateThresholds({
    gateCfg,
    fallbackMinE,
    cfg,
    profile
  })
  const checks = {
    cGate: cGateFailed !== true,
    executed: executed === true,
    targetHitRate: Number(metrics?.targetHitRate ?? 0) >= thresholds.minTargetHitRate,
    stopRate: Number(metrics?.stopRate ?? 1) <= thresholds.maxStopRate,
    timeoutNegativeRate:
      Number(metrics?.timeoutNegativeRate ?? 1) <= thresholds.maxTimeoutNegativeRate,
    lookahead:
      thresholds.requireZeroLookahead !== true ||
      (
        Math.max(0, Number(lockboxGateEval?.metrics?.lookaheadViolations ?? 0) || 0) === 0 &&
        Math.max(
          0,
          Number(lockboxGateEval?.metrics?.executionLookaheadViolations ?? 0) || 0,
        ) === 0
      ),
    lockboxEligible:
      thresholds.requireLockboxEligible !== true || lockboxGateEval?.eligible === true
  }
  const reason = (() => {
    if (!checks.cGate) return "C_GATE_FAILED"
    if (!checks.executed) return "STEP_E_UNAVAILABLE"
    if (!checks.targetHitRate) return "TARGET_HIT_RATE_LOW"
    if (!checks.stopRate) return "STOP_RATE_HIGH"
    if (!checks.timeoutNegativeRate) return "TIMEOUT_NEGATIVE_RATE_HIGH"
    if (!checks.lookahead) return "LOOKAHEAD_VIOLATION"
    if (!checks.lockboxEligible) return "LOCKBOX_GATE_FAILED"
    return "PASS"
  })()
  const passed = Object.values(checks).every((value) => value === true)
  return {
    enabled: true,
    failed: passed !== true,
    passed,
    reason,
    checks,
    thresholds,
    metrics
  }
}

const buildCGate = ({ stepCSummary, cfg }) => {
  const summary = stepCSummary && typeof stepCSummary === "object" ? stepCSummary : {}
  const temporal = summary?.temporalStability ?? {}
  const selectedOverview = temporal?.selectedClusterOverview ?? {}
  const selectedMix = temporal?.selectedPrototypeEraMix ?? {}
  const prototypes = Array.isArray(summary?.localPrototypes)
    ? summary.localPrototypes
    : Array.isArray(summary?.prototypes)
      ? summary.prototypes
      : []
  const cQualityBreakdowns = prototypes
    .map((row) => row?.cQualityScoreBreakdown)
    .filter((row) => row && typeof row === "object")
  const effectiveEraCoverage = Number(
    selectedOverview?.minEraCoverageRatio ??
      selectedOverview?.medianEraCoverageRatio ??
      0,
  ) || 0
  const effectiveMaxSingleEraShare = Number(
    selectedOverview?.maxMaxSingleEraShare ??
      selectedMix?.maxEraShare ??
      temporal?.selection?.prototypeEraRebalanceAchievedMaxEraShare ??
      1,
  ) || 0
  const regimeConsistency = clamp01(
    averageFinite(cQualityBreakdowns.map((row) => row?.regimeConsistency)),
  )
  const donorStopBias = averageFinite(cQualityBreakdowns.map((row) => row?.stopRateEval))
  const donorTimeoutNegativeBias = averageFinite(
    cQualityBreakdowns.map((row) => row?.timeoutNegativeRateEval),
  )
  const structuralStopBias = averageFinite(prototypes.map((row) => row?.stopRate3d))
  const oracleCoverage = averageFinite(cQualityBreakdowns.map((row) => row?.oracleAssist))
  const configuredMinCoverage = clamp01(
    temporal?.selection?.effectiveMinEraCoverageRatio ??
      temporal?.selection?.minEraCoverageRatio ??
      cfg?.pattern?.temporalStability?.minEraCoverageRatio ??
      0,
  )
  const configuredMaxSingleEraShare = clamp01(
    temporal?.selection?.effectiveMaxSingleEraShare ??
      temporal?.selection?.maxSingleEraShare ??
      cfg?.pattern?.temporalStability?.maxSingleEraShare ??
      1,
  )
  const checks = {
    eraCoverage: effectiveEraCoverage >= configuredMinCoverage,
    maxSingleEraShare: effectiveMaxSingleEraShare <= configuredMaxSingleEraShare,
    regimeConsistency: regimeConsistency >= 0.35,
    stopBias:
      Math.min(
        donorStopBias > 0 ? donorStopBias : 1,
        structuralStopBias > 0 ? structuralStopBias : 1,
      ) <= 0.6,
    timeoutNegativeBias: donorTimeoutNegativeBias <= 0.6
  }
  const failed = Object.values(checks).some((value) => value === false)
  return {
    enabled: true,
    failed,
    checks,
    metrics: {
      eraCoverageRatio: effectiveEraCoverage,
      maxSingleEraShare: effectiveMaxSingleEraShare,
      regimeConsistency,
      stopBiasRate: structuralStopBias,
      timeoutNegativeBiasRate: donorTimeoutNegativeBias,
      oracleCoverage
    },
    smokeEligible: true
  }
}

const resolvePromotionPickedCeil = ({ cfg, floor }) => {
  const rawCeil = resolveOptionalNonNegativeInt(cfg?.maxPickedCountForPromotion, 80)
  if (rawCeil <= 0) return Number.POSITIVE_INFINITY
  return Math.max(Math.max(0, Number(floor) || 0), rawCeil)
}

const wilsonLowerBound = ({ success, total, z = WILSON_Z_95 }) => {
  const n = Math.max(0, Number(total ?? 0) || 0)
  const k = Math.max(0, Number(success ?? 0) || 0)
  if (n <= 0) return 0
  const p = Math.min(1, Math.max(0, k / n))
  const z2 = z ** 2
  const center = p + z2 / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  const denom = 1 + z2 / n
  if (!Number.isFinite(denom) || denom <= 0) return 0
  const lb = (center - spread) / denom
  if (!Number.isFinite(lb)) return 0
  if (lb < 0) return 0
  if (lb > 1) return 1
  return lb
}

const normalizeRegimeBreakdown = (raw) => {
  const out = {}
  const src = raw && typeof raw === "object" ? raw : {}
  for (const [tag, row] of Object.entries(src)) {
    const key = String(tag ?? "").trim()
    if (!key) continue
    const pickedCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    const pickHitCount = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
    out[key] = {
      pickedCount,
      pickHitCount,
      pickHitRate: pickedCount > 0 ? pickHitCount / pickedCount : 0
    }
  }
  return out
}

const compactScopeSnapshot = (scope) => {
  const row = scope && typeof scope === "object" ? scope : null
  if (!row) return null
  const out = {
    tradingDays: Math.max(0, Number(row?.tradingDays ?? 0) || 0),
    pickedDays: Math.max(0, Number(row?.pickedDays ?? 0) || 0),
    pickedCount: Math.max(0, Number(row?.pickedCount ?? 0) || 0),
    pickHitCount: Math.max(0, Number(row?.pickHitCount ?? 0) || 0),
    pickHitRate: Number(row?.pickHitRate ?? 0) || 0,
    executedCount: Math.max(0, Number(row?.executedCount ?? 0) || 0),
    executionCoverage: Number(row?.executionCoverage ?? 0) || 0,
    d1TradeDays: Math.max(0, Number(row?.d1TradeDays ?? 0) || 0),
    d2BlockedAfterD1Days: Math.max(0, Number(row?.d2BlockedAfterD1Days ?? 0) || 0),
    topGateReasons: Array.isArray(row?.topGateReasons) ? row.topGateReasons.slice(0, 3) : [],
    topExecutionBlockers: Array.isArray(row?.topExecutionBlockers)
      ? row.topExecutionBlockers.slice(0, 3)
      : []
  }
}

const computeSnipsOpe = (logs) => {
  const rows = Array.isArray(logs) ? logs : []
  let behaviorRewardSum = 0
  let behaviorCount = 0
  let weightedRewardSum = 0
  let weightSum = 0
  let matchedCount = 0
  let skippedNoPropensity = 0
  for (const row of rows) {
    if (Number(row?.pickCount ?? 0) <= 0) continue
    const picked = row?.picked ?? null
    if (!picked) continue
    const reward = picked?.successInWindow === true ? 1 : 0
    behaviorRewardSum += reward
    behaviorCount += 1
    const propensity = Number(row?.propensity)
    if (!Number.isFinite(propensity) || propensity <= 0) {
      skippedNoPropensity += 1
      continue
    }
    const targetTop = row?.topK?.[0]
    const targetSymbol = String(targetTop?.symbol ?? "").trim()
    const pickedSymbol = String(picked?.symbol ?? "").trim()
    if (!targetSymbol || !pickedSymbol) {
      skippedNoPropensity += 1
      continue
    }
    if (targetSymbol !== pickedSymbol) continue
    const weight = 1 / propensity
    if (!Number.isFinite(weight) || weight <= 0) continue
    weightedRewardSum += weight * reward
    weightSum += weight
    matchedCount += 1
  }
  const behaviorRate = behaviorCount > 0 ? behaviorRewardSum / behaviorCount : 0
  const snipsRate = weightSum > 0 ? weightedRewardSum / weightSum : behaviorRate
  return {
    behaviorRate,
    snipsRate,
    delta: snipsRate - behaviorRate,
    samples: behaviorCount,
    matchedCount,
    skippedNoPropensity
  }
}

const evaluateRegimeGuard = ({ metrics, cfg }) => {
  const guardCfg = cfg ?? {}
  if (guardCfg?.enabled !== true) {
    return {
      enabled: false,
      ok: true,
      requiredFloor: 0,
      qualifiedBuckets: 0,
      failedBuckets: []
    }
  }
  const minPicksPerBucket = Math.max(1, Math.floor(Number(guardCfg?.minPicksPerBucket ?? 8) || 8))
  const maxHitRateGapFromLcb = Math.max(
    0,
    Math.min(1, Number(guardCfg?.maxHitRateGapFromLcb ?? 0.2) || 0.2),
  )
  const minQualifiedBuckets = Math.max(
    1,
    Math.floor(Number(guardCfg?.minQualifiedBuckets ?? 1) || 1),
  )
  const lcb = Math.max(0, Number(metrics?.pickHitRateLcb95 ?? 0) || 0)
  const requiredFloor = Math.max(0, lcb - maxHitRateGapFromLcb)
  const breakdown = metrics?.regimeBreakdown ?? {}
  let qualifiedBuckets = 0
  const failedBuckets = []
  for (const [tag, row] of Object.entries(breakdown)) {
    const pickedCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    if (pickedCount < minPicksPerBucket) continue
    qualifiedBuckets += 1
    const hitRate = Math.max(0, Number(row?.pickHitRate ?? 0) || 0)
    if (hitRate + 1e-12 < requiredFloor) {
      failedBuckets.push({
        tag,
        pickedCount,
        pickHitRate: hitRate
      })
    }
  }
  const enoughBuckets = qualifiedBuckets >= minQualifiedBuckets
  const ok = enoughBuckets && failedBuckets.length === 0
  return {
    enabled: true,
    ok,
    requiredFloor,
    minPicksPerBucket,
    minQualifiedBuckets,
    qualifiedBuckets,
    failedBuckets
  }
}

const normalizeGroupWeights = (raw) => {
  const out = {}
  let sum = 0
  for (const key of GROUP_KEYS) {
    const n = Number(raw?.[key] ?? 0)
    const safe = Number.isFinite(n) && n > 0 ? n : 0
    out[key] = safe
    sum += safe
  }
  if (sum <= 0) {
    const eq = 1 / GROUP_KEYS.length
    for (const key of GROUP_KEYS) out[key] = eq
    return out
  }
  for (const key of GROUP_KEYS) out[key] = out[key] / sum
  return out
}

const cmpNumber = (a, b, desc = false) => {
  const x = Number.isFinite(a) ? a : desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  const y = Number.isFinite(b) ? b : desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  return desc ? y - x : x - y
}

const resolveSecondPickGateMode = (gate) =>
  String(gate?.phase ?? gate?.mode ?? "disabled")
    .trim()
    .toLowerCase()

const normalizeSecondPickGateConfig = (gate) => {
  const mode = resolveSecondPickGateMode(gate)
  return {
    ...(gate ?? {}),
    mode,
    phase: mode
  }
}

const toDateTag = (date = new Date()) => {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const mi = String(date.getUTCMinutes()).padStart(2, "0")
  const ss = String(date.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
}

const parseDateKeyUtc = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  if (!text) return null
  const date = new Date(`${text}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) return null
  return date
}

const dateSpanDaysInclusive = ({ from, to }) => {
  const start = parseDateKeyUtc(from)
  const end = parseDateKeyUtc(to)
  if (!start || !end) return 0
  const span = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  return Math.max(0, span)
}

const resolveNumberArray = (raw, defaultValues) => {
  if (!Array.isArray(raw)) return defaultValues
  const out = []
  for (const value of raw) {
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    out.push(n)
  }
  return out.length > 0 ? out : defaultValues
}

const clonePlain = (value) => JSON.parse(JSON.stringify(value ?? {}))

const hashTextSha1 = (text) =>
  createHash("sha1").update(String(text ?? "")).digest("hex")

const hashFileSha1 = async (filePath) => {
  try {
    if (!filePath || !pathExists(filePath)) return ""
    const data = await fsp.readFile(filePath)
    return createHash("sha1").update(data).digest("hex")
  } catch {
    return ""
  }
}

const FULL_MATERIALIZE_CACHE_VERSION = "v2"
const FULL_MATERIALIZE_CACHE_CODE_PATHS = [
  "src/pipeline/step_d_online_loop.mjs",
  "src/lib/decision_policy.mjs",
  "src/lib/step_policy_chain.mjs",
  "src/lib/execution_gate.mjs",
  "src/lib/agreement_gate.mjs",
  "src/lib/false_positive_model.mjs",
  "src/lib/day_type_model.mjs",
  "src/lib/similarity.mjs"
]
const PROBE_CYCLE_VERSION = "v6"
const PROBE_CYCLE_MODEL_CODE_PATHS = [
  "src/pipeline/step_c0_family_mine.mjs",
  "src/pipeline/step_c_pattern_mine.mjs",
  "src/pipeline/step_d_online_loop.mjs",
  "src/pipeline/step_e_lockbox_backtest.mjs",
  "src/lib/config.mjs",
  "src/lib/decision_policy.mjs",
  "src/lib/step_policy_chain.mjs",
  "src/lib/execution_gate.mjs",
  "src/lib/agreement_gate.mjs",
  "src/lib/false_positive_gate.mjs",
  "src/lib/meta_selector.mjs",
  "src/lib/day_type_policy.mjs",
  "src/lib/day_type_model.mjs",
  "src/lib/similarity.mjs"
]
const PROBE_CYCLE_GOVERNANCE_CODE_PATHS = [
  "src/pipeline/cd_loop.mjs"
]

const resolveProgressTrackingPaths = (lineageStateDir) => ({
  candidatePeakPath: path.join(lineageStateDir, "candidate_peak_probe.json"),
  candidatePeakHistoryPath: path.join(lineageStateDir, "candidate_peak_probe_history.jsonl"),
  acceptedBaselinePath: path.join(lineageStateDir, "accepted_probe_baseline.json"),
  acceptedBaselineHistoryPath: path.join(lineageStateDir, "accepted_probe_history.jsonl"),
  researchParentCandidatePath: path.join(lineageStateDir, "research_parent_candidate.json"),
  researchParentCandidateHistoryPath: path.join(
    lineageStateDir,
    "research_parent_candidate_history.jsonl",
  ),
  historicalProgressIndexPath: path.join(lineageStateDir, "historical_progress_index.jsonl")
})

const normalizeProbeLane = (value) =>
  String(value ?? "operating").trim().toLowerCase() === "research"
    ? "research"
    : "operating"

const resolveProbeLaneConfig = ({ cfg, probeLane }) =>
  normalizeProbeLane(probeLane) === "research"
    ? (cfg?.researchProbeCycle ?? {})
    : (cfg?.acceptedBaselineProbeCycle ?? {})

const resolveProbeCycleTrackingPaths = ({
  cwd,
  probeLane,
  parentKey,
  lineageKey
}) => {
  const safeLane = normalizeProbeLane(probeLane)
  const stableKey = String(parentKey ?? "").trim() || `lineage:${String(lineageKey ?? "").trim()}`
  const familyKey = hashTextSha1(stableKey)
  const dir =
    safeLane === "research"
      ? path.join(cwd, "artifacts", "state", "research_probe_cycles", familyKey)
      : path.join(cwd, "artifacts", "state", "accepted_probe_cycles", familyKey)
  return {
    dir,
    probeLane: safeLane,
    familyKey,
    stableKey,
    statePath: path.join(dir, "accepted_probe_cycle_state.json"),
    historyPath: path.join(dir, "accepted_probe_cycle_history.jsonl")
  }
}

const resolveBestEpochNumber = (record) => {
  const text = String(record?.bestEpoch ?? "").trim()
  const match = text.match(/^(\d+)/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

const resolveProgressRecordSeed = ({ record, requireUsableStepE = false }) => {
  if (!record) return null
  if (requireUsableStepE && !hasUsableAcceptedStepE(record)) return null
  const loopDir = String(record?.loopDir ?? "").trim()
  const round = Math.max(1, Number(record?.round ?? 1) || 1)
  const epoch = resolveBestEpochNumber(record)
  if (!loopDir || !epoch) return null
  const roundTag = `r${String(round).padStart(2, "0")}`
  const epochTag = `e${String(epoch).padStart(2, "0")}`
  const fullStepDDir = path.join(loopDir, roundTag, `${epochTag}_full`, "step-d")
  const fastStepDDir = path.join(loopDir, roundTag, epochTag, "step-d")
  const stepDDir = pathExists(path.join(fullStepDDir, "step_d_summary.json"))
    ? fullStepDDir
    : fastStepDDir
  const weightsPath = path.join(stepDDir, "weights_final.json")
  const policyStatePath = path.join(stepDDir, "step_d_policy_state.json")
  const policyBundlePath = path.join(stepDDir, "step_d_policy_bundle.json")
  const stepCSummaryPath = path.join(loopDir, roundTag, "step-c", "step_c_summary.json")
  const stepCRuntimePath = path.join(loopDir, roundTag, "step-c", "pattern_library_runtime.json")
  const stepCLibraryPath = path.join(loopDir, roundTag, "step-c", "pattern_library.json")
  const stepC0FamilyIndexPath = path.join(loopDir, roundTag, "step-c0", "c0_family_index.json")
  const stepC0MembershipPath = path.join(loopDir, roundTag, "step-c0", "c0_family_membership.jsonl")
  const stepC0SummaryPath = path.join(loopDir, roundTag, "step-c0", "c0_summary.json")
  const stepC1IndexPath = path.join(loopDir, roundTag, "step-c1", "c1_family_probe_index.json")
  const stepC1ResultsPath = path.join(loopDir, roundTag, "step-c1", "c1_family_probe_results.jsonl")
  const stepC1SummaryPath = path.join(loopDir, roundTag, "step-c1", "c1_summary.json")
  const stepC2IndexPath = path.join(loopDir, roundTag, "step-c2", "c2_dedup_index.json")
  const stepC2GroupsPath = path.join(loopDir, roundTag, "step-c2", "c2_dedup_groups.jsonl")
  const stepC2SummaryPath = path.join(loopDir, roundTag, "step-c2", "c2_summary.json")
  const commonStatePath = path.join(loopDir, "champion_common_state.json")
  if (!pathExists(weightsPath)) return null
  return {
    runId: String(record?.runId ?? "").trim() || null,
    sessionId: String(record?.sessionId ?? "").trim() || null,
    loopDir,
    roundTag,
    epochTag,
    stepDDir,
    weightsPath,
    policyStatePath: pathExists(policyStatePath) ? policyStatePath : "",
    policyBundlePath: pathExists(policyBundlePath) ? policyBundlePath : "",
    stepCSummaryPath: pathExists(stepCSummaryPath) ? stepCSummaryPath : "",
    stepCRuntimePath: pathExists(stepCRuntimePath) ? stepCRuntimePath : "",
    stepCLibraryPath: pathExists(stepCLibraryPath) ? stepCLibraryPath : "",
    stepC0FamilyIndexPath: pathExists(stepC0FamilyIndexPath) ? stepC0FamilyIndexPath : "",
    stepC0MembershipPath: pathExists(stepC0MembershipPath) ? stepC0MembershipPath : "",
    stepC0SummaryPath: pathExists(stepC0SummaryPath) ? stepC0SummaryPath : "",
    stepC1IndexPath: pathExists(stepC1IndexPath) ? stepC1IndexPath : "",
    stepC1ResultsPath: pathExists(stepC1ResultsPath) ? stepC1ResultsPath : "",
    stepC1SummaryPath: pathExists(stepC1SummaryPath) ? stepC1SummaryPath : "",
    stepC2IndexPath: pathExists(stepC2IndexPath) ? stepC2IndexPath : "",
    stepC2GroupsPath: pathExists(stepC2GroupsPath) ? stepC2GroupsPath : "",
    stepC2SummaryPath: pathExists(stepC2SummaryPath) ? stepC2SummaryPath : "",
    commonStatePath: pathExists(commonStatePath) ? commonStatePath : ""
  }
}

const resolveAcceptedBaselineSeed = ({ record }) =>
  resolveProgressRecordSeed({
    record,
    requireUsableStepE: true
  })

const resolveCandidatePeakSeed = ({ record }) =>
  resolveProgressRecordSeed({
    record,
    requireUsableStepE: false
  })

const resolveProgressRecordKey = ({ seed, record }) => {
  if (seed) {
    const runId = String(seed?.runId ?? "").trim()
    const sessionId = String(seed?.sessionId ?? "").trim()
    const roundTag = String(seed?.roundTag ?? "").trim()
    const epochTag = String(seed?.epochTag ?? "").trim()
    if (runId && sessionId && roundTag && epochTag) {
      return `${runId}:${sessionId}:${roundTag}:${epochTag}`
    }
  }
  const safeRecord = record ?? null
  const runId = String(safeRecord?.runId ?? "").trim()
  const sessionId = String(safeRecord?.sessionId ?? "").trim()
  const round = Math.max(1, Number(safeRecord?.round ?? 1) || 1)
  const epoch = resolveBestEpochNumber(safeRecord)
  if (!runId || !sessionId || !epoch) return ""
  const roundTag = `r${String(round).padStart(2, "0")}`
  const epochTag = `e${String(epoch).padStart(2, "0")}`
  return `${runId}:${sessionId}:${roundTag}:${epochTag}`
}

const resolveAcceptedBaselineKey = ({ seed, record }) =>
  resolveProgressRecordKey({ seed, record })

const computeProbeCycleFingerprint = async ({
  cwd,
  configPath
}) => {
  const modelCodeHashes = {}
  for (const relPath of PROBE_CYCLE_MODEL_CODE_PATHS) {
    modelCodeHashes[relPath] = await hashFileSha1(path.join(cwd, relPath))
  }
  const governanceCodeHashes = {}
  for (const relPath of PROBE_CYCLE_GOVERNANCE_CODE_PATHS) {
    governanceCodeHashes[relPath] = await hashFileSha1(path.join(cwd, relPath))
  }
  const configHash = await hashFileSha1(configPath)
  const modelPayload = {
    version: PROBE_CYCLE_VERSION,
    configHash,
    modelCodeHashes
  }
  const governancePayload = {
    version: PROBE_CYCLE_VERSION,
    governanceCodeHashes
  }
  return {
    version: PROBE_CYCLE_VERSION,
    configHash,
    codeHashes: modelCodeHashes,
    modelCodeHashes,
    governanceCodeHashes,
    governanceFingerprint: hashTextSha1(JSON.stringify(governancePayload)),
    fingerprint: hashTextSha1(JSON.stringify(modelPayload))
  }
}

const normalizeProbeCycleState = ({
  raw,
  lineageKey
}) => ({
  version: String(raw?.version ?? PROBE_CYCLE_VERSION).trim() || PROBE_CYCLE_VERSION,
  lineageKey,
  probeLane: normalizeProbeLane(raw?.probeLane),
  parentKey: String(raw?.parentKey ?? raw?.acceptedBaselineKey ?? "").trim(),
  parentMode: String(raw?.parentMode ?? "").trim(),
  acceptedBaselineKey: String(raw?.acceptedBaselineKey ?? "").trim(),
  lastProbeFingerprint: String(raw?.lastProbeFingerprint ?? "").trim(),
  lastBaselineExploitFingerprint: String(raw?.lastBaselineExploitFingerprint ?? "").trim(),
  lastSessionMode: String(raw?.lastSessionMode ?? "").trim(),
  lastSessionId: String(raw?.lastSessionId ?? "").trim(),
  lastRunId: String(raw?.lastRunId ?? "").trim(),
  noCodeProbeStreak: Math.max(0, Math.floor(Number(raw?.noCodeProbeStreak ?? 0) || 0)),
  nonImprovementStreak: Math.max(0, Math.floor(Number(raw?.nonImprovementStreak ?? 0) || 0)),
  stepEMissingStreak: Math.max(0, Math.floor(Number(raw?.stepEMissingStreak ?? 0) || 0)),
  plateauActive: raw?.plateauActive === true,
  plateauReason: String(raw?.plateauReason ?? "").trim(),
  plateauTriggeredAt: String(raw?.plateauTriggeredAt ?? "").trim(),
  structuralExperimentCountSincePlateau: Math.max(
    0,
    Math.floor(Number(raw?.structuralExperimentCountSincePlateau ?? 0) || 0),
  ),
  lastAcceptedReason: String(raw?.lastAcceptedReason ?? "").trim(),
  lastCandidateReason: String(raw?.lastCandidateReason ?? "").trim(),
  lastAcceptedPromotionAt: String(raw?.lastAcceptedPromotionAt ?? "").trim(),
  lastNextAction: String(raw?.lastNextAction ?? "").trim()
})

const migrateProbeCycleState = (state) => {
  const safe = normalizeProbeCycleState({
    raw: state ?? {},
    lineageKey: state?.lineageKey
  })
  if (safe.version === PROBE_CYCLE_VERSION) return safe
  const migrated = {
    ...safe,
    version: PROBE_CYCLE_VERSION,
    lastProbeFingerprint: "",
    lastBaselineExploitFingerprint: "",
    noCodeProbeStreak: 0,
    nonImprovementStreak: 0,
    stepEMissingStreak: 0,
    plateauActive: false,
    plateauReason: "",
    plateauTriggeredAt: "",
    structuralExperimentCountSincePlateau: 0,
    lastNextAction: "continue_no_code_probe"
  }
  return migrated
}

const repairProbeCycleState = (state) => {
  const safe = normalizeProbeCycleState({
    raw: state ?? {},
    lineageKey: state?.lineageKey
  })
  const repairedParentKey =
    !String(safe?.parentKey ?? "").trim() && safe.probeLane === "operating"
      ? String(safe?.acceptedBaselineKey ?? "").trim()
      : String(safe?.parentKey ?? "").trim()
  const repairedParentMode =
    !String(safe?.parentMode ?? "").trim() && safe.probeLane === "operating" && repairedParentKey
      ? "accepted_baseline"
      : String(safe?.parentMode ?? "").trim()
  if (
    safe.lastSessionMode === "baseline_exploit" &&
    safe.structuralExperimentCountSincePlateau > 0
  ) {
    return {
      ...safe,
      parentKey: repairedParentKey,
      parentMode: repairedParentMode,
      lastProbeFingerprint: "",
      lastBaselineExploitFingerprint: "",
      noCodeProbeStreak: Math.max(1, safe.noCodeProbeStreak || 1),
      nonImprovementStreak: safe.nonImprovementStreak > 0 ? 1 : 0,
      stepEMissingStreak: safe.stepEMissingStreak > 0 ? 1 : 0,
      plateauActive: false,
      plateauReason: "",
      plateauTriggeredAt: "",
      structuralExperimentCountSincePlateau: 0,
      lastNextAction: "continue_no_code_probe"
    }
  }
  return {
    ...safe,
    parentKey: repairedParentKey,
    parentMode: repairedParentMode
  }
}

const deriveProbeCycleSessionMode = ({
  parentKey,
  fingerprint,
  prevState
}) => {
  const safePrev = prevState ?? {}
  const prevParentKey = String(
    safePrev?.parentKey ?? safePrev?.acceptedBaselineKey ?? "",
  ).trim()
  const prevFingerprint = String(safePrev?.lastProbeFingerprint ?? "").trim()
  const baselineExploitFingerprint = String(
    safePrev?.lastBaselineExploitFingerprint ?? "",
  ).trim()
  if (!prevFingerprint) return "baseline_exploit"
  if (parentKey && prevParentKey && parentKey !== prevParentKey) {
    return "baseline_exploit"
  }
  if (
    safePrev?.plateauActive === true &&
    String(safePrev?.lastSessionMode ?? "").trim() === "structural_experiment" &&
    String(safePrev?.lastNextAction ?? "").trim() === "revert_to_accepted_baseline" &&
    fingerprint &&
    prevFingerprint &&
    fingerprint !== prevFingerprint
  ) {
    return "baseline_exploit"
  }
  if (fingerprint && baselineExploitFingerprint && baselineExploitFingerprint === fingerprint) {
    return "baseline_exploit"
  }
  if (
    fingerprint &&
    prevFingerprint === fingerprint &&
    String(safePrev?.lastSessionMode ?? "").trim() === "baseline_exploit"
  ) {
    return "baseline_exploit"
  }
  return "structural_experiment"
}

const buildProbeCycleRuntime = ({
  cfg,
  probeLane,
  parentSeed,
  parentRecord,
  parentMode,
  fingerprint,
  lineageKey,
  prevState,
  runId,
  sessionId
}) => {
  const safeLane = normalizeProbeLane(probeLane)
  const parentKey = resolveProgressRecordKey({
    seed: parentSeed,
    record: parentRecord
  })
  const laneCfg = resolveProbeLaneConfig({
    cfg,
    probeLane: safeLane
  })
  const sessionMode = deriveProbeCycleSessionMode({
    parentKey,
    fingerprint: String(fingerprint?.fingerprint ?? "").trim(),
    prevState
  })
  const structuralAllowed =
    sessionMode !== "structural_experiment" ||
    laneCfg?.requirePlateauForStructuralExperiment !== true ||
    !parentKey ||
    String(prevState?.lastProbeFingerprint ?? "").trim() === "" ||
    (
      prevState?.plateauActive === true &&
      Math.max(
        0,
        Math.floor(Number(prevState?.structuralExperimentCountSincePlateau ?? 0) || 0),
      ) <
        Math.max(
          1,
          Math.floor(Number(laneCfg?.maxStructuralExperimentsPerPlateau ?? 1) || 1),
        )
    )
  return {
    lineageKey,
    runId,
    sessionId,
    probeLane: safeLane,
    fingerprint: fingerprint ?? null,
    parentKey,
    acceptedBaselineKey: safeLane === "operating" ? parentKey : "",
    parentMode: parentKey ? String(parentMode ?? "").trim() || "config_start_bootstrap" : "config_start_bootstrap",
    sessionMode,
    structuralAllowed,
    plateauActiveBeforeSession: prevState?.plateauActive === true,
    previousFingerprint: String(prevState?.lastProbeFingerprint ?? "").trim(),
    previousSessionMode: String(prevState?.lastSessionMode ?? "").trim()
  }
}

const updateProbeCycleState = ({
  cfg,
  current,
  progressEval,
  acceptedEval,
  candidateEval,
  prevState,
  runtime
}) => {
  const now = new Date().toISOString()
  const safePrev = normalizeProbeCycleState({
    raw: prevState ?? {},
    lineageKey: runtime?.lineageKey
  })
  const safeLane = normalizeProbeLane(runtime?.probeLane)
  const laneCfg = resolveProbeLaneConfig({
    cfg,
    probeLane: safeLane
  })
  const next = {
    ...safePrev,
    version: PROBE_CYCLE_VERSION,
    lineageKey: runtime?.lineageKey,
    probeLane: safeLane,
    parentKey: String(runtime?.parentKey ?? "").trim(),
    parentMode: String(runtime?.parentMode ?? "").trim(),
    acceptedBaselineKey: String(runtime?.acceptedBaselineKey ?? "").trim(),
    lastProbeFingerprint: String(runtime?.fingerprint?.fingerprint ?? "").trim(),
    lastBaselineExploitFingerprint: String(
      safePrev?.lastBaselineExploitFingerprint ?? "",
    ).trim(),
    lastSessionMode: String(runtime?.sessionMode ?? "").trim(),
    lastSessionId: String(runtime?.sessionId ?? "").trim(),
    lastRunId: String(runtime?.runId ?? "").trim(),
    lastAcceptedReason: String(acceptedEval?.reason ?? "").trim(),
    lastCandidateReason: String(candidateEval?.reason ?? "").trim()
  }
  const sameParent =
    !!String(runtime?.parentKey ?? "").trim() &&
    String(runtime?.parentKey ?? "").trim() === String(safePrev?.parentKey ?? "").trim()
  const progressImproved = progressEval?.updated === true
  const currentHasAcceptedStepE = hasUsableAcceptedStepE(current)
  const rollbackToBaseline =
    runtime?.sessionMode === "baseline_exploit" &&
    sameParent &&
    String(safePrev?.lastSessionMode ?? "").trim() === "structural_experiment" &&
    String(safePrev?.lastNextAction ?? "").trim() === "revert_to_accepted_baseline"
  if (!sameParent || progressImproved) {
    next.noCodeProbeStreak = 0
    next.nonImprovementStreak = 0
    next.stepEMissingStreak = 0
    next.plateauActive = false
    next.plateauReason = ""
    next.plateauTriggeredAt = ""
    next.structuralExperimentCountSincePlateau = 0
  }
  if (rollbackToBaseline) {
    next.noCodeProbeStreak = 0
    next.nonImprovementStreak = 0
    next.stepEMissingStreak = 0
    next.plateauActive = false
    next.plateauReason = ""
    next.plateauTriggeredAt = ""
    next.structuralExperimentCountSincePlateau = 0
  }
  if (runtime?.sessionMode === "baseline_exploit") {
    next.lastBaselineExploitFingerprint = String(
      runtime?.fingerprint?.fingerprint ?? "",
    ).trim()
    next.noCodeProbeStreak = sameParent ? safePrev.noCodeProbeStreak + 1 : 1
  } else {
    next.noCodeProbeStreak = 0
    next.structuralExperimentCountSincePlateau = safePrev.plateauActive === true
      ? safePrev.structuralExperimentCountSincePlateau + 1
      : 0
  }
  if (progressImproved) {
    next.lastAcceptedPromotionAt = now
    next.lastNextAction =
      safeLane === "research" ? "record_research_improvement" : "promote_accepted_baseline"
    return {
      stored: next,
      summary: {
        enabled: laneCfg?.enabled !== false,
        probeLane: safeLane,
        sessionMode: runtime?.sessionMode ?? "baseline_exploit",
        parentMode: runtime?.parentMode ?? "config_start_bootstrap",
        parentKey: String(runtime?.parentKey ?? "").trim(),
        fingerprint: String(runtime?.fingerprint?.fingerprint ?? "").trim(),
        acceptedBaselineKey: String(runtime?.acceptedBaselineKey ?? "").trim(),
        baselineFingerprint: String(next.lastBaselineExploitFingerprint ?? "").trim(),
        noCodeProbeStreak: next.noCodeProbeStreak,
        nonImprovementStreak: 0,
        stepEMissingStreak: 0,
        plateauActive: false,
        plateauReason: "",
        plateauTriggeredAt: "",
        structuralAllowed: runtime?.structuralAllowed !== false,
        structuralExperimentCountSincePlateau: 0,
        nextAction:
          safeLane === "research" ? "record_research_improvement" : "promote_accepted_baseline"
      }
    }
  }
  if (runtime?.sessionMode === "baseline_exploit") {
    next.nonImprovementStreak =
      rollbackToBaseline ? 1 : sameParent ? safePrev.nonImprovementStreak + 1 : 1
    next.stepEMissingStreak = currentHasAcceptedStepE
      ? 0
      : rollbackToBaseline
        ? 1
        : sameParent
        ? safePrev.stepEMissingStreak + 1
        : 1
  }
  let nextAction = "continue_no_code_probe"
  if (
    runtime?.sessionMode === "baseline_exploit" &&
    next.stepEMissingStreak >= Math.max(1, Math.floor(Number(laneCfg?.plateauAfterStepEMissing ?? 2) || 2))
  ) {
    next.plateauActive = true
    next.plateauReason = "STEP_E_MISSING_STREAK"
    next.plateauTriggeredAt = next.plateauTriggeredAt || now
    nextAction = "allow_single_structural_patch"
  } else if (
    runtime?.sessionMode === "baseline_exploit" &&
    next.noCodeProbeStreak >= Math.max(1, Math.floor(Number(laneCfg?.minNoCodeProbesBeforePlateau ?? 2) || 2)) &&
    next.nonImprovementStreak >=
      Math.max(1, Math.floor(Number(laneCfg?.plateauAfterNonImprovement ?? 3) || 3))
  ) {
    next.plateauActive = true
    next.plateauReason = "NO_IMPROVEMENT_STREAK"
    next.plateauTriggeredAt = next.plateauTriggeredAt || now
    nextAction = "allow_single_structural_patch"
  } else if (runtime?.sessionMode === "structural_experiment") {
    nextAction = "revert_to_accepted_baseline"
  }
  next.lastNextAction = nextAction
  return {
    stored: next,
    summary: {
      enabled: laneCfg?.enabled !== false,
      probeLane: safeLane,
      sessionMode: runtime?.sessionMode ?? "baseline_exploit",
      parentMode: runtime?.parentMode ?? "config_start_bootstrap",
      parentKey: String(runtime?.parentKey ?? "").trim(),
      fingerprint: String(runtime?.fingerprint?.fingerprint ?? "").trim(),
      acceptedBaselineKey: String(runtime?.acceptedBaselineKey ?? "").trim(),
      baselineFingerprint: String(next.lastBaselineExploitFingerprint ?? "").trim(),
      noCodeProbeStreak: next.noCodeProbeStreak,
      nonImprovementStreak: next.nonImprovementStreak,
      stepEMissingStreak: next.stepEMissingStreak,
      plateauActive: next.plateauActive,
      plateauReason: next.plateauReason,
      plateauTriggeredAt: next.plateauTriggeredAt,
      structuralAllowed: runtime?.structuralAllowed !== false,
      structuralExperimentCountSincePlateau: next.structuralExperimentCountSincePlateau,
      nextAction
    }
  }
}

const loadAcceptedBaselineRecord = async ({
  lineageStateDir,
  probeRootDir
}) => {
  const paths = resolveProgressTrackingPaths(lineageStateDir)
  let acceptedBaseline = await readJson(paths.acceptedBaselinePath, null)
  if (acceptedBaseline && !hasUsableAcceptedStepE(acceptedBaseline)) {
    acceptedBaseline = null
  }
  if (!acceptedBaseline) {
    const historical = await loadHistoricalProgressRecords({
      indexPath: paths.historicalProgressIndexPath,
      probeRootDir,
      excludeSummaryPath: null
    })
    acceptedBaseline = selectBestAcceptedRecord(historical)
    if (acceptedBaseline) {
      await writeJson(paths.acceptedBaselinePath, acceptedBaseline)
      await appendJsonlRow(paths.acceptedBaselineHistoryPath, {
        updatedAt: new Date().toISOString(),
        reason: "BOOTSTRAP_FROM_HISTORY_PRE_SESSION",
        record: acceptedBaseline
      })
    }
  }
  return acceptedBaseline
}

const loadCandidatePeakRecord = async ({
  lineageStateDir,
  probeRootDir
}) => {
  const paths = resolveProgressTrackingPaths(lineageStateDir)
  let candidatePeak = await readJson(paths.candidatePeakPath, null)
  if (!candidatePeak) {
    const historical = await loadHistoricalProgressRecords({
      indexPath: paths.historicalProgressIndexPath,
      probeRootDir,
      excludeSummaryPath: null
    })
    candidatePeak = selectBestCandidateRecord(historical)
    if (candidatePeak) {
      await writeJson(paths.candidatePeakPath, candidatePeak)
      await appendJsonlRow(paths.candidatePeakHistoryPath, {
        updatedAt: new Date().toISOString(),
        reason: "BOOTSTRAP_FROM_HISTORY_PRE_SESSION",
        compareValue: 1,
        record: candidatePeak
      })
    }
  }
  return candidatePeak
}

const buildProgressRecordFromSummary = ({ summary, summaryPath }) => {
  const bestRound = summary?.bestRound ?? {}
  const bestMetrics = bestRound?.bestMetrics ?? {}
  const lockboxGate = summary?.lockboxGate ?? {}
  const lockboxMetrics = lockboxGate?.metrics ?? {}
  const stepERunExecuted = lockboxGate?.stepERunExecuted === true
  const goalMode = resolveGoalMode(
    lockboxMetrics?.goalMode ?? summary?.config?.backtest?.goalMode ?? summary?.goalMode,
  )
  const positionSemantics = resolvePositionSemantics(
    lockboxMetrics?.positionSemantics ??
      summary?.config?.backtest?.positionSemantics ??
      summary?.positionSemantics,
  )
  return {
    lineageKey: String(summary?.lineageKey ?? "").trim() || null,
    runId: String(summary?.runId ?? "").trim() || null,
    sessionId: String(summary?.sessionId ?? "").trim() || null,
    summaryPath: String(summaryPath ?? "").trim() || null,
    loopDir: String(summaryPath ? path.dirname(summaryPath) : "").trim() || null,
    round: Number(bestRound?.round ?? 0) || null,
    bestEpoch: String(bestRound?.bestEpoch ?? "").trim() || null,
    generatedAt: String(summary?.generatedAt ?? "").trim() || null,
    updatedAt: new Date().toISOString(),
    goalMode,
    positionSemantics,
    deploymentEligible: summary?.deploymentEligible === true,
    lockboxEligible: lockboxGate?.eligible === true,
    stepD: {
      pickHitRateEval: Number(bestMetrics?.pickHitRate ?? 0) || 0,
      targetHitRateEval: Number(bestMetrics?.targetHitRate ?? bestMetrics?.pickHitRate ?? 0) || 0,
      targetHitCountEval: Math.max(
        0,
        Number(bestMetrics?.targetHitCount ?? bestMetrics?.pickHitCount ?? 0) || 0,
      ),
      targetsPer20EvalDays: Number(bestMetrics?.targetHitsPer20Days ?? bestMetrics?.targetsPer20EvalDays ?? 0) || 0,
      stopRateEval: Number(bestMetrics?.stopRate ?? 0) || 0,
      timeoutNegativeRateEval:
        Number(bestMetrics?.timeoutNegativeRateEval ?? bestMetrics?.timeoutNegativeRate ?? 0) || 0,
      executedHitRateEval:
        Number(bestMetrics?.executedTargetHitRateEval ?? bestMetrics?.executedHitRate ?? 0) || 0,
      top1ToOracleConversionEval: Number(bestMetrics?.top1ToOracleConversion ?? 0) || 0,
      pickedCountEval: Math.max(0, Number(bestMetrics?.pickedCount ?? 0) || 0),
      executedCountEval: Math.max(0, Number(bestMetrics?.executedCount ?? 0) || 0),
      pickHitCountEval: Math.max(0, Number(bestMetrics?.pickHitCount ?? 0) || 0),
      executedHitCountEval: Math.max(0, Number(bestMetrics?.executedHitCount ?? 0) || 0),
      pickHitRateLcb95: Number(bestMetrics?.pickHitRateLcb95 ?? 0) || 0,
      executedHitRateLcb95: Number(bestMetrics?.executedHitRateLcb95 ?? 0) || 0,
      executionCoverageEval: Number(bestMetrics?.executionCoverage ?? 0) || 0,
      workerPoolScoreMs: Number(bestMetrics?.workerPoolScoreMs ?? 0) || 0,
      scoreMsPerSeed: Number(bestMetrics?.scoreMsPerSeed ?? 0) || 0
    },
    stepE: stepERunExecuted
      ? {
          goalMode,
          positionSemantics,
          targetHitCount: Math.max(0, Number(lockboxMetrics?.targetHitCount ?? 0) || 0),
          targetHitRate: Number(lockboxMetrics?.targetHitRate ?? 0) || 0,
          targetHitsPer20TradingDays: Number(lockboxMetrics?.targetHitsPer20TradingDays ?? 0) || 0,
          stopRate: Number(lockboxMetrics?.stopRate ?? 0) || 0,
          timeoutNegativeRate: Number(lockboxMetrics?.timeoutNegativeRate ?? 0) || 0,
          winRate: Number(lockboxMetrics?.winRate ?? 0) || 0,
          avgNetRet: Number(lockboxMetrics?.avgNetRet ?? 0) || 0,
          cumulativeReturn: Number(lockboxMetrics?.cumulativeReturn ?? 0) || 0,
          totalTrades: Math.max(0, Number(lockboxMetrics?.totalTrades ?? 0) || 0),
          maxDrawdown: num(lockboxMetrics?.maxDrawdown)
        }
      : null,
    probeCycle: {
      fingerprint: String(
        summary?.progressTracking?.probeCycle?.fingerprint ??
          summary?.probeCyclePlan?.fingerprint ??
          "",
      ).trim(),
      probeLane: String(
        summary?.progressTracking?.probeCycle?.probeLane ??
          summary?.probeCyclePlan?.probeLane ??
          "",
      ).trim(),
      sessionMode: String(
        summary?.progressTracking?.probeCycle?.sessionMode ??
          summary?.probeCyclePlan?.sessionMode ??
          "",
      ).trim(),
      parentMode: String(
        summary?.progressTracking?.probeCycle?.parentMode ??
          summary?.probeCyclePlan?.parentMode ??
          "",
      ).trim(),
      parentKey: String(
        summary?.progressTracking?.probeCycle?.parentKey ??
          summary?.probeCyclePlan?.parentKey ??
          "",
      ).trim(),
      acceptedBaselineKey: String(
        summary?.progressTracking?.probeCycle?.acceptedBaselineKey ??
          summary?.probeCyclePlan?.acceptedBaselineKey ??
          "",
      ).trim()
    },
    researchGate: {
      enabled: summary?.researchGate?.enabled === true,
      lineDiscarded: summary?.researchGate?.lineDiscarded === true,
      discardReason: String(summary?.researchGate?.discardReason ?? "").trim() || null,
      dMetric: Number(summary?.researchGate?.dMetric ?? 0) || 0,
      eMetric: Number(summary?.researchGate?.eMetric ?? 0) || 0,
      minD: Number(summary?.researchGate?.thresholds?.minD ?? 0) || 0,
      minE: Number(summary?.researchGate?.thresholds?.minE ?? 0) || 0,
      promotionMinD: Number(summary?.researchGate?.thresholds?.promotionMinD ?? 0) || 0,
      promotionMinE: Number(summary?.researchGate?.thresholds?.promotionMinE ?? 0) || 0,
      eligibleForParentPromotion: summary?.researchGate?.eligibleForParentPromotion === true
    },
    stepC0: {
      summaryPath: String(summary?.bestStepC0SummaryPath ?? "").trim() || null,
      familyIndexPath: String(summary?.bestStepC0FamilyIndexPath ?? "").trim() || null,
      membershipPath: String(summary?.bestStepC0MembershipPath ?? "").trim() || null
    },
    stepC1: {
      summaryPath: String(summary?.bestStepC1SummaryPath ?? "").trim() || null,
      indexPath: String(summary?.bestStepC1IndexPath ?? "").trim() || null,
      resultsPath: String(summary?.bestStepC1ResultsPath ?? "").trim() || null
    },
    stepC2: {
      summaryPath: String(summary?.bestStepC2SummaryPath ?? "").trim() || null,
      indexPath: String(summary?.bestStepC2IndexPath ?? "").trim() || null,
      groupsPath: String(summary?.bestStepC2GroupsPath ?? "").trim() || null
    },
    bestMetrics
  }
}

const isResearchLineDiscarded = (record) =>
  record?.researchGate?.enabled === true && record?.researchGate?.lineDiscarded === true

const buildProbeCycleStateFromSummary = ({ summary, lineageKey }) => {
  const probeCycle = summary?.progressTracking?.probeCycle ?? null
  if (!probeCycle || probeCycle?.enabled !== true) return null
  return repairProbeCycleState(
    migrateProbeCycleState(
      normalizeProbeCycleState({
        raw: {
          lineageKey: String(lineageKey ?? summary?.lineageKey ?? "").trim(),
          probeLane: String(probeCycle?.probeLane ?? "").trim(),
          parentKey: String(probeCycle?.parentKey ?? "").trim(),
          parentMode: String(probeCycle?.parentMode ?? "").trim(),
          acceptedBaselineKey: String(probeCycle?.acceptedBaselineKey ?? "").trim(),
          lastProbeFingerprint: String(probeCycle?.fingerprint ?? "").trim(),
          lastBaselineExploitFingerprint:
            String(probeCycle?.baselineFingerprint ?? "").trim() ||
            (String(probeCycle?.sessionMode ?? "").trim() === "baseline_exploit"
              ? String(probeCycle?.fingerprint ?? "").trim()
              : ""),
          lastSessionMode: String(probeCycle?.sessionMode ?? "").trim(),
          lastSessionId: String(summary?.sessionId ?? "").trim(),
          lastRunId: String(summary?.runId ?? "").trim(),
          noCodeProbeStreak: Number(probeCycle?.noCodeProbeStreak ?? 0) || 0,
          nonImprovementStreak: Number(probeCycle?.nonImprovementStreak ?? 0) || 0,
          stepEMissingStreak: Number(probeCycle?.stepEMissingStreak ?? 0) || 0,
          plateauActive: probeCycle?.plateauActive === true,
          plateauReason: String(probeCycle?.plateauReason ?? "").trim(),
          plateauTriggeredAt: String(probeCycle?.plateauTriggeredAt ?? "").trim(),
          structuralExperimentCountSincePlateau:
            Number(probeCycle?.structuralExperimentCountSincePlateau ?? 0) || 0,
          lastAcceptedReason: String(summary?.progressTracking?.acceptedBaseline?.reason ?? "").trim(),
          lastCandidateReason: String(summary?.progressTracking?.candidatePeak?.reason ?? "").trim(),
          lastAcceptedPromotionAt: "",
          lastNextAction: String(probeCycle?.nextAction ?? "").trim()
        },
        lineageKey: String(lineageKey ?? summary?.lineageKey ?? "").trim()
      }),
    ),
  )
}

const compareProbeCycleBootstrapCandidates = (left, right) => {
  const leftState = left?.state ?? {}
  const rightState = right?.state ?? {}
  const scorePairs = [
    [leftState?.plateauActive === true ? 1 : 0, rightState?.plateauActive === true ? 1 : 0],
    [
      Math.max(0, Number(leftState?.structuralExperimentCountSincePlateau ?? 0) || 0),
      Math.max(0, Number(rightState?.structuralExperimentCountSincePlateau ?? 0) || 0)
    ],
    [Math.max(0, Number(leftState?.noCodeProbeStreak ?? 0) || 0), Math.max(0, Number(rightState?.noCodeProbeStreak ?? 0) || 0)],
    [
      Math.max(0, Number(leftState?.nonImprovementStreak ?? 0) || 0),
      Math.max(0, Number(rightState?.nonImprovementStreak ?? 0) || 0)
    ],
    [
      Math.max(0, Number(leftState?.stepEMissingStreak ?? 0) || 0),
      Math.max(0, Number(rightState?.stepEMissingStreak ?? 0) || 0)
    ]
  ]
  for (const [leftValue, rightValue] of scorePairs) {
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  const leftGeneratedAt = String(left?.generatedAt ?? "")
  const rightGeneratedAt = String(right?.generatedAt ?? "")
  if (leftGeneratedAt > rightGeneratedAt) return 1
  if (leftGeneratedAt < rightGeneratedAt) return -1
  return 0
}

const loadProbeCycleState = async ({
  probeCyclePaths,
  parentKey,
  probeLane,
  probeRootDir,
  lineageKey
}) => {
  const safeLane = normalizeProbeLane(probeLane)
  const rawStoredState = await readJson(probeCyclePaths?.statePath, null)
  const storedState = repairProbeCycleState(migrateProbeCycleState(normalizeProbeCycleState({
    raw: rawStoredState,
    lineageKey
  })))
  if (JSON.stringify(rawStoredState ?? {}) !== JSON.stringify(storedState ?? {})) {
    await ensureDir(probeCyclePaths.dir)
    await writeJson(probeCyclePaths.statePath, storedState)
    await appendJsonlRow(probeCyclePaths.historyPath, {
      updatedAt: new Date().toISOString(),
      reason: "REPAIR_STORED_STATE",
      state: storedState
    })
  }
  if (!parentKey) return storedState
  const storedStateMatchesParent =
    String(storedState?.parentKey ?? "").trim() === String(parentKey).trim() &&
    normalizeProbeLane(storedState?.probeLane) === safeLane
  const storedStateHasSession = String(storedState?.lastSessionId ?? "").trim() !== ""
  const shouldTrustStoredState = storedStateMatchesParent && storedStateHasSession
  const entries = await fsp.readdir(probeRootDir, { withFileTypes: true }).catch(() => [])
  let bestHistorical = null
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue
    const summaryPath = path.join(probeRootDir, entry.name, "cd_loop_summary.json")
    if (!pathExists(summaryPath)) continue
    const summary = await readJson(summaryPath, null).catch(() => null)
    if (!summary || String(summary?.mode ?? "") !== "cd-loop") continue
    const state = buildProbeCycleStateFromSummary({
      summary,
      lineageKey
    })
    if (!state) continue
    if (normalizeProbeLane(state?.probeLane) !== safeLane) continue
    if (String(state?.parentKey ?? "").trim() !== String(parentKey).trim()) continue
    const candidate = {
      generatedAt: String(summary?.generatedAt ?? ""),
      state
    }
    if (!bestHistorical || compareProbeCycleBootstrapCandidates(candidate, bestHistorical) > 0) {
      bestHistorical = candidate
    }
  }
  const bestState = bestHistorical?.state
    ? normalizeProbeCycleState({
        raw: bestHistorical.state,
        lineageKey
      })
    : null
  const mergedStoredState =
    bestState &&
    !String(storedState?.lastBaselineExploitFingerprint ?? "").trim() &&
    String(bestState?.lastBaselineExploitFingerprint ?? "").trim()
      ? repairProbeCycleState(migrateProbeCycleState(normalizeProbeCycleState({
          raw: {
            ...storedState,
            lastBaselineExploitFingerprint: bestState.lastBaselineExploitFingerprint
          },
          lineageKey
        })))
      : storedState
  if (shouldTrustStoredState) {
    if (mergedStoredState !== storedState) {
      await ensureDir(probeCyclePaths.dir)
      await writeJson(probeCyclePaths.statePath, mergedStoredState)
      await appendJsonlRow(probeCyclePaths.historyPath, {
        updatedAt: new Date().toISOString(),
        reason: "MERGE_BASELINE_FINGERPRINT_FROM_HISTORY",
        state: mergedStoredState
      })
    }
    return mergedStoredState
  }
  const shouldPromoteHistorical =
    bestState &&
    compareProbeCycleBootstrapCandidates(
      {
        generatedAt: "",
        state: bestState
      },
      {
        generatedAt: "",
        state: mergedStoredState
      },
    ) > 0
  if (shouldPromoteHistorical) {
    await ensureDir(probeCyclePaths.dir)
    await writeJson(probeCyclePaths.statePath, bestState)
    await appendJsonlRow(probeCyclePaths.historyPath, {
      updatedAt: new Date().toISOString(),
      reason: "BOOTSTRAP_FROM_HISTORY",
      state: bestState
    })
    return bestState
  }
  if (mergedStoredState !== storedState) {
    await ensureDir(probeCyclePaths.dir)
    await writeJson(probeCyclePaths.statePath, mergedStoredState)
    await appendJsonlRow(probeCyclePaths.historyPath, {
      updatedAt: new Date().toISOString(),
      reason: "MERGE_BASELINE_FINGERPRINT_FROM_HISTORY",
      state: mergedStoredState
    })
  }
  return mergedStoredState
}

const hasUsableAcceptedStepE = (record) =>
  !isResearchLineDiscarded(record) &&
  !!record?.stepE &&
  Math.max(0, Number(record?.stepE?.totalTrades ?? 0) || 0) > 0

const compareAcceptedProgressRecords = (current, baseline) => {
  const currentGoalMode = resolveGoalMode(current?.goalMode ?? current?.stepE?.goalMode)
  const baselineGoalMode = resolveGoalMode(baseline?.goalMode ?? baseline?.stepE?.goalMode)
  const currentPositionSemantics = resolvePositionSemantics(
    current?.positionSemantics ?? current?.stepE?.positionSemantics,
  )
  const baselinePositionSemantics = resolvePositionSemantics(
    baseline?.positionSemantics ?? baseline?.stepE?.positionSemantics,
  )
  if (!baseline) {
    return {
      eligible: hasUsableAcceptedStepE(current),
      updated: hasUsableAcceptedStepE(current),
      reason: hasUsableAcceptedStepE(current) ? "BOOTSTRAP_ACCEPTED_BASELINE" : "STEP_E_UNAVAILABLE",
      regressions: [],
      improvements: hasUsableAcceptedStepE(current) ? ["bootstrap"] : []
    }
  }
  if (!hasUsableAcceptedStepE(baseline)) {
    return {
      eligible: hasUsableAcceptedStepE(current),
      updated: hasUsableAcceptedStepE(current),
      reason: hasUsableAcceptedStepE(current) ? "REPLACE_BASELINE_WITH_STEP_E" : "BASELINE_CORRUPT_NO_STEP_E",
      regressions: [],
      improvements: hasUsableAcceptedStepE(current) ? ["step_e_available"] : []
    }
  }
  if (
    currentGoalMode !== baselineGoalMode ||
    currentPositionSemantics !== baselinePositionSemantics
  ) {
    return {
      eligible: hasUsableAcceptedStepE(current),
      updated: hasUsableAcceptedStepE(current),
      reason: hasUsableAcceptedStepE(current) ? "BOOTSTRAP_ACCEPTED_BASELINE_NEW_SEMANTICS" : "STEP_E_UNAVAILABLE",
      regressions: [],
      improvements: hasUsableAcceptedStepE(current) ? ["goal_mode_reset"] : []
    }
  }
  if (!hasUsableAcceptedStepE(current)) {
    return {
      eligible: false,
      updated: false,
      reason: "STEP_E_UNAVAILABLE",
      regressions: ["step_e_available"],
      improvements: []
    }
  }
  if (isResearchLineDiscarded(current)) {
    return {
      eligible: false,
      updated: false,
      reason: String(current?.researchGate?.discardReason ?? "RESEARCH_GATE_DISCARDED"),
      regressions: ["research_gate"],
      improvements: []
    }
  }
  const checks =
    currentGoalMode === "TARGET_FIRST_V2"
      ? [
          ["step_d.targetHitRateEval", Number(baseline?.stepD?.targetHitRateEval ?? 0), Number(current?.stepD?.targetHitRateEval ?? 0), "higher"],
          ["step_d.targetsPer20EvalDays", Number(baseline?.stepD?.targetsPer20EvalDays ?? 0), Number(current?.stepD?.targetsPer20EvalDays ?? 0), "higher"],
          ["step_e.targetHitRate", Number(baseline?.stepE?.targetHitRate ?? 0), Number(current?.stepE?.targetHitRate ?? 0), "higher"],
          ["step_e.targetHitCount", Number(baseline?.stepE?.targetHitCount ?? 0), Number(current?.stepE?.targetHitCount ?? 0), "higher"],
          [
            "step_e.targetHitsPer20TradingDays",
            Number(baseline?.stepE?.targetHitsPer20TradingDays ?? 0),
            Number(current?.stepE?.targetHitsPer20TradingDays ?? 0),
            "higher"
          ],
          ["step_e.stopRate", Number(baseline?.stepE?.stopRate ?? 0), Number(current?.stepE?.stopRate ?? 0), "lower"],
          [
            "step_e.timeoutNegativeRate",
            Number(baseline?.stepE?.timeoutNegativeRate ?? 0),
            Number(current?.stepE?.timeoutNegativeRate ?? 0),
            "lower"
          ]
        ]
      : [
          ["step_d.pickHitRateEval", Number(baseline?.stepD?.pickHitRateEval ?? 0), Number(current?.stepD?.pickHitRateEval ?? 0), "higher"],
          ["step_d.executedHitRateEval", Number(baseline?.stepD?.executedHitRateEval ?? 0), Number(current?.stepD?.executedHitRateEval ?? 0), "higher"],
          ["step_e.winRate", Number(baseline?.stepE?.winRate ?? 0), Number(current?.stepE?.winRate ?? 0), "higher"],
          ["step_e.avgNetRet", Number(baseline?.stepE?.avgNetRet ?? 0), Number(current?.stepE?.avgNetRet ?? 0), "higher"],
          [
            "step_e.cumulativeReturn",
            Number(baseline?.stepE?.cumulativeReturn ?? 0),
            Number(current?.stepE?.cumulativeReturn ?? 0),
            "higher"
          ]
        ]
  const regressions = []
  const improvements = []
  for (const [name, prevValue, nextValue, direction] of checks) {
    if (direction === "lower") {
      if (nextValue > prevValue + 1e-12) regressions.push(name)
      else if (nextValue + 1e-12 < prevValue) improvements.push(name)
      continue
    }
    if (nextValue + 1e-12 < prevValue) regressions.push(name)
    else if (nextValue > prevValue + 1e-12) improvements.push(name)
  }
  if (regressions.length) {
    return {
      eligible: false,
      updated: false,
      reason: "REGRESSION",
      regressions,
      improvements
    }
  }
  if (!improvements.length) {
    return {
      eligible: false,
      updated: false,
      reason: "NO_STRICT_IMPROVEMENT",
      regressions,
      improvements
    }
  }
  return {
    eligible: true,
    updated: true,
    reason: "STRICT_MONOTONIC_IMPROVEMENT",
    regressions,
    improvements
  }
}

const compareCandidatePeakRecords = (current, baseline) => {
  if (isResearchLineDiscarded(current)) {
    return {
      eligible: false,
      updated: false,
      reason: String(current?.researchGate?.discardReason ?? "RESEARCH_GATE_DISCARDED"),
      compareValue: -1
    }
  }
  if (baseline && isResearchLineDiscarded(baseline)) {
    baseline = null
  }
  if (!baseline) {
    return {
      eligible: true,
      updated: true,
      reason: "BOOTSTRAP_CANDIDATE_PEAK",
      compareValue: 1
    }
  }
  const compareValue = compareMetrics(current?.bestMetrics ?? {}, baseline?.bestMetrics ?? {})
  if (compareValue > 0) {
    return {
      eligible: true,
      updated: true,
      reason: "BETTER_STEP_D_PEAK",
      compareValue
    }
  }
  if (compareValue < 0) {
    return {
      eligible: false,
      updated: false,
      reason: "STEP_D_REGRESSION",
      compareValue
    }
  }
  return {
    eligible: false,
    updated: false,
    reason: "STEP_D_TIE",
    compareValue
  }
}

const compareResearchParentCandidates = (current, baseline) => {
  if (!baseline) return 1
  const metricPairs = [
    [
      Number(current?.researchGate?.eMetric ?? 0) || 0,
      Number(baseline?.researchGate?.eMetric ?? 0) || 0
    ],
    [
      Number(current?.researchGate?.dMetric ?? 0) || 0,
      Number(baseline?.researchGate?.dMetric ?? 0) || 0
    ],
    [
      Number(current?.stepE?.targetHitCount ?? 0) || 0,
      Number(baseline?.stepE?.targetHitCount ?? 0) || 0
    ],
    [
      Number(current?.stepD?.executedHitRateEval ?? 0) || 0,
      Number(baseline?.stepD?.executedHitRateEval ?? 0) || 0
    ]
  ]
  for (const [left, right] of metricPairs) {
    if (left > right + 1e-12) return 1
    if (left + 1e-12 < right) return -1
  }
  const currentGeneratedAt = String(current?.generatedAt ?? "")
  const baselineGeneratedAt = String(baseline?.generatedAt ?? "")
  if (currentGeneratedAt > baselineGeneratedAt) return 1
  if (currentGeneratedAt < baselineGeneratedAt) return -1
  return 0
}

const persistResearchParentCandidate = async ({
  lineageStateDir,
  current,
  eligible
}) => {
  const paths = resolveProgressTrackingPaths(lineageStateDir)
  const baseline = await readJson(paths.researchParentCandidatePath, null)
  if (eligible !== true) {
    return {
      filePath: paths.researchParentCandidatePath,
      updated: false,
      reason: "RESEARCH_PROMOTION_GATE_FAILED",
      current,
      baseline
    }
  }
  const compareValue = compareResearchParentCandidates(current, baseline)
  if (compareValue > 0) {
    await writeJson(paths.researchParentCandidatePath, current)
    await appendJsonlRow(paths.researchParentCandidateHistoryPath, {
      updatedAt: new Date().toISOString(),
      compareValue,
      record: current
    })
    return {
      filePath: paths.researchParentCandidatePath,
      updated: true,
      reason: baseline ? "BETTER_RESEARCH_PARENT" : "BOOTSTRAP_RESEARCH_PARENT",
      compareValue,
      current,
      baseline,
      stored: current
    }
  }
  return {
    filePath: paths.researchParentCandidatePath,
    updated: false,
    reason: compareValue < 0 ? "RESEARCH_PARENT_NOT_BETTER" : "RESEARCH_PARENT_TIE",
    compareValue,
    current,
    baseline,
    stored: baseline
  }
}

const appendJsonlRow = async (filePath, row) => {
  await ensureDir(path.dirname(filePath))
  await fsp.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8")
}

const appendCandidateModeManifest = async ({
  cwd,
  entry
}) => {
  const manifestPath = path.join(cwd, "meta", "candidate_mode_manifest.json")
  const current = await readJson(manifestPath, null).catch(() => null)
  const rows = Array.isArray(current?.rows) ? current.rows.slice() : []
  rows.push(entry)
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    rows: rows.slice(-256)
  }
  for (const [key, value] of Object.entries(current ?? {})) {
    if (["version", "updatedAt", "rows"].includes(key)) continue
    next[key] = value
  }
  await writeJson(manifestPath, next)
  return manifestPath
}

const resolveRoundMajorChangeType = ({
  adaptiveCandidateMode,
  stepC0Summary,
  stepC1Summary,
  stepC2Summary
}) => {
  const fallback = String(adaptiveCandidateMode ?? "").trim().toLowerCase() || "boost_penalty"
  if (stepC2Summary && stepC2Summary.enabled === true) {
    const similarityPolicyVersion = String(stepC2Summary?.similarityPolicyVersion ?? "").trim().toLowerCase()
    const representativePolicy = String(stepC2Summary?.representativePolicy ?? "").trim().toLowerCase()
    if (similarityPolicyVersion && similarityPolicyVersion !== "c2_overlap_graph_v1") {
      return "c2_similarity_rule"
    }
    if (representativePolicy && representativePolicy !== "quality_first_with_coverage_guard") {
      return "c2_representative_policy"
    }
    return "c2_dedup_policy"
  }
  if (stepC1Summary && stepC1Summary.enabled === true) {
    const configuredProbeScope = String(stepC1Summary?.probeScope ?? "").trim().toLowerCase()
    const effectiveProbeScope = String(stepC1Summary?.probeScopeApplied ?? "").trim().toLowerCase()
    const scopeForClassification = effectiveProbeScope || configuredProbeScope
    if (scopeForClassification && scopeForClassification !== "update") return "c1_probe_scope"
    if (
      stepC1Summary?.fallbackUsed === true ||
      String(stepC1Summary?.gate?.reason ?? "").trim().toUpperCase() === "BACKFILL_USED"
    ) {
      return "c1_pass_policy"
    }
    return "c1_family_probe"
  }
  if (!stepC0Summary || stepC0Summary.enabled !== true) return fallback
  const familySignaturePolicy = stepC0Summary?.familySignaturePolicy ?? {}
  if (familySignaturePolicy?.useTemplateKindMix === true) return "c0_signature_rule"
  if (stepC0Summary?.shortlistPolicy && typeof stepC0Summary.shortlistPolicy === "object") {
    return "c0_shortlist_policy"
  }
  return "c0_family_mining"
}

const ACTIVE_RESEARCH_HANDOFF_START = "<!-- C0_RUNTIME_SNAPSHOT_START -->"
const ACTIVE_RESEARCH_HANDOFF_END = "<!-- C0_RUNTIME_SNAPSHOT_END -->"

const formatRatePct = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "n/a"
  return `${(n * 100).toFixed(2)}%`
}

const summarizeC0FamilyLines = ({ families, limit = 5, shortlistedOnly = false }) => {
  const source = (Array.isArray(families) ? families : [])
    .filter((row) => (shortlistedOnly ? row?.shortlisted === true : true))
    .slice()
    .sort((left, right) => {
      const bySupport = Number(right?.supportRatio ?? 0) - Number(left?.supportRatio ?? 0)
      if (bySupport !== 0) return bySupport
      return Number(right?.c0Score ?? 0) - Number(left?.c0Score ?? 0)
    })
    .slice(0, Math.max(1, limit))
  if (!source.length) return ["- none"]
  return source.map((row) => {
    const familyId = String(row?.familyId ?? "NA").trim() || "NA"
    const support = Math.max(0, Number(row?.support ?? 0) || 0)
    const supportRatio = formatRatePct(row?.supportRatio ?? 0)
    const score = Number(row?.c0Score ?? 0)
    const status = String(row?.status ?? "NA").trim() || "NA"
    return `- ${familyId} support=${support} share=${supportRatio} score=${score.toFixed(3)} status=${status}`
  })
}

const summarizeC1ResultLines = ({ results, limit = 5, passedOnly = false }) => {
  const source = (Array.isArray(results) ? results : [])
    .filter((row) => (passedOnly ? row?.passed === true : true))
    .slice()
    .sort((left, right) => Number(right?.familyQualityScore ?? 0) - Number(left?.familyQualityScore ?? 0))
    .slice(0, Math.max(1, limit))
  if (!source.length) return ["- none"]
  return source.map((row) => {
    const familyId = String(row?.familyId ?? "NA").trim() || "NA"
    const hitRate = formatRatePct(row?.targetHitRateEval ?? 0)
    const pickedDays = Math.max(0, Number(row?.pickedDaysEval ?? 0) || 0)
    const score = Number(row?.familyQualityScore ?? 0)
    const rejectReason = String(row?.rejectReason ?? "NA").trim() || "NA"
    return `- ${familyId} hit=${hitRate} pickedDays=${pickedDays} score=${score.toFixed(3)} reason=${rejectReason}`
  })
}

const summarizeC2GroupLines = ({ groups, limit = 5, representativesOnly = false }) => {
  const source = (Array.isArray(groups) ? groups : [])
    .filter((row) => (representativesOnly ? String(row?.representativeFamilyId ?? "").trim() : true))
    .slice()
    .sort(
      (left, right) =>
        Number(right?.representativeScore ?? 0) - Number(left?.representativeScore ?? 0),
    )
    .slice(0, Math.max(1, limit))
  if (!source.length) return ["- none"]
  return source.map((row) => {
    const groupId = String(row?.groupId ?? "NA").trim() || "NA"
    const representativeFamilyId =
      String(row?.representativeFamilyId ?? "NA").trim() || "NA"
    const shadowCount = Math.max(0, Number((row?.shadowFamilyIds ?? []).length ?? 0) || 0)
    const similarity = formatRatePct(row?.avgDedupSimilarity ?? 0)
    const score = Number(row?.representativeScore ?? 0)
    return `- ${groupId} rep=${representativeFamilyId} shadow=${shadowCount} avgSim=${similarity} score=${score.toFixed(3)}`
  })
}

const buildActiveResearchHandoffRuntimeSection = ({
  finalSummary,
  stepC0Summary,
  stepCSummary,
  c0FamilyIndex,
  stepC1Summary,
  c1ProbeIndex,
  c1ProbeResults,
  stepC2Summary,
  c2DedupIndex,
  c2DedupGroups
}) => {
  const families = Array.isArray(c0FamilyIndex?.families) ? c0FamilyIndex.families : []
  const shortlisted = families.filter((row) => row?.shortlisted === true)
  const templatesBeforeC0 = Math.max(0, Number(stepCSummary?.templatesBeforeC0 ?? 0) || 0)
  const c0AcceptedTemplateCount = Math.max(
    0,
    Number(stepCSummary?.c0AcceptedTemplateCount ?? stepCSummary?.c0?.acceptedTemplateCount ?? 0) || 0,
  )
  const selectedPrototypes = Math.max(0, Number(stepCSummary?.prototypes ?? 0) || 0)
  const retainedFromTemplates =
    templatesBeforeC0 > 0 ? c0AcceptedTemplateCount / templatesBeforeC0 : 0
  const retainedToPrototypes =
    c0AcceptedTemplateCount > 0 ? selectedPrototypes / c0AcceptedTemplateCount : 0
  const gateReason = String(stepC0Summary?.gate?.reason ?? finalSummary?.c0Gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE"
  const c1GateReason = String(stepC1Summary?.gate?.reason ?? finalSummary?.c1Gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE"
  const c1AcceptedTemplateCount = Math.max(
    0,
    Number(stepCSummary?.c1AcceptedTemplateCount ?? stepCSummary?.c1?.acceptedTemplateCount ?? 0) || 0,
  )
  const c2Groups = Array.isArray(c2DedupGroups) ? c2DedupGroups : []
  const c1PassedFamilies = Math.max(0, Number(stepC1Summary?.passedFamilies ?? c1ProbeIndex?.passedFamilyCount ?? 0) || 0)
  const retainedToC1 =
    c0AcceptedTemplateCount > 0 ? c1AcceptedTemplateCount / c0AcceptedTemplateCount : 0
  const c2AcceptedTemplateCount = Math.max(
    0,
    Number(stepCSummary?.c2AcceptedTemplateCount ?? stepCSummary?.c2?.acceptedTemplateCount ?? 0) || 0,
  )
  const c2RepresentativeFamilies = Math.max(
    0,
    Number(stepC2Summary?.representativeFamilies ?? c2DedupIndex?.representativeFamilyCount ?? 0) || 0,
  )
  const c2ShadowFamilies = Math.max(
    0,
    Number(stepC2Summary?.shadowFamilies ?? c2DedupIndex?.shadowFamilyCount ?? 0) || 0,
  )
  const c2GateReason = String(stepC2Summary?.gate?.reason ?? finalSummary?.c2Gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE"
  const retainedToC2 =
    c1AcceptedTemplateCount > 0 ? c2AcceptedTemplateCount / c1AcceptedTemplateCount : 0
  const retiredFamilies = ["- none tracked in v1"]
  return [
    ACTIVE_RESEARCH_HANDOFF_START,
    "## Runtime C0 Snapshot",
    `- Last updated: \`${new Date().toISOString()}\``,
    `- Current C0 gate fail reason: \`${gateReason}\``,
    `- Current C0 shortlist family count: \`${Math.max(0, Number(stepC0Summary?.shortlistedFamilies ?? shortlisted.length) || 0)}\``,
    `- Current C0 accepted template count: \`${c0AcceptedTemplateCount}\``,
    `- Current C0 fallback used: \`${stepC0Summary?.gate?.fallbackUsed === true}\``,
    "- Current C0 shortlist:",
    ...summarizeC0FamilyLines({ families: shortlisted, limit: 8 }),
    "- Current dominant C0 families:",
    ...summarizeC0FamilyLines({ families, limit: 5 }),
    "- Current retired C0 families:",
    ...retiredFamilies,
    "- Current C0 -> C retained ratio:",
    `- templatesBeforeC0=${templatesBeforeC0}, c0AcceptedTemplateCount=${c0AcceptedTemplateCount}, prototypes=${selectedPrototypes}`,
    `- template->C0 accepted = ${formatRatePct(retainedFromTemplates)}, C0 accepted->prototype = ${formatRatePct(retainedToPrototypes)}`,
    "## Runtime C1 Snapshot",
    `- Current C1 gate fail reason: \`${c1GateReason}\``,
    `- Current C1 probed family count: \`${Math.max(0, Number(stepC1Summary?.probedFamilies ?? c1ProbeIndex?.probedFamilyCount ?? 0) || 0)}\``,
    `- Current C1 passed family count: \`${c1PassedFamilies}\``,
    `- Current C1 fallback used: \`${stepC1Summary?.fallbackUsed === true || c1ProbeIndex?.fallbackUsed === true}\``,
    `- Current C1 effective probe scope: \`${String(stepC1Summary?.probeScopeApplied ?? stepC1Summary?.probeScope ?? "UNAVAILABLE")}\``,
    `- Current C1 writebacks disabled: \`${stepC1Summary?.writebacksDisabled === true}\``,
    `- Current C1 frozen feedback skipped: \`${stepC1Summary?.feedbackUpdatesSkipped === true || stepC1Summary?.executionFeedbackSkipped === true}\``,
    "- Current C1 passed families:",
    ...summarizeC1ResultLines({ results: c1ProbeResults, limit: 8, passedOnly: true }),
    "- Current C1 top probe families:",
    ...summarizeC1ResultLines({ results: c1ProbeResults, limit: 5 }),
    "- Current C0 -> C1 -> C retained ratio:",
    `- c0AcceptedTemplateCount=${c0AcceptedTemplateCount}, c1AcceptedTemplateCount=${c1AcceptedTemplateCount}, prototypes=${selectedPrototypes}`,
    `- C0 accepted->C1 accepted = ${formatRatePct(retainedToC1)}, C1 accepted->prototype = ${formatRatePct(c1AcceptedTemplateCount > 0 ? selectedPrototypes / c1AcceptedTemplateCount : 0)}`,
    "## Runtime C2 Snapshot",
    `- Current C2 gate fail reason: \`${c2GateReason}\``,
    `- Current C2 representative family count: \`${c2RepresentativeFamilies}\``,
    `- Current C2 shadow family count: \`${c2ShadowFamilies}\``,
    `- Current C2 fallback used: \`${stepC2Summary?.fallbackUsed === true || c2DedupIndex?.fallbackUsed === true}\``,
    "- Current C2 representative families:",
    ...summarizeC2GroupLines({ groups: c2Groups, limit: 8, representativesOnly: true }),
    "- Current C2 shadow groups:",
    ...summarizeC2GroupLines({ groups: c2Groups.filter((row) => (row?.shadowFamilyIds ?? []).length > 0), limit: 5 }),
    "- Current C1 -> C2 -> C retained ratio:",
    `- c1AcceptedTemplateCount=${c1AcceptedTemplateCount}, c2AcceptedTemplateCount=${c2AcceptedTemplateCount}, prototypes=${selectedPrototypes}`,
    `- C1 accepted->C2 accepted = ${formatRatePct(retainedToC2)}, C2 accepted->prototype = ${formatRatePct(c2AcceptedTemplateCount > 0 ? selectedPrototypes / c2AcceptedTemplateCount : 0)}`,
    ACTIVE_RESEARCH_HANDOFF_END
  ].join("\n")
}

const updateActiveResearchHandoff = async ({
  cwd,
  finalSummary,
  stepC0Summary,
  stepCSummary,
  c0FamilyIndex,
  stepC1Summary,
  c1ProbeIndex,
  c1ProbeResults,
  stepC2Summary,
  c2DedupIndex,
  c2DedupGroups
}) => {
  const handoffPath = path.join(cwd, "meta", "active_research_handoff.md")
  if (!pathExists(handoffPath)) return null
  const current = String(await fsp.readFile(handoffPath, "utf8"))
  const runtimeSection = buildActiveResearchHandoffRuntimeSection({
    finalSummary,
    stepC0Summary,
    stepCSummary,
    c0FamilyIndex,
    stepC1Summary,
    c1ProbeIndex,
    c1ProbeResults,
    stepC2Summary,
    c2DedupIndex,
    c2DedupGroups
  })
  let next = current
  const startIdx = current.indexOf(ACTIVE_RESEARCH_HANDOFF_START)
  const endIdx = current.indexOf(ACTIVE_RESEARCH_HANDOFF_END)
  if (startIdx >= 0 && endIdx > startIdx) {
    next =
      current.slice(0, startIdx) +
      runtimeSection +
      current.slice(endIdx + ACTIVE_RESEARCH_HANDOFF_END.length)
  } else {
    next = `${current.trimEnd()}\n\n${runtimeSection}\n`
  }
  await fsp.writeFile(handoffPath, next, "utf8")
  return handoffPath
}

const normalizeIndexedProgressRecord = (row) => {
  const record = row?.record && typeof row.record === "object" ? row.record : row
  if (!record || typeof record !== "object") return null
  const summaryPath = String(record?.summaryPath ?? row?.summaryPath ?? "").trim()
  if (!summaryPath) return null
  return {
    ...record,
    summaryPath,
    loopDir: String(record?.loopDir ?? path.dirname(summaryPath)).trim() || null
  }
}

const scanHistoricalProgressRecords = async ({
  probeRootDir,
  excludeSummaryPath
}) => {
  if (!probeRootDir || !pathExists(probeRootDir)) return []
  const entries = await fsp.readdir(probeRootDir, { withFileTypes: true }).catch(() => [])
  const records = []
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue
    const summaryPath = path.join(probeRootDir, entry.name, "cd_loop_summary.json")
    if (!pathExists(summaryPath)) continue
    if (excludeSummaryPath && path.resolve(summaryPath) === path.resolve(excludeSummaryPath)) continue
    const summary = await readJson(summaryPath, null).catch(() => null)
    if (!summary || String(summary?.mode ?? "") !== "cd-loop") continue
    records.push(buildProgressRecordFromSummary({
      summary,
      summaryPath
    }))
  }
  return records
}

const loadHistoricalProgressRecordsFromIndex = async ({
  indexPath,
  probeRootDir,
  excludeSummaryPath
}) => {
  if (!indexPath || !pathExists(indexPath)) return []
  const rawRows = await readJsonl(indexPath).catch(() => [])
  const resolvedRootPrefix = probeRootDir ? `${path.resolve(probeRootDir)}${path.sep}` : ""
  const excluded = excludeSummaryPath ? path.resolve(excludeSummaryPath) : ""
  const deduped = new Map()
  for (const raw of rawRows) {
    const record = normalizeIndexedProgressRecord(raw)
    if (!record) continue
    const summaryPath = path.resolve(String(record.summaryPath))
    if (excluded && summaryPath === excluded) continue
    if (resolvedRootPrefix && !summaryPath.startsWith(resolvedRootPrefix)) continue
    deduped.set(summaryPath, record)
  }
  return Array.from(deduped.values())
}

const backfillHistoricalProgressIndex = async ({
  indexPath,
  records
}) => {
  if (!indexPath || !Array.isArray(records) || records.length === 0) return 0
  const existingRows = await readJsonl(indexPath).catch(() => [])
  const existing = new Set()
  for (const raw of existingRows) {
    const record = normalizeIndexedProgressRecord(raw)
    if (!record?.summaryPath) continue
    existing.add(path.resolve(String(record.summaryPath)))
  }
  let written = 0
  for (const record of records) {
    const summaryPath = String(record?.summaryPath ?? "").trim()
    if (!summaryPath) continue
    const resolvedSummaryPath = path.resolve(summaryPath)
    if (existing.has(resolvedSummaryPath)) continue
    await appendJsonlRow(indexPath, {
      updatedAt: new Date().toISOString(),
      reason: "SCAN_BACKFILL",
      record
    })
    existing.add(resolvedSummaryPath)
    written += 1
  }
  return written
}

const loadHistoricalProgressRecords = async ({
  indexPath,
  probeRootDir,
  excludeSummaryPath
}) => {
  const indexed = await loadHistoricalProgressRecordsFromIndex({
    indexPath,
    probeRootDir,
    excludeSummaryPath
  })
  if (indexed.length > 0) return indexed
  const scanned = await scanHistoricalProgressRecords({
    probeRootDir,
    excludeSummaryPath
  })
  if (scanned.length > 0) {
    await backfillHistoricalProgressIndex({
      indexPath,
      records: scanned
    })
  }
  return scanned
}

const selectBestAcceptedRecord = (records) => {
  const sorted = Array.from(Array.isArray(records) ? records : []).sort((left, right) =>
    String(left?.generatedAt ?? "").localeCompare(String(right?.generatedAt ?? "")),
  )
  let best = null
  for (const record of sorted) {
    if (!hasUsableAcceptedStepE(record)) continue
    const evalResult = compareAcceptedProgressRecords(record, best)
    if (evalResult?.updated === true) best = record
  }
  return best
}

const selectBestCandidateRecord = (records) => {
  const sorted = Array.from(Array.isArray(records) ? records : []).sort((left, right) =>
    String(left?.generatedAt ?? "").localeCompare(String(right?.generatedAt ?? "")),
  )
  let best = null
  for (const record of sorted) {
    const evalResult = compareCandidatePeakRecords(record, best)
    if (evalResult?.updated === true) best = record
  }
  return best
}

const persistProgressTracking = async ({
  lineageStateDir,
  probeRootDir,
  summary,
  summaryPath,
  cfg,
  probeCycleRuntime,
  probeCyclePaths
}) => {
  const paths = resolveProgressTrackingPaths(lineageStateDir)
  let acceptedBaseline = await readJson(paths.acceptedBaselinePath, null)
  let candidatePeak = await readJson(paths.candidatePeakPath, null)
  if (acceptedBaseline && !hasUsableAcceptedStepE(acceptedBaseline)) {
    acceptedBaseline = null
  }
  let acceptedBootstrapped = false
  let candidateBootstrapped = false
  if (!acceptedBaseline || !candidatePeak) {
    const historical = await loadHistoricalProgressRecords({
      indexPath: paths.historicalProgressIndexPath,
      probeRootDir,
      excludeSummaryPath: summaryPath
    })
    if (!acceptedBaseline) {
      acceptedBaseline = selectBestAcceptedRecord(historical)
      acceptedBootstrapped = !!acceptedBaseline
    }
    if (!candidatePeak) {
      candidatePeak = selectBestCandidateRecord(historical)
      candidateBootstrapped = !!candidatePeak
    }
  }
  const current = buildProgressRecordFromSummary({
    summary,
    summaryPath
  })
  await appendJsonlRow(paths.historicalProgressIndexPath, {
    updatedAt: new Date().toISOString(),
    record: current
  })
  const safeLane = normalizeProbeLane(probeCycleRuntime?.probeLane)
  const laneCfg = resolveProbeLaneConfig({
    cfg,
    probeLane: safeLane
  })
  const allowProgressRecordMutation = safeLane === "operating"
  const acceptedEval = compareAcceptedProgressRecords(current, acceptedBaseline)
  const candidateEval = compareCandidatePeakRecords(current, candidatePeak)
  const progressEval = safeLane === "research" ? candidateEval : acceptedEval
  const acceptedWouldUpdate = acceptedEval?.updated === true
  const candidateWouldUpdate = candidateEval?.updated === true
  const acceptedUpdated = allowProgressRecordMutation && acceptedWouldUpdate
  const candidateUpdated = allowProgressRecordMutation && candidateWouldUpdate
  let acceptedStored = acceptedBaseline
  let candidateStored = candidatePeak
  if (allowProgressRecordMutation && acceptedBootstrapped && acceptedStored) {
    await writeJson(paths.acceptedBaselinePath, acceptedStored)
    await appendJsonlRow(paths.acceptedBaselineHistoryPath, {
      updatedAt: new Date().toISOString(),
      reason: "BOOTSTRAP_FROM_HISTORY",
      record: acceptedStored
    })
  }
  if (allowProgressRecordMutation && candidateBootstrapped && candidateStored) {
    await writeJson(paths.candidatePeakPath, candidateStored)
    await appendJsonlRow(paths.candidatePeakHistoryPath, {
      updatedAt: new Date().toISOString(),
      reason: "BOOTSTRAP_FROM_HISTORY",
      compareValue: 1,
      record: candidateStored
    })
  }
  if (acceptedUpdated) {
    acceptedStored = current
    await writeJson(paths.acceptedBaselinePath, acceptedStored)
    await appendJsonlRow(paths.acceptedBaselineHistoryPath, {
      updatedAt: new Date().toISOString(),
      reason: acceptedEval.reason,
      improvements: acceptedEval.improvements ?? [],
      regressions: acceptedEval.regressions ?? [],
      record: acceptedStored
    })
  }
  if (candidateUpdated) {
    candidateStored = current
    await writeJson(paths.candidatePeakPath, candidateStored)
    await appendJsonlRow(paths.candidatePeakHistoryPath, {
      updatedAt: new Date().toISOString(),
      reason: candidateEval.reason,
      compareValue: candidateEval.compareValue ?? 0,
      record: candidateStored
    })
  }
  let probeCycle = null
  if (probeCycleRuntime && laneCfg?.enabled !== false) {
    const prevProbeCycleState = normalizeProbeCycleState({
      raw: await readJson(probeCyclePaths?.statePath, {}),
      lineageKey: current?.lineageKey ?? probeCycleRuntime?.lineageKey ?? ""
    })
    const probeCycleResult = updateProbeCycleState({
      cfg,
      current,
      progressEval,
      acceptedEval,
      candidateEval,
      prevState: prevProbeCycleState,
      runtime: probeCycleRuntime
    })
    probeCycle = probeCycleResult?.summary ?? null
    if (probeCyclePaths?.dir) await ensureDir(probeCyclePaths.dir)
    await writeJson(probeCyclePaths?.statePath, probeCycleResult?.stored ?? prevProbeCycleState)
    await appendJsonlRow(probeCyclePaths?.historyPath, {
      updatedAt: new Date().toISOString(),
      runId: current?.runId ?? null,
      sessionId: current?.sessionId ?? null,
      current,
      acceptedReason: acceptedEval?.reason ?? "UNKNOWN",
      candidateReason: candidateEval?.reason ?? "UNKNOWN",
      probeCycle
    })
  }
  return {
    acceptedBaseline: {
      filePath: paths.acceptedBaselinePath,
      updated: acceptedUpdated,
      updateSuppressed: !allowProgressRecordMutation && acceptedWouldUpdate,
      reason: acceptedEval?.reason ?? "UNKNOWN",
      improvements: acceptedEval?.improvements ?? [],
      regressions: acceptedEval?.regressions ?? [],
      current,
      baseline: acceptedBaseline,
      stored: acceptedStored
    },
    candidatePeak: {
      filePath: paths.candidatePeakPath,
      updated: candidateUpdated,
      updateSuppressed: !allowProgressRecordMutation && candidateWouldUpdate,
      reason: candidateEval?.reason ?? "UNKNOWN",
      compareValue: candidateEval?.compareValue ?? 0,
      current,
      baseline: candidatePeak,
      stored: candidateStored
    },
    probeCycle
  }
}

const computePolicyFingerprint = async (sampledDebugPath) => {
  if (!sampledDebugPath || !pathExists(sampledDebugPath)) {
    return {
      fingerprint: "",
      pickedFingerprint: "",
      executedFingerprint: "",
      decisionDays: 0
    }
  }
  try {
    const stat = await fsp.stat(sampledDebugPath).catch(() => null)
    const cachePath = `${sampledDebugPath}.fingerprint.json`
    const sourceMeta = stat
      ? {
          size: Number(stat.size ?? 0) || 0,
          mtimeMs: Math.floor(Number(stat.mtimeMs ?? 0) || 0)
        }
      : null
    if (sourceMeta && pathExists(cachePath)) {
      const cached = await readJson(cachePath, null).catch(() => null)
      const cachedSource = cached?.source && typeof cached.source === "object" ? cached.source : null
      const cachedResult = cached?.result && typeof cached.result === "object" ? cached.result : null
      if (
        cached?.version === 1 &&
        cachedSource &&
        cachedResult &&
        Number(cachedSource.size ?? -1) === sourceMeta.size &&
        Number(cachedSource.mtimeMs ?? -1) === sourceMeta.mtimeMs
      ) {
        return {
          fingerprint: String(cachedResult?.fingerprint ?? "").trim(),
          pickedFingerprint: String(cachedResult?.pickedFingerprint ?? "").trim(),
          executedFingerprint: String(cachedResult?.executedFingerprint ?? "").trim(),
          decisionDays: Math.max(0, Number(cachedResult?.decisionDays ?? 0) || 0)
        }
      }
    }
    const rows = await readJsonl(sampledDebugPath)
    const joined = []
    const pickedOnly = []
    const executedOnly = []
    for (const row of rows) {
      const dateKey = String(row?.decisionDateKey ?? "").trim()
      if (!dateKey) continue
      const picked = Array.from(
        new Set(
          (Array.isArray(row?.pickedSymbols) ? row.pickedSymbols : [])
            .map((v) => String(v ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b))
      const executed = Array.from(
        new Set(
          (Array.isArray(row?.executedSymbols) ? row.executedSymbols : [])
            .map((v) => String(v ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b))
      joined.push(`${dateKey}|P:${picked.join(",")}|E:${executed.join(",")}`)
      pickedOnly.push(`${dateKey}|P:${picked.join(",")}`)
      executedOnly.push(`${dateKey}|E:${executed.join(",")}`)
    }
    joined.sort((a, b) => a.localeCompare(b))
    pickedOnly.sort((a, b) => a.localeCompare(b))
    executedOnly.sort((a, b) => a.localeCompare(b))
    const result = {
      fingerprint: hashTextSha1(joined.join("\n")),
      pickedFingerprint: hashTextSha1(pickedOnly.join("\n")),
      executedFingerprint: hashTextSha1(executedOnly.join("\n")),
      decisionDays: joined.length
    }
    if (sourceMeta) {
      await writeJson(cachePath, {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: sourceMeta,
        result
      })
    }
    return result
  } catch {
    return {
      fingerprint: "",
      pickedFingerprint: "",
      executedFingerprint: "",
      decisionDays: 0
    }
  }
}

const resolvePolicyIdentity = ({ policyFingerprint }) => {
  const mainFingerprint = String(policyFingerprint?.fingerprint ?? "").trim()
  if (mainFingerprint) {
    return {
      key: `fp:${mainFingerprint}`,
      source: "fingerprint"
    }
  }
  const pickedFingerprint = String(policyFingerprint?.pickedFingerprint ?? "").trim()
  const executedFingerprint = String(policyFingerprint?.executedFingerprint ?? "").trim()
  if (pickedFingerprint || executedFingerprint) {
    return {
      key: `pe:${hashTextSha1(`${pickedFingerprint}|${executedFingerprint}`)}`,
      source: "picked-executed"
    }
  }
  return {
    key: "",
    source: "none"
  }
}

const evaluateNoOpPolicyChange = ({
  prev,
  next
}) => {
  const prevWeights = String(prev?.weightsHash ?? "").trim()
  const nextWeights = String(next?.weightsHash ?? "").trim()
  if (!prevWeights || !nextWeights || prevWeights === nextWeights) {
    return {
      isNoOp: false,
      prevIdentity: { key: "", source: "none" },
      nextIdentity: { key: "", source: "none" }
    }
  }
  const prevIdentity = resolvePolicyIdentity({
    policyFingerprint: prev?.policyFingerprint
  })
  const nextIdentity = resolvePolicyIdentity({
    policyFingerprint: next?.policyFingerprint
  })
  const isNoOp =
    !!String(prevIdentity?.key ?? "") &&
    String(prevIdentity.key) === String(nextIdentity?.key ?? "")
  return {
    isNoOp,
    prevIdentity,
    nextIdentity
  }
}

const assertSampledDebugReady = ({
  sampledDebugPath,
  stage,
  round,
  epoch,
  requireSampledDebug = true
}) => {
  if (requireSampledDebug !== true) return
  const safePath = String(sampledDebugPath ?? "").trim()
  if (!safePath || !pathExists(safePath)) {
    const where = [stage, `round=${round}`]
    if (Number.isFinite(Number(epoch))) where.push(`epoch=${epoch}`)
    throw new Error(
      `cd-loop ${where.join(" ")} missing sampled_debug_eval_top5.jsonl; enable lightweight.stepD.sampledDebugLog.enabled=true`,
    )
  }
}

const assertPolicyFingerprintReady = ({
  policyFingerprint,
  stage,
  round,
  epoch,
  sampledDebugPath
}) => {
  const main = String(policyFingerprint?.fingerprint ?? "").trim()
  if (main) return
  const where = [stage, `round=${round}`]
  if (Number.isFinite(Number(epoch))) where.push(`epoch=${epoch}`)
  throw new Error(
      `cd-loop ${where.join(" ")} policy fingerprint empty; sampledDebugPath=${String(sampledDebugPath ?? "")}`,
  )
}

const resolveNoOpPolicyArtifacts = async ({
  stepDSummary,
  sampledDebugPath,
  weightsPath,
  stage,
  round,
  epoch,
  requireSampledDebug = true
}) => {
  const sampledDebugEnabled = stepDSummary?.sampledDebugLog?.enabled === true
  const sampledDebugRequired = requireSampledDebug === true && sampledDebugEnabled
  assertSampledDebugReady({
    sampledDebugPath,
    stage,
    round,
    epoch,
    requireSampledDebug: sampledDebugRequired
  })
  const weightsHash = await hashFileSha1(weightsPath)
  if (sampledDebugRequired !== true) {
    return {
      weightsHash,
      sampledDebugRequired,
      policyFingerprint: {
        fingerprint: String(weightsHash ?? "").trim(),
        pickedFingerprint: "",
        executedFingerprint: "",
        source: "weights_hash_fallback"
      }
    }
  }
  const policyFingerprint = await computePolicyFingerprint(sampledDebugPath)
  assertPolicyFingerprintReady({
    policyFingerprint,
    sampledDebugPath,
    stage,
    round,
    epoch
  })
  return {
    weightsHash,
    sampledDebugRequired,
    policyFingerprint
  }
}

const loadSweepCache = async (filePath) => {
  const raw = await readJson(filePath, { entries: [] })
  const map = new Map()
  for (const row of raw?.entries ?? []) {
    const key = String(row?.key ?? "").trim()
    if (!key) continue
    const rows = Array.isArray(row?.rows)
      ? row.rows
          .map((it) => ({
            margin: Number(it?.margin ?? NaN),
            metrics: it?.metrics ?? {}
          }))
          .filter((it) => Number.isFinite(it.margin))
      : []
    if (!rows.length) continue
    map.set(key, {
      rows,
      updatedAt: String(row?.updatedAt ?? ""),
      source: String(row?.source ?? "unknown")
    })
  }
  return map
}

const saveSweepCache = async (filePath, map) => {
  const entries = Array.from(map.entries())
    .slice(-200)
    .map(([key, row]) => ({
      key,
      updatedAt: row?.updatedAt ?? new Date().toISOString(),
      source: row?.source ?? "runtime",
      rows: Array.isArray(row?.rows)
        ? row.rows.map((it) => ({
            margin: Number(it?.margin ?? 0),
            metrics: it?.metrics ?? {}
          }))
        : []
    }))
  await ensureDir(path.dirname(filePath))
  await writeJson(filePath, {
    updatedAt: new Date().toISOString(),
    entries
  })
}

const resolveCdLoopConfig = ({ cfg, flags }) => {
  const raw = cfg?.cdLoop ?? {}
  const qualityLockbox = cfg?.qualityGate?.lockbox ?? {}
  const override = (name, defaultValue) => {
    const v = flags?.[name]
    if (v === undefined) return defaultValue
    const n = Number(v)
    return Number.isFinite(n) ? n : defaultValue
  }
  const baseStopNoImproveRounds = Math.max(
    1,
    Math.floor(Number(raw?.stopNoImproveRounds ?? 2) || 2),
  )
  const out = {
    maxRounds: Math.max(1, Math.floor(override("rounds", Number(raw?.maxRounds ?? 3) || 3))),
    minEpochsPerRound: Math.max(
      1,
      Math.floor(override("min-epochs", Number(raw?.minEpochsPerRound ?? 2) || 2)),
    ),
    maxEpochsPerRound: Math.max(
      1,
      Math.floor(override("max-epochs", Number(raw?.maxEpochsPerRound ?? 4) || 4)),
    ),
    plateauEpochs: Math.max(1, Math.floor(Number(raw?.plateauEpochs ?? 2) || 2)),
    noOpPolicy: {
      enabled: raw?.noOpPolicy?.enabled !== false,
      minNoOpEpochStreak: Math.max(
        1,
        Math.floor(Number(raw?.noOpPolicy?.minNoOpEpochStreak ?? 1) || 1),
      ),
      requireSampledDebug: raw?.noOpPolicy?.requireSampledDebug !== false
    },
    minHitRateImprove: Math.max(0, Number(raw?.minHitRateImprove ?? 0.0015) || 0),
    stopNoImproveRounds: baseStopNoImproveRounds,
    stagnationRoundsBeforeRebuildC: Math.max(
      1,
      Math.floor(Number(raw?.stagnationRoundsBeforeRebuildC ?? baseStopNoImproveRounds) || baseStopNoImproveRounds),
    ),
    finalStopNoImproveRounds: Math.max(
      1,
      Math.floor(Number(raw?.finalStopNoImproveRounds ?? 2) || 2),
    ),
    acceptedBaselineProbeCycle: {
      enabled: raw?.acceptedBaselineProbeCycle?.enabled !== false,
      enforceAcceptedBaselineParent:
        raw?.acceptedBaselineProbeCycle?.enforceAcceptedBaselineParent !== false,
      maxStructuralExperimentsPerPlateau: Math.max(
        1,
        Math.floor(Number(raw?.acceptedBaselineProbeCycle?.maxStructuralExperimentsPerPlateau ?? 1) || 1),
      ),
      minNoCodeProbesBeforePlateau: Math.max(
        1,
        Math.floor(Number(raw?.acceptedBaselineProbeCycle?.minNoCodeProbesBeforePlateau ?? 2) || 2),
      ),
      plateauAfterNonImprovement: Math.max(
        1,
        Math.floor(Number(raw?.acceptedBaselineProbeCycle?.plateauAfterNonImprovement ?? 3) || 3),
      ),
      plateauAfterStepEMissing: Math.max(
        1,
        Math.floor(Number(raw?.acceptedBaselineProbeCycle?.plateauAfterStepEMissing ?? 2) || 2),
      ),
      requirePlateauForStructuralExperiment:
        raw?.acceptedBaselineProbeCycle?.requirePlateauForStructuralExperiment === true
    },
    researchProbeCycle: {
      enabled: raw?.researchProbeCycle?.enabled !== false,
      parentSource: String(raw?.researchProbeCycle?.parentSource ?? "candidate_peak").trim() || "candidate_peak",
      enforceResearchParent:
        raw?.researchProbeCycle?.enforceResearchParent !== false,
      maxStructuralExperimentsPerPlateau: Math.max(
        1,
        Math.floor(Number(raw?.researchProbeCycle?.maxStructuralExperimentsPerPlateau ?? 1) || 1),
      ),
      minNoCodeProbesBeforePlateau: Math.max(
        1,
        Math.floor(Number(raw?.researchProbeCycle?.minNoCodeProbesBeforePlateau ?? 5) || 5),
      ),
      plateauAfterNonImprovement: Math.max(
        1,
        Math.floor(Number(raw?.researchProbeCycle?.plateauAfterNonImprovement ?? 3) || 3),
      ),
      plateauAfterStepEMissing: Math.max(
        1,
        Math.floor(Number(raw?.researchProbeCycle?.plateauAfterStepEMissing ?? 2) || 2),
      ),
      requirePlateauForStructuralExperiment:
        raw?.researchProbeCycle?.requirePlateauForStructuralExperiment === true
    },
    minUsageForDrop: Math.max(1, Math.floor(Number(raw?.minUsageForDrop ?? 12) || 12)),
    dropHitRateDelta: Math.max(0, Number(raw?.dropHitRateDelta ?? 0.02) || 0),
    dropMinAvgRegret: Math.max(0, Number(raw?.dropMinAvgRegret ?? 0.01) || 0),
    dropMinMissRate: Math.max(0, Math.min(1, Number(raw?.dropMinMissRate ?? 0.75) || 0)),
    dropStreakRounds: Math.max(1, Math.floor(Number(raw?.dropStreakRounds ?? 2) || 2)),
    perRoundDropCapRatio: Math.max(0, Math.min(1, Number(raw?.perRoundDropCapRatio ?? 0.25) || 0)),
    clusterMinKeep: Math.max(0, Math.floor(Number(raw?.clusterMinKeep ?? 2) || 2)),
    rapidImproveHitRateDelta: Math.max(0, Number(raw?.rapidImproveHitRateDelta ?? 0.05) || 0),
    unstableNoCandidateRateDelta: Math.max(0, Number(raw?.unstableNoCandidateRateDelta ?? 0.02) || 0),
    unstableRegretDelta: Math.max(0, Number(raw?.unstableRegretDelta ?? 0.01) || 0),
    minOnePickDaysForPromotion: (() => {
      const n = Number(raw?.minOnePickDaysForPromotion ?? 1)
      return Math.max(0, Math.floor(Number.isFinite(n) ? n : 1))
    })(),
    minPickedCountForPromotion: (() => {
      const n = Number(raw?.minPickedCountForPromotion ?? DEFAULT_PROMOTION_PICKED_FLOOR)
      return Math.max(
        0,
        Math.floor(Number.isFinite(n) ? n : DEFAULT_PROMOTION_PICKED_FLOOR),
      )
    })(),
    minPickHitRateLcb95ForPromotion: clamp01(raw?.minPickHitRateLcb95ForPromotion ?? 0),
    minTop1ToOracleConversionForPromotion: clamp01(
      raw?.minTop1ToOracleConversionForPromotion ?? 0,
    ),
    minBudgetedConversion80ForPromotion: clamp01(
      raw?.minBudgetedConversion80ForPromotion ?? 0,
    ),
    maxRankLossAvgEvalForPromotion: Math.max(
      0,
      Number(raw?.maxRankLossAvgEvalForPromotion ?? 0.08) || 0.08,
    ),
    maxLookaheadViolationsForPromotion: Math.max(
      0,
      Math.floor(Number(raw?.maxLookaheadViolationsForPromotion ?? 0) || 0),
    ),
    maxScoreMsPerSeedForPromotion: Math.max(
      0,
      Number(raw?.maxScoreMsPerSeedForPromotion ?? 0) || 0,
    ),
    maxScoreMsPerSeedRegression: Math.max(
      0,
      Number(raw?.maxScoreMsPerSeedRegression ?? 0.25) || 0.25,
    ),
    zeroOnePickResetStreak: Math.max(1, Math.floor(Number(raw?.zeroOnePickResetStreak ?? 2) || 2)),
    weightCarry: {
      enabled: raw?.weightCarry?.enabled !== false,
      maxPrototypeChangeRate: clamp01(raw?.weightCarry?.maxPrototypeChangeRate ?? 0.35)
    },
    scoreMarginSweep: {
      enabled: raw?.scoreMarginSweep?.enabled !== false,
      deltas: resolveNumberArray(raw?.scoreMarginSweep?.deltas, [-0.005, -0.003, 0, 0.003, 0.005]),
      minPickHitRateGain: Math.max(
        0,
        Number(raw?.scoreMarginSweep?.minPickHitRateGain ?? 0.0015) || 0,
      ),
      minPickHitCountGain: Math.max(
        0,
        Math.floor(Number(raw?.scoreMarginSweep?.minPickHitCountGain ?? 1) || 1),
      ),
      minPickHitRateLcb95Gain: Math.max(
        0,
        Number(raw?.scoreMarginSweep?.minPickHitRateLcb95Gain ?? 0.001) || 0,
      ),
      minTop1ToOracleConversionGain: Math.max(
        0,
        Number(raw?.scoreMarginSweep?.minTop1ToOracleConversionGain ?? 0) || 0,
      ),
      minBudgetedConversion80Gain: Math.max(
        0,
        Number(raw?.scoreMarginSweep?.minBudgetedConversion80Gain ?? 0) || 0,
      ),
      minPickHitCount: Math.max(
        0,
        Math.floor(Number(raw?.scoreMarginSweep?.minPickHitCount ?? 10) || 10),
      )
    },
    regimeGuard: {
      enabled: raw?.regimeGuard?.enabled !== false,
      minPicksPerBucket: Math.max(1, Math.floor(Number(raw?.regimeGuard?.minPicksPerBucket ?? 8) || 8)),
      maxHitRateGapFromLcb: clamp01(raw?.regimeGuard?.maxHitRateGapFromLcb ?? 0.2),
      minQualifiedBuckets: Math.max(1, Math.floor(Number(raw?.regimeGuard?.minQualifiedBuckets ?? 1) || 1))
    },
    inversion: {
      enabled: raw?.inversion?.enabled !== false,
      enableOnStreak: Math.max(1, Math.floor(Number(raw?.inversion?.enableOnStreak ?? 2) || 2)),
      disableOnStreak: Math.max(1, Math.floor(Number(raw?.inversion?.disableOnStreak ?? 2) || 2)),
      minDualPickDays: Math.max(1, Math.floor(Number(raw?.inversion?.minDualPickDays ?? 12) || 12)),
      minRateDelta: Math.max(0, Number(raw?.inversion?.minRateDelta ?? 0.08) || 0),
      minBeatDays: Math.max(1, Math.floor(Number(raw?.inversion?.minBeatDays ?? 3) || 3)),
      boostStep: Math.max(0, Number(raw?.inversion?.boostStep ?? 0.003) || 0),
      maxSecondBoost: Math.max(0, Number(raw?.inversion?.maxSecondBoost ?? 0.02) || 0),
      maxSwapMargin: Math.max(0, Number(raw?.inversion?.maxSwapMargin ?? 0.02) || 0),
      qualityWeight: Math.max(0, Number(raw?.inversion?.qualityWeight ?? 0.04) || 0)
    },
    secondPickController: {
      enabled: raw?.secondPickController?.enabled !== false,
      minSamples: Math.max(1, Math.floor(Number(raw?.secondPickController?.minSamples ?? 12) || 12)),
      rateMargin: Math.max(0, Number(raw?.secondPickController?.rateMargin ?? 0.012) || 0),
      expectedAdvantageMargin: Math.max(
        0,
        Number(raw?.secondPickController?.expectedAdvantageMargin ?? 0.0025) || 0,
      ),
      expectedOverrideMaxRatePenalty: Math.max(
        0,
        Number(raw?.secondPickController?.expectedOverrideMaxRatePenalty ?? 0.004) || 0,
      ),
      gapStep: Math.max(0, Number(raw?.secondPickController?.gapStep ?? 0.0012) || 0),
      minGap: Math.max(0, Number(raw?.secondPickController?.minGap ?? 0.01) || 0),
      maxGap: Math.max(0, Number(raw?.secondPickController?.maxGap ?? 0.022) || 0),
      expectedStep: Math.max(0, Number(raw?.secondPickController?.expectedStep ?? 0.0015) || 0),
      minExpectedFloor: Math.max(0, Number(raw?.secondPickController?.minExpectedFloor ?? 0.02) || 0),
      maxMinExpected: Math.max(0, Number(raw?.secondPickController?.maxMinExpected ?? 0.03) || 0)
    },
    commonState: {
      enabled: raw?.commonState?.enabled === true,
      emaAlpha: clamp01(raw?.commonState?.emaAlpha ?? 0.35),
      emaFloor: clamp01(raw?.commonState?.emaFloor ?? 0.08),
      fullConfidencePicks: Math.max(1, Math.floor(Number(raw?.commonState?.fullConfidencePicks ?? 30) || 30)),
      minTradesPerScore: Math.max(1, Math.floor(Number(raw?.commonState?.minTradesPerScore ?? 3) || 3)),
      fullConfidenceTrades: Math.max(1, Math.floor(Number(raw?.commonState?.fullConfidenceTrades ?? 10) || 10)),
      maxPrototypeScores: Math.max(10, Math.floor(Number(raw?.commonState?.maxPrototypeScores ?? 180) || 180)),
      maxRegimeScores: Math.max(5, Math.floor(Number(raw?.commonState?.maxRegimeScores ?? 80) || 80)),
      minAbsScore: Math.max(0, Number(raw?.commonState?.minAbsScore ?? 0.03) || 0),
      minPickHitRateLcb95ForMerge: clamp01(
        raw?.commonState?.minPickHitRateLcb95ForMerge ?? raw?.minPickHitRateLcb95ForPromotion ?? 0.12,
      ),
      minBudgetedConversion80ForMerge: clamp01(
        raw?.commonState?.minBudgetedConversion80ForMerge ?? raw?.minBudgetedConversion80ForPromotion ?? 0.2,
      )
    },
    dOnlySprint: {
      enabled: raw?.dOnlySprint?.enabled === true,
      rounds: Math.max(1, Math.floor(Number(raw?.dOnlySprint?.rounds ?? 5) || 5)),
      minEpochsWhenOracleHealthy: Math.max(
        1,
        Math.floor(Number(raw?.dOnlySprint?.minEpochsWhenOracleHealthy ?? 4) || 4),
      ),
      oracleTopKFloor: clamp01(raw?.dOnlySprint?.oracleTopKFloor ?? 0.9),
      oracleCoverageGapMaxForKeepC: clamp01(
        raw?.dOnlySprint?.oracleCoverageGapMaxForKeepC ?? 0.03,
      ),
      minPickHitRateLcb95: clamp01(raw?.dOnlySprint?.minPickHitRateLcb95 ?? 0),
      minBudgetedConversion80: clamp01(raw?.dOnlySprint?.minBudgetedConversion80 ?? 0),
      maxRankLossAvgEval: Math.max(0, Number(raw?.dOnlySprint?.maxRankLossAvgEval ?? 1) || 1),
      noImproveRoundsToResumeC: Math.max(
        1,
        Math.floor(Number(raw?.dOnlySprint?.noImproveRoundsToResumeC ?? 3) || 3),
      )
    },
    maxPickedCountForPromotion: resolveOptionalNonNegativeInt(
      raw?.maxPickedCountForPromotion,
      80,
    ),
    maxTwoPickDaysForPromotion: Math.max(
      0,
      Math.floor(Number(raw?.maxTwoPickDaysForPromotion ?? 0) || 0),
    ),
    stability: {
      enabled: raw?.stability?.enabled !== false,
      windowRounds: Math.max(1, Math.floor(Number(raw?.stability?.windowRounds ?? 5) || 5)),
      minImprovedRounds: Math.max(1, Math.floor(Number(raw?.stability?.minImprovedRounds ?? 3) || 3)),
      maxPickHitRateStd: clamp01(raw?.stability?.maxPickHitRateStd ?? 0.2),
      maxPickHitRateLcbStd: clamp01(raw?.stability?.maxPickHitRateLcbStd ?? 0.12)
    },
    swa: {
      enabled: raw?.swa?.enabled !== false,
      topRounds: Math.max(1, Math.floor(Number(raw?.swa?.topRounds ?? 5) || 5)),
      minRounds: Math.max(1, Math.floor(Number(raw?.swa?.minRounds ?? 3) || 3)),
      maxPickHitRateStd: clamp01(raw?.swa?.maxPickHitRateStd ?? 0.2),
      maxPickHitRateLcbStd: clamp01(raw?.swa?.maxPickHitRateLcbStd ?? 0.12)
    },
    promotionDebt: {
      enabled: raw?.promotionDebt?.enabled !== false,
      minFalsePositiveRejectedCountEval: Math.max(
        0,
        Math.floor(Number(raw?.promotionDebt?.minFalsePositiveRejectedCountEval ?? 0) || 0),
      ),
      minFalsePositiveRejectionPrecisionEval: clamp01(
        raw?.promotionDebt?.minFalsePositiveRejectionPrecisionEval ?? 0,
      ),
      requirePolicyFingerprintChange: raw?.promotionDebt?.requirePolicyFingerprintChange !== false,
      requireLockboxEligible: raw?.promotionDebt?.requireLockboxEligible !== false
    },
    lockboxGate: {
      enabled: raw?.lockboxGate?.enabled !== false,
      goalMode: resolveGoalMode(raw?.lockboxGate?.goalMode ?? qualityLockbox?.goalMode),
      positionSemantics: resolvePositionSemantics(
        raw?.lockboxGate?.positionSemantics ?? qualityLockbox?.positionSemantics,
      ),
      minTrades: resolveOptionalNonNegativeInt(
        raw?.lockboxGate?.minTrades,
        qualityLockbox?.minTrades ?? 10,
      ),
      minTargetHitCount: Math.max(
        0,
        Math.floor(Number(raw?.lockboxGate?.minTargetHitCount ?? qualityLockbox?.minTargetHitCount ?? 0) || 0),
      ),
      minTargetHitRate: resolveOptionalRate(
        raw?.lockboxGate?.minTargetHitRate ?? qualityLockbox?.minTargetHitRate,
      ),
      minTargetHitsPer20TradingDays: resolveOptionalNumber(
        raw?.lockboxGate?.minTargetHitsPer20TradingDays ?? qualityLockbox?.minTargetHitsPer20TradingDays,
      ),
      maxStopRate: resolveOptionalRate(raw?.lockboxGate?.maxStopRate ?? qualityLockbox?.maxStopRate),
      maxTimeoutNegativeRate: resolveOptionalRate(
        raw?.lockboxGate?.maxTimeoutNegativeRate ?? qualityLockbox?.maxTimeoutNegativeRate,
      ),
      minWinRate: resolveOptionalRate(raw?.lockboxGate?.minWinRate ?? qualityLockbox?.minWinRate),
      minAvgNetRet: resolveOptionalNumber(raw?.lockboxGate?.minAvgNetRet ?? qualityLockbox?.minAvgNetRet),
      minCumulativeReturn: resolveOptionalNumber(
        raw?.lockboxGate?.minCumulativeReturn ?? qualityLockbox?.minCumulativeReturn,
      ),
      maxDrawdown: Math.max(
        0,
        Number(raw?.lockboxGate?.maxDrawdown ?? qualityLockbox?.maxDrawdown ?? 0.35) || 0.35,
      ),
      requireZeroLookaheadViolations: raw?.lockboxGate?.requireZeroLookaheadViolations !== false,
      maxPolicyDriftScore: raw?.lockboxGate?.maxPolicyDriftScore,
      minBucketConsistency: raw?.lockboxGate?.minBucketConsistency,
      minRegimeConsistency: raw?.lockboxGate?.minRegimeConsistency,
      minAgreementDecisionConsistency: raw?.lockboxGate?.minAgreementDecisionConsistency,
      minAgreementReasonConsistency: raw?.lockboxGate?.minAgreementReasonConsistency,
      maxTraceMismatchRate: raw?.lockboxGate?.maxTraceMismatchRate,
      maxTraceCriticalMismatchDays: raw?.lockboxGate?.maxTraceCriticalMismatchDays,
      minFalsePositiveRejectedCount: Math.max(
        0,
        Math.floor(Number(raw?.lockboxGate?.minFalsePositiveRejectedCount ?? 0) || 0),
      ),
      minFalsePositiveRejectionPrecision: clamp01(
        raw?.lockboxGate?.minFalsePositiveRejectionPrecision ?? 0,
      )
    }
  }
  if (out.maxEpochsPerRound < out.minEpochsPerRound) {
    out.maxEpochsPerRound = out.minEpochsPerRound
  }
  if (
    Number(out.maxPickedCountForPromotion ?? 0) > 0 &&
    Number(out.maxPickedCountForPromotion ?? 0) < Number(out.minPickedCountForPromotion ?? 0)
  ) {
    out.maxPickedCountForPromotion = Number(out.minPickedCountForPromotion ?? 0)
  }
  return out
}

const ensureStepBArtifacts = (runDir) => {
  const candidates = [
    path.join(runDir, "step-b", "templates_lite.jsonl"),
    path.join(runDir, "step-b", "templates.jsonl"),
    path.join(runDir, "step-b", "templates_runtime_pack.jsonl")
  ]
  if (candidates.some((p) => pathExists(p))) return
  throw new Error(
    [
      "cd-loop requires Step B artifacts in the target run directory.",
      "Run step-b first (same --run-id) before cd-loop."
    ].join(" "),
  )
}

const enforceStepDSampledDebugForCdLoop = (ctx) => {
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const stepDCfg = lightweightCfg?.stepD ?? {}
  const sampledRaw = stepDCfg?.sampledDebugLog ?? {}
  const sampledDebugLog = {
    ...sampledRaw,
    enabled: true,
    evalOnly: sampledRaw?.evalOnly !== false,
    selectedOrRejectedOnly: sampledRaw?.selectedOrRejectedOnly !== false,
    topK: Math.max(10, Math.floor(Number(sampledRaw?.topK ?? 10) || 10))
  }
  ctx.config.lightweight = {
    ...lightweightCfg,
    stepD: {
      ...stepDCfg,
      sampledDebugLog
    }
  }
  return sampledDebugLog
}

const linkOrCopyIfExists = async (src, dst) => {
  const safeSrc = String(src ?? "").trim()
  const safeDst = String(dst ?? "").trim()
  if (!safeSrc || !safeDst || !pathExists(safeSrc)) return false
  if (path.resolve(safeSrc) === path.resolve(safeDst)) {
    return pathExists(safeDst)
  }
  await ensureDir(path.dirname(safeDst))
  await fsp.unlink(safeDst).catch(() => {})
  try {
    await fsp.link(safeSrc, safeDst)
    return true
  } catch {
    // fall through
  }
  try {
    const relativeTarget = path.relative(path.dirname(safeDst), safeSrc)
    await fsp.symlink(relativeTarget, safeDst)
    return true
  } catch {
    // fall through
  }
  await fsp.copyFile(safeSrc, safeDst)
  return true
}

const copySnapshotIfExists = async (src, dst) => {
  const safeSrc = String(src ?? "").trim()
  const safeDst = String(dst ?? "").trim()
  if (!safeSrc || !safeDst || !pathExists(safeSrc)) return false
  if (path.resolve(safeSrc) === path.resolve(safeDst)) {
    return pathExists(safeDst)
  }
  await ensureDir(path.dirname(safeDst))
  await fsp.unlink(safeDst).catch(() => {})
  await fsp.copyFile(safeSrc, safeDst)
  return true
}

const copyIfExists = async (src, dst) => {
  await copySnapshotIfExists(src, dst)
}

const copyStepDArtifactsForStepE = async ({ stepD, outDir, mode = "full" }) => {
  const stepDDir = path.join(outDir, "step-d")
  await ensureDir(stepDDir)
  const normalizedMode = String(mode ?? "full").trim().toLowerCase()
  const minimalMode = normalizedMode === "minimal"
  const stepDSummary =
    stepD?.summary && typeof stepD.summary === "object"
      ? stepD.summary
      : (
          String(stepD?.summaryPath ?? "").trim() &&
          pathExists(String(stepD?.summaryPath ?? "").trim())
        )
        ? await readJson(String(stepD?.summaryPath ?? "").trim(), null).catch(() => null)
        : null
  const stepDArtifactTierRaw = String(stepDSummary?.artifactTier ?? "exploratory")
    .trim()
    .toLowerCase()
  const stepDArtifactTier =
    stepDArtifactTierRaw === "promotion" || stepDArtifactTierRaw === "confirm"
      ? stepDArtifactTierRaw
      : "exploratory"
  const allowFullTierArtifacts = stepDArtifactTier === "promotion"
  const includeLogs = normalizedMode === "full" && allowFullTierArtifacts
  const includeCandidateIndex = normalizedMode === "full" && allowFullTierArtifacts
  const includeFeaturePack = normalizedMode === "full" && allowFullTierArtifacts
  const includeOnlineAudit = normalizedMode === "full" || normalizedMode === "online_audit"
  const includeLockboxAudit = normalizedMode === "full"
  const syncArtifact = async (src, dst) => {
    const safeSrc = String(src ?? "").trim()
    if (safeSrc && pathExists(safeSrc)) {
      await copySnapshotIfExists(safeSrc, dst)
      return
    }
    if (pathExists(dst)) {
      await fsp.unlink(dst).catch(() => {})
    }
  }
  const summaryPath = path.join(stepDDir, "step_d_summary.json")
  const logsPath = path.join(stepDDir, "daily_online_logs.jsonl")
  const weightsPath = path.join(stepDDir, "weights_final.json")
  const sampledDebugPath = path.join(stepDDir, "sampled_debug_eval_top5.jsonl")
  const policyStatePath = path.join(stepDDir, "step_d_policy_state.json")
  const policyBundlePath = path.join(stepDDir, "step_d_policy_bundle.json")
  const artifactManifestPath = path.join(stepDDir, "step_d_artifact_manifest.json")
  const candidateIndexPath = path.join(stepDDir, "decision_candidates_index.jsonl")
  const candidateIndexMetaPath = path.join(stepDDir, "decision_candidates_index_meta.json")
  const featurePackPath = path.join(stepDDir, "decision_candidates_feature_pack.jsonl")
  const featurePackMetaPath = path.join(stepDDir, "decision_candidates_feature_pack_meta.json")
  const d1RankedCandidatesPath = path.join(stepDDir, "d1_ranked_candidates.jsonl")
  const d2ExecutionAuditPath = path.join(stepDDir, "d2_execution_audit.jsonl")
  const d1LockboxRankedCandidatesPath = path.join(stepDDir, "d1_lockbox_ranked_candidates.jsonl")
  const d2LockboxExecutionAuditPath = path.join(stepDDir, "d2_lockbox_execution_audit.jsonl")
  await syncArtifact(stepD?.summaryPath, summaryPath)
  await syncArtifact(includeLogs ? stepD?.logsPath : "", logsPath)
  await syncArtifact(stepD?.weightsPath, weightsPath)
  await syncArtifact(stepD?.sampledDebugPath, sampledDebugPath)
  await syncArtifact(stepD?.policyStatePath, policyStatePath)
  await syncArtifact(stepD?.policyBundlePath, policyBundlePath)
  await syncArtifact(includeCandidateIndex ? stepD?.candidateIndexPath : "", candidateIndexPath)
  await syncArtifact(includeCandidateIndex ? stepD?.candidateIndexMetaPath : "", candidateIndexMetaPath)
  await syncArtifact(includeFeaturePack ? stepD?.featurePackPath : "", featurePackPath)
  await syncArtifact(includeFeaturePack ? stepD?.featurePackMetaPath : "", featurePackMetaPath)
  await syncArtifact(includeOnlineAudit ? stepD?.d1RankedCandidatesPath : "", d1RankedCandidatesPath)
  await syncArtifact(includeOnlineAudit ? stepD?.d2ExecutionAuditPath : "", d2ExecutionAuditPath)
  await syncArtifact(
    includeLockboxAudit ? stepD?.d1LockboxRankedCandidatesPath : "",
    d1LockboxRankedCandidatesPath,
  )
  await syncArtifact(
    includeLockboxAudit ? stepD?.d2LockboxExecutionAuditPath : "",
    d2LockboxExecutionAuditPath,
  )
  const copiedWeightsHash = await hashFileSha1(weightsPath)
  const copiedArtifacts = {
    summaryPath: pathExists(summaryPath) ? summaryPath : "",
    logsPath: pathExists(logsPath) ? logsPath : "",
    weightsPath: pathExists(weightsPath) ? weightsPath : "",
    sampledDebugPath: pathExists(sampledDebugPath) ? sampledDebugPath : "",
    policyStatePath: pathExists(policyStatePath) ? policyStatePath : "",
    policyBundlePath: pathExists(policyBundlePath) ? policyBundlePath : "",
    candidateIndexPath: pathExists(candidateIndexPath) ? candidateIndexPath : "",
    candidateIndexMetaPath: pathExists(candidateIndexMetaPath) ? candidateIndexMetaPath : "",
    featurePackPath: pathExists(featurePackPath) ? featurePackPath : "",
    featurePackMetaPath: pathExists(featurePackMetaPath) ? featurePackMetaPath : "",
    d1RankedCandidatesPath: pathExists(d1RankedCandidatesPath) ? d1RankedCandidatesPath : "",
    d2ExecutionAuditPath: pathExists(d2ExecutionAuditPath) ? d2ExecutionAuditPath : "",
    d1LockboxRankedCandidatesPath: pathExists(d1LockboxRankedCandidatesPath) ? d1LockboxRankedCandidatesPath : "",
    d2LockboxExecutionAuditPath: pathExists(d2LockboxExecutionAuditPath) ? d2LockboxExecutionAuditPath : "",
    weightsHash:
      String(copiedWeightsHash ?? "").trim() ||
      String(stepD?.weightsHash ?? stepD?.summary?.weightsHash ?? "").trim()
  }
  const artifactManifestPayload = {
    version: "v1",
    generatedAt: new Date().toISOString(),
    mode: normalizedMode || (minimalMode ? "minimal" : "full"),
    artifactTier: stepDArtifactTier,
    includeLogs,
    includeCandidateIndex,
    includeFeaturePack,
    includeOnlineAudit,
    includeLockboxAudit,
    ...copiedArtifacts
  }
  await writeJson(artifactManifestPath, artifactManifestPayload)
  const copiedSummary =
    copiedArtifacts.summaryPath && pathExists(copiedArtifacts.summaryPath)
      ? await readJson(copiedArtifacts.summaryPath, {})
      : null
  const copiedPolicyBundle =
    copiedArtifacts.policyBundlePath && pathExists(copiedArtifacts.policyBundlePath)
      ? await readJson(copiedArtifacts.policyBundlePath, null)
      : null
  if (
    copiedArtifacts.summaryPath &&
    copiedArtifacts.policyStatePath &&
    copiedArtifacts.weightsPath
  ) {
    const rebuiltPolicyBundle = await buildStepDPolicyBundle({
      runId:
        String(copiedSummary?.runId ?? "").trim() ||
        String(stepD?.summary?.runId ?? "").trim() ||
        null,
      summaryPath: copiedArtifacts.summaryPath,
      policyStatePath: copiedArtifacts.policyStatePath,
      weightsPath: copiedArtifacts.weightsPath,
      artifactManifestPath,
      sampledDebugPath: copiedArtifacts.sampledDebugPath || null,
      d1RankedCandidatesPath: copiedArtifacts.d1RankedCandidatesPath || null,
      d2ExecutionAuditPath: copiedArtifacts.d2ExecutionAuditPath || null,
      d1LockboxRankedCandidatesPath: copiedArtifacts.d1LockboxRankedCandidatesPath || null,
      d2LockboxExecutionAuditPath: copiedArtifacts.d2LockboxExecutionAuditPath || null,
      policyContract: copiedPolicyBundle?.policyContract ?? copiedSummary?.policyContract ?? null,
      policyFingerprint:
        copiedPolicyBundle?.policyFingerprint ??
        copiedSummary?.policyFingerprint ??
        stepD?.policyFingerprint ??
        null,
      lineageKey: copiedPolicyBundle?.lineageKey ?? null
    })
    await writeStepDPolicyBundle({
      bundlePath: policyBundlePath,
      bundle: rebuiltPolicyBundle
    })
    copiedArtifacts.policyBundlePath = pathExists(policyBundlePath) ? policyBundlePath : ""
  }
  if (copiedSummary && typeof copiedSummary === "object") {
    copiedSummary.weightsHash = copiedArtifacts.weightsHash
    copiedSummary.artifactManifestPath = artifactManifestPath
    copiedSummary.policyBundlePath = pathExists(policyBundlePath) ? policyBundlePath : ""
    copiedSummary.policyBundleHash = await hashFileSha1(policyBundlePath)
    copiedSummary.d1RankedCandidatesPath = copiedArtifacts.d1RankedCandidatesPath
    copiedSummary.d2ExecutionAuditPath = copiedArtifacts.d2ExecutionAuditPath
    copiedSummary.d1LockboxRankedCandidatesPath = copiedArtifacts.d1LockboxRankedCandidatesPath
    copiedSummary.d2LockboxExecutionAuditPath = copiedArtifacts.d2LockboxExecutionAuditPath
    await writeJson(summaryPath, copiedSummary)
  }
  await writeJson(artifactManifestPath, {
    ...artifactManifestPayload,
    policyBundlePath: copiedArtifacts.policyBundlePath
  })
  return {
    ...copiedArtifacts,
    artifactManifestPath
  }
}

const normalizeStepDExecutionProfile = (raw, fallback = "FULL_AUDIT") => {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (text === "fast_online") return "FAST_ONLINE"
  if (text === "lockbox_audit_only") return "LOCKBOX_AUDIT_ONLY"
  if (text === "full_audit") return "FULL_AUDIT"
  return fallback
}

const resolveCdLoopEpochStepDExecutionProfile = (ctx) => {
  const stepDLightCfg = ctx?.config?.lightweight?.stepD ?? {}
  const configured = normalizeStepDExecutionProfile(stepDLightCfg?.executionProfile, "FULL_AUDIT")
  const epochRaw = String(stepDLightCfg?.cdLoopEpochExecutionProfile ?? "inherit")
    .trim()
    .toLowerCase()
  if (epochRaw === "inherit") return configured
  return normalizeStepDExecutionProfile(epochRaw, configured)
}

const runStepDWithExecutionProfile = async ({
  ctx,
  profile,
  prepareLockboxDuringStepDOverride = undefined
}) => {
  const desiredProfile = normalizeStepDExecutionProfile(profile, "FULL_AUDIT")
  ctx.__runtime = ctx.__runtime ?? {}
  const prev = ctx.__runtime?.stepDExecutionProfileOverride
  const prevPrepareLockbox = ctx.__runtime?.stepDPrepareLockboxDuringStepDOverride
  ctx.__runtime.stepDExecutionProfileOverride = desiredProfile
  if (prepareLockboxDuringStepDOverride === undefined) {
    delete ctx.__runtime.stepDPrepareLockboxDuringStepDOverride
  } else {
    ctx.__runtime.stepDPrepareLockboxDuringStepDOverride =
      prepareLockboxDuringStepDOverride === true
  }
  try {
    return await runStepDTrainOnlinePolicy(ctx)
  } finally {
    if (prev === undefined) {
      delete ctx.__runtime.stepDExecutionProfileOverride
    } else {
      ctx.__runtime.stepDExecutionProfileOverride = prev
    }
    if (prevPrepareLockbox === undefined) {
      delete ctx.__runtime.stepDPrepareLockboxDuringStepDOverride
    } else {
      ctx.__runtime.stepDPrepareLockboxDuringStepDOverride = prevPrepareLockbox
    }
  }
}

const clearStepDRuntimeCaches = async (ctx) => {
  ctx.__runtime = ctx.__runtime ?? {}
  const cachedWorkerPool = ctx.__runtime?.stepDWorkerPool?.pool
  if (cachedWorkerPool && typeof cachedWorkerPool.close === "function") {
    await cachedWorkerPool.close().catch(() => {})
  }
  const runtimeKeys = [
    "stepDWorkerPool",
    "stepDCache",
    "stepDEBase",
    "stepDDecisionCandidatesByDate",
    "stepDFeaturePackLookupByDate",
    "stepDLockboxArtifacts",
    "validatedTradeOutcomeLookupCache",
    "validatedTradeReplayFeedbackDaysCache",
    "validatedTradeReplaySeedCache"
  ]
  for (const key of runtimeKeys) {
    if (Object.prototype.hasOwnProperty.call(ctx.__runtime, key)) {
      delete ctx.__runtime[key]
    }
  }
}

const buildStepDResultFromRunDir = async ({ runDir }) => {
  const stepDDir = path.join(runDir, "step-d")
  const summaryPath = path.join(stepDDir, "step_d_summary.json")
  const logsPath = path.join(stepDDir, "daily_online_logs.jsonl")
  const weightsPath = path.join(stepDDir, "weights_final.json")
  const sampledDebugPath = path.join(stepDDir, "sampled_debug_eval_top5.jsonl")
  const policyStatePath = path.join(stepDDir, "step_d_policy_state.json")
  const policyBundlePath = path.join(stepDDir, "step_d_policy_bundle.json")
  const artifactManifestPath = path.join(stepDDir, "step_d_artifact_manifest.json")
  const candidateIndexPath = path.join(stepDDir, "decision_candidates_index.jsonl")
  const candidateIndexMetaPath = path.join(stepDDir, "decision_candidates_index_meta.json")
  const featurePackPath = path.join(stepDDir, "decision_candidates_feature_pack.jsonl")
  const featurePackMetaPath = path.join(stepDDir, "decision_candidates_feature_pack_meta.json")
  const d1RankedCandidatesPath = path.join(stepDDir, "d1_ranked_candidates.jsonl")
  const d2ExecutionAuditPath = path.join(stepDDir, "d2_execution_audit.jsonl")
  const d1LockboxRankedCandidatesPath = path.join(stepDDir, "d1_lockbox_ranked_candidates.jsonl")
  const d2LockboxExecutionAuditPath = path.join(stepDDir, "d2_lockbox_execution_audit.jsonl")
  const summary = await readJson(summaryPath, null)
  if (!summary) {
    throw new Error(`STEP_D_SUMMARY_MISSING:${summaryPath}`)
  }
  return {
    step: "D",
    summaryPath,
    logsPath: pathExists(logsPath) ? logsPath : "",
    weightsPath,
    sampledDebugPath: pathExists(sampledDebugPath) ? sampledDebugPath : "",
    policyStatePath,
    policyBundlePath: pathExists(policyBundlePath) ? policyBundlePath : "",
    artifactManifestPath: pathExists(artifactManifestPath) ? artifactManifestPath : "",
    candidateIndexPath: pathExists(candidateIndexPath) ? candidateIndexPath : "",
    candidateIndexMetaPath: pathExists(candidateIndexMetaPath) ? candidateIndexMetaPath : "",
    featurePackPath: pathExists(featurePackPath) ? featurePackPath : "",
    featurePackMetaPath: pathExists(featurePackMetaPath) ? featurePackMetaPath : "",
    d1RankedCandidatesPath: pathExists(d1RankedCandidatesPath) ? d1RankedCandidatesPath : "",
    d2ExecutionAuditPath: pathExists(d2ExecutionAuditPath) ? d2ExecutionAuditPath : "",
    d1LockboxRankedCandidatesPath: pathExists(d1LockboxRankedCandidatesPath)
      ? d1LockboxRankedCandidatesPath
      : "",
    d2LockboxExecutionAuditPath: pathExists(d2LockboxExecutionAuditPath)
      ? d2LockboxExecutionAuditPath
      : "",
    weightsHash: String(summary?.weightsHash ?? "").trim(),
    summary
  }
}

const canReuseFastEpochOnlineArtifacts = (stepD) => {
  const profile = normalizeStepDExecutionProfile(
    stepD?.summary?.stepDExecutionProfile ?? stepD?.stepDExecutionProfile,
    "FULL_AUDIT",
  )
  if (profile !== "FAST_ONLINE") return false
  return [
    stepD?.summaryPath,
    stepD?.weightsPath,
    stepD?.policyStatePath,
    stepD?.policyBundlePath,
    stepD?.d1RankedCandidatesPath,
    stepD?.d2ExecutionAuditPath
  ].every((it) => pathExists(String(it ?? "").trim()))
}

const buildFullMaterializeCacheInfo = async ({
  ctx,
  payload,
  sourceRunId
}) => {
  const safeSourceRunId = String(sourceRunId ?? "").trim()
  const sourceRunDir = path.join(ctx.cwd, "artifacts", "runs", safeSourceRunId)
  const sourceStepCDir = path.join(sourceRunDir, "step-c")
  const sourceStepC0Dir = path.join(sourceRunDir, "step-c0")
  const sourceStepC1Dir = path.join(sourceRunDir, "step-c1")
  const sourceStepC2Dir = path.join(sourceRunDir, "step-c2")
  const sourceStepBDir = path.join(sourceRunDir, "step-b")
  const codeHashes = {}
  for (const relPath of FULL_MATERIALIZE_CACHE_CODE_PATHS) {
    codeHashes[relPath] = await hashFileSha1(path.join(ctx.cwd, relPath))
  }
  const keyPayload = {
    version: FULL_MATERIALIZE_CACHE_VERSION,
    configHash: await hashFileSha1(ctx.configPath),
    sourceRunId: safeSourceRunId,
    payload: clonePlain(payload),
    sourceArtifacts: {
      stepCPatternHash: await hashFileSha1(path.join(sourceStepCDir, "pattern_library.json")),
      stepCRuntimeHash: await hashFileSha1(path.join(sourceStepCDir, "pattern_library_runtime.json")),
      stepCSummaryHash: await hashFileSha1(path.join(sourceStepCDir, "step_c_summary.json")),
      stepC0SummaryHash: await hashFileSha1(path.join(sourceStepC0Dir, "c0_summary.json")),
      stepC1IndexHash: await hashFileSha1(path.join(sourceStepC1Dir, "c1_family_probe_index.json")),
      stepC1ResultsHash: await hashFileSha1(path.join(sourceStepC1Dir, "c1_family_probe_results.jsonl")),
      stepC1SummaryHash: await hashFileSha1(path.join(sourceStepC1Dir, "c1_summary.json")),
      stepC2IndexHash: await hashFileSha1(path.join(sourceStepC2Dir, "c2_dedup_index.json")),
      stepC2GroupsHash: await hashFileSha1(path.join(sourceStepC2Dir, "c2_dedup_groups.jsonl")),
      stepC2SummaryHash: await hashFileSha1(path.join(sourceStepC2Dir, "c2_summary.json")),
      stepBSummaryHash: await hashFileSha1(path.join(sourceStepBDir, "step_b_summary.json")),
      startWeightsHash: await hashFileSha1(String(payload?.startWeightsPath ?? "").trim())
    },
    codeHashes
  }
  const key = hashTextSha1(JSON.stringify(keyPayload))
  const cacheDir = path.join(ctx.cwd, "artifacts", "cache", "stepd_full_materialize", key)
  return {
    key,
    keyPayload,
    cacheDir,
    metaPath: path.join(cacheDir, "cache_meta.json")
  }
}

const isFullMaterializeCacheUsable = async ({ cacheInfo }) => {
  if (!cacheInfo?.cacheDir || !pathExists(cacheInfo.cacheDir)) return false
  if (!pathExists(path.join(cacheInfo.cacheDir, "step-d", "step_d_summary.json"))) return false
  if (!pathExists(path.join(cacheInfo.cacheDir, "step-d", "d1_lockbox_ranked_candidates.jsonl"))) return false
  if (!pathExists(path.join(cacheInfo.cacheDir, "step-d", "d2_lockbox_execution_audit.jsonl"))) return false
  const meta = await readJson(cacheInfo.metaPath, null)
  if (!meta || typeof meta !== "object") return false
  return String(meta?.key ?? "").trim() === String(cacheInfo.key ?? "").trim()
}

const persistFullMaterializeCache = async ({
  cacheInfo,
  materializeRunDir,
  payload
}) => {
  if (!cacheInfo?.cacheDir || !materializeRunDir) return
  await fsp.rm(cacheInfo.cacheDir, { recursive: true, force: true })
  await ensureDir(cacheInfo.cacheDir)
  const sourceStepDDir = path.join(materializeRunDir, "step-d")
  if (!pathExists(sourceStepDDir)) {
    throw new Error(`FULL_MATERIALIZE_CACHE_SOURCE_MISSING:${sourceStepDDir}`)
  }
  await fsp.cp(sourceStepDDir, path.join(cacheInfo.cacheDir, "step-d"), {
    recursive: true,
    force: true
  })
  for (const dirName of ["step-b", "step-c", "step-c0", "step-c1", "step-c2"]) {
    const sourceDir = path.join(materializeRunDir, dirName)
    if (!pathExists(sourceDir)) continue
    await fsp.cp(sourceDir, path.join(cacheInfo.cacheDir, dirName), {
      recursive: true,
      force: true
    })
  }
  await writeJson(cacheInfo.metaPath, {
    version: FULL_MATERIALIZE_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    key: cacheInfo.key,
    payload: clonePlain(payload),
    keyPayload: cacheInfo.keyPayload
  })
}

const shellQuote = (value) => `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`

const runStepDMaterializeSubprocess = async ({
  ctx,
  payload,
  outDir,
  executionProfile = "full_audit"
}) => {
  const normalizedExecutionProfile = normalizeStepDExecutionProfile(executionProfile, "FULL_AUDIT")
  const executionProfileFlag =
    normalizedExecutionProfile === "LOCKBOX_AUDIT_ONLY"
      ? "lockbox_audit_only"
      : "full_audit"
  const materializeRunId = `${ctx.runId}__fullmat__${path.basename(path.dirname(outDir))}_${path.basename(outDir)}`
  const materializeRunDir = path.join(ctx.cwd, "artifacts", "runs", materializeRunId)
  const payloadPath = path.join(outDir, "step_d_full_materialize.payload.json")
  const configPath = path.join(outDir, "step_d_full_materialize.config.json")
  const logPath = path.join(outDir, "step_d_full_materialize.log")
  const sourceRunId = String(payload?.sourceRunId ?? ctx.runId ?? "").trim()
  const sourceRunDir = path.join(ctx.cwd, "artifacts", "runs", sourceRunId)
  const sourceStepCDir = path.join(sourceRunDir, "step-c")
  const sourceStepC0Dir = path.join(sourceRunDir, "step-c0")
  const sourceStepC1Dir = path.join(sourceRunDir, "step-c1")
  const sourceStepC2Dir = path.join(sourceRunDir, "step-c2")
  const sourceStepBDir = path.join(sourceRunDir, "step-b")
  const materializeBaseConfig = await readJson(ctx.configPath, ctx.config ?? {})
  const materializeConfig = clonePlain(materializeBaseConfig ?? {})
  materializeConfig.decisionGate = {
    ...(materializeConfig?.decisionGate ?? {}),
    minScoreMargin: Number(
      payload?.minScoreMargin ??
      materializeConfig?.decisionGate?.minScoreMargin ??
      0,
    ),
    maxScoreMargin: Number(
      payload?.maxScoreMargin ??
      materializeConfig?.decisionGate?.maxScoreMargin ??
      0,
    ),
    secondPick: clonePlain(
      payload?.secondPickGate ?? materializeConfig?.decisionGate?.secondPick ?? {},
    )
  }
  if (payload?.inversionAdjust && typeof payload.inversionAdjust === "object") {
    materializeConfig.decisionGate.inversionAdjust = clonePlain(payload.inversionAdjust)
  }
  materializeConfig.onlineLearning = {
    ...(materializeConfig?.onlineLearning ?? {}),
    startWeightsPath: String(
      payload?.startWeightsPath ??
      materializeConfig?.onlineLearning?.startWeightsPath ??
      "",
    )
  }
  materializeConfig.lightweight = {
    ...(materializeConfig?.lightweight ?? {}),
    stepD: {
      ...(materializeConfig?.lightweight?.stepD ?? {}),
      executionProfile: executionProfileFlag,
      prepareLockboxDuringStepD: true,
      sampledDebugLog: {
        ...(materializeConfig?.lightweight?.stepD?.sampledDebugLog ?? {}),
        enabled: true
      }
    }
  }
  await writeJson(payloadPath, payload)
  await writeJson(configPath, materializeConfig)
  await clearStepDRuntimeCaches(ctx)
  const command = [
    "set -euo pipefail",
    `rm -rf ${shellQuote(materializeRunDir)}`,
    `mkdir -p ${shellQuote(materializeRunDir)}`,
    `cp -a ${shellQuote(sourceStepCDir)} ${shellQuote(path.join(materializeRunDir, "step-c"))}`,
    `[ ! -d ${shellQuote(sourceStepC0Dir)} ] || cp -a ${shellQuote(sourceStepC0Dir)} ${shellQuote(path.join(materializeRunDir, "step-c0"))}`,
    `[ ! -d ${shellQuote(sourceStepC1Dir)} ] || cp -a ${shellQuote(sourceStepC1Dir)} ${shellQuote(path.join(materializeRunDir, "step-c1"))}`,
    `[ ! -d ${shellQuote(sourceStepC2Dir)} ] || cp -a ${shellQuote(sourceStepC2Dir)} ${shellQuote(path.join(materializeRunDir, "step-c2"))}`,
    `[ ! -d ${shellQuote(sourceStepBDir)} ] || cp -a ${shellQuote(sourceStepBDir)} ${shellQuote(path.join(materializeRunDir, "step-b"))}`,
    [
      shellQuote(process.execPath),
      "--max-old-space-size=4096",
      "src/cli.mjs",
      "step-d",
      `--config=${shellQuote(configPath)}`,
      `--run-id=${shellQuote(materializeRunId)}`,
      `--stepd-execution-profile=${executionProfileFlag}`,
      "--stepd-prepare-lockbox=true",
      `>${shellQuote(logPath)} 2>&1`
    ].join(" ")
  ].join(" && ")
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.cwd,
      stdio: "ignore",
      env: process.env
    })
    child.once("error", reject)
    child.once("close", (code) => resolve(Number(code ?? 1)))
  })
  if (exitCode !== 0) {
    const raw = await fsp.readFile(logPath, "utf8").catch(() => "")
    const tail = raw.split(/\r?\n/).slice(-80).join("\n")
    throw new Error(
      `STEP_D_FULL_MATERIALIZE_SUBPROCESS_FAILED:${exitCode}:log=${logPath}\n${tail}`,
    )
  }
  return {
    payloadPath,
    configPath,
    logPath,
    materializeRunId,
    materializeRunDir,
    stepD: await buildStepDResultFromRunDir({ runDir: materializeRunDir })
  }
}

const materializeFullStepDArtifacts = async ({
  ctx,
  cfg,
  acceptedBaselineRecord = null,
  round,
  epoch = null,
  outDir,
  baseStepD = null,
  startWeightsPath,
  minScoreMargin,
  maxScoreMargin,
  secondPickGate,
  inversionState
}) => {
  const inversionAdjust = {
    enabled: inversionState?.enabled === true,
    maxSwapMargin: Number(cfg?.inversion?.maxSwapMargin ?? 0.02),
    secondBoost: Number(inversionState?.secondBoost ?? 0),
    qualityWeight: Number(cfg?.inversion?.qualityWeight ?? 0.04)
  }
  const materializePayload = {
    sourceRunId: ctx.runId,
    startWeightsPath: String(startWeightsPath ?? ""),
    minScoreMargin,
    maxScoreMargin,
    secondPickGate: clonePlain(secondPickGate),
    inversionAdjust
  }
  const cacheInfo = await buildFullMaterializeCacheInfo({
    ctx,
    payload: materializePayload,
    sourceRunId: ctx.runId
  })
  const reusedFastOnlineBase = canReuseFastEpochOnlineArtifacts(baseStepD)
  let materialized = null
  let stepD = null
  let fullMaterializeCacheHit = false
  if (reusedFastOnlineBase) {
    const baseCopiedArtifacts = await copyStepDArtifactsForStepE({
      stepD: baseStepD,
      outDir,
      mode: "online_audit"
    })
    materialized = await runStepDMaterializeSubprocess({
      ctx,
      payload: materializePayload,
      outDir,
      executionProfile: "lockbox_audit_only"
    })
    const baseSummary =
      (baseCopiedArtifacts.summaryPath && pathExists(baseCopiedArtifacts.summaryPath))
        ? await readJson(baseCopiedArtifacts.summaryPath, baseStepD?.summary ?? null)
        : (baseStepD?.summary ?? null)
    const materializedSummary =
      materialized?.stepD?.summaryPath && pathExists(materialized.stepD.summaryPath)
        ? await readJson(materialized.stepD.summaryPath, materialized?.stepD?.summary ?? null)
        : (materialized?.stepD?.summary ?? null)
    const combinedSummary =
      baseSummary && typeof baseSummary === "object"
        ? { ...baseSummary }
        : {}
    if (materializedSummary && typeof materializedSummary === "object") {
      combinedSummary.stepDMode = "ONLINE_PLUS_LOCKBOX"
      combinedSummary.stepDExecutionProfile = "FULL_AUDIT"
      combinedSummary.lockboxArtifactCache =
        materializedSummary.lockboxArtifactCache ?? combinedSummary.lockboxArtifactCache
      combinedSummary.lockboxCoverageRecovery =
        materializedSummary.lockboxCoverageRecovery ?? combinedSummary.lockboxCoverageRecovery
      combinedSummary.lockboxScoringTelemetry =
        materializedSummary.lockboxScoringTelemetry ?? combinedSummary.lockboxScoringTelemetry
      combinedSummary.lockboxSelectionFunnel =
        materializedSummary.lockboxSelectionFunnel ?? combinedSummary.lockboxSelectionFunnel
      combinedSummary.lockboxDayTypeRouter =
        materializedSummary.lockboxDayTypeRouter ?? combinedSummary.lockboxDayTypeRouter
      combinedSummary.d1LockboxRankedCandidatesRows =
        Number(materializedSummary.d1LockboxRankedCandidatesRows ?? 0) || 0
      combinedSummary.d2LockboxExecutionAuditRows =
        Number(materializedSummary.d2LockboxExecutionAuditRows ?? 0) || 0
    }
    combinedSummary.d1LockboxRankedCandidatesPath =
      String(materialized?.stepD?.d1LockboxRankedCandidatesPath ?? "").trim()
    combinedSummary.d2LockboxExecutionAuditPath =
      String(materialized?.stepD?.d2LockboxExecutionAuditPath ?? "").trim()
    if (baseCopiedArtifacts.summaryPath) {
      await writeJson(baseCopiedArtifacts.summaryPath, combinedSummary)
    }
    stepD = {
      ...baseStepD,
      summaryPath: baseCopiedArtifacts.summaryPath,
      logsPath: baseCopiedArtifacts.logsPath,
      weightsPath: baseCopiedArtifacts.weightsPath,
      sampledDebugPath: baseCopiedArtifacts.sampledDebugPath,
      policyStatePath: baseCopiedArtifacts.policyStatePath,
      policyBundlePath: baseCopiedArtifacts.policyBundlePath,
      artifactManifestPath: baseCopiedArtifacts.artifactManifestPath,
      candidateIndexPath: baseCopiedArtifacts.candidateIndexPath,
      candidateIndexMetaPath: baseCopiedArtifacts.candidateIndexMetaPath,
      featurePackPath: baseCopiedArtifacts.featurePackPath,
      featurePackMetaPath: baseCopiedArtifacts.featurePackMetaPath,
      d1RankedCandidatesPath: baseCopiedArtifacts.d1RankedCandidatesPath,
      d2ExecutionAuditPath: baseCopiedArtifacts.d2ExecutionAuditPath,
      d1LockboxRankedCandidatesPath: materialized.stepD.d1LockboxRankedCandidatesPath,
      d2LockboxExecutionAuditPath: materialized.stepD.d2LockboxExecutionAuditPath,
      weightsHash: baseCopiedArtifacts.weightsHash,
      summary: combinedSummary
    }
  } else if (await isFullMaterializeCacheUsable({ cacheInfo })) {
    stepD = await buildStepDResultFromRunDir({ runDir: cacheInfo.cacheDir })
    fullMaterializeCacheHit = true
  } else {
    materialized = await runStepDMaterializeSubprocess({
      ctx,
      payload: materializePayload,
      outDir
    })
    stepD = materialized.stepD
    await persistFullMaterializeCache({
      cacheInfo,
      materializeRunDir: materialized.materializeRunDir,
      payload: materializePayload
    })
  }
  const metrics = summarizeEpoch({
    stepDSummary: stepD.summary,
    cfg
  })
  const copiedArtifacts = await copyStepDArtifactsForStepE({
    stepD,
    outDir,
    mode: "full"
  })
  const {
    weightsHash,
    policyFingerprint
  } = await resolveNoOpPolicyArtifacts({
    stepDSummary: stepD?.summary,
    sampledDebugPath: copiedArtifacts.sampledDebugPath,
    weightsPath: copiedArtifacts.weightsPath,
    stage: "epoch-full-materialize",
    round,
    epoch,
    requireSampledDebug: cfg?.noOpPolicy?.requireSampledDebug !== false
  })
  return {
    stepD,
    metrics,
    startWeightsPath: String(startWeightsPath ?? ""),
    stepDExecutionProfile: reusedFastOnlineBase
      ? "FULL_AUDIT"
      : String(stepD?.summary?.stepDExecutionProfile ?? "FULL_AUDIT"),
    weightsHash,
    policyFingerprint,
    fullMaterializeCacheHit,
    fullMaterializeCacheKey: cacheInfo.key,
    fullMaterializeCacheDir: cacheInfo.cacheDir,
    fullMaterializePayloadPath: materialized?.payloadPath ?? null,
    fullMaterializeLogPath: materialized?.logPath ?? null,
    fullMaterializeRunId: materialized?.materializeRunId ?? null,
    fullMaterializeRunDir: materialized?.materializeRunDir ?? null,
    ...copiedArtifacts
  }
}

const runChampionStepELockbox = async ({
  ctx,
  loopDir,
  champion
}) => {
  if (!champion) {
    return {
      executed: false,
      error: "NO_CHAMPION",
      lockboxRunDir: ""
    }
  }
  const lockboxRunDir = path.join(loopDir, "lockbox-eval", String(champion.roundTag ?? "r00"))
  const stepCDir = path.join(lockboxRunDir, "step-c")
  const stepC0Dir = path.join(lockboxRunDir, "step-c0")
  const stepC1Dir = path.join(lockboxRunDir, "step-c1")
  const stepC2Dir = path.join(lockboxRunDir, "step-c2")
  await ensureDir(stepCDir)
  await ensureDir(stepC0Dir)
  await ensureDir(stepC1Dir)
  await ensureDir(stepC2Dir)

  const cTag = String(champion?.cTag ?? "").trim()
  const cSnapshotDir = cTag ? path.join(loopDir, cTag) : ""
  if (cSnapshotDir) {
    await copyIfExists(path.join(cSnapshotDir, "pattern_library.json"), path.join(stepCDir, "pattern_library.json"))
    await copyIfExists(
      path.join(cSnapshotDir, "pattern_library_runtime.json"),
      path.join(stepCDir, "pattern_library_runtime.json"),
    )
    await copyIfExists(path.join(cSnapshotDir, "step_c_summary.json"), path.join(stepCDir, "step_c_summary.json"))
    await copyIfExists(
      path.join(cSnapshotDir, "step_c_index_manifest.json"),
      path.join(stepCDir, "step_c_index_manifest.json"),
    )
    await copyIfExists(
      path.join(cSnapshotDir, "step_c_shaping_state.json"),
      path.join(stepCDir, "step_c_shaping_state.json"),
    )
    await copyIfExists(path.join(cSnapshotDir, "c0_family_index.json"), path.join(stepC0Dir, "c0_family_index.json"))
    await copyIfExists(
      path.join(cSnapshotDir, "c0_family_membership.jsonl"),
      path.join(stepC0Dir, "c0_family_membership.jsonl"),
    )
    await copyIfExists(path.join(cSnapshotDir, "c0_summary.json"), path.join(stepC0Dir, "c0_summary.json"))
    await copyIfExists(
      path.join(cSnapshotDir, "c1_family_probe_index.json"),
      path.join(stepC1Dir, "c1_family_probe_index.json"),
    )
    await copyIfExists(
      path.join(cSnapshotDir, "c1_family_probe_results.jsonl"),
      path.join(stepC1Dir, "c1_family_probe_results.jsonl"),
    )
    await copyIfExists(path.join(cSnapshotDir, "c1_summary.json"), path.join(stepC1Dir, "c1_summary.json"))
    await copyIfExists(
      path.join(cSnapshotDir, "c2_dedup_index.json"),
      path.join(stepC2Dir, "c2_dedup_index.json"),
    )
    await copyIfExists(
      path.join(cSnapshotDir, "c2_dedup_groups.jsonl"),
      path.join(stepC2Dir, "c2_dedup_groups.jsonl"),
    )
    await copyIfExists(path.join(cSnapshotDir, "c2_summary.json"), path.join(stepC2Dir, "c2_summary.json"))
  }
  const artifactManifestPath = String(champion?.artifactManifestPath ?? "").trim()
  if (!artifactManifestPath || !pathExists(artifactManifestPath)) {
    return {
      executed: false,
      error: "STEP_D_ARTIFACT_MANIFEST_MISSING",
      lockboxRunDir: ""
    }
  }
  const artifactManifest = await readJson(artifactManifestPath, null)
  const requiredArtifactPaths = [
    "summaryPath",
    "weightsPath",
    "policyStatePath",
    "policyBundlePath",
    "d1RankedCandidatesPath",
    "d2ExecutionAuditPath",
    "d1LockboxRankedCandidatesPath",
    "d2LockboxExecutionAuditPath"
  ]
  const optionalArtifactPaths = [
    "logsPath",
    "sampledDebugPath",
    "candidateIndexPath",
    "candidateIndexMetaPath",
    "featurePackPath",
    "featurePackMetaPath"
  ]
  const stepDArtifacts = {}
  for (const key of requiredArtifactPaths) {
    const src = String(artifactManifest?.[key] ?? "").trim()
    if (!src || !pathExists(src)) {
      return {
        executed: false,
        error: `STEP_D_ARTIFACT_MISSING:${key}`,
        lockboxRunDir: ""
      }
    }
    stepDArtifacts[key] = src
  }
  for (const key of optionalArtifactPaths) {
    const src = String(artifactManifest?.[key] ?? "").trim()
    stepDArtifacts[key] = src && pathExists(src) ? src : ""
  }
  stepDArtifacts.weightsHash = String(artifactManifest?.weightsHash ?? "").trim()
  const copiedArtifacts = await copyStepDArtifactsForStepE({
    stepD: stepDArtifacts,
    outDir: lockboxRunDir,
    mode: "full"
  })
  const preflightChampionBundle = await buildChampionBundle({
    bundlePath: path.join(lockboxRunDir, "champion_bundle.json"),
    lineageKey: ctx?.__runtime?.lineageKey ?? null,
    abRunId: ctx?.abRunId ?? null,
    runId: ctx.runId,
    sessionId: path.basename(loopDir),
    champion: {
      ...champion,
      policyBundlePath: copiedArtifacts.policyBundlePath,
      stepC0FamilyIndexPath: path.join(stepC0Dir, "c0_family_index.json"),
      stepC0MembershipPath: path.join(stepC0Dir, "c0_family_membership.jsonl"),
      stepC0SummaryPath: path.join(stepC0Dir, "c0_summary.json"),
      stepC1IndexPath: path.join(stepC1Dir, "c1_family_probe_index.json"),
      stepC1ResultsPath: path.join(stepC1Dir, "c1_family_probe_results.jsonl"),
      stepC1SummaryPath: path.join(stepC1Dir, "c1_summary.json"),
      stepC2IndexPath: path.join(stepC2Dir, "c2_dedup_index.json"),
      stepC2GroupsPath: path.join(stepC2Dir, "c2_dedup_groups.jsonl"),
      stepC2SummaryPath: path.join(stepC2Dir, "c2_summary.json"),
      stepCLibraryPath: path.join(stepCDir, "pattern_library.json"),
      stepCRuntimePath: path.join(stepCDir, "pattern_library_runtime.json"),
      stepCSummaryPath: path.join(stepCDir, "step_c_summary.json"),
      stepCIndexManifestPath: path.join(stepCDir, "step_c_index_manifest.json"),
      stepCShapingStatePath: path.join(stepCDir, "step_c_shaping_state.json"),
      d1RankedCandidatesPath: copiedArtifacts.d1RankedCandidatesPath,
      d2ExecutionAuditPath: copiedArtifacts.d2ExecutionAuditPath,
      d1LockboxRankedCandidatesPath: copiedArtifacts.d1LockboxRankedCandidatesPath,
      d2LockboxExecutionAuditPath: copiedArtifacts.d2LockboxExecutionAuditPath
    },
    lockboxSummaryPath: null
  })

  const stepECtx = {
    ...ctx,
    runId: `${ctx.runId}_lockbox_${String(champion.roundTag ?? "r00")}`,
    runDir: lockboxRunDir,
    __runtime: {
      ...(ctx.__runtime ?? {}),
      championBundle: preflightChampionBundle
    }
  }
  try {
    const stepE = await runStepE(stepECtx)
    const summaryPath = String(stepE?.summaryPath ?? path.join(lockboxRunDir, "step-e", "step_e_summary.json"))
    const summary = await readJson(summaryPath, null)
    return {
      executed: true,
      lockboxRunDir,
      summaryPath,
      summary
    }
  } catch (error) {
    return {
      executed: false,
      lockboxRunDir,
      error: String(error?.message ?? error),
      summaryPath: path.join(lockboxRunDir, "step-e", "step_e_summary.json")
    }
  }
}

const summarizeEpoch = ({ stepDSummary, cfg }) => {
  const summary = stepDSummary ?? {}
  const promotionView = summary?.promotionView ?? {}
  const promotionSource = String(promotionView?.source ?? "ALL").trim().toUpperCase()
  const useUpdatePrimaryBySource = promotionSource === "UPDATE" || promotionSource === "TUNE"
  const useEvalPrimaryBySource = promotionSource === "EVAL"
  const tradingDaysAll = Math.max(0, Number(summary?.tradingDays ?? 0) || 0)
  const tradingDaysEval = Math.max(
    0,
    Number(summary?.generalization?.evalDays ?? summary?.uvSplit?.evalDays ?? 0) || 0,
  )
  const tradingDaysUpdate = Math.max(
    0,
    Number(summary?.generalization?.updateDays ?? summary?.uvSplit?.updateDays ?? 0) || 0,
  )
  const hasEvalSplit = summary?.generalization?.enabled === true || summary?.uvSplit?.enabled === true
  const hasEvalSample = Math.max(0, Number(summary?.pickedCountEval ?? 0) || 0) > 0
  const hasUpdateSample = Math.max(0, Number(summary?.pickedCountUpdate ?? 0) || 0) > 0
  const evalFlag = summary?.promotionView?.useEvalForPromotion === true ||
    summary?.generalization?.useEvalForPromotion === true
  const useEvalPrimary = (useEvalPrimaryBySource && hasEvalSplit && hasEvalSample) || (!useUpdatePrimaryBySource && hasEvalSplit && evalFlag && hasEvalSample)
  const useUpdatePrimary = useUpdatePrimaryBySource && hasUpdateSample
  const tradingDays = useEvalPrimary
    ? Math.max(1, tradingDaysEval)
    : useUpdatePrimary
      ? Math.max(1, tradingDaysUpdate)
      : tradingDaysAll
  const gateReasonCounts = useEvalPrimary
    ? (summary?.gateReasonCountsEval ?? summary?.gateReasonCounts ?? {})
    : useUpdatePrimary
      ? (summary?.gateReasonCountsUpdate ?? summary?.gateReasonCounts ?? {})
    : (summary?.gateReasonCounts ?? {})
  const scopeDiagnostics = summary?.scopeDiagnostics && typeof summary.scopeDiagnostics === "object"
    ? summary.scopeDiagnostics
    : null
  const primaryScopeDiagnostics = useEvalPrimary
    ? scopeDiagnostics?.eval ?? null
    : useUpdatePrimary
      ? scopeDiagnostics?.update ?? null
      : scopeDiagnostics?.all ?? null
  const pickedDays = Math.max(
    0,
    Number(useEvalPrimary ? summary?.pickedDaysEval : useUpdatePrimary ? summary?.pickedDaysUpdate : summary?.pickedDays) || 0,
  )
  const pickHitCount = Math.max(
    0,
    Number(
      promotionView?.pickHitCount ??
      (useEvalPrimary ? summary?.pickHitCountEval : useUpdatePrimary ? summary?.pickHitCountUpdate : summary?.pickHitCount),
    ) || 0,
  )
  const pickedCount = Math.max(
    0,
    Number(
      promotionView?.pickedCount ??
      (useEvalPrimary ? summary?.pickedCountEval : useUpdatePrimary ? summary?.pickedCountUpdate : summary?.pickedCount ?? pickedDays),
    ) || 0,
  )
  const promotionPickedCountFloor = resolvePromotionPickedFloor(cfg)
  const promotionPickedCountCeil = resolvePromotionPickedCeil({
    cfg,
    floor: promotionPickedCountFloor
  })
  const coverageDeficit =
    promotionPickedCountFloor > 0
      ? Math.max(0, (promotionPickedCountFloor - pickedCount) / promotionPickedCountFloor)
      : 0
  const coverageExcess =
    Number.isFinite(promotionPickedCountCeil) && promotionPickedCountCeil > 0
      ? Math.max(0, (pickedCount - promotionPickedCountCeil) / promotionPickedCountCeil)
      : 0
  const pickHitRateLcb95 = clamp01(
    Number(
      promotionView?.pickHitRateLcb95 ??
      (useEvalPrimary
        ? summary?.pickHitRateEvalLcb95 ?? null
        : useUpdatePrimary
          ? summary?.pickHitRateUpdateLcb95 ?? summary?.pickHitRateLcb95 ?? null
          : summary?.pickHitRateLcb95 ?? null),
    ) || wilsonLowerBound({
      success: pickHitCount,
      total: pickedCount
    }),
  )
  const executedCount = Math.max(
    0,
    Number(
      promotionView?.executedCount ??
      (useEvalPrimary ? summary?.executedCountEval : useUpdatePrimary ? summary?.executedCountUpdate : summary?.executedCount),
    ) || 0,
  )
  const executedHitCount = Math.max(
    0,
    Number(
      promotionView?.executedHitCount ??
      (useEvalPrimary ? summary?.executedHitCountEval : useUpdatePrimary ? summary?.executedHitCountUpdate : summary?.executedHitCount),
    ) || 0,
  )
  const executedHitRate = executedCount > 0 ? executedHitCount / executedCount : 0
  const executedHitRateLcb95 = clamp01(
    Number(
      promotionView?.executedHitRateLcb95 ??
      (useEvalPrimary
        ? summary?.executedHitRateEvalLcb95 ?? summary?.executedHitRateLcb95
        : useUpdatePrimary
          ? summary?.executedHitRateUpdateLcb95 ?? summary?.executedHitRateLcb95
          : summary?.executedHitRateLcb95),
    ) || wilsonLowerBound({
      success: executedHitCount,
      total: executedCount
    }),
  )
  const executionCoverage = clamp01(
    Number(
      promotionView?.executionCoverage ??
      (useEvalPrimary
        ? summary?.executionCoverageEval
        : useUpdatePrimary
          ? summary?.executionCoverageUpdate
          : summary?.executionCoverage),
    ) ||
      (pickedCount > 0 ? executedCount / pickedCount : 0),
  )
  const executionRejectedHitDays = Math.max(
    0,
    Number(
      promotionView?.executionRejectedHitDays ??
      (useEvalPrimary
        ? summary?.executionRejectedHitDaysEval ?? summary?.executionRejectedHitDays
        : useUpdatePrimary
          ? summary?.executionRejectedHitDaysUpdate ?? summary?.executionRejectedHitDays
          : summary?.executionRejectedHitDays),
    ) || 0,
  )
  const pickExpectedNetRet3dAvg = Number(summary?.pickExpectedNetRet3dAvg ?? 0) || 0
  const expectedRetBonus = Math.max(-0.05, Math.min(0.05, pickExpectedNetRet3dAvg))
  const promotionQualityScore = Math.max(
    0,
    pickHitRateLcb95 * (1 - coverageDeficit) * (1 - Math.min(1, coverageExcess)) + expectedRetBonus,
  )
  const regimeBreakdown = normalizeRegimeBreakdown(
    useEvalPrimary ? summary?.regimeBreakdownEval ?? summary?.regimeBreakdown : summary?.regimeBreakdown,
  )
  const dualPickDays = Math.max(
    0,
    Number(
      useEvalPrimary
        ? summary?.twoPickDaysEval ?? summary?.dualPickDays ?? summary?.twoPickDays
        : summary?.dualPickDays ?? summary?.twoPickDays,
    ) || 0,
  )
  const onePickDays = Math.max(
    0,
    Number(summary?.onePickDays ?? Math.max(0, pickedDays - dualPickDays)) || 0,
  )
  const noCandidateDays = Math.max(
    0,
    Number(
      useEvalPrimary
        ? summary?.noCandidateDaysEval ?? gateReasonCounts?.NO_CANDIDATE
        : summary?.noCandidateDays ?? gateReasonCounts?.NO_CANDIDATE,
    ) || 0,
  )
  const tradeDaysByGate = Math.max(0, Number(gateReasonCounts?.TRADE ?? pickedDays) || 0)
  const gateRejectedDays = Math.max(0, tradingDays - tradeDaysByGate)
  const oraclePickGoal = Math.max(1, Math.floor(Number(summary?.oraclePickGoal ?? 60) || 60))
  const oracleCandidateDays = Math.max(
    0,
    Math.floor(
      Number(
        useEvalPrimary ? summary?.oracleCandidateDaysEval ?? summary?.oracleCandidateDays : summary?.oracleCandidateDays,
      ) || 0,
    ),
  )
  const oracleHitDaysUniverse = Math.max(
    0,
    Math.floor(
      Number(
        useEvalPrimary ? summary?.oracleHitDaysUniverseEval ?? summary?.oracleHitDaysUniverse : summary?.oracleHitDaysUniverse,
      ) || 0,
    ),
  )
  const oracleHitDaysTopK = Math.max(
    0,
    Math.floor(
      Number(
        useEvalPrimary ? summary?.oracleHitDaysTopKEval ?? summary?.oracleHitDaysTopK : summary?.oracleHitDaysTopK,
      ) || 0,
    ),
  )
  const oracleMissedByTopKDays = Math.max(
    0,
    Math.floor(
      Number(
        useEvalPrimary
          ? summary?.oracleMissedByTopKDaysEval ?? summary?.oracleMissedByTopKDays
          : summary?.oracleMissedByTopKDays,
      ) || 0,
    ),
  )
  const oraclePickGoalFeasible =
    oracleCandidateDays >= oraclePickGoal || summary?.oraclePickGoalFeasible === true
  const oraclePickGoalShortfall = Math.max(
    0,
    Math.floor(Number(summary?.oraclePickGoalShortfall ?? (oraclePickGoal - oracleCandidateDays)) || 0),
  )
  const oracleHitRateUniverse =
    oracleCandidateDays > 0
      ? oracleHitDaysUniverse / oracleCandidateDays
      : Number(summary?.oracleHitRateUniverse ?? 0) || 0
  const oracleHitRateTopK =
    oracleCandidateDays > 0
      ? oracleHitDaysTopK / oracleCandidateDays
      : Number(
        useEvalPrimary ? summary?.oracleHitRateTopKEval ?? summary?.oracleHitRateTopK : summary?.oracleHitRateTopK,
      ) || 0
  const oracleCoverageGap = Math.max(0, oracleHitRateUniverse - oracleHitRateTopK)
  const top1ToOracleConversion = clamp01(
    Number(
      promotionView?.top1ToOracleConversion ??
      (useEvalPrimary ? summary?.top1ToOracleConversionEval : useUpdatePrimary ? summary?.top1ToOracleConversionUpdate : null) ??
        summary?.top1ToOracleConversion ??
        (oracleHitRateTopK > 0 ? (pickedCount > 0 ? pickHitCount / pickedCount : 0) / oracleHitRateTopK : 0),
    ) || 0,
  )
  const budgetedConversion60 = clamp01(
    Number(
      promotionView?.budgetedConversion60 ??
      (useEvalPrimary ? summary?.budgetedConversion60Eval : useUpdatePrimary ? summary?.budgetedConversion60Update : null) ??
        summary?.budgetedConversion60 ??
        summary?.top1ToOracleGoalConversion ??
        top1ToOracleConversion,
    ) || 0,
  )
  const budgetedConversion80 = clamp01(
    Number(
      promotionView?.budgetedConversion80 ??
      (useEvalPrimary ? summary?.budgetedConversion80Eval : useUpdatePrimary ? summary?.budgetedConversion80Update : null) ??
        summary?.budgetedConversion80 ??
        summary?.top1ToOracleGoalConversion ??
        top1ToOracleConversion,
    ) || 0,
  )
  const hitAt1 = clamp01(
    Number(
      promotionView?.hitAt1 ??
      ((useEvalPrimary ? summary?.hitAt1Eval : useUpdatePrimary ? summary?.hitAt1Update : null) ?? summary?.hitAt1 ?? 0),
    ) || 0,
  )
  const hitAt3 = clamp01(
    Number(
      promotionView?.hitAt3 ??
      ((useEvalPrimary ? summary?.hitAt3Eval : useUpdatePrimary ? summary?.hitAt3Update : null) ?? summary?.hitAt3 ?? hitAt1),
    ) || hitAt1,
  )
  const hitAt5 = clamp01(
    Number(
      promotionView?.hitAt5 ??
      ((useEvalPrimary ? summary?.hitAt5Eval : useUpdatePrimary ? summary?.hitAt5Update : null) ?? summary?.hitAt5 ?? hitAt3),
    ) || hitAt3,
  )
  const firstSuccessRankAvg = Math.max(
    0,
    Number(
      promotionView?.firstSuccessRankAvg ??
        (useEvalPrimary ? summary?.firstSuccessRankAvgEval : useUpdatePrimary ? summary?.firstSuccessRankAvgUpdate : null) ??
        summary?.firstSuccessRankAvg ??
        0,
    ) || 0,
  )
  const gateRejectedHitDays = Math.max(
    0,
    Number(
      promotionView?.gateRejectedHitDays ??
        (useEvalPrimary ? summary?.gateRejectedHitDaysEval : useUpdatePrimary ? summary?.gateRejectedHitDaysUpdate : null) ??
        summary?.gateRejectedHitDays ??
        0,
    ) || 0,
  )
  const oracleMaxHitRateAtPickedGoalTopK = Math.max(
    0,
    Number(summary?.oracleMaxHitRateAtPickedGoalTopK ?? 0) || 0,
  )
  const top1ToOracleGoalConversion = clamp01(
    Number(
      summary?.top1ToOracleGoalConversion ??
        (oracleMaxHitRateAtPickedGoalTopK > 0
          ? (pickedCount > 0 ? pickHitCount / pickedCount : 0) / oracleMaxHitRateAtPickedGoalTopK
          : 0),
    ) || 0,
  )
  const recoveryDays = Math.max(0, Number(summary?.coverageRecovery?.days ?? 0) || 0)
  const recoveryHitRate = clamp01(summary?.coverageRecovery?.hitRate ?? 0)
  const recoveryShare = clamp01(
    summary?.coverageRecovery?.share ??
      (pickedDays > 0 ? recoveryDays / pickedDays : 0),
  )
  const swapAppliedRate = clamp01(
    summary?.top1Rerank?.appliedRate ??
      summary?.inversionAdjust?.swapAppliedRate ??
      0,
  )
  const oracleMaxHitsAtPickedGoalUniverse = Math.min(
    Math.max(0, Math.floor(Number(summary?.oracleMaxHitsAtPickedGoalUniverse ?? oracleHitDaysUniverse) || 0)),
    oraclePickGoal,
  )
  const oracleMaxHitsAtPickedGoalTopK = Math.min(
    Math.max(0, Math.floor(Number(summary?.oracleMaxHitsAtPickedGoalTopK ?? oracleHitDaysTopK) || 0)),
    oraclePickGoal,
  )
  const dayHitDays = Math.max(
    0,
    Number(
      useEvalPrimary
        ? summary?.dayHitDaysEval
        : useUpdatePrimary
          ? summary?.dayHitDaysUpdate ?? summary?.dayHitDays
          : summary?.dayHitDays ?? summary?.hitDays ?? 0,
    ) || 0,
  )
  const dayHitRate = pickedDays > 0 ? dayHitDays / pickedDays : 0
  const targetHitsPer20Days = tradingDays > 0 ? (pickHitCount / tradingDays) * 20 : 0
  const stopRate = Number(
    useEvalPrimary
      ? summary?.stopRateEval ?? summary?.stopRate
      : useUpdatePrimary
        ? summary?.stopRateUpdate ?? summary?.stopRate
        : summary?.stopRate,
  ) || 0
  const avgRegret = Number(
    useEvalPrimary
      ? summary?.avgRegretEval ?? summary?.avgRegret
      : useUpdatePrimary
        ? summary?.avgRegretUpdate ?? summary?.avgRegret
        : summary?.avgRegret,
  ) || 0
  const rankLossAvg = Number(
    useEvalPrimary
      ? summary?.rankLossAvgEval ?? summary?.rankLossAvg
      : useUpdatePrimary
        ? summary?.rankLossAvgUpdate ?? summary?.rankLossAvg
        : summary?.rankLossAvg,
  ) || 0
  const lookaheadViolations = Math.max(0, Number(summary?.lookaheadViolations ?? 0) || 0)

  return {
    goalMode: resolveGoalMode(summary?.goalMode),
    positionSemantics: resolvePositionSemantics(summary?.positionSemantics),
    metricScope: useEvalPrimary ? "EVAL" : useUpdatePrimary ? "UPDATE" : "ALL",
    useEvalPrimary,
    useUpdatePrimary,
    tradingDays,
    hitRate: dayHitRate,
    pickedDays,
    hitDays: dayHitDays,
    pickedCount,
    pickHitCount,
    targetHitCount: pickHitCount,
    targetHitRate: pickedCount > 0 ? pickHitCount / pickedCount : 0,
    targetHitsPer20Days,
    stopRate,
    pickHitRate: pickedCount > 0 ? pickHitCount / pickedCount : 0,
    pickHitRateLcb95,
    executedCount,
    executedHitCount,
    executedHitRate,
    executedHitRateLcb95,
    executionCoverage,
    executionRejectedHitDays,
    coverageDeficit,
    coverageExcess,
    promotionQualityScore,
    promotionPickedCountFloor,
    promotionPickedCountCeil: Number.isFinite(promotionPickedCountCeil)
      ? promotionPickedCountCeil
      : 0,
    effectivePromotionPickedCountCeil: Number.isFinite(promotionPickedCountCeil)
      ? promotionPickedCountCeil
      : null,
    pickExpectedNetRet3dSum: Number(summary?.pickExpectedNetRet3dSum ?? 0) || 0,
    pickExpectedNetRet3dAvg,
    hitWindowDays: Math.max(1, Number(summary?.hitWindowDays ?? 1) || 1),
    noCandidateDays,
    noCandidateRate: tradingDays > 0 ? noCandidateDays / tradingDays : 0,
    gateRejectedDays,
    gateRejectedRate: tradingDays > 0 ? gateRejectedDays / tradingDays : 0,
    oraclePickGoal,
    oracleCandidateDays,
    oracleHitDaysUniverse,
    oracleHitDaysTopK,
    oracleMissedByTopKDays,
    oraclePickGoalFeasible,
    oraclePickGoalShortfall,
    oracleHitRateUniverse,
    oracleHitRateTopK,
    top1ToOracleConversion,
    budgetedConversion60,
    budgetedConversion80,
    hitAt1,
    hitAt3,
    hitAt5,
    firstSuccessRankAvg,
    gateRejectedHitDays,
    top1ToOracleGoalConversion,
    oracleCoverageGap,
    oracleMaxHitsAtPickedGoalUniverse,
    oracleMaxHitRateAtPickedGoalUniverse:
      oraclePickGoal > 0 ? oracleMaxHitsAtPickedGoalUniverse / oraclePickGoal : 0,
    oracleMaxHitsAtPickedGoalTopK,
    oracleMaxHitRateAtPickedGoalTopK:
      oraclePickGoal > 0 ? oracleMaxHitsAtPickedGoalTopK / oraclePickGoal : 0,
    avgRegret,
    rankLossAvg,
    lookaheadViolations,
    recoveryDays,
    recoveryShare,
    recoveryHitRate,
    swapAppliedRate,
    gateReasonCounts,
    regimeBreakdown,
    firstPickCount: Math.max(0, Number(summary?.firstPickCount ?? 0) || 0),
    firstPickHitCount: Math.max(0, Number(summary?.firstPickHitCount ?? 0) || 0),
    firstPickHitRate: Number(summary?.firstPickHitRate ?? 0) || 0,
    firstPickExpectedNetRet3dSum: Number(summary?.firstPickExpectedNetRet3dSum ?? 0) || 0,
    firstPickExpectedNetRet3dAvg: Number(summary?.firstPickExpectedNetRet3dAvg ?? 0) || 0,
    secondPickCount: Math.max(0, Number(summary?.secondPickCount ?? 0) || 0),
    secondPickHitCount: Math.max(0, Number(summary?.secondPickHitCount ?? 0) || 0),
    secondPickHitRate: Number(summary?.secondPickHitRate ?? 0) || 0,
    secondPickExpectedNetRet3dSum: Number(summary?.secondPickExpectedNetRet3dSum ?? 0) || 0,
    secondPickExpectedNetRet3dAvg: Number(summary?.secondPickExpectedNetRet3dAvg ?? 0) || 0,
    secondMinusFirstExpectedNetRet3d:
      Number(summary?.secondMinusFirstExpectedNetRet3d ?? 0) || 0,
    onePickDayExpectedNetRet3dAvg: Number(summary?.onePickDayExpectedNetRet3dAvg ?? 0) || 0,
    twoPickDayExpectedNetRet3dAvg: Number(summary?.twoPickDayExpectedNetRet3dAvg ?? 0) || 0,
    twoPickVsOnePickExpectedDayDelta:
      Number(summary?.twoPickVsOnePickExpectedDayDelta ?? 0) || 0,
    onePickDays,
    dualPickDays,
    twoPickDays: dualPickDays,
    secondBeatFirstDays: Math.max(0, Number(summary?.secondBeatFirstDays ?? 0) || 0),
    secondPickGateMode: String(summary?.secondPickGateMode ?? "disabled"),
    secondPickEvaluatedDays: Math.max(0, Number(summary?.secondPickEvaluatedDays ?? 0) || 0),
    secondPickAcceptedDays: Math.max(0, Number(summary?.secondPickAcceptedDays ?? 0) || 0),
    secondPassRate: Number(summary?.secondPassRate ?? 0) || 0,
    secondRejectReasonCounts: summary?.secondRejectReasonCounts ?? {},
    secondShadowRejectReasonCounts: summary?.secondShadowRejectReasonCounts ?? {},
    workerPoolScoreMs: Number(summary?.workerPoolScoreMs ?? 0) || 0,
    candidateIndexSeedsOnline: Math.max(0, Number(summary?.candidateIndexSeedsOnline ?? 0) || 0),
    scoreMsPerSeed:
      Number(summary?.candidateIndexSeedsOnline ?? 0) > 0
        ? (Number(summary?.workerPoolScoreMs ?? 0) || 0) /
          Math.max(1, Number(summary?.candidateIndexSeedsOnline ?? 0))
        : 0,
    promotionContext:
      summary?.promotionContext && typeof summary.promotionContext === "object"
        ? summary.promotionContext
        : {
            source: useEvalPrimary ? "EVAL" : useUpdatePrimary ? "UPDATE" : "ALL",
            primaryScope: useEvalPrimary ? "EVAL" : useUpdatePrimary ? "UPDATE" : "ALL",
            primaryPickedCount: pickedCount,
            primaryPickedDays: pickedDays,
            primaryExecutedCount: executedCount,
            primaryExecutionCoverage: executionCoverage,
            allPickedCount: Math.max(0, Number(summary?.pickedCount ?? 0) || 0),
            allPickedDays: Math.max(0, Number(summary?.pickedDays ?? 0) || 0),
            updatePickedCount: Math.max(0, Number(summary?.pickedCountUpdate ?? 0) || 0),
            updatePickedDays: Math.max(0, Number(summary?.pickedDaysUpdate ?? 0) || 0),
            evalPickedCount: Math.max(0, Number(summary?.pickedCountEval ?? 0) || 0),
            evalPickedDays: Math.max(0, Number(summary?.pickedDaysEval ?? 0) || 0),
            allExecutedCount: Math.max(0, Number(summary?.executedCount ?? 0) || 0),
            updateExecutedCount: Math.max(0, Number(summary?.executedCountUpdate ?? 0) || 0),
            evalExecutedCount: Math.max(0, Number(summary?.executedCountEval ?? 0) || 0),
            note:
              "promotionView and cd-loop primary metrics follow promotionScope; use scopeDiagnostics for ALL/UPDATE/EVAL counts."
          },
    scopeDiagnostics,
    primaryScopeDiagnostics
  }
  const evalScopeDiagnostics = scopeDiagnostics?.eval ?? null
  const sampleStarvation =
    Number(promotionPickedCountFloor ?? 0) > 0 &&
    Math.max(0, Number(pickedCount ?? 0) || 0) < Number(promotionPickedCountFloor ?? 0)
  const oracleGoodButTop1Bad =
    Number(oracleHitRateTopK ?? 0) >= 0.95 &&
    Number(top1ToOracleConversion ?? 0) <
      Math.max(0, Number(cfg?.minTop1ToOracleConversionForPromotion ?? 0) || 0)
  out.sampleStarvation = sampleStarvation
  out.oracleGoodButTop1Bad = oracleGoodButTop1Bad
  out.lastExecutionBlockerEval =
    Array.isArray(evalScopeDiagnostics?.topExecutionBlockers) &&
    evalScopeDiagnostics.topExecutionBlockers.length > 0
      ? evalScopeDiagnostics.topExecutionBlockers[0]?.key ?? null
      : null
  out.lastGateReasonEval =
    Array.isArray(evalScopeDiagnostics?.topGateReasons) &&
    evalScopeDiagnostics.topGateReasons.length > 0
      ? evalScopeDiagnostics.topGateReasons[0]?.key ?? null
      : null
  return out
}

const compareMetrics = (left, right) => {
  if (!right) return 1
  const l = left ?? {}
  const r = right ?? {}
  const lcbDelta = Number(l.pickHitRateLcb95 ?? 0) - Number(r.pickHitRateLcb95 ?? 0)
  if (Math.abs(lcbDelta) > HIT_RATE_TIE_BAND) {
    return lcbDelta
  }
  const executionLcbDelta =
    Number(l.executedHitRateLcb95 ?? 0) - Number(r.executedHitRateLcb95 ?? 0)
  if (Math.abs(executionLcbDelta) > HIT_RATE_TIE_BAND / 2) {
    return executionLcbDelta
  }
  const floor = Math.max(
    resolvePromotionPickedFloor(null),
    Number(l.promotionPickedCountFloor ?? 0) || 0,
    Number(r.promotionPickedCountFloor ?? 0) || 0,
  )
  const ceil = Math.max(
    floor,
    Number(l.promotionPickedCountCeil ?? 0) || 0,
    Number(r.promotionPickedCountCeil ?? 0) || 0,
  )
  const lFloorOk = Number(l.pickedCount ?? 0) >= floor
  const rFloorOk = Number(r.pickedCount ?? 0) >= floor
  if (lFloorOk !== rFloorOk) {
    return lFloorOk ? 1 : -1
  }
  const lCapOk = ceil <= 0 || Number(l.pickedCount ?? 0) <= ceil
  const rCapOk = ceil <= 0 || Number(r.pickedCount ?? 0) <= ceil
  if (lCapOk !== rCapOk) {
    return lCapOk ? 1 : -1
  }
  const lBandPenalty =
    Math.max(0, floor - Number(l.pickedCount ?? 0)) + Math.max(0, Number(l.pickedCount ?? 0) - ceil)
  const rBandPenalty =
    Math.max(0, floor - Number(r.pickedCount ?? 0)) + Math.max(0, Number(r.pickedCount ?? 0) - ceil)
  if (lBandPenalty !== rBandPenalty) {
    return rBandPenalty - lBandPenalty
  }
  const targetHitRateDelta =
    Number(l.targetHitRate ?? l.pickHitRate ?? 0) - Number(r.targetHitRate ?? r.pickHitRate ?? 0)
  if (Math.abs(targetHitRateDelta) > HIT_RATE_TIE_BAND / 2) {
    return targetHitRateDelta
  }
  const selectionHitAt1Delta =
    Number(l.selectionHitAt1Eval ?? l.selectionHitAt1 ?? l.hitAt1 ?? 0) -
    Number(r.selectionHitAt1Eval ?? r.selectionHitAt1 ?? r.hitAt1 ?? 0)
  if (Math.abs(selectionHitAt1Delta) > HIT_RATE_TIE_BAND / 2) {
    return selectionHitAt1Delta
  }
  const executedTargetHitRateDelta =
    Number(l.executedTargetHitRate ?? l.executedHitRate ?? 0) -
    Number(r.executedTargetHitRate ?? r.executedHitRate ?? 0)
  if (Math.abs(executedTargetHitRateDelta) > HIT_RATE_TIE_BAND / 2) {
    return executedTargetHitRateDelta
  }
  const stopRateDelta = Number(r.stopRate ?? 0) - Number(l.stopRate ?? 0)
  if (Math.abs(stopRateDelta) > HIT_RATE_TIE_BAND / 2) {
    return stopRateDelta
  }
  const timeoutNegativeRateDelta =
    Number(r.timeoutNegativeRate ?? 0) - Number(l.timeoutNegativeRate ?? 0)
  if (Math.abs(timeoutNegativeRateDelta) > HIT_RATE_TIE_BAND / 2) {
    return timeoutNegativeRateDelta
  }
  if (Number(l.pickedCount ?? 0) !== Number(r.pickedCount ?? 0)) {
    return Number(l.pickedCount ?? 0) - Number(r.pickedCount ?? 0)
  }
  if (Number(l.pickHitCount ?? 0) !== Number(r.pickHitCount ?? 0)) {
    return Number(l.pickHitCount ?? 0) - Number(r.pickHitCount ?? 0)
  }
  const hitRateDelta = Number(l.pickHitRate ?? 0) - Number(r.pickHitRate ?? 0)
  if (Math.abs(hitRateDelta) > HIT_RATE_TIE_BAND) {
    return hitRateDelta
  }
  if (Number(l.hitDays ?? 0) !== Number(r.hitDays ?? 0)) {
    return Number(l.hitDays ?? 0) - Number(r.hitDays ?? 0)
  }
  if (Number(l.hitRate ?? 0) !== Number(r.hitRate ?? 0)) {
    return Number(l.hitRate ?? 0) - Number(r.hitRate ?? 0)
  }
  if (Number(l.noCandidateRate ?? 0) !== Number(r.noCandidateRate ?? 0)) {
    return Number(r.noCandidateRate ?? 0) - Number(l.noCandidateRate ?? 0)
  }
  if (Number(l.avgRegret ?? 0) !== Number(r.avgRegret ?? 0)) {
    return Number(r.avgRegret ?? 0) - Number(l.avgRegret ?? 0)
  }
  return 0
}

const resolvePickedRowsForPrototypeMetrics = (log) => {
  if (Array.isArray(log?.pickedList) && log.pickedList.length > 0) {
    return log.pickedList
  }
  if (log?.picked) {
    return [log.picked]
  }
  if (Array.isArray(log?.selectedCandidates) && log.selectedCandidates.length > 0) {
    return log.selectedCandidates
  }
  const selectedTop1 = log?.orderingTrace?.finalSelectedTop1
  if (selectedTop1 && String(selectedTop1?.matchedPrototypeId ?? "").trim()) {
    return [selectedTop1]
  }
  return []
}

const resolveTopPrototypeRowForPrototypeMetrics = (log) => {
  if (Array.isArray(log?.topK) && log.topK.length > 0) {
    return log.topK[0]
  }
  if (Array.isArray(log?.rankedCandidates) && log.rankedCandidates.length > 0) {
    return log.rankedCandidates[0]
  }
  const gateInputTop1 = log?.orderingTrace?.gateInputTop1
  if (gateInputTop1 && String(gateInputTop1?.matchedPrototypeId ?? "").trim()) {
    return gateInputTop1
  }
  return null
}

const countPrototypeTaggedRows = (rows) => {
  let count = 0
  for (const row of rows ?? []) {
    const pickedRows = resolvePickedRowsForPrototypeMetrics(row)
    const pickedTagged = pickedRows.some((picked) => String(picked?.matchedPrototypeId ?? "").trim())
    if (pickedTagged) {
      count += 1
      continue
    }
    const top0 = resolveTopPrototypeRowForPrototypeMetrics(row)
    if (String(top0?.matchedPrototypeId ?? "").trim()) {
      count += 1
    }
  }
  return count
}

const resolvePrototypeMetricSource = ({ logs, executionAuditRows } = {}) => {
  const logRows = Array.isArray(logs) ? logs : []
  const auditRows = Array.isArray(executionAuditRows) ? executionAuditRows : []
  const logTaggedRows = countPrototypeTaggedRows(logRows)
  const auditTaggedRows = countPrototypeTaggedRows(auditRows)
  if (auditTaggedRows >= logTaggedRows && auditTaggedRows > 0) {
    return {
      rows: auditRows,
      source: "execution_audit",
      taggedRows: auditTaggedRows,
      totalRows: auditRows.length
    }
  }
  if (logTaggedRows > 0) {
    return {
      rows: logRows,
      source: "daily_logs",
      taggedRows: logTaggedRows,
      totalRows: logRows.length
    }
  }
  if (auditRows.length > 0) {
    return {
      rows: auditRows,
      source: "execution_audit_fallback",
      taggedRows: auditTaggedRows,
      totalRows: auditRows.length
    }
  }
  if (logRows.length > 0) {
    return {
      rows: logRows,
      source: "daily_logs_fallback",
      taggedRows: logTaggedRows,
      totalRows: logRows.length
    }
  }
  return {
    rows: [],
    source: "none",
    taggedRows: 0,
    totalRows: 0
  }
}

const summarizePrototypeMetrics = ({ logs, executionAuditRows, sourceRows } = {}) => {
  const byId = new Map()
  const ensure = (templateId) => {
    const key = String(templateId ?? "").trim()
    if (!key) return null
    const row = byId.get(key) ?? {
      templateId: key,
      usageCount: 0,
      hitCount: 0,
      missCount: 0,
      regretSum: 0,
      regretCount: 0,
      gateRejectContribution: 0
    }
    byId.set(key, row)
    return row
  }

  const resolvedRows =
    Array.isArray(sourceRows)
      ? sourceRows
      : resolvePrototypeMetricSource({ logs, executionAuditRows }).rows

  for (const log of resolvedRows) {
    const pickedRows = resolvePickedRowsForPrototypeMetrics(log)
    for (let i = 0; i < pickedRows.length; i += 1) {
      const picked = pickedRows[i]
      const pickedId = String(picked?.matchedPrototypeId ?? "").trim()
      if (!pickedId) continue
      const row = ensure(pickedId)
      if (!row) continue
      row.usageCount += 1
      const success = picked?.successInWindow === true || picked?.successOnDecisionDay === true
      if (success) row.hitCount += 1
      else row.missCount += 1
      if (i === 0) {
        const regret = num(log?.regret)
        if (Number.isFinite(regret)) {
          row.regretSum += regret
          row.regretCount += 1
        }
      }
    }
    if (String(log?.gateReason ?? "") !== "TRADE") {
      const top0 = resolveTopPrototypeRowForPrototypeMetrics(log)
      const topId = String(top0?.matchedPrototypeId ?? "").trim()
      if (topId) {
        const row = ensure(topId)
        if (row) row.gateRejectContribution += 1
      }
    }
  }

  const rows = []
  for (const row of byId.values()) {
    const hitRate = row.usageCount > 0 ? row.hitCount / row.usageCount : 0
    const missRate = row.usageCount > 0 ? row.missCount / row.usageCount : 0
    const avgRegret = row.regretCount > 0 ? row.regretSum / row.regretCount : 0
    rows.push({
      ...row,
      hitRate,
      missRate,
      avgRegret
    })
  }
  rows.sort((a, b) => String(a.templateId).localeCompare(String(b.templateId)))
  return rows
}

const buildPrototypeLookup = (library) => {
  const signatureByCluster = new Map()
  for (const row of library?.globalClusters ?? []) {
    const clusterId = String(row?.clusterId ?? "").trim()
    if (!clusterId) continue
    signatureByCluster.set(clusterId, String(row?.signature ?? "").trim())
  }
  const map = new Map()
  for (const row of library?.prototypes ?? []) {
    const templateId = String(row?.templateId ?? "").trim()
    if (!templateId) continue
    const clusterId = String(row?.clusterId ?? "").trim()
    map.set(templateId, {
      clusterId,
      clusterSignature: String(signatureByCluster.get(clusterId) ?? "").trim()
    })
  }
  return map
}

const buildPrototypeClusterMap = (library) => {
  const lookup = buildPrototypeLookup(library)
  const out = new Map()
  for (const [templateId, row] of lookup.entries()) {
    out.set(templateId, String(row?.clusterId ?? "").trim())
  }
  return out
}

const readWeightsSnapshot = async (weightsPath) => {
  const filePath = String(weightsPath ?? "").trim()
  if (!filePath || !pathExists(filePath)) return null
  const payload = await readJson(filePath, null)
  const raw = payload?.weights && typeof payload.weights === "object" ? payload.weights : payload
  if (!raw || typeof raw !== "object") return null
  return normalizeGroupWeights(raw)
}

const calcStdDev = (values) => {
  const rows = (Array.isArray(values) ? values : []).map((it) => Number(it)).filter(Number.isFinite)
  if (rows.length <= 1) return 0
  const mean = rows.reduce((acc, v) => acc + v, 0) / rows.length
  const variance = rows.reduce((acc, v) => acc + (v - mean) ** 2, 0) / rows.length
  return Math.sqrt(Math.max(0, variance))
}

const summarizeStabilityWindow = ({ metricsRows, improvedCount, cfg }) => {
  const rows = Array.isArray(metricsRows) ? metricsRows : []
  const hitRates = rows.map((it) => Number(it?.pickHitRate ?? 0))
  const lcbs = rows.map((it) => Number(it?.pickHitRateLcb95 ?? 0))
  const pickHitRateStd = calcStdDev(hitRates)
  const pickHitRateLcbStd = calcStdDev(lcbs)
  const minImprovedRounds = Math.max(1, Number(cfg?.minImprovedRounds ?? 3) || 3)
  const maxPickHitRateStd = Math.max(0, Number(cfg?.maxPickHitRateStd ?? 0.2) || 0.2)
  const maxPickHitRateLcbStd = Math.max(0, Number(cfg?.maxPickHitRateLcbStd ?? 0.12) || 0.12)
  const enoughRounds = rows.length >= minImprovedRounds
  const improvementOk = Number(improvedCount ?? 0) >= minImprovedRounds
  const varianceOk = pickHitRateStd <= maxPickHitRateStd && pickHitRateLcbStd <= maxPickHitRateLcbStd
  return {
    windowRounds: rows.length,
    minImprovedRounds,
    improvedCount: Number(improvedCount ?? 0) || 0,
    improvementOk,
    pickHitRateStd,
    pickHitRateLcbStd,
    maxPickHitRateStd,
    maxPickHitRateLcbStd,
    enoughRounds,
    varianceOk,
    ok: enoughRounds && improvementOk && varianceOk
  }
}

const buildSwaChampion = async ({ roundRows, cfg, outPath }) => {
  const rows = Array.isArray(roundRows) ? roundRows.slice() : []
  const topRounds = Math.max(1, Number(cfg?.topRounds ?? 5) || 5)
  const minRounds = Math.max(1, Number(cfg?.minRounds ?? 3) || 3)
  const ranked = rows
    .filter((row) => row?.promotable === true)
    .sort((a, b) => {
      const c = compareMetrics(a?.bestMetrics, b?.bestMetrics)
      if (c !== 0) return c > 0 ? -1 : 1
      return cmpNumber(a?.round, b?.round, true)
    })
    .slice(0, topRounds)
  if (ranked.length < minRounds) {
    return {
      built: false,
      reason: "INSUFFICIENT_STABLE_ROUNDS",
      candidates: ranked.map((row) => Number(row?.round ?? 0))
    }
  }
  const hitStd = calcStdDev(ranked.map((row) => Number(row?.bestMetrics?.pickHitRate ?? 0)))
  const lcbStd = calcStdDev(ranked.map((row) => Number(row?.bestMetrics?.pickHitRateLcb95 ?? 0)))
  if (
    hitStd > Number(cfg?.maxPickHitRateStd ?? 0.2) ||
    lcbStd > Number(cfg?.maxPickHitRateLcbStd ?? 0.12)
  ) {
    return {
      built: false,
      reason: "VOLATILE_CANDIDATES",
      hitStd,
      lcbStd,
      maxPickHitRateStd: Number(cfg?.maxPickHitRateStd ?? 0.2),
      maxPickHitRateLcbStd: Number(cfg?.maxPickHitRateLcbStd ?? 0.12),
      candidates: ranked.map((row) => Number(row?.round ?? 0))
    }
  }
  const weightRows = []
  for (const row of ranked) {
    const weights = await readWeightsSnapshot(row?.bestWeightsPath)
    if (!weights) continue
    weightRows.push({
      round: Number(row?.round ?? 0),
      roundTag: String(row?.roundTag ?? ""),
      weights
    })
  }
  if (weightRows.length < minRounds) {
    return {
      built: false,
      reason: "MISSING_WEIGHT_SNAPSHOTS",
      candidates: ranked.map((row) => Number(row?.round ?? 0))
    }
  }
  const merged = {}
  for (const key of GROUP_KEYS) merged[key] = 0
  for (const row of weightRows) {
    for (const key of GROUP_KEYS) {
      merged[key] += Number(row?.weights?.[key] ?? 0) || 0
    }
  }
  for (const key of GROUP_KEYS) {
    merged[key] = merged[key] / weightRows.length
  }
  const normalized = normalizeGroupWeights(merged)
  await writeJson(outPath, {
    generatedAt: new Date().toISOString(),
    source: "SWA",
    rounds: weightRows.map((row) => ({
      round: row.round,
      roundTag: row.roundTag
    })),
    weights: normalized
  })
  return {
    built: true,
    weightsPath: outPath,
    rounds: weightRows.map((row) => ({
      round: row.round,
      roundTag: row.roundTag
    })),
    hitStd,
    lcbStd,
    candidateCount: weightRows.length
  }
}

const normalizeScoreMap = (raw) => {
  if (!raw || typeof raw !== "object") return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    const id = String(key ?? "").trim()
    if (!id) continue
    const score = clampSigned(value)
    if (!Number.isFinite(score)) continue
    out[id] = score
  }
  return out
}

const pruneScoreMap = ({ map, minAbsScore, maxEntries }) => {
  const source = normalizeScoreMap(map)
  const list = Object.entries(source)
    .filter(([, score]) => Math.abs(Number(score ?? 0)) >= Number(minAbsScore ?? 0))
    .sort((a, b) => {
      const absDiff = Math.abs(Number(b[1] ?? 0)) - Math.abs(Number(a[1] ?? 0))
      if (absDiff !== 0) return absDiff
      return String(a[0]).localeCompare(String(b[0]))
    })
    .slice(0, Math.max(1, Number(maxEntries ?? 1) || 1))
  return Object.fromEntries(list.map(([key, score]) => [key, clampSigned(score)]))
}

const countsToScoreMap = ({ countsMap, cfg, maxEntries }) => {
  const rawScores = {}
  for (const [key, counts] of countsMap.entries()) {
    const hitCount = Math.max(0, Number(counts?.hitCount ?? 0) || 0)
    const missCount = Math.max(0, Number(counts?.missCount ?? 0) || 0)
    const trades = hitCount + missCount
    if (trades < Number(cfg?.minTradesPerScore ?? 3)) continue
    const hitRate = trades > 0 ? hitCount / trades : 0
    const sampleFactor = Math.min(1, trades / Number(cfg?.fullConfidenceTrades ?? 10))
    const signedScore = clampSigned((hitRate - 0.5) * 2 * sampleFactor)
    rawScores[String(key)] = signedScore
  }
  return pruneScoreMap({
    map: rawScores,
    minAbsScore: Number(cfg?.minAbsScore ?? 0),
    maxEntries
  })
}

const buildRoundCommonScoreMaps = ({ logs, executionAuditRows, sourceRows, prototypeLookup, cfg }) => {
  const protoCounts = new Map()
  const regimeCounts = new Map()
  const ensureCounts = (map, key) => {
    const id = String(key ?? "").trim()
    if (!id) return null
    const row = map.get(id) ?? { hitCount: 0, missCount: 0 }
    map.set(id, row)
    return row
  }
  const resolvedSource =
    Array.isArray(sourceRows)
      ? {
          rows: sourceRows,
          source: "pre_resolved",
          taggedRows: countPrototypeTaggedRows(sourceRows),
          totalRows: sourceRows.length
        }
      : resolvePrototypeMetricSource({ logs, executionAuditRows })
  for (const log of resolvedSource.rows) {
    const pickedRows = resolvePickedRowsForPrototypeMetrics(log)
    for (const picked of pickedRows) {
      const templateId = String(picked?.matchedPrototypeId ?? "").trim()
      if (!templateId) continue
      const success = picked?.successInWindow === true || picked?.successOnDecisionDay === true
      const proto = ensureCounts(protoCounts, templateId)
      if (proto) {
        if (success) proto.hitCount += 1
        else proto.missCount += 1
      }
      const signature = String(prototypeLookup?.get(templateId)?.clusterSignature ?? "").trim()
      if (!signature) continue
      const regime = ensureCounts(regimeCounts, signature)
      if (regime) {
        if (success) regime.hitCount += 1
        else regime.missCount += 1
      }
    }
  }

  return {
    prototypeScores: countsToScoreMap({
      countsMap: protoCounts,
      cfg,
      maxEntries: Number(cfg?.maxPrototypeScores ?? 180)
    }),
    regimeWeights: countsToScoreMap({
      countsMap: regimeCounts,
      cfg,
      maxEntries: Number(cfg?.maxRegimeScores ?? 80)
    }),
    source: {
      source: resolvedSource.source,
      taggedRows: resolvedSource.taggedRows,
      totalRows: resolvedSource.totalRows
    }
  }
}

const blendGroupWeights = ({ prev, next, alpha }) => {
  const merged = {}
  for (const key of GROUP_KEYS) {
    const pv = Number(prev?.[key] ?? 0)
    const nv = Number(next?.[key] ?? 0)
    merged[key] = (1 - alpha) * pv + alpha * nv
  }
  return normalizeGroupWeights(merged)
}

const mergeScoreMaps = ({ prev, next, alpha, cfg, maxEntries }) => {
  const prevMap = normalizeScoreMap(prev)
  const nextMap = normalizeScoreMap(next)
  const keys = new Set([...Object.keys(prevMap), ...Object.keys(nextMap)])
  const merged = {}
  for (const key of keys) {
    const pv = Number(prevMap?.[key] ?? 0)
    const nv = Number(nextMap?.[key] ?? 0)
    const mv = clampSigned((1 - alpha) * pv + alpha * nv)
    if (Math.abs(mv) < Number(cfg?.minAbsScore ?? 0)) continue
    merged[key] = mv
  }
  return pruneScoreMap({
    map: merged,
    minAbsScore: Number(cfg?.minAbsScore ?? 0),
    maxEntries
  })
}

const buildCommonStateCandidate = ({
  cfg,
  metrics,
  weights,
  logs,
  executionAuditRows,
  prototypeLookup,
  round,
  epochRef,
  cTag,
  runId
}) => {
  const featureWeights = normalizeGroupWeights(weights)
  const antiRaw = {}
  for (const key of GROUP_KEYS) {
    antiRaw[key] = Math.max(0, 1 - Number(featureWeights?.[key] ?? 0))
  }
  const antiFeatureWeights = normalizeGroupWeights(antiRaw)
  const maps = buildRoundCommonScoreMaps({
    logs,
    executionAuditRows,
    prototypeLookup,
    cfg
  })
  const pickedCount = Math.max(0, Number(metrics?.pickedCount ?? 0) || 0)
  const pickHitRateLcb95 = clamp01(metrics?.pickHitRateLcb95 ?? 0)
  const sampleConfidence = Math.min(1, pickedCount / Number(cfg?.fullConfidencePicks ?? 30))
  const confidence = clamp01((0.35 + 0.65 * pickHitRateLcb95) * sampleConfidence)

  return {
    version: "v1",
    updatedAt: new Date().toISOString(),
    source: {
      runId: String(runId ?? ""),
      round: Number(round ?? 0),
      epochRef: String(epochRef ?? ""),
      cTag: String(cTag ?? "")
    },
    confidence,
    featureWeights,
    antiFeatureWeights,
    prototypeScores: maps.prototypeScores,
    regimeWeights: maps.regimeWeights,
    sourceStats: maps.source
  }
}

const mergeChampionCommonState = ({ prev, candidate, cfg }) => {
  const prevSafe = prev && typeof prev === "object" ? prev : {}
  const nextSafe = candidate && typeof candidate === "object" ? candidate : {}
  const prevConfidence = clamp01(prevSafe?.confidence ?? 0)
  const nextConfidence = clamp01(nextSafe?.confidence ?? 0)
  const alpha = clamp01(
    Math.max(
      Number(cfg?.emaFloor ?? 0.08),
      Number(cfg?.emaAlpha ?? 0.35) * nextConfidence
    ),
  )
  const mergedFeature = blendGroupWeights({
    prev: normalizeGroupWeights(prevSafe?.featureWeights ?? {}),
    next: normalizeGroupWeights(nextSafe?.featureWeights ?? {}),
    alpha
  })
  const mergedAnti = blendGroupWeights({
    prev: normalizeGroupWeights(prevSafe?.antiFeatureWeights ?? {}),
    next: normalizeGroupWeights(nextSafe?.antiFeatureWeights ?? {}),
    alpha
  })

  return {
    version: "v1",
    updatedAt: new Date().toISOString(),
    source: nextSafe?.source ?? prevSafe?.source ?? null,
    confidence: clamp01((1 - alpha) * prevConfidence + alpha * nextConfidence),
    featureWeights: mergedFeature,
    antiFeatureWeights: mergedAnti,
    prototypeScores: mergeScoreMaps({
      prev: prevSafe?.prototypeScores,
      next: nextSafe?.prototypeScores,
      alpha,
      cfg,
      maxEntries: Number(cfg?.maxPrototypeScores ?? 180)
    }),
    regimeWeights: mergeScoreMaps({
      prev: prevSafe?.regimeWeights,
      next: nextSafe?.regimeWeights,
      alpha,
      cfg,
      maxEntries: Number(cfg?.maxRegimeScores ?? 80)
    }),
    meta: {
      alpha,
      minAbsScore: Number(cfg?.minAbsScore ?? 0),
      maxPrototypeScores: Number(cfg?.maxPrototypeScores ?? 180),
      maxRegimeScores: Number(cfg?.maxRegimeScores ?? 80)
    }
  }
}

const summarizeCommonStateMeta = (state) => ({
  version: String(state?.version ?? ""),
  updatedAt: String(state?.updatedAt ?? ""),
  confidence: clamp01(state?.confidence ?? 0),
  source: state?.source ?? null,
  prototypeScores: Object.keys(state?.prototypeScores ?? {}).length,
  regimeWeights: Object.keys(state?.regimeWeights ?? {}).length
})

const classifyAndSelectDrops = ({
  protoMetrics,
  prevRoundMetrics,
  stateMap,
  cfg,
  roundPickHitRate,
  clusterByPrototype,
  permanentDropSet
}) => {
  const byId = new Map((protoMetrics ?? []).map((row) => [String(row.templateId), row]))
  const activeIds = Array.from(clusterByPrototype.keys()).filter((id) => !permanentDropSet.has(id))
  const activeCount = activeIds.length
  const cap = Math.max(0, Math.floor(activeCount * Number(cfg?.perRoundDropCapRatio ?? 0.25)))
  const clusterRemain = new Map()
  for (const id of activeIds) {
    const clusterId = String(clusterByPrototype.get(id) ?? "")
    clusterRemain.set(clusterId, Number(clusterRemain.get(clusterId) ?? 0) + 1)
  }

  const evaluated = []
  for (const id of activeIds) {
    const metric = byId.get(id) ?? {
      templateId: id,
      usageCount: 0,
      hitCount: 0,
      missCount: 0,
      regretSum: 0,
      regretCount: 0,
      gateRejectContribution: 0,
      hitRate: 0,
      missRate: 0,
      avgRegret: 0
    }
    const prev = prevRoundMetrics.get(id)
    const prevState = stateMap.get(id) ?? { streak: 0, cooldown: 0 }
    const rapidImprove =
      prev &&
      Number(metric.usageCount ?? 0) >= Number(cfg.minUsageForDrop) &&
      Number(metric.hitRate ?? 0) - Number(prev.hitRate ?? 0) >= Number(cfg.rapidImproveHitRateDelta)
    const cooldown = rapidImprove ? 1 : Math.max(0, Number(prevState.cooldown ?? 0) - 1)
    const underperf =
      Number(metric.usageCount ?? 0) >= Number(cfg.minUsageForDrop) &&
      Number(metric.hitRate ?? 0) <= Number(roundPickHitRate ?? 0) - Number(cfg.dropHitRateDelta ?? 0.02) &&
      (
        Number(metric.avgRegret ?? 0) >= Number(cfg.dropMinAvgRegret ?? 0.01) ||
        Number(metric.missRate ?? 0) >= Number(cfg.dropMinMissRate ?? 0.75)
      )
    const streak = underperf ? Number(prevState.streak ?? 0) + 1 : 0
    const dropEligible =
      underperf &&
      cooldown <= 0 &&
      streak >= Number(cfg.dropStreakRounds ?? 2) &&
      Number(metric.usageCount ?? 0) >= Number(cfg.minUsageForDrop)
    stateMap.set(id, { streak, cooldown })
    evaluated.push({
      ...metric,
      clusterId: String(clusterByPrototype.get(id) ?? ""),
      underperf,
      streak,
      cooldown,
      dropEligible
    })
  }

  const dropCandidates = evaluated
    .filter((row) => row.dropEligible)
    .sort((a, b) => {
      if (b.streak !== a.streak) return b.streak - a.streak
      if (a.hitRate !== b.hitRate) return a.hitRate - b.hitRate
      if (b.avgRegret !== a.avgRegret) return b.avgRegret - a.avgRegret
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount
      return String(a.templateId).localeCompare(String(b.templateId))
    })

  const selectedDrops = []
  for (const row of dropCandidates) {
    if (selectedDrops.length >= cap) break
    const clusterId = String(row.clusterId ?? "")
    const remain = Number(clusterRemain.get(clusterId) ?? 0)
    if (remain - 1 < Number(cfg.clusterMinKeep ?? 2)) {
      continue
    }
    selectedDrops.push(String(row.templateId))
    clusterRemain.set(clusterId, remain - 1)
  }

  const selectedSet = new Set(selectedDrops)
  const classified = evaluated.map((row) => {
    const usageOk = Number(row.usageCount ?? 0) >= Number(cfg.minUsageForDrop ?? 12)
    const isCore =
      usageOk &&
      Number(row.hitRate ?? 0) >= Number(roundPickHitRate ?? 0) + Number(cfg.dropHitRateDelta ?? 0.02) &&
      Number(row.avgRegret ?? 0) < Number(cfg.dropMinAvgRegret ?? 0.01)
    const isDrop = selectedSet.has(String(row.templateId))
    const bucket = isDrop ? "DROP" : isCore ? "CORE" : "WATCH"
    return {
      ...row,
      bucket
    }
  })

  const counts = {
    core: classified.filter((row) => row.bucket === "CORE").length,
    watch: classified.filter((row) => row.bucket === "WATCH").length,
    drop: classified.filter((row) => row.bucket === "DROP").length
  }

  return {
    classified,
    counts,
    selectedDrops,
    cap,
    activeCount
  }
}

const resolvePatternPoolPath = (ctx, rawPath) => {
  const raw = String(rawPath ?? "").trim()
  if (!raw) return ""
  return path.isAbsolute(raw) ? raw : path.resolve(ctx?.cwd ?? process.cwd(), raw)
}

const resolveAdaptiveFrontierPoolPaths = (ctx) => {
  const adaptive = ctx?.config?.pattern?.prototypeSelection?.adaptiveFrontier ?? {}
  return {
    salvagePoolPath: resolvePatternPoolPath(ctx, adaptive?.salvagePoolPath),
    quarantinePoolPath: resolvePatternPoolPath(ctx, adaptive?.quarantinePoolPath),
    salvageBoostBias: Math.max(0, Number(adaptive?.salvageBoostBias ?? 0.08) || 0.08),
    salvagePenaltyBias: Math.max(0, Number(adaptive?.salvagePenaltyBias ?? 0.06) || 0.06),
    maxSalvageEntries: Math.max(16, Math.floor(Number(adaptive?.maxSalvageEntries ?? 256) || 256)),
    maxQuarantineEntries: Math.max(
      16,
      Math.floor(Number(adaptive?.maxQuarantineEntries ?? 256) || 256),
    )
  }
}

const normalizePatternPoolStepDMetrics = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(source)
  const out = {
    targetHitRateEval: Number.isFinite(Number(source?.targetHitRateEval))
      ? Number(source.targetHitRateEval)
      : null,
    selectionHitAt1Eval: selectionHitAt1.resolved,
    selectionHitAt1RawEval: selectionHitAt1.raw,
    selectionHitAt1ResolvedEval: selectionHitAt1.resolved,
    selectionHitAt1MetricSourceEval: selectionHitAt1.source,
    selectionHitAt1AgreementFallbackAwareEval: selectionHitAt1.agreementFallbackAware,
    executedTargetHitRateEval: Number.isFinite(Number(source?.executedTargetHitRateEval))
      ? Number(source.executedTargetHitRateEval)
      : null,
    stopRateEval: Number.isFinite(Number(source?.stopRateEval))
      ? Number(source.stopRateEval)
      : null,
    timeoutNegativeRateEval: Number.isFinite(Number(source?.timeoutNegativeRateEval))
      ? Number(source.timeoutNegativeRateEval)
      : null,
    oracleHitRateTopKEval: Number.isFinite(Number(source?.oracleHitRateTopKEval))
      ? Number(source.oracleHitRateTopKEval)
      : null
  }
  return Object.values(out).some((value) => value !== null) ? out : null
}

const normalizePatternPoolStepEMetrics = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const out = {
    targetHitRate: Number.isFinite(Number(source?.targetHitRate))
      ? Number(source.targetHitRate)
      : null,
    targetHitCount: Number.isFinite(Number(source?.targetHitCount))
      ? Number(source.targetHitCount)
      : null,
    stopRate: Number.isFinite(Number(source?.stopRate))
      ? Number(source.stopRate)
      : null,
    timeoutNegativeRate: Number.isFinite(Number(source?.timeoutNegativeRate))
      ? Number(source.timeoutNegativeRate)
      : null
  }
  return Object.values(out).some((value) => value !== null) ? out : null
}

const normalizePatternPoolEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null
  const sourceStepD = normalizePatternPoolStepDMetrics(
    entry?.sourceStepD && typeof entry?.sourceStepD === "object"
      ? entry.sourceStepD
      : {
          targetHitRateEval: entry?.sourceStepDTargetHitRate,
          selectionHitAt1Eval: entry?.sourceStepDSelectionHitAt1Eval,
          executedTargetHitRateEval: entry?.sourceStepDExecutedTargetHitRateEval,
          stopRateEval: entry?.sourceStepDStopRateEval,
          timeoutNegativeRateEval: entry?.sourceStepDTimeoutNegativeRateEval,
          oracleHitRateTopKEval: entry?.sourceStepDOracleHitRateTopKEval
        },
  )
  const sourceStepE = normalizePatternPoolStepEMetrics(
    entry?.sourceStepE && typeof entry?.sourceStepE === "object"
      ? entry.sourceStepE
      : {
          targetHitRate: entry?.sourceStepETargetHitRate,
          targetHitCount: entry?.sourceStepETargetHitCount,
          stopRate: entry?.sourceStepEStopRate,
          timeoutNegativeRate: entry?.sourceStepETimeoutNegativeRate
        },
  )
  const normalized = {
    templateId: String(entry?.templateId ?? "").trim() || null,
    clusterId: String(entry?.clusterId ?? "").trim() || null,
    clusterSignature: String(entry?.clusterSignature ?? "").trim() || null,
    symbol: String(entry?.symbol ?? "").trim() || null,
    selectedEraId: String(entry?.selectedEraId ?? "").trim() || null,
    bias: Number.isFinite(Number(entry?.bias)) ? Number(entry.bias) : null,
    reason: String(entry?.reason ?? "").trim() || null,
    sourceRunId: String(entry?.sourceRunId ?? "").trim() || null,
    sourceSessionId:
      String(entry?.sourceSessionId ?? entry?.sourceCycleId ?? "").trim() || null,
    round: Number.isFinite(Number(entry?.round)) ? Number(entry.round) : null,
    roundTag: String(entry?.roundTag ?? "").trim() || null,
    cTag: String(entry?.cTag ?? "").trim() || null,
    sourceRound: Number.isFinite(Number(entry?.sourceRound)) ? Number(entry.sourceRound) : null,
    sourceRoundTag: String(entry?.sourceRoundTag ?? "").trim() || null,
    sourceCTag: String(entry?.sourceCTag ?? "").trim() || null,
    sourceLineAccepted:
      typeof entry?.sourceLineAccepted === "boolean" ? entry.sourceLineAccepted : null,
    sourceSessionEnded:
      typeof entry?.sourceSessionEnded === "boolean" ? entry.sourceSessionEnded : null,
    sourceDiscardReason: String(entry?.sourceDiscardReason ?? "").trim() || null,
    sourceStepD,
    sourceStepE,
    sourceStepDTargetHitRate: sourceStepD?.targetHitRateEval ?? null,
    sourceStepETargetHitRate: sourceStepE?.targetHitRate ?? null,
    eNotRunReason: String(entry?.eNotRunReason ?? "").trim() || null,
    sourceCandidateMode: String(entry?.sourceCandidateMode ?? "").trim() || null,
    usageCount: Number.isFinite(Number(entry?.usageCount)) ? Number(entry.usageCount) : null,
    hitRate: Number.isFinite(Number(entry?.hitRate)) ? Number(entry.hitRate) : null,
    missRate: Number.isFinite(Number(entry?.missRate)) ? Number(entry.missRate) : null,
    avgRegret: Number.isFinite(Number(entry?.avgRegret)) ? Number(entry.avgRegret) : null,
    gateRejectContribution: Number.isFinite(Number(entry?.gateRejectContribution))
      ? Number(entry.gateRejectContribution)
      : null,
    streak: Number.isFinite(Number(entry?.streak)) ? Number(entry.streak) : null,
    salvageCount: Number.isFinite(Number(entry?.salvageCount))
      ? Number(entry.salvageCount)
      : null,
    quarantineCount: Number.isFinite(Number(entry?.quarantineCount))
      ? Number(entry.quarantineCount)
      : null,
    promotedToCoreAt: String(entry?.promotedToCoreAt ?? "").trim() || null,
    retiredAt: String(entry?.retiredAt ?? "").trim() || null,
    retirementReason: String(entry?.retirementReason ?? "").trim() || null,
    updatedAt: String(entry?.updatedAt ?? "").trim() || null
  }
  return Object.values(normalized).some((value) => value !== null) ? normalized : null
}

const patternPoolEntryKey = (entry) =>
  [
    String(entry?.templateId ?? "").trim(),
    String(entry?.clusterId ?? "").trim(),
    String(entry?.clusterSignature ?? "").trim(),
    String(entry?.symbol ?? "").trim(),
    String(entry?.selectedEraId ?? "").trim()
  ].join("::")

const rankSalvageEntries = ({ rows, type }) => {
  const list = Array.isArray(rows) ? rows.slice() : []
  list.sort((a, b) => {
    if (type === "boost") {
      const hitDiff = Number(b?.hitRate ?? 0) - Number(a?.hitRate ?? 0)
      if (hitDiff !== 0) return hitDiff
      const usageDiff = Number(b?.usageCount ?? 0) - Number(a?.usageCount ?? 0)
      if (usageDiff !== 0) return usageDiff
      const regretDiff = Number(a?.avgRegret ?? 0) - Number(b?.avgRegret ?? 0)
      if (regretDiff !== 0) return regretDiff
    } else if (type === "penalty") {
      const streakDiff = Number(b?.streak ?? 0) - Number(a?.streak ?? 0)
      if (streakDiff !== 0) return streakDiff
      const missDiff = Number(b?.missRate ?? 0) - Number(a?.missRate ?? 0)
      if (missDiff !== 0) return missDiff
      const regretDiff = Number(b?.avgRegret ?? 0) - Number(a?.avgRegret ?? 0)
      if (regretDiff !== 0) return regretDiff
    } else {
      const streakDiff = Number(b?.streak ?? 0) - Number(a?.streak ?? 0)
      if (streakDiff !== 0) return streakDiff
      const missDiff = Number(b?.missRate ?? 0) - Number(a?.missRate ?? 0)
      if (missDiff !== 0) return missDiff
      const usageDiff = Number(b?.usageCount ?? 0) - Number(a?.usageCount ?? 0)
      if (usageDiff !== 0) return usageDiff
    }
    return String(a?.templateId ?? "").localeCompare(String(b?.templateId ?? ""))
  })
  return list
}

const mergePatternPoolEntries = ({ existing, incoming, type, maxEntries }) => {
  const merged = new Map()
  for (const raw of existing ?? []) {
    const row = normalizePatternPoolEntry(raw)
    if (!row) continue
    merged.set(patternPoolEntryKey(row), row)
  }
  for (const raw of incoming ?? []) {
    const row = normalizePatternPoolEntry(raw)
    if (!row) continue
    const key = patternPoolEntryKey(row)
    const prev = merged.get(key)
    const nextSalvageCount =
      Math.max(0, Number(prev?.salvageCount ?? 0) || 0) +
      (type === "boost" || type === "penalty" ? 1 : 0)
    const nextQuarantineCount =
      Math.max(0, Number(prev?.quarantineCount ?? 0) || 0) + (type === "quarantine" ? 1 : 0)
    const promoteToCore =
      (type === "boost" || type === "penalty") &&
      nextSalvageCount >= 2 &&
      !String(prev?.promotedToCoreAt ?? row?.promotedToCoreAt ?? "").trim()
    const retireByHardRule =
      type === "quarantine" &&
      nextQuarantineCount >= 2 &&
      !String(prev?.retiredAt ?? row?.retiredAt ?? "").trim()
    const updatedAt = row?.updatedAt ?? prev?.updatedAt ?? new Date().toISOString()
    merged.set(key, {
      ...(prev ?? {}),
      ...row,
      bias: Number.isFinite(Number(row?.bias)) ? Number(row.bias) : Number(prev?.bias ?? 0) || null,
      sourceStepD: row?.sourceStepD ?? prev?.sourceStepD ?? null,
      sourceStepE: row?.sourceStepE ?? prev?.sourceStepE ?? null,
      sourceStepDTargetHitRate:
        row?.sourceStepD?.targetHitRateEval ??
        row?.sourceStepDTargetHitRate ??
        prev?.sourceStepD?.targetHitRateEval ??
        prev?.sourceStepDTargetHitRate ??
        null,
      sourceStepETargetHitRate:
        row?.sourceStepE?.targetHitRate ??
        row?.sourceStepETargetHitRate ??
        prev?.sourceStepE?.targetHitRate ??
        prev?.sourceStepETargetHitRate ??
        null,
      salvageCount: nextSalvageCount || Number(row?.salvageCount ?? prev?.salvageCount ?? 0) || 0,
      quarantineCount:
        nextQuarantineCount || Number(row?.quarantineCount ?? prev?.quarantineCount ?? 0) || 0,
      promotedToCoreAt:
        row?.promotedToCoreAt ??
        prev?.promotedToCoreAt ??
        (promoteToCore ? updatedAt : null),
      retiredAt:
        row?.retiredAt ??
        prev?.retiredAt ??
        (retireByHardRule ? updatedAt : null),
      retirementReason:
        row?.retirementReason ??
        prev?.retirementReason ??
        (retireByHardRule ? "REPEATED_QUARANTINE" : null),
      updatedAt
    })
  }
  return rankSalvageEntries({
    rows: Array.from(merged.values()),
    type
  }).slice(0, Math.max(1, Number(maxEntries ?? 256) || 256))
}

const buildPatternPoolEntry = ({
  row,
  entryType,
  prototypeLookup,
  bias,
  reason,
  runId,
  round,
  roundTag,
  cTag,
  sourceRound,
  sourceRoundTag,
  sourceCTag,
  sourceSessionId,
  sourceSessionEnded,
  sourceLineAccepted,
  sourceDiscardReason,
  sourceStepD,
  sourceStepE,
  eNotRunReason,
  sourceCandidateMode
}) => {
  const templateId = String(row?.templateId ?? "").trim()
  if (!templateId) return null
  const lookup = prototypeLookup?.get(templateId) ?? {}
  return normalizePatternPoolEntry({
    templateId,
    clusterId: String(row?.clusterId ?? lookup?.clusterId ?? "").trim() || null,
    clusterSignature: String(row?.clusterSignature ?? lookup?.clusterSignature ?? "").trim() || null,
    bias,
    reason,
    sourceRunId: String(runId ?? "").trim() || null,
    round,
    roundTag: String(roundTag ?? "").trim() || null,
    cTag: String(cTag ?? "").trim() || null,
    sourceRound: Number.isFinite(Number(sourceRound)) ? Number(sourceRound) : null,
    sourceRoundTag: String(sourceRoundTag ?? "").trim() || null,
    sourceCTag: String(sourceCTag ?? "").trim() || null,
    sourceSessionId: String(sourceSessionId ?? "").trim() || null,
    sourceSessionEnded: typeof sourceSessionEnded === "boolean" ? sourceSessionEnded : null,
    sourceLineAccepted:
      typeof sourceLineAccepted === "boolean" ? sourceLineAccepted : null,
    sourceDiscardReason: String(sourceDiscardReason ?? "").trim() || null,
    sourceStepD,
    sourceStepE,
    eNotRunReason: String(eNotRunReason ?? "").trim() || null,
    sourceCandidateMode: String(sourceCandidateMode ?? "").trim() || null,
    usageCount: Number(row?.usageCount ?? 0) || 0,
    hitRate: Number(row?.hitRate ?? 0) || 0,
    missRate: Number(row?.missRate ?? 0) || 0,
    avgRegret: Number(row?.avgRegret ?? 0) || 0,
    gateRejectContribution: Number(row?.gateRejectContribution ?? 0) || 0,
    streak: Number(row?.streak ?? 0) || 0,
    salvageCount: entryType === "quarantine" ? 0 : 1,
    quarantineCount: entryType === "quarantine" ? 1 : 0,
    updatedAt: new Date().toISOString()
  })
}

const persistAdaptiveFrontierPatternPools = async ({
  ctx,
  champion,
  classificationPath,
  classificationSources,
  prototypeLookup
}) => {
  const poolCfg = resolveAdaptiveFrontierPoolPaths(ctx)
  if (!poolCfg.salvagePoolPath && !poolCfg.quarantinePoolPath) {
    return {
      enabled: false,
      persisted: false,
      salvagePoolPath: "",
      quarantinePoolPath: "",
      addedBoostCount: 0,
      addedPenaltyCount: 0,
      addedQuarantineCount: 0,
      totalBoostCount: 0,
      totalPenaltyCount: 0,
      totalQuarantineCount: 0
    }
  }

  const sourceItems = Array.isArray(classificationSources) && classificationSources.length > 0
    ? classificationSources
    : [
        {
          classificationPath,
          runId: champion?.runId ?? ctx?.runId,
          round: champion?.round ?? null,
          roundTag: champion?.roundTag ?? null,
          cTag: champion?.cTag ?? null,
          sessionId: champion?.sessionId ?? null,
          lineAccepted: null,
          discardReason: null,
          sourceStepD: null,
          sourceStepE: null,
          eNotRunReason: null,
          candidateMode: null
        }
      ]
  const classifiedSources = []
  for (const source of sourceItems) {
    const pathValue = String(source?.classificationPath ?? "").trim()
    if (!pathValue) continue
    const rawClassification = await readJson(pathValue, null).catch(() => null)
    const rows = Array.isArray(rawClassification?.rows) ? rawClassification.rows : []
    if (rows.length <= 0) continue
    classifiedSources.push({
      path: pathValue,
      rows,
      source
    })
  }
  if (classifiedSources.length <= 0) {
    return {
      enabled: true,
      persisted: false,
      reason: "NO_CLASSIFICATION_ROWS",
      salvagePoolPath: poolCfg.salvagePoolPath,
      quarantinePoolPath: poolCfg.quarantinePoolPath,
      addedBoostCount: 0,
      addedPenaltyCount: 0,
      addedQuarantineCount: 0,
      totalBoostCount: 0,
      totalPenaltyCount: 0,
      totalQuarantineCount: 0
    }
  }

  const buildEntries = ({ bucket, reason, bias, quarantineOnly = false }) =>
    classifiedSources.flatMap(({ rows, source }) =>
      rows
        .filter((row) =>
          quarantineOnly
            ? String(row?.bucket ?? "") === "WATCH" && row?.underperf === true
            : String(row?.bucket ?? "") === bucket,
        )
        .map((row) =>
          buildPatternPoolEntry({
            row,
            entryType: quarantineOnly ? "quarantine" : bucket === "DROP" ? "penalty" : "boost",
            prototypeLookup,
            bias,
            reason,
            runId: source?.runId ?? champion?.runId ?? ctx?.runId,
            round: source?.round ?? champion?.round,
            roundTag: source?.roundTag ?? champion?.roundTag,
            cTag: source?.cTag ?? champion?.cTag,
            sourceRound: source?.round ?? champion?.round,
            sourceRoundTag: source?.roundTag ?? champion?.roundTag,
            sourceCTag: source?.cTag ?? champion?.cTag,
            sourceSessionId: source?.sessionId ?? champion?.sessionId ?? null,
            sourceSessionEnded: true,
            sourceLineAccepted:
              typeof source?.lineAccepted === "boolean" ? source.lineAccepted : null,
            sourceDiscardReason: source?.discardReason ?? null,
            sourceStepD: source?.sourceStepD ?? null,
            sourceStepE: source?.sourceStepE ?? null,
            eNotRunReason: source?.eNotRunReason ?? null,
            sourceCandidateMode: source?.candidateMode ?? null
          }),
        )
        .filter(Boolean),
    )

  const boostCandidates = buildEntries({
    bucket: "CORE",
    reason: "CORE_TARGET_FIRST",
    bias: poolCfg.salvageBoostBias
  })

  const penaltyCandidates = buildEntries({
    bucket: "DROP",
    reason: "DROP_TARGET_FIRST",
    bias: poolCfg.salvagePenaltyBias
  })

  const quarantineCandidates = buildEntries({
    reason: "WATCH_UNDERPERF_QUARANTINE",
    bias: 0,
    quarantineOnly: true
  })

  let totalBoostCount = 0
  let totalPenaltyCount = 0
  let totalQuarantineCount = 0
  let totalRetiredCount = 0
  if (poolCfg.salvagePoolPath) {
    const current = await readJson(poolCfg.salvagePoolPath, null).catch(() => null)
    const nextBoost = mergePatternPoolEntries({
      existing: current?.salvagedBoostPatterns,
      incoming: boostCandidates,
      type: "boost",
      maxEntries: poolCfg.maxSalvageEntries
    })
    const nextPenalty = mergePatternPoolEntries({
      existing: current?.salvagedPenaltyPatterns,
      incoming: penaltyCandidates,
      type: "penalty",
      maxEntries: poolCfg.maxSalvageEntries
    })
    totalBoostCount = nextBoost.length
    totalPenaltyCount = nextPenalty.length
    await writeJson(poolCfg.salvagePoolPath, {
      version: 2,
      updatedAt: new Date().toISOString(),
      salvagedBoostPatterns: nextBoost,
      salvagedPenaltyPatterns: nextPenalty,
      coreBoostPatterns: nextBoost.filter((row) => String(row?.promotedToCoreAt ?? "").trim()),
      corePenaltyPatterns: nextPenalty.filter((row) => String(row?.promotedToCoreAt ?? "").trim())
    })
  }
  if (poolCfg.quarantinePoolPath) {
    const current = await readJson(poolCfg.quarantinePoolPath, null).catch(() => null)
    const nextQuarantine = mergePatternPoolEntries({
      existing: current?.quarantinedPatterns,
      incoming: quarantineCandidates,
      type: "quarantine",
      maxEntries: poolCfg.maxQuarantineEntries
    })
    const retiredPatterns = nextQuarantine.filter((row) => String(row?.retiredAt ?? "").trim())
    const activeQuarantine = nextQuarantine.filter((row) => !String(row?.retiredAt ?? "").trim())
    totalQuarantineCount = activeQuarantine.length
    totalRetiredCount = retiredPatterns.length
    await writeJson(poolCfg.quarantinePoolPath, {
      version: 2,
      updatedAt: new Date().toISOString(),
      quarantinedPatterns: activeQuarantine,
      retiredPatterns
    })
  }

  return {
    enabled: true,
    persisted: true,
    salvagePoolPath: poolCfg.salvagePoolPath,
    quarantinePoolPath: poolCfg.quarantinePoolPath,
    sourceRound: champion?.round ?? null,
    sourceRoundTag: champion?.roundTag ?? null,
    sourceCTag: champion?.cTag ?? null,
    sourceClassificationPath: classificationPath || null,
    sourceClassificationCount: classifiedSources.length,
    addedBoostCount: boostCandidates.length,
    addedPenaltyCount: penaltyCandidates.length,
    addedQuarantineCount: quarantineCandidates.length,
    totalBoostCount,
    totalPenaltyCount,
    totalQuarantineCount,
    totalRetiredCount
  }
}

const pickBestEpoch = (epochs) => {
  const list = Array.isArray(epochs) ? epochs.slice() : []
  list.sort((a, b) => {
    const c = compareMetrics(a?.metrics, b?.metrics)
    if (c !== 0) return c > 0 ? -1 : 1
    return cmpNumber(a?.epoch, b?.epoch, false)
  })
  return list[0] ?? null
}

const calcPrototypeChangeRate = (prevLibrary, nextLibrary) => {
  const prevIds = new Set((prevLibrary?.prototypes ?? []).map((row) => String(row?.templateId ?? "").trim()).filter(Boolean))
  const nextIds = new Set((nextLibrary?.prototypes ?? []).map((row) => String(row?.templateId ?? "").trim()).filter(Boolean))
  if (!prevIds.size && !nextIds.size) return 0
  let inter = 0
  for (const id of prevIds) {
    if (nextIds.has(id)) inter += 1
  }
  const union = prevIds.size + nextIds.size - inter
  if (union <= 0) return 0
  return 1 - inter / union
}

const buildSweepMargins = ({ base, deltas }) => {
  const out = new Set()
  out.add(Math.max(0, base))
  for (const delta of deltas ?? []) {
    const candidate = Math.max(0, base + Number(delta))
    out.add(Number(candidate.toFixed(6)))
  }
  return Array.from(out).sort((a, b) => a - b)
}

const shouldEnableInversionAdjust = ({ metrics, cfg }) => {
  if (cfg?.enabled !== true) return false
  if (Number(metrics?.dualPickDays ?? 0) < Number(cfg?.minDualPickDays ?? 12)) return false
  const rateDelta = Number(metrics?.secondPickHitRate ?? 0) - Number(metrics?.firstPickHitRate ?? 0)
  if (rateDelta < Number(cfg?.minRateDelta ?? 0.08)) return false
  if (Number(metrics?.secondBeatFirstDays ?? 0) < Number(cfg?.minBeatDays ?? 3)) return false
  return true
}

const applyInversionAdjustToConfig = ({ ctx, state, cfg }) => {
  ctx.config.decisionGate = {
    ...(ctx.config.decisionGate ?? {}),
    inversionAdjust: {
      enabled: state?.enabled === true,
      maxSwapMargin: Number(cfg?.maxSwapMargin ?? 0.02),
      secondBoost: Number(state?.secondBoost ?? 0),
      qualityWeight: Number(cfg?.qualityWeight ?? 0.04)
    }
  }
}

const evaluateSweepImprovement = ({
  candidateMetrics,
  baseMetrics,
  cfg
}) => {
  const candidate = candidateMetrics ?? {}
  const base = baseMetrics ?? {}
  const betterByComparator = compareMetrics(candidate, base) > 0
  const minPickedCountFloor = Math.max(
    resolvePromotionPickedFloor(cfg),
    Number(cfg?.minPickedCountForPromotion ?? 0) || 0,
  )
  const maxPickedCountCeil = resolvePromotionPickedCeil({
    cfg,
    floor: minPickedCountFloor
  })
  const minHitCountFloor = Math.max(0, Number(cfg?.scoreMarginSweep?.minPickHitCount ?? 0) || 0)
  const minLcbGain = Math.max(0, Number(cfg?.scoreMarginSweep?.minPickHitRateLcb95Gain ?? 0) || 0)
  const minConversionGain = Math.max(
    0,
    Number(
      cfg?.scoreMarginSweep?.minBudgetedConversion80Gain ??
      cfg?.scoreMarginSweep?.minTop1ToOracleConversionGain ??
      0,
    ) || 0,
  )
  const pickedCount = Number(candidate?.pickedCount ?? 0) || 0
  const hitCount = Number(candidate?.pickHitCount ?? 0) || 0
  const lcbGain = Number(candidate?.pickHitRateLcb95 ?? 0) - Number(base?.pickHitRateLcb95 ?? 0)
  const conversionGain =
    Number(candidate?.budgetedConversion80 ?? 0) - Number(base?.budgetedConversion80 ?? 0)
  const sampleOk = pickedCount >= minPickedCountFloor
  const sampleUpperOk = !Number.isFinite(maxPickedCountCeil) || pickedCount <= maxPickedCountCeil
  const hitCountOk = hitCount >= minHitCountFloor
  const lcbOk = lcbGain >= minLcbGain
  const conversionOk = conversionGain >= minConversionGain
  const improved = betterByComparator && sampleOk && sampleUpperOk && hitCountOk && lcbOk && conversionOk
  const reasons = []
  if (!betterByComparator) reasons.push("COMPARATOR_NOT_BETTER")
  if (!sampleOk) reasons.push("PICKED_COUNT_LOW")
  if (!sampleUpperOk) reasons.push("PICKED_COUNT_HIGH")
  if (!hitCountOk) reasons.push("PICK_HIT_COUNT_LOW")
  if (!lcbOk) reasons.push("LCB_GAIN_LOW")
  if (!conversionOk) reasons.push("CONVERSION_GAIN_LOW")
  if (!reasons.length) reasons.push("PASS")
  return {
    improved,
    improvedReason: reasons.join("|"),
    checks: {
      betterByComparator,
      sampleOk,
      sampleUpperOk,
      hitCountOk,
      lcbOk,
      conversionOk,
      pickedCount,
      minPickedCountFloor,
      maxPickedCountCeil,
      hitCount,
      minHitCountFloor,
      lcbGain,
      minLcbGain,
      conversionGain,
      minConversionGain
    }
  }
}

const runMarginSweep = async ({
  ctx,
  round,
  roundDir,
  cfg,
  baseMetrics,
  baseMargin,
  startWeightsPath,
  sweepCache
}) => {
  if (cfg?.scoreMarginSweep?.enabled !== true) {
    return {
      executed: false,
      improved: false,
      best: null,
      rows: []
    }
  }
  if (ctx.config?.decisionGate?.useMinScoreMarginGate === false) {
    return {
      executed: false,
      improved: false,
      best: null,
      rows: []
    }
  }
  const margins = buildSweepMargins({
    base: Number(baseMargin ?? 0),
    deltas: cfg.scoreMarginSweep.deltas
  })
  if (!margins.length) {
    return {
      executed: false,
      improved: false,
      best: null,
      rows: []
    }
  }

  const originalMargin = Number(ctx.config?.decisionGate?.minScoreMargin ?? 0)
  const originalStart = String(ctx.config?.onlineLearning?.startWeightsPath ?? "")
  const epochStepDExecutionProfile = resolveCdLoopEpochStepDExecutionProfile(ctx)
  const rows = []
  const sweepDir = path.join(roundDir, "margin-sweep")
  const gateSnapshot = {
    minFinalScore: Number(ctx.config?.decisionGate?.minFinalScore ?? 0),
    minExpectedNetRet3d: Number(ctx.config?.decisionGate?.minExpectedNetRet3d ?? -1),
    maxScoreMargin: num(ctx.config?.decisionGate?.maxScoreMargin),
    requirePositiveExpectedNetRet3d: ctx.config?.decisionGate?.requirePositiveExpectedNetRet3d === true,
    useScoreMarginGate: ctx.config?.decisionGate?.useScoreMarginGate !== false,
    secondPick: clonePlain(ctx.config?.decisionGate?.secondPick ?? {}),
    inversionAdjust: clonePlain(ctx.config?.decisionGate?.inversionAdjust ?? {})
  }
  const startWeightsHash = await hashFileSha1(String(startWeightsPath ?? ""))
  const sweepKey = hashTextSha1(
    JSON.stringify({
      baseMargin: Number(baseMargin ?? 0),
      margins,
      startWeightsHash,
      startWeightsPath: String(startWeightsPath ?? ""),
      gateSnapshot
    }),
  )
  const cachedSweep = sweepCache?.map?.get(sweepKey) ?? null
  await ensureDir(sweepDir)

  if (cachedSweep && Array.isArray(cachedSweep?.rows) && cachedSweep.rows.length > 0) {
    const cachedRows = cachedSweep.rows.map((it) => ({
      margin: Number(it?.margin ?? 0),
      metrics: it?.metrics ?? {},
      startWeightsPath: String(it?.startWeightsPath ?? startWeightsPath ?? ""),
      stepDExecutionProfile: normalizeStepDExecutionProfile(
        it?.stepDExecutionProfile,
        epochStepDExecutionProfile,
      ),
      weightsPath: "",
      summaryPath: "",
      logsPath: ""
    }))
    const sortedCached = cachedRows.slice().sort((a, b) => compareMetrics(b.metrics, a.metrics))
    const cachedBest = sortedCached[0] ?? null
    const cachedEval = evaluateSweepImprovement({
      candidateMetrics: cachedBest?.metrics,
      baseMetrics,
      cfg
    })
    const cachedImproved = cachedEval.improved

    console.log(
      JSON.stringify({
        mode: "cd-loop",
        stage: "sweep-cache-hit",
        round,
        sweepKey,
        rows: cachedRows.length,
        improved: cachedImproved,
        improvedReason: cachedEval.improvedReason
      }),
    )

    let best = null
    try {
      if (cachedImproved && cachedBest) {
        ctx.config.decisionGate = {
          ...(ctx.config.decisionGate ?? {}),
          minScoreMargin: Number(cachedBest.margin ?? baseMargin)
        }
        ctx.config.onlineLearning = {
          ...(ctx.config.onlineLearning ?? {}),
          startWeightsPath: String(startWeightsPath ?? "")
        }
        const stepD = await runStepDWithExecutionProfile({
          ctx,
          profile: epochStepDExecutionProfile
        })
        const metrics = summarizeEpoch({
          stepDSummary: stepD.summary,
          cfg
        })
        const key = `m_${String(cachedBest.margin).replace(/\./g, "_")}`
        const sweepItemDir = path.join(sweepDir, key)
        const sweepArtifacts = await copyStepDArtifactsForStepE({
          stepD,
          outDir: sweepItemDir
        })
        const {
          weightsHash,
          policyFingerprint
        } = await resolveNoOpPolicyArtifacts({
          stepDSummary: stepD?.summary,
          sampledDebugPath: sweepArtifacts.sampledDebugPath,
          weightsPath: sweepArtifacts.weightsPath,
          stage: "sweep-cache-hit",
          round,
          requireSampledDebug: cfg?.noOpPolicy?.requireSampledDebug !== false
        })
        best = {
          margin: Number(cachedBest.margin ?? baseMargin),
          metrics,
          startWeightsPath: String(startWeightsPath ?? ""),
          stepDExecutionProfile: String(stepD?.summary?.stepDExecutionProfile ?? epochStepDExecutionProfile),
          weightsPath: sweepArtifacts.weightsPath,
          artifactManifestPath: sweepArtifacts.artifactManifestPath,
          summaryPath: sweepArtifacts.summaryPath,
          logsPath: sweepArtifacts.logsPath,
          sampledDebugPath: sweepArtifacts.sampledDebugPath,
          policyStatePath: sweepArtifacts.policyStatePath,
          candidateIndexPath: sweepArtifacts.candidateIndexPath,
          candidateIndexMetaPath: sweepArtifacts.candidateIndexMetaPath,
          featurePackPath: sweepArtifacts.featurePackPath,
          featurePackMetaPath: sweepArtifacts.featurePackMetaPath,
          d1RankedCandidatesPath: sweepArtifacts.d1RankedCandidatesPath,
          d2ExecutionAuditPath: sweepArtifacts.d2ExecutionAuditPath,
          d1LockboxRankedCandidatesPath: sweepArtifacts.d1LockboxRankedCandidatesPath,
          d2LockboxExecutionAuditPath: sweepArtifacts.d2LockboxExecutionAuditPath,
          weightsHash,
          policyFingerprint
        }
      }

      await writeJson(path.join(sweepDir, "sweep_summary.json"), {
        generatedAt: new Date().toISOString(),
        round,
        reused: true,
        sweepKey,
        baseMargin,
        baseMetrics,
        improved: cachedImproved,
        improvedReason: cachedEval.improvedReason,
        improvedChecks: cachedEval.checks,
        best: cachedBest
          ? {
              margin: Number(cachedBest.margin ?? 0),
              metrics: cachedBest.metrics
            }
          : null,
        rows: cachedRows
      })
    } finally {
      ctx.config.decisionGate = {
        ...(ctx.config.decisionGate ?? {}),
        minScoreMargin: originalMargin
      }
      ctx.config.onlineLearning = {
        ...(ctx.config.onlineLearning ?? {}),
        startWeightsPath: originalStart
      }
    }

    return {
      executed: true,
      reused: true,
      improved: cachedImproved,
      improvedReason: cachedEval.improvedReason,
      improvedChecks: cachedEval.checks,
      best,
      rows: cachedRows
    }
  }

  try {
    for (const margin of margins) {
      ctx.config.decisionGate = {
        ...(ctx.config.decisionGate ?? {}),
        minScoreMargin: margin
      }
      ctx.config.onlineLearning = {
        ...(ctx.config.onlineLearning ?? {}),
        startWeightsPath: String(startWeightsPath ?? "")
      }
      const stepD = await runStepDWithExecutionProfile({
        ctx,
        profile: epochStepDExecutionProfile
      })
      const metrics = summarizeEpoch({
        stepDSummary: stepD.summary,
        cfg
      })
      const key = `m_${String(margin).replace(/\./g, "_")}`
      const sweepItemDir = path.join(sweepDir, key)
      const sweepArtifacts = await copyStepDArtifactsForStepE({
        stepD,
        outDir: sweepItemDir
      })
      const {
        weightsHash,
        policyFingerprint
      } = await resolveNoOpPolicyArtifacts({
        stepDSummary: stepD?.summary,
        sampledDebugPath: sweepArtifacts.sampledDebugPath,
        weightsPath: sweepArtifacts.weightsPath,
        stage: "sweep",
        round,
        requireSampledDebug: cfg?.noOpPolicy?.requireSampledDebug !== false
      })
      rows.push({
        margin,
        metrics,
        startWeightsPath: String(startWeightsPath ?? ""),
        stepDExecutionProfile: String(stepD?.summary?.stepDExecutionProfile ?? epochStepDExecutionProfile),
        weightsPath: sweepArtifacts.weightsPath,
        artifactManifestPath: sweepArtifacts.artifactManifestPath,
        summaryPath: sweepArtifacts.summaryPath,
        logsPath: sweepArtifacts.logsPath,
        sampledDebugPath: sweepArtifacts.sampledDebugPath,
        policyStatePath: sweepArtifacts.policyStatePath,
        candidateIndexPath: sweepArtifacts.candidateIndexPath,
        candidateIndexMetaPath: sweepArtifacts.candidateIndexMetaPath,
        featurePackPath: sweepArtifacts.featurePackPath,
        featurePackMetaPath: sweepArtifacts.featurePackMetaPath,
        d1RankedCandidatesPath: sweepArtifacts.d1RankedCandidatesPath,
        d2ExecutionAuditPath: sweepArtifacts.d2ExecutionAuditPath,
        weightsHash,
        policyFingerprint
      })
      console.log(
        JSON.stringify({
          mode: "cd-loop",
          stage: "sweep",
          round,
          margin,
          pickHitRate: metrics.pickHitRate,
          pickHitCount: metrics.pickHitCount
        }),
      )
    }
  } finally {
    ctx.config.decisionGate = {
      ...(ctx.config.decisionGate ?? {}),
      minScoreMargin: originalMargin
    }
    ctx.config.onlineLearning = {
      ...(ctx.config.onlineLearning ?? {}),
      startWeightsPath: originalStart
    }
  }

  if (!rows.length) {
    return { executed: true, improved: false, best: null, rows }
  }
  const sorted = rows.slice().sort((a, b) => compareMetrics(b.metrics, a.metrics))
  const best = sorted[0]
  const sweepEval = evaluateSweepImprovement({
    candidateMetrics: best?.metrics,
    baseMetrics,
    cfg
  })
  const improved = sweepEval.improved

  await writeJson(path.join(sweepDir, "sweep_summary.json"), {
    generatedAt: new Date().toISOString(),
    round,
    reused: false,
    sweepKey,
    baseMargin,
    baseMetrics,
    improved,
    improvedReason: sweepEval.improvedReason,
    improvedChecks: sweepEval.checks,
    best: {
      margin: best.margin,
      metrics: best.metrics
    },
    rows
  })

  if (sweepCache?.map) {
    sweepCache.map.delete(sweepKey)
    sweepCache.map.set(sweepKey, {
      updatedAt: new Date().toISOString(),
      source: String(ctx.runId ?? "unknown"),
      rows: rows.map((it) => ({
        margin: Number(it?.margin ?? 0),
        metrics: it?.metrics ?? {}
      }))
    })
    if (typeof sweepCache.save === "function") {
      await sweepCache.save()
    }
  }

  return {
    executed: true,
    reused: false,
    improved,
    improvedReason: sweepEval.improvedReason,
    improvedChecks: sweepEval.checks,
    best,
    rows
  }
}

export const runCdLoop = async ({ ctx, flags }) => {
  const ignoreAbHash = String(flags?.["ab-ignore-config-hash"] ?? "false")
    .trim()
    .toLowerCase() === "true"
  const abBinding = await resolveActiveAbBinding({
    cwd: ctx.cwd,
    config: ctx.config,
    requestedAbRunId: flags?.["ab-run-id"],
    ignoreConfigHash: ignoreAbHash
  })
  ensureStepBArtifacts(abBinding.abRunDir)
  ctx.abRunId = abBinding.abRunId
  ctx.abRunDir = abBinding.abRunDir
  const cfg = resolveCdLoopConfig({ cfg: ctx.config, flags })
  const sampledDebugLog = enforceStepDSampledDebugForCdLoop(ctx)
  console.log(
    JSON.stringify({
      mode: "cd-loop",
      stage: "config",
      sampledDebugLog
    }),
  )
  const holdoutPolicy = ctx.config?.holdoutPolicy ?? {}
  if (holdoutPolicy?.enabled !== false) {
    const minEvalDays = Math.max(1, Math.floor(Number(holdoutPolicy?.minEvalDays ?? 20) || 20))
    const minLockboxDays = Math.max(1, Math.floor(Number(holdoutPolicy?.minLockboxDays ?? 20) || 20))
    const evalMinDaysCfg = Math.max(
      0,
      Math.floor(Number(ctx.config?.onlineLearning?.generalization?.evalMinDays ?? 0) || 0),
    )
    if (evalMinDaysCfg < minEvalDays) {
      throw new Error(
        `holdoutPolicy violation: evalMinDays=${evalMinDaysCfg} < required=${minEvalDays}`,
      )
    }
    const lockboxDays = dateSpanDaysInclusive(ctx.periods?.lockbox ?? {})
    if (lockboxDays < minLockboxDays) {
      throw new Error(
        `holdoutPolicy violation: lockboxDays=${lockboxDays} < required=${minLockboxDays}`,
      )
    }
  }
  const stepDBaseCfg = ctx.config.lightweight?.stepD ?? {}
  const envScoringWorkersRaw = Number(process.env.CD_LOOP_SCORING_WORKERS)
  const envWorkerChunkSizeRaw = Number(process.env.CD_LOOP_WORKER_CHUNK_SIZE)
  const envScoringWorkers = Number.isFinite(envScoringWorkersRaw) ? envScoringWorkersRaw : null
  const envWorkerChunkSize = Number.isFinite(envWorkerChunkSizeRaw) ? envWorkerChunkSizeRaw : null
  ctx.config.lightweight = {
    ...(ctx.config.lightweight ?? {}),
    stepD: buildCdLoopStepDLightProfile({
      stepDBaseCfg,
      scoringWorkers: envScoringWorkers ?? stepDBaseCfg.scoringWorkers ?? 2,
      workerChunkSize: envWorkerChunkSize ?? stepDBaseCfg.workerChunkSize ?? 512
    })
  }
  const sessionId = String(flags?.["session-id"] ?? `cd_${toDateTag()}`)
  const lineageSnapshot = buildCdLoopLineageSnapshot({
    config: ctx.config,
    periods: ctx.periods,
    abRunId: ctx.abRunId
  })
  const lineageKey = computeLineageKey(lineageSnapshot)
  const lineageStatePaths = resolveLineageStatePaths({
    cwd: ctx.cwd,
    lineageKey
  })
  await ensureDir(lineageStatePaths.dir)
  ctx.__runtime = ctx.__runtime ?? {}
  ctx.__runtime.lineageKey = lineageKey
  const loopDir = path.join(ctx.runDir, "cd-loop", sessionId)
  await ensureDir(loopDir)
  const probeLane = normalizeProbeLane(flags?.["probe-lane"] ?? "operating")
  const acceptedBaselineRecord = await loadAcceptedBaselineRecord({
    lineageStateDir: lineageStatePaths.dir,
    probeRootDir: path.join(ctx.runDir, "cd-loop")
  })
  const candidatePeakRecord = await loadCandidatePeakRecord({
    lineageStateDir: lineageStatePaths.dir,
    probeRootDir: path.join(ctx.runDir, "cd-loop")
  })
  const acceptedBaselineSeed = resolveAcceptedBaselineSeed({
    record: acceptedBaselineRecord
  })
  const candidatePeakSeed = resolveCandidatePeakSeed({
    record: candidatePeakRecord
  })
  const acceptedBaselineKey = resolveAcceptedBaselineKey({
    seed: acceptedBaselineSeed,
    record: acceptedBaselineRecord
  })
  const candidatePeakKey = resolveProgressRecordKey({
    seed: candidatePeakSeed,
    record: candidatePeakRecord
  })
  const probeLaneCfg = resolveProbeLaneConfig({
    cfg,
    probeLane
  })
  const selectedParentSeed = probeLane === "research" ? candidatePeakSeed : acceptedBaselineSeed
  const selectedParentRecord = probeLane === "research" ? candidatePeakRecord : acceptedBaselineRecord
  const selectedParentKey = probeLane === "research" ? candidatePeakKey : acceptedBaselineKey
  const selectedParentMode = probeLane === "research" ? "candidate_peak" : "accepted_baseline"
  const probeCyclePaths = resolveProbeCycleTrackingPaths({
    cwd: ctx.cwd,
    probeLane,
    parentKey: selectedParentKey,
    lineageKey
  })
  const probeCycleFingerprint = await computeProbeCycleFingerprint({
    cwd: ctx.cwd,
    configPath: ctx.configPath
  })
  const probeCycleState = await loadProbeCycleState({
    probeCyclePaths,
    parentKey: selectedParentKey,
    probeLane,
    probeRootDir: path.join(ctx.runDir, "cd-loop"),
    lineageKey
  })
  const permanentDropPath = lineageStatePaths.dropRegistryPath
  const sessionPermanentDropPath = resolveDropRegistrySnapshotPath(
    path.join(loopDir, "drop_registry_snapshot.json"),
    "permanent_drop_template_ids.json"
  )
  const statePath = path.join(loopDir, "underperf_state.json")
  const commonStatePath = path.join(loopDir, "champion_common_state.json")
  const summaryPath = path.join(loopDir, "cd_loop_summary.json")
  const sweepCachePath = path.join(ctx.cwd, "artifacts", "autopilot", "margin_sweep_cache.json")
  const sweepCacheMap = await loadSweepCache(sweepCachePath)
  const sweepCache = {
    map: sweepCacheMap,
    save: async () => saveSweepCache(sweepCachePath, sweepCacheMap)
  }

  let dropRegistry = await readDropRegistry({
    filePath: permanentDropPath,
    lineageKey
  })
  const permanentDropSet = new Set(resolveEffectiveDropTemplateIds(dropRegistry))
  await writeJson(sessionPermanentDropPath, {
    updatedAt: new Date().toISOString(),
    templateIds: Array.from(permanentDropSet).sort((a, b) => a.localeCompare(b))
  })
  const stateRaw = await readJson(statePath, {})
  const stateMap = new Map(
    Object.entries(stateRaw ?? {}).map(([k, v]) => [
      String(k),
      {
        streak: Number(v?.streak ?? 0) || 0,
        cooldown: Number(v?.cooldown ?? 0) || 0
      }
    ]),
  )
  const prevRoundMetrics = new Map()
  const rounds = []
  const improvementSignals = []
  const swaWeightsPath = path.join(loopDir, "champion_weights_swa.json")

  const initialDecisionGate = { ...(ctx.config?.decisionGate ?? {}) }
  const baselineSecondPickGate = normalizeSecondPickGateConfig(initialDecisionGate?.secondPick ?? {})
  let workingSecondPickGate = normalizeSecondPickGateConfig(initialDecisionGate?.secondPick ?? {})
  let workingMinScoreMargin = Math.max(0, Number(initialDecisionGate?.minScoreMargin ?? 0) || 0)
  let workingMaxScoreMargin = (() => {
    const parsed = num(initialDecisionGate?.maxScoreMargin)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
    return null
  })()
  let carryWeightsPath =
    String(selectedParentSeed?.weightsPath ?? "").trim() ||
    String(ctx.config?.onlineLearning?.startWeightsPath ?? "").trim()
  const probeCycleRuntime = buildProbeCycleRuntime({
    cfg,
    probeLane,
    parentSeed: selectedParentSeed,
    parentRecord: selectedParentRecord,
    parentMode: selectedParentMode,
    fingerprint: probeCycleFingerprint,
    lineageKey,
    prevState: probeCycleState,
    runId: ctx.runId,
    sessionId
  })
  if (
    (
      probeLane === "research"
        ? probeLaneCfg?.enforceResearchParent === true
        : cfg.acceptedBaselineProbeCycle?.enforceAcceptedBaselineParent === true
    ) &&
    selectedParentSeed &&
    String(carryWeightsPath ?? "").trim() !== String(selectedParentSeed?.weightsPath ?? "").trim()
  ) {
    throw new Error(
      `${probeLane} parent violation: carryWeightsPath=${String(carryWeightsPath ?? "")} expected=${String(selectedParentSeed?.weightsPath ?? "")}`,
    )
  }
  if (probeCycleRuntime?.structuralAllowed === false) {
    throw new Error(
      `cd-loop structural experiment blocked until plateau: probeLane=${probeLane} parentKey=${String(probeCycleRuntime?.parentKey ?? "")} prevSessionMode=${String(probeCycleRuntime?.previousSessionMode ?? "")}`,
    )
  }
  let stagnationRounds = 0
  let globalNoImproveRounds = 0
  let zeroOnePickSkewStreak = 0
  let cVersion = 0
  let cRebuildCount = 0

  let bestRound = null
  let championCommonState = await readJson(
    String(selectedParentSeed?.commonStatePath ?? "").trim() || commonStatePath,
    null,
  )
  if (!championCommonState || typeof championCommonState !== "object") {
    championCommonState = null
  }
  const inversionState = {
    enabled: initialDecisionGate?.inversionAdjust?.enabled === true,
    secondBoost: Number(initialDecisionGate?.inversionAdjust?.secondBoost ?? 0) || 0
  }
  let inversionEnableSignalStreak = 0
  let inversionDisableSignalStreak = 0
  const persistPermanentDropState = async () => {
    dropRegistry = {
      ...createEmptyDropRegistry({ lineageKey }),
      ...dropRegistry,
      lineageKey,
      lineageDropSoftTemplateIds: Array.from(permanentDropSet).sort((a, b) => a.localeCompare(b))
    }
    await writeDropRegistry({
      filePath: permanentDropPath,
      registry: dropRegistry
    })
    await writeJson(sessionPermanentDropPath, {
      updatedAt: new Date().toISOString(),
      templateIds: Array.from(permanentDropSet).sort((a, b) => a.localeCompare(b))
    })
  }

  const runAndSnapshotStepCStack = async ({ reason }) => {
    cVersion += 1
    cRebuildCount += 1
    const cTag = `c${String(cVersion).padStart(2, "0")}`
    const cDir = path.join(loopDir, cTag)
    await ensureDir(cDir)
    await persistPermanentDropState()

    ctx.config.pattern = {
      ...(ctx.config.pattern ?? {}),
      permanentDropListPath: permanentDropPath,
      championCommonStatePath: commonStatePath,
      commonState: {
        ...(ctx.config?.pattern?.commonState ?? {}),
        enabled: cfg.commonState.enabled === true
      }
    }
    const stepC0 = await runStepC0(ctx)
    const stepC1 = await runStepC1(ctx)
    const stepC2 = await runStepC2(ctx)
    const stepC = await runStepC(ctx)
    await copyIfExists(stepC0.familyIndexPath, path.join(cDir, "c0_family_index.json"))
    await copyIfExists(stepC0.membershipPath, path.join(cDir, "c0_family_membership.jsonl"))
    await copyIfExists(stepC0.summaryPath, path.join(cDir, "c0_summary.json"))
    await copyIfExists(stepC1.indexPath, path.join(cDir, "c1_family_probe_index.json"))
    await copyIfExists(stepC1.resultsPath, path.join(cDir, "c1_family_probe_results.jsonl"))
    await copyIfExists(stepC1.summaryPath, path.join(cDir, "c1_summary.json"))
    await copyIfExists(stepC2.indexPath, path.join(cDir, "c2_dedup_index.json"))
    await copyIfExists(stepC2.groupsPath, path.join(cDir, "c2_dedup_groups.jsonl"))
    await copyIfExists(stepC2.summaryPath, path.join(cDir, "c2_summary.json"))
    await copyIfExists(stepC.libraryPath, path.join(cDir, "pattern_library.json"))
    await copyIfExists(stepC.runtimePath, path.join(cDir, "pattern_library_runtime.json"))
    await copyIfExists(stepC.summaryPath, path.join(cDir, "step_c_summary.json"))
    await copyIfExists(stepC.indexManifestPath, path.join(cDir, "step_c_index_manifest.json"))
    await copyIfExists(stepC.shapingStatePath, path.join(cDir, "step_c_shaping_state.json"))
    await copyIfExists(commonStatePath, path.join(cDir, "champion_common_state.json"))

    const library = await readJson(stepC.libraryPath, null)
    if (!library) throw new Error("cd-loop failed: step-c library missing")
    return {
      reason,
      cTag,
      cDir,
      stepC0,
      stepC1,
      stepC2,
      stepC,
      library,
      prototypeLookup: buildPrototypeLookup(library),
      clusterByPrototype: buildPrototypeClusterMap(library)
    }
  }

  let currentC = await runAndSnapshotStepCStack({ reason: "INIT" })
  cRebuildCount = 1

  for (let round = 1; round <= cfg.maxRounds; round += 1) {
    const roundTag = `r${String(round).padStart(2, "0")}`
    const roundDir = path.join(loopDir, roundTag)
    const roundUsedCTag = currentC.cTag
    await ensureDir(roundDir)
    await ensureDir(path.join(roundDir, "step-c"))
    await ensureDir(path.join(roundDir, "step-c0"))
    await ensureDir(path.join(roundDir, "step-c1"))
    await ensureDir(path.join(roundDir, "step-c2"))
    await copyIfExists(path.join(currentC.cDir, "c0_family_index.json"), path.join(roundDir, "step-c0", "c0_family_index.json"))
    await copyIfExists(
      path.join(currentC.cDir, "c0_family_membership.jsonl"),
      path.join(roundDir, "step-c0", "c0_family_membership.jsonl"),
    )
    await copyIfExists(path.join(currentC.cDir, "c0_summary.json"), path.join(roundDir, "step-c0", "c0_summary.json"))
    await copyIfExists(
      path.join(currentC.cDir, "c1_family_probe_index.json"),
      path.join(roundDir, "step-c1", "c1_family_probe_index.json"),
    )
    await copyIfExists(
      path.join(currentC.cDir, "c1_family_probe_results.jsonl"),
      path.join(roundDir, "step-c1", "c1_family_probe_results.jsonl"),
    )
    await copyIfExists(path.join(currentC.cDir, "c1_summary.json"), path.join(roundDir, "step-c1", "c1_summary.json"))
    await copyIfExists(path.join(currentC.cDir, "c2_dedup_index.json"), path.join(roundDir, "step-c2", "c2_dedup_index.json"))
    await copyIfExists(path.join(currentC.cDir, "c2_dedup_groups.jsonl"), path.join(roundDir, "step-c2", "c2_dedup_groups.jsonl"))
    await copyIfExists(path.join(currentC.cDir, "c2_summary.json"), path.join(roundDir, "step-c2", "c2_summary.json"))
    await copyIfExists(path.join(currentC.cDir, "pattern_library.json"), path.join(roundDir, "step-c", "pattern_library.json"))
    await copyIfExists(path.join(currentC.cDir, "pattern_library_runtime.json"), path.join(roundDir, "step-c", "pattern_library_runtime.json"))
    await copyIfExists(path.join(currentC.cDir, "step_c_summary.json"), path.join(roundDir, "step-c", "step_c_summary.json"))
    await copyIfExists(path.join(currentC.cDir, "step_c_index_manifest.json"), path.join(roundDir, "step-c", "step_c_index_manifest.json"))
    await copyIfExists(path.join(currentC.cDir, "step_c_shaping_state.json"), path.join(roundDir, "step-c", "step_c_shaping_state.json"))

    const epochRows = []
    let warmStartPath = carryWeightsPath
    let bestPickHitRateInRound = Number.NEGATIVE_INFINITY
    let bestPickHitCountInRound = Number.NEGATIVE_INFINITY
    let noRateImproveStreak = 0
    let noCountImproveStreak = 0
    let noOpPolicyEpochStreak = 0
    let earlyStopReason = null
    let prevEpochMetrics = null
    let prevEpochRow = null
    let provisionalBestEpochRow = null
    const epochStepDExecutionProfile = resolveCdLoopEpochStepDExecutionProfile(ctx)

    for (let epoch = 1; epoch <= cfg.maxEpochsPerRound; epoch += 1) {
      ctx.config.decisionGate = {
        ...(ctx.config.decisionGate ?? {}),
        minScoreMargin: workingMinScoreMargin,
        maxScoreMargin: workingMaxScoreMargin,
        secondPick: clonePlain(workingSecondPickGate)
      }
      applyInversionAdjustToConfig({
        ctx,
        state: inversionState,
        cfg: cfg.inversion
      })
      ctx.config.onlineLearning = {
        ...(ctx.config.onlineLearning ?? {}),
        startWeightsPath: String(warmStartPath ?? "")
      }
      const epochStartWeightsPath = String(warmStartPath ?? "")

      const stepD = await runStepDWithExecutionProfile({
        ctx,
        profile: epochStepDExecutionProfile
      })
      const metrics = summarizeEpoch({
        stepDSummary: stepD.summary,
        cfg
      })
      const epochDir = path.join(roundDir, `e${String(epoch).padStart(2, "0")}`)
      const epochArtifacts = await copyStepDArtifactsForStepE({
        stepD,
        outDir: epochDir,
        mode: "minimal"
      })
      const {
        weightsHash,
        policyFingerprint
      } = await resolveNoOpPolicyArtifacts({
        stepDSummary: stepD?.summary,
        sampledDebugPath: epochArtifacts.sampledDebugPath,
        weightsPath: epochArtifacts.weightsPath,
        stage: "epoch",
        round,
        epoch,
        requireSampledDebug: cfg?.noOpPolicy?.requireSampledDebug !== false
      })
      const noOpPolicyEpochDetail = evaluateNoOpPolicyChange({
        prev: prevEpochRow,
        next: {
          weightsHash,
          policyFingerprint
        }
      })
      const noOpPolicyEpoch = noOpPolicyEpochDetail.isNoOp === true
      await writeJson(path.join(epochDir, "epoch_metrics.json"), metrics)

      if (metrics.pickHitRate >= bestPickHitRateInRound + cfg.minHitRateImprove) {
        bestPickHitRateInRound = metrics.pickHitRate
        noRateImproveStreak = 0
      } else {
        noRateImproveStreak += 1
      }
      if (metrics.pickHitCount > bestPickHitCountInRound) {
        bestPickHitCountInRound = metrics.pickHitCount
        noCountImproveStreak = 0
      } else {
        noCountImproveStreak += 1
      }

      const recommendationDrift =
        !!prevEpochMetrics &&
        Number(metrics.pickedDays ?? 0) > Number(prevEpochMetrics.pickedDays ?? 0) &&
        Number(metrics.pickHitCount ?? 0) <= Number(prevEpochMetrics.pickHitCount ?? 0)
      if (
        epoch >= cfg.minEpochsPerRound &&
        recommendationDrift &&
        !earlyStopReason
      ) {
        earlyStopReason = "RECOMMENDATION_DRIFT"
      }

      const epochRow = {
        epoch,
        metrics,
        stepD,
        summaryPath: epochArtifacts.summaryPath,
        logsPath: epochArtifacts.logsPath,
        weightsPath: epochArtifacts.weightsPath,
        artifactManifestPath: epochArtifacts.artifactManifestPath,
        sampledDebugPath: epochArtifacts.sampledDebugPath,
        policyStatePath: epochArtifacts.policyStatePath,
        policyBundlePath: epochArtifacts.policyBundlePath,
        candidateIndexPath: epochArtifacts.candidateIndexPath,
        candidateIndexMetaPath: epochArtifacts.candidateIndexMetaPath,
        featurePackPath: epochArtifacts.featurePackPath,
        featurePackMetaPath: epochArtifacts.featurePackMetaPath,
        d1RankedCandidatesPath: epochArtifacts.d1RankedCandidatesPath,
        d2ExecutionAuditPath: epochArtifacts.d2ExecutionAuditPath,
        d1LockboxRankedCandidatesPath: epochArtifacts.d1LockboxRankedCandidatesPath,
        d2LockboxExecutionAuditPath: epochArtifacts.d2LockboxExecutionAuditPath,
        startWeightsPath: epochStartWeightsPath,
        weightsHash,
        policyFingerprint,
        stepDExecutionProfile: String(stepD?.summary?.stepDExecutionProfile ?? epochStepDExecutionProfile),
        policyIdentity: noOpPolicyEpochDetail.nextIdentity,
        noOpPolicyEpoch
      }
      const betterThanProvisional = (() => {
        if (!provisionalBestEpochRow) return true
        const cmp = compareMetrics(epochRow?.metrics, provisionalBestEpochRow?.metrics)
        if (cmp > 0) return true
        if (cmp < 0) return false
        return cmpNumber(epochRow?.epoch, provisionalBestEpochRow?.epoch, false) < 0
      })()
      if (betterThanProvisional) {
        const epochCopyMode =
          normalizeStepDExecutionProfile(
            stepD?.summary?.stepDExecutionProfile,
            epochStepDExecutionProfile,
          ) === "FAST_ONLINE"
            ? "online_audit"
            : "full"
        const fullEpochArtifacts = await copyStepDArtifactsForStepE({
          stepD,
          outDir: epochDir,
          mode: epochCopyMode
        })
        epochRow.summaryPath = fullEpochArtifacts.summaryPath
        epochRow.logsPath = fullEpochArtifacts.logsPath
        epochRow.weightsPath = fullEpochArtifacts.weightsPath
        epochRow.artifactManifestPath = fullEpochArtifacts.artifactManifestPath
        epochRow.sampledDebugPath = fullEpochArtifacts.sampledDebugPath
        epochRow.policyStatePath = fullEpochArtifacts.policyStatePath
        epochRow.policyBundlePath = fullEpochArtifacts.policyBundlePath
        epochRow.candidateIndexPath = fullEpochArtifacts.candidateIndexPath
        epochRow.candidateIndexMetaPath = fullEpochArtifacts.candidateIndexMetaPath
        epochRow.featurePackPath = fullEpochArtifacts.featurePackPath
        epochRow.featurePackMetaPath = fullEpochArtifacts.featurePackMetaPath
        epochRow.d1RankedCandidatesPath = fullEpochArtifacts.d1RankedCandidatesPath
        epochRow.d2ExecutionAuditPath = fullEpochArtifacts.d2ExecutionAuditPath
        epochRow.d1LockboxRankedCandidatesPath = fullEpochArtifacts.d1LockboxRankedCandidatesPath
        epochRow.d2LockboxExecutionAuditPath = fullEpochArtifacts.d2LockboxExecutionAuditPath
        provisionalBestEpochRow = epochRow
      }
      epochRows.push(epochRow)
      warmStartPath = epochRow.weightsPath
      prevEpochMetrics = metrics
      prevEpochRow = epochRow
      if (noOpPolicyEpoch) {
        noOpPolicyEpochStreak += 1
      } else {
        noOpPolicyEpochStreak = 0
      }

      console.log(
        JSON.stringify({
          mode: "cd-loop",
          stage: "epoch",
          round,
          epoch,
          metricScope: metrics.metricScope,
          hitRate: metrics.pickHitRate,
          pickHitRate: metrics.pickHitRate,
          pickHitCount: metrics.pickHitCount,
          pickedCount: metrics.pickedCount,
          dayHitRate: metrics.hitRate,
          pickedDays: metrics.pickedDays,
          promotionContext: metrics.promotionContext,
          primaryScopeDiagnostics: compactScopeSnapshot(metrics.primaryScopeDiagnostics),
          scopeDiagnostics: {
            all: compactScopeSnapshot(metrics.scopeDiagnostics?.all),
            update: compactScopeSnapshot(metrics.scopeDiagnostics?.update),
            eval: compactScopeSnapshot(metrics.scopeDiagnostics?.eval)
          },
          onePickDays: metrics.onePickDays,
          twoPickDays: metrics.twoPickDays,
          workerPoolScoreMs: metrics.workerPoolScoreMs,
          scoreMsPerSeed: metrics.scoreMsPerSeed,
          stepDExecutionProfile: String(
            stepD?.summary?.stepDExecutionProfile ?? epochStepDExecutionProfile,
          ),
          noCandidateRate: metrics.noCandidateRate,
          avgRegret: metrics.avgRegret,
          noOpPolicyEpoch,
          policyIdentitySource: String(noOpPolicyEpochDetail?.nextIdentity?.source ?? "none")
        }),
      )

      const epochOracleHealthy =
        Number(metrics?.oracleHitRateTopK ?? 0) >= Number(cfg?.dOnlySprint?.oracleTopKFloor ?? 0) &&
        Number(metrics?.oracleCoverageGap ?? 0) <=
          Number(cfg?.dOnlySprint?.oracleCoverageGapMaxForKeepC ?? 0.03)
      const epochNeedsSameCFocus =
        epochOracleHealthy &&
        (
          metrics?.oracleGoodButTop1Bad === true ||
          metrics?.sampleStarvation === true ||
          metrics?.lastExecutionBlockerEval !== null
        )
      const stopByDualPlateau =
        epoch >= cfg.minEpochsPerRound &&
        noRateImproveStreak >= cfg.plateauEpochs &&
        noCountImproveStreak >= cfg.plateauEpochs
      const stopByNoOpPolicy =
        cfg?.noOpPolicy?.enabled === true &&
        noOpPolicyEpochStreak >= Number(cfg?.noOpPolicy?.minNoOpEpochStreak ?? 1)
      const forceSameCEpochBudget =
        epochNeedsSameCFocus &&
        epoch < Number(cfg?.dOnlySprint?.minEpochsWhenOracleHealthy ?? cfg.minEpochsPerRound)
      if (stopByNoOpPolicy && !earlyStopReason) {
        earlyStopReason = "NOOP_POLICY"
      }
      if (forceSameCEpochBudget) {
        earlyStopReason = null
      }
      if (stopByDualPlateau || earlyStopReason) {
        if (forceSameCEpochBudget) {
          continue
        }
        if (!earlyStopReason && stopByDualPlateau) {
          earlyStopReason = "DUAL_PLATEAU"
        }
        break
      }
    }

    const bestEpoch = pickBestEpoch(epochRows)
    if (!bestEpoch) throw new Error(`cd-loop round ${round} has no epoch result`)

    const stagnatedInRound = Boolean(earlyStopReason) && epochRows.length >= cfg.minEpochsPerRound
    if (stagnatedInRound) {
      stagnationRounds += 1
    } else {
      stagnationRounds = 0
    }

    let action = "KEEP_D"
    let sweepResult = null
    let prototypeChangeRate = null
    let newDrops = []
    let cRebuilt = false
    let effectiveMetrics = bestEpoch.metrics
    let effectiveWeightsPath = bestEpoch.weightsPath
    let effectiveArtifactManifestPath = bestEpoch.artifactManifestPath
    let effectiveSummaryPath = bestEpoch.summaryPath
    let effectiveLogsPath = bestEpoch.logsPath
    let effectiveSampledDebugPath = bestEpoch.sampledDebugPath
    let effectivePolicyStatePath = bestEpoch.policyStatePath
    let effectivePolicyBundlePath = bestEpoch.policyBundlePath
    let effectiveCandidateIndexPath = bestEpoch.candidateIndexPath
    let effectiveCandidateIndexMetaPath = bestEpoch.candidateIndexMetaPath
    let effectiveFeaturePackPath = bestEpoch.featurePackPath
    let effectiveFeaturePackMetaPath = bestEpoch.featurePackMetaPath
    let effectiveD1RankedCandidatesPath = bestEpoch.d1RankedCandidatesPath
    let effectiveD2ExecutionAuditPath = bestEpoch.d2ExecutionAuditPath
    let effectiveD1LockboxRankedCandidatesPath = bestEpoch.d1LockboxRankedCandidatesPath
    let effectiveD2LockboxExecutionAuditPath = bestEpoch.d2LockboxExecutionAuditPath
    let effectiveWeightsHash = String(bestEpoch?.weightsHash ?? "")
    let effectivePolicyFingerprint = bestEpoch?.policyFingerprint ?? null
    let effectiveEpochRef = String(bestEpoch.epoch)
    let effectiveStartWeightsPath = String(bestEpoch?.startWeightsPath ?? "")
    let effectiveStepDExecutionProfile = normalizeStepDExecutionProfile(
      bestEpoch?.stepDExecutionProfile,
      "FULL_AUDIT",
    )
    let commonStatePromoted = false
    let rebuildReasonCategory = "NONE"

    if (stagnationRounds >= cfg.stagnationRoundsBeforeRebuildC) {
      sweepResult = await runMarginSweep({
        ctx,
        round,
        roundDir,
        cfg,
        baseMetrics: bestEpoch.metrics,
        baseMargin: workingMinScoreMargin,
        startWeightsPath: carryWeightsPath || bestEpoch.weightsPath,
        sweepCache
      })
      if (sweepResult?.improved && sweepResult?.best) {
        action = "SWEEP_APPLIED"
        workingMinScoreMargin = Number(sweepResult.best.margin ?? workingMinScoreMargin)
        effectiveMetrics = sweepResult.best.metrics ?? effectiveMetrics
        effectiveWeightsPath = String(sweepResult.best.weightsPath ?? effectiveWeightsPath)
        effectiveArtifactManifestPath = String(
          sweepResult.best.artifactManifestPath ?? effectiveArtifactManifestPath ?? "",
        )
        effectiveSummaryPath = String(sweepResult.best.summaryPath ?? effectiveSummaryPath)
        effectiveLogsPath = String(sweepResult.best.logsPath ?? effectiveLogsPath)
        effectiveSampledDebugPath = String(sweepResult.best.sampledDebugPath ?? effectiveSampledDebugPath ?? "")
        effectivePolicyStatePath = String(sweepResult.best.policyStatePath ?? effectivePolicyStatePath ?? "")
        effectivePolicyBundlePath = String(sweepResult.best.policyBundlePath ?? effectivePolicyBundlePath ?? "")
        effectiveCandidateIndexPath = String(
          sweepResult.best.candidateIndexPath ?? effectiveCandidateIndexPath ?? "",
        )
        effectiveCandidateIndexMetaPath = String(
          sweepResult.best.candidateIndexMetaPath ?? effectiveCandidateIndexMetaPath ?? "",
        )
        effectiveFeaturePackPath = String(
          sweepResult.best.featurePackPath ?? effectiveFeaturePackPath ?? "",
        )
        effectiveFeaturePackMetaPath = String(
          sweepResult.best.featurePackMetaPath ?? effectiveFeaturePackMetaPath ?? "",
        )
        effectiveD1RankedCandidatesPath = String(
          sweepResult.best.d1RankedCandidatesPath ?? effectiveD1RankedCandidatesPath ?? "",
        )
        effectiveD2ExecutionAuditPath = String(
          sweepResult.best.d2ExecutionAuditPath ?? effectiveD2ExecutionAuditPath ?? "",
        )
        effectiveD1LockboxRankedCandidatesPath = String(
          sweepResult.best.d1LockboxRankedCandidatesPath ?? effectiveD1LockboxRankedCandidatesPath ?? "",
        )
        effectiveD2LockboxExecutionAuditPath = String(
          sweepResult.best.d2LockboxExecutionAuditPath ?? effectiveD2LockboxExecutionAuditPath ?? "",
        )
        effectiveWeightsHash = String(sweepResult.best.weightsHash ?? effectiveWeightsHash ?? "")
        effectivePolicyFingerprint =
          sweepResult.best.policyFingerprint ?? effectivePolicyFingerprint ?? null
        effectiveEpochRef = `${bestEpoch.epoch}-SWEEP`
        effectiveStartWeightsPath = String(
          sweepResult.best.startWeightsPath ?? effectiveStartWeightsPath ?? "",
        )
        effectiveStepDExecutionProfile = normalizeStepDExecutionProfile(
          sweepResult.best.stepDExecutionProfile,
          effectiveStepDExecutionProfile,
        )
        stagnationRounds = 0
      } else {
        const dOnlyMetrics = bestEpoch?.metrics ?? {}
        const oracleTopK = Number(dOnlyMetrics?.oracleHitRateTopK ?? 0) || 0
        const oracleCoverageGap = Number(dOnlyMetrics?.oracleCoverageGap ?? 0) || 0
        const top1Conversion = Number(dOnlyMetrics?.top1ToOracleConversion ?? 0) || 0
        const evalScope = dOnlyMetrics?.scopeDiagnostics?.eval ?? {}
        const evalTradingDays = Math.max(0, Number(evalScope?.tradingDays ?? 0) || 0)
        const evalPickedCount = Math.max(
          0,
          Number(dOnlyMetrics?.promotionContext?.evalPickedCount ?? dOnlyMetrics?.pickedCount ?? 0) || 0,
        )
        const evalD1TradeDays = Math.max(0, Number(evalScope?.d1TradeDays ?? 0) || 0)
        const evalD2BlockedAfterD1Days = Math.max(
          0,
          Number(evalScope?.d2BlockedAfterD1Days ?? 0) || 0,
        )
        const oracleRecallFloor = Math.max(
          0,
          Number(cfg?.dOnlySprint?.oracleTopKFloor ?? 0.95) || 0.95,
        )
        const oracleCoverageGapMax = Math.max(
          0,
          Number(cfg?.dOnlySprint?.oracleCoverageGapMaxForKeepC ?? 0.03) || 0.03,
        )
        const cRecallFail =
          oracleTopK < oracleRecallFloor || oracleCoverageGap > oracleCoverageGapMax
        const dRankFail =
          !cRecallFail &&
          oracleTopK >= oracleRecallFloor &&
          top1Conversion < Number(cfg?.minTop1ToOracleConversionForPromotion ?? 0)
        const sampleStarvation =
          evalTradingDays > 0 &&
          evalPickedCount < resolvePromotionPickedFloor(cfg)
        const gateStarvation =
          evalTradingDays > 0 &&
          (
            (evalD1TradeDays > 0 && evalD2BlockedAfterD1Days > 0) ||
            (evalTradingDays >= 20 && evalD1TradeDays <= 1)
          )
        const dOnlyLcbOk =
          Number(dOnlyMetrics?.pickHitRateLcb95 ?? 0) >= Number(cfg?.dOnlySprint?.minPickHitRateLcb95 ?? 0)
        const dOnlyConversionOk =
          Number(dOnlyMetrics?.budgetedConversion80 ?? 0) >=
          Number(cfg?.dOnlySprint?.minBudgetedConversion80 ?? 0)
        const dOnlyRankLossOk =
          Number(dOnlyMetrics?.rankLossAvgEval ?? dOnlyMetrics?.rankLossAvg ?? 0) <=
          Number(cfg?.dOnlySprint?.maxRankLossAvgEval ?? 1)
        const dOnlySprintEnabled =
          cfg?.dOnlySprint?.enabled === true &&
          Number(round) <= Number(cfg?.dOnlySprint?.rounds ?? 0) &&
          dOnlyLcbOk &&
          dOnlyConversionOk &&
          dOnlyRankLossOk &&
          Number(globalNoImproveRounds ?? 0) <
            Number(cfg?.dOnlySprint?.noImproveRoundsToResumeC ?? 0)
        if (cRecallFail) {
          action = "REBUILD_C"
          rebuildReasonCategory = "C_RECALL_FAIL"
        } else if (dRankFail) {
          action = "D_ONLY_KEEP"
          rebuildReasonCategory = "D_RANK_FAIL"
          stagnationRounds = Math.max(0, stagnationRounds - 1)
        } else if (sampleStarvation) {
          action = "D_ONLY_KEEP"
          rebuildReasonCategory = "SAMPLE_STARVATION"
          stagnationRounds = Math.max(0, stagnationRounds - 1)
        } else if (gateStarvation) {
          action = "D_ONLY_KEEP"
          rebuildReasonCategory = "GATE_STARVATION"
          stagnationRounds = Math.max(0, stagnationRounds - 1)
        } else if (dOnlySprintEnabled) {
          action = "D_ONLY_KEEP"
          rebuildReasonCategory = "D_ONLY_SPRINT"
          stagnationRounds = Math.max(0, stagnationRounds - 1)
        } else {
          action = "REBUILD_C"
          rebuildReasonCategory = "RAW_STAGNATION"
        }
      }
    }

    if (effectiveStepDExecutionProfile === "FAST_ONLINE") {
      const fullMaterializeDir = path.join(
        roundDir,
        `e${String(bestEpoch.epoch).padStart(2, "0")}_full`,
      )
      const fullMaterializeStepDDir = path.join(fullMaterializeDir, "step-d")
      const baseStepDSummary =
        effectiveSummaryPath && pathExists(effectiveSummaryPath)
          ? await readJson(effectiveSummaryPath, null)
          : null
      const materialized = await materializeFullStepDArtifacts({
        ctx,
        cfg,
        acceptedBaselineRecord,
        round,
        epoch: bestEpoch.epoch,
        outDir: fullMaterializeDir,
        baseStepD: {
          step: "D",
          summary: baseStepDSummary,
          summaryPath: effectiveSummaryPath,
          logsPath: effectiveLogsPath,
          weightsPath: effectiveWeightsPath,
          sampledDebugPath: effectiveSampledDebugPath,
          policyStatePath: effectivePolicyStatePath,
          policyBundlePath: effectivePolicyBundlePath,
          artifactManifestPath: effectiveArtifactManifestPath,
          candidateIndexPath: effectiveCandidateIndexPath,
          candidateIndexMetaPath: effectiveCandidateIndexMetaPath,
          featurePackPath: effectiveFeaturePackPath,
          featurePackMetaPath: effectiveFeaturePackMetaPath,
          d1RankedCandidatesPath: effectiveD1RankedCandidatesPath,
          d2ExecutionAuditPath: effectiveD2ExecutionAuditPath,
          d1LockboxRankedCandidatesPath: effectiveD1LockboxRankedCandidatesPath,
          d2LockboxExecutionAuditPath: effectiveD2LockboxExecutionAuditPath,
          weightsHash: effectiveWeightsHash,
          policyFingerprint: effectivePolicyFingerprint,
          stepDExecutionProfile: effectiveStepDExecutionProfile
        },
        startWeightsPath: effectiveStartWeightsPath,
        minScoreMargin: workingMinScoreMargin,
        maxScoreMargin: workingMaxScoreMargin,
        secondPickGate: workingSecondPickGate,
        inversionState
      })
      effectiveMetrics = materialized.metrics ?? effectiveMetrics
      effectiveWeightsPath =
        pathExists(path.join(fullMaterializeStepDDir, "weights_final.json"))
          ? path.join(fullMaterializeStepDDir, "weights_final.json")
          : (materialized.weightsPath ?? effectiveWeightsPath)
      effectiveArtifactManifestPath =
        pathExists(path.join(fullMaterializeStepDDir, "step_d_artifact_manifest.json"))
          ? path.join(fullMaterializeStepDDir, "step_d_artifact_manifest.json")
          : (materialized.artifactManifestPath ?? effectiveArtifactManifestPath)
      effectiveSummaryPath =
        pathExists(path.join(fullMaterializeStepDDir, "step_d_summary.json"))
          ? path.join(fullMaterializeStepDDir, "step_d_summary.json")
          : (materialized.summaryPath ?? effectiveSummaryPath)
      effectiveLogsPath =
        pathExists(path.join(fullMaterializeStepDDir, "daily_online_logs.jsonl"))
          ? path.join(fullMaterializeStepDDir, "daily_online_logs.jsonl")
          : (materialized.logsPath ?? effectiveLogsPath)
      effectiveSampledDebugPath =
        pathExists(path.join(fullMaterializeStepDDir, "sampled_debug_eval_top5.jsonl"))
          ? path.join(fullMaterializeStepDDir, "sampled_debug_eval_top5.jsonl")
          : (materialized.sampledDebugPath ?? effectiveSampledDebugPath)
      effectivePolicyStatePath =
        pathExists(path.join(fullMaterializeStepDDir, "step_d_policy_state.json"))
          ? path.join(fullMaterializeStepDDir, "step_d_policy_state.json")
          : (materialized.policyStatePath ?? effectivePolicyStatePath)
      effectivePolicyBundlePath =
        pathExists(path.join(fullMaterializeStepDDir, "step_d_policy_bundle.json"))
          ? path.join(fullMaterializeStepDDir, "step_d_policy_bundle.json")
          : (materialized.policyBundlePath ?? effectivePolicyBundlePath)
      effectiveCandidateIndexPath =
        pathExists(path.join(fullMaterializeStepDDir, "decision_candidates_index.jsonl"))
          ? path.join(fullMaterializeStepDDir, "decision_candidates_index.jsonl")
          : (materialized.candidateIndexPath ?? effectiveCandidateIndexPath)
      effectiveCandidateIndexMetaPath =
        pathExists(path.join(fullMaterializeStepDDir, "decision_candidates_index_meta.json"))
          ? path.join(fullMaterializeStepDDir, "decision_candidates_index_meta.json")
          : (materialized.candidateIndexMetaPath ?? effectiveCandidateIndexMetaPath)
      effectiveFeaturePackPath =
        pathExists(path.join(fullMaterializeStepDDir, "decision_candidates_feature_pack.jsonl"))
          ? path.join(fullMaterializeStepDDir, "decision_candidates_feature_pack.jsonl")
          : (materialized.featurePackPath ?? effectiveFeaturePackPath)
      effectiveFeaturePackMetaPath =
        pathExists(path.join(fullMaterializeStepDDir, "decision_candidates_feature_pack_meta.json"))
          ? path.join(fullMaterializeStepDDir, "decision_candidates_feature_pack_meta.json")
          : (materialized.featurePackMetaPath ?? effectiveFeaturePackMetaPath)
      effectiveD1RankedCandidatesPath =
        pathExists(path.join(fullMaterializeStepDDir, "d1_ranked_candidates.jsonl"))
          ? path.join(fullMaterializeStepDDir, "d1_ranked_candidates.jsonl")
          : (materialized.d1RankedCandidatesPath ?? effectiveD1RankedCandidatesPath)
      effectiveD2ExecutionAuditPath =
        pathExists(path.join(fullMaterializeStepDDir, "d2_execution_audit.jsonl"))
          ? path.join(fullMaterializeStepDDir, "d2_execution_audit.jsonl")
          : (materialized.d2ExecutionAuditPath ?? effectiveD2ExecutionAuditPath)
      effectiveD1LockboxRankedCandidatesPath =
        pathExists(path.join(fullMaterializeStepDDir, "d1_lockbox_ranked_candidates.jsonl"))
          ? path.join(fullMaterializeStepDDir, "d1_lockbox_ranked_candidates.jsonl")
          : (materialized.d1LockboxRankedCandidatesPath ?? effectiveD1LockboxRankedCandidatesPath)
      effectiveD2LockboxExecutionAuditPath =
        pathExists(path.join(fullMaterializeStepDDir, "d2_lockbox_execution_audit.jsonl"))
          ? path.join(fullMaterializeStepDDir, "d2_lockbox_execution_audit.jsonl")
          : (materialized.d2LockboxExecutionAuditPath ?? effectiveD2LockboxExecutionAuditPath)
      effectiveWeightsHash = String(materialized.weightsHash ?? effectiveWeightsHash ?? "")
      effectivePolicyFingerprint =
        materialized.policyFingerprint ?? effectivePolicyFingerprint ?? null
      effectiveStepDExecutionProfile = normalizeStepDExecutionProfile(
        materialized.stepDExecutionProfile,
        "FULL_AUDIT",
      )
    }

    const bestLogs = await readJsonl(effectiveLogsPath)
    const bestExecutionAuditRows = await readJsonl(effectiveD2ExecutionAuditPath)
    const opeEval = computeSnipsOpe(bestLogs)
    const prototypeMetricSource = resolvePrototypeMetricSource({
      logs: bestLogs,
      executionAuditRows: bestExecutionAuditRows
    })
    const protoMetrics = summarizePrototypeMetrics({
      sourceRows: prototypeMetricSource.rows
    })
    const classified = classifyAndSelectDrops({
      protoMetrics,
      prevRoundMetrics,
      stateMap,
      cfg,
      roundPickHitRate: effectiveMetrics.pickHitRate,
      clusterByPrototype: currentC.clusterByPrototype,
      permanentDropSet
    })

    prevRoundMetrics.clear()
    for (const row of protoMetrics) {
      prevRoundMetrics.set(String(row.templateId), {
        hitRate: Number(row.hitRate ?? 0),
        avgRegret: Number(row.avgRegret ?? 0),
        usageCount: Number(row.usageCount ?? 0)
      })
    }

    if (action === "REBUILD_C") {
      newDrops = classified.selectedDrops.filter((id) => !permanentDropSet.has(id))
      for (const id of newDrops) permanentDropSet.add(id)
      await persistPermanentDropState()

      const prevLibrary = currentC.library
      currentC = await runAndSnapshotStepCStack({ reason: "D_STAGNATION" })
      cRebuilt = true
      prototypeChangeRate = calcPrototypeChangeRate(prevLibrary, currentC.library)
      if (
        cfg.weightCarry.enabled !== true ||
        prototypeChangeRate > Number(cfg.weightCarry.maxPrototypeChangeRate ?? 0.35)
      ) {
        carryWeightsPath = ""
      } else {
        carryWeightsPath = effectiveWeightsPath
      }
      stagnationRounds = 0
    }

    const qualityOk = (() => {
      if (!bestRound) return true
      if (
        Number(effectiveMetrics.noCandidateRate ?? 0) >
        Number(bestRound.bestMetrics.noCandidateRate ?? 0) + cfg.unstableNoCandidateRateDelta
      ) {
        return false
      }
      if (
        Number(effectiveMetrics.avgRegret ?? 0) >
        Number(bestRound.bestMetrics.avgRegret ?? 0) + cfg.unstableRegretDelta
      ) {
        return false
      }
      return true
    })()
    const promotionPickedCountFloor = resolvePromotionPickedFloor(cfg)
    const promotionPickedCountCeil = resolvePromotionPickedCeil({
      cfg,
      floor: promotionPickedCountFloor
    })
    const sampleOk =
      Number(effectiveMetrics.pickedCount ?? 0) >= promotionPickedCountFloor
    const sampleUpperOk =
      !Number.isFinite(promotionPickedCountCeil) ||
      Number(effectiveMetrics.pickedCount ?? 0) <= promotionPickedCountCeil
    const distributionOk =
      Number(effectiveMetrics.onePickDays ?? 0) >= Number(cfg.minOnePickDaysForPromotion ?? 1)
    const twoPickOk =
      Number(effectiveMetrics.twoPickDays ?? 0) <= Number(cfg.maxTwoPickDaysForPromotion ?? 0)
    const lcbOk =
      Number(effectiveMetrics.pickHitRateLcb95 ?? 0) >=
      Number(cfg.minPickHitRateLcb95ForPromotion ?? 0)
    const conversionOk =
      Number(effectiveMetrics.budgetedConversion80 ?? 0) >=
      Number(cfg.minBudgetedConversion80ForPromotion ?? 0)
    const rankLossOk =
      Number(effectiveMetrics.rankLossAvgEval ?? effectiveMetrics.rankLossAvg ?? 0) <=
      Number(cfg.maxRankLossAvgEvalForPromotion ?? 0.08)
    const lookaheadOk =
      Number(effectiveMetrics.lookaheadViolations ?? 0) <=
      Number(cfg.maxLookaheadViolationsForPromotion ?? 0)
    const speedCurrent = Number(effectiveMetrics.scoreMsPerSeed ?? 0) || 0
    const speedAbsoluteThreshold = Number(cfg.maxScoreMsPerSeedForPromotion ?? 0) || 0
    const speedAbsoluteOk = speedAbsoluteThreshold <= 0 || speedCurrent <= speedAbsoluteThreshold
    const speedRegressionThreshold = Number(cfg.maxScoreMsPerSeedRegression ?? 0.25) || 0
    const speedBaseline = Number(bestRound?.bestMetrics?.scoreMsPerSeed ?? speedCurrent) || speedCurrent
    const speedRelativeOk = !bestRound || speedCurrent <= speedBaseline + speedRegressionThreshold
    const speedOk = speedAbsoluteOk && speedRelativeOk
    const regimeGuard = evaluateRegimeGuard({
      metrics: effectiveMetrics,
      cfg: cfg.regimeGuard
    })
    const regimeOk = regimeGuard.ok
    const promotionDebtCfg = cfg?.promotionDebt ?? {}
    const falsePositiveRejectedCountEval = Math.max(
      0,
      Number(effectiveMetrics?.falsePositiveGate?.rejectedCountEval ?? 0) || 0,
    )
    const falsePositiveRejectionPrecisionEval = Number(
      effectiveMetrics?.falsePositiveGate?.rejectionPrecisionEval ?? 0,
    ) || 0
    const promotionDebtMinRejectedCountEval = Math.max(
      0,
      Number(promotionDebtCfg?.minFalsePositiveRejectedCountEval ?? 0) || 0,
    )
    const promotionDebtMinPrecisionEval = Number(
      promotionDebtCfg?.minFalsePositiveRejectionPrecisionEval ?? 0,
    ) || 0
    const promotionDebtCountOk =
      promotionDebtCfg?.enabled !== true ||
      promotionDebtMinRejectedCountEval <= 0 ||
      falsePositiveRejectedCountEval >= promotionDebtMinRejectedCountEval
    const promotionDebtPrecisionOk =
      promotionDebtCfg?.enabled !== true ||
      promotionDebtMinPrecisionEval <= 0 ||
      falsePositiveRejectionPrecisionEval >= promotionDebtMinPrecisionEval
    const betterThanBest = compareMetrics(effectiveMetrics, bestRound?.bestMetrics) > 0
    const rawImprovedSignal =
      betterThanBest &&
      qualityOk &&
      sampleOk &&
      sampleUpperOk &&
      distributionOk &&
      twoPickOk &&
      lcbOk &&
      conversionOk &&
      rankLossOk &&
      lookaheadOk
    const stabilityWindow = Math.max(1, Number(cfg?.stability?.windowRounds ?? 5) || 5)
    const recentMetrics = rounds
      .slice(Math.max(0, rounds.length - (stabilityWindow - 1)))
      .map((row) => row?.bestMetrics ?? {})
      .concat([effectiveMetrics])
    const priorImprovementCount = improvementSignals
      .slice(Math.max(0, improvementSignals.length - (stabilityWindow - 1)))
      .filter((flag) => flag === true).length
    const stability = summarizeStabilityWindow({
      metricsRows: recentMetrics,
      improvedCount: priorImprovementCount + (rawImprovedSignal ? 1 : 0),
      cfg: cfg.stability
    })
    const stabilityOk = cfg?.stability?.enabled === true ? stability.ok : true
    const noOpPolicyRoundDetail = evaluateNoOpPolicyChange({
      prev: {
        weightsHash: bestRound?.weightsHash,
        policyFingerprint: bestRound?.policyFingerprint
      },
      next: {
        weightsHash: effectiveWeightsHash,
        policyFingerprint: effectivePolicyFingerprint
      }
    })
    const noOpPolicyRound = noOpPolicyRoundDetail.isNoOp === true
    const promotionDebtFingerprintOk =
      promotionDebtCfg?.enabled !== true ||
      promotionDebtCfg?.requirePolicyFingerprintChange !== true ||
      noOpPolicyRound !== true
    const promotionDebtOk =
      promotionDebtCfg?.enabled !== true ||
      (promotionDebtCountOk && promotionDebtPrecisionOk && promotionDebtFingerprintOk)
    const promotable =
      qualityOk &&
      sampleOk &&
      sampleUpperOk &&
      distributionOk &&
      twoPickOk &&
      lcbOk &&
      conversionOk &&
      rankLossOk &&
      lookaheadOk &&
      speedOk &&
      regimeOk &&
      promotionDebtOk &&
      stabilityOk &&
      noOpPolicyRound !== true
    const improved = betterThanBest && promotable && noOpPolicyRound !== true
    const shouldSetBaseline = !bestRound || (betterThanBest && noOpPolicyRound !== true)
    const shouldPromoteChampion = promotable && (!bestRound || betterThanBest)

    if (shouldSetBaseline) {
      bestRound = {
        round,
        roundTag,
        bestEpoch: effectiveEpochRef,
        bestMetrics: effectiveMetrics,
        bestWeightsPath: effectiveWeightsPath,
        bestArtifactManifestPath: effectiveArtifactManifestPath,
        bestSummaryPath: effectiveSummaryPath,
        bestLogsPath: effectiveLogsPath,
        bestSampledDebugPath: effectiveSampledDebugPath,
        bestPolicyStatePath: effectivePolicyStatePath,
        bestCandidateIndexPath: effectiveCandidateIndexPath,
        bestCandidateIndexMetaPath: effectiveCandidateIndexMetaPath,
        bestFeaturePackPath: effectiveFeaturePackPath,
        bestFeaturePackMetaPath: effectiveFeaturePackMetaPath,
        bestD1RankedCandidatesPath: effectiveD1RankedCandidatesPath,
        bestD2ExecutionAuditPath: effectiveD2ExecutionAuditPath,
        bestD1LockboxRankedCandidatesPath: effectiveD1LockboxRankedCandidatesPath,
        bestD2LockboxExecutionAuditPath: effectiveD2LockboxExecutionAuditPath,
        bestStepC0FamilyIndexPath: path.join(roundDir, "step-c0", "c0_family_index.json"),
        bestStepC0MembershipPath: path.join(roundDir, "step-c0", "c0_family_membership.jsonl"),
        bestStepC0SummaryPath: path.join(roundDir, "step-c0", "c0_summary.json"),
        bestStepC1IndexPath: path.join(roundDir, "step-c1", "c1_family_probe_index.json"),
        bestStepC1ResultsPath: path.join(roundDir, "step-c1", "c1_family_probe_results.jsonl"),
        bestStepC1SummaryPath: path.join(roundDir, "step-c1", "c1_summary.json"),
        bestStepC2IndexPath: path.join(roundDir, "step-c2", "c2_dedup_index.json"),
        bestStepC2GroupsPath: path.join(roundDir, "step-c2", "c2_dedup_groups.jsonl"),
        bestStepC2SummaryPath: path.join(roundDir, "step-c2", "c2_summary.json"),
        bestStepCLibraryPath: path.join(roundDir, "step-c", "pattern_library.json"),
        bestStepCRuntimePath: path.join(roundDir, "step-c", "pattern_library_runtime.json"),
        bestStepCSummaryPath: path.join(roundDir, "step-c", "step_c_summary.json"),
        bestStepCIndexManifestPath: path.join(roundDir, "step-c", "step_c_index_manifest.json"),
        bestStepCShapingStatePath: path.join(roundDir, "step-c", "step_c_shaping_state.json"),
        prototypeClassificationPath: path.join(roundDir, "prototype_classification.json"),
        bestPolicyBundlePath: path.join(path.dirname(effectiveSummaryPath ?? path.join(roundDir, "step-d", "step_d_summary.json")), "step_d_policy_bundle.json"),
        weightsHash: effectiveWeightsHash,
        policyFingerprint: effectivePolicyFingerprint,
        cTag: roundUsedCTag,
        promotable
      }
      carryWeightsPath = effectiveWeightsPath
    }
    if (shouldPromoteChampion) {
      globalNoImproveRounds = 0
      const commonStateLcbOk =
        Number(effectiveMetrics.pickHitRateLcb95 ?? 0) >=
        Number(cfg?.commonState?.minPickHitRateLcb95ForMerge ?? 0)
      const commonStateConvOk =
        Number(effectiveMetrics.budgetedConversion80 ?? 0) >=
        Number(cfg?.commonState?.minBudgetedConversion80ForMerge ?? 0)
      if (cfg.commonState.enabled === true && commonStateLcbOk && commonStateConvOk) {
        const weightsSnapshot =
          (await readWeightsSnapshot(effectiveWeightsPath)) ??
          normalizeGroupWeights(championCommonState?.featureWeights ?? {})
        const candidateState = buildCommonStateCandidate({
          cfg: cfg.commonState,
          metrics: effectiveMetrics,
          weights: weightsSnapshot,
          logs: bestLogs,
          executionAuditRows: bestExecutionAuditRows,
          prototypeLookup: currentC.prototypeLookup,
          round,
          epochRef: effectiveEpochRef,
          cTag: roundUsedCTag,
          runId: ctx.runId
        })
        championCommonState = mergeChampionCommonState({
          prev: championCommonState,
          candidate: candidateState,
          cfg: cfg.commonState
        })
        await writeJson(commonStatePath, championCommonState)
        commonStatePromoted = true
      }
    } else if (!bestRound) {
      globalNoImproveRounds = 0
    } else {
      globalNoImproveRounds += 1
    }

    const secondPickController = {
      enabled: cfg.secondPickController?.enabled === true,
      applied: false,
      reason: "SKIP",
      secondSamples: Number(effectiveMetrics.secondPickCount ?? 0),
      firstPickHitRate: Number(effectiveMetrics.firstPickHitRate ?? 0),
      secondPickHitRate: Number(effectiveMetrics.secondPickHitRate ?? 0),
      rateDelta:
        Number(effectiveMetrics.secondPickHitRate ?? 0) -
        Number(effectiveMetrics.firstPickHitRate ?? 0),
      firstPickExpectedNetRet3dAvg: Number(effectiveMetrics.firstPickExpectedNetRet3dAvg ?? 0),
      secondPickExpectedNetRet3dAvg: Number(effectiveMetrics.secondPickExpectedNetRet3dAvg ?? 0),
      expectedDelta: Number(effectiveMetrics.secondMinusFirstExpectedNetRet3d ?? 0),
      twoPickVsOnePickExpectedDayDelta: Number(
        effectiveMetrics.twoPickVsOnePickExpectedDayDelta ?? 0,
      ),
      expectedCompensates: false,
      underperformSignal: false,
      severeUnderperformSignal: false,
      before: clonePlain(workingSecondPickGate),
      after: clonePlain(workingSecondPickGate)
    }
    if (
      cfg.secondPickController?.enabled === true &&
      resolveSecondPickGateMode(workingSecondPickGate) === "enforce"
    ) {
      const controllerCfg = cfg.secondPickController
      const secondSamples = Number(effectiveMetrics.secondPickCount ?? 0)
      const rateDelta =
        Number(effectiveMetrics.secondPickHitRate ?? 0) -
        Number(effectiveMetrics.firstPickHitRate ?? 0)
      const expectedDelta = Number(effectiveMetrics.secondMinusFirstExpectedNetRet3d ?? 0)
      const minSamples = Math.max(1, Number(controllerCfg.minSamples ?? 12))
      const rateMargin = Math.max(0, Number(controllerCfg.rateMargin ?? 0.012))
      const expectedAdvantageMargin = Math.max(
        0,
        Number(controllerCfg.expectedAdvantageMargin ?? 0.0025),
      )
      const expectedOverrideMaxRatePenalty = Math.max(
        0,
        Number(controllerCfg.expectedOverrideMaxRatePenalty ?? 0.004),
      )
      const minGap = Math.max(0, Number(controllerCfg.minGap ?? 0.01))
      const maxGap = Math.max(minGap, Number(controllerCfg.maxGap ?? 0.022))
      const gapStep = Math.max(0, Number(controllerCfg.gapStep ?? 0.0012))
      const expectedStep = Math.max(0, Number(controllerCfg.expectedStep ?? 0.0015))
      const minExpectedFloor = Math.max(0, Number(controllerCfg.minExpectedFloor ?? 0.02))
      const maxMinExpected = Math.max(minExpectedFloor, Number(controllerCfg.maxMinExpected ?? 0.03))
      let currentGap = Number(workingSecondPickGate?.maxGapFromFirst ?? maxGap)
      if (!Number.isFinite(currentGap)) currentGap = maxGap
      let currentMinExpected = Number(
        workingSecondPickGate?.minExpectedNetRet3d ??
          ctx.config?.decisionGate?.minExpectedNetRet3d ??
          minExpectedFloor,
      )
      if (!Number.isFinite(currentMinExpected)) currentMinExpected = minExpectedFloor
      const expectedCompensates =
        expectedDelta > expectedAdvantageMargin &&
        rateDelta >= -expectedOverrideMaxRatePenalty
      const underperformSignal =
        rateDelta < -rateMargin ||
        (rateDelta < 0 && expectedDelta < expectedAdvantageMargin)
      const severeUnderperformSignal =
        rateDelta < -(rateMargin * 1.8) ||
        expectedDelta < -Math.max(expectedAdvantageMargin, expectedStep)
      secondPickController.expectedCompensates = expectedCompensates
      secondPickController.underperformSignal = underperformSignal
      secondPickController.severeUnderperformSignal = severeUnderperformSignal

      if (secondSamples < minSamples) {
        secondPickController.reason = "LOW_SAMPLE"
      } else if (underperformSignal && !expectedCompensates) {
        const tightenStep = severeUnderperformSignal ? gapStep * 2 : gapStep
        const expectedTightenStep = severeUnderperformSignal ? expectedStep * 2 : expectedStep
        const nextGap = Math.max(minGap, currentGap - tightenStep)
        const nextMinExpected = Math.min(maxMinExpected, currentMinExpected + expectedTightenStep)
        workingSecondPickGate = {
          ...workingSecondPickGate,
          maxGapFromFirst: Number(nextGap.toFixed(6)),
          minExpectedNetRet3d: Number(nextMinExpected.toFixed(6))
        }
        secondPickController.applied = true
        secondPickController.reason = severeUnderperformSignal
          ? "SECOND_UNDERPERFORM_SEVERE_TIGHTEN"
          : "SECOND_UNDERPERFORM_TIGHTEN"
      } else if (
        (
          (rateDelta > rateMargin && expectedDelta >= 0) ||
          (expectedDelta > expectedAdvantageMargin && rateDelta >= 0)
        ) &&
        Number(effectiveMetrics.onePickDays ?? 0) >= Number(cfg.minOnePickDaysForPromotion ?? 1)
      ) {
        const nextGap = Math.min(maxGap, currentGap + gapStep)
        const nextMinExpected = Math.max(minExpectedFloor, currentMinExpected - expectedStep)
        workingSecondPickGate = {
          ...workingSecondPickGate,
          maxGapFromFirst: Number(nextGap.toFixed(6)),
          minExpectedNetRet3d: Number(nextMinExpected.toFixed(6))
        }
        secondPickController.applied = true
        secondPickController.reason =
          rateDelta > rateMargin ? "SECOND_OUTPERFORM_HITRATE_LOOSEN" : "SECOND_OUTPERFORM_EXPECTED_LOOSEN"
      } else {
        secondPickController.reason = "NO_CHANGE"
      }
    }
    secondPickController.after = clonePlain(workingSecondPickGate)

    let secondPickResetApplied = false
    if (Number(effectiveMetrics.onePickDays ?? 0) <= 0) {
      zeroOnePickSkewStreak += 1
    } else {
      zeroOnePickSkewStreak = 0
    }
    if (
      zeroOnePickSkewStreak >= Number(cfg.zeroOnePickResetStreak ?? 2) &&
      resolveSecondPickGateMode(workingSecondPickGate) === "enforce"
    ) {
      workingSecondPickGate = clonePlain(baselineSecondPickGate)
      zeroOnePickSkewStreak = 0
      secondPickResetApplied = true
    }
    if (secondPickResetApplied) {
      secondPickController.applied = true
      secondPickController.reason = "ZERO_ONEPICK_RESET"
      secondPickController.after = clonePlain(workingSecondPickGate)
    }

    const inversionSignal = shouldEnableInversionAdjust({
      metrics: effectiveMetrics,
      cfg: cfg.inversion
    })
    if (inversionSignal) {
      inversionEnableSignalStreak += 1
      inversionDisableSignalStreak = 0
    } else {
      inversionDisableSignalStreak += 1
      inversionEnableSignalStreak = 0
    }
    if (
      inversionState.enabled !== true &&
      inversionEnableSignalStreak >= Number(cfg.inversion.enableOnStreak ?? 2)
    ) {
      inversionState.enabled = true
    }
    if (
      inversionState.enabled === true &&
      inversionDisableSignalStreak >= Number(cfg.inversion.disableOnStreak ?? 2)
    ) {
      inversionState.enabled = false
    }
    if (inversionState.enabled && inversionSignal) {
      inversionState.secondBoost = Math.min(
        Number(cfg.inversion.maxSecondBoost ?? 0.02),
        Number(inversionState.secondBoost ?? 0) + Number(cfg.inversion.boostStep ?? 0.003),
      )
    } else if (inversionState.enabled !== true) {
      inversionState.secondBoost = Math.max(
        0,
        Number(inversionState.secondBoost ?? 0) - Number(cfg.inversion.boostStep ?? 0.003),
      )
    }

    const prototypeClassificationPath = path.join(roundDir, "prototype_classification.json")
    const adaptiveCandidateMode = String(
      cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.candidateMode ?? "boost_penalty",
    )
      .trim()
      .toLowerCase()
    const roundCGate = buildCGate({
      stepCSummary: currentC?.stepC?.summary ?? null,
      cfg: ctx.config
    })
    const roundDGateMetrics = buildDGateMetrics(effectiveMetrics)
    const roundDGateEval = evaluateResearchDGate({
      metrics: roundDGateMetrics,
      gateCfg: cfg?.researchGates?.lineDiscard,
      fallbackMinD: cfg?.researchGates?.lineDiscard?.minD ?? 0.4,
      profile: "discard"
    })
    const roundSummary = {
      round,
      roundTag,
      sessionId,
      cTag: roundUsedCTag,
      nextCTag: currentC.cTag,
      bestEpoch: effectiveEpochRef,
      bestMetrics: effectiveMetrics,
      bestWeightsPath: effectiveWeightsPath,
      bestArtifactManifestPath: effectiveArtifactManifestPath,
      bestSummaryPath: effectiveSummaryPath,
      bestLogsPath: effectiveLogsPath,
      bestSampledDebugPath: effectiveSampledDebugPath,
      bestPolicyStatePath: effectivePolicyStatePath,
      bestCandidateIndexPath: effectiveCandidateIndexPath,
      bestCandidateIndexMetaPath: effectiveCandidateIndexMetaPath,
      bestFeaturePackPath: effectiveFeaturePackPath,
      bestFeaturePackMetaPath: effectiveFeaturePackMetaPath,
      bestD1RankedCandidatesPath: effectiveD1RankedCandidatesPath,
      bestD2ExecutionAuditPath: effectiveD2ExecutionAuditPath,
      bestD1LockboxRankedCandidatesPath: effectiveD1LockboxRankedCandidatesPath,
      bestD2LockboxExecutionAuditPath: effectiveD2LockboxExecutionAuditPath,
      bestStepC0FamilyIndexPath: path.join(roundDir, "step-c0", "c0_family_index.json"),
      bestStepC0MembershipPath: path.join(roundDir, "step-c0", "c0_family_membership.jsonl"),
      bestStepC0SummaryPath: path.join(roundDir, "step-c0", "c0_summary.json"),
      bestStepC1IndexPath: path.join(roundDir, "step-c1", "c1_family_probe_index.json"),
      bestStepC1ResultsPath: path.join(roundDir, "step-c1", "c1_family_probe_results.jsonl"),
      bestStepC1SummaryPath: path.join(roundDir, "step-c1", "c1_summary.json"),
      bestStepC2IndexPath: path.join(roundDir, "step-c2", "c2_dedup_index.json"),
      bestStepC2GroupsPath: path.join(roundDir, "step-c2", "c2_dedup_groups.jsonl"),
      bestStepC2SummaryPath: path.join(roundDir, "step-c2", "c2_summary.json"),
      bestStepCLibraryPath: path.join(roundDir, "step-c", "pattern_library.json"),
      bestStepCRuntimePath: path.join(roundDir, "step-c", "pattern_library_runtime.json"),
      bestStepCSummaryPath: path.join(roundDir, "step-c", "step_c_summary.json"),
      bestStepCIndexManifestPath: path.join(roundDir, "step-c", "step_c_index_manifest.json"),
      bestStepCShapingStatePath: path.join(roundDir, "step-c", "step_c_shaping_state.json"),
      prototypeClassificationPath,
      prototypeMetricSource: prototypeMetricSource.source,
      prototypeMetricSourceRows: prototypeMetricSource.totalRows,
      prototypeMetricTaggedRows: prototypeMetricSource.taggedRows,
      prototypeMetricNonzeroCount: protoMetrics.filter(
        (row) =>
          Number(row?.usageCount ?? 0) > 0 || Number(row?.gateRejectContribution ?? 0) > 0,
      ).length,
      candidateMode: adaptiveCandidateMode,
      c0Gate: currentC?.stepC0?.summary?.gate ?? null,
      c1Gate: currentC?.stepC1?.summary?.gate ?? null,
      cGate: roundCGate,
      dGate: roundDGateEval,
      bestPolicyBundlePath: path.join(path.dirname(effectiveSummaryPath ?? path.join(roundDir, "step-d", "step_d_summary.json")), "step_d_policy_bundle.json"),
      weightsHash: effectiveWeightsHash,
      policyFingerprint: effectivePolicyFingerprint,
      epochCount: epochRows.length,
      epochStopReason: earlyStopReason ?? "MAX_EPOCH",
      stagnatedInRound,
      noOpPolicyRound,
      noOpPolicyRoundDetail,
      stagnationRounds,
      epochMetrics: epochRows.map((row) => ({
        epoch: row.epoch,
        weightsHash: String(row?.weightsHash ?? ""),
        policyFingerprint: row?.policyFingerprint ?? null,
        policyIdentity: row?.policyIdentity ?? null,
        noOpPolicyEpoch: row?.noOpPolicyEpoch === true,
        ...row.metrics
      })),
      classifyCounts: classified.counts,
      activePrototypeCount: classified.activeCount,
      dropCap: classified.cap,
      pendingDropCount: classified.selectedDrops.length,
      newDropCount: newDrops.length,
      newDropTemplateIds: newDrops,
      decisionGateApplied: {
        minScoreMargin: workingMinScoreMargin,
        maxScoreMargin: workingMaxScoreMargin,
        secondPick: clonePlain(workingSecondPickGate),
        inversionAdjust: {
          enabled: inversionState.enabled,
          secondBoost: inversionState.secondBoost
        },
        inversionSignal: inversionSignal ? "SECOND_DOMINANT" : "NORMAL",
        inversionEnableSignalStreak,
        inversionDisableSignalStreak
      },
      promotionConstraints: {
        qualityOk,
        sampleOk,
        sampleUpperOk,
        distributionOk,
        twoPickOk,
        lcbOk,
        conversionOk,
        rankLossOk,
        lookaheadOk,
        speedOk,
        regimeOk,
        promotionDebtOk,
        stabilityOk,
        promotable,
        minPickedCountForPromotion: promotionPickedCountFloor,
        maxPickedCountForPromotion: Number(cfg.maxPickedCountForPromotion ?? 0),
        effectiveMaxPickedCountForPromotion: Number.isFinite(promotionPickedCountCeil)
          ? promotionPickedCountCeil
          : null,
        maxTwoPickDaysForPromotion: Number(cfg.maxTwoPickDaysForPromotion ?? 0),
        minOnePickDaysForPromotion: Number(cfg.minOnePickDaysForPromotion ?? 1),
        minPickHitRateLcb95ForPromotion: Number(cfg.minPickHitRateLcb95ForPromotion ?? 0),
        minBudgetedConversion80ForPromotion: Number(
          cfg.minBudgetedConversion80ForPromotion ?? 0,
        ),
        maxRankLossAvgEvalForPromotion: Number(
          cfg.maxRankLossAvgEvalForPromotion ?? 0,
        ),
        maxLookaheadViolationsForPromotion: Number(
          cfg.maxLookaheadViolationsForPromotion ?? 0,
        ),
        minTop1ToOracleConversionForPromotion: Number(
          cfg.minTop1ToOracleConversionForPromotion ?? 0,
        ),
        maxScoreMsPerSeedForPromotion: Number(cfg.maxScoreMsPerSeedForPromotion ?? 0),
        maxScoreMsPerSeedRegression: Number(cfg.maxScoreMsPerSeedRegression ?? 0.25),
        scoreMsPerSeedBaseline: speedBaseline,
        scoreMsPerSeedCurrent: speedCurrent,
        promotionDebt: {
          enabled: promotionDebtCfg?.enabled === true,
          minFalsePositiveRejectedCountEval: promotionDebtMinRejectedCountEval,
          minFalsePositiveRejectionPrecisionEval: promotionDebtMinPrecisionEval,
          requirePolicyFingerprintChange: promotionDebtCfg?.requirePolicyFingerprintChange === true,
          falsePositiveRejectedCountEval,
          falsePositiveRejectionPrecisionEval,
          countOk: promotionDebtCountOk,
          precisionOk: promotionDebtPrecisionOk,
          fingerprintOk: promotionDebtFingerprintOk
        },
        regimeGuard,
        stability
      },
      distributionControl: {
        zeroOnePickSkewStreak,
        secondPickResetApplied,
        resetStreakThreshold: Number(cfg.zeroOnePickResetStreak ?? 2)
      },
      secondPickController,
      action,
      rebuildReasonCategory,
      dOnlySprint: {
        enabled: cfg?.dOnlySprint?.enabled === true,
        rounds: Number(cfg?.dOnlySprint?.rounds ?? 0),
        oracleTopKFloor: Number(cfg?.dOnlySprint?.oracleTopKFloor ?? 0),
        minPickHitRateLcb95: Number(cfg?.dOnlySprint?.minPickHitRateLcb95 ?? 0),
        minBudgetedConversion80: Number(cfg?.dOnlySprint?.minBudgetedConversion80 ?? 0),
      maxRankLossAvgEval: Number(cfg?.dOnlySprint?.maxRankLossAvgEval ?? 0),
      noImproveRoundsToResumeC: Number(cfg?.dOnlySprint?.noImproveRoundsToResumeC ?? 0)
    },
	    researchGates: {
	      enabled: ctx.config?.researchGates?.enabled === true,
	      lineDiscard: {
	        minD: clamp01(ctx.config?.researchGates?.lineDiscard?.minD ?? 0.4),
	        minE: clamp01(ctx.config?.researchGates?.lineDiscard?.minE ?? 0.4)
	      },
	      parentPromotion: {
	        minD: clamp01(ctx.config?.researchGates?.parentPromotion?.minD ?? 0.5),
	        minE: clamp01(ctx.config?.researchGates?.parentPromotion?.minE ?? 0.55)
	      }
	    },
      cRebuilt,
      prototypeChangeRate,
      regimeBreakdown: effectiveMetrics.regimeBreakdown ?? {},
      ope: opeEval,
      commonState: {
        enabled: cfg.commonState.enabled === true,
        path: commonStatePath,
        promoted: commonStatePromoted,
        confidence: Number(championCommonState?.confidence ?? 0),
        prototypeScores: Object.keys(championCommonState?.prototypeScores ?? {}).length,
        regimeWeights: Object.keys(championCommonState?.regimeWeights ?? {}).length
      },
      sweep: sweepResult
        ? {
            executed: sweepResult.executed,
            reused: sweepResult.reused === true,
            improved: sweepResult.improved,
            improvedReason: sweepResult.improvedReason ?? null,
            improvedChecks: sweepResult.improvedChecks ?? null,
            best: sweepResult.best
              ? {
                  margin: sweepResult.best.margin,
                  metrics: sweepResult.best.metrics
                }
              : null
          }
        : null
    }
    rounds.push(roundSummary)
    improvementSignals.push(rawImprovedSignal)
    await writeJson(path.join(roundDir, "round_summary.json"), roundSummary)
    const roundMajorChangeType = resolveRoundMajorChangeType({
      adaptiveCandidateMode,
      stepC0Summary: currentC?.stepC0?.summary ?? null,
      stepC1Summary: currentC?.stepC1?.summary ?? null,
      stepC2Summary: currentC?.stepC2?.summary ?? null
    })
    const roundCandidateModeManifest = {
      generatedAt: new Date().toISOString(),
      runId: ctx.runId,
      sessionId,
      round,
      roundTag,
      cTag: roundUsedCTag,
      candidateMode: adaptiveCandidateMode,
      majorChangeType: roundMajorChangeType,
      majorChangePath: path.join(roundDir, "step-c", "step_c_summary.json"),
      provenance: {
        classificationPath: prototypeClassificationPath,
        stepC0SummaryPath: path.join(roundDir, "step-c0", "c0_summary.json"),
        stepC1SummaryPath: path.join(roundDir, "step-c1", "c1_summary.json"),
        stepC2SummaryPath: path.join(roundDir, "step-c2", "c2_summary.json"),
        stepCSummaryPath: path.join(roundDir, "step-c", "step_c_summary.json"),
        stepDSummaryPath: effectiveSummaryPath
      },
      c0: {
        enabled: currentC?.stepC0?.summary?.enabled === true,
        inputMode: String(currentC?.stepC0?.summary?.inputMode ?? "").trim() || null,
        familyCount: Number(currentC?.stepC0?.summary?.families ?? 0) || 0,
        shortlistedFamilyCount:
          Number(currentC?.stepC0?.summary?.shortlistedFamilies ?? 0) || 0,
        shortlistedTemplateCount:
          Number(currentC?.stepC0?.summary?.shortlistedTemplateCount ?? 0) || 0,
        fallbackUsed: currentC?.stepC0?.summary?.gate?.fallbackUsed === true,
        gateReason:
          String(currentC?.stepC0?.summary?.gate?.reason ?? "").trim() || null,
        familySignaturePolicy:
          currentC?.stepC0?.summary?.familySignaturePolicy ?? null,
        shortlistPolicy: currentC?.stepC0?.summary?.shortlistPolicy ?? null
      },
      c1: {
        enabled: currentC?.stepC1?.summary?.enabled === true,
        probeScope: String(currentC?.stepC1?.summary?.probeScope ?? "").trim() || null,
        probeProfile: String(currentC?.stepC1?.summary?.probeProfile ?? "").trim() || null,
        probedFamilies: Number(currentC?.stepC1?.summary?.probedFamilies ?? 0) || 0,
        passedFamilies: Number(currentC?.stepC1?.summary?.passedFamilies ?? 0) || 0,
        fallbackUsed: currentC?.stepC1?.summary?.fallbackUsed === true,
        gateReason: String(currentC?.stepC1?.summary?.gate?.reason ?? "").trim() || null
      },
      c2: {
        enabled: currentC?.stepC2?.summary?.enabled === true,
        inputFamilies: Number(currentC?.stepC2?.summary?.inputFamilies ?? 0) || 0,
        representativeFamilies:
          Number(currentC?.stepC2?.summary?.representativeFamilies ?? 0) || 0,
        shadowFamilies: Number(currentC?.stepC2?.summary?.shadowFamilies ?? 0) || 0,
        fallbackUsed: currentC?.stepC2?.summary?.fallbackUsed === true,
        gateReason: String(currentC?.stepC2?.summary?.gate?.reason ?? "").trim() || null,
        similarityPolicyVersion:
          String(currentC?.stepC2?.summary?.similarityPolicyVersion ?? "").trim() || null,
        representativePolicy:
          String(currentC?.stepC2?.summary?.representativePolicy ?? "").trim() || null
      },
      adaptiveFrontier: {
        enabled: cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.enabled === true,
        minPrototypeFloor:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.minPrototypeFloor ?? 0) || 0,
        qualityAcceptThreshold:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.qualityAcceptThreshold ?? 0) ||
          0,
        qualityNearThreshold:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.qualityNearThreshold ?? 0) || 0,
        maxPrototypeCeil:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.maxPrototypeCeil ?? 0) || 0,
        salvageBoostBias:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.salvageBoostBias ?? 0) || 0,
        salvagePenaltyBias:
          Number(cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.salvagePenaltyBias ?? 0) || 0,
        previousRunEAssistWeight:
          Number(
            cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.previousRunEAssistWeight ?? 0,
          ) || 0,
        previousRunEAssistThreshold:
          Number(
            cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.previousRunEThreshold ?? 0,
          ) || 0
      },
      salvageSummary: {
        boostCount:
          Number(classified?.summary?.adaptiveFrontier?.salvageBoostPatternCount ?? 0) || 0,
        penaltyCount:
          Number(classified?.summary?.adaptiveFrontier?.salvagePenaltyPatternCount ?? 0) || 0,
        quarantineCount:
          Number(classified?.summary?.adaptiveFrontier?.quarantinePatternCount ?? 0) || 0,
        acceptedBySalvageBoost:
          Number(classified?.summary?.adaptiveFrontier?.acceptedBySalvageBoost ?? 0) || 0,
        acceptedBySalvagePenalty:
          Number(classified?.summary?.adaptiveFrontier?.acceptedBySalvagePenalty ?? 0) || 0,
        rejectedByQuarantine:
          Number(classified?.summary?.adaptiveFrontier?.rejectedByQuarantine ?? 0) || 0
      },
      lineMetrics: {
        ...roundDGateMetrics
      }
    }
    await writeJson(path.join(roundDir, "candidate_mode_manifest.json"), roundCandidateModeManifest)
    await appendCandidateModeManifest({
      cwd: ctx.cwd,
      entry: roundCandidateModeManifest
    })
    await writeJson(prototypeClassificationPath, {
      generatedAt: new Date().toISOString(),
      round,
      roundTag,
      cTag: roundUsedCTag,
      candidateMode: adaptiveCandidateMode,
      cfg,
      rows: classified.classified
    })

    const stateObj = {}
    for (const [k, v] of stateMap.entries()) stateObj[k] = v
    await writeJson(statePath, stateObj)

    console.log(
      JSON.stringify({
        mode: "cd-loop",
        stage: "round",
        round,
        cTag: roundUsedCTag,
        nextCTag: currentC.cTag,
        bestEpoch: effectiveEpochRef,
        metricScope: effectiveMetrics.metricScope,
        hitRate: effectiveMetrics.pickHitRate,
        pickHitRate: effectiveMetrics.pickHitRate,
        pickHitCount: effectiveMetrics.pickHitCount,
        pickedCount: effectiveMetrics.pickedCount,
        promotionContext: effectiveMetrics.promotionContext,
        primaryScopeDiagnostics: compactScopeSnapshot(effectiveMetrics.primaryScopeDiagnostics),
        scopeDiagnostics: {
          all: compactScopeSnapshot(effectiveMetrics.scopeDiagnostics?.all),
          update: compactScopeSnapshot(effectiveMetrics.scopeDiagnostics?.update),
          eval: compactScopeSnapshot(effectiveMetrics.scopeDiagnostics?.eval)
        },
        onePickDays: effectiveMetrics.onePickDays,
        twoPickDays: effectiveMetrics.twoPickDays,
        action,
        rebuildReasonCategory,
        newDrops: newDrops.length,
        permanentDropTotal: permanentDropSet.size,
        cRebuilt,
        prototypeChangeRate,
        improved,
        sampleOk,
        sampleUpperOk,
        distributionOk,
        twoPickOk,
        lcbOk,
        conversionOk,
        speedOk,
        regimeOk,
        stabilityOk,
        noOpPolicyRound,
        pickHitRateLcb95: effectiveMetrics.pickHitRateLcb95,
        top1ToOracleConversion: effectiveMetrics.top1ToOracleConversion,
        promotionQualityScore: effectiveMetrics.promotionQualityScore,
        opeDelta: opeEval.delta,
        secondPickResetApplied,
        commonStatePromoted,
        stagnatedInRound,
        globalNoImproveRounds
      }),
    )

    if (globalNoImproveRounds >= cfg.finalStopNoImproveRounds) {
      break
    }
  }

  const bestRoundOpe =
    bestRound
      ? rounds.find((row) => Number(row?.round) === Number(bestRound?.round))?.ope ?? null
      : null
  const swaChampion = cfg?.swa?.enabled === true
    ? await buildSwaChampion({
      roundRows: rounds,
      cfg: cfg.swa,
      outPath: swaWeightsPath
    })
    : { built: false, reason: "DISABLED" }
  const championWeightsPath = String(bestRound?.bestWeightsPath ?? "")
  const lockboxGateEnabled = cfg?.lockboxGate?.enabled === true
  const bestRoundChampion = bestRound
    ? {
        round: bestRound.round,
        roundTag: bestRound.roundTag,
        bestEpoch: bestRound.bestEpoch,
        cTag: bestRound.cTag,
        metrics: bestRound.bestMetrics,
        weightsPath: championWeightsPath,
        artifactManifestPath: bestRound.bestArtifactManifestPath,
        summaryPath: bestRound.bestSummaryPath,
        logsPath: bestRound.bestLogsPath,
        sampledDebugPath: bestRound.bestSampledDebugPath,
        policyStatePath: bestRound.bestPolicyStatePath,
        policyBundlePath: bestRound.bestPolicyBundlePath,
        candidateIndexPath: bestRound.bestCandidateIndexPath,
        candidateIndexMetaPath: bestRound.bestCandidateIndexMetaPath,
        featurePackPath: bestRound.bestFeaturePackPath,
        featurePackMetaPath: bestRound.bestFeaturePackMetaPath,
        d1RankedCandidatesPath: bestRound.bestD1RankedCandidatesPath,
        d2ExecutionAuditPath: bestRound.bestD2ExecutionAuditPath,
        d1LockboxRankedCandidatesPath: bestRound.bestD1LockboxRankedCandidatesPath,
        d2LockboxExecutionAuditPath: bestRound.bestD2LockboxExecutionAuditPath,
        stepC0FamilyIndexPath: bestRound.bestStepC0FamilyIndexPath,
        stepC0MembershipPath: bestRound.bestStepC0MembershipPath,
        stepC0SummaryPath: bestRound.bestStepC0SummaryPath,
        stepC1IndexPath: bestRound.bestStepC1IndexPath,
        stepC1ResultsPath: bestRound.bestStepC1ResultsPath,
        stepC1SummaryPath: bestRound.bestStepC1SummaryPath,
        stepC2IndexPath: bestRound.bestStepC2IndexPath,
        stepC2GroupsPath: bestRound.bestStepC2GroupsPath,
        stepC2SummaryPath: bestRound.bestStepC2SummaryPath,
        stepCLibraryPath: bestRound.bestStepCLibraryPath,
        stepCRuntimePath: bestRound.bestStepCRuntimePath,
        stepCSummaryPath: bestRound.bestStepCSummaryPath,
        stepCIndexManifestPath: bestRound.bestStepCIndexManifestPath,
        stepCShapingStatePath: bestRound.bestStepCShapingStatePath,
        prototypeClassificationPath: bestRound.prototypeClassificationPath,
        weightsHash: bestRound.weightsHash,
        policyFingerprint: bestRound.policyFingerprint,
        commonStatePath
      }
    : null
  // Step E should evaluate the best round even when promotion constraints fail.
  // Promotion/deployment still use the stricter promotable/debt gates below.
  const diagnosticChampion = bestRoundChampion
  const promotableChampion =
    bestRoundChampion && bestRound?.promotable === true ? bestRoundChampion : null
  const researchGateCfg = cfg?.researchGates ?? {}
  const researchGateEnabled = researchGateCfg?.enabled === true
  const researchGateMinD = clamp01(researchGateCfg?.lineDiscard?.minD ?? 0.4)
  const researchGateMinE = clamp01(researchGateCfg?.lineDiscard?.minE ?? 0.4)
  const researchPromotionMinD = clamp01(researchGateCfg?.parentPromotion?.minD ?? 0.5)
  const researchPromotionMinE = clamp01(researchGateCfg?.parentPromotion?.minE ?? 0.55)
  const championStepCSummary =
    diagnosticChampion?.stepCSummaryPath && pathExists(diagnosticChampion.stepCSummaryPath)
      ? await readJson(diagnosticChampion.stepCSummaryPath, null).catch(() => null)
      : null
  const championStepC0Summary =
    diagnosticChampion?.stepC0SummaryPath && pathExists(diagnosticChampion.stepC0SummaryPath)
      ? await readJson(diagnosticChampion.stepC0SummaryPath, null).catch(() => null)
      : null
  const championStepC1Summary =
    diagnosticChampion?.stepC1SummaryPath && pathExists(diagnosticChampion.stepC1SummaryPath)
      ? await readJson(diagnosticChampion.stepC1SummaryPath, null).catch(() => null)
      : null
  const championStepC2Summary =
    diagnosticChampion?.stepC2SummaryPath && pathExists(diagnosticChampion.stepC2SummaryPath)
      ? await readJson(diagnosticChampion.stepC2SummaryPath, null).catch(() => null)
      : null
  const c0Gate = championStepCSummary?.c0Gate ?? championStepC0Summary?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const c1Gate = championStepCSummary?.c1Gate ?? championStepC1Summary?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const c2Gate = championStepCSummary?.c2Gate ?? championStepC2Summary?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const cGate = buildCGate({
    stepCSummary: championStepCSummary,
    cfg: ctx.config
  })
  const cGateFailed = researchGateEnabled === true && cGate?.failed === true
  const dGateMetrics = buildDGateMetrics(diagnosticChampion?.metrics ?? null)
  const dGateEval = evaluateResearchDGate({
    metrics: dGateMetrics,
    gateCfg: researchGateCfg?.lineDiscard,
    fallbackMinD: researchGateMinD,
    profile: "discard"
  })
  const promotionDGateEval = evaluateResearchDGate({
    metrics: dGateMetrics,
    gateCfg: researchGateCfg?.parentPromotion,
    fallbackMinD: researchPromotionMinD,
    profile: "promotion"
  })
  const researchGateDMetric = Number(dGateMetrics?.targetHitRateEval ?? 0) || 0
  const researchGateDPassed = researchGateEnabled !== true || dGateEval.passed === true
  const dGate = {
    ...dGateEval,
    enabled: researchGateEnabled
  }
  const lockboxRun = diagnosticChampion && lockboxGateEnabled
    ? researchGateDPassed && !cGateFailed
    ? await runChampionStepELockbox({
      ctx,
      loopDir,
      champion: diagnosticChampion
    })
    : {
      executed: false,
      lockboxRunDir: "",
      summaryPath: "",
      summary: null,
      error: cGateFailed ? "C_GATE_FAILED" : "SKIPPED_BY_D_RESEARCH_GATE"
    }
    : {
      executed: false,
      lockboxRunDir: "",
      summaryPath: "",
      summary: null,
      error: diagnosticChampion ? "LOCKBOX_GATE_DISABLED" : "NO_BEST_ROUND"
    }
  const lockboxGateEval = evaluateStepELockboxGate({
    lockboxSummary: lockboxRun?.summary ?? null,
    cfg
  })
  const championRoundSummary = rounds.find(
    (row) => Number(row?.round ?? -1) === Number(diagnosticChampion?.round ?? -2),
  ) ?? null
  const deploymentDebtEval = evaluateDeploymentDebt({
    championRoundSummary,
    lockboxGateEval,
    cfg
  })
  const eGateMetrics = buildEGateMetrics(lockboxGateEval?.metrics ?? lockboxRun?.summary ?? null)
  const eGateEval = evaluateResearchEGate({
    metrics: eGateMetrics,
    gateCfg: researchGateCfg?.lineDiscard,
    fallbackMinE: researchGateMinE,
    cfg,
    lockboxGateEval,
    executed: lockboxRun?.executed === true,
    cGateFailed,
    profile: "discard"
  })
  const promotionEGateEval = evaluateResearchEGate({
    metrics: eGateMetrics,
    gateCfg: researchGateCfg?.parentPromotion,
    fallbackMinE: researchPromotionMinE,
    cfg,
    lockboxGateEval,
    executed: lockboxRun?.executed === true,
    cGateFailed,
    profile: "promotion"
  })
  const researchGateEMetric = Number(eGateMetrics?.targetHitRate ?? 0) || 0
  const researchGateEPassed = researchGateEnabled !== true || eGateEval.passed === true
  const eGate = {
    ...eGateEval,
    enabled: researchGateEnabled && lockboxGateEnabled,
    metrics: eGateMetrics,
    notRunReason: lockboxRun?.executed === true ? null : String(lockboxRun?.error ?? "").trim() || null,
    lockboxGateEligible: lockboxGateEval?.eligible === true
  }
  const researchLineDiscarded =
    researchGateEnabled === true && (cGateFailed || !researchGateDPassed || !researchGateEPassed)
  const researchDiscardReason = researchGateEnabled !== true
    ? "DISABLED"
    : cGateFailed
      ? "C_GATE_FAILED"
    : !researchGateDPassed
      ? `STEP_D_BELOW_RESEARCH_GATE:${String(dGateEval?.reason ?? "FAILED")}`
    : !lockboxRun?.executed
        ? String(lockboxRun?.error ?? "STEP_E_UNAVAILABLE")
        : !researchGateEPassed
          ? `STEP_E_BELOW_RESEARCH_GATE:${String(eGateEval?.reason ?? "FAILED")}`
          : "PASS"
  const researchPromotionEligible =
    researchGateEnabled === true &&
    !cGateFailed &&
    promotionDGateEval.passed === true &&
    promotionEGateEval.passed === true
  const promotionGate = {
    enabled: researchGateEnabled,
    eligible: researchPromotionEligible === true,
    blocker:
      researchGateEnabled !== true
        ? "DISABLED"
        : cGateFailed
          ? "C_GATE_FAILED"
        : promotionDGateEval.passed !== true
          ? `STEP_D_BELOW_RESEARCH_PROMOTION_GATE:${String(promotionDGateEval?.reason ?? "FAILED")}`
        : promotionEGateEval.passed !== true
            ? (
              lockboxRun?.executed === true
                ? `STEP_E_BELOW_RESEARCH_PROMOTION_GATE:${String(promotionEGateEval?.reason ?? "FAILED")}`
                : String(lockboxRun?.error ?? "STEP_E_UNAVAILABLE")
            )
            : "PASS",
    metrics: {
      dMetric: researchGateDMetric,
      eMetric: researchGateEMetric
    },
    thresholds: {
      minD: researchPromotionMinD,
      minE: researchPromotionMinE,
      d: promotionDGateEval.thresholds,
      e: promotionEGateEval.thresholds
    },
    checks: {
      d: promotionDGateEval.checks,
      e: promotionEGateEval.checks
    }
  }
  const lockboxEligible =
    lockboxGateEnabled &&
    !!promotableChampion &&
    lockboxRun?.executed === true &&
    lockboxGateEval?.eligible === true
  const deploymentEligible =
    !!promotableChampion &&
    deploymentDebtEval?.eligible === true &&
    researchPromotionEligible === true
  const lockboxBlockedReason = (() => {
    if (!lockboxGateEnabled) return "LOCKBOX_GATE_DISABLED"
    if (!diagnosticChampion) return "NO_BEST_ROUND"
    if (cGateFailed) return "C_GATE_FAILED"
    if (lockboxRun?.executed !== true) {
      return String(lockboxRun?.error ?? "STEP_E_EXECUTION_FAILED")
    }
    if (!promotableChampion) return "PROMOTION_CONSTRAINTS_FAILED"
    return String(lockboxGateEval?.reason ?? "PASS")
  })()
  const candidateChampion = diagnosticChampion
  const safeChampion = deploymentEligible ? promotableChampion : null
  const championBundlePath = safeChampion
    ? path.join(loopDir, "champion_bundle.json")
    : null
  const championBundle = safeChampion
    ? await buildChampionBundle({
        bundlePath: championBundlePath,
        lineageKey,
        abRunId: abBinding.abRunId,
        runId: ctx.runId,
        sessionId,
        champion: safeChampion,
        lockboxSummaryPath: lockboxRun?.summaryPath ?? null
      })
    : null
  const championSource = safeChampion
    ? "BEST_ROUND"
    : promotableChampion
      ? "BEST_ROUND_BLOCKED_BY_DEPLOYMENT_DEBT"
      : diagnosticChampion
        ? "BEST_ROUND_DIAGNOSTIC_ONLY"
      : swaChampion?.built === true
        ? "SWA_NOT_PROMOTED"
        : null
  const diagnosticPrototypeLibraryPath = String(diagnosticChampion?.stepCLibraryPath ?? "").trim()
  const diagnosticPrototypeLibrary =
    diagnosticPrototypeLibraryPath && pathExists(diagnosticPrototypeLibraryPath)
      ? await readJson(diagnosticPrototypeLibraryPath, null)
      : null
  const allClassificationSources = rounds
    .map((row) => ({
      classificationPath: String(row?.prototypeClassificationPath ?? "").trim(),
      runId: ctx.runId,
      sessionId,
      round: Number.isFinite(Number(row?.round)) ? Number(row.round) : null,
      roundTag: String(row?.roundTag ?? "").trim() || null,
      cTag: String(row?.cTag ?? "").trim() || null,
      lineAccepted: (() => {
        const rowCGateFailed = row?.cGate?.failed === true
        if (rowCGateFailed) return false
        const rowDGateMetrics = buildDGateMetrics(row?.dGate?.metrics ?? row?.bestMetrics)
        const rowDPassed = rowDGateMetrics.targetHitRateEval >= researchGateMinD
        const isChampionRound =
          Number(row?.round ?? -1) === Number(diagnosticChampion?.round ?? -2)
        const rowEGateMetrics =
          isChampionRound && lockboxRun?.executed === true
            ? buildEGateMetrics(lockboxGateEval?.metrics ?? lockboxRun?.summary ?? null)
            : null
        return rowDPassed && !!rowEGateMetrics && rowEGateMetrics.targetHitRate >= researchGateMinE
      })(),
      discardReason: (() => {
        const rowCGateFailed = row?.cGate?.failed === true
        if (rowCGateFailed) return "C_GATE_FAILED"
        const rowDGateMetrics = buildDGateMetrics(row?.dGate?.metrics ?? row?.bestMetrics)
        const rowDPassed = rowDGateMetrics.targetHitRateEval >= researchGateMinD
        if (!rowDPassed) return "STEP_D_BELOW_RESEARCH_GATE"
        const isChampionRound =
          Number(row?.round ?? -1) === Number(diagnosticChampion?.round ?? -2)
        if (!isChampionRound) return "STEP_E_NOT_RUN"
        if (lockboxRun?.executed !== true) {
          return String(lockboxRun?.error ?? "STEP_E_UNAVAILABLE")
        }
        return researchGateEMetric >= researchGateMinE ? "LINE_ACCEPTED" : "STEP_E_BELOW_RESEARCH_GATE"
      })(),
      sourceStepD: buildDGateMetrics(row?.dGate?.metrics ?? row?.bestMetrics),
      sourceStepE:
        Number(row?.round ?? -1) === Number(diagnosticChampion?.round ?? -2) &&
        lockboxRun?.executed === true
          ? buildEGateMetrics(lockboxGateEval?.metrics ?? lockboxRun?.summary ?? null)
          : null,
      eNotRunReason: (() => {
        if (row?.cGate?.failed === true) {
          return "C_GATE_FAILED"
        }
        const rowDGateMetrics = buildDGateMetrics(row?.dGate?.metrics ?? row?.bestMetrics)
        if (rowDGateMetrics.targetHitRateEval < researchGateMinD) {
          return "STEP_D_BELOW_RESEARCH_GATE"
        }
        if (Number(row?.round ?? -1) !== Number(diagnosticChampion?.round ?? -2)) {
          return "NOT_BEST_ROUND_DIAGNOSTIC_ONLY"
        }
        if (lockboxRun?.executed !== true) {
          return String(lockboxRun?.error ?? "STEP_E_UNAVAILABLE")
        }
        return null
      })(),
      candidateMode: String(row?.candidateMode ?? "").trim() || null
    }))
    .filter((row) => row.classificationPath)

  const patternSalvage = await persistAdaptiveFrontierPatternPools({
    ctx,
    champion: {
      runId: ctx.runId,
      sessionId,
      round: diagnosticChampion?.round ?? null,
      roundTag: diagnosticChampion?.roundTag ?? null,
      cTag: diagnosticChampion?.cTag ?? null
    },
    classificationPath: String(diagnosticChampion?.prototypeClassificationPath ?? "").trim(),
    classificationSources: allClassificationSources,
    prototypeLookup: buildPrototypeLookup(diagnosticPrototypeLibrary)
  })
  const championC1Results =
    diagnosticChampion?.stepC1ResultsPath && pathExists(diagnosticChampion.stepC1ResultsPath)
      ? await readJsonl(diagnosticChampion.stepC1ResultsPath).catch(() => [])
      : []
  const championC2Index =
    diagnosticChampion?.stepC2IndexPath && pathExists(diagnosticChampion.stepC2IndexPath)
      ? await readJson(diagnosticChampion.stepC2IndexPath, null).catch(() => null)
      : null
  const familyPoolCfg = resolveFamilyPoolConfig(cfg, { cwd: ctx.cwd, config: ctx.config })
  let familyPoolManifest = null
  let familyPoolPath = familyPoolCfg.outputPath
  let familyPoolSnapshotPath = null
  if (familyPoolCfg.enabled === true) {
    familyPoolManifest = buildFamilyPoolManifest({
      c1Results: championC1Results,
      c2Index: championC2Index,
      lockboxFamilyRollups: lockboxRun?.summary?.familyLockboxRollup ?? [],
      cfg: familyPoolCfg,
      runId: ctx.runId,
      source: {
        stepC1ResultsPath: diagnosticChampion?.stepC1ResultsPath ?? null,
        stepC2IndexPath: diagnosticChampion?.stepC2IndexPath ?? null,
        stepESummaryPath: lockboxRun?.summaryPath ?? null
      }
    })
    if (familyPoolPath) {
      await ensureDir(path.dirname(familyPoolPath))
      await writeJson(familyPoolPath, familyPoolManifest)
      familyPoolSnapshotPath = path.join(ctx.runDir, "family_pool.json")
      await writeJson(familyPoolSnapshotPath, familyPoolManifest)
    }
  }
  const prototypeLedgerPath = resolvePrototypeLedgerPath(
    { cwd: ctx.cwd, config: ctx.config },
    cfg?.pattern?.prototypeSelection?.adaptiveFrontier?.prototypeLedgerPath,
  )
  const previousPrototypeLedger = await loadPrototypeContributionLedger({
    ctx: { cwd: ctx.cwd, config: ctx.config },
    pathOverride: prototypeLedgerPath
  }).catch(() => ({
    enabled: false,
    path: prototypeLedgerPath,
    manifest: null,
    byId: new Map()
  }))
  let prototypeLedgerManifest = null
  let prototypeLedgerSnapshotPath = null
  if (diagnosticPrototypeLibrary) {
    const prototypeClassificationRows =
      diagnosticChampion?.prototypeClassificationPath && pathExists(diagnosticChampion.prototypeClassificationPath)
        ? (
            (await readJson(diagnosticChampion.prototypeClassificationPath, null).catch(() => null))?.rows ?? []
          )
        : []
    prototypeLedgerManifest = buildPrototypeContributionLedger({
      library: diagnosticPrototypeLibrary,
      protoMetrics: prototypeClassificationRows,
      c1Results: championC1Results,
      c2Index: championC2Index,
      familyPool: familyPoolManifest,
      previousLedger: previousPrototypeLedger,
      runId: ctx.runId
    })
    if (prototypeLedgerPath) {
      await ensureDir(path.dirname(prototypeLedgerPath))
      await writeJson(prototypeLedgerPath, prototypeLedgerManifest)
      prototypeLedgerSnapshotPath = path.join(ctx.runDir, "prototype_contribution_ledger.json")
      await writeJson(prototypeLedgerSnapshotPath, prototypeLedgerManifest)
    }
  }
  let finalSummary = {
    mode: "cd-loop",
    runId: ctx.runId,
    sessionId,
    lineageKey,
    lineageStateDir: lineageStatePaths.dir,
    lineageDropRegistryPath: permanentDropPath,
    sessionPermanentDropPath,
    generatedAt: new Date().toISOString(),
    abSource: {
      source: abBinding.source,
      manifestPath: abBinding.manifestPath,
      abRunId: abBinding.abRunId,
      abRunDir: abBinding.abRunDir,
      currentConfigHash: abBinding.currentConfigHash,
      activeConfigHash: abBinding.activeConfigHash,
      configHashMatch: abBinding.configHashMatch
    },
    metricPrimary: "pickHitRate",
    metricPrimaryDescription: "추천 종목 기준 적중률(성공 종목 수 / 추천 종목 수)",
    metricPrimaryLcbField: "pickHitRateLcb95",
    config: cfg,
    rounds,
    bestRound,
    bestStepC0FamilyIndexPath: bestRound?.bestStepC0FamilyIndexPath ?? null,
    bestStepC0MembershipPath: bestRound?.bestStepC0MembershipPath ?? null,
    bestStepC0SummaryPath: bestRound?.bestStepC0SummaryPath ?? null,
    bestStepC1IndexPath: bestRound?.bestStepC1IndexPath ?? null,
    bestStepC1ResultsPath: bestRound?.bestStepC1ResultsPath ?? null,
    bestStepC1SummaryPath: bestRound?.bestStepC1SummaryPath ?? null,
    bestStepC2IndexPath: bestRound?.bestStepC2IndexPath ?? null,
    bestStepC2GroupsPath: bestRound?.bestStepC2GroupsPath ?? null,
    bestStepC2SummaryPath: bestRound?.bestStepC2SummaryPath ?? null,
    ope: bestRoundOpe,
    opeDelta: Number(bestRoundOpe?.delta ?? 0) || 0,
    championSource,
    swaChampion,
    c0Summary: championStepC0Summary,
    stepC0: championStepC0Summary,
    c1Summary: championStepC1Summary,
    stepC1: championStepC1Summary,
    c2Summary: championStepC2Summary,
    stepC2: championStepC2Summary,
    c0Gate,
    c1Gate,
    c2Gate,
    cGate,
    dGate,
    eGate,
    promotionGate,
    lockboxGate: {
      enabled: lockboxGateEnabled,
      eligible: lockboxEligible,
      reason: lockboxBlockedReason,
      diagnosticChampionAvailable: !!diagnosticChampion,
      promotionCandidateAvailable: !!promotableChampion,
      championRound: diagnosticChampion?.round ?? null,
      championRoundTag: diagnosticChampion?.roundTag ?? null,
      championCTag: diagnosticChampion?.cTag ?? null,
      lockboxRunDir: lockboxRun?.lockboxRunDir ?? null,
      stepESummaryPath: lockboxRun?.summaryPath ?? null,
      stepERunExecuted: lockboxRun?.executed === true,
      stepERunError: lockboxRun?.error ?? null,
      checks: lockboxGateEval?.checks ?? {},
      metrics: lockboxGateEval?.metrics ?? {},
      stepDEvalReference: lockboxRun?.summary?.stepDEvalReference ?? null,
      evalToLockboxGap: lockboxRun?.summary?.evalToLockboxGap ?? null,
      gateThresholds: {
        goalMode: cfg?.lockboxGate?.goalMode ?? "LEGACY_PNL_V1",
        positionSemantics: cfg?.lockboxGate?.positionSemantics ?? "SINGLE_POSITION_V1",
        minTrades: resolveOptionalNonNegativeInt(cfg?.lockboxGate?.minTrades, 10),
        minTargetHitCount: cfg?.lockboxGate?.minTargetHitCount ?? 0,
        minTargetHitRate: cfg?.lockboxGate?.minTargetHitRate ?? null,
        minTargetHitsPer20TradingDays: cfg?.lockboxGate?.minTargetHitsPer20TradingDays ?? null,
        maxStopRate: cfg?.lockboxGate?.maxStopRate ?? null,
        maxTimeoutNegativeRate: cfg?.lockboxGate?.maxTimeoutNegativeRate ?? null,
        minWinRate: cfg?.lockboxGate?.minWinRate ?? null,
        minAvgNetRet: cfg?.lockboxGate?.minAvgNetRet ?? null,
        minCumulativeReturn: cfg?.lockboxGate?.minCumulativeReturn ?? null,
        maxDrawdown: Math.max(0, Number(cfg?.lockboxGate?.maxDrawdown ?? 0.35) || 0.35),
        requireZeroLookaheadViolations: cfg?.lockboxGate?.requireZeroLookaheadViolations !== false,
        maxPolicyDriftScore: cfg?.lockboxGate?.maxPolicyDriftScore ?? null,
        minBucketConsistency: cfg?.lockboxGate?.minBucketConsistency ?? null,
        minRegimeConsistency: cfg?.lockboxGate?.minRegimeConsistency ?? null,
        minAgreementDecisionConsistency: cfg?.lockboxGate?.minAgreementDecisionConsistency ?? null,
        minAgreementReasonConsistency: cfg?.lockboxGate?.minAgreementReasonConsistency ?? null,
        maxTraceMismatchRate: cfg?.lockboxGate?.maxTraceMismatchRate ?? null,
        maxTraceCriticalMismatchDays: cfg?.lockboxGate?.maxTraceCriticalMismatchDays ?? null,
        minFalsePositiveRejectedCount: cfg?.lockboxGate?.minFalsePositiveRejectedCount ?? 0,
        minFalsePositiveRejectionPrecision: cfg?.lockboxGate?.minFalsePositiveRejectionPrecision ?? null
      }
    },
    deploymentDebt: {
      enabled: deploymentDebtEval?.enabled === true,
      eligible: deploymentEligible,
      reason: deploymentDebtEval?.reason ?? "PASS",
      checks: deploymentDebtEval?.checks ?? {},
      metrics: deploymentDebtEval?.metrics ?? {},
      requireLockboxEligible: deploymentDebtEval?.requireLockboxEligible === true
    },
    researchGate: {
      enabled: researchGateEnabled,
      cGateFailed: cGate?.failed === true,
      dMetricName: "targetHitRateEval",
      dMetric: researchGateDMetric,
      eMetricName: "targetHitRate",
      eMetric: researchGateEMetric,
      dPassed: researchGateDPassed,
      ePassed: researchGateEPassed,
      lineDiscarded: researchLineDiscarded,
      discardReason: researchDiscardReason,
      eligibleForParentPromotion: researchPromotionEligible === true,
      thresholds: {
        minD: researchGateMinD,
        minE: researchGateMinE,
        promotionMinD: researchPromotionMinD,
        promotionMinE: researchPromotionMinE
      }
    },
    discardReason: researchDiscardReason,
    patternSalvage,
    familyPool: familyPoolManifest
      ? {
          path: familyPoolPath,
          snapshotPath: familyPoolSnapshotPath,
          summary: familyPoolManifest.summary,
          thresholds: familyPoolManifest.thresholds
        }
      : null,
    prototypeLedger: prototypeLedgerManifest
      ? {
          path: prototypeLedgerPath,
          snapshotPath: prototypeLedgerSnapshotPath,
          summary: prototypeLedgerManifest.summary
        }
      : null,
    deploymentEligible,
    candidateChampion,
    safeChampion,
    championBundlePath,
    championBundle,
    cRebuildCount,
    permanentDropCount: permanentDropSet.size,
    permanentDropPath,
    candidateCommonStatePath: commonStatePath,
    candidateCommonStateMeta: summarizeCommonStateMeta(championCommonState),
    championCommonStatePath: safeChampion ? commonStatePath : null,
    championCommonStateMeta: safeChampion ? summarizeCommonStateMeta(championCommonState) : null,
    finalDecisionGate: {
      minScoreMargin: workingMinScoreMargin,
      maxScoreMargin: workingMaxScoreMargin,
      secondPick: clonePlain(workingSecondPickGate),
      inversionAdjust: inversionState
    },
    acceptedBaselineSeed: acceptedBaselineSeed
      ? {
          runId: acceptedBaselineSeed.runId,
          sessionId: acceptedBaselineSeed.sessionId,
          roundTag: acceptedBaselineSeed.roundTag,
          epochTag: acceptedBaselineSeed.epochTag,
          weightsPath: acceptedBaselineSeed.weightsPath,
          policyStatePath: acceptedBaselineSeed.policyStatePath,
          stepC0FamilyIndexPath: acceptedBaselineSeed.stepC0FamilyIndexPath,
          stepC0MembershipPath: acceptedBaselineSeed.stepC0MembershipPath,
          stepC0SummaryPath: acceptedBaselineSeed.stepC0SummaryPath,
          stepC1IndexPath: acceptedBaselineSeed.stepC1IndexPath,
          stepC1ResultsPath: acceptedBaselineSeed.stepC1ResultsPath,
          stepC1SummaryPath: acceptedBaselineSeed.stepC1SummaryPath,
          stepC2IndexPath: acceptedBaselineSeed.stepC2IndexPath,
          stepC2GroupsPath: acceptedBaselineSeed.stepC2GroupsPath,
          stepC2SummaryPath: acceptedBaselineSeed.stepC2SummaryPath,
          stepCLibraryPath: acceptedBaselineSeed.stepCLibraryPath,
          stepCRuntimePath: acceptedBaselineSeed.stepCRuntimePath,
          commonStatePath: acceptedBaselineSeed.commonStatePath
        }
      : null,
    candidatePeakSeed: candidatePeakSeed
      ? {
          runId: candidatePeakSeed.runId,
          sessionId: candidatePeakSeed.sessionId,
          roundTag: candidatePeakSeed.roundTag,
          epochTag: candidatePeakSeed.epochTag,
          weightsPath: candidatePeakSeed.weightsPath,
          policyStatePath: candidatePeakSeed.policyStatePath,
          stepC0FamilyIndexPath: candidatePeakSeed.stepC0FamilyIndexPath,
          stepC0MembershipPath: candidatePeakSeed.stepC0MembershipPath,
          stepC0SummaryPath: candidatePeakSeed.stepC0SummaryPath,
          stepC1IndexPath: candidatePeakSeed.stepC1IndexPath,
          stepC1ResultsPath: candidatePeakSeed.stepC1ResultsPath,
          stepC1SummaryPath: candidatePeakSeed.stepC1SummaryPath,
          stepC2IndexPath: candidatePeakSeed.stepC2IndexPath,
          stepC2GroupsPath: candidatePeakSeed.stepC2GroupsPath,
          stepC2SummaryPath: candidatePeakSeed.stepC2SummaryPath,
          stepCLibraryPath: candidatePeakSeed.stepCLibraryPath,
          stepCRuntimePath: candidatePeakSeed.stepCRuntimePath,
          commonStatePath: candidatePeakSeed.commonStatePath
        }
      : null,
    selectedParentSeed: selectedParentSeed
      ? {
          runId: selectedParentSeed.runId,
          sessionId: selectedParentSeed.sessionId,
          roundTag: selectedParentSeed.roundTag,
          epochTag: selectedParentSeed.epochTag,
          weightsPath: selectedParentSeed.weightsPath,
          policyStatePath: selectedParentSeed.policyStatePath,
          stepC0FamilyIndexPath: selectedParentSeed.stepC0FamilyIndexPath,
          stepC0MembershipPath: selectedParentSeed.stepC0MembershipPath,
          stepC0SummaryPath: selectedParentSeed.stepC0SummaryPath,
          stepC1IndexPath: selectedParentSeed.stepC1IndexPath,
          stepC1ResultsPath: selectedParentSeed.stepC1ResultsPath,
          stepC1SummaryPath: selectedParentSeed.stepC1SummaryPath,
          stepC2IndexPath: selectedParentSeed.stepC2IndexPath,
          stepC2GroupsPath: selectedParentSeed.stepC2GroupsPath,
          stepC2SummaryPath: selectedParentSeed.stepC2SummaryPath,
          stepCLibraryPath: selectedParentSeed.stepCLibraryPath,
          stepCRuntimePath: selectedParentSeed.stepCRuntimePath,
          commonStatePath: selectedParentSeed.commonStatePath
        }
      : null,
    probeCyclePlan: {
      enabled: probeLaneCfg?.enabled !== false,
      probeLane,
      sessionMode: probeCycleRuntime?.sessionMode ?? "baseline_exploit",
      parentMode: probeCycleRuntime?.parentMode ?? "config_start_bootstrap",
      parentKey: String(probeCycleRuntime?.parentKey ?? "").trim(),
      fingerprint: String(probeCycleRuntime?.fingerprint?.fingerprint ?? "").trim(),
      acceptedBaselineKey: String(probeCycleRuntime?.acceptedBaselineKey ?? "").trim(),
      plateauActiveBeforeSession: probeCycleRuntime?.plateauActiveBeforeSession === true,
      structuralAllowed: probeCycleRuntime?.structuralAllowed !== false
    },
    distributionControl: {
      zeroOnePickSkewStreak,
      resetStreakThreshold: Number(cfg.zeroOnePickResetStreak ?? 2)
    }
  }
  const researchParentCandidate = await persistResearchParentCandidate({
    lineageStateDir: lineageStatePaths.dir,
    current: buildProgressRecordFromSummary({
      summary: finalSummary,
      summaryPath
    }),
    eligible: promotionGate?.eligible === true
  })
  finalSummary = {
    ...finalSummary,
    researchParentCandidate
  }
  const progressTracking = await persistProgressTracking({
    lineageStateDir: lineageStatePaths.dir,
    probeRootDir: path.join(ctx.runDir, "cd-loop"),
    summary: finalSummary,
    summaryPath,
    cfg,
    probeCycleRuntime,
    probeCyclePaths
  })
  finalSummary = {
    ...finalSummary,
    progressTracking
  }
  await writeJson(summaryPath, finalSummary)
  const finalC0FamilyIndex =
    finalSummary?.bestStepC0FamilyIndexPath && pathExists(finalSummary.bestStepC0FamilyIndexPath)
      ? await readJson(finalSummary.bestStepC0FamilyIndexPath, null).catch(() => null)
      : null
  const finalC1ProbeIndex =
    finalSummary?.bestStepC1IndexPath && pathExists(finalSummary.bestStepC1IndexPath)
      ? await readJson(finalSummary.bestStepC1IndexPath, null).catch(() => null)
      : null
  const finalC1ProbeResults =
    finalSummary?.bestStepC1ResultsPath && pathExists(finalSummary.bestStepC1ResultsPath)
      ? await readJsonl(finalSummary.bestStepC1ResultsPath).catch(() => [])
      : []
  const finalC2DedupIndex =
    finalSummary?.bestStepC2IndexPath && pathExists(finalSummary.bestStepC2IndexPath)
      ? await readJson(finalSummary.bestStepC2IndexPath, null).catch(() => null)
      : null
  const finalC2DedupGroups =
    finalSummary?.bestStepC2GroupsPath && pathExists(finalSummary.bestStepC2GroupsPath)
      ? await readJsonl(finalSummary.bestStepC2GroupsPath).catch(() => [])
      : []
  await updateActiveResearchHandoff({
    cwd: ctx.cwd,
    finalSummary,
    stepC0Summary: championStepC0Summary,
    stepC1Summary: championStepC1Summary,
    stepC2Summary: championStepC2Summary,
    stepCSummary: championStepCSummary,
    c0FamilyIndex: finalC0FamilyIndex,
    c1ProbeIndex: finalC1ProbeIndex,
    c1ProbeResults: finalC1ProbeResults,
    c2DedupIndex: finalC2DedupIndex,
    c2DedupGroups: finalC2DedupGroups
  }).catch(() => null)
  const cachedWorkerPool = ctx.__runtime?.stepDWorkerPool?.pool
  if (cachedWorkerPool && typeof cachedWorkerPool.close === "function") {
    await cachedWorkerPool.close()
    if (ctx.__runtime && Object.prototype.hasOwnProperty.call(ctx.__runtime, "stepDWorkerPool")) {
      delete ctx.__runtime.stepDWorkerPool
    }
  }
  return {
    loopDir,
    summaryPath,
    summary: finalSummary
  }
}
