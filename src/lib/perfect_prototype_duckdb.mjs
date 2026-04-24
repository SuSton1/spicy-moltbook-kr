import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import readline from "node:readline"

import { probeDuckdbCli } from "./duckdb_cli.mjs"
import { ensureDir, parseDelimitedLine, pathExists } from "./io.mjs"

const sqlQuote = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`
const sqlIdentifier = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`
const DEFAULT_DUCKDB_THREADS = Number.parseInt(
  process.env.PERFECT_PROTO_DUCKDB_THREADS ?? "2",
  10,
)
const DEFAULT_DUCKDB_MEMORY_LIMIT_GB = Number.parseInt(
  process.env.PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB ?? "4",
  10,
)
const DEFAULT_DUCKDB_MAX_TEMP_DIRECTORY_SIZE_GB = Number.parseInt(
  process.env.PERFECT_PROTO_DUCKDB_MAX_TEMP_DIRECTORY_SIZE_GB ?? "48",
  10,
)
const DEFAULT_DUCKDB_PRESERVE_INSERTION_ORDER =
  String(process.env.PERFECT_PROTO_DUCKDB_PRESERVE_INSERTION_ORDER ?? "false").trim().toLowerCase() ===
  "true"
const DEFAULT_DUCKDB_TEMP_DIRECTORY = String(
  process.env.PERFECT_PROTO_DUCKDB_TEMP_DIRECTORY ?? "",
).trim()

const sanitizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const sanitizeOptionalPath = (value) => {
  const text = String(value ?? "").trim()
  return text ? path.resolve(text) : null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ensureDuckdbParquetOutputVisible = async ({
  parquetPath,
  timeoutMs = 1000,
  pollMs = 10,
}) => {
  const resolvedParquetPath = path.resolve(parquetPath)
  const deadlineAt = Date.now() + Math.max(1, Math.floor(Number(timeoutMs) || 0))
  while (Date.now() <= deadlineAt) {
    if (pathExists(resolvedParquetPath)) {
      const stat = await fsp.stat(resolvedParquetPath).catch(() => null)
      if (stat && Number(stat.size ?? 0) > 0) {
        return
      }
    }
    await sleep(Math.max(1, Math.floor(Number(pollMs) || 0)))
  }
  throw new Error(
    [
      "DuckDB parquet sink close returned before the parquet artifact became visible.",
      `parquetPath=${resolvedParquetPath}`,
      `timeoutMs=${Math.max(1, Math.floor(Number(timeoutMs) || 0))}`,
    ].join("\n"),
  )
}

const DELIMITED_SINK_NULL_SENTINEL = "\\N"
const DELIMITED_SINK_SEPARATOR = "\t"
const DELIMITED_QUERY_NULL_SENTINEL = "\u001dPPNULL\u001d"

const normalizeDelimitedSchema = (schema) => {
  const safeSchema = Array.isArray(schema) ? schema : []
  if (safeSchema.length < 1) {
    throw new Error("DuckDB delimited sink requires at least one schema column")
  }
  const seenNames = new Set()
  return safeSchema.map((column, index) => {
    const name = String(column?.name ?? "").trim()
    const duckdbType = String(column?.duckdbType ?? column?.type ?? "").trim().toUpperCase()
    if (!name) {
      throw new Error(`DuckDB delimited sink schema column at index ${index} is missing a name`)
    }
    if (seenNames.has(name)) {
      throw new Error(`DuckDB delimited sink schema contains duplicate column: ${name}`)
    }
    if (!duckdbType) {
      throw new Error(`DuckDB delimited sink schema column ${name} is missing a DuckDB type`)
    }
    seenNames.add(name)
    return Object.freeze({
      name,
      duckdbType,
    })
  })
}

const buildDelimitedColumnsSql = (schema) =>
  `{${schema.map((column) => `${sqlQuote(column.name)}: ${sqlQuote(column.duckdbType)}`).join(", ")}}`

const buildDelimitedBatchSql = (batchPath, schema) => `
SELECT *
FROM read_csv(
  ${sqlQuote(path.resolve(batchPath))},
  auto_detect = false,
  delim = ${sqlQuote(DELIMITED_SINK_SEPARATOR)},
  header = false,
  nullstr = ${sqlQuote(DELIMITED_SINK_NULL_SENTINEL)},
  columns = ${buildDelimitedColumnsSql(schema)}
)
`

const normalizeDelimitedBoolean = (value, columnName) => {
  if (typeof value === "boolean") return value ? "true" : "false"
  const text = String(value ?? "").trim().toLowerCase()
  if (text === "true") return "true"
  if (text === "false") return "false"
  throw new Error(`DuckDB delimited sink expected BOOLEAN for column=${columnName}`)
}

const normalizeDelimitedInteger = (value, columnName) => {
  if (typeof value === "bigint") return value.toString()
  const text = String(value ?? "").trim()
  if (!text) {
    throw new Error(`DuckDB delimited sink expected INTEGER for column=${columnName}`)
  }
  const numberValue = Number(text)
  if (!Number.isInteger(numberValue)) {
    throw new Error(`DuckDB delimited sink expected INTEGER for column=${columnName}`)
  }
  return String(numberValue)
}

const normalizeDelimitedNumeric = (value, columnName) => {
  const text = String(value ?? "").trim()
  if (!text) {
    throw new Error(`DuckDB delimited sink expected NUMERIC for column=${columnName}`)
  }
  const numberValue = Number(text)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`DuckDB delimited sink expected finite NUMERIC for column=${columnName}`)
  }
  return String(numberValue)
}

const normalizeDelimitedText = (value, columnName) => {
  const text = String(value ?? "")
  if (text === DELIMITED_SINK_NULL_SENTINEL) {
    throw new Error(
      `DuckDB delimited sink reserved null sentinel collision for column=${columnName}`,
    )
  }
  if (/[\t\r\n\0]/.test(text)) {
    throw new Error(
      `DuckDB delimited sink encountered unsupported control character for column=${columnName}`,
    )
  }
  return text
}

const encodeDelimitedValue = (value, column) => {
  if (value === undefined || value === null) return DELIMITED_SINK_NULL_SENTINEL
  const duckdbType = String(column?.duckdbType ?? "").toUpperCase()
  if (duckdbType.includes("BOOL")) {
    return normalizeDelimitedBoolean(value, column.name)
  }
  if (
    duckdbType.includes("TINYINT") ||
    duckdbType.includes("SMALLINT") ||
    duckdbType.includes("INTEGER") ||
    duckdbType.includes("BIGINT") ||
    duckdbType.includes("HUGEINT") ||
    duckdbType.includes("UBIGINT") ||
    duckdbType.includes("UINTEGER") ||
    duckdbType.includes("USMALLINT") ||
    duckdbType.includes("UTINYINT")
  ) {
    return normalizeDelimitedInteger(value, column.name)
  }
  if (
    duckdbType.includes("DOUBLE") ||
    duckdbType.includes("FLOAT") ||
    duckdbType.includes("REAL") ||
    duckdbType.includes("DECIMAL")
  ) {
    return normalizeDelimitedNumeric(value, column.name)
  }
  if (duckdbType.includes("CHAR") || duckdbType.includes("TEXT") || duckdbType.includes("STRING")) {
    return normalizeDelimitedText(value, column.name)
  }
  throw new Error(`DuckDB delimited sink does not support column type=${duckdbType}`)
}

const buildDelimitedRowSerializer = (schema) => {
  const safeSchema = normalizeDelimitedSchema(schema)
  const schemaNames = new Set(safeSchema.map((column) => column.name))
  return {
    schema: safeSchema,
    serializeRow: (row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("DuckDB delimited sink expected row objects")
      }
      for (const key of Object.keys(row)) {
        if (!schemaNames.has(key) && row[key] !== undefined) {
          throw new Error(`DuckDB delimited sink encountered unexpected column=${key}`)
        }
      }
      return safeSchema.map((column) => encodeDelimitedValue(row[column.name], column)).join(
        DELIMITED_SINK_SEPARATOR,
      )
    },
  }
}

const normalizeStructuredSinkSchema = (schema) => {
  const safeSchema = Array.isArray(schema) ? schema : []
  if (safeSchema.length < 1) {
    throw new Error("DuckDB structured sink requires at least one schema column")
  }
  const seenNames = new Set()
  return safeSchema.map((column, index) => {
    const name = String(column?.name ?? "").trim()
    const duckdbType = String(column?.duckdbType ?? column?.type ?? "").trim().toUpperCase()
    const structured = column?.structured === true || String(column?.codec ?? "").trim().toLowerCase() === "json"
    if (!name) {
      throw new Error(`DuckDB structured sink schema column at index ${index} is missing a name`)
    }
    if (seenNames.has(name)) {
      throw new Error(`DuckDB structured sink schema contains duplicate column: ${name}`)
    }
    if (!duckdbType) {
      throw new Error(`DuckDB structured sink schema column ${name} is missing a DuckDB type`)
    }
    seenNames.add(name)
    return Object.freeze({
      name,
      duckdbType,
      structured,
      defaultValue: Object.prototype.hasOwnProperty.call(column ?? {}, "defaultValue")
        ? column.defaultValue
        : undefined,
    })
  })
}

const buildStructuredSinkRowTransformer = (schema) => {
  const safeSchema = normalizeStructuredSinkSchema(schema)
  const schemaNames = new Set(safeSchema.map((column) => column.name))
  return {
    schema: safeSchema.map((column) => ({
      name: column.name,
      duckdbType: column.structured ? "TEXT" : column.duckdbType,
    })),
    transformRow: (row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("DuckDB structured sink expected row objects")
      }
      for (const key of Object.keys(row)) {
        if (!schemaNames.has(key) && row[key] !== undefined) {
          throw new Error(`DuckDB structured sink encountered unexpected column=${key}`)
        }
      }
      const nextRow = {}
      for (const column of safeSchema) {
        if (column.structured !== true) {
          nextRow[column.name] = row[column.name]
          continue
        }
        const resolvedValue =
          row[column.name] == null && Object.prototype.hasOwnProperty.call(column, "defaultValue")
            ? column.defaultValue
            : row[column.name]
        nextRow[column.name] = JSON.stringify(resolvedValue ?? null)
      }
      return nextRow
    },
  }
}

const cloneStructuredDefaultValue = (value) => {
  if (Array.isArray(value)) return value.slice()
  if (value != null && typeof value === "object") return { ...value }
  return value
}

const parseDelimitedStreamBoolean = (value, columnName) => {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  throw new Error(`DuckDB delimited query stream expected BOOLEAN for column=${columnName}`)
}

const parseDelimitedStreamInteger = (value, columnName) => {
  const normalized = String(value ?? "").trim()
  if (!normalized) {
    throw new Error(`DuckDB delimited query stream expected INTEGER for column=${columnName}`)
  }
  const numberValue = Number(normalized)
  if (!Number.isInteger(numberValue)) {
    throw new Error(`DuckDB delimited query stream expected INTEGER for column=${columnName}`)
  }
  return numberValue
}

const parseDelimitedStreamNumeric = (value, columnName) => {
  const normalized = String(value ?? "").trim()
  if (!normalized) {
    throw new Error(`DuckDB delimited query stream expected NUMERIC for column=${columnName}`)
  }
  const numberValue = Number(normalized)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`DuckDB delimited query stream expected finite NUMERIC for column=${columnName}`)
  }
  return numberValue
}

const parseDelimitedStructuredJson = (value, column) => {
  if (value == null) {
    return Object.prototype.hasOwnProperty.call(column, "defaultValue")
      ? cloneStructuredDefaultValue(column.defaultValue)
      : null
  }
  if (Array.isArray(value) || (value != null && typeof value === "object")) {
    return value
  }
  try {
    return JSON.parse(String(value))
  } catch (error) {
    throw new Error(
      `DuckDB delimited query stream expected valid structured JSON for column=${column.name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const buildDelimitedStreamRowParser = (schema) => {
  const safeSchema = normalizeStructuredSinkSchema(schema)
  return (values) => {
    if (!Array.isArray(values) || values.length !== safeSchema.length) {
      throw new Error(
        `DuckDB delimited query stream column mismatch: expected=${safeSchema.length} actual=${Array.isArray(values) ? values.length : -1}`,
      )
    }
    const row = {}
    for (let index = 0; index < safeSchema.length; index += 1) {
      const column = safeSchema[index]
      const rawValue = values[index] === DELIMITED_QUERY_NULL_SENTINEL ? null : values[index]
      if (column.structured === true) {
        row[column.name] = parseDelimitedStructuredJson(rawValue, column)
        continue
      }
      if (rawValue == null) {
        row[column.name] = null
        continue
      }
      const duckdbType = String(column.duckdbType ?? "").toUpperCase()
      if (duckdbType.includes("BOOL")) {
        row[column.name] = parseDelimitedStreamBoolean(rawValue, column.name)
        continue
      }
      if (
        duckdbType.includes("TINYINT") ||
        duckdbType.includes("SMALLINT") ||
        duckdbType.includes("INTEGER") ||
        duckdbType.includes("BIGINT") ||
        duckdbType.includes("HUGEINT") ||
        duckdbType.includes("UBIGINT") ||
        duckdbType.includes("UINTEGER") ||
        duckdbType.includes("USMALLINT") ||
        duckdbType.includes("UTINYINT")
      ) {
        row[column.name] = parseDelimitedStreamInteger(rawValue, column.name)
        continue
      }
      if (
        duckdbType.includes("DOUBLE") ||
        duckdbType.includes("FLOAT") ||
        duckdbType.includes("REAL") ||
        duckdbType.includes("DECIMAL")
      ) {
        row[column.name] = parseDelimitedStreamNumeric(rawValue, column.name)
        continue
      }
      row[column.name] = String(rawValue)
    }
    return row
  }
}

const buildPredictiveDuckdbSessionSql = (overrides = {}) => {
  const threads = sanitizePositiveInteger(overrides?.threads, sanitizePositiveInteger(DEFAULT_DUCKDB_THREADS, 2))
  const memoryLimitGb = sanitizePositiveInteger(
    overrides?.memoryLimitGb,
    sanitizePositiveInteger(DEFAULT_DUCKDB_MEMORY_LIMIT_GB, 4),
  )
  const maxTempDirectorySizeGb = sanitizePositiveInteger(
    overrides?.maxTempDirectorySizeGb,
    sanitizePositiveInteger(DEFAULT_DUCKDB_MAX_TEMP_DIRECTORY_SIZE_GB, 48),
  )
  const preserveInsertionOrder =
    overrides?.preserveInsertionOrder === true ||
    (overrides?.preserveInsertionOrder == null && DEFAULT_DUCKDB_PRESERVE_INSERTION_ORDER === true)
      ? "true"
      : "false"
  const tempDirectory =
    sanitizeOptionalPath(overrides?.tempDirectory) ?? sanitizeOptionalPath(DEFAULT_DUCKDB_TEMP_DIRECTORY)
  return [
    `SET threads=${threads};`,
    `SET memory_limit='${memoryLimitGb}GB';`,
    `SET preserve_insertion_order=${preserveInsertionOrder};`,
    tempDirectory ? `SET temp_directory=${sqlQuote(tempDirectory)};` : null,
    tempDirectory ? `SET max_temp_directory_size='${maxTempDirectorySizeGb}GB';` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

const wrapPredictiveDuckdbSql = (sql, overrides = {}) =>
  [
    buildPredictiveDuckdbSessionSql(overrides),
    String(sql ?? "").trim(),
  ]
    .filter(Boolean)
    .join("\n")

const runProcess = async ({ command, args, cwd = process.cwd() }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.setEncoding("utf8")
    proc.stderr.setEncoding("utf8")
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    proc.once("error", reject)
    proc.once("close", (code) => {
      resolve({
        ok: code === 0,
        code: Number(code ?? 1),
        stdout,
        stderr,
      })
    })
  })

const streamProcessJsonRows = async ({
  command,
  args,
  cwd = process.cwd(),
  onRow,
  inputPath = null,
}) =>
  new Promise((resolve, reject) => {
    let keepAliveFd = null
    if (inputPath) {
      keepAliveFd = fs.openSync(inputPath, fs.constants.O_RDWR)
    }
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", inputPath ? "ignore" : "pipe", "pipe"],
    })

    let stderr = ""
    let settled = false
    let procClosed = false
    let procExitCode = null
    let rowsCompleted = false
    let pendingError = null
    const inputStream = inputPath
      ? fs.createReadStream(inputPath, {
          encoding: "utf8",
        })
      : proc.stdout

    proc.stderr.setEncoding("utf8")
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    })

    const cleanup = () => {
      rl.close()
      if (inputPath && inputStream?.destroy) {
        inputStream.destroy()
      }
      if (keepAliveFd != null) {
        try {
          fs.closeSync(keepAliveFd)
        } catch {}
        keepAliveFd = null
      }
    }

    const resolveOrRejectIfReady = () => {
      if (settled) return
      if (!procClosed || !rowsCompleted) {
        return
      }
      settled = true
      cleanup()
      if (pendingError) {
        reject(pendingError)
        return
      }
      if (procExitCode === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          [
            "DuckDB row stream execution failed",
            `command=${command}`,
            `exitCode=${Number(procExitCode ?? 1)}`,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    }

    const fail = (error) => {
      if (!pendingError) {
        pendingError = error
      }
      if (!procClosed) {
        proc.kill("SIGTERM")
      }
      resolveOrRejectIfReady()
    }

    inputStream.on("error", fail)

    proc.once("error", fail)
    proc.once("close", (code) => {
      procClosed = true
      procExitCode = Number(code ?? 1)
      if (keepAliveFd != null) {
        try {
          fs.closeSync(keepAliveFd)
        } catch {}
        keepAliveFd = null
      }
      resolveOrRejectIfReady()
    })

    ;(async () => {
      try {
        for await (const line of rl) {
          const text = String(line ?? "").trim()
          if (!text) continue
          await onRow(JSON.parse(text))
        }
      } catch (error) {
        fail(error)
        return
      } finally {
        rowsCompleted = true
        resolveOrRejectIfReady()
      }
    })()
  })

const streamProcessDelimitedRows = async ({
  command,
  args,
  cwd = process.cwd(),
  onRow,
  inputPath = null,
  parseRow,
  separator = DELIMITED_SINK_SEPARATOR,
  quote = "\"",
}) =>
  new Promise((resolve, reject) => {
    let keepAliveFd = null
    if (inputPath) {
      keepAliveFd = fs.openSync(inputPath, fs.constants.O_RDWR)
    }
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", inputPath ? "ignore" : "pipe", "pipe"],
    })

    let stderr = ""
    let settled = false
    let procClosed = false
    let procExitCode = null
    let rowsCompleted = false
    let pendingError = null
    const inputStream = inputPath
      ? fs.createReadStream(inputPath, {
          encoding: "utf8",
        })
      : proc.stdout

    proc.stderr.setEncoding("utf8")
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    })

    const cleanup = () => {
      rl.close()
      if (inputPath && inputStream?.destroy) {
        inputStream.destroy()
      }
      if (keepAliveFd != null) {
        try {
          fs.closeSync(keepAliveFd)
        } catch {}
        keepAliveFd = null
      }
    }

    const resolveOrRejectIfReady = () => {
      if (settled) return
      if (!procClosed || !rowsCompleted) {
        return
      }
      settled = true
      cleanup()
      if (pendingError) {
        reject(pendingError)
        return
      }
      if (procExitCode === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          [
            "DuckDB delimited row stream execution failed",
            `command=${command}`,
            `exitCode=${Number(procExitCode ?? 1)}`,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    }

    const fail = (error) => {
      if (!pendingError) {
        pendingError = error
      }
      if (!procClosed) {
        proc.kill("SIGTERM")
      }
      resolveOrRejectIfReady()
    }

    inputStream.on("error", fail)

    proc.once("error", fail)
    proc.once("close", (code) => {
      procClosed = true
      procExitCode = Number(code ?? 1)
      if (keepAliveFd != null) {
        try {
          fs.closeSync(keepAliveFd)
        } catch {}
        keepAliveFd = null
      }
      resolveOrRejectIfReady()
    })

    ;(async () => {
      let lineNumber = 0
      try {
        for await (const line of rl) {
          lineNumber += 1
          const text = String(line ?? "")
          if (!text.trim()) continue
          const values = parseDelimitedLine(text, { separator, quote })
          const row = typeof parseRow === "function" ? parseRow(values, { lineNumber, line: text }) : values
          await onRow(row)
        }
      } catch (error) {
        fail(error)
        return
      } finally {
        rowsCompleted = true
        resolveOrRejectIfReady()
      }
    })()
  })

const duckdbArgs = (argsStyle, sql, databasePath = ":memory:") => {
  const resolvedDatabasePath = String(databasePath ?? "").trim() || ":memory:"
  if (argsStyle === "memory-db-arg" || resolvedDatabasePath !== ":memory:") {
    return [resolvedDatabasePath, "-c", sql]
  }
  return ["-c", sql]
}

const assertExecutablePath = (filePath) => {
  const resolved = path.resolve(filePath)
  if (!pathExists(resolved)) {
    throw new Error(`DuckDB CLI not found: ${resolved}`)
  }
  fs.accessSync(resolved, fs.constants.X_OK)
  return resolved
}

export const resolvePerfectPrototypeDuckdbCli = async ({
  cwd = process.cwd(),
  cliPath = process.env.PERFECT_PROTO_DUCKDB_CLI || null,
} = {}) => {
  const preferredPath = cliPath
    ? assertExecutablePath(cliPath)
    : assertExecutablePath(path.join(cwd, "tools", "bin", "duckdb"))
  const probe = await probeDuckdbCli({
    cliPath: preferredPath,
    cwd,
  })
  if (!probe.ok || !probe.argsStyle) {
    throw new Error(
      [
        "DuckDB CLI probe failed for predictive indexed mining.",
        `cliPath=${preferredPath}`,
      ].join(" "),
    )
  }
  return {
    cliPath: preferredPath,
    argsStyle: probe.argsStyle,
  }
}

export const runPerfectPrototypeDuckdbSql = async ({
  cwd = process.cwd(),
  duckdb,
  sql,
  databasePath = ":memory:",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const result = await runProcess({
    command: resolvedDuckdb.cliPath,
    args: duckdbArgs(
      resolvedDuckdb.argsStyle,
      wrapPredictiveDuckdbSql(sql, sessionOverrides),
      databasePath,
    ),
    cwd,
  })
  if (!result.ok) {
    throw new Error(
      [
        "DuckDB SQL execution failed",
        `cliPath=${resolvedDuckdb.cliPath}`,
        `exitCode=${result.code}`,
        result.stderr ? `stderr=${result.stderr.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return result
}

export const createPerfectPrototypeTempDir = async ({
  prefix = "perfect_proto_duckdb_",
} = {}) => fsp.mkdtemp(path.join(os.tmpdir(), prefix))

export const copyJsonlToParquet = async ({
  cwd = process.cwd(),
  duckdb,
  jsonlPath,
  parquetPath,
  compression = "ZSTD",
}) => {
  await ensureDir(path.dirname(parquetPath))
  const sql = `
COPY (
  SELECT *
  FROM read_json_auto(${sqlQuote(path.resolve(jsonlPath))})
) TO ${sqlQuote(path.resolve(parquetPath))} (
  FORMAT PARQUET,
  COMPRESSION ${String(compression ?? "ZSTD").trim().toUpperCase()}
);
`
  await runPerfectPrototypeDuckdbSql({
    cwd,
    duckdb,
    sql,
  })
  return parquetPath
}

export const exportDuckdbQueryToJsonl = async ({
  cwd = process.cwd(),
  duckdb,
  sql,
  outPath,
}) => {
  await ensureDir(path.dirname(outPath))
  const wrappedSql = `
COPY (
${sql}
) TO ${sqlQuote(path.resolve(outPath))} (FORMAT JSON);
`
  await runPerfectPrototypeDuckdbSql({
    cwd,
    duckdb,
    sql: wrappedSql,
  })
  return outPath
}

export const streamDuckdbQueryJsonRows = async ({
  cwd = process.cwd(),
  duckdb,
  sql,
  onRow,
  databasePath = ":memory:",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_stream_",
  })
  const fifoPath = path.join(tempDir, "rows.fifo")
  const spillDir = path.join(tempDir, "spill")
  const effectiveDatabasePath =
    databasePath === ":memory:" ? path.join(tempDir, "stream.duckdb") : databasePath
  await ensureDir(spillDir)
  await runProcess({
    command: "mkfifo",
    args: [fifoPath],
    cwd,
  }).then((result) => {
    if (!result.ok) {
      throw new Error(
        [
          "Failed to create DuckDB streaming fifo.",
          `path=${fifoPath}`,
          `exitCode=${result.code}`,
          result.stderr ? `stderr=${result.stderr.trim()}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
    }
  })
  const wrappedSql = `
COPY (
${sql}
) TO ${sqlQuote(fifoPath)} (FORMAT JSON);
`
  try {
    await streamProcessJsonRows({
      command: resolvedDuckdb.cliPath,
      args: duckdbArgs(
        resolvedDuckdb.argsStyle,
        wrapPredictiveDuckdbSql(wrappedSql, {
          ...sessionOverrides,
          tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
        }),
        effectiveDatabasePath,
      ),
      cwd,
      onRow,
      inputPath: fifoPath,
    })
  } finally {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }
}

export const streamDuckdbQueryDelimitedRows = async ({
  cwd = process.cwd(),
  duckdb,
  sql,
  schema,
  onRow,
  databasePath = ":memory:",
  sessionOverrides = {},
}) => {
  const normalizedSchema = normalizeStructuredSinkSchema(schema)
  const hasStructuredColumns = normalizedSchema.some((column) => column.structured === true)
  if (hasStructuredColumns) {
    const structuredQueryStreamMode =
      String(
        process.env.PREJUMP_STRUCTURED_QUERY_STREAM_MODE ??
          process.env.PREJUMP_QUERY_STREAM_MODE ??
          "structured",
      )
        .trim()
        .toLowerCase() || "structured"
    if (structuredQueryStreamMode !== "structured") {
      throw new Error(
        `Perfect prototype structured query stream mode must remain structured: ${structuredQueryStreamMode}`,
      )
    }
  } else {
    const queryStreamMode =
      String(process.env.PREJUMP_QUERY_STREAM_MODE ?? "delimited").trim().toLowerCase() || "delimited"
    if (queryStreamMode !== "delimited") {
      throw new Error(`Perfect prototype query stream mode must remain delimited: ${queryStreamMode}`)
    }
  }
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_delimited_stream_",
  })
  const fifoPath = path.join(tempDir, "rows.fifo")
  const spillDir = path.join(tempDir, "spill")
  const effectiveDatabasePath =
    databasePath === ":memory:" ? path.join(tempDir, "stream.duckdb") : databasePath
  const parseRow = buildDelimitedStreamRowParser(normalizedSchema)
  await ensureDir(spillDir)
  await runProcess({
    command: "mkfifo",
    args: [fifoPath],
    cwd,
  }).then((result) => {
    if (!result.ok) {
      throw new Error(
        [
          "Failed to create DuckDB delimited streaming fifo.",
          `path=${fifoPath}`,
          `exitCode=${result.code}`,
          result.stderr ? `stderr=${result.stderr.trim()}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
    }
  })
  const wrappedSql = `
COPY (
${sql}
) TO ${sqlQuote(fifoPath)} (
  FORMAT CSV,
  HEADER FALSE,
  DELIMITER ${sqlQuote(DELIMITED_SINK_SEPARATOR)},
  NULLSTR ${sqlQuote(DELIMITED_QUERY_NULL_SENTINEL)}
);
`
  try {
    await streamProcessDelimitedRows({
      command: resolvedDuckdb.cliPath,
      args: duckdbArgs(
        resolvedDuckdb.argsStyle,
        wrapPredictiveDuckdbSql(wrappedSql, {
          ...sessionOverrides,
          tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
        }),
        effectiveDatabasePath,
      ),
      cwd,
      onRow,
      parseRow,
      inputPath: fifoPath,
      separator: DELIMITED_SINK_SEPARATOR,
    })
  } finally {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }
}

export const exportParquetToJsonl = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  outPath,
  selectSql = "*",
  whereSql = null,
  orderBySql = null,
}) => {
  const clauses = [
    `SELECT ${selectSql}`,
    `FROM read_parquet(${sqlQuote(path.resolve(parquetPath))})`,
    whereSql ? `WHERE ${whereSql}` : null,
    orderBySql ? `ORDER BY ${orderBySql}` : null,
  ]
    .filter(Boolean)
    .join("\n")
  return exportDuckdbQueryToJsonl({
    cwd,
    duckdb,
    sql: clauses,
    outPath,
  })
}

export const streamParquetQueryRows = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  onRow,
  selectSql = "*",
  whereSql = null,
  orderBySql = null,
}) => {
  const clauses = [
    `SELECT ${selectSql}`,
    `FROM read_parquet(${sqlQuote(path.resolve(parquetPath))})`,
    whereSql ? `WHERE ${whereSql}` : null,
    orderBySql ? `ORDER BY ${orderBySql}` : null,
  ]
    .filter(Boolean)
    .join("\n")
  await streamDuckdbQueryJsonRows({
    cwd,
    duckdb,
    sql: clauses,
    onRow,
  })
}

export const streamParquetQueryDelimitedRows = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  schema,
  onRow,
  selectSql = "*",
  whereSql = null,
  orderBySql = null,
}) => {
  const clauses = [
    `SELECT ${selectSql}`,
    `FROM read_parquet(${sqlQuote(path.resolve(parquetPath))})`,
    whereSql ? `WHERE ${whereSql}` : null,
    orderBySql ? `ORDER BY ${orderBySql}` : null,
  ]
    .filter(Boolean)
    .join("\n")
  await streamDuckdbQueryDelimitedRows({
    cwd,
    duckdb,
    sql: clauses,
    schema,
    onRow,
  })
}

const buildStructuredDelimitedJsonSelectExpression = (columnIdentifier) => `
CASE
  WHEN ${columnIdentifier} IS NULL THEN NULL
  WHEN json_valid(CAST(${columnIdentifier} AS VARCHAR)) THEN CAST(CAST(${columnIdentifier} AS VARCHAR) AS JSON)
  ELSE to_json(${columnIdentifier})
END
`

export const buildDelimitedSelectSqlFromSchema = (schema, tableAlias = null) =>
  (Array.isArray(schema) ? schema : [])
    .map((column) => {
      const columnName = String(column?.name ?? "").trim()
      if (!columnName) return null
      const columnIdentifier = tableAlias
        ? `${sqlIdentifier(tableAlias)}.${sqlIdentifier(columnName)}`
        : sqlIdentifier(columnName)
      if (column?.structured === true) {
        return `${buildStructuredDelimitedJsonSelectExpression(columnIdentifier)} AS ${sqlIdentifier(columnName)}`
      }
      return columnIdentifier
    })
    .filter(Boolean)
    .join(",\n  ")

export const createDuckdbJsonlToParquetSink = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  compression = "ZSTD",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const resolvedParquetPath = path.resolve(parquetPath)
  await ensureDir(path.dirname(resolvedParquetPath))
  await fsp.rm(resolvedParquetPath, { force: true })
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_sink_",
  })
  const spillDir = path.join(tempDir, "spill")
  const databasePath = path.join(tempDir, "sink.duckdb")
  await ensureDir(spillDir)
  const resolvedSessionOverrides = {
    ...sessionOverrides,
    tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
  }
  const compressionSql = String(compression ?? "ZSTD").trim().toUpperCase()
  const sinkTableName = "__perfect_proto_sink__"
  const chunkFlushRows = sanitizePositiveInteger(
    process.env.PERFECT_PROTO_DUCKDB_SINK_FLUSH_ROWS ?? "4096",
    4096,
  )
  let closed = false
  let aborted = false
  let tableInitialized = false
  let chunkOrdinal = 0
  const pendingRows = []

  const cleanup = async () => {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }

  const flushPendingRows = async () => {
    if (pendingRows.length < 1) return
    const batchPath = path.join(
      tempDir,
      `sink_batch_${String(chunkOrdinal).padStart(6, "0")}.jsonl`,
    )
    chunkOrdinal += 1
    const payload = `${pendingRows.map((row) => JSON.stringify(row)).join("\n")}\n`
    pendingRows.length = 0
    await fsp.writeFile(batchPath, payload, "utf8")
    try {
      const sql = tableInitialized
        ? `
INSERT INTO ${sinkTableName}
SELECT *
FROM read_json_auto(${sqlQuote(batchPath)});
`
        : `
CREATE TABLE ${sinkTableName} AS
SELECT *
FROM read_json_auto(${sqlQuote(batchPath)});
`
      await runPerfectPrototypeDuckdbSql({
        cwd,
        duckdb: resolvedDuckdb,
        sql,
        databasePath,
        sessionOverrides: resolvedSessionOverrides,
      })
      tableInitialized = true
    } finally {
      await fsp.rm(batchPath, { force: true })
    }
  }

  const writeRow = async (row) => {
    if (closed || aborted) {
      throw new Error(`DuckDB parquet sink already closed: ${resolvedParquetPath}`)
    }
    pendingRows.push(row)
    if (pendingRows.length >= chunkFlushRows) {
      await flushPendingRows()
    }
  }

  const writeRows = async (rows) => {
    if (closed || aborted) {
      throw new Error(`DuckDB parquet sink already closed: ${resolvedParquetPath}`)
    }
    const safeRows = Array.isArray(rows) ? rows : []
    if (safeRows.length < 1) return
    for (const row of safeRows) {
      pendingRows.push(row)
      if (pendingRows.length >= chunkFlushRows) {
        await flushPendingRows()
      }
    }
  }

  const close = async () => {
    if (closed || aborted) return
    closed = true
    try {
      await flushPendingRows()
      if (tableInitialized) {
        await runPerfectPrototypeDuckdbSql({
          cwd,
          duckdb: resolvedDuckdb,
          sql: `
COPY ${sinkTableName} TO ${sqlQuote(resolvedParquetPath)} (
  FORMAT PARQUET,
  COMPRESSION ${compressionSql}
);
`,
          databasePath,
          sessionOverrides: resolvedSessionOverrides,
        })
        await ensureDuckdbParquetOutputVisible({
          parquetPath: resolvedParquetPath,
        })
      }
    } finally {
      await cleanup()
    }
  }

  const abort = async () => {
    if (aborted) return
    aborted = true
    closed = true
    pendingRows.length = 0
    await cleanup()
    await fsp.rm(resolvedParquetPath, { force: true })
  }

  return {
    writeRow,
    writeRows,
    close,
    abort,
  }
}

export const createDuckdbDelimitedToParquetSink = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  schema,
  compression = "ZSTD",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const resolvedParquetPath = path.resolve(parquetPath)
  await ensureDir(path.dirname(resolvedParquetPath))
  await fsp.rm(resolvedParquetPath, { force: true })
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_delimited_sink_",
  })
  const spillDir = path.join(tempDir, "spill")
  const databasePath = path.join(tempDir, "sink.duckdb")
  await ensureDir(spillDir)
  const resolvedSessionOverrides = {
    ...sessionOverrides,
    tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
  }
  const compressionSql = String(compression ?? "ZSTD").trim().toUpperCase()
  const sinkTableName = "__perfect_proto_sink__"
  const chunkFlushRows = sanitizePositiveInteger(
    process.env.PERFECT_PROTO_DUCKDB_SINK_FLUSH_ROWS ?? "4096",
    4096,
  )
  const { schema: normalizedSchema, serializeRow } = buildDelimitedRowSerializer(schema)
  let closed = false
  let aborted = false
  let tableInitialized = false
  let chunkOrdinal = 0
  let outputSinkRows = 0
  let outputSinkBytes = 0
  let outputSinkFlushMs = 0
  let outputParquetCopyMs = 0
  const pendingRows = []

  const cleanup = async () => {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }

  const flushPendingRows = async () => {
    if (pendingRows.length < 1) return
    const batchPath = path.join(
      tempDir,
      `sink_batch_${String(chunkOrdinal).padStart(6, "0")}.tsv`,
    )
    chunkOrdinal += 1
    const payload = `${pendingRows.map((row) => serializeRow(row)).join("\n")}\n`
    outputSinkRows += pendingRows.length
    outputSinkBytes += Buffer.byteLength(payload, "utf8")
    pendingRows.length = 0
    const flushStartedAt = Date.now()
    await fsp.writeFile(batchPath, payload, "utf8")
    try {
      const sql = tableInitialized
        ? `
INSERT INTO ${sinkTableName}
${buildDelimitedBatchSql(batchPath, normalizedSchema)};
`
        : `
CREATE TABLE ${sinkTableName} AS
${buildDelimitedBatchSql(batchPath, normalizedSchema)};
`
      await runPerfectPrototypeDuckdbSql({
        cwd,
        duckdb: resolvedDuckdb,
        sql,
        databasePath,
        sessionOverrides: resolvedSessionOverrides,
      })
      tableInitialized = true
    } finally {
      outputSinkFlushMs += Date.now() - flushStartedAt
      await fsp.rm(batchPath, { force: true })
    }
  }

  const writeRow = async (row) => {
    if (closed || aborted) {
      throw new Error(`DuckDB delimited parquet sink already closed: ${resolvedParquetPath}`)
    }
    pendingRows.push(row)
    if (pendingRows.length >= chunkFlushRows) {
      await flushPendingRows()
    }
  }

  const writeRows = async (rows) => {
    if (closed || aborted) {
      throw new Error(`DuckDB delimited parquet sink already closed: ${resolvedParquetPath}`)
    }
    const safeRows = Array.isArray(rows) ? rows : []
    if (safeRows.length < 1) return
    for (const row of safeRows) {
      pendingRows.push(row)
      if (pendingRows.length >= chunkFlushRows) {
        await flushPendingRows()
      }
    }
  }

  const close = async () => {
    if (closed || aborted) return
    closed = true
    try {
      await flushPendingRows()
      if (tableInitialized) {
        const copyStartedAt = Date.now()
        await runPerfectPrototypeDuckdbSql({
          cwd,
          duckdb: resolvedDuckdb,
          sql: `
COPY ${sinkTableName} TO ${sqlQuote(resolvedParquetPath)} (
  FORMAT PARQUET,
  COMPRESSION ${compressionSql}
);
`,
          databasePath,
          sessionOverrides: resolvedSessionOverrides,
        })
        await ensureDuckdbParquetOutputVisible({
          parquetPath: resolvedParquetPath,
        })
        outputParquetCopyMs += Date.now() - copyStartedAt
      }
    } finally {
      await cleanup()
    }
  }

  const abort = async () => {
    if (aborted) return
    aborted = true
    closed = true
    pendingRows.length = 0
    await cleanup()
    await fsp.rm(resolvedParquetPath, { force: true })
  }

  return {
    writeRow,
    writeRows,
    close,
    abort,
    getStats: () => ({
      outputSinkRows,
      outputSinkBytes,
      outputSinkFlushMs: Number(outputSinkFlushMs.toFixed(3)),
      outputParquetCopyMs: Number(outputParquetCopyMs.toFixed(3)),
    }),
  }
}

export const createDuckdbStructuredToParquetSink = async ({
  cwd = process.cwd(),
  duckdb,
  parquetPath,
  schema,
  compression = "ZSTD",
  sessionOverrides = {},
}) => {
  const { schema: transformedSchema, transformRow } = buildStructuredSinkRowTransformer(schema)
  const sink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: transformedSchema,
    compression,
    sessionOverrides,
  })
  return {
    writeRow: async (row) => sink.writeRow(transformRow(row)),
    writeRows: async (rows) =>
      sink.writeRows((Array.isArray(rows) ? rows : []).map((row) => transformRow(row))),
    close: async () => sink.close(),
    abort: async () => sink.abort(),
    getStats: () => sink.getStats(),
  }
}

export const createDuckdbJsonlToTableSink = async ({
  cwd = process.cwd(),
  duckdb,
  tableName = "__perfect_proto_sink__",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_table_sink_",
  })
  const spillDir = path.join(tempDir, "spill")
  const databasePath = path.join(tempDir, "sink.duckdb")
  await ensureDir(spillDir)
  const resolvedSessionOverrides = {
    ...sessionOverrides,
    tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
  }
  const resolvedTableName = String(tableName ?? "__perfect_proto_sink__").trim() || "__perfect_proto_sink__"
  const chunkFlushRows = sanitizePositiveInteger(
    process.env.PERFECT_PROTO_DUCKDB_SINK_FLUSH_ROWS ?? "4096",
    4096,
  )
  let closed = false
  let aborted = false
  let tableInitialized = false
  let chunkOrdinal = 0
  const pendingRows = []

  const cleanup = async () => {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }

  const flushPendingRows = async () => {
    if (pendingRows.length < 1) return
    const batchPath = path.join(
      tempDir,
      `sink_batch_${String(chunkOrdinal).padStart(6, "0")}.jsonl`,
    )
    chunkOrdinal += 1
    const payload = `${pendingRows.map((row) => JSON.stringify(row)).join("\n")}\n`
    pendingRows.length = 0
    await fsp.writeFile(batchPath, payload, "utf8")
    try {
      const sql = tableInitialized
        ? `
INSERT INTO ${resolvedTableName}
SELECT *
FROM read_json_auto(${sqlQuote(batchPath)});
`
        : `
CREATE TABLE ${resolvedTableName} AS
SELECT *
FROM read_json_auto(${sqlQuote(batchPath)});
`
      await runPerfectPrototypeDuckdbSql({
        cwd,
        duckdb: resolvedDuckdb,
        sql,
        databasePath,
        sessionOverrides: resolvedSessionOverrides,
      })
      tableInitialized = true
    } finally {
      await fsp.rm(batchPath, { force: true })
    }
  }

  const writeRow = async (row) => {
    if (closed || aborted) {
      throw new Error(`DuckDB table sink already closed: ${resolvedTableName}`)
    }
    pendingRows.push(row)
    if (pendingRows.length >= chunkFlushRows) {
      await flushPendingRows()
    }
  }

  const writeRows = async (rows) => {
    if (closed || aborted) {
      throw new Error(`DuckDB table sink already closed: ${resolvedTableName}`)
    }
    const safeRows = Array.isArray(rows) ? rows : []
    if (safeRows.length < 1) return
    for (const row of safeRows) {
      pendingRows.push(row)
      if (pendingRows.length >= chunkFlushRows) {
        await flushPendingRows()
      }
    }
  }

  const streamRows = async ({
    schema,
    selectSql = null,
    whereSql = null,
    orderBySql = null,
    onRow,
  }) => {
    if (aborted) {
      throw new Error(`DuckDB table sink already aborted: ${resolvedTableName}`)
    }
    await flushPendingRows()
    if (!tableInitialized) return
    const tableStreamMode =
      String(process.env.PREJUMP_TABLE_STREAM_MODE ?? "delimited").trim().toLowerCase() || "delimited"
    if (tableStreamMode !== "delimited") {
      throw new Error(`Perfect prototype table stream mode must remain delimited: ${tableStreamMode}`)
    }
    const normalizedSchema = normalizeStructuredSinkSchema(schema)
    if (normalizedSchema.length < 1) {
      throw new Error(
        `DuckDB table sink streamRows requires an explicit schema on the canonical path: ${resolvedTableName}`,
      )
    }
    const effectiveSelectSql =
      String(selectSql ?? "").trim() || buildDelimitedSelectSqlFromSchema(normalizedSchema)
    const sql = [
      `SELECT ${effectiveSelectSql}`,
      `FROM ${resolvedTableName}`,
      whereSql ? `WHERE ${whereSql}` : null,
      orderBySql ? `ORDER BY ${orderBySql}` : null,
    ]
      .filter(Boolean)
      .join("\n")
    await streamDuckdbQueryDelimitedRows({
      cwd,
      duckdb: resolvedDuckdb,
      sql,
      schema: normalizedSchema,
      onRow,
      databasePath,
      sessionOverrides: resolvedSessionOverrides,
    })
  }

  const copyToParquet = async ({
    parquetPath,
    compression = "ZSTD",
  }) => {
    if (aborted) {
      throw new Error(`DuckDB table sink already aborted: ${resolvedTableName}`)
    }
    await flushPendingRows()
    if (!tableInitialized) {
      throw new Error(`DuckDB table sink has no rows to export: ${resolvedTableName}`)
    }
    const resolvedParquetPath = path.resolve(parquetPath)
    await ensureDir(path.dirname(resolvedParquetPath))
    await fsp.rm(resolvedParquetPath, { force: true })
    const compressionSql = String(compression ?? "ZSTD").trim().toUpperCase()
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb: resolvedDuckdb,
      sql: `
COPY ${resolvedTableName} TO ${sqlQuote(resolvedParquetPath)} (
  FORMAT PARQUET,
  COMPRESSION ${compressionSql}
);
`,
      databasePath,
      sessionOverrides: resolvedSessionOverrides,
    })
    return resolvedParquetPath
  }

  const close = async () => {
    if (closed || aborted) return
    closed = true
    pendingRows.length = 0
    await cleanup()
  }

  const abort = async () => {
    if (aborted) return
    aborted = true
    closed = true
    pendingRows.length = 0
    await cleanup()
  }

  return {
    writeRow,
    writeRows,
    streamRows,
    copyToParquet,
    close,
    abort,
  }
}

export const createDuckdbDelimitedToTableSink = async ({
  cwd = process.cwd(),
  duckdb,
  schema,
  tableName = "__perfect_proto_sink__",
  sessionOverrides = {},
}) => {
  const resolvedDuckdb =
    duckdb ??
    (await resolvePerfectPrototypeDuckdbCli({
      cwd,
    }))
  const tempDir = await createPerfectPrototypeTempDir({
    prefix: "perfect_proto_duckdb_delimited_table_sink_",
  })
  const spillDir = path.join(tempDir, "spill")
  const databasePath = path.join(tempDir, "sink.duckdb")
  await ensureDir(spillDir)
  const resolvedSessionOverrides = {
    ...sessionOverrides,
    tempDirectory: sessionOverrides?.tempDirectory ?? spillDir,
  }
  const resolvedTableName = String(tableName ?? "__perfect_proto_sink__").trim() || "__perfect_proto_sink__"
  const chunkFlushRows = sanitizePositiveInteger(
    process.env.PERFECT_PROTO_DUCKDB_SINK_FLUSH_ROWS ?? "4096",
    4096,
  )
  const { schema: normalizedSchema, serializeRow } = buildDelimitedRowSerializer(schema)
  let closed = false
  let aborted = false
  let tableInitialized = false
  let chunkOrdinal = 0
  let outputSinkRows = 0
  let outputSinkBytes = 0
  let outputSinkFlushMs = 0
  let outputParquetCopyMs = 0
  const pendingRows = []

  const cleanup = async () => {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true,
    })
  }

  const flushPendingRows = async () => {
    if (pendingRows.length < 1) return
    const batchPath = path.join(
      tempDir,
      `sink_batch_${String(chunkOrdinal).padStart(6, "0")}.tsv`,
    )
    chunkOrdinal += 1
    const payload = `${pendingRows.map((row) => serializeRow(row)).join("\n")}\n`
    outputSinkRows += pendingRows.length
    outputSinkBytes += Buffer.byteLength(payload, "utf8")
    pendingRows.length = 0
    const flushStartedAt = Date.now()
    await fsp.writeFile(batchPath, payload, "utf8")
    try {
      const sql = tableInitialized
        ? `
INSERT INTO ${resolvedTableName}
${buildDelimitedBatchSql(batchPath, normalizedSchema)};
`
        : `
CREATE TABLE ${resolvedTableName} AS
${buildDelimitedBatchSql(batchPath, normalizedSchema)};
`
      await runPerfectPrototypeDuckdbSql({
        cwd,
        duckdb: resolvedDuckdb,
        sql,
        databasePath,
        sessionOverrides: resolvedSessionOverrides,
      })
      tableInitialized = true
    } finally {
      outputSinkFlushMs += Date.now() - flushStartedAt
      await fsp.rm(batchPath, { force: true })
    }
  }

  const writeRow = async (row) => {
    if (closed || aborted) {
      throw new Error(`DuckDB delimited table sink already closed: ${resolvedTableName}`)
    }
    pendingRows.push(row)
    if (pendingRows.length >= chunkFlushRows) {
      await flushPendingRows()
    }
  }

  const writeRows = async (rows) => {
    if (closed || aborted) {
      throw new Error(`DuckDB delimited table sink already closed: ${resolvedTableName}`)
    }
    const safeRows = Array.isArray(rows) ? rows : []
    if (safeRows.length < 1) return
    for (const row of safeRows) {
      pendingRows.push(row)
      if (pendingRows.length >= chunkFlushRows) {
        await flushPendingRows()
      }
    }
  }

  const streamRows = async ({
    schema = normalizedSchema,
    selectSql = null,
    whereSql = null,
    orderBySql = null,
    onRow,
  }) => {
    if (aborted) {
      throw new Error(`DuckDB delimited table sink already aborted: ${resolvedTableName}`)
    }
    await flushPendingRows()
    if (!tableInitialized) return
    const tableStreamMode =
      String(process.env.PREJUMP_TABLE_STREAM_MODE ?? "delimited").trim().toLowerCase() || "delimited"
    if (tableStreamMode !== "delimited") {
      throw new Error(`Perfect prototype table stream mode must remain delimited: ${tableStreamMode}`)
    }
    const resolvedSchema = normalizeStructuredSinkSchema(schema)
    if (resolvedSchema.length < 1) {
      throw new Error(
        `DuckDB delimited table sink streamRows requires an explicit schema on the canonical path: ${resolvedTableName}`,
      )
    }
    const effectiveSelectSql =
      String(selectSql ?? "").trim() || buildDelimitedSelectSqlFromSchema(resolvedSchema)
    const sql = [
      `SELECT ${effectiveSelectSql}`,
      `FROM ${resolvedTableName}`,
      whereSql ? `WHERE ${whereSql}` : null,
      orderBySql ? `ORDER BY ${orderBySql}` : null,
    ]
      .filter(Boolean)
      .join("\n")
    await streamDuckdbQueryDelimitedRows({
      cwd,
      duckdb: resolvedDuckdb,
      sql,
      schema: resolvedSchema,
      onRow,
      databasePath,
      sessionOverrides: resolvedSessionOverrides,
    })
  }

  const copyToParquet = async ({
    parquetPath,
    compression = "ZSTD",
  }) => {
    if (aborted) {
      throw new Error(`DuckDB delimited table sink already aborted: ${resolvedTableName}`)
    }
    await flushPendingRows()
    if (!tableInitialized) {
      throw new Error(`DuckDB delimited table sink has no rows to export: ${resolvedTableName}`)
    }
    const resolvedParquetPath = path.resolve(parquetPath)
    await ensureDir(path.dirname(resolvedParquetPath))
    await fsp.rm(resolvedParquetPath, { force: true })
    const compressionSql = String(compression ?? "ZSTD").trim().toUpperCase()
    const copyStartedAt = Date.now()
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb: resolvedDuckdb,
      sql: `
COPY ${resolvedTableName} TO ${sqlQuote(resolvedParquetPath)} (
  FORMAT PARQUET,
  COMPRESSION ${compressionSql}
);
`,
      databasePath,
      sessionOverrides: resolvedSessionOverrides,
    })
    outputParquetCopyMs += Date.now() - copyStartedAt
    return resolvedParquetPath
  }

  const close = async () => {
    if (closed || aborted) return
    closed = true
    pendingRows.length = 0
    await cleanup()
  }

  const abort = async () => {
    if (aborted) return
    aborted = true
    closed = true
    pendingRows.length = 0
    await cleanup()
  }

  return {
    writeRow,
    writeRows,
    streamRows,
    copyToParquet,
    close,
    abort,
    getStats: () => ({
      outputSinkRows,
      outputSinkBytes,
      outputSinkFlushMs: Number(outputSinkFlushMs.toFixed(3)),
      outputParquetCopyMs: Number(outputParquetCopyMs.toFixed(3)),
    }),
  }
}

export const buildInlineValuesJsonSql = (rows, columns) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeColumns = Array.isArray(columns) ? columns : []
  if (safeRows.length < 1) {
    throw new Error("buildInlineValuesJsonSql requires at least one row")
  }
  if (safeColumns.length < 1) {
    throw new Error("buildInlineValuesJsonSql requires at least one column")
  }
  const selectRows = safeRows.map((row) => {
    const payload = safeColumns
      .map((column) => {
        const key = String(column ?? "").trim()
        return `${sqlQuote(key)}: ${sqlQuote(row?.[key] ?? "")}`
      })
      .join(", ")
    return `SELECT ${payload}`
  })
  return selectRows.join("\nUNION ALL\n")
}

export { sqlIdentifier, sqlQuote }
