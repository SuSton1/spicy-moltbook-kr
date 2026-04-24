import { buildPerfectPrototypeSupportLeaveOneOutContract } from "./perfect_prototype_support_leave_one_out_contract.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

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

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const resolveFeatureGroup = (featureKey) => {
  const normalizedKey = toText(featureKey) ?? ""
  if (normalizedKey.startsWith("event.")) return "event"
  if (normalizedKey.startsWith("feature.candle.")) return "candle"
  if (normalizedKey.startsWith("feature.gap.")) return "gap"
  if (normalizedKey.startsWith("feature.volume.")) return "volume"
  if (normalizedKey.startsWith("feature.trend.")) return "trend"
  if (normalizedKey.startsWith("feature.shape.") || normalizedKey.startsWith("feature.level.")) return "shape"
  if (normalizedKey.startsWith("market.")) return "market"
  if (normalizedKey.startsWith("xsec.")) return "xsec"
  if (normalizedKey.startsWith("seq")) return "sequence"
  if (normalizedKey.startsWith("sig.support.")) return "support"
  if (normalizedKey.startsWith("sig.supportMetric.")) return "supportMetric"
  return "other"
}

const collectAvailableFeatureKeys = ({
  cohort,
  fitSupportCaseViews = [],
  maxRawFeatureKeys = 24,
  minFeatureSupportCount = 8,
} = {}) => {
  const supportSignatureConfig =
    cohort?.supportSignatureConfig && typeof cohort.supportSignatureConfig === "object"
      ? cohort.supportSignatureConfig
      : null
  const rows = [
    ...(Array.isArray(cohort?.gatedTrainRows) ? cohort.gatedTrainRows : []),
    ...(Array.isArray(fitSupportCaseViews) ? fitSupportCaseViews : []),
  ]
  const rawFeatureKeys = uniqueStrings(supportSignatureConfig?.featureKeys ?? [])
    .filter((featureKey) => {
      let finiteCount = 0
      for (const row of rows) {
        if (Number.isFinite(num(row?.numericFeatureMap?.[featureKey]))) finiteCount += 1
        if (finiteCount >= Math.max(3, Math.floor(Number(minFeatureSupportCount) || 8))) return true
      }
      return false
    })
    .slice(0, Math.max(1, Math.floor(Number(maxRawFeatureKeys) || 24)))

  const supportMetricKeys = uniqueStrings(
    rows.flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter(
        (featureKey) =>
          featureKey.startsWith("sig.support.") || featureKey.startsWith("sig.supportMetric."),
      ),
    ),
  ).filter((featureKey) => {
    let finiteCount = 0
    for (const row of rows) {
      if (Number.isFinite(num(row?.numericFeatureMap?.[featureKey]))) finiteCount += 1
      if (finiteCount >= Math.max(3, Math.floor(Number(minFeatureSupportCount) || 8) - 2)) return true
    }
    return false
  })

  return uniqueStrings([...rawFeatureKeys, ...supportMetricKeys])
}

const buildFeatureScales = ({ rows = [], featureKeys = [] } = {}) => {
  const out = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    const q10 = quantile(values, 0.1)
    const q90 = quantile(values, 0.9)
    const derived =
      Number.isFinite(num(q10)) && Number.isFinite(num(q90)) ? Math.abs(q90 - q10) : null
    out[featureKey] = Math.max(0.05, Number(derived ?? 1))
  }
  return out
}

const buildPrototype = ({ rows = [], featureKeys = [] } = {}) => {
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

const scoreRowToPrototype = ({
  row,
  prototype = {},
  featureKeys = [],
  featureScales = {},
} = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    const scale = Math.max(0.05, num(featureScales?.[featureKey]) ?? 1)
    total += Math.abs(rowValue - prototypeValue) / scale
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const compareBridgeRows = (left, right) => {
  const leftDistance = Number(left?.supportBridgeBaseDistance ?? Number.POSITIVE_INFINITY)
  const rightDistance = Number(right?.supportBridgeBaseDistance ?? Number.POSITIVE_INFINITY)
  if (leftDistance !== rightDistance) return leftDistance - rightDistance
  const leftCompatibility = Number(left?.supportCompatibility ?? Number.NEGATIVE_INFINITY)
  const rightCompatibility = Number(right?.supportCompatibility ?? Number.NEGATIVE_INFINITY)
  if (rightCompatibility !== leftCompatibility) return rightCompatibility - leftCompatibility
  return String(left?.rowKey ?? left?.caseId ?? "").localeCompare(String(right?.rowKey ?? right?.caseId ?? ""))
}

const selectMinimalBreadthPrefix = ({
  rows = [],
  minRows = 16,
  maxRows = 144,
  minDates = 10,
  minMonths = 6,
  minFolds = 4,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxPrefix = Math.min(
    safeRows.length,
    Math.max(Math.floor(Number(minRows) || 16), Math.floor(Number(maxRows) || 144)),
  )
  let selected = safeRows.slice(0, Math.min(safeRows.length, Math.max(1, Math.floor(Number(minRows) || 16))))
  for (let count = Math.max(1, Math.floor(Number(minRows) || 16)); count <= maxPrefix; count += 1) {
    const candidate = safeRows.slice(0, count)
    const summary = summarizeRows(candidate)
    selected = candidate
    if (
      summary.matchedDateCount >= minDates &&
      summary.matchedMonthCount >= minMonths &&
      summary.matchedFoldCount >= minFolds
    ) {
      return {
        rows: candidate,
        summary,
        ok: true,
      }
    }
  }
  return {
    rows: selected,
    summary: summarizeRows(selected),
    ok: false,
  }
}

const selectNegativePrefix = ({
  rows = [],
  minRows = 32,
  maxRows = 192,
  minFolds = 4,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const maxPrefix = Math.min(safeRows.length, Math.max(1, Math.floor(Number(maxRows) || 192)))
  let selected = safeRows.slice(0, Math.min(safeRows.length, Math.max(1, Math.floor(Number(minRows) || 32))))
  for (let count = Math.max(1, Math.floor(Number(minRows) || 32)); count <= maxPrefix; count += 1) {
    const candidate = safeRows.slice(0, count)
    const summary = summarizeRows(candidate)
    selected = candidate
    if (summary.matchedFoldCount >= minFolds) {
      return {
        rows: candidate,
        summary,
        ok: true,
      }
    }
  }
  return {
    rows: selected,
    summary: summarizeRows(selected),
    ok: selected.length > 0,
  }
}

const selectSeedRows = ({
  rows = [],
  featureKeys = [],
  featureScales = {},
  seedCount = 3,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeRows.length < 1) return []
  const seeds = [safeRows[0]]
  while (seeds.length < Math.min(safeRows.length, Math.max(1, Math.floor(Number(seedCount) || 3)))) {
    let bestRow = null
    let bestDistance = Number.NEGATIVE_INFINITY
    for (const row of safeRows) {
      if (seeds.some((seed) => seed.rowKey === row.rowKey)) continue
      let minDistance = Number.POSITIVE_INFINITY
    for (const seed of seeds) {
      const distance = scoreRowToPrototype({
        row,
        prototype: seed?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      })
        if (distance < minDistance) minDistance = distance
      }
      if (minDistance > bestDistance) {
        bestDistance = minDistance
        bestRow = row
      }
    }
    if (!bestRow) break
    seeds.push(bestRow)
  }
  return seeds
}

const buildLocalCellPrototypes = ({
  rows = [],
  featureKeys = [],
  featureScales = {},
  cellCount = 3,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeRows.length < 1) return []
  const seeds = selectSeedRows({
    rows: safeRows,
    featureKeys,
    featureScales,
    seedCount: cellCount,
  })
  const cells = seeds.map((seed, index) => ({
    cellId: `BRIDGE_CELL_${String(index + 1).padStart(2, "0")}`,
    seedRowKey: seed.rowKey,
    rows: [],
  }))
  for (const row of safeRows) {
    let bestCell = cells[0] ?? null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const cell of cells) {
      const seed = seeds.find((entry) => entry.rowKey === cell.seedRowKey)
      if (!seed) continue
      const distance = scoreRowToPrototype({
        row,
        prototype: seed?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      })
      if (distance < bestDistance) {
        bestDistance = distance
        bestCell = cell
      }
    }
    if (bestCell) bestCell.rows.push(row)
  }
  return cells
    .map((cell) => ({
      cellId: cell.cellId,
      prototype: buildPrototype({ rows: cell.rows, featureKeys }),
      summary: summarizeRows(cell.rows),
    }))
    .filter((cell) => cell.summary.rowCount > 0)
}

const buildKnnFeatures = ({
  row,
  bridgePositiveRows = [],
  supportNearHardNegativeRows = [],
  featureKeys = [],
  featureScales = {},
  k = 12,
} = {}) => {
  const positiveDistances = bridgePositiveRows
    .map((candidate) =>
      scoreRowToPrototype({
        row,
        prototype: candidate?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      }),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const negativeDistances = supportNearHardNegativeRows
    .map((candidate) =>
      scoreRowToPrototype({
        row,
        prototype: candidate?.numericFeatureMap ?? {},
        featureKeys,
        featureScales,
      }),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const combined = [
    ...positiveDistances.map((distance) => ({ label: "positive", distance })),
    ...negativeDistances.map((distance) => ({ label: "negative", distance })),
  ]
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
    posNearestDistance: positiveDistances[0] ?? null,
    posTop3MeanDistance: average(positiveDistances.slice(0, 3)),
    negNearestDistance: negativeDistances[0] ?? null,
    negTop3MeanDistance: average(negativeDistances.slice(0, 3)),
    knnPositiveShare: positiveShare,
    knnNegativeShare: negativeShare,
    localPurityScore:
      Number.isFinite(num(positiveShare)) && Number.isFinite(num(negativeShare))
        ? positiveShare - negativeShare
        : null,
  }
}

const buildGroupFeatureKeys = (featureKeys = []) => {
  const grouped = new Map()
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const group = resolveFeatureGroup(featureKey)
    const list = grouped.get(group) ?? []
    list.push(featureKey)
    grouped.set(group, list)
  }
  return grouped
}

const buildGroupMarginFeatures = ({
  row,
  groupFeatureKeys,
  positivePrototype,
  negativePrototype,
  featureScales,
} = {}) => {
  const numericFeatureMap = {}
  for (const [group, featureKeys] of groupFeatureKeys.entries()) {
    const posDistance = scoreRowToPrototype({
      row,
      prototype: positivePrototype,
      featureKeys,
      featureScales,
    })
    const negDistance = scoreRowToPrototype({
      row,
      prototype: negativePrototype,
      featureKeys,
      featureScales,
    })
    if (Number.isFinite(posDistance)) {
      numericFeatureMap[`sig.bridge.group.${group}.posDistance`] = posDistance
    }
    if (Number.isFinite(negDistance)) {
      numericFeatureMap[`sig.bridge.group.${group}.negDistance`] = negDistance
    }
    if (Number.isFinite(posDistance) && Number.isFinite(negDistance)) {
      numericFeatureMap[`sig.bridge.group.${group}.margin`] = negDistance - posDistance
    }
  }
  return numericFeatureMap
}

const buildCellFeatures = ({
  row,
  positiveCells = [],
  negativeCells = [],
  featureKeys = [],
  featureScales = {},
} = {}) => {
  const positiveDistances = positiveCells
    .map((cell) => ({
      cellId: cell.cellId,
      distance: scoreRowToPrototype({
        row,
        prototype: cell.prototype,
        featureKeys,
        featureScales,
      }),
    }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance)
  const negativeDistances = negativeCells
    .map((cell) => ({
      cellId: cell.cellId,
      distance: scoreRowToPrototype({
        row,
        prototype: cell.prototype,
        featureKeys,
        featureScales,
      }),
    }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance)

  const bestPositive = positiveDistances[0]?.distance ?? null
  const secondPositive = positiveDistances[1]?.distance ?? null
  const bestNegative = negativeDistances[0]?.distance ?? null
  return {
    "sig.bridge.bestPositiveCellDistance": bestPositive,
    "sig.bridge.secondPositiveCellDistance": secondPositive,
    "sig.bridge.bestNegativeCellDistance": bestNegative,
    "sig.bridge.bestPositiveCellMargin":
      Number.isFinite(num(bestPositive)) && Number.isFinite(num(bestNegative))
        ? bestNegative - bestPositive
        : null,
    "sig.bridge.cellWinnerGap":
      Number.isFinite(num(bestPositive)) && Number.isFinite(num(secondPositive))
        ? secondPositive - bestPositive
        : null,
    "sig.bridge.cellPurityGap":
      Number.isFinite(num(secondPositive)) && Number.isFinite(num(bestNegative))
        ? bestNegative - secondPositive
        : null,
  }
}

const augmentRowWithBridgeFeatures = ({
  row,
  bridgePositiveRows,
  supportNearHardNegativeRows,
  bridgePositivePrototype,
  bridgeNegativePrototype,
  bridgeFeatureKeys,
  bridgeFeatureScales,
  groupFeatureKeys,
  positiveCells,
  negativeCells,
  knnK = 12,
} = {}) => {
  const knnFeatures = buildKnnFeatures({
    row,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    featureKeys: bridgeFeatureKeys,
    featureScales: bridgeFeatureScales,
    k: knnK,
  })
  const posDistance = Number.isFinite(num(knnFeatures.posTop3MeanDistance))
    ? knnFeatures.posTop3MeanDistance
    : scoreRowToPrototype({
        row,
        prototype: bridgePositivePrototype,
        featureKeys: bridgeFeatureKeys,
        featureScales: bridgeFeatureScales,
      })
  const negDistance = Number.isFinite(num(knnFeatures.negTop3MeanDistance))
    ? knnFeatures.negTop3MeanDistance
    : scoreRowToPrototype({
        row,
        prototype: bridgeNegativePrototype,
        featureKeys: bridgeFeatureKeys,
        featureScales: bridgeFeatureScales,
      })
  const numericFeatureMap = {
    ...row.numericFeatureMap,
    "sig.bridge.posNearestDistance": knnFeatures.posNearestDistance,
    "sig.bridge.posTop3MeanDistance": knnFeatures.posTop3MeanDistance,
    "sig.bridge.negNearestDistance": knnFeatures.negNearestDistance,
    "sig.bridge.negTop3MeanDistance": knnFeatures.negTop3MeanDistance,
    "sig.bridge.posNegMargin":
      Number.isFinite(num(posDistance)) && Number.isFinite(num(negDistance))
        ? negDistance - posDistance
        : null,
    "sig.bridge.posNegRatio":
      Number.isFinite(num(posDistance)) && Number.isFinite(num(negDistance)) && posDistance > 0
        ? negDistance / posDistance
        : null,
    "sig.bridge.knnPositiveShare": knnFeatures.knnPositiveShare,
    "sig.bridge.knnNegativeShare": knnFeatures.knnNegativeShare,
    "sig.bridge.localPurityScore": knnFeatures.localPurityScore,
    ...buildGroupMarginFeatures({
      row,
      groupFeatureKeys,
      positivePrototype: bridgePositivePrototype,
      negativePrototype: bridgeNegativePrototype,
      featureScales: bridgeFeatureScales,
    }),
    ...buildCellFeatures({
      row,
      positiveCells,
      negativeCells,
      featureKeys: bridgeFeatureKeys,
      featureScales: bridgeFeatureScales,
    }),
  }
  return {
    ...row,
    numericFeatureMap: Object.fromEntries(
      Object.entries(numericFeatureMap).filter(([, value]) => Number.isFinite(num(value))),
    ),
  }
}

const collectBridgeMetricFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.bridge.")),
    ),
  )

export const buildPerfectPrototypeSupportContrastiveBridgeFamily = ({
  cohort,
  minBridgePositiveDates = 10,
  minBridgePositiveMonths = 6,
  minBridgePositiveFolds = 4,
  minBridgePositiveRows = 16,
  maxBridgePositiveRows = 144,
  minSupportNearHardNegativeRows = 32,
  maxSupportNearHardNegativeRows = 192,
  localBridgeCellCount = 3,
  knnK = 12,
  excludeSupportCaseFromFit = false,
} = {}) => {
  const gatedTrainRows = Array.isArray(cohort?.gatedTrainRows) ? cohort.gatedTrainRows : []
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const gatedPositiveRows = gatedTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const gatedNegativeRows = gatedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  const leaveOneOutContract = buildPerfectPrototypeSupportLeaveOneOutContract({
    cohort,
    excludeSupportCaseFromFit,
  })
  const fitSupportCaseViews = Array.isArray(leaveOneOutContract?.fitSupportCaseViews)
    ? leaveOneOutContract.fitSupportCaseViews
    : []
  const supportSeedRows = Array.isArray(leaveOneOutContract?.supportSeedRows)
    ? leaveOneOutContract.supportSeedRows
    : []
  const bridgeFeatureKeysBase = collectAvailableFeatureKeys({
    cohort,
    fitSupportCaseViews,
  })

  if (supportCaseViews.length < 1 || gatedPositiveRows.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_bridge_positive_cohort",
      bridgeFeatureKeys: [],
      bridgePositiveRows: [],
      supportNearHardNegativeRows: [],
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeReady: false,
        bridgeReason: "unsat_no_bridge_positive_cohort",
        bridgeBaseFeatureCount: bridgeFeatureKeysBase.length,
      },
    }
  }

  if (excludeSupportCaseFromFit === true && supportSeedRows.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_support_leave_one_out_fit",
      bridgeFeatureKeys: [],
      bridgePositiveRows: [],
      supportNearHardNegativeRows: [],
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeReady: false,
        bridgeReason: "unsat_support_leave_one_out_fit",
        bridgeBaseFeatureCount: bridgeFeatureKeysBase.length,
        supportFitExcluded: true,
        supportFitSeedSummary: leaveOneOutContract?.summary?.supportSeedSummary ?? null,
      },
    }
  }

  const bridgeFeatureScales = buildFeatureScales({
    rows: [...gatedTrainRows, ...fitSupportCaseViews, ...supportSeedRows],
    featureKeys: bridgeFeatureKeysBase,
  })
  const supportPrototype = buildPrototype({
    rows: supportSeedRows.length > 0 ? supportSeedRows : supportCaseViews,
    featureKeys: bridgeFeatureKeysBase,
  })

  const supportSortedPositives = gatedPositiveRows
    .map((row) => ({
      ...row,
      supportBridgeBaseDistance: scoreRowToPrototype({
        row,
        prototype: supportPrototype,
        featureKeys: bridgeFeatureKeysBase,
        featureScales: bridgeFeatureScales,
      }),
    }))
    .sort(compareBridgeRows)

  const bridgePositiveSelection = selectMinimalBreadthPrefix({
    rows: supportSortedPositives,
    minRows: minBridgePositiveRows,
    maxRows: maxBridgePositiveRows,
    minDates: minBridgePositiveDates,
    minMonths: minBridgePositiveMonths,
    minFolds: minBridgePositiveFolds,
  })

  if (!bridgePositiveSelection.ok) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_bridge_positive_breadth",
      bridgeFeatureKeys: [],
      bridgePositiveRows: bridgePositiveSelection.rows,
      supportNearHardNegativeRows: [],
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeReady: false,
        bridgeReason: "unsat_bridge_positive_breadth",
        bridgeBaseFeatureCount: bridgeFeatureKeysBase.length,
        bridgePositiveSummary: bridgePositiveSelection.summary,
      },
    }
  }

  const bridgePositiveRows = bridgePositiveSelection.rows
  const bridgePositivePrototype = buildPrototype({
    rows: bridgePositiveRows,
    featureKeys: bridgeFeatureKeysBase,
  })

  const supportNearSortedNegatives = gatedNegativeRows
    .map((row) => ({
      ...row,
      supportBridgeBaseDistance: scoreRowToPrototype({
        row,
        prototype: bridgePositivePrototype,
        featureKeys: bridgeFeatureKeysBase,
        featureScales: bridgeFeatureScales,
      }),
    }))
    .sort(compareBridgeRows)

  const negativePrefixTarget = Math.max(
    Math.floor(Number(minSupportNearHardNegativeRows) || 32),
    Math.min(
      Math.floor(Number(maxSupportNearHardNegativeRows) || 192),
      Math.ceil(bridgePositiveRows.length * 1.5),
    ),
  )
  const negativeSelection = selectNegativePrefix({
    rows: supportNearSortedNegatives,
    minRows: negativePrefixTarget,
    maxRows: maxSupportNearHardNegativeRows,
    minFolds: minBridgePositiveFolds,
  })

  if (!negativeSelection.ok || negativeSelection.rows.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_support_near_hard_negative",
      bridgeFeatureKeys: [],
      bridgePositiveRows,
      supportNearHardNegativeRows: [],
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeReady: false,
        bridgeReason: "unsat_no_support_near_hard_negative",
        bridgeBaseFeatureCount: bridgeFeatureKeysBase.length,
        bridgePositiveSummary: summarizeRows(bridgePositiveRows),
        supportNearHardNegativeSummary: negativeSelection.summary,
      },
    }
  }

  const supportNearHardNegativeRows = negativeSelection.rows
  const bridgeNegativePrototype = buildPrototype({
    rows: supportNearHardNegativeRows,
    featureKeys: bridgeFeatureKeysBase,
  })
  const groupFeatureKeys = buildGroupFeatureKeys(bridgeFeatureKeysBase)
  const positiveCells = buildLocalCellPrototypes({
    rows: bridgePositiveRows,
    featureKeys: bridgeFeatureKeysBase,
    featureScales: bridgeFeatureScales,
    cellCount: localBridgeCellCount,
  })
  const negativeCells = buildLocalCellPrototypes({
    rows: supportNearHardNegativeRows,
    featureKeys: bridgeFeatureKeysBase,
    featureScales: bridgeFeatureScales,
    cellCount: localBridgeCellCount,
  })

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) =>
      augmentRowWithBridgeFeatures({
        row,
        bridgePositiveRows,
        supportNearHardNegativeRows,
        bridgePositivePrototype,
        bridgeNegativePrototype,
        bridgeFeatureKeys: bridgeFeatureKeysBase,
        bridgeFeatureScales,
        groupFeatureKeys,
        positiveCells,
        negativeCells,
        knnK,
      }),
    )

  const trainRows = augmentRows(cohort?.trainRows)
  const gatedTrainRowsAugmented = augmentRows(gatedTrainRows)
  const oosRows = augmentRows(cohort?.oosRows)
  const supportCaseViewsAugmented = augmentRows(supportCaseViews)
  const bridgePositiveRowsAugmented = augmentRows(bridgePositiveRows)
  const supportNearHardNegativeRowsAugmented = augmentRows(supportNearHardNegativeRows)

  const rowByKey = new Map(gatedTrainRowsAugmented.map((row) => [row.rowKey, row]))
  const supportPositiveRows =
    Array.isArray(cohort?.supportPositiveRows) && cohort.supportPositiveRows.length > 0
      ? cohort.supportPositiveRows.map((row) => rowByKey.get(row.rowKey) ?? row)
      : []
  const hardNegativeRows =
    Array.isArray(cohort?.hardNegativeRows) && cohort.hardNegativeRows.length > 0
      ? cohort.hardNegativeRows.map((row) => rowByKey.get(row.rowKey) ?? row)
      : []
  const backgroundRows =
    Array.isArray(cohort?.backgroundRows) && cohort.backgroundRows.length > 0
      ? cohort.backgroundRows.map((row) => rowByKey.get(row.rowKey) ?? row)
      : []

  const bridgeMetricFeatureKeys = collectBridgeMetricFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViewsAugmented,
  ])
  const supportCaseBridgeMargins = supportCaseViewsAugmented.map(
    (row) => row?.numericFeatureMap?.["sig.bridge.bestPositiveCellMargin"],
  )

  return {
    ...cohort,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows: gatedTrainRowsAugmented,
    oosRows,
    supportCaseViews: supportCaseViewsAugmented,
    supportPositiveRows,
    hardNegativeRows,
    backgroundRows,
    bridgeFeatureKeys: bridgeMetricFeatureKeys,
    bridgeBaseFeatureKeys: bridgeFeatureKeysBase,
    bridgeFeatureScales,
    supportFitExcluded: leaveOneOutContract?.supportFitExcluded === true,
    supportFitViews: fitSupportCaseViews,
    supportSeedRows,
    bridgePositiveRows: bridgePositiveRowsAugmented,
    supportNearHardNegativeRows: supportNearHardNegativeRowsAugmented,
    bridgePositivePrototype,
    bridgeNegativePrototype,
    bridgePositiveCells: positiveCells,
    bridgeNegativeCells: negativeCells,
    summary: {
      ...(cohort?.summary ?? {}),
      bridgeReady: true,
      bridgeReason: null,
      bridgeBaseFeatureCount: bridgeFeatureKeysBase.length,
      bridgeFeatureCount: bridgeMetricFeatureKeys.length,
      supportFitExcluded: leaveOneOutContract?.supportFitExcluded === true,
      supportFitSeedSummary: leaveOneOutContract?.summary?.supportSeedSummary ?? null,
      bridgePositiveSummary: summarizeRows(bridgePositiveRowsAugmented),
      supportNearHardNegativeSummary: summarizeRows(supportNearHardNegativeRowsAugmented),
      bridgePositiveCellCount: positiveCells.length,
      bridgeNegativeCellCount: negativeCells.length,
      supportCaseBridgeBestPositiveCellMarginMean: average(supportCaseBridgeMargins),
    },
  }
}
