import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

import { ensureDir, writeJson } from "./io.mjs"
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

const sha256Lines = (values) => createHash("sha256").update(values.join("\n")).digest("hex")

const resolveDedupeOptions = ({ contract, ...rawOptions }) => {
  const policy = contract?.dedupePolicy ?? {}
  const range = contract?.internalValidationRange ?? {}
  const tieBreak = contract?.tieBreak ?? {}
  const trainDateFrom = toText(rawOptions.trainDateFrom ?? range.from ?? "2016-01-01")
  const trainDateTo = toText(rawOptions.trainDateTo ?? range.to ?? "2024-12-31")
  const lockedFutureFrom = toText(rawOptions.lockedFutureFrom ?? contract?.lockedFutureFrom ?? "2025-01-02")
  if (!validDateKey(trainDateFrom) || !validDateKey(trainDateTo) || trainDateFrom > trainDateTo) {
    throw new Error(`invalid internal validation range: ${trainDateFrom}..${trainDateTo}`)
  }
  if (lockedFutureFrom && !validDateKey(lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${lockedFutureFrom}`)
  return {
    trainDateFrom,
    trainDateTo,
    lockedFutureFrom,
    hitField: toText(rawOptions.hitField ?? contract?.hitField ?? "operationalHitTarget"),
    requireEntryExecutable: toBool(rawOptions.requireEntryExecutable ?? contract?.requireEntryExecutable, true),
    exactSupport: toBool(rawOptions.exactSupport ?? policy.exactSupport, true),
    nearSupportJaccard: Math.min(1, Math.max(0, toNumber(rawOptions.nearSupportJaccard ?? policy.nearSupportJaccard, 0.9))),
    sameFamilyJaccard: Math.min(1, Math.max(0, toNumber(rawOptions.sameFamilyJaccard ?? policy.sameFamilyJaccard, 0.85))),
    tokenJaccard: Math.min(1, Math.max(0, toNumber(rawOptions.tokenJaccard ?? policy.tokenJaccard, 0.8))),
    containment: Math.min(1, Math.max(0, toNumber(rawOptions.containment ?? policy.containment, 0.98))),
    patternTopSymbolShareMax: Math.min(1, Math.max(0, toNumber(rawOptions.patternTopSymbolShareMax ?? policy.patternTopSymbolShareMax, 0.25))),
    patternTopYearShareMax: Math.min(1, Math.max(0, toNumber(rawOptions.patternTopYearShareMax ?? policy.patternTopYearShareMax, 0.3))),
    failOnMissingConditionAtoms: toBool(rawOptions.failOnMissingConditionAtoms ?? policy.failOnMissingConditionAtoms, true),
    tieBreakOrder: Array.isArray(tieBreak.order) ? tieBreak.order.map(toText).filter(Boolean) : [],
  }
}

const extractTokenSet = (row) =>
  uniqueSorted(
    row?.tokenSet ??
      row?.conditionAtoms ??
      row?.sourcePattern?.tokenSet ??
      row?.sourceBank?.tokenSet ??
      row?.sourceBank?.sourcePattern?.tokenSet ??
      [],
  )

const patternIdOf = (row, tokens, index) =>
  toText(row?.patternId ?? row?.sourcePatternId ?? row?.sourceBank?.patternId) ||
  `tp12_dedupe_${createHash("sha256").update(`${tokens.join("\n")}\n${index}`).digest("hex").slice(0, 16)}`

const tokenJaccard = (leftTokens, rightTokens) => {
  const left = new Set(leftTokens)
  const right = new Set(rightTokens)
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = left.size + right.size - intersection
  return union > 0 ? intersection / union : 0
}

const familySet = (tokens) => uniqueSorted(tokens.map((token) => token.split(":")[0] || token))

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

const supportSimilarity = (left, right) => {
  const overlap = supportOverlapCount(left, right)
  const union = left.length + right.length - overlap
  const minLength = Math.min(left.length, right.length)
  return {
    jaccard: union > 0 ? overlap / union : 0,
    containment: minLength > 0 ? overlap / minLength : 0,
  }
}

const loadPatterns = async ({ patternsPath, options }) => {
  const patterns = []
  await iterateJsonlMaybeGzip(patternsPath, {
    strict: true,
    onRow: async (row, context) => {
      const tokens = extractTokenSet(row)
      if (tokens.length < 1) {
        if (options.failOnMissingConditionAtoms) {
          throw new Error(`pattern missing tokenSet/conditionAtoms at ${context.filePath}:${context.lineNumber}`)
        }
        return
      }
      patterns.push({
        sourceRow: row,
        patternId: patternIdOf(row, tokens, patterns.length),
        tokenSet: tokens,
        tokenFamilies: familySet(tokens),
      })
    },
  })
  if (patterns.length < 1) throw new Error("zero patterns for dedupe similarity gate")
  return patterns
}

const loadOperationalEvents = async ({ operationalEventsPath, options }) => {
  const events = []
  let inputRowCount = 0
  let outsideTrainRowCount = 0
  let forbiddenFutureRowCount = 0
  await iterateJsonlMaybeGzip(operationalEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = toText(row?.decisionDateKey)
      if (!symbol) throw new Error(`missing operational event symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`invalid operational event decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (options.lockedFutureFrom && decisionDateKey >= options.lockedFutureFrom) {
        forbiddenFutureRowCount += 1
        throw new Error(
          `forbidden future event at ${context.filePath}:${context.lineNumber}: decisionDateKey=${decisionDateKey} lockedFutureFrom=${options.lockedFutureFrom}`,
        )
      }
      if (decisionDateKey < options.trainDateFrom || decisionDateKey > options.trainDateTo) {
        outsideTrainRowCount += 1
        return
      }
      if (!Object.prototype.hasOwnProperty.call(row, options.hitField)) {
        throw new Error(`operational event missing ${options.hitField} at ${context.filePath}:${context.lineNumber}`)
      }
      if (options.requireEntryExecutable && !Object.prototype.hasOwnProperty.call(row, "entryExecutable")) {
        throw new Error(`operational event missing entryExecutable at ${context.filePath}:${context.lineNumber}`)
      }
      const tokens = new Set(uniqueSorted(row?.tokens ?? []))
      if (tokens.size < 1) return
      events.push({
        symbol,
        decisionDateKey,
        year: dateYear(decisionDateKey),
        supportKey: `${decisionDateKey}\t${symbol}`,
        hit: row[options.hitField] === true,
        entryExecutable: row.entryExecutable !== false,
        tokens,
      })
    },
  })
  if (events.length < 1) throw new Error("zero operational events inside dedupe validation range")
  return { events, inputRowCount, outsideTrainRowCount, forbiddenFutureRowCount }
}

const patternMatchesEvent = (pattern, event) => pattern.tokenSet.every((token) => event.tokens.has(token))

const enrichPattern = ({ pattern, events, options }) => {
  const supportKeys = []
  const positiveSupportKeys = []
  const hitSymbols = new Set()
  const matchedSymbols = new Set()
  const symbolRows = new Map()
  const yearHitDates = new Map()
  const yearMatchRows = new Map()
  let hitRows = 0
  let nonExecutableRows = 0
  for (const event of events) {
    if (!patternMatchesEvent(pattern, event)) continue
    supportKeys.push(event.supportKey)
    matchedSymbols.add(event.symbol)
    incrementMap(symbolRows, event.symbol)
    incrementMap(yearMatchRows, String(event.year))
    if (!event.entryExecutable) nonExecutableRows += 1
    if (event.hit) {
      hitRows += 1
      positiveSupportKeys.push(event.supportKey)
      hitSymbols.add(event.symbol)
      const year = String(event.year)
      if (!yearHitDates.has(year)) yearHitDates.set(year, new Set())
      yearHitDates.get(year).add(event.decisionDateKey)
    }
  }
  supportKeys.sort()
  positiveSupportKeys.sort()
  const matchRows = supportKeys.length
  const topSymbolShare = matchRows > 0 ? Math.max(0, ...symbolRows.values()) / matchRows : 0
  const topYearShare = matchRows > 0 ? Math.max(0, ...yearMatchRows.values()) / matchRows : 0
  const yearHitCounts = mapToSortedObject(
    new Map([...yearHitDates.entries()].map(([year, dates]) => [year, dates.size])),
  )
  const rejectReasons = []
  if (matchRows < 1) rejectReasons.push("zero_support_rows")
  if (topSymbolShare > options.patternTopSymbolShareMax) rejectReasons.push("top_symbol_share_above_max")
  if (topYearShare > options.patternTopYearShareMax) rejectReasons.push("top_year_share_above_max")
  return {
    ...pattern,
    supportKeys,
    positiveSupportKeys,
    supportSignature: sha256Lines(supportKeys),
    positiveSupportSignature: sha256Lines(positiveSupportKeys),
    matchRows,
    hitRows,
    falsePositiveRows: matchRows - hitRows,
    nonExecutableRows,
    rowPrecision: matchRows > 0 ? hitRows / matchRows : 0,
    uniqueMatchedSymbols: matchedSymbols.size,
    uniqueHitSymbols: hitSymbols.size,
    topSymbolShare,
    topYearShare,
    yearHitCounts,
    rejectReasons,
  }
}

const comparePatterns = (left, right) =>
  left.falsePositiveRows - right.falsePositiveRows ||
  left.nonExecutableRows - right.nonExecutableRows ||
  right.rowPrecision - left.rowPrecision ||
  right.hitRows - left.hitRows ||
  left.matchRows - right.matchRows ||
  left.tokenSet.length - right.tokenSet.length ||
  left.patternId.localeCompare(right.patternId)

const findDedupeReason = ({ pattern, selected, options }) => {
  for (const representative of selected) {
    if (options.exactSupport && pattern.supportSignature === representative.supportSignature) {
      return { reason: "exact_support_duplicate", representativePatternId: representative.patternId }
    }
    const support = supportSimilarity(pattern.supportKeys, representative.supportKeys)
    if (options.nearSupportJaccard > 0 && support.jaccard >= options.nearSupportJaccard) {
      return { reason: "near_support_jaccard_duplicate", representativePatternId: representative.patternId }
    }
    if (options.containment > 0 && support.containment >= options.containment) {
      return { reason: "support_containment_duplicate", representativePatternId: representative.patternId }
    }
    if (options.tokenJaccard > 0 && tokenJaccard(pattern.tokenSet, representative.tokenSet) >= options.tokenJaccard) {
      return { reason: "token_jaccard_duplicate", representativePatternId: representative.patternId }
    }
    if (options.sameFamilyJaccard > 0 && tokenJaccard(pattern.tokenFamilies, representative.tokenFamilies) >= options.sameFamilyJaccard) {
      return { reason: "same_family_duplicate", representativePatternId: representative.patternId }
    }
  }
  return null
}

const publicPatternRow = (pattern, status, extra = {}) => ({
  kind: "tp12_pattern_dedupe_similarity_gate_row_v1",
  patternId: pattern.patternId,
  status,
  tokenSet: pattern.tokenSet,
  tokenCount: pattern.tokenSet.length,
  supportSignature: pattern.supportSignature,
  positiveSupportSignature: pattern.positiveSupportSignature,
  matchRows: pattern.matchRows,
  hitRows: pattern.hitRows,
  falsePositiveRows: pattern.falsePositiveRows,
  nonExecutableRows: pattern.nonExecutableRows,
  rowPrecision: pattern.rowPrecision,
  uniqueMatchedSymbols: pattern.uniqueMatchedSymbols,
  uniqueHitSymbols: pattern.uniqueHitSymbols,
  topSymbolShare: pattern.topSymbolShare,
  topYearShare: pattern.topYearShare,
  yearHitCounts: pattern.yearHitCounts,
  sourceRow: pattern.sourceRow,
  ...extra,
})

export const buildTp12PatternDedupeSimilarityGate = async ({
  patternsPath,
  operationalEventsPath,
  contractPath = null,
  outSurvivorsPath,
  outRejectedPath,
  outSummaryPath,
  ...rawOptions
} = {}) => {
  if (!toText(patternsPath)) throw new Error("patternsPath is required")
  if (!toText(operationalEventsPath)) throw new Error("operationalEventsPath is required")
  if (!toText(outSurvivorsPath)) throw new Error("outSurvivorsPath is required")
  if (!toText(outRejectedPath)) throw new Error("outRejectedPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveDedupeOptions({ contract, ...rawOptions })
  const [patterns, eventLoad] = await Promise.all([
    loadPatterns({ patternsPath, options }),
    loadOperationalEvents({ operationalEventsPath, options }),
  ])
  const enriched = patterns.map((pattern) => enrichPattern({ pattern, events: eventLoad.events, options })).sort(comparePatterns)
  await ensureDir(path.dirname(outSurvivorsPath))
  await ensureDir(path.dirname(outRejectedPath))
  const survivorStream = fs.createWriteStream(outSurvivorsPath, { encoding: "utf8" })
  const rejectedStream = fs.createWriteStream(outRejectedPath, { encoding: "utf8" })
  const selected = []
  const rejectReasonCounts = new Map()
  try {
    for (const pattern of enriched) {
      if (pattern.rejectReasons.length > 0) {
        for (const reason of pattern.rejectReasons) incrementMap(rejectReasonCounts, reason)
        await writeJsonlRow(rejectedStream, publicPatternRow(pattern, "rejected", { rejectReasons: pattern.rejectReasons }))
        continue
      }
      const duplicate = findDedupeReason({ pattern, selected, options })
      if (duplicate) {
        incrementMap(rejectReasonCounts, duplicate.reason)
        await writeJsonlRow(
          rejectedStream,
          publicPatternRow(pattern, "rejected", {
            rejectReasons: [duplicate.reason],
            representativePatternId: duplicate.representativePatternId,
          }),
        )
        continue
      }
      selected.push(pattern)
      await writeJsonlRow(survivorStream, publicPatternRow(pattern, "passed"))
    }
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => {
        survivorStream.once("error", reject)
        survivorStream.end(() => {
          survivorStream.removeListener("error", reject)
          resolve()
        })
      }),
      new Promise((resolve, reject) => {
        rejectedStream.once("error", reject)
        rejectedStream.end(() => {
          rejectedStream.removeListener("error", reject)
          resolve()
        })
      }),
    ])
  }
  const summary = {
    kind: "tp12_pattern_dedupe_similarity_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    patternsPath: path.resolve(patternsPath),
    operationalEventsPath: path.resolve(operationalEventsPath),
    outSurvivorsPath: path.resolve(outSurvivorsPath),
    outRejectedPath: path.resolve(outRejectedPath),
    trainDateRange: {
      from: options.trainDateFrom,
      to: options.trainDateTo,
    },
    lockedFutureFrom: options.lockedFutureFrom,
    hitField: options.hitField,
    inputPatternCount: patterns.length,
    inputEventCount: eventLoad.inputRowCount,
    trainEventCount: eventLoad.events.length,
    outsideTrainRowCount: eventLoad.outsideTrainRowCount,
    forbiddenFutureRowCount: eventLoad.forbiddenFutureRowCount,
    survivorCount: selected.length,
    rejectedCount: patterns.length - selected.length,
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    options,
  }
  if (outSummaryPath) await writeJson(outSummaryPath, summary)
  return { summary }
}
