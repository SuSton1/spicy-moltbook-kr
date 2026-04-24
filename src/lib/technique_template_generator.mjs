import {
  resolveTechniqueClauseSpec,
  TECHNIQUE_CLAUSE_GROUP_IDS,
} from "./technique_clause_library.mjs"
import { toText, uniqueSortedStrings } from "./technique_common.mjs"

const combinations = (values = [], min = 0, max = 0) => {
  const safeValues = Array.isArray(values) ? values : []
  const out = []
  const walk = (index, current) => {
    if (current.length >= min && current.length <= max) {
      out.push([...current])
    }
    if (current.length === max) return
    for (let cursor = index; cursor < safeValues.length; cursor += 1) {
      current.push(safeValues[cursor])
      walk(cursor + 1, current)
      current.pop()
    }
  }
  walk(0, [])
  return out
}

const candidateIdFromParts = (seedId, selectedClauses = []) => {
  const body = uniqueSortedStrings(selectedClauses)
    .map((clauseId) => clauseId.replace(/[^a-z0-9]+/gi, "-").toLowerCase())
    .join("--")
  return `${toText(seedId)}__${body || "anchor-only"}`
}

const assertClauseGroup = (clauseId, expectedGroup) => {
  const clauseSpec = resolveTechniqueClauseSpec(clauseId)
  if (!clauseSpec) {
    throw new Error(`Unknown technique clauseId=${clauseId}`)
  }
  if (clauseSpec.clauseGroup !== expectedGroup) {
    throw new Error(`Technique clause ${clauseId} is not in group ${expectedGroup}`)
  }
  return clauseSpec
}

const assertClauseSupportsMechanism = (clauseSpec, mechanismId) => {
  const allowedFamilies = uniqueSortedStrings(clauseSpec?.mechanismFamilies)
  const mechanism = toText(mechanismId)
  if (!mechanism) {
    throw new Error(`Technique seed mechanismId is required`)
  }
  if (!allowedFamilies.includes(mechanism)) {
    throw new Error(`Technique clause ${clauseSpec.clauseId} does not support mechanism ${mechanism}`)
  }
}

const validateSeedClausePools = (seed) => {
  for (const clauseId of seed.anchorClauseIds) assertClauseSupportsMechanism(assertClauseGroup(clauseId, "anchor"), seed.mechanismId)
  for (const clauseId of seed.retestClauseIds) assertClauseSupportsMechanism(assertClauseGroup(clauseId, "retest"), seed.mechanismId)
  for (const clauseId of seed.compressionClauseIds) {
    assertClauseSupportsMechanism(assertClauseGroup(clauseId, "compression"), seed.mechanismId)
  }
  for (const clauseId of seed.confirmClauseIds) assertClauseSupportsMechanism(assertClauseGroup(clauseId, "confirm"), seed.mechanismId)
  for (const clauseId of seed.invalidateClauseIds) {
    assertClauseSupportsMechanism(assertClauseGroup(clauseId, "invalidate"), seed.mechanismId)
  }
  if (seed.anchorClauseIds.length < 1) {
    throw new Error(`Technique seed ${seed.seedId} must define at least one anchor clause`)
  }
}

const buildCandidateRecordsForSeed = ({ seed, techniqueContract } = {}) => {
  validateSeedClausePools(seed)
  const clauseShape = techniqueContract?.clauseShape ?? {}
  const minTotalClauses = Number(techniqueContract?.generation?.minTotalClauses ?? 0) || 0
  const maxGeneratedCandidatesPerSeed = Number(techniqueContract?.generation?.maxGeneratedCandidatesPerSeed ?? 0) || 0
  const candidates = []
  for (const anchorClauseId of seed.anchorClauseIds) {
    const retestCombos = combinations(
      seed.retestClauseIds,
      clauseShape?.retest?.min ?? 0,
      clauseShape?.retest?.max ?? 0,
    )
    const compressionCombos = combinations(
      seed.compressionClauseIds,
      clauseShape?.compression?.min ?? 0,
      clauseShape?.compression?.max ?? 0,
    )
    const confirmCombos = combinations(
      seed.confirmClauseIds,
      clauseShape?.confirm?.min ?? 0,
      clauseShape?.confirm?.max ?? 0,
    )
    const invalidateCombos = combinations(
      seed.invalidateClauseIds,
      clauseShape?.invalidate?.min ?? 0,
      clauseShape?.invalidate?.max ?? 0,
    )
    for (const retestClauseIds of retestCombos) {
      for (const compressionClauseIds of compressionCombos) {
        for (const confirmClauseIds of confirmCombos) {
          for (const invalidateClauseIds of invalidateCombos) {
            const clauseSet = {
              anchor: [anchorClauseId],
              retest: uniqueSortedStrings(retestClauseIds),
              compression: uniqueSortedStrings(compressionClauseIds),
              confirm: uniqueSortedStrings(confirmClauseIds),
              invalidate: uniqueSortedStrings(invalidateClauseIds),
            }
            const allClauseIds = uniqueSortedStrings([
              ...clauseSet.anchor,
              ...clauseSet.retest,
              ...clauseSet.compression,
              ...clauseSet.confirm,
              ...clauseSet.invalidate,
            ])
            if (allClauseIds.length < minTotalClauses) continue
            candidates.push({
              kind: "technique_candidate_template_v1",
              candidateTemplateId: candidateIdFromParts(seed.seedId, allClauseIds),
              seedId: seed.seedId,
              mechanismId: seed.mechanismId,
              clauseSet,
              allClauseIds,
              scopeCandidates: uniqueSortedStrings(seed.scopeCandidates),
              lookbackCandidateIds: uniqueSortedStrings(seed.lookbackCandidateIds),
            })
          }
        }
      }
    }
  }
  const deduped = Array.from(
    new Map(
      candidates.map((candidate) => [
        `${candidate.mechanismId}::${candidate.candidateTemplateId}`,
        candidate,
      ]),
    ).values(),
  )
  if (deduped.length < 1) {
    throw new Error(`Technique seed ${seed.seedId} generated zero candidates`)
  }
  return deduped.slice(0, maxGeneratedCandidatesPerSeed).map((candidate, index) => ({
    ...candidate,
    generationRank: index + 1,
  }))
}

export const generateTechniqueCandidateTemplates = ({
  techniqueContract,
  seedTemplates,
} = {}) => {
  if (!techniqueContract || typeof techniqueContract !== "object") {
    throw new Error("techniqueContract is required")
  }
  const seeds = Array.isArray(seedTemplates?.seeds) ? seedTemplates.seeds : []
  if (seeds.length < 1) {
    throw new Error("seedTemplates.seeds is required")
  }
  const templates = []
  for (const seed of seeds) {
    templates.push(...buildCandidateRecordsForSeed({ seed, techniqueContract }))
  }
  if (templates.length < 1) {
    throw new Error("Technique template generation produced zero candidates")
  }
  return {
    kind: "technique_candidate_template_set_v1",
    contractId: techniqueContract.contractId,
    templateSetId: seedTemplates.templateSetId,
    clauseGroups: [...TECHNIQUE_CLAUSE_GROUP_IDS],
    templateCount: templates.length,
    templates,
  }
}
