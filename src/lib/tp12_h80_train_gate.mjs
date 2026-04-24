import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import { toBool, toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const policyKeyOf = (row) => toText(row?.selectorKey ?? row?.policyKey ?? row?.policyName ?? row?.selectionKey ?? row?.key ?? row?.name)

const metricFromPolicy = (row) => {
  if (!row || typeof row !== "object") return null
  if (Number.isFinite(Number(row.selectedRows)) && Number.isFinite(Number(row.hitRows))) return row
  if (row.bestTopCut && typeof row.bestTopCut === "object") {
    return {
      selectedRows: row.bestTopCut.topN ?? row.bestTopCut.selectedRows,
      hitRows: row.bestTopCut.hitRows,
    }
  }
  return null
}

const firstMetric = (summary, { selectorKey = "" } = {}) => {
  if (summary?.selected && typeof summary.selected === "object") return summary.selected
  if (Number.isFinite(Number(summary?.selectedRows)) && Number.isFinite(Number(summary?.hitRows))) return summary
  if (summary?.bestTopCut && typeof summary.bestTopCut === "object") {
    return {
      selectedRows: summary.bestTopCut.topN ?? summary.bestTopCut.selectedRows,
      hitRows: summary.bestTopCut.hitRows,
    }
  }
  const requestedSelectorKey = toText(selectorKey)
  if (Array.isArray(summary?.policySummaries)) {
    if (!requestedSelectorKey) {
      throw new Error("selector summary contains policySummaries; pass selectorKey to avoid post-hoc best-policy selection")
    }
    const matches = summary.policySummaries.filter((row) => policyKeyOf(row) === requestedSelectorKey)
    if (matches.length !== 1) {
      throw new Error(`selectorKey must match exactly one policy summary: ${requestedSelectorKey || "missing"}`)
    }
    const metric = metricFromPolicy(matches[0])
    if (metric) return metric
    throw new Error(`selected policy does not expose selectedRows/hitRows or bestTopCut: ${requestedSelectorKey}`)
  }
  throw new Error("selector summary does not expose selectedRows/hitRows or bestTopCut")
}

const metricSnapshot = (metric) => {
  const selectedRows = Math.max(0, Math.trunc(toNumber(metric.selectedRows ?? metric.topN, 0)))
  const hitRows = Math.max(0, Math.trunc(toNumber(metric.hitRows, 0)))
  if (hitRows > selectedRows) throw new Error(`invalid H80 metric: hitRows=${hitRows} selectedRows=${selectedRows}`)
  const interval = wilsonInterval({ hitRows, selectedRows })
  return {
    selectedRows,
    hitRows,
    falsePositiveRows: selectedRows - hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
  }
}

const concentrationValue = (summary, key) => {
  const direct = toNumber(summary?.[key], NaN)
  if (Number.isFinite(direct)) return direct
  const nested = toNumber(summary?.concentration?.[key], NaN)
  return Number.isFinite(nested) ? nested : null
}

const countObjectKeys = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : null)

const coverageValue = (summary, directKey, nestedKey, fallbackKey = "") => {
  const direct = toNumber(summary?.[directKey], NaN)
  if (Number.isFinite(direct)) return direct
  const nested = toNumber(summary?.coverage?.[nestedKey], NaN)
  if (Number.isFinite(nested)) return nested
  const counted = countObjectKeys(fallbackKey ? summary?.coverage?.[fallbackKey] : null)
  return counted === null ? null : counted
}

export const assertTp12H80TrainGate = async ({
  selectorSummaryPath,
  outPath,
  minSelectedRows = 100,
  minWilsonLower95 = 0.8,
  minObservedHitRate = 0.8,
  minActiveYears = 4,
  minActiveMonths = 24,
  maxTopSymbolShare = 0.1,
  maxTopPatternClusterShare = 0.35,
  maxTopRegimeShare = 0.5,
  maxTopMonthShare = 0.2,
  requireConcentration = true,
  requireCoverage = true,
  failOnGateFailure = true,
  selectorKey = "",
} = {}) => {
  if (!toText(selectorSummaryPath)) throw new Error("selectorSummaryPath is required")
  if (!toText(outPath)) throw new Error("outPath is required")
  const selectorSummary = await readJson(selectorSummaryPath, null)
  if (!selectorSummary) throw new Error(`selector summary not found: ${selectorSummaryPath}`)
  const selected = metricSnapshot(firstMetric(selectorSummary, { selectorKey }))
  const options = {
    minSelectedRows: Math.max(0, Math.trunc(toNumber(minSelectedRows, 100))),
    minWilsonLower95: Math.min(1, Math.max(0, toNumber(minWilsonLower95, 0.8))),
    minObservedHitRate: Math.min(1, Math.max(0, toNumber(minObservedHitRate, 0.8))),
    minActiveYears: Math.max(0, Math.trunc(toNumber(minActiveYears, 4))),
    minActiveMonths: Math.max(0, Math.trunc(toNumber(minActiveMonths, 24))),
    maxTopSymbolShare: Math.min(1, Math.max(0, toNumber(maxTopSymbolShare, 0.1))),
    maxTopPatternClusterShare: Math.min(1, Math.max(0, toNumber(maxTopPatternClusterShare, 0.35))),
    maxTopRegimeShare: Math.min(1, Math.max(0, toNumber(maxTopRegimeShare, 0.5))),
    maxTopMonthShare: Math.min(1, Math.max(0, toNumber(maxTopMonthShare, 0.2))),
    requireConcentration: toBool(requireConcentration, true),
    requireCoverage: toBool(requireCoverage, true),
  }
  const concentration = {
    topSymbolShare: concentrationValue(selectorSummary, "topSymbolShare"),
    topPatternClusterShare: concentrationValue(selectorSummary, "topPatternClusterShare"),
    topRegimeShare: concentrationValue(selectorSummary, "topRegimeShare"),
    topMonthShare: concentrationValue(selectorSummary, "topMonthShare"),
  }
  const coverage = {
    activeYearCount: coverageValue(selectorSummary, "activeYearCount", "activeYearCount", "selectedByYear"),
    activeMonthCount: coverageValue(selectorSummary, "activeMonthCount", "activeMonthCount", "selectedByMonth"),
  }
  const rejectReasons = []
  if (selected.selectedRows < options.minSelectedRows) rejectReasons.push("selected_rows_below_min")
  if (selected.hitRate < options.minObservedHitRate) rejectReasons.push("observed_hit_rate_below_min")
  if (selected.wilsonLower95 < options.minWilsonLower95) rejectReasons.push("wilson_lower95_below_min")
  if (options.requireConcentration) {
    for (const [key, value] of Object.entries(concentration)) {
      if (value === null) rejectReasons.push(`missing_${key}`)
    }
  }
  if (options.requireCoverage) {
    for (const [key, value] of Object.entries(coverage)) {
      if (value === null) rejectReasons.push(`missing_${key}`)
    }
  }
  if (coverage.activeYearCount !== null && coverage.activeYearCount < options.minActiveYears) {
    rejectReasons.push("active_year_count_below_min")
  }
  if (coverage.activeMonthCount !== null && coverage.activeMonthCount < options.minActiveMonths) {
    rejectReasons.push("active_month_count_below_min")
  }
  if (concentration.topSymbolShare !== null && concentration.topSymbolShare > options.maxTopSymbolShare) {
    rejectReasons.push("top_symbol_share_above_max")
  }
  if (concentration.topPatternClusterShare !== null && concentration.topPatternClusterShare > options.maxTopPatternClusterShare) {
    rejectReasons.push("top_pattern_cluster_share_above_max")
  }
  if (concentration.topRegimeShare !== null && concentration.topRegimeShare > options.maxTopRegimeShare) {
    rejectReasons.push("top_regime_share_above_max")
  }
  if (concentration.topMonthShare !== null && concentration.topMonthShare > options.maxTopMonthShare) {
    rejectReasons.push("top_month_share_above_max")
  }
  const payload = {
    kind: "tp12_h80_train_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: rejectReasons.length > 0 ? "failed" : "passed",
    verdict: rejectReasons.length > 0 ? "h80_train_gate_failed" : "h80_train_gate_passed",
    selectorSummaryPath: path.resolve(selectorSummaryPath),
    selectorKey: toText(selectorKey) || null,
    selected,
    concentration,
    coverage,
    options,
    rejectReasons,
  }
  await writeJson(outPath, payload)
  if (payload.status !== "passed" && toBool(failOnGateFailure, false)) {
    throw new Error(`tp12 H80 train gate failed: ${rejectReasons.join("; ")}`)
  }
  return payload
}
