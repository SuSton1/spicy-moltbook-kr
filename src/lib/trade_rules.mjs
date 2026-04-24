const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const resolveEntryRule = (raw) => {
  const mode = String(raw ?? "NEXT_DAY_OPEN").trim().toUpperCase()
  if (mode === "NEXT_DAY_OPEN") {
    return {
      mode,
      entryOffsetDays: 1,
      entryPriceField: "open"
    }
  }
  throw new Error(`Unsupported backtest.entry: ${mode}. Supported: NEXT_DAY_OPEN`)
}

export const resolveTradeExit = ({
  series,
  entryIdx,
  maxExitIdx,
  entryPrice,
  targetPct,
  stopLossPct
}) => {
  const targetEnabled = Number.isFinite(targetPct) && targetPct > 0
  const stopEnabled = Number.isFinite(stopLossPct) && stopLossPct > 0
  const targetPrice = targetEnabled ? entryPrice * (1 + targetPct) : null
  const stopPrice = stopEnabled ? entryPrice * (1 - stopLossPct) : null

  for (let i = entryIdx; i <= maxExitIdx; i += 1) {
    const high = num(series[i]?.high)
    const low = num(series[i]?.low)
    const hitTarget = targetEnabled && Number.isFinite(high) && high >= targetPrice
    const hitStop = stopEnabled && Number.isFinite(low) && low <= stopPrice

    if (hitTarget && hitStop) {
      return {
        exitIdx: i,
        exitPrice: stopPrice,
        exitReason: "BOTH_HIT_STOP_FIRST",
        hitTarget: true,
        hitStop: true
      }
    }
    if (hitStop) {
      return {
        exitIdx: i,
        exitPrice: stopPrice,
        exitReason: "STOP",
        hitTarget: false,
        hitStop: true
      }
    }
    if (hitTarget) {
      return {
        exitIdx: i,
        exitPrice: targetPrice,
        exitReason: "TARGET",
        hitTarget: true,
        hitStop: false
      }
    }
  }

  const timeoutClose = num(series[maxExitIdx]?.close)
  if (!Number.isFinite(timeoutClose) || timeoutClose <= 0) return null
  return {
    exitIdx: maxExitIdx,
    exitPrice: timeoutClose,
    exitReason: "TIMEOUT",
    hitTarget: false,
    hitStop: false
  }
}

export const simulateTradeFromDecision = ({
  series,
  decisionIdx,
  entryRule,
  holdDays,
  targetPct,
  stopLossPct,
  costPct = 0
}) => {
  if (!Array.isArray(series)) return null
  if (!Number.isInteger(decisionIdx) || decisionIdx < 0 || decisionIdx >= series.length) return null
  const safeHold = Math.max(1, Number(holdDays ?? 1))
  const entryOffsetDays = Number(entryRule?.entryOffsetDays ?? 1)
  const entryField = String(entryRule?.entryPriceField ?? "open")
  const entryIdx = decisionIdx + entryOffsetDays
  if (entryIdx < 0 || entryIdx >= series.length) return null
  const maxExitIdx = Math.min(entryIdx + safeHold - 1, series.length - 1)
  const entryPrice = num(series[entryIdx]?.[entryField])
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null

  const resolvedExit = resolveTradeExit({
    series,
    entryIdx,
    maxExitIdx,
    entryPrice,
    targetPct,
    stopLossPct
  })
  if (!resolvedExit) return null

  const exitPrice = num(resolvedExit.exitPrice)
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null
  const grossRet = exitPrice / entryPrice - 1
  const netRet = grossRet - Number(costPct ?? 0)

  return {
    entryIdx,
    exitIdx: resolvedExit.exitIdx,
    entryDateKey: series[entryIdx]?.dateKey ?? null,
    exitDateKey: series[resolvedExit.exitIdx]?.dateKey ?? null,
    entryPrice,
    exitPrice,
    grossRet,
    netRet,
    exitReason: resolvedExit.exitReason,
    hitTarget: Boolean(resolvedExit.hitTarget),
    hitStop: Boolean(resolvedExit.hitStop)
  }
}
