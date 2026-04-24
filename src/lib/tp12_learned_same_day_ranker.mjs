import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
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

const PATCH_KEY = "tp12_h80_learned_same_day_ranker_v1"
const MODEL_ID = "pairwise_logistic_l2_v1"
const DEFAULT_TOP_CUTS = [50, 75, 100, 150, 200, 300, 500, 978]
const DEFAULT_NEGATIVE_WEIGHTS = {
  hard_negative: 2.5,
  easy_negative: 1.5,
  near_miss: 0.75,
  other: 1,
}

const FORBIDDEN_LIVE_FEATURE_FIELDS = [
  "maxForwardReturn",
  "minForwardReturn",
  "maxForwardHighPct",
  "minForwardLowPct",
  "forwardMaxReturn",
  "forwardMinReturn",
  "hitDateKey",
  "hitDate",
  "timeToTarget",
  "targetBeforeStop",
  "stopBeforeTarget",
]

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const optionalNumeric = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const finiteNumber = (value, label) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`)
  return parsed
}

const rowKey = (row) => `${row.decisionDateKey}::${row.symbol}`

const rowYear = (row) => Number(toText(row.decisionDateKey).slice(0, 4))

const assertDateRange = ({ decisionDateKey, contextLabel, dateFrom, dateTo, forbiddenDateFrom, forbiddenDateTo }) => {
  if (!validDateKey(decisionDateKey)) throw new Error(`${contextLabel} invalid decisionDateKey: ${decisionDateKey || "missing"}`)
  if (dateFrom && decisionDateKey < dateFrom) throw new Error(`${contextLabel} date ${decisionDateKey} before dateFrom ${dateFrom}`)
  if (dateTo && decisionDateKey > dateTo) throw new Error(`${contextLabel} date ${decisionDateKey} after dateTo ${dateTo}`)
  if (forbiddenDateFrom && forbiddenDateTo && decisionDateKey >= forbiddenDateFrom && decisionDateKey <= forbiddenDateTo) {
    throw new Error(`${contextLabel} date ${decisionDateKey} is inside forbidden range ${forbiddenDateFrom}..${forbiddenDateTo}`)
  }
}

const rankValue = (row, key) => {
  if (!row.rank || typeof row.rank !== "object") throw new Error(`${rowKey(row)} missing rank object`)
  if (!Object.prototype.hasOwnProperty.call(row.rank, key)) throw new Error(`${rowKey(row)} missing rank feature ${key}`)
  return finiteNumber(row.rank[key], `${rowKey(row)} rank.${key}`)
}

const rawValue = (row, key) => finiteNumber(row[key], `${rowKey(row)} ${key}`)

const feature = (name, fn) => ({ name, fn })

const FEATURE_SPEC = [
  feature("bias", () => 1),
  feature("selectorScoreHigh", (row) => rankValue(row, "selectorScoreHigh")),
  feature("selectorScoreLow", (row) => rankValue(row, "selectorScoreLow")),
  feature("supportClusterCountHigh", (row) => rankValue(row, "supportClusterCountHigh")),
  feature("supportClusterCountLow", (row) => rankValue(row, "supportClusterCountLow")),
  feature("supportPatternCountHigh", (row) => rankValue(row, "supportPatternCountHigh")),
  feature("sumClusterRowEbHigh", (row) => rankValue(row, "sumClusterRowEbHigh")),
  feature("meanClusterRowEbHigh", (row) => rankValue(row, "meanClusterRowEbHigh")),
  feature("maxClusterRowEbHigh", (row) => rankValue(row, "maxClusterRowEbHigh")),
  feature("maxClusterRowWilsonLBHigh", (row) => rankValue(row, "maxClusterRowWilsonLBHigh")),
  feature("supportWeightedClusterRowEbHigh", (row) => rankValue(row, "supportWeightedClusterRowEbHigh")),
  feature("supportSaturatedHigh", (row) => rankValue(row, "supportSaturatedHigh")),
  feature("supportOvercrowdRatioHigh", (row) => rankValue(row, "supportOvercrowdRatioHigh")),
  feature("supportOvercrowdRatioLow", (row) => rankValue(row, "supportOvercrowdRatioLow")),
  feature("supportQualityRatioHigh", (row) => rankValue(row, "supportQualityRatioHigh")),
  feature("supportWeightedPerClusterHigh", (row) => rankValue(row, "supportWeightedPerClusterHigh")),
  feature("effectiveClusterSupportHigh", (row) => rankValue(row, "effectiveClusterSupportHigh")),
  feature("topClusterWeightShareHigh", (row) => rankValue(row, "topClusterWeightShareHigh")),
  feature("topClusterWeightShareLow", (row) => rankValue(row, "topClusterWeightShareLow")),
  feature("return1dHigh", (row) => rankValue(row, "return1dHigh")),
  feature("return1dLow", (row) => rankValue(row, "return1dLow")),
  feature("return3dHigh", (row) => rankValue(row, "return3dHigh")),
  feature("return5dHigh", (row) => rankValue(row, "return5dHigh")),
  feature("return20dHigh", (row) => rankValue(row, "return20dHigh")),
  feature("return20dLow", (row) => rankValue(row, "return20dLow")),
  feature("gapPctHigh", (row) => rankValue(row, "gapPctHigh")),
  feature("gapPctLow", (row) => rankValue(row, "gapPctLow")),
  feature("rangePctHigh", (row) => rankValue(row, "rangePctHigh")),
  feature("closeLocationHigh", (row) => rankValue(row, "closeLocationHigh")),
  feature("tradedValueRel20High", (row) => rankValue(row, "tradedValueRel20High")),
  feature("tradedValueRel20Low", (row) => rankValue(row, "tradedValueRel20Low")),
  feature("rangeRel20High", (row) => rankValue(row, "rangeRel20High")),
  feature("returnVol20High", (row) => rankValue(row, "returnVol20High")),
  feature("returnVol20Low", (row) => rankValue(row, "returnVol20Low")),
  feature("closeToHigh20PctHigh", (row) => rankValue(row, "closeToHigh20PctHigh")),
  feature("closeToHigh20PctLow", (row) => rankValue(row, "closeToHigh20PctLow")),
  feature("closeFromLow20PctHigh", (row) => rankValue(row, "closeFromLow20PctHigh")),
  feature("exhaustionScoreRawHigh", (row) => rankValue(row, "exhaustionScoreRawHigh")),
  feature("exhaustionScoreRawLow", (row) => rankValue(row, "exhaustionScoreRawLow")),
  feature("liquidityScoreRawHigh", (row) => rankValue(row, "liquidityScoreRawHigh")),
  feature("qualityScoreRawHigh", (row) => rankValue(row, "qualityScoreRawHigh")),
  feature("marketUpRatioRaw", (row) => rawValue(row, "marketUpRatio")),
  feature("limitUpProxyRel20Tanh", (row) => Math.tanh(rawValue(row, "limitUpProxyRel20"))),
  feature("supportHigh_x_exhaustionHigh", (row) => rankValue(row, "supportSaturatedHigh") * rankValue(row, "exhaustionScoreRawHigh")),
  feature("supportHigh_x_exhaustionLow", (row) => rankValue(row, "supportSaturatedHigh") * rankValue(row, "exhaustionScoreRawLow")),
  feature("supportHigh_x_qualityHigh", (row) => rankValue(row, "supportSaturatedHigh") * rankValue(row, "qualityScoreRawHigh")),
  feature("supportHigh_x_liquidityHigh", (row) => rankValue(row, "supportSaturatedHigh") * rankValue(row, "liquidityScoreRawHigh")),
  feature("overcrowdHigh_x_exhaustionHigh", (row) => rankValue(row, "supportOvercrowdRatioHigh") * rankValue(row, "exhaustionScoreRawHigh")),
  feature("qualityHigh_x_topClusterLow", (row) => rankValue(row, "supportQualityRatioHigh") * rankValue(row, "topClusterWeightShareLow")),
  feature("selectorHigh_x_exhaustionLow", (row) => rankValue(row, "selectorScoreHigh") * rankValue(row, "exhaustionScoreRawLow")),
  feature("qualityHigh_x_liquidityHigh", (row) => rankValue(row, "qualityScoreRawHigh") * rankValue(row, "liquidityScoreRawHigh")),
  feature("marketRaw_x_supportHigh", (row) => rawValue(row, "marketUpRatio") * rankValue(row, "supportSaturatedHigh")),
  feature("closeLocationHigh_x_rangeRel20High", (row) => rankValue(row, "closeLocationHigh") * rankValue(row, "rangeRel20High")),
]

const normalizeLabelClass = (value) => {
  const text = toText(value)
  if (!text || text === "positive") return text || "positive"
  if (["hard_negative", "easy_negative", "near_miss"].includes(text)) return text
  return "other"
}

const validateFeatureRow = ({ raw, contextLabel, options }) => {
  for (const field of FORBIDDEN_LIVE_FEATURE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      throw new Error(`${contextLabel} exports forbidden future/path-quality live feature: ${field}`)
    }
  }
  const decisionDateKey = toText(raw.decisionDateKey ?? raw.dateKey)
  const symbol = toText(raw.symbol).toUpperCase()
  if (!symbol) throw new Error(`${contextLabel} missing symbol`)
  assertDateRange({ decisionDateKey, contextLabel, ...options })
  if (!Object.prototype.hasOwnProperty.call(raw, "hitTarget")) throw new Error(`${contextLabel} missing hitTarget`)
  const hitTarget = raw.hitTarget === true
  const labelClass = hitTarget ? "positive" : normalizeLabelClass(raw.labelClass)
  if (hitTarget && labelClass !== "positive") throw new Error(`${contextLabel} hitTarget row must have positive labelClass`)
  const row = {
    ...raw,
    decisionDateKey,
    symbol,
    hitTarget,
    labelClass,
    topClusterId: toText(raw.topClusterId) || "unknown",
  }
  rawValue(row, "selectorScore")
  rawValue(row, "supportClusterCount")
  rawValue(row, "supportQualityRatio")
  const features = FEATURE_SPEC.map((spec) => spec.fn(row))
  features.forEach((value, index) => finiteNumber(value, `${contextLabel} feature ${FEATURE_SPEC[index].name}`))
  row.modelFeatures = features
  return row
}

const loadFeatureRows = async ({ featuresPath, options }) => {
  if (!toText(featuresPath)) throw new Error("featuresPath is required")
  if (!fs.existsSync(featuresPath)) throw new Error(`features not found: ${featuresPath}`)
  const rows = []
  const byDate = new Map()
  const seen = new Set()
  let hitCandidateRows = 0
  const yearCounts = new Map()
  await iterateJsonlMaybeGzip(featuresPath, {
    strict: true,
    onRow: async (raw, context) => {
      const row = validateFeatureRow({
        raw,
        contextLabel: `${context.filePath}:${context.lineNumber}`,
        options,
      })
      const key = rowKey(row)
      if (seen.has(key)) throw new Error(`duplicate feature symbol/date row: ${key}`)
      seen.add(key)
      rows.push(row)
      if (row.hitTarget) hitCandidateRows += 1
      incrementMap(yearCounts, String(rowYear(row)))
      const dateRows = byDate.get(row.decisionDateKey) ?? []
      dateRows.push(row)
      byDate.set(row.decisionDateKey, dateRows)
    },
  })
  if (rows.length < 1) throw new Error(`features produced zero rows: ${featuresPath}`)
  for (const [dateKey, dateRows] of byDate.entries()) {
    const positives = dateRows.filter((row) => row.hitTarget).length
    if (positives < 1) throw new Error(`date ${dateKey} has no positive candidate; this diagnostic expects candidate-date oracle support`)
  }
  const years = [...yearCounts.keys()].sort()
  if (years.length < 2) throw new Error(`need at least two train years for leave-one-year-out diagnostic, found ${years.length}`)
  return { rows, byDate, years, hitCandidateRows }
}

const baselineScore = (row) => rawValue(row, "selectorScore")

const supportTemperedScore = (row) =>
  rawValue(row, "supportQualityRatio")

const modelScore = (weights, row) => {
  let score = 0
  for (let index = 0; index < weights.length; index += 1) score += weights[index] * row.modelFeatures[index]
  return score
}

const compareScoredRows = (left, right) => {
  if (left.score !== right.score) return right.score - left.score
  const qualityDiff = rawValue(right.row, "maxClusterRowWilsonLB") - rawValue(left.row, "maxClusterRowWilsonLB")
  if (qualityDiff !== 0) return qualityDiff
  const supportDiff = rawValue(right.row, "supportClusterCount") - rawValue(left.row, "supportClusterCount")
  if (supportDiff !== 0) return supportDiff
  return left.row.symbol.localeCompare(right.row.symbol)
}

const compareSupportTemperedRows = (left, right) => {
  if (left.score !== right.score) return right.score - left.score
  const supportDiff = rawValue(left.row, "supportClusterCount") - rawValue(right.row, "supportClusterCount")
  if (supportDiff !== 0) return supportDiff
  return compareScoredRows(left, right)
}

const selectTopByPolicy = ({ policyId, byDate, scoreFn, compareFn = compareScoredRows, foldId = null, scoreByKey = null }) => {
  const selections = []
  const pairwise = { pairCount: 0, winCount: 0, tieCount: 0, lossCount: 0 }
  for (const [decisionDateKey, dateRows] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const scored = dateRows.map((row) => ({
      row,
      score: scoreByKey ? scoreByKey.get(rowKey(row)) : scoreFn(row),
    })).sort(compareFn)
    const selected = scored[0]
    const second = scored[1] ?? null
    const scoreMap = new Map(scored.map((item) => [rowKey(item.row), item.score]))
    const positives = dateRows.filter((row) => row.hitTarget)
    const negatives = dateRows.filter((row) => !row.hitTarget)
    for (const positive of positives) {
      const positiveScore = scoreMap.get(rowKey(positive))
      for (const negative of negatives) {
        const negativeScore = scoreMap.get(rowKey(negative))
        pairwise.pairCount += 1
        if (positiveScore > negativeScore) pairwise.winCount += 1
        else if (positiveScore === negativeScore) pairwise.tieCount += 1
        else pairwise.lossCount += 1
      }
    }
    selections.push({
      kind: "tp12_learned_same_day_ranker_prediction_v1",
      patchKey: PATCH_KEY,
      modelId: MODEL_ID,
      policyId,
      foldId,
      decisionDateKey,
      symbol: selected.row.symbol,
      hitTarget: selected.row.hitTarget,
      labelClass: selected.row.labelClass,
      score: selected.score,
      scoreMargin: second ? selected.score - second.score : 0,
      baselineSelectorScore: baselineScore(selected.row),
      supportTemperedScore: supportTemperedScore(selected.row),
      supportClusterCount: rawValue(selected.row, "supportClusterCount"),
      maxClusterRowWilsonLB: rawValue(selected.row, "maxClusterRowWilsonLB"),
      topClusterId: selected.row.topClusterId,
      dayCandidateRows: dateRows.length,
    })
  }
  return { selections, pairwise }
}

const percentileBy = (items, valueFn) => {
  const sorted = [...items].sort((left, right) => {
    const diff = valueFn(left) - valueFn(right)
    if (diff !== 0) return diff
    return `${left.decisionDateKey}::${left.symbol}::${left.policyId}`.localeCompare(`${right.decisionDateKey}::${right.symbol}::${right.policyId}`)
  })
  const denominator = Math.max(1, sorted.length - 1)
  const out = new Map()
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

const attachConfidenceMetrics = (selections) => {
  const scorePct = percentileBy(selections, (row) => row.score)
  const marginPct = percentileBy(selections, (row) => row.scoreMargin)
  const supportPct = percentileBy(selections, (row) => row.maxClusterRowWilsonLB)
  for (const selection of selections) {
    selection.confidenceScore = (
      0.55 * (scorePct.get(selection) ?? 0) +
      0.30 * (marginPct.get(selection) ?? 0) +
      0.15 * (supportPct.get(selection) ?? 0)
    )
  }
}

const topCutMetricsFor = ({ selections, topCuts, minSelectedRows, targetWilsonLower95 }) => {
  attachConfidenceMetrics(selections)
  const sorted = [...selections].sort((left, right) => {
    if (left.confidenceScore !== right.confidenceScore) return right.confidenceScore - left.confidenceScore
    if (left.score !== right.score) return right.score - left.score
    return `${left.decisionDateKey}::${left.symbol}`.localeCompare(`${right.decisionDateKey}::${right.symbol}`)
  })
  const metrics = []
  for (const cut of topCuts) {
    if (cut > sorted.length) continue
    const metric = metricForRows(sorted.slice(0, cut))
    metrics.push({
      topCutRows: cut,
      ...metric,
      h80Pass: metric.selectedRows >= minSelectedRows && metric.wilsonLower95 >= targetWilsonLower95,
    })
  }
  return metrics
}

const finalizePolicyResult = ({ policyId, selections, pairwise, topCuts, minSelectedRows, targetWilsonLower95 }) => ({
  policyId,
  forced: metricForRows(selections),
  pairwise: {
    ...pairwise,
    winRate: safeRatio(pairwise.winCount + 0.5 * pairwise.tieCount, pairwise.pairCount),
  },
  topCutMetrics: topCutMetricsFor({ selections, topCuts, minSelectedRows, targetWilsonLower95 }),
})

const selectedNegativeRowsForDate = ({ dateRows }) => {
  const negatives = dateRows.filter((row) => !row.hitTarget)
  const add = (target, rows) => {
    for (const row of rows) target.set(rowKey(row), row)
  }
  const selected = new Map()
  add(selected, [...negatives].sort((a, b) => baselineScore(b) - baselineScore(a)).slice(0, 20))
  add(selected, [...negatives].sort((a, b) => rawValue(b, "supportClusterCount") - rawValue(a, "supportClusterCount")).slice(0, 20))
  add(selected, [...negatives].sort((a, b) => rankValue(b, "exhaustionScoreRawHigh") - rankValue(a, "exhaustionScoreRawHigh")).slice(0, 20))
  add(selected, negatives.filter((row) => row.labelClass === "hard_negative").sort((a, b) => baselineScore(b) - baselineScore(a)).slice(0, 40))
  add(selected, negatives.filter((row) => row.labelClass === "easy_negative").sort((a, b) => baselineScore(b) - baselineScore(a)).slice(0, 25))
  add(selected, negatives.filter((row) => row.labelClass === "near_miss").sort((a, b) => baselineScore(b) - baselineScore(a)).slice(0, 15))
  if (selected.size < 1 && negatives.length > 0) add(selected, negatives.slice(0, 1))
  return [...selected.values()]
}

const buildTrainingPairs = ({ trainDates, byDate, maxPairsPerDate, negativeWeights, baselineSelectedFalsePositiveMultiplier }) => {
  const pairs = []
  let dateCountWithPairs = 0
  let skippedDateCount = 0
  const byNegativeClass = new Map()
  for (const dateKey of trainDates) {
    const dateRows = byDate.get(dateKey) ?? []
    const positives = dateRows.filter((row) => row.hitTarget)
    const selectedNegatives = selectedNegativeRowsForDate({ dateRows })
    if (positives.length < 1 || selectedNegatives.length < 1) {
      skippedDateCount += 1
      continue
    }
    const baselineTop = [...dateRows].map((row) => ({ row, score: baselineScore(row) })).sort(compareScoredRows)[0]?.row ?? null
    const datePairs = []
    for (const positive of positives) {
      for (const negative of selectedNegatives) {
        let weight = negativeWeights[negative.labelClass] ?? negativeWeights.other ?? 1
        if (baselineTop && rowKey(baselineTop) === rowKey(negative)) weight *= baselineSelectedFalsePositiveMultiplier
        datePairs.push({ positive, negative, weight })
      }
    }
    datePairs.sort((left, right) => {
      const classDiff = (negativeWeights[right.negative.labelClass] ?? 1) - (negativeWeights[left.negative.labelClass] ?? 1)
      if (classDiff !== 0) return classDiff
      const scoreDiff = baselineScore(right.negative) - baselineScore(left.negative)
      if (scoreDiff !== 0) return scoreDiff
      return `${left.positive.symbol}::${left.negative.symbol}`.localeCompare(`${right.positive.symbol}::${right.negative.symbol}`)
    })
    const limitedPairs = datePairs.slice(0, maxPairsPerDate)
    const averageWeight = limitedPairs.reduce((sum, pair) => sum + pair.weight, 0) / Math.max(1, limitedPairs.length)
    for (const pair of limitedPairs) {
      pair.weight = pair.weight / Math.max(1e-12, averageWeight)
      incrementMap(byNegativeClass, pair.negative.labelClass)
      pairs.push(pair)
    }
    dateCountWithPairs += 1
  }
  if (pairs.length < 1) throw new Error("pairwise logistic training has zero positive-vs-negative pairs")
  return {
    pairs,
    dateCountWithPairs,
    skippedDateCount,
    byNegativeClass: mapToSortedObject(byNegativeClass),
  }
}

const dot = (weights, features) => {
  let value = 0
  for (let index = 0; index < weights.length; index += 1) value += weights[index] * features[index]
  return value
}

const sigmoidNegative = (diff) => {
  if (diff > 35) return Math.exp(-diff)
  if (diff < -35) return 1
  return 1 / (1 + Math.exp(diff))
}

const trainPairwiseLogistic = ({ pairs, featureCount, epochs, learningRate, lambda }) => {
  const weights = new Array(featureCount).fill(0)
  const epochSummaries = []
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const eta = learningRate / Math.sqrt(1 + epoch * 0.15)
    const l2Decay = Math.max(0, 1 - eta * lambda)
    for (let index = 0; index < weights.length; index += 1) weights[index] *= l2Decay
    let weightedLoss = 0
    let weightedPairCount = 0
    let winCount = 0
    for (const pair of pairs) {
      const diff = dot(weights, pair.positive.modelFeatures) - dot(weights, pair.negative.modelFeatures)
      const factor = sigmoidNegative(diff)
      weightedLoss += pair.weight * Math.log1p(Math.exp(-Math.max(-35, Math.min(35, diff))))
      weightedPairCount += pair.weight
      if (diff > 0) winCount += 1
      const step = Math.min(0.05, eta * pair.weight * factor)
      for (let index = 0; index < weights.length; index += 1) {
        weights[index] += step * (pair.positive.modelFeatures[index] - pair.negative.modelFeatures[index])
      }
    }
    epochSummaries.push({
      epoch: epoch + 1,
      learningRate: eta,
      weightedLoss: weightedLoss / Math.max(1e-12, weightedPairCount),
      trainPairWinRate: safeRatio(winCount, pairs.length),
    })
  }
  return { weights, epochSummaries }
}

const splitDatesByValidationYear = ({ byDate, years }) => {
  const datesByYear = new Map(years.map((year) => [year, []]))
  for (const dateKey of [...byDate.keys()].sort()) {
    const year = dateKey.slice(0, 4)
    if (datesByYear.has(year)) datesByYear.get(year).push(dateKey)
  }
  return [...datesByYear.entries()].map(([validationYear, validationDates]) => ({
    foldId: `loo_${validationYear}`,
    validationYear,
    validationDates,
    trainDates: [...byDate.keys()].filter((dateKey) => dateKey.slice(0, 4) !== validationYear).sort(),
  }))
}

const buildDateSubset = (byDate, dates) => new Map(dates.map((dateKey) => [dateKey, byDate.get(dateKey) ?? []]))

const evaluateLearnedFolds = ({
  byDate,
  years,
  maxPairsPerDate,
  negativeWeights,
  baselineSelectedFalsePositiveMultiplier,
  epochs,
  learningRate,
  lambda,
}) => {
  const folds = splitDatesByValidationYear({ byDate, years })
  const learnedSelections = []
  const foldSummaries = []
  for (const fold of folds) {
    if (fold.validationDates.length < 1) throw new Error(`fold ${fold.foldId} has zero validation dates`)
    if (fold.trainDates.length < 1) throw new Error(`fold ${fold.foldId} has zero train dates`)
    const pairBuild = buildTrainingPairs({
      trainDates: fold.trainDates,
      byDate,
      maxPairsPerDate,
      negativeWeights,
      baselineSelectedFalsePositiveMultiplier,
    })
    const model = trainPairwiseLogistic({
      pairs: pairBuild.pairs,
      featureCount: FEATURE_SPEC.length,
      epochs,
      learningRate,
      lambda,
    })
    const scoreByKey = new Map()
    for (const dateKey of fold.validationDates) {
      for (const row of byDate.get(dateKey) ?? []) {
        scoreByKey.set(rowKey(row), modelScore(model.weights, row))
      }
    }
    const validationByDate = buildDateSubset(byDate, fold.validationDates)
    const evalResult = selectTopByPolicy({
      policyId: "learned_pairwise_logistic_l2_v1",
      byDate: validationByDate,
      foldId: fold.foldId,
      scoreByKey,
      scoreFn: null,
    })
    learnedSelections.push(...evalResult.selections)
    foldSummaries.push({
      foldId: fold.foldId,
      validationYear: fold.validationYear,
      trainDateCount: fold.trainDates.length,
      validationDateCount: fold.validationDates.length,
      trainingPairCount: pairBuild.pairs.length,
      trainingPairDateCount: pairBuild.dateCountWithPairs,
      skippedTrainingDateCount: pairBuild.skippedDateCount,
      trainingPairNegativeClassCounts: pairBuild.byNegativeClass,
      finalEpoch: model.epochSummaries[model.epochSummaries.length - 1],
      forced: metricForRows(evalResult.selections),
      pairwise: {
        ...evalResult.pairwise,
        winRate: safeRatio(evalResult.pairwise.winCount + 0.5 * evalResult.pairwise.tieCount, evalResult.pairwise.pairCount),
      },
      topPositiveWeights: FEATURE_SPEC.map((spec, index) => ({ feature: spec.name, weight: model.weights[index] }))
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 12),
      topNegativeWeights: FEATURE_SPEC.map((spec, index) => ({ feature: spec.name, weight: model.weights[index] }))
        .sort((left, right) => left.weight - right.weight)
        .slice(0, 12),
    })
  }
  return { learnedSelections, foldSummaries }
}

const bestTopCut = (policyResult) => [...policyResult.topCutMetrics].sort((left, right) => {
  if (left.wilsonLower95 !== right.wilsonLower95) return right.wilsonLower95 - left.wilsonLower95
  if (left.hitRate !== right.hitRate) return right.hitRate - left.hitRate
  if (left.selectedRows !== right.selectedRows) return right.selectedRows - left.selectedRows
  return left.topCutRows - right.topCutRows
})[0] ?? null

export const runTp12LearnedSameDayRanker = async ({
  featuresPath,
  outSummaryPath,
  outPredictionsPath,
  dateFrom = null,
  dateTo = null,
  forbiddenDateFrom = null,
  forbiddenDateTo = null,
  minSelectedRows = 150,
  targetWilsonLower95 = 0.8,
  topCuts = DEFAULT_TOP_CUTS,
  epochs = 60,
  learningRate = 0.005,
  lambda = 0.01,
  maxPairsPerDate = 120,
  baselineSelectedFalsePositiveMultiplier = 1.5,
  negativeWeights = DEFAULT_NEGATIVE_WEIGHTS,
} = {}) => {
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outPredictionsPath)) throw new Error("outPredictionsPath is required")
  if ((forbiddenDateFrom && !forbiddenDateTo) || (!forbiddenDateFrom && forbiddenDateTo)) {
    throw new Error("forbiddenDateFrom and forbiddenDateTo must be provided together")
  }
  const options = { dateFrom, dateTo, forbiddenDateFrom, forbiddenDateTo }
  const normalizedTopCuts = [...new Set(topCuts.map((value) => Math.trunc(Number(value))).filter((value) => value > 0))].sort((a, b) => a - b)
  const normalizedEpochs = Math.max(1, Math.trunc(toNumber(epochs, 60)))
  const normalizedMaxPairsPerDate = Math.max(1, Math.trunc(toNumber(maxPairsPerDate, 120)))
  const normalizedLearningRate = finiteNumber(learningRate, "learningRate")
  const normalizedLambda = Math.max(0, finiteNumber(lambda, "lambda"))
  const { rows, byDate, years, hitCandidateRows } = await loadFeatureRows({ featuresPath, options })

  const baseline = selectTopByPolicy({
    policyId: "baseline_selector_score_desc",
    byDate,
    scoreFn: baselineScore,
  })
  const supportTempered = selectTopByPolicy({
    policyId: "support_tempered_roweb_v1",
    byDate,
    scoreFn: supportTemperedScore,
    compareFn: compareSupportTemperedRows,
  })
  const learned = evaluateLearnedFolds({
    byDate,
    years,
    maxPairsPerDate: normalizedMaxPairsPerDate,
    negativeWeights,
    baselineSelectedFalsePositiveMultiplier,
    epochs: normalizedEpochs,
    learningRate: normalizedLearningRate,
    lambda: normalizedLambda,
  })

  const policyResults = [
    finalizePolicyResult({
      policyId: "baseline_selector_score_desc",
      selections: baseline.selections,
      pairwise: baseline.pairwise,
      topCuts: normalizedTopCuts,
      minSelectedRows,
      targetWilsonLower95,
    }),
    finalizePolicyResult({
      policyId: "support_tempered_roweb_v1",
      selections: supportTempered.selections,
      pairwise: supportTempered.pairwise,
      topCuts: normalizedTopCuts,
      minSelectedRows,
      targetWilsonLower95,
    }),
    finalizePolicyResult({
      policyId: "learned_pairwise_logistic_l2_v1",
      selections: learned.learnedSelections,
      pairwise: learned.foldSummaries.reduce((acc, fold) => {
        acc.pairCount += fold.pairwise.pairCount
        acc.winCount += fold.pairwise.winCount
        acc.tieCount += fold.pairwise.tieCount
        acc.lossCount += fold.pairwise.lossCount
        return acc
      }, { pairCount: 0, winCount: 0, tieCount: 0, lossCount: 0 }),
      topCuts: normalizedTopCuts,
      minSelectedRows,
      targetWilsonLower95,
    }),
  ]
  const baselineResult = policyResults.find((row) => row.policyId === "baseline_selector_score_desc")
  const supportResult = policyResults.find((row) => row.policyId === "support_tempered_roweb_v1")
  const learnedResult = policyResults.find((row) => row.policyId === "learned_pairwise_logistic_l2_v1")
  const learnedTopCut150 = learnedResult.topCutMetrics.find((row) => row.topCutRows === 150) ?? null
  const learnedBestTopCut = bestTopCut(learnedResult)
  const h80PassedTopCutCount = learnedResult.topCutMetrics.filter((row) => row.h80Pass && row.hitRows >= 130).length
  const sanityGate = {
    forcedTop1HitRateMinPass: learnedResult.forced.hitRate >= 0.465,
    forcedTop1VsSupportTemperedPlus2ppPass: learnedResult.forced.hitRate >= supportResult.forced.hitRate + 0.02,
    topCut150Min57Pass: Boolean(learnedTopCut150 && learnedTopCut150.hitRate >= 0.57),
  }
  const researchGate = {
    forcedTop1Min50Pass: learnedResult.forced.hitRate >= 0.5,
    topCut150Min60Pass: Boolean(learnedTopCut150 && learnedTopCut150.hitRate >= 0.6),
    activeValidationYearsPass: learnedResult.forced.coverage.activeYearCount >= 4,
    topPatternClusterConcentrationPass: learnedResult.forced.concentration.topPatternClusterShare <= 0.45,
  }
  const h80Gate = {
    h80PassedTopCutCount,
    selectedRowsPass: Boolean(learnedBestTopCut && learnedBestTopCut.selectedRows >= minSelectedRows),
    hitRowsAt150EquivalentPass: Boolean(learnedBestTopCut && learnedBestTopCut.selectedRows >= 150 && learnedBestTopCut.hitRows >= 130),
    wilsonLower95Pass: Boolean(learnedBestTopCut && learnedBestTopCut.wilsonLower95 >= targetWilsonLower95),
  }
  const status = h80PassedTopCutCount > 0
    ? "completed_train_only_diagnostic_h80_signal_no_lock"
    : (researchGate.forcedTop1Min50Pass && researchGate.topCut150Min60Pass)
        ? "completed_train_only_diagnostic_research_tier_no_lock"
        : (sanityGate.forcedTop1HitRateMinPass || sanityGate.forcedTop1VsSupportTemperedPlus2ppPass || sanityGate.topCut150Min57Pass)
            ? "completed_train_only_diagnostic_sanity_lift_no_lock"
            : "completed_train_only_diagnostic_no_lift_no_lock"

  await ensureDir(path.dirname(outPredictionsPath))
  const predictionStream = fs.createWriteStream(outPredictionsPath, { encoding: "utf8" })
  try {
    for (const row of [...baseline.selections, ...supportTempered.selections, ...learned.learnedSelections]) {
      await writeJsonlRow(predictionStream, row)
    }
  } finally {
    await closeWriteStream(predictionStream)
  }

  const summary = {
    kind: "tp12_learned_same_day_ranker_summary_v1",
    patchKey: PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status,
    mode: "train_only_learned_same_day_pairwise_ranker_diagnostic",
    modelId: MODEL_ID,
    foldMode: "leave_one_year_out_train_oof_diagnostic",
    productionNestedLockEligible: false,
    oosRead: false,
    lockedSelectorEmitted: false,
    featuresPath: path.resolve(featuresPath),
    outSummaryPath: path.resolve(outSummaryPath),
    outPredictionsPath: path.resolve(outPredictionsPath),
    dateFrom,
    dateTo,
    forbiddenDateFrom,
    forbiddenDateTo,
    featureSchema: FEATURE_SPEC.map((spec) => spec.name),
    candidateRows: rows.length,
    hitCandidateRows,
    candidateHitRate: safeRatio(hitCandidateRows, rows.length),
    candidateDateCount: byDate.size,
    validationYears: years,
    topCuts: normalizedTopCuts,
    modelConfig: {
      epochs: normalizedEpochs,
      learningRate: normalizedLearningRate,
      lambda: normalizedLambda,
      maxPairsPerDate: normalizedMaxPairsPerDate,
      baselineSelectedFalsePositiveMultiplier,
      negativeWeights,
    },
    baselineForced: baselineResult.forced,
    supportTemperedForced: supportResult.forced,
    learnedForced: learnedResult.forced,
    learnedVsBaselineHitRateDelta: learnedResult.forced.hitRate - baselineResult.forced.hitRate,
    learnedVsSupportTemperedHitRateDelta: learnedResult.forced.hitRate - supportResult.forced.hitRate,
    learnedTopCut150,
    learnedBestTopCut,
    h80PassedTopCutCount,
    sanityGate,
    researchGate,
    h80Gate,
    foldSummaries: learned.foldSummaries,
    policyResults,
    interpretation: {
      emitsLockedSelector: false,
      reason: h80PassedTopCutCount > 0
        ? "The learned diagnostic produced an H80-like train-only top-cut signal, but this path is not a production lock."
        : "The learned diagnostic did not pass the H80 Wilson gate; do not replay this selector on OOS.",
      nextStep: h80PassedTopCutCount > 0
        ? "Open a separate explicit nested calibration and lock patch before any OOS replay."
        : "If research/sanity gates are weak, stop current-feature hand tuning and move to explicit new feature-source patches.",
    },
    liveFeatureSafety: {
      forbiddenFuturePathQualityFieldsRejected: true,
      labelClassUsedOnlyForTrainingWeightsAndMetrics: true,
      oosDateRangeRejected: Boolean(forbiddenDateFrom && forbiddenDateTo),
      noFallbackModelSelection: true,
    },
  }
  await writeJson(outSummaryPath, summary)
  return summary
}

export const __test = {
  FEATURE_SPEC,
  buildTrainingPairs,
  validateFeatureRow,
}
