import { uniqueSortedStrings } from "./technique_common.mjs"
import { TECHNIQUE_EPISODE_DELTA_ATOM_KIND } from "./technique_episode_slice_predicate.mjs"

const ensureAtomIds = (row, field) => uniqueSortedStrings(Array.isArray(row?.[field]) ? row[field] : [])

const positiveOnly = (left = [], right = []) => {
  const rightSet = new Set(right)
  return left.filter((atomId) => !rightSet.has(atomId))
}

export const buildTechniqueEpisodeDeltaAtoms = ({ episodeRows = [], controlPairRows = [], contract } = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("buildTechniqueEpisodeDeltaAtoms requires contract")
  }
  const episodesById = Object.fromEntries((Array.isArray(episodeRows) ? episodeRows : []).map((row) => [String(row?.episodeId ?? ""), row]))
  const deltaRows = []
  for (const pairRow of Array.isArray(controlPairRows) ? controlPairRows : []) {
    const positiveRow = episodesById[String(pairRow?.positiveEpisodeId ?? "")]
    if (!positiveRow) continue
    const positiveCurrent = ensureAtomIds(positiveRow, "currentAtomIds")
    const positiveEpisode = ensureAtomIds(positiveRow, "episodeAtomIds")
    for (const matched of Array.isArray(pairRow?.matchedControls) ? pairRow.matchedControls : []) {
      const negativeRow = episodesById[String(matched?.negativeEpisodeId ?? "")]
      if (!negativeRow) continue
      const negativeCurrent = ensureAtomIds(negativeRow, "currentAtomIds")
      const negativeEpisode = ensureAtomIds(negativeRow, "episodeAtomIds")
      const deltaAtomIds = uniqueSortedStrings([
        ...positiveOnly(positiveCurrent, negativeCurrent).map((atomId) => `require_current:${atomId}`),
        ...positiveOnly(negativeCurrent, positiveCurrent).map((atomId) => `forbid_current:${atomId}`),
        ...positiveOnly(positiveEpisode, negativeEpisode).map((atomId) => `require_episode:${atomId}`),
        ...positiveOnly(negativeEpisode, positiveEpisode).map((atomId) => `forbid_episode:${atomId}`),
      ])
      deltaRows.push({
        kind: TECHNIQUE_EPISODE_DELTA_ATOM_KIND,
        contractId: contract.contractId,
        pairId: `${positiveRow.episodeId}::${negativeRow.episodeId}`,
        positiveEpisodeId: positiveRow.episodeId,
        negativeEpisodeId: negativeRow.episodeId,
        partitionKey: positiveRow.partitionKey,
        yearKey: positiveRow.yearKey,
        deltaAtomIds,
        similarity: Number(matched?.combinedSimilarity ?? 0),
      })
    }
  }
  return {
    kind: "technique_episode_delta_atom_dataset_v1",
    contractId: contract.contractId,
    deltaRows,
    summary: {
      pairCount: deltaRows.length,
      uniqueDeltaAtomCount: new Set(deltaRows.flatMap((row) => row.deltaAtomIds)).size,
      positiveEpisodeCount: new Set(deltaRows.map((row) => row.positiveEpisodeId)).size,
      negativeEpisodeCount: new Set(deltaRows.map((row) => row.negativeEpisodeId)).size,
    },
  }
}
