const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const clampSigned = (value, maxAbs = 1) => {
  const abs = Math.max(1e-6, Number(maxAbs) || 1)
  return clamp(Number(value) || 0, -abs, abs) / abs
}

const toPositiveInt = (value, fallback) => {
  const n = Math.floor(Number(value))
  if (Number.isInteger(n) && n > 0) return n
  return Math.max(1, Math.floor(Number(fallback) || 1))
}

const toNonNegativeIntOrNull = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

const normalizeOverrideMode = (value) => {
  const text = String(value ?? "prefer_model").trim().toLowerCase()
  if (["prefer_model", "confident_override", "confident_agree_only", "rule_only"].includes(text)) {
    return text
  }
  return "prefer_model"
}

const normalizeNoTradeOverrideMode = (value) => {
  const text = String(value ?? "allow").trim().toLowerCase()
  if (["allow", "rule_only"].includes(text)) {
    return text
  }
  return "allow"
}

const toFinite = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number(fallback) || 0
}

const normalizeDayType = (value) => {
  const text = String(value ?? "BALANCED").trim().toUpperCase()
  if ([
    "BALANCED",
    "TREND",
    "MEAN_REVERSION",
    "GAP_FADE_RISK",
    "NOISE",
    "EXECUTION_HOSTILE",
    "THIN_LIQUIDITY_TRAP",
    "NO_TRADE"
  ].includes(text)) {
    return text
  }
  return "BALANCED"
}

const strictnessOf = (value) => {
  const key = normalizeDayType(value)
  if (key === "TREND") return 0
  if (key === "BALANCED") return 1
  if (key === "MEAN_REVERSION") return 2
  if (key === "GAP_FADE_RISK") return 3
  if (key === "NOISE") return 4
  if (key === "EXECUTION_HOSTILE") return 5
  if (key === "THIN_LIQUIDITY_TRAP") return 6
  if (key === "NO_TRADE") return 7
  return 1
}

const softmax = (scores) => {
  const values = Object.values(scores)
  if (values.length < 1) return {}
  const maxScore = Math.max(...values.map((value) => Number(value) || 0))
  let sum = 0
  const expScores = {}
  for (const [key, value] of Object.entries(scores)) {
    const expValue = Math.exp((Number(value) || 0) - maxScore)
    expScores[key] = expValue
    sum += expValue
  }
  if (sum <= 0) return Object.fromEntries(Object.keys(scores).map((key) => [key, 0]))
  return Object.fromEntries(
    Object.entries(expScores).map(([key, value]) => [key, value / sum]),
  )
}

const findSignalValue = (signals, key, fallback = 0) => {
  const n = Number(signals?.[key] ?? fallback)
  return Number.isFinite(n) ? n : Number(fallback) || 0
}

const buildDirectObjectiveScores = ({
  ruleDecision,
  finalDecision,
  candidateHit = false,
  selectedHit = false,
  executedHit = false,
  top1Blocked = false,
  executedNetRet = null
}) => {
  const signals = ruleDecision?.signals ?? {}
  const top1Margin = findSignalValue(signals, "top1Margin")
  const top1ExpectedNetRet3d = findSignalValue(signals, "top1ExpectedNetRet3d")
  const avgPHit = findSignalValue(signals, "avgPHit")
  const avgFillProb = findSignalValue(signals, "avgFillProb", 1)
  const avgSlippageRisk = findSignalValue(signals, "avgSlippageRisk")
  const strongCandidateShare = findSignalValue(signals, "strongCandidateShare")
  const lowFillShare = findSignalValue(signals, "lowFillShare")
  const lowLiquidityShare = findSignalValue(signals, "lowLiquidityShare")
  const finalNoTrade = finalDecision?.noTrade === true
  const realizedNetRet = Number.isFinite(Number(executedNetRet)) ? Number(executedNetRet) : null
  const realizedRetScaled = Number.isFinite(realizedNetRet)
    ? clampSigned(realizedNetRet, 0.04)
    : 0
  const candidateEdge =
    (candidateHit === true ? 1 : 0) +
    Math.max(0, top1Margin) * 120 +
    Math.max(0, top1ExpectedNetRet3d) * 40 +
    avgPHit * 0.8
  const executionHostility =
    lowFillShare * 1.8 +
    (1 - avgFillProb) * 1.5 +
    avgSlippageRisk * 10
  const liquidityFragility =
    lowLiquidityShare * 2 +
    avgSlippageRisk * 4
  return {
    NO_TRADE:
      (candidateHit !== true ? 2.8 : -1.4) +
      (selectedHit !== true ? 0.8 : -0.4) +
      (executedHit !== true ? 1.2 : -2.4) +
      (top1Blocked ? 0.6 : 0) +
      (finalNoTrade ? 0.6 : 0) -
      candidateEdge * 0.5,
    THIN_LIQUIDITY_TRAP:
      liquidityFragility * 1.4 +
      (executedHit !== true ? 0.8 : -1.4) +
      (candidateHit ? 0.1 : -0.4),
    EXECUTION_HOSTILE:
      executionHostility * 1.3 +
      (executedHit !== true ? 0.9 : -1.2) +
      (candidateHit ? 0.15 : 0),
    MEAN_REVERSION:
      (selectedHit ? 1.4 : -0.5) +
      (executedHit ? 0.6 : 0) +
      Math.max(0, 0.003 - top1Margin) * 210 +
      Math.max(0, avgPHit - 0.48) * 1.4 +
      Math.max(0, -realizedRetScaled) * 0.1,
    GAP_FADE_RISK:
      (!selectedHit ? 1.3 : -0.35) +
      Math.max(0, top1Margin) * 130 +
      Math.max(0, top1ExpectedNetRet3d) * 45 +
      Math.max(0, 0.62 - avgPHit) * 2.2 +
      executionHostility * 0.35,
    TREND:
      (executedHit ? 2.9 : -0.8) +
      Math.max(0, realizedRetScaled) * 2.4 +
      Math.max(0, top1Margin) * 140 +
      Math.max(0, top1ExpectedNetRet3d) * 28 +
      strongCandidateShare * 1.8 -
      executionHostility * 0.25,
    NOISE:
      (!selectedHit ? 1.1 : -0.15) +
      (top1Blocked ? 0.8 : 0) +
      Math.max(0, 0.35 - strongCandidateShare) * 2.8 +
      (candidateHit ? -0.2 : 0.3) +
      (executedHit ? -1.3 : 0),
    BALANCED:
      0.9 +
      (selectedHit ? 0.7 : 0) +
      (executedHit ? 0.95 : 0) +
      Math.max(0, realizedRetScaled) * 0.8 +
      Math.max(0, top1ExpectedNetRet3d) * 10 -
      Math.max(0, executionHostility - 0.6) * 0.15
  }
}

const normalizeLabelWeightsFromScores = (scoreByLabel) => {
  const safeScores =
    scoreByLabel && typeof scoreByLabel === "object"
      ? Object.fromEntries(
          Object.entries(scoreByLabel)
            .map(([key, value]) => [normalizeDayType(key), Number(value) || 0])
            .filter(([key]) => DAY_TYPE_MODEL_LABELS.includes(key)),
        )
      : {}
  const weights = softmax(safeScores)
  if (Object.keys(weights).length > 0) return weights
  return { BALANCED: 1 }
}

const deriveOutcomeDrivenLabel = ({
  ruleDecision,
  finalDecision,
  candidateHit = false,
  selectedHit = false,
  executedHit = false,
  top1Blocked = false,
  executedNetRet = null
}) => {
  const directScores = buildDirectObjectiveScores({
    ruleDecision,
    finalDecision,
    candidateHit,
    selectedHit,
    executedHit,
    top1Blocked,
    executedNetRet
  })
  const scoreByLabel = {
    NO_TRADE: directScores.NO_TRADE,
    THIN_LIQUIDITY_TRAP: directScores.THIN_LIQUIDITY_TRAP,
    EXECUTION_HOSTILE: directScores.EXECUTION_HOSTILE,
    MEAN_REVERSION: directScores.MEAN_REVERSION,
    GAP_FADE_RISK: directScores.GAP_FADE_RISK,
    TREND: directScores.TREND,
    NOISE: directScores.NOISE,
    BALANCED: directScores.BALANCED
  }
  const ranked = Object.entries(scoreByLabel).sort((a, b) => Number(b[1]) - Number(a[1]))
  const label = normalizeDayType(ranked[0]?.[0] ?? "BALANCED")
  const source = `OUTCOME_DIRECT_REWARD_${label}`
  return {
    label,
    source,
    scoreByLabel,
    labelWeights: normalizeLabelWeightsFromScores(scoreByLabel)
  }
}

export const DAY_TYPE_MODEL_LABELS = [
  "BALANCED",
  "TREND",
  "MEAN_REVERSION",
  "GAP_FADE_RISK",
  "NOISE",
  "EXECUTION_HOSTILE",
  "THIN_LIQUIDITY_TRAP",
  "NO_TRADE"
]

export const DAY_TYPE_MODEL_FEATURE_KEYS = [
  "sampleSizeScaled",
  "top1MarginScaled",
  "top1QualityScore",
  "top1ExpectedRetScaled",
  "avgPHit",
  "avgFillProb",
  "avgSlippageRiskScaled",
  "medianLiquidityPenalty",
  "strongCandidateShare",
  "lowFillShare",
  "lowLiquidityShare"
]

export const resolveDayTypeModelConfig = (raw) => {
  const cfg = raw ?? {}
  const edgeAwareShadow = cfg?.edgeAwareShadow ?? {}
  const edgeTradeEscape = cfg?.edgeTradeEscape ?? {}
  return {
    enabled: cfg?.enabled === true,
    minTrainingRows: toPositiveInt(cfg?.minTrainingRows, 40),
    minSamplesForInference: toPositiveInt(cfg?.minSamplesForInference, 30),
    minClassRows: toPositiveInt(cfg?.minClassRows, 4),
    minConfidence: clamp01(cfg?.minConfidence ?? 0.58),
    minConfidenceGap: clamp01(cfg?.minConfidenceGap ?? 0.08),
    preferModelWhenAvailable: cfg?.preferModelWhenAvailable !== false,
    allowAggressiveOverride: cfg?.allowAggressiveOverride === true,
    overrideMode: normalizeOverrideMode(cfg?.overrideMode),
    noTradeOverrideMode: normalizeNoTradeOverrideMode(cfg?.noTradeOverrideMode),
    emitShadowDecision: cfg?.emitShadowDecision !== false,
    edgeAwareShadow: {
      enabled: edgeAwareShadow?.enabled === true,
      minTop1ExpectedNetRet3d: toFinite(edgeAwareShadow?.minTop1ExpectedNetRet3d, 0.012),
      minStrongCandidateShare: clamp01(edgeAwareShadow?.minStrongCandidateShare ?? 0.28),
      maxAvgSlippageRisk: Math.max(0, toFinite(edgeAwareShadow?.maxAvgSlippageRisk, 0.09)),
      minAvgFillProb: clamp01(edgeAwareShadow?.minAvgFillProb ?? 0.62),
      minTop1Margin: Math.max(0, toFinite(edgeAwareShadow?.minTop1Margin, 0.003)),
      allowedRuleDayTypes: Array.from(
        new Set(
          (Array.isArray(edgeAwareShadow?.allowedRuleDayTypes) ? edgeAwareShadow.allowedRuleDayTypes : ["BALANCED", "TREND"])
            .map((value) => normalizeDayType(value))
            .filter(Boolean),
        ),
      )
    },
    edgeTradeEscape: {
      enabled: edgeTradeEscape?.enabled === true,
      minTop1ExpectedNetRet3d: toFinite(edgeTradeEscape?.minTop1ExpectedNetRet3d, 0.015),
      maxAvgSlippageRisk: Math.max(0, toFinite(edgeTradeEscape?.maxAvgSlippageRisk, 0.16)),
      minAvgFillProb: clamp01(edgeTradeEscape?.minAvgFillProb ?? 0.94),
      minTop1Margin: Math.max(0, toFinite(edgeTradeEscape?.minTop1Margin, 0)),
      allowedRuleDayTypes: Array.from(
        new Set(
          (Array.isArray(edgeTradeEscape?.allowedRuleDayTypes)
            ? edgeTradeEscape.allowedRuleDayTypes
            : ["THIN_LIQUIDITY_TRAP"])
            .map((value) => normalizeDayType(value))
            .filter(Boolean),
        ),
      ),
      allowedPredictedDayTypes: Array.from(
        new Set(
          (Array.isArray(edgeTradeEscape?.allowedPredictedDayTypes)
            ? edgeTradeEscape.allowedPredictedDayTypes
            : ["GAP_FADE_RISK"])
            .map((value) => normalizeDayType(value))
            .filter(Boolean),
        ),
      ),
      policyOverrides: {
        noTrade: edgeTradeEscape?.policyOverrides?.noTrade === true,
        minFinalScoreDelta: toFinite(edgeTradeEscape?.policyOverrides?.minFinalScoreDelta, -0.03),
        minExpectedNetRet3dDelta: toFinite(
          edgeTradeEscape?.policyOverrides?.minExpectedNetRet3dDelta,
          0.002,
        ),
        minScoreMarginMultiplier: Math.max(
          0,
          toFinite(edgeTradeEscape?.policyOverrides?.minScoreMarginMultiplier, 0),
        ),
        tauExecMultiplier: Math.max(0, toFinite(edgeTradeEscape?.policyOverrides?.tauExecMultiplier, 1.08)),
        tauFpMultiplier: Math.max(0, toFinite(edgeTradeEscape?.policyOverrides?.tauFpMultiplier, 0.9)),
        maxPicksPerDay: (() => {
          const n = Math.floor(Number(edgeTradeEscape?.policyOverrides?.maxPicksPerDay))
          if (n === 1 || n === 2) return n
          return 1
        })(),
        maxExecutedPicks: toNonNegativeIntOrNull(edgeTradeEscape?.policyOverrides?.maxExecutedPicks, 1),
        maxFragileExecuted: toNonNegativeIntOrNull(edgeTradeEscape?.policyOverrides?.maxFragileExecuted, 1),
        maxLowLiquidityExecuted: toNonNegativeIntOrNull(
          edgeTradeEscape?.policyOverrides?.maxLowLiquidityExecuted,
          1,
        ),
        maxExecutionHostileExecuted: toNonNegativeIntOrNull(
          edgeTradeEscape?.policyOverrides?.maxExecutionHostileExecuted,
          1,
        ),
        maxSameRouteBucket: toNonNegativeIntOrNull(edgeTradeEscape?.policyOverrides?.maxSameRouteBucket, 1),
        maxSameRegimeTag: toNonNegativeIntOrNull(edgeTradeEscape?.policyOverrides?.maxSameRegimeTag, 1),
        maxSamePrototypeFamily: toNonNegativeIntOrNull(
          edgeTradeEscape?.policyOverrides?.maxSamePrototypeFamily,
          1,
        )
      }
    }
  }
}

const buildZeroMap = (keys) => Object.fromEntries(keys.map((key) => [key, 0]))

export const createEmptyDayTypeModel = ({ cfg } = {}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  return {
    version: "v3",
    kind: "weighted_centroid_classifier",
    featureKeys: DAY_TYPE_MODEL_FEATURE_KEYS.slice(),
    sampleCount: 0,
    globalSums: buildZeroMap(DAY_TYPE_MODEL_FEATURE_KEYS),
    globalSumSquares: buildZeroMap(DAY_TYPE_MODEL_FEATURE_KEYS),
    classCounts: Object.fromEntries(DAY_TYPE_MODEL_LABELS.map((label) => [label, 0])),
    classSums: Object.fromEntries(
      DAY_TYPE_MODEL_LABELS.map((label) => [label, buildZeroMap(DAY_TYPE_MODEL_FEATURE_KEYS)]),
    ),
    config: safeCfg
  }
}

export const hydrateDayTypeModel = ({ raw, cfg } = {}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  const source = raw && typeof raw === "object" ? raw : {}
  const base = createEmptyDayTypeModel({ cfg: safeCfg })
  const classSums = {}
  for (const label of DAY_TYPE_MODEL_LABELS) {
    classSums[label] = {
      ...base.classSums[label],
      ...(source?.classSums?.[label] && typeof source.classSums[label] === "object"
        ? source.classSums[label]
        : {})
    }
  }
  return {
    ...base,
    version: String(source?.version ?? base.version),
    kind: String(source?.kind ?? base.kind),
    featureKeys: Array.isArray(source?.featureKeys) && source.featureKeys.length > 0
      ? source.featureKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
      : base.featureKeys,
    sampleCount: Math.max(0, Number(source?.sampleCount ?? 0) || 0),
    globalSums: {
      ...base.globalSums,
      ...(source?.globalSums && typeof source.globalSums === "object" ? source.globalSums : {})
    },
    globalSumSquares: {
      ...base.globalSumSquares,
      ...(source?.globalSumSquares && typeof source.globalSumSquares === "object"
        ? source.globalSumSquares
        : {})
    },
    classCounts: {
      ...base.classCounts,
      ...(source?.classCounts && typeof source.classCounts === "object" ? source.classCounts : {})
    },
    classSums,
    config: {
      ...safeCfg,
      ...(source?.config && typeof source.config === "object" ? source.config : {})
    }
  }
}

export const resolveDayTypeModelArtifact = ({ policyState, stepDSummary, cfg } = {}) => {
  const raw =
    policyState?.dayTypeModel ??
    stepDSummary?.dayTypeModel ??
    null
  return hydrateDayTypeModel({ raw, cfg })
}

export const extractDayTypeModelFeatures = ({ signals }) => ({
  sampleSizeScaled: clampSigned(signals?.sampleSize ?? 0, 8),
  top1MarginScaled: clampSigned(signals?.top1Margin ?? 0, 0.02),
  top1QualityScore: clamp01(signals?.top1QualityScore ?? 0),
  top1ExpectedRetScaled: clampSigned(signals?.top1ExpectedNetRet3d ?? 0, 0.03),
  avgPHit: clamp01(signals?.avgPHit ?? 0),
  avgFillProb: clamp01(signals?.avgFillProb ?? 0),
  avgSlippageRiskScaled: clampSigned(signals?.avgSlippageRisk ?? 0, 0.12),
  medianLiquidityPenalty: clamp01(
    Number(signals?.medianLiquidityKrw ?? 0) > 0
      ? (1_800_000_000 - Number(signals.medianLiquidityKrw)) / 1_800_000_000
      : 1,
  ),
  strongCandidateShare: clamp01(signals?.strongCandidateShare ?? 0),
  lowFillShare: clamp01(signals?.lowFillShare ?? 0),
  lowLiquidityShare: clamp01(signals?.lowLiquidityShare ?? 0)
})

const computeFeatureMean = (model, key) => {
  const sampleCount = Math.max(1, Number(model?.sampleCount ?? 0) || 1)
  return (Number(model?.globalSums?.[key] ?? 0) || 0) / sampleCount
}

const computeFeatureStd = (model, key) => {
  const sampleCount = Math.max(1, Number(model?.sampleCount ?? 0) || 1)
  const mean = computeFeatureMean(model, key)
  const meanSq = (Number(model?.globalSumSquares?.[key] ?? 0) || 0) / sampleCount
  return Math.max(1e-6, Math.sqrt(Math.max(0, meanSq - mean ** 2)))
}

const standardizeFeatureMap = ({ featureMap, model }) =>
  Object.fromEntries(
    DAY_TYPE_MODEL_FEATURE_KEYS.map((key) => {
      const mean = computeFeatureMean(model, key)
      const std = computeFeatureStd(model, key)
      const value = Number(featureMap?.[key] ?? 0) || 0
      return [key, (value - mean) / std]
    }),
  )

export const updateDayTypeModelOnline = ({
  model,
  featureMap,
  label,
  labelScores = null,
  cfg
}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  const next = hydrateDayTypeModel({ raw: model, cfg: safeCfg })
  const classLabel = normalizeDayType(label)
  const labelWeights =
    labelScores && typeof labelScores === "object"
      ? normalizeLabelWeightsFromScores(labelScores)
      : { [classLabel]: 1 }
  next.sampleCount = Math.max(0, Number(next.sampleCount ?? 0) + 1)
  for (const [weightedLabel, rawWeight] of Object.entries(labelWeights)) {
    const safeLabel = normalizeDayType(weightedLabel)
    const weight = Math.max(0, Number(rawWeight ?? 0) || 0)
    if (weight <= 0) continue
    next.classCounts[safeLabel] =
      (Number(next.classCounts?.[safeLabel] ?? 0) || 0) + weight
  }
  for (const key of DAY_TYPE_MODEL_FEATURE_KEYS) {
    const value = Number(featureMap?.[key] ?? 0) || 0
    next.globalSums[key] = (Number(next.globalSums?.[key] ?? 0) || 0) + value
    next.globalSumSquares[key] = (Number(next.globalSumSquares?.[key] ?? 0) || 0) + value ** 2
    for (const [weightedLabel, rawWeight] of Object.entries(labelWeights)) {
      const safeLabel = normalizeDayType(weightedLabel)
      const weight = Math.max(0, Number(rawWeight ?? 0) || 0)
      if (weight <= 0) continue
      next.classSums[safeLabel][key] =
        (Number(next.classSums?.[safeLabel]?.[key] ?? 0) || 0) + value * weight
    }
  }
  return next
}

export const trainDayTypeModelFromDataset = ({
  rows,
  cfg
}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  let model = createEmptyDayTypeModel({ cfg: safeCfg })
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const featureMap = row?.modelFeatures ?? {}
    const label = row?.trainingLabel ?? row?.ruleDayType ?? row?.finalDayType ?? "BALANCED"
    model = updateDayTypeModelOnline({
      model,
      featureMap,
      label,
      labelScores: row?.trainingLabelScores ?? null,
      cfg: safeCfg
    })
  }
  return hydrateDayTypeModel({ raw: model, cfg: safeCfg })
}

export const scoreDayTypeModel = ({
  signals,
  model,
  cfg
}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  const safeModel = hydrateDayTypeModel({ raw: model, cfg: safeCfg })
  if (safeCfg.enabled !== true) {
    return {
      enabled: false,
      available: false,
      predictedDayType: null,
      confidence: null,
      confidenceGap: null,
      probabilities: {},
      checks: {
        sampleCount: Number(safeModel?.sampleCount ?? 0) || 0
      }
    }
  }
  const sampleCount = Number(safeModel?.sampleCount ?? 0) || 0
  const warmup = sampleCount < Number(safeCfg?.minSamplesForInference ?? 0)
  const minClassRows = warmup ? 1 : Number(safeCfg?.minClassRows ?? 0)
  const featureMap = extractDayTypeModelFeatures({ signals })
  const zFeatures = standardizeFeatureMap({ featureMap, model: safeModel })
  const rawScores = {}
  for (const label of DAY_TYPE_MODEL_LABELS) {
    const classCount = Number(safeModel?.classCounts?.[label] ?? 0) || 0
    if (classCount < minClassRows) continue
    let distance = 0
    for (const key of DAY_TYPE_MODEL_FEATURE_KEYS) {
      const centroidRaw = (Number(safeModel?.classSums?.[label]?.[key] ?? 0) || 0) / Math.max(1, classCount)
      const mean = computeFeatureMean(safeModel, key)
      const std = computeFeatureStd(safeModel, key)
      const centroid = (centroidRaw - mean) / std
      distance += (Number(zFeatures?.[key] ?? 0) - centroid) ** 2
    }
    rawScores[label] = -distance
  }
  const probabilities = softmax(rawScores)
  const ranked = Object.entries(probabilities).sort((a, b) => Number(b[1]) - Number(a[1]))
  const predictedDayType = ranked[0]?.[0] ?? null
  const confidence = Number.isFinite(Number(ranked[0]?.[1])) ? Number(ranked[0][1]) : null
  const confidenceGap =
    Number.isFinite(Number(ranked[0]?.[1])) && Number.isFinite(Number(ranked[1]?.[1]))
      ? Number(ranked[0][1]) - Number(ranked[1][1])
      : confidence
  return {
    enabled: true,
    available: Boolean(predictedDayType),
    predictedDayType,
    confidence,
    confidenceGap,
    probabilities,
    checks: {
      sampleCount,
      warmup,
      minClassRowsUsed: minClassRows,
      classCounts: safeModel?.classCounts ?? {},
      modelFeatures: featureMap
    }
  }
}

const evaluateEdgeAwareShadowGuard = ({ ruleDecision, baseNoTrade, predictedNoTrade, cfg }) => {
  const safeCfg = cfg?.edgeAwareShadow ?? {}
  if (safeCfg?.enabled !== true || predictedNoTrade !== true || baseNoTrade === true) {
    return {
      eligible: false,
      checks: {
        enabled: safeCfg?.enabled === true
      }
    }
  }
  const signals = ruleDecision?.signals ?? {}
  const ruleDayType = normalizeDayType(ruleDecision?.dayType)
  const top1ExpectedNetRet3d = toFinite(signals?.top1ExpectedNetRet3d, 0)
  const strongCandidateShare = clamp01(signals?.strongCandidateShare ?? 0)
  const avgSlippageRisk = Math.max(0, toFinite(signals?.avgSlippageRisk, 0))
  const avgFillProb = clamp01(signals?.avgFillProb ?? 0)
  const top1Margin = Math.max(0, toFinite(signals?.top1Margin, 0))
  const checks = {
    enabled: true,
    ruleDayType,
    top1ExpectedNetRet3d,
    strongCandidateShare,
    avgSlippageRisk,
    avgFillProb,
    top1Margin,
    thresholds: {
      minTop1ExpectedNetRet3d: safeCfg.minTop1ExpectedNetRet3d,
      minStrongCandidateShare: safeCfg.minStrongCandidateShare,
      maxAvgSlippageRisk: safeCfg.maxAvgSlippageRisk,
      minAvgFillProb: safeCfg.minAvgFillProb,
      minTop1Margin: safeCfg.minTop1Margin,
      allowedRuleDayTypes: safeCfg.allowedRuleDayTypes
    }
  }
  const allowedRuleType =
    Array.isArray(safeCfg.allowedRuleDayTypes) &&
    safeCfg.allowedRuleDayTypes.includes(ruleDayType)
  const eligible =
    allowedRuleType &&
    top1ExpectedNetRet3d >= Number(safeCfg.minTop1ExpectedNetRet3d ?? 0) &&
    strongCandidateShare >= Number(safeCfg.minStrongCandidateShare ?? 0) &&
    avgSlippageRisk <= Number(safeCfg.maxAvgSlippageRisk ?? 1) &&
    avgFillProb >= Number(safeCfg.minAvgFillProb ?? 0) &&
    top1Margin >= Number(safeCfg.minTop1Margin ?? 0)
  return {
    eligible,
    checks: {
      ...checks,
      allowedRuleType
    }
  }
}

const evaluateEdgeTradeEscapeGuard = ({
  ruleDecision,
  predictedDayType,
  predictedNoTrade,
  baseNoTrade,
  modelConfident,
  cfg
}) => {
  const safeCfg = cfg?.edgeTradeEscape ?? {}
  if (
    safeCfg?.enabled !== true ||
    predictedNoTrade !== true ||
    baseNoTrade !== true ||
    modelConfident !== true
  ) {
    return {
      eligible: false,
      checks: {
        enabled: safeCfg?.enabled === true
      }
    }
  }
  const signals = ruleDecision?.signals ?? {}
  const ruleDayType = normalizeDayType(ruleDecision?.dayType)
  const modelDayType = normalizeDayType(predictedDayType)
  const top1ExpectedNetRet3d = toFinite(signals?.top1ExpectedNetRet3d, 0)
  const avgSlippageRisk = Math.max(0, toFinite(signals?.avgSlippageRisk, 0))
  const avgFillProb = clamp01(signals?.avgFillProb ?? 0)
  const top1Margin = Math.max(0, toFinite(signals?.top1Margin, 0))
  const checks = {
    enabled: true,
    ruleDayType,
    predictedDayType: modelDayType,
    top1ExpectedNetRet3d,
    avgSlippageRisk,
    avgFillProb,
    top1Margin,
    thresholds: {
      minTop1ExpectedNetRet3d: safeCfg.minTop1ExpectedNetRet3d,
      maxAvgSlippageRisk: safeCfg.maxAvgSlippageRisk,
      minAvgFillProb: safeCfg.minAvgFillProb,
      minTop1Margin: safeCfg.minTop1Margin,
      allowedRuleDayTypes: safeCfg.allowedRuleDayTypes,
      allowedPredictedDayTypes: safeCfg.allowedPredictedDayTypes
    }
  }
  const allowedRuleType =
    Array.isArray(safeCfg.allowedRuleDayTypes) &&
    safeCfg.allowedRuleDayTypes.includes(ruleDayType)
  const allowedPredictedType =
    Array.isArray(safeCfg.allowedPredictedDayTypes) &&
    safeCfg.allowedPredictedDayTypes.includes(modelDayType)
  const eligible =
    allowedRuleType &&
    allowedPredictedType &&
    top1ExpectedNetRet3d >= Number(safeCfg.minTop1ExpectedNetRet3d ?? 0) &&
    avgSlippageRisk <= Number(safeCfg.maxAvgSlippageRisk ?? 1) &&
    avgFillProb >= Number(safeCfg.minAvgFillProb ?? 0) &&
    top1Margin >= Number(safeCfg.minTop1Margin ?? 0)
  return {
    eligible,
    checks: {
      ...checks,
      allowedRuleType,
      allowedPredictedType
    }
  }
}

const applyEdgeTradeEscapePolicyOverrides = ({ policy, cfg }) => {
  const basePolicy = policy && typeof policy === "object" ? policy : {}
  const overrides = cfg?.policyOverrides ?? {}
  const next = {
    ...basePolicy
  }
  next.noTrade = overrides?.noTrade === true
  for (const key of [
    "minFinalScoreDelta",
    "minExpectedNetRet3dDelta",
    "minScoreMarginMultiplier",
    "tauExecMultiplier",
    "tauFpMultiplier"
  ]) {
    if (overrides?.[key] === null || overrides?.[key] === undefined) continue
    next[key] = Number(overrides[key])
  }
  if (overrides?.maxPicksPerDay === 1 || overrides?.maxPicksPerDay === 2) {
    next.maxPicksPerDay = overrides.maxPicksPerDay
  }
  for (const key of [
    "maxExecutedPicks",
    "maxFragileExecuted",
    "maxLowLiquidityExecuted",
    "maxExecutionHostileExecuted",
    "maxSameRouteBucket",
    "maxSameRegimeTag",
    "maxSamePrototypeFamily"
  ]) {
    if (overrides?.[key] === null || overrides?.[key] === undefined) continue
    next[key] = toNonNegativeIntOrNull(overrides[key], basePolicy?.[key] ?? null)
  }
  return next
}

export const applyLearnedDayTypeOverride = ({
  ruleDecision,
  modelDecision,
  cfg,
  policies
}) => {
  const safeCfg = resolveDayTypeModelConfig(cfg)
  const base = ruleDecision && typeof ruleDecision === "object" ? ruleDecision : null
  const prediction = modelDecision && typeof modelDecision === "object" ? modelDecision : null
  if (!base) {
    return {
      ...(prediction && prediction?.predictedDayType
        ? {
            dayType: normalizeDayType(prediction.predictedDayType),
            policy: policies?.[normalizeDayType(prediction.predictedDayType)] ?? {},
            noTrade: (policies?.[normalizeDayType(prediction.predictedDayType)]?.noTrade) === true
          }
        : {}),
      modelDecision: prediction ?? null,
      modelMeta: {
        available: prediction?.available === true,
        confident: false,
        confidenceBucket: prediction?.available === true ? "MODEL_ONLY" : "UNAVAILABLE",
        overrideMode: String(safeCfg?.overrideMode ?? "prefer_model"),
        noTradeOverrideMode: String(safeCfg?.noTradeOverrideMode ?? "allow"),
        applyMode: "MODEL_ONLY",
        shadowApplied: false,
        shadowReason: null,
        shadowNoTrade: false,
        predictedDayType: prediction?.predictedDayType
          ? normalizeDayType(prediction.predictedDayType)
          : null,
        predictedNoTrade:
          (policies?.[normalizeDayType(prediction?.predictedDayType)]?.noTrade) === true,
        ruleDayType: null,
        ruleNoTrade: false,
        disagreeWithRule: false,
        edgeTradeEscapeApplied: false,
        hardNoTradeApplied:
          (policies?.[normalizeDayType(prediction?.predictedDayType)]?.noTrade) === true
      },
      policySource: "MODEL_ONLY"
    }
  }
  const confidence = Number(prediction?.confidence)
  const confidenceGap = Number(prediction?.confidenceGap)
  const modelAvailable =
    safeCfg.enabled === true &&
    prediction?.available === true &&
    String(prediction?.predictedDayType ?? "").trim().length > 0
  const modelConfident =
    modelAvailable &&
    Number.isFinite(confidence) &&
    confidence >= Number(safeCfg?.minConfidence ?? 0) &&
    Number.isFinite(confidenceGap) &&
    confidenceGap >= Number(safeCfg?.minConfidenceGap ?? 0)
  const confidenceBucket =
    modelAvailable !== true
      ? "UNAVAILABLE"
      : modelConfident
        ? "CONFIDENT"
        : "LOW_CONFIDENCE"
  const ruleDayType = normalizeDayType(base?.dayType)
  const baseMeta = {
    available: modelAvailable,
    confident: modelConfident,
    confidenceBucket,
    overrideMode: String(safeCfg?.overrideMode ?? "prefer_model"),
    noTradeOverrideMode: String(safeCfg?.noTradeOverrideMode ?? "allow"),
    applyMode: "RULE_ONLY",
    shadowApplied: false,
    shadowReason: null,
    shadowNoTrade: false,
    predictedDayType: modelAvailable ? normalizeDayType(prediction?.predictedDayType) : null,
    predictedNoTrade: false,
    ruleDayType,
    ruleNoTrade: base?.noTrade === true,
    disagreeWithRule: false,
    edgeTradeEscapeApplied: false,
    hardNoTradeApplied: false
  }
  if (!modelAvailable || safeCfg?.preferModelWhenAvailable !== true) {
    const predictedDayType = prediction?.predictedDayType
      ? normalizeDayType(prediction.predictedDayType)
      : null
    const predictedNoTrade =
      predictedDayType
        ? (policies?.[predictedDayType]?.noTrade) === true
        : false
    return {
      ...base,
      modelDecision: prediction ?? null,
      modelMeta: {
        ...baseMeta,
        predictedDayType,
        predictedNoTrade,
        disagreeWithRule: predictedDayType ? predictedDayType !== ruleDayType : false,
        applyMode: safeCfg?.preferModelWhenAvailable !== true ? "RULE_PREFERRED" : "MODEL_UNAVAILABLE"
      },
      policySource:
        safeCfg?.preferModelWhenAvailable !== true
          ? "RULE_PREFERRED"
          : prediction?.available === true
            ? "RULE_FALLBACK_MODEL_UNAVAILABLE"
            : "RULE"
    }
  }
  const predictedDayType = normalizeDayType(prediction?.predictedDayType)
  const rawTargetPolicy = policies?.[predictedDayType] ?? base?.policy ?? {}
  const rawPredictedNoTrade = rawTargetPolicy?.noTrade === true
  const disagreeWithRule = predictedDayType !== ruleDayType
  const edgeAwareShadowGuard = evaluateEdgeAwareShadowGuard({
    ruleDecision: base,
    baseNoTrade: base?.noTrade === true,
    predictedNoTrade: rawPredictedNoTrade,
    cfg: safeCfg
  })
  const edgeTradeEscapeGuard = evaluateEdgeTradeEscapeGuard({
    ruleDecision: base,
    predictedDayType,
    predictedNoTrade: rawPredictedNoTrade,
    baseNoTrade: base?.noTrade === true,
    modelConfident,
    cfg: safeCfg
  })
  const edgeTradeEscapeApplied = edgeTradeEscapeGuard?.eligible === true
  const targetPolicy = edgeTradeEscapeApplied
    ? applyEdgeTradeEscapePolicyOverrides({
      policy: rawTargetPolicy,
      cfg: safeCfg?.edgeTradeEscape
    })
    : rawTargetPolicy
  const predictedNoTrade = targetPolicy?.noTrade === true
  const overrideMode = String(safeCfg?.overrideMode ?? "prefer_model")
  const noTradeOverrideMode = String(safeCfg?.noTradeOverrideMode ?? "allow")
  const overrideAllowedByMode =
    overrideMode === "prefer_model" ||
    (overrideMode === "confident_override" && modelConfident) ||
    (overrideMode === "confident_agree_only" && modelConfident && disagreeWithRule !== true)
  const noTradeOverrideBlocked =
    predictedNoTrade === true &&
    base?.noTrade !== true &&
    noTradeOverrideMode === "rule_only" &&
    safeCfg?.allowAggressiveOverride !== true
  const shadowNoTradeSuppressed = noTradeOverrideBlocked === true && edgeAwareShadowGuard?.eligible === true
  const applyModelOverride =
    overrideMode !== "rule_only" &&
    overrideAllowedByMode &&
    noTradeOverrideBlocked !== true
  const sourceTag = (() => {
    if (applyModelOverride !== true) {
      if (overrideMode === "rule_only") return "RULE_ONLY"
      if (shadowNoTradeSuppressed) return "MODEL_EDGE_RULE_PRIMARY"
      if (noTradeOverrideBlocked) return "MODEL_SHADOW_NO_TRADE_BLOCKED"
      if (modelConfident) return disagreeWithRule ? "MODEL_SHADOW_DISAGREE" : "MODEL_SHADOW_AGREE"
      return disagreeWithRule ? "MODEL_SHADOW_LOW_CONFIDENCE" : "MODEL_SHADOW_AGREE_LOW_CONFIDENCE"
    }
    if (edgeTradeEscapeApplied) {
      return predictedDayType === ruleDayType
        ? "MODEL_EDGE_TRADE_ESCAPE_AGREE"
        : "MODEL_EDGE_TRADE_ESCAPE"
    }
    return predictedDayType === ruleDayType ? "MODEL_PRIMARY_AGREE" : "MODEL_PRIMARY"
  })()
  if (applyModelOverride !== true) {
    return {
      ...base,
      shadowDayType: safeCfg?.emitShadowDecision !== false ? predictedDayType : undefined,
      shadowPolicy: safeCfg?.emitShadowDecision !== false ? targetPolicy : undefined,
      shadowNoTrade: safeCfg?.emitShadowDecision !== false ? predictedNoTrade : undefined,
      modelDecision: prediction,
      modelMeta: {
        ...baseMeta,
        predictedDayType,
        predictedNoTrade,
        disagreeWithRule,
        applyMode: "MODEL_SHADOW",
        shadowApplied: safeCfg?.emitShadowDecision !== false,
        shadowReason:
          shadowNoTradeSuppressed
            ? "TRADE_EDGE_RULE_PRIMARY"
            : noTradeOverrideBlocked
            ? "NO_TRADE_OVERRIDE_BLOCKED"
            : modelConfident
              ? (disagreeWithRule ? "DISAGREE_OVERRIDE_DISABLED" : "AGREE_RULE_PRIMARY")
              : "LOW_CONFIDENCE",
        shadowNoTrade:
          safeCfg?.emitShadowDecision !== false &&
          predictedNoTrade === true &&
          shadowNoTradeSuppressed !== true,
        edgeAwareShadowGuard: edgeAwareShadowGuard?.checks ?? null,
        edgeTradeEscapeApplied: false,
        edgeTradeEscapeGuard: edgeTradeEscapeGuard?.checks ?? null
      },
      policySource: sourceTag
    }
  }
  return {
    ...base,
    dayType: predictedDayType,
    policy: targetPolicy,
    noTrade: predictedNoTrade,
    gateReason:
      predictedNoTrade === true
        ? "DAY_TYPE_MODEL_NO_TRADE"
        : null,
    reasonCodes: Array.from(
      new Set([
        ...(Array.isArray(base?.reasonCodes) ? base.reasonCodes : []),
        predictedDayType === ruleDayType ? "DAY_TYPE_MODEL_PRIMARY_AGREE" : "DAY_TYPE_MODEL_PRIMARY",
        modelConfident ? "DAY_TYPE_MODEL_CONFIDENT" : "DAY_TYPE_MODEL_LOW_CONFIDENCE",
        edgeTradeEscapeApplied ? "DAY_TYPE_MODEL_EDGE_TRADE_ESCAPE" : null
      ].filter(Boolean)),
    ),
    modelDecision: prediction,
    modelMeta: {
      ...baseMeta,
      predictedDayType,
      predictedNoTrade,
      disagreeWithRule,
      applyMode: predictedDayType === ruleDayType ? "MODEL_OVERRIDE_AGREE" : "MODEL_OVERRIDE",
      edgeTradeEscapeApplied,
      edgeTradeEscapeGuard: edgeTradeEscapeGuard?.checks ?? null,
      hardNoTradeApplied: predictedNoTrade === true && base?.noTrade !== true
    },
    policySource: sourceTag
  }
}

export const buildDayTypeDatasetRow = ({
  decisionDateKey,
  split,
  ruleDecision,
  finalDecision,
  candidateHit = false,
  selectedHit = false,
  executedHit = false,
  top1Blocked = false,
  executedNetRet = null,
  executedOutcomeSource = null,
  modelFeaturesOverride = null,
  trainingLabelOverride = null,
  trainingLabelSourceOverride = null,
  trainingLabelScoresOverride = null
}) => {
  const ruleDayType = normalizeDayType(ruleDecision?.dayType)
  const finalDayType = normalizeDayType(finalDecision?.dayType ?? ruleDecision?.dayType)
  const finalNoTrade = finalDecision?.noTrade === true
  const outcome = deriveOutcomeDrivenLabel({
    ruleDecision,
    finalDecision,
    candidateHit,
    selectedHit,
    executedHit,
    top1Blocked,
    executedNetRet
  })
  const trainingLabel = normalizeDayType(trainingLabelOverride ?? outcome?.label)
  const trainingLabelSource = String(
    trainingLabelSourceOverride ?? outcome?.source ?? "OUTCOME_BALANCED_FALLBACK",
  )
  const trainingLabelScores =
    trainingLabelScoresOverride && typeof trainingLabelScoresOverride === "object"
      ? trainingLabelScoresOverride
      : outcome?.scoreByLabel && typeof outcome.scoreByLabel === "object"
        ? outcome.scoreByLabel
        : null
  return {
    decisionDateKey: String(decisionDateKey ?? ""),
    split: String(split ?? "ALL").trim().toUpperCase() || "ALL",
    ruleDayType,
    ruleNoTrade: ruleDecision?.noTrade === true,
    finalDayType,
    finalNoTrade,
    candidateHit: candidateHit === true,
    selectedHit: selectedHit === true,
    executedHit: executedHit === true,
    executedNetRet: Number.isFinite(Number(executedNetRet)) ? Number(executedNetRet) : null,
    top1Blocked: top1Blocked === true,
    trainingLabel,
    trainingLabelSource,
    trainingLabelScores,
    executedOutcomeSource: executedOutcomeSource ? String(executedOutcomeSource) : null,
    modelFeatures:
      modelFeaturesOverride && typeof modelFeaturesOverride === "object"
        ? modelFeaturesOverride
        : extractDayTypeModelFeatures({
            signals: ruleDecision?.signals ?? {}
          })
  }
}
