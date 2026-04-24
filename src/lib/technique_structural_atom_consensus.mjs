import crypto from "node:crypto"

import { toText, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_STRUCTURAL_ATOM_PROJECTION_KIND = "technique_structural_atom_projection_v1"
export const TECHNIQUE_STRUCTURAL_ATOM_CONSENSUS_SUMMARY_KIND = "technique_structural_atom_consensus_summary_v1"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const normalizeTokenToStructuralAtom = (token) => {
  const safeToken = toText(token)
  if (!safeToken) return null
  if (safeToken.includes(":")) return safeToken
  const segments = safeToken.split("_").filter(Boolean)
  if (segments.length < 2) return safeToken
  return `${segments[0]}:${segments.slice(1).join("_")}`
}

const buildPositiveSupportSignature = (row = {}) => ({
  yearsPresent: uniqueSortedStrings(row?.yearsPresent),
  yearsWithHitGe1: uniqueSortedStrings(row?.yearsWithHitGe1),
  yearsWithZeroNegative: uniqueSortedStrings(row?.yearsWithZeroNegative),
  aggregateOosMatchCount: toNumber(row?.aggregateOosMatchCount, 0),
  aggregateOosHitCount: toNumber(row?.aggregateOosHitCount, 0),
  aggregateOosNegativeCount: toNumber(row?.aggregateOosNegativeCount, 0),
  aggregateOosMatchedDateCount: toNumber(row?.aggregateOosMatchedDateCount, 0),
})

const buildPositiveSupportSignatureKey = (signature) =>
  JSON.stringify({
    yearsPresent: uniqueSortedStrings(signature?.yearsPresent),
    yearsWithHitGe1: uniqueSortedStrings(signature?.yearsWithHitGe1),
    yearsWithZeroNegative: uniqueSortedStrings(signature?.yearsWithZeroNegative),
    aggregateOosMatchCount: toNumber(signature?.aggregateOosMatchCount, 0),
    aggregateOosHitCount: toNumber(signature?.aggregateOosHitCount, 0),
    aggregateOosNegativeCount: toNumber(signature?.aggregateOosNegativeCount, 0),
    aggregateOosMatchedDateCount: toNumber(signature?.aggregateOosMatchedDateCount, 0),
  })

export const projectTechniqueConsensusRuleToStructuralAtoms = ({
  template,
  rule,
} = {}) => {
  if (!template || typeof template !== "object") {
    throw new Error("template is required")
  }
  if (!rule || typeof rule !== "object") {
    throw new Error("rule is required")
  }
  const structuralAtomIds = uniqueSortedStrings(
    (Array.isArray(rule?.tokens) ? rule.tokens : []).map(normalizeTokenToStructuralAtom).filter(Boolean),
  )
  const structuralFamilyIds = uniqueSortedStrings(
    structuralAtomIds.map((token) => token.split(":")[0]).filter(Boolean),
  )
  const positiveSupportSignature = buildPositiveSupportSignature(rule)
  const supportSignatureKey = buildPositiveSupportSignatureKey(positiveSupportSignature)
  const motifId = crypto
    .createHash("sha256")
    .update(JSON.stringify({ structuralAtomIds, supportSignatureKey }))
    .digest("hex")
    .slice(0, 16)
  return {
    kind: TECHNIQUE_STRUCTURAL_ATOM_PROJECTION_KIND,
    candidateTemplateId: toText(template?.candidateTemplateId),
    bankId: toText(template?.bankId),
    mechanismId: toText(template?.mechanismId),
    scopeId: toText(template?.scopeId),
    lookbackCandidateId: toText(template?.lookbackCandidateId),
    childRunId: toText(template?.childRunId),
    ruleId: toText(rule?.ruleId),
    familyId: toText(rule?.familyId) || null,
    motifId,
    structuralAtomIds,
    structuralFamilyIds,
    positiveSupportSignature,
    supportSignatureKey,
    aggregateOosHitRate: toNumber(rule?.aggregateOosHitRate, 0),
    passConsensus: rule?.passConsensus === true,
  }
}

export const buildTechniqueStructuralAtomConsensusSummary = ({
  projections = [],
  yearConsensusConfig = {},
} = {}) => {
  const safeRows = Array.isArray(projections) ? projections : []
  if (safeRows.length < 1) {
    throw new Error("Structural-atom consensus requires projection rows")
  }
  const motifRowsById = new Map()
  for (const row of safeRows) {
    const motifId = toText(row?.motifId)
    if (!motifId) continue
    if (!motifRowsById.has(motifId)) motifRowsById.set(motifId, [])
    motifRowsById.get(motifId).push(row)
  }
  const motifs = Array.from(motifRowsById.entries())
    .map(([motifId, rows]) => {
      const yearsPresent = uniqueSortedStrings(rows.flatMap((row) => row?.positiveSupportSignature?.yearsPresent ?? []))
      const yearsWithHitGe1 = uniqueSortedStrings(rows.flatMap((row) => row?.positiveSupportSignature?.yearsWithHitGe1 ?? []))
      const yearsWithZeroNegative = uniqueSortedStrings(
        rows.flatMap((row) => row?.positiveSupportSignature?.yearsWithZeroNegative ?? []),
      )
      const aggregateOosMatchCount = rows.reduce(
        (sum, row) => sum + toNumber(row?.positiveSupportSignature?.aggregateOosMatchCount, 0),
        0,
      )
      const aggregateOosHitCount = rows.reduce(
        (sum, row) => sum + toNumber(row?.positiveSupportSignature?.aggregateOosHitCount, 0),
        0,
      )
      const aggregateOosNegativeCount = rows.reduce(
        (sum, row) => sum + toNumber(row?.positiveSupportSignature?.aggregateOosNegativeCount, 0),
        0,
      )
      const aggregateOosMatchedDateCount = rows.reduce(
        (sum, row) => sum + toNumber(row?.positiveSupportSignature?.aggregateOosMatchedDateCount, 0),
        0,
      )
      const aggregateOosHitRate = aggregateOosMatchCount > 0 ? aggregateOosHitCount / aggregateOosMatchCount : 0
      const passStructuralConsensus =
        yearsPresent.length >= toNumber(yearConsensusConfig?.minConsensusYearsPresent, 0) &&
        yearsWithHitGe1.length >= toNumber(yearConsensusConfig?.minConsensusYearsWithHitGe1, 0) &&
        yearsWithZeroNegative.length >= toNumber(yearConsensusConfig?.minConsensusYearsWithZeroNegative, 0) &&
        aggregateOosHitRate >= toNumber(yearConsensusConfig?.minAggregateOosHitRate, 0) &&
        aggregateOosHitCount >= toNumber(yearConsensusConfig?.minAggregateOosHitCount, 0) &&
        aggregateOosMatchedDateCount >= toNumber(yearConsensusConfig?.minAggregateOosMatchedDateCount, 0)
      return {
        motifId,
        motifRuleCount: rows.length,
        motifTemplateCount: uniqueSortedStrings(rows.map((row) => row?.candidateTemplateId)).length,
        candidateTemplateIds: uniqueSortedStrings(rows.map((row) => row?.candidateTemplateId)),
        sourceRuleIds: uniqueSortedStrings(rows.map((row) => row?.ruleId)),
        structuralAtomIds: uniqueSortedStrings(rows.flatMap((row) => row?.structuralAtomIds ?? [])),
        structuralFamilyIds: uniqueSortedStrings(rows.flatMap((row) => row?.structuralFamilyIds ?? [])),
        supportSignatureKeys: uniqueSortedStrings(rows.map((row) => row?.supportSignatureKey)),
        yearsPresent,
        yearsWithHitGe1,
        yearsWithZeroNegative,
        aggregateOosMatchCount,
        aggregateOosHitCount,
        aggregateOosNegativeCount,
        aggregateOosMatchedDateCount,
        aggregateOosHitRate,
        passStructuralConsensus,
      }
    })
    .sort((left, right) => {
      if (Number(right.passStructuralConsensus) !== Number(left.passStructuralConsensus)) {
        return Number(right.passStructuralConsensus) - Number(left.passStructuralConsensus)
      }
      const templateDelta = Number(right.motifTemplateCount ?? 0) - Number(left.motifTemplateCount ?? 0)
      if (templateDelta !== 0) return templateDelta
      const hitRateDelta = Number(right.aggregateOosHitRate ?? 0) - Number(left.aggregateOosHitRate ?? 0)
      if (Math.abs(hitRateDelta) > 1e-12) return hitRateDelta > 0 ? 1 : -1
      return String(left.motifId ?? "").localeCompare(String(right.motifId ?? ""))
    })
  return {
    kind: TECHNIQUE_STRUCTURAL_ATOM_CONSENSUS_SUMMARY_KIND,
    generatedAt: new Date().toISOString(),
    projectionRowCount: safeRows.length,
    motifCount: motifs.length,
    passMotifCount: motifs.filter((motif) => motif.passStructuralConsensus === true).length,
    motifs,
  }
}
