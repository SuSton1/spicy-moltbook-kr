import path from "node:path"

import { loadConfig } from "./config.mjs"
import { buildCandleDateIndexMap, buildCandleSeriesMap, loadStepBData } from "./data.mjs"
import {
  augmentFamilyWithTokenMap,
  buildMonthKey,
  summarizeRows,
  uniqueStrings,
} from "./perfect_prototype_daily_symbolic_common.mjs"
import { buildSequenceShapeletAssignments } from "./perfect_prototype_daily_sequence_window_encoder.mjs"

const resolveDataPaths = (cwd, dataPaths = {}) => ({
  candleDailyJsonl: path.resolve(cwd, String(dataPaths?.candleDailyJsonl ?? "data/candle_daily.jsonl")),
  universeJsonl: path.resolve(cwd, String(dataPaths?.universeJsonl ?? "data/universe_daily.jsonl")),
})

const uniqueRows = (collections = []) =>
  Array.from(
    new Map(
      collections
        .flatMap((rows) => (Array.isArray(rows) ? rows : []))
        .map((row) => [String(row?.rowKey ?? row?.sourceId ?? "").trim(), row])
        .filter(([rowKey]) => rowKey),
    ).values(),
  )

const resolveEndIdx = ({ row, dateIndexMap }) => {
  const asOfDateKey = String(row?.asOfDateKey ?? "").trim()
  if (asOfDateKey) {
    const idx = Number(dateIndexMap?.get(asOfDateKey))
    if (Number.isInteger(idx) && idx >= 1) return idx
  }
  const decisionDateKey = String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()
  if (!decisionDateKey) return null
  const decisionIdx = Number(dateIndexMap?.get(decisionDateKey))
  if (!Number.isInteger(decisionIdx) || decisionIdx < 1) return null
  return Math.max(1, decisionIdx - 1)
}

const buildSources = async ({ family, cwd, config, seriesMap, dateIndexMap }) => {
  if (seriesMap instanceof Map && dateIndexMap instanceof Map) {
    return { seriesMap, dateIndexMap }
  }
  if (!config || typeof config !== "object") {
    throw new Error("buildPerfectPrototypeDailySequenceShapeletBank requires either seriesMap/dateIndexMap or cwd+config")
  }
  const allRows = uniqueRows([
    family?.trainRows,
    family?.gatedTrainRows,
    family?.oosRows,
    family?.supportCaseViews,
    family?.bridgePositiveRows,
    family?.supportNearHardNegativeRows,
  ])
  const symbolAllowSet = new Set(allRows.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean))
  const data = await loadStepBData(resolveDataPaths(cwd, config?.dataPaths), { symbolAllowSet })
  const builtSeriesMap = buildCandleSeriesMap(data.candles, symbolAllowSet)
  const builtDateIndexMap = buildCandleDateIndexMap(builtSeriesMap)
  return {
    seriesMap: builtSeriesMap,
    dateIndexMap: builtDateIndexMap,
  }
}

export const buildPerfectPrototypeDailySequenceShapeletBank = async ({
  family,
  cwd = process.cwd(),
  config = null,
  seriesMap = null,
  dateIndexMap = null,
} = {}) => {
  const sources = await buildSources({ family, cwd, config, seriesMap, dateIndexMap })
  const allRows = uniqueRows([
    family?.trainRows,
    family?.gatedTrainRows,
    family?.oosRows,
    family?.supportCaseViews,
    family?.bridgePositiveRows,
    family?.supportNearHardNegativeRows,
  ])
  const rowTokenMapByKey = new Map()
  const assignmentMapByRowKey = new Map()
  let missingSequenceRowCount = 0

  for (const row of allRows) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    const symbol = String(row?.symbol ?? "").trim()
    if (!rowKey || !symbol) continue
    const series = sources.seriesMap.get(symbol) ?? null
    const symbolDateIndexMap = sources.dateIndexMap.get(symbol) ?? null
    const endIdx = resolveEndIdx({ row, dateIndexMap: symbolDateIndexMap })
    if (!series || !symbolDateIndexMap || !Number.isInteger(endIdx) || endIdx < 1) {
      missingSequenceRowCount += 1
      continue
    }
    const assignments = buildSequenceShapeletAssignments({ series, endIdx })
    const tokens = uniqueStrings(Object.values(assignments))
    if (tokens.length < 1) {
      missingSequenceRowCount += 1
      continue
    }
    rowTokenMapByKey.set(rowKey, tokens)
    assignmentMapByRowKey.set(rowKey, assignments)
  }

  const ok = rowTokenMapByKey.size > 0
  const augmentedFamily = augmentFamilyWithTokenMap({
    family,
    rowTokenMapByKey,
    summaryPatch: {
      sequenceShapeletReady: ok,
      sequenceShapeletRowCount: rowTokenMapByKey.size,
      sequenceShapeletMissingRowCount: missingSequenceRowCount,
      sequenceShapeletTokenFamilies: uniqueStrings(
        Array.from(rowTokenMapByKey.values()).flatMap((tokens) =>
          (tokens ?? []).map((token) => token.split(".").slice(0, 3).join(".")),
        ),
      ),
      sequenceShapeletBridgePositiveSummary: summarizeRows(
        (family?.bridgePositiveRows ?? []).filter((row) => rowTokenMapByKey.has(String(row?.rowKey ?? "").trim())),
      ),
      sequenceShapeletOosSummary: summarizeRows(
        (family?.oosRows ?? []).filter((row) => rowTokenMapByKey.has(String(row?.rowKey ?? "").trim())),
      ),
      sequenceShapeletSupportSummary: summarizeRows(
        (family?.supportCaseViews ?? []).map((row) => ({
          ...row,
          monthKey: row?.monthKey ?? buildMonthKey(row?.dateKey),
        })).filter((row) => rowTokenMapByKey.has(String(row?.rowKey ?? "").trim())),
      ),
    },
  })

  return {
    ...augmentedFamily,
    ok,
    reason: ok ? null : "unsat_no_sequence_shapelet_rows",
    sequenceShapeletAssignmentsByRowKey: assignmentMapByRowKey,
  }
}
