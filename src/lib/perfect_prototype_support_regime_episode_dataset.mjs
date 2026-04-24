const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const uniqueNumbers = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((left, right) => left - right)

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0),
  ).size,
})

const POSITIVE_AXES = [
  "sig.outRank.top1SelectionPotential",
  "sig.outRank.consensusWinShare",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
]

const NEGATIVE_AXES = [
  "sig.outRank.negativePeerPressure",
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
]

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = toText(row?.dateKey)
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const proxyScoreOf = (row) => {
  const positiveScore = average(POSITIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  const negativeScore = average(NEGATIVE_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  return positiveScore - negativeScore
}

const baseAxisMap = (rows = []) => ({
  positiveCarry: average(rows.map((row) => row?.numericFeatureMap?.["sig.temporalEpisode.episodePositiveCarry"])) ?? 0,
  negativePressure: average(rows.map((row) => row?.numericFeatureMap?.["sig.temporalEpisode.episodeNegativePressure"])) ?? 0,
  residualRank: average(rows.map((row) => row?.numericFeatureMap?.["sig.ctrlResidual.regimeResidualRank"])) ?? 0,
  residualRisk: average(rows.map((row) => row?.numericFeatureMap?.["sig.ctrlResidual.regimeResidualRisk"])) ?? 0,
  rolePurityLift: average(rows.map((row) => row?.numericFeatureMap?.["sig.roleTopo.rolePurityLift"])) ?? 0,
  roleBreadthCarry: average(rows.map((row) => row?.numericFeatureMap?.["sig.roleTopo.roleBreadthCarry"])) ?? 0,
  roleCohesion: average(rows.map((row) => row?.numericFeatureMap?.["sig.roleTopo.roleCohesion"])) ?? 0,
  peerPressure: average(rows.map((row) => row?.numericFeatureMap?.["sig.outRank.negativePeerPressure"])) ?? 0,
  top1Potential: average(rows.map((row) => row?.numericFeatureMap?.["sig.outRank.top1SelectionPotential"])) ?? 0,
})

const buildEpisodeSummaries = ({
  rows = [],
  positiveDateKeys = new Set(),
  negativeDateKeys = new Set(),
  lookbackTradingDays = 4,
} = {}) => {
  const byDate = groupRowsByDate(rows)
  const orderedDateKeys = Array.from(byDate.keys()).sort((left, right) => left.localeCompare(right))
  const baseSummaries = orderedDateKeys.map((dateKey) => {
    const bucket = byDate.get(dateKey) ?? []
    const sortedRows = [...bucket].sort((left, right) => proxyScoreOf(right) - proxyScoreOf(left))
    const witnessRow = sortedRows[0] ?? null
    const runnerUpRow = sortedRows[1] ?? null
    const witnessScore = proxyScoreOf(witnessRow)
    const runnerUpScore = proxyScoreOf(runnerUpRow)
    const axisMap = baseAxisMap(bucket)
    return {
      episodeId: dateKey,
      dateKey,
      monthKey: buildMonthKey(dateKey),
      foldIds: uniqueNumbers(bucket.map((row) => row?.foldId)),
      windowIds: uniqueNumbers(bucket.map((row) => row?.windowId)),
      rowCount: bucket.length,
      positiveRowCount: bucket.filter((row) => row?.outcomeHitTarget === true).length,
      label: positiveDateKeys.has(dateKey) ? "positive" : negativeDateKeys.has(dateKey) ? "negative" : "unlabeled",
      witnessRowKey: witnessRow?.rowKey ?? null,
      witnessScore,
      runnerUpScore,
      top1Gap: Number.isFinite(witnessScore) && Number.isFinite(runnerUpScore) ? witnessScore - runnerUpScore : 0,
      roleSignatures: uniqueStrings(bucket.map((row) => row?.roleTopologySignature)),
      axisMap,
      featureMap: {},
    }
  })

  const lookup = new Map()
  for (let index = 0; index < baseSummaries.length; index += 1) {
    const current = baseSummaries[index]
    const lookback = baseSummaries.slice(Math.max(0, index - Math.max(1, Math.floor(Number(lookbackTradingDays) || 4))), index)
    const priorPositive = lookback.filter((entry) => entry.label === "positive")
    const priorNegative = lookback.filter((entry) => entry.label === "negative")
    const priorPositiveWitnessMean = average(priorPositive.map((entry) => entry.witnessScore)) ?? 0
    const priorNegativeWitnessMean = average(priorNegative.map((entry) => entry.witnessScore)) ?? 0
    const featureMap = {
      "sig.epTransition.node.rowCount": Number(current.rowCount ?? 0),
      "sig.epTransition.node.positiveShare":
        Number(current.rowCount ?? 0) > 0 ? Number(current.positiveRowCount ?? 0) / Number(current.rowCount ?? 1) : 0,
      "sig.epTransition.turn.witnessScore": Number(current.witnessScore ?? 0),
      "sig.epTransition.turn.witnessGap": Number(current.top1Gap ?? 0),
      "sig.epTransition.persistence.priorPositiveEpisodeCount": priorPositive.length,
      "sig.epTransition.persistence.priorNegativeEpisodeCount": priorNegative.length,
      "sig.epTransition.persistence.priorPositiveWitnessMean": priorPositiveWitnessMean,
      "sig.epTransition.persistence.priorNegativeWitnessMean": priorNegativeWitnessMean,
      "sig.epTransition.controlResidual.episodeResidualRank": Number(current.axisMap?.residualRank ?? 0),
      "sig.epTransition.peerAnchorGap.rowWinnerGap": Number(current.top1Gap ?? 0),
      "sig.epTransition.regimeTransition.positiveTrend":
        Number(current.axisMap?.positiveCarry ?? 0) - Number(average(lookback.map((entry) => entry.axisMap?.positiveCarry)) ?? 0),
      "sig.epTransition.pathCohesion":
        Number(current.axisMap?.roleCohesion ?? 0) + Number(current.axisMap?.rolePurityLift ?? 0) + Number(current.witnessScore ?? 0),
      "sig.epTransition.pathLeakPressure":
        priorNegative.length +
        Math.max(0, Number(current.axisMap?.negativePressure ?? 0)) +
        Math.max(0, Number(current.axisMap?.peerPressure ?? 0)) +
        Math.max(0, -Number(current.axisMap?.residualRank ?? 0)),
      "sig.epTransition.pathRecurrenceCarry":
        priorPositive.length +
        Math.max(0, Number(current.axisMap?.positiveCarry ?? 0)) +
        Math.max(0, Number(current.axisMap?.roleBreadthCarry ?? 0)),
      "sig.epTransition.pathPrototypeMargin":
        Number(current.witnessScore ?? 0) -
        Math.max(
          0,
          Number(current.axisMap?.negativePressure ?? 0) + Number(current.axisMap?.peerPressure ?? 0),
        ),
    }
    const summary = {
      ...current,
      lookbackCount: lookback.length,
      featureMap,
    }
    lookup.set(current.dateKey, summary)
    baseSummaries[index] = summary
  }
  return { orderedDateKeys, lookup, summaries: baseSummaries }
}

const annotateRows = ({ rows = [], episodeLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const episode = episodeLookup.get(String(row?.dateKey ?? "").trim())
    if (!episode) return row
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    for (const [featureKey, value] of Object.entries(episode.featureMap ?? {})) {
      numericFeatureMap[featureKey] = Number(value ?? 0)
    }
    row.numericFeatureMap = numericFeatureMap
    row.episodeId = episode.episodeId
    return row
  })

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.epTransition.")),
    ),
  )

export const buildPerfectPrototypeSupportRegimeEpisodeDataset = ({
  family,
  lookbackTradingDays = 4,
} = {}) => {
  const positiveDateKeys = new Set(family?.fitPositiveSeedDateKeys ?? [])
  const negativeDateKeys = new Set(family?.fitNegativeSeedDateKeys ?? [])
  const trainEpisode = buildEpisodeSummaries({
    rows: family?.fitGatedTrainRows ?? [],
    positiveDateKeys,
    negativeDateKeys,
    lookbackTradingDays,
  })
  const oosEpisode = buildEpisodeSummaries({
    rows: family?.oosRows ?? [],
    positiveDateKeys: new Set(),
    negativeDateKeys: new Set(),
    lookbackTradingDays,
  })
  const supportEpisode = buildEpisodeSummaries({
    rows: family?.supportCaseViews ?? [],
    positiveDateKeys: new Set(),
    negativeDateKeys: new Set(),
    lookbackTradingDays,
  })

  const fitTrainRows = annotateRows({ rows: family?.fitTrainRows ?? [], episodeLookup: trainEpisode.lookup })
  const fitGatedTrainRows = annotateRows({ rows: family?.fitGatedTrainRows ?? [], episodeLookup: trainEpisode.lookup })
  const oosRows = annotateRows({ rows: family?.oosRows ?? [], episodeLookup: oosEpisode.lookup })
  const supportCaseViews = annotateRows({ rows: family?.supportCaseViews ?? [], episodeLookup: supportEpisode.lookup })

  const fitLookup = new Map(fitGatedTrainRows.map((row) => [row?.rowKey, row]))
  const fitBridgePositiveRows = (family?.fitBridgePositiveRows ?? []).map((row) => fitLookup.get(row?.rowKey) ?? row)
  const fitSupportNearHardNegativeRows = (family?.fitSupportNearHardNegativeRows ?? []).map(
    (row) => fitLookup.get(row?.rowKey) ?? row,
  )
  const epTransitionFeatureKeys = collectFeatureKeys([...fitTrainRows, ...oosRows, ...supportCaseViews])
  const ok = trainEpisode.orderedDateKeys.length > 0 && epTransitionFeatureKeys.length > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_regime_episode_dataset",
    fitTrainRows,
    fitGatedTrainRows,
    fitBridgePositiveRows,
    fitSupportNearHardNegativeRows,
    oosRows,
    supportCaseViews,
    trainEpisodeSummaries: trainEpisode.summaries,
    oosEpisodeSummaries: oosEpisode.summaries,
    supportEpisodeSummaries: supportEpisode.summaries,
    epTransitionFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      regimeEpisodeReady: ok,
      regimeEpisodeLookbackTradingDays: Math.max(1, Math.floor(Number(lookbackTradingDays) || 4)),
      regimeEpisodeTrainCount: trainEpisode.summaries.length,
      regimeEpisodePositiveCount: trainEpisode.summaries.filter((entry) => entry.label === "positive").length,
      regimeEpisodeNegativeCount: trainEpisode.summaries.filter((entry) => entry.label === "negative").length,
      regimeEpisodeFeatureCount: epTransitionFeatureKeys.length,
      fitEpisodePositiveSummary: summarizeRows(fitBridgePositiveRows),
      fitEpisodeNegativeSummary: summarizeRows(fitSupportNearHardNegativeRows),
    },
  }
}
