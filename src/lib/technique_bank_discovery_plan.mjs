import { TECHNIQUE_BANK_SHORTLIST_KIND } from "./technique_bank_builder.mjs"
import {
  parseTechniqueBankId,
  safeRatio,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_BANK_DISCOVERY_PLAN_KIND = "technique_bank_discovery_plan_v1"

const unionStringField = (rows = [], field) =>
  uniqueSortedStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Array.isArray(row?.[field]) ? row[field] : [],
    ),
  )

const sumField = (rows = [], field) =>
  (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row?.[field] ?? 0) || 0), 0)

const compareTemplates = (left, right) => {
  const leftRank = Number(left?.shortlistRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.shortlistRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  const hitRateDelta = Number(right?.observedHitRate ?? 0) - Number(left?.observedHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  return String(left?.candidateTemplateId ?? "").localeCompare(String(right?.candidateTemplateId ?? ""))
}

const compareBanks = (left, right) => {
  const hitRateDelta = Number(right?.bestTemplateHitRate ?? 0) - Number(left?.bestTemplateHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  return String(left?.bankId ?? "").localeCompare(String(right?.bankId ?? ""))
}

export const buildTechniqueBankDiscoveryPlan = ({
  techniqueContract,
  shortlistArtifact,
  selectedBankIds = null,
  maxBanks = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (!shortlistArtifact || typeof shortlistArtifact !== "object") {
    throw new Error("shortlistArtifact is required")
  }
  if (toText(shortlistArtifact.kind) !== TECHNIQUE_BANK_SHORTLIST_KIND) {
    throw new Error(
      `Expected shortlist kind ${TECHNIQUE_BANK_SHORTLIST_KIND}, got ${toText(shortlistArtifact.kind) || "<empty>"}`,
    )
  }
  const bankDiscovery = techniqueContract.bankDiscovery
  if (!bankDiscovery || typeof bankDiscovery !== "object") {
    throw new Error("techniqueContract.bankDiscovery is required")
  }

  const shortlistBanks = Array.isArray(shortlistArtifact.shortlistedBanks)
    ? shortlistArtifact.shortlistedBanks.slice().sort(compareBanks)
    : []
  const shortlistTemplates = Array.isArray(shortlistArtifact.shortlistedTemplates)
    ? shortlistArtifact.shortlistedTemplates.slice()
    : []
  if (shortlistBanks.length < 1) {
    throw new Error("shortlistArtifact.shortlistedBanks is empty")
  }
  if (shortlistTemplates.length < 1) {
    throw new Error("shortlistArtifact.shortlistedTemplates is empty")
  }

  const requestedBankIds = uniqueSortedStrings(
    Array.isArray(selectedBankIds) ? selectedBankIds : [],
  )
  const shortlistedBankIds = new Set(shortlistBanks.map((entry) => entry.bankId))
  for (const bankId of requestedBankIds) {
    if (!shortlistedBankIds.has(bankId)) {
      throw new Error(`Requested bankId is not present in shortlist artifact: ${bankId}`)
    }
  }

  const chosenBanks = shortlistBanks.filter(
    (entry) => requestedBankIds.length < 1 || requestedBankIds.includes(toText(entry.bankId)),
  )
  if (chosenBanks.length < 1) {
    throw new Error("No shortlisted banks remain after applying selection filters")
  }
  const cappedBanks =
    Number.isFinite(Number(maxBanks)) && Number(maxBanks) > 0
      ? chosenBanks.slice(0, Number(maxBanks))
      : chosenBanks

  const templatesByBankId = new Map()
  for (const template of shortlistTemplates) {
    const observedBankIds = uniqueSortedStrings(template?.observedBankIds)
    for (const bankId of observedBankIds) {
      if (!templatesByBankId.has(bankId)) templatesByBankId.set(bankId, [])
      templatesByBankId.get(bankId).push(template)
    }
  }

  const selectedBanks = cappedBanks.map((shortlistedBank, index) => {
    const concrete = parseTechniqueBankId(shortlistedBank.bankId)
    const bankTemplates = (templatesByBankId.get(shortlistedBank.bankId) ?? [])
      .slice()
      .sort(compareTemplates)
    if (bankTemplates.length < 1) {
      throw new Error(`Shortlisted bank ${shortlistedBank.bankId} has zero attached templates`)
    }
    const topTemplate = bankTemplates[0]
    const observedEventCount = sumField(bankTemplates, "observedEventCount")
    const observedHitCount = sumField(bankTemplates, "observedHitCount")
    const bankEntry = {
      planRank: index + 1,
      bankId: concrete.bankId,
      mechanismId: concrete.mechanismId,
      scopeId: concrete.scopeId,
      lookbackCandidateId: concrete.lookbackCandidateId,
      observedScopeIds: unionStringField(bankTemplates, "observedScopeIds"),
      observedLookbackCandidateIds: unionStringField(bankTemplates, "observedLookbackCandidateIds"),
      shortlistedTemplateCount: bankTemplates.length,
      shortlistedTemplateIds: bankTemplates.map((template) => template.candidateTemplateId),
      topTemplateId: topTemplate.candidateTemplateId,
      topTemplateObservedHitRate: Number(topTemplate.observedHitRate ?? 0) || 0,
      topTemplateSignalsPer20TradingDays: Number(topTemplate.signalsPer20TradingDays ?? 0) || 0,
      topTemplateYearsWithHitGe2: Number(topTemplate.yearsWithHitGe2 ?? 0) || 0,
      observedEventCount,
      observedHitCount,
      observedHitRate: safeRatio(observedHitCount, observedEventCount) ?? 0,
      coveredYearsMax: Math.max(...bankTemplates.map((template) => Number(template.coveredYears ?? 0) || 0)),
      yearsWithHitGe2Max: Math.max(...bankTemplates.map((template) => Number(template.yearsWithHitGe2 ?? 0) || 0)),
      allClauseIds: unionStringField(bankTemplates, "allClauseIds"),
      anchorClauseIds: unionStringField(bankTemplates, "anchorClauseIds"),
      retestClauseIds: unionStringField(bankTemplates, "retestClauseIds"),
      compressionClauseIds: unionStringField(bankTemplates, "compressionClauseIds"),
      confirmClauseIds: unionStringField(bankTemplates, "confirmClauseIds"),
      invalidateClauseIds: unionStringField(bankTemplates, "invalidateClauseIds"),
      bankDiscoveryConfig: { ...bankDiscovery },
      notes: [
        "shortlist-driven bank discovery entry",
        "use concrete observed scope/lookback rather than broad seed candidate ranges",
      ],
    }
    if (bankEntry.observedScopeIds.length > 0 && !bankEntry.observedScopeIds.includes(bankEntry.scopeId)) {
      throw new Error(`Observed scope ids for ${bankEntry.bankId} do not include concrete scope ${bankEntry.scopeId}`)
    }
    if (
      bankEntry.observedLookbackCandidateIds.length > 0 &&
      !bankEntry.observedLookbackCandidateIds.includes(bankEntry.lookbackCandidateId)
    ) {
      throw new Error(
        `Observed lookback ids for ${bankEntry.bankId} do not include concrete lookback ${bankEntry.lookbackCandidateId}`,
      )
    }
    return bankEntry
  })

  return {
    kind: TECHNIQUE_BANK_DISCOVERY_PLAN_KIND,
    contractId: toText(techniqueContract.contractId),
    shortlistKind: toText(shortlistArtifact.kind),
    shortlistContractId: toText(shortlistArtifact.contractId),
    shortlistedTemplateCount: Number(shortlistArtifact.shortlistedTemplateCount ?? shortlistTemplates.length) || shortlistTemplates.length,
    shortlistedBankCount: Number(shortlistArtifact.shortlistedBankCount ?? shortlistBanks.length) || shortlistBanks.length,
    selectedBankCount: selectedBanks.length,
    selectedBanks,
    bankDiscoveryConfig: { ...bankDiscovery },
    notes: [
      "This artifact is the shortlist-driven T3 entry plan.",
      "Only selected shortlist banks should advance to T3 bank discovery rolling.",
      "Do not reopen full raw mechanism aggregates from the recurrence screen.",
    ],
  }
}
