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

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const distanceToPrototype = ({ row, prototype = {}, featureKeys = [] } = {}) => {
  let total = 0
  let count = 0
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const rowValue = num(row?.numericFeatureMap?.[featureKey])
    const prototypeValue = num(prototype?.[featureKey])
    if (!Number.isFinite(rowValue) || !Number.isFinite(prototypeValue)) continue
    total += Math.abs(rowValue - prototypeValue)
    count += 1
  }
  if (count < 1) return Number.POSITIVE_INFINITY
  return total / count
}

const collectProjectionFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter(
        (featureKey) =>
          featureKey.startsWith("sig.ordinalMotif.") ||
          featureKey.startsWith("sig.recurBoundary.") ||
          featureKey === "sig.boundary.supportRecoveryPotential" ||
          featureKey === "sig.bridge.posNegMargin" ||
          featureKey === "sig.bridge.bestPositiveCellMargin",
      ),
    ),
  )

const buildNeighborArtifact = (family) => ({
  gateTokens: family?.gateTokens ?? [],
  featureEntries: family?.corridorFeatureEntries ?? [],
  trainNodes: family?.propagatedTrainNodes ?? [],
  neighborCount: 12,
  selectThreshold: -1,
  marginThreshold: -1,
  abstainThreshold: -1,
})

const buildProjectionMetrics = ({
  row,
  basins = [],
  featureKeys = [],
  graphEvaluation = {},
} = {}) => {
  let best = null
  let secondBest = null
  const numericFeatureMap = {}
  for (const basin of Array.isArray(basins) ? basins : []) {
    const distance = distanceToPrototype({
      row,
      prototype: basin?.prototype ?? {},
      featureKeys,
    })
    if (!Number.isFinite(distance)) continue
    const positivePotential = Number(graphEvaluation?.positivePotential ?? 0)
    const negativePotential = Number(graphEvaluation?.negativePotential ?? 0)
    const motifAgreement = Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]) ?? 0)
    const negativeMotifConflict = Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.negativeMotifConflict"]) ?? 0)
    const score =
      Number(basin?.radius ?? 0.25) * 1.35 -
      distance +
      positivePotential * 0.5 -
      negativePotential * 0.35 +
      motifAgreement * 0.25 -
      negativeMotifConflict * 0.25
    numericFeatureMap[`sig.corridorBasin.basin.${basin.basinId}.projectionMargin`] = score
    numericFeatureMap[`sig.corridorBasin.basin.${basin.basinId}.distance`] = distance
    if (!best || score > best.score) {
      secondBest = best
      best = { basinId: basin.basinId, score, distance }
    } else if (!secondBest || score > secondBest.score) {
      secondBest = { basinId: basin.basinId, score, distance }
    }
  }
  const marginGap =
    best && secondBest ? Number(best.score ?? 0) - Number(secondBest.score ?? 0) : Number(best?.score ?? Number.NaN)
  const falsePositivePressure =
    Math.max(0, Number(graphEvaluation?.negativePotential ?? 0)) +
    Math.max(0, Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]) ?? 0)) +
    Math.max(0, -Number(best?.score ?? 0))
  const reachableBasinIds = (Array.isArray(basins) ? basins : [])
    .filter((basin) => Number(numericFeatureMap[`sig.corridorBasin.basin.${basin.basinId}.projectionMargin`] ?? Number.NEGATIVE_INFINITY) >= -0.05)
    .map((basin) => basin.basinId)
  numericFeatureMap["sig.corridorBasin.localRecoveryMargin"] = Number(best?.score ?? Number.NaN)
  numericFeatureMap["sig.corridorBasin.marginGap"] = marginGap
  numericFeatureMap["sig.corridorBasin.positivePotential"] = Number(graphEvaluation?.positivePotential ?? Number.NaN)
  numericFeatureMap["sig.corridorBasin.negativePotential"] = Number(graphEvaluation?.negativePotential ?? Number.NaN)
  numericFeatureMap["sig.corridorBasin.falsePositivePressure"] = falsePositivePressure

  return {
    corridorDominantBasin: best?.basinId ?? null,
    corridorReachableBasinIds: reachableBasinIds,
    corridorBorderBasin: best?.basinId ?? null,
    numericFeatureMap,
    categoricalTokens: uniqueStrings(
      [
        best?.basinId ? `sig:corridorBasin:dominant:${best.basinId}` : null,
        ...reachableBasinIds.map((basinId) => `sig:corridorBasin:reach:${basinId}`),
      ].filter(Boolean),
    ),
  }
}

const collectCorridorBasinFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.corridorBasin.")),
    ),
  )

export const buildPerfectPrototypeSupportCorridorBasinProjection = ({
  family,
} = {}) => {
  const basins = Array.isArray(family?.corridorPositiveBasins) ? family.corridorPositiveBasins : []
  if (basins.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_corridor_positive_basins",
      summary: {
        ...(family?.summary ?? {}),
        corridorBasinProjectionReady: false,
        corridorBasinProjectionReason: "unsat_no_corridor_positive_basins",
        supportCaseReachableBasinCount: 0,
      },
    }
  }

  const projectionFeatureKeys =
    Array.isArray(family?.corridorPositiveBasinFeatureKeys) && family.corridorPositiveBasinFeatureKeys.length > 0
      ? family.corridorPositiveBasinFeatureKeys
      : collectProjectionFeatureKeys(family?.bridgePositiveRows ?? [])
  const graphArtifact = buildNeighborArtifact(family)
  const trainNodeMap = new Map((family?.propagatedTrainNodes ?? []).map((node) => [node.rowKey, node]))
  const supportEvaluations = scorePerfectPrototypeSupportGraphRows({
    artifact: graphArtifact,
    rows: family?.supportCaseViews ?? [],
  })
  const supportEvalMap = new Map(supportEvaluations.map((entry) => [entry?.row?.rowKey, entry]))
  const oosEvaluations = scorePerfectPrototypeSupportGraphRows({
    artifact: graphArtifact,
    rows: family?.oosRows ?? [],
  })
  const oosEvalMap = new Map(oosEvaluations.map((entry) => [entry?.row?.rowKey, entry]))

  const augmentRows = (rows, evaluationMap) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const graphEvaluation =
        evaluationMap?.get(row?.rowKey) ??
        trainNodeMap.get(row?.rowKey) ?? {
          positivePotential: null,
          negativePotential: null,
        }
      const projection = buildProjectionMetrics({
        row,
        basins,
        featureKeys: projectionFeatureKeys,
        graphEvaluation,
      })
      const categoricalTokens = uniqueStrings([
        ...(row?.categoricalTokens ?? []),
        ...(projection.categoricalTokens ?? []),
      ])
      return {
        ...row,
        corridorDominantBasin: projection.corridorDominantBasin,
        corridorReachableBasinIds: projection.corridorReachableBasinIds,
        corridorBorderBasin: projection.corridorBorderBasin,
        numericFeatureMap: {
          ...(row?.numericFeatureMap ?? {}),
          ...(projection.numericFeatureMap ?? {}),
        },
        categoricalTokens,
        tokenSet: new Set(categoricalTokens),
      }
    })

  const trainRows = augmentRows(family?.trainRows, trainNodeMap)
  const gatedTrainRows = augmentRows(family?.gatedTrainRows, trainNodeMap)
  const oosRows = augmentRows(family?.oosRows, oosEvalMap)
  const supportCaseViews = augmentRows(family?.supportCaseViews, supportEvalMap)
  const trainByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const gatedByKey = new Map(gatedTrainRows.map((row) => [row.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map((row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row)
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row,
  )
  const corridorBasinFeatureKeys = collectCorridorBasinFeatureKeys([
    ...trainRows,
    ...oosRows,
    ...supportCaseViews,
  ])
  const supportCaseReachableBasinIds = uniqueStrings(
    supportCaseViews.flatMap((row) => row?.corridorReachableBasinIds ?? []),
  )

  if (supportCaseReachableBasinIds.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_support_case_not_basin_reachable",
      trainRows,
      gatedTrainRows,
      oosRows,
      supportCaseViews,
      bridgePositiveRows,
      supportNearHardNegativeRows,
      corridorBasinFeatureKeys,
      summary: {
        ...(family?.summary ?? {}),
        corridorBasinProjectionReady: false,
        corridorBasinProjectionReason: "unsat_support_case_not_basin_reachable",
        corridorPositiveBasinCount: basins.length,
        corridorPositiveSeedCount: Number(family?.summary?.corridorPositiveSeedCount ?? 0),
        supportCaseReachableBasinCount: 0,
      },
    }
  }

  return {
    ...family,
    ok: true,
    reason: null,
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    corridorBasinFeatureKeys,
    localExpertFeatureKeys: uniqueStrings([
      ...(family?.ordinalMotifFeatureKeys ?? []),
      ...(family?.recurrencePurityFeatureKeys ?? []),
      ...corridorBasinFeatureKeys,
    ]),
    localExpertDefaults: {
      requiredGroupType: "corridorBasin",
      marginFeatureKey: "sig.corridorBasin.localRecoveryMargin",
      riskFeatureKey: "sig.corridorBasin.negativePotential",
      falsePositivePressureFeatureKey: "sig.corridorBasin.falsePositivePressure",
    },
    localExpertArtifactType: "perfect_prototype_support_corridor_local_experts",
    corridorPositiveBasinIds: basins.map((basin) => basin.basinId),
    corridorPositiveEligibleBasinIds: basins.filter((basin) => basin.eligible === true).map((basin) => basin.basinId),
    summary: {
      ...(family?.summary ?? {}),
      corridorBasinProjectionReady: true,
      corridorBasinProjectionReason: null,
      corridorPositiveBasinCount: basins.length,
      corridorPositiveEligibleBasinCount: basins.filter((basin) => basin.eligible === true).length,
      corridorPositiveSeedCount: Number(family?.summary?.corridorPositiveSeedCount ?? 0),
      supportCaseReachableBasinCount: supportCaseReachableBasinIds.length,
      supportCaseReachableBasinIds,
      supportCaseProjectionMarginMean: average(
        supportCaseViews.map((row) => row?.numericFeatureMap?.["sig.corridorBasin.localRecoveryMargin"]),
      ),
    },
  }
}
