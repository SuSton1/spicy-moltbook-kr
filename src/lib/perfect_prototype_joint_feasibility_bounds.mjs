import {
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
} from "./perfect_prototype_support_case.mjs"
import {
  evaluatePerfectPrototypeHistoricalSupportContract,
} from "./perfect_prototype_historical_support_contract.mjs"

const toInt = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback
}

const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

export const buildPerfectPrototypeJointFeasibilityBounds = ({
  cfg = null,
  familyId = null,
} = {}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  const isLowFamily = normalizedFamilyId.startsWith("low_")
  return {
    minTrainMatchedDates: Math.max(
      1,
      toInt(
        isLowFamily
          ? cfg?.lowFamilyMinTrainMatchedDates ?? cfg?.subgroupMinMatchedDates ?? 10
          : cfg?.minTrainMatchedDates ?? cfg?.subgroupMinMatchedDates ?? 10,
        10,
      ),
    ),
    minTrainMatchedMonths: Math.max(
      1,
      toInt(
        isLowFamily
          ? cfg?.lowFamilyMinTrainMatchedMonths ?? cfg?.subgroupMinMatchedMonths ?? 6
          : cfg?.minTrainMatchedMonths ?? cfg?.subgroupMinMatchedMonths ?? 6,
        6,
      ),
    ),
    minTrainMatchedFolds: Math.max(
      1,
      toInt(
        isLowFamily
          ? cfg?.lowFamilyMinTrainMatchedFolds ?? cfg?.subgroupMinMatchedFolds ?? 4
          : cfg?.minTrainMatchedFolds ?? cfg?.subgroupMinMatchedFolds ?? 4,
        4,
      ),
    ),
    maxCrossfitNegativeWindows: Math.max(
      0,
      toInt(cfg?.jointFeasibilityMaxCrossfitNegativeWindows ?? 0, 0),
    ),
    minCrossfitRetainedPositiveWindows: Math.max(
      1,
      toInt(cfg?.jointFeasibilityMinCrossfitPositiveWindows ?? 2, 2),
    ),
    requireHistoricalSupport: cfg?.jointFeasibilityRequireHistoricalSupport === true,
    historicalSupportCaseIds: uniqueSorted(
      cfg?.jointFeasibilityHistoricalSupportCaseIds ??
        (cfg?.jointFeasibilityRequireHistoricalSupport === true
          ? [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID]
          : []),
    ),
  }
}

export const evaluatePerfectPrototypeJointFeasibilityBounds = ({
  familyId = null,
  tokens = [],
  positiveHitStats = null,
  crossfitMatchedWindowCount = 0,
  crossfitNegativeWindowCount = 0,
  supportCases = [],
  bounds = null,
} = {}) => {
  const reasons = []
  const resolvedBounds = bounds ?? buildPerfectPrototypeJointFeasibilityBounds({ familyId })
  const distinctDateCount = toInt(positiveHitStats?.distinctDateCount, 0)
  const matchedMonthCount = toInt(positiveHitStats?.matchedMonthCount, 0)
  const matchedFoldCount = toInt(positiveHitStats?.matchedFoldCount, 0)
  if (distinctDateCount < toInt(resolvedBounds.minTrainMatchedDates, 1)) {
    reasons.push("unsat_train_breadth")
  }
  if (matchedMonthCount < toInt(resolvedBounds.minTrainMatchedMonths, 1)) {
    reasons.push("unsat_train_breadth")
  }
  if (matchedFoldCount < toInt(resolvedBounds.minTrainMatchedFolds, 1)) {
    reasons.push("unsat_train_breadth")
  }
  if (toInt(crossfitNegativeWindowCount, 0) > toInt(resolvedBounds.maxCrossfitNegativeWindows, 0)) {
    reasons.push("unsat_crossfit_negative_windows")
  }
  if (
    toInt(crossfitMatchedWindowCount, 0) <
    toInt(resolvedBounds.minCrossfitRetainedPositiveWindows, 1)
  ) {
    reasons.push("unsat_crossfit_positive_recurrence")
  }
  const historicalSupport = evaluatePerfectPrototypeHistoricalSupportContract({
    familyId,
    tokens,
    supportCases,
    requiredSupportCaseIds: resolvedBounds.historicalSupportCaseIds,
    requireHistoricalSupport: resolvedBounds.requireHistoricalSupport === true,
  })
  if (historicalSupport.ok !== true) {
    reasons.push(historicalSupport.reason ?? "unsat_historical_support")
  }
  return {
    ok: reasons.length < 1,
    reasons: uniqueSorted(reasons),
    historicalSupportMatched: historicalSupport.historicalSupportMatched === true,
    historicalSupportCaseIds: historicalSupport.resolvedSupportCaseIds ?? [],
    missingHistoricalSupportTokens: historicalSupport.missingTokens ?? [],
    crossfitRetainedPositiveWindowCount: toInt(crossfitMatchedWindowCount, 0),
    crossfitNegativeWindowCount: toInt(crossfitNegativeWindowCount, 0),
    trainMatchedDateCount: distinctDateCount,
    trainMatchedMonthCount: matchedMonthCount,
    trainMatchedFoldCount: matchedFoldCount,
  }
}

