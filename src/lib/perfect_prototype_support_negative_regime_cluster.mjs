const NEGATIVE_CLUSTER_AXES = [
  { featureKey: "sig.temporalEpisode.episodeNegativePressure", direction: 1 },
  { featureKey: "sig.roleTopo.negativeRolePressure", direction: 1 },
  { featureKey: "sig.ctrlResidual.regimeResidualRisk", direction: 1 },
  { featureKey: "sig.outRank.negativePeerPressure", direction: 1 },
  { featureKey: "sig.slateArchetype.selection.gapToTop", direction: 1 },
  { featureKey: "sig.slateArchetype.temporal.carryNet", direction: -1 },
  { featureKey: "sig.slateArchetype.border.riskMargin", direction: -1 },
  { featureKey: "sig.ctrlResidual.regimeResidualRank", direction: -1 },
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

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const slugify = (value) =>
  String(value ?? "")
    .replace(/^sig\./, "")
    .replaceAll(".", "_")
    .replaceAll(/[^a-zA-Z0-9_]/g, "_")
    .replaceAll(/__+/g, "_")
    .replace(/^_+|_+$/g, "")

const collectAxisStats = ({ positiveRows = [], negativeRows = [] } = {}) =>
  NEGATIVE_CLUSTER_AXES.map((axis) => {
    const positiveValues = (positiveRows ?? []).map((row) => num(row?.numericFeatureMap?.[axis.featureKey])).filter(Number.isFinite)
    const negativeValues = (negativeRows ?? []).map((row) => num(row?.numericFeatureMap?.[axis.featureKey])).filter(Number.isFinite)
    const positiveMean = average(positiveValues) ?? 0
    const negativeMean = average(negativeValues) ?? 0
    const scale = Math.max(0.05, Math.abs(negativeMean - positiveMean))
    return {
      ...axis,
      positiveMean,
      negativeMean,
      scale,
      separation: Math.abs(negativeMean - positiveMean),
    }
  })

const dominantAxisForRow = ({ row, axisStats = [] } = {}) => {
  let best = null
  for (const axis of axisStats) {
    const rawValue = Number(num(row?.numericFeatureMap?.[axis.featureKey]) ?? axis.positiveMean ?? 0)
    const score = axis.direction * ((rawValue - Number(axis.positiveMean ?? 0)) / Math.max(0.05, Number(axis.scale ?? 0.05)))
    if (!best || score > best.score) {
      best = {
        axis,
        score,
      }
    }
  }
  return best
}

export const buildPerfectPrototypeSupportNegativeRegimeCluster = ({
  family,
  minClusterRows = 3,
  minClusterMonths = 2,
  minClusterFolds = 2,
  maxClusters = 4,
  maxAxesPerCluster = 3,
} = {}) => {
  const positiveRows = family?.failureRegimePositiveRows ?? []
  const negativeRows = family?.failureRegimeNegativeRows ?? []
  const axisStats = collectAxisStats({ positiveRows, negativeRows })
  const byCluster = new Map()
  for (const row of negativeRows) {
    const dominant = dominantAxisForRow({ row, axisStats })
    const clusterId = slugify(dominant?.axis?.featureKey ?? "unknown")
    const bucket = byCluster.get(clusterId) ?? {
      clusterId,
      dominantFeatureKey: dominant?.axis?.featureKey ?? null,
      rows: [],
    }
    bucket.rows.push(row)
    byCluster.set(clusterId, bucket)
  }

  const clusters = Array.from(byCluster.values()).map((cluster) => {
    const summary = summarizeRows(cluster.rows)
    const dominantAxis = axisStats.find((axis) => axis.featureKey === cluster.dominantFeatureKey) ?? axisStats[0]
    const clusterMean = average(cluster.rows.map((row) => row?.numericFeatureMap?.[dominantAxis?.featureKey])) ?? 0
    const selectedAxes = [
      {
        featureKey: dominantAxis.featureKey,
        direction: dominantAxis.direction,
        positiveMean: dominantAxis.positiveMean,
        negativeMean: clusterMean,
        center: (dominantAxis.positiveMean + clusterMean) / 2,
        scale: Math.max(0.05, Math.abs(clusterMean - dominantAxis.positiveMean)),
        separation: Math.abs(clusterMean - dominantAxis.positiveMean),
      },
    ].slice(0, Math.max(1, Math.floor(Number(maxAxesPerCluster) || 1)))
    return {
      clusterId: cluster.clusterId,
      dominantFeatureKey: cluster.dominantFeatureKey,
      rowCount: summary.rowCount,
      matchedDateCount: summary.matchedDateCount,
      matchedMonthCount: summary.matchedMonthCount,
      matchedFoldCount: summary.matchedFoldCount,
      selectedAxes,
      rows: cluster.rows,
    }
  })

  const stableClusters = clusters
    .filter(
      (cluster) =>
        Number(cluster.rowCount ?? 0) >= Math.max(1, Math.floor(Number(minClusterRows) || 3)) &&
        Number(cluster.matchedMonthCount ?? 0) >= Math.max(1, Math.floor(Number(minClusterMonths) || 2)) &&
        Number(cluster.matchedFoldCount ?? 0) >= Math.max(1, Math.floor(Number(minClusterFolds) || 2)),
    )
    .sort((left, right) => {
      if (right.rowCount !== left.rowCount) return right.rowCount - left.rowCount
      if (right.matchedFoldCount !== left.matchedFoldCount) return right.matchedFoldCount - left.matchedFoldCount
      if (right.matchedMonthCount !== left.matchedMonthCount) return right.matchedMonthCount - left.matchedMonthCount
      return String(left.clusterId).localeCompare(String(right.clusterId))
    })
    .slice(0, Math.max(1, Math.floor(Number(maxClusters) || 4)))

  const ok = stableClusters.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_negative_regime_clusters",
    negativeRegimeAxisStats: axisStats,
    negativeRegimeClusters: stableClusters,
    summary: {
      ...(family?.summary ?? {}),
      negativeRegimeClusterReady: ok,
      negativeRegimeClusterCount: clusters.length,
      stableNegativeRegimeClusterCount: stableClusters.length,
      stableNegativeRegimeClusterIds: stableClusters.map((cluster) => cluster.clusterId),
    },
  }
}
