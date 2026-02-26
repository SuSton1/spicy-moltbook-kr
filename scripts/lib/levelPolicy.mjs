import { quantile } from "../ai-market-regime.lib.mjs"

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const mean = (values) => {
  const list = values.filter((value) => Number.isFinite(value))
  if (!list.length) {
    return null
  }
  return list.reduce((acc, value) => acc + value, 0) / list.length
}

export const DEFAULT_LEVEL_POLICY = {
  lookbackDays: 45,
  entryBandPct: 0.008,
  stopBandPct: 0.03,
  targetBandPct: 0.04,
  trailingPct: 0.03,
  minRewardPct: 0.05,
  minLookback: 20,
}

export const buildLevelPlan = ({
  candles,
  asOfDateKey,
  lookbackDays = DEFAULT_LEVEL_POLICY.lookbackDays,
  entryBandPct = DEFAULT_LEVEL_POLICY.entryBandPct,
  stopBandPct = DEFAULT_LEVEL_POLICY.stopBandPct,
  targetBandPct = DEFAULT_LEVEL_POLICY.targetBandPct,
  trailingPct = DEFAULT_LEVEL_POLICY.trailingPct,
  minRewardPct = DEFAULT_LEVEL_POLICY.minRewardPct,
  minLookback = DEFAULT_LEVEL_POLICY.minLookback,
}) => {
  const usable = Array.isArray(candles) ? candles : []
  const sliced = usable
    .filter((row) => row?.dateKey && row.dateKey <= asOfDateKey)
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
  if (sliced.length < Math.max(1, minLookback)) {
    return null
  }

  const window = sliced.slice(-Math.max(1, lookbackDays))
  const lows = window.map((row) => toNumber(row.low)).filter((v) => v !== null)
  const highs = window
    .map((row) => toNumber(row.high))
    .filter((v) => v !== null)
  const closes = window
    .map((row) => toNumber(row.close))
    .filter((v) => v !== null)
  const ranges = window
    .map((row) => {
      const high = toNumber(row.high)
      const low = toNumber(row.low)
      return high !== null && low !== null ? Math.max(0, high - low) : null
    })
    .filter((v) => v !== null)

  const support = quantile(lows, 0.2)
  const resistance = quantile(highs, 0.8)
  const atr = mean(ranges)
  const latestClose = closes.length ? closes[closes.length - 1] : null

  if (
    !Number.isFinite(support) ||
    !Number.isFinite(resistance) ||
    !Number.isFinite(latestClose) ||
    latestClose <= 0
  ) {
    return null
  }

  // Center the entry zone around the latest close. This keeps EOD_1x2 entries
  // realistically fillable (vs anchoring too far below at deep support).
  const entryLow = latestClose * (1 - entryBandPct)
  const entryHigh = latestClose * (1 + entryBandPct)
  // Backtest uses stopZone.high as the effective stop. Keep it wide enough to
  // avoid "always-stopped" behavior on normal daily noise.
  const stopHigh = entryLow * (1 - stopBandPct)
  const stopLow = entryLow * (1 - stopBandPct * 1.5)

  const minTarget = entryHigh * (1 + minRewardPct)
  const baseTarget = Math.max(resistance, minTarget)
  const targetLow = baseTarget
  const targetHigh = baseTarget * (1 + targetBandPct)

  const entryRef = (entryLow + entryHigh) / 2
  const rewardPct = ((targetLow - entryRef) / entryRef) * 100
  const riskPct = ((entryRef - stopLow) / entryRef) * 100
  const rr = riskPct > 0 ? rewardPct / riskPct : null

  return {
    asOfDateKey,
    support,
    resistance,
    atr: atr ?? null,
    latestClose,
    entryZone: { low: entryLow, high: entryHigh },
    stopZone: { low: stopLow, high: stopHigh },
    targetZone: { low: targetLow, high: targetHigh },
    trailing: { pct: trailingPct, rule: "upside-open" },
    rewardPct: Number.isFinite(rewardPct) ? rewardPct : null,
    riskPct: Number.isFinite(riskPct) ? riskPct : null,
    rr: Number.isFinite(rr ?? NaN) ? rr : null,
  }
}

export const buildLevelSummary = (plan) => {
  if (!plan) {
    return "level plan missing"
  }
  const rr = Number.isFinite(plan.rr) ? plan.rr.toFixed(2) : "-"
  return `support ${plan.support.toFixed(2)} / resistance ${plan.resistance.toFixed(2)} / RR ${rr}`
}
