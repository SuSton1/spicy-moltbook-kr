import crypto from "node:crypto"

import { toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")
const CLAUSE_DOMINANCE_PRUNE_LIMIT = 1000

export const intersectSorted = (a = [], b = []) => {
  const setB = new Set(b)
  return a.filter((value) => setB.has(value)).sort((x, y) => x - y)
}

export const unionSorted = (arrays = []) => [...new Set(arrays.flat())].sort((a, b) => a - b)

export const differenceSorted = (a = [], b = []) => {
  const setB = new Set(b)
  return a.filter((value) => !setB.has(value)).sort((x, y) => x - y)
}

const combinations = (items, size, limit) => {
  const out = []
  const dfs = (start, acc) => {
    if (out.length >= limit) return
    if (acc.length === size) {
      out.push([...acc])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      acc.push(items[index])
      dfs(index + 1, acc)
      acc.pop()
      if (out.length >= limit) return
    }
  }
  dfs(0, [])
  return out
}

export const generateNeutralVetoClausesForAnchor = (anchor, atoms, options = {}) => {
  const maxVetoAtomsPerClause = Math.max(1, Math.trunc(toNumber(options.maxVetoAtomsPerClause, 3)))
  const maxClauses = Math.max(1, Math.trunc(toNumber(options.maxGeneratedVetoClausesPerAnchor, 5000)))
  const candidates = atoms
    .filter((atom) => !anchor.anchorAtoms.includes(atom.atomId))
    .map((atom) => ({
      ...atom,
      anchorCoverNeg: intersectSorted(anchor.negativeRowIds, atom.matchedRowIds ?? []),
      anchorKillPos: intersectSorted(anchor.positiveRowIds, atom.matchedRowIds ?? []),
    }))
    .filter((atom) => atom.anchorCoverNeg.length > 0)
    .sort((a, b) => b.falsePositiveRowCount - a.falsePositiveRowCount || a.hitRowCount - b.hitRowCount || a.atomId.localeCompare(b.atomId))
  const clauses = []
  for (let size = 1; size <= maxVetoAtomsPerClause; size += 1) {
    const remaining = maxClauses - clauses.length
    if (remaining <= 0) break
    for (const atomGroup of combinations(candidates, size, remaining * 2)) {
      if (clauses.length >= maxClauses) break
      const atomIds = atomGroup.map((atom) => atom.atomId)
      let coverNeg = atomGroup[0]?.anchorCoverNeg ?? []
      let killPos = atomGroup[0]?.anchorKillPos ?? []
      for (const atom of atomGroup.slice(1)) {
        coverNeg = intersectSorted(coverNeg, atom.anchorCoverNeg)
        if (coverNeg.length < 1) break
        killPos = intersectSorted(killPos, atom.anchorKillPos)
      }
      if (coverNeg.length < 1) continue
      const risk = size === 1 && atomGroup[0]?.family === "candle_shape" ? "high" : size === 1 ? "medium_high" : "medium"
      clauses.push({
        clauseId: `sha256:${sha256(JSON.stringify({ anchorId: anchor.anchorId, atomIds })).slice(0, 32)}`,
        atoms: atomIds,
        featureFamilies: [...new Set(atomGroup.map((atom) => toText(atom.family)).filter(Boolean))].sort(),
        coverNeg,
        killPos,
        coverNegCount: coverNeg.length,
        killPosCount: killPos.length,
        risk,
      })
    }
  }
  clauses.sort((a, b) => b.coverNegCount - a.coverNegCount || a.killPosCount - b.killPosCount || a.atoms.length - b.atoms.length)
  return pruneDominatedClauses(clauses)
}

const pruneDominatedClauses = (clauses) => {
  if (clauses.length > CLAUSE_DOMINANCE_PRUNE_LIMIT) {
    return clauses.slice(0, CLAUSE_DOMINANCE_PRUNE_LIMIT)
  }
  const kept = []
  for (const clause of clauses) {
    const clauseKillSet = new Set(clause.killPos)
    const dominated = kept.some((other) => {
      const coverSuperset = clause.coverNeg.every((rowId) => other._coverSet.has(rowId))
      if (!coverSuperset) return false
      const killSubset = other.killPos.every((rowId) => clauseKillSet.has(rowId))
      return killSubset && other.atoms.length <= clause.atoms.length
    })
    if (!dominated) {
      kept.push({
        ...clause,
        _coverSet: new Set(clause.coverNeg),
        _killSet: new Set(clause.killPos),
      })
    }
  }
  return kept.map(({ _coverSet, _killSet, ...row }) => row)
}

const retainedPasses = (retainedRows, eventRows, target) => {
  const byYearDates = new Map()
  const byYearSymbolDates = new Map()
  for (const rowId of retainedRows) {
    const row = eventRows[rowId]
    if (!row?.hitTarget) continue
    const year = String(row.year)
    if (!byYearDates.has(year)) byYearDates.set(year, new Set())
    if (!byYearSymbolDates.has(year)) byYearSymbolDates.set(year, new Set())
    byYearDates.get(year).add(row.decisionDateKey)
    byYearSymbolDates.get(year).add(`${row.symbol}::${row.decisionDateKey}`)
  }
  const positiveSymbolDates = [...byYearSymbolDates.values()].reduce((sum, set) => sum + set.size, 0)
  if (positiveSymbolDates < target.minTotalPositiveSymbolDates) return false
  for (const year of [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]) {
    if ((byYearDates.get(String(year))?.size ?? 0) < target.minHitDecisionDatesPerYear) return false
    if ((byYearSymbolDates.get(String(year))?.size ?? 0) < target.minHitSymbolDatesPerYear) return false
  }
  return true
}

export const solveNeutralVetoSetCoverForAnchor = (anchor, vetoClauses, options = {}) => {
  const maxVetoClauses = Math.max(0, Math.trunc(toNumber(options.maxVetoClauses, 4)))
  const maxVisitedStates = Math.max(1, Math.trunc(toNumber(options.maxVisitedStates, 20000)))
  const eventRows = options.eventRows ?? []
  const target = options.target
  const uncoveredInitial = new Set(anchor.negativeRowIds)
  let visitedStateCount = 0
  let best = null
  let capReached = false

  const dfs = (startIndex, selected, uncovered, killedPosSet) => {
    visitedStateCount += 1
    if (visitedStateCount > maxVisitedStates) {
      capReached = true
      return
    }
    if (uncovered.size === 0) {
      const retainedPos = anchor.positiveRowIds.filter((rowId) => !killedPosSet.has(rowId))
      if (!target || retainedPasses(retainedPos, eventRows, target)) {
        const candidate = {
          clauses: [...selected],
          retainedPositiveRowIds: retainedPos,
          killedPositiveRowIds: [...killedPosSet].sort((a, b) => a - b),
          score: retainedPos.length * 1000 - selected.length,
        }
        if (!best || candidate.score > best.score) best = candidate
      }
      return
    }
    if (selected.length >= maxVetoClauses) return
    const remainingCapacity = maxVetoClauses - selected.length
    const remainingCoverage = new Set()
    for (let index = startIndex; index < vetoClauses.length; index += 1) {
      for (const rowId of vetoClauses[index].coverNeg) remainingCoverage.add(rowId)
    }
    for (const rowId of uncovered) {
      if (!remainingCoverage.has(rowId)) return
    }
    for (let index = startIndex; index < vetoClauses.length; index += 1) {
      const clause = vetoClauses[index]
      const coversAny = clause.coverNeg.some((rowId) => uncovered.has(rowId))
      if (!coversAny) continue
      const nextKilled = new Set(killedPosSet)
      for (const rowId of clause.killPos) nextKilled.add(rowId)
      if (target) {
        const retainedPos = anchor.positiveRowIds.filter((rowId) => !nextKilled.has(rowId))
        if (!retainedPasses(retainedPos, eventRows, target)) continue
      }
      const nextUncovered = new Set(uncovered)
      for (const rowId of clause.coverNeg) nextUncovered.delete(rowId)
      if (nextUncovered.size > 0 && remainingCapacity <= 1) continue
      dfs(index + 1, [...selected, clause], nextUncovered, nextKilled)
      if (capReached) return
    }
  }

  dfs(0, [], uncoveredInitial, new Set())
  return {
    status: best ? "found" : capReached ? "incomplete" : "not_found",
    capReached,
    visitedStateCount,
    selectedClauses: best?.clauses ?? [],
    retainedPositiveRowIds: best?.retainedPositiveRowIds ?? [],
    killedPositiveRowIds: best?.killedPositiveRowIds ?? [],
    uncoveredNegativeCount: best ? 0 : uncoveredInitial.size,
  }
}
