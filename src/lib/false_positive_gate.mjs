const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const toInt = (value, fallback = 0) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0))
  return Math.max(0, Math.floor(n))
}

const toFiniteOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const hasFiniteThreshold = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))

const normalizeAction = (value) => {
  const text = String(value ?? "shadow").trim().toLowerCase()
  if (text === "block") return "block"
  return "shadow"
}

const normalizeDecisionMode = (value) => {
  const text = String(value ?? "model_only").trim().toLowerCase()
  if (text === "fallback_only") return "fallback_only"
  if (text === "blend_with_fallback") return "blend_with_fallback"
  return "model_only"
}

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
}

const normalizeUpperStringList = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? "").trim().toUpperCase())
    .filter(Boolean)
}

const normalizeInteractionBlockList = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const prototypeClusterId = String(
        row?.prototypeClusterId ?? row?.matchedPrototypeClusterId ?? "",
      )
        .trim()
      const agreementDecision = String(row?.agreementDecision ?? "")
        .trim()
        .toUpperCase()
      const agreementReason = String(row?.agreementReason ?? "").trim()
      const routeBucket = String(row?.routeBucket ?? "").trim()
      const regimeTag = String(row?.regimeTag ?? "").trim()
      const dayType = String(row?.dayType ?? "").trim()
      const dayTypePolicySource = String(row?.dayTypePolicySource ?? "").trim()
      const minFalsePositiveModelRisk = toFiniteOrNull(row?.minFalsePositiveModelRisk)
      const minFalsePositiveRisk = toFiniteOrNull(row?.minFalsePositiveRisk)
      if (
        !prototypeClusterId &&
        !agreementDecision &&
        !agreementReason &&
        !routeBucket &&
        !regimeTag &&
        !dayType &&
        !dayTypePolicySource &&
        minFalsePositiveModelRisk === null &&
        minFalsePositiveRisk === null
      ) {
        return null
      }
      return {
        prototypeClusterId,
        agreementDecision,
        agreementReason,
        routeBucket,
        regimeTag,
        dayType,
        dayTypePolicySource,
        minFalsePositiveModelRisk,
        minFalsePositiveRisk
      }
    })
    .filter(Boolean)
}

const buildStatsMap = (raw) => {
  const out = new Map()
  const source = raw && typeof raw === "object" ? raw : {}
  for (const [keyRaw, rowRaw] of Object.entries(source)) {
    const key = String(keyRaw ?? "").trim()
    if (!key) continue
    const count = Math.max(0, Number(rowRaw?.count ?? 0) || 0)
    const falsePositiveCount = Math.max(
      0,
      Math.min(count, Number(rowRaw?.falsePositiveCount ?? 0) || 0),
    )
    if (count < 1 && falsePositiveCount < 1) continue
    out.set(key, {
      count,
      falsePositiveCount
    })
  }
  return out
}

const posteriorRisk = ({ count, falsePositiveCount, priorCount, priorRisk }) => {
  const n = Math.max(0, Number(count ?? 0) || 0)
  const fp = Math.max(0, Math.min(n, Number(falsePositiveCount ?? 0) || 0))
  const pCount = Math.max(1e-6, Number(priorCount ?? 8) || 8)
  const pRisk = clamp01(priorRisk ?? 0.5)
  return clamp01((fp + pRisk * pCount) / (n + pCount))
}

const getMapStats = (map, key) => {
  const safeKey = String(key ?? "").trim()
  if (!safeKey || !(map instanceof Map)) {
    return { count: 0, falsePositiveCount: 0 }
  }
  const row = map.get(safeKey) ?? null
  return {
    count: Math.max(0, Number(row?.count ?? 0) || 0),
    falsePositiveCount: Math.max(0, Number(row?.falsePositiveCount ?? 0) || 0)
  }
}

export const resolveFalsePositiveGate = (raw) => {
  const cfg = raw ?? {}
  const history = cfg?.history ?? {}
  const heuristics = cfg?.heuristics ?? {}
  const edgeAwareOverride = cfg?.edgeAwareOverride ?? {}
  const prototypeTradeGuard = edgeAwareOverride?.prototypeTradeGuard ?? {}
  const strongCandidateBypass = cfg?.strongCandidateBypass ?? {}
  return {
    enabled: cfg?.enabled === true,
    action: normalizeAction(cfg?.action),
    maxRisk: clamp01(cfg?.maxRisk ?? 0.58),
    minGlobalSamples: toInt(cfg?.minGlobalSamples, 48),
    minSegmentSamples: toInt(cfg?.minSegmentSamples, 12),
    blockWhenUnknown: cfg?.blockWhenUnknown === true,
    shadowWhenUnknown: cfg?.shadowWhenUnknown === true,
    calibrationWindowDays: toInt(cfg?.calibrationWindowDays, 160),
    history: {
      priorCount: Math.max(1e-6, Number(history?.priorCount ?? 8) || 8),
      priorRisk: clamp01(history?.priorRisk ?? 0.5),
      globalWeight: Math.max(0, Number(history?.globalWeight ?? 0.4) || 0),
      routeBucketWeight: Math.max(0, Number(history?.routeBucketWeight ?? 0.25) || 0),
      regimeWeight: Math.max(0, Number(history?.regimeWeight ?? 0.2) || 0),
      prototypeWeight: Math.max(0, Number(history?.prototypeWeight ?? 0.15) || 0)
    },
    heuristics: {
      enabled: heuristics?.enabled !== false,
      weight: Math.max(0, Number(heuristics?.weight ?? 0.35) || 0),
      pStopWeight: Math.max(0, Number(heuristics?.pStopWeight ?? 1.2) || 0),
      lowFillWeight: Math.max(0, Number(heuristics?.lowFillWeight ?? 0.9) || 0),
      lowMarginWeight: Math.max(0, Number(heuristics?.lowMarginWeight ?? 0.8) || 0),
      lowQualityWeight: Math.max(0, Number(heuristics?.lowQualityWeight ?? 0.65) || 0),
      antiScoreWeight: Math.max(0, Number(heuristics?.antiScoreWeight ?? 0.7) || 0),
      slippageRiskWeight: Math.max(0, Number(heuristics?.slippageRiskWeight ?? 0.6) || 0),
      lowLiquidityWeight: Math.max(0, Number(heuristics?.lowLiquidityWeight ?? 0.55) || 0),
      negativeExpectedRetWeight: Math.max(
        0,
        Number(heuristics?.negativeExpectedRetWeight ?? 0.5) || 0,
      ),
      minScoreMargin: toFiniteOrNull(heuristics?.minScoreMargin ?? 0.0015),
      minFillProb: clamp01(heuristics?.minFillProb ?? 0.55),
      minQualityScore: clamp01(heuristics?.minQualityScore ?? 0.58),
      minAvgTradingValue20dKrw: Math.max(
        0,
        Number(heuristics?.minAvgTradingValue20dKrw ?? 800_000_000) || 0,
      ),
      expectedRetScale: Math.max(1e-6, Number(heuristics?.expectedRetScale ?? 0.015) || 0.015),
      slippageRiskScale: Math.max(1e-6, Number(heuristics?.slippageRiskScale ?? 0.08) || 0.08)
    },
    edgeAwareOverride: {
      enabled: edgeAwareOverride?.enabled === true,
      minTargetStopEdge3d: Number(edgeAwareOverride?.minTargetStopEdge3d ?? 0.06),
      minExpectedNetRet3d: Number(edgeAwareOverride?.minExpectedNetRet3d ?? 0.015),
      minFillProb: clamp01(edgeAwareOverride?.minFillProb ?? 0.78),
      maxPStopFirst: clamp01(edgeAwareOverride?.maxPStopFirst ?? 0.52),
      minConfidence: clamp01(edgeAwareOverride?.minConfidence ?? 0.08),
      minScoreMargin: toFiniteOrNull(edgeAwareOverride?.minScoreMargin ?? 0.0015),
      minAvgTradingValue20dKrw: toFiniteOrNull(edgeAwareOverride?.minAvgTradingValue20dKrw),
      maxSpreadProxyPct: toFiniteOrNull(edgeAwareOverride?.maxSpreadProxyPct),
      maxSlippageRisk: toFiniteOrNull(edgeAwareOverride?.maxSlippageRisk),
      requireAgreementTrade: edgeAwareOverride?.requireAgreementTrade === true,
      blockedAgreementDecisions: normalizeUpperStringList(
        edgeAwareOverride?.blockedAgreementDecisions,
      ),
      blockedAgreementReasons: normalizeStringList(edgeAwareOverride?.blockedAgreementReasons),
      interactionBlocks: normalizeInteractionBlockList(edgeAwareOverride?.interactionBlocks),
      prototypeTradeGuard: {
        enabled: prototypeTradeGuard?.enabled === true,
        applyWhenAgreementTradeOnly: prototypeTradeGuard?.applyWhenAgreementTradeOnly !== false,
        minPrototypeSamples: toInt(prototypeTradeGuard?.minPrototypeSamples, 0),
        maxPrototypeFalsePositiveRate: toFiniteOrNull(
          prototypeTradeGuard?.maxPrototypeFalsePositiveRate,
        ),
        requireModelDominant: prototypeTradeGuard?.requireModelDominant === true
      }
    },
    strongCandidateBypass: {
      enabled: strongCandidateBypass?.enabled === true,
      maxRisk: toFiniteOrNull(strongCandidateBypass?.maxRisk),
      requireMicroCorrection: strongCandidateBypass?.requireMicroCorrection === true,
      minFinalScore: toFiniteOrNull(strongCandidateBypass?.minFinalScore),
      minScoreMargin: toFiniteOrNull(strongCandidateBypass?.minScoreMargin),
      minAvgTradingValue20dKrw: toFiniteOrNull(strongCandidateBypass?.minAvgTradingValue20dKrw),
      maxSpreadProxyPct: toFiniteOrNull(strongCandidateBypass?.maxSpreadProxyPct),
      maxSlippageRisk: toFiniteOrNull(strongCandidateBypass?.maxSlippageRisk),
      minExpectedNetRet3d: toFiniteOrNull(strongCandidateBypass?.minExpectedNetRet3d),
      minQualityScore: toFiniteOrNull(strongCandidateBypass?.minQualityScore),
      maxAntiScore: toFiniteOrNull(strongCandidateBypass?.maxAntiScore),
      minTargetStopEdge3d: toFiniteOrNull(strongCandidateBypass?.minTargetStopEdge3d),
      minPHit: toFiniteOrNull(strongCandidateBypass?.minPHit),
      minFillProb: toFiniteOrNull(strongCandidateBypass?.minFillProb),
      minConfidence: toFiniteOrNull(strongCandidateBypass?.minConfidence)
    }
  }
}

const evaluateFalsePositiveEdgeOverride = ({ row, cfg }) => {
  const safeCfg = cfg?.edgeAwareOverride ?? {}
  if (safeCfg?.enabled !== true) {
    return {
      eligible: false,
      checks: {
        enabled: false,
        eligible: false,
        blockReason: "DISABLED"
      }
    }
  }
  const targetRate3d = clamp01(row?.targetRate3d ?? 0)
  const stopRate3d = clamp01(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const pStop = clamp01(row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0)
  const confidence = clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0)
  const avgTradingValue20dKrw = Math.max(0, Number(row?.avgTradingValue20dKrw ?? 0) || 0)
  const spreadProxyPct = Math.max(0, Number(row?.spreadProxyPct ?? 0) || 0)
  const slippageRisk = Math.max(0, Number(row?.slippageRisk ?? 0) || 0)
  const agreementDecision = String(row?.agreementDecision ?? "").trim().toUpperCase()
  const agreementReason = String(row?.agreementReason ?? "").trim()
  const prototypeClusterId = String(
    row?.matchedPrototypeClusterId ?? row?.prototypeFamilyKey ?? "",
  ).trim()
  const routeBucket = String(row?.routeBucket ?? "").trim()
  const regimeTag = String(row?.regimeTag ?? "").trim()
  const dayType = String(row?.dayType ?? "").trim()
  const dayTypePolicySource = String(row?.dayTypePolicySource ?? "").trim()
  const falsePositiveModelRisk = toFiniteOrNull(row?.falsePositiveModelRisk)
  const falsePositiveRisk = toFiniteOrNull(row?.falsePositiveRisk)
  const scoreMargin = toFiniteOrNull(
    row?.gateScoreMargin ??
      row?.postRerankScoreMargin ??
      row?.rawScoreMargin ??
      row?.scoreMargin,
  )
  const checks = {
    enabled: true,
    targetRate3d,
    stopRate3d,
    targetStopEdge3d,
    expectedNetRet3d,
    pFill,
    pStop,
    confidence,
    avgTradingValue20dKrw,
    spreadProxyPct,
    slippageRisk,
    agreementDecision,
    agreementReason,
    scoreMargin,
    thresholds: {
      minTargetStopEdge3d: safeCfg.minTargetStopEdge3d,
      minExpectedNetRet3d: safeCfg.minExpectedNetRet3d,
      minFillProb: safeCfg.minFillProb,
      maxPStopFirst: safeCfg.maxPStopFirst,
      minConfidence: safeCfg.minConfidence,
      minScoreMargin: safeCfg.minScoreMargin,
      minAvgTradingValue20dKrw: safeCfg.minAvgTradingValue20dKrw,
      maxSpreadProxyPct: safeCfg.maxSpreadProxyPct,
      maxSlippageRisk: safeCfg.maxSlippageRisk,
      requireAgreementTrade: safeCfg.requireAgreementTrade === true,
      blockedAgreementDecisions: safeCfg.blockedAgreementDecisions,
      blockedAgreementReasons: safeCfg.blockedAgreementReasons,
      interactionBlocks: safeCfg.interactionBlocks,
      prototypeClusterId,
      routeBucket,
      regimeTag,
      dayType,
      dayTypePolicySource,
      falsePositiveModelRisk,
      falsePositiveRisk
    }
  }
  if (safeCfg?.requireAgreementTrade === true && agreementDecision && agreementDecision !== "TRADE") {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "REQUIRE_AGREEMENT_TRADE"
      }
    }
  }
  if (
    agreementDecision &&
    Array.isArray(safeCfg?.blockedAgreementDecisions) &&
    safeCfg.blockedAgreementDecisions.includes(agreementDecision)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "BLOCKED_AGREEMENT_DECISION"
      }
    }
  }
  if (
    agreementReason &&
    Array.isArray(safeCfg?.blockedAgreementReasons) &&
    safeCfg.blockedAgreementReasons.includes(agreementReason)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "BLOCKED_AGREEMENT_REASON"
      }
    }
  }
  const matchedInteractionBlock = Array.isArray(safeCfg?.interactionBlocks)
    ? safeCfg.interactionBlocks.find((block) => {
        if (block?.prototypeClusterId && block.prototypeClusterId !== prototypeClusterId) return false
        if (block?.agreementDecision && block.agreementDecision !== agreementDecision) return false
        if (block?.agreementReason && block.agreementReason !== agreementReason) return false
        if (block?.routeBucket && block.routeBucket !== routeBucket) return false
        if (block?.regimeTag && block.regimeTag !== regimeTag) return false
        if (block?.dayType && block.dayType !== dayType) return false
        if (block?.dayTypePolicySource && block.dayTypePolicySource !== dayTypePolicySource) return false
        if (
          hasFiniteThreshold(block?.minFalsePositiveModelRisk) &&
          (!Number.isFinite(falsePositiveModelRisk) ||
            falsePositiveModelRisk < Number(block.minFalsePositiveModelRisk))
        ) {
          return false
        }
        if (
          hasFiniteThreshold(block?.minFalsePositiveRisk) &&
          (!Number.isFinite(falsePositiveRisk) ||
            falsePositiveRisk < Number(block.minFalsePositiveRisk))
        ) {
          return false
        }
        return true
      }) ?? null
    : null
  if (matchedInteractionBlock) {
    return {
      eligible: false,
      checks: {
        ...checks,
        matchedInteractionBlock,
        eligible: false,
        blockReason: "INTERACTION_BLOCK"
      }
    }
  }
  const eligible =
    targetStopEdge3d >= Number(safeCfg.minTargetStopEdge3d ?? 0) &&
    expectedNetRet3d >= Number(safeCfg.minExpectedNetRet3d ?? 0) &&
    pFill >= Number(safeCfg.minFillProb ?? 0) &&
    pStop <= Number(safeCfg.maxPStopFirst ?? 1) &&
    confidence >= Number(safeCfg.minConfidence ?? 0) &&
    (!hasFiniteThreshold(safeCfg.minAvgTradingValue20dKrw) ||
      avgTradingValue20dKrw >= Number(safeCfg.minAvgTradingValue20dKrw)) &&
    (!hasFiniteThreshold(safeCfg.maxSpreadProxyPct) ||
      spreadProxyPct <= Number(safeCfg.maxSpreadProxyPct)) &&
    (!hasFiniteThreshold(safeCfg.maxSlippageRisk) ||
      slippageRisk <= Number(safeCfg.maxSlippageRisk)) &&
    (!hasFiniteThreshold(safeCfg.minScoreMargin) ||
      (Number.isFinite(scoreMargin) && scoreMargin >= Number(safeCfg.minScoreMargin)))
  return {
    eligible,
    checks: {
      ...checks,
      eligible,
      blockReason: eligible ? null : "THRESHOLD_MISS"
    }
  }
}

const evaluateFalsePositiveStrongCandidateBypass = ({ row, risk, cfg }) => {
  const safeCfg = cfg?.strongCandidateBypass ?? {}
  if (safeCfg?.enabled !== true) {
    return {
      eligible: false,
      checks: {
        enabled: false
      }
    }
  }
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const scoreMargin = toFiniteOrNull(
    row?.gateScoreMargin ??
      row?.postRerankScoreMargin ??
      row?.rawScoreMargin ??
      row?.scoreMargin,
  )
  const avgTradingValue20dKrw = Math.max(0, Number(row?.avgTradingValue20dKrw ?? 0) || 0)
  const spreadProxyPct = Math.max(0, Number(row?.spreadProxyPct ?? 0) || 0)
  const slippageRisk = Math.max(0, Number(row?.slippageRisk ?? 0) || 0)
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const qualityScore = clamp01(row?.qualityScore ?? 0)
  const antiScore = clamp01(row?.antiScore ?? 0)
  const targetStopEdge3d = clamp01(row?.targetRate3d ?? 0) - clamp01(row?.stopRate3d ?? 0)
  const pHit = clamp01(row?.calibrated?.pHitCalibrated ?? row?.pHitCalibrated ?? 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const confidence = clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0)
  const top1MicroCorrected = row?.top1MicroCorrected === true
  const checks = {
    enabled: true,
    risk: Number.isFinite(Number(risk)) ? clamp01(risk) : null,
    top1MicroCorrected,
    finalScore,
    scoreMargin,
    avgTradingValue20dKrw,
    spreadProxyPct,
    slippageRisk,
    expectedNetRet3d,
    qualityScore,
    antiScore,
    targetStopEdge3d,
    pHit,
    pFill,
    confidence,
    thresholds: {
      maxRisk: safeCfg.maxRisk,
      requireMicroCorrection: safeCfg.requireMicroCorrection === true,
      minFinalScore: safeCfg.minFinalScore,
      minScoreMargin: safeCfg.minScoreMargin,
      minAvgTradingValue20dKrw: safeCfg.minAvgTradingValue20dKrw,
      maxSpreadProxyPct: safeCfg.maxSpreadProxyPct,
      maxSlippageRisk: safeCfg.maxSlippageRisk,
      minExpectedNetRet3d: safeCfg.minExpectedNetRet3d,
      minQualityScore: safeCfg.minQualityScore,
      maxAntiScore: safeCfg.maxAntiScore,
      minTargetStopEdge3d: safeCfg.minTargetStopEdge3d,
      minPHit: safeCfg.minPHit,
      minFillProb: safeCfg.minFillProb,
      minConfidence: safeCfg.minConfidence
    }
  }
  if (safeCfg?.requireMicroCorrection === true && !top1MicroCorrected) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "REQUIRE_MICRO_CORRECTION"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.maxRisk) &&
    (!Number.isFinite(Number(risk)) || Number(risk) > Number(safeCfg.maxRisk))
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MAX_RISK_EXCEEDED"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minFinalScore) &&
    finalScore < Number(safeCfg.minFinalScore)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_FINAL_SCORE"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minScoreMargin) &&
    (!Number.isFinite(scoreMargin) || scoreMargin < Number(safeCfg.minScoreMargin))
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_SCORE_MARGIN"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minAvgTradingValue20dKrw) &&
    avgTradingValue20dKrw < Number(safeCfg.minAvgTradingValue20dKrw)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_AVG_TRADING_VALUE"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.maxSpreadProxyPct) &&
    spreadProxyPct > Number(safeCfg.maxSpreadProxyPct)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MAX_SPREAD_PROXY"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.maxSlippageRisk) &&
    slippageRisk > Number(safeCfg.maxSlippageRisk)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MAX_SLIPPAGE_RISK"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minExpectedNetRet3d) &&
    expectedNetRet3d < Number(safeCfg.minExpectedNetRet3d)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_EXPECTED_RET"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minQualityScore) &&
    qualityScore < Number(safeCfg.minQualityScore)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_QUALITY_SCORE"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.maxAntiScore) &&
    antiScore > Number(safeCfg.maxAntiScore)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MAX_ANTI_SCORE"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minTargetStopEdge3d) &&
    targetStopEdge3d < Number(safeCfg.minTargetStopEdge3d)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_TARGET_STOP_EDGE"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minPHit) &&
    pHit < Number(safeCfg.minPHit)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_P_HIT"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minFillProb) &&
    pFill < Number(safeCfg.minFillProb)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_FILL_PROB"
      }
    }
  }
  if (
    hasFiniteThreshold(safeCfg?.minConfidence) &&
    confidence < Number(safeCfg.minConfidence)
  ) {
    return {
      eligible: false,
      checks: {
        ...checks,
        eligible: false,
        blockReason: "MIN_CONFIDENCE"
      }
    }
  }
  return {
    eligible: true,
    checks: {
      ...checks,
      eligible: true,
      blockReason: null
    }
  }
}

export const buildFalsePositiveState = ({ stepDSummary, policyState }) => {
  const stateRaw =
    policyState?.falsePositiveState ??
    stepDSummary?.falsePositiveGate?.state ??
    {}
  return {
    globalCount: Math.max(0, Number(stateRaw?.globalCount ?? 0) || 0),
    falsePositiveCount: Math.max(
      0,
      Math.min(
        Number(stateRaw?.globalCount ?? 0) || 0,
        Number(stateRaw?.falsePositiveCount ?? 0) || 0,
      ),
    ),
    routeStats: buildStatsMap(stateRaw?.routeStats),
    regimeStats: buildStatsMap(stateRaw?.regimeStats),
    prototypeStats: buildStatsMap(stateRaw?.prototypeStats)
  }
}

export const evaluateFalsePositiveGate = ({
  row,
  cfg,
  state,
  maxRiskOverride = null,
  modelRisk = null,
  modelChecks = null,
  modelCfg = null
}) => {
  const safeCfg = resolveFalsePositiveGate(cfg)
  if (safeCfg.enabled !== true) {
    return {
      decision: "TRADE",
      reason: "FALSE_POSITIVE_GATE_DISABLED",
      risk: null,
      checks: {}
    }
  }

  const safeState = state && typeof state === "object" ? state : {}
  const threshold = Number.isFinite(Number(maxRiskOverride))
    ? clamp01(maxRiskOverride)
    : clamp01(safeCfg?.maxRisk ?? 0.58)
  const historyCfg = safeCfg?.history ?? {}
  const heuristicsCfg = safeCfg?.heuristics ?? {}
  const routeBucket = String(row?.routeBucket ?? "__DEFAULT__").trim() || "__DEFAULT__"
  const regimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN").trim() || "VOL_UNKNOWN_LIQ_UNKNOWN"
  const prototypeFamilyKey = String(
    row?.prototypeFamilyKey ??
      row?.matchedPrototypeClusterId ??
      row?.matchedPrototypeId ??
      "__NONE__",
  ).trim() || "__NONE__"

  const components = []
  const globalCount = Math.max(0, Number(safeState?.globalCount ?? 0) || 0)
  const globalFalsePositiveCount = Math.max(
    0,
    Math.min(globalCount, Number(safeState?.falsePositiveCount ?? 0) || 0),
  )
  if (globalCount >= Number(safeCfg?.minGlobalSamples ?? 0)) {
    components.push({
      key: "global",
      weight: Math.max(0, Number(historyCfg?.globalWeight ?? 0) || 0),
      count: globalCount,
      falsePositiveCount: globalFalsePositiveCount
    })
  }

  const routeStats = getMapStats(safeState?.routeStats, routeBucket)
  if (routeStats.count >= Number(safeCfg?.minSegmentSamples ?? 0)) {
    components.push({
      key: "routeBucket",
      weight: Math.max(0, Number(historyCfg?.routeBucketWeight ?? 0) || 0),
      count: routeStats.count,
      falsePositiveCount: routeStats.falsePositiveCount
    })
  }
  const regimeStats = getMapStats(safeState?.regimeStats, regimeTag)
  if (regimeStats.count >= Number(safeCfg?.minSegmentSamples ?? 0)) {
    components.push({
      key: "regime",
      weight: Math.max(0, Number(historyCfg?.regimeWeight ?? 0) || 0),
      count: regimeStats.count,
      falsePositiveCount: regimeStats.falsePositiveCount
    })
  }
  const prototypeStats = getMapStats(safeState?.prototypeStats, prototypeFamilyKey)
  if (prototypeStats.count >= Number(safeCfg?.minSegmentSamples ?? 0)) {
    components.push({
      key: "prototype",
      weight: Math.max(0, Number(historyCfg?.prototypeWeight ?? 0) || 0),
      count: prototypeStats.count,
      falsePositiveCount: prototypeStats.falsePositiveCount
    })
  }

  let historicalRisk = null
  let historicalWeight = 0
  const componentChecks = {}
  for (const component of components) {
    const weight = Math.max(0, Number(component?.weight ?? 0) || 0)
    if (weight <= 0) continue
    const risk = posteriorRisk({
      count: component?.count,
      falsePositiveCount: component?.falsePositiveCount,
      priorCount: historyCfg?.priorCount,
      priorRisk: historyCfg?.priorRisk
    })
    componentChecks[component.key] = {
      count: Math.max(0, Number(component?.count ?? 0) || 0),
      falsePositiveCount: Math.max(0, Number(component?.falsePositiveCount ?? 0) || 0),
      risk,
      weight
    }
    historicalRisk = (historicalRisk ?? 0) + risk * weight
    historicalWeight += weight
  }
  if (historicalRisk !== null && historicalWeight > 0) {
    historicalRisk = clamp01(historicalRisk / historicalWeight)
  } else {
    historicalRisk = null
  }

  let heuristicRisk = null
  let heuristicWeight = 0
  const heuristicChecks = {}
  if (heuristicsCfg?.enabled !== false) {
    const pStop = clamp01(row?.calibrated?.pStopFirstCalibrated ?? 0)
    const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? 0)
    const qualityScore = clamp01(row?.qualityScore ?? 0)
    const antiScore = clamp01(row?.antiScore ?? 0)
    const scoreMargin = toFiniteOrNull(
      row?.gateScoreMargin ??
        row?.postRerankScoreMargin ??
        row?.rawScoreMargin ??
        row?.scoreMargin,
    )
    const slippageRisk = Math.max(0, Number(row?.slippageRisk ?? 0) || 0)
    const avgTradingValue20dKrw = Math.max(0, Number(row?.avgTradingValue20dKrw ?? 0) || 0)
    const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0) || 0
    const terms = {
      pStop: {
        risk: pStop,
        weight: Math.max(0, Number(heuristicsCfg?.pStopWeight ?? 0) || 0)
      },
      lowFill: {
        risk: clamp01(
          Number(heuristicsCfg?.minFillProb ?? 0) > 0
            ? (Number(heuristicsCfg.minFillProb) - pFill) / Number(heuristicsCfg.minFillProb)
            : 0,
        ),
        weight: Math.max(0, Number(heuristicsCfg?.lowFillWeight ?? 0) || 0)
      },
      lowMargin: {
        risk:
          Number.isFinite(scoreMargin) && Number(heuristicsCfg?.minScoreMargin ?? 0) > 0
            ? clamp01(
                (Number(heuristicsCfg.minScoreMargin) - scoreMargin) /
                  Number(heuristicsCfg.minScoreMargin),
              )
            : 0,
        weight: Math.max(0, Number(heuristicsCfg?.lowMarginWeight ?? 0) || 0)
      },
      lowQuality: {
        risk: clamp01(
          Number(heuristicsCfg?.minQualityScore ?? 0) > 0
            ? (Number(heuristicsCfg.minQualityScore) - qualityScore) /
                Number(heuristicsCfg.minQualityScore)
            : 0,
        ),
        weight: Math.max(0, Number(heuristicsCfg?.lowQualityWeight ?? 0) || 0)
      },
      antiScore: {
        risk: antiScore,
        weight: Math.max(0, Number(heuristicsCfg?.antiScoreWeight ?? 0) || 0)
      },
      slippageRisk: {
        risk: clamp01(
          slippageRisk / Math.max(1e-6, Number(heuristicsCfg?.slippageRiskScale ?? 0.08) || 0.08),
        ),
        weight: Math.max(0, Number(heuristicsCfg?.slippageRiskWeight ?? 0) || 0)
      },
      lowLiquidity: {
        risk:
          Number(heuristicsCfg?.minAvgTradingValue20dKrw ?? 0) > 0
            ? clamp01(
                (Number(heuristicsCfg.minAvgTradingValue20dKrw) - avgTradingValue20dKrw) /
                  Number(heuristicsCfg.minAvgTradingValue20dKrw),
              )
            : 0,
        weight: Math.max(0, Number(heuristicsCfg?.lowLiquidityWeight ?? 0) || 0)
      },
      negativeExpectedRet: {
        risk:
          expectedNetRet3d < 0
            ? clamp01(
                Math.abs(expectedNetRet3d) /
                  Math.max(1e-6, Number(heuristicsCfg?.expectedRetScale ?? 0.015) || 0.015),
              )
            : 0,
        weight: Math.max(0, Number(heuristicsCfg?.negativeExpectedRetWeight ?? 0) || 0)
      }
    }
    let heuristicNumerator = 0
    let heuristicDenom = 0
    for (const [key, term] of Object.entries(terms)) {
      const weight = Math.max(0, Number(term?.weight ?? 0) || 0)
      if (weight <= 0) continue
      const risk = clamp01(term?.risk ?? 0)
      heuristicChecks[key] = { risk, weight }
      heuristicNumerator += risk * weight
      heuristicDenom += weight
    }
    if (heuristicDenom > 0) {
      heuristicRisk = clamp01(heuristicNumerator / heuristicDenom)
      heuristicWeight = Math.max(0, Number(heuristicsCfg?.weight ?? 0) || 0)
    }
  }

  const fallbackNumerator =
    (historicalRisk !== null ? historicalRisk * Math.max(0, historicalWeight) : 0) +
    (heuristicRisk !== null ? heuristicRisk * Math.max(0, heuristicWeight) : 0)
  const fallbackDenom =
    (historicalRisk !== null ? Math.max(0, historicalWeight) : 0) +
    (heuristicRisk !== null ? Math.max(0, heuristicWeight) : 0)
  const fallbackRisk = fallbackDenom > 0 ? clamp01(fallbackNumerator / fallbackDenom) : null
  const resolvedModelRisk = Number.isFinite(Number(modelRisk)) ? clamp01(modelRisk) : null
  const decisionMode = normalizeDecisionMode(modelCfg?.decisionMode)
  const modelBlendWeight = clamp01(modelCfg?.modelBlendWeight ?? 0.5)
  let risk = null
  if (decisionMode === "fallback_only") {
    risk = fallbackRisk
  } else if (decisionMode === "blend_with_fallback") {
    if (resolvedModelRisk !== null && fallbackRisk !== null) {
      risk = clamp01(
        resolvedModelRisk * modelBlendWeight + fallbackRisk * (1 - modelBlendWeight),
      )
    } else {
      risk = resolvedModelRisk ?? fallbackRisk
    }
  } else if (resolvedModelRisk !== null) {
    risk = resolvedModelRisk
  } else {
    risk = fallbackRisk
  }
  const unknown = risk === null
  const dominantSource = (() => {
    if (decisionMode === "fallback_only") {
      return fallbackRisk !== null ? "DIAGNOSTIC" : "UNKNOWN"
    }
    if (decisionMode === "blend_with_fallback") {
      if (resolvedModelRisk !== null && fallbackRisk !== null) return "BLEND"
      if (resolvedModelRisk !== null) return "MODEL"
      if (fallbackRisk !== null) return "DIAGNOSTIC"
      return "UNKNOWN"
    }
    if (resolvedModelRisk !== null) {
      return "MODEL"
    }
    if (fallbackRisk !== null) return "DIAGNOSTIC"
    return "UNKNOWN"
  })()
  const checks = {
    threshold,
    routeBucket,
    regimeTag,
    prototypeFamilyKey,
    fallbackRisk,
    historicalRisk,
    heuristicRisk,
    modelRisk: resolvedModelRisk,
    decisionMode,
    modelBlendWeight,
    dominantSource,
    historicalComponents: componentChecks,
    heuristicComponents: heuristicChecks,
    model: modelChecks && typeof modelChecks === "object" ? modelChecks : {},
    state: {
      globalCount,
      globalFalsePositiveCount,
      routeCount: routeStats.count,
      routeFalsePositiveCount: routeStats.falsePositiveCount,
      regimeCount: regimeStats.count,
      regimeFalsePositiveCount: regimeStats.falsePositiveCount,
      prototypeCount: prototypeStats.count,
      prototypeFalsePositiveCount: prototypeStats.falsePositiveCount
    },
    unknown
  }
  const edgeAwareOverride = evaluateFalsePositiveEdgeOverride({
    row,
    cfg: safeCfg
  })
  checks.edgeAwareOverride = edgeAwareOverride?.checks ?? {}
  const prototypeTradeGuardCfg = safeCfg?.edgeAwareOverride?.prototypeTradeGuard ?? {}
  const agreementDecision = String(row?.agreementDecision ?? "").trim().toUpperCase()
  const prototypeFalsePositiveRate =
    prototypeStats.count > 0 ? prototypeStats.falsePositiveCount / prototypeStats.count : null
  const prototypeTradeGuardChecks = {
    enabled: prototypeTradeGuardCfg?.enabled === true,
    agreementDecision,
    dominantSource,
    prototypeCount: prototypeStats.count,
    prototypeFalsePositiveCount: prototypeStats.falsePositiveCount,
    prototypeFalsePositiveRate,
    thresholds: {
      applyWhenAgreementTradeOnly: prototypeTradeGuardCfg?.applyWhenAgreementTradeOnly !== false,
      minPrototypeSamples: prototypeTradeGuardCfg?.minPrototypeSamples,
      maxPrototypeFalsePositiveRate: prototypeTradeGuardCfg?.maxPrototypeFalsePositiveRate,
      requireModelDominant: prototypeTradeGuardCfg?.requireModelDominant === true
    }
  }
  let prototypeTradeGuardBlocksOverride = false
  if (prototypeTradeGuardCfg?.enabled === true) {
    const appliesForAgreement =
      prototypeTradeGuardCfg?.applyWhenAgreementTradeOnly !== false
        ? agreementDecision === "TRADE"
        : true
    const appliesForDominantSource =
      prototypeTradeGuardCfg?.requireModelDominant === true ? dominantSource === "MODEL" : true
    const enoughPrototypeSamples =
      prototypeStats.count >= Number(prototypeTradeGuardCfg?.minPrototypeSamples ?? 0)
    const abovePrototypeRate =
      hasFiniteThreshold(prototypeTradeGuardCfg?.maxPrototypeFalsePositiveRate) &&
      Number.isFinite(prototypeFalsePositiveRate) &&
      prototypeFalsePositiveRate > Number(prototypeTradeGuardCfg.maxPrototypeFalsePositiveRate)
    prototypeTradeGuardBlocksOverride =
      appliesForAgreement && appliesForDominantSource && enoughPrototypeSamples && abovePrototypeRate
  }
  prototypeTradeGuardChecks.blocked = prototypeTradeGuardBlocksOverride
  checks.edgeAwareOverride.prototypeTradeGuard = prototypeTradeGuardChecks
  const strongCandidateBypass = evaluateFalsePositiveStrongCandidateBypass({
    row,
    risk,
    cfg: safeCfg
  })
  checks.strongCandidateBypass = strongCandidateBypass?.checks ?? {}

  if (unknown) {
    if (safeCfg?.blockWhenUnknown === true) {
      return {
        decision: "BLOCK_FALSE_POSITIVE_UNKNOWN",
        reason: "FALSE_POSITIVE_UNKNOWN",
        risk: null,
        checks
      }
    }
    return {
      decision: "SHADOW_FALSE_POSITIVE_UNKNOWN",
      reason: "FALSE_POSITIVE_UNKNOWN",
      risk: null,
      checks
    }
  }

  if (risk > threshold) {
    if (edgeAwareOverride?.eligible === true && prototypeTradeGuardBlocksOverride !== true) {
      return {
        decision: "TRADE",
        reason: "FALSE_POSITIVE_EDGE_OVERRIDE",
        risk,
        checks
      }
    }
    if (strongCandidateBypass?.eligible === true) {
      return {
        decision: "TRADE",
        reason: "FALSE_POSITIVE_STRONG_CANDIDATE_BYPASS",
        risk,
        checks
      }
    }
    return {
      decision:
        safeCfg?.action === "block"
          ? "BLOCK_FALSE_POSITIVE_RISK"
          : "SHADOW_FALSE_POSITIVE_RISK",
      reason:
        dominantSource === "MODEL"
          ? "FALSE_POSITIVE_MODEL_RISK_HIGH"
          : "FALSE_POSITIVE_DIAGNOSTIC_RISK_HIGH",
      risk,
      checks
    }
  }

  return {
    decision: "TRADE",
    reason: "FALSE_POSITIVE_OK",
    risk,
    checks
  }
}
