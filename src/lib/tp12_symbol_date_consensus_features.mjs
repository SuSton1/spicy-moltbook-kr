import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const resolvePatternId = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const familyOf = (token) => toText(token).split(":")[0] || "unknown"
const bucketKey = (dateKey, symbol) => `${dateKey}\t${symbol}`

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

const readRowsAny = async (filePath, arrayKeys = ["rows"]) => {
  const sourcePath = toText(filePath)
  if (!sourcePath) throw new Error("row source path is required")
  if (!fs.existsSync(sourcePath)) throw new Error(`row source not found: ${sourcePath}`)
  const rows = []
  if (sourcePath.endsWith(".jsonl") || sourcePath.endsWith(".jsonl.gz")) {
    await iterateJsonlMaybeGzip(sourcePath, {
      strict: true,
      onRow: async (row) => rows.push(row),
    })
    return rows
  }
  const payload = await readJson(sourcePath, null)
  if (Array.isArray(payload)) return payload
  for (const key of arrayKeys) {
    if (Array.isArray(payload?.[key])) return payload[key]
  }
  throw new Error(`JSON row source contains none of expected arrays: ${sourcePath}`)
}

const loadReliability = async (reliabilityPath, { foldId = "" } = {}) => {
  const rows = await readRowsAny(reliabilityPath, ["rows", "patterns", "reliabilityRows"])
  const byPattern = new Map()
  const requestedFoldId = toText(foldId)
  for (const row of rows) {
    const rowFoldId = toText(row?.foldId)
    if (requestedFoldId && rowFoldId !== requestedFoldId) continue
    const patternId = resolvePatternId(row)
    if (!patternId) throw new Error(`reliability row missing patternId`)
    if (byPattern.has(patternId)) {
      throw new Error(
        requestedFoldId
          ? `duplicate reliability patternId in fold ${requestedFoldId}: ${patternId}`
          : `duplicate reliability patternId; pass foldId for fold-specific reliability: ${patternId}`,
      )
    }
    byPattern.set(patternId, {
      patternId,
      rowEbMean: toNumber(row.rowEbMean ?? row.rowPrecision ?? row.hitRate, NaN),
      dateEbMean: toNumber(row.dateEbMean ?? row.datePrecision ?? row.dateHitRate, NaN),
      rowWilsonLB: toNumber(row.rowWilsonLB ?? row.rowWilsonLower95 ?? row.wilsonLower95, 0),
      dateWilsonLB: toNumber(row.dateWilsonLB ?? row.dateWilsonLower95, 0),
      hitRows: Math.max(0, Math.trunc(toNumber(row.hitRows, 0))),
      matchRows: Math.max(0, Math.trunc(toNumber(row.matchRows ?? row.selectedRows, 0))),
    })
  }
  if (requestedFoldId && byPattern.size < 1) throw new Error(`no reliability rows for foldId: ${requestedFoldId}`)
  for (const [patternId, row] of byPattern.entries()) {
    if (!Number.isFinite(row.rowEbMean)) throw new Error(`reliability row missing rowEbMean/rowPrecision: ${patternId}`)
    if (!Number.isFinite(row.dateEbMean)) row.dateEbMean = row.rowEbMean
  }
  return byPattern
}

const loadClusters = async (clustersPath) => {
  const rows = await readRowsAny(clustersPath, ["clusters", "rows"])
  const byPattern = new Map()
  for (const row of rows) {
    const clusterId = toText(row?.clusterId)
    if (!clusterId) throw new Error("cluster row missing clusterId")
    const patternIds = uniqueSorted(row?.patternIds ?? [])
    if (patternIds.length < 1) throw new Error(`cluster row has no patternIds: ${clusterId}`)
    for (const patternId of patternIds) {
      if (byPattern.has(patternId)) throw new Error(`pattern appears in multiple clusters: ${patternId}`)
      byPattern.set(patternId, clusterId)
    }
  }
  return byPattern
}

const loadFoldValidationDateSet = async ({ splitPlanPath = "", foldId = "" } = {}) => {
  const requestedFoldId = toText(foldId)
  if (!requestedFoldId) return null
  const sourcePath = toText(splitPlanPath)
  if (!sourcePath) throw new Error("splitPlanPath is required when foldId is provided")
  const splitPlan = await readJson(sourcePath, null)
  if (!splitPlan) throw new Error(`split plan not found: ${sourcePath}`)
  const outerFolds = Array.isArray(splitPlan.outerFolds) ? splitPlan.outerFolds : []
  const fold = outerFolds.find((row) => toText(row?.foldId) === requestedFoldId)
  if (!fold) throw new Error(`foldId not found in split plan: ${requestedFoldId}`)
  if (!Array.isArray(fold.validationDates) || fold.validationDates.length < 1) {
    throw new Error(`fold has no validationDates: ${requestedFoldId}`)
  }
  return new Set(fold.validationDates)
}

export const buildTp12SymbolDateConsensusFeatures = async ({
  eventsPath,
  patternReliabilityPath,
  clustersPath,
  outPath,
  summaryPath,
  foldId = "",
  splitPlanPath = "",
} = {}) => {
  if (!toText(eventsPath)) throw new Error("eventsPath is required")
  if (!fs.existsSync(eventsPath)) throw new Error(`events path not found: ${eventsPath}`)
  if (!toText(patternReliabilityPath)) throw new Error("patternReliabilityPath is required")
  if (!toText(clustersPath)) throw new Error("clustersPath is required")
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(summaryPath)) throw new Error("summaryPath is required")
  const reliabilityByPattern = await loadReliability(patternReliabilityPath, { foldId })
  const clusterByPattern = await loadClusters(clustersPath)
  const validationDateSet = await loadFoldValidationDateSet({ splitPlanPath, foldId })
  const buckets = new Map()
  let inputRowCount = 0
  let skippedOutsideFoldValidationRowCount = 0
  await iterateJsonlMaybeGzip(eventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const patternId = resolvePatternId(row)
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = toText(row?.decisionDateKey)
      if (!patternId) throw new Error(`event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!reliabilityByPattern.has(patternId)) throw new Error(`missing pattern reliability for ${patternId}`)
      if (!clusterByPattern.has(patternId)) throw new Error(`missing pattern cluster for ${patternId}`)
      if (!symbol) throw new Error(`event row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`event row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`event row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      if (validationDateSet && !validationDateSet.has(decisionDateKey)) {
        skippedOutsideFoldValidationRowCount += 1
        return
      }
      const key = bucketKey(decisionDateKey, symbol)
      const existing = buckets.get(key)
      if (existing && existing.hitTarget !== (row.hitTarget === true)) {
        throw new Error(`conflicting hitTarget for symbol/date: ${decisionDateKey}::${symbol}`)
      }
      const bucket =
        existing ?? {
          kind: "tp12_symbol_date_consensus_feature_v1",
          decisionDateKey,
          symbol,
          hitTarget: row.hitTarget === true,
          rawEventRowCount: 0,
          supportPatternIds: new Set(),
          supportClusterIds: new Set(),
          tokenFamilies: new Set(),
          clusterStats: new Map(),
          sumPatternRowEb: 0,
          sumPatternDateEb: 0,
          maxPatternRowEb: 0,
          maxPatternDateEb: 0,
          maxPatternRowWilsonLB: 0,
          maxPatternDateWilsonLB: 0,
        }
      const rel = reliabilityByPattern.get(patternId)
      if (bucket.supportPatternIds.has(patternId)) {
        throw new Error(`duplicate pattern event for symbol/date: ${decisionDateKey}::${symbol}::${patternId}`)
      }
      const clusterId = clusterByPattern.get(patternId)
      bucket.rawEventRowCount += 1
      bucket.supportPatternIds.add(patternId)
      bucket.supportClusterIds.add(clusterId)
      for (const token of uniqueSorted(row?.tokenSet ?? row?.tokens ?? [])) bucket.tokenFamilies.add(familyOf(token))
      bucket.sumPatternRowEb += rel.rowEbMean
      bucket.sumPatternDateEb += rel.dateEbMean
      bucket.maxPatternRowEb = Math.max(bucket.maxPatternRowEb, rel.rowEbMean)
      bucket.maxPatternDateEb = Math.max(bucket.maxPatternDateEb, rel.dateEbMean)
      bucket.maxPatternRowWilsonLB = Math.max(bucket.maxPatternRowWilsonLB, rel.rowWilsonLB)
      bucket.maxPatternDateWilsonLB = Math.max(bucket.maxPatternDateWilsonLB, rel.dateWilsonLB)
      const clusterStats =
        bucket.clusterStats.get(clusterId) ?? {
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
  const rows = [...buckets.values()].map((bucket) => {
    const supportPatternIds = uniqueSorted([...bucket.supportPatternIds])
    const supportClusterIds = uniqueSorted([...bucket.supportClusterIds])
    const tokenFamilies = uniqueSorted([...bucket.tokenFamilies])
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
    return {
      kind: bucket.kind,
      decisionDateKey: bucket.decisionDateKey,
      symbol: bucket.symbol,
      hitTarget: bucket.hitTarget,
      rawEventRowCount: bucket.rawEventRowCount,
      supportPatternIds,
      supportClusterIds,
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
  })
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
  }
  rows.sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol))
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await closeWriteStream(stream)
  }
  const summary = {
    kind: "tp12_symbol_date_consensus_feature_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    eventsPath: path.resolve(eventsPath),
    patternReliabilityPath: path.resolve(patternReliabilityPath),
    clustersPath: path.resolve(clustersPath),
    foldId: toText(foldId) || null,
    splitPlanPath: toText(splitPlanPath) ? path.resolve(splitPlanPath) : null,
    outPath: path.resolve(outPath),
    inputEventRowCount: inputRowCount,
    skippedOutsideFoldValidationRowCount,
    symbolDateRowCount: rows.length,
    decisionDateCount: byDate.size,
    hitRows: rows.filter((row) => row.hitTarget === true).length,
    maxSupportPatternCount: Math.max(...rows.map((row) => row.supportPatternCount), 0),
    maxSupportClusterCount: Math.max(...rows.map((row) => row.supportClusterCount), 0),
  }
  await writeJson(summaryPath, summary)
  return summary
}
