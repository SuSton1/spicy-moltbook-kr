import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const keyOf = (symbol, decisionDateKey) => `${decisionDateKey}\t${symbol}`
const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const rowDecisionDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)
const rowAction = (row) => toText(row?.action).toLowerCase()

const PROHIBITED_NUMERIC_FEATURE_FIELDS = new Set([
  "entryPrice",
  "targetPrice",
  "stopPrice",
  "maxForwardReturn",
  "maxForwardHighPct",
  "minForwardReturn",
  "minForwardLowPct",
  "maxForwardDrawdown",
  "availableForwardBars",
  "dayRank",
  "dayTopScore",
  "daySecondScore",
  "dayScoreMargin",
])

const finiteMetric = (row, keys) => {
  for (const key of keys) {
    const value = toNumber(row?.[key], NaN)
    if (Number.isFinite(value)) return value
  }
  return NaN
}

const assertDateRange = ({ decisionDateKey, context, dateFrom, dateTo, forbiddenDateFrom, forbiddenDateTo }) => {
  if (!validDateKey(decisionDateKey)) {
    throw new Error(`invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
  }
  if (dateFrom && decisionDateKey < dateFrom) {
    throw new Error(`row before allowed dateFrom at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
  }
  if (dateTo && decisionDateKey > dateTo) {
    throw new Error(`row after allowed dateTo at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
  }
  if (forbiddenDateFrom && forbiddenDateTo && decisionDateKey >= forbiddenDateFrom && decisionDateKey <= forbiddenDateTo) {
    throw new Error(`row falls inside forbidden date range at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
  }
}

const labelClassFor = ({ hitTarget, maxForwardReturn, targetPct, nearMissMinPct, hardNegativeMaxForwardReturnPct }) => {
  if (hitTarget) return "positive"
  if (maxForwardReturn >= nearMissMinPct) return "near_miss"
  if (maxForwardReturn <= hardNegativeMaxForwardReturnPct) return "hard_negative"
  if (maxForwardReturn < targetPct) return "easy_negative"
  throw new Error(`non-hit path reaches target boundary: ${maxForwardReturn}`)
}

const binMaxForwardReturn = (value) => {
  if (!Number.isFinite(value)) return "missing"
  if (value < 0) return "lt_0"
  if (value < 0.04) return "0_to_4pct"
  if (value < 0.08) return "4_to_8pct"
  if (value < 0.12) return "8_to_12pct"
  return "gte_12pct"
}

const binDrawdown = (value) => {
  if (!Number.isFinite(value)) return "missing"
  if (value <= -0.12) return "lte_m12pct"
  if (value <= -0.08) return "m12_to_m8pct"
  if (value <= -0.04) return "m8_to_m4pct"
  if (value < 0) return "m4_to_0pct"
  return "gte_0pct"
}

const extractAsOfNumericFeatures = (row) => {
  const features = new Map()
  for (const [key, value] of Object.entries(row ?? {})) {
    if (PROHIBITED_NUMERIC_FEATURE_FIELDS.has(key)) continue
    if (["symbol", "decisionDateKey", "dateKey", "asOfFeatureDateKey", "hitDateKey", "entryDateKey", "stopDateKey"].includes(key)) {
      continue
    }
    if (["kind", "foldId", "labelClass", "classificationReason", "contextMode"].includes(key)) continue
    if (key.toLowerCase().includes("future") || key.toLowerCase().includes("forward")) continue
    if (typeof value !== "number") continue
    if (!Number.isFinite(value)) continue
    features.set(key, value)
  }
  return features
}

const normalizePathLabel = ({ row, context, options }) => {
  const symbol = rowSymbol(row)
  const decisionDateKey = rowDecisionDateKey(row)
  if (!symbol) throw new Error(`path label row missing symbol at ${context.filePath}:${context.lineNumber}`)
  assertDateRange({ decisionDateKey, context, ...options })
  if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
    throw new Error(`path label row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
  }
  const maxForwardReturn = finiteMetric(row, ["maxForwardReturn", "maxForwardHighPct", "forwardMaxReturn"])
  const minForwardReturn = finiteMetric(row, ["minForwardReturn", "minForwardLowPct"])
  if (!Number.isFinite(maxForwardReturn)) {
    throw new Error(`path label row missing maxForwardReturn/maxForwardHighPct at ${context.filePath}:${context.lineNumber}`)
  }
  if (!Number.isFinite(minForwardReturn)) {
    throw new Error(`path label row missing minForwardReturn/minForwardLowPct at ${context.filePath}:${context.lineNumber}`)
  }
  const maxForwardDrawdown = finiteMetric(row, ["maxForwardDrawdown"])
  const hitTarget = row.hitTarget === true
  const labelClass = labelClassFor({
    hitTarget,
    maxForwardReturn,
    targetPct: options.targetPct,
    nearMissMinPct: options.nearMissMinPct,
    hardNegativeMaxForwardReturnPct: options.hardNegativeMaxForwardReturnPct,
  })
  return {
    symbol,
    decisionDateKey,
    key: keyOf(symbol, decisionDateKey),
    hitTarget,
    labelClass,
    entryDateKey: toText(row?.entryDateKey) || null,
    hitDateKey: toText(row?.hitDateKey) || null,
    stopDateKey: toText(row?.stopDateKey) || null,
    targetBeforeStop: row?.targetBeforeStop === true,
    stopBeforeTarget: row?.stopBeforeTarget === true,
    sameBarAmbiguous: row?.sameBarAmbiguous === true,
    maxForwardReturn,
    minForwardReturn,
    maxForwardDrawdown: Number.isFinite(maxForwardDrawdown) ? maxForwardDrawdown : Math.min(0, minForwardReturn),
    availableForwardBars: toNumber(row?.availableForwardBars, null),
  }
}

const assertCompatibleLabel = (existing, incoming, tolerance, contextLabel) => {
  if (existing.hitTarget !== incoming.hitTarget) throw new Error(`conflicting hitTarget for ${contextLabel}: ${incoming.key}`)
  if (existing.labelClass !== incoming.labelClass) throw new Error(`conflicting labelClass for ${contextLabel}: ${incoming.key}`)
  for (const field of ["maxForwardReturn", "minForwardReturn", "maxForwardDrawdown"]) {
    if (Math.abs(existing[field] - incoming[field]) > tolerance) {
      throw new Error(`conflicting ${field} for ${contextLabel}: ${incoming.key}`)
    }
  }
  for (const field of ["entryDateKey", "hitDateKey", "stopDateKey"]) {
    if (existing[field] && incoming[field] && existing[field] !== incoming[field]) {
      throw new Error(`conflicting ${field} for ${contextLabel}: ${incoming.key}`)
    }
  }
}

const loadPathLabels = async ({ pathLabelPath, options }) => {
  const byKey = new Map()
  let rowCount = 0
  await iterateJsonlMaybeGzip(pathLabelPath, {
    strict: true,
    onRow: async (row, context) => {
      rowCount += 1
      const label = normalizePathLabel({ row, context, options })
      const existing = byKey.get(label.key)
      if (existing) {
        assertCompatibleLabel(existing, label, options.conflictTolerance, "path labels")
      } else {
        byKey.set(label.key, label)
      }
    },
  })
  if (byKey.size < 1) throw new Error(`path label source produced zero symbol/date labels: ${pathLabelPath}`)
  return { byKey, rowCount }
}

const loadCandidateRows = async ({ candidatePath, labelsByKey, options }) => {
  const rows = []
  const byDate = new Map()
  await iterateJsonlMaybeGzip(candidatePath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDecisionDateKey(row)
      if (!symbol) throw new Error(`candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
      assertDateRange({ decisionDateKey, context, ...options })
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`candidate row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const key = keyOf(symbol, decisionDateKey)
      const label = labelsByKey.get(key)
      if (!label) throw new Error(`candidate row missing path label: ${decisionDateKey}::${symbol}`)
      if (label.hitTarget !== (row.hitTarget === true)) throw new Error(`candidate hitTarget conflicts with path label: ${decisionDateKey}::${symbol}`)
      const enriched = {
        ...label,
        selectorScore: toNumber(row?.selectorScore ?? row?.score, null),
        supportPatternCount: toNumber(row?.supportPatternCount, null),
        supportClusterCount: toNumber(row?.supportClusterCount, null),
        dayRank: toNumber(row?.dayRank, null),
        topClusterId: Array.isArray(row?.supportClusterIds) ? toText(row.supportClusterIds[0]) || null : null,
        asOfNumericFeatures: extractAsOfNumericFeatures(row),
      }
      rows.push(enriched)
      const dateRows = byDate.get(decisionDateKey) ?? []
      dateRows.push(enriched)
      byDate.set(decisionDateKey, dateRows)
    },
  })
  if (rows.length < 1) throw new Error(`candidate source produced zero rows: ${candidatePath}`)
  return { rows, byDate }
}

const loadPredictions = async ({ predictionsPath, labelsByKey, options }) => {
  const rows = []
  const selected = []
  let predictionRowCount = 0
  let abstainRowCount = 0
  await iterateJsonlMaybeGzip(predictionsPath, {
    strict: true,
    onRow: async (row, context) => {
      predictionRowCount += 1
      const action = rowAction(row)
      const decisionDateKey = rowDecisionDateKey(row)
      assertDateRange({ decisionDateKey, context, ...options })
      if (action === "abstain") {
        abstainRowCount += 1
        rows.push({ action, decisionDateKey })
        return
      }
      if (action !== "select") throw new Error(`unsupported prediction action at ${context.filePath}:${context.lineNumber}: ${action || "missing"}`)
      const symbol = rowSymbol(row)
      if (!symbol) throw new Error(`selected prediction row missing symbol at ${context.filePath}:${context.lineNumber}`)
      const key = keyOf(symbol, decisionDateKey)
      const label = labelsByKey.get(key)
      if (!label) throw new Error(`selected prediction missing path label: ${decisionDateKey}::${symbol}`)
      if (Object.prototype.hasOwnProperty.call(row, "hitTarget") && label.hitTarget !== (row.hitTarget === true)) {
        throw new Error(`prediction hitTarget conflicts with path label: ${decisionDateKey}::${symbol}`)
      }
      const enriched = {
        action,
        ...label,
        score: toNumber(row?.score, null),
        supportPatternCount: toNumber(row?.supportPatternCount, null),
        supportClusterCount: toNumber(row?.supportClusterCount, null),
        topClusterId: toText(row?.topClusterId) || null,
        candidateCount: toNumber(row?.candidateCount, null),
      }
      rows.push(enriched)
      selected.push(enriched)
    },
  })
  if (predictionRowCount < 1) throw new Error(`prediction source produced zero rows: ${predictionsPath}`)
  return { rows, selected, predictionRowCount, abstainRowCount }
}

const incrementLabelBins = (maps, row) => {
  incrementMap(maps.classCounts, row.labelClass)
  incrementMap(maps.maxForwardBins, binMaxForwardReturn(row.maxForwardReturn))
  incrementMap(maps.drawdownBins, binDrawdown(row.maxForwardDrawdown))
}

const sortedTopSamples = (rows, limit) =>
  rows
    .slice()
    .sort(
      (left, right) =>
        (right.sameDateBestPositiveMaxForwardReturn ?? 0) - (left.sameDateBestPositiveMaxForwardReturn ?? 0) ||
        left.decisionDateKey.localeCompare(right.decisionDateKey) ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, limit)

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const updateSeparabilityStats = ({ statsByField, selectedCandidate, positiveCandidates }) => {
  for (const [field, selectedValue] of selectedCandidate.asOfNumericFeatures.entries()) {
    const positiveValues = positiveCandidates
      .map((row) => row.asOfNumericFeatures.get(field))
      .filter((value) => Number.isFinite(value))
    if (positiveValues.length < 1) continue
    const positiveMax = Math.max(...positiveValues)
    const positiveMin = Math.min(...positiveValues)
    const positiveMean = positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length
    const stats =
      statsByField.get(field) ?? {
        field,
        comparisonCount: 0,
        positiveGreaterCount: 0,
        positiveLessCount: 0,
        selectedValueSum: 0,
        positiveMeanSum: 0,
        positiveMaxDeltaSum: 0,
        positiveMinDeltaSum: 0,
      }
    stats.comparisonCount += 1
    stats.selectedValueSum += selectedValue
    stats.positiveMeanSum += positiveMean
    if (positiveMax > selectedValue) {
      stats.positiveGreaterCount += 1
      stats.positiveMaxDeltaSum += positiveMax - selectedValue
    }
    if (positiveMin < selectedValue) {
      stats.positiveLessCount += 1
      stats.positiveMinDeltaSum += selectedValue - positiveMin
    }
    statsByField.set(field, stats)
  }
}

const summarizeSeparability = (statsByField, { minComparisonCount = 25, limit = 30 } = {}) => {
  const rows = [...statsByField.values()]
    .filter((row) => row.comparisonCount >= minComparisonCount)
    .map((row) => ({
      field: row.field,
      comparisonCount: row.comparisonCount,
      positiveGreaterCount: row.positiveGreaterCount,
      positiveGreaterShare: safeRatio(row.positiveGreaterCount, row.comparisonCount),
      positiveLessCount: row.positiveLessCount,
      positiveLessShare: safeRatio(row.positiveLessCount, row.comparisonCount),
      selectedValueMean: row.selectedValueSum / row.comparisonCount,
      positiveValueMean: row.positiveMeanSum / row.comparisonCount,
      averagePositiveMaxDeltaWhenGreater: safeRatio(row.positiveMaxDeltaSum, row.positiveGreaterCount),
      averagePositiveMinDeltaWhenLess: safeRatio(row.positiveMinDeltaSum, row.positiveLessCount),
    }))
  const topPositiveGreaterFields = rows
    .slice()
    .sort(
      (left, right) =>
        right.positiveGreaterShare - left.positiveGreaterShare ||
        right.averagePositiveMaxDeltaWhenGreater - left.averagePositiveMaxDeltaWhenGreater ||
        left.field.localeCompare(right.field),
    )
    .slice(0, limit)
  const topPositiveLessFields = rows
    .slice()
    .sort(
      (left, right) =>
        right.positiveLessShare - left.positiveLessShare ||
        right.averagePositiveMinDeltaWhenLess - left.averagePositiveMinDeltaWhenLess ||
        left.field.localeCompare(right.field),
    )
    .slice(0, limit)
  return {
    minComparisonCount,
    eligibleFieldCount: rows.length,
    topPositiveGreaterFields,
    topPositiveLessFields,
  }
}

export const buildTp12PathQualityLabelAudit = async ({
  pathLabelPath,
  candidatePath,
  predictionsPath,
  outSummaryPath,
  outSelectedPath,
  outDailyPath,
  dateFrom = "",
  dateTo = "",
  forbiddenDateFrom = "",
  forbiddenDateTo = "",
  targetPct = 0.12,
  nearMissMinPct = 0.08,
  hardNegativeMaxForwardReturnPct = 0.04,
  conflictTolerance = 1e-9,
  sampleLimit = 20,
  separabilityMinComparisonCount = 25,
} = {}) => {
  if (!toText(pathLabelPath)) throw new Error("pathLabelPath is required")
  if (!fs.existsSync(pathLabelPath)) throw new Error(`path label path not found: ${pathLabelPath}`)
  if (!toText(candidatePath)) throw new Error("candidatePath is required")
  if (!fs.existsSync(candidatePath)) throw new Error(`candidate path not found: ${candidatePath}`)
  if (!toText(predictionsPath)) throw new Error("predictionsPath is required")
  if (!fs.existsSync(predictionsPath)) throw new Error(`predictions path not found: ${predictionsPath}`)
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outSelectedPath)) throw new Error("outSelectedPath is required")
  if (!toText(outDailyPath)) throw new Error("outDailyPath is required")
  const options = {
    dateFrom: toText(dateFrom),
    dateTo: toText(dateTo),
    forbiddenDateFrom: toText(forbiddenDateFrom),
    forbiddenDateTo: toText(forbiddenDateTo),
    targetPct: toNumber(targetPct, 0.12),
    nearMissMinPct: toNumber(nearMissMinPct, 0.08),
    hardNegativeMaxForwardReturnPct: toNumber(hardNegativeMaxForwardReturnPct, 0.04),
    conflictTolerance: toNumber(conflictTolerance, 1e-9),
  }
  if (!Number.isFinite(options.targetPct) || options.targetPct <= 0) throw new Error(`invalid targetPct: ${targetPct}`)
  if (!Number.isFinite(options.nearMissMinPct) || options.nearMissMinPct < 0 || options.nearMissMinPct >= options.targetPct) {
    throw new Error(`invalid nearMissMinPct: ${nearMissMinPct}`)
  }
  if (
    !Number.isFinite(options.hardNegativeMaxForwardReturnPct) ||
    options.hardNegativeMaxForwardReturnPct < 0 ||
    options.hardNegativeMaxForwardReturnPct > options.nearMissMinPct
  ) {
    throw new Error(`invalid hardNegativeMaxForwardReturnPct: ${hardNegativeMaxForwardReturnPct}`)
  }
  if (!Number.isFinite(options.conflictTolerance) || options.conflictTolerance < 0) {
    throw new Error(`invalid conflictTolerance: ${conflictTolerance}`)
  }
  for (const [label, value] of [
    ["dateFrom", options.dateFrom],
    ["dateTo", options.dateTo],
    ["forbiddenDateFrom", options.forbiddenDateFrom],
    ["forbiddenDateTo", options.forbiddenDateTo],
  ]) {
    if (value && !validDateKey(value)) throw new Error(`invalid ${label}: ${value}`)
  }
  if (options.dateFrom && options.dateTo && options.dateFrom > options.dateTo) throw new Error("dateFrom must be <= dateTo")
  if (options.forbiddenDateFrom && options.forbiddenDateTo && options.forbiddenDateFrom > options.forbiddenDateTo) {
    throw new Error("forbiddenDateFrom must be <= forbiddenDateTo")
  }
  const normalizedSampleLimit = Math.max(0, Math.trunc(toNumber(sampleLimit, 20)))
  const normalizedSeparabilityMinComparisonCount = Math.max(1, Math.trunc(toNumber(separabilityMinComparisonCount, 25)))
  const labels = await loadPathLabels({ pathLabelPath, options })
  const candidates = await loadCandidateRows({ candidatePath, labelsByKey: labels.byKey, options })
  const predictions = await loadPredictions({ predictionsPath, labelsByKey: labels.byKey, options })

  await ensureDir(path.dirname(outSelectedPath))
  await ensureDir(path.dirname(outDailyPath))
  const selectedWriter = createJsonlWriteStreamMaybeGzip(outSelectedPath)
  const dailyWriter = createJsonlWriteStreamMaybeGzip(outDailyPath)

  const candidateMaps = { classCounts: new Map(), maxForwardBins: new Map(), drawdownBins: new Map() }
  const selectedMaps = { classCounts: new Map(), maxForwardBins: new Map(), drawdownBins: new Map() }
  const selectedFalsePositiveMaps = { classCounts: new Map(), maxForwardBins: new Map(), drawdownBins: new Map() }
  const selectedByYear = new Map()
  const selectedByMonth = new Map()
  const selectedFalsePositiveByReason = new Map()
  const sameDatePositiveSeparabilityStats = new Map()
  const selectedMissedHitSamples = []

  for (const row of candidates.rows) incrementLabelBins(candidateMaps, row)
  let candidateDateCount = 0
  let datesWithPositiveCandidate = 0
  let selectedRows = 0
  let hitRows = 0
  let falsePositiveRows = 0
  let falsePositiveWithSameDateHitCount = 0
  let falsePositiveNoSameDateHitCount = 0
  let abstainedDateWithPositiveCandidateCount = 0
  try {
    const selectedByDate = new Map(predictions.selected.map((row) => [row.decisionDateKey, row]))
    for (const [decisionDateKey, dateRows] of [...candidates.byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      candidateDateCount += 1
      const positiveCandidates = dateRows.filter((row) => row.hitTarget)
      const maxForwardReturn = Math.max(...dateRows.map((row) => row.maxForwardReturn))
      const bestPositiveMaxForwardReturn =
        positiveCandidates.length > 0 ? Math.max(...positiveCandidates.map((row) => row.maxForwardReturn)) : null
      if (positiveCandidates.length > 0) datesWithPositiveCandidate += 1
      const selected = selectedByDate.get(decisionDateKey) ?? null
      if (!selected && positiveCandidates.length > 0) abstainedDateWithPositiveCandidateCount += 1
      const dailyRow = {
        kind: "tp12_path_quality_daily_audit_row_v1",
        decisionDateKey,
        candidateCount: dateRows.length,
        positiveCandidateCount: positiveCandidates.length,
        hasPositiveCandidate: positiveCandidates.length > 0,
        maxForwardReturn,
        bestPositiveMaxForwardReturn,
        selectedSymbol: selected?.symbol ?? null,
        selectedHitTarget: selected?.hitTarget ?? null,
        selectedLabelClass: selected?.labelClass ?? null,
        selectedMaxForwardReturn: selected?.maxForwardReturn ?? null,
      }
      await writeJsonlRow(dailyWriter.stream, dailyRow)
    }
    for (const selected of predictions.selected) {
      const dateRows = candidates.byDate.get(selected.decisionDateKey)
      if (!dateRows) throw new Error(`selected prediction date has no candidate rows: ${selected.decisionDateKey}`)
      const candidate = dateRows.find((row) => row.symbol === selected.symbol)
      if (!candidate) throw new Error(`selected prediction is not in candidate universe: ${selected.decisionDateKey}::${selected.symbol}`)
      selectedRows += 1
      if (selected.hitTarget) hitRows += 1
      else falsePositiveRows += 1
      incrementMap(selectedByYear, selected.decisionDateKey.slice(0, 4))
      incrementMap(selectedByMonth, selected.decisionDateKey.slice(0, 7))
      incrementLabelBins(selectedMaps, selected)
      const positiveCandidates = dateRows.filter((row) => row.hitTarget)
      const sameDateBestPositiveMaxForwardReturn =
        positiveCandidates.length > 0 ? Math.max(...positiveCandidates.map((row) => row.maxForwardReturn)) : null
      const falsePositiveReason = selected.hitTarget
        ? "selected_hit"
        : positiveCandidates.length > 0
          ? "ranker_missed_same_date_hit"
          : "candidate_generation_no_hit_that_day"
      if (!selected.hitTarget) {
        incrementLabelBins(selectedFalsePositiveMaps, selected)
        incrementMap(selectedFalsePositiveByReason, falsePositiveReason)
        if (positiveCandidates.length > 0) falsePositiveWithSameDateHitCount += 1
        else falsePositiveNoSameDateHitCount += 1
        if (positiveCandidates.length > 0) {
          updateSeparabilityStats({
            statsByField: sameDatePositiveSeparabilityStats,
            selectedCandidate: candidate,
            positiveCandidates,
          })
        }
      }
      const selectedRow = {
        kind: "tp12_path_quality_selected_audit_row_v1",
        decisionDateKey: selected.decisionDateKey,
        symbol: selected.symbol,
        hitTarget: selected.hitTarget,
        labelClass: selected.labelClass,
        falsePositiveReason,
        score: selected.score,
        supportPatternCount: selected.supportPatternCount,
        supportClusterCount: selected.supportClusterCount,
        candidateCount: selected.candidateCount,
        sameDatePositiveCandidateCount: positiveCandidates.length,
        sameDateBestPositiveMaxForwardReturn,
        selectedMaxForwardReturn: selected.maxForwardReturn,
        selectedMinForwardReturn: selected.minForwardReturn,
        selectedMaxForwardDrawdown: selected.maxForwardDrawdown,
        selectedHitDateKey: selected.hitDateKey,
        selectedEntryDateKey: selected.entryDateKey,
      }
      await writeJsonlRow(selectedWriter.stream, selectedRow)
      if (falsePositiveReason === "ranker_missed_same_date_hit") selectedMissedHitSamples.push(selectedRow)
    }
  } finally {
    await selectedWriter.close()
    await dailyWriter.close()
  }

  const interval = wilsonInterval({ hitRows, selectedRows })
  const summary = {
    kind: "tp12_path_quality_label_audit_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    pathLabelPath: path.resolve(pathLabelPath),
    candidatePath: path.resolve(candidatePath),
    predictionsPath: path.resolve(predictionsPath),
    outSummaryPath: path.resolve(outSummaryPath),
    outSelectedPath: path.resolve(outSelectedPath),
    outDailyPath: path.resolve(outDailyPath),
    options: {
      dateFrom: options.dateFrom || null,
      dateTo: options.dateTo || null,
      forbiddenDateFrom: options.forbiddenDateFrom || null,
      forbiddenDateTo: options.forbiddenDateTo || null,
      targetPct: options.targetPct,
      nearMissMinPct: options.nearMissMinPct,
      hardNegativeMaxForwardReturnPct: options.hardNegativeMaxForwardReturnPct,
      conflictTolerance: options.conflictTolerance,
      separabilityMinComparisonCount: normalizedSeparabilityMinComparisonCount,
    },
    pathLabelRowCount: labels.rowCount,
    pathLabelSymbolDateCount: labels.byKey.size,
    candidateRows: candidates.rows.length,
    candidateDateCount,
    datesWithPositiveCandidate,
    dailyOracleHitRate: safeRatio(datesWithPositiveCandidate, candidateDateCount),
    predictionRowCount: predictions.predictionRowCount,
    abstainRowCount: predictions.abstainRowCount,
    selectedRows,
    hitRows,
    falsePositiveRows,
    hitRate: safeRatio(hitRows, selectedRows),
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
    falsePositiveWithSameDateHitCount,
    falsePositiveNoSameDateHitCount,
    falsePositiveWithSameDateHitShare: safeRatio(falsePositiveWithSameDateHitCount, falsePositiveRows),
    abstainedDateWithPositiveCandidateCount,
    candidatePathQuality: {
      classCounts: mapToSortedObject(candidateMaps.classCounts),
      maxForwardReturnBins: mapToSortedObject(candidateMaps.maxForwardBins),
      drawdownBins: mapToSortedObject(candidateMaps.drawdownBins),
    },
    selectedPathQuality: {
      classCounts: mapToSortedObject(selectedMaps.classCounts),
      maxForwardReturnBins: mapToSortedObject(selectedMaps.maxForwardBins),
      drawdownBins: mapToSortedObject(selectedMaps.drawdownBins),
      selectedByYear: mapToSortedObject(selectedByYear),
      selectedByMonth: mapToSortedObject(selectedByMonth),
    },
    selectedFalsePositivePathQuality: {
      classCounts: mapToSortedObject(selectedFalsePositiveMaps.classCounts),
      maxForwardReturnBins: mapToSortedObject(selectedFalsePositiveMaps.maxForwardBins),
      drawdownBins: mapToSortedObject(selectedFalsePositiveMaps.drawdownBins),
      reasonCounts: mapToSortedObject(selectedFalsePositiveByReason),
    },
    sameDatePositiveAsOfFeatureSeparability: summarizeSeparability(sameDatePositiveSeparabilityStats, {
      minComparisonCount: normalizedSeparabilityMinComparisonCount,
    }),
    topMissedHitSamples: sortedTopSamples(selectedMissedHitSamples, normalizedSampleLimit),
  }
  await ensureDir(path.dirname(outSummaryPath))
  await writeJson(outSummaryPath, summary)
  return summary
}
