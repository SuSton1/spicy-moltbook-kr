const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const sigmoid = (value) => {
  const x = clamp(Number(value) || 0, -40, 40)
  return 1 / (1 + Math.exp(-x))
}

const resolveObservedRates = ({ calibration, regimeTag }) => {
  const globalCount = Math.max(0, Number(calibration?.globalCount ?? 0) || 0)
  const globalHitCount = Math.max(0, Number(calibration?.globalHitCount ?? 0) || 0)
  const globalRate = globalCount > 0 ? clamp01(globalHitCount / globalCount) : null

  const regimeStats = calibration?.regimeStats instanceof Map
    ? calibration.regimeStats.get(String(regimeTag ?? ""))
    : null
  const regimeCount = Math.max(0, Number(regimeStats?.count ?? 0) || 0)
  const regimeHitCount = Math.max(0, Number(regimeStats?.hitCount ?? 0) || 0)
  const regimeRate = regimeCount > 0 ? clamp01(regimeHitCount / regimeCount) : null

  return {
    globalCount,
    globalRate,
    regimeCount,
    regimeRate
  }
}

export const resolveCalibrationConfig = (raw) => {
  const cfg = raw ?? {}
  const pHit = cfg?.pHit ?? {}
  const pStop = cfg?.pStopFirst ?? {}
  const pFill = cfg?.pFill ?? {}
  const rankRelative = cfg?.rankRelative ?? {}
  const routeBiasByBucketRaw = rankRelative?.routeBiasByBucket ?? {}
  const routeBiasByBucket = {}
  for (const [key, value] of Object.entries(routeBiasByBucketRaw)) {
    const name = String(key ?? "").trim()
    const n = Number(value)
    if (!name || !Number.isFinite(n)) continue
    routeBiasByBucket[name] = n
  }
  return {
    enabled: cfg?.enabled !== false,
    minSamplesForBlend: Math.max(1, Math.floor(Number(cfg?.minSamplesForBlend ?? 30) || 30)),
    rankRelative: {
      enabled: rankRelative?.enabled !== false,
      only: rankRelative?.only === true,
      finalScoreZWeight: Number(rankRelative?.finalScoreZWeight ?? 1.15),
      marginZWeight: Number(rankRelative?.marginZWeight ?? 0.55),
      rankSignalWeight: Number(rankRelative?.rankSignalWeight ?? 0.4),
      stageScoreWeight: Number(rankRelative?.stageScoreWeight ?? 0.2),
      routeBiasByBucket
    },
    pHit: {
      intercept: Number(pHit?.intercept ?? -0.3),
      finalScoreWeight: Number(pHit?.finalScoreWeight ?? 1.8),
      qualityWeight: Number(pHit?.qualityWeight ?? 0.9),
      targetRateWeight: Number(pHit?.targetRateWeight ?? 1.1),
      stopRatePenaltyWeight: Number(pHit?.stopRatePenaltyWeight ?? 0.8),
      expectedRetWeight: Number(pHit?.expectedRetWeight ?? 2.5),
      scoreMarginWeight: Number(pHit?.scoreMarginWeight ?? 0.5),
      blendGlobalWeight: clamp01(pHit?.blendGlobalWeight ?? 0.45),
      blendRegimeWeight: clamp01(pHit?.blendRegimeWeight ?? 0.25)
    },
    pStopFirst: {
      intercept: Number(pStop?.intercept ?? -0.4),
      stopRateWeight: Number(pStop?.stopRateWeight ?? 1.7),
      antiScoreWeight: Number(pStop?.antiScoreWeight ?? 0.8),
      expectedRetPenaltyWeight: Number(pStop?.expectedRetPenaltyWeight ?? 1.4),
      qualityPenaltyWeight: Number(pStop?.qualityPenaltyWeight ?? 0.4)
    },
    pFill: {
      intercept: Number(pFill?.intercept ?? 0),
      liquidityWeight: Number(pFill?.liquidityWeight ?? 1.1),
      marginWeight: Number(pFill?.marginWeight ?? 0.35),
      riskPenaltyWeight: Number(pFill?.riskPenaltyWeight ?? 0.25),
      slippagePenaltyWeight: Number(pFill?.slippagePenaltyWeight ?? 0.9)
    },
    confidence: {
      edgeWeight: Number(cfg?.confidence?.edgeWeight ?? 0.7),
      sampleWeight: Number(cfg?.confidence?.sampleWeight ?? 0.3)
    }
  }
}

export const estimateCalibratedSignals = ({
  row,
  scoreMargin,
  calibration,
  cfg
}) => {
  const safeCfg = resolveCalibrationConfig(cfg)
  if (safeCfg.enabled !== true) {
    return {
      pHitRaw: clamp01(row?.targetRate3d ?? 0),
      pHitCalibrated: clamp01(row?.targetRate3d ?? 0),
      pStopFirstRaw: clamp01(row?.stopRate3d ?? 0),
      pStopFirstCalibrated: clamp01(row?.stopRate3d ?? 0),
      pFillRaw: 0.5,
      pFillCalibrated: 0.5,
      confidence: 0
    }
  }

  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const quality = Number(row?.qualityScore ?? 0)
  const targetRate = clamp01(row?.targetRate3d ?? 0)
  const stopRate = clamp01(row?.stopRate3d ?? 0)
  const antiScore = clamp01(row?.antiScore ?? 0)
  const expectedRet = Number(row?.expectedNetRet3d ?? 0)
  const margin = Number.isFinite(Number(scoreMargin)) ? Number(scoreMargin) : 0
  const finalScoreZWithinDay = Number(row?.finalScoreZWithinDay ?? row?.finalScoreZ ?? 0)
  const marginZWithinDay = Number(row?.marginZWithinDay ?? row?.scoreMarginZWithinDay ?? 0)
  const rankSize = Math.max(1, Number(row?.rankSize ?? 1) || 1)
  const rankIndex = Math.max(0, Number(row?.rankIndex ?? 0) || 0)
  const rankPct = rankSize > 1 ? clamp01(rankIndex / (rankSize - 1)) : 0
  const rankSignal = 1 - rankPct
  const stageScores = row?.stageScores ?? {}
  const stageScoreValues = [
    Number(stageScores?.global),
    Number(stageScores?.local),
    Number(stageScores?.trigger)
  ].filter((v) => Number.isFinite(v))
  const stageScoreAvg = stageScoreValues.length > 0
    ? stageScoreValues.reduce((acc, v) => acc + v, 0) / stageScoreValues.length
    : 0
  const routeBucket = String(row?.routeBucket ?? "")
  const routeBias = Number(safeCfg?.rankRelative?.routeBiasByBucket?.[routeBucket] ?? 0)
  const rankOnly = safeCfg?.rankRelative?.only === true
  const liqRatio = Number(row?.regimeLiquidityProxy ?? 0)
  const riskScore = Number(row?.risk?.score ?? 0)
  const slippageRisk = Number(row?.slippageRisk ?? 0)
  const regimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")

  const hitLogit =
    Number(safeCfg.pHit.intercept ?? 0) +
    Number(safeCfg.pHit.qualityWeight ?? 0) * quality +
    Number(safeCfg.pHit.targetRateWeight ?? 0) * targetRate -
    Number(safeCfg.pHit.stopRatePenaltyWeight ?? 0) * stopRate +
    (rankOnly ? 0 : Number(safeCfg.pHit.finalScoreWeight ?? 0) * finalScore) +
    (rankOnly ? 0 : Number(safeCfg.pHit.expectedRetWeight ?? 0) * expectedRet) +
    (rankOnly ? 0 : Number(safeCfg.pHit.scoreMarginWeight ?? 0) * margin) +
    (safeCfg?.rankRelative?.enabled !== false
      ? Number(safeCfg?.rankRelative?.finalScoreZWeight ?? 0) * finalScoreZWithinDay +
        Number(safeCfg?.rankRelative?.marginZWeight ?? 0) * marginZWithinDay +
        Number(safeCfg?.rankRelative?.rankSignalWeight ?? 0) * rankSignal +
        Number(safeCfg?.rankRelative?.stageScoreWeight ?? 0) * stageScoreAvg +
        routeBias
      : 0)
  const pHitRaw = sigmoid(hitLogit)

  const stopLogit =
    Number(safeCfg.pStopFirst.intercept ?? 0) +
    Number(safeCfg.pStopFirst.stopRateWeight ?? 0) * stopRate +
    Number(safeCfg.pStopFirst.antiScoreWeight ?? 0) * antiScore -
    Number(safeCfg.pStopFirst.expectedRetPenaltyWeight ?? 0) * expectedRet -
    Number(safeCfg.pStopFirst.qualityPenaltyWeight ?? 0) * quality
  const pStopFirstRaw = sigmoid(stopLogit)

  const fillLogit =
    Number(safeCfg.pFill.intercept ?? 0) +
    Number(safeCfg.pFill.liquidityWeight ?? 0) * liqRatio +
    (rankOnly ? 0 : Number(safeCfg.pFill.marginWeight ?? 0) * margin) +
    (safeCfg?.rankRelative?.enabled !== false
      ? 0.15 * marginZWithinDay + 0.1 * rankSignal
      : 0) -
    Number(safeCfg.pFill.riskPenaltyWeight ?? 0) * riskScore -
    Number(safeCfg.pFill.slippagePenaltyWeight ?? 0) * slippageRisk
  const pFillRaw = sigmoid(fillLogit)

  const observed = resolveObservedRates({ calibration, regimeTag })
  const blendDenom = Math.max(1, Number(safeCfg.minSamplesForBlend ?? 30) || 30)
  const globalBlend = observed.globalCount / (observed.globalCount + blendDenom)
  const regimeBlend = observed.regimeCount / (observed.regimeCount + blendDenom)
  const globalWeight = Number(safeCfg.pHit.blendGlobalWeight ?? 0) * globalBlend
  const regimeWeight = Number(safeCfg.pHit.blendRegimeWeight ?? 0) * regimeBlend
  const blendWeight = clamp01(globalWeight + regimeWeight)
  const observedHit =
    (observed.regimeRate ?? observed.globalRate ?? pHitRaw) * clamp01(regimeWeight / Math.max(1e-9, blendWeight)) +
    (observed.globalRate ?? pHitRaw) * clamp01(globalWeight / Math.max(1e-9, blendWeight))
  const pHitCalibrated =
    blendWeight > 0
      ? clamp01((1 - blendWeight) * pHitRaw + blendWeight * observedHit)
      : pHitRaw
  const pStopFirstCalibrated = clamp01((pStopFirstRaw + stopRate) / 2)
  const pFillCalibrated = clamp01((pFillRaw + clamp01(liqRatio)) / 2)

  const edge = Math.abs(pHitCalibrated - pStopFirstCalibrated)
  const sampleConfidence =
    observed.globalCount > 0
      ? Math.sqrt(observed.globalCount / (observed.globalCount + blendDenom))
      : 0
  const confidence = clamp01(
    Number(safeCfg.confidence.edgeWeight ?? 0.7) * edge +
    Number(safeCfg.confidence.sampleWeight ?? 0.3) * sampleConfidence,
  )

  return {
    pHitRaw,
    pHitCalibrated,
    pStopFirstRaw,
    pStopFirstCalibrated,
    pFillRaw,
    pFillCalibrated,
    confidence,
    observedGlobalHitRate: observed.globalRate,
    observedRegimeHitRate: observed.regimeRate,
    observedGlobalCount: observed.globalCount,
    observedRegimeCount: observed.regimeCount,
    rankRelativeInputs: {
      finalScoreZWithinDay,
      marginZWithinDay,
      rankIndex,
      rankSize,
      rankPct,
      rankSignal,
      stageScoreAvg,
      routeBucket
    }
  }
}
