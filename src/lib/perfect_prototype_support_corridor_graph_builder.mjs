import { scorePerfectPrototypeSupportCorridorMetricDistance } from "./perfect_prototype_support_corridor_metric_learning.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const compatibleGroupBonus = (left, right) => {
  const leftGroup = String(left?.recurBoundaryDominantGroup ?? left?.dominantGroup ?? "").trim()
  const rightGroup = String(right?.recurBoundaryDominantGroup ?? right?.dominantGroup ?? "").trim()
  if (leftGroup && rightGroup && leftGroup === rightGroup) return 0.15
  return 0
}

const buildEdgeWeight = ({ left, right, featureEntries = [] } = {}) => {
  const distance = scorePerfectPrototypeSupportCorridorMetricDistance({
    left,
    right,
    featureEntries,
  })
  if (!Number.isFinite(distance)) return { distance, similarity: 0 }
  const similarity = Math.exp(-distance) + compatibleGroupBonus(left, right)
  return {
    distance,
    similarity: Math.max(0, Math.min(1.25, similarity)),
  }
}

export const buildPerfectPrototypeSupportCorridorGraphBuilder = ({
  family,
  neighborCount = 8,
  minSimilarityQuantile = 0.25,
} = {}) => {
  const trainRows = Array.isArray(family?.graphTrainRows) ? family.graphTrainRows : []
  const featureEntries = Array.isArray(family?.corridorFeatureEntries) ? family.corridorFeatureEntries : []
  if (trainRows.length < 2 || featureEntries.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_corridor_graph",
      summary: {
        ...(family?.summary ?? {}),
        corridorGraphReady: false,
        corridorGraphReason: "unsat_no_corridor_graph",
        graphNodeCount: trainRows.length,
        graphEdgeCount: 0,
      },
    }
  }

  const nodes = trainRows.map((row, index) => ({
    index,
    row,
    neighbors: [],
  }))
  const seedRowKeys = new Set((family?.graphPositiveSeedRows ?? []).map((row) => row?.rowKey).filter(Boolean))
  const negativeRowKeys = new Set((family?.graphNegativeSeedRows ?? []).map((row) => row?.rowKey).filter(Boolean))

  const nearestSimilarities = []
  const candidateEdges = []
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]
    const scored = []
    for (let rightIndex = 0; rightIndex < nodes.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue
      const scoredEdge = buildEdgeWeight({
        left: left.row,
        right: nodes[rightIndex].row,
        featureEntries,
      })
      if (!Number.isFinite(scoredEdge.distance)) continue
      scored.push({
        rightIndex,
        distance: scoredEdge.distance,
        similarity: scoredEdge.similarity,
      })
    }
    scored.sort((a, b) => a.distance - b.distance)
    const nearest = scored.slice(0, Math.max(1, Math.floor(Number(neighborCount) || 8)))
    nearestSimilarities.push(...nearest.map((entry) => entry.similarity))
    candidateEdges.push(...nearest.map((entry) => ({ leftIndex, ...entry })))
  }

  const minSimilarity = Math.max(
    0.05,
    Number(quantile(nearestSimilarities, minSimilarityQuantile) ?? 0.1),
  )
  const adjacency = new Map(nodes.map((node) => [node.index, []]))
  const seen = new Set()
  for (const edge of candidateEdges) {
    if (edge.similarity < minSimilarity) continue
    const leftIndex = edge.leftIndex
    const rightIndex = edge.rightIndex
    const key = leftIndex < rightIndex ? `${leftIndex}:${rightIndex}` : `${rightIndex}:${leftIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    adjacency.get(leftIndex)?.push({ index: rightIndex, weight: edge.similarity })
    adjacency.get(rightIndex)?.push({ index: leftIndex, weight: edge.similarity })
  }

  const graphNodes = nodes.map((node) => ({
    ...node,
    neighbors: adjacency.get(node.index) ?? [],
    isPositiveSeed: seedRowKeys.has(node.row?.rowKey),
    isNegativeSeed: negativeRowKeys.has(node.row?.rowKey),
  }))

  return {
    ...family,
    ok: true,
    reason: null,
    graphNodes,
    summary: {
      ...(family?.summary ?? {}),
      corridorGraphReady: true,
      corridorGraphReason: null,
      graphNodeCount: graphNodes.length,
      graphEdgeCount: seen.size,
      graphPositiveSeedCount: graphNodes.filter((node) => node.isPositiveSeed).length,
      graphNegativeSeedCount: graphNodes.filter((node) => node.isNegativeSeed).length,
      graphMinSimilarityThreshold: minSimilarity,
    },
  }
}
