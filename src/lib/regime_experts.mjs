const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const clamp01 = (value) => clamp(Number(value) || 0, 0, 1)

export const resolveRegimeExpertsConfig = (raw) => {
  const cfg = raw ?? {}
  return {
    enabled: cfg?.enabled !== false,
    lowVolAction: String(cfg?.lowVolAction ?? "BLOCK").trim().toUpperCase(),
    lowVolScoreMultiplier: clamp01(cfg?.lowVolScoreMultiplier ?? 0.8),
    highVolScoreMultiplier: clamp01(cfg?.highVolScoreMultiplier ?? 1),
    midVolScoreMultiplier: clamp01(cfg?.midVolScoreMultiplier ?? 1),
    defaultScoreMultiplier: clamp01(cfg?.defaultScoreMultiplier ?? 1)
  }
}

export const evaluateRegimeExpert = ({ regimeTag, cfg }) => {
  const safeCfg = resolveRegimeExpertsConfig(cfg)
  const tag = String(regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
  if (safeCfg.enabled !== true) {
    return {
      expert: "GLOBAL",
      action: "ALLOW",
      scoreMultiplier: 1
    }
  }
  if (tag.startsWith("VOL_LOW_")) {
    return {
      expert: "AVOID_CHOP",
      action: safeCfg.lowVolAction === "SHADOW" ? "SHADOW" : "BLOCK",
      scoreMultiplier: Number(safeCfg.lowVolScoreMultiplier ?? 0.8)
    }
  }
  if (tag.startsWith("VOL_HIGH_")) {
    return {
      expert: "MOMENTUM_BREAKOUT",
      action: "ALLOW",
      scoreMultiplier: Number(safeCfg.highVolScoreMultiplier ?? 1)
    }
  }
  if (tag.startsWith("VOL_MID_")) {
    return {
      expert: "EVENT_NEWS",
      action: "ALLOW",
      scoreMultiplier: Number(safeCfg.midVolScoreMultiplier ?? 1)
    }
  }
  return {
    expert: "GLOBAL",
    action: "ALLOW",
    scoreMultiplier: Number(safeCfg.defaultScoreMultiplier ?? 1)
  }
}
