import { simulateTp12ExecutionPolicyFromDecision } from "./perfect_prototype_tp12_execution_policy.mjs"


export const TP12_NO_STOP_TARGET_CONTRACT_KIND = "tp12_no_stop_target_contract_v1"

export const TP12_NO_STOP_TARGET_SPECS = Object.freeze([
  Object.freeze({
    labelId: "tp12_no_stop_hit_3d",
    holdDays: 3,
  }),
  Object.freeze({
    labelId: "tp12_no_stop_hit_4d",
    holdDays: 4,
  }),
])

const toText = (value) => String(value ?? "").trim()

const toFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const safeDiv = (numerator, denominator) => {
  const left = Number(numerator)
  const right = Number(denominator)
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(right) < 1e-12) return 0
  return left / right
}

const maxFinite = (values) => {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number)
  return filtered.length > 0 ? Math.max(...filtered) : null
}

const minFinite = (values) => {
  const filtered = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number)
  return filtered.length > 0 ? Math.min(...filtered) : null
}

const normalizeSeriesRow = (row, index) => {
  const dateKey = toText(row?.dateKey)
  if (!dateKey) {
    throw new Error(`series[${index}] missing dateKey`)
  }
  return {
    ...row,
    dateKey,
    open: toFiniteNumber(row?.open, `series[${index}].open`),
    high: toFiniteNumber(row?.high, `series[${index}].high`),
    low: toFiniteNumber(row?.low, `series[${index}].low`),
    close: toFiniteNumber(row?.close, `series[${index}].close`),
  }
}

const buildWindowStats = ({ series, entryIdx, maxExitIdx, entryPrice }) => {
  const windowRows = series.slice(entryIdx, maxExitIdx + 1)
  const maxHigh = maxFinite(windowRows.map((row) => row?.high))
  const minLow = minFinite(windowRows.map((row) => row?.low))
  const terminalClose = windowRows[windowRows.length - 1]?.close ?? null
  return {
    maxHighRet: Number.isFinite(maxHigh) ? safeDiv(maxHigh - entryPrice, entryPrice) : null,
    minLowRet: Number.isFinite(minLow) ? safeDiv(minLow - entryPrice, entryPrice) : null,
    terminalRet: Number.isFinite(terminalClose) ? safeDiv(terminalClose - entryPrice, entryPrice) : null,
  }
}

export const computeTp12NoStopTargetLabelsForDecision = ({
  series,
  decisionIdx = 0,
  targetPct = 0.12,
  targetSpecs = TP12_NO_STOP_TARGET_SPECS,
} = {}) => {
  if (!Array.isArray(series) || series.length < 5) {
    throw new Error("computeTp12NoStopTargetLabelsForDecision requires a series with at least 5 rows")
  }
  if (!Number.isInteger(decisionIdx) || decisionIdx < 0 || decisionIdx >= series.length) {
    throw new Error(`decisionIdx must be a valid series index: ${decisionIdx}`)
  }
  const normalizedSeries = series.map((row, index) => normalizeSeriesRow(row, index))
  const labels = {}
  for (const spec of Array.isArray(targetSpecs) ? targetSpecs : []) {
    const labelId = toText(spec?.labelId)
    const holdDays = Number(spec?.holdDays)
    if (!labelId || !Number.isInteger(holdDays) || holdDays < 1) {
      throw new Error(`Unsupported TP12 no-stop target spec: ${JSON.stringify(spec)}`)
    }
    const policyResult = simulateTp12ExecutionPolicyFromDecision({
      series: normalizedSeries,
      decisionIdx,
      policy: {
        policyId: `derived_${labelId}`,
        holdDays,
        targetPct,
        stopLossPct: null,
      },
      costPct: 0,
    })
    if (!policyResult) {
      throw new Error(`No-stop target contract could not be computed for ${labelId}`)
    }
    const windowStats = buildWindowStats({
      series: normalizedSeries,
      entryIdx: policyResult.entryIdx,
      maxExitIdx: policyResult.maxExitIdx,
      entryPrice: policyResult.entryPrice,
    })
    labels[labelId] = policyResult.hitTarget ? 1 : 0
    labels[`${labelId}_first_hit_date`] = policyResult.hitTarget ? toText(policyResult.exitDateKey) || null : null
    labels[`${labelId}_entry_date`] = toText(policyResult.entryDateKey) || null
    labels[`${labelId}_entry_price`] = policyResult.entryPrice
    labels[`${labelId}_max_high_ret`] = windowStats.maxHighRet
    labels[`${labelId}_min_low_ret`] = windowStats.minLowRet
    labels[`${labelId}_terminal_ret`] = windowStats.terminalRet
  }
  return {
    kind: TP12_NO_STOP_TARGET_CONTRACT_KIND,
    targetPct,
    labels,
  }
}
