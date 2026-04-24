const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

export const resolveMetaSelectorConfig = (raw) => {
  const cfg = raw ?? {}
  const utility = cfg?.utility ?? {}
  const edgeAwareOverride = cfg?.edgeAwareOverride ?? {}
  const pStopMode = String(cfg?.pStopMode ?? "threshold").trim().toLowerCase()
  const softReasons = Array.isArray(cfg?.softReasons)
    ? cfg.softReasons
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean)
    : []
  const tradeRaw = cfg?.tradeThresholds ?? {}
  const shadowRaw = cfg?.shadowThresholds ?? {}
  const tradeThresholds = {
    minCalibratedPHit: clamp01(tradeRaw?.minCalibratedPHit ?? 0.62),
    maxPStopFirst: clamp01(tradeRaw?.maxPStopFirst ?? 0.45),
    minFillProb: clamp01(tradeRaw?.minFillProb ?? 0.55),
    minConfidence: clamp01(tradeRaw?.minConfidence ?? 0.2)
  }
  const shadowThresholds = {
    minCalibratedPHit: clamp01(
      shadowRaw?.minCalibratedPHit ?? Math.max(0, tradeThresholds.minCalibratedPHit - 0.1),
    ),
    maxPStopFirst: clamp01(
      shadowRaw?.maxPStopFirst ?? Math.min(1, tradeThresholds.maxPStopFirst + 0.1),
    ),
    minFillProb: clamp01(
      shadowRaw?.minFillProb ?? Math.max(0, tradeThresholds.minFillProb - 0.15),
    ),
    minConfidence: clamp01(
      shadowRaw?.minConfidence ?? Math.max(0, tradeThresholds.minConfidence - 0.1),
    )
  }
  return {
    enabled: cfg?.enabled !== false,
    allowNoTrade: cfg?.allowNoTrade !== false,
    executionDiagnosticMode: false,
    minCalibratedPHit: tradeThresholds.minCalibratedPHit,
    maxPStopFirst: tradeThresholds.maxPStopFirst,
    minFillProb: tradeThresholds.minFillProb,
    minConfidence: tradeThresholds.minConfidence,
    tradeThresholds,
    shadowThresholds,
    softReasons,
    pStopMode: pStopMode === "utility_only" ? "utility_only" : "threshold",
    tradeUtilityFloor: Number(cfg?.tradeUtilityFloor ?? 0.05),
    shadowUtilityFloor: Number(cfg?.shadowUtilityFloor ?? -0.1),
    utility: {
      pHitWeight: Number(utility?.pHitWeight ?? 1.2),
      pStopPenaltyWeight: Number(utility?.pStopPenaltyWeight ?? 0.9),
      scoreMarginWeight: Number(utility?.scoreMarginWeight ?? 0.35),
      fillProbWeight: Number(utility?.fillProbWeight ?? 0.5),
      slippagePenaltyWeight: Number(utility?.slippagePenaltyWeight ?? 0.4)
    },
    edgeAwareOverride: {
      enabled: edgeAwareOverride?.enabled === true,
      allowedReasons: Array.isArray(edgeAwareOverride?.allowedReasons)
        ? edgeAwareOverride.allowedReasons
          .map((value) => String(value ?? "").trim().toUpperCase())
          .filter(Boolean)
        : ["META_PSTOP_HIGH", "META_PHIT_LOW", "META_UTILITY_LOW", "META_UTILITY_NEGATIVE"],
      minTargetStopEdge3d: Number(edgeAwareOverride?.minTargetStopEdge3d ?? 0.06),
      minExpectedNetRet3d: Number(edgeAwareOverride?.minExpectedNetRet3d ?? 0.015),
      minTradeQualityPrototypeResidual:
        edgeAwareOverride?.minTradeQualityPrototypeResidual === null
          ? null
          : Number(edgeAwareOverride?.minTradeQualityPrototypeResidual ?? 0.03),
      minQualityScore:
        edgeAwareOverride?.minQualityScore === null
          ? null
          : clamp01(edgeAwareOverride?.minQualityScore ?? 0.54),
      minFillProb: clamp01(edgeAwareOverride?.minFillProb ?? 0.72),
      maxPStopFirst: clamp01(edgeAwareOverride?.maxPStopFirst ?? 0.62),
      minConfidence: clamp01(edgeAwareOverride?.minConfidence ?? 0.08),
      minScoreMargin: Number(edgeAwareOverride?.minScoreMargin ?? 0.0015)
    }
  }
}

const computeUtility = ({ calibrated, scoreMargin, slippageRisk, cfg }) =>
  Number(cfg?.utility?.pHitWeight ?? 0) * Number(calibrated?.pHitCalibrated ?? 0) -
  Number(cfg?.utility?.pStopPenaltyWeight ?? 0) * Number(calibrated?.pStopFirstCalibrated ?? 0) +
  Number(cfg?.utility?.scoreMarginWeight ?? 0) * Number(scoreMargin ?? 0) +
  Number(cfg?.utility?.fillProbWeight ?? 0) * Number(calibrated?.pFillCalibrated ?? 0) -
  Number(cfg?.utility?.slippagePenaltyWeight ?? 0) * Number(slippageRisk ?? 0)

const resolveThresholdFailureReason = ({
  pHit,
  pStop,
  pFill,
  confidence,
  thresholds,
  pStopMode = "threshold"
}) => {
  if (pFill < Number(thresholds?.minFillProb ?? 0)) return "META_FILL_LOW"
  if (pHit < Number(thresholds?.minCalibratedPHit ?? 0)) return "META_PHIT_LOW"
  if (pStopMode !== "utility_only" && pStop > Number(thresholds?.maxPStopFirst ?? 1)) {
    return "META_PSTOP_HIGH"
  }
  if (confidence < Number(thresholds?.minConfidence ?? 0)) return "META_CONFIDENCE_LOW"
  return null
}

const evaluateMetaEdgeAwareOverride = ({ row, calibrated, scoreMargin, cfg }) => {
  const safeCfg = cfg?.edgeAwareOverride ?? {}
  if (safeCfg?.enabled !== true) {
    return {
      eligible: false,
      checks: {
        enabled: false
      }
    }
  }
  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const tradeQualityPrototypeResidual = Number(
    row?.tradeQualityPrototypeResidual ?? row?.tradeQualityPriorAdjustment ?? 0,
  )
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const pFill = clamp01(calibrated?.pFillCalibrated ?? 0)
  const pStop = clamp01(calibrated?.pStopFirstCalibrated ?? 0)
  const confidence = clamp01(calibrated?.confidence ?? 0)
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null
  const checks = {
    enabled: true,
    targetRate3d,
    stopRate3d,
    targetStopEdge3d,
    expectedNetRet3d,
    tradeQualityPrototypeResidual,
    qualityScore,
    pFill,
    pStop,
    confidence,
    scoreMargin: margin,
    thresholds: {
      allowedReasons: safeCfg.allowedReasons,
      minTargetStopEdge3d: safeCfg.minTargetStopEdge3d,
      minExpectedNetRet3d: safeCfg.minExpectedNetRet3d,
      minTradeQualityPrototypeResidual: safeCfg.minTradeQualityPrototypeResidual,
      minQualityScore: safeCfg.minQualityScore,
      minFillProb: safeCfg.minFillProb,
      maxPStopFirst: safeCfg.maxPStopFirst,
      minConfidence: safeCfg.minConfidence,
      minScoreMargin: safeCfg.minScoreMargin
    }
  }
  const qualityGatePass =
    Number.isFinite(Number(safeCfg.minQualityScore))
      ? qualityScore >= Number(safeCfg.minQualityScore)
      : true
  const residualGatePass =
    Number.isFinite(Number(safeCfg.minTradeQualityPrototypeResidual))
      ? tradeQualityPrototypeResidual >= Number(safeCfg.minTradeQualityPrototypeResidual)
      : false
  const pureEdgePass =
    targetStopEdge3d >= Number(safeCfg.minTargetStopEdge3d ?? 0) * 1.35 &&
    expectedNetRet3d >= Number(safeCfg.minExpectedNetRet3d ?? 0) * 1.15
  const eligible =
    targetStopEdge3d >= Number(safeCfg.minTargetStopEdge3d ?? 0) &&
    expectedNetRet3d >= Number(safeCfg.minExpectedNetRet3d ?? 0) &&
    qualityGatePass &&
    pFill >= Number(safeCfg.minFillProb ?? 0) &&
    pStop <= Number(safeCfg.maxPStopFirst ?? 1) &&
    confidence >= Number(safeCfg.minConfidence ?? 0) &&
    (!Number.isFinite(margin) || margin >= Number(safeCfg.minScoreMargin ?? 0)) &&
    (residualGatePass || pureEdgePass)
  return {
    eligible,
    checks: {
      ...checks,
      qualityGatePass,
      residualGatePass,
      pureEdgePass
    }
  }
}

export const evaluateMetaSelector = ({
  row,
  calibrated,
  scoreMargin,
  cfg
}) => {
  const safeCfg = resolveMetaSelectorConfig(cfg)
  if (safeCfg.enabled !== true) {
    return {
      decision: "TRADE",
      reason: "META_SELECTOR_DISABLED",
      utility: 0,
      checks: {}
    }
  }

  const pHit = clamp01(calibrated?.pHitCalibrated ?? 0)
  const pStop = clamp01(calibrated?.pStopFirstCalibrated ?? 0)
  const pFill = clamp01(calibrated?.pFillCalibrated ?? 0)
  const confidence = clamp01(calibrated?.confidence ?? 0)
  const slippageRisk = Number(row?.slippageRisk ?? 0)
  const utility = computeUtility({
    calibrated,
    scoreMargin,
    slippageRisk,
    cfg: safeCfg
  })
  const edgeAwareOverride = evaluateMetaEdgeAwareOverride({
    row,
    calibrated,
    scoreMargin,
    cfg: safeCfg
  })

  const checks = {
    pHit,
    pStop,
    pFill,
    confidence,
    tradeThresholds: safeCfg.tradeThresholds,
    shadowThresholds: safeCfg.shadowThresholds,
    pStopMode: safeCfg.pStopMode,
    scoreMargin: Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : null,
    slippageRisk: Number.isFinite(slippageRisk) ? slippageRisk : null,
    utility,
    edgeAwareOverride: edgeAwareOverride?.checks ?? {}
  }

  const shadowFailReason = resolveThresholdFailureReason({
    pHit,
    pStop,
    pFill,
    confidence,
    thresholds: safeCfg.shadowThresholds
    ,
    pStopMode: safeCfg.pStopMode
  })
  if (shadowFailReason) {
    if (
      edgeAwareOverride?.eligible === true &&
      safeCfg.edgeAwareOverride.allowedReasons.includes(String(shadowFailReason).trim().toUpperCase())
    ) {
      return {
        decision: "TRADE",
        reason: "META_EDGE_OVERRIDE",
        utility,
        checks: {
          ...checks,
          edgeOverrideReason: shadowFailReason
        }
      }
    }
    if (safeCfg.softReasons.includes(String(shadowFailReason ?? "").trim().toUpperCase())) {
      return {
        decision: "TRADE",
        reason: "META_SOFT_APPROVED",
        utility,
        checks: {
          ...checks,
          softReason: shadowFailReason
        }
      }
    }
    const decision = safeCfg.allowNoTrade ? "SHADOW" : "BLOCK"
    return { decision, reason: shadowFailReason, utility, checks }
  }

  const tradeFailReason = resolveThresholdFailureReason({
    pHit,
    pStop,
    pFill,
    confidence,
    thresholds: safeCfg.tradeThresholds
    ,
    pStopMode: safeCfg.pStopMode
  })
  if (tradeFailReason) {
    if (
      edgeAwareOverride?.eligible === true &&
      safeCfg.edgeAwareOverride.allowedReasons.includes(String(tradeFailReason).trim().toUpperCase())
    ) {
      return {
        decision: "TRADE",
        reason: "META_EDGE_OVERRIDE",
        utility,
        checks: {
          ...checks,
          edgeOverrideReason: tradeFailReason
        }
      }
    }
    if (safeCfg.softReasons.includes(String(tradeFailReason ?? "").trim().toUpperCase())) {
      return {
        decision: "TRADE",
        reason: "META_SOFT_APPROVED",
        utility,
        checks: {
          ...checks,
          softReason: tradeFailReason
        }
      }
    }
    const decision = safeCfg.allowNoTrade ? "SHADOW" : "BLOCK"
    return { decision, reason: tradeFailReason, utility, checks }
  }

  if (utility >= Number(safeCfg.tradeUtilityFloor ?? 0.05)) {
    return { decision: "TRADE", reason: "META_APPROVED", utility, checks }
  }
  if (
    edgeAwareOverride?.eligible === true &&
    safeCfg.edgeAwareOverride.allowedReasons.includes("META_UTILITY_LOW")
  ) {
    return {
      decision: "TRADE",
      reason: "META_EDGE_OVERRIDE",
      utility,
      checks: {
        ...checks,
        edgeOverrideReason: "META_UTILITY_LOW"
      }
    }
  }
  if (utility >= Number(safeCfg.shadowUtilityFloor ?? -0.1)) {
    return { decision: "SHADOW", reason: "META_UTILITY_LOW", utility, checks }
  }
  if (
    edgeAwareOverride?.eligible === true &&
    safeCfg.edgeAwareOverride.allowedReasons.includes("META_UTILITY_NEGATIVE")
  ) {
    return {
      decision: "SHADOW",
      reason: "META_EDGE_SHADOW_OVERRIDE",
      utility,
      checks: {
        ...checks,
        edgeOverrideReason: "META_UTILITY_NEGATIVE"
      }
    }
  }
  return { decision: "BLOCK", reason: "META_UTILITY_NEGATIVE", utility, checks }
}
