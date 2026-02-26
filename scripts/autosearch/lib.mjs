import { buildWeeklyMetrics } from "../lib/backtest.mjs"
import { evaluateWorst2wDistribution } from "./worst2w_distribution.mjs"

const hashSeed = (text) => {
  let hash = 2166136261
  const value = String(text ?? "")
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const buildRng = (seed) => {
  let state = hashSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const toFiniteNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const readEnvNumber = (env, keys, fallback) => {
  for (const key of keys ?? []) {
    const raw = env?.[key]
    if (raw === undefined || raw === null || raw === "") {
      continue
    }
    const parsed = toFiniteNumber(raw)
    if (parsed !== null) {
      return parsed
    }
  }
  return fallback
}

export const resolveRampCostModel = (env = process.env) => {
  const feeRateOneWay = Math.max(
    0,
    readEnvNumber(env, ["RAMP_FEE_RATE", "GOLIVE_FEE_RATE"], 0.00015),
  )
  const defaultOneWayFeeBps = feeRateOneWay * 10_000
  const entryFeeBps = Math.max(
    0,
    readEnvNumber(
      env,
      ["RAMP_ENTRY_FEE_BPS", "GOLIVE_ENTRY_FEE_BPS"],
      defaultOneWayFeeBps,
    ),
  )
  const exitFeeBps = Math.max(
    0,
    readEnvNumber(
      env,
      ["RAMP_EXIT_FEE_BPS", "GOLIVE_EXIT_FEE_BPS"],
      defaultOneWayFeeBps,
    ),
  )
  const taxBps = Math.max(
    0,
    readEnvNumber(env, ["RAMP_TAX_BPS", "GOLIVE_TAX_BPS"], 0),
  )
  const slippageBps = Math.max(
    0,
    readEnvNumber(env, ["RAMP_SLIPPAGE_BPS", "GOLIVE_SLIPPAGE_BPS"], 5),
  )
  return {
    entryFeeBps,
    exitFeeBps,
    taxBps,
    slippageBps,
  }
}

export const hashToVersion = (label) => {
  const hash = hashSeed(label)
  return Math.max(1, Math.floor(hash % 1_000_000_000))
}

const resolveMaxTargetPct = ({
  weekSeries,
  targetStart = 5,
  targetStep = 1,
  minWeeksGE = 10,
}) => {
  let target = Number(targetStart ?? 5) || 5
  let lastPassed = null
  let lastCount = 0
  while (true) {
    const metrics = buildWeeklyMetrics({ weekSeries, targetPct: target })
    const countWeeksGE = Number(metrics.countWeeksGE ?? 0) || 0
    if (countWeeksGE >= minWeeksGE) {
      lastPassed = target
      lastCount = countWeeksGE
      target += targetStep
      continue
    }
    break
  }
  return { maxTargetPct: lastPassed, countWeeksGE: lastCount }
}

const evaluateWorst2wGate = ({ weekSeries, minWorst2wAvgPct = -1.5 }) => {
  const threshold = Number.isFinite(Number(minWorst2wAvgPct))
    ? Number(minWorst2wAvgPct)
    : -1.5
  const normalized = (Array.isArray(weekSeries) ? weekSeries : [])
    .map((row, idx) => ({
      weekKey:
        String(row?.weekKey ?? "")
          .trim()
          .toUpperCase() || `W${String(idx + 1).padStart(4, "0")}`,
      weeklyReturnPct: Number(row?.weeklyReturnPct ?? 0) || 0,
      _idx: idx,
    }))
    .sort((a, b) => {
      const cmp = a.weekKey.localeCompare(b.weekKey)
      return cmp !== 0 ? cmp : a._idx - b._idx
    })
  if (normalized.length < 2) {
    return {
      pass: false,
      reason: "WORST2W_INSUFFICIENT_WEEKS",
      threshold,
      weeksEvaluated: normalized.length,
      worst2wAvgPct: null,
      worstWindowStart: null,
      worstWindowEnd: null,
    }
  }
  let worst2wAvgPct = Number.POSITIVE_INFINITY
  let worstWindowStart = null
  let worstWindowEnd = null
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const current = normalized[i]
    const next = normalized[i + 1]
    const avg = (current.weeklyReturnPct + next.weeklyReturnPct) / 2
    if (avg < worst2wAvgPct) {
      worst2wAvgPct = avg
      worstWindowStart = current.weekKey
      worstWindowEnd = next.weekKey
    }
  }
  const pass = worst2wAvgPct >= threshold
  return {
    pass,
    reason: pass ? null : "WORST2W_BELOW_THRESHOLD",
    threshold,
    weeksEvaluated: normalized.length,
    worst2wAvgPct,
    worstWindowStart,
    worstWindowEnd,
  }
}

export const evaluateWeeklySummary = ({
  weekSeries,
  targetPct,
  targetStart = 5,
  minWeeksGE = 10,
  bigUpWeeksCount24,
  requiredBigUpWeeks = 10,
  minWorst2wAvgPct = -1.5,
  noFillRate = 0,
  noFillRateMax = 0.35,
  emptyWeekAllowed = 0,
  useRamp = false,
  worst2wDistributionConfig = null,
}) => {
  const metrics = buildWeeklyMetrics({
    weekSeries,
    targetPct,
  })
  const countWeeksGE = Number(metrics.countWeeksGE ?? 0) || 0
  const bigUpCount = Number(bigUpWeeksCount24 ?? 0) || 0
  const emptyWeeksCount = Number(metrics.emptyWeeksCount ?? 0) || 0
  const worst2wGateBase = evaluateWorst2wGate({
    weekSeries,
    minWorst2wAvgPct,
  })
  let worst2wGate = { ...worst2wGateBase }
  const shouldRunDist =
    Boolean(worst2wDistributionConfig?.enabled) &&
    (worst2wGateBase.pass ||
      worst2wDistributionConfig?.runWhenClassicFail === true)
  const worst2wDist = shouldRunDist
    ? evaluateWorst2wDistribution({
        weekSeries,
        minWorst2wAvgPct,
        config: worst2wDistributionConfig,
      })
    : evaluateWorst2wDistribution({
        weekSeries,
        minWorst2wAvgPct,
        config: { enabled: false },
      })
  if (worst2wDist.enabled && !worst2wDist.pass) {
    worst2wGate = {
      ...worst2wGate,
      pass: false,
      reason: worst2wDist.reason ?? worst2wGate.reason,
      reasons: worst2wDist.reasons ?? [],
    }
  }
  const ramp = resolveMaxTargetPct({
    weekSeries,
    targetStart,
    minWeeksGE,
  })
  const passAtTarget =
    bigUpCount >= requiredBigUpWeeks &&
    countWeeksGE >= minWeeksGE &&
    worst2wGate.pass &&
    noFillRate <= noFillRateMax &&
    emptyWeeksCount <= emptyWeekAllowed
  const passRamp =
    bigUpCount >= requiredBigUpWeeks &&
    worst2wGate.pass &&
    noFillRate <= noFillRateMax &&
    emptyWeeksCount <= emptyWeekAllowed &&
    Number(ramp.maxTargetPct ?? 0) >= targetStart
  return {
    metrics: {
      ...metrics,
      bigUpWeeksCount24: bigUpCount,
      noFillRate,
      maxTargetPct: ramp.maxTargetPct,
      worst2wAvgPct: worst2wGate.worst2wAvgPct,
      worst2wWindowStart: worst2wGate.worstWindowStart,
      worst2wWindowEnd: worst2wGate.worstWindowEnd,
      worst2wGatePass: worst2wGate.pass,
      worst2wGateReason: worst2wGate.reason,
      minWorst2wAvgPct: worst2wGate.threshold,
      worst2wPassProb: worst2wDist.passProb,
      worst2wPassProbLower: worst2wDist.passProbLower,
      worst2wLcb: worst2wDist.lcb,
      worst2wLcbQuantile: worst2wDist.lcbQuantile,
      worst2wDistEnabled: worst2wDist.enabled,
      worst2wDistSampleCount: worst2wDist.sampleCount,
      worst2wDistPass: worst2wDist.pass,
      worst2wDistReason: worst2wDist.reason,
      worst2wDistStage: worst2wDist.stage,
      worst2wDistSequentialEscalated: worst2wDist.sequentialEscalated,
      worst2wDistDiagnostics: worst2wDist.diagnostics ?? null,
    },
    worst2wGate,
    worst2wDist,
    pass: useRamp ? passRamp : passAtTarget,
    passAtTarget,
    passRamp,
  }
}

export const updateBestState = ({ best, candidate, eps }) => {
  if (!best) {
    return { best: candidate, improved: true }
  }
  const overrides = eps ?? {}
  const epsCountWeeksGE = Number.isFinite(Number(overrides.countWeeksGE))
    ? Math.max(1, Math.floor(Number(overrides.countWeeksGE)))
    : 1
  const epsMinWeeklyPct = Number.isFinite(Number(overrides.minWeeklyPct))
    ? Math.max(0, Number(overrides.minWeeklyPct))
    : 0.1
  const epsBigUpWeeks = Number.isFinite(Number(overrides.bigUpWeeksCount24))
    ? Math.max(1, Math.floor(Number(overrides.bigUpWeeksCount24)))
    : 1
  const epsTotalWeeklySumPct = Number.isFinite(
    Number(overrides.totalWeeklySumPct),
  )
    ? Math.max(0, Number(overrides.totalWeeklySumPct))
    : 5.0
  const maxRegressCountWeeksGE = Number.isFinite(
    Number(overrides.maxRegressCountWeeksGE),
  )
    ? Math.max(0, Math.floor(Number(overrides.maxRegressCountWeeksGE)))
    : 1
  const maxRegressMinWeeklyPct = Number.isFinite(
    Number(overrides.maxRegressMinWeeklyPct),
  )
    ? Math.max(0, Number(overrides.maxRegressMinWeeklyPct))
    : 0.75
  const maxRegressBigUpWeeks = Number.isFinite(
    Number(overrides.maxRegressBigUpWeeksCount24),
  )
    ? Math.max(0, Math.floor(Number(overrides.maxRegressBigUpWeeksCount24)))
    : 1
  const maxRegressTotalWeeklySumPct = Number.isFinite(
    Number(overrides.maxRegressTotalWeeklySumPct),
  )
    ? Math.max(0, Number(overrides.maxRegressTotalWeeklySumPct))
    : 20.0
  const epsStopLikePct = Number.isFinite(Number(overrides.stopLikePct))
    ? Math.max(0, Number(overrides.stopLikePct))
    : 0.02
  const maxRegressStopLikePct = Number.isFinite(
    Number(overrides.maxRegressStopLikePct),
  )
    ? Math.max(0, Number(overrides.maxRegressStopLikePct))
    : 0.08

  const bestCount = Number(best.countWeeksGE ?? 0) || 0
  const bestMin = Number(best.minWeeklyPct ?? 0) || 0
  const bestBigUp = Number(best.bigUpWeeksCount24 ?? 0) || 0
  const bestSum = Number(best.totalWeeklySumPct ?? 0) || 0
  const bestStopLike = Number(best.stopLikePct ?? 1)
  const safeBestStopLike = Number.isFinite(bestStopLike) ? bestStopLike : 1

  const candCount = Number(candidate.countWeeksGE ?? 0) || 0
  const candMin = Number(candidate.minWeeklyPct ?? 0) || 0
  const candBigUp = Number(candidate.bigUpWeeksCount24 ?? 0) || 0
  const candSum = Number(candidate.totalWeeklySumPct ?? 0) || 0
  const candStopLike = Number(candidate.stopLikePct ?? 1)
  const safeCandStopLike = Number.isFinite(candStopLike) ? candStopLike : 1

  const improvedCandidate =
    candCount >= bestCount + epsCountWeeksGE ||
    candMin >= bestMin + epsMinWeeklyPct ||
    candBigUp >= bestBigUp + epsBigUpWeeks ||
    candSum >= bestSum + epsTotalWeeklySumPct ||
    safeCandStopLike <= safeBestStopLike - epsStopLikePct
  const regressedTooFar =
    candCount + maxRegressCountWeeksGE < bestCount ||
    candMin + maxRegressMinWeeklyPct < bestMin ||
    candBigUp + maxRegressBigUpWeeks < bestBigUp ||
    candSum + maxRegressTotalWeeklySumPct < bestSum ||
    safeCandStopLike > safeBestStopLike + maxRegressStopLikePct
  const improved = improvedCandidate && !regressedTooFar
  return { best: improved ? candidate : best, improved }
}

export const updatePlateau = ({ plateauCount, improved }) => {
  return improved ? 0 : Math.max(0, plateauCount + 1)
}

export const updateFailStreak = ({ failStreak, pass }) => {
  return pass ? 0 : Math.max(0, (failStreak ?? 0) + 1)
}

export const shouldTerminateSearch = ({
  failStreak,
  plateauCount,
  blocked,
  failStreakLimit = 200,
  plateauLimit = 200,
}) => {
  if (blocked) {
    return "BLOCKED_BY_DATA"
  }
  const failLimit = Math.max(1, Math.floor(failStreakLimit ?? 200))
  const plateauMax = Math.max(1, Math.floor(plateauLimit ?? 200))
  if ((failStreak ?? 0) >= failLimit) {
    return `FAIL_STREAK_${failLimit}`
  }
  if ((plateauCount ?? 0) >= plateauMax) {
    return `PLATEAU_${plateauMax}`
  }
  return null
}

export const advanceTargetIfPassed = ({ targetPct, pass }) => {
  const base = Number(targetPct ?? 0) || 0
  return pass ? base + 1 : base
}

export const buildRetentionPlan = ({
  stagingEntries,
  keepLabels,
  keepLast,
}) => {
  const keep = new Set(keepLabels ?? [])
  const byTrack = new Map()
  for (const entry of stagingEntries ?? []) {
    const track = String(entry.track ?? "").trim()
    const label = String(entry.versionLabel ?? "").trim()
    if (!track || !label) {
      continue
    }
    const list = byTrack.get(track) ?? []
    list.push({
      versionLabel: label,
      createdAt: entry.createdAt ? new Date(entry.createdAt).getTime() : 0,
    })
    byTrack.set(track, list)
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt)
    const limit = Math.max(0, Math.floor(keepLast ?? 0))
    list.slice(0, limit).forEach((item) => keep.add(item.versionLabel))
  }

  const deleteLabels = []
  for (const entry of stagingEntries ?? []) {
    const label = String(entry.versionLabel ?? "").trim()
    if (!label || keep.has(label)) {
      continue
    }
    deleteLabels.push(label)
  }

  return { keepLabels: Array.from(keep), deleteLabels }
}

export const guardLockboxPatterns = ({ patterns, asOfDateKey }) => {
  const hasRules = Array.isArray(patterns?.rules) && patterns.rules.length > 0
  const hasShapes =
    Array.isArray(patterns?.shapes) && patterns.shapes.length > 0
  if (!patterns || (!hasRules && !hasShapes)) {
    const hintCommand = asOfDateKey
      ? `npm run ai:patterns:train -- --asOf=${asOfDateKey}`
      : "npm run ai:patterns:train"
    return {
      blocked: true,
      reason: "PATTERN_MISSING",
      hintCommand,
    }
  }
  return { blocked: false, reason: null }
}

export const buildActivationCommands = ({ recommendationMode, asOfDateKey }) => {
  if (!recommendationMode || !asOfDateKey) {
    return null
  }
  return [
    "node",
    [
      "scripts/ai-recommend.mjs",
      `--recommendationMode=${recommendationMode}`,
      `--asOf=${asOfDateKey}`,
    ],
  ]
}

export const invokeActivation = ({
  tracks,
  asOfByTrack,
  allowGap,
  runCommand,
}) => {
  const trackSet = new Set(
    (tracks ?? []).map((track) =>
      String(track ?? "")
        .trim()
        .toUpperCase(),
    ),
  )
  const called = []

  if (allowGap && trackSet.has("GAP_15_BET")) {
    const intradayAsOf = asOfByTrack?.GAP_15_BET
    const cmd = buildActivationCommands({
      recommendationMode: "INTRADAY_1500",
      asOfDateKey: intradayAsOf,
    })
    if (cmd) {
      runCommand(cmd[0], cmd[1])
      called.push(cmd)
    }
  }

  if (trackSet.has("SURGE_EOD") || trackSet.has("MOONSHOT")) {
    const closeAsOf = asOfByTrack?.SURGE_EOD ?? asOfByTrack?.MOONSHOT
    const cmd = buildActivationCommands({
      recommendationMode: "EOD_CLOSE",
      asOfDateKey: closeAsOf,
    })
    if (cmd) {
      runCommand(cmd[0], cmd[1])
      called.push(cmd)
    }
  }

  return called
}
