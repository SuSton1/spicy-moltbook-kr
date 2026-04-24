import { resolveEntryRule } from "./trade_rules.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toNonNegativeInteger = (value, fallback = 0) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return Math.max(0, Math.floor(Number(fallback) || 0))
  return Math.max(0, Math.floor(n))
}

const normalizeSameBarTiePolicy = (value, fallback = "STOP_FIRST") => {
  const text = String(value ?? fallback).trim().toUpperCase()
  if (text === "STOP_FIRST" || text === "TARGET_WINS") return text
  throw new Error(`Unsupported TP12 execution sameBarTiePolicy=${value}. Supported: STOP_FIRST, TARGET_WINS`)
}

export const normalizeTp12ExecutionPolicy = (policy = {}) => {
  const policyId = toText(policy?.policyId)
  if (!policyId) {
    throw new Error("TP12 execution policy requires policyId")
  }
  const entry = String(policy?.entry ?? "NEXT_DAY_OPEN").trim().toUpperCase()
  const entryRule = resolveEntryRule(entry)
  const holdDays = Math.max(1, Math.floor(Number(policy?.holdDays ?? 3) || 3))
  const targetPct = Number(policy?.targetPct)
  if (!Number.isFinite(targetPct) || targetPct <= 0) {
    throw new Error(`TP12 execution policy ${policyId} requires finite targetPct>0`)
  }
  const stopLossRaw = policy?.stopLossPct
  const stopLossPct =
    stopLossRaw === null || stopLossRaw === undefined || stopLossRaw === ""
      ? null
      : Number(stopLossRaw)
  if (stopLossPct !== null && (!Number.isFinite(stopLossPct) || stopLossPct <= 0)) {
    throw new Error(`TP12 execution policy ${policyId} requires stopLossPct>0 or null`)
  }
  const stopActivationDelayBars = stopLossPct === null ? 0 : toNonNegativeInteger(policy?.stopActivationDelayBars, 0)
  const sameBarTiePolicy = normalizeSameBarTiePolicy(policy?.sameBarTiePolicy, "STOP_FIRST")
  return Object.freeze({
    policyId,
    label:
      toText(policy?.label) ??
      `${entry} / ${holdDays}d / +${(targetPct * 100).toFixed(0)}% / ${
        stopLossPct === null ? "NO_STOP" : `SL${(stopLossPct * 100).toFixed(0)}`
      }`,
    entry,
    entryRule,
    holdDays,
    targetPct,
    stopLossPct,
    stopActivationDelayBars,
    sameBarTiePolicy,
    stopEnabled: stopLossPct !== null,
  })
}

export const TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1 = Object.freeze([
  normalizeTp12ExecutionPolicy({
    policyId: "baseline_tp12_sl4_stop_first_3d",
    label: "Baseline clean 3d TP12/SL4 stop-first",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: 0.04,
    stopActivationDelayBars: 0,
    sameBarTiePolicy: "STOP_FIRST",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "tp12_sl4_target_wins_same_bar_3d",
    label: "3d TP12/SL4 same-bar target wins",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: 0.04,
    stopActivationDelayBars: 0,
    sameBarTiePolicy: "TARGET_WINS",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "tp12_sl4_stop_delay1_3d",
    label: "3d TP12/SL4 stop starts day+1",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: 0.04,
    stopActivationDelayBars: 1,
    sameBarTiePolicy: "STOP_FIRST",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "tp12_sl6_stop_first_3d",
    label: "3d TP12/SL6 stop-first",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: 0.06,
    stopActivationDelayBars: 0,
    sameBarTiePolicy: "STOP_FIRST",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "tp12_sl6_stop_delay1_3d",
    label: "3d TP12/SL6 stop starts day+1",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: 0.06,
    stopActivationDelayBars: 1,
    sameBarTiePolicy: "STOP_FIRST",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "tp12_sl4_stop_delay1_4d",
    label: "4d TP12/SL4 stop starts day+1",
    holdDays: 4,
    targetPct: 0.12,
    stopLossPct: 0.04,
    stopActivationDelayBars: 1,
    sameBarTiePolicy: "STOP_FIRST",
  }),
  normalizeTp12ExecutionPolicy({
    policyId: "touch_anchor_tp12_no_stop_3d",
    label: "Touch anchor 3d TP12 no-stop",
    holdDays: 3,
    targetPct: 0.12,
    stopLossPct: null,
    stopActivationDelayBars: 0,
    sameBarTiePolicy: "STOP_FIRST",
  }),
])

export const simulateTp12ExecutionPolicyFromDecision = ({
  series,
  decisionIdx,
  policy,
  costPct = 0,
}) => {
  const normalizedPolicy = normalizeTp12ExecutionPolicy(policy)
  if (!Array.isArray(series)) return null
  if (!Number.isInteger(decisionIdx) || decisionIdx < 0 || decisionIdx >= series.length) return null

  const entryIdx = decisionIdx + Number(normalizedPolicy.entryRule?.entryOffsetDays ?? 1)
  if (entryIdx < 0 || entryIdx >= series.length) return null
  const maxExitIdx = Math.min(entryIdx + normalizedPolicy.holdDays - 1, series.length - 1)
  const entryField = String(normalizedPolicy.entryRule?.entryPriceField ?? "open")
  const entryPrice = num(series?.[entryIdx]?.[entryField])
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null

  const targetPrice = entryPrice * (1 + normalizedPolicy.targetPct)
  const stopPrice =
    normalizedPolicy.stopEnabled === true && Number.isFinite(normalizedPolicy.stopLossPct)
      ? entryPrice * (1 - normalizedPolicy.stopLossPct)
      : null
  const stopActiveFromIdx = normalizedPolicy.stopEnabled === true ? entryIdx + normalizedPolicy.stopActivationDelayBars : Number.POSITIVE_INFINITY

  let exitIdx = null
  let exitPrice = null
  let exitReason = null
  let hitTarget = false
  let hitStop = false

  for (let idx = entryIdx; idx <= maxExitIdx; idx += 1) {
    const high = num(series?.[idx]?.high)
    const low = num(series?.[idx]?.low)
    const targetTriggered = Number.isFinite(high) && high >= targetPrice
    const stopTriggered =
      normalizedPolicy.stopEnabled === true &&
      idx >= stopActiveFromIdx &&
      Number.isFinite(low) &&
      Number.isFinite(stopPrice) &&
      low <= stopPrice

    if (targetTriggered && stopTriggered) {
      if (normalizedPolicy.sameBarTiePolicy === "TARGET_WINS") {
        exitIdx = idx
        exitPrice = targetPrice
        exitReason = "TARGET_SAME_BAR_WINS"
        hitTarget = true
        hitStop = false
      } else {
        exitIdx = idx
        exitPrice = stopPrice
        exitReason = "STOP_SAME_BAR_FIRST"
        hitTarget = false
        hitStop = true
      }
      break
    }
    if (stopTriggered) {
      exitIdx = idx
      exitPrice = stopPrice
      exitReason = "STOP"
      hitTarget = false
      hitStop = true
      break
    }
    if (targetTriggered) {
      exitIdx = idx
      exitPrice = targetPrice
      exitReason = "TARGET"
      hitTarget = true
      hitStop = false
      break
    }
  }

  if (!Number.isInteger(exitIdx)) {
    const timeoutClose = num(series?.[maxExitIdx]?.close)
    if (!Number.isFinite(timeoutClose) || timeoutClose <= 0) return null
    exitIdx = maxExitIdx
    exitPrice = timeoutClose
    exitReason = "TIMEOUT"
    hitTarget = false
    hitStop = false
  }

  const grossRet = exitPrice / entryPrice - 1
  const netRet = grossRet - Number(costPct ?? 0)
  const timeoutPositive = exitReason === "TIMEOUT" && netRet > 0
  const timeoutNegative = exitReason === "TIMEOUT" && netRet <= 0

  return {
    policyId: normalizedPolicy.policyId,
    label: normalizedPolicy.label,
    entry: normalizedPolicy.entry,
    holdDays: normalizedPolicy.holdDays,
    targetPct: normalizedPolicy.targetPct,
    stopLossPct: normalizedPolicy.stopLossPct,
    stopActivationDelayBars: normalizedPolicy.stopActivationDelayBars,
    sameBarTiePolicy: normalizedPolicy.sameBarTiePolicy,
    decisionIdx,
    entryIdx,
    exitIdx,
    maxExitIdx,
    entryDateKey: toText(series?.[entryIdx]?.dateKey),
    exitDateKey: toText(series?.[exitIdx]?.dateKey),
    entryPrice,
    exitPrice,
    targetPrice,
    stopPrice,
    grossRet,
    netRet,
    exitReason,
    hitTarget,
    hitStop,
    timeoutPositive,
    timeoutNegative,
  }
}
