import { uniqueSortedStrings } from "./technique_common.mjs"
import { buildMatchedControlPuritySlice } from "./technique_matched_control_purity_slice.mjs"

export const TECHNIQUE_EPISODE_SUBSTRATE_REPORT_KIND = "technique_episode_substrate_report_v1"

const intersectSets = (left, right) => {
  if (!(left instanceof Set) || !(right instanceof Set)) return new Set()
  const small = left.size <= right.size ? left : right
  const large = small === left ? right : left
  const out = new Set()
  for (const value of small) {
    if (large.has(value)) out.add(value)
  }
  return out
}

const collectYearCounts = ({ matchedPositiveIds, episodesById, coreYears }) => {
  const counts = Object.fromEntries(coreYears.map((yearKey) => [String(yearKey), 0]))
  for (const id of matchedPositiveIds) {
    const episode = episodesById[id]
    const yearKey = String(episode?.yearKey ?? "")
    if (Object.prototype.hasOwnProperty.call(counts, yearKey)) counts[yearKey] += 1
  }
  return counts
}

const minYearSupport = (counts, coreYears) => Math.min(...coreYears.map((yearKey) => Number(counts[String(yearKey)] ?? 0)))

const collectPartitionSummary = ({ episodeRows = [], coreYears = [], partitionKey = "<missing>" } = {}) => {
  const yearPositiveCounts = Object.fromEntries(coreYears.map((yearKey) => [String(yearKey), 0]))
  let positiveEpisodeCount = 0
  for (const row of Array.isArray(episodeRows) ? episodeRows : []) {
    if (row?.hitTarget === true) {
      positiveEpisodeCount += 1
      const yearKey = String(row?.yearKey ?? "")
      if (Object.prototype.hasOwnProperty.call(yearPositiveCounts, yearKey)) yearPositiveCounts[yearKey] += 1
    }
  }
  const episodeCount = Array.isArray(episodeRows) ? episodeRows.length : 0
  return {
    partitionKey,
    episodeCount,
    positiveEpisodeCount,
    negativeEpisodeCount: episodeCount - positiveEpisodeCount,
    yearPositiveCounts,
    minYearSupport: minYearSupport(yearPositiveCounts, coreYears),
    eligible: coreYears.every((yearKey) => Number(yearPositiveCounts[String(yearKey)] ?? 0) >= 2),
  }
}

const buildEpisodeIndex = (episodes = [], coreYears = []) => {
  const positiveByYear = new Map(coreYears.map((yearKey) => [yearKey, new Set()]))
  const negativeIds = new Set()
  const atomToEpisodeIds = new Map()
  const episodesById = []
  for (const row of Array.isArray(episodes) ? episodes : []) {
    const id = episodesById.length
    episodesById.push(row)
    const atomIds = uniqueSortedStrings(row?.episodeAtomIds)
    for (const atomId of atomIds) {
      let bucket = atomToEpisodeIds.get(atomId)
      if (!bucket) {
        bucket = new Set()
        atomToEpisodeIds.set(atomId, bucket)
      }
      bucket.add(id)
    }
    if (row?.hitTarget === true) {
      const positiveBucket = positiveByYear.get(Number(row?.yearKey))
      if (positiveBucket) positiveBucket.add(id)
    } else {
      negativeIds.add(id)
    }
  }
  return { episodesById, positiveByYear, negativeIds, atomToEpisodeIds }
}

const currentAtomIdsForEpisode = (episode) => uniqueSortedStrings(episode?.currentAtomIds)

const buildPositiveConsensusCurrentAtoms = ({ matchedPositiveIds, episodesById, minShare }) => {
  const counts = new Map()
  const total = matchedPositiveIds instanceof Set ? matchedPositiveIds.size : 0
  if (total < 1) return []
  for (const id of matchedPositiveIds) {
    for (const atomId of currentAtomIdsForEpisode(episodesById[id])) {
      counts.set(atomId, (counts.get(atomId) ?? 0) + 1)
    }
  }
  return uniqueSortedStrings(Array.from(counts.entries())
    .filter(([, count]) => count / total >= minShare)
    .map(([atomId]) => atomId))
}

const buildSupervisedNegativeSlice = ({ coreCandidate, index, contract } = {}) => {
  if (contract.negativeSupervisionMode === "all") {
    return {
      consensusCurrentAtomIds: [],
      supervisedNegativeIds: new Set(coreCandidate.matchedNegativeIds),
    }
  }

  if (contract.negativeSupervisionMode === "matched_control_purity_slice") {
    const matchedControlSlice = buildMatchedControlPuritySlice({
      positiveRowIds: [...coreCandidate.matchedPositiveIds],
      candidateNegativeRowIds: [...coreCandidate.matchedNegativeIds],
      rowsById: index.episodesById,
      atomField: "currentAtomIds",
      yearField: "yearKey",
      minConsensusShare: contract.matchedControlPositiveConsensusMinShare,
      minSharedAtoms: contract.matchedControlMinSharedCurrentAtoms,
      minOverlapRatio: contract.matchedControlMinCurrentAtomOverlapRatio,
      maxControls: contract.matchedControlMaxControlsPerCore,
      distanceMetric: contract.matchedControlDistanceMetric,
      requireSameYearBand: contract.matchedControlRequireSameYearBand,
    })
    return {
      consensusCurrentAtomIds: matchedControlSlice.consensusAtomIds,
      supervisedNegativeIds: new Set(matchedControlSlice.supervisedNegativeIds),
      matchedControlSliceSummary: matchedControlSlice.sliceSummary,
    }
  }

  const consensusCurrentAtomIds = buildPositiveConsensusCurrentAtoms({
    matchedPositiveIds: coreCandidate.matchedPositiveIds,
    episodesById: index.episodesById,
    minShare: contract.nearMissPositiveConsensusMinShare,
  })
  const consensusSet = new Set(consensusCurrentAtomIds)
  if (consensusSet.size < 1) {
    return { consensusCurrentAtomIds, supervisedNegativeIds: new Set() }
  }

  const supervisedNegativeIds = new Set()
  for (const negativeId of coreCandidate.matchedNegativeIds) {
    const currentAtomIds = currentAtomIdsForEpisode(index.episodesById[negativeId])
    const sharedCount = currentAtomIds.filter((atomId) => consensusSet.has(atomId)).length
    const overlapRatio = consensusSet.size > 0 ? sharedCount / consensusSet.size : 0
    if (sharedCount >= contract.nearMissMinSharedCurrentAtoms && overlapRatio >= contract.nearMissMinCurrentAtomOverlapRatio) {
      supervisedNegativeIds.add(negativeId)
    }
  }

  return {
    consensusCurrentAtomIds,
    supervisedNegativeIds,
  }
}

const rankCoreCandidate = (left, right) =>
  left.negativeCount - right.negativeCount ||
  right.minYearSupport - left.minYearSupport ||
  right.totalPositiveSupport - left.totalPositiveSupport ||
  left.coreAtomIds.length - right.coreAtomIds.length ||
  String(left.partitionKey ?? "").localeCompare(String(right.partitionKey ?? "")) ||
  left.patternId.localeCompare(right.patternId)

const rankEligibleAtom = (left, right) =>
  left.negativeCount - right.negativeCount ||
  right.minYearSupport - left.minYearSupport ||
  right.totalPositiveSupport - left.totalPositiveSupport ||
  left.atomId.localeCompare(right.atomId)

const applyCandidateCap = (rows, limit) => (limit > 0 ? rows.slice(0, limit) : rows)

const rankVetoCandidate = (left, right) =>
  left.remainingSupervisedNegativeCount - right.remainingSupervisedNegativeCount ||
  right.removedSupervisedNegativeCount - left.removedSupervisedNegativeCount ||
  left.totalPositiveExcluded - right.totalPositiveExcluded ||
  left.remainingNegativeCount - right.remainingNegativeCount ||
  left.vetoAtomIds.length - right.vetoAtomIds.length ||
  String(left.partitionKey ?? "").localeCompare(String(right.partitionKey ?? "")) ||
  left.vetoAtomIds.join("|").localeCompare(right.vetoAtomIds.join("|"))

const buildEligibleAtoms = ({ index, contract } = {}) => uniqueSortedStrings(Array.from(index.atomToEpisodeIds.keys()))
  .map((atomId) => {
    const matchedIds = index.atomToEpisodeIds.get(atomId) ?? new Set()
    const matchedPositiveIds = new Set(Array.from(matchedIds).filter((id) => index.episodesById[id]?.hitTarget === true))
    const yearCounts = collectYearCounts({
      matchedPositiveIds,
      episodesById: index.episodesById,
      coreYears: contract.coreYears,
    })
    const matchedNegativeIds = new Set(Array.from(matchedIds).filter((id) => index.episodesById[id]?.hitTarget !== true))
    return {
      atomId,
      yearCounts,
      minYearSupport: minYearSupport(yearCounts, contract.coreYears),
      totalPositiveSupport: matchedPositiveIds.size,
      negativeCount: matchedNegativeIds.size,
    }
  })
  .filter((row) => contract.coreYears.every((yearKey) => Number(row.yearCounts[String(yearKey)] ?? 0) >= contract.minPositiveEpisodeSupportPerYear))
  .sort(rankEligibleAtom)
  .slice(0, contract.maxAtomsToConsider)
  .map((row) => row.atomId)

const enumerateCoreCandidates = ({ index, contract, partitionKey } = {}) => {
  const eligibleAtoms = buildEligibleAtoms({ index, contract })

  const candidates = []
  const dfs = ({ startIndex, coreAtomIds, matchedEpisodeIds } = {}) => {
    if (coreAtomIds.length > 0) {
      const matchedPositiveIds = new Set(Array.from(matchedEpisodeIds).filter((id) => index.episodesById[id]?.hitTarget === true))
      const yearCounts = collectYearCounts({ matchedPositiveIds, episodesById: index.episodesById, coreYears: contract.coreYears })
      if (contract.coreYears.every((yearKey) => Number(yearCounts[String(yearKey)] ?? 0) >= contract.minPositiveEpisodeSupportPerYear)) {
        const matchedNegativeIds = new Set(Array.from(matchedEpisodeIds).filter((id) => index.episodesById[id]?.hitTarget !== true))
        candidates.push({
          patternId: `episode_core__${partitionKey}__${coreAtomIds.join("__")}`,
          partitionKey,
          coreAtomIds: [...coreAtomIds],
          matchedPositiveIds,
          matchedNegativeIds,
          yearPositiveCounts: yearCounts,
          minYearSupport: minYearSupport(yearCounts, contract.coreYears),
          totalPositiveSupport: matchedPositiveIds.size,
          negativeCount: matchedNegativeIds.size,
        })
      } else {
        return
      }
    }
    if (coreAtomIds.length >= contract.maxCoreAtoms) return
    for (let indexOffset = startIndex; indexOffset < eligibleAtoms.length; indexOffset += 1) {
      const atomId = eligibleAtoms[indexOffset]
      const nextMatched = coreAtomIds.length < 1
        ? new Set(index.atomToEpisodeIds.get(atomId) ?? [])
        : intersectSets(matchedEpisodeIds, index.atomToEpisodeIds.get(atomId) ?? new Set())
      if (nextMatched.size < 1) continue
      dfs({
        startIndex: indexOffset + 1,
        coreAtomIds: [...coreAtomIds, atomId],
        matchedEpisodeIds: nextMatched,
      })
    }
  }

  dfs({ startIndex: 0, coreAtomIds: [], matchedEpisodeIds: new Set() })
  candidates.sort(rankCoreCandidate)
  return applyCandidateCap(candidates, contract.maxCoreCandidates)
}

const evaluateVetoCombo = ({ coreCandidate, vetoAtomIds, index, contract } = {}) => {
  const vetoSets = vetoAtomIds.map((atomId) => index.atomToEpisodeIds.get(atomId) ?? new Set())
  let excludedEpisodeIds = null
  for (const vetoSet of vetoSets) {
    excludedEpisodeIds = excludedEpisodeIds === null ? new Set(vetoSet) : intersectSets(excludedEpisodeIds, vetoSet)
    if (excludedEpisodeIds.size < 1) break
  }
  excludedEpisodeIds = excludedEpisodeIds ?? new Set()
  const remainingPositiveIds = new Set(Array.from(coreCandidate.matchedPositiveIds).filter((id) => !excludedEpisodeIds.has(id)))
  const remainingNegativeIds = new Set(Array.from(coreCandidate.matchedNegativeIds).filter((id) => !excludedEpisodeIds.has(id)))
  const remainingSupervisedNegativeIds = new Set(Array.from(coreCandidate.supervisedNegativeIds).filter((id) => !excludedEpisodeIds.has(id)))
  const yearCounts = collectYearCounts({ matchedPositiveIds: remainingPositiveIds, episodesById: index.episodesById, coreYears: contract.coreYears })
  if (!contract.coreYears.every((yearKey) => Number(yearCounts[String(yearKey)] ?? 0) >= contract.minPositiveEpisodeSupportPerYear)) {
    return null
  }
  return {
    patternId: `${coreCandidate.patternId}__veto__${vetoAtomIds.join("__")}`,
    partitionKey: coreCandidate.partitionKey,
    coreAtomIds: coreCandidate.coreAtomIds,
    vetoAtomIds,
    negativeSupervisionMode: contract.negativeSupervisionMode,
    consensusCurrentAtomIds: coreCandidate.consensusCurrentAtomIds,
    minYearSupport: minYearSupport(yearCounts, contract.coreYears),
    totalPositiveSupport: remainingPositiveIds.size,
    yearPositiveCounts: yearCounts,
    matchedNegativeCount: coreCandidate.matchedNegativeIds.size,
    supervisedNegativeCount: coreCandidate.supervisedNegativeIds.size,
    removedNegativeCount: coreCandidate.matchedNegativeIds.size - remainingNegativeIds.size,
    removedSupervisedNegativeCount: coreCandidate.supervisedNegativeIds.size - remainingSupervisedNegativeIds.size,
    totalPositiveExcluded: coreCandidate.matchedPositiveIds.size - remainingPositiveIds.size,
    remainingNegativeCount: remainingNegativeIds.size,
    remainingSupervisedNegativeCount: remainingSupervisedNegativeIds.size,
  }
}

const rankVetoAtomCandidate = (left, right) =>
  right.supervisedCoverage - left.supervisedCoverage ||
  left.positiveCoverage - right.positiveCoverage ||
  right.negativeCoverage - left.negativeCoverage ||
  left.atomId.localeCompare(right.atomId)

const selectCandidateVetoAtoms = ({ coreCandidate, index, contract } = {}) => applyCandidateCap(uniqueSortedStrings(Array.from(coreCandidate.supervisedNegativeIds).flatMap((id) =>
  index.episodesById[id]?.episodeAtomIds ?? [],
)).filter((atomId) => !coreCandidate.coreAtomIds.includes(atomId)).map((atomId) => {
  const episodeIds = index.atomToEpisodeIds.get(atomId) ?? new Set()
  let supervisedCoverage = 0
  let negativeCoverage = 0
  let positiveCoverage = 0
  for (const id of coreCandidate.supervisedNegativeIds) {
    if (episodeIds.has(id)) supervisedCoverage += 1
  }
  for (const id of coreCandidate.matchedNegativeIds) {
    if (episodeIds.has(id)) negativeCoverage += 1
  }
  for (const id of coreCandidate.matchedPositiveIds) {
    if (episodeIds.has(id)) positiveCoverage += 1
  }
  return { atomId, supervisedCoverage, negativeCoverage, positiveCoverage }
}).filter((row) => row.supervisedCoverage > 0)
  .sort(rankVetoAtomCandidate), contract.maxVetoCandidatesPerCore)
  .map((row) => row.atomId)

const findVetoSurvivor = ({ coreCandidate, index, contract } = {}) => {
  if (coreCandidate.supervisedNegativeIds.size === 0) {
    return {
      patternId: `${coreCandidate.patternId}__veto__none`,
      partitionKey: coreCandidate.partitionKey,
      coreAtomIds: coreCandidate.coreAtomIds,
      vetoAtomIds: [],
      negativeSupervisionMode: contract.negativeSupervisionMode,
      consensusCurrentAtomIds: coreCandidate.consensusCurrentAtomIds,
      minYearSupport: coreCandidate.minYearSupport,
      totalPositiveSupport: coreCandidate.totalPositiveSupport,
      yearPositiveCounts: coreCandidate.yearPositiveCounts,
      matchedNegativeCount: coreCandidate.matchedNegativeIds.size,
      supervisedNegativeCount: coreCandidate.supervisedNegativeIds.size,
      removedNegativeCount: 0,
      removedSupervisedNegativeCount: 0,
      totalPositiveExcluded: 0,
      remainingNegativeCount: coreCandidate.matchedNegativeIds.size,
      remainingSupervisedNegativeCount: 0,
    }
  }
  const vetoCandidates = []
  const candidateAtomIds = selectCandidateVetoAtoms({ coreCandidate, index, contract })

  for (const atomId of candidateAtomIds) {
    const row = evaluateVetoCombo({ coreCandidate, vetoAtomIds: [atomId], index, contract })
    if (row) vetoCandidates.push(row)
  }
  if (contract.maxVetoAtoms >= 2) {
    for (let leftIndex = 0; leftIndex < candidateAtomIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidateAtomIds.length; rightIndex += 1) {
        const row = evaluateVetoCombo({
          coreCandidate,
          vetoAtomIds: [candidateAtomIds[leftIndex], candidateAtomIds[rightIndex]],
          index,
          contract,
        })
        if (row) vetoCandidates.push(row)
      }
    }
  }
  vetoCandidates.sort(rankVetoCandidate)
  return vetoCandidates[0] ?? null
}

const searchWithinPartition = ({ episodeRows = [], contract, partitionKey = "<missing>" } = {}) => {
  const partitionSummary = collectPartitionSummary({ episodeRows, coreYears: contract.coreYears, partitionKey })
  if (!partitionSummary.eligible) {
    return {
      partitionSummary: {
        ...partitionSummary,
        searched: false,
        coreCandidateCount: 0,
        supervisedCoreCandidateCount: 0,
        verifiedPatternCount: 0,
        verifiedFullZeroNegativePatternCount: 0,
      },
      verifiedPatterns: [],
      coreCandidateCount: 0,
      supervisedCoreCandidateCount: 0,
    }
  }
  const index = buildEpisodeIndex(episodeRows, contract.coreYears)
  const coreCandidates = enumerateCoreCandidates({ index, contract, partitionKey })
  const verifiedPatterns = []
  let supervisedCoreCandidateCount = 0
  for (const coreCandidate of coreCandidates) {
    const supervised = buildSupervisedNegativeSlice({ coreCandidate, index, contract })
    const preparedCore = {
      ...coreCandidate,
      consensusCurrentAtomIds: supervised.consensusCurrentAtomIds,
      supervisedNegativeIds: supervised.supervisedNegativeIds,
    }
    if (contract.requireNearMissNegatives && contract.negativeSupervisionMode !== "all" && preparedCore.supervisedNegativeIds.size < 1) {
      continue
    }
    supervisedCoreCandidateCount += 1
    const survivor = findVetoSurvivor({ coreCandidate: preparedCore, index, contract })
    if (survivor && survivor.remainingSupervisedNegativeCount === 0) verifiedPatterns.push(survivor)
  }
  return {
    partitionSummary: {
      ...partitionSummary,
      searched: true,
      coreCandidateCount: coreCandidates.length,
      supervisedCoreCandidateCount,
      verifiedPatternCount: verifiedPatterns.length,
      verifiedFullZeroNegativePatternCount: verifiedPatterns.filter((row) => row.remainingNegativeCount === 0).length,
    },
    verifiedPatterns: verifiedPatterns.sort(rankVetoCandidate),
    coreCandidateCount: coreCandidates.length,
    supervisedCoreCandidateCount,
  }
}

const sortPartitionSummaries = (left, right) =>
  Number(right.eligible) - Number(left.eligible) ||
  right.positiveEpisodeCount - left.positiveEpisodeCount ||
  left.negativeEpisodeCount - right.negativeEpisodeCount ||
  String(left.partitionKey).localeCompare(String(right.partitionKey))

export const searchTechniqueEpisodeSubstrates = ({ episodeRows = [], contract } = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("searchTechniqueEpisodeSubstrates requires contract")
  }
  const safeRows = Array.isArray(episodeRows) ? episodeRows : []
  if (contract.searchMode === "global") {
    const partitionKey = "__global__"
    const report = searchWithinPartition({ episodeRows: safeRows, contract, partitionKey })
    return {
      kind: TECHNIQUE_EPISODE_SUBSTRATE_REPORT_KIND,
      contractId: contract.contractId,
      labelId: contract.labelId,
      coreYears: contract.coreYears,
      searchMode: contract.searchMode,
      partitionField: contract.partitionField,
      negativeSupervisionMode: contract.negativeSupervisionMode,
      episodeCount: safeRows.length,
      partitionCount: 1,
      eligiblePartitionCount: Number(report.partitionSummary.eligible),
      searchedPartitionCount: Number(report.partitionSummary.searched),
      coreCandidateCount: report.coreCandidateCount,
      supervisedCoreCandidateCount: report.supervisedCoreCandidateCount,
      verifiedPatternCount: report.verifiedPatterns.length,
      verifiedFullZeroNegativePatternCount: report.verifiedPatterns.filter((row) => row.remainingNegativeCount === 0).length,
      partitionSummaries: [report.partitionSummary],
      verifiedPatterns: report.verifiedPatterns,
    }
  }

  const partitionBuckets = new Map()
  for (const row of safeRows) {
    const partitionKey = String(row?.[contract.partitionField] ?? "<missing>")
    const bucket = partitionBuckets.get(partitionKey) ?? []
    bucket.push(row)
    partitionBuckets.set(partitionKey, bucket)
  }

  const baseSummaries = [...partitionBuckets.entries()].map(([partitionKey, rows]) =>
    collectPartitionSummary({ episodeRows: rows, coreYears: contract.coreYears, partitionKey }),
  ).sort(sortPartitionSummaries)

  const eligiblePartitionKeys = baseSummaries
    .filter((summary) => summary.eligible)
    .slice(0, contract.maxPartitionsToSearch > 0 ? contract.maxPartitionsToSearch : baseSummaries.length)
    .map((summary) => summary.partitionKey)

  const eligiblePartitionSet = new Set(eligiblePartitionKeys)
  const partitionSummaries = []
  const verifiedPatterns = []
  let coreCandidateCount = 0
  let supervisedCoreCandidateCount = 0

  for (const summary of baseSummaries) {
    if (!eligiblePartitionSet.has(summary.partitionKey)) {
      partitionSummaries.push({
        ...summary,
        searched: false,
        coreCandidateCount: 0,
        supervisedCoreCandidateCount: 0,
        verifiedPatternCount: 0,
        verifiedFullZeroNegativePatternCount: 0,
      })
      continue
    }
    const result = searchWithinPartition({
      episodeRows: partitionBuckets.get(summary.partitionKey) ?? [],
      contract,
      partitionKey: summary.partitionKey,
    })
    coreCandidateCount += result.coreCandidateCount
    supervisedCoreCandidateCount += result.supervisedCoreCandidateCount
    partitionSummaries.push(result.partitionSummary)
    verifiedPatterns.push(...result.verifiedPatterns)
  }

  partitionSummaries.sort(sortPartitionSummaries)
  verifiedPatterns.sort(rankVetoCandidate)
  return {
    kind: TECHNIQUE_EPISODE_SUBSTRATE_REPORT_KIND,
    contractId: contract.contractId,
    labelId: contract.labelId,
    coreYears: contract.coreYears,
    searchMode: contract.searchMode,
    partitionField: contract.partitionField,
    negativeSupervisionMode: contract.negativeSupervisionMode,
    episodeCount: safeRows.length,
    partitionCount: partitionBuckets.size,
    eligiblePartitionCount: baseSummaries.filter((summary) => summary.eligible).length,
    searchedPartitionCount: partitionSummaries.filter((summary) => summary.searched).length,
    coreCandidateCount,
    supervisedCoreCandidateCount,
    verifiedPatternCount: verifiedPatterns.length,
    verifiedFullZeroNegativePatternCount: verifiedPatterns.filter((row) => row.remainingNegativeCount === 0).length,
    partitionSummaries,
    verifiedPatterns,
  }
}
