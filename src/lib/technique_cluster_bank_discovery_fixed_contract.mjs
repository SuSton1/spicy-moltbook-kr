import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  loadTp12NoStopFixedResearchContract,
} from "./tp12_no_stop_fixed_contract.mjs"
import { TECHNIQUE_CLUSTER_BANK_DISCOVERY_PLAN_KIND } from "./technique_cluster_bank_discovery_plan.mjs"
import { resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"
import {
  parseTechniqueBankId,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_CLUSTER_BANK_DISCOVERY_FIXED_MANIFEST_KIND = "technique_cluster_bank_discovery_fixed_manifest_v1"

const normalizeClusterBankSlug = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const assertPlan = (planArtifact) => {
  if (!planArtifact || typeof planArtifact !== "object") {
    throw new Error("planArtifact is required")
  }
  if (toText(planArtifact.kind) !== TECHNIQUE_CLUSTER_BANK_DISCOVERY_PLAN_KIND) {
    throw new Error(
      `Expected plan kind ${TECHNIQUE_CLUSTER_BANK_DISCOVERY_PLAN_KIND}, got ${toText(planArtifact.kind) || "<empty>"}`,
    )
  }
  const selectedClusterBanks = Array.isArray(planArtifact.selectedClusterBanks)
    ? planArtifact.selectedClusterBanks
    : []
  if (selectedClusterBanks.length < 1) {
    throw new Error("planArtifact.selectedClusterBanks is empty")
  }
  return selectedClusterBanks
}

const comparePlanEntries = (left, right) => {
  const leftRank = Number(left?.planRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.planRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  return String(left?.clusterBankId ?? "").localeCompare(String(right?.clusterBankId ?? ""))
}

const assertTechniqueClauseContext = (entry, label) => {
  const allClauseIds = Array.isArray(entry?.allClauseIds) ? entry.allClauseIds.filter(Boolean) : []
  const anchorClauseIds = Array.isArray(entry?.anchorClauseIds) ? entry.anchorClauseIds.filter(Boolean) : []
  if (allClauseIds.length < 1) {
    throw new Error(`${label} must include allClauseIds`)
  }
  if (anchorClauseIds.length < 1) {
    throw new Error(`${label} must include anchorClauseIds`)
  }
}

export const selectTechniqueClusterBankDiscoveryFixedPlanEntries = ({
  planArtifact,
  selectedClusterBankIds = [],
  maxBanks = null,
} = {}) => {
  const selectedClusterBanks = assertPlan(planArtifact)
  const requestedIds = uniqueSortedStrings(Array.isArray(selectedClusterBankIds) ? selectedClusterBankIds : [])
  const knownIds = new Set(selectedClusterBanks.map((entry) => toText(entry.clusterBankId)))
  for (const clusterBankId of requestedIds) {
    if (!knownIds.has(clusterBankId)) {
      throw new Error(`Requested clusterBankId is not present in plan artifact: ${clusterBankId}`)
    }
  }
  const chosen = selectedClusterBanks
    .filter((entry) => requestedIds.length < 1 || requestedIds.includes(toText(entry.clusterBankId)))
    .slice()
    .sort(comparePlanEntries)
  if (chosen.length < 1) {
    throw new Error("No cluster-bank entries remain after applying plan selection filters")
  }
  if (!Number.isFinite(Number(maxBanks)) || Number(maxBanks) <= 0) return chosen
  return chosen.slice(0, Number(maxBanks))
}

export const buildTechniqueClusterBankDiscoveryFixedContract = ({
  techniqueContract,
  fixedContract,
  planArtifact,
  clusterBankId = null,
  selectedEntry = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (!fixedContract || typeof fixedContract !== "object") {
    throw new Error("fixedContract is required")
  }
  const chosenEntry =
    selectedEntry ??
    selectTechniqueClusterBankDiscoveryFixedPlanEntries({
      planArtifact,
      selectedClusterBankIds: clusterBankId ? [clusterBankId] : [],
      maxBanks: 1,
    })[0]
  if (!chosenEntry || typeof chosenEntry !== "object") {
    throw new Error("selectedEntry is required")
  }
  assertTechniqueClauseContext(
    chosenEntry,
    `technique cluster-bank fixed entry ${toText(chosenEntry.clusterBankId) || "<unknown>"}`,
  )
  const concrete = parseTechniqueBankId(chosenEntry.bankId)
  const resolvedScopeId = resolveTp12NoStopScopeSpec(concrete.scopeId)?.scopeId
  if (!resolvedScopeId) {
    throw new Error(`Unknown technique cluster-bank scopeId=${concrete.scopeId}`)
  }
  if (resolvedScopeId !== concrete.scopeId) {
    throw new Error(`Technique cluster-bank scopeId must already be concrete: ${concrete.scopeId}`)
  }
  const bankDiscoveryConfig =
    chosenEntry.bankDiscoveryConfig && typeof chosenEntry.bankDiscoveryConfig === "object"
      ? chosenEntry.bankDiscoveryConfig
      : techniqueContract.bankDiscovery
  if (!bankDiscoveryConfig || typeof bankDiscoveryConfig !== "object") {
    throw new Error("cluster bank discovery config is required")
  }
  const clusterBankSlug = normalizeClusterBankSlug(chosenEntry.clusterBankId || concrete.bankId) || "cluster_bank"
  return {
    ...JSON.parse(JSON.stringify(fixedContract)),
    contractId: `${toText(techniqueContract.contractId)}_${clusterBankSlug}`,
    updatedAt: toText(techniqueContract.updatedAt || fixedContract.updatedAt),
    scopeId: resolvedScopeId,
    yearHitMetric: toText(techniqueContract.yearHitMetric || fixedContract.yearHitMetric || "hit_rows"),
    searchContract: {
      ...(fixedContract?.searchContract ?? {}),
      screenMaxSearchStates:
        Number(bankDiscoveryConfig.screenMaxSearchStates ?? 0) ||
        Number(fixedContract?.searchContract?.screenMaxSearchStates ?? 0),
      configPath: path.resolve(toText(fixedContract?.searchContract?.configPath)),
    },
    techniqueClusterBankDiscovery: {
      kind: "technique_cluster_bank_discovery_contract_context_v1",
      clusterBankId: toText(chosenEntry.clusterBankId),
      entryType: toText(chosenEntry.entryType),
      selectionPolicy: toText(chosenEntry.selectionPolicy),
      bankId: concrete.bankId,
      sourceBankId: toText(chosenEntry.sourceBankId) || concrete.bankId,
      clusterId: toText(chosenEntry.clusterId) || null,
      mechanismId: concrete.mechanismId,
      scopeId: concrete.scopeId,
      lookbackCandidateId: concrete.lookbackCandidateId,
      topTemplateId: toText(chosenEntry.topTemplateId) || null,
      leaderTemplateId: toText(chosenEntry.leaderTemplateId) || null,
      breadthTemplateId: toText(chosenEntry.breadthTemplateId) || null,
      shortlistedTemplateIds: Array.isArray(chosenEntry.shortlistedTemplateIds)
        ? chosenEntry.shortlistedTemplateIds.slice()
        : [],
      shortlistedTemplateCount: Number(chosenEntry.shortlistedTemplateCount ?? 0) || 0,
      selectedTemplateIds: Array.isArray(chosenEntry.selectedTemplateIds)
        ? chosenEntry.selectedTemplateIds.slice()
        : [],
      observedScopeIds: Array.isArray(chosenEntry.observedScopeIds) ? chosenEntry.observedScopeIds.slice() : [],
      observedLookbackCandidateIds: Array.isArray(chosenEntry.observedLookbackCandidateIds)
        ? chosenEntry.observedLookbackCandidateIds.slice()
        : [],
      allClauseIds: Array.isArray(chosenEntry.allClauseIds) ? chosenEntry.allClauseIds.slice() : [],
      anchorClauseIds: Array.isArray(chosenEntry.anchorClauseIds) ? chosenEntry.anchorClauseIds.slice() : [],
      retestClauseIds: Array.isArray(chosenEntry.retestClauseIds) ? chosenEntry.retestClauseIds.slice() : [],
      compressionClauseIds: Array.isArray(chosenEntry.compressionClauseIds)
        ? chosenEntry.compressionClauseIds.slice()
        : [],
      confirmClauseIds: Array.isArray(chosenEntry.confirmClauseIds) ? chosenEntry.confirmClauseIds.slice() : [],
      invalidateClauseIds: Array.isArray(chosenEntry.invalidateClauseIds)
        ? chosenEntry.invalidateClauseIds.slice()
        : [],
      sourceBankSummary:
        chosenEntry?.sourceBankSummary && typeof chosenEntry.sourceBankSummary === "object"
          ? { ...chosenEntry.sourceBankSummary }
          : null,
      bankDiscoveryConfig: { ...bankDiscoveryConfig },
    },
    hardStops: [
      `Derived technique cluster-bank fixed contract for clusterBankId=${toText(chosenEntry.clusterBankId)}`,
      `bankId=${concrete.bankId}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concrete.lookbackCandidateId}`,
      ...((Array.isArray(techniqueContract.hardStops) ? techniqueContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(fixedContract.hardStops) ? fixedContract.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(techniqueContract.contractPath)}`,
      `fixedResearchContractPath=${toText(fixedContract.contractPath)}`,
      `clusterBankId=${toText(chosenEntry.clusterBankId)}`,
      `entryType=${toText(chosenEntry.entryType)}`,
      `bankId=${concrete.bankId}`,
      `mechanismId=${concrete.mechanismId}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concrete.lookbackCandidateId}`,
      ...((Array.isArray(fixedContract.notes) ? fixedContract.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTechniqueClusterBankDiscoveryFixedContract = async ({
  techniqueContract,
  fixedContract,
  planArtifact,
  clusterBankId,
  outPath,
} = {}) => {
  const payload = buildTechniqueClusterBankDiscoveryFixedContract({
    techniqueContract,
    fixedContract,
    planArtifact,
    clusterBankId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTechniqueClusterBankDiscoveryFixedContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}

export const loadTechniqueClusterBankDiscoveryPlan = async ({
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

export const loadTechniqueClusterBankDiscoveryFixedInputs = async ({
  techniqueContractPath,
  fixedContractPath,
  planPath,
  cwd = process.cwd(),
} = {}) => {
  const [fixedContract, planArtifact] = await Promise.all([
    loadTp12NoStopFixedResearchContract({ contractPath: fixedContractPath, cwd }),
    loadTechniqueClusterBankDiscoveryPlan({ planPath, cwd }),
  ])
  return {
    fixedContract,
    planArtifact,
    techniqueContractPath: path.resolve(cwd, toText(techniqueContractPath)),
  }
}
