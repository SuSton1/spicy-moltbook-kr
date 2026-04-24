import path from "node:path"

import { readJson, writeJson, writeJsonl } from "./io.mjs"
import { loadTp12Contract } from "./tp12_label_event_builder.mjs"
import { sha256TextLines } from "./tp12_year2hit_train_gate.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertTp12OperationalHitRow,
  isTp12OperationalHitDefinition,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

export const deriveTp12QualityGateOptionsFromContract = (contract = {}) => {
  const config = contract.qualityGate ?? {}
  return {
    minRowPrecision: config.minRowPrecision,
    minDatePrecision: config.minDatePrecision,
    minHitRows: config.minHitRows,
    minUniqueHitDates: config.minUniqueHitDates,
    minUniqueHitSymbols: config.minUniqueHitSymbols,
    maxTop1HitDateShare: config.maxTop1HitDateShare,
    maxTop1MatchDateShare: config.maxTop1MatchDateShare,
    maxMatchRows: config.maxMatchRows,
    hitDefinition: config.hitDefinition ?? contract.hitDefinition,
    hitField:
      config.hitField ??
      contract.operationalHit?.operationalHitField ??
      contract.oosResultGate?.hitField ??
      contract.hitField,
    failOnZeroQualitySurvivors: config.failOnZeroQualitySurvivors,
  }
}

const resolveOptions = ({ contract, ...raw }) => {
  const contractOptions = contract ? deriveTp12QualityGateOptionsFromContract(contract) : {}
  return {
    minRowPrecision: Math.max(0, Number(raw.minRowPrecision ?? contractOptions.minRowPrecision ?? 0)),
    minDatePrecision: Math.max(0, Number(raw.minDatePrecision ?? contractOptions.minDatePrecision ?? 0)),
    minHitRows: Math.max(0, Number(raw.minHitRows ?? contractOptions.minHitRows ?? 0)),
    minUniqueHitDates: Math.max(0, Number(raw.minUniqueHitDates ?? contractOptions.minUniqueHitDates ?? 0)),
    minUniqueHitSymbols: Math.max(0, Number(raw.minUniqueHitSymbols ?? contractOptions.minUniqueHitSymbols ?? 0)),
    maxTop1HitDateShare: Math.min(1, Math.max(0, Number(raw.maxTop1HitDateShare ?? contractOptions.maxTop1HitDateShare ?? 1))),
    maxTop1MatchDateShare: Math.min(1, Math.max(0, Number(raw.maxTop1MatchDateShare ?? contractOptions.maxTop1MatchDateShare ?? 1))),
    maxMatchRows: Math.max(0, Number(raw.maxMatchRows ?? contractOptions.maxMatchRows ?? 0)),
    hitDefinition: toText(raw.hitDefinition) || toText(contractOptions.hitDefinition),
    hitField: toText(raw.hitField) || toText(contractOptions.hitField) || "hitTarget",
    failOnZeroQualitySurvivors: toBool(raw.failOnZeroQualitySurvivors ?? contractOptions.failOnZeroQualitySurvivors, true),
  }
}

const loadTrainGateSurvivorIds = async (trainGateSummaryPath) => {
  const summary = await readJson(trainGateSummaryPath, null)
  if (!summary) throw new Error(`train gate summary not found: ${trainGateSummaryPath}`)
  if (toText(summary.status) !== "passed") throw new Error(`train gate summary is not passed: ${toText(summary.status) || "missing"}`)
  const ids = Array.isArray(summary.survivorPatternIds)
    ? summary.survivorPatternIds
    : (Array.isArray(summary.survivors) ? summary.survivors : []).map((row) => row?.patternId)
  const survivorPatternIds = uniqueSorted(ids)
  if (survivorPatternIds.length < 1) throw new Error("train gate summary has zero survivors")
  return { summary, survivorPatternIds, survivorSet: new Set(survivorPatternIds) }
}

const readCandidateCatalogMap = async (candidateCatalogPath) => {
  const rows = []
  if (toText(candidateCatalogPath).endsWith(".jsonl") || toText(candidateCatalogPath).endsWith(".jsonl.gz")) {
    await iterateJsonlMaybeGzip(candidateCatalogPath, {
      strict: true,
      onRow: async (row, context) => {
        const patternId = toText(row?.patternId)
        if (!patternId) throw new Error(`candidate catalog row missing patternId at ${context.filePath}:${context.lineNumber}`)
        rows.push({ ...row, patternId })
      },
    })
  } else {
    const payload = await readJson(candidateCatalogPath, null)
    if (!payload) throw new Error(`candidate catalog not found: ${candidateCatalogPath}`)
    const sourceRows = Array.isArray(payload)
      ? payload
      : ["candidates", "patterns", "rules", "rows"].flatMap((key) => (Array.isArray(payload[key]) ? payload[key] : []))
    for (const [index, row] of sourceRows.entries()) {
      const patternId = toText(row?.patternId)
      if (!patternId) throw new Error(`candidate catalog row missing patternId at JSON index ${index}`)
      rows.push({ ...row, patternId })
    }
  }
  const lookup = new Map()
  for (const row of rows) {
    if (lookup.has(row.patternId)) throw new Error(`duplicate candidate patternId: ${row.patternId}`)
    lookup.set(row.patternId, row)
  }
  return lookup
}

const collectEventsByPattern = async ({ candidateEventsPath, survivorSet, hitField, hitDefinition }) => {
  const byPattern = new Map()
  let inputRowCount = 0
  let ignoredNonSurvivorRowCount = 0
  await iterateJsonlMaybeGzip(candidateEventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const patternId = toText(row?.patternId)
      const decisionDateKey = toText(row?.decisionDateKey)
      const symbol = toText(row?.symbol).toUpperCase()
      if (!patternId) throw new Error(`candidate event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`candidate event row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (!symbol) throw new Error(`candidate event row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (isTp12OperationalHitDefinition(hitDefinition)) {
        if (hitField !== TP12_OPERATIONAL_HIT_FIELD) {
          throw new Error(`operational quality gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
        }
        assertTp12OperationalHitRow(row, {
          context: `${context.filePath}:${context.lineNumber}`,
          hitField,
        })
      }
      if (!Object.prototype.hasOwnProperty.call(row, hitField)) {
        throw new Error(`candidate event row missing ${hitField} at ${context.filePath}:${context.lineNumber}`)
      }
      if (!survivorSet.has(patternId)) {
        ignoredNonSurvivorRowCount += 1
        return
      }
      const rows = byPattern.get(patternId) ?? []
      rows.push({ patternId, decisionDateKey, symbol, hitTarget: row[hitField] === true })
      byPattern.set(patternId, rows)
    },
  })
  return { byPattern, inputRowCount, ignoredNonSurvivorRowCount }
}

const buildMetrics = ({ patternId, rows, catalogRow, options }) => {
  const matchedDates = new Set()
  const hitDates = new Set()
  const matchedSymbols = new Set()
  const hitSymbols = new Set()
  const matchRowsByDate = new Map()
  const hitRowsByDate = new Map()
  let hitRows = 0
  for (const row of rows) {
    matchedDates.add(row.decisionDateKey)
    matchedSymbols.add(row.symbol)
    incrementMap(matchRowsByDate, row.decisionDateKey)
    if (row.hitTarget) {
      hitRows += 1
      hitDates.add(row.decisionDateKey)
      hitSymbols.add(row.symbol)
      incrementMap(hitRowsByDate, row.decisionDateKey)
    }
  }
  const matchRows = rows.length
  const rowPrecision = matchRows > 0 ? hitRows / matchRows : 0
  const datePrecision = matchedDates.size > 0 ? hitDates.size / matchedDates.size : 0
  const top1HitDateShare = hitRows > 0 ? Math.max(0, ...hitRowsByDate.values()) / hitRows : 0
  const top1MatchDateShare = matchRows > 0 ? Math.max(0, ...matchRowsByDate.values()) / matchRows : 0
  const rejectReasons = []
  if (rowPrecision < options.minRowPrecision) rejectReasons.push("row_precision_below_min")
  if (datePrecision < options.minDatePrecision) rejectReasons.push("date_precision_below_min")
  if (hitRows < options.minHitRows) rejectReasons.push("hit_rows_below_min")
  if (hitDates.size < options.minUniqueHitDates) rejectReasons.push("unique_hit_dates_below_min")
  if (hitSymbols.size < options.minUniqueHitSymbols) rejectReasons.push("unique_hit_symbols_below_min")
  if (top1HitDateShare > options.maxTop1HitDateShare) rejectReasons.push("top1_hit_date_share_above_max")
  if (top1MatchDateShare > options.maxTop1MatchDateShare) rejectReasons.push("top1_match_date_share_above_max")
  if (options.maxMatchRows > 0 && matchRows > options.maxMatchRows) rejectReasons.push("match_rows_above_max")
  return {
    kind: "tp12_year2hit_quality_survivor_v1",
    patternId,
    status: rejectReasons.length > 0 ? "rejected" : "passed",
    tokenSet: catalogRow?.tokenSet ?? catalogRow?.tokens ?? [],
    patternKind: catalogRow?.patternKind ?? null,
    matchRows,
    hitRows,
    rowPrecision,
    matchedDateCount: matchedDates.size,
    hitDateCount: hitDates.size,
    datePrecision,
    uniqueMatchedSymbols: matchedSymbols.size,
    uniqueHitSymbols: hitSymbols.size,
    top1HitDateShare,
    top1MatchDateShare,
    rejectReasons,
  }
}

export const buildTp12Year2hitQualityGateSummary = async ({
  trainGateSummaryPath,
  candidateEventsPath,
  candidateCatalogPath,
  contractPath = null,
  outSummaryPath,
  outSurvivorsPath,
  outRejectedPath,
  outFilteredTrainGateSummaryPath,
  ...rawOptions
} = {}) => {
  if (!toText(trainGateSummaryPath)) throw new Error("trainGateSummaryPath is required")
  if (!toText(candidateEventsPath)) throw new Error("candidateEventsPath is required")
  if (!toText(candidateCatalogPath)) throw new Error("candidateCatalogPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  if (isTp12OperationalHitDefinition(options.hitDefinition) && options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`operational quality gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  const { summary: trainGateSummary, survivorPatternIds, survivorSet } = await loadTrainGateSurvivorIds(trainGateSummaryPath)
  const catalog = await readCandidateCatalogMap(candidateCatalogPath)
  const missingCatalogIds = survivorPatternIds.filter((patternId) => !catalog.has(patternId))
  if (missingCatalogIds.length > 0) {
    throw new Error(`train gate survivors missing from candidate catalog: ${missingCatalogIds.join(",")}`)
  }
  const { byPattern, inputRowCount, ignoredNonSurvivorRowCount } = await collectEventsByPattern({
    candidateEventsPath,
    survivorSet,
    hitField: options.hitField,
    hitDefinition: options.hitDefinition,
  })
  const missingEventIds = survivorPatternIds.filter((patternId) => !byPattern.has(patternId))
  if (missingEventIds.length > 0) throw new Error(`train gate survivors missing candidate events: ${missingEventIds.join(",")}`)
  const passed = []
  const rejected = []
  const rejectReasonCounts = new Map()
  for (const patternId of survivorPatternIds) {
    const row = buildMetrics({
      patternId,
      rows: byPattern.get(patternId),
      catalogRow: catalog.get(patternId),
      options,
    })
    if (row.status === "passed") {
      passed.push(row)
    } else {
      rejected.push(row)
      for (const reason of row.rejectReasons) incrementMap(rejectReasonCounts, reason)
    }
  }
  const passedPatternIds = passed.map((row) => row.patternId).sort()
  const rejectedPatternIds = rejected.map((row) => row.patternId).sort()
  const trainGateSurvivorPatternIdsSha256 =
    trainGateSummary.survivorPatternIdsSha256 ?? sha256TextLines(survivorPatternIds)
  const passedPatternIdsSha256 = sha256TextLines(passedPatternIds)
  const rejectedPatternIdsSha256 = sha256TextLines(rejectedPatternIds)
  const failures = []
  if (options.failOnZeroQualitySurvivors && passed.length < 1) failures.push("zero_quality_survivors")
  const payload = {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    hitDefinition:
      options.hitDefinition || (options.hitField === TP12_OPERATIONAL_HIT_FIELD ? TP12_OPERATIONAL_HIT_DEFINITION : "chart_hit_v1"),
    hitField: options.hitField,
    trainGateSummaryPath: path.resolve(trainGateSummaryPath),
    candidateEventsPath: path.resolve(candidateEventsPath),
    candidateCatalogPath: path.resolve(candidateCatalogPath),
    trainGateSurvivorPatternIdsSha256,
    survivorPatternIdsSha256: trainGateSurvivorPatternIdsSha256,
    passedPatternIdsSha256,
    rejectedPatternIdsSha256,
    inputCandidateEventRowCount: inputRowCount,
    ignoredNonSurvivorRowCount,
    trainGateSurvivorCount: survivorPatternIds.length,
    passedSurvivorCount: passed.length,
    rejectedSurvivorCount: rejected.length,
    passedPatternIds,
    rejectedPatternIds,
    rejectReasonCounts: mapToSortedObject(rejectReasonCounts),
    options,
    failures,
    passed,
    rejected,
  }
  await writeJson(outSummaryPath, payload)
  if (outSurvivorsPath) await writeJsonl(outSurvivorsPath, passed)
  if (outRejectedPath) await writeJsonl(outRejectedPath, rejected)
  if (outFilteredTrainGateSummaryPath) {
    await writeJson(outFilteredTrainGateSummaryPath, {
      kind: "tp12_year2hit_quality_filtered_train_gate_summary_v1",
      generatedAt: new Date().toISOString(),
      status: failures.length > 0 ? "failed" : "passed",
      sourceTrainGateSummaryPath: path.resolve(trainGateSummaryPath),
      sourceQualityGateSummaryPath: path.resolve(outSummaryPath),
      trainDateRange: trainGateSummary.trainDateRange ?? null,
      coreYears: trainGateSummary.coreYears ?? null,
      minHitsPerCoreYear: trainGateSummary.minHitsPerCoreYear ?? null,
      survivorPatternIds: passedPatternIds,
      survivorPatternIdsSha256: passedPatternIdsSha256,
      survivorCount: passedPatternIds.length,
      originalTrainGateSurvivorCount: survivorPatternIds.length,
      rejectedByQualityCount: rejectedPatternIds.length,
      trainGateSurvivorPatternIdsSha256,
      qualityGateOptions: options,
      failures,
    })
  }
  if (failures.length > 0) throw new Error(`tp12 year2hit quality gate failed: ${failures.join("; ")}`)
  return payload
}
