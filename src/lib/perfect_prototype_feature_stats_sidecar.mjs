import path from "node:path"

import { sqlQuote } from "./perfect_prototype_duckdb.mjs"

export const PERFECT_PROTOTYPE_FEATURE_STATS_FILENAME = "feature_stats.parquet"

export const resolvePerfectPrototypeFeatureStatsPartitionPath = ({
  featureStoreDir,
  dateKey,
}) =>
  path.join(
    path.resolve(featureStoreDir),
    `date=${String(dateKey ?? "").trim()}`,
    PERFECT_PROTOTYPE_FEATURE_STATS_FILENAME,
  )

export const createPerfectPrototypeFeatureStatsAccumulator = () => new Map()

export const collectPerfectPrototypeFeatureStatsFromNumericFeatureMap = ({
  accumulator,
  numericFeatureMap,
}) => {
  const next = accumulator instanceof Map ? accumulator : new Map()
  for (const [featureKey, rawValue] of Object.entries(numericFeatureMap ?? {})) {
    const value = Number(rawValue)
    if (!featureKey || !Number.isFinite(value)) continue
    const current = next.get(featureKey) ?? []
    current.push(value)
    next.set(featureKey, current)
  }
  return next
}

export const finalizePerfectPrototypeFeatureStatsRows = (accumulator) =>
  Array.from(accumulator instanceof Map ? accumulator.entries() : [])
    .map(([featureKey, values]) => {
      const safeValues = (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
      if (safeValues.length < 1) return null
      let min = safeValues[0]
      let max = safeValues[0]
      for (let index = 1; index < safeValues.length; index += 1) {
        const value = safeValues[index]
        if (value < min) min = value
        if (value > max) max = value
      }
      return {
        featureKey: String(featureKey).trim(),
        count: safeValues.length,
        min,
        max,
      }
    })
    .filter((row) => row?.featureKey)
    .sort((left, right) => String(left.featureKey).localeCompare(String(right.featureKey)))

export const buildPerfectPrototypeFeatureStatsParquetSql = (inputPaths) => {
  const resolvedPaths = (Array.isArray(inputPaths) ? inputPaths : [inputPaths])
    .map((filePath) => path.resolve(String(filePath ?? "").trim()))
    .filter(Boolean)
  if (resolvedPaths.length < 1) {
    throw new Error("buildPerfectPrototypeFeatureStatsParquetSql requires at least one input path")
  }
  if (resolvedPaths.length === 1) {
    return `read_parquet(${sqlQuote(resolvedPaths[0])})`
  }
  return `read_parquet([${resolvedPaths.map((filePath) => sqlQuote(filePath)).join(", ")}])`
}
