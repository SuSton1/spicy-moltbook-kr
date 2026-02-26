const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const safeNumber = (value, fallback = null) => {
  const n = toNumber(value)
  return n === null ? fallback : n
}

const sanitizeNumbers = (values) =>
  (values ?? []).map((value) => toNumber(value)).filter((v) => v !== null)

export const wilsonLowerBound = (k, n, z = 1.281551565545) => {
  const total = toNumber(n)
  if (!total || total <= 0) {
    return null
  }
  const successesRaw = toNumber(k) ?? 0
  const successes = Math.max(0, Math.min(successesRaw, total))
  const z2 = z * z
  const phat = successes / total
  const denom = 1 + z2 / total
  const center = phat + z2 / (2 * total)
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total)
  return (center - margin) / denom
}

export const meanLowerBound = (values, z = 1.281551565545) => {
  const nums = sanitizeNumbers(values)
  const n = nums.length
  if (!n) {
    return null
  }
  const mean = nums.reduce((sum, value) => sum + value, 0) / n
  if (n === 1) {
    return mean
  }
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  const se = std / Math.sqrt(n)
  return mean - z * se
}
