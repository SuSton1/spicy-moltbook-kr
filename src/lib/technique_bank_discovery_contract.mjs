import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import { TECHNIQUE_BANK_DISCOVERY_PLAN_KIND } from "./technique_bank_discovery_plan.mjs"
import {
  buildTp12NoStopLookbackCandidateRollingContract,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import { resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"
import {
  parseTechniqueBankId,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_BANK_DISCOVERY_MANIFEST_KIND = "technique_bank_discovery_manifest_v1"

const normalizeBankSlug = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const assertPlan = (planArtifact) => {
  if (!planArtifact || typeof planArtifact !== "object") {
    throw new Error("planArtifact is required")
  }
  if (toText(planArtifact.kind) !== TECHNIQUE_BANK_DISCOVERY_PLAN_KIND) {
    throw new Error(
      `Expected plan kind ${TECHNIQUE_BANK_DISCOVERY_PLAN_KIND}, got ${toText(planArtifact.kind) || "<empty>"}`,
    )
  }
  const selectedBanks = Array.isArray(planArtifact.selectedBanks) ? planArtifact.selectedBanks : []
  if (selectedBanks.length < 1) {
    throw new Error("planArtifact.selectedBanks is empty")
  }
  return selectedBanks
}

const comparePlanBanks = (left, right) => {
  const leftRank = Number(left?.planRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.planRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  return String(left?.bankId ?? "").localeCompare(String(right?.bankId ?? ""))
}

export const selectTechniqueBankDiscoveryPlanBanks = ({
  planArtifact,
  selectedBankIds = [],
  maxBanks = null,
} = {}) => {
  const selectedBanks = assertPlan(planArtifact)
  const requestedBankIds = uniqueSortedStrings(Array.isArray(selectedBankIds) ? selectedBankIds : [])
  const shortlistIds = new Set(selectedBanks.map((entry) => toText(entry.bankId)))
  for (const bankId of requestedBankIds) {
    if (!shortlistIds.has(bankId)) {
      throw new Error(`Requested bankId is not present in plan artifact: ${bankId}`)
    }
  }
  const chosenBanks = selectedBanks
    .filter((entry) => requestedBankIds.length < 1 || requestedBankIds.includes(toText(entry.bankId)))
    .slice()
    .sort(comparePlanBanks)
  if (chosenBanks.length < 1) {
    throw new Error("No banks remain after applying plan selection filters")
  }
  if (!Number.isFinite(Number(maxBanks)) || Number(maxBanks) <= 0) {
    return chosenBanks
  }
  return chosenBanks.slice(0, Number(maxBanks))
}

export const buildTechniqueBankDiscoveryRollingContract = ({
  techniqueContract,
  planArtifact,
  bankId = null,
  selectedBank = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  const chosenBank =
    selectedBank ??
    selectTechniqueBankDiscoveryPlanBanks({
      planArtifact,
      selectedBankIds: bankId ? [bankId] : [],
      maxBanks: 1,
    })[0]
  if (!chosenBank || typeof chosenBank !== "object") {
    throw new Error("selectedBank is required")
  }
  const concrete = parseTechniqueBankId(chosenBank.bankId)
  const resolvedScopeId = resolveTp12NoStopScopeSpec(concrete.scopeId)?.scopeId
  if (!resolvedScopeId) {
    throw new Error(`Unknown technique bank scopeId=${concrete.scopeId}`)
  }
  if (resolvedScopeId !== concrete.scopeId) {
    throw new Error(`Technique bank scopeId must already be concrete: ${concrete.scopeId}`)
  }
  const baseRolling = buildTp12NoStopLookbackCandidateRollingContract({
    ladderContract: techniqueContract.baseLookbackLadderContract,
    candidateId: concrete.lookbackCandidateId,
  })
  const bankDiscoveryConfig =
    chosenBank.bankDiscoveryConfig && typeof chosenBank.bankDiscoveryConfig === "object"
      ? chosenBank.bankDiscoveryConfig
      : techniqueContract.bankDiscovery
  if (!bankDiscoveryConfig || typeof bankDiscoveryConfig !== "object") {
    throw new Error("bank discovery config is required")
  }
  const bankSlug = normalizeBankSlug(concrete.bankId) || "bank"
  return {
    ...JSON.parse(JSON.stringify(baseRolling)),
    contractId: `${toText(techniqueContract.contractId)}_${bankSlug}`,
    updatedAt: toText(techniqueContract.updatedAt),
    scopeId: resolvedScopeId,
    searchContract: {
      ...(baseRolling?.searchContract ?? {}),
      screenMaxSearchStates:
        Number(bankDiscoveryConfig.screenMaxSearchStates ?? 0) ||
        Number(baseRolling?.searchContract?.screenMaxSearchStates ?? 0),
      configPath: path.resolve(toText(baseRolling?.searchContract?.configPath)),
    },
    techniqueBankDiscovery: {
      kind: "technique_bank_discovery_contract_context_v1",
      bankId: concrete.bankId,
      mechanismId: concrete.mechanismId,
      scopeId: concrete.scopeId,
      lookbackCandidateId: concrete.lookbackCandidateId,
      topTemplateId: toText(chosenBank.topTemplateId),
      shortlistedTemplateIds: Array.isArray(chosenBank.shortlistedTemplateIds)
        ? chosenBank.shortlistedTemplateIds.slice()
        : [],
      shortlistedTemplateCount: Number(chosenBank.shortlistedTemplateCount ?? 0) || 0,
      allClauseIds: Array.isArray(chosenBank.allClauseIds) ? chosenBank.allClauseIds.slice() : [],
      anchorClauseIds: Array.isArray(chosenBank.anchorClauseIds) ? chosenBank.anchorClauseIds.slice() : [],
      retestClauseIds: Array.isArray(chosenBank.retestClauseIds) ? chosenBank.retestClauseIds.slice() : [],
      compressionClauseIds: Array.isArray(chosenBank.compressionClauseIds)
        ? chosenBank.compressionClauseIds.slice()
        : [],
      confirmClauseIds: Array.isArray(chosenBank.confirmClauseIds) ? chosenBank.confirmClauseIds.slice() : [],
      invalidateClauseIds: Array.isArray(chosenBank.invalidateClauseIds)
        ? chosenBank.invalidateClauseIds.slice()
        : [],
      observedScopeIds: Array.isArray(chosenBank.observedScopeIds) ? chosenBank.observedScopeIds.slice() : [],
      observedLookbackCandidateIds: Array.isArray(chosenBank.observedLookbackCandidateIds)
        ? chosenBank.observedLookbackCandidateIds.slice()
        : [],
      bankDiscoveryConfig: { ...bankDiscoveryConfig },
    },
    hardStops: [
      `Derived technique bank discovery rolling contract for bankId=${concrete.bankId}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concrete.lookbackCandidateId}`,
      ...((Array.isArray(techniqueContract.hardStops) ? techniqueContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(techniqueContract.contractPath)}`,
      `bankId=${concrete.bankId}`,
      `mechanismId=${concrete.mechanismId}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concrete.lookbackCandidateId}`,
      `topTemplateId=${toText(chosenBank.topTemplateId)}`,
      `shortlistedTemplateCount=${Number(chosenBank.shortlistedTemplateCount ?? 0) || 0}`,
      ...((Array.isArray(baseRolling?.notes) ? baseRolling.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTechniqueBankDiscoveryRollingContract = async ({
  techniqueContract,
  planArtifact,
  bankId,
  outPath,
} = {}) => {
  const payload = buildTechniqueBankDiscoveryRollingContract({
    techniqueContract,
    planArtifact,
    bankId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTechniqueBankDiscoveryRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}

export const loadTechniqueBankDiscoveryPlan = async ({
  planPath,
  cwd = process.cwd(),
} = {}) => {
  const resolvedPlanPath = path.resolve(cwd, toText(planPath))
  const raw = await readJson(resolvedPlanPath, null)
  assertPlan(raw)
  return {
    ...raw,
    planPath: resolvedPlanPath,
  }
}
