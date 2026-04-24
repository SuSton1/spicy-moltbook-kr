import { extractDayTypeModelFeatures } from "./day_type_model.mjs"

const toSafeCount = (value, fallback = 0) => Math.max(0, Number(value ?? fallback) || 0)

const toFiniteOrNull = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const toRerankDecisionSummary = (value) => {
  const rerank = value && typeof value === "object" ? value : null
  if (!rerank) return null
  return {
    applied: rerank?.applied === true,
    reason: rerank?.reason ?? null,
    objectiveMode: rerank?.objectiveMode ?? null,
    fromRank: toFiniteOrNull(rerank?.fromRank),
    toRank: toFiniteOrNull(rerank?.toRank),
    poolSize: toFiniteOrNull(rerank?.poolSize),
    firstUtility: toFiniteOrNull(rerank?.firstUtility),
    selectedUtility: toFiniteOrNull(rerank?.selectedUtility),
    utilityGain: toFiniteOrNull(rerank?.utilityGain),
    firstBackbone: toFiniteOrNull(rerank?.firstBackbone),
    selectedBackbone: toFiniteOrNull(rerank?.selectedBackbone),
    firstDelta: toFiniteOrNull(rerank?.firstDelta),
    selectedDelta: toFiniteOrNull(rerank?.selectedDelta),
    deltaGain: toFiniteOrNull(rerank?.deltaGain),
    compositeUtilityGain: toFiniteOrNull(rerank?.compositeUtilityGain)
  }
}

const toInversionAdjustedSummary = (value) => {
  const inversion = value && typeof value === "object" ? value : null
  if (!inversion) return null
  return {
    applied: inversion?.applied === true,
    reason: inversion?.reason ?? null,
    scoreMargin: toFiniteOrNull(inversion?.scoreMargin)
  }
}

const toOrderingCandidateSummary = (value) => {
  const row = value && typeof value === "object" ? value : null
  if (!row) return null
  const symbol = String(row?.symbol ?? "").trim()
  if (!symbol) return null
  return {
    symbol,
    rank: toFiniteOrNull(row?.rank),
    finalScore: toFiniteOrNull(row?.finalScore),
    rankerScore: toFiniteOrNull(row?.rankerScore),
    rawScoreMargin: toFiniteOrNull(row?.rawScoreMargin),
    preRerankScoreMargin: toFiniteOrNull(row?.preRerankScoreMargin),
    postRerankScoreMargin: toFiniteOrNull(row?.postRerankScoreMargin),
    gateScoreMargin: toFiniteOrNull(row?.gateScoreMargin),
    expectedNetRet3d: toFiniteOrNull(row?.expectedNetRet3d),
    qualityScore: toFiniteOrNull(row?.qualityScore),
    targetRate3d: toFiniteOrNull(row?.targetRate3d),
    stopRate3d: toFiniteOrNull(row?.stopRate3d),
    successInWindow: row?.successInWindow === true
  }
}

const toOrderingTraceSummary = (value) => {
  const trace = value && typeof value === "object" ? value : null
  if (!trace) return null
  return {
    inputTop1: toOrderingCandidateSummary(trace?.inputTop1),
    preRerankTop1: toOrderingCandidateSummary(trace?.preRerankTop1),
    postPrimaryRerankTop1: toOrderingCandidateSummary(trace?.postPrimaryRerankTop1),
    postMicroCorrectionTop1: toOrderingCandidateSummary(trace?.postMicroCorrectionTop1),
    gateInputTop1: toOrderingCandidateSummary(trace?.gateInputTop1),
    finalSelectedTop1: toOrderingCandidateSummary(trace?.finalSelectedTop1),
    candidatePoolSize: toFiniteOrNull(trace?.candidatePoolSize),
    preRerankPoolSize: toFiniteOrNull(trace?.preRerankPoolSize),
    gatePoolSize: toFiniteOrNull(trace?.gatePoolSize),
    swapCandidatePoolSize: toFiniteOrNull(trace?.swapCandidatePoolSize),
    primaryRerankApplied: trace?.primaryRerankApplied === true,
    primaryRerankReason: trace?.primaryRerankReason ?? null,
    agreementRerankApplied: trace?.agreementRerankApplied === true,
    agreementRerankReason: trace?.agreementRerankReason ?? null,
    microCorrectionApplied: trace?.microCorrectionApplied === true,
    microCorrectionReason: trace?.microCorrectionReason ?? null,
    microCorrectionMode: trace?.microCorrectionMode ?? null,
    microCorrectionPoolSize: toFiniteOrNull(trace?.microCorrectionPoolSize),
    finalSelectionMode: trace?.finalSelectionMode ?? null,
    finalSelectionReason: trace?.finalSelectionReason ?? null,
    finalGateReason: trace?.finalGateReason ?? null,
    agreementDecision: trace?.agreementDecision ?? null,
    agreementReason: trace?.agreementReason ?? null,
    agreementEnforcementMode: trace?.agreementEnforcementMode ?? null
  }
}

const toScoreOriginTraceSummary = (value) => {
  const trace = value && typeof value === "object" ? value : null
  if (!trace) return null
  return {
    policyContractTauRank: toFiniteOrNull(trace?.policyContractTauRank),
    top1FinalScore: toFiniteOrNull(trace?.top1FinalScore),
    minFinalScore: toFiniteOrNull(trace?.minFinalScore),
    minFinalScoreShortfall: toFiniteOrNull(trace?.minFinalScoreShortfall),
    top1ScoreMargin: toFiniteOrNull(trace?.top1ScoreMargin),
    minScoreMargin: toFiniteOrNull(trace?.minScoreMargin),
    minScoreMarginShortfall: toFiniteOrNull(trace?.minScoreMarginShortfall),
    baseScore: toFiniteOrNull(trace?.baseScore),
    postScoreAdjustDelta: toFiniteOrNull(trace?.postScoreAdjustDelta),
    finalScorePostAdjust: toFiniteOrNull(trace?.finalScorePostAdjust),
    finalScoreAfterRegimeExpert: toFiniteOrNull(trace?.finalScoreAfterRegimeExpert ?? trace?.finalScorePreBias),
    finalScorePreBias: toFiniteOrNull(trace?.finalScorePreBias),
    regimeExpertDelta: toFiniteOrNull(trace?.regimeExpertDelta),
    regimeExpertMultiplier: toFiniteOrNull(trace?.regimeExpertMultiplier),
    extendedBiasDelta: toFiniteOrNull(trace?.extendedBiasDelta),
    tradeQualityPriorDelta: toFiniteOrNull(trace?.tradeQualityPriorDelta),
    executionPriorDelta: toFiniteOrNull(trace?.executionPriorDelta),
    finalScorePreExecutionPrior: toFiniteOrNull(trace?.finalScorePreExecutionPrior),
    finalScorePostExecutionPrior: toFiniteOrNull(trace?.finalScorePostExecutionPrior),
    qualityBonus: toFiniteOrNull(trace?.qualityBonus),
    winRateBonus: toFiniteOrNull(trace?.winRateBonus),
    targetRateBonus: toFiniteOrNull(trace?.targetRateBonus),
    stopRatePenalty: toFiniteOrNull(trace?.stopRatePenalty),
    antiPenalty: toFiniteOrNull(trace?.antiPenalty),
    expectedRetBonus: toFiniteOrNull(trace?.expectedRetBonus),
    eraCoverageBonus: toFiniteOrNull(trace?.eraCoverageBonus),
    coveragePenalty: toFiniteOrNull(trace?.coveragePenalty),
    supportCountPenalty: toFiniteOrNull(trace?.supportCountPenalty),
    supportCountPenaltyRaw: toFiniteOrNull(trace?.supportCountPenaltyRaw),
    supportCountPenaltyRelief: toFiniteOrNull(trace?.supportCountPenaltyRelief),
    supportCountPenaltyReliefSignal: toFiniteOrNull(trace?.supportCountPenaltyReliefSignal),
    singleEraConcentrationPenaltyRaw: toFiniteOrNull(trace?.singleEraConcentrationPenaltyRaw),
    singleEraConcentrationPenaltyRelief: toFiniteOrNull(trace?.singleEraConcentrationPenaltyRelief),
    singleEraConcentrationPenaltyEvidenceRatio: toFiniteOrNull(
      trace?.singleEraConcentrationPenaltyEvidenceRatio,
    ),
    singleEraConcentrationPenalty: toFiniteOrNull(trace?.singleEraConcentrationPenalty),
    singleEraPenalty: toFiniteOrNull(trace?.singleEraPenalty),
    lowEraSupportPenalty: toFiniteOrNull(trace?.lowEraSupportPenalty),
    stopRatePenaltyRaw: toFiniteOrNull(trace?.stopRatePenaltyRaw),
    stopRatePenaltyRelief: toFiniteOrNull(trace?.stopRatePenaltyRelief),
    stopRatePenaltyReliefSignal: toFiniteOrNull(trace?.stopRatePenaltyReliefSignal),
    clusterTemporalEraSupportCount: toFiniteOrNull(trace?.clusterTemporalEraSupportCount),
    clusterTemporalEraCoverageRatio: toFiniteOrNull(trace?.clusterTemporalEraCoverageRatio),
    targetEraCoverageRatio: toFiniteOrNull(trace?.targetEraCoverageRatio),
    clusterTemporalMaxSingleEraShare: toFiniteOrNull(trace?.clusterTemporalMaxSingleEraShare),
    clusterTemporalEffectiveSingleEraShare: toFiniteOrNull(
      trace?.clusterTemporalEffectiveSingleEraShare,
    ),
    clusterTemporalSingleEraEvidenceCoverageRatio: toFiniteOrNull(
      trace?.clusterTemporalSingleEraEvidenceCoverageRatio,
    ),
    clusterTemporalSingleEraEvidenceSupportRatio: toFiniteOrNull(
      trace?.clusterTemporalSingleEraEvidenceSupportRatio,
    ),
    clusterTemporalEffectiveEraCount: toFiniteOrNull(trace?.clusterTemporalEffectiveEraCount),
    clusterTemporalNormalizedEraEntropy: toFiniteOrNull(
      trace?.clusterTemporalNormalizedEraEntropy,
    ),
    clusterTemporalSingleEraEvidenceEffectiveEraCountRatio: toFiniteOrNull(
      trace?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio,
    ),
    clusterTemporalSingleEraEvidenceEntropyRatio: toFiniteOrNull(
      trace?.clusterTemporalSingleEraEvidenceEntropyRatio,
    ),
    maxSingleEraShareCap: toFiniteOrNull(trace?.maxSingleEraShareCap),
    minEraSupportCount: toFiniteOrNull(trace?.minEraSupportCount),
    eraSupportShortfall: toFiniteOrNull(trace?.eraSupportShortfall),
    eraCoverageShortfall: toFiniteOrNull(trace?.eraCoverageShortfall),
    singleEraShareExcess: toFiniteOrNull(trace?.singleEraShareExcess),
    eraSupportPenaltyReasonRaw: trace?.eraSupportPenaltyReasonRaw ?? null,
    eraSupportPenaltyReason: trace?.eraSupportPenaltyReason ?? null,
    tradeQualityPriorAdjustment: toFiniteOrNull(trace?.tradeQualityPriorAdjustment),
    tradeQualityFeatureAdjustment: toFiniteOrNull(trace?.tradeQualityFeatureAdjustment),
    tradeQualityRankerAdjustment: toFiniteOrNull(trace?.tradeQualityRankerAdjustment),
    tradeQualityRouteResidual: toFiniteOrNull(trace?.tradeQualityRouteResidual),
    tradeQualityRegimeResidual: toFiniteOrNull(trace?.tradeQualityRegimeResidual),
    tradeQualityPrototypeResidual: toFiniteOrNull(trace?.tradeQualityPrototypeResidual),
    executionPriorLowFillPenalty: toFiniteOrNull(trace?.executionPriorLowFillPenalty),
    executionPriorLowFillPenaltyRaw: toFiniteOrNull(trace?.executionPriorLowFillPenaltyRaw),
    executionPriorLowFillPenaltyRelief: toFiniteOrNull(trace?.executionPriorLowFillPenaltyRelief),
    executionPriorSlippagePenalty: toFiniteOrNull(trace?.executionPriorSlippagePenalty),
    executionPriorSlippagePenaltyRaw: toFiniteOrNull(trace?.executionPriorSlippagePenaltyRaw),
    executionPriorSlippagePenaltyRelief: toFiniteOrNull(trace?.executionPriorSlippagePenaltyRelief),
    executionPriorLowLiquidityPenalty: toFiniteOrNull(trace?.executionPriorLowLiquidityPenalty),
    executionPriorLowLiquidityPenaltyRaw: toFiniteOrNull(trace?.executionPriorLowLiquidityPenaltyRaw),
    executionPriorLowLiquidityPenaltyRelief: toFiniteOrNull(trace?.executionPriorLowLiquidityPenaltyRelief),
    executionPriorBlockedOrderPenalty: toFiniteOrNull(trace?.executionPriorBlockedOrderPenalty),
    executionPriorPositiveAfterCostBonus: toFiniteOrNull(trace?.executionPriorPositiveAfterCostBonus),
    executionPriorNegativeAfterCostPenalty: toFiniteOrNull(trace?.executionPriorNegativeAfterCostPenalty),
    failedBreakoutCount20: toFiniteOrNull(trace?.failedBreakoutCount20),
    gapFillThenContinueScore: toFiniteOrNull(trace?.gapFillThenContinueScore),
    gapFillThenRevertScore: toFiniteOrNull(trace?.gapFillThenRevertScore),
    executionFeasibilityScore: toFiniteOrNull(trace?.executionFeasibilityScore),
    prototypeFailedBreakoutCount20: toFiniteOrNull(trace?.prototypeFailedBreakoutCount20),
    prototypeGapFillThenContinueScore: toFiniteOrNull(trace?.prototypeGapFillThenContinueScore),
    prototypeGapFillThenRevertScore: toFiniteOrNull(trace?.prototypeGapFillThenRevertScore),
    prototypeExecutionFeasibilityScore: toFiniteOrNull(trace?.prototypeExecutionFeasibilityScore),
    componentDominantPenalty: trace?.componentDominantPenalty ?? null,
    componentPenaltyAbs: toFiniteOrNull(trace?.componentPenaltyAbs),
    componentPenaltyShare: toFiniteOrNull(trace?.componentPenaltyShare),
    scorePathologyPrimaryComponent: trace?.scorePathologyPrimaryComponent ?? null,
    scorePathologySecondaryComponent: trace?.scorePathologySecondaryComponent ?? null,
    scorePathologyPrimarySubcomponent: trace?.scorePathologyPrimarySubcomponent ?? null,
    scorePathologySecondarySubcomponent: trace?.scorePathologySecondarySubcomponent ?? null,
    scorePathologyCompositeType: trace?.scorePathologyCompositeType ?? null,
    scorePathologyTotalPenaltyAbs: toFiniteOrNull(trace?.scorePathologyTotalPenaltyAbs),
    componentPenaltyByComponent:
      trace?.componentPenaltyByComponent && typeof trace.componentPenaltyByComponent === "object"
        ? trace.componentPenaltyByComponent
        : {},
    subcomponentPenaltyBySubcomponent:
      trace?.subcomponentPenaltyBySubcomponent &&
      typeof trace.subcomponentPenaltyBySubcomponent === "object"
        ? trace.subcomponentPenaltyBySubcomponent
        : {}
  }
}

const toCounterfactualCandidateSummary = (value) => {
  const row = value && typeof value === "object" ? value : null
  if (!row) return null
  return {
    rank: toFiniteOrNull(row?.rank),
    symbol: String(row?.symbol ?? "").trim() || null,
    pass: row?.pass === true,
    gateReason: row?.gateReason ?? null,
    scoreMargin: toFiniteOrNull(row?.scoreMargin),
    finalScore: toFiniteOrNull(row?.finalScore),
    rankerScore: toFiniteOrNull(row?.rankerScore),
    rawSimilarityScore: toFiniteOrNull(row?.rawSimilarityScore),
    localStageScore: toFiniteOrNull(row?.localStageScore),
    triggerStageScore: toFiniteOrNull(row?.triggerStageScore),
    expectedNetRet3d: toFiniteOrNull(row?.expectedNetRet3d),
    agreementDecision: row?.agreementDecision ?? null,
    agreementReason: row?.agreementReason ?? null,
    successInWindow: row?.successInWindow === true
  }
}

const toCounterfactualGateSweepSummary = (value) => {
  const trace = value && typeof value === "object" ? value : null
  if (!trace) return null
  return {
    topN: toFiniteOrNull(trace?.topN),
    top1Pass: trace?.top1Pass === true,
    top1GateReason: trace?.top1GateReason ?? null,
    topNPassExistsDay: trace?.topNPassExistsDay === true,
    bestPassingRank: toFiniteOrNull(trace?.bestPassingRank),
    bestPassingSymbol: String(trace?.bestPassingSymbol ?? "").trim() || null,
    bestPassingWouldHitDay: trace?.bestPassingWouldHitDay === true,
    top1FailedButAltPassExistsDay: trace?.top1FailedButAltPassExistsDay === true,
    top1FailedAndNoAltPassExistsDay: trace?.top1FailedAndNoAltPassExistsDay === true,
    bestAltPassingRank: toFiniteOrNull(trace?.bestAltPassingRank),
    bestAltPassingSymbol: String(trace?.bestAltPassingSymbol ?? "").trim() || null,
    bestAltPassingWouldHitDay: trace?.bestAltPassingWouldHitDay === true,
    candidates: Array.isArray(trace?.candidates)
      ? trace.candidates.map((row) => toCounterfactualCandidateSummary(row)).filter(Boolean)
      : []
  }
}

const toScoreRecoveryTelemetrySummary = (value) => {
  const telemetry = value && typeof value === "object" ? value : null
  if (!telemetry) return null
  return {
    enabled: telemetry?.enabled === true,
    mode: String(telemetry?.mode ?? "").trim() || null,
    gateReason: telemetry?.gateReason ?? null,
    recoveryReason: telemetry?.recoveryReason ?? null,
    candidateSymbol: String(telemetry?.candidateSymbol ?? "").trim() || null,
    candidateRank: toFiniteOrNull(telemetry?.candidateRank),
    allowedGateReasons: Array.isArray(telemetry?.allowedGateReasons)
      ? telemetry.allowedGateReasons
      : [],
    eligible: telemetry?.eligible === true,
    rejectionReasons: Array.isArray(telemetry?.rejectionReasons)
      ? telemetry.rejectionReasons
      : [],
    finalScoreShortfall: toFiniteOrNull(telemetry?.finalScoreShortfall),
    scoreMarginShortfall: toFiniteOrNull(telemetry?.scoreMarginShortfall),
    rawSimilarityScore: toFiniteOrNull(telemetry?.rawSimilarityScore),
    localStageScore: toFiniteOrNull(telemetry?.localStageScore),
    expectedNetRet3d: toFiniteOrNull(telemetry?.expectedNetRet3d),
    falsePositiveRisk: toFiniteOrNull(telemetry?.falsePositiveRisk),
    falsePositiveRiskAvailable: telemetry?.falsePositiveRiskAvailable === true,
    fillProb: toFiniteOrNull(telemetry?.fillProb),
    wouldTradeDay: telemetry?.wouldTradeDay === true,
    wouldHitDay: telemetry?.wouldHitDay === true,
    wouldBeatBlockedTop1Day: telemetry?.wouldBeatBlockedTop1Day === true,
    sameAsBlockedTop1: telemetry?.sameAsBlockedTop1 === true,
    hardPassApplied: telemetry?.hardPassApplied === true
  }
}

const toScoreRecalibrationTelemetrySummary = (value) => {
  const telemetry = value && typeof value === "object" ? value : null
  if (!telemetry) return null
  return {
    enabled: telemetry?.enabled === true,
    mode: String(telemetry?.mode ?? "").trim() || null,
    gateReason: telemetry?.gateReason ?? null,
    candidateSymbol: String(telemetry?.candidateSymbol ?? "").trim() || null,
    candidateRank: toFiniteOrNull(telemetry?.candidateRank),
    primaryComponent: telemetry?.primaryComponent ?? null,
    secondaryComponent: telemetry?.secondaryComponent ?? null,
    primarySubcomponent: telemetry?.primarySubcomponent ?? null,
    secondarySubcomponent: telemetry?.secondarySubcomponent ?? null,
    compositeType: telemetry?.compositeType ?? null,
    allowedPrimaryComponents: Array.isArray(telemetry?.allowedPrimaryComponents)
      ? telemetry.allowedPrimaryComponents
      : [],
    allowedPrimarySubcomponents: Array.isArray(telemetry?.allowedPrimarySubcomponents)
      ? telemetry.allowedPrimarySubcomponents
      : [],
    capsByComponent:
      telemetry?.capsByComponent && typeof telemetry.capsByComponent === "object"
        ? telemetry.capsByComponent
        : {},
    capsBySubcomponent:
      telemetry?.capsBySubcomponent && typeof telemetry.capsBySubcomponent === "object"
        ? telemetry.capsBySubcomponent
        : {},
    appliedSubcomponentPolicy:
      telemetry?.appliedSubcomponentPolicy &&
      typeof telemetry.appliedSubcomponentPolicy === "object"
        ? telemetry.appliedSubcomponentPolicy
        : null,
    appliedEraSupportReasonPolicy:
      telemetry?.appliedEraSupportReasonPolicy &&
      typeof telemetry.appliedEraSupportReasonPolicy === "object"
        ? telemetry.appliedEraSupportReasonPolicy
        : null,
    eligible: telemetry?.eligible === true,
    rejectionReasons: Array.isArray(telemetry?.rejectionReasons)
      ? telemetry.rejectionReasons
      : [],
    rawSimilarityScore: toFiniteOrNull(telemetry?.rawSimilarityScore),
    localStageScore: toFiniteOrNull(telemetry?.localStageScore),
    expectedNetRet3d: toFiniteOrNull(telemetry?.expectedNetRet3d),
    fillProb: toFiniteOrNull(telemetry?.fillProb),
    baseScore: toFiniteOrNull(telemetry?.baseScore),
    eraSupportCount: toFiniteOrNull(telemetry?.eraSupportCount),
    eraCoverageRatio: toFiniteOrNull(telemetry?.eraCoverageRatio),
    targetEraCoverageRatio: toFiniteOrNull(telemetry?.targetEraCoverageRatio),
    minEraSupportCount: toFiniteOrNull(telemetry?.minEraSupportCount),
    eraSupportShortfall: toFiniteOrNull(telemetry?.eraSupportShortfall),
    singleEraShareExcess: toFiniteOrNull(telemetry?.singleEraShareExcess),
    eraSupportPenaltyReason: telemetry?.eraSupportPenaltyReason ?? null,
    recalibratedFinalScore: toFiniteOrNull(telemetry?.recalibratedFinalScore),
    recalibratedFinalScoreDelta: toFiniteOrNull(telemetry?.recalibratedFinalScoreDelta),
    recalibratedFinalScoreShortfall: toFiniteOrNull(telemetry?.recalibratedFinalScoreShortfall),
    recalibratedScoreMargin: toFiniteOrNull(telemetry?.recalibratedScoreMargin),
    recalibratedScoreMarginShortfall: toFiniteOrNull(telemetry?.recalibratedScoreMarginShortfall),
    cappedPenaltiesByComponent:
      telemetry?.cappedPenaltiesByComponent && typeof telemetry.cappedPenaltiesByComponent === "object"
        ? telemetry.cappedPenaltiesByComponent
        : {},
    cappedPenaltiesBySubcomponent:
      telemetry?.cappedPenaltiesBySubcomponent &&
      typeof telemetry.cappedPenaltiesBySubcomponent === "object"
        ? telemetry.cappedPenaltiesBySubcomponent
        : {},
    wouldTradeDay: telemetry?.wouldTradeDay === true,
    wouldHitDay: telemetry?.wouldHitDay === true,
    wouldBeatBlockedTop1Day: telemetry?.wouldBeatBlockedTop1Day === true,
    hardPassApplied: telemetry?.hardPassApplied === true
  }
}

const toTop1PathSummary = (value) => {
  const trace = value && typeof value === "object" ? value : null
  if (!trace) return null
  return {
    gateInputTop1Symbol: String(trace?.gateInputTop1Symbol ?? "").trim() || null,
    finalSelectedTop1Symbol: String(trace?.finalSelectedTop1Symbol ?? "").trim() || null,
    finalExecutedTop1Symbol: String(trace?.finalExecutedTop1Symbol ?? "").trim() || null,
    gateInputTop1Blocked: trace?.gateInputTop1Blocked === true,
    blockedTop1BeforeExecution: trace?.blockedTop1BeforeExecution === true,
    blockedTop1AfterExecution: trace?.blockedTop1AfterExecution === true,
    blockedTop1WasHit: trace?.blockedTop1WasHit === true,
    blockedTop1Reason: trace?.blockedTop1Reason ?? null,
    selectedTop1Executed: trace?.selectedTop1Executed === true,
    selectedTop1ExecutionDecision: trace?.selectedTop1ExecutionDecision ?? null,
    selectedTop1ExecutionShadowReason: trace?.selectedTop1ExecutionShadowReason ?? null,
    agreementFallbackApplied: trace?.agreementFallbackApplied === true,
    agreementFallbackReason: trace?.agreementFallbackReason ?? null,
    agreementFallbackChosenRank: toFiniteOrNull(trace?.agreementFallbackChosenRank),
    agreementFallbackBlockedRank: toFiniteOrNull(trace?.agreementFallbackBlockedRank),
    agreementFallbackBlockedSymbol: String(trace?.agreementFallbackBlockedSymbol ?? "").trim() || null,
    agreementFallbackSelectionChanged: trace?.agreementFallbackSelectionChanged === true
  }
}

const toSimilarityTopCandidateSummary = (value) => {
  const row = value && typeof value === "object" ? value : null
  if (!row) return null
  const symbol = String(row?.symbol ?? "").trim()
  if (!symbol) return null
  return {
    symbol,
    finalScore: toFiniteOrNull(row?.finalScore),
    rawSimilarityScore: toFiniteOrNull(row?.rawSimilarityScore),
    localStageScore: toFiniteOrNull(row?.localStageScore),
    triggerStageScore: toFiniteOrNull(row?.triggerStageScore),
    positiveTop2RawSimilarity: toFiniteOrNull(row?.positiveTop2RawSimilarity),
    top1Top2PositiveGap: toFiniteOrNull(row?.top1Top2PositiveGap),
    positiveVsNegativeGap: toFiniteOrNull(row?.positiveVsNegativeGap),
    negativeTop1RawSimilarity: toFiniteOrNull(row?.negativeTop1RawSimilarity),
    matchedPrototypeId: row?.matchedPrototypeId ?? null,
    negativeTop1PrototypeId: row?.negativeTop1PrototypeId ?? null,
    negativeTop1OutcomeBucket: row?.negativeTop1OutcomeBucket ?? null,
    successInWindow: row?.successInWindow === true,
    similarityGateRejectReasons: Array.isArray(row?.similarityGateRejectReasons)
      ? row.similarityGateRejectReasons
      : []
  }
}

const toSimilarityGateSummary = (value) => {
  const gate = value && typeof value === "object" ? value : null
  if (!gate) return null
  return {
    enabled: gate?.enabled === true,
    disambiguationEnabled: gate?.disambiguationEnabled === true,
    scoredCount: toSafeCount(gate?.scoredCount),
    passedCount: toSafeCount(gate?.passedCount),
    rejectedCount: toSafeCount(gate?.rejectedCount),
    winnerChangedAfterSimilarityGateDay: gate?.winnerChangedAfterSimilarityGateDay === true,
    top1RejectedBySimilarityGateDay: gate?.top1RejectedBySimilarityGateDay === true,
    oracleHitRejectedBySimilarityGateDay: gate?.oracleHitRejectedBySimilarityGateDay === true,
    preGateTop1: toSimilarityTopCandidateSummary(gate?.preGateTop1),
    postGateTop1: toSimilarityTopCandidateSummary(gate?.postGateTop1),
    rejectReasonCounts:
      gate?.rejectReasonCounts && typeof gate.rejectReasonCounts === "object"
        ? gate.rejectReasonCounts
        : {}
  }
}

const toAgreementGateTelemetrySummary = (value) => {
  const gate = value && typeof value === "object" ? value : null
  if (!gate) return null
  return {
    enabled: gate?.enabled === true,
    blockedDay: gate?.blockedDay === true,
    blockedTop1WouldHaveHitDay: gate?.blockedTop1WouldHaveHitDay === true,
    modelUnavailableDay: gate?.modelUnavailableDay === true,
    checksSource: gate?.checksSource ?? null,
    decision: gate?.decision ?? null,
    reason: gate?.reason ?? null,
    enforcementMode: gate?.enforcementMode ?? null,
    symbol: gate?.symbol ?? null,
    successInWindow: gate?.successInWindow === true,
    rawSimilarityScore: toFiniteOrNull(gate?.rawSimilarityScore),
    globalStageScore: toFiniteOrNull(gate?.globalStageScore),
    localStageScore: toFiniteOrNull(gate?.localStageScore),
    triggerStageScore: toFiniteOrNull(gate?.triggerStageScore),
    gateScoreMargin: toFiniteOrNull(gate?.gateScoreMargin),
    agreementScore: toFiniteOrNull(gate?.agreementScore),
    agreementScoreDelta: toFiniteOrNull(gate?.agreementScoreDelta),
    consensusCount: toFiniteOrNull(gate?.consensusCount),
    consensusCountDelta: toFiniteOrNull(gate?.consensusCountDelta),
    consensusRate: toFiniteOrNull(gate?.consensusRate),
    stabilityRate: toFiniteOrNull(gate?.stabilityRate),
    stabilityRateDelta: toFiniteOrNull(gate?.stabilityRateDelta),
    candidateUtility: toFiniteOrNull(gate?.candidateUtility),
    minAgreementScore: toFiniteOrNull(gate?.minAgreementScore),
    minConsensusCount: toFiniteOrNull(gate?.minConsensusCount),
    minStabilityRate: toFiniteOrNull(gate?.minStabilityRate),
    candidatePool: toFiniteOrNull(gate?.candidatePool),
    consensusTopN: toFiniteOrNull(gate?.consensusTopN),
    stabilityTopN: toFiniteOrNull(gate?.stabilityTopN),
    expectedNetRet3d: toFiniteOrNull(gate?.expectedNetRet3d),
    executionScore: toFiniteOrNull(gate?.executionScore),
    falsePositiveRisk: toFiniteOrNull(gate?.falsePositiveRisk),
    agreementVoteSourceCount: toFiniteOrNull(gate?.agreementVoteSourceCount),
    agreementVoteEntropy: toFiniteOrNull(gate?.agreementVoteEntropy),
    consensusLeaderSymbol: gate?.consensusLeaderSymbol ?? null,
    consensusLeaderVotes: toFiniteOrNull(gate?.consensusLeaderVotes),
    consensusLeaderVoteShare: toFiniteOrNull(gate?.consensusLeaderVoteShare),
    consensusLeaderMatchesTop1: gate?.consensusLeaderMatchesTop1 === true,
    consensusLeaderRank: toFiniteOrNull(gate?.consensusLeaderRank),
    disagreementPattern: gate?.disagreementPattern ?? null,
    top1VsConsensusLeaderScoreDelta: toFiniteOrNull(gate?.top1VsConsensusLeaderScoreDelta),
    topAgreementLeaders: Array.isArray(gate?.topAgreementLeaders) ? gate.topAgreementLeaders : [],
    agreementVoteCounts:
      gate?.agreementVoteCounts && typeof gate.agreementVoteCounts === "object"
        ? gate.agreementVoteCounts
        : {},
    viewRanks:
      gate?.viewRanks && typeof gate.viewRanks === "object"
        ? gate.viewRanks
        : {},
    viewModes:
      gate?.viewModes && typeof gate.viewModes === "object"
        ? gate.viewModes
        : {},
    scenarioRanks:
      gate?.scenarioRanks && typeof gate.scenarioRanks === "object"
        ? gate.scenarioRanks
        : {},
    scenarioWinners:
      gate?.scenarioWinners && typeof gate.scenarioWinners === "object"
        ? gate.scenarioWinners
        : {},
    scenarioModes:
      gate?.scenarioModes && typeof gate.scenarioModes === "object"
        ? gate.scenarioModes
        : {}
  }
}

export const toD1RankedCandidatesRow = (logRow) => {
  const row = logRow ?? {}
  const top = Array.isArray(row?.topK) ? row.topK : []
  const picked = Array.isArray(row?.pickedList) ? row.pickedList : []
  const orderingTrace = toOrderingTraceSummary(
    row?.orderingTrace ?? row?.rankingPolicy?.orderingTrace,
  )
  const scoreOriginTrace = toScoreOriginTraceSummary(row?.scoreOriginTrace)
  const counterfactualGateSweep = toCounterfactualGateSweepSummary(row?.counterfactualGateSweep)
  const scoreRecoveryTelemetry = toScoreRecoveryTelemetrySummary(row?.scoreRecoveryTelemetry)
  const scoreRecalibrationTelemetry = toScoreRecalibrationTelemetrySummary(row?.scoreRecalibrationTelemetry)
  const top1Path = toTop1PathSummary(row?.top1Path)
  const similarityGate = toSimilarityGateSummary(row?.similarityGate)
  const agreementGateTelemetry = toAgreementGateTelemetrySummary(row?.agreementGateTelemetry)
  return {
    decisionDateKey: String(row?.decisionDateKey ?? ""),
    goalMode: String(row?.goalMode ?? "").trim() || null,
    positionSemantics: String(row?.positionSemantics ?? "").trim() || null,
    targetFirstMode: row?.targetFirstMode === true,
    partition: String(row?.partition ?? "ONLINE"),
    gateReason: String(row?.gateReason ?? "UNKNOWN"),
    dayType: String(row?.dayType?.dayType ?? "BALANCED"),
    dayTypeNoTrade: row?.dayType?.noTrade === true,
    dayTypeShadowNoTrade:
      row?.dayType?.modelMeta?.shadowNoTrade === true || row?.dayType?.shadowNoTrade === true,
    dayTypeGateReason: row?.dayType?.gateReason ?? null,
    dayTypeReasonCodes: Array.isArray(row?.dayType?.reasonCodes) ? row.dayType.reasonCodes : [],
    dayTypePolicySource: row?.dayType?.policySource ?? null,
    dayTypeModelPredicted: row?.dayType?.modelDecision?.predictedDayType ?? null,
    dayTypeModelApplyMode: row?.dayType?.modelMeta?.applyMode ?? null,
    dayTypeModelShadowReason: row?.dayType?.modelMeta?.shadowReason ?? null,
    dayTypeModelConfidenceBucket: row?.dayType?.modelMeta?.confidenceBucket ?? null,
    ruleDayType: row?.dayTypeRule?.dayType ?? null,
    ruleDayTypeNoTrade: row?.dayTypeRule?.noTrade === true,
    ruleDayTypeGateReason: row?.dayTypeRule?.gateReason ?? null,
    ruleDayTypeReasonCodes: Array.isArray(row?.dayTypeRule?.reasonCodes) ? row.dayTypeRule.reasonCodes : [],
    ruleDayTypePolicySource: row?.dayTypeRule?.policySource ?? null,
    ruleDayTypeSignals:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? row.dayTypeRule.signals
        : null,
    ruleDayTypeSignalSnapshot:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? row.dayTypeRule.signals
        : null,
    ruleDayTypeModelFeatures:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? extractDayTypeModelFeatures({ signals: row.dayTypeRule.signals })
        : null,
    dayTypeSignals:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? row.dayType.signals
        : null,
    dayTypeSignalSnapshot:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? row.dayType.signals
        : null,
    dayTypeModelFeatures:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? extractDayTypeModelFeatures({ signals: row.dayType.signals })
        : null,
    candidateCount: toSafeCount(row?.candidateCount, top.length),
    perfectPrototypeGate: row?.perfectPrototypeGate ?? null,
    perfectPrototypeGateMode: row?.perfectPrototypeGate?.mode ?? null,
    perfectPrototypeGateMatchedRows: toSafeCount(row?.perfectPrototypeGate?.matchedRows),
    perfectPrototypeGateFilteredRows: toSafeCount(row?.perfectPrototypeGate?.filteredRows),
    perfectPrototypeGateDedupedRows: toSafeCount(row?.perfectPrototypeGate?.dedupedRows),
    pickCount: toSafeCount(row?.pickCount, picked.length),
    winnerChangedAfterSimilarityGateDay: row?.winnerChangedAfterSimilarityGateDay === true,
    top1RejectedBySimilarityGateDay: row?.top1RejectedBySimilarityGateDay === true,
    oracleHitRejectedBySimilarityGateDay: row?.oracleHitRejectedBySimilarityGateDay === true,
    preGateTop1: toSimilarityTopCandidateSummary(row?.preGateTop1),
    firstSuccessRank: Number.isFinite(Number(row?.firstSuccessRank))
      ? Number(row.firstSuccessRank)
      : null,
    selectionPolicy: row?.selectionPolicy ?? { mode: "UNKNOWN", applied: false },
    similarityGate,
    agreementGateTelemetry,
    agreementBlockedDay: agreementGateTelemetry?.blockedDay === true,
    agreementBlockedTop1WouldHaveHitDay:
      agreementGateTelemetry?.blockedTop1WouldHaveHitDay === true,
    agreementModelUnavailableDay: agreementGateTelemetry?.modelUnavailableDay === true,
    agreementDisagreementPattern: agreementGateTelemetry?.disagreementPattern ?? null,
    agreementConsensusLeaderSymbol: agreementGateTelemetry?.consensusLeaderSymbol ?? null,
    agreementConsensusLeaderMatchesTop1:
      agreementGateTelemetry?.consensusLeaderMatchesTop1 === true,
    rerankDecision: toRerankDecisionSummary(row?.rankingPolicy?.top1Rerank ?? row?.rerankDecision),
    inversionAdjusted: toInversionAdjustedSummary(
      row?.rankingPolicy?.inversionAdjust ?? row?.inversionAdjusted,
    ),
    orderingTrace,
    scoreOriginTrace,
    counterfactualGateSweep,
    scoreRecoveryTelemetry,
    scoreRecalibrationTelemetry,
    top1Path,
    inputTop1Symbol: orderingTrace?.inputTop1?.symbol ?? null,
    preRerankTop1Symbol: orderingTrace?.preRerankTop1?.symbol ?? null,
    postPrimaryRerankTop1Symbol: orderingTrace?.postPrimaryRerankTop1?.symbol ?? null,
    postMicroCorrectionTop1Symbol: orderingTrace?.postMicroCorrectionTop1?.symbol ?? null,
    gateInputTop1Symbol:
      top1Path?.gateInputTop1Symbol ?? orderingTrace?.gateInputTop1?.symbol ?? null,
    finalSelectedTop1Symbol:
      top1Path?.finalSelectedTop1Symbol ?? orderingTrace?.finalSelectedTop1?.symbol ?? null,
    finalExecutedTop1Symbol: top1Path?.finalExecutedTop1Symbol ?? null,
    blockedTop1WasHit: top1Path?.blockedTop1WasHit === true,
    blockedTop1Reason: top1Path?.blockedTop1Reason ?? null,
    agreementFallbackApplied:
      top1Path?.agreementFallbackApplied === true || orderingTrace?.agreementFallbackApplied === true,
    agreementFallbackReason:
      top1Path?.agreementFallbackReason ?? orderingTrace?.agreementFallbackReason ?? null,
    agreementFallbackChosenRank:
      toFiniteOrNull(top1Path?.agreementFallbackChosenRank ?? orderingTrace?.agreementFallbackChosenRank),
    agreementFallbackBlockedRank:
      toFiniteOrNull(top1Path?.agreementFallbackBlockedRank ?? orderingTrace?.agreementFallbackBlockedRank),
    agreementFallbackBlockedSymbol:
      top1Path?.agreementFallbackBlockedSymbol ?? orderingTrace?.agreementFallbackBlockedSymbol ?? null,
    agreementFallbackSelectionChanged:
      top1Path?.agreementFallbackSelectionChanged === true ||
      orderingTrace?.agreementFallbackSelectionChanged === true,
    swapCandidatePoolSize: orderingTrace?.swapCandidatePoolSize ?? null,
    swapRejectedReason:
      orderingTrace?.primaryRerankApplied === true ? null : orderingTrace?.primaryRerankReason ?? null,
    microCorrectionApplied: orderingTrace?.microCorrectionApplied === true,
    microCorrectionReason: orderingTrace?.microCorrectionReason ?? null,
    microCorrectionMode: orderingTrace?.microCorrectionMode ?? null,
    agreementEnforcementMode: orderingTrace?.agreementEnforcementMode ?? null,
    top1Symbol: String(top?.[0]?.symbol ?? "") || null,
    top1FinalScore: Number(top?.[0]?.finalScore ?? 0) || 0,
    top1RankerScore: Number(top?.[0]?.rankerScore ?? top?.[0]?.finalScore ?? top?.[0]?.score ?? 0) || 0,
    top1AgreementScore: Number.isFinite(Number(top?.[0]?.agreementScore))
      ? Number(top[0].agreementScore)
      : null,
    top1AgreementDecision: top?.[0]?.agreementDecision ?? null,
    top1AgreementReason: top?.[0]?.agreementReason ?? null,
    top1AgreementConsensusRate: Number.isFinite(Number(top?.[0]?.agreementConsensusRate))
      ? Number(top[0].agreementConsensusRate)
      : null,
    top1AgreementStabilityRate: Number.isFinite(Number(top?.[0]?.agreementStabilityRate))
      ? Number(top[0].agreementStabilityRate)
      : null,
    top1AgreementCandidateUtility: Number.isFinite(Number(top?.[0]?.agreementCandidateUtility))
      ? Number(top[0].agreementCandidateUtility)
      : null,
    top1AgreementChecks:
      top?.[0]?.agreementChecks && typeof top[0].agreementChecks === "object"
        ? top[0].agreementChecks
        : null,
    top1GateScoreMargin: Number.isFinite(Number(top?.[0]?.gateScoreMargin))
      ? Number(top[0].gateScoreMargin)
      : null,
    top1AgreementScoreDelta: toFiniteOrNull(agreementGateTelemetry?.agreementScoreDelta),
    top1AgreementConsensusCountDelta: toFiniteOrNull(agreementGateTelemetry?.consensusCountDelta),
    top1AgreementStabilityRateDelta: toFiniteOrNull(agreementGateTelemetry?.stabilityRateDelta),
    top1AgreementExpectedNetRet3d: toFiniteOrNull(agreementGateTelemetry?.expectedNetRet3d),
    top1AgreementFalsePositiveRisk: toFiniteOrNull(agreementGateTelemetry?.falsePositiveRisk),
    top1AgreementVoteEntropy: toFiniteOrNull(agreementGateTelemetry?.agreementVoteEntropy),
    top1ConsensusLeaderVotes: toFiniteOrNull(agreementGateTelemetry?.consensusLeaderVotes),
    top1ConsensusLeaderVoteShare: toFiniteOrNull(agreementGateTelemetry?.consensusLeaderVoteShare),
    top1VsConsensusLeaderScoreDelta:
      toFiniteOrNull(agreementGateTelemetry?.top1VsConsensusLeaderScoreDelta),
    top1BaseScore: toFiniteOrNull(scoreOriginTrace?.baseScore ?? top?.[0]?.baseScore),
    top1PolicyContractTauRank: toFiniteOrNull(scoreOriginTrace?.policyContractTauRank),
    top1PostScoreAdjustDelta: toFiniteOrNull(scoreOriginTrace?.postScoreAdjustDelta),
    top1FinalScoreAfterRegimeExpert: toFiniteOrNull(scoreOriginTrace?.finalScoreAfterRegimeExpert),
    top1RegimeExpertDelta: toFiniteOrNull(scoreOriginTrace?.regimeExpertDelta),
    top1RegimeExpertMultiplier: toFiniteOrNull(scoreOriginTrace?.regimeExpertMultiplier),
    top1ExtendedBiasDelta: toFiniteOrNull(scoreOriginTrace?.extendedBiasDelta),
    top1TradeQualityPriorDelta: toFiniteOrNull(scoreOriginTrace?.tradeQualityPriorDelta),
    top1ExecutionPriorDelta: toFiniteOrNull(scoreOriginTrace?.executionPriorDelta),
    top1QualityBonus: toFiniteOrNull(scoreOriginTrace?.qualityBonus),
    top1WinRateBonus: toFiniteOrNull(scoreOriginTrace?.winRateBonus),
    top1TargetRateBonus: toFiniteOrNull(scoreOriginTrace?.targetRateBonus),
    top1StopRatePenalty: toFiniteOrNull(scoreOriginTrace?.stopRatePenalty),
    top1StopRatePenaltyRaw: toFiniteOrNull(scoreOriginTrace?.stopRatePenaltyRaw),
    top1StopRatePenaltyRelief: toFiniteOrNull(scoreOriginTrace?.stopRatePenaltyRelief),
    top1StopRatePenaltyReliefSignal: toFiniteOrNull(scoreOriginTrace?.stopRatePenaltyReliefSignal),
    top1AntiPenalty: toFiniteOrNull(scoreOriginTrace?.antiPenalty),
    top1ExpectedRetBonus: toFiniteOrNull(scoreOriginTrace?.expectedRetBonus),
    top1EraSupportCount: toFiniteOrNull(scoreOriginTrace?.clusterTemporalEraSupportCount),
    top1EraCoverageRatio: toFiniteOrNull(scoreOriginTrace?.clusterTemporalEraCoverageRatio),
    top1TargetEraCoverageRatio: toFiniteOrNull(scoreOriginTrace?.targetEraCoverageRatio),
    top1CoveragePenalty: toFiniteOrNull(scoreOriginTrace?.coveragePenalty),
    top1SupportCountPenalty: toFiniteOrNull(scoreOriginTrace?.supportCountPenalty),
    top1SupportCountPenaltyRaw: toFiniteOrNull(scoreOriginTrace?.supportCountPenaltyRaw),
    top1SupportCountPenaltyRelief: toFiniteOrNull(scoreOriginTrace?.supportCountPenaltyRelief),
    top1SupportCountPenaltyReliefSignal:
      toFiniteOrNull(scoreOriginTrace?.supportCountPenaltyReliefSignal),
    top1SingleEraConcentrationPenaltyRaw:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyRaw),
    top1SingleEraConcentrationPenaltyRelief:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyRelief),
    top1SingleEraConcentrationPenaltyEvidenceRatio:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyEvidenceRatio),
    top1SingleEraConcentrationPenalty:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenalty),
    top1EraSupportShortfall: toFiniteOrNull(scoreOriginTrace?.eraSupportShortfall),
    top1EraCoverageShortfall: toFiniteOrNull(scoreOriginTrace?.eraCoverageShortfall),
    top1SingleEraShare: toFiniteOrNull(scoreOriginTrace?.clusterTemporalMaxSingleEraShare),
    top1EffectiveSingleEraShare:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalEffectiveSingleEraShare),
    top1SingleEraEvidenceCoverageRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceCoverageRatio),
    top1SingleEraEvidenceSupportRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceSupportRatio),
    top1ClusterTemporalEffectiveEraCount:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalEffectiveEraCount),
    top1ClusterTemporalNormalizedEraEntropy:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalNormalizedEraEntropy),
    top1SingleEraEvidenceEffectiveEraCountRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio),
    top1SingleEraEvidenceEntropyRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceEntropyRatio),
    top1SingleEraShareCap: toFiniteOrNull(scoreOriginTrace?.maxSingleEraShareCap),
    top1SingleEraShareExcess: toFiniteOrNull(scoreOriginTrace?.singleEraShareExcess),
    top1EraSupportPenaltyReasonRaw: scoreOriginTrace?.eraSupportPenaltyReasonRaw ?? null,
    top1EraSupportPenaltyReason: scoreOriginTrace?.eraSupportPenaltyReason ?? null,
    top1TradeQualityRouteResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityRouteResidual),
    top1TradeQualityRegimeResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityRegimeResidual),
    top1TradeQualityPrototypeResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityPrototypeResidual),
    top1TradeQualityFeatureAdjustment: toFiniteOrNull(scoreOriginTrace?.tradeQualityFeatureAdjustment),
    top1ExecutionPriorLowFillPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorLowFillPenalty),
    top1ExecutionPriorLowFillPenaltyRaw: toFiniteOrNull(scoreOriginTrace?.executionPriorLowFillPenaltyRaw),
    top1ExecutionPriorLowFillPenaltyRelief:
      toFiniteOrNull(scoreOriginTrace?.executionPriorLowFillPenaltyRelief),
    top1ExecutionPriorSlippagePenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorSlippagePenalty),
    top1ExecutionPriorSlippagePenaltyRaw:
      toFiniteOrNull(scoreOriginTrace?.executionPriorSlippagePenaltyRaw),
    top1ExecutionPriorSlippagePenaltyRelief:
      toFiniteOrNull(scoreOriginTrace?.executionPriorSlippagePenaltyRelief),
    top1ExecutionPriorLowLiquidityPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorLowLiquidityPenalty),
    top1ExecutionPriorLowLiquidityPenaltyRaw:
      toFiniteOrNull(scoreOriginTrace?.executionPriorLowLiquidityPenaltyRaw),
    top1ExecutionPriorLowLiquidityPenaltyRelief:
      toFiniteOrNull(scoreOriginTrace?.executionPriorLowLiquidityPenaltyRelief),
    top1ExecutionPriorBlockedOrderPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorBlockedOrderPenalty),
    top1ExecutionPriorPositiveAfterCostBonus: toFiniteOrNull(scoreOriginTrace?.executionPriorPositiveAfterCostBonus),
    top1ExecutionPriorNegativeAfterCostPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorNegativeAfterCostPenalty),
    top1FailedBreakoutCount20: toFiniteOrNull(scoreOriginTrace?.failedBreakoutCount20),
    top1GapFillThenContinueScore: toFiniteOrNull(scoreOriginTrace?.gapFillThenContinueScore),
    top1GapFillThenRevertScore: toFiniteOrNull(scoreOriginTrace?.gapFillThenRevertScore),
    top1ExecutionFeasibilityScore: toFiniteOrNull(scoreOriginTrace?.executionFeasibilityScore),
    top1PrototypeFailedBreakoutCount20:
      toFiniteOrNull(scoreOriginTrace?.prototypeFailedBreakoutCount20),
    top1PrototypeGapFillThenContinueScore:
      toFiniteOrNull(scoreOriginTrace?.prototypeGapFillThenContinueScore),
    top1PrototypeGapFillThenRevertScore:
      toFiniteOrNull(scoreOriginTrace?.prototypeGapFillThenRevertScore),
    top1PrototypeExecutionFeasibilityScore:
      toFiniteOrNull(scoreOriginTrace?.prototypeExecutionFeasibilityScore),
    scorePathologyPrimaryComponent: scoreOriginTrace?.scorePathologyPrimaryComponent ?? null,
    scorePathologySecondaryComponent: scoreOriginTrace?.scorePathologySecondaryComponent ?? null,
    scorePathologyPrimarySubcomponent: scoreOriginTrace?.scorePathologyPrimarySubcomponent ?? null,
    scorePathologySecondarySubcomponent: scoreOriginTrace?.scorePathologySecondarySubcomponent ?? null,
    scorePathologyCompositeType: scoreOriginTrace?.scorePathologyCompositeType ?? null,
    scorePathologyPrimaryPenaltyAbs: toFiniteOrNull(scoreOriginTrace?.componentPenaltyAbs),
    scorePathologyPrimaryPenaltyShare: toFiniteOrNull(scoreOriginTrace?.componentPenaltyShare),
    minFinalScoreShortfall: toFiniteOrNull(scoreOriginTrace?.minFinalScoreShortfall),
    minScoreMarginShortfall: toFiniteOrNull(scoreOriginTrace?.minScoreMarginShortfall),
    topNPassExistsDay: counterfactualGateSweep?.topNPassExistsDay === true,
    bestPassingRank: toFiniteOrNull(counterfactualGateSweep?.bestPassingRank),
    bestPassingSymbol: counterfactualGateSweep?.bestPassingSymbol ?? null,
    bestPassingWouldHitDay: counterfactualGateSweep?.bestPassingWouldHitDay === true,
    top1FailedButAltPassExistsDay:
      counterfactualGateSweep?.top1FailedButAltPassExistsDay === true,
    top1FailedAndNoAltPassExistsDay:
      counterfactualGateSweep?.top1FailedAndNoAltPassExistsDay === true,
    bestAltPassingRank: toFiniteOrNull(counterfactualGateSweep?.bestAltPassingRank),
    bestAltPassingSymbol: counterfactualGateSweep?.bestAltPassingSymbol ?? null,
    bestAltPassingWouldHitDay: counterfactualGateSweep?.bestAltPassingWouldHitDay === true,
    scoreRecoveryEligibleDay: scoreRecoveryTelemetry?.eligible === true,
    scoreRecoveryMode: scoreRecoveryTelemetry?.mode ?? null,
    scoreRecoveryReason: scoreRecoveryTelemetry?.recoveryReason ?? null,
    scoreRecoveryWouldTradeDay: scoreRecoveryTelemetry?.wouldTradeDay === true,
    scoreRecoveryWouldHitDay: scoreRecoveryTelemetry?.wouldHitDay === true,
    scoreRecoveryWouldBeatBlockedTop1Day:
      scoreRecoveryTelemetry?.wouldBeatBlockedTop1Day === true,
    scoreRecoveryRejectReasons: Array.isArray(scoreRecoveryTelemetry?.rejectionReasons)
      ? scoreRecoveryTelemetry.rejectionReasons
      : [],
    scoreRecoveryFalsePositiveRiskAvailable:
      scoreRecoveryTelemetry?.falsePositiveRiskAvailable === true,
    scoreRecalibrationEligibleDay: scoreRecalibrationTelemetry?.eligible === true,
    scoreRecalibrationMode: scoreRecalibrationTelemetry?.mode ?? null,
    scoreRecalibrationPrimaryComponent: scoreRecalibrationTelemetry?.primaryComponent ?? null,
    scoreRecalibrationSecondaryComponent: scoreRecalibrationTelemetry?.secondaryComponent ?? null,
    scoreRecalibrationCompositeType: scoreRecalibrationTelemetry?.compositeType ?? null,
    scoreRecalibrationPrimarySubcomponent: scoreOriginTrace?.scorePathologyPrimarySubcomponent ?? null,
    scoreRecalibrationSecondarySubcomponent: scoreOriginTrace?.scorePathologySecondarySubcomponent ?? null,
    scoreRecalibrationAppliedEraSupportReasonPolicy:
      scoreRecalibrationTelemetry?.appliedEraSupportReasonPolicy ?? null,
    scoreRecalibrationEraSupportPenaltyReason:
      scoreRecalibrationTelemetry?.eraSupportPenaltyReason ?? null,
    scoreRecalibrationEraSupportCount: toFiniteOrNull(scoreRecalibrationTelemetry?.eraSupportCount),
    scoreRecalibrationEraCoverageRatio: toFiniteOrNull(scoreRecalibrationTelemetry?.eraCoverageRatio),
    scoreRecalibrationTargetEraCoverageRatio:
      toFiniteOrNull(scoreRecalibrationTelemetry?.targetEraCoverageRatio),
    scoreRecalibrationEraSupportShortfall:
      toFiniteOrNull(scoreRecalibrationTelemetry?.eraSupportShortfall),
    scoreRecalibrationSingleEraShareExcess:
      toFiniteOrNull(scoreRecalibrationTelemetry?.singleEraShareExcess),
    scoreRecalibrationWouldTradeDay: scoreRecalibrationTelemetry?.wouldTradeDay === true,
    scoreRecalibrationWouldHitDay: scoreRecalibrationTelemetry?.wouldHitDay === true,
    scoreRecalibrationRejectReasons: Array.isArray(scoreRecalibrationTelemetry?.rejectionReasons)
      ? scoreRecalibrationTelemetry.rejectionReasons
      : [],
    pickedSymbols: picked
      .map((it) => String(it?.symbol ?? "").trim())
      .filter(Boolean),
    rankedCandidates: top.map((it, idx) => ({
      rank: idx + 1,
      symbol: String(it?.symbol ?? ""),
      name: String(it?.name ?? it?.symbol ?? ""),
      decisionIdx: Number.isFinite(Number(it?.decisionIdx)) ? Number(it.decisionIdx) : null,
      finalScore: Number(it?.finalScore ?? it?.score ?? 0) || 0,
      rawSimilarityScore: toFiniteOrNull(it?.rawSimilarityScore),
      globalStageScore: toFiniteOrNull(it?.globalStageScore),
      localStageScore: toFiniteOrNull(it?.localStageScore),
      triggerStageScore: toFiniteOrNull(it?.triggerStageScore),
      positiveTop2RawSimilarity: toFiniteOrNull(it?.positiveTop2RawSimilarity),
      top1Top2PositiveGap: toFiniteOrNull(it?.top1Top2PositiveGap),
      positiveVsNegativeGap: toFiniteOrNull(it?.positiveVsNegativeGap),
      negativeTop1RawSimilarity: toFiniteOrNull(it?.negativeTop1RawSimilarity),
      negativeTop1StopRawSimilarity: toFiniteOrNull(it?.negativeTop1StopRawSimilarity),
      negativeTop1TimeoutNegativeRawSimilarity:
        toFiniteOrNull(it?.negativeTop1TimeoutNegativeRawSimilarity),
      negativeTop1LowExecutionQualityRawSimilarity:
        toFiniteOrNull(it?.negativeTop1LowExecutionQualityRawSimilarity),
      positiveTop2PrototypeId: it?.positiveTop2PrototypeId ?? null,
      negativeTop1PrototypeId: it?.negativeTop1PrototypeId ?? null,
      negativeTop1OutcomeBucket: it?.negativeTop1OutcomeBucket ?? null,
      similarityGateRejectReasons: Array.isArray(it?.similarityGateRejectReasons)
        ? it.similarityGateRejectReasons
        : [],
      rankerScore: Number(it?.rankerScore ?? it?.finalScore ?? it?.score ?? 0) || 0,
      executionScore: Number.isFinite(Number(it?.executionScore)) ? Number(it.executionScore) : null,
      agreementScore: Number.isFinite(Number(it?.agreementScore)) ? Number(it.agreementScore) : null,
      agreementDecision: it?.agreementDecision ?? null,
      agreementReason: it?.agreementReason ?? null,
      agreementConsensusRate: Number.isFinite(Number(it?.agreementConsensusRate))
        ? Number(it.agreementConsensusRate)
        : null,
      agreementStabilityRate: Number.isFinite(Number(it?.agreementStabilityRate))
        ? Number(it.agreementStabilityRate)
        : null,
      agreementConsensusCount: Number.isFinite(Number(it?.agreementConsensusCount))
        ? Number(it.agreementConsensusCount)
        : null,
      agreementCandidateUtility: Number.isFinite(Number(it?.agreementCandidateUtility))
        ? Number(it.agreementCandidateUtility)
        : null,
      agreementChecks:
        it?.agreementChecks && typeof it.agreementChecks === "object"
          ? it.agreementChecks
          : null,
      expectedNetRet3d: Number(it?.expectedNetRet3d ?? 0) || 0,
      qualityScore: Number(it?.qualityScore ?? 0) || 0,
      antiScore: Number(it?.antiScore ?? 0) || 0,
      targetRate3d: Number(it?.targetRate3d ?? 0) || 0,
      stopRate3d: Number(it?.stopRate3d ?? 0) || 0,
      routeBucket: it?.routeBucket ?? null,
      regimeTag: it?.regimeTag ?? null,
      prototypeFamilyKey: it?.prototypeFamilyKey ?? null,
      matchedPrototypeId: it?.matchedPrototypeId ?? null,
      matchedPrototypeClusterId: it?.matchedPrototypeClusterId ?? null,
      matchedPrototypeClusterSignature: it?.matchedPrototypeClusterSignature ?? null,
      matchedPrototypeSelectedEraId: it?.matchedPrototypeSelectedEraId ?? null,
      matchedPerfectPrototypeIds: Array.isArray(it?.matchedPerfectPrototypeIds)
        ? it.matchedPerfectPrototypeIds
        : [],
      matchedPerfectPrototypeCount: toSafeCount(it?.matchedPerfectPrototypeCount),
      perfectPrototypePrimaryRuleId: it?.perfectPrototypePrimaryRuleId ?? null,
      perfectPrototypeGatePassed: it?.perfectPrototypeGatePassed === true,
      tradeQualityPriorAdjustment: Number.isFinite(Number(it?.tradeQualityPriorAdjustment))
        ? Number(it.tradeQualityPriorAdjustment)
        : null,
      tradeQualityRankerAdjustment: Number.isFinite(Number(it?.tradeQualityRankerAdjustment))
        ? Number(it.tradeQualityRankerAdjustment)
        : null,
      tradeQualityRankerApplied: it?.tradeQualityRankerApplied === true,
      tradeQualityGlobalScore: Number.isFinite(Number(it?.tradeQualityGlobalScore))
        ? Number(it.tradeQualityGlobalScore)
        : null,
      tradeQualityRouteResidual: Number.isFinite(Number(it?.tradeQualityRouteResidual))
        ? Number(it.tradeQualityRouteResidual)
        : null,
      tradeQualityRegimeResidual: Number.isFinite(Number(it?.tradeQualityRegimeResidual))
        ? Number(it.tradeQualityRegimeResidual)
        : null,
      tradeQualityPrototypeResidual: Number.isFinite(Number(it?.tradeQualityPrototypeResidual))
        ? Number(it.tradeQualityPrototypeResidual)
        : null,
      tradeQualityRouteScore: Number.isFinite(Number(it?.tradeQualityRouteScore))
        ? Number(it.tradeQualityRouteScore)
        : null,
      tradeQualityRegimeScore: Number.isFinite(Number(it?.tradeQualityRegimeScore))
        ? Number(it.tradeQualityRegimeScore)
        : null,
      tradeQualityPrototypeScore: Number.isFinite(Number(it?.tradeQualityPrototypeScore))
        ? Number(it.tradeQualityPrototypeScore)
        : null,
      tradeQualityRouteCount: Number.isFinite(Number(it?.tradeQualityRouteCount))
        ? Number(it.tradeQualityRouteCount)
        : null,
      tradeQualityRegimeCount: Number.isFinite(Number(it?.tradeQualityRegimeCount))
        ? Number(it.tradeQualityRegimeCount)
        : null,
      tradeQualityPrototypeCount: Number.isFinite(Number(it?.tradeQualityPrototypeCount))
        ? Number(it.tradeQualityPrototypeCount)
        : null,
      clusterTemporalEraSupportCount: Number(it?.clusterTemporalEraSupportCount ?? 0) || 0,
      clusterTemporalEraCoverageRatio: Number(it?.clusterTemporalEraCoverageRatio ?? 0) || 0,
      clusterTemporalDominantEraId: it?.clusterTemporalDominantEraId ?? null,
      clusterTemporalDominantEraShare: Number(it?.clusterTemporalDominantEraShare ?? 0) || 0,
      clusterTemporalMaxSingleEraShare: Number(it?.clusterTemporalMaxSingleEraShare ?? 0) || 0,
      clusterTemporalEraSupportMin: Number(it?.clusterTemporalEraSupportMin ?? 0) || 0,
      clusterTemporalEraSupportMedian: Number(it?.clusterTemporalEraSupportMedian ?? 0) || 0,
      clusterTemporalEraWinRateStd: Number(it?.clusterTemporalEraWinRateStd ?? 0) || 0,
      clusterTemporalEraExpectedNetRetStd: Number(it?.clusterTemporalEraExpectedNetRetStd ?? 0) || 0,
      clusterTemporalEraContrastiveLiftStd: Number(it?.clusterTemporalEraContrastiveLiftStd ?? 0) || 0,
      targetDateKey: it?.targetDateKey ?? null,
      groupScores:
        it?.groupScores && typeof it.groupScores === "object"
          ? it.groupScores
          : null,
      rankIndex: Number.isFinite(Number(it?.rankIndex)) ? Number(it.rankIndex) : null,
      rankPct: Number.isFinite(Number(it?.rankPct)) ? Number(it.rankPct) : null,
      rawScoreMargin: Number.isFinite(Number(it?.rawScoreMargin))
        ? Number(it.rawScoreMargin)
        : null,
      preRerankScoreMargin: Number.isFinite(Number(it?.preRerankScoreMargin))
        ? Number(it.preRerankScoreMargin)
        : null,
      postRerankScoreMargin: Number.isFinite(Number(it?.postRerankScoreMargin))
        ? Number(it.postRerankScoreMargin)
        : null,
      gateScoreMargin: Number.isFinite(Number(it?.gateScoreMargin))
        ? Number(it.gateScoreMargin)
        : null,
      negativeMarginAfterRerank: it?.negativeMarginAfterRerank === true,
      pHitCalibrated: Number.isFinite(Number(it?.pHitCalibrated))
        ? Number(it.pHitCalibrated)
        : null,
      pStopFirstCalibrated: Number.isFinite(Number(it?.pStopFirstCalibrated))
        ? Number(it.pStopFirstCalibrated)
        : null,
      pFillCalibrated: Number.isFinite(Number(it?.pFillCalibrated))
        ? Number(it.pFillCalibrated)
        : null,
      confidence: Number.isFinite(Number(it?.confidence))
        ? Number(it.confidence)
        : null,
      metaDecision: it?.metaDecision ?? null,
      falsePositiveModelRisk: Number.isFinite(Number(it?.falsePositiveModelRisk))
        ? Number(it.falsePositiveModelRisk)
        : null,
      falsePositiveRisk: Number.isFinite(Number(it?.falsePositiveRisk)) ? Number(it.falsePositiveRisk) : null,
      falsePositiveDecision: it?.falsePositiveDecision ?? null,
      executionDecision: it?.executionDecision ?? null,
      successInWindow: it?.successInWindow === true
    }))
  }
}

export const toD2ExecutionAuditRow = (logRow) => {
  const row = logRow ?? {}
  const selected = Array.isArray(row?.pickedList) ? row.pickedList : []
  const orderingTrace = toOrderingTraceSummary(
    row?.orderingTrace ?? row?.rankingPolicy?.orderingTrace,
  )
  const scoreOriginTrace = toScoreOriginTraceSummary(row?.scoreOriginTrace)
  const counterfactualGateSweep = toCounterfactualGateSweepSummary(row?.counterfactualGateSweep)
  const scoreRecoveryTelemetry = toScoreRecoveryTelemetrySummary(row?.scoreRecoveryTelemetry)
  const scoreRecalibrationTelemetry = toScoreRecalibrationTelemetrySummary(row?.scoreRecalibrationTelemetry)
  const top1Path = toTop1PathSummary(row?.top1Path)
  const similarityGate = toSimilarityGateSummary(row?.similarityGate)
  const agreementGateTelemetry = toAgreementGateTelemetrySummary(row?.agreementGateTelemetry)
  const decisionCounts = row?.execution?.decisionCounts ?? {}
  const shadowReasonCounts = row?.execution?.shadowReasonCounts ?? {}
  const falsePositiveDecisionCounts = row?.execution?.falsePositiveDecisionCounts ?? {}
  const falsePositiveReasonCounts = row?.execution?.falsePositiveReasonCounts ?? {}
  const budgetDecisionCounts = row?.execution?.budgetDecisionCounts ?? {}
  const budgetReasonCounts = row?.execution?.budgetReasonCounts ?? {}
  const executedSymbols = selected
    .filter((it) => String(it?.executionDecision ?? "").trim().toUpperCase() === "TRADE")
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  const blockedSymbols = selected
    .filter((it) => String(it?.executionDecision ?? "").trim().toUpperCase().startsWith("BLOCK"))
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  const shadowSymbols = selected
    .filter((it) => {
      const decision = String(it?.executionDecision ?? "").trim().toUpperCase()
      return decision && decision !== "TRADE" && !decision.startsWith("BLOCK")
    })
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  const preFalsePositiveApprovedSymbols = selected
    .filter((it) => String(it?.executionDecisionPreFalsePositive ?? "").trim().toUpperCase() === "TRADE")
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  const falsePositiveRejectedSymbols = selected
    .filter((it) => {
      const decision = String(it?.falsePositiveDecision ?? "").trim().toUpperCase()
      return decision.startsWith("SHADOW_FALSE_POSITIVE") || decision.startsWith("BLOCK_FALSE_POSITIVE")
    })
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  const budgetRejectedSymbols = selected
    .filter((it) => {
      const decision = String(it?.budgetDecision ?? "").trim().toUpperCase()
      return decision.startsWith("SHADOW_BUDGET") || decision.startsWith("BLOCK_BUDGET")
    })
    .map((it) => String(it?.symbol ?? "").trim())
    .filter(Boolean)
  return {
    decisionDateKey: String(row?.decisionDateKey ?? ""),
    goalMode: String(row?.goalMode ?? "").trim() || null,
    positionSemantics: String(row?.positionSemantics ?? "").trim() || null,
    targetFirstMode: row?.targetFirstMode === true,
    partition: String(row?.partition ?? "ONLINE"),
    gateReason: String(row?.gateReason ?? "UNKNOWN"),
    dayType: String(row?.dayType?.dayType ?? "BALANCED"),
    dayTypeNoTrade: row?.dayType?.noTrade === true,
    dayTypeShadowNoTrade:
      row?.dayType?.modelMeta?.shadowNoTrade === true || row?.dayType?.shadowNoTrade === true,
    dayTypeGateReason: row?.dayType?.gateReason ?? null,
    dayTypePolicySource: row?.dayType?.policySource ?? null,
    dayTypeModelPredicted: row?.dayType?.modelDecision?.predictedDayType ?? null,
    dayTypeModelApplyMode: row?.dayType?.modelMeta?.applyMode ?? null,
    dayTypeModelShadowReason: row?.dayType?.modelMeta?.shadowReason ?? null,
    dayTypeModelConfidenceBucket: row?.dayType?.modelMeta?.confidenceBucket ?? null,
    ruleDayType: row?.dayTypeRule?.dayType ?? null,
    ruleDayTypeNoTrade: row?.dayTypeRule?.noTrade === true,
    ruleDayTypeGateReason: row?.dayTypeRule?.gateReason ?? null,
    ruleDayTypeReasonCodes: Array.isArray(row?.dayTypeRule?.reasonCodes) ? row.dayTypeRule.reasonCodes : [],
    ruleDayTypePolicySource: row?.dayTypeRule?.policySource ?? null,
    ruleDayTypeSignals:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? row.dayTypeRule.signals
        : null,
    ruleDayTypeSignalSnapshot:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? row.dayTypeRule.signals
        : null,
    ruleDayTypeModelFeatures:
      row?.dayTypeRule?.signals && typeof row.dayTypeRule.signals === "object"
        ? extractDayTypeModelFeatures({ signals: row.dayTypeRule.signals })
        : null,
    dayTypeSignals:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? row.dayType.signals
        : null,
    dayTypeSignalSnapshot:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? row.dayType.signals
        : null,
    dayTypeModelFeatures:
      row?.dayType?.signals && typeof row.dayType.signals === "object"
        ? extractDayTypeModelFeatures({ signals: row.dayType.signals })
        : null,
    perfectPrototypeGate: row?.perfectPrototypeGate ?? null,
    perfectPrototypeGateMode: row?.perfectPrototypeGate?.mode ?? null,
    perfectPrototypeGateMatchedRows: toSafeCount(row?.perfectPrototypeGate?.matchedRows),
    perfectPrototypeGateFilteredRows: toSafeCount(row?.perfectPrototypeGate?.filteredRows),
    perfectPrototypeGateDedupedRows: toSafeCount(row?.perfectPrototypeGate?.dedupedRows),
    orderingTrace,
    scoreOriginTrace,
    counterfactualGateSweep,
    scoreRecoveryTelemetry,
    scoreRecalibrationTelemetry,
    top1Path,
    inputTop1Symbol: orderingTrace?.inputTop1?.symbol ?? null,
    preRerankTop1Symbol: orderingTrace?.preRerankTop1?.symbol ?? null,
    postPrimaryRerankTop1Symbol: orderingTrace?.postPrimaryRerankTop1?.symbol ?? null,
    gateInputTop1Symbol:
      top1Path?.gateInputTop1Symbol ?? orderingTrace?.gateInputTop1?.symbol ?? null,
    finalSelectedTop1Symbol:
      top1Path?.finalSelectedTop1Symbol ?? orderingTrace?.finalSelectedTop1?.symbol ?? null,
    finalExecutedTop1Symbol: top1Path?.finalExecutedTop1Symbol ?? null,
    blockedTop1WasHit: top1Path?.blockedTop1WasHit === true,
    blockedTop1Reason: top1Path?.blockedTop1Reason ?? null,
    agreementFallbackApplied:
      top1Path?.agreementFallbackApplied === true || orderingTrace?.agreementFallbackApplied === true,
    agreementFallbackReason:
      top1Path?.agreementFallbackReason ?? orderingTrace?.agreementFallbackReason ?? null,
    agreementFallbackChosenRank:
      toFiniteOrNull(top1Path?.agreementFallbackChosenRank ?? orderingTrace?.agreementFallbackChosenRank),
    agreementFallbackBlockedRank:
      toFiniteOrNull(top1Path?.agreementFallbackBlockedRank ?? orderingTrace?.agreementFallbackBlockedRank),
    agreementFallbackBlockedSymbol:
      top1Path?.agreementFallbackBlockedSymbol ?? orderingTrace?.agreementFallbackBlockedSymbol ?? null,
    agreementFallbackSelectionChanged:
      top1Path?.agreementFallbackSelectionChanged === true ||
      orderingTrace?.agreementFallbackSelectionChanged === true,
    swapCandidatePoolSize: orderingTrace?.swapCandidatePoolSize ?? null,
    swapRejectedReason:
      orderingTrace?.primaryRerankApplied === true ? null : orderingTrace?.primaryRerankReason ?? null,
    agreementEnforcementMode: orderingTrace?.agreementEnforcementMode ?? null,
    similarityGate,
    agreementGateTelemetry,
    agreementBlockedDay: agreementGateTelemetry?.blockedDay === true,
    agreementBlockedTop1WouldHaveHitDay:
      agreementGateTelemetry?.blockedTop1WouldHaveHitDay === true,
    agreementModelUnavailableDay: agreementGateTelemetry?.modelUnavailableDay === true,
    agreementDisagreementPattern: agreementGateTelemetry?.disagreementPattern ?? null,
    agreementConsensusLeaderSymbol: agreementGateTelemetry?.consensusLeaderSymbol ?? null,
    agreementConsensusLeaderMatchesTop1:
      agreementGateTelemetry?.consensusLeaderMatchesTop1 === true,
    top1BaseScore: toFiniteOrNull(scoreOriginTrace?.baseScore),
    top1PolicyContractTauRank: toFiniteOrNull(scoreOriginTrace?.policyContractTauRank),
    top1PostScoreAdjustDelta: toFiniteOrNull(scoreOriginTrace?.postScoreAdjustDelta),
    top1FinalScoreAfterRegimeExpert: toFiniteOrNull(scoreOriginTrace?.finalScoreAfterRegimeExpert),
    top1RegimeExpertDelta: toFiniteOrNull(scoreOriginTrace?.regimeExpertDelta),
    top1RegimeExpertMultiplier: toFiniteOrNull(scoreOriginTrace?.regimeExpertMultiplier),
    top1ExtendedBiasDelta: toFiniteOrNull(scoreOriginTrace?.extendedBiasDelta),
    top1TradeQualityPriorDelta: toFiniteOrNull(scoreOriginTrace?.tradeQualityPriorDelta),
    top1ExecutionPriorDelta: toFiniteOrNull(scoreOriginTrace?.executionPriorDelta),
    top1QualityBonus: toFiniteOrNull(scoreOriginTrace?.qualityBonus),
    top1WinRateBonus: toFiniteOrNull(scoreOriginTrace?.winRateBonus),
    top1TargetRateBonus: toFiniteOrNull(scoreOriginTrace?.targetRateBonus),
    top1StopRatePenalty: toFiniteOrNull(scoreOriginTrace?.stopRatePenalty),
    top1AntiPenalty: toFiniteOrNull(scoreOriginTrace?.antiPenalty),
    top1ExpectedRetBonus: toFiniteOrNull(scoreOriginTrace?.expectedRetBonus),
    top1EraSupportCount: toFiniteOrNull(scoreOriginTrace?.clusterTemporalEraSupportCount),
    top1EraCoverageRatio: toFiniteOrNull(scoreOriginTrace?.clusterTemporalEraCoverageRatio),
    top1TargetEraCoverageRatio: toFiniteOrNull(scoreOriginTrace?.targetEraCoverageRatio),
    top1CoveragePenalty: toFiniteOrNull(scoreOriginTrace?.coveragePenalty),
    top1SupportCountPenalty: toFiniteOrNull(scoreOriginTrace?.supportCountPenalty),
    top1SupportCountPenaltyRaw: toFiniteOrNull(scoreOriginTrace?.supportCountPenaltyRaw),
    top1SupportCountPenaltyRelief: toFiniteOrNull(scoreOriginTrace?.supportCountPenaltyRelief),
    top1SingleEraConcentrationPenaltyRaw:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyRaw),
    top1SingleEraConcentrationPenaltyRelief:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyRelief),
    top1SingleEraConcentrationPenaltyEvidenceRatio:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenaltyEvidenceRatio),
    top1SingleEraConcentrationPenalty:
      toFiniteOrNull(scoreOriginTrace?.singleEraConcentrationPenalty),
    top1EraSupportShortfall: toFiniteOrNull(scoreOriginTrace?.eraSupportShortfall),
    top1EraCoverageShortfall: toFiniteOrNull(scoreOriginTrace?.eraCoverageShortfall),
    top1SingleEraShare: toFiniteOrNull(scoreOriginTrace?.clusterTemporalMaxSingleEraShare),
    top1EffectiveSingleEraShare:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalEffectiveSingleEraShare),
    top1SingleEraEvidenceCoverageRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceCoverageRatio),
    top1SingleEraEvidenceSupportRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceSupportRatio),
    top1ClusterTemporalEffectiveEraCount:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalEffectiveEraCount),
    top1ClusterTemporalNormalizedEraEntropy:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalNormalizedEraEntropy),
    top1SingleEraEvidenceEffectiveEraCountRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio),
    top1SingleEraEvidenceEntropyRatio:
      toFiniteOrNull(scoreOriginTrace?.clusterTemporalSingleEraEvidenceEntropyRatio),
    top1SingleEraShareCap: toFiniteOrNull(scoreOriginTrace?.maxSingleEraShareCap),
    top1SingleEraShareExcess: toFiniteOrNull(scoreOriginTrace?.singleEraShareExcess),
    top1EraSupportPenaltyReasonRaw: scoreOriginTrace?.eraSupportPenaltyReasonRaw ?? null,
    top1EraSupportPenaltyReason: scoreOriginTrace?.eraSupportPenaltyReason ?? null,
    top1TradeQualityRouteResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityRouteResidual),
    top1TradeQualityRegimeResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityRegimeResidual),
    top1TradeQualityPrototypeResidual: toFiniteOrNull(scoreOriginTrace?.tradeQualityPrototypeResidual),
    top1ExecutionPriorLowFillPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorLowFillPenalty),
    top1ExecutionPriorSlippagePenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorSlippagePenalty),
    top1ExecutionPriorLowLiquidityPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorLowLiquidityPenalty),
    top1ExecutionPriorBlockedOrderPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorBlockedOrderPenalty),
    top1ExecutionPriorPositiveAfterCostBonus: toFiniteOrNull(scoreOriginTrace?.executionPriorPositiveAfterCostBonus),
    top1ExecutionPriorNegativeAfterCostPenalty: toFiniteOrNull(scoreOriginTrace?.executionPriorNegativeAfterCostPenalty),
    scorePathologyPrimaryComponent: scoreOriginTrace?.scorePathologyPrimaryComponent ?? null,
    scorePathologySecondaryComponent: scoreOriginTrace?.scorePathologySecondaryComponent ?? null,
    scorePathologyPrimarySubcomponent: scoreOriginTrace?.scorePathologyPrimarySubcomponent ?? null,
    scorePathologySecondarySubcomponent: scoreOriginTrace?.scorePathologySecondarySubcomponent ?? null,
    scorePathologyCompositeType: scoreOriginTrace?.scorePathologyCompositeType ?? null,
    scorePathologyPrimaryPenaltyAbs: toFiniteOrNull(scoreOriginTrace?.componentPenaltyAbs),
    scorePathologyPrimaryPenaltyShare: toFiniteOrNull(scoreOriginTrace?.componentPenaltyShare),
    minFinalScoreShortfall: toFiniteOrNull(scoreOriginTrace?.minFinalScoreShortfall),
    minScoreMarginShortfall: toFiniteOrNull(scoreOriginTrace?.minScoreMarginShortfall),
    topNPassExistsDay: counterfactualGateSweep?.topNPassExistsDay === true,
    bestPassingRank: toFiniteOrNull(counterfactualGateSweep?.bestPassingRank),
    bestPassingSymbol: counterfactualGateSweep?.bestPassingSymbol ?? null,
    bestPassingWouldHitDay: counterfactualGateSweep?.bestPassingWouldHitDay === true,
    top1FailedButAltPassExistsDay:
      counterfactualGateSweep?.top1FailedButAltPassExistsDay === true,
    top1FailedAndNoAltPassExistsDay:
      counterfactualGateSweep?.top1FailedAndNoAltPassExistsDay === true,
    bestAltPassingRank: toFiniteOrNull(counterfactualGateSweep?.bestAltPassingRank),
    bestAltPassingSymbol: counterfactualGateSweep?.bestAltPassingSymbol ?? null,
    bestAltPassingWouldHitDay: counterfactualGateSweep?.bestAltPassingWouldHitDay === true,
    scoreRecoveryEligibleDay: scoreRecoveryTelemetry?.eligible === true,
    scoreRecoveryMode: scoreRecoveryTelemetry?.mode ?? null,
    scoreRecoveryReason: scoreRecoveryTelemetry?.recoveryReason ?? null,
    scoreRecoveryWouldTradeDay: scoreRecoveryTelemetry?.wouldTradeDay === true,
    scoreRecoveryWouldHitDay: scoreRecoveryTelemetry?.wouldHitDay === true,
    scoreRecoveryWouldBeatBlockedTop1Day:
      scoreRecoveryTelemetry?.wouldBeatBlockedTop1Day === true,
    scoreRecoveryRejectReasons: Array.isArray(scoreRecoveryTelemetry?.rejectionReasons)
      ? scoreRecoveryTelemetry.rejectionReasons
      : [],
    scoreRecoveryFalsePositiveRiskAvailable:
      scoreRecoveryTelemetry?.falsePositiveRiskAvailable === true,
    scoreRecalibrationEligibleDay: scoreRecalibrationTelemetry?.eligible === true,
    scoreRecalibrationMode: scoreRecalibrationTelemetry?.mode ?? null,
    scoreRecalibrationPrimaryComponent: scoreRecalibrationTelemetry?.primaryComponent ?? null,
    scoreRecalibrationSecondaryComponent: scoreRecalibrationTelemetry?.secondaryComponent ?? null,
    scoreRecalibrationCompositeType: scoreRecalibrationTelemetry?.compositeType ?? null,
    scoreRecalibrationPrimarySubcomponent: scoreOriginTrace?.scorePathologyPrimarySubcomponent ?? null,
    scoreRecalibrationSecondarySubcomponent: scoreOriginTrace?.scorePathologySecondarySubcomponent ?? null,
    scoreRecalibrationAppliedEraSupportReasonPolicy:
      scoreRecalibrationTelemetry?.appliedEraSupportReasonPolicy ?? null,
    scoreRecalibrationEraSupportPenaltyReason:
      scoreRecalibrationTelemetry?.eraSupportPenaltyReason ?? null,
    scoreRecalibrationEraSupportCount: toFiniteOrNull(scoreRecalibrationTelemetry?.eraSupportCount),
    scoreRecalibrationEraCoverageRatio: toFiniteOrNull(scoreRecalibrationTelemetry?.eraCoverageRatio),
    scoreRecalibrationTargetEraCoverageRatio:
      toFiniteOrNull(scoreRecalibrationTelemetry?.targetEraCoverageRatio),
    scoreRecalibrationEraSupportShortfall:
      toFiniteOrNull(scoreRecalibrationTelemetry?.eraSupportShortfall),
    scoreRecalibrationSingleEraShareExcess:
      toFiniteOrNull(scoreRecalibrationTelemetry?.singleEraShareExcess),
    scoreRecalibrationWouldTradeDay: scoreRecalibrationTelemetry?.wouldTradeDay === true,
    scoreRecalibrationWouldHitDay: scoreRecalibrationTelemetry?.wouldHitDay === true,
    scoreRecalibrationRejectReasons: Array.isArray(scoreRecalibrationTelemetry?.rejectionReasons)
      ? scoreRecalibrationTelemetry.rejectionReasons
      : [],
    winnerChangedAfterSimilarityGateDay: row?.winnerChangedAfterSimilarityGateDay === true,
    top1RejectedBySimilarityGateDay: row?.top1RejectedBySimilarityGateDay === true,
    oracleHitRejectedBySimilarityGateDay: row?.oracleHitRejectedBySimilarityGateDay === true,
    preGateTop1: toSimilarityTopCandidateSummary(row?.preGateTop1),
    selectionCount: toSafeCount(row?.pickCount, selected.length),
    preFalsePositiveApprovedCount: toSafeCount(
      row?.execution?.preFalsePositiveApprovedCount,
      preFalsePositiveApprovedSymbols.length,
    ),
    executionApprovedRawCount: toSafeCount(
      row?.execution?.approvedRawCount,
      executedSymbols.length,
    ),
    executedCount: toSafeCount(row?.execution?.approvedCount, executedSymbols.length),
    shadowCount: toSafeCount(row?.execution?.shadowCount, shadowSymbols.length),
    blockedCount: toSafeCount(row?.execution?.blockedCount, blockedSymbols.length),
    decisionCounts,
    shadowReasonCounts,
    falsePositiveDecisionCounts,
    falsePositiveReasonCounts,
    budgetDecisionCounts,
    budgetReasonCounts,
    falsePositiveRejectedCount: toSafeCount(
      row?.execution?.falsePositiveRejectedCount,
      falsePositiveRejectedSymbols.length,
    ),
    falsePositiveRejectedHitCount: toSafeCount(row?.execution?.falsePositiveRejectedHitCount),
    falsePositiveRejectedMissCount: toSafeCount(row?.execution?.falsePositiveRejectedMissCount),
    budgetRejectedCount: toSafeCount(row?.execution?.budgetRejectedCount, budgetRejectedSymbols.length),
    budgetRejectedHitCount: toSafeCount(row?.execution?.budgetRejectedHitCount),
    budgetRejectedMissCount: toSafeCount(row?.execution?.budgetRejectedMissCount),
    executedSymbols,
    blockedSymbols,
    shadowSymbols,
    preFalsePositiveApprovedSymbols,
    falsePositiveRejectedSymbols,
    budgetRejectedSymbols,
    selectedCandidates: selected.map((it) => ({
      symbol: String(it?.symbol ?? ""),
      name: String(it?.name ?? it?.symbol ?? ""),
      decisionIdx: Number.isFinite(Number(it?.decisionIdx)) ? Number(it.decisionIdx) : null,
      finalScore: Number(it?.finalScore ?? 0) || 0,
      rawSimilarityScore: toFiniteOrNull(it?.rawSimilarityScore),
      globalStageScore: toFiniteOrNull(it?.globalStageScore),
      localStageScore: toFiniteOrNull(it?.localStageScore),
      triggerStageScore: toFiniteOrNull(it?.triggerStageScore),
      positiveTop2RawSimilarity: toFiniteOrNull(it?.positiveTop2RawSimilarity),
      top1Top2PositiveGap: toFiniteOrNull(it?.top1Top2PositiveGap),
      positiveVsNegativeGap: toFiniteOrNull(it?.positiveVsNegativeGap),
      negativeTop1RawSimilarity: toFiniteOrNull(it?.negativeTop1RawSimilarity),
      negativeTop1StopRawSimilarity: toFiniteOrNull(it?.negativeTop1StopRawSimilarity),
      negativeTop1TimeoutNegativeRawSimilarity:
        toFiniteOrNull(it?.negativeTop1TimeoutNegativeRawSimilarity),
      negativeTop1LowExecutionQualityRawSimilarity:
        toFiniteOrNull(it?.negativeTop1LowExecutionQualityRawSimilarity),
      positiveTop2PrototypeId: it?.positiveTop2PrototypeId ?? null,
      negativeTop1PrototypeId: it?.negativeTop1PrototypeId ?? null,
      negativeTop1OutcomeBucket: it?.negativeTop1OutcomeBucket ?? null,
      similarityGateRejectReasons: Array.isArray(it?.similarityGateRejectReasons)
        ? it.similarityGateRejectReasons
        : [],
      rankerScore: Number(it?.rankerScore ?? it?.finalScore ?? it?.score ?? 0) || 0,
      executionScore: Number.isFinite(Number(it?.executionScore)) ? Number(it.executionScore) : null,
      agreementScore: Number.isFinite(Number(it?.agreementScore)) ? Number(it.agreementScore) : null,
      agreementDecision: it?.agreementDecision ?? null,
      agreementReason: it?.agreementReason ?? null,
      agreementConsensusRate: Number.isFinite(Number(it?.agreementConsensusRate))
        ? Number(it.agreementConsensusRate)
        : null,
      agreementStabilityRate: Number.isFinite(Number(it?.agreementStabilityRate))
        ? Number(it.agreementStabilityRate)
        : null,
      agreementConsensusCount: Number.isFinite(Number(it?.agreementConsensusCount))
        ? Number(it.agreementConsensusCount)
        : null,
      agreementCandidateUtility: Number.isFinite(Number(it?.agreementCandidateUtility))
        ? Number(it.agreementCandidateUtility)
        : null,
      agreementChecks:
        it?.agreementChecks && typeof it.agreementChecks === "object"
          ? it.agreementChecks
          : null,
      expectedNetRet3d: Number(it?.expectedNetRet3d ?? 0) || 0,
      qualityScore: Number(it?.qualityScore ?? 0) || 0,
      antiScore: Number(it?.antiScore ?? 0) || 0,
      winRate3d: Number.isFinite(Number(it?.winRate3d)) ? Number(it.winRate3d) : null,
      targetRate3d: Number(it?.targetRate3d ?? 0) || 0,
      stopRate3d: Number(it?.stopRate3d ?? 0) || 0,
      routeBucket: it?.routeBucket ?? null,
      regimeTag: it?.regimeTag ?? null,
      prototypeFamilyKey: it?.prototypeFamilyKey ?? null,
      matchedPrototypeId: it?.matchedPrototypeId ?? null,
      matchedPrototypeClusterId: it?.matchedPrototypeClusterId ?? null,
      matchedPrototypeClusterSignature: it?.matchedPrototypeClusterSignature ?? null,
      matchedPrototypeSelectedEraId: it?.matchedPrototypeSelectedEraId ?? null,
      matchedPerfectPrototypeIds: Array.isArray(it?.matchedPerfectPrototypeIds)
        ? it.matchedPerfectPrototypeIds
        : [],
      matchedPerfectPrototypeCount: toSafeCount(it?.matchedPerfectPrototypeCount),
      perfectPrototypePrimaryRuleId: it?.perfectPrototypePrimaryRuleId ?? null,
      perfectPrototypeGatePassed: it?.perfectPrototypeGatePassed === true,
      tradeQualityPriorAdjustment: Number.isFinite(Number(it?.tradeQualityPriorAdjustment))
        ? Number(it.tradeQualityPriorAdjustment)
        : null,
      tradeQualityRankerAdjustment: Number.isFinite(Number(it?.tradeQualityRankerAdjustment))
        ? Number(it.tradeQualityRankerAdjustment)
        : null,
      tradeQualityRankerApplied: it?.tradeQualityRankerApplied === true,
      tradeQualityGlobalScore: Number.isFinite(Number(it?.tradeQualityGlobalScore))
        ? Number(it.tradeQualityGlobalScore)
        : null,
      tradeQualityRouteResidual: Number.isFinite(Number(it?.tradeQualityRouteResidual))
        ? Number(it.tradeQualityRouteResidual)
        : null,
      tradeQualityRegimeResidual: Number.isFinite(Number(it?.tradeQualityRegimeResidual))
        ? Number(it.tradeQualityRegimeResidual)
        : null,
      tradeQualityPrototypeResidual: Number.isFinite(Number(it?.tradeQualityPrototypeResidual))
        ? Number(it.tradeQualityPrototypeResidual)
        : null,
      tradeQualityRouteScore: Number.isFinite(Number(it?.tradeQualityRouteScore))
        ? Number(it.tradeQualityRouteScore)
        : null,
      tradeQualityRegimeScore: Number.isFinite(Number(it?.tradeQualityRegimeScore))
        ? Number(it.tradeQualityRegimeScore)
        : null,
      tradeQualityPrototypeScore: Number.isFinite(Number(it?.tradeQualityPrototypeScore))
        ? Number(it.tradeQualityPrototypeScore)
        : null,
      tradeQualityRouteCount: Number.isFinite(Number(it?.tradeQualityRouteCount))
        ? Number(it.tradeQualityRouteCount)
        : null,
      tradeQualityRegimeCount: Number.isFinite(Number(it?.tradeQualityRegimeCount))
        ? Number(it.tradeQualityRegimeCount)
        : null,
      tradeQualityPrototypeCount: Number.isFinite(Number(it?.tradeQualityPrototypeCount))
        ? Number(it.tradeQualityPrototypeCount)
        : null,
      clusterTemporalEraSupportCount: Number(it?.clusterTemporalEraSupportCount ?? 0) || 0,
      clusterTemporalEraCoverageRatio: Number(it?.clusterTemporalEraCoverageRatio ?? 0) || 0,
      clusterTemporalDominantEraId: it?.clusterTemporalDominantEraId ?? null,
      clusterTemporalDominantEraShare: Number(it?.clusterTemporalDominantEraShare ?? 0) || 0,
      clusterTemporalMaxSingleEraShare: Number(it?.clusterTemporalMaxSingleEraShare ?? 0) || 0,
      clusterTemporalEraSupportMin: Number(it?.clusterTemporalEraSupportMin ?? 0) || 0,
      clusterTemporalEraSupportMedian: Number(it?.clusterTemporalEraSupportMedian ?? 0) || 0,
      clusterTemporalEraWinRateStd: Number(it?.clusterTemporalEraWinRateStd ?? 0) || 0,
      clusterTemporalEraExpectedNetRetStd: Number(it?.clusterTemporalEraExpectedNetRetStd ?? 0) || 0,
      clusterTemporalEraContrastiveLiftStd: Number(it?.clusterTemporalEraContrastiveLiftStd ?? 0) || 0,
      targetDateKey: it?.targetDateKey ?? null,
      groupScores:
        it?.groupScores && typeof it.groupScores === "object"
          ? it.groupScores
          : null,
      rawScoreMargin: Number.isFinite(Number(it?.rawScoreMargin))
        ? Number(it.rawScoreMargin)
        : null,
      preRerankScoreMargin: Number.isFinite(Number(it?.preRerankScoreMargin))
        ? Number(it.preRerankScoreMargin)
        : null,
      postRerankScoreMargin: Number.isFinite(Number(it?.postRerankScoreMargin))
        ? Number(it.postRerankScoreMargin)
        : null,
      gateScoreMargin: Number.isFinite(Number(it?.gateScoreMargin))
        ? Number(it.gateScoreMargin)
        : null,
      negativeMarginAfterRerank: it?.negativeMarginAfterRerank === true,
      avgTradingValue20dKrw: Number(it?.avgTradingValue20dKrw ?? 0) || 0,
      dataFreshnessDays: Number(it?.dataFreshnessDays ?? 0) || 0,
      spreadProxyPct: Number(it?.spreadProxyPct ?? 0) || 0,
      slippageRisk: Number(it?.slippageRisk ?? 0) || 0,
      pHitCalibrated: Number.isFinite(Number(it?.pHitCalibrated))
        ? Number(it.pHitCalibrated)
        : null,
      pStopFirstCalibrated: Number.isFinite(Number(it?.pStopFirstCalibrated))
        ? Number(it.pStopFirstCalibrated)
        : null,
      pFillCalibrated: Number.isFinite(Number(it?.pFillCalibrated))
        ? Number(it.pFillCalibrated)
        : null,
      confidence: Number.isFinite(Number(it?.confidence))
        ? Number(it.confidence)
        : null,
      metaDecision: it?.metaDecision ?? null,
      metaReason: it?.metaReason ?? null,
      executionDecisionPreFalsePositive: it?.executionDecisionPreFalsePositive ?? null,
      executionShadowReasonPreFalsePositive: it?.executionShadowReasonPreFalsePositive ?? null,
      falsePositiveModelRisk: Number.isFinite(Number(it?.falsePositiveModelRisk))
        ? Number(it.falsePositiveModelRisk)
        : null,
      falsePositiveRisk: Number.isFinite(Number(it?.falsePositiveRisk)) ? Number(it.falsePositiveRisk) : null,
      falsePositiveDecision: it?.falsePositiveDecision ?? null,
      falsePositiveReason: it?.falsePositiveReason ?? null,
      falsePositiveChecks: it?.falsePositiveChecks ?? {},
      budgetDecision: it?.budgetDecision ?? null,
      budgetReason: it?.budgetReason ?? null,
      budgetChecks: it?.budgetChecks ?? {},
      executionDecision: it?.executionDecision ?? null,
      executionShadowReason: it?.executionShadowReason ?? null,
      executionChecks: it?.executionChecks ?? {},
      successInWindow: it?.successInWindow === true
    }))
  }
}
