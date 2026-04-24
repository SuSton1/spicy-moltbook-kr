import { buildTechniqueStructuralAtomsForRow } from "./technique_structural_atom_builder.mjs"

export const TECHNIQUE_ATOMIC_TRANSACTION_KIND = "technique_atomic_transaction_v1"

export const buildTechniqueAtomicTransactionRow = ({
  row,
  contract,
  labelId = null,
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  const atomRow = buildTechniqueStructuralAtomsForRow({
    row,
    contract,
    labelId,
    defaultScopeId,
    defaultLookbackCandidateId,
  })
  return {
    kind: TECHNIQUE_ATOMIC_TRANSACTION_KIND,
    contractId: atomRow.contractId,
    labelId: atomRow.labelId,
    rowId: atomRow.sourceRowId,
    decisionDateKey: atomRow.decisionDateKey,
    yearKey: atomRow.yearKey,
    symbol: atomRow.symbol,
    scopeId: atomRow.scopeId,
    lookbackCandidateId: atomRow.lookbackCandidateId,
    partitionKey: atomRow.partitionKey,
    hitTarget: atomRow.hitTarget,
    atomIds: atomRow.atomIds,
    atomCount: atomRow.atomIds.length,
    atomGroups: atomRow.atomGroups,
    atomMetadataById: atomRow.atomMetadataById,
    baseFeatureIds: atomRow.baseFeatureIds,
  }
}
