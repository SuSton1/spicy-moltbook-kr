import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir, pathExists, readJson, writeJson } from "./io.mjs"
import { unwrapPerfectPrototypeTypedParquetWrapperRow } from "./perfect_prototype_parquet_io.mjs"
import {
  appendPerfectPrototypeDeltaPostingsToFile,
  openPerfectPrototypePostingsFile,
} from "./perfect_prototype_postings_codec.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  createDuckdbDelimitedToTableSink,
  resolvePerfectPrototypeDuckdbCli,
  sqlQuote,
  streamDuckdbQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
  assertNoPrejumpLeakageRow,
} from "./perfect_prototype_prejump_contract.mjs"
import {
  assertPerfectPrototypeCleanOutputDir,
  buildPerfectPrototypeDirectIndexProvenanceRecord,
  buildPerfectPrototypePartitionStateHash,
} from "./perfect_prototype_index_provenance.mjs"
import {
  assertPerfectPrototypeTokenizerSpecIntegrity,
  PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  buildPerfectPrototypeTokenizerSpecHash,
} from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import { collectPerfectPrototypeTokenizerFeatureStatsRowsFromFeatureValueSidecars } from "./perfect_prototype_exact_quantile_merge.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "./perfect_prototype_structured_sink_schemas.mjs"
import {
  resolvePerfectPrototypeFeaturePrefixes,
  summarizePerfectPrototypeTokenizerSpec,
  tokenizePerfectPrototypeRow,
} from "./perfect_prototype_tokenizer.mjs"

const TOKEN_INDEX_ROW_META_BATCH_SIZE = 512
const TOKEN_INDEX_POSTINGS_BATCH_SIZE = 4096
const TOKEN_INDEX_STATS_BATCH_SIZE = 512
const PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED = "delimited"
export const PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE = "perfect_prototype_prejump_pack"

export const PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION = 2
export const PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS = Object.freeze([
  "token",
  "positiveOffset",
  "positiveByteLength",
  "positiveCount",
  "positiveFirstRowIdx",
  "positiveLastRowIdx",
  "negativeOffset",
  "negativeByteLength",
  "negativeCount",
  "negativeFirstRowIdx",
  "negativeLastRowIdx",
  "positiveMatchCount",
  "negativeMatchCount",
  "precision",
  "separationRatio",
  "separationLift",
])
export const PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "rowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "sourceType", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "sourceId", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "dateKey", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "symbol", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "outcomeHitTarget", duckdbType: "BOOLEAN" }),
  Object.freeze({ name: "strategyMode", duckdbType: "VARCHAR" }),
])
export const PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "rowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "stepALaneId", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "impulseLookbackDays", duckdbType: "BIGINT" }),
])
export const PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "token", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "rowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "outcomeHitTarget", duckdbType: "BOOLEAN" }),
])
export const PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "token", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "positiveMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "precision", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationRatio", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationLift", duckdbType: "DOUBLE" }),
])
export const PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA = Object.freeze([
  Object.freeze({ name: "token", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "positiveOffset", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveByteLength", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveFirstRowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveLastRowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeOffset", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeByteLength", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeFirstRowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeLastRowIdx", duckdbType: "BIGINT" }),
  Object.freeze({ name: "positiveMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "negativeMatchCount", duckdbType: "BIGINT" }),
  Object.freeze({ name: "precision", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationRatio", duckdbType: "DOUBLE" }),
  Object.freeze({ name: "separationLift", duckdbType: "DOUBLE" }),
])
const PERFECT_PROTOTYPE_ORDERED_WRAPPER_STREAM_SCHEMA = Object.freeze([
  Object.freeze({ name: "globalRowIdx", duckdbType: "BIGINT" }),
  ...PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
])

const buildTokenizerFeatureStatsStreamSchema = (binCount) => {
  const schema = [
    Object.freeze({ name: "featureKey", duckdbType: "VARCHAR" }),
    Object.freeze({ name: "count", duckdbType: "BIGINT" }),
    Object.freeze({ name: "min", duckdbType: "DOUBLE" }),
    Object.freeze({ name: "max", duckdbType: "DOUBLE" }),
  ]
  for (let index = 1; index < binCount; index += 1) {
    schema.push(
      Object.freeze({
        name: `q_${String(index).padStart(2, "0")}`,
        duckdbType: "DOUBLE",
      }),
    )
  }
  return Object.freeze(schema)
}

const buildParquetInputSql = (inputPaths) => {
  const resolvedPaths = (Array.isArray(inputPaths) ? inputPaths : [inputPaths])
    .map((filePath) => path.resolve(String(filePath ?? "").trim()))
    .filter(Boolean)
  if (resolvedPaths.length < 1) {
    throw new Error("buildParquetInputSql requires at least one parquet input path")
  }
  if (resolvedPaths.length === 1) {
    return `read_parquet(${sqlQuote(resolvedPaths[0])})`
  }
  return `read_parquet([${resolvedPaths.map((filePath) => sqlQuote(filePath)).join(", ")}])`
}

const clampInteger = (value, fallback, min, max) => {
  const n = Math.floor(Number(value))
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite),
    ),
  ).sort((left, right) => left - right)

const uniqueSortedStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const toFiniteNonNegativeInteger = (value, label, tokenDictionaryParquetPath, token) => {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(
      `Invalid ${label} in token_dictionary.parquet for token=${token}: ${tokenDictionaryParquetPath}`,
    )
  }
  return normalized
}

const toFiniteNumber = (value, label, tokenDictionaryParquetPath, token) => {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    throw new Error(
      `Invalid ${label} in token_dictionary.parquet for token=${token}: ${tokenDictionaryParquetPath}`,
    )
  }
  return normalized
}

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const readOptionalJson = async (filePath) => {
  if (!pathExists(filePath)) return null
  return readJson(filePath, null)
}

const updateProgress = async (progressPath, payload) => {
  await writeJson(progressPath, payload)
}

const removePerfectPrototypeIndexArtifacts = async (paths) => {
  for (const filePath of Array.isArray(paths) ? paths : []) {
    const resolvedPath = String(filePath ?? "").trim()
    if (!resolvedPath) continue
    await fsp.rm(resolvedPath, { force: true }).catch(() => {})
  }
}

const buildTimedProgressPayload = ({
  payload,
  startedAtMs = null,
  estimatedRows = null,
  estimatedTokens = null,
  estimatedStates = null,
}) => {
  const next = {
    ...payload,
    rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    updatedAt: new Date().toISOString(),
  }
  const elapsedSec =
    Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0.001, (Date.now() - startedAtMs) / 1000)
      : null
  if (!elapsedSec) {
    next.rowsPerSec = null
    next.tokensPerSec = null
    next.exploredStatesPerSec = null
    next.etaSeconds = null
    return next
  }
  const rowsScanned = Number(payload?.rowsScanned ?? 0)
  const tokensIndexed = Number(payload?.tokensIndexed ?? 0)
  const exploredStates = Number(payload?.exploredStates ?? 0)
  const rowsPerSec = rowsScanned > 0 ? rowsScanned / elapsedSec : 0
  const tokensPerSec = tokensIndexed > 0 ? tokensIndexed / elapsedSec : 0
  const exploredStatesPerSec = exploredStates > 0 ? exploredStates / elapsedSec : 0
  const etaCandidates = []
  if (Number.isFinite(estimatedRows) && estimatedRows > rowsScanned && rowsPerSec > 0) {
    etaCandidates.push((estimatedRows - rowsScanned) / rowsPerSec)
  }
  if (Number.isFinite(estimatedTokens) && estimatedTokens > tokensIndexed && tokensPerSec > 0) {
    etaCandidates.push((estimatedTokens - tokensIndexed) / tokensPerSec)
  }
  if (Number.isFinite(estimatedStates) && estimatedStates > exploredStates && exploredStatesPerSec > 0) {
    etaCandidates.push((estimatedStates - exploredStates) / exploredStatesPerSec)
  }
  next.rowsPerSec = Number(rowsPerSec.toFixed(3))
  next.tokensPerSec = Number(tokensPerSec.toFixed(3))
  next.exploredStatesPerSec = Number(exploredStatesPerSec.toFixed(3))
  next.etaSeconds =
    etaCandidates.length > 0 ? Number(Math.max(...etaCandidates).toFixed(1)) : payload?.phase === "completed" ? 0 : null
  return next
}

export const collectPerfectPrototypeTokenizerFeatureStatsRows = async ({
  cwd,
  duckdb,
  inputPaths,
  binCount,
}) => {
  const numericFeatureMapJsonSql =
    "CASE " +
    "WHEN json_valid(CAST(p.numericFeatureMap AS VARCHAR)) THEN CAST(CAST(p.numericFeatureMap AS VARCHAR) AS JSON) " +
    "ELSE to_json(p.numericFeatureMap) " +
    "END"
  const quantileColumns = []
  for (let index = 1; index < binCount; index += 1) {
    const q = index / binCount
    quantileColumns.push(
      `quantile_cont(featureValue, ${q}) AS q_${String(index).padStart(2, "0")}`,
    )
  }
  const rows = []
  await streamDuckdbQueryDelimitedRows({
    cwd,
    duckdb,
    schema: buildTokenizerFeatureStatsStreamSchema(binCount),
    sql: `
WITH feature_values AS (
  SELECT
    CAST(j.key AS VARCHAR) AS featureKey,
    CAST(j.value AS DOUBLE) AS featureValue
  FROM ${buildParquetInputSql(inputPaths)} p,
       json_each(${numericFeatureMapJsonSql}) j
)
SELECT
  featureKey,
  COUNT(*) AS count,
  MIN(featureValue) AS min,
  MAX(featureValue) AS max,
  ${quantileColumns.join(",\n  ")}
FROM feature_values
GROUP BY featureKey
HAVING COUNT(*) >= 2
ORDER BY featureKey
`,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  return rows
}

export const buildPerfectPrototypeTokenizerSpecFromFeatureStatsRows = ({
  rows,
  surfaceName,
  binCount,
  includeSymbolToken,
  includeMissingTokens,
  includeCategoricalTokens,
}) => {
  const numericFeatures = (Array.isArray(rows) ? rows : []).map((row) => {
    const edges = []
    for (let index = 1; index < binCount; index += 1) {
      const boundary = Number(row?.[`q_${String(index).padStart(2, "0")}`])
      if (!Number.isFinite(boundary)) continue
      edges.push(boundary)
    }
    return {
      featureKey: String(row?.featureKey ?? "").trim(),
      edges: uniqueSortedNumbers(edges),
      count: Number(row?.count ?? 0),
      min: Number(row?.min),
      max: Number(row?.max),
    }
  })
    .filter((row) => row.featureKey)
    .sort((left, right) => left.featureKey.localeCompare(right.featureKey))

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    surface: surfaceName,
    options: {
      surfaceName,
      binCount,
      includeSymbolToken,
      includeMissingTokens,
      includeCategoricalTokens,
      includeFeaturePrefixes: resolvePerfectPrototypeFeaturePrefixes(surfaceName),
      excludeFeaturePrefixes: [],
    },
    numericFeatures,
  }
}

export const buildPerfectPrototypeTokenizerSpecFromParquetInputs = async ({
  cwd = process.cwd(),
  duckdb,
  inputPaths,
  featureStatsInputPaths = null,
  featureValueInputs = null,
  statsTarget = null,
  surfaceName,
  binCount,
  includeSymbolToken,
  includeMissingTokens,
  includeCategoricalTokens,
}) => {
  if (Array.isArray(featureStatsInputPaths) && featureStatsInputPaths.length > 0) {
    throw new Error(
      [
        "Predictive tokenizer-spec build no longer accepts feature_stats.parquet featureValues fallback.",
        "Rebuild the affected feature-store partitions so they contain exact feature_values sidecars.",
      ].join("\n"),
    )
  }
  const featureStatsRows =
    Array.isArray(featureValueInputs) && featureValueInputs.length > 0
      ? await collectPerfectPrototypeTokenizerFeatureStatsRowsFromFeatureValueSidecars({
          cwd,
          featureValueInputs,
          binCount,
          statsTarget,
        })
      : await collectPerfectPrototypeTokenizerFeatureStatsRows({
          cwd,
          duckdb,
          inputPaths,
          binCount,
        })
  return buildPerfectPrototypeTokenizerSpecFromFeatureStatsRows({
    rows: featureStatsRows,
    surfaceName,
    binCount,
    includeSymbolToken,
    includeMissingTokens,
    includeCategoricalTokens,
  })
}

const buildPackCoverage = ({ manifest, summary }) =>
  summary?.effectiveDecisionCoverage ??
  manifest?.summary?.effectiveDecisionCoverage ??
  summary?.outputCoverage ??
  manifest?.summary?.outputCoverage ??
  summary?.period ??
  manifest?.summary?.period ??
  null

const buildPackRequestedDecisionRange = ({ manifest, summary }) =>
  summary?.requestedDecisionRange ??
  manifest?.summary?.requestedDecisionRange ??
  summary?.requestedPeriod ??
  manifest?.summary?.requestedPeriod ??
  summary?.period ??
  manifest?.summary?.period ??
  null

const buildPackEffectiveDecisionCoverage = ({ manifest, summary }) =>
  summary?.effectiveDecisionCoverage ??
  manifest?.summary?.effectiveDecisionCoverage ??
  summary?.outputCoverage ??
  manifest?.summary?.outputCoverage ??
  summary?.period ??
  manifest?.summary?.period ??
  null

const buildTokenDictionarySelectedSql = ({ parquetPath, tokens = null }) => {
  const inputSql = buildParquetInputSql([parquetPath])
  const normalizedTokens = uniqueSortedStrings(tokens)
  if (normalizedTokens.length < 1) {
    return `
SELECT *
FROM ${inputSql}
ORDER BY token
`
  }
  const valuesSql = normalizedTokens.map((token) => `(${sqlQuote(token)})`).join(",\n  ")
  return `
WITH selected_tokens(token) AS (
  VALUES
  ${valuesSql}
)
SELECT
  ${buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA, "d")}
FROM ${inputSql} d
INNER JOIN selected_tokens s ON d.token = s.token
ORDER BY d.token
`
}

export const streamPerfectPrototypeTokenDictionaryEntries = async ({
  cwd = process.cwd(),
  duckdb,
  tokenDictionaryParquetPath,
  tokens = null,
  onRow,
}) => {
  const resolvedParquetPath = path.resolve(String(tokenDictionaryParquetPath ?? "").trim())
  if (!resolvedParquetPath) {
    throw new Error("streamPerfectPrototypeTokenDictionaryEntries requires tokenDictionaryParquetPath")
  }
  await streamDuckdbQueryDelimitedRows({
    cwd,
    duckdb,
    schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
    sql: buildTokenDictionarySelectedSql({
      parquetPath: resolvedParquetPath,
      tokens,
    }),
    onRow,
  })
}

export const loadPerfectPrototypeTokenDictionaryEntriesByTokens = async ({
  cwd = process.cwd(),
  duckdb,
  tokenDictionaryParquetPath,
  tokens,
  expectedUniqueTokenCount = null,
}) => {
  const requestedTokens = uniqueSortedStrings(tokens)
  const resolvedExpectedUniqueTokenCount =
    Number.isInteger(Number(expectedUniqueTokenCount)) && Number(expectedUniqueTokenCount) >= 0
      ? Number(expectedUniqueTokenCount)
      : requestedTokens.length > 0
        ? requestedTokens.length
        : null
  const entriesByToken = new Map()
  let previousToken = null
  await streamPerfectPrototypeTokenDictionaryEntries({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens,
    onRow: async (row) => {
      const token = String(row?.token ?? "").trim()
      if (!token) {
        throw new Error(`Invalid token in token_dictionary.parquet: ${tokenDictionaryParquetPath}`)
      }
      if (previousToken && token <= previousToken) {
        throw new Error(
          `token_dictionary.parquet must contain strictly ascending unique tokens: current=${token} previous=${previousToken} path=${tokenDictionaryParquetPath}`,
        )
      }
      previousToken = token
      if (entriesByToken.has(token)) {
        throw new Error(`Duplicate token in token_dictionary.parquet: token=${token} path=${tokenDictionaryParquetPath}`)
      }
      entriesByToken.set(token, {
        token,
        positiveOffset: toFiniteNonNegativeInteger(
          row?.positiveOffset ?? 0,
          "positiveOffset",
          tokenDictionaryParquetPath,
          token,
        ),
        positiveByteLength: toFiniteNonNegativeInteger(
          row?.positiveByteLength ?? 0,
          "positiveByteLength",
          tokenDictionaryParquetPath,
          token,
        ),
        positiveCount: toFiniteNonNegativeInteger(
          row?.positiveCount ?? 0,
          "positiveCount",
          tokenDictionaryParquetPath,
          token,
        ),
        positiveFirstRowIdx: toFiniteNonNegativeInteger(
          row?.positiveFirstRowIdx ?? 0,
          "positiveFirstRowIdx",
          tokenDictionaryParquetPath,
          token,
        ),
        positiveLastRowIdx: toFiniteNonNegativeInteger(
          row?.positiveLastRowIdx ?? 0,
          "positiveLastRowIdx",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeOffset: toFiniteNonNegativeInteger(
          row?.negativeOffset ?? 0,
          "negativeOffset",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeByteLength: toFiniteNonNegativeInteger(
          row?.negativeByteLength ?? 0,
          "negativeByteLength",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeCount: toFiniteNonNegativeInteger(
          row?.negativeCount ?? 0,
          "negativeCount",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeFirstRowIdx: toFiniteNonNegativeInteger(
          row?.negativeFirstRowIdx ?? 0,
          "negativeFirstRowIdx",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeLastRowIdx: toFiniteNonNegativeInteger(
          row?.negativeLastRowIdx ?? 0,
          "negativeLastRowIdx",
          tokenDictionaryParquetPath,
          token,
        ),
        positiveMatchCount: toFiniteNonNegativeInteger(
          row?.positiveMatchCount ?? 0,
          "positiveMatchCount",
          tokenDictionaryParquetPath,
          token,
        ),
        negativeMatchCount: toFiniteNonNegativeInteger(
          row?.negativeMatchCount ?? 0,
          "negativeMatchCount",
          tokenDictionaryParquetPath,
          token,
        ),
        precision: toFiniteNumber(row?.precision ?? 0, "precision", tokenDictionaryParquetPath, token),
        separationRatio: toFiniteNumber(
          row?.separationRatio ?? 0,
          "separationRatio",
          tokenDictionaryParquetPath,
          token,
        ),
        separationLift: toFiniteNumber(
          row?.separationLift ?? 0,
          "separationLift",
          tokenDictionaryParquetPath,
          token,
        ),
      })
    },
  })
  if (resolvedExpectedUniqueTokenCount != null && entriesByToken.size !== resolvedExpectedUniqueTokenCount) {
    throw new Error(
      `token_dictionary.parquet selected token count mismatch: actual=${entriesByToken.size} expected=${resolvedExpectedUniqueTokenCount} path=${tokenDictionaryParquetPath}`,
    )
  }
  return entriesByToken
}

export const buildPerfectPrototypeTokenIndex = async ({
  cwd = process.cwd(),
  inputPath = null,
  outDir,
  options = {},
}) => {
  const resolvedInputPaths = (
    Array.isArray(options?.inputPaths) && options.inputPaths.length > 0
      ? options.inputPaths
      : [inputPath]
  )
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (resolvedInputPaths.length < 1) {
    throw new Error("buildPerfectPrototypeTokenIndex requires at least one predictive parquet input")
  }
  const resolvedInputPath = resolvedInputPaths[0]
  const resolvedOutDir = path.resolve(outDir)
  await assertPerfectPrototypeCleanOutputDir({
    dirPath: resolvedOutDir,
    label: "direct token-index outDir",
  })
  await ensureDir(resolvedOutDir)

  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const progressPath = path.join(resolvedOutDir, "progress.json")

  const manifestPath =
    resolvedInputPaths.length === 1 ? path.join(path.dirname(resolvedInputPath), "manifest.json") : null
  const summaryPath =
    resolvedInputPaths.length === 1 ? path.join(path.dirname(resolvedInputPath), "summary.json") : null
  const manifest = manifestPath ? await readOptionalJson(manifestPath) : null
  const summary = summaryPath ? await readOptionalJson(summaryPath) : null

  const surfaceName =
    String(options?.surfaceName ?? summary?.contextSurface ?? PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE)
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE
  if (surfaceName !== PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE) {
    throw new Error(
      `Predictive token index build requires surface=${PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE}, got ${surfaceName}`,
    )
  }
  const binCount = clampInteger(options?.binCount, 5, 2, 10)
  const includeSymbolToken = toBoolean(options?.includeSymbolToken, false)
  const includeMissingTokens = toBoolean(options?.includeMissingTokens, false)
  const includeCategoricalTokens = toBoolean(options?.includeCategoricalTokens, true)
  const emitTokenPostingsParquet = toBoolean(options?.emitTokenPostingsParquet, false)
  const outputSinkMode =
    String(
      options?.outputSinkMode ??
        process.env.PREJUMP_INDEX_OUTPUT_SINK_MODE ??
        PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED,
    )
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED
  if (outputSinkMode !== PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED) {
    throw new Error(
      `Perfect prototype token index output sink mode must remain ${PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED}: ${outputSinkMode}`,
    )
  }

  const tokenizerSpecPath = path.join(resolvedOutDir, "tokenizer_spec.json")
  const rowMetaParquetPath = path.join(resolvedOutDir, "row_meta.parquet")
  const tokenPostingsParquetPath = path.join(resolvedOutDir, "token_postings.parquet")
  const tokenPostingsBinPath = path.join(resolvedOutDir, "token_postings.bin")
  const tokenDictionaryParquetPath = path.join(resolvedOutDir, "token_dictionary.parquet")
  const tokenDictionaryPath = path.join(resolvedOutDir, "token_dictionary.json")
  const tokenStatsParquetPath = path.join(resolvedOutDir, "token_stats.parquet")
  const manifestOutPath = path.join(resolvedOutDir, "manifest.json")
  const summaryOutPath = path.join(resolvedOutDir, "summary.json")
  const artifactPaths = [
    tokenizerSpecPath,
    rowMetaParquetPath,
    tokenPostingsParquetPath,
    tokenPostingsBinPath,
    tokenDictionaryParquetPath,
    tokenDictionaryPath,
    tokenStatsParquetPath,
    manifestOutPath,
    summaryOutPath,
  ]
  const estimatedRowCount = Number(summary?.rowCount ?? manifest?.rowCount ?? 0)
  const tokenizePhaseStartedAt = Date.now()
  let buildSucceeded = false
  const tokenizerBuildStats = {}

  try {
    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "tokenizer_spec_query",
          rowsScanned: 0,
          rowsTokenized: 0,
          tokensIndexed: 0,
          seedTokensSelected: 0,
          exploredStates: 0,
          rulesCollected: 0,
        },
        startedAtMs: tokenizePhaseStartedAt,
        estimatedRows: estimatedRowCount > 0 ? estimatedRowCount : null,
      }),
    )

    const tokenizerSpec =
      options?.tokenizerSpec && typeof options.tokenizerSpec === "object"
        ? options.tokenizerSpec
        : await buildPerfectPrototypeTokenizerSpecFromParquetInputs({
            cwd,
            duckdb,
            inputPaths: resolvedInputPaths,
            featureStatsInputPaths:
              Array.isArray(options?.featureStatsInputPaths) && options.featureStatsInputPaths.length > 0
                ? options.featureStatsInputPaths
                : null,
            statsTarget: tokenizerBuildStats,
            surfaceName,
            binCount,
            includeSymbolToken,
            includeMissingTokens,
            includeCategoricalTokens,
          })
    const tokenizerSurface =
      String(tokenizerSpec?.surface ?? "").trim().toLowerCase() || null
    if (tokenizerSurface !== surfaceName) {
      throw new Error(
        `Predictive token index tokenizerSpec surface mismatch: expected=${surfaceName} actual=${tokenizerSurface ?? "<missing>"}`,
      )
    }
    await writeJson(tokenizerSpecPath, tokenizerSpec)

    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "stream_pack_rows",
          rowsScanned: 0,
          rowsTokenized: 0,
          tokensIndexed: 0,
          seedTokensSelected: 0,
          exploredStates: 0,
          rulesCollected: 0,
        },
        startedAtMs: tokenizePhaseStartedAt,
        estimatedRows: estimatedRowCount > 0 ? estimatedRowCount : null,
      }),
    )

    const rowMetaSink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: rowMetaParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
    })
    const tokenPostingsSink = await createDuckdbDelimitedToTableSink({
      cwd,
      duckdb,
      tableName: "__perfect_proto_token_postings__",
      schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
    })
    let rowMetaAndPostingsSucceeded = false
    const tokenStats = new Map()
    let rowsScanned = 0
    let rowsTokenized = 0
    let tokenRows = 0
    let lastProgressAt = Date.now()
    const rowMetaBatch = []
    const tokenPostingsBatch = []
    const flushRowMetaBatch = async () => {
      if (rowMetaBatch.length < 1) return
      await rowMetaSink.writeRows(rowMetaBatch)
      rowMetaBatch.length = 0
    }
    const flushTokenPostingsBatch = async () => {
      if (tokenPostingsBatch.length < 1) return
      await tokenPostingsSink.writeRows(tokenPostingsBatch)
      tokenPostingsBatch.length = 0
    }
    try {
      await streamDuckdbQueryDelimitedRows({
        cwd,
        duckdb,
        schema: PERFECT_PROTOTYPE_ORDERED_WRAPPER_STREAM_SCHEMA,
        sql: `
WITH ordered_rows AS (
  SELECT
    row_number() OVER (ORDER BY dateKey, rowOrdinal, sourceId, symbol) - 1 AS globalRowIdx,
    *
  FROM ${buildParquetInputSql(resolvedInputPaths)}
)
SELECT
  ${buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_ORDERED_WRAPPER_STREAM_SCHEMA)}
FROM ordered_rows
ORDER BY globalRowIdx
`,
        onRow: async (wrapper) => {
          const row = unwrapPerfectPrototypeTypedParquetWrapperRow(wrapper)
          assertNoPrejumpLeakageRow(row)
          const rowIdx = Number(wrapper?.globalRowIdx)
          if (!Number.isInteger(rowIdx) || rowIdx < 0) {
            throw new Error(`Invalid globalRowIdx in predictive token index stream: ${resolvedInputPaths.join(",")}`)
          }
          const rowMeta = {
            rowIdx: rowIdx,
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            dateKey: row.dateKey,
            symbol: row.symbol,
            outcomeHitTarget: row.outcomeHitTarget,
            strategyMode: row.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
          }
          rowMetaBatch.push(rowMeta)
          if (rowMetaBatch.length >= TOKEN_INDEX_ROW_META_BATCH_SIZE) {
            await flushRowMetaBatch()
          }
          rowsScanned += 1
          const tokens = tokenizePerfectPrototypeRow(row, tokenizerSpec)
          rowsTokenized += 1
          for (const token of tokens) {
            tokenPostingsBatch.push({
              token,
              rowIdx: rowIdx,
              outcomeHitTarget: row.outcomeHitTarget,
            })
            if (tokenPostingsBatch.length >= TOKEN_INDEX_POSTINGS_BATCH_SIZE) {
              await flushTokenPostingsBatch()
            }
            tokenRows += 1
            const current = tokenStats.get(token) ?? {
              token,
              positiveMatchCount: 0,
              negativeMatchCount: 0,
            }
            if (row.outcomeHitTarget === true) {
              current.positiveMatchCount += 1
            } else if (row.outcomeHitTarget === false) {
              current.negativeMatchCount += 1
            }
            tokenStats.set(token, current)
          }
          if (Date.now() - lastProgressAt >= 30000) {
            lastProgressAt = Date.now()
            await updateProgress(
              progressPath,
              buildTimedProgressPayload({
                payload: {
                  phase: "tokenize_rows",
                  rowsScanned,
                  rowsTokenized,
                  tokensIndexed: tokenRows,
                  seedTokensSelected: 0,
                  exploredStates: 0,
                  rulesCollected: 0,
                },
                startedAtMs: tokenizePhaseStartedAt,
                estimatedRows: estimatedRowCount > 0 ? estimatedRowCount : null,
              }),
            )
          }
        },
      })
      await flushRowMetaBatch()
      await flushTokenPostingsBatch()
      rowMetaAndPostingsSucceeded = true
    } finally {
      if (!rowMetaAndPostingsSucceeded) {
        await rowMetaSink.abort()
        await tokenPostingsSink.abort()
      }
    }
    await rowMetaSink.close()

    if (rowsScanned < 1) {
      throw new Error(`Predictive token index build found no rows in pack: ${resolvedInputPath}`)
    }

    const tokenStatsRows = Array.from(tokenStats.values())
      .map((entry) => {
        const matchCount = entry.positiveMatchCount + entry.negativeMatchCount
        return {
          token: entry.token,
          positiveMatchCount: entry.positiveMatchCount,
          negativeMatchCount: entry.negativeMatchCount,
          precision: matchCount > 0 ? entry.positiveMatchCount / matchCount : 0,
          separationRatio: entry.positiveMatchCount / (entry.negativeMatchCount + 1),
          separationLift: entry.positiveMatchCount - entry.negativeMatchCount,
        }
      })
      .sort((left, right) => String(left.token).localeCompare(String(right.token)))
    if (tokenStatsRows.length < 1) {
      throw new Error(
        `Predictive token index build found no tokens after tokenization: ${resolvedInputPath}`,
      )
    }
    const tokenStatsSink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: tokenStatsParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
    })
    let tokenStatsSucceeded = false
    try {
      const tokenStatsBatch = []
      const flushTokenStatsBatch = async () => {
        if (tokenStatsBatch.length < 1) return
        await tokenStatsSink.writeRows(tokenStatsBatch)
        tokenStatsBatch.length = 0
      }
      for (const row of tokenStatsRows) {
        tokenStatsBatch.push(row)
        if (tokenStatsBatch.length >= TOKEN_INDEX_STATS_BATCH_SIZE) {
          await flushTokenStatsBatch()
        }
      }
      await flushTokenStatsBatch()
      tokenStatsSucceeded = true
    } finally {
      if (!tokenStatsSucceeded) {
        await tokenStatsSink.abort()
      }
    }
    await tokenStatsSink.close()

    await fsp.rm(tokenPostingsBinPath, { force: true })
    const postingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "w")
    const tokenStatsByToken = new Map(tokenStatsRows.map((row) => [row.token, row]))
    const tokenDictionarySink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: tokenDictionaryParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
    })
    const tokenDictionaryBatch = []
    const flushTokenDictionaryBatch = async () => {
      if (tokenDictionaryBatch.length < 1) return
      await tokenDictionarySink.writeRows(tokenDictionaryBatch)
      tokenDictionaryBatch.length = 0
    }
    let tokenDictionaryCount = 0
    let postingsByteOffset = 0
    let tokenPostingsRowsStreamed = 0
    let tokenPostingsTableStreamMs = 0
    const tokenPostingsTableStreamMode =
      String(process.env.PREJUMP_TABLE_STREAM_MODE ?? "delimited").trim().toLowerCase() || "delimited"
    if (tokenPostingsTableStreamMode !== "delimited") {
      throw new Error(
        `Perfect prototype token postings table stream mode must remain delimited: ${tokenPostingsTableStreamMode}`,
      )
    }
    let currentToken = null
    let currentPositiveRowIndexes = []
    let currentNegativeRowIndexes = []
    const flushCompressedToken = async () => {
      if (!currentToken) return
      const positiveMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: currentPositiveRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += positiveMeta.byteLength
      const negativeMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: currentNegativeRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += negativeMeta.byteLength
      const stat = tokenStatsByToken.get(currentToken)
      tokenDictionaryBatch.push({
        token: currentToken,
        positiveOffset: positiveMeta.offset,
        positiveByteLength: positiveMeta.byteLength,
        positiveCount: positiveMeta.count,
        positiveFirstRowIdx: positiveMeta.firstRowIdx,
        positiveLastRowIdx: positiveMeta.lastRowIdx,
        negativeOffset: negativeMeta.offset,
        negativeByteLength: negativeMeta.byteLength,
        negativeCount: negativeMeta.count,
        negativeFirstRowIdx: negativeMeta.firstRowIdx,
        negativeLastRowIdx: negativeMeta.lastRowIdx,
        positiveMatchCount: Number(stat?.positiveMatchCount ?? positiveMeta.count),
        negativeMatchCount: Number(stat?.negativeMatchCount ?? negativeMeta.count),
        precision: Number(stat?.precision ?? 0),
        separationRatio: Number(stat?.separationRatio ?? 0),
        separationLift: Number(stat?.separationLift ?? 0),
      })
      tokenDictionaryCount += 1
      if (tokenDictionaryBatch.length >= TOKEN_INDEX_STATS_BATCH_SIZE) {
        await flushTokenDictionaryBatch()
      }
      currentToken = null
      currentPositiveRowIndexes = []
      currentNegativeRowIndexes = []
    }
    try {
      const tokenPostingsStreamStartedAt = Date.now()
      await tokenPostingsSink.streamRows({
        schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
        selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA),
        orderBySql: "token, rowIdx",
        onRow: async (row) => {
          tokenPostingsRowsStreamed += 1
          const token = String(row?.token ?? "").trim()
          if (!token) return
          if (currentToken && token !== currentToken) {
            await flushCompressedToken()
          }
          if (!currentToken) {
            currentToken = token
          }
          const rowIdx = Number(row?.rowIdx)
          if (!Number.isInteger(rowIdx) || rowIdx < 0) return
          if (row?.outcomeHitTarget === true) {
            currentPositiveRowIndexes.push(rowIdx)
          } else if (row?.outcomeHitTarget === false) {
            currentNegativeRowIndexes.push(rowIdx)
          }
        },
      })
      tokenPostingsTableStreamMs = Date.now() - tokenPostingsStreamStartedAt
      await flushCompressedToken()
      if (emitTokenPostingsParquet) {
        await tokenPostingsSink.copyToParquet({
          parquetPath: tokenPostingsParquetPath,
        })
      }
      await flushTokenDictionaryBatch()
    } finally {
      await postingsHandle.close()
      await tokenPostingsSink.close().catch(() => {})
      await tokenDictionarySink.close().catch(() => {})
    }
    await writeJson(tokenDictionaryPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      tokenCount: tokenDictionaryCount,
      tokenPostingsBinPath,
      tokenDictionaryParquetPath,
    })

    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "parquet_export",
          rowsScanned,
          rowsTokenized,
          tokensIndexed: tokenRows,
          seedTokensSelected: 0,
          exploredStates: 0,
          rulesCollected: 0,
        },
        startedAtMs: tokenizePhaseStartedAt,
        estimatedRows: estimatedRowCount > 0 ? estimatedRowCount : null,
      }),
    )

    const tokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec)
    const manifestPayload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      partitioned: false,
      inputPath: resolvedInputPath,
      inputPaths: resolvedInputPaths,
      sourceType: PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE,
      strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
      surfaceName,
      tokenizerSpecPath,
      tokenizerSpecHash,
      tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
      rowMetaParquetPath,
      tokenPostingsParquetPath: emitTokenPostingsParquet ? tokenPostingsParquetPath : null,
      tokenPostingsBinPath,
      tokenDictionaryParquetPath,
      tokenDictionaryPath,
      tokenStatsParquetPath,
      packManifestPath: manifestPath && pathExists(manifestPath) ? manifestPath : null,
      packSummaryPath: summaryPath && pathExists(summaryPath) ? summaryPath : null,
      requestedDecisionRange: buildPackRequestedDecisionRange({
        manifest,
        summary,
      }),
      effectiveDecisionCoverage: buildPackEffectiveDecisionCoverage({
        manifest,
        summary,
      }),
      outputCoverage:
        options?.coverageOverride ??
        buildPackCoverage({
          manifest,
          summary,
        }),
      rowCount: rowsScanned,
      tokenPostingCount: tokenRows,
      tokenCount: tokenStatsRows.length,
      outputSinkMode,
      tokenDictionarySchemaVersion: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
      tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
      tokenPostingsTableStreamMode,
      tokenPostingsRowsStreamed,
      tokenPostingsTableStreamMs: Number(tokenPostingsTableStreamMs.toFixed(3)),
      quantileMergeMs: Number(tokenizerBuildStats.quantileMergeMs ?? 0),
      fdPoolPeak: Number(tokenizerBuildStats.fdPoolPeak ?? 0),
      rowMetaOutputSinkStats: rowMetaSink.getStats(),
      tokenPostingsOutputSinkStats: tokenPostingsSink.getStats(),
      tokenStatsOutputSinkStats: tokenStatsSink.getStats(),
      tokenDictionaryOutputSinkStats: tokenDictionarySink.getStats(),
    }
    const inputProvenance = buildPerfectPrototypeDirectIndexProvenanceRecord({
      inputPath: resolvedInputPath,
      inputPaths: resolvedInputPaths,
      inputStateHash: await buildPerfectPrototypePartitionStateHash(resolvedInputPaths),
      packManifestPath: manifestPayload.packManifestPath,
      packSummaryPath: manifestPayload.packSummaryPath,
      requestedDecisionRange: manifestPayload.requestedDecisionRange,
      effectiveDecisionCoverage: manifestPayload.effectiveDecisionCoverage,
      outputCoverage: manifestPayload.outputCoverage,
    })
    manifestPayload.inputProvenance = inputProvenance
    await writeJson(manifestOutPath, manifestPayload)
    await writeJson(summaryOutPath, {
      ...manifestPayload,
      tokenizer: summarizePerfectPrototypeTokenizerSpec(tokenizerSpec),
    })
    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "completed",
          rowsScanned,
          rowsTokenized,
          tokensIndexed: tokenRows,
          seedTokensSelected: 0,
          exploredStates: 0,
          rulesCollected: 0,
          quantileMergeMs: Number(tokenizerBuildStats.quantileMergeMs ?? 0),
          fdPoolPeak: Number(tokenizerBuildStats.fdPoolPeak ?? 0),
        },
        startedAtMs: tokenizePhaseStartedAt,
        estimatedRows: estimatedRowCount > 0 ? estimatedRowCount : null,
      }),
    )
    buildSucceeded = true

    return {
      tokenizerSpecPath,
      rowMetaParquetPath,
      tokenPostingsParquetPath: emitTokenPostingsParquet ? tokenPostingsParquetPath : null,
      tokenPostingsBinPath,
      tokenDictionaryParquetPath,
      tokenDictionaryPath,
      tokenStatsParquetPath,
      manifestPath: manifestOutPath,
      summaryPath: summaryOutPath,
    }
  } finally {
    if (!buildSucceeded) {
      await removePerfectPrototypeIndexArtifacts(artifactPaths)
    }
  }
}

export const loadPerfectPrototypeIndexedArtifacts = async (indexDir) => {
  const resolvedIndexDir = path.resolve(indexDir)
  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const tokenizerSpecPath = path.join(resolvedIndexDir, "tokenizer_spec.json")
  const manifest = await readOptionalJson(manifestPath)
  const summary = await readOptionalJson(summaryPath)
  const tokenizerSpec = await readOptionalJson(tokenizerSpecPath)
  if (!manifest || !summary || !tokenizerSpec) {
    throw new Error(`Indexed predictive artifacts are incomplete: ${resolvedIndexDir}`)
  }
  const tokenizerFingerprint = assertPerfectPrototypeTokenizerSpecIntegrity({
    indexDir: resolvedIndexDir,
    tokenizerSpec,
    manifest,
    summary,
  })
  return {
    indexDir: resolvedIndexDir,
    manifest,
    summary,
    tokenizerSpec,
    tokenizerSpecHash: tokenizerFingerprint.tokenizerSpecHash,
    tokenizerSpecFingerprintVersion: tokenizerFingerprint.tokenizerSpecFingerprintVersion,
    rowMetaParquetPath:
      String(manifest?.rowMetaParquetPath ?? "").trim() ||
      path.join(resolvedIndexDir, "row_meta.parquet"),
    tokenPostingsParquetPath:
      String(manifest?.tokenPostingsParquetPath ?? "").trim() || null,
    tokenPostingsBinPath:
      String(manifest?.tokenPostingsBinPath ?? "").trim() ||
      path.join(resolvedIndexDir, "token_postings.bin"),
    tokenDictionaryParquetPath:
      String(manifest?.tokenDictionaryParquetPath ?? "").trim() ||
      path.join(resolvedIndexDir, "token_dictionary.parquet"),
    tokenDictionaryPath:
      String(manifest?.tokenDictionaryPath ?? "").trim() ||
      path.join(resolvedIndexDir, "token_dictionary.json"),
    tokenStatsParquetPath:
      String(manifest?.tokenStatsParquetPath ?? "").trim() ||
      path.join(resolvedIndexDir, "token_stats.parquet"),
  }
}
