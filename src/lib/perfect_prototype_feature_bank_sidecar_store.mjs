import {
  buildPerfectPrototypeDailyMechanismHypothesisCatalog,
  buildPerfectPrototypeFeatureBankContract,
  selectPerfectPrototypeHypothesisFeatureKeys,
} from "./perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankManifest } from "./perfect_prototype_feature_bank_manifest.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const clamp01 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

const safeDiv = (left, right) => {
  const numerator = Number(left)
  const denominator = Number(right)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return null
  return numerator / denominator
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

const readVectorValue = (vector, key) => num(vector?.[key])

const readStructuredFeatureValue = (row, featureKey) => {
  const normalizedKey = String(featureKey ?? "").trim()
  if (!normalizedKey) return null
  const directValue =
    readVectorValue(row?.numericFeatureMap, normalizedKey) ??
    readVectorValue(row?.featureVec, normalizedKey) ??
    readVectorValue(row?.globalFeatureVec, normalizedKey) ??
    readVectorValue(row?.eventFeatureVec, normalizedKey) ??
    readVectorValue(row?.marketContextVec, normalizedKey) ??
    readVectorValue(row?.xsecEventVec, normalizedKey)
  if (Number.isFinite(directValue)) return directValue
  if (normalizedKey.startsWith("market.")) {
    const suffix = normalizedKey.slice("market.".length)
    return readVectorValue(row?.marketContextVec, suffix)
  }
  if (normalizedKey.startsWith("xsec.")) {
    const suffix = normalizedKey.slice("xsec.".length)
    return readVectorValue(row?.xsecEventVec, suffix)
  }
  if (normalizedKey.startsWith("event.")) {
    const suffix = normalizedKey.slice("event.".length)
    return readVectorValue(row?.eventFeatureVec, suffix)
  }
  return null
}

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const getBase = (row, featureKey, fallback = 0) => readStructuredFeatureValue(row, featureKey) ?? fallback

const buildBaseMechanismFeatures = (row) => {
  const bodyPct = getBase(row, "candle.bodyPct")
  const rangePct = getBase(row, "candle.rangePct")
  const valueRatio20 = getBase(row, "volume.valueRatio20")
  const closeNearHigh20 = getBase(row, "level.closeNearHigh20")
  const breakoutPauseScore = getBase(row, "shape.breakoutPauseScore")
  const failedBreakoutCount20 = getBase(row, "shape.failedBreakoutCount20")
  const closeOverMa20 = getBase(row, "trend.closeOverMa20")
  const closeOverMa120 = getBase(row, "trend.closeOverMa120")
  const runUp10 = getBase(row, "trend.runUp10")
  const liquidityStress = getBase(row, "volume.liquidityStress")
  const globalValueRatio20Over150 = getBase(row, "global.valueRatio20Over150")
  const avgTradingValue20dKrw = getBase(row, "volume.avgTradingValue20dKrw")

  const pathEfficiencyProxy = Math.abs(runUp10) / Math.max(0.05, Math.abs(closeOverMa20) + Math.abs(closeOverMa120) + Math.abs(bodyPct))
  const pathRecoveryBias = closeNearHigh20 - failedBreakoutCount20 * 0.12
  const pathConvexityProxy = runUp10 - closeOverMa20

  const sponsorUpStrength = Math.max(bodyPct, 0) * Math.max(valueRatio20, 0) * clamp01(closeNearHigh20)
  const sponsorQuality = clamp01((closeNearHigh20 + clamp01(closeOverMa20 + 0.5)) / 2) * (1 - clamp01(liquidityStress))
  const sponsorFragility = Math.max(bodyPct, 0) * (1 - clamp01(closeNearHigh20)) / Math.max(0.2, Math.max(valueRatio20, 0.2))

  const stateReleaseQuality =
    Math.max(breakoutPauseScore, 0) * Math.max(bodyPct, 0) * clamp01(closeNearHigh20) * Math.max(valueRatio20, 0)
  const stateFailPressure = Math.max(failedBreakoutCount20, 0) * (1 - clamp01(closeNearHigh20)) * (1 + Math.max(rangePct, 0))
  const stateCompressionBias = Math.max(breakoutPauseScore, 0) * (1 - Math.min(1, Math.abs(bodyPct))) * (1 + Math.max(closeOverMa120, 0))

  const phaseIgnitionOnBase = Math.max(runUp10 - closeOverMa20, 0) * clamp01(1 - Math.abs(closeOverMa20 - closeOverMa120))
  const phaseExtensionRisk =
    Math.max(runUp10, 0) * Math.max(closeOverMa20, 0) * (1 - clamp01(closeNearHigh20) + clamp01(liquidityStress))
  const phaseMediumBaseBias = closeOverMa20 - closeOverMa120

  const liqStability = Math.max(valueRatio20, 0) / Math.max(1, 1 + Math.max(liquidityStress, 0)) * clamp01(closeNearHigh20)
  const liqFragility = clamp01(liquidityStress) * (1 - clamp01(closeNearHigh20) + Math.max(rangePct, 0))
  const liqSponsorshipCarry = Math.max(globalValueRatio20Over150, 0) * Math.max(avgTradingValue20dKrw, 0) / 1_000_000_000

  return {
    "sig.pathGeom.efficiencyProxy": pathEfficiencyProxy,
    "sig.pathGeom.recoveryBias": pathRecoveryBias,
    "sig.pathGeom.convexityProxy": pathConvexityProxy,
    "sig.sponsor.upStrength": sponsorUpStrength,
    "sig.sponsor.quality": sponsorQuality,
    "sig.sponsor.fragility": sponsorFragility,
    "sig.stateTrans.releaseQuality": stateReleaseQuality,
    "sig.stateTrans.failPressure": stateFailPressure,
    "sig.stateTrans.compressionBias": stateCompressionBias,
    "sig.phaseDiv.ignitionOnBase": phaseIgnitionOnBase,
    "sig.phaseDiv.extensionRisk": phaseExtensionRisk,
    "sig.phaseDiv.mediumBaseBias": phaseMediumBaseBias,
    "sig.liqPath.stability": liqStability,
    "sig.liqPath.fragility": liqFragility,
    "sig.liqPath.sponsorshipCarry": liqSponsorshipCarry,
  }
}

const rankPct = (sortedValues = [], value) => {
  const numeric = num(value)
  const filtered = (Array.isArray(sortedValues) ? sortedValues : []).map((entry) => num(entry)).filter(Number.isFinite)
  if (!Number.isFinite(numeric) || filtered.length < 1) return 0
  let lessOrEqualCount = 0
  for (const entry of filtered) {
    if (entry <= numeric) lessOrEqualCount += 1
  }
  return lessOrEqualCount / filtered.length
}

const buildDateJointFeatures = (rows = [], precomputed = new Map()) => {
  const axes = [
    "sig.pathGeom.efficiencyProxy",
    "sig.sponsor.upStrength",
    "sig.stateTrans.releaseQuality",
    "sig.phaseDiv.ignitionOnBase",
    "sig.liqPath.stability",
  ]
  const axisValues = Object.fromEntries(
    axes.map((featureKey) => [
      featureKey,
      (rows ?? []).map((row) => precomputed.get(String(row?.rowKey ?? ""))?.[featureKey]).filter(Number.isFinite),
    ]),
  )
  const axisAverages = new Map()
  for (const row of rows) {
    const rowKey = String(row?.rowKey ?? "").trim()
    const featureMap = precomputed.get(rowKey) ?? {}
    const perAxisRanks = axes.map((featureKey) => rankPct(axisValues[featureKey], featureMap[featureKey]))
    axisAverages.set(rowKey, average(perAxisRanks) ?? 0)
  }
  const averageRankAcrossDate = average(Array.from(axisAverages.values())) ?? 0
  const out = new Map()
  for (const row of rows) {
    const rowKey = String(row?.rowKey ?? "").trim()
    const featureMap = precomputed.get(rowKey) ?? {}
    const perAxisRanks = axes.map((featureKey) => rankPct(axisValues[featureKey], featureMap[featureKey]))
    const topDecileCount = perAxisRanks.filter((value) => value >= 0.8).length
    let dominanceCount = 0
    for (const peer of rows) {
      const peerKey = String(peer?.rowKey ?? "").trim()
      if (!peerKey || peerKey === rowKey) continue
      const peerFeatureMap = precomputed.get(peerKey) ?? {}
      let wins = 0
      for (const featureKey of axes) {
        if ((featureMap[featureKey] ?? -Infinity) >= (peerFeatureMap[featureKey] ?? -Infinity)) wins += 1
      }
      if (wins >= 3) dominanceCount += 1
    }
    const dominanceShare = rows.length > 1 ? dominanceCount / (rows.length - 1) : 0
    const avgRank = average(perAxisRanks) ?? 0
    out.set(rowKey, {
      "sig.slateJoint.avgRank": avgRank,
      "sig.slateJoint.topAxisShare": axes.length > 0 ? topDecileCount / axes.length : 0,
      "sig.slateJoint.dominanceShare": dominanceShare,
      "sig.slateJoint.densityMargin": avgRank - averageRankAcrossDate,
      "sig.slateJoint.jointRarity": avgRank + (topDecileCount / Math.max(1, axes.length)) * 0.2 + dominanceShare * 0.2,
    })
  }
  return out
}

export const buildPerfectPrototypeFeatureBankSidecarStore = ({
  family,
  bankContract = buildPerfectPrototypeFeatureBankContract(),
} = {}) => {
  const contractHypotheses =
    Array.isArray(bankContract?.hypotheses) && bankContract.hypotheses.length > 0
      ? bankContract.hypotheses
      : buildPerfectPrototypeDailyMechanismHypothesisCatalog()
  const collections = [
    ...(family?.trainRows ?? []),
    ...(family?.gatedTrainRows ?? []),
    ...(family?.oosRows ?? []),
    ...(family?.supportCaseViews ?? []),
    ...(family?.bridgePositiveRows ?? []),
    ...(family?.supportNearHardNegativeRows ?? []),
  ]
  const dedupedRows = Array.from(
    new Map(
      collections
        .map((row) => [String(row?.rowKey ?? row?.sourceId ?? "").trim(), row])
        .filter(([rowKey]) => rowKey),
    ).values(),
  )
  const grouped = groupRowsByDate(dedupedRows)
  const rowFeatureMapByKey = new Map()
  const partitions = []

  for (const [dateKey, rows] of grouped.entries()) {
    const sortedRows = rows.slice().sort((left, right) =>
      String(left?.rowKey ?? left?.sourceId ?? "").localeCompare(String(right?.rowKey ?? right?.sourceId ?? "")),
    )
    const precomputed = new Map()
    for (const row of sortedRows) {
      const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
      precomputed.set(rowKey, buildBaseMechanismFeatures(row))
    }
    const jointFeatureMap = buildDateJointFeatures(sortedRows, precomputed)
    for (const [index, row] of sortedRows.entries()) {
      const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
      const featureMap = {
        ...(precomputed.get(rowKey) ?? {}),
        ...(jointFeatureMap.get(rowKey) ?? {}),
      }
      featureMap["sig.slateJoint.rowOrdinal"] = index + 1
      rowFeatureMapByKey.set(rowKey, featureMap)
    }
    partitions.push({
      dateKey,
      rowCount: sortedRows.length,
    })
  }

  const featureKeys = uniqueStrings(
    Array.from(rowFeatureMapByKey.values()).flatMap((featureMap) => Object.keys(featureMap ?? {})).filter((featureKey) =>
      String(featureKey ?? "").startsWith("sig."),
    ),
  )
  const hydratedHypothesisCatalog = contractHypotheses.map((hypothesis) => ({
    ...hypothesis,
    featureKeys: selectPerfectPrototypeHypothesisFeatureKeys({ featureKeys, hypothesis }),
  }))
  const manifest = buildPerfectPrototypeFeatureBankManifest({
    bankContract,
    sidecarStore: {
      partitions,
      featureKeys,
    },
  })

  return {
    ok: rowFeatureMapByKey.size > 0 && featureKeys.length > 0,
    reason: rowFeatureMapByKey.size > 0 && featureKeys.length > 0 ? null : "unsat_no_mechanism_feature_bank",
    bankContract,
    manifest,
    partitions,
    featureKeys,
    hypothesisCatalog: hydratedHypothesisCatalog,
    rowFeatureMapByKey,
  }
}
