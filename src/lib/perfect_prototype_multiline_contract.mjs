const normalizeInteger = (value) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) ? n : null
}

const normalizeText = (value) => String(value ?? "").trim()

export const MAX_RECENT_IMPULSE_LOOKBACK_DAYS = 8
export const PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN = "afree_open"
export const PERFECT_PROTOTYPE_STEPA_LANE_SAME_DAY_HIGH8 = "same_day_high8"

export const buildRecentImpulseLaneId = (lookbackTradingDays) => {
  const lookback = normalizeInteger(lookbackTradingDays)
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    throw new Error(
      `recent impulse lane lookback must be an integer in [1,${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}], got ${lookbackTradingDays ?? "null"}`,
    )
  }
  return `recent_impulse_${lookback}d`
}

export const buildRecentImpulseUniverseId = (lookbackTradingDays) => {
  const lookback = normalizeInteger(lookbackTradingDays)
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    throw new Error(
      `recent impulse discovery universe lookback must be an integer in [1,${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}], got ${lookbackTradingDays ?? "null"}`,
    )
  }
  return `recent_impulse_upto_${lookback}d`
}

export const buildSameDayPlusRecentUniverseId = (lookbackTradingDays) => {
  const lookback = normalizeInteger(lookbackTradingDays)
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    throw new Error(
      `same-day plus recent discovery universe lookback must be an integer in [1,${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}], got ${lookbackTradingDays ?? "null"}`,
    )
  }
  return `same_day_plus_recent_upto_${lookback}d`
}

export const parseRecentImpulseLaneId = (value) => {
  const match = normalizeText(value).match(/^recent_impulse_(\d+)d$/)
  if (!match) return null
  const lookback = normalizeInteger(match[1])
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    return null
  }
  return lookback
}

export const parseRecentImpulseUniverseId = (value) => {
  const match = normalizeText(value).match(/^recent_impulse_upto_(\d+)d$/)
  if (!match) return null
  const lookback = normalizeInteger(match[1])
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    return null
  }
  return lookback
}

export const parseSameDayPlusRecentUniverseId = (value) => {
  const match = normalizeText(value).match(/^same_day_plus_recent_upto_(\d+)d$/)
  if (!match) return null
  const lookback = normalizeInteger(match[1])
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    return null
  }
  return lookback
}

export const buildEnabledRecentImpulseLanes = (lookbackTradingDays) => {
  const lookback = normalizeInteger(lookbackTradingDays)
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > MAX_RECENT_IMPULSE_LOOKBACK_DAYS) {
    throw new Error(
      `enabled recent impulse lane lookback must be an integer in [1,${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}], got ${lookbackTradingDays ?? "null"}`,
    )
  }
  return Array.from({ length: lookback }, (_, index) => buildRecentImpulseLaneId(index + 1))
}

export const buildAllowedStepALanes = ({
  lookbackTradingDays,
  includeSameDayHigh8 = false,
} = {}) => {
  const lanes = buildEnabledRecentImpulseLanes(lookbackTradingDays)
  return Array.from(
    new Set(
      includeSameDayHigh8 === true
        ? [PERFECT_PROTOTYPE_STEPA_LANE_SAME_DAY_HIGH8, ...lanes]
        : lanes,
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export const resolvePerfectPrototypeDiscoveryUniverse = ({
  discoveryUniverseId = PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN,
  requestedLookbackTradingDays = null,
} = {}) => {
  const normalizedId =
    normalizeText(discoveryUniverseId) || PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN
  const requestedLookback = normalizeInteger(requestedLookbackTradingDays)
  if (normalizedId === PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN) {
    return {
      discoveryUniverseId: normalizedId,
      isAfreeOpenUniverse: true,
      isRecentImpulseUniverse: false,
      isSameDayPlusRecentUniverse: false,
      usesStepASeedInput: false,
      requiresLegacyNegativeSampling: false,
      includeSameDayHigh8: false,
      maxLookbackTradingDays: null,
      requestedLookbackTradingDays: requestedLookback,
      enabledRecentImpulseLanes: [],
      allowedStepALanes: [],
    }
  }
  const universeLookback = parseRecentImpulseUniverseId(normalizedId)
  if (Number.isInteger(universeLookback)) {
    if (requestedLookback != null && requestedLookback !== universeLookback) {
      throw new Error(
        `requested recent impulse lookback must match discoveryUniverseId: universe=${normalizedId} requested=${requestedLookback}`,
      )
    }
    return {
      discoveryUniverseId: normalizedId,
      isAfreeOpenUniverse: false,
      isRecentImpulseUniverse: true,
      isSameDayPlusRecentUniverse: false,
      usesStepASeedInput: true,
      requiresLegacyNegativeSampling: false,
      includeSameDayHigh8: false,
      maxLookbackTradingDays: universeLookback,
      requestedLookbackTradingDays: universeLookback,
      enabledRecentImpulseLanes: buildEnabledRecentImpulseLanes(universeLookback),
      allowedStepALanes: buildAllowedStepALanes({
        lookbackTradingDays: universeLookback,
        includeSameDayHigh8: false,
      }),
    }
  }
  const widenedUniverseLookback = parseSameDayPlusRecentUniverseId(normalizedId)
  if (!Number.isInteger(widenedUniverseLookback)) {
    throw new Error(
      [
        "Unsupported perfect prototype discoveryUniverseId.",
        `expected=${PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN}|recent_impulse_upto_1d..recent_impulse_upto_${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}d|same_day_plus_recent_upto_1d..same_day_plus_recent_upto_${MAX_RECENT_IMPULSE_LOOKBACK_DAYS}d`,
        `actual=${normalizedId || "null"}`,
      ].join(" "),
    )
  }
  if (requestedLookback != null && requestedLookback !== widenedUniverseLookback) {
    throw new Error(
      `requested same-day plus recent lookback must match discoveryUniverseId: universe=${normalizedId} requested=${requestedLookback}`,
    )
  }
  return {
    discoveryUniverseId: normalizedId,
    isAfreeOpenUniverse: false,
    isRecentImpulseUniverse: false,
    isSameDayPlusRecentUniverse: true,
    usesStepASeedInput: true,
    requiresLegacyNegativeSampling: true,
    includeSameDayHigh8: true,
    maxLookbackTradingDays: widenedUniverseLookback,
    requestedLookbackTradingDays: widenedUniverseLookback,
    enabledRecentImpulseLanes: buildEnabledRecentImpulseLanes(widenedUniverseLookback),
    allowedStepALanes: buildAllowedStepALanes({
      lookbackTradingDays: widenedUniverseLookback,
      includeSameDayHigh8: true,
    }),
  }
}
