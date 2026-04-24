import path from "node:path"

import { readJson } from "./io.mjs"
import { ensureDateKey, toFiniteNumber, toText, uniqueSortedIntegers } from "./technique_common.mjs"

export const TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND = "technique_pattern_discovery_contract_v4"
export const LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND_V3 = "technique_pattern_discovery_contract_v3"
export const LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND_V2 = "technique_pattern_discovery_contract_v2"
export const LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND = "technique_pattern_discovery_contract_v1"
export const DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH = "meta/technique_pattern_discovery_contract.json"

const ATOM_FAMILY_IDS = [
  "movingAverage",
  "candles",
  "closeLocation",
  "gap",
  "liquidity",
  "trend",
  "failure",
  "intraday",
]

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

const validateFiniteNumberArray = (values, label) => {
  const safe = (Array.isArray(values) ? values : []).map((value) => toFiniteNumber(value))
  if (safe.length < 1 || safe.some((value) => value === null)) {
    throw new Error(`${label} must be a non-empty finite-number array`)
  }
  for (let index = 1; index < safe.length; index += 1) {
    if (Number(safe[index]) <= Number(safe[index - 1])) {
      throw new Error(`${label} must be strictly ascending`)
    }
  }
  return safe.map((value) => Number(value))
}

const validateClosureMode = (value) => {
  const mode = assertNonEmpty(value, "closureMode")
  if (mode !== "closed") {
    throw new Error(`Unsupported closureMode=${mode}`)
  }
  return mode
}

const validatePartitionMode = (value) => {
  const mode = assertNonEmpty(value, "partitionMode")
  if (
    mode !== "scope_lookback" &&
    mode !== "scope_lookback_regime_shape_liquidity_anchor_age" &&
    mode !== "scope_lookback_regime_shape_liquidity"
  ) {
    throw new Error(`Unsupported partitionMode=${mode}`)
  }
  return mode
}

const validateAtomFamilies = (raw = {}) => {
  const out = {}
  for (const familyId of ATOM_FAMILY_IDS) {
    out[familyId] = assertBoolean(raw?.[familyId], `atomFamilies.${familyId}`)
  }
  return out
}

const validateFamilyCaps = (raw = {}) => {
  const out = {}
  for (const familyId of ATOM_FAMILY_IDS) {
    out[familyId] = assertPositiveInteger(raw?.[familyId], `familyCaps.${familyId}`, { allowZero: true })
  }
  return out
}

export const loadTechniquePatternDiscoveryContract = async ({
  contractPath = DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing technique pattern discovery contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (
    kind !== TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND &&
    kind !== LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND_V3 &&
    kind !== LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND_V2 &&
    kind !== LEGACY_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_KIND
  ) {
    throw new Error(`Unsupported technique pattern discovery contract kind=${kind}`)
  }
  const coreYears = uniqueSortedIntegers(raw.coreYears)
  const excludedBoundaryYears = uniqueSortedIntegers(raw.excludedBoundaryYears)
  if (coreYears.length < 1) throw new Error("coreYears is required")
  if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
    throw new Error("excludedBoundaryYears must not overlap coreYears")
  }
  const trainRange = {
    startDateKey: ensureDateKey(raw?.trainRange?.startDateKey, "trainRange.startDateKey"),
    endDateKey: ensureDateKey(raw?.trainRange?.endDateKey, "trainRange.endDateKey"),
  }
  if (trainRange.startDateKey > trainRange.endDateKey) {
    throw new Error("trainRange.startDateKey must be <= trainRange.endDateKey")
  }
  const includeScopeAtoms = assertBoolean(raw.includeScopeAtoms, "includeScopeAtoms")
  const includeLookbackAtoms = assertBoolean(raw.includeLookbackAtoms, "includeLookbackAtoms")
  const contract = {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    labelId: assertNonEmpty(raw.labelId, "contract.labelId"),
    coreYears,
    excludedBoundaryYears,
    trainRange,
    minPositiveSupportPerYear: assertPositiveInteger(raw.minPositiveSupportPerYear, "minPositiveSupportPerYear"),
    maxPatternSize: assertPositiveInteger(raw.maxPatternSize, "maxPatternSize"),
    closureMode: validateClosureMode(raw.closureMode),
    partitionMode: validatePartitionMode(raw.partitionMode ?? "scope_lookback"),
    embedScopeAtomsInPattern: assertBoolean(raw.embedScopeAtomsInPattern ?? includeScopeAtoms, "embedScopeAtomsInPattern"),
    embedLookbackAtomsInPattern: assertBoolean(raw.embedLookbackAtomsInPattern ?? includeLookbackAtoms, "embedLookbackAtomsInPattern"),
    includeScopeAtoms,
    includeLookbackAtoms,
    includeIntradayAtoms: assertBoolean(raw.includeIntradayAtoms, "includeIntradayAtoms"),
    enablePairAdmissibility: assertBoolean(raw.enablePairAdmissibility ?? true, "enablePairAdmissibility"),
    enableClosureFirstPreverify: assertBoolean(raw.enableClosureFirstPreverify ?? false, "enableClosureFirstPreverify"),
    enableContrastiveVetoSearch: assertBoolean(raw.enableContrastiveVetoSearch ?? false, "enableContrastiveVetoSearch"),
    enableAliasAtoms: assertBoolean(raw.enableAliasAtoms ?? true, "enableAliasAtoms"),
    useSignedCrossStateAtoms: assertBoolean(raw.useSignedCrossStateAtoms ?? false, "useSignedCrossStateAtoms"),
    oneAtomPerBaseFeature: assertBoolean(raw.oneAtomPerBaseFeature ?? true, "oneAtomPerBaseFeature"),
    maxGeneratorsPerSignature: assertPositiveInteger(raw.maxGeneratorsPerSignature ?? 8, "maxGeneratorsPerSignature"),
    preverifyTopKPerSignature: assertPositiveInteger(raw.preverifyTopKPerSignature ?? 8, "preverifyTopKPerSignature"),
    vetoSearchTopPatternsPerPartition: assertPositiveInteger(raw.vetoSearchTopPatternsPerPartition ?? 64, "vetoSearchTopPatternsPerPartition"),
    maxVetoAtomCount: assertPositiveInteger(raw.maxVetoAtomCount ?? 2, "maxVetoAtomCount"),
    atomFamilies: validateAtomFamilies(raw.atomFamilies),
    familyCaps: validateFamilyCaps(raw.familyCaps ?? Object.fromEntries(ATOM_FAMILY_IDS.map((familyId) => [familyId, familyId === "intraday" ? 0 : 2]))),
    atomBinning: {
      distanceToMa: validateFiniteNumberArray(raw?.atomBinning?.distanceToMa, "atomBinning.distanceToMa"),
      daysSinceCross: validateFiniteNumberArray(raw?.atomBinning?.daysSinceCross, "atomBinning.daysSinceCross"),
      distanceTo52wHigh: validateFiniteNumberArray(raw?.atomBinning?.distanceTo52wHigh, "atomBinning.distanceTo52wHigh"),
      distanceToHigh20: validateFiniteNumberArray(raw?.atomBinning?.distanceToHigh20, "atomBinning.distanceToHigh20"),
      anchorMidDistance: validateFiniteNumberArray(raw?.atomBinning?.anchorMidDistance, "atomBinning.anchorMidDistance"),
      pullbackDepth: validateFiniteNumberArray(raw?.atomBinning?.pullbackDepth, "atomBinning.pullbackDepth"),
      bodyPct: validateFiniteNumberArray(raw?.atomBinning?.bodyPct, "atomBinning.bodyPct"),
      bodySignedPct: validateFiniteNumberArray(raw?.atomBinning?.bodySignedPct, "atomBinning.bodySignedPct"),
      upperWickPct: validateFiniteNumberArray(raw?.atomBinning?.upperWickPct, "atomBinning.upperWickPct"),
      lowerWickPct: validateFiniteNumberArray(raw?.atomBinning?.lowerWickPct, "atomBinning.lowerWickPct"),
      wickToBodyRatio: validateFiniteNumberArray(raw?.atomBinning?.wickToBodyRatio, "atomBinning.wickToBodyRatio"),
      wickSkew: validateFiniteNumberArray(raw?.atomBinning?.wickSkew, "atomBinning.wickSkew"),
      closeNearHigh: validateFiniteNumberArray(raw?.atomBinning?.closeNearHigh, "atomBinning.closeNearHigh"),
      closeNearLow: validateFiniteNumberArray(raw?.atomBinning?.closeNearLow, "atomBinning.closeNearLow"),
      prevCloseRetention: validateFiniteNumberArray(raw?.atomBinning?.prevCloseRetention, "atomBinning.prevCloseRetention"),
      gapOpenPct: validateFiniteNumberArray(raw?.atomBinning?.gapOpenPct, "atomBinning.gapOpenPct"),
      gapFillRatio: validateFiniteNumberArray(raw?.atomBinning?.gapFillRatio, "atomBinning.gapFillRatio"),
      gapRetention: validateFiniteNumberArray(raw?.atomBinning?.gapRetention, "atomBinning.gapRetention"),
      valueRatio20: validateFiniteNumberArray(raw?.atomBinning?.valueRatio20, "atomBinning.valueRatio20"),
      avgTradingValue20dKrw: validateFiniteNumberArray(raw?.atomBinning?.avgTradingValue20dKrw, "atomBinning.avgTradingValue20dKrw"),
      liquidityStress: validateFiniteNumberArray(raw?.atomBinning?.liquidityStress, "atomBinning.liquidityStress"),
      failedBreakoutCount20: validateFiniteNumberArray(raw?.atomBinning?.failedBreakoutCount20, "atomBinning.failedBreakoutCount20"),
      sponsorQuality: validateFiniteNumberArray(raw?.atomBinning?.sponsorQuality, "atomBinning.sponsorQuality"),
      sponsorFragility: validateFiniteNumberArray(raw?.atomBinning?.sponsorFragility, "atomBinning.sponsorFragility"),
      supportHold: validateFiniteNumberArray(raw?.atomBinning?.supportHold, "atomBinning.supportHold"),
      maSpread: validateFiniteNumberArray(raw?.atomBinning?.maSpread, "atomBinning.maSpread"),
      trendSlope: validateFiniteNumberArray(raw?.atomBinning?.trendSlope, "atomBinning.trendSlope"),
      compression20: validateFiniteNumberArray(raw?.atomBinning?.compression20, "atomBinning.compression20"),
      sidewaysScore3: validateFiniteNumberArray(raw?.atomBinning?.sidewaysScore3, "atomBinning.sidewaysScore3"),
      breakoutPauseScore: validateFiniteNumberArray(raw?.atomBinning?.breakoutPauseScore, "atomBinning.breakoutPauseScore"),
      anchorRecencyDays: validateFiniteNumberArray(raw?.atomBinning?.anchorRecencyDays, "atomBinning.anchorRecencyDays"),
      higherLowCount: validateFiniteNumberArray(raw?.atomBinning?.higherLowCount, "atomBinning.higherLowCount"),
      openingImbalance: validateFiniteNumberArray(raw?.atomBinning?.openingImbalance, "atomBinning.openingImbalance"),
      intradayBreakoutStrength: validateFiniteNumberArray(raw?.atomBinning?.intradayBreakoutStrength, "atomBinning.intradayBreakoutStrength"),
      vwapHold: validateFiniteNumberArray(raw?.atomBinning?.vwapHold, "atomBinning.vwapHold"),
    },
  }
  if (contract.embedScopeAtomsInPattern && !contract.includeScopeAtoms) {
    throw new Error("embedScopeAtomsInPattern=true requires includeScopeAtoms=true")
  }
  if (contract.embedLookbackAtomsInPattern && !contract.includeLookbackAtoms) {
    throw new Error("embedLookbackAtomsInPattern=true requires includeLookbackAtoms=true")
  }
  return contract
}
