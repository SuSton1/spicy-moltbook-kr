import path from "node:path"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import { isInRange } from "../lib/date.mjs"
import {
  buildCandleDateIndexMap,
  buildCandleSeriesMap,
  buildUniverseMap,
  loadStepBData
} from "../lib/data.mjs"
import {
  compactFeatureVec,
  normalizeOutputMode,
  quantizeSequence,
  resolveStepBInputPath,
  shouldWriteFull,
  shouldWriteLite
} from "../lib/lightweight.mjs"
import {
  resolveEntryRule,
  simulateTradeFromDecision
} from "../lib/trade_rules.mjs"
import {
  buildSeriesFeatureRuntimeCache,
} from "../lib/features.mjs"
import { buildPerfectPrototypeEventFeatureVec } from "../lib/perfect_prototype_event_features.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
  buildPerfectPrototypeContextReferenceMap,
  resolvePerfectPrototypeContextForRow,
} from "../lib/perfect_prototype_contextual_features.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../lib/perfect_prototype_prejump_contract.mjs"
import { createJsonlWriter, ensureDir, pathExists, readJsonl, writeJson } from "../lib/io.mjs"
import {
  buildPerfectPrototypeDecisionFeatureBundle,
  buildPerfectPrototypeDecisionOutcome,
  buildPerfectPrototypeDecisionRow,
} from "../lib/perfect_prototype_stepb_row_builder.mjs"

const releaseRows = (rows) => {
  if (Array.isArray(rows)) rows.length = 0
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const resolveHighJumpMode = (raw) => {
  const mode = String(raw ?? "FROM_OPEN_EX_GAP").trim().toUpperCase()
  if (mode === "FROM_PREV_CLOSE") return mode
  return "FROM_OPEN_EX_GAP"
}

const resolveNegativeSampling = (raw) => {
  const offsets = Array.isArray(raw?.offsets)
    ? raw.offsets.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
    : [5, 10, 20]
  return {
    enabled: raw?.enabled !== false,
    maxNegativesPerPositive: Math.max(0, Number(raw?.maxNegativesPerPositive ?? 1) || 1),
    offsets: offsets.length ? offsets : [5, 10, 20]
  }
}

const calcDecisionJumpMeta = ({ series, decisionIdx, highJumpMode }) => {
  if (!Array.isArray(series)) return null
  if (!Number.isInteger(decisionIdx) || decisionIdx < 1 || decisionIdx >= series.length) return null
  const today = series[decisionIdx]
  const prev = series[decisionIdx - 1]
  const prevClose = num(prev?.close)
  const open = num(today?.open)
  const high = num(today?.high)
  const close = num(today?.close)
  if (!Number.isFinite(prevClose) || prevClose <= 0 || !Number.isFinite(high)) return null
  if (highJumpMode === "FROM_OPEN_EX_GAP" && (!Number.isFinite(open) || open <= 0)) return null
  const jumpBase = highJumpMode === "FROM_PREV_CLOSE" ? prevClose : open
  if (!Number.isFinite(jumpBase) || jumpBase <= 0) return null
  return {
    jumpPct: high / jumpBase - 1,
    jumpPctFromPrevClose: high / prevClose - 1,
    jumpPctFromOpen: Number.isFinite(open) && open > 0 ? high / open - 1 : null,
    closeRetPct: Number.isFinite(close) ? close / prevClose - 1 : null,
    gapOpenPct: Number.isFinite(open) ? open / prevClose - 1 : null
  }
}

const bump = (obj, key) => {
  obj[key] = Number(obj[key] ?? 0) + 1
}

export const PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE = "STEPB_DPLUS1_BASELINE_V1"
export const PERFECT_PROTOTYPE_STEPB_BASELINE_EXACT_COLLECTION_MODE = "train_precision_1_only"
export const PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID = "stepb_dplus1_plus_lite"
export const PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID = "stepb_dplus1_plus_lite_lane_local"
export const PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID =
  "stepb_dplus1_plus_lite_recent_mid_low"
const PERFECT_PROTOTYPE_STEPB_NO_GAP_LINE_IDS = new Set([
  "stepb_dplus1_baseline",
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID,
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID,
  PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID,
])
const PERFECT_PROTOTYPE_STEPB_ALLOWED_CONTEXT_SURFACES = new Set([
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE,
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
])
const PERFECT_PROTOTYPE_STEPB_BASELINE_REQUIRED_FIELDS = [
  "contractVersion",
  "lineId",
  "strategyMode",
  "contextSurface",
  "entryRule",
  "holdDays",
  "targetPct",
  "stopLossPct",
  "featureAsOf",
  "exactCollectionMode",
  "maxGapTradingDays",
]

const buildDefaultPerfectPrototypeStepBRuntimeContract = (config) => ({
  enabled: false,
  contractVersion: null,
  lineId: null,
  strategyMode: null,
  contextSurface: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  entryRule: resolveEntryRule(config?.backtest?.entry),
  holdDays: Math.max(1, Math.floor(Number(config?.backtest?.holdDays ?? 3) || 3)),
  targetPct: Number(config?.backtest?.targetPct ?? 0.08),
  stopLossPct: Number(config?.backtest?.stopLossPct ?? 0.04),
  featureAsOf: String(config?.template?.featureAsOf ?? "t-1").trim().toLowerCase() || "t-1",
  splitPolicy: null,
  exactCollectionMode: null,
  maxGapTradingDays: null,
})

const buildPerfectPrototypeStepBContractFields = (contract) => ({
  strategyMode: contract?.strategyMode ?? null,
  contextSurface: contract?.contextSurface ?? null,
  baselineLineId: contract?.lineId ?? null,
  baselineContractVersion:
    contract?.contractVersion == null ? null : Math.max(1, Math.floor(Number(contract.contractVersion) || 1)),
  splitPolicy: contract?.splitPolicy ?? null,
  entryRule: String(contract?.entryRule?.mode ?? "").trim() || null,
  holdDays:
    contract?.holdDays == null ? null : Math.max(1, Math.floor(Number(contract.holdDays) || 0)),
  targetPct: Number.isFinite(Number(contract?.targetPct)) ? Number(contract.targetPct) : null,
  stopLossPct: Number.isFinite(Number(contract?.stopLossPct)) ? Number(contract.stopLossPct) : null,
  featureAsOf: String(contract?.featureAsOf ?? "").trim().toLowerCase() || null,
  exactCollectionMode: String(contract?.exactCollectionMode ?? "").trim().toLowerCase() || null,
  maxGapTradingDays:
    Number.isFinite(Number(contract?.maxGapTradingDays)) ? Number(contract.maxGapTradingDays) : null,
})

const assertValidPerfectPrototypeStepBBaselineContract = (contract, config = null) => {
  if (!contract) return null
  const issues = []
  const contractVersion = Number(contract?.contractVersion)
  const contextSurface = String(contract?.contextSurface ?? "").trim().toLowerCase()
  const strategyMode = String(contract?.strategyMode ?? "").trim().toUpperCase()
  const lineId = String(contract?.lineId ?? "").trim()
  const featureAsOf = String(contract?.featureAsOf ?? "").trim().toLowerCase()
  const exactCollectionMode = String(contract?.exactCollectionMode ?? "").trim().toLowerCase()
  const maxGapTradingDays = Number(contract?.maxGapTradingDays)
  const holdDays = Number(contract?.holdDays)
  const targetPct = Number(contract?.targetPct)
  const stopLossPct = Number(contract?.stopLossPct)
  const entryRuleMode = String(contract?.entryRule?.mode ?? "").trim().toUpperCase()
  const configFeatureAsOf = String(config?.template?.featureAsOf ?? "").trim().toLowerCase()
  const configEntryRuleMode = String(resolveEntryRule(config?.backtest?.entry)?.mode ?? "").trim().toUpperCase()
  const configHoldDays = Number(config?.backtest?.holdDays)
  const configTargetPct = Number(config?.backtest?.targetPct)
  const configStopLossPct = Number(config?.backtest?.stopLossPct)

  if (!Number.isInteger(Math.floor(contractVersion)) || contractVersion < 2) {
    issues.push(`Step-B D+1 baseline requires contractVersion>=2, got ${contract?.contractVersion}`)
  }
  if (strategyMode !== PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE) {
    issues.push(
      `Step-B D+1 baseline only supports strategyMode=${PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE}, got ${strategyMode || "unknown"}`,
    )
  }
  if (!lineId) {
    issues.push("Step-B D+1 baseline requires a non-empty lineId")
  }

  if (!PERFECT_PROTOTYPE_STEPB_ALLOWED_CONTEXT_SURFACES.has(contextSurface)) {
    issues.push(
      `Step-B D+1 baseline only supports contextSurface in {${Array.from(PERFECT_PROTOTYPE_STEPB_ALLOWED_CONTEXT_SURFACES).join(", ")}}, got ${contextSurface || "unknown"}`,
    )
  }
  if (contextSurface === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE) {
    issues.push("Step-B D+1 baseline cannot use predictive prejump context surface")
  }
  if (strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
    issues.push("Step-B D+1 baseline cannot use predictive strategyMode")
  }
  if (entryRuleMode !== "NEXT_DAY_OPEN") {
    issues.push(`Step-B D+1 baseline only supports entryRule=NEXT_DAY_OPEN, got ${entryRuleMode || "unknown"}`)
  }
  if (!Number.isInteger(Math.floor(holdDays)) || holdDays < 1) {
    issues.push(`Step-B D+1 baseline requires holdDays>=1 integer, got ${contract?.holdDays}`)
  }
  if (!Number.isFinite(targetPct) || targetPct < 0) {
    issues.push(`Step-B D+1 baseline requires finite targetPct>=0, got ${contract?.targetPct}`)
  }
  if (!Number.isFinite(stopLossPct) || stopLossPct < 0) {
    issues.push(`Step-B D+1 baseline requires finite stopLossPct>=0, got ${contract?.stopLossPct}`)
  }
  if (featureAsOf !== "t-1") {
    issues.push(`Step-B D+1 baseline only supports featureAsOf=t-1, got ${featureAsOf || "unknown"}`)
  }
  if (exactCollectionMode !== PERFECT_PROTOTYPE_STEPB_BASELINE_EXACT_COLLECTION_MODE) {
    issues.push(
      `Step-B D+1 baseline only supports exactCollectionMode=${PERFECT_PROTOTYPE_STEPB_BASELINE_EXACT_COLLECTION_MODE}, got ${exactCollectionMode || "unknown"}`,
    )
  }
  if (lineId === "stepb_dplus1_baseline" && contextSurface !== PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE) {
    issues.push(
      `stepb_dplus1_baseline only supports contextSurface=${PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE}, got ${contextSurface || "unknown"}`,
    )
  }
  if (
    lineId === PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID &&
    contextSurface !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE
  ) {
    issues.push(
      `${PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LINE_ID} only supports contextSurface=${PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE}, got ${contextSurface || "unknown"}`,
    )
  }
  if (
    lineId === PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID &&
    contextSurface !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE
  ) {
    issues.push(
      `${PERFECT_PROTOTYPE_STEPB_PLUS_LITE_LANE_LOCAL_LINE_ID} only supports contextSurface=${PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE}, got ${contextSurface || "unknown"}`,
    )
  }
  if (
    lineId === PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID &&
    contextSurface !== PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE
  ) {
    issues.push(
      `${PERFECT_PROTOTYPE_STEPB_PLUS_LITE_RECENT_MID_LOW_LINE_ID} only supports contextSurface=${PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE}, got ${contextSurface || "unknown"}`,
    )
  }
  if (!Number.isInteger(Math.floor(maxGapTradingDays)) || maxGapTradingDays < 0) {
    issues.push(
      `Step-B D+1 baseline requires explicit maxGapTradingDays>=0 integer, got ${contract?.maxGapTradingDays}`,
    )
  }
  if (PERFECT_PROTOTYPE_STEPB_NO_GAP_LINE_IDS.has(lineId) && maxGapTradingDays !== 100000) {
    issues.push(
      `Step-B D+1 no-gap line only supports maxGapTradingDays=100000, got ${contract?.maxGapTradingDays}`,
    )
  }
  if (configFeatureAsOf && configFeatureAsOf !== featureAsOf) {
    issues.push(
      `Step-B D+1 baseline requires template.featureAsOf=${featureAsOf}, got ${config?.template?.featureAsOf}`,
    )
  }
  if (configEntryRuleMode && configEntryRuleMode !== entryRuleMode) {
    issues.push(
      `Step-B D+1 baseline requires backtest.entry=${entryRuleMode}, got ${config?.backtest?.entry}`,
    )
  }
  if (Number.isFinite(configHoldDays) && configHoldDays !== holdDays) {
    issues.push(
      `Step-B D+1 baseline requires backtest.holdDays=${holdDays}, got ${config?.backtest?.holdDays}`,
    )
  }
  if (Number.isFinite(configTargetPct) && configTargetPct !== targetPct) {
    issues.push(
      `Step-B D+1 baseline requires backtest.targetPct=${targetPct}, got ${config?.backtest?.targetPct}`,
    )
  }
  if (Number.isFinite(configStopLossPct) && configStopLossPct !== stopLossPct) {
    issues.push(
      `Step-B D+1 baseline requires backtest.stopLossPct=${stopLossPct}, got ${config?.backtest?.stopLossPct}`,
    )
  }

  if (issues.length > 0) {
    throw new Error(issues.join(" | "))
  }

  return {
    ...contract,
    contextSurface,
    strategyMode,
    entryRule: resolveEntryRule(entryRuleMode),
    holdDays: Math.max(1, Math.floor(holdDays)),
    targetPct,
    stopLossPct,
    featureAsOf,
    exactCollectionMode,
    maxGapTradingDays,
  }
}

export const resolvePerfectPrototypeStepBBaselineContract = (config) => {
  const raw = config?.lightweight?.stepB?.perfectPrototypeBaseline
  if (!raw || raw.enabled === false) return null
  const missingFields = PERFECT_PROTOTYPE_STEPB_BASELINE_REQUIRED_FIELDS.filter((field) => {
    if (field === "entryRule") {
      return !String(raw?.entryRule ?? "").trim()
    }
    return !String(raw?.[field] ?? "").trim()
  })
  if (missingFields.length > 0) {
    throw new Error(
      `Step-B D+1 baseline contract is missing required field(s): ${missingFields.join(", ")}`,
    )
  }
  const contractVersion = Math.max(1, Math.floor(Number(raw?.contractVersion ?? 1) || 1))
  const lineId =
    String(raw?.lineId)
      .trim() || "stepb_dplus1_baseline"
  const contextSurface =
    String(raw?.contextSurface)
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
  const strategyMode =
    String(raw?.strategyMode)
      .trim()
      .toUpperCase() || PERFECT_PROTOTYPE_STEPB_BASELINE_STRATEGY_MODE
  const splitPolicy = String(raw?.splitPolicy ?? "").trim().toLowerCase() || null
  return {
    enabled: true,
    contractVersion,
    lineId,
    strategyMode,
    contextSurface,
    entryRule: resolveEntryRule(raw?.entryRule),
    holdDays: Math.max(1, Number(raw?.holdDays) || 3),
    targetPct: Number(raw?.targetPct),
    stopLossPct: Number(raw?.stopLossPct),
    featureAsOf: String(raw?.featureAsOf).trim().toLowerCase(),
    splitPolicy,
    exactCollectionMode: String(raw?.exactCollectionMode).trim().toLowerCase(),
    maxGapTradingDays: Number(raw?.maxGapTradingDays),
  }
}

export const runStepB = async (ctx) => {
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const { inPath, mode: inputMode } = resolveStepBInputPath({
    runDir: ctx.runDir,
    lightweightCfg,
    preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
  })
  if (!pathExists(inPath)) {
    throw new Error(`Step B input file not found: ${inPath}`)
  }
  const events = await readJsonl(inPath)
  const outDir = path.join(ctx.runDir, "step-b")
  await ensureDir(outDir)
  const eventSymbols = new Set(
    events
      .map((row) => String(row?.symbol ?? "").trim())
      .filter((symbol) => symbol.length > 0),
  )

  const data = await loadStepBData(ctx.config.dataPaths, {
    symbolAllowSet: eventSymbols
  })
  const seriesMap = buildCandleSeriesMap(data.candles, eventSymbols)
  const dateIdxMap = buildCandleDateIndexMap(seriesMap)
  const universeMap = buildUniverseMap(data.universe, eventSymbols)
  const datasetRows = {
    candles: data.candles.length,
    universe: data.universe.length
  }
  releaseRows(data.candles)
  releaseRows(data.universe)

  const localWindow = resolveLocalWindow(ctx.config)
  const globalWindow = resolveGlobalWindow(ctx.config)
  const minWindow = Math.max(localWindow, globalWindow)
  const outputMode = normalizeOutputMode(lightweightCfg?.stepB?.outputMode, "both")
  const writeFull = shouldWriteFull(outputMode)
  const writeLite = shouldWriteLite(outputMode)
  const roundFeatureDigits = Number(lightweightCfg?.stepB?.roundFeatureDigits ?? 6)
  const quantizeSeqScale = Number(lightweightCfg?.stepB?.quantizeSeqScale ?? 10000)
  const writeRuntimePack = lightweightCfg?.stepB?.runtimePack?.enabled !== false
  const baselineContract = assertValidPerfectPrototypeStepBBaselineContract(
    resolvePerfectPrototypeStepBBaselineContract(ctx.config),
    ctx.config,
  )
  const runtimeContract = baselineContract ?? buildDefaultPerfectPrototypeStepBRuntimeContract(ctx.config)
  const runtimeContractFields = buildPerfectPrototypeStepBContractFields(runtimeContract)
  const contextSurface = runtimeContract.contextSurface ?? PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
  const holdDays = runtimeContract.holdDays
  const targetPct = runtimeContract.targetPct
  const stopLossPct = runtimeContract.stopLossPct
  const feeBps = Number(ctx.config.backtest?.feeBps ?? 0)
  const slippageBps = Number(ctx.config.backtest?.slippageBps ?? 0)
  const costPct = (feeBps + slippageBps) / 10000
  const entryRule = runtimeContract.entryRule
  const asOfTradingOffsetDays = runtimeContract.featureAsOf === "t-1" ? 1 : null
  if (!Number.isInteger(asOfTradingOffsetDays) || asOfTradingOffsetDays < 1) {
    throw new Error(
      `Step B runtime only supports featureAsOf=t-1, got ${runtimeContract.featureAsOf ?? "unknown"}`,
    )
  }
  const highJumpMode = resolveHighJumpMode(ctx.config.event?.highJumpMode)
  const highThreshold = Number(ctx.config.event?.highJumpThreshold ?? 0.08)
  const negativeSampling = resolveNegativeSampling(ctx.config.template?.negativeSampling)
  const templatesPath = writeFull ? path.join(outDir, "templates.jsonl") : null
  const templatesLitePath = writeLite ? path.join(outDir, "templates_lite.jsonl") : null
  const runtimePackPath = writeRuntimePack ? path.join(outDir, "templates_runtime_pack.jsonl") : null
  const fullWriter = writeFull ? await createJsonlWriter(templatesPath) : null
  const liteWriter = writeLite ? await createJsonlWriter(templatesLitePath) : null
  const runtimeWriter = writeRuntimePack ? await createJsonlWriter(runtimePackPath) : null

  let templates = 0
  let droppedNoSeries = 0
  let droppedNoAsOf = 0
  let droppedShortLocalWindow = 0
  let droppedShortGlobalWindow = 0
  let droppedNoFeature = 0
  let templatesWithEventOutcome = 0
  let positiveTemplates = 0
  let negativeTemplates = 0
  let negativeAttempts = 0
  const negativeReasonCounts = {}
  const seenNegativeTemplateIds = new Set()
  const seriesFeatureCacheBySymbol = new Map()
  const eventDateSetBySymbol = new Map()
  for (const row of events) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!symbol || !dateKey) continue
    const set = eventDateSetBySymbol.get(symbol) ?? new Set()
    set.add(dateKey)
    eventDateSetBySymbol.set(symbol, set)
  }
  const eventContextReferenceMap = buildPerfectPrototypeContextReferenceMap(events)

  const writeTemplate = async ({
    templateId,
    symbol,
    eventDate,
    asOfDate,
    name,
    featureVec,
    globalFeatureVec,
    seq40,
    seq150,
    eventMeta,
    eventFeatureVec,
    marketContextVec,
    xsecEventVec,
    contextualTokens,
    stepALaneId = null,
    impulseSourceDateKey = null,
    impulseLookbackDays = null,
    impulseJumpPct = null,
    impulseJumpPctFromPrevClose = null,
    impulseJumpPctFromOpen = null,
    eventOutcome,
    label,
    templateKind
  }) => {
    const fullRow = buildPerfectPrototypeDecisionRow({
      sourceType: "perfect_prototype_stepb_template",
      sourceId: templateId,
      templateId,
      symbol,
      name,
      eventDate,
      asOfDate,
      asOfDateKey: asOfDate,
      decisionIdx: null,
      asOfIdx: null,
      sequenceWindow: localWindow,
      localWindow,
      globalWindow,
      featureVec,
      globalFeatureVec,
      eventMeta,
      eventFeatureVec,
      marketContextVec,
      xsecEventVec,
      contextualTokens,
      stepALaneId,
      impulseSourceDateKey,
      impulseLookbackDays,
      impulseJumpPct,
      impulseJumpPctFromPrevClose,
      impulseJumpPctFromOpen,
      seq40,
      seq150,
      eventOutcome,
      label,
      templateKind,
      extraFields: runtimeContractFields,
    })
    if (fullWriter) {
      await fullWriter.writeRow(fullRow)
    }
    if (liteWriter) {
      await liteWriter.writeRow({
        ...fullRow,
        featureVec: compactFeatureVec(fullRow.featureVec, roundFeatureDigits),
        globalFeatureVec: compactFeatureVec(fullRow.globalFeatureVec, roundFeatureDigits),
        seq40q: quantizeSequence(fullRow.seq40, quantizeSeqScale),
        seq40Scale: quantizeSeqScale,
        seq150q: quantizeSequence(fullRow.seq150, quantizeSeqScale),
        seq150Scale: quantizeSeqScale,
        eventFeatureVec: compactFeatureVec(fullRow.eventFeatureVec, roundFeatureDigits),
        marketContextVec: compactFeatureVec(fullRow.marketContextVec, roundFeatureDigits),
        xsecEventVec: compactFeatureVec(fullRow.xsecEventVec, roundFeatureDigits),
        contextualTokens: Array.isArray(fullRow.contextualTokens) ? fullRow.contextualTokens : [],
      })
    }
    if (runtimeWriter) {
      await runtimeWriter.writeRow(fullRow)
    }
  }

  try {
    for (const event of events) {
      const symbol = String(event?.symbol ?? "").trim()
      const eventDate = String(event?.dateKey ?? "").trim()
      if (!symbol || !eventDate) continue

      const series = seriesMap.get(symbol)
      const dateIdx = dateIdxMap.get(symbol)
      const eventIdx = dateIdx?.get(eventDate)
      if (!series || !Number.isInteger(eventIdx)) {
        droppedNoSeries += 1
        continue
      }
      const asOfIdx = eventIdx - asOfTradingOffsetDays
      if (asOfIdx < 1) {
        droppedNoAsOf += 1
        continue
      }

      if (asOfIdx < localWindow) {
        droppedShortLocalWindow += 1
        continue
      }
      if (asOfIdx < globalWindow) {
        droppedShortGlobalWindow += 1
        continue
      }

      const asOfDate = series[asOfIdx].dateKey
      const universeRow = universeMap.get(`${symbol}:${asOfDate}`)
      let seriesFeatureCache = seriesFeatureCacheBySymbol.get(symbol) ?? null
      if (!seriesFeatureCache) {
        seriesFeatureCache = buildSeriesFeatureRuntimeCache(series)
        seriesFeatureCacheBySymbol.set(symbol, seriesFeatureCache)
      }

      const featureBundle = buildPerfectPrototypeDecisionFeatureBundle({
        cache: seriesFeatureCache,
        series,
        asOfIdx,
        symbol,
        universeRow,
        localWindow,
        globalWindow,
        surfaceName: contextSurface,
        eventMeta: {
          jumpPct: event?.jumpPct ?? null,
          jumpPctFromPrevClose: event?.jumpPctFromPrevClose ?? null,
          jumpPctFromOpen: event?.jumpPctFromOpen ?? null,
          closeRetPct: event?.closeRetPct ?? null,
          gapOpenPct: event?.gapOpenPct ?? null,
          stepALaneId: event?.stepALaneId ?? null,
          impulseSourceDateKey: event?.impulseSourceDateKey ?? null,
          impulseLookbackDays: event?.impulseLookbackDays ?? null,
          impulseJumpPct: event?.impulseJumpPct ?? null,
          impulseJumpPctFromPrevClose: event?.impulseJumpPctFromPrevClose ?? null,
          impulseJumpPctFromOpen: event?.impulseJumpPctFromOpen ?? null,
        },
        highJumpMode,
      })
      if (!featureBundle?.featureVec) {
        droppedNoFeature += 1
        continue
      }
      const templateId = `${symbol}:${eventDate}`
      const eventMeta = {
        jumpPct: event?.jumpPct ?? null,
        jumpPctFromPrevClose: event?.jumpPctFromPrevClose ?? null,
        jumpPctFromOpen: event?.jumpPctFromOpen ?? null,
        closeRetPct: event?.closeRetPct ?? null,
        gapOpenPct: event?.gapOpenPct ?? null,
        stepALaneId: event?.stepALaneId ?? null,
        impulseSourceDateKey: event?.impulseSourceDateKey ?? null,
        impulseLookbackDays: event?.impulseLookbackDays ?? null,
        impulseJumpPct: event?.impulseJumpPct ?? null,
        impulseJumpPctFromPrevClose: event?.impulseJumpPctFromPrevClose ?? null,
        impulseJumpPctFromOpen: event?.impulseJumpPctFromOpen ?? null,
      }
      const eventFeatureVec = featureBundle.eventFeatureVec ?? buildPerfectPrototypeEventFeatureVec(eventMeta, {
        highJumpMode,
      })
      const eventContext = resolvePerfectPrototypeContextForRow({
        row: {
          symbol,
          dateKey: eventDate,
          stepALaneId: event?.stepALaneId ?? null,
          eventMeta,
          eventFeatureVec,
        },
        reference: eventContextReferenceMap.get(eventDate) ?? null,
        surfaceName: contextSurface,
      })
      const eventOutcome = buildPerfectPrototypeDecisionOutcome({
        series,
        decisionIdx: eventIdx,
        entryRule,
        holdDays,
        targetPct,
        stopLossPct,
        costPct
      })
      if (eventOutcome) templatesWithEventOutcome += 1

      await writeTemplate({
        templateId,
        symbol,
        eventDate,
        asOfDate,
        name: event?.name ?? symbol,
        featureVec: featureBundle.featureVec,
        globalFeatureVec: featureBundle.globalFeatureVec,
        seq40: featureBundle.seq40,
        seq150: featureBundle.seq150,
        eventMeta,
        eventFeatureVec,
        marketContextVec: eventContext.marketContextVec,
        xsecEventVec: eventContext.xsecEventVec,
        contextualTokens: eventContext.contextualTokens,
        stepALaneId: event?.stepALaneId ?? null,
        impulseSourceDateKey: event?.impulseSourceDateKey ?? null,
        impulseLookbackDays: event?.impulseLookbackDays ?? null,
        impulseJumpPct: event?.impulseJumpPct ?? null,
        impulseJumpPctFromPrevClose: event?.impulseJumpPctFromPrevClose ?? null,
        impulseJumpPctFromOpen: event?.impulseJumpPctFromOpen ?? null,
        eventOutcome,
        label: 1,
        templateKind: "POSITIVE"
      })
      templates += 1
      positiveTemplates += 1

      if (!negativeSampling.enabled || negativeSampling.maxNegativesPerPositive < 1) {
        continue
      }
      const eventDateSet = eventDateSetBySymbol.get(symbol) ?? new Set()
      let generatedNegatives = 0
      for (const offset of negativeSampling.offsets) {
        if (generatedNegatives >= negativeSampling.maxNegativesPerPositive) break
        negativeAttempts += 1
        const negDecisionIdx = eventIdx - offset
        if (!Number.isInteger(negDecisionIdx) || negDecisionIdx < 1) {
          bump(negativeReasonCounts, "OFFSET_OUT_OF_RANGE")
          continue
        }
        const negDecisionDate = String(series[negDecisionIdx]?.dateKey ?? "").trim()
        if (!negDecisionDate) {
          bump(negativeReasonCounts, "MISSING_NEG_DECISION_DATE")
          continue
        }
        if (!isInRange(negDecisionDate, ctx.periods.discovery)) {
          bump(negativeReasonCounts, "NEG_DATE_OUTSIDE_DISCOVERY")
          continue
        }
        if (eventDateSet.has(negDecisionDate)) {
          bump(negativeReasonCounts, "NEG_DATE_IS_POSITIVE_EVENT")
          continue
        }
        const negTemplateId = `${symbol}:${negDecisionDate}:NEG`
        if (seenNegativeTemplateIds.has(negTemplateId)) {
          bump(negativeReasonCounts, "NEG_DUPLICATE_TEMPLATE")
          continue
        }
        const negAsOfIdx = negDecisionIdx - asOfTradingOffsetDays
        if (negAsOfIdx < 1 || negAsOfIdx < localWindow || negAsOfIdx < globalWindow) {
          bump(negativeReasonCounts, "NEG_SHORT_WINDOW")
          continue
        }
        const jumpMeta = calcDecisionJumpMeta({
          series,
          decisionIdx: negDecisionIdx,
          highJumpMode
        })
        if (!jumpMeta || !Number.isFinite(jumpMeta.jumpPct)) {
          bump(negativeReasonCounts, "NEG_JUMP_META_UNAVAILABLE")
          continue
        }
        if (jumpMeta.jumpPct >= highThreshold) {
          bump(negativeReasonCounts, "NEG_NOT_BELOW_EVENT_THRESHOLD")
          continue
        }
        const negAsOfDate = String(series[negAsOfIdx]?.dateKey ?? "").trim()
        if (!negAsOfDate) {
          bump(negativeReasonCounts, "NEG_MISSING_ASOF_DATE")
          continue
        }
        const negUniverseRow = universeMap.get(`${symbol}:${negAsOfDate}`)
        const negEventMeta = {
          ...jumpMeta,
          sourceEventDate: eventDate,
          sourceOffsetDays: offset,
          stepALaneId: event?.stepALaneId ?? null,
          impulseSourceDateKey: event?.impulseSourceDateKey ?? null,
          impulseLookbackDays: event?.impulseLookbackDays ?? null,
          impulseJumpPct: event?.impulseJumpPct ?? null,
          impulseJumpPctFromPrevClose: event?.impulseJumpPctFromPrevClose ?? null,
          impulseJumpPctFromOpen: event?.impulseJumpPctFromOpen ?? null,
        }
        const negFeatureBundle = buildPerfectPrototypeDecisionFeatureBundle({
          cache: seriesFeatureCache,
          series,
          asOfIdx: negAsOfIdx,
          symbol,
          universeRow: negUniverseRow,
          localWindow,
          globalWindow,
          surfaceName: contextSurface,
          eventMeta: negEventMeta,
          highJumpMode,
        })
        if (!negFeatureBundle?.featureVec) {
          bump(negativeReasonCounts, "NEG_NO_FEATURE")
          continue
        }
        const negEventFeatureVec = negFeatureBundle.eventFeatureVec ?? buildPerfectPrototypeEventFeatureVec(negEventMeta, {
          highJumpMode,
        })
        const negEventContext = resolvePerfectPrototypeContextForRow({
          row: {
            symbol,
            dateKey: negDecisionDate,
            stepALaneId: event?.stepALaneId ?? null,
            eventMeta: negEventMeta,
            eventFeatureVec: negEventFeatureVec,
          },
          reference: eventContextReferenceMap.get(negDecisionDate) ?? null,
          surfaceName: contextSurface,
        })
        const negEventOutcome = buildPerfectPrototypeDecisionOutcome({
          series,
          decisionIdx: negDecisionIdx,
          entryRule,
          holdDays,
          targetPct,
          stopLossPct,
          costPct
        })
        if (negEventOutcome) templatesWithEventOutcome += 1
        await writeTemplate({
          templateId: negTemplateId,
          symbol,
          eventDate: negDecisionDate,
          asOfDate: negAsOfDate,
          name: event?.name ?? symbol,
          featureVec: negFeatureBundle.featureVec,
          globalFeatureVec: negFeatureBundle.globalFeatureVec,
          seq40: negFeatureBundle.seq40,
          seq150: negFeatureBundle.seq150,
          eventMeta: negEventMeta,
          eventFeatureVec: negEventFeatureVec,
          marketContextVec: negEventContext.marketContextVec,
          xsecEventVec: negEventContext.xsecEventVec,
          contextualTokens: negEventContext.contextualTokens,
          eventOutcome: negEventOutcome,
          label: 0,
          templateKind: "NEGATIVE"
        })
        seenNegativeTemplateIds.add(negTemplateId)
        templates += 1
        negativeTemplates += 1
        generatedNegatives += 1
      }
    }
  } finally {
    if (fullWriter) await fullWriter.close()
    if (liteWriter) await liteWriter.close()
    if (runtimeWriter) await runtimeWriter.close()
  }

  const summary = {
    step: "B",
    inputMode,
    inputPath: inPath,
    outputMode,
    inputEvents: events.length,
    templates,
    droppedNoSeries,
    droppedNoAsOf,
    droppedShortLocalWindow,
    droppedShortGlobalWindow,
    droppedNoFeature,
    templatesWithEventOutcome,
    positiveTemplates,
    negativeTemplates,
    negativeSampling,
    negativeAttempts,
    negativeReasonCounts,
    localWindow,
    globalWindow,
    minWindow,
    roundFeatureDigits,
    quantizeSeqScale,
    ...runtimeContractFields,
    perfectPrototypeFeatureSurface: contextSurface,
    perfectPrototypeBaselineContract: baselineContract,
    datasetRows,
    outputs: {
      templatesPath,
      templatesLitePath,
      runtimePackPath
    }
  }

  const summaryPath = path.join(outDir, "step_b_summary.json")
  await writeJson(summaryPath, summary)

  return {
    step: "B",
    templatesPath,
    templatesLitePath,
    runtimePackPath,
    summaryPath,
    summary
  }
}
