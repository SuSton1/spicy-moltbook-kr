import {
  toText,
  uniqueSortedIntegers,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_ZERO_NEGATIVE_REPORT_KIND = "technique_zero_negative_report_v1"

const createPartitionState = () => ({
  nextTransactionId: 0,
  atomTransactionIds: new Map(),
  transactionAtomIds: [],
  decisionDateKeys: [],
  symbols: [],
  yearKeys: [],
  hitTargets: [],
})

const ensureTransactionRow = (transaction) => {
  if (!transaction || typeof transaction !== "object") {
    throw new Error("Technique zero-negative verifier requires transaction objects")
  }
  const rowId = toText(transaction.rowId)
  const decisionDateKey = toText(transaction.decisionDateKey)
  const symbol = toText(transaction.symbol)
  const partitionKey = toText(transaction.partitionKey)
  const yearKey = Math.floor(Number(transaction.yearKey))
  if (!rowId || !decisionDateKey || !symbol || !partitionKey || !Number.isInteger(yearKey)) {
    throw new Error("Technique zero-negative verifier transaction is missing rowId/decisionDateKey/symbol/partitionKey/yearKey")
  }
  return {
    rowId,
    decisionDateKey,
    symbol,
    partitionKey,
    yearKey,
    hitTarget: transaction.hitTarget === true || Number(transaction.hitTarget) > 0,
    atomIds: uniqueSortedStrings(transaction.atomIds),
  }
}

const ensurePatternRow = (pattern) => {
  if (!pattern || typeof pattern !== "object") {
    throw new Error("Technique zero-negative verifier requires pattern objects")
  }
  const patternId = toText(pattern.patternId)
  const partitionKey = toText(pattern.partitionKey)
  const atomIds = uniqueSortedStrings(pattern.generatorAtomIds ?? pattern.atomIds)
  const vetoAtomIds = uniqueSortedStrings(pattern.vetoAtomIds)
  if (!patternId || !partitionKey || atomIds.length < 1) {
    throw new Error("Technique zero-negative verifier pattern is missing patternId/partitionKey/atomIds")
  }
  return {
    ...pattern,
    patternId,
    partitionKey,
    atomIds,
    generatorAtomIds: atomIds,
    vetoAtomIds,
  }
}

export const createTechniqueTransactionAtomIndexState = () => ({
  partitions: new Map(),
  transactionCount: 0,
})

const getPartitionState = (state, partitionKey) => {
  let partitionState = state.partitions.get(partitionKey)
  if (!partitionState) {
    partitionState = createPartitionState()
    state.partitions.set(partitionKey, partitionState)
  }
  return partitionState
}

export const appendTechniqueTransactionToAtomIndexState = (state, transaction) => {
  if (!state || !(state.partitions instanceof Map)) {
    throw new Error("appendTechniqueTransactionToAtomIndexState requires an initialized state")
  }
  const safeTransaction = ensureTransactionRow(transaction)
  const partitionState = getPartitionState(state, safeTransaction.partitionKey)
  const transactionId = partitionState.nextTransactionId
  partitionState.nextTransactionId += 1
  state.transactionCount += 1
  partitionState.decisionDateKeys.push(safeTransaction.decisionDateKey)
  partitionState.symbols.push(safeTransaction.symbol)
  partitionState.yearKeys.push(safeTransaction.yearKey)
  partitionState.hitTargets.push(safeTransaction.hitTarget === true)
  partitionState.transactionAtomIds.push(safeTransaction.atomIds.slice())
  for (const atomId of safeTransaction.atomIds) {
    let ids = partitionState.atomTransactionIds.get(atomId)
    if (!ids) {
      ids = []
      partitionState.atomTransactionIds.set(atomId, ids)
    }
    ids.push(transactionId)
  }
  return true
}

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

const buildTransactionAtomIndex = (transactions = []) => {
  const state = createTechniqueTransactionAtomIndexState()
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    appendTechniqueTransactionToAtomIndexState(state, transaction)
  }
  return state
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

const buildExcludedTransactionIdSet = ({ partition, vetoAtomIds = [] } = {}) => {
  const excludedIds = new Set()
  for (const vetoAtomId of uniqueSortedStrings(vetoAtomIds)) {
    const tids = partition?.atomTransactionIds?.get(vetoAtomId)
    if (!Array.isArray(tids)) continue
    for (const transactionId of tids) excludedIds.add(transactionId)
  }
  return excludedIds
}

export const verifyTechniquePatternsAgainstTrainNegatives = ({
  patterns = [],
  transactions = [],
  coreYears = [],
  minPositiveSupportPerYear = 2,
  requireZeroNegative = true,
} = {}) => {
  const safeCoreYears = uniqueSortedIntegers(coreYears)
  if (safeCoreYears.length < 1) {
    throw new Error("verifyTechniquePatternsAgainstTrainNegatives requires coreYears")
  }
  const coreYearSet = new Set(safeCoreYears)
  const safeMinPositiveSupportPerYear = Math.max(1, Math.floor(Number(minPositiveSupportPerYear) || 0))
  const safePatterns = (Array.isArray(patterns) ? patterns : []).map(ensurePatternRow)
  const transactionIndex = buildTransactionAtomIndex(transactions)
  const verifiedPatterns = []
  const evaluatedPatterns = []
  for (const pattern of safePatterns) {
    const enrichedPattern = evaluateTechniquePatternAgainstTransactionIndex({
      pattern,
      transactionIndex,
      coreYears: safeCoreYears,
      minPositiveSupportPerYear: safeMinPositiveSupportPerYear,
      requireZeroNegative,
      coreYearSet,
    })
    if (!enrichedPattern) continue
    evaluatedPatterns.push(enrichedPattern)
    if (enrichedPattern.pass) verifiedPatterns.push(enrichedPattern)
  }
  return {
    kind: TECHNIQUE_ZERO_NEGATIVE_REPORT_KIND,
    coreYears: safeCoreYears,
    minPositiveSupportPerYear: safeMinPositiveSupportPerYear,
    evaluatedPatternCount: evaluatedPatterns.length,
    verifiedPatternCount: verifiedPatterns.length,
    requireZeroNegative,
    evaluatedPatterns,
    verifiedPatterns,
  }
}

export const evaluateTechniquePatternAgainstTransactionIndex = ({
  pattern,
  transactionIndex,
  coreYears = [],
  minPositiveSupportPerYear = 2,
  requireZeroNegative = true,
  coreYearSet = null,
} = {}) => {
  const safePattern = ensurePatternRow(pattern)
  if (!transactionIndex || !(transactionIndex.partitions instanceof Map)) {
    throw new Error("evaluateTechniquePatternAgainstTransactionIndex requires a transaction index")
  }
  const safeCoreYears = uniqueSortedIntegers(coreYears)
  if (safeCoreYears.length < 1) {
    throw new Error("evaluateTechniquePatternAgainstTransactionIndex requires coreYears")
  }
  const effectiveCoreYearSet = coreYearSet instanceof Set ? coreYearSet : new Set(safeCoreYears)
  const safeMinPositiveSupportPerYear = Math.max(1, Math.floor(Number(minPositiveSupportPerYear) || 0))
  const partition = transactionIndex.partitions.get(safePattern.partitionKey)
  if (!partition) return null
  const matchedTransactionIds = collectMatchedTransactionIds({
    patternAtomIds: safePattern.atomIds,
    atomTransactionIds: partition.atomTransactionIds,
  })
  const excludedTransactionIds = buildExcludedTransactionIdSet({
    partition,
    vetoAtomIds: safePattern.vetoAtomIds,
  })
  const yearPositiveCounts = Object.fromEntries(safeCoreYears.map((yearKey) => [String(yearKey), 0]))
  const positiveDateCounts = new Map()
  const positiveSymbolCounts = new Map()
  let negativeCount = 0
  for (const transactionId of matchedTransactionIds) {
    if (excludedTransactionIds.has(transactionId)) continue
    if (partition.hitTargets[transactionId] !== true) {
      negativeCount += 1
      continue
    }
    const yearKey = partition.yearKeys[transactionId]
    if (!effectiveCoreYearSet.has(yearKey)) continue
    yearPositiveCounts[String(yearKey)] += 1
    const decisionDateKey = partition.decisionDateKeys[transactionId]
    const symbol = partition.symbols[transactionId]
    positiveDateCounts.set(decisionDateKey, (positiveDateCounts.get(decisionDateKey) ?? 0) + 1)
    positiveSymbolCounts.set(symbol, (positiveSymbolCounts.get(symbol) ?? 0) + 1)
  }
  const yearPositiveSupportVector = safeCoreYears.map((yearKey) => yearPositiveCounts[String(yearKey)] ?? 0)
  const totalPositiveSupport = yearPositiveSupportVector.reduce((sum, value) => sum + value, 0)
  const minYearPositiveSupport = yearPositiveSupportVector.reduce((best, value) => Math.min(best, value), Infinity)
  const maxYearPositiveSupport = yearPositiveSupportVector.reduce((best, value) => Math.max(best, value), 0)
  const maxYearShare = totalPositiveSupport > 0 ? maxYearPositiveSupport / totalPositiveSupport : 0
  const topDateCount = Math.max(0, ...positiveDateCounts.values())
  const topSymbolCount = Math.max(0, ...positiveSymbolCounts.values())
  const passesYearFloor = yearPositiveSupportVector.every((support) => support >= safeMinPositiveSupportPerYear)
  const passesNegativeGate = requireZeroNegative ? negativeCount === 0 : true
  return {
    ...safePattern,
    kind: "technique_zero_negative_verified_pattern_v1",
    coreYears: safeCoreYears.slice(),
    partitionKey: safePattern.partitionKey,
    generatorAtomIds: safePattern.generatorAtomIds,
    vetoAtomIds: safePattern.vetoAtomIds,
    matchedTransactionCount: matchedTransactionIds.length,
    yearPositiveCounts,
    yearPositiveSupportVector,
    totalPositiveSupport,
    minYearPositiveSupport: Number.isFinite(minYearPositiveSupport) ? minYearPositiveSupport : 0,
    maxYearPositiveSupport,
    negativeCount,
    zeroNegativeVerified: negativeCount === 0,
    uniqueMatchedDateCount: positiveDateCounts.size,
    uniqueMatchedSymbolCount: positiveSymbolCounts.size,
    top1DateShare: totalPositiveSupport > 0 ? topDateCount / totalPositiveSupport : 0,
    top1SymbolShare: totalPositiveSupport > 0 ? topSymbolCount / totalPositiveSupport : 0,
    maxYearShare,
    pass: passesYearFloor && passesNegativeGate,
  }
}
