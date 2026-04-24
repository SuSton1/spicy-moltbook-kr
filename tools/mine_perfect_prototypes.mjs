import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { ensureDir, pathExists, readJson, readJsonl, toRunId, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  minePerfectPrototypes,
  minePerfectPrototypesPrepared,
  preparePerfectPrototypeMiningSnapshot,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
  PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"
import { PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE } from "../src/lib/perfect_prototype_contextual_features.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
  inferPerfectPrototypeDatasetContract,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  PERFECT_PROTOTYPE_TOKENIZER_SURFACES,
  resolvePerfectPrototypeFeaturePrefixes,
  summarizePerfectPrototypeTokenizerSpec,
} from "../src/lib/perfect_prototype_tokenizer.mjs"
import { buildPerfectPrototypeTokenizerSpecHash } from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  buildPerfectPrototypeMiningCacheIdentity,
  hashPerfectPrototypeMiningInputFile,
  readPerfectPrototypeMiningSnapshotCache,
  writePerfectPrototypeMiningSnapshotCache,
} from "../src/lib/perfect_prototype_mining_cache.mjs"
import {
  loadPerfectPrototypeStepbExactIndex,
} from "../src/lib/perfect_prototype_stepb_exact_index.mjs"

const PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE = "exact_parallel_frontier_v1"

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const toOptionalBoolean = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined
  return toBoolean(value, false)
}

const toInteger = (value, fallback) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) ? n : fallback
}

const toOptionalInteger = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined
  const n = Math.floor(Number(value))
  return Number.isInteger(n) ? n : undefined
}

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

const toNonNegativeInteger = (value, fallback) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

const resolveSurfaceName = (value) => {
  const normalized = String(value ?? PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE).trim().toLowerCase()
  return PERFECT_PROTOTYPE_TOKENIZER_SURFACES[normalized]
    ? normalized
    : PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
}

const resolveSearchMode = (value) => {
  const normalized = String(value ?? PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE).trim()
  if (normalized === PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE) {
    return PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE
  }
  if (normalized === PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE) {
    return PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE
  }
  if (normalized === PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE) {
    return PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE
  }
  throw new Error(`unsupported --search-mode: ${normalized || "<empty>"}`)
}

const readOptionalJson = async (filePath) => {
  if (!pathExists(filePath)) return null
  return readJson(filePath, null)
}

const hrtimeSecondsSince = (startedAt) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000

const assertLegacyMinerInputAllowed = async ({ inputPath, surfaceName }) => {
  if (surfaceName === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE) {
    throw new Error(
      [
        "Predictive v5 mining is parquet/indexed-only.",
        "Do not use tools/mine_perfect_prototypes.mjs for predictive inputs.",
        "Run: node tools/build_perfect_prototype_token_index.mjs --input=<prejump_pack.parquet> --out-dir=<index_dir>",
        "Then: node tools/mine_perfect_prototypes_indexed.mjs --index-dir=<index_dir> --out-dir=<mine_dir>",
      ].join(" "),
    )
  }
  const manifestPath = path.join(path.dirname(inputPath), "manifest.json")
  const summaryPath = path.join(path.dirname(inputPath), "summary.json")
  const [manifest, summary] = await Promise.all([
    readOptionalJson(manifestPath),
    readOptionalJson(summaryPath),
  ])
  const contractSurface = String(
    summary?.contextSurface ??
      manifest?.summary?.contextSurface ??
      manifest?.contextSurface ??
      "",
  )
    .trim()
    .toLowerCase()
  const contractStrategyMode = String(
    summary?.strategyMode ??
      manifest?.summary?.strategyMode ??
      manifest?.strategyMode ??
      "",
  )
    .trim()
    .toUpperCase()
  if (
    contractSurface === PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE ||
    contractStrategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE
  ) {
    throw new Error(
      [
        `Refusing legacy JSONL miner for predictive input: ${inputPath}`,
        `Detected surface=${contractSurface || "unknown"} strategyMode=${contractStrategyMode || "unknown"}.`,
        "Use indexed predictive mining instead:",
        "node tools/build_perfect_prototype_token_index.mjs --input=<prejump_pack.parquet> --out-dir=<index_dir>",
        "node tools/mine_perfect_prototypes_indexed.mjs --index-dir=<index_dir> --out-dir=<mine_dir>",
      ].join(" "),
    )
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "mine_perfect_prototypes",
  })
  const sourceRunId = String(getFlag(parsed.flags, "source-run-id", "")).trim()
  const rawInputPath = String(getFlag(parsed.flags, "input", "")).trim()
  const rawIndexDir = String(getFlag(parsed.flags, "index-dir", "")).trim()
  const indexDir = rawIndexDir ? path.resolve(rawIndexDir) : ""
  const inputPath = rawInputPath
    ? path.resolve(rawInputPath)
    : sourceRunId
      ? path.join(cwd, "artifacts", "runs", sourceRunId, "step-b", "templates_lite.jsonl")
      : ""
  const rawOutDir = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const outDir = rawOutDir
    ? path.resolve(rawOutDir)
    : path.join(
      cwd,
      "artifacts",
      "runs",
      String(getFlag(parsed.flags, "out-run-id", `perfect_proto_2024_${toRunId(new Date())}`)).trim(),
      "step-perfect-prototype",
    )
  if ((!inputPath && !indexDir) || (inputPath && indexDir) || !outDir) {
    throw new Error(
      "Usage: node tools/mine_perfect_prototypes.mjs (--input=<templates_lite.jsonl> | --source-run-id=<run> | --index-dir=<dir>) --out-dir=<dir> [--out-run-id=<run>] [--search-mode=exact_indexed_kernel_v1|exact_parallel_frontier_v1|legacy_exact_catalog_v6] [--min-train-precision=1] [--max-train-hit-count=<n>] [--enable-train-matched-date-prune=true] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true] [--enable-lane-stratified-mining=true] [--enable-family-scoped-mining=true] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--family-seed-max-top-bucket=<n>] [--family-seed-max-mid-bucket=<n>] [--family-seed-max-low-bucket=<n>] [--mid-family-min-share=<0..1>] [--low-family-min-share=<0..1>] [--low-family-min-train-matched-dates=<n>] [--low-family-min-train-matched-months=<n>] [--low-family-min-train-matched-folds=<n>] [--enable-diverse-catalog-selection=true] [--enable-mdl-catalog-selection=true] [--diverse-catalog-target-rules=<n>] [--diverse-novelty-weight=<n>] [--diverse-overlap-penalty-weight=<n>] [--diverse-anchor-family-penalty-weight=<n>] [--top-family-max-quota=<n>] [--mid-family-min-quota=<n>] [--low-family-min-quota=<n>] [--mdl-description-length-weight=<n>] [--mdl-overlap-penalty-weight=<n>] [--hit-count-mode=raw_row_count|day_capped_symbol_count] [--hit-count-day-symbol-cap=2]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      ...(inputPath ? [{ label: "input", filePath: inputPath }] : []),
      ...(indexDir ? [{ label: "indexDir", filePath: indexDir }] : []),
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "mine_perfect_prototypes",
  })
  const surfaceName = resolveSurfaceName(
    getFlag(parsed.flags, "surface", PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE),
  )
  const searchMode = resolveSearchMode(
    getFlag(parsed.flags, "search-mode", PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE),
  )
  if (indexDir && searchMode === PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE) {
    throw new Error(
      [
        "tools/mine_perfect_prototypes.mjs does not support --index-dir with exact_indexed_kernel_v1.",
        "Use tools/mine_perfect_prototypes_indexed.mjs for compiled Step-B exact index mining.",
      ].join(" "),
    )
  }
  const usesIndexedExactDiscoveryDefaults =
    Boolean(indexDir) &&
    (searchMode === PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE ||
      searchMode === PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE)
  if (inputPath) {
    await assertLegacyMinerInputAllowed({
      inputPath,
      surfaceName,
    })
  }
  const minerOptions = {
    surfaceName,
    searchMode,
    trainStartDate: String(getFlag(parsed.flags, "train-start", "")).trim() || null,
    trainEndDate: String(getFlag(parsed.flags, "train-end", "")).trim() || null,
    minHitCount: toInteger(getFlag(parsed.flags, "min-hit-count", 6), 6),
    minTrainPrecision: toOptionalNumber(getFlag(parsed.flags, "min-train-precision")),
    maxTrainHitCount: toOptionalInteger(getFlag(parsed.flags, "max-train-hit-count")),
    enableTrainMatchedDatePrune: toOptionalBoolean(
      getFlag(parsed.flags, "enable-train-matched-date-prune"),
    ),
    minTrainMatchedDates: toOptionalInteger(getFlag(parsed.flags, "min-train-matched-dates")),
    minTrainMatchedMonths: toOptionalInteger(getFlag(parsed.flags, "min-train-matched-months")),
    minTrainMatchedQuarters: toOptionalInteger(
      getFlag(parsed.flags, "min-train-matched-quarters"),
    ),
    minTrainMatchedFolds: toOptionalInteger(getFlag(parsed.flags, "min-train-matched-folds")),
    foldScheme: String(getFlag(parsed.flags, "fold-scheme", "")).trim() || null,
    maxTop1DateHitShare: toOptionalNumber(getFlag(parsed.flags, "max-top1-date-hit-share")),
    maxTop3DateHitShare: toOptionalNumber(getFlag(parsed.flags, "max-top3-date-hit-share")),
    maxTop1FoldHitShare: toOptionalNumber(getFlag(parsed.flags, "max-top1-fold-hit-share")),
    maxTop3FoldHitShare: toOptionalNumber(getFlag(parsed.flags, "max-top3-fold-hit-share")),
    maxRulesPerMatchedDateSignature: toOptionalInteger(
      getFlag(parsed.flags, "max-rules-per-matched-date-signature"),
    ),
    maxRulesPerMatchedMonthSignature: toOptionalInteger(
      getFlag(parsed.flags, "max-rules-per-matched-month-signature"),
    ),
    maxRulesPerMatchedQuarterSignature: toOptionalInteger(
      getFlag(parsed.flags, "max-rules-per-matched-quarter-signature"),
    ),
    enableDiverseSearchOrdering: toOptionalBoolean(
      getFlag(parsed.flags, "enable-diverse-search-ordering"),
    ),
    enableLaneStratifiedMining: toOptionalBoolean(
      getFlag(parsed.flags, "enable-lane-stratified-mining"),
    ),
    enableFamilyScopedMining: toOptionalBoolean(
      getFlag(parsed.flags, "enable-family-scoped-mining"),
    ),
    diverseBeamMaxPerMonthSignature: toOptionalInteger(
      getFlag(parsed.flags, "diverse-beam-max-per-month-signature"),
    ),
    diverseBeamMaxPerQuarterSignature: toOptionalInteger(
      getFlag(parsed.flags, "diverse-beam-max-per-quarter-signature"),
    ),
    diverseBeamMaxPerAnchorFamily: toOptionalInteger(
      getFlag(parsed.flags, "diverse-beam-max-per-anchor-family"),
    ),
    familySeedMaxTopBucket: toOptionalInteger(
      getFlag(parsed.flags, "family-seed-max-top-bucket"),
    ),
    familySeedMaxMidBucket: toOptionalInteger(
      getFlag(parsed.flags, "family-seed-max-mid-bucket"),
    ),
    familySeedMaxLowBucket: toOptionalInteger(
      getFlag(parsed.flags, "family-seed-max-low-bucket"),
    ),
    midFamilyMinShare: toOptionalNumber(getFlag(parsed.flags, "mid-family-min-share")),
    lowFamilyMinShare: toOptionalNumber(getFlag(parsed.flags, "low-family-min-share")),
    lowFamilyMinTrainMatchedDates: toOptionalInteger(
      getFlag(parsed.flags, "low-family-min-train-matched-dates"),
    ),
    lowFamilyMinTrainMatchedMonths: toOptionalInteger(
      getFlag(parsed.flags, "low-family-min-train-matched-months"),
    ),
    lowFamilyMinTrainMatchedFolds: toOptionalInteger(
      getFlag(parsed.flags, "low-family-min-train-matched-folds"),
    ),
    enableDiverseCatalogSelection: toOptionalBoolean(
      getFlag(parsed.flags, "enable-diverse-catalog-selection"),
    ),
    enableMdlCatalogSelection: toOptionalBoolean(
      getFlag(parsed.flags, "enable-mdl-catalog-selection"),
    ),
    diverseCatalogTargetRules: toOptionalInteger(
      getFlag(parsed.flags, "diverse-catalog-target-rules"),
    ),
    diverseNoveltyWeight: toOptionalNumber(getFlag(parsed.flags, "diverse-novelty-weight")),
    diverseOverlapPenaltyWeight: toOptionalNumber(
      getFlag(parsed.flags, "diverse-overlap-penalty-weight"),
    ),
    diverseAnchorFamilyPenaltyWeight: toOptionalNumber(
      getFlag(parsed.flags, "diverse-anchor-family-penalty-weight"),
    ),
    topFamilyMaxQuota: toOptionalInteger(getFlag(parsed.flags, "top-family-max-quota")),
    midFamilyMinQuota: toOptionalInteger(getFlag(parsed.flags, "mid-family-min-quota")),
    lowFamilyMinQuota: toOptionalInteger(getFlag(parsed.flags, "low-family-min-quota")),
    mdlDescriptionLengthWeight: toOptionalNumber(
      getFlag(parsed.flags, "mdl-description-length-weight"),
    ),
    mdlOverlapPenaltyWeight: toOptionalNumber(
      getFlag(parsed.flags, "mdl-overlap-penalty-weight"),
    ),
    hitCountMode: String(getFlag(parsed.flags, "hit-count-mode", "")).trim() || null,
    hitCountDaySymbolCap: toOptionalInteger(
      getFlag(parsed.flags, "hit-count-day-symbol-cap", ""),
    ),
    maxGapTradingDays:
      toOptionalInteger(getFlag(parsed.flags, "max-gap")) ??
      (usesIndexedExactDiscoveryDefaults ? 100000 : null),
    maxRuleSize:
      toOptionalInteger(getFlag(parsed.flags, "max-rule-size")) ??
      (usesIndexedExactDiscoveryDefaults ? 6 : null),
    maxSeedTokens:
      toOptionalInteger(getFlag(parsed.flags, "max-seed-tokens")) ??
      (usesIndexedExactDiscoveryDefaults ? 4000 : null),
    maxRules:
      toOptionalInteger(getFlag(parsed.flags, "max-rules")) ??
      (usesIndexedExactDiscoveryDefaults ? 4000 : null),
    maxSearchStates:
      toOptionalInteger(getFlag(parsed.flags, "max-search-states")) ??
      (usesIndexedExactDiscoveryDefaults ? 20000000 : null),
    maxRejectedRuleSamples: toOptionalInteger(getFlag(parsed.flags, "max-rejected-rule-samples")),
    tokenizerOptions: {
      binCount: toInteger(getFlag(parsed.flags, "bin-count", 5), 5),
      includeSymbolToken: toBoolean(getFlag(parsed.flags, "include-symbol-token", false), false),
      includeMissingTokens: toBoolean(getFlag(parsed.flags, "include-missing-tokens", false), false),
      includeCategoricalTokens: toBoolean(
        getFlag(parsed.flags, "include-categorical-tokens", true),
        true,
      ),
      includeFeaturePrefixes:
        resolvePerfectPrototypeFeaturePrefixes(surfaceName) ??
        PERFECT_PROTOTYPE_TOKENIZER_SURFACES[PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE],
    },
  }
  const parallelOptions = {
    workers: toInteger(getFlag(parsed.flags, "workers", 2), 2),
    orderingHeadWindow: toNonNegativeInteger(getFlag(parsed.flags, "ordering-head-window", 8), 8),
    searchStateCacheMaxBytes: toNonNegativeInteger(
      getFlag(parsed.flags, "search-state-cache-max-bytes", 128 * 1024 * 1024),
      128 * 1024 * 1024,
    ),
    externalBudgetRequestHeadroomStates: toNonNegativeInteger(
      getFlag(parsed.flags, "external-budget-request-headroom-states", 4096),
      4096,
    ),
    externalBudgetRequestSearchStates: toNonNegativeInteger(
      getFlag(parsed.flags, "external-budget-request-search-states", 8192),
      8192,
    ),
    externalBudgetRequestWaitMs: toNonNegativeInteger(
      getFlag(parsed.flags, "external-budget-request-wait-ms", 10000),
      10000,
    ),
    externalBudgetDecisionPollMs: toNonNegativeInteger(
      getFlag(parsed.flags, "external-budget-decision-poll-ms", 25),
      25,
    ),
    rowProjectedCandidateThreshold: toOptionalInteger(
      getFlag(parsed.flags, "row-projected-candidate-threshold", ""),
    ),
    seedPostingCacheEntries: toOptionalInteger(
      getFlag(parsed.flags, "seed-posting-cache-entries", ""),
    ),
    pinAllSeedPostings: toOptionalBoolean(
      getFlag(parsed.flags, "pin-all-seed-postings", ""),
    ),
    prewarmSeedPostings: toOptionalBoolean(
      getFlag(parsed.flags, "prewarm-seed-postings", ""),
    ),
    seedPostingPrewarmConcurrency: toOptionalInteger(
      getFlag(parsed.flags, "seed-posting-prewarm-concurrency", ""),
    ),
  }
  let readJsonlSec = 0
  let datasetContract = null
  let result = null
  const compiledIndexSummary = {
    enabled: Boolean(indexDir),
    indexDir: indexDir || null,
    loadIndexSec: 0,
    manifestInputSha256: null,
  }
  const cacheSummary = {
    enabled: !indexDir && searchMode === PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    cacheHit: false,
    inputSha256: null,
    cacheKey: null,
    cacheDir: null,
    hashInputSec: 0,
    cacheReadSec: 0,
    cacheWriteSec: 0,
  }
  const startedAt = process.hrtime.bigint()
  if (indexDir && searchMode === PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE) {
    await minePerfectPrototypeParallelIndexed({
      cwd,
      indexDir,
      outDir,
      options: {
        ...minerOptions,
        searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
        workers: parallelOptions.workers,
        orderingHeadWindow: parallelOptions.orderingHeadWindow,
        searchStateCacheMaxBytes: parallelOptions.searchStateCacheMaxBytes,
        externalBudgetRequestHeadroomStates:
          parallelOptions.externalBudgetRequestHeadroomStates,
        externalBudgetRequestSearchStates:
          parallelOptions.externalBudgetRequestSearchStates,
        externalBudgetRequestWaitMs: parallelOptions.externalBudgetRequestWaitMs,
        externalBudgetDecisionPollMs: parallelOptions.externalBudgetDecisionPollMs,
        rowProjectedCandidateThreshold:
          parallelOptions.rowProjectedCandidateThreshold,
        seedPostingCacheEntries: parallelOptions.seedPostingCacheEntries,
        pinAllSeedPostings: parallelOptions.pinAllSeedPostings,
        prewarmSeedPostings: parallelOptions.prewarmSeedPostings,
        seedPostingPrewarmConcurrency:
          parallelOptions.seedPostingPrewarmConcurrency,
      },
    })
    return
  }
  if (indexDir) {
    if (searchMode !== PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE) {
      throw new Error(
        `--index-dir requires --search-mode=${PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE} or ${PERFECT_PROTOTYPE_EXACT_PARALLEL_FRONTIER_SEARCH_MODE}; actual=${searchMode}`,
      )
    }
    const loadIndexStartedAt = process.hrtime.bigint()
    const loadedIndex = await loadPerfectPrototypeStepbExactIndex({
      indexDir,
      expectedSearchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    })
    compiledIndexSummary.loadIndexSec = hrtimeSecondsSince(loadIndexStartedAt)
    compiledIndexSummary.manifestInputSha256 = loadedIndex.manifest?.inputSha256 ?? null
    datasetContract =
      loadedIndex.manifest?.datasetContract ??
      inferPerfectPrototypeDatasetContract(loadedIndex.snapshot.rows)
    if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
      throw new Error(
        [
          "Refusing compiled Step-B exact index for predictive dataset contract.",
          "Predictive primary path must use predictive parquet/indexed mining instead.",
        ].join(" "),
      )
    }
    result = minePerfectPrototypesPrepared({
      snapshot: loadedIndex.snapshot,
      options: {
        ...minerOptions,
        surfaceName:
          String(loadedIndex.manifest?.surfaceName ?? "").trim().toLowerCase() || surfaceName,
      },
      phaseTimings: {
        prepareRowsSec: 0,
        buildTokenizerSpecSec: 0,
        tokenizeRowsSec: 0,
        buildTokenStatsSec: 0,
      },
    })
  } else if (cacheSummary.enabled) {
    const hashInputStartedAt = process.hrtime.bigint()
    const inputSha256 = await hashPerfectPrototypeMiningInputFile(inputPath)
    cacheSummary.hashInputSec = hrtimeSecondsSince(hashInputStartedAt)
    cacheSummary.inputSha256 = inputSha256
    const cacheIdentity = buildPerfectPrototypeMiningCacheIdentity({
      inputPath,
      inputSha256,
      surfaceName,
      searchMode,
      trainStartDate: minerOptions.trainStartDate,
      trainEndDate: minerOptions.trainEndDate,
      tokenizerOptions: minerOptions.tokenizerOptions,
    })
    cacheSummary.cacheKey = cacheIdentity.cacheKey
    let cachedSnapshot = null
    const cacheReadStartedAt = process.hrtime.bigint()
    cachedSnapshot = await readPerfectPrototypeMiningSnapshotCache({
      inputPath,
      identity: cacheIdentity,
    })
    cacheSummary.cacheReadSec = hrtimeSecondsSince(cacheReadStartedAt)
    if (cachedSnapshot) {
      cacheSummary.cacheHit = true
      cacheSummary.cacheDir = cachedSnapshot.cacheDir
      datasetContract = inferPerfectPrototypeDatasetContract(cachedSnapshot.snapshot.rows)
      if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
        throw new Error(
          [
            "Refusing cached legacy miner snapshot for predictive dataset contract.",
            "Predictive primary path must use parquet/indexed mining.",
          ].join(" "),
        )
      }
      result = minePerfectPrototypesPrepared({
        snapshot: cachedSnapshot.snapshot,
        options: minerOptions,
        phaseTimings: {
          prepareRowsSec: 0,
          buildTokenizerSpecSec: 0,
          tokenizeRowsSec: 0,
          buildTokenStatsSec: 0,
        },
      })
    } else {
      const readJsonlStartedAt = process.hrtime.bigint()
      const rows = await readJsonl(inputPath)
      readJsonlSec = hrtimeSecondsSince(readJsonlStartedAt)
      const prepared = preparePerfectPrototypeMiningSnapshot({
        rows,
        options: minerOptions,
      })
      datasetContract = inferPerfectPrototypeDatasetContract(prepared.snapshot.rows)
      if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
        throw new Error(
          [
            "Refusing legacy JSONL miner for predictive dataset contract discovered after input load.",
            "Predictive primary path must use parquet/indexed mining.",
          ].join(" "),
        )
      }
      const cacheWriteStartedAt = process.hrtime.bigint()
      const cacheRecord = await writePerfectPrototypeMiningSnapshotCache({
        inputPath,
        identity: cacheIdentity,
        tokenizerSpecHash: buildPerfectPrototypeTokenizerSpecHash(prepared.snapshot.tokenizerSpec),
        snapshot: prepared.snapshot,
      })
      cacheSummary.cacheWriteSec = hrtimeSecondsSince(cacheWriteStartedAt)
      cacheSummary.cacheDir = cacheRecord.cacheDir
      result = minePerfectPrototypesPrepared({
        snapshot: prepared.snapshot,
        options: minerOptions,
        phaseTimings: prepared.phaseTimings,
      })
    }
  } else {
    const readJsonlStartedAt = process.hrtime.bigint()
    const rows = await readJsonl(inputPath)
    readJsonlSec = hrtimeSecondsSince(readJsonlStartedAt)
    datasetContract = inferPerfectPrototypeDatasetContract(rows)
    if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
      throw new Error(
        [
          "Refusing legacy JSONL miner for predictive dataset contract discovered after input load.",
          "Predictive primary path must use parquet/indexed mining.",
        ].join(" "),
      )
    }
    result = minePerfectPrototypes({
      rows,
      options: minerOptions,
    })
  }
  const elapsedSec = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
  const maxRssKb = Number(process.resourceUsage().maxRSS ?? 0)
  result.catalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      ...result.catalog,
      metadata: {
        ...(result.catalog?.metadata ?? {}),
        datasetContract,
        searchMode,
        hitCountMode: minerOptions.hitCountMode ?? null,
        hitCountDaySymbolCap: minerOptions.hitCountDaySymbolCap ?? null,
      },
    },
    sourceRunId,
  })

  const writeArtifactsStartedAt = process.hrtime.bigint()
  await ensureDir(outDir)
  await writeJson(path.join(outDir, "catalog.json"), result.catalog)
  await writeJson(path.join(outDir, "champion.json"), {
    champion: result.catalog.champion,
    summary: result.catalog.summary,
  })
  await writeJson(path.join(outDir, "champion_rules.json"), {
    championRules: result.catalog.champion ? [result.catalog.champion] : [],
    summary: result.catalog.summary,
  })
  await writeJsonl(path.join(outDir, "matches.jsonl"), result.matches)
  await writeJsonl(path.join(outDir, "deduped_matches.jsonl"), result.dedupedMatches)
  await writeJsonl(path.join(outDir, "rejected_rules.jsonl"), result.rejectedRules)
  await writeJson(path.join(outDir, "negative_separation_report.json"), result.negativeSeparationReport)
  await writeJson(path.join(outDir, "coverage.json"), result.coverage)
  await writeJson(path.join(outDir, "coverage_report.json"), result.coverage)
  const writeArtifactsSec = hrtimeSecondsSince(writeArtifactsStartedAt)
  const summaryPayload = {
    inputPath,
    indexDir: indexDir || null,
    outDir,
    surfaceName,
    searchMode,
    hitCountMode: minerOptions.hitCountMode ?? null,
    hitCountDaySymbolCap: minerOptions.hitCountDaySymbolCap ?? null,
    enableLaneStratifiedMining: minerOptions.enableLaneStratifiedMining ?? null,
    enableDiverseCatalogSelection: minerOptions.enableDiverseCatalogSelection ?? null,
    enableMdlCatalogSelection: minerOptions.enableMdlCatalogSelection ?? null,
    foldScheme: minerOptions.foldScheme ?? null,
    minTrainMatchedDates: minerOptions.minTrainMatchedDates ?? null,
    minTrainMatchedMonths: minerOptions.minTrainMatchedMonths ?? null,
    minTrainMatchedQuarters: minerOptions.minTrainMatchedQuarters ?? null,
    minTrainMatchedFolds: minerOptions.minTrainMatchedFolds ?? null,
    rows: result.rows.length,
    rules: result.rules.length,
    exploredStates: result.exploredStates,
    elapsedSec,
    maxRssKb,
    datasetContract,
    tokenizer: summarizePerfectPrototypeTokenizerSpec(result.tokenizerSpec),
    compiledIndex: compiledIndexSummary,
    cache: cacheSummary,
    phaseTimings: {
      readJsonlSec,
      prepareRowsSec: Number(result?.phaseTimings?.prepareRowsSec ?? 0),
      buildTokenizerSpecSec: Number(result?.phaseTimings?.buildTokenizerSpecSec ?? 0),
      tokenizeRowsSec: Number(result?.phaseTimings?.tokenizeRowsSec ?? 0),
      buildTokenStatsSec: Number(result?.phaseTimings?.buildTokenStatsSec ?? 0),
      buildRowsetsSec: Number(result?.phaseTimings?.buildRowsetsSec ?? 0),
      seedSelectionSec: Number(result?.phaseTimings?.seedSelectionSec ?? 0),
      searchSec: Number(result?.phaseTimings?.searchSec ?? 0),
      emitSec: Number(result?.phaseTimings?.emitSec ?? 0),
      writeArtifactsSec,
    },
    rejectionSummary: result.rejectionSummary,
    rowsetRuntimeStats: result.rowsetRuntimeStats,
    negativeSeparationReport: result.negativeSeparationReport,
    coverage: result.coverage,
    ...(result.matchMassTelemetry && typeof result.matchMassTelemetry === "object"
      ? result.matchMassTelemetry
      : {}),
  }
  await writeJson(path.join(outDir, "summary.json"), summaryPayload)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
