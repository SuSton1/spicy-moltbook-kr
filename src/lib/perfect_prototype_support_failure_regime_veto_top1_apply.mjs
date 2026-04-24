import { applyPerfectPrototypeSupportTop1QueryRanker } from "./perfect_prototype_support_top1_query_ranker.mjs"

const clusterPressureFeatureKey = (clusterId) => `sig.vetoRegime.cluster.${clusterId}.pressure`

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export const applyPerfectPrototypeSupportFailureRegimeVetoTop1 = ({
  artifact,
  rows = [],
} = {}) => {
  const vetoArtifact = artifact?.vetoArtifact ?? {}
  const survivorRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    for (const cluster of vetoArtifact?.clusters ?? []) {
      const pressure = Number(num(numericFeatureMap?.[clusterPressureFeatureKey(cluster.clusterId)]) ?? Number.POSITIVE_INFINITY)
      if (pressure > Number(cluster.threshold ?? 0)) return false
    }
    const maxPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.maxPressure"]) ?? Number.POSITIVE_INFINITY)
    const totalPressure = Number(num(numericFeatureMap?.["sig.vetoRegime.totalPressure"]) ?? Number.POSITIVE_INFINITY)
    const cleanMargin = Number(num(numericFeatureMap?.["sig.vetoRegime.cleanMargin"]) ?? Number.NEGATIVE_INFINITY)
    return (
      maxPressure <= Number(vetoArtifact?.maxPressureThreshold ?? Number.POSITIVE_INFINITY) &&
      totalPressure <= Number(vetoArtifact?.totalPressureThreshold ?? Number.POSITIVE_INFINITY) &&
      cleanMargin >= Number(vetoArtifact?.cleanMarginThreshold ?? Number.NEGATIVE_INFINITY)
    )
  })
  return applyPerfectPrototypeSupportTop1QueryRanker({
    artifact: artifact?.top1Artifact ?? artifact,
    rows: survivorRows,
  })
}
