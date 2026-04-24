import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, pathExists, readJson, readJsonl, writeJson } from "./io.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const toOptionalRoundedNumber = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}
const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}

const normalizeStringArray = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => toText(value))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const resolveOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const resolveApplyDateKey = (row) =>
  toText(row?.dateKey ?? row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.eventDate) || null

const normalizeMatchRow = (row) => {
  const matchedRuleIds = normalizeStringArray(row?.matchedRuleIds)
  return {
    dateKey: resolveApplyDateKey(row),
    recommendationDateKey: toText(row?.recommendationDateKey) || null,
    symbol: toText(row?.symbol) || null,
    name: toText(row?.name) || null,
    outcomeHitTarget: resolveOutcomeHitTarget(row),
    matchedRuleIds,
    matchedRuleCount: toNumber(row?.matchedRuleCount, matchedRuleIds.length),
    primaryRuleId: toText(row?.primaryRuleId) || null,
    asOfDateKey: toText(row?.asOfDateKey) || null,
    entryDateKey: toText(row?.entryDateKey) || null,
    exitDateKey: toText(row?.exitDateKey) || null,
    recommendationDateCloseRetPct: toOptionalRoundedNumber(row?.recommendationDateCloseRetPct, 6),
  }
}

const normalizeDedupedRow = (row) => ({
  ...normalizeMatchRow(row),
  supportingRuleIds: normalizeStringArray(row?.supportingRuleIds),
  bestOpenOosPrecision: toOptionalRoundedNumber(row?.bestOpenOosPrecision, 12),
  bestOpenOosHitCount: toOptionalRoundedNumber(row?.bestOpenOosHitCount, 0),
  consensusScore: toOptionalRoundedNumber(row?.consensusScore, 0),
})

const buildRowKey = (row, normalizer) => JSON.stringify(normalizer(row))

const buildRowMetrics = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const countsByDate = new Map()
  const symbolSet = new Set()
  let hitRows = 0
  for (const row of safeRows) {
    const dateKey = resolveApplyDateKey(row)
    if (dateKey) {
      countsByDate.set(dateKey, Number(countsByDate.get(dateKey) ?? 0) + 1)
    }
    const symbol = toText(row?.symbol)
    if (symbol) symbolSet.add(symbol)
    if (resolveOutcomeHitTarget(row) === true) hitRows += 1
  }
  const selectedRows = safeRows.length
  const orderedDateKeys = Array.from(countsByDate.keys()).sort((left, right) => left.localeCompare(right))
  const maxDateCount = countsByDate.size > 0 ? Math.max(...countsByDate.values()) : 0
  return {
    selectedRows,
    hitRows,
    hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
    uniqueMatchedDates: orderedDateKeys.length,
    uniqueMatchedSymbols: symbolSet.size,
    top1DateShare: selectedRows > 0 ? maxDateCount / selectedRows : 0,
    dateFrom: orderedDateKeys[0] ?? null,
    dateTo: orderedDateKeys[orderedDateKeys.length - 1] ?? null,
  }
}

const buildCountByDate = (rows = []) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = resolveApplyDateKey(row)
    if (!dateKey) continue
    counts.set(dateKey, Number(counts.get(dateKey) ?? 0) + 1)
  }
  return counts
}

const buildSetDifferenceSamples = ({
  leftRows,
  rightRows,
  normalizer,
  limit = 20,
}) => {
  const rightKeys = new Set((Array.isArray(rightRows) ? rightRows : []).map((row) => buildRowKey(row, normalizer)))
  const samples = []
  for (const row of Array.isArray(leftRows) ? leftRows : []) {
    const key = buildRowKey(row, normalizer)
    if (rightKeys.has(key)) continue
    samples.push(normalizer(row))
    if (samples.length >= limit) break
  }
  return samples
}

const loadRequestedDateKeys = async (dateListFile) => {
  const raw = await fs.readFile(dateListFile, "utf8")
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/u)
        .map((line) => toText(line))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

const readRequiredJson = async (filePath, label) => {
  const payload = await readJson(filePath, null)
  if (!payload || typeof payload !== "object") {
    throw new Error(`Missing ${label}: ${filePath}`)
  }
  return payload
}

export const buildTp12NoStopLb5LiveLikeOosReplaySummary = async ({
  contract,
  dateListFile,
  dayRunRoot,
  batchApplyDir,
  outPath,
  runId,
  failOnMismatch = true,
} = {}) => {
  const resolvedDateListFile = path.resolve(dateListFile ?? "")
  const resolvedDayRunRoot = path.resolve(dayRunRoot ?? "")
  const resolvedBatchApplyDir = path.resolve(batchApplyDir ?? "")
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!pathExists(resolvedDateListFile)) {
    throw new Error(`Missing requested date list: ${resolvedDateListFile}`)
  }
  if (!pathExists(resolvedBatchApplyDir)) {
    throw new Error(`Missing batch apply dir: ${resolvedBatchApplyDir}`)
  }
  const batchSummaryPath = path.join(resolvedBatchApplyDir, "summary.json")
  const batchMatchesPath = path.join(resolvedBatchApplyDir, "matches.jsonl")
  const batchDedupedPath = path.join(resolvedBatchApplyDir, "deduped_symbols.jsonl")
  if (!pathExists(batchSummaryPath) || !pathExists(batchMatchesPath) || !pathExists(batchDedupedPath)) {
    throw new Error(`Batch apply dir is missing required outputs: ${resolvedBatchApplyDir}`)
  }
  const requestedDateKeys = await loadRequestedDateKeys(resolvedDateListFile)
  if (requestedDateKeys.length < 1) {
    throw new Error(`requested date list is empty: ${resolvedDateListFile}`)
  }

  const batchSummary = await readRequiredJson(batchSummaryPath, "batch summary")
  const batchMatches = await readJsonl(batchMatchesPath)
  const batchDedupedRows = await readJsonl(batchDedupedPath)
  if (toText(batchSummary?.selectionMode).toLowerCase() !== toText(contract?.selectionMode).toLowerCase()) {
    throw new Error(
      `Batch selectionMode mismatch: expected=${contract?.selectionMode ?? "<null>"} actual=${batchSummary?.selectionMode ?? "<null>"}`,
    )
  }
  if (toNumber(batchSummary?.dedupedMatches, -1) !== toNumber(contract?.baselineMetrics?.oosSelectedRows, -2)) {
    throw new Error(
      `Batch selected rows drifted from contract baseline: batch=${batchSummary?.dedupedMatches ?? "<null>"} baseline=${contract?.baselineMetrics?.oosSelectedRows ?? "<null>"}`,
    )
  }
  if (toNumber(batchSummary?.lineLevelHitCount, -1) !== toNumber(contract?.baselineMetrics?.oosHitRows, -2)) {
    throw new Error(
      `Batch hit rows drifted from contract baseline: batch=${batchSummary?.lineLevelHitCount ?? "<null>"} baseline=${contract?.baselineMetrics?.oosHitRows ?? "<null>"}`,
    )
  }

  const replayMatches = []
  const replayDedupedRows = []
  const perDateSummaries = []
  const missingDateOutputs = []
  for (const dateKey of requestedDateKeys) {
    const dayDir = path.join(resolvedDayRunRoot, `date=${dateKey}`)
    const summaryPath = path.join(dayDir, "summary.json")
    const matchesPath = path.join(dayDir, "matches.jsonl")
    const dedupedPath = path.join(dayDir, "deduped_symbols.jsonl")
    if (!pathExists(summaryPath) || !pathExists(matchesPath) || !pathExists(dedupedPath)) {
      missingDateOutputs.push({
        dateKey,
        dayDir,
        hasSummary: pathExists(summaryPath),
        hasMatches: pathExists(matchesPath),
        hasDeduped: pathExists(dedupedPath),
      })
      continue
    }
    const [daySummary, dayMatches, dayDedupedRows] = await Promise.all([
      readRequiredJson(summaryPath, `day summary ${dateKey}`),
      readJsonl(matchesPath),
      readJsonl(dedupedPath),
    ])
    replayMatches.push(...dayMatches)
    replayDedupedRows.push(...dayDedupedRows)
    perDateSummaries.push({
      dateKey,
      sourceRows: toNumber(daySummary?.sourceRows, 0),
      rawMatches: toNumber(daySummary?.rawMatches, 0),
      dedupedMatches: toNumber(daySummary?.dedupedMatches, 0),
      lineLevelHitCount: toNumber(daySummary?.lineLevelHitCount, 0),
      lineLevelHitRate: toNumber(daySummary?.lineLevelHitRate, 0),
    })
  }
  if (missingDateOutputs.length > 0) {
    throw new Error(
      `Missing per-date live-like outputs for ${missingDateOutputs.length} requested dates under ${resolvedDayRunRoot}`,
    )
  }

  const batchRawByDate = buildCountByDate(batchMatches)
  const replayRawByDate = buildCountByDate(replayMatches)
  const batchDedupedByDate = buildCountByDate(batchDedupedRows)
  const replayDedupedByDate = buildCountByDate(replayDedupedRows)

  const rawCountMismatchDates = []
  const dedupedCountMismatchDates = []
  const allDateKeys = Array.from(
    new Set([
      ...batchRawByDate.keys(),
      ...replayRawByDate.keys(),
      ...batchDedupedByDate.keys(),
      ...replayDedupedByDate.keys(),
      ...requestedDateKeys,
    ]),
  ).sort((left, right) => left.localeCompare(right))
  for (const dateKey of allDateKeys) {
    const batchRawCount = Number(batchRawByDate.get(dateKey) ?? 0)
    const replayRawCount = Number(replayRawByDate.get(dateKey) ?? 0)
    const batchDedupedCount = Number(batchDedupedByDate.get(dateKey) ?? 0)
    const replayDedupedCount = Number(replayDedupedByDate.get(dateKey) ?? 0)
    if (batchRawCount !== replayRawCount) {
      rawCountMismatchDates.push({
        dateKey,
        batchRawCount,
        replayRawCount,
      })
    }
    if (batchDedupedCount !== replayDedupedCount) {
      dedupedCountMismatchDates.push({
        dateKey,
        batchDedupedCount,
        replayDedupedCount,
      })
    }
  }

  const batchRawKeys = new Set(batchMatches.map((row) => buildRowKey(row, normalizeMatchRow)))
  const replayRawKeys = new Set(replayMatches.map((row) => buildRowKey(row, normalizeMatchRow)))
  const batchDedupedKeys = new Set(batchDedupedRows.map((row) => buildRowKey(row, normalizeDedupedRow)))
  const replayDedupedKeys = new Set(replayDedupedRows.map((row) => buildRowKey(row, normalizeDedupedRow)))

  const rawSetMatch =
    batchRawKeys.size === replayRawKeys.size &&
    Array.from(batchRawKeys).every((key) => replayRawKeys.has(key))
  const dedupedSetMatch =
    batchDedupedKeys.size === replayDedupedKeys.size &&
    Array.from(batchDedupedKeys).every((key) => replayDedupedKeys.has(key))
  const rawCountByDateMatch = rawCountMismatchDates.length < 1
  const dedupedCountByDateMatch = dedupedCountMismatchDates.length < 1

  const batchMetrics = buildRowMetrics(batchDedupedRows)
  const replayMetrics = buildRowMetrics(replayDedupedRows)
  const status =
    rawSetMatch && dedupedSetMatch && rawCountByDateMatch && dedupedCountByDateMatch
      ? "equivalent"
      : "mismatch"

  const summary = {
    kind: "tp12_no_stop_lb5_live_like_oos_replay_summary_v1",
    contractId: toText(contract?.contractId),
    contractPath: toText(contract?.contractPath),
    runId: toText(runId),
    status,
    selectionMode: toText(contract?.selectionMode),
    scopeId: toText(contract?.scopeId),
    baseCandidateId: toText(contract?.baseCandidateId),
    requestedDateCount: requestedDateKeys.length,
    requestedDateFrom: requestedDateKeys[0] ?? null,
    requestedDateTo: requestedDateKeys[requestedDateKeys.length - 1] ?? null,
    baseline: contract?.baselineMetrics ?? {},
    batch: {
      applyDir: resolvedBatchApplyDir,
      summaryPath: batchSummaryPath,
      rawMatches: batchMatches.length,
      dedupedMatches: batchDedupedRows.length,
      metrics: batchMetrics,
    },
    replay: {
      dayRunRoot: resolvedDayRunRoot,
      dateListFile: resolvedDateListFile,
      rawMatches: replayMatches.length,
      dedupedMatches: replayDedupedRows.length,
      metrics: replayMetrics,
    },
    equality: {
      rawSetMatch,
      dedupedSetMatch,
      rawCountByDateMatch,
      dedupedCountByDateMatch,
    },
    mismatchSamples: {
      rawMissingFromReplay: buildSetDifferenceSamples({
        leftRows: batchMatches,
        rightRows: replayMatches,
        normalizer: normalizeMatchRow,
      }),
      rawExtraInReplay: buildSetDifferenceSamples({
        leftRows: replayMatches,
        rightRows: batchMatches,
        normalizer: normalizeMatchRow,
      }),
      dedupedMissingFromReplay: buildSetDifferenceSamples({
        leftRows: batchDedupedRows,
        rightRows: replayDedupedRows,
        normalizer: normalizeDedupedRow,
      }),
      dedupedExtraInReplay: buildSetDifferenceSamples({
        leftRows: replayDedupedRows,
        rightRows: batchDedupedRows,
        normalizer: normalizeDedupedRow,
      }),
      rawCountMismatchDates: rawCountMismatchDates.slice(0, 20),
      dedupedCountMismatchDates: dedupedCountMismatchDates.slice(0, 20),
    },
  }

  await ensureDir(path.dirname(resolvedOutPath))
  await writeJson(resolvedOutPath, summary)
  const perDatePath = path.join(path.dirname(resolvedOutPath), "per_date_summary.jsonl")
  await fs.writeFile(
    perDatePath,
    `${perDateSummaries.map((row) => JSON.stringify(row)).join("\n")}${perDateSummaries.length > 0 ? "\n" : ""}`,
    "utf8",
  )
  const reportPath = path.join(path.dirname(resolvedOutPath), "live_like_oos_replay_report.md")
  const reportLines = [
    "# TP12 No-Stop lb5 live-like OOS replay audit",
    "",
    "## Verdict",
    "",
    `- status: \`${summary.status}\``,
    `- raw set match: ${summary.equality.rawSetMatch}`,
    `- deduped set match: ${summary.equality.dedupedSetMatch}`,
    `- raw count-by-date match: ${summary.equality.rawCountByDateMatch}`,
    `- deduped count-by-date match: ${summary.equality.dedupedCountByDateMatch}`,
    "",
    "## Batch vs Replay",
    "",
    `- requested dates: ${summary.requestedDateCount} (${summary.requestedDateFrom} ~ ${summary.requestedDateTo})`,
    `- batch raw/deduped: ${summary.batch.rawMatches}/${summary.batch.dedupedMatches}`,
    `- replay raw/deduped: ${summary.replay.rawMatches}/${summary.replay.dedupedMatches}`,
    `- batch OOS: ${summary.batch.metrics.hitRows}/${summary.batch.metrics.selectedRows} = ${pct(summary.batch.metrics.hitRate)}`,
    `- replay OOS: ${summary.replay.metrics.hitRows}/${summary.replay.metrics.selectedRows} = ${pct(summary.replay.metrics.hitRate)}`,
    "",
  ]
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")

  if (status !== "equivalent" && failOnMismatch) {
    throw new Error(`Live-like OOS replay mismatch detected: ${resolvedOutPath}`)
  }
  return {
    outPath: resolvedOutPath,
    reportPath,
    perDatePath,
    summary,
  }
}
