import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import {
  closeWriteStream,
  createJsonlWriteStreamMaybeGzip,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const PATCH_KEY = "tp12_h80_same_day_listwise_context_abstention_v1"

const REQUIRED_NUMERIC_FIELDS = [
  "selectorScore",
  "supportPatternCount",
  "supportClusterCount",
  "familyDiversity",
  "sumClusterRowEb",
  "meanClusterRowEb",
  "maxClusterRowEb",
  "maxClusterRowWilsonLB",
  "supportWeightedClusterRowEb",
  "dayCandidateRows",
  "dayUniquePatterns",
  "return1d",
  "return3d",
  "return5d",
  "return20d",
  "gapPct",
  "rangePct",
  "closeLocation",
  "tradedValue",
  "tradedValueRel20",
  "rangeRel20",
  "returnVol20",
  "closeToHigh20Pct",
  "closeFromLow20Pct",
  "marketUpRatio",
  "marketUpRatio20",
  "marketMeanReturn1d",
  "limitUpProxyRel20",
]

const RANK_FIELDS = [
  "selectorScore",
  "supportPatternCount",
  "supportClusterCount",
  "familyDiversity",
  "sumClusterRowEb",
  "meanClusterRowEb",
  "maxClusterRowEb",
  "maxClusterRowWilsonLB",
  "supportWeightedClusterRowEb",
  "supportSaturated",
  "supportOvercrowdRatio",
  "supportQualityRatio",
  "supportWeightedPerCluster",
  "effectiveClusterSupport",
  "topClusterWeightShare",
  "return1d",
  "return3d",
  "return5d",
  "return20d",
  "gapPct",
  "rangePct",
  "closeLocation",
  "tradedValue",
  "tradedValueRel20",
  "rangeRel20",
  "returnVol20",
  "closeToHigh20Pct",
  "closeFromLow20Pct",
  "exhaustionScoreRaw",
  "liquidityScoreRaw",
  "qualityScoreRaw",
]

const DEFAULT_TOP_CUTS = [50, 75, 100, 150, 200, 300, 500]

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const keyOf = (symbol, decisionDateKey) => `${decisionDateKey}\t${symbol}`

const rowSymbol = (row) => toText(row?.symbol).toUpperCase()

const rowDecisionDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)

const numeric = (row, field, contextLabel = "row") => {
  const value = toNumber(row?.[field], NaN)
  if (!Number.isFinite(value)) throw new Error(`${contextLabel} missing finite ${field}`)
  return value
}

const optionalNumeric = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const assertDateRange = ({ decisionDateKey, contextLabel, dateFrom, dateTo, forbiddenDateFrom, forbiddenDateTo }) => {
  if (!validDateKey(decisionDateKey)) throw new Error(`${contextLabel} invalid decisionDateKey: ${decisionDateKey || "missing"}`)
  if (dateFrom && decisionDateKey < dateFrom) throw new Error(`${contextLabel} date ${decisionDateKey} before dateFrom ${dateFrom}`)
  if (dateTo && decisionDateKey > dateTo) throw new Error(`${contextLabel} date ${decisionDateKey} after dateTo ${dateTo}`)
  if (forbiddenDateFrom && forbiddenDateTo && decisionDateKey >= forbiddenDateFrom && decisionDateKey <= forbiddenDateTo) {
    throw new Error(`${contextLabel} date ${decisionDateKey} is inside forbidden range ${forbiddenDateFrom}..${forbiddenDateTo}`)
  }
}

const finiteMetric = (row, fields) => {
  for (const field of fields) {
    const value = toNumber(row?.[field], NaN)
    if (Number.isFinite(value)) return value
  }
  return NaN
}

const labelClassFor = ({ hitTarget, maxForwardReturn, targetPct, nearMissMinPct, hardNegativeMaxForwardReturnPct }) => {
  if (hitTarget) return "positive"
  if (maxForwardReturn >= nearMissMinPct) return "near_miss"
  if (maxForwardReturn <= hardNegativeMaxForwardReturnPct) return "hard_negative"
  if (maxForwardReturn < targetPct) return "easy_negative"
  throw new Error(`non-hit label reaches target boundary: ${maxForwardReturn}`)
}

const normalizePathLabel = ({ row, contextLabel, options }) => {
  const symbol = rowSymbol(row)
  const decisionDateKey = rowDecisionDateKey(row)
  if (!symbol) throw new Error(`${contextLabel} missing symbol`)
  assertDateRange({ decisionDateKey, contextLabel, ...options })
  if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) throw new Error(`${contextLabel} missing hitTarget`)
  const maxForwardReturn = finiteMetric(row, ["maxForwardReturn", "maxForwardHighPct", "forwardMaxReturn"])
  const minForwardReturn = finiteMetric(row, ["minForwardReturn", "minForwardLowPct", "forwardMinReturn"])
  if (!Number.isFinite(maxForwardReturn)) throw new Error(`${contextLabel} missing maxForwardReturn/maxForwardHighPct`)
  if (!Number.isFinite(minForwardReturn)) throw new Error(`${contextLabel} missing minForwardReturn/minForwardLowPct`)
  const hitTarget = row.hitTarget === true
  return {
    symbol,
    decisionDateKey,
    key: keyOf(symbol, decisionDateKey),
    hitTarget,
    labelClass: labelClassFor({
      hitTarget,
      maxForwardReturn,
      targetPct: options.targetPct,
      nearMissMinPct: options.nearMissMinPct,
      hardNegativeMaxForwardReturnPct: options.hardNegativeMaxForwardReturnPct,
    }),
    maxForwardReturn,
    minForwardReturn,
  }
}

const assertCompatibleLabel = (left, right) => {
  if (left.hitTarget !== right.hitTarget) throw new Error(`conflicting hitTarget for path label ${right.key}`)
  if (left.labelClass !== right.labelClass) throw new Error(`conflicting labelClass for path label ${right.key}`)
  if (Math.abs(left.maxForwardReturn - right.maxForwardReturn) > 1e-12) {
    throw new Error(`conflicting maxForwardReturn for path label ${right.key}`)
  }
  if (Math.abs(left.minForwardReturn - right.minForwardReturn) > 1e-12) {
    throw new Error(`conflicting minForwardReturn for path label ${right.key}`)
  }
}

const loadPathLabels = async ({ pathLabelsPath, options }) => {
  if (!toText(pathLabelsPath)) throw new Error("pathLabelsPath is required")
  if (!fs.existsSync(pathLabelsPath)) throw new Error(`path labels not found: ${pathLabelsPath}`)
  const labels = new Map()
  let pathLabelRowCount = 0
  await iterateJsonlMaybeGzip(pathLabelsPath, {
    strict: true,
    onRow: async (row, context) => {
      pathLabelRowCount += 1
      const label = normalizePathLabel({
        row,
        contextLabel: `${context.filePath}:${context.lineNumber}`,
        options,
      })
      const existing = labels.get(label.key)
      if (existing) assertCompatibleLabel(existing, label)
      else labels.set(label.key, label)
    },
  })
  if (labels.size < 1) throw new Error(`path labels produced zero symbol/date labels: ${pathLabelsPath}`)
  return { labels, pathLabelRowCount }
}

const clusterWeightStats = (row) => {
  if (!Array.isArray(row.supportClusterSummaries) || row.supportClusterSummaries.length < 1) {
    throw new Error(`candidate ${row.decisionDateKey}::${row.symbol} missing supportClusterSummaries`)
  }
  const weights = row.supportClusterSummaries.map((item) => Math.max(0, optionalNumeric(item?.patternCount, 0)))
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  if (totalWeight <= 0) {
    return { clusterEntropy: 0, effectiveClusterSupport: 0, topClusterWeightShare: 0, topClusterId: toText(row.supportClusterSummaries[0]?.clusterId) || null }
  }
  let entropy = 0
  let maxWeight = 0
  let topClusterId = null
  row.supportClusterSummaries.forEach((item, index) => {
    const weight = weights[index]
    const share = weight / totalWeight
    if (share > 0) entropy -= share * Math.log(share)
    if (weight > maxWeight) {
      maxWeight = weight
      topClusterId = toText(item?.clusterId) || null
    }
  })
  return {
    clusterEntropy: entropy,
    effectiveClusterSupport: Math.exp(entropy),
    topClusterWeightShare: maxWeight / totalWeight,
    topClusterId,
  }
}

const validateCandidateRow = ({ row, contextLabel, labels, options }) => {
  const symbol = rowSymbol(row)
  const decisionDateKey = rowDecisionDateKey(row)
  if (!symbol) throw new Error(`${contextLabel} missing symbol`)
  assertDateRange({ decisionDateKey, contextLabel, ...options })
  if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) throw new Error(`${contextLabel} missing hitTarget`)
  for (const field of REQUIRED_NUMERIC_FIELDS) numeric(row, field, contextLabel)
  const key = keyOf(symbol, decisionDateKey)
  const label = labels.get(key)
  if (!label) throw new Error(`${contextLabel} missing required path label for ${decisionDateKey}::${symbol}`)
  if (label.hitTarget !== (row.hitTarget === true)) throw new Error(`${contextLabel} hitTarget conflicts with path label ${decisionDateKey}::${symbol}`)
  const clusterStats = clusterWeightStats({ ...row, symbol, decisionDateKey })
  const supportClusterCount = numeric(row, "supportClusterCount", contextLabel)
  const dayUniquePatterns = Math.max(1, numeric(row, "dayUniquePatterns", contextLabel))
  const supportSaturated = Math.log1p(Math.max(0, supportClusterCount))
  const supportQualityRatio = numeric(row, "sumClusterRowEb", contextLabel) / Math.max(1, supportSaturated)
  const supportWeightedPerCluster = numeric(row, "supportWeightedClusterRowEb", contextLabel) / Math.max(1, supportClusterCount)
  const supportOvercrowdRatio = supportClusterCount / dayUniquePatterns
  const raw = {
    ...row,
    symbol,
    decisionDateKey,
    key,
    hitTarget: row.hitTarget === true,
    labelClass: label.labelClass,
    supportSaturated,
    supportQualityRatio,
    supportWeightedPerCluster,
    supportOvercrowdRatio,
    ...clusterStats,
  }
  raw.qualityScoreRaw = (
    numeric(raw, "maxClusterRowWilsonLB", contextLabel) +
    numeric(raw, "maxClusterRowEb", contextLabel) +
    supportQualityRatio +
    supportWeightedPerCluster
  ) / 4
  raw.liquidityScoreRaw = (
    numeric(raw, "tradedValueRel20", contextLabel) +
    Math.log1p(Math.max(0, numeric(raw, "tradedValue", contextLabel))) / 30
  ) / 2
  raw.exhaustionScoreRaw = (
    Math.max(0, numeric(raw, "return1d", contextLabel)) +
    Math.max(0, numeric(raw, "return3d", contextLabel)) +
    Math.max(0, numeric(raw, "return5d", contextLabel)) +
    Math.max(0, numeric(raw, "gapPct", contextLabel)) +
    Math.max(0, numeric(raw, "returnVol20", contextLabel)) +
    Math.max(0, numeric(raw, "closeToHigh20Pct", contextLabel))
  )
  return raw
}

const percentileRanks = (rows, field) => {
  const sorted = [...rows].sort((left, right) => {
    const diff = optionalNumeric(left[field]) - optionalNumeric(right[field])
    if (diff !== 0) return diff
    return left.symbol.localeCompare(right.symbol)
  })
  const ranks = new Map()
  const denominator = Math.max(1, sorted.length - 1)
  sorted.forEach((row, index) => {
    ranks.set(row.key, index / denominator)
  })
  return ranks
}

const meanAndStd = (rows, field) => {
  const values = rows.map((row) => optionalNumeric(row[field], 0))
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)
  return { mean, std: Math.sqrt(variance) || 1 }
}

const attachDateRelativeFeatures = (rows) => {
  const rankMaps = new Map()
  const statMaps = new Map()
  for (const field of RANK_FIELDS) {
    rankMaps.set(field, percentileRanks(rows, field))
    statMaps.set(field, meanAndStd(rows, field))
  }
  for (const row of rows) {
    row.rank = {}
    row.z = {}
    for (const field of RANK_FIELDS) {
      const rankHigh = rankMaps.get(field).get(row.key) ?? 0
      const { mean, std } = statMaps.get(field)
      row.rank[`${field}High`] = rankHigh
      row.rank[`${field}Low`] = 1 - rankHigh
      row.z[field] = (optionalNumeric(row[field], 0) - mean) / std
    }
    row.rank.exhaustionLow = 1 - row.rank.exhaustionScoreRawHigh
    row.rank.supportOvercrowdLow = 1 - row.rank.supportOvercrowdRatioHigh
    row.rank.topClusterWeightShareLow = 1 - row.rank.topClusterWeightShareHigh
  }
}

const topClusterId = (row) => row.topClusterId || (Array.isArray(row.supportClusterIds) ? toText(row.supportClusterIds[0]) || null : null)

const policyFeature = (row, key) => optionalNumeric(row.rank?.[key] ?? row[key], 0)

const rawFeature = (row, key) => optionalNumeric(row[key], 0)

const POLICY_SET = [
  {
    id: "baseline_selector_score_desc",
    description: "Current selector score benchmark. Diagnostic only.",
    score: (row) => rawFeature(row, "selectorScore"),
  },
  {
    id: "support_tempered_roweb_v1",
    description: "Prior best anti-overcrowding benchmark: sum row-EB tempered by log support.",
    score: (row) => rawFeature(row, "sumClusterRowEb") / Math.max(1, Math.log1p(Math.max(0, rawFeature(row, "supportClusterCount")))),
    preferLowerCrowdOnTie: true,
  },
  {
    id: "support_weighted_tempered_v1",
    description: "Prior support-weighted EB benchmark divided by support count pressure.",
    score: (row) => rawFeature(row, "supportWeightedClusterRowEb") / Math.max(1, rawFeature(row, "supportClusterCount")),
    preferLowerCrowdOnTie: true,
  },
  {
    id: "low_support_quality_rank_v1",
    description: "Prior anti-crowd benchmark: fit-only quality ranks with same-day support penalty.",
    score: (row) => (
      1.2 * policyFeature(row, "maxClusterRowEbHigh") +
      0.8 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.4 * policyFeature(row, "familyDiversityHigh") -
      1.4 * policyFeature(row, "supportClusterCountHigh") -
      0.2 * policyFeature(row, "selectorScoreHigh")
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: "pairwise_overcrowding_penalty_l1_v1",
    description: "Prior same-day rank benchmark with a moderate support-overcrowding penalty.",
    score: (row) => (
      0.9 * policyFeature(row, "maxClusterRowEbHigh") +
      0.7 * policyFeature(row, "sumClusterRowEbHigh") +
      0.2 * policyFeature(row, "familyDiversityHigh") -
      1.0 * policyFeature(row, "supportClusterCountHigh")
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: "pairwise_overcrowding_penalty_l2_v1",
    description: "Prior same-day rank benchmark with a strong support-overcrowding penalty.",
    score: (row) => (
      0.9 * policyFeature(row, "maxClusterRowEbHigh") +
      0.7 * policyFeature(row, "sumClusterRowEbHigh") +
      0.2 * policyFeature(row, "familyDiversityHigh") -
      1.6 * policyFeature(row, "supportClusterCountHigh")
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: "listwise_context_quality_v1",
    description: "Within-date quality/liquidity score with saturated support and anti-exhaustion.",
    score: (row) => (
      1.1 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.8 * policyFeature(row, "supportQualityRatioHigh") +
      0.6 * policyFeature(row, "supportWeightedPerClusterHigh") +
      0.5 * policyFeature(row, "tradedValueRel20High") +
      0.35 * policyFeature(row, "closeLocationHigh") +
      0.25 * policyFeature(row, "rangeRel20High") -
      0.65 * policyFeature(row, "supportOvercrowdRatioHigh") -
      0.45 * policyFeature(row, "exhaustionScoreRawHigh")
    ),
  },
  {
    id: "support_saturation_interaction_v1",
    description: "Use support as saturated prior only when row reliability and liquidity also agree.",
    score: (row) => (
      0.95 * policyFeature(row, "maxClusterRowEbHigh") +
      0.75 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.45 * policyFeature(row, "supportSaturatedHigh") +
      0.45 * policyFeature(row, "supportQualityRatioHigh") +
      0.35 * policyFeature(row, "liquidityScoreRawHigh") +
      0.25 * policyFeature(row, "effectiveClusterSupportHigh") -
      0.75 * policyFeature(row, "topClusterWeightShareHigh") -
      0.35 * policyFeature(row, "return20dHigh")
    ),
  },
  {
    id: "hard_negative_veto_context_v1",
    description: "Quality ranker with explicit exhaustion, top-cluster dominance, and low-liquidity penalties.",
    score: (row) => (
      1.0 * policyFeature(row, "qualityScoreRawHigh") +
      0.65 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.45 * policyFeature(row, "closeFromLow20PctHigh") +
      0.35 * policyFeature(row, "tradedValueHigh") -
      0.9 * policyFeature(row, "exhaustionScoreRawHigh") -
      0.55 * policyFeature(row, "topClusterWeightShareHigh") -
      0.25 * policyFeature(row, "tradedValueRel20Low")
    ),
  },
  {
    id: "relative_momentum_quality_v1",
    description: "Prefer strong but not exhausted within-day momentum/quality candidates.",
    score: (row) => (
      0.9 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.65 * policyFeature(row, "rangeRel20High") +
      0.45 * policyFeature(row, "closeLocationHigh") +
      0.35 * policyFeature(row, "closeFromLow20PctHigh") +
      0.3 * policyFeature(row, "tradedValueRel20High") -
      0.55 * policyFeature(row, "return1dHigh") -
      0.4 * policyFeature(row, "gapPctHigh") -
      0.35 * policyFeature(row, "supportOvercrowdRatioHigh")
    ),
  },
  {
    id: "cluster_diversity_quality_v1",
    description: "Reward diverse support clusters rather than raw duplicate support count.",
    score: (row) => (
      0.9 * policyFeature(row, "effectiveClusterSupportHigh") +
      0.7 * policyFeature(row, "familyDiversityHigh") +
      0.65 * policyFeature(row, "supportQualityRatioHigh") +
      0.45 * policyFeature(row, "maxClusterRowWilsonLBHigh") -
      0.8 * policyFeature(row, "topClusterWeightShareHigh") -
      0.35 * policyFeature(row, "selectorScoreHigh")
    ),
  },
  {
    id: "undercrowded_selector_contrast_v1",
    description: "Prior inversion benchmark: explicitly contrast against current support-heavy selector score.",
    score: (row) => (
      0.9 * policyFeature(row, "maxClusterRowWilsonLBHigh") +
      0.7 * policyFeature(row, "supportClusterCountLow") +
      0.6 * policyFeature(row, "selectorScoreLow") +
      0.2 * policyFeature(row, "familyDiversityHigh")
    ),
    preferLowerCrowdOnTie: true,
  },
]

const compareScored = (left, right) => {
  if (left.score !== right.score) return right.score - left.score
  if (left.preferLowerCrowdOnTie || right.preferLowerCrowdOnTie) {
    const crowdDiff = rawFeature(left.row, "supportClusterCount") - rawFeature(right.row, "supportClusterCount")
    if (crowdDiff !== 0) return crowdDiff
  }
  const qualityDiff = rawFeature(right.row, "maxClusterRowWilsonLB") - rawFeature(left.row, "maxClusterRowWilsonLB")
  if (qualityDiff !== 0) return qualityDiff
  const supportDiff = rawFeature(right.row, "supportClusterCount") - rawFeature(left.row, "supportClusterCount")
  if (supportDiff !== 0) return supportDiff
  return left.row.symbol.localeCompare(right.row.symbol)
}

const percentileBy = (items, valueFn) => {
  const sorted = [...items].sort((left, right) => {
    const diff = valueFn(left) - valueFn(right)
    if (diff !== 0) return diff
    return `${left.decisionDateKey}::${left.symbol}`.localeCompare(`${right.decisionDateKey}::${right.symbol}`)
  })
  const out = new Map()
  const denominator = Math.max(1, sorted.length - 1)
  sorted.forEach((item, index) => out.set(item, index / denominator))
  return out
}

const finalizeConcentration = (map, total) => {
  let topKey = null
  let topCount = 0
  for (const [key, count] of map.entries()) {
    if (count > topCount || (count === topCount && toText(key).localeCompare(toText(topKey)) < 0)) {
      topKey = key
      topCount = count
    }
  }
  return { topKey, topCount, topShare: total > 0 ? topCount / total : 0 }
}

const metricForRows = (rows) => {
  const selectedRows = rows.length
  const hitRows = rows.filter((row) => row.hitTarget).length
  const interval = wilsonInterval({ hitRows, selectedRows })
  const symbolCounts = new Map()
  const clusterCounts = new Map()
  const yearCounts = new Map()
  const monthCounts = new Map()
  const labelCounts = new Map()
  for (const row of rows) {
    incrementMap(symbolCounts, row.symbol)
    incrementMap(clusterCounts, row.topClusterId || "unknown")
    incrementMap(yearCounts, row.decisionDateKey.slice(0, 4))
    incrementMap(monthCounts, row.decisionDateKey.slice(0, 7))
    incrementMap(labelCounts, row.labelClass)
  }
  return {
    selectedRows,
    hitRows,
    falsePositiveRows: selectedRows - hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    wilsonLower95: interval.lower,
    wilsonUpper95: interval.upper,
    falsePositiveLabelClassCounts: Object.fromEntries([...labelCounts.entries()].filter(([key]) => key !== "positive").sort()),
    concentration: {
      topSymbolShare: finalizeConcentration(symbolCounts, selectedRows).topShare,
      topSymbol: finalizeConcentration(symbolCounts, selectedRows).topKey,
      topPatternClusterShare: finalizeConcentration(clusterCounts, selectedRows).topShare,
      topPatternCluster: finalizeConcentration(clusterCounts, selectedRows).topKey,
      topMonthShare: finalizeConcentration(monthCounts, selectedRows).topShare,
      topMonth: finalizeConcentration(monthCounts, selectedRows).topKey,
    },
    coverage: {
      activeYearCount: yearCounts.size,
      activeMonthCount: monthCounts.size,
      selectedByYear: mapToSortedObject(yearCounts),
      selectedByMonth: mapToSortedObject(monthCounts),
    },
  }
}

const computePairwiseStats = (dateRows, scoredRows) => {
  const scoreByKey = new Map(scoredRows.map((item) => [item.row.key, item.score]))
  const positives = dateRows.filter((row) => row.hitTarget)
  const negatives = dateRows.filter((row) => !row.hitTarget)
  const stats = {
    pairCount: 0,
    winCount: 0,
    tieCount: 0,
    lossCount: 0,
    byNegativeClass: new Map(),
  }
  for (const positive of positives) {
    const positiveScore = scoreByKey.get(positive.key)
    for (const negative of negatives) {
      const negativeScore = scoreByKey.get(negative.key)
      stats.pairCount += 1
      const item = stats.byNegativeClass.get(negative.labelClass) ?? { pairCount: 0, winCount: 0, tieCount: 0, lossCount: 0 }
      item.pairCount += 1
      if (positiveScore > negativeScore) {
        stats.winCount += 1
        item.winCount += 1
      } else if (positiveScore === negativeScore) {
        stats.tieCount += 1
        item.tieCount += 1
      } else {
        stats.lossCount += 1
        item.lossCount += 1
      }
      stats.byNegativeClass.set(negative.labelClass, item)
    }
  }
  return stats
}

const mergePairwiseStats = (target, source) => {
  target.pairCount += source.pairCount
  target.winCount += source.winCount
  target.tieCount += source.tieCount
  target.lossCount += source.lossCount
  for (const [labelClass, item] of source.byNegativeClass.entries()) {
    const existing = target.byNegativeClass.get(labelClass) ?? { pairCount: 0, winCount: 0, tieCount: 0, lossCount: 0 }
    existing.pairCount += item.pairCount
    existing.winCount += item.winCount
    existing.tieCount += item.tieCount
    existing.lossCount += item.lossCount
    target.byNegativeClass.set(labelClass, existing)
  }
}

const finalizePairwiseStats = (stats) => ({
  pairCount: stats.pairCount,
  winCount: stats.winCount,
  tieCount: stats.tieCount,
  lossCount: stats.lossCount,
  winRate: safeRatio(stats.winCount + 0.5 * stats.tieCount, stats.pairCount),
  byNegativeClass: Object.fromEntries([...stats.byNegativeClass.entries()].sort().map(([labelClass, item]) => [
    labelClass,
    {
      ...item,
      winRate: safeRatio(item.winCount + 0.5 * item.tieCount, item.pairCount),
    },
  ])),
})

const compareTopCutForH80 = (left, right) => {
  if (left.wilsonLower95 !== right.wilsonLower95) return right.wilsonLower95 - left.wilsonLower95
  if (left.hitRate !== right.hitRate) return right.hitRate - left.hitRate
  if (left.selectedRows !== right.selectedRows) return right.selectedRows - left.selectedRows
  return left.topCutRows - right.topCutRows
}

const featureOutputRow = (row) => ({
  kind: "tp12_same_day_listwise_context_feature_v1",
  decisionDateKey: row.decisionDateKey,
  symbol: row.symbol,
  foldId: toText(row.foldId) || null,
  hitTarget: row.hitTarget,
  labelClass: row.labelClass,
  selectorScore: rawFeature(row, "selectorScore"),
  supportPatternCount: rawFeature(row, "supportPatternCount"),
  supportClusterCount: rawFeature(row, "supportClusterCount"),
  supportSaturated: row.supportSaturated,
  supportOvercrowdRatio: row.supportOvercrowdRatio,
  supportQualityRatio: row.supportQualityRatio,
  supportWeightedPerCluster: row.supportWeightedPerCluster,
  effectiveClusterSupport: row.effectiveClusterSupport,
  topClusterWeightShare: row.topClusterWeightShare,
  topClusterId: topClusterId(row),
  maxClusterRowWilsonLB: rawFeature(row, "maxClusterRowWilsonLB"),
  maxClusterRowEb: rawFeature(row, "maxClusterRowEb"),
  familyDiversity: rawFeature(row, "familyDiversity"),
  return1d: rawFeature(row, "return1d"),
  return3d: rawFeature(row, "return3d"),
  return5d: rawFeature(row, "return5d"),
  gapPct: rawFeature(row, "gapPct"),
  rangePct: rawFeature(row, "rangePct"),
  closeLocation: rawFeature(row, "closeLocation"),
  tradedValue: rawFeature(row, "tradedValue"),
  tradedValueRel20: rawFeature(row, "tradedValueRel20"),
  rangeRel20: rawFeature(row, "rangeRel20"),
  returnVol20: rawFeature(row, "returnVol20"),
  marketUpRatio: rawFeature(row, "marketUpRatio"),
  marketUpRatio20: rawFeature(row, "marketUpRatio20"),
  limitUpProxyRel20: rawFeature(row, "limitUpProxyRel20"),
  exhaustionScoreRaw: row.exhaustionScoreRaw,
  liquidityScoreRaw: row.liquidityScoreRaw,
  qualityScoreRaw: row.qualityScoreRaw,
  rank: row.rank,
  z: row.z,
})

const loadCandidateRows = async ({ candidatesPath, labels, options }) => {
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  if (!fs.existsSync(candidatesPath)) throw new Error(`candidates not found: ${candidatesPath}`)
  const rows = []
  const byDate = new Map()
  const seen = new Set()
  let candidateRows = 0
  let hitCandidateRows = 0
  await iterateJsonlMaybeGzip(candidatesPath, {
    strict: true,
    onRow: async (raw, context) => {
      const row = validateCandidateRow({
        row: raw,
        contextLabel: `${context.filePath}:${context.lineNumber}`,
        labels,
        options,
      })
      if (seen.has(row.key)) throw new Error(`duplicate candidate symbol/date row: ${row.decisionDateKey}::${row.symbol}`)
      seen.add(row.key)
      candidateRows += 1
      if (row.hitTarget) hitCandidateRows += 1
      rows.push(row)
      const dateRows = byDate.get(row.decisionDateKey) ?? []
      dateRows.push(row)
      byDate.set(row.decisionDateKey, dateRows)
    },
  })
  if (rows.length < 1) throw new Error(`candidates produced zero rows: ${candidatesPath}`)
  for (const dateRows of byDate.values()) attachDateRelativeFeatures(dateRows)
  return { rows, byDate, candidateRows, hitCandidateRows }
}

const policyAccumulator = (policy) => ({
  policyId: policy.id,
  description: policy.description,
  selections: [],
  pairwise: { pairCount: 0, winCount: 0, tieCount: 0, lossCount: 0, byNegativeClass: new Map() },
})

const buildPolicyResults = ({ policies, byDate, topCuts, minSelectedRows, targetWilsonLower95 }) => {
  const accumulators = new Map(policies.map((policy) => [policy.id, policyAccumulator(policy)]))
  let candidateDateCount = 0
  let datesWithPositiveCandidate = 0
  for (const [decisionDateKey, dateRows] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    candidateDateCount += 1
    const dayHasHit = dateRows.some((row) => row.hitTarget)
    if (dayHasHit) datesWithPositiveCandidate += 1
    for (const policy of policies) {
      const scored = dateRows.map((row) => {
        const score = policy.score(row)
        if (!Number.isFinite(score)) throw new Error(`policy ${policy.id} produced non-finite score for ${row.decisionDateKey}::${row.symbol}`)
        return { row, score, preferLowerCrowdOnTie: Boolean(policy.preferLowerCrowdOnTie) }
      }).sort(compareScored)
      const selected = scored[0]
      const second = scored[1] ?? null
      const acc = accumulators.get(policy.id)
      mergePairwiseStats(acc.pairwise, computePairwiseStats(dateRows, scored))
      acc.selections.push({
        kind: "tp12_same_day_listwise_context_selection_v1",
        patchKey: PATCH_KEY,
        policyId: policy.id,
        decisionDateKey,
        symbol: selected.row.symbol,
        hitTarget: selected.row.hitTarget,
        labelClass: selected.row.labelClass,
        score: selected.score,
        scoreMargin: second ? selected.score - second.score : 0,
        baselineSelectorScore: rawFeature(selected.row, "selectorScore"),
        supportPatternCount: rawFeature(selected.row, "supportPatternCount"),
        supportClusterCount: rawFeature(selected.row, "supportClusterCount"),
        supportQualityRatio: selected.row.supportQualityRatio,
        supportOvercrowdRatio: selected.row.supportOvercrowdRatio,
        effectiveClusterSupport: selected.row.effectiveClusterSupport,
        topClusterWeightShare: selected.row.topClusterWeightShare,
        topClusterId: topClusterId(selected.row),
        maxClusterRowWilsonLB: rawFeature(selected.row, "maxClusterRowWilsonLB"),
        maxClusterRowEb: rawFeature(selected.row, "maxClusterRowEb"),
        exhaustionScoreRaw: selected.row.exhaustionScoreRaw,
        liquidityScoreRaw: selected.row.liquidityScoreRaw,
        qualityScoreRaw: selected.row.qualityScoreRaw,
        dayCandidateRows: dateRows.length,
        dayHasHit,
      })
    }
  }
  const policyResults = []
  for (const policy of policies) {
    const acc = accumulators.get(policy.id)
    const scorePct = percentileBy(acc.selections, (row) => row.score)
    const marginPct = percentileBy(acc.selections, (row) => row.scoreMargin)
    const liquidityPct = percentileBy(acc.selections, (row) => row.liquidityScoreRaw)
    for (const selection of acc.selections) {
      selection.confidenceScore = (
        0.65 * (scorePct.get(selection) ?? 0) +
        0.25 * (marginPct.get(selection) ?? 0) +
        0.10 * (liquidityPct.get(selection) ?? 0)
      )
    }
    const forced = metricForRows(acc.selections)
    const sortedByConfidence = [...acc.selections].sort((left, right) => {
      if (left.confidenceScore !== right.confidenceScore) return right.confidenceScore - left.confidenceScore
      if (left.score !== right.score) return right.score - left.score
      return `${left.decisionDateKey}::${left.symbol}`.localeCompare(`${right.decisionDateKey}::${right.symbol}`)
    })
    const topCutMetrics = []
    for (const cut of topCuts) {
      if (cut > sortedByConfidence.length) continue
      const metric = metricForRows(sortedByConfidence.slice(0, cut))
      topCutMetrics.push({
        topCutRows: cut,
        ...metric,
        h80Pass: metric.selectedRows >= minSelectedRows && metric.wilsonLower95 >= targetWilsonLower95,
      })
    }
    const bestTopCut = [...topCutMetrics].sort(compareTopCutForH80)[0] ?? null
    policyResults.push({
      policyId: policy.id,
      description: policy.description,
      forced,
      pairwise: finalizePairwiseStats(acc.pairwise),
      topCutMetrics,
      bestTopCut,
    })
  }
  return {
    candidateDateCount,
    datesWithPositiveCandidate,
    dailyOracleHitRate: safeRatio(datesWithPositiveCandidate, candidateDateCount),
    policyResults,
    selections: [...accumulators.values()].flatMap((acc) => acc.selections),
  }
}

export const runTp12SameDayListwiseContextAbstention = async ({
  candidatesPath,
  pathLabelsPath,
  outSummaryPath,
  outSelectionsPath,
  outFeaturesPath,
  dateFrom = null,
  dateTo = null,
  forbiddenDateFrom = null,
  forbiddenDateTo = null,
  targetPct = 0.12,
  nearMissMinPct = 0.08,
  hardNegativeMaxForwardReturnPct = 0.04,
  minSelectedRows = 150,
  targetWilsonLower95 = 0.8,
  primaryPolicyId = "listwise_context_quality_v1",
  primaryTopCutRows = 150,
  topCuts = DEFAULT_TOP_CUTS,
} = {}) => {
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outSelectionsPath)) throw new Error("outSelectionsPath is required")
  if (!toText(outFeaturesPath)) throw new Error("outFeaturesPath is required")
  if ((forbiddenDateFrom && !forbiddenDateTo) || (!forbiddenDateFrom && forbiddenDateTo)) {
    throw new Error("forbiddenDateFrom and forbiddenDateTo must be provided together")
  }
  const options = {
    dateFrom,
    dateTo,
    forbiddenDateFrom,
    forbiddenDateTo,
    targetPct: toNumber(targetPct, 0.12),
    nearMissMinPct: toNumber(nearMissMinPct, 0.08),
    hardNegativeMaxForwardReturnPct: toNumber(hardNegativeMaxForwardReturnPct, 0.04),
  }
  const normalizedTopCuts = [...new Set([...topCuts, Number(primaryTopCutRows)].map((value) => Math.trunc(Number(value))).filter((value) => value > 0))].sort((a, b) => a - b)
  const { labels, pathLabelRowCount } = await loadPathLabels({ pathLabelsPath, options })
  const { rows, byDate, candidateRows, hitCandidateRows } = await loadCandidateRows({ candidatesPath, labels, options })

  await ensureDir(path.dirname(outFeaturesPath))
  const featureWriter = createJsonlWriteStreamMaybeGzip(outFeaturesPath)
  try {
    for (const row of rows) await writeJsonlRow(featureWriter.stream, featureOutputRow(row))
  } finally {
    await featureWriter.close()
  }

  const policyEvaluation = buildPolicyResults({
    policies: POLICY_SET,
    byDate,
    topCuts: normalizedTopCuts,
    minSelectedRows,
    targetWilsonLower95,
  })

  await ensureDir(path.dirname(outSelectionsPath))
  const selectionStream = fs.createWriteStream(outSelectionsPath, { encoding: "utf8" })
  try {
    for (const selection of policyEvaluation.selections) await writeJsonlRow(selectionStream, selection)
  } finally {
    await closeWriteStream(selectionStream)
  }

  const baseline = policyEvaluation.policyResults.find((row) => row.policyId === "baseline_selector_score_desc")
  const primary = policyEvaluation.policyResults.find((row) => row.policyId === primaryPolicyId)
  if (!primary) throw new Error(`primaryPolicyId not found in policy set: ${primaryPolicyId}`)
  const primaryTopCut = primary.topCutMetrics.find((row) => row.topCutRows === Number(primaryTopCutRows))
  if (!primaryTopCut) throw new Error(`primaryTopCutRows not available: ${primaryTopCutRows}`)
  const bestForced = [...policyEvaluation.policyResults].sort((left, right) => {
    if (left.forced.hitRows !== right.forced.hitRows) return right.forced.hitRows - left.forced.hitRows
    return right.forced.wilsonLower95 - left.forced.wilsonLower95
  })[0]
  const bestTopCut = policyEvaluation.policyResults.flatMap((row) =>
    row.topCutMetrics.map((metric) => ({ policyId: row.policyId, ...metric })),
  ).sort(compareTopCutForH80)[0]
  const h80PassedTopCutCount = policyEvaluation.policyResults
    .flatMap((row) => row.topCutMetrics)
    .filter((row) => row.h80Pass).length
  const summary = {
    kind: "tp12_same_day_listwise_context_abstention_summary_v1",
    patchKey: PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status: "passed_train_only_diagnostic",
    mode: "train_only_same_day_listwise_context_abstention",
    oosRead: false,
    lockedSelectorEmitted: false,
    candidatesPath: path.resolve(candidatesPath),
    pathLabelsPath: path.resolve(pathLabelsPath),
    outSummaryPath: path.resolve(outSummaryPath),
    outSelectionsPath: path.resolve(outSelectionsPath),
    outFeaturesPath: path.resolve(outFeaturesPath),
    dateFrom,
    dateTo,
    forbiddenDateFrom,
    forbiddenDateTo,
    pathLabelRowCount,
    pathLabelSymbolDateCount: labels.size,
    candidateRows,
    hitCandidateRows,
    candidateHitRate: safeRatio(hitCandidateRows, candidateRows),
    candidateDateCount: policyEvaluation.candidateDateCount,
    datesWithPositiveCandidate: policyEvaluation.datesWithPositiveCandidate,
    dailyOracleHitRate: policyEvaluation.dailyOracleHitRate,
    minSelectedRows,
    targetWilsonLower95,
    primaryPolicyId,
    primaryTopCutRows: Number(primaryTopCutRows),
    baselineForced: baseline?.forced ?? null,
    primaryForced: primary.forced,
    primaryTopCut,
    bestForcedPolicyId: bestForced.policyId,
    bestForced: bestForced.forced,
    bestForcedVsBaselineHitRateDelta: baseline ? bestForced.forced.hitRate - baseline.forced.hitRate : null,
    bestTopCutPolicyId: bestTopCut?.policyId ?? null,
    bestTopCut,
    h80PassedTopCutCount,
    policyResults: policyEvaluation.policyResults,
    interpretation: {
      emitsLockedSelector: false,
      reason: h80PassedTopCutCount > 0
        ? "At least one diagnostic top-cut passed the requested H80 threshold, but this diagnostic still does not emit a locked selector."
        : "No policy/top-cut passed the requested H80 Wilson threshold; use this as train-only ranker feature evidence only.",
      nextStep: "If train-only top-cut metrics materially improve, open a separate locked-selector patch with nested calibration. Do not apply this diagnostic directly to OOS.",
    },
    liveFeatureSafety: {
      futurePathQualityFieldsUsedAsLiveFeatures: false,
      labelClassUsedOnlyForMetrics: true,
      maxForwardReturnUsedOnlyForLabelClass: true,
      forbiddenOosRangeEnforced: Boolean(forbiddenDateFrom && forbiddenDateTo),
    },
  }
  await writeJson(outSummaryPath, summary)
  return summary
}

export const __test = {
  POLICY_SET,
  labelClassFor,
}
