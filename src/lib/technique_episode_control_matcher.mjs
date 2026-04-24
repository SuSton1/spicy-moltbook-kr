import { average, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_EPISODE_CONTROL_PAIR_ROW_KIND = "technique_episode_control_pair_row_v1"

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
  return { sharedCount: shared, unionCount: union, value: union > 0 ? shared / union : 0 }
}

const rankMatch = (left, right) =>
  right.combinedSimilarity - left.combinedSimilarity ||
  right.currentAtomJaccard - left.currentAtomJaccard ||
  right.episodeAtomJaccard - left.episodeAtomJaccard ||
  right.sharedCurrentAtomCount - left.sharedCurrentAtomCount ||
  right.sharedEpisodeAtomCount - left.sharedEpisodeAtomCount ||
  String(left.negativeEpisodeId).localeCompare(String(right.negativeEpisodeId))

export const buildTechniqueEpisodeControlPairs = ({ episodeRows = [], contract } = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("buildTechniqueEpisodeControlPairs requires contract")
  }
  const safeRows = Array.isArray(episodeRows) ? episodeRows : []
  const positives = safeRows.filter((row) => row?.hitTarget === true)
  const negatives = safeRows.filter((row) => row?.hitTarget !== true)
  const negativesByPartition = new Map()
  const negativesByPartitionYear = new Map()
  for (const row of negatives) {
    const partitionKey = String(row?.partitionKey ?? "<missing>")
    const yearKey = String(row?.yearKey ?? "")
    const partitionBucket = negativesByPartition.get(partitionKey) ?? []
    partitionBucket.push(row)
    negativesByPartition.set(partitionKey, partitionBucket)
    const partitionYearKey = `${partitionKey}::${yearKey}`
    const partitionYearBucket = negativesByPartitionYear.get(partitionYearKey) ?? []
    partitionYearBucket.push(row)
    negativesByPartitionYear.set(partitionYearKey, partitionYearBucket)
  }

  const pairRows = []
  let unmatchedPositiveCount = 0
  for (const positiveRow of positives) {
    const partitionKey = String(positiveRow?.partitionKey ?? "<missing>")
    const yearKey = String(positiveRow?.yearKey ?? "")
    const candidateRows = contract.controlRequireSameYear
      ? (negativesByPartitionYear.get(`${partitionKey}::${yearKey}`) ?? [])
      : (negativesByPartition.get(partitionKey) ?? [])
    const positiveCurrent = ensureAtomIds(positiveRow, "currentAtomIds")
    const positiveEpisode = ensureAtomIds(positiveRow, "episodeAtomIds")
    const matches = []
    for (const negativeRow of candidateRows) {
      if (contract.controlRequireSamePartition && partitionKey !== String(negativeRow?.partitionKey ?? "<missing>")) continue
      const current = jaccard(positiveCurrent, ensureAtomIds(negativeRow, "currentAtomIds"))
      const episode = jaccard(positiveEpisode, ensureAtomIds(negativeRow, "episodeAtomIds"))
      if (current.sharedCount < contract.controlMinSharedCurrentAtoms) continue
      if (episode.sharedCount < contract.controlMinSharedEpisodeAtoms) continue
      if (current.value < contract.controlMinCurrentAtomJaccard) continue
      if (episode.value < contract.controlMinEpisodeAtomJaccard) continue
      const combinedSimilarity = (
        current.value * contract.controlCurrentAtomWeight +
        episode.value * contract.controlEpisodeAtomWeight
      ) / (contract.controlCurrentAtomWeight + contract.controlEpisodeAtomWeight)
      matches.push({
        negativeEpisodeId: negativeRow.episodeId,
        negativeDecisionDateKey: negativeRow.decisionDateKey,
        currentAtomJaccard: current.value,
        episodeAtomJaccard: episode.value,
        sharedCurrentAtomCount: current.sharedCount,
        sharedEpisodeAtomCount: episode.sharedCount,
        combinedSimilarity,
      })
    }
    matches.sort(rankMatch)
    const retained = matches.slice(0, contract.maxMatchedControlsPerPositive)
    if (retained.length < 1) {
      unmatchedPositiveCount += 1
      continue
    }
    pairRows.push({
      kind: TECHNIQUE_EPISODE_CONTROL_PAIR_ROW_KIND,
      contractId: contract.contractId,
      positiveEpisodeId: positiveRow.episodeId,
      positiveDecisionDateKey: positiveRow.decisionDateKey,
      partitionKey,
      yearKey: positiveRow.yearKey,
      matchedNegativeEpisodeIds: retained.map((row) => row.negativeEpisodeId),
      matchedControls: retained,
    })
  }

  return {
    kind: "technique_episode_control_pair_dataset_v1",
    contractId: contract.contractId,
    pairRows,
    summary: {
      episodeCount: safeRows.length,
      positiveEpisodeCount: positives.length,
      negativeEpisodeCount: negatives.length,
      candidatePositiveCount: positives.length,
      pairedPositiveCount: pairRows.length,
      unmatchedPositiveCount,
      pairCount: pairRows.reduce((sum, row) => sum + row.matchedControls.length, 0),
      meanMatchedControlsPerPositive: average(pairRows.map((row) => row.matchedControls.length)) ?? 0,
      partitionCount: new Set(pairRows.map((row) => row.partitionKey)).size,
    },
  }
}
