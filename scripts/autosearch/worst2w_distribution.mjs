const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const toFinite = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const RNG_MODULUS = 0x7fffffff
const RNG_MULTIPLIER = 48271

const normalizeRngSeed = (seedInput = 1) => {
  const raw = Number(seedInput)
  if (!Number.isFinite(raw)) return 1
  const normalized = Math.floor(Math.abs(raw)) % (RNG_MODULUS - 1)
  return normalized + 1
}

const createRng = (seedInput = 1) => {
  let state = normalizeRngSeed(seedInput)
  return () => {
    state = (state * RNG_MULTIPLIER) % RNG_MODULUS
    if (state <= 0) {
      state = 1
    }
    return state / RNG_MODULUS
  }
}

const boxMuller = (rng) => {
  let u = 0
  let v = 0
  while (u <= 1e-12) u = rng()
  while (v <= 1e-12) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const normalCdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x >= 0 ? 1 - p : p
}

const binomialCdfExact = (k, n, p) => {
  if (k < 0) return 0
  if (k >= n) return 1
  const q = 1 - p
  if (p <= 0) return 1
  if (p >= 1) return k >= n ? 1 : 0
  let term = Math.pow(q, n)
  let sum = term
  for (let i = 0; i < k; i += 1) {
    term *= ((n - i) / (i + 1)) * (p / q)
    sum += term
    if (!Number.isFinite(sum)) {
      return 1
    }
  }
  return Math.max(0, Math.min(1, sum))
}

const binomialCdf = (k, n, p) => {
  const kk = Math.floor(k)
  const nn = Math.floor(n)
  if (kk < 0) return 0
  if (kk >= nn) return 1
  if (nn <= 2000) {
    return binomialCdfExact(kk, nn, p)
  }
  const mean = nn * p
  const variance = nn * p * (1 - p)
  if (variance <= 0) {
    return kk >= mean ? 1 : 0
  }
  const z = (kk + 0.5 - mean) / Math.sqrt(variance)
  return normalCdf(z)
}

const clopperPearsonLowerBound = ({ successes, trials, alpha }) => {
  const k = clampInt(successes, 0, 0, 1_000_000_000)
  const n = clampInt(trials, 0, 0, 1_000_000_000)
  const a = clampNumber(alpha, 0.05, 1e-6, 0.5)
  if (n <= 0 || k <= 0) return 0
  if (k >= n) {
    return Math.pow(a, 1 / n)
  }
  let lo = 0
  let hi = k / n
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    const cdf = binomialCdf(k - 1, n, mid)
    if (cdf > a) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return Math.max(0, Math.min(1, lo))
}

const resolveQuantileLowerIndex = ({ samples, q, alpha }) => {
  const n = clampInt(samples, 0, 0, 1_000_000_000)
  if (n <= 0) return 0
  const qq = clampNumber(q, 0.05, 0.001, 0.999)
  const a = clampNumber(alpha, 0.05, 1e-6, 0.5)
  const tailTarget = 1 - a
  let lo = 1
  let hi = n
  let best = 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const tail = 1 - binomialCdf(mid - 1, n, qq)
    if (tail >= tailTarget) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const computeWorst2w = (weeklyReturns) => {
  const values = (Array.isArray(weeklyReturns) ? weeklyReturns : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (values.length < 2) return null
  let worst = Number.POSITIVE_INFINITY
  for (let i = 0; i < values.length - 1; i += 1) {
    const avg = (values[i] + values[i + 1]) / 2
    if (avg < worst) worst = avg
  }
  return Number.isFinite(worst) ? worst : null
}

const normalizeWeeklyReturns = (weekSeries) =>
  (Array.isArray(weekSeries) ? weekSeries : [])
    .map((row) => ({
      weekKey: String(row?.weekKey ?? "").trim(),
      weeklyReturnPct: toFinite(row?.weeklyReturnPct, Number.NaN),
    }))
    .filter((row) => Number.isFinite(row.weeklyReturnPct))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
    .map((row) => row.weeklyReturnPct)

const computeVol = (values) => {
  const list = values.filter((value) => Number.isFinite(value))
  if (list.length <= 1) return 0
  const mean = list.reduce((acc, v) => acc + v, 0) / list.length
  const variance =
    list.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (list.length - 1)
  return Math.sqrt(Math.max(0, variance))
}

const detectRegimeShift = ({ values, ratioThreshold = 1.7 }) => {
  const recent = values.slice(-4)
  const prev = values.slice(Math.max(0, values.length - 12), values.length - 4)
  const recentVol = computeVol(recent)
  const prevVol = computeVol(prev)
  if (recentVol <= 0 || prevVol <= 0) {
    return {
      shifted: false,
      ratio: prevVol <= 0 ? 1 : recentVol / Math.max(prevVol, 1e-9),
      recentVol,
      prevVol,
    }
  }
  const ratio = recentVol / prevVol
  return { shifted: ratio >= ratioThreshold, ratio, recentVol, prevVol }
}

const countPositiveSqAutocorr = (values, maxLag = 8) => {
  if (values.length < 4) return 0
  const sq = values.map((v) => v * v)
  const mean = sq.reduce((acc, v) => acc + v, 0) / sq.length
  const denom = sq.reduce((acc, v) => acc + (v - mean) ** 2, 0)
  if (denom <= 0) return 0
  let positive = 0
  for (let lag = 1; lag <= Math.min(maxLag, sq.length - 2); lag += 1) {
    let numer = 0
    for (let i = lag; i < sq.length; i += 1) {
      numer += (sq[i] - mean) * (sq[i - lag] - mean)
    }
    const acf = numer / denom
    if (acf > 0.05) positive += 1
  }
  return positive
}

const resolveBlockLength = ({ values, nRef, regimeShifted }) => {
  if (regimeShifted) {
    return Math.min(3, Math.max(2, Math.floor(nRef / 8) || 2))
  }
  const k = countPositiveSqAutocorr(values, 8)
  return Math.max(2, Math.min(Math.floor(nRef / 2), 2 + k, 6))
}

const stationaryBootstrap = ({ source, size, blockLength, rng }) => {
  const arr = Array.isArray(source) ? source : []
  if (!arr.length || size <= 0) return []
  const out = []
  const pNewBlock = 1 / Math.max(1, blockLength)
  let idx = Math.floor(rng() * arr.length)
  for (let i = 0; i < size; i += 1) {
    if (i > 0 && rng() < pNewBlock) {
      idx = Math.floor(rng() * arr.length)
    } else if (i > 0) {
      idx = (idx + 1) % arr.length
    }
    out.push(arr[idx])
  }
  return out
}

const applyExecutionNoise = ({ basePath, rng, sigma, scenarioBps }) => {
  const base = Array.isArray(basePath) ? basePath : []
  const bps = scenarioBps ?? { base: 0, pessimistic: 6, optimistic: -2 }
  const u = rng()
  const shiftBps = u < 0.2 ? bps.pessimistic : u < 0.9 ? bps.base : bps.optimistic
  const shiftPct = shiftBps / 100
  return base.map((value) => value - shiftPct + boxMuller(rng) * sigma)
}

const runDistribution = ({
  weeklyReturns,
  threshold,
  q,
  p0,
  alpha,
  nRef,
  B,
  M,
  blockLength,
  regimeMixWeight,
  recentSegmentSize,
  sigma,
  seed,
  scenarioBps,
}) => {
  const rng = createRng(seed)
  const values = weeklyReturns
  const past = values.slice(0, Math.max(0, values.length - recentSegmentSize))
  const recent = values.slice(-recentSegmentSize)
  const sourcePast = past.length >= 2 ? past : values
  const sourceRecent = recent.length >= 2 ? recent : values
  const samples = []
  for (let b = 0; b < B; b += 1) {
    const useRecent = rng() < regimeMixWeight
    const source = useRecent ? sourceRecent : sourcePast
    const path = stationaryBootstrap({
      source,
      size: nRef,
      blockLength,
      rng,
    })
    for (let m = 0; m < M; m += 1) {
      const realized = applyExecutionNoise({
        basePath: path,
        rng,
        sigma,
        scenarioBps,
      })
      const w = computeWorst2w(realized)
      if (Number.isFinite(w)) {
        samples.push(w)
      }
    }
  }
  samples.sort((a, b) => a - b)
  const n = samples.length
  const passCount = samples.reduce((acc, value) => acc + (value >= threshold ? 1 : 0), 0)
  const passProb = n > 0 ? passCount / n : 0
  const passProbLower = clopperPearsonLowerBound({
    successes: passCount,
    trials: n,
    alpha,
  })
  const lIndex = resolveQuantileLowerIndex({ samples: n, q, alpha })
  const lcb = n > 0 ? samples[Math.max(0, Math.min(n - 1, lIndex - 1))] : null
  const pass = passProbLower >= p0 && Number(lcb) >= threshold
  const reasons = []
  if (passProbLower < p0) {
    reasons.push("WORST2W_PLOWER_BELOW_P0")
  }
  if (!(Number(lcb) >= threshold)) {
    reasons.push("WORST2W_LCB_BELOW_THRESHOLD")
  }
  return {
    pass,
    reason: reasons[0] ?? null,
    reasons,
    samples,
    sampleCount: n,
    passCount,
    passProb,
    passProbLower,
    lcb,
    lcbQuantile: q,
  }
}

export const evaluateWorst2wDistribution = ({
  weekSeries,
  minWorst2wAvgPct = -1.5,
  config = {},
}) => {
  const weeklyReturns = normalizeWeeklyReturns(weekSeries)
  const enabled = Boolean(config?.enabled)
  const threshold = clampNumber(minWorst2wAvgPct, -1.5, -100, 100)
  if (!enabled) {
    return {
      enabled: false,
      pass: true,
      reason: null,
      reasons: [],
      passProb: null,
      passProbLower: null,
      lcb: null,
      lcbQuantile: null,
      sampleCount: 0,
      passCount: 0,
      sequentialEscalated: false,
      stage: "disabled",
    }
  }
  const nWeeks = weeklyReturns.length
  if (nWeeks < 2) {
    return {
      enabled: true,
      pass: false,
      reason: "WORST2W_INSUFFICIENT_WEEKS",
      reasons: ["WORST2W_INSUFFICIENT_WEEKS"],
      passProb: null,
      passProbLower: 0,
      lcb: null,
      lcbQuantile: null,
      sampleCount: 0,
      passCount: 0,
      sequentialEscalated: false,
      stage: "insufficient",
    }
  }

  const alpha = clampNumber(config.alpha, 0.05, 1e-6, 0.5)
  const p0 = clampNumber(config.p0, 0.95, 0.5, 0.9999)
  const q = clampNumber(config.lcbQuantile, 1 - p0, 0.01, 0.5)
  const nRef = clampInt(config.nRef, nWeeks, 2, 104)
  const cheapB = clampInt(config.cheapB, 160, 20, 10_000)
  const cheapM = clampInt(config.cheapM, 8, 1, 256)
  const fullB = clampInt(config.fullB, 800, cheapB, 20_000)
  const fullM = clampInt(config.fullM, 20, cheapM, 512)
  const sequential = config.sequential !== false
  const passProbMargin = clampNumber(config.passProbMargin, 0.02, 0.001, 0.2)
  const lcbMargin = clampNumber(config.lcbMarginPct, 0.3, 0.01, 5)
  const ratioThreshold = clampNumber(config.regimeShiftRatio, 1.7, 1.1, 5)
  const regime = detectRegimeShift({
    values: weeklyReturns,
    ratioThreshold,
  })
  const blockLength = resolveBlockLength({
    values: weeklyReturns,
    nRef,
    regimeShifted: regime.shifted,
  })
  const regimeMixWeight = clampNumber(
    config.regimeMixWeight,
    regime.shifted ? 0.9 : 0.7,
    0.5,
    1,
  )
  const recentSegmentSize = clampInt(
    config.recentSegmentSize,
    Math.max(6, Math.floor(nWeeks / 2)),
    4,
    Math.max(4, nWeeks),
  )
  const sigma = clampNumber(
    config.executionSigmaPct,
    Math.max(0.03, Math.min(0.8, computeVol(weeklyReturns) * 0.15)),
    0,
    5,
  )
  const scenarioBps = {
    base: clampNumber(config.baseBps, 0, -100, 100),
    pessimistic: clampNumber(config.pessimisticBps, 6, -100, 200),
    optimistic: clampNumber(config.optimisticBps, -2, -200, 100),
  }
  const baseSeed = clampInt(config.seed, 17, 1, 0x7fffffff)
  const cheap = runDistribution({
    weeklyReturns,
    threshold,
    q,
    p0,
    alpha,
    nRef,
    B: cheapB,
    M: cheapM,
    blockLength,
    regimeMixWeight,
    recentSegmentSize,
    sigma,
    seed: baseSeed,
    scenarioBps,
  })

  const nearBoundary =
    Math.abs(cheap.passProbLower - p0) <= passProbMargin ||
    Math.abs(Number(cheap.lcb ?? Number.NaN) - threshold) <= lcbMargin
  if (!sequential || !nearBoundary) {
    return {
      enabled: true,
      pass: cheap.pass,
      reason: cheap.reason,
      reasons: cheap.reasons,
      passProb: cheap.passProb,
      passProbLower: cheap.passProbLower,
      lcb: cheap.lcb,
      lcbQuantile: cheap.lcbQuantile,
      sampleCount: cheap.sampleCount,
      passCount: cheap.passCount,
      sequentialEscalated: false,
      stage: "cheap",
      diagnostics: {
        nWeeks,
        nRef,
        alpha,
        p0,
        q,
        blockLength,
        regimeShifted: regime.shifted,
        regimeRatio: regime.ratio,
        regimeMixWeight,
      },
    }
  }

  const full = runDistribution({
    weeklyReturns,
    threshold,
    q,
    p0,
    alpha,
    nRef,
    B: fullB,
    M: fullM,
    blockLength,
    regimeMixWeight,
    recentSegmentSize,
    sigma,
    seed: baseSeed + 97,
    scenarioBps,
  })

  return {
    enabled: true,
    pass: full.pass,
    reason: full.reason,
    reasons: full.reasons,
    passProb: full.passProb,
    passProbLower: full.passProbLower,
    lcb: full.lcb,
    lcbQuantile: full.lcbQuantile,
    sampleCount: full.sampleCount,
    passCount: full.passCount,
    sequentialEscalated: true,
    stage: "full",
    diagnostics: {
      nWeeks,
      nRef,
      alpha,
      p0,
      q,
      blockLength,
      regimeShifted: regime.shifted,
      regimeRatio: regime.ratio,
      regimeMixWeight,
      cheap: {
        passProb: cheap.passProb,
        passProbLower: cheap.passProbLower,
        lcb: cheap.lcb,
        sampleCount: cheap.sampleCount,
      },
      full: {
        passProb: full.passProb,
        passProbLower: full.passProbLower,
        lcb: full.lcb,
        sampleCount: full.sampleCount,
      },
    },
  }
}
