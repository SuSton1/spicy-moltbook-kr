const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((left, right) => left - right)

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

const episodeAxisValue = (row, featureKey) => {
  const direct = num(row?.numericFeatureMap?.[featureKey])
  if (Number.isFinite(direct)) return direct
  return null
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

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

const EPISODE_AXES = [
  "sig.ordinalMotif.motifAgreement",
  "sig.ordinalMotif.supportRecoveryPotential",
  "sig.recurBoundary.localBreadthPurityGap",
  "sig.recurBoundary.localRecoveryMargin",
  "sig.recurBoundary.crossfitLeakShare",
  "sig.boundary.supportRecoveryPotential",
]

const buildDateBagStats = ({ dateKey, rows = [], positiveDateKeys = new Set(), negativeDateKeys = new Set() } = {}) => {
  const monthKey = buildMonthKey(dateKey)
  const foldIds = uniqueNumbers(rows.map((row) => row?.foldId))
  const axisMeans = Object.fromEntries(
    EPISODE_AXES.map((featureKey) => [
      featureKey,
      average(rows.map((row) => episodeAxisValue(row, featureKey))),
    ]),
  )
  const positiveRowCount = rows.filter((row) => row?.outcomeHitTarget === true).length
  return {
    dateKey,
    monthKey,
    foldIds,
    rowCount: rows.length,
    positiveRowCount,
    positiveShare: rows.length > 0 ? positiveRowCount / rows.length : 0,
    bagLabel: positiveDateKeys.has(dateKey) ? "positive" : negativeDateKeys.has(dateKey) ? "negative" : "unlabeled",
    axisMeans,
  }
}

const buildEpisodeLookup = ({ rows = [], positiveDateKeys = new Set(), negativeDateKeys = new Set(), lookbackTradingDays = 4 } = {}) => {
  const byDate = groupRowsByDate(rows)
  const orderedDateKeys = Array.from(byDate.keys()).sort((left, right) => left.localeCompare(right))
  const bagStats = orderedDateKeys.map((dateKey) =>
    buildDateBagStats({
      dateKey,
      rows: byDate.get(dateKey) ?? [],
      positiveDateKeys,
      negativeDateKeys,
    }),
  )
  const lookup = new Map()
  for (let index = 0; index < bagStats.length; index += 1) {
    const current = bagStats[index]
    const lookback = []
    for (
      let prevIndex = Math.max(0, index - Math.max(1, Math.floor(Number(lookbackTradingDays) || 4)));
      prevIndex < index;
      prevIndex += 1
    ) {
      lookback.push(bagStats[prevIndex])
    }
    const priorPositiveBags = lookback.filter((entry) => entry.bagLabel === "positive")
    const priorNegativeBags = lookback.filter((entry) => entry.bagLabel === "negative")
    const summary = {
      episodeIndex: index,
      lookbackCount: lookback.length,
      priorPositiveBagCount: priorPositiveBags.length,
      priorNegativeBagCount: priorNegativeBags.length,
      priorPositiveShareMean: average(priorPositiveBags.map((entry) => entry.positiveShare)) ?? 0,
      priorNegativeShareMean: average(priorNegativeBags.map((entry) => entry.positiveShare)) ?? 0,
      priorRowCountMean: average(lookback.map((entry) => entry.rowCount)) ?? 0,
      priorBagDiversity: new Set(lookback.map((entry) => entry.bagLabel)).size,
      currentPositiveShare: Number(current.positiveShare ?? 0),
      currentRowCount: Number(current.rowCount ?? 0),
      axisMeans: current.axisMeans,
      priorAxisMeans: Object.fromEntries(
        EPISODE_AXES.map((featureKey) => [
          featureKey,
          average(lookback.map((entry) => entry.axisMeans?.[featureKey])),
        ]),
      ),
    }
    lookup.set(current.dateKey, summary)
  }
  return {
    orderedDateKeys,
    bagStats,
    lookup,
  }
}

const augmentRowsWithEpisode = ({ rows = [], episodeLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const dateKey = String(row?.dateKey ?? "").trim()
    const episode = episodeLookup.get(dateKey) ?? {
      episodeIndex: -1,
      lookbackCount: 0,
      priorPositiveBagCount: 0,
      priorNegativeBagCount: 0,
      priorPositiveShareMean: 0,
      priorNegativeShareMean: 0,
      priorRowCountMean: 0,
      priorBagDiversity: 0,
      currentPositiveShare: 0,
      currentRowCount: 0,
      axisMeans: {},
      priorAxisMeans: {},
    }
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    numericFeatureMap["sig.temporalEpisode.lookbackCount"] = Number(episode.lookbackCount ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorPositiveBagCount"] = Number(episode.priorPositiveBagCount ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorNegativeBagCount"] = Number(episode.priorNegativeBagCount ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorPositiveShareMean"] = Number(episode.priorPositiveShareMean ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorNegativeShareMean"] = Number(episode.priorNegativeShareMean ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorRowCountMean"] = Number(episode.priorRowCountMean ?? 0)
    numericFeatureMap["sig.temporalEpisode.priorBagDiversity"] = Number(episode.priorBagDiversity ?? 0)
    numericFeatureMap["sig.temporalEpisode.currentPositiveShare"] = Number(episode.currentPositiveShare ?? 0)
    numericFeatureMap["sig.temporalEpisode.currentRowCount"] = Number(episode.currentRowCount ?? 0)
    numericFeatureMap["sig.temporalEpisode.episodePositiveCarry"] =
      Number(episode.priorPositiveBagCount ?? 0) + Number(episode.priorPositiveShareMean ?? 0)
    numericFeatureMap["sig.temporalEpisode.episodeNegativePressure"] =
      Number(episode.priorNegativeBagCount ?? 0) + Math.max(0, 1 - Number(episode.priorNegativeShareMean ?? 0))
    numericFeatureMap["sig.temporalEpisode.episodeWindowDiversity"] = Number(episode.priorBagDiversity ?? 0)
    for (const featureKey of EPISODE_AXES) {
      const safeKey = featureKey.replace(/^sig\./, "").replaceAll(".", "_")
      const currentMean = num(episode.axisMeans?.[featureKey]) ?? 0
      const priorMean = num(episode.priorAxisMeans?.[featureKey]) ?? 0
      numericFeatureMap[`sig.temporalEpisode.currentMean.${safeKey}`] = currentMean
      numericFeatureMap[`sig.temporalEpisode.priorMean.${safeKey}`] = priorMean
      numericFeatureMap[`sig.temporalEpisode.delta.${safeKey}`] = currentMean - priorMean
    }
    row.numericFeatureMap = numericFeatureMap
    row.episodeIndex = Number(episode.episodeIndex ?? -1)
    return row
  })

const collectEpisodeFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.temporalEpisode.")),
    ),
  )

export const buildPerfectPrototypeSupportTemporalEpisodeDataset = ({
  family,
  lookbackTradingDays = 4,
} = {}) => {
  const positiveDateKeys = new Set((family?.bridgePositiveRows ?? []).map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean))
  const negativeDateKeys = new Set((family?.supportNearHardNegativeRows ?? []).map((row) => String(row?.dateKey ?? "").trim()).filter(Boolean))

  const trainEpisode = buildEpisodeLookup({
    rows: family?.gatedTrainRows ?? [],
    positiveDateKeys,
    negativeDateKeys,
    lookbackTradingDays,
  })
  const oosEpisode = buildEpisodeLookup({
    rows: family?.oosRows ?? [],
    positiveDateKeys: new Set(),
    negativeDateKeys: new Set(),
    lookbackTradingDays,
  })

  const trainRows = augmentRowsWithEpisode({ rows: family?.trainRows ?? [], episodeLookup: trainEpisode.lookup })
  const gatedTrainRows = augmentRowsWithEpisode({ rows: family?.gatedTrainRows ?? [], episodeLookup: trainEpisode.lookup })
  const oosRows = augmentRowsWithEpisode({ rows: family?.oosRows ?? [], episodeLookup: oosEpisode.lookup })
  const supportCaseViews = augmentRowsWithEpisode({ rows: family?.supportCaseViews ?? [], episodeLookup: trainEpisode.lookup })

  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const supportLookup = new Map(supportCaseViews.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map((row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row)
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )

  const episodeFeatureKeys = collectEpisodeFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  return {
    ...family,
    ok: trainEpisode.orderedDateKeys.length > 0,
    reason: trainEpisode.orderedDateKeys.length > 0 ? null : "unsat_no_episode_windows",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    episodeFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      temporalEpisodeReady: trainEpisode.orderedDateKeys.length > 0,
      temporalEpisodeLookbackTradingDays: Math.max(1, Math.floor(Number(lookbackTradingDays) || 4)),
      episodeCandidateCount: trainEpisode.orderedDateKeys.length,
      episodePositiveCount: positiveDateKeys.size,
      episodeNegativeCount: negativeDateKeys.size,
      episodePositiveSummary: summarizeRows(bridgePositiveRows),
      episodeNegativeSummary: summarizeRows(supportNearHardNegativeRows),
      episodeFeatureCount: episodeFeatureKeys.length,
    },
  }
}
