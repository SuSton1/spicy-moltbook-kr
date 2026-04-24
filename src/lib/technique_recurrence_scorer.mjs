import {
  buildTechniqueBankId,
  ensureDateKey,
  safeRatio,
  toFiniteNumber,
  toText,
  uniqueSortedIntegers,
} from "./technique_common.mjs"

export const TECHNIQUE_RECURRENCE_REPORT_KIND = "technique_recurrence_report_v1"

const emptyYearStats = (yearKey) => ({
  yearKey,
  eventCount: 0,
  hitCount: 0,
  eventDateKeys: new Set(),
  hitDateKeys: new Set(),
  hitRate: 0,
})

const buildYearStatsMap = (coreYears = []) =>
  new Map(uniqueSortedIntegers(coreYears).map((yearKey) => [yearKey, emptyYearStats(yearKey)]))

const countUniqueDecisionDates = (rows = []) =>
  new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        try {
          return ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
        } catch {
          return null
        }
      })
      .filter(Boolean),
  ).size

const buildSourceIndex = ({
  sourceRows = [],
  templates = [],
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  const bankDayCounts = new Map()
  const templateDayCounts = new Map()
  const safeTemplates = Array.isArray(templates) ? templates : []
  const templateById = new Map(safeTemplates.map((template) => [template.candidateTemplateId, template]))
  const templateDecisionDayBuckets = new Map()
  const bankDecisionDayBuckets = new Map()
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const scopeId = toText(row?.scopeId ?? row?.candidateScopeId ?? defaultScopeId)
    const lookbackCandidateId = toText(
      row?.lookbackCandidateId ?? row?.candidateId ?? defaultLookbackCandidateId,
    )
    const decisionDateKey = (() => {
      try {
        return ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
      } catch {
        return null
      }
    })()
    if (!scopeId || !lookbackCandidateId || !decisionDateKey) continue
    for (const template of safeTemplates) {
      if (!template.scopeCandidates.includes(scopeId)) continue
      if (!template.lookbackCandidateIds.includes(lookbackCandidateId)) continue
      if (!templateDecisionDayBuckets.has(template.candidateTemplateId)) {
        templateDecisionDayBuckets.set(template.candidateTemplateId, new Set())
      }
      templateDecisionDayBuckets.get(template.candidateTemplateId).add(decisionDateKey)
      const bankId = buildTechniqueBankId({
        mechanismId: template.mechanismId,
        scopeId,
        lookbackCandidateId,
      })
      if (!bankDecisionDayBuckets.has(bankId)) {
        bankDecisionDayBuckets.set(bankId, new Set())
      }
      bankDecisionDayBuckets.get(bankId).add(decisionDateKey)
    }
  }
  for (const [templateId, bucket] of templateDecisionDayBuckets.entries()) {
    templateDayCounts.set(templateId, bucket.size)
  }
  for (const [bankId, bucket] of bankDecisionDayBuckets.entries()) {
    bankDayCounts.set(bankId, bucket.size)
  }
  for (const templateId of templateById.keys()) {
    if (!templateDayCounts.has(templateId)) templateDayCounts.set(templateId, 0)
  }
  return {
    templateDayCounts,
    bankDayCounts,
  }
}

const finalizeStats = ({
  id,
  mechanismId = null,
  scopeId = null,
  lookbackCandidateId = null,
  yearStatsMap,
  decisionDayCount,
  recurrenceConfig,
  yearHitMetric = "hit_rows",
  extra = {},
} = {}) => {
  const yearStats = uniqueSortedIntegers(Array.from(yearStatsMap.keys())).map((yearKey) => {
    const item = yearStatsMap.get(yearKey) ?? emptyYearStats(yearKey)
    const eventCount =
      yearHitMetric === "unique_decision_dates" ? item.eventDateKeys?.size ?? 0 : item.eventCount
    const hitCount =
      yearHitMetric === "unique_decision_dates" ? item.hitDateKeys?.size ?? 0 : item.hitCount
    return {
      yearKey,
      eventCount,
      hitCount,
      hitRate: safeRatio(hitCount, eventCount) ?? 0,
    }
  })
  const totalEventCount = yearStats.reduce((sum, item) => sum + item.eventCount, 0)
  const totalHitCount = yearStats.reduce((sum, item) => sum + item.hitCount, 0)
  const coveredYears = yearStats.filter((item) => item.eventCount > 0).length
  const yearsWithHitGe1 = yearStats.filter((item) => item.hitCount >= 1).length
  const yearsWithHitGe2 = yearStats.filter((item) => item.hitCount >= 2).length
  const yearsWithEventCountGeMin = yearStats.filter(
    (item) => item.eventCount >= recurrenceConfig.minYearEventCount,
  ).length
  const yearEventVector = yearStats.map((item) => item.eventCount)
  const yearHitVector = yearStats.map((item) => item.hitCount)
  const minYearEventCount = yearStats.reduce((best, item) => Math.min(best, item.eventCount), Infinity)
  const minYearHitCount = yearStats.reduce((best, item) => Math.min(best, item.hitCount), Infinity)
  const maxYearCount = yearStats.reduce((best, item) => Math.max(best, item.eventCount), 0)
  const maxYearShare = totalEventCount > 0 ? maxYearCount / totalEventCount : 0
  const signalsPer20TradingDays =
    decisionDayCount > 0 ? (totalEventCount / decisionDayCount) * 20 : 0
  const passDiscovery =
    ((yearsWithHitGe2 >= recurrenceConfig.discoveryMinYearsWithHitGe2 &&
      yearsWithEventCountGeMin >= recurrenceConfig.discoveryMinYearsWithHitGe2) ||
      (yearsWithHitGe1 >= recurrenceConfig.discoveryAltMinYearsWithHitGe1 &&
        yearsWithEventCountGeMin >= recurrenceConfig.discoveryAltMinYearsWithHitGe1)) &&
    signalsPer20TradingDays >= recurrenceConfig.minSignalsPer20TradingDays &&
    maxYearShare <= recurrenceConfig.maxYearShare
  const passPromotion =
    yearsWithHitGe2 >= recurrenceConfig.promotionMinYearsWithHitGe2 &&
    coveredYears >= recurrenceConfig.promotionMinCoveredYears &&
    yearsWithEventCountGeMin >= recurrenceConfig.promotionMinYearsWithHitGe2 &&
    signalsPer20TradingDays >= recurrenceConfig.minSignalsPer20TradingDays &&
    maxYearShare <= recurrenceConfig.maxYearShare
  return {
    ...extra,
    id,
    mechanismId,
    scopeId,
    lookbackCandidateId,
    yearStats,
    decisionDayCount,
    totalEventCount,
    totalHitCount,
    totalHitRate: safeRatio(totalHitCount, totalEventCount) ?? 0,
    coveredYears,
    yearsWithHitGe1,
    yearsWithHitGe2,
    yearsWithEventCountGeMin,
    yearEventVector,
    yearHitVector,
    minYearEventCount: Number.isFinite(minYearEventCount) ? minYearEventCount : 0,
    minYearHitCount: Number.isFinite(minYearHitCount) ? minYearHitCount : 0,
    maxYearShare,
    signalsPer20TradingDays,
    passDiscovery,
    passPromotion,
  }
}

export const buildTechniqueRecurrenceReport = ({
  techniqueContract,
  templates,
  eventRows,
  sourceRows = [],
  labelId = null,
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  const safeEvents = Array.isArray(eventRows) ? eventRows : []
  const safeTemplates = Array.isArray(templates) ? templates : []
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  if (safeTemplates.length < 1) {
    throw new Error("templates are required")
  }
  const recurrenceConfig = techniqueContract.recurrence
  const coreYears = techniqueContract.coreYears
  const yearHitMetric = toText(techniqueContract?.yearHitMetric || "hit_rows").toLowerCase() || "hit_rows"
  const sourceIndex = buildSourceIndex({
    sourceRows,
    templates: safeTemplates,
    defaultScopeId,
    defaultLookbackCandidateId,
  })
  const templateById = new Map(safeTemplates.map((template) => [template.candidateTemplateId, template]))
  const templateYearMaps = new Map(
    safeTemplates.map((template) => [template.candidateTemplateId, buildYearStatsMap(coreYears)]),
  )
  const bankYearMaps = new Map()

  for (const eventRow of safeEvents) {
    const templateId = toText(eventRow?.candidateTemplateId)
    const template = templateById.get(templateId)
    if (!template) {
      throw new Error(`Unknown event row candidateTemplateId=${templateId}`)
    }
    const yearKey = Number(eventRow?.yearKey)
    if (!templateYearMaps.get(templateId)?.has(yearKey)) continue
    const templateYearStats = templateYearMaps.get(templateId).get(yearKey)
    const decisionDateKey = (() => {
      try {
        return ensureDateKey(eventRow?.decisionDateKey ?? eventRow?.dateKey, "decisionDateKey")
      } catch {
        return null
      }
    })()
    templateYearStats.eventCount += 1
    if (eventRow?.hitTarget === true) templateYearStats.hitCount += 1
    if (decisionDateKey) {
      templateYearStats.eventDateKeys.add(decisionDateKey)
      if (eventRow?.hitTarget === true) {
        templateYearStats.hitDateKeys.add(decisionDateKey)
      }
    }

    const scopeId = toText(eventRow?.scopeId)
    const lookbackCandidateId = toText(eventRow?.lookbackCandidateId)
    const bankId =
      toText(eventRow?.bankId) ||
      buildTechniqueBankId({
        mechanismId: template.mechanismId,
        scopeId,
        lookbackCandidateId,
      })
    if (!bankYearMaps.has(bankId)) {
      bankYearMaps.set(bankId, {
        mechanismId: template.mechanismId,
        scopeId,
        lookbackCandidateId,
        yearStatsMap: buildYearStatsMap(coreYears),
      })
    }
    const bankYearStats = bankYearMaps.get(bankId).yearStatsMap.get(yearKey)
    bankYearStats.eventCount += 1
    if (eventRow?.hitTarget === true) bankYearStats.hitCount += 1
    if (decisionDateKey) {
      bankYearStats.eventDateKeys.add(decisionDateKey)
      if (eventRow?.hitTarget === true) {
        bankYearStats.hitDateKeys.add(decisionDateKey)
      }
    }
  }

  const templateSummaries = safeTemplates
    .map((template) =>
      finalizeStats({
        id: template.candidateTemplateId,
        mechanismId: template.mechanismId,
        yearStatsMap: templateYearMaps.get(template.candidateTemplateId),
        decisionDayCount: Number(sourceIndex.templateDayCounts.get(template.candidateTemplateId) ?? 0) || 0,
        recurrenceConfig,
        yearHitMetric,
        extra: {
          kind: "technique_template_recurrence_summary_v1",
          seedId: template.seedId,
          scopeCandidates: template.scopeCandidates.slice(),
          lookbackCandidateIds: template.lookbackCandidateIds.slice(),
        },
      }),
    )
    .sort((left, right) => right.totalHitRate - left.totalHitRate || left.id.localeCompare(right.id))

  const bankSummaries = Array.from(bankYearMaps.entries())
    .map(([bankId, bank]) =>
      finalizeStats({
        id: bankId,
        mechanismId: bank.mechanismId,
        scopeId: bank.scopeId,
        lookbackCandidateId: bank.lookbackCandidateId,
        yearStatsMap: bank.yearStatsMap,
        decisionDayCount: Number(sourceIndex.bankDayCounts.get(bankId) ?? 0) || countUniqueDecisionDates(safeEvents),
        recurrenceConfig,
        yearHitMetric,
        extra: {
          kind: "technique_bank_recurrence_summary_v1",
        },
      }),
    )
    .sort((left, right) => right.totalHitRate - left.totalHitRate || left.id.localeCompare(right.id))

  return {
    kind: TECHNIQUE_RECURRENCE_REPORT_KIND,
    contractId: techniqueContract.contractId,
    labelId: toText(labelId) || techniqueContract.labelId,
    yearHitMetric,
    coreYears: coreYears.slice(),
    templateCount: safeTemplates.length,
    eventRowCount: safeEvents.length,
    templateSummaries,
    bankSummaries,
    discoveryPassTemplateIds: templateSummaries.filter((item) => item.passDiscovery).map((item) => item.id),
    promotionPassTemplateIds: templateSummaries.filter((item) => item.passPromotion).map((item) => item.id),
    discoveryPassBankIds: bankSummaries.filter((item) => item.passDiscovery).map((item) => item.id),
    promotionPassBankIds: bankSummaries.filter((item) => item.passPromotion).map((item) => item.id),
    generatedAt: new Date().toISOString(),
  }
}
