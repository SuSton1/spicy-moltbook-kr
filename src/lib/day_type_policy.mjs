const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const toFinite = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number(fallback) || 0
}

const toPositiveInt = (value, fallback) => {
  const n = Math.floor(toFinite(value, fallback))
  return n > 0 ? n : Math.max(1, Math.floor(Number(fallback) || 1))
}

const toNonNegativeIntOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 0 ? n : null
}

const normalizeStringArray = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  )

const normalizeDayType = (value) => {
  const text = String(value ?? "BALANCED").trim().toUpperCase()
  if ([
    "TREND",
    "MEAN_REVERSION",
    "GAP_FADE_RISK",
    "NOISE",
    "EXECUTION_HOSTILE",
    "THIN_LIQUIDITY_TRAP",
    "NO_TRADE",
    "BALANCED"
  ].includes(text)) {
    return text
  }
  return "BALANCED"
}

const average = (values) => {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (nums.length < 1) return null
  return nums.reduce((acc, value) => acc + value, 0) / nums.length
}

const median = (values) => {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (nums.length < 1) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 1
    ? nums[mid]
    : (nums[mid - 1] + nums[mid]) / 2
}

const countShare = (rows, predicate) => {
  const list = Array.isArray(rows) ? rows : []
  if (list.length < 1) return 0
  let count = 0
  for (const row of list) {
    if (predicate(row)) count += 1
  }
  return count / list.length
}

const resolvePolicy = (raw) => {
  const policy = raw ?? {}
  return {
    noTrade: policy?.noTrade === true,
    minFinalScoreDelta: toFinite(policy?.minFinalScoreDelta, 0),
    minExpectedNetRet3dDelta: toFinite(policy?.minExpectedNetRet3dDelta, 0),
    minScoreMarginMultiplier: Math.max(0, toFinite(policy?.minScoreMarginMultiplier, 1)),
    maxPicksPerDay: (() => {
      const n = Math.floor(toFinite(policy?.maxPicksPerDay, 0))
      if (n === 1 || n === 2) return n
      return null
    })(),
    tauExecMultiplier: Math.max(0, toFinite(policy?.tauExecMultiplier, 1)),
    tauFpMultiplier: Math.max(0, toFinite(policy?.tauFpMultiplier, 1)),
    maxExecutedPicks: toNonNegativeIntOrNull(policy?.maxExecutedPicks),
    maxFragileExecuted: toNonNegativeIntOrNull(policy?.maxFragileExecuted),
    maxLowLiquidityExecuted: toNonNegativeIntOrNull(policy?.maxLowLiquidityExecuted),
    maxExecutionHostileExecuted: toNonNegativeIntOrNull(policy?.maxExecutionHostileExecuted),
    maxSameRouteBucket: toNonNegativeIntOrNull(policy?.maxSameRouteBucket),
    maxSameRegimeTag: toNonNegativeIntOrNull(policy?.maxSameRegimeTag),
    maxSamePrototypeFamily: toNonNegativeIntOrNull(policy?.maxSamePrototypeFamily),
    allowedRouteBuckets: normalizeStringArray(policy?.allowedRouteBuckets)
  }
}

export const resolveDayTypeRouter = (raw) => {
  const cfg = raw ?? {}
  const strongCandidate = cfg?.strongCandidate ?? {}
  const classifiers = cfg?.classifiers ?? {}
  const policies = cfg?.policies ?? {}
  return {
    enabled: cfg?.enabled === true,
    sampleSize: toPositiveInt(cfg?.sampleSize, 5),
    strongCandidate: {
      minQualityScore: clamp01(strongCandidate?.minQualityScore ?? 0.64),
      minExpectedNetRet3d: toFinite(strongCandidate?.minExpectedNetRet3d, 0.01),
      minMargin: Math.max(0, toFinite(strongCandidate?.minMargin, 0.0035)),
      minPHit: clamp01(strongCandidate?.minPHit ?? 0.62)
    },
    classifiers: {
      trend: {
        minTop1Margin: Math.max(0, toFinite(classifiers?.trend?.minTop1Margin, 0.006)),
        minTop1QualityScore: clamp01(classifiers?.trend?.minTop1QualityScore ?? 0.64),
        minTop1ExpectedNetRet3d: toFinite(classifiers?.trend?.minTop1ExpectedNetRet3d, 0.01),
        minAvgPHit: clamp01(classifiers?.trend?.minAvgPHit ?? 0.62),
        minStrongCandidateShare: clamp01(classifiers?.trend?.minStrongCandidateShare ?? 0.4)
      },
      noise: {
        maxTop1Margin: Math.max(0, toFinite(classifiers?.noise?.maxTop1Margin, 0.0025)),
        maxTop1QualityScore: clamp01(classifiers?.noise?.maxTop1QualityScore ?? 0.62),
        maxTop1ExpectedNetRet3d: toFinite(classifiers?.noise?.maxTop1ExpectedNetRet3d, 0.006),
        maxAvgPHit: clamp01(classifiers?.noise?.maxAvgPHit ?? 0.58),
        maxStrongCandidateShare: clamp01(classifiers?.noise?.maxStrongCandidateShare ?? 0.25)
      },
      executionHostile: {
        minAvgSlippageRisk: Math.max(0, toFinite(classifiers?.executionHostile?.minAvgSlippageRisk, 0.08)),
        maxMedianLiquidityKrw: Math.max(
          0,
          toFinite(classifiers?.executionHostile?.maxMedianLiquidityKrw, 1_800_000_000),
        ),
        maxAvgFillProb: clamp01(classifiers?.executionHostile?.maxAvgFillProb ?? 0.72),
        minLowFillShare: clamp01(classifiers?.executionHostile?.minLowFillShare ?? 0.4)
      },
      noTrade: {
        maxTop1ExpectedNetRet3d: toFinite(classifiers?.noTrade?.maxTop1ExpectedNetRet3d, 0.002),
        maxAvgPHit: clamp01(classifiers?.noTrade?.maxAvgPHit ?? 0.53),
        maxStrongCandidateShare: clamp01(classifiers?.noTrade?.maxStrongCandidateShare ?? 0.12)
      },
      meanReversion: {
        maxTop1Margin: Math.max(0, toFinite(classifiers?.meanReversion?.maxTop1Margin, 0.003)),
        minAvgPHit: clamp01(classifiers?.meanReversion?.minAvgPHit ?? 0.58),
        minTop1ExpectedNetRet3d: toFinite(classifiers?.meanReversion?.minTop1ExpectedNetRet3d, 0.006)
      },
      gapFadeRisk: {
        minTop1Margin: Math.max(0, toFinite(classifiers?.gapFadeRisk?.minTop1Margin, 0.004)),
        minTop1ExpectedNetRet3d: toFinite(classifiers?.gapFadeRisk?.minTop1ExpectedNetRet3d, 0.008),
        maxAvgPHit: clamp01(classifiers?.gapFadeRisk?.maxAvgPHit ?? 0.6),
        minLowFillShare: clamp01(classifiers?.gapFadeRisk?.minLowFillShare ?? 0.2)
      },
      thinLiquidityTrap: {
        maxMedianLiquidityKrw: Math.max(
          0,
          toFinite(classifiers?.thinLiquidityTrap?.maxMedianLiquidityKrw, 1_200_000_000),
        ),
        minLowLiquidityShare: clamp01(classifiers?.thinLiquidityTrap?.minLowLiquidityShare ?? 0.5),
        minAvgSlippageRisk: Math.max(0, toFinite(classifiers?.thinLiquidityTrap?.minAvgSlippageRisk, 0.05))
      }
    },
    policies: {
      BALANCED: resolvePolicy(policies?.BALANCED),
      TREND: resolvePolicy(policies?.TREND),
      MEAN_REVERSION: resolvePolicy(policies?.MEAN_REVERSION),
      GAP_FADE_RISK: resolvePolicy(policies?.GAP_FADE_RISK),
      NOISE: resolvePolicy(policies?.NOISE),
      EXECUTION_HOSTILE: resolvePolicy(policies?.EXECUTION_HOSTILE),
      THIN_LIQUIDITY_TRAP: resolvePolicy(policies?.THIN_LIQUIDITY_TRAP),
      NO_TRADE: resolvePolicy(policies?.NO_TRADE)
    }
  }
}

export const summarizeDayTypeSignals = ({ rows, cfg }) => {
  const safeCfg = resolveDayTypeRouter(cfg)
  const ranked = (Array.isArray(rows) ? rows : []).slice(0, safeCfg.sampleSize)
  const top1 = ranked[0] ?? null
  const top2 = ranked[1] ?? null
  const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
  const top2Score = Number(top2?.finalScore ?? top2?.score ?? 0)
  const top1MarginRaw = Number(top1?.gateScoreMargin ?? top1?.rawScoreMargin)
  const top1Margin = Number.isFinite(top1MarginRaw)
    ? top1MarginRaw
    : (top2 ? top1Score - top2Score : Number.POSITIVE_INFINITY)
  const strongCfg = safeCfg.strongCandidate
  const strongCandidateShare = countShare(ranked, (row) => {
    const margin = Number(
      row?.gateScoreMargin ??
        row?.postRerankScoreMargin ??
        row?.rawScoreMargin ??
        row?.scoreMargin,
    )
    const pHit = Number(row?.calibrated?.pHitCalibrated ?? 0)
    return (
      Number(row?.qualityScore ?? 0) >= strongCfg.minQualityScore &&
      Number(row?.expectedNetRet3d ?? 0) >= strongCfg.minExpectedNetRet3d &&
      (!Number.isFinite(margin) || margin >= strongCfg.minMargin) &&
      pHit >= strongCfg.minPHit
    )
  })
  const lowFillShare = countShare(
    ranked,
    (row) => Number(row?.calibrated?.pFillCalibrated ?? 0) < 0.72,
  )
  const lowLiquidityShare = countShare(
    ranked,
    (row) => Number(row?.avgTradingValue20dKrw ?? 0) < 1_200_000_000,
  )
  return {
    sampleSize: ranked.length,
    top1Margin: Number.isFinite(top1Margin) ? top1Margin : null,
    top1QualityScore: Number.isFinite(Number(top1?.qualityScore)) ? Number(top1.qualityScore) : null,
    top1ExpectedNetRet3d: Number.isFinite(Number(top1?.expectedNetRet3d))
      ? Number(top1.expectedNetRet3d)
      : null,
    avgPHit: average(ranked.map((row) => row?.calibrated?.pHitCalibrated ?? null)),
    avgFillProb: average(ranked.map((row) => row?.calibrated?.pFillCalibrated ?? null)),
    avgSlippageRisk: average(ranked.map((row) => row?.slippageRisk ?? null)),
    medianLiquidityKrw: median(ranked.map((row) => row?.avgTradingValue20dKrw ?? null)),
    strongCandidateShare,
    lowFillShare,
    lowLiquidityShare
  }
}

export const classifyDayType = ({ rows, cfg }) => {
  const safeCfg = resolveDayTypeRouter(cfg)
  const signals = summarizeDayTypeSignals({ rows, cfg: safeCfg })
  if (safeCfg.enabled !== true) {
    return {
      enabled: false,
      dayType: "BALANCED",
      noTrade: false,
      gateReason: null,
      reasonCodes: ["DAY_TYPE_ROUTER_DISABLED"],
      signals,
      policy: safeCfg.policies.BALANCED
    }
  }

  const classifiers = safeCfg.classifiers
  const reasonCodes = []
  let dayType = "BALANCED"

  const isThinLiquidityTrap =
    Number.isFinite(Number(signals?.medianLiquidityKrw)) &&
    Number(signals.medianLiquidityKrw) <= Number(classifiers.thinLiquidityTrap.maxMedianLiquidityKrw) &&
    Number(signals?.lowLiquidityShare ?? 0) >= Number(classifiers.thinLiquidityTrap.minLowLiquidityShare) &&
    Number(signals?.avgSlippageRisk ?? 0) >= Number(classifiers.thinLiquidityTrap.minAvgSlippageRisk)

  const isExecutionHostile =
    Number(signals?.avgSlippageRisk ?? 0) >= Number(classifiers.executionHostile.minAvgSlippageRisk) &&
    Number(signals?.avgFillProb ?? 1) <= Number(classifiers.executionHostile.maxAvgFillProb) &&
    (
      !Number.isFinite(Number(signals?.medianLiquidityKrw)) ||
      Number(signals.medianLiquidityKrw) <= Number(classifiers.executionHostile.maxMedianLiquidityKrw)
    ) &&
    Number(signals?.lowFillShare ?? 0) >= Number(classifiers.executionHostile.minLowFillShare)

  const isNoTrade =
    Number(signals?.sampleSize ?? 0) < 1 ||
    (
      Number(signals?.top1ExpectedNetRet3d ?? Number.POSITIVE_INFINITY) <=
        Number(classifiers.noTrade.maxTop1ExpectedNetRet3d) &&
      Number(signals?.avgPHit ?? 1) <= Number(classifiers.noTrade.maxAvgPHit) &&
      Number(signals?.strongCandidateShare ?? 1) <= Number(classifiers.noTrade.maxStrongCandidateShare)
    )

  const isTrend =
    Number(signals?.top1Margin ?? 0) >= Number(classifiers.trend.minTop1Margin) &&
    Number(signals?.top1QualityScore ?? 0) >= Number(classifiers.trend.minTop1QualityScore) &&
    Number(signals?.top1ExpectedNetRet3d ?? 0) >= Number(classifiers.trend.minTop1ExpectedNetRet3d) &&
    Number(signals?.avgPHit ?? 0) >= Number(classifiers.trend.minAvgPHit) &&
    Number(signals?.strongCandidateShare ?? 0) >= Number(classifiers.trend.minStrongCandidateShare)

  const isGapFadeRisk =
    Number(signals?.top1Margin ?? 0) >= Number(classifiers.gapFadeRisk.minTop1Margin) &&
    Number(signals?.top1ExpectedNetRet3d ?? 0) >= Number(classifiers.gapFadeRisk.minTop1ExpectedNetRet3d) &&
    Number(signals?.avgPHit ?? 1) <= Number(classifiers.gapFadeRisk.maxAvgPHit) &&
    Number(signals?.lowFillShare ?? 0) >= Number(classifiers.gapFadeRisk.minLowFillShare)

  const isMeanReversion =
    Number(signals?.top1Margin ?? Number.POSITIVE_INFINITY) <= Number(classifiers.meanReversion.maxTop1Margin) &&
    Number(signals?.avgPHit ?? 0) >= Number(classifiers.meanReversion.minAvgPHit) &&
    Number(signals?.top1ExpectedNetRet3d ?? 0) >= Number(classifiers.meanReversion.minTop1ExpectedNetRet3d)

  const isNoise =
    Number(signals?.top1Margin ?? Number.POSITIVE_INFINITY) <= Number(classifiers.noise.maxTop1Margin) &&
    Number(signals?.top1QualityScore ?? 1) <= Number(classifiers.noise.maxTop1QualityScore) &&
    Number(signals?.top1ExpectedNetRet3d ?? Number.POSITIVE_INFINITY) <=
      Number(classifiers.noise.maxTop1ExpectedNetRet3d) &&
    Number(signals?.avgPHit ?? 1) <= Number(classifiers.noise.maxAvgPHit) &&
    Number(signals?.strongCandidateShare ?? 1) <= Number(classifiers.noise.maxStrongCandidateShare)

  if (isThinLiquidityTrap) {
    dayType = "THIN_LIQUIDITY_TRAP"
    reasonCodes.push("THIN_LIQUIDITY_SHARE_HIGH", "SLIPPAGE_RISK_HIGH")
  } else if (isExecutionHostile) {
    dayType = "EXECUTION_HOSTILE"
    reasonCodes.push("FILL_PROB_LOW", "SLIPPAGE_RISK_HIGH")
  } else if (isNoTrade) {
    dayType = "NO_TRADE"
    reasonCodes.push("NO_CANDIDATE_EDGE", "NO_TRADE_BUDGET")
  } else if (isTrend) {
    dayType = "TREND"
    reasonCodes.push("TOP1_MARGIN_STRONG", "STRONG_CANDIDATE_SHARE_HIGH")
  } else if (isGapFadeRisk) {
    dayType = "GAP_FADE_RISK"
    reasonCodes.push("TOP1_LOOKS_STRONG_BUT_P_HIT_WEAK", "LOW_FILL_SHARE_HIGH")
  } else if (isMeanReversion) {
    dayType = "MEAN_REVERSION"
    reasonCodes.push("TOP1_MARGIN_WEAK", "P_HIT_STILL_HIGH")
  } else if (isNoise) {
    dayType = "NOISE"
    reasonCodes.push("TOP1_MARGIN_WEAK", "CONSENSUS_WEAK")
  } else {
    dayType = "BALANCED"
    reasonCodes.push("BALANCED_BASELINE")
  }

  const policy = safeCfg.policies[normalizeDayType(dayType)] ?? safeCfg.policies.BALANCED
  return {
    enabled: true,
    dayType,
    noTrade: policy?.noTrade === true,
    gateReason: policy?.noTrade === true ? `DAY_TYPE_${dayType}_NO_TRADE` : null,
    reasonCodes,
    signals,
    policy
  }
}

export const applyDayTypePolicyToGateCfg = ({ gateCfg, dayTypeDecision }) => {
  const base = gateCfg ?? {}
  const policy = dayTypeDecision?.policy ?? {}
  const nextMaxPicks =
    policy?.maxPicksPerDay === 1 || policy?.maxPicksPerDay === 2
      ? policy.maxPicksPerDay
      : Number(base?.maxPicksPerDay ?? 1) || 1
  const scoreMarginBase = Math.max(0, Number(base?.minScoreMargin ?? 0) || 0)
  const scoreMarginMultiplier = Math.max(0, Number(policy?.minScoreMarginMultiplier ?? 1) || 1)
  return {
    ...base,
    minFinalScore: clamp01(Number(base?.minFinalScore ?? 0) + Number(policy?.minFinalScoreDelta ?? 0)),
    minExpectedNetRet3d:
      Number(base?.minExpectedNetRet3d ?? 0) + Number(policy?.minExpectedNetRet3dDelta ?? 0),
    minScoreMargin: scoreMarginBase * scoreMarginMultiplier,
    maxPicksPerDay: nextMaxPicks,
    effectiveSinglePick: nextMaxPicks <= 1 ? true : base?.effectiveSinglePick === true,
    secondPick: {
      ...(base?.secondPick ?? {}),
      mode:
        nextMaxPicks <= 1
          ? "disabled"
          : String(base?.secondPick?.mode ?? "disabled")
    }
  }
}

export const resolveDayTypeThresholds = ({ tauExec, tauFp, dayTypeDecision, gatePhase = null }) => {
  const policy = dayTypeDecision?.policy ?? {}
  const tauExecBase = Number(tauExec)
  const tauFpBase = Number(tauFp)
  const gatePhaseText = String(gatePhase ?? "").trim().toUpperCase()
  const tauExecMultiplierRaw = Math.max(0, Number(policy?.tauExecMultiplier ?? 1) || 1)
  // Soft-start exists to relax execution calibration until enough feedback accumulates.
  // Day-type should not silently tighten that relaxed floor back above the active runtime target.
  const tauExecMultiplier =
    gatePhaseText === "SOFTSTART"
      ? Math.min(tauExecMultiplierRaw, 1)
      : tauExecMultiplierRaw
  return {
    tauExec: Number.isFinite(tauExecBase)
      ? clamp01(tauExecBase * tauExecMultiplier)
      : tauExecBase,
    tauFp: Number.isFinite(tauFpBase)
      ? clamp01(tauFpBase * Math.max(0, Number(policy?.tauFpMultiplier ?? 1) || 1))
      : tauFpBase
  }
}
