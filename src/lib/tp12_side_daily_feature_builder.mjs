import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { ensureDir, iterateJsonl, pathExists, writeJson, writeJsonl } from "./io.mjs"
import {
  computeTp12NoStopTargetLabelsForDecision,
  TP12_NO_STOP_TARGET_CONTRACT_KIND,
  TP12_NO_STOP_TARGET_SPECS,
} from "./tp12_no_stop_target_contract.mjs"


export const TP12_SIDE_DAILY_FEATURE_DATASET_KIND = "tp12_side_daily_feature_dataset_v1"

export const TP12_SIDE_DAILY_GATE_SPECS = [
  {
    gateId: "d0_close",
    featureCutoffDateRef: "d0",
    entryMode: "next_day_open",
  },
]

const SIDE_DATASET_SPECS = Object.freeze({
  investor_daily: Object.freeze({
    datasetId: "investor_daily",
    candidateFields: ["ind_invsr", "ind_netprps_amt", "ind_netprps_qty"],
    featurePrefix: "investor",
  }),
  program_daily: Object.freeze({
    datasetId: "program_daily",
    candidateFields: ["prm_netprps_amt", "prm_netprps_qty"],
    featurePrefix: "program",
  }),
  trade_strength_daily: Object.freeze({
    datasetId: "trade_strength_daily",
    candidateFields: ["cntr_str", "tday_cntr_str"],
    featurePrefix: "trade_strength",
  }),
})

const DEFAULT_SIDE_DATASET_IDS = ["investor_daily", "program_daily"]

const toText = (value) => String(value ?? "").trim()

const toNumberOrNull = (value) => {
  const text = String(value ?? "").replaceAll(",", "").trim()
  if (!text) return null
  const normalizedText = text.replace(/^([+-])\1+/, "$1")
  const numeric = Number(normalizedText)
  return Number.isFinite(numeric) ? numeric : null
}

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, dateKey) => `${symbol}::${dateKey}`

const safeDiv = (numerator, denominator) => {
  const left = Number(numerator)
  const right = Number(denominator)
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(right) < 1e-12) return 0
  return left / right
}

const signedLog1p = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.sign(numeric) * Math.log1p(Math.abs(numeric))
}

const sign3 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 1e-12) return 0
  return numeric > 0 ? 1 : -1
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const resolveDatasetSpecs = (datasetIds) => {
  const resolvedIds = uniqueSorted(Array.isArray(datasetIds) && datasetIds.length > 0 ? datasetIds : DEFAULT_SIDE_DATASET_IDS)
  if (resolvedIds.length < 1) {
    throw new Error("At least one side-daily datasetId is required")
  }
  return resolvedIds.map((datasetId) => {
    const spec = SIDE_DATASET_SPECS[datasetId]
    if (!spec) {
      throw new Error(`Unsupported side-daily datasetId=${datasetId}`)
    }
    return spec
  })
}

export const readTp12SideDailyManifestRows = async (manifestPath, { decisionFrom = null, decisionTo = null } = {}) => {
  if (!pathExists(manifestPath)) {
    throw new Error(`Missing manifest path: ${manifestPath}`)
  }
  const rows = []
  await iterateJsonl(manifestPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const requestId = toText(row?.requestId)
      const decisionDateKey = assertDateKey(row?.decisionDateKey, "manifest decisionDateKey")
      if (decisionFrom && decisionDateKey < decisionFrom) return
      if (decisionTo && decisionDateKey > decisionTo) return
      const prevDateKey = assertDateKey(row?.prevDateKey, "manifest prevDateKey")
      const asOfDateKey = assertDateKey(row?.asOfDateKey ?? prevDateKey, "manifest asOfDateKey")
      const stepALaneId = toText(row?.stepALaneId)
      const runId = toText(row?.runId)
      const eventLabel = toText(row?.eventLabel)
      const windowDateKeys = Array.from(
        new Set((Array.isArray(row?.windowDateKeys) ? row.windowDateKeys : []).map((value) => assertDateKey(value, "manifest windowDateKey"))),
      ).sort((left, right) => left.localeCompare(right))
      if (!symbol || !requestId || !stepALaneId || !runId || !eventLabel) {
        throw new Error(`Malformed manifest row missing identifiers for symbol=${symbol || "<empty>"} decision=${decisionDateKey}`)
      }
      if (windowDateKeys.length < 6) {
        throw new Error(`Manifest row requires full D-1..D+4 window for ${requestId}`)
      }
      if (windowDateKeys[0] !== prevDateKey || windowDateKeys[1] !== decisionDateKey) {
        throw new Error(`Manifest row date contract mismatch for ${requestId}`)
      }
      rows.push({
        requestId,
        symbol,
        decisionDateKey,
        prevDateKey,
        asOfDateKey,
        stepALaneId,
        runId,
        eventLabel,
        highJumpThreshold: Number(row?.highJumpThreshold ?? NaN),
        highJumpMode: toText(row?.highJumpMode),
        impulseSourceDateKey: assertDateKey(row?.impulseSourceDateKey, "manifest impulseSourceDateKey"),
        impulseLookbackDays: Number(row?.impulseLookbackDays ?? NaN),
        recentImpulseLookbackTradingDays: Number(row?.recentImpulseLookbackTradingDays ?? NaN),
        windowDateKeys: windowDateKeys.slice(0, 6),
      })
    },
  })
  if (rows.length < 1) {
    throw new Error(`No manifest rows loaded from ${manifestPath}`)
  }
  rows.sort((left, right) => {
    const dateCmp = left.decisionDateKey.localeCompare(right.decisionDateKey)
    if (dateCmp !== 0) return dateCmp
    const symbolCmp = left.symbol.localeCompare(right.symbol)
    if (symbolCmp !== 0) return symbolCmp
    return left.requestId.localeCompare(right.requestId)
  })
  return rows
}

export const buildTp12SideDailyRequestedSets = (manifestRows) => {
  const symbolSet = new Set()
  const requestedPairSet = new Set()
  for (const row of manifestRows) {
    symbolSet.add(row.symbol)
    for (const dateKey of row.windowDateKeys) {
      requestedPairSet.add(pairKey(row.symbol, dateKey))
    }
  }
  return {
    symbolSet,
    requestedPairSet,
  }
}

const loadSideDailyIndex = async (datasetSpec, filePath, symbolSet) => {
  if (!pathExists(filePath)) {
    throw new Error(`Missing side-daily canonical file for ${datasetSpec.datasetId}: ${filePath}`)
  }
  const bySymbol = new Map()
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      const dataset = toText(row?.dataset)
      if (dataset && dataset !== datasetSpec.datasetId) {
        throw new Error(`Dataset mismatch inside ${filePath}: expected ${datasetSpec.datasetId} got ${dataset}`)
      }
      const symbol = toText(row?.symbol)
      if (!symbolSet.has(symbol)) return
      const dateKey = assertDateKey(row?.dateKey, `${datasetSpec.datasetId} dateKey`)
      const rawRow = row?.rawRow ?? {}
      let numericValue = null
      for (const field of datasetSpec.candidateFields) {
        numericValue = toNumberOrNull(rawRow?.[field])
        if (numericValue !== null) break
      }
      if (numericValue === null) {
        throw new Error(`${datasetSpec.datasetId} row missing supported numeric field for ${symbol}:${dateKey}`)
      }
      const symbolMap = bySymbol.get(symbol) ?? new Map()
      if (symbolMap.has(dateKey)) {
        throw new Error(`Duplicate ${datasetSpec.datasetId} row for ${symbol}:${dateKey}`)
      }
      symbolMap.set(dateKey, numericValue)
      bySymbol.set(symbol, symbolMap)
    },
  })
  return bySymbol
}

const normalizeCandleRow = (row) => {
  const symbol = toText(row?.symbol)
  const dateKey = assertDateKey(row?.dateKey, "candle dateKey")
  const open = Number(row?.open ?? NaN)
  const high = Number(row?.high ?? NaN)
  const low = Number(row?.low ?? NaN)
  const close = Number(row?.close ?? NaN)
  if (!symbol || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    throw new Error(`Malformed candle row for ${symbol || "<empty>"}:${dateKey}`)
  }
  return {
    symbol,
    dateKey,
    open,
    high,
    low,
    close,
  }
}

export const loadTp12SideDailyCandleIndex = async (candlePath, symbolSet, requestedPairSet) => {
  if (!pathExists(candlePath)) {
    throw new Error(`Missing candle path: ${candlePath}`)
  }
  const bySymbol = new Map()
  await iterateJsonl(candlePath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      if (!symbolSet.has(symbol)) return
      const normalized = normalizeCandleRow(row)
      const key = pairKey(normalized.symbol, normalized.dateKey)
      if (!requestedPairSet.has(key)) return
      const symbolMap = bySymbol.get(normalized.symbol) ?? new Map()
      if (symbolMap.has(normalized.dateKey)) {
        throw new Error(`Duplicate candle row for ${normalized.symbol}:${normalized.dateKey}`)
      }
      symbolMap.set(normalized.dateKey, normalized)
      bySymbol.set(normalized.symbol, symbolMap)
    },
  })
  for (const key of requestedPairSet) {
    const [symbol, dateKey] = key.split("::")
    if (!(bySymbol.get(symbol) ?? new Map()).has(dateKey)) {
      throw new Error(`Missing candle coverage for ${symbol}:${dateKey}`)
    }
  }
  return bySymbol
}

const requireSideValue = (index, datasetId, symbol, dateKey) => {
  const symbolMap = index.get(symbol)
  if (!symbolMap || !symbolMap.has(dateKey)) {
    throw new Error(`Missing ${datasetId} coverage for ${symbol}:${dateKey}`)
  }
  return symbolMap.get(dateKey)
}

const buildDatasetFeatures = ({ datasetSpec, prevValue, decisionValue }) => {
  const prefix = datasetSpec.featurePrefix
  const delta = decisionValue - prevValue
  if (prefix === "trade_strength") {
    return {
      [`${prefix}_dminus1_value`]: prevValue,
      [`${prefix}_d0_value`]: decisionValue,
      [`${prefix}_day_delta`]: delta,
      [`${prefix}_dminus1_above_100`]: prevValue >= 100 ? 1 : 0,
      [`${prefix}_d0_above_100`]: decisionValue >= 100 ? 1 : 0,
      [`${prefix}_day_delta_vs_100`]: decisionValue - 100,
    }
  }
  return {
    [`${prefix}_dminus1_raw`]: prevValue,
    [`${prefix}_d0_raw`]: decisionValue,
    [`${prefix}_day_delta`]: delta,
    [`${prefix}_dminus1_signed_log1p`]: signedLog1p(prevValue),
    [`${prefix}_d0_signed_log1p`]: signedLog1p(decisionValue),
    [`${prefix}_day_delta_signed_log1p`]: signedLog1p(delta),
    [`${prefix}_day_delta_vs_abs_prev`]: safeDiv(delta, Math.max(Math.abs(prevValue), 1)),
    [`${prefix}_d0_positive`]: decisionValue > 0 ? 1 : 0,
  }
}

const buildBaseSideFeatures = ({ datasetSpecs, datasetIndexesById, symbol, prevDateKey, decisionDateKey }) => {
  const features = {}
  const rawValues = {}
  for (const datasetSpec of datasetSpecs) {
    const index = datasetIndexesById.get(datasetSpec.datasetId)
    const prevValue = requireSideValue(index, datasetSpec.datasetId, symbol, prevDateKey)
    const decisionValue = requireSideValue(index, datasetSpec.datasetId, symbol, decisionDateKey)
    Object.assign(features, buildDatasetFeatures({ datasetSpec, prevValue, decisionValue }))
    rawValues[datasetSpec.featurePrefix] = {
      prevValue,
      decisionValue,
      delta: decisionValue - prevValue,
    }
  }
  if (rawValues.investor && rawValues.program) {
    features.side_alignment_investor_program_d0_sign =
      sign3(rawValues.investor.decisionValue) === sign3(rawValues.program.decisionValue) ? 1 : 0
    features.side_alignment_investor_program_delta_sign =
      sign3(rawValues.investor.delta) === sign3(rawValues.program.delta) ? 1 : 0
    features.side_pressure_investor_program_d0_signed_log1p = signedLog1p(
      rawValues.investor.decisionValue + rawValues.program.decisionValue,
    )
  }
  if (rawValues.trade_strength) {
    features.side_strength_d0_above_100 = rawValues.trade_strength.decisionValue >= 100 ? 1 : 0
    if (rawValues.investor) {
      features.side_alignment_strength_investor =
        sign3(rawValues.trade_strength.decisionValue - 100) === sign3(rawValues.investor.decisionValue) ? 1 : 0
    }
    if (rawValues.program) {
      features.side_alignment_strength_program =
        sign3(rawValues.trade_strength.decisionValue - 100) === sign3(rawValues.program.decisionValue) ? 1 : 0
    }
  }
  return features
}

const buildDailySeries = (candleIndex, manifestRow) => {
  const symbolMap = candleIndex.get(manifestRow.symbol)
  if (!symbolMap) {
    throw new Error(`Missing candle series for ${manifestRow.symbol}`)
  }
  const seriesDateKeys = manifestRow.windowDateKeys.slice(1)
  return seriesDateKeys.map((dateKey) => {
    const row = symbolMap.get(dateKey)
    if (!row) {
      throw new Error(`Missing daily series candle for ${manifestRow.symbol}:${dateKey}`)
    }
    return row
  })
}

export const buildTp12SideDailyFeatureDataset = async ({
  manifestPath,
  candlePath,
  outPath,
  summaryOutPath,
  investorDailyPath = "",
  programDailyPath = "",
  tradeStrengthDailyPath = "",
  datasetIds = DEFAULT_SIDE_DATASET_IDS,
  decisionFrom = null,
  decisionTo = null,
  gateIds = TP12_SIDE_DAILY_GATE_SPECS.map((spec) => spec.gateId),
} = {}) => {
  const resolvedManifestPath = path.resolve(manifestPath)
  const resolvedCandlePath = path.resolve(candlePath)
  const resolvedOutPath = path.resolve(outPath)
  const resolvedSummaryOutPath = path.resolve(summaryOutPath)
  const normalizedDecisionFrom = decisionFrom ? assertDateKey(decisionFrom, "decisionFrom") : null
  const normalizedDecisionTo = decisionTo ? assertDateKey(decisionTo, "decisionTo") : null
  const gateSpecById = new Map(TP12_SIDE_DAILY_GATE_SPECS.map((spec) => [spec.gateId, spec]))
  const selectedGateIds = uniqueSorted(gateIds)
  if (selectedGateIds.length < 1) {
    throw new Error("At least one side-daily gateId is required")
  }
  for (const gateId of selectedGateIds) {
    if (!gateSpecById.has(gateId)) {
      throw new Error(`Unsupported side-daily gateId=${gateId}`)
    }
  }
  const datasetSpecs = resolveDatasetSpecs(datasetIds)
  const datasetPathById = new Map([
    ["investor_daily", path.resolve(investorDailyPath)],
    ["program_daily", path.resolve(programDailyPath)],
    ["trade_strength_daily", path.resolve(tradeStrengthDailyPath)],
  ])
  for (const datasetSpec of datasetSpecs) {
    const candidatePath = datasetPathById.get(datasetSpec.datasetId)
    if (!candidatePath) {
      throw new Error(`Missing canonical path mapping for ${datasetSpec.datasetId}`)
    }
  }

  const manifestRows = await readTp12SideDailyManifestRows(resolvedManifestPath, {
    decisionFrom: normalizedDecisionFrom,
    decisionTo: normalizedDecisionTo,
  })
  const requestedSets = buildTp12SideDailyRequestedSets(manifestRows)
  const candleIndex = await loadTp12SideDailyCandleIndex(resolvedCandlePath, requestedSets.symbolSet, requestedSets.requestedPairSet)
  const datasetIndexesById = new Map()
  for (const datasetSpec of datasetSpecs) {
    datasetIndexesById.set(
      datasetSpec.datasetId,
      await loadSideDailyIndex(datasetSpec, datasetPathById.get(datasetSpec.datasetId), requestedSets.symbolSet),
    )
  }

  const featureRows = []
  const gateCounts = new Map()
  for (const manifestRow of manifestRows) {
    const sideFeatures = buildBaseSideFeatures({
      datasetSpecs,
      datasetIndexesById,
      symbol: manifestRow.symbol,
      prevDateKey: manifestRow.prevDateKey,
      decisionDateKey: manifestRow.decisionDateKey,
    })
    const dailySeries = buildDailySeries(candleIndex, manifestRow)
    const targetContract = computeTp12NoStopTargetLabelsForDecision({
      series: dailySeries,
      decisionIdx: 0,
      targetSpecs: TP12_NO_STOP_TARGET_SPECS,
    })
    for (const gateId of selectedGateIds) {
      const gateSpec = gateSpecById.get(gateId)
      featureRows.push({
        kind: TP12_SIDE_DAILY_FEATURE_DATASET_KIND,
        requestId: manifestRow.requestId,
        symbol: manifestRow.symbol,
        decisionDateKey: manifestRow.decisionDateKey,
        prevDateKey: manifestRow.prevDateKey,
        asOfDateKey: manifestRow.asOfDateKey,
        stepALaneId: manifestRow.stepALaneId,
        runId: manifestRow.runId,
        eventLabel: manifestRow.eventLabel,
        highJumpThreshold: manifestRow.highJumpThreshold,
        highJumpMode: manifestRow.highJumpMode,
        impulseSourceDateKey: manifestRow.impulseSourceDateKey,
        impulseLookbackDays: manifestRow.impulseLookbackDays,
        recentImpulseLookbackTradingDays: manifestRow.recentImpulseLookbackTradingDays,
        windowDateKeys: manifestRow.windowDateKeys,
        gateId,
        featureCutoffDateKey: gateSpec.featureCutoffDateRef === "d0" ? manifestRow.decisionDateKey : manifestRow.prevDateKey,
        entryPriceMode: gateSpec.entryMode,
        supportedDatasetIds: datasetSpecs.map((spec) => spec.datasetId),
        features: sideFeatures,
        labels: targetContract.labels,
        labelContractKind: TP12_NO_STOP_TARGET_CONTRACT_KIND,
      })
      gateCounts.set(gateId, Number(gateCounts.get(gateId) ?? 0) + 1)
    }
  }

  const summary = {
    status: "ok",
    kind: TP12_SIDE_DAILY_FEATURE_DATASET_KIND,
    manifestPath: resolvedManifestPath,
    candlePath: resolvedCandlePath,
    outPath: resolvedOutPath,
    rowCount: featureRows.length,
    requestCount: manifestRows.length,
    decisionDateFrom: manifestRows[0]?.decisionDateKey ?? null,
    decisionDateTo: manifestRows[manifestRows.length - 1]?.decisionDateKey ?? null,
    gateCounts: Object.fromEntries(Array.from(gateCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    featureFamilies: datasetSpecs.map((spec) => spec.datasetId),
    gateIds: selectedGateIds,
    labelIds: TP12_NO_STOP_TARGET_SPECS.map((spec) => spec.labelId),
    labelContractKind: TP12_NO_STOP_TARGET_CONTRACT_KIND,
  }

  await ensureDir(path.dirname(resolvedOutPath))
  await writeJsonl(resolvedOutPath, featureRows)
  await writeJson(resolvedSummaryOutPath, summary)
  return {
    outPath: resolvedOutPath,
    summaryOutPath: resolvedSummaryOutPath,
    summary,
  }
}
