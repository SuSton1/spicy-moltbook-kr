import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { createJsonlWriter, iterateJsonl, pathExists, writeJson } from "./io.mjs"


export const TP12_SIDE_DAILY_DOWNSTREAM_FULL_PERIOD_PACK_KIND = "tp12_side_daily_downstream_full_period_pack_v1"

const toText = (value) => String(value ?? "").trim()

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, decisionDateKey) => `${toText(symbol)}::${assertDateKey(decisionDateKey, "decisionDateKey")}`

const createStats = (packId, packPath) => ({
  packId,
  packPath,
  rowCount: 0,
  decisionDateFrom: null,
  decisionDateTo: null,
})

const updateStats = (stats, decisionDateKey) => {
  stats.rowCount += 1
  if (!stats.decisionDateFrom || decisionDateKey < stats.decisionDateFrom) {
    stats.decisionDateFrom = decisionDateKey
  }
  if (!stats.decisionDateTo || decisionDateKey > stats.decisionDateTo) {
    stats.decisionDateTo = decisionDateKey
  }
}

export const buildTp12SideDailyDownstreamFullPeriodPack = async ({
  trainPackPath,
  oosPackPath,
  outPath,
  summaryOutPath,
} = {}) => {
  const resolvedTrainPackPath = path.resolve(trainPackPath ?? "")
  const resolvedOosPackPath = path.resolve(oosPackPath ?? "")
  const resolvedOutPath = path.resolve(outPath ?? "")
  const resolvedSummaryOutPath = path.resolve(summaryOutPath ?? "")

  if (!pathExists(resolvedTrainPackPath)) {
    throw new Error(`Missing train pack path: ${resolvedTrainPackPath}`)
  }
  if (!pathExists(resolvedOosPackPath)) {
    throw new Error(`Missing oos pack path: ${resolvedOosPackPath}`)
  }
  if (!resolvedOutPath) {
    throw new Error("outPath is required")
  }
  if (!resolvedSummaryOutPath) {
    throw new Error("summaryOutPath is required")
  }

  const statsByPack = new Map([
    ["train", createStats("train", resolvedTrainPackPath)],
    ["oos", createStats("oos", resolvedOosPackPath)],
  ])
  const pairSet = new Set()
  const sourceTypes = new Set()
  const baselineLineIds = new Set()
  const discoveryUniverseIds = new Set()
  const stepALaneIds = new Set()
  const writer = await createJsonlWriter(resolvedOutPath)
  try {
    for (const [packId, packPath] of [
      ["train", resolvedTrainPackPath],
      ["oos", resolvedOosPackPath],
    ]) {
      const stats = statsByPack.get(packId)
      await iterateJsonl(packPath, {
        strict: true,
        onRow: async (row) => {
          const symbol = toText(row?.symbol)
          const decisionDateKey = assertDateKey(row?.decisionDateKey ?? row?.dateKey, `${packId} decisionDateKey`)
          if (!symbol) {
            throw new Error(`Malformed ${packId} pack row missing symbol at ${packPath}`)
          }
          if (!row || typeof row !== "object" || !row.featureVec || typeof row.featureVec !== "object") {
            throw new Error(`Malformed ${packId} pack row missing featureVec for ${symbol}:${decisionDateKey}`)
          }
          const joinKey = pairKey(symbol, decisionDateKey)
          if (pairSet.has(joinKey)) {
            throw new Error(`Duplicate pair across train/oos packs: ${joinKey}`)
          }
          pairSet.add(joinKey)
          const sourceType = toText(row?.sourceType)
          const baselineLineId = toText(row?.baselineLineId)
          const discoveryUniverseId = toText(row?.discoveryUniverseId)
          const stepALaneId = toText(row?.stepALaneId)
          if (sourceType) sourceTypes.add(sourceType)
          if (baselineLineId) baselineLineIds.add(baselineLineId)
          if (discoveryUniverseId) discoveryUniverseIds.add(discoveryUniverseId)
          if (stepALaneId) stepALaneIds.add(stepALaneId)
          updateStats(stats, decisionDateKey)
          await writer.writeRow(row)
        },
      })
    }
  } finally {
    await writer.close()
  }

  const trainStats = statsByPack.get("train")
  const oosStats = statsByPack.get("oos")
  if ((trainStats?.rowCount ?? 0) < 1) {
    throw new Error("Train pack contributed zero rows")
  }
  if ((oosStats?.rowCount ?? 0) < 1) {
    throw new Error("OOS pack contributed zero rows")
  }
  if ((trainStats?.decisionDateTo ?? "") >= (oosStats?.decisionDateFrom ?? "")) {
    throw new Error(
      `Train/OOS pack ranges must not overlap: trainTo=${trainStats?.decisionDateTo} oosFrom=${oosStats?.decisionDateFrom}`,
    )
  }

  const summary = {
    status: "ok",
    kind: TP12_SIDE_DAILY_DOWNSTREAM_FULL_PERIOD_PACK_KIND,
    trainPackPath: resolvedTrainPackPath,
    oosPackPath: resolvedOosPackPath,
    outPath: resolvedOutPath,
    rowCount: pairSet.size,
    trainRowCount: trainStats.rowCount,
    oosRowCount: oosStats.rowCount,
    decisionDateFrom: trainStats.decisionDateFrom,
    decisionDateTo: oosStats.decisionDateTo,
    sourceTypes: Array.from(sourceTypes).sort((left, right) => left.localeCompare(right)),
    baselineLineIds: Array.from(baselineLineIds).sort((left, right) => left.localeCompare(right)),
    discoveryUniverseIds: Array.from(discoveryUniverseIds).sort((left, right) => left.localeCompare(right)),
    stepALaneIds: Array.from(stepALaneIds).sort((left, right) => left.localeCompare(right)),
    coverage: {
      train: trainStats,
      oos: oosStats,
    },
  }
  await writeJson(resolvedSummaryOutPath, summary)
  return {
    outPath: resolvedOutPath,
    summaryOutPath: resolvedSummaryOutPath,
    summary,
  }
}
