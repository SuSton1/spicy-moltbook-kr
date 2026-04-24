const clamp01 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

const safeRatio = (left, right) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= 0) return 0
  return l / r
}

export const buildPerfectPrototypeSubgroupTemporalStability = ({
  matchedDateCount = 0,
  matchedMonthCount = 0,
  matchedFoldCount = 0,
  top1DateHitShare = 0,
  windowPresenceCount = null,
  minMatchedDates = 10,
  minMatchedMonths = 6,
  minMatchedFolds = 4,
  minSelectionFrequency = 0.5,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
} = {}) => {
  const normalizedDateCount = Math.max(0, Number(matchedDateCount) || 0)
  const normalizedMonthCount = Math.max(0, Number(matchedMonthCount) || 0)
  const normalizedFoldCount = Math.max(0, Number(matchedFoldCount) || 0)
  const normalizedTop1DateHitShare = clamp01(top1DateHitShare)
  const dateCoverage = clamp01(safeRatio(normalizedDateCount, Math.max(1, Number(minMatchedDates) || 1)))
  const monthCoverage = clamp01(safeRatio(normalizedMonthCount, Math.max(1, Number(minMatchedMonths) || 1)))
  const foldCoverage = clamp01(safeRatio(normalizedFoldCount, Math.max(1, Number(minMatchedFolds) || 1)))
  const antiConcentration = clamp01(1 - normalizedTop1DateHitShare)
  const selectionFrequency = clamp01(
    (dateCoverage + monthCoverage + foldCoverage + antiConcentration) / 4,
  )
  const foldPresenceCount = normalizedFoldCount
  const resolvedWindowPresenceCount = Number.isFinite(Number(windowPresenceCount))
    ? Math.max(0, Number(windowPresenceCount))
    : normalizedMonthCount > 0
      ? Math.max(1, Math.min(4, Math.floor((normalizedMonthCount + 2) / 3)))
      : 0
  const stabilityQualified =
    selectionFrequency >= clamp01(minSelectionFrequency) &&
    foldPresenceCount >= Math.max(1, Number(minFoldPresenceCount) || 1) &&
    resolvedWindowPresenceCount >= Math.max(1, Number(minWindowPresenceCount) || 1)
  return {
    selectionFrequency,
    foldPresenceCount,
    windowPresenceCount: resolvedWindowPresenceCount,
    stabilityQualified,
  }
}
