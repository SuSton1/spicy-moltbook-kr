import {
  buildTechniqueBankId,
  safeRatio,
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_BANK_SHORTLIST_KIND = "technique_bank_shortlist_v1"

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

const buildBehavioralSignature = (row = {}, observed = {}) =>
  JSON.stringify({
    mechanismId: toText(row?.mechanismId),
    observedBankIds: uniqueSortedStrings(observed?.observedBankIds ?? []),
    yearEventVector: Array.isArray(row?.yearEventVector) ? row.yearEventVector : [],
    yearHitVector: Array.isArray(row?.yearHitVector) ? row.yearHitVector : [],
    totalEventCount: Number(row?.totalEventCount ?? 0),
    totalHitCount: Number(row?.totalHitCount ?? 0),
  })

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

const countBy = (rows = [], keySelector) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = toText(keySelector(row))
    if (!key) continue
    counts[key] = Number(counts[key] ?? 0) + 1
  }
  return counts
}

const buildClauseGroups = (template = {}) => ({
  anchorClauseIds: Array.isArray(template.anchorClauseIds)
    ? template.anchorClauseIds.slice()
    : Array.isArray(template?.clauseSet?.anchor)
      ? template.clauseSet.anchor.slice()
      : [],
  retestClauseIds: Array.isArray(template.retestClauseIds)
    ? template.retestClauseIds.slice()
    : Array.isArray(template?.clauseSet?.retest)
      ? template.clauseSet.retest.slice()
      : [],
  compressionClauseIds: Array.isArray(template.compressionClauseIds)
    ? template.compressionClauseIds.slice()
    : Array.isArray(template?.clauseSet?.compression)
      ? template.clauseSet.compression.slice()
      : [],
  confirmClauseIds: Array.isArray(template.confirmClauseIds)
    ? template.confirmClauseIds.slice()
    : Array.isArray(template?.clauseSet?.confirm)
      ? template.clauseSet.confirm.slice()
      : [],
  invalidateClauseIds: Array.isArray(template.invalidateClauseIds)
    ? template.invalidateClauseIds.slice()
    : Array.isArray(template?.clauseSet?.invalidate)
      ? template.clauseSet.invalidate.slice()
      : [],
})

export const buildTechniqueBankShortlist = ({
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
  const observedByTemplate = summarizeObservedTemplateEvents(eventRows)
  const promotionRows = (Array.isArray(recurrenceReport.templateSummaries) ? recurrenceReport.templateSummaries : [])
    .filter((row) => row?.passPromotion === true)
    .map((row) => {
      const candidateTemplateId = toText(row?.id)
      const template = templateById.get(candidateTemplateId)
      if (!template) {
        throw new Error(`Shortlist builder missing template definition for ${candidateTemplateId}`)
      }
      const observed = observedByTemplate.get(candidateTemplateId) ?? {
        observedBankIds: [],
        observedScopeIds: [],
        observedLookbackCandidateIds: [],
        observedDecisionDayCount: 0,
        observedEventCount: 0,
        observedHitCount: 0,
        observedHitRate: 0,
      }
      const entry = {
        candidateTemplateId,
        seedId: toText(row?.seedId ?? template.seedId),
        mechanismId: toText(row?.mechanismId ?? template.mechanismId),
        scopeCandidates: Array.isArray(row?.scopeCandidates) ? row.scopeCandidates.slice() : template.scopeCandidates.slice(),
        lookbackCandidateIds: Array.isArray(row?.lookbackCandidateIds)
          ? row.lookbackCandidateIds.slice()
          : template.lookbackCandidateIds.slice(),
        observedBankIds: observed.observedBankIds,
        observedScopeIds: observed.observedScopeIds,
        observedLookbackCandidateIds: observed.observedLookbackCandidateIds,
        observedDecisionDayCount: Number(observed.observedDecisionDayCount ?? 0) || 0,
        observedEventCount: Number(observed.observedEventCount ?? 0) || 0,
        observedHitCount: Number(observed.observedHitCount ?? 0) || 0,
        observedHitRate: Number(observed.observedHitRate ?? 0) || 0,
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
        totalClauseCount: Array.isArray(template.allClauseIds) ? template.allClauseIds.length : 0,
        allClauseIds: Array.isArray(template.allClauseIds) ? template.allClauseIds.slice() : [],
        ...buildClauseGroups(template),
      }
      entry.behavioralSignature = buildBehavioralSignature(entry, observed)
      entry.signalDistanceFromTarget = Math.abs(
        entry.signalsPer20TradingDays - Number(shortlistConfig.targetSignalsPer20TradingDays ?? 0),
      )
      entry.shortlistEligible =
        entry.totalHitRate >= Number(shortlistConfig.minPromotionHitRate ?? 0) &&
        entry.signalsPer20TradingDays >= Number(shortlistConfig.minSignalsPer20TradingDays ?? 0) &&
        entry.signalsPer20TradingDays <= Number(shortlistConfig.maxSignalsPer20TradingDays ?? Infinity)
      return entry
    })

  const eligibleRows = promotionRows.filter((row) => row.shortlistEligible)
  const dedupedRows = []
  const byBehavior = new Map()
  for (const row of eligibleRows) {
    const existing = byBehavior.get(row.behavioralSignature)
    if (!existing || compareShortlistRows(row, existing, shortlistConfig) < 0) {
      byBehavior.set(row.behavioralSignature, row)
    }
  }
  dedupedRows.push(...byBehavior.values())
  dedupedRows.sort((left, right) => compareShortlistRows(left, right, shortlistConfig))

  const shortlistedTemplates = []
  const mechanismCounts = new Map()
  for (const row of dedupedRows) {
    if (shortlistedTemplates.length >= Number(shortlistConfig.maxTemplatesTotal ?? Infinity)) break
    const currentCount = Number(mechanismCounts.get(row.mechanismId) ?? 0)
    if (currentCount >= Number(shortlistConfig.maxTemplatesPerMechanism ?? Infinity)) continue
    mechanismCounts.set(row.mechanismId, currentCount + 1)
    shortlistedTemplates.push({
      shortlistRank: shortlistedTemplates.length + 1,
      ...row,
    })
  }

  const shortlistedBanks = Array.from(
    shortlistedTemplates.reduce((map, row) => {
      const bankIds = row.observedBankIds.length > 0 ? row.observedBankIds : ["UNOBSERVED_BANK"]
      for (const bankId of bankIds) {
        if (!map.has(bankId)) {
          map.set(bankId, {
            bankId,
            mechanismId: row.mechanismId,
            scopeIds: new Set(),
            lookbackCandidateIds: new Set(),
            candidateTemplateIds: [],
            bestTemplateId: row.candidateTemplateId,
            bestTemplateHitRate: row.totalHitRate,
            maxYearsWithHitGe2: row.yearsWithHitGe2,
            maxCoveredYears: row.coveredYears,
          })
        }
        const entry = map.get(bankId)
        for (const scopeId of row.observedScopeIds) entry.scopeIds.add(scopeId)
        for (const lookbackId of row.observedLookbackCandidateIds) entry.lookbackCandidateIds.add(lookbackId)
        entry.candidateTemplateIds.push(row.candidateTemplateId)
        if (row.totalHitRate > entry.bestTemplateHitRate) {
          entry.bestTemplateId = row.candidateTemplateId
          entry.bestTemplateHitRate = row.totalHitRate
        }
        entry.maxYearsWithHitGe2 = Math.max(entry.maxYearsWithHitGe2, row.yearsWithHitGe2)
        entry.maxCoveredYears = Math.max(entry.maxCoveredYears, row.coveredYears)
      }
      return map
    }, new Map()).values(),
  )
    .map((entry) => ({
      bankId: entry.bankId,
      mechanismId: entry.mechanismId,
      scopeIds: uniqueSortedStrings(Array.from(entry.scopeIds)),
      lookbackCandidateIds: uniqueSortedStrings(Array.from(entry.lookbackCandidateIds)),
      shortlistedTemplateCount: entry.candidateTemplateIds.length,
      candidateTemplateIds: entry.candidateTemplateIds.slice(),
      bestTemplateId: entry.bestTemplateId,
      bestTemplateHitRate: entry.bestTemplateHitRate,
      maxYearsWithHitGe2: entry.maxYearsWithHitGe2,
      maxCoveredYears: entry.maxCoveredYears,
    }))
    .sort((left, right) => right.bestTemplateHitRate - left.bestTemplateHitRate || left.bankId.localeCompare(right.bankId))

  return {
    kind: TECHNIQUE_BANK_SHORTLIST_KIND,
    contractId: techniqueContract.contractId,
    recurrenceReportKind: toText(recurrenceReport.kind),
    templateCount: safeTemplates.length,
    promotionTemplateCount: promotionRows.length,
    eligibleTemplateCount: eligibleRows.length,
    dedupedTemplateCount: dedupedRows.length,
    shortlistedTemplateCount: shortlistedTemplates.length,
    shortlistedBankCount: shortlistedBanks.length,
    mechanismCounts: {
      promotion: countBy(promotionRows, (row) => row.mechanismId),
      eligible: countBy(eligibleRows, (row) => row.mechanismId),
      deduped: countBy(dedupedRows, (row) => row.mechanismId),
      shortlisted: countBy(shortlistedTemplates, (row) => row.mechanismId),
    },
    shortlistConfig: { ...shortlistConfig },
    shortlistedBanks,
    shortlistedTemplates,
  }
}
