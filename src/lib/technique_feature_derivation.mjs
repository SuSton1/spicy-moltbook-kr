import {
  clamp01,
  extractNumericFeatureMap,
  toFiniteNumber,
} from "./technique_common.mjs"

const safeDiv = (numerator, denominator) => {
  const num = toFiniteNumber(numerator)
  const den = toFiniteNumber(denominator)
  if (num === null || den === null || den === 0) return null
  return num / den
}

const boundedTightnessScore = (value, tolerance) => {
  const numeric = toFiniteNumber(value)
  const safeTolerance = Math.max(0.000001, Number(tolerance) || 0.01)
  if (numeric === null) return null
  return clamp01(1 - Math.abs(numeric) / safeTolerance)
}

const closeFromRow = (row, base) =>
  toFiniteNumber(
    base?.["candle.close"] ??
      row?.close ??
      row?.eventOutcome?.decisionClose ??
      row?.ohlcv?.close ??
      row?.price?.close,
  )

const openFromRow = (row, base) =>
  toFiniteNumber(
    base?.["candle.open"] ??
      row?.open ??
      row?.ohlcv?.open ??
      row?.price?.open,
  )

const highFromRow = (row, base) =>
  toFiniteNumber(
    base?.["candle.high"] ??
      row?.high ??
      row?.ohlcv?.high ??
      row?.price?.high,
  )

const lowFromRow = (row, base) =>
  toFiniteNumber(
    base?.["candle.low"] ??
      row?.low ??
      row?.ohlcv?.low ??
      row?.price?.low,
  )

const prevCloseFromRow = (row, base) =>
  toFiniteNumber(
    base?.prevClose ??
      base?.closeRetBase ??
      row?.prevClose ??
      row?.eventMeta?.prevClose ??
      row?.eventOutcome?.prevClose ??
      row?.price?.prevClose,
  )

const deriveDistanceFromReference = ({ row, base, referenceKey, outKey } = {}) => {
  if (Object.prototype.hasOwnProperty.call(base, outKey)) return
  const reference =
    toFiniteNumber(base?.[referenceKey]) ??
    toFiniteNumber(row?.referenceLevels?.[referenceKey]) ??
    toFiniteNumber(row?.movingAverageMap?.[referenceKey])
  const close = closeFromRow(row, base)
  const ratio = safeDiv(close, reference)
  if (ratio === null) return
  base[outKey] = ratio - 1
}

const getBase = (base, featureKey, fallback = 0) => {
  const numeric = toFiniteNumber(base?.[featureKey])
  return numeric === null ? fallback : numeric
}

export const deriveTechniqueFeatureMap = ({ row, numericFeatureMap = null } = {}) => {
  const base = {
    ...(numericFeatureMap ?? extractNumericFeatureMap(row)),
  }

  if (!Object.prototype.hasOwnProperty.call(base, "shape.breakoutPauseScore")) {
    const sidewaysScore3 = toFiniteNumber(base["shape.sidewaysScore3"])
    const rangePct = toFiniteNumber(base["candle.rangePct"])
    if (sidewaysScore3 !== null && rangePct !== null) {
      base["shape.breakoutPauseScore"] = clamp01((sidewaysScore3 + (boundedTightnessScore(rangePct, 0.08) ?? 0)) / 2)
    }
  }

  if (!Object.prototype.hasOwnProperty.call(base, "score.failedBreakRisk")) {
    const failedBreakAboveMa60Count10 = toFiniteNumber(base["trend.failedBreakAboveMa60Count10"])
    const failedBreakAboveMa120Count10 = toFiniteNumber(base["trend.failedBreakAboveMa120Count10"])
    if (failedBreakAboveMa60Count10 !== null && failedBreakAboveMa120Count10 !== null) {
      base["score.failedBreakRisk"] = clamp01(
        (clamp01(failedBreakAboveMa60Count10 / 3) + clamp01(failedBreakAboveMa120Count10 / 3)) / 2,
      )
    }
  }

  if (!Object.prototype.hasOwnProperty.call(base, "tech.distanceToMa20") && Number.isFinite(base["trend.closeOverMa20"])) {
    base["tech.distanceToMa20"] = Number(base["trend.closeOverMa20"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.distanceToMa60") && Number.isFinite(base["trend.closeOverMa60"])) {
    base["tech.distanceToMa60"] = Number(base["trend.closeOverMa60"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.distanceToMa120") && Number.isFinite(base["trend.closeOverMa120"])) {
    base["tech.distanceToMa120"] = Number(base["trend.closeOverMa120"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.distanceToMa240") && Number.isFinite(base["trend.closeOverMa240"])) {
    base["tech.distanceToMa240"] = Number(base["trend.closeOverMa240"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossAboveMa20") &&
    Number.isFinite(base["trend.daysSinceCrossAboveMa20"])
  ) {
    base["tech.daysSinceCrossAboveMa20"] = Number(base["trend.daysSinceCrossAboveMa20"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossAboveMa60") &&
    Number.isFinite(base["trend.daysSinceCrossAboveMa60"])
  ) {
    base["tech.daysSinceCrossAboveMa60"] = Number(base["trend.daysSinceCrossAboveMa60"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossAboveMa120") &&
    Number.isFinite(base["trend.daysSinceCrossAboveMa120"])
  ) {
    base["tech.daysSinceCrossAboveMa120"] = Number(base["trend.daysSinceCrossAboveMa120"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossAboveMa240") &&
    Number.isFinite(base["trend.daysSinceCrossAboveMa240"])
  ) {
    base["tech.daysSinceCrossAboveMa240"] = Number(base["trend.daysSinceCrossAboveMa240"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossBelowMa20") &&
    Number.isFinite(base["trend.daysSinceCrossBelowMa20"])
  ) {
    base["tech.daysSinceCrossBelowMa20"] = Number(base["trend.daysSinceCrossBelowMa20"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossBelowMa60") &&
    Number.isFinite(base["trend.daysSinceCrossBelowMa60"])
  ) {
    base["tech.daysSinceCrossBelowMa60"] = Number(base["trend.daysSinceCrossBelowMa60"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossBelowMa120") &&
    Number.isFinite(base["trend.daysSinceCrossBelowMa120"])
  ) {
    base["tech.daysSinceCrossBelowMa120"] = Number(base["trend.daysSinceCrossBelowMa120"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.daysSinceCrossBelowMa240") &&
    Number.isFinite(base["trend.daysSinceCrossBelowMa240"])
  ) {
    base["tech.daysSinceCrossBelowMa240"] = Number(base["trend.daysSinceCrossBelowMa240"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.anchorRecencyDays") && Number.isFinite(base["anchor.daysSinceImpulseBar"])) {
    base["tech.anchorRecencyDays"] = Number(base["anchor.daysSinceImpulseBar"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.anchorRunup") && Number.isFinite(base["anchor.maxRunupSinceImpulse"])) {
    base["tech.anchorRunup"] = Number(base["anchor.maxRunupSinceImpulse"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.pullbackDepthFromBreakout") && Number.isFinite(base["gap.fillRatio"])) {
    base["tech.pullbackDepthFromBreakout"] = Number(base["gap.fillRatio"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.gapFillRatio") && Number.isFinite(base["gap.fillRatio"])) {
    base["tech.gapFillRatio"] = Number(base["gap.fillRatio"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.supportHoldAtMa60") && Number.isFinite(base["pattern.supportHoldAtMa60"])) {
    base["tech.supportHoldAtMa60"] = Number(base["pattern.supportHoldAtMa60"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.supportHoldAtMa120") && Number.isFinite(base["pattern.supportHoldAtMa120"])) {
    base["tech.supportHoldAtMa120"] = Number(base["pattern.supportHoldAtMa120"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.openingDrive") && Number.isFinite(base["intraday.d0_first15m_ret"])) {
    base["tech.openingDrive"] = Number(base["intraday.d0_first15m_ret"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.openingImbalance") &&
    Number.isFinite(base["intraday.d0_first5m_ret"]) &&
    Number.isFinite(base["intraday.d0_first30m_low_pct"])
  ) {
    const earlyDrive = Number(base["intraday.d0_first5m_ret"])
    const earlyFlush = Math.max(0, -Number(base["intraday.d0_first30m_low_pct"]))
    base["tech.openingImbalance"] = earlyDrive - earlyFlush
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.openingImbalance") &&
    Number.isFinite(base["intraday.d0_first15m_ret"]) &&
    Number.isFinite(base["intraday.d0_first30m_low_pct"])
  ) {
    const earlyDrive = Number(base["intraday.d0_first15m_ret"])
    const earlyFlush = Math.max(0, -Number(base["intraday.d0_first30m_low_pct"]))
    base["tech.openingImbalance"] = earlyDrive - earlyFlush
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.vwapHold") && Number.isFinite(base["intraday.d0_vwap_hold_ratio"])) {
    base["tech.vwapHold"] = Number(base["intraday.d0_vwap_hold_ratio"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.intradayBreakoutStrength") &&
    Number.isFinite(base["intraday.d0_morning_breakout_strength"])
  ) {
    base["tech.intradayBreakoutStrength"] = Number(base["intraday.d0_morning_breakout_strength"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.closeStrengthAfterBreakout") &&
    Number.isFinite(base["intraday.d0_close_strength_after_breakout"])
  ) {
    base["tech.closeStrengthAfterBreakout"] = Number(base["intraday.d0_close_strength_after_breakout"])
  }

  deriveDistanceFromReference({
    row,
    base,
    referenceKey: "ma60",
    outKey: "tech.distanceToMa60",
  })
  deriveDistanceFromReference({
    row,
    base,
    referenceKey: "ma240",
    outKey: "tech.distanceToMa240",
  })
  deriveDistanceFromReference({
    row,
    base,
    referenceKey: "high252",
    outKey: "tech.distanceTo52wHigh",
  })
  deriveDistanceFromReference({
    row,
    base,
    referenceKey: "high20",
    outKey: "tech.distanceToHigh20",
  })
  deriveDistanceFromReference({
    row,
    base,
    referenceKey: "anchorMid",
    outKey: "tech.anchorMidDistance",
  })

  if (!Object.prototype.hasOwnProperty.call(base, "tech.avgTradingValue20dKrw") && Number.isFinite(base["volume.avgTradingValue20dKrw"])) {
    base["tech.avgTradingValue20dKrw"] = Number(base["volume.avgTradingValue20dKrw"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.compression20") && Number.isFinite(base["shape.compression20"])) {
    base["tech.compression20"] = Number(base["shape.compression20"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.sidewaysScore3") && Number.isFinite(base["shape.sidewaysScore3"])) {
    base["tech.sidewaysScore3"] = Number(base["shape.sidewaysScore3"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.breakoutPauseScore") && Number.isFinite(base["shape.breakoutPauseScore"])) {
    base["tech.breakoutPauseScore"] = Number(base["shape.breakoutPauseScore"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.higherLowCount") && Number.isFinite(base["shape.higherLowCount"])) {
    base["tech.higherLowCount"] = Number(base["shape.higherLowCount"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.closeNearLow20") && Number.isFinite(base["level.closeNearLow20"])) {
    base["tech.closeNearLow20"] = Number(base["level.closeNearLow20"])
  }

  const open = openFromRow(row, base)
  const high = highFromRow(row, base)
  const low = lowFromRow(row, base)
  const close = closeFromRow(row, base)
  const prevClose = prevCloseFromRow(row, base)
  const range = Number.isFinite(high) && Number.isFinite(low) ? high - low : null
  const signedBody = Number.isFinite(close) && Number.isFinite(open) ? close - open : null
  if (!Object.prototype.hasOwnProperty.call(base, "tech.bodySignedPct") && Number.isFinite(signedBody) && Number.isFinite(range) && range !== 0) {
    base["tech.bodySignedPct"] = signedBody / range
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.upperWickPct") && Number.isFinite(base["candle.upperWickPct"])) {
    base["tech.upperWickPct"] = Number(base["candle.upperWickPct"])
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.lowerWickPct") && Number.isFinite(base["candle.lowerWickPct"])) {
    base["tech.lowerWickPct"] = Number(base["candle.lowerWickPct"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.lowerWickPct") &&
    Number.isFinite(base["candle.upperWickPct"]) &&
    Number.isFinite(base["candle.bodyPct"])
  ) {
    base["tech.lowerWickPct"] = Math.max(0, 1 - Number(base["candle.upperWickPct"]) - Number(base["candle.bodyPct"]))
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.closeLocationInRange") &&
    Number.isFinite(close) &&
    Number.isFinite(low) &&
    Number.isFinite(range) &&
    range > 0
  ) {
    base["tech.closeLocationInRange"] = clamp01((close - low) / range)
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.wickSkew") &&
    Number.isFinite(base["tech.upperWickPct"]) &&
    Number.isFinite(base["tech.lowerWickPct"])
  ) {
    base["tech.wickSkew"] = Number(base["tech.lowerWickPct"]) - Number(base["tech.upperWickPct"])
  }
  const safeBodyAbs = Math.max(Math.abs(Number(base["candle.bodyPct"] ?? 0)), 0.0001)
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.upperWickToBody") &&
    Number.isFinite(base["tech.upperWickPct"])
  ) {
    base["tech.upperWickToBody"] = Number(base["tech.upperWickPct"]) / safeBodyAbs
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.lowerWickToBody") &&
    Number.isFinite(base["tech.lowerWickPct"])
  ) {
    base["tech.lowerWickToBody"] = Number(base["tech.lowerWickPct"]) / safeBodyAbs
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.closeRetentionFromPrevClose") &&
    Number.isFinite(base["closeRetPct"])
  ) {
    base["tech.closeRetentionFromPrevClose"] = Number(base["closeRetPct"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.closeRetentionFromPrevClose") &&
    Number.isFinite(close) &&
    Number.isFinite(prevClose) &&
    prevClose !== 0
  ) {
    base["tech.closeRetentionFromPrevClose"] = close / prevClose - 1
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.ma20Ma60Spread") &&
    Number.isFinite(base["tech.distanceToMa20"]) &&
    Number.isFinite(base["tech.distanceToMa60"])
  ) {
    base["tech.ma20Ma60Spread"] = Number(base["tech.distanceToMa60"]) - Number(base["tech.distanceToMa20"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.ma60Ma120Spread") &&
    Number.isFinite(base["tech.distanceToMa60"]) &&
    Number.isFinite(base["tech.distanceToMa120"])
  ) {
    base["tech.ma60Ma120Spread"] = Number(base["tech.distanceToMa120"]) - Number(base["tech.distanceToMa60"])
  }
  if (
    !Object.prototype.hasOwnProperty.call(base, "tech.gapRetention") &&
    Number.isFinite(base["tech.gapFillRatio"])
  ) {
    base["tech.gapRetention"] = clamp01(1 - Number(base["tech.gapFillRatio"]))
  }
  if (!Object.prototype.hasOwnProperty.call(base, "tech.sponsorFragility") && Number.isFinite(base["sig.sponsor.fragility"])) {
    base["tech.sponsorFragility"] = Number(base["sig.sponsor.fragility"])
  }

  if (!Object.prototype.hasOwnProperty.call(base, "sig.sponsor.quality")) {
    const bodyPct = getBase(base, "candle.bodyPct")
    const rangePct = getBase(base, "candle.rangePct")
    const valueRatio20 = getBase(base, "volume.valueRatio20")
    const closeNearHigh20 = getBase(base, "level.closeNearHigh20")
    const breakoutPauseScore = getBase(base, "shape.breakoutPauseScore")
    const failedBreakoutCount20 = getBase(base, "shape.failedBreakoutCount20")
    const closeOverMa20 = getBase(base, "trend.closeOverMa20")
    const closeOverMa120 = getBase(base, "trend.closeOverMa120")
    const runUp10 = getBase(base, "trend.runUp10")
    const liquidityStress = getBase(base, "volume.liquidityStress")
    const globalValueRatio20Over150 = getBase(base, "global.valueRatio20Over150")
    const avgTradingValue20dKrw = getBase(base, "volume.avgTradingValue20dKrw")

    const pathEfficiencyProxy =
      Math.abs(runUp10) / Math.max(0.05, Math.abs(closeOverMa20) + Math.abs(closeOverMa120) + Math.abs(bodyPct))
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

    base["sig.pathGeom.efficiencyProxy"] = pathEfficiencyProxy
    base["sig.pathGeom.recoveryBias"] = pathRecoveryBias
    base["sig.pathGeom.convexityProxy"] = pathConvexityProxy
    base["sig.sponsor.upStrength"] = sponsorUpStrength
    base["sig.sponsor.quality"] = sponsorQuality
    base["sig.sponsor.fragility"] = sponsorFragility
    base["sig.stateTrans.releaseQuality"] = stateReleaseQuality
    base["sig.stateTrans.failPressure"] = stateFailPressure
    base["sig.stateTrans.compressionBias"] = stateCompressionBias
    base["sig.phaseDiv.ignitionOnBase"] = phaseIgnitionOnBase
    base["sig.phaseDiv.extensionRisk"] = phaseExtensionRisk
    base["sig.phaseDiv.mediumBaseBias"] = phaseMediumBaseBias
    base["sig.liqPath.stability"] = liqStability
    base["sig.liqPath.fragility"] = liqFragility
    base["sig.liqPath.sponsorshipCarry"] = liqSponsorshipCarry
  }

  return base
}
