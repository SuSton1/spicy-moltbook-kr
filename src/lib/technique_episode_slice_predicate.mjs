import { toText, uniqueSortedStrings } from "./technique_common.mjs"

export const TECHNIQUE_EPISODE_DELTA_ATOM_KIND = "technique_episode_delta_atom_v1"
export const TECHNIQUE_EPISODE_SLICE_CONTRACT_ROW_KIND = "technique_episode_slice_contract_row_v1"

const ensureArray = (value) => uniqueSortedStrings(Array.isArray(value) ? value : [])

export const parseTechniqueEpisodeDeltaAtom = (value) => {
  const text = toText(value)
  const colonIndex = text.indexOf(":")
  if (colonIndex <= 0) {
    throw new Error(`Invalid technique episode delta atom: ${value ?? "<null>"}`)
  }
  const prefix = text.slice(0, colonIndex)
  const atomId = text.slice(colonIndex + 1)
  if (!atomId) {
    throw new Error(`Invalid technique episode delta atom target: ${value ?? "<null>"}`)
  }
  switch (prefix) {
    case "require_current":
      return { family: "current", polarity: "require", atomId, deltaAtomId: text }
    case "forbid_current":
      return { family: "current", polarity: "forbid", atomId, deltaAtomId: text }
    case "require_episode":
      return { family: "episode", polarity: "require", atomId, deltaAtomId: text }
    case "forbid_episode":
      return { family: "episode", polarity: "forbid", atomId, deltaAtomId: text }
    default:
      throw new Error(`Unsupported technique episode delta atom prefix=${prefix}`)
  }
}

export const buildTechniqueEpisodeSliceContractShape = ({ contractAtomIds = [] } = {}) => {
  const requireCurrentAtomIds = []
  const forbidCurrentAtomIds = []
  const requireEpisodeAtomIds = []
  const forbidEpisodeAtomIds = []
  for (const deltaAtomId of ensureArray(contractAtomIds)) {
    const parsed = parseTechniqueEpisodeDeltaAtom(deltaAtomId)
    if (parsed.family === "current" && parsed.polarity === "require") requireCurrentAtomIds.push(parsed.atomId)
    else if (parsed.family === "current" && parsed.polarity === "forbid") forbidCurrentAtomIds.push(parsed.atomId)
    else if (parsed.family === "episode" && parsed.polarity === "require") requireEpisodeAtomIds.push(parsed.atomId)
    else if (parsed.family === "episode" && parsed.polarity === "forbid") forbidEpisodeAtomIds.push(parsed.atomId)
  }
  return {
    contractAtomIds: ensureArray(contractAtomIds),
    requireCurrentAtomIds: ensureArray(requireCurrentAtomIds),
    forbidCurrentAtomIds: ensureArray(forbidCurrentAtomIds),
    requireEpisodeAtomIds: ensureArray(requireEpisodeAtomIds),
    forbidEpisodeAtomIds: ensureArray(forbidEpisodeAtomIds),
  }
}

export const matchesTechniqueEpisodeSliceContractRow = (row, sliceContract) => {
  const currentAtomSet = new Set(ensureArray(row?.currentAtomIds))
  const episodeAtomSet = new Set(ensureArray(row?.episodeAtomIds))
  for (const atomId of ensureArray(sliceContract?.requireCurrentAtomIds)) {
    if (!currentAtomSet.has(atomId)) return false
  }
  for (const atomId of ensureArray(sliceContract?.forbidCurrentAtomIds)) {
    if (currentAtomSet.has(atomId)) return false
  }
  for (const atomId of ensureArray(sliceContract?.requireEpisodeAtomIds)) {
    if (!episodeAtomSet.has(atomId)) return false
  }
  for (const atomId of ensureArray(sliceContract?.forbidEpisodeAtomIds)) {
    if (episodeAtomSet.has(atomId)) return false
  }
  return true
}
