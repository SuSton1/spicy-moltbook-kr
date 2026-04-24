import path from "node:path"

import { iterateJsonl, readJsonl } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  copyJsonlToParquet,
  exportParquetToJsonl,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  deserializePerfectPrototypeTypedWrapperRow,
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
} from "./perfect_prototype_structured_sink_schemas.mjs"

export const isPerfectPrototypeParquetPath = (filePath) =>
  String(filePath ?? "").trim().toLowerCase().endsWith(".parquet")

export const assertPerfectPrototypeParquetInput = ({
  inputPath,
  label = "input",
} = {}) => {
  const resolvedInputPath = path.resolve(String(inputPath ?? "").trim())
  if (!isPerfectPrototypeParquetPath(resolvedInputPath)) {
    throw new Error(
      `${label} must be a parquet path on the predictive primary path: ${resolvedInputPath}`,
    )
  }
  return resolvedInputPath
}

export const buildPerfectPrototypeTypedParquetWrapperRow = ({
  row,
  rowOrdinal,
}) => ({
  rowOrdinal: Number(rowOrdinal),
  ...((row && typeof row === "object") ? row : {}),
})

export const unwrapPerfectPrototypeTypedParquetWrapperRow = (wrapper) => {
  if (!wrapper || typeof wrapper !== "object") return {}
  const row = {
    ...wrapper,
  }
  delete row.rowOrdinal
  return deserializePerfectPrototypeTypedWrapperRow(row)
}

export const writePerfectPrototypeJsonlToParquet = async ({
  cwd = process.cwd(),
  inputJsonlPath,
  outputParquetPath,
}) => {
  const resolvedInputPath = path.resolve(inputJsonlPath)
  const resolvedOutputPath = path.resolve(outputParquetPath)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await copyJsonlToParquet({
    cwd,
    duckdb,
    jsonlPath: resolvedInputPath,
    parquetPath: resolvedOutputPath,
  })
  return resolvedOutputPath
}

export const materializePerfectPrototypeParquetRowsToJsonl = async ({
  cwd = process.cwd(),
  inputPath,
  outPath,
  orderBySql = "rowOrdinal",
}) => {
  const resolvedInputPath = path.resolve(inputPath)
  const resolvedOutPath = path.resolve(outPath)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await exportParquetToJsonl({
    cwd,
    duckdb,
    parquetPath: resolvedInputPath,
    outPath: resolvedOutPath,
    orderBySql,
  })
  return resolvedOutPath
}

export const iteratePerfectPrototypeRowsFromInput = async ({
  cwd = process.cwd(),
  inputPath,
  orderBySql = "rowOrdinal",
  onRow,
  requireParquet = false,
  inputLabel = "input",
}) => {
  const resolvedInputPath = path.resolve(inputPath)
  if (requireParquet) {
    assertPerfectPrototypeParquetInput({
      inputPath: resolvedInputPath,
      label: inputLabel,
    })
  }
  if (!isPerfectPrototypeParquetPath(resolvedInputPath)) {
    await iterateJsonl(resolvedInputPath, {
      strict: true,
      onRow,
    })
    return
  }
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath: resolvedInputPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA),
    orderBySql,
    onRow: async (wrapper) => {
      await onRow(unwrapPerfectPrototypeTypedParquetWrapperRow(wrapper))
    },
  })
}

const resolvePrototypeInputDateKey = (row) =>
  String(row?.dateKey ?? row?.decisionDateKey ?? row?.eventDate ?? row?.targetDateKey ?? "").trim() || null

export const iteratePerfectPrototypeDateGroupsFromInput = async ({
  cwd = process.cwd(),
  inputPath,
  orderBySql = "rowOrdinal",
  onGroup,
  requireParquet = false,
  inputLabel = "input",
}) => {
  let currentDateKey = null
  let currentRows = []
  await iteratePerfectPrototypeRowsFromInput({
    cwd,
    inputPath,
    orderBySql,
    requireParquet,
    inputLabel,
    onRow: async (row) => {
      const dateKey = resolvePrototypeInputDateKey(row)
      if (!dateKey) return
      if (currentDateKey == null) {
        currentDateKey = dateKey
      }
      if (dateKey < currentDateKey) {
        throw new Error(
          `Predictive row stream is not date-ordered: current=${currentDateKey} next=${dateKey} input=${path.resolve(inputPath)}`,
        )
      }
      if (dateKey !== currentDateKey) {
        await onGroup({
          dateKey: currentDateKey,
          rows: currentRows,
        })
        currentDateKey = dateKey
        currentRows = []
      }
      currentRows.push(row)
    },
  })
  if (currentRows.length > 0 && currentDateKey) {
    await onGroup({
      dateKey: currentDateKey,
      rows: currentRows,
    })
  }
}

export const loadPerfectPrototypeRowsFromInput = async ({
  cwd = process.cwd(),
  inputPath,
  orderBySql = "rowOrdinal",
  requireParquet = false,
  inputLabel = "input",
}) => {
  const resolvedInputPath = path.resolve(inputPath)
  if (requireParquet) {
    assertPerfectPrototypeParquetInput({
      inputPath: resolvedInputPath,
      label: inputLabel,
    })
  }
  if (!isPerfectPrototypeParquetPath(resolvedInputPath)) {
    return readJsonl(resolvedInputPath, { strict: true })
  }
  const rows = []
  await iteratePerfectPrototypeRowsFromInput({
    cwd,
    inputPath: resolvedInputPath,
    orderBySql,
    requireParquet,
    inputLabel,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  return rows
}
