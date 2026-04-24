const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const safeValue = (row, featureKey, fallback = 0) => Number(num(row?.numericFeatureMap?.[featureKey]) ?? fallback)

const buildRowLookup = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

const buildQueryLookup = (rows = []) => {
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

const buildTokenFrequency = (rows = []) => {
  const counts = new Map()
  const total = Math.max(1, Array.isArray(rows) ? rows.length : 0)
  for (const row of Array.isArray(rows) ? rows : []) {
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.categoricalTokens ?? [])
    for (const token of tokenSet) {
      counts.set(token, Number(counts.get(token) ?? 0) + 1)
    }
  }
  return {
    total,
    counts,
  }
}

const tokenAffinity = (row, tokenFrequency) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.categoricalTokens ?? [])
  const tokens = Array.from(tokenSet.values()).filter(Boolean)
  if (tokens.length < 1) return 0
  const total = Math.max(1, Number(tokenFrequency?.total ?? 1))
  return (
    tokens.reduce((sum, token) => sum + Number(tokenFrequency?.counts?.get(token) ?? 0) / total, 0) /
    tokens.length
  )
}

const buildCentroid = (rows = [], axes = []) => {
  const safeAxes = uniqueStrings(axes)
  return Object.fromEntries(
    safeAxes.map((featureKey) => [featureKey, average((rows ?? []).map((row) => row?.numericFeatureMap?.[featureKey])) ?? 0]),
  )
}

const centroidDistance = (row, centroid = {}, axes = []) => {
  const safeAxes = uniqueStrings(axes)
  if (safeAxes.length < 1) return 0
  let sum = 0
  let count = 0
  for (const featureKey of safeAxes) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const centroidValue = num(centroid?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(centroidValue)) continue
    sum += Math.abs(rowValue - centroidValue)
    count += 1
  }
  return count > 0 ? sum / count : 0
}

const buildQuerySummary = (rows = []) => {
  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      rowKey: row?.rowKey ?? null,
      baseScore: safeValue(row, "sig.prejump.baseSelectionScore"),
      seqCarry:
        average([
          safeValue(row, "seq40.mean"),
          safeValue(row, "seq40.delta"),
          safeValue(row, "seq150.mean"),
          safeValue(row, "seq150.delta"),
        ]) ?? 0,
      seqRisk:
        average([
          safeValue(row, "seq40.stdev"),
          safeValue(row, "seq150.stdev"),
          safeValue(row, "seq40.negativeShare"),
          safeValue(row, "seq150.negativeShare"),
        ]) ?? 0,
    }))
    .sort((left, right) => right.baseScore - left.baseScore || String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")))
  const baseScores = ranked.map((entry) => entry.baseScore).filter(Number.isFinite)
  const carryScores = ranked.map((entry) => entry.seqCarry).filter(Number.isFinite)
  const riskScores = ranked.map((entry) => entry.seqRisk).filter(Number.isFinite)
  const rankIndexByRowKey = new Map(ranked.map((entry, index) => [entry.rowKey, index]))
  return {
    candidateCount: ranked.length,
    topBaseScore: ranked[0]?.baseScore ?? 0,
    secondBaseScore: ranked[1]?.baseScore ?? ranked[0]?.baseScore ?? 0,
    meanBaseScore: average(baseScores) ?? 0,
    meanCarryScore: average(carryScores) ?? 0,
    meanRiskScore: average(riskScores) ?? 0,
    rankIndexByRowKey,
  }
}

const PORTFOLIO_CENTROID_AXES = [
  "sig.prejump.baseSelectionScore",
  "seq40.mean",
  "seq40.delta",
  "seq40.last",
  "seq40.positiveShare",
  "seq40.negativeShare",
  "seq40.stdev",
  "seq150.mean",
  "seq150.delta",
  "seq150.last",
  "seq150.positiveShare",
  "seq150.negativeShare",
  "seq150.stdev",
]

const hypothesisDefinitions = () => [
  {
    id: "H1",
    label: "winner_slate_archetype",
    featureKeys: [
      "sig.portfolio.h1.rankShare",
      "sig.portfolio.h1.baseGapToMean",
      "sig.portfolio.h1.runnerUpMargin",
      "sig.portfolio.h1.tokenMargin",
      "sig.portfolio.h1.seqCarryMargin",
    ],
  },
  {
    id: "H2",
    label: "episode_transition",
    featureKeys: [
      "sig.portfolio.h2.episodeCarry",
      "sig.portfolio.h2.episodePressure",
      "sig.portfolio.h2.episodeCohesion",
      "sig.portfolio.h2.episodeTokenAgreement",
      "sig.portfolio.h2.episodeMargin",
    ],
  },
  {
    id: "H3",
    label: "trade_vs_abstain",
    featureKeys: [
      "sig.portfolio.h3.querySignalSpread",
      "sig.portfolio.h3.querySignalDensity",
      "sig.portfolio.h3.tradeMargin",
      "sig.portfolio.h3.abstainRisk",
      "sig.portfolio.h3.tokenBreadthBias",
    ],
  },
  {
    id: "H4",
    label: "execution_realizable",
    featureKeys: [
      "sig.portfolio.h4.liquidityMargin",
      "sig.portfolio.h4.stabilityMargin",
      "sig.portfolio.h4.executionEdge",
      "sig.portfolio.h4.executionRisk",
      "sig.portfolio.h4.realizableMargin",
    ],
  },
  {
    id: "H5",
    label: "latent_witness",
    featureKeys: [
      "sig.portfolio.h5.positiveCentroidMargin",
      "sig.portfolio.h5.tokenWitnessMargin",
      "sig.portfolio.h5.witnessComposite",
      "sig.portfolio.h5.negativeCentroidPressure",
      "sig.portfolio.h5.supportRecoveryPotential",
    ],
  },
]

export const buildPerfectPrototypePrejumpHypothesisPortfolioFeatures = ({ family } = {}) => {
  const trainRows = Array.isArray(family?.trainRows) ? family.trainRows : []
  const oosRows = Array.isArray(family?.oosRows) ? family.oosRows : []
  const supportCaseViews = Array.isArray(family?.supportCaseViews) ? family.supportCaseViews : []
  const calibrationPositiveRows = Array.isArray(family?.calibrationPositiveRows) ? family.calibrationPositiveRows : []
  const calibrationNegativeRows = Array.isArray(family?.calibrationNegativeRows) ? family.calibrationNegativeRows : []

  const positiveTokenFrequency = buildTokenFrequency(calibrationPositiveRows)
  const negativeTokenFrequency = buildTokenFrequency(calibrationNegativeRows)
  const positiveCentroid = buildCentroid(calibrationPositiveRows, PORTFOLIO_CENTROID_AXES)
  const negativeCentroid = buildCentroid(calibrationNegativeRows, PORTFOLIO_CENTROID_AXES)

  const queryLookup = buildQueryLookup(trainRows)
  for (const row of oosRows) {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    const bucket = queryLookup.get(queryId) ?? []
    bucket.push(row)
    queryLookup.set(queryId, bucket)
  }
  for (const row of supportCaseViews) {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    const bucket = queryLookup.get(queryId) ?? []
    bucket.push(row)
    queryLookup.set(queryId, bucket)
  }
  const querySummaries = new Map(Array.from(queryLookup.entries()).map(([queryId, rows]) => [queryId, buildQuerySummary(rows)]))

  const augmentRow = (row) => {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    const querySummary = querySummaries.get(queryId) ?? buildQuerySummary([row])
    const candidateCount = Math.max(1, Number(querySummary?.candidateCount ?? 1))
    const baseScore = safeValue(row, "sig.prejump.baseSelectionScore")
    const seqCarry =
      average([
        safeValue(row, "seq40.mean"),
        safeValue(row, "seq40.delta"),
        safeValue(row, "seq150.mean"),
        safeValue(row, "seq150.delta"),
      ]) ?? 0
    const seqRisk =
      average([
        safeValue(row, "seq40.stdev"),
        safeValue(row, "seq150.stdev"),
        safeValue(row, "seq40.negativeShare"),
        safeValue(row, "seq150.negativeShare"),
      ]) ?? 0
    const tokenPositiveAffinity = tokenAffinity(row, positiveTokenFrequency)
    const tokenNegativeAffinity = tokenAffinity(row, negativeTokenFrequency)
    const tokenMargin = tokenPositiveAffinity - tokenNegativeAffinity
    const rankIndex = Number(querySummary?.rankIndexByRowKey?.get(row?.rowKey) ?? 0)
    const rankShare = candidateCount <= 1 ? 1 : 1 - rankIndex / Math.max(1, candidateCount - 1)
    const querySignalSpread = Number(querySummary?.topBaseScore ?? 0) - Number(querySummary?.meanBaseScore ?? 0)
    const runnerUpMargin =
      rankIndex === 0
        ? baseScore - Number(querySummary?.secondBaseScore ?? querySummary?.topBaseScore ?? baseScore)
        : baseScore - Number(querySummary?.topBaseScore ?? baseScore)
    const baseGapToMean = baseScore - Number(querySummary?.meanBaseScore ?? 0)
    const seqCarryMargin = seqCarry - seqRisk
    const liquidity =
      average([
        safeValue(row, "feature.avgTradingValue20d"),
        safeValue(row, "global.avgTradingValue20d"),
        safeValue(row, "feature.marketCapKrw"),
        safeValue(row, "global.marketCapKrw"),
      ]) ?? 0
    const stabilityMargin =
      average([
        -safeValue(row, "seq40.stdev"),
        -safeValue(row, "seq150.stdev"),
        safeValue(row, "seq40.positiveShare"),
        safeValue(row, "seq150.positiveShare"),
      ]) ?? 0
    const positiveCentroidDistance = centroidDistance(row, positiveCentroid, PORTFOLIO_CENTROID_AXES)
    const negativeCentroidDistance = centroidDistance(row, negativeCentroid, PORTFOLIO_CENTROID_AXES)
    const positiveCentroidMargin = negativeCentroidDistance - positiveCentroidDistance
    const executionEdge = baseGapToMean + 0.5 * seqCarryMargin + tokenMargin
    const executionRisk = Math.max(0, seqRisk - tokenMargin)
    const witnessComposite = positiveCentroidMargin + tokenMargin + 0.5 * seqCarryMargin
    const numericFeatureMap = {
      ...(row?.numericFeatureMap ?? {}),
      "sig.portfolio.h1.rankShare": rankShare,
      "sig.portfolio.h1.baseGapToMean": baseGapToMean,
      "sig.portfolio.h1.runnerUpMargin": runnerUpMargin,
      "sig.portfolio.h1.tokenMargin": tokenMargin,
      "sig.portfolio.h1.seqCarryMargin": seqCarryMargin,

      "sig.portfolio.h2.episodeCarry": seqCarry,
      "sig.portfolio.h2.episodePressure": seqRisk,
      "sig.portfolio.h2.episodeCohesion": seqCarry - Number(querySummary?.meanCarryScore ?? 0),
      "sig.portfolio.h2.episodeTokenAgreement": tokenMargin,
      "sig.portfolio.h2.episodeMargin": seqCarryMargin + tokenMargin,

      "sig.portfolio.h3.querySignalSpread": querySignalSpread,
      "sig.portfolio.h3.querySignalDensity": querySignalSpread / candidateCount,
      "sig.portfolio.h3.tradeMargin": baseGapToMean + tokenMargin,
      "sig.portfolio.h3.abstainRisk": Math.max(0, Number(querySummary?.meanRiskScore ?? 0) + seqRisk - tokenPositiveAffinity),
      "sig.portfolio.h3.tokenBreadthBias": tokenPositiveAffinity,

      "sig.portfolio.h4.liquidityMargin": liquidity,
      "sig.portfolio.h4.stabilityMargin": stabilityMargin,
      "sig.portfolio.h4.executionEdge": executionEdge,
      "sig.portfolio.h4.executionRisk": executionRisk,
      "sig.portfolio.h4.realizableMargin": executionEdge - executionRisk,

      "sig.portfolio.h5.positiveCentroidMargin": positiveCentroidMargin,
      "sig.portfolio.h5.tokenWitnessMargin": tokenMargin,
      "sig.portfolio.h5.witnessComposite": witnessComposite,
      "sig.portfolio.h5.negativeCentroidPressure": Math.max(0, positiveCentroidDistance - negativeCentroidDistance),
      "sig.portfolio.h5.supportRecoveryPotential": witnessComposite + rankShare,

      "sig.ctrlResidual.controlCentroidGap": positiveCentroidMargin,
      "sig.ctrlResidual.nearestNegativeGap": runnerUpMargin + tokenMargin,
      "sig.ctrlResidual.regimeResidualRank": witnessComposite,
      "sig.ctrlResidual.regimeResidualRisk": Math.max(0, executionRisk + Number(querySummary?.meanRiskScore ?? 0)),
      "sig.outRank.negativePeerPressure": Math.max(0, Number(querySummary?.topBaseScore ?? 0) - baseScore + seqRisk - tokenMargin),
    }
    return {
      ...row,
      numericFeatureMap,
      tokenSet: row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.categoricalTokens ?? []),
    }
  }

  const augmentedTrainRows = trainRows.map(augmentRow)
  const augmentedOosRows = oosRows.map(augmentRow)
  const augmentedSupportCaseViews = supportCaseViews.map(augmentRow)
  const rowLookup = buildRowLookup([...augmentedTrainRows, ...augmentedOosRows, ...augmentedSupportCaseViews])
  const portfolioHypotheses = hypothesisDefinitions()
  const portfolioFeatureKeys = uniqueStrings(portfolioHypotheses.flatMap((entry) => entry.featureKeys))

  return {
    ...family,
    ok: portfolioFeatureKeys.length > 0,
    reason: portfolioFeatureKeys.length > 0 ? null : "unsat_no_prejump_portfolio_features",
    trainRows: augmentedTrainRows,
    gatedTrainRows: augmentedTrainRows,
    oosRows: augmentedOosRows,
    supportCaseViews: augmentedSupportCaseViews,
    bridgePositiveRows: (family?.bridgePositiveRows ?? []).map((row) => rowLookup.get(row?.rowKey) ?? row),
    supportNearHardNegativeRows: (family?.supportNearHardNegativeRows ?? []).map(
      (row) => rowLookup.get(row?.rowKey) ?? row,
    ),
    calibrationPositiveRows: (family?.calibrationPositiveRows ?? []).map((row) => rowLookup.get(row?.rowKey) ?? row),
    calibrationNegativeRows: (family?.calibrationNegativeRows ?? []).map((row) => rowLookup.get(row?.rowKey) ?? row),
    portfolioHypotheses,
    portfolioFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      portfolioHypothesisCount: portfolioHypotheses.length,
      portfolioFeatureCount: portfolioFeatureKeys.length,
      portfolioCentroidAxisCount: PORTFOLIO_CENTROID_AXES.length,
    },
  }
}
