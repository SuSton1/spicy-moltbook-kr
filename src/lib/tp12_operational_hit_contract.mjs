import { toBool, toNumber, toText, validDateKey } from "./tp12_year2hit_foundation_io.mjs"

export const TP12_CHART_HIT_FIELD = "chartHitTarget"
export const TP12_ENTRY_EXECUTABLE_FIELD = "entryExecutable"
export const TP12_OPERATIONAL_HIT_FIELD = "operationalHitTarget"
export const TP12_OPERATIONAL_HIT_DEFINITION = "operational_hit_v1"
export const TP12_EXECUTION_POLICY_ID = "tp12_executable_hit_next_open_gap29p5_volume_v1"
export const TP12_DEFAULT_ENTRY_UPPER_GAP_PCT_EXCLUSIVE = 0.295
export const TP12_DEFAULT_MIN_ENTRY_VOLUME_EXCLUSIVE = 0

const hasOwn = (row, field) => Object.prototype.hasOwnProperty.call(row ?? {}, field)

const assertFiniteNumber = (value, label) => {
  const numeric = toNumber(value)
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be finite: ${value}`)
  return numeric
}

const assertPositiveNumber = (value, label) => {
  const numeric = assertFiniteNumber(value, label)
  if (numeric <= 0) throw new Error(`${label} must be positive: ${value}`)
  return numeric
}

const normalizeMissReasons = ({ chartHitTarget, entryVolume, entryGapBlocked }) => {
  const reasons = []
  if (!chartHitTarget) reasons.push("not_chart_hit")
  if (entryVolume <= TP12_DEFAULT_MIN_ENTRY_VOLUME_EXCLUSIVE) reasons.push("entry_volume_lte_zero")
  if (entryGapBlocked) reasons.push("entry_gap_gte_29p5pct")
  return reasons
}

export const isTp12OperationalHitDefinition = (value) => toText(value) === TP12_OPERATIONAL_HIT_DEFINITION

export const buildTp12OperationalHitFields = ({
  chartHitTarget,
  decisionClose,
  entryOpen,
  entryVolume,
  entryDateKey,
  upperGapPctExclusive = TP12_DEFAULT_ENTRY_UPPER_GAP_PCT_EXCLUSIVE,
  executionPolicyId = TP12_EXECUTION_POLICY_ID,
} = {}) => {
  const normalizedEntryDateKey = toText(entryDateKey)
  if (!validDateKey(normalizedEntryDateKey)) throw new Error(`entryDateKey must be YYYY-MM-DD: ${normalizedEntryDateKey || "missing"}`)
  const close = assertPositiveNumber(decisionClose, "decisionClose")
  const open = assertPositiveNumber(entryOpen, "entryOpen")
  const volume = assertFiniteNumber(entryVolume, "entryVolume")
  if (volume < 0) throw new Error(`entryVolume must be non-negative: ${entryVolume}`)
  const upperGap = assertPositiveNumber(upperGapPctExclusive, "upperGapPctExclusive")
  const entryGapPct = open / close - 1
  const normalizedChartHit = chartHitTarget === true
  const entryGapBlocked = open >= close * (1 + upperGap)
  const entryExecutable = volume > TP12_DEFAULT_MIN_ENTRY_VOLUME_EXCLUSIVE && !entryGapBlocked
  const operationalHitTarget = normalizedChartHit && entryExecutable
  const operationalMissReasons = operationalHitTarget
    ? []
    : normalizeMissReasons({
        chartHitTarget: normalizedChartHit,
        entryVolume: volume,
        entryGapBlocked,
      })
  return {
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    executionPolicyId: toText(executionPolicyId) || TP12_EXECUTION_POLICY_ID,
    chartHitTarget: normalizedChartHit,
    entryDateKey: normalizedEntryDateKey,
    decisionClose: close,
    entryOpen: open,
    entryVolume: volume,
    entryGapPct,
    entryExecutable,
    operationalHitTarget,
    executableHitTarget: operationalHitTarget,
    operationalMissReasons,
    operationalMissReason: operationalMissReasons[0] ?? null,
  }
}

export const assertTp12OperationalHitRow = (
  row,
  {
    context = "",
    hitField = TP12_OPERATIONAL_HIT_FIELD,
    chartHitField = TP12_CHART_HIT_FIELD,
    entryExecutableField = TP12_ENTRY_EXECUTABLE_FIELD,
  } = {},
) => {
  const where = toText(context) ? ` at ${context}` : ""
  if (toText(hitField) !== TP12_OPERATIONAL_HIT_FIELD) return true
  for (const field of [chartHitField, entryExecutableField, TP12_OPERATIONAL_HIT_FIELD]) {
    if (!hasOwn(row, field)) throw new Error(`operational row missing ${field}${where}`)
    if (typeof row[field] !== "boolean") throw new Error(`operational row ${field} must be boolean${where}`)
  }
  const expected = row[chartHitField] === true && row[entryExecutableField] === true
  if (row[TP12_OPERATIONAL_HIT_FIELD] !== expected) {
    throw new Error(
      `operationalHitTarget invariant mismatch${where}: expected chartHitTarget && entryExecutable = ${expected}`,
    )
  }
  const executionPolicyId = toText(row.executionPolicyId ?? row.execution?.policyId)
  if (!executionPolicyId) throw new Error(`operational row missing executionPolicyId${where}`)
  const entryDateKey = toText(row.entryDateKey ?? row.execution?.entryDateKey)
  if (!validDateKey(entryDateKey)) throw new Error(`operational row invalid entryDateKey${where}: ${entryDateKey || "missing"}`)
  const missReasons = row.operationalMissReasons ?? row.execution?.operationalMissReasons ?? row.execution?.nonExecutableReasons
  if (row[TP12_OPERATIONAL_HIT_FIELD] === false && !Array.isArray(missReasons)) {
    throw new Error(`operational miss row missing operationalMissReasons${where}`)
  }
  return true
}

export const deriveTp12OperationalHitOptionsFromContract = (contract = {}) => {
  const operational = contract.operationalHit ?? contract.operationalHitGate ?? {}
  const cadence = contract.recommendationCadence ?? contract.monthlyRecommendationGate ?? {}
  const oos = contract.oosResultGate ?? {}
  return {
    hitDefinition: toText(oos.hitDefinition ?? contract.hitDefinition),
    hitField: toText(oos.hitField ?? operational.operationalHitField ?? contract.hitField ?? ""),
    chartHitField: toText(operational.chartHitField ?? TP12_CHART_HIT_FIELD),
    entryExecutableField: toText(operational.entryExecutableField ?? TP12_ENTRY_EXECUTABLE_FIELD),
    executionPolicyId: toText(operational.executionPolicyId ?? TP12_EXECUTION_POLICY_ID),
    upperGapPctExclusive: toNumber(
      operational.upperGapPctExclusive ?? operational.maxEntryGapPctExclusive,
      TP12_DEFAULT_ENTRY_UPPER_GAP_PCT_EXCLUSIVE,
    ),
    minExecutableRecommendationsPerFullMonth: Math.max(
      0,
      Math.trunc(toNumber(oos.minExecutableRecommendationsPerFullMonth ?? cadence.minExecutableRecommendationsPerFullMonth, 0)),
    ),
    requireMonthlyCadence: toBool(
      oos.requireMonthlyCadence ?? cadence.failOnMissingMonthlyCadence ?? cadence.requireMonthlyCadence,
      false,
    ),
    fullMonthPolicy: toText(cadence.fullMonthPolicy ?? "explicit_full_months_only"),
  }
}

const resolveMonthKey = (row) => {
  const dateKey = toText(row?.decisionDateKey ?? row?.dateKey ?? row?.tradingDateKey)
  if (!validDateKey(dateKey)) throw new Error(`monthly cadence row invalid decisionDateKey: ${dateKey || "missing"}`)
  return dateKey.slice(0, 7)
}

export const buildTp12MonthlyCadenceSummary = (
  rows = [],
  { minExecutableRecommendationsPerFullMonth = 5, fullMonthKeys = null, hitField = TP12_OPERATIONAL_HIT_FIELD } = {},
) => {
  const requiredMonths = new Set(Array.isArray(fullMonthKeys) ? fullMonthKeys.map(toText).filter(Boolean) : [])
  const byMonth = new Map()
  for (const row of rows) {
    const monthKey = resolveMonthKey(row)
    const state = byMonth.get(monthKey) ?? {
      monthKey,
      fullMonthEligible: requiredMonths.size > 0 ? requiredMonths.has(monthKey) : row.fullMonthEligible !== false,
      selectedRows: 0,
      executableRecommendationCount: 0,
      operationalHitRows: 0,
    }
    state.selectedRows += 1
    if (row.entryExecutable === true) state.executableRecommendationCount += 1
    if (row[hitField] === true) state.operationalHitRows += 1
    byMonth.set(monthKey, state)
  }
  for (const monthKey of requiredMonths) {
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {
        monthKey,
        fullMonthEligible: true,
        selectedRows: 0,
        executableRecommendationCount: 0,
        operationalHitRows: 0,
      })
    }
  }
  const fullMonthStats = [...byMonth.values()]
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey))
    .map((row) => ({
      ...row,
      minExecutableRecommendationsPerFullMonth,
      passedMonthlyExecutableMinimum:
        row.fullMonthEligible === false || row.executableRecommendationCount >= minExecutableRecommendationsPerFullMonth,
    }))
  return {
    kind: "tp12_operational_monthly_cadence_summary_v1",
    minExecutableRecommendationsPerFullMonth,
    fullMonthCount: fullMonthStats.filter((row) => row.fullMonthEligible !== false).length,
    fullMonthStats,
  }
}

export const evaluateTp12MonthlyCadence = (
  monthlyCadence,
  { minExecutableRecommendationsPerFullMonth = 5, requireMonthlyCadence = false } = {},
) => {
  const reasons = []
  const rows = Array.isArray(monthlyCadence?.fullMonthStats)
    ? monthlyCadence.fullMonthStats
    : Array.isArray(monthlyCadence)
      ? monthlyCadence
      : []
  if (requireMonthlyCadence && rows.length < 1) {
    reasons.push("monthly_cadence_missing")
    return reasons
  }
  for (const row of rows) {
    if (row?.fullMonthEligible === false) continue
    const monthKey = toText(row?.monthKey ?? row?.month)
    const executableCount = Math.trunc(toNumber(row?.executableRecommendationCount ?? row?.entryExecutableRows, 0))
    if (executableCount < minExecutableRecommendationsPerFullMonth) {
      reasons.push(`monthly_executable_recommendations_below_min:${monthKey || "unknown"}`)
    }
  }
  return reasons
}
