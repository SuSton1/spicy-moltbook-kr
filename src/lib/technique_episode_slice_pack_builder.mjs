import { uniqueSortedStrings } from "./technique_common.mjs"
import { buildTechniqueEpisodeSliceContractShape, matchesTechniqueEpisodeSliceContractRow } from "./technique_episode_slice_predicate.mjs"

export const materializeTechniqueEpisodeSlicePack = ({ episodeRows = [], sliceContract } = {}) => {
  const shape = {
    ...buildTechniqueEpisodeSliceContractShape({ contractAtomIds: sliceContract?.contractAtomIds ?? [] }),
    ...sliceContract,
  }
  const rows = (Array.isArray(episodeRows) ? episodeRows : []).filter((row) => matchesTechniqueEpisodeSliceContractRow(row, shape))
  const positiveEpisodeCount = rows.filter((row) => row?.hitTarget === true).length
  return {
    kind: "technique_episode_slice_pack_v1",
    sliceContractId: sliceContract?.sliceContractId,
    sliceSlug: sliceContract?.sliceSlug,
    contractAtomIds: uniqueSortedStrings(sliceContract?.contractAtomIds ?? []),
    episodeRows: rows,
    summary: {
      episodeCount: rows.length,
      positiveEpisodeCount,
      negativeEpisodeCount: rows.length - positiveEpisodeCount,
      partitionCount: new Set(rows.map((row) => row?.partitionKey)).size,
      symbolCount: new Set(rows.map((row) => row?.symbol)).size,
    },
  }
}
