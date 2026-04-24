import { toText, uniqueSortedStrings, yearKeyFromDateKey } from "./technique_common.mjs"

export const TECHNIQUE_YEAR_CONSENSUS_SUMMARY_KIND = "technique_year_consensus_summary_v1"
export const TECHNIQUE_OPERATING_BRIDGE_MANIFEST_KIND = "technique_operating_bridge_manifest_v1"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const round = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}

const normalizeTemplateEntry = (entry = {}) => ({
  candidateTemplateId: toText(entry?.candidateTemplateId),
  bankId: toText(entry?.bankId),
  mechanismId: toText(entry?.mechanismId),
  scopeId: toText(entry?.scopeId),
  lookbackCandidateId: toText(entry?.lookbackCandidateId),
  childRunId: toText(entry?.childRunId),
  rollingSummaryPath: toText(entry?.rollingSummaryPath),
  rollingReportPath: toText(entry?.rollingReportPath),
  yearHitMetric: toText(entry?.yearHitMetric || "hit_rows") || "hit_rows",
  passScreen: entry?.passScreen === true,
})

export const selectTechniqueYearConsensusTemplates = ({
  templateScreenSummary,
  selectedTemplateIds = [],
} = {}) => {
  if (!templateScreenSummary || typeof templateScreenSummary !== "object") {
    throw new Error("templateScreenSummary is required")
  }
  const templates = (Array.isArray(templateScreenSummary.templates) ? templateScreenSummary.templates : [])
    .map(normalizeTemplateEntry)
    .filter((entry) => entry.candidateTemplateId)
  if (templates.length < 1) {
    throw new Error("templateScreenSummary.templates is empty")
  }
  const passTemplates = templates.filter((entry) => entry.passScreen === true)
  if (passTemplates.length < 1) {
    throw new Error("templateScreenSummary.passTemplateCount is zero; year-consensus requires at least one passed template")
  }
  const requestedIds = uniqueSortedStrings(selectedTemplateIds)
  for (const templateId of requestedIds) {
    const template = templates.find((entry) => entry.candidateTemplateId === templateId)
    if (!template) {
      throw new Error(`Requested template is not present in templateScreenSummary: ${templateId}`)
    }
    if (template.passScreen !== true) {
      throw new Error(`Requested template did not pass template screen: ${templateId}`)
    }
  }
  const chosenTemplates = passTemplates.filter(
    (entry) => requestedIds.length < 1 || requestedIds.includes(entry.candidateTemplateId),
  )
  if (chosenTemplates.length < 1) {
    throw new Error("No passed templates remain after template selection filters")
  }
  return chosenTemplates
}

const buildRuleConsensusRecord = ({
  template,
  yearConsensusConfig,
  yearHitMetric = "hit_rows",
  ruleId,
  rows,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const windowIds = uniqueSortedStrings(safeRows.map((row) => row.windowId))
  const yearsPresent = uniqueSortedStrings(safeRows.map((row) => row.yearKey))
  const yearsWithSelectionGe1 = uniqueSortedStrings(
    safeRows.filter((row) => toNumber(row.openOosMatchCount, 0) > 0).map((row) => row.yearKey),
  )
  const yearsWithHitGe1 = uniqueSortedStrings(
    safeRows.filter((row) => toNumber(row.openOosHitCount, 0) >= 1).map((row) => row.yearKey),
  )
  const yearsWithHitGe2 = uniqueSortedStrings(
    safeRows
      .filter((row) =>
        toNumber(
          yearHitMetric === "unique_decision_dates" ? row.openOosHitDateCount : row.openOosHitCount,
          0,
        ) >= 2,
      )
      .map((row) => row.yearKey),
  )
  const yearsWithZeroNegative = uniqueSortedStrings(
    safeRows
      .filter(
        (row) => toNumber(row.openOosMatchCount, 0) > 0 && toNumber(row.openOosNegativeCount, 0) === 0,
      )
      .map((row) => row.yearKey),
  )
  const aggregateOosMatchCount = safeRows.reduce((sum, row) => sum + toNumber(row.openOosMatchCount, 0), 0)
  const aggregateOosHitCount = safeRows.reduce((sum, row) => sum + toNumber(row.openOosHitCount, 0), 0)
  const aggregateOosHitDateCount = safeRows.reduce((sum, row) => sum + toNumber(row.openOosHitDateCount, 0), 0)
  const aggregateOosNegativeCount = safeRows.reduce((sum, row) => sum + toNumber(row.openOosNegativeCount, 0), 0)
  const aggregateOosMatchedDateCount = safeRows.reduce(
    (sum, row) => sum + toNumber(row.openOosMatchedDateCount, 0),
    0,
  )
  const aggregateOosEffectiveHitCount =
    yearHitMetric === "unique_decision_dates" ? aggregateOosHitDateCount : aggregateOosHitCount
  const aggregateOosHitRate =
    aggregateOosMatchCount > 0 ? aggregateOosHitCount / aggregateOosMatchCount : 0
  const bestSelectionRank = safeRows.reduce((best, row) => {
    const rank = toNumber(row.selectionRank, Number.POSITIVE_INFINITY)
    return rank < best ? rank : best
  }, Number.POSITIVE_INFINITY)
  const firstRow = safeRows[0] ?? {}
  const passConsensus =
    toNumber(firstRow.ruleSize, 0) <= toNumber(yearConsensusConfig.maxRuleSize, Number.POSITIVE_INFINITY) &&
    yearsPresent.length >= toNumber(yearConsensusConfig.minConsensusYearsPresent, 0) &&
    yearsWithHitGe1.length >= toNumber(yearConsensusConfig.minConsensusYearsWithHitGe1, 0) &&
    yearsWithZeroNegative.length >= toNumber(yearConsensusConfig.minConsensusYearsWithZeroNegative, 0) &&
    aggregateOosHitRate >= toNumber(yearConsensusConfig.minAggregateOosHitRate, 0) &&
    aggregateOosEffectiveHitCount >= toNumber(yearConsensusConfig.minAggregateOosHitCount, 0) &&
    aggregateOosMatchedDateCount >= toNumber(yearConsensusConfig.minAggregateOosMatchedDateCount, 0)
  const topWindow = safeRows
    .slice()
    .sort((left, right) => {
      const hitDelta = toNumber(right.openOosHitCount, 0) - toNumber(left.openOosHitCount, 0)
      if (hitDelta !== 0) return hitDelta
      const precisionDelta = toNumber(right.openOosPrecision, 0) - toNumber(left.openOosPrecision, 0)
      if (Math.abs(precisionDelta) > 1e-12) return precisionDelta > 0 ? 1 : -1
      return String(left.windowId ?? "").localeCompare(String(right.windowId ?? ""))
    })[0] ?? null
  return {
    candidateTemplateId: template.candidateTemplateId,
    bankId: template.bankId,
    mechanismId: template.mechanismId,
    scopeId: template.scopeId,
    lookbackCandidateId: template.lookbackCandidateId,
    childRunId: template.childRunId,
    ruleId,
    familyId: toText(firstRow.familyId) || null,
    tokens: Array.isArray(firstRow.tokens) ? firstRow.tokens.slice() : [],
    ruleSize: toNumber(firstRow.ruleSize, 0),
    windowCount: windowIds.length,
    windowIds,
    yearsPresent,
    yearsWithSelectionGe1,
    yearsWithHitGe1,
    yearsWithHitGe2,
    yearsWithZeroNegative,
    aggregateOosMatchCount,
    aggregateOosHitCount,
    aggregateOosHitDateCount,
    aggregateOosEffectiveHitCount,
    aggregateOosNegativeCount,
    aggregateOosMatchedDateCount,
    aggregateOosHitRate: round(aggregateOosHitRate, 12),
    bestSelectionRank: Number.isFinite(bestSelectionRank) ? bestSelectionRank : null,
    bestWindowId: toText(topWindow?.windowId) || null,
    bestWindowYear: toText(topWindow?.yearKey) || null,
    bestWindowOosHitCount: toNumber(topWindow?.openOosHitCount, 0),
    bestWindowOosPrecision: round(toNumber(topWindow?.openOosPrecision, 0), 12),
    passConsensus,
  }
}

export const buildTechniqueYearConsensusTemplateSummary = ({
  template,
  screenWindows,
  yearConsensusConfig,
} = {}) => {
  if (!template || typeof template !== "object") {
    throw new Error("template is required")
  }
  if (!yearConsensusConfig || typeof yearConsensusConfig !== "object") {
    throw new Error("yearConsensusConfig is required")
  }
  const safeWindows = Array.isArray(screenWindows) ? screenWindows : []
  if (safeWindows.length < 1) {
    throw new Error(`template ${template.candidateTemplateId} has no screen windows for year-consensus`)
  }
  const ruleRowsById = new Map()
  const yearHitMetric = toText(safeWindows[0]?.yearHitMetric || template?.yearHitMetric || "hit_rows").toLowerCase() || "hit_rows"
  const windowCatalogs = []
  const selectionLineIds = new Set()
  const selectionModes = new Set()
  for (const window of safeWindows) {
    const yearKey = Number.isInteger(Number(window?.yearKey))
      ? Number(window.yearKey)
      : yearKeyFromDateKey(window?.oosDateFrom, `${template.candidateTemplateId} oosDateFrom`)
    const windowId = toText(window?.windowId)
    const selectionLeaderboardRows = Array.isArray(window?.selectionLeaderboardRows)
      ? window.selectionLeaderboardRows
      : []
    if (!windowId || selectionLeaderboardRows.length < 1) {
      throw new Error(`template ${template.candidateTemplateId} window is missing selection leaderboard rows`)
    }
    const lineId = toText(window?.selectionLineId)
    const selectionMode = toText(window?.selectionMode)
    if (lineId) selectionLineIds.add(lineId)
    if (selectionMode) selectionModes.add(selectionMode)
    windowCatalogs.push({
      windowId,
      yearKey,
      scopeRunId: toText(window?.scopeRunId),
      selectionLeaderboardPath: toText(window?.selectionLeaderboardPath),
      freezeResultPath: toText(window?.freezeResultPath),
      frozenCatalogPath: toText(window?.frozenCatalogPath),
      selectionLineId: lineId || null,
      selectionMode: selectionMode || null,
    })
    for (const row of selectionLeaderboardRows) {
      const ruleId = toText(row?.ruleId)
      if (!ruleId) continue
      const bucket = ruleRowsById.get(ruleId) ?? []
      bucket.push({
        ...row,
        windowId,
        yearKey: String(yearKey),
      })
      ruleRowsById.set(ruleId, bucket)
    }
  }
  const consensusRules = Array.from(ruleRowsById.entries())
    .map(([ruleId, rows]) =>
      buildRuleConsensusRecord({
        template,
        yearConsensusConfig,
        yearHitMetric,
        ruleId,
        rows,
      }),
    )
    .sort((left, right) => {
      if (Number(right.passConsensus) !== Number(left.passConsensus)) {
        return Number(right.passConsensus) - Number(left.passConsensus)
      }
      const hitYearDelta = right.yearsWithHitGe1.length - left.yearsWithHitGe1.length
      if (hitYearDelta !== 0) return hitYearDelta
      const hitRateDelta = toNumber(right.aggregateOosHitRate, 0) - toNumber(left.aggregateOosHitRate, 0)
      if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta > 0 ? 1 : -1
      const hitCountDelta = toNumber(right.aggregateOosHitCount, 0) - toNumber(left.aggregateOosHitCount, 0)
      if (hitCountDelta !== 0) return hitCountDelta
      const rankDelta = toNumber(left.bestSelectionRank, Number.POSITIVE_INFINITY) -
        toNumber(right.bestSelectionRank, Number.POSITIVE_INFINITY)
      if (rankDelta !== 0) return rankDelta
      return String(left.ruleId ?? "").localeCompare(String(right.ruleId ?? ""))
    })
  const qualifiedConsensusRules = consensusRules.filter((row) => row.passConsensus === true)
  return {
    candidateTemplateId: template.candidateTemplateId,
    bankId: template.bankId,
    mechanismId: template.mechanismId,
    scopeId: template.scopeId,
    lookbackCandidateId: template.lookbackCandidateId,
    childRunId: template.childRunId,
    rollingSummaryPath: template.rollingSummaryPath,
    rollingReportPath: template.rollingReportPath,
    yearHitMetric,
    screenWindowCount: safeWindows.length,
    screenWindowYears: uniqueSortedStrings(windowCatalogs.map((window) => String(window.yearKey))),
    selectionLineIds: Array.from(selectionLineIds).sort((left, right) => left.localeCompare(right)),
    selectionModes: Array.from(selectionModes).sort((left, right) => left.localeCompare(right)),
    consensusCandidateCount: consensusRules.length,
    consensusRuleCount: qualifiedConsensusRules.length,
    topConsensusRuleId: qualifiedConsensusRules[0]?.ruleId ?? null,
    topConsensusRuleIds: qualifiedConsensusRules.slice(0, 10).map((row) => row.ruleId),
    readyForExactRefinement: qualifiedConsensusRules.length > 0,
    windowCatalogs,
    consensusRules,
  }
}

export const buildTechniqueOperatingBridgeManifest = ({
  contractId,
  sourceBankId,
  templateScreenRunId,
  templateScreenSummaryPath,
  yearConsensusSummaryPath,
  templateSummaries,
  unionConsensusRuleIds,
} = {}) => {
  const safeTemplateSummaries = Array.isArray(templateSummaries) ? templateSummaries : []
  return {
    kind: TECHNIQUE_OPERATING_BRIDGE_MANIFEST_KIND,
    generatedAt: new Date().toISOString(),
    contractId: toText(contractId),
    sourceBankId: toText(sourceBankId),
    templateScreenRunId: toText(templateScreenRunId),
    templateScreenSummaryPath: toText(templateScreenSummaryPath),
    yearConsensusSummaryPath: toText(yearConsensusSummaryPath),
    consensusTemplateCount: safeTemplateSummaries.length,
    readyForExactRefinement: unionConsensusRuleIds.length > 0,
    unionConsensusRuleCount: unionConsensusRuleIds.length,
    unionConsensusRuleIds,
    templates: safeTemplateSummaries.map((templateSummary) => ({
      candidateTemplateId: toText(templateSummary.candidateTemplateId),
      childRunId: toText(templateSummary.childRunId),
      bankId: toText(templateSummary.bankId),
      mechanismId: toText(templateSummary.mechanismId),
      scopeId: toText(templateSummary.scopeId),
      lookbackCandidateId: toText(templateSummary.lookbackCandidateId),
      screenWindowYears: uniqueSortedStrings(templateSummary.screenWindowYears),
      consensusRuleCount: toNumber(templateSummary.consensusRuleCount, 0),
      topConsensusRuleId: toText(templateSummary.topConsensusRuleId) || null,
      selectionLineIds: uniqueSortedStrings(templateSummary.selectionLineIds),
      selectionModes: uniqueSortedStrings(templateSummary.selectionModes),
      windowCatalogs: Array.isArray(templateSummary.windowCatalogs)
        ? templateSummary.windowCatalogs.map((catalog) => ({
            windowId: toText(catalog?.windowId),
            yearKey: toText(catalog?.yearKey),
            scopeRunId: toText(catalog?.scopeRunId),
            selectionLeaderboardPath: toText(catalog?.selectionLeaderboardPath),
            freezeResultPath: toText(catalog?.freezeResultPath),
            frozenCatalogPath: toText(catalog?.frozenCatalogPath),
            selectionLineId: toText(catalog?.selectionLineId) || null,
            selectionMode: toText(catalog?.selectionMode) || null,
          }))
        : [],
    })),
    nextStage: unionConsensusRuleIds.length > 0 ? "t5_in_bank_exact_refinement" : "stop_no_consensus_rules",
    notes: [
      "Do not treat this bridge manifest as a frozen operating catalog yet.",
      "If unionConsensusRuleCount is zero, stop before T5 and inspect template/year-consensus outputs.",
      "If unionConsensusRuleCount is positive, replay or exact-refine these rule identities on a fixed train source before recent/live-like confirmation.",
    ],
  }
}
