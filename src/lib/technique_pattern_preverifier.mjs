import {
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_PATTERN_PREVERIFY_REPORT_KIND = "technique_pattern_preverify_report_v1"

const intersectSortedIntegerArrays = (leftValues = [], rightValues = []) => {
  const out = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < leftValues.length && rightIndex < rightValues.length) {
    const left = leftValues[leftIndex]
    const right = rightValues[rightIndex]
    if (left === right) {
      out.push(left)
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (left < right) {
      leftIndex += 1
      continue
    }
    rightIndex += 1
  }
  return out
}

const ensurePattern = (pattern) => {
  if (!pattern || typeof pattern !== "object") {
    throw new Error("Technique pattern preverifier requires pattern objects")
  }
  const patternId = toText(pattern.patternId)
  const partitionKey = toText(pattern.partitionKey)
  const positiveSignatureId = toText(pattern.positiveSignatureId)
  const generatorAtomIds = uniqueSortedStrings(pattern.seedGeneratorAtomIds ?? pattern.generatorAtomIds ?? pattern.atomIds)
  const closureAtomIds = uniqueSortedStrings(pattern.closureAtomIds)
  if (!patternId || !partitionKey || generatorAtomIds.length < 1) {
    throw new Error("Technique pattern preverifier pattern is missing patternId/partitionKey/generatorAtomIds")
  }
  return {
    ...pattern,
    patternId,
    partitionKey,
    positiveSignatureId: positiveSignatureId || `${partitionKey}::${patternId}`,
    generatorAtomIds,
    closureAtomIds,
    atomCount: Math.max(1, Math.floor(Number(pattern.atomCount) || generatorAtomIds.length)),
    totalPositiveSupport: Math.max(0, Number(pattern.totalPositiveSupport) || 0),
    minYearSupport: Math.max(0, Number(pattern.minYearSupport) || 0),
  }
}

const computeNegativeTidset = ({ partitionIndex, atomIds = [] } = {}) => {
  if (!partitionIndex || typeof partitionIndex !== "object") return []
  let matchedNegativeTids = null
  for (const atomId of atomIds) {
    const atomTidset = Array.isArray(partitionIndex.atomNegativeTidsets?.[atomId])
      ? partitionIndex.atomNegativeTidsets[atomId]
      : null
    if (!atomTidset || atomTidset.length < 1) return []
    matchedNegativeTids = matchedNegativeTids === null
      ? atomTidset.slice()
      : intersectSortedIntegerArrays(matchedNegativeTids, atomTidset)
    if (matchedNegativeTids.length < 1) return []
  }
  return matchedNegativeTids ?? []
}

const rankPatterns = (left, right) =>
  left.preverifiedNegativeCount - right.preverifiedNegativeCount ||
  right.atomCount - left.atomCount ||
  right.minYearSupport - left.minYearSupport ||
  right.totalPositiveSupport - left.totalPositiveSupport ||
  left.patternId.localeCompare(right.patternId)

export const preverifyTechniquePatternCandidates = ({
  patterns = [],
  negativeAtomIndex = null,
  topKPerSignature = 8,
} = {}) => {
  const safePatterns = (Array.isArray(patterns) ? patterns : []).map(ensurePattern)
  const partitions = negativeAtomIndex?.partitions && typeof negativeAtomIndex.partitions === "object"
    ? negativeAtomIndex.partitions
    : {}
  const safeTopK = Math.max(1, Math.floor(Number(topKPerSignature) || 0))
  const enrichedPatterns = safePatterns.map((pattern) => {
    const partitionIndex = partitions[pattern.partitionKey] ?? null
    const seedGeneratorAtomIds = pattern.generatorAtomIds.slice()
    const closureAugmentedAtomIds = uniqueSortedStrings([...seedGeneratorAtomIds, ...pattern.closureAtomIds])
    const generatorNegativeTidset = computeNegativeTidset({
      partitionIndex,
      atomIds: seedGeneratorAtomIds,
    })
    const closureNegativeTidset = computeNegativeTidset({
      partitionIndex,
      atomIds: closureAugmentedAtomIds,
    })
    const useClosureAugmented =
      closureAugmentedAtomIds.length > seedGeneratorAtomIds.length &&
      closureNegativeTidset.length <= generatorNegativeTidset.length
    const chosenAtomIds = useClosureAugmented ? closureAugmentedAtomIds : seedGeneratorAtomIds
    const preverifiedNegativeCount = useClosureAugmented ? closureNegativeTidset.length : generatorNegativeTidset.length
    return {
      ...pattern,
      kind: "technique_preverified_pattern_v1",
      seedGeneratorAtomIds,
      generatorAtomIds: seedGeneratorAtomIds,
      atomIds: seedGeneratorAtomIds,
      closureAugmentedAtomIds,
      preverifyAtomIds: chosenAtomIds,
      preverifyAtomCount: chosenAtomIds.length,
      preverifiedGeneratorNegativeCount: generatorNegativeTidset.length,
      preverifiedClosureNegativeCount: closureNegativeTidset.length,
      preverifyStrategy: useClosureAugmented ? "closure_augmented" : "generator_only",
      preverifiedNegativeCount,
      preverifiedZeroNegative: preverifiedNegativeCount === 0,
    }
  })

  const bySignature = new Map()
  for (const pattern of enrichedPatterns) {
    const signatureKey = `${pattern.partitionKey}::${pattern.positiveSignatureId}`
    let rows = bySignature.get(signatureKey)
    if (!rows) {
      rows = []
      bySignature.set(signatureKey, rows)
    }
    rows.push(pattern)
  }

  const retainedPatterns = []
  let zeroNegativeCandidateCount = 0
  for (const rows of bySignature.values()) {
    rows.sort(rankPatterns)
    zeroNegativeCandidateCount += rows.filter((row) => row.preverifiedZeroNegative).length
    retainedPatterns.push(...rows.slice(0, safeTopK).map((row, index) => ({
      ...row,
      preverifyRankWithinSignature: index + 1,
      preverifyRetained: true,
    })))
  }

  retainedPatterns.sort(rankPatterns)

  return {
    kind: TECHNIQUE_PATTERN_PREVERIFY_REPORT_KIND,
    evaluatedPatternCount: enrichedPatterns.length,
    retainedPatternCount: retainedPatterns.length,
    zeroNegativeCandidateCount,
    signatureCount: bySignature.size,
    topKPerSignature: safeTopK,
    evaluatedPatterns: enrichedPatterns,
    retainedPatterns,
  }
}
