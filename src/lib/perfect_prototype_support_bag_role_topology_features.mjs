const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const ROLE_AXES = [
  "sig.ordinalMotif.motifAgreement",
  "sig.ordinalMotif.supportRecoveryPotential",
  "sig.recurBoundary.localBreadthPurityGap",
  "sig.recurBoundary.localRecoveryMargin",
  "sig.boundary.supportRecoveryPotential",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.temporalEpisode.episodeNegativePressure",
]

const valueForAxis = (row, featureKey) => num(row?.numericFeatureMap?.[featureKey])

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const buildRoleSignature = (axisRanks = []) => {
  const topAxes = axisRanks
    .filter((entry) => Number.isFinite(entry?.pctRank))
    .sort((left, right) => right.pctRank - left.pctRank || left.axis.localeCompare(right.axis))
    .slice(0, 2)
    .map((entry) => entry.axis.replace(/^sig\./, "").replaceAll(".", "_"))
  return topAxes.length > 0 ? topAxes.join(">") : "NONE"
}

const computeBagAnnotations = (rows = []) => {
  const byDate = groupRowsByDate(rows)
  const annotations = new Map()
  for (const [dateKey, bagRows] of byDate.entries()) {
    for (const featureKey of ROLE_AXES) {
      const scored = bagRows
        .map((row) => ({
          rowKey: row?.rowKey,
          value: valueForAxis(row, featureKey),
        }))
        .filter((entry) => Number.isFinite(entry.value))
        .sort((left, right) => right.value - left.value || String(left.rowKey ?? "").localeCompare(String(right.rowKey ?? "")))
      if (scored.length < 1) continue
      const topValue = Number(scored[0].value ?? 0)
      const medianValue = Number(scored[Math.floor((scored.length - 1) / 2)]?.value ?? 0)
      for (let index = 0; index < scored.length; index += 1) {
        const entry = scored[index]
        const pctRank = scored.length <= 1 ? 1 : 1 - index / (scored.length - 1)
        const current = annotations.get(entry.rowKey) ?? { dateKey, axisRanks: [] }
        current.axisRanks.push({
          axis: featureKey,
          pctRank,
          gapToTop: topValue - Number(entry.value ?? 0),
          gapToMedian: Number(entry.value ?? 0) - medianValue,
          peerBagSize: bagRows.length,
        })
        annotations.set(entry.rowKey, current)
      }
    }
  }
  return annotations
}

const computeRoleStats = ({ positiveRows = [], negativeRows = [] } = {}) => {
  const stats = new Map()
  const register = (rows, label) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const roleSignature = String(row?.roleTopologySignature ?? "").trim()
      if (!roleSignature || roleSignature === "NONE") continue
      const entry = stats.get(roleSignature) ?? {
        roleSignature,
        positiveDates: new Set(),
        negativeDates: new Set(),
        positiveMonths: new Set(),
        negativeMonths: new Set(),
        positiveFolds: new Set(),
        negativeFolds: new Set(),
      }
      const dateKey = String(row?.dateKey ?? "").trim()
      const monthKey = String(row?.monthKey ?? "").trim() || buildMonthKey(row?.dateKey)
      const foldId = Number(row?.foldId ?? 0)
      if (label === "positive") {
        if (dateKey) entry.positiveDates.add(dateKey)
        if (monthKey) entry.positiveMonths.add(monthKey)
        if (foldId > 0) entry.positiveFolds.add(foldId)
      } else {
        if (dateKey) entry.negativeDates.add(dateKey)
        if (monthKey) entry.negativeMonths.add(monthKey)
        if (foldId > 0) entry.negativeFolds.add(foldId)
      }
      stats.set(roleSignature, entry)
    }
  }
  register(positiveRows, "positive")
  register(negativeRows, "negative")
  return Array.from(stats.values()).map((entry) => {
    const positiveDateCount = entry.positiveDates.size
    const negativeDateCount = entry.negativeDates.size
    const total = positiveDateCount + negativeDateCount
    const rolePurityLift = total > 0 ? (positiveDateCount - negativeDateCount) / total : 0
    const negativeRolePressure = total > 0 ? negativeDateCount / total : 1
    const roleBreadthCarry = positiveDateCount
    const roleStabilityShare = entry.positiveFolds.size / 4
    const complementPocketAffinity =
      rolePurityLift + roleBreadthCarry * 0.1 + roleStabilityShare - negativeRolePressure
    return {
      roleSignature: entry.roleSignature,
      positiveDateCount,
      negativeDateCount,
      positiveMonthCount: entry.positiveMonths.size,
      negativeMonthCount: entry.negativeMonths.size,
      positiveFoldCount: entry.positiveFolds.size,
      negativeFoldCount: entry.negativeFolds.size,
      rolePurityLift,
      negativeRolePressure,
      roleBreadthCarry,
      roleStabilityShare,
      complementPocketAffinity,
    }
  })
}

const augmentRows = ({ rows = [], annotationMap = new Map(), roleStatsLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const annotation = annotationMap.get(row?.rowKey) ?? { axisRanks: [] }
    const roleSignature = buildRoleSignature(annotation.axisRanks ?? [])
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    for (const axisRank of annotation.axisRanks ?? []) {
      const safeAxis = axisRank.axis.replace(/^sig\./, "").replaceAll(".", "_")
      numericFeatureMap[`sig.roleTopo.selfRank.${safeAxis}`] = Number(axisRank.pctRank ?? 0)
      numericFeatureMap[`sig.roleTopo.selfGapToTop.${safeAxis}`] = Number(axisRank.gapToTop ?? 0)
      numericFeatureMap[`sig.roleTopo.selfGapToMedian.${safeAxis}`] = Number(axisRank.gapToMedian ?? 0)
      numericFeatureMap[`sig.roleTopo.peerBagSize.${safeAxis}`] = Number(axisRank.peerBagSize ?? 0)
    }
    const roleStats = roleStatsLookup.get(roleSignature) ?? {
      rolePurityLift: -1,
      negativeRolePressure: 1,
      roleBreadthCarry: 0,
      roleStabilityShare: 0,
      complementPocketAffinity: -1,
    }
    numericFeatureMap["sig.roleTopo.rolePurityLift"] = Number(roleStats.rolePurityLift ?? -1)
    numericFeatureMap["sig.roleTopo.negativeRolePressure"] = Number(roleStats.negativeRolePressure ?? 1)
    numericFeatureMap["sig.roleTopo.roleBreadthCarry"] = Number(roleStats.roleBreadthCarry ?? 0)
    numericFeatureMap["sig.roleTopo.roleStabilityShare"] = Number(roleStats.roleStabilityShare ?? 0)
    numericFeatureMap["sig.roleTopo.complementPocketAffinity"] = Number(
      roleStats.complementPocketAffinity ?? -1,
    )
    numericFeatureMap["sig.roleTopo.roleCohesion"] =
      Number(roleStats.rolePurityLift ?? -1) + Number(roleStats.roleStabilityShare ?? 0)
    numericFeatureMap["sig.roleTopo.roleUncertainty"] =
      Math.max(0, Number(roleStats.negativeRolePressure ?? 1) - Number(roleStats.rolePurityLift ?? -1))
    const roleToken = `sig:roleTopo.signature:${roleSignature}`
    const categoricalTokens = Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []
    if (!categoricalTokens.includes(roleToken)) categoricalTokens.push(roleToken)
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(categoricalTokens)
    tokenSet.add(roleToken)
    row.roleTopologySignature = roleSignature
    row.numericFeatureMap = numericFeatureMap
    row.categoricalTokens = categoricalTokens
    row.tokenSet = tokenSet
    return row
  })

const collectRoleFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.roleTopo.")),
    ),
  )

export const buildPerfectPrototypeSupportBagRoleTopologyFeatures = ({
  family,
} = {}) => {
  const trainAnnotation = computeBagAnnotations(family?.gatedTrainRows ?? [])
  const positiveSeedRows = (family?.bridgePositiveRows ?? []).map((row) => ({
    ...row,
    roleTopologySignature: buildRoleSignature(trainAnnotation.get(row?.rowKey)?.axisRanks ?? []),
  }))
  const negativeSeedRows = (family?.supportNearHardNegativeRows ?? []).map((row) => ({
    ...row,
    roleTopologySignature: buildRoleSignature(trainAnnotation.get(row?.rowKey)?.axisRanks ?? []),
  }))
  const roleStats = computeRoleStats({
    positiveRows: positiveSeedRows,
    negativeRows: negativeSeedRows,
  })
  const roleStatsLookup = new Map(roleStats.map((entry) => [entry.roleSignature, entry]))

  const trainRows = augmentRows({
    rows: family?.trainRows ?? [],
    annotationMap: trainAnnotation,
    roleStatsLookup,
  })
  const gatedTrainRows = augmentRows({
    rows: family?.gatedTrainRows ?? [],
    annotationMap: trainAnnotation,
    roleStatsLookup,
  })
  const oosAnnotation = computeBagAnnotations(family?.oosRows ?? [])
  const oosRows = augmentRows({
    rows: family?.oosRows ?? [],
    annotationMap: oosAnnotation,
    roleStatsLookup,
  })
  const supportAnnotation = computeBagAnnotations(family?.supportCaseViews ?? [])
  const supportCaseViews = augmentRows({
    rows: family?.supportCaseViews ?? [],
    annotationMap: supportAnnotation,
    roleStatsLookup,
  })
  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const supportLookup = new Map(supportCaseViews.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map((row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row)
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const roleFeatureKeys = collectRoleFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  const distinctRoleSignatureCount = new Set(roleStats.map((entry) => entry.roleSignature).filter(Boolean)).size
  const supportCaseReachableRoleSignatureCount = new Set(
    supportCaseViews
      .map((row) => row?.roleTopologySignature)
      .filter((signature) => {
        const stats = roleStatsLookup.get(String(signature ?? "").trim())
        return Number(stats?.positiveDateCount ?? 0) > 0
      }),
  ).size

  return {
    ...family,
    ok: roleFeatureKeys.length > 0 && roleStats.length > 0,
    reason:
      roleFeatureKeys.length > 0 && roleStats.length > 0
        ? null
        : "unsat_no_role_topology_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    roleFeatureKeys,
    roleStats,
    summary: {
      ...(family?.summary ?? {}),
      roleTopologyReady: roleFeatureKeys.length > 0 && roleStats.length > 0,
      roleTopologyFeatureCount: roleFeatureKeys.length,
      roleTopologySignatureCount: distinctRoleSignatureCount,
      roleTopologyPositiveSummary: summarizeRows(bridgePositiveRows),
      roleTopologyNegativeSummary: summarizeRows(supportNearHardNegativeRows),
      supportCaseReachableRoleSignatureCount,
    },
  }
}
