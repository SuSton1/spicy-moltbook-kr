import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { writeJson } from "../src/lib/io.mjs"
import { resolvePerfectPrototypePrejumpFeatureStoreDir } from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import { buildPerfectPrototypePartitionedTokenIndexFromFeatureStore } from "../src/lib/perfect_prototype_token_index_merge.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
  assertCanonicalPerfectPrototypeTokenizerCacheInputs,
} from "../src/lib/perfect_prototype_tokenizer_contract.mjs"

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const toStrictTokenizerBoolean = (value, fallback, label) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  throw new Error(`Invalid ${label}: ${value}`)
}

const toStrictTokenizerInteger = (value, fallback, label) => {
  if (value === undefined || value === null || value === "") return fallback
  const n = Math.floor(Number(value))
  if (Number.isInteger(n) && n > 0) return n
  throw new Error(`Invalid ${label}: ${value}`)
}

const toStrictTokenizerText = (value, fallback, label) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (text) return text
  throw new Error(`Invalid ${label}: ${value}`)
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_perfect_prototype_partitioned_token_index",
  })
  const startDate = String(getFlag(parsed.flags, "start", "")).trim() || null
  const endDate = String(getFlag(parsed.flags, "end", "")).trim() || null
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const workspaceDir = path.resolve(String(getFlag(parsed.flags, "workspace-dir", "")).trim())
  if (!startDate || !endDate || !outDir || !workspaceDir) {
    throw new Error(
      "Usage: node tools/build_perfect_prototype_partitioned_token_index.mjs --start=YYYY-MM-DD --end=YYYY-MM-DD --feature-store-dir=<dir> --workspace-dir=<dir> --out-dir=<dir> [--surface-name=v5_prejump_contextual] [--bin-count=5] [--include-symbol-token=false] [--include-missing-tokens=false] [--include-categorical-tokens=true] [--emit-token-postings-parquet=true|false] [--merge-mode=global_stream] [--merged-dictionary-stream-mode=delimited] [--distinct-token-scan-required=true|false] [--native-postings-merge-required=true|false] [--schema-preflight-required=true|false] [--read-concurrency=<n> debug-path-only]",
    )
  }
  const featureStoreDir = resolvePerfectPrototypePrejumpFeatureStoreDir({
    cwd,
    featureStoreDir: String(getFlag(parsed.flags, "feature-store-dir", "")).trim() || null,
  })
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "featureStoreDir", filePath: featureStoreDir },
      { label: "workspaceDir", filePath: workspaceDir },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_partitioned_token_index",
  })
  const canonicalTokenizerOptions = assertCanonicalPerfectPrototypeTokenizerCacheInputs({
    tokenizerSpecCacheInputs: {
      surfaceName: toStrictTokenizerText(
        getFlag(
          parsed.flags,
          "surface-name",
          PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.surfaceName,
        ),
        PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.surfaceName,
        "--surface-name",
      ),
      binCount: toStrictTokenizerInteger(
        getFlag(parsed.flags, "bin-count", PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.binCount),
        PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.binCount,
        "--bin-count",
      ),
      includeSymbolToken: toStrictTokenizerBoolean(
        getFlag(
          parsed.flags,
          "include-symbol-token",
          PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeSymbolToken,
        ),
        PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeSymbolToken,
        "--include-symbol-token",
      ),
      includeMissingTokens: toStrictTokenizerBoolean(
        getFlag(
          parsed.flags,
          "include-missing-tokens",
          PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeMissingTokens,
        ),
        PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeMissingTokens,
        "--include-missing-tokens",
      ),
      includeCategoricalTokens: toStrictTokenizerBoolean(
        getFlag(
          parsed.flags,
          "include-categorical-tokens",
          PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeCategoricalTokens,
        ),
        PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeCategoricalTokens,
        "--include-categorical-tokens",
      ),
    },
    failureLabel: "build_perfect_prototype_partitioned_token_index CLI tokenizer options",
  })

  const result = await buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
    cwd,
    featureStoreDir,
    startDate,
    endDate,
    workspaceDir,
    outDir,
    options: {
      shardGranularity: String(getFlag(parsed.flags, "shard-granularity", "month")).trim().toLowerCase() || "month",
      ...canonicalTokenizerOptions,
      emitTokenPostingsParquet: toBoolean(
        getFlag(parsed.flags, "emit-token-postings-parquet", false),
        false,
      ),
      indexMergeMode:
        String(getFlag(parsed.flags, "merge-mode", "global_stream")).trim().toLowerCase() || "global_stream",
      mergedDictionaryStreamMode:
        String(getFlag(parsed.flags, "merged-dictionary-stream-mode", "delimited")).trim().toLowerCase() || "delimited",
      distinctTokenScanRequired: toBoolean(
        getFlag(parsed.flags, "distinct-token-scan-required", true),
        true,
      ),
      nativePostingsMergeRequired: toBoolean(
        getFlag(parsed.flags, "native-postings-merge-required", true),
        true,
      ),
      schemaPreflightRequired: toBoolean(
        getFlag(parsed.flags, "schema-preflight-required", true),
        true,
      ),
      indexMergeReadConcurrency: toInteger(getFlag(parsed.flags, "read-concurrency", 8), 8),
    },
  })

  await writeJson(path.join(outDir, "tool_manifest.json"), {
    version: 1,
    generatedAt: new Date().toISOString(),
    featureStoreDir,
    workspaceDir,
    startDate,
    endDate,
    tokenizerSpecCacheInputs: canonicalTokenizerOptions,
    shardGranularity: String(getFlag(parsed.flags, "shard-granularity", "month")).trim().toLowerCase() || "month",
    mergeMode:
      String(getFlag(parsed.flags, "merge-mode", "global_stream")).trim().toLowerCase() || "global_stream",
    mergedDictionaryStreamMode:
      String(getFlag(parsed.flags, "merged-dictionary-stream-mode", "delimited")).trim().toLowerCase() || "delimited",
    distinctTokenScanRequired: toBoolean(
      getFlag(parsed.flags, "distinct-token-scan-required", true),
      true,
    ),
    nativePostingsMergeRequired: toBoolean(
      getFlag(parsed.flags, "native-postings-merge-required", true),
      true,
    ),
    schemaPreflightRequired: toBoolean(
      getFlag(parsed.flags, "schema-preflight-required", true),
      true,
    ),
    indexMergeReadConcurrency: toInteger(getFlag(parsed.flags, "read-concurrency", 8), 8),
    result,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
