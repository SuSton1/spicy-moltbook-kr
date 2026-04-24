import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const rowDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)
const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const DEFAULT_CANDIDATE_RULES = [
  { field: "supportClusterCount", op: "le", threshold: 1 },
  { field: "supportClusterCount", op: "le", threshold: 2 },
  { field: "familyDiversity", op: "le", threshold: 1 },
  { field: "nearDuplicatePatternPenalty", op: "ge", threshold: 1 },
  { field: "nearDuplicatePatternPenalty", op: "ge", threshold: 2 },
  { field: "dayScoreMargin", op: "le", threshold: 0.05 },
  { field: "dayScoreMargin", op: "le", threshold: 0.1 },
  { field: "dayScoreMargin", op: "le", threshold: 0.25 },
  { field: "daySymbolDateCandidateRows", op: "ge", threshold: 75 },
  { field: "daySymbolDateCandidateRows", op: "ge", threshold: 125 },
  { field: "daySymbolDateCandidateRows", op: "ge", threshold: 200 },
  { field: "tradedValueRankPct", op: "ge", threshold: 0.5 },
  { field: "tradedValueRankPct", op: "ge", threshold: 0.75 },
  { field: "tradedValueRankPct", op: "ge", threshold: 0.9 },
  { field: "marketUpRatio", op: "le", threshold: 0.35 },
  { field: "marketUpRatio", op: "le", threshold: 0.45 },
  { field: "marketUpRatio", op: "ge", threshold: 0.7 },
  { field: "rangePct", op: "ge", threshold: 0.1 },
  { field: "rangePct", op: "ge", threshold: 0.15 },
  { field: "rangePct", op: "ge", threshold: 0.2 },
  { field: "closeLocation", op: "le", threshold: 0.25 },
  { field: "closeLocation", op: "le", threshold: 0.5 },
  { field: "return1d", op: "le", threshold: -0.05 },
  { field: "return1d", op: "ge", threshold: 0.1 },
  { field: "openToCloseReturn", op: "le", threshold: -0.05 },
  { field: "openToCloseReturn", op: "ge", threshold: 0.1 },
  { field: "limitUpProxyCount", op: "le", threshold: 1 },
  { field: "limitUpProxyCount", op: "ge", threshold: 20 },
  { field: "marketMedianReturn1d", op: "le", threshold: -0.015 },
]

const loadSelectorConfig = async (selectorConfigPath) => {
  const sourcePath = toText(selectorConfigPath)
  if (!sourcePath) throw new Error("selectorConfigPath is required")
  const config = await readJson(sourcePath, null)
  if (!config) throw new Error(`selector config not found: ${sourcePath}`)
  const selectionPolicyId = toText(config.selectionPolicyId ?? config.selectorKey ?? config.policyKey)
  if (!selectionPolicyId) throw new Error("selector config requires selectionPolicyId")
  const scoreField = toText(config.scoreField)
  if (!scoreField) throw new Error("selector config requires scoreField")
  return {
    selectionPolicyId,
    scoreField,
    minScore: toNumber(config.minScore, -Infinity),
    minSupportClusterCount: toNumber(config.minSupportClusterCount, 0),
    minDayScoreMargin: toNumber(config.minDayScoreMargin, 0),
    maxTradedValueRankPct: toNumber(config.maxTradedValueRankPct, Infinity),
    raw: config,
    sourcePath: path.resolve(sourcePath),
  }
}

const ruleId = ({ field, op, threshold }) => {
  const thresholdText = String(threshold).replaceAll("-", "neg").replaceAll(".", "p")
  return `veto_${field}_${op}_${thresholdText}`
}

const normalizeRule = (rule) => {
  const field = toText(rule?.field)
  const op = toText(rule?.op)
  const threshold = toNumber(rule?.threshold, NaN)
  if (!field) throw new Error("veto rule missing field")
  if (!["le", "ge"].includes(op)) throw new Error(`unsupported veto rule op for ${field}: ${op || "missing"}`)
  if (!Number.isFinite(threshold)) throw new Error(`veto rule threshold must be finite for ${field}`)
  return {
    kind: "tp12_veto_candidate_rule_v1",
    ruleId: toText(rule?.ruleId) || ruleId({ field, op, threshold }),
    field,
    op,
    threshold,
    reason: toText(rule?.reason) || `${field}_${op}_${threshold}`,
  }
}

const loadCandidateRules = async (candidateRulesPath = "") => {
  const sourcePath = toText(candidateRulesPath)
  if (!sourcePath) return DEFAULT_CANDIDATE_RULES.map(normalizeRule)
  const payload = await readJson(sourcePath, null)
  if (!payload) throw new Error(`candidate rules file not found: ${sourcePath}`)
  const rows = Array.isArray(payload) ? payload : payload.rules
  if (!Array.isArray(rows) || rows.length < 1) throw new Error(`candidate rules file has no rules: ${sourcePath}`)
  return rows.map(normalizeRule)
}

const loadFeatureRows = async (featuresPath, { scoreField }) => {
  const rows = []
  await iterateJsonlMaybeGzip(featuresPath, {
    strict: true,
    onRow: async (row, context) => {
      const decisionDateKey = rowDateKey(row)
      const symbol = rowSymbol(row)
      if (!symbol) throw new Error(`feature row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`feature row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`feature row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const score = toNumber(row?.[scoreField], NaN)
      if (!Number.isFinite(score)) throw new Error(`feature row missing numeric scoreField=${scoreField} at ${context.filePath}:${context.lineNumber}`)
      rows.push({ ...row, decisionDateKey, symbol, __selectorScore: score })
    },
  })
  if (rows.length < 1) throw new Error(`feature source produced zero rows: ${featuresPath}`)
  return rows
}

const getNumericField = (row, field, label) => {
  if (!Object.prototype.hasOwnProperty.call(row, field)) throw new Error(`veto rule field missing at ${label}: ${field}`)
  const numeric = toNumber(row[field], NaN)
  if (!Number.isFinite(numeric)) throw new Error(`veto rule field is not finite at ${label}: ${field}=${row[field]}`)
  return numeric
}

const ruleMatchesRow = (rule, row, label = "row") => {
  const value = getNumericField(row, rule.field, label)
  return rule.op === "le" ? value <= rule.threshold : value >= rule.threshold
}

const ruleSetId = (rules) => `veto_set__${rules.map((rule) => rule.ruleId).join("__and__")}`

const normalizeRuleSet = (rules) => {
  if (!Array.isArray(rules) || rules.length < 1) throw new Error("veto rule set requires at least one rule")
  const normalizedRules = rules.map(normalizeRule)
  const seen = new Set()
  for (const rule of normalizedRules) {
    if (seen.has(rule.ruleId)) throw new Error(`duplicate veto rule in rule set: ${rule.ruleId}`)
    seen.add(rule.ruleId)
  }
  return {
    kind: "tp12_veto_candidate_rule_set_v1",
    ruleSetId: ruleSetId(normalizedRules),
    matchMode: "all",
    ruleSetSize: normalizedRules.length,
    rules: normalizedRules,
  }
}

const ruleSetMatchesRow = (ruleSet, row, label = "row") => {
  if (ruleSet.matchMode !== "all") throw new Error(`unsupported veto rule set matchMode: ${ruleSet.matchMode}`)
  return ruleSet.rules.every((rule) => ruleMatchesRow(rule, row, label))
}

const buildCandidateRuleSets = (rules, options) => {
  const maxRuleSetSize = options.maxRuleSetSize
  const ruleSets = rules.map((rule) => normalizeRuleSet([rule]))
  if (maxRuleSetSize >= 2) {
    for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
        const left = rules[leftIndex]
        const right = rules[rightIndex]
        if (!options.allowSameFieldRulePairs && left.field === right.field) continue
        ruleSets.push(normalizeRuleSet([left, right]))
      }
    }
  }
  if (ruleSets.length > options.maxCandidateRuleSets) {
    throw new Error(
      `candidate veto rule set count ${ruleSets.length} exceeds maxCandidateRuleSets=${options.maxCandidateRuleSets}; narrow rules or raise the explicit cap`,
    )
  }
  return ruleSets
}

const gateTopCandidate = (row, config) => {
  if (!row) return { passed: false, reason: "no_candidate_after_veto" }
  if (row.__selectorScore < config.minScore) return { passed: false, reason: "score_below_min" }
  if (toNumber(row.supportClusterCount, 0) < config.minSupportClusterCount) {
    return { passed: false, reason: "support_cluster_count_below_min" }
  }
  if (toNumber(row.dayScoreMargin, 0) < config.minDayScoreMargin) return { passed: false, reason: "day_score_margin_below_min" }
  const maxTradedValueRankPct = toNumber(config.maxTradedValueRankPct, Infinity)
  if (Number.isFinite(maxTradedValueRankPct)) {
    const tradedValueRankPct = getNumericField(row, "tradedValueRankPct", `${row.decisionDateKey}/${row.symbol}`)
    if (tradedValueRankPct > maxTradedValueRankPct) return { passed: false, reason: "traded_value_rank_pct_above_max" }
  }
  return { passed: true, reason: "selected" }
}

const topClusterId = (row) => {
  if (Array.isArray(row?.supportClusterSummaries) && row.supportClusterSummaries[0]?.clusterId) {
    return toText(row.supportClusterSummaries[0].clusterId)
  }
  if (Array.isArray(row?.supportClusterIds) && row.supportClusterIds[0]) return toText(row.supportClusterIds[0])
  return null
}

const buildDateBuckets = (rows) => {
  const byDate = new Map()
  for (const row of rows) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) {
    dateRows.sort((left, right) => right.__selectorScore - left.__selectorScore || left.symbol.localeCompare(right.symbol))
  }
  return byDate
}

const evaluateSelection = async ({ byDate, config, vetoRuleSets = [], selectionKey, writePrediction }) => {
  let selectedRows = 0
  let hitRows = 0
  let vetoedCandidateRows = 0
  let abstainedDateCount = 0
  const abstainReasonCounts = new Map()
  const symbolCounts = new Map()
  const clusterCounts = new Map()
  const yearCounts = new Map()
  const monthCounts = new Map()
  for (const [decisionDateKey, dateRows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let vetoedForDate = 0
    const survivors = []
    for (const row of dateRows) {
      const vetoed = vetoRuleSets.some((ruleSet) => ruleSetMatchesRow(ruleSet, row, `${decisionDateKey}/${row.symbol}`))
      if (vetoed) {
        vetoedForDate += 1
      } else {
        survivors.push(row)
      }
    }
    vetoedCandidateRows += vetoedForDate
    const top = survivors[0] ?? null
    const gate = gateTopCandidate(top, config)
    if (!gate.passed) {
      abstainedDateCount += 1
      incrementMap(abstainReasonCounts, gate.reason)
      if (writePrediction) {
        await writePrediction({
          kind: "tp12_veto_rule_audit_prediction_v1",
          selectionKey,
          decisionDateKey,
          action: "abstain",
          abstainReason: gate.reason,
          candidateCount: dateRows.length,
          vetoedCandidateRows: vetoedForDate,
          topSymbolBeforeVeto: dateRows[0]?.symbol ?? null,
          topSymbolAfterVeto: top?.symbol ?? null,
          topScoreAfterVeto: top?.__selectorScore ?? null,
        })
      }
      continue
    }
    selectedRows += 1
    if (top.hitTarget === true) hitRows += 1
    incrementMap(symbolCounts, top.symbol)
    const clusterId = topClusterId(top)
    if (clusterId) incrementMap(clusterCounts, clusterId)
    incrementMap(yearCounts, decisionDateKey.slice(0, 4))
    incrementMap(monthCounts, decisionDateKey.slice(0, 7))
    if (writePrediction) {
      await writePrediction({
        kind: "tp12_veto_rule_audit_prediction_v1",
        selectionKey,
        decisionDateKey,
        action: "select",
        symbol: top.symbol,
        hitTarget: top.hitTarget === true,
        score: top.__selectorScore,
        supportPatternCount: toNumber(top.supportPatternCount, null),
        supportClusterCount: toNumber(top.supportClusterCount, null),
        topClusterId: clusterId,
        candidateCount: dateRows.length,
        vetoedCandidateRows: vetoedForDate,
      })
    }
  }
  const interval = wilsonInterval({ hitRows, selectedRows })
  const topShare = (map) => {
    const max = Math.max(...[...map.values()], 0)
    return selectedRows > 0 ? max / selectedRows : null
  }
  return {
    selectionKey,
    selectedRows,
    hitRows,
    falsePositiveRows: selectedRows - hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
    abstainedDateCount,
    abstainReasonCounts: mapToSortedObject(abstainReasonCounts),
    vetoedCandidateRows,
    concentration: {
      topSymbolShare: topShare(symbolCounts),
      topPatternClusterShare: topShare(clusterCounts),
      topYearShare: topShare(yearCounts),
      topMonthShare: topShare(monthCounts),
    },
    activeYears: yearCounts.size,
    activeMonths: monthCounts.size,
    topSymbols: mapToSortedObject(symbolCounts),
    topPatternClusters: mapToSortedObject(clusterCounts),
    byYear: mapToSortedObject(yearCounts),
    byMonth: mapToSortedObject(monthCounts),
  }
}

const gateRule = ({ result, baseline, options }) => {
  const precisionLift = result.hitRate - baseline.hitRate
  const selectedRowRatio = safeRatio(result.selectedRows, baseline.selectedRows)
  const selectedHitRatioVsBaselineHitRows = safeRatio(result.hitRows, baseline.hitRows)
  const rejectReasons = []
  if (result.selectedRows < options.minSelectedRows) rejectReasons.push("selected_rows_below_min")
  if (precisionLift < options.minPrecisionLift) rejectReasons.push("precision_lift_below_min")
  if (selectedHitRatioVsBaselineHitRows < options.minSelectedHitRatioVsBaselineHitRows) {
    rejectReasons.push("selected_hit_ratio_vs_baseline_below_min")
  }
  const h80RejectReasons = []
  if (result.selectedRows < options.h80MinSelectedRows) h80RejectReasons.push("h80_selected_rows_below_min")
  if (result.hitRate < options.h80TargetHitRate) h80RejectReasons.push("h80_observed_hit_rate_below_target")
  if (result.wilsonLower95 < options.h80MinWilsonLower95) h80RejectReasons.push("h80_wilson_lower95_below_target")
  return {
    precisionLift,
    selectedRowRatio,
    selectedHitRatioVsBaselineHitRows,
    passedDiagnosticGate: rejectReasons.length === 0,
    diagnosticRejectReasons: rejectReasons,
    passedH80Gate: h80RejectReasons.length === 0,
    h80RejectReasons,
  }
}

const defaultOptions = (raw = {}) => ({
  minSelectedRows: Math.max(0, Math.trunc(toNumber(raw.minSelectedRows, 100))),
  minPrecisionLift: toNumber(raw.minPrecisionLift, 0.03),
  minSelectedHitRatioVsBaselineHitRows: toNumber(raw.minSelectedHitRatioVsBaselineHitRows, 0.75),
  h80MinSelectedRows: Math.max(0, Math.trunc(toNumber(raw.h80MinSelectedRows, 100))),
  h80TargetHitRate: Math.min(1, Math.max(0, toNumber(raw.h80TargetHitRate, 0.8))),
  h80MinWilsonLower95: Math.min(1, Math.max(0, toNumber(raw.h80MinWilsonLower95, 0.8))),
  maxRuleSetSize: Math.max(1, Math.min(2, Math.trunc(toNumber(raw.maxRuleSetSize, 1)))),
  allowSameFieldRulePairs: raw.allowSameFieldRulePairs === true,
  maxCandidateRuleSets: Math.max(1, Math.trunc(toNumber(raw.maxCandidateRuleSets, 2000))),
})

const compareRuleAudits = (left, right) =>
  right.result.wilsonLower95 - left.result.wilsonLower95 ||
  right.result.hitRate - left.result.hitRate ||
  right.gate.precisionLift - left.gate.precisionLift ||
  right.result.selectedRows - left.result.selectedRows ||
  left.ruleSet.ruleSetId.localeCompare(right.ruleSet.ruleSetId)

export const trainTp12VetoBank = async ({
  featuresPath,
  selectorConfigPath,
  candidateRulesPath = "",
  outSummaryPath,
  outRulesPath,
  outPredictionsPath,
  options: rawOptions = {},
} = {}) => {
  if (!toText(featuresPath)) throw new Error("featuresPath is required")
  if (!fs.existsSync(featuresPath)) throw new Error(`features path not found: ${featuresPath}`)
  if (!toText(selectorConfigPath)) throw new Error("selectorConfigPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outRulesPath)) throw new Error("outRulesPath is required")
  if (!toText(outPredictionsPath)) throw new Error("outPredictionsPath is required")
  const config = await loadSelectorConfig(selectorConfigPath)
  const options = defaultOptions(rawOptions)
  const candidateRules = await loadCandidateRules(candidateRulesPath)
  const candidateRuleSets = buildCandidateRuleSets(candidateRules, options)
  const rows = await loadFeatureRows(featuresPath, { scoreField: config.scoreField })
  const byDate = buildDateBuckets(rows)
  const baseline = await evaluateSelection({
    byDate,
    config,
    vetoRuleSets: [],
    selectionKey: `${config.selectionPolicyId}__baseline`,
  })
  const audits = []
  for (const ruleSet of candidateRuleSets) {
    const result = await evaluateSelection({
      byDate,
      config,
      vetoRuleSets: [ruleSet],
      selectionKey: `${config.selectionPolicyId}__${ruleSet.ruleSetId}`,
    })
    audits.push({ ruleSet, result, gate: gateRule({ result, baseline, options }) })
  }
  audits.sort(compareRuleAudits)
  const diagnosticPassedRules = audits.filter((audit) => audit.gate.passedDiagnosticGate)
  const h80PassedRules = audits.filter((audit) => audit.gate.passedH80Gate)
  const bestDiagnosticRule = audits[0] ?? null
  await ensureDir(path.dirname(outPredictionsPath))
  const stream = fs.createWriteStream(outPredictionsPath, { encoding: "utf8" })
  try {
    await evaluateSelection({
      byDate,
      config,
      vetoRuleSets: [],
      selectionKey: `${config.selectionPolicyId}__baseline`,
      writePrediction: (row) => writeJsonlRow(stream, row),
    })
    if (bestDiagnosticRule) {
      await evaluateSelection({
        byDate,
        config,
        vetoRuleSets: [bestDiagnosticRule.ruleSet],
        selectionKey: `${config.selectionPolicyId}__best_diagnostic_${bestDiagnosticRule.ruleSet.ruleSetId}`,
        writePrediction: (row) => writeJsonlRow(stream, row),
      })
    }
  } finally {
    await closeWriteStream(stream)
  }
  const ruleBank = {
    kind: "tp12_veto_bank_rules_v1",
    generatedAt: new Date().toISOString(),
    status: "diagnostic_only_not_locked",
    reason: "candidate veto rules were selected on the supplied train-only feature rows; nested inner calibration is required before locked OOS use",
    selectionPolicyId: config.selectionPolicyId,
    selectorConfigPath: config.sourcePath,
    featuresPath: path.resolve(featuresPath),
    candidateRulesPath: toText(candidateRulesPath) ? path.resolve(candidateRulesPath) : null,
    lockedRuleCount: 0,
    lockedRules: [],
    diagnosticCandidateRuleSets: diagnosticPassedRules.map((audit) => ({
      ...audit.ruleSet,
      result: audit.result,
      gate: audit.gate,
    })),
    diagnosticCandidateRules: diagnosticPassedRules
      .filter((audit) => audit.ruleSet.ruleSetSize === 1)
      .map((audit) => ({
        ...audit.ruleSet.rules[0],
        result: audit.result,
        gate: audit.gate,
      })),
  }
  const summary = {
    kind: "tp12_veto_bank_train_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "train_only_diagnostic",
    warning: "This artifact does not lock a production veto. Use nested inner folds before OOS application.",
    selectionPolicyId: config.selectionPolicyId,
    selectorConfigPath: config.sourcePath,
    featuresPath: path.resolve(featuresPath),
    candidateRulesPath: toText(candidateRulesPath) ? path.resolve(candidateRulesPath) : null,
    outRulesPath: path.resolve(outRulesPath),
    outPredictionsPath: path.resolve(outPredictionsPath),
    candidateRows: rows.length,
    candidateDateCount: byDate.size,
    options,
    baseline,
    candidateRuleCount: candidateRules.length,
    candidateRuleSetCount: candidateRuleSets.length,
    candidateRuleSetSizeCounts: mapToSortedObject(
      candidateRuleSets.reduce((map, ruleSet) => {
        incrementMap(map, String(ruleSet.ruleSetSize))
        return map
      }, new Map()),
    ),
    diagnosticPassedRuleCount: diagnosticPassedRules.length,
    h80PassedRuleCount: h80PassedRules.length,
    bestDiagnosticRuleSet: bestDiagnosticRule
      ? {
          ...bestDiagnosticRule.ruleSet,
          result: bestDiagnosticRule.result,
          gate: bestDiagnosticRule.gate,
        }
      : null,
    bestDiagnosticRule:
      bestDiagnosticRule?.ruleSet?.ruleSetSize === 1
        ? {
            ...bestDiagnosticRule.ruleSet.rules[0],
            result: bestDiagnosticRule.result,
            gate: bestDiagnosticRule.gate,
          }
        : null,
    ruleLeaderboard: audits.slice(0, 50).map((audit) => ({
      ...audit.ruleSet,
      result: audit.result,
      gate: audit.gate,
    })),
  }
  await ensureDir(path.dirname(outSummaryPath))
  await ensureDir(path.dirname(outRulesPath))
  await writeJson(outSummaryPath, summary)
  await writeJson(outRulesPath, ruleBank)
  return summary
}
