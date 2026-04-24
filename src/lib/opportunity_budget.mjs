const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const toFinite = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number(fallback) || 0
}

const toNonNegativeIntOrNull = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

const normalizeAction = (value) => {
  const text = String(value ?? "shadow").trim().toLowerCase()
  return text === "block" ? "block" : "shadow"
}

export const resolveOpportunityBudget = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled === true,
    action: normalizeAction(cfg?.action),
    maxExecutedPicks: toNonNegativeIntOrNull(cfg?.maxExecutedPicks, 1),
    maxFragileExecuted: toNonNegativeIntOrNull(cfg?.maxFragileExecuted, 1),
    maxLowLiquidityExecuted: toNonNegativeIntOrNull(cfg?.maxLowLiquidityExecuted, 0),
    maxExecutionHostileExecuted: toNonNegativeIntOrNull(cfg?.maxExecutionHostileExecuted, 1),
    maxSameRouteBucket: toNonNegativeIntOrNull(cfg?.maxSameRouteBucket, 1),
    maxSameRegimeTag: toNonNegativeIntOrNull(cfg?.maxSameRegimeTag, 1),
    maxSamePrototypeFamily: toNonNegativeIntOrNull(cfg?.maxSamePrototypeFamily, 1),
    fragileMaxFalsePositiveRisk: clamp01(cfg?.fragileMaxFalsePositiveRisk ?? 0.52),
    fragileMinScoreMargin: Math.max(0, toFinite(cfg?.fragileMinScoreMargin, 0.002)),
    lowLiquidityMinAvgTradingValue20dKrw: Math.max(
      0,
      toFinite(cfg?.lowLiquidityMinAvgTradingValue20dKrw, 1_200_000_000),
    ),
    executionHostileMaxSlippageRisk: Math.max(
      0,
      toFinite(cfg?.executionHostileMaxSlippageRisk, 0.08),
    ),
    executionHostileMinFillProb: clamp01(cfg?.executionHostileMinFillProb ?? 0.75)
  }
}

export const createOpportunityBudgetRuntime = ({ cfg, dayTypeDecision }) => {
  const safeCfg = resolveOpportunityBudget(cfg)
  const policy = dayTypeDecision?.policy ?? {}
  return {
    cfg: safeCfg,
    dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
    allowedRouteBuckets: Array.isArray(policy?.allowedRouteBuckets)
      ? policy.allowedRouteBuckets.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [],
    limits: {
      maxExecutedPicks: toNonNegativeIntOrNull(policy?.maxExecutedPicks, safeCfg.maxExecutedPicks),
      maxFragileExecuted: toNonNegativeIntOrNull(policy?.maxFragileExecuted, safeCfg.maxFragileExecuted),
      maxLowLiquidityExecuted: toNonNegativeIntOrNull(
        policy?.maxLowLiquidityExecuted,
        safeCfg.maxLowLiquidityExecuted,
      ),
      maxExecutionHostileExecuted: toNonNegativeIntOrNull(
        policy?.maxExecutionHostileExecuted,
        safeCfg.maxExecutionHostileExecuted,
      ),
      maxSameRouteBucket: toNonNegativeIntOrNull(policy?.maxSameRouteBucket, safeCfg.maxSameRouteBucket),
      maxSameRegimeTag: toNonNegativeIntOrNull(policy?.maxSameRegimeTag, safeCfg.maxSameRegimeTag),
      maxSamePrototypeFamily: toNonNegativeIntOrNull(
        policy?.maxSamePrototypeFamily,
        safeCfg.maxSamePrototypeFamily,
      )
    },
    usage: {
      accepted: 0,
      fragile: 0,
      lowLiquidity: 0,
      executionHostile: 0,
      routeCounts: new Map(),
      regimeCounts: new Map(),
      prototypeCounts: new Map()
    }
  }
}

const resolveBudgetFlags = ({ row, cfg }) => {
  const scoreMargin = Number(
    row?.gateScoreMargin ??
      row?.postRerankScoreMargin ??
      row?.rawScoreMargin ??
      row?.scoreMargin,
  )
  const falsePositiveRisk = Number(row?.falsePositiveRisk ?? 0)
  const avgTradingValue20dKrw = Math.max(0, Number(row?.avgTradingValue20dKrw ?? 0) || 0)
  const slippageRisk = Math.max(0, Number(row?.slippageRisk ?? 0) || 0)
  const pFill = clamp01(row?.calibrated?.pFillCalibrated ?? 0)
  return {
    fragile:
      (Number.isFinite(scoreMargin) && scoreMargin < Number(cfg?.fragileMinScoreMargin ?? 0)) ||
      (Number.isFinite(falsePositiveRisk) &&
        falsePositiveRisk >= Number(cfg?.fragileMaxFalsePositiveRisk ?? 1)),
    lowLiquidity:
      avgTradingValue20dKrw > 0 &&
      avgTradingValue20dKrw < Number(cfg?.lowLiquidityMinAvgTradingValue20dKrw ?? 0),
    executionHostile:
      slippageRisk >= Number(cfg?.executionHostileMaxSlippageRisk ?? Number.POSITIVE_INFINITY) ||
      pFill < Number(cfg?.executionHostileMinFillProb ?? 0),
    routeBucket: String(row?.routeBucket ?? "__DEFAULT__").trim() || "__DEFAULT__",
    regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN").trim() || "VOL_UNKNOWN_LIQ_UNKNOWN",
    prototypeFamilyKey:
      String(
        row?.prototypeFamilyKey ??
          row?.matchedPrototypeClusterId ??
          row?.matchedPrototypeId ??
          "__NONE__",
      ).trim() || "__NONE__"
  }
}

const toBudgetDecisionCode = ({ action, suffix }) => {
  const prefix = String(action ?? "shadow").trim().toLowerCase() === "block" ? "BLOCK" : "SHADOW"
  return `${prefix}_BUDGET_${suffix}`
}

export const evaluateOpportunityBudget = ({ row, runtime }) => {
  const safeRuntime = runtime ?? createOpportunityBudgetRuntime({ cfg: null, dayTypeDecision: null })
  const cfg = safeRuntime.cfg
  if (cfg?.enabled !== true) {
    return {
      decision: "TRADE",
      reason: null,
      checks: {}
    }
  }

  const limits = safeRuntime.limits ?? {}
  const usage = safeRuntime.usage ?? {}
  const flags = resolveBudgetFlags({ row, cfg })
  const routeCount = Number(usage?.routeCounts?.get?.(flags.routeBucket) ?? 0) || 0
  const regimeCount = Number(usage?.regimeCounts?.get?.(flags.regimeTag) ?? 0) || 0
  const prototypeCount = Number(usage?.prototypeCounts?.get?.(flags.prototypeFamilyKey) ?? 0) || 0
  const allowedRouteBuckets = Array.isArray(safeRuntime?.allowedRouteBuckets)
    ? safeRuntime.allowedRouteBuckets
    : []
  const acceptedCount = Number(usage?.accepted ?? 0) || 0
  const singlePickMode =
    Number.isInteger(limits?.maxExecutedPicks) &&
    limits.maxExecutedPicks === 1
  const firstAcceptedSlotOpen = singlePickMode && acceptedCount < 1

  let reasonSuffix = null
  let reason = null
  if (allowedRouteBuckets.length > 0 && !allowedRouteBuckets.includes(flags.routeBucket)) {
    reasonSuffix = "ROUTE_BLOCKED"
    reason = "DAY_TYPE_ROUTE_BLOCKED"
  } else if (
    Number.isInteger(limits?.maxExecutedPicks) &&
    limits.maxExecutedPicks >= 0 &&
    acceptedCount >= limits.maxExecutedPicks
  ) {
    reasonSuffix = "MAX_EXECUTED"
    reason = "BUDGET_MAX_EXECUTED_REACHED"
  } else if (firstAcceptedSlotOpen) {
    reasonSuffix = null
    reason = null
  } else if (
    flags.fragile &&
    Number.isInteger(limits?.maxFragileExecuted) &&
    limits.maxFragileExecuted >= 0 &&
    Number(usage?.fragile ?? 0) >= limits.maxFragileExecuted
  ) {
    reasonSuffix = "FRAGILE"
    reason = "BUDGET_FRAGILE_LIMIT"
  } else if (
    flags.lowLiquidity &&
    Number.isInteger(limits?.maxLowLiquidityExecuted) &&
    limits.maxLowLiquidityExecuted >= 0 &&
    Number(usage?.lowLiquidity ?? 0) >= limits.maxLowLiquidityExecuted
  ) {
    reasonSuffix = "LOW_LIQUIDITY"
    reason = "BUDGET_LOW_LIQUIDITY_LIMIT"
  } else if (
    flags.executionHostile &&
    Number.isInteger(limits?.maxExecutionHostileExecuted) &&
    limits.maxExecutionHostileExecuted >= 0 &&
    Number(usage?.executionHostile ?? 0) >= limits.maxExecutionHostileExecuted
  ) {
    reasonSuffix = "EXECUTION_HOSTILE"
    reason = "BUDGET_EXECUTION_HOSTILE_LIMIT"
  } else if (
    Number.isInteger(limits?.maxSameRouteBucket) &&
    limits.maxSameRouteBucket >= 0 &&
    routeCount >= limits.maxSameRouteBucket
  ) {
    reasonSuffix = "SAME_ROUTE"
    reason = "BUDGET_SAME_ROUTE_LIMIT"
  } else if (
    Number.isInteger(limits?.maxSameRegimeTag) &&
    limits.maxSameRegimeTag >= 0 &&
    regimeCount >= limits.maxSameRegimeTag
  ) {
    reasonSuffix = "SAME_REGIME"
    reason = "BUDGET_SAME_REGIME_LIMIT"
  } else if (
    Number.isInteger(limits?.maxSamePrototypeFamily) &&
    limits.maxSamePrototypeFamily >= 0 &&
    prototypeCount >= limits.maxSamePrototypeFamily
  ) {
    reasonSuffix = "SAME_PROTOTYPE"
    reason = "BUDGET_SAME_PROTOTYPE_LIMIT"
  }

  return {
    decision: reasonSuffix ? toBudgetDecisionCode({ action: cfg?.action, suffix: reasonSuffix }) : "TRADE",
    reason,
    checks: {
      dayType: safeRuntime?.dayType ?? "BALANCED",
      flags,
      limits,
      usage: {
        accepted: Number(usage?.accepted ?? 0) || 0,
        fragile: Number(usage?.fragile ?? 0) || 0,
        lowLiquidity: Number(usage?.lowLiquidity ?? 0) || 0,
        executionHostile: Number(usage?.executionHostile ?? 0) || 0,
        routeCount,
        regimeCount,
        prototypeCount
      },
      allowedRouteBuckets
    }
  }
}

export const recordOpportunityBudgetAcceptance = ({ row, runtime }) => {
  const safeRuntime = runtime ?? createOpportunityBudgetRuntime({ cfg: null, dayTypeDecision: null })
  const usage = safeRuntime.usage
  const flags = resolveBudgetFlags({ row, cfg: safeRuntime.cfg })
  usage.accepted = Number(usage.accepted ?? 0) + 1
  if (flags.fragile) usage.fragile = Number(usage.fragile ?? 0) + 1
  if (flags.lowLiquidity) usage.lowLiquidity = Number(usage.lowLiquidity ?? 0) + 1
  if (flags.executionHostile) usage.executionHostile = Number(usage.executionHostile ?? 0) + 1
  usage.routeCounts.set(flags.routeBucket, Number(usage.routeCounts.get(flags.routeBucket) ?? 0) + 1)
  usage.regimeCounts.set(flags.regimeTag, Number(usage.regimeCounts.get(flags.regimeTag) ?? 0) + 1)
  usage.prototypeCounts.set(
    flags.prototypeFamilyKey,
    Number(usage.prototypeCounts.get(flags.prototypeFamilyKey) ?? 0) + 1,
  )
}
