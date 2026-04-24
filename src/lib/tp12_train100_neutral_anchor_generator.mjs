import crypto from "node:crypto"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  toNumber,
  toText,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  CORE_YEARS,
  loadTp12Train100NeutralContract,
  outputPathFromContract,
  targetFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"
import {
  loadTp12Train100NeutralEventRows,
  readNeutralAtomCatalog,
  summarizeSupportRows,
} from "./tp12_train100_neutral_atom_bitsets.mjs"

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

const normalizeRowIds = (values = []) => [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)

const intersectSorted = (a = [], b = []) => {
  const out = []
  let left = 0
  let right = 0
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) {
      out.push(a[left])
      left += 1
      right += 1
    } else if (a[left] < b[right]) {
      left += 1
    } else {
      right += 1
    }
  }
  return out
}

const unionSorted = (...arrays) => [...new Set(arrays.flat())].sort((a, b) => a - b)

const featureFamiliesFor = (atoms) => [...new Set(atoms.map((atom) => toText(atom.family)).filter(Boolean))].sort()

const supportPassesPositiveTarget = (support, target) =>
  support.positiveSymbolDates >= target.minTotalPositiveSymbolDates &&
  CORE_YEARS.every((year) =>
    support.yearHitDecisionDates[String(year)] >= target.minHitDecisionDatesPerYear &&
    support.yearHitSymbolDates[String(year)] >= target.minHitSymbolDatesPerYear,
  )

const summarizePositiveRows = (positiveRowIds, eventRows) => {
  const yearHitDecisionDates = new Map()
  const yearHitSymbolDates = new Map()
  for (const rowId of positiveRowIds) {
    const row = eventRows[rowId]
    if (!row?.hitTarget) continue
    const year = String(row.year)
    if (!yearHitDecisionDates.has(year)) yearHitDecisionDates.set(year, new Set())
    if (!yearHitSymbolDates.has(year)) yearHitSymbolDates.set(year, new Set())
    yearHitDecisionDates.get(year).add(row.decisionDateKey)
    yearHitSymbolDates.get(year).add(`${row.symbol}::${row.decisionDateKey}`)
  }
  const yearDecisionObject = {}
  const yearSymbolObject = {}
  for (const year of CORE_YEARS) {
    yearDecisionObject[String(year)] = yearHitDecisionDates.get(String(year))?.size ?? 0
    yearSymbolObject[String(year)] = yearHitSymbolDates.get(String(year))?.size ?? 0
  }
  return {
    positiveSymbolDates: positiveRowIds.length,
    yearHitDecisionDates: yearDecisionObject,
    yearHitSymbolDates: yearSymbolObject,
  }
}

const digestRowIds = (rowIds) => {
  const hash = crypto.createHash("sha256")
  hash.update(`${rowIds.length}:`)
  for (const rowId of rowIds) hash.update(`${rowId},`)
  return hash.digest("hex").slice(0, 24)
}

export const generateTp12Train100NeutralAnchors = async ({
  contractPath,
  atomCatalogPath = "",
  eventsPath = "",
  outPath = "",
  outSummaryPath = "",
  maxAnchorAtoms = 0,
  maxVisitedStates = 0,
  maxGeneratedAnchors = 0,
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const target = targetFromContract(contract)
  const maxAtoms = Math.max(1, Math.trunc(toNumber(maxAnchorAtoms, 0)) || Math.trunc(toNumber(contract?.expression?.maxAnchorAtoms, 4)))
  const searchLimit = Math.max(1, Math.trunc(toNumber(maxVisitedStates, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxVisitedAnchorStates, 250000)))
  const generatedAnchorLimit = Math.max(1, Math.trunc(toNumber(maxGeneratedAnchors, 0)) || Math.trunc(toNumber(contract?.searchLimits?.maxGeneratedAnchors, 25000)))
  const inputAtomCatalogPath = atomCatalogPath
    ? path.resolve(cwd, atomCatalogPath)
    : outputPathFromContract(cwd, contract, "neutralAtomCatalog")
  const inputEventsPath = eventsPath ? path.resolve(cwd, eventsPath) : toText((await readNeutralAtomCatalog(inputAtomCatalogPath, { includeRows: false }))[0]?.sourceEventRowsPath)
  if (!inputEventsPath) throw new Error("eventsPath is required for anchor generation")
  const outputPath = outputPathFromContract(cwd, contract, "anchorCatalog", outPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "anchorGenerationSummary", outSummaryPath)
  let [atoms, eventRows] = await Promise.all([
    readNeutralAtomCatalog(inputAtomCatalogPath),
    loadTp12Train100NeutralEventRows(inputEventsPath, contract),
  ])
  atoms = atoms.map((atom) => ({
    ...atom,
    matchedRowIds: normalizeRowIds(atom.matchedRowIds),
    hitRowIds: normalizeRowIds(atom.hitRowIds),
    falsePositiveRowIds: normalizeRowIds(atom.falsePositiveRowIds),
  }))
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const usableAtoms = atoms.filter((atom) => atom.targetEligibleAsSingleAtom === true || atom.hitRowCount >= target.minTotalPositiveSymbolDates)
    .sort((a, b) => b.hitRowCount - a.hitRowCount || a.falsePositiveRowCount - b.falsePositiveRowCount || a.atomId.localeCompare(b.atomId))

  await ensureDir(path.dirname(outputPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputPath)
  const seenSupportDigests = new Set()
  const rejectReasonCounts = new Map()
  let visitedStateCount = 0
  let generatedAnchorCount = 0
  let dominancePrunedCount = 0
  let duplicateSupportPrunedCount = 0
  let capReached = false

  const recordReject = (reason) => rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)

  const writeAnchor = async (state) => {
    const anchorAtoms = state.atomIds
    const atomRows = anchorAtoms.map((atomId) => atomById.get(atomId)).filter(Boolean)
    const rowIds = unionSorted(state.positiveRowIds, state.negativeRowIds)
    const support = {
      ...summarizeSupportRows(rowIds, eventRows),
      matchedRowCount: rowIds.length,
      hitRowCount: state.positiveRowIds.length,
      falsePositiveRowCount: state.negativeRowIds.length,
      trainPrecision: rowIds.length > 0 ? state.positiveRowIds.length / rowIds.length : 0,
    }
    const anchorId = `sha256:${sha256(JSON.stringify({ anchorAtoms })).slice(0, 32)}`
    const row = {
      kind: "tp12_train100_neutral_anchor_v1",
      anchorId,
      anchorAtoms,
      supportRowIdsOmitted: true,
      supportRehydration: "atom_catalog_intersection_required",
      featureFamilies: featureFamiliesFor(atomRows),
      dominancePruned: false,
      ...support,
    }
    generatedAnchorCount += 1
    await writeJsonlRow(writer.stream, row)
  }

  const dfs = async (startIndex, atomIds, positiveRowIds, negativeRowIds) => {
    if (capReached) return
    visitedStateCount += 1
    if (visitedStateCount > searchLimit || generatedAnchorCount >= generatedAnchorLimit) {
      capReached = true
      return
    }
    if (atomIds.length > 0) {
      const support = summarizePositiveRows(positiveRowIds, eventRows)
      if (!supportPassesPositiveTarget(support, target)) {
        recordReject("positive_support_below_target")
        return
      } else {
        const supportDigest = `${digestRowIds(positiveRowIds)}:${digestRowIds(negativeRowIds)}`
        if (seenSupportDigests.has(supportDigest)) {
          duplicateSupportPrunedCount += 1
          recordReject("duplicate_support_pruned")
        } else {
          seenSupportDigests.add(supportDigest)
          const state = { atomIds, positiveRowIds, negativeRowIds, support }
          await writeAnchor(state)
        }
      }
    }
    if (atomIds.length >= maxAtoms) return
    for (let index = startIndex; index < usableAtoms.length; index += 1) {
      const atom = usableAtoms[index]
      const nextPositiveRows = atomIds.length === 0 ? atom.hitRowIds : intersectSorted(positiveRowIds, atom.hitRowIds)
      if (nextPositiveRows.length < target.minTotalPositiveSymbolDates) {
        recordReject("positive_rows_below_min_total")
        continue
      }
      const nextNegativeRows = atomIds.length === 0 ? atom.falsePositiveRowIds : intersectSorted(negativeRowIds, atom.falsePositiveRowIds)
      await dfs(index + 1, [...atomIds, atom.atomId], nextPositiveRows, nextNegativeRows)
      if (capReached) return
    }
  }

  try {
    await dfs(0, [], [], [])
  } finally {
    await writer.close()
  }

  const summary = {
    kind: "tp12_train100_neutral_anchor_generation_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    atomCatalogPath: inputAtomCatalogPath,
    eventsPath: inputEventsPath,
    outPath: outputPath,
    status: capReached ? "incomplete" : "complete",
    searchComplete: !capReached,
    searchLimit,
    generatedAnchorLimit,
    visitedStateCount,
    inputAtomCount: atoms.length,
    usableAtomCount: usableAtoms.length,
    generatedAnchorCount,
    supportRowIdsOmitted: true,
    dominancePrunedCount,
    duplicateSupportPrunedCount,
    dominanceMode: "duplicate_support_digest_pruning",
    exactDominancePruningEnabled: false,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}
