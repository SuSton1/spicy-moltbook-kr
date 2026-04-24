import path from "node:path"

import { readJson } from "./io.mjs"
import {
  DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  loadTp12NoStopLookbackLadderContract,
  normalizeTp12NoStopLookbackCandidateId,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import { listTp12NoStopScopeIds, resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"

export const TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_KIND =
  "tp12_year2x8_bank_discovery_research_contract_v1"
export const DEFAULT_TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_PATH =
  "meta/tp12_year2x8_bank_discovery_research_contract.json"

const toText = (value) => String(value ?? "").trim()

const uniqueSortedStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

export const normalizeTp12Year2x8CoreYears = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isInteger(value) && value >= 1900 && value <= 3000),
    ),
  ).sort((left, right) => left - right)

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertPositiveInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const validateScopeIds = (scopeIds = [], label) => {
  const normalized = uniqueSortedStrings(scopeIds).map((scopeId) => resolveTp12NoStopScopeSpec(scopeId)?.scopeId ?? null)
  if (normalized.some((scopeId) => !scopeId)) {
    throw new Error(`${label} must use known scope ids: ${listTp12NoStopScopeIds().join(", ")}`)
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

export const loadTp12Year2x8BankDiscoveryContract = async ({
  contractPath = DEFAULT_TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(
    cwd,
    toText(contractPath) || DEFAULT_TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_PATH,
  )
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 year2x8 bank discovery contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_YEAR2X8_BANK_DISCOVERY_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 year2x8 contract kind=${kind}`)
  }
  const baseLookbackLadderContract = await loadTp12NoStopLookbackLadderContract({
    contractPath:
      toText(raw.baseLookbackLadderContractPath) || DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
    cwd,
  })
  const coreYears = normalizeTp12Year2x8CoreYears(raw?.yearHitPrune?.coreYears)
  const excludedBoundaryYears = normalizeTp12Year2x8CoreYears(raw?.yearHitPrune?.excludedBoundaryYears)
  const minTrainHitsPerCoreYear = assertPositiveInteger(
    raw?.yearHitPrune?.minTrainHitsPerCoreYear,
    "yearHitPrune.minTrainHitsPerCoreYear",
  )
  if (coreYears.length < 1) {
    throw new Error("yearHitPrune.coreYears is required")
  }
  if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
    throw new Error("yearHitPrune.excludedBoundaryYears must not overlap coreYears")
  }
  const discovery = raw?.bankDiscovery ?? {}
  const scopeIds = validateScopeIds(discovery?.scopeIds, "bankDiscovery.scopeIds")
  if (scopeIds.length < 1) {
    throw new Error("bankDiscovery.scopeIds is required")
  }
  const lookbackCandidateIds = validateLookbackCandidateIds({
    candidateIds: discovery?.lookbackCandidateIds,
    ladderContract: baseLookbackLadderContract,
    label: "bankDiscovery.lookbackCandidateIds",
  })
  const dryRunScopeId =
    resolveTp12NoStopScopeSpec(discovery?.dryRunCell?.scopeId)?.scopeId ??
    scopeIds[0]
  const dryRunCandidateId = validateLookbackCandidateIds({
    candidateIds: [discovery?.dryRunCell?.candidateId ?? lookbackCandidateIds[0]],
    ladderContract: baseLookbackLadderContract,
    label: "bankDiscovery.dryRunCell.candidateId",
  })[0]
  const screenMaxSearchStates = assertPositiveInteger(
    discovery?.screenMaxSearchStates ?? baseLookbackLadderContract?.baseRollingContract?.searchContract?.screenMaxSearchStates,
    "bankDiscovery.screenMaxSearchStates",
  )
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    baseLookbackLadderContractPath: baseLookbackLadderContract.contractPath,
    baseLookbackLadderContract,
    canonicalBaseline: {
      scopeId: resolveTp12NoStopScopeSpec(raw?.canonicalBaseline?.scopeId)?.scopeId ?? "LOW_GAP_TOP",
      candidateId: validateLookbackCandidateIds({
        candidateIds: [raw?.canonicalBaseline?.candidateId ?? "lb5"],
        ladderContract: baseLookbackLadderContract,
        label: "canonicalBaseline.candidateId",
      })[0],
      screenHitRate: assertFiniteNumber(raw?.canonicalBaseline?.screenHitRate, "canonicalBaseline.screenHitRate"),
      screenHitRows: assertPositiveInteger(raw?.canonicalBaseline?.screenHitRows, "canonicalBaseline.screenHitRows"),
      screenSelectedRows: assertPositiveInteger(raw?.canonicalBaseline?.screenSelectedRows, "canonicalBaseline.screenSelectedRows"),
      finalHitRate: assertFiniteNumber(raw?.canonicalBaseline?.finalHitRate, "canonicalBaseline.finalHitRate"),
      finalHitRows: assertPositiveInteger(raw?.canonicalBaseline?.finalHitRows, "canonicalBaseline.finalHitRows"),
      finalSelectedRows: assertPositiveInteger(
        raw?.canonicalBaseline?.finalSelectedRows,
        "canonicalBaseline.finalSelectedRows",
      ),
    },
    yearHitPrune: {
      enableYearHitUpperBoundPrune: raw?.yearHitPrune?.enableYearHitUpperBoundPrune === true,
      coreYears,
      excludedBoundaryYears,
      minTrainHitsPerCoreYear,
    },
    bankDiscovery: {
      scopeIds,
      lookbackCandidateIds,
      screenWindowGroup: assertNonEmpty(discovery?.screenWindowGroup ?? "screen", "bankDiscovery.screenWindowGroup"),
      screenMaxSearchStates,
      dryRunCell: {
        scopeId: dryRunScopeId,
        candidateId: dryRunCandidateId,
      },
    },
    promotion: {
      screenMinUsableWindows: assertPositiveInteger(raw?.promotion?.screenMinUsableWindows, "promotion.screenMinUsableWindows"),
      screenMinRollingOosHitRate: assertFiniteNumber(raw?.promotion?.screenMinRollingOosHitRate, "promotion.screenMinRollingOosHitRate"),
      screenMinSignalsPer20TradingDays: assertFiniteNumber(
        raw?.promotion?.screenMinSignalsPer20TradingDays,
        "promotion.screenMinSignalsPer20TradingDays",
      ),
      screenMinYearsWithAtLeast2Hits: assertPositiveInteger(
        raw?.promotion?.screenMinYearsWithAtLeast2Hits,
        "promotion.screenMinYearsWithAtLeast2Hits",
      ),
      screenMaxTop1DateShare: assertFiniteNumber(raw?.promotion?.screenMaxTop1DateShare, "promotion.screenMaxTop1DateShare"),
      finalMinOosHitRate: assertFiniteNumber(raw?.promotion?.finalMinOosHitRate, "promotion.finalMinOosHitRate"),
      finalMinSelectedRows: assertPositiveInteger(raw?.promotion?.finalMinSelectedRows, "promotion.finalMinSelectedRows"),
      finalMinSignalsPer20TradingDays: assertFiniteNumber(
        raw?.promotion?.finalMinSignalsPer20TradingDays,
        "promotion.finalMinSignalsPer20TradingDays",
      ),
      finalMinUniqueMatchedDates: assertPositiveInteger(
        raw?.promotion?.finalMinUniqueMatchedDates,
        "promotion.finalMinUniqueMatchedDates",
      ),
      finalMaxTop1DateShare: assertFiniteNumber(raw?.promotion?.finalMaxTop1DateShare, "promotion.finalMaxTop1DateShare"),
      finalSoftFailBelowHitRate: assertFiniteNumber(
        raw?.promotion?.finalSoftFailBelowHitRate,
        "promotion.finalSoftFailBelowHitRate",
      ),
      liveLikeSignalsPer20TradingDaysMin: assertFiniteNumber(
        raw?.promotion?.liveLikeSignalsPer20TradingDaysMin,
        "promotion.liveLikeSignalsPer20TradingDaysMin",
      ),
      liveLikeSignalsPer20TradingDaysMax: assertFiniteNumber(
        raw?.promotion?.liveLikeSignalsPer20TradingDaysMax,
        "promotion.liveLikeSignalsPer20TradingDaysMax",
      ),
    },
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}
