import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  assertTp12OperationalHitRow,
  buildTp12MonthlyCadenceSummary,
  isTp12OperationalHitDefinition,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

export const TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_KIND =
  "tp12_monthly_quota_precision_scheduler_summary_v1"
export const DEFAULT_TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_CONTRACT_PATH =
  "meta/tp12_monthly_quota_precision_scheduler_contract.json"

const PATCH_KEY = "tp12_monthly_quota_precision_scheduler_v1"

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const keyOf = (dateKey, symbol) => `${dateKey}::${symbol}`

const monthKeyOf = (dateKey) => toText(dateKey).slice(0, 7)

const requireDateKey = (value, label) => {
  const text = toText(value)
  if (!validDateKey(text)) throw new Error(`${label} must be YYYY-MM-DD: ${text || "missing"}`)
  return text
}

const requireFinite = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be finite`)
  return numeric
}

const parseList = (value) => {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean)
  return toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

const uniqueSorted = (values) => [...new Set(values.map(toText).filter(Boolean))].sort()

const readContract = async (contractPath) => {
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`monthly quota scheduler contract not found: ${contractPath}`)
  if (toText(contract.kind) !== "tp12_monthly_quota_precision_scheduler_contract_v1") {
    throw new Error(`unsupported monthly quota scheduler contract kind: ${contract.kind ?? "missing"}`)
  }
  if (toText(contract.patchKey) !== PATCH_KEY) {
    throw new Error(`unexpected monthly quota scheduler patchKey: ${contract.patchKey ?? "missing"}`)
  }
  return contract
}

const resolvePatternId = (row, fields) => {
  for (const field of fields) {
    const text = toText(row?.[field])
    if (text) return text
  }
  return ""
}

const deriveOptionsFromContract = (contract = {}) => {
  const input = contract.inputContract ?? {}
  const operational = contract.operationalHit ?? {}
  const scheduler = contract.scheduler ?? {}
  const performance = contract.performanceGate ?? {}
  const concentration = contract.concentrationGate ?? {}
  return {
    scoreField: input.scoreField,
    patternIdFields: input.patternIdFields,
    hitDefinition: operational.hitDefinition ?? contract.hitDefinition,
    hitField: operational.hitField ?? contract.hitField,
    targetRecommendationsPerFullMonth: scheduler.targetRecommendationsPerFullMonth,
    maxRecommendationsPerFullMonth: scheduler.maxRecommendationsPerFullMonth,
    maxRecommendationsPerDay: scheduler.maxRecommendationsPerDay,
    minSchedulerScore: scheduler.minSchedulerScore,
    selectionKey: scheduler.selectionKey,
    targetObservedHitRate: performance.targetObservedHitRate,
    minWilsonLowerBound95: performance.minWilsonLowerBound95,
    minSelectedRows: performance.minSelectedRows,
    maxTopSymbolShare: concentration.maxTopSymbolShare,
    maxTopPatternShare: concentration.maxTopPatternShare,
    maxTopMonthShare: concentration.maxTopMonthShare,
    maxSymbolPerFullMonth: concentration.maxSymbolPerFullMonth,
    maxPatternPerFullMonth: concentration.maxPatternPerFullMonth,
    forbiddenSelectionFields: contract.forbiddenSelectionFields,
    fullMonthKeysRequired: input.fullMonthKeysRequired,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveOptionsFromContract(contract) : {}
  const fullMonthKeys = uniqueSorted(parseList(raw.fullMonthKeys ?? contractOptions.fullMonthKeys))
  const patternIdFields = parseList(raw.patternIdFields ?? contractOptions.patternIdFields)
  const targetRecommendationsPerFullMonth = Math.max(
    1,
    Math.trunc(toNumber(raw.targetRecommendationsPerFullMonth ?? contractOptions.targetRecommendationsPerFullMonth, 5)),
  )
  const maxRecommendationsPerFullMonth = Math.max(
    targetRecommendationsPerFullMonth,
    Math.trunc(toNumber(raw.maxRecommendationsPerFullMonth ?? contractOptions.maxRecommendationsPerFullMonth, targetRecommendationsPerFullMonth)),
  )
  const options = {
    fullMonthKeys,
    scoreField: toText(raw.scoreField ?? contractOptions.scoreField) || "schedulerScore",
    patternIdFields: patternIdFields.length > 0 ? patternIdFields : ["patternId", "primaryPatternId", "ruleId"],
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition) || TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: toText(raw.hitField ?? contractOptions.hitField) || TP12_OPERATIONAL_HIT_FIELD,
    selectionKey: toText(raw.selectionKey ?? contractOptions.selectionKey) || "monthlyQuotaSchedule",
    targetRecommendationsPerFullMonth,
    maxRecommendationsPerFullMonth,
    maxRecommendationsPerDay: Math.max(
      1,
      Math.trunc(toNumber(raw.maxRecommendationsPerDay ?? contractOptions.maxRecommendationsPerDay, 1)),
    ),
    minSchedulerScore: toNumber(raw.minSchedulerScore ?? contractOptions.minSchedulerScore, 0),
    targetObservedHitRate: Math.min(
      1,
      Math.max(0, toNumber(raw.targetObservedHitRate ?? contractOptions.targetObservedHitRate, 0.8)),
    ),
    minWilsonLowerBound95: Math.min(
      1,
      Math.max(0, toNumber(raw.minWilsonLowerBound95 ?? contractOptions.minWilsonLowerBound95, 0)),
    ),
    minSelectedRows: Math.max(0, Math.trunc(toNumber(raw.minSelectedRows ?? contractOptions.minSelectedRows, 0))),
    maxTopSymbolShare: Math.min(1, Math.max(0, toNumber(raw.maxTopSymbolShare ?? contractOptions.maxTopSymbolShare, 1))),
    maxTopPatternShare: Math.min(1, Math.max(0, toNumber(raw.maxTopPatternShare ?? contractOptions.maxTopPatternShare, 1))),
    maxTopMonthShare: Math.min(1, Math.max(0, toNumber(raw.maxTopMonthShare ?? contractOptions.maxTopMonthShare, 1))),
    maxSymbolPerFullMonth: Math.max(0, Math.trunc(toNumber(raw.maxSymbolPerFullMonth ?? contractOptions.maxSymbolPerFullMonth, 0))),
    maxPatternPerFullMonth: Math.max(0, Math.trunc(toNumber(raw.maxPatternPerFullMonth ?? contractOptions.maxPatternPerFullMonth, 0))),
    failOnGateFailure: toBool(raw.failOnGateFailure, false),
    allowImplicitFullMonths: toBool(raw.allowImplicitFullMonths, false),
    forbiddenSelectionFields: parseList(contractOptions.forbiddenSelectionFields),
  }
  if (options.maxRecommendationsPerFullMonth < options.targetRecommendationsPerFullMonth) {
    throw new Error("maxRecommendationsPerFullMonth must be >= targetRecommendationsPerFullMonth")
  }
  if (!Number.isFinite(options.minSchedulerScore)) throw new Error("minSchedulerScore must be finite")
  if (options.fullMonthKeys.length < 1 && !options.allowImplicitFullMonths) {
    throw new Error("fullMonthKeys are required; monthly quota must use explicit full months")
  }
  if (isTp12OperationalHitDefinition(options.hitDefinition) && options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`monthly quota scheduler requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  const forbidden = new Set(options.forbiddenSelectionFields.map((field) => field.toLowerCase()))
  if (forbidden.has(options.scoreField.toLowerCase())) {
    throw new Error(`scoreField is forbidden for scheduler selection: ${options.scoreField}`)
  }
  return options
}

const initMetricState = () => ({
  selectedRows: 0,
  hitRows: 0,
  matchedDates: new Set(),
  hitDates: new Set(),
  matchedSymbols: new Set(),
  hitSymbols: new Set(),
  rowsByDate: new Map(),
})

const addMetricRow = (state, row, hitField) => {
  state.selectedRows += 1
  state.matchedDates.add(row.decisionDateKey)
  state.matchedSymbols.add(row.symbol)
  incrementMap(state.rowsByDate, row.decisionDateKey)
  if (row[hitField] === true) {
    state.hitRows += 1
    state.hitDates.add(row.decisionDateKey)
    state.hitSymbols.add(row.symbol)
  }
}

const finalizeMetricState = (state) => {
  const top1DateCount = state.selectedRows > 0 ? Math.max(0, ...state.rowsByDate.values()) : 0
  return {
    selectedRows: state.selectedRows,
    hitRows: state.hitRows,
    hitRate: safeRatio(state.hitRows, state.selectedRows),
    uniqueMatchedDates: state.matchedDates.size,
    uniqueHitDates: state.hitDates.size,
    dateHitRate: safeRatio(state.hitDates.size, state.matchedDates.size),
    uniqueMatchedSymbols: state.matchedSymbols.size,
    uniqueHitSymbols: state.hitSymbols.size,
    top1DateCount,
    top1DateShare: safeRatio(top1DateCount, state.selectedRows),
  }
}

const compareCandidates = (left, right) => {
  if (left.schedulerScore !== right.schedulerScore) return right.schedulerScore - left.schedulerScore
  if (left.decisionDateKey !== right.decisionDateKey) return left.decisionDateKey.localeCompare(right.decisionDateKey)
  if (left.symbol !== right.symbol) return left.symbol.localeCompare(right.symbol)
  return left.patternId.localeCompare(right.patternId)
}

const finalizeConcentration = (map, total) => {
  let topKey = null
  let topCount = 0
  for (const [key, count] of map.entries()) {
    if (count > topCount || (count === topCount && String(key).localeCompare(String(topKey)) < 0)) {
      topKey = key
      topCount = count
    }
  }
  return {
    topKey,
    topCount,
    topShare: safeRatio(topCount, total),
  }
}

const loadSchedulerCandidates = async ({ candidatesPath, options }) => {
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  if (!fs.existsSync(candidatesPath)) throw new Error(`scheduler candidates not found: ${candidatesPath}`)
  const fullMonthSet = new Set(options.fullMonthKeys)
  const byDate = new Map()
  const seen = new Set()
  const rejectCounts = new Map()
  const inputRowsByMonth = new Map()
  const eligibleRowsByMonth = new Map()
  let inputRowCount = 0
  let outsideFullMonthRowCount = 0
  await iterateJsonlMaybeGzip(candidatesPath, {
    strict: true,
    onRow: async (raw, context) => {
      inputRowCount += 1
      const decisionDateKey = requireDateKey(raw?.decisionDateKey ?? raw?.dateKey, `${context.filePath}:${context.lineNumber} decisionDateKey`)
      const monthKey = monthKeyOf(decisionDateKey)
      if (fullMonthSet.size > 0 && !fullMonthSet.has(monthKey)) {
        outsideFullMonthRowCount += 1
        return
      }
      incrementMap(inputRowsByMonth, monthKey)
      const symbol = toText(raw?.symbol).toUpperCase()
      if (!symbol) throw new Error(`scheduler candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
      const patternId = resolvePatternId(raw, options.patternIdFields)
      if (!patternId) throw new Error(`scheduler candidate row missing pattern id at ${context.filePath}:${context.lineNumber}`)
      const key = keyOf(decisionDateKey, symbol)
      if (seen.has(key)) throw new Error(`duplicate scheduler symbol/date candidate: ${key}`)
      seen.add(key)
      if (isTp12OperationalHitDefinition(options.hitDefinition)) {
        assertTp12OperationalHitRow(raw, {
          context: `${context.filePath}:${context.lineNumber}`,
          hitField: options.hitField,
        })
      }
      if (!Object.prototype.hasOwnProperty.call(raw, options.hitField)) {
        throw new Error(`scheduler candidate missing ${options.hitField} at ${context.filePath}:${context.lineNumber}`)
      }
      const schedulerScore = requireFinite(raw?.[options.scoreField], `${context.filePath}:${context.lineNumber} ${options.scoreField}`)
      if (schedulerScore < options.minSchedulerScore) {
        incrementMap(rejectCounts, "score_below_fixed_min")
        return
      }
      const row = {
        ...raw,
        decisionDateKey,
        monthKey,
        symbol,
        patternId,
        schedulerScore,
      }
      incrementMap(eligibleRowsByMonth, monthKey)
      const dateRows = byDate.get(decisionDateKey) ?? []
      dateRows.push(row)
      byDate.set(decisionDateKey, dateRows)
    },
  })
  if (inputRowCount < 1) throw new Error(`scheduler candidate source produced zero rows: ${candidatesPath}`)
  return {
    byDate,
    inputRowCount,
    outsideFullMonthRowCount,
    fixedScoreRejectedRowCount: toNumber(rejectCounts.get("score_below_fixed_min"), 0),
    rejectCounts,
    inputRowsByMonth,
    eligibleRowsByMonth,
  }
}

const buildDailyCandidates = ({ byDate, options }) => {
  const dailyRows = []
  const dailyCandidateRowsByMonth = new Map()
  for (const [dateKey, rows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...rows].sort(compareCandidates)
    const kept = sorted.slice(0, options.maxRecommendationsPerDay)
    for (const [index, row] of kept.entries()) {
      const dailyRow = {
        ...row,
        dailySchedulerRank: index + 1,
        dailyCandidateRows: sorted.length,
      }
      incrementMap(dailyCandidateRowsByMonth, dailyRow.monthKey)
      dailyRows.push(dailyRow)
    }
  }
  return { dailyRows, dailyCandidateRowsByMonth }
}

const selectMonthRows = ({ monthKey, rows, options, skipCounts }) => {
  const selected = []
  const symbolCounts = new Map()
  const patternCounts = new Map()
  for (const row of [...rows].sort(compareCandidates)) {
    if (selected.length >= options.targetRecommendationsPerFullMonth) break
    const symbolCount = symbolCounts.get(row.symbol) ?? 0
    if (options.maxSymbolPerFullMonth > 0 && symbolCount >= options.maxSymbolPerFullMonth) {
      incrementMap(skipCounts, `symbol_month_cap:${monthKey}`)
      continue
    }
    const patternCount = patternCounts.get(row.patternId) ?? 0
    if (options.maxPatternPerFullMonth > 0 && patternCount >= options.maxPatternPerFullMonth) {
      incrementMap(skipCounts, `pattern_month_cap:${monthKey}`)
      continue
    }
    symbolCounts.set(row.symbol, symbolCount + 1)
    patternCounts.set(row.patternId, patternCount + 1)
    selected.push({
      ...row,
      schedulerSelection: {
        kind: "tp12_monthly_quota_precision_scheduler_selection_v1",
        patchKey: PATCH_KEY,
        selectionKey: options.selectionKey,
        fullMonthKey: monthKey,
        rankWithinMonth: selected.length + 1,
        scoreField: options.scoreField,
        schedulerScore: row.schedulerScore,
        targetRecommendationsPerFullMonth: options.targetRecommendationsPerFullMonth,
        maxRecommendationsPerDay: options.maxRecommendationsPerDay,
        fixedScoreThreshold: options.minSchedulerScore,
        selectionUsesEntryExecutable: false,
        selectionUsesHitTarget: false,
      },
    })
  }
  return selected
}

const buildMonthDiagnostics = ({ options, loadStats, dailyCandidateRowsByMonth, selectedRows, monthlyCadence }) => {
  const selectedByMonth = new Map()
  for (const row of selectedRows) incrementMap(selectedByMonth, row.monthKey)
  const cadenceByMonth = new Map((monthlyCadence.fullMonthStats ?? []).map((row) => [row.monthKey, row]))
  return options.fullMonthKeys.map((monthKey) => {
    const cadence = cadenceByMonth.get(monthKey) ?? {}
    return {
      monthKey,
      inputCandidateRows: toNumber(loadStats.inputRowsByMonth.get(monthKey), 0),
      fixedScoreEligibleRows: toNumber(loadStats.eligibleRowsByMonth.get(monthKey), 0),
      dailyCandidateRows: toNumber(dailyCandidateRowsByMonth.get(monthKey), 0),
      selectedRows: toNumber(selectedByMonth.get(monthKey), 0),
      executableRecommendationCount: toNumber(cadence.executableRecommendationCount, 0),
      operationalHitRows: toNumber(cadence.operationalHitRows, 0),
      targetRecommendationsPerFullMonth: options.targetRecommendationsPerFullMonth,
      passedSelectedMinimum: toNumber(selectedByMonth.get(monthKey), 0) >= options.targetRecommendationsPerFullMonth,
      passedExecutableMinimum:
        toNumber(cadence.executableRecommendationCount, 0) >= options.targetRecommendationsPerFullMonth,
    }
  })
}

const buildRejectReasons = ({ metric, monthlyDiagnostics, concentration, options }) => {
  const reasons = []
  if (metric.selectedRows < options.minSelectedRows) reasons.push("selected_rows_below_min")
  if (metric.hitRate < options.targetObservedHitRate) reasons.push("operational_hit_rate_below_target")
  if (metric.wilsonLower95 < options.minWilsonLowerBound95) reasons.push("wilson_lower95_below_target")
  for (const row of monthlyDiagnostics) {
    if (row.inputCandidateRows < 1) reasons.push(`monthly_candidate_rows_zero:${row.monthKey}`)
    if (row.selectedRows < options.targetRecommendationsPerFullMonth) {
      reasons.push(`monthly_selected_recommendations_below_target:${row.monthKey}`)
    }
    if (row.executableRecommendationCount < options.targetRecommendationsPerFullMonth) {
      reasons.push(`monthly_executable_recommendations_below_target:${row.monthKey}`)
    }
  }
  if (concentration.symbol.topShare > options.maxTopSymbolShare) reasons.push("top_symbol_share_above_max")
  if (concentration.pattern.topShare > options.maxTopPatternShare) reasons.push("top_pattern_share_above_max")
  if (concentration.month.topShare > options.maxTopMonthShare) reasons.push("top_month_share_above_max")
  return reasons
}

const writeRows = async (filePath, rows) => {
  if (!toText(filePath)) return
  await ensureDir(path.dirname(filePath))
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await closeWriteStream(stream)
  }
}

export const buildTp12MonthlyQuotaPrecisionSchedulerSummary = async ({
  candidatesPath,
  contractPath = DEFAULT_TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_CONTRACT_PATH,
  outSummaryPath,
  outSelectionsPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = toText(contractPath) ? await readContract(contractPath) : null
  const options = resolveOptions({ contract, ...rawOptions })
  const loadStats = await loadSchedulerCandidates({ candidatesPath, options })
  const { dailyRows, dailyCandidateRowsByMonth } = buildDailyCandidates({ byDate: loadStats.byDate, options })
  const dailyRowsByMonth = new Map()
  for (const row of dailyRows) {
    const rows = dailyRowsByMonth.get(row.monthKey) ?? []
    rows.push(row)
    dailyRowsByMonth.set(row.monthKey, rows)
  }
  const skipCounts = new Map()
  const selectedRows = []
  for (const monthKey of options.fullMonthKeys) {
    selectedRows.push(
      ...selectMonthRows({
        monthKey,
        rows: dailyRowsByMonth.get(monthKey) ?? [],
        options,
        skipCounts,
      }),
    )
  }

  const metricState = initMetricState()
  const symbolCounts = new Map()
  const patternCounts = new Map()
  const monthCounts = new Map()
  for (const row of selectedRows) {
    addMetricRow(metricState, row, options.hitField)
    incrementMap(symbolCounts, row.symbol)
    incrementMap(patternCounts, row.patternId)
    incrementMap(monthCounts, row.monthKey)
  }
  const baseMetric = finalizeMetricState(metricState)
  const interval95 = wilsonInterval({ hitRows: baseMetric.hitRows, selectedRows: baseMetric.selectedRows })
  const metric = {
    ...baseMetric,
    observedHitRate: baseMetric.hitRate,
    wilsonLower95: interval95.lower,
    wilsonUpper95: interval95.upper,
  }
  const monthlyCadence = buildTp12MonthlyCadenceSummary(selectedRows, {
    minExecutableRecommendationsPerFullMonth: options.targetRecommendationsPerFullMonth,
    fullMonthKeys: options.fullMonthKeys,
    hitField: options.hitField,
  })
  const monthlyDiagnostics = buildMonthDiagnostics({
    options,
    loadStats,
    dailyCandidateRowsByMonth,
    selectedRows,
    monthlyCadence,
  })
  const concentration = {
    symbol: finalizeConcentration(symbolCounts, selectedRows.length),
    pattern: finalizeConcentration(patternCounts, selectedRows.length),
    month: finalizeConcentration(monthCounts, selectedRows.length),
  }
  const rejectReasons = buildRejectReasons({
    metric,
    monthlyDiagnostics,
    concentration,
    options,
  })
  const payload = {
    kind: TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_KIND,
    generatedAt: new Date().toISOString(),
    patchKey: PATCH_KEY,
    status: rejectReasons.length > 0 ? "failed" : "passed",
    verdict: rejectReasons.length > 0 ? "monthly_quota_precision_gate_failed" : "monthly_quota_precision_gate_passed",
    hitDefinition: options.hitDefinition,
    hitField: options.hitField,
    selectionKey: options.selectionKey,
    candidatesPath: path.resolve(candidatesPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    selectedRowsPath: toText(outSelectionsPath) ? path.resolve(outSelectionsPath) : null,
    inputRowCount: loadStats.inputRowCount,
    outsideFullMonthRowCount: loadStats.outsideFullMonthRowCount,
    fixedScoreRejectedRowCount: loadStats.fixedScoreRejectedRowCount,
    dailyCandidateRowCount: dailyRows.length,
    selectedRowCount: selectedRows.length,
    [options.selectionKey]: metric,
    monthlyCadence,
    monthlyDiagnostics,
    concentration,
    options: {
      fullMonthKeys: options.fullMonthKeys,
      scoreField: options.scoreField,
      patternIdFields: options.patternIdFields,
      selectionKey: options.selectionKey,
      targetRecommendationsPerFullMonth: options.targetRecommendationsPerFullMonth,
      maxRecommendationsPerFullMonth: options.maxRecommendationsPerFullMonth,
      maxRecommendationsPerDay: options.maxRecommendationsPerDay,
      minSchedulerScore: options.minSchedulerScore,
      targetObservedHitRate: options.targetObservedHitRate,
      minWilsonLowerBound95: options.minWilsonLowerBound95,
      minSelectedRows: options.minSelectedRows,
      maxTopSymbolShare: options.maxTopSymbolShare,
      maxTopPatternShare: options.maxTopPatternShare,
      maxTopMonthShare: options.maxTopMonthShare,
      maxSymbolPerFullMonth: options.maxSymbolPerFullMonth,
      maxPatternPerFullMonth: options.maxPatternPerFullMonth,
      entryExecutableUsedForSelection: false,
      hitTargetUsedForSelection: false,
      scoreThresholdRelaxed: false,
    },
    skipCounts: mapToSortedObject(skipCounts),
    rejectCounts: mapToSortedObject(loadStats.rejectCounts),
    rejectReasons,
  }
  await writeJson(outSummaryPath, payload)
  await writeRows(outSelectionsPath, selectedRows)
  if (payload.status !== "passed" && options.failOnGateFailure) {
    throw new Error(`tp12 monthly quota precision scheduler failed: ${rejectReasons.join("; ")}`)
  }
  return payload
}
