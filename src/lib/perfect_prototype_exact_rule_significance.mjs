const toInteger = (value) => {
  const numeric = Math.floor(Number(value))
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0
}

const clamp01 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(0, Math.min(1, numeric))
}

const LOG_FACTORIALS = [0]

const logFactorial = (n) => {
  const target = Math.max(0, toInteger(n))
  for (let index = LOG_FACTORIALS.length; index <= target; index += 1) {
    LOG_FACTORIALS[index] = Number(LOG_FACTORIALS[index - 1] ?? 0) + Math.log(index)
  }
  return Number(LOG_FACTORIALS[target] ?? 0)
}

const logChoose = (n, k) => {
  const nn = toInteger(n)
  const kk = toInteger(k)
  if (kk < 0 || kk > nn) return Number.NEGATIVE_INFINITY
  return logFactorial(nn) - logFactorial(kk) - logFactorial(nn - kk)
}

const hypergeometricProbability = ({
  successesInPopulation,
  failuresInPopulation,
  drawCount,
  observedSuccesses,
} = {}) => {
  const K = toInteger(successesInPopulation)
  const NMinusK = toInteger(failuresInPopulation)
  const n = toInteger(drawCount)
  const x = toInteger(observedSuccesses)
  const N = K + NMinusK
  if (N <= 0 || n <= 0) return 1
  if (x > K || n - x > NMinusK) return 0
  const logProb = logChoose(K, x) + logChoose(NMinusK, n - x) - logChoose(N, n)
  return Number.isFinite(logProb) ? Math.exp(logProb) : 0
}

export const computePerfectPrototypeOneSidedFisherPValue = ({
  matchedPositiveCount = 0,
  matchedNegativeCount = 0,
  totalPositiveCount = 0,
  totalNegativeCount = 0,
} = {}) => {
  const a = toInteger(matchedPositiveCount)
  const b = toInteger(matchedNegativeCount)
  const totalPos = toInteger(totalPositiveCount)
  const totalNeg = toInteger(totalNegativeCount)
  const drawCount = a + b
  if (drawCount <= 0 || totalPos + totalNeg <= 0) return 1
  const maxSuccesses = Math.min(totalPos, drawCount)
  let pValue = 0
  for (let observed = a; observed <= maxSuccesses; observed += 1) {
    pValue += hypergeometricProbability({
      successesInPopulation: totalPos,
      failuresInPopulation: totalNeg,
      drawCount,
      observedSuccesses: observed,
    })
  }
  return clamp01(pValue)
}

export const attachPerfectPrototypeBhFdrQValues = (candidates = []) => {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({
      ...candidate,
      __sourceIndex: index,
      pValue: clamp01(candidate?.pValue),
    }))
    .sort(
      (left, right) =>
        Number(left?.pValue ?? 1) - Number(right?.pValue ?? 1) ||
        String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? "")),
    )
  let runningMin = 1
  for (let index = ranked.length - 1; index >= 0; index -= 1) {
    const entry = ranked[index]
    const adjusted = clamp01((Number(entry?.pValue ?? 1) * ranked.length) / Math.max(1, index + 1))
    runningMin = Math.min(runningMin, adjusted)
    entry.qValue = runningMin
  }
  return ranked
    .sort((left, right) => Number(left.__sourceIndex ?? 0) - Number(right.__sourceIndex ?? 0))
    .map(({ __sourceIndex, ...entry }) => entry)
}

export const buildPerfectPrototypeExactRuleSignificance = ({
  candidates = [],
  totalPositiveCount = 0,
  totalNegativeCount = 0,
  qValueThreshold = 0.05,
} = {}) => {
  const withPValues = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    ...candidate,
    pValue: computePerfectPrototypeOneSidedFisherPValue({
      matchedPositiveCount: Number(candidate?.trainSummary?.positiveRowCount ?? 0),
      matchedNegativeCount: Number(candidate?.trainSummary?.negativeRowCount ?? 0),
      totalPositiveCount,
      totalNegativeCount,
    }),
  }))
  const withQValues = attachPerfectPrototypeBhFdrQValues(withPValues).map((candidate) => ({
    ...candidate,
    significanceQualified: Number(candidate?.qValue ?? 1) <= Number(qValueThreshold),
  }))
  return {
    totalPositiveCount: toInteger(totalPositiveCount),
    totalNegativeCount: toInteger(totalNegativeCount),
    candidateCount: withQValues.length,
    significantRuleCount: withQValues.filter((candidate) => candidate?.significanceQualified === true).length,
    candidates: withQValues,
  }
}
