import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertAsOfSafeFeature,
  assertNeutralAtomNaming,
  assertNoForbiddenExpressionFields,
  assertNoOosPath,
  assertThresholdInContractGrid,
  CORE_YEARS,
  loadTp12Train100NeutralContract,
  outputPathFromContract,
  resolvePath,
  targetFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

export const rowKey = (row) => `${toText(row.symbol)}::${toText(row.decisionDateKey)}`

const nestedValue = (row, pathParts) => {
  let node = row
  for (const part of pathParts) {
    if (!node || typeof node !== "object") return undefined
    node = node[part]
  }
  return node
}

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = toNumber(value, NaN)
    if (Number.isFinite(parsed)) return parsed
  }
  return NaN
}

const getFeatureValue = (row, featureName) => {
  const direct = row?.[featureName]
  const nested = firstNumber(
    direct,
    nestedValue(row, ["features", featureName]),
    nestedValue(row, ["contextFeatures", featureName]),
    nestedValue(row, ["metrics", featureName]),
    nestedValue(row, ["featureValues", featureName]),
  )
  if (Number.isFinite(nested)) return nested

  const open = firstNumber(row.open, row.openPrice, nestedValue(row, ["ohlcv", "open"]))
  const high = firstNumber(row.high, row.highPrice, nestedValue(row, ["ohlcv", "high"]))
  const low = firstNumber(row.low, row.lowPrice, nestedValue(row, ["ohlcv", "low"]))
  const close = firstNumber(row.close, row.closePrice, nestedValue(row, ["ohlcv", "close"]))
  const volume = firstNumber(row.volume, nestedValue(row, ["ohlcv", "volume"]))
  const prevClose = firstNumber(row.prevClose, row.previousClose, nestedValue(row, ["ohlcv", "prevClose"]))
  const ma5 = firstNumber(row.ma5, row.closeMa5, nestedValue(row, ["features", "ma5"]))
  const ma20 = firstNumber(row.ma20, row.closeMa20, nestedValue(row, ["features", "ma20"]))
  const high20 = firstNumber(row.high20, row.priorHigh20, nestedValue(row, ["features", "high20"]))
  const low20 = firstNumber(row.low20, row.priorLow20, nestedValue(row, ["features", "low20"]))
  const avgVol20 = firstNumber(row.avgVolume20d, row.volumeAvg20, nestedValue(row, ["features", "avgVolume20d"]))
  const avgTradedValue20 = firstNumber(row.avgTradingValue20d, row.tradedValueAvg20, nestedValue(row, ["features", "avgTradingValue20d"]))
  const avgTradedValue60 = firstNumber(row.avgTradingValue60d, row.tradedValueAvg60, nestedValue(row, ["features", "avgTradingValue60d"]))
  const tradedValue = firstNumber(row.tradedValue, Number.isFinite(close) && Number.isFinite(volume) ? close * volume : NaN)
  const range = Number.isFinite(high) && Number.isFinite(low) ? Math.max(0, high - low) : NaN
  const body = Number.isFinite(open) && Number.isFinite(close) ? Math.abs(close - open) : NaN
  const denomClose = Number.isFinite(close) && close !== 0 ? close : NaN
  const denomPrev = Number.isFinite(prevClose) && prevClose !== 0 ? prevClose : NaN
  const denomRange = Number.isFinite(range) && range !== 0 ? range : NaN

  if (featureName === "gapPrevClose") return Number.isFinite(open) && Number.isFinite(denomPrev) ? open / denomPrev - 1 : NaN
  if (featureName === "rangePct") return Number.isFinite(range) && Number.isFinite(denomClose) ? range / denomClose : NaN
  if (featureName === "bodyPct") return Number.isFinite(body) && Number.isFinite(denomClose) ? body / denomClose : NaN
  if (featureName === "bodyToRange") return Number.isFinite(body) && Number.isFinite(denomRange) ? body / denomRange : NaN
  if (featureName === "upperWickRatio") {
    const upper = Number.isFinite(high) && Number.isFinite(open) && Number.isFinite(close) ? high - Math.max(open, close) : NaN
    return Number.isFinite(upper) && Number.isFinite(denomRange) ? upper / denomRange : NaN
  }
  if (featureName === "lowerWickRatio") {
    const lower = Number.isFinite(low) && Number.isFinite(open) && Number.isFinite(close) ? Math.min(open, close) - low : NaN
    return Number.isFinite(lower) && Number.isFinite(denomRange) ? lower / denomRange : NaN
  }
  if (featureName === "closeLocation") return Number.isFinite(close) && Number.isFinite(low) && Number.isFinite(denomRange) ? (close - low) / denomRange : NaN
  if (featureName === "openLocation") return Number.isFinite(open) && Number.isFinite(low) && Number.isFinite(denomRange) ? (open - low) / denomRange : NaN
  if (featureName === "ma5Distance") return Number.isFinite(close) && Number.isFinite(ma5) && ma5 !== 0 ? close / ma5 - 1 : NaN
  if (featureName === "ma20Distance") return Number.isFinite(close) && Number.isFinite(ma20) && ma20 !== 0 ? close / ma20 - 1 : NaN
  if (featureName === "ma5Ma20Alignment") return Number.isFinite(ma5) && Number.isFinite(ma20) && ma20 !== 0 ? ma5 / ma20 - 1 : NaN
  if (featureName === "breakout20Strength") return Number.isFinite(close) && Number.isFinite(high20) && high20 !== 0 ? close / high20 - 1 : NaN
  if (featureName === "closeToHigh20") return Number.isFinite(close) && Number.isFinite(high20) && high20 !== 0 ? close / high20 - 1 : NaN
  if (featureName === "closeFromLow20") return Number.isFinite(close) && Number.isFinite(low20) && low20 !== 0 ? close / low20 - 1 : NaN
  if (featureName === "tradedValue") return tradedValue
  if (featureName === "volumeRel20") return Number.isFinite(volume) && Number.isFinite(avgVol20) && avgVol20 !== 0 ? volume / avgVol20 : NaN
  if (featureName === "volumeDryupRel20") return Number.isFinite(volume) && Number.isFinite(avgVol20) && avgVol20 !== 0 ? volume / avgVol20 : NaN
  if (featureName === "avgTradingValue20d") return avgTradedValue20
  if (featureName === "tradedValueRel20") return Number.isFinite(tradedValue) && Number.isFinite(avgTradedValue20) && avgTradedValue20 !== 0 ? tradedValue / avgTradedValue20 : NaN
  if (featureName === "tradedValueRel60") return Number.isFinite(tradedValue) && Number.isFinite(avgTradedValue60) && avgTradedValue60 !== 0 ? tradedValue / avgTradedValue60 : NaN
  if (featureName === "supportLog") {
    const support = firstNumber(row.supportClusterCount, row.supportPatternCount)
    return Number.isFinite(support) ? Math.log1p(Math.max(0, support)) : NaN
  }
  if (featureName === "supportOvercrowdRatio") {
    const support = firstNumber(row.supportClusterCount, row.supportPatternCount)
    const dayPatterns = firstNumber(row.dayUniquePatterns, row.uniquePatternsForDate)
    return Number.isFinite(support) && Number.isFinite(dayPatterns) && dayPatterns !== 0 ? support / dayPatterns : NaN
  }
  if (featureName === "supportQualityRatio") {
    const sum = firstNumber(row.sumClusterRowEb, row.sumRowEb, row.selectorScore)
    const support = firstNumber(row.supportClusterCount, row.supportPatternCount)
    return Number.isFinite(sum) && Number.isFinite(support) ? sum / Math.log1p(Math.max(0, support)) : NaN
  }
  return NaN
}

const quantile = (sorted, p) => {
  if (sorted.length < 1) return NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

const buildValueStats = (rows, catalogRows) => {
  const featureNames = [...new Set(catalogRows.map((row) => row.featureName))]
  const rawValues = new Map()
  for (const featureName of featureNames) rawValues.set(featureName, [])
  for (const row of rows) {
    for (const featureName of featureNames) {
      const value = getFeatureValue(row, featureName)
      if (Number.isFinite(value)) rawValues.get(featureName).push(value)
    }
  }
  const stats = new Map()
  for (const [featureName, values] of rawValues.entries()) {
    values.sort((a, b) => a - b)
    const n = values.length
    const mean = n > 0 ? values.reduce((sum, value) => sum + value, 0) / n : NaN
    const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0
    stats.set(featureName, {
      n,
      mean,
      std: Math.sqrt(Math.max(0, variance)),
      p10: quantile(values, 0.1),
      p20: quantile(values, 0.2),
      p30: quantile(values, 0.3),
      p50: quantile(values, 0.5),
      p70: quantile(values, 0.7),
      p80: quantile(values, 0.8),
      p90: quantile(values, 0.9),
      values,
    })
  }
  return stats
}

const percentileValue = (stats, p) => stats?.[`p${Math.trunc(Number(p) * 100)}`]

const rankBucketPasses = (value, bucket) => {
  if (!Number.isFinite(value)) return false
  if (bucket === "top10") return value >= 0.9
  if (bucket === "top20") return value >= 0.8
  if (bucket === "top30") return value >= 0.7
  if (bucket === "bottom20") return value <= 0.2
  if (bucket === "bottom30") return value <= 0.3
  if (bucket === "mid20_80") return value >= 0.2 && value <= 0.8
  return false
}

const atomPasses = (row, atom, stats) => {
  const value = getFeatureValue(row, atom.featureName)
  if (!Number.isFinite(value)) return false
  const spec = atom.thresholdSpec ?? {}
  const type = toText(spec.type)
  const threshold = spec.value
  if (type === "rankBucket") return rankBucketPasses(value, threshold)
  let compareValue = Number(threshold)
  if (type === "percentile") {
    compareValue = percentileValue(stats, Number(threshold))
  } else if (type === "zScore") {
    compareValue = Number.isFinite(stats?.mean) && Number.isFinite(stats?.std) ? stats.mean + Number(threshold) * stats.std : NaN
  }
  if (!Number.isFinite(compareValue)) return false
  if (atom.operator === ">=") return value >= compareValue
  if (atom.operator === "<=") return value <= compareValue
  if (atom.operator === "between") {
    if (type === "rankBucket" && threshold === "mid20_80") return rankBucketPasses(value, threshold)
    const low = percentileValue(stats, 0.2)
    const high = percentileValue(stats, 0.8)
    return Number.isFinite(low) && Number.isFinite(high) && value >= low && value <= high
  }
  return false
}

const normalizeEventRow = (row, rowId) => {
  const decisionDateKey = toText(row.decisionDateKey ?? row.dateKey ?? row.decisionDate)
  if (!validDateKey(decisionDateKey)) throw new Error(`event row missing valid decisionDateKey at rowId=${rowId}`)
  const symbol = toText(row.symbol ?? row.ticker ?? row.code)
  if (!symbol) throw new Error(`event row missing symbol at rowId=${rowId}`)
  const sourceDateKey = toText(row.sourceDateKey ?? row.featureSourceDateKey ?? decisionDateKey)
  assertAsOfSafeFeature({ sourceDateKey, decisionDateKey })
  return {
    ...row,
    rowId,
    symbol,
    decisionDateKey,
    sourceDateKey,
    year: Number(decisionDateKey.slice(0, 4)),
    monthKey: decisionDateKey.slice(0, 7),
    hitTarget: toBool(row.hitTarget ?? row.isHit ?? row.hit, false),
  }
}

export const loadTp12Train100NeutralEventRows = async (eventPath, contract) => {
  const rows = []
  await iterateJsonlMaybeGzip(eventPath, {
    strict: true,
    onRow: async (row) => {
      assertNoForbiddenExpressionFields(row?.expression ?? {}, contract, "eventRow.expression")
      const normalized = normalizeEventRow(row, rows.length)
      rows.push(normalized)
    },
  })
  return rows
}

const loadCatalogRows = async (catalogPath, contract) => {
  const rows = []
  await iterateJsonlMaybeGzip(catalogPath, {
    strict: true,
    onRow: async (row) => {
      assertNeutralAtomNaming(row)
      assertThresholdInContractGrid(row, contract)
      assertNoForbiddenExpressionFields(row, contract, "featureCatalogRow")
      rows.push(row)
    },
  })
  return rows
}

const supportStats = (rowIds, rows) => {
  const yearHitDecisionDates = new Map()
  const yearHitSymbolDates = new Map()
  const activeMonths = new Set()
  const symbolCounts = new Map()
  const monthCounts = new Map()
  let hitRows = 0
  let falsePositiveRows = 0
  for (const rowId of rowIds) {
    const row = rows[rowId]
    activeMonths.add(row.monthKey)
    symbolCounts.set(row.symbol, (symbolCounts.get(row.symbol) ?? 0) + 1)
    monthCounts.set(row.monthKey, (monthCounts.get(row.monthKey) ?? 0) + 1)
    if (row.hitTarget) {
      hitRows += 1
      const year = String(row.year)
      if (!yearHitDecisionDates.has(year)) yearHitDecisionDates.set(year, new Set())
      if (!yearHitSymbolDates.has(year)) yearHitSymbolDates.set(year, new Set())
      yearHitDecisionDates.get(year).add(row.decisionDateKey)
      yearHitSymbolDates.get(year).add(rowKey(row))
    } else {
      falsePositiveRows += 1
    }
  }
  const yearDecisionObject = {}
  const yearSymbolObject = {}
  for (const year of CORE_YEARS) {
    yearDecisionObject[String(year)] = yearHitDecisionDates.get(String(year))?.size ?? 0
    yearSymbolObject[String(year)] = yearHitSymbolDates.get(String(year))?.size ?? 0
  }
  const maxShare = (map) => {
    const total = [...map.values()].reduce((sum, value) => sum + value, 0)
    if (total <= 0) return 0
    return Math.max(...map.values()) / total
  }
  return {
    matchedRowCount: rowIds.length,
    hitRowCount: hitRows,
    falsePositiveRowCount: falsePositiveRows,
    trainPrecision: rowIds.length > 0 ? hitRows / rowIds.length : 0,
    positiveSymbolDates: hitRows,
    yearHitDecisionDates: yearDecisionObject,
    yearHitSymbolDates: yearSymbolObject,
    activeMonths: activeMonths.size,
    topSymbolShare: maxShare(symbolCounts),
    topMonthShare: maxShare(monthCounts),
  }
}

export const readNeutralAtomCatalog = async (atomCatalogPath, { includeRows = true } = {}) => {
  const rows = []
  await iterateJsonlMaybeGzip(atomCatalogPath, {
    strict: true,
    onRow: async (row) => {
      rows.push({
        ...row,
        matchedRowIds: includeRows && Array.isArray(row.matchedRowIds) ? row.matchedRowIds.map((value) => Math.trunc(toNumber(value, -1))).filter((value) => value >= 0) : [],
      })
    },
  })
  return rows
}

export const buildTp12Train100NeutralAtomBitsets = async ({
  contractPath,
  eventsPath,
  featureCatalogPath,
  outAtomsPath = "",
  outManifestPath = "",
  outSupportSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const resolvedEventsPath = resolvePath(cwd, eventsPath, "eventsPath")
  const resolvedFeatureCatalogPath = resolvePath(cwd, featureCatalogPath, "featureCatalogPath")
  const outputAtomsPath = outputPathFromContract(cwd, contract, "neutralAtomCatalog", outAtomsPath)
  const outputManifestPath = outputPathFromContract(cwd, contract, "neutralAtomBitsetManifest", outManifestPath)
  const outputSupportSummaryPath = outputPathFromContract(cwd, contract, "neutralAtomSupportSummary", outSupportSummaryPath)
  assertNoOosPath(resolvedEventsPath, "eventsPath")
  assertNoOosPath(resolvedFeatureCatalogPath, "featureCatalogPath")

  const rows = await loadTp12Train100NeutralEventRows(resolvedEventsPath, contract)
  const catalogRows = await loadCatalogRows(resolvedFeatureCatalogPath, contract)
  const valueStats = buildValueStats(rows, catalogRows)
  const target = targetFromContract(contract)

  await ensureDir(path.dirname(outputAtomsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputAtomsPath)
  const featureSpaceCounts = {}
  const retainedFeatureSpaceCounts = {}
  const atomSummaries = []
  let emittedAtomCount = 0
  let zeroSupportAtomCount = 0
  try {
    for (const atom of catalogRows) {
      const stats = valueStats.get(atom.featureName)
      const matchedRowIds = []
      for (const row of rows) {
        if (atomPasses(row, atom, stats)) matchedRowIds.push(row.rowId)
      }
      featureSpaceCounts[atom.featureSpaceId] = (featureSpaceCounts[atom.featureSpaceId] ?? 0) + 1
      const support = supportStats(matchedRowIds, rows)
      const hitRowIds = matchedRowIds.filter((rowId) => rows[rowId]?.hitTarget === true)
      const falsePositiveRowIds = matchedRowIds.filter((rowId) => rows[rowId]?.hitTarget !== true)
      if (matchedRowIds.length < 1) {
        zeroSupportAtomCount += 1
        continue
      }
      retainedFeatureSpaceCounts[atom.featureSpaceId] = (retainedFeatureSpaceCounts[atom.featureSpaceId] ?? 0) + 1
      emittedAtomCount += 1
      const atomRow = {
        kind: "tp12_train100_neutral_atom_v1",
        ...atom,
        sourceEventPathSha256: sha256(resolvedEventsPath),
        sourceEventRowsPath: resolvedEventsPath,
        matchedRowIds,
        hitRowIds,
        falsePositiveRowIds,
        ...support,
        targetEligibleAsSingleAtom: CORE_YEARS.every((year) =>
          support.yearHitDecisionDates[String(year)] >= target.minHitDecisionDatesPerYear &&
          support.yearHitSymbolDates[String(year)] >= target.minHitSymbolDatesPerYear,
        ) && support.positiveSymbolDates >= target.minTotalPositiveSymbolDates,
        asOfViolationCount: 0,
        forbiddenFieldViolationCount: 0,
      }
      atomSummaries.push({
        atomId: atomRow.atomId,
        featureSpaceId: atomRow.featureSpaceId,
        featureName: atomRow.featureName,
        family: atomRow.family,
        matchedRowCount: atomRow.matchedRowCount,
        hitRowCount: atomRow.hitRowCount,
        falsePositiveRowCount: atomRow.falsePositiveRowCount,
        trainPrecision: atomRow.trainPrecision,
        positiveSymbolDates: atomRow.positiveSymbolDates,
      })
      await writeJsonlRow(writer.stream, atomRow)
    }
  } finally {
    await writer.close()
  }

  const manifest = {
    kind: "tp12_train100_neutral_atom_bitset_manifest_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    eventsPath: resolvedEventsPath,
    featureCatalogPath: resolvedFeatureCatalogPath,
    outAtomsPath: outputAtomsPath,
    trainRowCount: rows.length,
    inputAtomSpecCount: catalogRows.length,
    emittedAtomCount,
    zeroSupportAtomCount,
    featureSpaceCounts,
    retainedFeatureSpaceCounts,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputManifestPath, manifest)
  await writeJson(outputSupportSummaryPath, {
    kind: "tp12_train100_neutral_atom_support_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    atomCount: atomSummaries.length,
    topAtomsByPrecision: [...atomSummaries].sort((a, b) => b.trainPrecision - a.trainPrecision || b.hitRowCount - a.hitRowCount).slice(0, 50),
    topAtomsByHitRows: [...atomSummaries].sort((a, b) => b.hitRowCount - a.hitRowCount || b.trainPrecision - a.trainPrecision).slice(0, 50),
    oosRead: false,
  })
  return manifest
}

export const evaluateExpressionSupport = ({ atomById, anchorAtoms = [], vetoClauses = [] }) => {
  if (!Array.isArray(anchorAtoms) || anchorAtoms.length < 1) throw new Error("anchorAtoms must be non-empty")
  const intersect = (left, right) => {
    const rightSet = right instanceof Set ? right : new Set(right)
    return [...left].filter((value) => rightSet.has(value))
  }
  let support = [...(atomById.get(anchorAtoms[0])?.matchedRowIds ?? [])]
  for (const atomId of anchorAtoms.slice(1)) support = intersect(support, atomById.get(atomId)?.matchedRowIds ?? [])
  const vetoed = new Set()
  for (const clause of vetoClauses) {
    const clauseAtoms = Array.isArray(clause?.atoms) ? clause.atoms : Array.isArray(clause) ? clause : []
    if (clauseAtoms.length < 1) continue
    let clauseSupport = [...(atomById.get(clauseAtoms[0])?.matchedRowIds ?? [])]
    for (const atomId of clauseAtoms.slice(1)) clauseSupport = intersect(clauseSupport, atomById.get(atomId)?.matchedRowIds ?? [])
    for (const rowId of clauseSupport) vetoed.add(rowId)
  }
  return support.filter((rowId) => !vetoed.has(rowId)).sort((a, b) => a - b)
}

export { supportStats as summarizeSupportRows }
