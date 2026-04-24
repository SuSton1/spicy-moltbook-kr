import {
  evaluateLiquidityFilters,
  resolveLiquidityFilters
} from "./liquidity_filters.mjs"

const num = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const toInt = (value, fallback = 0) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0))
  return Math.max(0, Math.floor(n))
}

const normalizeReasonList = (value) =>
  Array.isArray(value)
    ? value
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter(Boolean)
    : []

const normalizeAgreementGuardAction = (value) => {
  const text = String(value ?? "shadow").trim().toLowerCase()
  if (text === "block") return "block"
  return "shadow"
}

const normalizeAgreementGuardReasonMode = (value, fallback = "inherit") => {
  const text = String(value ?? fallback).trim().toLowerCase()
  if (text === "diagnostic") return "diagnostic"
  if (text === "block") return "block"
  if (text === "shadow") return "shadow"
  return "inherit"
}

const resolveAgreementGuardContract = (raw, fallback = {}) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled === true,
    minTargetStopEdge3d: num(cfg?.minTargetStopEdge3d ?? fallback?.minTargetStopEdge3d ?? 0),
    minExpectedNetRet3d: num(cfg?.minExpectedNetRet3d ?? fallback?.minExpectedNetRet3d ?? 0),
    minFillProb: num(cfg?.minFillProb ?? fallback?.minFillProb ?? 0),
    maxPStopFirst: num(cfg?.maxPStopFirst ?? fallback?.maxPStopFirst ?? 1),
    minConfidence: num(cfg?.minConfidence ?? fallback?.minConfidence ?? 0),
    minTradeQualityPrototypeResidual:
      cfg?.minTradeQualityPrototypeResidual === null
        ? null
        : num(
            cfg?.minTradeQualityPrototypeResidual ??
              fallback?.minTradeQualityPrototypeResidual,
          ),
    minQualityScore:
      cfg?.minQualityScore === null
        ? null
        : num(cfg?.minQualityScore ?? fallback?.minQualityScore),
    minScoreMargin: num(cfg?.minScoreMargin ?? fallback?.minScoreMargin)
  }
}

const resolveAgreementGuardStrongEdgeBypass = (raw) => {
  const cfg = raw ?? {}
  const reasonOverridesRaw =
    cfg?.reasonOverrides && typeof cfg.reasonOverrides === "object"
      ? cfg.reasonOverrides
      : {}
  const reasonOverrides = {}
  for (const [reasonKey, overrideRaw] of Object.entries(reasonOverridesRaw)) {
    const normalizedReason = String(reasonKey ?? "").trim().toUpperCase()
    if (!normalizedReason) continue
    const merged = {
      enabled: true,
      allowedReasons: [normalizedReason],
      minTargetStopEdge3d: cfg?.minTargetStopEdge3d,
      minExpectedNetRet3d: cfg?.minExpectedNetRet3d,
      minFillProb: cfg?.minFillProb,
      maxPStopFirst: cfg?.maxPStopFirst,
      minConfidence: cfg?.minConfidence,
      minQualityScore: cfg?.minQualityScore,
      minFinalScore: cfg?.minFinalScore,
      minScoreMargin: cfg?.minScoreMargin,
      ...(overrideRaw && typeof overrideRaw === "object" ? overrideRaw : {})
    }
    reasonOverrides[normalizedReason] = {
      minTargetStopEdge3d: num(merged?.minTargetStopEdge3d ?? 0.06),
      minExpectedNetRet3d: num(merged?.minExpectedNetRet3d ?? 0.02),
      minFillProb: num(merged?.minFillProb ?? 0.88),
      maxPStopFirst: num(merged?.maxPStopFirst ?? 0.52),
      minConfidence: num(merged?.minConfidence ?? 0),
      minQualityScore: num(merged?.minQualityScore),
      minFinalScore: num(merged?.minFinalScore),
      minScoreMargin:
        merged?.minScoreMargin === null
          ? null
          : num(merged?.minScoreMargin)
    }
  }
  return {
    enabled: cfg?.enabled === true,
    allowedReasons: normalizeReasonList(
      cfg?.allowedReasons ?? ["AGREEMENT_CONSENSUS_LOW", "AGREEMENT_STABILITY_LOW"],
    ),
    minTargetStopEdge3d: num(cfg?.minTargetStopEdge3d ?? 0.06),
    minExpectedNetRet3d: num(cfg?.minExpectedNetRet3d ?? 0.02),
    minFillProb: num(cfg?.minFillProb ?? 0.88),
    maxPStopFirst: num(cfg?.maxPStopFirst ?? 0.52),
    minConfidence: num(cfg?.minConfidence ?? 0),
    minQualityScore: num(cfg?.minQualityScore),
    minFinalScore: num(cfg?.minFinalScore),
    minScoreMargin:
      cfg?.minScoreMargin === null
        ? null
        : num(cfg?.minScoreMargin),
    reasonOverrides
  }
}

const resolveAgreementGuardTargetFirstBypass = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled === true,
    allowedReasons: normalizeReasonList(
      cfg?.allowedReasons ?? ["AGREEMENT_CONSENSUS_LOW", "AGREEMENT_STABILITY_LOW"],
    ),
    minTargetRate3d: num(cfg?.minTargetRate3d ?? 0.95),
    maxStopRate3d: num(cfg?.maxStopRate3d ?? 0.05),
    minTargetStopEdge3d: num(cfg?.minTargetStopEdge3d ?? 0.75),
    minExpectedNetRet3d: num(cfg?.minExpectedNetRet3d ?? 0.05),
    minFillProb: num(cfg?.minFillProb ?? 0.8),
    maxPStopFirst: num(cfg?.maxPStopFirst ?? 0.22),
    minConfidence: num(cfg?.minConfidence ?? 0.35),
    minQualityScore: num(cfg?.minQualityScore ?? 0.48),
    minFinalScore: num(cfg?.minFinalScore ?? 0.78),
    minScoreMargin:
      cfg?.minScoreMargin === null
        ? null
        : num(cfg?.minScoreMargin ?? 0.002)
  }
}


const WILSON_Z_95 = 1.959963984540054

export const wilsonLowerBound95 = ({ success, total }) => {
  const n = Math.max(0, Number(total ?? 0) || 0)
  const k = Math.max(0, Number(success ?? 0) || 0)
  if (n <= 0) return 0
  const p = clamp01(k / n)
  const z2 = WILSON_Z_95 ** 2
  const center = p + z2 / (2 * n)
  const spread = WILSON_Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  const denom = 1 + z2 / n
  if (!Number.isFinite(denom) || denom <= 0) return 0
  const lb = (center - spread) / denom
  if (!Number.isFinite(lb)) return 0
  return clamp01(lb)
}

export const resolveExecutionGate = (raw) => {
  const cfg = raw ?? {}
  const uncertainty = cfg?.uncertainty ?? {}
  const softReasons = normalizeReasonList(uncertainty?.softReasons)
  const softStart = cfg?.softStart ?? {}
  const strongEdgeOverride = cfg?.strongEdgeOverride ?? {}
  const strongEdgeTemporal = strongEdgeOverride?.temporalStability ?? {}
  const agreementGuard = cfg?.agreementGuard ?? {}
  const agreementGuardDefaults = agreementGuard?.defaults ?? {}
  const feedbackScopeText = String(cfg?.feedbackScope ?? "update_only").trim().toLowerCase()
  const feedbackScope =
    feedbackScopeText === "all" || feedbackScopeText === "update_only"
      ? feedbackScopeText
      : "update_only"
  return {
    enabled: cfg?.enabled === true,
    targetLcb: clamp01(cfg?.targetLcb ?? 0.7),
    minGlobalSamples: toInt(cfg?.minGlobalSamples, 80),
    requireGlobalFloor: cfg?.requireGlobalFloor !== false,
    blockWhenGlobalUnknown: cfg?.blockWhenGlobalUnknown !== false,
    shadowWhenGlobalUnknown: cfg?.shadowWhenGlobalUnknown === true,
    requireRegimeApproval: cfg?.requireRegimeApproval !== false,
    minRegimeSamples: toInt(cfg?.minRegimeSamples, 20),
    blockWhenRegimeUnknown: cfg?.blockWhenRegimeUnknown === true,
    shadowWhenRegimeUnknown: cfg?.shadowWhenRegimeUnknown !== false,
    enforceHardGlobalFloor: cfg?.enforceHardGlobalFloor !== false,
    feedbackDelayDays: toInt(cfg?.feedbackDelayDays, 0),
    calibrationWindowDays: toInt(cfg?.calibrationWindowDays, 0),
    feedbackScope,
    liquidity: resolveLiquidityFilters(cfg?.liquidity),
    softStart: {
      enabled: softStart?.enabled === true,
      untilGlobalSamples: toInt(softStart?.untilGlobalSamples, cfg?.minGlobalSamples ?? 80),
      targetLcb: clamp01(
        softStart?.targetLcb ?? Math.min(0.1, Number(cfg?.targetLcb ?? 0.7) || 0.1),
      ),
      minGlobalSamples: toInt(softStart?.minGlobalSamples, Math.min(30, cfg?.minGlobalSamples ?? 80)),
      requireGlobalFloor: softStart?.requireGlobalFloor === true,
      shadowWhenGlobalUnknown: softStart?.shadowWhenGlobalUnknown === true,
      requireRegimeApproval: softStart?.requireRegimeApproval === true,
      minRegimeSamples: toInt(softStart?.minRegimeSamples, Math.min(8, cfg?.minRegimeSamples ?? 20)),
      shadowWhenRegimeUnknown: softStart?.shadowWhenRegimeUnknown === true
    },
    uncertainty: {
      minScoreMargin: num(uncertainty?.minScoreMargin ?? 0.001),
      minFinalScore: num(uncertainty?.minFinalScore),
      minExpectedNetRet3d: num(uncertainty?.minExpectedNetRet3d ?? -0.001),
      minQualityScore: num(uncertainty?.minQualityScore ?? 0.58),
      minTargetRate3d: num(uncertainty?.minTargetRate3d ?? 0.5),
      minTargetStopEdge3d: num(uncertainty?.minTargetStopEdge3d ?? 0.06),
      maxStopRate3d: num(uncertainty?.maxStopRate3d ?? 0.45),
      minRerankUtilityGain: num(uncertainty?.minRerankUtilityGain),
      softReasons
    },
    strongEdgeOverride: {
      enabled: strongEdgeOverride?.enabled === true,
      bypassCalibrationFloor: strongEdgeOverride?.bypassCalibrationFloor === true,
      allowedMetaReasons: normalizeReasonList(strongEdgeOverride?.allowedMetaReasons),
      allowedUncertaintyReasons: normalizeReasonList(strongEdgeOverride?.allowedUncertaintyReasons),
      minQualityScore: num(strongEdgeOverride?.minQualityScore),
      maxAntiScore: num(strongEdgeOverride?.maxAntiScore),
      minFillProb: num(strongEdgeOverride?.minFillProb),
      minTargetRate3d: num(strongEdgeOverride?.minTargetRate3d),
      minTargetStopEdge3d: num(strongEdgeOverride?.minTargetStopEdge3d),
      minExpectedNetRet3d: num(strongEdgeOverride?.minExpectedNetRet3d),
      minTradeQualityPrototypeResidual: num(strongEdgeOverride?.minTradeQualityPrototypeResidual),
      minConfidence: num(strongEdgeOverride?.minConfidence),
      minFinalScore: num(strongEdgeOverride?.minFinalScore),
      minScoreMargin: num(strongEdgeOverride?.minScoreMargin),
      maxPStopFirst: num(strongEdgeOverride?.maxPStopFirst),
      temporalStability: {
        enabled: strongEdgeTemporal?.enabled === true,
        minEraCoverageRatio: num(strongEdgeTemporal?.minEraCoverageRatio),
        maxSingleEraShare: num(strongEdgeTemporal?.maxSingleEraShare),
        minEraSupportCount: toInt(strongEdgeTemporal?.minEraSupportCount, 0),
        minEraSupportMin: num(strongEdgeTemporal?.minEraSupportMin),
        maxEraWinRateStd: num(strongEdgeTemporal?.maxEraWinRateStd),
        maxEraExpectedNetRetStd: num(strongEdgeTemporal?.maxEraExpectedNetRetStd),
        maxEraContrastiveLiftStd: num(strongEdgeTemporal?.maxEraContrastiveLiftStd)
      }
    },
    agreementGuard: {
      enabled: agreementGuard?.enabled === true,
      defaultAction: normalizeAgreementGuardAction(agreementGuard?.defaultAction),
      defaultReasonMode: normalizeAgreementGuardReasonMode(
        agreementGuard?.defaultReasonMode,
        "inherit",
      ),
      defaults: resolveAgreementGuardContract(agreementGuardDefaults, {
        minTargetStopEdge3d: 0.08,
        minExpectedNetRet3d: 0.02,
        minFillProb: 0.78,
        maxPStopFirst: 0.5,
        minConfidence: 0.05,
        minTradeQualityPrototypeResidual: null,
        minQualityScore: null,
        minScoreMargin: 0.0015
      }),
      contracts: {
        AGREEMENT_CONSENSUS_LOW: resolveAgreementGuardContract(
          agreementGuard?.contracts?.AGREEMENT_CONSENSUS_LOW,
          agreementGuardDefaults,
        ),
        AGREEMENT_STABILITY_LOW: resolveAgreementGuardContract(
          agreementGuard?.contracts?.AGREEMENT_STABILITY_LOW,
          agreementGuardDefaults,
        ),
        AGREEMENT_SCORE_LOW: resolveAgreementGuardContract(
          agreementGuard?.contracts?.AGREEMENT_SCORE_LOW,
          agreementGuardDefaults,
        )
      },
      reasonModes: {
        AGREEMENT_CONSENSUS_LOW: normalizeAgreementGuardReasonMode(
          agreementGuard?.reasonModes?.AGREEMENT_CONSENSUS_LOW,
          agreementGuard?.defaultReasonMode,
        ),
        AGREEMENT_STABILITY_LOW: normalizeAgreementGuardReasonMode(
          agreementGuard?.reasonModes?.AGREEMENT_STABILITY_LOW,
          agreementGuard?.defaultReasonMode,
        ),
        AGREEMENT_SCORE_LOW: normalizeAgreementGuardReasonMode(
          agreementGuard?.reasonModes?.AGREEMENT_SCORE_LOW,
          agreementGuard?.defaultReasonMode,
        )
      },
      strongEdgeBypass: resolveAgreementGuardStrongEdgeBypass(
        agreementGuard?.strongEdgeBypass,
      ),
      targetFirstBypass: resolveAgreementGuardTargetFirstBypass(
        agreementGuard?.targetFirstBypass,
      )
    }
  }
}

const evaluateAgreementGuardStrongEdgeBypass = ({
  agreementReason,
  row,
  scoreMargin,
  cfg
}) => {
  const safeCfg = cfg ?? {}
  const reason = String(agreementReason ?? "").trim().toUpperCase()
  const reasonOverride =
    safeCfg?.reasonOverrides && typeof safeCfg.reasonOverrides === "object"
      ? safeCfg.reasonOverrides?.[reason] ?? null
      : null
  const effectiveCfg = {
    ...safeCfg,
    ...(reasonOverride && typeof reasonOverride === "object" ? reasonOverride : {})
  }
  if (
    safeCfg?.enabled !== true ||
    !reason ||
    !safeCfg.allowedReasons?.includes(reason)
  ) {
    return {
      eligible: false,
      checks: {
        enabled: safeCfg?.enabled === true,
        agreementReason: reason || null,
        allowedReasons: Array.isArray(safeCfg?.allowedReasons)
          ? safeCfg.allowedReasons
          : []
      }
    }
  }
  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const pStop = clamp01(
    row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0,
  )
  const confidence = clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0)
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null
  const eligible =
    targetStopEdge3d >= Number(effectiveCfg?.minTargetStopEdge3d ?? 0) &&
    expectedNetRet3d >= Number(effectiveCfg?.minExpectedNetRet3d ?? 0) &&
    pFill >= Number(effectiveCfg?.minFillProb ?? 0) &&
    pStop <= Number(effectiveCfg?.maxPStopFirst ?? 1) &&
    confidence >= Number(effectiveCfg?.minConfidence ?? 0) &&
    (!Number.isFinite(Number(effectiveCfg?.minQualityScore)) ||
      qualityScore >= Number(effectiveCfg.minQualityScore)) &&
    (!Number.isFinite(Number(effectiveCfg?.minFinalScore)) ||
      finalScore >= Number(effectiveCfg.minFinalScore)) &&
    (!Number.isFinite(Number(effectiveCfg?.minScoreMargin)) ||
      (Number.isFinite(margin) && margin >= Number(effectiveCfg.minScoreMargin)))
  return {
    eligible,
    checks: {
      enabled: true,
      agreementReason: reason,
      targetRate3d,
      stopRate3d,
      targetStopEdge3d,
      expectedNetRet3d,
      pFill,
      pStop,
      confidence,
      qualityScore,
      finalScore,
      scoreMargin: margin,
      reasonOverrideApplied: reasonOverride !== null,
      thresholds: {
        minTargetStopEdge3d: effectiveCfg?.minTargetStopEdge3d ?? null,
        minExpectedNetRet3d: effectiveCfg?.minExpectedNetRet3d ?? null,
        minFillProb: effectiveCfg?.minFillProb ?? null,
        maxPStopFirst: effectiveCfg?.maxPStopFirst ?? null,
        minConfidence: effectiveCfg?.minConfidence ?? null,
        minQualityScore: effectiveCfg?.minQualityScore ?? null,
        minFinalScore: effectiveCfg?.minFinalScore ?? null,
        minScoreMargin: effectiveCfg?.minScoreMargin ?? null
      }
    }
  }
}

const evaluateAgreementGuardTargetFirstBypass = ({
  agreementReason,
  row,
  scoreMargin,
  cfg
}) => {
  const safeCfg = cfg ?? {}
  const reason = String(agreementReason ?? "").trim().toUpperCase()
  if (
    safeCfg?.enabled !== true ||
    !reason ||
    !safeCfg.allowedReasons?.includes(reason)
  ) {
    return {
      eligible: false,
      checks: {
        enabled: safeCfg?.enabled === true,
        agreementReason: reason || null,
        allowedReasons: Array.isArray(safeCfg?.allowedReasons)
          ? safeCfg.allowedReasons
          : []
      }
    }
  }

  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const pStop = clamp01(
    row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0,
  )
  const confidence = clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0)
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null
  const eligible =
    targetRate3d >= Number(safeCfg?.minTargetRate3d ?? 0) &&
    stopRate3d <= Number(safeCfg?.maxStopRate3d ?? 1) &&
    targetStopEdge3d >= Number(safeCfg?.minTargetStopEdge3d ?? 0) &&
    expectedNetRet3d >= Number(safeCfg?.minExpectedNetRet3d ?? 0) &&
    pFill >= Number(safeCfg?.minFillProb ?? 0) &&
    pStop <= Number(safeCfg?.maxPStopFirst ?? 1) &&
    confidence >= Number(safeCfg?.minConfidence ?? 0) &&
    qualityScore >= Number(safeCfg?.minQualityScore ?? 0) &&
    finalScore >= Number(safeCfg?.minFinalScore ?? 0) &&
    (!Number.isFinite(Number(safeCfg?.minScoreMargin)) ||
      (Number.isFinite(margin) && margin >= Number(safeCfg.minScoreMargin)))

  return {
    eligible,
    checks: {
      enabled: true,
      agreementReason: reason,
      targetRate3d,
      stopRate3d,
      targetStopEdge3d,
      expectedNetRet3d,
      pFill,
      pStop,
      confidence,
      qualityScore,
      finalScore,
      scoreMargin: margin,
      thresholds: {
        minTargetRate3d: safeCfg?.minTargetRate3d ?? null,
        maxStopRate3d: safeCfg?.maxStopRate3d ?? null,
        minTargetStopEdge3d: safeCfg?.minTargetStopEdge3d ?? null,
        minExpectedNetRet3d: safeCfg?.minExpectedNetRet3d ?? null,
        minFillProb: safeCfg?.minFillProb ?? null,
        maxPStopFirst: safeCfg?.maxPStopFirst ?? null,
        minConfidence: safeCfg?.minConfidence ?? null,
        minQualityScore: safeCfg?.minQualityScore ?? null,
        minFinalScore: safeCfg?.minFinalScore ?? null,
        minScoreMargin: safeCfg?.minScoreMargin ?? null
      }
    }
  }
}

const evaluateAgreementGuard = ({ row, scoreMargin, cfg }) => {
  const safeCfg = cfg ?? {}
  const agreementDecision = String(row?.agreementDecision ?? "").trim().toUpperCase()
  const agreementReason = String(row?.agreementReason ?? "").trim().toUpperCase()
  if (
    safeCfg?.enabled !== true ||
    agreementDecision !== "REJECT" ||
    !agreementReason
  ) {
    return {
      eligible: true,
      action: null,
      reason: agreementReason || null,
      checks: {
        enabled: safeCfg?.enabled === true,
        agreementDecision,
        agreementReason: agreementReason || null
      }
    }
  }

  const contract = safeCfg?.contracts?.[agreementReason] ?? null
  const reasonModeRaw =
    safeCfg?.reasonModes?.[agreementReason] ??
    safeCfg?.defaultReasonMode ??
    "inherit"
  const reasonMode =
    reasonModeRaw === "inherit"
      ? (safeCfg?.defaultAction === "block" ? "block" : "shadow")
      : reasonModeRaw
  if (!contract || contract?.enabled !== true) {
    return {
      eligible: true,
      action: null,
      reason: agreementReason,
      checks: {
        enabled: true,
        agreementDecision,
        agreementReason,
        contractEnabled: false,
        reasonMode
      }
    }
  }

  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const agreementConsensusCount = num(row?.agreementConsensusCount)
  const agreementStabilityRate = clamp01(row?.agreementStabilityRate ?? 0)
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const pStop = clamp01(
    row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0,
  )
  const confidence = clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0)
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const tradeQualityPrototypeResidual = Number(
    row?.tradeQualityPrototypeResidual ?? row?.tradeQualityPriorAdjustment ?? 0,
  )
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null
  const qualityGatePass =
    Number.isFinite(Number(contract?.minQualityScore))
      ? qualityScore >= Number(contract.minQualityScore)
      : true
  const residualGatePass =
    Number.isFinite(Number(contract?.minTradeQualityPrototypeResidual))
      ? tradeQualityPrototypeResidual >= Number(contract.minTradeQualityPrototypeResidual)
      : true
  const eligible =
    targetStopEdge3d >= Number(contract?.minTargetStopEdge3d ?? 0) &&
    expectedNetRet3d >= Number(contract?.minExpectedNetRet3d ?? 0) &&
    pFill >= Number(contract?.minFillProb ?? 0) &&
    pStop <= Number(contract?.maxPStopFirst ?? 1) &&
    confidence >= Number(contract?.minConfidence ?? 0) &&
    qualityGatePass &&
    residualGatePass &&
    (!Number.isFinite(Number(contract?.minScoreMargin)) ||
      (Number.isFinite(margin) && margin >= Number(contract.minScoreMargin)))

  const checks = {
    enabled: true,
    agreementDecision,
    agreementReason,
    agreementConsensusCount,
    agreementStabilityRate,
    variantName: null,
    reasonMode,
    targetRate3d,
    stopRate3d,
    targetStopEdge3d,
    expectedNetRet3d,
    pFill,
    pStop,
    confidence,
    qualityScore,
    tradeQualityPrototypeResidual,
    scoreMargin: margin,
    thresholds: {
      minTargetStopEdge3d: contract?.minTargetStopEdge3d ?? null,
      minExpectedNetRet3d: contract?.minExpectedNetRet3d ?? null,
      minFillProb: contract?.minFillProb ?? null,
      maxPStopFirst: contract?.maxPStopFirst ?? null,
      minConfidence: contract?.minConfidence ?? null,
      minTradeQualityPrototypeResidual:
        contract?.minTradeQualityPrototypeResidual ?? null,
      minQualityScore: contract?.minQualityScore ?? null,
      minScoreMargin: contract?.minScoreMargin ?? null
    },
    qualityGatePass,
    residualGatePass
  }
  if (eligible || reasonMode === "diagnostic") {
    return {
      eligible: true,
      action: null,
      reason: agreementReason,
      checks: {
        ...checks,
        diagnosticOnly: reasonMode === "diagnostic"
      }
    }
  }
  const strongEdgeBypass = evaluateAgreementGuardStrongEdgeBypass({
    agreementReason,
    row,
    scoreMargin,
    cfg: safeCfg?.strongEdgeBypass
  })
  if (strongEdgeBypass?.eligible === true) {
    return {
      eligible: true,
      action: null,
      reason: agreementReason,
      checks: {
        ...checks,
        strongEdgeBypass: strongEdgeBypass.checks
      }
    }
  }
  const targetFirstBypass = evaluateAgreementGuardTargetFirstBypass({
    agreementReason,
    row,
    scoreMargin,
    cfg: safeCfg?.targetFirstBypass
  })
  if (targetFirstBypass?.eligible === true) {
    return {
      eligible: true,
      action: null,
      reason: agreementReason,
      checks: {
        ...checks,
        strongEdgeBypass: strongEdgeBypass?.checks ?? null,
        targetFirstBypass: targetFirstBypass.checks
      }
    }
  }
  return {
    eligible: false,
    action: reasonMode === "block" ? "BLOCK" : "SHADOW_AGREEMENT",
    reason: agreementReason,
    checks: {
      ...checks,
      strongEdgeBypass: strongEdgeBypass?.checks ?? null,
      targetFirstBypass: targetFirstBypass?.checks ?? null
    }
  }
}

const evaluateTemporalStabilityOverride = ({ row, cfg }) => {
  const safeCfg = cfg ?? {}
  if (safeCfg?.enabled !== true) {
    return {
      eligible: true,
      checks: {
        enabled: false
      }
    }
  }
  const eraCoverageRatio = clamp01(row?.clusterTemporalEraCoverageRatio ?? 0)
  const maxSingleEraShare = clamp01(row?.clusterTemporalMaxSingleEraShare ?? 0)
  const eraSupportCount = Math.max(0, Number(row?.clusterTemporalEraSupportCount ?? 0) || 0)
  const eraSupportMin = Math.max(0, Number(row?.clusterTemporalEraSupportMin ?? 0) || 0)
  const eraWinRateStd = Math.max(0, Number(row?.clusterTemporalEraWinRateStd ?? 0) || 0)
  const eraExpectedNetRetStd = Math.max(
    0,
    Number(row?.clusterTemporalEraExpectedNetRetStd ?? 0) || 0,
  )
  const eraContrastiveLiftStd = Math.max(
    0,
    Number(row?.clusterTemporalEraContrastiveLiftStd ?? 0) || 0,
  )
  const minEraCoverageRatio = num(safeCfg?.minEraCoverageRatio)
  const maxSingleEraShareCap = num(safeCfg?.maxSingleEraShare)
  const minEraSupportCount = Math.max(0, Number(safeCfg?.minEraSupportCount ?? 0) || 0)
  const minEraSupportMin = num(safeCfg?.minEraSupportMin)
  const maxEraWinRateStd = num(safeCfg?.maxEraWinRateStd)
  const maxEraExpectedNetRetStd = num(safeCfg?.maxEraExpectedNetRetStd)
  const maxEraContrastiveLiftStd = num(safeCfg?.maxEraContrastiveLiftStd)
  const checks = {
    enabled: true,
    eraCoverageRatio,
    maxSingleEraShare,
    eraSupportCount,
    eraSupportMin,
    eraWinRateStd,
    eraExpectedNetRetStd,
    eraContrastiveLiftStd,
    minEraCoverageRatio,
    maxSingleEraShareCap,
    minEraSupportCount,
    minEraSupportMin,
    maxEraWinRateStd,
    maxEraExpectedNetRetStd,
    maxEraContrastiveLiftStd
  }
  const failures = []
  if (Number.isFinite(minEraCoverageRatio) && eraCoverageRatio < minEraCoverageRatio) {
    failures.push("ERA_COVERAGE_LOW")
  }
  if (Number.isFinite(maxSingleEraShareCap) && maxSingleEraShare > maxSingleEraShareCap) {
    failures.push("SINGLE_ERA_SHARE_HIGH")
  }
  if (minEraSupportCount > 0 && eraSupportCount < minEraSupportCount) {
    failures.push("ERA_SUPPORT_COUNT_LOW")
  }
  if (Number.isFinite(minEraSupportMin) && eraSupportMin < minEraSupportMin) {
    failures.push("ERA_SUPPORT_MIN_LOW")
  }
  if (Number.isFinite(maxEraWinRateStd) && eraWinRateStd > maxEraWinRateStd) {
    failures.push("ERA_WINRATE_STD_HIGH")
  }
  if (Number.isFinite(maxEraExpectedNetRetStd) && eraExpectedNetRetStd > maxEraExpectedNetRetStd) {
    failures.push("ERA_EXPECTED_RET_STD_HIGH")
  }
  if (Number.isFinite(maxEraContrastiveLiftStd) && eraContrastiveLiftStd > maxEraContrastiveLiftStd) {
    failures.push("ERA_CONTRASTIVE_STD_HIGH")
  }
  return {
    eligible: failures.length < 1,
    checks: {
      ...checks,
      failures
    }
  }
}

const evaluateStrongEdgeOverride = ({
  row,
  scoreMargin,
  metaDecision,
  uncertaintyReasons,
  cfg,
  source = "UNKNOWN"
}) => {
  const safeCfg = cfg ?? {}
  if (safeCfg?.enabled !== true) {
    return {
      eligible: false,
      checks: {
        enabled: false,
        source
      }
    }
  }

  const metaReason = String(metaDecision?.reason ?? "").trim().toUpperCase()
  const hardUncertaintyReasons = (Array.isArray(uncertaintyReasons) ? uncertaintyReasons : [])
    .map((reason) => String(reason ?? "").trim().toUpperCase())
    .filter(Boolean)
  if (metaReason && !safeCfg.allowedMetaReasons.includes(metaReason)) {
    return {
      eligible: false,
      checks: {
        enabled: true,
        source,
        metaReason,
        hardUncertaintyReasons,
        rejectedBy: "META_REASON_NOT_ALLOWED"
      }
    }
  }
  if (
    hardUncertaintyReasons.length > 0 &&
    hardUncertaintyReasons.some((reason) => !safeCfg.allowedUncertaintyReasons.includes(reason))
  ) {
    return {
      eligible: false,
      checks: {
        enabled: true,
        source,
        metaReason,
        hardUncertaintyReasons,
        rejectedBy: "UNCERTAINTY_REASON_NOT_ALLOWED"
      }
    }
  }

  const pStopFirstCalibrated = clamp01(
    row?.calibrated?.pStopFirstCalibrated ?? metaDecision?.checks?.pStop ?? 0,
  )
  const pFillCalibrated = clamp01(
    row?.calibrated?.pFillCalibrated ?? metaDecision?.checks?.pFill ?? 0,
  )
  const confidence = clamp01(
    row?.calibrated?.confidence ?? metaDecision?.checks?.confidence ?? 0,
  )
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const antiScore = clamp01(row?.antiScore ?? 0)
  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const tradeQualityPrototypeResidual = Number(
    row?.tradeQualityPrototypeResidual ?? row?.tradeQualityPriorAdjustment ?? 0,
  )
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null
  const minTargetStopEdge3d = num(safeCfg?.minTargetStopEdge3d)
  const minTradeQualityPrototypeResidual = num(safeCfg?.minTradeQualityPrototypeResidual)
  const edgeQualifiedForRateOrRisk =
    Number.isFinite(minTargetStopEdge3d) &&
    Number.isFinite(minTradeQualityPrototypeResidual) &&
    targetStopEdge3d >= Number(minTargetStopEdge3d) &&
    tradeQualityPrototypeResidual >= Number(minTradeQualityPrototypeResidual) &&
    (!Number.isFinite(Number(safeCfg?.minExpectedNetRet3d)) ||
      expectedNetRet3d >= Number(safeCfg.minExpectedNetRet3d))
  const temporal = evaluateTemporalStabilityOverride({
    row,
    cfg: safeCfg?.temporalStability
  })
  const checks = {
    enabled: true,
    source,
    metaReason: metaReason || null,
    hardUncertaintyReasons,
    pStopFirstCalibrated,
    pFillCalibrated,
    confidence,
    finalScore,
    qualityScore,
    antiScore,
    targetRate3d,
    stopRate3d,
    targetStopEdge3d,
    expectedNetRet3d,
    tradeQualityPrototypeResidual,
    scoreMargin: margin,
    thresholds: {
      minQualityScore: safeCfg?.minQualityScore ?? null,
      maxAntiScore: safeCfg?.maxAntiScore ?? null,
      minFillProb: safeCfg?.minFillProb ?? null,
      minTargetRate3d: safeCfg?.minTargetRate3d ?? null,
      minTargetStopEdge3d: minTargetStopEdge3d ?? null,
      minExpectedNetRet3d: safeCfg?.minExpectedNetRet3d ?? null,
      minTradeQualityPrototypeResidual: minTradeQualityPrototypeResidual ?? null,
      minConfidence: safeCfg?.minConfidence ?? null,
      minFinalScore: safeCfg?.minFinalScore ?? null,
      minScoreMargin: safeCfg?.minScoreMargin ?? null,
      maxPStopFirst: safeCfg?.maxPStopFirst ?? null
    },
    temporal: temporal?.checks ?? {}
  }
  const failures = []
  if (Number.isFinite(Number(safeCfg?.minQualityScore)) && qualityScore < Number(safeCfg.minQualityScore)) {
    failures.push("QUALITY_LOW")
  }
  if (Number.isFinite(Number(safeCfg?.maxAntiScore)) && antiScore > Number(safeCfg.maxAntiScore)) {
    failures.push("ANTI_SCORE_HIGH")
  }
  if (Number.isFinite(Number(safeCfg?.minFillProb)) && pFillCalibrated < Number(safeCfg.minFillProb)) {
    failures.push("FILL_PROB_LOW")
  }
  if (Number.isFinite(Number(safeCfg?.minTargetRate3d)) && targetRate3d < Number(safeCfg.minTargetRate3d)) {
    if (edgeQualifiedForRateOrRisk !== true) failures.push("TARGET_RATE_LOW")
  }
  if (
    Number.isFinite(Number(safeCfg?.minExpectedNetRet3d)) &&
    expectedNetRet3d < Number(safeCfg.minExpectedNetRet3d)
  ) {
    failures.push("EXPECTED_RET_LOW")
  }
  if (Number.isFinite(Number(safeCfg?.minConfidence)) && confidence < Number(safeCfg.minConfidence)) {
    failures.push("CONFIDENCE_LOW")
  }
  if (Number.isFinite(Number(safeCfg?.minFinalScore)) && finalScore < Number(safeCfg.minFinalScore)) {
    failures.push("FINAL_SCORE_LOW")
  }
  if (
    Number.isFinite(Number(safeCfg?.minScoreMargin)) &&
    (!Number.isFinite(margin) || margin < Number(safeCfg.minScoreMargin))
  ) {
    failures.push("SCORE_MARGIN_LOW")
  }
  if (Number.isFinite(Number(safeCfg?.maxPStopFirst)) && pStopFirstCalibrated > Number(safeCfg.maxPStopFirst)) {
    if (edgeQualifiedForRateOrRisk !== true) failures.push("PSTOP_HIGH")
  }
  if (temporal?.eligible !== true) {
    failures.push("TEMPORAL_STABILITY_FAIL")
  }
  return {
    eligible: failures.length < 1,
    checks: {
      ...checks,
      failures
    }
  }
}

const resolveRerankUtilityGain = (rerankDecision) => {
  if (rerankDecision?.applied !== true) return 0
  const selected = Number(rerankDecision?.selectedUtility ?? 0)
  const first = Number(rerankDecision?.firstUtility ?? 0)
  if (!Number.isFinite(selected) || !Number.isFinite(first)) return 0
  return selected - first
}

const getRegimeStats = ({ calibration, regimeTag }) => {
  const map = calibration?.regimeStats instanceof Map ? calibration.regimeStats : null
  if (!map) return { count: 0, hitCount: 0, lcb95: 0 }
  const row = map.get(String(regimeTag ?? "")) ?? null
  const count = Math.max(0, Number(row?.count ?? 0) || 0)
  const hitCount = Math.max(0, Number(row?.hitCount ?? 0) || 0)
  return {
    count,
    hitCount,
    lcb95: wilsonLowerBound95({ success: hitCount, total: count })
  }
}

export const resolveExecutionGateRuntime = ({ calibration, cfg }) => {
  const safeCfg = cfg ?? resolveExecutionGate({})
  const globalCount = Math.max(0, Number(calibration?.globalCount ?? 0) || 0)
  const globalHitCount = Math.max(0, Number(calibration?.globalHitCount ?? 0) || 0)
  const globalLcb95 = wilsonLowerBound95({ success: globalHitCount, total: globalCount })
  const regimeTag = String(calibration?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
  const regimeStats = getRegimeStats({ calibration, regimeTag })
  let activeCfg = { ...safeCfg }
  let gatePhase = "DEFAULT"
  const softStartCfg = safeCfg?.softStart ?? {}
  const softStartUntil = Math.max(
    0,
    Number(softStartCfg?.untilGlobalSamples ?? safeCfg?.minGlobalSamples ?? 0) || 0,
  )
  if (softStartCfg?.enabled === true && globalCount < softStartUntil) {
    gatePhase = "SOFTSTART"
    activeCfg = {
      ...safeCfg,
      targetLcb: Number(softStartCfg?.targetLcb ?? safeCfg?.targetLcb ?? 0),
      minGlobalSamples: Number(softStartCfg?.minGlobalSamples ?? safeCfg?.minGlobalSamples ?? 0),
      requireGlobalFloor: softStartCfg?.requireGlobalFloor === true,
      shadowWhenGlobalUnknown: softStartCfg?.shadowWhenGlobalUnknown === true,
      requireRegimeApproval: softStartCfg?.requireRegimeApproval === true,
      minRegimeSamples: Number(softStartCfg?.minRegimeSamples ?? safeCfg?.minRegimeSamples ?? 0),
      shadowWhenRegimeUnknown: softStartCfg?.shadowWhenRegimeUnknown === true
    }
  }
  return {
    safeCfg,
    activeCfg,
    gatePhase,
    globalCount,
    globalHitCount,
    globalLcb95,
    regimeStats
  }
}

export const evaluateExecutionGate = ({
  row,
  scoreMargin,
  rerankDecision,
  metaDecision,
  calibration,
  cfg
}) => {
  const {
    safeCfg,
    activeCfg,
    gatePhase,
    globalCount,
    globalHitCount,
    globalLcb95,
    regimeStats
  } = resolveExecutionGateRuntime({
    calibration: {
      ...(calibration && typeof calibration === "object" ? calibration : {}),
      regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
    },
    cfg
  })
  if (safeCfg.enabled !== true) {
    return {
      decision: "TRADE",
      reason: "EXECUTION_GATE_DISABLED",
      checks: {}
    }
  }

  const expertAction = String(row?.regimeExpert?.action ?? "ALLOW").trim().toUpperCase()
  if (expertAction === "BLOCK") {
    return {
      decision: "BLOCK",
      reason: "REGIME_EXPERT_BLOCK",
      checks: {
        regimeExpert: row?.regimeExpert ?? null
      }
    }
  }
  if (expertAction === "SHADOW") {
    return {
      decision: "SHADOW_REGIME_EXPERT",
      reason: "REGIME_EXPERT_SHADOW",
      checks: {
        regimeExpert: row?.regimeExpert ?? null
      }
    }
  }

  let strongEdgeMetaOverride = null
  if (metaDecision?.decision === "BLOCK") {
    return {
      decision: "BLOCK",
      reason: `META_${metaDecision?.reason ?? "BLOCKED"}`,
      checks: {
        meta: metaDecision?.checks ?? {}
      }
    }
  }
  if (metaDecision?.decision === "SHADOW") {
    strongEdgeMetaOverride = evaluateStrongEdgeOverride({
      row,
      scoreMargin,
      metaDecision,
      uncertaintyReasons: [],
      cfg: safeCfg?.strongEdgeOverride,
      source: "META"
    })
    if (strongEdgeMetaOverride?.eligible !== true) {
      return {
        decision: "SHADOW_META",
        reason: metaDecision?.reason ?? "META_SHADOW",
        checks: {
          meta: metaDecision?.checks ?? {},
          strongEdgeOverride: strongEdgeMetaOverride?.checks ?? null
        }
      }
    }
  }

  const liquidityCheck = evaluateLiquidityFilters({
    row,
    cfg: safeCfg?.liquidity
  })
  if (liquidityCheck?.decision === "BLOCK") {
    return {
      decision: "BLOCK",
      reason: liquidityCheck.reason ?? "LIQUIDITY_BLOCK",
      checks: {
        liquidity: liquidityCheck.checks ?? {}
      }
    }
  }
  if (liquidityCheck?.decision === "SHADOW") {
    return {
      decision: "SHADOW_LIQUIDITY",
      reason: liquidityCheck.reason ?? "LIQUIDITY_SHADOW",
      checks: {
        liquidity: liquidityCheck.checks ?? {}
      }
    }
  }

  const regimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
  const rerankUtilityGain = resolveRerankUtilityGain(rerankDecision)

  const checks = {
    gatePhase,
    targetLcb: Number(activeCfg.targetLcb ?? 0),
    minGlobalSamples: Number(activeCfg.minGlobalSamples ?? 0),
    minRegimeSamples: Number(activeCfg.minRegimeSamples ?? 0),
    requireGlobalFloor: activeCfg.requireGlobalFloor === true,
    requireRegimeApproval: activeCfg.requireRegimeApproval === true,
    globalCount,
    globalHitCount,
    globalLcb95,
    regimeTag,
    regimeCount: regimeStats.count,
    regimeHitCount: regimeStats.hitCount,
    regimeLcb95: regimeStats.lcb95,
    scoreMargin: Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null,
    rerankUtilityGain
  }

  if (activeCfg.requireGlobalFloor) {
    if (globalCount < Number(activeCfg.minGlobalSamples ?? 0)) {
      if (activeCfg.blockWhenGlobalUnknown !== false) {
        return {
          decision: "BLOCK",
          reason: "GLOBAL_SAMPLES_LOW",
          checks
        }
      }
      if (activeCfg.shadowWhenGlobalUnknown === true) {
        return {
          decision: "SHADOW_LCB_BELOW_TARGET",
          reason: "GLOBAL_SAMPLES_LOW",
          checks
        }
      }
    } else if (globalLcb95 < Number(activeCfg.targetLcb ?? 0)) {
      return {
        decision: activeCfg.enforceHardGlobalFloor === false ? "SHADOW_LCB_BELOW_TARGET" : "BLOCK",
        reason: "GLOBAL_LCB_BELOW_TARGET",
        checks
      }
    }
  }

  if (activeCfg.requireRegimeApproval) {
    if (regimeStats.count < Number(activeCfg.minRegimeSamples ?? 0)) {
      if (activeCfg.blockWhenRegimeUnknown === true) {
        return {
          decision: "BLOCK",
          reason: "REGIME_SAMPLES_LOW",
          checks
        }
      }
      if (activeCfg.shadowWhenRegimeUnknown !== false) {
        return {
          decision: "SHADOW_REGIME_UNAPPROVED",
          reason: "REGIME_SAMPLES_LOW",
          checks
        }
      }
    } else if (regimeStats.lcb95 < Number(activeCfg.targetLcb ?? 0)) {
      return {
        decision: "SHADOW_REGIME_UNAPPROVED",
        reason: "REGIME_LCB_BELOW_TARGET",
        checks
      }
    }
  }

  const agreementGuard = evaluateAgreementGuard({
    row,
    scoreMargin,
    cfg: safeCfg?.agreementGuard
  })
  if (agreementGuard?.eligible !== true) {
    return {
      decision: agreementGuard?.action ?? "SHADOW_AGREEMENT",
      reason: agreementGuard?.reason ?? "AGREEMENT_REJECTED",
      checks: {
        ...checks,
        agreementGuard: agreementGuard?.checks ?? {}
      }
    }
  }

  const uncertaintyReasons = []
  const uncertainty = safeCfg?.uncertainty ?? {}
  const rowFinalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const rowExpected = Number(row?.expectedNetRet3d ?? 0)
  const rowQuality = Number(row?.qualityScore ?? 0)
  const rowTargetRate = Number(row?.targetRate3d ?? 0)
  const rowStopRate = Number(row?.stopRate3d ?? 0)
  const rowTargetStopEdge = rowTargetRate - rowStopRate
  const rowPStopFirst = clamp01(
    row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0,
  )
  const rowTradeQualityPrototypeResidual = Number(
    row?.tradeQualityPrototypeResidual ?? row?.tradeQualityPriorAdjustment ?? 0,
  )
  const margin = Number(scoreMargin)

  if (Number.isFinite(Number(uncertainty?.minScoreMargin)) && Number.isFinite(margin)) {
    if (margin < Number(uncertainty.minScoreMargin)) uncertaintyReasons.push("SCORE_MARGIN_LOW")
  }
  if (Number.isFinite(Number(uncertainty?.minFinalScore))) {
    if (rowFinalScore < Number(uncertainty.minFinalScore)) uncertaintyReasons.push("FINAL_SCORE_LOW")
  }
  if (Number.isFinite(Number(uncertainty?.minExpectedNetRet3d))) {
    if (rowExpected < Number(uncertainty.minExpectedNetRet3d)) {
      uncertaintyReasons.push("EXPECTED_RET_LOW")
    }
  }
  if (Number.isFinite(Number(uncertainty?.minQualityScore))) {
    if (rowQuality < Number(uncertainty.minQualityScore)) uncertaintyReasons.push("QUALITY_LOW")
  }
  if (Number.isFinite(Number(uncertainty?.minTargetRate3d))) {
    if (rowTargetRate < Number(uncertainty.minTargetRate3d)) {
      const minTargetStopEdge3d = Number(uncertainty?.minTargetStopEdge3d)
      const edgeQualifiedForTargetRate =
        Number.isFinite(minTargetStopEdge3d) &&
        rowTargetStopEdge >= minTargetStopEdge3d &&
        rowExpected >= Number(uncertainty?.minExpectedNetRet3d ?? Number.NEGATIVE_INFINITY)
      if (!edgeQualifiedForTargetRate) {
        uncertaintyReasons.push("TARGET_RATE_LOW")
      }
    }
  }
  if (Number.isFinite(Number(uncertainty?.maxStopRate3d))) {
    if (rowStopRate > Number(uncertainty.maxStopRate3d)) uncertaintyReasons.push("STOP_RATE_HIGH")
  }
  if (Number.isFinite(Number(uncertainty?.minRerankUtilityGain))) {
    if (rerankUtilityGain < Number(uncertainty.minRerankUtilityGain)) {
      uncertaintyReasons.push("RERANK_UTILITY_LOW")
    }
  }

  if (uncertaintyReasons.length > 0) {
    const softReasonSet = new Set(
      Array.isArray(uncertainty?.softReasons) ? uncertainty.softReasons : [],
    )
    const hardUncertaintyReasons = uncertaintyReasons.filter((reason) => !softReasonSet.has(reason))
    if (hardUncertaintyReasons.length < 1) {
      return {
        decision: "TRADE",
        reason: "APPROVED_SOFT_UNCERTAINTY",
        checks: {
          ...checks,
          ...(strongEdgeMetaOverride?.eligible === true
            ? { strongEdgeOverride: strongEdgeMetaOverride.checks }
            : {}),
          softUncertaintyReasons: uncertaintyReasons
        }
      }
    }
    const strongEdgeUncertaintyOverride = evaluateStrongEdgeOverride({
      row,
      scoreMargin,
      metaDecision,
      uncertaintyReasons: hardUncertaintyReasons,
      cfg: safeCfg?.strongEdgeOverride,
      source: "UNCERTAINTY"
    })
    if (strongEdgeUncertaintyOverride?.eligible === true) {
      return {
        decision: "TRADE",
        reason:
          strongEdgeMetaOverride?.eligible === true
            ? "APPROVED_STRONG_EDGE_OVERRIDE_META_UNCERTAINTY"
            : "APPROVED_STRONG_EDGE_OVERRIDE_UNCERTAINTY",
        checks: {
          ...checks,
          strongEdgeOverride: {
            meta: strongEdgeMetaOverride?.checks ?? null,
            uncertainty: strongEdgeUncertaintyOverride.checks
          },
          softUncertaintyReasons: uncertaintyReasons.filter((reason) => softReasonSet.has(reason))
        }
      }
    }
    return {
      decision: "SHADOW_UNCERTAIN",
      reason: hardUncertaintyReasons.join("|"),
      checks: {
        ...checks,
        ...(strongEdgeMetaOverride?.eligible === true
          ? { strongEdgeOverride: strongEdgeMetaOverride.checks }
          : {}),
        softUncertaintyReasons: uncertaintyReasons.filter((reason) => softReasonSet.has(reason))
      }
    }
  }

  return {
    decision: "TRADE",
    reason:
      strongEdgeMetaOverride?.eligible === true
        ? "APPROVED_STRONG_EDGE_OVERRIDE_META"
        : "APPROVED",
    checks: {
      ...checks,
      ...(strongEdgeMetaOverride?.eligible === true
        ? { strongEdgeOverride: strongEdgeMetaOverride.checks }
        : {})
    }
  }
}
