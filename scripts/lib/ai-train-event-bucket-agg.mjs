const INITIAL_MARKER_POSITIONS = [1, 2, 3, 4, 5]
const DESIRED_MARKER_INCREMENTS = [0, 0.25, 0.5, 0.75, 1]

const toNumber = (value) => {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const sortNumericAsc = (a, b) => a - b

const medianFromSorted = (values) => {
  if (!values.length) return null
  const mid = Math.floor(values.length / 2)
  if (values.length % 2 === 1) {
    return values[mid]
  }
  return (values[mid - 1] + values[mid]) / 2
}

export const createMedianEstimator = () => ({
  count: 0,
  initial: [],
  initialized: false,
  q: [0, 0, 0, 0, 0],
  n: [...INITIAL_MARKER_POSITIONS],
  np: [1, 2, 3, 4, 5],
})

const initializeEstimator = (estimator) => {
  const sorted = [...estimator.initial].sort(sortNumericAsc)
  estimator.q = sorted
  estimator.n = [...INITIAL_MARKER_POSITIONS]
  estimator.np = [
    1,
    1 + 2 * DESIRED_MARKER_INCREMENTS[2],
    1 + 4 * DESIRED_MARKER_INCREMENTS[2],
    3 + 2 * DESIRED_MARKER_INCREMENTS[2],
    5,
  ]
  estimator.initialized = true
}

const linearAdjust = (q, n, i, direction) => {
  const src = i + direction
  const denominator = n[src] - n[i]
  if (denominator === 0) {
    return q[i]
  }
  return q[i] + (direction * (q[src] - q[i])) / denominator
}

const parabolicAdjust = (q, n, i, direction) => {
  const denominator = n[i + 1] - n[i - 1]
  if (denominator === 0) {
    return q[i]
  }
  const upperDenominator = n[i + 1] - n[i]
  const lowerDenominator = n[i] - n[i - 1]
  if (upperDenominator === 0 || lowerDenominator === 0) {
    return q[i]
  }
  const termA =
    ((n[i] - n[i - 1] + direction) * (q[i + 1] - q[i])) / upperDenominator
  const termB =
    ((n[i + 1] - n[i] - direction) * (q[i] - q[i - 1])) / lowerDenominator
  return q[i] + (direction * (termA + termB)) / denominator
}

export const addMedianSample = (estimator, value) => {
  const x = toNumber(value)
  if (x === null) return

  estimator.count += 1

  if (!estimator.initialized) {
    estimator.initial.push(x)
    if (estimator.initial.length === 5) {
      initializeEstimator(estimator)
    }
    return
  }

  const { q, n, np } = estimator
  let bucket = 0
  if (x < q[0]) {
    q[0] = x
    bucket = 0
  } else if (x < q[1]) {
    bucket = 0
  } else if (x < q[2]) {
    bucket = 1
  } else if (x < q[3]) {
    bucket = 2
  } else if (x <= q[4]) {
    bucket = 3
  } else {
    q[4] = x
    bucket = 3
  }

  for (let i = bucket + 1; i < 5; i += 1) {
    n[i] += 1
  }
  for (let i = 0; i < 5; i += 1) {
    np[i] += DESIRED_MARKER_INCREMENTS[i]
  }

  for (let i = 1; i <= 3; i += 1) {
    const delta = np[i] - n[i]
    const canMoveForward = delta >= 1 && n[i + 1] - n[i] > 1
    const canMoveBackward = delta <= -1 && n[i - 1] - n[i] < -1
    if (!canMoveForward && !canMoveBackward) continue

    const direction = delta > 0 ? 1 : -1
    const candidate = parabolicAdjust(q, n, i, direction)
    const bounded = q[i - 1] < candidate && candidate < q[i + 1]
    q[i] = bounded ? candidate : linearAdjust(q, n, i, direction)
    n[i] += direction
  }
}

export const readMedianEstimate = (estimator) => {
  if (estimator.count === 0) return null
  if (!estimator.initialized) {
    return medianFromSorted([...estimator.initial].sort(sortNumericAsc))
  }
  return toNumber(estimator.q[2])
}

export const createEventBucketAgg = () => ({
  n: 0,
  fwdRetCount: 0,
  fwdRetSum: 0,
  fwdRetMedianEstimator: createMedianEstimator(),
  maxUpCount: 0,
  maxUpSum: 0,
  maxDownCount: 0,
  maxDownSum: 0,
  targetCount: 0,
  stopCount: 0,
  neutralCount: 0,
  tttCount: 0,
  tttSum: 0,
})

export const applyImpactToEventBucketAgg = (agg, impact) => {
  agg.n += 1

  const fwdRet = toNumber(impact?.fwdRetPct)
  if (fwdRet !== null) {
    agg.fwdRetCount += 1
    agg.fwdRetSum += fwdRet
    addMedianSample(agg.fwdRetMedianEstimator, fwdRet)
  }

  const maxUp = toNumber(impact?.fwdMaxUpPct)
  if (maxUp !== null) {
    agg.maxUpCount += 1
    agg.maxUpSum += maxUp
  }

  const maxDown = toNumber(impact?.fwdMaxDownPct)
  if (maxDown !== null) {
    agg.maxDownCount += 1
    agg.maxDownSum += maxDown
  }

  const outcome = String(impact?.outcome ?? "neutral")
  if (outcome === "target") {
    agg.targetCount += 1
  } else if (outcome === "stop") {
    agg.stopCount += 1
  } else {
    agg.neutralCount += 1
  }

  const ttt = toNumber(impact?.tttDays)
  if (ttt !== null) {
    agg.tttCount += 1
    agg.tttSum += ttt
  }
}

export const finalizeEventBucketAgg = (agg) => {
  const total = Math.max(0, Math.floor(agg.n))
  const meanFwdRetPct =
    agg.fwdRetCount > 0 ? agg.fwdRetSum / agg.fwdRetCount : 0
  const medianFwdRetPct = readMedianEstimate(agg.fwdRetMedianEstimator) ?? 0
  const meanMaxUpPct = agg.maxUpCount > 0 ? agg.maxUpSum / agg.maxUpCount : null
  const meanMaxDownPct =
    agg.maxDownCount > 0 ? agg.maxDownSum / agg.maxDownCount : null
  const pTarget = total > 0 ? agg.targetCount / total : 0
  const pStop = total > 0 ? agg.stopCount / total : 0
  const pNeutral = total > 0 ? agg.neutralCount / total : 0
  const meanTTT = agg.tttCount > 0 ? agg.tttSum / agg.tttCount : null

  return {
    n: total,
    meanFwdRetPct,
    medianFwdRetPct,
    meanMaxUpPct,
    meanMaxDownPct,
    pTarget,
    pStop,
    pNeutral,
    meanTTT,
  }
}
