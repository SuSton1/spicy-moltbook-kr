import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import { readPerfectPrototypeBinaryRange } from "./perfect_prototype_binary_io.mjs"
import { PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_SINK_SCHEMA } from "./perfect_prototype_structured_sink_schemas.mjs"

export const PERFECT_PROTOTYPE_FEATURE_VALUES_BIN_FILENAME = "feature_values.bin"
export const PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_FILENAME = "feature_values_index.parquet"

export const resolvePerfectPrototypeFeatureValuesPartitionBinPath = ({
  featureStoreDir,
  dateKey,
}) =>
  path.join(
    path.resolve(featureStoreDir),
    `date=${String(dateKey ?? "").trim()}`,
    PERFECT_PROTOTYPE_FEATURE_VALUES_BIN_FILENAME,
  )

export const resolvePerfectPrototypeFeatureValuesPartitionIndexPath = ({
  featureStoreDir,
  dateKey,
}) =>
  path.join(
    path.resolve(featureStoreDir),
    `date=${String(dateKey ?? "").trim()}`,
    PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_FILENAME,
  )

const toSortedFiniteValues = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

export const writePerfectPrototypeFeatureValuesSidecar = async ({
  cwd = process.cwd(),
  featureStoreDir,
  dateKey,
  accumulator,
}) => {
  const resolvedBinPath = resolvePerfectPrototypeFeatureValuesPartitionBinPath({
    featureStoreDir,
    dateKey,
  })
  const resolvedIndexPath = resolvePerfectPrototypeFeatureValuesPartitionIndexPath({
    featureStoreDir,
    dateKey,
  })
  await ensureDir(path.dirname(resolvedBinPath))
  await fsp.rm(resolvedBinPath, { force: true })
  await fsp.rm(resolvedIndexPath, { force: true })
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const sink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb,
    parquetPath: resolvedIndexPath,
    schema: PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_SINK_SCHEMA,
  })
  const fileHandle = await fsp.open(resolvedBinPath, "w")
  let offset = 0
  try {
    const featureKeys = Array.from(accumulator instanceof Map ? accumulator.keys() : []).sort((left, right) =>
      String(left).localeCompare(String(right)),
    )
    for (const featureKey of featureKeys) {
      const values = toSortedFiniteValues(accumulator.get(featureKey))
      if (values.length < 1) continue
      const buffer = Buffer.allocUnsafe(values.length * 8)
      let min = values[0]
      let max = values[values.length - 1]
      for (let index = 0; index < values.length; index += 1) {
        buffer.writeDoubleLE(values[index], index * 8)
      }
      await fileHandle.write(buffer, 0, buffer.length, offset)
      await sink.writeRow({
        featureKey: String(featureKey).trim(),
        offset,
        count: values.length,
        min,
        max,
      })
      offset += buffer.length
    }
    await sink.close()
  } catch (error) {
    await sink.abort()
    throw error
  } finally {
    await fileHandle.close().catch(() => {})
  }
  return {
    binPath: resolvedBinPath,
    indexPath: resolvedIndexPath,
  }
}

export const streamPerfectPrototypeFeatureValueIndexRows = async ({
  cwd = process.cwd(),
  indexPath,
  onRow,
}) => {
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath: indexPath,
    schema: PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_SINK_SCHEMA),
    orderBySql: "featureKey",
    onRow,
  })
}

export const readPerfectPrototypeFeatureValuesFromBin = async ({
  fileHandle,
  filePath = null,
  offset,
  count,
}) => {
  const resolvedCount = Math.max(0, Math.floor(Number(count) || 0))
  if (resolvedCount < 1) return []
  const byteLength = resolvedCount * 8
  const buffer = await readPerfectPrototypeBinaryRange({
    fileHandle,
    filePath,
    offset,
    byteLength,
    label: "feature_values.bin",
  })
  const values = new Array(resolvedCount)
  for (let index = 0; index < resolvedCount; index += 1) {
    values[index] = buffer.readDoubleLE(index * 8)
  }
  return values
}
