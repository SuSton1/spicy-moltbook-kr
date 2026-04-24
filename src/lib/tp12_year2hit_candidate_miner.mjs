import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

import { ensureDir, writeJson } from "./io.mjs"
import {
  deriveTp12Year2hitGateOptionsFromContract,
} from "./tp12_year2hit_train_gate.mjs"
import { loadTp12Contract } from "./tp12_label_event_builder.mjs"
import {
  dateYear,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const stablePatternId = (tokens) =>
  `tp12_y2h_${createHash("sha256").update(tokens.join("\n")).digest("hex").slice(0, 16)}`

const supportRowHash = () => {
  const hash = createHash("sha256")
  return {
    add(decisionDateKey, symbol) {
      hash.update(decisionDateKey)
      hash.update("\t")
      hash.update(symbol)
      hash.update("\n")
    },
    digest() {
      return hash.digest("hex")
    },
  }
}

const normalizeYears = ({ coreYears, coreYearFrom = 2016, coreYearTo = 2024 }) => {
  if (Array.isArray(coreYears) && coreYears.length > 0) {
    return [...new Set(coreYears.map((year) => Number(year)).filter((year) => Number.isInteger(year)))].sort(
      (a, b) => a - b,
    )
  }
  const years = []
  for (let year = Number(coreYearFrom); year <= Number(coreYearTo); year += 1) years.push(year)
  return years
}

export const deriveTp12CandidateMiningOptionsFromContract = (contract = {}) => {
  const gate = deriveTp12Year2hitGateOptionsFromContract(contract)
  const mining = contract.candidateMining ?? {}
  const quality = contract.qualityGate ?? {}
  return {
    trainDateFrom: gate.trainDateFrom,
    trainDateTo: gate.trainDateTo,
    coreYears: gate.coreYears,
    minHitsPerYear: gate.minHitsPerYear,
    maxPatternSize: mining.maxPatternSize,
    minSeedHitRows: mining.minSeedHitRows,
    minSeedMatchRows: mining.minSeedMatchRows,
    minSeedPrecision: mining.minSeedPrecision,
    maxTokensPerPositiveEvent: mining.maxTokensPerPositiveEvent,
    maxPairCandidates: mining.maxPairCandidates,
    beamWidthPerSize: mining.beamWidthPerSize,
    maxExtensionsPerParent: mining.maxExtensionsPerParent,
    minCandidatePrecision: mining.minCandidatePrecision,
    minCandidateDatePrecision: mining.minCandidateDatePrecision ?? quality.minDatePrecision,
    minCandidateHitRows: mining.minCandidateHitRows ?? quality.minHitRows,
    minCandidateHitDates: mining.minCandidateHitDates ?? quality.minUniqueHitDates,
    maxTop1HitDateShare: mining.maxTop1HitDateShare,
    maxTop1MatchDateShare: mining.maxTop1MatchDateShare ?? quality.maxTop1MatchDateShare,
    maxCandidateMatchRows: mining.maxCandidateMatchRows ?? quality.maxMatchRows,
    minUniqueHitSymbols: mining.minUniqueHitSymbols,
    hitField: mining.hitField,
    requiredTrainPrecision: mining.requiredTrainPrecision,
    maxFalsePositiveRows: mining.maxFalsePositiveRows,
    maxNonExecutableRows: mining.maxNonExecutableRows,
    maxEvaluatedCandidates: mining.maxEvaluatedCandidates,
    failOnZeroOperational100Seed: mining.failOnZeroOperational100Seed,
    lockedFutureFrom: mining.lockedFutureFrom,
    failOnForbiddenFutureRows: mining.failOnForbiddenFutureRows,
    earlyDedupe: mining.earlyDedupe,
    emitRejected: mining.emitRejected,
  }
}

const resolveOptions = ({
  contract,
  trainDateFrom,
  trainDateTo,
  coreYears,
  minHitsPerYear,
  maxPatternSize,
  minSeedHitRows,
  minSeedMatchRows,
  minSeedPrecision,
  maxTokensPerPositiveEvent,
  maxPairCandidates,
  beamWidthPerSize,
  maxExtensionsPerParent,
  minCandidatePrecision,
  minCandidateDatePrecision,
  minCandidateHitRows,
  minCandidateHitDates,
  maxTop1HitDateShare,
  maxTop1MatchDateShare,
  maxCandidateMatchRows,
  minUniqueHitSymbols,
  hitField,
  requiredTrainPrecision,
  maxFalsePositiveRows,
  maxNonExecutableRows,
  maxEvaluatedCandidates,
  failOnZeroOperational100Seed,
  lockedFutureFrom,
  failOnForbiddenFutureRows,
  earlyDedupe,
  emitRejected,
}) => {
  const contractOptions = contract ? deriveTp12CandidateMiningOptionsFromContract(contract) : {}
  const from = toText(trainDateFrom ?? contractOptions.trainDateFrom)
  const to = toText(trainDateTo ?? contractOptions.trainDateTo)
  if (!validDateKey(from) || !validDateKey(to) || from > to) throw new Error(`invalid train date range: ${from}..${to}`)
  const years = normalizeYears({ coreYears: coreYears ?? contractOptions.coreYears })
  if (years.length < 1) throw new Error("at least one core year is required")
  const minHits = Number(minHitsPerYear ?? contractOptions.minHitsPerYear ?? 2)
  if (!Number.isInteger(minHits) || minHits < 1) throw new Error(`minHitsPerYear must be positive integer: ${minHits}`)
  const patternSize = Number(maxPatternSize ?? contractOptions.maxPatternSize ?? 3)
  if (!Number.isInteger(patternSize) || patternSize < 1) throw new Error(`maxPatternSize must be positive integer: ${patternSize}`)
  const resolvedHitField = toText(hitField ?? contractOptions.hitField ?? "hitTarget")
  if (!resolvedHitField) throw new Error("hitField is required")
  const resolvedLockedFutureFrom = toText(lockedFutureFrom ?? contractOptions.lockedFutureFrom)
  if (resolvedLockedFutureFrom && !validDateKey(resolvedLockedFutureFrom)) {
    throw new Error(`invalid lockedFutureFrom: ${resolvedLockedFutureFrom}`)
  }
  return {
    trainDateFrom: from,
    trainDateTo: to,
    coreYears: years,
    minHitsPerYear: minHits,
    maxPatternSize: patternSize,
    minSeedHitRows: Math.max(1, Number(minSeedHitRows ?? contractOptions.minSeedHitRows ?? minHits * years.length)),
    minSeedMatchRows: Math.max(1, Number(minSeedMatchRows ?? contractOptions.minSeedMatchRows ?? minHits * years.length)),
    minSeedPrecision: Math.max(0, Number(minSeedPrecision ?? contractOptions.minSeedPrecision ?? 0)),
    maxTokensPerPositiveEvent: Math.max(2, Number(maxTokensPerPositiveEvent ?? contractOptions.maxTokensPerPositiveEvent ?? 64)),
    maxPairCandidates: Math.max(1, Number(maxPairCandidates ?? contractOptions.maxPairCandidates ?? 1_000_000)),
    beamWidthPerSize: Math.max(1, Number(beamWidthPerSize ?? contractOptions.beamWidthPerSize ?? 2000)),
    maxExtensionsPerParent: Math.max(1, Number(maxExtensionsPerParent ?? contractOptions.maxExtensionsPerParent ?? 64)),
    minCandidatePrecision: Math.max(0, Number(minCandidatePrecision ?? contractOptions.minCandidatePrecision ?? 0)),
    minCandidateDatePrecision: Math.max(0, Number(minCandidateDatePrecision ?? contractOptions.minCandidateDatePrecision ?? 0)),
    minCandidateHitRows: Math.max(0, Number(minCandidateHitRows ?? contractOptions.minCandidateHitRows ?? 0)),
    minCandidateHitDates: Math.max(0, Number(minCandidateHitDates ?? contractOptions.minCandidateHitDates ?? 0)),
    maxTop1HitDateShare: Math.min(1, Math.max(0, Number(maxTop1HitDateShare ?? contractOptions.maxTop1HitDateShare ?? 1))),
    maxTop1MatchDateShare: Math.min(1, Math.max(0, Number(maxTop1MatchDateShare ?? contractOptions.maxTop1MatchDateShare ?? 1))),
    maxCandidateMatchRows: Math.max(0, Number(maxCandidateMatchRows ?? contractOptions.maxCandidateMatchRows ?? 0)),
    minUniqueHitSymbols: Math.max(0, Number(minUniqueHitSymbols ?? contractOptions.minUniqueHitSymbols ?? 0)),
    hitField: resolvedHitField,
    requiredTrainPrecision: Math.max(0, Number(requiredTrainPrecision ?? contractOptions.requiredTrainPrecision ?? 0)),
    maxFalsePositiveRows: Math.max(
      0,
      Number(maxFalsePositiveRows ?? contractOptions.maxFalsePositiveRows ?? Number.MAX_SAFE_INTEGER),
    ),
    maxNonExecutableRows: Math.max(
      0,
      Number(maxNonExecutableRows ?? contractOptions.maxNonExecutableRows ?? Number.MAX_SAFE_INTEGER),
    ),
    maxEvaluatedCandidates: Math.max(0, Number(maxEvaluatedCandidates ?? contractOptions.maxEvaluatedCandidates ?? 0)),
    failOnZeroOperational100Seed: toBool(failOnZeroOperational100Seed ?? contractOptions.failOnZeroOperational100Seed, false),
    lockedFutureFrom: resolvedLockedFutureFrom,
    failOnForbiddenFutureRows: toBool(failOnForbiddenFutureRows ?? contractOptions.failOnForbiddenFutureRows, true),
    earlyDedupe: {
      enabled: toBool(earlyDedupe?.enabled ?? contractOptions.earlyDedupe?.enabled, false),
      exactSupport: toBool(earlyDedupe?.exactSupport ?? contractOptions.earlyDedupe?.exactSupport, true),
      nearSupportJaccard: Math.min(1, Math.max(0, Number(earlyDedupe?.nearSupportJaccard ?? contractOptions.earlyDedupe?.nearSupportJaccard ?? 0))),
      containment: Math.min(1, Math.max(0, Number(earlyDedupe?.containment ?? contractOptions.earlyDedupe?.containment ?? 0))),
      minContainmentSizeRatio: Math.min(
        1,
        Math.max(0, Number(earlyDedupe?.minContainmentSizeRatio ?? contractOptions.earlyDedupe?.minContainmentSizeRatio ?? 0)),
      ),
    },
    emitRejected: toBool(emitRejected ?? contractOptions.emitRejected, false),
  }
}

const tokenBit = (tokenId) => 1n << BigInt(tokenId)

const getOrCreateId = (lookup, values, value) => {
  const existing = lookup.get(value)
  if (existing !== undefined) return existing
  const id = values.length
  lookup.set(value, id)
  values.push(value)
  return id
}

const readCompactTokenizedDataset = async ({ tokenizedEventsPath, options }) => {
  let inputRowCount = 0
  let outsideTrainRowCount = 0
  let forbiddenFutureRowCount = 0
  let trainEventCount = 0
  let maxDecisionDateSeen = ""
  const tokenIdByToken = new Map()
  const tokenById = []
  const matchCounts = []
  const hitCounts = []
  const hitDatesByTokenYear = []
  const hitSymbolsByToken = []
  const dateIdByDateKey = new Map()
  const dateKeys = []
  const symbolIdBySymbol = new Map()
  const symbols = []
  await iterateJsonlMaybeGzip(tokenizedEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = toText(row?.decisionDateKey)
      if (!symbol) throw new Error(`missing tokenized event symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`invalid tokenized event decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (!maxDecisionDateSeen || decisionDateKey > maxDecisionDateSeen) maxDecisionDateSeen = decisionDateKey
      if (options.lockedFutureFrom && decisionDateKey >= options.lockedFutureFrom) {
        forbiddenFutureRowCount += 1
        if (options.failOnForbiddenFutureRows) {
          throw new Error(
            `forbidden future tuning row at ${context.filePath}:${context.lineNumber}: decisionDateKey=${decisionDateKey} lockedFutureFrom=${options.lockedFutureFrom}`,
          )
        }
      }
      if (decisionDateKey < options.trainDateFrom || decisionDateKey > options.trainDateTo) {
        outsideTrainRowCount += 1
        return
      }
      if (!Object.prototype.hasOwnProperty.call(row, options.hitField)) {
        throw new Error(`tokenized event missing ${options.hitField} at ${context.filePath}:${context.lineNumber}`)
      }
      if (options.hitField === "operationalHitTarget" && !Object.prototype.hasOwnProperty.call(row, "entryExecutable")) {
        throw new Error(`tokenized event missing entryExecutable for operational mining at ${context.filePath}:${context.lineNumber}`)
      }
      const tokens = uniqueSorted(Array.isArray(row?.tokens) ? row.tokens : [])
      if (tokens.length < 1) return
      const year = dateYear(decisionDateKey)
      getOrCreateId(dateIdByDateKey, dateKeys, decisionDateKey)
      getOrCreateId(symbolIdBySymbol, symbols, symbol)
      for (const token of tokens) {
        let tokenId = tokenIdByToken.get(token)
        if (tokenId === undefined) {
          tokenId = tokenById.length
          tokenIdByToken.set(token, tokenId)
          tokenById.push(token)
          matchCounts[tokenId] = 0
          hitCounts[tokenId] = 0
          hitDatesByTokenYear[tokenId] = new Map()
          hitSymbolsByToken[tokenId] = new Set()
        }
        matchCounts[tokenId] += 1
        if (row[options.hitField] === true) {
          hitCounts[tokenId] += 1
          const yearKey = String(year)
          if (!hitDatesByTokenYear[tokenId].has(yearKey)) hitDatesByTokenYear[tokenId].set(yearKey, new Set())
          hitDatesByTokenYear[tokenId].get(yearKey).add(decisionDateKey)
          hitSymbolsByToken[tokenId].add(symbol)
        }
      }
      trainEventCount += 1
    },
  })
  if (tokenById.length > 63) {
    throw new Error(`compact token mask supports at most 63 distinct tokens, got ${tokenById.length}`)
  }
  const tokenMasks = new BigUint64Array(trainEventCount)
  const hitFlags = new Uint8Array(trainEventCount)
  const entryExecutableFlags = new Uint8Array(trainEventCount)
  const yearValues = new Uint16Array(trainEventCount)
  const dateIds = new Uint32Array(trainEventCount)
  const symbolIds = new Uint32Array(trainEventCount)
  const matchIndexArrays = matchCounts.map((count) => new Uint32Array(count))
  const hitIndexArrays = hitCounts.map((count) => new Uint32Array(count))
  const matchOffsets = new Uint32Array(tokenById.length)
  const hitOffsets = new Uint32Array(tokenById.length)
  let eventIndex = 0
  await iterateJsonlMaybeGzip(tokenizedEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = toText(row?.decisionDateKey)
      if (!symbol) throw new Error(`missing tokenized event symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`invalid tokenized event decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (options.lockedFutureFrom && decisionDateKey >= options.lockedFutureFrom && options.failOnForbiddenFutureRows) {
        throw new Error(
          `forbidden future tuning row at ${context.filePath}:${context.lineNumber}: decisionDateKey=${decisionDateKey} lockedFutureFrom=${options.lockedFutureFrom}`,
        )
      }
      if (decisionDateKey < options.trainDateFrom || decisionDateKey > options.trainDateTo) return
      if (!Object.prototype.hasOwnProperty.call(row, options.hitField)) {
        throw new Error(`tokenized event missing ${options.hitField} at ${context.filePath}:${context.lineNumber}`)
      }
      if (options.hitField === "operationalHitTarget" && !Object.prototype.hasOwnProperty.call(row, "entryExecutable")) {
        throw new Error(`tokenized event missing entryExecutable for operational mining at ${context.filePath}:${context.lineNumber}`)
      }
      const tokens = uniqueSorted(Array.isArray(row?.tokens) ? row.tokens : [])
      if (tokens.length < 1) return
      const hitTarget = row[options.hitField] === true
      let mask = 0n
      for (const token of tokens) {
        const tokenId = tokenIdByToken.get(token)
        if (tokenId === undefined) throw new Error(`token disappeared between tokenized dataset passes: ${token}`)
        mask |= tokenBit(tokenId)
        matchIndexArrays[tokenId][matchOffsets[tokenId]] = eventIndex
        matchOffsets[tokenId] += 1
        if (hitTarget) {
          hitIndexArrays[tokenId][hitOffsets[tokenId]] = eventIndex
          hitOffsets[tokenId] += 1
        }
      }
      tokenMasks[eventIndex] = mask
      hitFlags[eventIndex] = hitTarget ? 1 : 0
      entryExecutableFlags[eventIndex] = row.entryExecutable === false ? 0 : 1
      yearValues[eventIndex] = dateYear(decisionDateKey)
      dateIds[eventIndex] = dateIdByDateKey.get(decisionDateKey)
      symbolIds[eventIndex] = symbolIdBySymbol.get(symbol)
      eventIndex += 1
    },
  })
  if (eventIndex !== trainEventCount) {
    throw new Error(`tokenized dataset pass mismatch: first=${trainEventCount} second=${eventIndex}`)
  }
  const postings = new Map()
  for (const [tokenId, token] of tokenById.entries()) {
    postings.set(token, {
      token,
      tokenId,
      bit: tokenBit(tokenId),
      matchIndices: matchIndexArrays[tokenId],
      hitIndices: hitIndexArrays[tokenId],
      hitDatesByYear: hitDatesByTokenYear[tokenId],
      hitSymbols: hitSymbolsByToken[tokenId],
    })
  }
  return {
    dataset: {
      length: trainEventCount,
      tokenMasks,
      hitFlags,
      entryExecutableFlags,
      yearValues,
      dateIds,
      symbolIds,
      dateKeys,
      symbols,
      tokenById,
      tokenIdByToken,
    },
    postings,
    inputRowCount,
    outsideTrainRowCount,
    forbiddenFutureRowCount,
    maxDecisionDateSeen,
  }
}

const intersectsSorted = (left, right) => {
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const a = left[i]
    const b = right[j]
    if (a === b) {
      out.push(a)
      i += 1
      j += 1
    } else if (a < b) {
      i += 1
    } else {
      j += 1
    }
  }
  return out
}

const intersectPostings = ({ tokens, postings, field = "matchIndices" }) => {
  const entries = tokens.map((token) => postings.get(token)).filter(Boolean)
  if (entries.length !== tokens.length) return []
  entries.sort((left, right) => left[field].length - right[field].length || left.token.localeCompare(right.token))
  let support = entries[0][field]
  for (let index = 1; index < entries.length; index += 1) {
    support = intersectsSorted(support, entries[index][field])
    if (support.length < 1) break
  }
  return support
}

const supportMetrics = ({ tokens, supportIndices, dataset, options, patternKind }) => {
  const yearHitDates = new Map()
  const matchedDates = new Set()
  const hitDates = new Set()
  const matchedSymbols = new Set()
  const hitSymbols = new Set()
  const matchRowsByDate = new Map()
  const hitRowsByDate = new Map()
  const supportHash = supportRowHash()
  const positiveSupportHash = supportRowHash()
  let hitRows = 0
  let nonExecutableRows = 0
  for (const index of supportIndices) {
    const decisionDateKey = dataset.dateKeys[dataset.dateIds[index]]
    const symbol = dataset.symbols[dataset.symbolIds[index]]
    supportHash.add(decisionDateKey, symbol)
    matchedDates.add(decisionDateKey)
    matchedSymbols.add(symbol)
    incrementMap(matchRowsByDate, decisionDateKey)
    if (dataset.entryExecutableFlags[index] === 0) nonExecutableRows += 1
    if (dataset.hitFlags[index] === 1) {
      hitRows += 1
      positiveSupportHash.add(decisionDateKey, symbol)
      hitDates.add(decisionDateKey)
      hitSymbols.add(symbol)
      incrementMap(hitRowsByDate, decisionDateKey)
      const year = String(dataset.yearValues[index])
      if (!yearHitDates.has(year)) yearHitDates.set(year, new Set())
      yearHitDates.get(year).add(decisionDateKey)
    }
  }
  const yearHitCounts = {}
  const yearHitDateLists = {}
  const belowMinYears = []
  for (const year of options.coreYears) {
    const dates = [...(yearHitDates.get(String(year)) ?? new Set())].sort()
    yearHitCounts[String(year)] = dates.length
    yearHitDateLists[String(year)] = dates
    if (dates.length < options.minHitsPerYear) belowMinYears.push(year)
  }
  const matchRows = supportIndices.length
  const falsePositiveRows = matchRows - hitRows
  const rowPrecision = matchRows > 0 ? hitRows / matchRows : 0
  const matchedDateCount = matchedDates.size
  const hitDateCount = hitDates.size
  const datePrecision = matchedDateCount > 0 ? hitDateCount / matchedDateCount : 0
  const top1HitDateShare = hitRows > 0 ? Math.max(0, ...hitRowsByDate.values()) / hitRows : 0
  const top1MatchDateShare = matchRows > 0 ? Math.max(0, ...matchRowsByDate.values()) / matchRows : 0
  const year2hitPassed = belowMinYears.length === 0
  const qualityRejectReasons = []
  if (rowPrecision < options.minCandidatePrecision) qualityRejectReasons.push("row_precision_below_min")
  if (rowPrecision < options.requiredTrainPrecision) qualityRejectReasons.push("train_precision_below_required")
  if (falsePositiveRows > options.maxFalsePositiveRows) qualityRejectReasons.push("false_positive_rows_above_max")
  if (nonExecutableRows > options.maxNonExecutableRows) qualityRejectReasons.push("non_executable_rows_above_max")
  if (datePrecision < options.minCandidateDatePrecision) qualityRejectReasons.push("date_precision_below_min")
  if (hitRows < options.minCandidateHitRows) qualityRejectReasons.push("hit_rows_below_min")
  if (hitDateCount < options.minCandidateHitDates) qualityRejectReasons.push("hit_dates_below_min")
  if (top1HitDateShare > options.maxTop1HitDateShare) qualityRejectReasons.push("top1_hit_date_share_above_max")
  if (top1MatchDateShare > options.maxTop1MatchDateShare) qualityRejectReasons.push("top1_match_date_share_above_max")
  if (options.maxCandidateMatchRows > 0 && matchRows > options.maxCandidateMatchRows) qualityRejectReasons.push("match_rows_above_max")
  if (hitSymbols.size < options.minUniqueHitSymbols) qualityRejectReasons.push("unique_hit_symbols_below_min")
  const qualityPassed = year2hitPassed && qualityRejectReasons.length === 0
  return {
    patternId: stablePatternId(tokens),
    patternKind,
    tokenSet: tokens,
    tokenCount: tokens.length,
    status: qualityPassed ? "quality_seed_passed" : year2hitPassed ? "raw_survivor" : "failed_year2hit",
    year2hitPassed,
    qualityPassed,
    matchRows,
    hitRows,
    falsePositiveRows,
    nonExecutableRows,
    rowPrecision,
    matchedDateCount,
    hitDateCount,
    datePrecision,
    uniqueMatchedSymbols: matchedSymbols.size,
    uniqueHitSymbols: hitSymbols.size,
    top1HitDateShare,
    top1MatchDateShare,
    minYearHitDates: Math.min(...Object.values(yearHitCounts)),
    yearHitCounts,
    yearHitDates: yearHitDateLists,
    belowMinYears,
    qualityRejectReasons,
    supportSignature: supportHash.digest(),
    supportSignatureMode: "event_order_date_symbol_sha256_v2",
    supportRowCount: matchRows,
    positiveSupportSignature: positiveSupportHash.digest(),
    positiveSupportSignatureMode: "event_order_date_symbol_sha256_v2",
    positiveSupportRowCount: hitRows,
  }
}

const evaluateCandidate = ({ tokens, postings, dataset, options, patternKind }) => {
  const tokenSet = uniqueSorted(tokens)
  const supportIndices = intersectPostings({ tokens: tokenSet, postings })
  const row = supportMetrics({ tokens: tokenSet, supportIndices, dataset, options, patternKind })
  const positiveSupportIndices = row.hitRows > 0 ? intersectPostings({ tokens: tokenSet, postings, field: "hitIndices" }) : []
  return {
    row,
    supportIndices,
    positiveSupportIndices,
  }
}

const parentResultSort = (left, right) =>
  right.row.minYearHitDates - left.row.minYearHitDates ||
  right.row.hitRows - left.row.hitRows ||
  right.row.rowPrecision - left.row.rowPrecision ||
  candidateKey(left.row.tokenSet).localeCompare(candidateKey(right.row.tokenSet))

const compactParentResult = (result) => ({
  row: {
    tokenSet: result.row.tokenSet,
    tokenCount: result.row.tokenCount,
    minYearHitDates: result.row.minYearHitDates,
    hitRows: result.row.hitRows,
    rowPrecision: result.row.rowPrecision,
  },
  positiveSupportIndices: Uint32Array.from(result.positiveSupportIndices),
})

const seedTokens = ({ postings, options }) =>
  [...postings.values()]
    .map((entry) => {
      const yearHitCounts = {}
      for (const year of options.coreYears) {
        yearHitCounts[String(year)] = (entry.hitDatesByYear.get(String(year)) ?? new Set()).size
      }
      return {
        token: entry.token,
        matchRows: entry.matchIndices.length,
        hitRows: entry.hitIndices.length,
        rowPrecision: entry.matchIndices.length > 0 ? entry.hitIndices.length / entry.matchIndices.length : 0,
        minYearHitDates: Math.min(...Object.values(yearHitCounts)),
        uniqueHitSymbols: entry.hitSymbols.size,
      }
    })
    .filter(
      (row) =>
        row.hitRows >= options.minSeedHitRows &&
        row.matchRows >= options.minSeedMatchRows &&
        row.rowPrecision >= options.minSeedPrecision &&
        row.minYearHitDates >= options.minHitsPerYear,
    )
    .sort((left, right) => {
      const scoreDiff = right.minYearHitDates - left.minYearHitDates || right.hitRows - left.hitRows || right.rowPrecision - left.rowPrecision
      return scoreDiff || left.token.localeCompare(right.token)
    })

const seedTokensForMask = ({ mask, seedTokenRows }) => {
  const out = []
  for (const row of seedTokenRows) {
    if ((mask & row.bit) !== 0n) out.push(row.token)
  }
  return out
}

const buildPositivePairKeys = ({ dataset, seedTokenRows, options }) => {
  const pairKeys = new Set()
  for (let eventIndex = 0; eventIndex < dataset.length; eventIndex += 1) {
    if (dataset.hitFlags[eventIndex] !== 1) continue
    const tokens = seedTokensForMask({ mask: dataset.tokenMasks[eventIndex], seedTokenRows })
    if (tokens.length > options.maxTokensPerPositiveEvent) {
      throw new Error(
        `positive event index ${eventIndex} has ${tokens.length} seed tokens, above maxTokensPerPositiveEvent=${options.maxTokensPerPositiveEvent}`,
      )
    }
    for (let i = 0; i < tokens.length; i += 1) {
      for (let j = i + 1; j < tokens.length; j += 1) {
        pairKeys.add(`${tokens[i]}\u0001${tokens[j]}`)
        if (pairKeys.size > options.maxPairCandidates) {
          throw new Error(`pair candidate count exceeds maxPairCandidates=${options.maxPairCandidates}`)
        }
      }
    }
  }
  return [...pairKeys].sort().map((key) => key.split("\u0001"))
}

const candidateKey = (tokens) => uniqueSorted(tokens).join("\u0001")

const supportOverlapCount = (left, right) => {
  let i = 0
  let j = 0
  let count = 0
  while (i < left.length && j < right.length) {
    const a = left[i]
    const b = right[j]
    if (a === b) {
      count += 1
      i += 1
      j += 1
    } else if (a < b) {
      i += 1
    } else {
      j += 1
    }
  }
  return count
}

const shouldRetainNearSupportRepresentative = ({ result, options }) =>
  options.earlyDedupe.enabled &&
  (options.earlyDedupe.nearSupportJaccard > 0 || options.earlyDedupe.containment > 0) &&
  result.row.qualityPassed === true

const duplicateSupportReason = ({ supportIndices, representatives, options }) => {
  if (!options.earlyDedupe.enabled) return ""
  const nearThreshold = options.earlyDedupe.nearSupportJaccard
  const containmentThreshold = options.earlyDedupe.containment
  if (nearThreshold <= 0 && containmentThreshold <= 0) return ""
  for (const representative of representatives) {
    const leftLength = supportIndices.length
    const rightLength = representative.supportIndices.length
    if (leftLength < 1 || rightLength < 1) continue
    const minLength = Math.min(leftLength, rightLength)
    const maxLength = Math.max(leftLength, rightLength)
    if (nearThreshold > 0 && minLength / maxLength < nearThreshold) {
      if (containmentThreshold <= 0 || minLength / maxLength < options.earlyDedupe.minContainmentSizeRatio) continue
    }
    const overlap = supportOverlapCount(supportIndices, representative.supportIndices)
    const union = leftLength + rightLength - overlap
    const jaccard = union > 0 ? overlap / union : 0
    const containment = minLength > 0 ? overlap / minLength : 0
    if (nearThreshold > 0 && jaccard >= nearThreshold) return "near_support_jaccard_duplicate"
    if (
      containmentThreshold > 0 &&
      containment >= containmentThreshold &&
      minLength / maxLength >= options.earlyDedupe.minContainmentSizeRatio
    ) {
      return "support_containment_duplicate"
    }
  }
  return ""
}

const buildBeamChildren = ({ parentResults, dataset, seedTokenRows, options, size }) => {
  const scored = new Map()
  for (const result of parentResults) {
    const parentTokens = new Set(result.row.tokenSet)
    const counts = new Map()
    for (const eventIndex of result.positiveSupportIndices) {
      const mask = dataset.tokenMasks[eventIndex]
      for (const row of seedTokenRows) {
        const token = row.token
        if (parentTokens.has(token) || (mask & row.bit) === 0n) continue
        incrementMap(counts, token)
      }
    }
    const extensions = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, options.maxExtensionsPerParent)
    for (const [token, count] of extensions) {
      const tokens = uniqueSorted([...result.row.tokenSet, token])
      if (tokens.length !== size) continue
      const key = candidateKey(tokens)
      const prev = scored.get(key)
      scored.set(key, { tokens, score: (prev?.score ?? 0) + count })
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || candidateKey(a.tokens).localeCompare(candidateKey(b.tokens)))
    .slice(0, options.beamWidthPerSize)
    .map((row) => row.tokens)
}

export const mineTp12Year2hitCandidates = async ({
  tokenizedEventsPath,
  contractPath = null,
  outCatalogPath,
  outManifestPath,
  ...rawOptions
} = {}) => {
  if (!toText(tokenizedEventsPath)) throw new Error("tokenizedEventsPath is required")
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  const { dataset, postings, inputRowCount, outsideTrainRowCount, forbiddenFutureRowCount, maxDecisionDateSeen } = await readCompactTokenizedDataset({
    tokenizedEventsPath,
    options,
  })
  if (dataset.length < 1) throw new Error("zero train tokenized events")
  const seeds = seedTokens({ postings, options })
  if (seeds.length < 1) throw new Error("zero seed tokens after year2hit seed prefilter")
  const seedTokenRows = seeds.map((row) => {
    const posting = postings.get(row.token)
    return {
      token: row.token,
      bit: posting.bit,
    }
  })
  await ensureDir(path.dirname(outCatalogPath))
  const stream = fs.createWriteStream(outCatalogPath, { encoding: "utf8" })
  const seen = new Set()
  const exactSupportSignatures = new Set()
  const supportRepresentatives = []
  const statusCounts = new Map()
  const kindCounts = new Map()
  const earlyDedupeReasonCounts = new Map()
  const survivorResultsBySize = new Map()
  let evaluatedCandidateCount = 0
  let emittedCandidateCount = 0
  let earlyDedupedCandidateCount = 0
  const evaluateAndMaybeEmit = async ({ tokens, patternKind }) => {
    const key = candidateKey(tokens)
    if (seen.has(key)) return null
    seen.add(key)
    if (options.maxEvaluatedCandidates > 0 && evaluatedCandidateCount >= options.maxEvaluatedCandidates) {
      throw new Error(`evaluated candidate count exceeds maxEvaluatedCandidates=${options.maxEvaluatedCandidates}`)
    }
    const result = evaluateCandidate({ tokens, postings, dataset, options, patternKind })
    evaluatedCandidateCount += 1
    if (options.earlyDedupe.enabled) {
      let duplicateReason = ""
      if (options.earlyDedupe.exactSupport && exactSupportSignatures.has(result.row.supportSignature)) {
        duplicateReason = "exact_support_duplicate"
      } else {
        duplicateReason = duplicateSupportReason({
          supportIndices: result.supportIndices,
          representatives: supportRepresentatives,
          options,
        })
      }
      if (duplicateReason) {
        earlyDedupedCandidateCount += 1
        incrementMap(earlyDedupeReasonCounts, duplicateReason)
        return null
      }
      exactSupportSignatures.add(result.row.supportSignature)
      if (shouldRetainNearSupportRepresentative({ result, options })) {
        supportRepresentatives.push({
          supportSignature: result.row.supportSignature,
          supportIndices: Uint32Array.from(result.supportIndices),
          patternId: result.row.patternId,
        })
      }
    }
    incrementMap(statusCounts, result.row.status)
    incrementMap(kindCounts, patternKind)
    if (result.row.year2hitPassed || options.emitRejected) {
      await writeJsonlRow(stream, result.row)
      emittedCandidateCount += 1
    }
    if (result.row.year2hitPassed) {
      const sizeRows = survivorResultsBySize.get(result.row.tokenCount) ?? []
      sizeRows.push(compactParentResult(result))
      if (sizeRows.length > options.beamWidthPerSize) {
        sizeRows.sort(parentResultSort)
        sizeRows.length = options.beamWidthPerSize
      }
      survivorResultsBySize.set(result.row.tokenCount, sizeRows)
    }
    return result
  }
  try {
    for (const seed of seeds) {
      await evaluateAndMaybeEmit({ tokens: [seed.token], patternKind: "single_token" })
    }
    const pairs = buildPositivePairKeys({ dataset, seedTokenRows, options })
    for (const tokens of pairs) {
      await evaluateAndMaybeEmit({ tokens, patternKind: "pair_token" })
    }
    for (let size = 3; size <= options.maxPatternSize; size += 1) {
      const parents = survivorResultsBySize.get(size - 1) ?? []
      if (parents.length < 1) break
      const children = buildBeamChildren({ parentResults: parents, dataset, seedTokenRows, options, size })
      for (const tokens of children) {
        await evaluateAndMaybeEmit({ tokens, patternKind: "year_balanced_beam" })
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
  const rawOrQualitySurvivorCount = [...statusCounts.entries()]
    .filter(([status]) => status === "quality_seed_passed" || status === "raw_survivor")
    .reduce((sum, [, count]) => sum + count, 0)
  const qualitySeedPassedCount = statusCounts.get("quality_seed_passed") ?? 0
  const rawSurvivorCount = statusCounts.get("raw_survivor") ?? 0
  const manifest = {
    kind: "tp12_year2hit_candidate_mining_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    indexMode: "sorted_postings_exact",
    tokenizedEventsPath: path.resolve(tokenizedEventsPath),
    outCatalogPath: path.resolve(outCatalogPath),
    trainDateRange: {
      from: options.trainDateFrom,
      to: options.trainDateTo,
    },
    coreYears: options.coreYears,
    minHitsPerYear: options.minHitsPerYear,
    inputRowCount,
    trainEventCount: dataset.length,
    outsideTrainRowCount,
    forbiddenFutureRowCount,
    maxDecisionDateSeen,
    tokenCount: postings.size,
    compactEventIndexMode: "uint64_token_mask",
    seedTokenCount: seeds.length,
    evaluatedCandidateCount,
    emittedCandidateCount,
    earlyDedupedCandidateCount,
    earlyDedupeReasonCounts: mapToSortedObject(earlyDedupeReasonCounts),
    supportRepresentativeCount: supportRepresentatives.length,
    retainedParentMode: "compact_next_extension_fields_v1",
    survivorCount: rawOrQualitySurvivorCount,
    rawSurvivorCount,
    qualitySeedPassedCount,
    statusCounts: mapToSortedObject(statusCounts),
    patternKindCounts: mapToSortedObject(kindCounts),
    seedTokens: seeds.slice(0, 500),
    supportSignatureMode: "event_order_date_symbol_sha256_v2",
    options,
  }
  const manifestPath = outManifestPath || path.join(path.dirname(outCatalogPath), "candidate_mining_manifest.json")
  await writeJson(manifestPath, manifest)
  if (options.failOnZeroOperational100Seed && qualitySeedPassedCount < 1) {
    throw new Error("zero operational 100pct year2hit seed after candidate mining")
  }
  return { manifest }
}
