const resolveOptionalNumber = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveGoalMode = (value) => {
  const text = String(value ?? "LEGACY_PNL_V1").trim().toUpperCase()
  if (text === "TARGET_FIRST_V2") return "TARGET_FIRST_V2"
  return "LEGACY_PNL_V1"
}

const resolvePositionSemantics = (value) => {
  const text = String(value ?? "SINGLE_POSITION_V1").trim().toUpperCase()
  if (text === "OVERLAP_DAILY_ONE_PICK_V2") return "OVERLAP_DAILY_ONE_PICK_V2"
  return "SINGLE_POSITION_V1"
}

export const evaluateStepELockboxGate = ({ lockboxSummary, cfg }) => {
  const gateCfg = cfg?.lockboxGate ?? {}
  const lockboxEnabled = gateCfg?.enabled === true
  if (!lockboxEnabled) {
    return {
      enabled: false,
      eligible: false,
      reason: "LOCKBOX_GATE_DISABLED",
      checks: {},
      metrics: {}
    }
  }
  const hasSummary = !!lockboxSummary && typeof lockboxSummary === "object"
  const goalMode = resolveGoalMode(lockboxSummary?.goalMode ?? gateCfg?.goalMode)
  const positionSemantics = resolvePositionSemantics(
    lockboxSummary?.positionSemantics ?? gateCfg?.positionSemantics,
  )
  const totalTrades = Math.max(0, Number(lockboxSummary?.totalTrades ?? 0) || 0)
  const winRate = Number(lockboxSummary?.winRate ?? 0) || 0
  const avgNetRet = Number(lockboxSummary?.avgNetRet ?? 0) || 0
  const cumulativeReturn = Number(lockboxSummary?.cumulativeReturn ?? 0) || 0
  const targetHitCount = Math.max(0, Number(lockboxSummary?.targetHitCount ?? 0) || 0)
  const targetHitRate = Number(lockboxSummary?.targetHitRate ?? 0) || 0
  const stopCount = Math.max(0, Number(lockboxSummary?.stopCount ?? 0) || 0)
  const stopRate = Number(lockboxSummary?.stopRate ?? 0) || 0
  const timeoutPositiveCount = Math.max(0, Number(lockboxSummary?.timeoutPositiveCount ?? 0) || 0)
  const timeoutPositiveRate = Number(lockboxSummary?.timeoutPositiveRate ?? 0) || 0
  const timeoutNegativeCount = Math.max(0, Number(lockboxSummary?.timeoutNegativeCount ?? 0) || 0)
  const timeoutNegativeRate = Number(lockboxSummary?.timeoutNegativeRate ?? 0) || 0
  const targetHitsPer20TradingDays = Number(lockboxSummary?.targetHitsPer20TradingDays ?? 0) || 0
  const maxDrawdown = Math.max(0, Number(lockboxSummary?.maxDrawdown ?? Number.POSITIVE_INFINITY))
  const lookaheadViolations = Math.max(0, Number(lockboxSummary?.lookaheadViolations ?? 0) || 0)
  const executionLookaheadViolations = Math.max(
    0,
    Number(lockboxSummary?.executionLookaheadViolations ?? 0) || 0,
  )
  const policyDriftSummary = lockboxSummary?.policyDrift ?? {}
  const traceDiffSummary = lockboxSummary?.traceDiff ?? {}
  const falsePositiveGateSummary = lockboxSummary?.falsePositiveGate ?? {}
  const policyDriftScore = Number(policyDriftSummary?.policyDriftScore)
  const bucketConsistency = Number(policyDriftSummary?.bucketConsistency)
  const regimeConsistency = Number(policyDriftSummary?.regimeConsistency)
  const agreementDecisionConsistency = Number(policyDriftSummary?.agreementDecisionConsistency)
  const agreementReasonConsistency = Number(policyDriftSummary?.agreementReasonConsistency)
  const traceMismatchRate = Number(traceDiffSummary?.mismatchRate)
  const traceCriticalMismatchDays = Math.max(
    0,
    Number(traceDiffSummary?.criticalMismatchDays ?? 0) || 0,
  )
  const falsePositiveRejectedCount = Math.max(
    0,
    Number(falsePositiveGateSummary?.rejectedCount ?? 0) || 0,
  )
  const falsePositiveRejectionPrecision = Number(
    falsePositiveGateSummary?.rejectionPrecision ?? 0,
  ) || 0
  const maxPolicyDriftScore = resolveOptionalNumber(gateCfg?.maxPolicyDriftScore)
  const minBucketConsistency = resolveOptionalNumber(gateCfg?.minBucketConsistency)
  const minRegimeConsistency = resolveOptionalNumber(gateCfg?.minRegimeConsistency)
  const minAgreementDecisionConsistency = resolveOptionalNumber(
    gateCfg?.minAgreementDecisionConsistency,
  )
  const minAgreementReasonConsistency = resolveOptionalNumber(gateCfg?.minAgreementReasonConsistency)
  const maxTraceMismatchRate = resolveOptionalNumber(gateCfg?.maxTraceMismatchRate)
  const maxTraceCriticalMismatchDays = resolveOptionalNumber(gateCfg?.maxTraceCriticalMismatchDays)
  const minTargetHitCount = Math.max(
    0,
    Math.floor(Number(gateCfg?.minTargetHitCount ?? 0) || 0),
  )
  const minTargetHitRate = resolveOptionalNumber(gateCfg?.minTargetHitRate)
  const minTargetHitsPer20TradingDays = resolveOptionalNumber(
    gateCfg?.minTargetHitsPer20TradingDays,
  )
  const maxStopRate = resolveOptionalNumber(gateCfg?.maxStopRate)
  const maxTimeoutNegativeRate = resolveOptionalNumber(gateCfg?.maxTimeoutNegativeRate)
  const minWinRate = resolveOptionalNumber(gateCfg?.minWinRate)
  const minAvgNetRet = resolveOptionalNumber(gateCfg?.minAvgNetRet)
  const minCumulativeReturn = resolveOptionalNumber(gateCfg?.minCumulativeReturn)
  const minFalsePositiveRejectedCount = Math.max(
    0,
    Math.floor(Number(gateCfg?.minFalsePositiveRejectedCount ?? 0) || 0),
  )
  const minFalsePositiveRejectionPrecision = resolveOptionalNumber(
    gateCfg?.minFalsePositiveRejectionPrecision,
  )
  const falsePositiveEvidenceRequired =
    Number.isFinite(minFalsePositiveRejectionPrecision) &&
    minFalsePositiveRejectionPrecision >= 0
  const checks = {
    stepESummaryPresent: hasSummary,
    totalTrades: hasSummary
      ? totalTrades >= Math.max(1, Number(gateCfg?.minTrades ?? 10) || 10)
      : false,
    targetHitCount:
      !hasSummary || minTargetHitCount <= 0
        ? true
        : targetHitCount >= minTargetHitCount,
    targetHitRate:
      !hasSummary || !Number.isFinite(minTargetHitRate)
        ? true
        : targetHitRate >= minTargetHitRate,
    targetHitsPer20TradingDays:
      !hasSummary || !Number.isFinite(minTargetHitsPer20TradingDays)
        ? true
        : targetHitsPer20TradingDays >= minTargetHitsPer20TradingDays,
    stopRate:
      !hasSummary || !Number.isFinite(maxStopRate)
        ? true
        : stopRate <= maxStopRate,
    timeoutNegativeRate:
      !hasSummary || !Number.isFinite(maxTimeoutNegativeRate)
        ? true
        : timeoutNegativeRate <= maxTimeoutNegativeRate,
    winRate:
      !hasSummary || !Number.isFinite(minWinRate)
        ? true
        : winRate >= minWinRate,
    avgNetRet:
      !hasSummary || !Number.isFinite(minAvgNetRet)
        ? true
        : avgNetRet >= minAvgNetRet,
    cumulativeReturn:
      !hasSummary || !Number.isFinite(minCumulativeReturn)
        ? true
        : cumulativeReturn >= minCumulativeReturn,
    maxDrawdown: hasSummary
      ? maxDrawdown <= Math.max(0, Number(gateCfg?.maxDrawdown ?? 0.35) || 0.35)
      : false,
    policyDrift:
      !Number.isFinite(maxPolicyDriftScore) ||
      maxPolicyDriftScore < 0 ||
      !hasSummary
        ? true
        : (policyDriftSummary?.available === true && Number.isFinite(policyDriftScore)
          ? policyDriftScore <= maxPolicyDriftScore
          : false),
    bucketConsistency:
      !Number.isFinite(minBucketConsistency) ||
      minBucketConsistency < 0 ||
      !hasSummary
        ? true
        : (policyDriftSummary?.available === true && Number.isFinite(bucketConsistency)
          ? bucketConsistency >= minBucketConsistency
          : false),
    regimeConsistency:
      !Number.isFinite(minRegimeConsistency) ||
      minRegimeConsistency < 0 ||
      !hasSummary
        ? true
        : (policyDriftSummary?.available === true && Number.isFinite(regimeConsistency)
          ? regimeConsistency >= minRegimeConsistency
          : false),
    agreementDecisionConsistency:
      !Number.isFinite(minAgreementDecisionConsistency) ||
      minAgreementDecisionConsistency < 0 ||
      !hasSummary
        ? true
        : (policyDriftSummary?.available === true && Number.isFinite(agreementDecisionConsistency)
          ? agreementDecisionConsistency >= minAgreementDecisionConsistency
          : false),
    agreementReasonConsistency:
      !Number.isFinite(minAgreementReasonConsistency) ||
      minAgreementReasonConsistency < 0 ||
      !hasSummary
        ? true
        : (policyDriftSummary?.available === true && Number.isFinite(agreementReasonConsistency)
          ? agreementReasonConsistency >= minAgreementReasonConsistency
          : false),
    traceMismatchRate:
      !Number.isFinite(maxTraceMismatchRate) ||
      maxTraceMismatchRate < 0 ||
      !hasSummary
        ? true
        : (traceDiffSummary?.available === true && Number.isFinite(traceMismatchRate)
          ? traceMismatchRate <= maxTraceMismatchRate
          : false),
    traceCriticalMismatchDays:
      !Number.isFinite(maxTraceCriticalMismatchDays) ||
      maxTraceCriticalMismatchDays < 0 ||
      !hasSummary
        ? true
        : (traceDiffSummary?.available === true
          ? traceCriticalMismatchDays <= maxTraceCriticalMismatchDays
          : false),
    falsePositiveRejectedCount:
      !falsePositiveEvidenceRequired ||
      !hasSummary ||
      minFalsePositiveRejectedCount <= 0
        ? true
        : falsePositiveRejectedCount >= minFalsePositiveRejectedCount,
    falsePositiveRejectionPrecision:
      !falsePositiveEvidenceRequired ||
      !hasSummary ||
      (
        minFalsePositiveRejectedCount > 0 &&
        falsePositiveRejectedCount < minFalsePositiveRejectedCount
      )
        ? false
        : falsePositiveRejectionPrecision >= minFalsePositiveRejectionPrecision,
    lookahead:
      gateCfg?.requireZeroLookaheadViolations === false ||
      (hasSummary && lookaheadViolations === 0 && executionLookaheadViolations === 0)
  }
  const reason = (() => {
    if (!checks.stepESummaryPresent) return "STEP_E_SUMMARY_MISSING"
    if (!checks.totalTrades) return "LOCKBOX_TRADES_LOW"
    if (!checks.targetHitCount) return "LOCKBOX_TARGET_HIT_COUNT_LOW"
    if (!checks.targetHitRate) return "LOCKBOX_TARGET_HIT_RATE_LOW"
    if (!checks.targetHitsPer20TradingDays) return "LOCKBOX_TARGET_FREQUENCY_LOW"
    if (!checks.stopRate) return "LOCKBOX_STOP_RATE_HIGH"
    if (!checks.timeoutNegativeRate) return "LOCKBOX_TIMEOUT_NEGATIVE_RATE_HIGH"
    if (!checks.winRate) return "LOCKBOX_WINRATE_LOW"
    if (!checks.avgNetRet) return "LOCKBOX_AVGNETRET_LOW"
    if (!checks.cumulativeReturn) return "LOCKBOX_CUMRET_LOW"
    if (!checks.maxDrawdown) return "LOCKBOX_MDD_HIGH"
    if (!checks.policyDrift) return "LOCKBOX_POLICY_DRIFT_HIGH"
    if (!checks.bucketConsistency) return "LOCKBOX_BUCKET_CONSISTENCY_LOW"
    if (!checks.regimeConsistency) return "LOCKBOX_REGIME_CONSISTENCY_LOW"
    if (!checks.agreementDecisionConsistency) return "LOCKBOX_AGREEMENT_DECISION_CONSISTENCY_LOW"
    if (!checks.agreementReasonConsistency) return "LOCKBOX_AGREEMENT_REASON_CONSISTENCY_LOW"
    if (!checks.traceMismatchRate) return "LOCKBOX_TRACE_MISMATCH_RATE_HIGH"
    if (!checks.traceCriticalMismatchDays) return "LOCKBOX_TRACE_CRITICAL_MISMATCH_HIGH"
    if (!checks.falsePositiveRejectedCount) return "LOCKBOX_FALSE_POSITIVE_COUNT_LOW"
    if (!checks.falsePositiveRejectionPrecision) return "LOCKBOX_FALSE_POSITIVE_PRECISION_LOW"
    if (!checks.lookahead) return "LOCKBOX_LOOKAHEAD_VIOLATION"
    return "PASS"
  })()
  const eligible = Object.values(checks).every((flag) => flag === true)
  return {
    enabled: true,
    eligible,
    reason,
    checks,
    metrics: {
      goalMode,
      positionSemantics,
      totalTrades,
      targetHitCount,
      targetHitRate,
      stopCount,
      stopRate,
      timeoutPositiveCount,
      timeoutPositiveRate,
      timeoutNegativeCount,
      timeoutNegativeRate,
      targetHitsPer20TradingDays,
      winRate,
      avgNetRet,
      cumulativeReturn,
      maxDrawdown,
      policyDriftScore: Number.isFinite(policyDriftScore) ? policyDriftScore : null,
      bucketConsistency: Number.isFinite(bucketConsistency) ? bucketConsistency : null,
      regimeConsistency: Number.isFinite(regimeConsistency) ? regimeConsistency : null,
      agreementDecisionConsistency: Number.isFinite(agreementDecisionConsistency)
        ? agreementDecisionConsistency
        : null,
      agreementReasonConsistency: Number.isFinite(agreementReasonConsistency)
        ? agreementReasonConsistency
        : null,
      traceMismatchRate: Number.isFinite(traceMismatchRate) ? traceMismatchRate : null,
      traceCriticalMismatchDays,
      falsePositiveRejectedCount,
      falsePositiveRejectionPrecision,
      lookaheadViolations,
      executionLookaheadViolations
    }
  }
}

export const evaluateDeploymentDebt = ({
  championRoundSummary,
  lockboxGateEval,
  cfg
}) => {
  const debtCfg = cfg?.promotionDebt ?? {}
  const roundDebt = championRoundSummary?.checks?.promotionDebt ?? {}
  const enabled = debtCfg?.enabled === true
  const requireLockboxEligible = debtCfg?.requireLockboxEligible !== false
  const checks = {
    championPresent: !!championRoundSummary,
    falsePositiveRejectedCountEval: enabled !== true || roundDebt?.countOk === true,
    falsePositiveRejectionPrecisionEval: enabled !== true || roundDebt?.precisionOk === true,
    fingerprintChanged: enabled !== true || roundDebt?.fingerprintOk === true,
    lockboxEligible: requireLockboxEligible !== true || lockboxGateEval?.eligible === true
  }
  const eligible = Object.values(checks).every((flag) => flag === true)
  const reason = (() => {
    if (!checks.championPresent) return "NO_CHAMPION_ROUND"
    if (!checks.falsePositiveRejectedCountEval) return "DEPLOYMENT_FP_REJECT_COUNT_LOW"
    if (!checks.falsePositiveRejectionPrecisionEval) return "DEPLOYMENT_FP_REJECT_PRECISION_LOW"
    if (!checks.fingerprintChanged) return "DEPLOYMENT_POLICY_FINGERPRINT_UNCHANGED"
    if (!checks.lockboxEligible) {
      return String(lockboxGateEval?.reason ?? "DEPLOYMENT_LOCKBOX_GATE_FAILED")
    }
    return "PASS"
  })()
  return {
    enabled,
    eligible,
    reason,
    checks,
    requireLockboxEligible,
    metrics: {
      falsePositiveRejectedCountEval: Number(roundDebt?.falsePositiveRejectedCountEval ?? 0) || 0,
      falsePositiveRejectionPrecisionEval: Number(roundDebt?.falsePositiveRejectionPrecisionEval ?? 0) || 0
    }
  }
}
