import { createHash } from "node:crypto"

import {
  toText,
  uniqueSortedIntegers,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_CLOSED_PATTERN_SET_KIND = "technique_closed_pattern_set_v2"

const DEFAULT_INCLUDE_PATTERNS = true

const ensureSortedIntegerArray = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isInteger(value) && value >= 0),
    ),
  ).sort((left, right) => left - right)

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

const buildYearTidsetSignature = ({ coreYears = [], yearTidsets = [] } = {}) =>
  uniqueSortedIntegers(coreYears)
    .reduce((hash, yearKey, index) => {
      hash.update(`${yearKey}:`)
      for (const tid of Array.isArray(yearTidsets[index]) ? yearTidsets[index] : []) {
        hash.update(`${tid},`)
      }
      hash.update("|")
      return hash
    }, createHash("sha1"))
    .digest("hex")

const buildEligibleAtomRecords = ({ partition, coreYears, minPositiveSupportPerYear }) => {
  const atomYearTidsets = partition?.atomYearTidsets
  if (!atomYearTidsets || typeof atomYearTidsets !== "object" || Array.isArray(atomYearTidsets)) {
    throw new Error("Positive-year index partition is missing atomYearTidsets")
  }
  const atomMetadataById = partition?.atomMetadataById && typeof partition.atomMetadataById === "object"
    ? partition.atomMetadataById
    : {}
  const eligibleAtoms = []
  for (const rawAtomId of Object.keys(atomYearTidsets)) {
    const atomId = toText(rawAtomId)
    if (!atomId) continue
    const byYear = atomYearTidsets[atomId]
    const yearTidsets = coreYears.map((yearKey) => ensureSortedIntegerArray(byYear?.[String(yearKey)]))
    const yearSupportVector = yearTidsets.map((values) => values.length)
    if (yearSupportVector.some((support) => support < minPositiveSupportPerYear)) continue
    eligibleAtoms.push({
      atomId,
      yearTidsets,
      yearSupportVector,
      totalPositiveSupport: yearSupportVector.reduce((sum, value) => sum + value, 0),
      familyId: toText(atomMetadataById?.[atomId]?.familyId) || "unknown",
      baseFeatureId: toText(atomMetadataById?.[atomId]?.baseFeatureId) || atomId,
    })
  }
  eligibleAtoms.sort(
    (left, right) =>
      left.totalPositiveSupport - right.totalPositiveSupport ||
      left.atomId.localeCompare(right.atomId),
  )
  return eligibleAtoms
}

const normalizePositiveYearIndex = ({
  positiveYearIndex,
  coreYears = [],
  minPositiveSupportPerYear,
  familyCaps = {},
}) => {
  if (!positiveYearIndex || typeof positiveYearIndex !== "object") {
    throw new Error("mineTechniqueClosedPatterns requires positiveYearIndex")
  }
  const safeCoreYears = uniqueSortedIntegers(
    coreYears.length > 0 ? coreYears : positiveYearIndex.coreYears,
  )
  if (safeCoreYears.length < 1) {
    throw new Error("mineTechniqueClosedPatterns requires coreYears")
  }
  const safeMinPositiveSupportPerYear = Math.max(1, Math.floor(Number(minPositiveSupportPerYear) || 0))
  return {
    positiveYearIndex,
    coreYears: safeCoreYears,
    minPositiveSupportPerYear: safeMinPositiveSupportPerYear,
    familyCaps: familyCaps && typeof familyCaps === "object" ? familyCaps : {},
  }
}

const buildGeneratorRankKey = (atomIds = []) => `${String(999 - atomIds.length).padStart(4, "0")}|${atomIds.join("|")}`

const registerGeneratorForSignature = ({
  signatureEntry,
  atomIds,
  maxGeneratorsPerSignature,
} = {}) => {
  const generatorKey = atomIds.join("|")
  if (signatureEntry.generatorKeys.has(generatorKey)) return
  signatureEntry.generatorKeys.add(generatorKey)
  signatureEntry.generators.push({
    generatorAtomIds: atomIds.slice(),
    generatorRankKey: buildGeneratorRankKey(atomIds),
    generatorAtomCount: atomIds.length,
  })
  const rows = signatureEntry.generators
    .sort((left, right) =>
      right.generatorAtomCount - left.generatorAtomCount ||
      left.generatorRankKey.localeCompare(right.generatorRankKey),
    )
  while (rows.length > maxGeneratorsPerSignature) {
    const removed = rows.pop()
    signatureEntry.generatorKeys.delete(removed.generatorAtomIds.join("|"))
  }
}

const buildClosureAtomIdsForSignature = ({ signatureEntry, partitionAtomOrder = [] } = {}) => {
  const flags = signatureEntry?.closureAtomFlags
  if (!(flags instanceof Uint8Array)) return []
  const closureAtomIds = []
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === 1) closureAtomIds.push(partitionAtomOrder[index])
  }
  return uniqueSortedStrings(closureAtomIds)
}

export function* iterateTechniqueClosedPatternRows({
  mined = null,
  startIndex = 0,
} = {}) {
  const signatureEntries = Array.isArray(mined?.signatureEntries) ? mined.signatureEntries : []
  const partitionAtomOrderByKey = mined?.partitionAtomOrderByKey && typeof mined.partitionAtomOrderByKey === "object"
    ? mined.partitionAtomOrderByKey
    : {}
  let patternIndex = Math.max(0, Math.floor(Number(startIndex) || 0))
  for (const entry of signatureEntries) {
    const closureAtomIds = buildClosureAtomIdsForSignature({
      signatureEntry: entry,
      partitionAtomOrder: partitionAtomOrderByKey[entry.partitionKey] ?? [],
    })
    const yearSupportVector = entry.yearSupportVector.slice()
    const totalPositiveSupport = yearSupportVector.reduce((sum, value) => sum + value, 0)
    const minYearSupport = yearSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
    const maxYearSupport = yearSupportVector.reduce((best, value) => Math.max(best, value), 0)
    const generators = Array.isArray(entry.generators) ? entry.generators : []
    for (let generatorIndex = 0; generatorIndex < generators.length; generatorIndex += 1) {
      const generator = generators[generatorIndex]
      patternIndex += 1
      yield {
        kind: "technique_closed_pattern_v2",
        coreYears: mined.coreYears.slice(),
        partitionKey: entry.partitionKey,
        positiveSignatureId: `${entry.partitionKey}::${entry.supportSignature}`,
        generatorAtomIds: generator.generatorAtomIds,
        closureAtomIds,
        atomIds: generator.generatorAtomIds.slice(),
        atomCount: generator.generatorAtomIds.length,
        closureAtomCount: closureAtomIds.length,
        generatorRankWithinSignature: generatorIndex + 1,
        signatureGeneratorCount: generators.length,
        yearSupportVector,
        minYearSupport: Number.isFinite(minYearSupport) ? minYearSupport : 0,
        maxYearSupport,
        totalPositiveSupport,
        supportSignature: entry.supportSignature,
        rawPatternCount: entry.rawPatternCount,
        patternId: `closed_pattern_${String(patternIndex).padStart(6, "0")}`,
      }
    }
  }
}

export const canAppendTechniqueAtomToPattern = ({
  nextAtom,
  prefixAtomIds = [],
  prefixFamilyCounts = {},
  prefixBaseFeatureIds = new Set(),
  partitionPairAdmissibility = {},
  familyCaps = {},
} = {}) => {
  if (!nextAtom || typeof nextAtom !== "object") return false
  if (prefixBaseFeatureIds instanceof Set && prefixBaseFeatureIds.has(nextAtom.baseFeatureId)) return false
  const familyCap = Math.max(0, Math.floor(Number(familyCaps?.[nextAtom.familyId]) || 0))
  if (familyCap === 0) return false
  if (Number(prefixFamilyCounts?.[nextAtom.familyId] || 0) >= familyCap) return false
  for (const atomId of prefixAtomIds) {
    const allowed = Array.isArray(partitionPairAdmissibility?.[atomId]) ? partitionPairAdmissibility[atomId] : null
    if (allowed && !allowed.includes(nextAtom.atomId)) return false
  }
  return true
}

export const listTechniqueClosedPatternPartitionKeys = ({ positiveYearIndex } = {}) =>
  uniqueSortedStrings(Object.keys(positiveYearIndex?.partitions ?? {}))

export const mineTechniqueClosedPatternsForPartition = ({
  positiveYearIndex,
  partitionKey,
  coreYears = [],
  minPositiveSupportPerYear = 2,
  maxPatternSize = 6,
  maxPatterns = null,
  familyCaps = {},
  maxGeneratorsPerSignature = 8,
  includePatterns = DEFAULT_INCLUDE_PATTERNS,
} = {}) => {
  const normalized = normalizePositiveYearIndex({
    positiveYearIndex,
    coreYears,
    minPositiveSupportPerYear,
    familyCaps,
  })
  const safePartitionKey = toText(partitionKey)
  if (!safePartitionKey) {
    throw new Error("mineTechniqueClosedPatternsForPartition requires partitionKey")
  }
  const partition = normalized.positiveYearIndex?.partitions?.[safePartitionKey]
  if (!partition) {
    throw new Error(`Positive-year index is missing partition: ${safePartitionKey}`)
  }
  const safeMaxPatternSize = Math.max(1, Math.floor(Number(maxPatternSize) || 0))
  const safeMaxGeneratorsPerSignature = Math.max(1, Math.floor(Number(maxGeneratorsPerSignature) || 0))
  const numericMaxPatterns = Number(maxPatterns)
  const effectiveMaxPatterns = Number.isInteger(numericMaxPatterns) && numericMaxPatterns > 0
    ? numericMaxPatterns
    : null
  const signatureMap = new Map()
  let rawPatternCount = 0
  let exploredNodeCount = 0
  let prunedByYearCount = 0
  let prunedByPairCount = 0
  let prunedByFamilyCapCount = 0
  let prunedByBaseFeatureCount = 0
  let maxDepthReached = 0
  let hitPatternCap = false

  const eligibleAtoms = buildEligibleAtomRecords({
    partition,
    coreYears: normalized.coreYears,
    minPositiveSupportPerYear: normalized.minPositiveSupportPerYear,
  })
  const partitionAtomOrderByKey = {
    [safePartitionKey]: eligibleAtoms.map((atom) => atom.atomId),
  }
  const partitionAtomIndexById = new Map(
    eligibleAtoms.map((atom, atomIndex) => [atom.atomId, atomIndex]),
  )

  const registerPattern = ({ atomIds, yearTidsets, yearSupportVector }) => {
    rawPatternCount += 1
    const signature = buildYearTidsetSignature({ coreYears: normalized.coreYears, yearTidsets })
    const signatureKey = `${safePartitionKey}::${signature}`
    let entry = signatureMap.get(signatureKey)
    if (!entry) {
      const atomOrder = partitionAtomOrderByKey[safePartitionKey] ?? []
      entry = {
        partitionKey: safePartitionKey,
        supportSignature: signature,
        closureAtomFlags: new Uint8Array(atomOrder.length),
        yearSupportVector: yearSupportVector.slice(),
        rawPatternCount: 0,
        generators: [],
        generatorKeys: new Set(),
      }
      signatureMap.set(signatureKey, entry)
    }
    entry.rawPatternCount += 1
    for (const atomId of atomIds) {
      const atomIndex = partitionAtomIndexById.get(atomId)
      if (Number.isInteger(atomIndex) && atomIndex >= 0 && atomIndex < entry.closureAtomFlags.length) {
        entry.closureAtomFlags[atomIndex] = 1
      }
    }
    registerGeneratorForSignature({
      signatureEntry: entry,
      atomIds,
      maxGeneratorsPerSignature: safeMaxGeneratorsPerSignature,
    })
  }

  const dfs = ({
    prefixAtomIds,
    prefixYearTidsets,
    prefixFamilyCounts,
    prefixBaseFeatureIds,
    startIndex,
  }) => {
    if (effectiveMaxPatterns !== null && rawPatternCount >= effectiveMaxPatterns) {
      hitPatternCap = true
      return
    }
    if (prefixAtomIds.length > 0) {
      exploredNodeCount += 1
      maxDepthReached = Math.max(maxDepthReached, prefixAtomIds.length)
      const yearSupportVector = prefixYearTidsets.map((values) => values.length)
      registerPattern({ atomIds: prefixAtomIds, yearTidsets: prefixYearTidsets, yearSupportVector })
      if (effectiveMaxPatterns !== null && rawPatternCount >= effectiveMaxPatterns) {
        hitPatternCap = true
        return
      }
    }
    if (prefixAtomIds.length >= safeMaxPatternSize) return
    for (let cursor = startIndex; cursor < eligibleAtoms.length; cursor += 1) {
      if (hitPatternCap) return
      const atom = eligibleAtoms[cursor]
      if (prefixBaseFeatureIds.has(atom.baseFeatureId)) {
        prunedByBaseFeatureCount += 1
        continue
      }
      const familyCap = Math.max(0, Math.floor(Number(normalized.familyCaps?.[atom.familyId]) || 0))
      if (familyCap === 0 || Number(prefixFamilyCounts[atom.familyId] || 0) >= familyCap) {
        prunedByFamilyCapCount += 1
        continue
      }
      if (!canAppendTechniqueAtomToPattern({
        nextAtom: atom,
        prefixAtomIds,
        prefixFamilyCounts,
        prefixBaseFeatureIds,
        partitionPairAdmissibility: partition.pairAdmissibility ?? {},
        familyCaps: normalized.familyCaps,
      })) {
        prunedByPairCount += 1
        continue
      }
      const nextYearTidsets = prefixYearTidsets
        ? prefixYearTidsets.map((values, yearIndex) => intersectSortedIntegerArrays(values, atom.yearTidsets[yearIndex]))
        : atom.yearTidsets.map((values) => values.slice())
      const yearSupportVector = nextYearTidsets.map((values) => values.length)
      if (yearSupportVector.some((support) => support < normalized.minPositiveSupportPerYear)) {
        prunedByYearCount += 1
        continue
      }
      dfs({
        prefixAtomIds: [...prefixAtomIds, atom.atomId],
        prefixYearTidsets: nextYearTidsets,
        prefixFamilyCounts: {
          ...prefixFamilyCounts,
          [atom.familyId]: Number(prefixFamilyCounts[atom.familyId] || 0) + 1,
        },
        prefixBaseFeatureIds: new Set([...prefixBaseFeatureIds, atom.baseFeatureId]),
        startIndex: cursor + 1,
      })
    }
  }

  dfs({
    prefixAtomIds: [],
    prefixYearTidsets: null,
    prefixFamilyCounts: {},
    prefixBaseFeatureIds: new Set(),
    startIndex: 0,
  })

  const signatureEntries = Array.from(signatureMap.values())
    .sort((left, right) => {
      const leftMinYearSupport = left.yearSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
      const rightMinYearSupport = right.yearSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
      const leftTotalPositiveSupport = left.yearSupportVector.reduce((sum, value) => sum + value, 0)
      const rightTotalPositiveSupport = right.yearSupportVector.reduce((sum, value) => sum + value, 0)
      return rightMinYearSupport - leftMinYearSupport ||
        rightTotalPositiveSupport - leftTotalPositiveSupport ||
        left.partitionKey.localeCompare(right.partitionKey) ||
        left.supportSignature.localeCompare(right.supportSignature)
    })
  const closedPatternCount = signatureEntries.reduce(
    (sum, entry) => sum + (Array.isArray(entry.generators) ? entry.generators.length : 0),
    0,
  )

  const mined = {
    kind: TECHNIQUE_CLOSED_PATTERN_SET_KIND,
    contractId: toText(positiveYearIndex?.contractId) || null,
    labelId: toText(positiveYearIndex?.labelId) || null,
    coreYears: normalized.coreYears.slice(),
    minPositiveSupportPerYear: normalized.minPositiveSupportPerYear,
    maxPatternSize: safeMaxPatternSize,
    maxGeneratorsPerSignature: safeMaxGeneratorsPerSignature,
    partitionCount: 1,
    eligibleAtomCount: eligibleAtoms.length,
    exploredNodeCount,
    prunedByYearCount,
    prunedByPairCount,
    prunedByFamilyCapCount,
    prunedByBaseFeatureCount,
    rawPatternCount,
    positiveSignatureCount: signatureEntries.length,
    closedPatternCount,
    maxDepthReached,
    hitPatternCap,
    signatureEntries,
    partitionAtomOrderByKey,
  }

  if (includePatterns !== false) {
    mined.patterns = Array.from(iterateTechniqueClosedPatternRows({ mined }))
  }

  return mined
}

export const mineTechniqueClosedPatterns = ({
  positiveYearIndex,
  coreYears = [],
  minPositiveSupportPerYear = 2,
  maxPatternSize = 6,
  maxPatterns = null,
  familyCaps = {},
  maxGeneratorsPerSignature = 8,
  includePatterns = DEFAULT_INCLUDE_PATTERNS,
} = {}) => {
  const normalized = normalizePositiveYearIndex({
    positiveYearIndex,
    coreYears,
    minPositiveSupportPerYear,
    familyCaps,
  })
  const safeMaxPatternSize = Math.max(1, Math.floor(Number(maxPatternSize) || 0))
  const safeMaxGeneratorsPerSignature = Math.max(1, Math.floor(Number(maxGeneratorsPerSignature) || 0))
  const numericMaxPatterns = Number(maxPatterns)
  const effectiveMaxPatterns = Number.isInteger(numericMaxPatterns) && numericMaxPatterns > 0
    ? numericMaxPatterns
    : null
  const partitionKeys = listTechniqueClosedPatternPartitionKeys({ positiveYearIndex })
  let rawPatternCount = 0
  let exploredNodeCount = 0
  let prunedByYearCount = 0
  let prunedByPairCount = 0
  let prunedByFamilyCapCount = 0
  let prunedByBaseFeatureCount = 0
  let maxDepthReached = 0
  let hitPatternCap = false
  let eligibleAtomCount = 0
  const partitionAtomOrderByKey = {}
  const signatureEntries = []

  for (const partitionKey of partitionKeys) {
    const remainingPatternBudget = effectiveMaxPatterns !== null
      ? Math.max(0, effectiveMaxPatterns - rawPatternCount)
      : null
    if (remainingPatternBudget === 0) {
      hitPatternCap = true
      break
    }
    const partitionMined = mineTechniqueClosedPatternsForPartition({
      positiveYearIndex: normalized.positiveYearIndex,
      partitionKey,
      coreYears: normalized.coreYears,
      minPositiveSupportPerYear: normalized.minPositiveSupportPerYear,
      maxPatternSize: safeMaxPatternSize,
      maxPatterns: remainingPatternBudget,
      familyCaps: normalized.familyCaps,
      maxGeneratorsPerSignature: safeMaxGeneratorsPerSignature,
      includePatterns: false,
    })
    eligibleAtomCount += partitionMined.eligibleAtomCount
    exploredNodeCount += partitionMined.exploredNodeCount
    prunedByYearCount += partitionMined.prunedByYearCount
    prunedByPairCount += partitionMined.prunedByPairCount
    prunedByFamilyCapCount += partitionMined.prunedByFamilyCapCount
    prunedByBaseFeatureCount += partitionMined.prunedByBaseFeatureCount
    rawPatternCount += partitionMined.rawPatternCount
    maxDepthReached = Math.max(maxDepthReached, partitionMined.maxDepthReached)
    hitPatternCap = hitPatternCap || partitionMined.hitPatternCap === true
    Object.assign(partitionAtomOrderByKey, partitionMined.partitionAtomOrderByKey)
    signatureEntries.push(...partitionMined.signatureEntries)
    if (hitPatternCap) break
  }

  signatureEntries.sort((left, right) => {
    const leftMinYearSupport = left.yearSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
    const rightMinYearSupport = right.yearSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
    const leftTotalPositiveSupport = left.yearSupportVector.reduce((sum, value) => sum + value, 0)
    const rightTotalPositiveSupport = right.yearSupportVector.reduce((sum, value) => sum + value, 0)
    return rightMinYearSupport - leftMinYearSupport ||
      rightTotalPositiveSupport - leftTotalPositiveSupport ||
      left.partitionKey.localeCompare(right.partitionKey) ||
      left.supportSignature.localeCompare(right.supportSignature)
  })
  const closedPatternCount = signatureEntries.reduce(
    (sum, entry) => sum + (Array.isArray(entry.generators) ? entry.generators.length : 0),
    0,
  )

  const mined = {
    kind: TECHNIQUE_CLOSED_PATTERN_SET_KIND,
    contractId: toText(positiveYearIndex?.contractId) || null,
    labelId: toText(positiveYearIndex?.labelId) || null,
    coreYears: normalized.coreYears.slice(),
    minPositiveSupportPerYear: normalized.minPositiveSupportPerYear,
    maxPatternSize: safeMaxPatternSize,
    maxGeneratorsPerSignature: safeMaxGeneratorsPerSignature,
    partitionCount: partitionKeys.length,
    eligibleAtomCount,
    exploredNodeCount,
    prunedByYearCount,
    prunedByPairCount,
    prunedByFamilyCapCount,
    prunedByBaseFeatureCount,
    rawPatternCount,
    positiveSignatureCount: signatureEntries.length,
    closedPatternCount,
    maxDepthReached,
    hitPatternCap,
    signatureEntries,
    partitionAtomOrderByKey,
  }

  if (includePatterns !== false) {
    mined.patterns = Array.from(iterateTechniqueClosedPatternRows({ mined }))
  }

  return mined
}
