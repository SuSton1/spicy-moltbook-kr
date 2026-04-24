const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => num(value))
        .filter(Number.isFinite)
        .map((value) => Number(value.toFixed(8))),
    ),
  ).sort((left, right) => left - right)

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

export const buildPerfectPrototypeSupportAtlasPrethresholdCellOption = ({
  dataset,
  cellCandidate,
} = {}) => {
  const supportEvaluations = (dataset?.supportCaseViews ?? []).map((row) =>
    row?.atlasMetricsByCell?.[cellCandidate?.cellId],
  )
  const positiveEvaluations = (Array.isArray(cellCandidate?.positiveRows) ? cellCandidate.positiveRows : []).map(
    (row) => row?.atlasMetricsByCell?.[cellCandidate?.cellId],
  )
  const positiveRadiusBases = positiveEvaluations
    .map((entry) => entry?.positiveKDistance ?? entry?.posDistance)
    .filter(Number.isFinite)
  const supportRadiusBases = supportEvaluations
    .map((entry) => entry?.positiveKDistance ?? entry?.posDistance)
    .filter(Number.isFinite)
  const supportMargins = supportEvaluations.map((entry) => entry?.margin).filter(Number.isFinite)
  const supportScores = supportEvaluations.map((entry) => entry?.score).filter(Number.isFinite)
  const positiveRadius = Math.max(
    quantile(positiveRadiusBases, 0.98) ?? 0,
    supportRadiusBases.length > 0 ? Math.max(...supportRadiusBases) : 0,
    positiveRadiusBases.length > 0 ? Math.max(...positiveRadiusBases) : 0,
  ) + 0.05
  return {
    cellId: cellCandidate?.cellId ?? null,
    positiveRadius,
    minPositiveVotes: 1,
    vetoMargin: Math.min(0, supportMargins.length > 0 ? Math.min(...supportMargins) : 0),
    scoreThreshold: Math.min(-0.5, supportScores.length > 0 ? Math.min(...supportScores) : -0.5),
  }
}

export const buildPerfectPrototypeSupportAtlasBoundaryVetoOptions = ({
  selectedNegatives = [],
  supportEvaluations = [],
  baseOption = {},
} = {}) => {
  const negativeMargins = (Array.isArray(selectedNegatives) ? selectedNegatives : [])
    .map((entry) => entry?.margin)
    .filter(Number.isFinite)
  const negativeScores = (Array.isArray(selectedNegatives) ? selectedNegatives : [])
    .map((entry) => entry?.score)
    .filter(Number.isFinite)
  const negativePosDistances = (Array.isArray(selectedNegatives) ? selectedNegatives : [])
    .map((entry) => entry?.positiveKDistance ?? entry?.posDistance)
    .filter(Number.isFinite)
  const supportMargins = (Array.isArray(supportEvaluations) ? supportEvaluations : [])
    .map((entry) => entry?.margin)
    .filter(Number.isFinite)
  const supportScores = (Array.isArray(supportEvaluations) ? supportEvaluations : [])
    .map((entry) => entry?.score)
    .filter(Number.isFinite)
  const supportRadiusBases = (Array.isArray(supportEvaluations) ? supportEvaluations : [])
    .map((entry) => entry?.positiveKDistance ?? entry?.posDistance)
    .filter(Number.isFinite)

  const supportMarginCap = supportMargins.length > 0 ? Math.min(...supportMargins) : null
  const supportScoreCap = supportScores.length > 0 ? Math.min(...supportScores) : null
  const supportRadiusFloor = supportRadiusBases.length > 0 ? Math.max(...supportRadiusBases) : null

  const vetoMargins = uniqueNumbers([
    baseOption?.vetoMargin,
    negativeMargins.length > 0 ? Math.max(...negativeMargins) + 0.01 : null,
    negativeMargins.length > 0 ? quantile(negativeMargins, 0.9) : null,
  ]).filter((value) => !Number.isFinite(supportMarginCap) || value <= supportMarginCap)

  const scoreThresholds = uniqueNumbers([
    baseOption?.scoreThreshold,
    negativeScores.length > 0 ? Math.max(...negativeScores) + 0.01 : null,
    negativeScores.length > 0 ? quantile(negativeScores, 0.9) : null,
  ]).filter((value) => !Number.isFinite(supportScoreCap) || value <= supportScoreCap)

  const positiveRadii = uniqueNumbers([
    baseOption?.positiveRadius,
    negativePosDistances.length > 0 ? quantile(negativePosDistances, 0.5) : null,
    supportRadiusFloor,
  ]).filter((value) => !Number.isFinite(supportRadiusFloor) || value >= supportRadiusFloor)

  const options = []
  for (const positiveRadius of positiveRadii) {
    for (const vetoMargin of vetoMargins) {
      for (const scoreThreshold of scoreThresholds) {
        options.push({
          ...baseOption,
          positiveRadius,
          vetoMargin,
          scoreThreshold,
        })
      }
    }
  }
  return options
}
