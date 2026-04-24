import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir, iterateDelimited, parseDelimitedLine, pathExists, readJson, writeJson } from "./io.mjs"
import {
  assertPerfectPrototypeIndexProvenanceCompatible,
  assertPerfectPrototypeCleanOutputDir,
  assertPerfectPrototypeMergeSourceSetCompatible,
  buildCurrentPerfectPrototypeIndexProvenance,
  buildPerfectPrototypeFeatureStoreProvenanceRecord,
  buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest,
  buildPerfectPrototypePartitionStateHash,
  buildPerfectPrototypeTokenizerSpecCacheKey,
} from "./perfect_prototype_index_provenance.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  runPerfectPrototypeDuckdbSql,
  sqlQuote,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  listPerfectPrototypePrejumpFeatureStorePartitions,
} from "./perfect_prototype_prejump_feature_store.mjs"
import {
  buildPerfectPrototypeTokenIndex,
  PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  buildPerfectPrototypeTokenizerSpecFromParquetInputs,
  loadPerfectPrototypeIndexedArtifacts,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
  PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
} from "./perfect_prototype_token_index.mjs"
import {
  PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  buildPerfectPrototypeTokenizerSpecHash,
} from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import { assertCanonicalPerfectPrototypeTokenizerCacheInputs } from "./perfect_prototype_tokenizer_contract.mjs"
import {
  assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid,
  readPerfectPrototypeTokenizerSpecCacheEnvelope,
  writePerfectPrototypeTokenizerSpecCacheEnvelope,
} from "./perfect_prototype_tokenizer_spec_cache.mjs"
import { PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE } from "./perfect_prototype_prejump_contract.mjs"
import {
  appendPerfectPrototypeShiftedDeltaPostingFileRefsToFile,
  appendPerfectPrototypeDeltaPostingGroupsToFile,
  openPerfectPrototypePostingsFile,
  readPerfectPrototypeDeltaPostingsFromFile,
} from "./perfect_prototype_postings_codec.mjs"

const TOKEN_POSTINGS_BATCH_SIZE = 4096
const TOKEN_STATS_BATCH_SIZE = 512
const PERFECT_PROTOTYPE_INDEX_MERGE_MODE_GLOBAL_STREAM = "global_stream"
const PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_MODE_MATERIALIZED = "materialized"
const PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_STREAM_MODE_DELIMITED = "delimited"
const PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED = "delimited"
const DEFAULT_INDEX_MERGE_READ_CONCURRENCY = 8
const MERGED_DICTIONARY_DELIMITED_SEPARATOR = "\t"
const MERGED_DICTIONARY_DELIMITED_NULL = "\\N"
const MERGED_DICTIONARY_DELIMITED_COLUMN_COUNT = 17
const MERGED_DICTIONARY_STATS_DELIMITED_COLUMN_COUNT = 3

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildCoverage = (dateKeys) => {
  const sorted = uniqueSorted(dateKeys)
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

const normalizeCoverageDateKey = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized.length > 0 ? normalized : null
}

const normalizeCoverageRecord = (coverage) => ({
  from: normalizeCoverageDateKey(coverage?.from),
  to: normalizeCoverageDateKey(coverage?.to),
  count: Number(coverage?.count ?? 0) || 0,
})

const normalizeRequestedRange = (requestedRange = null) => ({
  from: normalizeCoverageDateKey(
    requestedRange?.from ?? requestedRange?.startDate ?? requestedRange?.start,
  ),
  to: normalizeCoverageDateKey(
    requestedRange?.to ?? requestedRange?.endDate ?? requestedRange?.end,
  ),
})

export const assertPerfectPrototypeCoverageMatchesEffectiveTradingContract = ({
  actualCoverage,
  expectedEffectiveCoverage,
  requestedRange = null,
  failureLabel = "partitioned predictive token-index effective coverage",
}) => {
  const actual = normalizeCoverageRecord(actualCoverage)
  const expected = normalizeCoverageRecord(expectedEffectiveCoverage)
  const requested = normalizeRequestedRange(requestedRange)
  if (!expected.from || !expected.to || expected.count < 1) {
    throw new Error(
      [
        `${failureLabel} expected effective coverage is empty or invalid.`,
        `expectedEffectiveCoverage=${JSON.stringify(expected)}`,
      ].join("\n"),
    )
  }
  if (!actual.from || !actual.to || actual.count < 1) {
    throw new Error(
      [
        `${failureLabel} actual effective coverage is empty or invalid.`,
        `actualCoverage=${JSON.stringify(actual)}`,
      ].join("\n"),
    )
  }
  if (requested.from && requested.to && requested.from > requested.to) {
    throw new Error(
      [
        `${failureLabel} requested calendar range is invalid.`,
        `requestedFrom=${requested.from}`,
        `requestedTo=${requested.to}`,
      ].join("\n"),
    )
  }
  if (actual.from !== expected.from) {
    throw new Error(
      [
        `${failureLabel} effective coverage start mismatch.`,
        `expectedEffectiveFrom=${expected.from}`,
        `actualCoverageFrom=${actual.from}`,
      ].join("\n"),
    )
  }
  if (actual.to !== expected.to) {
    throw new Error(
      [
        `${failureLabel} effective coverage end mismatch.`,
        `expectedEffectiveTo=${expected.to}`,
        `actualCoverageTo=${actual.to}`,
      ].join("\n"),
    )
  }
  if (actual.count !== expected.count) {
    throw new Error(
      [
        `${failureLabel} effective coverage count mismatch.`,
        `expectedEffectiveCount=${expected.count}`,
        `actualCoverageCount=${actual.count}`,
      ].join("\n"),
    )
  }
  if (requested.from && expected.from < requested.from) {
    throw new Error(
      [
        `${failureLabel} effective coverage starts before requested calendar range.`,
        `requestedFrom=${requested.from}`,
        `effectiveCoverageFrom=${expected.from}`,
      ].join("\n"),
    )
  }
  if (requested.to && expected.to > requested.to) {
    throw new Error(
      [
        `${failureLabel} effective coverage ends after requested calendar range.`,
        `requestedTo=${requested.to}`,
        `effectiveCoverageTo=${expected.to}`,
      ].join("\n"),
    )
  }
}

export const assertPerfectPrototypeCoverageMatchesRequestedRange = ({
  coverage,
  startDate = null,
  endDate = null,
  failureLabel = "partitioned predictive token-index requested coverage",
}) =>
  assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
    actualCoverage: coverage,
    expectedEffectiveCoverage: coverage,
    requestedRange: {
      from: startDate,
      to: endDate,
    },
    failureLabel,
  })

const buildShardKey = (dateKey, granularity) => {
  const normalized = String(dateKey ?? "").trim()
  if (!normalized) return null
  if (granularity === "quarter") {
    const month = Number(normalized.slice(5, 7))
    const quarter = Math.floor((month - 1) / 3) + 1
    return `${normalized.slice(0, 4)}-Q${quarter}`
  }
  return normalized.slice(0, 7)
}

const updateProgress = async (progressPath, payload) => {
  await writeJson(progressPath, payload)
}

const removePerfectPrototypeMergedIndexArtifacts = async (paths) => {
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
  const rowsScanned = Number(payload?.rowsScanned ?? payload?.mergedRows ?? 0)
  const tokensIndexed = Number(payload?.tokensIndexed ?? payload?.mergedTokens ?? 0)
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

const buildTokenizerSpecFromFeatureStorePartitions = async ({
  cwd,
  duckdb,
  inputPaths,
  featureValueInputs,
  tokenizerSpecCacheInputs,
  statsTarget = null,
}) =>
  buildPerfectPrototypeTokenizerSpecFromParquetInputs({
    cwd,
    duckdb,
    inputPaths,
    featureValueInputs,
    statsTarget,
    surfaceName:
      String(tokenizerSpecCacheInputs?.surfaceName ?? "").trim().toLowerCase() ||
      PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    binCount: tokenizerSpecCacheInputs?.binCount,
    includeSymbolToken: tokenizerSpecCacheInputs?.includeSymbolToken,
    includeMissingTokens: tokenizerSpecCacheInputs?.includeMissingTokens,
    includeCategoricalTokens: tokenizerSpecCacheInputs?.includeCategoricalTokens,
  })

const resolveTokenizerSpecFromFeatureStoreCache = async ({
  cwd,
  duckdb,
  featureStoreDir,
  startDate,
  endDate,
  partitionStateHash,
  tokenizerSpecCacheKey,
  tokenizerSpecCacheInputs,
  inputPaths,
  featureValueInputs,
  statsTarget = null,
}) => {
  let cachedEnvelope = null
  if (tokenizerSpecCacheKey) {
    cachedEnvelope = await readPerfectPrototypeTokenizerSpecCacheEnvelope({
      featureStoreDir,
      cacheKey: tokenizerSpecCacheKey,
    })
  }
  if (cachedEnvelope?.envelope) {
    try {
      const validatedEnvelope = assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid({
        cachePath: cachedEnvelope.cachePath,
        envelope: cachedEnvelope.envelope,
        featureStoreDir,
        startDate,
        endDate,
        partitionStateHash,
        tokenizerSpecCacheKey,
        tokenizerSpecCacheInputs,
      })
      return {
        tokenizerSpec: validatedEnvelope.envelope.tokenizerSpec,
        tokenizerSpecHash: validatedEnvelope.envelope.tokenizerSpecHash,
        tokenizerSpecFingerprintVersion:
          validatedEnvelope.envelope.tokenizerSpecFingerprintVersion,
      }
    } catch (_cacheError) {
      // Corrupt or legacy cache is a derived artifact. Rebuild it from feature-value sidecars.
    }
  }
  const tokenizerSpec = await buildTokenizerSpecFromFeatureStorePartitions({
    cwd,
    duckdb,
    inputPaths,
    featureValueInputs,
    tokenizerSpecCacheInputs,
    statsTarget,
  })
  const writtenCacheEnvelope =
    tokenizerSpecCacheKey != null
      ? await writePerfectPrototypeTokenizerSpecCacheEnvelope({
          featureStoreDir,
          startDate,
          endDate,
          partitionStateHash,
          tokenizerSpecCacheKey,
          tokenizerSpecCacheInputs,
          tokenizerSpec,
        })
      : null
  return {
    tokenizerSpec,
    tokenizerSpecHash:
      writtenCacheEnvelope?.envelope?.tokenizerSpecHash ??
      buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec),
    tokenizerSpecFingerprintVersion:
      writtenCacheEnvelope?.envelope?.tokenizerSpecFingerprintVersion ??
      PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  }
}

const resolveCanonicalTokenizerSpecForPartitionedProvenance = async ({
  cwd,
  duckdb,
  partitionedProvenance,
  failureLabel,
}) => {
  const canonicalTokenizerSpecCacheInputs = assertCanonicalPerfectPrototypeTokenizerCacheInputs({
    tokenizerSpecCacheInputs: partitionedProvenance?.tokenizerSpecCacheInputs,
    failureLabel:
      String(failureLabel ?? "").trim() || "partitioned predictive token-index merge",
  })
  const currentProvenance = await buildCurrentPerfectPrototypeIndexProvenance({
    featureStoreDir: partitionedProvenance.featureStoreDir,
    startDate: partitionedProvenance.startDate,
    endDate: partitionedProvenance.endDate,
    shardGranularity: partitionedProvenance.shardGranularity,
    tokenizerSpecCacheInputs: canonicalTokenizerSpecCacheInputs,
  })
  assertPerfectPrototypeIndexProvenanceCompatible({
    indexDir: failureLabel,
    recordedProvenance: partitionedProvenance,
    currentProvenance,
  })
  const featureStoreManifest = await readJson(currentProvenance.featureStoreManifestPath, null)
  if (!featureStoreManifest || typeof featureStoreManifest !== "object") {
    throw new Error(
      [
        "Partitioned predictive token-index merge requires a valid feature-store manifest for canonical tokenizer-spec validation.",
        `featureStoreManifestPath=${currentProvenance.featureStoreManifestPath}`,
      ].join("\n"),
    )
  }
  const selectedPartitions = buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest({
    featureStoreDir: currentProvenance.featureStoreDir,
    manifest: featureStoreManifest,
    startDate: currentProvenance.startDate,
    endDate: currentProvenance.endDate,
  })
  if (selectedPartitions.length < 1) {
    throw new Error(
      [
        "Partitioned predictive token-index merge could not resolve feature-store partitions for canonical tokenizer-spec validation.",
        `featureStoreDir=${currentProvenance.featureStoreDir}`,
        `startDate=${currentProvenance.startDate ?? "null"}`,
        `endDate=${currentProvenance.endDate ?? "null"}`,
      ].join("\n"),
    )
  }
  const featureValueInputs = selectedPartitions.map((entry) => ({
    binPath: String(entry?.featureValuesBinPath ?? "").trim(),
    indexPath: String(entry?.featureValuesIndexParquetPath ?? "").trim(),
  }))
  if (featureValueInputs.some((entry) => !entry.binPath || !entry.indexPath)) {
    throw new Error(
      [
        "Partitioned predictive token-index merge requires exact feature_values sidecars for canonical tokenizer-spec validation.",
        `featureStoreDir=${currentProvenance.featureStoreDir}`,
      ].join("\n"),
    )
  }
  const missingFeatureValuePaths = featureValueInputs.flatMap((entry) =>
    [entry.binPath, entry.indexPath].filter((filePath) => !pathExists(filePath)),
  )
  if (missingFeatureValuePaths.length > 0) {
    throw new Error(
      [
        "Partitioned predictive token-index merge requires feature-store feature_values sidecars for canonical tokenizer-spec validation.",
        `featureStoreDir=${currentProvenance.featureStoreDir}`,
        `missingFeatureValues=${missingFeatureValuePaths.slice(0, 5).join(", ")}`,
        "Rebuild the affected feature-store partitions with tools/build_perfect_prototype_prejump_feature_store.mjs --overwrite-existing=true.",
      ].join("\n"),
    )
  }
  const {
    tokenizerSpec,
    tokenizerSpecHash,
    tokenizerSpecFingerprintVersion,
  } = await resolveTokenizerSpecFromFeatureStoreCache({
    cwd,
    duckdb,
    featureStoreDir: currentProvenance.featureStoreDir,
    startDate: currentProvenance.startDate,
    endDate: currentProvenance.endDate,
    partitionStateHash: currentProvenance.partitionStateHash,
    tokenizerSpecCacheKey: currentProvenance.tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs: canonicalTokenizerSpecCacheInputs,
    inputPaths: selectedPartitions.map((entry) => entry.parquetPath),
    featureValueInputs,
  })
  return {
    currentProvenance,
    tokenizerSpec,
    tokenizerSpecHash,
    tokenizerSpecFingerprintVersion,
  }
}

const normalizeShardDictionaryEntry = (row) => {
  const token = String(row?.token ?? "").trim()
  if (!token) return null
  return {
    token,
    positiveOffset: Number(row?.positiveOffset ?? 0),
    positiveByteLength: Number(row?.positiveByteLength ?? 0),
    positiveCount: Number(row?.positiveCount ?? 0),
    positiveFirstRowIdx: Number.isInteger(Number(row?.positiveFirstRowIdx))
      ? Number(row.positiveFirstRowIdx)
      : null,
    positiveLastRowIdx: Number.isInteger(Number(row?.positiveLastRowIdx))
      ? Number(row.positiveLastRowIdx)
      : null,
    negativeOffset: Number(row?.negativeOffset ?? 0),
    negativeByteLength: Number(row?.negativeByteLength ?? 0),
    negativeCount: Number(row?.negativeCount ?? 0),
    negativeFirstRowIdx: Number.isInteger(Number(row?.negativeFirstRowIdx))
      ? Number(row.negativeFirstRowIdx)
      : null,
    negativeLastRowIdx: Number.isInteger(Number(row?.negativeLastRowIdx))
      ? Number(row.negativeLastRowIdx)
      : null,
    positiveMatchCount: Number(row?.positiveMatchCount ?? 0),
    negativeMatchCount: Number(row?.negativeMatchCount ?? 0),
    precision: Number(row?.precision ?? 0),
    separationRatio: Number(row?.separationRatio ?? 0),
    separationLift: Number(row?.separationLift ?? 0),
  }
}

const buildReadParquetInputSql = (inputPaths, { filename = false } = {}) => {
  const resolvedPaths = (Array.isArray(inputPaths) ? inputPaths : [inputPaths])
    .map((filePath) => path.resolve(String(filePath ?? "").trim()))
    .filter(Boolean)
  if (resolvedPaths.length < 1) {
    throw new Error("buildReadParquetInputSql requires at least one parquet input path")
  }
  const sourceSql =
    resolvedPaths.length === 1
      ? sqlQuote(resolvedPaths[0])
      : `[${resolvedPaths.map((filePath) => sqlQuote(filePath)).join(", ")}]`
  return filename
    ? `read_parquet(${sourceSql}, filename = true)`
    : `read_parquet(${sourceSql})`
}

const toPositiveInteger = (value, fallback) => {
  const normalized = Math.floor(Number(value))
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback
}

const buildMergedShardDictionaryUnionSql = (shardArtifacts) => {
  if (!Array.isArray(shardArtifacts) || shardArtifacts.length < 1) {
    throw new Error("Merged shard dictionary union requires at least one shard artifact")
  }
  return shardArtifacts
    .map(
      (shard, shardIndex) => `
SELECT
  token,
  CAST(${Number(shardIndex)} AS BIGINT) AS shardIndex,
  positiveOffset,
  positiveByteLength,
  positiveCount,
  positiveFirstRowIdx,
  positiveLastRowIdx,
  negativeOffset,
  negativeByteLength,
  negativeCount,
  negativeFirstRowIdx,
  negativeLastRowIdx,
  positiveMatchCount,
  negativeMatchCount,
  precision,
  separationRatio,
  separationLift
FROM read_parquet(${sqlQuote(path.resolve(shard.tokenDictionaryParquetPath))})
`,
    )
    .join("\nUNION ALL\n")
}

const parseDelimitedInteger = (value, label) => {
  if (value === MERGED_DICTIONARY_DELIMITED_NULL) return null
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue)) {
    throw new Error(`Expected integer field for ${label}`)
  }
  return numberValue
}

const parseDelimitedNumeric = (value, label) => {
  if (value === MERGED_DICTIONARY_DELIMITED_NULL) return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected numeric field for ${label}`)
  }
  return numberValue
}

const parseMergedDictionaryDelimitedRow = (values) => {
  if (!Array.isArray(values) || values.length !== MERGED_DICTIONARY_DELIMITED_COLUMN_COUNT) {
    throw new Error(
      `Merged shard dictionary row column mismatch: expected=${MERGED_DICTIONARY_DELIMITED_COLUMN_COUNT} actual=${Array.isArray(values) ? values.length : -1}`,
    )
  }
  return {
    token: String(values[0] ?? "").trim(),
    shardIndex: parseDelimitedInteger(values[1], "shardIndex"),
    positiveOffset: parseDelimitedInteger(values[2], "positiveOffset"),
    positiveByteLength: parseDelimitedInteger(values[3], "positiveByteLength"),
    positiveCount: parseDelimitedInteger(values[4], "positiveCount"),
    positiveFirstRowIdx: parseDelimitedInteger(values[5], "positiveFirstRowIdx"),
    positiveLastRowIdx: parseDelimitedInteger(values[6], "positiveLastRowIdx"),
    negativeOffset: parseDelimitedInteger(values[7], "negativeOffset"),
    negativeByteLength: parseDelimitedInteger(values[8], "negativeByteLength"),
    negativeCount: parseDelimitedInteger(values[9], "negativeCount"),
    negativeFirstRowIdx: parseDelimitedInteger(values[10], "negativeFirstRowIdx"),
    negativeLastRowIdx: parseDelimitedInteger(values[11], "negativeLastRowIdx"),
    positiveMatchCount: parseDelimitedInteger(values[12], "positiveMatchCount"),
    negativeMatchCount: parseDelimitedInteger(values[13], "negativeMatchCount"),
    precision: parseDelimitedNumeric(values[14], "precision"),
    separationRatio: parseDelimitedNumeric(values[15], "separationRatio"),
    separationLift: parseDelimitedNumeric(values[16], "separationLift"),
  }
}

const parseMergedDictionaryStatsDelimitedRow = (values) => {
  if (!Array.isArray(values) || values.length !== MERGED_DICTIONARY_STATS_DELIMITED_COLUMN_COUNT) {
    throw new Error(
      `Merged shard dictionary stats column mismatch: expected=${MERGED_DICTIONARY_STATS_DELIMITED_COLUMN_COUNT} actual=${Array.isArray(values) ? values.length : -1}`,
    )
  }
  return {
    maxRefsPerToken: Number(parseDelimitedInteger(values[0], "maxRefsPerToken") ?? 0),
    distinctTokens: Number(parseDelimitedInteger(values[1], "distinctTokens") ?? 0),
    dictionaryRefRows: Number(parseDelimitedInteger(values[2], "dictionaryRefRows") ?? 0),
  }
}

const materializeMergedShardDictionaryDelimited = async ({
  cwd,
  duckdb,
  shardArtifacts,
  delimitedPath,
  statsDelimitedPath,
}) => {
  const dictionarySql = buildMergedShardDictionaryUnionSql(shardArtifacts)
  await fsp.rm(delimitedPath, { force: true }).catch(() => {})
  await fsp.rm(statsDelimitedPath, { force: true }).catch(() => {})
  await runPerfectPrototypeDuckdbSql({
    cwd,
    duckdb,
    sql: `
CREATE TEMP TABLE merged_dictionary AS
SELECT *
FROM (${dictionarySql}) AS merged_dictionary_source
ORDER BY token, shardIndex;

COPY merged_dictionary TO ${sqlQuote(path.resolve(delimitedPath))} (
  FORMAT CSV,
  HEADER FALSE,
  DELIMITER ${sqlQuote(MERGED_DICTIONARY_DELIMITED_SEPARATOR)},
  NULLSTR ${sqlQuote(MERGED_DICTIONARY_DELIMITED_NULL)}
);

COPY (
  SELECT
    COALESCE(MAX(refCount), 0) AS maxRefsPerToken,
    COALESCE(COUNT(DISTINCT token), 0) AS distinctTokens,
    COALESCE(COUNT(*), 0) AS dictionaryRefRows
  FROM (
    SELECT
      token,
      COUNT(*) OVER (PARTITION BY token) AS refCount
    FROM merged_dictionary
  ) AS dictionary_stats
) TO ${sqlQuote(path.resolve(statsDelimitedPath))} (
  FORMAT CSV,
  HEADER FALSE,
  DELIMITER ${sqlQuote(MERGED_DICTIONARY_DELIMITED_SEPARATOR)},
  NULLSTR ${sqlQuote(MERGED_DICTIONARY_DELIMITED_NULL)}
);
`,
  })
  return {
    delimitedPath,
    statsDelimitedPath,
  }
}

const mapWithConcurrencyLimit = async (values, limit, mapper) => {
  const safeValues = Array.isArray(values) ? values : []
  const safeLimit = Math.max(1, toPositiveInteger(limit, DEFAULT_INDEX_MERGE_READ_CONCURRENCY))
  const results = new Array(safeValues.length)
  let cursor = 0
  const workerCount = Math.min(safeLimit, safeValues.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < safeValues.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(safeValues[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

const assertShardDictionarySchemaContract = async ({
  cwd,
  duckdb,
  shardArtifacts,
}) => {
  for (const shard of Array.isArray(shardArtifacts) ? shardArtifacts : []) {
    const schemaVersion = Number(shard?.manifest?.tokenDictionarySchemaVersion ?? 0)
    if (schemaVersion < PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION) {
      throw new Error(
        [
          "Partitioned predictive index merge requires shard token-dictionary schema v2 or newer.",
          `indexDir=${shard.indexDir}`,
          `actualSchemaVersion=${schemaVersion}`,
          `requiredSchemaVersion=${PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION}`,
          "remediation: for legacy shard-local indexes, run:",
          "tools/run_server_command.sh node tools/upgrade_perfect_prototype_index_token_dictionary_v2.mjs <index-dir> [<index-dir> ...]",
          "otherwise rebuild the shard index with the current build_perfect_prototype_token_index.mjs contract.",
        ].join("\n"),
      )
    }
    const declaredColumns = new Set(
      (Array.isArray(shard?.manifest?.tokenDictionaryRequiredColumns)
        ? shard.manifest.tokenDictionaryRequiredColumns
        : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    )
    const missingDeclaredColumns = PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS.filter(
      (column) => !declaredColumns.has(column),
    )
    if (missingDeclaredColumns.length > 0) {
      throw new Error(
        [
          "Partitioned predictive index merge requires shard manifests to declare the current token-dictionary columns.",
          `indexDir=${shard.indexDir}`,
          `missingColumns=${missingDeclaredColumns.join(",")}`,
          "remediation: for legacy shard-local indexes, run:",
          "tools/run_server_command.sh node tools/upgrade_perfect_prototype_index_token_dictionary_v2.mjs <index-dir> [<index-dir> ...]",
          "otherwise rebuild the shard index with the current build_perfect_prototype_token_index.mjs contract.",
        ].join("\n"),
      )
    }
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb,
      sql: `
SELECT
  ${PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS.join(",\n  ")}
FROM read_parquet(${sqlQuote(path.resolve(shard.tokenDictionaryParquetPath))})
LIMIT 0
`,
    })
  }
}

const resolveMergedShardDictionaryStats = async ({
  statsDelimitedPath,
}) => {
  const payload = await fsp.readFile(path.resolve(statsDelimitedPath), "utf8")
  const firstLine = String(payload).split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
  const stats = firstLine
    ? parseMergedDictionaryStatsDelimitedRow(
        parseDelimitedLine(firstLine, {
          separator: MERGED_DICTIONARY_DELIMITED_SEPARATOR,
        }),
      )
    : null
  return stats ?? {
    distinctTokens: 0,
    maxRefsPerToken: 0,
    dictionaryRefRows: 0,
  }
}

const streamMergedTokenRefGroupsInOrder = async ({
  mergedDictionaryDelimitedPath,
  rowOffsets,
  onGroup,
}) => {
  let currentToken = null
  let currentRefs = []
  const flushCurrentGroup = async () => {
    if (!currentToken) return
    await onGroup({
      token: currentToken,
      refs: currentRefs.slice(),
    })
    currentToken = null
    currentRefs = []
  }
  await iterateDelimited(mergedDictionaryDelimitedPath, {
    strict: true,
    separator: MERGED_DICTIONARY_DELIMITED_SEPARATOR,
    parseRow: (values) => parseMergedDictionaryDelimitedRow(values),
    onRow: async (row) => {
      const normalized = normalizeShardDictionaryEntry(row)
      if (!normalized) return
      const shardIndex = Math.floor(Number(row?.shardIndex))
      if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= rowOffsets.length) {
        throw new Error(
          `Merged shard dictionary stream returned invalid shardIndex: token=${normalized.token} shardIndex=${row?.shardIndex}`,
        )
      }
      if (currentToken && normalized.token !== currentToken) {
        await flushCurrentGroup()
      }
      if (!currentToken) {
        currentToken = normalized.token
      }
      const previousShardIndex =
        currentRefs.length > 0
          ? Number(currentRefs[currentRefs.length - 1]?.shardIndex ?? -1)
          : -1
      if (previousShardIndex === shardIndex) {
        throw new Error(
          `Merged shard dictionary stream returned duplicate shardIndex for token=${normalized.token}: shardIndex=${shardIndex}`,
        )
      }
      if (previousShardIndex > shardIndex) {
        throw new Error(
          `Merged shard dictionary stream returned out-of-order shardIndex for token=${normalized.token}: previous=${previousShardIndex} current=${shardIndex}`,
        )
      }
      currentRefs.push({
        shardIndex,
        rowOffset: rowOffsets[shardIndex] ?? 0,
        entry: normalized,
      })
    },
  })
  await flushCurrentGroup()
}

export const planPerfectPrototypeFeatureStoreIndexShards = async ({
  featureStoreDir,
  startDate,
  endDate,
  granularity = "month",
} = {}) => {
  const normalizedGranularity =
    String(granularity ?? "month").trim().toLowerCase() || "month"
  if (normalizedGranularity !== "month" && normalizedGranularity !== "quarter") {
    throw new Error(`Unsupported predictive shard granularity: ${normalizedGranularity}`)
  }
  const partitions = await listPerfectPrototypePrejumpFeatureStorePartitions({
    featureStoreDir,
    startDate,
    endDate,
  })
  if (partitions.length < 1) {
    throw new Error(
      `No predictive feature-store partitions found for shard planning: ${featureStoreDir} ${startDate ?? ""}..${endDate ?? ""}`.trim(),
    )
  }
  const shardsByKey = new Map()
  for (const partition of partitions) {
    const shardKey = buildShardKey(partition.dateKey, normalizedGranularity)
    if (!shardKey) continue
    const existing = shardsByKey.get(shardKey) ?? {
      shardKey,
      startDate: partition.dateKey,
      endDate: partition.dateKey,
      dateKeys: [],
      partitions: [],
    }
    existing.startDate = existing.startDate < partition.dateKey ? existing.startDate : partition.dateKey
    existing.endDate = existing.endDate > partition.dateKey ? existing.endDate : partition.dateKey
    existing.dateKeys.push(partition.dateKey)
    existing.partitions.push(partition)
    shardsByKey.set(shardKey, existing)
  }
  return Array.from(shardsByKey.values()).sort((left, right) =>
    String(left.startDate).localeCompare(String(right.startDate)),
  )
}

const buildMergedTokenStatsRow = ({ token, positiveMatchCount, negativeMatchCount }) => {
  const positive = Number(positiveMatchCount ?? 0)
  const negative = Number(negativeMatchCount ?? 0)
  const total = positive + negative
  return {
    token,
    positiveMatchCount: positive,
    negativeMatchCount: negative,
    precision: total > 0 ? positive / total : 0,
    separationRatio: positive / (negative + 1),
    separationLift: positive - negative,
  }
}

export const mergePerfectPrototypeTokenIndexPartitions = async ({
  cwd = process.cwd(),
  indexDirs,
  outDir,
  options = {},
}) => {
  const resolvedOutDir = path.resolve(outDir)
  await assertPerfectPrototypeCleanOutputDir({
    dirPath: resolvedOutDir,
    label: "partitioned index merge outDir",
    allowedEntries: ["progress.json"],
  })
  await ensureDir(resolvedOutDir)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const progressPath = path.join(resolvedOutDir, "progress.json")
  const resolvedIndexDirs = (Array.isArray(indexDirs) ? indexDirs : [])
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (resolvedIndexDirs.length < 1) {
    throw new Error("mergePerfectPrototypeTokenIndexPartitions requires at least one index directory")
  }
  const partitionedProvenance =
    options?.partitionedProvenance && typeof options.partitionedProvenance === "object"
      ? options.partitionedProvenance
      : null
  const partitionManifestMetadata =
    options?.partitionManifest && typeof options.partitionManifest === "object"
      ? options.partitionManifest
      : null
  if (
    !partitionedProvenance?.featureStoreDir ||
    !partitionedProvenance?.featureStoreManifestPath ||
    !partitionedProvenance?.partitionStateHash
  ) {
    throw new Error(
      [
        "Perfect prototype partitioned index merge requires canonical feature-store provenance.",
        `outDir=${resolvedOutDir}`,
        "Provide options.partitionedProvenance or use the canonical feature-store wrapper/direct merge tool with explicit provenance inputs.",
      ].join("\n"),
    )
  }
  const emitTokenPostingsParquet = options?.emitTokenPostingsParquet === true
  const indexMergeMode =
    String(options?.indexMergeMode ?? PERFECT_PROTOTYPE_INDEX_MERGE_MODE_GLOBAL_STREAM)
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_INDEX_MERGE_MODE_GLOBAL_STREAM
  const distinctTokenScanRequired =
    options?.distinctTokenScanRequired == null ? true : options.distinctTokenScanRequired === true
  const nativePostingsMergeRequired =
    options?.nativePostingsMergeRequired == null ? true : options.nativePostingsMergeRequired === true
  const nativePostingsSpliceRequired =
    String(process.env.PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED ?? "true").trim().toLowerCase() === "true"
  const schemaPreflightRequired =
    options?.schemaPreflightRequired == null ? true : options.schemaPreflightRequired === true
  const rawIndexMergeReadConcurrency = options?.indexMergeReadConcurrency
  const mergedDictionaryStreamMode =
    String(
      options?.mergedDictionaryStreamMode ??
        process.env.PREJUMP_INDEX_MERGED_DICTIONARY_STREAM_MODE ??
        PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_STREAM_MODE_DELIMITED,
    )
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_STREAM_MODE_DELIMITED
  const outputSinkMode =
    String(
      options?.outputSinkMode ??
        process.env.PREJUMP_INDEX_OUTPUT_SINK_MODE ??
        PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED,
    )
      .trim()
      .toLowerCase() || PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED
  const indexMergeReadConcurrency =
    rawIndexMergeReadConcurrency == null
      ? DEFAULT_INDEX_MERGE_READ_CONCURRENCY
      : Math.floor(Number(rawIndexMergeReadConcurrency))
  if (indexMergeMode !== PERFECT_PROTOTYPE_INDEX_MERGE_MODE_GLOBAL_STREAM) {
    throw new Error(
      `Perfect prototype partitioned index merge mode must remain ${PERFECT_PROTOTYPE_INDEX_MERGE_MODE_GLOBAL_STREAM}: ${indexMergeMode}`,
    )
  }
  if (mergedDictionaryStreamMode !== PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_STREAM_MODE_DELIMITED) {
    throw new Error(
      `Perfect prototype partitioned index merged-dictionary stream mode must remain ${PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_STREAM_MODE_DELIMITED}: ${mergedDictionaryStreamMode}`,
    )
  }
  if (distinctTokenScanRequired !== true) {
    throw new Error(
      "Perfect prototype partitioned index merge must keep distinct-token ETA scan enabled",
    )
  }
  if (!emitTokenPostingsParquet && nativePostingsMergeRequired !== true) {
    throw new Error(
      "Perfect prototype primary-path token-index merge requires native shifted-delta postings merge",
    )
  }
  if (!emitTokenPostingsParquet && nativePostingsSpliceRequired !== true) {
    throw new Error(
      "Perfect prototype primary-path token-index merge requires PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED=true",
    )
  }
  if (outputSinkMode !== PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED) {
    throw new Error(
      `Perfect prototype partitioned index merge output sink mode must remain ${PERFECT_PROTOTYPE_INDEX_OUTPUT_SINK_MODE_DELIMITED}: ${outputSinkMode}`,
    )
  }
  if (schemaPreflightRequired !== true) {
    throw new Error(
      "Perfect prototype partitioned index merge must keep shard dictionary schema preflight enabled",
    )
  }
  if (!Number.isInteger(indexMergeReadConcurrency) || indexMergeReadConcurrency < 1) {
    throw new Error(
      `Perfect prototype partitioned index merge requires a positive read concurrency: ${rawIndexMergeReadConcurrency}`,
    )
  }
  const mergeStartedAt = Date.now()
  const {
    currentProvenance: canonicalPartitionedProvenance,
    tokenizerSpec: canonicalTokenizerSpec,
    tokenizerSpecHash: canonicalTokenizerSpecHash,
    tokenizerSpecFingerprintVersion,
  } = await resolveCanonicalTokenizerSpecForPartitionedProvenance({
    cwd,
    duckdb,
    partitionedProvenance,
    failureLabel: resolvedOutDir,
  })

  const shardArtifacts = []
  for (const indexDir of resolvedIndexDirs) {
    shardArtifacts.push(await loadPerfectPrototypeIndexedArtifacts(indexDir))
  }
  await assertPerfectPrototypeMergeSourceSetCompatible({
    outDir: resolvedOutDir,
    indexDirs: resolvedIndexDirs,
    sourceManifests: shardArtifacts.map((entry) => entry?.manifest ?? null),
    partitionedProvenance: canonicalPartitionedProvenance,
  })
  const canonicalSourceType =
    String(
      shardArtifacts[0]?.manifest?.sourceType ??
        shardArtifacts[0]?.summary?.sourceType ??
        PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE,
    ).trim() || PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE
  if (canonicalSourceType !== PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE) {
    throw new Error(
      `Partitioned predictive token-index merge requires canonical sourceType=${PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE}: ${canonicalSourceType}`,
    )
  }
  for (const shard of shardArtifacts.slice(1)) {
    if (JSON.stringify(shard?.tokenizerSpec ?? {}) !== JSON.stringify(shardArtifacts[0]?.tokenizerSpec ?? {})) {
      throw new Error(
        `Partitioned predictive token-index merge requires identical tokenizerSpec across shards: ${shard.indexDir}`,
      )
    }
    const shardSourceType =
      String(shard?.manifest?.sourceType ?? shard?.summary?.sourceType ?? "").trim() ||
      PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE
    if (shardSourceType !== canonicalSourceType) {
      throw new Error(
        `Partitioned predictive token-index merge requires identical sourceType across shards: expected=${canonicalSourceType} actual=${shardSourceType} shard=${shard.indexDir}`,
      )
    }
  }
  for (const shard of shardArtifacts) {
    if (shard?.tokenizerSpecHash !== canonicalTokenizerSpecHash) {
      throw new Error(
        [
          "Partitioned predictive token-index merge source shard tokenizerSpecHash does not match the canonical current feature-store tokenizer spec.",
          `shardIndexDir=${shard.indexDir}`,
          `recordedTokenizerSpecHash=${shard?.tokenizerSpecHash ?? "null"}`,
          `canonicalTokenizerSpecHash=${canonicalTokenizerSpecHash}`,
          "Rebuild the shard-local indexes from the current feature-store provenance before merging.",
        ].join("\n"),
      )
    }
  }
  await assertShardDictionarySchemaContract({
    cwd,
    duckdb,
    shardArtifacts,
  })
  const tokenizerSpec = canonicalTokenizerSpec
  const expectedMergedRowCount = shardArtifacts.reduce(
    (sum, shard) => sum + Number(shard?.manifest?.rowCount ?? 0),
    0,
  )
  const mergedDictionaryDelimitedPath = path.join(
    resolvedOutDir,
    ".tmp_merged_dictionary.tsv",
  )
  const mergedDictionaryStatsDelimitedPath = path.join(
    resolvedOutDir,
    ".tmp_merged_dictionary_stats.tsv",
  )
  await updateProgress(
    progressPath,
    buildTimedProgressPayload({
      payload: {
        phase: "materialize_merged_dictionary",
        shardCount: resolvedIndexDirs.length,
        mergedRows: 0,
        mergedTokens: 0,
        mergedPostingRows: 0,
      },
      startedAtMs: mergeStartedAt,
    }),
  )
  await materializeMergedShardDictionaryDelimited({
    cwd,
    duckdb,
    shardArtifacts,
    delimitedPath: mergedDictionaryDelimitedPath,
    statsDelimitedPath: mergedDictionaryStatsDelimitedPath,
  })
  const mergedDictionaryStats = await resolveMergedShardDictionaryStats({
    statsDelimitedPath: mergedDictionaryStatsDelimitedPath,
  })
  const expectedMergedDistinctTokenCount = Number(mergedDictionaryStats?.distinctTokens ?? 0)
  const expectedMaxRefsPerToken = Number(mergedDictionaryStats?.maxRefsPerToken ?? 0)
  const expectedDictionaryRefRows = Number(mergedDictionaryStats?.dictionaryRefRows ?? 0)

  await updateProgress(
    progressPath,
    buildTimedProgressPayload({
      payload: {
        phase: "load_partition_manifests",
        shardCount: resolvedIndexDirs.length,
        mergedRows: 0,
        mergedTokens: 0,
        mergedPostingRows: 0,
        distinctTokens: expectedMergedDistinctTokenCount,
        expectedDistinctTokens: expectedMergedDistinctTokenCount,
        maxRefsPerToken: expectedMaxRefsPerToken,
        expectedDictionaryRefRows,
      },
      startedAtMs: mergeStartedAt,
    }),
  )

  const rowMetaParquetPath = path.join(resolvedOutDir, "row_meta.parquet")
  const tokenPostingsParquetPath = emitTokenPostingsParquet
    ? path.join(resolvedOutDir, "token_postings.parquet")
    : null
  const tokenPostingsBinPath = path.join(resolvedOutDir, "token_postings.bin")
  const tokenDictionaryParquetPath = path.join(resolvedOutDir, "token_dictionary.parquet")
  const tokenDictionaryPath = path.join(resolvedOutDir, "token_dictionary.json")
  const tokenStatsParquetPath = path.join(resolvedOutDir, "token_stats.parquet")
  const tokenizerSpecPath = path.join(resolvedOutDir, "tokenizer_spec.json")
  const manifestPath = path.join(resolvedOutDir, "manifest.json")
  const summaryPath = path.join(resolvedOutDir, "summary.json")
  const partitionManifestPath = path.join(resolvedOutDir, "partition_manifest.json")
  const artifactPaths = [
    rowMetaParquetPath,
    tokenPostingsParquetPath,
    tokenPostingsBinPath,
    tokenDictionaryParquetPath,
    tokenDictionaryPath,
    tokenStatsParquetPath,
    tokenizerSpecPath,
    manifestPath,
    summaryPath,
    partitionManifestPath,
  ]
  const temporaryPaths = [mergedDictionaryDelimitedPath, mergedDictionaryStatsDelimitedPath]
  let mergeSucceeded = false

  try {
    const rowMetaSink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: rowMetaParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
    })
    const tokenPostingsSink = emitTokenPostingsParquet
      ? await createDuckdbDelimitedToParquetSink({
          cwd,
          duckdb,
          parquetPath: tokenPostingsParquetPath,
          schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
        })
      : null
    const tokenStatsSink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: tokenStatsParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
    })
    const tokenDictionarySink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb,
      parquetPath: tokenDictionaryParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
    })

    let mergedRowCount = 0
    const coverageDateKeys = new Set()
    const rowOffsets = []
    try {
    for (const shard of shardArtifacts) {
      rowOffsets.push(mergedRowCount)
      const expectedRowCount = Number(shard?.manifest?.rowCount ?? 0)
      let shardRowCount = 0
      await streamParquetQueryDelimitedRows({
        cwd,
        duckdb,
        parquetPath: shard.rowMetaParquetPath,
        schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
        selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA),
        orderBySql: "rowIdx",
        onRow: async (row) => {
          const rowIdx = Number(row?.rowIdx)
          if (!Number.isInteger(rowIdx) || rowIdx < 0) {
            throw new Error(`Invalid rowIdx in shard row_meta: ${shard.rowMetaParquetPath}`)
          }
          const dateKey = String(row?.dateKey ?? "").trim()
          if (dateKey) {
            coverageDateKeys.add(dateKey)
          }
          shardRowCount += 1
          mergedRowCount += 1
          await rowMetaSink.writeRow({
            ...row,
            rowIdx: rowIdx + rowOffsets[rowOffsets.length - 1],
          })
        },
      })
      if (expectedRowCount > 0 && shardRowCount !== expectedRowCount) {
        throw new Error(
          `Shard row_meta count mismatch during merge: expected=${expectedRowCount} actual=${shardRowCount} shard=${shard.indexDir}`,
        )
      }
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "merge_row_meta",
            shardCount: resolvedIndexDirs.length,
            completedShards: rowOffsets.length,
            mergedRows: mergedRowCount,
            mergedTokens: 0,
            mergedPostingRows: 0,
            distinctTokens: expectedMergedDistinctTokenCount,
            expectedDistinctTokens: expectedMergedDistinctTokenCount,
            maxRefsPerToken: expectedMaxRefsPerToken,
            expectedDictionaryRefRows,
          },
          startedAtMs: mergeStartedAt,
          estimatedRows: expectedMergedRowCount > 0 ? expectedMergedRowCount : null,
        }),
      )
    }
  } catch (error) {
    await rowMetaSink.abort()
    await tokenPostingsSink?.abort()
    await tokenStatsSink.abort()
    await tokenDictionarySink.abort()
    throw error
  }
  await rowMetaSink.close()

  const shardHandles = []
  try {
    for (let shardIndex = 0; shardIndex < shardArtifacts.length; shardIndex += 1) {
      const shard = shardArtifacts[shardIndex]
      const postingsHandle = await openPerfectPrototypePostingsFile(shard.tokenPostingsBinPath, "r")
      shardHandles.push(postingsHandle)
    }

    await fsp.rm(tokenPostingsBinPath, { force: true })
    const postingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "w")
    try {
      const tokenStatsBatch = []
      const tokenDictionaryBatch = []
      const tokenPostingsBatch = []
      const flushTokenStatsBatch = async () => {
        if (tokenStatsBatch.length < 1) return
        await tokenStatsSink.writeRows(tokenStatsBatch)
        tokenStatsBatch.length = 0
      }
      const flushTokenDictionaryBatch = async () => {
        if (tokenDictionaryBatch.length < 1) return
        await tokenDictionarySink.writeRows(tokenDictionaryBatch)
        tokenDictionaryBatch.length = 0
      }
      const flushTokenPostingsBatch = async () => {
        if (!tokenPostingsSink) {
          tokenPostingsBatch.length = 0
          return
        }
        if (tokenPostingsBatch.length < 1) return
        await tokenPostingsSink.writeRows(tokenPostingsBatch)
        tokenPostingsBatch.length = 0
      }
      let mergedPostingRows = 0
      let mergedTokenCount = 0
      let postingsByteOffset = 0
      let dictionaryCursorRows = 0
      let maxRefsPerToken = 0
      let postingBytesRead = 0
      let postingBytesWritten = 0
      let mergeDecodeMs = 0
      let mergeWriteMs = 0
      let previousMergedToken = null
      await streamMergedTokenRefGroupsInOrder({
        mergedDictionaryDelimitedPath,
        rowOffsets,
        onGroup: async (group) => {
        const token = group.token
        const refs = group.refs
        if (
          previousMergedToken != null &&
          String(token).localeCompare(String(previousMergedToken)) <= 0
        ) {
          throw new Error(
            `Partitioned predictive token-index merge encountered non-increasing token order: previous=${previousMergedToken} current=${token}`,
          )
        }
        previousMergedToken = token
        dictionaryCursorRows += refs.length
        maxRefsPerToken = Math.max(maxRefsPerToken, refs.length)
        if (
          expectedDictionaryRefRows > 0 &&
          dictionaryCursorRows > expectedDictionaryRefRows
        ) {
          throw new Error(
            `Partitioned predictive token-index merge exceeded expected dictionary ref rows: actual=${dictionaryCursorRows} expected=${expectedDictionaryRefRows}`,
          )
        }
        const positiveGroups = []
        const negativeGroups = []
        const positiveRefs = []
        const negativeRefs = []
        if (tokenPostingsSink) {
          const refResults = await mapWithConcurrencyLimit(
            refs,
            indexMergeReadConcurrency,
            async (ref) => {
              const fileHandle = shardHandles[ref.shardIndex]
              const [positive, negative] = await Promise.all([
                readPerfectPrototypeDeltaPostingsFromFile({
                  fileHandle,
                  offset: ref.entry.positiveOffset,
                  byteLength: ref.entry.positiveByteLength,
                  count: ref.entry.positiveCount,
                }),
                readPerfectPrototypeDeltaPostingsFromFile({
                  fileHandle,
                  offset: ref.entry.negativeOffset,
                  byteLength: ref.entry.negativeByteLength,
                  count: ref.entry.negativeCount,
                }),
              ])
              return {
                readBytes:
                  Number(ref.entry.positiveByteLength ?? 0) +
                  Number(ref.entry.negativeByteLength ?? 0),
                positiveGroup: {
                  rowOffset: ref.rowOffset,
                  values: positive,
                },
                negativeGroup: {
                  rowOffset: ref.rowOffset,
                  values: negative,
                },
              }
            },
          )
          for (const result of refResults) {
            postingBytesRead += Number(result?.readBytes ?? 0)
            positiveGroups.push(result.positiveGroup)
            negativeGroups.push(result.negativeGroup)
          }
        } else {
          for (const ref of refs) {
            const fileHandle = shardHandles[ref.shardIndex]
            positiveRefs.push({
              fileHandle,
              fileDescriptor: fileHandle.fd,
              offset: ref.entry.positiveOffset,
              byteLength: ref.entry.positiveByteLength,
              rowOffset: ref.rowOffset,
              count: ref.entry.positiveCount,
              firstRowIdx: ref.entry.positiveFirstRowIdx,
              lastRowIdx: ref.entry.positiveLastRowIdx,
            })
            negativeRefs.push({
              fileHandle,
              fileDescriptor: fileHandle.fd,
              offset: ref.entry.negativeOffset,
              byteLength: ref.entry.negativeByteLength,
              rowOffset: ref.rowOffset,
              count: ref.entry.negativeCount,
              firstRowIdx: ref.entry.negativeFirstRowIdx,
              lastRowIdx: ref.entry.negativeLastRowIdx,
            })
            postingBytesRead +=
              Number(ref.entry.positiveByteLength ?? 0) +
              Number(ref.entry.negativeByteLength ?? 0)
          }
        }
        const positiveMeta = tokenPostingsSink
          ? await appendPerfectPrototypeDeltaPostingGroupsToFile({
              fileHandle: postingsHandle,
              groups: positiveGroups,
              offset: postingsByteOffset,
            })
          : await appendPerfectPrototypeShiftedDeltaPostingFileRefsToFile({
              fileHandle: postingsHandle,
              refs: positiveRefs,
              offset: postingsByteOffset,
            })
        postingsByteOffset += positiveMeta.byteLength
        postingBytesWritten += positiveMeta.byteLength
        mergeDecodeMs += Number(positiveMeta.mergeMs ?? 0)
        mergeWriteMs += Number(positiveMeta.writeMs ?? 0)
        const negativeMeta = tokenPostingsSink
          ? await appendPerfectPrototypeDeltaPostingGroupsToFile({
              fileHandle: postingsHandle,
              groups: negativeGroups,
              offset: postingsByteOffset,
            })
          : await appendPerfectPrototypeShiftedDeltaPostingFileRefsToFile({
              fileHandle: postingsHandle,
              refs: negativeRefs,
              offset: postingsByteOffset,
            })
        postingsByteOffset += negativeMeta.byteLength
        postingBytesWritten += negativeMeta.byteLength
        mergeDecodeMs += Number(negativeMeta.mergeMs ?? 0)
        mergeWriteMs += Number(negativeMeta.writeMs ?? 0)
        const tokenStatsRow = buildMergedTokenStatsRow({
          token,
          positiveMatchCount: positiveMeta.count,
          negativeMatchCount: negativeMeta.count,
        })
        tokenStatsBatch.push(tokenStatsRow)
        tokenDictionaryBatch.push({
          token,
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
          positiveMatchCount: tokenStatsRow.positiveMatchCount,
          negativeMatchCount: tokenStatsRow.negativeMatchCount,
          precision: tokenStatsRow.precision,
          separationRatio: tokenStatsRow.separationRatio,
          separationLift: tokenStatsRow.separationLift,
        })
        if (tokenDictionaryBatch.length >= TOKEN_STATS_BATCH_SIZE) {
          await flushTokenDictionaryBatch()
        }
        mergedPostingRows += positiveMeta.count + negativeMeta.count
        if (tokenPostingsSink) {
          for (const positiveGroup of positiveGroups) {
            const rowOffset = Number(positiveGroup?.rowOffset ?? 0)
            for (const rawRowIdx of positiveGroup?.values ?? []) {
              tokenPostingsBatch.push({
                token,
                rowIdx: Number(rawRowIdx) + rowOffset,
                outcomeHitTarget: true,
              })
              if (tokenPostingsBatch.length >= TOKEN_POSTINGS_BATCH_SIZE) {
                await flushTokenPostingsBatch()
              }
            }
          }
          for (const negativeGroup of negativeGroups) {
            const rowOffset = Number(negativeGroup?.rowOffset ?? 0)
            for (const rawRowIdx of negativeGroup?.values ?? []) {
              tokenPostingsBatch.push({
                token,
                rowIdx: Number(rawRowIdx) + rowOffset,
                outcomeHitTarget: false,
              })
              if (tokenPostingsBatch.length >= TOKEN_POSTINGS_BATCH_SIZE) {
                await flushTokenPostingsBatch()
              }
            }
          }
        }
        mergedTokenCount += 1
        if (
          expectedMergedDistinctTokenCount > 0 &&
          mergedTokenCount > expectedMergedDistinctTokenCount
        ) {
          throw new Error(
            `Partitioned predictive token-index merge exceeded expected distinct token count: actual=${mergedTokenCount} expected=${expectedMergedDistinctTokenCount}`,
          )
        }
        if (tokenStatsBatch.length >= TOKEN_STATS_BATCH_SIZE) {
          await flushTokenStatsBatch()
        }
        if (mergedTokenCount % 100 === 0) {
          await updateProgress(
            progressPath,
            buildTimedProgressPayload({
              payload: {
                phase: "merge_postings",
                shardCount: resolvedIndexDirs.length,
                mergedRows: mergedRowCount,
                mergedTokens: mergedTokenCount,
                mergedPostingRows,
                dictionaryCursorRows,
                distinctTokens: expectedMergedDistinctTokenCount,
                expectedDistinctTokens: expectedMergedDistinctTokenCount,
                maxRefsPerToken,
                expectedDictionaryRefRows,
                postingBytesRead,
                postingBytesWritten,
                mergeDecodeMs: Number(mergeDecodeMs.toFixed(3)),
                mergeWriteMs: Number(mergeWriteMs.toFixed(3)),
              },
              startedAtMs: mergeStartedAt,
              estimatedRows: expectedMergedRowCount > 0 ? expectedMergedRowCount : null,
              estimatedTokens:
                expectedMergedDistinctTokenCount > 0 ? expectedMergedDistinctTokenCount : null,
            }),
          )
        }
      },
      })
      await flushTokenStatsBatch()
      await flushTokenDictionaryBatch()
      await flushTokenPostingsBatch()
      if (
        expectedMergedDistinctTokenCount > 0 &&
        mergedTokenCount !== expectedMergedDistinctTokenCount
      ) {
        throw new Error(
          `Partitioned predictive token-index merge distinct token mismatch: actual=${mergedTokenCount} expected=${expectedMergedDistinctTokenCount}`,
        )
      }
      if (
        expectedDictionaryRefRows > 0 &&
        dictionaryCursorRows !== expectedDictionaryRefRows
      ) {
        throw new Error(
          `Partitioned predictive token-index merge dictionary ref mismatch: actual=${dictionaryCursorRows} expected=${expectedDictionaryRefRows}`,
        )
      }
      await writeJson(tokenDictionaryPath, {
        version: 1,
        generatedAt: new Date().toISOString(),
        tokenCount: mergedTokenCount,
        tokenPostingsBinPath,
        tokenDictionaryParquetPath,
      })
      await writeJson(tokenizerSpecPath, tokenizerSpec)
      const coverage = buildCoverage(Array.from(coverageDateKeys))
      assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
        actualCoverage: coverage,
        expectedEffectiveCoverage:
          canonicalPartitionedProvenance.effectiveDecisionCoverage ??
          canonicalPartitionedProvenance.selectedCoverage,
        requestedRange:
          canonicalPartitionedProvenance.requestedDecisionRange ?? {
            from: canonicalPartitionedProvenance.startDate,
            to: canonicalPartitionedProvenance.endDate,
          },
        failureLabel: "mergePerfectPrototypeTokenIndexPartitions merged coverage",
      })
      const packManifestPaths = shardArtifacts
        .map((shard) => String(shard?.manifest?.packManifestPath ?? "").trim())
        .filter(Boolean)
      const packSummaryPaths = shardArtifacts
        .map((shard) => String(shard?.manifest?.packSummaryPath ?? "").trim())
        .filter(Boolean)
      const outputManifest = {
        version: 1,
        generatedAt: new Date().toISOString(),
        partitioned: true,
        shardCount: shardArtifacts.length,
        sourceIndexDirs: resolvedIndexDirs,
        indexMergeMode,
        mergedDictionaryMode: PERFECT_PROTOTYPE_INDEX_MERGED_DICTIONARY_MODE_MATERIALIZED,
        mergedDictionaryStreamMode,
        distinctTokenScanRequired,
        nativePostingsMergeRequired: emitTokenPostingsParquet ? null : nativePostingsMergeRequired,
        schemaPreflightRequired,
        indexMergeReadConcurrency,
        outputSinkMode,
        sourceType: canonicalSourceType,
        strategyMode: String(shardArtifacts[0]?.manifest?.strategyMode ?? "").trim() || null,
        surfaceName: String(shardArtifacts[0]?.manifest?.surfaceName ?? "").trim() || null,
        tokenDictionarySchemaVersion: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
        tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
        tokenizerSpecPath,
        rowMetaParquetPath,
        tokenPostingsParquetPath,
        tokenPostingsBinPath,
        tokenDictionaryParquetPath,
        tokenDictionaryPath,
        tokenStatsParquetPath,
        packManifestPaths,
        packSummaryPaths,
        requestedDecisionRange:
          canonicalPartitionedProvenance.requestedDecisionRange ?? {
            from: canonicalPartitionedProvenance.startDate ?? null,
            to: canonicalPartitionedProvenance.endDate ?? null,
          },
        effectiveDecisionCoverage: coverage,
        outputCoverage: coverage,
        rowCount: mergedRowCount,
        tokenPostingCount: mergedPostingRows,
        tokenCount: mergedTokenCount,
        dictionaryCursorRows,
        distinctTokens: expectedMergedDistinctTokenCount,
        expectedDistinctTokens: expectedMergedDistinctTokenCount,
        expectedDictionaryRefRows,
        maxRefsPerToken,
        postingBytesRead,
        postingBytesWritten,
        mergeDecodeMs: Number(mergeDecodeMs.toFixed(3)),
        mergeWriteMs: Number(mergeWriteMs.toFixed(3)),
        rowMetaOutputSinkStats: rowMetaSink.getStats(),
        tokenPostingsOutputSinkStats: tokenPostingsSink?.getStats?.() ?? null,
        tokenStatsOutputSinkStats: tokenStatsSink.getStats(),
        tokenDictionaryOutputSinkStats: tokenDictionarySink.getStats(),
      }
      const persistedManifest = {
        ...outputManifest,
        partitionManifestPath,
        tokenizerSpecHash: canonicalTokenizerSpecHash,
        tokenizerSpecFingerprintVersion,
        featureStoreDir: canonicalPartitionedProvenance.featureStoreDir,
        featureStoreManifestPath: canonicalPartitionedProvenance.featureStoreManifestPath,
        featureStoreBuildManifestPath: canonicalPartitionedProvenance.featureStoreBuildManifestPath ?? null,
        featureStoreProvenance: canonicalPartitionedProvenance,
      }
      const persistedSummary = {
        ...persistedManifest,
        tokenizer: {
          surface: tokenizerSpec?.surface ?? null,
          numericFeatureCount: Array.isArray(tokenizerSpec?.numericFeatures)
            ? tokenizerSpec.numericFeatures.length
            : 0,
          binCount: Number(tokenizerSpec?.options?.binCount ?? 0),
        },
      }
      const persistedPartitionManifest = {
        version: 3,
        generatedAt: new Date().toISOString(),
        tokenizerSpecHash: canonicalTokenizerSpecHash,
        tokenizerSpecFingerprintVersion,
        featureStoreDir: canonicalPartitionedProvenance.featureStoreDir,
        featureStoreManifestPath: canonicalPartitionedProvenance.featureStoreManifestPath,
        featureStoreBuildManifestPath: canonicalPartitionedProvenance.featureStoreBuildManifestPath ?? null,
        featureStoreProvenance: canonicalPartitionedProvenance,
        workspaceDir:
          partitionManifestMetadata?.workspaceDir == null
            ? null
            : path.resolve(String(partitionManifestMetadata.workspaceDir).trim()),
        startDate: partitionManifestMetadata?.startDate ?? canonicalPartitionedProvenance.startDate ?? null,
        endDate: partitionManifestMetadata?.endDate ?? canonicalPartitionedProvenance.endDate ?? null,
        shardGranularity:
          String(
            partitionManifestMetadata?.shardGranularity ??
              canonicalPartitionedProvenance.shardGranularity ??
              "month",
          )
            .trim()
            .toLowerCase() || "month",
        shardPlan: Array.isArray(partitionManifestMetadata?.shardPlan)
          ? partitionManifestMetadata.shardPlan
          : null,
        sourceIndexDirs: resolvedIndexDirs,
        tokenizerSpecPath,
        mergedIndex: {
          manifestPath,
          summaryPath,
          partitionManifestPath,
          tokenizerSpecPath,
          rowMetaParquetPath,
          tokenPostingsParquetPath,
          tokenPostingsBinPath,
          tokenDictionaryParquetPath,
          tokenDictionaryPath,
          tokenStatsParquetPath,
        },
      }
      await writeJson(manifestPath, persistedManifest)
      await writeJson(summaryPath, persistedSummary)
      await writeJson(partitionManifestPath, persistedPartitionManifest)
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "completed",
            shardCount: resolvedIndexDirs.length,
            mergedRows: mergedRowCount,
            mergedTokens: mergedTokenCount,
            mergedPostingRows,
            dictionaryCursorRows,
            distinctTokens: expectedMergedDistinctTokenCount,
            expectedDistinctTokens: expectedMergedDistinctTokenCount,
            maxRefsPerToken,
            expectedDictionaryRefRows,
            postingBytesRead,
            postingBytesWritten,
            mergeDecodeMs: Number(mergeDecodeMs.toFixed(3)),
            mergeWriteMs: Number(mergeWriteMs.toFixed(3)),
          },
          startedAtMs: mergeStartedAt,
          estimatedRows: expectedMergedRowCount > 0 ? expectedMergedRowCount : null,
          estimatedTokens: mergedTokenCount,
        }),
      )
      mergeSucceeded = true
      return {
        manifestPath,
        summaryPath,
        partitionManifestPath,
        tokenizerSpecPath,
        rowMetaParquetPath,
        tokenPostingsParquetPath,
        tokenPostingsBinPath,
        tokenDictionaryParquetPath,
        tokenDictionaryPath,
        tokenStatsParquetPath,
      }
    } finally {
      await postingsHandle.close()
      await tokenDictionarySink.close().catch(() => {})
    }
    } finally {
      for (const handle of shardHandles) {
        await handle.close().catch(() => {})
      }
      await tokenPostingsSink?.close().catch(() => {})
      await tokenStatsSink.close().catch(() => {})
      await tokenDictionarySink.close().catch(() => {})
    }
  } finally {
    if (!mergeSucceeded) {
      await removePerfectPrototypeMergedIndexArtifacts(artifactPaths)
    }
    await removePerfectPrototypeMergedIndexArtifacts(temporaryPaths)
  }
}

export const buildPerfectPrototypePartitionedTokenIndexFromFeatureStore = async ({
  cwd = process.cwd(),
  featureStoreDir,
  startDate,
  endDate,
  workspaceDir,
  outDir,
  options = {},
}) => {
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  const resolvedOutDir = path.resolve(outDir)
  await assertPerfectPrototypeCleanOutputDir({
    dirPath: resolvedWorkspaceDir,
    label: "partitioned token-index workspaceDir",
  })
  await assertPerfectPrototypeCleanOutputDir({
    dirPath: resolvedOutDir,
    label: "partitioned token-index outDir",
  })
  await ensureDir(resolvedWorkspaceDir)
  await ensureDir(resolvedOutDir)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const progressPath = path.join(resolvedOutDir, "progress.json")
  const shardPlan = await planPerfectPrototypeFeatureStoreIndexShards({
    featureStoreDir,
    startDate,
    endDate,
    granularity: options?.shardGranularity ?? "month",
  })
  const featureStoreParquetPaths = shardPlan.flatMap((shard) =>
    (Array.isArray(shard.partitions) ? shard.partitions : []).map((entry) => entry.parquetPath),
  )
  const featureValueInputs = shardPlan.flatMap((shard) =>
    (Array.isArray(shard.partitions) ? shard.partitions : []).map((entry) => ({
      binPath: String(entry?.featureValuesBinPath ?? "").trim(),
      indexPath: String(entry?.featureValuesIndexParquetPath ?? "").trim(),
    })),
  )
  if (featureValueInputs.some((entry) => !entry.binPath || !entry.indexPath)) {
    throw new Error(
      `Partitioned predictive token index requires feature-store feature_values sidecars for every partition: ${featureStoreDir}`,
    )
  }
  const missingFeatureValuePaths = featureValueInputs.flatMap((entry) =>
    [entry.binPath, entry.indexPath].filter((filePath) => !pathExists(filePath)),
  )
  if (missingFeatureValuePaths.length > 0) {
    throw new Error(
      [
        "Partitioned predictive token index requires feature-store feature_values sidecars for every partition.",
        `featureStoreDir=${featureStoreDir}`,
        `missingFeatureValues=${missingFeatureValuePaths.slice(0, 5).join(", ")}`,
        "Rebuild the affected feature-store partitions with tools/build_perfect_prototype_prejump_feature_store.mjs --overwrite-existing=true.",
      ].join("\n"),
    )
  }
  const resolvedFeatureStoreDir = path.resolve(featureStoreDir)
  const featureStoreManifestPath = path.join(resolvedFeatureStoreDir, "manifest.json")
  const featureStoreBuildManifestPathCandidate = path.join(resolvedFeatureStoreDir, "build_manifest.json")
  const featureStoreManifest = await readJson(featureStoreManifestPath, null)
  if (!featureStoreManifest || typeof featureStoreManifest !== "object") {
    throw new Error(`Partitioned predictive token index missing feature-store manifest: ${featureStoreManifestPath}`)
  }
  const selectedPartitionsByDate = new Map()
  for (const shard of Array.isArray(shardPlan) ? shardPlan : []) {
    for (const entry of Array.isArray(shard?.partitions) ? shard.partitions : []) {
      const dateKey = String(entry?.dateKey ?? "").trim()
      if (!dateKey || selectedPartitionsByDate.has(dateKey)) continue
      selectedPartitionsByDate.set(dateKey, {
        dateKey,
        parquetPath: String(entry?.parquetPath ?? "").trim(),
        featureStatsParquetPath: String(entry?.featureStatsParquetPath ?? "").trim(),
        featureValuesBinPath: String(entry?.featureValuesBinPath ?? "").trim(),
        featureValuesIndexParquetPath: String(entry?.featureValuesIndexParquetPath ?? "").trim(),
      })
    }
  }
  const selectedFeatureStorePartitions = Array.from(selectedPartitionsByDate.values()).sort((left, right) =>
    String(left.dateKey).localeCompare(String(right.dateKey)),
  )
  const selectedEffectiveCoverage = buildCoverage(
    selectedFeatureStorePartitions.map((entry) => entry.dateKey),
  )
  assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
    actualCoverage: selectedEffectiveCoverage,
    expectedEffectiveCoverage: selectedEffectiveCoverage,
    requestedRange: {
      from: startDate,
      to: endDate,
    },
    failureLabel: "buildPerfectPrototypePartitionedTokenIndexFromFeatureStore selected partition coverage",
  })
  const tokenizerSpecCacheInputs = assertCanonicalPerfectPrototypeTokenizerCacheInputs({
    tokenizerSpecCacheInputs: options,
    failureLabel: "buildPerfectPrototypePartitionedTokenIndexFromFeatureStore",
  })
  const partitionStateHash = await buildPerfectPrototypePartitionStateHash([
    ...featureStoreParquetPaths,
    ...featureValueInputs.flatMap((entry) => [entry.binPath, entry.indexPath]),
  ])
  const tokenizerSpecCacheKey = buildPerfectPrototypeTokenizerSpecCacheKey({
    manifest: featureStoreManifest,
    startDate,
    endDate,
    partitionStateHash,
    tokenizerSpecCacheInputs,
  })
  const featureStoreProvenance = buildPerfectPrototypeFeatureStoreProvenanceRecord({
    featureStoreDir: resolvedFeatureStoreDir,
    featureStoreManifestPath,
    featureStoreBuildManifestPath: pathExists(featureStoreBuildManifestPathCandidate)
      ? featureStoreBuildManifestPathCandidate
      : null,
    featureStoreManifest,
    startDate,
    endDate,
    shardGranularity: options?.shardGranularity ?? "month",
    partitionStateHash,
    tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
    selectedPartitions: selectedFeatureStorePartitions,
  })
  const tokenizerBuildStats = {}
  const { tokenizerSpec } = await resolveTokenizerSpecFromFeatureStoreCache({
    cwd,
    duckdb,
    featureStoreDir: resolvedFeatureStoreDir,
    startDate,
    endDate,
    partitionStateHash,
    tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
    inputPaths: featureStoreParquetPaths,
    featureValueInputs,
    statsTarget: tokenizerBuildStats,
  })
  const buildStartedAt = Date.now()
  await updateProgress(
    progressPath,
    buildTimedProgressPayload({
      payload: {
        phase: "build_shard_indexes",
        shardCount: shardPlan.length,
        completedShards: 0,
        rowsScanned: 0,
        quantileMergeMs: Number(tokenizerBuildStats.quantileMergeMs ?? 0),
        fdPoolPeak: Number(tokenizerBuildStats.fdPoolPeak ?? 0),
      },
      startedAtMs: buildStartedAt,
      estimatedRows: shardPlan.length,
    }),
  )
  const shardIndexDirs = []
  for (let shardIndex = 0; shardIndex < shardPlan.length; shardIndex += 1) {
    const shard = shardPlan[shardIndex]
    const shardRoot = path.join(resolvedWorkspaceDir, shard.shardKey)
    const shardIndexOutDir = path.join(shardRoot, "step-perfect-prototype-index")
    await buildPerfectPrototypeTokenIndex({
      cwd,
      outDir: shardIndexOutDir,
      options: {
        ...options,
        ...tokenizerSpecCacheInputs,
        inputPaths: (Array.isArray(shard.partitions) ? shard.partitions : []).map((entry) => entry.parquetPath),
        coverageOverride: buildCoverage(shard.dateKeys),
        tokenizerSpec,
        emitTokenPostingsParquet: options?.emitTokenPostingsParquet === true,
      },
    })
    shardIndexDirs.push(shardIndexOutDir)
    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "build_shard_indexes",
          shardCount: shardPlan.length,
          completedShards: shardIndex + 1,
          currentShard: shard.shardKey,
          rowsScanned: shardIndex + 1,
          quantileMergeMs: Number(tokenizerBuildStats.quantileMergeMs ?? 0),
          fdPoolPeak: Number(tokenizerBuildStats.fdPoolPeak ?? 0),
        },
        startedAtMs: buildStartedAt,
        estimatedRows: shardPlan.length,
      }),
    )
  }
  const mergeResult = await mergePerfectPrototypeTokenIndexPartitions({
    cwd,
    indexDirs: shardIndexDirs,
    outDir: resolvedOutDir,
    options: {
      ...options,
      ...tokenizerSpecCacheInputs,
      partitionedProvenance: featureStoreProvenance,
      partitionManifest: {
        workspaceDir: resolvedWorkspaceDir,
        startDate,
        endDate,
        shardGranularity: String(options?.shardGranularity ?? "month").trim().toLowerCase() || "month",
        shardPlan: shardPlan.map((shard, index) => ({
          shardKey: shard.shardKey,
          startDate: shard.startDate,
          endDate: shard.endDate,
          partitionCount: Array.isArray(shard.partitions) ? shard.partitions.length : 0,
          dateKeys: shard.dateKeys,
          indexDir: shardIndexDirs[index] ?? null,
        })),
      },
    },
  })
  return {
    shardPlan,
    shardIndexDirs,
    tokenizerSpec,
    mergedIndex: mergeResult,
    featureStoreProvenance,
  }
}
