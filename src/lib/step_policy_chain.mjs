import {
  applyTop1MicroCorrection,
  rerankTopForTop1,
  selectPickByGate,
  selectPicksByGate
} from "./decision_policy.mjs"
import { estimateCalibratedSignals } from "./calibration.mjs"
import { evaluateMetaSelector } from "./meta_selector.mjs"
import { evaluateExecutionGate } from "./execution_gate.mjs"
import { evaluateFalsePositiveGate } from "./false_positive_gate.mjs"
import { evaluateAgreementGate } from "./agreement_gate.mjs"
import { scoreFalsePositiveModel } from "./false_positive_model.mjs"
import {
  createOpportunityBudgetRuntime,
  evaluateOpportunityBudget,
  recordOpportunityBudgetAcceptance
} from "./opportunity_budget.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const SCORE_PATHOLOGY_COMPONENTS = [
  "POST_ADJUST_HEAVY",
  "REGIME_EXPERT_HEAVY",
  "EXTENDED_BIAS_HEAVY",
  "TRADE_QUALITY_HEAVY",
  "EXECUTION_PRIOR_HEAVY",
  "MIXED_DEEP_FAIL"
]

const SCORE_PATHOLOGY_SUBCOMPONENTS = [
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
]

const SCORE_PATHOLOGY_SUBCOMPONENT_ALIASES = {
  SINGLE_ERA_CONCENTRATION_PENALTY: ["SINGLE_ERA_CONCENTRATION_PENALTY", "SINGLE_ERA_PENALTY"],
  SUPPORT_COUNT_PENALTY: ["SUPPORT_COUNT_PENALTY", "LOW_ERA_SUPPORT_PENALTY"],
  ERA_COVERAGE_PENALTY: ["ERA_COVERAGE_PENALTY"]
}

const ERA_SUPPORT_LIKE_SUBCOMPONENTS = new Set([
  "LOW_ERA_SUPPORT_PENALTY",
  "SUPPORT_COUNT_PENALTY",
  "ERA_COVERAGE_PENALTY",
  "SINGLE_ERA_PENALTY",
  "SINGLE_ERA_CONCENTRATION_PENALTY"
])

const normalizeScorePathologyComponent = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  return SCORE_PATHOLOGY_COMPONENTS.includes(text) ? text : null
}

const normalizeScorePathologySubcomponent = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  return SCORE_PATHOLOGY_SUBCOMPONENTS.includes(text) ? text : null
}

const isEraSupportLikeSubcomponent = (value) =>
  ERA_SUPPORT_LIKE_SUBCOMPONENTS.has(normalizeScorePathologySubcomponent(value))

const resolveScorePathologyCompositeType = ({
  primarySubcomponent,
  secondarySubcomponent
}) => {
  const parts = [
    normalizeScorePathologySubcomponent(primarySubcomponent),
    normalizeScorePathologySubcomponent(secondarySubcomponent)
  ].filter(Boolean)
  if (parts.length < 1) return null
  const set = new Set(parts)
  const hasEraSupportLike = parts.some((part) => isEraSupportLikeSubcomponent(part))
  if (hasEraSupportLike && set.has("SLIPPAGE_PENALTY")) {
    return "ERA_SUPPORT_PLUS_SLIPPAGE"
  }
  if (hasEraSupportLike && set.has("STOP_RATE_PENALTY")) {
    return "ERA_SUPPORT_PLUS_STOP_RATE"
  }
  if (hasEraSupportLike && set.has("REGIME_MULTIPLIER_PENALTY")) {
    return "ERA_SUPPORT_PLUS_REGIME"
  }
  if (set.size === 1 && hasEraSupportLike) {
    return "ERA_SUPPORT_ONLY"
  }
  if (hasEraSupportLike) {
    return "ERA_SUPPORT_PLUS_OTHER"
  }
  if (parts.length > 1) return `${parts[0]}_PLUS_${parts[1]}`
  return `${parts[0]}_ONLY`
}

const summarizeOrderingCandidate = (row, rank = null) => {
  if (!row || typeof row !== "object") return null
  const symbol = String(row?.symbol ?? "").trim()
  if (!symbol) return null
  return {
    symbol,
    rank: Number.isFinite(Number(rank)) ? Number(rank) : null,
    finalScore: num(row?.finalScore ?? row?.score),
    rankerScore: num(row?.rankerScore ?? row?.finalScore ?? row?.score),
    rawScoreMargin: num(row?.rawScoreMargin ?? row?.scoreMargin),
    preRerankScoreMargin: num(row?.preRerankScoreMargin),
    postRerankScoreMargin: num(row?.postRerankScoreMargin ?? row?.scoreMargin),
    gateScoreMargin: num(row?.gateScoreMargin ?? row?.rawScoreMargin ?? row?.scoreMargin),
    expectedNetRet3d: num(row?.expectedNetRet3d),
    qualityScore: num(row?.qualityScore),
    targetRate3d: num(row?.targetRate3d),
    stopRate3d: num(row?.stopRate3d),
    successInWindow: row?.successInWindow === true
  }
}

const resolveRowRank1Based = (rows, target) => {
  if (!Array.isArray(rows) || !target || typeof target !== "object") return null
  const targetSymbol = String(target?.symbol ?? "").trim()
  const idx = rows.findIndex((row) => {
    if (row === target) return true
    if (!row || typeof row !== "object") return false
    return (
      targetSymbol &&
      String(row?.symbol ?? "").trim() === targetSymbol
    )
  })
  return idx >= 0 ? idx + 1 : null
}

const bump = (obj, key) => {
  obj[key] = Number(obj[key] ?? 0) + 1
}

const WILSON_Z_95 = 1.959963984540054

const wilsonLowerBound95 = ({ success, total }) => {
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

const calcMeanStd = (values) => {
  const nums = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
  if (nums.length < 1) return { mean: 0, std: 0 }
  const mean = nums.reduce((acc, v) => acc + v, 0) / nums.length
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nums.length
  return {
    mean,
    std: variance > 0 ? Math.sqrt(variance) : 0
  }
}

const sumFinite = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .reduce((acc, value) => acc + value, 0)

const computePostScoreAdjustDelta = (row) =>
  sumFinite([
    row?.qualityBonus,
    row?.winRateBonus,
    row?.targetRateBonus,
    row?.expectedRetBonus,
    row?.eraCoverageBonus,
    -Number(row?.stopRatePenalty ?? 0),
    -Number(row?.antiPenalty ?? 0),
    -Number(row?.coveragePenalty ?? 0),
    -Number(row?.singleEraConcentrationPenalty ?? row?.singleEraPenalty ?? 0),
    -Number(row?.supportCountPenalty ?? row?.lowEraSupportPenalty ?? 0)
  ])

const resolveNegativePenalty = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n < 0 ? Math.abs(n) : 0
}

const resolvePositivePenalty = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.abs(n) : 0
}

const buildScorePenaltyComponents = (trace) => {
  const safe = trace && typeof trace === "object" ? trace : {}
  return [
    {
      component: "POST_ADJUST_HEAVY",
      penaltyAbs: resolveNegativePenalty(safe?.postScoreAdjustDelta)
    },
    {
      component: "REGIME_EXPERT_HEAVY",
      penaltyAbs: resolveNegativePenalty(safe?.regimeExpertDelta)
    },
    {
      component: "EXTENDED_BIAS_HEAVY",
      penaltyAbs: resolveNegativePenalty(safe?.extendedBiasDelta)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      penaltyAbs: resolveNegativePenalty(safe?.tradeQualityPriorDelta)
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      penaltyAbs: resolveNegativePenalty(safe?.executionPriorDelta)
    }
  ]
}

const buildScorePenaltySubcomponents = (trace) => {
  const safe = trace && typeof trace === "object" ? trace : {}
  const rows = [
    {
      component: "POST_ADJUST_HEAVY",
      subcomponent: "STOP_RATE_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.stopRatePenalty)
    },
    {
      component: "POST_ADJUST_HEAVY",
      subcomponent: "ANTI_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.antiPenalty)
    },
    {
      component: "POST_ADJUST_HEAVY",
      subcomponent: "SINGLE_ERA_CONCENTRATION_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.singleEraConcentrationPenalty ?? safe?.singleEraPenalty)
    },
    {
      component: "POST_ADJUST_HEAVY",
      subcomponent: "SUPPORT_COUNT_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.supportCountPenalty ?? safe?.lowEraSupportPenalty)
    },
    {
      component: "POST_ADJUST_HEAVY",
      subcomponent: "ERA_COVERAGE_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.coveragePenalty)
    },
    {
      component: "REGIME_EXPERT_HEAVY",
      subcomponent: "REGIME_MULTIPLIER_PENALTY",
      penaltyAbs: resolveNegativePenalty(safe?.regimeExpertDelta)
    },
    {
      component: "EXTENDED_BIAS_HEAVY",
      subcomponent: "EXTENDED_BIAS_PENALTY",
      penaltyAbs: resolveNegativePenalty(safe?.extendedBiasDelta)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      subcomponent: "TRADE_QUALITY_RANKER_ADJUSTMENT",
      penaltyAbs: resolveNegativePenalty(safe?.tradeQualityRankerAdjustment)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      subcomponent: "TRADE_QUALITY_ROUTE_RESIDUAL",
      penaltyAbs: resolveNegativePenalty(safe?.tradeQualityRouteResidual)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      subcomponent: "TRADE_QUALITY_REGIME_RESIDUAL",
      penaltyAbs: resolveNegativePenalty(safe?.tradeQualityRegimeResidual)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      subcomponent: "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
      penaltyAbs: resolveNegativePenalty(safe?.tradeQualityPrototypeResidual)
    },
    {
      component: "TRADE_QUALITY_HEAVY",
      subcomponent: "TRADE_QUALITY_TOTAL_FALLBACK",
      penaltyAbs:
        resolveNegativePenalty(safe?.tradeQualityPriorDelta) > 0 &&
        resolveNegativePenalty(safe?.tradeQualityRankerAdjustment) <= 0 &&
        resolveNegativePenalty(safe?.tradeQualityRouteResidual) <= 0 &&
        resolveNegativePenalty(safe?.tradeQualityRegimeResidual) <= 0 &&
        resolveNegativePenalty(safe?.tradeQualityPrototypeResidual) <= 0
          ? resolveNegativePenalty(safe?.tradeQualityPriorDelta)
          : 0
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      subcomponent: "LOW_FILL_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.executionPriorLowFillPenalty)
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      subcomponent: "SLIPPAGE_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.executionPriorSlippagePenalty)
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      subcomponent: "LOW_LIQUIDITY_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.executionPriorLowLiquidityPenalty)
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      subcomponent: "BLOCKED_ORDER_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.executionPriorBlockedOrderPenalty)
    },
    {
      component: "EXECUTION_PRIOR_HEAVY",
      subcomponent: "NEGATIVE_AFTER_COST_PENALTY",
      penaltyAbs: resolvePositivePenalty(safe?.executionPriorNegativeAfterCostPenalty)
    }
  ]
  return rows.filter((row) => Number.isFinite(row?.penaltyAbs) && row.penaltyAbs > 0)
}

const resolveScorePathologyFromTrace = (trace) => {
  const components = buildScorePenaltyComponents(trace)
    .filter((row) => Number.isFinite(row?.penaltyAbs) && row.penaltyAbs > 0)
    .sort((left, right) => Number(right.penaltyAbs) - Number(left.penaltyAbs))
  const subcomponents = buildScorePenaltySubcomponents(trace)
    .sort((left, right) => Number(right.penaltyAbs) - Number(left.penaltyAbs))
  if (components.length < 1) {
    return {
      componentDominantPenalty: null,
      componentPenaltyAbs: null,
      componentPenaltyShare: null,
      scorePathologyPrimaryComponent: null,
      scorePathologySecondaryComponent: null,
      scorePathologyPrimarySubcomponent: null,
      scorePathologySecondarySubcomponent: null,
      scorePathologyCompositeType: null,
      scorePathologyTotalPenaltyAbs: 0,
      componentPenaltyByComponent: {},
      subcomponentPenaltyBySubcomponent: {}
    }
  }
  const totalPenaltyAbs = components.reduce((acc, row) => acc + Number(row.penaltyAbs ?? 0), 0)
  const primary = components[0] ?? null
  const secondary = components[1] ?? null
  const componentPenaltyByComponent = Object.fromEntries(
    components.map((row) => [row.component, Number(row.penaltyAbs ?? 0) || 0])
  )
  const subcomponentPenaltyBySubcomponent = Object.fromEntries(
    subcomponents.map((row) => [row.subcomponent, Number(row.penaltyAbs ?? 0) || 0])
  )
  const primaryShare =
    totalPenaltyAbs > 0 && Number.isFinite(Number(primary?.penaltyAbs))
      ? Number(primary.penaltyAbs) / totalPenaltyAbs
      : 0
  const effectivePrimaryComponent =
    primaryShare >= 0.55
      ? primary?.component ?? null
      : "MIXED_DEEP_FAIL"
  const preferredSubcomponents =
    effectivePrimaryComponent === "MIXED_DEEP_FAIL"
      ? subcomponents
      : subcomponents.filter((row) => row.component === effectivePrimaryComponent)
  const primarySubcomponent = preferredSubcomponents[0] ?? null
  const secondarySubcomponent = preferredSubcomponents[1] ?? null
  const scorePathologyCompositeType = resolveScorePathologyCompositeType({
    primarySubcomponent: primarySubcomponent?.subcomponent,
    secondarySubcomponent: secondarySubcomponent?.subcomponent
  })
  return {
    componentDominantPenalty:
      effectivePrimaryComponent,
    componentPenaltyAbs: Number(primary?.penaltyAbs ?? 0) || 0,
    componentPenaltyShare: primaryShare,
    scorePathologyPrimaryComponent: effectivePrimaryComponent,
    scorePathologySecondaryComponent:
      primaryShare >= 0.55
        ? secondary?.component ?? null
        : (primary?.component ?? null),
    scorePathologyPrimarySubcomponent: primarySubcomponent?.subcomponent ?? null,
    scorePathologySecondarySubcomponent: secondarySubcomponent?.subcomponent ?? null,
    scorePathologyCompositeType,
    scorePathologyTotalPenaltyAbs: totalPenaltyAbs,
    componentPenaltyByComponent,
    subcomponentPenaltyBySubcomponent
  }
}

const capNegativeDelta = ({ delta, cap }) => {
  const value = Number(delta)
  const capValue = Number(cap)
  if (!Number.isFinite(value)) return null
  if (!Number.isFinite(capValue) || capValue < 0 || value >= 0) return value
  return -Math.min(Math.abs(value), capValue)
}

const capPositivePenalty = ({ penalty, cap }) => {
  const value = Number(penalty)
  const capValue = Number(cap)
  if (!Number.isFinite(value)) return null
  if (!Number.isFinite(capValue) || capValue < 0 || value <= 0) return value
  return Math.min(value, capValue)
}

const resolveConfiguredCap = ({ component, subcomponent, capsByComponent, capsBySubcomponent }) => {
  const normalizedSubcomponent = normalizeScorePathologySubcomponent(subcomponent)
  const normalizedComponent = normalizeScorePathologyComponent(component)
  const aliasKeys = normalizedSubcomponent
    ? SCORE_PATHOLOGY_SUBCOMPONENT_ALIASES[normalizedSubcomponent] ?? [normalizedSubcomponent]
    : []
  for (const aliasKey of aliasKeys) {
    const subCap = num(capsBySubcomponent?.[aliasKey])
    if (aliasKey && Number.isFinite(subCap) && subCap >= 0) return subCap
  }
  const componentCap = num(capsByComponent?.[normalizedComponent])
  if (normalizedComponent && Number.isFinite(componentCap) && componentCap >= 0) return componentCap
  return null
}

const buildScoreRecalibratedTrace = ({ trace, capsByComponent, capsBySubcomponent }) => {
  const safeTrace = trace && typeof trace === "object" ? trace : {}
  const safeCaps = capsByComponent && typeof capsByComponent === "object" ? capsByComponent : {}
  const safeSubCaps =
    capsBySubcomponent && typeof capsBySubcomponent === "object" ? capsBySubcomponent : {}
  const hasPostAdjustSubCap = [
    "STOP_RATE_PENALTY",
    "ANTI_PENALTY",
    "SINGLE_ERA_CONCENTRATION_PENALTY",
    "SINGLE_ERA_PENALTY",
    "SUPPORT_COUNT_PENALTY",
    "ERA_COVERAGE_PENALTY",
    "LOW_ERA_SUPPORT_PENALTY"
  ].some((key) => Number.isFinite(num(safeSubCaps?.[key])))
  const hasExecutionSubCap = [
    "LOW_FILL_PENALTY",
    "SLIPPAGE_PENALTY",
    "LOW_LIQUIDITY_PENALTY",
    "BLOCKED_ORDER_PENALTY",
    "NEGATIVE_AFTER_COST_PENALTY"
  ].some((key) => Number.isFinite(num(safeSubCaps?.[key])))
  const recalibratedStopRatePenalty = hasPostAdjustSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.stopRatePenalty,
        cap: resolveConfiguredCap({
          component: "POST_ADJUST_HEAVY",
          subcomponent: "STOP_RATE_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.stopRatePenalty)
  const recalibratedAntiPenalty = hasPostAdjustSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.antiPenalty,
        cap: resolveConfiguredCap({
          component: "POST_ADJUST_HEAVY",
          subcomponent: "ANTI_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.antiPenalty)
  const recalibratedSingleEraPenalty = hasPostAdjustSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.singleEraConcentrationPenalty ?? safeTrace?.singleEraPenalty,
        cap: resolveConfiguredCap({
          component: "POST_ADJUST_HEAVY",
          subcomponent: "SINGLE_ERA_CONCENTRATION_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.singleEraConcentrationPenalty ?? safeTrace?.singleEraPenalty)
  const recalibratedSupportCountPenalty = hasPostAdjustSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.supportCountPenalty ?? safeTrace?.lowEraSupportPenalty,
        cap: resolveConfiguredCap({
          component: "POST_ADJUST_HEAVY",
          subcomponent: "SUPPORT_COUNT_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.supportCountPenalty ?? safeTrace?.lowEraSupportPenalty)
  const recalibratedCoveragePenalty = hasPostAdjustSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.coveragePenalty,
        cap: resolveConfiguredCap({
          component: "POST_ADJUST_HEAVY",
          subcomponent: "ERA_COVERAGE_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.coveragePenalty)
  const postScoreAdjustDelta = hasPostAdjustSubCap
    ? [
        safeTrace?.qualityBonus,
        safeTrace?.winRateBonus,
        safeTrace?.targetRateBonus,
        safeTrace?.expectedRetBonus,
        safeTrace?.eraCoverageBonus,
        recalibratedCoveragePenalty != null ? -recalibratedCoveragePenalty : null,
        recalibratedStopRatePenalty != null ? -recalibratedStopRatePenalty : null,
        recalibratedAntiPenalty != null ? -recalibratedAntiPenalty : null,
        recalibratedSingleEraPenalty != null ? -recalibratedSingleEraPenalty : null,
        recalibratedSupportCountPenalty != null ? -recalibratedSupportCountPenalty : null
      ].reduce((acc, value) => {
        const n = num(value)
        return n == null ? acc : acc + n
      }, 0)
    : capNegativeDelta({
        delta: safeTrace?.postScoreAdjustDelta,
        cap: safeCaps?.POST_ADJUST_HEAVY
      })
  const regimeExpertDelta = capNegativeDelta({
    delta: safeTrace?.regimeExpertDelta,
    cap: safeCaps?.REGIME_EXPERT_HEAVY
  })
  const extendedBiasDelta = capNegativeDelta({
    delta: safeTrace?.extendedBiasDelta,
    cap: safeCaps?.EXTENDED_BIAS_HEAVY
  })
  const tradeQualityPriorDelta = capNegativeDelta({
    delta: safeTrace?.tradeQualityPriorDelta,
    cap: safeCaps?.TRADE_QUALITY_HEAVY
  })
  const recalibratedExecutionPriorLowFillPenalty = hasExecutionSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.executionPriorLowFillPenalty,
        cap: resolveConfiguredCap({
          component: "EXECUTION_PRIOR_HEAVY",
          subcomponent: "LOW_FILL_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.executionPriorLowFillPenalty)
  const recalibratedExecutionPriorSlippagePenalty = hasExecutionSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.executionPriorSlippagePenalty,
        cap: resolveConfiguredCap({
          component: "EXECUTION_PRIOR_HEAVY",
          subcomponent: "SLIPPAGE_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.executionPriorSlippagePenalty)
  const recalibratedExecutionPriorLowLiquidityPenalty = hasExecutionSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.executionPriorLowLiquidityPenalty,
        cap: resolveConfiguredCap({
          component: "EXECUTION_PRIOR_HEAVY",
          subcomponent: "LOW_LIQUIDITY_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.executionPriorLowLiquidityPenalty)
  const recalibratedExecutionPriorBlockedOrderPenalty = hasExecutionSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.executionPriorBlockedOrderPenalty,
        cap: resolveConfiguredCap({
          component: "EXECUTION_PRIOR_HEAVY",
          subcomponent: "BLOCKED_ORDER_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.executionPriorBlockedOrderPenalty)
  const recalibratedExecutionPriorNegativeAfterCostPenalty = hasExecutionSubCap
    ? capPositivePenalty({
        penalty: safeTrace?.executionPriorNegativeAfterCostPenalty,
        cap: resolveConfiguredCap({
          component: "EXECUTION_PRIOR_HEAVY",
          subcomponent: "NEGATIVE_AFTER_COST_PENALTY",
          capsByComponent: safeCaps,
          capsBySubcomponent: safeSubCaps
        })
      })
    : num(safeTrace?.executionPriorNegativeAfterCostPenalty)
  const executionPriorDelta = hasExecutionSubCap
    ? [
        safeTrace?.executionPriorPositiveAfterCostBonus,
        recalibratedExecutionPriorLowFillPenalty != null ? -recalibratedExecutionPriorLowFillPenalty : null,
        recalibratedExecutionPriorSlippagePenalty != null ? -recalibratedExecutionPriorSlippagePenalty : null,
        recalibratedExecutionPriorLowLiquidityPenalty != null ? -recalibratedExecutionPriorLowLiquidityPenalty : null,
        recalibratedExecutionPriorBlockedOrderPenalty != null ? -recalibratedExecutionPriorBlockedOrderPenalty : null,
        recalibratedExecutionPriorNegativeAfterCostPenalty != null
          ? -recalibratedExecutionPriorNegativeAfterCostPenalty
          : null
      ].reduce((acc, value) => {
        const n = num(value)
        return n == null ? acc : acc + n
      }, 0)
    : capNegativeDelta({
        delta: safeTrace?.executionPriorDelta,
        cap: safeCaps?.EXECUTION_PRIOR_HEAVY
      })
  const baseScore = num(safeTrace?.baseScore)
  const finalScorePostAdjust =
    Number.isFinite(baseScore) && Number.isFinite(postScoreAdjustDelta)
      ? baseScore + postScoreAdjustDelta
      : null
  const finalScoreAfterRegimeExpert =
    Number.isFinite(finalScorePostAdjust) && Number.isFinite(regimeExpertDelta)
      ? finalScorePostAdjust + regimeExpertDelta
      : null
  const finalScorePreExecutionPrior =
    Number.isFinite(finalScoreAfterRegimeExpert) &&
    Number.isFinite(extendedBiasDelta) &&
    Number.isFinite(tradeQualityPriorDelta)
      ? finalScoreAfterRegimeExpert + extendedBiasDelta + tradeQualityPriorDelta
      : null
  const finalScorePostExecutionPrior =
    Number.isFinite(finalScorePreExecutionPrior) && Number.isFinite(executionPriorDelta)
      ? finalScorePreExecutionPrior + executionPriorDelta
      : null
  const cappedPenaltiesByComponent = {}
  const cappedPenaltiesBySubcomponent = {}
  for (const component of SCORE_PATHOLOGY_COMPONENTS) {
    const orig = Number(safeTrace?.componentPenaltyByComponent?.[component] ?? 0)
    const next = Number(
      buildScorePenaltyComponents({
        postScoreAdjustDelta,
        regimeExpertDelta,
        extendedBiasDelta,
        tradeQualityPriorDelta,
        executionPriorDelta
      }).find((row) => row.component === component)?.penaltyAbs ?? 0,
    )
    if (Number.isFinite(orig) && Number.isFinite(next) && orig > next) {
      cappedPenaltiesByComponent[component] = orig - next
    }
  }
  for (const subcomponent of SCORE_PATHOLOGY_SUBCOMPONENTS) {
    const orig = Number(safeTrace?.subcomponentPenaltyBySubcomponent?.[subcomponent] ?? 0)
    const next = Number(
      buildScorePenaltySubcomponents({
        stopRatePenalty: recalibratedStopRatePenalty,
        antiPenalty: recalibratedAntiPenalty,
        singleEraConcentrationPenalty: recalibratedSingleEraPenalty,
        supportCountPenalty: recalibratedSupportCountPenalty,
        coveragePenalty: recalibratedCoveragePenalty,
        regimeExpertDelta,
        extendedBiasDelta,
        tradeQualityPriorDelta,
        tradeQualityRankerAdjustment: safeTrace?.tradeQualityRankerAdjustment,
        tradeQualityRouteResidual: safeTrace?.tradeQualityRouteResidual,
        tradeQualityRegimeResidual: safeTrace?.tradeQualityRegimeResidual,
        tradeQualityPrototypeResidual: safeTrace?.tradeQualityPrototypeResidual,
        executionPriorLowFillPenalty: recalibratedExecutionPriorLowFillPenalty,
        executionPriorSlippagePenalty: recalibratedExecutionPriorSlippagePenalty,
        executionPriorLowLiquidityPenalty: recalibratedExecutionPriorLowLiquidityPenalty,
        executionPriorBlockedOrderPenalty: recalibratedExecutionPriorBlockedOrderPenalty,
        executionPriorNegativeAfterCostPenalty: recalibratedExecutionPriorNegativeAfterCostPenalty
      }).find((row) => row.subcomponent === subcomponent)?.penaltyAbs ?? 0,
    )
    if (Number.isFinite(orig) && Number.isFinite(next) && orig > next) {
      cappedPenaltiesBySubcomponent[subcomponent] = orig - next
    }
  }
  return {
    postScoreAdjustDelta,
    regimeExpertDelta,
    extendedBiasDelta,
    tradeQualityPriorDelta,
    executionPriorDelta,
    stopRatePenalty: recalibratedStopRatePenalty,
    antiPenalty: recalibratedAntiPenalty,
    coveragePenalty: recalibratedCoveragePenalty,
    supportCountPenalty: recalibratedSupportCountPenalty,
    singleEraConcentrationPenalty: recalibratedSingleEraPenalty,
    singleEraPenalty: recalibratedSingleEraPenalty,
    lowEraSupportPenalty: recalibratedSupportCountPenalty,
    executionPriorLowFillPenalty: recalibratedExecutionPriorLowFillPenalty,
    executionPriorSlippagePenalty: recalibratedExecutionPriorSlippagePenalty,
    executionPriorLowLiquidityPenalty: recalibratedExecutionPriorLowLiquidityPenalty,
    executionPriorBlockedOrderPenalty: recalibratedExecutionPriorBlockedOrderPenalty,
    executionPriorNegativeAfterCostPenalty: recalibratedExecutionPriorNegativeAfterCostPenalty,
    finalScorePostAdjust,
    finalScoreAfterRegimeExpert,
    finalScorePreExecutionPrior,
    finalScorePostExecutionPrior,
    cappedPenaltiesByComponent,
    cappedPenaltiesBySubcomponent
  }
}

const buildScoreOriginTrace = ({ top1, gateCfg }) => {
  if (!top1 || typeof top1 !== "object") return null
  const baseScore = num(top1?.baseScore)
  const postScoreAdjustDelta = computePostScoreAdjustDelta(top1)
  const finalScorePostAdjust =
    Number.isFinite(baseScore) ? baseScore + postScoreAdjustDelta : null
  const finalScorePreBias = num(top1?.finalScorePreBias)
  const regimeExpertDelta =
    Number.isFinite(finalScorePreBias) && Number.isFinite(finalScorePostAdjust)
      ? finalScorePreBias - finalScorePostAdjust
      : null
  const finalScoreAfterRegimeExpert = finalScorePreBias
  const regimeExpertMultiplier = num(top1?.regimeExpert?.scoreMultiplier ?? 1)
  const extendedBiasDelta = num(top1?.extendedBiasAdjustment)
  const tradeQualityPriorDelta = num(top1?.tradeQualityRankerAdjustment ?? top1?.tradeQualityPriorAdjustment)
  const finalScorePreExecutionPrior = num(top1?.finalScorePreExecutionPrior)
  const finalScorePostExecutionPrior = num(top1?.finalScore ?? top1?.score)
  const executionPriorDelta =
    Number.isFinite(finalScorePostExecutionPrior) && Number.isFinite(finalScorePreExecutionPrior)
      ? finalScorePostExecutionPrior - finalScorePreExecutionPrior
      : null
  const top1ScoreMargin = num(top1?.gateScoreMargin ?? top1?.rawScoreMargin ?? top1?.scoreMargin)
  const minFinalScore = num(gateCfg?.minFinalScore)
  const minScoreMargin =
    gateCfg?.useMinScoreMarginGate === false ? null : num(gateCfg?.minScoreMargin)
  const trace = {
    top1FinalScore: finalScorePostExecutionPrior,
    minFinalScore,
    minFinalScoreShortfall:
      Number.isFinite(minFinalScore) && Number.isFinite(finalScorePostExecutionPrior)
        ? Math.max(0, minFinalScore - finalScorePostExecutionPrior)
        : null,
    top1ScoreMargin,
    minScoreMargin,
    minScoreMarginShortfall:
      Number.isFinite(minScoreMargin) && Number.isFinite(top1ScoreMargin)
        ? Math.max(0, minScoreMargin - top1ScoreMargin)
        : null,
    baseScore,
    postScoreAdjustDelta,
    finalScorePostAdjust,
    finalScoreAfterRegimeExpert,
    finalScorePreBias,
    regimeExpertDelta,
    regimeExpertMultiplier,
    extendedBiasDelta,
    tradeQualityPriorDelta,
    executionPriorDelta,
    finalScorePreExecutionPrior,
    finalScorePostExecutionPrior,
    qualityBonus: num(top1?.qualityBonus),
    winRateBonus: num(top1?.winRateBonus),
    targetRateBonus: num(top1?.targetRateBonus),
    stopRatePenalty: num(top1?.stopRatePenalty),
    stopRatePenaltyRaw: num(top1?.stopRatePenaltyRaw),
    stopRatePenaltyRelief: num(top1?.stopRatePenaltyRelief),
    stopRatePenaltyReliefSignal: num(top1?.stopRatePenaltyReliefSignal),
    antiPenalty: num(top1?.antiPenalty),
    expectedRetBonus: num(top1?.expectedRetBonus),
    eraCoverageBonus: num(top1?.eraCoverageBonus),
    coveragePenalty: num(top1?.coveragePenalty),
    supportCountPenalty: num(top1?.supportCountPenalty ?? top1?.lowEraSupportPenalty),
    supportCountPenaltyRaw: num(top1?.supportCountPenaltyRaw),
    supportCountPenaltyRelief: num(top1?.supportCountPenaltyRelief),
    supportCountPenaltyReliefSignal: num(top1?.supportCountPenaltyReliefSignal),
    singleEraConcentrationPenaltyRaw: num(top1?.singleEraConcentrationPenaltyRaw),
    singleEraConcentrationPenaltyRelief: num(top1?.singleEraConcentrationPenaltyRelief),
    singleEraConcentrationPenaltyEvidenceRatio: num(top1?.singleEraConcentrationPenaltyEvidenceRatio),
    singleEraConcentrationPenalty: num(top1?.singleEraConcentrationPenalty ?? top1?.singleEraPenalty),
    singleEraPenalty: num(top1?.singleEraPenalty),
    lowEraSupportPenalty: num(top1?.lowEraSupportPenalty),
    failedBreakoutCount20: num(top1?.failedBreakoutCount20),
    gapFillThenContinueScore: num(top1?.gapFillThenContinueScore),
    gapFillThenRevertScore: num(top1?.gapFillThenRevertScore),
    executionFeasibilityScore: num(top1?.executionFeasibilityScore),
    prototypeFailedBreakoutCount20: num(top1?.prototypeFailedBreakoutCount20),
    prototypeGapFillThenContinueScore: num(top1?.prototypeGapFillThenContinueScore),
    prototypeGapFillThenRevertScore: num(top1?.prototypeGapFillThenRevertScore),
    prototypeExecutionFeasibilityScore: num(top1?.prototypeExecutionFeasibilityScore),
    tradeQualityFeatureAdjustment: num(top1?.tradeQualityFeatureAdjustment),
    tradeQualityPriorAdjustment: num(top1?.tradeQualityPriorAdjustment),
    tradeQualityRankerAdjustment: num(top1?.tradeQualityRankerAdjustment),
    tradeQualityRouteResidual: num(top1?.tradeQualityRouteResidual),
    tradeQualityRegimeResidual: num(top1?.tradeQualityRegimeResidual),
    tradeQualityPrototypeResidual: num(top1?.tradeQualityPrototypeResidual),
    executionPriorLowFillPenalty: num(top1?.executionPriorLowFillPenalty),
    executionPriorLowFillPenaltyRaw: num(top1?.executionPriorLowFillPenaltyRaw),
    executionPriorLowFillPenaltyRelief: num(top1?.executionPriorLowFillPenaltyRelief),
    executionPriorSlippagePenalty: num(top1?.executionPriorSlippagePenalty),
    executionPriorSlippagePenaltyRaw: num(top1?.executionPriorSlippagePenaltyRaw),
    executionPriorSlippagePenaltyRelief: num(top1?.executionPriorSlippagePenaltyRelief),
    executionPriorLowLiquidityPenalty: num(top1?.executionPriorLowLiquidityPenalty),
    executionPriorLowLiquidityPenaltyRaw: num(top1?.executionPriorLowLiquidityPenaltyRaw),
    executionPriorLowLiquidityPenaltyRelief: num(top1?.executionPriorLowLiquidityPenaltyRelief),
    executionPriorBlockedOrderPenalty: num(top1?.executionPriorBlockedOrderPenalty),
    executionPriorPositiveAfterCostBonus: num(top1?.executionPriorPositiveAfterCostBonus),
    executionPriorNegativeAfterCostPenalty: num(top1?.executionPriorNegativeAfterCostPenalty),
    clusterTemporalEraSupportCount: num(top1?.clusterTemporalEraSupportCount),
    clusterTemporalEraCoverageRatio: num(top1?.clusterTemporalEraCoverageRatio),
    targetEraCoverageRatio: num(top1?.targetEraCoverageRatio),
    clusterTemporalMaxSingleEraShare: num(top1?.clusterTemporalMaxSingleEraShare),
    clusterTemporalEffectiveSingleEraShare: num(top1?.clusterTemporalEffectiveSingleEraShare),
    clusterTemporalSingleEraEvidenceCoverageRatio: num(
      top1?.clusterTemporalSingleEraEvidenceCoverageRatio,
    ),
    clusterTemporalSingleEraEvidenceSupportRatio: num(
      top1?.clusterTemporalSingleEraEvidenceSupportRatio,
    ),
    clusterTemporalEffectiveEraCount: num(top1?.clusterTemporalEffectiveEraCount),
    clusterTemporalNormalizedEraEntropy: num(top1?.clusterTemporalNormalizedEraEntropy),
    clusterTemporalSingleEraEvidenceEffectiveEraCountRatio: num(
      top1?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio,
    ),
    clusterTemporalSingleEraEvidenceEntropyRatio: num(
      top1?.clusterTemporalSingleEraEvidenceEntropyRatio,
    ),
    maxSingleEraShareCap: num(top1?.maxSingleEraShareCap),
    minEraSupportCount: num(top1?.minEraSupportCount),
    eraSupportShortfall: num(top1?.eraSupportShortfall),
    eraCoverageShortfall: num(top1?.eraCoverageShortfall),
    singleEraShareExcess: num(top1?.singleEraShareExcess),
    eraSupportPenaltyReasonRaw: String(top1?.eraSupportPenaltyReasonRaw ?? "").trim() || null,
    eraSupportPenaltyReason: String(top1?.eraSupportPenaltyReason ?? "").trim() || null
  }
  return {
    ...trace,
    ...resolveScorePathologyFromTrace(trace)
  }
}

const evaluateCounterfactualGateCandidate = ({
  rows,
  candidateIndex,
  gateCfg,
  policyContract,
  agreementModel,
  agreementModelCfg
}) => {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const idx = Math.max(0, Number(candidateIndex ?? 0) || 0)
  const candidate = safeRows[idx] ?? null
  if (!candidate) return null
  const reorderedBase = [candidate].concat(safeRows.filter((_, rowIdx) => rowIdx !== idx))
  const nextCandidate = reorderedBase[1] ?? null
  const candidateScore = num(candidate?.finalScore ?? candidate?.score)
  const nextScore = num(nextCandidate?.finalScore ?? nextCandidate?.score)
  const counterfactualMargin =
    Number.isFinite(candidateScore) && Number.isFinite(nextScore)
      ? candidateScore - nextScore
      : Number.POSITIVE_INFINITY
  const reordered = reorderedBase.map((row, rowIdx) =>
    rowIdx === 0
      ? {
          ...row,
          gateScoreMargin: Number.isFinite(counterfactualMargin) ? counterfactualMargin : null,
          rawScoreMargin: Number.isFinite(counterfactualMargin) ? counterfactualMargin : null,
          scoreMargin: Number.isFinite(counterfactualMargin) ? counterfactualMargin : null
        }
      : row,
  )
  const baseGate = selectPickByGate({
    top: reordered,
    gateCfg
  })
  let gateReason = String(baseGate?.gateReason ?? "UNKNOWN").trim() || "UNKNOWN"
  let pass = baseGate?.pick === candidate
  const rankerScore = num(candidate?.rankerScore ?? candidate?.finalScore ?? candidate?.score)
  const tauRank = num(policyContract?.tauRank)
  if (pass && Number.isFinite(tauRank) && (!Number.isFinite(rankerScore) || rankerScore < tauRank)) {
    pass = false
    gateReason = "POLICY_TAU_RANK_LOW"
  }
  let agreementDecision = null
  let agreementReason = null
  const agreementEnabled = gateCfg?.agreementGate?.enabled === true
  const agreementEnforcementMode = String(gateCfg?.agreementGate?.enforcementMode ?? "hard_reject")
    .trim()
    .toLowerCase()
  if (agreementEnabled) {
    const agreementEval = evaluateAgreementGate({
      rows: reordered,
      selectedRow: candidate,
      cfg: gateCfg?.agreementGate,
      model: agreementModel,
      modelCfg: agreementModelCfg
    })
    agreementDecision = agreementEval?.decision ?? null
    agreementReason = agreementEval?.reason ?? null
    if (
      pass &&
      agreementEnforcementMode !== "shadow" &&
      String(agreementDecision ?? "").trim().toUpperCase() !== "TRADE"
    ) {
      pass = false
      gateReason = String(agreementReason ?? "AGREEMENT_REJECTED").trim() || "AGREEMENT_REJECTED"
    }
  }
  return {
    rank: idx + 1,
    symbol: String(candidate?.symbol ?? "").trim() || null,
    pass,
    gateReason,
    scoreMargin: Number.isFinite(Number(baseGate?.scoreMargin)) ? Number(baseGate.scoreMargin) : null,
    finalScore: num(candidate?.finalScore ?? candidate?.score),
    rankerScore,
    rawSimilarityScore: num(candidate?.rawSimilarityScore),
    localStageScore: num(candidate?.localStageScore),
    triggerStageScore: num(candidate?.triggerStageScore),
    expectedNetRet3d: num(candidate?.expectedNetRet3d),
    agreementDecision,
    agreementReason,
    successInWindow: candidate?.successInWindow === true
  }
}

const buildCounterfactualGateSweep = ({
  rows,
  gateCfg,
  policyContract,
  agreementModel,
  agreementModelCfg
}) => {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const topN = Math.min(
    safeRows.length,
    Math.max(
      1,
      Number(gateCfg?.agreementGate?.candidatePool ?? gateCfg?.top1Rerank?.candidatePool ?? 10) || 10,
    ),
  )
  const candidates = []
  for (let i = 0; i < topN; i += 1) {
    const evaluation = evaluateCounterfactualGateCandidate({
      rows: safeRows,
      candidateIndex: i,
      gateCfg,
      policyContract,
      agreementModel,
      agreementModelCfg
    })
    if (evaluation) candidates.push(evaluation)
  }
  const top1 = candidates[0] ?? null
  const altPassing = candidates.filter((candidate) => candidate.rank > 1 && candidate.pass === true)
  const bestPassing = candidates.find((candidate) => candidate.pass === true) ?? null
  const bestAltPassing = altPassing[0] ?? null
  const top1Pass = top1?.pass === true
  return {
    topN,
    candidates,
    top1Pass,
    top1GateReason: top1?.gateReason ?? null,
    topNPassExistsDay: bestPassing != null,
    bestPassingRank: bestPassing?.rank ?? null,
    bestPassingSymbol: bestPassing?.symbol ?? null,
    bestPassingWouldHitDay: bestPassing?.successInWindow === true,
    top1FailedButAltPassExistsDay: top1Pass !== true && bestAltPassing != null,
    top1FailedAndNoAltPassExistsDay: top1Pass !== true && bestAltPassing == null,
    bestAltPassingRank: bestAltPassing?.rank ?? null,
    bestAltPassingSymbol: bestAltPassing?.symbol ?? null,
    bestAltPassingWouldHitDay: bestAltPassing?.successInWindow === true
  }
}

const evaluateScoreRecoveryDecision = ({
  top,
  gate,
  gateCfg,
  scoreOriginTrace
}) => {
  const rows = Array.isArray(top) ? top : []
  const top1 = rows[0] ?? null
  const cfg = gateCfg?.scoreRecovery ?? {}
  const mode = String(cfg?.mode ?? "off").trim().toLowerCase()
  const gateReason = String(gate?.gateReason ?? "").trim().toUpperCase()
  const dayTypeDecision = gate?.dayTypeDecision ?? null
  const pathGuards = cfg?.pathGuards ?? {}
  const allowedGateReasons = Array.isArray(cfg?.allowedGateReasons)
    ? cfg.allowedGateReasons.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
    : []
  const allowedRuleDayTypes = Array.isArray(pathGuards?.allowedRuleDayTypes)
    ? pathGuards.allowedRuleDayTypes.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
    : []
  const allowedDayTypes = Array.isArray(pathGuards?.allowedDayTypes)
    ? pathGuards.allowedDayTypes.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
    : []
  const allowedPolicySources = Array.isArray(pathGuards?.allowedPolicySources)
    ? pathGuards.allowedPolicySources.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean)
    : []
  const ruleDayType = String(
    dayTypeDecision?.modelMeta?.ruleDayType ?? dayTypeDecision?.ruleDayType ?? "",
  )
    .trim()
    .toUpperCase()
  const finalDayType = String(dayTypeDecision?.dayType ?? "").trim().toUpperCase()
  const policySource = String(dayTypeDecision?.policySource ?? "").trim().toUpperCase()
  const avgSlippageRisk = num(
    dayTypeDecision?.signals?.avgSlippageRisk ??
      dayTypeDecision?.modelMeta?.edgeTradeEscapeGuard?.avgSlippageRisk,
  )
  const decision = {
    enabled: cfg?.enabled === true,
    mode,
    gateReason,
    recoveryReason: null,
    candidateSymbol: String(top1?.symbol ?? "").trim() || null,
    candidateRank: top1 ? 1 : null,
    allowedGateReasons,
    eligible: false,
    rejectionReasons: [],
    finalScoreShortfall: num(scoreOriginTrace?.minFinalScoreShortfall),
    scoreMarginShortfall: num(scoreOriginTrace?.minScoreMarginShortfall),
    rawSimilarityScore: num(top1?.rawSimilarityScore ?? top1?.baseScore),
    localStageScore: num(top1?.localStageScore),
    expectedNetRet3d: num(top1?.expectedNetRet3d),
    falsePositiveRisk: num(top1?.falsePositiveRisk),
    falsePositiveRiskAvailable: Number.isFinite(num(top1?.falsePositiveRisk)),
    fillProb: num(top1?.calibrated?.pFillCalibrated ?? top1?.pFillCalibrated),
    ruleDayType: ruleDayType || null,
    finalDayType: finalDayType || null,
    policySource: policySource || null,
    avgSlippageRisk,
    wouldTradeDay: false,
    wouldHitDay: false,
    wouldBeatBlockedTop1Day: false,
    sameAsBlockedTop1: top1 ? true : false,
    hardPassApplied: false
  }
  if (cfg?.enabled !== true || mode === "off") {
    decision.rejectionReasons.push("DISABLED")
    return decision
  }
  if (!top1) {
    decision.rejectionReasons.push("NO_TOP1")
    return decision
  }
  if (!gateReason || gateReason === "TRADE") {
    decision.rejectionReasons.push("NO_BLOCKED_TOP1")
    return decision
  }
  if (allowedGateReasons.length > 0 && !allowedGateReasons.includes(gateReason)) {
    decision.rejectionReasons.push("GATE_REASON_NOT_ALLOWED")
  }
  if (
    Number.isFinite(Number(cfg?.maxFinalScoreShortfall)) &&
    (
      !Number.isFinite(decision.finalScoreShortfall) ||
      decision.finalScoreShortfall > Number(cfg.maxFinalScoreShortfall)
    )
  ) {
    decision.rejectionReasons.push("FINAL_SCORE_SHORTFALL_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(cfg?.maxScoreMarginShortfall)) &&
    (
      !Number.isFinite(decision.scoreMarginShortfall) ||
      decision.scoreMarginShortfall > Number(cfg.maxScoreMarginShortfall)
    )
  ) {
    decision.rejectionReasons.push("SCORE_MARGIN_SHORTFALL_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(cfg?.minRawSimilarity)) &&
    (
      !Number.isFinite(decision.rawSimilarityScore) ||
      decision.rawSimilarityScore < Number(cfg.minRawSimilarity)
    )
  ) {
    decision.rejectionReasons.push("RAW_SIMILARITY_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minLocalStageScore)) &&
    (
      !Number.isFinite(decision.localStageScore) ||
      decision.localStageScore < Number(cfg.minLocalStageScore)
    )
  ) {
    decision.rejectionReasons.push("LOCAL_STAGE_SCORE_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minExpectedNetRet3d)) &&
    (
      !Number.isFinite(decision.expectedNetRet3d) ||
      decision.expectedNetRet3d < Number(cfg.minExpectedNetRet3d)
    )
  ) {
    decision.rejectionReasons.push("EXPECTED_NET_RET_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.maxFalsePositiveRisk)) &&
    Number.isFinite(decision.falsePositiveRisk) &&
    decision.falsePositiveRisk > Number(cfg.maxFalsePositiveRisk)
  ) {
    decision.rejectionReasons.push("FALSE_POSITIVE_RISK_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(cfg?.minFillProb)) &&
    (
      !Number.isFinite(decision.fillProb) ||
      decision.fillProb < Number(cfg.minFillProb)
    )
  ) {
    decision.rejectionReasons.push("FILL_PROB_TOO_LOW")
  }
  if (allowedRuleDayTypes.length > 0 && !allowedRuleDayTypes.includes(ruleDayType)) {
    decision.rejectionReasons.push("RULE_DAY_TYPE_NOT_ALLOWED")
  }
  if (allowedDayTypes.length > 0 && !allowedDayTypes.includes(finalDayType)) {
    decision.rejectionReasons.push("FINAL_DAY_TYPE_NOT_ALLOWED")
  }
  if (allowedPolicySources.length > 0 && !allowedPolicySources.includes(policySource)) {
    decision.rejectionReasons.push("POLICY_SOURCE_NOT_ALLOWED")
  }
  if (
    Number.isFinite(Number(pathGuards?.maxAvgSlippageRisk)) &&
    (
      !Number.isFinite(avgSlippageRisk) ||
      avgSlippageRisk > Number(pathGuards.maxAvgSlippageRisk)
    )
  ) {
    decision.rejectionReasons.push("AVG_SLIPPAGE_RISK_TOO_HIGH")
  }
  decision.eligible = decision.rejectionReasons.length < 1
  decision.recoveryReason = decision.eligible ? gateReason : null
  decision.wouldTradeDay = decision.eligible
  decision.wouldHitDay = decision.eligible && top1?.successInWindow === true
  return decision
}

const evaluateScoreRecalibrationDecision = ({
  top,
  gate,
  gateCfg,
  scoreOriginTrace,
  policyThresholds
}) => {
  const rows = Array.isArray(top) ? top : []
  const top1 = rows[0] ?? null
  const cfg = gateCfg?.scoreRecalibration ?? {}
  const mode = String(cfg?.mode ?? "off").trim().toLowerCase()
  const gateReason = String(gate?.gateReason ?? "").trim().toUpperCase()
  const allowedPrimaryComponents = Array.isArray(cfg?.allowedPrimaryComponents)
    ? cfg.allowedPrimaryComponents
      .map((value) => normalizeScorePathologyComponent(value))
      .filter(Boolean)
    : []
  const allowedPrimarySubcomponents = Array.isArray(cfg?.allowedPrimarySubcomponents)
    ? cfg.allowedPrimarySubcomponents
      .map((value) => normalizeScorePathologySubcomponent(value))
      .filter(Boolean)
    : []
  const capsByComponent =
    cfg?.maxPenaltyCapByComponent && typeof cfg.maxPenaltyCapByComponent === "object"
      ? Object.fromEntries(
          Object.entries(cfg.maxPenaltyCapByComponent)
            .map(([key, value]) => [normalizeScorePathologyComponent(key), num(value)])
            .filter(([key, value]) => key && Number.isFinite(value) && value >= 0)
        )
      : {}
  const capsBySubcomponent =
    cfg?.maxPenaltyCapBySubcomponent && typeof cfg.maxPenaltyCapBySubcomponent === "object"
      ? Object.fromEntries(
          Object.entries(cfg.maxPenaltyCapBySubcomponent)
            .map(([key, value]) => [normalizeScorePathologySubcomponent(key), num(value)])
            .filter(([key, value]) => key && Number.isFinite(value) && value >= 0)
        )
      : {}
  const subcomponentPolicies =
    cfg?.subcomponentPolicies && typeof cfg.subcomponentPolicies === "object"
      ? Object.fromEntries(
          Object.entries(cfg.subcomponentPolicies)
            .map(([key, value]) => {
              const normalizedKey = normalizeScorePathologySubcomponent(key)
              const policy = value && typeof value === "object" && !Array.isArray(value) ? value : null
              if (!normalizedKey || !policy) return null
              return [
                normalizedKey,
                {
                  maxPenaltyCap: num(policy?.maxPenaltyCap),
                  requireMinEraCoverageRatio: num(policy?.requireMinEraCoverageRatio),
                  requireMinEraSupportCount: num(policy?.requireMinEraSupportCount),
                  requireMaxEraSupportShortfall: num(policy?.requireMaxEraSupportShortfall),
                  requireMaxSingleEraShareExcess: num(policy?.requireMaxSingleEraShareExcess),
                  requireMinFillProb: num(policy?.requireMinFillProb),
                  allowedSecondarySubcomponents: Array.isArray(policy?.allowedSecondarySubcomponents)
                    ? policy.allowedSecondarySubcomponents
                        .map((item) => normalizeScorePathologySubcomponent(item))
                        .filter(Boolean)
                    : []
                }
              ]
            })
            .filter(Boolean)
        )
      : {}
  const eraSupportReasonPolicies =
    cfg?.eraSupportReasonPolicies && typeof cfg.eraSupportReasonPolicies === "object"
      ? Object.fromEntries(
          Object.entries(cfg.eraSupportReasonPolicies)
            .map(([key, value]) => {
              const normalizedKey = String(key ?? "").trim().toUpperCase()
              const policy = value && typeof value === "object" && !Array.isArray(value) ? value : null
              if (!normalizedKey || !policy) return null
              return [normalizedKey, { ...policy }]
            })
            .filter(Boolean)
        )
      : {}
  const decision = {
    enabled: cfg?.enabled === true,
    mode,
    gateReason,
    candidateSymbol: String(top1?.symbol ?? "").trim() || null,
    candidateRank: top1 ? 1 : null,
    primaryComponent: scoreOriginTrace?.scorePathologyPrimaryComponent ?? null,
    secondaryComponent: scoreOriginTrace?.scorePathologySecondaryComponent ?? null,
    primarySubcomponent: scoreOriginTrace?.scorePathologyPrimarySubcomponent ?? null,
    secondarySubcomponent: scoreOriginTrace?.scorePathologySecondarySubcomponent ?? null,
    compositeType: scoreOriginTrace?.scorePathologyCompositeType ?? null,
    allowedPrimaryComponents,
    allowedPrimarySubcomponents,
    capsByComponent,
    capsBySubcomponent,
    subcomponentPolicies,
    eraSupportReasonPolicies,
    appliedSubcomponentPolicy: null,
    appliedEraSupportReasonPolicy: null,
    eligible: false,
    rejectionReasons: [],
    rawSimilarityScore: num(top1?.rawSimilarityScore ?? top1?.baseScore),
    localStageScore: num(top1?.localStageScore),
    expectedNetRet3d: num(top1?.expectedNetRet3d),
    fillProb: num(top1?.calibrated?.pFillCalibrated ?? top1?.pFillCalibrated),
    baseScore: num(top1?.baseScore),
    eraSupportCount: num(scoreOriginTrace?.clusterTemporalEraSupportCount),
    eraCoverageRatio: num(scoreOriginTrace?.clusterTemporalEraCoverageRatio),
    targetEraCoverageRatio: num(scoreOriginTrace?.targetEraCoverageRatio),
    minEraSupportCount: num(scoreOriginTrace?.minEraSupportCount),
    eraSupportShortfall: num(scoreOriginTrace?.eraSupportShortfall),
    singleEraShareExcess: num(scoreOriginTrace?.singleEraShareExcess),
    effectiveEraCount: num(scoreOriginTrace?.clusterTemporalEffectiveEraCount),
    normalizedEraEntropy: num(scoreOriginTrace?.clusterTemporalNormalizedEraEntropy),
    singleEraEvidenceEffectiveEraCountRatio: num(
      scoreOriginTrace?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio,
    ),
    singleEraEvidenceEntropyRatio: num(
      scoreOriginTrace?.clusterTemporalSingleEraEvidenceEntropyRatio,
    ),
    eraSupportPenaltyReason: scoreOriginTrace?.eraSupportPenaltyReason ?? null,
    recalibratedFinalScore: null,
    recalibratedFinalScoreDelta: null,
    recalibratedFinalScoreShortfall: null,
    recalibratedScoreMargin: null,
    recalibratedScoreMarginShortfall: null,
    cappedPenaltiesByComponent: {},
    cappedPenaltiesBySubcomponent: {},
    wouldTradeDay: false,
    wouldHitDay: false,
    wouldBeatBlockedTop1Day: false,
    hardPassApplied: false
  }
  if (cfg?.enabled !== true || mode === "off") {
    decision.rejectionReasons.push("DISABLED")
    return decision
  }
  if (!top1) {
    decision.rejectionReasons.push("NO_TOP1")
    return decision
  }
  if (!["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"].includes(gateReason)) {
    decision.rejectionReasons.push("GATE_REASON_NOT_SUPPORTED")
    return decision
  }
  if (
    allowedPrimaryComponents.length > 0 &&
    !allowedPrimaryComponents.includes(decision.primaryComponent)
  ) {
    decision.rejectionReasons.push("PRIMARY_COMPONENT_NOT_ALLOWED")
  }
  if (
    allowedPrimarySubcomponents.length > 0 &&
    !allowedPrimarySubcomponents.includes(decision.primarySubcomponent)
  ) {
    decision.rejectionReasons.push("PRIMARY_SUBCOMPONENT_NOT_ALLOWED")
  }
  const appliedSubcomponentPolicy =
    decision.primarySubcomponent && subcomponentPolicies[decision.primarySubcomponent]
      ? subcomponentPolicies[decision.primarySubcomponent]
      : null
  decision.appliedSubcomponentPolicy = appliedSubcomponentPolicy
  const appliedEraSupportReasonPolicy =
    decision.eraSupportPenaltyReason && eraSupportReasonPolicies[decision.eraSupportPenaltyReason]
      ? eraSupportReasonPolicies[decision.eraSupportPenaltyReason]
      : null
  decision.appliedEraSupportReasonPolicy = appliedEraSupportReasonPolicy
  if (
    Array.isArray(appliedSubcomponentPolicy?.allowedSecondarySubcomponents) &&
    appliedSubcomponentPolicy.allowedSecondarySubcomponents.length > 0 &&
    !appliedSubcomponentPolicy.allowedSecondarySubcomponents.includes(decision.secondarySubcomponent)
  ) {
    decision.rejectionReasons.push("SECONDARY_SUBCOMPONENT_NOT_ALLOWED")
  }
  if (
    Number.isFinite(Number(appliedSubcomponentPolicy?.requireMinEraCoverageRatio)) &&
    (
      !Number.isFinite(decision.eraCoverageRatio) ||
      decision.eraCoverageRatio < Number(appliedSubcomponentPolicy.requireMinEraCoverageRatio)
    )
  ) {
    decision.rejectionReasons.push("ERA_COVERAGE_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedSubcomponentPolicy?.requireMinEraSupportCount)) &&
    (
      !Number.isFinite(decision.eraSupportCount) ||
      decision.eraSupportCount < Number(appliedSubcomponentPolicy.requireMinEraSupportCount)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_COUNT_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedSubcomponentPolicy?.requireMaxEraSupportShortfall)) &&
    (
      !Number.isFinite(decision.eraSupportShortfall) ||
      decision.eraSupportShortfall > Number(appliedSubcomponentPolicy.requireMaxEraSupportShortfall)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_SHORTFALL_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(appliedSubcomponentPolicy?.requireMaxSingleEraShareExcess)) &&
    (
      !Number.isFinite(decision.singleEraShareExcess) ||
      decision.singleEraShareExcess > Number(appliedSubcomponentPolicy.requireMaxSingleEraShareExcess)
    )
  ) {
    decision.rejectionReasons.push("SINGLE_ERA_SHARE_EXCESS_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(appliedSubcomponentPolicy?.requireMinFillProb)) &&
    (
      !Number.isFinite(decision.fillProb) ||
      decision.fillProb < Number(appliedSubcomponentPolicy.requireMinFillProb)
    )
  ) {
    decision.rejectionReasons.push("SUBCOMPONENT_POLICY_FILL_PROB_TOO_LOW")
  }
  if (
    Array.isArray(appliedEraSupportReasonPolicy?.allowedCompositeTypes) &&
    appliedEraSupportReasonPolicy.allowedCompositeTypes.length > 0 &&
    !appliedEraSupportReasonPolicy.allowedCompositeTypes.includes(String(decision.compositeType ?? "").trim().toUpperCase())
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_COMPOSITE_TYPE_NOT_ALLOWED")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMinEraCoverageRatio)) &&
    (
      !Number.isFinite(decision.eraCoverageRatio) ||
      decision.eraCoverageRatio < Number(appliedEraSupportReasonPolicy.requireMinEraCoverageRatio)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_COVERAGE_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMinEffectiveEraCount)) &&
    (
      !Number.isFinite(decision.effectiveEraCount) ||
      decision.effectiveEraCount < Number(appliedEraSupportReasonPolicy.requireMinEffectiveEraCount)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_EFFECTIVE_ERA_COUNT_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMinEffectiveEraCountRatio)) &&
    (
      !Number.isFinite(decision.singleEraEvidenceEffectiveEraCountRatio) ||
      decision.singleEraEvidenceEffectiveEraCountRatio <
        Number(appliedEraSupportReasonPolicy.requireMinEffectiveEraCountRatio)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_EFFECTIVE_ERA_RATIO_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMinEntropyRatio)) &&
    (
      !Number.isFinite(decision.singleEraEvidenceEntropyRatio) ||
      decision.singleEraEvidenceEntropyRatio <
        Number(appliedEraSupportReasonPolicy.requireMinEntropyRatio)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_ENTROPY_RATIO_TOO_LOW")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMaxSingleEraShareExcess)) &&
    (
      !Number.isFinite(decision.singleEraShareExcess) ||
      decision.singleEraShareExcess > Number(appliedEraSupportReasonPolicy.requireMaxSingleEraShareExcess)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_SINGLE_ERA_EXCESS_TOO_HIGH")
  }
  if (
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.requireMinFillProb)) &&
    (
      !Number.isFinite(decision.fillProb) ||
      decision.fillProb < Number(appliedEraSupportReasonPolicy.requireMinFillProb)
    )
  ) {
    decision.rejectionReasons.push("ERA_SUPPORT_REASON_FILL_PROB_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.baseScoreFloor)) &&
    (
      !Number.isFinite(decision.baseScore) ||
      decision.baseScore < Number(cfg.baseScoreFloor)
    )
  ) {
    decision.rejectionReasons.push("BASE_SCORE_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minRawSimilarity)) &&
    (
      !Number.isFinite(decision.rawSimilarityScore) ||
      decision.rawSimilarityScore < Number(cfg.minRawSimilarity)
    )
  ) {
    decision.rejectionReasons.push("RAW_SIMILARITY_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minLocalStageScore)) &&
    (
      !Number.isFinite(decision.localStageScore) ||
      decision.localStageScore < Number(cfg.minLocalStageScore)
    )
  ) {
    decision.rejectionReasons.push("LOCAL_STAGE_SCORE_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minExpectedNetRet3d)) &&
    (
      !Number.isFinite(decision.expectedNetRet3d) ||
      decision.expectedNetRet3d < Number(cfg.minExpectedNetRet3d)
    )
  ) {
    decision.rejectionReasons.push("EXPECTED_NET_RET_TOO_LOW")
  }
  if (
    Number.isFinite(Number(cfg?.minFillProb)) &&
    (
      !Number.isFinite(decision.fillProb) ||
      decision.fillProb < Number(cfg.minFillProb)
    )
  ) {
    decision.rejectionReasons.push("FILL_PROB_TOO_LOW")
  }
  const effectiveCapsBySubcomponent = {
    ...capsBySubcomponent
  }
  if (
    decision.primarySubcomponent &&
    Number.isFinite(Number(appliedSubcomponentPolicy?.maxPenaltyCap)) &&
    Number(appliedSubcomponentPolicy.maxPenaltyCap) >= 0
  ) {
    effectiveCapsBySubcomponent[decision.primarySubcomponent] = Number(appliedSubcomponentPolicy.maxPenaltyCap)
  }
  if (
    decision.primarySubcomponent &&
    Number.isFinite(Number(appliedEraSupportReasonPolicy?.maxPenaltyCap)) &&
    Number(appliedEraSupportReasonPolicy.maxPenaltyCap) >= 0
  ) {
    effectiveCapsBySubcomponent[decision.primarySubcomponent] = Number(appliedEraSupportReasonPolicy.maxPenaltyCap)
  }
  decision.capsBySubcomponent = effectiveCapsBySubcomponent
  const recalibratedTrace = buildScoreRecalibratedTrace({
    trace: scoreOriginTrace,
    capsByComponent,
    capsBySubcomponent: effectiveCapsBySubcomponent
  })
  decision.cappedPenaltiesByComponent = recalibratedTrace?.cappedPenaltiesByComponent ?? {}
  decision.cappedPenaltiesBySubcomponent = recalibratedTrace?.cappedPenaltiesBySubcomponent ?? {}
  decision.recalibratedFinalScore = num(recalibratedTrace?.finalScorePostExecutionPrior)
  decision.recalibratedFinalScoreDelta =
    Number.isFinite(Number(decision.recalibratedFinalScore)) &&
    Number.isFinite(Number(scoreOriginTrace?.finalScorePostExecutionPrior))
      ? Number(decision.recalibratedFinalScore) - Number(scoreOriginTrace.finalScorePostExecutionPrior)
      : null
  decision.recalibratedFinalScoreShortfall =
    Number.isFinite(Number(scoreOriginTrace?.minFinalScore)) &&
    Number.isFinite(Number(decision.recalibratedFinalScore))
      ? Math.max(0, Number(scoreOriginTrace.minFinalScore) - Number(decision.recalibratedFinalScore))
      : null
  decision.recalibratedScoreMargin =
    Number.isFinite(Number(scoreOriginTrace?.top1ScoreMargin)) &&
    Number.isFinite(Number(decision.recalibratedFinalScoreDelta))
      ? Number(scoreOriginTrace.top1ScoreMargin) + Number(decision.recalibratedFinalScoreDelta)
      : num(scoreOriginTrace?.top1ScoreMargin)
  decision.recalibratedScoreMarginShortfall =
    Number.isFinite(Number(scoreOriginTrace?.minScoreMargin)) &&
    Number.isFinite(Number(decision.recalibratedScoreMargin))
      ? Math.max(0, Number(scoreOriginTrace.minScoreMargin) - Number(decision.recalibratedScoreMargin))
      : null
  if (
    !Number.isFinite(Number(decision.recalibratedFinalScoreDelta)) ||
    Number(decision.recalibratedFinalScoreDelta) <= 0
  ) {
    decision.rejectionReasons.push("NO_COUNTERFACTUAL_GAIN")
  }
  if (
    Number.isFinite(Number(scoreOriginTrace?.minFinalScore)) &&
    (
      !Number.isFinite(Number(decision.recalibratedFinalScore)) ||
      Number(decision.recalibratedFinalScore) < Number(scoreOriginTrace.minFinalScore)
    )
  ) {
    decision.rejectionReasons.push("RECALIBRATED_SCORE_STILL_LOW")
  }
  if (
    Number.isFinite(Number(scoreOriginTrace?.minScoreMargin)) &&
    (
      !Number.isFinite(Number(decision.recalibratedScoreMargin)) ||
      Number(decision.recalibratedScoreMargin) < Number(scoreOriginTrace.minScoreMargin)
    )
  ) {
    decision.rejectionReasons.push("RECALIBRATED_MARGIN_STILL_LOW")
  }
  if (
    Number.isFinite(Number(policyThresholds?.tauRank)) &&
    (
      !Number.isFinite(Number(decision.recalibratedFinalScore)) ||
      Number(decision.recalibratedFinalScore) < Number(policyThresholds.tauRank)
    )
  ) {
    decision.rejectionReasons.push("RECALIBRATED_TAU_RANK_STILL_LOW")
  }
  decision.eligible = decision.rejectionReasons.length < 1
  decision.wouldTradeDay = decision.eligible
  decision.wouldHitDay = decision.eligible && top1?.successInWindow === true
  return decision
}

export const resolveRegimeTag = ({ featureVec, globalFeatureVec }) => {
  const vol150 = num(globalFeatureVec?.["global.volatility150"])
  const vol40 = num(globalFeatureVec?.["global.volatility40"])
  const stdev40 = num(featureVec?.["shape.retStdev40"])
  const liquidityRatio =
    num(globalFeatureVec?.["global.valueRatio20Over150"]) ??
    num(featureVec?.["volume.valueRatio20"]) ??
    null
  const volProxy = vol150 ?? vol40 ?? stdev40 ?? null
  const volBucket = Number.isFinite(volProxy)
    ? volProxy >= 0.05
      ? "VOL_HIGH"
      : volProxy >= 0.03
        ? "VOL_MID"
        : "VOL_LOW"
    : "VOL_UNKNOWN"
  const liqBucket = Number.isFinite(liquidityRatio)
    ? liquidityRatio >= 1.2
      ? "LIQ_HIGH"
      : liquidityRatio >= 0.8
        ? "LIQ_MID"
        : "LIQ_LOW"
    : "LIQ_UNKNOWN"
  return {
    tag: `${volBucket}_${liqBucket}`,
    volatilityProxy: Number.isFinite(volProxy) ? volProxy : null,
    liquidityProxy: Number.isFinite(liquidityRatio) ? liquidityRatio : null
  }
}

export const resolveRouteBucket = ({ regimeTag, cfg }) => {
  const safeCfg = cfg ?? {}
  const tag = String(regimeTag ?? "").trim() || "VOL_UNKNOWN_LIQ_UNKNOWN"
  const mapped = safeCfg?.bucketMap?.[tag]
  if (mapped) return mapped
  if (String(safeCfg?.routingMode ?? "vol3").trim().toLowerCase() === "none") {
    return String(safeCfg?.defaultBucket ?? "__DEFAULT__")
  }
  if (tag.startsWith("VOL_LOW_")) return "LOWVOL"
  if (tag.startsWith("VOL_MID_")) return "MIDVOL"
  if (tag.startsWith("VOL_HIGH_")) return "HIGHVOL"
  return String(safeCfg?.defaultBucket ?? "__DEFAULT__")
}

export const applyInversionAdjust = ({ top, gateCfg }) => {
  const rows = Array.isArray(top) ? top.slice() : []
  if (rows.length < 2) {
    return {
      rows,
      applied: false,
      reason: "NO_SECOND",
      scoreMargin: null
    }
  }
  const cfg = gateCfg?.inversionAdjust ?? {}
  if (cfg?.enabled !== true) {
    return {
      rows,
      applied: false,
      reason: "DISABLED",
      scoreMargin: null
    }
  }

  const first = rows[0]
  const second = rows[1]
  const firstScore = Number(first?.finalScore ?? first?.score ?? 0)
  const secondScore = Number(second?.finalScore ?? second?.score ?? 0)
  const scoreMargin = firstScore - secondScore
  const maxSwapMargin = Math.max(0, Number(cfg?.maxSwapMargin ?? 0.02) || 0.02)
  if (!Number.isFinite(scoreMargin) || scoreMargin > maxSwapMargin) {
    return {
      rows,
      applied: false,
      reason: "MARGIN_TOO_WIDE",
      scoreMargin
    }
  }

  const qualityWeight = Number(cfg?.qualityWeight ?? 0.04)
  const secondBoost = Number(cfg?.secondBoost ?? 0)
  const firstProxy =
    Number(first?.expectedNetRet3d ?? 0) + qualityWeight * Number(first?.qualityScore ?? 0)
  const secondProxy =
    Number(second?.expectedNetRet3d ?? 0) + qualityWeight * Number(second?.qualityScore ?? 0) + secondBoost
  if (secondProxy <= firstProxy) {
    return {
      rows,
      applied: false,
      reason: "PROXY_NOT_BETTER",
      scoreMargin
    }
  }

  rows[0] = second
  rows[1] = first
  return {
    rows,
    applied: true,
    reason: "PROXY_SWAP",
    scoreMargin
  }
}

export const annotateRankRelativeFeatures = (rows) => {
  const list = Array.isArray(rows) ? rows : []
  if (list.length < 1) return
  const scores = list.map((row) => Number(row?.finalScore ?? row?.score ?? 0))
  const scoreStats = calcMeanStd(scores)
  const margins = list.map((row, idx) => {
    const curr = Number(row?.finalScore ?? row?.score ?? 0)
    const next = list[idx + 1]
    if (!next) return 0
    return curr - Number(next?.finalScore ?? next?.score ?? 0)
  })
  const marginStats = calcMeanStd(margins)
  const denom = Math.max(1, list.length - 1)
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i]
    if (!row) continue
    const score = scores[i]
    const margin = margins[i]
    row.rankIndex = i
    row.rankSize = list.length
    row.rankPct = list.length > 1 ? i / denom : 0
    row.finalScoreZWithinDay =
      scoreStats.std > 1e-12 ? (score - scoreStats.mean) / scoreStats.std : 0
    row.marginZWithinDay =
      marginStats.std > 1e-12 ? (margin - marginStats.mean) / marginStats.std : 0
    row.scoreMargin = Number.isFinite(margin) ? margin : null
  }
}

export const resolvePickScoreMargin = ({ top, pick, baseMargin = null }) => {
  const rows = Array.isArray(top) ? top : []
  if (!pick || rows.length < 1) return Number.isFinite(Number(baseMargin)) ? Number(baseMargin) : null
  const explicitMargin = Number(pick?.gateScoreMargin ?? pick?.rawScoreMargin ?? pick?.scoreMargin)
  if (Number.isFinite(explicitMargin)) return explicitMargin
  const idx = rows.findIndex((row) => row === pick)
  if (idx < 0) return Number.isFinite(Number(baseMargin)) ? Number(baseMargin) : null
  const score = Number(pick?.finalScore ?? pick?.score ?? 0)
  const next = rows[idx + 1] ?? null
  if (!next) return Number.isFinite(Number(baseMargin)) ? Number(baseMargin) : Number.POSITIVE_INFINITY
  const nextScore = Number(next?.finalScore ?? next?.score ?? 0)
  const margin = score - nextScore
  return Number.isFinite(margin) ? margin : (Number.isFinite(Number(baseMargin)) ? Number(baseMargin) : null)
}

const buildRegimeCalibrationMap = (raw) => {
  const out = new Map()
  const src = raw && typeof raw === "object" ? raw : {}
  for (const [tag, row] of Object.entries(src)) {
    const key = String(tag ?? "").trim()
    if (!key) continue
    const count = Math.max(0, Number(row?.count ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.hitCount ?? 0) || 0)
    out.set(key, { count, hitCount })
  }
  return out
}

const resolvePolicyContractThresholds = (policyContract) => {
  const raw = policyContract && typeof policyContract === "object" ? policyContract : {}
  const tauRankRaw = Number(raw?.tauRank)
  const tauExecRaw = Number(raw?.tauExec)
  const tauFpRaw = Number(raw?.tauFp)
  return {
    tauRank: Number.isFinite(tauRankRaw) ? tauRankRaw : null,
    tauExec: Number.isFinite(tauExecRaw) ? tauExecRaw : null,
    tauFp: Number.isFinite(tauFpRaw) ? tauFpRaw : null
  }
}

const resolveAgreementRerankConfig = (agreementGateCfg) => {
  const raw = agreementGateCfg?.rerank ?? {}
  return {
    enabled: raw?.enabled === true,
    promoteTradeOnly: raw?.promoteTradeOnly !== false,
    candidatePool: Math.max(2, Math.floor(Number(raw?.candidatePool ?? 3) || 3)),
    maxSwapMargin: Math.max(0, Number(raw?.maxSwapMargin ?? 0.01) || 0.01),
    minUtilityGain: Number(raw?.minUtilityGain ?? 0.015) || 0,
    finalScoreWeight: Number(raw?.finalScoreWeight ?? 0.1) || 0,
    agreementScoreWeight: Number(raw?.agreementScoreWeight ?? 0.7) || 0,
    consensusRateWeight: Number(raw?.consensusRateWeight ?? 0.28) || 0,
    stabilityRateWeight: Number(raw?.stabilityRateWeight ?? 0.18) || 0,
    tradeDecisionBonus: Number(raw?.tradeDecisionBonus ?? 0.08) || 0,
    consensusLowPenaltyWeight: Math.max(0, Number(raw?.consensusLowPenaltyWeight ?? 0.24) || 0),
    stabilityLowPenaltyWeight: Math.max(0, Number(raw?.stabilityLowPenaltyWeight ?? 0.08) || 0),
    scoreLowPenaltyWeight: Math.max(0, Number(raw?.scoreLowPenaltyWeight ?? 0.06) || 0)
  }
}

const getAgreementReasonPenalty = ({ reason, cfg }) => {
  const key = String(reason ?? "").trim().toUpperCase()
  if (key === "AGREEMENT_CONSENSUS_LOW") return Number(cfg?.consensusLowPenaltyWeight ?? 0) || 0
  if (key === "AGREEMENT_STABILITY_LOW") return Number(cfg?.stabilityLowPenaltyWeight ?? 0) || 0
  if (key === "AGREEMENT_SCORE_LOW") return Number(cfg?.scoreLowPenaltyWeight ?? 0) || 0
  return 0
}

const computeAgreementRerankUtility = ({ row, evaluation, cfg }) => {
  const finalScore = Number(row?.finalScore ?? row?.score ?? 0) || 0
  const agreementScore = Number(evaluation?.agreementScore ?? 0) || 0
  const consensusRate = Number(evaluation?.consensusRate ?? 0) || 0
  const stabilityRate = Number(evaluation?.stabilityRate ?? 0) || 0
  const tradeDecisionBonus =
    String(evaluation?.decision ?? "").trim().toUpperCase() === "TRADE"
      ? Number(cfg?.tradeDecisionBonus ?? 0) || 0
      : 0
  const reasonPenalty = getAgreementReasonPenalty({
    reason: evaluation?.reason,
    cfg
  })
  return (
    Number(cfg?.finalScoreWeight ?? 0) * finalScore +
    Number(cfg?.agreementScoreWeight ?? 0) * agreementScore +
    Number(cfg?.consensusRateWeight ?? 0) * consensusRate +
    Number(cfg?.stabilityRateWeight ?? 0) * stabilityRate +
    tradeDecisionBonus -
    reasonPenalty
  )
}

const annotateAgreementCandidate = ({ row, evaluation, utility }) => {
  if (!row || !evaluation) return
  row.agreementScore = Number.isFinite(Number(evaluation?.agreementScore))
    ? Number(evaluation.agreementScore)
    : null
  row.agreementDecision = evaluation?.decision ?? null
  row.agreementReason = evaluation?.reason ?? null
  row.agreementChecks = evaluation?.checks ?? {}
  row.agreementConsensusRate = Number.isFinite(Number(evaluation?.consensusRate))
    ? Number(evaluation.consensusRate)
    : null
  row.agreementStabilityRate = Number.isFinite(Number(evaluation?.stabilityRate))
    ? Number(evaluation.stabilityRate)
    : null
  row.agreementConsensusCount = Number.isFinite(Number(evaluation?.consensusCount))
    ? Number(evaluation.consensusCount)
    : null
  row.agreementCandidateUtility = Number.isFinite(Number(utility))
    ? Number(utility)
    : null
}

const applyAgreementDecisionToRow = ({ row, agreementDecision }) => {
  if (!row || !agreementDecision) return
  row.agreementScore = Number.isFinite(Number(agreementDecision?.agreementScore))
    ? Number(agreementDecision.agreementScore)
    : null
  row.agreementDecision = agreementDecision?.decision ?? "TRADE"
  row.agreementReason = agreementDecision?.reason ?? null
  row.agreementChecks = agreementDecision?.checks ?? {}
  row.agreementConsensusRate = Number.isFinite(Number(agreementDecision?.consensusRate))
    ? Number(agreementDecision.consensusRate)
    : null
  row.agreementStabilityRate = Number.isFinite(Number(agreementDecision?.stabilityRate))
    ? Number(agreementDecision.stabilityRate)
    : null
  row.agreementConsensusCount = Number.isFinite(Number(agreementDecision?.consensusCount))
    ? Number(agreementDecision.consensusCount)
    : null
}

const rerankTopByAgreement = ({
  top,
  decisionGateCfg,
  agreementModel,
  agreementModelCfg
}) => {
  const rows = Array.isArray(top) ? top.slice() : []
  const cfg = resolveAgreementRerankConfig(decisionGateCfg?.agreementGate)
  if (cfg.enabled !== true || rows.length < 2 || decisionGateCfg?.agreementGate?.enabled !== true) {
    return {
      top: rows,
      applied: false,
      reason: "DISABLED",
      fromRank: 1,
      toRank: 1
    }
  }

  const poolSize = Math.min(rows.length, Math.max(2, Number(cfg?.candidatePool ?? 3) || 3))
  const pool = rows.slice(0, poolSize)
  const first = pool[0]
  const firstScore = Number(first?.finalScore ?? first?.score ?? 0)
  const evaluations = new Map()
  const evaluateCandidate = (row) => {
    if (!row) return null
    if (evaluations.has(row)) return evaluations.get(row)
    const evaluation = evaluateAgreementGate({
      rows,
      selectedRow: row,
      cfg: decisionGateCfg?.agreementGate,
      model: agreementModel,
      modelCfg: agreementModelCfg
    })
    const utility = computeAgreementRerankUtility({
      row,
      evaluation,
      cfg
    })
    const out = { evaluation, utility }
    evaluations.set(row, out)
    annotateAgreementCandidate({
      row,
      evaluation,
      utility
    })
    return out
  }

  const firstEval = evaluateCandidate(first)
  let bestIdx = 0
  let bestEval = firstEval
  const firstDecision = String(firstEval?.evaluation?.decision ?? "").trim().toUpperCase()
  for (let i = 1; i < pool.length; i += 1) {
    const row = pool[i]
    const rowScore = Number(row?.finalScore ?? row?.score ?? 0)
    const margin = firstScore - rowScore
    if (!Number.isFinite(margin) || margin > Number(cfg?.maxSwapMargin ?? 0)) continue
    const candidateEval = evaluateCandidate(row)
    const nextDecision = String(candidateEval?.evaluation?.decision ?? "").trim().toUpperCase()
    if (cfg?.promoteTradeOnly !== false && firstDecision === "TRADE") continue
    const currentDecision = String(bestEval?.evaluation?.decision ?? "").trim().toUpperCase()
    if (currentDecision !== "TRADE" && nextDecision === "TRADE") {
      bestIdx = i
      bestEval = candidateEval
      continue
    }
    if (cfg?.promoteTradeOnly !== false) {
      if (currentDecision === "TRADE" && nextDecision === "TRADE") {
        if (
          Number(candidateEval?.utility ?? Number.NEGATIVE_INFINITY) >
          Number(bestEval?.utility ?? Number.NEGATIVE_INFINITY)
        ) {
          bestIdx = i
          bestEval = candidateEval
        }
      }
      continue
    }
    if (Number(candidateEval?.utility ?? Number.NEGATIVE_INFINITY) > Number(bestEval?.utility ?? Number.NEGATIVE_INFINITY)) {
      bestIdx = i
      bestEval = candidateEval
    }
  }

  if (bestIdx <= 0) {
    return {
      top: rows,
      applied: false,
      reason: "TOP1_STABLE",
      fromRank: 1,
      toRank: 1,
      poolSize,
      firstUtility: Number(firstEval?.utility ?? 0) || 0,
      selectedUtility: Number(firstEval?.utility ?? 0) || 0,
      utilityGain: 0
    }
  }

  const currentDecision = String(firstEval?.evaluation?.decision ?? "").trim().toUpperCase()
  const nextDecision = String(bestEval?.evaluation?.decision ?? "").trim().toUpperCase()
  const utilityGain = Number(bestEval?.utility ?? 0) - Number(firstEval?.utility ?? 0)
  const promoteTradeDecision = currentDecision !== "TRADE" && nextDecision === "TRADE"
  if (cfg?.promoteTradeOnly !== false && !promoteTradeDecision) {
    return {
      top: rows,
      applied: false,
      reason: "PROMOTE_TRADE_ONLY",
      fromRank: 1,
      toRank: 1,
      poolSize,
      firstUtility: Number(firstEval?.utility ?? 0) || 0,
      selectedUtility: Number(bestEval?.utility ?? 0) || 0,
      utilityGain
    }
  }
  if (!promoteTradeDecision && (!Number.isFinite(utilityGain) || utilityGain < Number(cfg?.minUtilityGain ?? 0))) {
    return {
      top: rows,
      applied: false,
      reason: "UTILITY_GAIN_LOW",
      fromRank: 1,
      toRank: 1,
      poolSize,
      firstUtility: Number(firstEval?.utility ?? 0) || 0,
      selectedUtility: Number(bestEval?.utility ?? 0) || 0,
      utilityGain
    }
  }

  const selected = pool[bestIdx]
  const reordered = [selected]
    .concat(pool.filter((_, idx) => idx !== bestIdx))
    .concat(rows.slice(poolSize))
  return {
    top: reordered,
    applied: true,
    reason: promoteTradeDecision ? "PROMOTE_TRADE_DECISION" : "UTILITY_SWAP",
    fromRank: 1,
    toRank: bestIdx + 1,
    poolSize,
    firstUtility: Number(firstEval?.utility ?? 0) || 0,
    selectedUtility: Number(bestEval?.utility ?? 0) || 0,
    utilityGain
  }
}

const resolveAgreementFallbackConfig = (agreementGateCfg) => {
  const raw = agreementGateCfg?.fallback ?? {}
  const allowedReasons = Array.isArray(raw?.allowedReasons)
    ? raw.allowedReasons
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean)
    : ["AGREEMENT_CONSENSUS_LOW"]
  return {
    enabled: raw?.enabled === true,
    candidatePool: Math.max(
      2,
      Math.floor(Number(raw?.candidatePool ?? agreementGateCfg?.candidatePool ?? 10) || 10),
    ),
    allowedReasons
  }
}

const resolveAgreementShadowRejectPrecisionGuardConfig = (agreementGateCfg) => {
  const raw = agreementGateCfg?.shadowRejectPrecisionGuard ?? {}
  const allowedReasons = Array.isArray(raw?.allowedReasons)
    ? raw.allowedReasons
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean)
    : ["AGREEMENT_CONSENSUS_LOW"]
  const allowedSelectionModes = Array.isArray(raw?.allowedSelectionModes)
    ? raw.allowedSelectionModes
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean)
    : ["EXPLOIT"]
  const blockedFallbackReasons = Array.isArray(raw?.blockedFallbackReasons)
    ? raw.blockedFallbackReasons
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean)
    : ["NO_PASSING_ALT"]
  return {
    enabled: raw?.enabled === true,
    requireNoFallback: raw?.requireNoFallback !== false,
    allowedReasons,
    allowedSelectionModes,
    blockedFallbackReasons
  }
}

const evaluateAgreementShadowRejectPrecisionGuard = ({
  agreementDecision,
  agreementFallback,
  selectionPolicy,
  agreementEnforcementMode,
  gateCfg
}) => {
  const cfg = resolveAgreementShadowRejectPrecisionGuardConfig(gateCfg?.agreementGate)
  const normalizedAgreementReason = String(agreementDecision?.reason ?? "").trim().toUpperCase()
  const normalizedSelectionMode = String(selectionPolicy?.mode ?? "").trim().toUpperCase()
  const normalizedFallbackReason = String(agreementFallback?.reason ?? "").trim().toUpperCase()
  if (cfg.enabled !== true) {
    return {
      blocked: false,
      reason: "DISABLED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (String(agreementEnforcementMode ?? "").trim().toLowerCase() !== "shadow") {
    return {
      blocked: false,
      reason: "NOT_SHADOW",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (String(agreementDecision?.decision ?? "").trim().toUpperCase() === "TRADE") {
    return {
      blocked: false,
      reason: "NOT_REJECTED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (cfg.allowedReasons.length > 0 && !cfg.allowedReasons.includes(normalizedAgreementReason)) {
    return {
      blocked: false,
      reason: "AGREEMENT_REASON_NOT_ALLOWED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (
    cfg.allowedSelectionModes.length > 0 &&
    !cfg.allowedSelectionModes.includes(normalizedSelectionMode)
  ) {
    return {
      blocked: false,
      reason: "SELECTION_MODE_NOT_ALLOWED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (cfg.requireNoFallback && agreementFallback?.applied === true) {
    return {
      blocked: false,
      reason: "FALLBACK_ALREADY_APPLIED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null
    }
  }
  if (
    cfg.blockedFallbackReasons.length > 0 &&
    !cfg.blockedFallbackReasons.includes(normalizedFallbackReason)
  ) {
    return {
      blocked: false,
      reason: "FALLBACK_REASON_NOT_ALLOWED",
      agreementReason: normalizedAgreementReason || null,
      selectionMode: normalizedSelectionMode || null,
      fallbackReason: normalizedFallbackReason || null
    }
  }
  return {
    blocked: true,
    reason: "SHADOW_REJECT_PRECISION_BLOCK",
    agreementReason: normalizedAgreementReason || null,
    selectionMode: normalizedSelectionMode || null,
    fallbackReason: normalizedFallbackReason || null
  }
}

const evaluateAgreementFallbackSelection = ({
  rows,
  blockedRow,
  blockedReason,
  gateCfg,
  policyContract,
  agreementModel,
  agreementModelCfg
}) => {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const cfg = resolveAgreementFallbackConfig(gateCfg?.agreementGate)
  const normalizedBlockedReason = String(blockedReason ?? "").trim().toUpperCase()
  if (cfg.enabled !== true || safeRows.length < 2 || !blockedRow) {
    return {
      applied: false,
      reason: "DISABLED",
      blockedReason: normalizedBlockedReason || null
    }
  }
  if (cfg.allowedReasons.length > 0 && !cfg.allowedReasons.includes(normalizedBlockedReason)) {
    return {
      applied: false,
      reason: "BLOCK_REASON_NOT_ALLOWED",
      blockedReason: normalizedBlockedReason || null,
      allowedReasons: cfg.allowedReasons
    }
  }

  const pool = safeRows
    .filter((row) => row !== blockedRow)
    .slice(0, Math.max(1, Number(cfg?.candidatePool ?? 10) || 10))
  const diagnostics = []
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[i]
    if (!candidate) continue
    const originalRank = resolveRowRank1Based(safeRows, candidate)
    const agreementRows = [candidate].concat(safeRows.filter((row) => row !== candidate))
    const agreementEval = evaluateAgreementGate({
      rows: agreementRows,
      selectedRow: candidate,
      cfg: gateCfg?.agreementGate,
      model: agreementModel,
      modelCfg: agreementModelCfg
    })
    const reordered = [candidate].concat(pool.filter((_, idx) => idx !== i))
    const baseGate = selectPickByGate({
      top: reordered,
      gateCfg
    })
    let gateReason = String(baseGate?.gateReason ?? "UNKNOWN").trim() || "UNKNOWN"
    let pass = baseGate?.pick === candidate
    const rankerScore = num(candidate?.rankerScore ?? candidate?.finalScore ?? candidate?.score)
    const tauRank = num(policyContract?.tauRank)
    if (
      pass &&
      Number.isFinite(tauRank) &&
      (!Number.isFinite(rankerScore) || rankerScore < Number(tauRank))
    ) {
      pass = false
      gateReason = "POLICY_TAU_RANK_LOW"
    }
    const agreementDecision = String(agreementEval?.decision ?? "").trim().toUpperCase()
    const diagnostic = {
      originalRank,
      symbol: String(candidate?.symbol ?? "").trim() || null,
      pass,
      gateReason,
      scoreMargin: Number.isFinite(Number(baseGate?.scoreMargin)) ? Number(baseGate.scoreMargin) : null,
      agreementDecision: agreementEval?.decision ?? null,
      agreementReason: agreementEval?.reason ?? null,
      finalScore: num(candidate?.finalScore ?? candidate?.score),
      successInWindow: candidate?.successInWindow === true
    }
    diagnostics.push(diagnostic)
    if (agreementDecision !== "TRADE" || pass !== true) continue
    return {
      applied: true,
      reason: "PASSING_ALT",
      blockedReason: normalizedBlockedReason || null,
      originalRank,
      candidatePool: pool.length,
      row: candidate,
      scoreMargin: diagnostic.scoreMargin,
      agreementEval,
      diagnostics
    }
  }

  return {
    applied: false,
    reason: "NO_PASSING_ALT",
    blockedReason: normalizedBlockedReason || null,
    candidatePool: pool.length,
    diagnostics
  }
}

export const buildExecutionCalibration = ({ stepDSummary, policyState }) => {
  const stateCalibration = policyState?.executionCalibration ?? {}
  const summaryCalibration = stepDSummary?.executionGate ?? {}
  const globalCount = Math.max(
    0,
    Number(stateCalibration?.globalCount ?? summaryCalibration?.globalCalibration?.count ?? 0) || 0,
  )
  const globalHitCount = Math.max(
    0,
    Number(stateCalibration?.globalHitCount ?? summaryCalibration?.globalCalibration?.hitCount ?? 0) || 0,
  )
  const regimeStats = buildRegimeCalibrationMap(
    stateCalibration?.regimeStats ?? summaryCalibration?.regimeCalibration,
  )
  return {
    globalCount,
    globalHitCount,
    regimeStats
  }
}

export const runD1Top1Ranker = ({
  topCandidates,
  decisionGateCfg,
  calibrationCfg,
  executionCalibration,
  agreementModel = null,
  agreementModelCfg = null,
  explorationCtx = null,
  policyContract = null,
  dayTypeDecision = null
}) => {
  const inputRows = Array.isArray(topCandidates) ? topCandidates : []
  const inversionAdjusted = applyInversionAdjust({
    top: topCandidates,
    gateCfg: decisionGateCfg
  })
  const rerankInputRows = Array.isArray(inversionAdjusted?.rows)
    ? inversionAdjusted.rows
    : (Array.isArray(topCandidates) ? topCandidates : [])

  const preRerankTop1 = rerankInputRows[0] ?? null
  const preRerankTop2 = rerankInputRows[1] ?? null
  const preRerankTop1Score = Number(preRerankTop1?.finalScore ?? preRerankTop1?.score ?? 0)
  const preRerankTop2Score = Number(preRerankTop2?.finalScore ?? preRerankTop2?.score ?? 0)
  const rawTopScoreMargin = preRerankTop2
    ? preRerankTop1Score - preRerankTop2Score
    : Number.POSITIVE_INFINITY

  const refreshRankRelativeSignals = (rows, { preservePreRerank = false } = {}) => {
    annotateRankRelativeFeatures(rows)
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      if (!row) continue
      if (preservePreRerank) {
        row.preRerankScoreMargin = row.scoreMargin
      }
      row.calibrated = estimateCalibratedSignals({
        row,
        scoreMargin: row.scoreMargin,
        calibration: executionCalibration,
        cfg: calibrationCfg
      })
    }
  }

  refreshRankRelativeSignals(rerankInputRows, { preservePreRerank: true })

  const rerankDecision = rerankTopForTop1({
    top: rerankInputRows,
    gateCfg: decisionGateCfg
  })
  const topAfterPrimaryRerank = Array.isArray(rerankDecision?.top)
    ? rerankDecision.top
    : (Array.isArray(inversionAdjusted?.rows) ? inversionAdjusted.rows : (Array.isArray(topCandidates) ? topCandidates : []))
  refreshRankRelativeSignals(topAfterPrimaryRerank)
  const agreementRerankDecision = rerankTopByAgreement({
    top: topAfterPrimaryRerank,
    decisionGateCfg,
    agreementModel,
    agreementModelCfg
  })
  const topAfterAgreementRerank = Array.isArray(agreementRerankDecision?.top)
    ? agreementRerankDecision.top
    : topAfterPrimaryRerank
  refreshRankRelativeSignals(topAfterAgreementRerank)
  const microCorrectionDecision = applyTop1MicroCorrection({
    top: topAfterAgreementRerank,
    gateCfg: decisionGateCfg
  })
  const top = Array.isArray(microCorrectionDecision?.top)
    ? microCorrectionDecision.top
    : topAfterAgreementRerank
  if (top[0]) {
    top[0].top1MicroCorrected = microCorrectionDecision?.applied === true
    top[0].microCorrectionReason = microCorrectionDecision?.reason ?? null
    top[0].microCorrectionMode = microCorrectionDecision?.mode ?? null
  }

  annotateRankRelativeFeatures(top)
  for (let i = 0; i < top.length; i += 1) {
    const row = top[i]
    if (!row) continue
    row.rankerScore = Number(row?.finalScore ?? row?.score ?? 0) || 0
    row.postRerankScoreMargin = row.scoreMargin
    row.scoreMargin = row.postRerankScoreMargin
    row.calibrated = estimateCalibratedSignals({
      row,
      scoreMargin: row.scoreMargin,
      calibration: executionCalibration,
      cfg: calibrationCfg
    })
  }
  if (top[0]) {
    const finalTopMargin = Number(top[0].postRerankScoreMargin)
    top[0].preRerankRawScoreMargin = Number.isFinite(rawTopScoreMargin) ? rawTopScoreMargin : null
    top[0].rawScoreMargin =
      Number.isFinite(finalTopMargin)
        ? finalTopMargin
        : (Number.isFinite(rawTopScoreMargin) ? rawTopScoreMargin : null)
    top[0].gateScoreMargin = top[0].rawScoreMargin
    if (
      Number.isFinite(Number(top[0].postRerankScoreMargin)) &&
      Number(top[0].postRerankScoreMargin) < 0
    ) {
      top[0].negativeMarginAfterRerank = true
    }
  }
  const scoreOriginTrace = buildScoreOriginTrace({
    top1: top[0] ?? null,
    gateCfg: decisionGateCfg
  })
  const counterfactualGateSweep = buildCounterfactualGateSweep({
    rows: top,
    gateCfg: decisionGateCfg,
    policyContract,
    agreementModel,
    agreementModelCfg
  })

  const gate = selectPicksByGate({
    top,
    gateCfg: decisionGateCfg,
    explorationCtx
  })
  let picks = Array.isArray(gate?.picks) ? gate.picks : []
  const thresholds = resolvePolicyContractThresholds(policyContract)
  if (scoreOriginTrace) {
    scoreOriginTrace.policyContractTauRank = Number.isFinite(Number(thresholds?.tauRank))
      ? Number(thresholds.tauRank)
      : null
  }
  const rejectedByTauRank = []
  if (Number.isFinite(thresholds.tauRank)) {
    picks = picks.filter((row) => {
      const rankerScore = Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0)
      const pass = Number.isFinite(rankerScore) && rankerScore >= Number(thresholds.tauRank)
      row.policyContractRank = {
        tauRank: Number(thresholds.tauRank),
        rankerScore: Number.isFinite(rankerScore) ? rankerScore : null,
        pass
      }
      if (!pass) rejectedByTauRank.push(row)
      return pass
    })
  }
  let selectedRow = picks[0] ?? null
  let agreementDecision =
    selectedRow?.agreementChecks
      ? {
          decision: selectedRow?.agreementDecision ?? "TRADE",
          reason: selectedRow?.agreementReason ?? null,
          agreementScore: selectedRow?.agreementScore ?? null,
          consensusCount: selectedRow?.agreementConsensusCount ?? null,
          consensusRate: selectedRow?.agreementConsensusRate ?? null,
          stabilityRate: selectedRow?.agreementStabilityRate ?? null,
          checks: selectedRow?.agreementChecks ?? {}
        }
      : evaluateAgreementGate({
          rows: top,
          selectedRow,
          cfg: decisionGateCfg?.agreementGate,
          model: agreementModel,
          modelCfg: agreementModelCfg
        })
  if (selectedRow) applyAgreementDecisionToRow({ row: selectedRow, agreementDecision })
  let top1AgreementDecision = null
  if (top[0] && !top[0]?.agreementChecks) {
    top1AgreementDecision = evaluateAgreementGate({
      rows: top,
      selectedRow: top[0],
      cfg: decisionGateCfg?.agreementGate,
      model: agreementModel,
      modelCfg: agreementModelCfg
    })
    applyAgreementDecisionToRow({ row: top[0], agreementDecision: top1AgreementDecision })
  } else if (top[0]) {
    top1AgreementDecision = {
      decision: top[0]?.agreementDecision ?? "TRADE",
      reason: top[0]?.agreementReason ?? null,
      agreementScore: top[0]?.agreementScore ?? null,
      consensusCount: top[0]?.agreementConsensusCount ?? null,
      consensusRate: top[0]?.agreementConsensusRate ?? null,
      stabilityRate: top[0]?.agreementStabilityRate ?? null,
      checks: top[0]?.agreementChecks ?? {}
    }
  }
  const gateWithContract = {
    ...(gate && typeof gate === "object" ? gate : {}),
    dayTypeDecision:
      dayTypeDecision && typeof dayTypeDecision === "object"
        ? dayTypeDecision
        : (gate?.dayTypeDecision && typeof gate.dayTypeDecision === "object"
            ? gate.dayTypeDecision
            : null),
    policyContract: {
      tauRank: Number.isFinite(thresholds.tauRank) ? Number(thresholds.tauRank) : null,
      rejectedByTauRank: rejectedByTauRank.length,
      passedByTauRank: picks.length,
      minAgreementScore: Number.isFinite(Number(decisionGateCfg?.agreementGate?.minAgreementScore))
        ? Number(decisionGateCfg.agreementGate.minAgreementScore)
        : null
    }
  }
  if (Number.isFinite(thresholds.tauRank) && rejectedByTauRank.length > 0 && picks.length < 1) {
    gateWithContract.gateReason = "POLICY_TAU_RANK_LOW"
  }
  const agreementEnforcementMode = String(
    decisionGateCfg?.agreementGate?.enforcementMode ?? "hard_reject",
  )
    .trim()
    .toLowerCase()
  gateWithContract.agreementFallback = {
    applied: false,
    reason: "NOT_NEEDED"
  }
  gateWithContract.agreementShadowReject = {
    blocked: false,
    reason: "NOT_EVALUATED"
  }
  if (top[0] && top1AgreementDecision?.decision !== "TRADE") {
    const agreementFallbackDecision = evaluateAgreementFallbackSelection({
      rows: top,
      blockedRow: top[0],
      blockedReason: top1AgreementDecision?.reason,
      gateCfg: decisionGateCfg,
      policyContract,
      agreementModel,
      agreementModelCfg
    })
    gateWithContract.agreementFallback = agreementFallbackDecision
    if (agreementFallbackDecision?.applied === true && agreementFallbackDecision?.row) {
      selectedRow = agreementFallbackDecision.row
      agreementDecision = agreementFallbackDecision.agreementEval ?? agreementDecision
      applyAgreementDecisionToRow({
        row: selectedRow,
        agreementDecision
      })
      picks = [selectedRow]
      gateWithContract.gateReason = "AGREEMENT_FALLBACK_PASS"
      gateWithContract.selectionPolicy = {
        ...(gateWithContract?.selectionPolicy ?? {}),
        mode: "AGREEMENT_FALLBACK",
        epsilon: 0,
        applied: true,
        candidatePool: Number.isFinite(Number(agreementFallbackDecision?.candidatePool))
          ? Number(agreementFallbackDecision.candidatePool)
          : 1,
        chosenRank: Number.isFinite(Number(agreementFallbackDecision?.originalRank))
          ? Number(agreementFallbackDecision.originalRank)
          : resolveRowRank1Based(top, selectedRow),
        chosenSymbol: String(selectedRow?.symbol ?? "").trim() || null,
        agreementFallback: {
          blockedRank: 1,
          blockedSymbol: String(top[0]?.symbol ?? "").trim() || null,
          blockedReason: agreementFallbackDecision?.blockedReason ?? null,
          scoreMargin: Number.isFinite(Number(agreementFallbackDecision?.scoreMargin))
            ? Number(agreementFallbackDecision.scoreMargin)
            : null
        }
      }
      gateWithContract.policyContract = {
        ...(gateWithContract?.policyContract ?? {}),
        passedByTauRank: picks.length
      }
    }
  }
  if (picks.length > 0) {
    gateWithContract.agreementGate = {
      decision: agreementDecision?.decision ?? "TRADE",
      reason: agreementDecision?.reason ?? null,
      enforcementMode: agreementEnforcementMode === "shadow" ? "SHADOW" : "HARD_REJECT",
      agreementScore: Number.isFinite(Number(agreementDecision?.agreementScore))
        ? Number(agreementDecision.agreementScore)
        : null,
      consensusCount: Number.isFinite(Number(agreementDecision?.consensusCount))
        ? Number(agreementDecision.consensusCount)
        : null,
      consensusRate: Number.isFinite(Number(agreementDecision?.consensusRate))
        ? Number(agreementDecision.consensusRate)
        : null,
      stabilityRate: Number.isFinite(Number(agreementDecision?.stabilityRate))
        ? Number(agreementDecision.stabilityRate)
        : null,
      checks: agreementDecision?.checks ?? {}
    }
    if (agreementDecision?.decision !== "TRADE") {
      gateWithContract.gateReason = agreementDecision?.reason ?? "AGREEMENT_REJECTED"
      if (agreementEnforcementMode === "shadow") {
        const agreementShadowRejectDecision = evaluateAgreementShadowRejectPrecisionGuard({
          agreementDecision,
          agreementFallback: gateWithContract?.agreementFallback,
          selectionPolicy: gateWithContract?.selectionPolicy,
          agreementEnforcementMode,
          gateCfg: decisionGateCfg
        })
        gateWithContract.agreementShadowReject = agreementShadowRejectDecision
        if (agreementShadowRejectDecision?.blocked === true) {
          if (top[0]) top[0].agreementEnforcedAs = "SHADOW_BLOCKED"
          picks = []
          gateWithContract.rejectionCounts = {
            ...(gateWithContract?.rejectionCounts ?? {}),
            [gateWithContract.gateReason]:
              Number(gateWithContract?.rejectionCounts?.[gateWithContract.gateReason] ?? 0) + 1
          }
          gateWithContract.selectionPolicy = {
            ...(gateWithContract?.selectionPolicy ?? {}),
            mode: "AGREEMENT_SHADOW_BLOCK",
            epsilon: 0,
            applied: true,
            agreementShadowReject: {
              blocked: true,
              reason: agreementShadowRejectDecision?.reason ?? null,
              agreementReason: agreementShadowRejectDecision?.agreementReason ?? null,
              selectionMode: agreementShadowRejectDecision?.selectionMode ?? null,
              fallbackReason: agreementShadowRejectDecision?.fallbackReason ?? null
            }
          }
        } else if (top[0]) {
          top[0].agreementEnforcedAs = "SHADOW"
        }
      } else if (gateWithContract?.agreementFallback?.applied !== true) {
        picks = []
        gateWithContract.rejectionCounts = {
          ...(gateWithContract?.rejectionCounts ?? {}),
          [gateWithContract.gateReason]:
            Number(gateWithContract?.rejectionCounts?.[gateWithContract.gateReason] ?? 0) + 1
        }
      }
    }
  }
  const scoreRecoveryDecision = evaluateScoreRecoveryDecision({
    top,
    gate: gateWithContract,
    gateCfg: decisionGateCfg,
    scoreOriginTrace
  })
  gateWithContract.scoreRecovery = scoreRecoveryDecision
  const scoreRecalibrationDecision = evaluateScoreRecalibrationDecision({
    top,
    gate: gateWithContract,
    gateCfg: decisionGateCfg,
    scoreOriginTrace,
    policyThresholds: thresholds
  })
  gateWithContract.scoreRecalibration = scoreRecalibrationDecision
  if (
    picks.length < 1 &&
    scoreRecoveryDecision?.eligible === true &&
    String(scoreRecoveryDecision?.mode ?? "").trim().toLowerCase() === "hard"
  ) {
    const agreementEnforcementMode = String(
      decisionGateCfg?.agreementGate?.enforcementMode ?? "hard_reject",
    )
      .trim()
      .toLowerCase()
    const top1AgreementDecision = String(top?.[0]?.agreementDecision ?? "TRADE").trim().toUpperCase()
    if (agreementEnforcementMode === "shadow" || top1AgreementDecision === "TRADE") {
      picks = top[0] ? [top[0]] : []
      gateWithContract.gateReason = picks.length > 0 ? "SCORE_RECOVERY_HARD_PASS" : gateWithContract.gateReason
      scoreRecoveryDecision.hardPassApplied = picks.length > 0
    }
  }
  scoreRecoveryDecision.hardPassApplied = picks.length > 0 && gateWithContract.gateReason === "SCORE_RECOVERY_HARD_PASS"
  if (
    picks.length < 1 &&
    scoreRecalibrationDecision?.eligible === true &&
    String(scoreRecalibrationDecision?.mode ?? "").trim().toLowerCase() === "hard"
  ) {
    const agreementEnforcementMode = String(
      decisionGateCfg?.agreementGate?.enforcementMode ?? "hard_reject",
    )
      .trim()
      .toLowerCase()
    const top1AgreementDecision = String(top?.[0]?.agreementDecision ?? "TRADE").trim().toUpperCase()
    if (agreementEnforcementMode === "shadow" || top1AgreementDecision === "TRADE") {
      picks = top[0] ? [top[0]] : []
      gateWithContract.gateReason = picks.length > 0
        ? "SCORE_RECALIBRATION_HARD_PASS"
        : gateWithContract.gateReason
      scoreRecalibrationDecision.hardPassApplied = picks.length > 0
    }
  }
  scoreRecalibrationDecision.hardPassApplied =
    picks.length > 0 && gateWithContract.gateReason === "SCORE_RECALIBRATION_HARD_PASS"

  const orderingTrace = {
    inputTop1: summarizeOrderingCandidate(inputRows[0] ?? null, 1),
    preRerankTop1: summarizeOrderingCandidate(preRerankTop1, resolveRowRank1Based(rerankInputRows, preRerankTop1)),
    postPrimaryRerankTop1: summarizeOrderingCandidate(
      topAfterPrimaryRerank[0] ?? null,
      resolveRowRank1Based(topAfterPrimaryRerank, topAfterPrimaryRerank[0] ?? null),
    ),
    postMicroCorrectionTop1: summarizeOrderingCandidate(
      top[0] ?? null,
      resolveRowRank1Based(top, top[0] ?? null),
    ),
    gateInputTop1: summarizeOrderingCandidate(top[0] ?? null, resolveRowRank1Based(top, top[0] ?? null)),
    finalSelectedTop1: summarizeOrderingCandidate(picks[0] ?? null, resolveRowRank1Based(top, picks[0] ?? null)),
    candidatePoolSize: inputRows.length,
    preRerankPoolSize: rerankInputRows.length,
    gatePoolSize: top.length,
    swapCandidatePoolSize: Number.isFinite(Number(rerankDecision?.poolSize))
      ? Number(rerankDecision.poolSize)
      : Math.min(
        rerankInputRows.length,
        Math.max(2, Number(decisionGateCfg?.top1Rerank?.candidatePool ?? 3) || 3),
      ),
    primaryRerankApplied: rerankDecision?.applied === true,
    primaryRerankReason: rerankDecision?.reason ?? null,
    agreementRerankApplied: agreementRerankDecision?.applied === true,
    agreementRerankReason: agreementRerankDecision?.reason ?? null,
    microCorrectionApplied: microCorrectionDecision?.applied === true,
    microCorrectionReason: microCorrectionDecision?.reason ?? null,
    microCorrectionMode: microCorrectionDecision?.mode ?? null,
    microCorrectionPoolSize: Number.isFinite(Number(microCorrectionDecision?.poolSize))
      ? Number(microCorrectionDecision.poolSize)
      : null,
    finalSelectionMode: String(gateWithContract?.selectionPolicy?.mode ?? "UNKNOWN"),
    finalSelectionReason:
      picks.length < 1
        ? String(gateWithContract?.gateReason ?? "NO_PICK")
        : (top[0] && picks[0] && top[0] !== picks[0] &&
            String(top[0]?.symbol ?? "").trim() !== String(picks[0]?.symbol ?? "").trim())
          ? `SELECTION_POLICY_${String(gateWithContract?.selectionPolicy?.mode ?? "NON_TOP1").trim().toUpperCase()}`
          : null,
    finalGateReason: String(gateWithContract?.gateReason ?? "UNKNOWN"),
    agreementDecision: selectedRow?.agreementDecision ?? top?.[0]?.agreementDecision ?? null,
    agreementReason: selectedRow?.agreementReason ?? top?.[0]?.agreementReason ?? null,
    agreementEnforcementMode: gateWithContract?.agreementGate?.enforcementMode ?? null,
    agreementFallbackApplied: gateWithContract?.agreementFallback?.applied === true,
    agreementFallbackReason: gateWithContract?.agreementFallback?.reason ?? null,
    agreementFallbackChosenRank: Number.isFinite(
      Number(gateWithContract?.selectionPolicy?.chosenRank),
    )
      ? Number(gateWithContract.selectionPolicy.chosenRank)
      : null,
    agreementFallbackBlockedRank: Number.isFinite(
      Number(gateWithContract?.selectionPolicy?.agreementFallback?.blockedRank),
    )
      ? Number(gateWithContract.selectionPolicy.agreementFallback.blockedRank)
      : null,
    agreementFallbackBlockedSymbol:
      String(gateWithContract?.selectionPolicy?.agreementFallback?.blockedSymbol ?? "").trim() || null,
    agreementFallbackSelectionChanged:
      gateWithContract?.agreementFallback?.applied === true &&
      String(top?.[0]?.symbol ?? "").trim() !== String(picks?.[0]?.symbol ?? "").trim(),
    agreementShadowRejectBlocked: gateWithContract?.agreementShadowReject?.blocked === true,
    agreementShadowRejectReason: gateWithContract?.agreementShadowReject?.reason ?? null,
    agreementShadowRejectAgreementReason:
      gateWithContract?.agreementShadowReject?.agreementReason ?? null,
    agreementShadowRejectSelectionMode:
      gateWithContract?.agreementShadowReject?.selectionMode ?? null,
    scoreOriginTrace,
    counterfactualGateSweep,
    scoreRecovery: scoreRecoveryDecision,
    scoreRecalibration: scoreRecalibrationDecision
  }

  return {
    inversionAdjusted,
    rerankDecision: {
      ...(rerankDecision && typeof rerankDecision === "object" ? rerankDecision : {}),
      agreementRerank: agreementRerankDecision,
      microCorrection: microCorrectionDecision
    },
    top,
    gate: gateWithContract,
    picks,
    pick: picks[0] ?? null,
    selectionCount: picks.length,
    selectedRankerScore: Number(picks?.[0]?.rankerScore ?? picks?.[0]?.finalScore ?? picks?.[0]?.score ?? 0) || 0,
    orderingTrace,
    scoreOriginTrace,
    counterfactualGateSweep,
    scoreRecovery: scoreRecoveryDecision,
    scoreRecalibration: scoreRecalibrationDecision
  }
}

const resolveToxicRegimeDecision = ({ row, toxicRegime }) => {
  const cfg = toxicRegime ?? {}
  if (cfg?.enabled !== true) return null
  const updateStats = cfg?.updateStats instanceof Map ? cfg.updateStats : new Map()
  const regimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
  const stats = updateStats.get(regimeTag) ?? null
  const minSamples = Math.max(1, Number(cfg?.minSamples ?? 60) || 60)
  const maxHitRateLcb95 = clamp01(cfg?.maxHitRateLcb95 ?? 0)
  if (!stats || Number(stats?.count ?? 0) < minSamples) return null
  const updateCount = Math.max(0, Number(stats?.count ?? 0) || 0)
  const updateHitCount = Math.max(0, Number(stats?.hitCount ?? 0) || 0)
  const regimeLcb95 = wilsonLowerBound95({
    success: updateHitCount,
    total: updateCount
  })
  if (regimeLcb95 > maxHitRateLcb95) return null
  const action = String(cfg?.action ?? "SHADOW").trim().toUpperCase()
  return {
    decision: action === "BLOCK" ? "BLOCK" : "SHADOW_REGIME_TOXIC",
    reason: "REGIME_TOXIC_UPDATE_ONLY",
    checks: {
      toxicRegime: {
        regimeTag,
        minSamples,
        maxHitRateLcb95,
        updateCount,
        updateHitCount,
        updateLcb95: regimeLcb95
      }
    }
  }
}

const resolveExecutionScore = (executionDecision) => {
  const checks = executionDecision?.checks ?? {}
  const cands = []
  const requireGlobalFloor = checks?.requireGlobalFloor === true
  const requireRegimeApproval = checks?.requireRegimeApproval === true
  const globalLcb95 = Number(checks?.globalLcb95)
  const regimeLcb95 = Number(checks?.regimeLcb95)
  const targetLcb = Number(checks?.targetLcb)
  if (requireGlobalFloor && Number.isFinite(globalLcb95)) cands.push(globalLcb95)
  if (requireRegimeApproval && Number.isFinite(regimeLcb95)) cands.push(regimeLcb95)
  if (cands.length > 0) return Math.min(...cands)
  if (Number.isFinite(targetLcb) && String(executionDecision?.decision ?? "") === "TRADE") {
    return targetLcb
  }
  return null
}

export const runD2ExecutionScorer = ({
  top,
  picks,
  gate,
  rerankDecision,
  calibrationCfg,
  metaSelectorCfg,
  executionGateCfg,
  executionCalibration,
  falsePositiveGateCfg = null,
  falsePositiveState = null,
  falsePositiveModel = null,
  falsePositiveModelCfg = null,
  opportunityBudgetCfg = null,
  dayTypeDecision = null,
  toxicRegime = null,
  preExecutionDecisionResolver = null,
  policyContract = null
}) => {
  const rows = Array.isArray(picks) ? picks : []
  const executionPicks = []
  const executionFeedbackRows = []
  const falsePositiveFeedbackRows = []
  const metaDecisionCounts = {}
  const executionDecisionCounts = {}
  const executionShadowReasonCounts = {}
  const falsePositiveDecisionCounts = {}
  const falsePositiveReasonCounts = {}
  const budgetDecisionCounts = {}
  const budgetReasonCounts = {}
  let executionBlockedCount = 0
  let preFalsePositiveApprovedCount = 0
  let falsePositiveRejectedCount = 0
  let falsePositiveRejectedHitCount = 0
  let falsePositiveRejectedMissCount = 0
  let budgetRejectedCount = 0
  let budgetRejectedHitCount = 0
  let budgetRejectedMissCount = 0
  const opportunityBudgetRuntime = createOpportunityBudgetRuntime({
    cfg: opportunityBudgetCfg,
    dayTypeDecision
  })
  const thresholds = resolvePolicyContractThresholds(policyContract)

  for (const row of rows) {
    const rowScoreMargin = resolvePickScoreMargin({
      top,
      pick: row,
      baseMargin: gate?.scoreMargin
    })
    row.calibrated = estimateCalibratedSignals({
      row,
      scoreMargin: rowScoreMargin,
      calibration: executionCalibration,
      cfg: calibrationCfg
    })

    const metaDecision = evaluateMetaSelector({
      row,
      calibrated: row.calibrated,
      scoreMargin: rowScoreMargin,
      cfg: metaSelectorCfg
    })
    row.metaDecision = metaDecision?.decision ?? "TRADE"
    row.metaReason = metaDecision?.reason ?? null
    row.metaChecks = metaDecision?.checks ?? {}
    row.metaDiagnosticDecision = metaDecision?.diagnosticDecision ?? null
    row.metaDiagnosticReason = metaDecision?.diagnosticReason ?? null
    row.metaDiagnosticOnly = metaDecision?.diagnosticOnly === true
    bump(metaDecisionCounts, row.metaDecision)

    let executionDecision = null
    if (typeof preExecutionDecisionResolver === "function") {
      executionDecision = preExecutionDecisionResolver({
        row,
        scoreMargin: rowScoreMargin,
        rerankDecision,
        metaDecision
      })
    }
    if (!executionDecision) {
      executionDecision = resolveToxicRegimeDecision({
        row,
        toxicRegime
      })
    }
    if (!executionDecision) {
      executionDecision = evaluateExecutionGate({
        row,
        scoreMargin: rowScoreMargin,
        rerankDecision,
        metaDecision,
        calibration: executionCalibration,
        cfg: executionGateCfg
      })
    }
    let executionScore = resolveExecutionScore(executionDecision)
    if (
      Number.isFinite(thresholds.tauExec) &&
      String(executionDecision?.decision ?? "TRADE").trim().toUpperCase() === "TRADE"
    ) {
      const passTauExec =
        Number.isFinite(executionScore) && executionScore >= Number(thresholds.tauExec)
      if (!passTauExec) {
        executionDecision = {
          ...(executionDecision && typeof executionDecision === "object" ? executionDecision : {}),
          decision: "SHADOW_POLICY_TAU_EXEC",
          reason: "POLICY_TAU_EXEC_LOW",
          checks: {
            ...(executionDecision?.checks ?? {}),
            policyContract: {
              tauExec: Number(thresholds.tauExec),
              executionScore: Number.isFinite(executionScore) ? executionScore : null,
              pass: false
            }
          }
        }
        executionScore = resolveExecutionScore(executionDecision)
      } else {
        executionDecision = {
          ...(executionDecision && typeof executionDecision === "object" ? executionDecision : {}),
          checks: {
            ...(executionDecision?.checks ?? {}),
            policyContract: {
              tauExec: Number(thresholds.tauExec),
              executionScore,
              pass: true
            }
          }
        }
      }
    }
    row.executionDecisionPreFalsePositive = executionDecision?.decision ?? "TRADE"
    row.executionShadowReasonPreFalsePositive =
      row.executionDecisionPreFalsePositive === "TRADE"
        ? null
        : (executionDecision?.reason ?? row.executionDecisionPreFalsePositive)
    const falsePositiveModelDecision = scoreFalsePositiveModel({
      row,
      model: falsePositiveModel,
      cfg: falsePositiveModelCfg,
      dayTypeDecision
    })
    row.falsePositiveModelRisk = Number.isFinite(Number(falsePositiveModelDecision?.risk))
      ? Number(falsePositiveModelDecision.risk)
      : null
    row.falsePositiveModelAvailable = falsePositiveModelDecision?.available === true
    row.falsePositiveModelChecks = falsePositiveModelDecision?.checks ?? {}
    if (String(executionDecision?.decision ?? "TRADE").trim().toUpperCase() === "TRADE") {
      preFalsePositiveApprovedCount += 1
      executionFeedbackRows.push(row)
      const falsePositiveDecision = evaluateFalsePositiveGate({
        row,
        cfg: falsePositiveGateCfg,
        state: falsePositiveState,
        maxRiskOverride: thresholds.tauFp,
        modelRisk: row.falsePositiveModelRisk,
        modelChecks: row.falsePositiveModelChecks,
        modelCfg: falsePositiveModelCfg
      })
      row.falsePositiveRisk = Number.isFinite(Number(falsePositiveDecision?.risk))
        ? Number(falsePositiveDecision.risk)
        : null
      row.falsePositiveDecision = falsePositiveDecision?.decision ?? "TRADE"
      row.falsePositiveReason = falsePositiveDecision?.reason ?? null
      row.falsePositiveChecks = falsePositiveDecision?.checks ?? {}
      bump(falsePositiveDecisionCounts, row.falsePositiveDecision)
      if (row.falsePositiveReason) {
        bump(falsePositiveReasonCounts, row.falsePositiveReason)
      }
      if (
        row.falsePositiveDecision !== "TRADE" &&
        String(row.falsePositiveDecision).trim().length > 0
      ) {
        falsePositiveRejectedCount += 1
        if (row?.successInWindow === true) {
          falsePositiveRejectedHitCount += 1
        } else {
          falsePositiveRejectedMissCount += 1
        }
        executionDecision = {
          ...(executionDecision && typeof executionDecision === "object" ? executionDecision : {}),
          decision: row.falsePositiveDecision,
          reason: row.falsePositiveReason ?? "FALSE_POSITIVE_RISK_HIGH",
          checks: {
            ...(executionDecision?.checks ?? {}),
            falsePositive: row.falsePositiveChecks,
            policyContract: {
              ...(executionDecision?.checks?.policyContract ?? {}),
              tauFp: Number.isFinite(thresholds.tauFp) ? Number(thresholds.tauFp) : null,
              falsePositiveRisk: row.falsePositiveRisk,
              pass: false
            }
          }
        }
      } else if (executionDecision?.checks && typeof executionDecision.checks === "object") {
        executionDecision = {
          ...executionDecision,
          checks: {
            ...executionDecision.checks,
            falsePositive: row.falsePositiveChecks,
            policyContract: {
              ...(executionDecision?.checks?.policyContract ?? {}),
              tauFp: Number.isFinite(thresholds.tauFp) ? Number(thresholds.tauFp) : null,
              falsePositiveRisk: row.falsePositiveRisk,
              pass: true
            }
          }
        }
      }
      const budgetDecision = evaluateOpportunityBudget({
        row,
        runtime: opportunityBudgetRuntime
      })
      row.budgetDecision = budgetDecision?.decision ?? "TRADE"
      row.budgetReason = budgetDecision?.reason ?? null
      row.budgetChecks = budgetDecision?.checks ?? {}
      bump(budgetDecisionCounts, row.budgetDecision)
      if (row.budgetReason) {
        bump(budgetReasonCounts, row.budgetReason)
      }
      if (
        row.budgetDecision !== "TRADE" &&
        String(row.budgetDecision).trim().length > 0
      ) {
        budgetRejectedCount += 1
        if (row?.successInWindow === true) {
          budgetRejectedHitCount += 1
        } else {
          budgetRejectedMissCount += 1
        }
        executionDecision = {
          ...(executionDecision && typeof executionDecision === "object" ? executionDecision : {}),
          decision: row.budgetDecision,
          reason: row.budgetReason ?? "OPPORTUNITY_BUDGET_REJECT",
          checks: {
            ...(executionDecision?.checks ?? {}),
            budget: row.budgetChecks
          }
        }
      } else {
        recordOpportunityBudgetAcceptance({
          row,
          runtime: opportunityBudgetRuntime
        })
        if (executionDecision?.checks && typeof executionDecision.checks === "object") {
          executionDecision = {
            ...executionDecision,
            checks: {
              ...executionDecision.checks,
              budget: row.budgetChecks
            }
          }
        }
      }
    } else {
      row.falsePositiveRisk = null
      row.falsePositiveDecision = "SKIP_NOT_EXECUTABLE"
      row.falsePositiveReason = null
      row.falsePositiveChecks = {}
      row.budgetDecision = "SKIP_NOT_EXECUTABLE"
      row.budgetReason = null
      row.budgetChecks = {}
    }
    row.executionDecision = executionDecision?.decision ?? "TRADE"
    row.executionShadowReason =
      row.executionDecision === "TRADE"
        ? null
        : (executionDecision?.reason ?? row.executionDecision)
    row.executionChecks = executionDecision?.checks ?? {}
    row.executionScore = executionScore

    bump(executionDecisionCounts, row.executionDecision)
    if (row.executionDecision === "TRADE") {
      executionPicks.push(row)
    } else {
      if (String(row.executionDecision).startsWith("BLOCK")) {
        executionBlockedCount += 1
      }
      const shadowKey = row.executionShadowReason ?? row.executionDecision
      bump(executionShadowReasonCounts, shadowKey)
    }
    falsePositiveFeedbackRows.push(row)
  }

  return {
    executedPicks: executionPicks,
    executedPick: executionPicks[0] ?? null,
    executionFeedbackRows,
    falsePositiveFeedbackRows,
    metaDecisionCounts,
    executionDecisionCounts,
    executionShadowReasonCounts,
    executionBlockedCount,
    falsePositiveDecisionCounts,
    falsePositiveReasonCounts,
    preFalsePositiveApprovedCount,
    falsePositiveRejectedCount,
    falsePositiveRejectedHitCount,
    falsePositiveRejectedMissCount,
    budgetDecisionCounts,
    budgetReasonCounts,
    budgetRejectedCount,
    budgetRejectedHitCount,
    budgetRejectedMissCount
  }
}
