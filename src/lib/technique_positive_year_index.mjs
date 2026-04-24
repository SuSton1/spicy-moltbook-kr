import {
  toText,
  uniqueSortedIntegers,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_POSITIVE_YEAR_INDEX_KIND = "technique_positive_year_index_v2"

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

const ensureTransactionShape = (transaction) => {
  if (!transaction || typeof transaction !== "object") {
    throw new Error("Technique positive-year index requires transaction objects")
  }
  const rowId = toText(transaction.rowId)
  const decisionDateKey = toText(transaction.decisionDateKey)
  const symbol = toText(transaction.symbol)
  const scopeId = toText(transaction.scopeId)
  const lookbackCandidateId = toText(transaction.lookbackCandidateId)
  const partitionKey = toText(transaction.partitionKey)
  const yearKey = Math.floor(Number(transaction.yearKey))
  if (!rowId || !decisionDateKey || !symbol || !scopeId || !lookbackCandidateId || !partitionKey || !Number.isInteger(yearKey)) {
    throw new Error("Technique positive-year index transaction is missing rowId/decisionDateKey/symbol/scopeId/lookbackCandidateId/partitionKey/yearKey")
  }
  return {
    ...transaction,
    rowId,
    decisionDateKey,
    symbol,
    scopeId,
    lookbackCandidateId,
    partitionKey,
    yearKey,
    hitTarget: transaction.hitTarget === true || Number(transaction.hitTarget) > 0,
    atomIds: uniqueSortedStrings(transaction.atomIds),
    atomMetadataById: transaction.atomMetadataById && typeof transaction.atomMetadataById === "object" ? transaction.atomMetadataById : {},
  }
}

const createPartitionState = (coreYears) => ({
  nextPositiveTid: 0,
  yearPositiveCounts: Object.fromEntries(coreYears.map((yearKey) => [String(yearKey), 0])),
  atomYearTidsets: new Map(),
  atomMetadataById: {},
  positiveRowManifest: [],
})

export const createTechniquePositiveYearIndexState = ({ coreYears = [], minPositiveSupportPerYear = 2, enablePairAdmissibility = true } = {}) => {
  const safeCoreYears = uniqueSortedIntegers(coreYears)
  if (safeCoreYears.length < 1) throw new Error("createTechniquePositiveYearIndexState requires coreYears")
  return {
    coreYears: safeCoreYears,
    coreYearSet: new Set(safeCoreYears),
    minPositiveSupportPerYear: Math.max(1, Math.floor(Number(minPositiveSupportPerYear) || 0)),
    enablePairAdmissibility: enablePairAdmissibility === true,
    positiveTransactionCount: 0,
    partitions: new Map(),
    positiveRowManifest: [],
  }
}

const getPartitionState = (state, partitionKey) => {
  let partitionState = state.partitions.get(partitionKey)
  if (!partitionState) {
    partitionState = createPartitionState(state.coreYears)
    state.partitions.set(partitionKey, partitionState)
  }
  return partitionState
}

export const appendTechniquePositiveTransactionToIndexState = (state, transaction) => {
  const safeState = state
  if (!safeState || !(safeState.coreYearSet instanceof Set)) {
    throw new Error("appendTechniquePositiveTransactionToIndexState requires an initialized state")
  }
  const safeTransaction = ensureTransactionShape(transaction)
  if (!safeTransaction.hitTarget) return false
  if (!safeState.coreYearSet.has(safeTransaction.yearKey)) return false

  const partitionState = getPartitionState(safeState, safeTransaction.partitionKey)
  const yearKeyText = String(safeTransaction.yearKey)
  const positiveTid = partitionState.nextPositiveTid
  partitionState.nextPositiveTid += 1
  safeState.positiveTransactionCount += 1
  partitionState.yearPositiveCounts[yearKeyText] += 1
  const manifestRow = {
    partitionKey: safeTransaction.partitionKey,
    positiveTid,
    rowId: safeTransaction.rowId,
    decisionDateKey: safeTransaction.decisionDateKey,
    yearKey: safeTransaction.yearKey,
    symbol: safeTransaction.symbol,
    scopeId: safeTransaction.scopeId,
    lookbackCandidateId: safeTransaction.lookbackCandidateId,
    atomCount: safeTransaction.atomIds.length,
  }
  partitionState.positiveRowManifest.push(manifestRow)
  safeState.positiveRowManifest.push(manifestRow)
  for (const atomId of safeTransaction.atomIds) {
    let byYear = partitionState.atomYearTidsets.get(atomId)
    if (!byYear) {
      byYear = new Map()
      partitionState.atomYearTidsets.set(atomId, byYear)
    }
    let tidset = byYear.get(yearKeyText)
    if (!tidset) {
      tidset = []
      byYear.set(yearKeyText, tidset)
    }
    tidset.push(positiveTid)
    const metadata = safeTransaction.atomMetadataById?.[atomId]
    if (metadata && !partitionState.atomMetadataById[atomId]) {
      partitionState.atomMetadataById[atomId] = {
        familyId: toText(metadata.familyId) || "unknown",
        baseFeatureId: toText(metadata.baseFeatureId) || atomId,
      }
    }
  }
  return true
}

const buildPairAdmissibility = ({ partitionAtomYearTidsets, coreYears, minPositiveSupportPerYear, enabled }) => {
  const atomIds = uniqueSortedStrings(Object.keys(partitionAtomYearTidsets))
  if (!enabled) {
    return Object.fromEntries(atomIds.map((atomId) => [atomId, atomIds.filter((candidate) => candidate !== atomId)]))
  }
  const out = Object.fromEntries(atomIds.map((atomId) => [atomId, []]))
  for (let leftIndex = 0; leftIndex < atomIds.length; leftIndex += 1) {
    const leftAtomId = atomIds[leftIndex]
    const leftByYear = partitionAtomYearTidsets[leftAtomId]
    for (let rightIndex = leftIndex + 1; rightIndex < atomIds.length; rightIndex += 1) {
      const rightAtomId = atomIds[rightIndex]
      const rightByYear = partitionAtomYearTidsets[rightAtomId]
      const admissible = coreYears.every((yearKey) => {
        const intersection = intersectSortedIntegerArrays(
          ensureSortedIntegerArray(leftByYear?.[String(yearKey)]),
          ensureSortedIntegerArray(rightByYear?.[String(yearKey)]),
        )
        return intersection.length >= minPositiveSupportPerYear
      })
      if (!admissible) continue
      out[leftAtomId].push(rightAtomId)
      out[rightAtomId].push(leftAtomId)
    }
  }
  for (const atomId of atomIds) out[atomId] = uniqueSortedStrings(out[atomId])
  return out
}

export const finalizeTechniquePositiveYearIndexState = (state, { contractId = null, labelId = null } = {}) => {
  const safeState = state
  if (!safeState || !(safeState.coreYearSet instanceof Set)) {
    throw new Error("finalizeTechniquePositiveYearIndexState requires an initialized state")
  }
  const partitions = {}
  for (const [partitionKey, partitionState] of safeState.partitions.entries()) {
    const atomYearTidsets = {}
    for (const [atomId, byYear] of partitionState.atomYearTidsets.entries()) {
      atomYearTidsets[atomId] = Object.fromEntries(
        safeState.coreYears.map((yearKey) => [String(yearKey), ensureSortedIntegerArray(byYear.get(String(yearKey)))]),
      )
    }
    partitions[partitionKey] = {
      positiveTransactionCount: partitionState.nextPositiveTid,
      yearPositiveCounts: { ...partitionState.yearPositiveCounts },
      atomCount: Object.keys(atomYearTidsets).length,
      atomMetadataById: partitionState.atomMetadataById,
      atomYearTidsets,
      pairAdmissibility: buildPairAdmissibility({
        partitionAtomYearTidsets: atomYearTidsets,
        coreYears: safeState.coreYears,
        minPositiveSupportPerYear: safeState.minPositiveSupportPerYear,
        enabled: safeState.enablePairAdmissibility,
      }),
    }
  }
  return {
    indexArtifact: {
      kind: TECHNIQUE_POSITIVE_YEAR_INDEX_KIND,
      contractId: toText(contractId) || null,
      labelId: toText(labelId) || null,
      coreYears: safeState.coreYears.slice(),
      minPositiveSupportPerYear: safeState.minPositiveSupportPerYear,
      positiveTransactionCount: safeState.positiveTransactionCount,
      partitionCount: Object.keys(partitions).length,
      partitionKeys: uniqueSortedStrings(Object.keys(partitions)),
      partitions,
    },
    positiveRowManifest: safeState.positiveRowManifest.slice(),
  }
}

export const buildTechniquePositiveYearIndex = ({
  transactions = [],
  coreYears = [],
  contractId = null,
  labelId = null,
  minPositiveSupportPerYear = 2,
  enablePairAdmissibility = true,
} = {}) => {
  const state = createTechniquePositiveYearIndexState({ coreYears, minPositiveSupportPerYear, enablePairAdmissibility })
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    appendTechniquePositiveTransactionToIndexState(state, transaction)
  }
  return finalizeTechniquePositiveYearIndexState(state, { contractId, labelId })
}
