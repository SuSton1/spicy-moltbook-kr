import crypto from "node:crypto"

import { toText, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_CLAUSE_CORE_CONSENSUS_SUMMARY_KIND = "technique_clause_core_consensus_summary_v1"
export const TECHNIQUE_CLAUSE_CORE_RERUN_PLAN_KIND = "technique_clause_core_rerun_plan_v1"

const uniqueSorted = (values = []) => uniqueSortedStrings(values)

const intersectClauseIds = (templateRows = [], field) => {
  const safeRows = Array.isArray(templateRows) ? templateRows : []
  if (safeRows.length < 1) return []
  let intersection = uniqueSorted(safeRows[0]?.[field])
  for (const row of safeRows.slice(1)) {
    const candidate = new Set(uniqueSorted(row?.[field]))
    intersection = intersection.filter((value) => candidate.has(value))
  }
  return uniqueSorted(intersection)
}

const countClauseIds = (templateRows = [], field) => {
  const counts = new Map()
  for (const row of Array.isArray(templateRows) ? templateRows : []) {
    for (const clauseId of uniqueSorted(row?.[field])) {
      counts.set(clauseId, Number(counts.get(clauseId) ?? 0) + 1)
    }
  }
  return counts
}

const buildSoftCore = (templateRows = [], field) =>
  Array.from(countClauseIds(templateRows, field).entries())
    .filter(([, count]) => count >= 2)
    .map(([clauseId]) => clauseId)
    .sort((left, right) => left.localeCompare(right))

const buildVariantExtras = ({ template, hardCore }) => ({
  anchorClauseIds: uniqueSorted(template?.anchorClauseIds).filter((value) => !hardCore.anchorClauseIds.includes(value)),
  retestClauseIds: uniqueSorted(template?.retestClauseIds).filter((value) => !hardCore.retestClauseIds.includes(value)),
  compressionClauseIds: uniqueSorted(template?.compressionClauseIds).filter(
    (value) => !hardCore.compressionClauseIds.includes(value),
  ),
  confirmClauseIds: uniqueSorted(template?.confirmClauseIds).filter((value) => !hardCore.confirmClauseIds.includes(value)),
  invalidateClauseIds: uniqueSorted(template?.invalidateClauseIds),
})

const buildVariantKey = (variantExtras) =>
  JSON.stringify({
    anchorClauseIds: uniqueSorted(variantExtras.anchorClauseIds),
    retestClauseIds: uniqueSorted(variantExtras.retestClauseIds),
    compressionClauseIds: uniqueSorted(variantExtras.compressionClauseIds),
    confirmClauseIds: uniqueSorted(variantExtras.confirmClauseIds),
    invalidateClauseIds: uniqueSorted(variantExtras.invalidateClauseIds),
  })

const hasRequiredClauseFamilies = (candidate = {}) => {
  const anchorCount = uniqueSorted(candidate.anchorClauseIds).length
  const confirmCount = uniqueSorted(candidate.confirmClauseIds).length
  const setupCount =
    uniqueSorted(candidate.retestClauseIds).length + uniqueSorted(candidate.compressionClauseIds).length
  return anchorCount >= 1 && confirmCount >= 1 && setupCount >= 1
}

const buildHypothesisId = ({ cohortId, variantId, allClauseIds = [] } = {}) =>
  `${cohortId}_${variantId}_${crypto.createHash("sha256").update(uniqueSorted(allClauseIds).join("|")).digest("hex").slice(0, 8)}`

export const selectTechniqueClauseCoreTemplates = ({
  templateScreenSummary,
  selectedTemplateIds = [],
} = {}) => {
  if (!templateScreenSummary || typeof templateScreenSummary !== "object") {
    throw new Error("templateScreenSummary is required")
  }
  const templates = Array.isArray(templateScreenSummary.templates) ? templateScreenSummary.templates : []
  if (templates.length < 1) {
    throw new Error("templateScreenSummary.templates is empty")
  }
  const passTemplates = templates.filter((template) => template?.passScreen === true)
  if (passTemplates.length < 1) {
    throw new Error("templateScreenSummary.passTemplateCount is zero; clause-core consensus requires passed templates")
  }
  const requestedTemplateIds = uniqueSorted(selectedTemplateIds)
  for (const templateId of requestedTemplateIds) {
    const template = passTemplates.find((entry) => toText(entry?.candidateTemplateId) === templateId)
    if (!template) {
      throw new Error(`Requested passed template is not present in templateScreenSummary: ${templateId}`)
    }
  }
  const selected = passTemplates.filter(
    (template) =>
      requestedTemplateIds.length < 1 || requestedTemplateIds.includes(toText(template?.candidateTemplateId)),
  )
  if (selected.length < 1) {
    throw new Error("No passed templates remain after clause-core template selection filters")
  }
  return selected
}

export const buildTechniqueClauseCoreConsensusSummary = ({
  templateScreenSummary,
  selectedTemplateIds = [],
} = {}) => {
  const passTemplates = selectTechniqueClauseCoreTemplates({
    templateScreenSummary,
    selectedTemplateIds,
  })
  const cohortsById = new Map()
  for (const template of passTemplates) {
    const cohortId =
      toText(template?.sourceClusterBankId) ||
      toText(template?.clusterId) ||
      toText(template?.sourceBankId) ||
      toText(template?.bankId)
    if (!cohortId) {
      throw new Error(`Clause-core template is missing cohort identity: ${toText(template?.candidateTemplateId)}`)
    }
    if (!cohortsById.has(cohortId)) {
      cohortsById.set(cohortId, [])
    }
    cohortsById.get(cohortId).push(template)
  }

  const cohorts = Array.from(cohortsById.entries())
    .map(([cohortId, templateRows]) => {
      const sortedTemplates = templateRows
        .slice()
        .sort((left, right) => String(left?.candidateTemplateId ?? "").localeCompare(String(right?.candidateTemplateId ?? "")))
      const hardCore = {
        anchorClauseIds: intersectClauseIds(sortedTemplates, "anchorClauseIds"),
        retestClauseIds: intersectClauseIds(sortedTemplates, "retestClauseIds"),
        compressionClauseIds: intersectClauseIds(sortedTemplates, "compressionClauseIds"),
        confirmClauseIds: intersectClauseIds(sortedTemplates, "confirmClauseIds"),
      }
      const softCore = {
        anchorClauseIds: buildSoftCore(sortedTemplates, "anchorClauseIds"),
        retestClauseIds: buildSoftCore(sortedTemplates, "retestClauseIds"),
        compressionClauseIds: buildSoftCore(sortedTemplates, "compressionClauseIds"),
        confirmClauseIds: buildSoftCore(sortedTemplates, "confirmClauseIds"),
      }
      const hardCoreAllClauseIds = uniqueSorted(Object.values(hardCore).flatMap((values) => values))
      const softCoreAllClauseIds = uniqueSorted(Object.values(softCore).flatMap((values) => values))
      const variantMap = new Map()
      for (const template of sortedTemplates) {
        const variantExtras = buildVariantExtras({
          template,
          hardCore,
        })
        const variantKey = buildVariantKey(variantExtras)
        if (!variantMap.has(variantKey)) {
          variantMap.set(variantKey, {
            variantId: `variant_${variantMap.size + 1}`,
            variantExtras,
            supportingTemplateIds: [],
            avgHitRateAccumulator: [],
          })
        }
        const variant = variantMap.get(variantKey)
        variant.supportingTemplateIds.push(toText(template?.candidateTemplateId))
        variant.avgHitRateAccumulator.push(Number(template?.oosHitRate ?? 0) || 0)
      }
      const branchVariants = Array.from(variantMap.values())
        .map((variant) => {
          const allClauseIds = uniqueSorted(
            hardCoreAllClauseIds.concat(Object.values(variant.variantExtras).flatMap((values) => values)),
          )
          return {
            variantId: variant.variantId,
            supportingTemplateIds: uniqueSorted(variant.supportingTemplateIds),
            supportingTemplateCount: uniqueSorted(variant.supportingTemplateIds).length,
            avgSupportingOosHitRate:
              variant.avgHitRateAccumulator.length > 0
                ? variant.avgHitRateAccumulator.reduce((sum, value) => sum + value, 0) /
                  variant.avgHitRateAccumulator.length
                : 0,
            ...variant.variantExtras,
            allClauseIds,
          }
        })
        .sort((left, right) => {
          const supportDelta = Number(right.supportingTemplateCount ?? 0) - Number(left.supportingTemplateCount ?? 0)
          if (supportDelta !== 0) return supportDelta
          const hitRateDelta = Number(right.avgSupportingOosHitRate ?? 0) - Number(left.avgSupportingOosHitRate ?? 0)
          if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta > 0 ? 1 : -1
          return String(left.variantId ?? "").localeCompare(String(right.variantId ?? ""))
        })
      const rerunHypotheses = []
      const hardCoreCandidate = {
        anchorClauseIds: hardCore.anchorClauseIds,
        retestClauseIds: hardCore.retestClauseIds,
        compressionClauseIds: hardCore.compressionClauseIds,
        confirmClauseIds: hardCore.confirmClauseIds,
        invalidateClauseIds: [],
      }
      if (hasRequiredClauseFamilies(hardCoreCandidate)) {
        rerunHypotheses.push({
          hypothesisId: buildHypothesisId({
            cohortId,
            variantId: "hard_core",
            allClauseIds: hardCoreAllClauseIds,
          }),
          hypothesisType: "hard_core",
          sourceCohortId: cohortId,
          supportingTemplateIds: sortedTemplates.map((template) => toText(template?.candidateTemplateId)),
          supportingTemplateCount: sortedTemplates.length,
          ...hardCoreCandidate,
          allClauseIds: hardCoreAllClauseIds,
        })
      }
      for (const variant of branchVariants) {
        const hypothesis = {
          hypothesisId: buildHypothesisId({
            cohortId,
            variantId: variant.variantId,
            allClauseIds: variant.allClauseIds,
          }),
          hypothesisType: "hard_core_plus_branch",
          sourceCohortId: cohortId,
          supportingTemplateIds: variant.supportingTemplateIds,
          supportingTemplateCount: variant.supportingTemplateCount,
          anchorClauseIds: uniqueSorted(hardCore.anchorClauseIds.concat(variant.anchorClauseIds)),
          retestClauseIds: uniqueSorted(hardCore.retestClauseIds.concat(variant.retestClauseIds)),
          compressionClauseIds: uniqueSorted(
            hardCore.compressionClauseIds.concat(variant.compressionClauseIds),
          ),
          confirmClauseIds: uniqueSorted(hardCore.confirmClauseIds.concat(variant.confirmClauseIds)),
          invalidateClauseIds: uniqueSorted(variant.invalidateClauseIds),
          allClauseIds: variant.allClauseIds,
          variantId: variant.variantId,
        }
        if (!hasRequiredClauseFamilies(hypothesis)) continue
        rerunHypotheses.push(hypothesis)
      }
      return {
        cohortId,
        sourceBankId: toText(sortedTemplates[0]?.sourceBankId) || toText(sortedTemplates[0]?.bankId),
        sourceClusterBankId: toText(sortedTemplates[0]?.sourceClusterBankId) || null,
        clusterId: toText(sortedTemplates[0]?.clusterId) || null,
        mechanismId: toText(sortedTemplates[0]?.mechanismId),
        scopeId: toText(sortedTemplates[0]?.scopeId),
        lookbackCandidateId: toText(sortedTemplates[0]?.lookbackCandidateId),
        supportingTemplateIds: sortedTemplates.map((template) => toText(template?.candidateTemplateId)),
        supportingTemplateCount: sortedTemplates.length,
        hardCoreClauseIds: hardCore,
        hardCoreAllClauseIds,
        softCoreClauseIds: softCore,
        softCoreAllClauseIds,
        branchVariants,
        rerunHypothesisCount: rerunHypotheses.length,
        recommendedRerunTemplateHypotheses: rerunHypotheses,
        clauseFamilyGatePass: hasRequiredClauseFamilies({
          anchorClauseIds: softCore.anchorClauseIds,
          retestClauseIds: softCore.retestClauseIds,
          compressionClauseIds: softCore.compressionClauseIds,
          confirmClauseIds: softCore.confirmClauseIds,
        }),
      }
    })
    .sort((left, right) => {
      const supportDelta = Number(right.supportingTemplateCount ?? 0) - Number(left.supportingTemplateCount ?? 0)
      if (supportDelta !== 0) return supportDelta
      return String(left.cohortId ?? "").localeCompare(String(right.cohortId ?? ""))
    })

  return {
    kind: TECHNIQUE_CLAUSE_CORE_CONSENSUS_SUMMARY_KIND,
    generatedAt: new Date().toISOString(),
    templateScreenRunId: toText(templateScreenSummary?.runId),
    sourceBankId: toText(templateScreenSummary?.sourceBankId),
    selectedTemplateCount: passTemplates.length,
    cohortCount: cohorts.length,
    rerunHypothesisCount: cohorts.reduce(
      (sum, cohort) => sum + (Number(cohort?.rerunHypothesisCount ?? 0) || 0),
      0,
    ),
    cohorts,
  }
}

export const buildTechniqueClauseCoreRerunPlan = ({
  consensusSummary,
  selectedCohortIds = [],
  maxHypotheses = null,
} = {}) => {
  if (!consensusSummary || typeof consensusSummary !== "object") {
    throw new Error("consensusSummary is required")
  }
  const cohorts = Array.isArray(consensusSummary.cohorts) ? consensusSummary.cohorts : []
  if (cohorts.length < 1) {
    throw new Error("consensusSummary.cohorts is empty")
  }
  const requestedCohortIds = uniqueSorted(selectedCohortIds)
  for (const cohortId of requestedCohortIds) {
    if (!cohorts.some((cohort) => toText(cohort?.cohortId) === cohortId)) {
      throw new Error(`Requested cohortId is not present in clause-core summary: ${cohortId}`)
    }
  }
  const hypotheses = cohorts
    .filter((cohort) => requestedCohortIds.length < 1 || requestedCohortIds.includes(toText(cohort?.cohortId)))
    .flatMap((cohort) => Array.isArray(cohort?.recommendedRerunTemplateHypotheses) ? cohort.recommendedRerunTemplateHypotheses : [])
    .slice(0, Number.isFinite(Number(maxHypotheses)) && Number(maxHypotheses) > 0 ? Number(maxHypotheses) : undefined)
  if (hypotheses.length < 1) {
    throw new Error("Clause-core rerun plan resolved zero hypotheses")
  }
  return {
    kind: TECHNIQUE_CLAUSE_CORE_RERUN_PLAN_KIND,
    generatedAt: new Date().toISOString(),
    sourceSummaryKind: toText(consensusSummary.kind),
    templateScreenRunId: toText(consensusSummary.templateScreenRunId),
    hypothesisCount: hypotheses.length,
    hypotheses,
  }
}
