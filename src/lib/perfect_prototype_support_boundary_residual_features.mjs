const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
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

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const collectBoundaryGroups = ({
  positiveRows = [],
  negativeRows = [],
  maxGroups = 8,
  minFeatureSupportCount = 4,
} = {}) => {
  const keyPattern = /^sig\.bridge\.group\.([^.]+)\.margin$/
  const keys = uniqueStrings(
    [...(Array.isArray(positiveRows) ? positiveRows : []), ...(Array.isArray(negativeRows) ? negativeRows : [])].flatMap(
      (row) =>
        Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => keyPattern.test(featureKey)),
    ),
  )
  const groups = []
  for (const featureKey of keys) {
    const match = featureKey.match(keyPattern)
    const group = match?.[1]
    if (!group) continue
    const positiveValues = (positiveRows ?? [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    const negativeValues = (negativeRows ?? [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    if (
      positiveValues.length < Math.max(2, Math.floor(Number(minFeatureSupportCount) || 4) - 1) ||
      negativeValues.length < Math.max(2, Math.floor(Number(minFeatureSupportCount) || 4) - 1)
    ) {
      continue
    }
    const positiveMedian = quantile(positiveValues, 0.5)
    const negativeMedian = quantile(negativeValues, 0.5)
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    const rawGap =
      Number.isFinite(num(positiveMedian)) && Number.isFinite(num(negativeMedian))
        ? positiveMedian - negativeMedian
        : Number(positiveMean ?? 0) - Number(negativeMean ?? 0)
    const direction = rawGap >= 0 ? 1 : -1
    const scale = Math.max(
      0.1,
      Math.abs(Number(positiveMedian ?? 0) - Number(negativeMedian ?? 0)),
      Math.abs(Number(positiveMean ?? 0) - Number(negativeMean ?? 0)),
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
    )
    const recurrenceShare =
      positiveValues.length > 0
        ? positiveValues.filter((value) => direction * value > 0).length / positiveValues.length
        : 0
    const falsePositiveShare =
      negativeValues.length > 0
        ? negativeValues.filter((value) => direction * value > 0).length / negativeValues.length
        : 0
    groups.push({
      group,
      featureKey,
      direction,
      positiveMedian,
      negativeMedian,
      positiveMean,
      negativeMean,
      midpoint: (Number(positiveMedian ?? 0) + Number(negativeMedian ?? 0)) / 2,
      scale,
      recurrenceShare,
      falsePositiveShare,
      separation: Math.abs(rawGap) / Math.max(0.1, scale),
    })
  }
  return groups
    .sort((left, right) => right.separation - left.separation || left.group.localeCompare(right.group))
    .slice(0, Math.max(1, Math.floor(Number(maxGroups) || 8)))
}

const buildRowBoundaryResidualFeatureMap = ({
  row,
  groupStats = [],
} = {}) => {
  const numericFeatureMap = {}
  const categoricalTokens = []
  const residualMargins = []
  const localMargins = []
  const recurrenceCarries = []
  let positiveGroupCount = 0

  for (const groupStat of Array.isArray(groupStats) ? groupStats : []) {
    const rawValue = num(row?.numericFeatureMap?.[groupStat.featureKey])
    if (!Number.isFinite(rawValue)) continue
    const residualMargin =
      groupStat.direction * ((rawValue - Number(groupStat.midpoint ?? 0)) / Math.max(0.1, Number(groupStat.scale ?? 1)))
    const localBoundaryMargin =
      groupStat.direction *
      ((rawValue - Number(groupStat.negativeMedian ?? groupStat.midpoint ?? 0)) /
        Math.max(0.1, Number(groupStat.scale ?? 1)))
    const stabilityShare =
      Math.max(0, Math.min(1, residualMargin)) * Math.max(0, Number(groupStat.recurrenceShare ?? 0))
    const recurrenceCarry = residualMargin * Math.max(0, Number(groupStat.recurrenceShare ?? 0))

    residualMargins.push(residualMargin)
    localMargins.push(localBoundaryMargin)
    recurrenceCarries.push(recurrenceCarry)
    if (residualMargin > 0) positiveGroupCount += 1

    numericFeatureMap[`sig.boundary.group.${groupStat.group}.residualMargin`] = residualMargin
    numericFeatureMap[`sig.boundary.group.${groupStat.group}.localBoundaryMargin`] = localBoundaryMargin
    numericFeatureMap[`sig.boundary.group.${groupStat.group}.stabilityShare`] = stabilityShare
    numericFeatureMap[`sig.boundary.group.${groupStat.group}.recurrenceCarry`] = recurrenceCarry
  }

  const groupCount = Math.max(1, groupStats.length)
  const marginMean = average(residualMargins)
  const marginMin = residualMargins.length > 0 ? Math.min(...residualMargins) : null
  const localBoundaryMean = average(localMargins)
  const stabilityScore = average(recurrenceCarries.map((value) => Math.max(0, Number(value ?? 0))))
  const positiveGroupShare = positiveGroupCount / groupCount
  const localPurity = num(row?.numericFeatureMap?.["sig.bridge.localPurityScore"])
  const bestPositiveCellMargin = num(row?.numericFeatureMap?.["sig.bridge.bestPositiveCellMargin"])
  const posNegMargin = num(row?.numericFeatureMap?.["sig.bridge.posNegMargin"])
  const knnPositiveShare = num(row?.numericFeatureMap?.["sig.bridge.knnPositiveShare"])
  const knnNegativeShare = num(row?.numericFeatureMap?.["sig.bridge.knnNegativeShare"])
  const cellWinnerGap = num(row?.numericFeatureMap?.["sig.bridge.cellWinnerGap"])
  const negativeLeakShare =
    residualMargins.length > 0 ? residualMargins.filter((value) => value <= 0).length / residualMargins.length : null
  const falsePositivePressure =
    Math.max(0, Number(knnNegativeShare ?? 0) - Number(knnPositiveShare ?? 0)) +
    Math.max(0, -Number(localPurity ?? 0)) +
    Math.max(0, -Number(bestPositiveCellMargin ?? 0)) +
    Math.max(0, -Number(posNegMargin ?? 0)) +
    Math.max(0, Number(negativeLeakShare ?? 0))
  const recurrencePotential =
    Math.max(0, Number(stabilityScore ?? 0)) +
    Math.max(0, Number(localBoundaryMean ?? 0)) +
    Math.max(0, Number(bestPositiveCellMargin ?? 0)) +
    Math.max(0, Number(localPurity ?? 0))
  const boundaryStrength =
    Number(marginMean ?? 0) +
    Number(localBoundaryMean ?? 0) +
    Number(bestPositiveCellMargin ?? 0) +
    Number(cellWinnerGap ?? 0) +
    Number(localPurity ?? 0) -
    Number(falsePositivePressure ?? 0)
  const stabilityWeightedMargin =
    Number(marginMean ?? 0) * Math.max(0.25, Number(stabilityScore ?? 0) + 0.25)
  const supportRecoveryPotential =
    Number(recurrencePotential ?? 0) +
    Number(boundaryStrength ?? 0) +
    Number(positiveGroupShare ?? 0) +
    Math.max(0, Number(posNegMargin ?? 0))

  Object.assign(
    numericFeatureMap,
    Object.fromEntries(
      Object.entries({
        "sig.boundary.marginMean": marginMean,
        "sig.boundary.marginMin": marginMin,
        "sig.boundary.localBoundaryMean": localBoundaryMean,
        "sig.boundary.positiveGroupCount": positiveGroupCount,
        "sig.boundary.positiveGroupShare": positiveGroupShare,
        "sig.boundary.stabilityScore": stabilityScore,
        "sig.boundary.recurrencePotential": recurrencePotential,
        "sig.boundary.falsePositivePressure": falsePositivePressure,
        "sig.boundary.boundaryStrength": boundaryStrength,
        "sig.boundary.stabilityWeightedMargin": stabilityWeightedMargin,
        "sig.boundary.supportRecoveryPotential": supportRecoveryPotential,
      }).filter(([, value]) => Number.isFinite(num(value))),
    ),
  )

  const positiveBand =
    positiveGroupShare >= 0.75 ? "WIDE" : positiveGroupShare >= 0.5 ? "MID" : positiveGroupShare > 0 ? "NARROW" : "NONE"
  const pressureBand =
    falsePositivePressure <= 0.25
      ? "LOW"
      : falsePositivePressure <= 0.75
        ? "MID"
        : "HIGH"
  const recoveryBand =
    supportRecoveryPotential >= 2.5
      ? "STRONG"
      : supportRecoveryPotential >= 1
        ? "MID"
        : supportRecoveryPotential >= 0
          ? "WEAK"
          : "NEG"
  categoricalTokens.push(`sig:boundary.positiveGroups:${positiveBand}`)
  categoricalTokens.push(`sig:boundary.falsePositivePressure:${pressureBand}`)
  categoricalTokens.push(`sig:boundary.supportRecovery:${recoveryBand}`)

  return {
    numericFeatureMap,
    categoricalTokens,
  }
}

const collectBoundaryResidualFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.boundary.")),
    ),
  )

export const buildPerfectPrototypeSupportBoundaryResidualFamily = ({
  cohort,
  maxGroups = 8,
  minFeatureSupportCount = 4,
} = {}) => {
  const fitPositiveRows = Array.isArray(cohort?.bridgePositiveRows) && cohort.bridgePositiveRows.length > 0
    ? cohort.bridgePositiveRows
    : Array.isArray(cohort?.supportPositiveRows)
      ? cohort.supportPositiveRows
      : []
  const fitNegativeRows =
    Array.isArray(cohort?.supportNearHardNegativeRows) && cohort.supportNearHardNegativeRows.length > 0
      ? cohort.supportNearHardNegativeRows
      : Array.isArray(cohort?.hardNegativeRows)
        ? cohort.hardNegativeRows
        : []
  const groupStats = collectBoundaryGroups({
    positiveRows: fitPositiveRows,
    negativeRows: fitNegativeRows,
    maxGroups,
    minFeatureSupportCount,
  })

  if (fitPositiveRows.length < 1 || fitNegativeRows.length < 1 || groupStats.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_boundary_residual_not_separable",
      boundaryResidualFeatureKeys: [],
      summary: {
        ...(cohort?.summary ?? {}),
        boundaryResidualReady: false,
        boundaryResidualReason: "unsat_boundary_residual_not_separable",
        boundaryResidualFeatureCount: 0,
        boundaryResidualPositiveGroupCount: 0,
      },
    }
  }

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const boundaryFeatures = buildRowBoundaryResidualFeatureMap({
        row,
        groupStats,
      })
      return {
        ...row,
        numericFeatureMap: {
          ...(row?.numericFeatureMap ?? {}),
          ...(boundaryFeatures.numericFeatureMap ?? {}),
        },
        categoricalTokens: uniqueStrings([
          ...(row?.categoricalTokens ?? []),
          ...(boundaryFeatures.categoricalTokens ?? []),
        ]),
        tokenSet: new Set([
          ...(row?.categoricalTokens ?? []),
          ...(boundaryFeatures.categoricalTokens ?? []),
        ]),
      }
    })

  const trainRows = augmentRows(cohort?.trainRows)
  const gatedTrainRows = augmentRows(cohort?.gatedTrainRows)
  const oosRows = augmentRows(cohort?.oosRows)
  const supportCaseViews = augmentRows(cohort?.supportCaseViews)
  const rowByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const supportPositiveRows = (cohort?.supportPositiveRows ?? []).map((row) => rowByKey.get(row.rowKey) ?? row)
  const hardNegativeRows = (cohort?.hardNegativeRows ?? []).map((row) => rowByKey.get(row.rowKey) ?? row)
  const backgroundRows = (cohort?.backgroundRows ?? []).map((row) => rowByKey.get(row.rowKey) ?? row)
  const boundaryResidualFeatureKeys = collectBoundaryResidualFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViews,
  ])
  const boundaryResidualPositiveGroupCount = groupStats.filter(
    (entry) => Number(entry.recurrenceShare ?? 0) > Number(entry.falsePositiveShare ?? 0),
  ).length
  const boundaryResidualFalsePositivePressure = average(
    fitNegativeRows.map((row) => row?.numericFeatureMap?.["sig.boundary.falsePositivePressure"]),
  )
  const supportRecoveryMean = average(
    supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.boundary.supportRecoveryPotential"]),
  )

  return {
    ...cohort,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    supportPositiveRows,
    hardNegativeRows,
    backgroundRows,
    boundaryResidualFeatureKeys,
    boundaryResidualGroupStats: groupStats,
    summary: {
      ...(cohort?.summary ?? {}),
      boundaryResidualReady: true,
      boundaryResidualReason: null,
      boundaryResidualFeatureCount: boundaryResidualFeatureKeys.length,
      boundaryResidualGroupCount: groupStats.length,
      boundaryResidualPositiveGroupCount,
      boundaryResidualFalsePositivePressure,
      boundaryResidualSupportRecoveryMean: supportRecoveryMean,
      boundaryResidualPositiveSummary: summarizeRows(fitPositiveRows),
      boundaryResidualNegativeSummary: summarizeRows(fitNegativeRows),
    },
  }
}

export { summarizeRows as summarizePerfectPrototypeSupportBoundaryResidualRows }
