import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { loadTp12Contract } from "./tp12_label_event_builder.mjs"
import { deriveTp12Year2hitGateOptionsFromContract } from "./tp12_year2hit_train_gate.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const candidateQualityPassed = (row) => row?.qualityPassed === true || toText(row?.status) === "quality_seed_passed"

const readCandidateCatalog = async (
  candidateCatalogPath,
  { requireYear2hitPassed = true, requireCandidateQualityPassed = false } = {},
) => {
  const rows = []
  let inputCandidateCount = 0
  let rejectedByYear2hitCount = 0
  let rejectedByQualityCount = 0
  const maybePush = (row, contextLabel) => {
    inputCandidateCount += 1
    const patternId = toText(row?.patternId)
    const tokenSet = uniqueSorted(row?.tokenSet ?? row?.tokens ?? [])
    if (!patternId) throw new Error(`candidate row missing patternId at ${contextLabel}`)
    if (tokenSet.length < 1) throw new Error(`candidate row missing tokenSet at ${contextLabel}`)
    if (requireYear2hitPassed && row?.year2hitPassed !== true) {
      rejectedByYear2hitCount += 1
      return
    }
    if (requireCandidateQualityPassed && !candidateQualityPassed(row)) {
      rejectedByQualityCount += 1
      return
    }
    rows.push({ ...row, patternId, tokenSet })
  }
  if (toText(candidateCatalogPath).endsWith(".jsonl") || toText(candidateCatalogPath).endsWith(".jsonl.gz")) {
    await iterateJsonlMaybeGzip(candidateCatalogPath, {
      strict: true,
      onRow: async (row, context) => {
        maybePush(row, `${context.filePath}:${context.lineNumber}`)
      },
    })
    return { rows, inputCandidateCount, rejectedByYear2hitCount, rejectedByQualityCount }
  }
  const payload = await readJson(candidateCatalogPath, null)
  if (!payload) throw new Error(`candidate catalog not found: ${candidateCatalogPath}`)
  const sourceRows = Array.isArray(payload)
    ? payload
    : ["candidates", "patterns", "rules", "rows"].flatMap((key) => (Array.isArray(payload[key]) ? payload[key] : []))
  if (sourceRows.length < 1) throw new Error("candidate catalog JSON contains no candidate array")
  for (const [index, row] of sourceRows.entries()) {
    maybePush(row, `JSON index ${index}`)
  }
  return { rows, inputCandidateCount, rejectedByYear2hitCount, rejectedByQualityCount }
}

const scanTokenizedEvents = async ({ tokenizedEventsPath, dateFrom, dateTo }) => {
  const tokenFrequency = new Map()
  let inputRowCount = 0
  let outsideDateRowCount = 0
  let tokenizedRowCount = 0
  await iterateJsonlMaybeGzip(tokenizedEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const symbol = toText(row?.symbol).toUpperCase()
      const decisionDateKey = toText(row?.decisionDateKey)
      if (!symbol) throw new Error(`tokenized event missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`tokenized event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (dateFrom && decisionDateKey < dateFrom) {
        outsideDateRowCount += 1
        return
      }
      if (dateTo && decisionDateKey > dateTo) {
        outsideDateRowCount += 1
        return
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`tokenized event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const tokens = uniqueSorted(Array.isArray(row?.tokens) ? row.tokens : [])
      const tokenSet = new Set(tokens)
      for (const token of tokens) incrementMap(tokenFrequency, token)
      if (tokenSet.size > 0) tokenizedRowCount += 1
    },
  })
  return { tokenFrequency, inputRowCount, outsideDateRowCount, tokenizedRowCount }
}

const resolveOptions = ({
  contract,
  dateFrom,
  dateTo,
  requireYear2hitPassed,
  requireCandidateQualityPassed,
  failOnZeroMatchCandidates,
}) => {
  const gate = contract ? deriveTp12Year2hitGateOptionsFromContract(contract) : {}
  const materialization = contract?.candidateMaterialization ?? {}
  const from = toText(dateFrom ?? gate.trainDateFrom)
  const to = toText(dateTo ?? gate.trainDateTo)
  if (!validDateKey(from) || !validDateKey(to) || from > to) throw new Error(`invalid materialize date range: ${from}..${to}`)
  return {
    dateFrom: from,
    dateTo: to,
    requireYear2hitPassed: toBool(requireYear2hitPassed ?? materialization.requireYear2hitPassed, true),
    requireCandidateQualityPassed: toBool(
      requireCandidateQualityPassed ?? materialization.requireCandidateQualityPassed,
      false,
    ),
    failOnZeroMatchCandidates: toBool(failOnZeroMatchCandidates ?? materialization.failOnZeroMatchCandidates, true),
  }
}

const copyOptionalLabelMetrics = (event) => {
  const out = {}
  for (const key of [
    "hitDefinition",
    "executionPolicyId",
    "chartHitTarget",
    "entryExecutable",
    "operationalHitTarget",
    "executableHitTarget",
    "operationalMissReasons",
    "operationalMissReason",
    "entryPrice",
    "targetPrice",
    "hitDateKey",
    "stopHit",
    "stopDateKey",
    "targetBeforeStop",
    "stopBeforeTarget",
    "sameBarAmbiguous",
    "maxForwardReturn",
    "maxForwardHighPct",
    "minForwardReturn",
    "minForwardLowPct",
    "maxForwardDrawdown",
    "availableForwardBars",
  ]) {
    if (Object.prototype.hasOwnProperty.call(event, key)) out[key] = event[key]
  }
  return out
}

export const materializeTp12CandidateEvents = async ({
  candidateCatalogPath,
  tokenizedEventsPath,
  contractPath = null,
  outEventsPath,
  outSummaryPath,
  dateFrom,
  dateTo,
  requireYear2hitPassed,
  requireCandidateQualityPassed,
  failOnZeroMatchCandidates,
} = {}) => {
  if (!toText(candidateCatalogPath)) throw new Error("candidateCatalogPath is required")
  if (!toText(tokenizedEventsPath)) throw new Error("tokenizedEventsPath is required")
  if (!toText(outEventsPath)) throw new Error("outEventsPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveOptions({
    contract,
    dateFrom,
    dateTo,
    requireYear2hitPassed,
    requireCandidateQualityPassed,
    failOnZeroMatchCandidates,
  })
  const { tokenFrequency, inputRowCount, outsideDateRowCount, tokenizedRowCount } = await scanTokenizedEvents({
    tokenizedEventsPath,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
  })
  const {
    rows: candidates,
    inputCandidateCount,
    rejectedByYear2hitCount,
    rejectedByQualityCount,
  } = await readCandidateCatalog(candidateCatalogPath, {
    requireYear2hitPassed: options.requireYear2hitPassed,
    requireCandidateQualityPassed: options.requireCandidateQualityPassed,
  })
  if (candidates.length < 1) throw new Error("zero candidates to materialize")
  const candidatesByAnchor = new Map()
  for (const candidate of candidates) {
    const anchorToken = [...candidate.tokenSet].sort(
      (left, right) => (tokenFrequency.get(left) ?? 0) - (tokenFrequency.get(right) ?? 0) || left.localeCompare(right),
    )[0]
    if (!anchorToken || !tokenFrequency.has(anchorToken)) {
      throw new Error(`candidate ${candidate.patternId} has no token present in tokenized events`)
    }
    const rows = candidatesByAnchor.get(anchorToken) ?? []
    rows.push(candidate)
    candidatesByAnchor.set(anchorToken, rows)
  }
  await ensureDir(path.dirname(outEventsPath))
  const stream = fs.createWriteStream(outEventsPath, { encoding: "utf8" })
  const matchCountsByPattern = new Map()
  let outputRowCount = 0
  let hitRowCount = 0
  try {
    await iterateJsonlMaybeGzip(tokenizedEventsPath, {
      strict: true,
      onRow: async (event, context) => {
        const symbol = toText(event?.symbol).toUpperCase()
        const decisionDateKey = toText(event?.decisionDateKey)
        if (!symbol) throw new Error(`tokenized event missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`tokenized event invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
        }
        if (decisionDateKey < options.dateFrom || decisionDateKey > options.dateTo) return
        if (!Object.prototype.hasOwnProperty.call(event, "hitTarget")) {
          throw new Error(`tokenized event missing hitTarget at ${context.filePath}:${context.lineNumber}`)
        }
        const tokens = uniqueSorted(Array.isArray(event?.tokens) ? event.tokens : [])
        if (tokens.length < 1) return
        const tokenSet = new Set(tokens)
        for (const token of tokens) {
          const anchored = candidatesByAnchor.get(token) ?? []
          for (const candidate of anchored) {
            const matched = candidate.tokenSet.every((candidateToken) => tokenSet.has(candidateToken))
            if (!matched) continue
            const row = {
              kind: "tp12_candidate_event_v1",
              patternId: candidate.patternId,
              patternKind: candidate.patternKind,
              tokenSet: candidate.tokenSet,
              sourceEventId: event.eventId,
              symbol,
              decisionDateKey,
              asOfFeatureDateKey: event.asOfFeatureDateKey,
              entryDateKey: event.entryDateKey,
              hitTarget: event.hitTarget === true,
              ...copyOptionalLabelMetrics(event),
            }
            await writeJsonlRow(stream, row)
            outputRowCount += 1
            if (row.hitTarget) hitRowCount += 1
            incrementMap(matchCountsByPattern, candidate.patternId)
          }
        }
      },
    })
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
  const zeroMatchPatternIds = candidates
    .map((row) => row.patternId)
    .filter((patternId) => !matchCountsByPattern.has(patternId))
    .sort()
  const failures = []
  if (outputRowCount < 1) failures.push("zero_materialized_events")
  if (options.failOnZeroMatchCandidates && zeroMatchPatternIds.length > 0) {
    failures.push(`zero_match_candidates:${zeroMatchPatternIds.length}`)
  }
  const summary = {
    kind: "tp12_candidate_event_materialize_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    candidateCatalogPath: path.resolve(candidateCatalogPath),
    tokenizedEventsPath: path.resolve(tokenizedEventsPath),
    outEventsPath: path.resolve(outEventsPath),
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo,
    },
    inputTokenizedRowCount: inputRowCount,
    materializedTokenizedRowCount: tokenizedRowCount,
    outsideDateRowCount,
    requireYear2hitPassed: options.requireYear2hitPassed,
    requireCandidateQualityPassed: options.requireCandidateQualityPassed,
    failOnZeroMatchCandidates: options.failOnZeroMatchCandidates,
    inputCandidateCount,
    rejectedByYear2hitCount,
    rejectedByQualityCount,
    candidateCount: candidates.length,
    outputRowCount,
    hitRowCount,
    rowHitRate: outputRowCount > 0 ? hitRowCount / outputRowCount : 0,
    zeroMatchPatternIds,
    matchCountsByPattern: mapToSortedObject(matchCountsByPattern),
    failures,
  }
  if (outSummaryPath) await writeJson(outSummaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 candidate event materialization failed: ${failures.join("; ")}`)
  return summary
}
