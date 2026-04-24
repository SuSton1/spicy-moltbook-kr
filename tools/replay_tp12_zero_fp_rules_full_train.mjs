#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { wilsonInterval } from "../src/lib/tp12_year2hit_operating_gate.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "../src/lib/tp12_year2hit_foundation_io.mjs"

const keyOf = (dateKey, symbol) => `${dateKey}\t${symbol}`
const patternIdOf = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const symbolOf = (row) => toText(row?.symbol).toUpperCase()
const dateOf = (row) => toText(row?.decisionDateKey ?? row?.dateKey)
const familyOf = (token) => toText(token).split(":")[0] || "unknown"

const CLASS_PRIORITY = new Map([
  ["positive", 4],
  ["near_miss", 3],
  ["hard_negative", 2],
  ["easy_negative", 1],
])

const requirePath = (value, label, cwd) => {
  const resolved = path.resolve(cwd, toText(value))
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

const safeRatio = (num, den) => (den > 0 ? num / den : 0)

const priorMean = ({ numerator, denominator, baseRate, priorStrength }) =>
  denominator > 0 || priorStrength > 0
    ? (numerator + baseRate * priorStrength) / (denominator + priorStrength)
    : 0

const readJsonlRows = async (filePath) => {
  const rows = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  return rows
}

export const loadPatternTokens = async (catalogPath) => {
  const byPattern = new Map()
  await iterateJsonlMaybeGzip(catalogPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = patternIdOf(row)
      if (!patternId) throw new Error(`catalog row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (byPattern.has(patternId)) throw new Error(`duplicate patternId in catalog: ${patternId}`)
      byPattern.set(patternId, uniqueSorted(row?.tokenSet ?? row?.tokens ?? []))
    },
  })
  if (byPattern.size < 1) throw new Error(`catalog produced zero patterns: ${catalogPath}`)
  return byPattern
}

export const loadClusterByPattern = async (clustersPath) => {
  const byPattern = new Map()
  await iterateJsonlMaybeGzip(clustersPath, {
    strict: true,
    onRow: async (row, context) => {
      const clusterId = toText(row?.clusterId)
      if (!clusterId) throw new Error(`cluster row missing clusterId at ${context.filePath}:${context.lineNumber}`)
      const patternIds = uniqueSorted(row?.patternIds ?? [])
      if (patternIds.length < 1) throw new Error(`cluster row has no patternIds: ${clusterId}`)
      for (const patternId of patternIds) {
        if (byPattern.has(patternId)) throw new Error(`pattern appears in multiple clusters: ${patternId}`)
        byPattern.set(patternId, clusterId)
      }
    },
  })
  if (byPattern.size < 1) throw new Error(`cluster source produced zero pattern mappings: ${clustersPath}`)
  return byPattern
}

export const loadLabelBySymbolDate = async (labelsPath) => {
  const byKey = new Map()
  let rowCount = 0
  await iterateJsonlMaybeGzip(labelsPath, {
    strict: true,
    onRow: async (row, context) => {
      rowCount += 1
      const symbol = symbolOf(row)
      const dateKey = dateOf(row)
      if (!symbol) throw new Error(`label row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) throw new Error(`label row invalid date at ${context.filePath}:${context.lineNumber}`)
      const key = keyOf(dateKey, symbol)
      const current = byKey.get(key)
      const labelClass = row?.hitTarget === true ? "positive" : toText(row?.labelClass || "unknown")
      const candidate = {
        hitTarget: row?.hitTarget === true,
        labelClass,
        maxForwardReturn: toNumber(row?.maxForwardReturn, null),
        minForwardReturn: toNumber(row?.minForwardReturn, null),
      }
      if (!current) {
        byKey.set(key, candidate)
        return
      }
      if (current.hitTarget !== candidate.hitTarget) {
        throw new Error(`conflicting hitTarget in labels for ${dateKey}::${symbol}`)
      }
      const currentPriority = CLASS_PRIORITY.get(current.labelClass) ?? 0
      const candidatePriority = CLASS_PRIORITY.get(candidate.labelClass) ?? 0
      if (candidatePriority > currentPriority) current.labelClass = candidate.labelClass
      if (Number.isFinite(candidate.maxForwardReturn)) {
        current.maxForwardReturn = Math.max(toNumber(current.maxForwardReturn, -Infinity), candidate.maxForwardReturn)
      }
      if (Number.isFinite(candidate.minForwardReturn)) {
        current.minForwardReturn = Math.min(toNumber(current.minForwardReturn, Infinity), candidate.minForwardReturn)
      }
    },
  })
  if (rowCount < 1) throw new Error(`label source produced zero rows: ${labelsPath}`)
  return byKey
}

export const loadContextBySymbolDate = async (contextPath) => {
  const byKey = new Map()
  await iterateJsonlMaybeGzip(contextPath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = symbolOf(row)
      const dateKey = dateOf(row)
      if (!symbol) throw new Error(`context row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) throw new Error(`context row invalid date at ${context.filePath}:${context.lineNumber}`)
      const key = keyOf(dateKey, symbol)
      if (byKey.has(key)) throw new Error(`duplicate context row for ${dateKey}::${symbol}`)
      byKey.set(key, row)
    },
  })
  if (byKey.size < 1) throw new Error(`context source produced zero rows: ${contextPath}`)
  return byKey
}

const emptyPatternStats = () => ({
  matchRows: 0,
  hitRows: 0,
  matchedDates: new Set(),
  hitDates: new Set(),
  yearHitDateCounts: new Map(),
})

export const buildPatternReliability = async ({ eventsPath, priorStrengthRow, priorStrengthDate }) => {
  const statsByPattern = new Map()
  let rowCount = 0
  let hitRowCount = 0
  const matchedDates = new Set()
  const hitDates = new Set()
  await iterateJsonlMaybeGzip(eventsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = patternIdOf(row)
      const dateKey = dateOf(row)
      if (!patternId) throw new Error(`event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) throw new Error(`event row invalid date at ${context.filePath}:${context.lineNumber}`)
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`event row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const stats = statsByPattern.get(patternId) ?? emptyPatternStats()
      const hitTarget = row.hitTarget === true
      stats.matchRows += 1
      stats.matchedDates.add(dateKey)
      matchedDates.add(dateKey)
      rowCount += 1
      if (hitTarget) {
        stats.hitRows += 1
        stats.hitDates.add(dateKey)
        hitDates.add(dateKey)
        hitRowCount += 1
        const year = dateKey.slice(0, 4)
        stats.yearHitDateCounts.set(year, (stats.yearHitDateCounts.get(year) ?? 0) + 1)
      }
      statsByPattern.set(patternId, stats)
    },
  })
  if (rowCount < 1) throw new Error(`event source produced zero rows: ${eventsPath}`)
  const rowBaseRate = safeRatio(hitRowCount, rowCount)
  const dateBaseRate = safeRatio(hitDates.size, matchedDates.size)
  const reliabilityByPattern = new Map()
  for (const [patternId, stats] of statsByPattern.entries()) {
    const matchedDateCount = stats.matchedDates.size
    const hitDateCount = stats.hitDates.size
    const rowWilson = wilsonInterval({ hitRows: stats.hitRows, selectedRows: stats.matchRows })
    const dateWilson = wilsonInterval({ hitRows: hitDateCount, selectedRows: matchedDateCount })
    reliabilityByPattern.set(patternId, {
      patternId,
      matchRows: stats.matchRows,
      hitRows: stats.hitRows,
      rowPrecision: safeRatio(stats.hitRows, stats.matchRows),
      rowEbMean: priorMean({
        numerator: stats.hitRows,
        denominator: stats.matchRows,
        baseRate: rowBaseRate,
        priorStrength: priorStrengthRow,
      }),
      rowWilsonLB: rowWilson.lower,
      matchedDateCount,
      hitDateCount,
      datePrecision: safeRatio(hitDateCount, matchedDateCount),
      dateEbMean: priorMean({
        numerator: hitDateCount,
        denominator: matchedDateCount,
        baseRate: dateBaseRate,
        priorStrength: priorStrengthDate,
      }),
      dateWilsonLB: dateWilson.lower,
      yearHitDateCounts: Object.fromEntries([...stats.yearHitDateCounts.entries()].sort()),
    })
  }
  return {
    reliabilityByPattern,
    reliabilitySummary: {
      eventRowCount: rowCount,
      eventHitRowCount: hitRowCount,
      rowBaseRate,
      matchedDateCount: matchedDates.size,
      hitDateCount: hitDates.size,
      dateBaseRate,
      patternCount: reliabilityByPattern.size,
      priorStrengthRow,
      priorStrengthDate,
    },
  }
}

const sortedClusterSummaries = (clusterStats) =>
  [...clusterStats.entries()]
    .map(([clusterId, stats]) => ({
      clusterId,
      patternIds: uniqueSorted([...stats.patternIds]),
      patternCount: stats.patternIds.size,
      maxRowEb: stats.maxRowEb,
      maxDateEb: stats.maxDateEb,
      maxRowWilsonLB: stats.maxRowWilsonLB,
      maxDateWilsonLB: stats.maxDateWilsonLB,
      hitRows: stats.hitRows,
      matchRows: stats.matchRows,
    }))
    .sort((left, right) => right.maxRowEb - left.maxRowEb || left.clusterId.localeCompare(right.clusterId))

export const buildConsensusRows = async ({
  eventsPath,
  contextByKey,
  labelByKey,
  patternTokens,
  clusterByPattern,
  reliabilityByPattern,
}) => {
  const buckets = new Map()
  let inputEventRowCount = 0
  await iterateJsonlMaybeGzip(eventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputEventRowCount += 1
      const patternId = patternIdOf(row)
      const symbol = symbolOf(row)
      const dateKey = dateOf(row)
      if (!patternId) throw new Error(`event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!patternTokens.has(patternId)) throw new Error(`missing pattern tokens for ${patternId}`)
      if (!clusterByPattern.has(patternId)) throw new Error(`missing cluster for ${patternId}`)
      if (!reliabilityByPattern.has(patternId)) throw new Error(`missing reliability for ${patternId}`)
      if (!symbol) throw new Error(`event row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) throw new Error(`event row invalid date at ${context.filePath}:${context.lineNumber}`)
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`event row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const key = keyOf(dateKey, symbol)
      const label = labelByKey.get(key)
      const hitTarget = label ? label.hitTarget : row.hitTarget === true
      const existing = buckets.get(key)
      if (existing && existing.hitTarget !== hitTarget) throw new Error(`conflicting hitTarget for ${dateKey}::${symbol}`)
      const bucket =
        existing ??
        {
          kind: "tp12_context_consensus_feature_full_train_replay_v1",
          decisionDateKey: dateKey,
          symbol,
          hitTarget,
          labelClass: label?.labelClass ?? (hitTarget ? "positive" : "unknown"),
          maxForwardReturn: label?.maxForwardReturn ?? null,
          minForwardReturn: label?.minForwardReturn ?? null,
          rawEventRowCount: 0,
          supportPatternIds: new Set(),
          supportClusterIds: new Set(),
          supportTokenSet: new Set(),
          tokenFamilies: new Set(),
          clusterStats: new Map(),
          sumPatternRowEb: 0,
          sumPatternDateEb: 0,
          maxPatternRowEb: 0,
          maxPatternDateEb: 0,
          maxPatternRowWilsonLB: 0,
          maxPatternDateWilsonLB: 0,
        }
      if (bucket.supportPatternIds.has(patternId)) throw new Error(`duplicate pattern event for ${dateKey}::${symbol}::${patternId}`)
      const rel = reliabilityByPattern.get(patternId)
      const clusterId = clusterByPattern.get(patternId)
      bucket.rawEventRowCount += 1
      bucket.supportPatternIds.add(patternId)
      bucket.supportClusterIds.add(clusterId)
      for (const token of patternTokens.get(patternId)) {
        bucket.supportTokenSet.add(token)
        bucket.tokenFamilies.add(familyOf(token))
      }
      bucket.sumPatternRowEb += rel.rowEbMean
      bucket.sumPatternDateEb += rel.dateEbMean
      bucket.maxPatternRowEb = Math.max(bucket.maxPatternRowEb, rel.rowEbMean)
      bucket.maxPatternDateEb = Math.max(bucket.maxPatternDateEb, rel.dateEbMean)
      bucket.maxPatternRowWilsonLB = Math.max(bucket.maxPatternRowWilsonLB, rel.rowWilsonLB)
      bucket.maxPatternDateWilsonLB = Math.max(bucket.maxPatternDateWilsonLB, rel.dateWilsonLB)
      const clusterStats =
        bucket.clusterStats.get(clusterId) ??
        {
          patternIds: new Set(),
          maxRowEb: 0,
          maxDateEb: 0,
          maxRowWilsonLB: 0,
          maxDateWilsonLB: 0,
          hitRows: 0,
          matchRows: 0,
        }
      clusterStats.patternIds.add(patternId)
      clusterStats.maxRowEb = Math.max(clusterStats.maxRowEb, rel.rowEbMean)
      clusterStats.maxDateEb = Math.max(clusterStats.maxDateEb, rel.dateEbMean)
      clusterStats.maxRowWilsonLB = Math.max(clusterStats.maxRowWilsonLB, rel.rowWilsonLB)
      clusterStats.maxDateWilsonLB = Math.max(clusterStats.maxDateWilsonLB, rel.dateWilsonLB)
      clusterStats.hitRows = Math.max(clusterStats.hitRows, rel.hitRows)
      clusterStats.matchRows = Math.max(clusterStats.matchRows, rel.matchRows)
      bucket.clusterStats.set(clusterId, clusterStats)
      buckets.set(key, bucket)
    },
  })
  const rows = []
  let missingContextRowCount = 0
  for (const bucket of buckets.values()) {
    const supportPatternIds = uniqueSorted([...bucket.supportPatternIds])
    const supportClusterIds = uniqueSorted([...bucket.supportClusterIds])
    const tokenFamilies = uniqueSorted([...bucket.tokenFamilies])
    const supportTokenSet = uniqueSorted([...bucket.supportTokenSet])
    const supportClusterSummaries = sortedClusterSummaries(bucket.clusterStats)
    const supportPatternCount = supportPatternIds.length
    const supportClusterCount = supportClusterIds.length
    const sumClusterRowEb = supportClusterSummaries.reduce((sum, row) => sum + row.maxRowEb, 0)
    const sumClusterDateEb = supportClusterSummaries.reduce((sum, row) => sum + row.maxDateEb, 0)
    const maxClusterRowEb = Math.max(...supportClusterSummaries.map((row) => row.maxRowEb), 0)
    const maxClusterDateEb = Math.max(...supportClusterSummaries.map((row) => row.maxDateEb), 0)
    const maxClusterRowWilsonLB = Math.max(...supportClusterSummaries.map((row) => row.maxRowWilsonLB), 0)
    const maxClusterDateWilsonLB = Math.max(...supportClusterSummaries.map((row) => row.maxDateWilsonLB), 0)
    const supportWeightedClusterRowEb = supportClusterSummaries.reduce(
      (sum, row) => sum + row.maxRowEb * Math.log1p(row.hitRows),
      0,
    )
    const nearDuplicatePatternPenalty = supportPatternCount - supportClusterCount
    const context = contextByKey.get(keyOf(bucket.decisionDateKey, bucket.symbol))
    if (!context) {
      missingContextRowCount += 1
      continue
    }
    const row = {
      kind: bucket.kind,
      __featureRanks: {},
      decisionDateKey: bucket.decisionDateKey,
      symbol: bucket.symbol,
      hitTarget: bucket.hitTarget,
      labelClass: bucket.labelClass,
      maxForwardReturn: bucket.maxForwardReturn,
      minForwardReturn: bucket.minForwardReturn,
      rawEventRowCount: bucket.rawEventRowCount,
      supportPatternIds,
      supportClusterIds,
      supportTokenSet,
      supportClusterSummaries,
      tokenFamilies,
      supportPatternCount,
      supportClusterCount,
      familyDiversity: tokenFamilies.length,
      nearDuplicatePatternPenalty,
      sumPatternRowEb: bucket.sumPatternRowEb,
      meanPatternRowEb: supportPatternCount > 0 ? bucket.sumPatternRowEb / supportPatternCount : 0,
      maxPatternRowEb: bucket.maxPatternRowEb,
      sumPatternDateEb: bucket.sumPatternDateEb,
      meanPatternDateEb: supportPatternCount > 0 ? bucket.sumPatternDateEb / supportPatternCount : 0,
      maxPatternDateEb: bucket.maxPatternDateEb,
      maxPatternRowWilsonLB: bucket.maxPatternRowWilsonLB,
      maxPatternDateWilsonLB: bucket.maxPatternDateWilsonLB,
      sumClusterRowEb,
      meanClusterRowEb: supportClusterCount > 0 ? sumClusterRowEb / supportClusterCount : 0,
      maxClusterRowEb,
      sumClusterDateEb,
      meanClusterDateEb: supportClusterCount > 0 ? sumClusterDateEb / supportClusterCount : 0,
      maxClusterDateEb,
      maxClusterRowWilsonLB,
      maxClusterDateWilsonLB,
      supportWeightedClusterRowEb,
      selectorScore:
        sumClusterRowEb +
        maxClusterRowWilsonLB +
        0.1 * Math.log1p(supportClusterCount) +
        0.05 * tokenFamilies.length -
        0.1 * nearDuplicatePatternPenalty,
    }
    for (const [field, value] of Object.entries(context)) {
      if (["kind", "symbol", "decisionDateKey", "dateKey"].includes(field)) continue
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        throw new Error(`context field collision for ${bucket.decisionDateKey}::${bucket.symbol}: ${field}`)
      }
      row[field] = value
    }
    rows.push(row)
  }
  if (missingContextRowCount > 0) throw new Error(`missing context rows: ${missingContextRowCount}`)
  const byDate = new Map()
  for (const row of rows) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) {
    dateRows.sort((left, right) => right.selectorScore - left.selectorScore || left.symbol.localeCompare(right.symbol))
    const dayUniquePatterns = new Set()
    let dayRawEventRows = 0
    for (const row of dateRows) for (const patternId of row.supportPatternIds) dayUniquePatterns.add(patternId)
    for (const row of dateRows) dayRawEventRows += row.rawEventRowCount
    for (const [index, row] of dateRows.entries()) {
      row.dayRank = index + 1
      row.dayRawEventRows = dayRawEventRows
      row.dayCandidateRows = dayRawEventRows
      row.daySymbolDateCandidateRows = dateRows.length
      row.dayUniqueSymbols = dateRows.length
      row.dayUniquePatterns = dayUniquePatterns.size
      row.dayTopScore = dateRows[0]?.selectorScore ?? 0
      row.daySecondScore = dateRows[1]?.selectorScore ?? null
      row.dayScoreMargin = row.dayRank === 1 ? row.dayTopScore - (row.daySecondScore ?? 0) : 0
    }
    addFeatureRanks(dateRows)
  }
  rows.sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol))
  return { rows, consensusSummary: { inputEventRowCount, symbolDateRowCount: rows.length, decisionDateCount: byDate.size } }
}

const addFeatureRanks = (dateRows) => {
  const fields = new Set()
  for (const row of dateRows) {
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) fields.add(field)
    }
  }
  for (const field of fields) {
    const sorted = dateRows
      .filter((row) => Number.isFinite(row[field]))
      .sort((left, right) => left[field] - right[field] || left.symbol.localeCompare(right.symbol))
    const denom = Math.max(1, sorted.length - 1)
    for (const [index, row] of sorted.entries()) row.__featureRanks[field] = sorted.length > 1 ? index / denom : 1
  }
}

const hydrateRankMaps = (rows) => {
  const byDate = new Map()
  for (const row of rows) {
    row.__featureRanks = {}
    row.supportTokenSet = uniqueSorted(row.supportTokenSet ?? [])
    row.supportPatternIds = uniqueSorted(row.supportPatternIds ?? [])
    row.supportClusterIds = uniqueSorted(row.supportClusterIds ?? [])
    row.tokenFamilies = uniqueSorted(row.tokenFamilies ?? [])
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) addFeatureRanks(dateRows)
}

const rowMatchesBase = (row, rule) => {
  const baseType = toText(rule?.baseType)
  const baseId = toText(rule?.baseId)
  if (baseType === "pattern") return row.supportPatternIds.includes(baseId)
  if (baseType === "cluster") return row.supportClusterIds.includes(baseId)
  if (baseType === "all_year2hit_rows") return true
  throw new Error(`unknown baseType: ${baseType}`)
}

const rowMatchesAtom = (row, atom) => {
  const type = toText(atom?.type)
  if (type === "token_include") {
    const item = toText(atom?.item)
    if (item.startsWith("family:")) return row.tokenFamilies.includes(item.slice("family:".length))
    return row.supportTokenSet.includes(item)
  }
  if (type === "cluster_include") return row.supportClusterIds.includes(toText(atom?.item))
  if (type === "feature_rank") {
    const field = toText(atom?.field)
    const rank = row.__featureRanks?.[field]
    if (!Number.isFinite(rank)) return false
    const threshold = toNumber(atom?.threshold, NaN)
    if (!Number.isFinite(threshold)) throw new Error(`invalid feature_rank threshold for ${field}`)
    const direction = toText(atom?.direction)
    if (direction === "ge") return rank >= threshold
    if (direction === "le") return rank <= threshold
    throw new Error(`unknown feature_rank direction: ${direction}`)
  }
  throw new Error(`unknown atom type: ${type}`)
}

const emptyMetrics = () => ({
  matchRows: 0,
  hitRows: 0,
  falsePositiveRows: 0,
  nearMissRows: 0,
  easyNegativeRows: 0,
  hardNegativeRows: 0,
  unknownNegativeRows: 0,
  hitDatesByYear: new Map(),
  hitDateSet: new Set(),
  matchedDateSet: new Set(),
})

const finalizeMetrics = (metrics, observedYears) => {
  const hitDatesByYear = Object.fromEntries(
    [...metrics.hitDatesByYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, dates]) => [year, dates.size]),
  )
  const minHitDatesPerObservedYear = Math.min(...observedYears.map((year) => hitDatesByYear[year] ?? 0))
  return {
    matchRows: metrics.matchRows,
    hitRows: metrics.hitRows,
    falsePositiveRows: metrics.falsePositiveRows,
    nearMissRows: metrics.nearMissRows,
    easyNegativeRows: metrics.easyNegativeRows,
    hardNegativeRows: metrics.hardNegativeRows,
    unknownNegativeRows: metrics.unknownNegativeRows,
    precision: safeRatio(metrics.hitRows, metrics.matchRows),
    matchedDates: metrics.matchedDateSet.size,
    hitDatesByYear,
    totalHitDates: metrics.hitDateSet.size,
    minHitDatesPerObservedYear,
    year2hitPassed: minHitDatesPerObservedYear >= 2,
  }
}

const addRowToMetrics = (metrics, row) => {
  metrics.matchRows += 1
  metrics.matchedDateSet.add(row.decisionDateKey)
  if (row.hitTarget === true) {
    metrics.hitRows += 1
    metrics.hitDateSet.add(row.decisionDateKey)
    const year = row.decisionDateKey.slice(0, 4)
    const yearDates = metrics.hitDatesByYear.get(year) ?? new Set()
    yearDates.add(row.decisionDateKey)
    metrics.hitDatesByYear.set(year, yearDates)
    return
  }
  metrics.falsePositiveRows += 1
  if (row.labelClass === "near_miss") metrics.nearMissRows += 1
  else if (row.labelClass === "easy_negative") metrics.easyNegativeRows += 1
  else if (row.labelClass === "hard_negative") metrics.hardNegativeRows += 1
  else metrics.unknownNegativeRows += 1
}

const replayRules = ({ rows, rules, dateFrom, dateTo }) => {
  const scopedRows = rows.filter((row) => row.decisionDateKey >= dateFrom && row.decisionDateKey <= dateTo)
  hydrateRankMaps(scopedRows)
  const observedYears = uniqueSorted(scopedRows.map((row) => row.decisionDateKey.slice(0, 4)))
  const outputs = []
  for (const rule of rules) {
    const metrics = emptyMetrics()
    const sampleHitRows = []
    const sampleFalsePositiveRows = []
    for (const row of scopedRows) {
      if (!rowMatchesBase(row, rule)) continue
      let passed = true
      for (const atom of rule.atoms ?? []) {
        if (!rowMatchesAtom(row, atom)) {
          passed = false
          break
        }
      }
      if (!passed) continue
      addRowToMetrics(metrics, row)
      const sample = {
        decisionDateKey: row.decisionDateKey,
        symbol: row.symbol,
        hitTarget: row.hitTarget,
        labelClass: row.labelClass,
        maxForwardReturn: row.maxForwardReturn,
        supportPatternIds: row.supportPatternIds.slice(0, 12),
        supportClusterIds: row.supportClusterIds.slice(0, 12),
      }
      if (row.hitTarget === true && sampleHitRows.length < 12) sampleHitRows.push(sample)
      if (row.hitTarget !== true && sampleFalsePositiveRows.length < 12) sampleFalsePositiveRows.push(sample)
    }
    const finalized = finalizeMetrics(metrics, observedYears)
    outputs.push({
      ...rule,
      replayMetrics: finalized,
      replaySampleHitRows: sampleHitRows,
      replaySampleFalsePositiveRows: sampleFalsePositiveRows,
    })
  }
  return { outputs, observedYears, scopedRowCount: scopedRows.length }
}

const summarizeReplay = ({ outputs, observedYears, scopedRowCount, mode, inputs, reliabilitySummary, consensusSummary }) => {
  const zeroFalsePositiveRules = outputs.filter((row) => row.replayMetrics.falsePositiveRows === 0)
  const zeroFpYear2hitRules = zeroFalsePositiveRules.filter((row) => row.replayMetrics.year2hitPassed)
  const bases = new Map()
  for (const row of zeroFpYear2hitRules) {
    const key = `${row.baseType}\t${row.baseId}`
    const current = bases.get(key)
    if (!current || row.replayMetrics.hitRows > current.replayMetrics.hitRows) bases.set(key, row)
  }
  const topZeroFpRules = zeroFpYear2hitRules
    .slice()
    .sort(
      (left, right) =>
        right.replayMetrics.totalHitDates - left.replayMetrics.totalHitDates ||
        right.replayMetrics.hitRows - left.replayMetrics.hitRows ||
        left.baseType.localeCompare(right.baseType) ||
        left.baseId.localeCompare(right.baseId),
    )
    .slice(0, 30)
    .map((row) => ({
      baseType: row.baseType,
      baseId: row.baseId,
      atomLabels: row.atomLabels,
      replayMetrics: row.replayMetrics,
    }))
  const topZeroFpBases = [...bases.values()]
    .sort(
      (left, right) =>
        right.replayMetrics.totalHitDates - left.replayMetrics.totalHitDates ||
        right.replayMetrics.hitRows - left.replayMetrics.hitRows ||
        left.baseType.localeCompare(right.baseType) ||
        left.baseId.localeCompare(right.baseId),
    )
    .map((row) => ({
      baseType: row.baseType,
      baseId: row.baseId,
      atomLabels: row.atomLabels,
      replayMetrics: row.replayMetrics,
    }))
  return {
    kind: "tp12_zero_fp_rule_replay_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode,
    inputs,
    observedYears,
    scopedRowCount,
    sourceRuleCount: outputs.length,
    sourceZeroFpRuleCount: outputs.filter((row) => row.metrics?.falsePositiveRows === 0).length,
    replayZeroFalsePositiveRuleCount: zeroFalsePositiveRules.length,
    replayZeroFalsePositiveYear2hitRuleCount: zeroFpYear2hitRules.length,
    replayZeroFalsePositiveYear2hitUniqueBaseCount: bases.size,
    replayRuleCountWithFalsePositive: outputs.filter((row) => row.replayMetrics.falsePositiveRows > 0).length,
    reliabilitySummary,
    consensusSummary,
    topZeroFpRules,
    topZeroFpBases,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const rulesPath = requirePath(getFlag(flags, "rules", ""), "rules", cwd)
  const outDir = path.resolve(cwd, toText(getFlag(flags, "out-dir", "")))
  if (!toText(outDir)) throw new Error("--out-dir is required")
  const dateFrom = toText(getFlag(flags, "date-from", "2016-01-04"))
  const dateTo = toText(getFlag(flags, "date-to", "2024-12-30"))
  if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) {
    throw new Error(`invalid date range: ${dateFrom}..${dateTo}`)
  }
  const mode = toText(getFlag(flags, "mode", "full_train_in_sample_replay"))
  const rules = await readJsonlRows(rulesPath)
  if (rules.length < 1) throw new Error(`rules source produced zero rows: ${rulesPath}`)
  const inputs = { rulesPath, dateFrom, dateTo }
  let rows = []
  let reliabilitySummary = null
  let consensusSummary = null
  const enrichedPath = toText(getFlag(flags, "enriched", ""))
  const catalogPath = requirePath(getFlag(flags, "catalog", ""), "catalog", cwd)
  const patternTokens = await loadPatternTokens(catalogPath)
  if (enrichedPath) {
    const resolvedEnrichedPath = requirePath(enrichedPath, "enriched", cwd)
    rows = await readJsonlRows(resolvedEnrichedPath)
    for (const row of rows) {
      const tokens = new Set(row.supportTokenSet ?? [])
      for (const patternId of row.supportPatternIds ?? []) {
        const patternTokenSet = patternTokens.get(patternId)
        if (!patternTokenSet) throw new Error(`missing pattern tokens for enriched support pattern: ${patternId}`)
        for (const token of patternTokenSet) tokens.add(token)
      }
      row.supportTokenSet = uniqueSorted([...tokens])
    }
    inputs.enrichedPath = resolvedEnrichedPath
    consensusSummary = { symbolDateRowCount: rows.length, source: "prebuilt_enriched" }
  } else {
    const eventsPath = requirePath(getFlag(flags, "events", ""), "events", cwd)
    const contextPath = requirePath(getFlag(flags, "context", ""), "context", cwd)
    const clustersPath = requirePath(getFlag(flags, "clusters", ""), "clusters", cwd)
    const labelsPath = requirePath(getFlag(flags, "labels", ""), "labels", cwd)
    const priorStrengthRow = toNumber(getFlag(flags, "prior-strength-row", 100), 100)
    const priorStrengthDate = toNumber(getFlag(flags, "prior-strength-date", 50), 50)
    const contextByKey = await loadContextBySymbolDate(contextPath)
    const labelByKey = await loadLabelBySymbolDate(labelsPath)
    const clusterByPattern = await loadClusterByPattern(clustersPath)
    const reliability = await buildPatternReliability({ eventsPath, priorStrengthRow, priorStrengthDate })
    reliabilitySummary = reliability.reliabilitySummary
    const consensus = await buildConsensusRows({
      eventsPath,
      contextByKey,
      labelByKey,
      patternTokens,
      clusterByPattern,
      reliabilityByPattern: reliability.reliabilityByPattern,
    })
    rows = consensus.rows
    consensusSummary = consensus.consensusSummary
    Object.assign(inputs, { eventsPath, contextPath, clustersPath, labelsPath, catalogPath, priorStrengthRow, priorStrengthDate })
  }
  const { outputs, observedYears, scopedRowCount } = replayRules({ rows, rules, dateFrom, dateTo })
  const summary = summarizeReplay({ outputs, observedYears, scopedRowCount, mode, inputs, reliabilitySummary, consensusSummary })
  await ensureDir(outDir)
  const summaryPath = path.join(outDir, "full_train_replay_summary.json")
  const replayPath = path.join(outDir, "full_train_rule_replay.jsonl")
  const zeroFpPath = path.join(outDir, "full_train_zero_false_positive_rules.jsonl")
  const brokenPath = path.join(outDir, "full_train_broken_zero_fp_rules.jsonl")
  const topBasesPath = path.join(outDir, "full_train_zero_fp_unique_bases.jsonl")
  const outConsensusPath = toText(getFlag(flags, "out-enriched-consensus", ""))
  await writeJson(summaryPath, summary)
  const replayStream = fs.createWriteStream(replayPath, { encoding: "utf8" })
  const zeroStream = fs.createWriteStream(zeroFpPath, { encoding: "utf8" })
  const brokenStream = fs.createWriteStream(brokenPath, { encoding: "utf8" })
  const basesStream = fs.createWriteStream(topBasesPath, { encoding: "utf8" })
  try {
    for (const row of outputs) {
      await writeJsonlRow(replayStream, row)
      if (row.replayMetrics.falsePositiveRows === 0) await writeJsonlRow(zeroStream, row)
      else await writeJsonlRow(brokenStream, row)
    }
    for (const row of summary.topZeroFpBases) await writeJsonlRow(basesStream, row)
  } finally {
    await closeWriteStream(replayStream)
    await closeWriteStream(zeroStream)
    await closeWriteStream(brokenStream)
    await closeWriteStream(basesStream)
  }
  if (outConsensusPath) {
    const resolvedOutConsensusPath = path.resolve(cwd, outConsensusPath)
    await ensureDir(path.dirname(resolvedOutConsensusPath))
    const consensusStream = fs.createWriteStream(resolvedOutConsensusPath, { encoding: "utf8" })
    try {
      for (const row of rows) await writeJsonlRow(consensusStream, row)
    } finally {
      await closeWriteStream(consensusStream)
    }
  }
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        mode,
        sourceRuleCount: summary.sourceRuleCount,
        scopedRowCount: summary.scopedRowCount,
        replayZeroFalsePositiveYear2hitRuleCount: summary.replayZeroFalsePositiveYear2hitRuleCount,
        replayZeroFalsePositiveYear2hitUniqueBaseCount: summary.replayZeroFalsePositiveYear2hitUniqueBaseCount,
        summaryPath,
        outConsensusPath: outConsensusPath ? path.resolve(cwd, outConsensusPath) : null,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
