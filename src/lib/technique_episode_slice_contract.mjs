import path from "node:path"

import { readJson } from "./io.mjs"
import { ensureDateKey, toFiniteNumber, toText, uniqueSortedIntegers } from "./technique_common.mjs"

export const TECHNIQUE_EPISODE_SLICE_CONTRACT_KIND = "technique_episode_slice_contract_v1"
export const DEFAULT_TECHNIQUE_EPISODE_SLICE_CONTRACT_PATH = "meta/technique_episode_slice_contract.json"

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

const assertNonNegativeFinite = (value, label) => {
  const numeric = toFiniteNumber(value)
  if (numeric === null || numeric < 0) {
    throw new Error(`${label} must be a finite number >= 0: ${value ?? "<null>"}`)
  }
  return numeric
}

const validateDistanceMetric = (value) => {
  const text = toText(value) || "weighted_jaccard"
  if (![
    "weighted_jaccard",
    "consensus_jaccard",
  ].includes(text)) {
    throw new Error(`Unsupported technique episode slice distanceMetric=${text}`)
  }
  return text
}

export const loadTechniqueEpisodeSliceContract = async ({
  contractPath = DEFAULT_TECHNIQUE_EPISODE_SLICE_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TECHNIQUE_EPISODE_SLICE_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing technique episode slice contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TECHNIQUE_EPISODE_SLICE_CONTRACT_KIND) {
    throw new Error(`Unsupported technique episode slice contract kind=${kind}`)
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
  const controlCurrentAtomWeight = assertNonNegativeFinite(raw.controlCurrentAtomWeight ?? 1, "controlCurrentAtomWeight")
  const controlEpisodeAtomWeight = assertNonNegativeFinite(raw.controlEpisodeAtomWeight ?? 0.25, "controlEpisodeAtomWeight")
  if (controlCurrentAtomWeight + controlEpisodeAtomWeight <= 0) {
    throw new Error("controlCurrentAtomWeight + controlEpisodeAtomWeight must be > 0")
  }
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    contractPath: resolvedContractPath,
    labelId: assertNonEmpty(raw.labelId, "contract.labelId"),
    coreYears,
    trainRange,
    controlRequireSamePartition: assertBoolean(raw.controlRequireSamePartition ?? true, "controlRequireSamePartition"),
    controlRequireSameYear: assertBoolean(raw.controlRequireSameYear ?? true, "controlRequireSameYear"),
    maxMatchedControlsPerPositive: assertPositiveInteger(raw.maxMatchedControlsPerPositive ?? 3, "maxMatchedControlsPerPositive"),
    controlMinCurrentAtomJaccard: assertUnitRatio(raw.controlMinCurrentAtomJaccard ?? 0.2, "controlMinCurrentAtomJaccard"),
    controlMinEpisodeAtomJaccard: assertUnitRatio(raw.controlMinEpisodeAtomJaccard ?? 0.1, "controlMinEpisodeAtomJaccard"),
    controlMinSharedCurrentAtoms: assertPositiveInteger(raw.controlMinSharedCurrentAtoms ?? 2, "controlMinSharedCurrentAtoms", { allowZero: true }),
    controlMinSharedEpisodeAtoms: assertPositiveInteger(raw.controlMinSharedEpisodeAtoms ?? 2, "controlMinSharedEpisodeAtoms", { allowZero: true }),
    controlCurrentAtomWeight,
    controlEpisodeAtomWeight,
    controlDistanceMetric: validateDistanceMetric(raw.controlDistanceMetric),
    minPositiveSupportPerYear: assertPositiveInteger(raw.minPositiveSupportPerYear ?? 2, "minPositiveSupportPerYear"),
    maxSliceAtoms: assertPositiveInteger(raw.maxSliceAtoms ?? 3, "maxSliceAtoms"),
    topDeltaAtomsToConsider: assertPositiveInteger(raw.topDeltaAtomsToConsider ?? 24, "topDeltaAtomsToConsider"),
    maxSliceContracts: assertPositiveInteger(raw.maxSliceContracts ?? 10, "maxSliceContracts"),
    recheckTopSlices: assertPositiveInteger(raw.recheckTopSlices ?? 5, "recheckTopSlices"),
  }
}
