const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const POSITIVE_AXES = [
  "sig.ordinalMotif.motifAgreement",
  "sig.ordinalMotif.supportRecoveryPotential",
  "sig.recurBoundary.localBreadthPurityGap",
  "sig.recurBoundary.localRecoveryMargin",
  "sig.boundary.supportRecoveryPotential",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.complementPocketAffinity",
  "sig.ctrlResidual.controlCentroidGap",
  "sig.ctrlResidual.nearestNegativeGap",
  "sig.ctrlResidual.regimeResidualRank",
]

const NEGATIVE_AXES = [
  "sig.recurBoundary.crossfitLeakShare",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleUncertainty",
  "sig.ctrlResidual.regimeResidualRisk",
]

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const transformAxisValue = (row, featureKey, direction) => {
  const raw = num(row?.numericFeatureMap?.[featureKey])
  if (!Number.isFinite(raw)) return null
  return direction >= 0 ? raw : -raw
}

const groupRowsByQuery = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    if (!queryId) continue
    const bucket = grouped.get(queryId) ?? []
    bucket.push(row)
    grouped.set(queryId, bucket)
  }
  return grouped
}

const buildRoleSupportLookup = ({ positiveRows = [], negativeRows = [] } = {}) => {
  const stats = new Map()
  const register = (rows, field) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const signature = String(row?.roleTopologySignature ?? "").trim()
      if (!signature || signature === "NONE") continue
      const entry = stats.get(signature) ?? { positiveDates: new Set(), negativeDates: new Set() }
      const dateKey = String(row?.dateKey ?? "").trim()
      if (dateKey) entry[field].add(dateKey)
      stats.set(signature, entry)
    }
  }
  register(positiveRows, "positiveDates")
  register(negativeRows, "negativeDates")
  return stats
}

const computeQueryStrengths = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const strengths = []
    for (const featureKey of POSITIVE_AXES) {
      const value = transformAxisValue(row, featureKey, 1)
      if (Number.isFinite(value)) strengths.push(value)
    }
    for (const featureKey of NEGATIVE_AXES) {
      const value = transformAxisValue(row, featureKey, -1)
      if (Number.isFinite(value)) strengths.push(value)
    }
    return {
      rowKey: row?.rowKey,
      totalStrength: average(strengths) ?? 0,
    }
  })

const augmentQueryRows = ({ rows = [], roleSupportLookup = new Map() } = {}) => {
  const strengths = new Map(computeQueryStrengths(rows).map((entry) => [entry.rowKey, entry.totalStrength]))
  const sortedStrengths = Array.from(strengths.entries()).sort((left, right) => right[1] - left[1])
  const hasRunnerUp = sortedStrengths.length > 1
  const topStrength = Number(sortedStrengths[0]?.[1] ?? 0)
  const runnerUpStrength = hasRunnerUp ? Number(sortedStrengths[1]?.[1] ?? topStrength) : Math.min(0, topStrength)
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const totalStrength = Number(strengths.get(row?.rowKey) ?? 0)
    const perAxisWinShares = []
    const perAxisMargins = []
    for (const featureKey of POSITIVE_AXES) {
      const current = transformAxisValue(row, featureKey, 1)
      if (!Number.isFinite(current)) continue
      const peers = rows
        .filter((peer) => peer?.rowKey !== row?.rowKey)
        .map((peer) => transformAxisValue(peer, featureKey, 1))
        .filter(Number.isFinite)
      if (peers.length < 1) continue
      const wins = peers.filter((peer) => current > peer).length
      const share = wins / peers.length
      const margin = average(peers.map((peer) => current - peer)) ?? 0
      perAxisWinShares.push(share)
      perAxisMargins.push(margin)
      const safeKey = featureKey.replace(/^sig\./, "").replaceAll(".", "_")
      row.numericFeatureMap = row?.numericFeatureMap ?? {}
      row.numericFeatureMap[`sig.outRank.axis.${safeKey}.winShare`] = share
      row.numericFeatureMap[`sig.outRank.axis.${safeKey}.marginMean`] = margin
    }
    for (const featureKey of NEGATIVE_AXES) {
      const current = transformAxisValue(row, featureKey, -1)
      if (!Number.isFinite(current)) continue
      const peers = rows
        .filter((peer) => peer?.rowKey !== row?.rowKey)
        .map((peer) => transformAxisValue(peer, featureKey, -1))
        .filter(Number.isFinite)
      if (peers.length < 1) continue
      const wins = peers.filter((peer) => current > peer).length
      const share = wins / peers.length
      const margin = average(peers.map((peer) => current - peer)) ?? 0
      perAxisWinShares.push(share)
      perAxisMargins.push(margin)
      const safeKey = featureKey.replace(/^sig\./, "").replaceAll(".", "_")
      row.numericFeatureMap = row?.numericFeatureMap ?? {}
      row.numericFeatureMap[`sig.outRank.axis.${safeKey}.winShare`] = share
      row.numericFeatureMap[`sig.outRank.axis.${safeKey}.marginMean`] = margin
    }
    const roleSignature = String(row?.roleTopologySignature ?? "").trim()
    const roleStats = roleSupportLookup.get(roleSignature) ?? { positiveDates: new Set(), negativeDates: new Set() }
    const consensusWinShare = average(perAxisWinShares) ?? (rows.length <= 1 ? 1 : 0)
    const condorcetMargin = average(perAxisMargins) ?? (totalStrength - runnerUpStrength)
    row.numericFeatureMap = row?.numericFeatureMap ?? {}
    row.numericFeatureMap["sig.outRank.consensusWinShare"] = consensusWinShare
    row.numericFeatureMap["sig.outRank.condorcetMargin"] = condorcetMargin
    row.numericFeatureMap["sig.outRank.peerGapToRunnerUp"] = totalStrength - runnerUpStrength
    row.numericFeatureMap["sig.outRank.negativePeerPressure"] = Math.max(0, 1 - consensusWinShare)
    row.numericFeatureMap["sig.outRank.dateWinnerPatternSupport"] = roleStats.positiveDates.size
    row.numericFeatureMap["sig.outRank.dateWinnerPatternConflict"] = roleStats.negativeDates.size
    row.numericFeatureMap["sig.outRank.winnerPatternResidual"] =
      roleStats.positiveDates.size - roleStats.negativeDates.size
    row.numericFeatureMap["sig.outRank.top1SelectionPotential"] =
      Number(row.numericFeatureMap["sig.outRank.consensusWinShare"] ?? 0) +
      Number(row.numericFeatureMap["sig.ctrlResidual.controlCentroidGap"] ?? 0) +
      Number(row.numericFeatureMap["sig.outRank.peerGapToRunnerUp"] ?? 0)
    return row
  })
}

const augmentRows = ({ rows = [], roleSupportLookup = new Map() } = {}) => {
  const byQuery = groupRowsByQuery(rows)
  const augmented = []
  for (const bucket of byQuery.values()) {
    augmented.push(...augmentQueryRows({ rows: bucket, roleSupportLookup }))
  }
  return augmented
}

const collectOutRankFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter(
        (featureKey) => featureKey.startsWith("sig.outRank.") || featureKey.startsWith("sig.ctrlResidual."),
      ),
    ),
  )

export const buildPerfectPrototypeSupportCounterfactualOutrankingFeatures = ({ family } = {}) => {
  const roleSupportLookup = buildRoleSupportLookup({
    positiveRows: family?.bridgePositiveRows ?? [],
    negativeRows: family?.supportNearHardNegativeRows ?? [],
  })
  const trainRows = augmentRows({ rows: family?.trainRows ?? [], roleSupportLookup })
  const gatedTrainRows = augmentRows({ rows: family?.gatedTrainRows ?? [], roleSupportLookup })
  const oosRows = augmentRows({ rows: family?.oosRows ?? [], roleSupportLookup })
  const supportCaseViews = augmentRows({ rows: family?.supportCaseViews ?? [], roleSupportLookup })
  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const outrankFeatureKeys = collectOutRankFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])

  return {
    ...family,
    ok: outrankFeatureKeys.length > 0,
    reason: outrankFeatureKeys.length > 0 ? null : "unsat_no_counterfactual_outranking_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    outrankFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      counterfactualOutrankingReady: outrankFeatureKeys.length > 0,
      counterfactualOutrankingFeatureCount: outrankFeatureKeys.length,
      winnerPatternSignatureCount: roleSupportLookup.size,
    },
  }
}
