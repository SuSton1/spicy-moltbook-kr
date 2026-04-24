import { TECHNIQUE_CLUSTER_BANK_SHORTLIST_KIND } from "./technique_cluster_bank_shortlist.mjs"
import { toText, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_CLUSTER_BANK_DISCOVERY_PLAN_KIND = "technique_cluster_bank_discovery_plan_v1"

const compareClusterLane = (left, right) => {
  const leftRank = Number(left?.laneRank ?? left?.clusterRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.laneRank ?? right?.clusterRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  return String(left?.clusterId ?? "").localeCompare(String(right?.clusterId ?? ""))
}

const compareReserveBank = (left, right) => {
  const leftRank = Number(left?.reserveRank ?? Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right?.reserveRank ?? Number.MAX_SAFE_INTEGER)
  if (leftRank !== rightRank) return leftRank - rightRank
  return String(left?.bankId ?? "").localeCompare(String(right?.bankId ?? ""))
}

const normalizeSelectedTemplateEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).map((entry) => ({
    planRank: Number(entry?.planRank ?? 0) || 0,
    clusterRole: toText(entry?.clusterRole) || null,
    selectionReason: toText(entry?.selectionReason) || null,
    candidateTemplateId: toText(entry?.candidateTemplateId),
    seedId: toText(entry?.seedId),
    mechanismId: toText(entry?.mechanismId),
    bankId: toText(entry?.sourceBankId ?? entry?.bankId),
    sourceBankId: toText(entry?.sourceBankId ?? entry?.bankId),
    observedBankIds: Array.isArray(entry?.observedBankIds) ? entry.observedBankIds.slice() : [],
    observedScopeIds: Array.isArray(entry?.observedScopeIds) ? entry.observedScopeIds.slice() : [],
    observedLookbackCandidateIds: Array.isArray(entry?.observedLookbackCandidateIds)
      ? entry.observedLookbackCandidateIds.slice()
      : [],
    observedDecisionDayCount: Number(entry?.observedDecisionDayCount ?? 0) || 0,
    observedEventCount: Number(entry?.observedEventCount ?? 0) || 0,
    observedHitCount: Number(entry?.observedHitCount ?? 0) || 0,
    observedHitRate: Number(entry?.observedHitRate ?? 0) || 0,
    totalEventCount: Number(entry?.totalEventCount ?? 0) || 0,
    totalHitCount: Number(entry?.totalHitCount ?? 0) || 0,
    totalHitRate: Number(entry?.totalHitRate ?? 0) || 0,
    coveredYears: Number(entry?.coveredYears ?? 0) || 0,
    yearsWithHitGe2: Number(entry?.yearsWithHitGe2 ?? 0) || 0,
    yearsWithHitGe1: Number(entry?.yearsWithHitGe1 ?? 0) || 0,
    yearsWithEventCountGeMin: Number(entry?.yearsWithEventCountGeMin ?? 0) || 0,
    signalsPer20TradingDays: Number(entry?.signalsPer20TradingDays ?? 0) || 0,
    maxYearShare: Number(entry?.maxYearShare ?? 0) || 0,
    allClauseIds: Array.isArray(entry?.allClauseIds) ? entry.allClauseIds.slice() : [],
    anchorClauseIds: Array.isArray(entry?.anchorClauseIds) ? entry.anchorClauseIds.slice() : [],
    retestClauseIds: Array.isArray(entry?.retestClauseIds) ? entry.retestClauseIds.slice() : [],
    compressionClauseIds: Array.isArray(entry?.compressionClauseIds) ? entry.compressionClauseIds.slice() : [],
    confirmClauseIds: Array.isArray(entry?.confirmClauseIds) ? entry.confirmClauseIds.slice() : [],
    invalidateClauseIds: Array.isArray(entry?.invalidateClauseIds) ? entry.invalidateClauseIds.slice() : [],
    invalidateProfile: Array.isArray(entry?.invalidateProfile) ? entry.invalidateProfile.slice() : [],
  }))

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

export const buildTechniqueClusterBankDiscoveryPlan = ({
  techniqueContract,
  shortlistArtifact,
  selectedClusterIds = null,
  selectedReserveBankIds = null,
  maxClusterBanks = null,
  maxReserveBanks = null,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (!shortlistArtifact || typeof shortlistArtifact !== "object") {
    throw new Error("shortlistArtifact is required")
  }
  if (toText(shortlistArtifact.kind) !== TECHNIQUE_CLUSTER_BANK_SHORTLIST_KIND) {
    throw new Error(
      `Expected shortlist kind ${TECHNIQUE_CLUSTER_BANK_SHORTLIST_KIND}, got ${toText(shortlistArtifact.kind) || "<empty>"}`,
    )
  }
  const bankDiscoveryConfig = techniqueContract.bankDiscovery
  if (!bankDiscoveryConfig || typeof bankDiscoveryConfig !== "object") {
    throw new Error("techniqueContract.bankDiscovery is required")
  }

  const selectedClusterLanes = Array.isArray(shortlistArtifact.selectedClusterLanes)
    ? shortlistArtifact.selectedClusterLanes.slice().sort(compareClusterLane)
    : []
  const reserveBanks = Array.isArray(shortlistArtifact.reserveBanks)
    ? shortlistArtifact.reserveBanks.slice().sort(compareReserveBank)
    : []
  if (selectedClusterLanes.length < 1 && reserveBanks.length < 1) {
    throw new Error("cluster shortlist produced zero selected cluster lanes and zero reserve banks")
  }

  const requestedClusterIds = uniqueSortedStrings(Array.isArray(selectedClusterIds) ? selectedClusterIds : [])
  const requestedReserveBankIds = uniqueSortedStrings(
    Array.isArray(selectedReserveBankIds) ? selectedReserveBankIds : [],
  )
  const knownClusterIds = new Set(selectedClusterLanes.map((entry) => toText(entry.clusterId)))
  const knownReserveBankIds = new Set(reserveBanks.map((entry) => toText(entry.bankId)))
  for (const clusterId of requestedClusterIds) {
    if (!knownClusterIds.has(clusterId)) {
      throw new Error(`Requested clusterId is not present in shortlist artifact: ${clusterId}`)
    }
  }
  for (const bankId of requestedReserveBankIds) {
    if (!knownReserveBankIds.has(bankId)) {
      throw new Error(`Requested reserve bankId is not present in shortlist artifact: ${bankId}`)
    }
  }

  const chosenClusterLanes = selectedClusterLanes
    .filter((entry) => requestedClusterIds.length < 1 || requestedClusterIds.includes(toText(entry.clusterId)))
    .slice(0, Number.isFinite(Number(maxClusterBanks)) && Number(maxClusterBanks) > 0 ? Number(maxClusterBanks) : selectedClusterLanes.length)
  const chosenReserveBanks = reserveBanks
    .filter((entry) => requestedReserveBankIds.length < 1 || requestedReserveBankIds.includes(toText(entry.bankId)))
    .slice(0, Number.isFinite(Number(maxReserveBanks)) && Number(maxReserveBanks) > 0 ? Number(maxReserveBanks) : reserveBanks.length)

  const selectedClusterBanks = []
  for (const lane of chosenClusterLanes) {
    assertTechniqueClauseContext(
      lane,
      `technique cluster lane ${toText(lane.clusterId) || toText(lane.sourceBankId) || "<unknown>"}`,
    )
    selectedClusterBanks.push({
      planRank: selectedClusterBanks.length + 1,
      clusterBankId: `${toText(lane.sourceBankId)}::cluster::${toText(lane.clusterId)}`,
      entryType: "cluster_lane",
      selectionPolicy: "cluster_lane",
      bankId: toText(lane.sourceBankId),
      sourceBankId: toText(lane.sourceBankId),
      clusterId: toText(lane.clusterId),
      clusterFingerprint: toText(lane.clusterFingerprint),
      mechanismId: toText(lane.mechanismId),
      scopeId: toText(lane.scopeId),
      lookbackCandidateId: toText(lane.lookbackCandidateId),
      topTemplateId: toText(lane.leaderTemplateId) || null,
      leaderTemplateId: toText(lane.leaderTemplateId) || null,
      breadthTemplateId: toText(lane.breadthTemplateId) || null,
      shortlistedTemplateIds: Array.isArray(lane.memberTemplateIds) ? lane.memberTemplateIds.slice() : [],
      shortlistedTemplateCount: Number(lane.candidateTemplateCount ?? 0) || 0,
      selectedTemplateIds: normalizeSelectedTemplateEntries(lane.selectedTemplateEntries).map(
        (entry) => entry.candidateTemplateId,
      ),
      selectedTemplateEntries: normalizeSelectedTemplateEntries(lane.selectedTemplateEntries),
      observedScopeIds: Array.isArray(lane.observedScopeIds) ? lane.observedScopeIds.slice() : [],
      observedLookbackCandidateIds: Array.isArray(lane.observedLookbackCandidateIds)
        ? lane.observedLookbackCandidateIds.slice()
        : [],
      observedBankIds: Array.isArray(lane.observedBankIds) ? lane.observedBankIds.slice() : [],
      allClauseIds: Array.isArray(lane.allClauseIds) ? lane.allClauseIds.slice() : [],
      anchorClauseIds: Array.isArray(lane.anchorClauseIds) ? lane.anchorClauseIds.slice() : [],
      retestClauseIds: Array.isArray(lane.retestClauseIds) ? lane.retestClauseIds.slice() : [],
      compressionClauseIds: Array.isArray(lane.compressionClauseIds) ? lane.compressionClauseIds.slice() : [],
      confirmClauseIds: Array.isArray(lane.confirmClauseIds) ? lane.confirmClauseIds.slice() : [],
      invalidateClauseIds: Array.isArray(lane.invalidateClauseIds) ? lane.invalidateClauseIds.slice() : [],
      sourceBankSummary: lane?.sourceBankSummary && typeof lane.sourceBankSummary === "object"
        ? { ...lane.sourceBankSummary }
        : null,
      bankDiscoveryConfig: { ...bankDiscoveryConfig },
    })
  }
  for (const reserveBank of chosenReserveBanks) {
    assertTechniqueClauseContext(
      reserveBank,
      `technique reserve bank ${toText(reserveBank.bankId) || "<unknown>"}`,
    )
    selectedClusterBanks.push({
      planRank: selectedClusterBanks.length + 1,
      clusterBankId: `${toText(reserveBank.bankId)}::reserve::${toText(reserveBank.mechanismId)}`,
      entryType: "reserve_bank",
      selectionPolicy: "promotion_pass_bank_reserve",
      bankId: toText(reserveBank.bankId),
      sourceBankId: toText(reserveBank.bankId),
      clusterId: null,
      clusterFingerprint: null,
      mechanismId: toText(reserveBank.mechanismId),
      scopeId: toText(reserveBank.scopeId),
      lookbackCandidateId: toText(reserveBank.lookbackCandidateId),
      topTemplateId: toText(reserveBank.topTemplateId) || null,
      leaderTemplateId: toText(reserveBank.selectedTemplateEntries?.[0]?.candidateTemplateId) || null,
      breadthTemplateId: toText(reserveBank.selectedTemplateEntries?.[1]?.candidateTemplateId) || null,
      shortlistedTemplateIds: Array.isArray(reserveBank.shortlistedTemplateIds)
        ? reserveBank.shortlistedTemplateIds.slice()
        : [],
      shortlistedTemplateCount: Number(reserveBank.shortlistedTemplateCount ?? 0) || 0,
      selectedTemplateIds: Array.isArray(reserveBank.selectedTemplateIds)
        ? reserveBank.selectedTemplateIds.slice()
        : [],
      selectedTemplateEntries: normalizeSelectedTemplateEntries(reserveBank.selectedTemplateEntries),
      observedScopeIds: Array.isArray(reserveBank.observedScopeIds)
        ? reserveBank.observedScopeIds.slice()
        : [toText(reserveBank.scopeId)].filter(Boolean),
      observedLookbackCandidateIds: Array.isArray(reserveBank.observedLookbackCandidateIds)
        ? reserveBank.observedLookbackCandidateIds.slice()
        : [toText(reserveBank.lookbackCandidateId)].filter(Boolean),
      observedBankIds: Array.isArray(reserveBank.observedBankIds)
        ? reserveBank.observedBankIds.slice()
        : [toText(reserveBank.bankId)].filter(Boolean),
      allClauseIds: Array.isArray(reserveBank.allClauseIds) ? reserveBank.allClauseIds.slice() : [],
      anchorClauseIds: Array.isArray(reserveBank.anchorClauseIds) ? reserveBank.anchorClauseIds.slice() : [],
      retestClauseIds: Array.isArray(reserveBank.retestClauseIds) ? reserveBank.retestClauseIds.slice() : [],
      compressionClauseIds: Array.isArray(reserveBank.compressionClauseIds)
        ? reserveBank.compressionClauseIds.slice()
        : [],
      confirmClauseIds: Array.isArray(reserveBank.confirmClauseIds) ? reserveBank.confirmClauseIds.slice() : [],
      invalidateClauseIds: Array.isArray(reserveBank.invalidateClauseIds)
        ? reserveBank.invalidateClauseIds.slice()
        : [],
      sourceBankSummary: reserveBank?.sourceBankSummary && typeof reserveBank.sourceBankSummary === "object"
        ? { ...reserveBank.sourceBankSummary }
        : null,
      bankDiscoveryConfig: { ...bankDiscoveryConfig },
    })
  }

  if (selectedClusterBanks.length < 1) {
    throw new Error("No cluster banks remain after applying selection filters")
  }

  return {
    kind: TECHNIQUE_CLUSTER_BANK_DISCOVERY_PLAN_KIND,
    contractId: toText(techniqueContract.contractId),
    shortlistKind: toText(shortlistArtifact.kind),
    shortlistContractId: toText(shortlistArtifact.contractId),
    selectedClusterLaneCount: chosenClusterLanes.length,
    selectedReserveBankCount: chosenReserveBanks.length,
    selectedBankCount: selectedClusterBanks.length,
    selectedClusterBanks,
    bankDiscoveryConfig: { ...bankDiscoveryConfig },
    notes: [
      "Cluster-bank discovery plan preserves cluster lanes and reserve banks as explicit T3 entries.",
      "Reserve banks remain sibling entries and are never merged into cluster-lane unions.",
    ],
  }
}
