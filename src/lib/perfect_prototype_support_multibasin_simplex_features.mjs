const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const basinBreadthCarry = (basin) =>
  clamp(
    Number(basin?.summary?.matchedDateCount ?? 0) / 10 +
      Number(basin?.summary?.matchedMonthCount ?? 0) / 6 +
      Number(basin?.summary?.matchedFoldCount ?? 0) / 4,
    0,
    6,
  )

const entropyOf = (weights = []) => {
  const filtered = (Array.isArray(weights) ? weights : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 2) return 0
  const shifted = filtered.map((value) => Math.max(0.001, value))
  const total = shifted.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return 0
  const entropy = shifted.reduce((sum, value) => {
    const p = value / total
    return p > 0 ? sum - p * Math.log(p) : sum
  }, 0)
  return entropy / Math.log(shifted.length)
}

const collectSimplexFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.simplex.")),
    ),
  )

const decorateRow = ({ row, basins = [] } = {}) => {
  const basinScores = (Array.isArray(basins) ? basins : [])
    .map((basin) => {
      const affinity = num(row?.numericFeatureMap?.[`sig.corridorBasin.basin.${basin.basinId}.projectionMargin`])
      return {
        basinId: basin.basinId,
        affinity,
        breadthCarry: basinBreadthCarry(basin),
      }
    })
    .filter((entry) => Number.isFinite(entry.affinity))
    .sort((left, right) => right.affinity - left.affinity || left.basinId.localeCompare(right.basinId))

  const numericFeatureMap = {}
  const categoricalTokens = []
  if (basinScores.length < 1) {
    return {
      simplexDominantBasin: null,
      simplexReachableBasinIds: [],
      numericFeatureMap,
      categoricalTokens,
    }
  }

  const top = basinScores[0]
  const second = basinScores[1] ?? null
  const secondAffinity = Number(second?.affinity ?? top.affinity)
  const topAffinity = Number(top.affinity ?? 0)
  const affinityGap = topAffinity - secondAffinity
  const negativePotential = Math.max(
    0,
    Number(num(row?.numericFeatureMap?.["sig.corridorBasin.negativePotential"]) ?? 0),
  )
  const falsePositivePressure = Math.max(
    0,
    Number(num(row?.numericFeatureMap?.["sig.corridorBasin.falsePositivePressure"]) ?? 0),
  )
  const positiveWeights = basinScores.map((entry) => Math.max(0.001, Number(entry.affinity ?? 0) + 1.5))
  const basinEntropy = entropyOf(positiveWeights)

  for (const entry of basinScores) {
    const otherTop = basinScores.find((candidate) => candidate.basinId !== entry.basinId)
    const exclusiveAffinity = Number(entry.affinity ?? 0) - Number(otherTop?.affinity ?? entry.affinity ?? 0)
    const borderMargin = Number(entry.affinity ?? 0) - negativePotential
    numericFeatureMap[`sig.simplex.basin.${entry.basinId}.affinity`] = Number(entry.affinity ?? 0)
    numericFeatureMap[`sig.simplex.basin.${entry.basinId}.exclusiveAffinity`] = exclusiveAffinity
    numericFeatureMap[`sig.simplex.basin.${entry.basinId}.borderMargin`] = borderMargin
    numericFeatureMap[`sig.simplex.basin.${entry.basinId}.breadthCarry`] = Number(entry.breadthCarry ?? 0)
  }

  const topBreadthCarry = Number(top?.breadthCarry ?? 0)
  const positiveBorderMargin = topAffinity - negativePotential
  const supportRecoveryPotential =
    positiveBorderMargin +
    affinityGap * 0.8 +
    topBreadthCarry * 0.2 -
    falsePositivePressure * 0.25 -
    basinEntropy * 0.25

  const reachableBasinIds = basinScores
    .filter((entry) => Number(entry.affinity ?? Number.NEGATIVE_INFINITY) >= Math.max(-0.1, topAffinity - 0.35))
    .map((entry) => entry.basinId)

  numericFeatureMap["sig.simplex.global.topAffinity"] = topAffinity
  numericFeatureMap["sig.simplex.global.secondAffinity"] = secondAffinity
  numericFeatureMap["sig.simplex.global.affinityGap"] = affinityGap
  numericFeatureMap["sig.simplex.global.basinEntropy"] = basinEntropy
  numericFeatureMap["sig.simplex.global.positiveBorderMargin"] = positiveBorderMargin
  numericFeatureMap["sig.simplex.global.supportRecoveryPotential"] = supportRecoveryPotential

  categoricalTokens.push(`sig:simplex:dominant:${top.basinId}`)
  for (const basinId of reachableBasinIds) categoricalTokens.push(`sig:simplex:reach:${basinId}`)

  return {
    simplexDominantBasin: top.basinId,
    simplexReachableBasinIds: reachableBasinIds,
    numericFeatureMap,
    categoricalTokens,
  }
}

export const buildPerfectPrototypeSupportMultibasinSimplexFeatures = ({ family } = {}) => {
  const basins = Array.isArray(family?.corridorPositiveBasins) ? family.corridorPositiveBasins : []
  if (basins.length < 2) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_multibasin_simplex_features",
      summary: {
        ...(family?.summary ?? {}),
        simplexReady: false,
        simplexReason: "unsat_no_multibasin_simplex_features",
        simplexFeatureCount: 0,
      },
    }
  }

  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const simplex = decorateRow({ row, basins })
      const categoricalTokens = uniqueStrings([
        ...(row?.categoricalTokens ?? []),
        ...(simplex.categoricalTokens ?? []),
      ])
      const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(categoricalTokens)
      return {
        ...row,
        simplexDominantBasin: simplex.simplexDominantBasin,
        simplexReachableBasinIds: simplex.simplexReachableBasinIds,
        numericFeatureMap: {
          ...(row?.numericFeatureMap ?? {}),
          ...(simplex.numericFeatureMap ?? {}),
        },
        categoricalTokens,
        tokenSet,
      }
    })

  const trainRows = augmentRows(family?.trainRows)
  const gatedTrainRows = augmentRows(family?.gatedTrainRows)
  const oosRows = augmentRows(family?.oosRows)
  const supportCaseViews = augmentRows(family?.supportCaseViews)
  const gatedByKey = new Map(gatedTrainRows.map((row) => [row.rowKey, row]))
  const trainByKey = new Map(trainRows.map((row) => [row.rowKey, row]))
  const bridgePositiveRows = (family?.bridgePositiveRows ?? []).map(
    (row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).map(
    (row) => gatedByKey.get(row.rowKey) ?? trainByKey.get(row.rowKey) ?? row,
  )
  const simplexFeatureKeys = collectSimplexFeatureKeys([...trainRows, ...oosRows, ...supportCaseViews])
  const supportCaseReachableBasinIds = uniqueStrings(
    supportCaseViews.flatMap((row) => row?.simplexReachableBasinIds ?? row?.corridorReachableBasinIds ?? []),
  )

  return {
    ...family,
    ok: simplexFeatureKeys.length > 0,
    reason: simplexFeatureKeys.length > 0 ? null : "unsat_no_multibasin_simplex_features",
    trainRows,
    gatedTrainRows,
    oosRows,
    supportCaseViews,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    simplexFeatureKeys,
    localExpertFeatureKeys: uniqueStrings([
      ...(family?.localExpertFeatureKeys ?? []),
      ...simplexFeatureKeys,
    ]),
    localExpertDefaults: {
      ...(family?.localExpertDefaults ?? {}),
      requiredGroupType: "corridorBasin",
      marginFeatureKey: "sig.simplex.global.positiveBorderMargin",
      riskFeatureKey: family?.localExpertDefaults?.riskFeatureKey ?? "sig.corridorBasin.negativePotential",
      falsePositivePressureFeatureKey:
        family?.localExpertDefaults?.falsePositivePressureFeatureKey ?? "sig.corridorBasin.falsePositivePressure",
    },
    summary: {
      ...(family?.summary ?? {}),
      simplexReady: simplexFeatureKeys.length > 0,
      simplexReason: simplexFeatureKeys.length > 0 ? null : "unsat_no_multibasin_simplex_features",
      simplexFeatureCount: simplexFeatureKeys.length,
      supportCaseReachableBasinCount: supportCaseReachableBasinIds.length,
      supportCaseReachableBasinIds,
    },
  }
}
