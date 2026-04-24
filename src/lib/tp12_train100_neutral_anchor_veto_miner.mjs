import crypto from "node:crypto"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toNumber,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  expressionLimitsFromContract,
  loadTp12Train100NeutralContract,
  outputPathFromContract,
  targetFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"
import {
  loadTp12Train100NeutralEventRows,
  readNeutralAtomCatalog,
  summarizeSupportRows,
} from "./tp12_train100_neutral_atom_bitsets.mjs"
import {
  generateNeutralVetoClausesForAnchor,
  solveNeutralVetoSetCoverForAnchor,
} from "./tp12_train100_neutral_veto_setcover.mjs"

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

const loadAnchors = async (anchorPath) => {
  const rows = []
  await iterateJsonlMaybeGzip(anchorPath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  rows.sort((a, b) =>
    toNumber(a.falsePositiveRowCount, Number.POSITIVE_INFINITY) - toNumber(b.falsePositiveRowCount, Number.POSITIVE_INFINITY) ||
    toNumber(b.hitRowCount, 0) - toNumber(a.hitRowCount, 0) ||
    String(a.anchorId ?? "").localeCompare(String(b.anchorId ?? "")),
  )
  return rows
}

const intersectSorted = (a = [], b = []) => {
  const right = new Set(b)
  return a.filter((value) => right.has(value)).sort((x, y) => x - y)
}

const supportForAnchorAtoms = (anchorAtoms = [], atomById) => {
  if (!Array.isArray(anchorAtoms) || anchorAtoms.length < 1) return []
  let support = [...(atomById.get(anchorAtoms[0])?.matchedRowIds ?? [])]
  for (const atomId of anchorAtoms.slice(1)) support = intersectSorted(support, atomById.get(atomId)?.matchedRowIds ?? [])
  return support
}

const hydrateAnchorSupport = (anchor, atomById, eventRows) => {
  const matchedRowIds = Array.isArray(anchor.matchedRowIds) ? anchor.matchedRowIds : supportForAnchorAtoms(anchor.anchorAtoms, atomById)
  const positiveRowIds = matchedRowIds.filter((rowId) => eventRows[rowId]?.hitTarget === true)
  const negativeRowIds = matchedRowIds.filter((rowId) => eventRows[rowId]?.hitTarget !== true)
  const support = summarizeSupportRows(matchedRowIds, eventRows)
  return {
    ...anchor,
    matchedRowIds,
    positiveRowIds,
    negativeRowIds,
    ...support,
  }
}

export const mineTp12Train100NeutralAnchorVetoPatterns = async ({
  contractPath,
  anchorsPath = "",
  atomCatalogPath = "",
  eventsPath = "",
  outFoundPath = "",
  outRejectedPath = "",
  outFrontierPath = "",
  outSummaryPath = "",
  maxAnchors = 0,
  maxGeneratedVetoClausesPerAnchor = 0,
  maxVisitedVetoStatesPerAnchor = 0,
  maxAnchorFalsePositiveRowsForVeto = null,
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const target = targetFromContract(contract)
  const limits = expressionLimitsFromContract(contract)
  const inputAnchorsPath = anchorsPath ? path.resolve(cwd, anchorsPath) : outputPathFromContract(cwd, contract, "anchorCatalog")
  const inputAtomCatalogPath = atomCatalogPath ? path.resolve(cwd, atomCatalogPath) : outputPathFromContract(cwd, contract, "neutralAtomCatalog")
  const atoms = await readNeutralAtomCatalog(inputAtomCatalogPath)
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const sourceEventsPath = eventsPath || atoms[0]?.sourceEventRowsPath
  if (!sourceEventsPath) throw new Error("eventsPath is required for neutral anchor/veto mining")
  const eventRows = await loadTp12Train100NeutralEventRows(path.resolve(cwd, sourceEventsPath), contract)
  const outputFoundPath = outputPathFromContract(cwd, contract, "foundPatterns", outFoundPath)
  const outputRejectedPath = outputPathFromContract(cwd, contract, "rejectedPatterns", outRejectedPath)
  const outputFrontierPath = outputPathFromContract(cwd, contract, "incompleteFrontier", outFrontierPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "anchorVetoSearchSummary", outSummaryPath)
  const maxClausesPerAnchor = Math.max(1, Math.trunc(toNumber(maxGeneratedVetoClausesPerAnchor, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxGeneratedVetoClausesPerAnchor, 5000)))
  const maxStatesPerAnchor = Math.max(1, Math.trunc(toNumber(maxVisitedVetoStatesPerAnchor, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxVisitedVetoStatesPerAnchor, 20000)))
  const maxAnchorFalsePositiveRows = Math.max(0, Math.trunc(toNumber(maxAnchorFalsePositiveRowsForVeto, NaN)) || Math.trunc(toNumber(contract?.searchLimits?.maxAnchorFalsePositiveRowsForVeto, 5000)))
  const anchors = await loadAnchors(inputAnchorsPath)
  const anchorProcessLimit = Math.max(0, Math.trunc(toNumber(maxAnchors, 0)))
  const anchorsToProcess = anchorProcessLimit > 0 ? anchors.slice(0, anchorProcessLimit) : anchors
  const notProcessedAnchorCount = anchors.length - anchorsToProcess.length

  await ensureDir(path.dirname(outputFoundPath))
  const foundWriter = createJsonlWriteStreamMaybeGzip(outputFoundPath)
  const rejectedWriter = createJsonlWriteStreamMaybeGzip(outputRejectedPath)
  const frontierWriter = createJsonlWriteStreamMaybeGzip(outputFrontierPath)
  let foundPatternCount = 0
  let rejectedAnchorCount = 0
  let incompleteAnchorCount = 0
  let skippedBroadAnchorCount = 0
  let visitedVetoStateCount = 0
  const rejectReasonCounts = new Map()
  const reject = async (anchor, reason, extra = {}) => {
    rejectedAnchorCount += 1
    rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
    await writeJsonlRow(rejectedWriter.stream, {
      kind: "tp12_train100_neutral_anchor_veto_reject_v1",
      anchorId: anchor.anchorId,
      reason,
      ...extra,
    })
  }

  try {
    if (notProcessedAnchorCount > 0) {
      incompleteAnchorCount += notProcessedAnchorCount
      await writeJsonlRow(frontierWriter.stream, {
        kind: "tp12_train100_neutral_anchor_veto_frontier_v1",
        reason: "anchor_process_limit_reached",
        processedAnchorCount: anchorsToProcess.length,
        notProcessedAnchorCount,
        anchorProcessLimit,
      })
    }
    for (const anchorRow of anchorsToProcess) {
      if (toNumber(anchorRow.falsePositiveRowCount, 0) > maxAnchorFalsePositiveRows) {
        skippedBroadAnchorCount += 1
        incompleteAnchorCount += 1
        await writeJsonlRow(frontierWriter.stream, {
          kind: "tp12_train100_neutral_anchor_veto_frontier_v1",
          anchorId: anchorRow.anchorId,
          reason: "anchor_false_positive_count_above_search_cap",
          falsePositiveRowCount: anchorRow.falsePositiveRowCount,
          maxAnchorFalsePositiveRows,
        })
        continue
      }
      const anchor = hydrateAnchorSupport(anchorRow, atomById, eventRows)
      if (anchor.falsePositiveRowCount === 0) {
        const pattern = {
          kind: "tp12_train100_neutral_anchor_veto_candidate_v1",
          patternId: `sha256:${sha256(JSON.stringify({ anchorAtoms: anchor.anchorAtoms, vetoClauses: [] })).slice(0, 32)}`,
          expressionForm: "anchor_and_not_conditional_veto",
          anchorId: anchor.anchorId,
          anchorAtoms: anchor.anchorAtoms,
          vetoClauses: [],
          matchedRowIds: anchor.matchedRowIds,
          hitRows: anchor.hitRowCount,
          falsePositiveRows: 0,
          trainPrecision: 1,
          positiveSymbolDates: anchor.positiveSymbolDates,
          yearHitDecisionDates: anchor.yearHitDecisionDates,
          yearHitSymbolDates: anchor.yearHitSymbolDates,
          featureFamilies: anchor.featureFamilies,
          oosRead: false,
        }
        foundPatternCount += 1
        await writeJsonlRow(foundWriter.stream, pattern)
        continue
      }
      const clauses = generateNeutralVetoClausesForAnchor(anchor, atoms, {
        maxVetoAtomsPerClause: limits.maxVetoAtomsPerClause,
        maxGeneratedVetoClausesPerAnchor: maxClausesPerAnchor,
      })
      if (clauses.length < 1) {
        await reject(anchor, "no_veto_clause_covers_anchor_negatives")
        continue
      }
      const solved = solveNeutralVetoSetCoverForAnchor(anchor, clauses, {
        maxVetoClauses: limits.maxVetoClauses,
        maxVisitedStates: maxStatesPerAnchor,
        eventRows,
        target,
      })
      visitedVetoStateCount += solved.visitedStateCount
      if (solved.status === "incomplete") {
        incompleteAnchorCount += 1
        await writeJsonlRow(frontierWriter.stream, {
          kind: "tp12_train100_neutral_anchor_veto_frontier_v1",
          anchorId: anchor.anchorId,
          reason: "veto_state_cap_reached",
          visitedStateCount: solved.visitedStateCount,
          generatedVetoClauseCount: clauses.length,
        })
        continue
      }
      if (solved.status !== "found") {
        await reject(anchor, "no_clause_set_covers_all_negatives_without_killing_year2hit", {
          generatedVetoClauseCount: clauses.length,
          visitedStateCount: solved.visitedStateCount,
        })
        continue
      }
      const selectedClauses = solved.selectedClauses.map((clause) => ({
        clauseId: clause.clauseId,
        atoms: clause.atoms,
        risk: clause.risk,
        featureFamilies: clause.featureFamilies,
      }))
      const patternId = `sha256:${sha256(JSON.stringify({ anchorAtoms: anchor.anchorAtoms, vetoClauses: selectedClauses })).slice(0, 32)}`
      const pattern = {
        kind: "tp12_train100_neutral_anchor_veto_candidate_v1",
        patternId,
        expressionForm: "anchor_and_not_conditional_veto",
        anchorId: anchor.anchorId,
        anchorAtoms: anchor.anchorAtoms,
        vetoClauses: selectedClauses,
        matchedRowIds: solved.retainedPositiveRowIds,
        hitRows: solved.retainedPositiveRowIds.length,
        falsePositiveRows: 0,
        trainPrecision: 1,
        positiveSymbolDates: solved.retainedPositiveRowIds.length,
        killedPositiveRowIds: solved.killedPositiveRowIds,
        featureFamilies: [...new Set([...(anchor.featureFamilies ?? []), ...selectedClauses.flatMap((clause) => clause.featureFamilies ?? [])])].sort(),
        oosRead: false,
      }
      foundPatternCount += 1
      await writeJsonlRow(foundWriter.stream, pattern)
    }
  } finally {
    await foundWriter.close()
    await rejectedWriter.close()
    await frontierWriter.close()
  }

  const searchComplete = incompleteAnchorCount === 0 && notProcessedAnchorCount === 0
  const status = !searchComplete ? (foundPatternCount > 0 ? "found_incomplete" : "incomplete") : foundPatternCount > 0 ? "found" : "complete_no_survivor"
  const summary = {
    kind: "tp12_train100_neutral_anchor_veto_search_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    anchorsPath: inputAnchorsPath,
    atomCatalogPath: inputAtomCatalogPath,
    eventsPath: path.resolve(cwd, sourceEventsPath),
    status,
    searchComplete,
    processedAnchorCount: anchorsToProcess.length,
    notProcessedAnchorCount,
    inputAnchorCount: anchors.length,
    maxClausesPerAnchor,
    maxStatesPerAnchor,
    maxAnchorFalsePositiveRows,
    skippedBroadAnchorCount,
    foundPatternCount,
    rejectedAnchorCount,
    incompleteAnchorCount,
    visitedVetoStateCount,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}
