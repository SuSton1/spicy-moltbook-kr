const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const num = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const evaluateStrongCandidateBypass = ({ row, checks, cfg }) => {
  const safeCfg = cfg ?? {}
  if (safeCfg?.enabled !== true) return { eligible: false, checks: null }

  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0)
  const qualityScore = Number(row?.qualityScore ?? 0)
  const antiScore = Number(row?.antiScore ?? 0)
  const targetRate3d = Number(row?.targetRate3d ?? 0)
  const stopRate3d = Number(row?.stopRate3d ?? 0)
  const targetStopEdge3d = targetRate3d - stopRate3d
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0)
  const scoreMargin = Number(
    row?.gateScoreMargin ??
      row?.postRerankScoreMargin ??
      row?.preRerankScoreMargin ??
      row?.rawScoreMargin,
  )
  const bypassChecks = {
    liquidityRatio: checks?.liquidityRatio ?? null,
    avgTradingValue20dKrw: checks?.avgTradingValue20dKrw ?? null,
    dataFreshnessDays: checks?.dataFreshnessDays ?? null,
    expectedNetRet3d,
    qualityScore,
    antiScore,
    targetStopEdge3d,
    finalScore,
    scoreMargin,
    thresholds: {
      minLiquidityRatio: safeCfg?.minLiquidityRatio ?? null,
      minAvgTradingValue20dKrw: safeCfg?.minAvgTradingValue20dKrw ?? null,
      maxDataFreshnessDays: safeCfg?.maxDataFreshnessDays ?? null,
      minExpectedNetRet3d: safeCfg?.minExpectedNetRet3d ?? null,
      minQualityScore: safeCfg?.minQualityScore ?? null,
      maxAntiScore: safeCfg?.maxAntiScore ?? null,
      minTargetStopEdge3d: safeCfg?.minTargetStopEdge3d ?? null,
      minFinalScore: safeCfg?.minFinalScore ?? null,
      minScoreMargin: safeCfg?.minScoreMargin ?? null
    }
  }

  if (
    Number.isFinite(Number(safeCfg?.minLiquidityRatio)) &&
    (!Number.isFinite(Number(checks?.liquidityRatio)) ||
      Number(checks?.liquidityRatio) < Number(safeCfg.minLiquidityRatio))
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minAvgTradingValue20dKrw)) &&
    (!Number.isFinite(Number(checks?.avgTradingValue20dKrw)) ||
      Number(checks?.avgTradingValue20dKrw) < Number(safeCfg.minAvgTradingValue20dKrw))
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.maxDataFreshnessDays)) &&
    (!Number.isFinite(Number(checks?.dataFreshnessDays)) ||
      Number(checks?.dataFreshnessDays) > Number(safeCfg.maxDataFreshnessDays))
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minExpectedNetRet3d)) &&
    expectedNetRet3d < Number(safeCfg.minExpectedNetRet3d)
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minQualityScore)) &&
    qualityScore < Number(safeCfg.minQualityScore)
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.maxAntiScore)) &&
    antiScore > Number(safeCfg.maxAntiScore)
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minTargetStopEdge3d)) &&
    targetStopEdge3d < Number(safeCfg.minTargetStopEdge3d)
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minFinalScore)) &&
    finalScore < Number(safeCfg.minFinalScore)
  ) {
    return { eligible: false, checks: bypassChecks }
  }
  if (
    Number.isFinite(Number(safeCfg?.minScoreMargin)) &&
    (!Number.isFinite(scoreMargin) || scoreMargin < Number(safeCfg.minScoreMargin))
  ) {
    return { eligible: false, checks: bypassChecks }
  }

  return { eligible: true, checks: bypassChecks }
}

export const resolveLiquidityFilters = (raw) => {
  const cfg = raw ?? {}
  if (
    cfg &&
    cfg.blockRiskCodes instanceof Set &&
    cfg.shadowRiskCodes instanceof Set &&
    Array.isArray(cfg.blockedRegimePrefixes)
  ) {
    return cfg
  }
  const blockRiskCodes = Array.isArray(cfg?.blockRiskCodes)
    ? cfg.blockRiskCodes
    : ["LOW_LIQUIDITY_SOFT", "SMALL_MARKET_CAP"]
  const shadowRiskCodes = Array.isArray(cfg?.shadowRiskCodes)
    ? cfg.shadowRiskCodes
    : []
  const blockedRegimePrefixes = Array.isArray(cfg?.blockedRegimePrefixes)
    ? cfg.blockedRegimePrefixes
    : ["VOL_LOW_"]
  return {
    enabled: cfg?.enabled !== false,
    minLiquidityRatio: clamp01(cfg?.minLiquidityRatio ?? 0.6),
    minAvgTradingValue20dKrw: Math.max(0, Number(cfg?.minAvgTradingValue20dKrw ?? 800_000_000) || 800_000_000),
    hardCapMinAvgTradingValue20dKrw: Math.max(
      0,
      Number(
        cfg?.hardCapMinAvgTradingValue20dKrw ??
          cfg?.minAvgTradingValue20dKrw ??
          800_000_000,
      ) || 0,
    ),
    blockWhenAvgTradingValueUnknown: cfg?.blockWhenAvgTradingValueUnknown !== false,
    maxDataFreshnessDays: Math.max(0, Number(cfg?.maxDataFreshnessDays ?? 1) || 1),
    blockRiskCodes: new Set(blockRiskCodes.map((it) => String(it ?? "").trim()).filter(Boolean)),
    shadowRiskCodes: new Set(shadowRiskCodes.map((it) => String(it ?? "").trim()).filter(Boolean)),
    blockedRegimePrefixes: blockedRegimePrefixes.map((it) => String(it ?? "").trim()).filter(Boolean),
    strongCandidateBypass: {
      enabled: cfg?.strongCandidateBypass?.enabled === true,
      minLiquidityRatio: num(cfg?.strongCandidateBypass?.minLiquidityRatio),
      minAvgTradingValue20dKrw: num(cfg?.strongCandidateBypass?.minAvgTradingValue20dKrw),
      maxDataFreshnessDays: num(cfg?.strongCandidateBypass?.maxDataFreshnessDays),
      minExpectedNetRet3d: num(cfg?.strongCandidateBypass?.minExpectedNetRet3d),
      minQualityScore: num(cfg?.strongCandidateBypass?.minQualityScore),
      maxAntiScore: num(cfg?.strongCandidateBypass?.maxAntiScore),
      minTargetStopEdge3d: num(cfg?.strongCandidateBypass?.minTargetStopEdge3d),
      minFinalScore: num(cfg?.strongCandidateBypass?.minFinalScore),
      minScoreMargin: num(cfg?.strongCandidateBypass?.minScoreMargin)
    }
  }
}

export const evaluateLiquidityFilters = ({ row, cfg }) => {
  const safeCfg = resolveLiquidityFilters(cfg)
  if (safeCfg.enabled !== true) {
    return {
      decision: "TRADE",
      reason: "LIQUIDITY_FILTER_DISABLED",
      checks: {}
    }
  }

  const checks = {
    regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
    liquidityRatio: Number(row?.regimeLiquidityProxy ?? 0),
    avgTradingValue20dKrw: Number(row?.avgTradingValue20dKrw ?? 0),
    dataFreshnessDays: Number(row?.dataFreshnessDays ?? 999),
    riskCodes: Array.isArray(row?.riskCodes) ? row.riskCodes : []
  }

  for (const prefix of safeCfg.blockedRegimePrefixes) {
    if (checks.regimeTag.startsWith(prefix)) {
      return { decision: "BLOCK", reason: "REGIME_BLOCKED", checks }
    }
  }
  if (
    Number.isFinite(checks.liquidityRatio) &&
    checks.liquidityRatio < Number(safeCfg.minLiquidityRatio ?? 0.6)
  ) {
    const bypass = evaluateStrongCandidateBypass({
      row,
      checks,
      cfg: safeCfg?.strongCandidateBypass
    })
    if (bypass?.eligible === true) {
      return {
        decision: "TRADE",
        reason: "LIQUIDITY_STRONG_CANDIDATE_BYPASS",
        checks: {
          ...checks,
          strongCandidateBypass: bypass.checks
        }
      }
    }
    return { decision: "BLOCK", reason: "LIQUIDITY_RATIO_LOW", checks }
  }
  if (
    safeCfg.blockWhenAvgTradingValueUnknown !== false &&
    (!Number.isFinite(checks.avgTradingValue20dKrw) || checks.avgTradingValue20dKrw <= 0)
  ) {
    return { decision: "BLOCK", reason: "AVG_TRADING_VALUE_UNKNOWN", checks }
  }
  if (
    Number.isFinite(checks.avgTradingValue20dKrw) &&
    checks.avgTradingValue20dKrw > 0 &&
    Number(safeCfg.hardCapMinAvgTradingValue20dKrw ?? 0) > 0 &&
    checks.avgTradingValue20dKrw < Number(safeCfg.hardCapMinAvgTradingValue20dKrw ?? 0)
  ) {
    return { decision: "BLOCK", reason: "AVG_TRADING_VALUE_HARD_CAP", checks }
  }
  if (
    Number.isFinite(checks.avgTradingValue20dKrw) &&
    checks.avgTradingValue20dKrw > 0 &&
    checks.avgTradingValue20dKrw < Number(safeCfg.minAvgTradingValue20dKrw ?? 0)
  ) {
    return { decision: "BLOCK", reason: "AVG_TRADING_VALUE_LOW", checks }
  }
  if (
    Number.isFinite(checks.dataFreshnessDays) &&
    checks.dataFreshnessDays > Number(safeCfg.maxDataFreshnessDays ?? 1)
  ) {
    return { decision: "BLOCK", reason: "DATA_STALE", checks }
  }
  for (const code of checks.riskCodes) {
    if (safeCfg.blockRiskCodes.has(String(code))) {
      return { decision: "BLOCK", reason: `RISK_CODE_${code}`, checks }
    }
  }
  for (const code of checks.riskCodes) {
    if (safeCfg.shadowRiskCodes.has(String(code))) {
      return { decision: "SHADOW", reason: `RISK_CODE_${code}`, checks }
    }
  }

  return { decision: "TRADE", reason: "LIQUIDITY_OK", checks }
}
