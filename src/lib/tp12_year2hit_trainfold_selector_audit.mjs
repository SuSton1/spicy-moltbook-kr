import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
} from "./tp12_year2hit_foundation_io.mjs"

const DEFAULT_TOP_CUTS = [20, 40, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000, 1200, 1600]

const resolvePatternId = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const parseCoreYears = (coreYears) => {
  if (Array.isArray(coreYears)) {
    return coreYears
      .map((year) => Number(year))
      .filter((year) => Number.isInteger(year))
      .sort((left, right) => left - right)
  }
  const text = toText(coreYears)
  if (!text) return []
  return text
    .split(",")
    .map((item) => Number(toText(item)))
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => left - right)
}

const emptyPatternYearStats = () => ({
  matchRows: 0,
  hitRows: 0,
  matchedDates: new Set(),
  hitDates: new Set(),
})

const statKey = (patternId, year) => `${patternId}\t${year}`
const dateBucketKey = (year, dateKey) => `${year}\t${dateKey}`

const readSurvivorCatalog = async (survivorCatalogPath) => {
  const sourcePath = toText(survivorCatalogPath)
  if (!sourcePath) throw new Error("survivorCatalogPath is required")
  if (!fs.existsSync(sourcePath)) throw new Error(`survivor catalog not found: ${sourcePath}`)
  const survivors = new Map()
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = resolvePatternId(row)
      if (!patternId) throw new Error(`survivor row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (survivors.has(patternId)) throw new Error(`duplicate survivor patternId: ${patternId}`)
      const tokenSet = Array.isArray(row?.tokenSet) ? row.tokenSet.map(toText).filter(Boolean) : []
      if (tokenSet.length < 1) throw new Error(`survivor row has empty tokenSet: ${patternId}`)
      survivors.set(patternId, { ...row, patternId, tokenSet })
    },
  })
  if (survivors.size < 1) throw new Error(`survivor catalog has zero rows: ${sourcePath}`)
  return survivors
}

const getPatternYearStats = (statsByPatternYear, patternId, year) => {
  const key = statKey(patternId, year)
  let stats = statsByPatternYear.get(key)
  if (!stats) {
    stats = emptyPatternYearStats()
    statsByPatternYear.set(key, stats)
  }
  return stats
}

const buildTrainScoreResolver = ({ years, statsByPatternYear }) => {
  const cache = new Map()
  return (patternId, holdoutYear) => {
    const key = `${patternId}\t${holdoutYear}`
    const cached = cache.get(key)
    if (cached) return cached
    let matchRows = 0
    let hitRows = 0
    let matchedDateCount = 0
    let hitDateCount = 0
    let minYearHitDates = Infinity
    for (const year of years) {
      if (year === holdoutYear) continue
      const stats = statsByPatternYear.get(statKey(patternId, year)) ?? emptyPatternYearStats()
      matchRows += stats.matchRows
      hitRows += stats.hitRows
      matchedDateCount += stats.matchedDates.size
      hitDateCount += stats.hitDates.size
      minYearHitDates = Math.min(minYearHitDates, stats.hitDates.size)
    }
    const score = {
      patternId,
      holdoutYear,
      trainYears: years.filter((year) => year !== holdoutYear),
      matchRows,
      hitRows,
      matchedDateCount,
      hitDateCount,
      rowPrecision: safeRatio(hitRows, matchRows),
      datePrecision: safeRatio(hitDateCount, matchedDateCount),
      minYearHitDates: Number.isFinite(minYearHitDates) ? minYearHitDates : 0,
    }
    cache.set(key, score)
    return score
  }
}

const comparePatternScoresCurrentLike = (left, right) =>
  right.rowPrecision - left.rowPrecision ||
  right.datePrecision - left.datePrecision ||
  right.minYearHitDates - left.minYearHitDates ||
  right.hitRows - left.hitRows ||
  left.matchRows - right.matchRows

const pickPatternRanked = ({ rows, holdoutYear, getTrainScore, policyId, compareScores, selectorScore }) => {
  const best = rows
    .map((row) => ({ row, score: getTrainScore(row.patternId, holdoutYear) }))
    .sort(
      (left, right) =>
        compareScores(left.score, right.score) ||
        left.row.patternId.localeCompare(right.row.patternId) ||
        left.row.symbol.localeCompare(right.row.symbol),
    )[0]
  return {
    policyId,
    patternId: best.row.patternId,
    symbol: best.row.symbol,
    decisionDateKey: best.row.decisionDateKey,
    hitTarget: best.row.hitTarget,
    selectorScore: selectorScore(best.score),
    supportPatternCount: 1,
    supportPatternIds: [best.row.patternId],
    selectedPatternTrainScore: best.score,
  }
}

const pickSupportRanked = ({ rows, holdoutYear, getTrainScore, policyId, selectorScore }) => {
  const bySymbol = new Map()
  for (const row of rows) {
    const trainScore = getTrainScore(row.patternId, holdoutYear)
    const existing = bySymbol.get(row.symbol)
    if (existing && existing.hitTarget !== row.hitTarget) {
      throw new Error(`conflicting hitTarget for train symbol/date ${row.decisionDateKey}::${row.symbol}`)
    }
    const bucket =
      existing ?? {
        symbol: row.symbol,
        decisionDateKey: row.decisionDateKey,
        hitTarget: row.hitTarget,
        supportPatternIds: new Set(),
        supportRowPrecisionSum: 0,
        supportWeightedPrecision: 0,
        maxRowPrecision: 0,
        maxDatePrecision: 0,
        maxMinYearHitDates: 0,
        minMatchRows: Infinity,
      }
    bucket.supportPatternIds.add(row.patternId)
    bucket.supportRowPrecisionSum += trainScore.rowPrecision
    bucket.supportWeightedPrecision += trainScore.rowPrecision * Math.log1p(Math.max(0, trainScore.hitRows))
    bucket.maxRowPrecision = Math.max(bucket.maxRowPrecision, trainScore.rowPrecision)
    bucket.maxDatePrecision = Math.max(bucket.maxDatePrecision, trainScore.datePrecision)
    bucket.maxMinYearHitDates = Math.max(bucket.maxMinYearHitDates, trainScore.minYearHitDates)
    bucket.minMatchRows = Math.min(bucket.minMatchRows, trainScore.matchRows)
    bySymbol.set(row.symbol, bucket)
  }
  const best = [...bySymbol.values()].sort(
    (left, right) =>
      selectorScore(right) - selectorScore(left) ||
      right.supportPatternIds.size - left.supportPatternIds.size ||
      right.maxRowPrecision - left.maxRowPrecision ||
      right.maxDatePrecision - left.maxDatePrecision ||
      left.minMatchRows - right.minMatchRows ||
      left.symbol.localeCompare(right.symbol),
  )[0]
  const supportPatternIds = uniqueSorted([...best.supportPatternIds])
  return {
    policyId,
    patternId: supportPatternIds[0],
    symbol: best.symbol,
    decisionDateKey: best.decisionDateKey,
    hitTarget: best.hitTarget,
    selectorScore: selectorScore(best),
    supportPatternCount: supportPatternIds.length,
    supportPatternIds,
    supportRowPrecisionSum: best.supportRowPrecisionSum,
    supportWeightedPrecision: best.supportWeightedPrecision,
    maxRowPrecision: best.maxRowPrecision,
    maxDatePrecision: best.maxDatePrecision,
    maxMinYearHitDates: best.maxMinYearHitDates,
  }
}

const buildPolicies = (getTrainScore) => ({
  current_like: {
    policyId: "current_like",
    pick: (rows, holdoutYear) =>
      pickPatternRanked({
        rows,
        holdoutYear,
        getTrainScore,
        policyId: "current_like",
        compareScores: comparePatternScoresCurrentLike,
        selectorScore: (score) => score.rowPrecision,
      }),
  },
  date_precision_first: {
    policyId: "date_precision_first",
    pick: (rows, holdoutYear) =>
      pickPatternRanked({
        rows,
        holdoutYear,
        getTrainScore,
        policyId: "date_precision_first",
        compareScores: (left, right) =>
          right.datePrecision - left.datePrecision ||
          right.rowPrecision - left.rowPrecision ||
          right.minYearHitDates - left.minYearHitDates ||
          left.matchRows - right.matchRows,
        selectorScore: (score) => score.datePrecision,
      }),
  },
  stability_first: {
    policyId: "stability_first",
    pick: (rows, holdoutYear) =>
      pickPatternRanked({
        rows,
        holdoutYear,
        getTrainScore,
        policyId: "stability_first",
        compareScores: (left, right) =>
          right.minYearHitDates - left.minYearHitDates ||
          right.rowPrecision - left.rowPrecision ||
          right.datePrecision - left.datePrecision ||
          left.matchRows - right.matchRows,
        selectorScore: (score) => score.minYearHitDates,
      }),
  },
  support_count_then_precision: {
    policyId: "support_count_then_precision",
    pick: (rows, holdoutYear) =>
      pickSupportRanked({
        rows,
        holdoutYear,
        getTrainScore,
        policyId: "support_count_then_precision",
        selectorScore: (bucket) => bucket.supportPatternIds.size * 1000 + bucket.supportRowPrecisionSum,
      }),
  },
  support_weighted_precision: {
    policyId: "support_weighted_precision",
    pick: (rows, holdoutYear) =>
      pickSupportRanked({
        rows,
        holdoutYear,
        getTrainScore,
        policyId: "support_weighted_precision",
        selectorScore: (bucket) => bucket.supportWeightedPrecision,
      }),
  },
})

const summarizePicks = ({ policyId, picks, targetHitRate, minSelectedRowsForTarget }) => {
  const byYear = new Map()
  for (const pick of picks) {
    const year = Number(pick.decisionDateKey.slice(0, 4))
    const bucket = byYear.get(year) ?? { selectedRows: 0, hitRows: 0 }
    bucket.selectedRows += 1
    if (pick.hitTarget === true) bucket.hitRows += 1
    byYear.set(year, bucket)
  }
  const selectedRows = picks.length
  const hitRows = picks.filter((pick) => pick.hitTarget === true).length
  const sortedByScore = picks.slice().sort(
    (left, right) => right.selectorScore - left.selectorScore || left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol),
  )
  const topCuts = uniqueSorted([...DEFAULT_TOP_CUTS, selectedRows])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= selectedRows)
    .map((topN) => {
      const rows = sortedByScore.slice(0, topN)
      const hits = rows.filter((row) => row.hitTarget === true).length
      return {
        topN,
        hitRows: hits,
        hitRate: safeRatio(hits, rows.length),
        minSelectorScore: rows.at(-1)?.selectorScore ?? null,
      }
    })
  const bucketSize = Math.max(1, Math.floor(selectedRows / 10))
  const deciles = Array.from({ length: 10 }, (_, index) => {
    const from = index * bucketSize
    const rows = index === 9 ? sortedByScore.slice(from) : sortedByScore.slice(from, from + bucketSize)
    const hits = rows.filter((row) => row.hitTarget === true).length
    return {
      bucket: index + 1,
      selectedRows: rows.length,
      hitRows: hits,
      hitRate: safeRatio(hits, rows.length),
      scoreFrom: rows[0]?.selectorScore ?? null,
      scoreTo: rows.at(-1)?.selectorScore ?? null,
    }
  }).filter((bucket) => bucket.selectedRows > 0)
  const bestTopCut =
    topCuts
      .filter((row) => row.topN >= minSelectedRowsForTarget)
      .sort((left, right) => right.hitRate - left.hitRate || right.hitRows - left.hitRows || left.topN - right.topN)[0] ?? null
  const byYearObject = Object.fromEntries(
    [...byYear.entries()]
      .sort(([left], [right]) => left - right)
      .map(([year, row]) => [
        String(year),
        {
          ...row,
          hitRate: safeRatio(row.hitRows, row.selectedRows),
        },
      ]),
  )
  return {
    policyId,
    selectedRows,
    hitRows,
    hitRate: safeRatio(hitRows, selectedRows),
    targetHitRate,
    minSelectedRowsForTarget,
    noAbstainPass: selectedRows >= minSelectedRowsForTarget && safeRatio(hitRows, selectedRows) >= targetHitRate,
    topCutPass: bestTopCut ? bestTopCut.hitRate >= targetHitRate : false,
    bestTopCut,
    byYear: byYearObject,
    topCuts,
    deciles,
  }
}

const renderReport = (summary) => {
  const pct = (value) => `${(toNumber(value, 0) * 100).toFixed(2)}%`
  const lines = [
    "# TP12 Year2Hit Train-Fold Selector Audit",
    "",
    `- status: ${summary.status}`,
    `- verdict: ${summary.verdict}`,
    `- survivor count: ${summary.survivorCount}`,
    `- train date count: ${summary.trainDateCount}`,
    `- target hit rate: ${pct(summary.targetHitRate)}`,
    `- min selected rows for target: ${summary.minSelectedRowsForTarget}`,
    "",
    "## Policy Summary",
    "",
  ]
  for (const row of summary.policySummaries) {
    lines.push(
      `- ${row.policyId}: no-abstain ${row.hitRows}/${row.selectedRows} = ${pct(row.hitRate)}, bestTopCut=${row.bestTopCut ? `${row.bestTopCut.hitRows}/${row.bestTopCut.topN} = ${pct(row.bestTopCut.hitRate)}` : "none"}`,
    )
  }
  lines.push("", "## Interpretation", "", summary.interpretation, "")
  return lines.join("\n")
}

export const buildTp12Year2hitTrainfoldSelectorAudit = async ({
  survivorCatalogPath,
  candidateEventsPath,
  outSummaryPath,
  outReportPath = "",
  coreYears = [],
  targetHitRate = 0.8,
  minSelectedRowsForTarget = 20,
  dateFrom = "",
  dateTo = "",
} = {}) => {
  if (!toText(candidateEventsPath)) throw new Error("candidateEventsPath is required")
  if (!fs.existsSync(candidateEventsPath)) throw new Error(`candidate events not found: ${candidateEventsPath}`)
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const survivors = await readSurvivorCatalog(survivorCatalogPath)
  const requestedYears = parseCoreYears(coreYears)
  const observedYears = new Set()
  const statsByPatternYear = new Map()
  const rowsByYearDate = new Map()
  let inputCandidateEventRowCount = 0
  let outsideDateRowCount = 0
  await iterateJsonlMaybeGzip(candidateEventsPath, {
    strict: true,
    onRow: async (event, context) => {
      inputCandidateEventRowCount += 1
      const patternId = resolvePatternId(event)
      if (!patternId) throw new Error(`candidate event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!survivors.has(patternId)) throw new Error(`candidate event references pattern outside survivor catalog: ${patternId}`)
      const decisionDateKey = toText(event?.decisionDateKey)
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
      if (!Object.prototype.hasOwnProperty.call(event, "hitTarget")) {
        throw new Error(`candidate event row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const year = Number(decisionDateKey.slice(0, 4))
      if (requestedYears.length > 0 && !requestedYears.includes(year)) {
        outsideDateRowCount += 1
        return
      }
      const symbol = toText(event?.symbol).toUpperCase()
      if (!symbol) throw new Error(`candidate event row missing symbol at ${context.filePath}:${context.lineNumber}`)
      observedYears.add(year)
      const stats = getPatternYearStats(statsByPatternYear, patternId, year)
      stats.matchRows += 1
      if (event.hitTarget === true) stats.hitRows += 1
      stats.matchedDates.add(decisionDateKey)
      if (event.hitTarget === true) stats.hitDates.add(decisionDateKey)
      const bucketKey = dateBucketKey(year, decisionDateKey)
      const rows = rowsByYearDate.get(bucketKey) ?? []
      rows.push({
        patternId,
        symbol,
        decisionDateKey,
        hitTarget: event.hitTarget === true,
      })
      rowsByYearDate.set(bucketKey, rows)
    },
  })
  const years = (requestedYears.length > 0 ? requestedYears : [...observedYears]).sort((left, right) => left - right)
  if (years.length < 2) throw new Error(`at least two train-fold years are required, got ${years.length}`)
  if (rowsByYearDate.size < 1) throw new Error("candidate events produced zero train date buckets")
  const missingYears = years.filter((year) => !observedYears.has(year))
  if (missingYears.length > 0) throw new Error(`candidate events are missing requested core years: ${missingYears.join(",")}`)
  const getTrainScore = buildTrainScoreResolver({ years, statsByPatternYear })
  const policies = buildPolicies(getTrainScore)
  const picksByPolicy = new Map(Object.keys(policies).map((policyId) => [policyId, []]))
  for (const [bucketKey, rows] of rowsByYearDate.entries()) {
    const [yearText] = bucketKey.split("\t")
    const holdoutYear = Number(yearText)
    for (const [policyId, policy] of Object.entries(policies)) {
      picksByPolicy.get(policyId).push(policy.pick(rows, holdoutYear))
    }
  }
  const normalizedTargetHitRate = toNumber(targetHitRate, 0.8)
  const normalizedMinSelectedRows = Math.max(1, Math.trunc(toNumber(minSelectedRowsForTarget, 20)))
  const policySummaries = [...picksByPolicy.entries()]
    .map(([policyId, picks]) =>
      summarizePicks({
        policyId,
        picks,
        targetHitRate: normalizedTargetHitRate,
        minSelectedRowsForTarget: normalizedMinSelectedRows,
      }),
    )
    .sort(
      (left, right) =>
        (right.bestTopCut?.hitRate ?? 0) - (left.bestTopCut?.hitRate ?? 0) ||
        right.hitRate - left.hitRate ||
        left.policyId.localeCompare(right.policyId),
    )
  const bestNoAbstainPolicy = policySummaries.slice().sort((left, right) => right.hitRate - left.hitRate)[0]
  const bestTopCutPolicy = policySummaries[0]
  const targetPolicy = policySummaries.find((row) => row.noAbstainPass || row.topCutPass) ?? null
  const verdict = targetPolicy ? "train_selector_candidate_found" : "train_selector_no_evidence_for_target"
  const interpretation = targetPolicy
    ? `At least one train-fold selector policy reached the target hit rate without OOS evidence. Freeze that selector before any OOS replay.`
    : `No evaluated train-fold selector reached the target hit rate at the required selected-row floor. Do not use OOS to tune this survivor set; add new train-only signal/features or a different survivor discovery path first.`
  const summary = {
    kind: "tp12_year2hit_trainfold_selector_audit_v1",
    generatedAt: new Date().toISOString(),
    status: "measured",
    verdict,
    survivorCatalogPath: path.resolve(survivorCatalogPath),
    candidateEventsPath: path.resolve(candidateEventsPath),
    survivorCount: survivors.size,
    inputCandidateEventRowCount,
    outsideDateRowCount,
    trainYears: years,
    trainDateCount: rowsByYearDate.size,
    targetHitRate: normalizedTargetHitRate,
    minSelectedRowsForTarget: normalizedMinSelectedRows,
    bestNoAbstainPolicy: bestNoAbstainPolicy?.policyId ?? null,
    bestNoAbstainHitRate: bestNoAbstainPolicy?.hitRate ?? 0,
    bestTopCutPolicy: bestTopCutPolicy?.policyId ?? null,
    bestTopCut: bestTopCutPolicy?.bestTopCut ?? null,
    targetPolicyId: targetPolicy?.policyId ?? null,
    policySummaries,
    interpretation,
  }
  await ensureDir(path.dirname(outSummaryPath))
  await writeJson(outSummaryPath, summary)
  if (toText(outReportPath)) {
    await ensureDir(path.dirname(outReportPath))
    await fs.promises.writeFile(outReportPath, renderReport(summary), "utf8")
  }
  return summary
}
