const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const POSITIVE_AXES = [
  "sig.slateArchetype.selection.winnerSupportResidual",
  "sig.outRank.top1SelectionPotential",
  "sig.outRank.consensusWinShare",
  "sig.outRank.peerGapToRunnerUp",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.ctrlResidual.nearestNegativeGap",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.complementPocketAffinity",
]

const NEGATIVE_AXES = [
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.outRank.negativePeerPressure",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleUncertainty",
]

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
  const runnerUpScore = scored.length > 1 ? Number(scored[1]?.score ?? topScore) : Math.min(0, topScore)
  const medianScore = Number(scored[Math.floor((scored.length - 1) / 2)]?.score ?? topScore)
  const spread = topScore - Number(scored[scored.length - 1]?.score ?? topScore)
  return scored.map((entry, index) => {
    const row = entry.row
    const wins = scored.filter((peer) => entry.score > peer.score).length
    const rankPct = scored.length <= 1 ? 1 : 1 - index / (scored.length - 1)
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    const carryNet =
      Number(num(numericFeatureMap?.["sig.temporalEpisode.episodePositiveCarry"]) ?? 0) -
      Number(num(numericFeatureMap?.["sig.temporalEpisode.episodeNegativePressure"]) ?? 0)
    const roleNet =
      Number(num(numericFeatureMap?.["sig.roleTopo.rolePurityLift"]) ?? 0) +
      Number(num(numericFeatureMap?.["sig.roleTopo.roleBreadthCarry"]) ?? 0) +
      Number(num(numericFeatureMap?.["sig.roleTopo.complementPocketAffinity"]) ?? 0) -
      Number(num(numericFeatureMap?.["sig.roleTopo.negativeRolePressure"]) ?? 0)
    const cleanResidual =
      Number(num(numericFeatureMap?.["sig.ctrlResidual.regimeResidualRank"]) ?? 0) +
      Number(num(numericFeatureMap?.["sig.ctrlResidual.nearestNegativeGap"]) ?? 0) -
      Number(num(numericFeatureMap?.["sig.ctrlResidual.regimeResidualRisk"]) ?? 0)
    const impostorPressure =
      Number(num(numericFeatureMap?.["sig.ctrlResidual.regimeResidualRisk"]) ?? 0) +
      Number(num(numericFeatureMap?.["sig.outRank.negativePeerPressure"]) ?? 0)
    const controlProtectedScore = entry.score + carryNet + roleNet + cleanResidual - impostorPressure
    numericFeatureMap["sig.shadowSlate.selection.baseScore"] = entry.score
    numericFeatureMap["sig.shadowSlate.selection.rankPct"] = rankPct
    numericFeatureMap["sig.shadowSlate.selection.peerWinShare"] = scored.length > 1 ? wins / (scored.length - 1) : 1
    numericFeatureMap["sig.shadowSlate.selection.gapToWinner"] = topScore - entry.score
    numericFeatureMap["sig.shadowSlate.selection.gapToRunnerUp"] = entry.score - runnerUpScore
    numericFeatureMap["sig.shadowSlate.selection.swapCost"] = controlProtectedScore - runnerUpScore
    numericFeatureMap["sig.shadowSlate.selection.controlProtectedScore"] = controlProtectedScore
    numericFeatureMap["sig.shadowSlate.composition.peerSpread"] = spread
    numericFeatureMap["sig.shadowSlate.composition.peerAboveMedianGap"] = entry.score - medianScore
    numericFeatureMap["sig.shadowSlate.control.cleanResidual"] = cleanResidual
    numericFeatureMap["sig.shadowSlate.control.impostorPressure"] = impostorPressure
    numericFeatureMap["sig.shadowSlate.temporal.carryNet"] = carryNet
    numericFeatureMap["sig.shadowSlate.topology.roleNet"] = roleNet
    numericFeatureMap["sig.shadowSlate.border.riskMargin"] =
      Number(num(numericFeatureMap?.["sig.ctrlResidual.nearestNegativeGap"]) ?? 0) -
      Number(num(numericFeatureMap?.["sig.ctrlResidual.regimeResidualRisk"]) ?? 0)
    row.numericFeatureMap = numericFeatureMap
    return row
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
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.shadowSlate.")),
    ),
  )

const remapRows = ({ rows = [], preferredLookup = new Map(), fallbackLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => preferredLookup.get(row?.rowKey) ?? fallbackLookup.get(row?.rowKey) ?? row)

export const buildPerfectPrototypeShadowWinnerSlateFeatures = ({ family } = {}) => {
  const trainRows = augmentRows({ rows: family?.trainRows ?? [] })
  const gatedTrainRows = augmentRows({ rows: family?.gatedTrainRows ?? [] })
  const oosRows = augmentRows({ rows: family?.oosRows ?? [] })
  const supportCaseViews = augmentRows({ rows: family?.supportCaseViews ?? [] })
  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const shadowWinnerSlateFeatureKeys = collectFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  const calibrationPositiveRows = remapRows({
    rows: family?.calibrationPositiveRows ?? [],
    preferredLookup: gatedLookup,
    fallbackLookup: trainLookup,
  })
  const calibrationNegativeRows = remapRows({
    rows: family?.calibrationNegativeRows ?? [],
    preferredLookup: gatedLookup,
    fallbackLookup: trainLookup,
  })

  return {
    ...family,
    ok: shadowWinnerSlateFeatureKeys.length > 0,
    reason: shadowWinnerSlateFeatureKeys.length > 0 ? null : "unsat_no_shadow_winner_slate_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    calibrationPositiveRows,
    calibrationNegativeRows,
    shadowWinnerSlateFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      shadowWinnerSlateFeatureReady: shadowWinnerSlateFeatureKeys.length > 0,
      shadowWinnerSlateFeatureCount: shadowWinnerSlateFeatureKeys.length,
    },
  }
}
