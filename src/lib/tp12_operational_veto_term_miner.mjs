import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  dateYear,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const ruleHash = ({ parentPatternId, requireTerms, vetoTerms }) =>
  createHash("sha256")
    .update(`${toText(parentPatternId)}|${uniqueSorted(requireTerms).join(",")}|${uniqueSorted(vetoTerms).join(",")}`)
    .digest("hex")
    .slice(0, 16)

const normalizeYears = (value) => {
  if (!Array.isArray(value)) throw new Error("vetoMining.coreYears must be an array")
  const years = value.map((item) => Number(item)).filter((item) => Number.isInteger(item))
  if (years.length < 1) throw new Error("vetoMining.coreYears is empty")
  return years
}

const getGroup = (groups, patternId, baseTokenSet = []) => {
  const key = toText(patternId)
  if (!key) throw new Error("support row missing patternId")
  if (!groups.has(key)) groups.set(key, { patternId: key, baseTokenSet, rows: [] })
  const group = groups.get(key)
  if (group.baseTokenSet.length < 1 && baseTokenSet.length > 0) group.baseTokenSet = baseTokenSet
  return group
}

const supportRowToMemory = (row) => ({
  symbol: toText(row?.symbol),
  decisionDateKey: toText(row?.decisionDateKey),
  year: Number(row?.year ?? dateYear(row?.decisionDateKey)),
  hit: row?.operationalHitTarget === true,
  microTerms: new Set((row?.microTerms ?? []).map(toText).filter(Boolean)),
})

const hasAll = (set, terms) => terms.every((term) => set.has(term))
const hasAny = (set, terms) => terms.some((term) => set.has(term))

export const evaluateTp12OperationalSeedRule = ({ rows, requireTerms = [], vetoTerms = [], coreYears, minHitsPerYear }) => {
  const yearHitDates = new Map()
  const hitSymbols = new Set()
  let matchRows = 0
  let hitRows = 0
  let falsePositiveRows = 0
  for (const row of rows) {
    if (!hasAll(row.microTerms, requireTerms)) continue
    if (hasAny(row.microTerms, vetoTerms)) continue
    matchRows += 1
    if (row.hit) {
      hitRows += 1
      hitSymbols.add(row.symbol)
      const year = String(row.year)
      if (!yearHitDates.has(year)) yearHitDates.set(year, new Set())
      yearHitDates.get(year).add(row.decisionDateKey)
    } else {
      falsePositiveRows += 1
    }
  }
  const yearHitCounts = {}
  const yearHitDateLists = {}
  const belowMinYears = []
  for (const year of coreYears) {
    const dates = [...(yearHitDates.get(String(year)) ?? new Set())].sort()
    yearHitCounts[String(year)] = dates.length
    yearHitDateLists[String(year)] = dates
    if (dates.length < minHitsPerYear) belowMinYears.push(year)
  }
  return {
    matchRows,
    hitRows,
    falsePositiveRows,
    rowPrecision: matchRows > 0 ? hitRows / matchRows : 0,
    uniqueHitSymbols: hitSymbols.size,
    minYearHitDates: Math.min(...Object.values(yearHitCounts)),
    yearHitCounts,
    yearHitDates: yearHitDateLists,
    belowMinYears,
  }
}

const addTermStat = (stats, term, row) => {
  if (!stats.has(term)) {
    stats.set(term, {
      term,
      rows: 0,
      hits: 0,
      misses: 0,
      years: new Map(),
    })
  }
  const item = stats.get(term)
  item.rows += 1
  if (row.hit) {
    item.hits += 1
    const year = String(row.year)
    if (!item.years.has(year)) item.years.set(year, new Set())
    item.years.get(year).add(row.decisionDateKey)
  } else {
    item.misses += 1
  }
}

const buildTermStats = (rows) => {
  const stats = new Map()
  for (const row of rows) {
    for (const term of row.microTerms) addTermStat(stats, term, row)
  }
  return stats
}

const minYearHitsForTerm = (termStat, coreYears) =>
  Math.min(...coreYears.map((year) => (termStat.years.get(String(year)) ?? new Set()).size))

const topRequireTerms = ({ stats, coreYears, minHitsPerYear, limit }) =>
  [...stats.values()]
    .filter((item) => item.hits > 0 && minYearHitsForTerm(item, coreYears) >= Math.min(1, minHitsPerYear))
    .sort((left, right) => {
      const leftPrecision = left.rows > 0 ? left.hits / left.rows : 0
      const rightPrecision = right.rows > 0 ? right.hits / right.rows : 0
      return rightPrecision - leftPrecision || right.hits - left.hits || left.misses - right.misses || left.term.localeCompare(right.term)
    })
    .slice(0, limit)
    .map((item) => item.term)

const topVetoTerms = ({ stats, limit }) =>
  [...stats.values()]
    .filter((item) => item.misses > 0)
    .sort((left, right) => {
      const leftScore = left.misses - left.hits * 2
      const rightScore = right.misses - right.hits * 2
      return rightScore - leftScore || right.misses - left.misses || left.hits - right.hits || left.term.localeCompare(right.term)
    })
    .slice(0, limit)
    .map((item) => item.term)

function* combinations(items, maxSize) {
  yield []
  if (maxSize >= 1) {
    for (const item of items) yield [item]
  }
  if (maxSize >= 2) {
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) yield [items[left], items[right]]
    }
  }
}

const buildRequireMissCoverageContext = ({ rows, requireTerms, vetoTerms }) => {
  const vetoSet = new Set(vetoTerms)
  const missTermMasks = new Map()
  let allMissMask = 0n
  let missCount = 0
  for (const row of rows) {
    if (!hasAll(row.microTerms, requireTerms)) continue
    if (row.hit) continue
    const bit = 1n << BigInt(missCount)
    allMissMask |= bit
    for (const term of row.microTerms) {
      if (!vetoSet.has(term)) continue
      missTermMasks.set(term, (missTermMasks.get(term) ?? 0n) | bit)
    }
    missCount += 1
  }
  return { allMissMask, missCount, missTermMasks }
}

const buildTermRowIndex = (rows) => {
  const allIndexes = rows.map((_, index) => index)
  const termIndexes = new Map()
  for (const [index, row] of rows.entries()) {
    for (const term of row.microTerms) {
      const list = termIndexes.get(term) ?? []
      list.push(index)
      termIndexes.set(term, list)
    }
  }
  return { allIndexes, termIndexes }
}

const intersectSortedIndexes = (left, right) => {
  const out = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex]
    const rightValue = right[rightIndex]
    if (leftValue === rightValue) {
      out.push(leftValue)
      leftIndex += 1
      rightIndex += 1
    } else if (leftValue < rightValue) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }
  return out
}

const resolveRequireIndexes = ({ requireTerms, allIndexes, termIndexes }) => {
  if (requireTerms.length < 1) return allIndexes
  const first = termIndexes.get(requireTerms[0]) ?? []
  if (requireTerms.length === 1) return first
  return intersectSortedIndexes(first, termIndexes.get(requireTerms[1]) ?? [])
}

const buildVetoPairIndex = (vetoTerms) => {
  const pairs = []
  const pairBitByKey = new Map()
  for (let left = 0; left < vetoTerms.length; left += 1) {
    for (let right = left + 1; right < vetoTerms.length; right += 1) {
      const pairIndex = pairs.length
      const pair = {
        leftTerm: vetoTerms[left],
        rightTerm: vetoTerms[right],
        mask: (2 ** left) | (2 ** right),
        bit: 1n << BigInt(pairIndex),
      }
      pairs.push(pair)
      pairBitByKey.set(`${pair.leftTerm}\u0000${pair.rightTerm}`, pair.bit)
    }
  }
  const allPairMask = pairs.length > 0 ? (1n << BigInt(pairs.length)) - 1n : 0n
  const allowedPairMaskCache = new Map()
  const allowedPairMaskForMissMask = (missMask) => {
    if (allowedPairMaskCache.has(missMask)) return allowedPairMaskCache.get(missMask)
    let out = 0n
    for (const pair of pairs) {
      if ((missMask & pair.mask) !== 0) out |= pair.bit
    }
    allowedPairMaskCache.set(missMask, out)
    return out
  }
  return { pairs, pairBitByKey, allPairMask, allowedPairMaskForMissMask }
}

const buildRequireMissCoverageContextFromIndexes = ({ rows, requireIndexes, vetoTerms, pairIndex }) => {
  const vetoTermBits = new Map()
  for (const [index, term] of vetoTerms.entries()) vetoTermBits.set(term, 2 ** index)
  const allSingleMask = vetoTerms.length > 0 ? 2 ** vetoTerms.length - 1 : 0
  let singleCoverMask = allSingleMask
  let pairCoverMask = pairIndex.allPairMask
  let missCount = 0
  for (const rowIndex of requireIndexes) {
    const row = rows[rowIndex]
    if (!row || row.hit) continue
    let mask = 0
    for (const term of row.microTerms) {
      const bit = vetoTermBits.get(term)
      if (bit !== undefined) mask |= bit
    }
    singleCoverMask &= mask
    pairCoverMask &= pairIndex.allowedPairMaskForMissMask(mask)
    missCount += 1
  }
  return { missCount, singleCoverMask, pairCoverMask, vetoTermBits }
}

const addAcceptedRule = ({ accepted, group, requireCombo, vetoCombo, options }) => {
  const metrics = evaluateTp12OperationalSeedRule({
    rows: group.rows,
    requireTerms: requireCombo,
    vetoTerms: vetoCombo,
    coreYears: options.coreYears,
    minHitsPerYear: options.minHitsPerYear,
  })
  if (metrics.falsePositiveRows > options.maxFalsePositiveRows) return
  if (metrics.rowPrecision < options.requiredRowPrecision) return
  if (metrics.hitRows < options.minRuleHitRows) return
  if (metrics.uniqueHitSymbols < options.minUniqueHitSymbols) return
  if (metrics.belowMinYears.length > 0) return
  accepted.push({
    kind: "tp12_operational_veto_seed_candidate_v1",
    patternId: `opveto_${ruleHash({
      parentPatternId: group.patternId,
      requireTerms: requireCombo,
      vetoTerms: vetoCombo,
    })}`,
    parentPatternId: group.patternId,
    baseTokenSet: group.baseTokenSet,
    requireMicroTerms: uniqueSorted(requireCombo),
    vetoMicroTerms: uniqueSorted(vetoCombo),
    status: "operational100_year2hit_passed",
    ...metrics,
  })
}

const candidateRuleRows = ({ group, options }) => {
  const stats = buildTermStats(group.rows)
  const requireTerms = topRequireTerms({
    stats,
    coreYears: options.coreYears,
    minHitsPerYear: options.minHitsPerYear,
    limit: options.topRequireTermsPerPattern,
  })
  const vetoTerms = topVetoTerms({ stats, limit: options.topVetoTermsPerPattern })
  const accepted = []
  const seen = new Set()
  const { allIndexes, termIndexes } = buildTermRowIndex(group.rows)
  const pairIndex = buildVetoPairIndex(vetoTerms)
  let evaluated = 0
  const bumpEvaluated = () => {
    evaluated += 1
    if (options.failOnSearchBudgetExceeded && evaluated > options.maxRuleEvaluationsPerPattern) {
      throw new Error(`rule search budget exceeded for ${group.patternId}: ${evaluated}`)
    }
  }
  for (const requireCombo of combinations(requireTerms, options.maxRequireTerms)) {
    const requireIndexes = resolveRequireIndexes({ requireTerms: requireCombo, allIndexes, termIndexes })
    const context = buildRequireMissCoverageContextFromIndexes({ rows: group.rows, requireIndexes, vetoTerms, pairIndex })
    const vetoCombosToVerify = []
    const emptyKey = `${requireCombo.join(",")}::`
    if (!seen.has(emptyKey)) {
      seen.add(emptyKey)
      bumpEvaluated()
      if (context.missCount === 0) vetoCombosToVerify.push([])
    }
    if (context.missCount > 0 && options.maxVetoTerms >= 1) {
      for (const term of vetoTerms) {
        const vetoCombo = [term]
        const key = `${requireCombo.join(",")}::${vetoCombo.join(",")}`
        if (seen.has(key)) continue
        seen.add(key)
        bumpEvaluated()
        if (((context.singleCoverMask & (context.vetoTermBits.get(term) ?? 0)) !== 0)) vetoCombosToVerify.push(vetoCombo)
      }
    }
    if (context.missCount > 0 && options.maxVetoTerms >= 2) {
      for (let left = 0; left < vetoTerms.length; left += 1) {
        const leftMask = context.vetoTermBits.get(vetoTerms[left]) ?? 0
        if (leftMask === 0) continue
        for (let right = left + 1; right < vetoTerms.length; right += 1) {
          const vetoCombo = [vetoTerms[left], vetoTerms[right]]
          const key = `${requireCombo.join(",")}::${vetoCombo.join(",")}`
          if (seen.has(key)) continue
          seen.add(key)
          bumpEvaluated()
          const pairBit = pairIndex.pairBitByKey.get(`${vetoCombo[0]}\u0000${vetoCombo[1]}`) ?? 0n
          if ((context.pairCoverMask & pairBit) !== 0n) vetoCombosToVerify.push(vetoCombo)
        }
      }
    }
    for (const vetoCombo of vetoCombosToVerify) {
      const key = `${requireCombo.join(",")}::${vetoCombo.join(",")}`
      addAcceptedRule({
        accepted,
        group,
        requireCombo,
        vetoCombo,
        options,
      })
    }
  }
  accepted.sort(
    (left, right) =>
      left.vetoMicroTerms.length +
        left.requireMicroTerms.length -
        (right.vetoMicroTerms.length + right.requireMicroTerms.length) ||
      right.hitRows - left.hitRows ||
      left.matchRows - right.matchRows ||
      left.patternId.localeCompare(right.patternId),
  )
  return {
    accepted,
    evaluated,
    requireTermCount: requireTerms.length,
    vetoTermCount: vetoTerms.length,
  }
}

const resolveOptions = (contract) => {
  const config = contract.vetoMining ?? {}
  return {
    coreYears: normalizeYears(config.coreYears),
    minHitsPerYear: Math.max(1, Math.trunc(toNumber(config.minHitsPerYear, 2))),
    maxFalsePositiveRows: Math.max(0, Math.trunc(toNumber(config.maxFalsePositiveRows, 0))),
    requiredRowPrecision: toNumber(config.requiredRowPrecision, 1),
    maxRequireTerms: Math.max(0, Math.min(2, Math.trunc(toNumber(config.maxRequireTerms, 2)))),
    maxVetoTerms: Math.max(0, Math.min(2, Math.trunc(toNumber(config.maxVetoTerms, 2)))),
    topRequireTermsPerPattern: Math.max(1, Math.trunc(toNumber(config.topRequireTermsPerPattern, 24))),
    topVetoTermsPerPattern: Math.max(1, Math.min(30, Math.trunc(toNumber(config.topVetoTermsPerPattern, 30)))),
    minRuleHitRows: Math.max(1, Math.trunc(toNumber(config.minRuleHitRows, 1))),
    minUniqueHitSymbols: Math.max(1, Math.trunc(toNumber(config.minUniqueHitSymbols, 1))),
    maxRuleEvaluationsPerPattern: Math.max(1, Math.trunc(toNumber(config.maxRuleEvaluationsPerPattern, 20000))),
    failOnSearchBudgetExceeded: toBool(config.failOnSearchBudgetExceeded, true),
    failOnZeroVerifiedSeeds: toBool(config.failOnZeroVerifiedSeeds, false),
  }
}

export const mineTp12OperationalVetoSeedCandidates = async ({
  contractPath,
  supportRowsPath,
  outCandidatesPath,
  outSummaryPath,
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  if (!toText(supportRowsPath)) throw new Error("supportRowsPath is required")
  if (!toText(outCandidatesPath)) throw new Error("outCandidatesPath is required")
  if (!fs.existsSync(supportRowsPath)) throw new Error(`supportRowsPath not found: ${supportRowsPath}`)
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract file not found: ${contractPath}`)
  const options = resolveOptions(contract)
  const groups = new Map()
  let supportRows = 0
  let hitRows = 0
  let missRows = 0
  await iterateJsonlMaybeGzip(supportRowsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`support row missing patternId at ${context.filePath}:${context.lineNumber}`)
      const memoryRow = supportRowToMemory(row)
      if (!memoryRow.decisionDateKey || !memoryRow.symbol) {
        throw new Error(`support row missing symbol/date at ${context.filePath}:${context.lineNumber}`)
      }
      const group = getGroup(groups, patternId, row?.baseTokenSet ?? [])
      group.rows.push(memoryRow)
      supportRows += 1
      if (memoryRow.hit) hitRows += 1
      else missRows += 1
    },
  })
  await ensureDir(path.dirname(outCandidatesPath))
  const stream = fs.createWriteStream(outCandidatesPath, { encoding: "utf8" })
  const patternSummaries = []
  let acceptedCount = 0
  let evaluatedRuleCount = 0
  try {
    for (const group of groups.values()) {
      const result = candidateRuleRows({ group, options })
      evaluatedRuleCount += result.evaluated
      acceptedCount += result.accepted.length
      patternSummaries.push({
        patternId: group.patternId,
        rows: group.rows.length,
        hits: group.rows.filter((row) => row.hit).length,
        misses: group.rows.filter((row) => !row.hit).length,
        requireTermCount: result.requireTermCount,
        vetoTermCount: result.vetoTermCount,
        evaluatedRules: result.evaluated,
        acceptedRules: result.accepted.length,
      })
      for (const row of result.accepted) await writeJsonlRow(stream, row)
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(resolve)
    })
  }
  const summary = {
    kind: "tp12_operational_veto_seed_mining_summary_v1",
    contractId: contract.contractId,
    patchKey: contract.patchKey,
    supportRowsPath,
    outCandidatesPath,
    supportRows,
    hitRows,
    missRows,
    patternCount: groups.size,
    evaluatedRuleCount,
    acceptedCount,
    patternSummaries: patternSummaries.sort((left, right) => right.acceptedRules - left.acceptedRules || left.misses - right.misses),
  }
  if (toText(outSummaryPath)) await writeJson(outSummaryPath, summary)
  return { summary }
}

export const verifyTp12OperationalVetoSeeds = async ({
  contractPath,
  supportRowsPath,
  candidatesPath,
  outVerifiedPath,
  outSummaryPath,
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  if (!toText(supportRowsPath)) throw new Error("supportRowsPath is required")
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  if (!toText(outVerifiedPath)) throw new Error("outVerifiedPath is required")
  if (!fs.existsSync(supportRowsPath)) throw new Error(`supportRowsPath not found: ${supportRowsPath}`)
  if (!fs.existsSync(candidatesPath)) throw new Error(`candidatesPath not found: ${candidatesPath}`)
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract file not found: ${contractPath}`)
  const options = resolveOptions(contract)
  const groups = new Map()
  await iterateJsonlMaybeGzip(supportRowsPath, {
    strict: true,
    onRow: async (row) => {
      getGroup(groups, row?.patternId, row?.baseTokenSet ?? []).rows.push(supportRowToMemory(row))
    },
  })
  const candidates = []
  await iterateJsonlMaybeGzip(candidatesPath, {
    strict: true,
    onRow: async (row) => candidates.push(row),
  })
  await ensureDir(path.dirname(outVerifiedPath))
  const stream = fs.createWriteStream(outVerifiedPath, { encoding: "utf8" })
  let verifiedCount = 0
  const rejectReasons = new Map()
  try {
    for (const candidate of candidates) {
      const parentPatternId = toText(candidate?.parentPatternId)
      const group = groups.get(parentPatternId)
      if (!group) throw new Error(`candidate parent support missing: ${parentPatternId}`)
      const metrics = evaluateTp12OperationalSeedRule({
        rows: group.rows,
        requireTerms: candidate.requireMicroTerms ?? [],
        vetoTerms: candidate.vetoMicroTerms ?? [],
        coreYears: options.coreYears,
        minHitsPerYear: options.minHitsPerYear,
      })
      const reasons = []
      if (metrics.falsePositiveRows > options.maxFalsePositiveRows) reasons.push("false_positive_rows_above_max")
      if (metrics.rowPrecision < options.requiredRowPrecision) reasons.push("row_precision_below_required")
      if (metrics.belowMinYears.length > 0) reasons.push("below_min_year_hits")
      if (metrics.hitRows < options.minRuleHitRows) reasons.push("hit_rows_below_min")
      if (metrics.uniqueHitSymbols < options.minUniqueHitSymbols) reasons.push("unique_hit_symbols_below_min")
      if (reasons.length > 0) {
        for (const reason of reasons) incrementMap(rejectReasons, reason)
        continue
      }
      verifiedCount += 1
      await writeJsonlRow(stream, {
        ...candidate,
        kind: "tp12_verified_operational100_seed_v1",
        verificationStatus: "verified",
        ...metrics,
      })
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(resolve)
    })
  }
  const summary = {
    kind: "tp12_verified_operational100_seed_summary_v1",
    contractId: contract.contractId,
    patchKey: contract.patchKey,
    supportRowsPath,
    candidatesPath,
    outVerifiedPath,
    inputCandidateCount: candidates.length,
    verifiedOperational100SeedCount: verifiedCount,
    rejectReasons: mapToSortedObject(rejectReasons),
    status: verifiedCount > 0 ? "passed" : "zero_verified_operational100_seed",
  }
  if (toText(outSummaryPath)) await writeJson(outSummaryPath, summary)
  if (options.failOnZeroVerifiedSeeds && verifiedCount < 1) {
    throw new Error("zero verified operational100 year2hit seeds")
  }
  return { summary }
}
