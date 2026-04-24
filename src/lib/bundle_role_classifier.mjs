const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const clampRate = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export const safeRate = (hits, picks) => {
  const hitCount = Math.max(0, toFiniteNumber(hits, 0))
  const pickCount = Math.max(0, toFiniteNumber(picks, 0))
  return pickCount > 0 ? clampRate(hitCount / pickCount) : 0
}

export const normalizeUpperKey = (value) => String(value ?? "").trim().toUpperCase()

export const normalizeStringList = (values, { upper = false } = {}) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => {
        const text = String(value ?? "").trim()
        return upper ? text.toUpperCase() : text
      })
      .filter(Boolean),
  )]

export const isStopExitReason = (value) => normalizeUpperKey(value).includes("STOP")

export const isTimeoutNegativeExitReason = (value, netRet = 0) => {
  const reason = normalizeUpperKey(value)
  return reason === "TIMEOUT_NEGATIVE" || (reason.includes("TIMEOUT") && toFiniteNumber(netRet, 0) < 0)
}

export const computeVetoScore = ({
  stopRateE = 0,
  timeoutNegativeRateE = 0,
}) => clampRate(clampRate(toFiniteNumber(stopRateE, 0)) * 0.7 + clampRate(toFiniteNumber(timeoutNegativeRateE, 0)) * 0.3)

export const classifySampleTier = (
  metrics,
  {
    minPickFloorDWeak = 6,
    minPickFloorEWeak = 6,
    minPickFloorDStrong = 10,
    minPickFloorEStrong = 10,
  } = {},
) => {
  const pickD_V = Math.max(0, toFiniteNumber(metrics?.pickD_V, 0))
  const pickE = Math.max(0, toFiniteNumber(metrics?.pickE, 0))
  if (pickD_V >= minPickFloorDStrong && pickE >= minPickFloorEStrong) return "STRONG"
  if (pickD_V >= minPickFloorDWeak && pickE >= minPickFloorEWeak) return "WEAK"
  if (pickD_V > 0 || pickE > 0) return "INSUFFICIENT"
  return "EMPTY"
}

export const classifyBundleRole = (
  metrics,
  {
    vetoStopFloor = 0.5,
    vetoTimeoutFloor = 0.33,
  } = {},
) => {
  const rateD_V = clampRate(toFiniteNumber(metrics?.rateD_V, 0))
  const rateE = clampRate(toFiniteNumber(metrics?.rateE, 0))
  const stopRateE = clampRate(toFiniteNumber(metrics?.stopRateE, 0))
  const timeoutNegativeRateE = clampRate(toFiniteNumber(metrics?.timeoutNegativeRateE, 0))
  if (stopRateE >= vetoStopFloor || timeoutNegativeRateE >= vetoTimeoutFloor) {
    return "VETO_STOP"
  }
  if (rateD_V > 0 && rateE > 0) return "INTERSECTION_CORE"
  if (rateE > 0) return "SUPPORT_E"
  if (rateD_V > 0) return "D_ONLY"
  return "UNKNOWN"
}

export const evaluateBundleStatus = (
  metrics,
  {
    minPickFloorDWeak = 6,
    minPickFloorEWeak = 6,
    minPickFloorDStrong = 10,
    minPickFloorEStrong = 10,
    maxStopRateE = 0.6,
    maxTimeoutNegativeRateE = 0.6,
  } = {},
) => {
  const rateD_V = clampRate(toFiniteNumber(metrics?.rateD_V, 0))
  const rateE = clampRate(toFiniteNumber(metrics?.rateE, 0))
  const pickD_V = Math.max(0, toFiniteNumber(metrics?.pickD_V, 0))
  const pickE = Math.max(0, toFiniteNumber(metrics?.pickE, 0))
  const stopRateE = clampRate(toFiniteNumber(metrics?.stopRateE, 0))
  const timeoutNegativeRateE = clampRate(toFiniteNumber(metrics?.timeoutNegativeRateE, 0))
  const sampleTier = classifySampleTier(metrics, {
    minPickFloorDWeak,
    minPickFloorEWeak,
    minPickFloorDStrong,
    minPickFloorEStrong,
  })
  const weakPass =
    rateD_V >= 0.3 &&
    rateE >= 0.3 &&
    pickD_V >= minPickFloorDWeak &&
    pickE >= minPickFloorEWeak &&
    stopRateE <= maxStopRateE &&
    timeoutNegativeRateE <= maxTimeoutNegativeRateE
  const strongPass =
    rateD_V >= 0.5 &&
    rateE >= 0.5 &&
    pickD_V >= minPickFloorDStrong &&
    pickE >= minPickFloorEStrong &&
    stopRateE <= maxStopRateE &&
    timeoutNegativeRateE <= maxTimeoutNegativeRateE
  if (strongPass) {
    return {
      status: "PROMOTED",
      sampleTier,
      promotionReason: "DV_AND_E_STRONG_PASS",
      rejectionReason: null,
    }
  }
  if (weakPass) {
    return {
      status: "VALIDATED",
      sampleTier,
      promotionReason: null,
      rejectionReason: null,
    }
  }
  if (sampleTier === "EMPTY" || sampleTier === "INSUFFICIENT") {
    return {
      status: "DISCOVERY",
      sampleTier,
      promotionReason: null,
      rejectionReason: "INSUFFICIENT_SAMPLE",
    }
  }
  if (stopRateE > maxStopRateE) {
    return {
      status: "REJECTED",
      sampleTier,
      promotionReason: null,
      rejectionReason: "HIGH_STOP_RATE_E",
    }
  }
  if (timeoutNegativeRateE > maxTimeoutNegativeRateE) {
    return {
      status: "REJECTED",
      sampleTier,
      promotionReason: null,
      rejectionReason: "HIGH_TIMEOUT_NEGATIVE_RATE_E",
    }
  }
  if (rateD_V < 0.3) {
    return {
      status: "REJECTED",
      sampleTier,
      promotionReason: null,
      rejectionReason: "LOW_RATE_DV",
    }
  }
  if (rateE < 0.3) {
    return {
      status: "REJECTED",
      sampleTier,
      promotionReason: null,
      rejectionReason: "LOW_RATE_E",
    }
  }
  return {
    status: "REJECTED",
    sampleTier,
    promotionReason: null,
    rejectionReason: "FAILED_VALIDATION",
  }
}

export const normalizeBundleSpec = (raw = {}) => ({
  bundleId: String(raw?.bundleId ?? "").trim(),
  familyId: String(raw?.familyId ?? "").trim(),
  coreClusterIds: normalizeStringList(raw?.coreClusterIds, { upper: true }),
  corePrototypeIds: normalizeStringList(raw?.corePrototypeIds),
  supportClusterIds: normalizeStringList(raw?.supportClusterIds, { upper: true }),
  supportPrototypeIds: normalizeStringList(raw?.supportPrototypeIds),
  vetoClusterIds: normalizeStringList(raw?.vetoClusterIds, { upper: true }),
  vetoPrototypeIds: normalizeStringList(raw?.vetoPrototypeIds),
  allowedDayTypes: normalizeStringList(raw?.allowedDayTypes, { upper: true }),
  allowedRegimeTags: normalizeStringList(raw?.allowedRegimeTags, { upper: true }),
  minMargin: Math.max(0, toFiniteNumber(raw?.minMargin, 0)),
  maxVetoScore: Number.isFinite(Number(raw?.maxVetoScore))
    ? Number(raw.maxVetoScore)
    : null,
  abstainWhenNoConsensus: raw?.abstainWhenNoConsensus !== false,
  designSource: normalizeUpperKey(raw?.designSource ?? "U") || "U",
  validationSource: normalizeUpperKey(raw?.validationSource ?? "V") || "V",
  confirmationSource: normalizeUpperKey(raw?.confirmationSource ?? "E") || "E",
})
