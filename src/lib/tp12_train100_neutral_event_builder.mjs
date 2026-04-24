import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toBool,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertNoOosPath,
  loadTp12Train100NeutralContract,
  resolvePath,
} from "./tp12_train100_neutral_search_guards.mjs"

const keyOf = (symbol, decisionDateKey) => `${decisionDateKey}\t${symbol}`

const yearOf = (dateKey) => toText(dateKey).slice(0, 4)

const inDateRange = (dateKey, range) => {
  const text = toText(dateKey)
  if (!validDateKey(text)) return false
  const from = toText(range?.from)
  const to = toText(range?.to)
  return (!from || text >= from) && (!to || text <= to)
}

const assertTrainOnlyDate = (dateKey, contract, label) => {
  if (!validDateKey(dateKey)) throw new Error(`${label} must be YYYY-MM-DD: ${dateKey || "missing"}`)
  if (!inDateRange(dateKey, contract.trainDateRange)) throw new Error(`${label} outside train range: ${dateKey}`)
  if (inDateRange(dateKey, contract.forbiddenDateRange)) throw new Error(`${label} overlaps forbidden OOS range: ${dateKey}`)
}

const normalizeSymbol = (value) => toText(value).toUpperCase()

const familyFromToken = (token) => {
  const text = toText(token)
  const index = text.indexOf(":")
  return index > 0 ? text.slice(0, index) : ""
}

const loadPatternClusterMap = async (patternClustersPath) => {
  if (!toText(patternClustersPath)) return new Map()
  const map = new Map()
  await iterateJsonlMaybeGzip(patternClustersPath, {
    strict: true,
    onRow: async (row) => {
      const clusterId = toText(row.clusterId)
      if (!clusterId) return
      for (const patternId of row.patternIds ?? []) {
        const id = toText(patternId)
        if (id) map.set(id, clusterId)
      }
    },
  })
  return map
}

const getOrCreateAggregate = (aggregates, symbol, decisionDateKey) => {
  const key = keyOf(symbol, decisionDateKey)
  let row = aggregates.get(key)
  if (!row) {
    row = {
      symbol,
      decisionDateKey,
      hitTarget: null,
      patternIds: new Set(),
      clusterIds: new Set(),
      tokenFamilies: new Set(),
      rawEventRowCount: 0,
      positiveEventRowCount: 0,
      negativeEventRowCount: 0,
    }
    aggregates.set(key, row)
  }
  return row
}

const loadCandidateAggregates = async ({ candidateEventsPath, patternClusterMap, contract }) => {
  const aggregates = new Map()
  const datePatternSets = new Map()
  const dateSymbolSets = new Map()
  const dateRawEventRows = new Map()
  const byYearRows = new Map()
  const byYearHits = new Map()
  let inputRowCount = 0
  let labelConflictCount = 0

  await iterateJsonlMaybeGzip(candidateEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const symbol = normalizeSymbol(row.symbol)
      const decisionDateKey = toText(row.decisionDateKey ?? row.dateKey)
      if (!symbol) throw new Error(`candidate row missing symbol at ${context.filePath}:${context.lineNumber}`)
      assertTrainOnlyDate(decisionDateKey, contract, `candidate decisionDateKey at ${context.filePath}:${context.lineNumber}`)
      const patternId = toText(row.patternId)
      const clusterId = patternClusterMap.get(patternId) ?? patternId
      const aggregate = getOrCreateAggregate(aggregates, symbol, decisionDateKey)
      const hitTarget = toBool(row.hitTarget, false)
      if (aggregate.hitTarget !== null && aggregate.hitTarget !== hitTarget) {
        labelConflictCount += 1
        throw new Error(`conflicting hitTarget for symbol/date ${decisionDateKey}::${symbol}`)
      }
      aggregate.hitTarget = hitTarget
      aggregate.rawEventRowCount += 1
      if (hitTarget) aggregate.positiveEventRowCount += 1
      else aggregate.negativeEventRowCount += 1
      if (patternId) aggregate.patternIds.add(patternId)
      if (clusterId) aggregate.clusterIds.add(clusterId)
      for (const token of row.tokenSet ?? []) {
        const family = familyFromToken(token)
        if (family) aggregate.tokenFamilies.add(family)
      }
      const datePatterns = datePatternSets.get(decisionDateKey) ?? new Set()
      if (patternId) datePatterns.add(patternId)
      datePatternSets.set(decisionDateKey, datePatterns)
      const dateSymbols = dateSymbolSets.get(decisionDateKey) ?? new Set()
      dateSymbols.add(symbol)
      dateSymbolSets.set(decisionDateKey, dateSymbols)
      dateRawEventRows.set(decisionDateKey, (dateRawEventRows.get(decisionDateKey) ?? 0) + 1)
    },
  })

  for (const aggregate of aggregates.values()) {
    const year = yearOf(aggregate.decisionDateKey)
    byYearRows.set(year, (byYearRows.get(year) ?? 0) + 1)
    if (aggregate.hitTarget) byYearHits.set(year, (byYearHits.get(year) ?? 0) + 1)
  }

  return {
    aggregates,
    datePatternSets,
    dateSymbolSets,
    dateRawEventRows,
    inputRowCount,
    labelConflictCount,
    byYearRows,
    byYearHits,
  }
}

const contextPayload = (row) => {
  const payload = {}
  for (const [key, value] of Object.entries(row)) {
    if (["kind", "symbol", "decisionDateKey", "dateKey"].includes(key)) continue
    payload[key] = value
  }
  return payload
}

const sortedObject = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))))

export const buildTp12Train100NeutralEventRows = async ({
  contractPath,
  candidateEventsPath,
  contextFeaturesPath,
  patternClustersPath = "",
  outPath,
  summaryPath,
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const resolvedCandidateEventsPath = resolvePath(cwd, candidateEventsPath, "candidateEventsPath")
  const resolvedContextFeaturesPath = resolvePath(cwd, contextFeaturesPath, "contextFeaturesPath")
  const resolvedPatternClustersPath = patternClustersPath ? path.resolve(cwd, patternClustersPath) : ""
  const resolvedOutPath = path.resolve(cwd, toText(outPath))
  const resolvedSummaryPath = path.resolve(cwd, toText(summaryPath))
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(summaryPath)) throw new Error("summaryPath is required")
  for (const [label, value] of [
    ["candidateEventsPath", resolvedCandidateEventsPath],
    ["contextFeaturesPath", resolvedContextFeaturesPath],
    ["patternClustersPath", resolvedPatternClustersPath],
    ["outPath", resolvedOutPath],
    ["summaryPath", resolvedSummaryPath],
  ]) {
    if (value) assertNoOosPath(value, label)
  }
  if (!fs.existsSync(resolvedCandidateEventsPath)) throw new Error(`candidate events not found: ${resolvedCandidateEventsPath}`)
  if (!fs.existsSync(resolvedContextFeaturesPath)) throw new Error(`context features not found: ${resolvedContextFeaturesPath}`)
  if (resolvedPatternClustersPath && !fs.existsSync(resolvedPatternClustersPath)) {
    throw new Error(`pattern clusters not found: ${resolvedPatternClustersPath}`)
  }

  const patternClusterMap = await loadPatternClusterMap(resolvedPatternClustersPath)
  const aggregateState = await loadCandidateAggregates({
    candidateEventsPath: resolvedCandidateEventsPath,
    patternClusterMap,
    contract,
  })

  await ensureDir(path.dirname(resolvedOutPath))
  const writer = createJsonlWriteStreamMaybeGzip(resolvedOutPath)
  let contextRowCount = 0
  let outputRowCount = 0
  let hitRows = 0
  let missingAggregateCount = 0
  const missingAggregateSamples = []
  const byYearOutput = new Map()
  const byYearOutputHits = new Map()

  try {
    await iterateJsonlMaybeGzip(resolvedContextFeaturesPath, {
      strict: true,
      onRow: async (row, context) => {
        contextRowCount += 1
        const symbol = normalizeSymbol(row.symbol)
        const decisionDateKey = toText(row.decisionDateKey ?? row.dateKey)
        if (!symbol) throw new Error(`context row missing symbol at ${context.filePath}:${context.lineNumber}`)
        assertTrainOnlyDate(decisionDateKey, contract, `context decisionDateKey at ${context.filePath}:${context.lineNumber}`)
        const aggregate = aggregateState.aggregates.get(keyOf(symbol, decisionDateKey))
        if (!aggregate) {
          missingAggregateCount += 1
          if (missingAggregateSamples.length < 20) missingAggregateSamples.push({ symbol, decisionDateKey })
          return
        }
        const datePatternCount = aggregateState.datePatternSets.get(decisionDateKey)?.size ?? 0
        const dateSymbolCount = aggregateState.dateSymbolSets.get(decisionDateKey)?.size ?? 0
        const dateRawEventRows = aggregateState.dateRawEventRows.get(decisionDateKey) ?? 0
        const output = {
          ...contextPayload(row),
          kind: "tp12_train100_neutral_event_row_v1",
          symbol,
          decisionDateKey,
          sourceDateKey: toText(row.asOfFeatureDateKey ?? row.sourceDateKey ?? decisionDateKey),
          asOfFeatureDateKey: toText(row.asOfFeatureDateKey ?? row.sourceDateKey ?? decisionDateKey),
          hitTarget: aggregate.hitTarget === true,
          rawEventRowCount: aggregate.rawEventRowCount,
          positiveEventRowCount: aggregate.positiveEventRowCount,
          negativeEventRowCount: aggregate.negativeEventRowCount,
          supportPatternIds: [...aggregate.patternIds].sort(),
          supportClusterIds: [...aggregate.clusterIds].sort(),
          tokenFamilies: [...aggregate.tokenFamilies].sort(),
          supportPatternCount: aggregate.patternIds.size,
          supportClusterCount: aggregate.clusterIds.size,
          familyDiversity: aggregate.tokenFamilies.size,
          dayRawEventRows: dateRawEventRows,
          dayCandidateRows: dateRawEventRows,
          daySymbolDateCandidateRows: dateSymbolCount,
          dayUniqueSymbols: dateSymbolCount,
          dayUniquePatterns: datePatternCount,
        }
        outputRowCount += 1
        if (output.hitTarget) hitRows += 1
        const year = yearOf(decisionDateKey)
        byYearOutput.set(year, (byYearOutput.get(year) ?? 0) + 1)
        if (output.hitTarget) byYearOutputHits.set(year, (byYearOutputHits.get(year) ?? 0) + 1)
        await writeJsonlRow(writer.stream, output)
      },
    })
  } finally {
    await writer.close()
  }

  const failures = []
  if (missingAggregateCount > 0) failures.push(`missing_candidate_aggregate_rows:${missingAggregateCount}`)
  if (outputRowCount < 1) failures.push("zero_output_rows")
  const summary = {
    kind: "tp12_train100_neutral_event_build_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    candidateEventsPath: resolvedCandidateEventsPath,
    contextFeaturesPath: resolvedContextFeaturesPath,
    patternClustersPath: resolvedPatternClustersPath || null,
    outPath: resolvedOutPath,
    inputCandidateEventRowCount: aggregateState.inputRowCount,
    candidateSymbolDateCount: aggregateState.aggregates.size,
    contextRowCount,
    outputRowCount,
    hitRows,
    hitRate: outputRowCount > 0 ? hitRows / outputRowCount : 0,
    missingAggregateCount,
    missingAggregateSamples,
    byYearRows: sortedObject(byYearOutput),
    byYearHitRows: sortedObject(byYearOutputHits),
    sourceCandidateByYearRows: sortedObject(aggregateState.byYearRows),
    sourceCandidateByYearHitRows: sortedObject(aggregateState.byYearHits),
    patternClusterMapSize: patternClusterMap.size,
    labelConflictCount: aggregateState.labelConflictCount,
    failures,
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(resolvedSummaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 neutral event build failed: ${failures.join("; ")}`)
  return summary
}
