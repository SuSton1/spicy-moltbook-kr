import { yearKeyFromDateKey, uniqueSortedStrings } from "./technique_common.mjs"
import {
  TECHNIQUE_EPISODE_SLICE_CONTRACT_ROW_KIND,
  buildTechniqueEpisodeSliceContractShape,
  matchesTechniqueEpisodeSliceContractRow,
} from "./technique_episode_slice_predicate.mjs"

const sortSummaryRows = (left, right) =>
  left.matchedControlResidueNegativeCount - right.matchedControlResidueNegativeCount ||
  left.fullNegativeResidueCount - right.fullNegativeResidueCount ||
  right.minYearSupport - left.minYearSupport ||
  right.positiveSupportCount - left.positiveSupportCount ||
  left.contractAtomIds.length - right.contractAtomIds.length ||
  left.sliceContractId.localeCompare(right.sliceContractId)

const collectPositiveYearCounts = ({ episodeIds = [], episodesById = {}, coreYears = [] } = {}) => {
  const counts = Object.fromEntries(coreYears.map((yearKey) => [String(yearKey), 0]))
  for (const episodeId of episodeIds) {
    const yearKey = String(episodesById[String(episodeId)]?.yearKey ?? "")
    if (Object.prototype.hasOwnProperty.call(counts, yearKey)) counts[yearKey] += 1
  }
  return counts
}

const minYearSupport = (counts, coreYears) => Math.min(...coreYears.map((yearKey) => Number(counts[String(yearKey)] ?? 0)))

const slugFromAtomIds = (atomIds = []) => uniqueSortedStrings(atomIds)
  .join("__")
  .replace(/[^a-zA-Z0-9_:-]+/g, "_")
  .replace(/:+/g, "-")
  .replace(/_+/g, "_")
  .slice(0, 160) || "slice"

const combinations = (values = [], maxSize = 1) => {
  const out = []
  const safe = uniqueSortedStrings(values)
  const dfs = (startIndex, picked) => {
    if (picked.length > 0) out.push([...picked])
    if (picked.length >= maxSize) return
    for (let index = startIndex; index < safe.length; index += 1) {
      picked.push(safe[index])
      dfs(index + 1, picked)
      picked.pop()
    }
  }
  dfs(0, [])
  return out
}

const evaluateSingleDeltaAtom = ({ deltaAtomId, positiveRows = [], negativeRows = [], controlPairRows = [], coreYears = [] } = {}) => {
  const shape = buildTechniqueEpisodeSliceContractShape({ contractAtomIds: [deltaAtomId] })
  const positiveSupportIds = positiveRows.filter((row) => matchesTechniqueEpisodeSliceContractRow(row, shape)).map((row) => row.episodeId)
  const yearCounts = collectPositiveYearCounts({
    episodeIds: positiveSupportIds,
    episodesById: Object.fromEntries(positiveRows.map((row) => [String(row.episodeId), row])),
    coreYears,
  })
  const matchedControlResiduePairs = controlPairRows.filter((row) => row.positivePass === true && row.negativePassByDeltaAtomId[deltaAtomId] === true)
  const matchedControlResidueNegativeCount = new Set(matchedControlResiduePairs.map((row) => row.negativeEpisodeId)).size
  const fullNegativeResidueCount = negativeRows.filter((row) => matchesTechniqueEpisodeSliceContractRow(row, shape)).length
  return {
    deltaAtomId,
    yearCounts,
    minYearSupport: minYearSupport(yearCounts, coreYears),
    positiveSupportCount: positiveSupportIds.length,
    matchedControlResidueNegativeCount,
    fullNegativeResidueCount,
  }
}

export const searchTechniqueEpisodeSliceContracts = ({ episodeRows = [], deltaRows = [], contract } = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("searchTechniqueEpisodeSliceContracts requires contract")
  }
  const safeRows = Array.isArray(episodeRows) ? episodeRows : []
  const safeDeltaRows = Array.isArray(deltaRows) ? deltaRows : []
  const positiveRows = safeRows.filter((row) => row?.hitTarget === true)
  const negativeRows = safeRows.filter((row) => row?.hitTarget !== true)
  const episodesById = Object.fromEntries(safeRows.map((row) => [String(row?.episodeId ?? ""), row]))

  const controlPairRows = []
  for (const deltaRow of safeDeltaRows) {
    const positiveRow = episodesById[String(deltaRow?.positiveEpisodeId ?? "")]
    const negativeRow = episodesById[String(deltaRow?.negativeEpisodeId ?? "")]
    if (!positiveRow || !negativeRow) continue
    controlPairRows.push({
      positiveEpisodeId: positiveRow.episodeId,
      negativeEpisodeId: negativeRow.episodeId,
      yearKey: positiveRow.yearKey,
      positivePass: true,
      negativePassByDeltaAtomId: Object.fromEntries((Array.isArray(deltaRow?.deltaAtomIds) ? deltaRow.deltaAtomIds : []).map((deltaAtomId) => [deltaAtomId, matchesTechniqueEpisodeSliceContractRow(negativeRow, buildTechniqueEpisodeSliceContractShape({ contractAtomIds: [deltaAtomId] }))])),
    })
  }

  const singleAtomRows = uniqueSortedStrings(safeDeltaRows.flatMap((row) => row?.deltaAtomIds ?? []))
    .map((deltaAtomId) => evaluateSingleDeltaAtom({
      deltaAtomId,
      positiveRows,
      negativeRows,
      controlPairRows,
      coreYears: contract.coreYears,
    }))
    .filter((row) => row.minYearSupport >= contract.minPositiveSupportPerYear)
    .sort((left, right) =>
      left.matchedControlResidueNegativeCount - right.matchedControlResidueNegativeCount ||
      left.fullNegativeResidueCount - right.fullNegativeResidueCount ||
      right.minYearSupport - left.minYearSupport ||
      right.positiveSupportCount - left.positiveSupportCount ||
      left.deltaAtomId.localeCompare(right.deltaAtomId))

  const candidateAtoms = singleAtomRows.slice(0, contract.topDeltaAtomsToConsider).map((row) => row.deltaAtomId)
  const contractRows = []
  const seen = new Set()
  for (const atomIds of combinations(candidateAtoms, contract.maxSliceAtoms)) {
    const shape = buildTechniqueEpisodeSliceContractShape({ contractAtomIds: atomIds })
    const positiveSupportIds = positiveRows.filter((row) => matchesTechniqueEpisodeSliceContractRow(row, shape)).map((row) => row.episodeId)
    const yearCounts = collectPositiveYearCounts({ episodeIds: positiveSupportIds, episodesById, coreYears: contract.coreYears })
    if (contract.coreYears.some((yearKey) => Number(yearCounts[String(yearKey)] ?? 0) < contract.minPositiveSupportPerYear)) {
      continue
    }
    const matchedControlResiduePairs = controlPairRows.filter((pairRow) => {
      const positiveRow = episodesById[String(pairRow.positiveEpisodeId)]
      const negativeRow = episodesById[String(pairRow.negativeEpisodeId)]
      return matchesTechniqueEpisodeSliceContractRow(positiveRow, shape) && matchesTechniqueEpisodeSliceContractRow(negativeRow, shape)
    })
    const matchedControlResidueNegativeCount = new Set(matchedControlResiduePairs.map((row) => row.negativeEpisodeId)).size
    const fullNegativeResidueCount = negativeRows.filter((row) => matchesTechniqueEpisodeSliceContractRow(row, shape)).length
    const sliceSlug = slugFromAtomIds(atomIds)
    const sliceContractId = `${contract.contractId}__slice__${sliceSlug}`
    if (seen.has(sliceContractId)) continue
    seen.add(sliceContractId)
    contractRows.push({
      kind: TECHNIQUE_EPISODE_SLICE_CONTRACT_ROW_KIND,
      contractId: contract.contractId,
      sliceContractId,
      sliceSlug,
      contractAtomIds: uniqueSortedStrings(atomIds),
      ...shape,
      positiveSupportCount: positiveSupportIds.length,
      positiveYearCounts: yearCounts,
      minYearSupport: minYearSupport(yearCounts, contract.coreYears),
      matchedControlResiduePairCount: matchedControlResiduePairs.length,
      matchedControlResidueNegativeCount,
      fullNegativeResidueCount,
    })
  }

  contractRows.sort(sortSummaryRows)
  const topRows = contractRows.slice(0, contract.maxSliceContracts)
  return {
    kind: "technique_episode_slice_contract_search_report_v1",
    contractId: contract.contractId,
    labelId: contract.labelId,
    episodeCount: safeRows.length,
    positiveEpisodeCount: positiveRows.length,
    negativeEpisodeCount: negativeRows.length,
    deltaRowCount: safeDeltaRows.length,
    candidateDeltaAtomCount: candidateAtoms.length,
    evaluatedContractCount: contractRows.length,
    sliceContracts: topRows,
    summary: {
      episodeCount: safeRows.length,
      positiveEpisodeCount: positiveRows.length,
      negativeEpisodeCount: negativeRows.length,
      deltaRowCount: safeDeltaRows.length,
      candidateDeltaAtomCount: candidateAtoms.length,
      evaluatedContractCount: contractRows.length,
      qualifiedContractCount: topRows.length,
      topSliceContracts: topRows.map((row) => ({
        sliceContractId: row.sliceContractId,
        sliceSlug: row.sliceSlug,
        contractAtomIds: row.contractAtomIds,
        positiveSupportCount: row.positiveSupportCount,
        minYearSupport: row.minYearSupport,
        matchedControlResidueNegativeCount: row.matchedControlResidueNegativeCount,
        fullNegativeResidueCount: row.fullNegativeResidueCount,
      })),
    },
  }
}
