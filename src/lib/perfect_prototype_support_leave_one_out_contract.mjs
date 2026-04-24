const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const supportCompatibilityOf = (row) =>
  num(row?.supportCompatibility) ??
  num(row?.numericFeatureMap?.["sig.supportMetric.supportCompatibility"]) ??
  Number.NEGATIVE_INFINITY

const supportMarginOf = (row) =>
  num(row?.supportMargin) ??
  num(row?.numericFeatureMap?.["sig.support.margin"]) ??
  num(row?.numericFeatureMap?.["sig.supportMetric.coverageAdjustedMargin"]) ??
  Number.NEGATIVE_INFINITY

const compareSupportSeedRows = (left, right) => {
  const leftCompatibility = supportCompatibilityOf(left)
  const rightCompatibility = supportCompatibilityOf(right)
  if (rightCompatibility !== leftCompatibility) return rightCompatibility - leftCompatibility
  const leftMargin = supportMarginOf(left)
  const rightMargin = supportMarginOf(right)
  if (rightMargin !== leftMargin) return rightMargin - leftMargin
  return String(left?.rowKey ?? left?.caseId ?? "").localeCompare(String(right?.rowKey ?? right?.caseId ?? ""))
}

export const buildPerfectPrototypeSupportLeaveOneOutContract = ({
  cohort,
  excludeSupportCaseFromFit = false,
  maxSupportSeedRows = 48,
} = {}) => {
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const supportPositiveRows = Array.isArray(cohort?.supportPositiveRows) ? cohort.supportPositiveRows : []
  const fitSupportCaseViews = excludeSupportCaseFromFit ? [] : supportCaseViews
  const supportSeedRows = excludeSupportCaseFromFit
    ? [...supportPositiveRows]
        .sort(compareSupportSeedRows)
        .slice(0, Math.max(1, Math.floor(Number(maxSupportSeedRows) || 48)))
    : supportCaseViews

  return {
    supportFitExcluded: excludeSupportCaseFromFit === true,
    fitSupportCaseViews,
    supportAcceptanceViews: supportCaseViews,
    supportSeedRows,
    summary: {
      supportFitExcluded: excludeSupportCaseFromFit === true,
      supportFitViewCount: fitSupportCaseViews.length,
      supportAcceptanceViewCount: supportCaseViews.length,
      supportSeedSummary: summarizeRows(supportSeedRows),
    },
  }
}

export { summarizeRows as summarizePerfectPrototypeSupportLeaveOneOutRows }
