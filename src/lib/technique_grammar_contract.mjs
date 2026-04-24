import path from "node:path"

import { readJson } from "./io.mjs"
import {
  DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  loadTp12NoStopLookbackLadderContract,
  normalizeTp12NoStopLookbackCandidateId,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import { listTp12NoStopScopeIds, resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"
import { uniqueSortedIntegers, uniqueSortedStrings, uniqueStringsPreserveOrder, toFiniteNumber, toText } from "./technique_common.mjs"

export const TECHNIQUE_GRAMMAR_CONTRACT_KIND = "technique_grammar_contract_v1"
export const DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH = "meta/technique_grammar_contract.json"
export const TECHNIQUE_SEED_TEMPLATES_KIND = "technique_seed_templates_v1"
export const DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH = "meta/technique_seed_templates.json"

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertPositiveInteger = (value, label) => {
  const numeric = Math.floor(Number(value))
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertFiniteNumber = (value, label) => {
  const numeric = toFiniteNumber(value)
  if (numeric === null) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const normalizeYearHitMetric = (value, label) => {
  const metric = toText(value || "hit_rows").toLowerCase()
  if (metric !== "hit_rows" && metric !== "unique_decision_dates") {
    throw new Error(`${label} must be one of: hit_rows, unique_decision_dates`)
  }
  return metric
}

const validateScopeIds = (scopeIds = [], label) => {
  const normalized = uniqueSortedStrings(scopeIds).map((scopeId) => resolveTp12NoStopScopeSpec(scopeId)?.scopeId ?? null)
  if (normalized.some((scopeId) => !scopeId)) {
    throw new Error(`${label} must use known scope ids: ${listTp12NoStopScopeIds().join(", ")}`)
  }
  if (normalized.length < 1) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

const validateLookbackCandidateIds = ({ candidateIds = [], ladderContract, label } = {}) => {
  const safeCandidates = Array.isArray(ladderContract?.lookbackCandidates) ? ladderContract.lookbackCandidates : []
  const known = new Map(
    safeCandidates.map((candidate) => [
      normalizeTp12NoStopLookbackCandidateId(candidate.candidateId),
      candidate,
    ]),
  )
  const resolved = uniqueSortedStrings(candidateIds).map((candidateId) => {
    const candidate = known.get(normalizeTp12NoStopLookbackCandidateId(candidateId))
    if (!candidate) {
      throw new Error(`${label} references unknown lookback candidateId=${candidateId}`)
    }
    return candidate.candidateId
  })
  if (resolved.length < 1) {
    throw new Error(`${label} is required`)
  }
  return resolved
}

const validateClauseShape = (rawShape = {}) => {
  const groups = {}
  for (const groupId of ["anchor", "retest", "compression", "confirm", "invalidate"]) {
    const min = Math.max(0, Math.floor(Number(rawShape?.[groupId]?.min ?? 0)))
    const max = Math.max(min, Math.floor(Number(rawShape?.[groupId]?.max ?? min)))
    groups[groupId] = { min, max }
  }
  if (groups.anchor.min !== 1 || groups.anchor.max !== 1) {
    throw new Error("clauseShape.anchor must remain exactly 1")
  }
  return groups
}

export const loadTechniqueGrammarContract = async ({
  contractPath = DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing technique grammar contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TECHNIQUE_GRAMMAR_CONTRACT_KIND) {
    throw new Error(`Unsupported technique grammar contract kind=${kind}`)
  }
  const baseLookbackLadderContract = await loadTp12NoStopLookbackLadderContract({
    contractPath:
      toText(raw.baseLookbackLadderContractPath) || DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
    cwd,
  })
  const coreYears = uniqueSortedIntegers(raw.coreYears)
  const excludedBoundaryYears = uniqueSortedIntegers(raw.excludedBoundaryYears)
  if (coreYears.length < 1) {
    throw new Error("coreYears is required")
  }
  if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
    throw new Error("excludedBoundaryYears must not overlap coreYears")
  }
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    fixedResearchContractPath: toText(raw.fixedResearchContractPath)
      ? path.resolve(cwd, toText(raw.fixedResearchContractPath))
      : null,
    labelId: assertNonEmpty(raw.labelId ?? "tp12_no_stop_hit_3d", "contract.labelId"),
    yearHitMetric: normalizeYearHitMetric(raw?.yearHitMetric, "contract.yearHitMetric"),
    baseLookbackLadderContractPath: baseLookbackLadderContract.contractPath,
    baseLookbackLadderContract,
    coreYears,
    excludedBoundaryYears,
    allowedScopeIds: validateScopeIds(raw.allowedScopeIds, "allowedScopeIds"),
    allowedLookbackCandidateIds: validateLookbackCandidateIds({
      candidateIds: raw.allowedLookbackCandidateIds,
      ladderContract: baseLookbackLadderContract,
      label: "allowedLookbackCandidateIds",
    }),
    clauseShape: validateClauseShape(raw.clauseShape),
    generation: {
      minTotalClauses: assertPositiveInteger(raw?.generation?.minTotalClauses, "generation.minTotalClauses"),
      maxGeneratedCandidatesPerSeed: assertPositiveInteger(
        raw?.generation?.maxGeneratedCandidatesPerSeed,
        "generation.maxGeneratedCandidatesPerSeed",
      ),
    },
    recurrence: {
      discoveryMinYearsWithHitGe2: assertPositiveInteger(
        raw?.recurrence?.discoveryMinYearsWithHitGe2,
        "recurrence.discoveryMinYearsWithHitGe2",
      ),
      discoveryAltMinYearsWithHitGe1: assertPositiveInteger(
        raw?.recurrence?.discoveryAltMinYearsWithHitGe1,
        "recurrence.discoveryAltMinYearsWithHitGe1",
      ),
      promotionMinYearsWithHitGe2: assertPositiveInteger(
        raw?.recurrence?.promotionMinYearsWithHitGe2,
        "recurrence.promotionMinYearsWithHitGe2",
      ),
      promotionMinCoveredYears: assertPositiveInteger(
        raw?.recurrence?.promotionMinCoveredYears,
        "recurrence.promotionMinCoveredYears",
      ),
      minSignalsPer20TradingDays: assertFiniteNumber(
        raw?.recurrence?.minSignalsPer20TradingDays,
        "recurrence.minSignalsPer20TradingDays",
      ),
      maxYearShare: assertFiniteNumber(raw?.recurrence?.maxYearShare, "recurrence.maxYearShare"),
      minYearEventCount: assertPositiveInteger(raw?.recurrence?.minYearEventCount, "recurrence.minYearEventCount"),
    },
    bankDiscovery: {
      screenMaxSearchStates: assertPositiveInteger(
        raw?.bankDiscovery?.screenMaxSearchStates,
        "bankDiscovery.screenMaxSearchStates",
      ),
      minUsableWindows: assertPositiveInteger(raw?.bankDiscovery?.minUsableWindows, "bankDiscovery.minUsableWindows"),
      minRollingOosHitRate: assertFiniteNumber(
        raw?.bankDiscovery?.minRollingOosHitRate,
        "bankDiscovery.minRollingOosHitRate",
      ),
      minOosYearsWithHitGe2: assertPositiveInteger(
        raw?.bankDiscovery?.minOosYearsWithHitGe2,
        "bankDiscovery.minOosYearsWithHitGe2",
      ),
      minSignalsPer20TradingDays: assertFiniteNumber(
        raw?.bankDiscovery?.minSignalsPer20TradingDays,
        "bankDiscovery.minSignalsPer20TradingDays",
      ),
      maxTop1DateShare: assertFiniteNumber(raw?.bankDiscovery?.maxTop1DateShare, "bankDiscovery.maxTop1DateShare"),
    },
    templateScreen: {
      screenMaxSearchStates: assertPositiveInteger(
        raw?.templateScreen?.screenMaxSearchStates,
        "templateScreen.screenMaxSearchStates",
      ),
      minUsableWindows: assertPositiveInteger(
        raw?.templateScreen?.minUsableWindows,
        "templateScreen.minUsableWindows",
      ),
      minRollingOosHitRate: assertFiniteNumber(
        raw?.templateScreen?.minRollingOosHitRate,
        "templateScreen.minRollingOosHitRate",
      ),
      minOosYearsWithHitGe2: assertPositiveInteger(
        raw?.templateScreen?.minOosYearsWithHitGe2,
        "templateScreen.minOosYearsWithHitGe2",
      ),
      minSignalsPer20TradingDays: assertFiniteNumber(
        raw?.templateScreen?.minSignalsPer20TradingDays,
        "templateScreen.minSignalsPer20TradingDays",
      ),
      maxSignalsPer20TradingDays: assertFiniteNumber(
        raw?.templateScreen?.maxSignalsPer20TradingDays,
        "templateScreen.maxSignalsPer20TradingDays",
      ),
      maxTop1DateShare: assertFiniteNumber(
        raw?.templateScreen?.maxTop1DateShare,
        "templateScreen.maxTop1DateShare",
      ),
    },
    yearConsensus: {
      minConsensusYearsPresent: assertPositiveInteger(
        raw?.yearConsensus?.minConsensusYearsPresent,
        "yearConsensus.minConsensusYearsPresent",
      ),
      minConsensusYearsWithHitGe1: assertPositiveInteger(
        raw?.yearConsensus?.minConsensusYearsWithHitGe1,
        "yearConsensus.minConsensusYearsWithHitGe1",
      ),
      minConsensusYearsWithZeroNegative: assertPositiveInteger(
        raw?.yearConsensus?.minConsensusYearsWithZeroNegative,
        "yearConsensus.minConsensusYearsWithZeroNegative",
      ),
      minAggregateOosHitRate: assertFiniteNumber(
        raw?.yearConsensus?.minAggregateOosHitRate,
        "yearConsensus.minAggregateOosHitRate",
      ),
      minAggregateOosHitCount: assertPositiveInteger(
        raw?.yearConsensus?.minAggregateOosHitCount,
        "yearConsensus.minAggregateOosHitCount",
      ),
      minAggregateOosMatchedDateCount: assertPositiveInteger(
        raw?.yearConsensus?.minAggregateOosMatchedDateCount,
        "yearConsensus.minAggregateOosMatchedDateCount",
      ),
      maxRuleSize: assertPositiveInteger(
        raw?.yearConsensus?.maxRuleSize,
        "yearConsensus.maxRuleSize",
      ),
    },
    shortlist: {
      minPromotionHitRate: assertFiniteNumber(
        raw?.shortlist?.minPromotionHitRate,
        "shortlist.minPromotionHitRate",
      ),
      minSignalsPer20TradingDays: assertFiniteNumber(
        raw?.shortlist?.minSignalsPer20TradingDays,
        "shortlist.minSignalsPer20TradingDays",
      ),
      maxSignalsPer20TradingDays: assertFiniteNumber(
        raw?.shortlist?.maxSignalsPer20TradingDays,
        "shortlist.maxSignalsPer20TradingDays",
      ),
      targetSignalsPer20TradingDays: assertFiniteNumber(
        raw?.shortlist?.targetSignalsPer20TradingDays,
        "shortlist.targetSignalsPer20TradingDays",
      ),
      maxTemplatesPerMechanism: assertPositiveInteger(
        raw?.shortlist?.maxTemplatesPerMechanism,
        "shortlist.maxTemplatesPerMechanism",
      ),
      maxTemplatesTotal: assertPositiveInteger(
        raw?.shortlist?.maxTemplatesTotal,
        "shortlist.maxTemplatesTotal",
      ),
    },
    promotion: {
      finalMinOosHitRate: assertFiniteNumber(raw?.promotion?.finalMinOosHitRate, "promotion.finalMinOosHitRate"),
      finalMinSelectedRows: assertPositiveInteger(raw?.promotion?.finalMinSelectedRows, "promotion.finalMinSelectedRows"),
      finalSignalsPer20TradingDaysMin: assertFiniteNumber(
        raw?.promotion?.finalSignalsPer20TradingDaysMin,
        "promotion.finalSignalsPer20TradingDaysMin",
      ),
      finalSignalsPer20TradingDaysMax: assertFiniteNumber(
        raw?.promotion?.finalSignalsPer20TradingDaysMax,
        "promotion.finalSignalsPer20TradingDaysMax",
      ),
    },
    hardStops: uniqueSortedStrings(raw.hardStops),
    notes: uniqueSortedStrings(raw.notes),
  }
}

export const loadTechniqueSeedTemplates = async ({
  templatesPath = DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
  techniqueContract = null,
  cwd = process.cwd(),
} = {}) => {
  const resolvedTemplatesPath = path.resolve(cwd, toText(templatesPath) || DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH)
  const raw = await readJson(resolvedTemplatesPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing technique seed templates: ${resolvedTemplatesPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "seedTemplates.kind")
  if (kind !== TECHNIQUE_SEED_TEMPLATES_KIND) {
    throw new Error(`Unsupported technique seed template kind=${kind}`)
  }
  const contract =
    techniqueContract ??
    (await loadTechniqueGrammarContract({
      cwd,
    }))
  const seeds = (Array.isArray(raw.seeds) ? raw.seeds : []).map((seed, index) => {
    const seedId = assertNonEmpty(seed?.seedId, `seed[${index}].seedId`)
    const mechanismId = assertNonEmpty(seed?.mechanismId, `seed[${index}].mechanismId`)
    const scopeCandidates = validateScopeIds(
      seed?.scopeCandidates?.length ? seed.scopeCandidates : contract.allowedScopeIds,
      `seed[${index}].scopeCandidates`,
    )
    const lookbackCandidateIds = validateLookbackCandidateIds({
      candidateIds:
        seed?.lookbackCandidateIds?.length ? seed.lookbackCandidateIds : contract.allowedLookbackCandidateIds,
      ladderContract: contract.baseLookbackLadderContract,
      label: `seed[${index}].lookbackCandidateIds`,
    })
    return {
      seedId,
      label: toText(seed?.label) || seedId,
      mechanismId,
      anchorClauseIds: uniqueStringsPreserveOrder(seed?.anchorClauseIds),
      retestClauseIds: uniqueStringsPreserveOrder(seed?.retestClauseIds),
      compressionClauseIds: uniqueStringsPreserveOrder(seed?.compressionClauseIds),
      confirmClauseIds: uniqueStringsPreserveOrder(seed?.confirmClauseIds),
      invalidateClauseIds: uniqueStringsPreserveOrder(seed?.invalidateClauseIds),
      scopeCandidates,
      lookbackCandidateIds,
    }
  })
  if (seeds.length < 1) {
    throw new Error("seedTemplates.seeds is required")
  }
  return {
    kind,
    templateSetId: assertNonEmpty(raw.templateSetId, "seedTemplates.templateSetId"),
    templatesPath: resolvedTemplatesPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "seedTemplates.updatedAt"),
    seeds,
    notes: uniqueSortedStrings(raw.notes),
  }
}

export const selectTechniqueSeedTemplates = ({
  seedTemplates,
  seedIds = [],
} = {}) => {
  if (!seedTemplates || typeof seedTemplates !== "object") {
    throw new Error("seedTemplates is required")
  }
  const requestedSeedIds = uniqueSortedStrings(seedIds)
  if (requestedSeedIds.length < 1) {
    return seedTemplates
  }
  const knownSeedIds = new Map(
    (Array.isArray(seedTemplates.seeds) ? seedTemplates.seeds : []).map((seed) => [seed.seedId, seed]),
  )
  const missing = requestedSeedIds.filter((seedId) => !knownSeedIds.has(seedId))
  if (missing.length > 0) {
    throw new Error(`Unknown technique seedIds: ${missing.join(", ")}`)
  }
  const seeds = requestedSeedIds.map((seedId) => knownSeedIds.get(seedId))
  if (seeds.length < 1) {
    throw new Error("Requested technique seedIds resolved to zero seeds")
  }
  return {
    ...seedTemplates,
    seeds,
  }
}
