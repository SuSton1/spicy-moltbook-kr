import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

import { resolveGlobalWindow, resolveLocalWindow } from "./config.mjs"
import {
  buildCandleDateIndexMap,
  buildCandleSeriesMap,
  buildSymbolMasterMap,
  buildUniverseMap,
  collectTradingDates,
  loadStepDEData,
} from "./data.mjs"
import { isInRange } from "./date.mjs"
import { buildDecisionCandidateIndex } from "./candidate_index.mjs"
import {
  buildSeriesFeatureRuntimeCache,
} from "./features.mjs"
import {
  buildPerfectPrototypeContextReferenceMap,
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  resolvePerfectPrototypeContextForRow,
} from "./perfect_prototype_contextual_features.mjs"
import { buildPerfectPrototypeEventMetaFromSeries } from "./perfect_prototype_event_features.mjs"
import {
  PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN,
  resolvePerfectPrototypeDiscoveryUniverse,
} from "./perfect_prototype_multiline_contract.mjs"
import { normalizePerfectPrototypeDatasetContract } from "./perfect_prototype_prejump_contract.mjs"
import { assertPerfectPrototypeServerDataPaths, assertPerfectPrototypeServerPaths } from "./perfect_prototype_server_policy.mjs"
import { createJsonlWriter, ensureDir, readJsonl, writeJson } from "./io.mjs"
import { resolveEntryRule } from "./trade_rules.mjs"
import {
  buildPerfectPrototypeDecisionFeatureBundle,
  buildPerfectPrototypeDecisionOutcome,
  buildPerfectPrototypeDecisionRow,
} from "./perfect_prototype_stepb_row_builder.mjs"
import { selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions } from "./perfect_prototype_prejump_decision_date_stratified_sampler.mjs"

const resolveAsOfShift = (raw) => {
  const text = String(raw ?? "t-1").trim().toLowerCase()
  if (text === "t") return 0
  const match = text.match(/^t-(\d+)$/)
  if (match) {
    const n = Number(match[1])
    if (Number.isInteger(n) && n >= 0) return n
  }
  return 1
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

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveNegativeSampling = (raw) => {
  const offsets = Array.isArray(raw?.offsets)
    ? raw.offsets.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [5, 10, 20]
  return {
    enabled: raw?.enabled !== false,
    maxNegativesPerPositive: Math.max(0, Number(raw?.maxNegativesPerPositive ?? 1) || 1),
    offsets: offsets.length > 0 ? offsets : [5, 10, 20],
  }
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
    throw new Error("Unable to resolve daily-pack date range")
  }
  if (from > to) {
    throw new Error(`Invalid daily-pack date range: ${from} > ${to}`)
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

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))

const normalizeExcludedDecisionDates = (value) =>
  new Set(uniqueSortedStrings(Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []))

const normalizeEnabledRecentImpulseLanes = (value) => {
  if (Array.isArray(value)) return uniqueSortedStrings(value)
  const text = String(value ?? "").trim()
  if (!text) return []
  return uniqueSortedStrings(text.split(","))
}

const normalizeAllowedStepALanes = (value) => {
  if (Array.isArray(value)) return uniqueSortedStrings(value)
  const text = String(value ?? "").trim()
  if (!text) return []
  return uniqueSortedStrings(text.split(","))
}

const intersectSymbolAllowSets = (left, right) => {
  if (!(left instanceof Set)) return right instanceof Set ? right : null
  if (!(right instanceof Set)) return left
  return new Set(Array.from(left).filter((symbol) => right.has(symbol)))
}

const buildEventDateSetBySymbol = (rows) => {
  const bySymbol = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = String(row?.symbol ?? "").trim()
    const decisionDateKey = String(row?.dateKey ?? "").trim()
    if (!symbol || !decisionDateKey) continue
    const set = bySymbol.get(symbol) ?? new Set()
    set.add(decisionDateKey)
    bySymbol.set(symbol, set)
  }
  return bySymbol
}

const buildDailyPackDatasetContract = ({
  rowCount,
  outputCoverage,
  baselineLineId,
  discoveryUniverseId,
  requestedLookbackTradingDays,
  enabledRecentImpulseLanes,
  allowedStepALanes,
  includeSameDayHigh8,
}) =>
  normalizePerfectPrototypeDatasetContract({
    rowCount,
    minDateKey: outputCoverage?.from ?? null,
    maxDateKey: outputCoverage?.to ?? null,
    hasMeaningfulEventMetaRows: rowCount > 0,
    hasMeaningfulEventFeatureRows: rowCount > 0,
    hasForbiddenPredictiveTags: false,
    baselineLineIds: baselineLineId ? [baselineLineId] : [],
    discoveryUniverseIds: discoveryUniverseId ? [discoveryUniverseId] : [],
    requestedLookbackTradingDaysValues:
      Number.isInteger(requestedLookbackTradingDays) && requestedLookbackTradingDays > 0
        ? [requestedLookbackTradingDays]
        : [],
    enabledRecentImpulseLanes,
    allowedStepALanes,
    includeSameDayHigh8,
  })

const buildDecisionSeedIndexFromStepA = ({
  period,
  sequenceWindow,
  asOfShift,
  seriesMap,
  candleDateIndexMap,
  seedRows,
  allowedStepALanes = [],
}) => {
  const byDate = new Map()
  const minAsOfIdx = Math.max(1, Number(sequenceWindow ?? 40) || 40)
  const allowedLaneSet = new Set(uniqueSortedStrings(allowedStepALanes))
  const seenSeedDecisionKeys = new Set()
  const seedBuildStats = {
    inputRows: Array.isArray(seedRows) ? seedRows.length : 0,
    acceptedRows: 0,
    droppedCounts: {},
  }

  for (const seedRow of Array.isArray(seedRows) ? seedRows : []) {
    const symbol = String(seedRow?.symbol ?? "").trim()
    const decisionDateKey = String(seedRow?.dateKey ?? "").trim()
    const stepALaneId = String(seedRow?.stepALaneId ?? "").trim()
    if (!symbol || !decisionDateKey) {
      bump(seedBuildStats.droppedCounts, "MISSING_SEED_KEY")
      continue
    }
    if (!isInRange(decisionDateKey, period)) {
      bump(seedBuildStats.droppedCounts, "OUT_OF_PERIOD")
      continue
    }
    if (!allowedLaneSet.has(stepALaneId)) {
      bump(seedBuildStats.droppedCounts, "LANE_OUTSIDE_DISCOVERY_UNIVERSE")
      continue
    }
    const series = seriesMap.get(symbol) ?? null
    const dateIndexMap = candleDateIndexMap.get(symbol) ?? null
    if (!series || !dateIndexMap) {
      bump(seedBuildStats.droppedCounts, "MISSING_SERIES")
      continue
    }
    const decisionIdx = Number(dateIndexMap.get(decisionDateKey))
    if (!Number.isInteger(decisionIdx) || decisionIdx < 0) {
      bump(seedBuildStats.droppedCounts, "MISSING_DECISION_INDEX")
      continue
    }
    const expectedAsOfIdx = decisionIdx - asOfShift
    if (expectedAsOfIdx < minAsOfIdx) {
      bump(seedBuildStats.droppedCounts, "INSUFFICIENT_LOOKBACK")
      continue
    }
    const seedAsOfDateKey = String(seedRow?.asOfDateKey ?? "").trim() || null
    const asOfIdx =
      seedAsOfDateKey != null ? Number(dateIndexMap.get(seedAsOfDateKey)) : expectedAsOfIdx
    if (!Number.isInteger(asOfIdx) || asOfIdx < 0) {
      bump(seedBuildStats.droppedCounts, "MISSING_AS_OF_INDEX")
      continue
    }
    if (asOfIdx !== expectedAsOfIdx) {
      throw new Error(
        [
          "Step-A seed as-of index does not match the Step-B featureAsOf contract.",
          `symbol=${symbol}`,
          `decisionDateKey=${decisionDateKey}`,
          `seedAsOfDateKey=${seedAsOfDateKey ?? "null"}`,
          `expectedAsOfDateKey=${String(series[expectedAsOfIdx]?.dateKey ?? "").trim() || "null"}`,
          `asOfShift=${asOfShift}`,
        ].join(" "),
      )
    }
    const targetIdx = asOfIdx + 1
    if (targetIdx < 1 || targetIdx >= series.length) {
      bump(seedBuildStats.droppedCounts, "MISSING_TARGET_INDEX")
      continue
    }
    const dedupeKey = `${symbol}:${decisionDateKey}`
    if (seenSeedDecisionKeys.has(dedupeKey)) {
      bump(seedBuildStats.droppedCounts, "DUPLICATE_SEED_DECISION")
      continue
    }
    seenSeedDecisionKeys.add(dedupeKey)
    const list = byDate.get(decisionDateKey) ?? []
    list.push({
      symbol,
      decisionIdx,
      asOfIdx,
      targetIdx,
      asOfDateKey: String(series[asOfIdx]?.dateKey ?? "").trim() || null,
      stepALaneId,
      impulseSourceDateKey: String(seedRow?.impulseSourceDateKey ?? "").trim() || null,
      impulseLookbackDays: Number(seedRow?.impulseLookbackDays ?? 0) || 0,
      impulseJumpPct: num(seedRow?.impulseJumpPct),
      impulseJumpPctFromPrevClose: num(seedRow?.impulseJumpPctFromPrevClose),
      impulseJumpPctFromOpen: num(seedRow?.impulseJumpPctFromOpen),
    })
    byDate.set(decisionDateKey, list)
    seedBuildStats.acceptedRows += 1
  }

  return {
    byDate,
    seedBuildStats,
  }
}

export const buildPerfectPrototypeDailyPack = async ({
  cwd,
  config,
  outDir,
  options = {},
}) => {
  if (!cwd || !config || !outDir) {
    throw new Error("buildPerfectPrototypeDailyPack requires cwd, config, and outDir")
  }
  const dataPaths = resolveDataPaths(cwd, config?.dataPaths)
  const serverPolicy = assertPerfectPrototypeServerDataPaths({
    dataPaths,
    cwd,
    toolName: "build_perfect_prototype_daily_pack",
  })
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      ...(options?.seedInputPath ? [{ label: "seedInputPath", filePath: options.seedInputPath }] : []),
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_daily_pack",
  })
  const localWindow = resolveLocalWindow(config)
  const globalWindow = resolveGlobalWindow(config)
  const minWindow = Math.max(localWindow, globalWindow)
  const asOfShift = resolveAsOfShift(config?.template?.featureAsOf)
  const entryRule = resolveEntryRule(config?.backtest?.entry)
  const holdDays = Math.max(1, Number(config?.backtest?.holdDays ?? 3) || 3)
  const targetPct = Number(config?.backtest?.targetPct ?? 0.08)
  const stopLossPct = Number(config?.backtest?.stopLossPct ?? 0.04)
  const feeBps = Number(config?.backtest?.feeBps ?? 0)
  const slippageBps = Number(config?.backtest?.slippageBps ?? 0)
  const costPct = (feeBps + slippageBps) / 10000
  const highJumpMode = String(config?.event?.highJumpMode ?? "FROM_OPEN_EX_GAP").trim().toUpperCase()
  const highJumpThreshold = Number(config?.event?.highJumpThreshold ?? 0.08)
  const negativeSampling = resolveNegativeSampling(config?.template?.negativeSampling)
  const limitRows = toInteger(options?.limitRows, null)
  const maxDecisionDates = toInteger(options?.maxDecisionDates, null)
  const maxRowsPerDate = toInteger(options?.maxRowsPerDate, null)
  const decisionDateSamplingMode =
    String(options?.decisionDateSamplingMode ?? "decision_date_stratified").trim().toLowerCase() ||
    "decision_date_stratified"
  const excludedDecisionDateSet = normalizeExcludedDecisionDates(options?.excludeDecisionDates)
  const symbolAllowSet = options?.symbolAllowSet instanceof Set ? options.symbolAllowSet : null
  const surfaceName =
    String(
      options?.surfaceName ??
        config?.lightweight?.stepB?.perfectPrototypeBaseline?.contextSurface ??
        PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
    )
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
  const sourceType = String(options?.sourceType ?? "perfect_prototype_daily_pack").trim() || "perfect_prototype_daily_pack"
  const baselineLineId =
    String(options?.lineId ?? config?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? "").trim() || null
  const requestedLookbackTradingDays =
    toInteger(
      options?.requestedLookbackTradingDays,
      toInteger(config?.event?.recentImpulseDiscovery?.lookbackTradingDays, null),
    ) ?? null
  const discoveryUniverse = resolvePerfectPrototypeDiscoveryUniverse({
    discoveryUniverseId:
      String(options?.discoveryUniverseId ?? PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN).trim() ||
      PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN,
    requestedLookbackTradingDays,
  })
  const enabledRecentImpulseLanesRaw = normalizeEnabledRecentImpulseLanes(options?.enabledRecentImpulseLanes)
  const enabledRecentImpulseLanes =
    enabledRecentImpulseLanesRaw.length > 0
      ? enabledRecentImpulseLanesRaw
      : discoveryUniverse.enabledRecentImpulseLanes
  const allowedStepALanesRaw = normalizeAllowedStepALanes(options?.allowedStepALanes)
  const allowedStepALanes =
    allowedStepALanesRaw.length > 0 ? allowedStepALanesRaw : discoveryUniverse.allowedStepALanes
  const seedInputPath = String(options?.seedInputPath ?? "").trim() ? path.resolve(String(options.seedInputPath)) : null
  if (discoveryUniverse.usesStepASeedInput && !seedInputPath) {
    throw new Error(
      `step-a-seeded discovery universe requires --seed-input: ${discoveryUniverse.discoveryUniverseId}`,
    )
  }
  if (discoveryUniverse.isAfreeOpenUniverse && seedInputPath) {
    throw new Error(
      "afree_open discovery universe must use the primary generic candidate-index path without --seed-input",
    )
  }
  if (discoveryUniverse.usesStepASeedInput && JSON.stringify(enabledRecentImpulseLanes) !== JSON.stringify(discoveryUniverse.enabledRecentImpulseLanes)) {
    throw new Error(
      [
        "discovery universe recent-impulse lanes must match the cumulative universe contract.",
        `discoveryUniverseId=${discoveryUniverse.discoveryUniverseId}`,
        `expected=${JSON.stringify(discoveryUniverse.enabledRecentImpulseLanes)}`,
        `actual=${JSON.stringify(enabledRecentImpulseLanes)}`,
      ].join(" "),
    )
  }
  if (discoveryUniverse.usesStepASeedInput && JSON.stringify(allowedStepALanes) !== JSON.stringify(discoveryUniverse.allowedStepALanes)) {
    throw new Error(
      [
        "discovery universe Step-A lane set must match the cumulative universe contract.",
        `discoveryUniverseId=${discoveryUniverse.discoveryUniverseId}`,
        `expected=${JSON.stringify(discoveryUniverse.allowedStepALanes)}`,
        `actual=${JSON.stringify(allowedStepALanes)}`,
      ].join(" "),
    )
  }

  const seedRows = seedInputPath ? await readJsonl(seedInputPath) : []
  const eventDateSetBySymbol = buildEventDateSetBySymbol(seedRows)
  const seedSymbolAllowSet =
    seedRows.length > 0
      ? new Set(
          seedRows
            .map((row) => String(row?.symbol ?? "").trim())
            .filter(Boolean),
        )
      : null
  const effectiveSymbolAllowSet = intersectSymbolAllowSets(symbolAllowSet, seedSymbolAllowSet)

  const data = await loadStepDEData(dataPaths, {
    symbolAllowSet: effectiveSymbolAllowSet,
    includeHourly60m: false,
  })
  const seriesMap = buildCandleSeriesMap(data.candles, effectiveSymbolAllowSet)
  const candleDateIndexMap = buildCandleDateIndexMap(seriesMap)
  const universeMap = buildUniverseMap(data.universe, effectiveSymbolAllowSet)
  const symbolMap = buildSymbolMasterMap(data.symbolMaster, effectiveSymbolAllowSet)
  const tradingDates = collectTradingDates(data.candles)
  const period = buildPeriod({
    tradingDates,
    startDate: options?.startDate ?? null,
    endDate: options?.endDate ?? null,
  })

  await ensureDir(outDir)
  const tempBasePath = path.join(outDir, "daily_pack_base.tmp.jsonl")
  const outputPath = path.join(outDir, "daily_pack.jsonl")
  const baseWriter = await createJsonlWriter(tempBasePath)

  const seedIndexResult = discoveryUniverse.usesStepASeedInput
    ? buildDecisionSeedIndexFromStepA({
        period,
        sequenceWindow: minWindow,
        asOfShift,
        seriesMap,
        candleDateIndexMap,
        seedRows,
        allowedStepALanes,
      })
    : {
        byDate: buildDecisionCandidateIndex({
          period,
          sequenceWindow: minWindow,
          asOfShift,
          seriesMap,
          symbolMap,
          universeMap,
          filtersCfg: config?.filters ?? {},
          stepALaneId: baselineLineId,
        }),
        seedBuildStats: {
          inputRows: 0,
          acceptedRows: 0,
          droppedCounts: {},
        },
      }
  const seedIndex = seedIndexResult.byDate
  const allSeedDecisionDates = Array.from(seedIndex.keys())
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
  const eligibleDecisionDates = allSeedDecisionDates.filter((dateKey) => !excludedDecisionDateSet.has(dateKey))
  const decisionDateSelection = selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions({
    partitions: eligibleDecisionDates.map((dateKey) => ({
      dateKey,
      rowCount: Number((seedIndex.get(dateKey) ?? []).length),
    })),
    maxDecisionDates,
    samplingMode: decisionDateSamplingMode,
  })
  const orderedDecisionDates = (decisionDateSelection.selectedPartitions ?? [])
    .map((partition) => String(partition?.dateKey ?? "").trim())
    .filter(Boolean)
  const contextRows = []
  const seriesFeatureCacheBySymbol = new Map()
  const rawSummary = {
    period,
    requestedPeriod: period,
    surface: surfaceName,
    sourceType,
    baselineLineId,
    discoveryUniverseId: discoveryUniverse.discoveryUniverseId,
    requestedLookbackTradingDays: discoveryUniverse.requestedLookbackTradingDays,
    enabledRecentImpulseLanes,
    allowedStepALanes,
    includeSameDayHigh8: discoveryUniverse.includeSameDayHigh8,
    seedMode: discoveryUniverse.isAfreeOpenUniverse
      ? "generic_candidate_index"
      : discoveryUniverse.isSameDayPlusRecentUniverse
        ? "step_a_seed_input_same_day_plus_recent"
        : "step_a_seed_input_recent_only",
    requiresLegacyNegativeSampling: discoveryUniverse.requiresLegacyNegativeSampling === true,
    legacyNegativeSampling:
      discoveryUniverse.requiresLegacyNegativeSampling === true
        ? negativeSampling
        : {
            enabled: false,
            maxNegativesPerPositive: 0,
            offsets: [],
          },
    seedInputPath,
    localWindow,
    globalWindow,
    asOfShift,
    limitRowsApplied: limitRows,
    truncatedByLimitRows: false,
    loadedRows: {
      candles: data.candles.length,
      universe: data.universe.length,
      symbolMaster: data.symbolMaster.length,
    },
    seedDecisionDates: orderedDecisionDates.length,
    sourceDecisionDateCount: allSeedDecisionDates.length,
    excludedDecisionDateCount: allSeedDecisionDates.length - eligibleDecisionDates.length,
    maxDecisionDatesApplied: maxDecisionDates,
    maxRowsPerDateApplied: maxRowsPerDate,
    decisionDateSamplingMode: decisionDateSelection.samplingMode,
    decisionDateSamplingApplied: decisionDateSelection.samplingApplied === true,
    selectedDecisionCoverage: decisionDateSelection.selectedDecisionCoverage,
    selectedDecisionDateCount: decisionDateSelection.selectedDecisionDateCount,
    selectedDecisionMonthCount: decisionDateSelection.selectedDecisionMonthCount,
    seedCount: 0,
    seedInputRows: seedIndexResult.seedBuildStats.inputRows,
    seedAcceptedRows: seedIndexResult.seedBuildStats.acceptedRows,
    seedDroppedCounts: seedIndexResult.seedBuildStats.droppedCounts,
    rowsWritten: 0,
    positiveSeedRowsWritten: 0,
    syntheticNegativeRows: 0,
    syntheticNegativeAttempts: 0,
    syntheticNegativeReasonCounts: {},
    templateKindCounts: {
      POSITIVE: 0,
      NEGATIVE: 0,
    },
    positiveRows: 0,
    negativeRows: 0,
    nullOutcomeRows: 0,
    uniqueSymbols: 0,
    dropCounts: {},
    truncatedByMaxRowsPerDate: false,
  }
  const writtenSymbols = new Set()
  const writtenDecisionDateKeys = new Set()
  const seenSyntheticNegativeTemplateIds = new Set()

  try {
    for (const decisionDateKey of orderedDecisionDates) {
      const seeds = seedIndex.get(decisionDateKey) ?? []
      let perDateRowsWritten = 0
      rawSummary.seedCount += seeds.length
      for (const seed of seeds) {
        if (limitRows && rawSummary.rowsWritten >= limitRows) {
          rawSummary.truncatedByLimitRows = true
          break
        }
        if (maxRowsPerDate && perDateRowsWritten >= maxRowsPerDate) {
          rawSummary.truncatedByMaxRowsPerDate = true
          break
        }
        const symbol = String(seed?.symbol ?? "").trim()
        if (!symbol) {
          bump(rawSummary.dropCounts, "MISSING_SYMBOL")
          continue
        }
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
        const universeRow = universeMap.get(`${symbol}:${seed.asOfDateKey}`)
        const eventMeta = buildPerfectPrototypeEventMetaFromSeries({
          series,
          decisionIdx: seed.decisionIdx,
          highJumpMode,
        })
        const featureBundle = buildPerfectPrototypeDecisionFeatureBundle({
          cache,
          series,
          asOfIdx: seed.asOfIdx,
          symbol,
          universeRow,
          localWindow,
          globalWindow,
          surfaceName,
          eventMeta,
          highJumpMode,
        })
        if (!featureBundle?.featureVec) {
          bump(rawSummary.dropCounts, "MISSING_FEATURE_VEC")
          continue
        }
        const eventOutcome = buildPerfectPrototypeDecisionOutcome({
          series,
          decisionIdx: seed.decisionIdx,
          entryRule,
          holdDays,
          targetPct,
          stopLossPct,
          costPct,
        })
        const baseRow = buildPerfectPrototypeDecisionRow({
          sourceType,
          sourceId: `${seed.symbol}:${decisionDateKey}`,
          symbol: seed.symbol,
          name: meta?.name ?? seed.symbol,
          dateKey: decisionDateKey,
          decisionDateKey,
          asOfDateKey: seed.asOfDateKey,
          targetDateKey,
          decisionIdx: seed.decisionIdx,
          asOfIdx: seed.asOfIdx,
          targetIdx: seed.targetIdx,
          localWindow,
          globalWindow,
          sequenceWindow: localWindow,
          featureVec: featureBundle.featureVec,
          globalFeatureVec: featureBundle.globalFeatureVec,
          eventMeta,
          eventFeatureVec: featureBundle.eventFeatureVec,
          stepALaneId: seed.stepALaneId ?? null,
          impulseSourceDateKey: seed.impulseSourceDateKey ?? null,
          impulseLookbackDays: seed.impulseLookbackDays ?? null,
          impulseJumpPct: seed.impulseJumpPct ?? null,
          impulseJumpPctFromPrevClose: seed.impulseJumpPctFromPrevClose ?? null,
          impulseJumpPctFromOpen: seed.impulseJumpPctFromOpen ?? null,
          seq40: featureBundle.seq40,
          seq150: featureBundle.seq150,
          eventOutcome,
          label: 1,
          templateKind: "POSITIVE",
          extraFields: {
            surfaceName,
            baselineLineId,
            discoveryUniverseId: discoveryUniverse.discoveryUniverseId,
            requestedLookbackTradingDays: discoveryUniverse.requestedLookbackTradingDays,
            enabledRecentImpulseLanes,
            allowedStepALanes,
            includeSameDayHigh8: discoveryUniverse.includeSameDayHigh8,
          },
        })
        await baseWriter.writeRow(baseRow)
        contextRows.push({
          dateKey: decisionDateKey,
          symbol,
          stepALaneId: seed.stepALaneId ?? null,
          eventMeta,
          eventFeatureVec: featureBundle.eventFeatureVec,
        })
        rawSummary.rowsWritten += 1
        perDateRowsWritten += 1
        rawSummary.positiveSeedRowsWritten += 1
        rawSummary.templateKindCounts.POSITIVE += 1
        writtenSymbols.add(symbol)
        writtenDecisionDateKeys.add(decisionDateKey)
        if (baseRow.outcomeHitTarget === true) {
          rawSummary.positiveRows += 1
        } else if (baseRow.outcomeHitTarget === false) {
          rawSummary.negativeRows += 1
        } else {
          rawSummary.nullOutcomeRows += 1
        }
        if (
          discoveryUniverse.requiresLegacyNegativeSampling === true &&
          negativeSampling.enabled === true &&
          negativeSampling.maxNegativesPerPositive > 0
        ) {
          const eventDateSet = eventDateSetBySymbol.get(symbol) ?? new Set()
          let generatedNegatives = 0
          for (const offset of negativeSampling.offsets) {
            if (generatedNegatives >= negativeSampling.maxNegativesPerPositive) break
            if (limitRows && rawSummary.rowsWritten >= limitRows) {
              rawSummary.truncatedByLimitRows = true
              break
            }
            if (maxRowsPerDate && perDateRowsWritten >= maxRowsPerDate) {
              rawSummary.truncatedByMaxRowsPerDate = true
              break
            }
            rawSummary.syntheticNegativeAttempts += 1
            const negDecisionIdx = seed.decisionIdx - offset
            if (!Number.isInteger(negDecisionIdx) || negDecisionIdx < 1) {
              bump(rawSummary.syntheticNegativeReasonCounts, "OFFSET_OUT_OF_RANGE")
              continue
            }
            const negDecisionDateKey = String(series[negDecisionIdx]?.dateKey ?? "").trim()
            if (!negDecisionDateKey) {
              bump(rawSummary.syntheticNegativeReasonCounts, "MISSING_NEG_DECISION_DATE")
              continue
            }
            if (!isInRange(negDecisionDateKey, period)) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_DATE_OUTSIDE_DISCOVERY")
              continue
            }
            if (eventDateSet.has(negDecisionDateKey)) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_DATE_IS_POSITIVE_EVENT")
              continue
            }
            const negativeTemplateId = `${symbol}:${negDecisionDateKey}:NEG`
            if (seenSyntheticNegativeTemplateIds.has(negativeTemplateId)) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_DUPLICATE_TEMPLATE")
              continue
            }
            const negAsOfIdx = negDecisionIdx - asOfShift
            if (negAsOfIdx < 1 || negAsOfIdx < localWindow || negAsOfIdx < globalWindow) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_SHORT_WINDOW")
              continue
            }
            const negTargetIdx = negAsOfIdx + 1
            if (negTargetIdx < 1 || negTargetIdx >= series.length) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_MISSING_TARGET_INDEX")
              continue
            }
            const negEventMetaBase = buildPerfectPrototypeEventMetaFromSeries({
              series,
              decisionIdx: negDecisionIdx,
              highJumpMode,
            })
            if (!negEventMetaBase || !Number.isFinite(num(negEventMetaBase.jumpPct))) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_JUMP_META_UNAVAILABLE")
              continue
            }
            if (negEventMetaBase.jumpPct >= highJumpThreshold) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_NOT_BELOW_EVENT_THRESHOLD")
              continue
            }
            const negAsOfDateKey = String(series[negAsOfIdx]?.dateKey ?? "").trim()
            if (!negAsOfDateKey) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_MISSING_ASOF_DATE")
              continue
            }
            const negEventMeta = {
              ...negEventMetaBase,
              sourceEventDate: decisionDateKey,
              sourceOffsetDays: offset,
            }
            const negUniverseRow = universeMap.get(`${symbol}:${negAsOfDateKey}`)
            const negFeatureBundle = buildPerfectPrototypeDecisionFeatureBundle({
              cache,
              series,
              asOfIdx: negAsOfIdx,
              symbol,
              universeRow: negUniverseRow,
              localWindow,
              globalWindow,
              surfaceName,
              eventMeta: negEventMeta,
              highJumpMode,
            })
            if (!negFeatureBundle?.featureVec) {
              bump(rawSummary.syntheticNegativeReasonCounts, "NEG_NO_FEATURE")
              continue
            }
            const negEventOutcome = buildPerfectPrototypeDecisionOutcome({
              series,
              decisionIdx: negDecisionIdx,
              entryRule,
              holdDays,
              targetPct,
              stopLossPct,
              costPct,
            })
            const negTargetDateKey = String(series[negTargetIdx]?.dateKey ?? "").trim() || null
            const negRow = buildPerfectPrototypeDecisionRow({
              sourceType,
              sourceId: negativeTemplateId,
              symbol: seed.symbol,
              name: meta?.name ?? seed.symbol,
              dateKey: negDecisionDateKey,
              decisionDateKey: negDecisionDateKey,
              asOfDateKey: negAsOfDateKey,
              targetDateKey: negTargetDateKey,
              decisionIdx: negDecisionIdx,
              asOfIdx: negAsOfIdx,
              targetIdx: negTargetIdx,
              localWindow,
              globalWindow,
              sequenceWindow: localWindow,
              featureVec: negFeatureBundle.featureVec,
              globalFeatureVec: negFeatureBundle.globalFeatureVec,
              eventMeta: negEventMeta,
              eventFeatureVec: negFeatureBundle.eventFeatureVec,
              stepALaneId: seed.stepALaneId ?? null,
              impulseSourceDateKey: seed.impulseSourceDateKey ?? null,
              impulseLookbackDays: seed.impulseLookbackDays ?? null,
              impulseJumpPct: seed.impulseJumpPct ?? null,
              impulseJumpPctFromPrevClose: seed.impulseJumpPctFromPrevClose ?? null,
              impulseJumpPctFromOpen: seed.impulseJumpPctFromOpen ?? null,
              seq40: negFeatureBundle.seq40,
              seq150: negFeatureBundle.seq150,
              eventOutcome: negEventOutcome,
              label: 0,
              templateKind: "NEGATIVE",
              extraFields: {
                surfaceName,
                baselineLineId,
                discoveryUniverseId: discoveryUniverse.discoveryUniverseId,
                requestedLookbackTradingDays: discoveryUniverse.requestedLookbackTradingDays,
                enabledRecentImpulseLanes,
                allowedStepALanes,
                includeSameDayHigh8: discoveryUniverse.includeSameDayHigh8,
              },
            })
            await baseWriter.writeRow(negRow)
            contextRows.push({
              dateKey: negDecisionDateKey,
              symbol,
              stepALaneId: seed.stepALaneId ?? null,
              eventMeta: negEventMeta,
              eventFeatureVec: negFeatureBundle.eventFeatureVec,
            })
            rawSummary.rowsWritten += 1
            perDateRowsWritten += 1
            rawSummary.syntheticNegativeRows += 1
            rawSummary.templateKindCounts.NEGATIVE += 1
            seenSyntheticNegativeTemplateIds.add(negativeTemplateId)
            writtenSymbols.add(symbol)
            writtenDecisionDateKeys.add(negDecisionDateKey)
            if (negRow.outcomeHitTarget === true) {
              rawSummary.positiveRows += 1
            } else if (negRow.outcomeHitTarget === false) {
              rawSummary.negativeRows += 1
            } else {
              rawSummary.nullOutcomeRows += 1
            }
            generatedNegatives += 1
          }
        }
      }
      if (limitRows && rawSummary.rowsWritten >= limitRows) {
        rawSummary.truncatedByLimitRows = true
        break
      }
    }
  } finally {
    await baseWriter.close()
  }

  const referenceMap = buildPerfectPrototypeContextReferenceMap(contextRows)
  const finalWriter = await createJsonlWriter(outputPath)
  const finalSummary = {
    ...rawSummary,
    uniqueSymbols: writtenSymbols.size,
    contextualDecisionDates: referenceMap.size,
    outputCoverage: buildDateCoverage(Array.from(writtenDecisionDateKeys)),
    coverageComplete:
      rawSummary.truncatedByLimitRows !== true &&
      rawSummary.truncatedByMaxRowsPerDate !== true &&
      rawSummary.decisionDateSamplingApplied !== true,
    outputPath,
    summaryPath: path.join(outDir, "summary.json"),
  }
  finalSummary.datasetContract = buildDailyPackDatasetContract({
    rowCount: finalSummary.rowsWritten,
    outputCoverage: finalSummary.outputCoverage,
    baselineLineId,
    discoveryUniverseId: discoveryUniverse.discoveryUniverseId,
    requestedLookbackTradingDays: discoveryUniverse.requestedLookbackTradingDays,
    enabledRecentImpulseLanes,
    allowedStepALanes,
    includeSameDayHigh8: discoveryUniverse.includeSameDayHigh8,
  })

  const stream = fs.createReadStream(tempBasePath, { encoding: "utf8" })
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })
  try {
    for await (const line of rl) {
      const text = String(line ?? "").trim()
      if (!text) continue
      let baseRow = null
      try {
        baseRow = JSON.parse(text)
      } catch {
        bump(finalSummary.dropCounts, "MALFORMED_BASE_ROW")
        continue
      }
      const reference = referenceMap.get(String(baseRow?.dateKey ?? "").trim()) ?? null
      const context = resolvePerfectPrototypeContextForRow({
        row: baseRow,
        reference,
        surfaceName,
      })
      await finalWriter.writeRow({
        ...baseRow,
        marketContextVec: context.marketContextVec,
        xsecEventVec: context.xsecEventVec,
        contextualTokens: context.contextualTokens,
      })
    }
  } finally {
    await finalWriter.close()
    rl.close()
    stream.close()
  }

  await fsp.rm(tempBasePath, { force: true })
  await writeJson(finalSummary.summaryPath, finalSummary)

  return {
    outputPath,
    summaryPath: finalSummary.summaryPath,
    summary: finalSummary,
  }
}
