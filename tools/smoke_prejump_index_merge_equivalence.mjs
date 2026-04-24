import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import path from "node:path"
import fsp from "node:fs/promises"
import { promisify } from "node:util"

import { ensureDir, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  buildPerfectPrototypeTypedParquetWrapperRow,
} from "../src/lib/perfect_prototype_parquet_io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "../src/lib/perfect_prototype_duckdb.mjs"
import {
  repairPerfectPrototypeDirectIndexInputProvenanceArtifacts,
  buildCurrentPerfectPrototypeIndexProvenance,
  buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest,
} from "../src/lib/perfect_prototype_index_provenance.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import {
  encodePerfectPrototypeDeltaPostings,
  decodePerfectPrototypeDeltaPostings,
  mergePerfectPrototypeShiftedDeltaPostingFileRefsJsReference,
  mergePerfectPrototypeShiftedDeltaPostingRefsJsReference,
  openPerfectPrototypePostingsFile,
  readPerfectPrototypePostingBufferFromFile,
} from "../src/lib/perfect_prototype_postings_codec.mjs"
import { nativePerfectPrototypeRowsetKernel } from "../src/lib/perfect_prototype_rowset_native.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import {
  buildPerfectPrototypeTokenIndex,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
  PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
  buildPerfectPrototypeTokenizerSpecFromParquetInputs,
  streamPerfectPrototypeTokenDictionaryEntries,
} from "../src/lib/perfect_prototype_token_index.mjs"
import {
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_REQUIRED_COLUMNS,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_SINK_SCHEMA,
  upgradePerfectPrototypeLegacyTokenDictionarySchemaV1Artifacts,
} from "../src/lib/perfect_prototype_token_dictionary_contract_repair.mjs"
import {
  buildPerfectPrototypeTokenizerSpecFingerprintMetadata,
  PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  buildPerfectPrototypeTokenizerSpecHash,
  repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts,
} from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  buildCanonicalPerfectPrototypeTokenizerCacheInputs,
  PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
} from "../src/lib/perfect_prototype_tokenizer_contract.mjs"
import { resolvePerfectPrototypeServerPolicy } from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid,
  readPerfectPrototypeTokenizerSpecCacheEnvelope,
  resolvePerfectPrototypeTokenizerSpecCachePath,
} from "../src/lib/perfect_prototype_tokenizer_spec_cache.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "../src/lib/perfect_prototype_structured_sink_schemas.mjs"
import { mergePerfectPrototypeTokenIndexPartitions } from "../src/lib/perfect_prototype_token_index_merge.mjs"
import { splitPerfectPrototypePrejumpPackIntoFeatureStore } from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import { normalizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const execFile = promisify(execFileCallback)

const toRunId = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, "0")
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "_",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("")
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const TYPED_WRAPPER_SCHEMA_COLUMNS = new Set(
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA.map(({ name }) => String(name ?? "").trim()).filter(Boolean),
)

const projectRowToSchema = (row, schemaColumns) => {
  const next = {}
  for (const columnName of schemaColumns) {
    next[columnName] = row?.[columnName]
  }
  return next
}

const buildDateKeys = () => {
  const out = []
  const cursor = new Date("2024-01-02T00:00:00Z")
  while (out.length < 12) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const fixtureRows = () => {
  const dateKeys = buildDateKeys()
  const rows = []
  const baseMarketContext = {
    candidateCount: 12,
    uniqueSymbolCount: 12,
    bodyPctMedian: 0.03,
    rangePctMedian: 0.065,
    volumeRatio20Median: 1.08,
    valueRatio20Median: 1.04,
    runUp10Median: 0.12,
    ret40Median: 0.1,
    positiveBodyShare: 0.72,
    wideRangeShare: 0.35,
    elevatedVolumeShare: 0.42,
    closeOverMa20Share: 0.83,
    closeOverMa120Share: 0.67,
  }

  const makeRow = ({
    index,
    symbol,
    hit,
    tagA,
    tagB,
    bodyPct,
    rangePct,
    volumeRatio20,
    valueRatio20,
    runUp10,
    closeOverMa20,
    closeOverMa120,
    ret40,
    seq40Last,
    seq150Last,
  }) => ({
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `fixture_${String(index + 1).padStart(2, "0")}`,
    symbol,
    dateKey: dateKeys[index],
    decisionDateKey: dateKeys[index],
    asOfDateKey: dateKeys[index],
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    featureVec: {
      "candle.bodyPct": bodyPct,
      "candle.rangePct": rangePct,
      "volume.ratio20": volumeRatio20,
      "volume.valueRatio20": valueRatio20,
      "trend.runUp10": runUp10,
      "trend.closeOverMa20": closeOverMa20,
      "trend.closeOverMa120": closeOverMa120,
    },
    globalFeatureVec: {
      ret40,
    },
    marketContextVec: {
      ...baseMarketContext,
    },
    xsecEventVec: {
      bodyRankPct: hit ? 0.84 : 0.33,
      rangeRankPct: hit ? 0.82 : 0.41,
      volumeRankPct: hit ? 0.88 : 0.29,
      valueRatioRankPct: hit ? 0.8 : 0.35,
      runUp10RankPct: hit ? 0.9 : 0.31,
      ret40RankPct: hit ? 0.77 : 0.38,
      bodyVsMedian: bodyPct - baseMarketContext.bodyPctMedian,
      rangeVsMedian: rangePct - baseMarketContext.rangePctMedian,
      volumeVsMedian: volumeRatio20 - baseMarketContext.volumeRatio20Median,
      valueRatioVsMedian: valueRatio20 - baseMarketContext.valueRatio20Median,
      runUp10VsMedian: runUp10 - baseMarketContext.runUp10Median,
      ret40VsMedian: ret40 - baseMarketContext.ret40Median,
      isolationScore: 1 / 12,
    },
    contextualTokens: uniqueSorted(
      [
        "tag:test:index-merge",
        tagA ? "tag:test:signal:A" : null,
        tagB ? "tag:test:signal:B" : null,
      ].filter(Boolean),
    ),
    categoricalTokens: uniqueSorted(
      [
        "tag:test:index-merge",
        tagA ? "tag:test:signal:A" : null,
        tagB ? "tag:test:signal:B" : null,
      ].filter(Boolean),
    ),
    numericFeatureMap: {
      "candle.bodyPct": bodyPct,
      "candle.rangePct": rangePct,
      "volume.ratio20": volumeRatio20,
      "volume.valueRatio20": valueRatio20,
      "trend.runUp10": runUp10,
      "trend.closeOverMa20": closeOverMa20,
      "trend.closeOverMa120": closeOverMa120,
      ret40,
    },
    seq40: [0.01, 0.02, 0.03, seq40Last],
    seq150: [0.01, 0.015, 0.02, 0.03, seq150Last],
    outcomeHitTarget: hit,
  })

  const positiveSpecs = [
    { symbol: "100001", hit: true, tagA: true, tagB: true, bodyPct: 0.041, rangePct: 0.072, volumeRatio20: 1.12, valueRatio20: 1.07, runUp10: 0.18, closeOverMa20: 0.06, closeOverMa120: 0.03, ret40: 0.12, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100002", hit: true, tagA: true, tagB: true, bodyPct: 0.043, rangePct: 0.073, volumeRatio20: 1.09, valueRatio20: 1.08, runUp10: 0.17, closeOverMa20: 0.05, closeOverMa120: 0.02, ret40: 0.11, seq40Last: 0.04, seq150Last: 0.05 },
    { symbol: "100003", hit: true, tagA: true, tagB: true, bodyPct: 0.042, rangePct: 0.071, volumeRatio20: 1.11, valueRatio20: 1.05, runUp10: 0.19, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.13, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100004", hit: true, tagA: true, tagB: true, bodyPct: 0.039, rangePct: 0.069, volumeRatio20: 1.08, valueRatio20: 1.06, runUp10: 0.16, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.1, seq40Last: 0.04, seq150Last: 0.05 },
    { symbol: "100005", hit: true, tagA: true, tagB: true, bodyPct: 0.044, rangePct: 0.074, volumeRatio20: 1.13, valueRatio20: 1.09, runUp10: 0.18, closeOverMa20: 0.06, closeOverMa120: 0.03, ret40: 0.12, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100006", hit: true, tagA: true, tagB: true, bodyPct: 0.04, rangePct: 0.07, volumeRatio20: 1.1, valueRatio20: 1.07, runUp10: 0.17, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.11, seq40Last: 0.04, seq150Last: 0.05 },
  ]

  const negativeSpecs = [
    { symbol: "200001", hit: false, tagA: true, tagB: false, bodyPct: 0.031, rangePct: 0.067, volumeRatio20: 1.07, valueRatio20: 1.03, runUp10: 0.14, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.09, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200002", hit: false, tagA: true, tagB: false, bodyPct: 0.032, rangePct: 0.066, volumeRatio20: 1.06, valueRatio20: 1.02, runUp10: 0.13, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.09, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200003", hit: false, tagA: false, tagB: true, bodyPct: 0.029, rangePct: 0.064, volumeRatio20: 1.05, valueRatio20: 1.01, runUp10: 0.12, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.08, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200004", hit: false, tagA: false, tagB: true, bodyPct: 0.03, rangePct: 0.065, volumeRatio20: 1.04, valueRatio20: 1.02, runUp10: 0.12, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.08, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200005", hit: false, tagA: false, tagB: true, bodyPct: 0.028, rangePct: 0.063, volumeRatio20: 1.02, valueRatio20: 1.01, runUp10: 0.11, closeOverMa20: 0.02, closeOverMa120: 0.01, ret40: 0.07, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200006", hit: false, tagA: true, tagB: false, bodyPct: 0.033, rangePct: 0.066, volumeRatio20: 1.07, valueRatio20: 1.02, runUp10: 0.13, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.09, seq40Last: 0.03, seq150Last: 0.04 },
  ]

  positiveSpecs.concat(negativeSpecs).forEach((spec, index) => {
    rows.push(makeRow({ index, ...spec }))
  })
  return rows
}

const buildWrapperRows = (rows) =>
  rows.map((row, rowOrdinal) => {
    const normalizedRow = normalizePerfectPrototypeRow(
      {
        ...row,
        contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
        strategyMode: row.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
      },
      {
        surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      },
    )
    return buildPerfectPrototypeTypedParquetWrapperRow({
      rowOrdinal,
      row: projectRowToSchema(
        {
          ...normalizedRow,
          asOfDateKey: row.asOfDateKey || row.dateKey,
          targetDateKey: null,
          strategyMode: row.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
          contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
          raw: null,
        },
        TYPED_WRAPPER_SCHEMA_COLUMNS,
      ),
    })
  })

const writeFixtureParquet = async ({ outDir, fileName, rows }) => {
  await ensureDir(outDir)
  const parquetPath = path.join(outDir, `${fileName}.parquet`)
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const sink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    sessionOverrides: {
      preserveInsertionOrder: true,
    },
  })
  try {
    let rowOrdinal = 0
    for (const row of rows) {
      await sink.writeRow(
        projectRowToSchema(
          buildPerfectPrototypeTypedParquetWrapperRow({
            rowOrdinal,
            row,
          }),
          TYPED_WRAPPER_SCHEMA_COLUMNS,
        ),
      )
      rowOrdinal += 1
    }
  } finally {
    await sink.close()
  }
  return parquetPath
}

const rewriteParquetFromRows = async ({ outDir, fileName, parquetPath, rows }) => {
  await ensureDir(outDir)
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const sink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  })
  try {
    await sink.writeRows(Array.isArray(rows) ? rows : [])
    await sink.close()
  } catch (error) {
    await sink.abort()
    throw error
  }
  return parquetPath
}

const rewriteLegacyV1ParquetFromRows = async ({ parquetPath, rows }) => {
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const sink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_SINK_SCHEMA,
  })
  try {
    await sink.writeRows(Array.isArray(rows) ? rows : [])
    await sink.close()
  } catch (error) {
    await sink.abort()
    throw error
  }
  return parquetPath
}

const isServerWorkspace = (cwd) => {
  const normalizedCwd = path.resolve(String(cwd ?? "").trim())
  const policy = resolvePerfectPrototypeServerPolicy()
  const normalizedRepoRoot = path.resolve(policy.repoRoot)
  return (
    normalizedCwd === normalizedRepoRoot ||
    normalizedCwd.startsWith(`${normalizedRepoRoot}${path.sep}`)
  )
}

const collectRowMetaRows = async ({ cwd, parquetPath }) => {
  const rows = []
  await streamParquetQueryDelimitedRows({
    cwd,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA),
    orderBySql: "rowIdx",
    onRow: async (row) => {
      rows.push({
        rowIdx: Number(row?.rowIdx ?? 0),
        sourceType: row?.sourceType ?? null,
        sourceId: row?.sourceId ?? null,
        dateKey: row?.dateKey ?? null,
        symbol: row?.symbol ?? null,
        outcomeHitTarget: row?.outcomeHitTarget === true,
        strategyMode: row?.strategyMode ?? null,
      })
    },
  })
  return rows
}

const collectTokenStatsRows = async ({ cwd, parquetPath }) => {
  const rows = []
  await streamParquetQueryDelimitedRows({
    cwd,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA),
    orderBySql: "token",
    onRow: async (row) => {
      rows.push({
        token: String(row?.token ?? "").trim(),
        positiveMatchCount: Number(row?.positiveMatchCount ?? 0),
        negativeMatchCount: Number(row?.negativeMatchCount ?? 0),
        precision: Number(row?.precision ?? 0),
        separationRatio: Number(row?.separationRatio ?? 0),
        separationLift: Number(row?.separationLift ?? 0),
      })
    },
  })
  return rows
}

const collectTokenDictionaryRows = async ({ cwd, parquetPath }) => {
  const rows = []
  await streamPerfectPrototypeTokenDictionaryEntries({
    cwd,
    tokenDictionaryParquetPath: parquetPath,
    onRow: async (row) => {
      rows.push({
        token: String(row?.token ?? "").trim(),
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
      })
    },
  })
  return rows
}

const collectDecodedPostingRows = async ({ indexDir, dictionaryRows }) => {
  const postingsPath = path.join(indexDir, "token_postings.bin")
  const fileHandle = await openPerfectPrototypePostingsFile(postingsPath, "r")
  try {
    const rows = []
    for (const entry of dictionaryRows) {
      const positiveBuffer = await readPerfectPrototypePostingBufferFromFile({
        fileHandle,
        offset: entry.positiveOffset,
        byteLength: entry.positiveByteLength,
      })
      const negativeBuffer = await readPerfectPrototypePostingBufferFromFile({
        fileHandle,
        offset: entry.negativeOffset,
        byteLength: entry.negativeByteLength,
      })
      const positiveValues = Array.from(
        decodePerfectPrototypeDeltaPostings(positiveBuffer, entry.positiveCount),
      )
      const negativeValues = Array.from(
        decodePerfectPrototypeDeltaPostings(negativeBuffer, entry.negativeCount),
      )
      rows.push({
        token: entry.token,
        positiveValues,
        negativeValues,
      })
    }
    return rows
  } finally {
    await fileHandle.close()
  }
}

const collectIndexSnapshot = async ({ cwd, indexDir }) => {
  const manifest = await readJson(path.join(indexDir, "manifest.json"), null)
  const summary = await readJson(path.join(indexDir, "summary.json"), null)
  const rowMetaRows = await collectRowMetaRows({
    cwd,
    parquetPath: path.join(indexDir, "row_meta.parquet"),
  })
  const tokenStatsRows = await collectTokenStatsRows({
    cwd,
    parquetPath: path.join(indexDir, "token_stats.parquet"),
  })
  const tokenDictionaryRows = await collectTokenDictionaryRows({
    cwd,
    parquetPath: path.join(indexDir, "token_dictionary.parquet"),
  })
  const decodedPostings = await collectDecodedPostingRows({
    indexDir,
    dictionaryRows: tokenDictionaryRows,
  })
  return {
    manifest: {
      rowCount: Number(manifest?.rowCount ?? 0),
      tokenPostingCount: Number(manifest?.tokenPostingCount ?? 0),
      tokenCount: Number(manifest?.tokenCount ?? 0),
      distinctTokens:
        manifest?.distinctTokens == null ? null : Number(manifest?.distinctTokens ?? 0),
      expectedDistinctTokens:
        manifest?.expectedDistinctTokens == null
          ? null
          : Number(manifest?.expectedDistinctTokens ?? 0),
      dictionaryCursorRows:
        manifest?.dictionaryCursorRows == null
          ? null
          : Number(manifest?.dictionaryCursorRows ?? 0),
      expectedDictionaryRefRows:
        manifest?.expectedDictionaryRefRows == null
          ? null
          : Number(manifest?.expectedDictionaryRefRows ?? 0),
      maxRefsPerToken:
        manifest?.maxRefsPerToken == null ? null : Number(manifest?.maxRefsPerToken ?? 0),
      tokenDictionarySchemaVersion:
        manifest?.tokenDictionarySchemaVersion == null
          ? null
          : Number(manifest?.tokenDictionarySchemaVersion ?? 0),
      mergedDictionaryStreamMode:
        String(manifest?.mergedDictionaryStreamMode ?? "").trim() || null,
      outputSinkMode: String(manifest?.outputSinkMode ?? "").trim() || null,
      rowMetaOutputSinkRows: Number(manifest?.rowMetaOutputSinkStats?.outputSinkRows ?? 0),
      tokenStatsOutputSinkRows: Number(manifest?.tokenStatsOutputSinkStats?.outputSinkRows ?? 0),
      tokenDictionaryOutputSinkRows: Number(
        manifest?.tokenDictionaryOutputSinkStats?.outputSinkRows ?? 0,
      ),
    },
    summary: {
      rowCount: Number(summary?.rowCount ?? 0),
      tokenPostingCount: Number(summary?.tokenPostingCount ?? 0),
      tokenCount: Number(summary?.tokenCount ?? 0),
    },
    rowMetaRows,
    tokenStatsRows,
    tokenDictionaryRows,
    decodedPostings,
  }
}

const assertNativeShiftedDeltaMergeEquivalence = async ({ rootDir }) => {
  const refs = [
    {
      buffer: encodePerfectPrototypeDeltaPostings([2, 130, 20000]),
      rowOffset: 0,
      count: 3,
      firstRowIdx: 2,
      lastRowIdx: 20000,
    },
    {
      buffer: encodePerfectPrototypeDeltaPostings([3, 140, 1000]),
      rowOffset: 70000,
      count: 3,
      firstRowIdx: 3,
      lastRowIdx: 1000,
    },
    {
      buffer: encodePerfectPrototypeDeltaPostings([1, 5000]),
      rowOffset: 120000,
      count: 2,
      firstRowIdx: 1,
      lastRowIdx: 5000,
    },
  ]
  const nativeMerged = nativePerfectPrototypeRowsetKernel.mergeShiftedDeltaRefs(
    refs.map((entry) => entry.buffer),
    new Uint32Array(refs.map((entry) => entry.rowOffset)),
    new Uint32Array(refs.map((entry) => entry.count)),
  )
  const jsMerged = mergePerfectPrototypeShiftedDeltaPostingRefsJsReference({
    refs,
  })
  assert.equal(Number(nativeMerged?.count ?? -1), Number(jsMerged?.count ?? -1))
  assert.equal(Number(nativeMerged?.firstRowIdx ?? -1), Number(jsMerged?.firstRowIdx ?? -1))
  assert.equal(Number(nativeMerged?.lastRowIdx ?? -1), Number(jsMerged?.lastRowIdx ?? -1))
  assert.equal(
    Buffer.compare(
      Buffer.isBuffer(nativeMerged?.buffer) ? nativeMerged.buffer : Buffer.from(nativeMerged?.buffer ?? []),
      jsMerged.buffer,
    ),
    0,
  )
  const tempPath = path.join(rootDir, "native_shifted_refs.bin")
  const fileHandle = await openPerfectPrototypePostingsFile(tempPath, "w+")
  try {
    let cursor = 0
    const fileRefs = []
    for (const ref of refs) {
      const buffer = Buffer.isBuffer(ref.buffer) ? ref.buffer : Buffer.from(ref.buffer ?? [])
      if (buffer.length > 0) {
        await fileHandle.write(buffer, 0, buffer.length, cursor)
      }
      fileRefs.push({
        fileHandle,
        fileDescriptor: fileHandle.fd,
        offset: cursor,
        byteLength: buffer.length,
        rowOffset: ref.rowOffset,
        count: ref.count,
        firstRowIdx: ref.firstRowIdx,
        lastRowIdx: ref.lastRowIdx,
      })
      cursor += buffer.length
    }
    const nativeFileMerged = nativePerfectPrototypeRowsetKernel.mergeShiftedDeltaRefsFromFiles(
      Int32Array.from(fileRefs.map((entry) => entry.fileDescriptor)),
      BigUint64Array.from(fileRefs.map((entry) => BigInt(entry.offset))),
      Uint32Array.from(fileRefs.map((entry) => entry.byteLength)),
      Uint32Array.from(fileRefs.map((entry) => entry.rowOffset)),
      Uint32Array.from(fileRefs.map((entry) => entry.count)),
    )
    const jsFileMerged = await mergePerfectPrototypeShiftedDeltaPostingFileRefsJsReference({
      refs: fileRefs,
    })
    assert.equal(Number(nativeFileMerged?.count ?? -1), Number(jsFileMerged?.count ?? -1))
    assert.equal(Number(nativeFileMerged?.firstRowIdx ?? -1), Number(jsFileMerged?.firstRowIdx ?? -1))
    assert.equal(Number(nativeFileMerged?.lastRowIdx ?? -1), Number(jsFileMerged?.lastRowIdx ?? -1))
    assert.equal(
      Buffer.compare(
        Buffer.isBuffer(nativeFileMerged?.buffer)
          ? nativeFileMerged.buffer
          : Buffer.from(nativeFileMerged?.buffer ?? []),
        jsFileMerged.buffer,
      ),
      0,
    )
    const spliceOutPath = path.join(rootDir, "native_shifted_splice.bin")
    const spliceHandle = await openPerfectPrototypePostingsFile(spliceOutPath, "w+")
    try {
      const spliceResult = nativePerfectPrototypeRowsetKernel.spliceShiftedDeltaRefsToFile(
        spliceHandle.fd,
        0n,
        Int32Array.from(fileRefs.map((entry) => entry.fileDescriptor)),
        BigUint64Array.from(fileRefs.map((entry) => BigInt(entry.offset))),
        Uint32Array.from(fileRefs.map((entry) => entry.byteLength)),
        Uint32Array.from(fileRefs.map((entry) => entry.rowOffset)),
        Uint32Array.from(fileRefs.map((entry) => entry.count)),
        Int32Array.from(fileRefs.map((entry) => entry.firstRowIdx)),
        Int32Array.from(fileRefs.map((entry) => entry.lastRowIdx)),
      )
      await spliceHandle.sync()
      const spliceBuffer = await readPerfectPrototypePostingBufferFromFile({
        fileHandle: spliceHandle,
        offset: 0,
        byteLength: spliceResult.byteLength,
      })
      assert.equal(Number(spliceResult?.count ?? -1), Number(jsFileMerged?.count ?? -1))
      assert.equal(Number(spliceResult?.firstRowIdx ?? -1), Number(jsFileMerged?.firstRowIdx ?? -1))
      assert.equal(Number(spliceResult?.lastRowIdx ?? -1), Number(jsFileMerged?.lastRowIdx ?? -1))
      assert.equal(Number(spliceResult?.byteLength ?? -1), Number(jsFileMerged?.buffer?.length ?? -1))
      assert.equal(Buffer.compare(spliceBuffer, jsFileMerged.buffer), 0)
    } finally {
      await spliceHandle.close().catch(() => {})
    }
  } finally {
    await fileHandle.close().catch(() => {})
  }
}

const main = async () => {
  const cwd = process.cwd()
  const runId = `perfect_proto_prejump_index_merge_equivalence_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const fixtureDir = path.join(rootDir, "fixture")
  const featureStoreDir = path.join(rootDir, "feature_store")
  const directDir = path.join(rootDir, "direct_index")
  const mergedDir = path.join(rootDir, "merged_index")
  const mergedMineableDir = path.join(rootDir, "merged_mineable")
  const invalidMergedDir = path.join(rootDir, "merged_index_invalid_schema")
  const invalidDuplicateDir = path.join(rootDir, "merged_index_duplicate_shard_ref")
  const shardRootDir = path.join(rootDir, "shards")
  await ensureDir(fixtureDir)
  await ensureDir(featureStoreDir)
  await ensureDir(directDir)
  await ensureDir(mergedDir)
  await ensureDir(mergedMineableDir)
  await ensureDir(invalidMergedDir)
  await ensureDir(invalidDuplicateDir)
  await ensureDir(shardRootDir)

  await assertNativeShiftedDeltaMergeEquivalence({ rootDir })

  const rows = fixtureRows()
  const shardSlices = [
    rows.slice(0, 4),
    rows.slice(4, 8),
    rows.slice(8, 12),
  ]
  const directParquetPath = await writeFixtureParquet({
    outDir: fixtureDir,
    fileName: "direct_pack",
    rows,
  })
  const startDate = rows[0]?.dateKey ?? null
  const endDate = rows[rows.length - 1]?.dateKey ?? null

  await splitPerfectPrototypePrejumpPackIntoFeatureStore({
    cwd,
    inputPackPath: directParquetPath,
    inputPackSummary: {
      requestedDecisionRange: {
        from: startDate,
        to: endDate,
      },
      effectiveDecisionCoverage: {
        from: startDate,
        to: endDate,
        count: rows.length,
      },
      outputCoverage: {
        from: startDate,
        to: endDate,
        count: rows.length,
      },
    },
    inputPackSummaryPath: path.join(fixtureDir, "direct_pack.summary.json"),
    featureStoreDir,
    overwriteExisting: true,
  })
  const featureStoreManifest = await readJson(path.join(featureStoreDir, "manifest.json"), null)
  const selectedPartitions = buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest({
    featureStoreDir,
    manifest: featureStoreManifest,
    startDate,
    endDate,
  })
  assert.equal(selectedPartitions.length, rows.length, "expected one selected feature-store partition per fixture row")
  const canonicalTokenizerCacheInputs = buildCanonicalPerfectPrototypeTokenizerCacheInputs()
  const tokenizerSpec = await buildPerfectPrototypeTokenizerSpecFromParquetInputs({
    cwd,
    inputPaths: selectedPartitions.map((entry) => entry.parquetPath),
    featureValueInputs: selectedPartitions.map((entry) => ({
      binPath: entry.featureValuesBinPath,
      indexPath: entry.featureValuesIndexParquetPath,
    })),
    surfaceName: canonicalTokenizerCacheInputs.surfaceName,
    binCount: canonicalTokenizerCacheInputs.binCount,
    includeSymbolToken: canonicalTokenizerCacheInputs.includeSymbolToken,
    includeMissingTokens: canonicalTokenizerCacheInputs.includeMissingTokens,
    includeCategoricalTokens: canonicalTokenizerCacheInputs.includeCategoricalTokens,
  })
  const tokenizerSpecCacheInputs = { ...canonicalTokenizerCacheInputs }
  const partitionedProvenance = await buildCurrentPerfectPrototypeIndexProvenance({
    featureStoreDir,
    startDate,
    endDate,
    shardGranularity: "month",
    tokenizerSpecCacheInputs,
  })
  const mergeOptions = {
    emitTokenPostingsParquet: false,
    indexMergeMode: "global_stream",
    distinctTokenScanRequired: true,
    nativePostingsMergeRequired: true,
    partitionedProvenance,
    partitionManifest: {
      startDate,
      endDate,
      shardGranularity: "month",
    },
  }
  const tokenizerSpecCachePath = resolvePerfectPrototypeTokenizerSpecCachePath({
    featureStoreDir,
    cacheKey: partitionedProvenance.tokenizerSpecCacheKey,
  })

  await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath: directParquetPath,
    outDir: directDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      emitTokenPostingsParquet: false,
      tokenizerSpec,
    },
  })

  const shardPartitionSlices = []
  const partitionsPerShard = Math.ceil(selectedPartitions.length / shardSlices.length)
  for (let index = 0; index < selectedPartitions.length; index += partitionsPerShard) {
    shardPartitionSlices.push(selectedPartitions.slice(index, index + partitionsPerShard))
  }

  const shardIndexDirs = []
  for (let shardIndex = 0; shardIndex < shardPartitionSlices.length; shardIndex += 1) {
    const shardPartitions = shardPartitionSlices[shardIndex]
    const shardDir = path.join(shardRootDir, `shard_${String(shardIndex + 1).padStart(2, "0")}`)
    const shardIndexDir = path.join(shardDir, "index")
    await buildPerfectPrototypeTokenIndex({
      cwd,
      outDir: shardIndexDir,
      options: {
        inputPaths: shardPartitions.map((entry) => entry.parquetPath),
        coverageOverride: {
          from: shardPartitions[0]?.dateKey ?? null,
          to: shardPartitions[shardPartitions.length - 1]?.dateKey ?? null,
          count: shardPartitions.length,
        },
        surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
        emitTokenPostingsParquet: false,
        tokenizerSpec,
      },
    })
    shardIndexDirs.push(shardIndexDir)
  }

  await fsp.rm(tokenizerSpecCachePath, { force: true }).catch(() => {})
  await writeJson(tokenizerSpecCachePath, tokenizerSpec)
  await mergePerfectPrototypeTokenIndexPartitions({
    cwd,
    indexDirs: shardIndexDirs,
    outDir: path.join(rootDir, "merged_index_legacy_cache_repair"),
    options: mergeOptions,
  })
  const legacyCacheEnvelope = await readPerfectPrototypeTokenizerSpecCacheEnvelope({
    featureStoreDir,
    cacheKey: partitionedProvenance.tokenizerSpecCacheKey,
  })
  assert(legacyCacheEnvelope?.envelope, "legacy tokenizer-spec cache should be rewritten to an envelope")
  assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid({
    cachePath: legacyCacheEnvelope.cachePath,
    envelope: legacyCacheEnvelope.envelope,
    featureStoreDir,
    startDate,
    endDate,
    partitionStateHash: partitionedProvenance.partitionStateHash,
    tokenizerSpecCacheKey: partitionedProvenance.tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
  })

  await writeJson(tokenizerSpecCachePath, {
    ...(legacyCacheEnvelope?.envelope ?? {}),
    tokenizerSpecHash: "deadbeef",
  })
  await mergePerfectPrototypeTokenIndexPartitions({
    cwd,
    indexDirs: shardIndexDirs,
    outDir: path.join(rootDir, "merged_index_invalid_cache_repair"),
    options: mergeOptions,
  })
  const repairedCacheEnvelope = await readPerfectPrototypeTokenizerSpecCacheEnvelope({
    featureStoreDir,
    cacheKey: partitionedProvenance.tokenizerSpecCacheKey,
  })
  const validatedRepairedCache = assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid({
    cachePath: repairedCacheEnvelope?.cachePath,
    envelope: repairedCacheEnvelope?.envelope,
    featureStoreDir,
    startDate,
    endDate,
    partitionStateHash: partitionedProvenance.partitionStateHash,
    tokenizerSpecCacheKey: partitionedProvenance.tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
  })
  assert.equal(
    validatedRepairedCache.envelope.tokenizerSpecHash,
    buildPerfectPrototypeTokenizerSpecHash(validatedRepairedCache.envelope.tokenizerSpec),
  )

  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: path.join(rootDir, "merged_index_noncanonical_tokenizer_options"),
        options: {
          ...mergeOptions,
          partitionedProvenance: {
            ...mergeOptions.partitionedProvenance,
            tokenizerSpecCacheInputs: {
              ...PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
              includeMissingTokens: true,
            },
          },
        },
      }),
    /canonical predictive tokenizer options must remain fixed/i,
  )

  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: path.join(rootDir, "merged_index_missing_provenance"),
        options: {
          emitTokenPostingsParquet: false,
          indexMergeMode: "global_stream",
          distinctTokenScanRequired: true,
          nativePostingsMergeRequired: true,
        },
    }),
    /requires canonical feature-store provenance/i,
  )

  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: [shardIndexDirs[0], shardIndexDirs[0], ...shardIndexDirs.slice(1)],
        outDir: path.join(rootDir, "merged_index_duplicate_source_dir"),
        options: mergeOptions,
      }),
    /requires unique source index directories/i,
  )

  const dirtyMergeOutDir = path.join(rootDir, "merged_index_dirty_out")
  await ensureDir(dirtyMergeOutDir)
  await writeJson(path.join(dirtyMergeOutDir, "manifest.json"), { stale: true })
  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: dirtyMergeOutDir,
        options: mergeOptions,
      }),
    /outDir must be empty before the build\/merge starts/i,
  )

  const partitionedSourceManifestPath = path.join(shardIndexDirs[0], "manifest.json")
  const partitionedSourceManifestBackup = await readJson(partitionedSourceManifestPath, null)
  const partitionedSourcePartitionManifestPath = path.join(shardIndexDirs[0], "partition_manifest.json")
  try {
    await writeJson(partitionedSourceManifestPath, {
      ...partitionedSourceManifestBackup,
      partitioned: true,
    })
    await writeJson(partitionedSourcePartitionManifestPath, {
      version: 1,
      stale: true,
    })
    await assert.rejects(
      () =>
        mergePerfectPrototypeTokenIndexPartitions({
          cwd,
          indexDirs: shardIndexDirs,
          outDir: path.join(rootDir, "merged_index_partitioned_source"),
          options: mergeOptions,
        }),
      /accepts only non-partitioned shard-local source indexes/i,
    )
  } finally {
    await writeJson(partitionedSourceManifestPath, partitionedSourceManifestBackup)
    await fsp.rm(partitionedSourcePartitionManifestPath, { force: true })
  }

  const mismatchedSourceManifestPath = path.join(shardIndexDirs[1], "manifest.json")
  const mismatchedSourceManifestBackup = await readJson(mismatchedSourceManifestPath, null)
  try {
    await writeJson(mismatchedSourceManifestPath, {
      ...mismatchedSourceManifestBackup,
      inputProvenance: {
        ...(mismatchedSourceManifestBackup?.inputProvenance ?? {}),
        inputPaths: [path.join(rootDir, "unexpected_partition_input.parquet")],
      },
    })
    await assert.rejects(
      () =>
        mergePerfectPrototypeTokenIndexPartitions({
          cwd,
          indexDirs: shardIndexDirs,
          outDir: path.join(rootDir, "merged_index_source_set_mismatch"),
          options: mergeOptions,
        }),
      /source-set does not exactly match the selected feature-store partitions/i,
    )
  } finally {
    await writeJson(mismatchedSourceManifestPath, mismatchedSourceManifestBackup)
  }

  const tokenizerSpecBackups = []
  try {
    for (const shardIndexDir of shardIndexDirs) {
      const manifestPath = path.join(shardIndexDir, "manifest.json")
      const summaryPath = path.join(shardIndexDir, "summary.json")
      const tokenizerSpecPath = path.join(shardIndexDir, "tokenizer_spec.json")
      const manifestBackup = await readJson(manifestPath, null)
      const summaryBackup = await readJson(summaryPath, null)
      const tokenizerSpecBackup = await readJson(tokenizerSpecPath, null)
      tokenizerSpecBackups.push({
        manifestPath,
        summaryPath,
        tokenizerSpecPath,
        manifestBackup,
        summaryBackup,
        tokenizerSpecBackup,
      })
      const staleTokenizerSpec = {
        ...tokenizerSpecBackup,
        options: {
          ...(tokenizerSpecBackup?.options ?? {}),
          includeMissingTokens: !(tokenizerSpecBackup?.options?.includeMissingTokens === true),
        },
      }
      const staleTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(staleTokenizerSpec)
      await writeJson(tokenizerSpecPath, staleTokenizerSpec)
      await writeJson(manifestPath, {
        ...manifestBackup,
        tokenizerSpecHash: staleTokenizerSpecHash,
        tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
      })
      await writeJson(summaryPath, {
        ...summaryBackup,
        tokenizerSpecHash: staleTokenizerSpecHash,
        tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
      })
    }
    await assert.rejects(
      () =>
        mergePerfectPrototypeTokenIndexPartitions({
          cwd,
          indexDirs: shardIndexDirs,
          outDir: path.join(rootDir, "merged_index_stale_tokenizer_spec"),
          options: mergeOptions,
        }),
      /canonical current feature-store tokenizer spec/i,
    )
  } finally {
    for (const entry of tokenizerSpecBackups) {
      await writeJson(entry.manifestPath, entry.manifestBackup)
      await writeJson(entry.summaryPath, entry.summaryBackup)
      await writeJson(entry.tokenizerSpecPath, entry.tokenizerSpecBackup)
    }
  }

  const invalidManifestPath = path.join(shardIndexDirs[0], "manifest.json")
  const invalidManifest = await readJson(invalidManifestPath, null)
  await writeJson(invalidManifestPath, {
    ...invalidManifest,
    tokenDictionarySchemaVersion: 1,
  })
  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: invalidMergedDir,
        options: mergeOptions,
      }),
    /schema v2 or newer|requiredSchemaVersion/,
  )
  await writeJson(invalidManifestPath, invalidManifest)

  const duplicateDictionaryPath = path.join(shardIndexDirs[0], "token_dictionary.parquet")
  const duplicateDictionaryBackup = await fsp.readFile(duplicateDictionaryPath)
  const duplicateDictionaryRows = await collectTokenDictionaryRows({
    cwd,
    parquetPath: duplicateDictionaryPath,
  })
  assert.ok(duplicateDictionaryRows.length > 0, "expected shard token dictionary rows")
  const duplicatedFirstRow = {
    ...duplicateDictionaryRows[0],
  }
  const duplicatePayloadRows = [
    duplicateDictionaryRows[0],
    duplicatedFirstRow,
    ...duplicateDictionaryRows.slice(1),
  ]
  try {
    await rewriteParquetFromRows({
      outDir: path.dirname(duplicateDictionaryPath),
      fileName: "token_dictionary_duplicate_shard_ref",
      parquetPath: duplicateDictionaryPath,
      rows: duplicatePayloadRows,
    })
    await assert.rejects(
      () =>
        mergePerfectPrototypeTokenIndexPartitions({
          cwd,
          indexDirs: shardIndexDirs,
          outDir: invalidDuplicateDir,
          options: mergeOptions,
        }),
      /duplicate shardIndex/i,
    )
  } finally {
    await fsp.writeFile(duplicateDictionaryPath, duplicateDictionaryBackup)
  }

  for (const shardIndexDir of shardIndexDirs) {
    const manifestPath = path.join(shardIndexDir, "manifest.json")
    const summaryPath = path.join(shardIndexDir, "summary.json")
    const manifest = await readJson(manifestPath, null)
    const summary = await readJson(summaryPath, null)
    const strippedManifest = { ...(manifest ?? {}) }
    const strippedSummary = { ...(summary ?? {}) }
    delete strippedManifest.tokenizerSpecHash
    delete strippedManifest.tokenizerSpecFingerprintVersion
    delete strippedManifest.inputProvenance
    delete strippedSummary.tokenizerSpecHash
    delete strippedSummary.tokenizerSpecFingerprintVersion
    delete strippedSummary.inputProvenance
    await writeJson(manifestPath, strippedManifest)
    await writeJson(summaryPath, strippedSummary)
  }
  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: path.join(rootDir, "merged_index_missing_tokenizer_fingerprint"),
        options: mergeOptions,
      }),
    /missing tokenizerSpecHash/i,
  )
  if (isServerWorkspace(cwd)) {
    await execFile(
      process.execPath,
      [
        "tools/repair_perfect_prototype_index_tokenizer_fingerprint.mjs",
        ...shardIndexDirs,
      ],
      { cwd },
    )
  } else {
    for (const shardIndexDir of shardIndexDirs) {
      const provenanceRepair = await repairPerfectPrototypeDirectIndexInputProvenanceArtifacts({
        indexDir: shardIndexDir,
        write: true,
      })
      const repairResult = await repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts({
        indexDir: shardIndexDir,
        write: true,
      })
      assert.equal(provenanceRepair.repaired, true)
      assert.equal(repairResult.repaired, true)
      assert.ok(provenanceRepair.changedFiles.length >= 2)
      assert.ok(repairResult.changedFiles.length >= 2)
    }
  }
  for (const shardIndexDir of shardIndexDirs) {
    const tokenizerSpec = await readJson(path.join(shardIndexDir, "tokenizer_spec.json"), null)
    const manifest = await readJson(path.join(shardIndexDir, "manifest.json"), null)
    const summary = await readJson(path.join(shardIndexDir, "summary.json"), null)
    const fingerprintMetadata = buildPerfectPrototypeTokenizerSpecFingerprintMetadata(tokenizerSpec)
    assert.equal(String(manifest?.tokenizerSpecHash ?? ""), fingerprintMetadata.tokenizerSpecHash)
    assert.equal(
      Number(manifest?.tokenizerSpecFingerprintVersion ?? 0),
      PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
    )
    assert.equal(String(summary?.tokenizerSpecHash ?? ""), fingerprintMetadata.tokenizerSpecHash)
    assert.equal(
      Number(summary?.tokenizerSpecFingerprintVersion ?? 0),
      PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
    )
    assert.ok(Array.isArray(manifest?.inputProvenance?.inputPaths))
    assert.ok(manifest.inputProvenance.inputPaths.length >= 1)
    assert.equal(String(summary?.inputProvenance?.inputStateHash ?? ""), String(manifest?.inputProvenance?.inputStateHash ?? ""))
  }

  for (const shardIndexDir of shardIndexDirs) {
    const manifestPath = path.join(shardIndexDir, "manifest.json")
    const summaryPath = path.join(shardIndexDir, "summary.json")
    const dictionaryPath = path.join(shardIndexDir, "token_dictionary.parquet")
    const manifest = await readJson(manifestPath, null)
    const summary = await readJson(summaryPath, null)
    const dictionaryRows = await collectTokenDictionaryRows({
      cwd,
      parquetPath: dictionaryPath,
    })
    const legacyRows = dictionaryRows.map(
      ({
        positiveFirstRowIdx,
        positiveLastRowIdx,
        negativeFirstRowIdx,
        negativeLastRowIdx,
        ...entry
      }) => entry,
    )
    await rewriteLegacyV1ParquetFromRows({
      parquetPath: dictionaryPath,
      rows: legacyRows,
    })
    await writeJson(manifestPath, {
      ...manifest,
      outputSinkMode: null,
      tokenDictionarySchemaVersion: 1,
      tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_REQUIRED_COLUMNS,
    })
    await writeJson(summaryPath, {
      ...summary,
      outputSinkMode: null,
      tokenDictionarySchemaVersion: 1,
      tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_V1_REQUIRED_COLUMNS,
    })
  }
  await assert.rejects(
    () =>
      mergePerfectPrototypeTokenIndexPartitions({
        cwd,
        indexDirs: shardIndexDirs,
        outDir: path.join(rootDir, "merged_index_legacy_dictionary_v1"),
        options: mergeOptions,
      }),
    /schema v2 or newer|requiredSchemaVersion/,
  )
  if (isServerWorkspace(cwd)) {
    await execFile(
      process.execPath,
      [
        "tools/upgrade_perfect_prototype_index_token_dictionary_v2.mjs",
        ...shardIndexDirs,
      ],
      { cwd },
    )
  } else {
    for (const shardIndexDir of shardIndexDirs) {
      const upgradeResult = await upgradePerfectPrototypeLegacyTokenDictionarySchemaV1Artifacts({
        cwd,
        indexDir: shardIndexDir,
        write: true,
      })
      assert.equal(upgradeResult.upgradedDictionary, true)
    }
  }
  for (const shardIndexDir of shardIndexDirs) {
    const manifest = await readJson(path.join(shardIndexDir, "manifest.json"), null)
    const summary = await readJson(path.join(shardIndexDir, "summary.json"), null)
    assert.equal(
      Number(manifest?.tokenDictionarySchemaVersion ?? 0),
      2,
      "upgraded shard manifest should declare dictionary schema v2",
    )
    assert.equal(
      Number(summary?.tokenDictionarySchemaVersion ?? 0),
      2,
      "upgraded shard summary should declare dictionary schema v2",
    )
    assert.deepStrictEqual(
      manifest?.tokenDictionaryRequiredColumns ?? [],
      PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
    )
    assert.deepStrictEqual(
      summary?.tokenDictionaryRequiredColumns ?? [],
      PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
    )
    assert.equal(String(manifest?.outputSinkMode ?? ""), "delimited")
    assert.equal(String(summary?.outputSinkMode ?? ""), "delimited")
  }

  await mergePerfectPrototypeTokenIndexPartitions({
    cwd,
    indexDirs: shardIndexDirs,
    outDir: mergedDir,
    options: mergeOptions,
  })

  const cliMergedDir = path.join(rootDir, "merged_index_cli")
  const shouldRunCliWrapperEquivalence = isServerWorkspace(cwd)
  if (shouldRunCliWrapperEquivalence) {
    await execFile(
      process.execPath,
      [
        "tools/merge_perfect_prototype_token_index_partitions.mjs",
        `--out-dir=${cliMergedDir}`,
        `--feature-store-dir=${featureStoreDir}`,
        `--start=${startDate}`,
        `--end=${endDate}`,
        "--shard-granularity=month",
        ...shardIndexDirs,
      ],
      { cwd },
    )
  }

  const mergedManifestRaw = await readJson(path.join(mergedDir, "manifest.json"), null)
  const mergedSummaryRaw = await readJson(path.join(mergedDir, "summary.json"), null)
  const mergedPartitionManifest = await readJson(path.join(mergedDir, "partition_manifest.json"), null)
  const mergedTokenizerSpec = await readJson(path.join(mergedDir, "tokenizer_spec.json"), null)
  const mergedTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(mergedTokenizerSpec)
  assert.equal(mergedManifestRaw?.partitioned, true)
  assert.equal(String(mergedManifestRaw?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  assert.equal(String(mergedSummaryRaw?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  assert.equal(String(mergedManifestRaw?.tokenizerSpecHash ?? ""), mergedTokenizerSpecHash)
  assert.equal(String(mergedSummaryRaw?.tokenizerSpecHash ?? ""), mergedTokenizerSpecHash)
  assert.equal(String(mergedPartitionManifest?.tokenizerSpecHash ?? ""), mergedTokenizerSpecHash)
  assert.equal(
    Number(mergedPartitionManifest?.tokenizerSpecFingerprintVersion ?? 0),
    PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  )
  assert.equal(
    String(mergedManifestRaw?.partitionManifestPath ?? ""),
    path.join(mergedDir, "partition_manifest.json"),
  )
  assert(mergedPartitionManifest?.featureStoreProvenance, "merged output must persist featureStoreProvenance")
  assert.equal(
    String(mergedPartitionManifest?.featureStoreProvenance?.featureStoreDir ?? ""),
    path.resolve(featureStoreDir),
  )

  await minePerfectPrototypeIndexed({
    cwd,
    indexDir: mergedDir,
    outDir: mergedMineableDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 20000000,
    },
  })

  const directSnapshot = await collectIndexSnapshot({
    cwd,
    indexDir: directDir,
  })
  const mergedSnapshot = await collectIndexSnapshot({
    cwd,
    indexDir: mergedDir,
  })
  const cliMergedSnapshot = shouldRunCliWrapperEquivalence
    ? await collectIndexSnapshot({
        cwd,
        indexDir: cliMergedDir,
      })
    : null

  assert.deepStrictEqual(mergedSnapshot.rowMetaRows, directSnapshot.rowMetaRows)
  assert.deepStrictEqual(mergedSnapshot.tokenStatsRows, directSnapshot.tokenStatsRows)
  assert.deepStrictEqual(mergedSnapshot.tokenDictionaryRows, directSnapshot.tokenDictionaryRows)
  assert.deepStrictEqual(mergedSnapshot.decodedPostings, directSnapshot.decodedPostings)
  assert.equal(mergedSnapshot.manifest.rowCount, directSnapshot.manifest.rowCount)
  assert.equal(mergedSnapshot.manifest.tokenPostingCount, directSnapshot.manifest.tokenPostingCount)
  assert.equal(mergedSnapshot.manifest.tokenCount, directSnapshot.manifest.tokenCount)
  assert.equal(mergedSnapshot.summary.rowCount, directSnapshot.summary.rowCount)
  assert.equal(mergedSnapshot.summary.tokenPostingCount, directSnapshot.summary.tokenPostingCount)
  assert.equal(mergedSnapshot.summary.tokenCount, directSnapshot.summary.tokenCount)
  assert.equal(mergedSnapshot.manifest.distinctTokens, mergedSnapshot.manifest.tokenCount)
  assert.equal(mergedSnapshot.manifest.expectedDistinctTokens, mergedSnapshot.manifest.tokenCount)
  assert.equal(
    mergedSnapshot.manifest.dictionaryCursorRows,
    mergedSnapshot.manifest.expectedDictionaryRefRows,
  )
  assert.equal(mergedSnapshot.manifest.tokenDictionarySchemaVersion, 2)
  assert.equal(directSnapshot.manifest.outputSinkMode, "delimited")
  assert.equal(mergedSnapshot.manifest.outputSinkMode, "delimited")
  assert.equal(mergedSnapshot.manifest.mergedDictionaryStreamMode, "delimited")
  assert(Number.isFinite(mergedSnapshot.manifest.rowMetaOutputSinkRows))
  assert(Number.isFinite(mergedSnapshot.manifest.tokenStatsOutputSinkRows))
  assert(Number.isFinite(mergedSnapshot.manifest.tokenDictionaryOutputSinkRows))
  if (shouldRunCliWrapperEquivalence) {
    assert(cliMergedSnapshot, "expected CLI merged snapshot in server workspace")
    assert.deepStrictEqual(cliMergedSnapshot.rowMetaRows, mergedSnapshot.rowMetaRows)
    assert.deepStrictEqual(cliMergedSnapshot.tokenStatsRows, mergedSnapshot.tokenStatsRows)
    assert.deepStrictEqual(cliMergedSnapshot.tokenDictionaryRows, mergedSnapshot.tokenDictionaryRows)
    assert.deepStrictEqual(cliMergedSnapshot.decodedPostings, mergedSnapshot.decodedPostings)
    assert.deepStrictEqual(cliMergedSnapshot.manifest, mergedSnapshot.manifest)
    assert.deepStrictEqual(cliMergedSnapshot.summary, mergedSnapshot.summary)
  }

  const summary = {
    runId,
    rowCount: directSnapshot.manifest.rowCount,
    tokenCount: directSnapshot.manifest.tokenCount,
    tokenPostingCount: directSnapshot.manifest.tokenPostingCount,
    distinctTokens: mergedSnapshot.manifest.distinctTokens,
    maxRefsPerToken: mergedSnapshot.manifest.maxRefsPerToken,
    cliWrapperEquivalent: shouldRunCliWrapperEquivalence,
    tokenizerFingerprintRepairVerified: true,
    legacyDictionarySchemaUpgradeVerified: true,
  }
  await writeJson(path.join(rootDir, "index_merge_equivalence_summary.json"), summary)
  console.log(
    JSON.stringify(
      {
        ok: true,
        rootDir,
        summary,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
