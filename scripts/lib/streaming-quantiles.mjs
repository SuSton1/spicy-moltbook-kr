const toFiniteNumber = (value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "bigint") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === "string" && !value.trim()) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveQuantileIndex = (length, quantile) => {
  if (length <= 0) return 0
  const q = Math.max(0, Math.min(1, quantile))
  return Math.max(0, Math.min(length - 1, Math.floor((length - 1) * q)))
}

export const createP2QuantileEstimator = (quantile) => {
  if (!(quantile > 0 && quantile < 1)) {
    throw new Error(`quantile must be between 0 and 1 (exclusive): ${quantile}`)
  }
  return {
    quantile,
    count: 0,
    seed: [],
    heights: null,
    positions: null,
    desired: null,
    increments: [0, quantile / 2, quantile, (1 + quantile) / 2, 1],
  }
}

export const addP2QuantileSample = (estimator, value) => {
  const sample = toFiniteNumber(value)
  if (sample === null) {
    return false
  }

  if (estimator.count < 5) {
    estimator.seed.push(sample)
    estimator.count += 1
    if (estimator.count === 5) {
      const sorted = [...estimator.seed].sort((a, b) => a - b)
      estimator.heights = sorted
      estimator.positions = [1, 2, 3, 4, 5]
      estimator.desired = [
        1,
        1 + 2 * estimator.quantile,
        1 + 4 * estimator.quantile,
        3 + 2 * estimator.quantile,
        5,
      ]
    }
    return true
  }

  estimator.count += 1
  const heights = estimator.heights
  const positions = estimator.positions
  const desired = estimator.desired
  const increments = estimator.increments

  let bucket = 0
  if (sample < heights[0]) {
    heights[0] = sample
    bucket = 0
  } else if (sample >= heights[4]) {
    heights[4] = sample
    bucket = 3
  } else {
    while (bucket < 3 && sample >= heights[bucket + 1]) {
      bucket += 1
    }
  }

  for (let idx = bucket + 1; idx <= 4; idx += 1) {
    positions[idx] += 1
  }
  for (let idx = 0; idx <= 4; idx += 1) {
    desired[idx] += increments[idx]
  }

  for (let idx = 1; idx <= 3; idx += 1) {
    const delta = desired[idx] - positions[idx]
    const canMoveUp = delta >= 1 && positions[idx + 1] - positions[idx] > 1
    const canMoveDown = delta <= -1 && positions[idx - 1] - positions[idx] < -1
    if (!canMoveUp && !canMoveDown) {
      continue
    }

    const direction = delta > 0 ? 1 : -1
    const left = idx - 1
    const right = idx + 1
    const span = positions[right] - positions[left]
    if (span <= 0) {
      continue
    }

    const slopeLeft =
      (positions[idx] - positions[left] + direction) *
      ((heights[right] - heights[idx]) / (positions[right] - positions[idx]))
    const slopeRight =
      (positions[right] - positions[idx] - direction) *
      ((heights[idx] - heights[left]) / (positions[idx] - positions[left]))
    const candidate =
      heights[idx] + (direction / span) * (slopeLeft + slopeRight)

    if (candidate > heights[left] && candidate < heights[right]) {
      heights[idx] = candidate
    } else {
      const linearNeighbor = idx + direction
      const width = positions[linearNeighbor] - positions[idx]
      if (width !== 0) {
        heights[idx] +=
          (direction * (heights[linearNeighbor] - heights[idx])) / width
      }
    }
    positions[idx] += direction
  }

  return true
}

export const readP2QuantileEstimate = (estimator) => {
  if (estimator.count <= 0) {
    return 0
  }
  if (estimator.count <= 5) {
    const sorted = [...estimator.seed].sort((a, b) => a - b)
    const idx = resolveQuantileIndex(sorted.length, estimator.quantile)
    return sorted[idx] ?? 0
  }
  return Number.isFinite(estimator.heights?.[2]) ? estimator.heights[2] : 0
}
