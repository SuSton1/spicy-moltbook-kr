import path from "node:path"

import { writeJson, writeJsonl } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import { assertTp12PrecisionFirstDailyOnlyContract } from "./tp12_precision_first_contract_assert.mjs"
import {
  assertLiveFeatureFieldList,
  assertNoForbiddenScopeFields,
  PATCH_KEY,
} from "./tp12_precision_first_feature_whitelist.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  validDateKey,
} from "./tp12_year2hit_foundation_io.mjs"

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const keyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`

const numeric = (row, field, contextLabel) => {
  const value = toNumber(row?.[field], NaN)
  if (!Number.isFinite(value)) throw new Error(`${contextLabel} missing finite ${field}`)
  return value
}

const optionalNumeric = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const requireDate = ({ decisionDateKey, contextLabel, trainDateRange, forbiddenOosDateRange }) => {
  if (!validDateKey(decisionDateKey)) throw new Error(`${contextLabel} invalid decisionDateKey: ${decisionDateKey || "missing"}`)
  if (decisionDateKey >= forbiddenOosDateRange.from && decisionDateKey <= forbiddenOosDateRange.to) {
    throw new Error(`${contextLabel} date inside forbidden OOS range ${forbiddenOosDateRange.from}..${forbiddenOosDateRange.to}: ${decisionDateKey}`)
  }
  if (decisionDateKey < trainDateRange.from || decisionDateKey > trainDateRange.to) {
    throw new Error(`${contextLabel} date outside train range ${trainDateRange.from}..${trainDateRange.to}: ${decisionDateKey}`)
  }
}

const clusterWeightStats = (row, contextLabel) => {
  if (!Array.isArray(row.supportClusterSummaries) || row.supportClusterSummaries.length < 1) {
    throw new Error(`${contextLabel} missing supportClusterSummaries`)
  }
  const weights = row.supportClusterSummaries.map((item) => Math.max(0, optionalNumeric(item?.patternCount, 0)))
  const total = weights.reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    return {
      clusterEntropy: 0,
      effectiveClusterSupport: 0,
      topClusterWeightShare: 0,
      topClusterId: toText(row.supportClusterSummaries[0]?.clusterId) || "unknown",
      topPatternId: Array.isArray(row.supportClusterSummaries[0]?.patternIds)
        ? toText(row.supportClusterSummaries[0].patternIds[0]) || "unknown"
        : "unknown",
    }
  }
  let entropy = 0
  let maxWeight = -1
  let topClusterId = "unknown"
  let topPatternId = "unknown"
  row.supportClusterSummaries.forEach((item, index) => {
    const weight = weights[index]
    const share = weight / total
    if (share > 0) entropy -= share * Math.log(share)
    if (weight > maxWeight) {
      maxWeight = weight
      topClusterId = toText(item?.clusterId) || "unknown"
      topPatternId = Array.isArray(item?.patternIds) ? toText(item.patternIds[0]) || "unknown" : "unknown"
    }
  })
  return {
    clusterEntropy: entropy,
    effectiveClusterSupport: Math.exp(entropy),
    topClusterWeightShare: maxWeight / total,
    topClusterId,
    topPatternId,
  }
}

const REQUIRED_NUMERIC_FIELDS = [
  "supportPatternCount",
  "supportClusterCount",
  "familyDiversity",
  "sumClusterRowEb",
  "meanClusterRowEb",
  "maxClusterRowEb",
  "maxClusterRowWilsonLB",
  "supportWeightedClusterRowEb",
  "selectorScore",
  "dayCandidateRows",
  "dayUniquePatterns",
  "return1d",
  "return3d",
  "return5d",
  "return10d",
  "return20d",
  "gapPct",
  "rangePct",
  "closeLocation",
  "tradedValue",
  "tradedValueRel20",
  "tradedValueRel60",
  "rangeRel20",
  "returnVol20",
  "closeToHigh20Pct",
  "closeFromLow20Pct",
  "marketUpRatio",
  "marketUpRatio20",
  "marketMeanReturn1d",
  "marketMeanReturn5",
  "marketMeanReturn20",
  "marketMeanTradedValue",
  "limitUpProxyRel20",
]

const RANK_FIELDS = [
  "supportPatternCount",
  "supportClusterCount",
  "familyDiversity",
  "sumClusterRowEb",
  "meanClusterRowEb",
  "maxClusterRowEb",
  "maxClusterRowWilsonLB",
  "supportWeightedClusterRowEb",
  "selectorScore",
  "supportSaturated",
  "supportQualityRatio",
  "supportWeightedPerCluster",
  "supportOvercrowdRatio",
  "effectiveClusterSupport",
  "topClusterWeightShare",
  "return1d",
  "return3d",
  "return5d",
  "return10d",
  "return20d",
  "gapPct",
  "rangePct",
  "closeLocation",
  "tradedValue",
  "tradedValueRel20",
  "tradedValueRel60",
  "rangeRel20",
  "returnVol20",
  "closeToHigh20Pct",
  "closeFromLow20Pct",
  "marketUpRatio",
  "marketUpRatio20",
  "marketMeanReturn1d",
  "marketMeanReturn5",
  "marketMeanReturn20",
  "limitUpProxyRel20",
  "closeNearHigh20",
  "qualityScoreRaw",
  "liquidityScoreRaw",
  "exhaustionScoreRaw",
  "correctedExhaustionScore",
]

const normalizeRow = ({ row, rowIndex, contextLabel, contract }) => {
  assertNoForbiddenScopeFields(row, { contextLabel })
  const symbol = toText(row?.symbol).toUpperCase()
  const decisionDateKey = toText(row?.decisionDateKey ?? row?.dateKey)
  if (!symbol) throw new Error(`${contextLabel} missing symbol`)
  requireDate({
    decisionDateKey,
    contextLabel,
    trainDateRange: contract.trainDateRange,
    forbiddenOosDateRange: contract.forbiddenOosDateRange,
  })
  if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) throw new Error(`${contextLabel} missing hitTarget`)
  for (const field of REQUIRED_NUMERIC_FIELDS) numeric(row, field, contextLabel)
  const supportClusterCount = numeric(row, "supportClusterCount", contextLabel)
  const supportSaturated = Math.log1p(Math.max(0, supportClusterCount))
  const supportQualityRatio = numeric(row, "sumClusterRowEb", contextLabel) / Math.max(1, supportSaturated)
  const supportWeightedPerCluster = numeric(row, "supportWeightedClusterRowEb", contextLabel) / Math.max(1, supportClusterCount)
  const supportOvercrowdRatio = supportClusterCount / Math.max(1, numeric(row, "dayUniquePatterns", contextLabel))
  const clusterStats = clusterWeightStats(row, contextLabel)
  const closeNearHigh20 = 1 + numeric(row, "closeToHigh20Pct", contextLabel)
  const qualityScoreRaw = (
    numeric(row, "maxClusterRowWilsonLB", contextLabel) +
    numeric(row, "maxClusterRowEb", contextLabel) +
    supportQualityRatio +
    supportWeightedPerCluster
  ) / 4
  const liquidityScoreRaw = (
    numeric(row, "tradedValueRel20", contextLabel) +
    numeric(row, "tradedValueRel60", contextLabel) +
    Math.log1p(Math.max(0, numeric(row, "tradedValue", contextLabel))) / 30
  ) / 3
  const exhaustionScoreRaw = (
    Math.max(0, numeric(row, "return1d", contextLabel)) +
    Math.max(0, numeric(row, "return3d", contextLabel)) +
    Math.max(0, numeric(row, "return5d", contextLabel)) +
    Math.max(0, numeric(row, "gapPct", contextLabel)) +
    Math.max(0, numeric(row, "rangeRel20", contextLabel)) +
    Math.max(0, numeric(row, "tradedValueRel20", contextLabel)) +
    Math.max(0, numeric(row, "returnVol20", contextLabel))
  )
  const correctedExhaustionScore = exhaustionScoreRaw + Math.max(0, closeNearHigh20)
  return {
    ...row,
    rowIndex,
    symbol,
    decisionDateKey,
    key: `${decisionDateKey}\t${symbol}`,
    hitTarget: row.hitTarget === true,
    supportSaturated,
    supportQualityRatio,
    supportWeightedPerCluster,
    supportOvercrowdRatio,
    closeNearHigh20,
    qualityScoreRaw,
    liquidityScoreRaw,
    exhaustionScoreRaw,
    correctedExhaustionScore,
    ...clusterStats,
  }
}

const percentileRanks = (rows, field) => {
  const sorted = [...rows].sort((left, right) => {
    const diff = optionalNumeric(left[field], 0) - optionalNumeric(right[field], 0)
    if (diff !== 0) return diff
    return left.key.localeCompare(right.key)
  })
  const ranks = new Map()
  const denominator = Math.max(1, sorted.length - 1)
  sorted.forEach((row, index) => ranks.set(row.rowIndex, index / denominator))
  return ranks
}

const attachWithinDateRanks = (rows) => {
  const byDate = new Map()
  for (const row of rows) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) {
    const rankMaps = new Map()
    for (const field of RANK_FIELDS) rankMaps.set(field, percentileRanks(dateRows, field))
    for (const row of dateRows) {
      row.rank = {}
      for (const field of RANK_FIELDS) {
        const high = rankMaps.get(field).get(row.rowIndex) ?? 0
        row.rank[`${field}High`] = high
        row.rank[`${field}Low`] = 1 - high
      }
    }
  }
}

const buildControlCell = (row) => {
  const bucket = (value, cuts) => {
    for (let index = 0; index < cuts.length; index += 1) {
      if (value <= cuts[index]) return index
    }
    return cuts.length
  }
  return [
    row.decisionDateKey,
    bucket(row.tradedValueRel20, [-0.5, 0, 0.5, 1.5]),
    bucket(row.rangeRel20, [-0.5, 0, 0.5, 1.5]),
    bucket(row.return20d, [-0.2, -0.05, 0.05, 0.2]),
    bucket(row.marketUpRatio, [0.35, 0.45, 0.55, 0.65]),
  ].join("|")
}

const loadCandidateRows = async ({ candidatesPath, contract }) => {
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  const rows = []
  let inputRowCount = 0
  await iterateJsonlMaybeGzip(candidatesPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      rows.push(normalizeRow({
        row,
        rowIndex: rows.length,
        contextLabel: `${context.filePath}:${context.lineNumber}`,
        contract,
      }))
    },
  })
  if (rows.length < 1) throw new Error(`candidate input produced zero rows: ${candidatesPath}`)
  attachWithinDateRanks(rows)
  for (const row of rows) row.controlCell = buildControlCell(row)
  return { rows, inputRowCount }
}

const topShare = (map, total) => {
  let topKey = null
  let topCount = 0
  for (const [key, count] of map.entries()) {
    if (count > topCount || (count === topCount && toText(key).localeCompare(toText(topKey)) < 0)) {
      topKey = key
      topCount = count
    }
  }
  return { topKey, topCount, topShare: safeRatio(topCount, total) }
}

const metricForRows = ({ rows, baselineRows = null }) => {
  const selectedRows = rows.length
  const hitRows = rows.filter((row) => row.hitTarget).length
  const interval = wilsonInterval({ hitRows, selectedRows })
  const symbolCounts = new Map()
  const dateCounts = new Map()
  const monthCounts = new Map()
  const yearCounts = new Map()
  const clusterCounts = new Map()
  const patternCounts = new Map()
  for (const row of rows) {
    incrementMap(symbolCounts, row.symbol)
    incrementMap(dateCounts, row.decisionDateKey)
    incrementMap(monthCounts, row.decisionDateKey.slice(0, 7))
    incrementMap(yearCounts, row.decisionDateKey.slice(0, 4))
    incrementMap(clusterCounts, row.topClusterId || "unknown")
    incrementMap(patternCounts, row.topPatternId || "unknown")
  }
  const baselineHitRate = baselineRows ? safeRatio(baselineRows.filter((row) => row.hitTarget).length, baselineRows.length) : null
  return {
    selectedRows,
    hitRows,
    falsePositiveRows: selectedRows - hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    hitRateLift: baselineHitRate === null ? null : safeRatio(hitRows, selectedRows) - baselineHitRate,
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
    activeYears: yearCounts.size,
    activeMonths: monthCounts.size,
    activeDates: dateCounts.size,
    uniqueSymbols: symbolCounts.size,
    concentration: {
      topSymbol: topShare(symbolCounts, selectedRows).topKey,
      topSymbolShare: topShare(symbolCounts, selectedRows).topShare,
      topDate: topShare(dateCounts, selectedRows).topKey,
      topDateShare: topShare(dateCounts, selectedRows).topShare,
      topMonth: topShare(monthCounts, selectedRows).topKey,
      topMonthShare: topShare(monthCounts, selectedRows).topShare,
      topPatternCluster: topShare(clusterCounts, selectedRows).topKey,
      topPatternClusterShare: topShare(clusterCounts, selectedRows).topShare,
      topPattern: topShare(patternCounts, selectedRows).topKey,
      topPatternShare: topShare(patternCounts, selectedRows).topShare,
    },
    byYear: mapToSortedObject(yearCounts),
  }
}

const metricForSymbolDateUnion = ({ rows, baselineRows = null }) => {
  const byKey = new Map()
  for (const row of rows) {
    const existing = byKey.get(row.key)
    if (!existing) {
      byKey.set(row.key, { ...row, hitTarget: row.hitTarget === true })
      continue
    }
    if (existing.hitTarget !== (row.hitTarget === true)) throw new Error(`conflicting hitTarget for symbol/date ${row.key}`)
    existing.hitTarget = existing.hitTarget || row.hitTarget === true
  }
  const unionRows = [...byKey.values()]
  const baselineUnionRows = baselineRows ? [...new Map(baselineRows.map((row) => [row.key, row])).values()] : null
  const metric = metricForRows({ rows: unionRows, baselineRows: baselineUnionRows })
  return {
    ...metric,
    symbolDateRows: metric.selectedRows,
    symbolDateHitRows: metric.hitRows,
    symbolDateHitRate: metric.hitRate,
  }
}

const matchedControlMetric = ({ selectedRows, allRows }) => {
  const selectedIndexSet = new Set(selectedRows.map((row) => row.rowIndex))
  const selectedControlMatched = new Set()
  const controlRowsByCell = new Map()
  for (const row of allRows) {
    if (selectedIndexSet.has(row.rowIndex)) continue
    const rows = controlRowsByCell.get(row.controlCell) ?? []
    rows.push(row)
    controlRowsByCell.set(row.controlCell, rows)
  }
  const controlIndexSet = new Set()
  for (const row of selectedRows) {
    const controls = controlRowsByCell.get(row.controlCell) ?? []
    if (controls.length > 0) selectedControlMatched.add(row.rowIndex)
    for (const control of controls) controlIndexSet.add(control.rowIndex)
  }
  const controlRows = allRows.filter((row) => controlIndexSet.has(row.rowIndex))
  const selectedHitRate = safeRatio(selectedRows.filter((row) => row.hitTarget).length, selectedRows.length)
  const controlHitRate = safeRatio(controlRows.filter((row) => row.hitTarget).length, controlRows.length)
  return {
    selectedRowsMatched: selectedControlMatched.size,
    selectedRows: selectedRows.length,
    controlRows: controlRows.length,
    controlCoverage: safeRatio(selectedControlMatched.size, selectedRows.length),
    controlPrecision: controlHitRate,
    selectedPrecision: selectedHitRate,
    absoluteLift: selectedHitRate - controlHitRate,
    relativeLift: controlHitRate > 0 ? selectedHitRate / controlHitRate : null,
  }
}

const ruleFeatureFields = [
  "supportClusterCount",
  "supportQualityRatio",
  "supportWeightedPerCluster",
  "effectiveClusterSupport",
  "topClusterWeightShare",
  "supportOvercrowdRatio",
  "tradedValueRel20",
  "tradedValueRel60",
  "liquidityScoreRaw",
  "gapPct",
  "return1d",
  "return3d",
  "return5d",
  "return20d",
  "rangeRel20",
  "tradedValueRel20",
  "returnVol20",
  "closeLocation",
  "closeNearHigh20",
  "correctedExhaustionScore",
  "qualityScoreRaw",
  "marketUpRatio",
  "limitUpProxyRel20",
]

const rank = (row, field, suffix = "High") => optionalNumeric(row.rank?.[`${field}${suffix}`], 0)

const buildRuleConfigs = () => {
  const rules = [
    {
      ruleId: "keep_all_baseline",
      family: "baseline",
      description: "All train OOF candidate rows. Benchmark only.",
      liveFeatureFields: [],
      pass: () => true,
    },
  ]
  for (const minQuality of [0.35, 0.45, 0.55]) {
    for (const maxClusterDominance of [0.75, 0.9]) {
      rules.push({
        ruleId: `support_quality_density_gate_q${minQuality}_tc${maxClusterDominance}`,
        family: "support_quality_density_gate_v1",
        liveFeatureFields: ruleFeatureFields,
        pass: (row) => (
          rank(row, "supportQualityRatio") >= minQuality &&
          rank(row, "supportWeightedPerCluster") >= 0.25 &&
          row.topClusterWeightShare <= maxClusterDominance
        ),
      })
    }
  }
  for (const crowdRank of [0.65, 0.75, 0.85]) {
    rules.push({
      ruleId: `capacity_adjusted_overcrowd_veto_crowd${crowdRank}`,
      family: "capacity_adjusted_overcrowd_veto_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => !(
        rank(row, "supportOvercrowdRatio") >= crowdRank &&
        row.topClusterWeightShare >= 0.7 &&
        rank(row, "supportQualityRatio") <= 0.55 &&
        rank(row, "liquidityScoreRaw") <= 0.45
      ),
    })
  }
  for (const exhaustionRank of [0.75, 0.85, 0.9]) {
    rules.push({
      ruleId: `failed_impulse_exhaustion_veto_exh${exhaustionRank}`,
      family: "failed_impulse_exhaustion_veto_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => !(
        rank(row, "correctedExhaustionScore") >= exhaustionRank &&
        rank(row, "closeLocation") <= 0.55 &&
        rank(row, "qualityScoreRaw") <= 0.7
      ),
    })
  }
  for (const exhaustionRank of [0.85, 0.9]) {
    rules.push({
      ruleId: `chase_exhaustion_tail_v1_exh${exhaustionRank}`,
      family: "chase_exhaustion_tail_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => !(
        rank(row, "correctedExhaustionScore") >= exhaustionRank &&
        rank(row, "closeNearHigh20") >= 0.7 &&
        rank(row, "supportOvercrowdRatio") >= 0.65
      ),
    })
  }
  for (const lowerExh of [0.15, 0.25]) {
    rules.push({
      ruleId: `healthy_intensity_sweetspot_keep_v1_lowexh${lowerExh}`,
      family: "healthy_intensity_sweetspot_keep_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => (
        rank(row, "tradedValueRel20") >= 0.45 &&
        rank(row, "rangeRel20") >= 0.35 &&
        rank(row, "closeLocation") >= 0.5 &&
        rank(row, "correctedExhaustionScore") >= lowerExh &&
        rank(row, "correctedExhaustionScore") <= 0.88
      ),
    })
  }
  for (const qualityRank of [0.55, 0.65]) {
    rules.push({
      ruleId: `within_date_dominance_filter_v1_q${qualityRank}`,
      family: "within_date_dominance_filter_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => (
        rank(row, "qualityScoreRaw") >= qualityRank &&
        rank(row, "liquidityScoreRaw") >= 0.35 &&
        rank(row, "supportOvercrowdRatio") <= 0.8 &&
        rank(row, "correctedExhaustionScore") <= 0.88
      ),
    })
  }
  for (const breadthRank of [0.65, 0.75]) {
    rules.push({
      ruleId: `market_breadth_crowd_regime_v1_b${breadthRank}`,
      family: "market_breadth_crowd_regime_v1",
      liveFeatureFields: ruleFeatureFields,
      pass: (row) => !(
        rank(row, "marketUpRatio") >= breadthRank &&
        rank(row, "limitUpProxyRel20") >= 0.65 &&
        rank(row, "supportOvercrowdRatio") >= 0.75 &&
        rank(row, "qualityScoreRaw") <= 0.65
      ),
    })
  }
  return rules
}

const evaluateRule = ({ rule, rows, baselineRowMetric, baselineUnionMetric, contract }) => {
  assertLiveFeatureFieldList(rule.liveFeatureFields, { contextLabel: `rule ${rule.ruleId}` })
  const selectedRows = rows.filter((row) => rule.pass(row))
  const rowMetric = metricForRows({ rows: selectedRows, baselineRows: rows })
  const unionMetric = metricForSymbolDateUnion({ rows: selectedRows, baselineRows: rows })
  const matchedControl = matchedControlMetric({ selectedRows, allRows: rows })
  const acceptance = contract.acceptance ?? {}
  const retainedRowShare = safeRatio(selectedRows.length, rows.length)
  const researchGatePassed =
    rule.family !== "baseline" &&
    rowMetric.hitRate - baselineRowMetric.hitRate >= Number(acceptance.minResearchRawPrecisionLift ?? 0.03) &&
    unionMetric.symbolDateHitRate - baselineUnionMetric.symbolDateHitRate >= Number(acceptance.minResearchSymbolDatePrecisionLift ?? 0.03) &&
    rowMetric.activeYears >= Number(acceptance.minActiveYears ?? 4) &&
    rowMetric.activeMonths >= Number(acceptance.minActiveMonths ?? 36) &&
    rowMetric.activeDates >= Number(acceptance.minActiveDates ?? 600) &&
    retainedRowShare >= Number(acceptance.minRetainedRowShare ?? 0.2)
  const promotionGatePassed =
    researchGatePassed &&
    rowMetric.selectedRows >= Number(acceptance.minRawRows ?? 40000) &&
    rowMetric.hitRate - baselineRowMetric.hitRate >= Number(acceptance.minPromotionRawPrecisionLift ?? 0.05) &&
    unionMetric.symbolDateHitRate - baselineUnionMetric.symbolDateHitRate >= Number(acceptance.minPromotionSymbolDatePrecisionLift ?? 0.05) &&
    rowMetric.concentration.topSymbolShare <= Number(acceptance.maxTopSymbolShare ?? 0.03) &&
    rowMetric.concentration.topDateShare <= Number(acceptance.maxTopDateShare ?? 0.04) &&
    rowMetric.concentration.topMonthShare <= Number(acceptance.maxTopMonthShare ?? 0.12) &&
    rowMetric.concentration.topPatternClusterShare <= Number(acceptance.maxTopPatternClusterShare ?? 0.35) &&
    matchedControl.controlCoverage >= Number(acceptance.minMatchedControlCoverage ?? 0.85) &&
    matchedControl.absoluteLift >= Number(acceptance.minMatchedControlAbsoluteLift ?? 0.03) &&
    (matchedControl.relativeLift ?? 0) >= Number(acceptance.minMatchedControlRelativeLift ?? 1.15)
  const rejectReasons = []
  if (rule.family === "baseline") rejectReasons.push("benchmark_only")
  if (rowMetric.hitRate - baselineRowMetric.hitRate < Number(acceptance.minResearchRawPrecisionLift ?? 0.03)) {
    rejectReasons.push("raw_precision_lift_below_research_min")
  }
  if (unionMetric.symbolDateHitRate - baselineUnionMetric.symbolDateHitRate < Number(acceptance.minResearchSymbolDatePrecisionLift ?? 0.03)) {
    rejectReasons.push("symbol_date_precision_lift_below_research_min")
  }
  if (retainedRowShare < Number(acceptance.minRetainedRowShare ?? 0.2)) rejectReasons.push("retained_row_share_below_min")
  if (rowMetric.activeYears < Number(acceptance.minActiveYears ?? 4)) rejectReasons.push("active_years_below_min")
  if (rowMetric.activeMonths < Number(acceptance.minActiveMonths ?? 36)) rejectReasons.push("active_months_below_min")
  if (rowMetric.activeDates < Number(acceptance.minActiveDates ?? 600)) rejectReasons.push("active_dates_below_min")
  if (promotionGatePassed === false && researchGatePassed === true) rejectReasons.push("promotion_gate_not_passed")
  return {
    kind: "tp12_year2hit_precision_first_daily_only_rule_summary_v1",
    patchKey: PATCH_KEY,
    ruleId: rule.ruleId,
    family: rule.family,
    description: rule.description ?? null,
    selectedRows: rowMetric.selectedRows,
    hitRows: rowMetric.hitRows,
    hitRate: rowMetric.hitRate,
    hitRateLift: rowMetric.hitRate - baselineRowMetric.hitRate,
    wilsonLower95: rowMetric.wilsonLower95,
    retainedRowShare,
    symbolDateRows: unionMetric.symbolDateRows,
    symbolDateHitRows: unionMetric.symbolDateHitRows,
    symbolDateHitRate: unionMetric.symbolDateHitRate,
    symbolDateHitRateLift: unionMetric.symbolDateHitRate - baselineUnionMetric.symbolDateHitRate,
    symbolDateWilsonLower95: unionMetric.wilsonLower95,
    activeYears: rowMetric.activeYears,
    activeMonths: rowMetric.activeMonths,
    activeDates: rowMetric.activeDates,
    uniqueSymbols: rowMetric.uniqueSymbols,
    concentration: rowMetric.concentration,
    matchedControl,
    researchGatePassed,
    promotionGatePassed,
    rejectReasons,
  }
}

const chooseBestRule = (ruleSummaries) => {
  const candidates = ruleSummaries.filter((row) => row.family !== "baseline")
  const sorted = [...candidates].sort((left, right) => {
    if (left.promotionGatePassed !== right.promotionGatePassed) return left.promotionGatePassed ? -1 : 1
    if (left.researchGatePassed !== right.researchGatePassed) return left.researchGatePassed ? -1 : 1
    const hitRateDiff = right.hitRate - left.hitRate
    if (hitRateDiff !== 0) return hitRateDiff
    const rowDiff = right.selectedRows - left.selectedRows
    if (rowDiff !== 0) return rowDiff
    return left.ruleId.localeCompare(right.ruleId)
  })
  return sorted[0] ?? ruleSummaries.find((row) => row.family === "baseline")
}

export const runTp12Year2hitPrecisionFirstDailyOnly = async ({
  contractPath,
  candidatesPath,
  outSummaryPath,
  outSelectedPath = "",
  outRejectedPath = "",
  outRuleReportPath = "",
} = {}) => {
  const { contract } = await assertTp12PrecisionFirstDailyOnlyContract({
    contractPath,
    candidatePath: candidatesPath,
  })
  const { rows, inputRowCount } = await loadCandidateRows({ candidatesPath, contract })
  const baselineRowMetric = metricForRows({ rows })
  const baselineUnionMetric = metricForSymbolDateUnion({ rows })
  const rules = buildRuleConfigs()
  const ruleSummaries = rules.map((rule) => evaluateRule({
    rule,
    rows,
    baselineRowMetric,
    baselineUnionMetric,
    contract,
  }))
  const bestRule = chooseBestRule(ruleSummaries)
  const bestRuleDefinition = rules.find((rule) => rule.ruleId === bestRule.ruleId)
  const selectedRows = rows.filter((row) => bestRuleDefinition.pass(row))
  const selectedIndexSet = new Set(selectedRows.map((row) => row.rowIndex))
  const rejectedRows = rows.filter((row) => !selectedIndexSet.has(row.rowIndex))
  const researchPassedRuleCount = ruleSummaries.filter((row) => row.researchGatePassed).length
  const promotionPassedRuleCount = ruleSummaries.filter((row) => row.promotionGatePassed).length
  const verdict = promotionPassedRuleCount > 0
    ? "promotion_precision_lift_found"
    : (researchPassedRuleCount > 0 ? "research_precision_lift_found" : "no_precision_lift")
  const summary = {
    kind: "tp12_year2hit_precision_first_daily_only_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: PATCH_KEY,
    status: "completed_train_only_diagnostic",
    verdict,
    oosRead: false,
    sideDailyUsed: false,
    intradayUsed: false,
    themeUsed: false,
    lockedSelectorEmitted: false,
    contractPath: path.resolve(contractPath),
    candidatesPath: path.resolve(candidatesPath),
    inputRowCount,
    candidateRows: rows.length,
    hitCandidateRows: baselineRowMetric.hitRows,
    candidateHitRate: baselineRowMetric.hitRate,
    candidateWilsonLower95: baselineRowMetric.wilsonLower95,
    baselineSymbolDateRows: baselineUnionMetric.symbolDateRows,
    baselineSymbolDateHitRows: baselineUnionMetric.symbolDateHitRows,
    baselineSymbolDateHitRate: baselineUnionMetric.symbolDateHitRate,
    baselineSymbolDateWilsonLower95: baselineUnionMetric.wilsonLower95,
    ruleCount: ruleSummaries.length,
    researchPassedRuleCount,
    promotionPassedRuleCount,
    bestRule,
    topRules: [...ruleSummaries]
      .filter((row) => row.family !== "baseline")
      .sort((left, right) => right.hitRate - left.hitRate)
      .slice(0, 10),
    outputArtifacts: {
      summary: outSummaryPath ? path.resolve(outSummaryPath) : null,
      selected: outSelectedPath ? path.resolve(outSelectedPath) : null,
      rejected: outRejectedPath ? path.resolve(outRejectedPath) : null,
      ruleReport: outRuleReportPath ? path.resolve(outRuleReportPath) : null,
    },
  }
  if (toText(outSummaryPath)) await writeJson(outSummaryPath, summary)
  if (toText(outSelectedPath)) await writeJsonl(outSelectedPath, selectedRows.map((row) => ({
    ruleId: bestRule.ruleId,
    decisionDateKey: row.decisionDateKey,
    symbol: row.symbol,
    hitTarget: row.hitTarget,
    supportPatternCount: row.supportPatternCount,
    supportClusterCount: row.supportClusterCount,
    topClusterId: row.topClusterId,
    supportQualityRatio: row.supportQualityRatio,
    supportOvercrowdRatio: row.supportOvercrowdRatio,
    correctedExhaustionScore: row.correctedExhaustionScore,
  })))
  if (toText(outRejectedPath)) await writeJsonl(outRejectedPath, rejectedRows.map((row) => ({
    ruleId: bestRule.ruleId,
    decisionDateKey: row.decisionDateKey,
    symbol: row.symbol,
    hitTarget: row.hitTarget,
    rejectReason: "best_rule_filter_rejected",
    supportPatternCount: row.supportPatternCount,
    supportClusterCount: row.supportClusterCount,
    topClusterId: row.topClusterId,
  })))
  if (toText(outRuleReportPath)) await writeJsonl(outRuleReportPath, ruleSummaries)
  return summary
}
