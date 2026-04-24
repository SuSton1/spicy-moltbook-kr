const num = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const parseEnvToggle = (value) => {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
  return text === "1" || text === "true" || text === "yes" || text === "on"
}

const resolveSingleEraEvidenceScaling = ({
  clusterTemporalEraCoverageRatio,
  targetEraCoverageRatio,
  clusterTemporalEraSupportCount,
  minEraSupportCount,
  clusterTemporalEffectiveEraCount,
  clusterTemporalNormalizedEraEntropy,
  clusterTemporalMaxSingleEraShare,
  maxSingleEraShareCap,
  cfg
}) => {
  const safeCfg = cfg && typeof cfg === "object" ? cfg : {}
  const enabled = safeCfg?.enabled === true
  const coverageWeight = Math.max(0, Number(safeCfg?.coverageWeight ?? 0.35) || 0)
  const supportWeight = Math.max(0, Number(safeCfg?.supportWeight ?? 0.35) || 0)
  const effectiveEraCountWeight = Math.max(
    0,
    Number(safeCfg?.effectiveEraCountWeight ?? 0.2) || 0,
  )
  const entropyWeight = Math.max(0, Number(safeCfg?.entropyWeight ?? 0.1) || 0)
  const minEffectiveEraCount = Math.max(1, Number(safeCfg?.minEffectiveEraCount ?? 2) || 2)
  const minPenaltyRatio = clamp01(safeCfg?.minPenaltyRatio ?? 0.25)
  const coverageRatioToTarget =
    targetEraCoverageRatio > 0
      ? clamp(clusterTemporalEraCoverageRatio / targetEraCoverageRatio, 0, 1)
      : 1
  const supportCountRatio =
    minEraSupportCount > 0
      ? clamp(clusterTemporalEraSupportCount / Math.max(1, minEraSupportCount), 0, 1)
      : 1
  const effectiveEraCountRatio =
    minEffectiveEraCount > 1
      ? clamp(Number(clusterTemporalEffectiveEraCount ?? 0) / minEffectiveEraCount, 0, 1)
      : 1
  const entropyRatio = clamp01(clusterTemporalNormalizedEraEntropy ?? effectiveEraCountRatio)
  const weightSum =
    coverageWeight + supportWeight + effectiveEraCountWeight + entropyWeight
  const rawEvidenceRatio =
    weightSum > 0
      ? (
          coverageWeight * coverageRatioToTarget +
          supportWeight * supportCountRatio +
          effectiveEraCountWeight * effectiveEraCountRatio +
          entropyWeight * entropyRatio
        ) / weightSum
      : Math.min(coverageRatioToTarget, supportCountRatio)
  const evidenceRatio = enabled ? Math.max(minPenaltyRatio, clamp01(rawEvidenceRatio)) : 1
  const shareExcess = Math.max(0, clusterTemporalMaxSingleEraShare - maxSingleEraShareCap)
  const effectiveSingleEraShare =
    shareExcess > 0
      ? clamp01(maxSingleEraShareCap + shareExcess * evidenceRatio)
      : clamp01(clusterTemporalMaxSingleEraShare)
  return {
    coverageRatioToTarget: clamp01(coverageRatioToTarget),
    supportCountRatio: clamp01(supportCountRatio),
    effectiveEraCountRatio: clamp01(effectiveEraCountRatio),
    entropyRatio: clamp01(entropyRatio),
    evidenceRatio: clamp01(evidenceRatio),
    effectiveSingleEraShare
  }
}

export const resolvePostScoreAdjust = (raw) => ({
  enabled: raw?.enabled !== false,
  qualityBonusWeight: Number(raw?.qualityBonusWeight ?? 0.08),
  antiPenaltyWeight: Number(raw?.antiPenaltyWeight ?? 0.1),
  expectedRetBonusWeight: Number(raw?.expectedRetBonusWeight ?? 0.04),
  expectedRetScale: Math.max(1e-6, Number(raw?.expectedRetScale ?? 0.08)),
  winRateBonusWeight: Number(raw?.winRateBonusWeight ?? 0),
  targetRateBonusWeight: Number(raw?.targetRateBonusWeight ?? 0),
  stopRatePenaltyWeight: Number(raw?.stopRatePenaltyWeight ?? 0),
  reasonAwareFeatureRelief: {
    enabled: raw?.reasonAwareFeatureRelief?.enabled === true,
    requireLowSupportCountOnly: raw?.reasonAwareFeatureRelief?.requireLowSupportCountOnly !== false,
    failedBreakoutScale: Math.max(
      1,
      Number(raw?.reasonAwareFeatureRelief?.failedBreakoutScale ?? 4) || 4,
    ),
    failedBreakoutWeight: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.failedBreakoutWeight ?? 0) || 0,
    ),
    gapContinueWeight: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.gapContinueWeight ?? 0) || 0,
    ),
    gapRevertWeight: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.gapRevertWeight ?? 0) || 0,
    ),
    executionFeasibilityWeight: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.executionFeasibilityWeight ?? 0) || 0,
    ),
    eraCoverageWeightForSupportRelief: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.eraCoverageWeightForSupportRelief ?? 0) || 0,
    ),
    effectiveEraCountWeightForSupportRelief: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.effectiveEraCountWeightForSupportRelief ?? 0) || 0,
    ),
    entropyWeightForSupportRelief: Math.max(
      0,
      Number(raw?.reasonAwareFeatureRelief?.entropyWeightForSupportRelief ?? 0) || 0,
    ),
    requireMinEraCoverageRatioForSupportRelief: clamp01(
      raw?.reasonAwareFeatureRelief?.requireMinEraCoverageRatioForSupportRelief ?? 0,
    ),
    requireMinEffectiveEraCountRatioForSupportRelief: clamp01(
      raw?.reasonAwareFeatureRelief?.requireMinEffectiveEraCountRatioForSupportRelief ?? 0,
    ),
    requireMinEntropyRatioForSupportRelief: clamp01(
      raw?.reasonAwareFeatureRelief?.requireMinEntropyRatioForSupportRelief ?? 0,
    ),
    maxSingleEraShareExcessForSupportRelief: clamp01(
      raw?.reasonAwareFeatureRelief?.maxSingleEraShareExcessForSupportRelief ?? 1,
    ),
    maxSupportCountPenaltyReliefRatio: clamp01(
      raw?.reasonAwareFeatureRelief?.maxSupportCountPenaltyReliefRatio ?? 0,
    ),
    maxStopRatePenaltyReliefRatio: clamp01(
      raw?.reasonAwareFeatureRelief?.maxStopRatePenaltyReliefRatio ?? 0,
    ),
    stopRateReliefStopRateCap: clamp01(
      raw?.reasonAwareFeatureRelief?.stopRateReliefStopRateCap ?? 0.4,
    ),
  },
  temporalStability: {
    enabled: raw?.temporalStability?.enabled === true,
    targetEraCoverageRatio: clamp01(raw?.temporalStability?.targetEraCoverageRatio ?? 0.5),
    eraCoverageWeight: Number(raw?.temporalStability?.eraCoverageWeight ?? 0),
    maxSingleEraShare: clamp01(raw?.temporalStability?.maxSingleEraShare ?? 0.75),
    singleEraPenaltyWeight: Math.max(
      0,
      Number(raw?.temporalStability?.singleEraPenaltyWeight ?? 0) || 0,
    ),
    minEraSupportCount: Math.max(
      0,
      Math.floor(Number(raw?.temporalStability?.minEraSupportCount ?? 0) || 0),
    ),
    lowEraSupportPenaltyWeight: Math.max(
      0,
      Number(raw?.temporalStability?.lowEraSupportPenaltyWeight ?? 0) || 0,
    ),
    singleEraEvidenceScaling: {
      enabled: raw?.temporalStability?.singleEraEvidenceScaling?.enabled === true,
      coverageWeight: Math.max(
        0,
        Number(raw?.temporalStability?.singleEraEvidenceScaling?.coverageWeight ?? 0.35) || 0,
      ),
      supportWeight: Math.max(
        0,
        Number(raw?.temporalStability?.singleEraEvidenceScaling?.supportWeight ?? 0.35) || 0,
      ),
      effectiveEraCountWeight: Math.max(
        0,
        Number(
          raw?.temporalStability?.singleEraEvidenceScaling?.effectiveEraCountWeight ?? 0.2,
        ) || 0,
      ),
      entropyWeight: Math.max(
        0,
        Number(raw?.temporalStability?.singleEraEvidenceScaling?.entropyWeight ?? 0.1) || 0,
      ),
      minEffectiveEraCount: Math.max(
        1,
        Number(raw?.temporalStability?.singleEraEvidenceScaling?.minEffectiveEraCount ?? 2) || 2,
      ),
      minPenaltyRatio: clamp01(
        raw?.temporalStability?.singleEraEvidenceScaling?.minPenaltyRatio ?? 0.25,
      ),
    }
  },
  executionPrior: {
    enabled: raw?.executionPrior?.enabled === true,
    minFillProb: clamp01(raw?.executionPrior?.minFillProb ?? 0.78),
    lowFillPenaltyWeight: Math.max(
      0,
      Number(raw?.executionPrior?.lowFillPenaltyWeight ?? 0.08) || 0,
    ),
    highSlippageRisk: Math.max(
      0,
      Number(raw?.executionPrior?.highSlippageRisk ?? 0.14) || 0,
    ),
    slippagePenaltyWeight: Math.max(
      0,
      Number(raw?.executionPrior?.slippagePenaltyWeight ?? 0.2) || 0,
    ),
    lowLiquidityMinAvgTradingValue20dKrw: Math.max(
      0,
      Number(raw?.executionPrior?.lowLiquidityMinAvgTradingValue20dKrw ?? 1_200_000_000) || 0,
    ),
    lowLiquidityPenaltyWeight: Math.max(
      0,
      Number(raw?.executionPrior?.lowLiquidityPenaltyWeight ?? 0.08) || 0,
    ),
    blockedOrderPenaltyWeight: Math.max(
      0,
      Number(raw?.executionPrior?.blockedOrderPenaltyWeight ?? 0.05) || 0,
    ),
    afterCostScale: Math.max(
      1e-6,
      Number(raw?.executionPrior?.afterCostScale ?? 0.08) || 0.08,
    ),
    positiveAfterCostBonusWeight: Number(
      raw?.executionPrior?.positiveAfterCostBonusWeight ?? 0.02,
    ),
    negativeAfterCostPenaltyWeight: Math.max(
      0,
      Number(raw?.executionPrior?.negativeAfterCostPenaltyWeight ?? 0.04) || 0,
    )
  }
})

const normalizeSecondPickMode = (raw) => {
  const mode = String(raw ?? "disabled").trim().toLowerCase()
  if (mode === "shadow") return "shadow"
  if (mode === "enforce") return "enforce"
  return "disabled"
}

const normalizeCounterfactualMode = (raw) => {
  const mode = String(raw ?? "off").trim().toLowerCase()
  if (mode === "shadow") return "shadow"
  if (mode === "hard") return "hard"
  return "off"
}

const normalizeScoreRecoveryGateReason = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"].includes(text)) {
    return text
  }
  return null
}

const normalizeScorePathologyComponent = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (
    [
      "POST_ADJUST_HEAVY",
      "REGIME_EXPERT_HEAVY",
      "EXTENDED_BIAS_HEAVY",
      "TRADE_QUALITY_HEAVY",
      "EXECUTION_PRIOR_HEAVY",
      "MIXED_DEEP_FAIL"
    ].includes(text)
  ) {
    return text
  }
  return null
}

const normalizeScorePathologySubcomponent = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (
    [
      "STOP_RATE_PENALTY",
      "ANTI_PENALTY",
      "SINGLE_ERA_PENALTY",
      "SINGLE_ERA_CONCENTRATION_PENALTY",
      "LOW_ERA_SUPPORT_PENALTY",
      "SUPPORT_COUNT_PENALTY",
      "ERA_COVERAGE_PENALTY",
      "REGIME_MULTIPLIER_PENALTY",
      "EXTENDED_BIAS_PENALTY",
      "TRADE_QUALITY_RANKER_ADJUSTMENT",
      "TRADE_QUALITY_ROUTE_RESIDUAL",
      "TRADE_QUALITY_REGIME_RESIDUAL",
      "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
      "TRADE_QUALITY_TOTAL_FALLBACK",
      "LOW_FILL_PENALTY",
      "SLIPPAGE_PENALTY",
      "LOW_LIQUIDITY_PENALTY",
      "BLOCKED_ORDER_PENALTY",
      "NEGATIVE_AFTER_COST_PENALTY"
    ].includes(text)
  ) {
    return text
  }
  return null
}

const normalizeEraSupportPenaltyReason = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (["LOW_SUPPORT_COUNT", "LOW_ERA_COVERAGE", "SINGLE_ERA_DOMINANCE"].includes(text)) {
    return text
  }
  return null
}

const resolveSecondPickGate = ({ raw, dayGate }) => {
  const secondRaw = raw?.secondPick ?? {}
  return {
    mode: normalizeSecondPickMode(secondRaw?.phase ?? secondRaw?.mode),
    debugLog: secondRaw?.debugLog === true,
    minFinalScore: Number(secondRaw?.minFinalScore ?? dayGate.minFinalScore),
    minExpectedNetRet3d: Number(secondRaw?.minExpectedNetRet3d ?? dayGate.minExpectedNetRet3d),
    requirePositiveExpectedNetRet3d:
      secondRaw?.requirePositiveExpectedNetRet3d === undefined
        ? dayGate.requirePositiveExpectedNetRet3d === true
        : secondRaw?.requirePositiveExpectedNetRet3d === true,
    maxGapFromFirst: num(secondRaw?.maxGapFromFirst),
    minMarginVsThird: num(secondRaw?.minMarginVsThird)
  }
}

const resolveSimilarityGate = (raw) => {
  const minRawSimilarity = num(raw?.minRawSimilarity)
  const minLocalStageScore = num(raw?.minLocalStageScore)
  const minTriggerStageScore = num(raw?.minTriggerStageScore)
  const activeThresholdCount = [
    minRawSimilarity,
    minLocalStageScore,
    minTriggerStageScore
  ].filter((value) => Number.isFinite(value)).length
  return {
    enabled: raw?.enabled === true && activeThresholdCount > 0,
    minRawSimilarity:
      Number.isFinite(minRawSimilarity) ? clamp01(minRawSimilarity) : null,
    minLocalStageScore:
      Number.isFinite(minLocalStageScore) ? clamp01(minLocalStageScore) : null,
    minTriggerStageScore:
      Number.isFinite(minTriggerStageScore) ? clamp01(minTriggerStageScore) : null
  }
}

const normalizeNegativeBucket = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (["STOP_FIRST", "TIMEOUT_NEGATIVE", "LOW_EXECUTION_QUALITY"].includes(text)) {
    return text
  }
  return null
}

const resolveSimilarityDisambiguation = (raw) => {
  const minTop1Top2Gap = num(raw?.minTop1Top2Gap)
  const minPositiveNegativeGap = num(raw?.minPositiveNegativeGap)
  const activeThresholdCount = [minTop1Top2Gap, minPositiveNegativeGap].filter((value) =>
    Number.isFinite(value)
  ).length
  return {
    enabled: raw?.enabled === true && activeThresholdCount > 0,
    minTop1Top2Gap:
      Number.isFinite(minTop1Top2Gap) ? clamp01(minTop1Top2Gap) : null,
    minPositiveNegativeGap:
      Number.isFinite(minPositiveNegativeGap) ? clamp01(minPositiveNegativeGap) : null,
    negativeBuckets: Array.from(
      new Set(
        (Array.isArray(raw?.negativeBuckets) ? raw.negativeBuckets : [])
          .map((value) => normalizeNegativeBucket(value))
          .filter(Boolean),
      ),
    )
  }
}

const resolveCoverageRecoveryGate = ({ raw, dayGate, effectiveSinglePick }) => {
  const recoveryRaw = raw?.coverageRecovery ?? {}
  const handoffRaw = recoveryRaw?.scoreMarginHandoff ?? {}
  return {
    enabled: recoveryRaw?.enabled === true && effectiveSinglePick === true,
    targetPickedCount: Math.max(
      0,
      Math.floor(Number(recoveryRaw?.targetPickedCount ?? 60) || 60),
    ),
    minScoreMarginRatio: clamp(Number(recoveryRaw?.minScoreMarginRatio ?? 0.55), 0, 1),
    minQualityScore: clamp01(recoveryRaw?.minQualityScore ?? 0.58),
    minExpectedNetRet3d: Number(
      recoveryRaw?.minExpectedNetRet3d ?? dayGate?.minExpectedNetRet3d ?? -1,
    ),
    maxRecoveryShare: clamp(Number(recoveryRaw?.maxRecoveryShare ?? 0.25), 0, 1),
    minObservedHitRate: clamp01(recoveryRaw?.minObservedHitRate ?? 0),
    minObservedSamples: Math.max(0, Math.floor(Number(recoveryRaw?.minObservedSamples ?? 0) || 0)),
    requirePositiveExpectedNetRet3d:
      recoveryRaw?.requirePositiveExpectedNetRet3d === undefined
        ? dayGate?.requirePositiveExpectedNetRet3d === true
        : recoveryRaw?.requirePositiveExpectedNetRet3d === true,
    scoreMarginHandoff: {
      enabled: handoffRaw?.enabled === true && effectiveSinglePick === true,
      minScoreMarginFloorRatio: clamp(Number(handoffRaw?.minScoreMarginFloorRatio ?? 0.3), 0, 1),
      minExpectedNetRet3d: Number(
        handoffRaw?.minExpectedNetRet3d ??
          recoveryRaw?.minExpectedNetRet3d ??
          dayGate?.minExpectedNetRet3d ??
          -1,
      ),
      minQualityScore: clamp01(handoffRaw?.minQualityScore ?? 0.46),
      minFinalScore: Number(handoffRaw?.minFinalScore ?? dayGate?.minFinalScore ?? 0),
      minTargetStopEdge3d: num(handoffRaw?.minTargetStopEdge3d ?? 0.06),
      maxAntiScore: num(handoffRaw?.maxAntiScore ?? 0.15),
      minFillProb: clamp01(handoffRaw?.minFillProb ?? 0),
      maxSlippageRisk: num(handoffRaw?.maxSlippageRisk),
      requirePositiveExpectedNetRet3d:
        handoffRaw?.requirePositiveExpectedNetRet3d === undefined
          ? (
              recoveryRaw?.requirePositiveExpectedNetRet3d === undefined
                ? dayGate?.requirePositiveExpectedNetRet3d === true
                : recoveryRaw?.requirePositiveExpectedNetRet3d === true
            )
          : handoffRaw?.requirePositiveExpectedNetRet3d === true
    }
  }
}

const resolveScoreRecoveryGate = ({ raw, dayGate, effectiveSinglePick }) => {
  const recoveryRaw = raw?.scoreRecovery ?? {}
  const mode = normalizeCounterfactualMode(recoveryRaw?.mode)
  return {
    enabled: recoveryRaw?.enabled === true && effectiveSinglePick === true && mode !== "off",
    mode,
    allowedGateReasons: Array.from(
      new Set(
        (Array.isArray(recoveryRaw?.allowedGateReasons) ? recoveryRaw.allowedGateReasons : [])
          .map((value) => normalizeScoreRecoveryGateReason(value))
          .filter(Boolean),
      ),
    ),
    maxFinalScoreShortfall: num(recoveryRaw?.maxFinalScoreShortfall),
    maxScoreMarginShortfall: num(recoveryRaw?.maxScoreMarginShortfall),
    minRawSimilarity: num(recoveryRaw?.minRawSimilarity),
    minLocalStageScore: num(recoveryRaw?.minLocalStageScore),
    minExpectedNetRet3d: Number(
      recoveryRaw?.minExpectedNetRet3d ?? dayGate?.minExpectedNetRet3d ?? -1,
    ),
    maxFalsePositiveRisk: num(recoveryRaw?.maxFalsePositiveRisk),
    minFillProb: num(recoveryRaw?.minFillProb)
  }
}

const resolveScoreRecalibrationGate = ({ raw, dayGate, effectiveSinglePick }) => {
  const recalibrationRaw = raw?.scoreRecalibration ?? {}
  const mode = normalizeCounterfactualMode(recalibrationRaw?.mode)
  const maxPenaltyCapByComponentRaw =
    recalibrationRaw?.maxPenaltyCapByComponent && typeof recalibrationRaw.maxPenaltyCapByComponent === "object"
      ? recalibrationRaw.maxPenaltyCapByComponent
      : {}
  const maxPenaltyCapBySubcomponentRaw =
    recalibrationRaw?.maxPenaltyCapBySubcomponent &&
    typeof recalibrationRaw.maxPenaltyCapBySubcomponent === "object"
      ? recalibrationRaw.maxPenaltyCapBySubcomponent
      : {}
  const subcomponentPoliciesRaw =
    recalibrationRaw?.subcomponentPolicies &&
    typeof recalibrationRaw.subcomponentPolicies === "object" &&
    !Array.isArray(recalibrationRaw.subcomponentPolicies)
      ? recalibrationRaw.subcomponentPolicies
      : {}
  const eraSupportReasonPoliciesRaw =
    recalibrationRaw?.eraSupportReasonPolicies &&
    typeof recalibrationRaw.eraSupportReasonPolicies === "object" &&
    !Array.isArray(recalibrationRaw.eraSupportReasonPolicies)
      ? recalibrationRaw.eraSupportReasonPolicies
      : {}
  return {
    enabled: recalibrationRaw?.enabled === true && effectiveSinglePick === true && mode !== "off",
    mode,
    allowedPrimaryComponents: Array.from(
      new Set(
        (Array.isArray(recalibrationRaw?.allowedPrimaryComponents)
          ? recalibrationRaw.allowedPrimaryComponents
          : [])
          .map((value) => normalizeScorePathologyComponent(value))
          .filter(Boolean),
      ),
    ),
    allowedPrimarySubcomponents: Array.from(
      new Set(
        (Array.isArray(recalibrationRaw?.allowedPrimarySubcomponents)
          ? recalibrationRaw.allowedPrimarySubcomponents
          : [])
          .map((value) => normalizeScorePathologySubcomponent(value))
          .filter(Boolean),
      ),
    ),
    maxPenaltyCapByComponent: Object.fromEntries(
      Object.entries(maxPenaltyCapByComponentRaw)
        .map(([key, value]) => [normalizeScorePathologyComponent(key), num(value)])
        .filter(([key, value]) => key && Number.isFinite(value) && value >= 0),
    ),
    maxPenaltyCapBySubcomponent: Object.fromEntries(
      Object.entries(maxPenaltyCapBySubcomponentRaw)
        .map(([key, value]) => [normalizeScorePathologySubcomponent(key), num(value)])
        .filter(([key, value]) => key && Number.isFinite(value) && value >= 0),
    ),
    subcomponentPolicies: Object.fromEntries(
      Object.entries(subcomponentPoliciesRaw)
        .map(([key, value]) => {
          const normalizedKey = normalizeScorePathologySubcomponent(key)
          const policy = value && typeof value === "object" && !Array.isArray(value) ? value : null
          if (!normalizedKey || !policy) return null
          const allowedSecondarySubcomponents = Array.from(
            new Set(
              (Array.isArray(policy?.allowedSecondarySubcomponents)
                ? policy.allowedSecondarySubcomponents
                : [])
                .map((item) => normalizeScorePathologySubcomponent(item))
                .filter(Boolean),
            ),
          )
          return [
            normalizedKey,
            {
              maxPenaltyCap: num(policy?.maxPenaltyCap),
              requireMinEraCoverageRatio: num(policy?.requireMinEraCoverageRatio),
              requireMinEraSupportCount: Number.isFinite(Number(policy?.requireMinEraSupportCount))
                ? Math.max(0, Math.floor(Number(policy.requireMinEraSupportCount)))
                : null,
              requireMaxEraSupportShortfall: num(policy?.requireMaxEraSupportShortfall),
              requireMaxSingleEraShareExcess: num(policy?.requireMaxSingleEraShareExcess),
              requireMinFillProb: num(policy?.requireMinFillProb),
              allowedSecondarySubcomponents
            }
          ]
        })
        .filter(Boolean),
    ),
    eraSupportReasonPolicies: Object.fromEntries(
      Object.entries(eraSupportReasonPoliciesRaw)
        .map(([key, value]) => {
          const normalizedKey = normalizeEraSupportPenaltyReason(key)
          const policy = value && typeof value === "object" && !Array.isArray(value) ? value : null
          if (!normalizedKey || !policy) return null
          const allowedCompositeTypes = Array.from(
            new Set(
              (Array.isArray(policy?.allowedCompositeTypes) ? policy.allowedCompositeTypes : [])
                .map((item) => String(item ?? "").trim().toUpperCase())
                .filter(Boolean),
            ),
          )
          return [
            normalizedKey,
            {
              maxPenaltyCap: num(policy?.maxPenaltyCap),
              requireMinEraCoverageRatio: num(policy?.requireMinEraCoverageRatio),
              requireMinEffectiveEraCount: num(policy?.requireMinEffectiveEraCount),
              requireMinEffectiveEraCountRatio: num(policy?.requireMinEffectiveEraCountRatio),
              requireMinEntropyRatio: num(policy?.requireMinEntropyRatio),
              requireMaxSingleEraShareExcess: num(policy?.requireMaxSingleEraShareExcess),
              requireMinFillProb: num(policy?.requireMinFillProb),
              allowedCompositeTypes
            }
          ]
        })
        .filter(Boolean),
    ),
    baseScoreFloor: num(recalibrationRaw?.baseScoreFloor),
    minRawSimilarity: num(recalibrationRaw?.minRawSimilarity),
    minLocalStageScore: num(recalibrationRaw?.minLocalStageScore),
    minExpectedNetRet3d: Number(
      recalibrationRaw?.minExpectedNetRet3d ?? dayGate?.minExpectedNetRet3d ?? -1,
    ),
    minFillProb: num(recalibrationRaw?.minFillProb)
  }
}

const normalizeTop1RerankObjectiveMode = (value) => {
  const mode = String(value ?? "legacy_blended").trim().toLowerCase()
  return mode === "backbone_plus_target_delta" ? "backbone_plus_target_delta" : "legacy_blended"
}

const resolveTop1RerankGate = ({ raw, effectiveSinglePick }) => {
  const rerankRaw = raw?.top1Rerank ?? {}
  return {
    enabled: rerankRaw?.enabled === true,
    objectiveMode: normalizeTop1RerankObjectiveMode(rerankRaw?.objectiveMode),
    candidatePool: Math.max(10, Math.floor(Number(rerankRaw?.candidatePool ?? 10) || 10)),
    maxTargetRank: Math.max(2, Math.floor(Number(rerankRaw?.maxTargetRank ?? rerankRaw?.candidatePool ?? 10) || 10)),
    maxSwapMargin: Math.max(0, Number(rerankRaw?.maxSwapMargin ?? 0.008) || 0),
    minUtilityGain: Math.max(0, Number(rerankRaw?.minUtilityGain ?? 0) || 0),
    finalScoreWeight: Number(rerankRaw?.finalScoreWeight ?? 0),
    baseScoreWeight: Number(rerankRaw?.baseScoreWeight ?? 0.05),
    expectedRetWeight: Number(rerankRaw?.expectedRetWeight ?? 0.12),
    qualityWeight: Number(rerankRaw?.qualityWeight ?? 0.04),
    winRateWeight: Number(rerankRaw?.winRateWeight ?? 0.08),
    commonAlignmentWeight: Number(rerankRaw?.commonAlignmentWeight ?? 0.04),
    antiScorePenaltyWeight: Math.max(0, Number(rerankRaw?.antiScorePenaltyWeight ?? 0.04) || 0),
    targetRateWeight: Number(rerankRaw?.targetRateWeight ?? 0),
    stopRatePenaltyWeight: Math.max(0, Number(rerankRaw?.stopRatePenaltyWeight ?? 0) || 0),
    pHitWeight: Number(rerankRaw?.pHitWeight ?? 1.6),
    pStopFirstPenaltyWeight: Math.max(0, Number(rerankRaw?.pStopFirstPenaltyWeight ?? 1.1) || 0),
    fillProbWeight: Number(rerankRaw?.fillProbWeight ?? 0.75),
    scoreMarginWeight: Number(rerankRaw?.scoreMarginWeight ?? 0.35),
    scoreMarginBand: {
      enabled: rerankRaw?.scoreMarginBand?.enabled === true,
      minPreferredMargin: Math.max(
        0,
        Number(rerankRaw?.scoreMarginBand?.minPreferredMargin ?? 0.009) || 0.009,
      ),
      maxPreferredMargin: Math.max(
        0,
        Number(rerankRaw?.scoreMarginBand?.maxPreferredMargin ?? 0.013) || 0.013,
      ),
      lowMarginScale: Math.max(
        1e-6,
        Number(rerankRaw?.scoreMarginBand?.lowMarginScale ?? 0.004) || 0.004,
      ),
      highMarginScale: Math.max(
        1e-6,
        Number(rerankRaw?.scoreMarginBand?.highMarginScale ?? 0.008) || 0.008,
      ),
      lowMarginPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.scoreMarginBand?.lowMarginPenaltyWeight ?? 0) || 0,
      ),
      highMarginPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.scoreMarginBand?.highMarginPenaltyWeight ?? 0) || 0,
      )
    },
    overconfidencePenalty: {
      enabled: rerankRaw?.overconfidencePenalty?.enabled === true,
      highScoreMarginThreshold: Math.max(
        0,
        Number(rerankRaw?.overconfidencePenalty?.highScoreMarginThreshold ?? 0.017) || 0.017,
      ),
      highScoreMarginScale: Math.max(
        1e-6,
        Number(rerankRaw?.overconfidencePenalty?.highScoreMarginScale ?? 0.008) || 0.008,
      ),
      highScoreMarginPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.overconfidencePenalty?.highScoreMarginPenaltyWeight ?? 0) || 0,
      )
    },
    slippageRiskPenaltyWeight: Math.max(0, Number(rerankRaw?.slippageRiskPenaltyWeight ?? 0.45) || 0),
    liquidityPenaltyEnabled: rerankRaw?.liquidityPenaltyEnabled !== false,
    minAvgTradingValue20dKrw: Math.max(
      0,
      Number(rerankRaw?.minAvgTradingValue20dKrw ?? 800_000_000) || 0,
    ),
    lowLiquidityPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.lowLiquidityPenaltyWeight ?? 0.2) || 0,
    ),
    midLiquidityPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.midLiquidityPenaltyWeight ?? 0.08) || 0,
    ),
    midLiquidityBandRatio: Math.max(
      1,
      Number(rerankRaw?.midLiquidityBandRatio ?? 1.5) || 1,
    ),
    liqLowTagPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.liqLowTagPenaltyWeight ?? 0.12) || 0,
    ),
    liqMidTagPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.liqMidTagPenaltyWeight ?? 0.05) || 0,
    ),
    temporalStability: {
      enabled: rerankRaw?.temporalStability?.enabled === true,
      targetEraCoverageRatio: clamp01(rerankRaw?.temporalStability?.targetEraCoverageRatio ?? 0.5),
      eraCoverageWeight: Number(rerankRaw?.temporalStability?.eraCoverageWeight ?? 0),
      maxSingleEraShare: clamp01(rerankRaw?.temporalStability?.maxSingleEraShare ?? 0.75),
      singleEraPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.temporalStability?.singleEraPenaltyWeight ?? 0) || 0,
      ),
      minEraSupportCount: Math.max(
        0,
        Math.floor(Number(rerankRaw?.temporalStability?.minEraSupportCount ?? 0) || 0),
      ),
      lowEraSupportPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.temporalStability?.lowEraSupportPenaltyWeight ?? 0) || 0,
      )
    },
    stageGlobalWeight: Number(rerankRaw?.stageGlobalWeight ?? 0.06),
    stageLocalWeight: Number(rerankRaw?.stageLocalWeight ?? 0.08),
    stageTriggerWeight: Number(rerankRaw?.stageTriggerWeight ?? 0.08),
    delta: {
      targetStopEdgeWeight: Number(rerankRaw?.delta?.targetStopEdgeWeight ?? 1.0),
      expectedRetWeight: Number(rerankRaw?.delta?.expectedRetWeight ?? 0.35),
      hitMinusStopWeight: Number(rerankRaw?.delta?.hitMinusStopWeight ?? 0.35),
      qualityWeight: Number(rerankRaw?.delta?.qualityWeight ?? 0.15),
      antiPenaltyWeight: Math.max(0, Number(rerankRaw?.delta?.antiPenaltyWeight ?? 0.2) || 0),
      failedBreakoutPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.delta?.failedBreakoutPenaltyWeight ?? 0) || 0,
      ),
      gapContinueWeight: Number(rerankRaw?.delta?.gapContinueWeight ?? 0) || 0,
      gapRevertPenaltyWeight: Math.max(
        0,
        Number(rerankRaw?.delta?.gapRevertPenaltyWeight ?? 0) || 0,
      ),
      executionFeasibilityWeight: Number(rerankRaw?.delta?.executionFeasibilityWeight ?? 0) || 0,
      failedBreakoutScale: Math.max(
        1,
        Number(rerankRaw?.delta?.failedBreakoutScale ?? 4) || 4,
      ),
    }
    ,
    failedBreakoutPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.failedBreakoutPenaltyWeight ?? 0) || 0,
    ),
    gapContinueWeight: Number(rerankRaw?.gapContinueWeight ?? 0) || 0,
    gapRevertPenaltyWeight: Math.max(
      0,
      Number(rerankRaw?.gapRevertPenaltyWeight ?? 0) || 0,
    ),
    executionFeasibilityWeight: Number(rerankRaw?.executionFeasibilityWeight ?? 0) || 0,
    failedBreakoutScale: Math.max(
      1,
      Number(rerankRaw?.failedBreakoutScale ?? 4) || 4,
    ),
  }
}

const resolveTop1MicroCorrectionGate = ({ raw, effectiveSinglePick }) => {
  const microRaw = raw?.top1MicroCorrection ?? {}
  const fillTieRaw = microRaw?.strongFillTieBreak ?? {}
  const targetFirstTieRaw = microRaw?.targetFirstTieBreak ?? {}
  if (targetFirstTieRaw?.enabled === true && effectiveSinglePick === true) {
    return {
      enabled: true,
      mode: "target_first_tie_break",
      candidatePool: Math.max(2, Math.floor(Number(targetFirstTieRaw?.candidatePool ?? 3) || 3)),
      maxScoreGap: Math.max(0, Number(targetFirstTieRaw?.maxScoreGap ?? 0.0085) || 0),
      minAntiAdvantage: clamp01(targetFirstTieRaw?.minAntiAdvantage ?? 0.05),
      minQualityAdvantage: clamp01(targetFirstTieRaw?.minQualityAdvantage ?? 0.01),
      minStopRateAdvantage: clamp01(targetFirstTieRaw?.minStopRateAdvantage ?? 0.08),
      maxExpectedNetRetDrop: Math.max(
        0,
        Number(targetFirstTieRaw?.maxExpectedNetRetDrop ?? 0.008) || 0,
      ),
      maxTargetRateDrop: clamp01(targetFirstTieRaw?.maxTargetRateDrop ?? 0.02),
      minTemporalShareAdvantage: clamp01(targetFirstTieRaw?.minTemporalShareAdvantage ?? 0.05),
      minEraSupportMinAdvantage: Math.max(
        0,
        Number(targetFirstTieRaw?.minEraSupportMinAdvantage ?? 4) || 0,
      ),
      minCorrectionScore: Number(targetFirstTieRaw?.minCorrectionScore ?? 0.14) || 0
    }
  }
  return {
    enabled: fillTieRaw?.enabled === true && effectiveSinglePick === true,
    mode: "strong_fill_tie_break",
    candidatePool: Math.max(2, Math.floor(Number(fillTieRaw?.candidatePool ?? 3) || 3)),
    maxScoreGap: Math.max(0, Number(fillTieRaw?.maxScoreGap ?? 0.015) || 0),
    minFillAdvantage: clamp01(fillTieRaw?.minFillAdvantage ?? 0.1),
    maxPHitDrop: clamp01(fillTieRaw?.maxPHitDrop ?? 0.06),
    maxExpectedNetRetDiff: Math.max(
      0,
      Number(fillTieRaw?.maxExpectedNetRetDiff ?? 0.002) || 0,
    ),
    maxQualityScoreDiff: clamp01(fillTieRaw?.maxQualityScoreDiff ?? 0.05),
    maxAntiScoreDiff: clamp01(fillTieRaw?.maxAntiScoreDiff ?? 0.05),
    maxTargetRateDiff: clamp01(fillTieRaw?.maxTargetRateDiff ?? 0.05),
    maxStopRateDiff: clamp01(fillTieRaw?.maxStopRateDiff ?? 0.05)
  }
}

export const resolveDecisionGate = (raw) => {
  const maxPicksPerDay = Number(raw?.maxPicksPerDay ?? 1)
  if (!Number.isInteger(maxPicksPerDay) || (maxPicksPerDay !== 1 && maxPicksPerDay !== 2)) {
    throw new Error(`decisionGate.maxPicksPerDay must be 1 or 2, got: ${raw?.maxPicksPerDay}`)
  }
  const maxScoreMarginRaw = num(raw?.maxScoreMargin)
  const dayGate = {
    minFinalScore: Number(raw?.minFinalScore ?? raw?.minTradeScore ?? 0),
    minScoreMargin: Number(raw?.minScoreMargin ?? 0),
    maxScoreMargin:
      Number.isFinite(maxScoreMarginRaw) && maxScoreMarginRaw >= 0 ? maxScoreMarginRaw : null,
    useScoreMarginGate: raw?.useScoreMarginGate !== false,
    useMinScoreMarginGate:
      raw?.useMinScoreMarginGate === undefined
        ? raw?.useScoreMarginGate !== false
        : raw?.useMinScoreMarginGate !== false,
    useMaxScoreMarginGate:
      raw?.useMaxScoreMarginGate === undefined
        ? raw?.useScoreMarginGate !== false
        : raw?.useMaxScoreMarginGate !== false,
    maxPicksPerDay,
    hitWindowDays: Math.max(1, Number(raw?.hitWindowDays ?? 3) || 3),
    hitEval: {
      useStopLoss: raw?.hitEval?.useStopLoss !== false,
      stopLossPct: Math.max(0, Number(raw?.hitEval?.stopLossPct ?? 0.04) || 0.04),
      sameDayTiePolicy: String(raw?.hitEval?.sameDayTiePolicy ?? "STOP_WINS")
        .trim()
        .toUpperCase() === "HIT_WINS"
        ? "HIT_WINS"
        : "STOP_WINS"
    },
    inversionAdjust: {
      enabled: raw?.inversionAdjust?.enabled === true,
      maxSwapMargin: Math.max(0, Number(raw?.inversionAdjust?.maxSwapMargin ?? 0.02) || 0.02),
      secondBoost: Number(raw?.inversionAdjust?.secondBoost ?? 0),
      qualityWeight: Number(raw?.inversionAdjust?.qualityWeight ?? 0.04)
    },
    minExpectedNetRet3d: Number(raw?.minExpectedNetRet3d ?? -1),
    requirePositiveExpectedNetRet3d: raw?.requirePositiveExpectedNetRet3d === true
  }
  const secondPick = resolveSecondPickGate({ raw, dayGate })
  const similarityGate = resolveSimilarityGate(raw?.similarityGate)
  const similarityDisambiguation = resolveSimilarityDisambiguation(raw?.similarityDisambiguation)
  if (maxPicksPerDay < 2) {
    secondPick.mode = "disabled"
  }
  const effectiveSinglePick = maxPicksPerDay === 1 || secondPick.mode === "disabled"
  const explorationRaw = raw?.exploration ?? {}
  const exploration = {
    enabled: explorationRaw?.enabled === true && effectiveSinglePick === true,
    epsilon: clamp(Number(explorationRaw?.epsilon ?? 0), 0, 0.05),
    candidatePool: Math.max(2, Math.floor(Number(explorationRaw?.candidatePool ?? 3) || 3)),
    minPickedCountForEnable: Math.max(
      0,
      Math.floor(Number(explorationRaw?.minPickedCountForEnable ?? 60) || 60),
    ),
    killSwitchEnv: String(explorationRaw?.killSwitchEnv ?? "CD_LOOP_DISABLE_EXPLORATION").trim() ||
      "CD_LOOP_DISABLE_EXPLORATION"
  }
  const coverageRecovery = resolveCoverageRecoveryGate({
    raw,
    dayGate,
    effectiveSinglePick
  })
  const scoreRecovery = resolveScoreRecoveryGate({
    raw,
    dayGate,
    effectiveSinglePick
  })
  const scoreRecalibration = resolveScoreRecalibrationGate({
    raw,
    dayGate,
    effectiveSinglePick
  })
  const top1Rerank = resolveTop1RerankGate({
    raw,
    effectiveSinglePick
  })
  const top1MicroCorrection = resolveTop1MicroCorrectionGate({
    raw,
    effectiveSinglePick
  })
  const perfectPrototypeMode = String(raw?.perfectPrototypeGate?.mode ?? "off").trim().toLowerCase()
  const perfectPrototypeSelectionMode = String(
    raw?.perfectPrototypeGate?.selectionMode ?? "champion_only",
  )
    .trim()
    .toLowerCase()
  const perfectPrototypeCatalogPath = String(raw?.perfectPrototypeGate?.catalogPath ?? "").trim()
  return {
    ...dayGate,
    similarityGate,
    similarityDisambiguation,
    secondPick,
    effectiveSinglePick,
    exploration,
    coverageRecovery,
    scoreRecovery,
    scoreRecalibration,
    top1Rerank,
    top1MicroCorrection,
    perfectPrototypeGate: {
      enabled: raw?.perfectPrototypeGate?.enabled === true,
      mode:
        perfectPrototypeMode === "annotate" || perfectPrototypeMode === "hard"
          ? perfectPrototypeMode
          : "off",
      catalogPath: perfectPrototypeCatalogPath || null,
      selectionMode:
        perfectPrototypeSelectionMode === "union_all" ? "union_all" : "champion_only",
      dedupeSymbolsPerDay: raw?.perfectPrototypeGate?.dedupeSymbolsPerDay !== false,
      maxRulesPerSymbol: Math.max(
        1,
        Math.floor(Number(raw?.perfectPrototypeGate?.maxRulesPerSymbol ?? 8) || 8),
      )
    },
    agreementGate: {
      ...(raw?.agreementGate ?? {})
    }
  }
}

export const buildPrototypeQualityLookup = ({ library, runtimeMeta } = {}) => {
  const toPrototypeQualityLookupRow = (row) => ({
    qualityScore: clamp01(row?.qualityScore),
    antiScore: clamp01(row?.antiScore),
    baseQualityScore: clamp01(row?.baseQualityScore ?? row?.qualityScore ?? 0.5),
    baseAntiScore: clamp01(row?.baseAntiScore ?? row?.antiScore ?? 0),
    commonAlignmentScore: clamp(row?.commonAlignmentScore ?? 0, -1, 1),
    expectedNetRet3d: num(row?.expectedNetRet3d) ?? 0,
    winRate3d: clamp01(row?.winRate3d),
    targetRate3d: clamp01(row?.targetRate3d),
    stopRate3d: clamp01(row?.stopRate3d),
    qualityTrades: Math.max(0, Number(row?.qualityTrades ?? 0) || 0),
    contrastiveSamples: Math.max(0, Number(row?.contrastiveSamples ?? 0) || 0),
    contrastivePosRate: clamp01(row?.contrastivePosRate),
    contrastiveNegRate: clamp01(row?.contrastiveNegRate),
    contrastiveLift: Math.max(0, Number(row?.contrastiveLift ?? 1) || 1),
    outcomeBucket: String(row?.outcomeBucket ?? "").trim().toUpperCase() || null,
    executionFeasibilityBucket:
      String(row?.executionFeasibilityBucket ?? "").trim().toUpperCase() || null,
    clusterId: String(row?.clusterId ?? "").trim() || null,
    clusterSignature: String(row?.clusterSignature ?? "").trim() || null,
    c0FamilyId: String(row?.c0FamilyId ?? "").trim() || null,
    c0FamilySignature: String(row?.c0FamilySignature ?? "").trim() || null,
    c0Shortlisted: row?.c0Shortlisted === true,
    c0Score: clamp01(row?.c0Score ?? 0),
    c0FamilySupport: Math.max(0, Number(row?.c0FamilySupport ?? 0) || 0),
    selectedEraId: String(row?.selectedEraId ?? "").trim() || null,
    clusterTemporalEraSupportCount: Math.max(0, Number(row?.clusterTemporalEraSupportCount ?? 0) || 0),
    clusterTemporalEraCoverageRatio: clamp01(row?.clusterTemporalEraCoverageRatio ?? 0),
    clusterTemporalDominantEraId: String(row?.clusterTemporalDominantEraId ?? "").trim() || null,
    clusterTemporalDominantEraShare: clamp01(row?.clusterTemporalDominantEraShare ?? 0),
    clusterTemporalMaxSingleEraShare: clamp01(row?.clusterTemporalMaxSingleEraShare ?? 0),
    clusterTemporalEraSupportMin: Math.max(0, Number(row?.clusterTemporalEraSupportMin ?? 0) || 0),
    clusterTemporalEraSupportMedian: Math.max(0, Number(row?.clusterTemporalEraSupportMedian ?? 0) || 0),
    clusterTemporalEffectiveEraCount: Math.max(
      0,
      Number(row?.clusterTemporalEffectiveEraCount ?? row?.clusterTemporalEraSupportCount ?? 0) || 0,
    ),
    clusterTemporalNormalizedEraEntropy: clamp01(
      row?.clusterTemporalNormalizedEraEntropy ?? 0,
    ),
    clusterTemporalEraWinRateStd: Math.max(0, Number(row?.clusterTemporalEraWinRateStd ?? 0) || 0),
    clusterTemporalEraExpectedNetRetStd: Math.max(
      0,
      Number(row?.clusterTemporalEraExpectedNetRetStd ?? 0) || 0,
    ),
    clusterTemporalEraContrastiveLiftStd: Math.max(
      0,
      Number(row?.clusterTemporalEraContrastiveLiftStd ?? 0) || 0,
    ),
    failedBreakoutCount20: Math.max(
      0,
      Number(row?.failedBreakoutCount20 ?? row?.featureVec?.["shape.failedBreakoutCount20"] ?? 0) || 0,
    ),
    gapFillThenContinueScore: clamp01(
      row?.gapFillThenContinueScore ?? row?.featureVec?.["gap.fillThenContinueScore"] ?? 0,
    ),
    gapFillThenRevertScore: clamp01(
      row?.gapFillThenRevertScore ?? row?.featureVec?.["gap.fillThenRevertScore"] ?? 0,
    ),
    executionFeasibilityScore: clamp01(
      row?.executionFeasibilityScore ?? row?.featureVec?.["execution.feasibilityScore"] ?? 0,
    ),
  })
  const lookup = new Map()
  const runtimeRows = Array.isArray(runtimeMeta?.prototypeQuality)
    ? runtimeMeta.prototypeQuality
    : []
  for (const row of runtimeRows) {
    const templateId = String(row?.templateId ?? "").trim()
    if (!templateId) continue
    lookup.set(templateId, toPrototypeQualityLookupRow(row))
  }
  if (lookup.size > 0) return lookup

  for (const row of library?.prototypes ?? []) {
    const templateId = String(row?.templateId ?? "").trim()
    if (!templateId) continue
    lookup.set(templateId, toPrototypeQualityLookupRow(row))
  }
  return lookup
}

export const applyPostScoreAdjust = ({
  baseScore,
  matchedPrototypeId,
  qualityLookup,
  featureVec,
  cfg
}) => {
  const base = Number(baseScore ?? 0)
  const row = qualityLookup?.get(String(matchedPrototypeId ?? "").trim()) ?? null
  const candidateFeatureVec = featureVec && typeof featureVec === "object" ? featureVec : {}
  const qualityScore = clamp01(row?.qualityScore ?? 0.5)
  const antiScore = clamp01(row?.antiScore ?? 0)
  const baseQualityScore = clamp01(row?.baseQualityScore ?? qualityScore)
  const baseAntiScore = clamp01(row?.baseAntiScore ?? antiScore)
  const commonAlignmentScore = clamp(row?.commonAlignmentScore ?? 0, -1, 1)
  const clusterSignature = String(row?.clusterSignature ?? "").trim() || null
  const expectedNetRet3d = num(row?.expectedNetRet3d) ?? 0
  const winRate3d = clamp01(row?.winRate3d ?? 0.5)
  const targetRate3d = clamp01(row?.targetRate3d ?? 0.5)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0.5)
  const qualityTrades = Math.max(0, Number(row?.qualityTrades ?? 0) || 0)
  const contrastiveSamples = Math.max(0, Number(row?.contrastiveSamples ?? 0) || 0)
  const contrastivePosRate = clamp01(row?.contrastivePosRate ?? 1)
  const contrastiveNegRate = clamp01(row?.contrastiveNegRate ?? 0)
  const contrastiveLift = Math.max(0, Number(row?.contrastiveLift ?? 1) || 1)
  const selectedEraId = String(row?.selectedEraId ?? "").trim() || null
  const clusterTemporalEraSupportCount = Math.max(0, Number(row?.clusterTemporalEraSupportCount ?? 0) || 0)
  const clusterTemporalEraCoverageRatio = clamp01(row?.clusterTemporalEraCoverageRatio ?? 0)
  const clusterTemporalDominantEraId = String(row?.clusterTemporalDominantEraId ?? "").trim() || null
  const clusterTemporalDominantEraShare = clamp01(row?.clusterTemporalDominantEraShare ?? 0)
  const clusterTemporalMaxSingleEraShare = clamp01(row?.clusterTemporalMaxSingleEraShare ?? 0)
  const clusterTemporalEraSupportMin = Math.max(0, Number(row?.clusterTemporalEraSupportMin ?? 0) || 0)
  const clusterTemporalEraSupportMedian = Math.max(
    0,
    Number(row?.clusterTemporalEraSupportMedian ?? 0) || 0,
  )
  const clusterTemporalEraWinRateStd = Math.max(0, Number(row?.clusterTemporalEraWinRateStd ?? 0) || 0)
  const clusterTemporalEraExpectedNetRetStd = Math.max(
    0,
    Number(row?.clusterTemporalEraExpectedNetRetStd ?? 0) || 0,
  )
  const clusterTemporalEraContrastiveLiftStd = Math.max(
    0,
    Number(row?.clusterTemporalEraContrastiveLiftStd ?? 0) || 0,
  )
  const clusterTemporalEffectiveEraCount = Math.max(
    0,
    Number(row?.clusterTemporalEffectiveEraCount ?? row?.clusterTemporalEraSupportCount ?? 0) || 0,
  )
  const clusterTemporalNormalizedEraEntropy = clamp01(
    row?.clusterTemporalNormalizedEraEntropy ?? 0,
  )
  const prototypeFailedBreakoutCount20 = Math.max(0, Number(row?.failedBreakoutCount20 ?? 0) || 0)
  const prototypeGapFillThenContinueScore = clamp01(row?.gapFillThenContinueScore ?? 0)
  const prototypeGapFillThenRevertScore = clamp01(row?.gapFillThenRevertScore ?? 0)
  const prototypeExecutionFeasibilityScore = clamp01(row?.executionFeasibilityScore ?? 0)
  const failedBreakoutCount20 = Math.max(
    0,
    Number(candidateFeatureVec?.["shape.failedBreakoutCount20"] ?? prototypeFailedBreakoutCount20 ?? 0) || 0,
  )
  const gapFillThenContinueScore = clamp01(
    candidateFeatureVec?.["gap.fillThenContinueScore"] ?? prototypeGapFillThenContinueScore ?? 0,
  )
  const gapFillThenRevertScore = clamp01(
    candidateFeatureVec?.["gap.fillThenRevertScore"] ?? prototypeGapFillThenRevertScore ?? 0,
  )
  const executionFeasibilityScore = clamp01(
    candidateFeatureVec?.["execution.feasibilityScore"] ?? prototypeExecutionFeasibilityScore ?? 0,
  )
  const temporalStabilityCfg = cfg?.temporalStability ?? {}
  const featureReliefCfg = cfg?.reasonAwareFeatureRelief ?? {}
  const targetEraCoverageRatio = clamp01(
    temporalStabilityCfg?.targetEraCoverageRatio ?? 0.5,
  )
  const maxSingleEraShareCap = clamp01(
    temporalStabilityCfg?.maxSingleEraShare ?? 0.75,
  )
  const minEraSupportCount = Math.max(
    0,
    Math.floor(Number(temporalStabilityCfg?.minEraSupportCount ?? 0) || 0),
  )
  const eraSupportShortfall =
    minEraSupportCount > 0
      ? Math.max(0, minEraSupportCount - clusterTemporalEraSupportCount)
      : 0
  const eraCoverageShortfall = Math.max(
    0,
    targetEraCoverageRatio - clusterTemporalEraCoverageRatio,
  )
  const singleEraShareExcess = Math.max(
    0,
    clusterTemporalMaxSingleEraShare - maxSingleEraShareCap,
  )
  const singleEraEvidence = resolveSingleEraEvidenceScaling({
    clusterTemporalEraCoverageRatio,
    targetEraCoverageRatio,
    clusterTemporalEraSupportCount,
    minEraSupportCount,
    clusterTemporalEffectiveEraCount,
    clusterTemporalNormalizedEraEntropy,
    clusterTemporalMaxSingleEraShare,
    maxSingleEraShareCap,
    cfg: temporalStabilityCfg?.singleEraEvidenceScaling
  })
  const failedBreakoutScale = Math.max(
    1,
    Number(
      featureReliefCfg?.failedBreakoutScale ??
        featureReliefCfg?.maxFailedBreakoutCount ??
        4,
    ) || 4,
  )
  const failedBreakoutReliefSignal = 1 - clamp(failedBreakoutCount20 / failedBreakoutScale, 0, 1)
  const eraSupportPenaltyReason = "NONE"

  if (!cfg?.enabled) {
    return {
      baseScore: base,
      finalScore: base,
      qualityBonus: 0,
      winRateBonus: 0,
      targetRateBonus: 0,
      stopRatePenalty: 0,
      antiPenalty: 0,
      expectedRetBonus: 0,
      eraCoverageBonus: 0,
      coveragePenalty: 0,
      supportCountPenalty: 0,
      supportCountPenaltyRaw: 0,
      supportCountPenaltyRelief: 0,
      supportCountPenaltyReliefSignal: 0,
      singleEraConcentrationPenaltyRaw: 0,
      singleEraConcentrationPenaltyRelief: 0,
      singleEraConcentrationPenaltyEvidenceRatio: 1,
      singleEraConcentrationPenalty: 0,
      singleEraPenalty: 0,
      lowEraSupportPenalty: 0,
      stopRatePenaltyRaw: 0,
      stopRatePenaltyRelief: 0,
      stopRatePenaltyReliefSignal: 0,
      qualityScore,
      antiScore,
      baseQualityScore,
      baseAntiScore,
      commonAlignmentScore,
      clusterSignature,
      expectedNetRet3d,
      winRate3d,
      targetRate3d,
      stopRate3d,
      qualityTrades,
      contrastiveSamples,
      contrastivePosRate,
      contrastiveNegRate,
      contrastiveLift,
      selectedEraId,
      clusterTemporalEraSupportCount,
      clusterTemporalEraCoverageRatio,
      targetEraCoverageRatio,
      clusterTemporalDominantEraId,
      clusterTemporalDominantEraShare,
      clusterTemporalMaxSingleEraShare,
      clusterTemporalEffectiveSingleEraShare: clusterTemporalMaxSingleEraShare,
      clusterTemporalSingleEraEvidenceCoverageRatio: singleEraEvidence.coverageRatioToTarget,
      clusterTemporalSingleEraEvidenceSupportRatio: singleEraEvidence.supportCountRatio,
      clusterTemporalEffectiveEraCount,
      clusterTemporalNormalizedEraEntropy,
      clusterTemporalSingleEraEvidenceEffectiveEraCountRatio:
        singleEraEvidence.effectiveEraCountRatio,
      clusterTemporalSingleEraEvidenceEntropyRatio: singleEraEvidence.entropyRatio,
      maxSingleEraShareCap,
      minEraSupportCount,
      eraSupportShortfall,
      eraCoverageShortfall,
      singleEraShareExcess,
      eraSupportPenaltyReasonRaw: eraSupportPenaltyReason,
      eraSupportPenaltyReason,
      clusterTemporalEraSupportMin,
      clusterTemporalEraSupportMedian,
      clusterTemporalEraWinRateStd,
      clusterTemporalEraExpectedNetRetStd,
      clusterTemporalEraContrastiveLiftStd,
      failedBreakoutCount20,
      gapFillThenContinueScore,
      gapFillThenRevertScore,
      executionFeasibilityScore,
      prototypeFailedBreakoutCount20,
      prototypeGapFillThenContinueScore,
      prototypeGapFillThenRevertScore,
      prototypeExecutionFeasibilityScore
    }
  }

  const qualityBonus =
    Number(cfg?.qualityBonusWeight ?? 0) * ((qualityScore - 0.5) * 2)
  const winRateBonus =
    Number(cfg?.winRateBonusWeight ?? 0) * ((winRate3d - 0.5) * 2)
  const targetRateBonus =
    Number(cfg?.targetRateBonusWeight ?? 0) * ((targetRate3d - 0.5) * 2)
  const stopRatePenaltyRaw = Number(cfg?.stopRatePenaltyWeight ?? 0) * stopRate3d
  const antiPenalty = Number(cfg?.antiPenaltyWeight ?? 0) * antiScore
  const expectedRetScale = Math.max(1e-6, Number(cfg?.expectedRetScale ?? 0.08))
  const expectedRetBonus =
    Number(cfg?.expectedRetBonusWeight ?? 0) *
    clamp(expectedNetRet3d / expectedRetScale, -1, 1)
  const rawEraCoverageAdjustment =
    temporalStabilityCfg?.enabled === true
      ? Number(temporalStabilityCfg?.eraCoverageWeight ?? 0) *
        clamp(
          (clusterTemporalEraCoverageRatio - targetEraCoverageRatio) /
            Math.max(1e-6, 1 - targetEraCoverageRatio),
          -1,
          1,
        )
      : 0
  const eraCoverageBonus = rawEraCoverageAdjustment > 0 ? rawEraCoverageAdjustment : 0
  const coveragePenalty = rawEraCoverageAdjustment < 0 ? Math.abs(rawEraCoverageAdjustment) : 0
  const singleEraConcentrationPenaltyRaw =
    temporalStabilityCfg?.enabled === true &&
    clusterTemporalMaxSingleEraShare > maxSingleEraShareCap
      ? Number(temporalStabilityCfg?.singleEraPenaltyWeight ?? 0) *
        clamp(
          (clusterTemporalMaxSingleEraShare - maxSingleEraShareCap) /
            Math.max(1e-6, 1 - maxSingleEraShareCap),
          0,
          1,
        )
      : 0
  const singleEraConcentrationPenalty =
    singleEraConcentrationPenaltyRaw * singleEraEvidence.evidenceRatio
  const singleEraConcentrationPenaltyRelief = Math.max(
    0,
    singleEraConcentrationPenaltyRaw - singleEraConcentrationPenalty,
  )
  const supportCountPenaltyRaw =
    temporalStabilityCfg?.enabled === true &&
    minEraSupportCount > 0 &&
    clusterTemporalEraSupportCount < minEraSupportCount
      ? Number(temporalStabilityCfg?.lowEraSupportPenaltyWeight ?? 0) *
        clamp(
          (minEraSupportCount - clusterTemporalEraSupportCount) /
            Math.max(1, minEraSupportCount),
          0,
          1,
        )
      : 0
  const resolvedEraSupportPenaltyReasonRaw = [
    ["LOW_SUPPORT_COUNT", supportCountPenaltyRaw],
    ["LOW_ERA_COVERAGE", coveragePenalty],
    ["SINGLE_ERA_DOMINANCE", singleEraConcentrationPenaltyRaw]
  ]
    .filter(([, penalty]) => Number.isFinite(Number(penalty)) && Number(penalty) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] ?? "NONE"
  const resolvedEraSupportPenaltyReason = [
    ["LOW_SUPPORT_COUNT", supportCountPenaltyRaw],
    ["LOW_ERA_COVERAGE", coveragePenalty],
    ["SINGLE_ERA_DOMINANCE", singleEraConcentrationPenalty]
  ]
    .filter(([, penalty]) => Number.isFinite(Number(penalty)) && Number(penalty) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] ?? "NONE"
  const featureReliefSignal =
    featureReliefCfg?.enabled === true
      ? clamp(
          Number(
            featureReliefCfg?.failedBreakoutWeight ??
              featureReliefCfg?.failedBreakoutPenaltyWeight ??
              0,
          ) * failedBreakoutReliefSignal +
            Number(featureReliefCfg?.gapContinueWeight ?? 0) * gapFillThenContinueScore -
            Number(
              featureReliefCfg?.gapRevertWeight ??
                featureReliefCfg?.gapRevertPenaltyWeight ??
                0,
            ) * gapFillThenRevertScore +
            Number(featureReliefCfg?.executionFeasibilityWeight ?? 0) *
              executionFeasibilityScore,
          0,
          1,
        )
      : 0
  const supportEvidenceWeightCoverage = Math.max(
    0,
    Number(featureReliefCfg?.eraCoverageWeightForSupportRelief ?? 0) || 0,
  )
  const supportEvidenceWeightEffectiveEra = Math.max(
    0,
    Number(featureReliefCfg?.effectiveEraCountWeightForSupportRelief ?? 0) || 0,
  )
  const supportEvidenceWeightEntropy = Math.max(
    0,
    Number(featureReliefCfg?.entropyWeightForSupportRelief ?? 0) || 0,
  )
  const supportEvidenceWeightSum =
    supportEvidenceWeightCoverage +
    supportEvidenceWeightEffectiveEra +
    supportEvidenceWeightEntropy
  const supportEvidenceFloorCoverage = clamp01(
    featureReliefCfg?.requireMinEraCoverageRatioForSupportRelief ?? 0,
  )
  const supportEvidenceFloorEffectiveEra = clamp01(
    featureReliefCfg?.requireMinEffectiveEraCountRatioForSupportRelief ?? 0,
  )
  const supportEvidenceFloorEntropy = clamp01(
    featureReliefCfg?.requireMinEntropyRatioForSupportRelief ?? 0,
  )
  const supportEvidenceMaxSingleEraShareExcess = clamp01(
    featureReliefCfg?.maxSingleEraShareExcessForSupportRelief ?? 1,
  )
  const allowSupportCountRelief =
    featureReliefCfg?.enabled === true &&
    supportCountPenaltyRaw > 0 &&
    (featureReliefCfg?.requireLowSupportCountOnly !== true ||
      resolvedEraSupportPenaltyReasonRaw === "LOW_SUPPORT_COUNT")
  const supportEvidenceReliefSignal =
    allowSupportCountRelief &&
    supportEvidenceWeightSum > 0 &&
    singleEraEvidence.coverageRatioToTarget >= supportEvidenceFloorCoverage &&
    singleEraEvidence.effectiveEraCountRatio >= supportEvidenceFloorEffectiveEra &&
    singleEraEvidence.entropyRatio >= supportEvidenceFloorEntropy &&
    singleEraShareExcess <= supportEvidenceMaxSingleEraShareExcess
      ? clamp(
          (
            supportEvidenceWeightCoverage * singleEraEvidence.coverageRatioToTarget +
            supportEvidenceWeightEffectiveEra * singleEraEvidence.effectiveEraCountRatio +
            supportEvidenceWeightEntropy * singleEraEvidence.entropyRatio
          ) / supportEvidenceWeightSum,
          0,
          1,
        )
      : 0
  const supportCountPenaltyReliefSignal = allowSupportCountRelief
    ? Math.max(featureReliefSignal, supportEvidenceReliefSignal)
    : 0
  const supportCountPenaltyRelief =
    supportCountPenaltyRaw *
    clamp01(featureReliefCfg?.maxSupportCountPenaltyReliefRatio ?? 0) *
    supportCountPenaltyReliefSignal
  const supportCountPenalty = Math.max(0, supportCountPenaltyRaw - supportCountPenaltyRelief)
  const stopRatePenaltyReliefSignal = allowSupportCountRelief
    ? supportCountPenaltyReliefSignal *
      clamp01(
        1 -
          stopRate3d /
            Math.max(1e-6, Number(featureReliefCfg?.stopRateReliefStopRateCap ?? 0.4) || 0.4),
      )
    : 0
  const stopRatePenaltyRelief =
    stopRatePenaltyRaw *
    clamp01(featureReliefCfg?.maxStopRatePenaltyReliefRatio ?? 0) *
    stopRatePenaltyReliefSignal
  const stopRatePenalty = Math.max(0, stopRatePenaltyRaw - stopRatePenaltyRelief)
  const finalScore =
    base +
    qualityBonus +
    winRateBonus +
    targetRateBonus +
    expectedRetBonus -
    stopRatePenalty -
    antiPenalty +
    eraCoverageBonus -
    coveragePenalty -
    singleEraConcentrationPenalty -
    supportCountPenalty

  return {
    baseScore: base,
    finalScore,
    qualityBonus,
    winRateBonus,
    targetRateBonus,
    stopRatePenalty,
    stopRatePenaltyRaw,
    stopRatePenaltyRelief,
    stopRatePenaltyReliefSignal,
    antiPenalty,
    expectedRetBonus,
    eraCoverageBonus,
    coveragePenalty,
    supportCountPenalty,
    supportCountPenaltyRaw,
    supportCountPenaltyRelief,
    supportCountPenaltyReliefSignal,
    singleEraConcentrationPenaltyRaw,
    singleEraConcentrationPenaltyRelief,
    singleEraConcentrationPenaltyEvidenceRatio: singleEraEvidence.evidenceRatio,
    singleEraConcentrationPenalty,
    singleEraPenalty: singleEraConcentrationPenalty,
    lowEraSupportPenalty: supportCountPenalty,
    qualityScore,
    antiScore,
    baseQualityScore,
    baseAntiScore,
    commonAlignmentScore,
    clusterSignature,
    expectedNetRet3d,
    winRate3d,
    targetRate3d,
    stopRate3d,
    qualityTrades,
    contrastiveSamples,
    contrastivePosRate,
    contrastiveNegRate,
    contrastiveLift,
    selectedEraId,
    clusterTemporalEraSupportCount,
    clusterTemporalEraCoverageRatio,
    targetEraCoverageRatio,
    clusterTemporalDominantEraId,
    clusterTemporalDominantEraShare,
    clusterTemporalMaxSingleEraShare,
    clusterTemporalEffectiveSingleEraShare: singleEraEvidence.effectiveSingleEraShare,
    clusterTemporalSingleEraEvidenceCoverageRatio: singleEraEvidence.coverageRatioToTarget,
    clusterTemporalSingleEraEvidenceSupportRatio: singleEraEvidence.supportCountRatio,
    clusterTemporalEffectiveEraCount,
    clusterTemporalNormalizedEraEntropy,
    clusterTemporalSingleEraEvidenceEffectiveEraCountRatio:
      singleEraEvidence.effectiveEraCountRatio,
    clusterTemporalSingleEraEvidenceEntropyRatio: singleEraEvidence.entropyRatio,
    maxSingleEraShareCap,
    minEraSupportCount,
    eraSupportShortfall,
    eraCoverageShortfall,
    singleEraShareExcess,
    eraSupportPenaltyReasonRaw: resolvedEraSupportPenaltyReasonRaw,
    eraSupportPenaltyReason: resolvedEraSupportPenaltyReason,
    clusterTemporalEraSupportMin,
    clusterTemporalEraSupportMedian,
    clusterTemporalEraWinRateStd,
    clusterTemporalEraExpectedNetRetStd,
    clusterTemporalEraContrastiveLiftStd,
    failedBreakoutCount20,
    gapFillThenContinueScore,
    gapFillThenRevertScore,
    executionFeasibilityScore,
    prototypeFailedBreakoutCount20,
    prototypeGapFillThenContinueScore,
    prototypeGapFillThenRevertScore,
    prototypeExecutionFeasibilityScore
  }
}

export const applyExecutionPriorAdjust = ({
  score,
  slippageRisk,
  avgTradingValue20dKrw,
  orderProfile,
  executionFeasibilityScore,
  cfg
}) => {
  const baseScore = Number(score ?? 0)
  const safeCfg = cfg?.executionPrior ?? cfg ?? {}
  const resolvedExecutionFeasibilityScore = clamp01(executionFeasibilityScore ?? 0)
  if (safeCfg?.enabled !== true) {
    return {
      baseScore,
      finalScore: baseScore,
      lowFillPenalty: 0,
      lowFillPenaltyRaw: 0,
      lowFillPenaltyRelief: 0,
      slippagePenalty: 0,
      slippagePenaltyRaw: 0,
      slippagePenaltyRelief: 0,
      lowLiquidityPenalty: 0,
      lowLiquidityPenaltyRaw: 0,
      lowLiquidityPenaltyRelief: 0,
      blockedOrderPenalty: 0,
      positiveAfterCostBonus: 0,
      negativeAfterCostPenalty: 0,
      executionFeasibilityScore: resolvedExecutionFeasibilityScore
    }
  }

  const fillProb = clamp01(orderProfile?.fillProb ?? 1)
  const minFillProb = clamp01(safeCfg?.minFillProb ?? 0.78)
  const lowFillPenaltyRaw =
    fillProb < minFillProb && minFillProb > 0
      ? Number(safeCfg?.lowFillPenaltyWeight ?? 0) *
        clamp((minFillProb - fillProb) / minFillProb, 0, 1)
      : 0

  const slippageRiskValue = Math.max(0, Number(slippageRisk ?? 0) || 0)
  const highSlippageRisk = Math.max(0, Number(safeCfg?.highSlippageRisk ?? 0.14) || 0.14)
  const slippagePenaltyRaw =
    slippageRiskValue > highSlippageRisk
      ? Number(safeCfg?.slippagePenaltyWeight ?? 0) *
        clamp(
          (slippageRiskValue - highSlippageRisk) / Math.max(1e-6, 1 - highSlippageRisk),
          0,
          1,
        )
      : 0

  const avgTradingValue = Math.max(0, Number(avgTradingValue20dKrw ?? 0) || 0)
  const lowLiquidityFloor = Math.max(
    0,
    Number(safeCfg?.lowLiquidityMinAvgTradingValue20dKrw ?? 0) || 0,
  )
  const lowLiquidityPenaltyRaw =
    avgTradingValue > 0 && lowLiquidityFloor > 0 && avgTradingValue < lowLiquidityFloor
      ? Number(safeCfg?.lowLiquidityPenaltyWeight ?? 0) *
        clamp(1 - avgTradingValue / lowLiquidityFloor, 0, 1)
      : 0
  const lowFillPenaltyRelief =
    lowFillPenaltyRaw *
    clamp01(safeCfg?.feasibilityLowFillReliefWeight ?? 0) *
    resolvedExecutionFeasibilityScore
  const slippagePenaltyRelief =
    slippagePenaltyRaw *
    clamp01(safeCfg?.feasibilitySlippageReliefWeight ?? 0) *
    resolvedExecutionFeasibilityScore
  const lowLiquidityPenaltyRelief =
    lowLiquidityPenaltyRaw *
    clamp01(safeCfg?.feasibilityLiquidityReliefWeight ?? 0) *
    resolvedExecutionFeasibilityScore
  const lowFillPenalty = Math.max(0, lowFillPenaltyRaw - lowFillPenaltyRelief)
  const slippagePenalty = Math.max(0, slippagePenaltyRaw - slippagePenaltyRelief)
  const lowLiquidityPenalty = Math.max(0, lowLiquidityPenaltyRaw - lowLiquidityPenaltyRelief)

  const blockedOrderPenalty =
    String(orderProfile?.decision ?? "ALLOW").trim().toUpperCase() === "BLOCK"
      ? Number(safeCfg?.blockedOrderPenaltyWeight ?? 0) || 0
      : 0

  const afterCostExpectancy = Number(orderProfile?.afterCostExpectancy ?? 0)
  const afterCostScale = Math.max(1e-6, Number(safeCfg?.afterCostScale ?? 0.08) || 0.08)
  const positiveAfterCostBonus =
    afterCostExpectancy > 0
      ? Number(safeCfg?.positiveAfterCostBonusWeight ?? 0) *
        clamp(afterCostExpectancy / afterCostScale, 0, 1)
      : 0
  const negativeAfterCostPenalty =
    afterCostExpectancy < 0
      ? Number(safeCfg?.negativeAfterCostPenaltyWeight ?? 0) *
        clamp(Math.abs(afterCostExpectancy) / afterCostScale, 0, 1)
      : 0

  const finalScore =
    baseScore +
    positiveAfterCostBonus -
    lowFillPenalty -
    slippagePenalty -
    lowLiquidityPenalty -
    blockedOrderPenalty -
    negativeAfterCostPenalty

  return {
    baseScore,
    finalScore,
    lowFillPenalty,
    lowFillPenaltyRaw,
    lowFillPenaltyRelief,
    slippagePenalty,
    slippagePenaltyRaw,
    slippagePenaltyRelief,
    lowLiquidityPenalty,
    lowLiquidityPenaltyRaw,
    lowLiquidityPenaltyRelief,
    blockedOrderPenalty,
    positiveAfterCostBonus,
    negativeAfterCostPenalty,
    executionFeasibilityScore: resolvedExecutionFeasibilityScore
  }
}

export const selectPickByGate = ({ top, gateCfg }) => {
  const rows = Array.isArray(top) ? top : []
  if (!rows.length) {
    return {
      pick: null,
      gateReason: "NO_CANDIDATE",
      scoreMargin: null
    }
  }

  const top1 = rows[0]
  const top2 = rows[1] ?? null
  const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
  const top2Score = Number(top2?.finalScore ?? top2?.score ?? 0)
  const explicitMargin = num(top1?.gateScoreMargin ?? top1?.rawScoreMargin ?? top1?.scoreMargin)
  const scoreMargin = Number.isFinite(explicitMargin)
    ? explicitMargin
    : (top2 ? top1Score - top2Score : Number.POSITIVE_INFINITY)

  if (top1Score < Number(gateCfg?.minFinalScore ?? 0)) {
    return { pick: null, gateReason: "SCORE_BELOW_MIN", scoreMargin }
  }
  if (
    gateCfg?.useMinScoreMarginGate !== false &&
    scoreMargin < Number(gateCfg?.minScoreMargin ?? 0)
  ) {
    return { pick: null, gateReason: "SCORE_MARGIN_LOW", scoreMargin }
  }
  const maxScoreMargin = num(gateCfg?.maxScoreMargin)
  if (
    gateCfg?.useMaxScoreMarginGate !== false &&
    Number.isFinite(maxScoreMargin) &&
    Number.isFinite(scoreMargin) &&
    scoreMargin > maxScoreMargin
  ) {
    return { pick: null, gateReason: "SCORE_MARGIN_HIGH", scoreMargin }
  }
  const reason = evaluateRowGate({ row: top1, gateCfg })
  if (reason !== "TRADE") {
    return { pick: null, gateReason: reason, scoreMargin }
  }
  return { pick: top1, gateReason: "TRADE", scoreMargin }
}

const calcTargetDelta = ({ row, cfg }) => {
  const deltaCfg = cfg?.delta ?? {}
  const targetRate3d = Number(row?.targetRate3d ?? 0)
  const stopRate3d = Number(row?.stopRate3d ?? 0)
  const edge = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const pHitCalibrated = Number(row?.calibrated?.pHitCalibrated ?? 0)
  const pStopFirstCalibrated = Number(row?.calibrated?.pStopFirstCalibrated ?? 0)
  const qualityScore = Number(row?.qualityScore ?? 0)
  const antiScore = Number(row?.antiScore ?? 0)
  const clusterTemporalEraCoverageRatio = clamp01(row?.clusterTemporalEraCoverageRatio ?? 0)
  const clusterTemporalEffectiveSingleEraShare = clamp01(
    row?.clusterTemporalEffectiveSingleEraShare ?? row?.clusterTemporalMaxSingleEraShare ?? 0,
  )
  const clusterTemporalEraSupportCount = Math.max(
    0,
    Number(row?.clusterTemporalEraSupportCount ?? 0) || 0,
  )
  const failedBreakoutCount20 = Math.max(0, Number(row?.failedBreakoutCount20 ?? 0) || 0)
  const gapFillThenContinueScore = clamp01(row?.gapFillThenContinueScore ?? 0)
  const gapFillThenRevertScore = clamp01(row?.gapFillThenRevertScore ?? 0)
  const executionFeasibilityScore = clamp01(row?.executionFeasibilityScore ?? 0)
  const failedBreakoutScale = Math.max(
    1,
    Number(deltaCfg?.failedBreakoutScale ?? cfg?.failedBreakoutScale ?? 4) || 4,
  )
  const failedBreakoutPenalty = clamp(failedBreakoutCount20 / failedBreakoutScale, 0, 1)
  let temporalStabilityDelta = 0
  const temporalStabilityCfg = cfg?.temporalStability ?? {}
  if (temporalStabilityCfg?.enabled === true) {
    const targetEraCoverageRatio = clamp01(
      temporalStabilityCfg?.targetEraCoverageRatio ?? 0.5,
    )
    temporalStabilityDelta +=
      Number(temporalStabilityCfg?.eraCoverageWeight ?? 0) *
      clamp(
        (clusterTemporalEraCoverageRatio - targetEraCoverageRatio) /
          Math.max(1e-6, 1 - targetEraCoverageRatio),
        -1,
        1,
      )
    const maxSingleEraShareCap = clamp01(
      temporalStabilityCfg?.maxSingleEraShare ?? 0.75,
    )
    if (clusterTemporalEffectiveSingleEraShare > maxSingleEraShareCap) {
      temporalStabilityDelta -=
        Number(temporalStabilityCfg?.singleEraPenaltyWeight ?? 0) *
        clamp(
          (clusterTemporalEffectiveSingleEraShare - maxSingleEraShareCap) /
            Math.max(1e-6, 1 - maxSingleEraShareCap),
          0,
          1,
        )
    }
    const minEraSupportCount = Math.max(
      0,
      Math.floor(Number(temporalStabilityCfg?.minEraSupportCount ?? 0) || 0),
    )
    if (minEraSupportCount > 0 && clusterTemporalEraSupportCount < minEraSupportCount) {
      temporalStabilityDelta -=
        Number(temporalStabilityCfg?.lowEraSupportPenaltyWeight ?? 0) *
        clamp(
          (minEraSupportCount - clusterTemporalEraSupportCount) /
            Math.max(1, minEraSupportCount),
          0,
          1,
        )
    }
  }
  return (
    Number(deltaCfg?.targetStopEdgeWeight ?? 0) * edge +
    Number(deltaCfg?.expectedRetWeight ?? 0) * expectedNetRet3d +
    Number(deltaCfg?.hitMinusStopWeight ?? 0) * (pHitCalibrated - pStopFirstCalibrated) +
    Number(deltaCfg?.qualityWeight ?? 0) * qualityScore -
    Number(deltaCfg?.stopRatePenaltyWeight ?? 0) * stopRate3d -
    Number(deltaCfg?.antiPenaltyWeight ?? 0) * antiScore -
    Number(deltaCfg?.failedBreakoutPenaltyWeight ?? 0) * failedBreakoutPenalty +
    Number(deltaCfg?.gapContinueWeight ?? 0) * gapFillThenContinueScore -
    Number(deltaCfg?.gapRevertPenaltyWeight ?? 0) * gapFillThenRevertScore +
    Number(deltaCfg?.executionFeasibilityWeight ?? 0) * executionFeasibilityScore +
    temporalStabilityDelta
  )
}

const calcRerankUtility = ({ row, cfg }) => {
  const objectiveMode = normalizeTop1RerankObjectiveMode(cfg?.objectiveMode)
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const baseScore = Number(row?.baseScore ?? row?.finalScore ?? row?.score ?? 0)
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const qualityScore = Number(row?.qualityScore ?? 0)
  const winRate3d = Number(row?.winRate3d ?? 0)
  const commonAlignmentScore = Number(row?.commonAlignmentScore ?? 0)
  const antiScore = Number(row?.antiScore ?? 0)
  const targetRate3d = Number(row?.targetRate3d ?? 0)
  const stopRate3d = Number(row?.stopRate3d ?? 0)
  const stageGlobal = Number(row?.stageScores?.global ?? 0)
  const stageLocal = Number(row?.stageScores?.local ?? 0)
  const stageTrigger = Number(row?.stageScores?.trigger ?? 0)
  const pHitCalibrated = Number(row?.calibrated?.pHitCalibrated ?? 0)
  const pStopFirstCalibrated = Number(row?.calibrated?.pStopFirstCalibrated ?? 0)
  const pFillCalibrated = Number(row?.calibrated?.pFillCalibrated ?? 0)
  const scoreMargin = Number(row?.scoreMargin ?? 0)
  const slippageRisk = Number(row?.slippageRisk ?? 0)
  const avgTradingValue20dKrw = Number(row?.avgTradingValue20dKrw ?? 0)
  const failedBreakoutCount20 = Math.max(0, Number(row?.failedBreakoutCount20 ?? 0) || 0)
  const gapFillThenContinueScore = clamp01(row?.gapFillThenContinueScore ?? 0)
  const gapFillThenRevertScore = clamp01(row?.gapFillThenRevertScore ?? 0)
  const executionFeasibilityScore = clamp01(row?.executionFeasibilityScore ?? 0)
  const failedBreakoutScale = Math.max(1, Number(cfg?.failedBreakoutScale ?? 4) || 4)
  const failedBreakoutPenalty = clamp(failedBreakoutCount20 / failedBreakoutScale, 0, 1)
  const clusterTemporalEraSupportCount = Math.max(
    0,
    Number(row?.clusterTemporalEraSupportCount ?? 0) || 0,
  )
  const clusterTemporalEraCoverageRatio = clamp01(
    row?.clusterTemporalEraCoverageRatio ?? 0,
  )
  const clusterTemporalEffectiveSingleEraShare = clamp01(
    row?.clusterTemporalEffectiveSingleEraShare ?? row?.clusterTemporalMaxSingleEraShare ?? 0,
  )
  const regimeTag = String(row?.regimeTag ?? "")
  const backbone =
    Number(cfg?.finalScoreWeight ?? 0) * finalScore +
    Number(cfg?.baseScoreWeight ?? 0) * baseScore
  const targetDelta = calcTargetDelta({ row, cfg })
  if (objectiveMode === "backbone_plus_target_delta") {
    return {
      objectiveMode,
      backbone,
      delta: targetDelta,
      utility: backbone + targetDelta
    }
  }
  let liquidityPenalty = 0
  if (cfg?.liquidityPenaltyEnabled !== false) {
    const minLiquidityValue = Math.max(0, Number(cfg?.minAvgTradingValue20dKrw ?? 0) || 0)
    const midBandRatio = Math.max(1, Number(cfg?.midLiquidityBandRatio ?? 1) || 1)
    const lowPenaltyWeight = Math.max(0, Number(cfg?.lowLiquidityPenaltyWeight ?? 0) || 0)
    const midPenaltyWeight = Math.max(0, Number(cfg?.midLiquidityPenaltyWeight ?? 0) || 0)
    const liqLowTagPenaltyWeight = Math.max(0, Number(cfg?.liqLowTagPenaltyWeight ?? 0) || 0)
    const liqMidTagPenaltyWeight = Math.max(0, Number(cfg?.liqMidTagPenaltyWeight ?? 0) || 0)
    if (regimeTag.includes("_LIQ_LOW")) {
      liquidityPenalty += liqLowTagPenaltyWeight
    } else if (regimeTag.includes("_LIQ_MID")) {
      liquidityPenalty += liqMidTagPenaltyWeight
    }
    if (Number.isFinite(avgTradingValue20dKrw) && avgTradingValue20dKrw > 0 && minLiquidityValue > 0) {
      if (avgTradingValue20dKrw < minLiquidityValue) {
        const deficitRatio = 1 - (avgTradingValue20dKrw / minLiquidityValue)
        liquidityPenalty += lowPenaltyWeight * clamp(deficitRatio, 0, 1)
      } else if (midBandRatio > 1) {
        const midUpper = minLiquidityValue * midBandRatio
        if (avgTradingValue20dKrw < midUpper) {
          const proximity = 1 - ((avgTradingValue20dKrw - minLiquidityValue) / (midUpper - minLiquidityValue))
          liquidityPenalty += midPenaltyWeight * clamp(proximity, 0, 1)
        }
      }
    }
  }
  let temporalStabilityAdjustment = 0
  const temporalStabilityCfg = cfg?.temporalStability ?? {}
  if (temporalStabilityCfg?.enabled === true) {
    const targetEraCoverageRatio = clamp01(
      temporalStabilityCfg?.targetEraCoverageRatio ?? 0.5,
    )
    temporalStabilityAdjustment +=
      Number(temporalStabilityCfg?.eraCoverageWeight ?? 0) *
      clamp(
        (clusterTemporalEraCoverageRatio - targetEraCoverageRatio) /
          Math.max(1e-6, 1 - targetEraCoverageRatio),
        -1,
        1,
      )
    const maxSingleEraShareCap = clamp01(
      temporalStabilityCfg?.maxSingleEraShare ?? 0.75,
    )
    if (clusterTemporalEffectiveSingleEraShare > maxSingleEraShareCap) {
      temporalStabilityAdjustment -=
        Number(temporalStabilityCfg?.singleEraPenaltyWeight ?? 0) *
        clamp(
          (clusterTemporalEffectiveSingleEraShare - maxSingleEraShareCap) /
            Math.max(1e-6, 1 - maxSingleEraShareCap),
          0,
          1,
        )
    }
    const minEraSupportCount = Math.max(
      0,
      Math.floor(Number(temporalStabilityCfg?.minEraSupportCount ?? 0) || 0),
    )
    if (minEraSupportCount > 0 && clusterTemporalEraSupportCount < minEraSupportCount) {
      temporalStabilityAdjustment -=
        Number(temporalStabilityCfg?.lowEraSupportPenaltyWeight ?? 0) *
        clamp(
          (minEraSupportCount - clusterTemporalEraSupportCount) /
            Math.max(1, minEraSupportCount),
          0,
          1,
        )
    }
  }
  let overconfidencePenalty = 0
  let scoreMarginBandPenalty = 0
  const scoreMarginBandCfg = cfg?.scoreMarginBand ?? {}
  if (scoreMarginBandCfg?.enabled === true) {
    const minPreferredMargin = Math.max(
      0,
      Number(scoreMarginBandCfg?.minPreferredMargin ?? 0.009) || 0.009,
    )
    const maxPreferredMargin = Math.max(
      minPreferredMargin,
      Number(scoreMarginBandCfg?.maxPreferredMargin ?? 0.013) || 0.013,
    )
    if (scoreMargin < minPreferredMargin) {
      const lowMarginScale = Math.max(
        1e-6,
        Number(scoreMarginBandCfg?.lowMarginScale ?? 0.004) || 0.004,
      )
      scoreMarginBandPenalty +=
        Number(scoreMarginBandCfg?.lowMarginPenaltyWeight ?? 0) *
        clamp((minPreferredMargin - scoreMargin) / lowMarginScale, 0, 1)
    } else if (scoreMargin > maxPreferredMargin) {
      const highMarginScale = Math.max(
        1e-6,
        Number(scoreMarginBandCfg?.highMarginScale ?? 0.008) || 0.008,
      )
      scoreMarginBandPenalty +=
        Number(scoreMarginBandCfg?.highMarginPenaltyWeight ?? 0) *
        clamp((scoreMargin - maxPreferredMargin) / highMarginScale, 0, 1)
    }
  }
  const overconfidenceCfg = cfg?.overconfidencePenalty ?? {}
  if (overconfidenceCfg?.enabled === true) {
    const highScoreMarginThreshold = Math.max(
      0,
      Number(overconfidenceCfg?.highScoreMarginThreshold ?? 0.017) || 0.017,
    )
    if (scoreMargin > highScoreMarginThreshold) {
      const highScoreMarginScale = Math.max(
        1e-6,
        Number(overconfidenceCfg?.highScoreMarginScale ?? 0.008) || 0.008,
      )
      overconfidencePenalty =
        Number(overconfidenceCfg?.highScoreMarginPenaltyWeight ?? 0) *
        clamp((scoreMargin - highScoreMarginThreshold) / highScoreMarginScale, 0, 1)
    }
  }
  const utility =
    Number(cfg?.finalScoreWeight ?? 0) * finalScore +
    Number(cfg?.baseScoreWeight ?? 0) * baseScore +
    Number(cfg?.expectedRetWeight ?? 0) * expectedNetRet3d +
    Number(cfg?.qualityWeight ?? 0) * qualityScore +
    Number(cfg?.winRateWeight ?? 0) * winRate3d +
    Number(cfg?.commonAlignmentWeight ?? 0) * commonAlignmentScore -
    Number(cfg?.antiScorePenaltyWeight ?? 0) * antiScore +
    Number(cfg?.targetRateWeight ?? 0) * targetRate3d -
    Number(cfg?.stopRatePenaltyWeight ?? 0) * stopRate3d +
    Number(cfg?.pHitWeight ?? 0) * pHitCalibrated -
    Number(cfg?.pStopFirstPenaltyWeight ?? 0) * pStopFirstCalibrated +
    Number(cfg?.fillProbWeight ?? 0) * pFillCalibrated +
    Number(cfg?.scoreMarginWeight ?? 0) * scoreMargin -
    Number(cfg?.failedBreakoutPenaltyWeight ?? 0) * failedBreakoutPenalty +
    Number(cfg?.gapContinueWeight ?? 0) * gapFillThenContinueScore -
    Number(cfg?.gapRevertPenaltyWeight ?? 0) * gapFillThenRevertScore +
    Number(cfg?.executionFeasibilityWeight ?? 0) * executionFeasibilityScore -
    scoreMarginBandPenalty -
    overconfidencePenalty -
    Number(cfg?.slippageRiskPenaltyWeight ?? 0) * slippageRisk +
    -liquidityPenalty +
    temporalStabilityAdjustment +
    Number(cfg?.stageGlobalWeight ?? 0) * stageGlobal +
    Number(cfg?.stageLocalWeight ?? 0) * stageLocal +
    Number(cfg?.stageTriggerWeight ?? 0) * stageTrigger
  return {
    objectiveMode,
    backbone,
    delta: targetDelta,
    utility
  }
}

export const rerankTopForTop1 = ({ top, gateCfg }) => {
  const rows = Array.isArray(top) ? top.slice() : []
  const cfg = gateCfg?.top1Rerank ?? {}
  if (cfg?.enabled !== true || rows.length < 2) {
    return {
      top: rows,
      applied: false,
      reason: "DISABLED",
      fromRank: 1,
      toRank: 1
    }
  }

  const poolSize = Math.min(rows.length, Math.max(2, Number(cfg?.candidatePool ?? 3) || 3))
  const maxTargetRank = Math.max(2, Number(cfg?.maxTargetRank ?? poolSize) || poolSize)
  const pool = rows.slice(0, poolSize)
  const first = pool[0]
  const firstScore = Number(first?.finalScore ?? first?.score ?? 0)
  const firstEval = calcRerankUtility({ row: first, cfg })
  const objectiveMode = firstEval?.objectiveMode ?? "legacy_blended"
  const firstUtility = Number(firstEval?.utility ?? 0)

  let bestIdx = 0
  let bestEval = firstEval
  let bestUtility = firstUtility
  const swapVetoCfg = cfg?.swapVeto ?? {}
  const swapVetoEnabled = swapVetoCfg?.enabled === true
  let swapRejectedReason = null
  for (let i = 1; i < pool.length; i += 1) {
    const candidateRank = i + 1
    if (candidateRank > maxTargetRank) continue
    const row = pool[i]
    const rowScore = Number(row?.finalScore ?? row?.score ?? 0)
    const margin = firstScore - rowScore
    if (!Number.isFinite(margin) || margin > Number(cfg?.maxSwapMargin ?? 0.008)) continue
    if (swapVetoEnabled) {
      const firstExpectedRet = Number(first?.expectedNetRet3d ?? 0)
      const candidateExpectedRet = Number(row?.expectedNetRet3d ?? 0)
      const firstQuality = Number(first?.qualityScore ?? 0)
      const candidateQuality = Number(row?.qualityScore ?? 0)
      const firstAnti = Number(first?.antiScore ?? 0)
      const candidateAnti = Number(row?.antiScore ?? 0)
      const expectedRetGain = candidateExpectedRet - firstExpectedRet
      const qualityDrop = firstQuality - candidateQuality
      const antiIncrease = candidateAnti - firstAnti
      const maxExpectedRetGain = Number(swapVetoCfg?.maxExpectedRetGain ?? Number.POSITIVE_INFINITY)
      const minQualityDrop = Number(swapVetoCfg?.minQualityDrop ?? Number.POSITIVE_INFINITY)
      const minAntiIncrease = Number(swapVetoCfg?.minAntiIncrease ?? Number.POSITIVE_INFINITY)
      if (
        expectedRetGain <= maxExpectedRetGain &&
        qualityDrop >= minQualityDrop &&
        antiIncrease >= minAntiIncrease
      ) {
        swapRejectedReason = "SWAP_VETO_ANTI_QUALITY"
        continue
      }
    }
    const rowEval = calcRerankUtility({ row, cfg })
    const utility = Number(rowEval?.utility ?? 0)
    if (utility > bestUtility) {
      bestIdx = i
      bestEval = rowEval
      bestUtility = utility
    }
  }

  if (bestIdx <= 0) {
    return {
      top: rows,
      applied: false,
      reason: "TOP1_STABLE",
      fromRank: 1,
      toRank: 1,
      objectiveMode,
      swapRejectedReason
    }
  }
  const utilityGain = bestUtility - firstUtility
  const compositeUtilityGain =
    Number(bestEval?.utility ?? 0) - Number(firstEval?.utility ?? 0)
  const deltaGain =
    Number(bestEval?.delta ?? 0) - Number(firstEval?.delta ?? 0)
  if (!Number.isFinite(utilityGain) || utilityGain < Number(cfg?.minUtilityGain ?? 0)) {
    return {
      top: rows,
      applied: false,
      reason: "UTILITY_GAIN_LOW",
      fromRank: 1,
      toRank: 1,
      poolSize,
      firstUtility,
      selectedUtility: bestUtility,
      utilityGain,
      objectiveMode,
      swapRejectedReason,
      firstBackbone: Number(firstEval?.backbone ?? 0),
      selectedBackbone: Number(bestEval?.backbone ?? 0),
      firstDelta: Number(firstEval?.delta ?? 0),
      selectedDelta: Number(bestEval?.delta ?? 0),
      deltaGain,
      compositeUtilityGain
    }
  }

  const selected = pool[bestIdx]
  const reordered = [selected]
    .concat(pool.filter((_, idx) => idx !== bestIdx))
    .concat(rows.slice(poolSize))

  return {
    top: reordered,
    applied: true,
    reason: "UTILITY_SWAP",
    fromRank: 1,
    toRank: bestIdx + 1,
    poolSize,
    firstUtility,
    selectedUtility: bestUtility,
    utilityGain,
    objectiveMode,
    swapRejectedReason,
    firstBackbone: Number(firstEval?.backbone ?? 0),
    selectedBackbone: Number(bestEval?.backbone ?? 0),
    firstDelta: Number(firstEval?.delta ?? 0),
    selectedDelta: Number(bestEval?.delta ?? 0),
    deltaGain,
    compositeUtilityGain
  }
}

export const applyTop1MicroCorrection = ({ top, gateCfg }) => {
  const rows = Array.isArray(top) ? top.slice() : []
  const cfg = gateCfg?.top1MicroCorrection ?? {}
  if (cfg?.enabled !== true || rows.length < 2) {
    return {
      top: rows,
      applied: false,
      reason: "DISABLED",
      mode: cfg?.mode ?? null,
      fromRank: 1,
      toRank: 1
    }
  }

  const poolSize = Math.min(rows.length, Math.max(2, Number(cfg?.candidatePool ?? 3) || 3))
  const pool = rows.slice(0, poolSize)
  const top1 = pool[0]
  const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
  const top1Fill = clamp01(top1?.pFillCalibrated ?? top1?.calibrated?.pFillCalibrated ?? 0)
  const top1PHit = clamp01(top1?.pHitCalibrated ?? top1?.calibrated?.pHitCalibrated ?? 0)
  const top1ExpectedNetRet3d = Number(top1?.expectedNetRet3d ?? 0)
  const top1QualityScore = clamp01(top1?.qualityScore ?? 0)
  const top1AntiScore = clamp01(top1?.antiScore ?? 0)
  const top1TargetRate3d = clamp01(top1?.targetRate3d ?? 0)
  const top1StopRate3d = clamp01(top1?.stopRate3d ?? 0)
  const top1TemporalShare = clamp01(
    top1?.clusterTemporalEffectiveSingleEraShare ?? top1?.clusterTemporalMaxSingleEraShare ?? 0,
  )
  const top1EraSupportMin = Math.max(0, Number(top1?.clusterTemporalEraSupportMin ?? 0) || 0)

  if (cfg?.mode === "target_first_tie_break") {
    let bestIdx = 0
    let bestCorrectionScore = Number.NEGATIVE_INFINITY
    let bestGap = 0
    let bestDiagnostics = null
    for (let i = 1; i < pool.length; i += 1) {
      const row = pool[i]
      const rowScore = Number(row?.finalScore ?? row?.score ?? 0)
      const scoreGap = top1Score - rowScore
      if (!Number.isFinite(scoreGap) || scoreGap > Number(cfg?.maxScoreGap ?? 0)) continue

      const antiAdvantage = top1AntiScore - clamp01(row?.antiScore ?? 0)
      if (antiAdvantage < Number(cfg?.minAntiAdvantage ?? 0)) continue

      const qualityAdvantage = clamp01(row?.qualityScore ?? 0) - top1QualityScore
      if (qualityAdvantage < Number(cfg?.minQualityAdvantage ?? 0)) continue

      const stopRateAdvantage = top1StopRate3d - clamp01(row?.stopRate3d ?? 0)
      if (stopRateAdvantage < Number(cfg?.minStopRateAdvantage ?? 0)) continue

      const expectedNetRetDrop = top1ExpectedNetRet3d - Number(row?.expectedNetRet3d ?? 0)
      if (expectedNetRetDrop > Number(cfg?.maxExpectedNetRetDrop ?? 0)) continue

      const targetRateDrop = top1TargetRate3d - clamp01(row?.targetRate3d ?? 0)
      if (targetRateDrop > Number(cfg?.maxTargetRateDrop ?? 0)) continue

      const temporalShareAdvantage =
        top1TemporalShare -
        clamp01(
          row?.clusterTemporalEffectiveSingleEraShare ?? row?.clusterTemporalMaxSingleEraShare ?? 0,
        )
      const eraSupportMinAdvantage =
        Math.max(0, Number(row?.clusterTemporalEraSupportMin ?? 0) || 0) - top1EraSupportMin

      if (
        temporalShareAdvantage < Number(cfg?.minTemporalShareAdvantage ?? 0) &&
        eraSupportMinAdvantage < Number(cfg?.minEraSupportMinAdvantage ?? 0)
      ) {
        continue
      }

      const correctionScore =
        antiAdvantage +
        qualityAdvantage +
        stopRateAdvantage +
        Math.max(0, temporalShareAdvantage) +
        Math.max(0, eraSupportMinAdvantage / 20) -
        Math.max(0, expectedNetRetDrop) -
        Math.max(0, targetRateDrop)

      if (correctionScore < Number(cfg?.minCorrectionScore ?? 0)) continue

      if (correctionScore > bestCorrectionScore) {
        bestIdx = i
        bestCorrectionScore = correctionScore
        bestGap = scoreGap
        bestDiagnostics = {
          antiAdvantage,
          qualityAdvantage,
          stopRateAdvantage,
          expectedNetRetDrop,
          targetRateDrop,
          temporalShareAdvantage,
          eraSupportMinAdvantage
        }
      }
    }

    if (bestIdx <= 0) {
      return {
        top: rows,
        applied: false,
        reason: "TOP1_STABLE",
        mode: cfg?.mode ?? null,
        fromRank: 1,
        toRank: 1,
        poolSize
      }
    }

    const selected = pool[bestIdx]
    const reordered = [selected]
      .concat(pool.filter((_, idx) => idx !== bestIdx))
      .concat(rows.slice(poolSize))
    return {
      top: reordered,
      applied: true,
      reason: "TARGET_FIRST_TIE_BREAK",
      mode: cfg?.mode ?? null,
      fromRank: 1,
      toRank: bestIdx + 1,
      poolSize,
      firstSymbol: String(top1?.symbol ?? "").trim() || null,
      selectedSymbol: String(selected?.symbol ?? "").trim() || null,
      scoreGap: bestGap,
      correctionScore: bestCorrectionScore,
      ...(bestDiagnostics ?? {})
    }
  }

  let bestIdx = 0
  let bestFill = top1Fill
  let bestPHit = top1PHit
  let bestScore = top1Score
  let bestGap = 0
  for (let i = 1; i < pool.length; i += 1) {
    const row = pool[i]
    const rowScore = Number(row?.finalScore ?? row?.score ?? 0)
    const scoreGap = top1Score - rowScore
    if (!Number.isFinite(scoreGap) || scoreGap > Number(cfg?.maxScoreGap ?? 0)) continue

    const rowFill = clamp01(row?.pFillCalibrated ?? row?.calibrated?.pFillCalibrated ?? 0)
    const fillAdvantage = rowFill - top1Fill
    if (fillAdvantage < Number(cfg?.minFillAdvantage ?? 0)) continue

    const rowPHit = clamp01(row?.pHitCalibrated ?? row?.calibrated?.pHitCalibrated ?? 0)
    const pHitDrop = top1PHit - rowPHit
    if (pHitDrop > Number(cfg?.maxPHitDrop ?? 0)) continue

    if (
      Math.abs(Number(row?.expectedNetRet3d ?? 0) - top1ExpectedNetRet3d) >
      Number(cfg?.maxExpectedNetRetDiff ?? 0)
    ) {
      continue
    }
    if (
      Math.abs(clamp01(row?.qualityScore ?? 0) - top1QualityScore) >
      Number(cfg?.maxQualityScoreDiff ?? 0)
    ) {
      continue
    }
    if (
      Math.abs(clamp01(row?.antiScore ?? 0) - top1AntiScore) >
      Number(cfg?.maxAntiScoreDiff ?? 0)
    ) {
      continue
    }
    if (
      Math.abs(clamp01(row?.targetRate3d ?? 0) - top1TargetRate3d) >
      Number(cfg?.maxTargetRateDiff ?? 0)
    ) {
      continue
    }
    if (
      Math.abs(clamp01(row?.stopRate3d ?? 0) - top1StopRate3d) >
      Number(cfg?.maxStopRateDiff ?? 0)
    ) {
      continue
    }

    if (
      rowFill > bestFill + 1e-12 ||
      (Math.abs(rowFill - bestFill) <= 1e-12 && rowPHit > bestPHit + 1e-12) ||
      (
        Math.abs(rowFill - bestFill) <= 1e-12 &&
        Math.abs(rowPHit - bestPHit) <= 1e-12 &&
        rowScore > bestScore + 1e-12
      )
    ) {
      bestIdx = i
      bestFill = rowFill
      bestPHit = rowPHit
      bestScore = rowScore
      bestGap = scoreGap
    }
  }

  if (bestIdx <= 0) {
    return {
      top: rows,
      applied: false,
      reason: "TOP1_STABLE",
      mode: cfg?.mode ?? null,
      fromRank: 1,
      toRank: 1,
      poolSize
    }
  }

  const selected = pool[bestIdx]
  const selectedFill = clamp01(selected?.pFillCalibrated ?? selected?.calibrated?.pFillCalibrated ?? 0)
  const selectedPHit = clamp01(selected?.pHitCalibrated ?? selected?.calibrated?.pHitCalibrated ?? 0)
  const reordered = [selected]
    .concat(pool.filter((_, idx) => idx !== bestIdx))
    .concat(rows.slice(poolSize))
  return {
    top: reordered,
    applied: true,
    reason: "STRONG_FILL_TIE_BREAK",
    mode: cfg?.mode ?? null,
    fromRank: 1,
    toRank: bestIdx + 1,
    poolSize,
    firstSymbol: String(top1?.symbol ?? "").trim() || null,
    selectedSymbol: String(selected?.symbol ?? "").trim() || null,
    firstFillProb: top1Fill,
    selectedFillProb: selectedFill,
    fillAdvantage: selectedFill - top1Fill,
    firstPHit: top1PHit,
    selectedPHit,
    pHitDrop: top1PHit - selectedPHit,
    scoreGap: bestGap
  }
}

const evaluateRowGate = ({ row, gateCfg }) => {
  const score = Number(row?.finalScore ?? row?.score ?? 0)
  if (score < Number(gateCfg?.minFinalScore ?? 0)) {
    return "SCORE_BELOW_MIN"
  }
  if (
    gateCfg?.requirePositiveExpectedNetRet3d === true &&
    Number(row?.expectedNetRet3d ?? 0) <= 0
  ) {
    return "EXPECTED_RET_NON_POSITIVE"
  }
  if (Number(row?.expectedNetRet3d ?? 0) < Number(gateCfg?.minExpectedNetRet3d ?? -1)) {
    return "EXPECTED_RET_LOW"
  }
  return "TRADE"
}

const evaluateSecondPickGate = ({ rows, gateCfg }) => {
  const mode = normalizeSecondPickMode(gateCfg?.secondPick?.mode)
  const top1 = rows?.[0] ?? null
  const top2 = rows?.[1] ?? null
  const top3 = rows?.[2] ?? null
  const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
  const top2Score = Number(top2?.finalScore ?? top2?.score ?? 0)
  const top3Score = Number(top3?.finalScore ?? top3?.score ?? 0)
  const firstSecondGap = top1 && top2 ? top1Score - top2Score : null
  const secondThirdMargin = top2 && top3 ? top2Score - top3Score : null
  const result = {
    mode,
    evaluated: false,
    accepted: false,
    rejectReason: null,
    shadowRejectReason: null,
    firstSecondGap: Number.isFinite(firstSecondGap) ? firstSecondGap : null,
    secondThirdMargin: Number.isFinite(secondThirdMargin) ? secondThirdMargin : null
  }
  if (!top1 || !top2 || mode === "disabled") return result

  const secondCfg = {
    minFinalScore: Number(gateCfg?.secondPick?.minFinalScore ?? gateCfg?.minFinalScore ?? 0),
    minExpectedNetRet3d: Number(
      gateCfg?.secondPick?.minExpectedNetRet3d ?? gateCfg?.minExpectedNetRet3d ?? -1,
    ),
    requirePositiveExpectedNetRet3d:
      gateCfg?.secondPick?.requirePositiveExpectedNetRet3d === true
  }
  result.evaluated = true

  let rejectReason = null
  const rowReason = evaluateRowGate({ row: top2, gateCfg: secondCfg })
  if (rowReason !== "TRADE") {
    rejectReason = `SECOND_${rowReason}`
  } else {
    const maxGapFromFirst = num(gateCfg?.secondPick?.maxGapFromFirst)
    if (
      !rejectReason &&
      Number.isFinite(maxGapFromFirst) &&
      Number.isFinite(firstSecondGap) &&
      firstSecondGap > maxGapFromFirst
    ) {
      rejectReason = "SECOND_GAP_FROM_FIRST_TOO_WIDE"
    }
    const minMarginVsThird = num(gateCfg?.secondPick?.minMarginVsThird)
    if (
      !rejectReason &&
      Number.isFinite(minMarginVsThird) &&
      top3 &&
      Number.isFinite(secondThirdMargin) &&
      secondThirdMargin < minMarginVsThird
    ) {
      rejectReason = "SECOND_MARGIN_VS_THIRD_LOW"
    }
  }

  if (rejectReason) {
    if (mode === "shadow") {
      result.accepted = true
      result.shadowRejectReason = rejectReason
      return result
    }
    result.accepted = false
    result.rejectReason = rejectReason
    return result
  }

  result.accepted = true
  return result
}

const evaluateCoverageRecovery = ({ top1, gateCfg, explorationCtx, scoreMargin }) => {
  const recoveryCfg = gateCfg?.coverageRecovery ?? {}
  if (recoveryCfg?.enabled !== true) return null
  const targetPickedCount = Math.max(0, Number(recoveryCfg?.targetPickedCount ?? 60) || 60)
  const currentPickedCount = Math.max(0, Number(explorationCtx?.pickedCount ?? 0) || 0)
  const pickedDays = Math.max(0, Number(explorationCtx?.pickedDays ?? 0) || 0)
  const recoveryDays = Math.max(0, Number(explorationCtx?.coverageRecoveryDays ?? 0) || 0)
  const recoveryHitDays = Math.max(0, Number(explorationCtx?.coverageRecoveryHitDays ?? 0) || 0)
  if (currentPickedCount >= targetPickedCount) return null
  const maxRecoveryShare = clamp(Number(recoveryCfg?.maxRecoveryShare ?? 0.25), 0, 1)
  if (pickedDays > 0 && recoveryDays / pickedDays >= maxRecoveryShare) {
    return null
  }
  const minObservedSamples = Math.max(0, Number(recoveryCfg?.minObservedSamples ?? 0) || 0)
  const minObservedHitRate = clamp01(recoveryCfg?.minObservedHitRate ?? 0)
  const observedHitRate = recoveryDays > 0 ? recoveryHitDays / recoveryDays : 0
  if (recoveryDays >= minObservedSamples && observedHitRate < minObservedHitRate) {
    return null
  }
  const minScoreMargin = Math.max(0, Number(gateCfg?.minScoreMargin ?? 0) || 0)
  const softenedMinScoreMargin = minScoreMargin * clamp(Number(recoveryCfg?.minScoreMarginRatio ?? 0.55), 0, 1)
  if (!Number.isFinite(scoreMargin) || scoreMargin < softenedMinScoreMargin) {
    return null
  }
  const recoveryGateCfg = {
    minFinalScore: Number(gateCfg?.minFinalScore ?? 0),
    minExpectedNetRet3d: Number(
      recoveryCfg?.minExpectedNetRet3d ?? gateCfg?.minExpectedNetRet3d ?? -1,
    ),
    requirePositiveExpectedNetRet3d:
      recoveryCfg?.requirePositiveExpectedNetRet3d === true ||
      gateCfg?.requirePositiveExpectedNetRet3d === true
  }
  const reason = evaluateRowGate({ row: top1, gateCfg: recoveryGateCfg })
  if (reason !== "TRADE") return null
  const minQualityScore = clamp01(recoveryCfg?.minQualityScore ?? 0.58)
  if (Number(top1?.qualityScore ?? 0) < minQualityScore) return null
  return {
    targetPickedCount,
    currentPickedCount,
    minScoreMargin,
    softenedMinScoreMargin,
    scoreMargin,
    minQualityScore,
    minExpectedNetRet3d: Number(recoveryGateCfg.minExpectedNetRet3d ?? -1),
    maxRecoveryShare,
    observedRecoveryDays: recoveryDays,
    observedRecoveryHitRate: observedHitRate,
    minObservedSamples,
    minObservedHitRate
  }
}

const evaluateScoreMarginHandoff = ({ top1, gateCfg, scoreMargin }) => {
  const handoffCfg = gateCfg?.coverageRecovery?.scoreMarginHandoff ?? {}
  if (handoffCfg?.enabled !== true) return null
  if (!Number.isFinite(Number(scoreMargin))) return null
  const minScoreMargin = Math.max(0, Number(gateCfg?.minScoreMargin ?? 0) || 0)
  const minAllowedScoreMargin =
    minScoreMargin * clamp(Number(handoffCfg?.minScoreMarginFloorRatio ?? 0.3), 0, 1)
  if (scoreMargin < minAllowedScoreMargin) return null
  const finalScore = Number(top1?.finalScore ?? top1?.score ?? 0)
  const expectedNetRet3d = Number(top1?.expectedNetRet3d ?? 0)
  const qualityScore = clamp01(top1?.qualityScore ?? 0)
  const antiScore = clamp01(top1?.antiScore ?? 0)
  const fillProb = clamp01(top1?.calibrated?.pFillCalibrated ?? 0)
  const slippageRisk = Math.max(0, Number(top1?.slippageRisk ?? 0) || 0)
  const targetStopEdge3d =
    Number(top1?.targetRate3d ?? 0) - Number(top1?.stopRate3d ?? 0)
  if (finalScore < Number(handoffCfg?.minFinalScore ?? 0)) return null
  if (qualityScore < Number(handoffCfg?.minQualityScore ?? 0)) return null
  if (fillProb < Number(handoffCfg?.minFillProb ?? 0)) return null
  if (
    Number.isFinite(Number(handoffCfg?.maxSlippageRisk)) &&
    slippageRisk > Number(handoffCfg.maxSlippageRisk)
  ) {
    return null
  }
  if (
    Number.isFinite(Number(handoffCfg?.maxAntiScore)) &&
    antiScore > Number(handoffCfg.maxAntiScore)
  ) {
    return null
  }
  if (
    handoffCfg?.requirePositiveExpectedNetRet3d === true &&
    !(expectedNetRet3d > 0)
  ) {
    return null
  }
  if (expectedNetRet3d < Number(handoffCfg?.minExpectedNetRet3d ?? -1)) return null
  if (
    Number.isFinite(Number(handoffCfg?.minTargetStopEdge3d)) &&
    targetStopEdge3d < Number(handoffCfg.minTargetStopEdge3d)
  ) {
    return null
  }
  return {
    scoreMargin,
    minScoreMargin,
    minAllowedScoreMargin,
    minScoreMarginFloorRatio: Number(handoffCfg?.minScoreMarginFloorRatio ?? 0.3),
    finalScore,
    minFinalScore: Number(handoffCfg?.minFinalScore ?? 0),
    expectedNetRet3d,
    minExpectedNetRet3d: Number(handoffCfg?.minExpectedNetRet3d ?? -1),
    qualityScore,
    minQualityScore: Number(handoffCfg?.minQualityScore ?? 0),
    fillProb,
    minFillProb: Number(handoffCfg?.minFillProb ?? 0),
    slippageRisk,
    maxSlippageRisk: Number.isFinite(Number(handoffCfg?.maxSlippageRisk))
      ? Number(handoffCfg.maxSlippageRisk)
      : null,
    antiScore,
    maxAntiScore: Number.isFinite(Number(handoffCfg?.maxAntiScore))
      ? Number(handoffCfg.maxAntiScore)
      : null,
    targetStopEdge3d,
    minTargetStopEdge3d: Number.isFinite(Number(handoffCfg?.minTargetStopEdge3d))
      ? Number(handoffCfg.minTargetStopEdge3d)
      : null
  }
}

export const selectPicksByGate = ({ top, gateCfg, explorationCtx }) => {
  const rows = Array.isArray(top) ? top : []
  if (!rows.length) {
    return {
      picks: [],
      pick: null,
      gateReason: "NO_CANDIDATE",
      scoreMargin: null,
      rejectionCounts: { NO_CANDIDATE: 1 },
      propensity: null,
      selectionPolicy: { mode: "NO_CANDIDATE", epsilon: 0, applied: false }
    }
  }
  const top1 = rows[0]
  const top2 = rows[1] ?? null
  const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
  const top2Score = Number(top2?.finalScore ?? top2?.score ?? 0)
  const explicitMargin = num(top1?.gateScoreMargin ?? top1?.rawScoreMargin ?? top1?.scoreMargin)
  const scoreMargin = Number.isFinite(explicitMargin)
    ? explicitMargin
    : (top2 ? top1Score - top2Score : Number.POSITIVE_INFINITY)
  const coverageRecovery =
    gateCfg?.useMinScoreMarginGate !== false &&
    scoreMargin < Number(gateCfg?.minScoreMargin ?? 0)
      ? evaluateCoverageRecovery({ top1, gateCfg, explorationCtx, scoreMargin })
      : null
  const scoreMarginHandoff =
    gateCfg?.useMinScoreMarginGate !== false &&
    scoreMargin < Number(gateCfg?.minScoreMargin ?? 0) &&
    !coverageRecovery
      ? evaluateScoreMarginHandoff({ top1, gateCfg, scoreMargin })
      : null
  if (
    gateCfg?.useMinScoreMarginGate !== false &&
    scoreMargin < Number(gateCfg?.minScoreMargin ?? 0) &&
    !coverageRecovery &&
    !scoreMarginHandoff
  ) {
    return {
      picks: [],
      pick: null,
      gateReason: "SCORE_MARGIN_LOW",
      scoreMargin,
      rejectionCounts: { SCORE_MARGIN_LOW: 1 },
      propensity: null,
      selectionPolicy: { mode: "REJECTED", epsilon: 0, applied: false }
    }
  }
  const maxScoreMargin = num(gateCfg?.maxScoreMargin)
  if (
    gateCfg?.useMaxScoreMarginGate !== false &&
    Number.isFinite(maxScoreMargin) &&
    Number.isFinite(scoreMargin) &&
    scoreMargin > maxScoreMargin
  ) {
    return {
      picks: [],
      pick: null,
      gateReason: "SCORE_MARGIN_HIGH",
      scoreMargin,
      rejectionCounts: { SCORE_MARGIN_HIGH: 1 },
      propensity: null,
      selectionPolicy: { mode: "REJECTED", epsilon: 0, applied: false }
    }
  }

  const top1Reason = evaluateRowGate({ row: top1, gateCfg })
  if (top1Reason !== "TRADE") {
    return {
      picks: [],
      pick: null,
      gateReason: top1Reason,
      scoreMargin,
      rejectionCounts: { [top1Reason]: 1 },
      propensity: null,
      selectionPolicy: { mode: "REJECTED", epsilon: 0, applied: false }
    }
  }

  const maxPicks = gateCfg?.effectiveSinglePick === true
    ? 1
    : Math.max(1, Number(gateCfg?.maxPicksPerDay ?? 1) || 1)
  const picks = [top1]
  const rejectionCounts = {}
  let secondPickGate = {
    mode: normalizeSecondPickMode(gateCfg?.secondPick?.mode),
    evaluated: false,
    accepted: false,
    rejectReason: null,
    shadowRejectReason: null,
    firstSecondGap: Number.isFinite(scoreMargin) ? scoreMargin : null,
    secondThirdMargin: null
  }
  let propensity = 1
  const selectionPolicy = {
    mode: "EXPLOIT",
    epsilon: 0,
    applied: false,
    candidatePool: 1,
    chosenRank: 1,
    chosenSymbol: String(top1?.symbol ?? "").trim() || null,
    coverageRecovery: null,
    scoreMarginHandoff: null
  }

  if (maxPicks <= 1) {
    if (scoreMarginHandoff) {
      propensity = 1
      selectionPolicy.mode = "SCORE_MARGIN_HANDOFF"
      selectionPolicy.epsilon = 0
      selectionPolicy.applied = true
      selectionPolicy.candidatePool = 1
      selectionPolicy.chosenRank = 1
      selectionPolicy.chosenSymbol = String(top1?.symbol ?? "").trim() || null
      selectionPolicy.scoreMarginHandoff = scoreMarginHandoff
    } else if (!coverageRecovery) {
      const explorationCfg = gateCfg?.exploration ?? {}
      const killSwitchName = String(explorationCfg?.killSwitchEnv ?? "").trim()
      const killSwitchOn = killSwitchName ? parseEnvToggle(process.env?.[killSwitchName]) : false
      const epsilonBase =
        explorationCfg?.enabled === true && !killSwitchOn
          ? clamp(Number(explorationCfg?.epsilon ?? 0), 0, 0.05)
          : 0
      const explorationPickedCount = Math.max(
        0,
        Number(explorationCtx?.pickedCount ?? 0) || 0,
      )
      const minPickedForExplore = Math.max(
        0,
        Number(explorationCfg?.minPickedCountForEnable ?? 60) || 60,
      )
      const epsilon = explorationPickedCount >= minPickedForExplore ? epsilonBase : 0
      const poolLimit = Math.max(2, Math.floor(Number(explorationCfg?.candidatePool ?? 3) || 3))
      const pool = rows
        .slice(0, poolLimit)
        .filter((row) => evaluateRowGate({ row, gateCfg }) === "TRADE")
      if (pool.length > 0) {
        let selected = pool[0]
        let mode = "EXPLOIT"
        if (pool.length > 1 && epsilon > 0 && Math.random() < epsilon) {
          const altIdx = 1 + Math.floor(Math.random() * (pool.length - 1))
          selected = pool[altIdx]
          propensity = epsilon / (pool.length - 1)
          mode = "EXPLORE"
        } else {
          propensity = pool.length > 1 && epsilon > 0 ? 1 - epsilon : 1
        }
        picks.length = 0
        picks.push(selected)
        const chosenRank = rows.findIndex((row) => row === selected)
        selectionPolicy.mode = mode
        selectionPolicy.epsilon = epsilon
        selectionPolicy.applied = pool.length > 1 && epsilon > 0
        selectionPolicy.candidatePool = pool.length
        selectionPolicy.chosenRank = chosenRank >= 0 ? chosenRank + 1 : 1
        selectionPolicy.chosenSymbol = String(selected?.symbol ?? "").trim() || null
        selectionPolicy.killSwitchOn = killSwitchOn
        selectionPolicy.minPickedCountForEnable = minPickedForExplore
        selectionPolicy.currentPickedCount = explorationPickedCount
      } else {
        propensity = 1
      }
    } else {
      propensity = 1
      selectionPolicy.mode = "RECOVERY"
      selectionPolicy.epsilon = 0
      selectionPolicy.applied = true
      selectionPolicy.candidatePool = 1
      selectionPolicy.chosenRank = 1
      selectionPolicy.chosenSymbol = String(top1?.symbol ?? "").trim() || null
      selectionPolicy.coverageRecovery = coverageRecovery
      selectionPolicy.currentPickedCount = Math.max(
        0,
        Number(explorationCtx?.pickedCount ?? 0) || 0,
      )
    }
  }

  if (maxPicks > 1 && rows.length > 1) {
    secondPickGate = evaluateSecondPickGate({ rows, gateCfg })
    if (secondPickGate.rejectReason) {
      rejectionCounts[secondPickGate.rejectReason] = Number(rejectionCounts[secondPickGate.rejectReason] ?? 0) + 1
    }
    if (secondPickGate.accepted) {
      picks.push(rows[1])
    }
  }

  if (picks.length > 0) {
    return {
      picks,
      pick: picks[0],
      gateReason: "TRADE",
      scoreMargin,
      rejectionCounts,
      secondPickGate,
      propensity,
      selectionPolicy
    }
  }
  const gateReason = Object.keys(rejectionCounts)[0] ?? "NO_CANDIDATE"
  return {
    picks: [],
    pick: null,
    gateReason,
    scoreMargin,
    rejectionCounts,
    secondPickGate,
    propensity: null,
    selectionPolicy: { mode: "NO_CANDIDATE", epsilon: 0, applied: false }
  }
}
