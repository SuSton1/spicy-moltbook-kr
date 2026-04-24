import path from "node:path"

import { writeJson } from "./io.mjs"
import {
  buildTp12NoStopLookbackCandidateRollingContract,
  normalizeTp12NoStopLookbackCandidateId,
  resolveTp12NoStopLookbackCandidate,
} from "./tp12_no_stop_lookback_ladder_contract.mjs"
import {
  buildTp12NoStopScopeExpansionScopeSlug,
  normalizeTp12NoStopScopeExpansionScopeId,
} from "./tp12_no_stop_scope_expansion_contract.mjs"
import { resolveTp12NoStopScopeSpec } from "./tp12_no_stop_scope_filter.mjs"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

export const normalizeTp12Year2x8BankDiscoveryCellId = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

export const buildTp12Year2x8BankDiscoveryCellId = ({ scopeId, candidateId } = {}) =>
  normalizeTp12Year2x8BankDiscoveryCellId(
    `${buildTp12NoStopScopeExpansionScopeSlug(scopeId)}_${normalizeTp12NoStopLookbackCandidateId(candidateId)}`,
  )

export const buildTp12Year2x8BankDiscoveryCellSlug = (cellId) =>
  normalizeTp12Year2x8BankDiscoveryCellId(cellId) || "cell"

export const resolveTp12Year2x8BankDiscoveryCells = ({
  year2x8Contract,
  scopeIds = [],
  candidateIds = [],
} = {}) => {
  const safeScopeIds =
    uniqueSorted(scopeIds).length > 0
      ? uniqueSorted(scopeIds)
      : Array.isArray(year2x8Contract?.bankDiscovery?.scopeIds)
        ? year2x8Contract.bankDiscovery.scopeIds
        : []
  const safeCandidateIds =
    uniqueSorted(candidateIds).length > 0
      ? uniqueSorted(candidateIds)
      : Array.isArray(year2x8Contract?.bankDiscovery?.lookbackCandidateIds)
        ? year2x8Contract.bankDiscovery.lookbackCandidateIds
        : []
  const cells = []
  for (const scopeIdRaw of safeScopeIds) {
    const scopeId = resolveTp12NoStopScopeSpec(scopeIdRaw)?.scopeId
    if (!scopeId) {
      throw new Error(`Unknown year2x8 scopeId=${scopeIdRaw}`)
    }
    for (const candidateIdRaw of safeCandidateIds) {
      const candidate = resolveTp12NoStopLookbackCandidate({
        ladderContract: year2x8Contract?.baseLookbackLadderContract,
        candidateId: candidateIdRaw,
      })
      cells.push({
        cellId: buildTp12Year2x8BankDiscoveryCellId({
          scopeId,
          candidateId: candidate.candidateId,
        }),
        scopeId,
        candidateId: candidate.candidateId,
        lookbackTradingDays: candidate.lookbackTradingDays,
        ordinal: cells.length,
      })
    }
  }
  return cells
}

export const resolveTp12Year2x8BankDiscoveryCell = ({
  year2x8Contract,
  scopeId,
  candidateId,
} = {}) => {
  const cells = resolveTp12Year2x8BankDiscoveryCells({
    year2x8Contract,
    scopeIds: [scopeId],
    candidateIds: [candidateId],
  })
  const cell = cells[0] ?? null
  if (!cell) {
    throw new Error(`Unable to resolve year2x8 cell scopeId=${scopeId} candidateId=${candidateId}`)
  }
  return cell
}

export const buildTp12Year2x8BankDiscoveryRollingContract = ({
  year2x8Contract,
  scopeId,
  candidateId,
} = {}) => {
  const cell = resolveTp12Year2x8BankDiscoveryCell({
    year2x8Contract,
    scopeId,
    candidateId,
  })
  const baseRolling = buildTp12NoStopLookbackCandidateRollingContract({
    ladderContract: year2x8Contract?.baseLookbackLadderContract,
    candidateId: cell.candidateId,
  })
  const resolvedScopeId = resolveTp12NoStopScopeSpec(cell.scopeId)?.scopeId
  if (!resolvedScopeId) {
    throw new Error(`Unknown year2x8 scopeId=${cell.scopeId}`)
  }
  return {
    ...JSON.parse(JSON.stringify(baseRolling)),
    contractId: `${toText(year2x8Contract?.contractId)}_${buildTp12Year2x8BankDiscoveryCellSlug(cell.cellId)}`,
    updatedAt: toText(year2x8Contract?.updatedAt),
    scopeId: resolvedScopeId,
    searchContract: {
      ...(baseRolling?.searchContract ?? {}),
      enableYearHitUpperBoundPrune: year2x8Contract?.yearHitPrune?.enableYearHitUpperBoundPrune === true,
      coreYears: Array.isArray(year2x8Contract?.yearHitPrune?.coreYears)
        ? year2x8Contract.yearHitPrune.coreYears.slice()
        : [],
      excludedBoundaryYears: Array.isArray(year2x8Contract?.yearHitPrune?.excludedBoundaryYears)
        ? year2x8Contract.yearHitPrune.excludedBoundaryYears.slice()
        : [],
      minTrainHitsPerCoreYear: Number(year2x8Contract?.yearHitPrune?.minTrainHitsPerCoreYear ?? 0) || null,
      screenMaxSearchStates:
        Number(year2x8Contract?.bankDiscovery?.screenMaxSearchStates ?? 0) ||
        Number(baseRolling?.searchContract?.screenMaxSearchStates ?? 0),
      configPath: toText(baseRolling?.searchContract?.configPath),
    },
    hardStops: [
      `Derived year2x8 bank-discovery rolling contract for cellId=${cell.cellId}`,
      `scopeId=${resolvedScopeId}`,
      `candidateId=${cell.candidateId}`,
      ...((Array.isArray(year2x8Contract?.hardStops) ? year2x8Contract.hardStops : []).slice(0, 8)),
      ...((Array.isArray(baseRolling?.hardStops) ? baseRolling.hardStops : []).slice(0, 8)),
    ],
    notes: [
      `Derived from ${toText(year2x8Contract?.contractPath)}`,
      `cellId=${cell.cellId}`,
      `scopeId=${resolvedScopeId}`,
      `candidateId=${cell.candidateId}`,
      `lookbackTradingDays=${cell.lookbackTradingDays}`,
      `coreYears=${(year2x8Contract?.yearHitPrune?.coreYears ?? []).join(",")}`,
      `minTrainHitsPerCoreYear=${Number(year2x8Contract?.yearHitPrune?.minTrainHitsPerCoreYear ?? 0) || 0}`,
      ...((Array.isArray(baseRolling?.notes) ? baseRolling.notes : []).slice(0, 8)),
    ],
  }
}

export const writeTp12Year2x8BankDiscoveryRollingContract = async ({
  year2x8Contract,
  scopeId,
  candidateId,
  outPath,
} = {}) => {
  const payload = buildTp12Year2x8BankDiscoveryRollingContract({
    year2x8Contract,
    scopeId,
    candidateId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12Year2x8BankDiscoveryRollingContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
