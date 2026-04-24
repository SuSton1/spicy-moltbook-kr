import { buildTechniqueBankId, toText, uniqueSortedStrings } from "./technique_common.mjs"

const readClauseArray = (template = {}, field, clauseSetKey) =>
  uniqueSortedStrings(
    Array.isArray(template?.[field])
      ? template[field]
      : Array.isArray(template?.clauseSet?.[clauseSetKey])
        ? template.clauseSet[clauseSetKey]
        : [],
  )

export const buildTechniqueTemplateClauseGroups = (template = {}) => ({
  anchorClauseIds: readClauseArray(template, "anchorClauseIds", "anchor"),
  retestClauseIds: readClauseArray(template, "retestClauseIds", "retest"),
  compressionClauseIds: readClauseArray(template, "compressionClauseIds", "compression"),
  confirmClauseIds: readClauseArray(template, "confirmClauseIds", "confirm"),
  invalidateClauseIds: readClauseArray(template, "invalidateClauseIds", "invalidate"),
})

export const buildTechniqueTemplateAllClauseIds = (template = {}) =>
  uniqueSortedStrings(
    Array.isArray(template?.allClauseIds)
      ? template.allClauseIds
      : Object.values(buildTechniqueTemplateClauseGroups(template)).flatMap((values) => values),
  )

export const buildTechniqueClauseFingerprint = ({
  mechanismId,
  bankId = null,
  anchorClauseIds = [],
  retestClauseIds = [],
  compressionClauseIds = [],
  confirmClauseIds = [],
} = {}) =>
  JSON.stringify({
    mechanismId: toText(mechanismId),
    bankId: toText(bankId) || null,
    anchorClauseIds: uniqueSortedStrings(anchorClauseIds),
    retestClauseIds: uniqueSortedStrings(retestClauseIds),
    compressionClauseIds: uniqueSortedStrings(compressionClauseIds),
    confirmClauseIds: uniqueSortedStrings(confirmClauseIds),
  })

export const buildTechniqueInvalidateProfile = ({ invalidateClauseIds = [] } = {}) =>
  uniqueSortedStrings(invalidateClauseIds)

export const buildTechniqueBreadthSignature = ({
  allClauseIds = [],
  invalidateClauseIds = [],
} = {}) =>
  JSON.stringify({
    allClauseIds: uniqueSortedStrings(allClauseIds),
    invalidateProfile: buildTechniqueInvalidateProfile({ invalidateClauseIds }),
  })

export const resolveTechniqueConcreteBankIds = ({
  mechanismId,
  observedBankIds = [],
  observedScopeIds = [],
  observedLookbackCandidateIds = [],
  scopeCandidates = [],
  lookbackCandidateIds = [],
} = {}) => {
  const concreteObservedBankIds = uniqueSortedStrings(observedBankIds)
  if (concreteObservedBankIds.length > 0) return concreteObservedBankIds
  const concreteScopeIds = uniqueSortedStrings(observedScopeIds.length > 0 ? observedScopeIds : scopeCandidates)
  const concreteLookbackIds = uniqueSortedStrings(
    observedLookbackCandidateIds.length > 0 ? observedLookbackCandidateIds : lookbackCandidateIds,
  )
  if (concreteScopeIds.length === 1 && concreteLookbackIds.length === 1) {
    return [
      buildTechniqueBankId({
        mechanismId,
        scopeId: concreteScopeIds[0],
        lookbackCandidateId: concreteLookbackIds[0],
      }),
    ]
  }
  return []
}
