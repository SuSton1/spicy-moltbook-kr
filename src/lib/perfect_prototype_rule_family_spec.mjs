export const PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT = "top_close_breakout"
export const PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT = "top_close_recent"
export const PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION = "mid_close_continuation"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION = "low_close_continuation"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION = "low_gap_top_continuation"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION = "low_gap_high_continuation"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION = "low_jump_below_continuation"

export const PERFECT_PROTOTYPE_RULE_FAMILY_IDS = Object.freeze([
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
])

export const PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS = Object.freeze([
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
])

export const PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_MINING_IDS = Object.freeze([
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
])

export const PERFECT_PROTOTYPE_RULE_FAMILY_TOP_SEED_BUCKET = "TOP"
export const PERFECT_PROTOTYPE_RULE_FAMILY_MID_SEED_BUCKET = "MID"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_SEED_BUCKET = "LOW"
export const PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET = "OTHER"
export const PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN =
  "tag:stepa.lane:recent_impulse_1d"
export const PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN = "tag:xsec.closeRank:MID"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN = "tag:xsec.closeRank:LOW"
export const PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN = "tag:xsec.closeRank:TOP"
export const PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN = "tag:xsecLane.pool:THIN_POOL"
export const PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN = "tag:xsec.gapRank:TOP"
export const PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN = "tag:xsec.gapRank:HIGH"
export const PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN =
  "tag:xsec.jumpVsMedian:BELOW"

const PERFECT_PROTOTYPE_RECENT_ONLY_FAMILY_SCOPE_SPECS = Object.freeze({
  [PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION]: Object.freeze({
    requiredLaneId: "recent_impulse_1d",
    requiredPositiveTokens: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN,
    ]),
    excludedPositiveTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN]),
    rootStageMaxExistingRuleTokenCount: 3,
  }),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION]: Object.freeze({
    requiredLaneId: "recent_impulse_1d",
    requiredPositiveTokens: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
    ]),
    excludedPositiveTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN]),
    rootStageMaxExistingRuleTokenCount: 4,
  }),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION]: Object.freeze({
    requiredLaneId: "recent_impulse_1d",
    requiredPositiveTokens: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
      PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
    ]),
    excludedPositiveTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN]),
    rootStageMaxExistingRuleTokenCount: 4,
  }),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION]: Object.freeze({
    requiredLaneId: "recent_impulse_1d",
    requiredPositiveTokens: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
      PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
    ]),
    excludedPositiveTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN]),
    rootStageMaxExistingRuleTokenCount: 4,
  }),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION]: Object.freeze({
    requiredLaneId: "recent_impulse_1d",
    requiredPositiveTokens: Object.freeze([
      PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
      PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
    ]),
    excludedPositiveTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN]),
    rootStageMaxExistingRuleTokenCount: 4,
  }),
})

const PERFECT_PROTOTYPE_RULE_FAMILY_ROOT_TOKENS_BY_ID = Object.freeze({
  [PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT]: Object.freeze([
    "tag:stepa.lane:same_day_high8",
    PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  ]),
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION]: Object.freeze([
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
    PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  ]),
})

const PERFECT_PROTOTYPE_CONTINUATION_ROOT_ALLOW_PATTERNS = Object.freeze([
  "tag:xsec.*",
  "tag:xseclane.*",
  "tag:market.closebreadth:*",
  "num:event.*",
  "num:feature.candle.*",
  "num:feature.gap.*",
  "num:feature.pattern.closecluster*",
  "num:feature.shape.*",
  "num:feature.volume.exhaustionproxy:*",
  "num:feature.volume.ratio5over20:*",
  "num:xsec.*",
])

const PERFECT_PROTOTYPE_CONTINUATION_ROOT_DENY_PATTERNS = Object.freeze([
  "num:feature.volume.tradingvaluetomarketcap:*",
  "num:seq150.stdev:*",
  "num:market.positivecloseshare:*",
  "num:market.strongcloseshare:*",
])

const PERFECT_PROTOTYPE_CONTINUATION_COARSE_ROOT_PATTERNS = Object.freeze([
  "tag:xsec.closevsmedian:*",
  "tag:xsec.jumpvsmedian:*",
  "tag:xseclane.closerank:*",
  "tag:xseclane.jumprank:*",
  "tag:xsec.gaprank:*",
])

const PERFECT_PROTOTYPE_SUPPORT_CASE_TARGETED_ROOT_ALLOW_PATTERNS_BY_FAMILY = Object.freeze({
  [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION]: Object.freeze([
    "tag:xsec.gaprank:*",
    "tag:xsec.closevsmedian:*",
    "tag:xsec.jumpvsmedian:*",
    "tag:xseclane.closerank:*",
    "tag:xseclane.jumprank:*",
    "num:feature.gap.*",
    "num:event.gap*",
    "num:event.closeretentionfromprevclose*",
    "num:feature.shape.breakoutdistance20*",
    "num:feature.candle.closepos*",
    "num:feature.candle.bodypct*",
    "num:feature.candle.rangepct*",
    "num:xsec.closerankpct*",
    "num:xsec.gaprankpct*",
  ]),
})

const PERFECT_PROTOTYPE_SUPPORT_CASE_TARGETED_ROOT_DENY_PATTERNS = Object.freeze([
  "num:global.*",
  "num:market.*",
  "num:seq*",
  "num:feature.volume.*",
  "num:feature.trend.*",
])

const hasToken = (tokens, token) =>
  Array.isArray(tokens) && tokens.includes(token)

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const normalizeToken = (value) => String(value ?? "").trim().toLowerCase()

const tokenMatchesPattern = (token, pattern) => {
  const normalizedToken = normalizeToken(token)
  const normalizedPattern = normalizeToken(pattern)
  if (!normalizedToken || !normalizedPattern) return false
  if (normalizedPattern.endsWith("*")) {
    return normalizedToken.startsWith(normalizedPattern.slice(0, -1))
  }
  return normalizedToken === normalizedPattern
}

const readShare = (stats, key) => {
  const numeric = Number(stats?.[key])
  return Number.isFinite(numeric) ? numeric : null
}

const readBooleanFromShare = (stats, key) => {
  const share = readShare(stats, key)
  return share != null ? share > 0 : null
}

export const classifyPerfectPrototypeSeedFamilyBucket = (token) => {
  const normalized = String(token ?? "").trim()
  if (!normalized) return PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET
  if (normalized === PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN) return PERFECT_PROTOTYPE_RULE_FAMILY_MID_SEED_BUCKET
  if (normalized === PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN) return PERFECT_PROTOTYPE_RULE_FAMILY_LOW_SEED_BUCKET
  if (normalized === PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN) return PERFECT_PROTOTYPE_RULE_FAMILY_TOP_SEED_BUCKET
  return PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET
}

export const buildPerfectPrototypeRecentOnlyFamilyRootTokens = (familyId) => {
  return buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId).requiredPositiveTokens
}

export const buildPerfectPrototypeRuleFamilyRootTokens = (familyId) =>
  Array.from(PERFECT_PROTOTYPE_RULE_FAMILY_ROOT_TOKENS_BY_ID[String(familyId ?? "").trim()] ?? [])

export const buildPerfectPrototypeRecentOnlyFamilyScopeSpec = (familyId) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  const spec = PERFECT_PROTOTYPE_RECENT_ONLY_FAMILY_SCOPE_SPECS[normalizedFamilyId]
  if (!spec) {
    return {
      requiredLaneId: null,
      requiredPositiveTokens: [],
      excludedPositiveTokens: [],
      rootStageMaxExistingRuleTokenCount: 0,
    }
  }
  return {
    requiredLaneId: String(spec.requiredLaneId ?? "").trim() || null,
    requiredPositiveTokens: Array.from(spec.requiredPositiveTokens),
    excludedPositiveTokens: Array.from(spec.excludedPositiveTokens),
    rootStageMaxExistingRuleTokenCount: Number(spec.rootStageMaxExistingRuleTokenCount ?? 0) || 0,
  }
}

export const getPerfectPrototypeRecentOnlyFamilyRootStageMaxExistingRuleTokenCount = (familyId) =>
  Number(buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId).rootStageMaxExistingRuleTokenCount ?? 0) || 0

export const isPerfectPrototypeRecentOnlyContinuationFamilyId = (familyId) =>
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.includes(String(familyId ?? "").trim())

export const isPerfectPrototypeRecentOnlyShadowFamilyId = (familyId) =>
  isPerfectPrototypeRecentOnlyContinuationFamilyId(familyId)

export const buildPerfectPrototypeRecentOnlyShadowFamilyIdSet = (familyIds) =>
  new Set(
    (Array.isArray(familyIds) ? familyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter((value) => PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.includes(value)),
  )

export const buildPerfectPrototypeRecentOnlyMiningFamilyIdSet = (familyIds) =>
  new Set(
    (Array.isArray(familyIds) ? familyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter((value) => PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_MINING_IDS.includes(value)),
  )

export const isPerfectPrototypeLowContinuationFamilyId = (familyId) =>
  [
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
  ].includes(String(familyId ?? "").trim())

export const isPerfectPrototypeMidContinuationFamilyId = (familyId) =>
  String(familyId ?? "").trim() === PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION

export const isPerfectPrototypeContinuationFamilyRootTokenAllowed = ({ familyId, token }) => {
  if (!isPerfectPrototypeRecentOnlyContinuationFamilyId(familyId)) return true
  const normalizedToken = normalizeToken(token)
  if (!normalizedToken) return false
  if (PERFECT_PROTOTYPE_CONTINUATION_ROOT_DENY_PATTERNS.some((pattern) => tokenMatchesPattern(normalizedToken, pattern))) {
    return false
  }
  if (buildPerfectPrototypeRecentOnlyFamilyRootTokens(familyId).some((requiredToken) => normalizeToken(requiredToken) === normalizedToken)) {
    return false
  }
  return PERFECT_PROTOTYPE_CONTINUATION_ROOT_ALLOW_PATTERNS.some((pattern) => tokenMatchesPattern(normalizedToken, pattern))
}

export const isPerfectPrototypeSupportCaseTargetedFamilyId = (familyId) =>
  String(familyId ?? "").trim() === PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION

export const isPerfectPrototypeSupportCaseTargetedRootTokenAllowed = ({
  familyId,
  token,
}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (!isPerfectPrototypeSupportCaseTargetedFamilyId(normalizedFamilyId)) {
    return true
  }
  const normalizedToken = normalizeToken(token)
  if (!normalizedToken) return false
  if (
    PERFECT_PROTOTYPE_SUPPORT_CASE_TARGETED_ROOT_DENY_PATTERNS.some((pattern) =>
      tokenMatchesPattern(normalizedToken, pattern),
    )
  ) {
    return false
  }
  if (
    !isPerfectPrototypeContinuationFamilyRootTokenAllowed({
      familyId: normalizedFamilyId,
      token: normalizedToken,
    })
  ) {
    return false
  }
  const allowPatterns =
    PERFECT_PROTOTYPE_SUPPORT_CASE_TARGETED_ROOT_ALLOW_PATTERNS_BY_FAMILY[
      normalizedFamilyId
    ] ?? []
  return allowPatterns.some((pattern) => tokenMatchesPattern(normalizedToken, pattern))
}

export const buildPerfectPrototypeSupportCaseTargetedRootTokenSet = ({
  familyId,
  tokens,
}) =>
  uniqueSorted(tokens).filter((token) =>
    isPerfectPrototypeSupportCaseTargetedRootTokenAllowed({
      familyId,
      token,
    }),
  )

export const scorePerfectPrototypeContinuationFamilyRootTokenPriority = ({ familyId, token }) => {
  if (!isPerfectPrototypeRecentOnlyContinuationFamilyId(familyId)) return 0
  const normalizedToken = normalizeToken(token)
  if (!normalizedToken) return -1
  if (PERFECT_PROTOTYPE_CONTINUATION_COARSE_ROOT_PATTERNS.some((pattern) => tokenMatchesPattern(normalizedToken, pattern))) {
    return 2
  }
  if (isPerfectPrototypeContinuationFamilyRootTokenAllowed({ familyId, token: normalizedToken })) {
    return 1
  }
  return -1
}

export const inferPerfectPrototypeRuleFamilyId = ({ tokens, stats = null }) => {
  const safeTokens = Array.isArray(tokens) ? tokens : []
  const recentImpulse1dShare = readShare(stats, "matchedRecentImpulse1dShare")
  const sameDayHigh8Share = readShare(stats, "matchedSameDayHigh8Share")
  const inRecentImpulse1d =
    hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN) ||
    (recentImpulse1dShare != null && recentImpulse1dShare >= 0.8)
  const inSameDayHigh8 =
    hasToken(safeTokens, "tag:stepa.lane:same_day_high8") ||
    (sameDayHigh8Share != null && sameDayHigh8Share >= 0.6)
  const hasGlobalTop = hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN)
  const hasGlobalMid = hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN)
  const hasGlobalLow = hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)
  const hasLaneLocalTop = hasToken(safeTokens, "tag:xsecLane.closeRank:TOP")
  const hasLaneLocalHigh = hasToken(safeTokens, "tag:xsecLane.closeRank:HIGH")
  const hasGapRankTop = hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN)
  const hasGapRankHigh = hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN)
  const hasJumpVsMedianBelow = hasToken(
    safeTokens,
    PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  )
  const globalMidShare = readShare(stats, "matchedGlobalMidShare")
  const globalLowShare = readShare(stats, "matchedGlobalLowShare")
  const thinPool =
    hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN) ||
    readBooleanFromShare(stats, "matchedLaneThinPoolShare") === true
  if (inSameDayHigh8 && hasGlobalTop) {
    return PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT
  }
  if (inRecentImpulse1d && hasGlobalTop) {
    return PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT
  }
  if (
    inRecentImpulse1d &&
    !thinPool &&
    !hasGlobalTop &&
    (hasGlobalMid || (globalMidShare != null && globalMidShare >= Math.max(globalLowShare ?? 0, 0.6)))
  ) {
    return PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION
  }
  if (
    inRecentImpulse1d &&
    !thinPool &&
    !hasGlobalTop &&
    (hasGlobalLow || (globalLowShare != null && globalLowShare >= Math.max(globalMidShare ?? 0, 0.6))) &&
    (hasLaneLocalTop ||
      hasLaneLocalHigh ||
      readShare(stats, "matchedLaneHighShare") != null ||
      readShare(stats, "matchedLaneTopShare") != null)
  ) {
    if (hasGapRankTop) return PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION
    if (hasGapRankHigh) return PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION
    if (hasJumpVsMedianBelow) return PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION
    return PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION
  }
  return null
}

export const evaluatePerfectPrototypeRuleFamilyPurity = ({
  familyId,
  tokens,
  stats = null,
  midMinShare = 0.6,
  lowMinShare = 0.6,
  minRecentImpulse1dShare = 0.8,
}) => {
  const safeTokens = Array.isArray(tokens) ? tokens : []
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (!normalizedFamilyId) {
    return { ok: true, reason: null }
  }
  const globalTopShare = readShare(stats, "matchedGlobalTopShare")
  const globalMidShare = readShare(stats, "matchedGlobalMidShare")
  const globalLowShare = readShare(stats, "matchedGlobalLowShare")
  const laneThinPoolShare = readShare(stats, "matchedLaneThinPoolShare")
  const recentImpulse1dShare = readShare(stats, "matchedRecentImpulse1dShare")
  if (
    normalizedFamilyId === PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION ||
    isPerfectPrototypeLowContinuationFamilyId(normalizedFamilyId)
  ) {
    if (hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN) || (globalTopShare != null && globalTopShare > 0)) {
      return { ok: false, reason: "FAMILY_TOP_TOKEN_FORBIDDEN" }
    }
    if (hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN) || (laneThinPoolShare != null && laneThinPoolShare > 0)) {
      return { ok: false, reason: "FAMILY_THIN_POOL_FORBIDDEN" }
    }
    if (recentImpulse1dShare != null) {
      if (recentImpulse1dShare < Number(minRecentImpulse1dShare)) {
        return { ok: false, reason: "FAMILY_RECENT_IMPULSE_SHARE_BELOW_THRESHOLD" }
      }
    } else if (!hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_CONTINUATION_LANE_TOKEN)) {
      return { ok: false, reason: "FAMILY_RECENT_IMPULSE_TOKEN_REQUIRED" }
    }
  }
  if (normalizedFamilyId === PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION) {
    if (globalMidShare != null) {
      if (globalMidShare < Number(midMinShare)) {
        return { ok: false, reason: "FAMILY_MID_SHARE_BELOW_THRESHOLD" }
      }
    } else if (!hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN)) {
      return { ok: false, reason: "FAMILY_MID_TOKEN_REQUIRED" }
    }
  }
  if (isPerfectPrototypeLowContinuationFamilyId(normalizedFamilyId)) {
    if (globalLowShare != null) {
      if (globalLowShare < Number(lowMinShare)) {
        return { ok: false, reason: "FAMILY_LOW_SHARE_BELOW_THRESHOLD" }
      }
    } else if (!hasToken(safeTokens, PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)) {
      return { ok: false, reason: "FAMILY_LOW_TOKEN_REQUIRED" }
    }
  }
  return { ok: true, reason: null }
}

export const isPerfectPrototypeContinuationFamilyId = (familyId) =>
  isPerfectPrototypeMidContinuationFamilyId(familyId) ||
  isPerfectPrototypeLowContinuationFamilyId(familyId)

export const buildPerfectPrototypeAllowedFamilyIdSet = (familyIds) =>
  new Set(
    (Array.isArray(familyIds) ? familyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter((value) => PERFECT_PROTOTYPE_RULE_FAMILY_IDS.includes(value)),
  )

export const resolvePerfectPrototypeRuleFamilySelection = ({ familyIds, rules }) => {
  const allowedFamilyIds = buildPerfectPrototypeAllowedFamilyIdSet(familyIds)
  const safeRules = Array.isArray(rules) ? rules : []
  if (allowedFamilyIds.size < 1) {
    return {
      allowedFamilyIds,
      rules: safeRules.slice(),
    }
  }
  return {
    allowedFamilyIds,
    rules: safeRules.filter((rule) => allowedFamilyIds.has(String(rule?.familyId ?? "").trim())),
  }
}
