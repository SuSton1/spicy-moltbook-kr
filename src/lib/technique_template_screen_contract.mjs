import crypto from "node:crypto"
import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  buildTp12NoStopLookbackCandidateRollingContract,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import { resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"
import {
  parseTechniqueBankId,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_TEMPLATE_SCREEN_PLAN_KIND = "technique_template_screen_plan_v1"
export const TECHNIQUE_TEMPLATE_SCREEN_MANIFEST_KIND = "technique_template_screen_manifest_v1"

const normalizeTemplateSlug = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTechniqueTemplateScreenRunSlug = ({
  value,
  maxLength = 96,
} = {}) => {
  const normalized = normalizeTemplateSlug(value) || "template"
  const hash = crypto
    .createHash("sha256")
    .update(toText(value))
    .digest("hex")
    .slice(0, 8)
  const safeMaxLength = Number.isFinite(Number(maxLength))
    ? Math.max(16, Math.trunc(Number(maxLength)))
    : 96
  const prefixLength = Math.max(1, safeMaxLength - hash.length - 1)
  const prefix = normalized.slice(0, prefixLength) || "template"
  return `${prefix}_${hash}`.slice(0, safeMaxLength)
}

const assertPlan = (planArtifact) => {
  if (!planArtifact || typeof planArtifact !== "object") {
    throw new Error("planArtifact is required")
  }
  if (toText(planArtifact.kind) !== TECHNIQUE_TEMPLATE_SCREEN_PLAN_KIND) {
    throw new Error(
      `Expected plan kind ${TECHNIQUE_TEMPLATE_SCREEN_PLAN_KIND}, got ${toText(planArtifact.kind) || "<empty>"}`,
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

export const loadTechniqueTemplateScreenPlan = async ({
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

export const selectTechniqueTemplateScreenPlanTemplates = ({
  planArtifact,
  selectedTemplateIds = [],
  maxTemplates = null,
} = {}) => {
  const selectedTemplates = assertPlan(planArtifact)
  const requestedTemplateIds = uniqueSortedStrings(
    Array.isArray(selectedTemplateIds) ? selectedTemplateIds : [],
  )
  const shortlistIds = new Set(selectedTemplates.map((entry) => toText(entry.candidateTemplateId)))
  for (const templateId of requestedTemplateIds) {
    if (!shortlistIds.has(templateId)) {
      throw new Error(`Requested candidateTemplateId is not present in plan artifact: ${templateId}`)
    }
  }
  const chosenTemplates = selectedTemplates
    .filter(
      (entry) =>
        requestedTemplateIds.length < 1 || requestedTemplateIds.includes(toText(entry.candidateTemplateId)),
    )
    .slice()
    .sort(comparePlanTemplates)
  if (chosenTemplates.length < 1) {
    throw new Error("No templates remain after applying plan selection filters")
  }
  if (!Number.isFinite(Number(maxTemplates)) || Number(maxTemplates) <= 0) {
    return chosenTemplates
  }
  return chosenTemplates.slice(0, Number(maxTemplates))
}

export const buildTechniqueTemplateRollingContract = ({
  techniqueContract,
  planArtifact,
  templateId = null,
  selectedTemplate = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  const chosenTemplate =
    selectedTemplate ??
    selectTechniqueTemplateScreenPlanTemplates({
      planArtifact,
      selectedTemplateIds: templateId ? [templateId] : [],
      maxTemplates: 1,
    })[0]
  if (!chosenTemplate || typeof chosenTemplate !== "object") {
    throw new Error("selectedTemplate is required")
  }

  const concreteBank = parseTechniqueBankId(chosenTemplate.bankId)
  const resolvedScopeId = resolveTp12NoStopScopeSpec(concreteBank.scopeId)?.scopeId
  if (!resolvedScopeId) {
    throw new Error(`Unknown technique template scopeId=${concreteBank.scopeId}`)
  }
  if (resolvedScopeId !== concreteBank.scopeId) {
    throw new Error(`Technique template scopeId must already be concrete: ${concreteBank.scopeId}`)
  }
  const baseRolling = buildTp12NoStopLookbackCandidateRollingContract({
    ladderContract: techniqueContract.baseLookbackLadderContract,
    candidateId: concreteBank.lookbackCandidateId,
  })
  const templateScreenConfig =
    chosenTemplate.templateScreenConfig && typeof chosenTemplate.templateScreenConfig === "object"
      ? chosenTemplate.templateScreenConfig
      : techniqueContract.templateScreen
  if (!templateScreenConfig || typeof templateScreenConfig !== "object") {
    throw new Error("technique template screen config is required")
  }
  const templateSlug = normalizeTemplateSlug(chosenTemplate.candidateTemplateId) || "template"

  return {
    ...JSON.parse(JSON.stringify(baseRolling)),
    contractId: `${toText(techniqueContract.contractId)}_${templateSlug}`,
    updatedAt: toText(techniqueContract.updatedAt),
    scopeId: resolvedScopeId,
    searchContract: {
      ...(baseRolling?.searchContract ?? {}),
      screenMaxSearchStates:
        Number(templateScreenConfig.screenMaxSearchStates ?? 0) ||
        Number(baseRolling?.searchContract?.screenMaxSearchStates ?? 0),
      configPath: path.resolve(toText(baseRolling?.searchContract?.configPath)),
    },
    techniqueTemplateScreen: {
      kind: "technique_template_screen_contract_context_v1",
      bankId: concreteBank.bankId,
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
      `Derived technique template rolling contract for candidateTemplateId=${toText(chosenTemplate.candidateTemplateId)}`,
      `bankId=${concreteBank.bankId}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concreteBank.lookbackCandidateId}`,
      ...((Array.isArray(techniqueContract.hardStops) ? techniqueContract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(techniqueContract.contractPath)}`,
      `bankId=${concreteBank.bankId}`,
      `candidateTemplateId=${toText(chosenTemplate.candidateTemplateId)}`,
      `scopeId=${resolvedScopeId}`,
      `lookbackCandidateId=${concreteBank.lookbackCandidateId}`,
      `yearsWithHitGe2=${Number(chosenTemplate.yearsWithHitGe2 ?? 0) || 0}`,
      ...((Array.isArray(baseRolling?.notes) ? baseRolling.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTechniqueTemplateRollingContract = async ({
  techniqueContract,
  planArtifact,
  templateId,
  outPath,
} = {}) => {
  const payload = buildTechniqueTemplateRollingContract({
    techniqueContract,
    planArtifact,
    templateId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTechniqueTemplateRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
