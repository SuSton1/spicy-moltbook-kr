import path from "node:path"

import { shiftDays } from "./date.mjs"
import { normalizeDateKey } from "./date.mjs"
import { resolveGlobalWindow, resolveLocalWindow } from "./config.mjs"
import {
} from "./data.mjs"
import { buildDecisionCandidateIndex } from "./candidate_index.mjs"
import {
  buildSeriesFeatureRuntimeCache,
  extractGlobalContextFeaturesFromCache,
  extractSnapshotFeaturesFromCache,
  makeSequenceFromCache,
} from "./features.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
  assertNoPrejumpLeakageRow,
} from "./perfect_prototype_prejump_contract.mjs"
import {
  buildPerfectPrototypeDecisionContextReferenceMapFromGroupedCores,
  extractPerfectPrototypeDecisionContextCore,
  resolvePerfectPrototypeDecisionContextForRow,
} from "./perfect_prototype_decision_contextual_features.mjs"
import {
  assemblePerfectPrototypePrejumpPackFromFeatureStore,
  resolvePerfectPrototypePrejumpFeatureStoreDir,
} from "./perfect_prototype_prejump_feature_store.mjs"
import { buildPerfectPrototypeTypedParquetWrapperRow } from "./perfect_prototype_parquet_io.mjs"
import {
  assertPerfectPrototypeServerDataPaths,
  assertPerfectPrototypeServerPaths,
} from "./perfect_prototype_server_policy.mjs"
import { createJsonlWriter, ensureDir, iterateJsonl, writeJson } from "./io.mjs"
import { normalizePerfectPrototypeRow } from "./perfect_prototype_tokenizer.mjs"
import { createDuckdbStructuredToParquetSink, resolvePerfectPrototypeDuckdbCli } from "./perfect_prototype_duckdb.mjs"
import { resolveEntryRule, simulateTradeFromDecision } from "./trade_rules.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "./perfect_prototype_structured_sink_schemas.mjs"

const resolveAsOfShift = (raw) => {
  const text = String(raw ?? "t").trim().toLowerCase()
  if (text === "t") return 0
  const match = text.match(/^t-(\d+)$/)
  if (match) {
    const n = Number(match[1])
    if (Number.isInteger(n) && n >= 0) return n
  }
  return 0
}

const resolveDataPaths = (cwd, dataPaths = {}) => ({
  candleDailyJsonl: path.resolve(cwd, String(dataPaths?.candleDailyJsonl ?? "data/candle_daily.jsonl")),
  universeJsonl: path.resolve(cwd, String(dataPaths?.universeJsonl ?? "data/universe_daily.jsonl")),
  symbolMasterJsonl: path.resolve(cwd, String(dataPaths?.symbolMasterJsonl ?? "data/symbol_master.jsonl")),
  hourly60mJsonl: path.resolve(cwd, String(dataPaths?.hourly60mJsonl ?? "data/candle_hourly60m.jsonl")),
  newsJsonl: path.resolve(cwd, String(dataPaths?.newsJsonl ?? "data/optional_empty.jsonl")),
})

const bump = (obj, key, amount = 1) => {
  obj[key] = Number(obj[key] ?? 0) + amount
}

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) ? n : fallback
}

const buildPeriod = ({ tradingDates, startDate = null, endDate = null }) => {
  const sortedDates = Array.isArray(tradingDates) ? tradingDates : []
  const from = String(startDate ?? sortedDates[0] ?? "").trim()
  const to = String(endDate ?? sortedDates[sortedDates.length - 1] ?? "").trim()
  if (!from || !to) {
    throw new Error("Unable to resolve prejump-pack date range")
  }
  if (from > to) {
    throw new Error(`Invalid prejump-pack date range: ${from} > ${to}`)
  }
  return { from, to }
}

const buildDateCoverage = (dateKeys) => {
  const sorted = Array.from(
    new Set(
      (Array.isArray(dateKeys) ? dateKeys : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

const PREJUMP_HISTORY_BUFFER_DAYS = 500
const PREJUMP_FORWARD_BUFFER_DAYS = 21
const PREJUMP_SINK_BATCH_SIZE = 256
const PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED = "structured"

const resolveDateKey = (row) =>
  String(row?.dateKey ?? row?.tradingDateKey ?? row?.date ?? "").trim() || null

const isDateWithin = (dateKey, { from = null, to = null } = {}) => {
  const resolved = String(dateKey ?? "").trim()
  if (!resolved) return false
  if (from && resolved < from) return false
  if (to && resolved > to) return false
  return true
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const buildPredictivePrejumpSourceRanges = ({
  startDate,
  endDate,
  localWindow,
  globalWindow,
  holdDays,
}) => {
  const backwardBufferDays = Math.max(
    PREJUMP_HISTORY_BUFFER_DAYS,
    Math.max(localWindow, globalWindow, 150) * 3,
  )
  const forwardBufferDays = Math.max(
    PREJUMP_FORWARD_BUFFER_DAYS,
    Math.max(holdDays, 1) * 7,
  )
  return {
    decisionRange: {
      from: startDate,
      to: endDate,
    },
    candleRange: {
      from: shiftDays(startDate, -backwardBufferDays),
      to: shiftDays(endDate, forwardBufferDays),
    },
  }
}

const loadPredictivePrejumpDataSlice = async ({
  dataPaths,
  symbolAllowSet = null,
  decisionRange,
  candleRange,
}) => {
  const requestedSymbols = symbolAllowSet instanceof Set ? symbolAllowSet : null
  const universeMap = new Map()
  const runtimeSymbolSet = new Set()
  let universeCount = 0
  await iterateJsonl(dataPaths.universeJsonl, {
    strict: true,
    onRow: async (row) => {
      const symbol = String(row?.symbol ?? "").trim()
      const dateKey = resolveDateKey(row)
      if (!symbol || !dateKey) return
      if (requestedSymbols && !requestedSymbols.has(symbol)) return
      if (!isDateWithin(dateKey, decisionRange)) return
      const normalizedRow = {
        symbol,
        dateKey,
        avgTradingValue20d: num(row?.avgTradingValue20d),
        marketCapKrw: num(row?.marketCapKrw ?? row?.marketCapKRW ?? row?.marketCap),
      }
      universeMap.set(`${symbol}:${dateKey}`, normalizedRow)
      runtimeSymbolSet.add(symbol)
      universeCount += 1
    },
  })

  if (runtimeSymbolSet.size < 1) {
    return {
      seriesMap: new Map(),
      universeMap,
      symbolMap: new Map(),
      tradingDates: [],
      loadedRows: {
        candles: 0,
        universe: universeCount,
        symbolMaster: 0,
      },
      loadSlice: {
        decisionRange,
        candleRange,
        runtimeSymbolCount: 0,
      },
    }
  }

  const symbolMap = new Map()
  let symbolMasterCount = 0
  await iterateJsonl(dataPaths.symbolMasterJsonl, {
    strict: true,
    onRow: async (row) => {
      const symbol = String(row?.symbol ?? "").trim()
      if (!symbol || !runtimeSymbolSet.has(symbol)) return
      symbolMap.set(symbol, {
        symbol,
        name: String(row?.name ?? "").trim(),
        type: String(row?.type ?? "").trim().toUpperCase(),
        isListed: row?.isListed !== false,
      })
      symbolMasterCount += 1
    },
  })

  const seriesMap = new Map()
  const tradingDateSet = new Set()
  let candleCount = 0
  await iterateJsonl(dataPaths.candleDailyJsonl, {
    strict: true,
    onRow: async (row) => {
      const symbol = String(row?.symbol ?? "").trim()
      const dateKey = resolveDateKey(row)
      if (!symbol || !dateKey) return
      if (!runtimeSymbolSet.has(symbol)) return
      if (!isDateWithin(dateKey, candleRange)) return
      const normalizedRow = {
        dateKey: normalizeDateKey(dateKey),
        open: num(row?.open),
        high: num(row?.high),
        low: num(row?.low),
        close: num(row?.close),
        volume: num(row?.volume),
      }
      const list = seriesMap.get(symbol) ?? []
      list.push(normalizedRow)
      seriesMap.set(symbol, list)
      tradingDateSet.add(normalizedRow.dateKey)
      candleCount += 1
    },
  })
  for (const list of seriesMap.values()) {
    list.sort((left, right) => String(left?.dateKey ?? "").localeCompare(String(right?.dateKey ?? "")))
  }
  const tradingDates = Array.from(tradingDateSet).sort((left, right) => left.localeCompare(right))

  return {
    seriesMap,
    universeMap,
    symbolMap,
    tradingDates,
    loadedRows: {
      candles: candleCount,
      universe: universeCount,
      symbolMaster: symbolMasterCount,
    },
    loadSlice: {
      decisionRange,
      candleRange,
      runtimeSymbolCount: runtimeSymbolSet.size,
    },
  }
}

const updateProgress = async (progressPath, payload) => {
  await writeJson(progressPath, {
    ...payload,
    rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    updatedAt: new Date().toISOString(),
  })
}

const prunePredictiveRuntimeStateToSeedIndex = ({
  seedIndex,
  seriesMap,
  universeMap,
  symbolMap,
}) => {
  const activeSymbols = new Set()
  const activeUniverseKeys = new Set()
  const remainingSeedCountBySymbol = new Map()

  for (const seeds of seedIndex.values()) {
    for (const seed of seeds ?? []) {
      const symbol = String(seed?.symbol ?? "").trim()
      const asOfDateKey = String(seed?.asOfDateKey ?? "").trim()
      if (!symbol) continue
      activeSymbols.add(symbol)
      remainingSeedCountBySymbol.set(symbol, Number(remainingSeedCountBySymbol.get(symbol) ?? 0) + 1)
      if (asOfDateKey) {
        activeUniverseKeys.add(`${symbol}:${asOfDateKey}`)
      }
    }
  }

  for (const symbol of Array.from(seriesMap.keys())) {
    if (!activeSymbols.has(symbol)) {
      seriesMap.delete(symbol)
    }
  }
  for (const symbol of Array.from(symbolMap.keys())) {
    if (!activeSymbols.has(symbol)) {
      symbolMap.delete(symbol)
    }
  }
  for (const key of Array.from(universeMap.keys())) {
    if (!activeUniverseKeys.has(key)) {
      universeMap.delete(key)
    }
  }

  return {
    activeSymbolCount: activeSymbols.size,
    activeUniverseKeyCount: activeUniverseKeys.size,
    remainingSeedCountBySymbol,
  }
}

const buildBaseRow = ({
  meta,
  seed,
  decisionDateKey,
  targetDateKey,
  localWindow,
  globalWindow,
  featureVec,
  globalFeatureVec,
  seq40,
  seq150,
  eventOutcome,
}) => {
  const baseRow = {
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `${seed.symbol}:${decisionDateKey}`,
    symbol: seed.symbol,
    name: meta?.name ?? seed.symbol,
    dateKey: decisionDateKey,
    decisionDateKey,
    asOfDateKey: decisionDateKey,
    targetDateKey,
    decisionIdx: seed.decisionIdx,
    asOfIdx: seed.decisionIdx,
    targetIdx: seed.targetIdx,
    localWindow,
    globalWindow,
    featureVec,
    globalFeatureVec,
    marketContextVec: null,
    xsecEventVec: null,
    contextualTokens: [],
    seq40,
    seq150,
    eventOutcome,
    outcomeHitTarget:
      typeof eventOutcome?.hitTarget === "boolean" ? eventOutcome.hitTarget : null,
  }
  assertNoPrejumpLeakageRow(baseRow)
  return baseRow
}

export const buildPerfectPrototypePrejumpPack = async ({
  cwd,
  config,
  outDir,
  options = {},
}) => {
  if (!cwd || !config || !outDir) {
    throw new Error("buildPerfectPrototypePrejumpPack requires cwd, config, and outDir")
  }
  const dataPaths = resolveDataPaths(cwd, config?.dataPaths)
  const serverPolicy = assertPerfectPrototypeServerDataPaths({
    dataPaths,
    cwd,
    toolName: "build_perfect_prototype_prejump_pack",
  })
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "outDir", filePath: outDir }],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_prejump_pack",
  })
  const localWindow = resolveLocalWindow(config)
  const globalWindow = resolveGlobalWindow(config)
  const minWindow = Math.max(localWindow, globalWindow)
  const asOfShift = resolveAsOfShift(config?.template?.featureAsOf)
  if (asOfShift !== 0) {
    throw new Error(
      `Prejump predictive pack requires template.featureAsOf=t, got shift=${asOfShift}`,
    )
  }
  const entryRule = resolveEntryRule(config?.backtest?.entry)
  if (String(entryRule?.mode ?? "").trim().toUpperCase() !== "NEXT_DAY_OPEN") {
    throw new Error(
      `Prejump predictive pack requires backtest.entry=NEXT_DAY_OPEN, got ${JSON.stringify(entryRule)}`,
    )
  }
  const holdDays = Math.max(1, Number(config?.backtest?.holdDays ?? 3) || 3)
  const targetPct = Number(config?.backtest?.targetPct ?? 0.08)
  const stopLossPct = Number(config?.backtest?.stopLossPct ?? 0.04)
  const feeBps = Number(config?.backtest?.feeBps ?? 0)
  const slippageBps = Number(config?.backtest?.slippageBps ?? 0)
  const costPct = (feeBps + slippageBps) / 10000
  const limitRows = toInteger(options?.limitRows, null)
  const maxDecisionDates = toInteger(options?.maxDecisionDates, null)
  const maxRowsPerDate = toInteger(options?.maxRowsPerDate, null)
  const emitJsonl = options?.emitJsonl === true
  const decisionDateSamplingMode =
    String(options?.decisionDateSamplingMode ?? "decision_date_stratified").trim().toLowerCase() ||
    "decision_date_stratified"
  const sourceMode = String(options?.sourceMode ?? "feature_store").trim().toLowerCase() || "feature_store"
  const featureStoreDir =
    sourceMode === "feature_store"
      ? resolvePerfectPrototypePrejumpFeatureStoreDir({
          cwd,
          featureStoreDir: String(options?.featureStoreDir ?? "").trim() || null,
        })
      : String(options?.featureStoreDir ?? "").trim() || null
  const symbolAllowSet = options?.symbolAllowSet instanceof Set ? options.symbolAllowSet : null
  const explicitStartDate = String(options?.startDate ?? "").trim() || null
  const explicitEndDate = String(options?.endDate ?? "").trim() || null
  if (!explicitStartDate || !explicitEndDate) {
    throw new Error(
      "Prejump predictive pack requires explicit --start and --end so predictive source slicing remains deterministic.",
    )
  }
  if (sourceMode !== "raw" && sourceMode !== "feature_store") {
    throw new Error(`Unsupported predictive pack sourceMode: ${sourceMode}`)
  }
  if (sourceMode === "feature_store") {
    if (!featureStoreDir) {
      throw new Error(
        "Prejump predictive pack sourceMode=feature_store requires featureStoreDir",
      )
    }
    return assemblePerfectPrototypePrejumpPackFromFeatureStore({
      cwd,
      featureStoreDir,
      startDate: explicitStartDate,
      endDate: explicitEndDate,
      outDir,
      emitJsonl,
      limitRows,
      maxDecisionDates,
      maxRowsPerDate,
      decisionDateSamplingMode,
    })
  }

  const sourceRanges = buildPredictivePrejumpSourceRanges({
    startDate: explicitStartDate,
    endDate: explicitEndDate,
    localWindow,
    globalWindow,
    holdDays,
  })

  const data = await loadPredictivePrejumpDataSlice({
    dataPaths,
    symbolAllowSet,
    decisionRange: sourceRanges.decisionRange,
    candleRange: sourceRanges.candleRange,
  })
  const seriesMap = data.seriesMap
  const universeMap = data.universeMap
  const symbolMap = data.symbolMap
  const tradingDates = data.tradingDates
  const period = buildPeriod({
    tradingDates,
    startDate: explicitStartDate,
    endDate: explicitEndDate,
  })

  await ensureDir(outDir)
  const outputPath = path.join(outDir, "prejump_pack.parquet")
  const outputJsonlPath = emitJsonl ? path.join(outDir, "prejump_pack.jsonl") : null
  const progressPath = path.join(outDir, "progress.json")
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })

  const seedIndex = buildDecisionCandidateIndex({
    period,
    sequenceWindow: minWindow,
    asOfShift,
    seriesMap,
    symbolMap,
    universeMap,
    filtersCfg: config?.filters ?? {},
  })
  const orderedDecisionDates = Array.from(seedIndex.keys()).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  const totalSeedCount = orderedDecisionDates.reduce(
    (sum, dateKey) => sum + (seedIndex.get(dateKey)?.length ?? 0),
    0,
  )
  const runtimeState = prunePredictiveRuntimeStateToSeedIndex({
    seedIndex,
    seriesMap,
    universeMap,
    symbolMap,
  })
  const remainingSeedCountBySymbol = runtimeState.remainingSeedCountBySymbol
  const seriesFeatureCacheBySymbol = new Map()
  const rawSummary = {
    period,
    requestedPeriod: period,
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    localWindow,
    globalWindow,
    asOfShift,
    limitRowsApplied: limitRows,
    truncatedByLimitRows: false,
    loadedRows: {
      candles: Number(data?.loadedRows?.candles ?? 0),
      universe: Number(data?.loadedRows?.universe ?? 0),
      symbolMaster: Number(data?.loadedRows?.symbolMaster ?? 0),
    },
    loadSlice: data.loadSlice ?? null,
    activeRuntimeState: {
      seriesSymbols: runtimeState.activeSymbolCount,
      universeKeys: runtimeState.activeUniverseKeyCount,
      symbolMasterRows: symbolMap.size,
    },
    seedDecisionDates: orderedDecisionDates.length,
    seedCount: totalSeedCount,
    processedSeedCount: 0,
    rowsWritten: 0,
    positiveRows: 0,
    negativeRows: 0,
    nullOutcomeRows: 0,
    uniqueSymbols: 0,
    dropCounts: {},
  }
  const writtenSymbols = new Set()
  const writtenDecisionDateKeys = new Set()
  const primarySinkMode =
    String(process.env.PREJUMP_PRIMARY_SINK_MODE ?? "structured").trim().toLowerCase() || "structured"
  if (primarySinkMode !== PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED) {
    throw new Error(
      `Perfect prototype predictive pack sink mode must remain ${PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED}: ${primarySinkMode}`,
    )
  }
  const wrapperSink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath: outputPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    sessionOverrides: {
      preserveInsertionOrder: true,
    },
  })
  const finalWriter = outputJsonlPath ? await createJsonlWriter(outputJsonlPath) : null
  const numericFeatureKeySet = new Set()
  let lastProgressAt = Date.now()
  let rowOrdinal = 0
  let wrapperSinkClosed = false
  let buildError = null
  const releaseRuntimeStateForSeed = (symbol, asOfDateKey) => {
    const resolvedSymbol = String(symbol ?? "").trim()
    if (!resolvedSymbol) return
    const nextCount = Number(remainingSeedCountBySymbol.get(resolvedSymbol) ?? 0) - 1
    if (asOfDateKey) {
      universeMap.delete(`${resolvedSymbol}:${asOfDateKey}`)
    }
    if (nextCount <= 0) {
      remainingSeedCountBySymbol.delete(resolvedSymbol)
      seriesFeatureCacheBySymbol.delete(resolvedSymbol)
      seriesMap.delete(resolvedSymbol)
      symbolMap.delete(resolvedSymbol)
      return
    }
    remainingSeedCountBySymbol.set(resolvedSymbol, nextCount)
  }

  await updateProgress(progressPath, {
    phase: "collect_base_rows",
    rowsScanned: 0,
    rowsWritten: 0,
    rowsContextualized: 0,
    seedDecisionDates: orderedDecisionDates.length,
    distinctDecisionDatesWritten: 0,
    distinctContextDates: 0,
    seedCountTotal: totalSeedCount,
  })

  try {
    for (const decisionDateKey of orderedDecisionDates) {
      const seeds = seedIndex.get(decisionDateKey) ?? []
      const dateBaseRows = []
      const dateContextCores = []
      for (const seed of seeds) {
        if (limitRows && rawSummary.rowsWritten >= limitRows) {
          rawSummary.truncatedByLimitRows = true
          break
        }
        rawSummary.processedSeedCount += 1
        const symbol = String(seed?.symbol ?? "").trim()
        if (!symbol) {
          bump(rawSummary.dropCounts, "MISSING_SYMBOL")
          continue
        }
        try {
          const series = seriesMap.get(symbol)
          if (!series) {
            bump(rawSummary.dropCounts, "MISSING_SERIES")
            continue
          }
          const meta = symbolMap.get(symbol) ?? { symbol, name: symbol, type: "UNKNOWN", isListed: true }
          const targetDateKey = String(series[seed.targetIdx]?.dateKey ?? "").trim()
          if (!targetDateKey) {
            bump(rawSummary.dropCounts, "MISSING_TARGET_DATE")
            continue
          }
          let cache = seriesFeatureCacheBySymbol.get(symbol) ?? null
          if (!cache) {
            cache = buildSeriesFeatureRuntimeCache(series)
            seriesFeatureCacheBySymbol.set(symbol, cache)
          }
          const universeRow = universeMap.get(`${symbol}:${decisionDateKey}`)
          const featureVec = extractSnapshotFeaturesFromCache({
            cache,
            series,
            asOfIdx: seed.decisionIdx,
            symbol,
            universeRow,
            surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
          })
          if (!featureVec) {
            bump(rawSummary.dropCounts, "MISSING_FEATURE_VEC")
            continue
          }
          const globalFeatureVec = extractGlobalContextFeaturesFromCache({
            cache,
            series,
            asOfIdx: seed.decisionIdx,
            globalWindow,
          })
          const seq40 = makeSequenceFromCache({
            cache,
            series,
            endIdx: seed.decisionIdx,
            window: localWindow,
          })
          const seq150 = makeSequenceFromCache({
            cache,
            series,
            endIdx: seed.decisionIdx,
            window: globalWindow,
          })
          const eventOutcome = simulateTradeFromDecision({
            series,
            decisionIdx: seed.decisionIdx,
            entryRule,
            holdDays,
            targetPct,
            stopLossPct,
            costPct,
          })
          const baseRow = buildBaseRow({
            meta,
            seed,
            decisionDateKey,
            targetDateKey,
            localWindow,
            globalWindow,
            featureVec,
            globalFeatureVec,
            seq40,
            seq150,
            eventOutcome,
          })
          dateBaseRows.push(baseRow)
          const decisionContextCore = extractPerfectPrototypeDecisionContextCore(baseRow)
          if (decisionContextCore?.dateKey) {
            dateContextCores.push(decisionContextCore)
          }
          rawSummary.rowsWritten += 1
          writtenSymbols.add(symbol)
          writtenDecisionDateKeys.add(decisionDateKey)
          if (baseRow.outcomeHitTarget === true) {
            rawSummary.positiveRows += 1
          } else if (baseRow.outcomeHitTarget === false) {
            rawSummary.negativeRows += 1
          } else {
            rawSummary.nullOutcomeRows += 1
          }
          if (Date.now() - lastProgressAt >= 30000) {
            lastProgressAt = Date.now()
            await updateProgress(progressPath, {
              phase: "collect_base_rows",
              rowsScanned: rawSummary.processedSeedCount,
              rowsWritten: rawSummary.rowsWritten,
              rowsContextualized: rowOrdinal,
              seedDecisionDates: orderedDecisionDates.length,
              distinctDecisionDatesWritten: writtenDecisionDateKeys.size,
              distinctContextDates: writtenDecisionDateKeys.size,
              seedCountTotal: totalSeedCount,
              activeSeriesSymbols: seriesMap.size,
            })
          }
        } finally {
          releaseRuntimeStateForSeed(symbol, decisionDateKey)
        }
      }

      if (dateBaseRows.length > 0) {
        const dateReferenceMap = buildPerfectPrototypeDecisionContextReferenceMapFromGroupedCores(
          new Map([[decisionDateKey, dateContextCores]]),
        )
        const reference = dateReferenceMap.get(decisionDateKey) ?? null
        const wrapperRowsBatch = []
        const outputRowsBatch = []
        const flushBatches = async () => {
          if (outputRowsBatch.length > 0 && finalWriter) {
            await finalWriter.writeRows(outputRowsBatch)
            outputRowsBatch.length = 0
          }
          if (wrapperRowsBatch.length > 0) {
            await wrapperSink.writeRows(wrapperRowsBatch)
            wrapperRowsBatch.length = 0
          }
        }
        for (const baseRow of dateBaseRows) {
          const context = resolvePerfectPrototypeDecisionContextForRow({
            row: baseRow,
            reference,
          })
          const enrichedRow = {
            ...baseRow,
            marketContextVec: context.marketContextVec,
            xsecEventVec: context.xsecEventVec,
            contextualTokens: context.contextualTokens,
          }
          const normalizedRow = normalizePerfectPrototypeRow(enrichedRow, {
            surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
          })
          const finalRow = {
            ...normalizedRow,
            name: enrichedRow?.name ?? null,
            targetDateKey: String(enrichedRow?.targetDateKey ?? "").trim() || null,
            raw: null,
          }
          assertNoPrejumpLeakageRow(finalRow)
          for (const featureKey of Object.keys(finalRow.numericFeatureMap ?? {})) {
            numericFeatureKeySet.add(featureKey)
          }
          if (finalWriter) {
            outputRowsBatch.push(finalRow)
          }
          wrapperRowsBatch.push(
            buildPerfectPrototypeTypedParquetWrapperRow({
              rowOrdinal,
              row: {
                ...finalRow,
                targetDateKey: String(enrichedRow?.targetDateKey ?? "").trim() || null,
                strategyMode: finalRow.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
                contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
              },
            }),
          )
          rowOrdinal += 1
          if (wrapperRowsBatch.length >= PREJUMP_SINK_BATCH_SIZE) {
            await flushBatches()
          }
          if (Date.now() - lastProgressAt >= 30000) {
            lastProgressAt = Date.now()
            await updateProgress(progressPath, {
              phase: "enrich_and_write",
              rowsScanned: rawSummary.processedSeedCount,
              rowsWritten: rawSummary.rowsWritten,
              rowsContextualized: rowOrdinal,
              seedDecisionDates: orderedDecisionDates.length,
              distinctDecisionDatesWritten: writtenDecisionDateKeys.size,
              distinctContextDates: writtenDecisionDateKeys.size,
              seedCountTotal: totalSeedCount,
            })
          }
        }
        await flushBatches()
      }

      if (limitRows && rawSummary.rowsWritten >= limitRows) {
        rawSummary.truncatedByLimitRows = true
        break
      }
    }
  } catch (error) {
    buildError = error
    throw error
  } finally {
    if (finalWriter) {
      await finalWriter.close()
    }
    if (buildError && !wrapperSinkClosed) {
      await wrapperSink.abort()
    }
  }

  const finalSummary = {
    ...rawSummary,
    rowCount: rawSummary.rowsWritten,
    uniqueSymbols: writtenSymbols.size,
    contextualDecisionDates: writtenDecisionDateKeys.size,
    requestedDecisionRange: rawSummary.requestedPeriod,
    effectiveDecisionCoverage: buildDateCoverage(Array.from(writtenDecisionDateKeys)),
    outputCoverage: buildDateCoverage(Array.from(writtenDecisionDateKeys)),
    coverageComplete: rawSummary.truncatedByLimitRows !== true,
    storageFormat: "parquet",
    outputPath,
    outputJsonlPath,
    schemaPath: path.join(outDir, "schema.json"),
    summaryPath: path.join(outDir, "summary.json"),
    progressPath,
  }

  await updateProgress(progressPath, {
    phase: "convert_to_parquet",
    rowsScanned: rawSummary.processedSeedCount,
    rowsWritten: rawSummary.rowsWritten,
    rowsContextualized: rowOrdinal,
    seedDecisionDates: orderedDecisionDates.length,
    distinctDecisionDatesWritten: writtenDecisionDateKeys.size,
    distinctContextDates: writtenDecisionDateKeys.size,
    seedCountTotal: totalSeedCount,
  })

  await wrapperSink.close()
  wrapperSinkClosed = true
  await writeJson(finalSummary.schemaPath, {
    storageFormat: "parquet",
    rowOrdinalColumn: "rowOrdinal",
    typedRowContract: true,
    numericFeatureMapColumn: "numericFeatureMap",
    categoricalTokensColumn: "categoricalTokens",
    numericFeatureKeys: Array.from(numericFeatureKeySet).sort((left, right) => left.localeCompare(right)),
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    outputPath,
    outputJsonlPath,
  })
  await writeJson(finalSummary.summaryPath, finalSummary)
  await updateProgress(progressPath, {
    phase: "completed",
    rowsScanned: rawSummary.processedSeedCount,
    rowsWritten: rawSummary.rowsWritten,
    rowsContextualized: rowOrdinal,
    seedDecisionDates: orderedDecisionDates.length,
    distinctDecisionDatesWritten: writtenDecisionDateKeys.size,
    distinctContextDates: writtenDecisionDateKeys.size,
    seedCountTotal: totalSeedCount,
  })

  return {
    outputPath,
    summaryPath: finalSummary.summaryPath,
    summary: finalSummary,
  }
}
