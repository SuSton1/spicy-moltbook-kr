const compareNumbersDesc = (left, right) => Number(right) - Number(left)

const compareNumbersAsc = (left, right) => Number(left) - Number(right)

export const comparePerfectPrototypeChildCandidates = (left, right) => {
  const negativeDropCompare = compareNumbersDesc(
    left?.negativeDrop ?? left?.negativeDropEstimate ?? 0,
    right?.negativeDrop ?? right?.negativeDropEstimate ?? 0,
  )
  if (negativeDropCompare !== 0) return negativeDropCompare
  const precisionCompare = compareNumbersDesc(
    left?.precisionUpperBound ?? left?.precisionUpperBoundEstimate ?? 0,
    right?.precisionUpperBound ?? right?.precisionUpperBoundEstimate ?? 0,
  )
  if (precisionCompare !== 0) return precisionCompare
  const positiveLossCompare = compareNumbersAsc(
    left?.positiveLoss ?? 0,
    right?.positiveLoss ?? 0,
  )
  if (positiveLossCompare !== 0) return positiveLossCompare
  const positiveCountCompare = compareNumbersDesc(
    left?.positiveCount ?? left?.nextPositiveCount ?? 0,
    right?.positiveCount ?? right?.nextPositiveCount ?? 0,
  )
  if (positiveCountCompare !== 0) return positiveCountCompare
  return compareNumbersAsc(left?.tokenIndex ?? 0, right?.tokenIndex ?? 0)
}

export const orderPerfectPrototypeChildCandidates = ({ candidates }) =>
  (Array.isArray(candidates) ? candidates : []).slice().sort(comparePerfectPrototypeChildCandidates)
