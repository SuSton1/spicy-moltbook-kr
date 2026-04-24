import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { pathExists, readJson, writeJson } from "../src/lib/io.mjs"
import {
  buildCurrentPerfectPrototypeIndexProvenance,
  normalizePerfectPrototypeTokenizerSpecCacheInputs,
  resolvePerfectPrototypeRecordedIndexProvenance,
} from "../src/lib/perfect_prototype_index_provenance.mjs"
import { mergePerfectPrototypeTokenIndexPartitions } from "../src/lib/perfect_prototype_token_index_merge.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { assertCanonicalPerfectPrototypeTokenizerCacheInputs } from "../src/lib/perfect_prototype_tokenizer_contract.mjs"

const stableJson = (value) => JSON.stringify(value ?? null)

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const toBoolean = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const resolveSourceIndexMetadata = async (indexDirs) => {
  const entries = []
  for (const indexDir of indexDirs) {
    const manifestPath = path.join(indexDir, "manifest.json")
    const manifest = await readJson(manifestPath, null)
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`Missing merged-source manifest.json: ${manifestPath}`)
    }
    const partitionManifestPathCandidate =
      String(manifest?.partitionManifestPath ?? "").trim() || path.join(indexDir, "partition_manifest.json")
    const partitionManifest = pathExists(partitionManifestPathCandidate)
      ? await readJson(partitionManifestPathCandidate, null)
      : null
    entries.push({
      indexDir,
      manifest,
      partitionManifestPath: pathExists(partitionManifestPathCandidate) ? partitionManifestPathCandidate : null,
      partitionManifest,
    })
  }
  return entries
}

const resolveSharedPartitionedProvenance = (entries) => {
  let shared = null
  for (const entry of Array.isArray(entries) ? entries : []) {
    const recorded = resolvePerfectPrototypeRecordedIndexProvenance({
      indexManifest: entry.manifest,
      partitionManifest: entry.partitionManifest,
    })
    if (!recorded) return null
    if (!shared) {
      shared = recorded
      continue
    }
    if (stableJson(shared) !== stableJson(recorded)) {
      throw new Error(
        [
          "Direct partitioned-index merge requires source indexes to share identical recorded feature-store provenance.",
          `indexDir=${entry.indexDir}`,
          `recorded=${stableJson(recorded)}`,
          `shared=${stableJson(shared)}`,
        ].join("\n"),
      )
    }
  }
  return shared
}

const inferSourceCoverageRange = (entries) => {
  const fromValues = []
  const toValues = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const coverage = entry?.manifest?.outputCoverage
    const from = String(coverage?.from ?? "").trim()
    const to = String(coverage?.to ?? "").trim()
    if (!from || !to) return { startDate: null, endDate: null }
    fromValues.push(from)
    toValues.push(to)
  }
  return {
    startDate: fromValues.length > 0 ? fromValues.sort()[0] : null,
    endDate: toValues.length > 0 ? toValues.sort().slice(-1)[0] : null,
  }
}

const inferTokenizerSpecCacheInputs = async (entry) => {
  const tokenizerSpecPath =
    String(entry?.manifest?.tokenizerSpecPath ?? "").trim() || path.join(entry.indexDir, "tokenizer_spec.json")
  const tokenizerSpec = await readJson(tokenizerSpecPath, null)
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error(
      `Direct partitioned-index merge could not infer tokenizer inputs from tokenizer_spec.json: ${tokenizerSpecPath}`,
    )
  }
  return normalizePerfectPrototypeTokenizerSpecCacheInputs({
    surfaceName: entry?.manifest?.surfaceName ?? tokenizerSpec?.surface ?? null,
    binCount: tokenizerSpec?.options?.binCount ?? null,
    includeSymbolToken: tokenizerSpec?.options?.includeSymbolToken ?? null,
    includeMissingTokens: tokenizerSpec?.options?.includeMissingTokens ?? null,
    includeCategoricalTokens: tokenizerSpec?.options?.includeCategoricalTokens ?? null,
  })
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "merge_perfect_prototype_token_index_partitions",
  })
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const rawFeatureStoreDir = String(getFlag(parsed.flags, "feature-store-dir", "")).trim()
  const featureStoreDir = rawFeatureStoreDir ? path.resolve(rawFeatureStoreDir) : null
  const startDateFlag = String(getFlag(parsed.flags, "start", "")).trim() || null
  const endDateFlag = String(getFlag(parsed.flags, "end", "")).trim() || null
  const shardGranularity =
    String(getFlag(parsed.flags, "shard-granularity", "")).trim().toLowerCase() || null
  const indexDirs = (Array.isArray(parsed?._) ? parsed._ : [])
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (!outDir || indexDirs.length < 1) {
    throw new Error(
      "Usage: node tools/merge_perfect_prototype_token_index_partitions.mjs --out-dir=<dir> [--feature-store-dir=<dir> --start=YYYY-MM-DD --end=YYYY-MM-DD --shard-granularity=month|quarter] [--emit-token-postings-parquet=true|false] [--merge-mode=global_stream] [--merged-dictionary-stream-mode=delimited] [--distinct-token-scan-required=true|false] [--native-postings-merge-required=true|false] [--schema-preflight-required=true|false] [--read-concurrency=<n> debug-path-only] <index-dir-1> <index-dir-2> ...",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      ...(rawFeatureStoreDir
        ? [{ label: "featureStoreDir", filePath: featureStoreDir }]
        : []),
      ...indexDirs.map((filePath, index) => ({
        label: `indexDir[${index}]`,
        filePath,
      })),
    ],
    policy: serverPolicy,
    toolName: "merge_perfect_prototype_token_index_partitions",
  })
  const sourceEntries = await resolveSourceIndexMetadata(indexDirs)
  const sharedPartitionedProvenance = resolveSharedPartitionedProvenance(sourceEntries)
  let partitionedProvenance = sharedPartitionedProvenance
  if (!partitionedProvenance) {
    if (!rawFeatureStoreDir) {
      throw new Error(
        [
          "Direct partitioned-index merge requires canonical feature-store provenance.",
          "No shared source-index provenance was found, so --feature-store-dir, --start, --end, and --shard-granularity are required.",
        ].join("\n"),
      )
    }
    if (!startDateFlag || !endDateFlag || !shardGranularity) {
      const inferredCoverage = inferSourceCoverageRange(sourceEntries)
      throw new Error(
        [
          "Direct partitioned-index merge requires explicit provenance flags when source indexes do not already carry canonical feature-store provenance.",
      `featureStoreDir=${featureStoreDir}`,
          `suggestedStart=${inferredCoverage.startDate ?? "unknown"}`,
          `suggestedEnd=${inferredCoverage.endDate ?? "unknown"}`,
          "requiredFlags=--feature-store-dir --start --end --shard-granularity",
        ].join("\n"),
      )
    }
    const tokenizerSpecCacheInputs = assertCanonicalPerfectPrototypeTokenizerCacheInputs({
      tokenizerSpecCacheInputs: await inferTokenizerSpecCacheInputs(sourceEntries[0]),
      failureLabel: "merge_perfect_prototype_token_index_partitions inferred tokenizer options",
    })
    partitionedProvenance = await buildCurrentPerfectPrototypeIndexProvenance({
      featureStoreDir,
      startDate: startDateFlag,
      endDate: endDateFlag,
      shardGranularity,
      tokenizerSpecCacheInputs,
    })
  }
  const result = await mergePerfectPrototypeTokenIndexPartitions({
    cwd,
    indexDirs,
    outDir,
    options: {
      emitTokenPostingsParquet:
        String(getFlag(parsed.flags, "emit-token-postings-parquet", "false")).trim().toLowerCase() === "true",
      indexMergeMode:
        String(getFlag(parsed.flags, "merge-mode", "global_stream")).trim().toLowerCase() || "global_stream",
      mergedDictionaryStreamMode:
        String(getFlag(parsed.flags, "merged-dictionary-stream-mode", "delimited")).trim().toLowerCase() || "delimited",
      distinctTokenScanRequired:
        String(getFlag(parsed.flags, "distinct-token-scan-required", "true")).trim().toLowerCase() === "true",
      nativePostingsMergeRequired:
        String(getFlag(parsed.flags, "native-postings-merge-required", "true")).trim().toLowerCase() === "true",
      schemaPreflightRequired:
        String(getFlag(parsed.flags, "schema-preflight-required", "true")).trim().toLowerCase() === "true",
      indexMergeReadConcurrency: Number(getFlag(parsed.flags, "read-concurrency", "8")),
      partitionedProvenance,
      partitionManifest: {
        startDate: partitionedProvenance.startDate,
        endDate: partitionedProvenance.endDate,
        shardGranularity: partitionedProvenance.shardGranularity,
      },
    },
  })
  await writeJson(path.join(outDir, "tool_manifest.json"), {
    version: 1,
    generatedAt: new Date().toISOString(),
    indexDirs,
    partitionedProvenance,
    result,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
