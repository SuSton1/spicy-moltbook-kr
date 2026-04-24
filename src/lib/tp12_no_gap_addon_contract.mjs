import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  buildTp12NoStopLookbackCandidateRollingContract,
  DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  loadTp12NoStopLookbackLadderContract,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import {
  TP12_NO_GAP_ADDON_IDS,
  TP12_NO_GAP_BASE_FAMILY_IDS,
} from "./tp12_no_gap_addon_features.mjs"

export const TP12_NO_GAP_ADDON_CONTRACT_KIND = "tp12_no_gap_addon_contract_v1"
export const DEFAULT_TP12_NO_GAP_ADDON_CONTRACT_PATH = "meta/tp12_no_gap_addon_research_contract.json"
export const TP12_NO_GAP_ADDON_STAGE_SCREEN = "screen"
export const TP12_NO_GAP_ADDON_STAGE_DEFERRED = "deferred"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

export const normalizeTp12NoGapAddonCandidateId = (value) =>
  toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTp12NoGapAddonCandidateSlug = (candidateId) =>
  normalizeTp12NoGapAddonCandidateId(candidateId).toLowerCase() || "candidate"

const validateCandidate = (candidate, index) => {
  const candidateId = assertNonEmpty(candidate?.candidateId, `addonCandidates[${index}].candidateId`)
  const stage = assertNonEmpty(candidate?.stage, `addonCandidates[${index}].stage`)
  if (stage !== TP12_NO_GAP_ADDON_STAGE_SCREEN && stage !== TP12_NO_GAP_ADDON_STAGE_DEFERRED) {
    throw new Error(`Unsupported addon candidate stage=${stage} for candidateId=${candidateId}`)
  }
  const baseFamilyId = assertNonEmpty(candidate?.baseFamilyId, `addonCandidates[${index}].baseFamilyId`)
  const addonId = assertNonEmpty(candidate?.addonId, `addonCandidates[${index}].addonId`)
  if (!TP12_NO_GAP_BASE_FAMILY_IDS.includes(baseFamilyId)) {
    throw new Error(`Unsupported baseFamilyId=${baseFamilyId} for candidateId=${candidateId}`)
  }
  if (!TP12_NO_GAP_ADDON_IDS.includes(addonId)) {
    throw new Error(`Unsupported addonId=${addonId} for candidateId=${candidateId}`)
  }
  return {
    candidateId,
    label: toText(candidate?.label) || candidateId,
    stage,
    baseFamilyId,
    addonId,
    ordinal: index,
  }
}

const validateCandidateSelection = ({ addonCandidates, rawSelection = {} } = {}) => {
  const allCandidates = Array.isArray(addonCandidates) ? addonCandidates : []
  const byId = new Map(allCandidates.map((candidate) => [normalizeTp12NoGapAddonCandidateId(candidate.candidateId), candidate]))
  const defaultScreenIds = allCandidates
    .filter((candidate) => candidate.stage === TP12_NO_GAP_ADDON_STAGE_SCREEN)
    .map((candidate) => candidate.candidateId)
  const defaultDeferredIds = allCandidates
    .filter((candidate) => candidate.stage === TP12_NO_GAP_ADDON_STAGE_DEFERRED)
    .map((candidate) => candidate.candidateId)
  const screenCandidateIds = uniqueSorted(
    rawSelection?.screenCandidateIds?.length ? rawSelection.screenCandidateIds : defaultScreenIds,
  )
  const deferredCandidateIds = uniqueSorted(
    rawSelection?.deferredCandidateIds?.length ? rawSelection.deferredCandidateIds : defaultDeferredIds,
  )
  const assertKnown = (candidateIds, label) => {
    for (const candidateId of candidateIds) {
      const candidate = byId.get(normalizeTp12NoGapAddonCandidateId(candidateId))
      if (!candidate) {
        throw new Error(`candidateSelection.${label} references unknown candidateId=${candidateId}`)
      }
    }
  }
  assertKnown(screenCandidateIds, "screenCandidateIds")
  assertKnown(deferredCandidateIds, "deferredCandidateIds")
  return {
    screenCandidateIds,
    deferredCandidateIds,
  }
}

export const loadTp12NoGapAddonContract = async ({
  contractPath = DEFAULT_TP12_NO_GAP_ADDON_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_GAP_ADDON_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-gap addon contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_GAP_ADDON_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-gap addon contract kind=${kind}`)
  }
  const baseLookbackLadderContractPath =
    toText(raw.baseLookbackLadderContractPath) || DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH
  const baseLookbackLadderContract = await loadTp12NoStopLookbackLadderContract({
    contractPath: baseLookbackLadderContractPath,
    cwd,
  })
  const baseCandidateId = assertNonEmpty(raw.baseCandidateId, "contract.baseCandidateId")
  const baseRollingContract = buildTp12NoStopLookbackCandidateRollingContract({
    ladderContract: baseLookbackLadderContract,
    candidateId: baseCandidateId,
  })
  const addonCandidates = (Array.isArray(raw?.addonCandidates) ? raw.addonCandidates : []).map((candidate, index) =>
    validateCandidate(candidate, index),
  )
  if (addonCandidates.length < 1) {
    throw new Error("addonCandidates is required")
  }
  const dedupe = new Set()
  for (const candidate of addonCandidates) {
    const normalizedId = normalizeTp12NoGapAddonCandidateId(candidate.candidateId)
    if (dedupe.has(normalizedId)) {
      throw new Error(`Duplicate addon candidateId=${candidate.candidateId}`)
    }
    dedupe.add(normalizedId)
  }
  const candidateSelection = validateCandidateSelection({
    addonCandidates,
    rawSelection: raw?.candidateSelection ?? {},
  })
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    baseLookbackLadderContractPath: baseLookbackLadderContract.contractPath,
    baseLookbackLadderContract,
    baseCandidateId,
    baseRollingContract,
    addonCandidates,
    candidateSelection,
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}

export const resolveTp12NoGapAddonCandidate = ({ addonContract, candidateId } = {}) => {
  const candidates = Array.isArray(addonContract?.addonCandidates) ? addonContract.addonCandidates : []
  const normalizedId = normalizeTp12NoGapAddonCandidateId(candidateId)
  const candidate = candidates.find(
    (entry) => normalizeTp12NoGapAddonCandidateId(entry?.candidateId) === normalizedId,
  )
  if (!candidate) {
    throw new Error(`Unknown TP12 no-gap addon candidateId=${candidateId}`)
  }
  return candidate
}

export const resolveTp12NoGapAddonCandidates = ({
  addonContract,
  candidateGroup = "all",
  candidateIds = [],
} = {}) => {
  const candidates = Array.isArray(addonContract?.addonCandidates) ? addonContract.addonCandidates : []
  const requestedIds = uniqueSorted(candidateIds).map((value) => normalizeTp12NoGapAddonCandidateId(value))
  if (requestedIds.length > 0) {
    const byId = new Map(
      candidates.map((candidate) => [normalizeTp12NoGapAddonCandidateId(candidate.candidateId), candidate]),
    )
    const resolved = requestedIds.map((candidateId) => byId.get(candidateId)).filter(Boolean)
    if (resolved.length !== requestedIds.length) {
      const missing = requestedIds.filter((candidateId) => !byId.has(candidateId))
      throw new Error(`Unknown addon candidate ids: ${missing.join(", ")}`)
    }
    return resolved.sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  const normalizedGroup = toText(candidateGroup).toLowerCase() || "all"
  if (normalizedGroup === "all") {
    return [...candidates].sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  if (normalizedGroup === "screen") {
    const ids = new Set(
      (Array.isArray(addonContract?.candidateSelection?.screenCandidateIds)
        ? addonContract.candidateSelection.screenCandidateIds
        : []
      ).map((candidateId) => normalizeTp12NoGapAddonCandidateId(candidateId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoGapAddonCandidateId(candidate.candidateId)))
  }
  if (normalizedGroup === "deferred") {
    const ids = new Set(
      (Array.isArray(addonContract?.candidateSelection?.deferredCandidateIds)
        ? addonContract.candidateSelection.deferredCandidateIds
        : []
      ).map((candidateId) => normalizeTp12NoGapAddonCandidateId(candidateId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoGapAddonCandidateId(candidate.candidateId)))
  }
  throw new Error(`Unsupported TP12 no-gap addon candidateGroup=${candidateGroup}`)
}

export const buildTp12NoGapAddonCandidateRollingContract = ({
  addonContract,
  candidateId,
} = {}) => {
  const candidate = resolveTp12NoGapAddonCandidate({
    addonContract,
    candidateId,
  })
  const baseRolling = addonContract?.baseRollingContract ?? {}
  return {
    ...JSON.parse(JSON.stringify(baseRolling)),
    contractId: `${toText(addonContract?.contractId)}_${buildTp12NoGapAddonCandidateSlug(candidate.candidateId)}`,
    updatedAt: toText(addonContract?.updatedAt),
    scopeId: candidate.candidateId,
    hardStops: [
      `Derived tp12 no-gap addon rolling contract for candidateId=${candidate.candidateId}`,
      ...((Array.isArray(addonContract?.hardStops) ? addonContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(addonContract?.contractPath)}`,
      `baseCandidateId=${toText(addonContract?.baseCandidateId)}`,
      `candidateId=${candidate.candidateId}`,
      `baseFamilyId=${candidate.baseFamilyId}`,
      `addonId=${candidate.addonId}`,
      ...((Array.isArray(baseRolling?.notes) ? baseRolling.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTp12NoGapAddonCandidateRollingContract = async ({
  addonContract,
  candidateId,
  outPath,
} = {}) => {
  const payload = buildTp12NoGapAddonCandidateRollingContract({
    addonContract,
    candidateId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12NoGapAddonCandidateRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
