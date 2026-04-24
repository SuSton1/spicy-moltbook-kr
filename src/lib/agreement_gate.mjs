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

const toFinite = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number(fallback) || 0
}

const toPositiveInt = (value, fallback) => {
  const n = Math.floor(toFinite(value, fallback))
  return n > 0 ? n : Math.max(1, Math.floor(Number(fallback) || 1))
}

const hasBinaryLabel = (value) =>
  value === 0 || value === 1 || value === "0" || value === "1"

export const AGREEMENT_VIEW_KEYS = [
  "base",
  "antiNoise",
  "conservative",
  "executionAware"
]

export const AGREEMENT_MODEL_FEATURE_KEYS = [
  "finalScore",
  "expectedRet",
  "quality",
  "anti",
  "pHit",
  "pFill",
  "pStop",
  "confidence",
  "slippageRisk",
  "margin",
  "liquidityPenalty",
  "executionScore",
  "rankPct"
]

export const AGREEMENT_VIEW_FEATURE_KEYS = {
  base: [
    "finalScore",
    "expectedRet",
    "quality",
    "pHit",
    "confidence",
    "margin",
    "rankPct"
  ],
  antiNoise: [
    "quality",
    "anti",
    "pHit",
    "confidence",
    "slippageRisk",
    "liquidityPenalty",
    "rankPct"
  ],
  conservative: [
    "expectedRet",
    "quality",
    "pFill",
    "pStop",
    "confidence",
    "margin",
    "rankPct"
  ],
  executionAware: [
    "expectedRet",
    "pFill",
    "pStop",
    "slippageRisk",
    "margin",
    "liquidityPenalty",
    "executionScore"
  ]
}

const buildZeroWeights = (featureKeys = AGREEMENT_MODEL_FEATURE_KEYS) =>
  Object.fromEntries((Array.isArray(featureKeys) ? featureKeys : AGREEMENT_MODEL_FEATURE_KEYS).map((key) => [key, 0]))

const buildPriorWeights = (viewName) => {
  const weights = buildZeroWeights()
  if (viewName === "base") {
    weights.finalScore = 1.2
    weights.margin = 0.15
    weights.expectedRet = 0.2
  } else if (viewName === "antiNoise") {
    weights.finalScore = 0.5
    weights.quality = 0.7
    weights.pHit = 0.8
    weights.anti = -0.7
    weights.slippageRisk = -0.8
    weights.liquidityPenalty = -0.45
    weights.confidence = 0.25
  } else if (viewName === "conservative") {
    weights.expectedRet = 0.9
    weights.quality = 0.55
    weights.pFill = 0.55
    weights.pStop = -0.95
    weights.anti = -0.55
    weights.margin = 0.15
    weights.confidence = 0.2
  } else if (viewName === "executionAware") {
    weights.finalScore = 0.6
    weights.expectedRet = 0.45
    weights.pFill = 0.95
    weights.pStop = -0.75
    weights.slippageRisk = -0.95
    weights.margin = 0.55
    weights.executionScore = 0.75
    weights.liquidityPenalty = -0.35
  }
  return weights
}

const rankRows = ({ rows, scorer }) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, idx) => ({
      row,
      idx,
      score: Number(scorer(row, idx))
    }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : Number.NEGATIVE_INFINITY
      const bScore = Number.isFinite(b.score) ? b.score : Number.NEGATIVE_INFINITY
      if (bScore !== aScore) return bScore - aScore
      return a.idx - b.idx
    })

const firstSymbol = (ranked) => String(ranked?.[0]?.row?.symbol ?? "").trim() || null

const findRankOfSymbol = ({ ranked, symbol }) => {
  const target = String(symbol ?? "").trim()
  if (!target) return null
  const idx = ranked.findIndex((entry) => String(entry?.row?.symbol ?? "").trim() === target)
  return idx >= 0 ? idx + 1 : null
}

export const resolveAgreementModelConfig = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled === true,
    minSamplesForInference: toPositiveInt(cfg?.minSamplesForInference, 30),
    minTrainRows: toPositiveInt(cfg?.minTrainRows, 48),
    minPositiveRows: toPositiveInt(cfg?.minPositiveRows, 8),
    minNegativeRows: toPositiveInt(cfg?.minNegativeRows, 12),
    onlineLearningRate: Math.max(1e-6, Number(cfg?.onlineLearningRate ?? 0.05) || 0.05),
    trainEpochs: toPositiveInt(cfg?.trainEpochs, 5),
    l2: Math.max(0, Number(cfg?.l2 ?? 0.0015) || 0),
    outcomeMode: String(cfg?.outcomeMode ?? "target_stop_priority").trim().toLowerCase(),
    timeoutNetRetDeadband: Math.max(0, Number(cfg?.timeoutNetRetDeadband ?? 0.002) || 0),
    targetHitWeight: Math.max(0, Number(cfg?.targetHitWeight ?? 1.8) || 0),
    stopHitWeight: Math.max(0, Number(cfg?.stopHitWeight ?? 2.1) || 0),
    timeoutPositiveWeight: Math.max(0, Number(cfg?.timeoutPositiveWeight ?? 0.45) || 0),
    timeoutNegativeWeight: Math.max(0, Number(cfg?.timeoutNegativeWeight ?? 0.9) || 0)
  }
}

const normalizeViewName = (value) =>
  AGREEMENT_VIEW_KEYS.includes(String(value ?? "").trim()) ? String(value).trim() : "base"

const createEmptyViewModel = ({ viewName }) => {
  const priorWeights = buildPriorWeights(viewName)
  return {
    featureKeys: (AGREEMENT_VIEW_FEATURE_KEYS[normalizeViewName(viewName)] ?? AGREEMENT_MODEL_FEATURE_KEYS).slice(),
    bias: 0,
    weights: { ...priorWeights },
    sampleCount: 0,
    positiveCount: 0,
    negativeCount: 0
  }
}

export const createEmptyAgreementGateModel = ({ cfg } = {}) => {
  const safeCfg = resolveAgreementModelConfig(cfg)
  return {
    version: "v2",
    kind: "multi_view_logreg",
    featureKeys: AGREEMENT_MODEL_FEATURE_KEYS.slice(),
    config: safeCfg,
    views: Object.fromEntries(
      AGREEMENT_VIEW_KEYS.map((viewName) => [viewName, createEmptyViewModel({ viewName })]),
    )
  }
}

export const hydrateAgreementGateModel = ({ raw, cfg } = {}) => {
  const safeCfg = resolveAgreementModelConfig(cfg)
  const source = raw && typeof raw === "object" ? raw : {}
  const base = createEmptyAgreementGateModel({ cfg: safeCfg })
  const mergedFeatureKeys = Array.from(new Set([
    ...base.featureKeys,
    ...(Array.isArray(source?.featureKeys) ? source.featureKeys.map((key) => String(key ?? "").trim()).filter(Boolean) : [])
  ]))
  const views = {}
  for (const viewName of AGREEMENT_VIEW_KEYS) {
    const baseView = createEmptyViewModel({ viewName })
    const sourceView = source?.views?.[viewName] && typeof source.views[viewName] === "object"
      ? source.views[viewName]
      : {}
    views[viewName] = {
      featureKeys:
        Array.isArray(sourceView?.featureKeys) && sourceView.featureKeys.length > 0
          ? sourceView.featureKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
          : baseView.featureKeys.slice(),
      bias: Number.isFinite(Number(sourceView?.bias)) ? Number(sourceView.bias) : baseView.bias,
      weights: {
        ...buildZeroWeights(mergedFeatureKeys),
        ...baseView.weights,
        ...(sourceView?.weights && typeof sourceView.weights === "object" ? sourceView.weights : {})
      },
      sampleCount: Math.max(0, Number(sourceView?.sampleCount ?? 0) || 0),
      positiveCount: Math.max(0, Number(sourceView?.positiveCount ?? 0) || 0),
      negativeCount: Math.max(0, Number(sourceView?.negativeCount ?? 0) || 0)
    }
  }
  return {
    ...base,
    version: String(source?.version ?? base.version),
    kind: String(source?.kind ?? base.kind),
    featureKeys: mergedFeatureKeys,
    config: {
      ...safeCfg,
      ...(source?.config && typeof source.config === "object" ? source.config : {})
    },
    views
  }
}

const rowMetrics = (row) => ({
  finalScore: Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0) || 0,
  expectedRet: Number(row?.expectedNetRet3d ?? 0) || 0,
  quality: clamp01(row?.qualityScore ?? 0),
  anti: clamp01(row?.antiScore ?? 0),
  pHit: clamp01(row?.calibrated?.pHitCalibrated ?? row?.pHitCalibrated ?? 0),
  pFill: clamp01(row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? 0),
  pStop: clamp01(row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? 0),
  confidence: clamp01(row?.calibrated?.confidence ?? row?.confidence ?? 0),
  slippageRisk: Math.max(0, Number(row?.slippageRisk ?? 0) || 0),
  margin: Math.max(
    0,
    Number(row?.gateScoreMargin ?? row?.postRerankScoreMargin ?? row?.rawScoreMargin ?? row?.scoreMargin ?? 0) || 0,
  ),
  liquidityPenalty: clamp01(
    Number(row?.avgTradingValue20dKrw ?? 0) > 0
      ? (1_200_000_000 - Number(row?.avgTradingValue20dKrw ?? 0)) / 1_200_000_000
      : 1,
  ),
  executionScore: clamp01(row?.executionScore ?? 0),
  rankPct: clamp01(row?.rankPct ?? 0)
})

export const extractAgreementModelFeatures = ({ row }) => {
  const m = rowMetrics(row)
  return {
    finalScore: clampSigned(m.finalScore, 1),
    expectedRet: clampSigned(m.expectedRet, 0.03),
    quality: m.quality,
    anti: m.anti,
    pHit: m.pHit,
    pFill: m.pFill,
    pStop: m.pStop,
    confidence: m.confidence,
    slippageRisk: clampSigned(m.slippageRisk, 0.12),
    margin: clampSigned(m.margin, 0.02),
    liquidityPenalty: m.liquidityPenalty,
    executionScore: m.executionScore,
    rankPct: m.rankPct
  }
}

const maskAgreementFeaturesForView = ({ featureMap, viewName }) => {
  const base = {
    ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
    ...(featureMap && typeof featureMap === "object" ? featureMap : {})
  }
  if (viewName === "antiNoise") {
    return {
      ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
      quality: base.quality,
      anti: base.anti,
      pHit: base.pHit,
      confidence: base.confidence,
      slippageRisk: base.slippageRisk,
      liquidityPenalty: base.liquidityPenalty,
      rankPct: base.rankPct
    }
  }
  if (viewName === "conservative") {
    return {
      ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
      expectedRet: base.expectedRet,
      quality: base.quality,
      pFill: base.pFill,
      pStop: base.pStop,
      confidence: base.confidence,
      margin: base.margin,
      rankPct: base.rankPct
    }
  }
  if (viewName === "executionAware") {
    return {
      ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
      expectedRet: base.expectedRet,
      pFill: base.pFill,
      pStop: base.pStop,
      slippageRisk: base.slippageRisk,
      margin: base.margin,
      liquidityPenalty: base.liquidityPenalty,
      executionScore: base.executionScore
    }
  }
  return {
    ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
    finalScore: base.finalScore,
    expectedRet: base.expectedRet,
    quality: base.quality,
    pHit: base.pHit,
    confidence: base.confidence,
    margin: base.margin,
    rankPct: base.rankPct
  }
}

const computeViewLogit = ({ featureMap, viewModel, featureKeys }) => {
  let logit = Number(viewModel?.bias ?? 0) || 0
  const keys =
    Array.isArray(viewModel?.featureKeys) && viewModel.featureKeys.length > 0
      ? viewModel.featureKeys
      : Array.isArray(featureKeys) && featureKeys.length > 0
        ? featureKeys
        : AGREEMENT_MODEL_FEATURE_KEYS
  for (const key of keys) {
    logit += (Number(viewModel?.weights?.[key] ?? 0) || 0) * (Number(featureMap?.[key] ?? 0) || 0)
  }
  return logit
}

const heuristicViewScore = ({ row, viewName, cfg }) => {
  const m = rowMetrics(row)
  const vw = cfg?.viewWeights ?? {}
  if (viewName === "antiNoise") {
    return (
      m.finalScore +
      Number(vw?.quality ?? 0.12) * m.quality +
      Number(vw?.pHit ?? 0.6) * m.pHit -
      Number(vw?.anti ?? 0.08) * m.anti -
      Number(vw?.slippageRisk ?? 0.18) * m.slippageRisk
    )
  }
  if (viewName === "conservative") {
    return (
      Number(vw?.expectedRet ?? 12) * m.expectedRet +
      Number(vw?.quality ?? 0.12) * m.quality +
      Number(vw?.pFill ?? 0.3) * m.pFill -
      Number(vw?.pStop ?? 0.45) * m.pStop -
      Number(vw?.anti ?? 0.08) * m.anti
    )
  }
  if (viewName === "executionAware") {
    return (
      m.finalScore +
      Number(vw?.expectedRet ?? 12) * m.expectedRet +
      Number(vw?.pFill ?? 0.3) * m.pFill -
      Number(vw?.pStop ?? 0.45) * m.pStop -
      Number(vw?.slippageRisk ?? 0.18) * m.slippageRisk +
      Number(vw?.margin ?? 0.15) * m.margin
    )
  }
  return m.finalScore
}

const heuristicScenarioScore = ({ row, scenarioName, cfg }) => {
  const m = rowMetrics(row)
  const sw = cfg?.stabilityWeights ?? {}
  if (scenarioName === "executionShock") {
    return m.finalScore - Number(sw?.slippageRisk ?? 0.22) * m.slippageRisk - Number(sw?.pStop ?? 0.55) * m.pStop
  }
  if (scenarioName === "qualityShock") {
    return m.finalScore + Number(sw?.quality ?? 0.14) * m.quality - Number(sw?.anti ?? 0.1) * m.anti
  }
  if (scenarioName === "fillShock") {
    return (
      m.finalScore +
      Number(sw?.pFill ?? 0.32) * m.pFill +
      Number(sw?.pHit ?? 0.65) * m.pHit -
      Number(sw?.pStop ?? 0.55) * m.pStop
    )
  }
  if (scenarioName === "marginShock") {
    return (
      m.finalScore +
      Number(sw?.margin ?? 0.2) * m.margin +
      Number(sw?.expectedRet ?? 10) * m.expectedRet
    )
  }
  return m.finalScore
}

const STABILITY_SCENARIO_VIEW = {
  baseline: "base",
  executionShock: "executionAware",
  qualityShock: "antiNoise",
  fillShock: "conservative",
  marginShock: "base"
}

const perturbAgreementFeaturesForScenario = ({ featureMap, scenarioName }) => {
  const base = {
    ...buildZeroWeights(AGREEMENT_MODEL_FEATURE_KEYS),
    ...(featureMap && typeof featureMap === "object" ? featureMap : {})
  }
  if (scenarioName === "executionShock") {
    return {
      ...base,
      executionScore: clampSigned((Number(base.executionScore ?? 0) || 0) - 0.25, 1),
      pFill: clampSigned((Number(base.pFill ?? 0) || 0) - 0.2, 1),
      pStop: clampSigned((Number(base.pStop ?? 0) || 0) + 0.2, 1),
      slippageRisk: clampSigned((Number(base.slippageRisk ?? 0) || 0) + 0.25, 1),
      liquidityPenalty: clamp01(Number(base.liquidityPenalty ?? 0) + 0.15)
    }
  }
  if (scenarioName === "qualityShock") {
    return {
      ...base,
      quality: clamp01(Number(base.quality ?? 0) - 0.18),
      anti: clamp01(Number(base.anti ?? 0) + 0.2),
      confidence: clamp01(Number(base.confidence ?? 0) - 0.12)
    }
  }
  if (scenarioName === "fillShock") {
    return {
      ...base,
      pFill: clamp01(Number(base.pFill ?? 0) - 0.22),
      pHit: clamp01(Number(base.pHit ?? 0) - 0.12),
      pStop: clamp01(Number(base.pStop ?? 0) + 0.15)
    }
  }
  if (scenarioName === "marginShock") {
    return {
      ...base,
      margin: clampSigned((Number(base.margin ?? 0) || 0) - 0.18, 1),
      expectedRet: clampSigned((Number(base.expectedRet ?? 0) || 0) - 0.14, 1),
      finalScore: clampSigned((Number(base.finalScore ?? 0) || 0) - 0.1, 1)
    }
  }
  return base
}

const canUseLearnedScenario = ({ model, modelCfg, scenarioName }) =>
  canUseLearnedView({
    model,
    modelCfg,
    viewName: STABILITY_SCENARIO_VIEW[String(scenarioName ?? "").trim()] ?? "base"
  })

const scoreLearnedScenario = ({ row, model, modelCfg, scenarioName }) => {
  const viewName = STABILITY_SCENARIO_VIEW[String(scenarioName ?? "").trim()] ?? "base"
  const safeModel = hydrateAgreementGateModel({ raw: model, cfg: modelCfg })
  const normalizedView = normalizeViewName(viewName)
  const featureMap = perturbAgreementFeaturesForScenario({
    featureMap: maskAgreementFeaturesForView({
      featureMap: extractAgreementModelFeatures({ row }),
      viewName: normalizedView
    }),
    scenarioName
  })
  const viewModel = safeModel?.views?.[normalizedView] ?? null
  return {
    score: computeViewLogit({
      featureMap,
      viewModel,
      featureKeys: viewModel?.featureKeys ?? safeModel?.featureKeys
    }),
    mode: resolveLearnedViewMode({
      model,
      modelCfg,
      viewName: normalizedView
    }),
    viewName: normalizedView
  }
}

const viewTrainingMultiplier = ({ viewName, featureMap }) => {
  const anti = clamp01(featureMap?.anti ?? 0)
  const pFill = clamp01(featureMap?.pFill ?? 0)
  const pStop = clamp01(featureMap?.pStop ?? 0)
  const slippageRisk = clamp01(((Number(featureMap?.slippageRisk ?? 0) || 0) + 1) / 2)
  if (viewName === "antiNoise") {
    return 1 + anti * 0.6 + slippageRisk * 0.4
  }
  if (viewName === "conservative") {
    return 1 + pStop * 0.5 + (1 - pFill) * 0.5
  }
  if (viewName === "executionAware") {
    return 1 + slippageRisk * 0.5 + (1 - pFill) * 0.5
  }
  return 1
}

export const updateAgreementGateModelOnline = ({
  model,
  row = null,
  featureMap = null,
  label,
  sampleWeight = 1,
  cfg
}) => {
  const safeCfg = resolveAgreementModelConfig(cfg)
  const next = hydrateAgreementGateModel({ raw: model, cfg: safeCfg })
  if (!hasBinaryLabel(label)) return next
  const y = Number(label) === 1 ? 1 : 0
  const baseWeight = Math.max(0, Number(sampleWeight ?? 1) || 0)
  if (baseWeight <= 0) return next
  const resolvedFeatureMap = featureMap && typeof featureMap === "object"
    ? featureMap
    : extractAgreementModelFeatures({ row })
  const lr = Number(safeCfg?.onlineLearningRate ?? 0.05) || 0.05
  const l2 = Math.max(0, Number(safeCfg?.l2 ?? 0) || 0)
  for (const viewName of AGREEMENT_VIEW_KEYS) {
    const view = next.views[viewName]
    const weight = baseWeight * viewTrainingMultiplier({ viewName, featureMap: resolvedFeatureMap })
    if (weight <= 0) continue
    const maskedFeatureMap = maskAgreementFeaturesForView({
      featureMap: resolvedFeatureMap,
      viewName
    })
    const logit = computeViewLogit({
      featureMap: maskedFeatureMap,
      viewModel: view,
      featureKeys: view?.featureKeys ?? next.featureKeys
    })
    const pred = sigmoid(logit)
    const error = (pred - y) * weight
    for (const key of next.featureKeys) {
      const x = Number(maskedFeatureMap?.[key] ?? 0) || 0
      const prev = Number(view?.weights?.[key] ?? 0) || 0
      view.weights[key] = prev - lr * (error * x + l2 * prev)
    }
    view.bias = (Number(view?.bias ?? 0) || 0) - lr * error
    view.sampleCount = Math.max(0, Number(view?.sampleCount ?? 0) + weight)
    if (y === 1) {
      view.positiveCount = Math.max(0, Number(view?.positiveCount ?? 0) + weight)
    } else {
      view.negativeCount = Math.max(0, Number(view?.negativeCount ?? 0) + weight)
    }
  }
  return next
}

export const trainAgreementGateModelFromDataset = ({
  rows,
  cfg,
  seedModel = null
}) => {
  const safeCfg = resolveAgreementModelConfig(cfg)
  const list = (Array.isArray(rows) ? rows : []).filter((row) => hasBinaryLabel(row?.labelAgreement))
  const positiveCount = list.reduce(
    (acc, row) => acc + (Number(row?.labelAgreement) === 1 ? Math.max(0, Number(row?.sampleWeight ?? 1) || 0) : 0),
    0,
  )
  const negativeCount = list.reduce(
    (acc, row) => acc + (Number(row?.labelAgreement) === 0 ? Math.max(0, Number(row?.sampleWeight ?? 1) || 0) : 0),
    0,
  )
  if (
    safeCfg.enabled !== true ||
    list.length < Number(safeCfg?.minTrainRows ?? 0) ||
    positiveCount < Number(safeCfg?.minPositiveRows ?? 0) ||
    negativeCount < Number(safeCfg?.minNegativeRows ?? 0)
  ) {
    return hydrateAgreementGateModel({ raw: seedModel, cfg: safeCfg })
  }
  let model = createEmptyAgreementGateModel({ cfg: safeCfg })
  for (let epoch = 0; epoch < Number(safeCfg?.trainEpochs ?? 1); epoch += 1) {
    for (const row of list) {
      model = updateAgreementGateModelOnline({
        model,
        featureMap: row?.modelFeatures ?? {},
        label: Number(row?.labelAgreement) === 1 ? 1 : 0,
        sampleWeight: row?.sampleWeight ?? 1,
        cfg: safeCfg
      })
    }
  }
  if (seedModel) {
    const seed = hydrateAgreementGateModel({ raw: seedModel, cfg: safeCfg })
    model.previousBaseSampleCount = Number(seed?.views?.base?.sampleCount ?? 0) || 0
  }
  return hydrateAgreementGateModel({ raw: model, cfg: safeCfg })
}

export const buildAgreementDatasetRow = ({
  decisionDateKey,
  split,
  row,
  labelAgreement = null,
  labelSource = null,
  sampleWeight = 1
}) => {
  const resolvedLabel = hasBinaryLabel(labelAgreement) ? (Number(labelAgreement) === 1 ? 1 : 0) : null
  return {
    decisionDateKey: String(decisionDateKey ?? ""),
    split: String(split ?? "ALL").trim().toUpperCase() || "ALL",
    symbol: String(row?.symbol ?? ""),
    routeBucket: String(row?.routeBucket ?? "__DEFAULT__"),
    regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
    rankIndex: Number.isFinite(Number(row?.rankIndex)) ? Number(row.rankIndex) : null,
    rankPct: Number.isFinite(Number(row?.rankPct)) ? Number(row.rankPct) : null,
    labelAgreement: resolvedLabel,
    labelSource: labelSource ? String(labelSource) : null,
    sampleWeight: Math.max(0, Number(sampleWeight ?? 1) || 0),
    modelFeatures: extractAgreementModelFeatures({ row })
  }
}

const canUseLearnedView = ({ model, modelCfg, viewName }) => {
  const safeModel = hydrateAgreementGateModel({ raw: model, cfg: modelCfg })
  const safeCfg = resolveAgreementModelConfig(modelCfg)
  const view = safeModel?.views?.[normalizeViewName(viewName)] ?? null
  if (!view || safeCfg.enabled !== true) return false
  return (
    Number(view?.sampleCount ?? 0) >= Number(safeCfg?.minSamplesForInference ?? 0) &&
    Number(view?.positiveCount ?? 0) >= Number(safeCfg?.minPositiveRows ?? 0) &&
    Number(view?.negativeCount ?? 0) >= Number(safeCfg?.minNegativeRows ?? 0)
  )
}

const resolveLearnedViewMode = ({ model, modelCfg, viewName }) => {
  const safeModel = hydrateAgreementGateModel({ raw: model, cfg: modelCfg })
  const safeCfg = resolveAgreementModelConfig(modelCfg)
  const view = safeModel?.views?.[normalizeViewName(viewName)] ?? null
  if (!view || safeCfg.enabled !== true) return "DISABLED"
  const warmup =
    Number(view?.sampleCount ?? 0) < Number(safeCfg?.minSamplesForInference ?? 0) ||
    Number(view?.positiveCount ?? 0) < Number(safeCfg?.minPositiveRows ?? 0) ||
    Number(view?.negativeCount ?? 0) < Number(safeCfg?.minNegativeRows ?? 0)
  return warmup ? "LEARNED_WARMUP" : "LEARNED"
}

const resolveAgreementViewScoreMode = ({ model, modelCfg, viewName }) => {
  const learnedMode = resolveLearnedViewMode({ model, modelCfg, viewName })
  if (learnedMode === "LEARNED") return "LEARNED"
  if (learnedMode === "LEARNED_WARMUP") return "HEURISTIC_WARMUP"
  return "DISABLED"
}

const scoreLearnedView = ({ row, model, modelCfg, viewName }) => {
  const safeModel = hydrateAgreementGateModel({ raw: model, cfg: modelCfg })
  const normalizedView = normalizeViewName(viewName)
  const featureMap = maskAgreementFeaturesForView({
    featureMap: extractAgreementModelFeatures({ row }),
    viewName: normalizedView
  })
  const logit = computeViewLogit({
    featureMap,
    viewModel: safeModel?.views?.[normalizedView],
    featureKeys: safeModel?.views?.[normalizedView]?.featureKeys ?? safeModel?.featureKeys
  })
  return {
    score: logit,
    mode: "LEARNED",
    checks: {
      sampleCount: Number(safeModel?.views?.[normalizedView]?.sampleCount ?? 0) || 0,
      positiveCount: Number(safeModel?.views?.[normalizedView]?.positiveCount ?? 0) || 0,
      negativeCount: Number(safeModel?.views?.[normalizedView]?.negativeCount ?? 0) || 0
    }
  }
}

export const resolveAgreementGate = (raw) => {
  const cfg = raw ?? {}
  const viewWeights = cfg?.viewWeights ?? {}
  const stabilityWeights = cfg?.stabilityWeights ?? {}
  return {
    enabled: cfg?.enabled === true,
    candidatePool: toPositiveInt(cfg?.candidatePool, 10),
    consensusTopN: toPositiveInt(cfg?.consensusTopN, 2),
    stabilityTopN: toPositiveInt(cfg?.stabilityTopN, cfg?.consensusTopN ?? 2),
    minConsensusCount: toPositiveInt(cfg?.minConsensusCount, 3),
    minStabilityRate: clamp01(cfg?.minStabilityRate ?? 0.6),
    minAgreementScore: clamp01(cfg?.minAgreementScore ?? 0.65),
    viewWeights: {
      expectedRet: toFinite(viewWeights?.expectedRet, 12),
      quality: toFinite(viewWeights?.quality, 0.12),
      anti: toFinite(viewWeights?.anti, 0.08),
      pHit: toFinite(viewWeights?.pHit, 0.6),
      pFill: toFinite(viewWeights?.pFill, 0.3),
      pStop: toFinite(viewWeights?.pStop, 0.45),
      slippageRisk: toFinite(viewWeights?.slippageRisk, 0.18),
      margin: toFinite(viewWeights?.margin, 0.15)
    },
    stabilityWeights: {
      expectedRet: toFinite(stabilityWeights?.expectedRet, 10),
      quality: toFinite(stabilityWeights?.quality, 0.14),
      anti: toFinite(stabilityWeights?.anti, 0.1),
      pHit: toFinite(stabilityWeights?.pHit, 0.65),
      pFill: toFinite(stabilityWeights?.pFill, 0.32),
      pStop: toFinite(stabilityWeights?.pStop, 0.55),
      slippageRisk: toFinite(stabilityWeights?.slippageRisk, 0.22),
      margin: toFinite(stabilityWeights?.margin, 0.2)
    },
    model: resolveAgreementModelConfig(cfg?.model)
  }
}

export const evaluateAgreementGate = ({
  rows,
  selectedRow,
  cfg,
  model = null,
  modelCfg = null
}) => {
  const safeCfg = resolveAgreementGate(cfg)
  const safeModelCfg = resolveAgreementModelConfig(modelCfg ?? safeCfg?.model)
  const selectedSymbol = String(selectedRow?.symbol ?? "").trim()
  if (safeCfg.enabled !== true || !selectedSymbol) {
    return {
      decision: "TRADE",
      reason: null,
      agreementScore: null,
      consensusCount: null,
      consensusRate: null,
      stabilityRate: null,
      checks: {}
    }
  }

  const pool = (Array.isArray(rows) ? rows : []).slice(0, safeCfg.candidatePool)
  if (pool.length < 2) {
    return {
      decision: "TRADE",
      reason: null,
      agreementScore: 1,
      consensusCount: AGREEMENT_VIEW_KEYS.length,
      consensusRate: 1,
      stabilityRate: 1,
      checks: {
        candidatePool: pool.length,
        shortCircuit: "POOL_LT_2"
      }
    }
  }

  const viewModes = {}
  const views = Object.fromEntries(
    AGREEMENT_VIEW_KEYS.map((viewName) => {
      const scoreMode = resolveAgreementViewScoreMode({
        model,
        modelCfg: safeModelCfg,
        viewName
      })
      viewModes[viewName] = scoreMode
      const ranked = rankRows({
        rows: pool,
        scorer: (row) => {
          if (scoreMode === "LEARNED") {
            return scoreLearnedView({
              row,
              model,
              modelCfg: safeModelCfg,
              viewName
            }).score
          }
          return heuristicViewScore({ row, viewName, cfg: safeCfg })
        }
      })
      return [viewName, ranked]
    }),
  )

  const viewRanks = {}
  let consensusCount = 0
  for (const [name, ranked] of Object.entries(views)) {
    const rank = findRankOfSymbol({
      ranked,
      symbol: selectedSymbol
    })
    viewRanks[name] = {
      rank,
      topSymbol: firstSymbol(ranked),
      mode: viewModes[name]
    }
    if (Number.isInteger(rank) && rank <= safeCfg.consensusTopN) {
      consensusCount += 1
    }
  }
  const consensusRate = consensusCount / Math.max(1, AGREEMENT_VIEW_KEYS.length)

  const scenarioModes = {}
  const scenarios = Object.fromEntries(
    ["baseline", "executionShock", "qualityShock", "fillShock", "marginShock"].map((scenarioName) => {
      const backingViewName = STABILITY_SCENARIO_VIEW[String(scenarioName ?? "").trim()] ?? "base"
      const scenarioScoreMode = resolveAgreementViewScoreMode({
        model,
        modelCfg: safeModelCfg,
        viewName: backingViewName
      })
      const learnedScenario =
        scenarioScoreMode === "LEARNED"
          ? scoreLearnedScenario({
              row: selectedRow,
              model,
              modelCfg: safeModelCfg,
              scenarioName
            })
          : null
      scenarioModes[scenarioName] =
        learnedScenario?.mode ??
        (scenarioScoreMode === "HEURISTIC_WARMUP" ? "HEURISTIC_WARMUP" : "HEURISTIC")
      return [
        scenarioName,
        rankRows({
          rows: pool,
          scorer: (row) => {
            if (scenarioScoreMode === "LEARNED") {
              return scoreLearnedScenario({
                row,
                model,
                modelCfg: safeModelCfg,
                scenarioName
              }).score
            }
            return heuristicScenarioScore({ row, scenarioName, cfg: safeCfg })
          }
        })
      ]
    }),
  )

  const scenarioWinners = {}
  const scenarioRanks = {}
  let stableCount = 0
  for (const [name, ranked] of Object.entries(scenarios)) {
    const winner = firstSymbol(ranked)
    scenarioWinners[name] = winner
    const rank = findRankOfSymbol({
      ranked,
      symbol: selectedSymbol
    })
    scenarioRanks[name] = {
      rank,
      topSymbol: winner,
      mode: scenarioModes[name]
    }
    if (Number.isInteger(rank) && rank <= safeCfg.stabilityTopN) {
      stableCount += 1
    }
  }
  const stabilityRate = stableCount / Math.max(1, Object.keys(scenarios).length)
  const agreementScore = clamp01((consensusRate + stabilityRate) / 2)

  let reason = null
  if (consensusCount < safeCfg.minConsensusCount) {
    reason = "AGREEMENT_CONSENSUS_LOW"
  } else if (stabilityRate < safeCfg.minStabilityRate) {
    reason = "AGREEMENT_STABILITY_LOW"
  } else if (agreementScore < safeCfg.minAgreementScore) {
    reason = "AGREEMENT_SCORE_LOW"
  }

  return {
    decision: reason ? "REJECT" : "TRADE",
    reason,
    agreementScore,
    consensusCount,
    consensusRate,
    stabilityRate,
    checks: {
      candidatePool: pool.length,
      selectedSymbol,
      consensusTopN: safeCfg.consensusTopN,
      stabilityTopN: safeCfg.stabilityTopN,
      minConsensusCount: safeCfg.minConsensusCount,
      minStabilityRate: safeCfg.minStabilityRate,
      minAgreementScore: safeCfg.minAgreementScore,
      viewRanks,
      viewModes,
      scenarioModes,
      scenarioWinners,
      scenarioRanks
    }
  }
}
