const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const CONTROL_AXES = [
  "sig.temporalEpisode.episodePositiveCarry",
  "sig.temporalEpisode.episodeNegativePressure",
  "sig.roleTopo.rolePurityLift",
  "sig.roleTopo.negativeRolePressure",
  "sig.roleTopo.roleBreadthCarry",
  "sig.roleTopo.roleCohesion",
  "sig.roleTopo.complementPocketAffinity",
]

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildQueryVector = (summary) => {
  const axisVector = Object.fromEntries(
    CONTROL_AXES.map((featureKey) => [featureKey, Number(summary?.axisMeans?.[featureKey] ?? 0)]),
  )
  return {
    rowCount: Number(summary?.rowCount ?? 0),
    foldCount: Number((summary?.foldIds ?? []).length),
    ...axisVector,
  }
}

const vectorDistance = (left, right) => {
  const leftVector = buildQueryVector(left)
  const rightVector = buildQueryVector(right)
  let distance = 0
  for (const key of Object.keys(leftVector)) {
    distance += Math.abs(Number(leftVector[key] ?? 0) - Number(rightVector[key] ?? 0))
  }
  return distance
}

const controlSummaryForRows = (rows = []) => {
  const axisMeans = Object.fromEntries(
    CONTROL_AXES.map((featureKey) => [
      featureKey,
      average(rows.map((row) => row?.numericFeatureMap?.[featureKey])) ?? 0,
    ]),
  )
  return {
    rowCount: rows.length,
    axisMeans,
  }
}

const augmentRowsWithControlResiduals = ({ rows = [], controlPoolLookup = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const control = controlPoolLookup.get(String(row?.queryId ?? "").trim()) ?? {
      controlQueryIds: [],
      controlSummary: controlSummaryForRows([]),
      nearestDistance: null,
    }
    const numericFeatureMap = row?.numericFeatureMap ?? {}
    let centroidGapSum = 0
    let centroidGapCount = 0
    let nearestGapSum = 0
    let nearestGapCount = 0
    for (const featureKey of CONTROL_AXES) {
      const rowValue = Number(num(row?.numericFeatureMap?.[featureKey]) ?? 0)
      const controlMean = Number(control?.controlSummary?.axisMeans?.[featureKey] ?? 0)
      const safeKey = featureKey.replace(/^sig\./, "").replaceAll(".", "_")
      const residual = rowValue - controlMean
      numericFeatureMap[`sig.ctrlResidual.${safeKey}`] = residual
      centroidGapSum += residual
      centroidGapCount += 1
      nearestGapSum += residual
      nearestGapCount += 1
    }
    const centroidGap = centroidGapCount > 0 ? centroidGapSum / centroidGapCount : 0
    const nearestNegativeGap = nearestGapCount > 0 ? nearestGapSum / nearestGapCount : 0
    const residualRank = Math.max(
      0,
      centroidGap - Number(control?.nearestDistance ?? 0) / Math.max(1, Number(control?.controlQueryIds?.length ?? 1)),
    )
    numericFeatureMap["sig.ctrlResidual.controlCentroidGap"] = centroidGap
    numericFeatureMap["sig.ctrlResidual.nearestNegativeGap"] = nearestNegativeGap
    numericFeatureMap["sig.ctrlResidual.regimeResidualRank"] = residualRank
    numericFeatureMap["sig.ctrlResidual.regimeResidualRisk"] = Math.max(0, -centroidGap)
    numericFeatureMap["sig.ctrlResidual.controlPoolSize"] = Number(control?.controlQueryIds?.length ?? 0)
    row.numericFeatureMap = numericFeatureMap
    row.matchedControlQueryIds = control?.controlQueryIds ?? []
    return row
  })

const collectResidualFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.ctrlResidual.")),
    ),
  )

export const buildPerfectPrototypeSupportMatchedControlPool = ({
  family,
  controlPoolSize = 5,
} = {}) => {
  const negativeQuerySummaries = (family?.trainQuerySummaries ?? []).filter((entry) => entry.queryLabel === "negative")
  if (negativeQuerySummaries.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_matched_control_queries",
      summary: {
        ...(family?.summary ?? {}),
        matchedControlReady: false,
        matchedControlQueryCount: 0,
      },
    }
  }

  const trainByQuery = new Map()
  for (const row of family?.gatedTrainRows ?? []) {
    const key = String(row?.queryId ?? "").trim()
    const bucket = trainByQuery.get(key) ?? []
    bucket.push(row)
    trainByQuery.set(key, bucket)
  }

  const buildPoolLookup = (querySummaries = []) => {
    const lookup = new Map()
    for (const summary of Array.isArray(querySummaries) ? querySummaries : []) {
      const matched = negativeQuerySummaries
        .filter((candidate) => String(candidate?.queryId ?? "") !== String(summary?.queryId ?? ""))
        .map((candidate) => ({
          queryId: candidate.queryId,
          distance: vectorDistance(summary, candidate),
        }))
        .sort((left, right) => left.distance - right.distance || left.queryId.localeCompare(right.queryId))
        .slice(0, Math.max(1, Math.floor(Number(controlPoolSize) || 5)))
      const controlRows = matched.flatMap((entry) => trainByQuery.get(entry.queryId) ?? [])
      lookup.set(summary.queryId, {
        controlQueryIds: matched.map((entry) => entry.queryId),
        nearestDistance: matched[0]?.distance ?? null,
        controlSummary: controlSummaryForRows(controlRows),
      })
    }
    return lookup
  }

  const trainControlLookup = buildPoolLookup(family?.trainQuerySummaries ?? [])
  const oosControlLookup = buildPoolLookup(family?.oosQuerySummaries ?? [])
  const supportControlLookup = buildPoolLookup(family?.supportQuerySummaries ?? [])

  const trainRows = augmentRowsWithControlResiduals({ rows: family?.trainRows ?? [], controlPoolLookup: trainControlLookup })
  const gatedTrainRows = augmentRowsWithControlResiduals({
    rows: family?.gatedTrainRows ?? [],
    controlPoolLookup: trainControlLookup,
  })
  const oosRows = augmentRowsWithControlResiduals({ rows: family?.oosRows ?? [], controlPoolLookup: oosControlLookup })
  const supportCaseViews = augmentRowsWithControlResiduals({
    rows: family?.supportCaseViews ?? [],
    controlPoolLookup: supportControlLookup,
  })

  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedLookup.get(row?.rowKey) ?? trainLookup.get(row?.rowKey) ?? row,
  )
  const residualFeatureKeys = collectResidualFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])

  return {
    ...family,
    ok: residualFeatureKeys.length > 0,
    reason: residualFeatureKeys.length > 0 ? null : "unsat_no_matched_control_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    matchedControlPoolSize: Math.max(1, Math.floor(Number(controlPoolSize) || 5)),
    residualFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      matchedControlReady: residualFeatureKeys.length > 0,
      matchedControlQueryCount: negativeQuerySummaries.length,
      matchedControlPoolSize: Math.max(1, Math.floor(Number(controlPoolSize) || 5)),
      residualFeatureCount: residualFeatureKeys.length,
    },
  }
}
