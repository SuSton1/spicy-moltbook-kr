import { evaluateTechniqueClause } from "./technique_clause_library.mjs"
import { deriveTechniqueFeatureMap } from "./technique_feature_derivation.mjs"
import {
  average,
  buildTechniqueBankId,
  ensureDateKey,
  extractNumericFeatureMap,
  extractTokenSet,
  toText,
  yearKeyFromDateKey,
} from "./technique_common.mjs"

export const TECHNIQUE_EVENT_ROW_KIND = "technique_event_row_v1"

const extractScopeId = ({ row, defaultScopeId = null } = {}) => {
  const scopeId = toText(row?.scopeId ?? row?.candidateScopeId ?? defaultScopeId)
  if (!scopeId) {
    throw new Error("Technique event rows require scopeId or --default-scope-id")
  }
  return scopeId
}

const extractLookbackCandidateId = ({ row, defaultLookbackCandidateId = null } = {}) => {
  const candidateId = toText(row?.lookbackCandidateId ?? row?.candidateId ?? defaultLookbackCandidateId)
  if (!candidateId) {
    throw new Error("Technique event rows require lookbackCandidateId or --default-lookback-candidate-id")
  }
  return candidateId
}

const extractSymbol = (row) => {
  const symbol = toText(row?.symbol)
  if (!symbol) {
    throw new Error("Technique event rows require symbol")
  }
  return symbol
}

const extractLabelHit = ({ row, labelId } = {}) => {
  const direct =
    row?.labelMap?.[labelId] ??
    row?.labels?.[labelId] ??
    row?.metricsByLabel?.[labelId]?.hitTarget ??
    row?.[labelId]
  if (typeof direct === "boolean") return direct
  if (Number.isFinite(Number(direct))) return Number(direct) > 0
  if (labelId === "tp12_no_stop_hit_3d" && typeof row?.eventOutcome?.hitTarget === "boolean") {
    return row.eventOutcome.hitTarget
  }
  return false
}

export const buildTechniqueEventMatchesForRow = ({
  row,
  templates,
  labelId,
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  if (safeTemplates.length < 1) return []
  const symbol = extractSymbol(row)
  const decisionDateKey = ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
  const scopeId = extractScopeId({ row, defaultScopeId })
  const lookbackCandidateId = extractLookbackCandidateId({ row, defaultLookbackCandidateId })
  const featureMap = deriveTechniqueFeatureMap({
    row,
    numericFeatureMap: extractNumericFeatureMap(row),
  })
  const tokenSet = extractTokenSet(row)
  const yearKey = yearKeyFromDateKey(decisionDateKey)
  const hitTarget = extractLabelHit({ row, labelId })

  const matches = []
  for (const template of safeTemplates) {
    if (!template.scopeCandidates.includes(scopeId)) continue
    if (!template.lookbackCandidateIds.includes(lookbackCandidateId)) continue
    const evaluations = template.allClauseIds.map((clauseId) =>
      evaluateTechniqueClause({
        clauseSpec: clauseId,
        featureMap,
        tokenSet,
      }),
    )
    if (!evaluations.every((entry) => entry.pass)) continue
    const confirmScores = evaluations
      .filter((entry) => entry.clauseGroup === "confirm")
      .map((entry) => Number(entry.score ?? 0))
    matches.push({
      kind: TECHNIQUE_EVENT_ROW_KIND,
      candidateTemplateId: template.candidateTemplateId,
      seedId: template.seedId,
      mechanismId: template.mechanismId,
      bankId: buildTechniqueBankId({
        mechanismId: template.mechanismId,
        scopeId,
        lookbackCandidateId,
      }),
      scopeId,
      lookbackCandidateId,
      symbol,
      decisionDateKey,
      yearKey,
      labelId,
      hitTarget,
      templateScore: average(evaluations.map((entry) => Number(entry.score ?? 0))) ?? 0,
      templateConfirmScore: confirmScores.length > 0 ? average(confirmScores) ?? 0 : 0,
      totalClauseCount: template.allClauseIds.length,
      confirmClauseCount: confirmScores.length,
      matchedClauseIds: template.allClauseIds.slice(),
      sourceRowId:
        toText(row?.rowId) ||
        `${decisionDateKey}::${symbol}::${scopeId}::${lookbackCandidateId}`,
    })
  }
  return matches
}
