import {
  matchPerfectPrototype1dRegimeCellRow,
  resolvePerfectPrototype1dRegimeRowFamilyIds,
} from "./perfect_prototype_1d_regime_cell_contract.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildTemporalFoldMap = (rows = [], foldCount = 4) => {
  const normalizedFoldCount = Math.max(1, Math.floor(Number(foldCount) || 4))
  const uniqueDates = Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.decisionDateKey ?? row?.dateKey ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
  if (uniqueDates.length < 1) return new Map()
  return new Map(
    uniqueDates.map((dateKey, index) => [
      dateKey,
      Math.min(normalizedFoldCount, Math.floor((index * normalizedFoldCount) / uniqueDates.length) + 1),
    ]),
  )
}

const compactNumericMap = (featureMap = {}) =>
  Object.fromEntries(
    Object.entries(featureMap && typeof featureMap === "object" ? featureMap : {})
      .map(([featureKey, rawValue]) => [featureKey, num(rawValue)])
      .filter(([, value]) => Number.isFinite(value)),
  )

const buildStructuredNumericFeatureMap = (row) => ({
  ...compactNumericMap(row?.featureVec),
  ...compactNumericMap(row?.globalFeatureVec),
  ...compactNumericMap(row?.eventFeatureVec),
  ...compactNumericMap(row?.marketContextVec),
  ...compactNumericMap(row?.xsecEventVec),
  ...compactNumericMap(row?.numericFeatureMap),
})

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const quantile = (values = [], q = 0.5) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return filtered[lower]
  const fraction = position - lower
  return filtered[lower] + (filtered[upper] - filtered[lower]) * fraction
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const toRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const slugifyFeatureKey = (featureKey) => String(featureKey ?? "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")

const buildDerivedFeatureCandidates = ({ positiveRows = [], negativeRows = [], featureKeys = [], rowFeatureMapByKey = new Map() } = {}) => {
  const scored = []
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const positiveValues = positiveRows.map((row) => rowFeatureMapByKey.get(toRowKey(row))?.[featureKey]).filter(Number.isFinite)
    const negativeValues = negativeRows.map((row) => rowFeatureMapByKey.get(toRowKey(row))?.[featureKey]).filter(Number.isFinite)
    if (positiveValues.length < 4 || negativeValues.length < 4) continue
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const score = Math.abs(positiveMean - negativeMean)
    if (!(score > 0)) continue
    scored.push({
      featureKey,
      score,
    })
  }
  return scored.sort((left, right) => right.score - left.score || left.featureKey.localeCompare(right.featureKey))
}

const buildFeatureBins = ({ rows = [], featureKeys = [], rowFeatureMapByKey = new Map() } = {}) =>
  Object.fromEntries(
    (Array.isArray(featureKeys) ? featureKeys : []).map((featureKey) => {
      const values = rows.map((row) => rowFeatureMapByKey.get(toRowKey(row))?.[featureKey]).filter(Number.isFinite)
      return [
        featureKey,
        {
          q1: quantile(values, 0.25),
          q2: quantile(values, 0.5),
          q3: quantile(values, 0.75),
        },
      ]
    }),
  )

const classifyBin = ({ value, bins } = {}) => {
  const numeric = num(value)
  if (!Number.isFinite(numeric)) return null
  const q1 = num(bins?.q1)
  const q2 = num(bins?.q2)
  const q3 = num(bins?.q3)
  if (!Number.isFinite(q1) || !Number.isFinite(q2) || !Number.isFinite(q3)) return null
  if (numeric <= q1) return "Q1"
  if (numeric <= q2) return "Q2"
  if (numeric <= q3) return "Q3"
  return "Q4"
}

const buildEnrichedRows = ({
  rows = [],
  cellSpec,
  rowFeatureMapByKey = new Map(),
  derivedFeatureKeys = [],
  featureBins = {},
  foldMap = new Map(),
} = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const rowKey = toRowKey(row)
    const mergedNumericFeatureMap = {
      ...buildStructuredNumericFeatureMap(row),
      ...(rowFeatureMapByKey.get(rowKey) ?? {}),
    }
    const familyIds = resolvePerfectPrototype1dRegimeRowFamilyIds({ row, cellSpec })
    const extraTokens = []
    for (const familyId of familyIds) {
      extraTokens.push(`tag:cell.family:${familyId}`)
    }
    for (const featureKey of derivedFeatureKeys) {
      const bin = classifyBin({
        value: mergedNumericFeatureMap?.[featureKey],
        bins: featureBins?.[featureKey],
      })
      if (!bin) continue
      extraTokens.push(`sig.cellbin.${slugifyFeatureKey(featureKey)}.${bin}`)
    }
    const categoricalTokens = uniqueStrings([
      ...(row?.categoricalTokens ?? []),
      ...(row?.contextualTokens ?? []),
      ...extraTokens,
    ])
    return {
      ...row,
      monthKey: row?.monthKey ?? buildMonthKey(row?.dateKey),
      foldId:
        Number.isFinite(Number(row?.foldId)) && Number(row?.foldId) > 0
          ? Number(row.foldId)
          : Number(foldMap.get(String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()) ?? 0) || null,
      numericFeatureMap: mergedNumericFeatureMap,
      cellFamilyIds: familyIds,
      categoricalTokens,
      tokenSet: new Set(categoricalTokens),
    }
  })

export const buildPerfectPrototype1dRegimeCellDataset = ({
  cellSpec,
  trainRows = [],
  trainControlRows = [],
  oosRows = [],
  oosControlRows = [],
  sidecarStore,
  maxDerivedFeatureCount = 12,
} = {}) => {
  const allTrainRows = [...(Array.isArray(trainRows) ? trainRows : []), ...(Array.isArray(trainControlRows) ? trainControlRows : [])]
  const allOosRows = [...(Array.isArray(oosRows) ? oosRows : []), ...(Array.isArray(oosControlRows) ? oosControlRows : [])]
  const matchedTrainRows = allTrainRows.filter((row) => matchPerfectPrototype1dRegimeCellRow({ row, cellSpec }))
  const matchedOosRows = allOosRows.filter((row) => matchPerfectPrototype1dRegimeCellRow({ row, cellSpec }))
  const trainPositiveRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const trainNegativeRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  const candidateFeatures = buildDerivedFeatureCandidates({
    positiveRows: trainPositiveRows,
    negativeRows: trainNegativeRows,
    featureKeys: sidecarStore?.featureKeys ?? [],
    rowFeatureMapByKey: sidecarStore?.rowFeatureMapByKey ?? new Map(),
  })
    .slice(0, Math.max(1, Math.floor(Number(maxDerivedFeatureCount) || 12)))
    .map((entry) => entry.featureKey)
  const featureBins = buildFeatureBins({
    rows: matchedTrainRows,
    featureKeys: candidateFeatures,
    rowFeatureMapByKey: sidecarStore?.rowFeatureMapByKey ?? new Map(),
  })
  const trainFoldMap = buildTemporalFoldMap(allTrainRows, 4)
  const enrichedTrainRows = buildEnrichedRows({
    rows: matchedTrainRows,
    cellSpec,
    rowFeatureMapByKey: sidecarStore?.rowFeatureMapByKey ?? new Map(),
    derivedFeatureKeys: candidateFeatures,
    featureBins,
    foldMap: trainFoldMap,
  })
  const enrichedOosRows = buildEnrichedRows({
    rows: matchedOosRows,
    cellSpec,
    rowFeatureMapByKey: sidecarStore?.rowFeatureMapByKey ?? new Map(),
    derivedFeatureKeys: candidateFeatures,
    featureBins,
    foldMap: new Map(),
  })
  const ok = enrichedTrainRows.length > 0 && enrichedOosRows.length > 0
  return {
    ok,
    reason: ok ? null : "unsat_no_cell_rows",
    cellId: cellSpec?.cellId ?? null,
    cellLabel: cellSpec?.label ?? null,
    regime: cellSpec?.regime ?? null,
    horizonId: cellSpec?.horizonId ?? null,
    familyIds: Array.isArray(cellSpec?.familyIds) ? cellSpec.familyIds : [],
    derivedFeatureKeys: candidateFeatures,
    derivedFeatureBins: featureBins,
    trainRows: enrichedTrainRows,
    trainPositiveRows: enrichedTrainRows.filter((row) => row?.outcomeHitTarget === true),
    trainNegativeRows: enrichedTrainRows.filter((row) => row?.outcomeHitTarget !== true),
    oosRows: enrichedOosRows,
    oosPositiveRows: enrichedOosRows.filter((row) => row?.outcomeHitTarget === true),
    oosNegativeRows: enrichedOosRows.filter((row) => row?.outcomeHitTarget !== true),
    summary: {
      cellId: cellSpec?.cellId ?? null,
      cellLabel: cellSpec?.label ?? null,
      derivedFeatureCount: candidateFeatures.length,
      trainSummary: summarizeRows(enrichedTrainRows),
      trainPositiveSummary: summarizeRows(enrichedTrainRows.filter((row) => row?.outcomeHitTarget === true)),
      trainNegativeSummary: summarizeRows(enrichedTrainRows.filter((row) => row?.outcomeHitTarget !== true)),
      oosSummary: summarizeRows(enrichedOosRows),
      oosPositiveSummary: summarizeRows(enrichedOosRows.filter((row) => row?.outcomeHitTarget === true)),
      oosNegativeSummary: summarizeRows(enrichedOosRows.filter((row) => row?.outcomeHitTarget !== true)),
    },
  }
}
