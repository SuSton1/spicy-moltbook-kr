const POSITIVE_SUPPORT_AXES = [
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.roleBreadthCarry",
  "sig.ctrlResidual.regimeResidualRank",
  "sig.outRank.consensusWinShare",
  "sig.slateArchetype.temporal.carryNet",
  "sig.slateArchetype.border.riskMargin",
  "sig.slateArchetype.selection.winnerSupportResidual",
]

const NEGATIVE_AUX_AXES = [
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.negativeRolePressure",
  "sig.ctrlResidual.regimeResidualRisk",
  "sig.outRank.negativePeerPressure",
  "sig.slateArchetype.selection.gapToTop",
]

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
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const rowLookupMap = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

const clusterPressureFeatureKey = (clusterId) => `sig.vetoRegime.cluster.${clusterId}.pressure`
const clusterBoundaryFeatureKey = (clusterId) => `sig.vetoRegime.cluster.${clusterId}.boundaryGap`

const augmentRows = ({ rows = [], clusters = [] } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    const clusterPressures = []
    for (const cluster of clusters) {
      const signedValues = (cluster?.selectedAxes ?? []).map((axis) => {
        const rawValue = Number(num(row?.numericFeatureMap?.[axis.featureKey]) ?? axis.positiveMean ?? 0)
        return Number(axis.direction ?? 1) * ((rawValue - Number(axis.center ?? 0)) / Math.max(0.05, Number(axis.scale ?? 0.05)))
      })
      const pressure = Math.max(0, average(signedValues) ?? 0)
      const boundaryGap =
        average(
          (cluster?.selectedAxes ?? []).map((axis) => {
            const rawValue = Number(num(row?.numericFeatureMap?.[axis.featureKey]) ?? axis.positiveMean ?? 0)
            return Number(axis.direction ?? 1) * ((rawValue - Number(axis.positiveMean ?? 0)) / Math.max(0.05, Number(axis.scale ?? 0.05)))
          }),
        ) ?? 0
      numericFeatureMap[clusterPressureFeatureKey(cluster.clusterId)] = pressure
      numericFeatureMap[clusterBoundaryFeatureKey(cluster.clusterId)] = boundaryGap
      clusterPressures.push(pressure)
    }
    const positiveAffinity = average(POSITIVE_SUPPORT_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
    const negativeAux = average(NEGATIVE_AUX_AXES.map((featureKey) => row?.numericFeatureMap?.[featureKey])) ?? 0
    const maxPressure = clusterPressures.length > 0 ? Math.max(...clusterPressures) : 0
    const totalPressure = Math.max(0, average(clusterPressures) ?? 0)
    numericFeatureMap["sig.vetoRegime.maxPressure"] = maxPressure
    numericFeatureMap["sig.vetoRegime.totalPressure"] = totalPressure
    numericFeatureMap["sig.vetoRegime.cleanMargin"] = positiveAffinity - negativeAux - maxPressure
    numericFeatureMap["sig.vetoRegime.positiveAffinity"] = positiveAffinity
    numericFeatureMap["sig.vetoRegime.negativeAuxPressure"] = negativeAux
    row.numericFeatureMap = numericFeatureMap
    return row
  })

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.vetoRegime.")),
    ),
  )

export const buildPerfectPrototypeSupportNegativeRegimeVetoFeatures = ({ family } = {}) => {
  const clusters = family?.negativeRegimeClusters ?? []
  const trainRows = augmentRows({ rows: family?.trainRows ?? [], clusters })
  const gatedTrainRows = augmentRows({ rows: family?.gatedTrainRows ?? [], clusters })
  const oosRows = augmentRows({ rows: family?.oosRows ?? [], clusters })
  const supportCaseViews = augmentRows({ rows: family?.supportCaseViews ?? [], clusters })
  const gatedLookup = rowLookupMap(gatedTrainRows)
  const trainLookup = rowLookupMap(trainRows)
  const failureRegimePositiveRows = (family?.failureRegimePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const failureRegimeNegativeRows = (family?.failureRegimeNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const vetoFeatureKeys = collectFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  return {
    ...family,
    ok: vetoFeatureKeys.length > 0,
    reason: vetoFeatureKeys.length > 0 ? null : "unsat_no_negative_regime_veto_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    failureRegimePositiveRows,
    failureRegimeNegativeRows,
    vetoFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      negativeRegimeVetoFeatureReady: vetoFeatureKeys.length > 0,
      negativeRegimeVetoFeatureCount: vetoFeatureKeys.length,
      negativeRegimeClusterFeatureKeys: clusters.map((cluster) => clusterPressureFeatureKey(cluster.clusterId)),
    },
  }
}
