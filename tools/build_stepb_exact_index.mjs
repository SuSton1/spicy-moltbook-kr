import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJsonl, toRunId } from "../src/lib/io.mjs"
import {
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import { PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE } from "../src/lib/perfect_prototype_contextual_features.mjs"
import {
  inferPerfectPrototypeDatasetContract,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
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
import {
  buildPerfectPrototypeTokenizerSpecFingerprintMetadata,
} from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"
import { hashPerfectPrototypeMiningInputFile } from "../src/lib/perfect_prototype_mining_cache.mjs"
import {
  buildPerfectPrototypeStepbExactIndex,
  writePerfectPrototypeStepbExactIndexSummary,
} from "../src/lib/perfect_prototype_stepb_exact_index.mjs"

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
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

const resolveSurfaceName = (value) => {
  const normalized = String(value ?? PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE).trim().toLowerCase()
  return PERFECT_PROTOTYPE_TOKENIZER_SURFACES[normalized]
    ? normalized
    : PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE
}

const hrtimeSecondsSince = (startedAt) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_exact_index",
  })
  const sourceRunId = String(getFlag(parsed.flags, "source-run-id", "")).trim()
  const rawInputPath = String(getFlag(parsed.flags, "input", "")).trim()
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
      String(
        getFlag(
          parsed.flags,
          "out-run-id",
          `perfect_proto_stepb_exact_index_${toRunId(new Date())}`,
        ),
      ).trim(),
      "step-perfect-prototype-index",
    )
  if (!inputPath || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_exact_index.mjs --input=<templates_lite.jsonl> --out-dir=<dir> | --source-run-id=<run> [--out-run-id=<run>] [--enable-interval-atoms=true|false] [--enable-macro-atoms=true|false] [--enable-support-anchor-atoms=true|false] [--enable-support-manifold-signature=true|false] [--enable-support-metric-features=true|false] [--enable-adaptive-threshold-atoms=true|false]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_stepb_exact_index",
  })
  const surfaceName = resolveSurfaceName(
    getFlag(parsed.flags, "surface", PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE),
  )
  const options = {
    surfaceName,
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    trainStartDate: String(getFlag(parsed.flags, "train-start", "")).trim() || null,
    trainEndDate: String(getFlag(parsed.flags, "train-end", "")).trim() || null,
    minHitCount: toInteger(getFlag(parsed.flags, "min-hit-count", 6), 6),
    maxGapTradingDays: toOptionalInteger(getFlag(parsed.flags, "max-gap")),
    maxRuleSize: toOptionalInteger(getFlag(parsed.flags, "max-rule-size")),
    maxSeedTokens: toOptionalInteger(getFlag(parsed.flags, "max-seed-tokens")),
    maxRules: toOptionalInteger(getFlag(parsed.flags, "max-rules")),
    maxSearchStates: toOptionalInteger(getFlag(parsed.flags, "max-search-states")),
    maxRejectedRuleSamples: toOptionalInteger(getFlag(parsed.flags, "max-rejected-rule-samples")),
    tokenizerOptions: {
      binCount: toInteger(getFlag(parsed.flags, "bin-count", 5), 5),
      includeSymbolToken: toBoolean(getFlag(parsed.flags, "include-symbol-token", false), false),
      includeMissingTokens: toBoolean(getFlag(parsed.flags, "include-missing-tokens", false), false),
      includeCategoricalTokens: toBoolean(
        getFlag(parsed.flags, "include-categorical-tokens", true),
        true,
      ),
      enableIntervalAtoms: toBoolean(getFlag(parsed.flags, "enable-interval-atoms", false), false),
      enableMacroAtoms: toBoolean(getFlag(parsed.flags, "enable-macro-atoms", false), false),
      enableSupportAnchorAtoms: toBoolean(
        getFlag(parsed.flags, "enable-support-anchor-atoms", false),
        false,
      ),
      enableSupportManifoldSignature: toBoolean(
        getFlag(parsed.flags, "enable-support-manifold-signature", false),
        false,
      ),
      enableSupportMetricFeatures: toBoolean(
        getFlag(parsed.flags, "enable-support-metric-features", false),
        false,
      ),
      enableAdaptiveThresholdAtoms: toBoolean(
        getFlag(parsed.flags, "enable-adaptive-threshold-atoms", false),
        false,
      ),
      includeFeaturePrefixes:
        resolvePerfectPrototypeFeaturePrefixes(surfaceName) ??
        PERFECT_PROTOTYPE_TOKENIZER_SURFACES[PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE],
    },
  }
  const startedAt = process.hrtime.bigint()
  const hashInputStartedAt = process.hrtime.bigint()
  const inputSha256 = await hashPerfectPrototypeMiningInputFile(inputPath)
  const hashInputSec = hrtimeSecondsSince(hashInputStartedAt)
  const readJsonlStartedAt = process.hrtime.bigint()
  const rows = await readJsonl(inputPath)
  const readJsonlSec = hrtimeSecondsSince(readJsonlStartedAt)
  const datasetContract = inferPerfectPrototypeDatasetContract(rows)
  if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
    throw new Error(
      "Step-B exact compiled index builder refuses predictive dataset contracts; use predictive parquet/indexed mining instead.",
    )
  }
  const buildIndexStartedAt = process.hrtime.bigint()
  await ensureDir(outDir)
  const builtIndex = await buildPerfectPrototypeStepbExactIndex({
    cwd,
    rows,
    outDir,
    inputPath,
    inputSha256,
    surfaceName,
    options,
  })
  const buildIndexSec = hrtimeSecondsSince(buildIndexStartedAt)
  const elapsedSec = hrtimeSecondsSince(startedAt)
  const maxRssKb = Number(process.resourceUsage().maxRSS ?? 0)
  const tokenizerFingerprintMetadata = buildPerfectPrototypeTokenizerSpecFingerprintMetadata(
    builtIndex.snapshot.tokenizerSpec,
  )
  await writePerfectPrototypeStepbExactIndexSummary({
    outDir,
    summary: {
      ...tokenizerFingerprintMetadata,
      inputPath,
      outDir,
      surfaceName,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
      inputSha256,
      elapsedSec,
      maxRssKb,
      datasetContract,
      tokenizer: summarizePerfectPrototypeTokenizerSpec(builtIndex.snapshot.tokenizerSpec),
      rows: builtIndex.snapshot.rows.length,
      tokenCount: builtIndex.snapshot.tokenStatsEntries.length,
      inputProvenance: builtIndex.inputProvenance,
      parallelArtifacts: builtIndex.parallelArtifacts,
      phaseTimings: {
        hashInputSec,
        readJsonlSec,
        prepareRowsSec: Number(builtIndex.phaseTimings.prepareRowsSec ?? 0),
        buildTokenizerSpecSec: Number(builtIndex.phaseTimings.buildTokenizerSpecSec ?? 0),
        tokenizeRowsSec: Number(builtIndex.phaseTimings.tokenizeRowsSec ?? 0),
        buildTokenStatsSec: Number(builtIndex.phaseTimings.buildTokenStatsSec ?? 0),
        buildIndexSec,
      },
      manifest: builtIndex.manifest,
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
