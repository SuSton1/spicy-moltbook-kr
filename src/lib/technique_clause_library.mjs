import { clamp01, toFiniteNumber, toText, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_CLAUSE_GROUP_IDS = [
  "anchor",
  "retest",
  "compression",
  "confirm",
  "invalidate",
]

const featureThreshold = ({
  featureKey,
  comparator,
  threshold,
  scoreMargin = null,
} = {}) => ({
  kind: "feature_threshold",
  featureKey,
  comparator,
  threshold,
  scoreMargin,
})

const tokenPredicate = ({ token, present = true } = {}) => ({
  kind: present ? "token_presence" : "token_absence",
  token,
})

const allOf = (predicates = []) => ({
  kind: "all",
  predicates: predicates.filter(Boolean),
})

const clauseSpecs = [
  {
    clauseId: "anchor_ma120_break",
    clauseGroup: "anchor",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE"],
    predicate: featureThreshold({
      featureKey: "trend.closeOverMa120",
      comparator: "gte",
      threshold: 0,
      scoreMargin: 0.08,
    }),
  },
  {
    clauseId: "anchor_compaction_value_break",
    clauseGroup: "anchor",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: allOf([
      featureThreshold({
        featureKey: "shape.compression20",
        comparator: "gte",
        threshold: 0.4,
        scoreMargin: 0.2,
      }),
      featureThreshold({
        featureKey: "level.closeNearHigh20",
        comparator: "gte",
        threshold: 0.7,
        scoreMargin: 0.2,
      }),
      featureThreshold({
        featureKey: "volume.valueRatio20",
        comparator: "gte",
        threshold: 1.1,
        scoreMargin: 0.6,
      }),
    ]),
  },
  {
    clauseId: "anchor_recent_ma60_cross",
    clauseGroup: "anchor",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM"],
    predicate: allOf([
      featureThreshold({
        featureKey: "tech.daysSinceCrossAboveMa60",
        comparator: "lte",
        threshold: 10,
        scoreMargin: 10,
      }),
      featureThreshold({
        featureKey: "trend.closeOverMa60",
        comparator: "gte",
        threshold: 0,
        scoreMargin: 0.06,
      }),
    ]),
  },
  {
    clauseId: "anchor_recent_ma120_cross",
    clauseGroup: "anchor",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE"],
    predicate: allOf([
      featureThreshold({
        featureKey: "tech.daysSinceCrossAboveMa120",
        comparator: "lte",
        threshold: 15,
        scoreMargin: 15,
      }),
      featureThreshold({
        featureKey: "trend.closeOverMa120",
        comparator: "gte",
        threshold: 0,
        scoreMargin: 0.08,
      }),
    ]),
  },
  {
    clauseId: "anchor_recent_impulse",
    clauseGroup: "anchor",
    mechanismFamilies: ["MA_RETEST", "FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: allOf([
      featureThreshold({
        featureKey: "anchor.daysSinceImpulseBar",
        comparator: "lte",
        threshold: 8,
        scoreMargin: 6,
      }),
      featureThreshold({
        featureKey: "anchor.maxRunupSinceImpulse",
        comparator: "gte",
        threshold: 0.08,
        scoreMargin: 0.08,
      }),
    ]),
  },
  {
    clauseId: "anchor_breakout_pause",
    clauseGroup: "anchor",
    mechanismFamilies: ["BREAKOUT_BASE"],
    predicate: featureThreshold({
      featureKey: "shape.breakoutPauseScore",
      comparator: "gte",
      threshold: 0.55,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "anchor_value_backed_breakout",
    clauseGroup: "anchor",
    mechanismFamilies: ["BREAKOUT_BASE", "LIQUIDITY_SPONSOR"],
    predicate: allOf([
      featureThreshold({
        featureKey: "volume.valueRatio20",
        comparator: "gte",
        threshold: 1.1,
        scoreMargin: 0.6,
      }),
      featureThreshold({
        featureKey: "level.closeNearHigh20",
        comparator: "gte",
        threshold: 0.7,
        scoreMargin: 0.2,
      }),
    ]),
  },
  {
    clauseId: "anchor_gap_hold_quality",
    clauseGroup: "anchor",
    mechanismFamilies: ["LIQUIDITY_SPONSOR", "GAP_HOLD", "FAILURE_RECLAIM"],
    predicate: allOf([
      featureThreshold({
        featureKey: "gap.fillRatio",
        comparator: "lte",
        threshold: 0.65,
        scoreMargin: 0.35,
      }),
      featureThreshold({
        featureKey: "level.closeNearHigh20",
        comparator: "gte",
        threshold: 0.75,
        scoreMargin: 0.15,
      }),
    ]),
  },
  {
    clauseId: "anchor_near_52w_high",
    clauseGroup: "anchor",
    mechanismFamilies: ["BREAKOUT_BASE", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "tech.distanceTo52wHigh",
      comparator: "gte",
      threshold: -0.08,
      scoreMargin: 0.08,
    }),
  },
  {
    clauseId: "anchor_shallow_drawdown_150",
    clauseGroup: "anchor",
    mechanismFamilies: ["BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "global.drawdownFromHigh150",
      comparator: "gte",
      threshold: -0.18,
      scoreMargin: 0.12,
    }),
  },
  {
    clauseId: "retest_support_ma60",
    clauseGroup: "retest",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "LIQUIDITY_SPONSOR"],
    predicate: featureThreshold({
      featureKey: "pattern.supportHoldAtMa60",
      comparator: "gte",
      threshold: 0.5,
      scoreMargin: 0.3,
    }),
  },
  {
    clauseId: "retest_support_ma120",
    clauseGroup: "retest",
    mechanismFamilies: ["MA_RETEST", "LIQUIDITY_SPONSOR"],
    predicate: featureThreshold({
      featureKey: "pattern.supportHoldAtMa120",
      comparator: "gte",
      threshold: 0.5,
      scoreMargin: 0.3,
    }),
  },
  {
    clauseId: "retest_shallow_gap_fill",
    clauseGroup: "retest",
    mechanismFamilies: ["BREAKOUT_BASE", "FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "gap.fillRatio",
      comparator: "lte",
      threshold: 0.55,
      scoreMargin: 0.3,
    }),
  },
  {
    clauseId: "retest_pullback_reclaim_token",
    clauseGroup: "retest",
    mechanismFamilies: ["MA_RETEST", "FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: tokenPredicate({
      token: "sig.microCard.kgram.pullback_reclaim",
      present: true,
    }),
  },
  {
    clauseId: "retest_anchor_mid_hold",
    clauseGroup: "retest",
    mechanismFamilies: ["MA_RETEST", "FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "tech.anchorMidDistance",
      comparator: "gte",
      threshold: -0.05,
      scoreMargin: 0.05,
    }),
  },
  {
    clauseId: "compression_compaction20",
    clauseGroup: "compression",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "shape.compression20",
      comparator: "gte",
      threshold: 0.4,
      scoreMargin: 0.2,
    }),
  },
  {
    clauseId: "compression_sideways3",
    clauseGroup: "compression",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "shape.sidewaysScore3",
      comparator: "gte",
      threshold: 0.25,
      scoreMargin: 0.2,
    }),
  },
  {
    clauseId: "compression_coil",
    clauseGroup: "compression",
    mechanismFamilies: ["BREAKOUT_BASE", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "shape.coilScore",
      comparator: "gte",
      threshold: 0.55,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "compression_flag_quality",
    clauseGroup: "compression",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM"],
    predicate: featureThreshold({
      featureKey: "score.flagQuality",
      comparator: "gte",
      threshold: 0.55,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "compression_impulse_then_dryup5",
    clauseGroup: "compression",
    mechanismFamilies: ["MA_RETEST", "LIQUIDITY_SPONSOR"],
    predicate: featureThreshold({
      featureKey: "chain.impulseThenDryUp5",
      comparator: "gte",
      threshold: 0.5,
      scoreMargin: 0.3,
    }),
  },
  {
    clauseId: "compression_dryup_before_release_token",
    clauseGroup: "compression",
    mechanismFamilies: ["BREAKOUT_BASE", "FAILURE_RECLAIM"],
    predicate: tokenPredicate({
      token: "sig.sponsorCoupling.pattern.dryup_before_release",
      present: true,
    }),
  },
  {
    clauseId: "confirm_close_near_high",
    clauseGroup: "confirm",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "level.closeNearHigh20",
      comparator: "gte",
      threshold: 0.75,
      scoreMargin: 0.2,
    }),
  },
  {
    clauseId: "confirm_value_ratio",
    clauseGroup: "confirm",
    mechanismFamilies: ["BREAKOUT_BASE", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "volume.valueRatio20",
      comparator: "gte",
      threshold: 1.1,
      scoreMargin: 0.6,
    }),
  },
  {
    clauseId: "confirm_positive_close_retention_prevclose",
    clauseGroup: "confirm",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "event.closeRetentionFromPrevClose",
      comparator: "gte",
      threshold: 1,
      scoreMargin: 1.5,
    }),
  },
  {
    clauseId: "confirm_release_quality",
    clauseGroup: "confirm",
    mechanismFamilies: ["BREAKOUT_BASE", "FAILURE_RECLAIM"],
    predicate: featureThreshold({
      featureKey: "sig.stateTrans.releaseQuality",
      comparator: "gte",
      threshold: 0.45,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "confirm_sponsor_quality",
    clauseGroup: "confirm",
    mechanismFamilies: ["MA_RETEST", "LIQUIDITY_SPONSOR"],
    predicate: allOf([
      featureThreshold({
        featureKey: "sig.sponsor.quality",
        comparator: "gte",
        threshold: 0.35,
        scoreMargin: 0.25,
      }),
      featureThreshold({
        featureKey: "sig.sponsor.fragility",
        comparator: "lte",
        threshold: 0.2,
        scoreMargin: 0.12,
      }),
    ]),
  },
  {
    clauseId: "confirm_release_follow_token",
    clauseGroup: "confirm",
    mechanismFamilies: ["BREAKOUT_BASE", "FAILURE_RECLAIM"],
    predicate: tokenPredicate({
      token: "sig.microCard.kgram.release_follow",
      present: true,
    }),
  },
  {
    clauseId: "confirm_price_up_value_up_token",
    clauseGroup: "confirm",
    mechanismFamilies: ["BREAKOUT_BASE", "LIQUIDITY_SPONSOR"],
    predicate: tokenPredicate({
      token: "sig.sponsorCoupling.pattern.price_up_value_up",
      present: true,
    }),
  },
  {
    clauseId: "confirm_opening_imbalance",
    clauseGroup: "confirm",
    mechanismFamilies: ["BREAKOUT_BASE", "GAP_HOLD", "LIQUIDITY_SPONSOR"],
    predicate: featureThreshold({
      featureKey: "tech.openingImbalance",
      comparator: "gte",
      threshold: 0.003,
      scoreMargin: 0.015,
    }),
  },
  {
    clauseId: "confirm_intraday_vwap_hold",
    clauseGroup: "confirm",
    mechanismFamilies: ["FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "tech.vwapHold",
      comparator: "gte",
      threshold: 0.6,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "confirm_intraday_breakout_strength",
    clauseGroup: "confirm",
    mechanismFamilies: ["GAP_HOLD", "BREAKOUT_BASE"],
    predicate: featureThreshold({
      featureKey: "tech.intradayBreakoutStrength",
      comparator: "gte",
      threshold: 0.015,
      scoreMargin: 0.02,
    }),
  },
  {
    clauseId: "invalidate_failed_breakout_count20",
    clauseGroup: "invalidate",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "shape.failedBreakoutCount20",
      comparator: "lte",
      threshold: 2,
      scoreMargin: 1.5,
    }),
  },
  {
    clauseId: "invalidate_failed_break_risk",
    clauseGroup: "invalidate",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "score.failedBreakRisk",
      comparator: "lte",
      threshold: 0.45,
      scoreMargin: 0.25,
    }),
  },
  {
    clauseId: "invalidate_fragile_extension",
    clauseGroup: "invalidate",
    mechanismFamilies: ["MA_RETEST", "BREAKOUT_BASE", "FAILURE_RECLAIM", "LIQUIDITY_SPONSOR", "GAP_HOLD"],
    predicate: tokenPredicate({
      token: "sig.sponsorCoupling.pattern.fragile_extension",
      present: false,
    }),
  },
  {
    clauseId: "invalidate_extension_risk",
    clauseGroup: "invalidate",
    mechanismFamilies: ["FAILURE_RECLAIM", "GAP_HOLD"],
    predicate: featureThreshold({
      featureKey: "sig.phaseDiv.extensionRisk",
      comparator: "lte",
      threshold: 0.18,
      scoreMargin: 0.12,
    }),
  },
  {
    clauseId: "invalidate_liquidity_stress",
    clauseGroup: "invalidate",
    mechanismFamilies: ["BREAKOUT_BASE", "LIQUIDITY_SPONSOR"],
    predicate: featureThreshold({
      featureKey: "volume.liquidityStress",
      comparator: "lte",
      threshold: 0.6,
      scoreMargin: 0.3,
    }),
  },
]

const clauseSpecMap = new Map(clauseSpecs.map((spec) => [spec.clauseId, spec]))

export const listTechniqueClauseSpecs = () => clauseSpecs.map((spec) => ({ ...spec }))

export const resolveTechniqueClauseSpec = (clauseId) => clauseSpecMap.get(toText(clauseId)) ?? null

const normalizeThresholdScore = ({ comparator, value, threshold, scoreMargin } = {}) => {
  const numeric = toFiniteNumber(value)
  const base = toFiniteNumber(threshold)
  if (numeric === null || base === null) return 0
  const margin = Math.max(1e-9, Math.abs(toFiniteNumber(scoreMargin) ?? Math.abs(base) * 0.25 ?? 0.25))
  if (comparator === "gte") {
    return clamp01((numeric - base) / margin)
  }
  if (comparator === "lte") {
    return clamp01((base - numeric) / margin)
  }
  return 0
}

const evaluatePredicate = ({ predicate, featureMap, tokenSet } = {}) => {
  const kind = toText(predicate?.kind)
  if (!kind) {
    throw new Error("Technique predicate.kind is required")
  }
  if (kind === "feature_threshold") {
    const featureKey = toText(predicate?.featureKey)
    const comparator = toText(predicate?.comparator)
    const threshold = toFiniteNumber(predicate?.threshold)
    if (!featureKey || !comparator || threshold === null) {
      throw new Error(`Malformed technique feature_threshold predicate`)
    }
    const value = toFiniteNumber(featureMap?.[featureKey])
    if (value === null) {
      return {
        pass: false,
        score: 0,
        details: {
          kind,
          featureKey,
          comparator,
          threshold,
          value: null,
          reason: "missing_feature",
        },
      }
    }
    const pass =
      comparator === "gte"
        ? value >= threshold
        : comparator === "lte"
          ? value <= threshold
          : (() => {
              throw new Error(`Unsupported technique comparator=${comparator}`)
            })()
    return {
      pass,
      score: pass
        ? 1
        : normalizeThresholdScore({
            comparator,
            value,
            threshold,
            scoreMargin: predicate?.scoreMargin,
          }),
      details: {
        kind,
        featureKey,
        comparator,
        threshold,
        value,
      },
    }
  }
  if (kind === "token_presence" || kind === "token_absence") {
    const token = toText(predicate?.token)
    if (!token) {
      throw new Error(`Technique token predicate requires token`)
    }
    const present = tokenSet instanceof Set ? tokenSet.has(token) : false
    const pass = kind === "token_presence" ? present : !present
    return {
      pass,
      score: pass ? 1 : 0,
      details: {
        kind,
        token,
        present,
      },
    }
  }
  if (kind === "all" || kind === "any") {
    const predicates = Array.isArray(predicate?.predicates) ? predicate.predicates : []
    if (predicates.length < 1) {
      throw new Error(`Technique compound predicate ${kind} requires predicates`)
    }
    const results = predicates.map((child) => evaluatePredicate({ predicate: child, featureMap, tokenSet }))
    const pass = kind === "all" ? results.every((result) => result.pass) : results.some((result) => result.pass)
    const score = kind === "all"
      ? clamp01(results.reduce((sum, result) => sum + Number(result.score ?? 0), 0) / results.length)
      : Math.max(...results.map((result) => Number(result.score ?? 0)), 0)
    return {
      pass,
      score,
      details: {
        kind,
        children: results.map((result) => result.details),
      },
    }
  }
  throw new Error(`Unsupported technique predicate kind=${kind}`)
}

export const evaluateTechniqueClause = ({ clauseSpec, featureMap, tokenSet } = {}) => {
  const resolved = clauseSpec?.clauseId ? clauseSpec : resolveTechniqueClauseSpec(clauseSpec)
  if (!resolved) {
    throw new Error(`Unknown technique clause: ${clauseSpec?.clauseId ?? clauseSpec ?? "<null>"}`)
  }
  const evaluation = evaluatePredicate({
    predicate: resolved.predicate,
    featureMap,
    tokenSet,
  })
  return {
    clauseId: resolved.clauseId,
    clauseGroup: resolved.clauseGroup,
    mechanismFamilies: uniqueSortedStrings(resolved.mechanismFamilies),
    pass: evaluation.pass,
    score: evaluation.score,
    details: evaluation.details,
  }
}
