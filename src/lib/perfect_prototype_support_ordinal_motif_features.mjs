const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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

const valueForGroup = (row, groupId) => {
  const boundary = num(row?.numericFeatureMap?.[`sig.boundary.group.${groupId}.residualMargin`])
  if (Number.isFinite(boundary)) return boundary
  const bridge = num(row?.numericFeatureMap?.[`sig.bridge.group.${groupId}.margin`])
  if (Number.isFinite(bridge)) return bridge
  return null
}

const collectMotifGroups = ({ positiveRows = [], negativeRows = [], boundaryResidualGroupStats = [], maxGroups = 4 } = {}) => {
  const fallbackGroups = uniqueStrings(
    [...(positiveRows ?? []), ...(negativeRows ?? [])].flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {})
        .map((featureKey) => featureKey.match(/^sig\.(?:boundary|bridge)\.group\.([^.]+)\./)?.[1] ?? null)
        .filter(Boolean),
    ),
  )
  const rankedGroups = (Array.isArray(boundaryResidualGroupStats) ? boundaryResidualGroupStats : [])
    .map((entry) => ({
      group: String(entry?.group ?? "").trim(),
      score:
        Math.max(0, Number(entry?.recurrenceShare ?? 0) - Number(entry?.falsePositiveShare ?? 0)) +
        Math.max(0, Number(entry?.separation ?? 0)),
    }))
    .filter((entry) => entry.group)
    .sort((left, right) => right.score - left.score || left.group.localeCompare(right.group))
    .map((entry) => entry.group)
  const groups = uniqueStrings([...rankedGroups, ...fallbackGroups]).slice(0, Math.max(2, Math.floor(Number(maxGroups) || 4)))
  return groups
}

const buildPairDirections = ({ groupIds = [], rows = [] } = {}) => {
  const means = Object.fromEntries(
    (groupIds ?? []).map((groupId) => [
      groupId,
      average((rows ?? []).map((row) => valueForGroup(row, groupId))),
    ]),
  )
  const directions = new Map()
  for (let leftIndex = 0; leftIndex < groupIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groupIds.length; rightIndex += 1) {
      const leftGroup = groupIds[leftIndex]
      const rightGroup = groupIds[rightIndex]
      const leftMean = Number(means[leftGroup] ?? 0)
      const rightMean = Number(means[rightGroup] ?? 0)
      const direction = leftMean >= rightMean ? 1 : -1
      directions.set(`${leftGroup}::${rightGroup}`, direction)
    }
  }
  return { means, directions }
}

const buildRowMotif = ({
  row,
  groupIds = [],
  positiveDirections = new Map(),
  negativeDirections = new Map(),
} = {}) => {
  const scoredGroups = groupIds
    .map((groupId) => ({
      groupId,
      value: valueForGroup(row, groupId),
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value || left.groupId.localeCompare(right.groupId))
  const groupCount = Math.max(1, scoredGroups.length)
  const numericFeatureMap = {}
  const categoricalTokens = []
  const topGroups = scoredGroups.slice(0, Math.min(3, scoredGroups.length)).map((entry) => entry.groupId)
  const signature = topGroups.length > 0 ? topGroups.join(">") : "NONE"

  for (let index = 0; index < scoredGroups.length; index += 1) {
    const entry = scoredGroups[index]
    const pctRank = groupCount <= 1 ? 1 : 1 - index / (groupCount - 1)
    const rankBand = index === 0 ? 3 : index === 1 ? 2 : 1
    numericFeatureMap[`sig.ordinalMotif.group.${entry.groupId}.pctRank`] = pctRank
    numericFeatureMap[`sig.ordinalMotif.group.${entry.groupId}.rankBand`] = rankBand
  }

  let positiveAgree = 0
  let negativeConflict = 0
  let pairCount = 0
  for (let leftIndex = 0; leftIndex < scoredGroups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < scoredGroups.length; rightIndex += 1) {
      const left = scoredGroups[leftIndex]
      const right = scoredGroups[rightIndex]
      const pairKey = `${left.groupId}::${right.groupId}`
      const gap = Number(left.value ?? 0) - Number(right.value ?? 0)
      const ratio = gap / Math.max(0.1, Math.abs(Number(right.value ?? 0)))
      const direction = gap >= 0 ? 1 : -1
      const positiveDirection = Number(positiveDirections.get(pairKey) ?? 0)
      const negativeDirection = Number(negativeDirections.get(pairKey) ?? 0)
      if (positiveDirection !== 0 && direction === positiveDirection) positiveAgree += 1
      if (negativeDirection !== 0 && direction === negativeDirection) negativeConflict += 1
      pairCount += 1
      numericFeatureMap[`sig.ordinalMotif.order.${left.groupId}_gt_${right.groupId}`] = direction
      numericFeatureMap[`sig.ordinalMotif.gap.${left.groupId}_minus_${right.groupId}`] = gap
      numericFeatureMap[`sig.ordinalMotif.ratio.${left.groupId}_to_${right.groupId}`] = ratio
    }
  }

  const motifAgreement = pairCount > 0 ? positiveAgree / pairCount : 0
  const negativeMotifConflict = pairCount > 0 ? negativeConflict / pairCount : 0
  const recurrenceCarry =
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"]) ?? 0)) +
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"]) ?? 0)) +
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.crossfitRecoveryShare"]) ?? 0))
  const leakPressure =
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.crossfitLeakShare"]) ?? 0)) +
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.boundary.falsePositivePressure"]) ?? 0))
  const recurrenceBreadthCarry = motifAgreement * Math.max(0, recurrenceCarry)
  const recurrenceLeakPressure = negativeMotifConflict + leakPressure
  const supportRecoveryPotential =
    motifAgreement +
    recurrenceBreadthCarry +
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.boundary.supportRecoveryPotential"]) ?? 0)) * 0.5 -
    recurrenceLeakPressure

  numericFeatureMap["sig.ordinalMotif.motifAgreement"] = motifAgreement
  numericFeatureMap["sig.ordinalMotif.negativeMotifConflict"] = negativeMotifConflict
  numericFeatureMap["sig.ordinalMotif.recurrenceBreadthCarry"] = recurrenceBreadthCarry
  numericFeatureMap["sig.ordinalMotif.recurrenceLeakPressure"] = recurrenceLeakPressure
  numericFeatureMap["sig.ordinalMotif.supportRecoveryPotential"] = supportRecoveryPotential

  categoricalTokens.push(`sig:ordinalMotif.signature:${signature}`)
  categoricalTokens.push(
    `sig:ordinalMotif.recovery:${
      supportRecoveryPotential >= 1.5 ? "STRONG" : supportRecoveryPotential >= 0.5 ? "MID" : supportRecoveryPotential >= 0 ? "WEAK" : "NEG"
    }`,
  )

  return {
    ordinalMotifSignature: signature,
    ordinalMotifDominantGroup: topGroups[0] ?? null,
    numericFeatureMap,
    categoricalTokens,
  }
}

const collectOrdinalFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.ordinalMotif.")),
    ),
  )

export const buildPerfectPrototypeSupportOrdinalMotifFeatures = ({
  cohort,
  maxGroups = 4,
} = {}) => {
  const fitPositiveRows = Array.isArray(cohort?.bridgePositiveRows) ? cohort.bridgePositiveRows : []
  const fitNegativeRows = Array.isArray(cohort?.supportNearHardNegativeRows)
    ? cohort.supportNearHardNegativeRows
    : Array.isArray(cohort?.hardNegativeRows)
      ? cohort.hardNegativeRows
      : []
  const groupIds = collectMotifGroups({
    positiveRows: fitPositiveRows,
    negativeRows: fitNegativeRows,
    boundaryResidualGroupStats: cohort?.boundaryResidualGroupStats,
    maxGroups,
  })
  if (fitPositiveRows.length < 1 || fitNegativeRows.length < 1 || groupIds.length < 2) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_ordinal_motif_groups",
      ordinalMotifFeatureKeys: [],
      ordinalMotifGroupIds: [],
      summary: {
        ...(cohort?.summary ?? {}),
        ordinalMotifReady: false,
        ordinalMotifReason: "unsat_no_ordinal_motif_groups",
        ordinalMotifFeatureCount: 0,
        ordinalMotifGroupCount: 0,
      },
    }
  }

  const positiveTemplate = buildPairDirections({
    groupIds,
    rows: fitPositiveRows,
  })
  const negativeTemplate = buildPairDirections({
    groupIds,
    rows: fitNegativeRows,
  })

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const motif = buildRowMotif({
        row,
        groupIds,
        positiveDirections: positiveTemplate.directions,
        negativeDirections: negativeTemplate.directions,
      })
      const categoricalTokens = uniqueStrings([
        ...(row?.categoricalTokens ?? []),
        ...(motif.categoricalTokens ?? []),
      ])
      return {
        ...row,
        ordinalMotifSignature: motif.ordinalMotifSignature,
        ordinalMotifDominantGroup: motif.ordinalMotifDominantGroup,
        numericFeatureMap: {
          ...(row?.numericFeatureMap ?? {}),
          ...(motif.numericFeatureMap ?? {}),
        },
        categoricalTokens,
        tokenSet: new Set(categoricalTokens),
      }
    })

  const trainRows = augmentRows(cohort?.trainRows)
  const gatedTrainRows = augmentRows(cohort?.gatedTrainRows)
  const oosRows = augmentRows(cohort?.oosRows)
  const supportCaseViews = augmentRows(cohort?.supportCaseViews)
  const gatedByKey = new Map(gatedTrainRows.map((row) => [row.rowKey, row]))
  const trainByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const bridgePositiveRows = fitPositiveRows.map((row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row)
  const supportNearHardNegativeRows = fitNegativeRows.map(
    (row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row,
  )
  const ordinalMotifFeatureKeys = collectOrdinalFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViews,
  ])

  return {
    ...cohort,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    ordinalMotifFeatureKeys,
    ordinalMotifGroupIds: groupIds,
    summary: {
      ...(cohort?.summary ?? {}),
      ordinalMotifReady: true,
      ordinalMotifReason: null,
      ordinalMotifFeatureCount: ordinalMotifFeatureKeys.length,
      ordinalMotifGroupCount: groupIds.length,
      ordinalMotifPositiveSummary: summarizeRows(bridgePositiveRows),
      ordinalMotifNegativeSummary: summarizeRows(supportNearHardNegativeRows),
      supportCaseOrdinalMotifAgreementMean: average(
        supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]),
      ),
      supportCaseOrdinalRecoveryMean: average(
        supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]),
      ),
    },
  }
}
