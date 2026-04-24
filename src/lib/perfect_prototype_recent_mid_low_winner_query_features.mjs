const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const POSITIVE_AXES = [
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.complementPocketAffinity",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.ctrlResidual.controlCentroidGap",
  "sig.ctrlResidual.nearestNegativeGap",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.outRank.consensusWinShare",
  "sig.outRank.condorcetMargin",
  "sig.outRank.peerGapToRunnerUp",
]

const NEGATIVE_AXES = [
  "sig.roleTopo.negativeRolePressure",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.outRank.negativePeerPressure",
]

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
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

const baseScore = (row) => {
  const positive = average(POSITIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  const negative = average(NEGATIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  return positive - negative
}

const augmentBucket = (rows = []) => {
  const scored = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      row,
      score: baseScore(row),
    }))
    .sort((left, right) => right.score - left.score || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))
  const topScore = Number(scored[0]?.score ?? 0)
  const hasRunnerUp = scored.length > 1
  const secondScore = hasRunnerUp ? Number(scored[1]?.score ?? topScore) : Math.min(0, topScore)
  const medianScore = Number(scored[Math.floor((scored.length - 1) / 2)]?.score ?? topScore)
  const spread = topScore - Number(scored[scored.length - 1]?.score ?? topScore)
  return scored.map((entry, index) => {
    const wins = scored.filter((peer) => entry.score > peer.score).length
    const rankPct = scored.length <= 1 ? 1 : 1 - index / (scored.length - 1)
    const numericFeatureMap = entry.row?.numericFeatureMap ?? {}
    numericFeatureMap["sig.slateArchetype.selection.baseScore"] = entry.score
    numericFeatureMap["sig.slateArchetype.selection.rankPct"] = rankPct
    numericFeatureMap["sig.slateArchetype.selection.gapToTop"] = topScore - entry.score
    numericFeatureMap["sig.slateArchetype.selection.gapToRunnerUp"] = entry.score - secondScore
    numericFeatureMap["sig.slateArchetype.consensus.peerWinShare"] = scored.length > 1 ? wins / (scored.length - 1) : 1
    numericFeatureMap["sig.slateArchetype.counterfactual.controlGap"] =
      Number(num(entry.row?.numericFeatureMap?.["sig.ctrlResidual.regimeResidualRank"]) ?? 0) +
      Number(num(entry.row?.numericFeatureMap?.["sig.ctrlResidual.nearestNegativeGap"]) ?? 0)
    numericFeatureMap["sig.slateArchetype.composition.peerSpread"] = spread
    numericFeatureMap["sig.slateArchetype.composition.peerAboveMedianGap"] = entry.score - medianScore
    numericFeatureMap["sig.slateArchetype.temporal.carryNet"] =
      Number(num(entry.row?.numericFeatureMap?.["sig.temporalEpisode.episodePositiveCarry"]) ?? 0) -
      Number(num(entry.row?.numericFeatureMap?.["sig.temporalEpisode.episodeNegativePressure"]) ?? 0)
    numericFeatureMap["sig.slateArchetype.border.riskMargin"] =
      Number(num(entry.row?.numericFeatureMap?.["sig.ctrlResidual.nearestNegativeGap"]) ?? 0) -
      Number(num(entry.row?.numericFeatureMap?.["sig.ctrlResidual.regimeResidualRisk"]) ?? 0)
    numericFeatureMap["sig.slateArchetype.selection.winnerSupportResidual"] =
      Number(numericFeatureMap["sig.slateArchetype.selection.baseScore"] ?? 0) +
      Number(numericFeatureMap["sig.slateArchetype.temporal.carryNet"] ?? 0) +
      Number(numericFeatureMap["sig.slateArchetype.border.riskMargin"] ?? 0)
    entry.row.numericFeatureMap = numericFeatureMap
    return entry.row
  })
}

const augmentRows = ({ rows = [] } = {}) => {
  const byQuery = groupRowsByQuery(rows)
  const augmented = []
  for (const bucket of byQuery.values()) {
    augmented.push(...augmentBucket(bucket))
  }
  return augmented
}

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.slateArchetype.")),
    ),
  )

export const buildPerfectPrototypeRecentMidLowWinnerQueryFeatures = ({ family } = {}) => {
  const trainRows = augmentRows({ rows: family?.trainRows ?? [] })
  const gatedTrainRows = augmentRows({ rows: family?.gatedTrainRows ?? [] })
  const oosRows = augmentRows({ rows: family?.oosRows ?? [] })
  const supportCaseViews = augmentRows({ rows: family?.supportCaseViews ?? [] })
  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const winnerQueryFeatureKeys = collectFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  return {
    ...family,
    ok: winnerQueryFeatureKeys.length > 0,
    reason: winnerQueryFeatureKeys.length > 0 ? null : "unsat_no_recent_mid_low_winner_query_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    winnerQueryFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      winnerQueryFeatureReady: winnerQueryFeatureKeys.length > 0,
      winnerQueryFeatureCount: winnerQueryFeatureKeys.length,
    },
  }
}
