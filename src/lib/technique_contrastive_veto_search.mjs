import {
  toText,
  uniqueSortedIntegers,
  uniqueSortedStrings,
} from "./technique_common.mjs"
import {
  appendTechniqueTransactionToAtomIndexState,
  createTechniqueTransactionAtomIndexState,
  evaluateTechniquePatternAgainstTransactionIndex,
} from "./technique_zero_negative_verifier.mjs"

export const TECHNIQUE_CONTRASTIVE_VETO_REPORT_KIND = "technique_contrastive_veto_report_v1"

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

export const normalizeTechniqueContrastiveCorePattern = (pattern) => {
  if (!pattern || typeof pattern !== "object") {
    throw new Error("Technique contrastive veto search requires pattern objects")
  }
  const patternId = toText(pattern.patternId)
  const partitionKey = toText(pattern.partitionKey)
  const generatorAtomIds = uniqueSortedStrings(pattern.seedGeneratorAtomIds ?? pattern.generatorAtomIds ?? pattern.atomIds)
  const closureAtomIds = uniqueSortedStrings(pattern.closureAtomIds)
  if (!patternId || !partitionKey || generatorAtomIds.length < 1) {
    throw new Error("Technique contrastive veto pattern is missing patternId/partitionKey/generatorAtomIds")
  }
  return {
    ...pattern,
    patternId,
    partitionKey,
    seedGeneratorAtomIds: generatorAtomIds,
    generatorAtomIds,
    closureAtomIds,
    preverifiedNegativeCount: Math.max(0, Number(pattern.preverifiedNegativeCount) || 0),
    minYearSupport: Math.max(0, Number(pattern.minYearSupport) || 0),
    totalPositiveSupport: Math.max(0, Number(pattern.totalPositiveSupport) || 0),
  }
}

const buildTransactionIndex = (transactions = []) => {
  const state = createTechniqueTransactionAtomIndexState()
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    appendTechniqueTransactionToAtomIndexState(state, transaction)
  }
  return state
}

export const createTechniqueContrastiveVetoRuntime = ({
  transactions = [],
  coreYears = [],
  minPositiveSupportPerYear = 2,
  maxVetoAtomCount = 2,
} = {}) => {
  const safeCoreYears = uniqueSortedIntegers(coreYears)
  if (safeCoreYears.length < 1) {
    throw new Error("Technique contrastive veto runtime requires coreYears")
  }
  return {
    transactionIndex: buildTransactionIndex(transactions),
    coreYears: safeCoreYears,
    coreYearSet: new Set(safeCoreYears),
    minPositiveSupportPerYear: Math.max(1, Math.floor(Number(minPositiveSupportPerYear) || 0)),
    maxVetoAtomCount: Math.max(1, Math.floor(Number(maxVetoAtomCount) || 0)),
  }
}

const collectMatchedTransactionIds = ({ patternAtomIds, atomTransactionIds }) => {
  let matchedIds = null
  for (const atomId of patternAtomIds) {
    const atomIds = atomTransactionIds.get(atomId)
    if (!atomIds || atomIds.length < 1) return []
    matchedIds = matchedIds === null ? atomIds.slice() : intersectSortedIntegerArrays(matchedIds, atomIds)
    if (matchedIds.length < 1) return []
  }
  return matchedIds ?? []
}

const unionCount = (...sets) => {
  const out = new Set()
  for (const set of sets) {
    if (!(set instanceof Set)) continue
    for (const value of set) out.add(value)
  }
  return out.size
}

export const rankTechniqueContrastiveCorePatterns = (left, right) =>
  left.preverifiedNegativeCount - right.preverifiedNegativeCount ||
  right.minYearSupport - left.minYearSupport ||
  left.totalPositiveSupport - right.totalPositiveSupport ||
  left.patternId.localeCompare(right.patternId)

const rankVetoAtoms = (left, right) =>
  right.negRemoved - left.negRemoved ||
  left.totalPositiveExcluded - right.totalPositiveExcluded ||
  left.maxYearExcluded - right.maxYearExcluded ||
  left.atomId.localeCompare(right.atomId)

const buildCoverageStatsForPattern = ({ partition, corePattern, coreYears, coreYearSet }) => {
  const matchedTransactionIds = collectMatchedTransactionIds({
    patternAtomIds: corePattern.generatorAtomIds,
    atomTransactionIds: partition.atomTransactionIds,
  })
  const positiveIdsByYear = new Map(coreYears.map((yearKey) => [yearKey, []]))
  const negativeIds = []
  for (const transactionId of matchedTransactionIds) {
    if (partition.hitTargets[transactionId] === true) {
      const yearKey = partition.yearKeys[transactionId]
      if (coreYearSet.has(yearKey)) {
        positiveIdsByYear.get(yearKey)?.push(transactionId)
      }
      continue
    }
    negativeIds.push(transactionId)
  }
  return {
    matchedTransactionIds,
    positiveIdsByYear,
    negativeIds,
  }
}

const buildVetoCandidateStats = ({ partition, corePattern, coverage, coreYears }) => {
  const coreAtomIdSet = new Set(corePattern.generatorAtomIds)
  const candidateStats = new Map()

  const touchCandidate = (atomId) => {
    if (!atomId || coreAtomIdSet.has(atomId)) return null
    let row = candidateStats.get(atomId)
    if (!row) {
      row = {
        atomId,
        negativeIds: new Set(),
        positiveIdsByYear: new Map(coreYears.map((yearKey) => [yearKey, new Set()])),
      }
      candidateStats.set(atomId, row)
    }
    return row
  }

  for (const transactionId of coverage.negativeIds) {
    for (const atomId of partition.transactionAtomIds[transactionId] ?? []) {
      const row = touchCandidate(atomId)
      if (!row) continue
      row.negativeIds.add(transactionId)
    }
  }

  for (const yearKey of coreYears) {
    for (const transactionId of coverage.positiveIdsByYear.get(yearKey) ?? []) {
      for (const atomId of partition.transactionAtomIds[transactionId] ?? []) {
        const row = touchCandidate(atomId)
        if (!row) continue
        row.positiveIdsByYear.get(yearKey)?.add(transactionId)
      }
    }
  }

  return Array.from(candidateStats.values()).map((row) => {
    const positiveExcludedByYear = Object.fromEntries(
      coreYears.map((yearKey) => [String(yearKey), row.positiveIdsByYear.get(yearKey)?.size ?? 0]),
    )
    return {
      atomId: row.atomId,
      negativeIds: row.negativeIds,
      positiveIdsByYear: row.positiveIdsByYear,
      negRemoved: row.negativeIds.size,
      totalPositiveExcluded: coreYears.reduce((sum, yearKey) => sum + (row.positiveIdsByYear.get(yearKey)?.size ?? 0), 0),
      maxYearExcluded: Math.max(0, ...coreYears.map((yearKey) => row.positiveIdsByYear.get(yearKey)?.size ?? 0)),
      positiveExcludedByYear,
    }
  }).sort(rankVetoAtoms)
}

const evaluateVetoCandidate = ({ corePattern, coreYears, coverage, vetoStats = [], minPositiveSupportPerYear, transactionIndex }) => {
  const vetoAtomIds = uniqueSortedStrings(vetoStats.map((row) => row.atomId))
  const yearPositiveCounts = {}
  for (const yearKey of coreYears) {
    const total = coverage.positiveIdsByYear.get(yearKey)?.length ?? 0
    const excluded = unionCount(...vetoStats.map((row) => row.positiveIdsByYear.get(yearKey)))
    yearPositiveCounts[String(yearKey)] = total - excluded
  }
  const yearPositiveSupportVector = coreYears.map((yearKey) => yearPositiveCounts[String(yearKey)] ?? 0)
  if (yearPositiveSupportVector.some((value) => value < minPositiveSupportPerYear)) {
    return null
  }
  const remainingNegativeCount = coverage.negativeIds.length - unionCount(...vetoStats.map((row) => row.negativeIds))
  if (remainingNegativeCount !== 0) return null
  return evaluateTechniquePatternAgainstTransactionIndex({
    pattern: {
      ...corePattern,
      patternId: `${corePattern.patternId}__veto_${vetoAtomIds.join("__") || "none"}`,
      vetoAtomIds,
    },
    transactionIndex,
    coreYears,
    minPositiveSupportPerYear,
    requireZeroNegative: true,
  })
}

const searchBestVetoCandidate = ({ corePattern, partition, coreYears, coreYearSet, minPositiveSupportPerYear, maxVetoAtomCount, transactionIndex }) => {
  const coverage = buildCoverageStatsForPattern({
    partition,
    corePattern,
    coreYears,
    coreYearSet,
  })
  if (coverage.negativeIds.length === 0) {
    return evaluateTechniquePatternAgainstTransactionIndex({
      pattern: {
        ...corePattern,
        vetoAtomIds: [],
      },
      transactionIndex,
      coreYears,
      minPositiveSupportPerYear,
      requireZeroNegative: true,
    })
  }

  const candidateStats = buildVetoCandidateStats({
    partition,
    corePattern,
    coverage,
    coreYears,
  })
  if (candidateStats.length < 1) return null

  for (const atom of candidateStats) {
    const single = evaluateVetoCandidate({
      corePattern,
      coreYears,
      coverage,
      vetoStats: [atom],
      minPositiveSupportPerYear,
      transactionIndex,
    })
    if (single?.pass) {
      return {
        ...single,
        contrastiveSearchStrategy: "single_veto",
        corePatternId: corePattern.patternId,
        coreNegativeCount: coverage.negativeIds.length,
      }
    }
  }

  if (Math.max(1, Number(maxVetoAtomCount) || 0) < 2) return null

  const shortlist = candidateStats.slice(0, 24)
  for (let leftIndex = 0; leftIndex < shortlist.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < shortlist.length; rightIndex += 1) {
      const pair = evaluateVetoCandidate({
        corePattern,
        coreYears,
        coverage,
        vetoStats: [shortlist[leftIndex], shortlist[rightIndex]],
        minPositiveSupportPerYear,
        transactionIndex,
      })
      if (pair?.pass) {
        return {
          ...pair,
          contrastiveSearchStrategy: "pair_veto",
          corePatternId: corePattern.patternId,
          coreNegativeCount: coverage.negativeIds.length,
        }
      }
    }
  }
  return null
}

export const searchTechniqueContrastiveVetoForPartition = ({
  patterns = [],
  runtime,
  topPatternsPerPartition = 64,
  maxVetoAtomCount = null,
} = {}) => {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("searchTechniqueContrastiveVetoForPartition requires runtime")
  }
  const safePatterns = (Array.isArray(patterns) ? patterns : []).map(normalizeTechniqueContrastiveCorePattern)
  if (safePatterns.length < 1) {
    return {
      evaluatedCorePatternCount: 0,
      contrastiveCandidateCount: 0,
      vetoPatterns: [],
    }
  }

  const safeTopPatternsPerPartition = Math.max(1, Math.floor(Number(topPatternsPerPartition) || 0))
  const safeMaxVetoAtomCount = Math.max(1, Math.floor(Number(maxVetoAtomCount ?? runtime.maxVetoAtomCount) || 0))
  const shortlistedRows = safePatterns.slice().sort(rankTechniqueContrastiveCorePatterns).slice(0, safeTopPatternsPerPartition)
  const partitionKey = shortlistedRows[0]?.partitionKey ?? ""
  const partition = runtime.transactionIndex.partitions.get(partitionKey)
  if (!partition) {
    return {
      evaluatedCorePatternCount: 0,
      contrastiveCandidateCount: 0,
      vetoPatterns: [],
    }
  }

  const vetoPatterns = []
  for (const corePattern of shortlistedRows) {
    const vetoCandidate = searchBestVetoCandidate({
      corePattern,
      partition,
      coreYears: runtime.coreYears,
      coreYearSet: runtime.coreYearSet,
      minPositiveSupportPerYear: runtime.minPositiveSupportPerYear,
      maxVetoAtomCount: safeMaxVetoAtomCount,
      transactionIndex: runtime.transactionIndex,
    })
    if (!vetoCandidate?.pass) continue
    vetoPatterns.push(vetoCandidate)
  }

  vetoPatterns.sort((left, right) =>
    left.vetoAtomIds.length - right.vetoAtomIds.length ||
    left.negativeCount - right.negativeCount ||
    right.minYearPositiveSupport - left.minYearPositiveSupport ||
    left.patternId.localeCompare(right.patternId),
  )

  return {
    evaluatedCorePatternCount: shortlistedRows.length,
    contrastiveCandidateCount: vetoPatterns.length,
    vetoPatterns,
  }
}

export const searchTechniqueContrastiveVetoCandidates = ({
  patterns = [],
  transactions = [],
  coreYears = [],
  minPositiveSupportPerYear = 2,
  topPatternsPerPartition = 64,
  maxVetoAtomCount = 2,
} = {}) => {
  const runtime = createTechniqueContrastiveVetoRuntime({
    transactions,
    coreYears,
    minPositiveSupportPerYear,
    maxVetoAtomCount,
  })
  const safePatterns = (Array.isArray(patterns) ? patterns : []).map(normalizeTechniqueContrastiveCorePattern)
  const byPartition = new Map()
  for (const pattern of safePatterns) {
    let rows = byPartition.get(pattern.partitionKey)
    if (!rows) {
      rows = []
      byPartition.set(pattern.partitionKey, rows)
    }
    rows.push(pattern)
  }

  let evaluatedCorePatternCount = 0
  const vetoPatterns = []
  for (const rows of byPartition.values()) {
    const report = searchTechniqueContrastiveVetoForPartition({
      patterns: rows,
      runtime,
      topPatternsPerPartition,
      maxVetoAtomCount,
    })
    evaluatedCorePatternCount += report.evaluatedCorePatternCount
    vetoPatterns.push(...report.vetoPatterns)
  }

  vetoPatterns.sort((left, right) =>
    left.vetoAtomIds.length - right.vetoAtomIds.length ||
    left.negativeCount - right.negativeCount ||
    right.minYearPositiveSupport - left.minYearPositiveSupport ||
    left.patternId.localeCompare(right.patternId),
  )

  return {
    kind: TECHNIQUE_CONTRASTIVE_VETO_REPORT_KIND,
    coreYears: runtime.coreYears,
    minPositiveSupportPerYear: runtime.minPositiveSupportPerYear,
    evaluatedCorePatternCount,
    partitionCount: byPartition.size,
    topPatternsPerPartition: Math.max(1, Math.floor(Number(topPatternsPerPartition) || 0)),
    maxVetoAtomCount: Math.max(1, Math.floor(Number(maxVetoAtomCount) || 0)),
    contrastiveCandidateCount: vetoPatterns.length,
    vetoPatterns,
  }
}
