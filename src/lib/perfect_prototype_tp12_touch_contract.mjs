import { resolveEntryRule } from "./trade_rules.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

export const TP12_TOUCH_DISCOVERY_CONTRACT = Object.freeze({
  entry: "NEXT_DAY_OPEN",
  holdDays: 3,
  targetPct: 0.12,
  stopLossPct: 0.04,
})

export const simulatePerfectPrototypeTp12TouchFromDecision = ({
  series,
  decisionIdx,
  entryRule = resolveEntryRule(TP12_TOUCH_DISCOVERY_CONTRACT.entry),
  holdDays = TP12_TOUCH_DISCOVERY_CONTRACT.holdDays,
  targetPct = TP12_TOUCH_DISCOVERY_CONTRACT.targetPct,
  stopLossPct = TP12_TOUCH_DISCOVERY_CONTRACT.stopLossPct,
}) => {
  if (!Array.isArray(series)) return null
  if (!Number.isInteger(decisionIdx) || decisionIdx < 0 || decisionIdx >= series.length) return null
  const entryOffsetDays = Number(entryRule?.entryOffsetDays ?? 1)
  const entryField = String(entryRule?.entryPriceField ?? "open")
  const safeHoldDays = Math.max(1, Math.floor(Number(holdDays) || 1))
  const entryIdx = decisionIdx + entryOffsetDays
  if (entryIdx < 0 || entryIdx >= series.length) return null
  const maxExitIdx = Math.min(entryIdx + safeHoldDays - 1, series.length - 1)
  const entryPrice = num(series?.[entryIdx]?.[entryField])
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  const targetPrice = entryPrice * (1 + Number(targetPct ?? 0))
  if (!Number.isFinite(targetPrice) || targetPrice <= entryPrice) return null
  const stopEnabled = Number.isFinite(Number(stopLossPct)) && Number(stopLossPct) > 0
  const stopPrice = stopEnabled ? entryPrice * (1 - Number(stopLossPct)) : null

  let firstTouchIdx = null
  let firstStopIdx = null
  let firstTouchBarHadStop = false

  for (let idx = entryIdx; idx <= maxExitIdx; idx += 1) {
    const high = num(series?.[idx]?.high)
    const low = num(series?.[idx]?.low)
    const hitTarget = Number.isFinite(high) && high >= targetPrice
    const hitStop = stopEnabled && Number.isFinite(low) && low <= stopPrice
    if (firstStopIdx === null && hitStop) firstStopIdx = idx
    if (firstTouchIdx === null && hitTarget) {
      firstTouchIdx = idx
      firstTouchBarHadStop = hitStop
    }
  }

  const touchedTarget = Number.isInteger(firstTouchIdx)
  const stopBeforeTouch =
    stopEnabled &&
    touchedTarget &&
    Number.isInteger(firstStopIdx) &&
    (firstStopIdx < firstTouchIdx || (firstStopIdx === firstTouchIdx && firstTouchBarHadStop))

  return {
    entryIdx,
    maxExitIdx,
    entryDateKey: toText(series?.[entryIdx]?.dateKey),
    maxExitDateKey: toText(series?.[maxExitIdx]?.dateKey),
    entryPrice,
    targetPrice,
    stopPrice,
    touchedTarget,
    touchIdx: Number.isInteger(firstTouchIdx) ? firstTouchIdx : null,
    touchDateKey: Number.isInteger(firstTouchIdx) ? toText(series?.[firstTouchIdx]?.dateKey) : null,
    firstStopIdx: Number.isInteger(firstStopIdx) ? firstStopIdx : null,
    firstStopDateKey: Number.isInteger(firstStopIdx) ? toText(series?.[firstStopIdx]?.dateKey) : null,
    stopBeforeTouch,
    sameBarStopFirstAtTouch: Boolean(touchedTarget && firstTouchBarHadStop),
  }
}

export const relabelPerfectPrototypeRowForTp12TouchContract = ({
  row,
  seriesMap,
  entryRule = resolveEntryRule(TP12_TOUCH_DISCOVERY_CONTRACT.entry),
  holdDays = TP12_TOUCH_DISCOVERY_CONTRACT.holdDays,
  targetPct = TP12_TOUCH_DISCOVERY_CONTRACT.targetPct,
  stopLossPct = TP12_TOUCH_DISCOVERY_CONTRACT.stopLossPct,
}) => {
  const symbol = toText(row?.symbol)
  const decisionIdx = Number(row?.decisionIdx)
  if (!symbol) {
    throw new Error(`TP12 touch relabel requires row.symbol: sourceId=${toText(row?.sourceId) ?? "n/a"}`)
  }
  if (!Number.isInteger(decisionIdx)) {
    throw new Error(
      `TP12 touch relabel requires integer row.decisionIdx: symbol=${symbol} sourceId=${toText(row?.sourceId) ?? "n/a"}`,
    )
  }
  const series = seriesMap?.get(symbol)
  if (!Array.isArray(series)) {
    throw new Error(`TP12 touch relabel missing candle series for symbol=${symbol}`)
  }
  const touchOutcome = simulatePerfectPrototypeTp12TouchFromDecision({
    series,
    decisionIdx,
    entryRule,
    holdDays,
    targetPct,
    stopLossPct,
  })
  if (!touchOutcome) {
    throw new Error(
      `TP12 touch relabel could not resolve touch outcome: symbol=${symbol} decisionIdx=${decisionIdx} sourceId=${toText(row?.sourceId) ?? "n/a"}`,
    )
  }
  const cleanOutcomeHitTarget =
    typeof row?.outcomeHitTarget === "boolean"
      ? row.outcomeHitTarget
      : typeof row?.eventOutcome?.hitTarget === "boolean"
        ? row.eventOutcome.hitTarget
        : null
  return {
    ...row,
    cleanOutcomeHitTarget,
    outcomeHitTarget: touchOutcome.touchedTarget,
    touchOutcome,
  }
}
