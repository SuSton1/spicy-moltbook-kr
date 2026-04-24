import crypto from "node:crypto"

import {
  buildTechniqueTemplateAllClauseIds,
  buildTechniqueTemplateClauseGroups,
  buildTechniqueClauseFingerprint,
  buildTechniqueBreadthSignature,
  buildTechniqueInvalidateProfile,
  resolveTechniqueConcreteBankIds,
} from "./technique_clause_groups.mjs"
import {
  buildTechniqueBankId,
  safeRatio,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_CLUSTER_BANK_SHORTLIST_KIND = "technique_cluster_bank_shortlist_v1"

const summarizeObservedTemplateEvents = (eventRows = []) => {
  const byTemplate = new Map()
  for (const row of Array.isArray(eventRows) ? eventRows : []) {
    const candidateTemplateId = toText(row?.candidateTemplateId)
    if (!candidateTemplateId) continue
    if (!byTemplate.has(candidateTemplateId)) {
      byTemplate.set(candidateTemplateId, {
        observedBankIds: new Set(),
        observedScopeIds: new Set(),
        observedLookbackCandidateIds: new Set(),
        decisionDateKeys: new Set(),
        eventCount: 0,
        hitCount: 0,
      })
    }
    const entry = byTemplate.get(candidateTemplateId)
    const mechanismId = toText(row?.mechanismId)
    const scopeId = toText(row?.scopeId)
    const lookbackCandidateId = toText(row?.lookbackCandidateId)
    if (scopeId) entry.observedScopeIds.add(scopeId)
    if (lookbackCandidateId) entry.observedLookbackCandidateIds.add(lookbackCandidateId)
    if (mechanismId && scopeId && lookbackCandidateId) {
      entry.observedBankIds.add(
        buildTechniqueBankId({
          mechanismId,
          scopeId,
          lookbackCandidateId,
        }),
      )
    } else {
      const bankId = toText(row?.bankId)
      if (bankId) entry.observedBankIds.add(bankId)
    }
    const decisionDateKey = toText(row?.decisionDateKey)
    if (decisionDateKey) entry.decisionDateKeys.add(decisionDateKey)
    entry.eventCount += 1
    if (row?.hitTarget === true) entry.hitCount += 1
  }
  const out = new Map()
  for (const [candidateTemplateId, entry] of byTemplate.entries()) {
    out.set(candidateTemplateId, {
      observedBankIds: uniqueSortedStrings(Array.from(entry.observedBankIds)),
      observedScopeIds: uniqueSortedStrings(Array.from(entry.observedScopeIds)),
      observedLookbackCandidateIds: uniqueSortedStrings(Array.from(entry.observedLookbackCandidateIds)),
      observedDecisionDayCount: entry.decisionDateKeys.size,
      observedEventCount: entry.eventCount,
      observedHitCount: entry.hitCount,
      observedHitRate: safeRatio(entry.hitCount, entry.eventCount) ?? 0,
    })
  }
  return out
}

const compareShortlistRows = (left, right, shortlistConfig) => {
  const hitRateDelta = Number(right.totalHitRate ?? 0) - Number(left.totalHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  const leftDistance = Math.abs(
    Number(left.signalsPer20TradingDays ?? 0) - Number(shortlistConfig.targetSignalsPer20TradingDays ?? 0),
  )
  const rightDistance = Math.abs(
    Number(right.signalsPer20TradingDays ?? 0) - Number(shortlistConfig.targetSignalsPer20TradingDays ?? 0),
  )
  if (Math.abs(leftDistance - rightDistance) > 1e-12) return leftDistance - rightDistance
  const yearShareDelta = Number(left.maxYearShare ?? 0) - Number(right.maxYearShare ?? 0)
  if (Math.abs(yearShareDelta) > 1e-12) return yearShareDelta
  const clauseDelta = Number(left.totalClauseCount ?? 0) - Number(right.totalClauseCount ?? 0)
  if (clauseDelta !== 0) return clauseDelta
  return String(left.candidateTemplateId).localeCompare(String(right.candidateTemplateId))
}

const compareClusterLanes = (left, right, shortlistConfig) => {
  const leftLeader = left?.leaderTemplateEntry ?? {}
  const rightLeader = right?.leaderTemplateEntry ?? {}
  const leaderCompare = compareShortlistRows(leftLeader, rightLeader, shortlistConfig)
  if (leaderCompare !== 0) return leaderCompare
  const templateCountDelta = Number(right.candidateTemplateCount ?? 0) - Number(left.candidateTemplateCount ?? 0)
  if (templateCountDelta !== 0) return templateCountDelta
  return String(left.clusterId ?? "").localeCompare(String(right.clusterId ?? ""))
}

const compareBankSummaries = (left, right) => {
  const hitRateDelta = Number(right?.totalHitRate ?? 0) - Number(left?.totalHitRate ?? 0)
  if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta
  const hitYearDelta = Number(right?.yearsWithHitGe2 ?? 0) - Number(left?.yearsWithHitGe2 ?? 0)
  if (hitYearDelta !== 0) return hitYearDelta
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""))
}

const compareReserveTemplateEntries = (left, right, shortlistConfig) =>
  compareShortlistRows(left, right, shortlistConfig)

const countBy = (rows = [], keySelector) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = toText(keySelector(row))
    if (!key) continue
    counts[key] = Number(counts[key] ?? 0) + 1
  }
  return counts
}

const buildClusterId = ({ sourceBankId, clusterFingerprint }) =>
  `${toText(sourceBankId)}_${crypto.createHash("sha256").update(clusterFingerprint).digest("hex").slice(0, 10)}`

const buildSourceBankSummary = (bankSummary = null) =>
  !bankSummary || typeof bankSummary !== "object"
    ? null
    : {
        bankId: toText(bankSummary.id),
        mechanismId: toText(bankSummary.mechanismId),
        scopeId: toText(bankSummary.scopeId),
        lookbackCandidateId: toText(bankSummary.lookbackCandidateId),
        totalEventCount: Number(bankSummary.totalEventCount ?? 0) || 0,
        totalHitCount: Number(bankSummary.totalHitCount ?? 0) || 0,
        totalHitRate: Number(bankSummary.totalHitRate ?? 0) || 0,
        coveredYears: Number(bankSummary.coveredYears ?? 0) || 0,
        yearsWithHitGe1: Number(bankSummary.yearsWithHitGe1 ?? 0) || 0,
        yearsWithHitGe2: Number(bankSummary.yearsWithHitGe2 ?? 0) || 0,
        yearsWithEventCountGeMin: Number(bankSummary.yearsWithEventCountGeMin ?? 0) || 0,
        signalsPer20TradingDays: Number(bankSummary.signalsPer20TradingDays ?? 0) || 0,
        maxYearShare: Number(bankSummary.maxYearShare ?? 0) || 0,
        passDiscovery: bankSummary.passDiscovery === true,
        passPromotion: bankSummary.passPromotion === true,
      }

const buildPromotionRow = ({
  row,
  template,
  observed,
  shortlistConfig,
} = {}) => {
  const clauseGroups = buildTechniqueTemplateClauseGroups(template)
  const allClauseIds = buildTechniqueTemplateAllClauseIds(template)
  const observedBankIds = resolveTechniqueConcreteBankIds({
    mechanismId: toText(row?.mechanismId ?? template?.mechanismId),
    observedBankIds: observed?.observedBankIds ?? [],
    observedScopeIds: observed?.observedScopeIds ?? [],
    observedLookbackCandidateIds: observed?.observedLookbackCandidateIds ?? [],
    scopeCandidates: Array.isArray(row?.scopeCandidates) ? row.scopeCandidates : template?.scopeCandidates,
    lookbackCandidateIds: Array.isArray(row?.lookbackCandidateIds)
      ? row.lookbackCandidateIds
      : template?.lookbackCandidateIds,
  })
  const sourceBankId = observedBankIds[0] ?? null
  const entry = {
    candidateTemplateId: toText(row?.id),
    seedId: toText(row?.seedId ?? template?.seedId),
    mechanismId: toText(row?.mechanismId ?? template?.mechanismId),
    scopeCandidates: Array.isArray(row?.scopeCandidates) ? row.scopeCandidates.slice() : template.scopeCandidates.slice(),
    lookbackCandidateIds: Array.isArray(row?.lookbackCandidateIds)
      ? row.lookbackCandidateIds.slice()
      : template.lookbackCandidateIds.slice(),
    observedBankIds,
    sourceBankId,
    observedScopeIds: uniqueSortedStrings(observed?.observedScopeIds ?? []),
    observedLookbackCandidateIds: uniqueSortedStrings(observed?.observedLookbackCandidateIds ?? []),
    observedDecisionDayCount: Number(observed?.observedDecisionDayCount ?? 0) || 0,
    observedEventCount: Number(observed?.observedEventCount ?? 0) || 0,
    observedHitCount: Number(observed?.observedHitCount ?? 0) || 0,
    observedHitRate: Number(observed?.observedHitRate ?? 0) || 0,
    totalEventCount: Number(row?.totalEventCount ?? 0) || 0,
    totalHitCount: Number(row?.totalHitCount ?? 0) || 0,
    totalHitRate: Number(row?.totalHitRate ?? 0) || 0,
    coveredYears: Number(row?.coveredYears ?? 0) || 0,
    yearsWithHitGe2: Number(row?.yearsWithHitGe2 ?? 0) || 0,
    yearsWithHitGe1: Number(row?.yearsWithHitGe1 ?? 0) || 0,
    yearsWithEventCountGeMin: Number(row?.yearsWithEventCountGeMin ?? 0) || 0,
    signalsPer20TradingDays: Number(row?.signalsPer20TradingDays ?? 0) || 0,
    maxYearShare: Number(row?.maxYearShare ?? 0) || 0,
    yearEventVector: Array.isArray(row?.yearEventVector) ? row.yearEventVector.slice() : [],
    yearHitVector: Array.isArray(row?.yearHitVector) ? row.yearHitVector.slice() : [],
    passDiscovery: row?.passDiscovery === true,
    passPromotion: row?.passPromotion === true,
    totalClauseCount: allClauseIds.length,
    allClauseIds,
    ...clauseGroups,
  }
  entry.invalidateProfile = buildTechniqueInvalidateProfile({
    invalidateClauseIds: entry.invalidateClauseIds,
  })
  entry.clusterFingerprint = buildTechniqueClauseFingerprint({
    mechanismId: entry.mechanismId,
    bankId: entry.sourceBankId,
    anchorClauseIds: entry.anchorClauseIds,
    retestClauseIds: entry.retestClauseIds,
    compressionClauseIds: entry.compressionClauseIds,
    confirmClauseIds: entry.confirmClauseIds,
  })
  entry.breadthSignature = buildTechniqueBreadthSignature({
    allClauseIds: entry.allClauseIds,
    invalidateClauseIds: entry.invalidateClauseIds,
  })
  entry.shortlistEligible =
    !!entry.sourceBankId &&
    entry.totalHitRate >= Number(shortlistConfig.minPromotionHitRate ?? 0) &&
    entry.signalsPer20TradingDays >= Number(shortlistConfig.minSignalsPer20TradingDays ?? 0) &&
    entry.signalsPer20TradingDays <= Number(shortlistConfig.maxSignalsPer20TradingDays ?? Number.POSITIVE_INFINITY)
  return entry
}

const selectBreadthTemplateEntry = (memberTemplates = [], leaderTemplateEntry = null) => {
  const safeLeader = leaderTemplateEntry ?? null
  if (!safeLeader) return null
  return (
    memberTemplates.find(
      (entry) =>
        entry.candidateTemplateId !== safeLeader.candidateTemplateId &&
        entry.breadthSignature !== safeLeader.breadthSignature,
    ) ??
    memberTemplates.find((entry) => entry.candidateTemplateId !== safeLeader.candidateTemplateId) ??
    null
  )
}

const buildClusterLane = ({
  clusterFingerprint,
  memberTemplates,
  shortlistConfig,
  sourceBankSummaryById,
} = {}) => {
  const sortedMembers = memberTemplates.slice().sort((left, right) => compareShortlistRows(left, right, shortlistConfig))
  const leaderTemplateEntry = sortedMembers[0]
  const breadthTemplateEntry = selectBreadthTemplateEntry(sortedMembers, leaderTemplateEntry)
  const sourceBankId = toText(leaderTemplateEntry?.sourceBankId)
  const clusterId = buildClusterId({
    sourceBankId,
    clusterFingerprint,
  })
  return {
    clusterId,
    clusterFingerprint,
    sourceBankId,
    mechanismId: toText(leaderTemplateEntry?.mechanismId),
    scopeId: toText(sourceBankSummaryById.get(sourceBankId)?.scopeId ?? leaderTemplateEntry?.observedScopeIds?.[0] ?? ""),
    lookbackCandidateId: toText(
      sourceBankSummaryById.get(sourceBankId)?.lookbackCandidateId ??
        leaderTemplateEntry?.observedLookbackCandidateIds?.[0] ??
        "",
    ),
    candidateTemplateCount: sortedMembers.length,
    candidateTemplateIds: sortedMembers.map((entry) => entry.candidateTemplateId),
    memberTemplateIds: sortedMembers.map((entry) => entry.candidateTemplateId),
    leaderTemplateId: toText(leaderTemplateEntry?.candidateTemplateId),
    breadthTemplateId: toText(breadthTemplateEntry?.candidateTemplateId) || null,
    leaderTemplateEntry,
    breadthTemplateEntry,
    selectedTemplateEntries: [leaderTemplateEntry, breadthTemplateEntry]
      .filter(Boolean)
      .map((entry, index) => ({
        ...entry,
        clusterRole: index === 0 ? "leader" : "breadth",
        selectionReason: index === 0 ? "cluster_leader" : "cluster_breadth_variant",
      })),
    observedScopeIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.observedScopeIds)),
    observedLookbackCandidateIds: uniqueSortedStrings(
      sortedMembers.flatMap((entry) => entry.observedLookbackCandidateIds),
    ),
    observedBankIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.observedBankIds)),
    totalEventCount: sortedMembers.reduce((sum, entry) => sum + (Number(entry.totalEventCount ?? 0) || 0), 0),
    totalHitCount: sortedMembers.reduce((sum, entry) => sum + (Number(entry.totalHitCount ?? 0) || 0), 0),
    bestTotalHitRate: Number(leaderTemplateEntry?.totalHitRate ?? 0) || 0,
    bestSignalsPer20TradingDays: Number(leaderTemplateEntry?.signalsPer20TradingDays ?? 0) || 0,
    maxCoveredYears: Math.max(...sortedMembers.map((entry) => Number(entry.coveredYears ?? 0) || 0)),
    maxYearsWithHitGe2: Math.max(...sortedMembers.map((entry) => Number(entry.yearsWithHitGe2 ?? 0) || 0)),
    allClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.allClauseIds)),
    anchorClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.anchorClauseIds)),
    retestClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.retestClauseIds)),
    compressionClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.compressionClauseIds)),
    confirmClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.confirmClauseIds)),
    invalidateClauseIds: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.invalidateClauseIds)),
    invalidateProfiles: uniqueSortedStrings(sortedMembers.flatMap((entry) => entry.invalidateProfile)),
    sourceBankSummary: buildSourceBankSummary(sourceBankSummaryById.get(sourceBankId) ?? null),
  }
}

const buildReserveBankProjection = ({
  bankId,
  mechanismId,
  promotionRowsBySourceBankId,
  shortlistConfig,
} = {}) => {
  const reserveTemplates = Array.isArray(promotionRowsBySourceBankId.get(bankId))
    ? promotionRowsBySourceBankId.get(bankId).slice().sort((left, right) =>
        compareReserveTemplateEntries(left, right, shortlistConfig),
      )
    : []
  if (reserveTemplates.length < 1) {
    throw new Error(`Reserve bank ${bankId} has no promotion templates to project`)
  }
  const selectedTemplateEntries = reserveTemplates.slice(0, 2).map((entry, index) => ({
    ...entry,
    clusterRole: index === 0 ? "leader" : "breadth",
    selectionReason: index === 0 ? "reserve_bank_top_template" : "reserve_bank_variant",
  }))
  const allClauseIds = uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.allClauseIds))
  if (allClauseIds.length < 1) {
    throw new Error(`Reserve bank ${bankId} produced zero clause ids`)
  }
  return {
    topTemplateId: toText(reserveTemplates[0]?.candidateTemplateId) || null,
    shortlistedTemplateIds: reserveTemplates.map((entry) => entry.candidateTemplateId),
    shortlistedTemplateCount: reserveTemplates.length,
    selectedTemplateIds: selectedTemplateEntries.map((entry) => entry.candidateTemplateId),
    selectedTemplateEntries,
    observedScopeIds: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.observedScopeIds)),
    observedLookbackCandidateIds: uniqueSortedStrings(
      reserveTemplates.flatMap((entry) => entry.observedLookbackCandidateIds),
    ),
    observedBankIds: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.observedBankIds)),
    allClauseIds,
    anchorClauseIds: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.anchorClauseIds)),
    retestClauseIds: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.retestClauseIds)),
    compressionClauseIds: uniqueSortedStrings(
      reserveTemplates.flatMap((entry) => entry.compressionClauseIds),
    ),
    confirmClauseIds: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.confirmClauseIds)),
    invalidateClauseIds: uniqueSortedStrings(
      reserveTemplates.flatMap((entry) => entry.invalidateClauseIds),
    ),
    invalidateProfiles: uniqueSortedStrings(reserveTemplates.flatMap((entry) => entry.invalidateProfile)),
    mechanismId: toText(mechanismId) || toText(reserveTemplates[0]?.mechanismId),
  }
}

export const buildTechniqueClusterBankShortlist = ({
  techniqueContract,
  recurrenceReport,
  templates,
  eventRows = [],
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (!recurrenceReport || typeof recurrenceReport !== "object") {
    throw new Error("recurrenceReport is required")
  }
  const safeTemplates = Array.isArray(templates) ? templates : []
  if (safeTemplates.length < 1) {
    throw new Error("templates are required")
  }
  const shortlistConfig = techniqueContract.shortlist
  if (!shortlistConfig || typeof shortlistConfig !== "object") {
    throw new Error("techniqueContract.shortlist is required")
  }

  const templateById = new Map(safeTemplates.map((template) => [template.candidateTemplateId, template]))
  const sourceBankSummaryById = new Map(
    (Array.isArray(recurrenceReport.bankSummaries) ? recurrenceReport.bankSummaries : []).map((row) => [
      toText(row?.id),
      row,
    ]),
  )
  const observedByTemplate = summarizeObservedTemplateEvents(eventRows)
  const promotionRows = (Array.isArray(recurrenceReport.templateSummaries) ? recurrenceReport.templateSummaries : [])
    .filter((row) => row?.passPromotion === true)
    .map((row) => {
      const candidateTemplateId = toText(row?.id)
      const template = templateById.get(candidateTemplateId)
      if (!template) {
        throw new Error(`Cluster shortlist missing template definition for ${candidateTemplateId}`)
      }
      return buildPromotionRow({
        row,
        template,
        observed: observedByTemplate.get(candidateTemplateId) ?? {},
        shortlistConfig,
      })
    })

  const eligibleRows = promotionRows.filter((row) => row.shortlistEligible)
  const promotionRowsBySourceBankId = new Map()
  for (const row of promotionRows) {
    const sourceBankId = toText(row?.sourceBankId)
    if (!sourceBankId) continue
    if (!promotionRowsBySourceBankId.has(sourceBankId)) {
      promotionRowsBySourceBankId.set(sourceBankId, [])
    }
    promotionRowsBySourceBankId.get(sourceBankId).push(row)
  }
  const clusterMembersByFingerprint = new Map()
  for (const row of eligibleRows) {
    if (!clusterMembersByFingerprint.has(row.clusterFingerprint)) {
      clusterMembersByFingerprint.set(row.clusterFingerprint, [])
    }
    clusterMembersByFingerprint.get(row.clusterFingerprint).push(row)
  }

  const clusterLanes = Array.from(clusterMembersByFingerprint.entries())
    .map(([clusterFingerprint, memberTemplates]) =>
      buildClusterLane({
        clusterFingerprint,
        memberTemplates,
        shortlistConfig,
        sourceBankSummaryById,
      }),
    )
    .sort((left, right) => compareClusterLanes(left, right, shortlistConfig))
    .map((entry, index) => ({
      clusterRank: index + 1,
      ...entry,
    }))

  const derivedSelectionConfig = {
    maxClusterLanesPerMechanism: Math.max(
      1,
      Math.ceil(Number(shortlistConfig.maxTemplatesPerMechanism ?? Number.POSITIVE_INFINITY) / 2),
    ),
    maxClusterLanesTotal: Math.max(
      1,
      Math.ceil(Number(shortlistConfig.maxTemplatesTotal ?? Number.POSITIVE_INFINITY) / 2),
    ),
  }

  const selectedClusterLanes = []
  const clusterMechanismCounts = new Map()
  for (const lane of clusterLanes) {
    if (selectedClusterLanes.length >= derivedSelectionConfig.maxClusterLanesTotal) break
    const currentMechanismCount = Number(clusterMechanismCounts.get(lane.mechanismId) ?? 0)
    if (currentMechanismCount >= derivedSelectionConfig.maxClusterLanesPerMechanism) continue
    clusterMechanismCounts.set(lane.mechanismId, currentMechanismCount + 1)
    selectedClusterLanes.push({
      laneRank: selectedClusterLanes.length + 1,
      ...lane,
    })
  }

  const representedMechanisms = new Set(selectedClusterLanes.map((lane) => lane.mechanismId))
  const representedBankIds = new Set(selectedClusterLanes.map((lane) => lane.sourceBankId))
  const reserveBanks = []
  for (const bankSummary of (Array.isArray(recurrenceReport.bankSummaries) ? recurrenceReport.bankSummaries : [])
    .filter((row) => row?.passPromotion === true)
    .slice()
    .sort(compareBankSummaries)) {
    const bankId = toText(bankSummary?.id)
    const mechanismId = toText(bankSummary?.mechanismId)
    if (!bankId || !mechanismId) continue
    if (representedBankIds.has(bankId)) continue
    if (representedMechanisms.has(mechanismId)) continue
    const reserveProjection = buildReserveBankProjection({
      bankId,
      mechanismId,
      promotionRowsBySourceBankId,
      shortlistConfig,
    })
    representedMechanisms.add(mechanismId)
    reserveBanks.push({
      reserveRank: reserveBanks.length + 1,
      bankId,
      mechanismId: reserveProjection.mechanismId,
      scopeId: toText(bankSummary?.scopeId),
      lookbackCandidateId: toText(bankSummary?.lookbackCandidateId),
      topTemplateId: reserveProjection.topTemplateId,
      shortlistedTemplateIds: reserveProjection.shortlistedTemplateIds,
      shortlistedTemplateCount: reserveProjection.shortlistedTemplateCount,
      selectedTemplateIds: reserveProjection.selectedTemplateIds,
      selectedTemplateEntries: reserveProjection.selectedTemplateEntries,
      observedScopeIds: reserveProjection.observedScopeIds,
      observedLookbackCandidateIds: reserveProjection.observedLookbackCandidateIds,
      observedBankIds: reserveProjection.observedBankIds,
      allClauseIds: reserveProjection.allClauseIds,
      anchorClauseIds: reserveProjection.anchorClauseIds,
      retestClauseIds: reserveProjection.retestClauseIds,
      compressionClauseIds: reserveProjection.compressionClauseIds,
      confirmClauseIds: reserveProjection.confirmClauseIds,
      invalidateClauseIds: reserveProjection.invalidateClauseIds,
      invalidateProfiles: reserveProjection.invalidateProfiles,
      reserveEligible: true,
      sourceBankSummary: buildSourceBankSummary(bankSummary),
      selectionReason: "promotion_pass_bank_reserve",
    })
  }

  return {
    kind: TECHNIQUE_CLUSTER_BANK_SHORTLIST_KIND,
    contractId: toText(techniqueContract.contractId),
    recurrenceReportKind: toText(recurrenceReport.kind),
    templateCount: safeTemplates.length,
    promotionTemplateCount: promotionRows.length,
    eligibleTemplateCount: eligibleRows.length,
    clusterLaneCount: clusterLanes.length,
    selectedClusterLaneCount: selectedClusterLanes.length,
    reserveBankCount: reserveBanks.length,
    shortlistConfig: { ...shortlistConfig },
    derivedSelectionConfig,
    mechanismCounts: {
      promotion: countBy(promotionRows, (row) => row.mechanismId),
      eligible: countBy(eligibleRows, (row) => row.mechanismId),
      clusterLanes: countBy(clusterLanes, (row) => row.mechanismId),
      selectedClusterLanes: countBy(selectedClusterLanes, (row) => row.mechanismId),
      reserveBanks: countBy(reserveBanks, (row) => row.mechanismId),
    },
    clusterLanes,
    selectedClusterLanes,
    reserveBanks,
    notes: [
      "Cluster-bank shortlist keeps mechanism/bank lanes explicit instead of collapsing into one raw bank union.",
      "Invalidate clauses are diagnostics only and do not define cluster identity.",
      "Reserve banks preserve promotion-pass mechanisms that would otherwise disappear from the shortlist feed.",
    ],
  }
}
