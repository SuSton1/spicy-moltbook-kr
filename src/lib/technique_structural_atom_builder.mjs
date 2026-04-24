import { deriveTechniqueFeatureMap } from "./technique_feature_derivation.mjs"
import {
  buildTechniquePartitionDimensions,
  buildTechniquePartitionKey,
} from "./technique_partition_key_builder.mjs"
import {
  ensureDateKey,
  extractNumericFeatureMap,
  toFiniteNumber,
  toText,
  uniqueSortedStrings,
  yearKeyFromDateKey,
} from "./technique_common.mjs"

export const TECHNIQUE_STRUCTURAL_ATOM_ROW_KIND = "technique_structural_atom_row_v2"

const DISTANCE_LABELS = ["deep_below", "below", "near", "above", "extended"]
const DAYS_SINCE_CROSS_LABELS = ["very_recent", "recent", "mature", "stale"]
const BODY_LABELS = ["tiny", "small", "large", "expansion"]
const BODY_SIGNED_LABELS = ["strong_down", "down", "neutral", "up", "strong_up"]
const WICK_LABELS = ["low", "mid", "high", "extreme"]
const WICK_TO_BODY_LABELS = ["compressed", "balanced", "extended", "dominant"]
const WICK_SKEW_LABELS = ["upper_dominant", "upper_tilt", "balanced", "lower_tilt", "lower_dominant"]
const CLOSE_LOCATION_LABELS = ["low", "mid_low", "mid_high", "high"]
const PREV_CLOSE_RETENTION_LABELS = ["flush", "weak", "flat", "firm", "surge"]
const GAP_OPEN_LABELS = ["down_large", "down_small", "flat", "up_small", "up_large"]
const GAP_FILL_LABELS = ["low", "mid", "high", "full"]
const GAP_RETENTION_LABELS = ["weak", "mixed", "firm", "locked"]
const VALUE_RATIO_LABELS = ["low", "base", "high", "surge"]
const ABS_VALUE_LABELS = ["micro", "base", "liquid", "broad"]
const LIQUIDITY_STRESS_LABELS = ["low", "mid", "high", "extreme"]
const FAILED_BREAKOUT_LABELS = ["none", "light", "repeat", "crowded"]
const SPONSOR_QUALITY_LABELS = ["low", "mid", "high", "elite"]
const SUPPORT_HOLD_LABELS = ["weak", "mixed", "firm", "locked"]
const MA_SPREAD_LABELS = ["bearish", "flat_bear", "flat_bull", "bullish"]
const TREND_SLOPE_LABELS = ["down", "flat_down", "flat_up", "up"]
const DISTANCE_TO_52W_LABELS = ["far", "below", "near", "above", "extended"]
const PULLBACK_DEPTH_LABELS = ["shallow", "medium", "deep", "failure"]
const SCORE_LABELS = ["low", "mid", "high", "elite"]
const OPENING_IMBALANCE_LABELS = ["weak", "balanced", "positive", "strong"]
const INTRADAY_BREAKOUT_LABELS = ["low", "mid", "high", "elite"]
const VWAP_HOLD_LABELS = ["weak", "mixed", "firm", "locked"]

const feature = (featureMap, featureKey, ...fallbackKeys) => {
  for (const key of [featureKey, ...fallbackKeys]) {
    const numeric = toFiniteNumber(featureMap?.[key])
    if (numeric !== null) return numeric
  }
  return null
}

const extractScopeId = ({ row, defaultScopeId = null } = {}) => {
  const scopeId = toText(row?.scopeId ?? row?.candidateScopeId ?? defaultScopeId)
  if (!scopeId) throw new Error("Technique structural atoms require scopeId or --default-scope-id")
  return scopeId
}

const extractLookbackCandidateId = ({ row, defaultLookbackCandidateId = null } = {}) => {
  const candidateId = toText(row?.lookbackCandidateId ?? row?.candidateId ?? defaultLookbackCandidateId)
  if (!candidateId) {
    throw new Error("Technique structural atoms require lookbackCandidateId or --default-lookback-candidate-id")
  }
  return candidateId
}

const extractSymbol = (row) => {
  const symbol = toText(row?.symbol)
  if (!symbol) throw new Error("Technique structural atoms require symbol")
  return symbol
}

export const extractTechniquePatternLabelHit = ({ row, labelId } = {}) => {
  const direct =
    row?.labelMap?.[labelId] ??
    row?.labels?.[labelId] ??
    row?.metricsByLabel?.[labelId]?.hitTarget ??
    row?.[labelId]
  if (typeof direct === "boolean") return direct
  if (Number.isFinite(Number(direct))) return Number(direct) > 0
  if (labelId === "tp12_no_stop_hit_3d" && typeof row?.eventOutcome?.hitTarget === "boolean") {
    return row.eventOutcome.hitTarget
  }
  return false
}

const resolveBucketLabel = (value, edges, labels) => {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  for (let index = 0; index < edges.length; index += 1) {
    if (numeric < edges[index]) return labels[index]
  }
  return labels[labels.length - 1]
}

const createAtomAccumulator = (contract) => {
  const atomSet = new Set()
  const baseFeatureToAtomId = new Map()
  const atomMetadataById = {}
  const atomGroups = {
    context: [],
    movingAverage: [],
    candles: [],
    closeLocation: [],
    gap: [],
    liquidity: [],
    trend: [],
    failure: [],
    intraday: [],
  }
  const add = (familyId, baseFeatureId, atomId) => {
    const safeAtomId = toText(atomId)
    const safeBaseFeatureId = toText(baseFeatureId)
    if (!safeAtomId) return null
    if (contract.oneAtomPerBaseFeature === true && safeBaseFeatureId && baseFeatureToAtomId.has(safeBaseFeatureId)) {
      return baseFeatureToAtomId.get(safeBaseFeatureId)
    }
    if (atomSet.has(safeAtomId)) return safeAtomId
    atomSet.add(safeAtomId)
    if (safeBaseFeatureId) baseFeatureToAtomId.set(safeBaseFeatureId, safeAtomId)
    atomMetadataById[safeAtomId] = {
      familyId,
      baseFeatureId: safeBaseFeatureId || safeAtomId,
    }
    atomGroups[familyId].push(safeAtomId)
    return safeAtomId
  }
  return {
    add,
    atomGroups,
    atomMetadataById,
    atomIds: () => uniqueSortedStrings(Array.from(atomSet)),
    baseFeatureIds: () => uniqueSortedStrings(Array.from(baseFeatureToAtomId.keys())),
  }
}

const addBinnedAtom = ({ accumulator, familyId, prefix, baseFeatureId, value, edges, labels } = {}) => {
  const label = resolveBucketLabel(value, edges, labels)
  if (!label) return null
  return accumulator.add(familyId, baseFeatureId || prefix, `${prefix}:${label}`)
}

const addSignedMaStateAtom = ({ accumulator, contract, ma, distance, daysAbove, daysBelow } = {}) => {
  const nearBand = Math.max(0.0001, Math.abs(Number(contract?.atomBinning?.distanceToMa?.[2] ?? 0.03)))
  let label = null
  if (distance !== null && Math.abs(distance) <= nearBand) {
    label = "near"
  } else if (daysAbove !== null) {
    const [veryRecentEdge = 3, recentEdge = 10, matureEdge = 20] = contract?.atomBinning?.daysSinceCross ?? []
    if (daysAbove <= veryRecentEdge) label = "above_very_recent"
    else if (daysAbove <= recentEdge) label = "above_recent"
    else if (daysAbove <= matureEdge) label = "above_mature"
    else label = "above_stale"
  } else if (daysBelow !== null) {
    const [veryRecentEdge = 3, recentEdge = 10, matureEdge = 20] = contract?.atomBinning?.daysSinceCross ?? []
    if (daysBelow <= veryRecentEdge) label = "below_very_recent"
    else if (daysBelow <= recentEdge) label = "below_recent"
    else if (daysBelow <= matureEdge) label = "below_mature"
    else label = "below_stale"
  } else if (distance !== null) {
    label = distance > 0 ? "above_unknown" : "below_unknown"
  }
  if (!label) return null
  return accumulator.add("movingAverage", `ma_state${ma}`, `ma_state${ma}:${label}`)
}

const addMovingAverageAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const supportHoldAtMa60 = feature(featureMap, "tech.supportHoldAtMa60", "pattern.supportHoldAtMa60")
  const supportHoldAtMa120 = feature(featureMap, "tech.supportHoldAtMa120", "pattern.supportHoldAtMa120")
  for (const ma of [20, 60, 120, 240]) {
    const distance = feature(featureMap, `tech.distanceToMa${ma}`)
    const daysAbove = feature(featureMap, `tech.daysSinceCrossAboveMa${ma}`)
    const daysBelow = feature(featureMap, `tech.daysSinceCrossBelowMa${ma}`)
    addBinnedAtom({
      accumulator,
      familyId: "movingAverage",
      prefix: `dist_ma${ma}`,
      baseFeatureId: `tech.distanceToMa${ma}`,
      value: distance,
      edges: contract.atomBinning.distanceToMa,
      labels: DISTANCE_LABELS,
    })
    if (contract.useSignedCrossStateAtoms === true) {
      addSignedMaStateAtom({
        accumulator,
        contract,
        ma,
        distance,
        daysAbove,
        daysBelow,
      })
    } else {
      addBinnedAtom({
        accumulator,
        familyId: "movingAverage",
        prefix: `days_cross_above_ma${ma}`,
        baseFeatureId: `tech.daysSinceCrossAboveMa${ma}`,
        value: daysAbove,
        edges: contract.atomBinning.daysSinceCross,
        labels: DAYS_SINCE_CROSS_LABELS,
      })
      addBinnedAtom({
        accumulator,
        familyId: "movingAverage",
        prefix: `days_cross_below_ma${ma}`,
        baseFeatureId: `tech.daysSinceCrossBelowMa${ma}`,
        value: daysBelow,
        edges: contract.atomBinning.daysSinceCross,
        labels: DAYS_SINCE_CROSS_LABELS,
      })
    }
    if (contract.enableAliasAtoms !== false && distance !== null && distance >= 0 && daysAbove !== null && daysAbove <= 20) {
      accumulator.add("movingAverage", `anchor.ma${ma}.break`, `anchor_ma${ma}_break`)
    }
    if (contract.enableAliasAtoms !== false && distance !== null && distance >= 0 && daysBelow !== null && daysBelow <= 10) {
      accumulator.add("movingAverage", `reclaim.ma${ma}`, `reclaim_ma${ma}`)
    }
    if (contract.enableAliasAtoms !== false && distance !== null && distance >= -0.03 && distance <= 0.04) {
      accumulator.add("movingAverage", `retest.ma${ma}`, `retest_ma${ma}_zone`)
    }
  }
  addBinnedAtom({
    accumulator,
    familyId: "movingAverage",
    prefix: "support_hold_ma60",
    baseFeatureId: "pattern.supportHoldAtMa60",
    value: supportHoldAtMa60,
    edges: contract.atomBinning.supportHold,
    labels: SUPPORT_HOLD_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "movingAverage",
    prefix: "support_hold_ma120",
    baseFeatureId: "pattern.supportHoldAtMa120",
    value: supportHoldAtMa120,
    edges: contract.atomBinning.supportHold,
    labels: SUPPORT_HOLD_LABELS,
  })
}

const addCandleAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const bodyPct = feature(featureMap, "candle.bodyPct")
  const bodyAbs = bodyPct === null ? null : Math.abs(bodyPct)
  const bodySigned = feature(featureMap, "tech.bodySignedPct")
  const upperWickPct = feature(featureMap, "tech.upperWickPct", "candle.upperWickPct")
  const lowerWickPct = feature(featureMap, "tech.lowerWickPct", "candle.lowerWickPct")
  const wickSkew = feature(featureMap, "tech.wickSkew")
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "body_abs",
    baseFeatureId: "candle.bodyPct",
    value: bodyAbs,
    edges: contract.atomBinning.bodyPct,
    labels: BODY_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "body_signed",
    baseFeatureId: "tech.bodySignedPct",
    value: bodySigned,
    edges: contract.atomBinning.bodySignedPct,
    labels: BODY_SIGNED_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "upper_wick",
    baseFeatureId: "tech.upperWickPct",
    value: upperWickPct,
    edges: contract.atomBinning.upperWickPct,
    labels: WICK_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "lower_wick",
    baseFeatureId: "tech.lowerWickPct",
    value: lowerWickPct,
    edges: contract.atomBinning.lowerWickPct,
    labels: WICK_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "upper_to_body",
    baseFeatureId: "tech.upperWickToBody",
    value: feature(featureMap, "tech.upperWickToBody"),
    edges: contract.atomBinning.wickToBodyRatio,
    labels: WICK_TO_BODY_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "lower_to_body",
    baseFeatureId: "tech.lowerWickToBody",
    value: feature(featureMap, "tech.lowerWickToBody"),
    edges: contract.atomBinning.wickToBodyRatio,
    labels: WICK_TO_BODY_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "candles",
    prefix: "wick_skew",
    baseFeatureId: "tech.wickSkew",
    value: wickSkew,
    edges: contract.atomBinning.wickSkew,
    labels: WICK_SKEW_LABELS,
  })
}

const addCloseLocationAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const closeInRange = feature(featureMap, "tech.closeLocationInRange")
  const closeNearHigh = feature(featureMap, "level.closeNearHigh20", "tech.closeNearHigh20")
  const closeNearLow = feature(featureMap, "level.closeNearLow20", "tech.closeNearLow20")
  const prevCloseRetention = feature(featureMap, "tech.closeRetentionFromPrevClose", "closeRetPct")
  addBinnedAtom({
    accumulator,
    familyId: "closeLocation",
    prefix: "close_loc",
    baseFeatureId: "tech.closeLocationInRange",
    value: closeInRange,
    edges: contract.atomBinning.closeNearHigh,
    labels: CLOSE_LOCATION_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "closeLocation",
    prefix: "close_near_high20",
    baseFeatureId: "level.closeNearHigh20",
    value: closeNearHigh,
    edges: contract.atomBinning.closeNearHigh,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "closeLocation",
    prefix: "close_near_low20",
    baseFeatureId: "level.closeNearLow20",
    value: closeNearLow,
    edges: contract.atomBinning.closeNearLow,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "closeLocation",
    prefix: "prev_close_retention",
    baseFeatureId: "tech.closeRetentionFromPrevClose",
    value: prevCloseRetention,
    edges: contract.atomBinning.prevCloseRetention,
    labels: PREV_CLOSE_RETENTION_LABELS,
  })
}

const addGapAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const gapOpenPct = feature(featureMap, "gap.openPct")
  const gapFillRatio = feature(featureMap, "tech.gapFillRatio", "gap.fillRatio")
  const gapRetention = feature(featureMap, "tech.gapRetention")
  addBinnedAtom({
    accumulator,
    familyId: "gap",
    prefix: "gap_open",
    baseFeatureId: "gap.openPct",
    value: gapOpenPct,
    edges: contract.atomBinning.gapOpenPct,
    labels: GAP_OPEN_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "gap",
    prefix: "gap_fill",
    baseFeatureId: "tech.gapFillRatio",
    value: gapFillRatio,
    edges: contract.atomBinning.gapFillRatio,
    labels: GAP_FILL_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "gap",
    prefix: "gap_retention",
    baseFeatureId: "tech.gapRetention",
    value: gapRetention,
    edges: contract.atomBinning.gapRetention,
    labels: GAP_RETENTION_LABELS,
  })
  if (contract.enableAliasAtoms !== false && gapOpenPct !== null && gapOpenPct > 0 && gapRetention !== null && gapRetention >= 0.55) {
    accumulator.add("gap", "tech.gapRetention", "gap_hold")
  }
  if (contract.enableAliasAtoms !== false && gapOpenPct !== null && gapOpenPct > 0 && gapFillRatio !== null && gapFillRatio >= 0.75) {
    accumulator.add("gap", "tech.gapFillRatio", "gap_fail")
  }
}

const addLiquidityAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const valueRatio20 = feature(featureMap, "volume.valueRatio20")
  const avgTradingValue20dKrw = feature(featureMap, "tech.avgTradingValue20dKrw", "volume.avgTradingValue20dKrw")
  const liquidityStress = feature(featureMap, "volume.liquidityStress")
  const sponsorQuality = feature(featureMap, "sig.sponsor.quality")
  const sponsorFragility = feature(featureMap, "tech.sponsorFragility", "sig.sponsor.fragility")
  addBinnedAtom({
    accumulator,
    familyId: "liquidity",
    prefix: "value_ratio20",
    baseFeatureId: "volume.valueRatio20",
    value: valueRatio20,
    edges: contract.atomBinning.valueRatio20,
    labels: VALUE_RATIO_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "liquidity",
    prefix: "avg_value20",
    baseFeatureId: "volume.avgTradingValue20dKrw",
    value: avgTradingValue20dKrw,
    edges: contract.atomBinning.avgTradingValue20dKrw,
    labels: ABS_VALUE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "liquidity",
    prefix: "liquidity_stress",
    baseFeatureId: "volume.liquidityStress",
    value: liquidityStress,
    edges: contract.atomBinning.liquidityStress,
    labels: LIQUIDITY_STRESS_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "liquidity",
    prefix: "sponsor_quality",
    baseFeatureId: "sig.sponsor.quality",
    value: sponsorQuality,
    edges: contract.atomBinning.sponsorQuality,
    labels: SPONSOR_QUALITY_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "liquidity",
    prefix: "sponsor_fragility",
    baseFeatureId: "sig.sponsor.fragility",
    value: sponsorFragility,
    edges: contract.atomBinning.sponsorFragility,
    labels: WICK_LABELS,
  })
}

const addTrendAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const distanceTo52wHigh = feature(featureMap, "tech.distanceTo52wHigh")
  const distanceToHigh20 = feature(featureMap, "tech.distanceToHigh20", "level.distanceToHigh20")
  const pullbackDepth = feature(featureMap, "tech.pullbackDepthFromBreakout")
  const anchorMidDistance = feature(featureMap, "tech.anchorMidDistance")
  const slope10 = feature(featureMap, "trend.slope10")
  const slope20 = feature(featureMap, "trend.slope20")
  const compression20 = feature(featureMap, "tech.compression20", "shape.compression20")
  const sidewaysScore3 = feature(featureMap, "tech.sidewaysScore3", "shape.sidewaysScore3")
  const breakoutPauseScore = feature(featureMap, "tech.breakoutPauseScore", "shape.breakoutPauseScore")
  const anchorRecencyDays = feature(featureMap, "tech.anchorRecencyDays")
  const higherLowCount = feature(featureMap, "tech.higherLowCount", "shape.higherLowCount")
  const ma20Ma60Spread = feature(featureMap, "tech.ma20Ma60Spread")
  const ma60Ma120Spread = feature(featureMap, "tech.ma60Ma120Spread")
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "distance_to_52w_high",
    baseFeatureId: "tech.distanceTo52wHigh",
    value: distanceTo52wHigh,
    edges: contract.atomBinning.distanceTo52wHigh,
    labels: DISTANCE_TO_52W_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "distance_to_high20",
    baseFeatureId: "tech.distanceToHigh20",
    value: distanceToHigh20,
    edges: contract.atomBinning.distanceToHigh20,
    labels: DISTANCE_TO_52W_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "pullback_depth",
    baseFeatureId: "tech.pullbackDepthFromBreakout",
    value: pullbackDepth,
    edges: contract.atomBinning.pullbackDepth,
    labels: PULLBACK_DEPTH_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "anchor_mid_dist",
    baseFeatureId: "tech.anchorMidDistance",
    value: anchorMidDistance,
    edges: contract.atomBinning.anchorMidDistance,
    labels: DISTANCE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "slope10",
    baseFeatureId: "trend.slope10",
    value: slope10,
    edges: contract.atomBinning.trendSlope,
    labels: TREND_SLOPE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "slope20",
    baseFeatureId: "trend.slope20",
    value: slope20,
    edges: contract.atomBinning.trendSlope,
    labels: TREND_SLOPE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "compression20",
    baseFeatureId: "shape.compression20",
    value: compression20,
    edges: contract.atomBinning.compression20,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "sideways3",
    baseFeatureId: "shape.sidewaysScore3",
    value: sidewaysScore3,
    edges: contract.atomBinning.sidewaysScore3,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "breakout_pause",
    baseFeatureId: "shape.breakoutPauseScore",
    value: breakoutPauseScore,
    edges: contract.atomBinning.breakoutPauseScore,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "anchor_recency",
    baseFeatureId: "tech.anchorRecencyDays",
    value: anchorRecencyDays,
    edges: contract.atomBinning.anchorRecencyDays,
    labels: DAYS_SINCE_CROSS_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "higher_low_count",
    baseFeatureId: "shape.higherLowCount",
    value: higherLowCount,
    edges: contract.atomBinning.higherLowCount,
    labels: SCORE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "ma20_ma60_spread",
    baseFeatureId: "tech.ma20Ma60Spread",
    value: ma20Ma60Spread,
    edges: contract.atomBinning.maSpread,
    labels: MA_SPREAD_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "trend",
    prefix: "ma60_ma120_spread",
    baseFeatureId: "tech.ma60Ma120Spread",
    value: ma60Ma120Spread,
    edges: contract.atomBinning.maSpread,
    labels: MA_SPREAD_LABELS,
  })
  if (contract.enableAliasAtoms !== false && distanceTo52wHigh !== null && distanceTo52wHigh >= -0.05) accumulator.add("trend", "tech.distanceTo52wHigh", "near_52w_high")
  if (contract.enableAliasAtoms !== false && pullbackDepth !== null && pullbackDepth <= 0.3) accumulator.add("trend", "tech.pullbackDepthFromBreakout", "pullback_shallow")
  if (contract.enableAliasAtoms !== false && pullbackDepth !== null && pullbackDepth >= 0.75) accumulator.add("trend", "tech.pullbackDepthFromBreakout", "pullback_deep")
  if (contract.enableAliasAtoms !== false && slope20 !== null && slope20 > 0.02) accumulator.add("trend", "trend.slope20", "trend_up")
  if (contract.enableAliasAtoms !== false && slope20 !== null && slope20 < 0) accumulator.add("trend", "trend.slope20", "trend_down")
}

const addFailureAtoms = ({ accumulator, featureMap, contract } = {}) => {
  const failedBreakoutCount20 = feature(featureMap, "shape.failedBreakoutCount20")
  const failedBreakAboveMa60 = feature(featureMap, "trend.failedBreakAboveMa60Count10")
  const failedBreakBelowMa60 = feature(featureMap, "trend.failedBreakBelowMa60Count10")
  const failedBreakAboveMa120 = feature(featureMap, "trend.failedBreakAboveMa120Count10")
  const failedBreakBelowMa120 = feature(featureMap, "trend.failedBreakBelowMa120Count10")
  addBinnedAtom({
    accumulator,
    familyId: "failure",
    prefix: "failed_breakout20",
    baseFeatureId: "shape.failedBreakoutCount20",
    value: failedBreakoutCount20,
    edges: contract.atomBinning.failedBreakoutCount20,
    labels: FAILED_BREAKOUT_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "failure",
    prefix: "failed_break_above_ma60",
    baseFeatureId: "trend.failedBreakAboveMa60Count10",
    value: failedBreakAboveMa60,
    edges: contract.atomBinning.failedBreakoutCount20,
    labels: FAILED_BREAKOUT_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "failure",
    prefix: "failed_break_below_ma60",
    baseFeatureId: "trend.failedBreakBelowMa60Count10",
    value: failedBreakBelowMa60,
    edges: contract.atomBinning.failedBreakoutCount20,
    labels: FAILED_BREAKOUT_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "failure",
    prefix: "failed_break_above_ma120",
    baseFeatureId: "trend.failedBreakAboveMa120Count10",
    value: failedBreakAboveMa120,
    edges: contract.atomBinning.failedBreakoutCount20,
    labels: FAILED_BREAKOUT_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "failure",
    prefix: "failed_break_below_ma120",
    baseFeatureId: "trend.failedBreakBelowMa120Count10",
    value: failedBreakBelowMa120,
    edges: contract.atomBinning.failedBreakoutCount20,
    labels: FAILED_BREAKOUT_LABELS,
  })
}

const addIntradayAtoms = ({ accumulator, featureMap, contract } = {}) => {
  if (!contract.includeIntradayAtoms) return
  const openingImbalance = feature(featureMap, "tech.openingImbalance")
  const intradayBreakoutStrength = feature(featureMap, "tech.intradayBreakoutStrength")
  const vwapHold = feature(featureMap, "tech.vwapHold")
  addBinnedAtom({
    accumulator,
    familyId: "intraday",
    prefix: "opening_imbalance",
    baseFeatureId: "tech.openingImbalance",
    value: openingImbalance,
    edges: contract.atomBinning.openingImbalance,
    labels: OPENING_IMBALANCE_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "intraday",
    prefix: "intraday_breakout_strength",
    baseFeatureId: "tech.intradayBreakoutStrength",
    value: intradayBreakoutStrength,
    edges: contract.atomBinning.intradayBreakoutStrength,
    labels: INTRADAY_BREAKOUT_LABELS,
  })
  addBinnedAtom({
    accumulator,
    familyId: "intraday",
    prefix: "vwap_hold",
    baseFeatureId: "tech.vwapHold",
    value: vwapHold,
    edges: contract.atomBinning.vwapHold,
    labels: VWAP_HOLD_LABELS,
  })
}

export const buildTechniqueStructuralAtomsForRow = ({
  row,
  contract,
  labelId = null,
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("buildTechniqueStructuralAtomsForRow requires contract")
  }
  const symbol = extractSymbol(row)
  const decisionDateKey = ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
  const scopeId = extractScopeId({ row, defaultScopeId })
  const lookbackCandidateId = extractLookbackCandidateId({ row, defaultLookbackCandidateId })
  const featureMap = deriveTechniqueFeatureMap({ row, numericFeatureMap: extractNumericFeatureMap(row) })
  const partitionDimensions = buildTechniquePartitionDimensions({
    contract,
    featureMap,
    scopeId,
    lookbackCandidateId,
  })
  const partitionKey = buildTechniquePartitionKey({
    contract,
    featureMap,
    scopeId,
    lookbackCandidateId,
  })
  const accumulator = createAtomAccumulator(contract)

  if (contract.includeScopeAtoms && contract.embedScopeAtomsInPattern) {
    accumulator.add("context", "scopeId", `scope:${scopeId}`)
  }
  if (contract.includeLookbackAtoms && contract.embedLookbackAtomsInPattern) {
    accumulator.add("context", "lookbackCandidateId", `lookback:${lookbackCandidateId}`)
  }

  if (contract.atomFamilies.movingAverage) addMovingAverageAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.candles) addCandleAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.closeLocation) addCloseLocationAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.gap) addGapAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.liquidity) addLiquidityAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.trend) addTrendAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.failure) addFailureAtoms({ accumulator, featureMap, contract })
  if (contract.atomFamilies.intraday) addIntradayAtoms({ accumulator, featureMap, contract })

  const atomIds = accumulator.atomIds()
  return {
    kind: TECHNIQUE_STRUCTURAL_ATOM_ROW_KIND,
    contractId: contract.contractId,
    labelId: toText(labelId) || contract.labelId,
    sourceRowId: toText(row?.rowId) || `${decisionDateKey}::${symbol}::${scopeId}::${lookbackCandidateId}`,
    decisionDateKey,
    yearKey: yearKeyFromDateKey(decisionDateKey),
    symbol,
    scopeId,
    lookbackCandidateId,
    partitionKey,
    partitionDimensions,
    hitTarget: extractTechniquePatternLabelHit({ row, labelId: toText(labelId) || contract.labelId }),
    atomIds,
    atomCount: atomIds.length,
    atomGroups: accumulator.atomGroups,
    atomMetadataById: accumulator.atomMetadataById,
    baseFeatureIds: accumulator.baseFeatureIds(),
  }
}
