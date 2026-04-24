import { toText, uniqueSortedStrings } from "./technique_common.mjs"

const ensureAtomIds = (row, field) => uniqueSortedStrings(Array.isArray(row?.[field]) ? row[field] : [])

const intersectCount = (leftSet, rightSet) => {
  let count = 0
  const small = leftSet.size <= rightSet.size ? leftSet : rightSet
  const large = small === leftSet ? rightSet : leftSet
  for (const value of small) {
    if (large.has(value)) count += 1
  }
  return count
}

const jaccard = (left = [], right = []) => {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const shared = intersectCount(leftSet, rightSet)
  const union = new Set([...leftSet, ...rightSet]).size
  return {
    sharedCount: shared,
    unionCount: union,
    value: union > 0 ? shared / union : 0,
  }
}

export const buildMatchedControlConsensusAtoms = ({
  positiveRowIds = [],
  rowsById = [],
  atomField = "currentAtomIds",
  minShare = 0.5,
} = {}) => {
  const safeIds = Array.isArray(positiveRowIds) ? positiveRowIds : [...positiveRowIds]
  const counts = new Map()
  const total = safeIds.length
  if (total < 1) {
    return { consensusAtomIds: [], atomShareById: {} }
  }
  for (const id of safeIds) {
    for (const atomId of ensureAtomIds(rowsById[id], atomField)) {
      counts.set(atomId, (counts.get(atomId) ?? 0) + 1)
    }
  }
  const consensusAtomIds = []
  const atomShareById = {}
  for (const [atomId, count] of counts.entries()) {
    const share = count / total
    atomShareById[atomId] = share
    if (share >= minShare) consensusAtomIds.push(atomId)
  }
  return {
    consensusAtomIds: uniqueSortedStrings(consensusAtomIds),
    atomShareById,
  }
}

export function buildMatchedControlPuritySlice({
  positiveRowIds = [],
  candidateNegativeRowIds = [],
  rowsById = [],
  atomField = "currentAtomIds",
  yearField = "yearKey",
  minConsensusShare = 0.5,
  minSharedAtoms = 0,
  minOverlapRatio = 0,
  maxControls = 0,
  distanceMetric = "consensus_jaccard",
  requireSameYearBand = false,
} = {}) {
  if (distanceMetric !== "consensus_jaccard") {
    throw new Error(`Unsupported matched-control purity slice distanceMetric=${distanceMetric}`)
  }
  const positiveIds = Array.isArray(positiveRowIds) ? positiveRowIds : [...positiveRowIds]
  const negativeIds = Array.isArray(candidateNegativeRowIds) ? candidateNegativeRowIds : [...candidateNegativeRowIds]
  const { consensusAtomIds, atomShareById } = buildMatchedControlConsensusAtoms({
    positiveRowIds: positiveIds,
    rowsById,
    atomField,
    minShare: minConsensusShare,
  })
  const consensusSet = new Set(consensusAtomIds)
  if (consensusSet.size < 1) {
    return {
      supervisedNegativeIds: [],
      consensusAtomIds,
      candidateNegativeCount: negativeIds.length,
      matchedControlCount: 0,
      droppedNegativeCount: negativeIds.length,
      scoreByNegativeId: {},
      sliceSummary: {
        minConsensusShare,
        minSharedAtoms,
        minOverlapRatio,
        maxControls,
        distanceMetric,
        requireSameYearBand,
      },
      atomShareById,
    }
  }

  const positiveYearSet = new Set(positiveIds.map((id) => String(rowsById[id]?.[yearField] ?? "")))
  const scored = []
  const scoreByNegativeId = {}
  for (const id of negativeIds) {
    const row = rowsById[id]
    if (!row) continue
    if (requireSameYearBand && !positiveYearSet.has(String(row?.[yearField] ?? ""))) continue
    const atoms = ensureAtomIds(row, atomField)
    const atomSet = new Set(atoms)
    const sharedCount = intersectCount(consensusSet, atomSet)
    const overlapRatio = consensusSet.size > 0 ? sharedCount / consensusSet.size : 0
    if (sharedCount < minSharedAtoms || overlapRatio < minOverlapRatio) continue
    const distance = 1 - jaccard(consensusAtomIds, atoms).value
    const score = {
      sharedAtomCount: sharedCount,
      overlapRatio,
      consensusDistance: distance,
      yearDistance: null,
    }
    scoreByNegativeId[String(id)] = score
    scored.push({ negativeId: id, ...score })
  }

  scored.sort((left, right) =>
    left.consensusDistance - right.consensusDistance ||
    right.sharedAtomCount - left.sharedAtomCount ||
    right.overlapRatio - left.overlapRatio ||
    String(left.negativeId).localeCompare(String(right.negativeId)))

  const retained = maxControls > 0 ? scored.slice(0, maxControls) : scored
  return {
    supervisedNegativeIds: retained.map((row) => row.negativeId),
    consensusAtomIds,
    candidateNegativeCount: negativeIds.length,
    matchedControlCount: retained.length,
    droppedNegativeCount: Math.max(negativeIds.length - retained.length, 0),
    scoreByNegativeId,
    sliceSummary: {
      minConsensusShare,
      minSharedAtoms,
      minOverlapRatio,
      maxControls,
      distanceMetric,
      requireSameYearBand,
    },
    atomShareById,
  }
}
