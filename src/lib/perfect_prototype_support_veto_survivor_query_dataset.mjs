const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const clusterPressureFeatureKey = (clusterId) => `sig.vetoRegime.cluster.${clusterId}.pressure`

const passesVeto = ({ row, artifact } = {}) => {
  const numericFeatureMap = row?.numericFeatureMap ?? {}
  for (const cluster of artifact?.clusters ?? []) {
    const pressure = Number(num(numericFeatureMap?.[clusterPressureFeatureKey(cluster.clusterId)]) ?? Number.POSITIVE_INFINITY)
    if (pressure > Number(cluster.threshold ?? 0)) return false
  }
  const maxPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.maxPressure"]) ?? Number.POSITIVE_INFINITY)
  const totalPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.totalPressure"]) ?? Number.POSITIVE_INFINITY)
  const cleanMargin = Number(num(numericFeatureMap?.["sig.vetoRegime.cleanMargin"]) ?? Number.NEGATIVE_INFINITY)
  return (
    maxPressure <= Number(artifact?.maxPressureThreshold ?? Number.POSITIVE_INFINITY) &&
    totalPressure <= Number(artifact?.totalPressureThreshold ?? Number.POSITIVE_INFINITY) &&
    cleanMargin >= Number(artifact?.cleanMarginThreshold ?? Number.NEGATIVE_INFINITY)
  )
}

const rowLookupMap = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

const projectRows = ({ sourceRows = [], lookup = new Map() } = {}) =>
  (Array.isArray(sourceRows) ? sourceRows : []).map((row) => lookup.get(row?.rowKey) ?? row)

export const buildPerfectPrototypeSupportVetoSurvivorQueryDataset = ({
  family,
  vetoArtifact,
} = {}) => {
  const filterRows = (rows = []) => (Array.isArray(rows) ? rows : []).filter((row) => passesVeto({ row, artifact: vetoArtifact }))
  const trainRows = filterRows(family?.trainRows ?? [])
  const gatedTrainRows = filterRows(family?.gatedTrainRows ?? [])
  const oosRows = filterRows(family?.oosRows ?? [])
  const supportCaseViews = filterRows(family?.supportCaseViews ?? [])
  const gatedLookup = rowLookupMap(gatedTrainRows)
  const trainLookup = rowLookupMap(trainRows)
  const survivingPositiveReferenceRows = filterRows(family?.failureRegimePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const survivingNegativeReferenceRows = filterRows(family?.failureRegimeNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  return {
    ...family,
    ok: gatedTrainRows.length > 0,
    reason: gatedTrainRows.length > 0 ? null : "unsat_no_veto_survivors",
    vetoArtifact,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows: survivingPositiveReferenceRows,
    supportNearHardNegativeRows: survivingNegativeReferenceRows,
    calibrationPositiveRows: projectRows({ sourceRows: family?.failureRegimePositiveRows ?? [], lookup: gatedLookup }),
    calibrationNegativeRows: projectRows({ sourceRows: family?.failureRegimeNegativeRows ?? [], lookup: gatedLookup }),
    summary: {
      ...(family?.summary ?? {}),
      vetoSurvivorReady: gatedTrainRows.length > 0,
      vetoSurvivorTrainSummary: summarizeRows(gatedTrainRows),
      vetoSurvivorOosSummary: summarizeRows(oosRows),
      vetoSurvivorSupportCount: supportCaseViews.length,
      vetoSurvivorPositiveReferenceSummary: summarizeRows(survivingPositiveReferenceRows),
      vetoSurvivorNegativeReferenceSummary: summarizeRows(survivingNegativeReferenceRows),
    },
  }
}
