import path from "node:path"

import { readJson } from "./io.mjs"
import { ensureDateKey, toText, uniqueSortedIntegers } from "./technique_common.mjs"
import { DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH } from "./technique_pattern_discovery_contract.mjs"

export const TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_KIND = "technique_episode_substrate_contract_v1"
export const DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH = "meta/technique_episode_substrate_contract.json"

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) throw new Error(`${label} is required`)
  return text
}

const assertPositiveInteger = (value, label, { allowZero = false } = {}) => {
  const numeric = Math.floor(Number(value))
  const min = allowZero ? 0 : 1
  if (!Number.isInteger(numeric) || numeric < min) {
    throw new Error(`${label} must be an integer >= ${min}: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertBoolean = (value, label) => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean: ${value ?? "<null>"}`)
  }
  return value
}

const assertUnitRatio = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error(`${label} must be a finite number in [0, 1]: ${value ?? "<null>"}`)
  }
  return numeric
}

const validateAllowedAtomPrefixes = (values) => {
  const safe = Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean)))
  if (safe.length < 1) {
    throw new Error("allowedAtomPrefixes must contain at least one prefix")
  }
  return safe.sort((left, right) => left.localeCompare(right))
}

const validateSearchMode = (value) => {
  const text = toText(value) || "global"
  if (!["global", "partitioned"].includes(text)) {
    throw new Error(`Unsupported searchMode=${text}`)
  }
  return text
}

const validateNegativeSupervisionMode = (value) => {
  const text = toText(value) || "all"
  if (!["all", "near_miss_current_overlap", "matched_control_purity_slice"].includes(text)) {
    throw new Error(`Unsupported negativeSupervisionMode=${text}`)
  }
  return text
}

const validateMatchedControlDistanceMetric = (value) => {
  const text = toText(value) || "consensus_jaccard"
  if (!["consensus_jaccard"].includes(text)) {
    throw new Error(`Unsupported matchedControlDistanceMetric=${text}`)
  }
  return text
}

export const loadTechniqueEpisodeSubstrateContract = async ({
  contractPath = DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing technique episode substrate contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_KIND) {
    throw new Error(`Unsupported technique episode substrate contract kind=${kind}`)
  }
  const coreYears = uniqueSortedIntegers(raw.coreYears)
  if (coreYears.length < 1) throw new Error("coreYears is required")
  const trainRange = {
    startDateKey: ensureDateKey(raw?.trainRange?.startDateKey, "trainRange.startDateKey"),
    endDateKey: ensureDateKey(raw?.trainRange?.endDateKey, "trainRange.endDateKey"),
  }
  if (trainRange.startDateKey > trainRange.endDateKey) {
    throw new Error("trainRange.startDateKey must be <= trainRange.endDateKey")
  }
  const searchMode = validateSearchMode(raw.searchMode)
  const partitionField = searchMode === "partitioned" ? assertNonEmpty(raw.partitionField, "partitionField") : toText(raw.partitionField) || "partitionKey"
  const negativeSupervisionMode = validateNegativeSupervisionMode(raw.negativeSupervisionMode)
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    contractPath: resolvedContractPath,
    labelId: assertNonEmpty(raw.labelId, "contract.labelId"),
    structuralContractPath: path.resolve(cwd, toText(raw.structuralContractPath) || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH),
    coreYears,
    trainRange,
    minPositiveEpisodeSupportPerYear: assertPositiveInteger(raw.minPositiveEpisodeSupportPerYear, "minPositiveEpisodeSupportPerYear"),
    lookbackSteps: assertPositiveInteger(raw.lookbackSteps, "lookbackSteps"),
    maxAtomsPerStep: assertPositiveInteger(raw.maxAtomsPerStep ?? 20, "maxAtomsPerStep"),
    maxTransitionAtomsPerStep: assertPositiveInteger(raw.maxTransitionAtomsPerStep ?? 12, "maxTransitionAtomsPerStep", { allowZero: true }),
    maxAtomsToConsider: assertPositiveInteger(raw.maxAtomsToConsider ?? 48, "maxAtomsToConsider"),
    maxCoreAtoms: assertPositiveInteger(raw.maxCoreAtoms ?? 2, "maxCoreAtoms"),
    maxCoreCandidates: assertPositiveInteger(raw.maxCoreCandidates ?? 2000, "maxCoreCandidates", { allowZero: true }),
    maxVetoAtoms: assertPositiveInteger(raw.maxVetoAtoms ?? 2, "maxVetoAtoms"),
    maxVetoCandidatesPerCore: assertPositiveInteger(raw.maxVetoCandidatesPerCore ?? 12, "maxVetoCandidatesPerCore", { allowZero: true }),
    maxPartitionsToSearch: assertPositiveInteger(raw.maxPartitionsToSearch ?? 0, "maxPartitionsToSearch", { allowZero: true }),
    allowFamilyTransitions: assertBoolean(raw.allowFamilyTransitions ?? true, "allowFamilyTransitions"),
    allowedAtomPrefixes: validateAllowedAtomPrefixes(raw.allowedAtomPrefixes),
    searchMode,
    partitionField,
    negativeSupervisionMode,
    nearMissPositiveConsensusMinShare: assertUnitRatio(raw.nearMissPositiveConsensusMinShare ?? 0.5, "nearMissPositiveConsensusMinShare"),
    nearMissMinCurrentAtomOverlapRatio: assertUnitRatio(raw.nearMissMinCurrentAtomOverlapRatio ?? 0.5, "nearMissMinCurrentAtomOverlapRatio"),
    nearMissMinSharedCurrentAtoms: assertPositiveInteger(raw.nearMissMinSharedCurrentAtoms ?? 3, "nearMissMinSharedCurrentAtoms", { allowZero: true }),
    matchedControlPositiveConsensusMinShare: assertUnitRatio(
      raw.matchedControlPositiveConsensusMinShare ?? raw.nearMissPositiveConsensusMinShare ?? 0.5,
      "matchedControlPositiveConsensusMinShare",
    ),
    matchedControlMinCurrentAtomOverlapRatio: assertUnitRatio(
      raw.matchedControlMinCurrentAtomOverlapRatio ?? raw.nearMissMinCurrentAtomOverlapRatio ?? 0.5,
      "matchedControlMinCurrentAtomOverlapRatio",
    ),
    matchedControlMinSharedCurrentAtoms: assertPositiveInteger(
      raw.matchedControlMinSharedCurrentAtoms ?? raw.nearMissMinSharedCurrentAtoms ?? 3,
      "matchedControlMinSharedCurrentAtoms",
      { allowZero: true },
    ),
    matchedControlMaxControlsPerCore: assertPositiveInteger(
      raw.matchedControlMaxControlsPerCore ?? 128,
      "matchedControlMaxControlsPerCore",
      { allowZero: true },
    ),
    matchedControlDistanceMetric: validateMatchedControlDistanceMetric(raw.matchedControlDistanceMetric),
    matchedControlRequireSameYearBand: assertBoolean(
      raw.matchedControlRequireSameYearBand ?? true,
      "matchedControlRequireSameYearBand",
    ),
    requireNearMissNegatives: assertBoolean(raw.requireNearMissNegatives ?? true, "requireNearMissNegatives"),
  }
}
