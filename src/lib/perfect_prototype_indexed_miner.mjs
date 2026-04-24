import path from "node:path"
import crypto from "node:crypto"

import {
  buildPerfectPrototypeCatalog,
  buildPerfectPrototypeCoverageReport,
} from "./perfect_prototype_catalog.mjs"
import {
  buildPerfectPrototypeCatalogManifest,
  resolvePerfectPrototypeCatalogManifestPath,
} from "./perfect_prototype_catalog_manifest.mjs"
import { dedupePerfectPrototypeMatches } from "./perfect_prototype_dedupe.mjs"
import {
  ensureDir,
  pathExists,
  readJson,
  readJsonIfExistsStrict,
  writeJson,
  writeJsonAtomic,
  writeJsonl,
} from "./io.mjs"
import {
  buildNegativeSeparationReport,
  mergeSortedIndexCollections,
  normalizeMinerOptions,
  resolvePerfectPrototypeCollectionMode,
  resolveFamilySpecificBreadthMinimums,
  resolveFamilySpecificSearchMinHitCount,
  safeRate,
} from "./perfect_prototype_miner.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA,
  loadPerfectPrototypeTokenDictionaryEntriesByTokens,
  PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE,
  PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  streamPerfectPrototypeTokenDictionaryEntries,
} from "./perfect_prototype_token_index.mjs"
import { PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE } from "./perfect_prototype_stepb_exact_index.mjs"
import { validatePerfectPrototypeIndexProvenance } from "./perfect_prototype_index_provenance.mjs"
import { assertPerfectPrototypeTokenizerSpecIntegrity } from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import { streamSelectPerfectPrototypeSeedEntries } from "./perfect_prototype_seed_selector.mjs"
import {
  createPerfectPrototypeBitsetRowsetFromWords,
  createPerfectPrototypeRowset,
  createPerfectPrototypeSparseRowset,
  getPerfectPrototypeRowsetRuntimeStats,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsetsPrepared,
  intersectPerfectPrototypeRowsets,
  intersectPerfectPrototypeRowsetsCountBatch,
  intersectPerfectPrototypeRowsetsCount,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
  resetPerfectPrototypeRowsetRuntimeStats,
  shouldPreferDensePerfectPrototypeRowset,
  summarizePerfectPrototypeRowsetMode,
} from "./perfect_prototype_rowset.mjs"
import { loadPerfectPrototypeRowTokenAdjacency } from "./perfect_prototype_row_token_index.mjs"
import {
  createPerfectPrototypeTopKHitTracker,
  evaluatePerfectPrototypePromotableUpperBoundGuard,
  resolvePerfectPrototypeEffectiveKthHitFloor,
  shouldPrunePerfectPrototypeStateByTopKBound,
} from "./perfect_prototype_search_bounds.mjs"
import { createPerfectPrototypeSearchStateCache } from "./perfect_prototype_search_state_cache.mjs"
import { createPerfectPrototypeRowsetModeStatsShape } from "./perfect_prototype_rowset_mode_stats_schema.mjs"
import {
  decodePerfectPrototypeDeltaPostingsToBitset,
  openPerfectPrototypePostingsFile,
  readPerfectPrototypePostingBufferFromFile,
  readPerfectPrototypeDeltaPostingsFromFile,
} from "./perfect_prototype_postings_codec.mjs"
import {
  PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME,
  writePerfectPrototypeLivePartialRulesSnapshot,
  writePerfectPrototypePartialRulesParquet,
} from "./perfect_prototype_partial_rule_codec.mjs"
import { normalizePerfectPrototypeDatasetContract } from "./perfect_prototype_prejump_contract.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
} from "./perfect_prototype_contextual_features.mjs"
import { buildRecentImpulseUniverseId } from "./perfect_prototype_multiline_contract.mjs"
import {
  buildPerfectPrototypeChronologicalFoldLookup,
  buildPerfectPrototypeMatchedDateSignatureHash,
  buildPerfectPrototypeMonthKey,
  buildPerfectPrototypeQuarterKey,
  buildPerfectPrototypeRuleId,
  evaluatePerfectPrototypeTrainDateBreadthGuards,
  PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
  PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  pickCanonicalPerfectPrototypeSameSignatureWinner,
  computePerfectPrototypeGapStatsFromCalendarIndexes,
  resolvePerfectPrototypeHitCountDaySymbolCap,
  resolvePerfectPrototypeHitCountMode,
  rankPerfectPrototypeRules,
  selectTopPerfectPrototypeRulesDeterministically,
} from "./perfect_prototype_rule.mjs"
import {
  buildPerfectPrototypeYearHitCountsFromHitDates,
  evaluatePerfectPrototypeYearHitUpperBoundGuard,
  evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts,
} from "./perfect_prototype_year_hit_guard.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS,
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_MINING_IDS,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_SEED_BUCKET,
  PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_SEED_BUCKET,
  PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_SEED_BUCKET,
  buildPerfectPrototypeRecentOnlyMiningFamilyIdSet,
  buildPerfectPrototypeRecentOnlyFamilyScopeSpec,
  buildPerfectPrototypeRecentOnlyFamilyRootTokens,
  buildPerfectPrototypeSupportCaseTargetedRootTokenSet,
  classifyPerfectPrototypeSeedFamilyBucket,
  evaluatePerfectPrototypeRuleFamilyPurity,
  getPerfectPrototypeRecentOnlyFamilyRootStageMaxExistingRuleTokenCount,
  inferPerfectPrototypeRuleFamilyId,
  isPerfectPrototypeContinuationFamilyRootTokenAllowed,
  isPerfectPrototypeContinuationFamilyId,
  isPerfectPrototypeSupportCaseTargetedFamilyId,
  scorePerfectPrototypeContinuationFamilyRootTokenPriority,
} from "./perfect_prototype_rule_family_spec.mjs"
import {
  buildPerfectPrototypeSupportCaseFamilyLookup,
  evaluatePerfectPrototypeRuleSupportCases,
} from "./perfect_prototype_support_case.mjs"
import {
  buildPerfectPrototypeLowGapTopSubgroupBundleManifests,
  classifyPerfectPrototypeLowGapTopGeneralizedRootAxis,
  isPerfectPrototypeLowGapTopFpRiskToken,
  isPerfectPrototypeLowGapTopGeneralizedRootToken,
  scorePerfectPrototypeLowGapTopSubgroupCandidate,
  shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass,
} from "./perfect_prototype_subgroup_prepass.mjs"
import { buildPerfectPrototypeSubgroupManifestRecord } from "./perfect_prototype_subgroup_manifest.mjs"
import { materializePerfectPrototypeSubgroupExactEntryState } from "./perfect_prototype_subgroup_exact_entry.mjs"
import {
  solvePerfectPrototypeExactCompletion,
  solvePerfectPrototypeExactCompletionFrontier,
} from "./perfect_prototype_exact_completion_solver.mjs"
import { solvePerfectPrototypeJointFeasibility } from "./perfect_prototype_joint_feasibility_solver.mjs"
import {
  applyPerfectPrototypeTemporalSignatureCaps,
  selectDiversePerfectPrototypeRules,
} from "./perfect_prototype_catalog_diversify.mjs"
import { selectPerfectPrototypeMdlRules } from "./perfect_prototype_catalog_mdl.mjs"

export const PERFECT_PROTOTYPE_STEPB_EXACT_ROW_PROJECTED_CANDIDATE_THRESHOLD_DEFAULT = 128
import { resolvePerfectPrototypeSourceRunId } from "./perfect_prototype_catalog_freeze.mjs"

const hasConfiguredOptionalPositiveInteger = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return false
  const numeric = Math.floor(Number(value))
  return Number.isInteger(numeric) && numeric > 0
}

const resolveConfiguredOptionalFiniteNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const compareNumbersDesc = (left, right) => Number(right) - Number(left)

const compareNumbersAsc = (left, right) => Number(left) - Number(right)

const PERFECT_PROTOTYPE_INDEXED_FAMILY_DISTRIBUTION_TOKENS = Object.freeze([
  "tag:stepa.lane:same_day_high8",
  "tag:stepa.lane:recent_impulse_1d",
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  "tag:xsec.closeRank:TOP",
  "tag:xsec.closeRank:HIGH",
  "tag:xsec.closeRank:MID",
  "tag:xsec.closeRank:LOW",
  "tag:xsecLane.closeRank:TOP",
  "tag:xsecLane.closeRank:HIGH",
  "tag:xsecLane.closeRank:MID",
  "tag:xsecLane.closeRank:LOW",
  "tag:xsecLane.pool:THIN_POOL",
])

const PERFECT_PROTOTYPE_INDEXED_FAMILY_ROOT_SCOPE_DEFINITIONS = Object.freeze([
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_BREAKOUT,
    rootTokens: ["tag:stepa.lane:same_day_high8", "tag:xsec.closeRank:TOP"],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:TOP"],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:MID"],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:LOW"],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:LOW", PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:LOW", PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN],
  },
  {
    familyId: PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
    rootTokens: ["tag:stepa.lane:recent_impulse_1d", "tag:xsec.closeRank:LOW", PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN],
  },
])

const PERFECT_PROTOTYPE_RECENT_ONLY_CONTINUATION_DISCOVERY_UNIVERSE_ID = buildRecentImpulseUniverseId(1)

const isPerfectPrototypeRecentOnlyContinuationContext = ({ cfg, datasetContract }) =>
  String(cfg?.surfaceName ?? "").trim().toLowerCase() ===
    PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE &&
  String(datasetContract?.discoveryUniverseId ?? "").trim() ===
    PERFECT_PROTOTYPE_RECENT_ONLY_CONTINUATION_DISCOVERY_UNIVERSE_ID

export const shouldRequirePerfectPrototypeIndexedLaneMeta = ({
  cfg,
  datasetContract,
} = {}) =>
  cfg?.enableLaneStratifiedMining === true ||
  isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })

const buildPerfectPrototypeFilteredRowsetExcluding = ({
  baseRowset,
  excludedRowset,
  universeSize,
}) => {
  if (!baseRowset) return null
  if (!excludedRowset || getPerfectPrototypeRowsetCount(excludedRowset) < 1) {
    return baseRowset
  }
  const excluded = new Set(materializePerfectPrototypeRowsetValues(excludedRowset))
  const filtered = []
  for (const rowIndex of materializePerfectPrototypeRowsetValues(baseRowset)) {
    if (excluded.has(rowIndex)) continue
    filtered.push(rowIndex)
  }
  return createPerfectPrototypeRowset({
    values: filtered,
    universeSize,
    allowDense: true,
  })
}

const buildPerfectPrototypeFilteredRowsetByPredicate = ({
  baseRowset,
  universeSize,
  predicate,
}) => {
  if (!baseRowset) return null
  if (typeof predicate !== "function") return baseRowset
  const filtered = []
  for (const rawRowIndex of materializePerfectPrototypeRowsetValues(baseRowset)) {
    const rowIndex = Number(rawRowIndex)
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue
    if (!predicate(rowIndex)) continue
    filtered.push(rowIndex)
  }
  return createPerfectPrototypeRowset({
    values: filtered,
    universeSize,
    allowDense: true,
  })
}

const buildPerfectPrototypeRootScopeTokenDiagnostics = async ({
  familyId,
  rootTokens,
  familyRootScopePostingCache,
}) => {
  const diagnostics = {}
  for (const token of Array.isArray(rootTokens) ? rootTokens : []) {
    const positiveRowset = await familyRootScopePostingCache?.getPositiveRowset(token)
    diagnostics[token] = {
      available: !!positiveRowset,
      positiveRowCount: positiveRowset ? getPerfectPrototypeRowsetCount(positiveRowset) : 0,
    }
  }
  return {
    familyId: String(familyId ?? "").trim() || null,
    rootTokens: Array.isArray(rootTokens) ? rootTokens.slice() : [],
    tokens: diagnostics,
  }
}

const buildPerfectPrototypeRecentOnlyFamilyScopePostingTokens = () =>
  uniqueSorted(
    PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.flatMap((familyId) => {
      const scopeSpec = buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId)
      return [...scopeSpec.requiredPositiveTokens, ...scopeSpec.excludedPositiveTokens]
    }),
  )

const comparePerfectPrototypeRootSeedCandidates = (left, right) => {
  if (Number(right?.priority ?? 0) !== Number(left?.priority ?? 0)) {
    return Number(right?.priority ?? 0) - Number(left?.priority ?? 0)
  }
  if (Number(right?.precision ?? 0) !== Number(left?.precision ?? 0)) {
    return Number(right?.precision ?? 0) - Number(left?.precision ?? 0)
  }
  if (Number(right?.positiveCount ?? 0) !== Number(left?.positiveCount ?? 0)) {
    return Number(right?.positiveCount ?? 0) - Number(left?.positiveCount ?? 0)
  }
  if (Number(left?.negativeCount ?? 0) !== Number(right?.negativeCount ?? 0)) {
    return Number(left?.negativeCount ?? 0) - Number(right?.negativeCount ?? 0)
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const comparePerfectPrototypeRecentOnlyRootSeedCandidates = (left, right) => {
  if (Number(right?.subgroupQualified ? 1 : 0) !== Number(left?.subgroupQualified ? 1 : 0)) {
    return Number(right?.subgroupQualified ? 1 : 0) - Number(left?.subgroupQualified ? 1 : 0)
  }
  if (Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) !== Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) - Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(right?.subgroupDistinctDateCount ?? 0) !== Number(left?.subgroupDistinctDateCount ?? 0)) {
    return Number(right?.subgroupDistinctDateCount ?? 0) - Number(left?.subgroupDistinctDateCount ?? 0)
  }
  if (Number(right?.subgroupMatchedMonthCount ?? 0) !== Number(left?.subgroupMatchedMonthCount ?? 0)) {
    return Number(right?.subgroupMatchedMonthCount ?? 0) - Number(left?.subgroupMatchedMonthCount ?? 0)
  }
  if (Number(right?.subgroupMatchedFoldCount ?? 0) !== Number(left?.subgroupMatchedFoldCount ?? 0)) {
    return Number(right?.subgroupMatchedFoldCount ?? 0) - Number(left?.subgroupMatchedFoldCount ?? 0)
  }
  if (Number(right?.priority ?? 0) !== Number(left?.priority ?? 0)) {
    return Number(right?.priority ?? 0) - Number(left?.priority ?? 0)
  }
  if (Number(right?.donorTokenMatch ?? 0) !== Number(left?.donorTokenMatch ?? 0)) {
    return Number(right?.donorTokenMatch ?? 0) - Number(left?.donorTokenMatch ?? 0)
  }
  if (Number(right?.supportCaseTokenMatch ?? 0) !== Number(left?.supportCaseTokenMatch ?? 0)) {
    return Number(right?.supportCaseTokenMatch ?? 0) - Number(left?.supportCaseTokenMatch ?? 0)
  }
  if (Number(right?.cohortConcentration ?? 0) !== Number(left?.cohortConcentration ?? 0)) {
    return Number(right?.cohortConcentration ?? 0) - Number(left?.cohortConcentration ?? 0)
  }
  if (Number(right?.cohortCoverageShare ?? 0) !== Number(left?.cohortCoverageShare ?? 0)) {
    return Number(right?.cohortCoverageShare ?? 0) - Number(left?.cohortCoverageShare ?? 0)
  }
  if (Number(right?.precision ?? 0) !== Number(left?.precision ?? 0)) {
    return Number(right?.precision ?? 0) - Number(left?.precision ?? 0)
  }
  if (Number(left?.outsideCohortPositiveCount ?? 0) !== Number(right?.outsideCohortPositiveCount ?? 0)) {
    return Number(left?.outsideCohortPositiveCount ?? 0) - Number(right?.outsideCohortPositiveCount ?? 0)
  }
  if (Number(left?.negativeCount ?? 0) !== Number(right?.negativeCount ?? 0)) {
    return Number(left?.negativeCount ?? 0) - Number(right?.negativeCount ?? 0)
  }
  if (Number(right?.positiveCount ?? 0) !== Number(left?.positiveCount ?? 0)) {
    return Number(right?.positiveCount ?? 0) - Number(left?.positiveCount ?? 0)
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const countPerfectPrototypeTokenSetOverlap = ({
  tokens,
  tokenSet,
}) => {
  if (!(tokenSet instanceof Set) || tokenSet.size < 1) {
    return 0
  }
  let overlapCount = 0
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (tokenSet.has(token)) {
      overlapCount += 1
    }
  }
  return overlapCount
}

const countPerfectPrototypeSupportCaseTokenOverlap = ({
  tokens,
  supportCaseTokenSet,
}) =>
  countPerfectPrototypeTokenSetOverlap({
    tokens,
    tokenSet: supportCaseTokenSet,
  })

const evaluatePerfectPrototypeSupportCasePrefixExpansion = ({
  cfg,
  familyId,
  tokens,
  candidateToken,
  supportCaseTokenSet,
}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (
    !isPerfectPrototypeSupportCaseTargetedFamilyId(normalizedFamilyId) ||
    !(supportCaseTokenSet instanceof Set) ||
    supportCaseTokenSet.size < 1
  ) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const minPrefixOverlap = Math.max(
    0,
    Number(cfg?.supportCaseMinPrefixOverlap ?? 0) || 0,
  )
  const prefixDepthLimit = Math.max(
    0,
    Number(cfg?.supportCasePrefixDepthLimit ?? 0) || 0,
  )
  if (minPrefixOverlap < 1 || prefixDepthLimit < 1) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const nextTokenCount = Math.max(0, (Array.isArray(tokens) ? tokens.length : 0) + 1)
  if (nextTokenCount > prefixDepthLimit) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const currentOverlap = countPerfectPrototypeSupportCaseTokenOverlap({
    tokens,
    supportCaseTokenSet,
  })
  const nextOverlap =
    currentOverlap + (supportCaseTokenSet.has(candidateToken) ? 1 : 0)
  const requiredOverlap = Math.min(minPrefixOverlap, nextTokenCount)
  return {
    ok: nextOverlap >= requiredOverlap,
    requiredOverlap,
    nextOverlap,
  }
}

const evaluatePerfectPrototypeSupportCaseDonorPrefixExpansion = ({
  cfg,
  familyId,
  tokens,
  candidateToken,
  donorTokenSet,
}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (
    !isPerfectPrototypeSupportCaseTargetedFamilyId(normalizedFamilyId) ||
    !(donorTokenSet instanceof Set) ||
    donorTokenSet.size < 1
  ) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const minPrefixOverlap = Math.max(
    0,
    Number(cfg?.supportCaseMinDonorPrefixOverlap ?? 0) || 0,
  )
  const prefixDepthLimit = Math.max(
    0,
    Number(cfg?.supportCaseDonorPrefixDepthLimit ?? 0) || 0,
  )
  if (minPrefixOverlap < 1 || prefixDepthLimit < 1) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const nextTokenCount = Math.max(0, (Array.isArray(tokens) ? tokens.length : 0) + 1)
  if (nextTokenCount > prefixDepthLimit) {
    return { ok: true, requiredOverlap: 0, nextOverlap: 0 }
  }
  const currentOverlap = countPerfectPrototypeTokenSetOverlap({
    tokens,
    tokenSet: donorTokenSet,
  })
  const nextOverlap = currentOverlap + (donorTokenSet.has(candidateToken) ? 1 : 0)
  const requiredOverlap = Math.min(minPrefixOverlap, nextTokenCount)
  return {
    ok: nextOverlap >= requiredOverlap,
    requiredOverlap,
    nextOverlap,
  }
}

const evaluatePerfectPrototypeGeneralizedSubgroupPrefixExpansion = ({
  cfg,
  familyId,
  tokens,
  candidateToken,
  generalizedSubgroupBundleTokenSet = null,
}) => {
  const normalizedFamilyId = String(familyId ?? "").trim()
  if (
    !shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
      familyId: normalizedFamilyId,
      enabled: cfg?.enableSubgroupPrepass === true,
    })
  ) {
    return { ok: true, enforced: false, prefixDepthLimit: 0 }
  }
  const prefixDepthLimit = Math.max(
    0,
    getPerfectPrototypeRecentOnlyFamilyRootStageMaxExistingRuleTokenCount(normalizedFamilyId),
  )
  if (prefixDepthLimit < 1) {
    return { ok: true, enforced: false, prefixDepthLimit: 0 }
  }
  const nextTokenCount = Math.max(0, (Array.isArray(tokens) ? tokens.length : 0) + 1)
  if (nextTokenCount > prefixDepthLimit) {
    return { ok: true, enforced: false, prefixDepthLimit }
  }
  const bundleTokenSet =
    generalizedSubgroupBundleTokenSet instanceof Set && generalizedSubgroupBundleTokenSet.size > 0
      ? generalizedSubgroupBundleTokenSet
      : null
  const bundlePrefixDepthLimit = bundleTokenSet ? Math.min(prefixDepthLimit, bundleTokenSet.size) : 0
  if (bundleTokenSet && nextTokenCount <= bundlePrefixDepthLimit) {
    return {
      ok: bundleTokenSet.has(candidateToken),
      enforced: true,
      prefixDepthLimit,
      bundlePrefixDepthLimit,
    }
  }
  return {
    ok:
      isPerfectPrototypeLowGapTopGeneralizedRootToken(candidateToken) &&
      !isPerfectPrototypeLowGapTopFpRiskToken(candidateToken),
    enforced: true,
    prefixDepthLimit,
    bundlePrefixDepthLimit,
  }
}

const evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor = ({
  cfg,
  familyId,
  distinctDateCount,
  matchedMonthCount,
  matchedFoldCount,
  generalizedSubgroupBreadthFloor = null,
}) => {
  if (
    !shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
      familyId,
      enabled: cfg?.enableSubgroupPrepass === true,
    })
  ) {
    return { ok: true, enforced: false }
  }
  const minMatchedDates = Math.max(
    0,
    Number(
      generalizedSubgroupBreadthFloor?.minMatchedDates ??
        cfg?.subgroupMinMatchedDates ??
        0,
    ) || 0,
  )
  const minMatchedMonths = Math.max(
    0,
    Number(
      generalizedSubgroupBreadthFloor?.minMatchedMonths ??
        cfg?.subgroupMinMatchedMonths ??
        0,
    ) || 0,
  )
  const minMatchedFolds = Math.max(
    0,
    Number(
      generalizedSubgroupBreadthFloor?.minMatchedFolds ??
        cfg?.subgroupMinMatchedFolds ??
        0,
    ) || 0,
  )
  const coverMatchedDates = Math.max(
    0,
    Number(generalizedSubgroupBreadthFloor?.coverMatchedDates ?? 0) || 0,
  )
  const coverMatchedMonths = Math.max(
    0,
    Number(generalizedSubgroupBreadthFloor?.coverMatchedMonths ?? 0) || 0,
  )
  const coverMatchedFolds = Math.max(
    0,
    Number(generalizedSubgroupBreadthFloor?.coverMatchedFolds ?? 0) || 0,
  )
  const dateRetentionRatio = Math.max(
    0,
    Math.min(1, Number(generalizedSubgroupBreadthFloor?.earlyDateRetentionRatio ?? 0.6) || 0.6),
  )
  const monthRetentionRatio = Math.max(
    0,
    Math.min(1, Number(generalizedSubgroupBreadthFloor?.earlyMonthRetentionRatio ?? 0.75) || 0.75),
  )
  const foldRetentionRatio = Math.max(
    0,
    Math.min(1, Number(generalizedSubgroupBreadthFloor?.earlyFoldRetentionRatio ?? 0.75) || 0.75),
  )
  const effectiveMinMatchedDates =
    coverMatchedDates > 0 ? Math.max(1, Math.ceil(coverMatchedDates * dateRetentionRatio)) : minMatchedDates
  const effectiveMinMatchedMonths =
    coverMatchedMonths > 0 ? Math.max(1, Math.ceil(coverMatchedMonths * monthRetentionRatio)) : minMatchedMonths
  const effectiveMinMatchedFolds =
    coverMatchedFolds > 0 ? Math.max(1, Math.ceil(coverMatchedFolds * foldRetentionRatio)) : minMatchedFolds
  if (effectiveMinMatchedDates > 0 && Number(distinctDateCount ?? 0) < effectiveMinMatchedDates) {
    return { ok: false, enforced: true, reason: "subgroupMatchedDatesBelowFloor" }
  }
  if (effectiveMinMatchedMonths > 0 && Number(matchedMonthCount ?? 0) < effectiveMinMatchedMonths) {
    return { ok: false, enforced: true, reason: "subgroupMatchedMonthsBelowFloor" }
  }
  if (effectiveMinMatchedFolds > 0 && Number(matchedFoldCount ?? 0) < effectiveMinMatchedFolds) {
    return { ok: false, enforced: true, reason: "subgroupMatchedFoldsBelowFloor" }
  }
  return {
    ok: true,
    enforced:
      effectiveMinMatchedDates > 0 ||
      effectiveMinMatchedMonths > 0 ||
      effectiveMinMatchedFolds > 0,
  }
}

const shouldUsePerfectPrototypeCounterexampleExactCompletion = ({
  cfg,
  familyId,
  generalizedSubgroupManifest,
} = {}) =>
  cfg?.enableExactCompletionSolver === true &&
  generalizedSubgroupManifest &&
  String(familyId ?? "").trim() === PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION &&
  shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
    familyId,
    enabled: cfg?.enableSubgroupPrepass === true,
  })

const shouldUsePerfectPrototypeJointFeasibilitySolver = ({
  cfg,
  familyId,
  generalizedSubgroupManifest,
} = {}) =>
  shouldUsePerfectPrototypeCounterexampleExactCompletion({
    cfg,
    familyId,
    generalizedSubgroupManifest,
  }) &&
  cfg?.enableJointFeasibilitySolver === true &&
  String(cfg?.exactCompletionMode ?? "").trim() === "joint_feasibility"

const loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens = async ({
  cwd,
  duckdb,
  tokenDictionaryParquetPath,
  tokens,
}) => {
  const entriesByToken = new Map()
  for (const token of uniqueSorted(tokens)) {
    try {
      const loaded = await loadPerfectPrototypeTokenDictionaryEntriesByTokens({
        cwd,
        duckdb,
        tokenDictionaryParquetPath,
        tokens: [token],
        expectedUniqueTokenCount: 1,
      })
      if (loaded.has(token)) {
        entriesByToken.set(token, loaded.get(token))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (!reason.includes("selected token count mismatch")) {
        throw error
      }
    }
  }
  return entriesByToken
}

const createOptionalTokenPostingCache = ({
  postingsHandle,
  dictionaryEntriesByToken,
  rowUniverseSize,
}) => {
  const orderedTokens = Array.from(dictionaryEntriesByToken.keys())
  const tokenIndexByToken = new Map(orderedTokens.map((token, index) => [token, index]))
  const postingCache = createSeedPostingCache({
    postingsHandle,
    seedDictionaryEntries: orderedTokens.map((token) => dictionaryEntriesByToken.get(token)),
    rowUniverseSize,
    maxEntries: Math.max(16, orderedTokens.length),
  })
  return {
    async getPositiveRowset(token) {
      const tokenIndex = tokenIndexByToken.get(String(token ?? "").trim())
      if (!Number.isInteger(tokenIndex) || tokenIndex < 0) return null
      return postingCache.getSeedPositiveRowset(tokenIndex)
    },
    async getNegativeRowset(token) {
      const tokenIndex = tokenIndexByToken.get(String(token ?? "").trim())
      if (!Number.isInteger(tokenIndex) || tokenIndex < 0) return null
      return postingCache.getSeedNegativeRowset(tokenIndex)
    },
  }
}

const buildPerfectPrototypeIndexedFamilyDistributionStats = async ({
  positiveRowset,
  positiveRowCount,
  distributionPostingCache = null,
}) => {
  const normalizedPositiveRowCount = Math.max(0, Number(positiveRowCount ?? 0) || 0)
  if (!distributionPostingCache || normalizedPositiveRowCount < 1 || !positiveRowset) {
    return {
      matchedGlobalTopCount: 0,
      matchedGlobalHighCount: 0,
      matchedGlobalMidCount: 0,
      matchedGlobalLowCount: 0,
      matchedGlobalTopShare: 0,
      matchedGlobalHighShare: 0,
      matchedGlobalMidShare: 0,
      matchedGlobalLowShare: 0,
      matchedLaneTopCount: 0,
      matchedLaneHighCount: 0,
      matchedLaneMidCount: 0,
      matchedLaneLowCount: 0,
      matchedLaneTopShare: 0,
      matchedLaneHighShare: 0,
      matchedLaneMidShare: 0,
      matchedLaneLowShare: 0,
      matchedLaneThinPoolCount: 0,
      matchedLaneThinPoolShare: 0,
      matchedSameDayHigh8Count: 0,
      matchedSameDayHigh8Share: 0,
      matchedRecentImpulse1dCount: 0,
      matchedRecentImpulse1dShare: 0,
      matchedGapRankTopCount: 0,
      matchedGapRankTopShare: 0,
      matchedGapRankHighCount: 0,
      matchedGapRankHighShare: 0,
      matchedJumpVsMedianBelowCount: 0,
      matchedJumpVsMedianBelowShare: 0,
    }
  }
  const countIntersection = async (token) => {
    const tokenRowset = await distributionPostingCache.getPositiveRowset(token)
    if (!tokenRowset) return 0
    return intersectPerfectPrototypeRowsetsCount(positiveRowset, tokenRowset)
  }
  const matchedGlobalTopCount = await countIntersection("tag:xsec.closeRank:TOP")
  const matchedGlobalHighCount = await countIntersection("tag:xsec.closeRank:HIGH")
  const matchedGlobalMidCount = await countIntersection("tag:xsec.closeRank:MID")
  const matchedGlobalLowCount = await countIntersection("tag:xsec.closeRank:LOW")
  const matchedLaneTopCount = await countIntersection("tag:xsecLane.closeRank:TOP")
  const matchedLaneHighCount = await countIntersection("tag:xsecLane.closeRank:HIGH")
  const matchedLaneMidCount = await countIntersection("tag:xsecLane.closeRank:MID")
  const matchedLaneLowCount = await countIntersection("tag:xsecLane.closeRank:LOW")
  const matchedLaneThinPoolCount = await countIntersection("tag:xsecLane.pool:THIN_POOL")
  const matchedSameDayHigh8Count = await countIntersection("tag:stepa.lane:same_day_high8")
  const matchedRecentImpulse1dCount = await countIntersection("tag:stepa.lane:recent_impulse_1d")
  const matchedGapRankTopCount = await countIntersection(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN)
  const matchedGapRankHighCount = await countIntersection(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN)
  const matchedJumpVsMedianBelowCount = await countIntersection(
    PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  )
  return {
    matchedGlobalTopCount,
    matchedGlobalHighCount,
    matchedGlobalMidCount,
    matchedGlobalLowCount,
    matchedGlobalTopShare: safeRate(matchedGlobalTopCount, normalizedPositiveRowCount),
    matchedGlobalHighShare: safeRate(matchedGlobalHighCount, normalizedPositiveRowCount),
    matchedGlobalMidShare: safeRate(matchedGlobalMidCount, normalizedPositiveRowCount),
    matchedGlobalLowShare: safeRate(matchedGlobalLowCount, normalizedPositiveRowCount),
    matchedLaneTopCount,
    matchedLaneHighCount,
    matchedLaneMidCount,
    matchedLaneLowCount,
    matchedLaneTopShare: safeRate(matchedLaneTopCount, normalizedPositiveRowCount),
    matchedLaneHighShare: safeRate(matchedLaneHighCount, normalizedPositiveRowCount),
    matchedLaneMidShare: safeRate(matchedLaneMidCount, normalizedPositiveRowCount),
    matchedLaneLowShare: safeRate(matchedLaneLowCount, normalizedPositiveRowCount),
    matchedLaneThinPoolCount,
    matchedLaneThinPoolShare: safeRate(matchedLaneThinPoolCount, normalizedPositiveRowCount),
    matchedSameDayHigh8Count,
    matchedSameDayHigh8Share: safeRate(matchedSameDayHigh8Count, normalizedPositiveRowCount),
    matchedRecentImpulse1dCount,
    matchedRecentImpulse1dShare: safeRate(matchedRecentImpulse1dCount, normalizedPositiveRowCount),
    matchedGapRankTopCount,
    matchedGapRankTopShare: safeRate(matchedGapRankTopCount, normalizedPositiveRowCount),
    matchedGapRankHighCount,
    matchedGapRankHighShare: safeRate(matchedGapRankHighCount, normalizedPositiveRowCount),
    matchedJumpVsMedianBelowCount,
    matchedJumpVsMedianBelowShare: safeRate(
      matchedJumpVsMedianBelowCount,
      normalizedPositiveRowCount,
    ),
  }
}

const incrementFamilyCounter = (summary, key, familyId, delta = 1) => {
  if (!summary || !key) return
  const normalizedFamilyId = String(familyId ?? "").trim() || "unclassified"
  summary[key] = summary[key] && typeof summary[key] === "object" ? summary[key] : {}
  summary[key][normalizedFamilyId] = Number(summary[key][normalizedFamilyId] ?? 0) + Number(delta ?? 1)
}

const incrementNestedReasonCounter = (summary, key, reason, delta = 1) => {
  if (!summary || !key) return
  const normalizedReason = String(reason ?? "").trim() || "unknown"
  summary[key] = summary[key] && typeof summary[key] === "object" ? summary[key] : {}
  summary[key][normalizedReason] =
    Number(summary[key][normalizedReason] ?? 0) + Number(delta ?? 1)
}

const incrementFamilyReasonCounter = (summary, key, familyId, reason, delta = 1) => {
  if (!summary || !key) return
  const normalizedFamilyId = String(familyId ?? "").trim() || "unclassified"
  const normalizedReason = String(reason ?? "").trim() || "unknown"
  summary[key] = summary[key] && typeof summary[key] === "object" ? summary[key] : {}
  summary[key][normalizedFamilyId] =
    summary[key][normalizedFamilyId] && typeof summary[key][normalizedFamilyId] === "object"
      ? summary[key][normalizedFamilyId]
      : {}
  summary[key][normalizedFamilyId][normalizedReason] =
    Number(summary[key][normalizedFamilyId][normalizedReason] ?? 0) + Number(delta ?? 1)
}

const appendFamilyPreviewEntry = (summary, key, familyId, preview, maxEntries = 5) => {
  if (!summary || !key || !preview || typeof preview !== "object") return
  const normalizedFamilyId = String(familyId ?? "").trim() || "unclassified"
  summary[key] = summary[key] && typeof summary[key] === "object" ? summary[key] : {}
  summary[key][normalizedFamilyId] = Array.isArray(summary[key][normalizedFamilyId])
    ? summary[key][normalizedFamilyId]
    : []
  if (summary[key][normalizedFamilyId].length >= Math.max(1, Number(maxEntries) || 1)) return
  summary[key][normalizedFamilyId].push(preview)
}

const augmentIndexedCoverageTemporalMetrics = ({
  coverage,
  matchRows,
  calendarDateKeys = [],
  foldScheme = null,
}) => {
  const baseCoverage = coverage && typeof coverage === "object" ? { ...coverage } : {}
  const normalizedRows = Array.isArray(matchRows) ? matchRows : []
  const foldLookup = buildPerfectPrototypeChronologicalFoldLookup({
    calendarDateKeys,
    foldScheme,
  })
  const orderedCalendarDateKeys = uniqueSorted(calendarDateKeys)
  const foldKeyByDateKey = new Map()
  for (let index = 0; index < orderedCalendarDateKeys.length; index += 1) {
    const dateKey = String(orderedCalendarDateKeys[index] ?? "").trim()
    if (!dateKey) continue
    foldKeyByDateKey.set(dateKey, foldLookup.foldKeysByCalendarIndex[index] ?? null)
  }
  const matchedFoldKeys = uniqueSorted(
    normalizedRows
      .map((row) => foldKeyByDateKey.get(String(row?.dateKey ?? "").trim()) ?? null)
      .filter(Boolean),
  )
  baseCoverage.uniqueMatchedFolds = matchedFoldKeys.length
  return baseCoverage
}

const appendPerfectPrototypeToken = (tokens, token) => {
  const normalizedTokens = Array.isArray(tokens) ? tokens : []
  return [...normalizedTokens, token]
}

const compareIndexedAverageHitMassPerBucketAsc = ({
  leftPositiveCount,
  rightPositiveCount,
  leftBucketCount,
  rightBucketCount,
}) => {
  const leftAverage = Number(leftPositiveCount ?? 0) / Math.max(1, Number(leftBucketCount ?? 0))
  const rightAverage = Number(rightPositiveCount ?? 0) / Math.max(1, Number(rightBucketCount ?? 0))
  return compareNumbersAsc(leftAverage, rightAverage)
}

const compareIndexedPromotableBreadthTiebreak = ({
  candidateNextPositiveEffectiveCounts,
  candidateNextPositiveDistinctDateCounts,
  candidateNextPositiveDistinctMonthCounts,
  candidateNextPositiveDistinctQuarterCounts,
  candidateNextPositiveDistinctFoldCounts,
  leftIndex,
  rightIndex,
}) => {
  const distinctFoldCompare = compareNumbersDesc(
    candidateNextPositiveDistinctFoldCounts[leftIndex],
    candidateNextPositiveDistinctFoldCounts[rightIndex],
  )
  if (distinctFoldCompare !== 0) return distinctFoldCompare
  const distinctMonthCompare = compareNumbersDesc(
    candidateNextPositiveDistinctMonthCounts[leftIndex],
    candidateNextPositiveDistinctMonthCounts[rightIndex],
  )
  if (distinctMonthCompare !== 0) return distinctMonthCompare
  const distinctDateCompare = compareNumbersDesc(
    candidateNextPositiveDistinctDateCounts[leftIndex],
    candidateNextPositiveDistinctDateCounts[rightIndex],
  )
  if (distinctDateCompare !== 0) return distinctDateCompare
  const distinctQuarterCompare = compareNumbersDesc(
    candidateNextPositiveDistinctQuarterCounts[leftIndex],
    candidateNextPositiveDistinctQuarterCounts[rightIndex],
  )
  if (distinctQuarterCompare !== 0) return distinctQuarterCompare
  const avgPerFoldCompare = compareIndexedAverageHitMassPerBucketAsc({
    leftPositiveCount: candidateNextPositiveEffectiveCounts[leftIndex],
    rightPositiveCount: candidateNextPositiveEffectiveCounts[rightIndex],
    leftBucketCount: candidateNextPositiveDistinctFoldCounts[leftIndex],
    rightBucketCount: candidateNextPositiveDistinctFoldCounts[rightIndex],
  })
  if (avgPerFoldCompare !== 0) return avgPerFoldCompare
  return compareIndexedAverageHitMassPerBucketAsc({
    leftPositiveCount: candidateNextPositiveEffectiveCounts[leftIndex],
    rightPositiveCount: candidateNextPositiveEffectiveCounts[rightIndex],
    leftBucketCount: candidateNextPositiveDistinctDateCounts[leftIndex],
    rightBucketCount: candidateNextPositiveDistinctDateCounts[rightIndex],
  })
}

const compareIndexedCandidateEstimate = ({
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  preferPromotableBreadth = false,
  candidateTokenIndexes,
  candidateNextPositiveRawCounts,
  candidateNextPositiveEffectiveCounts,
  candidateNextPositiveDistinctDateCounts,
  candidateNextPositiveDistinctMonthCounts,
  candidateNextPositiveDistinctQuarterCounts,
  candidateNextPositiveDistinctFoldCounts,
  candidateNegativeDropEstimates,
  candidatePrecisionUpperBoundEstimates,
  candidatePositiveLosses,
  leftIndex,
  rightIndex,
}) => {
  if (hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE) {
    const effectivePositiveCompare = compareNumbersDesc(
      candidateNextPositiveEffectiveCounts[leftIndex],
      candidateNextPositiveEffectiveCounts[rightIndex],
    )
    if (effectivePositiveCompare !== 0) return effectivePositiveCompare
    const distinctDateCompare = compareNumbersDesc(
      candidateNextPositiveDistinctDateCounts[leftIndex],
      candidateNextPositiveDistinctDateCounts[rightIndex],
    )
    if (distinctDateCompare !== 0) return distinctDateCompare
    const distinctMonthCompare = compareNumbersDesc(
      candidateNextPositiveDistinctMonthCounts[leftIndex],
      candidateNextPositiveDistinctMonthCounts[rightIndex],
    )
    if (distinctMonthCompare !== 0) return distinctMonthCompare
    const distinctQuarterCompare = compareNumbersDesc(
      candidateNextPositiveDistinctQuarterCounts[leftIndex],
      candidateNextPositiveDistinctQuarterCounts[rightIndex],
    )
    if (distinctQuarterCompare !== 0) return distinctQuarterCompare
    const distinctFoldCompare = compareNumbersDesc(
      candidateNextPositiveDistinctFoldCounts[leftIndex],
      candidateNextPositiveDistinctFoldCounts[rightIndex],
    )
    if (distinctFoldCompare !== 0) return distinctFoldCompare
  }
  const negativeDropCompare = compareNumbersDesc(
    candidateNegativeDropEstimates[leftIndex],
    candidateNegativeDropEstimates[rightIndex],
  )
  if (negativeDropCompare !== 0) return negativeDropCompare
  const precisionCompare = compareNumbersDesc(
    candidatePrecisionUpperBoundEstimates[leftIndex],
    candidatePrecisionUpperBoundEstimates[rightIndex],
  )
  if (precisionCompare !== 0) return precisionCompare
  if (preferPromotableBreadth === true) {
    const promotableBreadthCompare = compareIndexedPromotableBreadthTiebreak({
      candidateNextPositiveEffectiveCounts,
      candidateNextPositiveDistinctDateCounts,
      candidateNextPositiveDistinctMonthCounts,
      candidateNextPositiveDistinctQuarterCounts,
      candidateNextPositiveDistinctFoldCounts,
      leftIndex,
      rightIndex,
    })
    if (promotableBreadthCompare !== 0) return promotableBreadthCompare
  }
  const positiveLossCompare = compareNumbersAsc(
    candidatePositiveLosses[leftIndex],
    candidatePositiveLosses[rightIndex],
  )
  if (positiveLossCompare !== 0) return positiveLossCompare
  const positiveCountCompare = compareNumbersDesc(
    candidateNextPositiveEffectiveCounts[leftIndex],
    candidateNextPositiveEffectiveCounts[rightIndex],
  )
  if (positiveCountCompare !== 0) return positiveCountCompare
  const rawPositiveCountCompare = compareNumbersDesc(
    candidateNextPositiveRawCounts[leftIndex],
    candidateNextPositiveRawCounts[rightIndex],
  )
  if (rawPositiveCountCompare !== 0) return rawPositiveCountCompare
  return compareNumbersAsc(candidateTokenIndexes[leftIndex], candidateTokenIndexes[rightIndex])
}

const compareIndexedCandidateExactHead = ({
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  preferPromotableBreadth = false,
  candidateTokenIndexes,
  candidateNextPositiveRawCounts,
  candidateNextPositiveEffectiveCounts,
  candidateNextPositiveDistinctDateCounts,
  candidateNextPositiveDistinctMonthCounts,
  candidateNextPositiveDistinctQuarterCounts,
  candidateNextPositiveDistinctFoldCounts,
  candidateNegativeDropEstimates,
  candidatePrecisionUpperBoundEstimates,
  candidatePositiveLosses,
  exactHeadNegativeDrops,
  exactHeadPrecisionUpperBounds,
  leftIndex,
  rightIndex,
}) => {
  if (hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE) {
    const effectivePositiveCompare = compareNumbersDesc(
      candidateNextPositiveEffectiveCounts[leftIndex],
      candidateNextPositiveEffectiveCounts[rightIndex],
    )
    if (effectivePositiveCompare !== 0) return effectivePositiveCompare
    const distinctDateCompare = compareNumbersDesc(
      candidateNextPositiveDistinctDateCounts[leftIndex],
      candidateNextPositiveDistinctDateCounts[rightIndex],
    )
    if (distinctDateCompare !== 0) return distinctDateCompare
    const distinctMonthCompare = compareNumbersDesc(
      candidateNextPositiveDistinctMonthCounts[leftIndex],
      candidateNextPositiveDistinctMonthCounts[rightIndex],
    )
    if (distinctMonthCompare !== 0) return distinctMonthCompare
    const distinctQuarterCompare = compareNumbersDesc(
      candidateNextPositiveDistinctQuarterCounts[leftIndex],
      candidateNextPositiveDistinctQuarterCounts[rightIndex],
    )
    if (distinctQuarterCompare !== 0) return distinctQuarterCompare
    const distinctFoldCompare = compareNumbersDesc(
      candidateNextPositiveDistinctFoldCounts[leftIndex],
      candidateNextPositiveDistinctFoldCounts[rightIndex],
    )
    if (distinctFoldCompare !== 0) return distinctFoldCompare
  }
  const negativeDropCompare = compareNumbersDesc(
    exactHeadNegativeDrops[leftIndex] ?? candidateNegativeDropEstimates[leftIndex] ?? 0,
    exactHeadNegativeDrops[rightIndex] ?? candidateNegativeDropEstimates[rightIndex] ?? 0,
  )
  if (negativeDropCompare !== 0) return negativeDropCompare
  const precisionCompare = compareNumbersDesc(
    exactHeadPrecisionUpperBounds[leftIndex] ??
      candidatePrecisionUpperBoundEstimates[leftIndex] ??
      0,
    exactHeadPrecisionUpperBounds[rightIndex] ??
      candidatePrecisionUpperBoundEstimates[rightIndex] ??
      0,
  )
  if (precisionCompare !== 0) return precisionCompare
  if (preferPromotableBreadth === true) {
    const promotableBreadthCompare = compareIndexedPromotableBreadthTiebreak({
      candidateNextPositiveEffectiveCounts,
      candidateNextPositiveDistinctDateCounts,
      candidateNextPositiveDistinctMonthCounts,
      candidateNextPositiveDistinctQuarterCounts,
      candidateNextPositiveDistinctFoldCounts,
      leftIndex,
      rightIndex,
    })
    if (promotableBreadthCompare !== 0) return promotableBreadthCompare
  }
  const positiveLossCompare = compareNumbersAsc(
    candidatePositiveLosses[leftIndex],
    candidatePositiveLosses[rightIndex],
  )
  if (positiveLossCompare !== 0) return positiveLossCompare
  const positiveCountCompare = compareNumbersDesc(
    candidateNextPositiveEffectiveCounts[leftIndex],
    candidateNextPositiveEffectiveCounts[rightIndex],
  )
  if (positiveCountCompare !== 0) return positiveCountCompare
  const rawPositiveCountCompare = compareNumbersDesc(
    candidateNextPositiveRawCounts[leftIndex],
    candidateNextPositiveRawCounts[rightIndex],
  )
  if (rawPositiveCountCompare !== 0) return rawPositiveCountCompare
  return compareNumbersAsc(candidateTokenIndexes[leftIndex], candidateTokenIndexes[rightIndex])
}

const buildIndexedCandidateAnchorFamilyKey = (token) => {
  const normalized = String(token ?? "").trim()
  if (!normalized) return null
  const lastSeparator = normalized.lastIndexOf(":")
  return lastSeparator < 0 ? normalized : normalized.slice(0, lastSeparator)
}

const normalizeIndexedLaneKey = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || "__unassigned__"
}

const compareIndexedLaneKeys = (left, right) => {
  const leftKey = normalizeIndexedLaneKey(left)
  const rightKey = normalizeIndexedLaneKey(right)
  if (leftKey === rightKey) return 0
  if (leftKey === "__unassigned__") return 1
  if (rightKey === "__unassigned__") return -1
  return leftKey.localeCompare(rightKey)
}

const buildIndexedLaneInterleavedSeedOrder = ({ seedDominantLaneIds = [] }) => {
  const laneBuckets = new Map()
  for (let seedIndex = 0; seedIndex < seedDominantLaneIds.length; seedIndex += 1) {
    const laneKey = normalizeIndexedLaneKey(seedDominantLaneIds[seedIndex])
    const bucket = laneBuckets.get(laneKey) ?? []
    bucket.push(seedIndex)
    laneBuckets.set(laneKey, bucket)
  }
  const orderedLaneKeys = Array.from(laneBuckets.keys()).sort(compareIndexedLaneKeys)
  const interleavedOrder = []
  let remaining = true
  let offset = 0
  while (remaining) {
    remaining = false
    for (const laneKey of orderedLaneKeys) {
      const bucket = laneBuckets.get(laneKey) ?? []
      if (offset >= bucket.length) continue
      interleavedOrder.push(bucket[offset])
      remaining = true
    }
    offset += 1
  }
  return {
    orderedLaneKeys,
    interleavedOrder,
    laneCounts: orderedLaneKeys.reduce((acc, laneKey) => {
      acc[laneKey] = Number(laneBuckets.get(laneKey)?.length ?? 0)
      return acc
    }, {}),
  }
}

const buildIndexedSeedDominantLaneIds = async ({
  seedCount = 0,
  getSeedPositiveRowset,
  rowStepALaneIds = [],
}) => {
  const dominantLaneIds = new Array(Math.max(0, Number(seedCount) || 0)).fill("__unassigned__")
  if (typeof getSeedPositiveRowset !== "function" || dominantLaneIds.length < 1) {
    return dominantLaneIds
  }
  for (let seedIndex = 0; seedIndex < dominantLaneIds.length; seedIndex += 1) {
    const positiveRowset = await getSeedPositiveRowset(seedIndex)
    const rowIndexes = materializePerfectPrototypeRowsetValues(positiveRowset)
    const laneCounts = new Map()
    for (const rawRowIndex of rowIndexes) {
      const rowIndex = Number(rawRowIndex)
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowStepALaneIds.length) continue
      const laneKey = normalizeIndexedLaneKey(rowStepALaneIds[rowIndex])
      laneCounts.set(laneKey, Number(laneCounts.get(laneKey) ?? 0) + 1)
    }
    let bestLaneKey = "__unassigned__"
    let bestLaneCount = -1
    for (const [laneKey, laneCount] of laneCounts.entries()) {
      if (
        laneCount > bestLaneCount ||
        (laneCount === bestLaneCount && compareIndexedLaneKeys(laneKey, bestLaneKey) < 0)
      ) {
        bestLaneKey = laneKey
        bestLaneCount = laneCount
      }
    }
    dominantLaneIds[seedIndex] = bestLaneKey
  }
  return dominantLaneIds
}

const applyIndexedDiverseCandidateOrdering = ({
  orderedCandidateIndexes,
  candidateTokenIndexes,
  seedTokensOrdered,
  seedPositiveMonthSignatureHashes = [],
  seedPositiveQuarterSignatureHashes = [],
  diverseBeamMaxPerMonthSignature = null,
  diverseBeamMaxPerQuarterSignature = null,
  diverseBeamMaxPerAnchorFamily = null,
}) => {
  const activeMonthLimit =
    Number.isInteger(Number(diverseBeamMaxPerMonthSignature)) &&
    Number(diverseBeamMaxPerMonthSignature) > 0
      ? Number(diverseBeamMaxPerMonthSignature)
      : null
  const activeQuarterLimit =
    Number.isInteger(Number(diverseBeamMaxPerQuarterSignature)) &&
    Number(diverseBeamMaxPerQuarterSignature) > 0
      ? Number(diverseBeamMaxPerQuarterSignature)
      : null
  const activeAnchorLimit =
    Number.isInteger(Number(diverseBeamMaxPerAnchorFamily)) &&
    Number(diverseBeamMaxPerAnchorFamily) > 0
      ? Number(diverseBeamMaxPerAnchorFamily)
      : null
  if (
    !Array.isArray(orderedCandidateIndexes) ||
    orderedCandidateIndexes.length < 2 ||
    (!activeMonthLimit && !activeQuarterLimit && !activeAnchorLimit)
  ) {
    return {
      orderedCandidateIndexes,
      deferredCandidateCount: 0,
    }
  }
  const monthCounts = new Map()
  const quarterCounts = new Map()
  const anchorCounts = new Map()
  const accepted = []
  const deferred = []
  for (const candidateIndex of orderedCandidateIndexes) {
    const tokenIndex = Number(candidateTokenIndexes?.[candidateIndex] ?? -1)
    const monthSignatureHash =
      tokenIndex >= 0 ? String(seedPositiveMonthSignatureHashes?.[tokenIndex] ?? "").trim() : ""
    const quarterSignatureHash =
      tokenIndex >= 0 ? String(seedPositiveQuarterSignatureHashes?.[tokenIndex] ?? "").trim() : ""
    const anchorFamilyKey =
      tokenIndex >= 0 ? buildIndexedCandidateAnchorFamilyKey(seedTokensOrdered?.[tokenIndex]) : null
    const wouldExceedMonth =
      activeMonthLimit &&
      monthSignatureHash &&
      Number(monthCounts.get(monthSignatureHash) ?? 0) >= activeMonthLimit
    const wouldExceedQuarter =
      activeQuarterLimit &&
      quarterSignatureHash &&
      Number(quarterCounts.get(quarterSignatureHash) ?? 0) >= activeQuarterLimit
    const wouldExceedAnchor =
      activeAnchorLimit &&
      anchorFamilyKey &&
      Number(anchorCounts.get(anchorFamilyKey) ?? 0) >= activeAnchorLimit
    if (wouldExceedMonth || wouldExceedQuarter || wouldExceedAnchor) {
      deferred.push(candidateIndex)
      continue
    }
    if (activeMonthLimit && monthSignatureHash) {
      monthCounts.set(monthSignatureHash, Number(monthCounts.get(monthSignatureHash) ?? 0) + 1)
    }
    if (activeQuarterLimit && quarterSignatureHash) {
      quarterCounts.set(
        quarterSignatureHash,
        Number(quarterCounts.get(quarterSignatureHash) ?? 0) + 1,
      )
    }
    if (activeAnchorLimit && anchorFamilyKey) {
      anchorCounts.set(anchorFamilyKey, Number(anchorCounts.get(anchorFamilyKey) ?? 0) + 1)
    }
    accepted.push(candidateIndex)
  }
  const diversifiedOrder = accepted.concat(deferred)
  if (Array.isArray(orderedCandidateIndexes.exactHeadNegativeCounts)) {
    diversifiedOrder.exactHeadNegativeCounts = orderedCandidateIndexes.exactHeadNegativeCounts
  }
  return {
    orderedCandidateIndexes: diversifiedOrder,
    deferredCandidateCount: deferred.length,
  }
}

const toUint32Array = (values) =>
  Uint32Array.from(
    (Array.isArray(values) || ArrayBuffer.isView(values) ? Array.from(values) : [])
      .map((value) => Number(value))
      .filter(Number.isInteger)
      .sort((left, right) => left - right),
  )

const createStringInterner = () => {
  const pool = new Map()
  return (value) => {
    const text = String(value ?? "").trim()
    if (!text) return ""
    const existing = pool.get(text)
    if (existing) return existing
    pool.set(text, text)
    return text
  }
}

const internOptionalString = (internString, value) => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text ? internString(text) : null
}

const readOptionalJson = async (filePath) => {
  let payload = null
  try {
    payload = await readJsonIfExistsStrict(filePath)
  } catch (error) {
    throw new Error(
      [
        "Indexed miner failed to read control-plane JSON.",
        `path=${filePath}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    )
  }
  return payload
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const LIVE_PARTIAL_RULE_CHECKPOINT_MS = 1000
const LIVE_PARTIAL_RULE_STATE_INTERVAL = 256
export const LIVE_SEARCH_PROGRESS_CHECKPOINT_MS = 15000
export const LIVE_SEARCH_PROGRESS_STATE_INTERVAL = 1024

const getPerfectPrototypeRuleHitCount = (rule) =>
  Number(rule?.trainHitCount ?? rule?.matchHitCount ?? 0)

const selectLivePartialRulesForSnapshot = ({ rules, maxRules }) => {
  const rankedRules = rankPerfectPrototypeRules(Array.isArray(rules) ? rules : [])
  const safeMaxRules = Math.max(1, Math.floor(Number(maxRules) || 1))
  if (rankedRules.length <= safeMaxRules) return rankedRules
  const kthRule = rankedRules[safeMaxRules - 1] ?? null
  const kthHitCount = getPerfectPrototypeRuleHitCount(kthRule)
  let endIndexExclusive = safeMaxRules
  while (
    endIndexExclusive < rankedRules.length &&
    getPerfectPrototypeRuleHitCount(rankedRules[endIndexExclusive]) === kthHitCount
  ) {
    endIndexExclusive += 1
  }
  return rankedRules.slice(0, endIndexExclusive)
}

const updateProgress = async (progressPath, payload) => {
  await writeJsonAtomic(progressPath, payload)
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
  const rowsScanned = Number(payload?.rowsScanned ?? 0)
  const tokensIndexed = Number(payload?.tokensIndexed ?? 0)
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

const sampleSourceIdsFromIndexes = ({ rowSourceIds, indexes, limit = 10 }) => {
  const sampleIds = []
  for (let index = 0; index < indexes.length && sampleIds.length < limit; index += 1) {
    const rowIndex = Number(indexes[index])
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue
    const sourceId = rowSourceIds[rowIndex]
    if (sourceId) sampleIds.push(sourceId)
  }
  return sampleIds
}

const createPerfectPrototypeIndexedDayCappedHitStatsComputer = ({
  rowDateIndexes,
  calendarDateKeys,
  calendarFoldKeys = [],
}) => {
  const calendarLength = Math.max(0, Number(calendarDateKeys?.length ?? 0))
  const dateCountsScratch = new Uint32Array(calendarLength)
  const touchedDateIndexesScratch = new Uint32Array(calendarLength)
  return ({ rowIndexes, hitCountMode, hitCountDaySymbolCap }) => {
    const resolvedHitCountMode = resolvePerfectPrototypeHitCountMode(hitCountMode)
    const resolvedHitCountDaySymbolCap = resolvePerfectPrototypeHitCountDaySymbolCap(
      hitCountDaySymbolCap,
      2,
    )
    const safeRowIndexes =
      Array.isArray(rowIndexes) || ArrayBuffer.isView(rowIndexes) ? rowIndexes : []
    let rawCount = 0
    let touchedDateCount = 0
    for (const rawRowIndex of safeRowIndexes) {
      const rowIndex = Number(rawRowIndex)
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowDateIndexes.length) continue
      const dateIndex = Number(rowDateIndexes[rowIndex] ?? Number.NaN)
      if (!Number.isInteger(dateIndex) || dateIndex < 0 || dateIndex >= calendarLength) continue
      if (dateCountsScratch[dateIndex] === 0) {
        touchedDateIndexesScratch[touchedDateCount] = dateIndex
        touchedDateCount += 1
      }
      dateCountsScratch[dateIndex] += 1
      rawCount += 1
    }
    const hitCalendarIndexes = new Array(touchedDateCount)
    let cappedCount = 0
    let maxSymbolsMatchedPerDate = 0
    const effectiveCountsByDate = new Array(touchedDateCount)
    const effectiveCountsByFold = new Map()
    for (let index = 0; index < touchedDateCount; index += 1) {
      const dateIndex = touchedDateIndexesScratch[index]
      const count = Number(dateCountsScratch[dateIndex] ?? 0)
      dateCountsScratch[dateIndex] = 0
      const effectiveCount =
        resolvedHitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE
          ? Math.min(resolvedHitCountDaySymbolCap, count)
          : count
      cappedCount += effectiveCount
      maxSymbolsMatchedPerDate = Math.max(maxSymbolsMatchedPerDate, count)
      hitCalendarIndexes[index] = dateIndex
      effectiveCountsByDate[index] = effectiveCount
      const foldKey = String(calendarFoldKeys?.[dateIndex] ?? "").trim() || null
      if (foldKey) {
        effectiveCountsByFold.set(
          foldKey,
          Number(effectiveCountsByFold.get(foldKey) ?? 0) + effectiveCount,
        )
      }
    }
    hitCalendarIndexes.sort((left, right) => left - right)
    effectiveCountsByDate.sort((left, right) => Number(right) - Number(left))
    const top1DateHitCount = Number(effectiveCountsByDate[0] ?? 0)
    const top3DateHitCount =
      Number(effectiveCountsByDate[0] ?? 0) +
      Number(effectiveCountsByDate[1] ?? 0) +
      Number(effectiveCountsByDate[2] ?? 0)
    const hitDates = hitCalendarIndexes
      .map((calendarIndex) => calendarDateKeys[calendarIndex])
      .filter(Boolean)
    const hitMonths = uniqueSorted(hitDates.map((dateKey) => buildPerfectPrototypeMonthKey(dateKey)).filter(Boolean))
    const hitQuarters = uniqueSorted(
      hitDates.map((dateKey) => buildPerfectPrototypeQuarterKey(dateKey)).filter(Boolean),
    )
    const hitFolds = uniqueSorted(Array.from(effectiveCountsByFold.keys()))
    const effectiveCountsByFoldSorted = Array.from(effectiveCountsByFold.values()).sort(
      (left, right) => Number(right) - Number(left),
    )
    const top1FoldHitCount = Number(effectiveCountsByFoldSorted[0] ?? 0)
    const top3FoldHitCount =
      Number(effectiveCountsByFoldSorted[0] ?? 0) +
      Number(effectiveCountsByFoldSorted[1] ?? 0) +
      Number(effectiveCountsByFoldSorted[2] ?? 0)
    return {
      hitCountMode: resolvedHitCountMode,
      hitCountDaySymbolCap: resolvedHitCountDaySymbolCap,
      rawCount,
      cappedCount,
      distinctDateCount: touchedDateCount,
      matchedMonthCount: hitMonths.length,
      matchedQuarterCount: hitQuarters.length,
      matchedFoldCount: hitFolds.length,
      maxSymbolsMatchedPerDate,
      hitCalendarIndexes,
      hitDates,
      hitMonths,
      hitQuarters,
      hitFolds,
      top1DateHitCount,
      top3DateHitCount,
      top1DateHitShare: safeRate(top1DateHitCount, cappedCount),
      top3DateHitShare: safeRate(top3DateHitCount, cappedCount),
      top1FoldHitCount,
      top3FoldHitCount,
      top1FoldHitShare: safeRate(top1FoldHitCount, cappedCount),
      top3FoldHitShare: safeRate(top3FoldHitCount, cappedCount),
      matchedDateSignatureHash: buildPerfectPrototypeMatchedDateSignatureHash(hitDates),
      matchedMonthSignatureHash:
        hitMonths.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitMonths) : null,
      matchedQuarterSignatureHash:
        hitQuarters.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitQuarters) : null,
      matchedFoldSignatureHash:
        hitFolds.length > 0 ? buildPerfectPrototypeMatchedDateSignatureHash(hitFolds) : null,
    }
  }
}

const buildPerfectPrototypeIndexedRowFoldKeys = ({
  rowDateIndexes,
  calendarDateKeys,
  foldScheme,
}) => {
  const foldLookup = buildPerfectPrototypeChronologicalFoldLookup({
    calendarDateKeys,
    foldScheme,
  })
  const rowFoldKeys = new Array(
    Array.isArray(rowDateIndexes) || ArrayBuffer.isView(rowDateIndexes) ? rowDateIndexes.length : 0,
  ).fill(null)
  if (!foldLookup.foldScheme || foldLookup.foldKeysByCalendarIndex.length < 1) {
    return {
      foldLookup,
      rowFoldKeys,
    }
  }
  const safeRowDateIndexes =
    Array.isArray(rowDateIndexes) || ArrayBuffer.isView(rowDateIndexes) ? rowDateIndexes : []
  for (let rowIndex = 0; rowIndex < safeRowDateIndexes.length; rowIndex += 1) {
    const dateIndex = Number(safeRowDateIndexes[rowIndex] ?? Number.NaN)
    if (!Number.isInteger(dateIndex) || dateIndex < 0 || dateIndex >= foldLookup.foldKeysByCalendarIndex.length) {
      continue
    }
    rowFoldKeys[rowIndex] = foldLookup.foldKeysByCalendarIndex[dateIndex] ?? null
  }
  return {
    foldLookup,
    rowFoldKeys,
  }
}

const buildFamilyScopedSeedOrdering = ({
  seedTokens,
  maxTopBucket = null,
  maxMidBucket = null,
  maxLowBucket = null,
}) => {
  const bucketOrder = [
    PERFECT_PROTOTYPE_RULE_FAMILY_MID_SEED_BUCKET,
    PERFECT_PROTOTYPE_RULE_FAMILY_LOW_SEED_BUCKET,
    PERFECT_PROTOTYPE_RULE_FAMILY_TOP_SEED_BUCKET,
    PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET,
  ]
  const bucketLimits = new Map([
    [PERFECT_PROTOTYPE_RULE_FAMILY_TOP_SEED_BUCKET, Number.isInteger(Number(maxTopBucket)) ? Number(maxTopBucket) : null],
    [PERFECT_PROTOTYPE_RULE_FAMILY_MID_SEED_BUCKET, Number.isInteger(Number(maxMidBucket)) ? Number(maxMidBucket) : null],
    [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_SEED_BUCKET, Number.isInteger(Number(maxLowBucket)) ? Number(maxLowBucket) : null],
    [PERFECT_PROTOTYPE_RULE_FAMILY_OTHER_SEED_BUCKET, null],
  ])
  const buckets = new Map(bucketOrder.map((bucket) => [bucket, []]))
  for (let index = 0; index < (Array.isArray(seedTokens) ? seedTokens.length : 0); index += 1) {
    const bucket = classifyPerfectPrototypeSeedFamilyBucket(seedTokens[index])
    const rows = buckets.get(bucket) ?? []
    rows.push(index)
    buckets.set(bucket, rows)
  }
  const interleavedOrder = []
  const acceptedCounts = {}
  const deferredCounts = {}
  for (const bucket of bucketOrder) {
    acceptedCounts[bucket] = 0
    deferredCounts[bucket] = 0
  }
  let progress = true
  while (progress) {
    progress = false
    for (const bucket of bucketOrder) {
      const queue = buckets.get(bucket) ?? []
      if (queue.length < 1) continue
      progress = true
      const nextSeedIndex = queue.shift()
      const bucketLimit = bucketLimits.get(bucket)
      if (Number.isInteger(bucketLimit) && bucketLimit > 0 && acceptedCounts[bucket] >= bucketLimit) {
        deferredCounts[bucket] += 1
        continue
      }
      interleavedOrder.push(nextSeedIndex)
      acceptedCounts[bucket] += 1
    }
  }
  return {
    interleavedOrder,
    acceptedCounts,
    deferredCounts,
    bucketOrder,
  }
}

const buildRecentOnlyFamilyRootSeedIndexes = async ({
  cfg,
  familyId,
  seedTokens,
  seedCount,
  positiveRowset,
  negativeRowset,
  seedPositiveCounts,
  seedPostingCache,
  familyCohortPositiveCount,
  minHitCount,
  computePositiveHitStats = null,
  supportCaseTokenSet = null,
  donorTokenSet = null,
}) => {
  const requiredRootTokens = new Set(buildPerfectPrototypeRecentOnlyFamilyRootTokens(familyId))
  const supportCaseRootTokenSet =
    supportCaseTokenSet instanceof Set && supportCaseTokenSet.size > 0
      ? new Set(
          buildPerfectPrototypeSupportCaseTargetedRootTokenSet({
            familyId,
            tokens: Array.from(supportCaseTokenSet),
          }),
        )
      : null
  const supportCaseConstrainedFamily =
    isPerfectPrototypeSupportCaseTargetedFamilyId(familyId) &&
    supportCaseRootTokenSet instanceof Set &&
    supportCaseRootTokenSet.size > 0
  const donorRootTokenSet =
    donorTokenSet instanceof Set && donorTokenSet.size > 0
      ? new Set(
          buildPerfectPrototypeSupportCaseTargetedRootTokenSet({
            familyId,
            tokens: Array.from(donorTokenSet),
          }),
        )
      : null
  const donorConstrainedFamily =
    supportCaseConstrainedFamily &&
    donorRootTokenSet instanceof Set &&
    donorRootTokenSet.size > 0
  const supportCaseMinRootOverlap = Math.max(
    0,
    Number(cfg?.supportCaseMinRootOverlap ?? 0) || 0,
  )
  const supportCaseMinDonorRootOverlap = Math.max(
    0,
    Number(cfg?.supportCaseMinDonorRootOverlap ?? 0) || 0,
  )
  const supportCaseMaxRootSeeds =
    Number.isInteger(Number(cfg?.supportCaseMaxRootSeeds))
      ? Number(cfg.supportCaseMaxRootSeeds)
      : null
  const supportCaseMaxEffectiveRootSeeds =
    Number.isInteger(Number(cfg?.supportCaseMaxEffectiveRootSeeds))
      ? Number(cfg.supportCaseMaxEffectiveRootSeeds)
      : null
  const supportCaseFailIfRootScopeUncompressed =
    cfg?.supportCaseFailIfRootScopeUncompressed === true
  const useSubgroupPrepass = shouldUsePerfectPrototypeLowGapTopGeneralizedPrepass({
    familyId,
    enabled: cfg?.enableSubgroupPrepass === true,
  })
  const subgroupMinMatchedDates = Math.max(
    0,
    Number(cfg?.subgroupMinMatchedDates ?? 0) || 0,
  )
  const subgroupMinMatchedMonths = Math.max(
    0,
    Number(cfg?.subgroupMinMatchedMonths ?? 0) || 0,
  )
  const subgroupMinMatchedFolds = Math.max(
    0,
    Number(cfg?.subgroupMinMatchedFolds ?? 0) || 0,
  )
  const subgroupMaxRootSeeds =
    Number.isInteger(Number(cfg?.subgroupMaxRootSeeds)) && Number(cfg?.subgroupMaxRootSeeds) > 0
      ? Number(cfg.subgroupMaxRootSeeds)
      : null
  const candidates = []
  const subgroupManifestCandidates = []
  const rejectedCounts = {
    duplicateRootToken: 0,
    disallowedToken: 0,
    subgroupDisallowedRootToken: 0,
    subgroupFpRiskRootRejectCount: 0,
    belowMinHitCount: 0,
    subgroupBreadthRejectCount: 0,
    subgroupQualityRejectCount: 0,
    subgroupRootCapTruncatedCount: 0,
    supportCaseGenericRootRejectCount: 0,
    supportCaseRootOverlapRejectCount: 0,
    supportCaseRootCapTruncatedCount: 0,
    donorGenericRootRejectCount: 0,
    donorRootOverlapRejectCount: 0,
    supportCaseEffectiveRootCapTruncatedCount: 0,
  }
  const normalizedMinHitCount = Math.max(1, Number(minHitCount ?? 1) || 1)
  const negativeUniverseCount = getPerfectPrototypeRowsetCount(negativeRowset)
  if (
    isPerfectPrototypeSupportCaseTargetedFamilyId(familyId) &&
    supportCaseTokenSet instanceof Set &&
    supportCaseTokenSet.size > 0 &&
    supportCaseRootTokenSet instanceof Set &&
    supportCaseRootTokenSet.size < 1
  ) {
    throw new Error(
      `support-case constrained root scope resolved zero allowed root tokens for family=${familyId}`,
    )
  }
  if (
    isPerfectPrototypeSupportCaseTargetedFamilyId(familyId) &&
    donorTokenSet instanceof Set &&
    donorTokenSet.size > 0 &&
    donorRootTokenSet instanceof Set &&
    donorRootTokenSet.size < 1
  ) {
    throw new Error(
      `support-case donor-constrained root scope resolved zero allowed root tokens for family=${familyId}`,
    )
  }
  for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
    const token = seedTokens[seedIndex]
    if (requiredRootTokens.has(token)) {
      rejectedCounts.duplicateRootToken += 1
      continue
    }
    if (useSubgroupPrepass && !isPerfectPrototypeLowGapTopGeneralizedRootToken(token)) {
      rejectedCounts.subgroupDisallowedRootToken += 1
      continue
    }
    if (useSubgroupPrepass && isPerfectPrototypeLowGapTopFpRiskToken(token)) {
      rejectedCounts.subgroupFpRiskRootRejectCount += 1
      continue
    }
    if (!isPerfectPrototypeContinuationFamilyRootTokenAllowed({ familyId, token })) {
      if (!useSubgroupPrepass) {
        rejectedCounts.disallowedToken += 1
        continue
      }
    }
    if (supportCaseConstrainedFamily && !supportCaseRootTokenSet.has(token)) {
      rejectedCounts.supportCaseGenericRootRejectCount += 1
      continue
    }
    if (donorConstrainedFamily && !donorRootTokenSet.has(token)) {
      rejectedCounts.donorGenericRootRejectCount += 1
      continue
    }
    const supportCaseTokenMatch =
      supportCaseRootTokenSet instanceof Set && supportCaseRootTokenSet.has(token) ? 1 : 0
    if (supportCaseConstrainedFamily && supportCaseTokenMatch < supportCaseMinRootOverlap) {
      rejectedCounts.supportCaseRootOverlapRejectCount += 1
      continue
    }
    const donorTokenMatch = donorRootTokenSet instanceof Set && donorRootTokenSet.has(token) ? 1 : 0
    if (donorConstrainedFamily && donorTokenMatch < supportCaseMinDonorRootOverlap) {
      rejectedCounts.donorRootOverlapRejectCount += 1
      continue
    }
    const positivePostingRowset = await seedPostingCache.getSeedPositiveRowset(seedIndex)
    const positiveCount = intersectPerfectPrototypeRowsetsCount(positiveRowset, positivePostingRowset)
    if (positiveCount < normalizedMinHitCount) {
      rejectedCounts.belowMinHitCount += 1
      continue
    }
    const negativePostingRowset =
      negativeUniverseCount > 0 ? await seedPostingCache.getSeedNegativeRowset(seedIndex) : null
    const negativeCount =
      negativeUniverseCount > 0 && negativePostingRowset
        ? intersectPerfectPrototypeRowsetsCount(negativeRowset, negativePostingRowset)
        : 0
    const totalPositiveCount = Math.max(
      positiveCount,
      Number(seedPositiveCounts?.[seedIndex] ?? Number.NaN) || 0,
    )
    const outsideCohortPositiveCount = Math.max(0, totalPositiveCount - positiveCount)
    const cohortConcentration = safeRate(positiveCount, totalPositiveCount)
    const cohortCoverageShare = safeRate(
      positiveCount,
      Math.max(1, Number(familyCohortPositiveCount ?? 0) || 0),
    )
    const precision = safeRate(positiveCount, positiveCount + negativeCount)
    let subgroupHitStats = null
    let subgroupQualified = !useSubgroupPrepass
    let subgroupManifestEligible = false
    let subgroupDistinctDateCount = 0
    let subgroupMatchedMonthCount = 0
    let subgroupMatchedFoldCount = 0
    let subgroupTop1DateHitShare = 0
    let subgroupScore = null
    let subgroupTpLift = null
    let subgroupWracc = null
    let subgroupFpPenalty = null
    let subgroupBundleAxis = null
    let subgroupHitDates = []
    let subgroupHitMonths = []
    let subgroupHitFolds = []
    if (useSubgroupPrepass) {
      const subgroupPositiveRowset = intersectPerfectPrototypeRowsets({
        leftRowset: positiveRowset,
        rightRowset: positivePostingRowset,
      })
      subgroupHitStats =
        typeof computePositiveHitStats === "function"
          ? computePositiveHitStats({
              rowIndexes: materializePerfectPrototypeRowsetValues(subgroupPositiveRowset),
              hitCountMode: cfg.hitCountMode,
              hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
            })
          : null
      subgroupDistinctDateCount = Number(
        subgroupHitStats?.distinctDateCount ?? subgroupHitStats?.matchedDateCount ?? 0,
      )
      subgroupMatchedMonthCount = Number(
        subgroupHitStats?.matchedMonthCount ?? subgroupHitStats?.distinctMonthCount ?? 0,
      )
      subgroupMatchedFoldCount = Number(
        subgroupHitStats?.matchedFoldCount ?? subgroupHitStats?.distinctFoldCount ?? 0,
      )
      subgroupTop1DateHitShare = Number(subgroupHitStats?.top1DateHitShare ?? 0)
      subgroupHitDates = Array.isArray(subgroupHitStats?.hitDates) ? subgroupHitStats.hitDates : []
      subgroupHitMonths = Array.isArray(subgroupHitStats?.hitMonths) ? subgroupHitStats.hitMonths : []
      subgroupHitFolds = Array.isArray(subgroupHitStats?.hitFolds) ? subgroupHitStats.hitFolds : []
      const subgroupBreadthQualified =
        subgroupDistinctDateCount >= subgroupMinMatchedDates &&
        subgroupMatchedMonthCount >= subgroupMinMatchedMonths &&
        subgroupMatchedFoldCount >= subgroupMinMatchedFolds
      if (!subgroupBreadthQualified) {
        rejectedCounts.subgroupBreadthRejectCount += 1
        continue
      }
      const subgroupBaseRate = safeRate(
        familyCohortPositiveCount,
        Number(familyCohortPositiveCount ?? 0) + Number(negativeUniverseCount ?? 0),
      )
      subgroupTpLift = precision - subgroupBaseRate
      subgroupWracc = cohortCoverageShare * subgroupTpLift
      subgroupFpPenalty = subgroupTop1DateHitShare * 12 + Number(negativeCount ?? 0) * 0.5
      subgroupScore = scorePerfectPrototypeLowGapTopSubgroupCandidate({
        positiveCount,
        negativeCount,
        familyCohortPositiveCount,
        negativeUniverseCount,
        hitStats: subgroupHitStats,
      })
      subgroupBundleAxis = classifyPerfectPrototypeLowGapTopGeneralizedRootAxis(token)
      subgroupManifestEligible =
        subgroupBreadthQualified &&
        Boolean(subgroupBundleAxis) &&
        !isPerfectPrototypeLowGapTopFpRiskToken(token)
      subgroupQualified = subgroupManifestEligible
      if (!subgroupManifestEligible) {
        rejectedCounts.subgroupQualityRejectCount += 1
        continue
      }
    }
    const candidateEntry = {
      tokenIndex: seedIndex,
      token,
      priority: scorePerfectPrototypeContinuationFamilyRootTokenPriority({ familyId, token }),
      donorTokenMatch,
      supportCaseTokenMatch,
      precision,
      positiveCount,
      negativeCount,
      totalPositiveCount,
      outsideCohortPositiveCount,
      cohortConcentration,
      cohortCoverageShare,
      subgroupManifestEligible,
      subgroupQualified,
      subgroupScore,
      subgroupDistinctDateCount,
      subgroupMatchedMonthCount,
      subgroupMatchedFoldCount,
      subgroupTop1DateHitShare,
      subgroupHitDates,
      subgroupHitMonths,
      subgroupHitFolds,
      subgroupTpLift,
      subgroupWracc,
      subgroupFpPenalty,
      bundleAxis: subgroupBundleAxis,
    }
    if (useSubgroupPrepass) {
      subgroupManifestCandidates.push(candidateEntry)
      if (subgroupQualified) candidates.push(candidateEntry)
      continue
    }
    candidates.push(candidateEntry)
  }
  const candidatePool = useSubgroupPrepass ? subgroupManifestCandidates : candidates
  candidatePool.sort(comparePerfectPrototypeRecentOnlyRootSeedCandidates)
  const uncappedCandidateCount = candidatePool.length
  if (
    supportCaseConstrainedFamily &&
    Number.isInteger(supportCaseMaxRootSeeds) &&
    supportCaseMaxRootSeeds > 0
  ) {
    if (
      supportCaseFailIfRootScopeUncompressed &&
      uncappedCandidateCount > supportCaseMaxRootSeeds
    ) {
      throw new Error(
        [
          `support-case constrained root scope remained too broad for family=${familyId}`,
          `uncappedCandidateCount=${uncappedCandidateCount}`,
          `supportCaseMaxRootSeeds=${supportCaseMaxRootSeeds}`,
        ].join(" "),
      )
    }
    if (uncappedCandidateCount > supportCaseMaxRootSeeds) {
      rejectedCounts.supportCaseRootCapTruncatedCount =
        uncappedCandidateCount - supportCaseMaxRootSeeds
      candidatePool.length = supportCaseMaxRootSeeds
    }
  }
  const filteredCandidateCount = candidatePool.length
  if (useSubgroupPrepass && Number.isInteger(subgroupMaxRootSeeds) && subgroupMaxRootSeeds > 0) {
    if (filteredCandidateCount > subgroupMaxRootSeeds) {
      rejectedCounts.subgroupRootCapTruncatedCount =
        filteredCandidateCount - subgroupMaxRootSeeds
      candidatePool.length = subgroupMaxRootSeeds
    }
  }
  if (
    supportCaseConstrainedFamily &&
    Number.isInteger(supportCaseMaxEffectiveRootSeeds) &&
    supportCaseMaxEffectiveRootSeeds > 0
  ) {
    if (
      supportCaseFailIfRootScopeUncompressed &&
      filteredCandidateCount > supportCaseMaxEffectiveRootSeeds
    ) {
      throw new Error(
        [
          `support-case effective root scope remained too broad for family=${familyId}`,
          `filteredCandidateCount=${filteredCandidateCount}`,
          `supportCaseMaxEffectiveRootSeeds=${supportCaseMaxEffectiveRootSeeds}`,
        ].join(" "),
      )
    }
    if (filteredCandidateCount > supportCaseMaxEffectiveRootSeeds) {
      rejectedCounts.supportCaseEffectiveRootCapTruncatedCount =
        filteredCandidateCount - supportCaseMaxEffectiveRootSeeds
      candidatePool.length = supportCaseMaxEffectiveRootSeeds
    }
  }
  const subgroupQualifiedCandidateCount = useSubgroupPrepass
    ? candidatePool.filter((entry) => entry?.subgroupQualified === true).length
    : 0
  const subgroupBundlePlan = useSubgroupPrepass
    ? buildPerfectPrototypeLowGapTopSubgroupBundleManifests({
        candidatePool,
        maxBundles: Number(cfg?.subgroupMaxManifests ?? 6) || 6,
        minMatchedDates: subgroupMinMatchedDates,
        minMatchedMonths: subgroupMinMatchedMonths,
        minMatchedFolds: subgroupMinMatchedFolds,
        minSelectionFrequency:
          cfg?.enableSubgroupStability === true
            ? Number(cfg?.subgroupMinSelectionFrequency ?? 0.5) || 0.5
            : 0,
        minFoldPresenceCount:
          cfg?.enableSubgroupStability === true
            ? Number(cfg?.subgroupMinFoldPresenceCount ?? 3) || 3
            : 1,
        minWindowPresenceCount:
          cfg?.enableSubgroupStability === true
            ? Number(cfg?.subgroupMinWindowPresenceCount ?? 2) || 2
            : 1,
        maxTokenJaccard:
          cfg?.enableSubgroupDiversity === true
            ? Number(cfg?.subgroupMaxTokenJaccard ?? 0.8) || 0.8
            : 1,
        maxAxisOverlap:
          cfg?.enableSubgroupDiversity === true
            ? Number(cfg?.subgroupMaxAxisOverlap ?? 2) || 2
            : 32,
        maxDateCoverJaccard:
          cfg?.enableSubgroupDiversity === true
            ? Number(cfg?.subgroupMaxDateCoverJaccard ?? 0.9) || 0.9
            : 1,
      })
    : {
        candidateCount: 0,
        manifestCandidateCount: 0,
        stableManifestCount: 0,
        diverseManifestCount: 0,
        manifests: [],
      }
  const subgroupBundleManifests = Array.isArray(subgroupBundlePlan?.manifests)
    ? subgroupBundlePlan.manifests
    : []
  const subgroupStageReason = useSubgroupPrepass
    ? Number(subgroupBundlePlan?.candidateCount ?? 0) < 1
      ? "no_subgroup_candidates"
      : Number(subgroupBundlePlan?.stableManifestCount ?? 0) < 1
        ? "no_stable_subgroups"
        : Number(subgroupBundlePlan?.diverseManifestCount ?? 0) < 1
          ? "no_diverse_subgroups"
          : null
    : null
  const effectiveSeedIndexes = useSubgroupPrepass
    ? uniqueSorted(
        subgroupBundleManifests.flatMap((manifest) =>
          (Array.isArray(manifest?.seedIndexes) ? manifest.seedIndexes : []).filter(
            (value) => Number.isInteger(value) && value >= 0,
          ),
        ),
      )
    : candidatePool.map((entry) => entry.tokenIndex)
  return {
    seedIndexes: effectiveSeedIndexes,
    acceptedCount: effectiveSeedIndexes.length,
    uncappedCandidateCount,
    filteredCandidateCount,
    supportCaseConstrainedFamily,
    supportCaseRootTokenCount:
      supportCaseRootTokenSet instanceof Set ? supportCaseRootTokenSet.size : 0,
    donorRootTokenCount: donorRootTokenSet instanceof Set ? donorRootTokenSet.size : 0,
    supportCaseMaxRootSeeds:
      Number.isInteger(supportCaseMaxRootSeeds) && supportCaseMaxRootSeeds > 0
        ? supportCaseMaxRootSeeds
        : null,
    supportCaseMaxEffectiveRootSeeds:
      Number.isInteger(supportCaseMaxEffectiveRootSeeds) && supportCaseMaxEffectiveRootSeeds > 0
        ? supportCaseMaxEffectiveRootSeeds
        : null,
    supportCaseRootSeedCandidateCount: uncappedCandidateCount,
    supportCaseFilteredRootSeedCount: filteredCandidateCount,
    supportCaseEffectiveRootSeedCount: candidatePool.length,
    supportCaseCompressionRatio:
      seedCount > 0 ? safeRate(candidatePool.length, seedCount) : 0,
    subgroupPrepassEnabled: useSubgroupPrepass,
    subgroupCandidateCount: useSubgroupPrepass ? Number(subgroupBundlePlan?.candidateCount ?? 0) : uncappedCandidateCount,
    subgroupQualifiedCandidateCount,
    subgroupEffectiveRootSeedCount: candidatePool.length,
    subgroupManifestCandidateCount: Number(subgroupBundlePlan?.manifestCandidateCount ?? 0) || 0,
    subgroupStableManifestCount: Number(subgroupBundlePlan?.stableManifestCount ?? 0) || 0,
    subgroupDiverseManifestCount: Number(subgroupBundlePlan?.diverseManifestCount ?? 0) || 0,
    subgroupBundleManifests,
    subgroupStageReason,
    rejectedCounts,
    acceptedPreview: candidatePool.slice(0, 10).map((entry) => ({
      token: entry.token,
      priority: entry.priority,
      donorTokenMatch: entry.donorTokenMatch,
      supportCaseTokenMatch: entry.supportCaseTokenMatch,
      cohortConcentration: entry.cohortConcentration,
      cohortCoverageShare: entry.cohortCoverageShare,
      precision: entry.precision,
      positiveCount: entry.positiveCount,
      totalPositiveCount: entry.totalPositiveCount,
      outsideCohortPositiveCount: entry.outsideCohortPositiveCount,
      negativeCount: entry.negativeCount,
      subgroupQualified: entry.subgroupQualified,
      subgroupScore: entry.subgroupScore,
      subgroupDistinctDateCount: entry.subgroupDistinctDateCount,
      subgroupMatchedMonthCount: entry.subgroupMatchedMonthCount,
      subgroupMatchedFoldCount: entry.subgroupMatchedFoldCount,
      subgroupTop1DateHitShare: entry.subgroupTop1DateHitShare,
      subgroupTpLift: entry.subgroupTpLift,
      subgroupWracc: entry.subgroupWracc,
      subgroupFpPenalty: entry.subgroupFpPenalty,
      subgroupManifestEligible: entry.subgroupManifestEligible === true,
      subgroupBundleAxis: entry.bundleAxis,
    })),
  }
}

const isPerfectPrototypeRecentOnlyContinuationRootStage = ({
  cfg,
  datasetContract,
  currentFamilyId,
  tokens,
}) => {
  if (!isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })) return false
  if (!isPerfectPrototypeContinuationFamilyId(currentFamilyId)) return false
  const maxExistingRuleTokenCount = getPerfectPrototypeRecentOnlyFamilyRootStageMaxExistingRuleTokenCount(currentFamilyId)
  if (maxExistingRuleTokenCount < 1) return false
  return (Array.isArray(tokens) ? tokens.length : 0) <= maxExistingRuleTokenCount
}

const createPerfectPrototypeRuleFromIndexedRowMeta = async ({
  tokens,
  familyId = null,
  positiveRowset = null,
  positiveRowIndexes = [],
  negativeRowIndexes = [],
  rowSourceIds,
  rowSymbols,
  rowDateIndexes,
  calendarDateKeys = [],
  rowFoldKeys = [],
  familyDistributionPostingCache = null,
  hitCountMode = PERFECT_PROTOTYPE_RAW_ROW_HIT_COUNT_MODE,
  hitCountDaySymbolCap = 2,
  computePositiveHitStats = null,
}) => {
  const normalizedTokens = uniqueSorted(tokens)
  const positiveRowIndexesArray = Array.from(positiveRowIndexes)
  const negativeRowIndexesArray = Array.from(negativeRowIndexes)
  const hitStats =
    typeof computePositiveHitStats === "function"
      ? computePositiveHitStats({
          rowIndexes: positiveRowIndexesArray,
          hitCountMode,
          hitCountDaySymbolCap,
        })
      : createPerfectPrototypeIndexedDayCappedHitStatsComputer({
          rowDateIndexes,
          calendarDateKeys,
          calendarFoldKeys: [],
        })({
          rowIndexes: positiveRowIndexesArray,
          hitCountMode,
          hitCountDaySymbolCap,
        })
  const gapStats = computePerfectPrototypeGapStatsFromCalendarIndexes({
    hitCalendarIndexes: hitStats.hitCalendarIndexes,
    calendarDateKeys,
  })
  const matchedSymbols = uniqueSorted(
    positiveRowIndexesArray.map((rowIndex) => rowSymbols[rowIndex]).filter(Boolean),
  )
  const matchRowIndexes = Array.from(
    mergeSortedIndexCollections(positiveRowIndexesArray, negativeRowIndexesArray),
  )
  const familyDistributionStats = await buildPerfectPrototypeIndexedFamilyDistributionStats({
    positiveRowset,
    positiveRowCount: positiveRowIndexesArray.length,
    distributionPostingCache: familyDistributionPostingCache,
  })
  const resolvedFamilyId =
    String(familyId ?? "").trim() ||
    inferPerfectPrototypeRuleFamilyId({
      tokens: normalizedTokens,
      stats: {
        ...hitStats,
        ...familyDistributionStats,
      },
    })
  return {
    ruleId: buildPerfectPrototypeRuleId(normalizedTokens),
    familyId: String(resolvedFamilyId ?? "").trim() || null,
    tokens: normalizedTokens,
    ruleSize: normalizedTokens.length,
    trainMatchCount: matchRowIndexes.length,
    trainHitCount: hitStats.cappedCount,
    trainHitCountRaw: hitStats.rawCount,
    trainHitCountCapped: hitStats.cappedCount,
    trainNegativeCount: negativeRowIndexesArray.length,
    precision: safeRate(positiveRowIndexesArray.length, matchRowIndexes.length),
    hitCountMode: hitStats.hitCountMode,
    hitCountDaySymbolCap: hitStats.hitCountDaySymbolCap,
    maxSymbolsMatchedPerDate: hitStats.maxSymbolsMatchedPerDate,
    top1DateHitCount: hitStats.top1DateHitCount,
    top3DateHitCount: hitStats.top3DateHitCount,
    top1DateHitShare: hitStats.top1DateHitShare,
    top3DateHitShare: hitStats.top3DateHitShare,
    top1FoldHitCount: hitStats.top1FoldHitCount ?? 0,
    top3FoldHitCount: hitStats.top3FoldHitCount ?? 0,
    top1FoldHitShare: hitStats.top1FoldHitShare ?? 0,
    top3FoldHitShare: hitStats.top3FoldHitShare ?? 0,
    matchedDateSignatureHash: hitStats.matchedDateSignatureHash,
    matchedMonthCount: hitStats.matchedMonthCount,
    matchedQuarterCount: hitStats.matchedQuarterCount,
    matchedFoldCount: hitStats.matchedFoldCount ?? 0,
    matchedMonthSignatureHash: hitStats.matchedMonthSignatureHash,
    matchedQuarterSignatureHash: hitStats.matchedQuarterSignatureHash,
    matchedFoldSignatureHash: hitStats.matchedFoldSignatureHash ?? null,
    maxGapTradingDays: gapStats.maxGapTradingDays,
    startGapTradingDays: gapStats.startGapTradingDays,
    endGapTradingDays: gapStats.endGapTradingDays,
    firstHitDate: gapStats.hitDates[0] ?? null,
    lastHitDate: gapStats.hitDates[gapStats.hitDates.length - 1] ?? null,
    matchedSymbolCount: matchedSymbols.length,
    matchedSymbols,
    matchedDateCount: hitStats.distinctDateCount,
    ...familyDistributionStats,
    sampleMatchIds: sampleSourceIdsFromIndexes({
      rowSourceIds,
      indexes: positiveRowIndexesArray,
      limit: 10,
    }),
    matchRowIndexes: matchRowIndexes.slice(),
    positiveMatchRowIndexes: positiveRowIndexesArray.slice(),
    negativeMatchRowIndexes: negativeRowIndexesArray.slice(),
  }
}

const materializeDatasetRowsFromIndexedRowMeta = ({
  rowCount,
  sourceType,
  rowSourceIds,
  rowDateKeys,
  rowSymbols,
  rowOutcomeHitTargets,
  rowStepALaneIds = [],
  rowImpulseLookbackDays = [],
}) =>
  Array.from({ length: rowCount }, (_, rowIndex) => ({
    sourceType,
    sourceId: rowSourceIds[rowIndex] ?? "",
    dateKey: rowDateKeys[rowIndex] ?? "",
    symbol: rowSymbols[rowIndex] ?? "",
    outcomeHitTarget: rowOutcomeHitTargets[rowIndex] ?? null,
    stepALaneId: String(rowStepALaneIds?.[rowIndex] ?? "").trim() || null,
    impulseLookbackDays:
      Number.isInteger(Number(rowImpulseLookbackDays?.[rowIndex])) &&
      Number(rowImpulseLookbackDays?.[rowIndex]) >= 0
        ? Number(rowImpulseLookbackDays[rowIndex])
        : null,
  }))

const materializeSeedEntriesForReport = ({
  seedTokens,
  seedPositiveCounts,
  seedNegativeCounts,
  seedPrecisions,
  seedSeparationRatios,
  seedSeparationLifts,
  limit = 128,
}) => {
  const maxItems = Math.max(0, Math.floor(Number(limit) || 0))
  const entries = []
  for (let index = 0; index < seedTokens.length && entries.length < maxItems; index += 1) {
    entries.push({
      token: seedTokens[index],
      positiveMatchCount: seedPositiveCounts[index] ?? 0,
      negativeMatchCount: seedNegativeCounts[index] ?? 0,
      precision: seedPrecisions[index] ?? 0,
      separationRatio: seedSeparationRatios[index] ?? 0,
      separationLift: seedSeparationLifts[index] ?? 0,
    })
  }
  return entries
}

const normalizePerfectPrototypeContributionTokenKey = (token) => {
  const normalizedToken = String(token ?? "").trim()
  if (!normalizedToken) {
    return {
      token: "",
      tokenFamily: "unknown",
      featureKey: "unknown",
      contributionKey: "unknown",
    }
  }
  const parts = normalizedToken.split(":")
  const tokenFamily = String(parts[0] ?? "unknown").trim() || "unknown"
  const featureKeyCandidate =
    parts.length > 2
      ? parts.slice(1, -1).join(":")
      : parts.length > 1
        ? parts.slice(1).join(":")
        : normalizedToken
  const featureKey = String(featureKeyCandidate ?? "").trim() || normalizedToken
  return {
    token: normalizedToken,
    tokenFamily,
    featureKey,
    contributionKey: `${tokenFamily}:${featureKey}`,
  }
}

const createPerfectPrototypeFeatureContributionEntry = ({
  tokenFamily,
  featureKey,
  contributionKey,
}) => ({
  tokenFamily,
  featureKey,
  contributionKey,
  selectionCount: 0,
  acceptedCount: 0,
  exactRuleCount: 0,
  livePartialSnapshotRuleCount: 0,
  sampledRejectedRuleCount: 0,
  branchPositiveMass: 0,
  branchNegativeDropMass: 0,
  acceptedPositiveMass: 0,
  acceptedNegativeMass: 0,
  exactPositiveMatchMass: 0,
  livePartialPositiveMatchMass: 0,
  sampledRejectedNegativeMass: 0,
  negativeResolutionMs: 0,
  rowsetIntersectionMs: 0,
  childRowsetMaterializeMs: 0,
  headExactRerankLoadCount: 0,
})

const ensurePerfectPrototypeFeatureContributionEntry = (map, token) => {
  const normalized = normalizePerfectPrototypeContributionTokenKey(token)
  const existing = map.get(normalized.contributionKey)
  if (existing) return existing
  const created = createPerfectPrototypeFeatureContributionEntry(normalized)
  map.set(normalized.contributionKey, created)
  return created
}

const roundContributionMetric = (value, digits = 3) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(digits))
}

const serializePerfectPrototypeFeatureContributionEntry = (entry) => ({
  tokenFamily: entry.tokenFamily,
  featureKey: entry.featureKey,
  contributionKey: entry.contributionKey,
  selectionCount: Number(entry.selectionCount ?? 0),
  acceptedCount: Number(entry.acceptedCount ?? 0),
  exactRuleCount: Number(entry.exactRuleCount ?? 0),
  livePartialSnapshotRuleCount: Number(entry.livePartialSnapshotRuleCount ?? 0),
  sampledRejectedRuleCount: Number(entry.sampledRejectedRuleCount ?? 0),
  branchPositiveMass: Number(entry.branchPositiveMass ?? 0),
  branchNegativeDropMass: Number(entry.branchNegativeDropMass ?? 0),
  acceptedPositiveMass: Number(entry.acceptedPositiveMass ?? 0),
  acceptedNegativeMass: Number(entry.acceptedNegativeMass ?? 0),
  exactPositiveMatchMass: Number(entry.exactPositiveMatchMass ?? 0),
  livePartialPositiveMatchMass: Number(entry.livePartialPositiveMatchMass ?? 0),
  sampledRejectedNegativeMass: Number(entry.sampledRejectedNegativeMass ?? 0),
  negativeResolutionMs: roundContributionMetric(entry.negativeResolutionMs),
  rowsetIntersectionMs: roundContributionMetric(entry.rowsetIntersectionMs),
  childRowsetMaterializeMs: roundContributionMetric(entry.childRowsetMaterializeMs),
  headExactRerankLoadCount: Number(entry.headExactRerankLoadCount ?? 0),
  totalCostMs: roundContributionMetric(
    Number(entry.negativeResolutionMs ?? 0) +
      Number(entry.rowsetIntersectionMs ?? 0) +
      Number(entry.childRowsetMaterializeMs ?? 0),
  ),
})

const getPerfectPrototypeFeatureContributionSortValue = (entry, sortKey) => {
  if (String(sortKey ?? "") === "totalCostMs") {
    return (
      Number(entry?.negativeResolutionMs ?? 0) +
      Number(entry?.rowsetIntersectionMs ?? 0) +
      Number(entry?.childRowsetMaterializeMs ?? 0)
    )
  }
  return Number(entry?.[sortKey] ?? 0)
}

const buildPerfectPrototypeTopFeatureContributionEntries = ({
  entries,
  sortKey,
  limit = 8,
}) =>
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => getPerfectPrototypeFeatureContributionSortValue(entry, sortKey) > 0)
    .slice()
    .sort((left, right) => {
      const delta =
        getPerfectPrototypeFeatureContributionSortValue(right, sortKey) -
        getPerfectPrototypeFeatureContributionSortValue(left, sortKey)
      if (delta !== 0) return delta
      return String(left?.contributionKey ?? "").localeCompare(String(right?.contributionKey ?? ""))
    })
    .slice(0, Math.max(1, Math.floor(Number(limit) || 1)))
    .map(serializePerfectPrototypeFeatureContributionEntry)

const buildPerfectPrototypeFeatureContributionTelemetry = ({
  featureContributionByKey,
  limit = 8,
}) => {
  const entries = Array.from(featureContributionByKey.values())
  return {
    featureContributionTrackedFeatureCount: entries.length,
    featureContributionTopSelection: buildPerfectPrototypeTopFeatureContributionEntries({
      entries,
      sortKey: "selectionCount",
      limit,
    }),
    featureContributionTopAccepted: buildPerfectPrototypeTopFeatureContributionEntries({
      entries,
      sortKey: "acceptedCount",
      limit,
    }),
    featureContributionTopExactRules: buildPerfectPrototypeTopFeatureContributionEntries({
      entries,
      sortKey: "exactRuleCount",
      limit,
    }),
    featureContributionTopLivePartial: buildPerfectPrototypeTopFeatureContributionEntries({
      entries,
      sortKey: "livePartialSnapshotRuleCount",
      limit,
    }),
    featureContributionTopCost: buildPerfectPrototypeTopFeatureContributionEntries({
      entries,
      sortKey: "totalCostMs",
      limit,
    }).sort((left, right) => {
      const delta = Number(right?.totalCostMs ?? 0) - Number(left?.totalCostMs ?? 0)
      if (delta !== 0) return delta
      return String(left?.contributionKey ?? "").localeCompare(String(right?.contributionKey ?? ""))
    }),
  }
}

const createPerfectPrototypeRowContributionDiagnosticsState = ({
  rowMeta,
  topLimit = 8,
}) => {
  const rowCount = Number(rowMeta?.rowCount ?? 0)
  const duplicateSourceCounts = new Map()
  const duplicateSymbolDateCounts = new Map()
  const symbolFootprint = new Map()
  const dateFootprint = new Map()
  const duplicateSourceIdFlags = new Uint8Array(rowCount)
  const duplicateSymbolDateFlags = new Uint8Array(rowCount)
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const sourceId = String(rowMeta?.rowSourceIds?.[rowIndex] ?? "").trim()
    const symbol = String(rowMeta?.rowSymbols?.[rowIndex] ?? "").trim()
    const dateKey = String(rowMeta?.rowDateKeys?.[rowIndex] ?? "").trim()
    const outcomeHitTarget = rowMeta?.rowOutcomeHitTargets?.[rowIndex] === true
    if (sourceId) {
      duplicateSourceCounts.set(sourceId, Number(duplicateSourceCounts.get(sourceId) ?? 0) + 1)
    }
    if (symbol && dateKey) {
      const symbolDateKey = `${symbol}@@${dateKey}`
      duplicateSymbolDateCounts.set(
        symbolDateKey,
        Number(duplicateSymbolDateCounts.get(symbolDateKey) ?? 0) + 1,
      )
    }
    if (symbol) {
      const symbolEntry =
        symbolFootprint.get(symbol) ?? {
          symbol,
          rowCount: 0,
          positiveRowCount: 0,
          negativeRowCount: 0,
        }
      symbolEntry.rowCount += 1
      if (outcomeHitTarget) {
        symbolEntry.positiveRowCount += 1
      } else {
        symbolEntry.negativeRowCount += 1
      }
      symbolFootprint.set(symbol, symbolEntry)
    }
    if (dateKey) {
      const dateEntry =
        dateFootprint.get(dateKey) ?? {
          dateKey,
          rowCount: 0,
          positiveRowCount: 0,
          negativeRowCount: 0,
        }
      dateEntry.rowCount += 1
      if (outcomeHitTarget) {
        dateEntry.positiveRowCount += 1
      } else {
        dateEntry.negativeRowCount += 1
      }
      dateFootprint.set(dateKey, dateEntry)
    }
  }
  let duplicateSourceIdRowCount = 0
  let duplicateSymbolDateRowCount = 0
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const sourceId = String(rowMeta?.rowSourceIds?.[rowIndex] ?? "").trim()
    const symbol = String(rowMeta?.rowSymbols?.[rowIndex] ?? "").trim()
    const dateKey = String(rowMeta?.rowDateKeys?.[rowIndex] ?? "").trim()
    if (sourceId && Number(duplicateSourceCounts.get(sourceId) ?? 0) > 1) {
      duplicateSourceIdFlags[rowIndex] = 1
      duplicateSourceIdRowCount += 1
    }
    if (symbol && dateKey && Number(duplicateSymbolDateCounts.get(`${symbol}@@${dateKey}`) ?? 0) > 1) {
      duplicateSymbolDateFlags[rowIndex] = 1
      duplicateSymbolDateRowCount += 1
    }
  }
  const sortFootprint = (entries, key) =>
    entries
      .slice()
      .sort((left, right) => {
        const delta = Number(right?.[key] ?? 0) - Number(left?.[key] ?? 0)
        if (delta !== 0) return delta
        const leftKey = String(left?.symbol ?? left?.dateKey ?? "")
        const rightKey = String(right?.symbol ?? right?.dateKey ?? "")
        return leftKey.localeCompare(rightKey)
      })
      .slice(0, Math.max(1, Math.floor(Number(topLimit) || 1)))
  const profile = {
    rowCount,
    positiveRowCount: Number(rowMeta?.allPositiveTyped?.length ?? 0),
    negativeRowCount: Number(rowMeta?.allNegativeTyped?.length ?? 0),
    uniqueSymbolCount: symbolFootprint.size,
    uniqueDateCount: dateFootprint.size,
    duplicateSourceIdRowCount,
    duplicateSymbolDateRowCount,
    topSymbolsByRowCount: sortFootprint(Array.from(symbolFootprint.values()), "rowCount"),
    topDatesByRowCount: sortFootprint(Array.from(dateFootprint.values()), "rowCount"),
  }
  const exactHitSymbols = new Map()
  const exactHitDates = new Map()
  const sampledNegativeSymbols = new Map()
  const sampledNegativeDates = new Map()
  let exactHitDuplicateSourceIdCount = 0
  let exactHitDuplicateSymbolDateCount = 0
  let sampledNegativeDuplicateSourceIdCount = 0
  let sampledNegativeDuplicateSymbolDateCount = 0
  const incrementMapCount = (map, key, delta = 1) => {
    const normalizedKey = String(key ?? "").trim()
    if (!normalizedKey) return
    map.set(normalizedKey, Number(map.get(normalizedKey) ?? 0) + Number(delta ?? 0))
  }
  const noteIndexes = ({
    indexes,
    symbolMap,
    dateMap,
    includeDuplicateCounters = false,
    duplicateSourceCounter = "none",
    duplicateSymbolDateCounter = "none",
  }) => {
    for (const rawIndex of Array.isArray(indexes) || ArrayBuffer.isView(indexes)
      ? Array.from(indexes)
      : []) {
      const rowIndex = Number(rawIndex)
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount) continue
      incrementMapCount(symbolMap, rowMeta?.rowSymbols?.[rowIndex], 1)
      incrementMapCount(dateMap, rowMeta?.rowDateKeys?.[rowIndex], 1)
      if (includeDuplicateCounters === true) {
        if (duplicateSourceIdFlags[rowIndex] === 1) {
          if (duplicateSourceCounter === "exact") exactHitDuplicateSourceIdCount += 1
          if (duplicateSourceCounter === "sampledNegative") sampledNegativeDuplicateSourceIdCount += 1
        }
        if (duplicateSymbolDateFlags[rowIndex] === 1) {
          if (duplicateSymbolDateCounter === "exact") exactHitDuplicateSymbolDateCount += 1
          if (duplicateSymbolDateCounter === "sampledNegative") sampledNegativeDuplicateSymbolDateCount += 1
        }
      }
    }
  }
  const buildTopCounts = (map, keyName) =>
    Array.from(map.entries())
      .map(([key, count]) => ({
        [keyName]: key,
        rowCount: Number(count ?? 0),
      }))
      .filter((entry) => Number(entry.rowCount ?? 0) > 0)
      .sort((left, right) => {
        const delta = Number(right?.rowCount ?? 0) - Number(left?.rowCount ?? 0)
        if (delta !== 0) return delta
        return String(left?.[keyName] ?? "").localeCompare(String(right?.[keyName] ?? ""))
      })
      .slice(0, Math.max(1, Math.floor(Number(topLimit) || 1)))
  const computeTopMassShare = (map, topK = 1) => {
    const sortedCounts = Array.from(map.values())
      .map((count) => Number(count ?? 0))
      .filter((count) => count > 0)
      .sort((left, right) => right - left)
    if (sortedCounts.length < 1) return 0
    const total = sortedCounts.reduce((sum, count) => sum + count, 0)
    if (total <= 0) return 0
    const topMass = sortedCounts.slice(0, Math.max(1, Math.floor(Number(topK) || 1))).reduce(
      (sum, count) => sum + count,
      0,
    )
    return safeRate(topMass, total)
  }
  return {
    noteExactPositiveIndexes(indexes) {
      noteIndexes({
        indexes,
        symbolMap: exactHitSymbols,
        dateMap: exactHitDates,
        includeDuplicateCounters: true,
        duplicateSourceCounter: "exact",
        duplicateSymbolDateCounter: "exact",
      })
    },
    noteSampledNegativeIndexes(indexes) {
      noteIndexes({
        indexes,
        symbolMap: sampledNegativeSymbols,
        dateMap: sampledNegativeDates,
        includeDuplicateCounters: true,
        duplicateSourceCounter: "sampledNegative",
        duplicateSymbolDateCounter: "sampledNegative",
      })
    },
    buildTelemetry() {
      return {
        rowContributionProfile: profile,
        rowContributionTopExactSymbols: buildTopCounts(exactHitSymbols, "symbol"),
        rowContributionTopExactDates: buildTopCounts(exactHitDates, "dateKey"),
        topExactDateMassShare: computeTopMassShare(exactHitDates, 1),
        top3ExactDateMassShare: computeTopMassShare(exactHitDates, 3),
        topExactSymbolMassShare: computeTopMassShare(exactHitSymbols, 1),
        top3ExactSymbolMassShare: computeTopMassShare(exactHitSymbols, 3),
        rowContributionTopSampledNegativeSymbols: buildTopCounts(
          sampledNegativeSymbols,
          "symbol",
        ),
        rowContributionTopSampledNegativeDates: buildTopCounts(
          sampledNegativeDates,
          "dateKey",
        ),
        rowContributionExactDuplicateSourceIdCount: exactHitDuplicateSourceIdCount,
        rowContributionExactDuplicateSymbolDateCount: exactHitDuplicateSymbolDateCount,
        rowContributionSampledNegativeDuplicateSourceIdCount:
          sampledNegativeDuplicateSourceIdCount,
        rowContributionSampledNegativeDuplicateSymbolDateCount:
          sampledNegativeDuplicateSymbolDateCount,
      }
    },
  }
}

const areExactRowIndexArraysEqual = (left, right) => {
  const leftLength = Number(left?.length ?? 0)
  const rightLength = Number(right?.length ?? 0)
  if (leftLength !== rightLength) return false
  for (let index = 0; index < leftLength; index += 1) {
    if (Number(left[index]) !== Number(right[index])) return false
  }
  return true
}

const buildRuleMatchSignatureHash = (rowIndexes) => {
  const hash = crypto.createHash("sha1")
  for (const rawValue of Array.isArray(rowIndexes) || ArrayBuffer.isView(rowIndexes)
    ? Array.from(rowIndexes)
    : []) {
    const value = Number(rawValue)
    const buffer = Buffer.allocUnsafe(4)
    buffer.writeUInt32LE(Number.isInteger(value) && value >= 0 ? value : 0, 0)
    hash.update(buffer)
  }
  return hash.digest("hex")
}

const createPerfectPrototypeRowsetModeStats = () => createPerfectPrototypeRowsetModeStatsShape()

const recordPerfectPrototypeRowsetMode = (stats, prefix, rowset) => {
  if (!stats || !prefix) return
  const mode = summarizePerfectPrototypeRowsetMode(rowset)
  const key = `${prefix}${mode === "bitset" ? "Bitset" : "Sparse"}`
  stats[key] = Number(stats[key] ?? 0) + 1
}

const createSeedPostingCache = ({
  postingsHandle,
  seedDictionaryEntries,
  rowUniverseSize,
  maxEntries = 256,
  onLoad = null,
}) => {
  const cache = new Map()
  let hitCount = 0
  let missCount = 0
  const touch = (key, value) => {
    if (cache.has(key)) {
      cache.delete(key)
    }
    cache.set(key, value)
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value
      cache.delete(oldestKey)
    }
  }
  const getCacheEntry = (tokenIndex) => {
    const key = Number(tokenIndex)
    const cached = cache.get(key)
    if (cached) {
      hitCount += 1
      touch(key, cached)
      return cached
    }
    missCount += 1
    const entry = seedDictionaryEntries[key]
    if (!entry) {
      throw new Error(`Missing seed dictionary entry at tokenIndex=${key}`)
    }
    const nextEntry = {
      dictionaryEntry: entry,
      positiveRowset: null,
      negativeRowset: null,
    }
    touch(key, nextEntry)
    return nextEntry
  }
  const getSeedPositiveRowset = async (tokenIndex) => {
    const entry = getCacheEntry(tokenIndex)
    if (!entry.positiveRowset) {
      const loadStartedAt = Date.now()
      if (
        shouldPreferDensePerfectPrototypeRowset({
          count: entry.dictionaryEntry.positiveCount,
          universeSize: rowUniverseSize,
          allowDense: true,
        })
      ) {
        const decoded = decodePerfectPrototypeDeltaPostingsToBitset({
          buffer: await readPerfectPrototypePostingBufferFromFile({
            fileHandle: postingsHandle,
            offset: entry.dictionaryEntry.positiveOffset,
            byteLength: entry.dictionaryEntry.positiveByteLength,
          }),
          count: entry.dictionaryEntry.positiveCount,
          universeSize: rowUniverseSize,
        })
        entry.positiveRowset = createPerfectPrototypeBitsetRowsetFromWords(decoded)
      } else {
        entry.positiveRowset = createPerfectPrototypeRowset({
          values: await readPerfectPrototypeDeltaPostingsFromFile({
            fileHandle: postingsHandle,
            offset: entry.dictionaryEntry.positiveOffset,
            byteLength: entry.dictionaryEntry.positiveByteLength,
            count: entry.dictionaryEntry.positiveCount,
          }),
          universeSize: rowUniverseSize,
          allowDense: true,
        })
      }
      const loadMs = Date.now() - loadStartedAt
      if (typeof onLoad === "function") {
        onLoad({
          tokenIndex: Number(tokenIndex),
          kind: "positive",
          loadMs,
          rowset: entry.positiveRowset,
        })
      }
    }
    return entry.positiveRowset
  }
  const getSeedNegativeRowset = async (tokenIndex) => {
    const entry = getCacheEntry(tokenIndex)
    if (!entry.negativeRowset) {
      const loadStartedAt = Date.now()
      if (
        shouldPreferDensePerfectPrototypeRowset({
          count: entry.dictionaryEntry.negativeCount,
          universeSize: rowUniverseSize,
          allowDense: true,
        })
      ) {
        const decoded = decodePerfectPrototypeDeltaPostingsToBitset({
          buffer: await readPerfectPrototypePostingBufferFromFile({
            fileHandle: postingsHandle,
            offset: entry.dictionaryEntry.negativeOffset,
            byteLength: entry.dictionaryEntry.negativeByteLength,
          }),
          count: entry.dictionaryEntry.negativeCount,
          universeSize: rowUniverseSize,
        })
        entry.negativeRowset = createPerfectPrototypeBitsetRowsetFromWords(decoded)
      } else {
        entry.negativeRowset = createPerfectPrototypeRowset({
          values: await readPerfectPrototypeDeltaPostingsFromFile({
            fileHandle: postingsHandle,
            offset: entry.dictionaryEntry.negativeOffset,
            byteLength: entry.dictionaryEntry.negativeByteLength,
            count: entry.dictionaryEntry.negativeCount,
          }),
          universeSize: rowUniverseSize,
          allowDense: true,
        })
      }
      const loadMs = Date.now() - loadStartedAt
      if (typeof onLoad === "function") {
        onLoad({
          tokenIndex: Number(tokenIndex),
          kind: "negative",
          loadMs,
          rowset: entry.negativeRowset,
        })
      }
    }
    return entry.negativeRowset
  }
  const getSeedPostingPair = async (tokenIndex) => {
    const positiveRowset = await getSeedPositiveRowset(tokenIndex)
    const negativeRowset = await getSeedNegativeRowset(tokenIndex)
    return {
      positiveRowset,
      negativeRowset,
    }
  }
  return {
    getSeedPositiveRowset,
    getSeedNegativeRowset,
    getSeedPostingPair,
    getStats: () => ({
      hitCount,
      missCount,
      hitRate:
        hitCount + missCount > 0 ? Number((hitCount / (hitCount + missCount)).toFixed(6)) : null,
      cacheSize: cache.size,
    }),
  }
}

const buildMatchRowsFromIndexedRowMeta = ({ rowMeta, rules }) => {
  const matchRows = []
  const matchedRuleIdsByRow = new Map()
  for (const rule of Array.isArray(rules) ? rules : []) {
    const ruleMatchRowIndexes =
      Array.isArray(rule?.matchRowIndexes) || ArrayBuffer.isView(rule?.matchRowIndexes)
        ? rule.matchRowIndexes
        : rule?.positiveMatchRowIndexes ?? []
    for (const rowIndex of ruleMatchRowIndexes) {
      const key = Number(rowIndex)
      if (!Number.isInteger(key) || key < 0) continue
      const list = matchedRuleIdsByRow.get(key) ?? []
      list.push(rule.ruleId)
      matchedRuleIdsByRow.set(key, list)
    }
  }
  for (const [rowIndex, matchedRuleIds] of matchedRuleIdsByRow.entries()) {
    const uniqueRuleIds = uniqueSorted(matchedRuleIds)
    matchRows.push({
      sourceType: rowMeta.datasetSourceType,
      sourceId: rowMeta.rowSourceIds[rowIndex] ?? "",
      dateKey: rowMeta.rowDateKeys[rowIndex] ?? "",
      symbol: rowMeta.rowSymbols[rowIndex] ?? "",
      outcomeHitTarget: rowMeta.rowOutcomeHitTargets[rowIndex] ?? null,
      matchedRuleIds: uniqueRuleIds,
      matchedRuleCount: uniqueRuleIds.length,
      primaryRuleId: uniqueRuleIds[0] ?? null,
    })
  }
  return matchRows.sort((left, right) => {
    if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey))
    return String(left.symbol).localeCompare(String(right.symbol))
  })
}

export const loadPerfectPrototypeIndexedRowMeta = async ({
  cwd = process.cwd(),
  duckdb,
  rowMetaPath,
  rowLaneMetaPath = null,
  requireLaneMeta = false,
  manifest = null,
  summary = null,
}) => {
  const rowCount = Number(manifest?.rowCount ?? 0) || 0
  const rowSourceIds = new Array(rowCount)
  const rowDateKeys = new Array(rowCount)
  const rowSymbols = new Array(rowCount)
  const rowOutcomeHitTargets = new Array(rowCount)
  const rowStepALaneIds = new Array(rowCount).fill(null)
  const rowImpulseLookbackDays = new Array(rowCount).fill(null)
  const internString = createStringInterner()
  const allPositiveRowIndexes = []
  const allNegativeRowIndexes = []
  const calendarDateKeySet = new Set()
  const declaredDatasetSourceType =
    internOptionalString(internString, manifest?.sourceType ?? summary?.sourceType ?? null) ?? null
  const declaredDatasetStrategyMode =
    internOptionalString(internString, manifest?.strategyMode ?? summary?.strategyMode ?? null) ?? null
  const declaredArtifactType =
    internOptionalString(internString, manifest?.artifactType ?? summary?.artifactType ?? null) ?? null
  const enforceCanonicalPredictiveSourceType =
    declaredArtifactType !== PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE
  let derivedDatasetSourceType = null
  let derivedDatasetStrategyMode = null
  let streamedRowCount = 0
  let positiveCount = 0
  let negativeCount = 0
  const rowMetaRemediation =
    "Rebuild the affected indexed artifact so row_meta.parquet is regenerated from the canonical pack/feature-store input."
  const rowLaneMetaRemediation =
    "Rebuild the affected indexed artifact so row_lane_meta.parquet is regenerated from the canonical widened pack input."
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath: rowMetaPath,
    schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA),
    orderBySql: "rowIdx",
    onRow: async (row) => {
      const rowIndex = Number(row?.rowIdx)
      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        throw new Error(`Invalid rowIdx in row_meta.parquet: ${rowMetaPath}`)
      }
      if (rowIndex !== streamedRowCount) {
        throw new Error(
          `row_meta.parquet must contain contiguous unique rowIdx values: current=${rowIndex} expected=${streamedRowCount} path=${rowMetaPath}`,
        )
      }
      if (rowIndex >= rowCount) {
        throw new Error(
          `row_meta.parquet rowIdx exceeds manifest rowCount: rowIdx=${rowIndex} rowCount=${rowCount} path=${rowMetaPath}`,
        )
      }
      const sourceType = internOptionalString(internString, row?.sourceType) ?? ""
      const sourceId = internOptionalString(internString, row?.sourceId) ?? ""
      const dateKey = internOptionalString(internString, row?.dateKey) ?? ""
      const symbol = internOptionalString(internString, row?.symbol) ?? ""
      const strategyMode = internOptionalString(internString, row?.strategyMode) ?? null
      if (!sourceType) {
        throw new Error(
          `row_meta.parquet requires non-empty sourceType for every row: rowIdx=${rowIndex} path=${rowMetaPath}\n${rowMetaRemediation}`,
        )
      }
      if (!sourceId) {
        throw new Error(
          `row_meta.parquet requires non-empty sourceId for every row: rowIdx=${rowIndex} path=${rowMetaPath}\n${rowMetaRemediation}`,
        )
      }
      if (!dateKey) {
        throw new Error(
          `row_meta.parquet requires non-empty dateKey for every row: rowIdx=${rowIndex} path=${rowMetaPath}\n${rowMetaRemediation}`,
        )
      }
      if (!symbol) {
        throw new Error(
          `row_meta.parquet requires non-empty symbol for every row: rowIdx=${rowIndex} path=${rowMetaPath}\n${rowMetaRemediation}`,
        )
      }
      if (streamedRowCount === 0) {
        derivedDatasetSourceType = sourceType
        derivedDatasetStrategyMode = strategyMode
      } else {
        if (sourceType !== derivedDatasetSourceType) {
          throw new Error(
            `row_meta.parquet sourceType mismatch: rowIdx=${rowIndex} expected=${derivedDatasetSourceType} actual=${sourceType} path=${rowMetaPath}\n${rowMetaRemediation}`,
          )
        }
        if ((strategyMode ?? null) !== (derivedDatasetStrategyMode ?? null)) {
          throw new Error(
            `row_meta.parquet strategyMode mismatch: rowIdx=${rowIndex} expected=${derivedDatasetStrategyMode ?? "null"} actual=${strategyMode ?? "null"} path=${rowMetaPath}\n${rowMetaRemediation}`,
          )
        }
      }
      const outcomeHitTarget =
        row?.outcomeHitTarget === true
          ? true
          : row?.outcomeHitTarget === false
          ? false
            : null
      if (outcomeHitTarget === null) {
        throw new Error(`row_meta.parquet requires boolean outcomeHitTarget for every row: ${rowMetaPath}`)
      }
      rowSourceIds[rowIndex] = sourceId
      rowDateKeys[rowIndex] = dateKey
      rowSymbols[rowIndex] = symbol
      rowOutcomeHitTargets[rowIndex] = outcomeHitTarget
      streamedRowCount += 1
      if (dateKey) {
        calendarDateKeySet.add(dateKey)
      }
      if (outcomeHitTarget === true) {
        allPositiveRowIndexes.push(rowIndex)
        positiveCount += 1
      } else if (outcomeHitTarget === false) {
        allNegativeRowIndexes.push(rowIndex)
        negativeCount += 1
      }
    },
  })
  if (streamedRowCount !== rowCount) {
    throw new Error(`row_meta.parquet row count mismatch: actual=${streamedRowCount} expected=${rowCount} path=${rowMetaPath}`)
  }
  if (positiveCount + negativeCount !== rowCount) {
    throw new Error(
      `row_meta.parquet positive/negative row count mismatch: positive=${positiveCount} negative=${negativeCount} rowCount=${rowCount} path=${rowMetaPath}`,
    )
  }
  const datasetSourceType =
    derivedDatasetSourceType ??
    declaredDatasetSourceType ??
    (enforceCanonicalPredictiveSourceType ? PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE : null)
  const datasetStrategyMode = derivedDatasetStrategyMode ?? null
  if (
    enforceCanonicalPredictiveSourceType &&
    datasetSourceType !== PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE
  ) {
    throw new Error(
      `row_meta.parquet dataset sourceType must remain ${PERFECT_PROTOTYPE_INDEX_CANONICAL_SOURCE_TYPE}: actual=${datasetSourceType} path=${rowMetaPath}\n${rowMetaRemediation}`,
    )
  }
  if (declaredDatasetSourceType && datasetSourceType !== declaredDatasetSourceType) {
    throw new Error(
      `row_meta.parquet dataset sourceType does not match manifest/summary: expected=${declaredDatasetSourceType} actual=${datasetSourceType} path=${rowMetaPath}\n${rowMetaRemediation}`,
    )
  }
  if (declaredDatasetStrategyMode !== null && (datasetStrategyMode ?? null) !== declaredDatasetStrategyMode) {
    throw new Error(
      `row_meta.parquet dataset strategyMode does not match manifest/summary: expected=${declaredDatasetStrategyMode} actual=${datasetStrategyMode ?? "null"} path=${rowMetaPath}\n${rowMetaRemediation}`,
    )
  }
  const calendarDateKeys = uniqueSorted(Array.from(calendarDateKeySet))
  const calendarDateIndexByDateKey = new Map(
    calendarDateKeys.map((dateKey, index) => [dateKey, index]),
  )
  const rowDateIndexes = new Uint32Array(rowCount)
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const dateKey = rowDateKeys[rowIndex]
    const dateIndex = Number(calendarDateIndexByDateKey.get(dateKey) ?? Number.NaN)
    if (!Number.isInteger(dateIndex) || dateIndex < 0) {
      throw new Error(
        `row_meta.parquet dateKey is missing from the derived calendar lookup: rowIdx=${rowIndex} dateKey=${dateKey} path=${rowMetaPath}\n${rowMetaRemediation}`,
      )
    }
    rowDateIndexes[rowIndex] = dateIndex
  }
  const rawRowLaneMetaPath = String(
    rowLaneMetaPath ?? manifest?.rowLaneMetaParquetPath ?? "",
  ).trim()
  const resolvedRowLaneMetaPath = rawRowLaneMetaPath
    ? path.isAbsolute(rawRowLaneMetaPath)
      ? rawRowLaneMetaPath
      : path.resolve(path.dirname(path.resolve(cwd, rowMetaPath)), rawRowLaneMetaPath)
    : ""
  if (resolvedRowLaneMetaPath) {
    let streamedLaneRowCount = 0
    await streamParquetQueryDelimitedRows({
      cwd,
      duckdb,
      parquetPath: resolvedRowLaneMetaPath,
      schema: PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA,
      selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA),
      orderBySql: "rowIdx",
      onRow: async (row) => {
        const rowIndex = Number(row?.rowIdx)
        if (!Number.isInteger(rowIndex) || rowIndex < 0) {
          throw new Error(`Invalid rowIdx in row_lane_meta.parquet: ${resolvedRowLaneMetaPath}`)
        }
        if (rowIndex !== streamedLaneRowCount) {
          throw new Error(
            `row_lane_meta.parquet must contain contiguous unique rowIdx values: current=${rowIndex} expected=${streamedLaneRowCount} path=${resolvedRowLaneMetaPath}`,
          )
        }
        if (rowIndex >= rowCount) {
          throw new Error(
            `row_lane_meta.parquet rowIdx exceeds manifest rowCount: rowIdx=${rowIndex} rowCount=${rowCount} path=${resolvedRowLaneMetaPath}`,
          )
        }
        rowStepALaneIds[rowIndex] = internOptionalString(internString, row?.stepALaneId) ?? null
        const impulseLookbackDays = String(row?.impulseLookbackDays ?? "").trim()
        if (impulseLookbackDays) {
          const numericLookback = Number(impulseLookbackDays)
          if (!Number.isInteger(numericLookback) || numericLookback < 0) {
            throw new Error(
              `row_lane_meta.parquet impulseLookbackDays must be a non-negative integer: rowIdx=${rowIndex} path=${resolvedRowLaneMetaPath}\n${rowLaneMetaRemediation}`,
            )
          }
          rowImpulseLookbackDays[rowIndex] = numericLookback
        }
        streamedLaneRowCount += 1
      },
    })
    if (streamedLaneRowCount !== rowCount) {
      throw new Error(
        `row_lane_meta.parquet row count mismatch: actual=${streamedLaneRowCount} expected=${rowCount} path=${resolvedRowLaneMetaPath}`,
      )
    }
  } else if (requireLaneMeta) {
    throw new Error(
      [
        "This indexed miner path requires row_lane_meta.parquet in the exact index artifact.",
        `rowMetaPath=${rowMetaPath}`,
        rowLaneMetaRemediation,
      ].join("\n"),
    )
  }
  return {
    rowCount,
    rowSourceIds,
    rowDateKeys,
    rowDateIndexes,
    rowSymbols,
    rowOutcomeHitTargets,
    rowStepALaneIds,
    rowImpulseLookbackDays,
    calendarDateKeys,
    allPositiveTyped: toUint32Array(allPositiveRowIndexes),
    allNegativeTyped: toUint32Array(allNegativeRowIndexes),
    datasetSourceType,
    datasetStrategyMode,
  }
}

const loadPerfectPrototypeSelectedSeedIndexByTokenId = async ({
  cwd = process.cwd(),
  duckdb,
  tokenDictionaryParquetPath,
  expectedTokenCount,
  selectedSeedTokens,
}) => {
  const resolvedExpectedTokenCount = Math.max(
    0,
    Math.floor(Number(expectedTokenCount) || 0),
  )
  if (resolvedExpectedTokenCount < 1) {
    throw new Error(
      `Indexed miner row-projected candidate generation requires positive tokenCount: ${resolvedExpectedTokenCount}`,
    )
  }
  const selectedSeedIndexByToken = new Map(
    (Array.isArray(selectedSeedTokens) ? selectedSeedTokens : []).map((token, seedIndex) => [
      String(token ?? "").trim(),
      seedIndex,
    ]),
  )
  const tokenIdToSelectedSeedIndex = new Int32Array(resolvedExpectedTokenCount)
  tokenIdToSelectedSeedIndex.fill(-1)
  let tokenId = 0
  let previousToken = null
  await streamPerfectPrototypeTokenDictionaryEntries({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens: null,
    onRow: async (row) => {
      const token = String(row?.token ?? "").trim()
      if (!token) {
        throw new Error(
          `Indexed miner row-projected candidate generation encountered empty token in dictionary: ${tokenDictionaryParquetPath}`,
        )
      }
      if (previousToken !== null && token <= previousToken) {
        throw new Error(
          `Indexed miner row-projected candidate generation requires strictly ascending unique token dictionary order: current=${token} previous=${previousToken} path=${tokenDictionaryParquetPath}`,
        )
      }
      previousToken = token
      if (tokenId >= resolvedExpectedTokenCount) {
        throw new Error(
          `Indexed miner row-projected token dictionary exceeds manifest tokenCount: tokenId=${tokenId} expected=${resolvedExpectedTokenCount}`,
        )
      }
      const seedIndex = selectedSeedIndexByToken.get(token)
      if (Number.isInteger(seedIndex) && seedIndex >= 0) {
        tokenIdToSelectedSeedIndex[tokenId] = seedIndex
      }
      tokenId += 1
    },
  })
  if (tokenId !== resolvedExpectedTokenCount) {
    throw new Error(
      `Indexed miner row-projected token dictionary count mismatch: actual=${tokenId} expected=${resolvedExpectedTokenCount}`,
    )
  }
  return tokenIdToSelectedSeedIndex
}

const loadPerfectPrototypeIndexedRowTokenProjection = async ({
  cwd = process.cwd(),
  duckdb,
  tokenDictionaryParquetPath,
  rowTokenOffsetsPath,
  rowTokenIdsPath,
  rowCount,
  tokenPostingCount,
  tokenCount,
  tokenIdWidthBits,
  selectedSeedTokens,
}) => {
  const adjacency = await loadPerfectPrototypeRowTokenAdjacency({
    rowTokenOffsetsPath,
    rowTokenIdsPath,
    rowCount,
    tokenPostingCount,
    tokenIdWidthBits,
  })
  const tokenIdToSelectedSeedIndex = await loadPerfectPrototypeSelectedSeedIndexByTokenId({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    expectedTokenCount: tokenCount,
    selectedSeedTokens,
  })
  return {
    ...adjacency,
    tokenIdToSelectedSeedIndex,
  }
}

export const finalizePerfectPrototypeIndexedRuleSet = async ({
  resolvedIndexDir,
  resolvedOutDir,
  tokenizerSpec,
  manifestPath,
  summaryPath,
  manifest,
  summary,
  cfg,
  collectedRules,
  rejectedRules = [],
  rejectionSummary,
  selectorReport = null,
  contributionTelemetry = null,
  negativeSeparationReport,
  exploredStates,
  rowMeta,
}) => {
  const matchRows = buildMatchRowsFromIndexedRowMeta({
    rowMeta,
    rules: collectedRules,
  })
  const { dedupedMatches, overlapRows } = dedupePerfectPrototypeMatches({
    matches: matchRows,
    rules: collectedRules,
  })
  const datasetStats = {
    rowCount: rowMeta.rowCount,
    positiveRowCount: rowMeta.allPositiveTyped.length,
    negativeRowCount: rowMeta.allNegativeTyped.length,
  }
  const datasetContract = normalizePerfectPrototypeDatasetContract(
    manifest?.datasetContract ??
      summary?.manifest?.datasetContract ??
      summary?.datasetContract ?? {
        rowCount: rowMeta.rowCount,
        strategyModes: rowMeta.datasetStrategyMode ? [rowMeta.datasetStrategyMode] : [],
        minDateKey: rowMeta.calendarDateKeys[0] ?? null,
        maxDateKey: rowMeta.calendarDateKeys[rowMeta.calendarDateKeys.length - 1] ?? null,
        hasMeaningfulEventMetaRows: false,
        hasMeaningfulEventFeatureRows: false,
        hasForbiddenPredictiveTags: false,
      },
  )
  const coverage = buildPerfectPrototypeCoverageReport({
    rows: [],
    rules: collectedRules,
    matches: matchRows,
    dedupedMatches,
    datasetStats,
  })
  const augmentedCoverage = augmentIndexedCoverageTemporalMetrics({
    coverage,
    matchRows,
    calendarDateKeys: rowMeta.calendarDateKeys,
    foldScheme: cfg.foldScheme,
  })
  const supportCaseMatchedRuleIds = uniqueSorted(
    (Array.isArray(collectedRules) ? collectedRules : [])
      .filter(
        (rule) =>
          evaluatePerfectPrototypeRuleSupportCases({
            rule,
            supportCases: cfg.supportCases,
          }).matchesSupportCases === true,
      )
      .map((rule) => String(rule?.ruleId ?? "").trim())
      .filter(Boolean),
  )
  rejectionSummary.supportCaseMatchedRuleCount = supportCaseMatchedRuleIds.length
  rejectionSummary.supportCaseMatchedRuleIds = supportCaseMatchedRuleIds
  const catalogPath = path.join(resolvedOutDir, "catalog.json")
  const sourceRunId =
    resolvePerfectPrototypeSourceRunId({
      catalogPath: catalogPath,
      metadata: { sourceRunId: cfg?.sourceRunId ?? null },
    }) ?? null
  const catalog = buildPerfectPrototypeCatalog({
    tokenizerSpec,
    rules: collectedRules,
    rows: [],
    matches: matchRows,
    dedupedMatches,
    metadata: {
      trainStartDate: cfg.trainStartDate,
      trainEndDate: cfg.trainEndDate,
      minHitCount: cfg.minHitCount,
      minTrainPrecision: cfg.minTrainPrecision,
      maxTrainHitCount: cfg.maxTrainHitCount,
      enableTrainMatchedDatePrune: cfg.enableTrainMatchedDatePrune,
      minTrainMatchedDates: cfg.minTrainMatchedDates,
      minTrainMatchedMonths: cfg.minTrainMatchedMonths,
      minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
      minTrainMatchedFolds: cfg.minTrainMatchedFolds,
      midFamilyMinShare: cfg.midFamilyMinShare,
      lowFamilyMinShare: cfg.lowFamilyMinShare,
      lowFamilySearchMinHitCount: cfg.lowFamilySearchMinHitCount,
      lowFamilyMinTrainMatchedDates: cfg.lowFamilyMinTrainMatchedDates,
      lowFamilyMinTrainMatchedMonths: cfg.lowFamilyMinTrainMatchedMonths,
      lowFamilyMinTrainMatchedFolds: cfg.lowFamilyMinTrainMatchedFolds,
      enableSubgroupPrepass: cfg.enableSubgroupPrepass === true,
      subgroupMinMatchedDates: cfg.subgroupMinMatchedDates,
      subgroupMinMatchedMonths: cfg.subgroupMinMatchedMonths,
      subgroupMinMatchedFolds: cfg.subgroupMinMatchedFolds,
      subgroupMaxRootSeeds: cfg.subgroupMaxRootSeeds,
      enableSubgroupStability: cfg.enableSubgroupStability === true,
      enableSubgroupDiversity: cfg.enableSubgroupDiversity === true,
      enableExactCompletionSolver: cfg.enableExactCompletionSolver === true,
      exactCompletionMode: cfg.exactCompletionMode ?? null,
      exactCompletionMaxCandidates: cfg.exactCompletionMaxCandidates ?? null,
      exactCompletionMaxAdditionalTokens: cfg.exactCompletionMaxAdditionalTokens ?? null,
      enableCrossfitHardNegativeRefinement:
        cfg.enableCrossfitHardNegativeRefinement === true,
      crossfitHoldoutWindows: cfg.crossfitHoldoutWindows ?? null,
      crossfitMinWindowSupport: cfg.crossfitMinWindowSupport ?? null,
      crossfitHardNegativeWeight: cfg.crossfitHardNegativeWeight ?? null,
      enableJointFeasibilitySolver: cfg.enableJointFeasibilitySolver === true,
      jointFeasibilityMinCrossfitPositiveWindows:
        cfg.jointFeasibilityMinCrossfitPositiveWindows ?? null,
      jointFeasibilityMaxCrossfitNegativeWindows:
        cfg.jointFeasibilityMaxCrossfitNegativeWindows ?? null,
      jointFeasibilityRequireHistoricalSupport:
        cfg.jointFeasibilityRequireHistoricalSupport === true,
      jointFeasibilityHistoricalSupportCaseIds:
        Array.isArray(cfg.jointFeasibilityHistoricalSupportCaseIds)
          ? cfg.jointFeasibilityHistoricalSupportCaseIds.slice()
          : [],
      subgroupMaxManifests: cfg.subgroupMaxManifests,
      subgroupMinSelectionFrequency: cfg.subgroupMinSelectionFrequency,
      subgroupMinFoldPresenceCount: cfg.subgroupMinFoldPresenceCount,
      subgroupMinWindowPresenceCount: cfg.subgroupMinWindowPresenceCount,
      subgroupMaxTokenJaccard: cfg.subgroupMaxTokenJaccard,
      subgroupMaxAxisOverlap: cfg.subgroupMaxAxisOverlap,
      subgroupMaxDateCoverJaccard: cfg.subgroupMaxDateCoverJaccard,
      subgroupEarlyDateRetentionRatio: cfg.subgroupEarlyDateRetentionRatio,
      subgroupEarlyMonthRetentionRatio: cfg.subgroupEarlyMonthRetentionRatio,
      subgroupEarlyFoldRetentionRatio: cfg.subgroupEarlyFoldRetentionRatio,
      recentOnlyFamilyIds: Array.isArray(cfg.recentOnlyFamilyIds)
        ? Array.from(cfg.recentOnlyFamilyIds)
        : [],
      topFamilyMaxQuota: cfg.topFamilyMaxQuota,
      midFamilyMinQuota: cfg.midFamilyMinQuota,
      lowFamilyMinQuota: cfg.lowFamilyMinQuota,
      maxTop1DateHitShare: cfg.maxTop1DateHitShare,
      maxTop3DateHitShare: cfg.maxTop3DateHitShare,
      enablePromotableSearchPrune: cfg.enablePromotableSearchPrune === true,
      enablePromotableSearchOrdering: cfg.enablePromotableSearchOrdering === true,
      promotableMinTrainMatchedDates: cfg.promotableMinTrainMatchedDates ?? null,
      promotableMinTrainMatchedMonths: cfg.promotableMinTrainMatchedMonths ?? null,
      promotableMinTrainMatchedFolds: cfg.promotableMinTrainMatchedFolds ?? null,
      promotableMaxTop1DateHitShare: cfg.promotableMaxTop1DateHitShare ?? null,
      promotableMaxTop3DateHitShare: cfg.promotableMaxTop3DateHitShare ?? null,
      promotableMaxTop1FoldHitShare: cfg.promotableMaxTop1FoldHitShare ?? null,
      promotableMaxTop3FoldHitShare: cfg.promotableMaxTop3FoldHitShare ?? null,
      maxRulesPerMatchedDateSignature: cfg.maxRulesPerMatchedDateSignature,
      maxRulesPerMatchedMonthSignature: cfg.maxRulesPerMatchedMonthSignature,
      maxRulesPerMatchedQuarterSignature: cfg.maxRulesPerMatchedQuarterSignature,
      enableDiverseSearchOrdering: cfg.enableDiverseSearchOrdering,
      diverseBeamMaxPerMonthSignature: cfg.diverseBeamMaxPerMonthSignature,
      diverseBeamMaxPerQuarterSignature: cfg.diverseBeamMaxPerQuarterSignature,
      diverseBeamMaxPerAnchorFamily: cfg.diverseBeamMaxPerAnchorFamily,
      enableDiverseCatalogSelection: cfg.enableDiverseCatalogSelection,
      enableMdlCatalogSelection: cfg.enableMdlCatalogSelection,
      diverseCatalogTargetRules: cfg.diverseCatalogTargetRules,
      diverseNoveltyWeight: cfg.diverseNoveltyWeight,
      diverseOverlapPenaltyWeight: cfg.diverseOverlapPenaltyWeight,
      diverseAnchorFamilyPenaltyWeight: cfg.diverseAnchorFamilyPenaltyWeight,
      mdlDescriptionLengthWeight: cfg.mdlDescriptionLengthWeight,
      mdlOverlapPenaltyWeight: cfg.mdlOverlapPenaltyWeight,
      maxGapTradingDays: cfg.maxGapTradingDays,
      maxRuleSize: cfg.maxRuleSize,
      maxSeedTokens: cfg.maxSeedTokens,
      maxRules: cfg.maxRules,
      maxSearchStates: cfg.maxSearchStates,
      exploredStates,
      surfaceName: cfg.surfaceName,
      searchMode: cfg.searchMode,
      collectionMode: resolvePerfectPrototypeCollectionMode(cfg.minTrainPrecision),
      sourceRunId,
      rejectionSummary,
      selectorReport,
      supportCasesFile: cfg.supportCasesFile ?? null,
      supportCaseIds: rejectionSummary.supportCaseIds ?? [],
      supportCaseCount: rejectionSummary.supportCaseCount ?? 0,
      supportCaseDonorRuleIds: rejectionSummary.supportCaseDonorRuleIds ?? [],
      supportCaseDonorTokenCount: rejectionSummary.supportCaseDonorTokenCount ?? 0,
      supportCaseRootSeedCandidateCount:
        rejectionSummary.supportCaseRootSeedCandidateCount ?? 0,
      supportCaseFilteredRootSeedCount:
        rejectionSummary.supportCaseFilteredRootSeedCount ?? 0,
      supportCaseEffectiveRootSeedCount:
        rejectionSummary.supportCaseEffectiveRootSeedCount ?? 0,
      supportCaseCompressionRatio:
        rejectionSummary.supportCaseCompressionRatio ?? null,
      supportCaseCompressionAchieved:
        rejectionSummary.supportCaseCompressionAchieved ?? null,
      supportCaseMatchedRuleCount:
        rejectionSummary.supportCaseMatchedRuleCount ?? 0,
      supportCaseMatchedRuleIds:
        rejectionSummary.supportCaseMatchedRuleIds ?? [],
      subgroupCandidateCount: rejectionSummary.subgroupCandidateCount ?? 0,
      subgroupQualifiedCandidateCount:
        rejectionSummary.subgroupQualifiedCandidateCount ?? 0,
      subgroupEffectiveRootSeedCount:
        rejectionSummary.subgroupEffectiveRootSeedCount ?? 0,
      subgroupManifestCandidateCount:
        rejectionSummary.subgroupManifestCandidateCount ?? 0,
      subgroupStableManifestCount:
        rejectionSummary.subgroupStableManifestCount ?? 0,
      subgroupDiverseManifestCount:
        rejectionSummary.subgroupDiverseManifestCount ?? 0,
      subgroupBundleManifestCount:
        rejectionSummary.subgroupBundleManifestCount ?? 0,
      subgroupExactEntryCandidateCount:
        rejectionSummary.subgroupExactEntryCandidateCount ?? 0,
      subgroupExactEntryAcceptedCount:
        rejectionSummary.subgroupExactEntryAcceptedCount ?? 0,
      subgroupExactEntryRejectedCount:
        rejectionSummary.subgroupExactEntryRejectedCount ?? 0,
      subgroupExactEntryRejectReasonCounts:
        rejectionSummary.subgroupExactEntryRejectReasonCounts ?? {},
      subgroupExactEntryRejectReasonByFamily:
        rejectionSummary.subgroupExactEntryRejectReasonByFamily ?? {},
      subgroupExactEntrySeedPreviewByFamily:
        rejectionSummary.subgroupExactEntrySeedPreviewByFamily ?? {},
      exactCompletionManifestCount:
        rejectionSummary.exactCompletionManifestCount ?? 0,
      exactCompletionSolvedCount:
        rejectionSummary.exactCompletionSolvedCount ?? 0,
      exactCompletionUnsatCount:
        rejectionSummary.exactCompletionUnsatCount ?? 0,
      exactCompletionCollectedRuleCount:
        rejectionSummary.exactCompletionCollectedRuleCount ?? 0,
      exactCompletionCollectionRejectCount:
        rejectionSummary.exactCompletionCollectionRejectCount ?? 0,
      exactCompletionUnsatReasonCounts:
        rejectionSummary.exactCompletionUnsatReasonCounts ?? {},
      exactCompletionCandidatePoolSizeByManifest:
        rejectionSummary.exactCompletionCandidatePoolSizeByManifest ?? {},
      exactCompletionNegativeFrontierSizeByManifest:
        rejectionSummary.exactCompletionNegativeFrontierSizeByManifest ?? {},
      exactCompletionUnsatReasonByManifest:
        rejectionSummary.exactCompletionUnsatReasonByManifest ?? {},
      crossfitWindowCount:
        rejectionSummary.crossfitWindowCount ?? 0,
      crossfitMatchedWindowCount:
        rejectionSummary.crossfitMatchedWindowCount ?? 0,
      crossfitNegativeWindowCount:
        rejectionSummary.crossfitNegativeWindowCount ?? 0,
      crossfitFalsePositiveRowCount:
        rejectionSummary.crossfitFalsePositiveRowCount ?? 0,
      hardNegativeAddedCount:
        rejectionSummary.hardNegativeAddedCount ?? 0,
      hardNegativeRefinedRuleCount:
        rejectionSummary.hardNegativeRefinedRuleCount ?? 0,
      jointFeasibilityManifestCount:
        rejectionSummary.jointFeasibilityManifestCount ?? 0,
      jointFeasibilitySolvedCount:
        rejectionSummary.jointFeasibilitySolvedCount ?? 0,
      jointFeasibilityUnsatCount:
        rejectionSummary.jointFeasibilityUnsatCount ?? 0,
      jointFeasibilityUnsatReasonCounts:
        rejectionSummary.jointFeasibilityUnsatReasonCounts ?? {},
      jointHistoricalSupportMatchedCount:
        rejectionSummary.jointHistoricalSupportMatchedCount ?? 0,
      jointCrossfitRetainedPositiveWindowCount:
        rejectionSummary.jointCrossfitRetainedPositiveWindowCount ?? 0,
      jointCrossfitNegativeWindowCount:
        rejectionSummary.jointCrossfitNegativeWindowCount ?? 0,
      exactCoreCandidateCount:
        rejectionSummary.exactCoreCandidateCount ?? 0,
      exactCoreQualifiedCount:
        rejectionSummary.exactCoreQualifiedCount ?? 0,
      exactCoreSolvedCount:
        rejectionSummary.exactCoreSolvedCount ?? 0,
      exactCoreUnsatCount:
        rejectionSummary.exactCoreUnsatCount ?? 0,
      exactCoreUnsatReasonCounts:
        rejectionSummary.exactCoreUnsatReasonCounts ?? {},
      exactCoreFrontierBestRetainedDateCount:
        rejectionSummary.exactCoreFrontierBestRetainedDateCount ?? 0,
      exactCoreFrontierBestRetainedMonthCount:
        rejectionSummary.exactCoreFrontierBestRetainedMonthCount ?? 0,
      exactCoreFrontierBestRetainedFoldCount:
        rejectionSummary.exactCoreFrontierBestRetainedFoldCount ?? 0,
      subgroupBundlePreviewByFamily:
        rejectionSummary.subgroupBundlePreviewByFamily ?? {},
      subgroupAcceptedPreviewByFamily:
        rejectionSummary.subgroupAcceptedPreviewByFamily ?? {},
      subgroupStageReasonByFamily:
        rejectionSummary.subgroupStageReasonByFamily ?? {},
      subgroupRejectedCounts: rejectionSummary.subgroupRejectedCounts ?? {},
      subgroupPrefixPruneCount: rejectionSummary.subgroupPrefixPruneCount ?? 0,
      subgroupPrefixPruneCountByFamily:
        rejectionSummary.subgroupPrefixPruneCountByFamily ?? {},
      subgroupBreadthFloorPruneCount:
        rejectionSummary.subgroupBreadthFloorPruneCount ?? 0,
      subgroupBreadthFloorPruneCountByFamily:
        rejectionSummary.subgroupBreadthFloorPruneCountByFamily ?? {},
      datasetContract,
      indexManifestPath: manifestPath,
    },
    datasetStats,
  })
  const catalogManifest = buildPerfectPrototypeCatalogManifest({
    catalog,
    catalogPath,
  })

  await ensureDir(resolvedOutDir)
  await writeJson(catalogPath, catalog)
  await writeJson(resolvePerfectPrototypeCatalogManifestPath(catalogPath), catalogManifest)
  await writeJson(path.join(resolvedOutDir, "champion.json"), {
    champion: catalog.champion,
    summary: catalog.summary,
  })
  await writeJson(path.join(resolvedOutDir, "champion_rules.json"), {
    championRules: catalog.champion ? [catalog.champion] : [],
    summary: catalog.summary,
  })
  await writeJsonl(path.join(resolvedOutDir, "matches.jsonl"), matchRows)
  await writeJsonl(path.join(resolvedOutDir, "deduped_matches.jsonl"), dedupedMatches)
  await writeJsonl(path.join(resolvedOutDir, "rejected_rules.jsonl"), rejectedRules)
  await writeJson(path.join(resolvedOutDir, "negative_separation_report.json"), negativeSeparationReport)
  await writeJson(path.join(resolvedOutDir, "coverage.json"), augmentedCoverage)
  await writeJson(path.join(resolvedOutDir, "coverage_report.json"), augmentedCoverage)
  await writeJsonAtomic(path.join(resolvedOutDir, "summary.json"), {
    indexDir: resolvedIndexDir,
    outDir: resolvedOutDir,
    surfaceName: cfg.surfaceName,
    searchMode: cfg.searchMode,
    hitCountMode: cfg.hitCountMode ?? null,
    hitCountDaySymbolCap: cfg.hitCountDaySymbolCap ?? null,
    enableLaneStratifiedMining: cfg.enableLaneStratifiedMining === true,
    enableDiverseCatalogSelection: cfg.enableDiverseCatalogSelection === true,
    enableMdlCatalogSelection: cfg.enableMdlCatalogSelection === true,
    foldScheme: cfg.foldScheme ?? null,
    minTrainMatchedDates: cfg.minTrainMatchedDates,
    minTrainMatchedMonths: cfg.minTrainMatchedMonths,
    minTrainMatchedQuarters: cfg.minTrainMatchedQuarters,
    minTrainMatchedFolds: cfg.minTrainMatchedFolds,
    enableSubgroupPrepass: cfg.enableSubgroupPrepass === true,
    enableExactCompletionSolver: cfg.enableExactCompletionSolver === true,
    exactCompletionMode: cfg.exactCompletionMode ?? null,
    exactCompletionMaxCandidates: cfg.exactCompletionMaxCandidates ?? null,
    exactCompletionMaxAdditionalTokens: cfg.exactCompletionMaxAdditionalTokens ?? null,
    enableCrossfitHardNegativeRefinement:
      cfg.enableCrossfitHardNegativeRefinement === true,
    crossfitHoldoutWindows: cfg.crossfitHoldoutWindows ?? null,
    crossfitMinWindowSupport: cfg.crossfitMinWindowSupport ?? null,
    crossfitHardNegativeWeight: cfg.crossfitHardNegativeWeight ?? null,
    enableJointFeasibilitySolver: cfg.enableJointFeasibilitySolver === true,
    jointFeasibilityMinCrossfitPositiveWindows:
      cfg.jointFeasibilityMinCrossfitPositiveWindows ?? null,
    jointFeasibilityMaxCrossfitNegativeWindows:
      cfg.jointFeasibilityMaxCrossfitNegativeWindows ?? null,
    jointFeasibilityRequireHistoricalSupport:
      cfg.jointFeasibilityRequireHistoricalSupport === true,
    jointFeasibilityHistoricalSupportCaseIds:
      Array.isArray(cfg.jointFeasibilityHistoricalSupportCaseIds)
        ? cfg.jointFeasibilityHistoricalSupportCaseIds.slice()
        : [],
    subgroupMinMatchedDates: cfg.subgroupMinMatchedDates,
    subgroupMinMatchedMonths: cfg.subgroupMinMatchedMonths,
    subgroupMinMatchedFolds: cfg.subgroupMinMatchedFolds,
    subgroupMaxRootSeeds: cfg.subgroupMaxRootSeeds,
    midFamilyMinShare: cfg.midFamilyMinShare,
    lowFamilyMinShare: cfg.lowFamilyMinShare,
    lowFamilyMinTrainMatchedDates: cfg.lowFamilyMinTrainMatchedDates,
    lowFamilyMinTrainMatchedMonths: cfg.lowFamilyMinTrainMatchedMonths,
    lowFamilyMinTrainMatchedFolds: cfg.lowFamilyMinTrainMatchedFolds,
    supportCasesFile: cfg.supportCasesFile ?? null,
    supportCaseIds: rejectionSummary.supportCaseIds ?? [],
    supportCaseCount: rejectionSummary.supportCaseCount ?? 0,
    supportCaseDonorRuleIds: rejectionSummary.supportCaseDonorRuleIds ?? [],
    supportCaseDonorTokenCount: rejectionSummary.supportCaseDonorTokenCount ?? 0,
    supportCaseRootSeedCandidateCount: rejectionSummary.supportCaseRootSeedCandidateCount ?? 0,
    supportCaseFilteredRootSeedCount: rejectionSummary.supportCaseFilteredRootSeedCount ?? 0,
    supportCaseEffectiveRootSeedCount:
      rejectionSummary.supportCaseEffectiveRootSeedCount ?? 0,
    supportCaseCompressionRatio: rejectionSummary.supportCaseCompressionRatio ?? null,
    supportCaseCompressionAchieved: rejectionSummary.supportCaseCompressionAchieved ?? null,
    supportCaseMatchedRuleCount: rejectionSummary.supportCaseMatchedRuleCount ?? 0,
    supportCaseMatchedRuleIds: rejectionSummary.supportCaseMatchedRuleIds ?? [],
    subgroupCandidateCount: rejectionSummary.subgroupCandidateCount ?? 0,
    subgroupQualifiedCandidateCount:
      rejectionSummary.subgroupQualifiedCandidateCount ?? 0,
    subgroupEffectiveRootSeedCount:
      rejectionSummary.subgroupEffectiveRootSeedCount ?? 0,
    subgroupManifestCandidateCount:
      rejectionSummary.subgroupManifestCandidateCount ?? 0,
    subgroupStableManifestCount:
      rejectionSummary.subgroupStableManifestCount ?? 0,
    subgroupDiverseManifestCount:
      rejectionSummary.subgroupDiverseManifestCount ?? 0,
    subgroupBundleManifestCount:
      rejectionSummary.subgroupBundleManifestCount ?? 0,
    subgroupExactEntryCandidateCount:
      rejectionSummary.subgroupExactEntryCandidateCount ?? 0,
    subgroupExactEntryAcceptedCount:
      rejectionSummary.subgroupExactEntryAcceptedCount ?? 0,
    subgroupExactEntryRejectedCount:
      rejectionSummary.subgroupExactEntryRejectedCount ?? 0,
    subgroupExactEntryRejectReasonCounts:
      rejectionSummary.subgroupExactEntryRejectReasonCounts ?? {},
    subgroupExactEntryRejectReasonByFamily:
      rejectionSummary.subgroupExactEntryRejectReasonByFamily ?? {},
    subgroupExactEntrySeedPreviewByFamily:
      rejectionSummary.subgroupExactEntrySeedPreviewByFamily ?? {},
    exactCompletionManifestCount:
      rejectionSummary.exactCompletionManifestCount ?? 0,
    exactCompletionSolvedCount:
      rejectionSummary.exactCompletionSolvedCount ?? 0,
    exactCompletionUnsatCount:
      rejectionSummary.exactCompletionUnsatCount ?? 0,
    exactCompletionCollectedRuleCount:
      rejectionSummary.exactCompletionCollectedRuleCount ?? 0,
    exactCompletionCollectionRejectCount:
      rejectionSummary.exactCompletionCollectionRejectCount ?? 0,
    exactCompletionUnsatReasonCounts:
      rejectionSummary.exactCompletionUnsatReasonCounts ?? {},
    exactCompletionCandidatePoolSizeByManifest:
      rejectionSummary.exactCompletionCandidatePoolSizeByManifest ?? {},
    exactCompletionNegativeFrontierSizeByManifest:
      rejectionSummary.exactCompletionNegativeFrontierSizeByManifest ?? {},
    exactCompletionUnsatReasonByManifest:
      rejectionSummary.exactCompletionUnsatReasonByManifest ?? {},
    crossfitWindowCount:
      rejectionSummary.crossfitWindowCount ?? 0,
    crossfitMatchedWindowCount:
      rejectionSummary.crossfitMatchedWindowCount ?? 0,
    crossfitNegativeWindowCount:
      rejectionSummary.crossfitNegativeWindowCount ?? 0,
    crossfitFalsePositiveRowCount:
      rejectionSummary.crossfitFalsePositiveRowCount ?? 0,
    hardNegativeAddedCount:
      rejectionSummary.hardNegativeAddedCount ?? 0,
    hardNegativeRefinedRuleCount:
      rejectionSummary.hardNegativeRefinedRuleCount ?? 0,
    jointFeasibilityManifestCount:
      rejectionSummary.jointFeasibilityManifestCount ?? 0,
    jointFeasibilitySolvedCount:
      rejectionSummary.jointFeasibilitySolvedCount ?? 0,
    jointFeasibilityUnsatCount:
      rejectionSummary.jointFeasibilityUnsatCount ?? 0,
    jointFeasibilityUnsatReasonCounts:
      rejectionSummary.jointFeasibilityUnsatReasonCounts ?? {},
    jointHistoricalSupportMatchedCount:
      rejectionSummary.jointHistoricalSupportMatchedCount ?? 0,
    jointCrossfitRetainedPositiveWindowCount:
      rejectionSummary.jointCrossfitRetainedPositiveWindowCount ?? 0,
    jointCrossfitNegativeWindowCount:
      rejectionSummary.jointCrossfitNegativeWindowCount ?? 0,
    exactCoreCandidateCount:
      rejectionSummary.exactCoreCandidateCount ?? 0,
    exactCoreQualifiedCount:
      rejectionSummary.exactCoreQualifiedCount ?? 0,
    exactCoreSolvedCount:
      rejectionSummary.exactCoreSolvedCount ?? 0,
    exactCoreUnsatCount:
      rejectionSummary.exactCoreUnsatCount ?? 0,
    exactCoreUnsatReasonCounts:
      rejectionSummary.exactCoreUnsatReasonCounts ?? {},
    exactCoreFrontierBestRetainedDateCount:
      rejectionSummary.exactCoreFrontierBestRetainedDateCount ?? 0,
    exactCoreFrontierBestRetainedMonthCount:
      rejectionSummary.exactCoreFrontierBestRetainedMonthCount ?? 0,
    exactCoreFrontierBestRetainedFoldCount:
      rejectionSummary.exactCoreFrontierBestRetainedFoldCount ?? 0,
    subgroupBundlePreviewByFamily:
      rejectionSummary.subgroupBundlePreviewByFamily ?? {},
    subgroupAcceptedPreviewByFamily:
      rejectionSummary.subgroupAcceptedPreviewByFamily ?? {},
    subgroupStageReasonByFamily:
      rejectionSummary.subgroupStageReasonByFamily ?? {},
    subgroupRejectedCounts: rejectionSummary.subgroupRejectedCounts ?? {},
    subgroupPrefixPruneCount: rejectionSummary.subgroupPrefixPruneCount ?? 0,
    subgroupPrefixPruneCountByFamily:
      rejectionSummary.subgroupPrefixPruneCountByFamily ?? {},
    subgroupBreadthFloorPruneCount:
      rejectionSummary.subgroupBreadthFloorPruneCount ?? 0,
    subgroupBreadthFloorPruneCountByFamily:
      rejectionSummary.subgroupBreadthFloorPruneCountByFamily ?? {},
    topFamilyMaxQuota: cfg.topFamilyMaxQuota,
    midFamilyMinQuota: cfg.midFamilyMinQuota,
    lowFamilyMinQuota: cfg.lowFamilyMinQuota,
    enablePromotableSearchPrune: cfg.enablePromotableSearchPrune === true,
    enablePromotableSearchOrdering: cfg.enablePromotableSearchOrdering === true,
    promotableMinTrainMatchedDates: cfg.promotableMinTrainMatchedDates ?? null,
    promotableMinTrainMatchedMonths: cfg.promotableMinTrainMatchedMonths ?? null,
    promotableMinTrainMatchedFolds: cfg.promotableMinTrainMatchedFolds ?? null,
    promotableMaxTop1DateHitShare: cfg.promotableMaxTop1DateHitShare ?? null,
    promotableMaxTop3DateHitShare: cfg.promotableMaxTop3DateHitShare ?? null,
    promotableMaxTop1FoldHitShare: cfg.promotableMaxTop1FoldHitShare ?? null,
    promotableMaxTop3FoldHitShare: cfg.promotableMaxTop3FoldHitShare ?? null,
    rows: rowMeta.rowCount,
    rules: collectedRules.length,
    exploredStates,
    datasetContract,
    tokenizer: {
      surface: tokenizerSpec?.surface ?? null,
      numericFeatureCount: Array.isArray(tokenizerSpec?.numericFeatures)
        ? tokenizerSpec.numericFeatures.length
        : 0,
      binCount: Number(tokenizerSpec?.options?.binCount ?? 0),
    },
    rejectionSummary,
    selectorReport,
    negativeSeparationReport,
    coverage: augmentedCoverage,
    ...(contributionTelemetry && typeof contributionTelemetry === "object"
      ? contributionTelemetry
      : {}),
    sourceManifestPath: manifestPath,
    sourceSummaryPath: summaryPath,
    catalogContentSha256: catalog?.metadata?.catalogContentSha256 ?? null,
    ruleIdsSha256: catalog?.metadata?.ruleIdsSha256 ?? null,
    catalogManifestPath: resolvePerfectPrototypeCatalogManifestPath(catalogPath),
  })
  return {
    datasetRows: [],
    matchRows,
    dedupedMatches,
    overlapRows,
    coverage: augmentedCoverage,
    catalog,
    datasetContract,
  }
}

const resolvePerfectPrototypeIndexedMinerStaticContext = async ({
  cwd = process.cwd(),
  indexDir,
  options = {},
}) => {
  const resolvedIndexDir = path.resolve(indexDir)
  const resolveIndexArtifactPath = (value, fallbackName) => {
    const normalized = String(value ?? "").trim()
    if (!normalized) return path.join(resolvedIndexDir, fallbackName)
    return path.isAbsolute(normalized) ? normalized : path.join(resolvedIndexDir, normalized)
  }
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const partitionManifestPath = path.join(resolvedIndexDir, "partition_manifest.json")
  const tokenizerSpecPath = path.join(resolvedIndexDir, "tokenizer_spec.json")
  const rowMetaPath = path.join(resolvedIndexDir, "row_meta.parquet")
  const tokenStatsPath = path.join(resolvedIndexDir, "token_stats.parquet")
  const manifest = await readJson(manifestPath, null)
  const summary = await readOptionalJson(summaryPath)
  const partitionManifest = await readOptionalJson(partitionManifestPath)
  const tokenizerSpec = await readJson(tokenizerSpecPath, null)
  const tokenPostingsBinPath =
    resolveIndexArtifactPath(manifest?.tokenPostingsBinPath, "token_postings.bin")
  const tokenDictionaryParquetPath =
    resolveIndexArtifactPath(manifest?.tokenDictionaryParquetPath, "token_dictionary.parquet")
  const rowTokenOffsetsBinPath =
    resolveIndexArtifactPath(manifest?.rowTokenOffsetsBinPath, "row_token_offsets.bin")
  const rowTokenIdsBinPath =
    resolveIndexArtifactPath(manifest?.rowTokenIdsBinPath, "row_token_ids.bin")
  const rowTokenIdWidthBitsCandidate = Math.floor(Number(manifest?.rowTokenIdWidthBits) || 0)
  const rowTokenIdWidthBits =
    rowTokenIdWidthBitsCandidate === 16 || rowTokenIdWidthBitsCandidate === 32
      ? rowTokenIdWidthBitsCandidate
      : null
  if (!tokenizerSpec) {
    throw new Error(`Indexed miner missing tokenizer_spec.json: ${tokenizerSpecPath}`)
  }
  assertPerfectPrototypeTokenizerSpecIntegrity({
    indexDir: resolvedIndexDir,
    tokenizerSpec,
    manifest,
    summary,
    partitionManifest,
  })
  if (!pathExists(tokenDictionaryParquetPath)) {
    throw new Error(`Indexed miner missing token_dictionary.parquet: ${tokenDictionaryParquetPath}`)
  }
  const cfg = normalizeMinerOptions({
    ...options,
    surfaceName: tokenizerSpec?.surface ?? options?.surfaceName,
    tokenizerOptions: tokenizerSpec?.options ?? options?.tokenizerOptions,
  })
  return {
    cwd,
    resolvedIndexDir,
    duckdb,
    manifestPath,
    summaryPath,
    partitionManifestPath,
    tokenizerSpecPath,
    rowMetaPath,
    tokenStatsPath,
    tokenPostingsBinPath,
    tokenDictionaryParquetPath,
    rowTokenOffsetsBinPath,
    rowTokenIdsBinPath,
    rowTokenIdWidthBits,
    manifest,
    summary,
    partitionManifest,
    tokenizerSpec,
    cfg,
  }
}

export const createPerfectPrototypeIndexedWorkerSession = async ({
  cwd = process.cwd(),
  indexDir,
  options = {},
}) => {
  const staticContext = await resolvePerfectPrototypeIndexedMinerStaticContext({
    cwd,
    indexDir,
    options,
  })
  const {
    duckdb,
    resolvedIndexDir,
    manifest,
    summary,
    partitionManifest,
    rowMetaPath,
    tokenStatsPath,
    tokenDictionaryParquetPath,
    tokenPostingsBinPath,
    rowTokenOffsetsBinPath,
    rowTokenIdsBinPath,
    rowTokenIdWidthBits,
    cfg,
  } = staticContext
  const trainMatchedDatePruneEnabled =
    cfg.enableTrainMatchedDatePrune === true &&
    (Number.isInteger(Number(cfg.minTrainMatchedDates)) ||
      Number.isInteger(Number(cfg.minTrainMatchedMonths)) ||
      Number.isInteger(Number(cfg.minTrainMatchedQuarters)) ||
      Number.isInteger(Number(cfg.minTrainMatchedFolds)))
  const yearHitUpperBoundPruneEnabled =
    cfg.enableYearHitUpperBoundPrune === true &&
    Array.isArray(cfg.coreYears) &&
    cfg.coreYears.length > 0 &&
    Number.isInteger(Number(cfg.minTrainHitsPerCoreYear)) &&
    Number(cfg.minTrainHitsPerCoreYear) > 0
  const shouldResolveDetailedPositiveHitStats =
    cfg.hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE ||
    trainMatchedDatePruneEnabled ||
    yearHitUpperBoundPruneEnabled
  const datasetContract = normalizePerfectPrototypeDatasetContract(
    manifest?.datasetContract ??
      summary?.manifest?.datasetContract ??
      summary?.datasetContract ?? {
        rowCount: Number(manifest?.rowCount ?? 0) || 0,
        strategyModes: [],
        minDateKey: null,
        maxDateKey: null,
        hasMeaningfulEventMetaRows: false,
        hasMeaningfulEventFeatureRows: false,
        hasForbiddenPredictiveTags: false,
      },
  )
  await validatePerfectPrototypeIndexProvenance({
    indexDir: resolvedIndexDir,
    indexManifest: manifest,
    partitionManifest,
  })
  const seedSelectionStartedAt = Date.now()
  const seedSelection = await streamSelectPerfectPrototypeSeedEntries({
    cwd,
    duckdb,
    tokenStatsPath,
    minHitCount: cfg.minHitCount,
    maxSeedTokens: cfg.maxSeedTokens,
    maxRejectedRuleSamples: cfg.maxRejectedRuleSamples,
    expectedTokenCount:
      Number.isInteger(Number(manifest?.tokenCount)) && Number(manifest?.tokenCount) >= 0
        ? Number(manifest.tokenCount)
        : null,
  })
  const seedSelectionMs = Date.now() - seedSelectionStartedAt
  const rowMeta = await loadPerfectPrototypeIndexedRowMeta({
    cwd,
    duckdb,
    rowMetaPath,
    rowLaneMetaPath: manifest?.rowLaneMetaParquetPath ?? null,
    requireLaneMeta: shouldRequirePerfectPrototypeIndexedLaneMeta({
      cfg,
      datasetContract,
    }),
    manifest,
    summary: staticContext.summary,
  })
  const dictionaryLoadStartedAt = Date.now()
  const dictionaryByToken = await loadPerfectPrototypeTokenDictionaryEntriesByTokens({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens: seedSelection.seedEntries.map((entry) => entry.token),
    expectedUniqueTokenCount: seedSelection.seedEntries.length,
  })
  const dictionaryLoadMs = Date.now() - dictionaryLoadStartedAt
  const seedTokensOrdered = []
  const seedDictionaryEntries = []
  const seedPositiveCounts = []
  const seedNegativeCounts = []
  const seedPrecisions = []
  const seedSeparationRatios = []
  const seedSeparationLifts = []
  for (const seedStat of seedSelection.seedEntries) {
    const dictEntry = dictionaryByToken.get(seedStat.token)
    if (!dictEntry) {
      throw new Error(`Missing compressed postings entry for token=${seedStat.token}`)
    }
    seedTokensOrdered.push(seedStat.token)
    seedDictionaryEntries.push(dictEntry)
    seedPositiveCounts.push(seedStat.positiveMatchCount)
    seedNegativeCounts.push(seedStat.negativeMatchCount)
    seedPrecisions.push(seedStat.precision)
    seedSeparationRatios.push(seedStat.separationRatio)
    seedSeparationLifts.push(seedStat.separationLift)
  }
  const rowProjectedCandidateThreshold = Math.max(
    0,
    Math.floor(
      Number(
        options?.rowProjectedCandidateThreshold ??
          (String(manifest?.artifactType ?? "").trim() ===
          PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE
            ? PERFECT_PROTOTYPE_STEPB_EXACT_ROW_PROJECTED_CANDIDATE_THRESHOLD_DEFAULT
            : 0),
      ) || 0,
    ),
  )
  const rowTokenProjection =
    rowProjectedCandidateThreshold > 0
      ? await loadPerfectPrototypeIndexedRowTokenProjection({
          cwd,
          duckdb,
          tokenDictionaryParquetPath,
          rowTokenOffsetsPath: rowTokenOffsetsBinPath,
          rowTokenIdsPath: rowTokenIdsBinPath,
          rowCount: Number(manifest?.rowCount ?? 0),
          tokenPostingCount: Number(manifest?.tokenPostingCount ?? 0),
          tokenCount: Number(manifest?.tokenCount ?? 0),
          tokenIdWidthBits: rowTokenIdWidthBits,
          selectedSeedTokens: seedTokensOrdered,
        })
      : null
  const postingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r")
  const familyDistributionDictionaryEntries = await loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens: PERFECT_PROTOTYPE_INDEXED_FAMILY_DISTRIBUTION_TOKENS,
  })
  const familyDistributionPostingCache = createOptionalTokenPostingCache({
    postingsHandle,
    dictionaryEntriesByToken: familyDistributionDictionaryEntries,
    rowUniverseSize: rowMeta.rowCount,
  })
  const familyRootScopeTokens = isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })
    ? buildPerfectPrototypeRecentOnlyFamilyScopePostingTokens()
    : uniqueSorted(PERFECT_PROTOTYPE_INDEXED_FAMILY_ROOT_SCOPE_DEFINITIONS.flatMap((definition) => definition.rootTokens))
  const familyRootScopeDictionaryEntries = await loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens({
    cwd,
    duckdb,
    tokenDictionaryParquetPath,
    tokens: familyRootScopeTokens,
  })
  const familyRootScopePostingCache = createOptionalTokenPostingCache({
    postingsHandle,
    dictionaryEntriesByToken: familyRootScopeDictionaryEntries,
    rowUniverseSize: rowMeta.rowCount,
  })
  const computePositiveHitStats = createPerfectPrototypeIndexedDayCappedHitStatsComputer({
    rowDateIndexes: rowMeta.rowDateIndexes,
    calendarDateKeys: rowMeta.calendarDateKeys,
  })
  const seedPositiveCappedCounts = new Array(seedTokensOrdered.length)
  const seedPositiveDistinctDateCounts = new Array(seedTokensOrdered.length)
  const seedPositiveCoreYearHitCounts = new Array(seedTokensOrdered.length)
  const seedPositiveMaxSymbolsPerDate = new Array(seedTokensOrdered.length)
  if (shouldResolveDetailedPositiveHitStats) {
    const seedStatsPostingCache = createSeedPostingCache({
      postingsHandle,
      seedDictionaryEntries,
      rowUniverseSize: rowMeta.rowCount,
      maxEntries: Math.max(64, seedTokensOrdered.length),
    })
    for (let seedIndex = 0; seedIndex < seedTokensOrdered.length; seedIndex += 1) {
      const positiveRowset = await seedStatsPostingCache.getSeedPositiveRowset(seedIndex)
      const hitStats = computePositiveHitStats({
        rowIndexes: materializePerfectPrototypeRowsetValues(positiveRowset),
        hitCountMode: cfg.hitCountMode,
        hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
      })
      seedPositiveCappedCounts[seedIndex] = hitStats.cappedCount
      seedPositiveDistinctDateCounts[seedIndex] = hitStats.distinctDateCount
      seedPositiveCoreYearHitCounts[seedIndex] = yearHitUpperBoundPruneEnabled
        ? buildPerfectPrototypeYearHitCountsFromHitDates({
            hitDates: hitStats.hitDates,
            coreYears: cfg.coreYears,
            excludedBoundaryYears: cfg.excludedBoundaryYears,
          }).coreYearHitCounts
        : {}
      seedPositiveMaxSymbolsPerDate[seedIndex] = hitStats.maxSymbolsMatchedPerDate
    }
  } else {
    for (let seedIndex = 0; seedIndex < seedTokensOrdered.length; seedIndex += 1) {
      seedPositiveCappedCounts[seedIndex] = seedPositiveCounts[seedIndex]
      seedPositiveDistinctDateCounts[seedIndex] = 0
      seedPositiveCoreYearHitCounts[seedIndex] = {}
      seedPositiveMaxSymbolsPerDate[seedIndex] = 0
    }
  }
  return {
    version: 1,
    staticContext,
    rowMeta,
    postingsHandle,
    seedSelectionMs,
    dictionaryLoadMs,
    totalTokenCount: seedSelection.totalTokenCount,
    seedBelowMinHitCount: seedSelection.seedBelowMinHitCount,
    rejectedSeedSamples: Array.isArray(seedSelection.rejectedSeedSamples)
      ? seedSelection.rejectedSeedSamples.map((entry) => ({ ...entry }))
      : [],
    seedTokensOrdered,
    seedDictionaryEntries,
    seedPositiveCounts,
    seedPositiveCappedCounts,
    seedPositiveDistinctDateCounts,
    seedPositiveCoreYearHitCounts,
    seedPositiveMaxSymbolsPerDate,
    seedNegativeCounts,
    seedPrecisions,
    seedSeparationRatios,
    seedSeparationLifts,
    rowProjectedCandidateThreshold,
    rowTokenProjection,
    familyDistributionPostingCache,
    familyRootScopePostingCache,
    selectedSeedCount: seedTokensOrdered.length,
    closed: false,
  }
}

export const closePerfectPrototypeIndexedWorkerSession = async (session) => {
  if (!session || session.closed === true) return
  session.closed = true
  await session.postingsHandle?.close().catch(() => {})
}

export const minePerfectPrototypeIndexed = async ({
  cwd = process.cwd(),
  indexDir,
  outDir,
  options = {},
  workerSession = null,
}) => {
  const staticContext =
    workerSession?.staticContext ??
    (await resolvePerfectPrototypeIndexedMinerStaticContext({
      cwd,
      indexDir,
      options,
    }))
  const {
    resolvedIndexDir,
    duckdb,
    manifestPath,
    summaryPath,
    partitionManifestPath,
    tokenizerSpecPath,
    rowMetaPath,
    tokenStatsPath,
    tokenPostingsBinPath,
    tokenDictionaryParquetPath,
    rowTokenOffsetsBinPath,
    rowTokenIdsBinPath,
    rowTokenIdWidthBits,
    manifest,
    summary,
    partitionManifest,
    tokenizerSpec,
  } = staticContext
  const resolvedOutDir = path.resolve(outDir)
  await ensureDir(resolvedOutDir)

  const progressPath = path.join(resolvedOutDir, "progress.json")

  const cfg = normalizeMinerOptions({
    ...(staticContext?.cfg ?? {}),
    ...options,
    surfaceName: tokenizerSpec?.surface ?? options?.surfaceName,
    tokenizerOptions: tokenizerSpec?.options ?? options?.tokenizerOptions,
  })
  const supportCaseFamilyLookup = buildPerfectPrototypeSupportCaseFamilyLookup(cfg.supportCases)
  const datasetContract = normalizePerfectPrototypeDatasetContract(
    manifest?.datasetContract ??
      summary?.manifest?.datasetContract ??
      summary?.datasetContract ?? {
        rowCount: Number(summary?.rows ?? 0) || 0,
        strategyModes: [],
        minDateKey: null,
        maxDateKey: null,
        hasMeaningfulEventMetaRows: false,
        hasMeaningfulEventFeatureRows: false,
        hasForbiddenPredictiveTags: false,
      },
  )
  const rootSeedStartIndex = Math.max(0, Math.floor(Number(options?.rootSeedStartIndex ?? 0) || 0))
  const rootSeedEndIndexExclusive =
    options?.rootSeedEndIndexExclusive == null
      ? null
      : Math.max(rootSeedStartIndex, Math.floor(Number(options.rootSeedEndIndexExclusive) || 0))
  const workerChunkIndexCandidate = Math.floor(Number(options?.workerChunkIndex) || 0)
  const workerChunkIndex =
    Number.isInteger(workerChunkIndexCandidate) && workerChunkIndexCandidate >= 0
      ? workerChunkIndexCandidate
      : null
  const initialKthHitFloorCandidate = Math.floor(Number(options?.initialKthHitFloor) || 0)
  const initialKthHitFloor =
    Number.isInteger(initialKthHitFloorCandidate) && initialKthHitFloorCandidate > 0
      ? initialKthHitFloorCandidate
      : null
  const configuredMaxSearchStatesCandidate = Math.floor(
    Number(options?.configuredMaxSearchStates ?? cfg.maxSearchStates) || 0,
  )
  const configuredMaxSearchStates =
    Number.isInteger(configuredMaxSearchStatesCandidate) && configuredMaxSearchStatesCandidate > 0
      ? configuredMaxSearchStatesCandidate
      : cfg.maxSearchStates
  const allocatedMaxSearchStatesCandidate = Math.floor(
    Number(options?.allocatedMaxSearchStates ?? cfg.maxSearchStates) || 0,
  )
  const allocatedMaxSearchStates =
    Number.isInteger(allocatedMaxSearchStatesCandidate) && allocatedMaxSearchStatesCandidate > 0
      ? allocatedMaxSearchStatesCandidate
      : cfg.maxSearchStates
  const baseAllocatedMaxSearchStatesCandidate = Math.floor(
    Number(options?.baseAllocatedMaxSearchStates ?? allocatedMaxSearchStates) || 0,
  )
  const baseAllocatedMaxSearchStates =
    Number.isInteger(baseAllocatedMaxSearchStatesCandidate) &&
    baseAllocatedMaxSearchStatesCandidate > 0
      ? baseAllocatedMaxSearchStatesCandidate
      : allocatedMaxSearchStates
  const guardBandAllocatedSearchStatesCandidate = Math.floor(
    Number(options?.guardBandAllocatedSearchStates ?? 0) || 0,
  )
  const guardBandAllocatedSearchStates =
    Number.isInteger(guardBandAllocatedSearchStatesCandidate) &&
    guardBandAllocatedSearchStatesCandidate >= 0
      ? guardBandAllocatedSearchStatesCandidate
      : 0
  const rowProjectedCandidateThresholdCandidate = Math.floor(
    Number(
      options?.rowProjectedCandidateThreshold ??
        (String(manifest?.artifactType ?? "").trim() ===
        PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE
          ? PERFECT_PROTOTYPE_STEPB_EXACT_ROW_PROJECTED_CANDIDATE_THRESHOLD_DEFAULT
          : 0),
    ) || 0,
  )
  const rowProjectedCandidateThreshold =
    Number.isInteger(rowProjectedCandidateThresholdCandidate) &&
    rowProjectedCandidateThresholdCandidate > 0
      ? rowProjectedCandidateThresholdCandidate
      : 0
  const bootstrapLivePartialMaxRulesCandidate = Math.floor(
    Number(options?.bootstrapLivePartialMaxRules ?? cfg.maxRules) || 0,
  )
  const bootstrapLivePartialMaxRules =
    Number.isInteger(bootstrapLivePartialMaxRulesCandidate) &&
    bootstrapLivePartialMaxRulesCandidate > cfg.maxRules
      ? bootstrapLivePartialMaxRulesCandidate
      : cfg.maxRules
  const remainingGlobalSearchBudgetAtLaunchCandidate = Math.floor(
    Number(options?.remainingGlobalSearchBudgetAtLaunch) || 0,
  )
  const remainingGlobalSearchBudgetAtLaunch =
    Number.isInteger(remainingGlobalSearchBudgetAtLaunchCandidate) &&
    remainingGlobalSearchBudgetAtLaunchCandidate >= 0
      ? remainingGlobalSearchBudgetAtLaunchCandidate
      : null
  const externalKthHitFloorPathText = String(options?.externalKthHitFloorPath ?? "").trim()
  const externalKthHitFloorPath =
    externalKthHitFloorPathText.length > 0 ? path.resolve(externalKthHitFloorPathText) : null
  const externalKthHitFloorPollMsCandidate = Math.floor(
    Number(options?.externalKthHitFloorPollMs ?? 1000) || 0,
  )
  const externalKthHitFloorPollMs =
    Number.isInteger(externalKthHitFloorPollMsCandidate) && externalKthHitFloorPollMsCandidate > 0
      ? externalKthHitFloorPollMsCandidate
      : 1000
  const externalKthHitFloorStateIntervalCandidate = Math.floor(
    Number(options?.externalKthHitFloorStateInterval ?? 256) || 0,
  )
  const externalKthHitFloorStateInterval =
    Number.isInteger(externalKthHitFloorStateIntervalCandidate) &&
    externalKthHitFloorStateIntervalCandidate > 0
      ? externalKthHitFloorStateIntervalCandidate
      : 256
  const externalBudgetPathText = String(options?.externalBudgetPath ?? "").trim()
  const externalBudgetPath =
    externalBudgetPathText.length > 0 ? path.resolve(externalBudgetPathText) : null
  const externalBudgetRequestPathText = String(options?.externalBudgetRequestPath ?? "").trim()
  const externalBudgetRequestPath =
    externalBudgetRequestPathText.length > 0 ? path.resolve(externalBudgetRequestPathText) : null
  const externalBudgetDecisionPathText = String(options?.externalBudgetDecisionPath ?? "").trim()
  const externalBudgetDecisionPath =
    externalBudgetDecisionPathText.length > 0 ? path.resolve(externalBudgetDecisionPathText) : null
  const externalBudgetCommitPathText = String(options?.externalBudgetCommitPath ?? "").trim()
  const externalBudgetCommitPath =
    externalBudgetCommitPathText.length > 0 ? path.resolve(externalBudgetCommitPathText) : null
  const externalBudgetPollMsCandidate = Math.floor(
    Number(options?.externalBudgetPollMs ?? 1000) || 0,
  )
  const externalBudgetPollMs =
    Number.isInteger(externalBudgetPollMsCandidate) && externalBudgetPollMsCandidate > 0
      ? externalBudgetPollMsCandidate
      : 1000
  const externalBudgetDecisionPollMsCandidate = Math.floor(
    Number(options?.externalBudgetDecisionPollMs ?? Math.max(25, Math.floor(externalBudgetPollMs / 4))) ||
      0,
  )
  const externalBudgetDecisionPollMs =
    Number.isInteger(externalBudgetDecisionPollMsCandidate) &&
    externalBudgetDecisionPollMsCandidate > 0
      ? externalBudgetDecisionPollMsCandidate
      : Math.max(25, Math.floor(externalBudgetPollMs / 4))
  const externalBudgetStateIntervalCandidate = Math.floor(
    Number(options?.externalBudgetStateInterval ?? 256) || 0,
  )
  const externalBudgetStateInterval =
    Number.isInteger(externalBudgetStateIntervalCandidate) &&
    externalBudgetStateIntervalCandidate > 0
      ? externalBudgetStateIntervalCandidate
      : 256
  const externalBudgetRequestHeadroomStatesCandidate = Math.floor(
    Number(options?.externalBudgetRequestHeadroomStates ?? 4096) || 0,
  )
  const externalBudgetRequestHeadroomStates =
    Number.isInteger(externalBudgetRequestHeadroomStatesCandidate) &&
    externalBudgetRequestHeadroomStatesCandidate > 0
      ? externalBudgetRequestHeadroomStatesCandidate
      : 4096
  const externalBudgetRequestSearchStatesCandidate = Math.floor(
    Number(options?.externalBudgetRequestSearchStates ?? 8192) || 0,
  )
  const externalBudgetRequestSearchStates =
    Number.isInteger(externalBudgetRequestSearchStatesCandidate) &&
    externalBudgetRequestSearchStatesCandidate > 0
      ? externalBudgetRequestSearchStatesCandidate
      : 8192
  const externalBudgetRequestWaitMsCandidate = Math.floor(
    Number(options?.externalBudgetRequestWaitMs ?? 10000) || 0,
  )
  const externalBudgetRequestWaitMs =
    Number.isInteger(externalBudgetRequestWaitMsCandidate) &&
    externalBudgetRequestWaitMsCandidate > 0
      ? externalBudgetRequestWaitMsCandidate
      : 10000
  const outputMode = String(options?.outputMode ?? "full").trim().toLowerCase() || "full"
  if (outputMode !== "full" && outputMode !== "partial") {
    throw new Error(`Invalid indexed miner outputMode: ${outputMode}`)
  }
  const livePartialRulesPath =
    outputMode === "partial"
      ? path.join(resolvedOutDir, PERFECT_PROTOTYPE_LIVE_PARTIAL_RULES_FILENAME)
      : null
  const enableTopKBranchAndBound =
    outputMode === "full" || options?.enablePartialTopKHitBound === true
  const orderingHeadWindow = Math.max(
    0,
    Math.min(64, Math.floor(Number(options?.orderingHeadWindow ?? 8) || 0)),
  )
  const rowsetPoolRequired =
    String(process.env.PREJUMP_ROWSET_POOL_REQUIRED ?? "true").trim().toLowerCase() === "true"
  if (rowsetPoolRequired !== true) {
    throw new Error("Perfect prototype indexed miner requires PREJUMP_ROWSET_POOL_REQUIRED=true")
  }
  if (
    externalBudgetPath &&
    (!externalBudgetRequestPath || !externalBudgetDecisionPath || !externalBudgetCommitPath)
  ) {
    throw new Error(
      "Perfect prototype indexed miner requires externalBudgetRequestPath, externalBudgetDecisionPath, and externalBudgetCommitPath when externalBudgetPath is configured.",
    )
  }
  const miningStartedAt = Date.now()
  let postingsHandle = workerSession?.postingsHandle ?? null
  let familyDistributionPostingCache = workerSession?.familyDistributionPostingCache ?? null
  let familyRootScopePostingCache = workerSession?.familyRootScopePostingCache ?? null

  try {
    let rowMeta = null
    let rowCount = 0
    let rowsetModeStats = null
    let allPositiveRowset = null
    let allNegativeRowset = null
    let rejectionSummary = null
    const rejectedRules = []
    let seedTokensOrdered = []
    let seedDictionaryEntries = []
    let seedPositiveCounts = []
    let seedPositiveCappedCounts = []
    let seedPositiveDistinctDateCounts = []
    let seedPositiveDistinctMonthCounts = []
    let seedPositiveDistinctQuarterCounts = []
    let seedPositiveDistinctFoldCounts = []
    let seedPositiveMonthSignatureHashes = []
    let seedPositiveQuarterSignatureHashes = []
    let seedPositiveFoldSignatureHashes = []
    let seedPositiveCoreYearHitCounts = []
    let seedPositiveMaxSymbolsPerDate = []
    let seedDominantLaneIds = []
    let seedNegativeCounts = []
    let seedPrecisions = []
    let seedSeparationRatios = []
    let seedSeparationLifts = []
    let rowTokenProjection = null
    let selectedSeedCount = 0
    let dictionaryLoadMs = null
    let seedSelectionMs = 0
    let computePositiveHitStats = null
    const trainMatchedDatePruneEnabled =
      cfg.enableTrainMatchedDatePrune === true &&
      (Number.isInteger(Number(cfg.minTrainMatchedDates)) ||
        Number.isInteger(Number(cfg.minTrainMatchedMonths)) ||
        Number.isInteger(Number(cfg.minTrainMatchedQuarters)) ||
        Number.isInteger(Number(cfg.minTrainMatchedFolds)))
    const promotableSearchPruneEnabled =
      cfg.enablePromotableSearchPrune === true &&
      (hasConfiguredOptionalPositiveInteger(cfg.promotableMinTrainMatchedDates) ||
        hasConfiguredOptionalPositiveInteger(cfg.promotableMinTrainMatchedMonths) ||
        hasConfiguredOptionalPositiveInteger(cfg.promotableMinTrainMatchedFolds) ||
        resolveConfiguredOptionalFiniteNumber(cfg.promotableMaxTop1DateHitShare) != null ||
        resolveConfiguredOptionalFiniteNumber(cfg.promotableMaxTop3DateHitShare) != null ||
        resolveConfiguredOptionalFiniteNumber(cfg.promotableMaxTop1FoldHitShare) != null ||
        resolveConfiguredOptionalFiniteNumber(cfg.promotableMaxTop3FoldHitShare) != null)
    const promotableSearchOrderingEnabled = cfg.enablePromotableSearchOrdering === true
    const yearHitUpperBoundPruneEnabled =
      cfg.enableYearHitUpperBoundPrune === true &&
      Array.isArray(cfg.coreYears) &&
      cfg.coreYears.length > 0 &&
      Number.isInteger(Number(cfg.minTrainHitsPerCoreYear)) &&
      Number(cfg.minTrainHitsPerCoreYear) > 0
    const shouldResolveDetailedPositiveHitStats =
      cfg.hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE ||
      trainMatchedDatePruneEnabled ||
      yearHitUpperBoundPruneEnabled
    const featureContributionByKey = new Map()
    let rowContributionDiagnostics = null
    resetPerfectPrototypeRowsetRuntimeStats()
    const buildBaseRejectionSummary = ({ totalTokenCount, seedBelowMinHitCount, seedSelectionMs }) => ({
      surfaceName: cfg.surfaceName,
      collectionMode: resolvePerfectPrototypeCollectionMode(cfg.minTrainPrecision),
      minTrainPrecision: Number(cfg.minTrainPrecision ?? 1),
      enableTrainMatchedDatePrune: trainMatchedDatePruneEnabled,
      enablePromotableSearchPrune: promotableSearchPruneEnabled,
      enablePromotableSearchOrdering: promotableSearchOrderingEnabled,
      enableYearHitUpperBoundPrune: yearHitUpperBoundPruneEnabled,
      coreYears: Array.isArray(cfg.coreYears) ? cfg.coreYears.slice() : [],
      excludedBoundaryYears: Array.isArray(cfg.excludedBoundaryYears)
        ? cfg.excludedBoundaryYears.slice()
        : [],
      minTrainHitsPerCoreYear:
        Number.isInteger(Number(cfg.minTrainHitsPerCoreYear)) &&
        Number(cfg.minTrainHitsPerCoreYear) > 0
          ? Number(cfg.minTrainHitsPerCoreYear)
          : null,
      maxTrainHitCount:
        Number.isInteger(Number(cfg.maxTrainHitCount)) && Number(cfg.maxTrainHitCount) > 0
          ? Number(cfg.maxTrainHitCount)
          : null,
      minTrainMatchedDates:
        Number.isInteger(Number(cfg.minTrainMatchedDates)) && Number(cfg.minTrainMatchedDates) > 0
          ? Number(cfg.minTrainMatchedDates)
          : null,
      minTrainMatchedMonths:
        Number.isInteger(Number(cfg.minTrainMatchedMonths)) && Number(cfg.minTrainMatchedMonths) > 0
          ? Number(cfg.minTrainMatchedMonths)
          : null,
      minTrainMatchedQuarters:
        Number.isInteger(Number(cfg.minTrainMatchedQuarters)) && Number(cfg.minTrainMatchedQuarters) > 0
          ? Number(cfg.minTrainMatchedQuarters)
          : null,
      minTrainMatchedFolds:
        Number.isInteger(Number(cfg.minTrainMatchedFolds)) && Number(cfg.minTrainMatchedFolds) > 0
          ? Number(cfg.minTrainMatchedFolds)
          : null,
      promotableMinTrainMatchedDates:
        Number.isInteger(Number(cfg.promotableMinTrainMatchedDates)) &&
        Number(cfg.promotableMinTrainMatchedDates) > 0
          ? Number(cfg.promotableMinTrainMatchedDates)
          : null,
      promotableMinTrainMatchedMonths:
        Number.isInteger(Number(cfg.promotableMinTrainMatchedMonths)) &&
        Number(cfg.promotableMinTrainMatchedMonths) > 0
          ? Number(cfg.promotableMinTrainMatchedMonths)
          : null,
      promotableMinTrainMatchedFolds:
        Number.isInteger(Number(cfg.promotableMinTrainMatchedFolds)) &&
        Number(cfg.promotableMinTrainMatchedFolds) > 0
          ? Number(cfg.promotableMinTrainMatchedFolds)
          : null,
      promotableMaxTop1DateHitShare: resolveConfiguredOptionalFiniteNumber(
        cfg.promotableMaxTop1DateHitShare,
      ),
      promotableMaxTop3DateHitShare: resolveConfiguredOptionalFiniteNumber(
        cfg.promotableMaxTop3DateHitShare,
      ),
      promotableMaxTop1FoldHitShare: resolveConfiguredOptionalFiniteNumber(
        cfg.promotableMaxTop1FoldHitShare,
      ),
      promotableMaxTop3FoldHitShare: resolveConfiguredOptionalFiniteNumber(
        cfg.promotableMaxTop3FoldHitShare,
      ),
      midFamilyMinShare:
        Number.isFinite(cfg.midFamilyMinShare) ? Number(cfg.midFamilyMinShare) : null,
      lowFamilyMinShare:
        Number.isFinite(cfg.lowFamilyMinShare) ? Number(cfg.lowFamilyMinShare) : null,
      lowFamilyMinTrainMatchedDates:
        Number.isInteger(Number(cfg.lowFamilyMinTrainMatchedDates)) &&
        Number(cfg.lowFamilyMinTrainMatchedDates) > 0
          ? Number(cfg.lowFamilyMinTrainMatchedDates)
          : null,
      lowFamilyMinTrainMatchedMonths:
        Number.isInteger(Number(cfg.lowFamilyMinTrainMatchedMonths)) &&
        Number(cfg.lowFamilyMinTrainMatchedMonths) > 0
          ? Number(cfg.lowFamilyMinTrainMatchedMonths)
          : null,
      lowFamilyMinTrainMatchedFolds:
        Number.isInteger(Number(cfg.lowFamilyMinTrainMatchedFolds)) &&
        Number(cfg.lowFamilyMinTrainMatchedFolds) > 0
          ? Number(cfg.lowFamilyMinTrainMatchedFolds)
          : null,
      topFamilyMaxQuota:
        Number.isInteger(Number(cfg.topFamilyMaxQuota)) && Number(cfg.topFamilyMaxQuota) > 0
          ? Number(cfg.topFamilyMaxQuota)
          : null,
      midFamilyMinQuota:
        Number.isInteger(Number(cfg.midFamilyMinQuota)) && Number(cfg.midFamilyMinQuota) > 0
          ? Number(cfg.midFamilyMinQuota)
          : null,
      lowFamilyMinQuota:
        Number.isInteger(Number(cfg.lowFamilyMinQuota)) && Number(cfg.lowFamilyMinQuota) > 0
          ? Number(cfg.lowFamilyMinQuota)
          : null,
      enableSubgroupPrepass: cfg.enableSubgroupPrepass === true,
      subgroupMinMatchedDates:
        Number.isInteger(Number(cfg.subgroupMinMatchedDates)) && Number(cfg.subgroupMinMatchedDates) > 0
          ? Number(cfg.subgroupMinMatchedDates)
          : null,
      subgroupMinMatchedMonths:
        Number.isInteger(Number(cfg.subgroupMinMatchedMonths)) && Number(cfg.subgroupMinMatchedMonths) > 0
          ? Number(cfg.subgroupMinMatchedMonths)
          : null,
      subgroupMinMatchedFolds:
        Number.isInteger(Number(cfg.subgroupMinMatchedFolds)) && Number(cfg.subgroupMinMatchedFolds) > 0
          ? Number(cfg.subgroupMinMatchedFolds)
          : null,
      subgroupMaxRootSeeds:
        Number.isInteger(Number(cfg.subgroupMaxRootSeeds)) && Number(cfg.subgroupMaxRootSeeds) > 0
          ? Number(cfg.subgroupMaxRootSeeds)
          : null,
      foldScheme: String(cfg.foldScheme ?? "").trim() || null,
      maxTop1DateHitShare:
        Number.isFinite(cfg.maxTop1DateHitShare) ? Number(cfg.maxTop1DateHitShare) : null,
      maxTop3DateHitShare:
        Number.isFinite(cfg.maxTop3DateHitShare) ? Number(cfg.maxTop3DateHitShare) : null,
      maxTop1FoldHitShare:
        Number.isFinite(cfg.maxTop1FoldHitShare) ? Number(cfg.maxTop1FoldHitShare) : null,
      maxTop3FoldHitShare:
        Number.isFinite(cfg.maxTop3FoldHitShare) ? Number(cfg.maxTop3FoldHitShare) : null,
      maxRulesPerMatchedDateSignature:
        Number.isInteger(Number(cfg.maxRulesPerMatchedDateSignature)) &&
        Number(cfg.maxRulesPerMatchedDateSignature) > 0
          ? Number(cfg.maxRulesPerMatchedDateSignature)
          : null,
      maxRulesPerMatchedMonthSignature:
        Number.isInteger(Number(cfg.maxRulesPerMatchedMonthSignature)) &&
        Number(cfg.maxRulesPerMatchedMonthSignature) > 0
          ? Number(cfg.maxRulesPerMatchedMonthSignature)
          : null,
      maxRulesPerMatchedQuarterSignature:
        Number.isInteger(Number(cfg.maxRulesPerMatchedQuarterSignature)) &&
        Number(cfg.maxRulesPerMatchedQuarterSignature) > 0
          ? Number(cfg.maxRulesPerMatchedQuarterSignature)
          : null,
      enableDiverseSearchOrdering: cfg.enableDiverseSearchOrdering === true,
      enableLaneStratifiedMining: cfg.enableLaneStratifiedMining === true,
      enableFamilyScopedMining: cfg.enableFamilyScopedMining === true,
      familySeedMaxTopBucket:
        Number.isInteger(Number(cfg.familySeedMaxTopBucket)) && Number(cfg.familySeedMaxTopBucket) > 0
          ? Number(cfg.familySeedMaxTopBucket)
          : null,
      familySeedMaxMidBucket:
        Number.isInteger(Number(cfg.familySeedMaxMidBucket)) && Number(cfg.familySeedMaxMidBucket) > 0
          ? Number(cfg.familySeedMaxMidBucket)
          : null,
      familySeedMaxLowBucket:
        Number.isInteger(Number(cfg.familySeedMaxLowBucket)) && Number(cfg.familySeedMaxLowBucket) > 0
          ? Number(cfg.familySeedMaxLowBucket)
          : null,
      diverseBeamMaxPerMonthSignature:
        Number.isInteger(Number(cfg.diverseBeamMaxPerMonthSignature)) &&
        Number(cfg.diverseBeamMaxPerMonthSignature) > 0
          ? Number(cfg.diverseBeamMaxPerMonthSignature)
          : null,
      diverseBeamMaxPerQuarterSignature:
        Number.isInteger(Number(cfg.diverseBeamMaxPerQuarterSignature)) &&
        Number(cfg.diverseBeamMaxPerQuarterSignature) > 0
          ? Number(cfg.diverseBeamMaxPerQuarterSignature)
          : null,
      diverseBeamMaxPerAnchorFamily:
        Number.isInteger(Number(cfg.diverseBeamMaxPerAnchorFamily)) &&
        Number(cfg.diverseBeamMaxPerAnchorFamily) > 0
          ? Number(cfg.diverseBeamMaxPerAnchorFamily)
          : null,
      hitCountMode: cfg.hitCountMode,
      hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
      tokenizer: {
        surface: tokenizerSpec?.surface ?? null,
        numericFeatureCount: Array.isArray(tokenizerSpec?.numericFeatures)
          ? tokenizerSpec.numericFeatures.length
          : 0,
      },
      totalTokenCount,
      seedBelowMinHitCount,
      searchBelowMinHitCount: 0,
      noMatchChangeCount: 0,
      noNegativeSeparationProgressCount: 0,
      precisionRegressionCount: 0,
      negativeMatchCount: 0,
      precisionBelowMinTrainPrecisionCount: 0,
      aboveMaxTrainHitCountCount: 0,
      belowMinTrainMatchedDatesCount: 0,
      seedBelowMinTrainMatchedDatesCount: 0,
      trainMatchedDatesPrunedStateCount: 0,
      collectionBelowMinTrainMatchedDatesCount: 0,
      belowMinTrainMatchedMonthsCount: 0,
      seedBelowMinTrainMatchedMonthsCount: 0,
      trainMatchedMonthsPrunedStateCount: 0,
      collectionBelowMinTrainMatchedMonthsCount: 0,
      belowMinTrainMatchedQuartersCount: 0,
      seedBelowMinTrainMatchedQuartersCount: 0,
      trainMatchedQuartersPrunedStateCount: 0,
      collectionBelowMinTrainMatchedQuartersCount: 0,
      belowMinTrainMatchedFoldsCount: 0,
      seedBelowMinTrainMatchedFoldsCount: 0,
      trainMatchedFoldsPrunedStateCount: 0,
      collectionBelowMinTrainMatchedFoldsCount: 0,
      top1DateHitShareAboveMaxCount: 0,
      top3DateHitShareAboveMaxCount: 0,
      top1FoldHitShareAboveMaxCount: 0,
      top3FoldHitShareAboveMaxCount: 0,
      promotableUpperBoundPruneCount: 0,
      seedPromotableUpperBoundPruneCount: 0,
      statePromotableUpperBoundPruneCount: 0,
      candidatePromotableUpperBoundPruneCount: 0,
      promotableUpperBoundPruneCountByFamily: {},
      promotableUpperBoundReasonCounts: {},
      yearHitUpperBoundPruneCount: 0,
      seedYearHitUpperBoundPruneCount: 0,
      stateYearHitUpperBoundPruneCount: 0,
      candidateYearHitUpperBoundPruneCount: 0,
      yearHitUpperBoundPruneCountByFamily: {},
      yearHitUpperBoundReasonCounts: {},
      matchedDateSignatureBucketCapCount: 0,
      matchedMonthSignatureBucketCapCount: 0,
      matchedQuarterSignatureBucketCapCount: 0,
      laneStratifiedLaneCount: 0,
      laneStratifiedSeedCountByLane: {},
      laneStratifiedLaneOrder: [],
      familyScopedSeedBucketOrder: [],
      familyScopedSeedAcceptedCountByBucket: {},
      familyScopedSeedDeferredCountByBucket: {},
      familyCohortRowCountByFamily: {},
      familyAcceptedRootSeedCountByFamily: {},
      familyAcceptedRootSeedPreviewByFamily: {},
      familyRejectedRootSeedCountByFamily: {},
      familyRootScopeDiagnosticsByFamily: {},
      supportCaseIds: uniqueSorted((cfg.supportCases ?? []).map((entry) => entry?.caseId)),
      supportCaseCount: Array.isArray(cfg.supportCases) ? cfg.supportCases.length : 0,
      supportCaseDonorRuleIds: uniqueSorted(
        (cfg.supportCases ?? []).flatMap((entry) => entry?.donorRuleIds ?? []),
      ),
      supportCaseDonorTokenCount: uniqueSorted(
        (cfg.supportCases ?? []).flatMap((entry) => entry?.donorTokens ?? []),
      ).length,
      supportCaseRootSeedCandidateCount: 0,
      supportCaseFilteredRootSeedCount: 0,
      supportCaseEffectiveRootSeedCount: 0,
      supportCaseCompressionRatio: null,
      supportCaseCompressionAchieved: null,
      supportCaseMatchedRuleCount: 0,
      supportCaseMatchedRuleIds: [],
      subgroupCandidateCount: 0,
      subgroupQualifiedCandidateCount: 0,
      subgroupEffectiveRootSeedCount: 0,
      subgroupManifestCandidateCount: 0,
      subgroupStableManifestCount: 0,
      subgroupDiverseManifestCount: 0,
      subgroupBundleManifestCount: 0,
      subgroupExactEntryCandidateCount: 0,
      subgroupExactEntryAcceptedCount: 0,
      subgroupExactEntryRejectedCount: 0,
      subgroupExactEntryRejectReasonCounts: {},
      subgroupExactEntryRejectReasonByFamily: {},
      subgroupExactEntrySeedPreviewByFamily: {},
      exactCompletionManifestCount: 0,
      exactCompletionSolvedCount: 0,
      exactCompletionUnsatCount: 0,
      exactCompletionCollectedRuleCount: 0,
      exactCompletionCollectionRejectCount: 0,
      exactCompletionUnsatReasonCounts: {},
      exactCompletionCandidatePoolSizeByManifest: {},
      exactCompletionNegativeFrontierSizeByManifest: {},
      exactCompletionUnsatReasonByManifest: {},
      crossfitWindowCount: 0,
      crossfitMatchedWindowCount: 0,
      crossfitNegativeWindowCount: 0,
      crossfitFalsePositiveRowCount: 0,
      hardNegativeAddedCount: 0,
      hardNegativeRefinedRuleCount: 0,
      jointFeasibilityManifestCount: 0,
      jointFeasibilitySolvedCount: 0,
      jointFeasibilityUnsatCount: 0,
      jointFeasibilityUnsatReasonCounts: {},
      jointHistoricalSupportMatchedCount: 0,
      jointCrossfitRetainedPositiveWindowCount: 0,
      jointCrossfitNegativeWindowCount: 0,
      candidateAtomTypeCounts: {},
      exactCoreCandidateCount: 0,
      exactCoreQualifiedCount: 0,
      exactCoreSolvedCount: 0,
      exactCoreUnsatCount: 0,
      exactCoreUnsatReasonCounts: {},
      exactCoreFrontierBestRetainedDateCount: 0,
      exactCoreFrontierBestRetainedMonthCount: 0,
      exactCoreFrontierBestRetainedFoldCount: 0,
      subgroupBundlePreviewByFamily: {},
      subgroupAcceptedPreviewByFamily: {},
      subgroupStageReasonByFamily: {},
      subgroupRejectedCounts: {},
      subgroupPrefixPruneCount: 0,
      subgroupPrefixPruneCountByFamily: {},
      subgroupBreadthFloorPruneCount: 0,
      subgroupBreadthFloorPruneCountByFamily: {},
      familyPurityRejectCount: 0,
      familyPurityRejectCountByReason: {},
      belowMinHitCountByFamily: {},
      supportCasePrefixPruneCount: 0,
      supportCasePrefixPruneCountByFamily: {},
      supportCaseDonorPrefixPruneCount: 0,
      supportCaseDonorPrefixPruneCountByFamily: {},
      noNegativeSeparationProgressCountByFamily: {},
      boundPruneCountByFamily: {},
      scopeBudgetStopCountByFamily: {},
      finalSurvivorCountByFamily: {},
      rootScopeBudgetPlanByFamily: {},
      diverseBeamDeferredCandidateCount: 0,
      gapViolationCount: 0,
      dominatedBySmallerRuleCount: 0,
      stateDominancePruneCount: 0,
      boundPruneCount: 0,
      memoHitCount: 0,
      memoFrontierScanCount: 0,
      memoFrontierDeleteCount: 0,
      memoFrontierSkippedBucketCount: 0,
      memoFrontierCompactionCount: 0,
      memoRangeSkipPrefixCount: 0,
      memoRangeSkipSuffixCount: 0,
      memoRangeSummaryRebuildCount: 0,
      memoExactFingerprintFastHitCount: 0,
      memoExactFingerprintScanCount: 0,
      memoFingerprintMetadataRebuildCount: 0,
      initialKthHitFloor,
      externalKthHitFloor: null,
      externalKthHitFloorRevision: 0,
      externalKthHitFloorPollCount: 0,
      externalKthHitFloorAppliedCount: 0,
      externalAllocatedMaxSearchStates: null,
      externalBudgetRevision: 0,
      externalBudgetPollCount: 0,
      externalBudgetAppliedCount: 0,
      externalBudgetDecreaseAppliedCount: 0,
      externalBudgetDecreaseSearchStates: 0,
      externalBudgetAllowanceAppliedCount: 0,
      externalBudgetAllowanceSeenCount: 0,
      externalBudgetAllowanceConsumedCount: 0,
      externalBudgetRequestCount: 0,
      externalBudgetRequestSatisfiedCount: 0,
      externalBudgetRequestDeniedCount: 0,
      externalBudgetRequestPendingCount: 0,
      externalBudgetRequestWaitMs: 0,
      externalBudgetPendingWaitMs: 0,
      externalBudgetCommitRequestCount: 0,
      externalBudgetCommitRevision: 0,
      externalBudgetLastDecision: null,
      effectiveKthHitFloor: initialKthHitFloor,
      effectiveAllocatedMaxSearchStates: allocatedMaxSearchStates,
      livePartialRuleRevision: 0,
      livePartialRuleCount: 0,
      livePartialRuleCheckpointCount: 0,
      livePartialRuleWriteMs: 0,
      livePartialLocalKthHitFloor: null,
      livePartialBootstrapSnapshotCount: 0,
      livePartialBootstrapRuleCount: 0,
      livePartialBootstrapModeActive: 0,
      configuredMaxSearchStates,
      baseAllocatedMaxSearchStates,
      guardBandAllocatedSearchStates,
      allocatedMaxSearchStates,
      remainingGlobalSearchBudgetAtLaunch,
      budgetStopCount: 0,
      budgetStopExploredStates: null,
      budgetStopReason: null,
      memoFrontierBucketCount: 0,
      memoFrontierTombstoneCount: 0,
      memoFingerprintBucketPeak: 0,
      rowsetBorrowHitCount: 0,
      catalogSelectionMode:
        cfg.enableMdlCatalogSelection === true
          ? "mdl_selector_v1"
          : cfg.enableDiverseCatalogSelection === true
            ? "diverse_set_v1"
            : "deterministic_topk",
      rowsetBorrowMissCount: 0,
      rowsetOwnedAllocCount: 0,
      rowsetFinalizeCount: 0,
      sparseSparseIntersectionMs: 0,
      sparseBitmapIntersectionMs: 0,
      collectedRuleCount: 0,
      observedRuleCount: 0,
      liveCanonicalRuleCount: 0,
      finalSelectedRuleCount: 0,
      orderingHeadWindow,
      orderingHeadExactLoads: 0,
      orderingHeadRerankMs: 0,
      currentSearchDepth: 0,
      maxSearchDepth: 0,
      candidateDescriptorCount: 0,
      acceptedCandidateCount: 0,
      searchProgressRevision: 0,
      rowsetIntersectionMs: 0,
      truncatedByMaxSearchStates: false,
      seedSelectionMs,
      seedPostingPrewarmMs: 0,
      seedPostingPrewarmTokenCount: 0,
      featureContributionTrackedFeatureCount: 0,
      featureContributionTopSelection: [],
      featureContributionTopAccepted: [],
      featureContributionTopExactRules: [],
      featureContributionTopLivePartial: [],
      featureContributionTopCost: [],
      rowContributionProfile: null,
      rowContributionTopExactSymbols: [],
      rowContributionTopExactDates: [],
      rowContributionTopSampledNegativeSymbols: [],
      rowContributionTopSampledNegativeDates: [],
      rowContributionExactDuplicateSourceIdCount: 0,
      rowContributionExactDuplicateSymbolDateCount: 0,
      rowContributionSampledNegativeDuplicateSourceIdCount: 0,
      rowContributionSampledNegativeDuplicateSymbolDateCount: 0,
    })
    if (workerSession == null) {
      await validatePerfectPrototypeIndexProvenance({
        indexDir: resolvedIndexDir,
        indexManifest: manifest,
        partitionManifest,
      })
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_token_stats",
            rowsScanned: 0,
            rowsTokenized: 0,
            tokensIndexed: 0,
            seedTokensSelected: 0,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
      const seedSelectionStartedAt = Date.now()
      const seedSelection = await streamSelectPerfectPrototypeSeedEntries({
        cwd,
        duckdb,
        tokenStatsPath,
        minHitCount: cfg.minHitCount,
        maxSeedTokens: cfg.maxSeedTokens,
        maxRejectedRuleSamples: cfg.maxRejectedRuleSamples,
        expectedTokenCount:
          Number.isInteger(Number(manifest?.tokenCount)) && Number(manifest?.tokenCount) >= 0
            ? Number(manifest.tokenCount)
            : null,
      })
      seedSelectionMs = Date.now() - seedSelectionStartedAt
      rejectionSummary = buildBaseRejectionSummary({
        totalTokenCount: seedSelection.totalTokenCount,
        seedBelowMinHitCount: seedSelection.seedBelowMinHitCount,
        seedSelectionMs,
      })
      for (const entry of seedSelection.rejectedSeedSamples) {
        if (rejectedRules.length >= cfg.maxRejectedRuleSamples) break
        rejectedRules.push({
          reason: "SEED_BELOW_MIN_HIT_COUNT",
          tokens: [entry.token],
          ruleSize: 1,
          positiveMatchCount: entry.positiveMatchCount,
          negativeMatchCount: entry.negativeMatchCount,
          maxGapTradingDays: null,
          samplePositiveIds: [],
          sampleNegativeIds: [],
        })
      }
      const seedStats = seedSelection.seedEntries
      const seedTokens = new Set(seedStats.map((entry) => entry.token))
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_row_meta",
            rowsScanned: 0,
            rowsTokenized: 0,
            tokensIndexed: manifest?.tokenPostingCount ?? 0,
            seedTokensSelected: seedTokens.size,
            seedSelectionMs,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
      rowMeta = await loadPerfectPrototypeIndexedRowMeta({
        cwd,
        duckdb,
        rowMetaPath,
        rowLaneMetaPath: manifest?.rowLaneMetaParquetPath ?? null,
        requireLaneMeta: shouldRequirePerfectPrototypeIndexedLaneMeta({
          cfg,
          datasetContract,
        }),
        manifest,
        summary,
      })
      rowCount = rowMeta.rowCount
      rowsetModeStats = createPerfectPrototypeRowsetModeStats()
      allPositiveRowset = createPerfectPrototypeRowset({
        values: rowMeta.allPositiveTyped,
        universeSize: rowCount,
        allowDense: true,
      })
      allNegativeRowset = createPerfectPrototypeRowset({
        values: rowMeta.allNegativeTyped,
        universeSize: rowCount,
        allowDense: true,
      })
      rowsetModeStats.rootPositiveMode = summarizePerfectPrototypeRowsetMode(allPositiveRowset)
      rowsetModeStats.rootNegativeMode = summarizePerfectPrototypeRowsetMode(allNegativeRowset)
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_seed_postings",
            rowsScanned: rowCount,
            rowsTokenized: rowCount,
            tokensIndexed: manifest?.tokenPostingCount ?? 0,
            seedTokensSelected: seedTokens.size,
            seedSelectionMs,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedRows: rowCount,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
      if (seedTokens.size > 0) {
        const dictionaryLoadStartedAt = Date.now()
        const dictionaryByToken = await loadPerfectPrototypeTokenDictionaryEntriesByTokens({
          cwd,
          duckdb,
          tokenDictionaryParquetPath,
          tokens: seedStats.map((entry) => entry.token),
          expectedUniqueTokenCount: seedTokens.size,
        })
        dictionaryLoadMs = Date.now() - dictionaryLoadStartedAt
        for (const seedStat of seedStats) {
          const dictEntry = dictionaryByToken.get(seedStat.token)
          if (!dictEntry) {
            throw new Error(`Missing compressed postings entry for token=${seedStat.token}`)
          }
          seedTokensOrdered.push(seedStat.token)
          seedDictionaryEntries.push(dictEntry)
          seedPositiveCounts.push(seedStat.positiveMatchCount)
          seedNegativeCounts.push(seedStat.negativeMatchCount)
          seedPrecisions.push(seedStat.precision)
          seedSeparationRatios.push(seedStat.separationRatio)
          seedSeparationLifts.push(seedStat.separationLift)
        }
        seedStats.length = 0
      }
      selectedSeedCount = seedTokensOrdered.length
      rowTokenProjection =
        rowProjectedCandidateThreshold > 0
          ? await loadPerfectPrototypeIndexedRowTokenProjection({
              cwd,
              duckdb,
              tokenDictionaryParquetPath,
              rowTokenOffsetsPath: rowTokenOffsetsBinPath,
              rowTokenIdsPath: rowTokenIdsBinPath,
              rowCount: Number(manifest?.rowCount ?? 0),
              tokenPostingCount: Number(manifest?.tokenPostingCount ?? 0),
              tokenCount: Number(manifest?.tokenCount ?? 0),
              tokenIdWidthBits: rowTokenIdWidthBits,
              selectedSeedTokens: seedTokensOrdered,
            })
          : null
      postingsHandle = await openPerfectPrototypePostingsFile(tokenPostingsBinPath, "r")
      const familyDistributionDictionaryEntries = await loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens({
        cwd,
        duckdb,
        tokenDictionaryParquetPath,
        tokens: PERFECT_PROTOTYPE_INDEXED_FAMILY_DISTRIBUTION_TOKENS,
      })
      familyDistributionPostingCache = createOptionalTokenPostingCache({
        postingsHandle,
        dictionaryEntriesByToken: familyDistributionDictionaryEntries,
        rowUniverseSize: rowCount,
      })
      const familyRootScopeTokens = uniqueSorted(
        PERFECT_PROTOTYPE_INDEXED_FAMILY_ROOT_SCOPE_DEFINITIONS.flatMap((definition) => definition.rootTokens),
      )
      const familyRootScopeDictionaryEntries =
        await loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens({
          cwd,
          duckdb,
          tokenDictionaryParquetPath,
          tokens: familyRootScopeTokens,
        })
      familyRootScopePostingCache = createOptionalTokenPostingCache({
        postingsHandle,
        dictionaryEntriesByToken: familyRootScopeDictionaryEntries,
        rowUniverseSize: rowCount,
      })
    } else {
      seedSelectionMs = Number(workerSession?.seedSelectionMs ?? 0)
      rejectionSummary = buildBaseRejectionSummary({
        totalTokenCount: Number(workerSession?.totalTokenCount ?? 0),
        seedBelowMinHitCount: Number(workerSession?.seedBelowMinHitCount ?? 0),
        seedSelectionMs,
      })
      for (const entry of Array.isArray(workerSession?.rejectedSeedSamples)
        ? workerSession.rejectedSeedSamples
        : []) {
        if (rejectedRules.length >= cfg.maxRejectedRuleSamples) break
        rejectedRules.push({
          reason: "SEED_BELOW_MIN_HIT_COUNT",
          tokens: [entry.token],
          ruleSize: 1,
          positiveMatchCount: entry.positiveMatchCount,
          negativeMatchCount: entry.negativeMatchCount,
          maxGapTradingDays: null,
          samplePositiveIds: [],
          sampleNegativeIds: [],
        })
      }
      rowMeta = workerSession.rowMeta
      rowCount = rowMeta.rowCount
      rowsetModeStats = createPerfectPrototypeRowsetModeStats()
      allPositiveRowset = createPerfectPrototypeRowset({
        values: rowMeta.allPositiveTyped,
        universeSize: rowCount,
        allowDense: true,
      })
      allNegativeRowset = createPerfectPrototypeRowset({
        values: rowMeta.allNegativeTyped,
        universeSize: rowCount,
        allowDense: true,
      })
      rowsetModeStats.rootPositiveMode = summarizePerfectPrototypeRowsetMode(allPositiveRowset)
      rowsetModeStats.rootNegativeMode = summarizePerfectPrototypeRowsetMode(allNegativeRowset)
      seedTokensOrdered = Array.isArray(workerSession?.seedTokensOrdered)
        ? workerSession.seedTokensOrdered.slice()
        : []
      seedDictionaryEntries = Array.isArray(workerSession?.seedDictionaryEntries)
        ? workerSession.seedDictionaryEntries.slice()
        : []
      seedPositiveCounts = Array.isArray(workerSession?.seedPositiveCounts)
        ? workerSession.seedPositiveCounts.slice()
        : []
      seedNegativeCounts = Array.isArray(workerSession?.seedNegativeCounts)
        ? workerSession.seedNegativeCounts.slice()
        : []
      seedPrecisions = Array.isArray(workerSession?.seedPrecisions)
        ? workerSession.seedPrecisions.slice()
        : []
      seedSeparationRatios = Array.isArray(workerSession?.seedSeparationRatios)
        ? workerSession.seedSeparationRatios.slice()
        : []
      seedSeparationLifts = Array.isArray(workerSession?.seedSeparationLifts)
        ? workerSession.seedSeparationLifts.slice()
        : []
      rowTokenProjection = workerSession?.rowTokenProjection ?? null
      selectedSeedCount = Number(workerSession?.selectedSeedCount ?? seedTokensOrdered.length)
      dictionaryLoadMs = Number(workerSession?.dictionaryLoadMs ?? 0)
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_token_stats",
            rowsScanned: 0,
            rowsTokenized: 0,
            tokensIndexed: 0,
            seedTokensSelected: 0,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_row_meta",
            rowsScanned: 0,
            rowsTokenized: 0,
            tokensIndexed: manifest?.tokenPostingCount ?? 0,
            seedTokensSelected: selectedSeedCount,
            seedSelectionMs,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase: "load_seed_postings",
            rowsScanned: rowCount,
            rowsTokenized: rowCount,
            tokensIndexed: manifest?.tokenPostingCount ?? 0,
            seedTokensSelected: selectedSeedCount,
            seedSelectionMs,
            exploredStates: 0,
            rulesCollected: 0,
          },
          startedAtMs: miningStartedAt,
          estimatedRows: rowCount,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        }),
      )
    }
    if (cfg.enableFamilyScopedMining === true && familyRootScopePostingCache == null) {
      const familyRootScopeTokens = isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })
        ? buildPerfectPrototypeRecentOnlyFamilyScopePostingTokens()
        : uniqueSorted(PERFECT_PROTOTYPE_INDEXED_FAMILY_ROOT_SCOPE_DEFINITIONS.flatMap((definition) => definition.rootTokens))
      const familyRootScopeDictionaryEntries = await loadOptionalPerfectPrototypeTokenDictionaryEntriesByTokens({
        cwd,
        duckdb,
        tokenDictionaryParquetPath,
        tokens: familyRootScopeTokens,
      })
      familyRootScopePostingCache = createOptionalTokenPostingCache({
        postingsHandle,
        dictionaryEntriesByToken: familyRootScopeDictionaryEntries,
        rowUniverseSize: rowCount,
      })
    }
    const { foldLookup, rowFoldKeys } = buildPerfectPrototypeIndexedRowFoldKeys({
      rowDateIndexes: rowMeta.rowDateIndexes,
      calendarDateKeys: rowMeta.calendarDateKeys,
      foldScheme: cfg.foldScheme,
    })
    const calendarFoldKeys = Array.isArray(foldLookup?.foldKeysByCalendarIndex)
      ? foldLookup.foldKeysByCalendarIndex
      : []
    computePositiveHitStats = createPerfectPrototypeIndexedDayCappedHitStatsComputer({
      rowDateIndexes: rowMeta.rowDateIndexes,
      calendarDateKeys: rowMeta.calendarDateKeys,
      calendarFoldKeys,
    })
    seedPositiveCappedCounts = Array.isArray(workerSession?.seedPositiveCappedCounts)
      ? workerSession.seedPositiveCappedCounts.slice()
      : []
    seedPositiveDistinctDateCounts = Array.isArray(workerSession?.seedPositiveDistinctDateCounts)
      ? workerSession.seedPositiveDistinctDateCounts.slice()
      : []
    seedPositiveCoreYearHitCounts = Array.isArray(workerSession?.seedPositiveCoreYearHitCounts)
      ? workerSession.seedPositiveCoreYearHitCounts.map((entry) =>
          entry && typeof entry === "object" ? { ...entry } : {},
        )
      : []
    seedPositiveMaxSymbolsPerDate = Array.isArray(workerSession?.seedPositiveMaxSymbolsPerDate)
      ? workerSession.seedPositiveMaxSymbolsPerDate.slice()
      : []
    if (
      seedPositiveCappedCounts.length !== seedTokensOrdered.length ||
      seedPositiveDistinctDateCounts.length !== seedTokensOrdered.length ||
      seedPositiveDistinctMonthCounts.length !== seedTokensOrdered.length ||
      seedPositiveDistinctQuarterCounts.length !== seedTokensOrdered.length ||
      seedPositiveDistinctFoldCounts.length !== seedTokensOrdered.length ||
      seedPositiveMonthSignatureHashes.length !== seedTokensOrdered.length ||
      seedPositiveQuarterSignatureHashes.length !== seedTokensOrdered.length ||
      seedPositiveFoldSignatureHashes.length !== seedTokensOrdered.length ||
      seedPositiveCoreYearHitCounts.length !== seedTokensOrdered.length ||
      seedPositiveMaxSymbolsPerDate.length !== seedTokensOrdered.length
    ) {
      seedPositiveCappedCounts = new Array(seedTokensOrdered.length)
      seedPositiveDistinctDateCounts = new Array(seedTokensOrdered.length)
      seedPositiveDistinctMonthCounts = new Array(seedTokensOrdered.length)
      seedPositiveDistinctQuarterCounts = new Array(seedTokensOrdered.length)
      seedPositiveDistinctFoldCounts = new Array(seedTokensOrdered.length)
      seedPositiveMonthSignatureHashes = new Array(seedTokensOrdered.length)
      seedPositiveQuarterSignatureHashes = new Array(seedTokensOrdered.length)
      seedPositiveFoldSignatureHashes = new Array(seedTokensOrdered.length)
      seedPositiveCoreYearHitCounts = new Array(seedTokensOrdered.length)
      seedPositiveMaxSymbolsPerDate = new Array(seedTokensOrdered.length)
      if (
        cfg.hitCountMode === PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE ||
        trainMatchedDatePruneEnabled ||
        yearHitUpperBoundPruneEnabled
      ) {
        const seedStatsPostingCache = createSeedPostingCache({
          postingsHandle,
          seedDictionaryEntries,
          rowUniverseSize: rowCount,
          maxEntries: Math.max(64, seedTokensOrdered.length),
        })
        for (let seedIndex = 0; seedIndex < seedTokensOrdered.length; seedIndex += 1) {
          const positiveRowset = await seedStatsPostingCache.getSeedPositiveRowset(seedIndex)
          const hitStats = computePositiveHitStats({
            rowIndexes: materializePerfectPrototypeRowsetValues(positiveRowset),
            hitCountMode: cfg.hitCountMode,
            hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
          })
          seedPositiveCappedCounts[seedIndex] = hitStats.cappedCount
          seedPositiveDistinctDateCounts[seedIndex] = hitStats.distinctDateCount
          seedPositiveDistinctMonthCounts[seedIndex] = hitStats.matchedMonthCount
          seedPositiveDistinctQuarterCounts[seedIndex] = hitStats.matchedQuarterCount
          seedPositiveDistinctFoldCounts[seedIndex] = hitStats.matchedFoldCount
          seedPositiveMonthSignatureHashes[seedIndex] = hitStats.matchedMonthSignatureHash
          seedPositiveQuarterSignatureHashes[seedIndex] = hitStats.matchedQuarterSignatureHash
          seedPositiveFoldSignatureHashes[seedIndex] = hitStats.matchedFoldSignatureHash
          seedPositiveCoreYearHitCounts[seedIndex] = yearHitUpperBoundPruneEnabled
            ? buildPerfectPrototypeYearHitCountsFromHitDates({
                hitDates: hitStats.hitDates,
                coreYears: cfg.coreYears,
                excludedBoundaryYears: cfg.excludedBoundaryYears,
              }).coreYearHitCounts
            : {}
          seedPositiveMaxSymbolsPerDate[seedIndex] = hitStats.maxSymbolsMatchedPerDate
        }
      } else {
        for (let seedIndex = 0; seedIndex < seedTokensOrdered.length; seedIndex += 1) {
          seedPositiveCappedCounts[seedIndex] = seedPositiveCounts[seedIndex]
          seedPositiveDistinctDateCounts[seedIndex] = 0
          seedPositiveDistinctMonthCounts[seedIndex] = 0
          seedPositiveDistinctQuarterCounts[seedIndex] = 0
          seedPositiveDistinctFoldCounts[seedIndex] = 0
          seedPositiveMonthSignatureHashes[seedIndex] = null
          seedPositiveQuarterSignatureHashes[seedIndex] = null
          seedPositiveFoldSignatureHashes[seedIndex] = null
          seedPositiveCoreYearHitCounts[seedIndex] = {}
          seedPositiveMaxSymbolsPerDate[seedIndex] = 0
        }
      }
    }
    if ((trainMatchedDatePruneEnabled || yearHitUpperBoundPruneEnabled) && seedTokensOrdered.length > 0) {
      const filteredSeedTokensOrdered = []
      const filteredSeedDictionaryEntries = []
      const filteredSeedPositiveCounts = []
      const filteredSeedPositiveCappedCounts = []
      const filteredSeedPositiveDistinctDateCounts = []
      const filteredSeedPositiveDistinctMonthCounts = []
      const filteredSeedPositiveDistinctQuarterCounts = []
      const filteredSeedPositiveDistinctFoldCounts = []
      const filteredSeedPositiveMonthSignatureHashes = []
      const filteredSeedPositiveQuarterSignatureHashes = []
      const filteredSeedPositiveFoldSignatureHashes = []
      const filteredSeedPositiveCoreYearHitCounts = []
      const filteredSeedPositiveMaxSymbolsPerDate = []
      const filteredSeedNegativeCounts = []
      const filteredSeedPrecisions = []
      const filteredSeedSeparationRatios = []
      const filteredSeedSeparationLifts = []
      for (let seedIndex = 0; seedIndex < seedTokensOrdered.length; seedIndex += 1) {
        const seedFamilyId = inferPerfectPrototypeRuleFamilyId({
          tokens: [seedTokensOrdered[seedIndex]],
        })
        const breadthGuard = evaluatePositiveHitStatsBreadthGuard({
          distinctDateCount: Math.max(0, Number(seedPositiveDistinctDateCounts[seedIndex] ?? 0)),
          matchedMonthCount: Math.max(0, Number(seedPositiveDistinctMonthCounts[seedIndex] ?? 0)),
          matchedQuarterCount: Math.max(0, Number(seedPositiveDistinctQuarterCounts[seedIndex] ?? 0)),
          matchedFoldCount: Math.max(0, Number(seedPositiveDistinctFoldCounts[seedIndex] ?? 0)),
        }, seedFamilyId)
        if (!breadthGuard.ok) {
          recordSeedTrainMatchedDatePruneRejection({
            reason: breadthGuard.reason,
            tokens: [seedTokensOrdered[seedIndex]],
            positiveMatchCount: seedPositiveCounts[seedIndex],
            negativeMatchCount: seedNegativeCounts[seedIndex],
          })
          continue
        }
        if (yearHitUpperBoundPruneEnabled) {
          const seedYearHitUpperBoundGuard =
            evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
              coreYearHitCounts: seedPositiveCoreYearHitCounts[seedIndex] ?? {},
              coreYears: cfg.coreYears,
              minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
            })
          if (!seedYearHitUpperBoundGuard.ok) {
            recordYearHitUpperBoundPruneRejection({
              stage: "seed",
              familyId: seedFamilyId,
              tokens: [seedTokensOrdered[seedIndex]],
              positiveMatchCount: seedPositiveCounts[seedIndex],
              negativeMatchCount: seedNegativeCounts[seedIndex],
              yearGuard: seedYearHitUpperBoundGuard,
            })
            continue
          }
        }
        const promotableUpperBoundGuard = evaluatePromotableUpperBoundGuardFromCounts({
          distinctDateUpperBound: Math.max(0, Number(seedPositiveDistinctDateCounts[seedIndex] ?? 0)),
          matchedMonthUpperBound: Math.max(0, Number(seedPositiveDistinctMonthCounts[seedIndex] ?? 0)),
          matchedFoldUpperBound: Math.max(0, Number(seedPositiveDistinctFoldCounts[seedIndex] ?? 0)),
        })
        if (!promotableUpperBoundGuard.ok) {
          recordPromotableUpperBoundPruneRejection({
            stage: "seed",
            familyId: seedFamilyId,
            reason: promotableUpperBoundGuard.reason,
            tokens: [seedTokensOrdered[seedIndex]],
            positiveMatchCount: seedPositiveCounts[seedIndex],
            negativeMatchCount: seedNegativeCounts[seedIndex],
          })
          continue
        }
        filteredSeedTokensOrdered.push(seedTokensOrdered[seedIndex])
        filteredSeedDictionaryEntries.push(seedDictionaryEntries[seedIndex])
        filteredSeedPositiveCounts.push(seedPositiveCounts[seedIndex])
        filteredSeedPositiveCappedCounts.push(seedPositiveCappedCounts[seedIndex])
        filteredSeedPositiveDistinctDateCounts.push(seedPositiveDistinctDateCounts[seedIndex])
        filteredSeedPositiveDistinctMonthCounts.push(seedPositiveDistinctMonthCounts[seedIndex])
        filteredSeedPositiveDistinctQuarterCounts.push(seedPositiveDistinctQuarterCounts[seedIndex])
        filteredSeedPositiveDistinctFoldCounts.push(seedPositiveDistinctFoldCounts[seedIndex])
        filteredSeedPositiveMonthSignatureHashes.push(seedPositiveMonthSignatureHashes[seedIndex])
        filteredSeedPositiveQuarterSignatureHashes.push(seedPositiveQuarterSignatureHashes[seedIndex])
        filteredSeedPositiveFoldSignatureHashes.push(seedPositiveFoldSignatureHashes[seedIndex])
        filteredSeedPositiveCoreYearHitCounts.push(seedPositiveCoreYearHitCounts[seedIndex])
        filteredSeedPositiveMaxSymbolsPerDate.push(seedPositiveMaxSymbolsPerDate[seedIndex])
        filteredSeedNegativeCounts.push(seedNegativeCounts[seedIndex])
        filteredSeedPrecisions.push(seedPrecisions[seedIndex])
        filteredSeedSeparationRatios.push(seedSeparationRatios[seedIndex])
        filteredSeedSeparationLifts.push(seedSeparationLifts[seedIndex])
      }
      seedTokensOrdered = filteredSeedTokensOrdered
      seedDictionaryEntries = filteredSeedDictionaryEntries
      seedPositiveCounts = filteredSeedPositiveCounts
      seedPositiveCappedCounts = filteredSeedPositiveCappedCounts
      seedPositiveDistinctDateCounts = filteredSeedPositiveDistinctDateCounts
      seedPositiveDistinctMonthCounts = filteredSeedPositiveDistinctMonthCounts
      seedPositiveDistinctQuarterCounts = filteredSeedPositiveDistinctQuarterCounts
      seedPositiveDistinctFoldCounts = filteredSeedPositiveDistinctFoldCounts
      seedPositiveMonthSignatureHashes = filteredSeedPositiveMonthSignatureHashes
      seedPositiveQuarterSignatureHashes = filteredSeedPositiveQuarterSignatureHashes
      seedPositiveFoldSignatureHashes = filteredSeedPositiveFoldSignatureHashes
      seedPositiveCoreYearHitCounts = filteredSeedPositiveCoreYearHitCounts
      seedPositiveMaxSymbolsPerDate = filteredSeedPositiveMaxSymbolsPerDate
      seedNegativeCounts = filteredSeedNegativeCounts
      seedPrecisions = filteredSeedPrecisions
      seedSeparationRatios = filteredSeedSeparationRatios
      seedSeparationLifts = filteredSeedSeparationLifts
    }
    if (
      cfg.enableFamilyScopedMining === true &&
      seedTokensOrdered.length > 0 &&
      !isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })
    ) {
      const familyOrdering = buildFamilyScopedSeedOrdering({
        seedTokens: seedTokensOrdered,
        maxTopBucket: cfg.familySeedMaxTopBucket,
        maxMidBucket: cfg.familySeedMaxMidBucket,
        maxLowBucket: cfg.familySeedMaxLowBucket,
      })
      const reorderBySeedOrder = (values) =>
        familyOrdering.interleavedOrder.map((seedIndex) => values[seedIndex])
      seedTokensOrdered = reorderBySeedOrder(seedTokensOrdered)
      seedDictionaryEntries = reorderBySeedOrder(seedDictionaryEntries)
      seedPositiveCounts = reorderBySeedOrder(seedPositiveCounts)
      seedPositiveCappedCounts = reorderBySeedOrder(seedPositiveCappedCounts)
      seedPositiveDistinctDateCounts = reorderBySeedOrder(seedPositiveDistinctDateCounts)
      seedPositiveDistinctMonthCounts = reorderBySeedOrder(seedPositiveDistinctMonthCounts)
      seedPositiveDistinctQuarterCounts = reorderBySeedOrder(seedPositiveDistinctQuarterCounts)
      seedPositiveDistinctFoldCounts = reorderBySeedOrder(seedPositiveDistinctFoldCounts)
      seedPositiveMonthSignatureHashes = reorderBySeedOrder(seedPositiveMonthSignatureHashes)
      seedPositiveQuarterSignatureHashes = reorderBySeedOrder(seedPositiveQuarterSignatureHashes)
      seedPositiveFoldSignatureHashes = reorderBySeedOrder(seedPositiveFoldSignatureHashes)
      seedPositiveCoreYearHitCounts = reorderBySeedOrder(seedPositiveCoreYearHitCounts)
      seedPositiveMaxSymbolsPerDate = reorderBySeedOrder(seedPositiveMaxSymbolsPerDate)
      seedNegativeCounts = reorderBySeedOrder(seedNegativeCounts)
      seedPrecisions = reorderBySeedOrder(seedPrecisions)
      seedSeparationRatios = reorderBySeedOrder(seedSeparationRatios)
      seedSeparationLifts = reorderBySeedOrder(seedSeparationLifts)
      rejectionSummary.familyScopedSeedBucketOrder = familyOrdering.bucketOrder
      rejectionSummary.familyScopedSeedAcceptedCountByBucket = familyOrdering.acceptedCounts
      rejectionSummary.familyScopedSeedDeferredCountByBucket = familyOrdering.deferredCounts
    } else if (
      cfg.enableFamilyScopedMining === true &&
      seedTokensOrdered.length > 0 &&
      isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })
    ) {
      rejectionSummary.familyScopedSeedBucketOrder = ["RECENT_ONLY_COHORT_ROOTS"]
      rejectionSummary.familyScopedSeedAcceptedCountByBucket = {}
      rejectionSummary.familyScopedSeedDeferredCountByBucket = {}
    }
    if (cfg.enableLaneStratifiedMining === true && seedTokensOrdered.length > 0) {
      const seedLaneStatsPostingCache = createSeedPostingCache({
        postingsHandle,
        seedDictionaryEntries,
        rowUniverseSize: rowCount,
        maxEntries: Math.max(64, seedTokensOrdered.length),
      })
      seedDominantLaneIds = await buildIndexedSeedDominantLaneIds({
        seedCount: seedTokensOrdered.length,
        getSeedPositiveRowset: (seedIndex) => seedLaneStatsPostingCache.getSeedPositiveRowset(seedIndex),
        rowStepALaneIds: rowMeta.rowStepALaneIds,
      })
      const laneInterleaving = buildIndexedLaneInterleavedSeedOrder({
        seedDominantLaneIds,
      })
      const reorderBySeedOrder = (values) =>
        laneInterleaving.interleavedOrder.map((seedIndex) => values[seedIndex])
      seedTokensOrdered = reorderBySeedOrder(seedTokensOrdered)
      seedDictionaryEntries = reorderBySeedOrder(seedDictionaryEntries)
      seedPositiveCounts = reorderBySeedOrder(seedPositiveCounts)
      seedPositiveCappedCounts = reorderBySeedOrder(seedPositiveCappedCounts)
      seedPositiveDistinctDateCounts = reorderBySeedOrder(seedPositiveDistinctDateCounts)
      seedPositiveDistinctMonthCounts = reorderBySeedOrder(seedPositiveDistinctMonthCounts)
      seedPositiveDistinctQuarterCounts = reorderBySeedOrder(seedPositiveDistinctQuarterCounts)
      seedPositiveDistinctFoldCounts = reorderBySeedOrder(seedPositiveDistinctFoldCounts)
      seedPositiveMonthSignatureHashes = reorderBySeedOrder(seedPositiveMonthSignatureHashes)
      seedPositiveQuarterSignatureHashes = reorderBySeedOrder(seedPositiveQuarterSignatureHashes)
      seedPositiveFoldSignatureHashes = reorderBySeedOrder(seedPositiveFoldSignatureHashes)
      seedPositiveCoreYearHitCounts = reorderBySeedOrder(seedPositiveCoreYearHitCounts)
      seedPositiveMaxSymbolsPerDate = reorderBySeedOrder(seedPositiveMaxSymbolsPerDate)
      seedNegativeCounts = reorderBySeedOrder(seedNegativeCounts)
      seedPrecisions = reorderBySeedOrder(seedPrecisions)
      seedSeparationRatios = reorderBySeedOrder(seedSeparationRatios)
      seedSeparationLifts = reorderBySeedOrder(seedSeparationLifts)
      seedDominantLaneIds = reorderBySeedOrder(seedDominantLaneIds)
      rejectionSummary.laneStratifiedLaneCount = laneInterleaving.orderedLaneKeys.length
      rejectionSummary.laneStratifiedSeedCountByLane = laneInterleaving.laneCounts
      rejectionSummary.laneStratifiedLaneOrder = laneInterleaving.orderedLaneKeys
    }
    selectedSeedCount = seedTokensOrdered.length
    if (rowProjectedCandidateThreshold > 0) {
      rowTokenProjection =
        selectedSeedCount > 0
          ? await loadPerfectPrototypeIndexedRowTokenProjection({
              cwd,
              duckdb,
              tokenDictionaryParquetPath,
              rowTokenOffsetsPath: rowTokenOffsetsBinPath,
              rowTokenIdsPath: rowTokenIdsBinPath,
              rowCount: Number(manifest?.rowCount ?? 0),
              tokenPostingCount: Number(manifest?.tokenPostingCount ?? 0),
              tokenCount: Number(manifest?.tokenCount ?? 0),
              tokenIdWidthBits: rowTokenIdWidthBits,
              selectedSeedTokens: seedTokensOrdered,
            })
          : null
    }
    if (rowMeta) {
      rowContributionDiagnostics = createPerfectPrototypeRowContributionDiagnosticsState({
        rowMeta,
      })
    }
    function forEachFeatureContributionEntry(tokens, visitor) {
      if (typeof visitor !== "function") return
      const seenContributionKeys = new Set()
      for (const rawToken of Array.isArray(tokens) ? tokens : []) {
        const entry = ensurePerfectPrototypeFeatureContributionEntry(featureContributionByKey, rawToken)
        if (seenContributionKeys.has(entry.contributionKey)) continue
        seenContributionKeys.add(entry.contributionKey)
        visitor(entry)
      }
    }
    function noteFeatureContributionRejectedRule({ tokens, negativeMass = 0 }) {
      const normalizedNegativeMass = Math.max(0, Number(negativeMass ?? 0))
      forEachFeatureContributionEntry(tokens, (entry) => {
        entry.sampledRejectedRuleCount += 1
        entry.sampledRejectedNegativeMass += normalizedNegativeMass
      })
    }
    let seedPositiveLoadCount = 0
    let seedNegativeLoadCount = 0
    let seedPostingLoadMs = 0
    let seedPostingPrewarmMs = 0
    let seedPostingPrewarmTokenCount = 0
    let candidateDescriptorBuildMs = 0
    let negativeCountResolutionMs = 0
    let childRowsetMaterializeMs = 0
    let rowProjectedCandidateBuildMs = 0
    let rowProjectedActivationCount = 0
    let rowProjectedTouchedRowCount = 0
    let rowProjectedTokenVisitCount = 0
    let rowProjectedCandidateSeedCount = 0
    let diverseBeamDeferredCandidateCount = 0
    const exactStepbArtifact =
      String(manifest?.artifactType ?? "").trim() === PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE
    const directPinnedSeedPostingDefault =
      workerChunkIndex == null && exactStepbArtifact === true
    const pinAllSeedPostings =
      options?.pinAllSeedPostings === true || options?.prewarmSeedPostings === true
        ? true
        : options?.pinAllSeedPostings === false || options?.prewarmSeedPostings === false
          ? false
          : directPinnedSeedPostingDefault
    const defaultSeedPostingCacheEntries =
      pinAllSeedPostings === true
        ? selectedSeedCount
        : Number.isInteger(workerChunkIndex) && workerChunkIndex >= 0
        ? Math.max(1024, orderingHeadWindow * 128, cfg.maxRuleSize * 256)
        : 256
    const seedPostingCacheEntryLimit = Math.min(
      selectedSeedCount,
      Math.max(
        64,
        Math.floor(
          Number(options?.seedPostingCacheEntries ?? defaultSeedPostingCacheEntries) ||
            defaultSeedPostingCacheEntries,
        ),
      ),
    )
    const seedPostingCache = createSeedPostingCache({
      postingsHandle,
      seedDictionaryEntries,
      rowUniverseSize: rowCount,
      maxEntries: seedPostingCacheEntryLimit,
      onLoad: ({ kind, rowset, loadMs }) => {
        seedPostingLoadMs += Math.max(0, Number(loadMs ?? 0))
        if (kind === "positive") {
          seedPositiveLoadCount += 1
          recordPerfectPrototypeRowsetMode(rowsetModeStats, "seedPositive", rowset)
          return
        }
        if (kind === "negative") {
          seedNegativeLoadCount += 1
          recordPerfectPrototypeRowsetMode(rowsetModeStats, "seedNegative", rowset)
        }
      },
    })
    const seedPostingPrewarmConcurrency = Math.max(
      1,
      Math.min(
        128,
        Math.floor(Number(options?.seedPostingPrewarmConcurrency ?? 32) || 32),
      ),
    )
    const prewarmSeedPostings = async () => {
      if (pinAllSeedPostings !== true || selectedSeedCount < 1) return
      const prewarmStartedAt = Date.now()
      for (
        let tokenIndex = 0;
        tokenIndex < selectedSeedCount;
        tokenIndex += seedPostingPrewarmConcurrency
      ) {
        const batch = []
        const batchEnd = Math.min(selectedSeedCount, tokenIndex + seedPostingPrewarmConcurrency)
        for (let batchTokenIndex = tokenIndex; batchTokenIndex < batchEnd; batchTokenIndex += 1) {
          batch.push(seedPostingCache.getSeedPositiveRowset(batchTokenIndex))
          batch.push(seedPostingCache.getSeedNegativeRowset(batchTokenIndex))
        }
        await Promise.all(batch)
      }
      seedPostingPrewarmMs = Date.now() - prewarmStartedAt
      seedPostingPrewarmTokenCount = selectedSeedCount
    }
    await prewarmSeedPostings()

    function recordRejectedRule({
      reason,
      tokens,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
      positiveMatchCount = null,
      negativeMatchCount = null,
      maxGapTradingDays = null,
      metadata = null,
    }) {
      if (rejectedRules.length >= cfg.maxRejectedRuleSamples) return
      const materializedPositiveRowIndexes =
        positiveRowIndexes ??
        (positiveRowset ? materializePerfectPrototypeRowsetValues(positiveRowset) : new Uint32Array())
      const materializedNegativeRowIndexes =
        negativeRowIndexes ??
        (negativeRowset ? materializePerfectPrototypeRowsetValues(negativeRowset) : new Uint32Array())
      noteFeatureContributionRejectedRule({
        tokens,
        negativeMass: materializedNegativeRowIndexes.length,
      })
      rowContributionDiagnostics?.noteSampledNegativeIndexes(materializedNegativeRowIndexes)
      rejectedRules.push({
        reason,
        tokens: uniqueSorted(tokens),
        ruleSize: Array.isArray(tokens) ? tokens.length : 0,
        positiveMatchCount:
          Number.isInteger(Number(positiveMatchCount))
            ? Number(positiveMatchCount)
            : materializedPositiveRowIndexes.length,
        negativeMatchCount:
          Number.isInteger(Number(negativeMatchCount))
            ? Number(negativeMatchCount)
            : materializedNegativeRowIndexes.length,
        maxGapTradingDays: Number.isFinite(Number(maxGapTradingDays)) ? Number(maxGapTradingDays) : null,
        samplePositiveIds: sampleSourceIdsFromIndexes({
          rowSourceIds: rowMeta.rowSourceIds,
          indexes: materializedPositiveRowIndexes,
          limit: 10,
        }),
        sampleNegativeIds: sampleSourceIdsFromIndexes({
          rowSourceIds: rowMeta.rowSourceIds,
          indexes: materializedNegativeRowIndexes,
          limit: 10,
        }),
        ...(metadata && typeof metadata === "object" ? metadata : {}),
      })
    }

    const buildCoreYearUpperBoundCountsFromHitDates = (hitDates) =>
      buildPerfectPrototypeYearHitCountsFromHitDates({
        hitDates,
        coreYears: cfg.coreYears,
        excludedBoundaryYears: cfg.excludedBoundaryYears,
      }).coreYearHitCounts

    const buildCandidateCoreYearUpperBoundCounts = ({
      parentCoreYearHitCounts = {},
      seedCoreYearHitCounts = {},
    } = {}) =>
      Object.fromEntries(
        (Array.isArray(cfg.coreYears) ? cfg.coreYears : []).map((yearKey) => {
          const yearKeyString = String(yearKey)
          return [
            yearKeyString,
            Math.max(
              0,
              Math.min(
                Number(parentCoreYearHitCounts?.[yearKeyString] ?? 0),
                Number(seedCoreYearHitCounts?.[yearKeyString] ?? 0),
              ),
            ),
          ]
        }),
      )

    function recordYearHitUpperBoundPruneRejection({
      stage = "state",
      familyId = null,
      tokens,
      positiveMatchCount = null,
      negativeMatchCount = null,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
      yearGuard,
    }) {
      const normalizedStage = String(stage ?? "state").trim().toLowerCase() || "state"
      const normalizedYearGuard =
        yearGuard && typeof yearGuard === "object"
          ? yearGuard
          : evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
              coreYearHitCounts: {},
              coreYears: cfg.coreYears,
              minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
            })
      rejectionSummary.yearHitUpperBoundPruneCount += 1
      if (normalizedStage === "seed") {
        rejectionSummary.seedYearHitUpperBoundPruneCount += 1
      } else if (normalizedStage === "candidate") {
        rejectionSummary.candidateYearHitUpperBoundPruneCount += 1
      } else {
        rejectionSummary.stateYearHitUpperBoundPruneCount += 1
      }
      incrementFamilyCounter(
        rejectionSummary,
        "yearHitUpperBoundPruneCountByFamily",
        familyId,
      )
      const reason =
        String(normalizedYearGuard.reason ?? "YEAR_HIT_UPPER_BOUND_BELOW_CORE_MIN").trim() ||
        "YEAR_HIT_UPPER_BOUND_BELOW_CORE_MIN"
      rejectionSummary.yearHitUpperBoundReasonCounts[reason] =
        Number(rejectionSummary.yearHitUpperBoundReasonCounts[reason] ?? 0) + 1
      recordRejectedRule({
        reason: `${normalizedStage.toUpperCase()}_${reason}`,
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        positiveRowset,
        negativeRowset,
        positiveMatchCount,
        negativeMatchCount,
        metadata: {
          coreYearSatisfiedCount: Number(normalizedYearGuard.coreYearSatisfiedCount ?? 0),
          minCoreYearHitCount: Number(normalizedYearGuard.minCoreYearHitCount ?? 0),
          violatingYears: Array.isArray(normalizedYearGuard.violatingYears)
            ? normalizedYearGuard.violatingYears.slice()
            : [],
          coreYearHitCounts:
            normalizedYearGuard.coreYearHitCounts &&
            typeof normalizedYearGuard.coreYearHitCounts === "object"
              ? { ...normalizedYearGuard.coreYearHitCounts }
              : {},
        },
      })
    }

    function recordTrainDateBreadthGuardRejection({
      reason,
      tokens,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
      positiveMatchCount = null,
      negativeMatchCount = null,
    }) {
      if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
        rejectionSummary.belowMinTrainMatchedDatesCount += 1
        rejectionSummary.collectionBelowMinTrainMatchedDatesCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
        rejectionSummary.belowMinTrainMatchedMonthsCount += 1
        rejectionSummary.collectionBelowMinTrainMatchedMonthsCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
        rejectionSummary.belowMinTrainMatchedQuartersCount += 1
        rejectionSummary.collectionBelowMinTrainMatchedQuartersCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
        rejectionSummary.belowMinTrainMatchedFoldsCount += 1
        rejectionSummary.collectionBelowMinTrainMatchedFoldsCount += 1
      } else if (reason === "TOP1_DATE_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top1DateHitShareAboveMaxCount += 1
      } else if (reason === "TOP3_DATE_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top3DateHitShareAboveMaxCount += 1
      } else if (reason === "TOP1_FOLD_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top1FoldHitShareAboveMaxCount += 1
      } else if (reason === "TOP3_FOLD_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top3FoldHitShareAboveMaxCount += 1
      } else {
        throw new Error(`unsupported train date breadth rejection reason: ${reason}`)
      }
      recordRejectedRule({
        reason,
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        positiveRowset,
        negativeRowset,
        positiveMatchCount,
        negativeMatchCount,
      })
    }

    function recordSeedTrainMatchedDatePruneRejection({
      reason = "BELOW_MIN_TRAIN_MATCHED_DATES",
      tokens,
      positiveMatchCount = null,
      negativeMatchCount = null,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
    }) {
      if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
        rejectionSummary.belowMinTrainMatchedDatesCount += 1
        rejectionSummary.seedBelowMinTrainMatchedDatesCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
        rejectionSummary.belowMinTrainMatchedMonthsCount += 1
        rejectionSummary.seedBelowMinTrainMatchedMonthsCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
        rejectionSummary.belowMinTrainMatchedQuartersCount += 1
        rejectionSummary.seedBelowMinTrainMatchedQuartersCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
        rejectionSummary.belowMinTrainMatchedFoldsCount += 1
        rejectionSummary.seedBelowMinTrainMatchedFoldsCount += 1
      } else {
        throw new Error(`unsupported seed train breadth prune reason: ${reason}`)
      }
      recordRejectedRule({
        reason:
          reason === "BELOW_MIN_TRAIN_MATCHED_DATES"
            ? "SEED_BELOW_MIN_TRAIN_MATCHED_DATES"
            : reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS"
              ? "SEED_BELOW_MIN_TRAIN_MATCHED_MONTHS"
              : reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS"
                ? "SEED_BELOW_MIN_TRAIN_MATCHED_QUARTERS"
                : "SEED_BELOW_MIN_TRAIN_MATCHED_FOLDS",
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        positiveRowset,
        negativeRowset,
        positiveMatchCount,
        negativeMatchCount,
      })
    }

    function recordStateTrainMatchedDatePruneRejection({
      reason = "BELOW_MIN_TRAIN_MATCHED_DATES",
      tokens,
      positiveMatchCount = null,
      negativeMatchCount = null,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
    }) {
      if (reason === "BELOW_MIN_TRAIN_MATCHED_DATES") {
        rejectionSummary.belowMinTrainMatchedDatesCount += 1
        rejectionSummary.trainMatchedDatesPrunedStateCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS") {
        rejectionSummary.belowMinTrainMatchedMonthsCount += 1
        rejectionSummary.trainMatchedMonthsPrunedStateCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS") {
        rejectionSummary.belowMinTrainMatchedQuartersCount += 1
        rejectionSummary.trainMatchedQuartersPrunedStateCount += 1
      } else if (reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS") {
        rejectionSummary.belowMinTrainMatchedFoldsCount += 1
        rejectionSummary.trainMatchedFoldsPrunedStateCount += 1
      } else if (reason === "TOP1_DATE_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top1DateHitShareAboveMaxCount += 1
      } else if (reason === "TOP3_DATE_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top3DateHitShareAboveMaxCount += 1
      } else if (reason === "TOP1_FOLD_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top1FoldHitShareAboveMaxCount += 1
      } else if (reason === "TOP3_FOLD_HIT_SHARE_ABOVE_MAX") {
        rejectionSummary.top3FoldHitShareAboveMaxCount += 1
      } else {
        throw new Error(`unsupported state train breadth prune reason: ${reason}`)
      }
      recordRejectedRule({
        reason:
          reason === "BELOW_MIN_TRAIN_MATCHED_DATES"
            ? "STATE_BELOW_MIN_TRAIN_MATCHED_DATES"
            : reason === "BELOW_MIN_TRAIN_MATCHED_MONTHS"
              ? "STATE_BELOW_MIN_TRAIN_MATCHED_MONTHS"
              : reason === "BELOW_MIN_TRAIN_MATCHED_QUARTERS"
                ? "STATE_BELOW_MIN_TRAIN_MATCHED_QUARTERS"
                : reason === "BELOW_MIN_TRAIN_MATCHED_FOLDS"
                  ? "STATE_BELOW_MIN_TRAIN_MATCHED_FOLDS"
                  : reason,
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        positiveRowset,
        negativeRowset,
        positiveMatchCount,
        negativeMatchCount,
      })
    }

    function recordPromotableUpperBoundPruneRejection({
      stage = "state",
      familyId = null,
      reason = "PROMOTABLE_UPPER_BOUND_BELOW_MIN_TRAIN_MATCHED_DATES",
      tokens,
      positiveMatchCount = null,
      negativeMatchCount = null,
      positiveRowIndexes = null,
      negativeRowIndexes = null,
      positiveRowset = null,
      negativeRowset = null,
    }) {
      const normalizedStage = String(stage ?? "state").trim().toLowerCase() || "state"
      rejectionSummary.promotableUpperBoundPruneCount += 1
      if (normalizedStage === "seed") {
        rejectionSummary.seedPromotableUpperBoundPruneCount += 1
      } else if (normalizedStage === "candidate") {
        rejectionSummary.candidatePromotableUpperBoundPruneCount += 1
      } else {
        rejectionSummary.statePromotableUpperBoundPruneCount += 1
      }
      incrementFamilyCounter(
        rejectionSummary,
        "promotableUpperBoundPruneCountByFamily",
        familyId,
      )
      rejectionSummary.promotableUpperBoundReasonCounts[reason] =
        Number(rejectionSummary.promotableUpperBoundReasonCounts[reason] ?? 0) + 1
      recordRejectedRule({
        reason: `${normalizedStage.toUpperCase()}_${reason}`,
        tokens,
        positiveRowIndexes,
        negativeRowIndexes,
        positiveRowset,
        negativeRowset,
        positiveMatchCount,
        negativeMatchCount,
      })
    }

    const collectedByMatchSignature = new Map()
    let collectedRuleCount = 0
    const applyMatchedDateSignatureCap = (rules) =>
      applyPerfectPrototypeTemporalSignatureCaps({
        rules,
        maxRulesPerMatchedDateSignature: cfg.maxRulesPerMatchedDateSignature,
        maxRulesPerMatchedMonthSignature: cfg.maxRulesPerMatchedMonthSignature,
        maxRulesPerMatchedQuarterSignature: cfg.maxRulesPerMatchedQuarterSignature,
      })
    function evaluatePositiveHitStatsBreadthGuard(hitStats, familyId = null) {
      const breadthMinimums = resolveFamilySpecificBreadthMinimums({
        cfg,
        familyId,
      })
      return evaluatePerfectPrototypeTrainDateBreadthGuards({
        rule: {
          matchedDateCount: Number(hitStats?.distinctDateCount ?? hitStats?.matchedDateCount ?? 0),
          matchedMonthCount: Number(hitStats?.distinctMonthCount ?? hitStats?.matchedMonthCount ?? 0),
          matchedQuarterCount: Number(
            hitStats?.distinctQuarterCount ?? hitStats?.matchedQuarterCount ?? 0,
          ),
          matchedFoldCount: Number(hitStats?.distinctFoldCount ?? hitStats?.matchedFoldCount ?? 0),
          top1FoldHitShare: Number(hitStats?.top1FoldHitShare ?? 0),
          top3FoldHitShare: Number(hitStats?.top3FoldHitShare ?? 0),
        },
        minTrainMatchedDates: breadthMinimums.minTrainMatchedDates,
        minTrainMatchedMonths: breadthMinimums.minTrainMatchedMonths,
        minTrainMatchedQuarters: breadthMinimums.minTrainMatchedQuarters,
        minTrainMatchedFolds: breadthMinimums.minTrainMatchedFolds,
        maxTop1DateHitShare: cfg.maxTop1DateHitShare,
        maxTop3DateHitShare: cfg.maxTop3DateHitShare,
        maxTop1FoldHitShare: cfg.maxTop1FoldHitShare,
        maxTop3FoldHitShare: cfg.maxTop3FoldHitShare,
      })
    }

    function evaluatePromotableUpperBoundGuardFromCounts({
      distinctDateUpperBound = 0,
      matchedMonthUpperBound = 0,
      matchedFoldUpperBound = 0,
    }) {
      if (!promotableSearchPruneEnabled) {
        return { ok: true, reason: null }
      }
      return evaluatePerfectPrototypePromotableUpperBoundGuard({
        distinctDateUpperBound,
        matchedMonthUpperBound,
        matchedFoldUpperBound,
        minTrainMatchedDates: cfg.promotableMinTrainMatchedDates,
        minTrainMatchedMonths: cfg.promotableMinTrainMatchedMonths,
        minTrainMatchedFolds: cfg.promotableMinTrainMatchedFolds,
        maxTop1DateHitShare: cfg.promotableMaxTop1DateHitShare,
        maxTop3DateHitShare: cfg.promotableMaxTop3DateHitShare,
        maxTop1FoldHitShare: cfg.promotableMaxTop1FoldHitShare,
        maxTop3FoldHitShare: cfg.promotableMaxTop3FoldHitShare,
      })
    }
    const topKHitTracker = createPerfectPrototypeTopKHitTracker({
      maxRules: cfg.maxRules,
    })
    let livePartialRuleRevision = 0
    let livePartialRuleCount = 0
    let livePartialRuleCheckpointCount = 0
    let livePartialRuleWriteMs = 0
    let lastLivePartialRuleCheckpointAt = Date.now()
    let lastLivePartialRuleCheckpointExploredStates = 0
    let lastPublishedLivePartialLocalKthHitFloor = null
    let livePartialRuleDirty = false
    let livePartialBootstrapSnapshotCount = 0
    let livePartialBootstrapRuleCount = 0
    let externalKthHitFloor = null
    let externalKthHitFloorRevision = 0
    let externalKthHitFloorPollCount = 0
    let externalKthHitFloorAppliedCount = 0
    let nextExternalKthHitFloorPollAt = Date.now()
    let lastExternalKthHitFloorStatePollExploredStates = 0
    let externalAllocatedMaxSearchStates = null
    let externalBudgetRevision = 0
    let externalBudgetPollCount = 0
    let externalBudgetDecisionPollCount = 0
    let externalBudgetAppliedCount = 0
    let externalBudgetDecreaseAppliedCount = 0
    let externalBudgetDecreaseSearchStates = 0
    let externalBudgetAllowanceAppliedCount = 0
    let externalBudgetAllowanceSeenCount = 0
    let externalBudgetAllowanceConsumedCount = 0
    let externalBudgetRequestRevision = 0
    let externalBudgetRequestCount = 0
    let externalBudgetRequestSatisfiedCount = 0
    let externalBudgetRequestDeniedCount = 0
    let externalBudgetRequestPendingCount = 0
    let externalBudgetRequestWaitMsTotal = 0
    let externalBudgetPendingWaitMsTotal = 0
    let externalBudgetCommitRequestCount = 0
    let externalBudgetCommitRevision = 0
    let externalBudgetLastDecision = null
    let pendingExternalBudgetRequestRevision = null
    let pendingExternalBudgetCommitRevision = null
    let pendingExternalBudgetCommitRequestRevision = null
    let approvedExternalBudgetAllocatedMaxSearchStates = null
    let approvedExternalBudgetRevision = 0
    let approvedExternalBudgetRequestRevision = 0
    let nextExternalBudgetDecisionPollAt = Date.now()
    let nextExternalBudgetPollAt = Date.now()
    let lastExternalBudgetStatePollExploredStates = 0
    const maybeRefreshExternalKthHitFloor = async ({ force = false } = {}) => {
      if (!externalKthHitFloorPath) return
      const now = Date.now()
      const statesSinceLastPoll = exploredStates - lastExternalKthHitFloorStatePollExploredStates
      if (
        force !== true &&
        now < nextExternalKthHitFloorPollAt &&
        statesSinceLastPoll < externalKthHitFloorStateInterval
      ) {
        return
      }
      nextExternalKthHitFloorPollAt = now + externalKthHitFloorPollMs
      lastExternalKthHitFloorStatePollExploredStates = exploredStates
      externalKthHitFloorPollCount += 1
      const payload = await readOptionalJson(externalKthHitFloorPath)
      if (payload == null) return
      const revision = Math.floor(Number(payload?.revision) || 0)
      const rawKthHitFloor = payload?.kthHitFloor
      const kthHitFloorCandidate =
        rawKthHitFloor == null || String(rawKthHitFloor).trim().length < 1
          ? null
          : Math.floor(Number(rawKthHitFloor) || 0)
      const observedRuleCountCandidate = Math.floor(Number(payload?.observedRuleCount) || 0)
      if (!Number.isInteger(revision) || revision < 0) {
        throw new Error(
          `Indexed miner external kth-hit-floor file has invalid revision: ${externalKthHitFloorPath}`,
        )
      }
      if (revision < 1 && kthHitFloorCandidate == null) {
        return
      }
      if (!Number.isInteger(kthHitFloorCandidate) || kthHitFloorCandidate < 1) {
        throw new Error(
          `Indexed miner external kth-hit-floor file has invalid kthHitFloor: ${externalKthHitFloorPath}`,
        )
      }
      if (!Number.isInteger(observedRuleCountCandidate) || observedRuleCountCandidate < 0) {
        throw new Error(
          `Indexed miner external kth-hit-floor file has invalid observedRuleCount: ${externalKthHitFloorPath}`,
        )
      }
      if (revision < externalKthHitFloorRevision) {
        throw new Error(
          [
            "Indexed miner external kth-hit-floor revision regressed.",
            `path=${externalKthHitFloorPath}`,
            `currentRevision=${externalKthHitFloorRevision}`,
            `nextRevision=${revision}`,
          ].join("\n"),
        )
      }
      const previousFloor = externalKthHitFloor
      if (revision > externalKthHitFloorRevision) {
        externalKthHitFloorRevision = revision
      }
      if (
        !Number.isInteger(previousFloor) ||
        previousFloor < 1 ||
        kthHitFloorCandidate > previousFloor
      ) {
        externalKthHitFloor = kthHitFloorCandidate
        if (previousFloor !== externalKthHitFloor) {
          externalKthHitFloorAppliedCount += 1
        }
      }
    }
    const getCurrentKthHitFloor = () =>
      enableTopKBranchAndBound
        ? resolvePerfectPrototypeEffectiveKthHitFloor(
            topKHitTracker.getKthHitFloor(),
            initialKthHitFloor,
            externalKthHitFloor,
          )
        : null
    const computeLiveCanonicalRuleCount = () =>
      applyMatchedDateSignatureCap(Array.from(collectedByMatchSignature.values()).flat()).rules.length
    const getLivePartialSnapshotMaxRules = () => {
      const currentEffectiveKthHitFloor = getCurrentKthHitFloor()
      if (
        !Number.isInteger(currentEffectiveKthHitFloor) &&
        bootstrapLivePartialMaxRules > cfg.maxRules
      ) {
        return bootstrapLivePartialMaxRules
      }
      return cfg.maxRules
    }
    const maybeWriteLivePartialRuleSnapshot = async ({ force = false } = {}) => {
      if (!livePartialRulesPath) return
      if (livePartialRuleDirty !== true) return
      const now = Date.now()
      const statesSinceLastCheckpoint = exploredStates - lastLivePartialRuleCheckpointExploredStates
      const currentLocalKthHitFloor = topKHitTracker.getKthHitFloor()
      const currentEffectiveKthHitFloor = getCurrentKthHitFloor()
      const publishDueToFloorIncrease =
        Number.isInteger(currentLocalKthHitFloor) &&
        currentLocalKthHitFloor > 0 &&
        (!Number.isInteger(lastPublishedLivePartialLocalKthHitFloor) ||
          currentLocalKthHitFloor > lastPublishedLivePartialLocalKthHitFloor)
      if (
        force !== true &&
        publishDueToFloorIncrease !== true &&
        now - lastLivePartialRuleCheckpointAt < LIVE_PARTIAL_RULE_CHECKPOINT_MS &&
        statesSinceLastCheckpoint < LIVE_PARTIAL_RULE_STATE_INTERVAL
      ) {
        return
      }
      const liveCanonicalRules = applyMatchedDateSignatureCap(
        Array.from(collectedByMatchSignature.values()).flat(),
      ).rules
      const snapshotMaxRules = getLivePartialSnapshotMaxRules()
      const bootstrapModeActive = snapshotMaxRules > cfg.maxRules
      const snapshotRules = selectLivePartialRulesForSnapshot({
        rules: liveCanonicalRules,
        maxRules: snapshotMaxRules,
      })
      noteFeatureContributionLivePartialRules({
        rules: snapshotRules,
      })
      const writeStartedAt = Date.now()
      livePartialRuleRevision += 1
      livePartialRuleCount = snapshotRules.length
      livePartialRuleCheckpointCount += 1
      if (bootstrapModeActive) {
        livePartialBootstrapSnapshotCount += 1
        livePartialBootstrapRuleCount = Math.max(
          livePartialBootstrapRuleCount,
          snapshotRules.length,
        )
      }
      await writePerfectPrototypeLivePartialRulesSnapshot({
        outDir: resolvedOutDir,
        snapshot: {
          version: 1,
          revision: livePartialRuleRevision,
          observedRuleCount: collectedRuleCount,
          liveCanonicalRuleCount: computeLiveCanonicalRuleCount(),
          localKthHitFloor: currentLocalKthHitFloor,
          effectiveKthHitFloor: currentEffectiveKthHitFloor,
          snapshotMaxRules,
          bootstrapModeActive,
          updatedAt: new Date(now).toISOString(),
          rules: snapshotRules,
        },
      })
      livePartialRuleWriteMs += Date.now() - writeStartedAt
      lastLivePartialRuleCheckpointAt = now
      lastLivePartialRuleCheckpointExploredStates = exploredStates
      lastPublishedLivePartialLocalKthHitFloor =
        Number.isInteger(currentLocalKthHitFloor) && currentLocalKthHitFloor > 0
          ? currentLocalKthHitFloor
          : null
      livePartialRuleDirty = false
    }
    if (livePartialRulesPath) {
      await writePerfectPrototypeLivePartialRulesSnapshot({
        outDir: resolvedOutDir,
        snapshot: {
          version: 1,
          revision: 0,
          observedRuleCount: 0,
          liveCanonicalRuleCount: 0,
          localKthHitFloor: null,
          updatedAt: new Date().toISOString(),
          rules: [],
        },
      })
    }
    const searchStateCache = createPerfectPrototypeSearchStateCache({
      maxBytes: Math.max(
        8 * 1024 * 1024,
        Math.floor(Number(options?.searchStateCacheMaxBytes ?? 128 * 1024 * 1024) || 0),
      ),
    })
    let exploredStates = 0
    let boundPruneCount = 0
    let stateDominancePruneCount = 0
    let childOrderingMs = 0
    let orderingNegativeLoads = 0
    let orderingHeadExactLoads = 0
    let orderingHeadRerankMs = 0
    let budgetStopCount = 0
    let budgetStopExploredStates = null
    let budgetStopReason = null
    let budgetStopTriggered = false
    let searchLastProgressAt = Date.now()
    let lastSearchProgressExploredStates = 0
    let searchProgressRevision = 0
    let currentSearchDepth = 0
    let maxSearchDepth = 0
    let candidateDescriptorCount = 0
    let acceptedCandidateCount = 0
    const emptyRowset = createPerfectPrototypeSparseRowset(new Uint32Array())
    const rowProjectedCounts =
      rowProjectedCandidateThreshold > 0 ? new Int32Array(selectedSeedCount) : null
    const rowProjectedTouchedSeedIndexes =
      rowProjectedCandidateThreshold > 0 ? new Int32Array(selectedSeedCount) : null
    const getRootSeedEndIndexForTelemetry = () =>
      rootSeedEndIndexExclusive == null
        ? selectedSeedCount
        : Math.min(rootSeedEndIndexExclusive, selectedSeedCount)
    const getLiveRowsetIntersectionTelemetry = () => {
      const rowsetRuntimeStats = getPerfectPrototypeRowsetRuntimeStats()
      const sparseSparseIntersectionMs = Number(
        rowsetRuntimeStats?.sparseSparseIntersectionMs ?? 0,
      )
      const sparseBitmapIntersectionMs = Number(
        rowsetRuntimeStats?.sparseBitmapIntersectionMs ?? 0,
      )
      const bitmapIntersectionMs = Number(rowsetRuntimeStats?.bitmapIntersectionMs ?? 0)
      return {
        sparseSparseIntersectionMs,
        sparseBitmapIntersectionMs,
        bitmapIntersectionMs,
        rowsetIntersectionMs: Number(
          (sparseSparseIntersectionMs + sparseBitmapIntersectionMs + bitmapIntersectionMs).toFixed(
            3,
          ),
        ),
      }
    }
    const buildContributionTelemetry = () => ({
      ...buildPerfectPrototypeFeatureContributionTelemetry({
        featureContributionByKey,
      }),
      ...(rowContributionDiagnostics?.buildTelemetry() ?? {}),
    })
    const buildFeatureContributionCostSnapshot = () => ({
      negativeCountResolutionMs,
      childRowsetMaterializeMs,
      rowsetIntersectionMs: getLiveRowsetIntersectionTelemetry().rowsetIntersectionMs,
    })
    const noteFeatureContributionSelection = ({
      token,
      nextPositiveCount = 0,
      negativeDropEstimate = 0,
    }) => {
      forEachFeatureContributionEntry([token], (entry) => {
        entry.selectionCount += 1
        entry.branchPositiveMass += Math.max(0, Number(nextPositiveCount ?? 0))
        entry.branchNegativeDropMass += Math.max(0, Number(negativeDropEstimate ?? 0))
      })
    }
    const noteFeatureContributionAccepted = ({
      token,
      nextPositiveCount = 0,
      resolvedNextNegativeCount = 0,
    }) => {
      forEachFeatureContributionEntry([token], (entry) => {
        entry.acceptedCount += 1
        entry.acceptedPositiveMass += Math.max(0, Number(nextPositiveCount ?? 0))
        entry.acceptedNegativeMass += Math.max(0, Number(resolvedNextNegativeCount ?? 0))
      })
    }
    const noteFeatureContributionExactRule = ({
      tokens,
      positiveMass = 0,
      positiveRowIndexes = [],
    }) => {
      const normalizedPositiveMass = Math.max(0, Number(positiveMass ?? 0))
      forEachFeatureContributionEntry(tokens, (entry) => {
        entry.exactRuleCount += 1
        entry.exactPositiveMatchMass += normalizedPositiveMass
      })
      rowContributionDiagnostics?.noteExactPositiveIndexes(positiveRowIndexes)
    }
    const noteFeatureContributionLivePartialRules = ({ rules }) => {
      for (const rule of Array.isArray(rules) ? rules : []) {
        const positiveMass = Math.max(
          0,
          Number(rule?.trainHitCount ?? rule?.trainMatchCount ?? 0),
        )
        forEachFeatureContributionEntry(rule?.tokens ?? [], (entry) => {
          entry.livePartialSnapshotRuleCount += 1
          entry.livePartialPositiveMatchMass += positiveMass
        })
      }
    }
    const noteFeatureContributionHeadExactRerankLoad = ({ token }) => {
      forEachFeatureContributionEntry([token], (entry) => {
        entry.headExactRerankLoadCount += 1
      })
    }
    const noteFeatureContributionCostDelta = ({
      token,
      before,
      after = buildFeatureContributionCostSnapshot(),
    }) => {
      if (!before) return
      const negativeResolutionDelta = Math.max(
        0,
        Number(after?.negativeCountResolutionMs ?? 0) -
          Number(before?.negativeCountResolutionMs ?? 0),
      )
      const rowsetIntersectionDelta = Math.max(
        0,
        Number(after?.rowsetIntersectionMs ?? 0) -
          Number(before?.rowsetIntersectionMs ?? 0),
      )
      const childRowsetMaterializeDelta = Math.max(
        0,
        Number(after?.childRowsetMaterializeMs ?? 0) -
          Number(before?.childRowsetMaterializeMs ?? 0),
      )
      if (
        negativeResolutionDelta <= 0 &&
        rowsetIntersectionDelta <= 0 &&
        childRowsetMaterializeDelta <= 0
      ) {
        return
      }
      forEachFeatureContributionEntry([token], (entry) => {
        entry.negativeResolutionMs += negativeResolutionDelta
        entry.rowsetIntersectionMs += rowsetIntersectionDelta
        entry.childRowsetMaterializeMs += childRowsetMaterializeDelta
      })
    }
    const buildLiveExactSearchTelemetry = () => ({
      workerChunkIndex,
      rootSeedStartIndex,
      rootSeedEndIndexExclusive: getRootSeedEndIndexForTelemetry(),
      currentSearchDepth,
      maxSearchDepth,
      candidateDescriptorCount,
      acceptedCandidateCount,
      seedPostingCacheEntryLimit,
      seedPositiveLoadCount,
      seedNegativeLoadCount,
      seedPostingLoadMs,
      seedPostingPrewarmMs,
      seedPostingPrewarmTokenCount,
      candidateDescriptorBuildMs,
      negativeCountResolutionMs,
      childRowsetMaterializeMs,
      rowProjectedCandidateThreshold,
      rowProjectedCandidateBuildMs,
      rowProjectedActivationCount,
      rowProjectedTouchedRowCount,
      rowProjectedTokenVisitCount,
      rowProjectedCandidateSeedCount,
      searchProgressRevision,
      ...getLiveRowsetIntersectionTelemetry(),
      ...buildContributionTelemetry(),
    })
    const buildMemoLookupTelemetry = (searchStateStats = {}) => ({
      memoHitCount: searchStateStats.memoHitCount,
      memoLookupMs: searchStateStats.memoLookupMs,
      memoCacheBytes: searchStateStats.cacheBytes,
      memoEvictedBucketCount: searchStateStats.evictedBucketCount,
      memoOversizeSkipCount: searchStateStats.oversizeSkipCount,
      memoRangeSkipPrefixCount: searchStateStats.memoRangeSkipPrefixCount,
      memoRangeSkipSuffixCount: searchStateStats.memoRangeSkipSuffixCount,
      memoRangeSummaryRebuildCount: searchStateStats.memoRangeSummaryRebuildCount,
      memoExactFingerprintFastHitCount: searchStateStats.memoExactFingerprintFastHitCount,
      memoExactFingerprintFastRejectCount: searchStateStats.memoExactFingerprintFastRejectCount,
      memoExactFingerprintScanCount: searchStateStats.memoExactFingerprintScanCount,
      memoFingerprintMetadataRebuildCount:
        searchStateStats.memoFingerprintMetadataRebuildCount,
      memoLookupFingerprintMs: searchStateStats.memoLookupFingerprintMs,
      memoLookupExactFingerprintScanMs: searchStateStats.memoLookupExactFingerprintScanMs,
      memoLookupRangeSummaryPrepMs: searchStateStats.memoLookupRangeSummaryPrepMs,
      memoLookupPrefixScanMs: searchStateStats.memoLookupPrefixScanMs,
      memoLookupSuffixScanMs: searchStateStats.memoLookupSuffixScanMs,
      memoLookupEntryScanCount: searchStateStats.memoLookupEntryScanCount,
      memoLookupFingerprintMissCount: searchStateStats.memoLookupFingerprintMissCount,
      memoLookupRangeCandidateBucketCount:
        searchStateStats.memoLookupRangeCandidateBucketCount,
    })
    const releaseBorrowedChildRowsets = ({
      nextPositiveRowset = null,
      nextNegativeRowset = null,
    } = {}) => {
      if (nextNegativeRowset && nextNegativeRowset !== nextPositiveRowset) {
        releasePerfectPrototypeBorrowedRowset(nextNegativeRowset)
      }
      if (nextPositiveRowset) {
        releasePerfectPrototypeBorrowedRowset(nextPositiveRowset)
      }
    }
    const markBudgetStop = ({ reason = "allocated_budget_exhausted" } = {}) => {
      rejectionSummary.truncatedByMaxSearchStates = true
      if (budgetStopTriggered === true) return
      budgetStopTriggered = true
      budgetStopCount += 1
      budgetStopExploredStates = exploredStates
      budgetStopReason = reason
    }
    const getEffectiveAllocatedMaxSearchStates = () =>
      Math.max(
        Math.max(1, Number(guardBandAllocatedSearchStates ?? 0) + 1),
        Number.isInteger(externalAllocatedMaxSearchStates) && externalAllocatedMaxSearchStates > 0
          ? externalAllocatedMaxSearchStates
          : allocatedMaxSearchStates,
      )
    const getApprovedAllocatedMaxSearchStates = () =>
      Math.max(
        getEffectiveAllocatedMaxSearchStates(),
        Number.isInteger(approvedExternalBudgetAllocatedMaxSearchStates) &&
          approvedExternalBudgetAllocatedMaxSearchStates > 0
          ? approvedExternalBudgetAllocatedMaxSearchStates
          : 0,
      )
    const clearApprovedExternalBudgetAllowance = () => {
      approvedExternalBudgetAllocatedMaxSearchStates = null
      approvedExternalBudgetRevision = 0
      approvedExternalBudgetRequestRevision = 0
      pendingExternalBudgetCommitRevision = null
      pendingExternalBudgetCommitRequestRevision = null
    }
    const noteApprovedExternalBudgetAllowance = ({
      allocatedCandidate,
      budgetRevision,
      requestRevision,
    }) => {
      const normalizedAllocatedCandidate = Math.floor(Number(allocatedCandidate) || 0)
      const normalizedBudgetRevision =
        budgetRevision == null ? null : Math.floor(Number(budgetRevision) || 0)
      const normalizedRequestRevision =
        requestRevision == null ? null : Math.floor(Number(requestRevision) || 0)
      if (
        !Number.isInteger(normalizedAllocatedCandidate) ||
        normalizedAllocatedCandidate <
          Math.max(1, Number(guardBandAllocatedSearchStates ?? 0) + 1)
      ) {
        throw new Error(
          `Indexed miner external budget candidate is invalid: allocatedMaxSearchStates=${normalizedAllocatedCandidate}`,
        )
      }
      if (
        normalizedBudgetRevision != null &&
        (!Number.isInteger(normalizedBudgetRevision) || normalizedBudgetRevision < 0)
      ) {
        throw new Error(
          `Indexed miner external budget revision is invalid: budgetRevision=${normalizedBudgetRevision}`,
        )
      }
      if (
        normalizedRequestRevision != null &&
        (!Number.isInteger(normalizedRequestRevision) || normalizedRequestRevision < 1)
      ) {
        throw new Error(
          `Indexed miner external budget request revision is invalid: requestRevision=${normalizedRequestRevision}`,
        )
      }
      const previousApprovedAllocatedMaxSearchStates = getApprovedAllocatedMaxSearchStates()
      if (
        approvedExternalBudgetAllocatedMaxSearchStates == null ||
        normalizedAllocatedCandidate > approvedExternalBudgetAllocatedMaxSearchStates
      ) {
        approvedExternalBudgetAllocatedMaxSearchStates = normalizedAllocatedCandidate
      }
      if (
        normalizedBudgetRevision != null &&
        normalizedBudgetRevision > approvedExternalBudgetRevision
      ) {
        approvedExternalBudgetRevision = normalizedBudgetRevision
      }
      if (
        normalizedRequestRevision != null &&
        normalizedRequestRevision > approvedExternalBudgetRequestRevision
      ) {
        approvedExternalBudgetRequestRevision = normalizedRequestRevision
      }
      externalBudgetLastDecision = "granted"
      if (getApprovedAllocatedMaxSearchStates() > previousApprovedAllocatedMaxSearchStates) {
        externalBudgetAllowanceAppliedCount += 1
        externalBudgetAllowanceSeenCount += 1
      }
      return getApprovedAllocatedMaxSearchStates() > previousApprovedAllocatedMaxSearchStates
    }
    const applyExternalAllocatedSearchBudget = async ({
      allocatedCandidate,
      budgetRevision,
    }) => {
      const normalizedAllocatedCandidate = Math.floor(Number(allocatedCandidate) || 0)
      const normalizedBudgetRevision =
        budgetRevision == null ? null : Math.floor(Number(budgetRevision) || 0)
      const minimumAllocatedMaxSearchStates = Math.max(
        1,
        Number(guardBandAllocatedSearchStates ?? 0) + 1,
      )
      if (
        !Number.isInteger(normalizedAllocatedCandidate) ||
        normalizedAllocatedCandidate < minimumAllocatedMaxSearchStates
      ) {
        throw new Error(
          `Indexed miner external budget candidate is invalid: allocatedMaxSearchStates=${normalizedAllocatedCandidate}`,
        )
      }
      if (
        normalizedBudgetRevision != null &&
        (!Number.isInteger(normalizedBudgetRevision) || normalizedBudgetRevision < 0)
      ) {
        throw new Error(
          `Indexed miner external budget revision is invalid: budgetRevision=${normalizedBudgetRevision}`,
        )
      }
      const previousEffectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
      const previousExternalAllocatedMaxSearchStates = Math.max(
        0,
        Number(externalAllocatedMaxSearchStates ?? 0),
      )
      if (
        normalizedBudgetRevision != null &&
        normalizedBudgetRevision > externalBudgetRevision
      ) {
        externalBudgetRevision = normalizedBudgetRevision
      }
      externalAllocatedMaxSearchStates = normalizedAllocatedCandidate
      const currentEffectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
      if (currentEffectiveAllocatedMaxSearchStates === previousEffectiveAllocatedMaxSearchStates) {
        return false
      }
      externalBudgetAppliedCount += 1
      if (currentEffectiveAllocatedMaxSearchStates < previousEffectiveAllocatedMaxSearchStates) {
        externalBudgetDecreaseAppliedCount += 1
        externalBudgetDecreaseSearchStates +=
          previousEffectiveAllocatedMaxSearchStates - currentEffectiveAllocatedMaxSearchStates
      }
      externalBudgetLastDecision = "granted"
      if (
        normalizedBudgetRevision != null &&
        normalizedBudgetRevision > 0 &&
        normalizedBudgetRevision > externalBudgetCommitRevision
      ) {
        externalBudgetCommitRevision = normalizedBudgetRevision
      }
      if (
        Number.isInteger(approvedExternalBudgetRevision) &&
        approvedExternalBudgetRevision > 0 &&
        normalizedBudgetRevision != null &&
        normalizedBudgetRevision >= approvedExternalBudgetRevision
      ) {
        externalBudgetAllowanceConsumedCount += 1
        clearApprovedExternalBudgetAllowance()
      }
      if (pendingExternalBudgetRequestRevision != null) {
        pendingExternalBudgetRequestRevision = null
        externalBudgetRequestSatisfiedCount += 1
      }
      pendingExternalBudgetCommitRevision = null
      pendingExternalBudgetCommitRequestRevision = null
      return true
    }
    const maybeRefreshExternalAllocatedSearchBudget = async ({ force = false } = {}) => {
      if (!externalBudgetPath) return
      const now = Date.now()
      const statesSinceLastPoll = exploredStates - lastExternalBudgetStatePollExploredStates
      if (
        force !== true &&
        now < nextExternalBudgetPollAt &&
        statesSinceLastPoll < externalBudgetStateInterval
      ) {
        return
      }
      nextExternalBudgetPollAt = now + externalBudgetPollMs
      lastExternalBudgetStatePollExploredStates = exploredStates
      externalBudgetPollCount += 1
      const payload = await readOptionalJson(externalBudgetPath)
      if (payload == null) return
      const revision = Math.floor(Number(payload?.revision) || 0)
      const payloadChunkIndex =
        payload?.chunkIndex == null ? null : Math.floor(Number(payload.chunkIndex) || 0)
      const allocatedCandidate = Math.floor(Number(payload?.allocatedMaxSearchStates) || 0)
      if (!Number.isInteger(revision) || revision < 0) {
        throw new Error(
          `Indexed miner external budget file has invalid revision: ${externalBudgetPath}`,
        )
      }
      if (
        workerChunkIndex != null &&
        (!Number.isInteger(payloadChunkIndex) || payloadChunkIndex !== workerChunkIndex)
      ) {
        throw new Error(
          [
            "Indexed miner external budget file has an unexpected chunkIndex.",
            `path=${externalBudgetPath}`,
            `expectedChunkIndex=${workerChunkIndex}`,
            `receivedChunkIndex=${payloadChunkIndex}`,
          ].join("\n"),
        )
      }
      const minimumAllocatedMaxSearchStates = Math.max(
        1,
        Number(guardBandAllocatedSearchStates ?? 0) + 1,
      )
      if (
        !Number.isInteger(allocatedCandidate) ||
        allocatedCandidate < minimumAllocatedMaxSearchStates
      ) {
        throw new Error(
          [
            "Indexed miner external budget file has invalid allocatedMaxSearchStates.",
            `path=${externalBudgetPath}`,
            `minimumAllocatedMaxSearchStates=${minimumAllocatedMaxSearchStates}`,
            `receivedAllocatedMaxSearchStates=${allocatedCandidate}`,
          ].join("\n"),
        )
      }
      if (revision < externalBudgetRevision) {
        throw new Error(
          [
            "Indexed miner external budget revision regressed.",
            `path=${externalBudgetPath}`,
            `currentRevision=${externalBudgetRevision}`,
            `nextRevision=${revision}`,
          ].join("\n"),
        )
      }
      await applyExternalAllocatedSearchBudget({
        allocatedCandidate,
        budgetRevision: revision,
      })
    }
    const readExternalBudgetDecision = async ({ force = false } = {}) => {
      if (!externalBudgetDecisionPath) return null
      const now = Date.now()
      if (force !== true && now < nextExternalBudgetDecisionPollAt) {
        return null
      }
      nextExternalBudgetDecisionPollAt = now + externalBudgetDecisionPollMs
      externalBudgetDecisionPollCount += 1
      const payload = await readOptionalJson(externalBudgetDecisionPath)
      if (payload == null) return null
      const requestRevision = Math.floor(Number(payload?.requestRevision) || 0)
      const payloadChunkIndex =
        payload?.chunkIndex == null ? null : Math.floor(Number(payload.chunkIndex) || 0)
      const decision = String(payload?.decision ?? "").trim().toLowerCase()
      const allocatedCandidate = Math.floor(Number(payload?.allocatedMaxSearchStates) || 0)
      const approvedAdditionalSearchStates = Math.floor(
        Number(payload?.approvedAdditionalSearchStates ?? payload?.grantedAdditionalSearchStates ?? 0) ||
          0,
      )
      const budgetRevision =
        payload?.budgetRevision == null ? null : Math.floor(Number(payload.budgetRevision) || 0)
      const updatedAtText = String(payload?.updatedAt ?? "").trim()
      const updatedAtMs =
        updatedAtText.length > 0 && Number.isFinite(Date.parse(updatedAtText))
          ? Date.parse(updatedAtText)
          : null
      if (!Number.isInteger(requestRevision) || requestRevision < 0) {
        throw new Error(
          `Indexed miner external budget decision file has invalid requestRevision: ${externalBudgetDecisionPath}`,
        )
      }
      if (
        workerChunkIndex != null &&
        (!Number.isInteger(payloadChunkIndex) || payloadChunkIndex !== workerChunkIndex)
      ) {
        throw new Error(
          [
            "Indexed miner external budget decision file has an unexpected chunkIndex.",
            `path=${externalBudgetDecisionPath}`,
            `expectedChunkIndex=${workerChunkIndex}`,
            `receivedChunkIndex=${payloadChunkIndex}`,
          ].join("\n"),
        )
      }
      if (!["granted", "pending", "denied"].includes(decision)) {
        throw new Error(
          `Indexed miner external budget decision file has invalid decision: ${externalBudgetDecisionPath}`,
        )
      }
      const minimumAllocatedMaxSearchStates = Math.max(
        1,
        Number(guardBandAllocatedSearchStates ?? 0) + 1,
      )
      if (
        !Number.isInteger(allocatedCandidate) ||
        allocatedCandidate < minimumAllocatedMaxSearchStates
      ) {
        throw new Error(
          [
            "Indexed miner external budget decision file has invalid allocatedMaxSearchStates.",
            `path=${externalBudgetDecisionPath}`,
            `minimumAllocatedMaxSearchStates=${minimumAllocatedMaxSearchStates}`,
            `receivedAllocatedMaxSearchStates=${allocatedCandidate}`,
          ].join("\n"),
        )
      }
      if (
        !Number.isInteger(approvedAdditionalSearchStates) ||
        approvedAdditionalSearchStates < 0
      ) {
        throw new Error(
          `Indexed miner external budget decision file has invalid approvedAdditionalSearchStates: ${externalBudgetDecisionPath}`,
        )
      }
      if (
        budgetRevision != null &&
        (!Number.isInteger(budgetRevision) || budgetRevision < 1)
      ) {
        throw new Error(
          `Indexed miner external budget decision file has invalid budgetRevision: ${externalBudgetDecisionPath}`,
        )
      }
      return {
        requestRevision,
        decision,
        allocatedMaxSearchStates: allocatedCandidate,
        approvedAdditionalSearchStates,
        budgetRevision,
        updatedAtMs,
      }
    }
    const maybeSubmitExternalBudgetRequest = async ({
      reason = "allocated_budget_exhausted",
      force = false,
    } = {}) => {
      if (!externalBudgetPath || !externalBudgetRequestPath || !externalBudgetDecisionPath) {
        return null
      }
      if (pendingExternalBudgetRequestRevision != null) {
        return pendingExternalBudgetRequestRevision
      }
      const currentEffectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
      const headroomStates = Math.max(0, currentEffectiveAllocatedMaxSearchStates - exploredStates)
      if (force !== true && headroomStates > externalBudgetRequestHeadroomStates) {
        return null
      }
      externalBudgetRequestRevision += 1
      pendingExternalBudgetRequestRevision = externalBudgetRequestRevision
      externalBudgetRequestCount += 1
      await writeJsonAtomic(externalBudgetRequestPath, {
        version: 1,
        revision: externalBudgetRequestRevision,
        chunkIndex: workerChunkIndex,
        exploredStates,
        effectiveAllocatedMaxSearchStates: currentEffectiveAllocatedMaxSearchStates,
        requestedAdditionalSearchStates: externalBudgetRequestSearchStates,
        reason,
        updatedAt: new Date().toISOString(),
      })
      return pendingExternalBudgetRequestRevision
    }
    const maybeSubmitExternalBudgetCommitRequest = async ({ requestRevision = null } = {}) => {
      if (!externalBudgetCommitPath) return false
      const approvedAllocatedCandidate = Math.floor(
        Number(approvedExternalBudgetAllocatedMaxSearchStates) || 0,
      )
      const approvedBudgetRevisionCandidate = Math.floor(Number(approvedExternalBudgetRevision) || 0)
      const approvedRequestRevisionCandidate = Math.floor(
        Number(requestRevision ?? approvedExternalBudgetRequestRevision) || 0,
      )
      if (
        !Number.isInteger(approvedAllocatedCandidate) ||
        approvedAllocatedCandidate <= getEffectiveAllocatedMaxSearchStates()
      ) {
        return false
      }
      if (
        !Number.isInteger(approvedBudgetRevisionCandidate) ||
        approvedBudgetRevisionCandidate < 1 ||
        !Number.isInteger(approvedRequestRevisionCandidate) ||
        approvedRequestRevisionCandidate < 1
      ) {
        return false
      }
      if (
        pendingExternalBudgetCommitRevision === approvedBudgetRevisionCandidate &&
        pendingExternalBudgetCommitRequestRevision === approvedRequestRevisionCandidate
      ) {
        return true
      }
      pendingExternalBudgetCommitRevision = approvedBudgetRevisionCandidate
      pendingExternalBudgetCommitRequestRevision = approvedRequestRevisionCandidate
      externalBudgetCommitRequestCount += 1
      await writeJsonAtomic(externalBudgetCommitPath, {
        version: 1,
        requestRevision: approvedRequestRevisionCandidate,
        chunkIndex: workerChunkIndex,
        budgetRevision: approvedBudgetRevisionCandidate,
        allocatedMaxSearchStates: approvedAllocatedCandidate,
        updatedAt: new Date().toISOString(),
      })
      return true
    }
    const waitForExternalBudgetRequestResolution = async ({
      requestRevision,
      previousEffectiveAllocatedMaxSearchStates,
      reason = "allocated_budget_exhausted",
    }) => {
      if (!requestRevision) return null
      const waitStartedAt = Date.now()
      let waitDeadlineAt = waitStartedAt + externalBudgetRequestWaitMs
      let pendingObservedAtMs = null
      let lastPendingUpdatedAtMs = null
      while (Date.now() <= waitDeadlineAt) {
        await maybeRefreshExternalAllocatedSearchBudget({ force: true })
        const currentEffectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
        if (currentEffectiveAllocatedMaxSearchStates > previousEffectiveAllocatedMaxSearchStates) {
          externalBudgetRequestWaitMsTotal += Date.now() - waitStartedAt
          if (pendingObservedAtMs != null) {
            externalBudgetPendingWaitMsTotal += Math.max(0, Date.now() - pendingObservedAtMs)
          }
          externalBudgetLastDecision = "granted"
          return "granted"
        }
        const decisionPayload = await readExternalBudgetDecision({ force: true })
        if (decisionPayload && decisionPayload.requestRevision >= requestRevision) {
          if (decisionPayload.decision === "granted") {
            await noteApprovedExternalBudgetAllowance({
              allocatedCandidate: decisionPayload.allocatedMaxSearchStates,
              budgetRevision: decisionPayload.budgetRevision,
              requestRevision: decisionPayload.requestRevision,
            })
            if (
              isSearchBudgetExhausted() &&
              getApprovedAllocatedMaxSearchStates() > currentEffectiveAllocatedMaxSearchStates
            ) {
              await maybeSubmitExternalBudgetCommitRequest({
                requestRevision: decisionPayload.requestRevision,
              })
            }
            externalBudgetLastDecision = "granted"
          } else if (decisionPayload.decision === "pending") {
            externalBudgetLastDecision = "pending"
            if (pendingObservedAtMs == null) {
              pendingObservedAtMs = Date.now()
              externalBudgetRequestPendingCount += 1
            }
            if (
              Number.isFinite(decisionPayload.updatedAtMs) &&
              decisionPayload.updatedAtMs > 0 &&
              decisionPayload.updatedAtMs !== lastPendingUpdatedAtMs
            ) {
              lastPendingUpdatedAtMs = decisionPayload.updatedAtMs
              waitDeadlineAt = Math.max(
                waitDeadlineAt,
                Number(decisionPayload.updatedAtMs) + externalBudgetRequestWaitMs,
              )
            }
          } else if (decisionPayload.decision === "denied") {
            pendingExternalBudgetRequestRevision = null
            pendingExternalBudgetCommitRevision = null
            pendingExternalBudgetCommitRequestRevision = null
            clearApprovedExternalBudgetAllowance()
            externalBudgetRequestDeniedCount += 1
            externalBudgetRequestWaitMsTotal += Date.now() - waitStartedAt
            if (pendingObservedAtMs != null) {
              externalBudgetPendingWaitMsTotal += Math.max(0, Date.now() - pendingObservedAtMs)
            }
            externalBudgetLastDecision = "denied"
            return "denied"
          }
        }
        if (
          isSearchBudgetExhausted() &&
          getApprovedAllocatedMaxSearchStates() > currentEffectiveAllocatedMaxSearchStates
        ) {
          await maybeSubmitExternalBudgetCommitRequest({ requestRevision })
        }
        await sleep(Math.max(10, Math.min(100, externalBudgetDecisionPollMs)))
      }
      throw new Error(
        [
          "Indexed miner timed out waiting for an external budget request decision.",
          `path=${externalBudgetRequestPath}`,
          `requestRevision=${requestRevision}`,
          `reason=${reason}`,
          `waitMs=${externalBudgetRequestWaitMs}`,
        ].join("\n"),
      )
    }
    const isSearchBudgetExhausted = () => exploredStates >= getEffectiveAllocatedMaxSearchStates()
    const ensureSearchBudgetCapacityOrStop = async ({
      reason = "allocated_budget_exhausted",
    } = {}) => {
      if (!isSearchBudgetExhausted()) return true
      await maybeRefreshExternalAllocatedSearchBudget({ force: true })
      if (!isSearchBudgetExhausted()) return true
      const previousEffectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
      const requestRevision = await maybeSubmitExternalBudgetRequest({ reason, force: true })
      if (requestRevision != null) {
        const resolution = await waitForExternalBudgetRequestResolution({
          requestRevision,
          previousEffectiveAllocatedMaxSearchStates,
          reason,
        })
        if (resolution === "granted") {
          if (!isSearchBudgetExhausted()) return true
        } else if (resolution === "denied") {
          markBudgetStop({ reason: "global_budget_exhausted" })
          return false
        }
      }
      markBudgetStop({ reason })
      return false
    }
    const ensureScopeSearchBudgetCapacityOrStop = ({
      scopeBudgetLimit = null,
      familyId = null,
      scopeBudgetStopTracker = null,
    } = {}) => {
      if (!Number.isFinite(scopeBudgetLimit) || scopeBudgetLimit < 0) return true
      if (exploredStates < scopeBudgetLimit) return true
      if (!scopeBudgetStopTracker || scopeBudgetStopTracker.counted !== true) {
        incrementFamilyCounter(rejectionSummary, "scopeBudgetStopCountByFamily", familyId)
        if (scopeBudgetStopTracker && typeof scopeBudgetStopTracker === "object") {
          scopeBudgetStopTracker.counted = true
        }
      }
      return false
    }
    const consumeSearchStateBudgetOrStop = async ({
      reason = "allocated_budget_exhausted",
      scopeBudgetLimit = null,
      familyId = null,
      scopeBudgetStopTracker = null,
    } = {}) => {
      if (
        !ensureScopeSearchBudgetCapacityOrStop({
          scopeBudgetLimit,
          familyId,
          scopeBudgetStopTracker,
        })
      ) {
        return false
      }
      if (!(await ensureSearchBudgetCapacityOrStop({ reason }))) {
        return false
      }
      exploredStates += 1
      return true
    }
    const writeSearchProgress = async ({ phase = "search", force = false } = {}) => {
      const now = Date.now()
      if (
        force !== true &&
        now - searchLastProgressAt < LIVE_SEARCH_PROGRESS_CHECKPOINT_MS &&
        exploredStates - lastSearchProgressExploredStates < LIVE_SEARCH_PROGRESS_STATE_INTERVAL
      ) {
        return
      }
      searchLastProgressAt = now
      lastSearchProgressExploredStates = exploredStates
      searchProgressRevision += 1
      await maybeRefreshExternalKthHitFloor({ force: true })
      await maybeRefreshExternalAllocatedSearchBudget({ force: true })
      await maybeWriteLivePartialRuleSnapshot({ force: true })
      const searchStateStats = searchStateCache.getStats()
      await updateProgress(
        progressPath,
        buildTimedProgressPayload({
          payload: {
            phase,
            rowsScanned: rowCount,
            rowsTokenized: rowCount,
            tokensIndexed: manifest?.tokenPostingCount ?? 0,
            seedTokensSelected: selectedSeedCount,
            supportCaseIds: rejectionSummary.supportCaseIds ?? [],
            supportCaseCount: rejectionSummary.supportCaseCount ?? 0,
            supportCaseRootSeedCandidateCount:
              rejectionSummary.supportCaseRootSeedCandidateCount ?? 0,
            supportCaseFilteredRootSeedCount:
              rejectionSummary.supportCaseFilteredRootSeedCount ?? 0,
            supportCaseEffectiveRootSeedCount:
              rejectionSummary.supportCaseEffectiveRootSeedCount ?? 0,
            supportCaseCompressionRatio:
              rejectionSummary.supportCaseCompressionRatio ?? null,
            supportCaseCompressionAchieved:
              rejectionSummary.supportCaseCompressionAchieved ?? null,
            supportCaseMatchedRuleCount:
              rejectionSummary.supportCaseMatchedRuleCount ?? 0,
            supportCaseMatchedRuleIds:
              rejectionSummary.supportCaseMatchedRuleIds ?? [],
            subgroupCandidateCount:
              rejectionSummary.subgroupCandidateCount ?? 0,
            subgroupQualifiedCandidateCount:
              rejectionSummary.subgroupQualifiedCandidateCount ?? 0,
            subgroupEffectiveRootSeedCount:
              rejectionSummary.subgroupEffectiveRootSeedCount ?? 0,
            subgroupManifestCandidateCount:
              rejectionSummary.subgroupManifestCandidateCount ?? 0,
            subgroupStableManifestCount:
              rejectionSummary.subgroupStableManifestCount ?? 0,
            subgroupDiverseManifestCount:
              rejectionSummary.subgroupDiverseManifestCount ?? 0,
            subgroupBundleManifestCount:
              rejectionSummary.subgroupBundleManifestCount ?? 0,
            subgroupExactEntryCandidateCount:
              rejectionSummary.subgroupExactEntryCandidateCount ?? 0,
            subgroupExactEntryAcceptedCount:
              rejectionSummary.subgroupExactEntryAcceptedCount ?? 0,
            subgroupExactEntryRejectedCount:
              rejectionSummary.subgroupExactEntryRejectedCount ?? 0,
            subgroupExactEntryRejectReasonCounts:
              rejectionSummary.subgroupExactEntryRejectReasonCounts ?? {},
            subgroupExactEntryRejectReasonByFamily:
              rejectionSummary.subgroupExactEntryRejectReasonByFamily ?? {},
            subgroupExactEntrySeedPreviewByFamily:
              rejectionSummary.subgroupExactEntrySeedPreviewByFamily ?? {},
            exactCompletionManifestCount:
              rejectionSummary.exactCompletionManifestCount ?? 0,
            exactCompletionSolvedCount:
              rejectionSummary.exactCompletionSolvedCount ?? 0,
            exactCompletionUnsatCount:
              rejectionSummary.exactCompletionUnsatCount ?? 0,
            exactCompletionCollectedRuleCount:
              rejectionSummary.exactCompletionCollectedRuleCount ?? 0,
            exactCompletionCollectionRejectCount:
              rejectionSummary.exactCompletionCollectionRejectCount ?? 0,
            exactCompletionUnsatReasonCounts:
              rejectionSummary.exactCompletionUnsatReasonCounts ?? {},
            exactCompletionCandidatePoolSizeByManifest:
              rejectionSummary.exactCompletionCandidatePoolSizeByManifest ?? {},
            exactCompletionNegativeFrontierSizeByManifest:
              rejectionSummary.exactCompletionNegativeFrontierSizeByManifest ?? {},
            exactCompletionUnsatReasonByManifest:
              rejectionSummary.exactCompletionUnsatReasonByManifest ?? {},
            subgroupPrefixPruneCount:
              rejectionSummary.subgroupPrefixPruneCount ?? 0,
            subgroupBreadthFloorPruneCount:
              rejectionSummary.subgroupBreadthFloorPruneCount ?? 0,
            exploredStates,
            rulesCollected: collectedRuleCount,
            seedCacheHitRate: seedPostingCache.getStats().hitRate,
            dictionaryLoadMs,
            boundPruneCount,
            stateDominancePruneCount,
            initialKthHitFloor,
            externalKthHitFloor,
            externalKthHitFloorRevision,
            externalKthHitFloorPollCount,
            externalKthHitFloorAppliedCount,
            externalAllocatedMaxSearchStates,
            externalBudgetRevision,
            externalBudgetPollCount,
            externalBudgetAppliedCount,
            externalBudgetAllowanceAppliedCount,
            externalBudgetAllowanceSeenCount,
            externalBudgetAllowanceConsumedCount,
            externalBudgetRequestCount,
            externalBudgetRequestSatisfiedCount,
            externalBudgetRequestDeniedCount,
            externalBudgetRequestPendingCount,
            externalBudgetRequestWaitMs: externalBudgetRequestWaitMsTotal,
            externalBudgetPendingWaitMs: externalBudgetPendingWaitMsTotal,
            externalBudgetCommitRequestCount,
            externalBudgetCommitRevision,
            externalBudgetLastDecision,
            effectiveKthHitFloor: getCurrentKthHitFloor(),
            effectiveAllocatedMaxSearchStates: getEffectiveAllocatedMaxSearchStates(),
            livePartialRuleRevision,
            livePartialRuleCount,
            livePartialRuleCheckpointCount,
            livePartialRuleWriteMs,
            livePartialLocalKthHitFloor: topKHitTracker.getKthHitFloor(),
            livePartialBootstrapSnapshotCount,
            livePartialBootstrapRuleCount,
            livePartialBootstrapModeActive:
              livePartialBootstrapSnapshotCount > 0 ? 1 : 0,
            configuredMaxSearchStates,
            baseAllocatedMaxSearchStates,
            guardBandAllocatedSearchStates,
            allocatedMaxSearchStates,
            remainingGlobalSearchBudgetAtLaunch,
            budgetStopCount,
            budgetStopExploredStates,
            budgetStopReason,
            kthHitFloor: getCurrentKthHitFloor(),
            childOrderingMs,
            orderingNegativeLoads,
            rowsetModeStats,
            ...buildMemoLookupTelemetry(searchStateStats),
            ...buildLiveExactSearchTelemetry(),
          },
          startedAtMs: miningStartedAt,
          estimatedRows: rowCount,
          estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
          estimatedStates: getEffectiveAllocatedMaxSearchStates(),
        }),
      )
    }

    const materializeChildRowsets = ({
      currentPositiveRowset,
      currentNegativeRowset,
      positivePostingRowset,
      negativePostingRowset,
      preparedNegativeRowset = null,
      nextPositiveCount,
      nextNegativeCount,
      isRoot,
      recordStats = true,
    }) => {
      const materializeStartedAt = Date.now()
      const nextPositiveRowset = isRoot
        ? positivePostingRowset
        : intersectPerfectPrototypeRowsets({
            leftRowset: currentPositiveRowset,
            rightRowset: positivePostingRowset,
            countHint: nextPositiveCount,
            universeSize: rowCount,
            allowDense: true,
            resultOwnership: "borrowed",
          })
      const nextNegativeRowset =
        nextNegativeCount < 1
          ? emptyRowset
          : preparedNegativeRowset
            ? preparedNegativeRowset
          : isRoot
            ? negativePostingRowset
            : intersectPerfectPrototypeRowsets({
                leftRowset: currentNegativeRowset,
                rightRowset: negativePostingRowset,
                countHint: nextNegativeCount,
                universeSize: rowCount,
                allowDense: true,
                resultOwnership: "borrowed",
              })
      if (recordStats) {
        recordPerfectPrototypeRowsetMode(rowsetModeStats, "statePositive", nextPositiveRowset)
        recordPerfectPrototypeRowsetMode(rowsetModeStats, "stateNegative", nextNegativeRowset)
      }
      childRowsetMaterializeMs += Date.now() - materializeStartedAt
      return {
        nextPositiveRowset,
        nextNegativeRowset,
      }
    }

    const maybeCollectRule = async ({
      familyId = null,
      tokens,
      positiveRowset,
      negativeRowset,
      positiveRowIndexes = null,
      positiveHitStats = null,
      generalizedSubgroupManifest = null,
      exactCompletionMetadata = null,
    }) => {
      const negativeCount = getPerfectPrototypeRowsetCount(negativeRowset)
      const resolvedFamilyId =
        String(familyId ?? "").trim() || inferPerfectPrototypeRuleFamilyId({ tokens }) || null
      const familySearchMinHitCount = resolveFamilySpecificSearchMinHitCount({
        cfg,
        familyId: resolvedFamilyId,
      })
      const resolvedPositiveRowIndexes =
        Array.isArray(positiveRowIndexes) || ArrayBuffer.isView(positiveRowIndexes)
          ? positiveRowIndexes
          : materializePerfectPrototypeRowsetValues(positiveRowset)
      const resolvedPositiveHitStats =
        positiveHitStats && typeof positiveHitStats === "object"
          ? positiveHitStats
          : computePositiveHitStats({
              rowIndexes: resolvedPositiveRowIndexes,
              hitCountMode: cfg.hitCountMode,
              hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
            })
      if (resolvedPositiveHitStats.cappedCount < familySearchMinHitCount) {
        rejectionSummary.searchBelowMinHitCount += 1
        incrementFamilyCounter(rejectionSummary, "belowMinHitCountByFamily", resolvedFamilyId)
        recordRejectedRule({
          reason: "SEARCH_BELOW_MIN_HIT_COUNT",
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowset,
        })
        return { canDescendPastZeroNegative: false }
      }
      const negativeRowIndexes =
        negativeCount > 0 ? materializePerfectPrototypeRowsetValues(negativeRowset) : new Uint32Array()
      const rule = await createPerfectPrototypeRuleFromIndexedRowMeta({
        tokens,
        familyId: resolvedFamilyId,
        positiveRowset,
        positiveRowIndexes: resolvedPositiveRowIndexes,
        negativeRowIndexes,
        rowSourceIds: rowMeta.rowSourceIds,
        rowSymbols: rowMeta.rowSymbols,
        rowDateIndexes: rowMeta.rowDateIndexes,
        calendarDateKeys: rowMeta.calendarDateKeys,
        rowFoldKeys,
        familyDistributionPostingCache,
        hitCountMode: cfg.hitCountMode,
        hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        computePositiveHitStats,
      })
      Object.defineProperty(rule, "promotableOrdering", {
        value: promotableSearchOrderingEnabled === true,
        configurable: true,
        enumerable: false,
        writable: true,
      })
      if (generalizedSubgroupManifest && typeof generalizedSubgroupManifest === "object") {
        rule.generalizedSubgroupId = generalizedSubgroupManifest.subgroupId ?? null
        rule.generalizedSubgroupBundleAxes = Array.isArray(
          generalizedSubgroupManifest.bundleAxes,
        )
          ? generalizedSubgroupManifest.bundleAxes.slice()
          : []
        rule.generalizedSubgroupBundleTokens = Array.isArray(
          generalizedSubgroupManifest.bundleTokens,
        )
          ? generalizedSubgroupManifest.bundleTokens.slice()
          : []
        rule.generalizedSubgroupBundleTokenCount = Array.isArray(
          generalizedSubgroupManifest.bundleTokens,
        )
          ? generalizedSubgroupManifest.bundleTokens.length
          : 0
        rule.generalizedSubgroupMatchedDateCount =
          Number(generalizedSubgroupManifest.matchedDateCount ?? 0) || 0
        rule.generalizedSubgroupMatchedMonthCount =
          Number(generalizedSubgroupManifest.matchedMonthCount ?? 0) || 0
        rule.generalizedSubgroupMatchedFoldCount =
          Number(generalizedSubgroupManifest.matchedFoldCount ?? 0) || 0
        rule.generalizedSubgroupCoverageShare =
          Number(generalizedSubgroupManifest.coverageShare ?? 0) || 0
        rule.generalizedSubgroupPrecision =
          Number(generalizedSubgroupManifest.precision ?? 0) || 0
        rule.generalizedSubgroupTpLift =
          Number(generalizedSubgroupManifest.tpLift ?? 0) || 0
        rule.generalizedSubgroupWracc =
          Number(generalizedSubgroupManifest.wracc ?? 0) || 0
        rule.generalizedSubgroupFpPenalty =
          Number(generalizedSubgroupManifest.fpPenalty ?? 0) || 0
        rule.generalizedSubgroupTop1DateHitShare =
          Number(generalizedSubgroupManifest.top1DateHitShare ?? 0) || 0
        rule.generalizedSubgroupSelectionFrequency =
          Number(generalizedSubgroupManifest.selectionFrequency ?? 0) || 0
        rule.generalizedSubgroupFoldPresenceCount =
          Number(generalizedSubgroupManifest.foldPresenceCount ?? 0) || 0
        rule.generalizedSubgroupWindowPresenceCount =
          Number(generalizedSubgroupManifest.windowPresenceCount ?? 0) || 0
      }
      if (exactCompletionMetadata && typeof exactCompletionMetadata === "object") {
        rule.exactCompletionSolved = exactCompletionMetadata.solved === true
        rule.exactCompletionMode =
          String(exactCompletionMetadata.mode ?? "").trim() || null
        rule.exactCompletionAddedTokenCount =
          Number(exactCompletionMetadata.addedTokenCount ?? 0) || 0
        rule.exactCompletionCandidatePoolSize =
          Number(exactCompletionMetadata.candidatePoolSize ?? 0) || 0
        rule.exactCompletionNegativeFrontierSize =
          Number(exactCompletionMetadata.negativeFrontierSize ?? 0) || 0
        rule.exactCompletionSubgroupId =
          String(exactCompletionMetadata.subgroupId ?? "").trim() || null
        rule.exactCoreId =
          String(exactCompletionMetadata.coreId ?? "").trim() || null
        rule.exactCoreRetainedDateCount =
          Number(exactCompletionMetadata.coreRetainedDateCount ?? 0) || 0
        rule.exactCoreRetainedMonthCount =
          Number(exactCompletionMetadata.coreRetainedMonthCount ?? 0) || 0
        rule.exactCoreRetainedFoldCount =
          Number(exactCompletionMetadata.coreRetainedFoldCount ?? 0) || 0
        rule.crossfitWindowCount =
          Number(exactCompletionMetadata.crossfitWindowCount ?? 0) || 0
        rule.crossfitMatchedWindowCount =
          Number(exactCompletionMetadata.crossfitMatchedWindowCount ?? 0) || 0
        rule.crossfitNegativeWindowCount =
          Number(exactCompletionMetadata.crossfitNegativeWindowCount ?? 0) || 0
        rule.crossfitFalsePositiveRowCount =
          Number(exactCompletionMetadata.crossfitFalsePositiveRowCount ?? 0) || 0
        rule.hardNegativeAddedCount =
          Number(exactCompletionMetadata.hardNegativeAddedCount ?? 0) || 0
        rule.hardNegativeRefined =
          exactCompletionMetadata.hardNegativeRefined === true
        rule.postRefineTrainMatchedDateCount =
          Number(exactCompletionMetadata.postRefineTrainMatchedDateCount ?? 0) || 0
        rule.postRefineTrainMatchedMonthCount =
          Number(exactCompletionMetadata.postRefineTrainMatchedMonthCount ?? 0) || 0
        rule.postRefineTrainMatchedFoldCount =
          Number(exactCompletionMetadata.postRefineTrainMatchedFoldCount ?? 0) || 0
        rule.jointFeasibilitySolved =
          exactCompletionMetadata.jointFeasibilitySolved === true
        rule.jointUnsatReason =
          String(exactCompletionMetadata.jointUnsatReason ?? "").trim() || null
        rule.jointHistoricalSupportMatched =
          exactCompletionMetadata.jointHistoricalSupportMatched === true
        rule.jointHistoricalSupportCaseIds = Array.isArray(
          exactCompletionMetadata.jointHistoricalSupportCaseIds,
        )
          ? exactCompletionMetadata.jointHistoricalSupportCaseIds.slice()
          : []
        rule.jointCrossfitRetainedPositiveWindowCount =
          Number(exactCompletionMetadata.jointCrossfitRetainedPositiveWindowCount ?? 0) || 0
        rule.jointCrossfitNegativeWindowCount =
          Number(exactCompletionMetadata.jointCrossfitNegativeWindowCount ?? 0) || 0
        rule.candidateAtomTypeCounts =
          exactCompletionMetadata.candidateAtomTypeCounts &&
          typeof exactCompletionMetadata.candidateAtomTypeCounts === "object"
            ? { ...exactCompletionMetadata.candidateAtomTypeCounts }
            : {}
        rule.supportSignatureAtomCount =
          Number(exactCompletionMetadata.supportSignatureAtomCount ?? 0) || 0
        rule.adaptiveThresholdAtomCount =
          Number(exactCompletionMetadata.adaptiveThresholdAtomCount ?? 0) || 0
        rule.intervalAtomCount =
          Number(exactCompletionMetadata.intervalAtomCount ?? 0) || 0
        rule.macroAtomCount =
          Number(exactCompletionMetadata.macroAtomCount ?? 0) || 0
        rule.supportAnchorAtomCount =
          Number(exactCompletionMetadata.supportAnchorAtomCount ?? 0) || 0
      }
      const familyPurity = evaluatePerfectPrototypeRuleFamilyPurity({
        familyId: rule.familyId,
        tokens: rule.tokens,
        stats: rule,
        midMinShare: cfg.midFamilyMinShare,
        lowMinShare: cfg.lowFamilyMinShare,
      })
      if (!familyPurity.ok) {
        rejectionSummary.familyPurityRejectCount += 1
        rejectionSummary.familyPurityRejectCountByReason[familyPurity.reason] =
          Number(rejectionSummary.familyPurityRejectCountByReason[familyPurity.reason] ?? 0) + 1
        recordRejectedRule({
          reason: familyPurity.reason,
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
        })
        return { canDescendPastZeroNegative: false }
      }
      const exactOnlyCollection = Number(cfg.minTrainPrecision) >= 1
      if (exactOnlyCollection && negativeCount > 0) {
        rejectionSummary.negativeMatchCount += 1
        recordRejectedRule({
          reason: "NEGATIVE_MATCH",
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
        })
        return { canDescendPastZeroNegative: false }
      }
      if (Number(rule.precision ?? 0) < cfg.minTrainPrecision) {
        rejectionSummary.precisionBelowMinTrainPrecisionCount += 1
        recordRejectedRule({
          reason: "TRAIN_PRECISION_BELOW_THRESHOLD",
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
        })
        return { canDescendPastZeroNegative: false }
      }
      const breadthMinimums = resolveFamilySpecificBreadthMinimums({
        cfg,
        familyId: rule.familyId,
      })
      const dateBreadthGuard = evaluatePerfectPrototypeTrainDateBreadthGuards({
        rule,
        minTrainMatchedDates: breadthMinimums.minTrainMatchedDates,
        minTrainMatchedMonths: breadthMinimums.minTrainMatchedMonths,
        minTrainMatchedQuarters: breadthMinimums.minTrainMatchedQuarters,
        minTrainMatchedFolds: breadthMinimums.minTrainMatchedFolds,
        maxTop1DateHitShare: cfg.maxTop1DateHitShare,
        maxTop3DateHitShare: cfg.maxTop3DateHitShare,
        maxTop1FoldHitShare: cfg.maxTop1FoldHitShare,
        maxTop3FoldHitShare: cfg.maxTop3FoldHitShare,
      })
      if (!dateBreadthGuard.ok) {
        recordTrainDateBreadthGuardRejection({
          reason: dateBreadthGuard.reason,
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
        })
        return { canDescendPastZeroNegative: false }
      }
      const exceedsMaxTrainHitCount =
        Number.isInteger(Number(cfg.maxTrainHitCount)) &&
        Number(cfg.maxTrainHitCount) > 0 &&
        Number(rule.trainHitCount) > Number(cfg.maxTrainHitCount)
      if (exceedsMaxTrainHitCount) {
        rejectionSummary.aboveMaxTrainHitCountCount += 1
        recordRejectedRule({
          reason: "TRAIN_HIT_COUNT_ABOVE_MAX",
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
        })
      }
      if (Number(rule.maxGapTradingDays) > cfg.maxGapTradingDays) {
        rejectionSummary.gapViolationCount += 1
        recordRejectedRule({
          reason: "MAX_GAP_VIOLATION",
          tokens,
          positiveRowIndexes: resolvedPositiveRowIndexes,
          negativeRowIndexes,
          maxGapTradingDays: rule.maxGapTradingDays,
        })
        return { canDescendPastZeroNegative: true }
      }
      if (exceedsMaxTrainHitCount) {
        return { canDescendPastZeroNegative: true }
      }
      const matchSignature = buildRuleMatchSignatureHash(rule.matchRowIndexes)
      const bucket = collectedByMatchSignature.get(matchSignature) ?? []
      const existing = bucket.find((entry) =>
        areExactRowIndexArraysEqual(entry?.matchRowIndexes, rule.matchRowIndexes),
      )
      const winner = pickCanonicalPerfectPrototypeSameSignatureWinner(existing ?? null, rule)
      if (!existing) {
        bucket.push(rule)
        collectedByMatchSignature.set(matchSignature, bucket)
        collectedRuleCount += 1
        rejectionSummary.collectedRuleCount = collectedRuleCount
        livePartialRuleDirty = true
        noteFeatureContributionExactRule({
          tokens,
          positiveMass: resolvedPositiveRowIndexes.length,
          positiveRowIndexes: resolvedPositiveRowIndexes,
        })
        if (enableTopKBranchAndBound) {
          topKHitTracker.observeHitCount(rule.trainHitCount)
        }
        return { canDescendPastZeroNegative: false }
      }
      if (winner === rule) {
        const updatedBucket = bucket.map((entry) => (entry === existing ? rule : entry))
        collectedByMatchSignature.set(matchSignature, updatedBucket)
        livePartialRuleDirty = true
        noteFeatureContributionExactRule({
          tokens,
          positiveMass: resolvedPositiveRowIndexes.length,
          positiveRowIndexes: resolvedPositiveRowIndexes,
        })
        return { canDescendPastZeroNegative: false }
      }
      rejectionSummary.dominatedBySmallerRuleCount += 1
      recordRejectedRule({
        reason: "DOMINATED_BY_SMALLER_RULE",
        tokens,
        positiveRowIndexes: resolvedPositiveRowIndexes,
        negativeRowIndexes,
        maxGapTradingDays: rule.maxGapTradingDays,
      })
      return { canDescendPastZeroNegative: false }
    }

    const buildRowProjectedCandidateUniverse = ({
      positiveRowset,
      negativeRowset,
      startAt,
      loopEnd,
      seedIndexes = null,
      currentTokens = null,
      currentPositiveEffectiveCount,
      currentFamilyId = null,
      supportCaseTokenSet = null,
      donorTokenSet = null,
      generalizedSubgroupBundleTokenSet = null,
      generalizedSubgroupBreadthFloor = null,
    }) => {
      if (
        rowProjectedCandidateThreshold < 1 ||
        !rowTokenProjection ||
        !rowProjectedCounts ||
        !rowProjectedTouchedSeedIndexes ||
        (Array.isArray(seedIndexes) && seedIndexes.length > 0)
      ) {
        return null
      }
      const currentPositiveRowIndexes = materializePerfectPrototypeRowsetValues(positiveRowset)
      if (currentPositiveRowIndexes.length > rowProjectedCandidateThreshold) {
        return null
      }
      const buildStartedAt = Date.now()
      rowProjectedActivationCount += 1
      rowProjectedTouchedRowCount += currentPositiveRowIndexes.length
      const currentNegativeCount = getPerfectPrototypeRowsetCount(negativeRowset)
      const {
        rowTokenOffsets,
        rowTokenIds,
        tokenIdToSelectedSeedIndex,
      } = rowTokenProjection
      const projectedPositiveRowIndexesBySeed = new Map()
      let touchedSeedCount = 0
      for (const rawRowIndex of currentPositiveRowIndexes) {
        const rowIndex = Number(rawRowIndex)
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount) {
          throw new Error(
            `Indexed miner row-projected candidate generation encountered invalid row index: ${rawRowIndex}`,
          )
        }
        const tokenStart = Number(rowTokenOffsets[rowIndex] ?? 0)
        const tokenEnd = Number(rowTokenOffsets[rowIndex + 1] ?? tokenStart)
        rowProjectedTokenVisitCount += Math.max(0, tokenEnd - tokenStart)
        let lastSeedIndex = -1
        for (let offset = tokenStart; offset < tokenEnd; offset += 1) {
          const tokenId = Number(rowTokenIds[offset] ?? -1)
          if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= tokenIdToSelectedSeedIndex.length) {
            throw new Error(
              `Indexed miner row-projected candidate generation encountered invalid tokenId: ${tokenId}`,
            )
          }
          const seedIndex = Number(tokenIdToSelectedSeedIndex[tokenId] ?? -1)
          if (!Number.isInteger(seedIndex) || seedIndex < startAt || seedIndex >= loopEnd) {
            lastSeedIndex = -1
            continue
          }
          if (seedIndex === lastSeedIndex) {
            continue
          }
          lastSeedIndex = seedIndex
          if (rowProjectedCounts[seedIndex] === 0) {
            rowProjectedTouchedSeedIndexes[touchedSeedCount] = seedIndex
            touchedSeedCount += 1
            projectedPositiveRowIndexesBySeed.set(seedIndex, [rowIndex])
          } else {
            projectedPositiveRowIndexesBySeed.get(seedIndex)?.push(rowIndex)
          }
          rowProjectedCounts[seedIndex] += 1
        }
      }
      const candidateTokenIndexes = []
      const candidateNextPositiveRawCounts = []
      const candidateNextPositiveEffectiveCounts = []
      const candidateNextPositiveDistinctDateCounts = []
      const candidateNextPositiveDistinctMonthCounts = []
      const candidateNextPositiveDistinctQuarterCounts = []
      const candidateNextPositiveDistinctFoldCounts = []
      const candidateNegativeDropEstimates = []
      const candidatePrecisionUpperBoundEstimates = []
      const candidatePositiveLosses = []
      for (let touchedIndex = 0; touchedIndex < touchedSeedCount; touchedIndex += 1) {
        const seedIndex = rowProjectedTouchedSeedIndexes[touchedIndex]
        const entryToken = seedTokensOrdered[seedIndex]
        const supportCasePrefixExpansion = evaluatePerfectPrototypeSupportCasePrefixExpansion({
          cfg,
          familyId: currentFamilyId,
          tokens: currentTokens,
          candidateToken: entryToken,
          supportCaseTokenSet,
        })
        if (!supportCasePrefixExpansion.ok) {
          rejectionSummary.supportCasePrefixPruneCount =
            Number(rejectionSummary.supportCasePrefixPruneCount ?? 0) + 1
          incrementFamilyCounter(
            rejectionSummary,
            "supportCasePrefixPruneCountByFamily",
            currentFamilyId,
          )
          continue
        }
        const subgroupPrefixExpansion = evaluatePerfectPrototypeGeneralizedSubgroupPrefixExpansion({
          cfg,
          familyId: currentFamilyId,
          tokens: currentTokens,
          candidateToken: entryToken,
          generalizedSubgroupBundleTokenSet,
        })
        if (!subgroupPrefixExpansion.ok) {
          rejectionSummary.subgroupPrefixPruneCount =
            Number(rejectionSummary.subgroupPrefixPruneCount ?? 0) + 1
          incrementFamilyCounter(
            rejectionSummary,
            "subgroupPrefixPruneCountByFamily",
            currentFamilyId,
          )
          continue
        }
        const donorPrefixExpansion = evaluatePerfectPrototypeSupportCaseDonorPrefixExpansion({
          cfg,
          familyId: currentFamilyId,
          tokens: currentTokens,
          candidateToken: entryToken,
          donorTokenSet,
        })
        if (!donorPrefixExpansion.ok) {
          rejectionSummary.supportCaseDonorPrefixPruneCount =
            Number(rejectionSummary.supportCaseDonorPrefixPruneCount ?? 0) + 1
          incrementFamilyCounter(
            rejectionSummary,
            "supportCaseDonorPrefixPruneCountByFamily",
            currentFamilyId,
          )
          continue
        }
        const projectedRowIndexes = projectedPositiveRowIndexesBySeed.get(seedIndex) ?? []
        const nextPositiveCount = rowProjectedCounts[seedIndex]
        rowProjectedCounts[seedIndex] = 0
        projectedPositiveRowIndexesBySeed.delete(seedIndex)
        const projectedHitStats = computePositiveHitStats({
          rowIndexes: projectedRowIndexes,
          hitCountMode: cfg.hitCountMode,
          hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
        })
        const subgroupBreadthFloorCheck = evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
          cfg,
          familyId: currentFamilyId,
          distinctDateCount: projectedHitStats.distinctDateCount,
          matchedMonthCount: projectedHitStats.matchedMonthCount,
          matchedFoldCount: projectedHitStats.matchedFoldCount ?? 0,
          generalizedSubgroupBreadthFloor,
        })
        if (!subgroupBreadthFloorCheck.ok) {
          rejectionSummary.subgroupBreadthFloorPruneCount =
            Number(rejectionSummary.subgroupBreadthFloorPruneCount ?? 0) + 1
          incrementFamilyCounter(
            rejectionSummary,
            "subgroupBreadthFloorPruneCountByFamily",
            currentFamilyId,
          )
          continue
        }
        const familySearchMinHitCount = resolveFamilySpecificSearchMinHitCount({
          cfg,
          familyId: currentFamilyId,
        })
        if (projectedHitStats.cappedCount < familySearchMinHitCount) {
          rejectionSummary.searchBelowMinHitCount += 1
          incrementFamilyCounter(rejectionSummary, "belowMinHitCountByFamily", currentFamilyId)
          continue
        }
        const projectedPromotableUpperBoundGuard = evaluatePromotableUpperBoundGuardFromCounts({
          distinctDateUpperBound: projectedHitStats.distinctDateCount,
          matchedMonthUpperBound: projectedHitStats.matchedMonthCount,
          matchedFoldUpperBound: projectedHitStats.matchedFoldCount ?? 0,
        })
        if (!projectedPromotableUpperBoundGuard.ok) {
          recordPromotableUpperBoundPruneRejection({
            stage: "candidate",
            familyId: currentFamilyId,
            reason: projectedPromotableUpperBoundGuard.reason,
            tokens: appendPerfectPrototypeToken(currentTokens, entryToken),
            positiveMatchCount: projectedHitStats.rawCount ?? nextPositiveCount,
            negativeMatchCount: null,
          })
          continue
        }
        if (yearHitUpperBoundPruneEnabled) {
          const projectedYearHitUpperBoundGuard = evaluatePerfectPrototypeYearHitUpperBoundGuard({
            hitDates: projectedHitStats.hitDates,
            coreYears: cfg.coreYears,
            excludedBoundaryYears: cfg.excludedBoundaryYears,
            minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
          })
          if (!projectedYearHitUpperBoundGuard.ok) {
            recordYearHitUpperBoundPruneRejection({
              stage: "candidate",
              familyId: currentFamilyId,
              tokens: appendPerfectPrototypeToken(currentTokens, entryToken),
              positiveMatchCount: projectedHitStats.rawCount ?? nextPositiveCount,
              negativeMatchCount: null,
              yearGuard: projectedYearHitUpperBoundGuard,
            })
            continue
          }
        }
        const negativeDropEstimate = Math.max(
          0,
          getPerfectPrototypeRowsetCount(negativeRowset) -
            Math.min(getPerfectPrototypeRowsetCount(negativeRowset), Number(seedNegativeCounts[seedIndex] ?? 0)),
        )
        candidateTokenIndexes.push(seedIndex)
        candidateNextPositiveRawCounts.push(nextPositiveCount)
        candidateNextPositiveEffectiveCounts.push(projectedHitStats.cappedCount)
        candidateNextPositiveDistinctDateCounts.push(projectedHitStats.distinctDateCount)
        candidateNextPositiveDistinctMonthCounts.push(projectedHitStats.matchedMonthCount)
        candidateNextPositiveDistinctQuarterCounts.push(projectedHitStats.matchedQuarterCount)
        candidateNextPositiveDistinctFoldCounts.push(projectedHitStats.matchedFoldCount ?? 0)
        candidateNegativeDropEstimates.push(negativeDropEstimate)
        candidatePrecisionUpperBoundEstimates.push(
          safeRate(
            projectedHitStats.cappedCount,
            projectedHitStats.cappedCount + Math.max(0, Number(seedNegativeCounts[seedIndex] ?? 0)),
          ),
        )
        candidatePositiveLosses.push(
          Math.max(0, currentPositiveEffectiveCount - projectedHitStats.cappedCount),
        )
        noteFeatureContributionSelection({
          token: entryToken,
          nextPositiveCount: projectedHitStats.cappedCount,
          negativeDropEstimate,
        })
      }
      rowProjectedCandidateBuildMs += Date.now() - buildStartedAt
      rowProjectedCandidateSeedCount += candidateTokenIndexes.length
      return {
        candidateTokenIndexes,
        candidateNextPositiveRawCounts,
        candidateNextPositiveEffectiveCounts,
        candidateNextPositiveDistinctDateCounts,
        candidateNextPositiveDistinctMonthCounts,
        candidateNextPositiveDistinctQuarterCounts,
        candidateNextPositiveDistinctFoldCounts,
        candidateNegativeDropEstimates,
        candidatePrecisionUpperBoundEstimates,
        candidatePositiveLosses,
      }
    }

    const search = async ({
      startAt,
      endAt = null,
      seedIndexes = null,
      familyId = null,
      constrainedRoot = false,
      supportCaseTokenSet = null,
      donorTokenSet = null,
      generalizedSubgroupId = null,
      generalizedSubgroupManifest = null,
      generalizedSubgroupBundleTokenSet = null,
      generalizedSubgroupBreadthFloor = null,
      tokens,
      positiveRowset,
      negativeRowset,
      positiveHitStats = null,
      collectCurrentState = false,
      scopeBudgetLimit = null,
      scopeBudgetStopTracker = null,
    }) => {
      currentSearchDepth = Math.max(0, tokens.length)
      maxSearchDepth = Math.max(maxSearchDepth, currentSearchDepth)
      await maybeRefreshExternalKthHitFloor()
      await maybeRefreshExternalAllocatedSearchBudget()
      if (
        !ensureScopeSearchBudgetCapacityOrStop({
          scopeBudgetLimit,
          familyId,
          scopeBudgetStopTracker,
        })
      ) {
        return
      }
      if (!(await ensureSearchBudgetCapacityOrStop())) {
        return
      }
      const currentPositiveCount = getPerfectPrototypeRowsetCount(positiveRowset)
      const currentPositiveResolvedHitStats =
        positiveHitStats && typeof positiveHitStats === "object"
          ? positiveHitStats
          : shouldResolveDetailedPositiveHitStats
            ? computePositiveHitStats({
                rowIndexes: materializePerfectPrototypeRowsetValues(positiveRowset),
                hitCountMode: cfg.hitCountMode,
                hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
              })
            : {
                rawCount: currentPositiveCount,
                cappedCount: currentPositiveCount,
                distinctDateCount: 0,
                matchedMonthCount: 0,
                matchedQuarterCount: 0,
                matchedFoldCount: 0,
                maxSymbolsMatchedPerDate: 0,
                top1FoldHitShare: 0,
                top3FoldHitShare: 0,
                hitCountMode: cfg.hitCountMode,
                hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
              }
      const currentPositiveEffectiveCount = Number(
        currentPositiveResolvedHitStats?.cappedCount ?? currentPositiveCount,
      )
      const currentPositiveDistinctDateCount = Math.max(
        0,
        Number(currentPositiveResolvedHitStats?.distinctDateCount ?? 0),
      )
      const currentPositiveDistinctMonthCount = Math.max(
        0,
        Number(currentPositiveResolvedHitStats?.matchedMonthCount ?? 0),
      )
      const currentPositiveDistinctQuarterCount = Math.max(
        0,
        Number(currentPositiveResolvedHitStats?.matchedQuarterCount ?? 0),
      )
      const currentPositiveDistinctFoldCount = Math.max(
        0,
        Number(currentPositiveResolvedHitStats?.matchedFoldCount ?? 0),
      )
      const currentCoreYearHitUpperBounds = yearHitUpperBoundPruneEnabled
        ? buildCoreYearUpperBoundCountsFromHitDates(currentPositiveResolvedHitStats?.hitDates ?? [])
        : null
      const currentFamilyId =
        String(familyId ?? "").trim() ||
        (tokens.length > 0 ? inferPerfectPrototypeRuleFamilyId({ tokens }) : null)
      const subgroupBreadthFloorCheckAtEntry = evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
        cfg,
        familyId: currentFamilyId,
        distinctDateCount: currentPositiveDistinctDateCount,
        matchedMonthCount: currentPositiveDistinctMonthCount,
        matchedFoldCount: currentPositiveDistinctFoldCount,
        generalizedSubgroupBreadthFloor,
      })
      if (tokens.length > 0 && !subgroupBreadthFloorCheckAtEntry.ok) {
        rejectionSummary.subgroupBreadthFloorPruneCount =
          Number(rejectionSummary.subgroupBreadthFloorPruneCount ?? 0) + 1
        incrementFamilyCounter(
          rejectionSummary,
          "subgroupBreadthFloorPruneCountByFamily",
          currentFamilyId,
        )
        return
      }
      const currentNegativeCount = getPerfectPrototypeRowsetCount(negativeRowset)
      const familySearchMinHitCount = resolveFamilySpecificSearchMinHitCount({
        cfg,
        familyId: currentFamilyId,
      })
      if (
        trainMatchedDatePruneEnabled &&
        tokens.length > 0 &&
        !evaluatePositiveHitStatsBreadthGuard(currentPositiveResolvedHitStats, currentFamilyId).ok
      ) {
        const breadthGuard = evaluatePositiveHitStatsBreadthGuard(
          currentPositiveResolvedHitStats,
          currentFamilyId,
        )
        recordStateTrainMatchedDatePruneRejection({
          reason: breadthGuard.reason,
          tokens,
          positiveMatchCount: currentPositiveCount,
          negativeMatchCount: currentNegativeCount,
          positiveRowset,
          negativeRowset,
        })
        return
      }
      if (tokens.length > 0) {
        if (yearHitUpperBoundPruneEnabled) {
          const currentYearHitUpperBoundGuard =
            evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
              coreYearHitCounts: currentCoreYearHitUpperBounds ?? {},
              coreYears: cfg.coreYears,
              minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
            })
          if (!currentYearHitUpperBoundGuard.ok) {
            recordYearHitUpperBoundPruneRejection({
              stage: "state",
              familyId: currentFamilyId,
              tokens,
              positiveMatchCount: currentPositiveCount,
              negativeMatchCount: currentNegativeCount,
              positiveRowset,
              negativeRowset,
              yearGuard: currentYearHitUpperBoundGuard,
            })
            return
          }
        }
        const promotableUpperBoundGuard = evaluatePromotableUpperBoundGuardFromCounts({
          distinctDateUpperBound: currentPositiveDistinctDateCount,
          matchedMonthUpperBound: currentPositiveDistinctMonthCount,
          matchedFoldUpperBound: currentPositiveDistinctFoldCount,
        })
        if (!promotableUpperBoundGuard.ok) {
          recordPromotableUpperBoundPruneRejection({
            stage: "state",
            familyId: currentFamilyId,
            reason: promotableUpperBoundGuard.reason,
            tokens,
            positiveMatchCount: currentPositiveCount,
            negativeMatchCount: currentNegativeCount,
            positiveRowset,
            negativeRowset,
          })
          return
        }
      }
      const kthHitFloorAtEntry = getCurrentKthHitFloor()
      if (
        tokens.length > 0 &&
        shouldPrunePerfectPrototypeStateByTopKBound({
          positiveCount: currentPositiveEffectiveCount,
          kthHitFloor: kthHitFloorAtEntry,
        })
      ) {
        boundPruneCount += 1
        incrementFamilyCounter(rejectionSummary, "boundPruneCountByFamily", currentFamilyId)
        return
      }
      const currentPrecision = safeRate(
        currentPositiveEffectiveCount,
        currentPositiveEffectiveCount + currentNegativeCount,
      )
      let entryCollectionOutcome = null
      if (collectCurrentState === true && tokens.length > 0) {
        if (
          !(await consumeSearchStateBudgetOrStop({
            scopeBudgetLimit,
            familyId: currentFamilyId,
            scopeBudgetStopTracker,
          }))
        ) {
          return
        }
        entryCollectionOutcome = await maybeCollectRule({
          familyId: currentFamilyId,
          tokens,
          positiveRowset,
          negativeRowset,
          positiveRowIndexes: materializePerfectPrototypeRowsetValues(positiveRowset),
          positiveHitStats: currentPositiveResolvedHitStats,
          generalizedSubgroupManifest,
        })
        await maybeWriteLivePartialRuleSnapshot()
        await writeSearchProgress()
        if (tokens.length >= cfg.maxRuleSize) {
          return
        }
        if (currentNegativeCount === 0 && !Boolean(entryCollectionOutcome?.canDescendPastZeroNegative)) {
          return
        }
      }
      const isTokenRoot = tokens.length < 1
      const useScopedRootIntersection = isTokenRoot && constrainedRoot === true
      const useUnscopedRootPosting = isTokenRoot && !useScopedRootIntersection
      const loopEnd =
        isTokenRoot && Number.isInteger(endAt)
          ? Math.min(selectedSeedCount, endAt)
          : selectedSeedCount
      const candidateDescriptorBuildStartedAt = Date.now()
      const projectedCandidateUniverse = buildRowProjectedCandidateUniverse({
        positiveRowset,
        negativeRowset,
        startAt,
        loopEnd,
        seedIndexes,
        currentTokens: tokens,
        currentPositiveEffectiveCount,
        currentFamilyId,
        supportCaseTokenSet,
        donorTokenSet,
        generalizedSubgroupBundleTokenSet,
        generalizedSubgroupBreadthFloor,
      })
      const candidateTokenIndexes = projectedCandidateUniverse?.candidateTokenIndexes ?? []
      const candidateNextPositiveRawCounts =
        projectedCandidateUniverse?.candidateNextPositiveRawCounts ?? []
      const candidateNextPositiveEffectiveCounts =
        projectedCandidateUniverse?.candidateNextPositiveEffectiveCounts ?? []
      const candidateNextPositiveDistinctDateCounts =
        projectedCandidateUniverse?.candidateNextPositiveDistinctDateCounts ?? []
      const candidateNextPositiveDistinctMonthCounts =
        projectedCandidateUniverse?.candidateNextPositiveDistinctMonthCounts ?? []
      const candidateNextPositiveDistinctQuarterCounts =
        projectedCandidateUniverse?.candidateNextPositiveDistinctQuarterCounts ?? []
      const candidateNextPositiveDistinctFoldCounts =
        projectedCandidateUniverse?.candidateNextPositiveDistinctFoldCounts ?? []
      const candidateNegativeDropEstimates =
        projectedCandidateUniverse?.candidateNegativeDropEstimates ?? []
      const candidatePrecisionUpperBoundEstimates =
        projectedCandidateUniverse?.candidatePrecisionUpperBoundEstimates ?? []
      const candidatePositiveLosses =
        projectedCandidateUniverse?.candidatePositiveLosses ?? []
      const candidatePositivePostingRowsets = []
      if (!projectedCandidateUniverse) {
        const candidateTokenIndexesBase =
          isTokenRoot && Array.isArray(seedIndexes) && seedIndexes.length > 0
            ? seedIndexes.slice()
            : Array.from({ length: Math.max(0, loopEnd - startAt) }, (_, offset) => startAt + offset)
        const candidateTokenRangeLength = candidateTokenIndexesBase.length
        const positivePostingRowsetsBatch =
          candidateTokenRangeLength > 0
            ? await Promise.all(
                candidateTokenIndexesBase.map((seedIndex) => seedPostingCache.getSeedPositiveRowset(seedIndex)),
              )
            : []
        const positiveIntersectionCountsBatch =
          useUnscopedRootPosting || positivePostingRowsetsBatch.length < 1
            ? null
            : intersectPerfectPrototypeRowsetsCountBatch({
                leftRowset: positiveRowset,
                rightRowsets: positivePostingRowsetsBatch,
              })
        for (let candidateOffset = 0; candidateOffset < candidateTokenIndexesBase.length; candidateOffset += 1) {
          const tokenIndex = candidateTokenIndexesBase[candidateOffset]
          const entryToken = seedTokensOrdered[tokenIndex]
          if (
            isPerfectPrototypeRecentOnlyContinuationRootStage({
              cfg,
              datasetContract,
              currentFamilyId,
              tokens,
            }) &&
            !isPerfectPrototypeContinuationFamilyRootTokenAllowed({
              familyId: currentFamilyId,
              token: entryToken,
            })
          ) {
            continue
          }
          const supportCasePrefixExpansion = evaluatePerfectPrototypeSupportCasePrefixExpansion({
            cfg,
            familyId: currentFamilyId,
            tokens,
            candidateToken: entryToken,
            supportCaseTokenSet,
          })
          if (!supportCasePrefixExpansion.ok) {
            rejectionSummary.supportCasePrefixPruneCount =
              Number(rejectionSummary.supportCasePrefixPruneCount ?? 0) + 1
            incrementFamilyCounter(
              rejectionSummary,
              "supportCasePrefixPruneCountByFamily",
              currentFamilyId,
            )
            continue
          }
          const subgroupPrefixExpansion = evaluatePerfectPrototypeGeneralizedSubgroupPrefixExpansion({
            cfg,
            familyId: currentFamilyId,
            tokens,
            candidateToken: entryToken,
            generalizedSubgroupBundleTokenSet,
          })
          if (!subgroupPrefixExpansion.ok) {
            rejectionSummary.subgroupPrefixPruneCount =
              Number(rejectionSummary.subgroupPrefixPruneCount ?? 0) + 1
            incrementFamilyCounter(
              rejectionSummary,
              "subgroupPrefixPruneCountByFamily",
              currentFamilyId,
            )
            continue
          }
          const donorPrefixExpansion = evaluatePerfectPrototypeSupportCaseDonorPrefixExpansion({
            cfg,
            familyId: currentFamilyId,
            tokens,
            candidateToken: entryToken,
            donorTokenSet,
          })
          if (!donorPrefixExpansion.ok) {
            rejectionSummary.supportCaseDonorPrefixPruneCount =
              Number(rejectionSummary.supportCaseDonorPrefixPruneCount ?? 0) + 1
            incrementFamilyCounter(
              rejectionSummary,
              "supportCaseDonorPrefixPruneCountByFamily",
              currentFamilyId,
            )
            continue
          }
          const positivePostingRowset = positivePostingRowsetsBatch[candidateOffset]
          const nextPositiveRawCount = useUnscopedRootPosting
            ? getPerfectPrototypeRowsetCount(positivePostingRowset)
            : Number(positiveIntersectionCountsBatch[candidateOffset] ?? 0)
          let nextPositiveEffectiveCount = nextPositiveRawCount
          let nextPositiveDistinctDateCount = 0
          let nextPositiveDistinctMonthCount = 0
          let nextPositiveDistinctQuarterCount = 0
          let nextPositiveDistinctFoldCount = 0
          if (shouldResolveDetailedPositiveHitStats) {
            if (useUnscopedRootPosting) {
              nextPositiveEffectiveCount = Math.max(
                0,
                Number(seedPositiveCappedCounts[tokenIndex] ?? nextPositiveRawCount),
              )
              nextPositiveDistinctDateCount = Math.max(
                0,
                Number(seedPositiveDistinctDateCounts[tokenIndex] ?? 0),
              )
              nextPositiveDistinctMonthCount = Math.max(
                0,
                Number(seedPositiveDistinctMonthCounts[tokenIndex] ?? 0),
              )
              nextPositiveDistinctQuarterCount = Math.max(
                0,
                Number(seedPositiveDistinctQuarterCounts[tokenIndex] ?? 0),
              )
              nextPositiveDistinctFoldCount = Math.max(
                0,
                Number(seedPositiveDistinctFoldCounts[tokenIndex] ?? 0),
              )
            } else {
              const nextPositiveDistinctDateUpperBound = Math.max(
                0,
                Math.min(
                  currentPositiveDistinctDateCount,
                  Number(
                    seedPositiveDistinctDateCounts[tokenIndex] ?? currentPositiveDistinctDateCount,
                  ),
                ),
              )
              nextPositiveDistinctDateCount = nextPositiveDistinctDateUpperBound
              nextPositiveDistinctMonthCount = Math.max(
                0,
                Math.min(
                  currentPositiveDistinctMonthCount,
                  Number(
                    seedPositiveDistinctMonthCounts[tokenIndex] ??
                      currentPositiveDistinctMonthCount,
                  ),
                ),
              )
              nextPositiveDistinctQuarterCount = Math.max(
                0,
                Math.min(
                  currentPositiveDistinctQuarterCount,
                  Number(
                    seedPositiveDistinctQuarterCounts[tokenIndex] ??
                      currentPositiveDistinctQuarterCount,
                  ),
                ),
              )
              nextPositiveDistinctFoldCount = Math.max(
                0,
                Math.min(
                  currentPositiveDistinctFoldCount,
                  Number(
                    seedPositiveDistinctFoldCounts[tokenIndex] ??
                      currentPositiveDistinctFoldCount,
                  ),
                ),
              )
              nextPositiveEffectiveCount = Math.min(
                nextPositiveRawCount,
                cfg.hitCountDaySymbolCap * nextPositiveDistinctDateUpperBound,
              )
            }
          }
          const subgroupBreadthFloorCheck = evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
            cfg,
            familyId: currentFamilyId,
            distinctDateCount: nextPositiveDistinctDateCount,
            matchedMonthCount: nextPositiveDistinctMonthCount,
            matchedFoldCount: nextPositiveDistinctFoldCount,
            generalizedSubgroupBreadthFloor,
          })
          if (!subgroupBreadthFloorCheck.ok) {
            rejectionSummary.subgroupBreadthFloorPruneCount =
              Number(rejectionSummary.subgroupBreadthFloorPruneCount ?? 0) + 1
            incrementFamilyCounter(
              rejectionSummary,
              "subgroupBreadthFloorPruneCountByFamily",
              currentFamilyId,
            )
            continue
          }
          const candidatePromotableUpperBoundGuard = evaluatePromotableUpperBoundGuardFromCounts({
            distinctDateUpperBound: nextPositiveDistinctDateCount,
            matchedMonthUpperBound: nextPositiveDistinctMonthCount,
            matchedFoldUpperBound: nextPositiveDistinctFoldCount,
          })
          if (!candidatePromotableUpperBoundGuard.ok) {
            recordPromotableUpperBoundPruneRejection({
              stage: "candidate",
              familyId: currentFamilyId,
              reason: candidatePromotableUpperBoundGuard.reason,
              tokens: appendPerfectPrototypeToken(tokens, entryToken),
              positiveMatchCount: nextPositiveRawCount,
              negativeMatchCount: null,
            })
            continue
          }
          if (nextPositiveEffectiveCount < familySearchMinHitCount) {
            rejectionSummary.searchBelowMinHitCount += 1
            incrementFamilyCounter(rejectionSummary, "belowMinHitCountByFamily", currentFamilyId)
            if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
              const nextTokens = appendPerfectPrototypeToken(tokens, entryToken)
              const negativePostingRowset =
                currentNegativeCount < 1
                  ? emptyRowset
                  : await seedPostingCache.getSeedNegativeRowset(tokenIndex)
              const nextNegativeCount =
                currentNegativeCount < 1
                  ? 0
                  : useUnscopedRootPosting
                    ? Math.max(0, Number(seedNegativeCounts[tokenIndex] ?? 0))
                    : intersectPerfectPrototypeRowsetsCount(negativeRowset, negativePostingRowset)
              const { nextPositiveRowset, nextNegativeRowset } = materializeChildRowsets({
                currentPositiveRowset: positiveRowset,
                currentNegativeRowset: negativeRowset,
                positivePostingRowset,
                negativePostingRowset,
                nextPositiveCount: nextPositiveRawCount,
                nextNegativeCount,
                isRoot: useUnscopedRootPosting,
                recordStats: false,
              })
              recordRejectedRule({
                reason: "SEARCH_BELOW_MIN_HIT_COUNT",
                tokens: nextTokens,
                positiveRowset: nextPositiveRowset,
                negativeRowset: nextNegativeRowset,
              })
              releaseBorrowedChildRowsets({
                nextPositiveRowset,
                nextNegativeRowset,
              })
            }
            continue
          }
          if (yearHitUpperBoundPruneEnabled) {
            const candidateYearHitUpperBounds = buildCandidateCoreYearUpperBoundCounts({
              parentCoreYearHitCounts: currentCoreYearHitUpperBounds ?? {},
              seedCoreYearHitCounts: seedPositiveCoreYearHitCounts[tokenIndex] ?? {},
            })
            const candidateYearHitUpperBoundGuard =
              evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
                coreYearHitCounts: candidateYearHitUpperBounds,
                coreYears: cfg.coreYears,
                minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
              })
            if (!candidateYearHitUpperBoundGuard.ok) {
              recordYearHitUpperBoundPruneRejection({
                stage: "candidate",
                familyId: currentFamilyId,
                tokens: appendPerfectPrototypeToken(tokens, entryToken),
                positiveMatchCount: nextPositiveRawCount,
                negativeMatchCount: null,
                yearGuard: candidateYearHitUpperBoundGuard,
              })
              continue
            }
          }
          const kthHitFloor = getCurrentKthHitFloor()
          if (
            shouldPrunePerfectPrototypeStateByTopKBound({
              positiveCount: nextPositiveEffectiveCount,
              kthHitFloor,
            })
          ) {
            boundPruneCount += 1
            incrementFamilyCounter(rejectionSummary, "boundPruneCountByFamily", currentFamilyId)
            if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
              const nextTokens = appendPerfectPrototypeToken(tokens, entryToken)
              const negativePostingRowset =
                currentNegativeCount < 1
                  ? emptyRowset
                  : await seedPostingCache.getSeedNegativeRowset(tokenIndex)
              const nextNegativeCount =
                currentNegativeCount < 1
                  ? 0
                  : useUnscopedRootPosting
                    ? Math.max(0, Number(seedNegativeCounts[tokenIndex] ?? 0))
                    : intersectPerfectPrototypeRowsetsCount(negativeRowset, negativePostingRowset)
              const { nextPositiveRowset, nextNegativeRowset } = materializeChildRowsets({
                currentPositiveRowset: positiveRowset,
                currentNegativeRowset: negativeRowset,
                positivePostingRowset,
                negativePostingRowset,
                nextPositiveCount: nextPositiveRawCount,
                nextNegativeCount,
                isRoot: useUnscopedRootPosting,
                recordStats: false,
              })
              recordRejectedRule({
                reason: "TOP_K_HIT_BOUND",
                tokens: nextTokens,
                positiveRowset: nextPositiveRowset,
                negativeRowset: nextNegativeRowset,
              })
              releaseBorrowedChildRowsets({
                nextPositiveRowset,
                nextNegativeRowset,
              })
            }
            continue
          }
          const negativeDropEstimate = Math.max(
            0,
            currentNegativeCount -
              Math.min(currentNegativeCount, Number(seedNegativeCounts[tokenIndex] ?? 0)),
          )
          candidateTokenIndexes.push(tokenIndex)
          candidateNextPositiveRawCounts.push(nextPositiveRawCount)
          candidateNextPositiveEffectiveCounts.push(nextPositiveEffectiveCount)
          candidateNextPositiveDistinctDateCounts.push(nextPositiveDistinctDateCount)
          candidateNextPositiveDistinctMonthCounts.push(nextPositiveDistinctMonthCount)
          candidateNextPositiveDistinctQuarterCounts.push(nextPositiveDistinctQuarterCount)
          candidateNextPositiveDistinctFoldCounts.push(nextPositiveDistinctFoldCount)
          candidateNegativeDropEstimates.push(negativeDropEstimate)
          candidatePrecisionUpperBoundEstimates.push(
            safeRate(
              nextPositiveEffectiveCount,
              nextPositiveEffectiveCount + Math.max(0, Number(seedNegativeCounts[tokenIndex] ?? 0)),
            ),
          )
          candidatePositiveLosses.push(
            Math.max(0, currentPositiveEffectiveCount - nextPositiveEffectiveCount),
          )
          candidatePositivePostingRowsets.push(positivePostingRowset)
          noteFeatureContributionSelection({
            token: entryToken,
            nextPositiveCount: nextPositiveEffectiveCount,
            negativeDropEstimate,
          })
        }
      }
      if (
        isPerfectPrototypeRecentOnlyContinuationRootStage({
          cfg,
          datasetContract,
          currentFamilyId,
          tokens,
        }) &&
        candidateTokenIndexes.length > 0
      ) {
        const filteredCandidateTokenIndexes = []
        const filteredCandidateNextPositiveRawCounts = []
        const filteredCandidateNextPositiveEffectiveCounts = []
        const filteredCandidateNextPositiveDistinctDateCounts = []
        const filteredCandidateNextPositiveDistinctMonthCounts = []
        const filteredCandidateNextPositiveDistinctQuarterCounts = []
        const filteredCandidateNextPositiveDistinctFoldCounts = []
        const filteredCandidateNegativeDropEstimates = []
        const filteredCandidatePrecisionUpperBoundEstimates = []
        const filteredCandidatePositiveLosses = []
        const filteredCandidatePositivePostingRowsets = []
        for (let candidateIndex = 0; candidateIndex < candidateTokenIndexes.length; candidateIndex += 1) {
          const tokenIndex = candidateTokenIndexes[candidateIndex]
          const candidateToken = seedTokensOrdered[tokenIndex]
          if (
            !isPerfectPrototypeContinuationFamilyRootTokenAllowed({
              familyId: currentFamilyId,
              token: candidateToken,
            })
          ) {
            continue
          }
          filteredCandidateTokenIndexes.push(tokenIndex)
          filteredCandidateNextPositiveRawCounts.push(candidateNextPositiveRawCounts[candidateIndex])
          filteredCandidateNextPositiveEffectiveCounts.push(candidateNextPositiveEffectiveCounts[candidateIndex])
          filteredCandidateNextPositiveDistinctDateCounts.push(candidateNextPositiveDistinctDateCounts[candidateIndex])
          filteredCandidateNextPositiveDistinctMonthCounts.push(candidateNextPositiveDistinctMonthCounts[candidateIndex])
          filteredCandidateNextPositiveDistinctQuarterCounts.push(candidateNextPositiveDistinctQuarterCounts[candidateIndex])
          filteredCandidateNextPositiveDistinctFoldCounts.push(candidateNextPositiveDistinctFoldCounts[candidateIndex])
          filteredCandidateNegativeDropEstimates.push(candidateNegativeDropEstimates[candidateIndex])
          filteredCandidatePrecisionUpperBoundEstimates.push(
            candidatePrecisionUpperBoundEstimates[candidateIndex],
          )
          filteredCandidatePositiveLosses.push(candidatePositiveLosses[candidateIndex])
          filteredCandidatePositivePostingRowsets.push(candidatePositivePostingRowsets[candidateIndex])
        }
        candidateTokenIndexes.length = 0
        candidateNextPositiveRawCounts.length = 0
        candidateNextPositiveEffectiveCounts.length = 0
        candidateNextPositiveDistinctDateCounts.length = 0
        candidateNextPositiveDistinctMonthCounts.length = 0
        candidateNextPositiveDistinctQuarterCounts.length = 0
        candidateNextPositiveDistinctFoldCounts.length = 0
        candidateNegativeDropEstimates.length = 0
        candidatePrecisionUpperBoundEstimates.length = 0
        candidatePositiveLosses.length = 0
        candidatePositivePostingRowsets.length = 0
        candidateTokenIndexes.push(...filteredCandidateTokenIndexes)
        candidateNextPositiveRawCounts.push(...filteredCandidateNextPositiveRawCounts)
        candidateNextPositiveEffectiveCounts.push(...filteredCandidateNextPositiveEffectiveCounts)
        candidateNextPositiveDistinctDateCounts.push(...filteredCandidateNextPositiveDistinctDateCounts)
        candidateNextPositiveDistinctMonthCounts.push(...filteredCandidateNextPositiveDistinctMonthCounts)
        candidateNextPositiveDistinctQuarterCounts.push(...filteredCandidateNextPositiveDistinctQuarterCounts)
        candidateNextPositiveDistinctFoldCounts.push(...filteredCandidateNextPositiveDistinctFoldCounts)
        candidateNegativeDropEstimates.push(...filteredCandidateNegativeDropEstimates)
        candidatePrecisionUpperBoundEstimates.push(...filteredCandidatePrecisionUpperBoundEstimates)
        candidatePositiveLosses.push(...filteredCandidatePositiveLosses)
        candidatePositivePostingRowsets.push(...filteredCandidatePositivePostingRowsets)
      }
      candidateDescriptorBuildMs += Date.now() - candidateDescriptorBuildStartedAt
      candidateDescriptorCount += candidateTokenIndexes.length
      const childOrderingStartedAt = Date.now()
      let orderedCandidateIndexes = Array.from(
        { length: candidateTokenIndexes.length },
        (_, index) => index,
      ).sort((leftIndex, rightIndex) =>
        compareIndexedCandidateEstimate({
          hitCountMode: cfg.hitCountMode,
          preferPromotableBreadth: promotableSearchOrderingEnabled,
          candidateTokenIndexes,
          candidateNextPositiveRawCounts,
          candidateNextPositiveEffectiveCounts,
          candidateNextPositiveDistinctDateCounts,
          candidateNextPositiveDistinctMonthCounts,
          candidateNextPositiveDistinctQuarterCounts,
          candidateNextPositiveDistinctFoldCounts,
          candidateNegativeDropEstimates,
          candidatePrecisionUpperBoundEstimates,
          candidatePositiveLosses,
          leftIndex,
          rightIndex,
        }),
      )
      childOrderingMs += Date.now() - childOrderingStartedAt
      const candidateNegativePostingRowsets =
        currentNegativeCount > 0 &&
        (tokens.length > 0 || useScopedRootIntersection) &&
        candidateTokenIndexes.length > 0
          ? await Promise.all(
              candidateTokenIndexes.map((candidateTokenIndex) =>
                seedPostingCache.getSeedNegativeRowset(candidateTokenIndex),
              ),
            )
          : null
      const candidateExactNegativeCounts =
        Array.isArray(candidateNegativePostingRowsets) &&
        candidateNegativePostingRowsets.length === candidateTokenIndexes.length
          ? intersectPerfectPrototypeRowsetsCountBatch({
              leftRowset: negativeRowset,
              rightRowsets: candidateNegativePostingRowsets,
            })
          : null
      if (Array.isArray(candidateNegativePostingRowsets)) {
        orderingNegativeLoads += candidateNegativePostingRowsets.length
      }
      if (orderingHeadWindow > 1 && orderedCandidateIndexes.length > 1) {
        const rerankStartedAt = Date.now()
        const headCount = Math.min(orderingHeadWindow, orderedCandidateIndexes.length)
        const exactHeadNegativeCounts = new Array(candidateTokenIndexes.length)
        const exactHeadNegativeDrops = new Array(candidateTokenIndexes.length)
        const exactHeadPrecisionUpperBounds = new Array(candidateTokenIndexes.length)
        for (const candidateIndex of orderedCandidateIndexes.slice(0, headCount)) {
          const candidateTokenIndex = candidateTokenIndexes[candidateIndex]
          const candidateToken = seedTokensOrdered[candidateTokenIndex]
          let exactNextNegativeCount = 0
          if (currentNegativeCount < 1) {
            exactNextNegativeCount = 0
          } else if (useUnscopedRootPosting) {
            exactNextNegativeCount = Math.max(0, Number(seedNegativeCounts[candidateTokenIndex] ?? 0))
          } else {
            exactNextNegativeCount = Number(candidateExactNegativeCounts?.[candidateIndex] ?? 0)
            orderingHeadExactLoads += 1
            noteFeatureContributionHeadExactRerankLoad({
              token: candidateToken,
            })
          }
          exactHeadNegativeCounts[candidateIndex] = exactNextNegativeCount
          exactHeadNegativeDrops[candidateIndex] = Math.max(0, currentNegativeCount - exactNextNegativeCount)
          exactHeadPrecisionUpperBounds[candidateIndex] = safeRate(
            candidateNextPositiveEffectiveCounts[candidateIndex],
            candidateNextPositiveEffectiveCounts[candidateIndex] + exactNextNegativeCount,
          )
        }
        const rerankedHeadCandidateIndexes = orderedCandidateIndexes
          .slice(0, headCount)
          .sort((leftIndex, rightIndex) =>
            compareIndexedCandidateExactHead({
              hitCountMode: cfg.hitCountMode,
              preferPromotableBreadth: promotableSearchOrderingEnabled,
              candidateTokenIndexes,
              candidateNextPositiveRawCounts,
              candidateNextPositiveEffectiveCounts,
              candidateNextPositiveDistinctDateCounts,
              candidateNextPositiveDistinctMonthCounts,
              candidateNextPositiveDistinctQuarterCounts,
              candidateNextPositiveDistinctFoldCounts,
              candidateNegativeDropEstimates,
              candidatePrecisionUpperBoundEstimates,
              candidatePositiveLosses,
              exactHeadNegativeDrops,
              exactHeadPrecisionUpperBounds,
              leftIndex,
              rightIndex,
            }),
          )
        orderedCandidateIndexes = rerankedHeadCandidateIndexes.concat(
          orderedCandidateIndexes.slice(headCount),
        )
        for (const candidateIndex of rerankedHeadCandidateIndexes) {
          candidateNegativeDropEstimates[candidateIndex] =
            exactHeadNegativeDrops[candidateIndex] ?? candidateNegativeDropEstimates[candidateIndex]
          candidatePrecisionUpperBoundEstimates[candidateIndex] =
            exactHeadPrecisionUpperBounds[candidateIndex] ??
            candidatePrecisionUpperBoundEstimates[candidateIndex]
          candidatePositiveLosses[candidateIndex] = Math.max(
            0,
            currentPositiveEffectiveCount - candidateNextPositiveEffectiveCounts[candidateIndex],
          )
          exactHeadNegativeCounts[candidateIndex] =
            exactHeadNegativeCounts[candidateIndex] ?? null
        }
        orderedCandidateIndexes.exactHeadNegativeCounts = exactHeadNegativeCounts
        orderingHeadRerankMs += Date.now() - rerankStartedAt
      }
      if (cfg.enableDiverseSearchOrdering === true && orderedCandidateIndexes.length > 1) {
        const diversifiedOrdering = applyIndexedDiverseCandidateOrdering({
          orderedCandidateIndexes,
          candidateTokenIndexes,
          seedTokensOrdered,
          seedPositiveMonthSignatureHashes,
          seedPositiveQuarterSignatureHashes,
          diverseBeamMaxPerMonthSignature: cfg.diverseBeamMaxPerMonthSignature,
          diverseBeamMaxPerQuarterSignature: cfg.diverseBeamMaxPerQuarterSignature,
          diverseBeamMaxPerAnchorFamily: cfg.diverseBeamMaxPerAnchorFamily,
        })
        orderedCandidateIndexes = diversifiedOrdering.orderedCandidateIndexes
        diverseBeamDeferredCandidateCount += diversifiedOrdering.deferredCandidateCount
      }
      const exactHeadNegativeCounts = orderedCandidateIndexes.exactHeadNegativeCounts ?? null
      for (const candidateIndex of orderedCandidateIndexes) {
        if (
          !ensureScopeSearchBudgetCapacityOrStop({
            scopeBudgetLimit,
            familyId: currentFamilyId,
            scopeBudgetStopTracker,
          })
        ) {
          return
        }
        if (!(await ensureSearchBudgetCapacityOrStop())) {
          return
        }
        const candidateTokenIndex = candidateTokenIndexes[candidateIndex]
        const candidateToken = seedTokensOrdered[candidateTokenIndex]
        const candidateNextPositiveRawCount = candidateNextPositiveRawCounts[candidateIndex]
        const candidateNextPositiveEffectiveCount =
          candidateNextPositiveEffectiveCounts[candidateIndex]
        const candidateNextPositiveDistinctDateCount = Math.max(
          0,
          Number(candidateNextPositiveDistinctDateCounts[candidateIndex] ?? 0),
        )
        const candidateNextPositiveDistinctMonthCount = Math.max(
          0,
          Number(candidateNextPositiveDistinctMonthCounts[candidateIndex] ?? 0),
        )
        const candidateNextPositiveDistinctQuarterCount = Math.max(
          0,
          Number(candidateNextPositiveDistinctQuarterCounts[candidateIndex] ?? 0),
        )
        const candidateNextPositiveDistinctFoldCount = Math.max(
          0,
          Number(candidateNextPositiveDistinctFoldCounts[candidateIndex] ?? 0),
        )
        const kthHitFloor = getCurrentKthHitFloor()
        if (
          shouldPrunePerfectPrototypeStateByTopKBound({
            positiveCount: candidateNextPositiveEffectiveCount,
            kthHitFloor,
          })
        ) {
          boundPruneCount += 1
          incrementFamilyCounter(rejectionSummary, "boundPruneCountByFamily", currentFamilyId)
          continue
        }
        if (
          trainMatchedDatePruneEnabled &&
          !evaluatePositiveHitStatsBreadthGuard({
            distinctDateCount: candidateNextPositiveDistinctDateCount,
            matchedMonthCount: candidateNextPositiveDistinctMonthCount,
            matchedQuarterCount: candidateNextPositiveDistinctQuarterCount,
            matchedFoldCount: candidateNextPositiveDistinctFoldCount,
          }).ok
        ) {
          const breadthGuard = evaluatePositiveHitStatsBreadthGuard({
            distinctDateCount: candidateNextPositiveDistinctDateCount,
            matchedMonthCount: candidateNextPositiveDistinctMonthCount,
            matchedQuarterCount: candidateNextPositiveDistinctQuarterCount,
            matchedFoldCount: candidateNextPositiveDistinctFoldCount,
          })
          recordStateTrainMatchedDatePruneRejection({
            reason: breadthGuard.reason,
            tokens: appendPerfectPrototypeToken(tokens, candidateToken),
            positiveMatchCount: candidateNextPositiveRawCount,
            negativeMatchCount: null,
          })
          continue
        }
        const candidatePromotableUpperBoundGuard = evaluatePromotableUpperBoundGuardFromCounts({
          distinctDateUpperBound: candidateNextPositiveDistinctDateCount,
          matchedMonthUpperBound: candidateNextPositiveDistinctMonthCount,
          matchedFoldUpperBound: candidateNextPositiveDistinctFoldCount,
        })
        if (!candidatePromotableUpperBoundGuard.ok) {
          recordPromotableUpperBoundPruneRejection({
            stage: "candidate",
            familyId: currentFamilyId,
            reason: candidatePromotableUpperBoundGuard.reason,
            tokens: appendPerfectPrototypeToken(tokens, candidateToken),
            positiveMatchCount: candidateNextPositiveRawCount,
            negativeMatchCount: null,
          })
          continue
        }
        const subgroupBreadthFloorCheck = evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
          cfg,
          familyId: currentFamilyId,
          distinctDateCount: candidateNextPositiveDistinctDateCount,
          matchedMonthCount: candidateNextPositiveDistinctMonthCount,
          matchedFoldCount: candidateNextPositiveDistinctFoldCount,
          generalizedSubgroupBreadthFloor,
        })
        if (!subgroupBreadthFloorCheck.ok) {
          rejectionSummary.subgroupBreadthFloorPruneCount =
            Number(rejectionSummary.subgroupBreadthFloorPruneCount ?? 0) + 1
          incrementFamilyCounter(
            rejectionSummary,
            "subgroupBreadthFloorPruneCountByFamily",
            currentFamilyId,
          )
          continue
        }
        let nextTokens = null
        const materializeNextTokens = () => {
          if (!nextTokens) {
            nextTokens = appendPerfectPrototypeToken(tokens, candidateToken)
          }
          return nextTokens
        }
        const positivePostingRowset =
          candidatePositivePostingRowsets[candidateIndex] ??
          (await seedPostingCache.getSeedPositiveRowset(candidateTokenIndex))
        let negativePostingRowset =
          candidateNegativePostingRowsets?.[candidateIndex] ?? null
        let nextNegativePreparedRowset = null
        let nextNegativeCount =
          candidateExactNegativeCounts && Number.isInteger(candidateExactNegativeCounts[candidateIndex])
            ? Number(candidateExactNegativeCounts[candidateIndex])
            : Array.isArray(exactHeadNegativeCounts) &&
                Number.isInteger(exactHeadNegativeCounts[candidateIndex])
              ? exactHeadNegativeCounts[candidateIndex]
              : null
        const releasePreparedNegativeRowsetIfUnused = () => {
          if (!nextNegativePreparedRowset || nextNegativePreparedRowset === emptyRowset) return
          releaseBorrowedChildRowsets({
            nextNegativeRowset: nextNegativePreparedRowset,
          })
          nextNegativePreparedRowset = null
        }
        const resolveNextNegativeCount = async ({ prepareRowset = false } = {}) => {
          if (Number.isInteger(nextNegativeCount) && (prepareRowset !== true || nextNegativePreparedRowset)) {
            return nextNegativeCount
          }
          const negativeCountResolutionStartedAt = Date.now()
          try {
            if (currentNegativeCount < 1) {
              nextNegativeCount = 0
              nextNegativePreparedRowset = emptyRowset
              return nextNegativeCount
            }
            if (useUnscopedRootPosting) {
              nextNegativeCount = Math.max(0, Number(seedNegativeCounts[candidateTokenIndex] ?? 0))
              if (prepareRowset === true && nextNegativeCount > 0) {
                if (!negativePostingRowset) {
                  negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(candidateTokenIndex)
                  orderingNegativeLoads += 1
                }
                nextNegativePreparedRowset = negativePostingRowset
              }
              return nextNegativeCount
            }
            if (!negativePostingRowset) {
              negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(candidateTokenIndex)
              orderingNegativeLoads += 1
            }
            if (prepareRowset === true) {
              const prepared = intersectPerfectPrototypeRowsetsPrepared({
                leftRowset: negativeRowset,
                rightRowset: negativePostingRowset,
                universeSize: rowCount,
                allowDense: true,
                resultOwnership: "borrowed",
              })
              nextNegativeCount = prepared.count
              nextNegativePreparedRowset = prepared.rowset
              return nextNegativeCount
            }
            if (Number.isInteger(nextNegativeCount)) {
              return nextNegativeCount
            }
            nextNegativeCount = intersectPerfectPrototypeRowsetsCount(
              negativeRowset,
              negativePostingRowset,
            )
            return nextNegativeCount
          } finally {
            negativeCountResolutionMs += Date.now() - negativeCountResolutionStartedAt
          }
        }
        const resolveNegativePostingRowset = async () => {
          const resolvedNextNegativeCount = await resolveNextNegativeCount()
          if (resolvedNextNegativeCount < 1) return emptyRowset
          if (negativePostingRowset) return negativePostingRowset
          negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(candidateTokenIndex)
          orderingNegativeLoads += 1
          return negativePostingRowset
        }
        const materializeCandidateRowsets = async ({ recordStats = false } = {}) => {
          const resolvedNextNegativeCount = await resolveNextNegativeCount({
            prepareRowset: true,
          })
          const resolvedNegativePostingRowset =
            nextNegativePreparedRowset || resolvedNextNegativeCount < 1
              ? emptyRowset
              : await resolveNegativePostingRowset()
          const preparedNegativeRowset = nextNegativePreparedRowset
          nextNegativePreparedRowset = null
          try {
            return materializeChildRowsets({
              currentPositiveRowset: positiveRowset,
              currentNegativeRowset: negativeRowset,
              positivePostingRowset,
              negativePostingRowset: resolvedNegativePostingRowset,
              preparedNegativeRowset,
              nextPositiveCount: candidateNextPositiveRawCount,
              nextNegativeCount: resolvedNextNegativeCount,
              isRoot: useUnscopedRootPosting,
              recordStats,
            })
          } catch (error) {
            const currentPositiveMaterializedCount = materializePerfectPrototypeRowsetValues(
              positiveRowset,
            ).length
            const currentNegativeMaterializedCount = materializePerfectPrototypeRowsetValues(
              negativeRowset,
            ).length
            const nextPositiveExactCount = intersectPerfectPrototypeRowsetsCount(
              positiveRowset,
              positivePostingRowset,
            )
            const nextNegativeExactCount =
              resolvedNextNegativeCount > 0 && resolvedNegativePostingRowset !== emptyRowset
                ? intersectPerfectPrototypeRowsetsCount(
                    negativeRowset,
                    resolvedNegativePostingRowset,
                  )
                : 0
            const diagnostics = [
              `candidateToken=${candidateToken}`,
              `candidateTokenIndex=${candidateTokenIndex}`,
              `tokenDepth=${tokens.length}`,
              `projectedCandidateUniverseActive=${projectedCandidateUniverse ? "true" : "false"}`,
              `currentPositiveCount=${currentPositiveCount}`,
              `currentPositiveMaterializedCount=${currentPositiveMaterializedCount}`,
              `currentNegativeCount=${currentNegativeCount}`,
              `currentNegativeMaterializedCount=${currentNegativeMaterializedCount}`,
              `candidateNextPositiveHint=${candidateNextPositiveRawCount}`,
              `candidateNextPositiveExactCount=${nextPositiveExactCount}`,
              `candidatePositivePostingCount=${getPerfectPrototypeRowsetCount(positivePostingRowset)}`,
              `candidateNextNegativeHint=${resolvedNextNegativeCount}`,
              `candidateNextNegativeExactCount=${nextNegativeExactCount}`,
            ].join(" ")
            throw new Error(`${error.message} ${diagnostics}`)
          }
        }
        const negativeCostBefore = buildFeatureContributionCostSnapshot()
        const resolvedNextNegativeCount = await resolveNextNegativeCount({
          prepareRowset: false,
        })
        noteFeatureContributionCostDelta({
          token: candidateToken,
          before: negativeCostBefore,
        })
        if (
          candidateNextPositiveRawCount === currentPositiveCount &&
          resolvedNextNegativeCount === currentNegativeCount
        ) {
          rejectionSummary.noMatchChangeCount += 1
          if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
            const { nextPositiveRowset, nextNegativeRowset } = await materializeCandidateRowsets({
              recordStats: false,
            })
            recordRejectedRule({
              reason: "NO_MATCH_CHANGE",
              tokens: materializeNextTokens(),
              positiveRowset: nextPositiveRowset,
              negativeRowset: nextNegativeRowset,
            })
            releaseBorrowedChildRowsets({
              nextPositiveRowset,
              nextNegativeRowset,
            })
          }
          releasePreparedNegativeRowsetIfUnused()
          continue
        }
        // Exact conjunctive search can safely prune here only when the candidate
        // preserves the entire current negative set. Future conjunctions cannot
        // recover any additional negative separation from such a token.
        if (
          tokens.length > 0 &&
          currentNegativeCount > 0 &&
          resolvedNextNegativeCount >= currentNegativeCount
        ) {
          rejectionSummary.noNegativeSeparationProgressCount += 1
          incrementFamilyCounter(
            rejectionSummary,
            "noNegativeSeparationProgressCountByFamily",
            currentFamilyId,
          )
          if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
            const { nextPositiveRowset, nextNegativeRowset } = await materializeCandidateRowsets({
              recordStats: false,
            })
            recordRejectedRule({
              reason: "NO_NEGATIVE_SEPARATION_PROGRESS",
              tokens: materializeNextTokens(),
              positiveRowset: nextPositiveRowset,
              negativeRowset: nextNegativeRowset,
            })
            releaseBorrowedChildRowsets({
              nextPositiveRowset,
              nextNegativeRowset,
            })
          }
          releasePreparedNegativeRowsetIfUnused()
          continue
        }
        // Do not prune on intermediate precision regressions. A token may still be
        // required for a later exact conjunction even when its local precision drops.
        acceptedCandidateCount += 1
        noteFeatureContributionAccepted({
          token: candidateToken,
          nextPositiveCount: candidateNextPositiveEffectiveCount,
          resolvedNextNegativeCount,
        })
        const nextRuleSize = tokens.length + 1
        currentSearchDepth = nextRuleSize
        maxSearchDepth = Math.max(maxSearchDepth, currentSearchDepth)
        const materializeCostBefore = buildFeatureContributionCostSnapshot()
        const { nextPositiveRowset, nextNegativeRowset } = await materializeCandidateRowsets({
          recordStats: true,
        })
        noteFeatureContributionCostDelta({
          token: candidateToken,
          before: materializeCostBefore,
        })
        try {
          const nextStartAt = candidateTokenIndex + 1
          if (
            searchStateCache.isDominated({
              positiveRowset: nextPositiveRowset,
              negativeRowset: nextNegativeRowset,
              startAt: nextStartAt,
              ruleSize: nextRuleSize,
            })
          ) {
            stateDominancePruneCount += 1
            if (rejectedRules.length < cfg.maxRejectedRuleSamples) {
              recordRejectedRule({
                reason: "STATE_DOMINATED",
                tokens: materializeNextTokens(),
                positiveRowset: nextPositiveRowset,
                negativeRowset: nextNegativeRowset,
              })
            }
            continue
          }
          if (
            !(await consumeSearchStateBudgetOrStop({
              scopeBudgetLimit,
              familyId: currentFamilyId,
              scopeBudgetStopTracker,
            }))
          ) {
            return
          }
          const resolvedNextTokens = materializeNextTokens()
          let nextPositiveRowIndexes = null
          let nextPositiveResolvedHitStats = null
          if (shouldResolveDetailedPositiveHitStats) {
            nextPositiveRowIndexes = materializePerfectPrototypeRowsetValues(nextPositiveRowset)
            nextPositiveResolvedHitStats = computePositiveHitStats({
              rowIndexes: nextPositiveRowIndexes,
              hitCountMode: cfg.hitCountMode,
              hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
            })
          }
          const collectionOutcome = await maybeCollectRule({
            familyId: currentFamilyId,
            tokens: resolvedNextTokens,
            positiveRowset: nextPositiveRowset,
            negativeRowset: nextNegativeRowset,
            positiveRowIndexes: nextPositiveRowIndexes,
            positiveHitStats: nextPositiveResolvedHitStats,
            generalizedSubgroupManifest,
          })
          await maybeWriteLivePartialRuleSnapshot()
          await writeSearchProgress()
          if (nextRuleSize >= cfg.maxRuleSize) continue
          if (
            resolvedNextNegativeCount === 0 &&
            !Boolean(collectionOutcome?.canDescendPastZeroNegative)
          ) {
            continue
          }
          await search({
            startAt: nextStartAt,
            endAt: null,
            familyId: currentFamilyId,
            supportCaseTokenSet,
            donorTokenSet,
            generalizedSubgroupId,
            generalizedSubgroupManifest,
            generalizedSubgroupBundleTokenSet,
            generalizedSubgroupBreadthFloor,
            tokens: resolvedNextTokens,
            positiveRowset: nextPositiveRowset,
            negativeRowset: nextNegativeRowset,
            positiveHitStats: nextPositiveResolvedHitStats,
            scopeBudgetLimit,
            scopeBudgetStopTracker,
          })
          if (
            !ensureScopeSearchBudgetCapacityOrStop({
              scopeBudgetLimit,
              familyId: currentFamilyId,
              scopeBudgetStopTracker,
            })
          ) {
            return
          }
          if (!(await ensureSearchBudgetCapacityOrStop())) {
            return
          }
        } finally {
          currentSearchDepth = Math.max(0, tokens.length)
          releaseBorrowedChildRowsets({
            nextPositiveRowset,
            nextNegativeRowset,
          })
          releasePreparedNegativeRowsetIfUnused()
        }
      }
    }

    await writeSearchProgress({
      phase: "search",
      force: true,
    })
    const buildRootSearchScopes = async () => {
        const defaultScope = {
        startAt: Math.min(rootSeedStartIndex, selectedSeedCount),
        endAt:
          rootSeedEndIndexExclusive == null
            ? selectedSeedCount
            : Math.min(rootSeedEndIndexExclusive, selectedSeedCount),
        tokens: [],
        positiveRowset: allPositiveRowset,
        negativeRowset: allNegativeRowset,
          positiveHitStats:
          shouldResolveDetailedPositiveHitStats
            ? computePositiveHitStats({
                rowIndexes: materializePerfectPrototypeRowsetValues(allPositiveRowset),
                hitCountMode: cfg.hitCountMode,
                hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
              })
            : null,
      }
      if (cfg.enableFamilyScopedMining !== true) {
        return [defaultScope]
      }
      if (isPerfectPrototypeRecentOnlyContinuationContext({ cfg, datasetContract })) {
        const requestedRecentOnlyFamilyIds = Array.from(
          buildPerfectPrototypeRecentOnlyMiningFamilyIdSet(cfg.recentOnlyFamilyIds),
        )
        const recentOnlyFamilyIds =
          requestedRecentOnlyFamilyIds.length > 0
            ? requestedRecentOnlyFamilyIds
            : PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_MINING_IDS
        const scopes = []
        for (const familyId of recentOnlyFamilyIds) {
          const familyScopeSpec = buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId)
          const familySupportCaseBucket =
            supportCaseFamilyLookup.get(familyId) ?? supportCaseFamilyLookup.get("*") ?? null
          const requiredLaneId = normalizeIndexedLaneKey(familyScopeSpec.requiredLaneId)
          const requiredPositiveTokens = uniqueSorted(familyScopeSpec.requiredPositiveTokens)
          const excludedPositiveTokens = uniqueSorted(familyScopeSpec.excludedPositiveTokens)
          if (!requiredLaneId || requiredPositiveTokens.length < 1) continue
          const rootTokenDiagnostics = await buildPerfectPrototypeRootScopeTokenDiagnostics({
            familyId,
            rootTokens: [...requiredPositiveTokens, ...excludedPositiveTokens],
            familyRootScopePostingCache,
          })
          rootTokenDiagnostics.requiredLaneId = requiredLaneId
          rootTokenDiagnostics.supportCaseIds = uniqueSorted(
            Array.from(familySupportCaseBucket?.caseIds ?? []),
          )
          rootTokenDiagnostics.supportCaseDonorRuleIds = uniqueSorted(
            Array.from(familySupportCaseBucket?.donorRuleIds ?? []),
          )
          rootTokenDiagnostics.supportCaseConstrainedFamily =
            isPerfectPrototypeSupportCaseTargetedFamilyId(familyId)
          rootTokenDiagnostics.supportCaseTokenCount =
            familySupportCaseBucket?.tokenSet instanceof Set
              ? familySupportCaseBucket.tokenSet.size
              : 0
          rootTokenDiagnostics.supportCaseDonorTokenCount =
            familySupportCaseBucket?.donorTokenSet instanceof Set
              ? familySupportCaseBucket.donorTokenSet.size
              : 0
          rootTokenDiagnostics.supportCaseMaxRootSeeds =
            Number.isInteger(Number(cfg?.supportCaseMaxRootSeeds))
              ? Number(cfg.supportCaseMaxRootSeeds)
              : null
          rootTokenDiagnostics.supportCaseMaxEffectiveRootSeeds =
            Number.isInteger(Number(cfg?.supportCaseMaxEffectiveRootSeeds))
              ? Number(cfg.supportCaseMaxEffectiveRootSeeds)
              : null
          rootTokenDiagnostics.supportCaseFailIfRootScopeUncompressed =
            cfg?.supportCaseFailIfRootScopeUncompressed === true
          let scopedPositiveRowset = buildPerfectPrototypeFilteredRowsetByPredicate({
            baseRowset: allPositiveRowset,
            universeSize: rowCount,
            predicate: (rowIndex) =>
              normalizeIndexedLaneKey(rowMeta?.rowStepALaneIds?.[rowIndex]) === requiredLaneId,
          })
          rootTokenDiagnostics.positiveRowCountAfterLaneFilter =
            getPerfectPrototypeRowsetCount(scopedPositiveRowset)
          let validScope = true
          let rootScopeInvalidReason = null
          if (getPerfectPrototypeRowsetCount(scopedPositiveRowset) < 1) {
            validScope = false
            rootScopeInvalidReason = "requiredLanePredicateZero"
          }
          for (const token of requiredPositiveTokens) {
            if (!validScope) break
            const positiveTokenRowset = await familyRootScopePostingCache.getPositiveRowset(token)
            if (!positiveTokenRowset) {
              validScope = false
              rootScopeInvalidReason = "missingRequiredRootToken"
              break
            }
            scopedPositiveRowset = intersectPerfectPrototypeRowsets({
              leftRowset: scopedPositiveRowset,
              rightRowset: positiveTokenRowset,
            })
            if (getPerfectPrototypeRowsetCount(scopedPositiveRowset) < 1) {
              validScope = false
              rootScopeInvalidReason = "requiredRootTokenIntersectionZero"
              break
            }
          }
          rootTokenDiagnostics.positiveRowCountAfterFamilyTokenIntersection =
            getPerfectPrototypeRowsetCount(scopedPositiveRowset)
          rejectionSummary.familyRootScopeDiagnosticsByFamily[familyId] = rootTokenDiagnostics
          if (!validScope) {
            rejectionSummary.familyCohortRowCountByFamily[familyId] = 0
            rejectionSummary.familyAcceptedRootSeedCountByFamily[familyId] = 0
            rejectionSummary.familyAcceptedRootSeedPreviewByFamily[familyId] = []
            rejectionSummary.familyRejectedRootSeedCountByFamily[familyId] = {
              [rootScopeInvalidReason ?? "missingRequiredRootToken"]: 1,
            }
            continue
          }
          for (const excludedToken of excludedPositiveTokens) {
            const excludedPositiveRowset = await familyRootScopePostingCache.getPositiveRowset(excludedToken)
            if (excludedPositiveRowset && getPerfectPrototypeRowsetCount(excludedPositiveRowset) > 0) {
              scopedPositiveRowset = buildPerfectPrototypeFilteredRowsetExcluding({
                baseRowset: scopedPositiveRowset,
                excludedRowset: excludedPositiveRowset,
                universeSize: rowCount,
              })
            }
          }
          rootTokenDiagnostics.positiveRowCountAfterThinPoolExclusion =
            getPerfectPrototypeRowsetCount(scopedPositiveRowset)
          const scopedPositiveCount = getPerfectPrototypeRowsetCount(scopedPositiveRowset)
          rejectionSummary.familyCohortRowCountByFamily[familyId] = scopedPositiveCount
          const familySearchMinHitCount = resolveFamilySpecificSearchMinHitCount({
            cfg,
            familyId,
          })
          if (scopedPositiveCount < Math.max(1, familySearchMinHitCount)) {
            const belowMinHitReason =
              excludedPositiveTokens.includes(PERFECT_PROTOTYPE_RULE_FAMILY_LANE_THIN_POOL_TOKEN) &&
              Number(rootTokenDiagnostics.positiveRowCountAfterRequiredIntersection ?? 0) > 0
                ? "thinPoolExcludedAllRows"
                : "belowMinHitCount"
            incrementFamilyCounter(rejectionSummary, "belowMinHitCountByFamily", familyId)
            rejectionSummary.familyAcceptedRootSeedCountByFamily[familyId] = 0
            rejectionSummary.familyAcceptedRootSeedPreviewByFamily[familyId] = []
            rejectionSummary.familyRejectedRootSeedCountByFamily[familyId] = {
              [belowMinHitReason]: 1,
            }
            continue
          }
          const scopedHitStats =
            shouldResolveDetailedPositiveHitStats
              ? computePositiveHitStats({
                  rowIndexes: materializePerfectPrototypeRowsetValues(scopedPositiveRowset),
                  hitCountMode: cfg.hitCountMode,
                  hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
                })
              : null
          if (
            trainMatchedDatePruneEnabled &&
            !evaluatePositiveHitStatsBreadthGuard(scopedHitStats, familyId).ok
          ) {
            rejectionSummary.familyAcceptedRootSeedCountByFamily[familyId] = 0
            rejectionSummary.familyAcceptedRootSeedPreviewByFamily[familyId] = []
            rejectionSummary.familyRejectedRootSeedCountByFamily[familyId] = {
              breadthGuardRejected: 1,
            }
            continue
          }
          if (yearHitUpperBoundPruneEnabled) {
            const scopedYearHitUpperBoundGuard = evaluatePerfectPrototypeYearHitUpperBoundGuard({
              hitDates: scopedHitStats?.hitDates,
              coreYears: cfg.coreYears,
              excludedBoundaryYears: cfg.excludedBoundaryYears,
              minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
            })
            if (!scopedYearHitUpperBoundGuard.ok) {
              rejectionSummary.familyAcceptedRootSeedCountByFamily[familyId] = 0
              rejectionSummary.familyAcceptedRootSeedPreviewByFamily[familyId] = []
              rejectionSummary.familyRejectedRootSeedCountByFamily[familyId] = {
                yearHitUpperBoundRejected: 1,
              }
              continue
            }
          }
          const rootSeedOrdering = await buildRecentOnlyFamilyRootSeedIndexes({
            cfg,
            familyId,
            seedTokens: seedTokensOrdered,
            seedCount: selectedSeedCount,
            positiveRowset: scopedPositiveRowset,
            negativeRowset: allNegativeRowset,
            seedPositiveCounts,
            seedPostingCache,
            familyCohortPositiveCount: scopedPositiveCount,
            minHitCount: familySearchMinHitCount,
            computePositiveHitStats,
            supportCaseTokenSet: familySupportCaseBucket?.tokenSet ?? null,
            donorTokenSet: familySupportCaseBucket?.donorTokenSet ?? null,
          })
          rootTokenDiagnostics.supportCaseFilteredRootTokenCount =
            Number(rootSeedOrdering.supportCaseRootTokenCount ?? 0)
          rootTokenDiagnostics.supportCaseFilteredDonorRootTokenCount =
            Number(rootSeedOrdering.donorRootTokenCount ?? 0)
          rootTokenDiagnostics.supportCaseRootSeedCandidateCount =
            Number(rootSeedOrdering.supportCaseRootSeedCandidateCount ?? 0)
          rootTokenDiagnostics.supportCaseFilteredSeedTokensSelected =
            Number(rootSeedOrdering.supportCaseFilteredRootSeedCount ?? 0)
          rootTokenDiagnostics.supportCaseEffectiveRootSeedCount =
            Number(rootSeedOrdering.supportCaseEffectiveRootSeedCount ?? rootSeedOrdering.acceptedCount ?? 0)
          rootTokenDiagnostics.supportCaseCompressionRatio =
            Number(rootSeedOrdering.supportCaseCompressionRatio ?? 0)
          rootTokenDiagnostics.supportCaseCompressionAchieved =
            !rootSeedOrdering.supportCaseConstrainedFamily ||
            !Number.isInteger(Number(cfg?.supportCaseMaxEffectiveRootSeeds)) ||
            Number(rootSeedOrdering.supportCaseEffectiveRootSeedCount ?? 0) <=
              Number(cfg.supportCaseMaxEffectiveRootSeeds)
          rootTokenDiagnostics.subgroupPrepassEnabled =
            rootSeedOrdering.subgroupPrepassEnabled === true
          rootTokenDiagnostics.subgroupCandidateCount =
            Number(rootSeedOrdering.subgroupCandidateCount ?? 0)
          rootTokenDiagnostics.subgroupQualifiedCandidateCount =
            Number(rootSeedOrdering.subgroupQualifiedCandidateCount ?? 0)
          rootTokenDiagnostics.subgroupEffectiveRootSeedCount =
            Number(rootSeedOrdering.subgroupEffectiveRootSeedCount ?? 0)
          rootTokenDiagnostics.subgroupManifestCandidateCount =
            Number(rootSeedOrdering.subgroupManifestCandidateCount ?? 0)
          rootTokenDiagnostics.subgroupStableManifestCount =
            Number(rootSeedOrdering.subgroupStableManifestCount ?? 0)
          rootTokenDiagnostics.subgroupDiverseManifestCount =
            Number(rootSeedOrdering.subgroupDiverseManifestCount ?? 0)
          rootTokenDiagnostics.subgroupStageReason =
            String(rootSeedOrdering.subgroupStageReason ?? "").trim() || null
          rootTokenDiagnostics.subgroupBundleManifestCount =
            Array.isArray(rootSeedOrdering.subgroupBundleManifests)
              ? rootSeedOrdering.subgroupBundleManifests.length
              : 0
          rootTokenDiagnostics.subgroupBundlePreview =
            Array.isArray(rootSeedOrdering.subgroupBundleManifests)
              ? rootSeedOrdering.subgroupBundleManifests.slice(0, 5).map((entry) => ({
                  subgroupId: entry?.subgroupId ?? null,
                  bundleTokens: Array.isArray(entry?.bundleTokens) ? entry.bundleTokens : [],
                  bundleAxes: Array.isArray(entry?.bundleAxes) ? entry.bundleAxes : [],
                  matchedDateCount: Number(entry?.matchedDateCount ?? 0) || 0,
                  matchedMonthCount: Number(entry?.matchedMonthCount ?? 0) || 0,
                  matchedFoldCount: Number(entry?.matchedFoldCount ?? 0) || 0,
                  coverageShare: Number(entry?.coverageShare ?? 0) || 0,
                  precision: Number(entry?.precision ?? 0) || 0,
                  wracc: Number(entry?.wracc ?? 0) || 0,
                  fpPenalty: Number(entry?.fpPenalty ?? 0) || 0,
                  top1DateHitShare: Number(entry?.top1DateHitShare ?? 0) || 0,
                  subgroupScore: Number(entry?.subgroupScore ?? 0) || 0,
                  subgroupTpLift: Number(entry?.subgroupTpLift ?? 0) || 0,
                  selectionFrequency: Number(entry?.selectionFrequency ?? 0) || 0,
                  foldPresenceCount: Number(entry?.foldPresenceCount ?? 0) || 0,
                  windowPresenceCount: Number(entry?.windowPresenceCount ?? 0) || 0,
                }))
              : []
          rootTokenDiagnostics.subgroupRejectedCounts =
            rootSeedOrdering.subgroupPrepassEnabled === true
              ? {
                  subgroupDisallowedRootToken:
                    Number(rootSeedOrdering.rejectedCounts?.subgroupDisallowedRootToken ?? 0),
                  subgroupFpRiskRootRejectCount:
                    Number(rootSeedOrdering.rejectedCounts?.subgroupFpRiskRootRejectCount ?? 0),
                  subgroupBreadthRejectCount:
                    Number(rootSeedOrdering.rejectedCounts?.subgroupBreadthRejectCount ?? 0),
                  subgroupQualityRejectCount:
                    Number(rootSeedOrdering.rejectedCounts?.subgroupQualityRejectCount ?? 0),
                  subgroupRootCapTruncatedCount:
                    Number(rootSeedOrdering.rejectedCounts?.subgroupRootCapTruncatedCount ?? 0),
                  subgroupPrefixPruneCount:
                    Number(rejectionSummary.subgroupPrefixPruneCountByFamily?.[familyId] ?? 0),
                }
              : {}
          rejectionSummary.familyAcceptedRootSeedCountByFamily[familyId] =
            Number(rootSeedOrdering.acceptedCount ?? 0)
          rejectionSummary.familyAcceptedRootSeedPreviewByFamily[familyId] =
            Array.isArray(rootSeedOrdering.acceptedPreview) ? rootSeedOrdering.acceptedPreview : []
          rejectionSummary.familyRejectedRootSeedCountByFamily[familyId] =
            rootSeedOrdering.rejectedCounts ?? {}
          rejectionSummary.subgroupBundlePreviewByFamily[familyId] =
            rootTokenDiagnostics.subgroupBundlePreview ?? []
          rejectionSummary.subgroupStageReasonByFamily[familyId] =
            rootTokenDiagnostics.subgroupStageReason ?? null
          if ((rootSeedOrdering.seedIndexes ?? []).length < 1) {
            continue
          }
          const subgroupBundleManifests = Array.isArray(rootSeedOrdering.subgroupBundleManifests)
            ? rootSeedOrdering.subgroupBundleManifests
            : []
          if (rootSeedOrdering.subgroupPrepassEnabled === true) {
            if (subgroupBundleManifests.length < 1) {
              throw new Error(
                `low-gap-top generalized subgroup prepass produced zero bundle manifests for family=${familyId}`,
              )
            }
            rejectionSummary.subgroupBundleManifestCount += subgroupBundleManifests.length
            let familyExactEntryAcceptedCount = 0
            let familyExactCompletionSolvedCount = 0
            let familyExactCompletionCollectedCount = 0
            for (const manifest of subgroupBundleManifests) {
              rejectionSummary.subgroupExactEntryCandidateCount += 1
              const familySearchMinHitCount = resolveFamilySpecificSearchMinHitCount({
                cfg,
                familyId,
              })
              const exactEntryState = await materializePerfectPrototypeSubgroupExactEntryState({
                manifest,
                familyId,
                basePositiveRowset: scopedPositiveRowset,
                baseNegativeRowset: allNegativeRowset,
                seedPostingCache,
                rowCount,
                computePositiveHitStats,
                hitCountMode: cfg.hitCountMode,
                hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
                effectiveMinHitCount: familySearchMinHitCount,
                familyScopedMinHitApplied: familySearchMinHitCount !== Math.max(1, Number(cfg?.minHitCount ?? 1) || 1),
              })
              const exactEntryPreview =
                exactEntryState?.preview && typeof exactEntryState.preview === "object"
                  ? {
                      ...exactEntryState.preview,
                      status: exactEntryState.ok === true ? "accepted" : "rejected",
                    }
                  : {
                      subgroupId: manifest?.subgroupId ?? null,
                      bundleTokens: Array.isArray(manifest?.bundleTokens) ? manifest.bundleTokens : [],
                      reason: exactEntryState?.reason ?? "bundle_seed_invalid",
                      status: exactEntryState?.ok === true ? "accepted" : "rejected",
                    }
              if (!exactEntryState?.ok) {
                rejectionSummary.subgroupExactEntryRejectedCount += 1
                incrementNestedReasonCounter(
                  rejectionSummary,
                  "subgroupExactEntryRejectReasonCounts",
                  exactEntryState?.reason ?? "bundle_seed_invalid",
                )
                incrementFamilyReasonCounter(
                  rejectionSummary,
                  "subgroupExactEntryRejectReasonByFamily",
                  familyId,
                  exactEntryState?.reason ?? "bundle_seed_invalid",
                )
                appendFamilyPreviewEntry(
                  rejectionSummary,
                  "subgroupExactEntrySeedPreviewByFamily",
                  familyId,
                  exactEntryPreview,
                )
                continue
              }
              const exactEntryBreadthFloor = {
                minMatchedDates: Number(cfg?.subgroupMinMatchedDates ?? 0) || 0,
                minMatchedMonths: Number(cfg?.subgroupMinMatchedMonths ?? 0) || 0,
                minMatchedFolds: Number(cfg?.subgroupMinMatchedFolds ?? 0) || 0,
                coverMatchedDates: Number(manifest?.matchedDateCount ?? 0) || 0,
                coverMatchedMonths: Number(manifest?.matchedMonthCount ?? 0) || 0,
                coverMatchedFolds: Number(manifest?.matchedFoldCount ?? 0) || 0,
                earlyDateRetentionRatio: Number(cfg?.subgroupEarlyDateRetentionRatio ?? 0.6) || 0.6,
                earlyMonthRetentionRatio: Number(cfg?.subgroupEarlyMonthRetentionRatio ?? 0.75) || 0.75,
                earlyFoldRetentionRatio: Number(cfg?.subgroupEarlyFoldRetentionRatio ?? 0.75) || 0.75,
              }
              const exactEntryBreadthFloorCheck = evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
                cfg,
                familyId,
                distinctDateCount: Number(exactEntryState?.matchedDateCount ?? 0) || 0,
                matchedMonthCount: Number(exactEntryState?.matchedMonthCount ?? 0) || 0,
                matchedFoldCount: Number(exactEntryState?.matchedFoldCount ?? 0) || 0,
                generalizedSubgroupBreadthFloor: exactEntryBreadthFloor,
              })
              if (!exactEntryBreadthFloorCheck.ok) {
                rejectionSummary.subgroupExactEntryRejectedCount += 1
                incrementNestedReasonCounter(
                  rejectionSummary,
                  "subgroupExactEntryRejectReasonCounts",
                  "breadth_floor_conflict",
                )
                incrementFamilyReasonCounter(
                  rejectionSummary,
                  "subgroupExactEntryRejectReasonByFamily",
                  familyId,
                  "breadth_floor_conflict",
                )
                appendFamilyPreviewEntry(
                  rejectionSummary,
                  "subgroupExactEntrySeedPreviewByFamily",
                  familyId,
                  {
                    ...exactEntryPreview,
                    reason: "breadth_floor_conflict",
                    status: "rejected",
                  },
                )
                continue
              }
              rejectionSummary.subgroupExactEntryAcceptedCount += 1
              familyExactEntryAcceptedCount += 1
              appendFamilyPreviewEntry(
                rejectionSummary,
                "subgroupExactEntrySeedPreviewByFamily",
                familyId,
                exactEntryPreview,
              )
              if (
                shouldUsePerfectPrototypeCounterexampleExactCompletion({
                  cfg,
                  familyId,
                  generalizedSubgroupManifest: manifest,
                })
              ) {
                rejectionSummary.exactCompletionManifestCount += 1
                const manifestKey =
                  String(manifest?.subgroupId ?? "").trim() ||
                  `subgroup_manifest_${String(rejectionSummary.exactCompletionManifestCount).padStart(3, "0")}`
                const completionSolveArgs = {
                  familyId,
                  manifest,
                  entryState: exactEntryState,
                  cfg,
                  selectedSeedCount,
                  seedTokensOrdered,
                  seedPositiveCounts,
                  seedPostingCache,
                  rowCount,
                  rowDateIndexes: rowMeta.rowDateIndexes,
                  calendarDateKeys: rowMeta.calendarDateKeys,
                  computePositiveHitStats,
                  familySearchMinHitCount,
                  generalizedSubgroupBreadthFloor: exactEntryBreadthFloor,
                  evaluateBreadthFloor: ({ hitStats, generalizedSubgroupBreadthFloor }) =>
                    evaluatePerfectPrototypeGeneralizedSubgroupBreadthFloor({
                      cfg,
                      familyId,
                      distinctDateCount: Number(hitStats?.distinctDateCount ?? 0) || 0,
                      matchedMonthCount: Number(hitStats?.matchedMonthCount ?? 0) || 0,
                      matchedFoldCount: Number(hitStats?.matchedFoldCount ?? 0) || 0,
                      generalizedSubgroupBreadthFloor,
                    }),
                  maxRuleSize: Math.min(
                    Math.max(1, Number(cfg?.maxRuleSize ?? 1) || 1),
                    Math.max(
                      Array.isArray(exactEntryState?.entrySeedTokens)
                        ? exactEntryState.entrySeedTokens.length
                        : 0,
                      0,
                    ) +
                      Math.max(
                        0,
                        Number(cfg?.exactCompletionMaxAdditionalTokens ?? 0) || 0,
                      ),
                  ),
                  maxCandidates: Math.max(
                    1,
                    Number(cfg?.exactCompletionMaxCandidates ?? 24) || 24,
                  ),
                  enableCrossfitHardNegativeRefinement:
                    cfg?.enableCrossfitHardNegativeRefinement === true,
                  crossfitHoldoutWindows: Math.max(
                    1,
                    Number(cfg?.crossfitHoldoutWindows ?? 6) || 6,
                  ),
                  crossfitMinWindowSupport: Math.max(
                    1,
                    Number(cfg?.crossfitMinWindowSupport ?? 2) || 2,
                  ),
                  crossfitHardNegativeWeight: Math.max(
                    1,
                    Number(cfg?.crossfitHardNegativeWeight ?? 1) || 1,
                  ),
                  supportCases: cfg?.supportCases ?? [],
                }
                const exactCompletionMode = String(cfg?.exactCompletionMode ?? "").trim()
                const completionOutcome =
                  exactCompletionMode === "joint_feasibility" &&
                  shouldUsePerfectPrototypeJointFeasibilitySolver({
                    cfg,
                    familyId,
                    generalizedSubgroupManifest: manifest,
                  })
                    ? await solvePerfectPrototypeJointFeasibility(completionSolveArgs)
                    : exactCompletionMode === "counterexample_core_frontier"
                      ? await solvePerfectPrototypeExactCompletionFrontier(completionSolveArgs)
                      : await solvePerfectPrototypeExactCompletion(completionSolveArgs)
                exploredStates += Math.max(
                  0,
                  Number(completionOutcome?.exploredStates ?? 0) || 0,
                )
                rejectionSummary.exactCompletionCandidatePoolSizeByManifest[manifestKey] =
                  Math.max(0, Number(completionOutcome?.candidatePoolSize ?? 0) || 0)
                rejectionSummary.exactCompletionNegativeFrontierSizeByManifest[manifestKey] =
                  Math.max(0, Number(completionOutcome?.negativeFrontierSize ?? 0) || 0)
                rejectionSummary.crossfitWindowCount +=
                  Math.max(0, Number(completionOutcome?.crossfitWindowCount ?? 0) || 0)
                rejectionSummary.crossfitMatchedWindowCount +=
                  Math.max(0, Number(completionOutcome?.crossfitMatchedWindowCount ?? 0) || 0)
                rejectionSummary.crossfitNegativeWindowCount +=
                  Math.max(0, Number(completionOutcome?.crossfitNegativeWindowCount ?? 0) || 0)
                rejectionSummary.crossfitFalsePositiveRowCount +=
                  Math.max(0, Number(completionOutcome?.crossfitFalsePositiveRowCount ?? 0) || 0)
                rejectionSummary.hardNegativeAddedCount +=
                  Math.max(0, Number(completionOutcome?.hardNegativeAddedCount ?? 0) || 0)
                rejectionSummary.hardNegativeRefinedRuleCount +=
                  Math.max(0, Number(completionOutcome?.hardNegativeRefined ? 1 : 0) || 0)
                rejectionSummary.jointFeasibilityManifestCount +=
                  Math.max(0, Number(completionOutcome?.jointFeasibilityManifestCount ?? 0) || 0)
                rejectionSummary.jointFeasibilitySolvedCount +=
                  Math.max(0, Number(completionOutcome?.jointFeasibilitySolvedCount ?? 0) || 0)
                rejectionSummary.jointFeasibilityUnsatCount +=
                  Math.max(0, Number(completionOutcome?.jointFeasibilityUnsatCount ?? 0) || 0)
                for (const [reason, count] of Object.entries(
                  completionOutcome?.jointFeasibilityUnsatReasonCounts ?? {},
                )) {
                  incrementNestedReasonCounter(
                    rejectionSummary,
                    "jointFeasibilityUnsatReasonCounts",
                    reason,
                    Number(count ?? 0) || 0,
                  )
                }
                rejectionSummary.jointHistoricalSupportMatchedCount +=
                  Math.max(0, Number(completionOutcome?.jointHistoricalSupportMatchedCount ?? 0) || 0)
                rejectionSummary.jointCrossfitRetainedPositiveWindowCount = Math.max(
                  Number(rejectionSummary.jointCrossfitRetainedPositiveWindowCount ?? 0) || 0,
                  Number(completionOutcome?.jointCrossfitRetainedPositiveWindowCount ?? 0) || 0,
                )
                rejectionSummary.jointCrossfitNegativeWindowCount = Math.max(
                  Number(rejectionSummary.jointCrossfitNegativeWindowCount ?? 0) || 0,
                  Number(completionOutcome?.jointCrossfitNegativeWindowCount ?? 0) || 0,
                )
                for (const [atomType, count] of Object.entries(
                  completionOutcome?.candidateAtomTypeCounts ?? {},
                )) {
                  rejectionSummary.candidateAtomTypeCounts[atomType] =
                    Number(rejectionSummary.candidateAtomTypeCounts[atomType] ?? 0) +
                    (Number(count ?? 0) || 0)
                }
                rejectionSummary.exactCoreCandidateCount +=
                  Math.max(0, Number(completionOutcome?.exactCoreCandidateCount ?? 0) || 0)
                rejectionSummary.exactCoreQualifiedCount +=
                  Math.max(0, Number(completionOutcome?.exactCoreQualifiedCount ?? 0) || 0)
                rejectionSummary.exactCoreSolvedCount +=
                  Math.max(0, Number(completionOutcome?.exactCoreSolvedCount ?? 0) || 0)
                rejectionSummary.exactCoreUnsatCount +=
                  Math.max(0, Number(completionOutcome?.exactCoreUnsatCount ?? 0) || 0)
                for (const [reason, count] of Object.entries(
                  completionOutcome?.exactCoreUnsatReasonCounts ?? {},
                )) {
                  incrementNestedReasonCounter(
                    rejectionSummary,
                    "exactCoreUnsatReasonCounts",
                    reason,
                    Number(count ?? 0) || 0,
                  )
                }
                rejectionSummary.exactCoreFrontierBestRetainedDateCount = Math.max(
                  Number(rejectionSummary.exactCoreFrontierBestRetainedDateCount ?? 0) || 0,
                  Number(completionOutcome?.exactCoreFrontierBestRetainedDateCount ?? 0) || 0,
                )
                rejectionSummary.exactCoreFrontierBestRetainedMonthCount = Math.max(
                  Number(rejectionSummary.exactCoreFrontierBestRetainedMonthCount ?? 0) || 0,
                  Number(completionOutcome?.exactCoreFrontierBestRetainedMonthCount ?? 0) || 0,
                )
                rejectionSummary.exactCoreFrontierBestRetainedFoldCount = Math.max(
                  Number(rejectionSummary.exactCoreFrontierBestRetainedFoldCount ?? 0) || 0,
                  Number(completionOutcome?.exactCoreFrontierBestRetainedFoldCount ?? 0) || 0,
                )
                if (!completionOutcome?.ok) {
                  rejectionSummary.exactCompletionUnsatCount += 1
                  incrementNestedReasonCounter(
                    rejectionSummary,
                    "exactCompletionUnsatReasonCounts",
                    completionOutcome?.reason ?? "unsat_negative_separation",
                  )
                  rejectionSummary.exactCompletionUnsatReasonByManifest[manifestKey] =
                    completionOutcome?.reason ?? "unsat_negative_separation"
                  await writeSearchProgress()
                  continue
                }
                rejectionSummary.exactCompletionSolvedCount += 1
                familyExactCompletionSolvedCount += 1
                const collectedRuleCountBeforeSolve = collectedRuleCount
                await maybeCollectRule({
                  familyId,
                  tokens: Array.isArray(completionOutcome?.tokens)
                    ? completionOutcome.tokens
                    : exactEntryState.entrySeedTokens,
                  positiveRowset:
                    completionOutcome?.positiveRowset ?? exactEntryState.positiveRowset,
                  negativeRowset:
                    completionOutcome?.negativeRowset ?? exactEntryState.negativeRowset,
                  positiveRowIndexes:
                    completionOutcome?.positiveRowIndexes ?? exactEntryState.positiveRowIndexes,
                  positiveHitStats:
                    completionOutcome?.positiveHitStats ?? exactEntryState.positiveHitStats,
                  generalizedSubgroupManifest: manifest ?? null,
                  exactCompletionMetadata: {
                    solved: true,
                    mode: cfg?.exactCompletionMode ?? "counterexample_guided",
                    addedTokenCount: Number(completionOutcome?.addedTokenCount ?? 0) || 0,
                    candidatePoolSize: Number(completionOutcome?.candidatePoolSize ?? 0) || 0,
                    negativeFrontierSize:
                      Number(completionOutcome?.negativeFrontierSize ?? 0) || 0,
                    subgroupId: manifest?.subgroupId ?? null,
                    coreId: completionOutcome?.coreId ?? null,
                    coreRetainedDateCount:
                      Number(completionOutcome?.coreRetainedDateCount ?? 0) || 0,
                    coreRetainedMonthCount:
                      Number(completionOutcome?.coreRetainedMonthCount ?? 0) || 0,
                    coreRetainedFoldCount:
                      Number(completionOutcome?.coreRetainedFoldCount ?? 0) || 0,
                    crossfitWindowCount:
                      Number(completionOutcome?.crossfitWindowCount ?? 0) || 0,
                    crossfitMatchedWindowCount:
                      Number(completionOutcome?.crossfitMatchedWindowCount ?? 0) || 0,
                    crossfitNegativeWindowCount:
                      Number(completionOutcome?.crossfitNegativeWindowCount ?? 0) || 0,
                    crossfitFalsePositiveRowCount:
                      Number(completionOutcome?.crossfitFalsePositiveRowCount ?? 0) || 0,
                    hardNegativeAddedCount:
                      Number(completionOutcome?.hardNegativeAddedCount ?? 0) || 0,
                    hardNegativeRefined:
                      completionOutcome?.hardNegativeRefined === true,
                    postRefineTrainMatchedDateCount:
                      Number(completionOutcome?.postRefineTrainMatchedDateCount ?? 0) || 0,
                    postRefineTrainMatchedMonthCount:
                      Number(completionOutcome?.postRefineTrainMatchedMonthCount ?? 0) || 0,
                    postRefineTrainMatchedFoldCount:
                      Number(completionOutcome?.postRefineTrainMatchedFoldCount ?? 0) || 0,
                    jointFeasibilitySolved:
                      completionOutcome?.jointFeasibilitySolved === true,
                    jointUnsatReason:
                      String(completionOutcome?.jointUnsatReason ?? "").trim() || null,
                    jointHistoricalSupportMatched:
                      completionOutcome?.jointHistoricalSupportMatched === true,
                    jointHistoricalSupportCaseIds: Array.isArray(
                      completionOutcome?.jointHistoricalSupportCaseIds,
                    )
                      ? completionOutcome.jointHistoricalSupportCaseIds
                      : [],
                    jointCrossfitRetainedPositiveWindowCount:
                      Number(
                        completionOutcome?.jointCrossfitRetainedPositiveWindowCount ?? 0,
                      ) || 0,
                    jointCrossfitNegativeWindowCount:
                      Number(completionOutcome?.jointCrossfitNegativeWindowCount ?? 0) || 0,
                    candidateAtomTypeCounts:
                      completionOutcome?.candidateAtomTypeCounts &&
                      typeof completionOutcome.candidateAtomTypeCounts === "object"
                        ? { ...completionOutcome.candidateAtomTypeCounts }
                        : {},
                    supportSignatureAtomCount:
                      Number(completionOutcome?.supportSignatureAtomCount ?? 0) || 0,
                    adaptiveThresholdAtomCount:
                      Number(completionOutcome?.adaptiveThresholdAtomCount ?? 0) || 0,
                    intervalAtomCount:
                      Number(completionOutcome?.intervalAtomCount ?? 0) || 0,
                    macroAtomCount:
                      Number(completionOutcome?.macroAtomCount ?? 0) || 0,
                    supportAnchorAtomCount:
                      Number(completionOutcome?.supportAnchorAtomCount ?? 0) || 0,
                  },
                })
                if (collectedRuleCount > collectedRuleCountBeforeSolve) {
                  rejectionSummary.exactCompletionCollectedRuleCount += 1
                  familyExactCompletionCollectedCount += 1
                } else {
                  rejectionSummary.exactCompletionCollectionRejectCount += 1
                }
                await maybeWriteLivePartialRuleSnapshot()
                await writeSearchProgress()
                continue
              }
              scopes.push({
                startAt: Number(exactEntryState?.nextStartAt ?? 0) || 0,
                endAt: null,
                seedIndexes: null,
                familyId,
                constrainedRoot: true,
                supportCaseTokenSet: familySupportCaseBucket?.tokenSet ?? null,
                donorTokenSet: familySupportCaseBucket?.donorTokenSet ?? null,
                generalizedSubgroupId: manifest?.subgroupId ?? null,
                generalizedSubgroupManifest: manifest ?? null,
                collectCurrentState: true,
                generalizedSubgroupBundleTokens: Array.isArray(exactEntryState?.entrySeedTokens)
                  ? exactEntryState.entrySeedTokens
                  : [],
                generalizedSubgroupBundleTokenSet:
                  Array.isArray(exactEntryState?.entrySeedTokens) && exactEntryState.entrySeedTokens.length > 0
                    ? new Set(exactEntryState.entrySeedTokens)
                    : null,
                generalizedSubgroupBreadthFloor: exactEntryBreadthFloor,
                tokens: Array.isArray(exactEntryState?.entrySeedTokens)
                  ? exactEntryState.entrySeedTokens
                  : [],
                positiveRowset: exactEntryState.positiveRowset,
                negativeRowset: exactEntryState.negativeRowset,
                positiveHitStats: exactEntryState.positiveHitStats,
              })
            }
            rootTokenDiagnostics.subgroupExactEntryCandidateCount = subgroupBundleManifests.length
            rootTokenDiagnostics.subgroupExactEntryAcceptedCount = familyExactEntryAcceptedCount
            rootTokenDiagnostics.subgroupExactEntryRejectedCount =
              Math.max(0, subgroupBundleManifests.length - familyExactEntryAcceptedCount)
            rootTokenDiagnostics.subgroupExactEntrySeedPreview =
              rejectionSummary.subgroupExactEntrySeedPreviewByFamily?.[familyId] ?? []
            rootTokenDiagnostics.exactCompletionManifestCount = subgroupBundleManifests.length
            rootTokenDiagnostics.exactCompletionSolvedCount = familyExactCompletionSolvedCount
            rootTokenDiagnostics.exactCompletionUnsatCount = Math.max(
              0,
              subgroupBundleManifests.length - familyExactCompletionSolvedCount,
            )
            rootTokenDiagnostics.exactCompletionCollectedRuleCount = familyExactCompletionCollectedCount
            rootTokenDiagnostics.crossfitWindowCount =
              Number(rejectionSummary.crossfitWindowCount ?? 0) || 0
            rootTokenDiagnostics.crossfitMatchedWindowCount =
              Number(rejectionSummary.crossfitMatchedWindowCount ?? 0) || 0
            rootTokenDiagnostics.crossfitNegativeWindowCount =
              Number(rejectionSummary.crossfitNegativeWindowCount ?? 0) || 0
            rootTokenDiagnostics.hardNegativeRefinedRuleCount =
              Number(rejectionSummary.hardNegativeRefinedRuleCount ?? 0) || 0
            rootTokenDiagnostics.jointFeasibilitySolvedCount =
              Number(rejectionSummary.jointFeasibilitySolvedCount ?? 0) || 0
            rootTokenDiagnostics.jointFeasibilityUnsatCount =
              Number(rejectionSummary.jointFeasibilityUnsatCount ?? 0) || 0
            rootTokenDiagnostics.jointHistoricalSupportMatchedCount =
              Number(rejectionSummary.jointHistoricalSupportMatchedCount ?? 0) || 0
            rootTokenDiagnostics.jointCrossfitRetainedPositiveWindowCount =
              Number(rejectionSummary.jointCrossfitRetainedPositiveWindowCount ?? 0) || 0
            rootTokenDiagnostics.jointCrossfitNegativeWindowCount =
              Number(rejectionSummary.jointCrossfitNegativeWindowCount ?? 0) || 0
            if (familyExactEntryAcceptedCount < 1) {
              rejectionSummary.subgroupStageReasonByFamily[familyId] = "no_exact_entry"
            } else if (
              shouldUsePerfectPrototypeCounterexampleExactCompletion({
                cfg,
                familyId,
                generalizedSubgroupManifest: subgroupBundleManifests[0] ?? null,
              }) &&
              shouldUsePerfectPrototypeJointFeasibilitySolver({
                cfg,
                familyId,
                generalizedSubgroupManifest: subgroupBundleManifests[0] ?? null,
              }) &&
              Number(rejectionSummary.jointFeasibilitySolvedCount ?? 0) < 1
            ) {
              rejectionSummary.subgroupStageReasonByFamily[familyId] = "no_joint_feasible_rules"
            } else if (
              shouldUsePerfectPrototypeCounterexampleExactCompletion({
                cfg,
                familyId,
                generalizedSubgroupManifest: subgroupBundleManifests[0] ?? null,
              }) &&
              familyExactCompletionSolvedCount < 1
            ) {
              rejectionSummary.subgroupStageReasonByFamily[familyId] = "no_exact_completion_solutions"
            } else if (
              shouldUsePerfectPrototypeCounterexampleExactCompletion({
                cfg,
                familyId,
                generalizedSubgroupManifest: subgroupBundleManifests[0] ?? null,
              }) &&
              familyExactCompletionCollectedCount < 1
            ) {
              rejectionSummary.subgroupStageReasonByFamily[familyId] = "no_exact_completion_train_rules"
            }
            continue
          }
          scopes.push({
            startAt: 0,
            endAt: 0,
            seedIndexes: rootSeedOrdering.seedIndexes,
            familyId,
            constrainedRoot: true,
            supportCaseTokenSet: familySupportCaseBucket?.tokenSet ?? null,
            donorTokenSet: familySupportCaseBucket?.donorTokenSet ?? null,
            generalizedSubgroupId: null,
            generalizedSubgroupManifest: null,
            generalizedSubgroupBundleTokens: [],
            generalizedSubgroupBundleTokenSet: null,
            generalizedSubgroupBreadthFloor: rootSeedOrdering.subgroupPrepassEnabled
              ? {
                  minMatchedDates: Number(cfg?.subgroupMinMatchedDates ?? 0) || 0,
                  minMatchedMonths: Number(cfg?.subgroupMinMatchedMonths ?? 0) || 0,
                  minMatchedFolds: Number(cfg?.subgroupMinMatchedFolds ?? 0) || 0,
                  earlyDateRetentionRatio: Number(cfg?.subgroupEarlyDateRetentionRatio ?? 0.6) || 0.6,
                  earlyMonthRetentionRatio: Number(cfg?.subgroupEarlyMonthRetentionRatio ?? 0.75) || 0.75,
                  earlyFoldRetentionRatio: Number(cfg?.subgroupEarlyFoldRetentionRatio ?? 0.75) || 0.75,
                }
              : null,
            tokens: [],
            positiveRowset: scopedPositiveRowset,
            negativeRowset: allNegativeRowset,
            positiveHitStats: scopedHitStats,
          })
        }
        rejectionSummary.supportCaseRootSeedCandidateCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce(
          (sum, entry) => sum + Number(entry?.supportCaseRootSeedCandidateCount ?? 0),
          0,
        )
        rejectionSummary.supportCaseFilteredRootSeedCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce(
          (sum, entry) => sum + Number(entry?.supportCaseFilteredSeedTokensSelected ?? 0),
          0,
        )
        rejectionSummary.supportCaseEffectiveRootSeedCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce(
          (sum, entry) => sum + Number(entry?.supportCaseEffectiveRootSeedCount ?? 0),
          0,
        )
        rejectionSummary.supportCaseCompressionRatio =
          selectedSeedCount > 0
            ? safeRate(rejectionSummary.supportCaseEffectiveRootSeedCount, selectedSeedCount)
            : null
        rejectionSummary.supportCaseCompressionAchieved =
          !Number.isInteger(Number(cfg?.supportCaseMaxEffectiveRootSeeds)) ||
          rejectionSummary.supportCaseEffectiveRootSeedCount <=
            Number(cfg.supportCaseMaxEffectiveRootSeeds)
        rejectionSummary.subgroupCandidateCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupCandidateCount ?? 0), 0)
        rejectionSummary.subgroupQualifiedCandidateCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupQualifiedCandidateCount ?? 0), 0)
        rejectionSummary.subgroupEffectiveRootSeedCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupEffectiveRootSeedCount ?? 0), 0)
        rejectionSummary.subgroupManifestCandidateCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupManifestCandidateCount ?? 0), 0)
        rejectionSummary.subgroupStableManifestCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupStableManifestCount ?? 0), 0)
        rejectionSummary.subgroupDiverseManifestCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupDiverseManifestCount ?? 0), 0)
        rejectionSummary.subgroupBundleManifestCount = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce((sum, entry) => sum + Number(entry?.subgroupBundleManifestCount ?? 0), 0)
        rejectionSummary.subgroupRejectedCounts = Object.values(
          rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
        ).reduce(
          (acc, entry) => {
            const counts = entry?.subgroupRejectedCounts ?? {}
            for (const [key, value] of Object.entries(counts)) {
              acc[key] = Number(acc[key] ?? 0) + (Number(value) || 0)
            }
            return acc
          },
          {},
        )
        rejectionSummary.subgroupRejectedCounts.subgroupPrefixPruneCount =
          Number(rejectionSummary.subgroupPrefixPruneCount ?? 0)
        rejectionSummary.subgroupRejectedCounts.subgroupBreadthFloorPruneCount =
          Number(rejectionSummary.subgroupBreadthFloorPruneCount ?? 0)
        rejectionSummary.subgroupAcceptedPreviewByFamily = Object.fromEntries(
          Object.entries(rejectionSummary.familyAcceptedRootSeedPreviewByFamily ?? {}).map(
            ([currentFamilyId, preview]) => [
              currentFamilyId,
              (Array.isArray(preview) ? preview : []).map((entry) => ({
                token: entry?.token ?? null,
                subgroupQualified: entry?.subgroupQualified === true,
                subgroupScore: Number(entry?.subgroupScore ?? 0) || 0,
                subgroupDistinctDateCount: Number(entry?.subgroupDistinctDateCount ?? 0) || 0,
                subgroupMatchedMonthCount: Number(entry?.subgroupMatchedMonthCount ?? 0) || 0,
                subgroupMatchedFoldCount: Number(entry?.subgroupMatchedFoldCount ?? 0) || 0,
                subgroupTop1DateHitShare: Number(entry?.subgroupTop1DateHitShare ?? 0) || 0,
                subgroupTpLift: Number(entry?.subgroupTpLift ?? 0) || 0,
                subgroupBundleAxis: entry?.subgroupBundleAxis ?? null,
              })),
            ],
          ),
        )
        if (
          Array.isArray(cfg.supportCases) &&
          cfg.supportCases.length > 0 &&
          (!Array.isArray(rejectionSummary.supportCaseIds) ||
            !Number.isFinite(Number(rejectionSummary.supportCaseEffectiveRootSeedCount)))
        ) {
          throw new Error(
            "support-case targeted search is missing effective root telemetry after scope build",
          )
        }
        if (
          cfg.enableSubgroupPrepass === true &&
          recentOnlyFamilyIds.includes(PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION) &&
          !Number.isFinite(Number(rejectionSummary.subgroupEffectiveRootSeedCount))
        ) {
          throw new Error(
            "low-gap-top generalized subgroup prepass is missing effective root telemetry after scope build",
          )
        }
        if (scopes.length < 1) {
          const exactCompletionPathActive =
            Number(rejectionSummary.exactCompletionManifestCount ?? 0) > 0 ||
            Number(rejectionSummary.subgroupExactEntryAcceptedCount ?? 0) > 0
          if (exactCompletionPathActive) {
            return scopes
          }
          throw new Error(
            [
              "recent-only MID/LOW root scope build produced zero valid scopes",
              JSON.stringify(
                {
                  familyCohortRowCountByFamily: rejectionSummary.familyCohortRowCountByFamily ?? {},
                  familyAcceptedRootSeedCountByFamily:
                    rejectionSummary.familyAcceptedRootSeedCountByFamily ?? {},
                  belowMinHitCountByFamily:
                    rejectionSummary.belowMinHitCountByFamily ?? {},
                  exactCompletionManifestCount:
                    Number(rejectionSummary.exactCompletionManifestCount ?? 0) || 0,
                  exactCompletionSolvedCount:
                    Number(rejectionSummary.exactCompletionSolvedCount ?? 0) || 0,
                  exactCompletionUnsatCount:
                    Number(rejectionSummary.exactCompletionUnsatCount ?? 0) || 0,
                  exactCompletionCollectedRuleCount:
                    Number(rejectionSummary.exactCompletionCollectedRuleCount ?? 0) || 0,
                  exactCompletionUnsatReasonCounts:
                    rejectionSummary.exactCompletionUnsatReasonCounts ?? {},
                  familyRejectedRootSeedCountByFamily:
                    rejectionSummary.familyRejectedRootSeedCountByFamily ?? {},
                  familyRootScopeDiagnosticsByFamily:
                    rejectionSummary.familyRootScopeDiagnosticsByFamily ?? {},
                },
                null,
                2,
              ),
            ].join("\n"),
          )
        }
        return scopes
      }
      const scopes = []
      for (const definition of PERFECT_PROTOTYPE_INDEXED_FAMILY_ROOT_SCOPE_DEFINITIONS) {
        const rootTokens = uniqueSorted(definition.rootTokens)
        let scopedPositiveRowset = allPositiveRowset
        let scopedNegativeRowset = allNegativeRowset
        let validScope = rootTokens.length > 0
        for (const token of rootTokens) {
          const positiveTokenRowset = await familyRootScopePostingCache.getPositiveRowset(token)
          if (!positiveTokenRowset) {
            validScope = false
            break
          }
          scopedPositiveRowset = intersectPerfectPrototypeRowsets({
            leftRowset: scopedPositiveRowset,
            rightRowset: positiveTokenRowset,
          })
          if (getPerfectPrototypeRowsetCount(scopedPositiveRowset) < 1) {
            validScope = false
            break
          }
          const negativeTokenRowset = await familyRootScopePostingCache.getNegativeRowset(token)
          scopedNegativeRowset = negativeTokenRowset
            ? intersectPerfectPrototypeRowsets({
                leftRowset: scopedNegativeRowset,
                rightRowset: negativeTokenRowset,
              })
            : createPerfectPrototypeRowset({
                values: [],
                universeSize: rowCount,
                allowDense: true,
              })
        }
        if (!validScope) continue
        const scopedPositiveCount = getPerfectPrototypeRowsetCount(scopedPositiveRowset)
        if (scopedPositiveCount < Math.max(1, cfg.minHitCount)) {
          continue
        }
        const scopedHitStats =
          shouldResolveDetailedPositiveHitStats
            ? computePositiveHitStats({
                rowIndexes: materializePerfectPrototypeRowsetValues(scopedPositiveRowset),
                hitCountMode: cfg.hitCountMode,
                hitCountDaySymbolCap: cfg.hitCountDaySymbolCap,
              })
            : null
        if (
          trainMatchedDatePruneEnabled &&
          !evaluatePositiveHitStatsBreadthGuard(scopedHitStats, definition.familyId).ok
        ) {
          continue
        }
        if (yearHitUpperBoundPruneEnabled) {
          const scopedYearHitUpperBoundGuard = evaluatePerfectPrototypeYearHitUpperBoundGuard({
            hitDates: scopedHitStats?.hitDates,
            coreYears: cfg.coreYears,
            excludedBoundaryYears: cfg.excludedBoundaryYears,
            minTrainHitsPerCoreYear: cfg.minTrainHitsPerCoreYear,
          })
          if (!scopedYearHitUpperBoundGuard.ok) {
            continue
          }
        }
        scopes.push({
          startAt: Math.min(rootSeedStartIndex, selectedSeedCount),
          endAt:
            rootSeedEndIndexExclusive == null
              ? selectedSeedCount
              : Math.min(rootSeedEndIndexExclusive, selectedSeedCount),
          familyId: definition.familyId,
          tokens: rootTokens,
          positiveRowset: scopedPositiveRowset,
          negativeRowset: scopedNegativeRowset,
          positiveHitStats: scopedHitStats,
        })
      }
      return scopes.length > 0 ? scopes : [defaultScope]
    }
    const rootSearchScopes = await buildRootSearchScopes()
    const shouldBalanceRootScopeBudgets =
      rootSearchScopes.length > 1 &&
      rootSearchScopes.every(
        (scope) =>
          scope?.constrainedRoot === true &&
          isPerfectPrototypeContinuationFamilyId(scope?.familyId),
      )
    for (let scopeIndex = 0; scopeIndex < rootSearchScopes.length; scopeIndex += 1) {
      const scope = rootSearchScopes[scopeIndex]
      const scopeFamilyId = String(scope?.familyId ?? "").trim() || "unclassified"
      let scopeBudgetLimit = null
      let scopeBudgetStopTracker = null
      if (shouldBalanceRootScopeBudgets) {
        const remainingScopeCount = Math.max(1, rootSearchScopes.length - scopeIndex)
        const remainingBudget = Math.max(0, getEffectiveAllocatedMaxSearchStates() - exploredStates)
        const scopeBudgetAllowance =
          remainingBudget < 1
            ? 0
            : remainingScopeCount <= 1
            ? remainingBudget
            : Math.max(1, Math.floor(remainingBudget / remainingScopeCount))
        scopeBudgetLimit = exploredStates + scopeBudgetAllowance
        scopeBudgetStopTracker = { counted: false }
        rejectionSummary.rootScopeBudgetPlanByFamily[scopeFamilyId] = {
          scopeIndex,
          remainingScopeCount,
          scopeBudgetAllowance,
          scopeBudgetStartExploredStates: exploredStates,
          scopeBudgetLimit,
        }
      }
      await search({
        ...scope,
        scopeBudgetLimit,
        scopeBudgetStopTracker,
      })
    }

    await maybeRefreshExternalKthHitFloor({ force: true })
    await maybeRefreshExternalAllocatedSearchBudget({ force: true })
    await maybeWriteLivePartialRuleSnapshot({ force: true })
    const searchStateStats = searchStateCache.getStats()
    rejectionSummary.collectedRuleCount = collectedRuleCount
    rejectionSummary.boundPruneCount = boundPruneCount
    rejectionSummary.stateDominancePruneCount = stateDominancePruneCount
    Object.assign(rejectionSummary, buildMemoLookupTelemetry(searchStateStats))
    rejectionSummary.memoPositiveSignatureBucketCount = searchStateStats.positiveSignatureBucketCount
    rejectionSummary.memoFrontierInsertCount = searchStateStats.frontierInsertCount
    rejectionSummary.memoFrontierPruneCount = searchStateStats.frontierPruneCount
    rejectionSummary.memoFrontierScanCount = searchStateStats.memoFrontierScanCount
    rejectionSummary.memoFrontierDeleteCount = searchStateStats.memoFrontierDeleteCount
    rejectionSummary.memoFrontierSkippedBucketCount = searchStateStats.memoFrontierSkippedBucketCount
    rejectionSummary.memoFrontierCompactionCount = searchStateStats.memoFrontierCompactionCount
    rejectionSummary.memoFrontierBucketCount = searchStateStats.memoFrontierBucketCount
    rejectionSummary.memoFrontierTombstoneCount = searchStateStats.memoFrontierTombstoneCount
    rejectionSummary.memoFingerprintBucketPeak = searchStateStats.memoFingerprintBucketPeak
    rejectionSummary.memoEvictedFrontierEntryCount = searchStateStats.evictedFrontierEntryCount
    rejectionSummary.initialKthHitFloor = initialKthHitFloor
    rejectionSummary.externalKthHitFloor = externalKthHitFloor
    rejectionSummary.externalKthHitFloorRevision = externalKthHitFloorRevision
    rejectionSummary.externalKthHitFloorPollCount = externalKthHitFloorPollCount
    rejectionSummary.externalKthHitFloorAppliedCount = externalKthHitFloorAppliedCount
    rejectionSummary.externalAllocatedMaxSearchStates = externalAllocatedMaxSearchStates
    rejectionSummary.externalBudgetRevision = externalBudgetRevision
    rejectionSummary.externalBudgetPollCount = externalBudgetPollCount
    rejectionSummary.externalBudgetDecisionPollCount = externalBudgetDecisionPollCount
    rejectionSummary.externalBudgetAppliedCount = externalBudgetAppliedCount
    rejectionSummary.externalBudgetDecreaseAppliedCount = externalBudgetDecreaseAppliedCount
    rejectionSummary.externalBudgetDecreaseSearchStates = externalBudgetDecreaseSearchStates
    rejectionSummary.externalBudgetAllowanceAppliedCount = externalBudgetAllowanceAppliedCount
    rejectionSummary.externalBudgetAllowanceSeenCount = externalBudgetAllowanceSeenCount
    rejectionSummary.externalBudgetAllowanceConsumedCount = externalBudgetAllowanceConsumedCount
    rejectionSummary.externalBudgetRequestCount = externalBudgetRequestCount
    rejectionSummary.externalBudgetRequestSatisfiedCount = externalBudgetRequestSatisfiedCount
    rejectionSummary.externalBudgetRequestDeniedCount = externalBudgetRequestDeniedCount
    rejectionSummary.externalBudgetRequestPendingCount = externalBudgetRequestPendingCount
    rejectionSummary.externalBudgetRequestWaitMs = externalBudgetRequestWaitMsTotal
    rejectionSummary.externalBudgetPendingWaitMs = externalBudgetPendingWaitMsTotal
    rejectionSummary.externalBudgetCommitRequestCount = externalBudgetCommitRequestCount
    rejectionSummary.externalBudgetCommitRevision = externalBudgetCommitRevision
    rejectionSummary.externalBudgetLastDecision = externalBudgetLastDecision
    rejectionSummary.effectiveKthHitFloor = getCurrentKthHitFloor()
    rejectionSummary.effectiveAllocatedMaxSearchStates = getEffectiveAllocatedMaxSearchStates()
    rejectionSummary.livePartialRuleRevision = livePartialRuleRevision
    rejectionSummary.livePartialRuleCount = livePartialRuleCount
    rejectionSummary.livePartialRuleCheckpointCount = livePartialRuleCheckpointCount
    rejectionSummary.livePartialRuleWriteMs = livePartialRuleWriteMs
    rejectionSummary.livePartialLocalKthHitFloor = topKHitTracker.getKthHitFloor()
    rejectionSummary.livePartialBootstrapSnapshotCount = livePartialBootstrapSnapshotCount
    rejectionSummary.livePartialBootstrapRuleCount = livePartialBootstrapRuleCount
    rejectionSummary.livePartialBootstrapModeActive =
      livePartialBootstrapSnapshotCount > 0 ? 1 : 0
    rejectionSummary.configuredMaxSearchStates = configuredMaxSearchStates
    rejectionSummary.baseAllocatedMaxSearchStates = baseAllocatedMaxSearchStates
    rejectionSummary.guardBandAllocatedSearchStates = guardBandAllocatedSearchStates
    rejectionSummary.allocatedMaxSearchStates = allocatedMaxSearchStates
    rejectionSummary.remainingGlobalSearchBudgetAtLaunch = remainingGlobalSearchBudgetAtLaunch
    rejectionSummary.budgetStopCount = budgetStopCount
    rejectionSummary.budgetStopExploredStates = budgetStopExploredStates
    rejectionSummary.budgetStopReason = budgetStopReason
    rejectionSummary.candidateEfficiency = safeRate(
      acceptedCandidateCount,
      Math.max(1, candidateDescriptorCount),
    )
    if (exploredStates > getEffectiveAllocatedMaxSearchStates()) {
      throw new Error(
        [
          "Indexed miner exceeded its allocated search-state budget before summary write.",
          `exploredStates=${exploredStates}`,
          `allocatedMaxSearchStates=${allocatedMaxSearchStates}`,
          `effectiveAllocatedMaxSearchStates=${getEffectiveAllocatedMaxSearchStates()}`,
          `baseAllocatedMaxSearchStates=${baseAllocatedMaxSearchStates}`,
          `guardBandAllocatedSearchStates=${guardBandAllocatedSearchStates}`,
        ].join("\n"),
      )
    }
    const rowsetRuntimeStats = getPerfectPrototypeRowsetRuntimeStats()
    rejectionSummary.rowsetBorrowHitCount =
      Number(rowsetRuntimeStats?.sparseBorrowHitCount ?? 0) +
      Number(rowsetRuntimeStats?.bitsetBorrowHitCount ?? 0)
    rejectionSummary.rowsetBorrowMissCount =
      Number(rowsetRuntimeStats?.sparseBorrowMissCount ?? 0) +
      Number(rowsetRuntimeStats?.bitsetBorrowMissCount ?? 0)
    rejectionSummary.rowsetOwnedAllocCount = Number(rowsetRuntimeStats?.rowsetOwnedAllocCount ?? 0)
    rejectionSummary.rowsetFinalizeCount = Number(rowsetRuntimeStats?.rowsetFinalizeCount ?? 0)
    rejectionSummary.sparseKernelMode = String(rowsetRuntimeStats?.sparseKernelMode ?? "unknown")
    rejectionSummary.sparseSparseIntersectionMs = Number(
      rowsetRuntimeStats?.sparseSparseIntersectionMs ?? 0,
    )
    rejectionSummary.sparseBitmapIntersectionMs = Number(
      rowsetRuntimeStats?.sparseBitmapIntersectionMs ?? 0,
    )
    rejectionSummary.sparseEqualSizeMergeCount = Number(
      rowsetRuntimeStats?.sparseEqualSizeMergeCount ?? 0,
    )
    rejectionSummary.sparseAdaptiveGallopCount = Number(
      rowsetRuntimeStats?.sparseAdaptiveGallopCount ?? 0,
    )
    rejectionSummary.sparseCountFastPathCount = Number(
      rowsetRuntimeStats?.sparseCountFastPathCount ?? 0,
    )
    rejectionSummary.sparseBitmapWordRunCount = Number(
      rowsetRuntimeStats?.sparseBitmapWordRunCount ?? 0,
    )
    rejectionSummary.sparseBitmapSkippedRunCount = Number(
      rowsetRuntimeStats?.sparseBitmapSkippedRunCount ?? 0,
    )
    rejectionSummary.sparseBitmapPartialRunCount = Number(
      rowsetRuntimeStats?.sparseBitmapPartialRunCount ?? 0,
    )
    rejectionSummary.sparseBitmapFullRunHitCount = Number(
      rowsetRuntimeStats?.sparseBitmapFullRunHitCount ?? 0,
    )
    rejectionSummary.bitmapKernelMode = String(rowsetRuntimeStats?.bitmapKernelMode ?? "unknown")
    rejectionSummary.bitmapDenseDenseCount = Number(rowsetRuntimeStats?.bitmapDenseDenseCount ?? 0)
    rejectionSummary.bitmapIntersectionMs = Number(rowsetRuntimeStats?.bitmapIntersectionMs ?? 0)
    rejectionSummary.bitmapMaterializeMs = Number(rowsetRuntimeStats?.bitmapMaterializeMs ?? 0)
    rejectionSummary.bitmapEdgeSummaryMs = Number(rowsetRuntimeStats?.bitmapEdgeSummaryMs ?? 0)
    rejectionSummary.kthHitFloor = getCurrentKthHitFloor()
    rejectionSummary.childOrderingMs = childOrderingMs
    rejectionSummary.orderingNegativeLoads = orderingNegativeLoads
    rejectionSummary.orderingHeadWindow = orderingHeadWindow
    rejectionSummary.orderingHeadExactLoads = orderingHeadExactLoads
    rejectionSummary.orderingHeadRerankMs = orderingHeadRerankMs
    rejectionSummary.currentSearchDepth = currentSearchDepth
    rejectionSummary.maxSearchDepth = maxSearchDepth
    rejectionSummary.candidateDescriptorCount = candidateDescriptorCount
    rejectionSummary.acceptedCandidateCount = acceptedCandidateCount
    rejectionSummary.seedPostingCacheEntryLimit = seedPostingCacheEntryLimit
    rejectionSummary.seedPositiveLoadCount = seedPositiveLoadCount
    rejectionSummary.seedNegativeLoadCount = seedNegativeLoadCount
    rejectionSummary.seedPostingLoadMs = seedPostingLoadMs
    rejectionSummary.seedPostingPrewarmMs = seedPostingPrewarmMs
    rejectionSummary.seedPostingPrewarmTokenCount = seedPostingPrewarmTokenCount
    rejectionSummary.candidateDescriptorBuildMs = candidateDescriptorBuildMs
    rejectionSummary.negativeCountResolutionMs = negativeCountResolutionMs
    rejectionSummary.childRowsetMaterializeMs = childRowsetMaterializeMs
    rejectionSummary.rowProjectedCandidateThreshold = rowProjectedCandidateThreshold
    rejectionSummary.rowProjectedCandidateBuildMs = rowProjectedCandidateBuildMs
    rejectionSummary.rowProjectedActivationCount = rowProjectedActivationCount
    rejectionSummary.rowProjectedTouchedRowCount = rowProjectedTouchedRowCount
    rejectionSummary.rowProjectedTokenVisitCount = rowProjectedTokenVisitCount
    rejectionSummary.rowProjectedCandidateSeedCount = rowProjectedCandidateSeedCount
    rejectionSummary.diverseBeamDeferredCandidateCount = diverseBeamDeferredCandidateCount
    rejectionSummary.searchProgressRevision = searchProgressRevision
    rejectionSummary.rowsetModeStats = rowsetModeStats
    rejectionSummary.rowsetIntersectionMs = getLiveRowsetIntersectionTelemetry().rowsetIntersectionMs
    Object.assign(rejectionSummary, buildContributionTelemetry())
    const cappedByTemporalSignature = applyMatchedDateSignatureCap(
      Array.from(collectedByMatchSignature.values()).flat(),
    )
    rejectionSummary.observedRuleCount = collectedRuleCount
    rejectionSummary.liveCanonicalRuleCount = cappedByTemporalSignature.rules.length
    rejectionSummary.collectedRuleCount = cappedByTemporalSignature.rules.length
    rejectionSummary.matchedDateSignatureBucketCapCount =
      cappedByTemporalSignature.droppedByDateSignature
    rejectionSummary.matchedMonthSignatureBucketCapCount =
      cappedByTemporalSignature.droppedByMonthSignature
    rejectionSummary.matchedQuarterSignatureBucketCapCount =
      cappedByTemporalSignature.droppedByQuarterSignature

    const negativeSeparationReport = buildNegativeSeparationReport({
      seedEntries: materializeSeedEntriesForReport({
        seedTokens: seedTokensOrdered,
        seedPositiveCounts,
        seedNegativeCounts,
        seedPrecisions,
        seedSeparationRatios,
        seedSeparationLifts,
      }),
      rejectedRules,
      rejectionSummary,
      exploredStates,
    })
    seedTokensOrdered = []
    seedDictionaryEntries = []
    seedPositiveCounts = []
    seedNegativeCounts = []
    seedPrecisions = []
    seedSeparationRatios = []
    seedSeparationLifts = []
    const seedCacheStats = seedPostingCache.getStats()
    const selectorDatasetRows = materializeDatasetRowsFromIndexedRowMeta({
      rowCount: rowMeta.rowCount,
      sourceType: rowMeta.datasetSourceType,
      rowSourceIds: rowMeta.rowSourceIds,
      rowDateKeys: rowMeta.rowDateKeys,
      rowSymbols: rowMeta.rowSymbols,
      rowOutcomeHitTargets: rowMeta.rowOutcomeHitTargets,
      rowStepALaneIds: rowMeta.rowStepALaneIds,
      rowImpulseLookbackDays: rowMeta.rowImpulseLookbackDays,
    })
    let selectorReport = null
    let selectedRuleCores = cappedByTemporalSignature.rules
    if (cfg.enableDiverseCatalogSelection === true) {
      const diverseSelection = selectDiversePerfectPrototypeRules({
        rules: selectedRuleCores,
        rows: selectorDatasetRows,
        maxRules: cfg.diverseCatalogTargetRules ?? cfg.maxRules,
        noveltyWeight: cfg.diverseNoveltyWeight,
        overlapPenaltyWeight: cfg.diverseOverlapPenaltyWeight,
        anchorFamilyPenaltyWeight: cfg.diverseAnchorFamilyPenaltyWeight,
        topFamilyMaxQuota: cfg.topFamilyMaxQuota,
        midFamilyMinQuota: cfg.midFamilyMinQuota,
        lowFamilyMinQuota: cfg.lowFamilyMinQuota,
      })
      selectedRuleCores = diverseSelection.selectedRules
      selectorReport = diverseSelection.selectionReport
    } else if (cfg.enableMdlCatalogSelection === true) {
      const mdlSelection = selectPerfectPrototypeMdlRules({
        rules: selectedRuleCores,
        rows: selectorDatasetRows,
        maxRules: cfg.diverseCatalogTargetRules ?? cfg.maxRules,
        descriptionLengthWeight: cfg.mdlDescriptionLengthWeight,
        overlapPenaltyWeight: cfg.mdlOverlapPenaltyWeight,
      })
      selectedRuleCores = mdlSelection.selectedRules
      selectorReport = mdlSelection.selectionReport
    } else if (outputMode !== "partial") {
      selectedRuleCores = selectTopPerfectPrototypeRulesDeterministically(
        selectedRuleCores,
        cfg.maxRules,
      )
    } else {
      selectedRuleCores = rankPerfectPrototypeRules(selectedRuleCores)
    }
    const collectedRules = selectedRuleCores
    const ruleCountByFamily = Object.create(null)
    const continuationRuleCountByFamily = Object.create(null)
    for (const rule of collectedRules) {
      const familyId = String(rule?.familyId ?? "").trim() || "unclassified"
      ruleCountByFamily[familyId] = Number(ruleCountByFamily[familyId] ?? 0) + 1
      if (isPerfectPrototypeContinuationFamilyId(rule?.familyId)) {
        continuationRuleCountByFamily[familyId] =
          Number(continuationRuleCountByFamily[familyId] ?? 0) + 1
      }
    }
    rejectionSummary.finalSelectedRuleCount = collectedRules.length
    rejectionSummary.ruleCountByFamily = ruleCountByFamily
    rejectionSummary.continuationRuleCountByFamily = continuationRuleCountByFamily
    await writeJsonl(path.join(resolvedOutDir, "rejected_rules.jsonl"), rejectedRules)
    let finalized = null
    if (outputMode === "partial") {
      await ensureDir(resolvedOutDir)
      await writePerfectPrototypePartialRulesParquet({
        cwd,
        outDir: resolvedOutDir,
        rules: collectedRules,
      })
      await writeJson(path.join(resolvedOutDir, "negative_separation_report.json"), negativeSeparationReport)
      await writeJsonAtomic(path.join(resolvedOutDir, "summary.json"), {
        indexDir: resolvedIndexDir,
        outDir: resolvedOutDir,
        surfaceName: cfg.surfaceName,
        rows: rowCount,
        rules: collectedRules.length,
        exploredStates,
        partial: true,
        rootSeedStartIndex,
        rootSeedEndIndexExclusive:
          rootSeedEndIndexExclusive == null ? selectedSeedCount : Math.min(rootSeedEndIndexExclusive, selectedSeedCount),
        selectedSeedCount,
        dictionaryLoadMs,
        seedCacheHitRate: seedCacheStats.hitRate,
        tokenizer: {
          surface: tokenizerSpec?.surface ?? null,
          numericFeatureCount: Array.isArray(tokenizerSpec?.numericFeatures)
            ? tokenizerSpec.numericFeatures.length
            : 0,
          binCount: Number(tokenizerSpec?.options?.binCount ?? 0),
        },
        rejectionSummary,
        selectorReport,
        negativeSeparationReport,
        boundPruneCount,
        stateDominancePruneCount,
        initialKthHitFloor,
        externalKthHitFloor,
        externalKthHitFloorRevision,
        externalKthHitFloorPollCount,
        externalKthHitFloorAppliedCount,
        externalAllocatedMaxSearchStates,
        externalBudgetRevision,
        externalBudgetPollCount,
        externalBudgetAppliedCount,
        externalBudgetDecreaseAppliedCount,
        externalBudgetDecreaseSearchStates,
        externalBudgetAllowanceAppliedCount,
        externalBudgetAllowanceSeenCount,
        externalBudgetAllowanceConsumedCount,
        externalBudgetRequestCount,
        externalBudgetRequestSatisfiedCount,
        externalBudgetRequestDeniedCount,
        externalBudgetRequestPendingCount,
        externalBudgetRequestWaitMs: externalBudgetRequestWaitMsTotal,
        externalBudgetPendingWaitMs: externalBudgetPendingWaitMsTotal,
        externalBudgetCommitRequestCount,
        externalBudgetCommitRevision,
        externalBudgetLastDecision,
        effectiveKthHitFloor: getCurrentKthHitFloor(),
        effectiveAllocatedMaxSearchStates: getEffectiveAllocatedMaxSearchStates(),
        livePartialRuleRevision,
        livePartialRuleCount,
        livePartialRuleCheckpointCount,
        livePartialRuleWriteMs,
        livePartialLocalKthHitFloor: topKHitTracker.getKthHitFloor(),
        livePartialBootstrapSnapshotCount,
        livePartialBootstrapRuleCount,
        livePartialBootstrapModeActive:
          livePartialBootstrapSnapshotCount > 0 ? 1 : 0,
        configuredMaxSearchStates,
        baseAllocatedMaxSearchStates,
        guardBandAllocatedSearchStates,
        allocatedMaxSearchStates,
        remainingGlobalSearchBudgetAtLaunch,
        budgetStopCount,
        budgetStopExploredStates,
        budgetStopReason,
        kthHitFloor: getCurrentKthHitFloor(),
        childOrderingMs,
        orderingNegativeLoads,
        seedPostingCacheEntryLimit,
        seedPositiveLoadCount,
        seedNegativeLoadCount,
        seedPostingLoadMs,
        candidateDescriptorBuildMs,
        negativeCountResolutionMs,
        childRowsetMaterializeMs,
        currentSearchDepth,
        maxSearchDepth,
        candidateDescriptorCount,
        acceptedCandidateCount,
        candidateEfficiency: safeRate(acceptedCandidateCount, Math.max(1, candidateDescriptorCount)),
        searchProgressRevision,
        rowsetModeStats,
        rowsetIntersectionMs: getLiveRowsetIntersectionTelemetry().rowsetIntersectionMs,
        ...buildMemoLookupTelemetry(searchStateStats),
        ...buildContributionTelemetry(),
        sourceManifestPath: manifestPath,
        sourceSummaryPath: summaryPath,
      })
    } else {
      finalized = await finalizePerfectPrototypeIndexedRuleSet({
        resolvedIndexDir,
        resolvedOutDir,
        tokenizerSpec,
        manifestPath,
        summaryPath,
        manifest,
        summary,
        cfg,
        collectedRules,
        rejectedRules,
        rejectionSummary,
        selectorReport,
        contributionTelemetry: buildContributionTelemetry(),
        negativeSeparationReport,
        exploredStates,
        rowMeta,
      })
      await writeJson(path.join(resolvedOutDir, "negative_separation_report.json"), negativeSeparationReport)
    }

    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "completed",
          rowsScanned: rowCount,
          rowsTokenized: rowCount,
          tokensIndexed: manifest?.tokenPostingCount ?? 0,
          seedTokensSelected: selectedSeedCount,
          exploredStates,
          rulesCollected: collectedRules.length,
          subgroupCandidateCount:
            rejectionSummary.subgroupCandidateCount ?? 0,
          subgroupQualifiedCandidateCount:
            rejectionSummary.subgroupQualifiedCandidateCount ?? 0,
          subgroupEffectiveRootSeedCount:
            rejectionSummary.subgroupEffectiveRootSeedCount ?? 0,
          seedCacheHitRate: seedCacheStats.hitRate,
          dictionaryLoadMs,
          boundPruneCount,
          stateDominancePruneCount,
          initialKthHitFloor,
          externalKthHitFloor,
          externalKthHitFloorRevision,
          externalKthHitFloorPollCount,
          externalKthHitFloorAppliedCount,
          externalAllocatedMaxSearchStates,
          externalBudgetRevision,
          externalBudgetPollCount,
          externalBudgetAppliedCount,
          externalBudgetDecreaseAppliedCount,
          externalBudgetDecreaseSearchStates,
          externalBudgetAllowanceAppliedCount,
          externalBudgetAllowanceSeenCount,
          externalBudgetAllowanceConsumedCount,
          externalBudgetRequestCount,
          externalBudgetRequestSatisfiedCount,
          externalBudgetRequestDeniedCount,
          externalBudgetRequestPendingCount,
          externalBudgetRequestWaitMs: externalBudgetRequestWaitMsTotal,
          externalBudgetPendingWaitMs: externalBudgetPendingWaitMsTotal,
          externalBudgetCommitRequestCount,
          externalBudgetCommitRevision,
          externalBudgetLastDecision,
          effectiveKthHitFloor: getCurrentKthHitFloor(),
          effectiveAllocatedMaxSearchStates: getEffectiveAllocatedMaxSearchStates(),
          livePartialRuleRevision,
          livePartialRuleCount,
          livePartialRuleCheckpointCount,
          livePartialRuleWriteMs,
          livePartialLocalKthHitFloor: topKHitTracker.getKthHitFloor(),
          configuredMaxSearchStates,
          baseAllocatedMaxSearchStates,
          guardBandAllocatedSearchStates,
          allocatedMaxSearchStates,
          remainingGlobalSearchBudgetAtLaunch,
          budgetStopCount,
          budgetStopExploredStates,
          budgetStopReason,
          kthHitFloor: getCurrentKthHitFloor(),
          childOrderingMs,
          orderingNegativeLoads,
          seedPostingCacheEntryLimit,
          seedPositiveLoadCount,
          seedNegativeLoadCount,
          seedPostingLoadMs,
          candidateDescriptorBuildMs,
          negativeCountResolutionMs,
          childRowsetMaterializeMs,
          currentSearchDepth,
          maxSearchDepth,
          candidateDescriptorCount,
          acceptedCandidateCount,
          candidateEfficiency: safeRate(acceptedCandidateCount, Math.max(1, candidateDescriptorCount)),
          promotableUpperBoundPruneCount:
            rejectionSummary.promotableUpperBoundPruneCount ?? 0,
          seedPromotableUpperBoundPruneCount:
            rejectionSummary.seedPromotableUpperBoundPruneCount ?? 0,
          statePromotableUpperBoundPruneCount:
            rejectionSummary.statePromotableUpperBoundPruneCount ?? 0,
          candidatePromotableUpperBoundPruneCount:
            rejectionSummary.candidatePromotableUpperBoundPruneCount ?? 0,
          yearHitUpperBoundPruneCount:
            rejectionSummary.yearHitUpperBoundPruneCount ?? 0,
          seedYearHitUpperBoundPruneCount:
            rejectionSummary.seedYearHitUpperBoundPruneCount ?? 0,
          stateYearHitUpperBoundPruneCount:
            rejectionSummary.stateYearHitUpperBoundPruneCount ?? 0,
          candidateYearHitUpperBoundPruneCount:
            rejectionSummary.candidateYearHitUpperBoundPruneCount ?? 0,
          searchProgressRevision,
          rowsetModeStats,
          rowsetIntersectionMs: getLiveRowsetIntersectionTelemetry().rowsetIntersectionMs,
          ...buildMemoLookupTelemetry(searchStateStats),
          ...buildLiveExactSearchTelemetry(),
        },
        startedAtMs: miningStartedAt,
        estimatedRows: rowCount,
        estimatedTokens: Number(manifest?.tokenPostingCount ?? 0) || null,
        estimatedStates: getEffectiveAllocatedMaxSearchStates(),
      }),
    )

    return {
      catalog: finalized?.catalog ?? null,
      rules: collectedRules,
      matches: finalized?.matchRows ?? [],
      dedupedMatches: finalized?.dedupedMatches ?? [],
      overlapRows: finalized?.overlapRows ?? [],
      coverage: finalized?.coverage ?? null,
      exploredStates,
      rejectionSummary,
      negativeSeparationReport,
      rejectedRules,
      datasetRows: finalized?.datasetRows ?? [],
      tokenizerSpec,
    }
  } finally {
    if (!workerSession) {
      await postingsHandle?.close().catch(() => {})
    }
  }
}
