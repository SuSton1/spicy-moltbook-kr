import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  buildTp12NoStopLookbackCandidateRollingContract,
  DEFAULT_TP12_NO_STOP_LOOKBACK_LADDER_CONTRACT_PATH,
  loadTp12NoStopLookbackLadderContract,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import { listTp12NoStopScopeIds, resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"

export const TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_KIND = "tp12_no_stop_scope_expansion_contract_v1"
export const DEFAULT_TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_PATH = "meta/tp12_no_stop_scope_expansion_contract.json"
export const TP12_NO_STOP_SCOPE_EXPANSION_STAGE_BASELINE = "baseline"
export const TP12_NO_STOP_SCOPE_EXPANSION_STAGE_EXPAND = "expand"

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

export const normalizeTp12NoStopScopeExpansionScopeId = (value) =>
  toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTp12NoStopScopeExpansionScopeSlug = (scopeId) =>
  normalizeTp12NoStopScopeExpansionScopeId(scopeId).toLowerCase() || "scope"

const validateScopeCandidate = (candidate, index) => {
  const scopeId = assertNonEmpty(candidate?.scopeId, `scopeCandidates[${index}].scopeId`)
  const stage = assertNonEmpty(candidate?.stage, `scopeCandidates[${index}].stage`)
  if (stage !== TP12_NO_STOP_SCOPE_EXPANSION_STAGE_BASELINE && stage !== TP12_NO_STOP_SCOPE_EXPANSION_STAGE_EXPAND) {
    throw new Error(`Unsupported scope candidate stage=${stage} for scopeId=${scopeId}`)
  }
  const scopeSpec = resolveTp12NoStopScopeSpec(scopeId)
  if (!scopeSpec) {
    throw new Error(
      `scopeCandidates[${index}].scopeId must be one of ${listTp12NoStopScopeIds().join(", ")}, got ${scopeId}`,
    )
  }
  return {
    scopeId: scopeSpec.scopeId,
    stage,
    ordinal: index,
  }
}

const validateCandidateSelection = ({ scopeCandidates, rawSelection = {} } = {}) => {
  const byId = new Map(
    (Array.isArray(scopeCandidates) ? scopeCandidates : []).map((candidate) => [
      normalizeTp12NoStopScopeExpansionScopeId(candidate.scopeId),
      candidate,
    ]),
  )
  const baselineScopeIds = (Array.isArray(scopeCandidates) ? scopeCandidates : [])
    .filter((candidate) => candidate.stage === TP12_NO_STOP_SCOPE_EXPANSION_STAGE_BASELINE)
    .map((candidate) => candidate.scopeId)
  const expandScopeIds = (Array.isArray(scopeCandidates) ? scopeCandidates : [])
    .filter((candidate) => candidate.stage === TP12_NO_STOP_SCOPE_EXPANSION_STAGE_EXPAND)
    .map((candidate) => candidate.scopeId)
  const screenScopeIds = uniqueSorted(rawSelection?.screenScopeIds?.length ? rawSelection.screenScopeIds : expandScopeIds)
  const deferredScopeIds = uniqueSorted(rawSelection?.deferredScopeIds?.length ? rawSelection.deferredScopeIds : [])

  const assertKnown = (scopeIds, label) => {
    for (const scopeId of scopeIds) {
      if (!byId.has(normalizeTp12NoStopScopeExpansionScopeId(scopeId))) {
        throw new Error(`candidateSelection.${label} references unknown scopeId=${scopeId}`)
      }
    }
  }
  assertKnown(screenScopeIds, "screenScopeIds")
  assertKnown(deferredScopeIds, "deferredScopeIds")
  return {
    baselineScopeIds,
    screenScopeIds,
    deferredScopeIds,
  }
}

export const loadTp12NoStopScopeExpansionContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop scope expansion contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_SCOPE_EXPANSION_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop scope expansion contract kind=${kind}`)
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
  const scopeCandidates = (Array.isArray(raw?.scopeCandidates) ? raw.scopeCandidates : []).map((candidate, index) =>
    validateScopeCandidate(candidate, index),
  )
  if (scopeCandidates.length < 1) {
    throw new Error("scopeCandidates is required")
  }
  const byId = new Set()
  for (const candidate of scopeCandidates) {
    const normalizedId = normalizeTp12NoStopScopeExpansionScopeId(candidate.scopeId)
    if (byId.has(normalizedId)) {
      throw new Error(`Duplicate scope candidateId=${candidate.scopeId}`)
    }
    byId.add(normalizedId)
  }
  const candidateSelection = validateCandidateSelection({
    scopeCandidates,
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
    scopeCandidates,
    candidateSelection,
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}

export const resolveTp12NoStopScopeExpansionCandidate = ({ scopeExpansionContract, scopeId } = {}) => {
  const candidates = Array.isArray(scopeExpansionContract?.scopeCandidates) ? scopeExpansionContract.scopeCandidates : []
  const normalizedId = normalizeTp12NoStopScopeExpansionScopeId(scopeId)
  const candidate = candidates.find(
    (entry) => normalizeTp12NoStopScopeExpansionScopeId(entry?.scopeId) === normalizedId,
  )
  if (!candidate) {
    throw new Error(`Unknown TP12 no-stop scope expansion scopeId=${scopeId}`)
  }
  return candidate
}

export const resolveTp12NoStopScopeExpansionCandidates = ({
  scopeExpansionContract,
  scopeGroup = "all",
  scopeIds = [],
} = {}) => {
  const candidates = Array.isArray(scopeExpansionContract?.scopeCandidates) ? scopeExpansionContract.scopeCandidates : []
  const requestedIds = uniqueSorted(scopeIds).map((value) => normalizeTp12NoStopScopeExpansionScopeId(value))
  if (requestedIds.length > 0) {
    const byId = new Map(
      candidates.map((candidate) => [normalizeTp12NoStopScopeExpansionScopeId(candidate.scopeId), candidate]),
    )
    const resolved = requestedIds.map((scopeId) => byId.get(scopeId)).filter(Boolean)
    if (resolved.length !== requestedIds.length) {
      const missing = requestedIds.filter((scopeId) => !byId.has(scopeId))
      throw new Error(`Unknown scope expansion scope ids: ${missing.join(", ")}`)
    }
    return resolved.sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  const normalizedGroup = toText(scopeGroup).toLowerCase() || "all"
  if (normalizedGroup === "all") {
    return [...candidates].sort((left, right) => Number(left?.ordinal ?? 0) - Number(right?.ordinal ?? 0))
  }
  if (normalizedGroup === "screen") {
    const ids = new Set(
      (Array.isArray(scopeExpansionContract?.candidateSelection?.screenScopeIds)
        ? scopeExpansionContract.candidateSelection.screenScopeIds
        : []
      ).map((scopeId) => normalizeTp12NoStopScopeExpansionScopeId(scopeId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoStopScopeExpansionScopeId(candidate.scopeId)))
  }
  if (normalizedGroup === "deferred") {
    const ids = new Set(
      (Array.isArray(scopeExpansionContract?.candidateSelection?.deferredScopeIds)
        ? scopeExpansionContract.candidateSelection.deferredScopeIds
        : []
      ).map((scopeId) => normalizeTp12NoStopScopeExpansionScopeId(scopeId)),
    )
    return candidates.filter((candidate) => ids.has(normalizeTp12NoStopScopeExpansionScopeId(candidate.scopeId)))
  }
  if (normalizedGroup === "baseline") {
    return candidates.filter((candidate) => candidate.stage === TP12_NO_STOP_SCOPE_EXPANSION_STAGE_BASELINE)
  }
  throw new Error(`Unsupported TP12 no-stop scope expansion group=${scopeGroup}`)
}

export const buildTp12NoStopScopeExpansionCandidateRollingContract = ({
  scopeExpansionContract,
  scopeId,
} = {}) => {
  const candidate = resolveTp12NoStopScopeExpansionCandidate({
    scopeExpansionContract,
    scopeId,
  })
  const baseRolling = scopeExpansionContract?.baseRollingContract ?? {}
  return {
    ...JSON.parse(JSON.stringify(baseRolling)),
    contractId: `${toText(scopeExpansionContract?.contractId)}_${buildTp12NoStopScopeExpansionScopeSlug(candidate.scopeId)}`,
    updatedAt: toText(scopeExpansionContract?.updatedAt),
    scopeId: candidate.scopeId,
    hardStops: [
      `Derived scope-expansion rolling contract for scopeId=${candidate.scopeId}`,
      ...((Array.isArray(scopeExpansionContract?.hardStops) ? scopeExpansionContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(scopeExpansionContract?.contractPath)}`,
      `baseCandidateId=${toText(scopeExpansionContract?.baseCandidateId)}`,
      `scopeId=${candidate.scopeId}`,
      `scopeStage=${candidate.stage}`,
      ...((Array.isArray(baseRolling?.notes) ? baseRolling.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTp12NoStopScopeExpansionCandidateRollingContract = async ({
  scopeExpansionContract,
  scopeId,
  outPath,
} = {}) => {
  const payload = buildTp12NoStopScopeExpansionCandidateRollingContract({
    scopeExpansionContract,
    scopeId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12NoStopScopeExpansionCandidateRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
