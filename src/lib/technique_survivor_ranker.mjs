import { toText } from "./technique_common.mjs"

export const TECHNIQUE_SURVIVOR_SUMMARY_KIND = "technique_survivor_summary_v1"

const ensureVerifiedPattern = (pattern) => {
  if (!pattern || typeof pattern !== "object") {
    throw new Error("Technique survivor ranker requires pattern objects")
  }
  const patternId = toText(pattern.patternId)
  if (!patternId) throw new Error("Technique survivor ranker pattern is missing patternId")
  return {
    ...pattern,
    patternId,
    partitionKey: toText(pattern.partitionKey),
    positiveSignatureId: toText(pattern.positiveSignatureId),
    atomIds: Array.isArray(pattern.atomIds) ? pattern.atomIds.slice() : [],
    generatorAtomIds: Array.isArray(pattern.generatorAtomIds) ? pattern.generatorAtomIds.slice() : [],
    atomCount: Math.max(0, Math.floor(Number(pattern.atomCount) || 0)),
    minYearPositiveSupport: Math.max(0, Number(pattern.minYearPositiveSupport) || 0),
    totalPositiveSupport: Math.max(0, Number(pattern.totalPositiveSupport) || 0),
    maxYearShare: Math.max(0, Number(pattern.maxYearShare) || 0),
    top1DateShare: Math.max(0, Number(pattern.top1DateShare) || 0),
    top1SymbolShare: Math.max(0, Number(pattern.top1SymbolShare) || 0),
    negativeCount: Math.max(0, Math.floor(Number(pattern.negativeCount) || 0)),
    pass: pattern.pass === true,
  }
}

export const rankTechniqueVerifiedPatterns = ({ patterns = [], topK = 25 } = {}) => {
  const safePatterns = (Array.isArray(patterns) ? patterns : [])
    .map(ensureVerifiedPattern)
    .filter((pattern) => pattern.pass === true)
    .sort(
      (left, right) =>
        right.minYearPositiveSupport - left.minYearPositiveSupport ||
        right.totalPositiveSupport - left.totalPositiveSupport ||
      left.maxYearShare - right.maxYearShare ||
      left.top1DateShare - right.top1DateShare ||
      left.top1SymbolShare - right.top1SymbolShare ||
      right.atomCount - left.atomCount ||
      left.partitionKey.localeCompare(right.partitionKey) ||
      left.patternId.localeCompare(right.patternId),
    )
    .map((pattern, index) => ({
      ...pattern,
      rank: index + 1,
    }))
  const safeTopK = Math.max(1, Math.floor(Number(topK) || 0))
  const topPatterns = safePatterns.slice(0, safeTopK)
  return {
    kind: TECHNIQUE_SURVIVOR_SUMMARY_KIND,
    verifiedPatternCount: safePatterns.length,
    topPatternCount: topPatterns.length,
    topPatternIds: topPatterns.map((pattern) => pattern.patternId),
    rankedPatterns: safePatterns,
    topPatterns,
  }
}
