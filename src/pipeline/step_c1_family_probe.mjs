import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir, pathExists, readJson, readJsonl, writeJson, writeJsonl } from "../lib/io.mjs"
import { runStepC } from "./step_c_pattern_mine.mjs"
import { runStepD } from "./step_d_online_loop.mjs"
import { runStepE } from "./step_e_lockbox_backtest.mjs"
import { buildStepDC1FamilyProbeProfile } from "./step_d_profile.mjs"

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

const pickTopCountKey = (counts) =>
  Object.entries(counts && typeof counts === "object" ? counts : {})
    .map(([key, value]) => ({
      key: String(key ?? "").trim(),
      count: Math.max(0, Number(value ?? 0) || 0)
    }))
    .filter((row) => row.key && row.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return left.key.localeCompare(right.key)
    })[0]?.key ?? null

const normalizeUpperKey = (value) => String(value ?? "").trim().toUpperCase()

const normalizeExplicitFamilyIds = (values) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )]

const resolveRecommendedScoreAction = (result) => {
  const primaryGateReason = normalizeUpperKey(result?.primaryGateReasonEval)
  const primaryComponent = normalizeUpperKey(result?.scorePathologyPrimaryComponentEval)
  const primarySubcomponent = normalizeUpperKey(result?.scorePathologyPrimarySubcomponentEval)
  const compositeType = normalizeUpperKey(result?.scorePathologyCompositeTypeEval)
  const eraSupportPenaltyReason = normalizeUpperKey(result?.eraSupportPenaltyReasonEval)
  const topNPassExistsRateEval = Number(result?.topNPassExistsRateEval ?? 0) || 0
  const scoreRecoveryWouldHitRateEval = Number(result?.scoreRecoveryWouldHitRateEval ?? 0) || 0
  const scoreRecalibrationWouldHitRateEval =
    Number(result?.scoreRecalibrationWouldHitRateEval ?? 0) || 0
  const eraCoverageRatioP50Eval = Number(result?.eraCoverageRatioP50Eval ?? 0) || 0
  const effectiveEraCountRatioP50Eval =
    Number(result?.singleEraEvidenceEffectiveEraCountRatioP50Eval ?? 0) || 0
  const entropyRatioP50Eval =
    Number(result?.singleEraEvidenceEntropyRatioP50Eval ?? 0) || 0
  const diversifiedLowSupport =
    eraSupportPenaltyReason === "LOW_SUPPORT_COUNT" &&
    eraCoverageRatioP50Eval >= 0.5 &&
    effectiveEraCountRatioP50Eval >= 0.9 &&
    entropyRatioP50Eval >= 0.4
  if (topNPassExistsRateEval > 0) return "AGREEMENT_RERANK_SHADOW"
  if (scoreRecoveryWouldHitRateEval > 0) return "SCORE_RECOVERY_SHADOW"
  if (scoreRecalibrationWouldHitRateEval > 0 || ["SCORE_BELOW_MIN", "POLICY_TAU_RANK_LOW"].includes(primaryGateReason)) {
    if (compositeType === "ERA_SUPPORT_PLUS_SLIPPAGE") {
      return "ERA_SUPPORT_SLIPPAGE_RECALIBRATION_SHADOW"
    }
    if (compositeType === "ERA_SUPPORT_PLUS_STOP_RATE") {
      return "ERA_SUPPORT_STOP_RATE_RECALIBRATION_SHADOW"
    }
    if (compositeType === "ERA_SUPPORT_PLUS_REGIME") {
      return "ERA_SUPPORT_REGIME_RECALIBRATION_SHADOW"
    }
    switch (primaryComponent) {
      case "POST_ADJUST_HEAVY":
        switch (primarySubcomponent) {
          case "ANTI_PENALTY":
            return "ANTI_PENALTY_RECALIBRATION_SHADOW"
          case "STOP_RATE_PENALTY":
            return "STOP_RATE_RECALIBRATION_SHADOW"
          case "SINGLE_ERA_PENALTY":
          case "SINGLE_ERA_CONCENTRATION_PENALTY":
            return "SINGLE_ERA_RECALIBRATION_SHADOW"
          case "LOW_ERA_SUPPORT_PENALTY":
          case "SUPPORT_COUNT_PENALTY":
            return diversifiedLowSupport ? "ERA_SUPPORT_RECALIBRATION_SHADOW" : "KEEP_BLOCK"
          case "ERA_COVERAGE_PENALTY":
            return "ERA_COVERAGE_RECALIBRATION_SHADOW"
          default:
            return "POST_ADJUST_RECALIBRATION_SHADOW"
        }
      case "EXECUTION_PRIOR_HEAVY":
        switch (primarySubcomponent) {
          case "LOW_FILL_PENALTY":
            return "LOW_FILL_RECALIBRATION_SHADOW"
          case "SLIPPAGE_PENALTY":
            return "SLIPPAGE_RECALIBRATION_SHADOW"
          case "LOW_LIQUIDITY_PENALTY":
            return "LOW_LIQUIDITY_RECALIBRATION_SHADOW"
          case "BLOCKED_ORDER_PENALTY":
            return "BLOCKED_ORDER_RECALIBRATION_SHADOW"
          case "NEGATIVE_AFTER_COST_PENALTY":
            return "AFTER_COST_RECALIBRATION_SHADOW"
          default:
            return "EXECUTION_PRIOR_RECALIBRATION_SHADOW"
        }
      case "TRADE_QUALITY_HEAVY":
        switch (primarySubcomponent) {
          case "TRADE_QUALITY_RANKER_ADJUSTMENT":
            return "TRADE_QUALITY_RANKER_RECALIBRATION_SHADOW"
          case "TRADE_QUALITY_ROUTE_RESIDUAL":
            return "TRADE_QUALITY_ROUTE_RECALIBRATION_SHADOW"
          case "TRADE_QUALITY_REGIME_RESIDUAL":
            return "TRADE_QUALITY_REGIME_RECALIBRATION_SHADOW"
          case "TRADE_QUALITY_PROTOTYPE_RESIDUAL":
            return "TRADE_QUALITY_PROTOTYPE_RECALIBRATION_SHADOW"
          default:
            return "TRADE_QUALITY_RECALIBRATION_SHADOW"
        }
      case "REGIME_EXPERT_HEAVY":
        switch (primarySubcomponent) {
          case "REGIME_MULTIPLIER_PENALTY":
            return "REGIME_MULTIPLIER_RECALIBRATION_SHADOW"
          default:
            return "REGIME_EXPERT_RECALIBRATION_SHADOW"
        }
      case "EXTENDED_BIAS_HEAVY":
        switch (primarySubcomponent) {
          case "EXTENDED_BIAS_PENALTY":
            return "EXTENDED_BIAS_RECALIBRATION_SHADOW"
          default:
            return "EXTENDED_BIAS_RECALIBRATION_SHADOW"
        }
      case "MIXED_DEEP_FAIL":
        return "MIXED_SCORE_RECALIBRATION_SHADOW"
      default:
        return "SCORE_RECALIBRATION_SHADOW"
    }
  }
  return "KEEP_BLOCK"
}

const resolveStepC1SourceRunDir = (ctx) =>
  String(ctx?.__runtime?.stepC1SourceRunDirOverride ?? "").trim()
    ? String(ctx.__runtime.stepC1SourceRunDirOverride)
    : String(ctx?.abRunDir ?? "").trim()
      ? String(ctx.abRunDir)
      : String(ctx?.runDir ?? "")

const resolveStepC1SourceRunId = (ctx, sourceRunDir = resolveStepC1SourceRunDir(ctx)) =>
  String(ctx?.abRunId ?? "").trim() || path.basename(String(sourceRunDir ?? ""))

const resolveC1LockboxEvalConfig = (raw) => ({
  enabled: raw?.enabled === true,
  persistArtifacts: raw?.persistArtifacts === true,
  minPickFloor: Math.max(0, Math.floor(Number(raw?.minPickFloor ?? 1) || 1)),
  maxConcurrentFamilies: Math.max(
    1,
    Math.floor(Number(raw?.maxConcurrentFamilies ?? 4) || 4),
  ),
})

const resolveC1BundleEvalConfig = (raw) => ({
  enabled: raw?.enabled === true,
  minPickFloorDWeak: Math.max(0, Math.floor(Number(raw?.minPickFloorDWeak ?? 6) || 6)),
  minPickFloorEWeak: Math.max(0, Math.floor(Number(raw?.minPickFloorEWeak ?? 6) || 6)),
  minPickFloorDStrong: Math.max(0, Math.floor(Number(raw?.minPickFloorDStrong ?? 10) || 10)),
  minPickFloorEStrong: Math.max(0, Math.floor(Number(raw?.minPickFloorEStrong ?? 10) || 10)),
  defaultAbstainWhenNoConsensus: raw?.defaultAbstainWhenNoConsensus !== false,
  maxConcurrentBundles: Math.max(1, Math.floor(Number(raw?.maxConcurrentBundles ?? 4) || 4)),
})

const resolveC1Config = (config, runtime = {}) => {
  const raw = config?.pattern?.c1 ?? {}
  const configExplicitFamilyIds = normalizeExplicitFamilyIds(raw?.explicitFamilyIds)
  const runtimeExplicitFamilyIds = normalizeExplicitFamilyIds(
    runtime?.stepC1ExplicitFamilyIdsOverride,
  )
  const explicitFamilyIds =
    runtimeExplicitFamilyIds.length > 0 ? runtimeExplicitFamilyIds : configExplicitFamilyIds
  return {
    enabled: raw?.enabled === true,
    maxProbeFamilies: Math.max(1, Math.floor(Number(raw?.maxProbeFamilies ?? 10) || 10)),
    minFamilySupport: Math.max(1, Math.floor(Number(raw?.minFamilySupport ?? 6) || 6)),
    maxFamilyRepresentatives: Math.max(
      1,
      Math.floor(Number(raw?.maxFamilyRepresentatives ?? 24) || 24),
    ),
    probeProfile: String(raw?.probeProfile ?? "C1_FAMILY_PROBE").trim() || "C1_FAMILY_PROBE",
    probeScope: String(raw?.probeScope ?? "update").trim() || "update",
    familyPassMinTargetHitRateEval: clamp01(raw?.familyPassMinTargetHitRateEval ?? 0.1),
    familyPassMinExecutedTargetHitRateEval: clamp01(
      raw?.familyPassMinExecutedTargetHitRateEval ?? 0.08,
    ),
    familyPassMinSelectionHitAt1Eval: clamp01(raw?.familyPassMinSelectionHitAt1Eval ?? 0.08),
    selectionHitAt1MetricMode:
      String(raw?.selectionHitAt1MetricMode ?? "raw").trim().toLowerCase() || "raw",
    selectionHitAt1AgreementFallbackAwareMinDaysEval: Math.max(
      0,
      Math.floor(Number(raw?.selectionHitAt1AgreementFallbackAwareMinDaysEval ?? 1) || 1),
    ),
    selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons: Array.isArray(
      raw?.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons,
    )
      ? raw.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean)
      : ["AGREEMENT_FALLBACK_PASS"],
    familyPassMinPickedDaysEval: Math.max(
      0,
      Math.floor(Number(raw?.familyPassMinPickedDaysEval ?? 4) || 4),
    ),
    familyPassMinTargetsPer20EvalDays: Math.max(
      0,
      Number(raw?.familyPassMinTargetsPer20EvalDays ?? 0.8) || 0,
    ),
    familyPassMinExecutionCoverageEval: clamp01(raw?.familyPassMinExecutionCoverageEval ?? 0.2),
    familyPassMaxStopRateEval: clamp01(raw?.familyPassMaxStopRateEval ?? 0.6),
    familyPassMaxTimeoutNegativeRateEval: clamp01(
      raw?.familyPassMaxTimeoutNegativeRateEval ?? 0.6,
    ),
    familyBackfillFloor: Math.max(1, Math.floor(Number(raw?.familyBackfillFloor ?? 4) || 4)),
    familyBackfillMax: Math.max(0, Math.floor(Number(raw?.familyBackfillMax ?? 4) || 4)),
    retainTopProbeArtifacts: Math.max(
      0,
      Math.floor(Number(raw?.retainTopProbeArtifacts ?? 0) || 0),
    ),
    cleanupScratch: raw?.cleanupScratch !== false,
    lockboxEval: resolveC1LockboxEvalConfig(raw?.lockboxEval),
    bundleEval: resolveC1BundleEvalConfig(raw?.bundleEval),
    explicitFamilyIds,
    scoreWeights: {
      precision: Math.max(0, Number(raw?.scoreWeights?.precision ?? 0.34) || 0),
      execution: Math.max(0, Number(raw?.scoreWeights?.execution ?? 0.24) || 0),
      coverage: Math.max(0, Number(raw?.scoreWeights?.coverage ?? 0.22) || 0),
      rank: Math.max(0, Number(raw?.scoreWeights?.rank ?? 0.12) || 0),
      prototypeQuality: Math.max(0, Number(raw?.scoreWeights?.prototypeQuality ?? 0.08) || 0),
      coreShareBonus: Math.max(0, Number(raw?.scoreWeights?.coreShareBonus ?? 0.04) || 0),
      penaltyPenalty: Math.max(0, Number(raw?.scoreWeights?.penaltyPenalty ?? 0.03) || 0),
      quarantinePenalty: Math.max(0, Number(raw?.scoreWeights?.quarantinePenalty ?? 0.04) || 0),
      stopPenalty: Math.max(0, Number(raw?.scoreWeights?.stopPenalty ?? 0.05) || 0),
      timeoutPenalty: Math.max(0, Number(raw?.scoreWeights?.timeoutPenalty ?? 0.03) || 0)
    }
  }
}

const resolveRecommendedStrategy = (result) => {
  const primaryGateReason = String(result?.primaryGateReasonEval ?? "").trim().toUpperCase()
  const agreementPattern = String(result?.agreementPrimaryPatternEval ?? "").trim().toUpperCase()
  const topNPassExistsRateEval = Number(result?.topNPassExistsRateEval ?? 0) || 0
  const scoreRecoveryWouldHitRateEval = Number(result?.scoreRecoveryWouldHitRateEval ?? 0) || 0
  const scoreRecalibrationWouldHitRateEval =
    Number(result?.scoreRecalibrationWouldHitRateEval ?? 0) || 0
  const scoreBelowMinShortfallP50Eval = Number(result?.scoreBelowMinShortfallP50Eval ?? 0) || 0
  const scoreMarginShortfallP50Eval = Number(result?.scoreMarginShortfallP50Eval ?? 0) || 0
  if (topNPassExistsRateEval > 0 && agreementPattern === "SINGLE_ALT") {
    return "ORDERING_RERANK"
  }
  if (scoreRecoveryWouldHitRateEval > 0) {
    return "SCORE_NEAR_MISS"
  }
  if (
    ["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW"].includes(primaryGateReason) &&
    (
      (primaryGateReason === "SCORE_BELOW_MIN" && scoreBelowMinShortfallP50Eval > 0 && scoreBelowMinShortfallP50Eval <= 0.015) ||
      (primaryGateReason === "SCORE_MARGIN_LOW" && scoreMarginShortfallP50Eval > 0 && scoreMarginShortfallP50Eval <= 0.01)
    )
  ) {
    return "SCORE_NEAR_MISS"
  }
  if (
    scoreRecalibrationWouldHitRateEval > 0 ||
    ["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"].includes(primaryGateReason)
  ) {
    return "SCORE_DEEP_FAIL"
  }
  if (["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"].includes(primaryGateReason)) {
    return "SCORE_DEEP_FAIL"
  }
  return "KEEP_BLOCK"
}

const resolveSelectionHitAt1Metric = ({ result, cfg }) => {
  const raw = clamp01(result?.selectionHitAt1Eval ?? 0)
  const mode = String(cfg?.selectionHitAt1MetricMode ?? "raw")
    .trim()
    .toLowerCase()
  if (mode !== "agreement_fallback_aware") {
    return {
      value: raw,
      source: "RAW_TOP1"
    }
  }
  const primaryGateReason = String(result?.primaryGateReasonEval ?? "").trim().toUpperCase()
  const allowedReasons = Array.isArray(cfg?.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons)
    ? cfg.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons
    : ["AGREEMENT_FALLBACK_PASS"]
  if (allowedReasons.length > 0 && !allowedReasons.includes(primaryGateReason)) {
    return {
      value: raw,
      source: "RAW_TOP1"
    }
  }
  const minDays = Math.max(
    0,
    Math.floor(Number(cfg?.selectionHitAt1AgreementFallbackAwareMinDaysEval ?? 1) || 1),
  )
  const fallbackDays = Math.max(0, Number(result?.agreementFallbackDaysEval ?? 0) || 0)
  if (fallbackDays < minDays) {
    return {
      value: raw,
      source: "RAW_TOP1"
    }
  }
  const fallbackAware = clamp01(result?.selectionHitAt1AgreementFallbackAwareEval ?? raw)
  if (fallbackAware <= raw) {
    return {
      value: raw,
      source: "RAW_TOP1"
    }
  }
  return {
    value: fallbackAware,
    source: "AGREEMENT_FALLBACK_AWARE"
  }
}

const buildRejectReason = ({ result, cfg }) => {
  const probeErrorType = String(result?.probeErrorType ?? "").trim()
  const selectionMetric = resolveSelectionHitAt1Metric({ result, cfg })
  if (probeErrorType) {
    return probeErrorType
  }
  if (Number(result?.probePrototypeCount ?? 0) < 1) {
    return "NO_PROTOTYPES"
  }
  if (Number(result?.pickedDaysEval ?? 0) < 1) {
    return "NO_RECOMMENDATIONS"
  }
  if (Number(result?.targetHitRateEval ?? 0) < cfg.familyPassMinTargetHitRateEval) {
    return "LOW_TARGET_HIT_RATE_EVAL"
  }
  if (
    Number(result?.executedTargetHitRateEval ?? 0) < cfg.familyPassMinExecutedTargetHitRateEval
  ) {
    return "LOW_EXECUTED_TARGET_HIT_RATE_EVAL"
  }
  if (Number(selectionMetric?.value ?? result?.selectionHitAt1Eval ?? 0) < cfg.familyPassMinSelectionHitAt1Eval) {
    return "LOW_SELECTION_HIT_AT_1_EVAL"
  }
  if (Number(result?.pickedDaysEval ?? 0) < cfg.familyPassMinPickedDaysEval) {
    return "LOW_PICKED_DAYS_EVAL"
  }
  if (Number(result?.targetsPer20EvalDays ?? 0) < cfg.familyPassMinTargetsPer20EvalDays) {
    return "LOW_TARGETS_PER_20_EVAL_DAYS"
  }
  if (Number(result?.executionCoverageEval ?? 0) < cfg.familyPassMinExecutionCoverageEval) {
    return "LOW_EXECUTION_COVERAGE_EVAL"
  }
  if (Number(result?.stopRateEval ?? 0) > cfg.familyPassMaxStopRateEval) {
    return "HIGH_STOP_RATE_EVAL"
  }
  if (
    Number(result?.timeoutNegativeRateEval ?? 0) > cfg.familyPassMaxTimeoutNegativeRateEval
  ) {
    return "HIGH_TIMEOUT_NEGATIVE_RATE_EVAL"
  }
  return "PASS"
}

const scoreFamilyProbeResult = ({ result, cfg }) => {
  const weights = cfg.scoreWeights ?? {}
  const selectionMetric = resolveSelectionHitAt1Metric({ result, cfg })
  const coverageNorm = Math.max(0.01, Number(cfg.familyPassMinTargetsPer20EvalDays ?? 1) || 1)
  return (
    (Number(weights.precision ?? 0) || 0) * clamp01(result?.targetHitRateEval ?? 0) +
    (Number(weights.execution ?? 0) || 0) * clamp01(result?.executedTargetHitRateEval ?? 0) +
    (Number(weights.coverage ?? 0) || 0) *
      Math.min(1, Math.max(0, Number(result?.targetsPer20EvalDays ?? 0) || 0) / coverageNorm) +
    (Number(weights.rank ?? 0) || 0) * clamp01(selectionMetric?.value ?? result?.selectionHitAt1Eval ?? 0) +
    (Number(weights.prototypeQuality ?? 0) || 0) *
      clamp01(result?.c0PrototypeQualityMedian ?? 0) +
    (Number(weights.coreShareBonus ?? 0) || 0) *
      clamp01(result?.c0CorePrototypeShare ?? 0) -
    (Number(weights.penaltyPenalty ?? 0) || 0) *
      clamp01(result?.c0PenaltyPrototypeShare ?? 0) -
    (Number(weights.quarantinePenalty ?? 0) || 0) *
      clamp01(result?.c0QuarantinePrototypeShare ?? 0) -
    (Number(weights.stopPenalty ?? 0) || 0) * clamp01(result?.stopRateEval ?? 0) -
    (Number(weights.timeoutPenalty ?? 0) || 0) * clamp01(result?.timeoutNegativeRateEval ?? 0)
  )
}

const normalizeDayKey = (value) => String(value ?? "").trim().slice(0, 10)

const extractRowDayKey = (row) => {
  for (const key of ["eventDate", "asOfDate", "date", "tradeDate", "day", "baseDate"]) {
    const text = normalizeDayKey(row?.[key])
    if (text) return text
  }
  return ""
}

const extractRowSymbol = (row) => {
  for (const key of ["symbol", "targetSymbol", "candidateSymbol", "ticker", "code"]) {
    const text = String(row?.[key] ?? "").trim().toUpperCase()
    if (text) return text
  }
  return ""
}

const extractRowRegime = (row) => {
  const parts = [
    String(row?.regimeTag ?? row?.regime ?? row?.marketRegime ?? "").trim(),
    String(row?.volBucket ?? row?.volatilityBucket ?? "").trim(),
    String(row?.dayType ?? row?.dayTypeBucket ?? "").trim()
  ].filter(Boolean)
  return parts.length > 0 ? parts.join("|") : ""
}

const extractRowRank = (row, fallback = 9999) => {
  for (const key of ["rank", "selectedRank", "candidateRank", "rankIndex", "modelRank"]) {
    const n = Number(row?.[key])
    if (Number.isFinite(n)) return n
  }
  return fallback
}

const extractSelectedCandidates = (row) =>
  Array.isArray(row?.selectedCandidates)
    ? row.selectedCandidates
    : Array.isArray(row?.pickedList)
      ? row.pickedList
      : []

const buildFamilyOverlapFootprint = async ({ familyId, scratchDir, result }) => {
  const rankedPath = path.join(scratchDir, "step-d", "d1_ranked_candidates.jsonl")
  const auditPath = path.join(scratchDir, "step-d", "d2_execution_audit.jsonl")
  const rankedRows = pathExists(rankedPath) ? await readJsonl(rankedPath) : []
  const auditRows = pathExists(auditPath) ? await readJsonl(auditPath) : []
  const pickedDaySet = new Set()
  const symbolDaySet = new Set()
  const executionSymbolDaySet = new Set()
  const regimeSet = new Set()
  const top1ByDay = new Map()
  const topRanksByDay = new Map()

  for (const row of auditRows) {
    const dayKey = extractRowDayKey(row)
    const candidates = extractSelectedCandidates(row)
    if (candidates.length < 1 || !dayKey) continue
    pickedDaySet.add(dayKey)
    const ranks = []
    for (const candidate of candidates) {
      const symbol = extractRowSymbol(candidate)
      if (!symbol) continue
      symbolDaySet.add(`${dayKey}::${symbol}`)
      const regime = extractRowRegime(candidate) || extractRowRegime(row)
      if (regime) regimeSet.add(regime)
      ranks.push(symbol)
    }
    if (ranks.length > 0) {
      top1ByDay.set(dayKey, ranks[0])
      topRanksByDay.set(dayKey, ranks.slice(0, 3))
    }
  }

  if (topRanksByDay.size < 1) {
    const rankedByDay = new Map()
    for (const row of rankedRows) {
      const dayKey = extractRowDayKey(row)
      const symbol = extractRowSymbol(row)
      if (!dayKey || !symbol) continue
      const rank = extractRowRank(row)
      const list = rankedByDay.get(dayKey) ?? []
      list.push({ rank, symbol })
      rankedByDay.set(dayKey, list)
      const regime = extractRowRegime(row)
      if (regime) regimeSet.add(regime)
    }
    for (const [dayKey, list] of rankedByDay.entries()) {
      list.sort((left, right) => Number(left.rank) - Number(right.rank))
      const ranks = list.slice(0, 3).map((row) => row.symbol)
      if (ranks.length < 1) continue
      pickedDaySet.add(dayKey)
      for (const symbol of ranks) {
        symbolDaySet.add(`${dayKey}::${symbol}`)
      }
      top1ByDay.set(dayKey, ranks[0])
      topRanksByDay.set(dayKey, ranks)
    }
  }

  for (const row of rankedRows) {
    const regime = extractRowRegime(row)
    if (regime) regimeSet.add(regime)
  }
  for (const row of auditRows) {
    const dayKey = extractRowDayKey(row)
    const symbol = extractRowSymbol(row)
    if (dayKey && symbol) {
      executionSymbolDaySet.add(`${dayKey}::${symbol}`)
    }
    const regime = extractRowRegime(row)
    if (regime) regimeSet.add(regime)
  }

  return {
    familyId,
    symbolDays: Array.from(symbolDaySet).sort((a, b) => a.localeCompare(b)),
    pickedDays: Array.from(pickedDaySet).sort((a, b) => a.localeCompare(b)),
    executionSymbolDays: Array.from(executionSymbolDaySet).sort((a, b) => a.localeCompare(b)),
    top1ByDay: Array.from(top1ByDay.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([dayKey, symbol]) => ({ dayKey, symbol })),
    topRanksByDay: Array.from(topRanksByDay.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([dayKey, symbols]) => ({ dayKey, symbols })),
    regimes: Array.from(regimeSet).sort((a, b) => a.localeCompare(b)),
    metrics: {
      targetHitRateEval: Number(result?.targetHitRateEval ?? 0) || 0,
      executedTargetHitRateEval: Number(result?.executedTargetHitRateEval ?? 0) || 0,
      selectionHitAt1Eval: Number(result?.selectionHitAt1Eval ?? 0) || 0,
      targetsPer20EvalDays: Number(result?.targetsPer20EvalDays ?? 0) || 0,
      executionCoverageEval: Number(result?.executionCoverageEval ?? 0) || 0,
    stopRateEval: Number(result?.stopRateEval ?? 0) || 0,
      timeoutNegativeRateEval: Number(result?.timeoutNegativeRateEval ?? 0) || 0,
      agreementBlockedDaysEval: Number(result?.agreementBlockedDaysEval ?? 0) || 0,
      agreementBlockedTop1WouldHaveHitRateEval:
        Number(result?.agreementBlockedTop1WouldHaveHitRateEval ?? 0) || 0
    }
  }
}

const loadStepC1Inputs = async (ctx) => {
  const sourceRunDir = resolveStepC1SourceRunDir(ctx)
  const rootDir = path.join(sourceRunDir, "step-c0")
  const familyIndexPath = path.join(rootDir, "c0_family_index.json")
  const membershipPath = path.join(rootDir, "c0_family_membership.jsonl")
  const summaryPath = path.join(rootDir, "c0_summary.json")
  if (!pathExists(familyIndexPath) || !pathExists(membershipPath)) {
    return {
      familyIndex: null,
      membershipRows: [],
      summary: null,
      sourceRunDir,
      familyIndexPath,
      membershipPath,
      summaryPath
    }
  }
  return {
    familyIndex: await readJson(familyIndexPath, null),
    membershipRows: await readJsonl(membershipPath),
    summary: await readJson(summaryPath, null),
    sourceRunDir,
    familyIndexPath,
    membershipPath,
    summaryPath
  }
}

const selectProbeFamilies = ({ c0Index, c1Cfg }) => {
  const families = Array.isArray(c0Index?.families) ? c0Index.families : []
  if (Array.isArray(c1Cfg?.explicitFamilyIds) && c1Cfg.explicitFamilyIds.length > 0) {
    const familyMap = new Map(
      families.map((row) => [String(row?.familyId ?? "").trim(), row]),
    )
    const selected = c1Cfg.explicitFamilyIds
      .map((familyId) => familyMap.get(String(familyId ?? "").trim()))
      .filter(Boolean)
    const selectedIds = new Set(
      selected.map((row) => String(row?.familyId ?? "").trim()).filter(Boolean),
    )
    return {
      families: selected,
      missingFamilyIds: c1Cfg.explicitFamilyIds.filter((familyId) => !selectedIds.has(familyId))
    }
  }
  return {
    families: families
      .filter(
        (row) =>
          row?.shortlisted === true &&
          Math.max(0, Number(row?.support ?? 0) || 0) >= c1Cfg.minFamilySupport,
      )
      .slice()
      .sort((left, right) => {
        const byScore = Number(right?.c0Score ?? 0) - Number(left?.c0Score ?? 0)
        if (byScore !== 0) return byScore
        return Number(right?.support ?? 0) - Number(left?.support ?? 0)
      })
      .slice(0, c1Cfg.maxProbeFamilies),
    missingFamilyIds: []
  }
}

const buildFamilyProbeScratchCtx = ({ ctx, familyId, probeRank, c1Cfg }) => {
  const scratchRunDir = path.join(ctx.runDir, "step-c1", "probes", familyId)
  const scratchStepCDir = path.join(scratchRunDir, "step-c")
  const scratchStepDDir = path.join(scratchRunDir, "step-d")
  const sourceRunDir = resolveStepC1SourceRunDir(ctx)
  const sourceRunId = resolveStepC1SourceRunId(ctx, sourceRunDir)
  const stepDBaseCfg = ctx?.config?.lightweight?.stepD ?? {}
  const profiledStepD = buildStepDC1FamilyProbeProfile({
    stepDBaseCfg,
    scoringWorkers: stepDBaseCfg?.scoringWorkers,
    workerChunkSize: stepDBaseCfg?.workerChunkSize
  })
  return {
    ...ctx,
    runDir: scratchRunDir,
    abRunDir: sourceRunDir,
    abRunId: sourceRunId,
    config: {
      ...ctx.config,
      lightweight: {
        ...(ctx.config?.lightweight ?? {}),
        stepD: profiledStepD
      }
    },
    __runtime: {
      ...(ctx.__runtime ?? {}),
      allowedC0FamilyIds: [familyId],
      familyProbeMode: true,
      familyProbeMetadata: {
        familyId,
        probeRank,
        maxFamilyRepresentatives: c1Cfg.maxFamilyRepresentatives,
        sourceRunId,
        sourceRunDir
      },
      stepBSourceRunDirOverride: sourceRunDir,
      stepCFamilySourceRunDirOverride: sourceRunDir,
      stepCOutputDirOverride: scratchStepCDir,
      stepDOutputDirOverride: scratchStepDDir,
      stepCLibraryDirOverride: scratchStepCDir,
      stepDProfileOverride: c1Cfg.probeProfile,
      stepDExecutionProfileOverride: c1Cfg.probeProfile,
      probeScopeOverride: c1Cfg.probeScope,
      stepDPrepareLockboxDuringStepDOverride: c1Cfg?.lockboxEval?.enabled === true,
      reuseStepCRuntimeAcrossRunDirs: false,
      disableWritebacks: true
    }
  }
}

const cleanupFamilyProbeScratch = async ({ scratchDir, retainArtifacts }) => {
  if (retainArtifacts === true) return
  await fsp.rm(String(scratchDir ?? ""), { recursive: true, force: true }).catch(() => {})
}

const closeFamilyProbeRuntime = async (scratchCtx) => {
  const cachedWorkerPool = scratchCtx?.__runtime?.stepDWorkerPool?.pool
  if (cachedWorkerPool && typeof cachedWorkerPool.close === "function") {
    await cachedWorkerPool.close().catch(() => {})
    if (
      scratchCtx?.__runtime &&
      Object.prototype.hasOwnProperty.call(scratchCtx.__runtime, "stepDWorkerPool")
    ) {
      delete scratchCtx.__runtime.stepDWorkerPool
    }
  }
}

const applyStepCFunnelSnapshot = ({ result, stepCSummary }) => {
  const summary = stepCSummary && typeof stepCSummary === "object" ? stepCSummary : null
  if (!result || !summary) return
  result.stepCInputMode = String(summary?.inputMode ?? "").trim() || null
  result.stepCStatus = String(summary?.status ?? "").trim() || null
  result.stepCRawTemplateCount = Math.max(0, Number(summary?.rawTemplates ?? 0) || 0)
  result.stepCTemplatesBeforeC0Count = Math.max(0, Number(summary?.templatesBeforeC0 ?? 0) || 0)
  result.stepCTemplatesAfterC0FilterCount = Math.max(
    0,
    Number(summary?.templatesAfterC0Filter ?? summary?.c0AcceptedTemplateCount ?? 0) || 0,
  )
  result.stepCTemplatesAfterC1FilterCount = Math.max(
    0,
    Number(summary?.templatesAfterC1Filter ?? summary?.c1AcceptedTemplateCount ?? 0) || 0,
  )
  result.stepCTemplatesAfterC2FilterCount = Math.max(
    0,
    Number(summary?.templatesAfterC2Filter ?? summary?.c2AcceptedTemplateCount ?? 0) || 0,
  )
  result.stepCTemplatesAfterFamilyPoolFilterCount = Math.max(
    0,
    Number(summary?.templatesAfterFamilyPoolFilter ?? summary?.familyPoolAcceptedTemplateCount ?? 0) || 0,
  )
  result.stepCC0EffectiveSource = String(summary?.c0EffectiveSource ?? "").trim() || null
  result.stepCC1EffectiveSource = String(summary?.c1EffectiveSource ?? "").trim() || null
  result.stepCC1RepresentativeCapApplied = summary?.c1RepresentativeCapApplied === true
  result.stepCC1MaxFamilyRepresentatives =
    summary?.c1MaxFamilyRepresentatives == null
      ? null
      : Math.max(0, Number(summary?.c1MaxFamilyRepresentatives ?? 0) || 0)
  result.stepCC1TemplatesBeforeRepresentativeCapCount = Math.max(
    0,
    Number(summary?.c1TemplatesBeforeRepresentativeCap ?? summary?.templatesAfterC0Filter ?? 0) || 0,
  )
  result.stepCC1TemplatesAfterRepresentativeCapCount = Math.max(
    0,
    Number(summary?.c1TemplatesAfterRepresentativeCap ?? summary?.templatesAfterC1Filter ?? 0) || 0,
  )
  result.stepCC2EffectiveSource = String(summary?.c2EffectiveSource ?? "").trim() || null
  result.stepCFamilyPoolEffectiveSource =
    String(summary?.familyPoolEffectiveSource ?? "").trim() || null
  result.stepCFailureStage = String(summary?.failure?.stage ?? "").trim() || null
  result.stepCFailureReason = String(summary?.failure?.reason ?? "").trim() || null
}

const extractFamilyLockboxMetrics = ({ familyId, stepESummary, minPickFloor = 1 }) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  const familyRows = Array.isArray(stepESummary?.familyLockboxRollup)
    ? stepESummary.familyLockboxRollup
    : []
  const row =
    familyRows.find(
      (candidate) => String(candidate?.familyId ?? "").trim() === normalizedFamilyId,
    ) ?? null
  if (!row) {
    return {
      status: "NO_FAMILY_ROW",
      familyHitRateLockbox: 0,
      familyExecutedHitRateLockbox: 0,
      familyPickCountLockbox: 0,
      familyStopRateLockbox: 0,
      familyTimeoutNegativeRateLockbox: 0
    }
  }
  const familyPickCountLockbox = Math.max(0, Number(row?.familyPickCountLockbox ?? 0) || 0)
  const metrics = {
    familyHitRateLockbox: clamp01(row?.familyHitRateLockbox ?? 0),
    familyExecutedHitRateLockbox: clamp01(row?.familyExecutedHitRateLockbox ?? 0),
    familyPickCountLockbox,
    familyStopRateLockbox: clamp01(row?.familyStopRateLockbox ?? 0),
    familyTimeoutNegativeRateLockbox: clamp01(row?.familyTimeoutNegativeRateLockbox ?? 0)
  }
  if (familyPickCountLockbox < Math.max(0, Number(minPickFloor ?? 0) || 0)) {
    return {
      status: "BELOW_MIN_PICK_FLOOR",
      ...metrics
    }
  }
  return {
    status: "PASS",
    ...metrics
  }
}

const runSingleFamilyProbe = async ({
  ctx,
  family,
  probeRank,
  probeTemplateCount,
  c1Cfg
}) => {
  const familyId = String(family?.familyId ?? "").trim()
  const scratchCtx = buildFamilyProbeScratchCtx({
    ctx,
    familyId,
    probeRank,
    c1Cfg
  })
  await ensureDir(scratchCtx.runDir)
  const result = {
    familyId,
    familySignature: String(family?.signature ?? "").trim() || null,
    c0Score: Number(family?.c0Score ?? 0) || 0,
    c0Support: Math.max(0, Number(family?.support ?? 0) || 0),
    c0CorePrototypeShare: Number(family?.corePrototypeShare ?? 0) || 0,
    c0PenaltyPrototypeShare: Number(family?.penaltyPrototypeShare ?? 0) || 0,
    c0QuarantinePrototypeShare: Number(family?.quarantinePrototypeShare ?? 0) || 0,
    c0RetiredPrototypeShare: Number(family?.retiredPrototypeShare ?? 0) || 0,
    c0PrototypeLedgerMatchedCount: Number(family?.prototypeLedgerMatchedCount ?? 0) || 0,
    c0PrototypeLedgerCoverage: Number(family?.prototypeLedgerCoverage ?? 0) || 0,
    c0PrototypeQualityMedian: Number(family?.prototypeQualityMedian ?? 0) || 0,
    c0PrototypeQualityMean: Number(family?.prototypeQualityMean ?? 0) || 0,
    c0PrototypeLedgerConfidenceMean:
      Number(family?.prototypeLedgerConfidenceMean ?? 0) || 0,
    probeRank,
    probeTemplateCount,
    probePrototypeCount: 0,
    pickedDaysEval: 0,
    rankableDaysEval: 0,
    targetsPer20EvalDays: 0,
    executionCoverageEval: 0,
    targetHitRateEval: 0,
    selectionHitAt1Eval: 0,
    selectionHitAt1AgreementFallbackAwareEval: 0,
    selectionHitAt1ResolvedEval: 0,
    selectionHitAt1MetricSourceEval: "RAW_TOP1",
    executedTargetHitRateEval: 0,
    stopRateEval: 0,
    timeoutNegativeRateEval: 0,
    primaryGateReasonEval: null,
    topNPassExistsRateEval: 0,
    altPassWouldHitRateEval: 0,
    scoreRecoveryEligibleRateEval: 0,
    scoreRecoveryWouldHitRateEval: 0,
    scoreRecalibrationEligibleRateEval: 0,
    scoreRecalibrationWouldHitRateEval: 0,
    scorePathologyPrimaryComponentEval: null,
    scorePathologySecondaryComponentEval: null,
    scorePathologyPrimarySubcomponentEval: null,
    scorePathologySecondarySubcomponentEval: null,
    scorePathologyCompositeTypeEval: null,
    scoreBelowMinShortfallP50Eval: 0,
    scoreMarginShortfallP50Eval: 0,
    postAdjustPenaltyP50Eval: 0,
    tradeQualityPenaltyP50Eval: 0,
    executionPriorPenaltyP50Eval: 0,
    regimeExpertDeltaP50Eval: 0,
    antiPenaltyP50Eval: 0,
    stopRatePenaltyP50Eval: 0,
    coveragePenaltyP50Eval: 0,
    supportCountPenaltyP50Eval: 0,
    supportCountPenaltyReliefP50Eval: 0,
    singleEraConcentrationPenaltyRawP50Eval: 0,
    singleEraConcentrationPenaltyReliefP50Eval: 0,
    singleEraConcentrationPenaltyEvidenceRatioP50Eval: 0,
    singleEraConcentrationPenaltyP50Eval: 0,
    singleEraPenaltyP50Eval: 0,
    lowEraSupportPenaltyP50Eval: 0,
    eraSupportCountP50Eval: 0,
    minEraSupportCountP50Eval: 0,
    eraSupportShortfallP50Eval: 0,
    eraCoverageRatioP50Eval: 0,
    targetEraCoverageRatioP50Eval: 0,
    eraCoverageShortfallP50Eval: 0,
    singleEraShareP50Eval: 0,
    effectiveSingleEraShareP50Eval: 0,
    singleEraEvidenceCoverageRatioP50Eval: 0,
    singleEraEvidenceSupportRatioP50Eval: 0,
    clusterTemporalEffectiveEraCountP50Eval: 0,
    clusterTemporalNormalizedEraEntropyP50Eval: 0,
    singleEraEvidenceEffectiveEraCountRatioP50Eval: 0,
    singleEraEvidenceEntropyRatioP50Eval: 0,
    maxSingleEraShareCapP50Eval: 0,
    singleEraShareExcessP50Eval: 0,
    eraSupportPenaltyReasonRawEval: null,
    eraSupportPenaltyReasonEval: null,
    executionPriorLowFillPenaltyP50Eval: 0,
    executionPriorLowFillPenaltyReliefP50Eval: 0,
    executionPriorSlippagePenaltyP50Eval: 0,
    executionPriorSlippagePenaltyReliefP50Eval: 0,
    executionPriorLowLiquidityPenaltyP50Eval: 0,
    executionPriorLowLiquidityPenaltyReliefP50Eval: 0,
    failedBreakoutCount20P50Eval: 0,
    gapFillThenContinueScoreP50Eval: 0,
    gapFillThenRevertScoreP50Eval: 0,
    executionFeasibilityScoreP50Eval: 0,
    tradeQualityFeatureAdjustmentP50Eval: 0,
    bestAltPassingRankP50Eval: 0,
    recommendedStrategy: "KEEP_BLOCK",
    recommendedScoreAction: "KEEP_BLOCK",
    agreementBlockedDaysEval: 0,
    agreementBlockedTop1WouldHaveHitDaysEval: 0,
    agreementBlockedTop1WouldHaveHitRateEval: 0,
    agreementModelUnavailableDaysEval: 0,
    agreementConsensusLowDaysEval: 0,
    agreementStabilityLowDaysEval: 0,
    agreementScoreLowDaysEval: 0,
    agreementPrimaryReasonEval: null,
    agreementPrimaryPatternEval: null,
    agreementBlockedHitPatternCountsEval: {},
    agreementBlockedMissPatternCountsEval: {},
    agreementBlockedRawSimilarityP50Eval: 0,
    agreementBlockedGateScoreMarginP50Eval: 0,
    agreementFallbackDaysEval: 0,
    agreementBlockedHitRawSimilarityP50Eval: 0,
    agreementBlockedHitGateScoreMarginP50Eval: 0,
    agreementBlockedMissRawSimilarityP50Eval: 0,
    agreementBlockedMissGateScoreMarginP50Eval: 0,
    configuredPromotionScope: null,
    effectivePromotionScope: null,
    probeScopeApplied: null,
    writebacksDisabled: false,
    c1FrozenProbe: false,
    feedbackUpdatesSkipped: false,
    executionFeedbackSkipped: false,
    probeErrorType: null,
    probeErrorMessage: null,
    scratchDir: scratchCtx.runDir,
    stepCSummaryPath: path.join(scratchCtx.runDir, "step-c", "step_c_summary.json"),
    stepDSummaryPath: path.join(scratchCtx.runDir, "step-d", "step_d_summary.json"),
    stepESummaryPath: path.join(scratchCtx.runDir, "step-e", "step_e_summary.json"),
    stepELockboxStatus: c1Cfg?.lockboxEval?.enabled === true ? "PENDING" : "DISABLED",
    familyHitRateLockbox: 0,
    familyExecutedHitRateLockbox: 0,
    familyPickCountLockbox: 0,
    familyStopRateLockbox: 0,
    familyTimeoutNegativeRateLockbox: 0,
    familyProbeDEParityStatus: c1Cfg?.lockboxEval?.enabled === true ? "PENDING" : "DISABLED",
    familyProbeDEParityReason: c1Cfg?.lockboxEval?.enabled === true ? "LOCKBOX_PENDING" : "LOCKBOX_DISABLED",
    stepCInputMode: null,
    stepCStatus: null,
    stepCRawTemplateCount: 0,
    stepCTemplatesBeforeC0Count: 0,
    stepCTemplatesAfterC0FilterCount: 0,
    stepCTemplatesAfterC1FilterCount: 0,
    stepCTemplatesAfterC2FilterCount: 0,
    stepCTemplatesAfterFamilyPoolFilterCount: 0,
    stepCC0EffectiveSource: null,
    stepCC1EffectiveSource: null,
    stepCC1RepresentativeCapApplied: false,
    stepCC1MaxFamilyRepresentatives: null,
    stepCC1TemplatesBeforeRepresentativeCapCount: 0,
    stepCC1TemplatesAfterRepresentativeCapCount: 0,
    stepCC2EffectiveSource: null,
    stepCFamilyPoolEffectiveSource: null,
    stepCFailureStage: null,
    stepCFailureReason: null
  }
  try {
    const stepC = await runStepC(scratchCtx)
    const stepD = await runStepD(scratchCtx)
    const stepCSummary = stepC?.summary ?? {}
    const stepDSummary = stepD?.summary ?? {}
    applyStepCFunnelSnapshot({ result, stepCSummary })
    result.probePrototypeCount = Math.max(0, Number(stepCSummary?.prototypes ?? 0) || 0)
    result.pickedDaysEval = Math.max(0, Number(stepDSummary?.pickedDaysEval ?? 0) || 0)
    result.rankableDaysEval = Math.max(0, Number(stepDSummary?.rankableDaysEval ?? 0) || 0)
    result.targetsPer20EvalDays = Math.max(0, Number(stepDSummary?.targetsPer20EvalDays ?? 0) || 0)
    result.executionCoverageEval = clamp01(stepDSummary?.executionCoverageEval ?? 0)
    result.targetHitRateEval = clamp01(stepDSummary?.targetHitRateEval ?? stepDSummary?.pickHitRateEval ?? 0)
    result.selectionHitAt1Eval = clamp01(stepDSummary?.selectionHitAt1Eval ?? 0)
    result.selectionHitAt1AgreementFallbackAwareEval = clamp01(
      stepDSummary?.selectionHitAt1AgreementFallbackAwareEval ??
        stepDSummary?.agreementFallbackSelection?.selectionHitAt1AgreementFallbackAwareEval ??
        stepDSummary?.selectionHitAt1Eval ??
        0,
    )
    result.executedTargetHitRateEval = clamp01(stepDSummary?.executedTargetHitRateEval ?? 0)
    result.stopRateEval = clamp01(stepDSummary?.stopRateEval ?? 0)
    result.timeoutNegativeRateEval = clamp01(stepDSummary?.timeoutNegativeRateEval ?? 0)
    result.agreementFallbackDaysEval = Math.max(
      0,
      Number(
        stepDSummary?.agreementFallbackDaysEval ??
          stepDSummary?.agreementFallbackSelection?.daysEval ??
          0,
      ) || 0,
    )
    const d1GateDiagnosticsEval = stepDSummary?.d1GateDiagnostics?.diagnosticsEval ?? {}
    const scoreRecoveryDiagnosticsEval = stepDSummary?.scoreRecovery?.diagnosticsEval ?? {}
    const scoreRecalibrationDiagnosticsEval = stepDSummary?.scoreRecalibration?.diagnosticsEval ?? {}
    const gateReasonCountsEval = stepDSummary?.gateReasonCountsEval ?? {}
    const agreementDiagnosticsEval = stepDSummary?.agreementGate?.diagnosticsEval ?? {}
    const agreementReasonCountsEval = stepDSummary?.agreementGate?.reasonCountsEval ?? {}
    const scoreBelowMinEval = d1GateDiagnosticsEval?.scoreBelowMin ?? {}
    const scoreMarginLowEval = d1GateDiagnosticsEval?.scoreMarginLow ?? {}
    const blockedHitEval = agreementDiagnosticsEval?.blockedHit ?? {}
    const blockedMissEval = agreementDiagnosticsEval?.blockedMiss ?? {}
    const mergedPatternCountsEval = {
      ...(
        blockedHitEval?.patternCounts && typeof blockedHitEval.patternCounts === "object"
          ? blockedHitEval.patternCounts
          : {}
      )
    }
    for (const [key, value] of Object.entries(
      blockedMissEval?.patternCounts && typeof blockedMissEval.patternCounts === "object"
        ? blockedMissEval.patternCounts
        : {},
    )) {
      mergedPatternCountsEval[String(key ?? "").trim()] =
        Number(mergedPatternCountsEval[String(key ?? "").trim()] ?? 0) + (Number(value ?? 0) || 0)
    }
    result.primaryGateReasonEval = pickTopCountKey(gateReasonCountsEval)
    result.topNPassExistsRateEval = clamp01(
      d1GateDiagnosticsEval?.topNPassExistsRateAmongFailedDays ?? 0,
    )
    result.altPassWouldHitRateEval = clamp01(
      d1GateDiagnosticsEval?.altPassWouldHitRate ?? 0,
    )
    result.scoreRecoveryEligibleRateEval = clamp01(
      scoreRecoveryDiagnosticsEval?.eligibleRate ?? 0,
    )
    result.scoreRecoveryWouldHitRateEval = clamp01(
      scoreRecoveryDiagnosticsEval?.wouldHitRate ?? 0,
    )
    result.scoreRecalibrationEligibleRateEval = clamp01(
      scoreRecalibrationDiagnosticsEval?.eligibleRate ?? 0,
    )
    result.scoreRecalibrationWouldHitRateEval = clamp01(
      scoreRecalibrationDiagnosticsEval?.wouldHitRate ?? 0,
    )
    result.scoreBelowMinShortfallP50Eval = Number(
      scoreBelowMinEval?.minFinalScoreShortfall?.p50 ?? 0,
    ) || 0
    result.scoreMarginShortfallP50Eval = Number(
      scoreMarginLowEval?.minScoreMarginShortfall?.p50 ?? 0,
    ) || 0
    const pathologySource =
      result.primaryGateReasonEval === "SCORE_MARGIN_LOW"
        ? scoreMarginLowEval
        : result.primaryGateReasonEval === "POLICY_TAU_RANK_LOW"
          ? (scoreBelowMinEval?.scorePathologyPrimaryComponent ? scoreBelowMinEval : scoreMarginLowEval)
          : scoreBelowMinEval
    result.scorePathologyPrimaryComponentEval =
      String(
        pathologySource?.scorePathologyPrimaryComponent ??
          scoreRecalibrationDiagnosticsEval?.primaryComponent ??
          "",
      ).trim() || null
    result.scorePathologySecondaryComponentEval =
      String(pathologySource?.scorePathologySecondaryComponent ?? "").trim() || null
    result.scorePathologyPrimarySubcomponentEval =
      String(pathologySource?.scorePathologyPrimarySubcomponent ?? "").trim() || null
    result.scorePathologySecondarySubcomponentEval =
      String(pathologySource?.scorePathologySecondarySubcomponent ?? "").trim() || null
    result.scorePathologyCompositeTypeEval =
      String(pathologySource?.scorePathologyCompositeType ?? "").trim() || null
    result.postAdjustPenaltyP50Eval = Number(
      scoreBelowMinEval?.postAdjustPenaltyAbs?.p50 ??
        scoreMarginLowEval?.postAdjustPenaltyAbs?.p50 ??
        0,
    ) || 0
    result.tradeQualityPenaltyP50Eval = Number(
      scoreBelowMinEval?.tradeQualityPenaltyAbs?.p50 ??
        scoreMarginLowEval?.tradeQualityPenaltyAbs?.p50 ??
        0,
    ) || 0
    result.executionPriorPenaltyP50Eval = Number(
      scoreBelowMinEval?.executionPriorPenaltyAbs?.p50 ??
        scoreMarginLowEval?.executionPriorPenaltyAbs?.p50 ??
        0,
    ) || 0
    result.regimeExpertDeltaP50Eval = Number(
      scoreBelowMinEval?.regimeExpertDelta?.p50 ??
        scoreMarginLowEval?.regimeExpertDelta?.p50 ??
        0,
    ) || 0
    result.antiPenaltyP50Eval = Number(
      scoreBelowMinEval?.antiPenalty?.p50 ??
        scoreMarginLowEval?.antiPenalty?.p50 ??
        0,
    ) || 0
    result.stopRatePenaltyP50Eval = Number(
      scoreBelowMinEval?.stopRatePenalty?.p50 ??
        scoreMarginLowEval?.stopRatePenalty?.p50 ??
        0,
    ) || 0
    result.coveragePenaltyP50Eval = Number(
      scoreBelowMinEval?.coveragePenalty?.p50 ??
        scoreMarginLowEval?.coveragePenalty?.p50 ??
        0,
    ) || 0
    result.supportCountPenaltyP50Eval = Number(
      scoreBelowMinEval?.supportCountPenalty?.p50 ??
        scoreMarginLowEval?.supportCountPenalty?.p50 ??
        0,
    ) || 0
    result.supportCountPenaltyReliefP50Eval = Number(
      scoreBelowMinEval?.supportCountPenaltyRelief?.p50 ??
        scoreMarginLowEval?.supportCountPenaltyRelief?.p50 ??
        0,
    ) || 0
    result.singleEraConcentrationPenaltyRawP50Eval = Number(
      scoreBelowMinEval?.singleEraConcentrationPenaltyRaw?.p50 ??
        scoreMarginLowEval?.singleEraConcentrationPenaltyRaw?.p50 ??
        0,
    ) || 0
    result.singleEraConcentrationPenaltyReliefP50Eval = Number(
      scoreBelowMinEval?.singleEraConcentrationPenaltyRelief?.p50 ??
        scoreMarginLowEval?.singleEraConcentrationPenaltyRelief?.p50 ??
        0,
    ) || 0
    result.singleEraConcentrationPenaltyEvidenceRatioP50Eval = Number(
      scoreBelowMinEval?.singleEraConcentrationPenaltyEvidenceRatio?.p50 ??
        scoreMarginLowEval?.singleEraConcentrationPenaltyEvidenceRatio?.p50 ??
        0,
    ) || 0
    result.singleEraConcentrationPenaltyP50Eval = Number(
      scoreBelowMinEval?.singleEraConcentrationPenalty?.p50 ??
        scoreMarginLowEval?.singleEraConcentrationPenalty?.p50 ??
        0,
    ) || 0
    result.singleEraPenaltyP50Eval = Number(
      scoreBelowMinEval?.singleEraPenalty?.p50 ??
        scoreMarginLowEval?.singleEraPenalty?.p50 ??
        0,
    ) || 0
    result.lowEraSupportPenaltyP50Eval = Number(
      scoreBelowMinEval?.lowEraSupportPenalty?.p50 ??
        scoreMarginLowEval?.lowEraSupportPenalty?.p50 ??
        0,
    ) || 0
    result.eraSupportCountP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalEraSupportCount?.p50 ??
        scoreMarginLowEval?.clusterTemporalEraSupportCount?.p50 ??
        0,
    ) || 0
    result.minEraSupportCountP50Eval = Number(
      scoreBelowMinEval?.minEraSupportCount?.p50 ??
        scoreMarginLowEval?.minEraSupportCount?.p50 ??
        0,
    ) || 0
    result.eraSupportShortfallP50Eval = Number(
      scoreBelowMinEval?.eraSupportShortfall?.p50 ??
        scoreMarginLowEval?.eraSupportShortfall?.p50 ??
        0,
    ) || 0
    result.eraCoverageRatioP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalEraCoverageRatio?.p50 ??
        scoreMarginLowEval?.clusterTemporalEraCoverageRatio?.p50 ??
        0,
    ) || 0
    result.targetEraCoverageRatioP50Eval = Number(
      scoreBelowMinEval?.targetEraCoverageRatio?.p50 ??
        scoreMarginLowEval?.targetEraCoverageRatio?.p50 ??
        0,
    ) || 0
    result.eraCoverageShortfallP50Eval = Number(
      scoreBelowMinEval?.eraCoverageShortfall?.p50 ??
        scoreMarginLowEval?.eraCoverageShortfall?.p50 ??
        0,
    ) || 0
    result.singleEraShareP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalMaxSingleEraShare?.p50 ??
        scoreMarginLowEval?.clusterTemporalMaxSingleEraShare?.p50 ??
        0,
    ) || 0
    result.effectiveSingleEraShareP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalEffectiveSingleEraShare?.p50 ??
        scoreMarginLowEval?.clusterTemporalEffectiveSingleEraShare?.p50 ??
        0,
    ) || 0
    result.singleEraEvidenceCoverageRatioP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalSingleEraEvidenceCoverageRatio?.p50 ??
        scoreMarginLowEval?.clusterTemporalSingleEraEvidenceCoverageRatio?.p50 ??
        0,
    ) || 0
    result.singleEraEvidenceSupportRatioP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalSingleEraEvidenceSupportRatio?.p50 ??
        scoreMarginLowEval?.clusterTemporalSingleEraEvidenceSupportRatio?.p50 ??
        0,
    ) || 0
    result.clusterTemporalEffectiveEraCountP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalEffectiveEraCount?.p50 ??
        scoreMarginLowEval?.clusterTemporalEffectiveEraCount?.p50 ??
        0,
    ) || 0
    result.clusterTemporalNormalizedEraEntropyP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalNormalizedEraEntropy?.p50 ??
        scoreMarginLowEval?.clusterTemporalNormalizedEraEntropy?.p50 ??
        0,
    ) || 0
    result.singleEraEvidenceEffectiveEraCountRatioP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio?.p50 ??
        scoreMarginLowEval?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio?.p50 ??
        0,
    ) || 0
    result.singleEraEvidenceEntropyRatioP50Eval = Number(
      scoreBelowMinEval?.clusterTemporalSingleEraEvidenceEntropyRatio?.p50 ??
        scoreMarginLowEval?.clusterTemporalSingleEraEvidenceEntropyRatio?.p50 ??
        0,
    ) || 0
    result.maxSingleEraShareCapP50Eval = Number(
      scoreBelowMinEval?.maxSingleEraShareCap?.p50 ??
        scoreMarginLowEval?.maxSingleEraShareCap?.p50 ??
        0,
    ) || 0
    result.singleEraShareExcessP50Eval = Number(
      scoreBelowMinEval?.singleEraShareExcess?.p50 ??
        scoreMarginLowEval?.singleEraShareExcess?.p50 ??
        0,
    ) || 0
    {
      const eraSupportPenaltyReasonRaw =
        String(
          scoreBelowMinEval?.eraSupportPenaltyReasonRaw ??
            scoreMarginLowEval?.eraSupportPenaltyReasonRaw ??
            "",
        ).trim() || null
      const eraSupportPenaltyReason =
        String(
          scoreBelowMinEval?.eraSupportPenaltyReason ??
            scoreMarginLowEval?.eraSupportPenaltyReason ??
            "",
        ).trim() || null
      result.eraSupportPenaltyReasonRawEval =
        eraSupportPenaltyReasonRaw && eraSupportPenaltyReasonRaw !== "NONE"
          ? eraSupportPenaltyReasonRaw
          : null
      result.eraSupportPenaltyReasonEval =
        eraSupportPenaltyReason && eraSupportPenaltyReason !== "NONE"
          ? eraSupportPenaltyReason
          : null
    }
    result.executionPriorLowFillPenaltyP50Eval = Number(
      scoreBelowMinEval?.executionPriorLowFillPenalty?.p50 ??
        scoreMarginLowEval?.executionPriorLowFillPenalty?.p50 ??
        0,
    ) || 0
    result.executionPriorLowFillPenaltyReliefP50Eval = Number(
      scoreBelowMinEval?.executionPriorLowFillPenaltyRelief?.p50 ??
        scoreMarginLowEval?.executionPriorLowFillPenaltyRelief?.p50 ??
        0,
    ) || 0
    result.executionPriorSlippagePenaltyP50Eval = Number(
      scoreBelowMinEval?.executionPriorSlippagePenalty?.p50 ??
        scoreMarginLowEval?.executionPriorSlippagePenalty?.p50 ??
        0,
    ) || 0
    result.executionPriorSlippagePenaltyReliefP50Eval = Number(
      scoreBelowMinEval?.executionPriorSlippagePenaltyRelief?.p50 ??
        scoreMarginLowEval?.executionPriorSlippagePenaltyRelief?.p50 ??
        0,
    ) || 0
    result.executionPriorLowLiquidityPenaltyP50Eval = Number(
      scoreBelowMinEval?.executionPriorLowLiquidityPenalty?.p50 ??
        scoreMarginLowEval?.executionPriorLowLiquidityPenalty?.p50 ??
        0,
    ) || 0
    result.executionPriorLowLiquidityPenaltyReliefP50Eval = Number(
      scoreBelowMinEval?.executionPriorLowLiquidityPenaltyRelief?.p50 ??
        scoreMarginLowEval?.executionPriorLowLiquidityPenaltyRelief?.p50 ??
        0,
    ) || 0
    result.failedBreakoutCount20P50Eval = Number(
      scoreBelowMinEval?.failedBreakoutCount20?.p50 ??
        scoreMarginLowEval?.failedBreakoutCount20?.p50 ??
        0,
    ) || 0
    result.gapFillThenContinueScoreP50Eval = Number(
      scoreBelowMinEval?.gapFillThenContinueScore?.p50 ??
        scoreMarginLowEval?.gapFillThenContinueScore?.p50 ??
        0,
    ) || 0
    result.gapFillThenRevertScoreP50Eval = Number(
      scoreBelowMinEval?.gapFillThenRevertScore?.p50 ??
        scoreMarginLowEval?.gapFillThenRevertScore?.p50 ??
        0,
    ) || 0
    result.executionFeasibilityScoreP50Eval = Number(
      scoreBelowMinEval?.executionFeasibilityScore?.p50 ??
        scoreMarginLowEval?.executionFeasibilityScore?.p50 ??
        0,
    ) || 0
    result.tradeQualityFeatureAdjustmentP50Eval = Number(
      scoreBelowMinEval?.tradeQualityFeatureAdjustment?.p50 ??
        scoreMarginLowEval?.tradeQualityFeatureAdjustment?.p50 ??
        0,
    ) || 0
    result.bestAltPassingRankP50Eval = Number(
      d1GateDiagnosticsEval?.bestAltPassingRank?.p50 ?? 0,
    ) || 0
    result.agreementBlockedDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.blockedDays ?? 0) || 0,
    )
    result.agreementBlockedTop1WouldHaveHitDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.blockedTop1WouldHaveHitDays ?? 0) || 0,
    )
    result.agreementBlockedTop1WouldHaveHitRateEval = clamp01(
      agreementDiagnosticsEval?.blockedTop1WouldHaveHitRate ?? 0,
    )
    result.agreementModelUnavailableDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.modelUnavailableDays ?? 0) || 0,
    )
    result.agreementConsensusLowDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.consensusLowDays ?? 0) || 0,
    )
    result.agreementStabilityLowDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.stabilityLowDays ?? 0) || 0,
    )
    result.agreementScoreLowDaysEval = Math.max(
      0,
      Number(agreementDiagnosticsEval?.scoreLowDays ?? 0) || 0,
    )
    result.agreementPrimaryReasonEval = pickTopCountKey(agreementReasonCountsEval)
    result.agreementPrimaryPatternEval = pickTopCountKey(mergedPatternCountsEval)
    result.agreementBlockedHitPatternCountsEval =
      blockedHitEval?.patternCounts && typeof blockedHitEval.patternCounts === "object"
        ? blockedHitEval.patternCounts
        : {}
    result.agreementBlockedMissPatternCountsEval =
      blockedMissEval?.patternCounts && typeof blockedMissEval.patternCounts === "object"
        ? blockedMissEval.patternCounts
        : {}
    result.agreementBlockedRawSimilarityP50Eval = Number(
      agreementDiagnosticsEval?.blockedTop1Metrics?.rawSimilarityScore?.p50 ?? 0,
    ) || 0
    result.agreementBlockedGateScoreMarginP50Eval = Number(
      agreementDiagnosticsEval?.blockedTop1Metrics?.gateScoreMargin?.p50 ?? 0,
    ) || 0
    result.agreementBlockedHitRawSimilarityP50Eval = Number(
      blockedHitEval?.rawSimilarityScore?.p50 ?? 0,
    ) || 0
    result.agreementBlockedHitGateScoreMarginP50Eval = Number(
      blockedHitEval?.gateScoreMargin?.p50 ?? 0,
    ) || 0
    result.agreementBlockedMissRawSimilarityP50Eval = Number(
      blockedMissEval?.rawSimilarityScore?.p50 ?? 0,
    ) || 0
    result.agreementBlockedMissGateScoreMarginP50Eval = Number(
      blockedMissEval?.gateScoreMargin?.p50 ?? 0,
    ) || 0
    {
      const selectionMetric = resolveSelectionHitAt1Metric({
        result,
        cfg: c1Cfg
      })
      result.selectionHitAt1ResolvedEval = clamp01(
        selectionMetric?.value ?? result.selectionHitAt1Eval ?? 0,
      )
      result.selectionHitAt1MetricSourceEval =
        String(selectionMetric?.source ?? "RAW_TOP1").trim().toUpperCase() || "RAW_TOP1"
    }
    result.recommendedScoreAction = resolveRecommendedScoreAction(result)
    result.recommendedStrategy = resolveRecommendedStrategy(result)
    result.configuredPromotionScope =
      String(stepDSummary?.configuredPromotionScope ?? "").trim() || null
    result.effectivePromotionScope =
      String(stepDSummary?.effectivePromotionScope ?? "").trim() || null
    result.probeScopeApplied = String(stepDSummary?.probeScopeApplied ?? "").trim() || null
    result.writebacksDisabled = stepDSummary?.writebacksDisabled === true
    result.c1FrozenProbe = stepDSummary?.c1FrozenProbe === true
    result.feedbackUpdatesSkipped = stepDSummary?.feedbackUpdatesSkipped === true
    result.executionFeedbackSkipped = stepDSummary?.executionFeedbackSkipped === true
    result.stepCSummaryPath =
      stepC?.summaryPath ?? path.join(scratchCtx.runDir, "step-c", "step_c_summary.json")
    result.stepDSummaryPath =
      stepD?.summaryPath ?? path.join(scratchCtx.runDir, "step-d", "step_d_summary.json")
    if (c1Cfg?.lockboxEval?.enabled === true) {
      try {
        const stepE = await runStepE(scratchCtx)
        const stepESummary = stepE?.summary ?? {}
        const lockboxMetrics = extractFamilyLockboxMetrics({
          familyId,
          stepESummary,
          minPickFloor: c1Cfg?.lockboxEval?.minPickFloor,
        })
        result.stepESummaryPath =
          stepE?.summaryPath ?? path.join(scratchCtx.runDir, "step-e", "step_e_summary.json")
        result.stepELockboxStatus = String(lockboxMetrics?.status ?? "NO_FAMILY_ROW")
          .trim()
          .toUpperCase() || "NO_FAMILY_ROW"
        result.familyHitRateLockbox = clamp01(lockboxMetrics?.familyHitRateLockbox ?? 0)
        result.familyExecutedHitRateLockbox = clamp01(
          lockboxMetrics?.familyExecutedHitRateLockbox ?? 0,
        )
        result.familyPickCountLockbox = Math.max(
          0,
          Number(lockboxMetrics?.familyPickCountLockbox ?? 0) || 0,
        )
        result.familyStopRateLockbox = clamp01(lockboxMetrics?.familyStopRateLockbox ?? 0)
        result.familyTimeoutNegativeRateLockbox = clamp01(
          lockboxMetrics?.familyTimeoutNegativeRateLockbox ?? 0,
        )
        const dHasPicks = Number(result?.pickedDaysEval ?? 0) > 0
        const eHasPicks = Number(result?.familyPickCountLockbox ?? 0) > 0
        result.familyProbeDEParityStatus = dHasPicks
          ? eHasPicks
            ? "BOTH_NONZERO"
            : "D_ONLY_NONZERO"
          : eHasPicks
            ? "E_ONLY_NONZERO"
            : "BOTH_ZERO"
        result.familyProbeDEParityReason =
          result.stepELockboxStatus === "PASS"
            ? "LOCKBOX_PASS"
            : result.stepELockboxStatus === "BELOW_MIN_PICK_FLOOR"
              ? "LOCKBOX_PICK_FLOOR_NOT_MET"
              : result.stepELockboxStatus === "NO_FAMILY_ROW"
                ? "LOCKBOX_ROLLUP_MISSING_FAMILY"
                : "LOCKBOX_PASS"
      } catch (error) {
        result.stepELockboxStatus = "ERROR"
        result.familyProbeDEParityStatus = "ERROR"
        result.familyProbeDEParityReason = String(error?.message ?? error ?? "").trim() || "LOCKBOX_ERROR"
      }
    }
  } catch (error) {
    const message = String(error?.message ?? error ?? "").trim()
    result.probeErrorMessage = message || "UNKNOWN_C1_PROBE_ERROR"
    const stepCSummary = await readJson(result.stepCSummaryPath, null).catch(() => null)
    applyStepCFunnelSnapshot({ result, stepCSummary })
    if (c1Cfg?.lockboxEval?.enabled === true) {
      result.stepELockboxStatus = "ERROR"
      result.familyProbeDEParityStatus = "ERROR"
      result.familyProbeDEParityReason = result.probeErrorMessage
    }
    if (message.includes("Step C template input is empty after normalization")) {
      result.probeErrorType = "NO_TEMPLATES_AFTER_NORMALIZATION"
    } else {
      result.probeErrorType = "PROBE_EXECUTION_ERROR"
    }
  } finally {
    await closeFamilyProbeRuntime(scratchCtx)
  }
  result.familyQualityScore = scoreFamilyProbeResult({ result, cfg: c1Cfg })
  result.rejectReason = buildRejectReason({ result, cfg: c1Cfg })
  result.passed = result.rejectReason === "PASS"
  return result
}

const buildC1PassList = ({ results, cfg }) => {
  const sorted = (Array.isArray(results) ? results : []).slice().sort((left, right) => {
    const byPass = Number(right?.passed === true) - Number(left?.passed === true)
    if (byPass !== 0) return byPass
    return Number(right?.familyQualityScore ?? 0) - Number(left?.familyQualityScore ?? 0)
  })
  const passed = sorted.filter((row) => row?.passed === true)
  let backfill = []
  let fallbackUsed = false
  if (passed.length < cfg.familyBackfillFloor) {
    fallbackUsed = true
    backfill = sorted
      .filter((row) => row?.passed !== true)
      .slice(0, cfg.familyBackfillMax)
  }
  const gateFailed = sorted.length < 1 || (passed.length < 1 && backfill.length < 1)
  const reason =
    sorted.length < 1
      ? "NO_PROBE_FAMILIES"
      : passed.length < 1 && backfill.length < 1
        ? "NO_PASSED_FAMILIES"
        : fallbackUsed
          ? "BACKFILL_USED"
          : "PASS"
  return {
    passed,
    backfill,
    fallbackUsed,
    gate: {
      enabled: true,
      failed: gateFailed,
      reason,
      fallbackUsed
    }
  }
}

export const runStepC1 = async (ctx) => {
  const c1Cfg = resolveC1Config(ctx.config, ctx.__runtime)
  const sourceRunDir = resolveStepC1SourceRunDir(ctx)
  const sourceRunId = resolveStepC1SourceRunId(ctx, sourceRunDir)
  const outDir = path.join(ctx.runDir, "step-c1")
  await ensureDir(outDir)
  const indexPath = path.join(outDir, "c1_family_probe_index.json")
  const resultsPath = path.join(outDir, "c1_family_probe_results.jsonl")
  const footprintsPath = path.join(outDir, "c1_family_overlap_footprints.jsonl")
  const summaryPath = path.join(outDir, "c1_summary.json")

  if (c1Cfg.enabled !== true) {
    const disabledSummary = {
      step: "C1",
      enabled: false,
      probeScope: null,
      probeProfile: null,
      explicitFamilyIds: [],
      sourceRunId,
      sourceRunDir,
      probeScopeApplied: null,
      writebacksDisabled: false,
      frozenProbe: false,
      feedbackUpdatesSkipped: false,
      executionFeedbackSkipped: false,
      probeELockboxEnabled: c1Cfg?.lockboxEval?.enabled === true,
      bundleEvalEnabled: c1Cfg?.bundleEval?.enabled === true,
      probeECompletedFamilyCount: 0,
      probeENonzeroPickFamilyCount: 0,
      probeEPositiveHitFamilyCount: 0,
      probedFamilies: 0,
      passedFamilies: 0,
      rejectedLowCoverageFamilies: 0,
      rejectedLowPrecisionFamilies: 0,
      rejectedLowExecutionFamilies: 0,
      rejectedHighStopFamilies: 0,
      rejectedHighTimeoutNegativeFamilies: 0,
      fallbackUsed: false,
      gate: {
        enabled: false,
        failed: false,
        reason: "DISABLED",
        fallbackUsed: false
      }
    }
    await writeJson(indexPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      probeScope: null,
      probeProfile: null,
      explicitFamilyIds: [],
      sourceRunId,
      sourceRunDir,
      probeScopeApplied: null,
      writebacksDisabled: false,
      frozenProbe: false,
      probeELockboxEnabled: disabledSummary.probeELockboxEnabled,
      bundleEvalEnabled: disabledSummary.bundleEvalEnabled,
      probeECompletedFamilyCount: 0,
      probeENonzeroPickFamilyCount: 0,
      probeEPositiveHitFamilyCount: 0,
      probedFamilyCount: 0,
      passedFamilyCount: 0,
      fallbackUsed: false,
      passedFamilyIds: [],
      backfillFamilyIds: [],
      rejectedFamilyIds: [],
      overlapFootprintsPath: footprintsPath,
      resultsPath,
      gate: disabledSummary.gate
    })
    await writeJsonl(resultsPath, [])
    await writeJsonl(footprintsPath, [])
    await writeJson(summaryPath, disabledSummary)
    return {
      step: "C1",
      indexPath,
      resultsPath,
      footprintsPath,
      summaryPath,
      summary: disabledSummary
    }
  }

  const inputs = await loadStepC1Inputs(ctx)
  if (!inputs.familyIndex || !pathExists(inputs.familyIndexPath) || !pathExists(inputs.membershipPath)) {
    throw new Error(`Step C1 source C0 artifacts missing: ${inputs.sourceRunDir}`)
  }
  const selectedFamilies = selectProbeFamilies({
    c0Index: inputs.familyIndex,
    c1Cfg
  })
  const families = Array.isArray(selectedFamilies?.families) ? selectedFamilies.families : []
  if (Array.isArray(selectedFamilies?.missingFamilyIds) && selectedFamilies.missingFamilyIds.length > 0) {
    throw new Error(
      [
        "Step C1 explicit family ids missing from source C0 index:",
        selectedFamilies.missingFamilyIds.join(","),
        `source=${inputs.familyIndexPath}`
      ].join(" "),
    )
  }
  const membershipRows = Array.isArray(inputs.membershipRows) ? inputs.membershipRows : []
  const templateCountByFamily = new Map()
  for (const row of membershipRows) {
    const familyId = String(row?.familyId ?? "").trim()
    if (!familyId) continue
    templateCountByFamily.set(familyId, Number(templateCountByFamily.get(familyId) ?? 0) + 1)
  }
  const results = []
  const footprints = []
  for (let idx = 0; idx < families.length; idx += 1) {
    const family = families[idx]
    const familyId = String(family?.familyId ?? "").trim()
    const probeTemplateCount = Math.min(
      c1Cfg.maxFamilyRepresentatives,
      Math.max(0, Number(templateCountByFamily.get(familyId) ?? 0) || 0),
    )
    const result = await runSingleFamilyProbe({
      ctx,
      family,
      probeRank: idx + 1,
      probeTemplateCount,
      c1Cfg
    })
    results.push(result)
    footprints.push(
      await buildFamilyOverlapFootprint({
        familyId,
        scratchDir: result.scratchDir,
        result
      }),
    )
  }

  const passList = buildC1PassList({
    results,
    cfg: c1Cfg
  })
  const rejectedCounts = {
    rejectedLowCoverageFamilies: results.filter((row) =>
      ["LOW_PICKED_DAYS_EVAL", "LOW_TARGETS_PER_20_EVAL_DAYS", "LOW_EXECUTION_COVERAGE_EVAL"].includes(
        String(row?.rejectReason ?? ""),
      ),
    ).length,
    rejectedLowPrecisionFamilies: results.filter((row) =>
      ["LOW_TARGET_HIT_RATE_EVAL", "LOW_SELECTION_HIT_AT_1_EVAL"].includes(
        String(row?.rejectReason ?? ""),
      ),
    ).length,
    rejectedLowExecutionFamilies: results.filter(
      (row) => String(row?.rejectReason ?? "") === "LOW_EXECUTED_TARGET_HIT_RATE_EVAL",
    ).length,
    rejectedHighStopFamilies: results.filter(
      (row) => String(row?.rejectReason ?? "") === "HIGH_STOP_RATE_EVAL",
    ).length,
    rejectedHighTimeoutNegativeFamilies: results.filter(
      (row) => String(row?.rejectReason ?? "") === "HIGH_TIMEOUT_NEGATIVE_RATE_EVAL",
    ).length
  }
  const agreementPrimaryReasonCounts = {}
  const agreementPrimaryPatternCounts = {}
  const primaryGateReasonCounts = {}
  const recommendedStrategyCounts = {}
  const scorePathologyPrimaryComponentCounts = {}
  const scorePathologyPrimarySubcomponentCounts = {}
  const scorePathologyCompositeTypeCounts = {}
  const eraSupportPenaltyReasonCounts = {}
  const recommendedScoreActionCounts = {}
  let agreementBlockedFamilies = 0
  let agreementConsensusLowFamilies = 0
  let agreementModelUnavailableFamilies = 0
  let probeECompletedFamilyCount = 0
  let probeENonzeroPickFamilyCount = 0
  let probeEPositiveHitFamilyCount = 0
  for (const row of results) {
    if (Number(row?.agreementBlockedDaysEval ?? 0) > 0) agreementBlockedFamilies += 1
    if (Number(row?.agreementConsensusLowDaysEval ?? 0) > 0) agreementConsensusLowFamilies += 1
    if (Number(row?.agreementModelUnavailableDaysEval ?? 0) > 0) agreementModelUnavailableFamilies += 1
    const primaryGateReason = String(row?.primaryGateReasonEval ?? "").trim()
    if (primaryGateReason) {
      primaryGateReasonCounts[primaryGateReason] =
        Number(primaryGateReasonCounts[primaryGateReason] ?? 0) + 1
    }
    const reason = String(row?.agreementPrimaryReasonEval ?? "").trim()
    if (reason) {
      agreementPrimaryReasonCounts[reason] =
        Number(agreementPrimaryReasonCounts[reason] ?? 0) + 1
    }
    const pattern = String(row?.agreementPrimaryPatternEval ?? "").trim()
    if (pattern) {
      agreementPrimaryPatternCounts[pattern] =
        Number(agreementPrimaryPatternCounts[pattern] ?? 0) + 1
    }
    const recommendedStrategy = String(row?.recommendedStrategy ?? "").trim()
    if (recommendedStrategy) {
      recommendedStrategyCounts[recommendedStrategy] =
        Number(recommendedStrategyCounts[recommendedStrategy] ?? 0) + 1
    }
    const scorePathologyPrimaryComponent = String(row?.scorePathologyPrimaryComponentEval ?? "").trim()
    if (scorePathologyPrimaryComponent) {
      scorePathologyPrimaryComponentCounts[scorePathologyPrimaryComponent] =
        Number(scorePathologyPrimaryComponentCounts[scorePathologyPrimaryComponent] ?? 0) + 1
    }
    const scorePathologyPrimarySubcomponent = String(row?.scorePathologyPrimarySubcomponentEval ?? "").trim()
    if (scorePathologyPrimarySubcomponent) {
      scorePathologyPrimarySubcomponentCounts[scorePathologyPrimarySubcomponent] =
        Number(scorePathologyPrimarySubcomponentCounts[scorePathologyPrimarySubcomponent] ?? 0) + 1
    }
    const scorePathologyCompositeType = String(row?.scorePathologyCompositeTypeEval ?? "").trim()
    if (scorePathologyCompositeType) {
      scorePathologyCompositeTypeCounts[scorePathologyCompositeType] =
        Number(scorePathologyCompositeTypeCounts[scorePathologyCompositeType] ?? 0) + 1
    }
    const eraSupportPenaltyReason = String(row?.eraSupportPenaltyReasonEval ?? "").trim()
    if (eraSupportPenaltyReason) {
      eraSupportPenaltyReasonCounts[eraSupportPenaltyReason] =
        Number(eraSupportPenaltyReasonCounts[eraSupportPenaltyReason] ?? 0) + 1
    }
    const recommendedScoreAction = String(row?.recommendedScoreAction ?? "").trim()
    if (recommendedScoreAction) {
      recommendedScoreActionCounts[recommendedScoreAction] =
        Number(recommendedScoreActionCounts[recommendedScoreAction] ?? 0) + 1
    }
    const stepELockboxStatus = String(row?.stepELockboxStatus ?? "").trim().toUpperCase()
    if (stepELockboxStatus && stepELockboxStatus !== "DISABLED") {
      probeECompletedFamilyCount += 1
    }
    if (Number(row?.familyPickCountLockbox ?? 0) > 0) {
      probeENonzeroPickFamilyCount += 1
    }
    if (
      Number(row?.familyPickCountLockbox ?? 0) > 0 &&
      Number(row?.familyHitRateLockbox ?? 0) > 0
    ) {
      probeEPositiveHitFamilyCount += 1
    }
  }
  const keepScratchIds = new Set(
    passList.passed
      .slice()
      .sort((left, right) => Number(right?.familyQualityScore ?? 0) - Number(left?.familyQualityScore ?? 0))
      .slice(0, c1Cfg.retainTopProbeArtifacts)
      .map((row) => String(row?.familyId ?? "").trim()),
  )
  if (c1Cfg.cleanupScratch === true) {
    for (const row of results) {
      const familyId = String(row?.familyId ?? "").trim()
      await cleanupFamilyProbeScratch({
        scratchDir: row?.scratchDir,
        retainArtifacts:
          keepScratchIds.has(familyId) || c1Cfg?.lockboxEval?.persistArtifacts === true
      })
    }
  }

  const summary = {
    step: "C1",
    enabled: true,
    probeScope: c1Cfg.probeScope,
    probeProfile: c1Cfg.probeProfile,
    explicitFamilyIds: c1Cfg.explicitFamilyIds,
    sourceRunId,
    sourceRunDir,
    probeScopeApplied:
      String(results.find((row) => String(row?.probeScopeApplied ?? "").trim())?.probeScopeApplied ?? "").trim() || null,
    writebacksDisabled: results.some((row) => row?.writebacksDisabled === true),
    frozenProbe: results.some((row) => row?.c1FrozenProbe === true),
    feedbackUpdatesSkipped: results.some((row) => row?.feedbackUpdatesSkipped === true),
    executionFeedbackSkipped: results.some((row) => row?.executionFeedbackSkipped === true),
    probeELockboxEnabled: c1Cfg?.lockboxEval?.enabled === true,
    bundleEvalEnabled: c1Cfg?.bundleEval?.enabled === true,
    probeECompletedFamilyCount,
    probeENonzeroPickFamilyCount,
    probeEPositiveHitFamilyCount,
    probedFamilies: results.length,
    passedFamilies: passList.passed.length,
    agreementBlockedFamilies,
    agreementConsensusLowFamilies,
    agreementModelUnavailableFamilies,
    primaryGateReasonCounts,
    agreementPrimaryReasonCounts,
    agreementPrimaryPatternCounts,
    scorePathologyPrimaryComponentCounts,
    scorePathologyPrimarySubcomponentCounts,
    scorePathologyCompositeTypeCounts,
    eraSupportPenaltyReasonCounts,
    recommendedStrategyCounts,
    recommendedScoreActionCounts,
    ...rejectedCounts,
    fallbackUsed: passList.fallbackUsed,
    gate: passList.gate
  }
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    probeScope: c1Cfg.probeScope,
    probeProfile: c1Cfg.probeProfile,
    explicitFamilyIds: c1Cfg.explicitFamilyIds,
    sourceRunId,
    sourceRunDir,
    probeScopeApplied: summary.probeScopeApplied,
    writebacksDisabled: summary.writebacksDisabled,
    frozenProbe: summary.frozenProbe,
    probeELockboxEnabled: summary.probeELockboxEnabled,
    bundleEvalEnabled: summary.bundleEvalEnabled,
    probeECompletedFamilyCount,
    probeENonzeroPickFamilyCount,
    probeEPositiveHitFamilyCount,
    overlapFootprintsPath: footprintsPath,
    probedFamilyCount: results.length,
    passedFamilyCount: passList.passed.length,
    rejectedFamilyCount: Math.max(0, results.length - passList.passed.length),
    agreementBlockedFamilies,
    agreementConsensusLowFamilies,
    agreementModelUnavailableFamilies,
    primaryGateReasonCounts,
    agreementPrimaryReasonCounts,
    agreementPrimaryPatternCounts,
    scorePathologyPrimaryComponentCounts,
    scorePathologyPrimarySubcomponentCounts,
    scorePathologyCompositeTypeCounts,
    eraSupportPenaltyReasonCounts,
    recommendedStrategyCounts,
    recommendedScoreActionCounts,
    fallbackUsed: passList.fallbackUsed,
    passedFamilyIds: passList.passed.map((row) => row.familyId),
    backfillFamilyIds: passList.backfill.map((row) => row.familyId),
    rejectedFamilyIds: results
      .filter((row) => row?.passed !== true)
      .map((row) => String(row?.familyId ?? "").trim()),
    resultsPath,
    gate: passList.gate
  }

  await writeJson(indexPath, index)
  await writeJsonl(
    resultsPath,
    results.map((row) => ({
      ...row,
      scratchDir: undefined
      })),
  )
  await writeJsonl(footprintsPath, footprints)
  await writeJson(summaryPath, summary)

  return {
    step: "C1",
    indexPath,
    resultsPath,
    footprintsPath,
    summaryPath,
    summary
  }
}
