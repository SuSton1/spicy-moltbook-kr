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
    requirePositiveSupportClusterCount: toNumber(config.minSupportClusterCount, 0) > 0,
    raw: config,
    sourcePath: path.resolve(sourcePath),
  }
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

const passAbstentionGate = (row, config) => {
  if (row.__selectorScore < config.minScore) return { passed: false, reason: "score_below_min" }
  if (toNumber(row.supportClusterCount, 0) < config.minSupportClusterCount) {
    return { passed: false, reason: "support_cluster_count_below_min" }
  }
  if (toNumber(row.dayScoreMargin, 0) < config.minDayScoreMargin) return { passed: false, reason: "day_score_margin_below_min" }
  const tradedValueRankPct = toNumber(row.tradedValueRankPct, null)
  if (tradedValueRankPct !== null && tradedValueRankPct > config.maxTradedValueRankPct) {
    return { passed: false, reason: "traded_value_rank_pct_above_max" }
  }
  return { passed: true, reason: "selected" }
}

const topClusterId = (row) => {
  if (Array.isArray(row.supportClusterSummaries) && row.supportClusterSummaries[0]?.clusterId) {
    return toText(row.supportClusterSummaries[0].clusterId)
  }
  if (Array.isArray(row.supportClusterIds) && row.supportClusterIds[0]) return toText(row.supportClusterIds[0])
  return null
}

export const runTp12AbstentionSelectorCv = async ({
  featuresPath,
  selectorConfigPath,
  outPredictionsPath,
  outSummaryPath,
} = {}) => {
  if (!toText(featuresPath)) throw new Error("featuresPath is required")
  if (!fs.existsSync(featuresPath)) throw new Error(`features path not found: ${featuresPath}`)
  if (!toText(outPredictionsPath)) throw new Error("outPredictionsPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const config = await loadSelectorConfig(selectorConfigPath)
  const rows = await loadFeatureRows(featuresPath, { scoreField: config.scoreField })
  const byDate = new Map()
  for (const row of rows) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  await ensureDir(path.dirname(outPredictionsPath))
  const stream = fs.createWriteStream(outPredictionsPath, { encoding: "utf8" })
  let selectedRows = 0
  let hitRows = 0
  let abstainedDateCount = 0
  const abstainReasonCounts = new Map()
  const symbolCounts = new Map()
  const clusterCounts = new Map()
  const regimeCounts = new Map()
  const yearCounts = new Map()
  const monthCounts = new Map()
  try {
    for (const [decisionDateKey, dateRows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      dateRows.sort((left, right) => right.__selectorScore - left.__selectorScore || left.symbol.localeCompare(right.symbol))
      const top = dateRows[0]
      const gate = passAbstentionGate(top, config)
      if (!gate.passed) {
        abstainedDateCount += 1
        incrementMap(abstainReasonCounts, gate.reason)
        await writeJsonlRow(stream, {
          kind: "tp12_abstention_selector_cv_prediction_v1",
          selectionPolicyId: config.selectionPolicyId,
          decisionDateKey,
          action: "abstain",
          abstainReason: gate.reason,
          candidateCount: dateRows.length,
          topSymbol: top.symbol,
          topScore: top.__selectorScore,
        })
        continue
      }
      selectedRows += 1
      if (top.hitTarget === true) hitRows += 1
      incrementMap(symbolCounts, top.symbol)
      incrementMap(yearCounts, decisionDateKey.slice(0, 4))
      incrementMap(monthCounts, decisionDateKey.slice(0, 7))
      const clusterId = topClusterId(top)
      if (clusterId) incrementMap(clusterCounts, clusterId)
      const regimeId = toText(top.regimeId ?? top.marketRegimeId)
      if (regimeId) incrementMap(regimeCounts, regimeId)
      await writeJsonlRow(stream, {
        kind: "tp12_abstention_selector_cv_prediction_v1",
        selectionPolicyId: config.selectionPolicyId,
        decisionDateKey,
        action: "select",
        symbol: top.symbol,
        hitTarget: top.hitTarget === true,
        score: top.__selectorScore,
        supportPatternCount: toNumber(top.supportPatternCount, null),
        supportClusterCount: toNumber(top.supportClusterCount, null),
        topClusterId: clusterId,
        regimeId: regimeId || null,
        candidateCount: dateRows.length,
      })
    }
  } finally {
    await closeWriteStream(stream)
  }
  const interval = wilsonInterval({ hitRows, selectedRows })
  const topCountShare = (map) => {
    const max = Math.max(...[...map.values()], 0)
    return selectedRows > 0 ? max / selectedRows : null
  }
  const summary = {
    kind: "tp12_abstention_selector_cv_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    selectionPolicyId: config.selectionPolicyId,
    selectorConfigPath: config.sourcePath,
    featuresPath: path.resolve(featuresPath),
    outPredictionsPath: path.resolve(outPredictionsPath),
    candidateRows: rows.length,
    candidateDateCount: byDate.size,
    selectedRows,
    hitRows,
    falsePositiveRows: selectedRows - hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
    abstainedDateCount,
    abstainReasonCounts: mapToSortedObject(abstainReasonCounts),
    concentration: {
      topSymbolShare: topCountShare(symbolCounts),
      topPatternClusterShare: topCountShare(clusterCounts),
      topRegimeShare: regimeCounts.size > 0 ? topCountShare(regimeCounts) : null,
      topMonthShare: topCountShare(monthCounts),
    },
    coverage: {
      activeYearCount: yearCounts.size,
      activeMonthCount: monthCounts.size,
      selectedByYear: mapToSortedObject(yearCounts),
      selectedByMonth: mapToSortedObject(monthCounts),
    },
    topSymbols: mapToSortedObject(symbolCounts),
    topPatternClusters: mapToSortedObject(clusterCounts),
    topRegimes: mapToSortedObject(regimeCounts),
  }
  await writeJson(outSummaryPath, summary)
  return summary
}
