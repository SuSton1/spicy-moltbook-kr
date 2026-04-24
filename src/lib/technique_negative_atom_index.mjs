import {
  toText,
  uniqueSortedStrings,
} from "./technique_common.mjs"

export const TECHNIQUE_NEGATIVE_ATOM_INDEX_KIND = "technique_negative_atom_index_v1"

const ensureTransactionShape = (transaction) => {
  if (!transaction || typeof transaction !== "object") {
    throw new Error("Technique negative-atom index requires transaction objects")
  }
  const rowId = toText(transaction.rowId)
  const decisionDateKey = toText(transaction.decisionDateKey)
  const symbol = toText(transaction.symbol)
  const scopeId = toText(transaction.scopeId)
  const lookbackCandidateId = toText(transaction.lookbackCandidateId)
  const partitionKey = toText(transaction.partitionKey)
  if (!rowId || !decisionDateKey || !symbol || !scopeId || !lookbackCandidateId || !partitionKey) {
    throw new Error("Technique negative-atom index transaction is missing rowId/decisionDateKey/symbol/scopeId/lookbackCandidateId/partitionKey")
  }
  return {
    ...transaction,
    rowId,
    decisionDateKey,
    symbol,
    scopeId,
    lookbackCandidateId,
    partitionKey,
    hitTarget: transaction.hitTarget === true || Number(transaction.hitTarget) > 0,
    atomIds: uniqueSortedStrings(transaction.atomIds),
  }
}

const createPartitionState = () => ({
  nextNegativeTid: 0,
  atomNegativeTidsets: new Map(),
  negativeRowManifest: [],
})

export const createTechniqueNegativeAtomIndexState = () => ({
  negativeTransactionCount: 0,
  partitions: new Map(),
  negativeRowManifest: [],
})

const getPartitionState = (state, partitionKey) => {
  let partitionState = state.partitions.get(partitionKey)
  if (!partitionState) {
    partitionState = createPartitionState()
    state.partitions.set(partitionKey, partitionState)
  }
  return partitionState
}

export const appendTechniqueNegativeTransactionToIndexState = (state, transaction) => {
  if (!state || !(state.partitions instanceof Map)) {
    throw new Error("appendTechniqueNegativeTransactionToIndexState requires an initialized state")
  }
  const safeTransaction = ensureTransactionShape(transaction)
  if (safeTransaction.hitTarget) return false
  const partitionState = getPartitionState(state, safeTransaction.partitionKey)
  const negativeTid = partitionState.nextNegativeTid
  partitionState.nextNegativeTid += 1
  state.negativeTransactionCount += 1
  const manifestRow = {
    partitionKey: safeTransaction.partitionKey,
    negativeTid,
    rowId: safeTransaction.rowId,
    decisionDateKey: safeTransaction.decisionDateKey,
    symbol: safeTransaction.symbol,
    scopeId: safeTransaction.scopeId,
    lookbackCandidateId: safeTransaction.lookbackCandidateId,
    atomCount: safeTransaction.atomIds.length,
  }
  partitionState.negativeRowManifest.push(manifestRow)
  state.negativeRowManifest.push(manifestRow)
  for (const atomId of safeTransaction.atomIds) {
    let tidset = partitionState.atomNegativeTidsets.get(atomId)
    if (!tidset) {
      tidset = []
      partitionState.atomNegativeTidsets.set(atomId, tidset)
    }
    tidset.push(negativeTid)
  }
  return true
}

export const finalizeTechniqueNegativeAtomIndexState = (state, { contractId = null, labelId = null } = {}) => {
  if (!state || !(state.partitions instanceof Map)) {
    throw new Error("finalizeTechniqueNegativeAtomIndexState requires an initialized state")
  }
  const partitions = {}
  for (const [partitionKey, partitionState] of state.partitions.entries()) {
    const atomNegativeTidsets = Object.fromEntries(
      Array.from(partitionState.atomNegativeTidsets.entries())
        .map(([atomId, tidset]) => [atomId, tidset.slice().sort((left, right) => left - right)]),
    )
    partitions[partitionKey] = {
      negativeTransactionCount: partitionState.nextNegativeTid,
      atomCount: Object.keys(atomNegativeTidsets).length,
      atomNegativeTidsets,
      atomNegativeCounts: Object.fromEntries(
        Object.entries(atomNegativeTidsets).map(([atomId, tidset]) => [atomId, tidset.length]),
      ),
    }
  }
  return {
    indexArtifact: {
      kind: TECHNIQUE_NEGATIVE_ATOM_INDEX_KIND,
      contractId: toText(contractId) || null,
      labelId: toText(labelId) || null,
      negativeTransactionCount: state.negativeTransactionCount,
      partitionCount: Object.keys(partitions).length,
      partitionKeys: uniqueSortedStrings(Object.keys(partitions)),
      partitions,
    },
    negativeRowManifest: state.negativeRowManifest.slice(),
  }
}

export const buildTechniqueNegativeAtomIndex = ({
  transactions = [],
  contractId = null,
  labelId = null,
} = {}) => {
  const state = createTechniqueNegativeAtomIndexState()
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    appendTechniqueNegativeTransactionToIndexState(state, transaction)
  }
  return finalizeTechniqueNegativeAtomIndexState(state, { contractId, labelId })
}
