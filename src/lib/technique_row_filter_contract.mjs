import {
  buildTechniqueTemplateAllClauseIds,
  buildTechniqueTemplateClauseGroups,
} from "./technique_clause_groups.mjs"
import { toText } from "./technique_common.mjs"

const normalizeContext = ({
  rawContext,
  kind,
  contextKey,
  identifier,
} = {}) => {
  if (!rawContext || typeof rawContext !== "object") return null
  const clauseGroups = buildTechniqueTemplateClauseGroups(rawContext)
  const allClauseIds = buildTechniqueTemplateAllClauseIds({
    ...rawContext,
    ...clauseGroups,
  })
  const normalized = {
    kind,
    contextKey,
    identifier: toText(identifier),
    bankId: toText(rawContext.bankId),
    sourceBankId: toText(rawContext.sourceBankId ?? rawContext.bankId) || null,
    sourceClusterBankId: toText(rawContext.sourceClusterBankId ?? rawContext.clusterBankId) || null,
    clusterBankId: toText(rawContext.clusterBankId) || null,
    clusterId: toText(rawContext.clusterId) || null,
    entryType: toText(rawContext.entryType) || null,
    candidateTemplateId: toText(rawContext.candidateTemplateId) || null,
    seedId: toText(rawContext.seedId) || null,
    mechanismId: toText(rawContext.mechanismId),
    scopeId: toText(rawContext.scopeId),
    lookbackCandidateId: toText(rawContext.lookbackCandidateId),
    allClauseIds,
    anchorClauseIds: clauseGroups.anchorClauseIds,
    retestClauseIds: clauseGroups.retestClauseIds,
    compressionClauseIds: clauseGroups.compressionClauseIds,
    confirmClauseIds: clauseGroups.confirmClauseIds,
    invalidateClauseIds: clauseGroups.invalidateClauseIds,
  }
  const missingFields = []
  if (!normalized.identifier) missingFields.push("identifier")
  if (!normalized.bankId) missingFields.push("bankId")
  if (!normalized.mechanismId) missingFields.push("mechanismId")
  if (!normalized.scopeId) missingFields.push("scopeId")
  if (!normalized.lookbackCandidateId) missingFields.push("lookbackCandidateId")
  if (normalized.allClauseIds.length < 1) missingFields.push("allClauseIds")
  if (missingFields.length > 0) {
    throw new Error(
      `Invalid ${contextKey}: missing ${missingFields.join(", ")}`,
    )
  }
  return normalized
}

export const resolveTechniqueRowFilterContext = (contract = {}) => {
  const contexts = [
    normalizeContext({
      rawContext: contract?.techniqueTemplateScreen,
      kind: "template_screen",
      contextKey: "techniqueTemplateScreen",
      identifier: contract?.techniqueTemplateScreen?.candidateTemplateId,
    }),
    normalizeContext({
      rawContext: contract?.techniqueClusterTemplateScreen,
      kind: "cluster_template_screen",
      contextKey: "techniqueClusterTemplateScreen",
      identifier: contract?.techniqueClusterTemplateScreen?.candidateTemplateId,
    }),
    normalizeContext({
      rawContext: contract?.techniqueBankDiscovery,
      kind: "bank_discovery",
      contextKey: "techniqueBankDiscovery",
      identifier: contract?.techniqueBankDiscovery?.bankId,
    }),
    normalizeContext({
      rawContext: contract?.techniqueClusterBankDiscovery,
      kind: "cluster_bank_discovery",
      contextKey: "techniqueClusterBankDiscovery",
      identifier:
        contract?.techniqueClusterBankDiscovery?.clusterBankId ??
        contract?.techniqueClusterBankDiscovery?.bankId,
    }),
  ].filter(Boolean)
  if (contexts.length > 1) {
    throw new Error(
      `Expected at most one technique row-filter context, found ${contexts
        .map((context) => context.contextKey)
        .join(", ")}`,
    )
  }
  return contexts[0] ?? null
}

export const hasTechniqueRowFilterContext = (contract = {}) =>
  resolveTechniqueRowFilterContext(contract) !== null
