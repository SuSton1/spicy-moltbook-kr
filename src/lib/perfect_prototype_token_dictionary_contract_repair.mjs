import path from "node:path"
import fsp from "node:fs/promises"

import { pathExists, readJsonIfExistsStrict, writeJsonAtomic } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  runPerfectPrototypeDuckdbSql,
  sqlQuote,
  streamDuckdbQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  openPerfectPrototypePostingsFile,
  readPerfectPrototypePostingBufferFromFile,
  summarizePerfectPrototypeDeltaPostingBuffer,
} from "./perfect_prototype_postings_codec.mjs"
import {
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
} from "./perfect_prototype_token_index.mjs"

const PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED = "delimited"
const PERFECT_PROTOTYPE_TOKEN_POSTINGS_TABLE_STREAM_MODE_DELIMITED = "delimited"

export const PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_REQUIRED_COLUMNS = Object.freeze([
  "token",
  "positiveOffset",
  "positiveByteLength",
  "positiveCount",
  "negativeOffset",
  "negativeByteLength",
  "negativeCount",
  "positiveMatchCount",
  "negativeMatchCount",
  "precision",
  "separationRatio",
  "separationLift",
])

export const PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "token", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "positiveOffset", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveByteLength", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeOffset", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeByteLength", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "precision", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationRatio", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationLift", duckdbType: "DOUBLE" }),
])

const buildLegacyTokenDictionarySelectedSql = (parquetPath) => `
SELECT
  ${buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_SINK_SCHEMA, "d")}
FROM read_parquet(${sqlQuote(path.resolve(parquetPath))}) d
ORDER BY d.token
`

export const streamPerfectPrototypeLegacyTokenDictionaryV1Entries = async ({
  cwd = process.cwd(),
  duckdb,
  tokenDictionaryParquetPath,
  onRow,
}) => {
  const resolvedParquetPath = path.resolve(String(tokenDictionaryParquetPath ?? "").trim())
  if (!resolvedParquetPath) {
    throw new Error(
      "streamPerfectPrototypeLegacyTokenDictionaryV1Entries requires tokenDictionaryParquetPath",
    )
  }
  await streamDuckdbQueryDelimitedRows({
    cwd,
    duckdb,
    schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_SINK_SCHEMA,
    sql: buildLegacyTokenDictionarySelectedSql(resolvedParquetPath),
    onRow,
  })
}

const toFiniteNonNegativeInteger = (value, label, token, parquetPath) => {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(
      `Legacy token_dictionary.parquet has invalid ${label}: token=${token} path=${parquetPath}`,
    )
  }
  return normalized
}

const toFiniteNumber = (value, label, token, parquetPath) => {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    throw new Error(
      `Legacy token_dictionary.parquet has invalid ${label}: token=${token} path=${parquetPath}`,
    )
  }
  return normalized
}

const normalizeLegacyTokenDictionaryEntry = (row, parquetPath) => {
  const token = String(row?.token ?? "").trim()
  if (!token) {
    throw new Error(`Legacy token_dictionary.parquet has an empty token: ${parquetPath}`)
  }
  return {
    token,
    positiveOffset: toFiniteNonNegativeInteger(
      row?.positiveOffset ?? 0,
      "positiveOffset",
      token,
      parquetPath,
    ),
    positiveByteLength: toFiniteNonNegativeInteger(
      row?.positiveByteLength ?? 0,
      "positiveByteLength",
      token,
      parquetPath,
    ),
    positiveCount: toFiniteNonNegativeInteger(
      row?.positiveCount ?? 0,
      "positiveCount",
      token,
      parquetPath,
    ),
    negativeOffset: toFiniteNonNegativeInteger(
      row?.negativeOffset ?? 0,
      "negativeOffset",
      token,
      parquetPath,
    ),
    negativeByteLength: toFiniteNonNegativeInteger(
      row?.negativeByteLength ?? 0,
      "negativeByteLength",
      token,
      parquetPath,
    ),
    negativeCount: toFiniteNonNegativeInteger(
      row?.negativeCount ?? 0,
      "negativeCount",
      token,
      parquetPath,
    ),
    positiveMatchCount: toFiniteNonNegativeInteger(
      row?.positiveMatchCount ?? 0,
      "positiveMatchCount",
      token,
      parquetPath,
    ),
    negativeMatchCount: toFiniteNonNegativeInteger(
      row?.negativeMatchCount ?? 0,
      "negativeMatchCount",
      token,
      parquetPath,
    ),
    precision: toFiniteNumber(row?.precision ?? 0, "precision", token, parquetPath),
    separationRatio: toFiniteNumber(
      row?.separationRatio ?? 0,
      "separationRatio",
      token,
      parquetPath,
    ),
    separationLift: toFiniteNumber(
      row?.separationLift ?? 0,
      "separationLift",
      token,
      parquetPath,
    ),
  }
}

const hasCurrentDictionarySchemaColumns = async ({ cwd, duckdb, parquetPath }) => {
  try {
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb,
      sql: `
SELECT
  ${PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS.join(",\n  ")}
FROM read_parquet(${sqlQuote(path.resolve(parquetPath))})
LIMIT 0
`,
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      /Binder Error/i.test(message) ||
      /Referenced column/i.test(message) ||
      /does not have a column named/i.test(message) ||
      /No function matches/i.test(message)
    ) {
      return false
    }
    throw error
  }
}

const collectLegacyTokenDictionaryEntries = async ({
  cwd,
  duckdb,
  tokenDictionaryParquetPath,
}) => {
  const entries = []
  let previousToken = null
  await streamPerfectPrototypeLegacyTokenDictionaryV1Entries({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    onRow: async (row) => {
      const normalized = normalizeLegacyTokenDictionaryEntry(row, tokenDictionaryParquetPath)
      if (previousToken && normalized.token <= previousToken) {
        throw new Error(
          `Legacy token_dictionary.parquet must preserve ascending unique tokens: current=${normalized.token} previous=${previousToken} path=${tokenDictionaryParquetPath}`,
        )
      }
      previousToken = normalized.token
      entries.push(normalized)
    },
  })
  return entries
}

const buildCanonicalDictionaryContractPatch = ({ payload, dictionaryRowCount }) => ({
  ...payload,
  outputSinkMode:
    String(payload?.outputSinkMode ?? "").trim().toLowerCase() ||
    PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED,
  tokenPostingsTableStreamMode:
    String(payload?.tokenPostingsTableStreamMode ?? "").trim().toLowerCase() ||
    PERFECT_PROTOTYPE_TOKEN_POSTINGS_TABLE_STREAM_MODE_DELIMITED,
  tokenDictionarySchemaVersion: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
  tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
  tokenDictionaryOutputSinkStats:
    payload?.tokenDictionaryOutputSinkStats && typeof payload.tokenDictionaryOutputSinkStats === "object"
      ? {
          ...payload.tokenDictionaryOutputSinkStats,
          outputSinkRows: Number(
            payload.tokenDictionaryOutputSinkStats?.outputSinkRows ?? dictionaryRowCount,
          ),
        }
      : {
          outputSinkRows: Number(dictionaryRowCount),
        },
})

const summarizePostingRangeForLegacyEntry = async ({
  postingsHandle,
  postingsPath,
  entry,
  side,
}) => {
  const offset = Number(side === "positive" ? entry.positiveOffset : entry.negativeOffset)
  const byteLength = Number(
    side === "positive" ? entry.positiveByteLength : entry.negativeByteLength,
  )
  const expectedCount = Number(side === "positive" ? entry.positiveCount : entry.negativeCount)
  const buffer = await readPerfectPrototypePostingBufferFromFile({
    fileHandle: postingsHandle,
    filePath: postingsPath,
    offset,
    byteLength,
  })
  const summary = summarizePerfectPrototypeDeltaPostingBuffer(buffer, expectedCount)
  if (summary.count !== expectedCount) {
    throw new Error(
      [
        "Legacy token_dictionary.parquet postings metadata count mismatch.",
        `token=${entry.token}`,
        `side=${side}`,
        `expected=${expectedCount}`,
        `actual=${summary.count}`,
        `tokenPostingsBinPath=${postingsPath}`,
      ].join("\n"),
    )
  }
  return summary
}

export const upgradePerfectPrototypeLegacyTokenDictionarySchemaV1Artifacts = async ({
  cwd = process.cwd(),
  indexDir,
  write = true,
}) => {
  const resolvedIndexDir = path.resolve(String(indexDir ?? "").trim() || process.cwd())
  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const manifest = await readJsonIfExistsStrict(manifestPath)
  const summary = await readJsonIfExistsStrict(summaryPath)
  if (!manifest || typeof manifest !== "object" || !summary || typeof summary !== "object") {
    throw new Error(
      [
        "Legacy shard dictionary upgrade requires manifest.json and summary.json.",
        `indexDir=${resolvedIndexDir}`,
        `manifestPath=${manifestPath}`,
        `summaryPath=${summaryPath}`,
      ].join("\n"),
    )
  }
  const tokenDictionaryParquetPath = path.resolve(
    String(
      manifest?.tokenDictionaryParquetPath ?? path.join(resolvedIndexDir, "token_dictionary.parquet"),
    ),
  )
  const tokenPostingsBinPath = path.resolve(
    String(manifest?.tokenPostingsBinPath ?? path.join(resolvedIndexDir, "token_postings.bin")),
  )
  if (!pathExists(tokenDictionaryParquetPath)) {
    throw new Error(
      `Legacy shard dictionary upgrade requires token_dictionary.parquet: ${tokenDictionaryParquetPath}`,
    )
  }
  if (!pathExists(tokenPostingsBinPath)) {
    throw new Error(
      `Legacy shard dictionary upgrade requires token_postings.bin: ${tokenPostingsBinPath}`,
    )
  }
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const parquetAlreadyCurrent = await hasCurrentDictionarySchemaColumns({
    cwd,
    duckdb,
    parquetPath: tokenDictionaryParquetPath,
  })
  const manifestDeclaredColumns = new Set(
    (Array.isArray(manifest?.tokenDictionaryRequiredColumns)
      ? manifest.tokenDictionaryRequiredColumns
      : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const summaryDeclaredColumns = new Set(
    (Array.isArray(summary?.tokenDictionaryRequiredColumns)
      ? summary.tokenDictionaryRequiredColumns
      : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const metadataCurrent =
    Number(manifest?.tokenDictionarySchemaVersion ?? 0) >=
      PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION &&
    Number(summary?.tokenDictionarySchemaVersion ?? 0) >=
      PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION &&
    PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS.every((column) =>
      manifestDeclaredColumns.has(column),
    ) &&
    PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS.every((column) =>
      summaryDeclaredColumns.has(column),
    ) &&
    String(manifest?.outputSinkMode ?? "").trim().toLowerCase() ===
      PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED &&
    String(summary?.outputSinkMode ?? "").trim().toLowerCase() ===
      PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED
  if (parquetAlreadyCurrent && metadataCurrent) {
    return {
      indexDir: resolvedIndexDir,
      repaired: false,
      changedFiles: [],
      upgradedDictionary: false,
      dictionaryRowCount: Number(manifest?.tokenCount ?? summary?.tokenCount ?? 0),
      tokenDictionaryParquetPath,
      tokenPostingsBinPath,
    }
  }

  const legacyEntries = await collectLegacyTokenDictionaryEntries({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
  })
  const postingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r")
  const upgradedEntries = []
  try {
    for (const entry of legacyEntries) {
      const positiveMeta = await summarizePostingRangeForLegacyEntry({
        postingsHandle,
        postingsPath: tokenPostingsBinPath,
        entry,
        side: "positive",
      })
      const negativeMeta = await summarizePostingRangeForLegacyEntry({
        postingsHandle,
        postingsPath: tokenPostingsBinPath,
        entry,
        side: "negative",
      })
      upgradedEntries.push({
        ...entry,
        positiveFirstRowIdx: positiveMeta.firstRowIdx,
        positiveLastRowIdx: positiveMeta.lastRowIdx,
        negativeFirstRowIdx: negativeMeta.firstRowIdx,
        negativeLastRowIdx: negativeMeta.lastRowIdx,
      })
    }
  } finally {
    await postingsHandle.close().catch(() => {})
  }

  const changedFiles = []
  const nextManifest = buildCanonicalDictionaryContractPatch({
    payload: manifest,
    dictionaryRowCount: upgradedEntries.length,
  })
  const nextSummary = buildCanonicalDictionaryContractPatch({
    payload: summary,
    dictionaryRowCount: upgradedEntries.length,
  })

  const maybeWriteJson = async (filePath, currentValue, nextValue) => {
    if (JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null)) return
    changedFiles.push(filePath)
    if (write) {
      await writeJsonAtomic(filePath, nextValue)
    }
  }

  if (!parquetAlreadyCurrent) {
    changedFiles.push(tokenDictionaryParquetPath)
    if (write) {
      const tempParquetPath = path.join(
        path.dirname(tokenDictionaryParquetPath),
        `.${path.basename(tokenDictionaryParquetPath)}.upgrade-${process.pid}-${Date.now()}.tmp`,
      )
      const sink = await createDuckdbDelimitedToParquetSink({
        cwd,
        duckdb,
        parquetPath: tempParquetPath,
        schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
      })
      try {
        await sink.writeRows(upgradedEntries)
        await sink.close()
        await fsp.rename(tempParquetPath, tokenDictionaryParquetPath)
      } catch (error) {
        await sink.abort().catch(() => {})
        await fsp.rm(tempParquetPath, { force: true }).catch(() => {})
        throw error
      }
    }
  }
  await maybeWriteJson(manifestPath, manifest, nextManifest)
  await maybeWriteJson(summaryPath, summary, nextSummary)

  return {
    indexDir: resolvedIndexDir,
    repaired: changedFiles.length > 0,
    changedFiles,
    upgradedDictionary: !parquetAlreadyCurrent,
    dictionaryRowCount: upgradedEntries.length,
    tokenDictionaryParquetPath,
    tokenPostingsBinPath,
  }
}
