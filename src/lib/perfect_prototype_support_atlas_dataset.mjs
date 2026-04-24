const DEFAULT_ATLAS_METRIC_FEATURE_KEYS = [
  "sig.support.posDistance",
  "sig.support.maxDistance",
  "sig.support.margin",
  "sig.support.densityRatio",
  "sig.support.prototypeAgreement",
  "sig.support.featureCoverage",
  "sig.support.nearShare",
  "sig.supportMetric.score",
  "sig.supportMetric.coverageAdjustedMargin",
  "sig.supportMetric.agreementDistanceRatio",
  "sig.supportMetric.densityMarginGap",
  "sig.supportMetric.prototypeCloseness",
  "sig.supportMetric.supportCompatibility",
]

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const uniqueStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const hasFiniteFeature = (rows, featureKey, minCount) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => num(row?.numericFeatureMap?.[featureKey]))
    .filter(Number.isFinite).length >= minCount

const collectFeatureValues = (rows, featureKey) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => num(row?.numericFeatureMap?.[featureKey]))
    .filter(Number.isFinite)

export const buildPerfectPrototypeSupportAtlasDataset = ({
  cohort,
  maxRawFeatureKeys = 24,
  minFeatureSupportCount = 8,
} = {}) => {
  const gateTokens = Array.isArray(cohort?.gateTokens) ? cohort.gateTokens : []
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const supportFitExcluded = cohort?.supportFitExcluded === true
  const supportFitViews = Array.isArray(cohort?.supportFitViews) ? cohort.supportFitViews : []
  const fitSupportRows = supportFitExcluded ? supportFitViews : supportCaseViews
  const calibrationRows = Array.isArray(cohort?.gatedTrainRows) ? cohort.gatedTrainRows : []
  const calibrationPositiveRows = calibrationRows.filter((row) => row?.outcomeHitTarget === true)
  const calibrationNegativeRows = calibrationRows.filter((row) => row?.outcomeHitTarget !== true)
  const supportSignatureConfig =
    cohort?.supportSignatureConfig && typeof cohort.supportSignatureConfig === "object"
      ? cohort.supportSignatureConfig
      : null
  const bridgePositiveRows = Array.isArray(cohort?.bridgePositiveRows) ? cohort.bridgePositiveRows : []
  const bridgeNegativeRows =
    Array.isArray(cohort?.supportNearHardNegativeRows) ? cohort.supportNearHardNegativeRows : []
  const liftedBridgePositiveRows = Array.isArray(cohort?.liftedBridgePositiveRows)
    ? cohort.liftedBridgePositiveRows
    : []
  const liftedBridgeNegativeRows = Array.isArray(cohort?.liftedSupportNearHardNegativeRows)
    ? cohort.liftedSupportNearHardNegativeRows
    : []
  const bridgeFeatureKeys = uniqueStrings(cohort?.bridgeFeatureKeys ?? []).filter((featureKey) =>
    hasFiniteFeature(
      [
        ...calibrationRows,
        ...fitSupportRows,
        ...bridgePositiveRows,
        ...bridgeNegativeRows,
        ...(cohort?.supportPositiveRows ?? []),
        ...(cohort?.hardNegativeRows ?? []),
      ],
      featureKey,
      Math.max(3, Math.floor(Number(minFeatureSupportCount) || 8) - 3),
    ),
  )

  const rawFeatureKeys = uniqueStrings(supportSignatureConfig?.featureKeys ?? [])
    .filter((featureKey) =>
      hasFiniteFeature(
        [...calibrationRows, ...fitSupportRows, ...(cohort?.supportPositiveRows ?? []), ...(cohort?.hardNegativeRows ?? [])],
        featureKey,
        Math.max(4, Math.floor(Number(minFeatureSupportCount) || 8)),
      ),
    )
    .slice(0, Math.max(1, Math.floor(Number(maxRawFeatureKeys) || 24)))

  const metricFeatureKeys = DEFAULT_ATLAS_METRIC_FEATURE_KEYS.filter((featureKey) =>
    hasFiniteFeature(
      [...calibrationRows, ...fitSupportRows, ...(cohort?.supportPositiveRows ?? []), ...(cohort?.hardNegativeRows ?? [])],
      featureKey,
      Math.max(3, Math.floor(Number(minFeatureSupportCount) || 8) - 3),
    ),
  )

  const featureKeys = uniqueStrings([...rawFeatureKeys, ...metricFeatureKeys, ...bridgeFeatureKeys])
  const featureScales = {}
  for (const featureKey of featureKeys) {
    const bridgeConfiguredScale = num(cohort?.bridgeFeatureScales?.[featureKey])
    if (Number.isFinite(bridgeConfiguredScale) && bridgeConfiguredScale > 0) {
      featureScales[featureKey] = bridgeConfiguredScale
      continue
    }
    const configuredScale = num(supportSignatureConfig?.featureScaleByKey?.[featureKey])
    if (Number.isFinite(configuredScale) && configuredScale > 0) {
      featureScales[featureKey] = configuredScale
      continue
    }
    const values = collectFeatureValues(
      [...calibrationRows, ...fitSupportRows, ...(cohort?.supportPositiveRows ?? []), ...(cohort?.hardNegativeRows ?? [])],
      featureKey,
    )
    const q10 = quantile(values, 0.1)
    const q90 = quantile(values, 0.9)
    const derived = Number.isFinite(num(q10)) && Number.isFinite(num(q90)) ? Math.abs(q90 - q10) : null
    featureScales[featureKey] = Math.max(0.05, Number(derived ?? 1))
  }

  return {
    familyId: cohort?.familyId ?? "low_gap_top_continuation",
    surfaceName: cohort?.surfaceName ?? null,
    gateTokens,
    supportCaseViews,
    supportFitViews: fitSupportRows,
    supportFitExcluded,
    supportCaseIds: supportCaseViews.map((view) => view?.caseId).filter(Boolean),
    calibrationRows,
    calibrationPositiveRows,
    calibrationNegativeRows,
    bridgePositiveRows,
    bridgeNegativeRows,
    liftedBridgePositiveRows,
    liftedBridgeNegativeRows,
    oosRows: Array.isArray(cohort?.oosRows) ? cohort.oosRows : [],
    featureKeys,
    featureScales,
    summary: {
      familyId: cohort?.familyId ?? "low_gap_top_continuation",
      gateTokens,
      atlasFeatureCount: featureKeys.length,
      bridgeFeatureCount: bridgeFeatureKeys.length,
      atlasCalibrationPositiveSummary: summarizeRows(calibrationPositiveRows),
      atlasCalibrationNegativeSummary: summarizeRows(calibrationNegativeRows),
      atlasBridgePositiveSummary: summarizeRows(bridgePositiveRows),
      atlasBridgeNegativeSummary: summarizeRows(bridgeNegativeRows),
      atlasLiftedBridgePositiveSummary: summarizeRows(liftedBridgePositiveRows),
      atlasLiftedBridgeNegativeSummary: summarizeRows(liftedBridgeNegativeRows),
      bridgeCompanionAcceptedCount: Number(cohort?.summary?.bridgeCompanionAcceptedCount ?? 0),
      bridgeCompanionRejectReasonCounts: cohort?.summary?.bridgeCompanionRejectReasonCounts ?? {},
      bridgeLiftedPositiveSummary: cohort?.summary?.bridgeLiftedPositiveSummary ?? summarizeRows(liftedBridgePositiveRows),
      bridgeLiftedNegativeSummary: cohort?.summary?.bridgeLiftedNegativeSummary ?? summarizeRows(liftedBridgeNegativeRows),
      atlasSupportCaseCount: supportCaseViews.length,
      supportFitExcluded,
      supportFitViewCount: fitSupportRows.length,
      supportLeaveOneOutRecovered: cohort?.summary?.supportLeaveOneOutRecovered === true,
      atlasFeatureMeanScale: average(Object.values(featureScales)) ?? 0,
    },
  }
}

export { DEFAULT_ATLAS_METRIC_FEATURE_KEYS }
