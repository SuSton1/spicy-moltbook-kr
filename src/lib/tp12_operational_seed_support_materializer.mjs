import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { loadTp12CandlesBySymbol } from "./tp12_label_event_builder.mjs"
import {
  assertTp12OperationalMicroTermsAllowed,
  buildTp12OperationalMicroFeatureTerms,
  TP12_OPERATIONAL_MICRO_FEATURE_BANK_ID,
} from "./tp12_operational_micro_feature_bank.mjs"
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

const normalizeSymbol = (value) => toText(value).toUpperCase()

const assertInputFile = (filePath, label) => {
  const target = toText(filePath)
  if (!target) throw new Error(`${label} is required`)
  if (!fs.existsSync(target)) throw new Error(`${label} not found: ${target}`)
}

const parseStatuses = (value) => {
  if (Array.isArray(value)) return new Set(value.map(toText).filter(Boolean))
  return new Set(toText(value).split(",").map((item) => item.trim()).filter(Boolean))
}

const buildDateIndexBySymbol = (candlesBySymbol) => {
  const out = new Map()
  for (const [symbol, series] of candlesBySymbol.entries()) {
    const byDate = new Map()
    for (const [index, row] of series.entries()) byDate.set(row.dateKey, index)
    out.set(symbol, byDate)
  }
  return out
}

const normalizeTokenSet = (row) => uniqueSorted(row?.tokenSet ?? row?.tokens ?? [])

const stableFrontierScore = (row) => {
  const precision = toNumber(row?.rowPrecision, 0)
  const falsePositiveRows = toNumber(row?.falsePositiveRows, Number.MAX_SAFE_INTEGER)
  const matchRows = Math.max(1, toNumber(row?.matchRows, 1))
  return precision * 100000 - falsePositiveRows / Math.sqrt(matchRows)
}

const selectCandidateFrontier = ({ candidates, options }) => {
  const selected = new Map()
  const maxCandidateMatchRows = Math.max(0, Math.trunc(toNumber(options.maxCandidateMatchRows, 0)))
  const eligible = candidates.filter((row) => {
    if (options.requireYear2hitPassed && row.year2hitPassed !== true) return false
    if (maxCandidateMatchRows > 0 && toNumber(row.matchRows, 0) > maxCandidateMatchRows) return false
    return true
  })
  const addRows = (rows) => {
    for (const row of rows) selected.set(row.patternId, row)
  }
  const lowFalsePositiveMaxRows = Math.max(0, Math.trunc(toNumber(options.lowFalsePositiveMaxRows, 0)))
  const lowFalsePositiveCount = Math.max(0, Math.trunc(toNumber(options.lowFalsePositiveCount, 0)))
  const highPrecisionCount = Math.max(0, Math.trunc(toNumber(options.highPrecisionCount, 0)))
  const balancedCount = Math.max(0, Math.trunc(toNumber(options.balancedCount, 0)))
  const highPrecisionMinRowPrecision = toNumber(options.highPrecisionMinRowPrecision, 0)
  addRows(
    eligible
      .filter((row) => lowFalsePositiveMaxRows <= 0 || toNumber(row.falsePositiveRows, Number.MAX_SAFE_INTEGER) <= lowFalsePositiveMaxRows)
      .sort((left, right) => toNumber(left.falsePositiveRows, 0) - toNumber(right.falsePositiveRows, 0) || toNumber(right.rowPrecision, 0) - toNumber(left.rowPrecision, 0))
      .slice(0, lowFalsePositiveCount),
  )
  addRows(
    eligible
      .filter((row) => toNumber(row.rowPrecision, 0) >= highPrecisionMinRowPrecision)
      .sort((left, right) => toNumber(right.rowPrecision, 0) - toNumber(left.rowPrecision, 0) || toNumber(left.falsePositiveRows, 0) - toNumber(right.falsePositiveRows, 0))
      .slice(0, highPrecisionCount),
  )
  addRows(
    eligible
      .slice()
      .sort((left, right) => stableFrontierScore(right) - stableFrontierScore(left))
      .slice(0, balancedCount),
  )
  return [...selected.values()]
    .sort((left, right) => toNumber(left.falsePositiveRows, 0) - toNumber(right.falsePositiveRows, 0) || toNumber(right.rowPrecision, 0) - toNumber(left.rowPrecision, 0))
    .slice(0, Math.max(1, Math.trunc(toNumber(options.maxCandidateCount, selected.size || 1))))
}

const loadCandidateFrontier = async ({ candidateCatalogPath, contract }) => {
  const options = contract.candidateFrontier ?? {}
  const allowedStatuses = parseStatuses(options.allowedStatuses ?? ["raw_survivor", "quality_seed_passed"])
  const candidates = []
  await iterateJsonlMaybeGzip(candidateCatalogPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = toText(row?.patternId)
      const tokenSet = normalizeTokenSet(row)
      if (!patternId) throw new Error(`candidate row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (tokenSet.length < 1) throw new Error(`candidate row missing tokenSet at ${context.filePath}:${context.lineNumber}`)
      const status = toText(row?.status)
      if (!allowedStatuses.has(status)) return
      candidates.push({
        patternId,
        patternKind: toText(row?.patternKind),
        tokenSet,
        tokenCount: tokenSet.length,
        status,
        year2hitPassed: row?.year2hitPassed === true,
        qualityPassed: row?.qualityPassed === true,
        matchRows: toNumber(row?.matchRows, 0),
        hitRows: toNumber(row?.hitRows, 0),
        falsePositiveRows: toNumber(row?.falsePositiveRows, 0),
        rowPrecision: toNumber(row?.rowPrecision, 0),
        yearHitCounts: row?.yearHitCounts ?? {},
        minYearHitDates: toNumber(row?.minYearHitDates, 0),
      })
    },
  })
  const selected = selectCandidateFrontier({ candidates, options })
  if (selected.length < 1) throw new Error(`candidate frontier is empty for ${candidateCatalogPath}`)
  return { candidates, selected }
}

const buildTokenCandidateIndex = (candidates) => {
  const tokenToCandidateIds = new Map()
  const candidateById = new Map()
  for (const candidate of candidates) {
    candidateById.set(candidate.patternId, candidate)
    for (const token of candidate.tokenSet) {
      const list = tokenToCandidateIds.get(token) ?? []
      list.push(candidate.patternId)
      tokenToCandidateIds.set(token, list)
    }
  }
  return { tokenToCandidateIds, candidateById }
}

const matchingCandidateIds = ({ tokens, tokenToCandidateIds, candidateById }) => {
  const tokenSet = new Set(tokens)
  let anchorIds = null
  for (const token of tokenSet) {
    const ids = tokenToCandidateIds.get(token)
    if (!ids || ids.length < 1) continue
    if (!anchorIds || ids.length < anchorIds.length) anchorIds = ids
  }
  if (!anchorIds) return []
  const out = []
  for (const id of anchorIds) {
    const candidate = candidateById.get(id)
    if (!candidate) continue
    if (candidate.tokenSet.every((token) => tokenSet.has(token))) out.push(id)
  }
  return out
}

const normalizeMissReasons = (row) => {
  if (Array.isArray(row?.operationalMissReasons)) return row.operationalMissReasons.map(toText).filter(Boolean)
  if (Array.isArray(row?.operationalMissReason)) return row.operationalMissReason.map(toText).filter(Boolean)
  const single = toText(row?.operationalMissReason)
  return single ? [single] : []
}

const resolveOptions = ({ contract }) => {
  const support = contract.supportMaterializer ?? {}
  const lockedFuture = contract.lockedFuture ?? {}
  const trainDateRange = contract.trainDateRange ?? {}
  const hitField = toText(support.hitField ?? "operationalHitTarget")
  if (hitField !== "operationalHitTarget") throw new Error(`support hitField must be operationalHitTarget: ${hitField}`)
  return {
    trainDateFrom: toText(trainDateRange.from),
    trainDateTo: toText(trainDateRange.to),
    lockedFutureFrom: toText(lockedFuture.from),
    failOnForbiddenFutureRows: toBool(lockedFuture.failOnForbiddenFutureRows, true),
    hitField,
    maxSupportRowsTotal: Math.max(0, Math.trunc(toNumber(support.maxSupportRowsTotal, 0))),
    maxSupportRowsPerCandidate: Math.max(0, Math.trunc(toNumber(support.maxSupportRowsPerCandidate, 0))),
    failOnMissingCandle: toBool(support.failOnMissingCandle, true),
    failOnMissingOperationalHitField: toBool(support.failOnMissingOperationalHitField, true),
  }
}

export const buildTp12OperationalSeedSupportRows = async ({
  contractPath,
  candidateCatalogPath,
  tokenizedEventsPath,
  candlePath,
  outSupportRowsPath,
  outSummaryPath,
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract file not found: ${contractPath}`)
  const resolvedCandidateCatalogPath = toText(candidateCatalogPath || contract.defaultInputs?.candidateCatalogPath)
  const resolvedTokenizedEventsPath = toText(tokenizedEventsPath || contract.defaultInputs?.tokenizedEventsPath)
  const resolvedCandlePath = toText(candlePath || contract.defaultInputs?.candlePath)
  if (!resolvedCandidateCatalogPath) throw new Error("candidateCatalogPath is required")
  if (!resolvedTokenizedEventsPath) throw new Error("tokenizedEventsPath is required")
  if (!resolvedCandlePath) throw new Error("candlePath is required")
  if (!toText(outSupportRowsPath)) throw new Error("outSupportRowsPath is required")
  assertInputFile(resolvedCandidateCatalogPath, "candidateCatalogPath")
  assertInputFile(resolvedTokenizedEventsPath, "tokenizedEventsPath")
  assertInputFile(resolvedCandlePath, "candlePath")
  const options = resolveOptions({ contract })
  const [{ candidates, selected }, candlesBySymbol] = await Promise.all([
    loadCandidateFrontier({ candidateCatalogPath: resolvedCandidateCatalogPath, contract }),
    loadTp12CandlesBySymbol({ candlePath: resolvedCandlePath }),
  ])
  const dateIndexBySymbol = buildDateIndexBySymbol(candlesBySymbol)
  const { tokenToCandidateIds, candidateById } = buildTokenCandidateIndex(selected)
  await ensureDir(path.dirname(outSupportRowsPath))
  const stream = fs.createWriteStream(outSupportRowsPath, { encoding: "utf8" })
  const supportRowsByCandidate = new Map()
  const hitRowsByCandidate = new Map()
  const missRowsByCandidate = new Map()
  const missReasonCounts = new Map()
  const statusCounts = new Map()
  const yearCounts = new Map()
  let inputRows = 0
  let eligibleRows = 0
  let supportRows = 0
  let hitRows = 0
  let missRows = 0
  let forbiddenFutureRows = 0
  let maxDecisionDateSeen = ""
  try {
    await iterateJsonlMaybeGzip(resolvedTokenizedEventsPath, {
      strict: true,
      onRow: async (row, context) => {
        inputRows += 1
        const decisionDateKey = toText(row?.decisionDateKey)
        if (!validDateKey(decisionDateKey)) throw new Error(`invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        if (decisionDateKey > maxDecisionDateSeen) maxDecisionDateSeen = decisionDateKey
        if (options.lockedFutureFrom && decisionDateKey >= options.lockedFutureFrom) {
          forbiddenFutureRows += 1
          if (options.failOnForbiddenFutureRows) throw new Error(`forbidden future tuning row at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
          return
        }
        if (options.trainDateFrom && decisionDateKey < options.trainDateFrom) return
        if (options.trainDateTo && decisionDateKey > options.trainDateTo) return
        if (!Object.prototype.hasOwnProperty.call(row, options.hitField)) {
          if (options.failOnMissingOperationalHitField) {
            throw new Error(`tokenized event missing ${options.hitField} at ${context.filePath}:${context.lineNumber}`)
          }
          return
        }
        const tokens = uniqueSorted(row?.tokens ?? [])
        if (tokens.length < 1) return
        const candidateIds = matchingCandidateIds({ tokens, tokenToCandidateIds, candidateById })
        if (candidateIds.length < 1) return
        eligibleRows += 1
        const symbol = normalizeSymbol(row?.symbol)
        const series = candlesBySymbol.get(symbol)
        const index = dateIndexBySymbol.get(symbol)?.get(decisionDateKey)
        if (!series || index === undefined) {
          if (options.failOnMissingCandle) throw new Error(`missing candle row for ${symbol}/${decisionDateKey}`)
          return
        }
        const microTerms = buildTp12OperationalMicroFeatureTerms({ series, index })
        assertTp12OperationalMicroTermsAllowed(microTerms)
        const operationalHitTarget = row[options.hitField] === true
        const missReasons = normalizeMissReasons(row)
        for (const patternId of candidateIds) {
          const candidate = candidateById.get(patternId)
          const candidateRows = (supportRowsByCandidate.get(patternId) ?? 0) + 1
          if (options.maxSupportRowsPerCandidate > 0 && candidateRows > options.maxSupportRowsPerCandidate) {
            throw new Error(`support rows for ${patternId} exceeded maxSupportRowsPerCandidate=${options.maxSupportRowsPerCandidate}`)
          }
          if (options.maxSupportRowsTotal > 0 && supportRows + 1 > options.maxSupportRowsTotal) {
            throw new Error(`support rows exceeded maxSupportRowsTotal=${options.maxSupportRowsTotal}`)
          }
          supportRowsByCandidate.set(patternId, candidateRows)
          supportRows += 1
          incrementMap(yearCounts, String(dateYear(decisionDateKey)))
          if (operationalHitTarget) {
            hitRows += 1
            incrementMap(hitRowsByCandidate, patternId)
          } else {
            missRows += 1
            incrementMap(missRowsByCandidate, patternId)
            for (const reason of missReasons.length > 0 ? missReasons : ["unknown"]) incrementMap(missReasonCounts, reason)
          }
          await writeJsonlRow(stream, {
            kind: "tp12_operational_seed_support_row_v1",
            featureBankId: TP12_OPERATIONAL_MICRO_FEATURE_BANK_ID,
            patternId,
            parentPatternId: patternId,
            patternStatus: candidate.status,
            baseTokenSet: candidate.tokenSet,
            symbol,
            decisionDateKey,
            year: dateYear(decisionDateKey),
            operationalHitTarget,
            chartHitTarget: row?.chartHitTarget === true,
            entryExecutable: row?.entryExecutable === true,
            operationalMissReasons: missReasons,
            baseTokens: tokens,
            microTerms,
            microTermCount: microTerms.length,
          })
        }
      },
    })
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(resolve)
    })
  }
  const summary = {
    kind: "tp12_operational_seed_support_summary_v1",
    contractId: contract.contractId,
    patchKey: contract.patchKey,
    frontierId: contract.candidateFrontier?.frontierId,
    candidateCatalogPath: resolvedCandidateCatalogPath,
    tokenizedEventsPath: resolvedTokenizedEventsPath,
    candlePath: resolvedCandlePath,
    outSupportRowsPath,
    allRawCandidateCount: candidates.length,
    selectedCandidateCount: selected.length,
    inputRows,
    eligibleRows,
    supportRows,
    hitRows,
    missRows,
    rowPrecision: supportRows > 0 ? hitRows / supportRows : 0,
    forbiddenFutureRows,
    maxDecisionDateSeen,
    missReasonCounts: mapToSortedObject(missReasonCounts),
    yearCounts: mapToSortedObject(yearCounts),
    supportRowsByCandidate: mapToSortedObject(supportRowsByCandidate),
    hitRowsByCandidate: mapToSortedObject(hitRowsByCandidate),
    missRowsByCandidate: mapToSortedObject(missRowsByCandidate),
    selectedCandidates: selected.map((row) => ({
      patternId: row.patternId,
      tokenSet: row.tokenSet,
      matchRows: row.matchRows,
      hitRows: row.hitRows,
      falsePositiveRows: row.falsePositiveRows,
      rowPrecision: row.rowPrecision,
      minYearHitDates: row.minYearHitDates,
      status: row.status,
    })),
    statusCounts: mapToSortedObject(statusCounts),
  }
  if (toText(outSummaryPath)) await writeJson(outSummaryPath, summary)
  return { summary }
}
