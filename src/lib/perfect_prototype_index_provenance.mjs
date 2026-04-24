import path from "node:path"
import fsp from "node:fs/promises"
import crypto from "node:crypto"

import { pathExists, readJson, readJsonIfExistsStrict, writeJsonAtomic } from "./io.mjs"
import {
  resolvePerfectPrototypePrejumpFeatureStorePartitionPath,
} from "./perfect_prototype_prejump_feature_store.mjs"
import { resolvePerfectPrototypeFeatureStatsPartitionPath } from "./perfect_prototype_feature_stats_sidecar.mjs"
import {
  resolvePerfectPrototypeFeatureValuesPartitionBinPath,
  resolvePerfectPrototypeFeatureValuesPartitionIndexPath,
} from "./perfect_prototype_feature_values_sidecar.mjs"
import { normalizePerfectPrototypeTokenizerCacheInputs } from "./perfect_prototype_tokenizer_contract.mjs"

const PERFECT_PROTOTYPE_INDEX_OUTPUT_CONFLICT_FILES = Object.freeze([
  "manifest.json",
  "summary.json",
  "partition_manifest.json",
  "row_meta.parquet",
  "token_postings.parquet",
  "token_postings.bin",
  "token_dictionary.parquet",
  "token_dictionary.json",
  "token_stats.parquet",
  "tokenizer_spec.json",
  "progress.json",
  "tool_manifest.json",
])

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

const stableJson = (value) => JSON.stringify(value ?? null)

const resolveNonEmptyPaths = (values) =>
  uniqueSorted(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry)),
  )

const formatPathSample = (values, limit = 5) =>
  uniqueSorted(values)
    .slice(0, limit)
    .join(", ")

const buildFeatureStoreContractHash = ({
  strategyModes,
  contextSurfaces,
  numericFeatureKeys,
}) =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        strategyModes: uniqueSorted(strategyModes),
        contextSurfaces: uniqueSorted(contextSurfaces),
        numericFeatureKeys: uniqueSorted(numericFeatureKeys),
      }),
    )
    .digest("hex")

export const normalizePerfectPrototypeFeatureStoreManifestContract = (manifest) => {
  const strategyModes = uniqueSorted([
    ...(Array.isArray(manifest?.strategyModes) ? manifest.strategyModes : []),
    ...(manifest?.strategyMode ? [manifest.strategyMode] : []),
  ])
  const contextSurfaces = uniqueSorted([
    ...(Array.isArray(manifest?.contextSurfaces) ? manifest.contextSurfaces : []),
    ...(manifest?.surface ? [manifest.surface] : []),
  ])
  const numericFeatureKeys = uniqueSorted(Array.isArray(manifest?.numericFeatureKeys) ? manifest.numericFeatureKeys : [])
  const computedContractHash = buildFeatureStoreContractHash({
    strategyModes,
    contextSurfaces,
    numericFeatureKeys,
  })
  return {
    strategyModes,
    contextSurfaces,
    numericFeatureKeys,
    dataContractHash: String(manifest?.dataContractHash ?? "").trim() || computedContractHash,
  }
}

export const normalizePerfectPrototypeTokenizerSpecCacheInputs =
  normalizePerfectPrototypeTokenizerCacheInputs

export const buildPerfectPrototypeTokenizerSpecCacheKey = ({
  manifest,
  startDate,
  endDate,
  partitionStateHash,
  options = {},
  tokenizerSpecCacheInputs = null,
}) => {
  const contract = normalizePerfectPrototypeFeatureStoreManifestContract(manifest)
  const cacheInputs =
    tokenizerSpecCacheInputs && typeof tokenizerSpecCacheInputs === "object"
      ? normalizePerfectPrototypeTokenizerSpecCacheInputs(tokenizerSpecCacheInputs)
      : normalizePerfectPrototypeTokenizerSpecCacheInputs(options)
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        contractHash: contract.dataContractHash,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        partitionStateHash: String(partitionStateHash ?? "").trim() || null,
        surfaceName: cacheInputs.surfaceName,
        binCount: cacheInputs.binCount,
        includeSymbolToken: cacheInputs.includeSymbolToken,
        includeMissingTokens: cacheInputs.includeMissingTokens,
        includeCategoricalTokens: cacheInputs.includeCategoricalTokens,
      }),
    )
    .digest("hex")
}

export const buildPerfectPrototypePartitionStateHash = async (filePaths) => {
  const fingerprintRows = []
  for (const rawFilePath of Array.isArray(filePaths) ? filePaths : []) {
    const resolvedPath = path.resolve(String(rawFilePath ?? "").trim())
    if (!resolvedPath) continue
    const stat = await fsp.stat(resolvedPath)
    fingerprintRows.push({
      filePath: resolvedPath,
      size: Number(stat.size ?? 0),
      mtimeMs: Number(stat.mtimeMs ?? 0),
    })
  }
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(fingerprintRows))
    .digest("hex")
}

export const buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest = ({
  featureStoreDir,
  manifest,
  startDate = null,
  endDate = null,
}) => {
  const resolvedFeatureStoreDir = path.resolve(String(featureStoreDir ?? "").trim())
  return (Array.isArray(manifest?.partitions) ? manifest.partitions : [])
    .map((entry) => {
      const dateKey = String(entry?.dateKey ?? "").trim()
      if (!dateKey) return null
      return {
        dateKey,
        partitionDir: path.join(resolvedFeatureStoreDir, `date=${dateKey}`),
        parquetPath:
          String(entry?.parquetPath ?? "").trim() ||
          resolvePerfectPrototypePrejumpFeatureStorePartitionPath({
            featureStoreDir: resolvedFeatureStoreDir,
            dateKey,
          }),
        featureStatsParquetPath:
          String(entry?.featureStatsParquetPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureStatsPartitionPath({
            featureStoreDir: resolvedFeatureStoreDir,
            dateKey,
          }),
        featureValuesBinPath:
          String(entry?.featureValuesBinPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureValuesPartitionBinPath({
            featureStoreDir: resolvedFeatureStoreDir,
            dateKey,
          }),
        featureValuesIndexParquetPath:
          String(entry?.featureValuesIndexParquetPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureValuesPartitionIndexPath({
            featureStoreDir: resolvedFeatureStoreDir,
            dateKey,
          }),
      }
    })
    .filter(Boolean)
    .filter((entry) => (!startDate || entry.dateKey >= startDate) && (!endDate || entry.dateKey <= endDate))
    .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)))
}

export const assertPerfectPrototypeCleanOutputDir = async ({
  dirPath,
  label = "output directory",
  allowedEntries = [],
}) => {
  const resolvedDirPath = path.resolve(String(dirPath ?? "").trim() || process.cwd())
  if (!pathExists(resolvedDirPath)) return resolvedDirPath
  const stat = await fsp.stat(resolvedDirPath)
  if (!stat.isDirectory()) {
    throw new Error(
      [
        `Perfect prototype ${label} must be a directory.`,
        `${label}=${resolvedDirPath}`,
      ].join("\n"),
    )
  }
  const entries = await fsp.readdir(resolvedDirPath)
  const allowedEntrySet = new Set(
    (Array.isArray(allowedEntries) ? allowedEntries : [])
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean),
  )
  const blockingEntries = entries.filter((entry) => !allowedEntrySet.has(String(entry ?? "").trim()))
  if (blockingEntries.length < 1) return resolvedDirPath
  const staleCanonicalEntries = blockingEntries.filter((entry) =>
    PERFECT_PROTOTYPE_INDEX_OUTPUT_CONFLICT_FILES.includes(String(entry ?? "").trim()),
  )
  throw new Error(
    [
      `Perfect prototype ${label} must be empty before the build/merge starts.`,
      `${label}=${resolvedDirPath}`,
      `entries=${blockingEntries.slice(0, 10).join(", ")}`,
      staleCanonicalEntries.includes("partition_manifest.json")
        ? "stale partition_manifest.json detected in a non-clean output directory"
        : null,
      staleCanonicalEntries.length > 0
        ? `staleCanonicalArtifacts=${staleCanonicalEntries.join(", ")}`
        : null,
      "Remove the directory contents or choose a new output path before rerunning.",
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

export const buildPerfectPrototypeFeatureStoreProvenanceRecord = ({
  featureStoreDir,
  featureStoreManifestPath = null,
  featureStoreBuildManifestPath = null,
  featureStoreManifest,
  startDate,
  endDate,
  shardGranularity = "month",
  partitionStateHash,
  tokenizerSpecCacheKey,
  tokenizerSpecCacheInputs,
  selectedPartitions = null,
}) => {
  const resolvedFeatureStoreDir = path.resolve(String(featureStoreDir ?? "").trim())
  const contract = normalizePerfectPrototypeFeatureStoreManifestContract(featureStoreManifest)
  const normalizedSelectedPartitions =
    Array.isArray(selectedPartitions) && selectedPartitions.length > 0
      ? [...selectedPartitions]
      : buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest({
          featureStoreDir: resolvedFeatureStoreDir,
          manifest: featureStoreManifest,
          startDate,
          endDate,
        })
  const selectedCoverage = buildCoverage(normalizedSelectedPartitions.map((entry) => entry.dateKey))
  const requestedDecisionRange = {
    from:
      String(
        featureStoreManifest?.requestedDecisionRange?.from ??
          featureStoreManifest?.requestedPeriod?.from ??
          startDate ??
          "",
      ).trim() || null,
    to:
      String(
        featureStoreManifest?.requestedDecisionRange?.to ??
          featureStoreManifest?.requestedPeriod?.to ??
          endDate ??
          "",
      ).trim() || null,
  }
  return {
    featureStoreDir: resolvedFeatureStoreDir,
    featureStoreManifestPath:
      String(featureStoreManifestPath ?? "").trim() || path.join(resolvedFeatureStoreDir, "manifest.json"),
    featureStoreBuildManifestPath: String(featureStoreBuildManifestPath ?? "").trim() || null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    shardGranularity: String(shardGranularity ?? "month").trim().toLowerCase() || "month",
    dataContractHash: contract.dataContractHash,
    contract: {
      strategyModes: contract.strategyModes,
      contextSurfaces: contract.contextSurfaces,
      numericFeatureKeys: contract.numericFeatureKeys,
    },
    requestedDecisionRange,
    selectedCoverage,
    effectiveDecisionCoverage: selectedCoverage,
    selectedPartitionCount: normalizedSelectedPartitions.length,
    partitionStateHash: String(partitionStateHash ?? "").trim() || null,
    tokenizerSpecCacheKey: String(tokenizerSpecCacheKey ?? "").trim() || null,
    tokenizerSpecCacheInputs: normalizePerfectPrototypeTokenizerSpecCacheInputs(tokenizerSpecCacheInputs),
  }
}

export const buildPerfectPrototypeDirectIndexProvenanceRecord = ({
  inputPath = null,
  inputPaths = [],
  inputStateHash,
  packManifestPath = null,
  packSummaryPath = null,
  requestedDecisionRange = null,
  effectiveDecisionCoverage = null,
  outputCoverage = null,
}) => {
  const resolvedInputPaths = resolveNonEmptyPaths(
    Array.isArray(inputPaths) && inputPaths.length > 0 ? inputPaths : [inputPath],
  )
  if (resolvedInputPaths.length < 1) {
    throw new Error("Perfect prototype direct index provenance requires at least one input path")
  }
  return {
    inputPath: resolvedInputPaths[0] ?? null,
    inputPaths: resolvedInputPaths,
    inputStateHash: String(inputStateHash ?? "").trim() || null,
    packManifestPath: String(packManifestPath ?? "").trim() || null,
    packSummaryPath: String(packSummaryPath ?? "").trim() || null,
    requestedDecisionRange: requestedDecisionRange ?? null,
    effectiveDecisionCoverage: effectiveDecisionCoverage ?? outputCoverage ?? null,
    outputCoverage: outputCoverage ?? null,
  }
}

export const repairPerfectPrototypeDirectIndexInputProvenanceArtifacts = async ({
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
        "Direct index provenance repair requires manifest.json and summary.json.",
        `indexDir=${resolvedIndexDir}`,
        `manifestPath=${manifestPath}`,
        `summaryPath=${summaryPath}`,
      ].join("\n"),
    )
  }
  const inputPaths = resolveNonEmptyPaths(manifest?.inputPaths ?? manifest?.inputPath ?? [])
  if (inputPaths.length < 1) {
    throw new Error(
      [
        "Direct index provenance repair requires manifest inputPath/inputPaths.",
        `indexDir=${resolvedIndexDir}`,
      ].join("\n"),
    )
  }
  const inputProvenance = buildPerfectPrototypeDirectIndexProvenanceRecord({
    inputPath: manifest?.inputPath ?? inputPaths[0],
    inputPaths,
    inputStateHash: await buildPerfectPrototypePartitionStateHash(inputPaths),
    packManifestPath: manifest?.packManifestPath ?? null,
    packSummaryPath: manifest?.packSummaryPath ?? null,
    outputCoverage: manifest?.outputCoverage ?? null,
  })
  const nextManifest = {
    ...manifest,
    inputProvenance,
  }
  const nextSummary = {
    ...summary,
    inputProvenance,
  }
  const changedFiles = []
  const maybeWrite = async (filePath, currentValue, nextValue) => {
    if (stableJson(currentValue) === stableJson(nextValue)) return
    changedFiles.push(filePath)
    if (write) {
      await writeJsonAtomic(filePath, nextValue)
    }
  }
  await maybeWrite(manifestPath, manifest, nextManifest)
  await maybeWrite(summaryPath, summary, nextSummary)
  return {
    indexDir: resolvedIndexDir,
    inputProvenance,
    changedFiles,
    repaired: changedFiles.length > 0,
  }
}

export const resolvePerfectPrototypeRecordedIndexProvenance = ({
  indexManifest,
  partitionManifest = null,
}) => {
  const provenance =
    partitionManifest?.featureStoreProvenance ??
    indexManifest?.featureStoreProvenance ??
    null
  if (!provenance || typeof provenance !== "object") return null
  return {
    featureStoreDir:
      String(
        provenance?.featureStoreDir ??
          partitionManifest?.featureStoreDir ??
          indexManifest?.featureStoreDir ??
          "",
      ).trim() || null,
    featureStoreManifestPath:
      String(
        provenance?.featureStoreManifestPath ??
          partitionManifest?.featureStoreManifestPath ??
          indexManifest?.featureStoreManifestPath ??
          "",
      ).trim() || null,
    featureStoreBuildManifestPath:
      String(
        provenance?.featureStoreBuildManifestPath ??
          partitionManifest?.featureStoreBuildManifestPath ??
          indexManifest?.featureStoreBuildManifestPath ??
          "",
      ).trim() || null,
    startDate: provenance?.startDate ?? partitionManifest?.startDate ?? null,
    endDate: provenance?.endDate ?? partitionManifest?.endDate ?? null,
    shardGranularity:
      String(
        provenance?.shardGranularity ??
          partitionManifest?.shardGranularity ??
          indexManifest?.shardGranularity ??
          "month",
      ).trim().toLowerCase() || "month",
    dataContractHash: String(provenance?.dataContractHash ?? "").trim() || null,
    contract: provenance?.contract ?? null,
    selectedCoverage: provenance?.selectedCoverage ?? null,
    selectedPartitionCount: Number(provenance?.selectedPartitionCount ?? 0),
    partitionStateHash: String(provenance?.partitionStateHash ?? "").trim() || null,
    tokenizerSpecCacheKey: String(provenance?.tokenizerSpecCacheKey ?? "").trim() || null,
    tokenizerSpecCacheInputs: normalizePerfectPrototypeTokenizerSpecCacheInputs(
      provenance?.tokenizerSpecCacheInputs,
    ),
  }
}

export const resolvePerfectPrototypeRecordedDirectIndexProvenance = ({
  indexManifest,
}) => {
  const provenance = indexManifest?.inputProvenance
  if (!provenance || typeof provenance !== "object") return null
  const resolvedInputPaths = resolveNonEmptyPaths(Array.isArray(provenance?.inputPaths) ? provenance.inputPaths : [])
  const resolvedInputPathCandidate = String(
    provenance?.inputPath ?? resolvedInputPaths[0] ?? indexManifest?.inputPath ?? "",
  ).trim()
  return {
    inputPath: resolvedInputPathCandidate ? path.resolve(resolvedInputPathCandidate) : null,
    inputPaths: resolvedInputPaths,
    inputStateHash: String(provenance?.inputStateHash ?? "").trim() || null,
    packManifestPath:
      String(provenance?.packManifestPath ?? indexManifest?.packManifestPath ?? "").trim() || null,
    packSummaryPath:
      String(provenance?.packSummaryPath ?? indexManifest?.packSummaryPath ?? "").trim() || null,
    outputCoverage: provenance?.outputCoverage ?? indexManifest?.outputCoverage ?? null,
  }
}

export const buildCurrentPerfectPrototypeIndexProvenance = async ({
  featureStoreDir,
  startDate,
  endDate,
  shardGranularity = "month",
  tokenizerSpecCacheInputs = null,
}) => {
  const resolvedFeatureStoreDir = path.resolve(String(featureStoreDir ?? "").trim())
  const featureStoreManifestPath = path.join(resolvedFeatureStoreDir, "manifest.json")
  const featureStoreBuildManifestPath = path.join(resolvedFeatureStoreDir, "build_manifest.json")
  const featureStoreManifest = await readJson(featureStoreManifestPath, null)
  if (!featureStoreManifest || typeof featureStoreManifest !== "object") {
    throw new Error(
      [
        "Indexed predictive mining requires a valid feature-store manifest for provenance validation.",
        `featureStoreDir=${resolvedFeatureStoreDir}`,
        `featureStoreManifestPath=${featureStoreManifestPath}`,
      ].join("\n"),
    )
  }
  const selectedPartitions = buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest({
    featureStoreDir: resolvedFeatureStoreDir,
    manifest: featureStoreManifest,
    startDate,
    endDate,
  })
  if (selectedPartitions.length < 1) {
    throw new Error(
      [
        "Indexed predictive mining requires feature-store partitions for the recorded provenance range.",
        `featureStoreDir=${resolvedFeatureStoreDir}`,
        `startDate=${startDate ?? "null"}`,
        `endDate=${endDate ?? "null"}`,
      ].join("\n"),
    )
  }
  const partitionStateHash = await buildPerfectPrototypePartitionStateHash([
    ...selectedPartitions.map((entry) => entry.parquetPath),
    ...selectedPartitions.flatMap((entry) => [
      entry.featureValuesBinPath,
      entry.featureValuesIndexParquetPath,
    ]),
  ])
  const tokenizerSpecCacheKey = buildPerfectPrototypeTokenizerSpecCacheKey({
    manifest: featureStoreManifest,
    startDate,
    endDate,
    partitionStateHash,
    tokenizerSpecCacheInputs,
  })
  return buildPerfectPrototypeFeatureStoreProvenanceRecord({
    featureStoreDir: resolvedFeatureStoreDir,
    featureStoreManifestPath,
    featureStoreBuildManifestPath: pathExists(featureStoreBuildManifestPath)
      ? featureStoreBuildManifestPath
      : null,
    featureStoreManifest,
    startDate,
    endDate,
    shardGranularity,
    partitionStateHash,
    tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
    selectedPartitions,
  })
}

export const assertPerfectPrototypeMergeSourceSetCompatible = async ({
  outDir,
  indexDirs,
  sourceManifests,
  partitionedProvenance,
}) => {
  const resolvedIndexDirs = (Array.isArray(indexDirs) ? indexDirs : [])
    .map((entry) => path.resolve(String(entry ?? "").trim()))
    .filter(Boolean)
  if (resolvedIndexDirs.length < 1) {
    throw new Error("Perfect prototype direct partitioned-index merge requires at least one source index directory")
  }
  if (
    !partitionedProvenance?.featureStoreDir ||
    !partitionedProvenance?.featureStoreManifestPath ||
    !partitionedProvenance?.startDate ||
    !partitionedProvenance?.endDate
  ) {
    throw new Error(
      [
        "Perfect prototype direct partitioned-index merge requires canonical feature-store provenance.",
        `outDir=${path.resolve(String(outDir ?? "").trim() || process.cwd())}`,
      ].join("\n"),
    )
  }
  const featureStoreManifestPath =
    String(partitionedProvenance.featureStoreManifestPath ?? "").trim() ||
    path.join(path.resolve(partitionedProvenance.featureStoreDir), "manifest.json")
  const featureStoreManifest = await readJson(featureStoreManifestPath, null)
  if (!featureStoreManifest || typeof featureStoreManifest !== "object") {
    throw new Error(
      [
        "Perfect prototype direct partitioned-index merge requires a valid feature-store manifest for source-set validation.",
        `featureStoreManifestPath=${featureStoreManifestPath}`,
      ].join("\n"),
    )
  }
  const expectedSelectedPartitions = buildPerfectPrototypeFeatureStoreSelectedPartitionsFromManifest({
    featureStoreDir: partitionedProvenance.featureStoreDir,
    manifest: featureStoreManifest,
    startDate: partitionedProvenance.startDate,
    endDate: partitionedProvenance.endDate,
  })
  const expectedInputPaths = resolveNonEmptyPaths(
    expectedSelectedPartitions.map((entry) => entry.parquetPath),
  )
  if (expectedInputPaths.length < 1) {
    throw new Error(
      [
        "Perfect prototype direct partitioned-index merge could not resolve expected feature-store partitions for the recorded provenance range.",
        `featureStoreDir=${path.resolve(String(partitionedProvenance.featureStoreDir ?? "").trim() || process.cwd())}`,
        `startDate=${partitionedProvenance.startDate ?? "null"}`,
        `endDate=${partitionedProvenance.endDate ?? "null"}`,
      ].join("\n"),
    )
  }
  const seenIndexDirs = new Set()
  const seenInputPaths = new Set()
  const sourceInputPaths = []
  const safeSourceManifests = Array.isArray(sourceManifests) ? sourceManifests : []
  for (let index = 0; index < resolvedIndexDirs.length; index += 1) {
    const indexDir = resolvedIndexDirs[index]
    if (seenIndexDirs.has(indexDir)) {
      throw new Error(
        [
          "Perfect prototype direct partitioned-index merge requires unique source index directories.",
          `duplicateIndexDir=${indexDir}`,
          `outDir=${path.resolve(String(outDir ?? "").trim() || process.cwd())}`,
        ].join("\n"),
      )
    }
    seenIndexDirs.add(indexDir)
    const sourceManifest = safeSourceManifests[index] ?? null
    if (sourceManifest?.partitioned === true || pathExists(path.join(indexDir, "partition_manifest.json"))) {
      throw new Error(
        [
          "Perfect prototype direct partitioned-index merge accepts only non-partitioned shard-local source indexes.",
          `indexDir=${indexDir}`,
        ].join("\n"),
      )
    }
    const directProvenance = resolvePerfectPrototypeRecordedDirectIndexProvenance({
      indexManifest: sourceManifest,
    })
    if (!directProvenance?.inputPaths?.length) {
      throw new Error(
        [
          "Perfect prototype direct partitioned-index merge requires explicit source input provenance on every source index.",
          `indexDir=${indexDir}`,
          "Run the explicit repair tool for legacy shard artifacts:",
          "tools/run_server_command.sh node tools/repair_perfect_prototype_index_tokenizer_fingerprint.mjs <index-dir> [<index-dir> ...]",
        ].join("\n"),
      )
    }
    for (const inputPath of directProvenance.inputPaths) {
      const resolvedInputPath = path.resolve(String(inputPath ?? "").trim())
      if (seenInputPaths.has(resolvedInputPath)) {
        throw new Error(
          [
            "Perfect prototype direct partitioned-index merge encountered duplicate source input paths.",
            `duplicateInputPath=${resolvedInputPath}`,
            `indexDir=${indexDir}`,
          ].join("\n"),
        )
      }
      seenInputPaths.add(resolvedInputPath)
      sourceInputPaths.push(resolvedInputPath)
    }
  }
  const expectedSet = new Set(expectedInputPaths)
  const sourceSet = new Set(sourceInputPaths)
  const missingInputPaths = expectedInputPaths.filter((filePath) => !sourceSet.has(filePath))
  const extraInputPaths = uniqueSorted(sourceInputPaths).filter((filePath) => !expectedSet.has(filePath))
  if (missingInputPaths.length > 0 || extraInputPaths.length > 0) {
    throw new Error(
      [
        "Perfect prototype direct partitioned-index merge source-set does not exactly match the selected feature-store partitions.",
        `outDir=${path.resolve(String(outDir ?? "").trim() || process.cwd())}`,
        `expectedPartitionCount=${expectedInputPaths.length}`,
        `sourceInputCount=${sourceSet.size}`,
        missingInputPaths.length > 0
          ? `missingSourceInputPaths=${formatPathSample(missingInputPaths)}`
          : null,
        extraInputPaths.length > 0
          ? `extraSourceInputPaths=${formatPathSample(extraInputPaths)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return {
    expectedInputPaths,
    sourceInputPaths: uniqueSorted(sourceInputPaths),
  }
}

export const buildCurrentPerfectPrototypeDirectIndexProvenance = async ({
  inputPath = null,
  inputPaths = [],
  packManifestPath = null,
  packSummaryPath = null,
  outputCoverage = null,
}) => {
  const resolvedInputPaths = resolveNonEmptyPaths(
    Array.isArray(inputPaths) && inputPaths.length > 0 ? inputPaths : [inputPath],
  )
  if (resolvedInputPaths.length < 1) {
    throw new Error(
      "Indexed predictive mining requires recorded direct-index input paths for provenance validation.",
    )
  }
  const inputStateHash = await buildPerfectPrototypePartitionStateHash(resolvedInputPaths)
  return buildPerfectPrototypeDirectIndexProvenanceRecord({
    inputPath: resolvedInputPaths[0],
    inputPaths: resolvedInputPaths,
    inputStateHash,
    packManifestPath,
    packSummaryPath,
    outputCoverage,
  })
}

const buildMismatchError = ({
  indexDir,
  field,
  recordedValue,
  currentValue,
}) =>
  new Error(
    [
      "Indexed predictive mining detected stale feature-store / index provenance.",
      `indexDir=${path.resolve(String(indexDir ?? "").trim() || process.cwd())}`,
      `field=${field}`,
      `recorded=${stableJson(recordedValue)}`,
      `current=${stableJson(currentValue)}`,
      "Rebuild the affected feature-store partitions with tools/build_perfect_prototype_prejump_feature_store.mjs --overwrite-existing=true.",
      "Then rebuild the partitioned index with tools/build_perfect_prototype_partitioned_token_index.mjs.",
    ].join("\n"),
  )

const buildDirectMismatchError = ({
  indexDir,
  field,
  recordedValue,
  currentValue,
}) =>
  new Error(
    [
      "Indexed predictive mining detected stale direct-index input provenance.",
      `indexDir=${path.resolve(String(indexDir ?? "").trim() || process.cwd())}`,
      `field=${field}`,
      `recorded=${stableJson(recordedValue)}`,
      `current=${stableJson(currentValue)}`,
      "Rebuild the direct token index with tools/build_perfect_prototype_token_index.mjs.",
      "For canonical server mining, rebuild the feature store and partitioned index instead.",
    ].join("\n"),
  )

export const assertPerfectPrototypeIndexProvenanceCompatible = ({
  indexDir,
  recordedProvenance,
  currentProvenance,
}) => {
  const checks = [
    ["featureStoreDir", path.resolve(String(recordedProvenance?.featureStoreDir ?? "").trim()), path.resolve(String(currentProvenance?.featureStoreDir ?? "").trim())],
    ["startDate", recordedProvenance?.startDate ?? null, currentProvenance?.startDate ?? null],
    ["endDate", recordedProvenance?.endDate ?? null, currentProvenance?.endDate ?? null],
    ["shardGranularity", recordedProvenance?.shardGranularity ?? null, currentProvenance?.shardGranularity ?? null],
    ["dataContractHash", recordedProvenance?.dataContractHash ?? null, currentProvenance?.dataContractHash ?? null],
    ["selectedCoverage", recordedProvenance?.selectedCoverage ?? null, currentProvenance?.selectedCoverage ?? null],
    ["selectedPartitionCount", Number(recordedProvenance?.selectedPartitionCount ?? 0), Number(currentProvenance?.selectedPartitionCount ?? 0)],
    ["partitionStateHash", recordedProvenance?.partitionStateHash ?? null, currentProvenance?.partitionStateHash ?? null],
    ["tokenizerSpecCacheKey", recordedProvenance?.tokenizerSpecCacheKey ?? null, currentProvenance?.tokenizerSpecCacheKey ?? null],
    [
      "tokenizerSpecCacheInputs",
      normalizePerfectPrototypeTokenizerSpecCacheInputs(recordedProvenance?.tokenizerSpecCacheInputs),
      normalizePerfectPrototypeTokenizerSpecCacheInputs(currentProvenance?.tokenizerSpecCacheInputs),
    ],
  ]
  for (const [field, recordedValue, currentValue] of checks) {
    if (stableJson(recordedValue) !== stableJson(currentValue)) {
      throw buildMismatchError({
        indexDir,
        field,
        recordedValue,
        currentValue,
      })
    }
  }
}

export const validatePerfectPrototypePartitionedIndexProvenance = async ({
  indexDir,
  indexManifest,
  partitionManifest = null,
}) => {
  const resolvedIndexDir = path.resolve(indexDir)
  const hasPartitionManifest = pathExists(path.join(resolvedIndexDir, "partition_manifest.json"))
  if (indexManifest?.partitioned === false && hasPartitionManifest) {
    throw new Error(
      [
        "Indexed predictive mining detected stale partitioned-index artifacts in a non-partitioned index directory.",
        `indexDir=${resolvedIndexDir}`,
        "Remove the stale partition_manifest.json or rebuild the index in a clean output directory.",
      ].join("\n"),
    )
  }
  const isPartitioned = indexManifest?.partitioned === true || (indexManifest?.partitioned == null && hasPartitionManifest)
  if (!isPartitioned) return null
  if (!partitionManifest || typeof partitionManifest !== "object") {
    throw new Error(
      [
        "Indexed predictive mining requires partition_manifest.json for partitioned index provenance validation.",
        `indexDir=${path.resolve(indexDir)}`,
      ].join("\n"),
    )
  }
  const recordedProvenance = resolvePerfectPrototypeRecordedIndexProvenance({
    indexManifest,
    partitionManifest,
  })
  if (!recordedProvenance?.featureStoreDir || !recordedProvenance?.partitionStateHash) {
    throw new Error(
      [
        "Partitioned predictive index is missing required feature-store provenance metadata.",
        `indexDir=${path.resolve(indexDir)}`,
        "Rebuild the partitioned index so feature-store provenance is persisted before mining.",
      ].join("\n"),
    )
  }
  const currentProvenance = await buildCurrentPerfectPrototypeIndexProvenance({
    featureStoreDir: recordedProvenance.featureStoreDir,
    startDate: recordedProvenance.startDate,
    endDate: recordedProvenance.endDate,
    shardGranularity: recordedProvenance.shardGranularity,
    tokenizerSpecCacheInputs: recordedProvenance.tokenizerSpecCacheInputs,
  })
  assertPerfectPrototypeIndexProvenanceCompatible({
    indexDir,
    recordedProvenance,
    currentProvenance,
  })
  return currentProvenance
}

export const validatePerfectPrototypeDirectIndexProvenance = async ({
  indexDir,
  indexManifest,
}) => {
  const recordedProvenance = resolvePerfectPrototypeRecordedDirectIndexProvenance({
    indexManifest,
  })
  if (!recordedProvenance?.inputPaths?.length || !recordedProvenance?.inputStateHash) {
    throw new Error(
      [
        "Indexed predictive mining requires explicit direct-index input provenance for non-partitioned indexes.",
        `indexDir=${path.resolve(indexDir)}`,
        "Rebuild the direct token index so input provenance is persisted before mining.",
      ].join("\n"),
    )
  }
  const currentProvenance = await buildCurrentPerfectPrototypeDirectIndexProvenance({
    inputPaths: recordedProvenance.inputPaths,
    packManifestPath: recordedProvenance.packManifestPath,
    packSummaryPath: recordedProvenance.packSummaryPath,
    outputCoverage: recordedProvenance.outputCoverage,
  })
  const checks = [
    ["inputPaths", recordedProvenance.inputPaths, currentProvenance.inputPaths],
    ["inputStateHash", recordedProvenance.inputStateHash, currentProvenance.inputStateHash],
  ]
  for (const [field, recordedValue, currentValue] of checks) {
    if (stableJson(recordedValue) !== stableJson(currentValue)) {
      throw buildDirectMismatchError({
        indexDir,
        field,
        recordedValue,
        currentValue,
      })
    }
  }
  return currentProvenance
}

export const validatePerfectPrototypeIndexProvenance = async ({
  indexDir,
  indexManifest,
  partitionManifest = null,
}) => {
  const resolvedIndexDir = path.resolve(indexDir)
  const hasPartitionManifest = pathExists(path.join(resolvedIndexDir, "partition_manifest.json"))
  if (indexManifest?.partitioned === false && hasPartitionManifest) {
    throw new Error(
      [
        "Indexed predictive mining detected stale partitioned-index artifacts in a non-partitioned index directory.",
        `indexDir=${resolvedIndexDir}`,
        "Remove the stale partition_manifest.json or rebuild the index in a clean output directory.",
      ].join("\n"),
    )
  }
  const isPartitioned = indexManifest?.partitioned === true || (indexManifest?.partitioned == null && hasPartitionManifest)
  if (isPartitioned) {
    return validatePerfectPrototypePartitionedIndexProvenance({
      indexDir,
      indexManifest,
      partitionManifest,
    })
  }
  return validatePerfectPrototypeDirectIndexProvenance({
    indexDir,
    indexManifest,
  })
}
