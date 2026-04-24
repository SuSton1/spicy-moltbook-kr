const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

export const resolveOrderSimulatorConfig = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled !== false,
    minFillProb: clamp01(cfg?.minFillProb ?? 0.55),
    maxSlippageBps: Math.max(0, Number(cfg?.maxSlippageBps ?? 25) || 25),
    feeBps: Math.max(0, Number(cfg?.feeBps ?? 15) || 15),
    baseSlippageBps: Math.max(0, Number(cfg?.baseSlippageBps ?? 8) || 8),
    spreadWeight: Math.max(0, Number(cfg?.spreadWeight ?? 120) || 120),
    volatilityWeight: Math.max(0, Number(cfg?.volatilityWeight ?? 80) || 80),
    illiquidityWeight: Math.max(0, Number(cfg?.illiquidityWeight ?? 90) || 90)
  }
}

export const estimateOrderExecutionProfile = ({ row, cfg }) => {
  const safeCfg = resolveOrderSimulatorConfig(cfg)
  if (safeCfg.enabled !== true) {
    return {
      enabled: false,
      fillProb: 1,
      slippageBps: 0,
      totalCostBps: Number(safeCfg.feeBps ?? 0),
      decision: "ALLOW"
    }
  }

  const spreadProxy = Math.max(0, Number(row?.spreadProxyPct ?? 0) || 0)
  const volatility = Math.max(0, Number(row?.regimeVolatilityProxy ?? 0) || 0)
  const liquidity = clamp01(row?.regimeLiquidityProxy ?? 0)
  const expectedRet = Number(row?.expectedNetRet3d ?? 0)

  const slippageBps =
    Number(safeCfg.baseSlippageBps ?? 0) +
    Number(safeCfg.spreadWeight ?? 0) * spreadProxy +
    Number(safeCfg.volatilityWeight ?? 0) * volatility +
    Number(safeCfg.illiquidityWeight ?? 0) * (1 - liquidity)
  const feeBps = Number(safeCfg.feeBps ?? 0)
  const totalCostBps = slippageBps + feeBps
  const fillProb = clamp01(1 - (spreadProxy * 2 + (1 - liquidity) * 0.7 + volatility * 1.1))
  const afterCostExpectancy = expectedRet - totalCostBps / 10000

  let decision = "ALLOW"
  const reasons = []
  if (fillProb < Number(safeCfg.minFillProb ?? 0.55)) {
    decision = "BLOCK"
    reasons.push("FILL_PROB_LOW")
  }
  if (slippageBps > Number(safeCfg.maxSlippageBps ?? 25)) {
    decision = "BLOCK"
    reasons.push("SLIPPAGE_HIGH")
  }

  return {
    enabled: true,
    fillProb,
    slippageBps,
    totalCostBps,
    afterCostExpectancy,
    decision,
    reasons
  }
}
