const toText = (value) => String(value ?? "").trim()

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

const stdev = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 2) return null
  const meanValue = average(filtered)
  if (!Number.isFinite(meanValue)) return null
  const variance = filtered.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / filtered.length
  return Math.sqrt(variance)
}

const clamp01 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

const boundAbs = (value, limit) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const safeLimit = Math.max(0.000001, Number(limit) || 0.000001)
  return Math.max(-safeLimit, Math.min(safeLimit, numeric))
}

const readVectorValue = (vector, key) => num(vector?.[key])

const readStructuredFeatureValue = (row, featureKey) => {
  const normalizedKey = toText(featureKey)
  if (!normalizedKey) return null
  const direct =
    readVectorValue(row?.numericFeatureMap, normalizedKey) ??
    readVectorValue(row?.featureVec, normalizedKey.startsWith("feature.") ? normalizedKey.slice("feature.".length) : normalizedKey) ??
    readVectorValue(row?.globalFeatureVec, normalizedKey.startsWith("global.") ? normalizedKey.slice("global.".length) : normalizedKey) ??
    readVectorValue(row?.eventFeatureVec, normalizedKey.startsWith("event.") ? normalizedKey.slice("event.".length) : normalizedKey) ??
    readVectorValue(row?.marketContextVec, normalizedKey.startsWith("market.") ? normalizedKey.slice("market.".length) : normalizedKey) ??
    readVectorValue(row?.xsecEventVec, normalizedKey.startsWith("xsec.") ? normalizedKey.slice("xsec.".length) : normalizedKey)
  if (Number.isFinite(direct)) return direct
  return null
}

const getBase = (row, featureKey, fallback = 0) => readStructuredFeatureValue(row, featureKey) ?? fallback

const buildMechanismBase = (row) => {
  const bodyPct = getBase(row, "feature.candle.bodyPct")
  const rangePct = getBase(row, "feature.candle.rangePct")
  const valueRatio20 = getBase(row, "feature.volume.valueRatio20")
  const closeNearHigh20 = getBase(row, "feature.level.closeNearHigh20")
  const breakoutPauseScore = getBase(row, "feature.shape.breakoutPauseScore")
  const failedBreakoutCount20 = getBase(row, "feature.shape.failedBreakoutCount20")
  const closeOverMa20 = getBase(row, "feature.trend.closeOverMa20")
  const closeOverMa120 = getBase(row, "feature.trend.closeOverMa120")
  const slope10 = getBase(row, "feature.trend.slope10")
  const slope20 = getBase(row, "feature.trend.slope20")
  const runUp10 = getBase(row, "feature.trend.runUp10")
  const liquidityStress = getBase(row, "feature.volume.liquidityStress")
  const avgTradingValue20dKrw = getBase(row, "feature.volume.avgTradingValue20dKrw")
  const globalValueRatio20Over150 = getBase(row, "global.valueRatio20Over150")
  const volatility40 = getBase(row, "global.volatility40")
  const compression20 = getBase(row, "feature.shape.compression20")
  const sidewaysScore10 = getBase(row, "feature.shape.sidewaysScore10")

  const pathRecoveryBias = closeNearHigh20 - failedBreakoutCount20 * 0.12
  const stateReleaseQuality =
    Math.max(breakoutPauseScore, 0) * Math.max(bodyPct, 0) * clamp01(closeNearHigh20) * Math.max(valueRatio20, 0)
  const stateFailPressure = Math.max(failedBreakoutCount20, 0) * (1 - clamp01(closeNearHigh20)) * (1 + Math.max(rangePct, 0))
  const phaseIgnitionOnBase = Math.max(runUp10 - closeOverMa20, 0) * clamp01(1 - Math.abs(closeOverMa20 - closeOverMa120))
  const phaseExtensionRisk =
    Math.max(runUp10, 0) * Math.max(closeOverMa20, 0) * (1 - clamp01(closeNearHigh20) + clamp01(liquidityStress))
  const liqStability = Math.max(valueRatio20, 0) / Math.max(1, 1 + Math.max(liquidityStress, 0)) * clamp01(closeNearHigh20)
  const liqFragility = clamp01(liquidityStress) * (1 - clamp01(closeNearHigh20) + Math.max(rangePct, 0))
  const liqSponsorshipCarry = Math.max(globalValueRatio20Over150, 0) * Math.max(avgTradingValue20dKrw, 0) / 1_000_000_000

  return {
    bodyPct,
    rangePct,
    valueRatio20,
    closeNearHigh20,
    breakoutPauseScore,
    failedBreakoutCount20,
    closeOverMa20,
    closeOverMa120,
    slope10,
    slope20,
    runUp10,
    liquidityStress,
    avgTradingValue20dKrw,
    volatility40,
    compression20,
    sidewaysScore10,
    pathRecoveryBias,
    stateReleaseQuality,
    stateFailPressure,
    phaseIgnitionOnBase,
    phaseExtensionRisk,
    liqStability,
    liqFragility,
    liqSponsorshipCarry,
  }
}

const buildSequenceStats = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) {
    return {
      mean: 0,
      stdev: 0,
      delta: 0,
      negativeShare: 0,
    }
  }
  const firstValue = filtered[0]
  const lastValue = filtered[filtered.length - 1]
  const negativeCount = filtered.filter((value) => value < 0).length
  return {
    mean: average(filtered) ?? 0,
    stdev: stdev(filtered) ?? 0,
    delta: Number.isFinite(firstValue) && Number.isFinite(lastValue) ? lastValue - firstValue : 0,
    negativeShare: safeDiv(negativeCount, filtered.length) ?? 0,
  }
}

export const TP12_NO_GAP_BASE_FAMILY_CLOSE = "LOW_CLOSE_ONLY"
export const TP12_NO_GAP_BASE_FAMILY_JUMP = "LOW_JUMP_ONLY"
export const TP12_NO_GAP_ADDON_BASE = "BASE"
export const TP12_NO_GAP_ADDON_RETENTION_V1 = "RETENTION_V1"
export const TP12_NO_GAP_ADDON_REVTURN_V1 = "REVTURN_V1"
export const TP12_NO_GAP_ADDON_LIQVOL_V1 = "LIQVOL_V1"
export const TP12_NO_GAP_ADDON_COMPRESSION_V1 = "COMPRESSION_V1"
export const TP12_NO_GAP_ADDON_SEQRECENT_V1 = "SEQRECENT_V1"

export const TP12_NO_GAP_BASE_FAMILY_IDS = Object.freeze([
  TP12_NO_GAP_BASE_FAMILY_CLOSE,
  TP12_NO_GAP_BASE_FAMILY_JUMP,
])

export const TP12_NO_GAP_ADDON_IDS = Object.freeze([
  TP12_NO_GAP_ADDON_BASE,
  TP12_NO_GAP_ADDON_RETENTION_V1,
  TP12_NO_GAP_ADDON_REVTURN_V1,
  TP12_NO_GAP_ADDON_LIQVOL_V1,
  TP12_NO_GAP_ADDON_COMPRESSION_V1,
  TP12_NO_GAP_ADDON_SEQRECENT_V1,
])

export const buildTp12NoGapAddonFeatureMap = ({ row, addonId } = {}) => {
  const normalizedAddonId = toText(addonId).toUpperCase()
  if (!normalizedAddonId || normalizedAddonId === TP12_NO_GAP_ADDON_BASE) return {}
  const mechanism = buildMechanismBase(row)
  const closeRetentionFromOpen = getBase(row, "event.closeRetentionFromOpen")
  const closeRetentionFromPrevClose = getBase(row, "event.closeRetentionFromPrevClose")
  const seq40 = buildSequenceStats(row?.seq40 ?? [])
  const seq150 = buildSequenceStats(row?.seq150 ?? [])
  if (normalizedAddonId === TP12_NO_GAP_ADDON_RETENTION_V1) {
    return {
      "addon.retention.openHold": boundAbs(closeRetentionFromOpen, 8),
      "addon.retention.prevCloseHold": boundAbs(closeRetentionFromPrevClose, 4),
      "addon.retention.closeNearHigh20": mechanism.closeNearHigh20,
      "addon.retention.balance":
        average([
          boundAbs(closeRetentionFromOpen, 2),
          boundAbs(closeRetentionFromPrevClose, 2),
          mechanism.closeNearHigh20,
        ]) ?? 0,
    }
  }
  if (normalizedAddonId === TP12_NO_GAP_ADDON_REVTURN_V1) {
    return {
      "addon.revturn.recoveryBias": mechanism.pathRecoveryBias,
      "addon.revturn.ignitionOnBase": mechanism.phaseIgnitionOnBase,
      "addon.revturn.reclaimMargin":
        mechanism.pathRecoveryBias + mechanism.phaseIgnitionOnBase - mechanism.phaseExtensionRisk,
      "addon.revturn.trendSupport":
        mechanism.slope10 + mechanism.slope20 + mechanism.closeOverMa20 + mechanism.closeOverMa120,
    }
  }
  if (normalizedAddonId === TP12_NO_GAP_ADDON_LIQVOL_V1) {
    const logAvgTradingValue = Math.log1p(Math.max(0, mechanism.avgTradingValue20dKrw) / 100_000_000)
    return {
      "addon.liqvol.stability": mechanism.liqStability,
      "addon.liqvol.fragilityDiscount": mechanism.liqStability - mechanism.liqFragility,
      "addon.liqvol.supportPerVol":
        (Math.max(0, mechanism.valueRatio20) * Math.max(0, logAvgTradingValue + mechanism.liqSponsorshipCarry)) /
        Math.max(0.05, Math.max(0, mechanism.volatility40)),
      "addon.liqvol.valuePerRange": Math.max(0, logAvgTradingValue) / Math.max(0.01, Math.max(0, mechanism.rangePct)),
    }
  }
  if (normalizedAddonId === TP12_NO_GAP_ADDON_COMPRESSION_V1) {
    return {
      "addon.compression.tightness": mechanism.compression20,
      "addon.compression.sidewaysScore10": mechanism.sidewaysScore10,
      "addon.compression.releaseQuality": mechanism.stateReleaseQuality,
      "addon.compression.releaseVsFail": mechanism.stateReleaseQuality - mechanism.stateFailPressure,
    }
  }
  if (normalizedAddonId === TP12_NO_GAP_ADDON_SEQRECENT_V1) {
    return {
      "addon.seqrecent.shortDelta": seq40.delta,
      "addon.seqrecent.shortStdev": seq40.stdev,
      "addon.seqrecent.shortNegativeShare": seq40.negativeShare,
      "addon.seqrecent.longDelta": seq150.delta,
      "addon.seqrecent.longStdev": seq150.stdev,
      "addon.seqrecent.longNegativeShare": seq150.negativeShare,
      "addon.seqrecent.deltaSpread": seq40.delta - seq150.delta,
      "addon.seqrecent.turbulenceRatio": safeDiv(seq40.stdev, Math.max(0.01, seq150.stdev)) ?? 0,
    }
  }
  throw new Error(`unsupported TP12 no-gap addonId=${addonId}`)
}
