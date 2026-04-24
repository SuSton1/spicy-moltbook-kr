const binarySearchInsertionIndex = (values, nextValue) => {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = low + ((high - low) >> 1)
    if (values[mid] < nextValue) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

const toPositiveInteger = (value) => {
  const numeric = Math.floor(Number(value))
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

const clampOptionalRate = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric <= 0) return 0
  if (numeric >= 1) return 1
  return numeric
}

const computeBestPossibleDominantShare = ({ bucketCount, bucketWidth = 1 }) => {
  const resolvedBucketCount = Math.max(0, Math.floor(Number(bucketCount) || 0))
  const resolvedBucketWidth = Math.max(1, Math.floor(Number(bucketWidth) || 1))
  if (resolvedBucketCount < 1) return 1
  return Math.min(1, resolvedBucketWidth / resolvedBucketCount)
}

export const createPerfectPrototypeTopKHitTracker = ({ maxRules }) => {
  const safeMaxRules = Math.max(1, Math.floor(Number(maxRules) || 1))
  const topHitCountsAsc = []
  let observedRuleCount = 0
  const observeHitCount = (hitCount) => {
    const nextHitCount = Math.max(0, Math.floor(Number(hitCount) || 0))
    observedRuleCount += 1
    if (topHitCountsAsc.length < safeMaxRules) {
      const insertAt = binarySearchInsertionIndex(topHitCountsAsc, nextHitCount)
      topHitCountsAsc.splice(insertAt, 0, nextHitCount)
      return
    }
    if (nextHitCount <= topHitCountsAsc[0]) {
      return
    }
    topHitCountsAsc.shift()
    const insertAt = binarySearchInsertionIndex(topHitCountsAsc, nextHitCount)
    topHitCountsAsc.splice(insertAt, 0, nextHitCount)
  }
  const getKthHitFloor = () => (topHitCountsAsc.length >= safeMaxRules ? topHitCountsAsc[0] : null)
  return {
    observeHitCount,
    getKthHitFloor,
    getStats: () => ({
      observedRuleCount,
      trackedRuleCount: topHitCountsAsc.length,
      kthHitFloor: getKthHitFloor(),
    }),
  }
}

export const resolvePerfectPrototypeEffectiveKthHitFloor = (...floors) => {
  let nextFloor = null
  for (const rawFloor of floors) {
    const floor = Math.floor(Number(rawFloor))
    if (!Number.isInteger(floor) || floor <= 0) continue
    nextFloor = nextFloor == null ? floor : Math.max(nextFloor, floor)
  }
  return nextFloor
}

export const shouldPrunePerfectPrototypeStateByTopKBound = ({
  positiveCount,
  kthHitFloor = null,
}) => Number.isInteger(kthHitFloor) && kthHitFloor > 0 && Number(positiveCount) < kthHitFloor

export const evaluatePerfectPrototypePromotableUpperBoundGuard = ({
  distinctDateUpperBound = null,
  matchedMonthUpperBound = null,
  matchedFoldUpperBound = null,
  minTrainMatchedDates = null,
  minTrainMatchedMonths = null,
  minTrainMatchedFolds = null,
  maxTop1DateHitShare = null,
  maxTop3DateHitShare = null,
  maxTop1FoldHitShare = null,
  maxTop3FoldHitShare = null,
}) => {
  const resolvedDistinctDateUpperBound = Math.max(0, Math.floor(Number(distinctDateUpperBound) || 0))
  const resolvedMatchedMonthUpperBound = Math.max(0, Math.floor(Number(matchedMonthUpperBound) || 0))
  const resolvedMatchedFoldUpperBound = Math.max(0, Math.floor(Number(matchedFoldUpperBound) || 0))
  const resolvedMinTrainMatchedDates = toPositiveInteger(minTrainMatchedDates)
  const resolvedMinTrainMatchedMonths = toPositiveInteger(minTrainMatchedMonths)
  const resolvedMinTrainMatchedFolds = toPositiveInteger(minTrainMatchedFolds)
  const resolvedMaxTop1DateHitShare = clampOptionalRate(maxTop1DateHitShare)
  const resolvedMaxTop3DateHitShare = clampOptionalRate(maxTop3DateHitShare)
  const resolvedMaxTop1FoldHitShare = clampOptionalRate(maxTop1FoldHitShare)
  const resolvedMaxTop3FoldHitShare = clampOptionalRate(maxTop3FoldHitShare)

  if (
    Number.isInteger(resolvedMinTrainMatchedDates) &&
    resolvedDistinctDateUpperBound < resolvedMinTrainMatchedDates
  ) {
    return { ok: false, reason: 'PROMOTABLE_UPPER_BOUND_BELOW_MIN_TRAIN_MATCHED_DATES' }
  }
  if (
    Number.isInteger(resolvedMinTrainMatchedMonths) &&
    resolvedMatchedMonthUpperBound < resolvedMinTrainMatchedMonths
  ) {
    return { ok: false, reason: 'PROMOTABLE_UPPER_BOUND_BELOW_MIN_TRAIN_MATCHED_MONTHS' }
  }
  if (
    Number.isInteger(resolvedMinTrainMatchedFolds) &&
    resolvedMatchedFoldUpperBound < resolvedMinTrainMatchedFolds
  ) {
    return { ok: false, reason: 'PROMOTABLE_UPPER_BOUND_BELOW_MIN_TRAIN_MATCHED_FOLDS' }
  }

  const bestPossibleTop1DateHitShare = computeBestPossibleDominantShare({
    bucketCount: resolvedDistinctDateUpperBound,
    bucketWidth: 1,
  })
  if (
    Number.isFinite(resolvedMaxTop1DateHitShare) &&
    bestPossibleTop1DateHitShare > resolvedMaxTop1DateHitShare
  ) {
    return { ok: false, reason: 'PROMOTABLE_BEST_TOP1_DATE_HIT_SHARE_ABOVE_MAX' }
  }

  const bestPossibleTop3DateHitShare = computeBestPossibleDominantShare({
    bucketCount: resolvedDistinctDateUpperBound,
    bucketWidth: 3,
  })
  if (
    Number.isFinite(resolvedMaxTop3DateHitShare) &&
    bestPossibleTop3DateHitShare > resolvedMaxTop3DateHitShare
  ) {
    return { ok: false, reason: 'PROMOTABLE_BEST_TOP3_DATE_HIT_SHARE_ABOVE_MAX' }
  }

  const bestPossibleTop1FoldHitShare = computeBestPossibleDominantShare({
    bucketCount: resolvedMatchedFoldUpperBound,
    bucketWidth: 1,
  })
  if (
    Number.isFinite(resolvedMaxTop1FoldHitShare) &&
    bestPossibleTop1FoldHitShare > resolvedMaxTop1FoldHitShare
  ) {
    return { ok: false, reason: 'PROMOTABLE_BEST_TOP1_FOLD_HIT_SHARE_ABOVE_MAX' }
  }

  const bestPossibleTop3FoldHitShare = computeBestPossibleDominantShare({
    bucketCount: resolvedMatchedFoldUpperBound,
    bucketWidth: 3,
  })
  if (
    Number.isFinite(resolvedMaxTop3FoldHitShare) &&
    bestPossibleTop3FoldHitShare > resolvedMaxTop3FoldHitShare
  ) {
    return { ok: false, reason: 'PROMOTABLE_BEST_TOP3_FOLD_HIT_SHARE_ABOVE_MAX' }
  }

  return { ok: true, reason: null }
}
