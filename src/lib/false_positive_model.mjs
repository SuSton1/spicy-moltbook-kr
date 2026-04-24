const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

const clampSigned = (value, maxAbs = 1) => {
  const abs = Math.max(1e-6, Number(maxAbs) || 1)
  return clamp(Number(value) || 0, -abs, abs) / abs
}

const sigmoid = (value) => {
  const x = clamp(Number(value) || 0, -30, 30)
  return 1 / (1 + Math.exp(-x))
}

const toPositiveInt = (value, fallback) => {
  const n = Math.floor(Number(value))
  if (Number.isInteger(n) && n > 0) return n
  return Math.max(1, Math.floor(Number(fallback) || 1))
}

const normalizeDecisionMode = (value) => {
  const text = String(value ?? "model_only").trim().toLowerCase()
  if (text === "fallback_only") return "fallback_only"
  if (text === "blend_with_fallback") return "blend_with_fallback"
  return "model_only"
}

const normalizeTrainingSourceMode = (value) => {
  const text = String(value ?? "all_replay").trim().toLowerCase()
  if (text === "executed_only") return "executed_only"
  return "all_replay"
}

const normalizeTrainingLabelMode = (value) => {
  const text = String(value ?? "binary_live_lockbox_failure").trim().toLowerCase()
  if (text === "strict_outcome_band") return "strict_outcome_band"
  return "binary_live_lockbox_failure"
}

const normalizeRealizedOutcomeBucket = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  if (
    [
      "TARGET",
      "STOP",
      "TIMEOUT_POSITIVE",
      "TIMEOUT_NEGATIVE",
      "TIMEOUT_FLAT",
      "UNKNOWN"
    ].includes(text)
  ) {
    return text
  }
  return "UNKNOWN"
}

export const resolveRealizedOutcomeBucket = ({
  realizedExitReason,
  realizedNetRet,
  realizedHitTarget,
  realizedHitStop
} = {}) => {
  const exitReason = String(realizedExitReason ?? "").trim().toUpperCase()
  const netRet = Number(realizedNetRet)
  if (realizedHitTarget === true || exitReason === "TARGET") return "TARGET"
  if (
    realizedHitStop === true ||
    exitReason === "STOP" ||
    exitReason === "BOTH_HIT_STOP_FIRST"
  ) {
    return "STOP"
  }
  if (Number.isFinite(netRet)) {
    if (netRet > 0) return "TIMEOUT_POSITIVE"
    if (netRet < 0) return "TIMEOUT_NEGATIVE"
    return "TIMEOUT_FLAT"
  }
  return "UNKNOWN"
}

const buildEmptyOutcomeCounts = () => ({
  TARGET: 0,
  STOP: 0,
  TIMEOUT_POSITIVE: 0,
  TIMEOUT_NEGATIVE: 0,
  TIMEOUT_FLAT: 0,
  UNKNOWN: 0
})

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

const hasBinaryLabel = (value) =>
  value === 0 || value === 1 || value === "0" || value === "1"

const resolveLabelFalsePositive = ({ row, labelFalsePositive, liveLockboxFailure }) => {
  if (hasBinaryLabel(labelFalsePositive)) {
    return Number(labelFalsePositive) === 1 ? 1 : 0
  }
  if (liveLockboxFailure === true) return 1
  if (liveLockboxFailure === false) return 0
  return null
}

const resolveLabelSource = ({ labelSource, liveLockboxFailure }) => {
  const text = String(labelSource ?? "").trim().toUpperCase()
  if (text) return text
  if (liveLockboxFailure === true || liveLockboxFailure === false) {
    return "LIVE_LOCKBOX_FAILURE"
  }
  return "UNLABELED"
}

export const FALSE_POSITIVE_MODEL_FEATURE_KEYS = [
  "marginScaled",
  "expectedRetScaled",
  "qualityScore",
  "antiScore",
  "pHit",
  "pFill",
  "pStop",
  "confidence",
  "pHitMinusPStop",
  "pFillMinusPStop",
  "slippageRiskScaled",
  "liquidityPenalty",
  "dataFreshnessScaled",
  "spreadProxyScaled",
  "regimeVolatilityScaled",
  "regimeLiquidityPenalty",
  "rankPct",
  "finalScoreZWithinDay",
  "marginZWithinDay",
  "agreementScore",
  "executionScore",
  "rankerScore",
  "preExecutionPassedFlag",
  "budgetRejectedFlag",
  "metaTradeFlag",
  "dayTypeNoTradeFlag",
  "dayTrend",
  "dayMeanReversion",
  "dayGapFadeRisk",
  "dayNoise",
  "dayExecutionHostile",
  "dayThinLiquidityTrap",
  "dayNoTrade"
]

export const resolveFalsePositiveModelConfig = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled === true,
    minSamplesForInference: toPositiveInt(cfg?.minSamplesForInference, 24),
    minTrainRows: toPositiveInt(cfg?.minTrainRows, 40),
    minPositiveRows: toPositiveInt(cfg?.minPositiveRows, 6),
    minNegativeRows: toPositiveInt(cfg?.minNegativeRows, 12),
    onlineLearningRate: Math.max(1e-6, Number(cfg?.onlineLearningRate ?? 0.08) || 0.08),
    trainEpochs: toPositiveInt(cfg?.trainEpochs, 6),
    l2: Math.max(0, Number(cfg?.l2 ?? 0.002) || 0),
    decisionMode: normalizeDecisionMode(cfg?.decisionMode),
    modelBlendWeight: clamp01(cfg?.modelBlendWeight ?? 0.5),
    trainingSourceMode: normalizeTrainingSourceMode(cfg?.trainingSourceMode),
    trainingLabelMode: normalizeTrainingLabelMode(cfg?.trainingLabelMode),
    successNetRetThreshold: Number.isFinite(Number(cfg?.successNetRetThreshold))
      ? Number(cfg.successNetRetThreshold)
      : 0.01,
    failureNetRetThreshold: Number.isFinite(Number(cfg?.failureNetRetThreshold))
      ? Number(cfg.failureNetRetThreshold)
      : -0.01,
    positiveClassWeight: Math.max(1e-6, Number(cfg?.positiveClassWeight ?? 1) || 1),
    negativeClassWeight: Math.max(1e-6, Number(cfg?.negativeClassWeight ?? 1) || 1)
  }
}

export const resolveFalsePositiveTrainingLabel = ({
  labelFalsePositive,
  liveLockboxFailure,
  realizedExitReason,
  realizedNetRet,
  cfg
} = {}) => {
  if (hasBinaryLabel(labelFalsePositive)) {
    return Number(labelFalsePositive) === 1 ? 1 : 0
  }
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  if (safeCfg.trainingLabelMode === "strict_outcome_band") {
    const exitReason = String(realizedExitReason ?? "").trim().toUpperCase()
    const netRet = Number(realizedNetRet)
    if (exitReason === "STOP") return 1
    if (exitReason === "TARGET") return 0
    if (Number.isFinite(netRet)) {
      if (netRet <= Number(safeCfg.failureNetRetThreshold ?? -0.01)) return 1
      if (netRet >= Number(safeCfg.successNetRetThreshold ?? 0.01)) return 0
    }
    return null
  }
  if (liveLockboxFailure === true) return 1
  if (liveLockboxFailure === false) return 0
  return null
}

export const shouldUseFalsePositiveLearningRow = ({ row, cfg } = {}) => {
  const sourceMode = normalizeTrainingSourceMode(cfg?.trainingSourceMode)
  if (sourceMode !== "executed_only") return true
  const replayKind = String(row?.replayKind ?? "").trim().toUpperCase()
  if (replayKind.startsWith("EXECUTED_")) return true
  if (row?.executed === true || row?.executedByPolicy === true) return true
  return String(row?.executionDecision ?? "").trim().toUpperCase() === "TRADE"
}

const buildEmptyWeights = (featureKeys = FALSE_POSITIVE_MODEL_FEATURE_KEYS) =>
  Object.fromEntries((Array.isArray(featureKeys) ? featureKeys : FALSE_POSITIVE_MODEL_FEATURE_KEYS).map((key) => [key, 0]))

export const createEmptyFalsePositiveModel = ({ cfg } = {}) => {
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  return {
    version: "v3",
    kind: "online_logreg",
    featureKeys: FALSE_POSITIVE_MODEL_FEATURE_KEYS.slice(),
    bias: 0,
    weights: buildEmptyWeights(),
    sampleCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    outcomeCounts: buildEmptyOutcomeCounts(),
    config: safeCfg
  }
}

export const hydrateFalsePositiveModel = ({ raw, cfg } = {}) => {
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  const source = raw && typeof raw === "object" ? raw : {}
  const base = createEmptyFalsePositiveModel({ cfg: safeCfg })
  const mergedFeatureKeys = Array.from(new Set([
    ...base.featureKeys,
    ...(
      Array.isArray(source?.featureKeys)
        ? source.featureKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
        : []
    )
  ]))
  return enforceFalsePositiveWeightSignPriors({
    ...base,
    version: String(source?.version ?? base.version),
    kind: String(source?.kind ?? base.kind),
    featureKeys: mergedFeatureKeys,
    bias: Number.isFinite(Number(source?.bias)) ? Number(source.bias) : base.bias,
    weights: {
      ...buildEmptyWeights(mergedFeatureKeys),
      ...(source?.weights && typeof source.weights === "object" ? source.weights : {})
    },
    sampleCount: Math.max(0, Number(source?.sampleCount ?? 0) || 0),
    positiveCount: Math.max(0, Number(source?.positiveCount ?? 0) || 0),
    negativeCount: Math.max(0, Number(source?.negativeCount ?? 0) || 0),
    outcomeCounts: {
      ...buildEmptyOutcomeCounts(),
      ...(source?.outcomeCounts && typeof source.outcomeCounts === "object"
        ? Object.fromEntries(
            Object.entries(source.outcomeCounts).map(([key, value]) => [
              normalizeRealizedOutcomeBucket(key),
              Math.max(0, Number(value ?? 0) || 0),
            ]),
          )
        : {}),
    },
    config: {
      ...safeCfg,
      ...(source?.config && typeof source.config === "object" ? source.config : {})
    }
  })
}

const enforceFalsePositiveWeightSignPriors = (model) => {
  const next = model && typeof model === "object" ? model : createEmptyFalsePositiveModel()
  const weights = next?.weights && typeof next.weights === "object" ? { ...next.weights } : {}
  for (const key of Object.keys(weights)) {
    weights[key] = Number(weights[key] ?? 0) || 0
  }
  return {
    ...next,
    weights
  }
}

export const resolveFalsePositiveModelArtifact = ({ policyState, stepDSummary, cfg } = {}) => {
  const raw =
    policyState?.falsePositiveModel ??
    stepDSummary?.falsePositiveModel ??
    null
  return hydrateFalsePositiveModel({ raw, cfg })
}

export const extractFalsePositiveModelFeatures = ({
  row,
  dayTypeDecision = null
}) => {
  const dayType = normalizeDayType(dayTypeDecision?.dayType)
  const calibrated = row?.calibrated && typeof row.calibrated === "object" ? row.calibrated : {}
  const pHit = clamp01(calibrated?.pHitCalibrated ?? row?.pHitCalibrated ?? 0)
  const pFill = clamp01(calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0)
  const pStop = clamp01(calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0)
  const confidence = clamp01(calibrated?.confidence ?? row?.confidence ?? 0)
  const avgTradingValue20dKrw = Math.max(0, Number(row?.avgTradingValue20dKrw ?? 0) || 0)
  const regimeLiquidityProxy = clamp01(row?.regimeLiquidityProxy ?? 0)
  const agreementScore = clamp01(row?.agreementScore ?? 0)
  const executionScore = clamp01(row?.executionScore ?? 0)
  const rankerScore = clamp01(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0)
  const budgetRejectedFlag =
    String(row?.budgetDecision ?? "").trim().toUpperCase() &&
    String(row?.budgetDecision ?? "").trim().toUpperCase() !== "TRADE"
      ? 1
      : 0
  return {
    marginScaled: clampSigned(
      Number(
        row?.gateScoreMargin ??
          row?.postRerankScoreMargin ??
          row?.rawScoreMargin ??
          row?.scoreMargin ??
          0,
      ),
      0.02,
    ),
    expectedRetScaled: clampSigned(row?.expectedNetRet3d ?? 0, 0.03),
    qualityScore: clamp01(row?.qualityScore ?? 0),
    antiScore: clamp01(row?.antiScore ?? 0),
    pHit,
    pFill,
    pStop,
    confidence,
    pHitMinusPStop: clampSigned(pHit - pStop, 1),
    pFillMinusPStop: clampSigned(pFill - pStop, 1),
    slippageRiskScaled: clampSigned(row?.slippageRisk ?? 0, 0.12),
    liquidityPenalty: clamp01(
      avgTradingValue20dKrw > 0
        ? (1_200_000_000 - avgTradingValue20dKrw) / 1_200_000_000
        : 1,
    ),
    dataFreshnessScaled: clampSigned(row?.dataFreshnessDays ?? 0, 10),
    spreadProxyScaled: clampSigned(row?.spreadProxyPct ?? 0, 0.08),
    regimeVolatilityScaled: clampSigned(row?.regimeVolatilityProxy ?? 0, 0.12),
    regimeLiquidityPenalty: clamp01(
      regimeLiquidityProxy > 0 ? 1 - regimeLiquidityProxy : 1,
    ),
    rankPct: clamp01(row?.rankPct ?? 0),
    finalScoreZWithinDay: clampSigned(row?.finalScoreZWithinDay ?? 0, 3),
    marginZWithinDay: clampSigned(row?.marginZWithinDay ?? 0, 3),
    agreementScore,
    executionScore,
    rankerScore,
    preExecutionPassedFlag:
      String(row?.executionDecisionPreFalsePositive ?? "").trim().toUpperCase() === "TRADE" ? 1 : 0,
    budgetRejectedFlag,
    metaTradeFlag:
      String(row?.metaDecision ?? "").trim().toUpperCase() === "TRADE" ? 1 : 0,
    dayTypeNoTradeFlag: dayTypeDecision?.noTrade === true || row?.dayTypeNoTrade === true ? 1 : 0,
    dayTrend: dayType === "TREND" ? 1 : 0,
    dayMeanReversion: dayType === "MEAN_REVERSION" ? 1 : 0,
    dayGapFadeRisk: dayType === "GAP_FADE_RISK" ? 1 : 0,
    dayNoise: dayType === "NOISE" ? 1 : 0,
    dayExecutionHostile: dayType === "EXECUTION_HOSTILE" ? 1 : 0,
    dayThinLiquidityTrap: dayType === "THIN_LIQUIDITY_TRAP" ? 1 : 0,
    dayNoTrade: dayType === "NO_TRADE" ? 1 : 0
  }
}

const computeLogit = ({ featureMap, model }) => {
  const safeModel = model && typeof model === "object" ? model : createEmptyFalsePositiveModel()
  const featureKeys = Array.isArray(safeModel?.featureKeys) && safeModel.featureKeys.length > 0
    ? safeModel.featureKeys
    : FALSE_POSITIVE_MODEL_FEATURE_KEYS
  let logit = Number(safeModel?.bias ?? 0) || 0
  for (const key of featureKeys) {
    logit += (Number(safeModel?.weights?.[key] ?? 0) || 0) * (Number(featureMap?.[key] ?? 0) || 0)
  }
  return logit
}

export const scoreFalsePositiveModel = ({
  row,
  model,
  cfg,
  dayTypeDecision = null
}) => {
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  const safeModel = hydrateFalsePositiveModel({ raw: model, cfg: safeCfg })
  if (safeCfg.enabled !== true) {
    return {
      enabled: false,
      available: false,
      risk: null,
      logit: null,
      checks: {}
    }
  }
  const sampleCount = Math.max(0, Number(safeModel?.sampleCount ?? 0) || 0)
  const positiveCount = Math.max(0, Number(safeModel?.positiveCount ?? 0) || 0)
  const negativeCount = Math.max(0, Number(safeModel?.negativeCount ?? 0) || 0)
  const available =
    sampleCount >= Number(safeCfg?.minSamplesForInference ?? 0) &&
    positiveCount >= Number(safeCfg?.minPositiveRows ?? 0) &&
    negativeCount >= Number(safeCfg?.minNegativeRows ?? 0)
  const featureMap = extractFalsePositiveModelFeatures({
    row,
    dayTypeDecision
  })
  if (!available) {
    return {
      enabled: true,
      available: false,
      risk: null,
      logit: null,
      checks: {
        sampleCount,
        positiveCount,
        negativeCount,
        featureMap,
        decisionMode: safeCfg?.decisionMode ?? "model_only"
      }
    }
  }
  const logit = computeLogit({ featureMap, model: safeModel })
  return {
    enabled: true,
    available: true,
    risk: clamp01(sigmoid(logit)),
    logit,
    checks: {
      sampleCount,
      positiveCount,
      negativeCount,
      featureMap,
      decisionMode: safeCfg?.decisionMode ?? "model_only"
    }
  }
}

const cloneModel = (model, cfg) => hydrateFalsePositiveModel({ raw: model, cfg })

export const updateFalsePositiveModelOnline = ({
  model,
  featureMap,
  label,
  sampleWeight = 1,
  outcomeBucket = null,
  cfg
}) => {
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  const next = cloneModel(model, safeCfg)
  const y = label === 1 ? 1 : 0
  const classWeight =
    y === 1
      ? Math.max(1e-6, Number(safeCfg?.positiveClassWeight ?? 1) || 1)
      : Math.max(1e-6, Number(safeCfg?.negativeClassWeight ?? 1) || 1)
  const weight = Math.max(0, Number(sampleWeight ?? 1) || 0) * classWeight
  if (weight <= 0) return next
  const logit = computeLogit({ featureMap, model: next })
  const pred = sigmoid(logit)
  const error = (pred - y) * weight
  const lr = Number(safeCfg?.onlineLearningRate ?? 0.08) || 0.08
  const l2 = Math.max(0, Number(safeCfg?.l2 ?? 0) || 0)
  for (const key of next.featureKeys) {
    const x = Number(featureMap?.[key] ?? 0) || 0
    const prev = Number(next.weights?.[key] ?? 0) || 0
    next.weights[key] = prev - lr * (error * x + l2 * prev)
  }
  next.bias = (Number(next.bias ?? 0) || 0) - lr * error
  next.sampleCount = Math.max(0, Number(next.sampleCount ?? 0) + weight)
  if (y === 1) {
    next.positiveCount = Math.max(0, Number(next.positiveCount ?? 0) + weight)
  } else {
    next.negativeCount = Math.max(0, Number(next.negativeCount ?? 0) + weight)
  }
  const safeOutcomeBucket = normalizeRealizedOutcomeBucket(outcomeBucket)
  next.outcomeCounts = {
    ...buildEmptyOutcomeCounts(),
    ...(next?.outcomeCounts && typeof next.outcomeCounts === "object" ? next.outcomeCounts : {}),
  }
  next.outcomeCounts[safeOutcomeBucket] =
    Math.max(0, Number(next.outcomeCounts?.[safeOutcomeBucket] ?? 0) || 0) + weight
  return enforceFalsePositiveWeightSignPriors(next)
}

export const trainFalsePositiveModelFromDataset = ({
  rows,
  cfg,
  seedModel = null
}) => {
  const safeCfg = resolveFalsePositiveModelConfig(cfg)
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => hasBinaryLabel(row?.labelFalsePositive))
  const positiveCount = list.reduce(
    (acc, row) =>
      acc + (Number(row?.labelFalsePositive) === 1 ? Math.max(0, Number(row?.sampleWeight ?? 1) || 0) : 0),
    0,
  )
  const negativeCount = list.reduce(
    (acc, row) =>
      acc + (Number(row?.labelFalsePositive) === 0 ? Math.max(0, Number(row?.sampleWeight ?? 1) || 0) : 0),
    0,
  )
  if (
    safeCfg.enabled !== true ||
    list.length < Number(safeCfg?.minTrainRows ?? 0) ||
    positiveCount < Number(safeCfg?.minPositiveRows ?? 0) ||
    negativeCount < Number(safeCfg?.minNegativeRows ?? 0)
  ) {
    return hydrateFalsePositiveModel({ raw: seedModel, cfg: safeCfg })
  }
  let model = createEmptyFalsePositiveModel({ cfg: safeCfg })
  for (let epoch = 0; epoch < Number(safeCfg?.trainEpochs ?? 1); epoch += 1) {
    for (const row of list) {
      model = updateFalsePositiveModelOnline({
        model,
        featureMap: row?.modelFeatures ?? {},
        label: Number(row?.labelFalsePositive) === 1 ? 1 : 0,
        sampleWeight: row?.sampleWeight ?? 1,
        outcomeBucket: row?.realizedOutcomeBucket ?? null,
        cfg: safeCfg
      })
    }
  }
  if (seedModel) {
    const seed = hydrateFalsePositiveModel({ raw: seedModel, cfg: safeCfg })
    model = {
      ...model,
      previousSampleCount: Number(seed?.sampleCount ?? 0) || 0
    }
  }
  return model
}

export const buildFalsePositiveDatasetRow = ({
  decisionDateKey,
  split,
  row,
  dayTypeDecision = null,
  cfg = null,
  labelFalsePositive = null,
  labelSource = null,
  replayKind = null,
  sampleWeight = null,
  failureMode = null,
  liveLockboxFailure = null,
  shouldHaveTraded = null,
  realizedNetRet = null,
  realizedExitReason = null,
  realizedHitTarget = null,
  realizedHitStop = null
}) => {
  const modelFeatures = extractFalsePositiveModelFeatures({
    row,
    dayTypeDecision
  })
  const resolvedLabel = resolveFalsePositiveTrainingLabel({
    labelFalsePositive,
    liveLockboxFailure,
    realizedExitReason,
    realizedNetRet,
    cfg
  })
  const resolvedSampleWeight = Math.max(0, Number(sampleWeight ?? 1) || 0)
  const successInWindow = row?.successInWindow === true
  const executed = String(row?.executionDecision ?? "").trim().toUpperCase() === "TRADE"
  const realizedOutcomeBucket = resolveRealizedOutcomeBucket({
    realizedExitReason,
    realizedNetRet,
    realizedHitTarget,
    realizedHitStop
  })
  return {
    decisionDateKey: String(decisionDateKey ?? ""),
    split: String(split ?? "ALL").trim().toUpperCase() || "ALL",
    symbol: String(row?.symbol ?? ""),
    routeBucket: String(row?.routeBucket ?? "__DEFAULT__"),
    regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
    prototypeFamilyKey: String(
      row?.prototypeFamilyKey ??
        row?.matchedPrototypeClusterId ??
        row?.matchedPrototypeId ??
        "__NONE__",
    ),
    dayType: normalizeDayType(dayTypeDecision?.dayType),
    dayTypeNoTrade: dayTypeDecision?.noTrade === true,
    dayTypePolicySource: dayTypeDecision?.policySource ?? null,
    successInWindow,
    liveLockboxFailure:
      liveLockboxFailure === true ? true : liveLockboxFailure === false ? false : null,
    labelFalsePositive: resolvedLabel,
    labelSource: resolveLabelSource({ labelSource, liveLockboxFailure }),
    replayKind: replayKind ? String(replayKind) : null,
    sampleWeight: resolvedSampleWeight,
    failureMode: failureMode ? String(failureMode) : null,
    shouldHaveTraded: shouldHaveTraded === true,
    realizedNetRet: Number.isFinite(Number(realizedNetRet)) ? Number(realizedNetRet) : null,
    realizedExitReason: realizedExitReason ? String(realizedExitReason) : null,
    realizedHitTarget: realizedHitTarget === true,
    realizedHitStop: realizedHitStop === true,
    realizedOutcomeBucket,
    metaDecision: row?.metaDecision ?? null,
    executionDecisionPreFalsePositive: row?.executionDecisionPreFalsePositive ?? null,
    executionDecision: row?.executionDecision ?? null,
    executed,
    preExecutionPassed:
      String(row?.executionDecisionPreFalsePositive ?? "").trim().toUpperCase() === "TRADE",
    falsePositiveDecision: row?.falsePositiveDecision ?? null,
    falsePositiveReason: row?.falsePositiveReason ?? null,
    falsePositiveRisk: Number.isFinite(Number(row?.falsePositiveRisk))
      ? Number(row.falsePositiveRisk)
      : null,
    budgetDecision: row?.budgetDecision ?? null,
    budgetReason: row?.budgetReason ?? null,
    agreementDecision: row?.agreementDecision ?? null,
    agreementReason: row?.agreementReason ?? null,
    agreementScore: Number.isFinite(Number(row?.agreementScore))
      ? Number(row.agreementScore)
      : null,
    modelFeatures
  }
}
