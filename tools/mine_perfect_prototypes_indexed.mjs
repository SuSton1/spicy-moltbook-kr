import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  closePerfectPrototypeIndexedWorkerSession,
  createPerfectPrototypeIndexedWorkerSession,
  minePerfectPrototypeIndexed,
} from "../src/lib/perfect_prototype_indexed_miner.mjs"
import {
  ensureDir,
  readJson,
  readJsonIfExistsStrict,
  writeJsonAtomic,
} from "../src/lib/io.mjs"
import {
  buildPerfectPrototypeWorkerSlotPaths,
  PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS,
} from "../src/lib/perfect_prototype_parallel_worker_slot.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { normalizePerfectPrototypeSupportCases } from "../src/lib/perfect_prototype_support_case.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toInteger = (value, fallback = null) => {
  const text = String(value ?? "").trim()
  if (!text) return fallback
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const toNonNegativeInteger = (value, fallback = null) => {
  const text = String(value ?? "").trim()
  if (!text) return fallback
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

const buildMinerOptionsFromFlags = (parsed) => ({
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
  enablePromotableSearchPrune: toBoolean(
    getFlag(parsed.flags, "enable-promotable-search-prune", ""),
    false,
  ),
  enablePromotableSearchOrdering: toBoolean(
    getFlag(parsed.flags, "enable-promotable-search-ordering", ""),
    false,
  ),
  enableYearHitUpperBoundPrune: toBoolean(
    getFlag(parsed.flags, "enable-year-hit-upper-bound-prune", ""),
    false,
  ),
  coreYears: String(getFlag(parsed.flags, "core-years", "")).trim()
    ? String(getFlag(parsed.flags, "core-years", ""))
        .split(",")
        .map((value) => Number(String(value ?? "").trim()))
        .filter((value) => Number.isInteger(value))
    : [],
  excludedBoundaryYears: String(getFlag(parsed.flags, "excluded-boundary-years", "")).trim()
    ? String(getFlag(parsed.flags, "excluded-boundary-years", ""))
        .split(",")
        .map((value) => Number(String(value ?? "").trim()))
        .filter((value) => Number.isInteger(value))
    : [],
  minTrainHitsPerCoreYear: toOptionalInteger(
    getFlag(parsed.flags, "min-train-hits-per-core-year", ""),
    null,
  ),
  promotableMinTrainMatchedDates: toOptionalInteger(
    getFlag(parsed.flags, "promotable-min-train-matched-dates", ""),
    null,
  ),
  promotableMinTrainMatchedMonths: toOptionalInteger(
    getFlag(parsed.flags, "promotable-min-train-matched-months", ""),
    null,
  ),
  promotableMinTrainMatchedFolds: toOptionalInteger(
    getFlag(parsed.flags, "promotable-min-train-matched-folds", ""),
    null,
  ),
  promotableMaxTop1DateHitShare: toNumberInRange(
    getFlag(parsed.flags, "promotable-max-top1-date-hit-share", ""),
    null,
    0,
    1,
  ),
  promotableMaxTop3DateHitShare: toNumberInRange(
    getFlag(parsed.flags, "promotable-max-top3-date-hit-share", ""),
    null,
    0,
    1,
  ),
  promotableMaxTop1FoldHitShare: toNumberInRange(
    getFlag(parsed.flags, "promotable-max-top1-fold-hit-share", ""),
    null,
    0,
    1,
  ),
  promotableMaxTop3FoldHitShare: toNumberInRange(
    getFlag(parsed.flags, "promotable-max-top3-fold-hit-share", ""),
    null,
    0,
    1,
  ),
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
  enableFamilyScopedMining: toBoolean(
    getFlag(parsed.flags, "enable-family-scoped-mining", ""),
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
  familySeedMaxTopBucket: toOptionalInteger(
    getFlag(parsed.flags, "family-seed-max-top-bucket", ""),
    null,
  ),
  familySeedMaxMidBucket: toOptionalInteger(
    getFlag(parsed.flags, "family-seed-max-mid-bucket", ""),
    null,
  ),
  familySeedMaxLowBucket: toOptionalInteger(
    getFlag(parsed.flags, "family-seed-max-low-bucket", ""),
    null,
  ),
  midFamilyMinShare: toNumberInRange(
    getFlag(parsed.flags, "mid-family-min-share", ""),
    null,
    0,
    1,
  ),
  lowFamilyMinShare: toNumberInRange(
    getFlag(parsed.flags, "low-family-min-share", ""),
    null,
    0,
    1,
  ),
  lowFamilySearchMinHitCount: toOptionalInteger(
    getFlag(parsed.flags, "low-family-search-min-hit-count", ""),
    null,
  ),
  lowFamilyMinTrainMatchedDates: toOptionalInteger(
    getFlag(parsed.flags, "low-family-min-train-matched-dates", ""),
    null,
  ),
  lowFamilyMinTrainMatchedMonths: toOptionalInteger(
    getFlag(parsed.flags, "low-family-min-train-matched-months", ""),
    null,
  ),
  lowFamilyMinTrainMatchedFolds: toOptionalInteger(
    getFlag(parsed.flags, "low-family-min-train-matched-folds", ""),
    null,
  ),
  recentOnlyFamilyIds: String(getFlag(parsed.flags, "recent-only-family-ids", "")).trim()
    ? String(getFlag(parsed.flags, "recent-only-family-ids", ""))
        .split(",")
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [],
  supportCasesFile: String(getFlag(parsed.flags, "support-cases-file", "")).trim() || null,
  supportFeatureCasesFile:
    String(getFlag(parsed.flags, "support-feature-cases-file", "")).trim() || null,
  supportCaseMaxRootSeeds: toOptionalInteger(
    getFlag(parsed.flags, "support-case-max-root-seeds", ""),
    null,
  ),
  supportCaseMaxEffectiveRootSeeds: toOptionalInteger(
    getFlag(parsed.flags, "support-case-max-effective-root-seeds", ""),
    null,
  ),
  supportCaseMinRootOverlap: toOptionalInteger(
    getFlag(parsed.flags, "support-case-min-root-overlap", ""),
    null,
  ),
  supportCaseMinPrefixOverlap: toOptionalInteger(
    getFlag(parsed.flags, "support-case-min-prefix-overlap", ""),
    null,
  ),
  supportCasePrefixDepthLimit: toOptionalInteger(
    getFlag(parsed.flags, "support-case-prefix-depth-limit", ""),
    null,
  ),
  supportCaseMinDonorRootOverlap: toOptionalInteger(
    getFlag(parsed.flags, "support-case-min-donor-root-overlap", ""),
    null,
  ),
  supportCaseMinDonorPrefixOverlap: toOptionalInteger(
    getFlag(parsed.flags, "support-case-min-donor-prefix-overlap", ""),
    null,
  ),
  supportCaseDonorPrefixDepthLimit: toOptionalInteger(
    getFlag(parsed.flags, "support-case-donor-prefix-depth-limit", ""),
    null,
  ),
  supportCaseFailIfRootScopeUncompressed: toBoolean(
    getFlag(parsed.flags, "support-case-fail-if-root-scope-uncompressed", ""),
    false,
  ),
  enableSubgroupPrepass: toBoolean(
    getFlag(parsed.flags, "enable-subgroup-prepass", ""),
    false,
  ),
  enableSubgroupStability: toBoolean(
    getFlag(parsed.flags, "enable-subgroup-stability", ""),
    false,
  ),
  enableSubgroupDiversity: toBoolean(
    getFlag(parsed.flags, "enable-subgroup-diversity", ""),
    false,
  ),
  subgroupMinMatchedDates: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-min-matched-dates", ""),
    null,
  ),
  subgroupMinMatchedMonths: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-min-matched-months", ""),
    null,
  ),
  subgroupMinMatchedFolds: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-min-matched-folds", ""),
    null,
  ),
  subgroupMaxRootSeeds: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-max-root-seeds", ""),
    null,
  ),
  subgroupMaxManifests: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-max-manifests", ""),
    null,
  ),
  subgroupMinSelectionFrequency: toNumberInRange(
    getFlag(parsed.flags, "subgroup-min-selection-frequency", ""),
    null,
    0,
    1,
  ),
  subgroupMinFoldPresenceCount: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-min-fold-presence-count", ""),
    null,
  ),
  subgroupMinWindowPresenceCount: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-min-window-presence-count", ""),
    null,
  ),
  subgroupMaxTokenJaccard: toNumberInRange(
    getFlag(parsed.flags, "subgroup-max-token-jaccard", ""),
    null,
    0,
    1,
  ),
  subgroupMaxAxisOverlap: toOptionalInteger(
    getFlag(parsed.flags, "subgroup-max-axis-overlap", ""),
    null,
  ),
  subgroupMaxDateCoverJaccard: toNumberInRange(
    getFlag(parsed.flags, "subgroup-max-date-cover-jaccard", ""),
    null,
    0,
    1,
  ),
  subgroupEarlyDateRetentionRatio: toNumberInRange(
    getFlag(parsed.flags, "subgroup-early-date-retention-ratio", ""),
    null,
    0,
    1,
  ),
  subgroupEarlyMonthRetentionRatio: toNumberInRange(
    getFlag(parsed.flags, "subgroup-early-month-retention-ratio", ""),
    null,
    0,
    1,
  ),
  subgroupEarlyFoldRetentionRatio: toNumberInRange(
    getFlag(parsed.flags, "subgroup-early-fold-retention-ratio", ""),
    null,
    0,
    1,
  ),
  enableExactCompletionSolver: toBoolean(
    getFlag(parsed.flags, "enable-exact-completion-solver", ""),
    false,
  ),
  exactCompletionMode: String(getFlag(parsed.flags, "exact-completion-mode", "")).trim() || null,
  exactCompletionMaxCandidates: toOptionalInteger(
    getFlag(parsed.flags, "exact-completion-max-candidates", ""),
    null,
  ),
  exactCompletionMaxAdditionalTokens: toOptionalInteger(
    getFlag(parsed.flags, "exact-completion-max-additional-tokens", ""),
    null,
  ),
  enableCrossfitHardNegativeRefinement: toBoolean(
    getFlag(parsed.flags, "enable-crossfit-hard-negative-refinement", ""),
    false,
  ),
  crossfitHoldoutWindows: toOptionalInteger(
    getFlag(parsed.flags, "crossfit-holdout-windows", ""),
    null,
  ),
  crossfitMinWindowSupport: toOptionalInteger(
    getFlag(parsed.flags, "crossfit-min-window-support", ""),
    null,
  ),
  crossfitHardNegativeWeight: toNumberInRange(
    getFlag(parsed.flags, "crossfit-hard-negative-weight", ""),
    null,
    1,
    100,
  ),
  enableJointFeasibilitySolver: toBoolean(
    getFlag(parsed.flags, "enable-joint-feasibility-solver", ""),
    false,
  ),
  jointFeasibilityMinCrossfitPositiveWindows: toOptionalInteger(
    getFlag(parsed.flags, "joint-feasibility-min-crossfit-positive-windows", ""),
    null,
  ),
  jointFeasibilityMaxCrossfitNegativeWindows: toOptionalInteger(
    getFlag(parsed.flags, "joint-feasibility-max-crossfit-negative-windows", ""),
    null,
  ),
  jointFeasibilityRequireHistoricalSupport: toBoolean(
    getFlag(parsed.flags, "joint-feasibility-require-historical-support", ""),
    false,
  ),
  jointFeasibilityHistoricalSupportCaseIds: String(
    getFlag(parsed.flags, "joint-feasibility-historical-support-case-ids", ""),
  )
    .split(",")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean),
  enableIntervalAtoms: toBoolean(
    getFlag(parsed.flags, "enable-interval-atoms", ""),
    false,
  ),
  enableMacroAtoms: toBoolean(
    getFlag(parsed.flags, "enable-macro-atoms", ""),
    false,
  ),
  enableSupportAnchorAtoms: toBoolean(
    getFlag(parsed.flags, "enable-support-anchor-atoms", ""),
    false,
  ),
  enableSupportManifoldSignature: toBoolean(
    getFlag(parsed.flags, "enable-support-manifold-signature", ""),
    false,
  ),
  enableSupportMetricFeatures: toBoolean(
    getFlag(parsed.flags, "enable-support-metric-features", ""),
    false,
  ),
  enableAdaptiveThresholdAtoms: toBoolean(
    getFlag(parsed.flags, "enable-adaptive-threshold-atoms", ""),
    false,
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
  topFamilyMaxQuota: toOptionalInteger(
    getFlag(parsed.flags, "top-family-max-quota", ""),
    null,
  ),
  midFamilyMinQuota: toOptionalInteger(
    getFlag(parsed.flags, "mid-family-min-quota", ""),
    null,
  ),
  lowFamilyMinQuota: toOptionalInteger(
    getFlag(parsed.flags, "low-family-min-quota", ""),
    null,
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
  hitCountMode: String(getFlag(parsed.flags, "hit-count-mode", "")).trim() || null,
  hitCountDaySymbolCap: toInteger(getFlag(parsed.flags, "hit-count-day-symbol-cap", ""), null),
  maxGapTradingDays: toInteger(getFlag(parsed.flags, "max-gap", 100000), 100000),
  maxRuleSize: toInteger(getFlag(parsed.flags, "max-rule-size", 6), 6),
  maxSeedTokens: toInteger(getFlag(parsed.flags, "max-seed-tokens", 4000), 4000),
  maxRules: toInteger(getFlag(parsed.flags, "max-rules", 4000), 4000),
  bootstrapLivePartialMaxRules: toInteger(
    getFlag(parsed.flags, "bootstrap-live-partial-max-rules", ""),
    null,
  ),
  maxSearchStates: toInteger(getFlag(parsed.flags, "max-search-states", 20000000), 20000000),
  maxRejectedRuleSamples: toInteger(
    getFlag(parsed.flags, "max-rejected-rule-samples", 1000),
    1000,
  ),
  rootSeedStartIndex: toNonNegativeInteger(getFlag(parsed.flags, "root-start", 0), 0) ?? 0,
  rootSeedEndIndexExclusive: toNonNegativeInteger(getFlag(parsed.flags, "root-end", ""), null),
  workerChunkIndex: toNonNegativeInteger(getFlag(parsed.flags, "worker-chunk-index", ""), null),
  outputMode: String(getFlag(parsed.flags, "output-mode", "full")).trim().toLowerCase() || "full",
  enablePartialTopKHitBound: toBoolean(
    getFlag(parsed.flags, "enable-partial-top-k-hit-bound", false),
    false,
  ),
  orderingHeadWindow: toNonNegativeInteger(getFlag(parsed.flags, "ordering-head-window", 8), 8),
  seedPostingCacheEntries: toNonNegativeInteger(
    getFlag(parsed.flags, "seed-posting-cache-entries", ""),
    null,
  ),
  pinAllSeedPostings: (() => {
    const raw = String(getFlag(parsed.flags, "pin-all-seed-postings", "")).trim()
    return raw ? toBoolean(raw, false) : null
  })(),
  prewarmSeedPostings: (() => {
    const raw = String(getFlag(parsed.flags, "prewarm-seed-postings", "")).trim()
    return raw ? toBoolean(raw, false) : null
  })(),
  seedPostingPrewarmConcurrency: toNonNegativeInteger(
    getFlag(parsed.flags, "seed-posting-prewarm-concurrency", ""),
    null,
  ),
  initialKthHitFloor: toNonNegativeInteger(
    getFlag(parsed.flags, "initial-kth-hit-floor", ""),
    null,
  ),
  configuredMaxSearchStates: toInteger(
    getFlag(parsed.flags, "configured-max-search-states", 20000000),
    20000000,
  ),
  allocatedMaxSearchStates: toInteger(
    getFlag(parsed.flags, "allocated-max-search-states", ""),
    null,
  ),
  baseAllocatedMaxSearchStates: toInteger(
    getFlag(parsed.flags, "base-allocated-max-search-states", ""),
    null,
  ),
  guardBandAllocatedSearchStates: toNonNegativeInteger(
    getFlag(parsed.flags, "guard-band-allocated-search-states", ""),
    null,
  ),
  remainingGlobalSearchBudgetAtLaunch: toNonNegativeInteger(
    getFlag(parsed.flags, "remaining-global-search-budget-at-launch", ""),
    null,
  ),
  externalKthHitFloorPath:
    String(getFlag(parsed.flags, "external-kth-hit-floor-path", "")).trim() || null,
  externalKthHitFloorPollMs: toInteger(
    getFlag(parsed.flags, "external-kth-hit-floor-poll-ms", 1000),
    1000,
  ),
  externalKthHitFloorStateInterval: toInteger(
    getFlag(parsed.flags, "external-kth-hit-floor-state-interval", 256),
    256,
  ),
  externalBudgetPath: String(getFlag(parsed.flags, "external-budget-path", "")).trim() || null,
  externalBudgetRequestPath:
    String(getFlag(parsed.flags, "external-budget-request-path", "")).trim() || null,
  externalBudgetDecisionPath:
    String(getFlag(parsed.flags, "external-budget-decision-path", "")).trim() || null,
  externalBudgetCommitPath:
    String(getFlag(parsed.flags, "external-budget-commit-path", "")).trim() || null,
  externalBudgetPollMs: toInteger(
    getFlag(parsed.flags, "external-budget-poll-ms", 1000),
    1000,
  ),
  externalBudgetDecisionPollMs: toInteger(
    getFlag(parsed.flags, "external-budget-decision-poll-ms", 25),
    25,
  ),
  externalBudgetStateInterval: toInteger(
    getFlag(parsed.flags, "external-budget-state-interval", 256),
    256,
  ),
  externalBudgetRequestHeadroomStates: toInteger(
    getFlag(parsed.flags, "external-budget-request-headroom-states", 4096),
    4096,
  ),
  externalBudgetRequestSearchStates: toInteger(
    getFlag(parsed.flags, "external-budget-request-search-states", 8192),
    8192,
  ),
  externalBudgetRequestWaitMs: toInteger(
    getFlag(parsed.flags, "external-budget-request-wait-ms", 10000),
    10000,
  ),
  searchStateCacheMaxBytes: toNonNegativeInteger(
    getFlag(parsed.flags, "search-state-cache-max-bytes", 128 * 1024 * 1024),
    128 * 1024 * 1024,
  ),
  rowProjectedCandidateThreshold: toNonNegativeInteger(
    getFlag(parsed.flags, "row-projected-candidate-threshold", ""),
    null,
  ),
})

const writeSlotState = async ({
  slotPaths,
  workerSlotIndex,
  stateRevision,
  state,
  commandRevision = 0,
  lastCompletedCommandRevision = 0,
  activeChunkIndex = null,
  lastCompletedChunkIndex = null,
  activeOutDir = null,
  errorMessage = null,
}) => {
  await writeJsonAtomic(slotPaths.statePath, {
    version: 1,
    pid: process.pid,
    workerSlotIndex,
    stateRevision,
    state,
    commandRevision,
    lastCompletedCommandRevision,
    activeChunkIndex,
    lastCompletedChunkIndex,
    activeOutDir,
    errorMessage,
    updatedAt: new Date().toISOString(),
  })
}

const normalizeSlotCommand = ({ commandPayload, slotPaths, lastCommandRevision }) => {
  if (!commandPayload || typeof commandPayload !== "object") return null
  const revision = Math.floor(Number(commandPayload?.revision) || 0)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(
      `Persistent worker slot command has invalid revision: ${slotPaths.commandPath}`,
    )
  }
  if (revision <= lastCommandRevision) {
    return null
  }
  const command = String(commandPayload?.command ?? "").trim().toLowerCase()
  if (!["run_chunk", "shutdown"].includes(command)) {
    throw new Error(
      `Persistent worker slot command has invalid command=${command}: ${slotPaths.commandPath}`,
    )
  }
  const workerSlotIndex = Math.floor(Number(commandPayload?.workerSlotIndex) || 0)
  if (!Number.isInteger(workerSlotIndex) || workerSlotIndex < 0) {
    throw new Error(
      `Persistent worker slot command has invalid workerSlotIndex: ${slotPaths.commandPath}`,
    )
  }
  if (command === "shutdown") {
    return {
      revision,
      command,
      workerSlotIndex,
    }
  }
  const chunkIndex = Math.floor(Number(commandPayload?.chunkIndex) || 0)
  const outDirText = String(commandPayload?.outDir ?? "").trim()
  const outDir = outDirText.length > 0 ? path.resolve(outDirText) : null
  const options = commandPayload?.options
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error(
      `Persistent worker slot command has invalid chunkIndex: ${slotPaths.commandPath}`,
    )
  }
  if (!outDir) {
    throw new Error(`Persistent worker slot command requires outDir: ${slotPaths.commandPath}`)
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error(
      `Persistent worker slot command requires an options object: ${slotPaths.commandPath}`,
    )
  }
  return {
    revision,
    command,
    workerSlotIndex,
    chunkIndex,
    outDir,
    options: { ...options },
  }
}

const runPersistentWorkerSlot = async ({
  cwd,
  indexDir,
  slotDir,
  workerSlotIndex,
  baseOptions,
  serverPolicy,
}) => {
  const slotPaths = buildPerfectPrototypeWorkerSlotPaths(slotDir)
  await ensureDir(slotPaths.slotDir)
  let stateRevision = 0
  let lastCompletedCommandRevision = 0
  let session = null
  let terminalState = null
  await writeSlotState({
    slotPaths,
    workerSlotIndex,
    stateRevision: (stateRevision += 1),
    state: "initializing",
    commandRevision: 0,
  })
  try {
    session = await createPerfectPrototypeIndexedWorkerSession({
      cwd,
      indexDir,
      options: baseOptions,
    })
    await writeJsonAtomic(slotPaths.sessionPath, {
      version: 1,
      pid: process.pid,
      workerSlotIndex,
      seedSelectionMs: Number(session?.seedSelectionMs ?? 0),
      dictionaryLoadMs: Number(session?.dictionaryLoadMs ?? 0),
      selectedSeedCount: Number(session?.selectedSeedCount ?? 0),
      initializedAt: new Date().toISOString(),
    })
    let lastCommandRevision = 0
    await writeSlotState({
      slotPaths,
      workerSlotIndex,
      stateRevision: (stateRevision += 1),
      state: "idle",
      commandRevision: 0,
      lastCompletedCommandRevision,
    })
    while (true) {
      const commandPayload = await readJsonIfExistsStrict(slotPaths.commandPath)
      const command = normalizeSlotCommand({
        commandPayload,
        slotPaths,
        lastCommandRevision,
      })
      if (!command) {
        await sleep(PERFECT_PROTOTYPE_WORKER_SLOT_POLL_MS)
        continue
      }
      if (command.workerSlotIndex !== workerSlotIndex) {
        throw new Error(
          [
            "Persistent worker slot command workerSlotIndex mismatch.",
            `expectedWorkerSlotIndex=${workerSlotIndex}`,
            `receivedWorkerSlotIndex=${command.workerSlotIndex}`,
            `path=${slotPaths.commandPath}`,
          ].join("\n"),
        )
      }
      lastCommandRevision = command.revision
      if (command.command === "shutdown") {
        terminalState = "shutdown"
        await writeSlotState({
          slotPaths,
          workerSlotIndex,
          stateRevision: (stateRevision += 1),
          state: "shutdown",
          commandRevision: command.revision,
          lastCompletedCommandRevision,
        })
        break
      }
      assertPerfectPrototypeServerPaths({
        entries: [{ label: "chunkOutDir", filePath: command.outDir }],
        policy: serverPolicy,
        toolName: "mine_perfect_prototypes_indexed",
      })
      await writeSlotState({
        slotPaths,
        workerSlotIndex,
        stateRevision: (stateRevision += 1),
        state: "running",
        commandRevision: command.revision,
        lastCompletedCommandRevision,
        activeChunkIndex: command.chunkIndex,
        activeOutDir: command.outDir,
      })
      try {
        await minePerfectPrototypeIndexed({
          cwd,
          indexDir,
          outDir: command.outDir,
          options: command.options,
          workerSession: session,
        })
      } catch (error) {
        terminalState = "failed"
        await writeSlotState({
          slotPaths,
          workerSlotIndex,
          stateRevision: (stateRevision += 1),
          state: "failed",
          commandRevision: command.revision,
          lastCompletedCommandRevision,
          activeChunkIndex: command.chunkIndex,
          activeOutDir: command.outDir,
          errorMessage: error instanceof Error ? error.stack || error.message : String(error),
        })
        throw error
      }
      lastCompletedCommandRevision = command.revision
      await writeSlotState({
        slotPaths,
        workerSlotIndex,
        stateRevision: (stateRevision += 1),
        state: "idle",
        commandRevision: command.revision,
        lastCompletedCommandRevision,
        lastCompletedChunkIndex: command.chunkIndex,
      })
    }
  } finally {
    await closePerfectPrototypeIndexedWorkerSession(session)
    if (terminalState !== "shutdown" && terminalState !== "failed") {
      await writeSlotState({
        slotPaths,
        workerSlotIndex,
        stateRevision: (stateRevision += 1),
        state: "terminated",
        commandRevision: 0,
        lastCompletedCommandRevision,
      }).catch(() => {})
    }
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "mine_perfect_prototypes_indexed",
  })
  const baseOptions = buildMinerOptionsFromFlags(parsed)
  const slotMode = String(getFlag(parsed.flags, "slot-mode", "")).trim().toLowerCase() || null
  const indexDir = path.resolve(String(getFlag(parsed.flags, "index-dir", "")).trim())
  if (!indexDir) {
    throw new Error(
      "Usage: node tools/mine_perfect_prototypes_indexed.mjs --index-dir=<dir> --out-dir=<dir> [--min-train-precision=1] [--max-train-hit-count=<n>] [--enable-train-matched-date-prune=true] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--enable-promotable-search-prune=true] [--enable-promotable-search-ordering=true] [--enable-year-hit-upper-bound-prune=true] [--core-years=2017,2018,...] [--excluded-boundary-years=2016] [--min-train-hits-per-core-year=<n>] [--promotable-min-train-matched-dates=<n>] [--promotable-min-train-matched-months=<n>] [--promotable-min-train-matched-folds=<n>] [--promotable-max-top1-date-hit-share=<0..1>] [--promotable-max-top3-date-hit-share=<0..1>] [--promotable-max-top1-fold-hit-share=<0..1>] [--promotable-max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true] [--enable-lane-stratified-mining=true] [--enable-family-scoped-mining=true] [--family-seed-max-top-bucket=<n>] [--family-seed-max-mid-bucket=<n>] [--family-seed-max-low-bucket=<n>] [--mid-family-min-share=<0..1>] [--low-family-min-share=<0..1>] [--low-family-min-train-matched-dates=<n>] [--low-family-min-train-matched-months=<n>] [--low-family-min-train-matched-folds=<n>] [--support-cases-file=<support_cases.json>] [--support-case-max-root-seeds=<n>] [--support-case-max-effective-root-seeds=<n>] [--support-case-min-root-overlap=<n>] [--support-case-min-prefix-overlap=<n>] [--support-case-prefix-depth-limit=<n>] [--support-case-min-donor-root-overlap=<n>] [--support-case-min-donor-prefix-overlap=<n>] [--support-case-donor-prefix-depth-limit=<n>] [--support-case-fail-if-root-scope-uncompressed=true|false] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--enable-diverse-catalog-selection=true] [--enable-mdl-catalog-selection=true] [--diverse-catalog-target-rules=<n>] [--diverse-novelty-weight=<n>] [--diverse-overlap-penalty-weight=<n>] [--diverse-anchor-family-penalty-weight=<n>] [--top-family-max-quota=<n>] [--mid-family-min-quota=<n>] [--low-family-min-quota=<n>] [--mdl-description-length-weight=<n>] [--mdl-overlap-penalty-weight=<n>] [--hit-count-mode=raw_row_count|day_capped_symbol_count] [--hit-count-day-symbol-cap=2]",
    )
  }
  if (baseOptions.supportCasesFile) {
    const supportCasesFile = path.resolve(String(baseOptions.supportCasesFile).trim())
    assertPerfectPrototypeServerPaths({
      entries: [{ label: "supportCasesFile", filePath: supportCasesFile }],
      policy: serverPolicy,
      toolName: "mine_perfect_prototypes_indexed",
    })
    const payload = await readJson(supportCasesFile)
    const rawSupportCases =
      Array.isArray(payload?.supportCases) ? payload.supportCases : Array.isArray(payload?.cases) ? payload.cases : []
    const supportCases = normalizePerfectPrototypeSupportCases(rawSupportCases)
    if (supportCases.length < 1) {
      throw new Error(`support-cases-file resolved zero support cases: ${supportCasesFile}`)
    }
    baseOptions.supportCasesFile = supportCasesFile
    baseOptions.supportCases = supportCases
  }
  if (baseOptions.supportFeatureCasesFile) {
    const supportFeatureCasesFile = path.resolve(String(baseOptions.supportFeatureCasesFile).trim())
    assertPerfectPrototypeServerPaths({
      entries: [{ label: "supportFeatureCasesFile", filePath: supportFeatureCasesFile }],
      policy: serverPolicy,
      toolName: "mine_perfect_prototypes_indexed",
    })
    const payload = await readJson(supportFeatureCasesFile)
    const rawSupportCases =
      Array.isArray(payload?.supportCases) ? payload.supportCases : Array.isArray(payload?.cases) ? payload.cases : []
    const supportFeatureCases = normalizePerfectPrototypeSupportCases(rawSupportCases)
    if (supportFeatureCases.length < 1) {
      throw new Error(`support-feature-cases-file resolved zero support cases: ${supportFeatureCasesFile}`)
    }
    baseOptions.supportFeatureCasesFile = supportFeatureCasesFile
    baseOptions.supportFeatureCases = supportFeatureCases
  }
  if (slotMode === "worker") {
    const slotDir = path.resolve(String(getFlag(parsed.flags, "slot-dir", "")).trim())
    const workerSlotIndex = toNonNegativeInteger(getFlag(parsed.flags, "worker-slot-index", ""), null)
    if (!slotDir || workerSlotIndex == null) {
      throw new Error(
        "Usage: node tools/mine_perfect_prototypes_indexed.mjs --slot-mode=worker --index-dir=<dir> --slot-dir=<dir> --worker-slot-index=<n> [--min-train-precision=1] [--max-train-hit-count=<n>] [--enable-train-matched-date-prune=true] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--enable-promotable-search-prune=true] [--enable-promotable-search-ordering=true] [--enable-year-hit-upper-bound-prune=true] [--core-years=2017,2018,...] [--excluded-boundary-years=2016] [--min-train-hits-per-core-year=<n>] [--promotable-min-train-matched-dates=<n>] [--promotable-min-train-matched-months=<n>] [--promotable-min-train-matched-folds=<n>] [--promotable-max-top1-date-hit-share=<0..1>] [--promotable-max-top3-date-hit-share=<0..1>] [--promotable-max-top1-fold-hit-share=<0..1>] [--promotable-max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true] [--enable-lane-stratified-mining=true] [--enable-family-scoped-mining=true] [--family-seed-max-top-bucket=<n>] [--family-seed-max-mid-bucket=<n>] [--family-seed-max-low-bucket=<n>] [--mid-family-min-share=<0..1>] [--low-family-min-share=<0..1>] [--low-family-min-train-matched-dates=<n>] [--low-family-min-train-matched-months=<n>] [--low-family-min-train-matched-folds=<n>] [--support-cases-file=<support_cases.json>] [--support-case-max-root-seeds=<n>] [--support-case-max-effective-root-seeds=<n>] [--support-case-min-root-overlap=<n>] [--support-case-min-prefix-overlap=<n>] [--support-case-prefix-depth-limit=<n>] [--support-case-min-donor-root-overlap=<n>] [--support-case-min-donor-prefix-overlap=<n>] [--support-case-donor-prefix-depth-limit=<n>] [--support-case-fail-if-root-scope-uncompressed=true|false] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--enable-diverse-catalog-selection=true] [--enable-mdl-catalog-selection=true] [--diverse-catalog-target-rules=<n>] [--diverse-novelty-weight=<n>] [--diverse-overlap-penalty-weight=<n>] [--diverse-anchor-family-penalty-weight=<n>] [--top-family-max-quota=<n>] [--mid-family-min-quota=<n>] [--low-family-min-quota=<n>] [--mdl-description-length-weight=<n>] [--mdl-overlap-penalty-weight=<n>] [--hit-count-mode=raw_row_count|day_capped_symbol_count] [--hit-count-day-symbol-cap=2]",
      )
    }
    assertPerfectPrototypeServerPaths({
      entries: [
        { label: "indexDir", filePath: indexDir },
        { label: "slotDir", filePath: slotDir },
      ],
      policy: serverPolicy,
      toolName: "mine_perfect_prototypes_indexed",
    })
    await runPersistentWorkerSlot({
      cwd,
      indexDir,
      slotDir,
      workerSlotIndex,
      baseOptions,
      serverPolicy,
    })
    return
  }

  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!outDir) {
    throw new Error(
      "Usage: node tools/mine_perfect_prototypes_indexed.mjs --index-dir=<dir> --out-dir=<dir> [--min-train-precision=1] [--max-train-hit-count=<n>] [--enable-train-matched-date-prune=true] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--enable-promotable-search-prune=true] [--enable-promotable-search-ordering=true] [--enable-year-hit-upper-bound-prune=true] [--core-years=2017,2018,...] [--excluded-boundary-years=2016] [--min-train-hits-per-core-year=<n>] [--promotable-min-train-matched-dates=<n>] [--promotable-min-train-matched-months=<n>] [--promotable-min-train-matched-folds=<n>] [--promotable-max-top1-date-hit-share=<0..1>] [--promotable-max-top3-date-hit-share=<0..1>] [--promotable-max-top1-fold-hit-share=<0..1>] [--promotable-max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true] [--enable-lane-stratified-mining=true] [--enable-family-scoped-mining=true] [--family-seed-max-top-bucket=<n>] [--family-seed-max-mid-bucket=<n>] [--family-seed-max-low-bucket=<n>] [--mid-family-min-share=<0..1>] [--low-family-min-share=<0..1>] [--low-family-min-train-matched-dates=<n>] [--low-family-min-train-matched-months=<n>] [--low-family-min-train-matched-folds=<n>] [--support-cases-file=<support_cases.json>] [--support-case-max-root-seeds=<n>] [--support-case-max-effective-root-seeds=<n>] [--support-case-min-root-overlap=<n>] [--support-case-min-prefix-overlap=<n>] [--support-case-prefix-depth-limit=<n>] [--support-case-min-donor-root-overlap=<n>] [--support-case-min-donor-prefix-overlap=<n>] [--support-case-donor-prefix-depth-limit=<n>] [--support-case-fail-if-root-scope-uncompressed=true|false] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--enable-diverse-catalog-selection=true] [--enable-mdl-catalog-selection=true] [--diverse-catalog-target-rules=<n>] [--diverse-novelty-weight=<n>] [--diverse-overlap-penalty-weight=<n>] [--diverse-anchor-family-penalty-weight=<n>] [--top-family-max-quota=<n>] [--mid-family-min-quota=<n>] [--low-family-min-quota=<n>] [--mdl-description-length-weight=<n>] [--mdl-overlap-penalty-weight=<n>] [--hit-count-mode=raw_row_count|day_capped_symbol_count] [--hit-count-day-symbol-cap=2]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "indexDir", filePath: indexDir },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "mine_perfect_prototypes_indexed",
  })

  await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir,
    options: {
      ...baseOptions,
      tokenizerOptions: {
        enableIntervalAtoms: baseOptions.enableIntervalAtoms === true,
        enableMacroAtoms: baseOptions.enableMacroAtoms === true,
        enableSupportAnchorAtoms: baseOptions.enableSupportAnchorAtoms === true,
        enableSupportManifoldSignature: baseOptions.enableSupportManifoldSignature === true,
        enableSupportMetricFeatures: baseOptions.enableSupportMetricFeatures === true,
        enableAdaptiveThresholdAtoms: baseOptions.enableAdaptiveThresholdAtoms === true,
      },
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
