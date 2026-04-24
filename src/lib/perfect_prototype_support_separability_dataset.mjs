const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const uniqueRowsByKey = (rows = []) => {
  const deduped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? "").trim()
    if (!rowKey) continue
    if (!deduped.has(rowKey)) deduped.set(rowKey, row)
  }
  return Array.from(deduped.values())
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

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const POSITIVE_PROXY_AXES = [
  "sig.outRank.top1SelectionPotential",
  "sig.outRank.consensusWinShare",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.ctrlResidual.controlCentroidGap",
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.ordinalMotif.motifAgreement",
  "sig.ordinalMotif.supportRecoveryPotential",
  "sig.recurBoundary.localRecoveryMargin",
]

const NEGATIVE_PROXY_AXES = [
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.outRank.negativePeerPressure",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.recurBoundary.crossfitLeakShare",
]

const proxyScoreOf = (row) => {
  const positiveScore = average(POSITIVE_PROXY_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  const negativeScore = average(NEGATIVE_PROXY_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
  return positiveScore - negativeScore
}

const signatureOf = (row) =>
  [
    String(row?.recurBoundaryDominantGroup ?? "").trim() || "NONE",
    String(row?.roleTopologySignature ?? "").trim() || "NONE",
    String(row?.clusterCell ?? "").trim() || "NONE",
  ].join("::")

const pickTopRows = (rows = [], limit = 1) =>
  [...(Array.isArray(rows) ? rows : [])]
    .sort((left, right) => {
      const scoreDelta = proxyScoreOf(right) - proxyScoreOf(left)
      if (scoreDelta !== 0) return scoreDelta
      return String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? ""))
    })
    .slice(0, Math.max(1, Math.floor(Number(limit) || 1)))

const buildPairs = ({ positives = [], negatives = [], pairType }) => {
  const pairs = []
  for (const positiveRow of Array.isArray(positives) ? positives : []) {
    for (const negativeRow of Array.isArray(negatives) ? negatives : []) {
      pairs.push({
        pairType,
        positiveRowKey: positiveRow?.rowKey ?? null,
        negativeRowKey: negativeRow?.rowKey ?? null,
        queryId: String(positiveRow?.queryId ?? positiveRow?.dateKey ?? "").trim() || null,
        foldId: Number(positiveRow?.foldId ?? 0),
      })
    }
  }
  return pairs
}

export const buildPerfectPrototypeSupportSeparabilityDataset = ({ family, sameDateNegativeLimit = 2, matchedControlLimit = 2 } = {}) => {
  const trainRows = Array.isArray(family?.gatedTrainRows) ? family.gatedTrainRows : family?.trainRows ?? []
  const supportCaseViews = Array.isArray(family?.supportCaseViews) ? family.supportCaseViews : []
  const positiveRows = uniqueRowsByKey(family?.bridgePositiveRows ?? [])
  const hardNegativeRows = uniqueRowsByKey(family?.supportNearHardNegativeRows ?? [])
  const byQuery = groupRowsByQuery(trainRows)
  const positiveQueryIds = new Set(
    (family?.trainQuerySummaries ?? []).filter((entry) => entry?.queryLabel === "positive").map((entry) => entry.queryId),
  )
  const negativeQueryIds = new Set(
    (family?.trainQuerySummaries ?? []).filter((entry) => entry?.queryLabel === "negative").map((entry) => entry.queryId),
  )

  const sameDateRunnerUpRows = []
  const sameDatePairs = []
  const matchedControlRows = []
  const matchedControlPairs = []

  const trainByQuery = new Map()
  for (const row of trainRows) {
    const queryId = String(row?.queryId ?? row?.dateKey ?? "").trim()
    if (!queryId) continue
    const bucket = trainByQuery.get(queryId) ?? []
    bucket.push(row)
    trainByQuery.set(queryId, bucket)
  }

  for (const queryId of positiveQueryIds) {
    const bucket = byQuery.get(queryId) ?? []
    const bucketPositives = bucket.filter((row) => row?.outcomeHitTarget === true)
    const runnerUps = pickTopRows(
      bucket.filter((row) => row?.outcomeHitTarget !== true),
      sameDateNegativeLimit,
    )
    sameDateRunnerUpRows.push(...runnerUps)
    sameDatePairs.push(...buildPairs({ positives: bucketPositives, negatives: runnerUps, pairType: "same_date" }))

    for (const positiveRow of bucketPositives) {
      const controlQueryIds = uniqueStrings((positiveRow?.matchedControlQueryIds ?? []).slice(0, matchedControlLimit))
      for (const controlQueryId of controlQueryIds) {
        const controlBucket = pickTopRows(trainByQuery.get(controlQueryId) ?? [], 1)
        matchedControlRows.push(...controlBucket)
        matchedControlPairs.push(...buildPairs({ positives: [positiveRow], negatives: controlBucket, pairType: "matched_control" }))
      }
    }
  }

  const auditNegativeRows = uniqueRowsByKey([...hardNegativeRows, ...sameDateRunnerUpRows, ...matchedControlRows])
  const allPairs = [...sameDatePairs, ...matchedControlPairs]

  return {
    ...family,
    ok: positiveRows.length > 0 && auditNegativeRows.length > 0 && allPairs.length > 0,
    reason:
      positiveRows.length > 0 && auditNegativeRows.length > 0 && allPairs.length > 0
        ? null
        : "unsat_no_separability_pairs",
    separabilityPositiveRows: positiveRows,
    separabilityNegativeRows: auditNegativeRows,
    separabilityHardNegativeRows: hardNegativeRows,
    separabilitySameDateRunnerUpRows: uniqueRowsByKey(sameDateRunnerUpRows),
    separabilityMatchedControlRows: uniqueRowsByKey(matchedControlRows),
    separabilityPairs: allPairs,
    separabilitySameDatePairs: sameDatePairs,
    separabilityMatchedControlPairs: matchedControlPairs,
    separabilityPositiveQueryIds: Array.from(positiveQueryIds).sort((left, right) => left.localeCompare(right)),
    separabilityNegativeQueryIds: Array.from(negativeQueryIds).sort((left, right) => left.localeCompare(right)),
    separabilitySupportProjectionRows: supportCaseViews,
    summary: {
      ...(family?.summary ?? {}),
      separabilityDatasetReady: positiveRows.length > 0 && auditNegativeRows.length > 0 && allPairs.length > 0,
      separabilityPositiveSummary: summarizeRows(positiveRows),
      separabilityNegativeSummary: summarizeRows(auditNegativeRows),
      separabilityHardNegativeSummary: summarizeRows(hardNegativeRows),
      separabilitySameDateRunnerUpSummary: summarizeRows(sameDateRunnerUpRows),
      separabilityMatchedControlSummary: summarizeRows(matchedControlRows),
      separabilityPositiveQueryCount: positiveQueryIds.size,
      separabilityNegativeQueryCount: negativeQueryIds.size,
      separabilityPairCount: allPairs.length,
      separabilitySameDatePairCount: sameDatePairs.length,
      separabilityMatchedControlPairCount: matchedControlPairs.length,
      supportProjectionRowCount: supportCaseViews.length,
      supportProjectionProxyMean: average(supportCaseViews.map((row) => proxyScoreOf(row))),
      supportProjectionSignatureCount: new Set(supportCaseViews.map((row) => signatureOf(row))).size,
    },
  }
}

