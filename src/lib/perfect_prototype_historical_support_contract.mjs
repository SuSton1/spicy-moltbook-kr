import {
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  normalizePerfectPrototypeSupportCases,
} from "./perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeSupportAnchorCohort } from "./perfect_prototype_support_anchor_cohort.mjs"

const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const resolveTargetCaseIds = ({
  requiredSupportCaseIds = [],
  historicalSupportCaseId = null,
} = {}) => {
  const explicitCaseIds = uniqueSorted(requiredSupportCaseIds)
  if (explicitCaseIds.length > 0) return explicitCaseIds
  const historicalCaseId = toText(historicalSupportCaseId)
  if (historicalCaseId) return [historicalCaseId]
  return [PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID]
}

export const resolvePerfectPrototypeHistoricalSupportContract = ({
  familyId = null,
  supportCases = [],
  requiredSupportCaseIds = [],
  historicalSupportCaseId = null,
  requireHistoricalSupport = false,
} = {}) => {
  const normalizedFamilyId = toText(familyId)
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases)
  const targetCaseIds = resolveTargetCaseIds({
    requiredSupportCaseIds,
    historicalSupportCaseId,
  })
  const selectedCases = normalizedSupportCases.filter((entry) => {
    if (!targetCaseIds.includes(entry.caseId)) return false
    if (!normalizedFamilyId || entry.familyIds.length < 1) return true
    return entry.familyIds.includes(normalizedFamilyId)
  })
  const supportAnchorCohort = buildPerfectPrototypeSupportAnchorCohort({
    familyId: normalizedFamilyId,
    supportCases: selectedCases,
  })
  const tokenSet = supportAnchorCohort.tokenSet
  return {
    enabled: requireHistoricalSupport === true,
    familyId: normalizedFamilyId,
    requiredSupportCaseIds: targetCaseIds,
    resolvedSupportCaseIds: selectedCases.map((entry) => entry.caseId),
    matchedSupportCaseCount: selectedCases.length,
    tokenSet,
    tokenTypeCounts: supportAnchorCohort.tokenTypeCounts,
    hasResolvableSupportCases: selectedCases.length > 0,
  }
}

export const evaluatePerfectPrototypeHistoricalSupportContract = ({
  familyId = null,
  tokens = [],
  supportCases = [],
  requiredSupportCaseIds = [],
  historicalSupportCaseId = null,
  requireHistoricalSupport = false,
} = {}) => {
  const contract = resolvePerfectPrototypeHistoricalSupportContract({
    familyId,
    supportCases,
    requiredSupportCaseIds,
    historicalSupportCaseId,
    requireHistoricalSupport,
  })
  if (contract.enabled !== true) {
    return {
      ...contract,
      ok: true,
      historicalSupportMatched: false,
      missingTokens: [],
      tokenTypeCounts: contract.tokenTypeCounts,
      reason: null,
    }
  }
  if (contract.hasResolvableSupportCases !== true) {
    return {
      ...contract,
      ok: false,
      historicalSupportMatched: false,
      missingTokens: [],
      tokenTypeCounts: contract.tokenTypeCounts,
      reason: "unsat_historical_support_contract_missing",
    }
  }
  const tokenSet = contract.tokenSet
  const normalizedTokens = uniqueSorted(tokens)
  const missingTokens = normalizedTokens.filter((token) => !tokenSet.has(token))
  return {
    ...contract,
    ok: missingTokens.length < 1,
    historicalSupportMatched: missingTokens.length < 1,
    missingTokens,
    tokenTypeCounts: contract.tokenTypeCounts,
    reason: missingTokens.length < 1 ? null : "unsat_historical_support",
  }
}
