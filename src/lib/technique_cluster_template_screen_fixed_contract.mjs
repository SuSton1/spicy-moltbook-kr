import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  loadTp12NoStopFixedResearchContract,
} from "./tp12_no_stop_fixed_contract.mjs"
import { resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"
import {
  parseTechniqueBankId,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"
import { TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_PLAN_KIND } from "./technique_cluster_template_screen_contract.mjs"

export const TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_FIXED_MANIFEST_KIND = "technique_cluster_template_screen_fixed_manifest_v1"

const assertPlan = (planArtifact) => {
  if (!planArtifact || typeof planArtifact !== "object") {
    throw new Error("planArtifact is required")
  }
  if (toText(planArtifact.kind) !== TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_PLAN_KIND) {
    throw new Error(
      `Expected plan kind ${TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_PLAN_KIND}, got ${toText(planArtifact.kind) || "<empty>"}`,
    )
  }
  const selectedTemplates = Array.isArray(planArtifact.selectedTemplates) ? planArtifact.selectedTemplates : []
  if (selectedTemplates.length < 1) {
    throw new Error("planArtifact.selectedTemplates is empty")
  }
  return selectedTemplates
}

const comparePlanTemplates = (left, right) => {
  const leftRank = Number(left?.planRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.planRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  return String(left?.candidateTemplateId ?? "").localeCompare(String(right?.candidateTemplateId ?? ""))
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

export const loadTechniqueClusterTemplateScreenPlan = async ({
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

export const selectTechniqueClusterTemplateScreenFixedPlanTemplates = ({
  planArtifact,
  selectedTemplateIds = [],
  maxTemplates = null,
} = {}) => {
  const selectedTemplates = assertPlan(planArtifact)
  const requestedTemplateIds = uniqueSortedStrings(Array.isArray(selectedTemplateIds) ? selectedTemplateIds : [])
  const knownIds = new Set(selectedTemplates.map((entry) => toText(entry.candidateTemplateId)))
  for (const templateId of requestedTemplateIds) {
    if (!knownIds.has(templateId)) {
      throw new Error(`Requested candidateTemplateId is not present in plan artifact: ${templateId}`)
    }
  }
  const chosen = selectedTemplates
    .filter((entry) => requestedTemplateIds.length < 1 || requestedTemplateIds.includes(toText(entry.candidateTemplateId)))
    .slice()
    .sort(comparePlanTemplates)
  if (chosen.length < 1) {
    throw new Error("No cluster template screen entries remain after applying plan selection filters")
  }
  if (!Number.isFinite(Number(maxTemplates)) || Number(maxTemplates) <= 0) return chosen
  return chosen.slice(0, Number(maxTemplates))
}

export const buildTechniqueClusterTemplateFixedContract = ({
  techniqueContract,
  fixedContract,
  planArtifact,
  templateId = null,
  selectedTemplate = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (!fixedContract || typeof fixedContract !== "object") {
    throw new Error("fixedContract is required")
  }
  const chosenTemplate =
    selectedTemplate ??
    selectTechniqueClusterTemplateScreenFixedPlanTemplates({
      planArtifact,
      selectedTemplateIds: templateId ? [templateId] : [],
      maxTemplates: 1,
    })[0]
  if (!chosenTemplate || typeof chosenTemplate !== "object") {
    throw new Error("selectedTemplate is required")
  }
  assertTechniqueClauseContext(
    chosenTemplate,
    `technique cluster-template fixed entry ${toText(chosenTemplate.candidateTemplateId) || "<unknown>"}`,
  )
  const concreteBank = parseTechniqueBankId(chosenTemplate.bankId)
  const resolvedScopeId = resolveTp12NoStopScopeSpec(concreteBank.scopeId)?.scopeId
  if (!resolvedScopeId) {
    throw new Error(`Unknown technique cluster template scopeId=${concreteBank.scopeId}`)
  }
  if (resolvedScopeId !== concreteBank.scopeId) {
    throw new Error(`Technique cluster template scopeId must already be concrete: ${concreteBank.scopeId}`)
  }
  const templateScreenConfig =
    chosenTemplate.templateScreenConfig && typeof chosenTemplate.templateScreenConfig === "object"
      ? chosenTemplate.templateScreenConfig
      : techniqueContract.templateScreen
  if (!templateScreenConfig || typeof templateScreenConfig !== "object") {
    throw new Error("cluster template screen config is required")
  }
  return {
    ...JSON.parse(JSON.stringify(fixedContract)),
    contractId: `${toText(techniqueContract.contractId)}_${toText(chosenTemplate.candidateTemplateId)}`,
    updatedAt: toText(techniqueContract.updatedAt || fixedContract.updatedAt),
    scopeId: resolvedScopeId,
    yearHitMetric: toText(techniqueContract.yearHitMetric || fixedContract.yearHitMetric || "hit_rows"),
    searchContract: {
      ...(fixedContract?.searchContract ?? {}),
      screenMaxSearchStates:
        Number(templateScreenConfig.screenMaxSearchStates ?? 0) ||
        Number(fixedContract?.searchContract?.screenMaxSearchStates ?? 0),
      configPath: path.resolve(toText(fixedContract?.searchContract?.configPath)),
    },
    techniqueClusterTemplateScreen: {
      kind: "technique_cluster_template_screen_contract_context_v1",
      bankId: concreteBank.bankId,
      sourceBankId: toText(chosenTemplate.sourceBankId) || concreteBank.bankId,
      sourceClusterBankId: toText(chosenTemplate.sourceClusterBankId) || null,
      clusterId: toText(chosenTemplate.clusterId) || null,
      clusterRole: toText(chosenTemplate.clusterRole) || null,
      selectionReason: toText(chosenTemplate.selectionReason) || null,
      entryType: toText(chosenTemplate.entryType) || "cluster_lane",
      candidateTemplateId: toText(chosenTemplate.candidateTemplateId),
      seedId: toText(chosenTemplate.seedId),
      mechanismId: concreteBank.mechanismId,
      scopeId: concreteBank.scopeId,
      lookbackCandidateId: concreteBank.lookbackCandidateId,
      observedScopeIds: Array.isArray(chosenTemplate.observedScopeIds)
        ? chosenTemplate.observedScopeIds.slice()
        : [],
      observedLookbackCandidateIds: Array.isArray(chosenTemplate.observedLookbackCandidateIds)
        ? chosenTemplate.observedLookbackCandidateIds.slice()
        : [],
      observedBankIds: Array.isArray(chosenTemplate.observedBankIds)
        ? chosenTemplate.observedBankIds.slice()
        : [],
      observedEventCount: Number(chosenTemplate.observedEventCount ?? 0) || 0,
      observedHitCount: Number(chosenTemplate.observedHitCount ?? 0) || 0,
      observedHitRate: Number(chosenTemplate.observedHitRate ?? 0) || 0,
      totalEventCount: Number(chosenTemplate.totalEventCount ?? 0) || 0,
      totalHitCount: Number(chosenTemplate.totalHitCount ?? 0) || 0,
      totalHitRate: Number(chosenTemplate.totalHitRate ?? 0) || 0,
      coveredYears: Number(chosenTemplate.coveredYears ?? 0) || 0,
      yearsWithHitGe2: Number(chosenTemplate.yearsWithHitGe2 ?? 0) || 0,
      yearsWithHitGe1: Number(chosenTemplate.yearsWithHitGe1 ?? 0) || 0,
      yearsWithEventCountGeMin: Number(chosenTemplate.yearsWithEventCountGeMin ?? 0) || 0,
      signalsPer20TradingDays: Number(chosenTemplate.signalsPer20TradingDays ?? 0) || 0,
      maxYearShare: Number(chosenTemplate.maxYearShare ?? 0) || 0,
      allClauseIds: Array.isArray(chosenTemplate.allClauseIds) ? chosenTemplate.allClauseIds.slice() : [],
      anchorClauseIds: Array.isArray(chosenTemplate.anchorClauseIds)
        ? chosenTemplate.anchorClauseIds.slice()
        : [],
      retestClauseIds: Array.isArray(chosenTemplate.retestClauseIds)
        ? chosenTemplate.retestClauseIds.slice()
        : [],
      compressionClauseIds: Array.isArray(chosenTemplate.compressionClauseIds)
        ? chosenTemplate.compressionClauseIds.slice()
        : [],
      confirmClauseIds: Array.isArray(chosenTemplate.confirmClauseIds)
        ? chosenTemplate.confirmClauseIds.slice()
        : [],
      invalidateClauseIds: Array.isArray(chosenTemplate.invalidateClauseIds)
        ? chosenTemplate.invalidateClauseIds.slice()
        : [],
      templateScreenConfig: { ...templateScreenConfig },
    },
    hardStops: [
      `Derived technique cluster template fixed contract for candidateTemplateId=${toText(chosenTemplate.candidateTemplateId)}`,
      `bankId=${concreteBank.bankId}`,
      `sourceClusterBankId=${toText(chosenTemplate.sourceClusterBankId) || "<none>"}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concreteBank.lookbackCandidateId}`,
      ...((Array.isArray(techniqueContract.hardStops) ? techniqueContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(fixedContract.hardStops) ? fixedContract.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(techniqueContract.contractPath)}`,
      `fixedResearchContractPath=${toText(fixedContract.contractPath)}`,
      `candidateTemplateId=${toText(chosenTemplate.candidateTemplateId)}`,
      `sourceClusterBankId=${toText(chosenTemplate.sourceClusterBankId) || "<none>"}`,
      `clusterRole=${toText(chosenTemplate.clusterRole) || "<none>"}`,
      ...((Array.isArray(fixedContract.notes) ? fixedContract.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTechniqueClusterTemplateFixedContract = async ({
  techniqueContract,
  fixedContract,
  planArtifact,
  templateId,
  outPath,
} = {}) => {
  const payload = buildTechniqueClusterTemplateFixedContract({
    techniqueContract,
    fixedContract,
    planArtifact,
    templateId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTechniqueClusterTemplateFixedContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}

export const loadTechniqueClusterTemplateFixedInputs = async ({
  fixedContractPath,
  planPath,
  cwd = process.cwd(),
} = {}) => {
  const [fixedContract, planArtifact] = await Promise.all([
    loadTp12NoStopFixedResearchContract({ contractPath: fixedContractPath, cwd }),
    loadTechniqueClusterTemplateScreenPlan({ planPath, cwd }),
  ])
  return {
    fixedContract,
    planArtifact,
  }
}
