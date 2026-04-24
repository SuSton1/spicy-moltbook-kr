import { scorePerfectPrototypeSupportGraphRows } from "./perfect_prototype_support_graph_apply.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const iteratePropagation = ({
  nodes = [],
  positiveSeedIndexes = new Set(),
  negativeSeedIndexes = new Set(),
  alpha = 0.85,
  iterationCount = 64,
} = {}) => {
  const propagateOne = ({ seedIndexes = new Set(), zeroIndexes = new Set() } = {}) => {
    let values = nodes.map((_, index) => (seedIndexes.has(index) ? 1 : 0))
    for (let iteration = 0; iteration < Math.max(1, Math.floor(Number(iterationCount) || 64)); iteration += 1) {
      const next = values.slice()
      for (let index = 0; index < nodes.length; index += 1) {
        if (seedIndexes.has(index)) {
          next[index] = 1
          continue
        }
        if (zeroIndexes.has(index)) {
          next[index] = 0
          continue
        }
        const neighbors = Array.isArray(nodes[index]?.neighbors) ? nodes[index].neighbors : []
        if (neighbors.length < 1) {
          next[index] = 0
          continue
        }
        let weighted = 0
        let weightTotal = 0
        for (const neighbor of neighbors) {
          const weight = Math.max(0, Number(neighbor?.weight ?? 0))
          if (weight <= 0) continue
          weighted += weight * Number(values[neighbor.index] ?? 0)
          weightTotal += weight
        }
        const smooth = weightTotal > 0 ? weighted / weightTotal : 0
        next[index] = alpha * smooth
      }
      values = next
    }
    return values
  }

  const positiveValues = propagateOne({
    seedIndexes: positiveSeedIndexes,
    zeroIndexes: negativeSeedIndexes,
  })
  const negativeValues = propagateOne({
    seedIndexes: negativeSeedIndexes,
    zeroIndexes: positiveSeedIndexes,
  })

  return nodes.map((node, index) => {
    const positivePotential = Number(positiveValues[index] ?? 0)
    const negativePotential = Number(negativeValues[index] ?? 0)
    const margin = positivePotential - negativePotential
    const uncertainty = Math.max(0, 1 - Math.abs(margin))
    const safeReachabilityScore = margin + positivePotential * 0.25 - uncertainty * 0.25
    const positiveNeighborShare =
      (node?.neighbors ?? []).filter((entry) => nodes[entry.index]?.isPositiveSeed === true).length /
      Math.max(1, (node?.neighbors ?? []).length)
    const negativeNeighborShare =
      (node?.neighbors ?? []).filter((entry) => nodes[entry.index]?.isNegativeSeed === true).length /
      Math.max(1, (node?.neighbors ?? []).length)
    return {
      rowKey: node?.row?.rowKey ?? null,
      symbol: node?.row?.symbol ?? null,
      dateKey: node?.row?.dateKey ?? null,
      monthKey: node?.row?.monthKey ?? null,
      foldId: Number(node?.row?.foldId ?? 0),
      windowId: Number(node?.row?.windowId ?? 0),
      outcomeHitTarget: node?.row?.outcomeHitTarget === true,
      categoricalTokens: Array.isArray(node?.row?.categoricalTokens) ? node.row.categoricalTokens : [],
      numericFeatureMap: node?.row?.numericFeatureMap ?? {},
      positivePotential,
      negativePotential,
      margin,
      uncertainty,
      safeReachabilityScore,
      neighborCount: Array.isArray(node?.neighbors) ? node.neighbors.length : 0,
      positiveNeighborShare,
      negativeNeighborShare,
      isPositiveSeed: node?.isPositiveSeed === true,
      isNegativeSeed: node?.isNegativeSeed === true,
    }
  })
}

export const propagatePerfectPrototypeSupportCorridorGraph = ({
  family,
  alpha = 0.85,
  iterationCount = 64,
  neighborCount = 12,
} = {}) => {
  const nodes = Array.isArray(family?.graphNodes) ? family.graphNodes : []
  if (nodes.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_graph_nodes",
      summary: {
        ...(family?.summary ?? {}),
        graphPropagationReady: false,
        graphPropagationReason: "unsat_no_graph_nodes",
      },
    }
  }
  const positiveSeedIndexes = new Set(
    nodes.filter((node) => node?.isPositiveSeed === true).map((node) => node.index),
  )
  const negativeSeedIndexes = new Set(
    nodes.filter((node) => node?.isNegativeSeed === true).map((node) => node.index),
  )
  if (positiveSeedIndexes.size < 1 || negativeSeedIndexes.size < 1) {
    return {
      ...family,
      ok: false,
      reason: positiveSeedIndexes.size < 1 ? "unsat_no_positive_graph_seeds" : "unsat_no_negative_graph_seeds",
      summary: {
        ...(family?.summary ?? {}),
        graphPropagationReady: false,
        graphPropagationReason:
          positiveSeedIndexes.size < 1 ? "unsat_no_positive_graph_seeds" : "unsat_no_negative_graph_seeds",
      },
    }
  }

  const trainNodes = iteratePropagation({
    nodes,
    positiveSeedIndexes,
    negativeSeedIndexes,
    alpha,
    iterationCount,
  })
  const provisionalArtifact = {
    gateTokens: family?.gateTokens ?? [],
    featureEntries: family?.corridorFeatureEntries ?? [],
    trainNodes,
    neighborCount,
    selectThreshold: -1,
    marginThreshold: -1,
    abstainThreshold: -1,
  }
  const supportEvaluations = scorePerfectPrototypeSupportGraphRows({
    artifact: provisionalArtifact,
    rows: family?.supportCaseViews ?? [],
  })
  const supportCasePositivePotential = average(supportEvaluations.map((entry) => entry.positivePotential))
  const supportCaseNegativePotential = average(supportEvaluations.map((entry) => entry.negativePotential))
  const supportCaseSafeReachabilityScore = average(
    supportEvaluations.map((entry) => entry.safeReachabilityScore),
  )

  return {
    ...family,
    ok: true,
    reason: null,
    propagatedTrainNodes: trainNodes,
    summary: {
      ...(family?.summary ?? {}),
      graphPropagationReady: true,
      graphPropagationReason: null,
      supportCasePositivePotential,
      supportCaseNegativePotential,
      supportCaseSafeReachabilityScore,
      graphPositivePotentialMean: average(trainNodes.map((node) => node.positivePotential)),
      graphNegativePotentialMean: average(trainNodes.map((node) => node.negativePotential)),
    },
  }
}
