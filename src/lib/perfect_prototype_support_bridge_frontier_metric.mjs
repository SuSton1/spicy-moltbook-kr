const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

export const summarizePerfectPrototypeSupportBridgeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

export const buildPerfectPrototypeSupportBridgeSelectedStats = (rows = []) => {
  const dateKeys = new Set()
  const monthKeys = new Set()
  const foldIds = new Set()
  const windowIds = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.dateKey) dateKeys.add(row.dateKey)
    const monthKey = row?.monthKey ?? buildMonthKey(row?.dateKey)
    if (monthKey) monthKeys.add(monthKey)
    if (Number(row?.foldId ?? 0) > 0) foldIds.add(Number(row.foldId))
    if (Number(row?.windowId ?? 0) > 0) windowIds.add(Number(row.windowId))
  }
  return { dateKeys, monthKeys, foldIds, windowIds }
}

export const buildPerfectPrototypeSupportBridgePrototype = ({
  rows = [],
  featureKeys = [],
} = {}) => {
  const prototype = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    if (values.length < 1) continue
    prototype[featureKey] = average(values)
  }
  return prototype
}

export const scorePerfectPrototypeSupportBridgePrototype = ({
  row,
  prototype = {},
  featureKeys = [],
  featureScales = {},
} = {}) => {
  const weightedDistances = []
  let totalWeight = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    const scale = Math.max(0.05, num(featureScales?.[featureKey]) ?? 1)
    weightedDistances.push(Math.abs(rowValue - prototypeValue) / scale)
    totalWeight += 1
  }
  if (weightedDistances.length < 1 || totalWeight <= 0) return Number.POSITIVE_INFINITY
  return weightedDistances.reduce((sum, value) => sum + value, 0) / totalWeight
}

const buildKnnShares = ({
  row,
  positiveRows = [],
  negativeRows = [],
  featureKeys = [],
  featureScales = {},
  k = 12,
} = {}) => {
  const combined = [
    ...(Array.isArray(positiveRows) ? positiveRows : []).map((candidate) => ({
      label: "positive",
      distance: scorePerfectPrototypeSupportBridgePrototype({
        row,
        prototype: candidate?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      }),
    })),
    ...(Array.isArray(negativeRows) ? negativeRows : []).map((candidate) => ({
      label: "negative",
      distance: scorePerfectPrototypeSupportBridgePrototype({
        row,
        prototype: candidate?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      }),
    })),
  ]
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(1, Math.floor(Number(k) || 12)))

  const positiveShare = safeDiv(
    combined.filter((entry) => entry.label === "positive").length,
    combined.length,
  )
  const negativeShare = safeDiv(
    combined.filter((entry) => entry.label === "negative").length,
    combined.length,
  )
  return {
    knnPositiveShare: positiveShare,
    knnNegativeShare: negativeShare,
    localPurityScore:
      Number.isFinite(num(positiveShare)) && Number.isFinite(num(negativeShare))
        ? positiveShare - negativeShare
        : null,
  }
}

export const buildPerfectPrototypeSupportBridgeNegativeShell = ({
  selectedRows = [],
  negativeRows = [],
  featureKeys = [],
  featureScales = {},
  negativeShellMultiplier = 1.5,
} = {}) => {
  if (!Array.isArray(negativeRows) || negativeRows.length < 1) return []
  const positivePrototype = buildPerfectPrototypeSupportBridgePrototype({
    rows: selectedRows,
    featureKeys,
  })
  return negativeRows
    .map((row) => ({
      row,
      distance: scorePerfectPrototypeSupportBridgePrototype({
        row,
        prototype: positivePrototype,
        featureKeys,
        featureScales,
      }),
    }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(8, Math.ceil((selectedRows?.length ?? 0) * Number(negativeShellMultiplier ?? 1.5))))
    .map((entry) => entry.row)
}

export const buildPerfectPrototypeSupportBridgeFrontierState = ({
  selectedRows = [],
  negativeRows = [],
  supportCaseViews = [],
  featureKeys = [],
  featureScales = {},
  knnK = 12,
} = {}) => {
  const positivePrototype = buildPerfectPrototypeSupportBridgePrototype({
    rows: selectedRows,
    featureKeys,
  })
  const negativeShellRows = buildPerfectPrototypeSupportBridgeNegativeShell({
    selectedRows,
    negativeRows,
    featureKeys,
    featureScales,
  })
  const negativePrototype = buildPerfectPrototypeSupportBridgePrototype({
    rows: negativeShellRows,
    featureKeys,
  })
  const supportEvaluations = (Array.isArray(supportCaseViews) ? supportCaseViews : []).map((row) => {
    const posDistance = scorePerfectPrototypeSupportBridgePrototype({
      row,
      prototype: positivePrototype,
      featureKeys,
      featureScales,
    })
    const negDistance = scorePerfectPrototypeSupportBridgePrototype({
      row,
      prototype: negativePrototype,
      featureKeys,
      featureScales,
    })
    const margin =
      Number.isFinite(posDistance) && Number.isFinite(negDistance) ? negDistance - posDistance : null
    const knn = buildKnnShares({
      row,
      positiveRows: selectedRows,
      negativeRows: negativeShellRows,
      featureKeys,
      featureScales,
      k: knnK,
    })
    return {
      caseId: row?.caseId ?? null,
      posDistance: Number.isFinite(posDistance) ? posDistance : null,
      negDistance: Number.isFinite(negDistance) ? negDistance : null,
      margin: Number.isFinite(num(margin)) ? margin : null,
      ...knn,
      recovered:
        Number.isFinite(num(margin)) &&
        margin > 0 &&
        Number.isFinite(num(knn.knnPositiveShare)) &&
        knn.knnPositiveShare >= 0.5,
    }
  })
  return {
    positivePrototype,
    negativeShellRows,
    negativePrototype,
    supportEvaluations,
    supportRecoveredCount: supportEvaluations.filter((entry) => entry.recovered === true).length,
  }
}

export const scorePerfectPrototypeSupportBridgeFrontierCandidate = ({
  row,
  selectedStats,
  state,
  selectedRows = [],
  featureKeys = [],
  featureScales = {},
  knnK = 12,
} = {}) => {
  const posDistance = scorePerfectPrototypeSupportBridgePrototype({
    row,
    prototype: state?.positivePrototype ?? {},
    featureKeys,
    featureScales,
  })
  const negDistance = scorePerfectPrototypeSupportBridgePrototype({
    row,
    prototype: state?.negativePrototype ?? {},
    featureKeys,
    featureScales,
  })
  const knn = buildKnnShares({
    row,
    positiveRows: selectedRows,
    negativeRows: state?.negativeShellRows ?? [],
    featureKeys,
    featureScales,
    k: knnK,
  })
  const margin =
    Number.isFinite(posDistance) && Number.isFinite(negDistance) ? negDistance - posDistance : null
  const dateGain = row?.dateKey && !selectedStats?.dateKeys?.has(row.dateKey) ? 1 : 0
  const monthKey = row?.monthKey ?? buildMonthKey(row?.dateKey)
  const monthGain = monthKey && !selectedStats?.monthKeys?.has(monthKey) ? 1 : 0
  const foldId = Number(row?.foldId ?? 0)
  const foldGain = foldId > 0 && !selectedStats?.foldIds?.has(foldId) ? 1 : 0
  const windowId = Number(row?.windowId ?? 0)
  const windowGain = windowId > 0 && !selectedStats?.windowIds?.has(windowId) ? 1 : 0
  const marginalBreadthGain = dateGain * 4 + monthGain * 3 + foldGain * 6 + windowGain * 2
  const negativeLeakCost =
    Math.max(0, (num(knn.knnNegativeShare) ?? 1) - 0.35) * 4 +
    Math.max(0, 0.15 - (num(margin) ?? Number.NEGATIVE_INFINITY)) * 5 +
    Math.max(0, -(num(knn.localPurityScore) ?? Number.NEGATIVE_INFINITY)) * 4 +
    Math.max(0, (num(posDistance) ?? Number.POSITIVE_INFINITY) - 1.2) * 2
  const acceptanceScore =
    marginalBreadthGain +
    (num(margin) ?? Number.NEGATIVE_INFINITY) * 8 +
    (num(knn.localPurityScore) ?? Number.NEGATIVE_INFINITY) * 6 +
    (num(knn.knnPositiveShare) ?? 0) * 4 -
    negativeLeakCost * 6
  return {
    posDistance: Number.isFinite(posDistance) ? posDistance : null,
    negDistance: Number.isFinite(negDistance) ? negDistance : null,
    margin: Number.isFinite(num(margin)) ? margin : null,
    ...knn,
    dateGain,
    monthGain,
    foldGain,
    windowGain,
    marginalBreadthGain,
    negativeLeakCost,
    acceptanceScore,
  }
}
