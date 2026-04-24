const FEATURE_KEYS = [
  "sig.support.posDistance",
  "sig.support.maxDistance",
  "sig.support.margin",
  "sig.support.densityRatio",
  "sig.support.prototypeAgreement",
  "sig.support.featureCoverage",
  "sig.support.nearShare",
  "sig.supportMetric.score",
  "sig.supportMetric.coverageAdjustedMargin",
  "sig.supportMetric.agreementDistanceRatio",
  "sig.supportMetric.densityMarginGap",
  "sig.supportMetric.prototypeCloseness",
  "sig.supportMetric.supportCompatibility",
]

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => num(value))
        .filter(Number.isFinite)
        .map((value) => Number(value.toFixed(8))),
    ),
  )

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const countPassing = ({ rows, featureKey, operator, threshold }) =>
  (Array.isArray(rows) ? rows : []).filter((row) => {
    const value = num(row?.numericFeatureMap?.[featureKey])
    const cut = num(threshold)
    if (!Number.isFinite(value) || !Number.isFinite(cut)) return false
    if (operator === ">=") return value >= cut
    if (operator === "<=") return value <= cut
    return false
  })

const buildThresholdId = ({ featureKey, operator, threshold }) =>
  [
    "ROUTERTHRESH",
    String(featureKey ?? "").replace(/[^a-zA-Z0-9_.:-]+/g, "_"),
    operator === ">=" ? "ge" : "le",
    String(Number(threshold).toFixed(8)).replace(/[^a-zA-Z0-9_.:-]+/g, "_"),
  ].join("__")

const compareThresholdCandidates = (left, right) => {
  if (right.thresholdScore !== left.thresholdScore) return right.thresholdScore - left.thresholdScore
  if (right.supportCaseCount !== left.supportCaseCount) return right.supportCaseCount - left.supportCaseCount
  if (right.supportPositiveDateCount !== left.supportPositiveDateCount) {
    return right.supportPositiveDateCount - left.supportPositiveDateCount
  }
  return String(left.thresholdId).localeCompare(String(right.thresholdId))
}

const compareFeatureCandidates = (left, right) => {
  if (right.featureScore !== left.featureScore) return right.featureScore - left.featureScore
  if (right.bestThresholdScore !== left.bestThresholdScore) {
    return right.bestThresholdScore - left.bestThresholdScore
  }
  return String(left.featureKey).localeCompare(String(right.featureKey))
}

const buildThresholdCandidatesForFeature = ({
  featureKey,
  supportCaseViews = [],
  supportPositiveRows = [],
  hardNegativeRows = [],
  maxThresholdsPerFeature = 4,
} = {}) => {
  const supportCaseValues = (Array.isArray(supportCaseViews) ? supportCaseViews : [])
    .map((row) => row?.numericFeatureMap?.[featureKey])
    .map((value) => num(value))
    .filter(Number.isFinite)
  const supportPositiveValues = (Array.isArray(supportPositiveRows) ? supportPositiveRows : [])
    .map((row) => row?.numericFeatureMap?.[featureKey])
    .map((value) => num(value))
    .filter(Number.isFinite)
  const hardNegativeValues = (Array.isArray(hardNegativeRows) ? hardNegativeRows : [])
    .map((row) => row?.numericFeatureMap?.[featureKey])
    .map((value) => num(value))
    .filter(Number.isFinite)
  if (supportCaseValues.length < 1 || supportPositiveValues.length < 2 || hardNegativeValues.length < 2) {
    return null
  }
  const supportMedian = quantile(supportPositiveValues, 0.5)
  const hardNegativeMedian = quantile(hardNegativeValues, 0.5)
  if (!Number.isFinite(num(supportMedian)) || !Number.isFinite(num(hardNegativeMedian))) return null
  const operator = supportMedian >= hardNegativeMedian ? ">=" : "<="
  const supportCaseMin = Math.min(...supportCaseValues)
  const supportCaseMax = Math.max(...supportCaseValues)
  const supportQ10 = quantile(supportPositiveValues, 0.1)
  const supportQ25 = quantile(supportPositiveValues, 0.25)
  const supportQ50 = quantile(supportPositiveValues, 0.5)
  const supportQ75 = quantile(supportPositiveValues, 0.75)
  const supportQ90 = quantile(supportPositiveValues, 0.9)
  const hardNegQ10 = quantile(hardNegativeValues, 0.1)
  const hardNegQ25 = quantile(hardNegativeValues, 0.25)
  const hardNegQ75 = quantile(hardNegativeValues, 0.75)
  const hardNegQ90 = quantile(hardNegativeValues, 0.9)
  const rawThresholds =
    operator === ">="
      ? [
          supportCaseMin,
          supportQ10,
          supportQ25,
          supportQ50,
          hardNegQ75,
          hardNegQ90,
          Number.isFinite(num(supportQ25)) && Number.isFinite(num(hardNegQ90))
            ? (supportQ25 + hardNegQ90) / 2
            : null,
        ]
      : [
          supportCaseMax,
          supportQ90,
          supportQ75,
          supportQ50,
          hardNegQ10,
          hardNegQ25,
          Number.isFinite(num(supportQ75)) && Number.isFinite(num(hardNegQ10))
            ? (supportQ75 + hardNegQ10) / 2
            : null,
        ]
  const thresholdCandidates = uniqueNumbers(rawThresholds)
    .map((threshold) => {
      const supportCaseMatchedRows = countPassing({
        rows: supportCaseViews,
        featureKey,
        operator,
        threshold,
      })
      const supportPositiveMatchedRows = countPassing({
        rows: supportPositiveRows,
        featureKey,
        operator,
        threshold,
      })
      const hardNegativeMatchedRows = countPassing({
        rows: hardNegativeRows,
        featureKey,
        operator,
        threshold,
      })
      const supportPositiveDateCount = new Set(
        supportPositiveMatchedRows.map((row) => row.dateKey).filter(Boolean),
      ).size
      const supportPositiveMonthCount = new Set(
        supportPositiveMatchedRows
          .map((row) => row.monthKey ?? buildMonthKey(row.dateKey))
          .filter(Boolean),
      ).size
      const supportPositiveFoldCount = new Set(
        supportPositiveMatchedRows.map((row) => Number(row.foldId ?? 0)).filter((value) => value > 0),
      ).size
      const supportCaseCount = supportCaseMatchedRows.length
      const hardNegativeCount = hardNegativeMatchedRows.length
      const thresholdScore =
        supportCaseCount * 320 +
        supportPositiveDateCount * 22 +
        supportPositiveMonthCount * 12 +
        supportPositiveMatchedRows.length * 3 -
        hardNegativeCount * 28
      return {
        thresholdId: buildThresholdId({ featureKey, operator, threshold }),
        featureKey,
        operator,
        threshold,
        weight: 1,
        supportCaseCount,
        supportPositiveCount: supportPositiveMatchedRows.length,
        hardNegativeCount,
        supportPositiveDateCount,
        supportPositiveMonthCount,
        supportPositiveFoldCount,
        thresholdScore,
      }
    })
    .filter((entry) => entry.supportPositiveCount > 0 || entry.supportCaseCount > 0)
    .sort(compareThresholdCandidates)
    .slice(0, Math.max(1, Math.floor(Number(maxThresholdsPerFeature) || 4)))
  if (thresholdCandidates.length < 1) return null
  const best = thresholdCandidates[0]
  const featureScore =
    best.supportCaseCount * 240 +
    best.supportPositiveDateCount * 18 +
    best.supportPositiveMonthCount * 10 -
    best.hardNegativeCount * 24
  return {
    featureKey,
    operator,
    featureScore,
    bestThresholdScore: best.thresholdScore,
    thresholdCandidates,
  }
}

export const buildPerfectPrototypeSupportPrototypeRouterCandidateSpace = ({
  cohort,
  maxFeatureCandidates = 6,
  maxThresholdsPerFeature = 4,
} = {}) => {
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const supportPositiveRows = Array.isArray(cohort?.supportPositiveRows) ? cohort.supportPositiveRows : []
  const hardNegativeRows = Array.isArray(cohort?.hardNegativeRows) ? cohort.hardNegativeRows : []
  const featureCandidates = FEATURE_KEYS.map((featureKey) =>
    buildThresholdCandidatesForFeature({
      featureKey,
      supportCaseViews,
      supportPositiveRows,
      hardNegativeRows,
      maxThresholdsPerFeature,
    }),
  )
    .filter(Boolean)
    .sort(compareFeatureCandidates)
    .slice(0, Math.max(1, Math.floor(Number(maxFeatureCandidates) || 6)))

  const thresholdCandidates = featureCandidates.flatMap((feature) => feature.thresholdCandidates)

  return {
    featureCandidates,
    summary: {
      routerCandidateCount: thresholdCandidates.length,
      routerFeatureCandidateCount: featureCandidates.length,
      routerThresholdCandidateCount: thresholdCandidates.length,
    },
  }
}

