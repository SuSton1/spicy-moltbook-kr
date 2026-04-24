import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  runPerfectPrototypeDuckdbSql,
  sqlQuote,
} from "../src/lib/perfect_prototype_duckdb.mjs"
import {
  buildCurrentPerfectPrototypeDirectIndexProvenance,
  buildCurrentPerfectPrototypeIndexProvenance,
} from "../src/lib/perfect_prototype_index_provenance.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { buildPerfectPrototypeTypedParquetWrapperRow } from "../src/lib/perfect_prototype_parquet_io.mjs"
import { splitPerfectPrototypePrejumpPackIntoFeatureStore } from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import { streamSelectPerfectPrototypeSeedEntries } from "../src/lib/perfect_prototype_seed_selector.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "../src/lib/perfect_prototype_structured_sink_schemas.mjs"
import {
  PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  buildPerfectPrototypeTokenizerSpecHash,
} from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  buildCanonicalPerfectPrototypeTokenizerCacheInputs,
  PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
} from "../src/lib/perfect_prototype_tokenizer_contract.mjs"
import {
  assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid,
  readPerfectPrototypeTokenizerSpecCacheEnvelope,
  resolvePerfectPrototypeTokenizerSpecCachePath,
} from "../src/lib/perfect_prototype_tokenizer_spec_cache.mjs"
import { buildPerfectPrototypePartitionedTokenIndexFromFeatureStore } from "../src/lib/perfect_prototype_token_index_merge.mjs"
import {
  buildPerfectPrototypeTokenIndex,
  loadPerfectPrototypeIndexedArtifacts,
} from "../src/lib/perfect_prototype_token_index.mjs"

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

const buildDateKeys = () => {
  const out = []
  const cursor = new Date("2024-02-01T00:00:00Z")
  while (out.length < 6) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const buildFixtureRows = () => {
  const dateKeys = buildDateKeys()
  const baseMarketContext = {
    candidateCount: 6,
    uniqueSymbolCount: 6,
    bodyPctMedian: 0.03,
    rangePctMedian: 0.06,
    volumeRatio20Median: 1.05,
    valueRatio20Median: 1.02,
    runUp10Median: 0.12,
    ret40Median: 0.08,
    positiveBodyShare: 0.6,
    wideRangeShare: 0.3,
    elevatedVolumeShare: 0.35,
    closeOverMa20Share: 0.7,
    closeOverMa120Share: 0.5,
  }
  const specs = [
    { symbol: "300001", hit: true, tagA: true, tagB: true, bodyPct: 0.042, rangePct: 0.073, volumeRatio20: 1.11, valueRatio20: 1.07, runUp10: 0.18, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.12 },
    { symbol: "300002", hit: true, tagA: true, tagB: false, bodyPct: 0.04, rangePct: 0.071, volumeRatio20: 1.09, valueRatio20: 1.05, runUp10: 0.17, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.11 },
    { symbol: "300003", hit: true, tagA: true, tagB: true, bodyPct: 0.041, rangePct: 0.072, volumeRatio20: 1.12, valueRatio20: 1.06, runUp10: 0.19, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.13 },
    { symbol: "400001", hit: false, tagA: true, tagB: false, bodyPct: 0.031, rangePct: 0.066, volumeRatio20: 1.04, valueRatio20: 1.01, runUp10: 0.13, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.08 },
    { symbol: "400002", hit: false, tagA: false, tagB: true, bodyPct: 0.029, rangePct: 0.064, volumeRatio20: 1.03, valueRatio20: 1.01, runUp10: 0.12, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.07 },
    { symbol: "400003", hit: false, tagA: false, tagB: false, bodyPct: 0.028, rangePct: 0.063, volumeRatio20: 1.02, valueRatio20: 1.0, runUp10: 0.11, closeOverMa20: 0.02, closeOverMa120: 0.01, ret40: 0.07 },
  ]
  return specs.map((spec, index) => ({
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `guard_fixture_${String(index + 1).padStart(2, "0")}`,
    symbol: spec.symbol,
    dateKey: dateKeys[index],
    decisionDateKey: dateKeys[index],
    asOfDateKey: dateKeys[index],
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    featureVec: {
      "candle.bodyPct": spec.bodyPct,
      "candle.rangePct": spec.rangePct,
      "volume.ratio20": spec.volumeRatio20,
      "volume.valueRatio20": spec.valueRatio20,
      "trend.runUp10": spec.runUp10,
      "trend.closeOverMa20": spec.closeOverMa20,
      "trend.closeOverMa120": spec.closeOverMa120,
    },
    globalFeatureVec: {
      ret40: spec.ret40,
    },
    marketContextVec: {
      ...baseMarketContext,
    },
    xsecEventVec: {
      bodyRankPct: spec.hit ? 0.82 : 0.31,
      rangeRankPct: spec.hit ? 0.8 : 0.34,
      volumeRankPct: spec.hit ? 0.85 : 0.3,
      valueRatioRankPct: spec.hit ? 0.78 : 0.33,
      runUp10RankPct: spec.hit ? 0.88 : 0.29,
      ret40RankPct: spec.hit ? 0.76 : 0.35,
      bodyVsMedian: spec.bodyPct - baseMarketContext.bodyPctMedian,
      rangeVsMedian: spec.rangePct - baseMarketContext.rangePctMedian,
      volumeVsMedian: spec.volumeRatio20 - baseMarketContext.volumeRatio20Median,
      valueRatioVsMedian: spec.valueRatio20 - baseMarketContext.valueRatio20Median,
      runUp10VsMedian: spec.runUp10 - baseMarketContext.runUp10Median,
      ret40VsMedian: spec.ret40 - baseMarketContext.ret40Median,
      isolationScore: 1 / 6,
    },
    categoricalTokens: uniqueSorted(
      [
        "tag:test:guard",
        spec.tagA ? "tag:test:alpha" : null,
        spec.tagB ? "tag:test:beta" : null,
      ].filter(Boolean),
    ),
    numericFeatureMap: {
      "candle.bodyPct": spec.bodyPct,
      "candle.rangePct": spec.rangePct,
      "volume.ratio20": spec.volumeRatio20,
      "volume.valueRatio20": spec.valueRatio20,
      "trend.runUp10": spec.runUp10,
      "trend.closeOverMa20": spec.closeOverMa20,
      "trend.closeOverMa120": spec.closeOverMa120,
      ret40: spec.ret40,
    },
    seq40: [0.01, 0.02, 0.03, spec.ret40],
    seq150: [0.01, 0.015, 0.02, 0.03, spec.ret40],
    outcomeHitTarget: spec.hit,
    targetDateKey: dateKeys[index],
  }))
}

const writePackParquet = async ({ cwd, duckdb, packPath, rows }) => {
  const sink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath: packPath,
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
}

const rewriteParquet = async ({ cwd, duckdb, parquetPath, selectSql }) => {
  const tempPath = `${parquetPath}.tmp`
  await runPerfectPrototypeDuckdbSql({
    cwd,
    duckdb,
    sql: `
COPY (
${selectSql}
) TO ${sqlQuote(tempPath)} (FORMAT PARQUET, COMPRESSION ZSTD);
`,
  })
  await fsp.rm(parquetPath, { force: true })
  await fsp.rename(tempPath, parquetPath)
}

const retargetCopiedIndexArtifacts = async (indexDir) => {
  const resolvedIndexDir = path.resolve(indexDir)
  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const manifest = await readJson(manifestPath, null)
  const summary = await readJson(summaryPath, null)
  const patchPaths = (value) => ({
    ...value,
    tokenizerSpecPath: path.join(resolvedIndexDir, "tokenizer_spec.json"),
    rowMetaParquetPath: path.join(resolvedIndexDir, "row_meta.parquet"),
    tokenPostingsParquetPath:
      value?.tokenPostingsParquetPath == null ? null : path.join(resolvedIndexDir, "token_postings.parquet"),
    tokenPostingsBinPath: path.join(resolvedIndexDir, "token_postings.bin"),
    tokenDictionaryParquetPath: path.join(resolvedIndexDir, "token_dictionary.parquet"),
    tokenDictionaryPath: path.join(resolvedIndexDir, "token_dictionary.json"),
    tokenStatsParquetPath: path.join(resolvedIndexDir, "token_stats.parquet"),
    manifestPath,
    summaryPath,
    partitionManifestPath: path.join(resolvedIndexDir, "partition_manifest.json"),
  })
  await writeJson(manifestPath, patchPaths(manifest ?? {}))
  await writeJson(summaryPath, patchPaths(summary ?? {}))
}

const expectFailure = async ({ label, fn, pattern }) => {
  let error = null
  try {
    await fn()
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, `${label} should fail fast`)
  assert.match(error.message, pattern, `${label} emitted an unexpected error`)
}

const main = async () => {
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const runId = `perfect_proto_index_contract_guard_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const packDir = path.join(rootDir, "pack")
  const directPackDir = path.join(rootDir, "direct_pack")
  const featureStoreDir = path.join(rootDir, "feature_store")
  const workspaceDir = path.join(rootDir, "workspace")
  const indexDir = path.join(rootDir, "index")
  const directIndexDir = path.join(rootDir, "direct_index")
  const indexedValidDir = path.join(rootDir, "indexed_valid")
  await ensureDir(rootDir)
  await ensureDir(packDir)
  await ensureDir(directPackDir)
  await ensureDir(featureStoreDir)
  await ensureDir(workspaceDir)
  await ensureDir(indexDir)
  await ensureDir(directIndexDir)

  const rows = buildFixtureRows()
  const startDate = rows[0]?.dateKey ?? null
  const endDate = rows[rows.length - 1]?.dateKey ?? null
  const packPath = path.join(packDir, "prejump_pack.parquet")
  const directPackPath = path.join(directPackDir, "prejump_pack.parquet")
  await writePackParquet({
    cwd,
    duckdb,
    packPath,
    rows,
  })
  await writePackParquet({
    cwd,
    duckdb,
    packPath: directPackPath,
    rows,
  })

  await splitPerfectPrototypePrejumpPackIntoFeatureStore({
    cwd,
    inputPackPath: packPath,
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
    inputPackSummaryPath: path.join(packDir, "prejump_pack.summary.json"),
    featureStoreDir,
    overwriteExisting: true,
  })
  const canonicalTokenizerOptions = buildCanonicalPerfectPrototypeTokenizerCacheInputs()
  const currentPartitionedProvenance = await buildCurrentPerfectPrototypeIndexProvenance({
    featureStoreDir,
    startDate,
    endDate,
    shardGranularity: "month",
    tokenizerSpecCacheInputs: canonicalTokenizerOptions,
  })
  const tokenizerSpecCachePath = resolvePerfectPrototypeTokenizerSpecCachePath({
    featureStoreDir,
    cacheKey: currentPartitionedProvenance.tokenizerSpecCacheKey,
  })
  await writeJson(tokenizerSpecCachePath, {
    legacy: true,
    options: canonicalTokenizerOptions,
  })

  await buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
    cwd,
    featureStoreDir,
    startDate,
    endDate,
    workspaceDir,
    outDir: indexDir,
    options: {
      ...canonicalTokenizerOptions,
    },
  })
  const validatedTokenizerCacheEnvelope = assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid({
    cachePath: tokenizerSpecCachePath,
    envelope: (
      await readPerfectPrototypeTokenizerSpecCacheEnvelope({
        featureStoreDir,
        cacheKey: currentPartitionedProvenance.tokenizerSpecCacheKey,
      })
    )?.envelope,
    featureStoreDir,
    startDate,
    endDate,
    partitionStateHash: currentPartitionedProvenance.partitionStateHash,
    tokenizerSpecCacheKey: currentPartitionedProvenance.tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs: canonicalTokenizerOptions,
  })
  assert.equal(
    validatedTokenizerCacheEnvelope.envelope.tokenizerSpecHash,
    buildPerfectPrototypeTokenizerSpecHash(validatedTokenizerCacheEnvelope.envelope.tokenizerSpec),
  )
  await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath: directPackPath,
    outDir: directIndexDir,
    options: {
      ...canonicalTokenizerOptions,
      emitTokenPostingsParquet: false,
    },
  })
  const staleTokenPostingsParquetPath = path.join(directIndexDir, "token_postings.parquet")
  await fsp.writeFile(staleTokenPostingsParquetPath, "stale-parquet-should-not-be-used\n", "utf8")
  const loadedDirectArtifacts = await loadPerfectPrototypeIndexedArtifacts(directIndexDir)
  assert.equal(
    loadedDirectArtifacts.tokenPostingsParquetPath,
    null,
    "stale token_postings.parquet must not be revived when manifest disables it",
  )
  const directTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(loadedDirectArtifacts.tokenizerSpec)
  assert.equal(String(loadedDirectArtifacts.manifest?.tokenizerSpecHash ?? ""), directTokenizerSpecHash)
  assert.equal(String(loadedDirectArtifacts.summary?.tokenizerSpecHash ?? ""), directTokenizerSpecHash)
  assert.equal(
    Number(loadedDirectArtifacts.manifest?.tokenizerSpecFingerprintVersion ?? 0),
    PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  )

  const dirtyDirectIndexDir = path.join(rootDir, "case_dirty_direct_index_out_dir")
  await ensureDir(dirtyDirectIndexDir)
  await writeJson(path.join(dirtyDirectIndexDir, "partition_manifest.json"), { stale: true })
  await expectFailure({
    label: "dirty direct index outDir with stale partition_manifest",
    fn: () =>
      buildPerfectPrototypeTokenIndex({
        cwd,
        inputPath: directPackPath,
        outDir: dirtyDirectIndexDir,
        options: {
          ...canonicalTokenizerOptions,
          emitTokenPostingsParquet: false,
        },
      }),
    pattern: /must be empty before the build\/merge starts|stale partition_manifest\.json detected/i,
  })

  const dirtyPartitionedWorkspaceDir = path.join(rootDir, "case_dirty_partitioned_workspace")
  const dirtyPartitionedOutDir = path.join(rootDir, "case_dirty_partitioned_out")
  await ensureDir(dirtyPartitionedWorkspaceDir)
  await ensureDir(dirtyPartitionedOutDir)
  await writeJson(path.join(dirtyPartitionedWorkspaceDir, "stale_workspace_marker.json"), { stale: true })
  await writeJson(path.join(dirtyPartitionedOutDir, "manifest.json"), { stale: true })
  await expectFailure({
    label: "dirty partitioned index workspaceDir",
    fn: () =>
      buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
        cwd,
        featureStoreDir,
        startDate,
        endDate,
        workspaceDir: dirtyPartitionedWorkspaceDir,
        outDir: path.join(rootDir, "unused_clean_partitioned_out"),
        options: {
          ...canonicalTokenizerOptions,
        },
      }),
    pattern: /workspaceDir must be empty before the build\/merge starts/i,
  })
  await expectFailure({
    label: "dirty partitioned index outDir",
    fn: () =>
      buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
        cwd,
        featureStoreDir,
        startDate,
        endDate,
        workspaceDir: path.join(rootDir, "unused_clean_partitioned_workspace"),
        outDir: dirtyPartitionedOutDir,
        options: {
          ...canonicalTokenizerOptions,
        },
      }),
    pattern: /outDir must be empty before the build\/merge starts/i,
  })
  await expectFailure({
    label: "partitioned build with non-canonical tokenizer options",
    fn: () =>
      buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
        cwd,
        featureStoreDir,
        startDate,
        endDate,
        workspaceDir: path.join(rootDir, "case_noncanonical_tokenizer_workspace"),
        outDir: path.join(rootDir, "case_noncanonical_tokenizer_out"),
        options: {
          ...PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
          includeMissingTokens: true,
        },
      }),
    pattern: /canonical predictive tokenizer options must remain fixed/i,
  })

  const manifestPath = path.join(indexDir, "manifest.json")
  const summaryPath = path.join(indexDir, "summary.json")
  const partitionManifestPath = path.join(indexDir, "partition_manifest.json")
  const manifest = await readJson(manifestPath, null)
  const summary = await readJson(summaryPath, null)
  const partitionManifest = await readJson(partitionManifestPath, null)
  assert(manifest?.featureStoreProvenance, "partitioned index manifest must persist featureStoreProvenance")
  assert(summary?.featureStoreProvenance, "partitioned index summary must persist featureStoreProvenance")
  assert(partitionManifest?.featureStoreProvenance, "partition_manifest.json must persist featureStoreProvenance")
  assert.equal(String(manifest?.featureStoreDir ?? ""), path.resolve(featureStoreDir))
  assert.equal(String(manifest?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  assert.equal(String(summary?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  assert.equal(manifest?.featureStoreBuildManifestPath ?? null, null)
  assert.equal(summary?.featureStoreBuildManifestPath ?? null, null)
  assert.equal(partitionManifest?.featureStoreBuildManifestPath ?? null, null)
  const partitionedTokenizerSpec = await readJson(path.join(indexDir, "tokenizer_spec.json"), null)
  const partitionedTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(partitionedTokenizerSpec)
  assert.equal(String(manifest?.tokenizerSpecHash ?? ""), partitionedTokenizerSpecHash)
  assert.equal(String(summary?.tokenizerSpecHash ?? ""), partitionedTokenizerSpecHash)
  assert.equal(String(partitionManifest?.tokenizerSpecHash ?? ""), partitionedTokenizerSpecHash)
  assert.equal(
    Number(partitionManifest?.tokenizerSpecFingerprintVersion ?? 0),
    PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  )
  assert.equal(
    String(partitionManifest?.featureStoreProvenance?.dataContractHash ?? ""),
    String(manifest?.featureStoreProvenance?.dataContractHash ?? ""),
  )
  assert.equal(
    Number(partitionManifest?.featureStoreProvenance?.selectedPartitionCount ?? 0),
    Number(manifest?.featureStoreProvenance?.selectedPartitionCount ?? 0),
  )

  const miningOptions = {
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    minHitCount: 1,
    maxGapTradingDays: 100000,
    maxRuleSize: 6,
    maxSeedTokens: 4000,
    maxRules: 4000,
    maxSearchStates: 20000000,
    maxRejectedRuleSamples: 100,
  }

  await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: indexedValidDir,
    options: miningOptions,
  })
  await minePerfectPrototypeIndexed({
    cwd,
    indexDir: directIndexDir,
    outDir: path.join(rootDir, "direct_index_valid"),
    options: miningOptions,
  })

  const seedSelection = await streamSelectPerfectPrototypeSeedEntries({
    cwd,
    duckdb,
    tokenStatsPath: path.join(indexDir, "token_stats.parquet"),
    minHitCount: miningOptions.minHitCount,
    maxSeedTokens: miningOptions.maxSeedTokens,
    expectedTokenCount: Number(manifest?.tokenCount ?? 0),
  })
  const duplicatedSeedToken = String(seedSelection?.seedEntries?.[0]?.token ?? "").trim()
  assert(duplicatedSeedToken, "expected at least one seed token for contract-guard smoke")

  const duplicateRowMetaDir = path.join(rootDir, "case_row_meta_duplicate")
  await fsp.cp(indexDir, duplicateRowMetaDir, { recursive: true })
  await retargetCopiedIndexArtifacts(duplicateRowMetaDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(duplicateRowMetaDir, "row_meta.parquet"),
    selectSql: `
WITH base AS (
  SELECT *
  FROM read_parquet(${sqlQuote(path.join(duplicateRowMetaDir, "row_meta.parquet"))})
)
SELECT * FROM base
UNION ALL
SELECT * FROM base WHERE rowIdx = 0
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "duplicate row_meta rowIdx",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: duplicateRowMetaDir,
        outDir: path.join(rootDir, "out_row_meta_duplicate"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet must contain contiguous unique rowIdx values/,
  })

  const holeRowMetaDir = path.join(rootDir, "case_row_meta_hole")
  await fsp.cp(indexDir, holeRowMetaDir, { recursive: true })
  await retargetCopiedIndexArtifacts(holeRowMetaDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(holeRowMetaDir, "row_meta.parquet"),
    selectSql: `
SELECT *
FROM read_parquet(${sqlQuote(path.join(holeRowMetaDir, "row_meta.parquet"))})
WHERE rowIdx <> 1
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "missing row_meta rowIdx hole",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: holeRowMetaDir,
        outDir: path.join(rootDir, "out_row_meta_hole"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet must contain contiguous unique rowIdx values/,
  })

  const nullOutcomeDir = path.join(rootDir, "case_row_meta_null_outcome")
  await fsp.cp(indexDir, nullOutcomeDir, { recursive: true })
  await retargetCopiedIndexArtifacts(nullOutcomeDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(nullOutcomeDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  sourceType,
  sourceId,
  dateKey,
  symbol,
  CASE WHEN rowIdx = 0 THEN NULL ELSE outcomeHitTarget END AS outcomeHitTarget
  ,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(nullOutcomeDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "null row_meta outcomeHitTarget",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: nullOutcomeDir,
        outDir: path.join(rootDir, "out_row_meta_null_outcome"),
        options: miningOptions,
      }),
    pattern:
      /row_meta\.parquet requires boolean outcomeHitTarget|DuckDB delimited query stream expected BOOLEAN for column=outcomeHitTarget/,
  })

  const blankSourceIdDir = path.join(rootDir, "case_row_meta_blank_source_id")
  await fsp.cp(indexDir, blankSourceIdDir, { recursive: true })
  await retargetCopiedIndexArtifacts(blankSourceIdDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(blankSourceIdDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  sourceType,
  CASE WHEN rowIdx = 0 THEN '' ELSE sourceId END AS sourceId,
  dateKey,
  symbol,
  outcomeHitTarget,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(blankSourceIdDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "blank row_meta sourceId",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: blankSourceIdDir,
        outDir: path.join(rootDir, "out_row_meta_blank_source_id"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet requires non-empty sourceId/,
  })

  const blankDateKeyDir = path.join(rootDir, "case_row_meta_blank_date_key")
  await fsp.cp(indexDir, blankDateKeyDir, { recursive: true })
  await retargetCopiedIndexArtifacts(blankDateKeyDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(blankDateKeyDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  sourceType,
  sourceId,
  CASE WHEN rowIdx = 0 THEN '' ELSE dateKey END AS dateKey,
  symbol,
  outcomeHitTarget,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(blankDateKeyDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "blank row_meta dateKey",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: blankDateKeyDir,
        outDir: path.join(rootDir, "out_row_meta_blank_date_key"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet requires non-empty dateKey/,
  })

  const blankSymbolDir = path.join(rootDir, "case_row_meta_blank_symbol")
  await fsp.cp(indexDir, blankSymbolDir, { recursive: true })
  await retargetCopiedIndexArtifacts(blankSymbolDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(blankSymbolDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  sourceType,
  sourceId,
  dateKey,
  CASE WHEN rowIdx = 0 THEN '' ELSE symbol END AS symbol,
  outcomeHitTarget,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(blankSymbolDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "blank row_meta symbol",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: blankSymbolDir,
        outDir: path.join(rootDir, "out_row_meta_blank_symbol"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet requires non-empty symbol/,
  })

  const mismatchedSourceTypeDir = path.join(rootDir, "case_row_meta_mismatched_source_type")
  await fsp.cp(indexDir, mismatchedSourceTypeDir, { recursive: true })
  await retargetCopiedIndexArtifacts(mismatchedSourceTypeDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(mismatchedSourceTypeDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  CASE WHEN rowIdx = 0 THEN 'unexpected_source_type' ELSE sourceType END AS sourceType,
  sourceId,
  dateKey,
  symbol,
  outcomeHitTarget,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(mismatchedSourceTypeDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "mismatched row_meta sourceType",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: mismatchedSourceTypeDir,
        outDir: path.join(rootDir, "out_row_meta_mismatched_source_type"),
        options: miningOptions,
    }),
    pattern: /row_meta\.parquet dataset sourceType does not match manifest\/summary|row_meta\.parquet sourceType mismatch/,
  })

  const uniformWrongSourceTypeDir = path.join(rootDir, "case_row_meta_uniform_wrong_source_type")
  await fsp.cp(indexDir, uniformWrongSourceTypeDir, { recursive: true })
  await retargetCopiedIndexArtifacts(uniformWrongSourceTypeDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(uniformWrongSourceTypeDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  'unexpected_uniform_source_type' AS sourceType,
  sourceId,
  dateKey,
  symbol,
  outcomeHitTarget,
  strategyMode
FROM read_parquet(${sqlQuote(path.join(uniformWrongSourceTypeDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "uniformly wrong row_meta sourceType",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: uniformWrongSourceTypeDir,
        outDir: path.join(rootDir, "out_row_meta_uniform_wrong_source_type"),
        options: miningOptions,
      }),
    pattern:
      /row_meta\.parquet dataset sourceType does not match manifest\/summary|dataset sourceType must remain perfect_prototype_prejump_pack/i,
  })

  const mismatchedStrategyModeDir = path.join(rootDir, "case_row_meta_mismatched_strategy_mode")
  await fsp.cp(indexDir, mismatchedStrategyModeDir, { recursive: true })
  await retargetCopiedIndexArtifacts(mismatchedStrategyModeDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(mismatchedStrategyModeDir, "row_meta.parquet"),
    selectSql: `
SELECT
  rowIdx,
  sourceType,
  sourceId,
  dateKey,
  symbol,
  outcomeHitTarget,
  CASE WHEN rowIdx = 0 THEN 'unexpected_strategy_mode' ELSE strategyMode END AS strategyMode
FROM read_parquet(${sqlQuote(path.join(mismatchedStrategyModeDir, "row_meta.parquet"))})
ORDER BY rowIdx
`,
  })
  await expectFailure({
    label: "mismatched row_meta strategyMode",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: mismatchedStrategyModeDir,
        outDir: path.join(rootDir, "out_row_meta_mismatched_strategy_mode"),
        options: miningOptions,
      }),
    pattern: /row_meta\.parquet dataset strategyMode does not match manifest\/summary|row_meta\.parquet strategyMode mismatch/,
  })

  const duplicateTokenStatsDir = path.join(rootDir, "case_token_stats_duplicate")
  await fsp.cp(indexDir, duplicateTokenStatsDir, { recursive: true })
  await retargetCopiedIndexArtifacts(duplicateTokenStatsDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(duplicateTokenStatsDir, "token_stats.parquet"),
    selectSql: `
WITH base AS (
  SELECT *
  FROM read_parquet(${sqlQuote(path.join(duplicateTokenStatsDir, "token_stats.parquet"))})
)
SELECT * FROM base
UNION ALL
SELECT * FROM base WHERE token = ${sqlQuote(duplicatedSeedToken)}
ORDER BY token
`,
  })
  await expectFailure({
    label: "duplicate token_stats token",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: duplicateTokenStatsDir,
        outDir: path.join(rootDir, "out_token_stats_duplicate"),
        options: miningOptions,
      }),
    pattern: /token_stats\.parquet must contain strictly ascending unique tokens/,
  })

  const duplicateDictionaryDir = path.join(rootDir, "case_token_dictionary_duplicate")
  await fsp.cp(indexDir, duplicateDictionaryDir, { recursive: true })
  await retargetCopiedIndexArtifacts(duplicateDictionaryDir)
  await rewriteParquet({
    cwd,
    duckdb,
    parquetPath: path.join(duplicateDictionaryDir, "token_dictionary.parquet"),
    selectSql: `
WITH base AS (
  SELECT *
  FROM read_parquet(${sqlQuote(path.join(duplicateDictionaryDir, "token_dictionary.parquet"))})
)
SELECT * FROM base
UNION ALL
SELECT * FROM base WHERE token = ${sqlQuote(duplicatedSeedToken)}
ORDER BY token
`,
  })
  await expectFailure({
    label: "duplicate token_dictionary token",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: duplicateDictionaryDir,
        outDir: path.join(rootDir, "out_token_dictionary_duplicate"),
        options: miningOptions,
      }),
    pattern: /token_dictionary\.parquet must contain strictly ascending unique tokens/,
  })

  const featureStoreManifestPath = path.join(featureStoreDir, "manifest.json")
  const featureStoreManifest = await readJson(featureStoreManifestPath, null)
  featureStoreManifest.dataContractHash = `${String(featureStoreManifest.dataContractHash ?? "")}_mismatch`
  await writeJson(featureStoreManifestPath, featureStoreManifest)

  await expectFailure({
    label: "feature-store provenance mismatch indexed",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir,
        outDir: path.join(rootDir, "out_provenance_mismatch_indexed"),
        options: miningOptions,
      }),
    pattern: /Indexed predictive mining detected stale feature-store \/ index provenance\./,
  })

  await expectFailure({
    label: "feature-store provenance mismatch parallel",
    fn: () =>
      minePerfectPrototypeParallelIndexed({
        cwd,
        indexDir,
        outDir: path.join(rootDir, "out_provenance_mismatch_parallel"),
        options: {
          ...miningOptions,
          workers: 2,
          searchStateCacheMaxBytes: 32 * 1024,
        },
    }),
    pattern: /Indexed predictive mining detected stale feature-store \/ index provenance\./,
  })

  const directIndexManifest = await readJson(path.join(directIndexDir, "manifest.json"), null)
  const directIndexSummary = await readJson(path.join(directIndexDir, "summary.json"), null)
  assert.equal(String(directIndexManifest?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  assert.equal(String(directIndexSummary?.sourceType ?? ""), "perfect_prototype_prejump_pack")
  const recordedDirectProvenance = directIndexManifest?.inputProvenance ?? null
  assert(recordedDirectProvenance, "direct-built index manifest must persist inputProvenance")
  const currentDirectProvenance = await buildCurrentPerfectPrototypeDirectIndexProvenance({
    inputPaths: recordedDirectProvenance.inputPaths,
    packManifestPath: recordedDirectProvenance.packManifestPath,
    packSummaryPath: recordedDirectProvenance.packSummaryPath,
    outputCoverage: recordedDirectProvenance.outputCoverage,
  })
  assert.equal(
    String(recordedDirectProvenance?.inputStateHash ?? ""),
    String(currentDirectProvenance?.inputStateHash ?? ""),
  )
  const mismatchedDirectTokenizerHashDir = path.join(rootDir, "case_direct_index_tokenizer_hash_mismatch")
  await fsp.cp(directIndexDir, mismatchedDirectTokenizerHashDir, { recursive: true })
  await retargetCopiedIndexArtifacts(mismatchedDirectTokenizerHashDir)
  const mismatchedDirectManifestPath = path.join(mismatchedDirectTokenizerHashDir, "manifest.json")
  const mismatchedDirectSummaryPath = path.join(mismatchedDirectTokenizerHashDir, "summary.json")
  const mismatchedDirectManifest = await readJson(mismatchedDirectManifestPath, null)
  const mismatchedDirectSummary = await readJson(mismatchedDirectSummaryPath, null)
  await writeJson(mismatchedDirectManifestPath, {
    ...mismatchedDirectManifest,
    tokenizerSpecHash: "deadbeef",
  })
  await writeJson(mismatchedDirectSummaryPath, {
    ...mismatchedDirectSummary,
    tokenizerSpecHash: "deadbeef",
  })
  await expectFailure({
    label: "direct index tokenizerSpec hash mismatch",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: mismatchedDirectTokenizerHashDir,
        outDir: path.join(rootDir, "out_direct_tokenizer_hash_mismatch"),
        options: miningOptions,
      }),
    pattern: /tokenizer_spec\.json hash does not match recorded manifest fingerprint/i,
  })
  const directPackStat = await fsp.stat(directPackPath)
  const touchedMtime = new Date(Number(directPackStat.mtimeMs ?? Date.now()) + 5000)
  await fsp.utimes(directPackPath, touchedMtime, touchedMtime)
  await expectFailure({
    label: "direct index provenance mismatch indexed",
    fn: () =>
      minePerfectPrototypeIndexed({
        cwd,
        indexDir: directIndexDir,
        outDir: path.join(rootDir, "out_direct_provenance_mismatch_indexed"),
        options: miningOptions,
      }),
    pattern: /Indexed predictive mining detected stale direct-index input provenance\./,
  })

  const summaryOutPath = path.join(rootDir, "summary.json")
  const smokeSummary = {
    status: "ok",
    rootDir,
    duplicatedSeedToken,
    datasetSourceType: String(manifest?.sourceType ?? ""),
    selectedPartitionCount: Number(manifest?.featureStoreProvenance?.selectedPartitionCount ?? 0),
    tokenCount: Number(manifest?.tokenCount ?? 0),
    rowCount: Number(manifest?.rowCount ?? 0),
  }
  await writeJson(summaryOutPath, smokeSummary)
  console.log(JSON.stringify(smokeSummary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
