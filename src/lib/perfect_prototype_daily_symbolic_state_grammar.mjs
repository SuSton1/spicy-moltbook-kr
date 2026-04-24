import {
  augmentFamilyWithTokenMap,
  mergeRowTokenMaps,
  num,
  uniqueStrings,
} from "./perfect_prototype_daily_symbolic_common.mjs"

const getValue = (row, featureKey) => num(row?.numericFeatureMap?.[featureKey]) ?? 0

const buildStateTokens = (row) => {
  const breakoutPause = getValue(row, "shape.breakoutPauseScore")
  const failedBreakouts = getValue(row, "shape.failedBreakoutCount20")
  const bodyPct = getValue(row, "candle.bodyPct")
  const closeNearHigh = getValue(row, "level.closeNearHigh20")
  const valueRatio = getValue(row, "volume.valueRatio20")
  const closeOverMa20 = getValue(row, "trend.closeOverMa20")
  const closeOverMa120 = getValue(row, "trend.closeOverMa120")
  const runUp10 = getValue(row, "trend.runUp10")
  const sponsorQuality = getValue(row, "sig.sponsor.quality")
  const sponsorFragility = getValue(row, "sig.sponsor.fragility")
  const releaseQuality = getValue(row, "sig.stateTrans.releaseQuality")
  const extensionRisk = getValue(row, "sig.phaseDiv.extensionRisk")

  const tokens = []
  if (breakoutPause >= 0.55 && bodyPct <= 0.35) tokens.push("sig.phaseGrammar.transition.base_to_coil")
  if (releaseQuality >= 0.45 && closeNearHigh >= 0.75 && valueRatio >= 1.1) tokens.push("sig.phaseGrammar.transition.coil_to_release")
  if (releaseQuality >= 0.45 && sponsorQuality >= 0.35) tokens.push("sig.microCard.kgram.release_follow")
  if (failedBreakouts >= 1.5 && closeNearHigh <= 0.55) tokens.push("sig.phaseGrammar.transition.release_failed")
  if (closeOverMa20 >= 0 && closeOverMa120 >= 0 && runUp10 >= 0.08 && sponsorQuality >= sponsorFragility) {
    tokens.push("sig.microCard.kgram.base_hold_push")
  }
  if (closeOverMa20 >= 0.03 && closeNearHigh >= 0.7 && failedBreakouts <= 1) tokens.push("sig.microCard.kgram.pullback_reclaim")
  if (valueRatio >= 1.25 && sponsorQuality >= 0.3) tokens.push("sig.sponsorCoupling.pattern.price_up_value_up")
  if (valueRatio <= 0.9 && breakoutPause >= 0.45) tokens.push("sig.sponsorCoupling.pattern.dryup_before_release")
  if (sponsorFragility >= 0.18 || extensionRisk >= 0.18) tokens.push("sig.sponsorCoupling.pattern.fragile_extension")
  return uniqueStrings(tokens)
}

export const buildPerfectPrototypeDailySymbolicStateGrammar = ({ family } = {}) => {
  const collections = [
    ...(family?.trainRows ?? []),
    ...(family?.gatedTrainRows ?? []),
    ...(family?.oosRows ?? []),
    ...(family?.supportCaseViews ?? []),
  ]
  const additionalTokenMap = new Map()
  for (const row of collections) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    if (!rowKey || additionalTokenMap.has(rowKey)) continue
    additionalTokenMap.set(rowKey, buildStateTokens(row))
  }
  const mergedTokenMap = mergeRowTokenMaps(family?.symbolicGlyphTokenMapByKey ?? new Map(), additionalTokenMap)
  const tokenVocabulary = uniqueStrings(Array.from(mergedTokenMap.values()).flatMap((tokens) => tokens))
  return augmentFamilyWithTokenMap({
    family: {
      ...family,
      symbolicGlyphTokenMapByKey: mergedTokenMap,
      symbolicStateTokenMapByKey: additionalTokenMap,
    },
    rowTokenMapByKey: mergedTokenMap,
    summaryPatch: {
      symbolicStateGrammarReady: additionalTokenMap.size > 0,
      symbolicStateTokenCount: tokenVocabulary.filter((token) => token.startsWith("sig.phaseGrammar.") || token.startsWith("sig.microCard.kgram.") || token.startsWith("sig.sponsorCoupling.")).length,
    },
  })
}
