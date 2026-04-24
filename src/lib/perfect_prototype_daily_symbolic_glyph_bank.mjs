import {
  augmentFamilyWithTokenMap,
  buildQuantileBins,
  bucketByBins,
  num,
  uniqueStrings,
} from "./perfect_prototype_daily_symbolic_common.mjs"

const GLYPH_AXES = {
  bodyPct: "candle.bodyPct",
  rangePct: "candle.rangePct",
  valueRatio20: "volume.valueRatio20",
  closeNearHigh20: "level.closeNearHigh20",
  runUp10: "trend.runUp10",
  closeOverMa20: "trend.closeOverMa20",
  closeOverMa120: "trend.closeOverMa120",
  breakoutPauseScore: "shape.breakoutPauseScore",
  failedBreakoutCount20: "shape.failedBreakoutCount20",
  liquidityStress: "volume.liquidityStress",
  upStrength: "sig.sponsor.upStrength",
  releaseQuality: "sig.stateTrans.releaseQuality",
  ignitionOnBase: "sig.phaseDiv.ignitionOnBase",
}

const getValue = (row, featureKey) => num(row?.numericFeatureMap?.[featureKey])

const buildBins = (rows = []) => {
  const out = {}
  for (const [name, featureKey] of Object.entries(GLYPH_AXES)) {
    out[name] = buildQuantileBins((rows ?? []).map((row) => getValue(row, featureKey)).filter(Number.isFinite))
  }
  return out
}

const buildGlyphTokens = ({ row, bins = {} } = {}) => {
  const bodyBucket = bucketByBins(getValue(row, GLYPH_AXES.bodyPct), bins.bodyPct, ["body_lo", "body_mid", "body_hi", "body_xhi"])
  const rangeBucket = bucketByBins(
    getValue(row, GLYPH_AXES.rangePct),
    bins.rangePct,
    ["range_tight", "range_norm", "range_wide", "range_xwide"],
  )
  const valueBucket = bucketByBins(
    getValue(row, GLYPH_AXES.valueRatio20),
    bins.valueRatio20,
    ["value_dry", "value_norm", "value_surge", "value_xsurge"],
  )
  const closeBucket = bucketByBins(
    getValue(row, GLYPH_AXES.closeNearHigh20),
    bins.closeNearHigh20,
    ["close_weak", "close_mid", "close_strong", "close_dom"],
  )
  const trendBucket = bucketByBins(
    getValue(row, GLYPH_AXES.runUp10),
    bins.runUp10,
    ["trend_base", "trend_rise", "trend_push", "trend_ext"],
  )
  const pullbackBucket = bucketByBins(
    getValue(row, GLYPH_AXES.breakoutPauseScore),
    bins.breakoutPauseScore,
    ["pause_none", "pause_soft", "pause_coil", "pause_deep"],
  )
  const failBucket = bucketByBins(
    getValue(row, GLYPH_AXES.failedBreakoutCount20),
    bins.failedBreakoutCount20,
    ["fail_clean", "fail_light", "fail_mid", "fail_heavy"],
  )
  const liqBucket = bucketByBins(
    getValue(row, GLYPH_AXES.liquidityStress),
    bins.liquidityStress,
    ["liq_stable", "liq_mid", "liq_fragile", "liq_xfragile"],
  )
  const sponsorBucket = bucketByBins(
    getValue(row, GLYPH_AXES.upStrength),
    bins.upStrength,
    ["sponsor_weak", "sponsor_mid", "sponsor_strong", "sponsor_dom"],
  )
  const releaseBucket = bucketByBins(
    getValue(row, GLYPH_AXES.releaseQuality),
    bins.releaseQuality,
    ["release_low", "release_mid", "release_good", "release_clean"],
  )
  const ignitionBucket = bucketByBins(
    getValue(row, GLYPH_AXES.ignitionOnBase),
    bins.ignitionOnBase,
    ["ignite_none", "ignite_soft", "ignite_good", "ignite_hot"],
  )
  return uniqueStrings([
    `sig.microCard.dayGlyph.${bodyBucket}`,
    `sig.microCard.dayGlyph.${rangeBucket}`,
    `sig.microCard.dayGlyph.${valueBucket}`,
    `sig.microCard.dayGlyph.${closeBucket}`,
    `sig.microCard.dayGlyph.${trendBucket}`,
    `sig.microCard.dayGlyph.${pullbackBucket}`,
    `sig.microCard.dayGlyph.${failBucket}`,
    `sig.microCard.dayGlyph.${liqBucket}`,
    `sig.sponsorCoupling.pattern.${sponsorBucket}`,
    `sig.auctionControl.pattern.${closeBucket}`,
    `sig.phaseGrammar.transition.${releaseBucket}`,
    `sig.phaseGrammar.transition.${ignitionBucket}`,
    `sig.anchorPath.extrema.${trendBucket}`,
    `sig.anchorPath.extrema.${failBucket}`,
  ])
}

export const buildPerfectPrototypeDailySymbolicGlyphBank = ({ family } = {}) => {
  const bins = buildBins(family?.trainRows ?? [])
  const collections = [
    ...(family?.trainRows ?? []),
    ...(family?.gatedTrainRows ?? []),
    ...(family?.oosRows ?? []),
    ...(family?.supportCaseViews ?? []),
  ]
  const rowTokenMapByKey = new Map()
  for (const row of collections) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    if (!rowKey || rowTokenMapByKey.has(rowKey)) continue
    rowTokenMapByKey.set(rowKey, buildGlyphTokens({ row, bins }))
  }
  const tokenVocabulary = uniqueStrings(Array.from(rowTokenMapByKey.values()).flatMap((tokens) => tokens))
  return augmentFamilyWithTokenMap({
    family: {
      ...family,
      symbolicGlyphBins: bins,
      symbolicGlyphTokenMapByKey: rowTokenMapByKey,
    },
    rowTokenMapByKey,
    summaryPatch: {
      symbolicGlyphReady: rowTokenMapByKey.size > 0,
      symbolicGlyphRowCount: rowTokenMapByKey.size,
      symbolicGlyphTokenCount: tokenVocabulary.length,
    },
  })
}
