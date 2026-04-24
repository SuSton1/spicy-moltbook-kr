const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
  matchedWindowCount: new Set(
    (rows ?? []).map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0),
  ).size,
})

const safeDiv = (left, right, fallback = 0) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return fallback
  return l / r
}

const collectCarrierVectorKeys = ({ rows = [], minSupportCount = 4 } = {}) => {
  const allowPrefixes = ["sig.bridge.", "sig.boundary."]
  const keys = uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) =>
        allowPrefixes.some((prefix) => featureKey.startsWith(prefix)),
      ),
    ),
  )
  return keys.filter((featureKey) => {
    let count = 0
    for (const row of Array.isArray(rows) ? rows : []) {
      if (Number.isFinite(num(row?.numericFeatureMap?.[featureKey]))) count += 1
      if (count >= Math.max(3, Math.floor(Number(minSupportCount) || 4))) return true
    }
    return false
  })
}

const buildFeatureScales = ({ rows = [], featureKeys = [] } = {}) => {
  const out = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    const q10 = quantile(values, 0.1)
    const q90 = quantile(values, 0.9)
    out[featureKey] = Math.max(
      0.05,
      Math.abs(Number(q90 ?? 0) - Number(q10 ?? 0)),
      Math.abs(Number(average(values) ?? 0)),
      0.1,
    )
  }
  return out
}

const distanceBetweenRows = ({
  left,
  right,
  featureKeys = [],
  featureScales = {},
} = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const leftValue = num(left?.numericFeatureMap?.[featureKey])
    const rightValue = num(right?.numericFeatureMap?.[featureKey])
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue
    total += Math.abs(leftValue - rightValue) / Math.max(0.05, Number(featureScales?.[featureKey] ?? 1))
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const buildPrototype = ({ rows = [], featureKeys = [] } = {}) => {
  const prototype = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const value = average((rows ?? []).map((row) => row?.numericFeatureMap?.[featureKey]))
    if (Number.isFinite(num(value))) prototype[featureKey] = value
  }
  return prototype
}

const distanceToPrototype = ({
  row,
  prototype = {},
  featureKeys = [],
  featureScales = {},
} = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    total += Math.abs(rowValue - prototypeValue) / Math.max(0.05, Number(featureScales?.[featureKey] ?? 1))
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const buildPositiveEdges = ({
  rows = [],
  featureKeys = [],
  featureScales = {},
  neighborCount = 4,
  edgeQuantile = 0.7,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const nearestDistances = []
  const neighborIndexesByRow = new Map()
  for (let index = 0; index < safeRows.length; index += 1) {
    const scored = []
    for (let candidateIndex = 0; candidateIndex < safeRows.length; candidateIndex += 1) {
      if (candidateIndex === index) continue
      const distance = distanceBetweenRows({
        left: safeRows[index],
        right: safeRows[candidateIndex],
        featureKeys,
        featureScales,
      })
      if (!Number.isFinite(distance)) continue
      scored.push({ candidateIndex, distance })
    }
    scored.sort((left, right) => left.distance - right.distance)
    const nearest = scored.slice(0, Math.max(1, Math.floor(Number(neighborCount) || 4)))
    neighborIndexesByRow.set(index, new Set(nearest.map((entry) => entry.candidateIndex)))
    nearestDistances.push(...nearest.map((entry) => entry.distance))
  }
  const threshold = Math.max(0.1, Number(quantile(nearestDistances, edgeQuantile) ?? 0.5) * 1.15)
  const adjacency = new Map(safeRows.map((_, index) => [index, new Set()]))
  for (let leftIndex = 0; leftIndex < safeRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < safeRows.length; rightIndex += 1) {
      const distance = distanceBetweenRows({
        left: safeRows[leftIndex],
        right: safeRows[rightIndex],
        featureKeys,
        featureScales,
      })
      if (!Number.isFinite(distance) || distance > threshold) continue
      const leftNeighbors = neighborIndexesByRow.get(leftIndex) ?? new Set()
      const rightNeighbors = neighborIndexesByRow.get(rightIndex) ?? new Set()
      if (!leftNeighbors.has(rightIndex) && !rightNeighbors.has(leftIndex)) continue
      adjacency.get(leftIndex)?.add(rightIndex)
      adjacency.get(rightIndex)?.add(leftIndex)
    }
  }
  return { adjacency, threshold }
}

const buildConnectedComponents = ({ rows = [], adjacency = new Map() } = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const visited = new Set()
  const components = []
  for (let start = 0; start < safeRows.length; start += 1) {
    if (visited.has(start)) continue
    const stack = [start]
    const indexes = []
    visited.add(start)
    while (stack.length > 0) {
      const index = stack.pop()
      indexes.push(index)
      for (const neighbor of adjacency.get(index) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
    const componentRows = indexes.map((index) => safeRows[index]).filter(Boolean)
    components.push(componentRows)
  }
  return components
}

const buildComponentStats = ({
  componentId,
  rows = [],
  featureKeys = [],
  featureScales = {},
} = {}) => {
  const prototype = buildPrototype({ rows, featureKeys })
  const memberDistances = (Array.isArray(rows) ? rows : [])
    .map((row) =>
      distanceToPrototype({
        row,
        prototype,
        featureKeys,
        featureScales,
      }),
    )
    .filter(Number.isFinite)
  const summary = summarizeRows(rows)
  const radius = Math.max(
    0.1,
    Number(quantile(memberDistances, 0.75) ?? 0.25) * 1.1,
    Number(average(memberDistances) ?? 0.15),
  )
  return {
    componentId,
    rows,
    prototype,
    memberDistances,
    radius,
    summary,
  }
}

const normalizedBreadth = (summary = {}) => ({
  dateShare: clamp(safeDiv(summary?.matchedDateCount, 10, 0), 0, 1),
  monthShare: clamp(safeDiv(summary?.matchedMonthCount, 6, 0), 0, 1),
  foldShare: clamp(safeDiv(summary?.matchedFoldCount, 4, 0), 0, 1),
  windowShare: clamp(safeDiv(summary?.matchedWindowCount, 4, 0), 0, 1),
})

const collectCarrierFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.carrierGraph.")),
    ),
  )

export const buildPerfectPrototypeSupportCarrierGraphFamily = ({
  cohort,
  neighborCount = 4,
  minComponentDates = 4,
  minComponentMonths = 3,
  minComponentFolds = 2,
} = {}) => {
  const positiveRows = Array.isArray(cohort?.bridgePositiveRows) ? cohort.bridgePositiveRows : []
  const negativeRows = Array.isArray(cohort?.supportNearHardNegativeRows)
    ? cohort.supportNearHardNegativeRows
    : Array.isArray(cohort?.hardNegativeRows)
      ? cohort.hardNegativeRows
      : []
  const vectorKeys = collectCarrierVectorKeys({
    rows: [...positiveRows, ...negativeRows],
  })
  if (positiveRows.length < 1 || negativeRows.length < 1 || vectorKeys.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_carrier_components",
      carrierGraphFeatureKeys: [],
      carrierComponentIds: [],
      carrierEligibleComponentIds: [],
      summary: {
        ...(cohort?.summary ?? {}),
        carrierGraphReady: false,
        carrierGraphReason: "unsat_no_carrier_components",
        carrierGraphFeatureCount: 0,
        carrierComponentCount: 0,
        carrierEligibleComponentCount: 0,
        supportCaseReachableComponentCount: 0,
      },
    }
  }

  const featureScales = buildFeatureScales({
    rows: [...positiveRows, ...negativeRows],
    featureKeys: vectorKeys,
  })
  const { adjacency } = buildPositiveEdges({
    rows: positiveRows,
    featureKeys: vectorKeys,
    featureScales,
    neighborCount,
  })
  const components = buildConnectedComponents({
    rows: positiveRows,
    adjacency,
  }).map((rows, index) =>
    buildComponentStats({
      componentId: `CARRIER_COMPONENT_${String(index + 1).padStart(2, "0")}`,
      rows,
      featureKeys: vectorKeys,
      featureScales,
    }),
  )

  if (components.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_positive_carrier_components",
      carrierGraphFeatureKeys: [],
      carrierComponentIds: [],
      carrierEligibleComponentIds: [],
      summary: {
        ...(cohort?.summary ?? {}),
        carrierGraphReady: false,
        carrierGraphReason: "unsat_no_positive_carrier_components",
        carrierGraphFeatureCount: 0,
        carrierComponentCount: 0,
        carrierEligibleComponentCount: 0,
        supportCaseReachableComponentCount: 0,
      },
    }
  }

  const globalNegativePrototype = buildPrototype({
    rows: negativeRows,
    featureKeys: vectorKeys,
  })
  const borderAssignments = components.map((component) => ({
    ...component,
    borderRows: [],
  }))
  for (const row of negativeRows) {
    let bestComponent = borderAssignments[0] ?? null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const component of borderAssignments) {
      const distance = distanceToPrototype({
        row,
        prototype: component?.prototype ?? {},
        featureKeys: vectorKeys,
        featureScales,
      })
      if (distance < bestDistance) {
        bestDistance = distance
        bestComponent = component
      }
    }
    if (bestComponent) bestComponent.borderRows.push(row)
  }

  const componentStats = borderAssignments.map((component) => {
    const borderPrototype =
      component.borderRows.length > 0
        ? buildPrototype({ rows: component.borderRows, featureKeys: vectorKeys })
        : globalNegativePrototype
    const positiveBreadth = normalizedBreadth(component.summary)
    const borderSummary = summarizeRows(component.borderRows)
    const purity = safeDiv(
      component.summary.rowCount,
      component.summary.rowCount + Number(borderSummary.rowCount ?? 0),
      0,
    )
    return {
      ...component,
      borderPrototype,
      borderSummary,
      purity,
      breadthCarry:
        (positiveBreadth.dateShare +
          positiveBreadth.monthShare +
          positiveBreadth.foldShare +
          positiveBreadth.windowShare) /
        4,
      persistenceShare:
        (positiveBreadth.monthShare + positiveBreadth.foldShare + positiveBreadth.windowShare) / 3,
      eligible:
        component.summary.matchedDateCount >= minComponentDates &&
        component.summary.matchedMonthCount >= minComponentMonths &&
        component.summary.matchedFoldCount >= minComponentFolds,
    }
  })
  const eligibleComponents = componentStats.filter((component) => component.eligible === true)
  if (eligibleComponents.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_component_breadth",
      carrierGraphFeatureKeys: [],
      carrierComponentIds: componentStats.map((component) => component.componentId),
      carrierEligibleComponentIds: [],
      summary: {
        ...(cohort?.summary ?? {}),
        carrierGraphReady: false,
        carrierGraphReason: "unsat_component_breadth",
        carrierGraphFeatureCount: 0,
        carrierComponentCount: componentStats.length,
        carrierEligibleComponentCount: 0,
        supportCaseReachableComponentCount: 0,
      },
    }
  }

  const computeRowComponentMetrics = (row) =>
    eligibleComponents.map((component) => {
      const posDistance = distanceToPrototype({
        row,
        prototype: component.prototype,
        featureKeys: vectorKeys,
        featureScales,
      })
      const negDistance = distanceToPrototype({
        row,
        prototype: component.borderPrototype,
        featureKeys: vectorKeys,
        featureScales,
      })
      const connectivity = Number.isFinite(posDistance)
        ? (Number(component.radius ?? 0.1) - posDistance) / Math.max(0.1, Number(component.radius ?? 0.1))
        : Number.NEGATIVE_INFINITY
      const boundaryGap =
        Number.isFinite(posDistance) && Number.isFinite(negDistance) ? negDistance - posDistance : null
      const posProximity = Number.isFinite(posDistance) ? 1 / (0.1 + posDistance) : 0
      const negPressure = Number.isFinite(negDistance) ? 1 / (0.1 + negDistance) : 0
      const falsePositivePressure =
        Math.max(0, negPressure - posProximity) +
        Math.max(0, -(Number(boundaryGap ?? 0))) +
        Math.max(0, 1 - Number(component.purity ?? 0))
      const recurrenceCarrierScore =
        Number(connectivity ?? 0) +
        Number(boundaryGap ?? 0) +
        Number(component.breadthCarry ?? 0) +
        Number(component.persistenceShare ?? 0) +
        Number(component.purity ?? 0) -
        Number(falsePositivePressure ?? 0)
      return {
        componentId: component.componentId,
        posDistance,
        negDistance,
        connectivity,
        boundaryGap,
        falsePositivePressure,
        recurrenceCarrierScore,
        breadthCarry: component.breadthCarry,
        persistenceShare: component.persistenceShare,
        purity: component.purity,
        summary: component.summary,
        borderSummary: component.borderSummary,
        reachable:
          Number.isFinite(posDistance) &&
          posDistance <= Math.max(0.15, Number(component.radius ?? 0.1) * 1.25),
      }
    })

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const metrics = computeRowComponentMetrics(row).sort(
        (left, right) =>
          Number(right.recurrenceCarrierScore ?? Number.NEGATIVE_INFINITY) -
            Number(left.recurrenceCarrierScore ?? Number.NEGATIVE_INFINITY) ||
          left.componentId.localeCompare(right.componentId),
      )
      const dominant = metrics[0] ?? null
      const reachableComponentIds = uniqueStrings(
        metrics.filter((entry) => entry.reachable === true || Number(entry.connectivity ?? -1) > -0.2).map((entry) => entry.componentId),
      )
      const numericFeatureMap = {
        ...(row?.numericFeatureMap ?? {}),
      }
      for (const metric of metrics) {
        numericFeatureMap[`sig.carrierGraph.component.${metric.componentId}.connectivity`] = metric.connectivity
        numericFeatureMap[`sig.carrierGraph.component.${metric.componentId}.boundaryGap`] = metric.boundaryGap
        numericFeatureMap[`sig.carrierGraph.component.${metric.componentId}.purity`] = metric.purity
        numericFeatureMap[`sig.carrierGraph.component.${metric.componentId}.breadthCarry`] = metric.breadthCarry
      }
      Object.assign(numericFeatureMap, {
        "sig.carrierGraph.posComponentEdgeMargin": dominant?.connectivity ?? null,
        "sig.carrierGraph.negBorderEdgePressure": dominant?.falsePositivePressure ?? null,
        "sig.carrierGraph.componentPurity": dominant?.purity ?? null,
        "sig.carrierGraph.componentDateBreadth": dominant?.summary?.matchedDateCount ?? null,
        "sig.carrierGraph.componentMonthBreadth": dominant?.summary?.matchedMonthCount ?? null,
        "sig.carrierGraph.componentFoldBreadth": dominant?.summary?.matchedFoldCount ?? null,
        "sig.carrierGraph.componentWindowBreadth": dominant?.summary?.matchedWindowCount ?? null,
        "sig.carrierGraph.componentPersistenceShare": dominant?.persistenceShare ?? null,
        "sig.carrierGraph.componentBoundaryGap": dominant?.boundaryGap ?? null,
        "sig.carrierGraph.falsePositivePressure": dominant?.falsePositivePressure ?? null,
        "sig.carrierGraph.recurrenceCarrierScore": dominant?.recurrenceCarrierScore ?? null,
      })
      const dominantComponent = dominant?.componentId ?? null
      const dominantToken = dominantComponent
        ? `sig:carrierGraph.dominantComponent:${dominantComponent}`
        : "sig:carrierGraph.dominantComponent:NONE"
      const carrierBand =
        Number(dominant?.recurrenceCarrierScore ?? Number.NEGATIVE_INFINITY) >= 2
          ? "STRONG"
          : Number(dominant?.recurrenceCarrierScore ?? Number.NEGATIVE_INFINITY) >= 0.5
            ? "MID"
            : "WEAK"
      const categoricalTokens = uniqueStrings([
        ...(row?.categoricalTokens ?? []),
        dominantToken,
        `sig:carrierGraph.score:${carrierBand}`,
      ])
      return {
        ...row,
        carrierDominantComponent: dominantComponent,
        carrierReachableComponentIds: reachableComponentIds,
        carrierDominantComponentScore: dominant?.recurrenceCarrierScore ?? null,
        carrierBorderComponent: dominantComponent,
        numericFeatureMap,
        categoricalTokens,
        tokenSet: new Set(categoricalTokens),
      }
    })

  const trainRows = augmentRows(cohort?.trainRows)
  const gatedTrainRows = augmentRows(cohort?.gatedTrainRows)
  const oosRows = augmentRows(cohort?.oosRows)
  const supportCaseViews = augmentRows(cohort?.supportCaseViews)
  const trainRowByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const gatedRowByKey = new Map(gatedTrainRows.map((row) => [row.rowKey, row]))
  const carrierPositiveRows = positiveRows.map((row) => gatedRowByKey.get(row.rowKey) ?? trainRowByKey.get(row.rowKey) ?? row)
  const augmentedNegativeRows = negativeRows.map((row) => gatedRowByKey.get(row.rowKey) ?? trainRowByKey.get(row.rowKey) ?? row)
  for (const row of augmentedNegativeRows) {
    let bestComponentId = row?.carrierDominantComponent ?? null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const component of eligibleComponents) {
      const distance = distanceToPrototype({
        row,
        prototype: component.borderPrototype,
        featureKeys: vectorKeys,
        featureScales,
      })
      if (distance < bestDistance) {
        bestDistance = distance
        bestComponentId = component.componentId
      }
    }
    row.carrierBorderComponent = bestComponentId
  }

  const carrierGraphFeatureKeys = collectCarrierFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViews,
  ])
  const supportCaseReachableComponentIds = uniqueStrings(
    supportCaseViews.flatMap((row) => {
      const reachableIds = Array.isArray(row?.carrierReachableComponentIds)
        ? row.carrierReachableComponentIds.filter(Boolean)
        : []
      if (reachableIds.length > 0) return reachableIds
      const dominantScore = Number(row?.carrierDominantComponentScore ?? Number.NEGATIVE_INFINITY)
      return row?.carrierDominantComponent && dominantScore > 0 ? [row.carrierDominantComponent] : []
    }),
  )
  if (supportCaseReachableComponentIds.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_support_case_not_component_reachable",
      carrierGraphFeatureKeys,
      carrierComponentIds: componentStats.map((component) => component.componentId),
      carrierEligibleComponentIds: eligibleComponents.map((component) => component.componentId),
      summary: {
        ...(cohort?.summary ?? {}),
        carrierGraphReady: false,
        carrierGraphReason: "unsat_support_case_not_component_reachable",
        carrierGraphFeatureCount: carrierGraphFeatureKeys.length,
        carrierComponentCount: componentStats.length,
        carrierEligibleComponentCount: eligibleComponents.length,
        supportCaseReachableComponentCount: 0,
      },
    }
  }

  return {
    ...cohort,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    supportNearHardNegativeRows: augmentedNegativeRows,
    carrierPositiveRows,
    carrierGraphFeatureKeys,
    localExpertFeatureKeys: carrierGraphFeatureKeys,
    localExpertDefaults: {
      requiredGroupType: "carrierComponent",
      marginFeatureKey: "sig.carrierGraph.componentBoundaryGap",
      riskFeatureKey: "sig.carrierGraph.negBorderEdgePressure",
      falsePositivePressureFeatureKey: "sig.carrierGraph.falsePositivePressure",
    },
    localExpertArtifactType: "perfect_prototype_support_carrier_graph_local_experts",
    carrierComponentIds: componentStats.map((component) => component.componentId),
    carrierEligibleComponentIds: eligibleComponents.map((component) => component.componentId),
    carrierComponentStats: componentStats.map((component) => ({
      componentId: component.componentId,
      summary: component.summary,
      borderSummary: component.borderSummary,
      radius: component.radius,
      purity: component.purity,
      breadthCarry: component.breadthCarry,
      persistenceShare: component.persistenceShare,
      eligible: component.eligible,
    })),
    summary: {
      ...(cohort?.summary ?? {}),
      carrierGraphReady: true,
      carrierGraphReason: null,
      carrierGraphFeatureCount: carrierGraphFeatureKeys.length,
      carrierComponentCount: componentStats.length,
      carrierEligibleComponentCount: eligibleComponents.length,
      supportCaseReachableComponentCount: supportCaseReachableComponentIds.length,
      supportCaseReachableComponentIds,
      supportCaseCarrierScoreMean: average(
        supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.carrierGraph.recurrenceCarrierScore"]),
      ),
      carrierPositiveSummary: summarizeRows(carrierPositiveRows),
      carrierNegativeSummary: summarizeRows(augmentedNegativeRows),
    },
  }
}
