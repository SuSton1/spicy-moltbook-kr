import { dequantizeSequence } from "./lightweight.mjs"
import {
  PERFECT_PROTOTYPE_EVENT_FEATURE_SURFACE,
  buildPerfectPrototypeEventFeatureVec,
  buildPerfectPrototypeEventTagTokens,
} from "./perfect_prototype_event_features.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
  buildPerfectPrototypeContextualTagTokens,
} from "./perfect_prototype_contextual_features.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
  assertNoPrejumpLeakageRow,
  isPrejumpPredictiveStrategyMode,
  isPrejumpPredictiveSurface,
} from "./perfect_prototype_prejump_contract.mjs"
import { buildPerfectPrototypeLowGapTopGeneralizationTagTokens } from "./perfect_prototype_subgroup_prepass.mjs"
import { buildPerfectPrototypeIntervalTokens } from "./perfect_prototype_interval_token_bank.mjs"
import { buildPerfectPrototypeLowGapTopMacroTokens } from "./perfect_prototype_macro_token_miner.mjs"
import {
  buildPerfectPrototypeSupportManifoldConfig,
  buildPerfectPrototypeSupportSignatureMetrics,
} from "./perfect_prototype_support_manifold_signature.mjs"
import { buildPerfectPrototypeAdaptiveThresholdAtoms } from "./perfect_prototype_adaptive_threshold_atom_bank.mjs"
import { buildPerfectPrototypeSupportMetricFeatures } from "./perfect_prototype_support_metric_features.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => num(value))
        .filter(Number.isFinite),
    ),
  ).sort((left, right) => left - right)

const clampInteger = (value, fallback, min, max) => {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const mean = (values) => {
  if (!Array.isArray(values) || values.length < 1) return null
  let total = 0
  let count = 0
  for (const value of values) {
    const n = num(value)
    if (!Number.isFinite(n)) continue
    total += n
    count += 1
  }
  if (count < 1) return null
  return total / count
}

const stdev = (values) => {
  if (!Array.isArray(values) || values.length < 2) return null
  const avg = mean(values)
  if (!Number.isFinite(avg)) return null
  let total = 0
  let count = 0
  for (const value of values) {
    const n = num(value)
    if (!Number.isFinite(n)) continue
    total += (n - avg) ** 2
    count += 1
  }
  if (count < 2) return null
  return Math.sqrt(total / count)
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const sortNumericAsc = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

const quantile = (sortedValues, q) => {
  if (!Array.isArray(sortedValues) || sortedValues.length < 1) return null
  const qq = Math.max(0, Math.min(1, Number(q) || 0))
  const idx = (sortedValues.length - 1) * qq
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedValues[lo]
  const weight = idx - lo
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight
}

const normalizePrefixList = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)

const hasAnyPrefix = (value, prefixes) => prefixes.some((prefix) => value.startsWith(prefix))

export const PERFECT_PROTOTYPE_TOKENIZER_SURFACES = Object.freeze({
  v1: ["feature.", "global.", "seq40.", "seq150."],
  v2_event_aware: ["feature.", "global.", "seq40.", "seq150.", "event."],
  [PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "event.",
    "market.",
    "xsec.",
    "sig.",
  ],
  [PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE]: [
    "feature.",
    "global.",
    "seq40.",
    "seq150.",
    "market.",
    "xsec.",
    "sig.",
  ],
})

export const resolvePerfectPrototypeFeaturePrefixes = (surface) => {
  const normalized = String(surface ?? "").trim().toLowerCase()
  return PERFECT_PROTOTYPE_TOKENIZER_SURFACES[normalized] ?? null
}

const defaultFeatureIncludePrefixes = PERFECT_PROTOTYPE_TOKENIZER_SURFACES[PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE]

export const DEFAULT_PERFECT_PROTOTYPE_TOKENIZER_OPTIONS = {
  binCount: 5,
  includeSymbolToken: false,
  includeMissingTokens: false,
  includeCategoricalTokens: true,
  enableIntervalAtoms: false,
  enableMacroAtoms: false,
  enableSupportAnchorAtoms: false,
  enableSupportManifoldSignature: false,
  enableSupportMetricFeatures: false,
  enableAdaptiveThresholdAtoms: false,
  supportSignatureConfig: null,
  includeFeaturePrefixes: defaultFeatureIncludePrefixes,
  excludeFeaturePrefixes: [],
}

export const normalizePerfectPrototypeTokenizerOptions = (options = {}) => ({
  ...DEFAULT_PERFECT_PROTOTYPE_TOKENIZER_OPTIONS,
  ...options,
  surfaceName: String(options?.surfaceName ?? options?.surface ?? "").trim().toLowerCase() || null,
  binCount: clampInteger(
    options?.binCount,
    DEFAULT_PERFECT_PROTOTYPE_TOKENIZER_OPTIONS.binCount,
    2,
    10,
  ),
  includeSymbolToken: options?.includeSymbolToken === true,
  includeMissingTokens: options?.includeMissingTokens === true,
  includeCategoricalTokens: options?.includeCategoricalTokens !== false,
  enableIntervalAtoms: options?.enableIntervalAtoms === true,
  enableMacroAtoms: options?.enableMacroAtoms === true,
  enableSupportAnchorAtoms: options?.enableSupportAnchorAtoms === true,
  enableSupportManifoldSignature: options?.enableSupportManifoldSignature === true,
  enableSupportMetricFeatures: options?.enableSupportMetricFeatures === true,
  enableAdaptiveThresholdAtoms: options?.enableAdaptiveThresholdAtoms === true,
  supportSignatureConfig:
    options?.supportSignatureConfig && typeof options.supportSignatureConfig === "object"
      ? options.supportSignatureConfig
      : null,
  includeFeaturePrefixes:
    normalizePrefixList(options?.includeFeaturePrefixes).length > 0
      ? normalizePrefixList(options?.includeFeaturePrefixes)
      : defaultFeatureIncludePrefixes,
  excludeFeaturePrefixes: normalizePrefixList(options?.excludeFeaturePrefixes),
})

const sequenceStats = (values, prefix) => {
  const list = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (list.length < 1) return {}
  const positives = list.filter((value) => value > 0).length
  const negatives = list.filter((value) => value < 0).length
  const minValue = Math.min(...list)
  const maxValue = Math.max(...list)
  const firstValue = list[0] ?? null
  const lastValue = list[list.length - 1] ?? null
  return {
    [`${prefix}.mean`]: mean(list),
    [`${prefix}.stdev`]: stdev(list),
    [`${prefix}.min`]: minValue,
    [`${prefix}.max`]: maxValue,
    [`${prefix}.last`]: lastValue,
    [`${prefix}.delta`]:
      Number.isFinite(firstValue) && Number.isFinite(lastValue) ? lastValue - firstValue : null,
    [`${prefix}.positiveShare`]: safeDiv(positives, list.length),
    [`${prefix}.negativeShare`]: safeDiv(negatives, list.length),
    [`${prefix}.absMax`]: Math.max(Math.abs(minValue), Math.abs(maxValue)),
  }
}

const collectFeatureValues = (prefix, input) => {
  const out = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    const n = num(value)
    if (!Number.isFinite(n)) continue
    out[`${prefix}.${key}`] = n
  }
  return out
}

export const buildPerfectPrototypeNumericFeatureMap = (normalizedRow, options = {}) => {
  const cfg = normalizePerfectPrototypeTokenizerOptions(options)
  const merged = {
    ...collectFeatureValues("feature", normalizedRow?.featureVec),
    ...collectFeatureValues("global", normalizedRow?.globalFeatureVec),
    ...collectFeatureValues("event", normalizedRow?.eventFeatureVec),
    ...collectFeatureValues("market", normalizedRow?.marketContextVec),
    ...collectFeatureValues("xsec", normalizedRow?.xsecEventVec),
    ...sequenceStats(normalizedRow?.seq40, "seq40"),
    ...sequenceStats(normalizedRow?.seq150, "seq150"),
  }
  const out = {}
  for (const [featureKey, value] of Object.entries(merged)) {
    if (cfg.includeFeaturePrefixes.length > 0 && !hasAnyPrefix(featureKey, cfg.includeFeaturePrefixes)) {
      continue
    }
    if (cfg.excludeFeaturePrefixes.length > 0 && hasAnyPrefix(featureKey, cfg.excludeFeaturePrefixes)) {
      continue
    }
    const n = num(value)
    if (!Number.isFinite(n)) continue
    out[featureKey] = n
  }
  return out
}

export const normalizePerfectPrototypeRow = (row, options = {}) => {
  const cfg = normalizePerfectPrototypeTokenizerOptions(options)
  const disableDerivedEventTagTokens = row?.disableDerivedEventTagTokens === true
  const disableGapRankContextTokens = row?.disableGapRankContextTokens === true
  const disableLowGapTopGeneralizationTokens = row?.disableLowGapTopGeneralizationTokens === true
  const templateLike =
    row &&
    (row.templateId !== undefined || row.eventDate !== undefined || row.eventOutcome !== undefined)
  const featurePackLike = row && (row.seedKey !== undefined || row.decisionDateKey !== undefined)
  const sourceType =
    String(row?.sourceType ?? "").trim() ||
    (templateLike ? "step_b_template" : featurePackLike ? "step_d_feature_pack" : "unknown")
  const seq40 = Array.isArray(row?.seq40)
    ? row.seq40
    : Array.isArray(row?.seq40q)
      ? dequantizeSequence(row.seq40q, row?.seq40Scale ?? 10000)
      : []
  const seq150 = Array.isArray(row?.seq150)
    ? row.seq150
    : Array.isArray(row?.seq150q)
      ? dequantizeSequence(row.seq150q, row?.seq150Scale ?? 10000)
      : []
  const strategyMode = String(row?.strategyMode ?? "").trim().toUpperCase()
  const prejumpPredictive =
    isPrejumpPredictiveStrategyMode(strategyMode) || isPrejumpPredictiveSurface(cfg.surfaceName)
  if (prejumpPredictive) {
    assertNoPrejumpLeakageRow(row, {
      label: `${String(row?.symbol ?? "?")}:${String(row?.dateKey ?? row?.decisionDateKey ?? row?.eventDate ?? "?")}`,
    })
  }
  const normalized = {
    sourceType,
    sourceId: String(row?.sourceId ?? row?.templateId ?? row?.seedKey ?? "").trim(),
    symbol: String(row?.symbol ?? "").trim(),
    dateKey: String(row?.dateKey ?? row?.eventDate ?? row?.decisionDateKey ?? "").trim(),
    asOfDateKey: String(row?.asOfDateKey ?? row?.asOfDate ?? "").trim(),
    stepALaneId: String(row?.stepALaneId ?? "").trim() || null,
    impulseLookbackDays:
      Number.isInteger(Number(row?.impulseLookbackDays)) && Number(row?.impulseLookbackDays) >= 0
        ? Number(row.impulseLookbackDays)
        : null,
    strategyMode: strategyMode || null,
    featureVec: row?.featureVec ?? {},
    globalFeatureVec: row?.globalFeatureVec ?? {},
    eventFeatureVec: prejumpPredictive
      ? row?.eventFeatureVec && typeof row.eventFeatureVec === "object"
        ? row.eventFeatureVec
        : {}
      : row?.eventFeatureVec && typeof row.eventFeatureVec === "object"
        ? row.eventFeatureVec
        : buildPerfectPrototypeEventFeatureVec(row?.eventMeta ?? null, cfg),
    marketContextVec: row?.marketContextVec ?? {},
    xsecEventVec: row?.xsecEventVec ?? {},
    seq40,
    seq150,
    outcomeHitTarget:
      typeof row?.outcomeHitTarget === "boolean"
        ? row.outcomeHitTarget
        : typeof row?.eventOutcome?.hitTarget === "boolean"
          ? row.eventOutcome.hitTarget
          : null,
    eventOutcome: row?.eventOutcome ?? null,
    raw: row,
  }
  const derivedEventTokens =
    prejumpPredictive || disableDerivedEventTagTokens ? [] : buildPerfectPrototypeEventTagTokens(normalized.eventFeatureVec)
  const derivedLowGapTopGeneralizationTokens = prejumpPredictive
    ? []
    : disableLowGapTopGeneralizationTokens
      ? []
    : buildPerfectPrototypeLowGapTopGeneralizationTagTokens({
        featureVec: normalized.featureVec,
        eventFeatureVec: normalized.eventFeatureVec,
        xsecEventVec: normalized.xsecEventVec,
      })
  const derivedLegacyContextTokens = prejumpPredictive
    ? []
    : buildPerfectPrototypeContextualTagTokens({
        marketContextVec: normalized.marketContextVec,
        xsecEventVec: normalized.xsecEventVec,
        surfaceName: cfg.surfaceName,
        stepALaneId: normalized.stepALaneId,
      })
  normalized.categoricalTokens =
    uniqueSortedStrings([
      ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
      ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
      ...derivedEventTokens,
      ...derivedLowGapTopGeneralizationTokens,
      ...derivedLegacyContextTokens,
    ])
      .filter((token) =>
        disableGapRankContextTokens !== true ? true : !String(token ?? "").startsWith("tag:xsec.gapRank:"),
      )
  const baseNumericFeatureMap = buildPerfectPrototypeNumericFeatureMap(normalized, cfg)
  const supportSignatureConfig =
    cfg.enableSupportManifoldSignature === true &&
    cfg.supportSignatureConfig &&
    typeof cfg.supportSignatureConfig === "object"
      ? cfg.supportSignatureConfig
      : null
  if (supportSignatureConfig) {
    const signatureMetrics = buildPerfectPrototypeSupportSignatureMetrics({
      normalizedRow: {
        ...normalized,
        numericFeatureMap: baseNumericFeatureMap,
      },
      supportSignatureConfig,
    })
    const supportMetricFeatures =
      cfg.enableSupportMetricFeatures === true
        ? buildPerfectPrototypeSupportMetricFeatures({
            signatureMetrics,
          })
        : { numericFeatureMap: {}, categoricalTokens: [] }
    normalized.categoricalTokens = uniqueSortedStrings([
      ...normalized.categoricalTokens,
      ...(signatureMetrics?.categoricalTokens ?? []),
      ...(supportMetricFeatures?.categoricalTokens ?? []),
      ...(cfg.enableAdaptiveThresholdAtoms === true
        ? buildPerfectPrototypeAdaptiveThresholdAtoms({
            signatureMetrics,
          })
        : []),
    ])
    normalized.numericFeatureMap = {
      ...baseNumericFeatureMap,
      ...(cfg.enableSupportMetricFeatures === true
        ? signatureMetrics?.numericFeatureMap ?? {}
        : {}),
      ...(supportMetricFeatures?.numericFeatureMap ?? {}),
    }
  } else {
    normalized.numericFeatureMap = baseNumericFeatureMap
  }
  return normalized
}

export const buildPerfectPrototypeTokenizerSpec = (rows, options = {}) => {
  const cfg = normalizePerfectPrototypeTokenizerOptions(options)
  const featureValues = new Map()
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) =>
      row?.numericFeatureMap && row?.dateKey && row?.symbol
        ? row
        : normalizePerfectPrototypeRow(row, { ...cfg, surfaceName: cfg.surfaceName }),
    )
    .filter((row) => row.dateKey && row.symbol)

  for (const row of normalizedRows) {
    for (const [featureKey, value] of Object.entries(row.numericFeatureMap ?? {})) {
      const list = featureValues.get(featureKey) ?? []
      list.push(value)
      featureValues.set(featureKey, list)
    }
  }

  const numericFeatures = []
  for (const [featureKey, values] of featureValues.entries()) {
    const sorted = sortNumericAsc(values)
    if (sorted.length < 2) continue
    const edges = []
    for (let index = 1; index < cfg.binCount; index += 1) {
      const boundary = quantile(sorted, index / cfg.binCount)
      if (!Number.isFinite(boundary)) continue
      edges.push(boundary)
    }
    numericFeatures.push({
      featureKey,
      edges: uniqueSortedNumbers(edges),
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    })
  }

  numericFeatures.sort((left, right) => left.featureKey.localeCompare(right.featureKey))
  const resolvedSurface =
    PERFECT_PROTOTYPE_TOKENIZER_SURFACES[cfg.surfaceName]
      ? cfg.surfaceName
      : cfg.includeFeaturePrefixes.includes("market.") || cfg.includeFeaturePrefixes.includes("xsec.")
        ? PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
        : PERFECT_PROTOTYPE_EVENT_FEATURE_SURFACE
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    options: cfg,
    surface: resolvedSurface,
    numericFeatures,
  }
}

const resolveBinIndex = (value, featureSpec, binCount) => {
  const n = num(value)
  if (!Number.isFinite(n)) return null
  const edges = Array.isArray(featureSpec?.edges) ? featureSpec.edges : []
  let bucket = 0
  while (bucket < edges.length && n > Number(edges[bucket])) {
    bucket += 1
  }
  return Math.max(0, Math.min(binCount - 1, bucket))
}

export const tokenizePerfectPrototypeRow = (row, spec, options = {}) => {
  const cfg = normalizePerfectPrototypeTokenizerOptions({
    ...(spec?.options ?? {}),
    surfaceName: spec?.surface ?? options?.surfaceName ?? null,
    ...options,
  })
  const normalized =
    row?.numericFeatureMap && row?.dateKey && row?.symbol
      ? row
      : normalizePerfectPrototypeRow(row, { ...cfg, surfaceName: spec?.surface ?? cfg.surfaceName })
  const tokens = []
  const bucketIndexesByFeature = new Map()
  for (const featureSpec of Array.isArray(spec?.numericFeatures) ? spec.numericFeatures : []) {
    const value = normalized?.numericFeatureMap?.[featureSpec.featureKey]
    const bucket = resolveBinIndex(value, featureSpec, cfg.binCount)
    if (bucket == null) {
      if (cfg.includeMissingTokens) {
        tokens.push(`num:${featureSpec.featureKey}:MISSING`)
      }
      continue
    }
    tokens.push(`num:${featureSpec.featureKey}:B${String(bucket + 1).padStart(2, "0")}`)
    bucketIndexesByFeature.set(featureSpec.featureKey, bucket)
    if (cfg.enableIntervalAtoms === true) {
      tokens.push(
        ...buildPerfectPrototypeIntervalTokens({
          featureKey: featureSpec.featureKey,
          bucketIndex: bucket,
          binCount: cfg.binCount,
        }),
      )
    }
  }
  if (cfg.includeSymbolToken && normalized?.symbol) {
    tokens.push(`sym:${normalized.symbol}`)
  }
  if (cfg.includeCategoricalTokens) {
    tokens.push(...(Array.isArray(normalized?.categoricalTokens) ? normalized.categoricalTokens : []))
  }
  if (cfg.enableMacroAtoms === true || cfg.enableSupportAnchorAtoms === true) {
    tokens.push(
      ...buildPerfectPrototypeLowGapTopMacroTokens({
        bucketIndexesByFeature,
        categoricalTokens: [
          ...(Array.isArray(normalized?.categoricalTokens) ? normalized.categoricalTokens : []),
          ...tokens,
        ],
        enableSupportAnchorAtoms: cfg.enableSupportAnchorAtoms === true,
      }),
    )
  }
  return uniqueSortedStrings(tokens)
}

export const summarizePerfectPrototypeTokenizerSpec = (spec) => ({
  version: Number(spec?.version ?? 2),
  generatedAt: spec?.generatedAt ?? null,
  surface: spec?.surface ?? PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  numericFeatureCount: Array.isArray(spec?.numericFeatures) ? spec.numericFeatures.length : 0,
  includeSymbolToken: spec?.options?.includeSymbolToken === true,
  binCount: Number(spec?.options?.binCount ?? DEFAULT_PERFECT_PROTOTYPE_TOKENIZER_OPTIONS.binCount),
  enableIntervalAtoms: spec?.options?.enableIntervalAtoms === true,
  enableMacroAtoms: spec?.options?.enableMacroAtoms === true,
  enableSupportAnchorAtoms: spec?.options?.enableSupportAnchorAtoms === true,
  enableSupportManifoldSignature: spec?.options?.enableSupportManifoldSignature === true,
  enableSupportMetricFeatures: spec?.options?.enableSupportMetricFeatures === true,
  enableAdaptiveThresholdAtoms: spec?.options?.enableAdaptiveThresholdAtoms === true,
})

export const buildPerfectPrototypeSupportSignatureTokenizerConfig = ({
  familyId = null,
  supportCases = [],
} = {}) => buildPerfectPrototypeSupportManifoldConfig({ familyId, supportCases })
