import { buildTechniqueStructuralAtomsForRow } from "./technique_structural_atom_builder.mjs"
import { ensureDateKey, toText, uniqueSortedStrings, yearKeyFromDateKey } from "./technique_common.mjs"

export const TECHNIQUE_EPISODE_WINDOW_ROW_KIND = "technique_episode_window_row_v1"

const startsWithAllowedPrefix = (atomId, allowedPrefixes = []) =>
  (Array.isArray(allowedPrefixes) ? allowedPrefixes : []).some((prefix) => String(atomId ?? "").startsWith(`${prefix}`))

const familyOfAtom = (atomId) => {
  const text = toText(atomId)
  const colonIndex = text.indexOf(":")
  return colonIndex >= 0 ? text.slice(0, colonIndex) : text
}

const buildTransitionAtoms = ({ previousAtomIds = [], currentAtomIds = [], maxTransitionAtomsPerStep = 0 } = {}) => {
  if (maxTransitionAtomsPerStep < 1) return []
  const previousFamilies = uniqueSortedStrings(previousAtomIds.map(familyOfAtom))
  const currentFamilies = uniqueSortedStrings(currentAtomIds.map(familyOfAtom))
  const out = []
  for (const previousFamily of previousFamilies) {
    for (const currentFamily of currentFamilies) {
      out.push(`transition:${previousFamily}->${currentFamily}`)
      if (out.length >= maxTransitionAtomsPerStep) return out
    }
  }
  return out
}

const normalizeEpisodeSourceRow = ({ row, episodeContract, structuralContract, labelId, defaultScopeId, defaultLookbackCandidateId } = {}) => {
  const structural = buildTechniqueStructuralAtomsForRow({
    row,
    contract: structuralContract,
    labelId,
    defaultScopeId,
    defaultLookbackCandidateId,
  })
  const currentAtomIds = structural.atomIds.filter((atomId) =>
    startsWithAllowedPrefix(atomId, episodeContract.allowedAtomPrefixes),
  ).slice(0, episodeContract.maxAtomsPerStep)
  return {
    ...structural,
    currentAtomIds,
  }
}

const buildEpisodeRowsForSymbol = ({ symbolRows = [], episodeContract } = {}) => {
  const orderedRows = [...(Array.isArray(symbolRows) ? symbolRows : [])].sort((left, right) =>
    String(left.decisionDateKey).localeCompare(String(right.decisionDateKey)) || String(left.sourceRowId).localeCompare(String(right.sourceRowId)),
  )
  return orderedRows.map((currentRow, index) => {
    const episodeAtomIds = []
    for (const atomId of currentRow.currentAtomIds) {
      episodeAtomIds.push(`curr:${atomId}`)
    }
    for (let step = 1; step <= episodeContract.lookbackSteps; step += 1) {
      const previousRow = orderedRows[index - step]
      if (!previousRow) continue
      for (const atomId of previousRow.currentAtomIds) {
        episodeAtomIds.push(`prev${step}:${atomId}`)
      }
      if (step === 1 && episodeContract.allowFamilyTransitions) {
        episodeAtomIds.push(...buildTransitionAtoms({
          previousAtomIds: previousRow.currentAtomIds,
          currentAtomIds: currentRow.currentAtomIds,
          maxTransitionAtomsPerStep: episodeContract.maxTransitionAtomsPerStep,
        }))
      }
    }
    const dedupedEpisodeAtomIds = uniqueSortedStrings(episodeAtomIds)
    return {
      kind: TECHNIQUE_EPISODE_WINDOW_ROW_KIND,
      contractId: episodeContract.contractId,
      labelId: currentRow.labelId,
      episodeId: `${currentRow.sourceRowId}::ep`,
      sourceRowId: currentRow.sourceRowId,
      decisionDateKey: ensureDateKey(currentRow.decisionDateKey, "decisionDateKey"),
      yearKey: yearKeyFromDateKey(currentRow.decisionDateKey),
      symbol: currentRow.symbol,
      scopeId: currentRow.scopeId,
      lookbackCandidateId: currentRow.lookbackCandidateId,
      partitionKey: currentRow.partitionKey,
      hitTarget: currentRow.hitTarget === true,
      lookbackSteps: episodeContract.lookbackSteps,
      currentAtomIds: currentRow.currentAtomIds,
      episodeAtomIds: dedupedEpisodeAtomIds,
      episodeAtomCount: dedupedEpisodeAtomIds.length,
    }
  })
}

export const buildTechniqueEpisodeWindows = ({
  rows = [],
  episodeContract,
  structuralContract,
  labelId = null,
  defaultScopeId = null,
  defaultLookbackCandidateId = null,
} = {}) => {
  if (!episodeContract || typeof episodeContract !== "object") {
    throw new Error("buildTechniqueEpisodeWindows requires episodeContract")
  }
  if (!structuralContract || typeof structuralContract !== "object") {
    throw new Error("buildTechniqueEpisodeWindows requires structuralContract")
  }
  const normalizedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const decisionDateKey = ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
    if (decisionDateKey < episodeContract.trainRange.startDateKey || decisionDateKey > episodeContract.trainRange.endDateKey) {
      continue
    }
    normalizedRows.push(normalizeEpisodeSourceRow({
      row,
      episodeContract,
      structuralContract,
      labelId: toText(labelId) || episodeContract.labelId,
      defaultScopeId,
      defaultLookbackCandidateId,
    }))
  }

  const bySymbol = new Map()
  for (const row of normalizedRows) {
    const bucket = bySymbol.get(row.symbol) ?? []
    bucket.push(row)
    bySymbol.set(row.symbol, bucket)
  }

  const episodeRows = []
  for (const symbolRows of bySymbol.values()) {
    episodeRows.push(...buildEpisodeRowsForSymbol({ symbolRows, episodeContract }))
  }
  episodeRows.sort((left, right) =>
    String(left.decisionDateKey).localeCompare(String(right.decisionDateKey)) || String(left.symbol).localeCompare(String(right.symbol)),
  )

  const positiveEpisodeCount = episodeRows.filter((row) => row.hitTarget === true).length
  return {
    kind: "technique_episode_window_dataset_v1",
    contractId: episodeContract.contractId,
    labelId: episodeContract.labelId,
    episodeRows,
    summary: {
      inputRowCount: normalizedRows.length,
      episodeRowCount: episodeRows.length,
      positiveEpisodeCount,
      negativeEpisodeCount: episodeRows.length - positiveEpisodeCount,
      symbolCount: bySymbol.size,
      uniqueEpisodeAtomCount: new Set(episodeRows.flatMap((row) => row.episodeAtomIds)).size,
      lookbackSteps: episodeContract.lookbackSteps,
    },
  }
}
