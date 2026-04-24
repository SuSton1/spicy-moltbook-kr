import {
  buildPerfectPrototypeSupportManifoldDataset,
  filterPerfectPrototypeSupportSignatureCategoricalTokens,
} from "./perfect_prototype_support_manifold_dataset.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const maxValue = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.max(...filtered)
}

const shareWhere = (values, predicate) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.filter((value) => predicate(value)).length / filtered.length
}

const resolveFeatureGroup = (featureKey) => {
  const normalizedKey = toText(featureKey) ?? ""
  if (normalizedKey.startsWith("event.")) return "event"
  if (normalizedKey.startsWith("feature.candle.")) return "candle"
  if (normalizedKey.startsWith("feature.gap.")) return "gap"
  if (normalizedKey.startsWith("feature.volume.")) return "volume"
  if (normalizedKey.startsWith("feature.trend.")) return "trend"
  if (normalizedKey.startsWith("feature.shape.") || normalizedKey.startsWith("feature.level.")) return "shape"
  if (normalizedKey.startsWith("market.")) return "market"
  if (normalizedKey.startsWith("xsec.")) return "xsec"
  if (normalizedKey.startsWith("seq")) return "sequence"
  return "other"
}

const resolveFeatureScale = (featureKey, prototypeValue) => {
  const normalizedKey = toText(featureKey) ?? ""
  const magnitude = Math.abs(num(prototypeValue) ?? 0)
  if (normalizedKey.includes("marketCapLog")) return Math.max(0.25, magnitude * 0.08)
  if (normalizedKey.includes("Count")) return Math.max(1, magnitude * 0.25)
  if (normalizedKey.startsWith("seq")) return Math.max(0.5, magnitude * 0.15)
  if (normalizedKey.includes("ratio") || normalizedKey.includes("Share") || normalizedKey.includes("Retention")) {
    return Math.max(0.08, magnitude * 0.2)
  }
  return Math.max(0.02, magnitude * 0.2)
}

const classifyClusterCell = ({ posDistance, margin, agreementShare, nearShare }) => {
  const pos = num(posDistance)
  const m = num(margin)
  const agree = num(agreementShare)
  const near = num(nearShare)
  if (Number.isFinite(pos) && pos <= 0.35 && Number.isFinite(m) && m >= 0.75) return "CORE"
  if (Number.isFinite(pos) && pos <= 0.8 && Number.isFinite(m) && m >= 0.3) return "EDGE"
  if (Number.isFinite(agree) && agree >= 0.5 && Number.isFinite(near) && near >= 0.5) return "SUPPORT_SIDE"
  if (Number.isFinite(m) && m >= 0) return "MIXED"
  return "OUTLIER"
}

export const buildPerfectPrototypeSupportManifoldConfig = ({
  familyId = null,
  supportCases = [],
} = {}) => {
  const dataset = buildPerfectPrototypeSupportManifoldDataset({ familyId, supportCases })
  if (dataset.featureKeys.length < 1) return null
  const featureScaleByKey = {}
  for (const featureKey of dataset.featureKeys) {
    featureScaleByKey[featureKey] = resolveFeatureScale(
      featureKey,
      dataset.prototypeNumericFeatureMap[featureKey],
    )
  }
  return {
    ...dataset,
    featureScaleByKey,
  }
}

export const buildPerfectPrototypeSupportSignatureMetrics = ({
  normalizedRow = null,
  supportSignatureConfig = null,
} = {}) => {
  if (!supportSignatureConfig || typeof supportSignatureConfig !== "object") {
    return { numericFeatureMap: {}, categoricalTokens: [] }
  }
  const featureKeys = Array.isArray(supportSignatureConfig.featureKeys)
    ? supportSignatureConfig.featureKeys
    : []
  if (featureKeys.length < 1) {
    return { numericFeatureMap: {}, categoricalTokens: [] }
  }
  const rowNumericFeatureMap =
    normalizedRow?.numericFeatureMap && typeof normalizedRow.numericFeatureMap === "object"
      ? normalizedRow.numericFeatureMap
      : {}
  const rowCategoricalTokens = filterPerfectPrototypeSupportSignatureCategoricalTokens(
    normalizedRow?.categoricalTokens ?? [],
  )
  const rowCategoricalTokenSet = new Set(rowCategoricalTokens)
  const supportCategoricalTokenSet =
    new Set(supportSignatureConfig.categoricalTokens ?? [])

  const distances = []
  const groupedDistances = new Map()
  for (const featureKey of featureKeys) {
    const prototypeValue = num(supportSignatureConfig.prototypeNumericFeatureMap?.[featureKey])
    const rowValue = num(rowNumericFeatureMap?.[featureKey])
    if (!Number.isFinite(prototypeValue) || !Number.isFinite(rowValue)) continue
    const scale = Math.max(
      0.0001,
      num(supportSignatureConfig.featureScaleByKey?.[featureKey]) ?? resolveFeatureScale(featureKey, prototypeValue),
    )
    const distance = Math.abs(rowValue - prototypeValue) / scale
    distances.push(distance)
    const group = resolveFeatureGroup(featureKey)
    const list = groupedDistances.get(group) ?? []
    list.push(distance)
    groupedDistances.set(group, list)
  }

  const totalSupportCategoricalCount = supportCategoricalTokenSet.size
  let matchedCategoricalCount = 0
  for (const token of supportCategoricalTokenSet) {
    if (rowCategoricalTokenSet.has(token)) matchedCategoricalCount += 1
  }
  const agreementShare =
    totalSupportCategoricalCount > 0 ? matchedCategoricalCount / totalSupportCategoricalCount : null
  const posDistance = average(distances)
  const maxDistance = maxValue(distances)
  const nearShare = shareWhere(distances, (value) => value <= 1)
  const featureCoverage = safeDiv(distances.length, featureKeys.length)
  const densityRatio =
    Number.isFinite(agreementShare) || Number.isFinite(nearShare) || Number.isFinite(posDistance)
      ? safeDiv(
          (Number(agreementShare ?? 0) || 0) + (Number(nearShare ?? 0) || 0),
          Math.max(0.25, Number(posDistance ?? 0.25) || 0.25),
        )
      : null
  const margin =
    Number.isFinite(agreementShare) || Number.isFinite(nearShare) || Number.isFinite(posDistance)
      ? (Number(agreementShare ?? 0) || 0) + (Number(nearShare ?? 0) || 0) - (Number(posDistance ?? 0) || 0)
      : null
  const numericFeatureMap = {
    "sig.support.posDistance": posDistance,
    "sig.support.maxDistance": maxDistance,
    "sig.support.margin": margin,
    "sig.support.densityRatio": densityRatio,
    "sig.support.prototypeAgreement": agreementShare,
    "sig.support.featureCoverage": featureCoverage,
    "sig.support.nearShare": nearShare,
  }
  for (const [group, groupValues] of groupedDistances.entries()) {
    numericFeatureMap[`sig.support.group.${group}Distance`] = average(groupValues)
  }
  const clusterCell = classifyClusterCell({
    posDistance,
    margin,
    agreementShare,
    nearShare,
  })
  const categoricalTokens = [
    `sig:support.clusterCell:${clusterCell}`,
    `sig:support.prototypeAgreement:${
      Number(agreementShare ?? 0) >= 0.75
        ? "HIGH"
        : Number(agreementShare ?? 0) >= 0.4
          ? "MID"
          : "LOW"
    }`,
    `sig:support.posDistance:${
      Number(posDistance ?? Number.POSITIVE_INFINITY) <= 0.35
        ? "NEAR"
        : Number(posDistance ?? Number.POSITIVE_INFINITY) <= 0.8
          ? "MID"
          : "FAR"
    }`,
    `sig:support.margin:${
      Number(margin ?? Number.NEGATIVE_INFINITY) >= 0.75
        ? "STRONG_POS"
        : Number(margin ?? Number.NEGATIVE_INFINITY) >= 0.25
          ? "POS"
          : Number(margin ?? Number.NEGATIVE_INFINITY) >= -0.1
            ? "MIXED"
            : "NEG"
    }`,
  ]
  return {
    numericFeatureMap: Object.fromEntries(
      Object.entries(numericFeatureMap).filter(([, value]) => Number.isFinite(num(value))),
    ),
    categoricalTokens,
    clusterCell,
    agreementShare: clamp(Number(agreementShare ?? 0) || 0, 0, 1),
    nearShare: clamp(Number(nearShare ?? 0) || 0, 0, 1),
    posDistance: Number.isFinite(posDistance) ? posDistance : null,
    margin: Number.isFinite(margin) ? margin : null,
    densityRatio: Number.isFinite(densityRatio) ? densityRatio : null,
    featureCoverage: Number.isFinite(featureCoverage) ? featureCoverage : null,
  }
}
