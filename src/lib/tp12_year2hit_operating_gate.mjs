import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { toBool, toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"
import {
  evaluateTp12MonthlyCadence,
  isTp12OperationalHitDefinition,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

const DEFAULT_Z_95 = 1.959963984540054

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

export const wilsonInterval = ({ hitRows, selectedRows, z = DEFAULT_Z_95 } = {}) => {
  const n = Math.trunc(toNumber(selectedRows, 0))
  const k = Math.trunc(toNumber(hitRows, 0))
  if (n < 0 || k < 0 || k > n) throw new Error(`invalid Wilson counts: hitRows=${k} selectedRows=${n}`)
  if (n === 0) return { lower: 0, upper: 0, z }
  const p = k / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = p + z2 / (2 * n)
  const radius = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return {
    lower: Math.max(0, (center - radius) / denominator),
    upper: Math.min(1, (center + radius) / denominator),
    z,
  }
}

const deriveOptionsFromContract = (contract = {}) => {
  const config = contract.oosResultGate ?? {}
  const operational = contract.operationalHit ?? {}
  const cadence = contract.recommendationCadence ?? {}
  return {
    targetSelectionKey: config.targetSelectionKey,
    targetObservedHitRate: config.targetObservedHitRate,
    minWilsonLowerBound95: config.minWilsonLowerBound95,
    minSelectedRows: config.minSelectedRows,
    minUniqueMatchedDates: config.minUniqueMatchedDates,
    minUniqueMatchedSymbols: config.minUniqueMatchedSymbols,
    maxTop1DateShare: config.maxTop1DateShare,
    failOnGateFailure: config.failOnGateFailure,
    hitDefinition: config.hitDefinition ?? contract.hitDefinition,
    hitField: config.hitField ?? operational.operationalHitField ?? contract.hitField,
    requireMonthlyCadence: config.requireMonthlyCadence ?? cadence.requireMonthlyCadence ?? cadence.failOnMissingMonthlyCadence,
    minExecutableRecommendationsPerFullMonth:
      config.minExecutableRecommendationsPerFullMonth ?? cadence.minExecutableRecommendationsPerFullMonth,
  }
}

const firstText = (...values) => {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ""
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveOptionsFromContract(contract) : {}
  return {
    targetSelectionKey: firstText(raw.targetSelectionKey, contractOptions.targetSelectionKey, "onePickPerDay"),
    targetObservedHitRate: Math.min(1, Math.max(0, toNumber(raw.targetObservedHitRate ?? contractOptions.targetObservedHitRate, 0.8))),
    minWilsonLowerBound95: Math.min(1, Math.max(0, toNumber(raw.minWilsonLowerBound95 ?? contractOptions.minWilsonLowerBound95, 0.8))),
    minSelectedRows: Math.max(0, Math.trunc(toNumber(raw.minSelectedRows ?? contractOptions.minSelectedRows, 50))),
    minUniqueMatchedDates: Math.max(0, Math.trunc(toNumber(raw.minUniqueMatchedDates ?? contractOptions.minUniqueMatchedDates, 50))),
    minUniqueMatchedSymbols: Math.max(0, Math.trunc(toNumber(raw.minUniqueMatchedSymbols ?? contractOptions.minUniqueMatchedSymbols, 20))),
    maxTop1DateShare: Math.min(1, Math.max(0, toNumber(raw.maxTop1DateShare ?? contractOptions.maxTop1DateShare, 0.12))),
    hitDefinition: firstText(raw.hitDefinition, contractOptions.hitDefinition),
    hitField: firstText(raw.hitField, contractOptions.hitField, "hitTarget"),
    requireMonthlyCadence: toBool(raw.requireMonthlyCadence ?? contractOptions.requireMonthlyCadence, false),
    minExecutableRecommendationsPerFullMonth: Math.max(
      0,
      Math.trunc(toNumber(raw.minExecutableRecommendationsPerFullMonth ?? contractOptions.minExecutableRecommendationsPerFullMonth, 0)),
    ),
    failOnGateFailure: toBool(raw.failOnGateFailure ?? contractOptions.failOnGateFailure, false),
  }
}

const getSelectionMetric = ({ replaySummary, selectionKey }) => {
  const metric = replaySummary?.[selectionKey]
  if (!metric || typeof metric !== "object") {
    throw new Error(`replay summary is missing selection metric: ${selectionKey}`)
  }
  return metric
}

const metricSnapshot = ({ metric, selectionKey, options }) => {
  const selectedRows = Math.trunc(toNumber(metric.selectedRows, 0))
  const hitRows = Math.trunc(toNumber(metric.hitRows, 0))
  const observedHitRate = safeRatio(hitRows, selectedRows)
  const interval95 = wilsonInterval({ hitRows, selectedRows })
  return {
    selectionKey,
    hitDefinition:
      options.hitDefinition || (options.hitField === TP12_OPERATIONAL_HIT_FIELD ? TP12_OPERATIONAL_HIT_DEFINITION : "chart_hit_v1"),
    hitField: options.hitField,
    selectedRows,
    hitRows,
    observedHitRate,
    wilsonLower95: interval95.lower,
    wilsonUpper95: interval95.upper,
    uniqueMatchedDates: Math.trunc(toNumber(metric.uniqueMatchedDates, 0)),
    uniqueHitDates: Math.trunc(toNumber(metric.uniqueHitDates, 0)),
    dateHitRate: toNumber(metric.dateHitRate, safeRatio(toNumber(metric.uniqueHitDates, 0), toNumber(metric.uniqueMatchedDates, 0))),
    uniqueMatchedSymbols: Math.trunc(toNumber(metric.uniqueMatchedSymbols, 0)),
    uniqueHitSymbols: Math.trunc(toNumber(metric.uniqueHitSymbols, 0)),
    top1DateShare: toNumber(metric.top1DateShare, 0),
    top1HitDateShare: toNumber(metric.top1HitDateShare, 0),
  }
}

const buildRejectReasons = ({ selected, options, replaySummary }) => {
  const reasons = []
  if (isTp12OperationalHitDefinition(options.hitDefinition)) {
    if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) reasons.push("operational_hit_field_mismatch")
    if (toText(replaySummary.hitDefinition) !== TP12_OPERATIONAL_HIT_DEFINITION) reasons.push("replay_hit_definition_mismatch")
    if (toText(replaySummary.hitField) !== TP12_OPERATIONAL_HIT_FIELD) reasons.push("replay_hit_field_mismatch")
  }
  if (selected.selectedRows < options.minSelectedRows) reasons.push("selected_rows_below_min")
  if (selected.observedHitRate < options.targetObservedHitRate) reasons.push("observed_hit_rate_below_target")
  if (selected.wilsonLower95 < options.minWilsonLowerBound95) reasons.push("wilson_lower95_below_target")
  if (selected.uniqueMatchedDates < options.minUniqueMatchedDates) reasons.push("unique_matched_dates_below_min")
  if (selected.uniqueMatchedSymbols < options.minUniqueMatchedSymbols) reasons.push("unique_matched_symbols_below_min")
  if (selected.top1DateShare > options.maxTop1DateShare) reasons.push("top1_date_share_above_max")
  reasons.push(
    ...evaluateTp12MonthlyCadence(replaySummary.monthlyCadence, {
      minExecutableRecommendationsPerFullMonth: options.minExecutableRecommendationsPerFullMonth,
      requireMonthlyCadence: options.requireMonthlyCadence,
    }),
  )
  return reasons
}

const renderReport = (summary) => {
  const pct = (value) => `${(toNumber(value, 0) * 100).toFixed(2)}%`
  return [
    "# TP12 Year2Hit Operating Gate",
    "",
    `- status: ${summary.status}`,
    `- verdict: ${summary.verdict}`,
    `- selection key: ${summary.selected.selectionKey}`,
    `- selected rows: ${summary.selected.hitRows}/${summary.selected.selectedRows} = ${pct(summary.selected.observedHitRate)}`,
    `- Wilson lower95: ${pct(summary.selected.wilsonLower95)}`,
    `- target observed hit rate: ${pct(summary.options.targetObservedHitRate)}`,
    `- target Wilson lower95: ${pct(summary.options.minWilsonLowerBound95)}`,
    `- unique matched dates: ${summary.selected.uniqueMatchedDates}`,
    `- unique matched symbols: ${summary.selected.uniqueMatchedSymbols}`,
    `- top1DateShare: ${pct(summary.selected.top1DateShare)}`,
    `- reject reasons: ${summary.rejectReasons.length > 0 ? summary.rejectReasons.join(", ") : "none"}`,
    "",
  ].join("\n")
}

export const buildTp12Year2hitOperatingGateSummary = async ({
  replaySummaryPath,
  contractPath = "",
  outSummaryPath,
  outReportPath = "",
  ...rawOptions
} = {}) => {
  if (!toText(replaySummaryPath)) throw new Error("replaySummaryPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const replaySummary = await readJson(replaySummaryPath, null)
  if (!replaySummary) throw new Error(`replay summary not found: ${replaySummaryPath}`)
  if (!["measured", "passed"].includes(toText(replaySummary.status))) {
    throw new Error(`replay summary status is not measured: ${toText(replaySummary.status) || "missing"}`)
  }
  const contract = toText(contractPath) ? await readJson(contractPath, null) : null
  if (toText(contractPath) && !contract) throw new Error(`contract not found: ${contractPath}`)
  const options = resolveOptions({ contract, ...rawOptions })
  if (isTp12OperationalHitDefinition(options.hitDefinition) && options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`operational operating gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  const selected = metricSnapshot({
    metric: getSelectionMetric({ replaySummary, selectionKey: options.targetSelectionKey }),
    selectionKey: options.targetSelectionKey,
    options,
  })
  const rejectReasons = buildRejectReasons({ selected, options, replaySummary })
  const payload = {
    kind: "tp12_year2hit_operating_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: rejectReasons.length > 0 ? "failed" : "passed",
    verdict: rejectReasons.length > 0 ? "not_ready_for_live_operation" : "operating_gate_passed",
    hitDefinition:
      options.hitDefinition || (options.hitField === TP12_OPERATIONAL_HIT_FIELD ? TP12_OPERATIONAL_HIT_DEFINITION : "chart_hit_v1"),
    hitField: options.hitField,
    replaySummaryPath: path.resolve(replaySummaryPath),
    contractPath: contractPath ? path.resolve(contractPath) : null,
    replayDateRange: replaySummary.dateRange ?? null,
    catalogPatternCount: replaySummary.catalogPatternCount ?? null,
    catalogMatchedPatternCount: replaySummary.catalogMatchedPatternCount ?? null,
    rawPatternMatch: replaySummary.rawPatternMatch ?? null,
    symbolDateUnion: replaySummary.symbolDateUnion ?? null,
    monthlyCadence: replaySummary.monthlyCadence ?? null,
    selected,
    options,
    rejectReasons,
  }
  await writeJson(outSummaryPath, payload)
  if (toText(outReportPath)) {
    await ensureDir(path.dirname(outReportPath))
    await fs.writeFile(outReportPath, renderReport(payload), "utf8")
  }
  if (payload.status !== "passed" && options.failOnGateFailure) {
    throw new Error(`tp12 year2hit operating gate failed: ${rejectReasons.join("; ")}`)
  }
  return payload
}
