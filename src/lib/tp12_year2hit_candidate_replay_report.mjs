import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertTp12OperationalHitRow,
  buildTp12MonthlyCadenceSummary,
  isTp12OperationalHitDefinition,
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

const resolvePatternId = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const readCandidateCatalogRows = async (candidateCatalogPath) => {
  const rows = []
  const sourcePath = toText(candidateCatalogPath)
  if (!sourcePath) throw new Error("candidateCatalogPath is required")
  if (sourcePath.endsWith(".jsonl") || sourcePath.endsWith(".jsonl.gz")) {
    await iterateJsonlMaybeGzip(sourcePath, {
      strict: true,
      onRow: async (row, context) => {
        const patternId = resolvePatternId(row)
        if (!patternId) throw new Error(`candidate catalog row missing patternId at ${context.filePath}:${context.lineNumber}`)
        rows.push({ ...row, patternId })
      },
    })
  } else {
    const payload = await readJson(sourcePath, null)
    if (!payload) throw new Error(`candidate catalog not found: ${sourcePath}`)
    const sourceRows = Array.isArray(payload)
      ? payload
      : ["candidates", "patterns", "rules", "rows"].flatMap((key) => (Array.isArray(payload[key]) ? payload[key] : []))
    for (const [index, row] of sourceRows.entries()) {
      const patternId = resolvePatternId(row)
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

const emptyMetricState = () => ({
  rowCount: 0,
  hitRows: 0,
  matchedDates: new Set(),
  hitDates: new Set(),
  matchedSymbols: new Set(),
  hitSymbols: new Set(),
  matchRowsByDate: new Map(),
  hitRowsByDate: new Map(),
})

const addMetricRow = (state, row) => {
  state.rowCount += 1
  state.matchedDates.add(row.decisionDateKey)
  state.matchedSymbols.add(row.symbol)
  incrementMap(state.matchRowsByDate, row.decisionDateKey)
  if (row.hitTarget === true) {
    state.hitRows += 1
    state.hitDates.add(row.decisionDateKey)
    state.hitSymbols.add(row.symbol)
    incrementMap(state.hitRowsByDate, row.decisionDateKey)
  }
}

const readReplayHit = ({ event, hitField, hitDefinition, context }) => {
  const field = toText(hitField || "hitTarget")
  if (!field) throw new Error("hitField is required")
  if (isTp12OperationalHitDefinition(hitDefinition)) {
    if (field !== TP12_OPERATIONAL_HIT_FIELD) {
      throw new Error(`operational replay requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
    }
    assertTp12OperationalHitRow(event, { context, hitField: field })
  }
  if (!Object.prototype.hasOwnProperty.call(event, field)) {
    throw new Error(`candidate event row missing ${field} at ${context}`)
  }
  return event[field] === true
}

const finalizeMetricState = (state) => {
  const selectedRows = state.rowCount
  const top1DateCount = selectedRows > 0 ? Math.max(0, ...state.matchRowsByDate.values()) : 0
  const top1HitDateCount = state.hitRows > 0 ? Math.max(0, ...state.hitRowsByDate.values()) : 0
  return {
    selectedRows,
    hitRows: state.hitRows,
    hitRate: safeRatio(state.hitRows, selectedRows),
    uniqueMatchedDates: state.matchedDates.size,
    uniqueHitDates: state.hitDates.size,
    dateHitRate: safeRatio(state.hitDates.size, state.matchedDates.size),
    uniqueMatchedSymbols: state.matchedSymbols.size,
    uniqueHitSymbols: state.hitSymbols.size,
    top1DateCount,
    top1DateShare: safeRatio(top1DateCount, selectedRows),
    top1HitDateCount,
    top1HitDateShare: safeRatio(top1HitDateCount, state.hitRows),
  }
}

const candidateTrainScore = (candidate) => ({
  rowPrecision: toNumber(candidate?.rowPrecision, 0),
  datePrecision: toNumber(candidate?.datePrecision, 0),
  minYearHitDates: toNumber(candidate?.minYearHitDates, 0),
  hitRows: toNumber(candidate?.hitRows, 0),
  matchRows: toNumber(candidate?.matchRows, 0),
})

const requireFiniteCatalogMetric = ({ candidate, field, patternId }) => {
  if (!Object.prototype.hasOwnProperty.call(candidate ?? {}, field)) {
    throw new Error(`candidate ${patternId} missing train metric for schedulerScore: ${field}`)
  }
  const value = toNumber(candidate[field])
  if (!Number.isFinite(value)) throw new Error(`candidate ${patternId} has non-finite train metric ${field}: ${candidate[field]}`)
  return value
}

export const buildTp12ReplaySchedulerScore = (candidate) => {
  const patternId = resolvePatternId(candidate)
  if (!patternId) throw new Error("candidate missing patternId for schedulerScore")
  const rowPrecision = requireFiniteCatalogMetric({ candidate, field: "rowPrecision", patternId })
  const datePrecision = requireFiniteCatalogMetric({ candidate, field: "datePrecision", patternId })
  const minYearHitDates = requireFiniteCatalogMetric({ candidate, field: "minYearHitDates", patternId })
  const hitRows = requireFiniteCatalogMetric({ candidate, field: "hitRows", patternId })
  const matchRows = requireFiniteCatalogMetric({ candidate, field: "matchRows", patternId })
  return (
    rowPrecision * 1_000_000 +
    datePrecision * 10_000 +
    minYearHitDates * 100 +
    hitRows +
    1 / (1 + Math.max(0, matchRows))
  )
}

const compareReplayRows = (left, right, catalog) => {
  const leftCandidate = catalog.get(left.patternId)
  const rightCandidate = catalog.get(right.patternId)
  const leftScore = candidateTrainScore(leftCandidate)
  const rightScore = candidateTrainScore(rightCandidate)
  return (
    rightScore.rowPrecision - leftScore.rowPrecision ||
    rightScore.datePrecision - leftScore.datePrecision ||
    rightScore.minYearHitDates - leftScore.minYearHitDates ||
    rightScore.hitRows - leftScore.hitRows ||
    leftScore.matchRows - rightScore.matchRows ||
    left.patternId.localeCompare(right.patternId) ||
    left.symbol.localeCompare(right.symbol)
  )
}

const buildPatternSummary = ({ patternId, state, candidate }) => ({
  patternId,
  patternKind: candidate?.patternKind ?? null,
  tokenSet: Array.isArray(candidate?.tokenSet) ? candidate.tokenSet : Array.isArray(candidate?.tokens) ? candidate.tokens : [],
  train: {
    matchRows: toNumber(candidate?.matchRows, 0),
    hitRows: toNumber(candidate?.hitRows, 0),
    rowPrecision: toNumber(candidate?.rowPrecision, 0),
    matchedDateCount: toNumber(candidate?.matchedDateCount, 0),
    hitDateCount: toNumber(candidate?.hitDateCount, 0),
    datePrecision: toNumber(candidate?.datePrecision, 0),
    minYearHitDates: toNumber(candidate?.minYearHitDates, 0),
    top1HitDateShare: toNumber(candidate?.top1HitDateShare, 0),
    top1MatchDateShare: toNumber(candidate?.top1MatchDateShare, 0),
  },
  oos: finalizeMetricState(state),
})

const writeRows = async (filePath, rows) => {
  if (!toText(filePath)) return
  await ensureDir(path.dirname(filePath))
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
}

const renderReport = (summary) => {
  const pct = (value) => `${(toNumber(value, 0) * 100).toFixed(2)}%`
  return [
    "# TP12 Year2Hit Gated Catalog OOS Replay",
    "",
    `- status: ${summary.status}`,
    `- date range: ${summary.dateRange.from} .. ${summary.dateRange.to}`,
    `- catalog patterns: ${summary.catalogPatternCount}`,
    `- materialized candidate events: ${summary.materialize?.outputRowCount ?? 0}`,
    `- raw pattern-match OOS: ${summary.rawPatternMatch.hitRows}/${summary.rawPatternMatch.selectedRows} = ${pct(summary.rawPatternMatch.hitRate)}`,
    `- symbol/date union OOS: ${summary.symbolDateUnion.hitRows}/${summary.symbolDateUnion.selectedRows} = ${pct(summary.symbolDateUnion.hitRate)}`,
    `- one-pick-per-day OOS: ${summary.onePickPerDay.hitRows}/${summary.onePickPerDay.selectedRows} = ${pct(summary.onePickPerDay.hitRate)}`,
    `- one-pick unique dates: ${summary.onePickPerDay.uniqueMatchedDates}`,
    `- one-pick top1DateShare: ${pct(summary.onePickPerDay.top1DateShare)}`,
    "",
    "## Top OOS Patterns",
    "",
    ...summary.topPatterns.slice(0, 20).map((row) =>
      `- ${row.patternId}: oos ${row.oos.hitRows}/${row.oos.selectedRows} = ${pct(row.oos.hitRate)}, train ${pct(row.train.rowPrecision)}, tokens=${row.tokenSet.join(" + ")}`,
    ),
    "",
  ].join("\n")
}

export const buildTp12Year2hitCandidateReplayReport = async ({
  candidateEventsPath,
  candidateCatalogPath,
  outSummaryPath,
  outReportPath = "",
  outSymbolDateUnionPath = "",
  outOnePickPerDayPath = "",
  labelSummaryPath = "",
  tokenizedSummaryPath = "",
  materializeSummaryPath = "",
  preflightSummaryPath = "",
  dateFrom = "",
  dateTo = "",
  hitDefinition = "",
  hitField = "hitTarget",
  minExecutableRecommendationsPerFullMonth = 5,
  fullMonthKeys = null,
} = {}) => {
  if (!toText(candidateEventsPath)) throw new Error("candidateEventsPath is required")
  if (!toText(candidateCatalogPath)) throw new Error("candidateCatalogPath is required")
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const catalog = await readCandidateCatalogRows(candidateCatalogPath)
  const activeHitDefinition = toText(hitDefinition)
  const activeHitField = toText(hitField || "hitTarget")
  if (isTp12OperationalHitDefinition(activeHitDefinition) && activeHitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`operational replay requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (catalog.size < 1) throw new Error("candidate catalog has zero patterns")
  const rawState = emptyMetricState()
  const patternStates = new Map()
  const symbolDateRows = new Map()
  const bestByDate = new Map()
  let inputCandidateEventRowCount = 0
  let outsideDateRowCount = 0
  await iterateJsonlMaybeGzip(candidateEventsPath, {
    strict: true,
    onRow: async (event, context) => {
      inputCandidateEventRowCount += 1
      const patternId = resolvePatternId(event)
      const symbol = toText(event?.symbol).toUpperCase()
      const decisionDateKey = toText(event?.decisionDateKey)
      if (!patternId) throw new Error(`candidate event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!catalog.has(patternId)) throw new Error(`candidate event references pattern outside gated catalog: ${patternId}`)
      if (!symbol) throw new Error(`candidate event row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`candidate event row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey}`)
      }
      if (toText(dateFrom) && decisionDateKey < toText(dateFrom)) {
        outsideDateRowCount += 1
        return
      }
      if (toText(dateTo) && decisionDateKey > toText(dateTo)) {
        outsideDateRowCount += 1
        return
      }
      const hit = readReplayHit({
        event,
        hitField: activeHitField,
        hitDefinition: activeHitDefinition,
        context: `${context.filePath}:${context.lineNumber}`,
      })
      const replayRow = {
        patternId,
        symbol,
        decisionDateKey,
        hitTarget: hit,
        [activeHitField]: hit,
        chartHitTarget: Object.prototype.hasOwnProperty.call(event, "chartHitTarget") ? event.chartHitTarget === true : undefined,
        entryExecutable: Object.prototype.hasOwnProperty.call(event, "entryExecutable") ? event.entryExecutable === true : undefined,
        hitDefinition: Object.prototype.hasOwnProperty.call(event, "hitDefinition") ? toText(event.hitDefinition) : undefined,
        executionPolicyId: Object.prototype.hasOwnProperty.call(event, "executionPolicyId") ? toText(event.executionPolicyId) : undefined,
        entryDateKey: Object.prototype.hasOwnProperty.call(event, "entryDateKey") ? toText(event.entryDateKey) : undefined,
        operationalMissReasons: Array.isArray(event.operationalMissReasons) ? event.operationalMissReasons : undefined,
        operationalMissReason: Object.prototype.hasOwnProperty.call(event, "operationalMissReason")
          ? event.operationalMissReason
          : undefined,
      }
      addMetricRow(rawState, replayRow)
      const patternState = patternStates.get(patternId) ?? emptyMetricState()
      addMetricRow(patternState, replayRow)
      patternStates.set(patternId, patternState)
      const symbolDateKey = `${decisionDateKey}::${symbol}`
      const existing = symbolDateRows.get(symbolDateKey)
      if (existing && existing.hitTarget !== replayRow.hitTarget) {
        throw new Error(`conflicting hitTarget for symbol/date ${symbolDateKey}`)
      }
      const unionRow = existing ?? {
        decisionDateKey,
        symbol,
        hitTarget: replayRow.hitTarget,
        [activeHitField]: replayRow[activeHitField],
        chartHitTarget: replayRow.chartHitTarget,
        entryExecutable: replayRow.entryExecutable,
        supportPatternIds: [],
      }
      unionRow.supportPatternIds = uniqueSorted([...unionRow.supportPatternIds, patternId])
      unionRow.supportPatternCount = unionRow.supportPatternIds.length
      symbolDateRows.set(symbolDateKey, unionRow)
      const currentBest = bestByDate.get(decisionDateKey)
      if (!currentBest || compareReplayRows(replayRow, currentBest, catalog) < 0) {
        bestByDate.set(decisionDateKey, replayRow)
      }
    },
  })
  const symbolDateUnionRows = [...symbolDateRows.values()].sort(
    (left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol),
  )
  const onePickPerDayRows = [...bestByDate.values()]
    .sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey))
    .map((row) => {
      const candidate = catalog.get(row.patternId)
      return {
        ...row,
        selectedPatternTrainRowPrecision: toNumber(candidate?.rowPrecision, 0),
        selectedPatternTrainDatePrecision: toNumber(candidate?.datePrecision, 0),
        selectedPatternMinYearHitDates: toNumber(candidate?.minYearHitDates, 0),
        schedulerScore: buildTp12ReplaySchedulerScore(candidate),
        schedulerScoreSource: "train_catalog_quality_v1",
        schedulerScoreSelectionFieldContract: "no_entry_no_hit_selection_fields_v1",
      }
    })
  const symbolDateState = emptyMetricState()
  for (const row of symbolDateUnionRows) addMetricRow(symbolDateState, row)
  const onePickState = emptyMetricState()
  for (const row of onePickPerDayRows) addMetricRow(onePickState, row)
  const topPatterns = [...patternStates.entries()]
    .map(([patternId, state]) => buildPatternSummary({ patternId, state, candidate: catalog.get(patternId) }))
    .sort(
      (left, right) =>
        right.oos.hitRate - left.oos.hitRate ||
        right.oos.hitRows - left.oos.hitRows ||
        right.oos.selectedRows - left.oos.selectedRows ||
        left.patternId.localeCompare(right.patternId),
    )
  const readOptionalJson = async (filePath) => (toText(filePath) ? await readJson(filePath, null) : null)
  const summary = {
    kind: "tp12_year2hit_candidate_replay_summary_v1",
    generatedAt: new Date().toISOString(),
    status: rawState.rowCount > 0 ? "measured" : "no_oos_matches",
    hitDefinition:
      activeHitDefinition || (activeHitField === TP12_OPERATIONAL_HIT_FIELD ? TP12_OPERATIONAL_HIT_DEFINITION : "chart_hit_v1"),
    hitField: activeHitField,
    candidateEventsPath: path.resolve(candidateEventsPath),
    candidateCatalogPath: path.resolve(candidateCatalogPath),
    dateRange: {
      from: toText(dateFrom) || null,
      to: toText(dateTo) || null,
    },
    catalogPatternCount: catalog.size,
    catalogMatchedPatternCount: patternStates.size,
    catalogUnmatchedPatternCount: catalog.size - patternStates.size,
    inputCandidateEventRowCount,
    outsideDateRowCount,
    label: await readOptionalJson(labelSummaryPath),
    tokenized: await readOptionalJson(tokenizedSummaryPath),
    materialize: await readOptionalJson(materializeSummaryPath),
    preflight: await readOptionalJson(preflightSummaryPath),
    rawPatternMatch: finalizeMetricState(rawState),
    symbolDateUnion: finalizeMetricState(symbolDateState),
    onePickPerDay: finalizeMetricState(onePickState),
    monthlyCadence:
      activeHitField === TP12_OPERATIONAL_HIT_FIELD
        ? buildTp12MonthlyCadenceSummary(onePickPerDayRows, {
            minExecutableRecommendationsPerFullMonth,
            fullMonthKeys,
            hitField: activeHitField,
          })
        : null,
    topPatterns,
  }
  await ensureDir(path.dirname(outSummaryPath))
  await writeJson(outSummaryPath, summary)
  await writeRows(outSymbolDateUnionPath, symbolDateUnionRows)
  await writeRows(outOnePickPerDayPath, onePickPerDayRows)
  if (toText(outReportPath)) {
    await ensureDir(path.dirname(outReportPath))
    await fs.promises.writeFile(outReportPath, renderReport(summary), "utf8")
  }
  return summary
}
