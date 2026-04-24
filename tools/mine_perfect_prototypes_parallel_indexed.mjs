import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const toNonNegativeInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

const toOptionalInteger = (value, fallback = null) => {
  const text = String(value ?? "").trim()
  if (!text) return fallback
  const n = Math.floor(Number(value))
  return Number.isInteger(n) ? n : fallback
}

const toNumberInRange = (value, fallback = null, min = 0, max = 1) => {
  const text = String(value ?? "").trim()
  if (!text) return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const toBoolean = (value, fallback = false) => {
  const text = String(value ?? "").trim().toLowerCase()
  if (!text) return fallback
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "mine_perfect_prototypes_parallel_indexed",
  })
  const indexDir = path.resolve(String(getFlag(parsed.flags, "index-dir", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!indexDir || !outDir) {
    throw new Error(
      "Usage: node tools/mine_perfect_prototypes_parallel_indexed.mjs --index-dir=<dir> --out-dir=<dir> [--workers=2] [--min-train-precision=1] [--max-train-hit-count=<n>] [--enable-train-matched-date-prune=true] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true] [--enable-lane-stratified-mining=true] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--enable-diverse-catalog-selection=true] [--enable-mdl-catalog-selection=true]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "indexDir", filePath: indexDir },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "mine_perfect_prototypes_parallel_indexed",
  })

  await minePerfectPrototypeParallelIndexed({
    cwd,
    indexDir,
    outDir,
    options: {
      trainStartDate: String(getFlag(parsed.flags, "train-start", "")).trim() || null,
      trainEndDate: String(getFlag(parsed.flags, "train-end", "")).trim() || null,
      minHitCount: toInteger(getFlag(parsed.flags, "min-hit-count", 6), 6),
      minTrainPrecision: toNumberInRange(getFlag(parsed.flags, "min-train-precision", 1), 1, 0, 1),
      maxTrainHitCount: toOptionalInteger(getFlag(parsed.flags, "max-train-hit-count", ""), null),
      enableTrainMatchedDatePrune: toBoolean(
        getFlag(parsed.flags, "enable-train-matched-date-prune", ""),
        false,
      ),
      minTrainMatchedDates: toOptionalInteger(getFlag(parsed.flags, "min-train-matched-dates", ""), null),
      minTrainMatchedMonths: toOptionalInteger(
        getFlag(parsed.flags, "min-train-matched-months", ""),
        null,
      ),
      minTrainMatchedQuarters: toOptionalInteger(
        getFlag(parsed.flags, "min-train-matched-quarters", ""),
        null,
      ),
      minTrainMatchedFolds: toOptionalInteger(
        getFlag(parsed.flags, "min-train-matched-folds", ""),
        null,
      ),
      foldScheme: String(getFlag(parsed.flags, "fold-scheme", "")).trim() || null,
      maxTop1DateHitShare: toNumberInRange(getFlag(parsed.flags, "max-top1-date-hit-share", ""), null, 0, 1),
      maxTop3DateHitShare: toNumberInRange(getFlag(parsed.flags, "max-top3-date-hit-share", ""), null, 0, 1),
      maxTop1FoldHitShare: toNumberInRange(getFlag(parsed.flags, "max-top1-fold-hit-share", ""), null, 0, 1),
      maxTop3FoldHitShare: toNumberInRange(getFlag(parsed.flags, "max-top3-fold-hit-share", ""), null, 0, 1),
      maxRulesPerMatchedDateSignature: toOptionalInteger(
        getFlag(parsed.flags, "max-rules-per-matched-date-signature", ""),
        null,
      ),
      maxRulesPerMatchedMonthSignature: toOptionalInteger(
        getFlag(parsed.flags, "max-rules-per-matched-month-signature", ""),
        null,
      ),
      maxRulesPerMatchedQuarterSignature: toOptionalInteger(
        getFlag(parsed.flags, "max-rules-per-matched-quarter-signature", ""),
        null,
      ),
      enableDiverseSearchOrdering: toBoolean(
        getFlag(parsed.flags, "enable-diverse-search-ordering", ""),
        false,
      ),
      enableLaneStratifiedMining: toBoolean(
        getFlag(parsed.flags, "enable-lane-stratified-mining", ""),
        false,
      ),
      diverseBeamMaxPerMonthSignature: toOptionalInteger(
        getFlag(parsed.flags, "diverse-beam-max-per-month-signature", ""),
        null,
      ),
      diverseBeamMaxPerQuarterSignature: toOptionalInteger(
        getFlag(parsed.flags, "diverse-beam-max-per-quarter-signature", ""),
        null,
      ),
      diverseBeamMaxPerAnchorFamily: toOptionalInteger(
        getFlag(parsed.flags, "diverse-beam-max-per-anchor-family", ""),
        null,
      ),
      enableDiverseCatalogSelection: toBoolean(
        getFlag(parsed.flags, "enable-diverse-catalog-selection", ""),
        false,
      ),
      enableMdlCatalogSelection: toBoolean(
        getFlag(parsed.flags, "enable-mdl-catalog-selection", ""),
        false,
      ),
      diverseCatalogTargetRules: toOptionalInteger(
        getFlag(parsed.flags, "diverse-catalog-target-rules", ""),
        null,
      ),
      diverseNoveltyWeight: toNumberInRange(
        getFlag(parsed.flags, "diverse-novelty-weight", ""),
        null,
        0,
        100,
      ),
      diverseOverlapPenaltyWeight: toNumberInRange(
        getFlag(parsed.flags, "diverse-overlap-penalty-weight", ""),
        null,
        0,
        100,
      ),
      diverseAnchorFamilyPenaltyWeight: toNumberInRange(
        getFlag(parsed.flags, "diverse-anchor-family-penalty-weight", ""),
        null,
        0,
        100,
      ),
      mdlDescriptionLengthWeight: toNumberInRange(
        getFlag(parsed.flags, "mdl-description-length-weight", ""),
        null,
        0,
        100,
      ),
      mdlOverlapPenaltyWeight: toNumberInRange(
        getFlag(parsed.flags, "mdl-overlap-penalty-weight", ""),
        null,
        0,
        100,
      ),
      maxGapTradingDays: toInteger(getFlag(parsed.flags, "max-gap", 100000), 100000),
      maxRuleSize: toInteger(getFlag(parsed.flags, "max-rule-size", 6), 6),
      maxSeedTokens: toInteger(getFlag(parsed.flags, "max-seed-tokens", 4000), 4000),
      maxRules: toInteger(getFlag(parsed.flags, "max-rules", 4000), 4000),
      maxSearchStates: toInteger(getFlag(parsed.flags, "max-search-states", 20000000), 20000000),
      maxRejectedRuleSamples: toInteger(
        getFlag(parsed.flags, "max-rejected-rule-samples", 1000),
        1000,
      ),
      workers: toInteger(getFlag(parsed.flags, "workers", 2), 2),
      orderingHeadWindow: toNonNegativeInteger(getFlag(parsed.flags, "ordering-head-window", 8), 8),
      searchStateCacheMaxBytes: toNonNegativeInteger(
        getFlag(parsed.flags, "search-state-cache-max-bytes", 128 * 1024 * 1024),
        128 * 1024 * 1024,
      ),
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
