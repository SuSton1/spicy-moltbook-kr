import {
  toFiniteNumber,
  toText,
} from "./technique_common.mjs"

const DISTANCE_NEAR_THRESHOLD = 0.04

const feature = (featureMap, featureKey, ...fallbackKeys) => {
  for (const key of [featureKey, ...fallbackKeys]) {
    const numeric = toFiniteNumber(featureMap?.[key])
    if (numeric !== null) return numeric
  }
  return null
}

const minFinite = (...values) => {
  const safe = values.map((value) => toFiniteNumber(value)).filter((value) => value !== null)
  if (safe.length < 1) return null
  return safe.reduce((best, value) => Math.min(best, value), Number.POSITIVE_INFINITY)
}

const maxFinite = (...values) => {
  const safe = values.map((value) => toFiniteNumber(value)).filter((value) => value !== null)
  if (safe.length < 1) return null
  return safe.reduce((best, value) => Math.max(best, value), Number.NEGATIVE_INFINITY)
}

const isNearReference = (value, tolerance = DISTANCE_NEAR_THRESHOLD) => {
  const numeric = toFiniteNumber(value)
  return numeric !== null && Math.abs(numeric) <= Math.max(0.0001, Number(tolerance) || DISTANCE_NEAR_THRESHOLD)
}

const deriveRegimeId = (featureMap) => {
  const gapOpenPct = feature(featureMap, "gap.openPct")
  const gapRetention = feature(featureMap, "tech.gapRetention")
  const failedBreakoutCount20 = feature(featureMap, "shape.failedBreakoutCount20")
  const failedBreakBelowMa60 = feature(featureMap, "trend.failedBreakBelowMa60Count10")
  const failedBreakBelowMa120 = feature(featureMap, "trend.failedBreakBelowMa120Count10")
  const failedBreakAboveMa60 = feature(featureMap, "trend.failedBreakAboveMa60Count10")
  const closeRetention = feature(featureMap, "tech.closeRetentionFromPrevClose")
  const breakoutRecency = minFinite(
    feature(featureMap, "tech.daysSinceCrossAboveMa20"),
    feature(featureMap, "tech.daysSinceCrossAboveMa60"),
    feature(featureMap, "tech.daysSinceCrossAboveMa120"),
    feature(featureMap, "tech.anchorRecencyDays"),
  )
  const supportHold = maxFinite(
    feature(featureMap, "tech.supportHoldAtMa60"),
    feature(featureMap, "tech.supportHoldAtMa120"),
  )
  const distanceToMa60 = feature(featureMap, "tech.distanceToMa60")
  const distanceToMa120 = feature(featureMap, "tech.distanceToMa120")

  if (
    maxFinite(failedBreakoutCount20, failedBreakBelowMa60, failedBreakBelowMa120) !== null &&
    maxFinite(failedBreakoutCount20, failedBreakBelowMa60, failedBreakBelowMa120) >= 1.5
  ) {
    return "failure"
  }
  if (gapOpenPct !== null && gapOpenPct > 0.02 && gapRetention !== null && gapRetention >= 0.55) {
    return "gap_hold"
  }
  if (
    breakoutRecency !== null &&
    breakoutRecency <= 10 &&
    ((distanceToMa60 !== null && distanceToMa60 >= 0) || (distanceToMa120 !== null && distanceToMa120 >= 0))
  ) {
    return "breakout"
  }
  if (
    supportHold !== null &&
    supportHold >= 0.55 &&
    (isNearReference(distanceToMa60) || isNearReference(distanceToMa120))
  ) {
    return "retest"
  }
  if (
    failedBreakAboveMa60 !== null &&
    failedBreakAboveMa60 >= 0.5 &&
    closeRetention !== null &&
    closeRetention > 0
  ) {
    return "reclaim"
  }
  return "continuation"
}

const deriveShapeId = (featureMap) => {
  const upperToBody = feature(featureMap, "tech.upperWickToBody")
  const lowerToBody = feature(featureMap, "tech.lowerWickToBody")
  const bodyAbs = Math.abs(feature(featureMap, "candle.bodyPct") ?? 0)
  const closeLocation = feature(featureMap, "tech.closeLocationInRange")

  if (
    upperToBody !== null &&
    upperToBody >= 1.25 &&
    (lowerToBody === null || upperToBody > lowerToBody + 0.35)
  ) {
    return "upper_wick_dominant"
  }
  if (
    lowerToBody !== null &&
    lowerToBody >= 1.25 &&
    (upperToBody === null || lowerToBody > upperToBody + 0.35)
  ) {
    return "lower_wick_dominant"
  }
  if (bodyAbs >= 0.45) return "body_dominant"
  if (closeLocation !== null && closeLocation >= 0.82) return "close_high"
  if (closeLocation !== null && closeLocation <= 0.18) return "close_low"
  return "balanced"
}

const deriveLiquidityId = (featureMap) => {
  const avgTradingValue20 = feature(featureMap, "tech.avgTradingValue20dKrw", "volume.avgTradingValue20dKrw")
  const liquidityStress = feature(featureMap, "volume.liquidityStress")
  const sponsorQuality = feature(featureMap, "sig.sponsor.quality")
  const sponsorFragility = feature(featureMap, "tech.sponsorFragility", "sig.sponsor.fragility")

  if (
    avgTradingValue20 !== null &&
    avgTradingValue20 >= 10000000000 &&
    (liquidityStress === null || liquidityStress <= 0.35) &&
    (sponsorFragility === null || sponsorFragility <= 0.45) &&
    (sponsorQuality === null || sponsorQuality >= 0.5)
  ) {
    return "liquid_strong"
  }
  if (
    (avgTradingValue20 !== null && avgTradingValue20 < 2000000000) ||
    (liquidityStress !== null && liquidityStress >= 0.6) ||
    (sponsorFragility !== null && sponsorFragility >= 0.6)
  ) {
    return "thin_fragile"
  }
  return "mid"
}

const deriveAnchorAgeId = (featureMap) => {
  const anchorAge = minFinite(
    feature(featureMap, "tech.anchorRecencyDays"),
    feature(featureMap, "tech.daysSinceCrossAboveMa20"),
    feature(featureMap, "tech.daysSinceCrossAboveMa60"),
    feature(featureMap, "tech.daysSinceCrossAboveMa120"),
  )
  if (anchorAge === null) return "unknown"
  if (anchorAge <= 3) return "fresh"
  if (anchorAge <= 15) return "mid"
  return "stale"
}

export const buildTechniquePartitionDimensions = ({
  contract,
  featureMap,
  scopeId,
  lookbackCandidateId,
} = {}) => {
  const safeScopeId = toText(scopeId)
  const safeLookbackCandidateId = toText(lookbackCandidateId)
  if (!safeScopeId || !safeLookbackCandidateId) {
    throw new Error("buildTechniquePartitionDimensions requires scopeId and lookbackCandidateId")
  }
  const mode = toText(contract?.partitionMode) || "scope_lookback"
  if (mode === "scope_lookback") {
    return {
      scopeId: safeScopeId,
      lookbackCandidateId: safeLookbackCandidateId,
      regimeId: null,
      shapeId: null,
      liquidityId: null,
      anchorAgeId: null,
    }
  }
  if (mode === "scope_lookback_regime_shape_liquidity") {
    return {
      scopeId: safeScopeId,
      lookbackCandidateId: safeLookbackCandidateId,
      regimeId: deriveRegimeId(featureMap),
      shapeId: deriveShapeId(featureMap),
      liquidityId: deriveLiquidityId(featureMap),
      anchorAgeId: null,
    }
  }
  if (mode !== "scope_lookback_regime_shape_liquidity_anchor_age") {
    throw new Error(`Unsupported technique partition mode=${mode}`)
  }
  return {
    scopeId: safeScopeId,
    lookbackCandidateId: safeLookbackCandidateId,
    regimeId: deriveRegimeId(featureMap),
    shapeId: deriveShapeId(featureMap),
    liquidityId: deriveLiquidityId(featureMap),
    anchorAgeId: deriveAnchorAgeId(featureMap),
  }
}

export const buildTechniquePartitionKey = ({
  contract,
  featureMap,
  scopeId,
  lookbackCandidateId,
} = {}) => {
  const dimensions = buildTechniquePartitionDimensions({
    contract,
    featureMap,
    scopeId,
    lookbackCandidateId,
  })
  if (toText(contract?.partitionMode) === "scope_lookback") {
    return `${dimensions.scopeId}__${dimensions.lookbackCandidateId}`
  }
  if (toText(contract?.partitionMode) === "scope_lookback_regime_shape_liquidity") {
    return [
      dimensions.scopeId,
      dimensions.lookbackCandidateId,
      dimensions.regimeId,
      dimensions.shapeId,
      dimensions.liquidityId,
    ].join("__")
  }
  return [
    dimensions.scopeId,
    dimensions.lookbackCandidateId,
    dimensions.regimeId,
    dimensions.shapeId,
    dimensions.liquidityId,
    dimensions.anchorAgeId,
  ].join("__")
}
