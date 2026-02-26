const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveEnvPct = (key, fallback) => {
  const raw = process.env[key]
  const n = toNumber(raw)
  return Number.isFinite(n) ? n : fallback
}

export const getThresholdPct = (tier) => {
  const core = resolveEnvPct("MIN_PLAN_PROFIT_CORE_PCT", 3.0)
  const moon = resolveEnvPct("MIN_PLAN_PROFIT_MOON_PCT", 5.0)
  if (String(tier ?? "").toUpperCase() === "MOONSHOT") {
    return moon
  }
  return core
}

export const extractBoundsFromPlan = (plan) => {
  if (!plan) {
    return { error: "MISSING_BOUNDS" }
  }
  const entry =
    plan.entryZone ??
    plan.entry ??
    plan.buy ??
    plan.zones?.buy ??
    plan.planJson?.entry ??
    null
  const target =
    plan.targetZone ??
    plan.target ??
    plan.sell ??
    plan.zones?.sell ??
    plan.planJson?.target ??
    null
  const buyHigh = toNumber(entry?.high ?? entry?.top ?? null)
  const sellLow = toNumber(target?.low ?? target?.bottom ?? null)
  if (!Number.isFinite(buyHigh) || !Number.isFinite(sellLow)) {
    return { error: "MISSING_BOUNDS" }
  }
  return { buyHigh, sellLow }
}

export const computeMinPlannedProfitPct = ({ buyHigh, sellLow }) => {
  const buy = toNumber(buyHigh)
  const sell = toNumber(sellLow)
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0) {
    return null
  }
  return (sell / buy - 1) * 100
}

export const evaluateMinPlanProfit = (tier, plan) => {
  const thresholdPct = getThresholdPct(tier)
  const bounds = extractBoundsFromPlan(plan)
  if (bounds.error) {
    return {
      ok: false,
      reasonCode: "MIN_PLAN_PROFIT_MISSING",
      messageKo: "매수/매도 구간이 불완전하여 최소 기대수익 계산 불가",
      thresholdPct,
    }
  }
  const minProfitPct = computeMinPlannedProfitPct(bounds)
  if (minProfitPct === null) {
    return {
      ok: false,
      reasonCode: "MIN_PLAN_PROFIT_MISSING",
      messageKo: "매수/매도 구간이 불완전하여 최소 기대수익 계산 불가",
      thresholdPct,
      ...bounds,
    }
  }
  if (minProfitPct < thresholdPct) {
    const isMoon = String(tier ?? "").toUpperCase() === "MOONSHOT"
    return {
      ok: false,
      reasonCode: "MIN_PLAN_PROFIT_TOO_LOW",
      messageKo: isMoon
        ? "매수~매도 최소 기대수익 < 5%"
        : "매수~매도 최소 기대수익 < 3%",
      thresholdPct,
      minProfitPct,
      ...bounds,
    }
  }
  return {
    ok: true,
    thresholdPct,
    minProfitPct,
    ...bounds,
  }
}
