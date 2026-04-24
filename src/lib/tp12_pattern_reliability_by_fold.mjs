import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { wilsonInterval } from "./tp12_year2hit_operating_gate.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const resolvePatternId = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const supportDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const priorMean = ({ numerator, denominator, baseRate, priorStrength }) =>
  denominator > 0 || priorStrength > 0
    ? (numerator + baseRate * priorStrength) / (denominator + priorStrength)
    : 0

const loadSplitPlan = async (splitPlanPath) => {
  const sourcePath = toText(splitPlanPath)
  if (!sourcePath) throw new Error("splitPlanPath is required")
  const splitPlan = await readJson(sourcePath, null)
  if (!splitPlan) throw new Error(`split plan not found: ${sourcePath}`)
  if (!Array.isArray(splitPlan.outerFolds) || splitPlan.outerFolds.length < 1) {
    throw new Error(`split plan has no outerFolds: ${sourcePath}`)
  }
  for (const fold of splitPlan.outerFolds) {
    if (!toText(fold?.foldId)) throw new Error("split plan fold missing foldId")
    if (!Array.isArray(fold.trainDates)) throw new Error(`split plan fold missing trainDates: ${fold.foldId}`)
    if (!Array.isArray(fold.validationDates)) throw new Error(`split plan fold missing validationDates: ${fold.foldId}`)
  }
  return { splitPlan, sourcePath: path.resolve(sourcePath) }
}

const emptyStats = () => ({
  matchRows: 0,
  hitRows: 0,
  matchedDates: new Set(),
  hitDates: new Set(),
  yearHitDateCounts: new Map(),
})

const finalizeStats = ({ fold, patternId, stats, rowBaseRate, dateBaseRate, priorStrengthRow, priorStrengthDate }) => {
  const matchedDateCount = stats.matchedDates.size
  const hitDateCount = stats.hitDates.size
  const rowWilson = wilsonInterval({ hitRows: stats.hitRows, selectedRows: stats.matchRows })
  const dateWilson = wilsonInterval({ hitRows: hitDateCount, selectedRows: matchedDateCount })
  return {
    kind: "tp12_pattern_reliability_by_fold_v1",
    foldId: fold.foldId,
    validationYears: fold.validationYears ?? [fold.validationYear].filter(Boolean),
    trainDateRange: fold.trainDateRange,
    validationDateRange: fold.validationDateRange,
    patternId,
    matchRows: stats.matchRows,
    hitRows: stats.hitRows,
    rowPrecision: safeRatio(stats.hitRows, stats.matchRows),
    rowEbMean: priorMean({
      numerator: stats.hitRows,
      denominator: stats.matchRows,
      baseRate: rowBaseRate,
      priorStrength: priorStrengthRow,
    }),
    rowWilsonLB: rowWilson.lower,
    rowWilsonUB: rowWilson.upper,
    matchedDateCount,
    hitDateCount,
    datePrecision: safeRatio(hitDateCount, matchedDateCount),
    dateEbMean: priorMean({
      numerator: hitDateCount,
      denominator: matchedDateCount,
      baseRate: dateBaseRate,
      priorStrength: priorStrengthDate,
    }),
    dateWilsonLB: dateWilson.lower,
    dateWilsonUB: dateWilson.upper,
    yearHitDateCounts: Object.fromEntries([...stats.yearHitDateCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }
}

export const buildTp12PatternReliabilityByFold = async ({
  eventsPath,
  splitPlanPath,
  outPath,
  manifestPath,
  priorStrengthRow = 100,
  priorStrengthDate = 50,
} = {}) => {
  if (!toText(eventsPath)) throw new Error("eventsPath is required")
  if (!fs.existsSync(eventsPath)) throw new Error(`events path not found: ${eventsPath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(manifestPath)) throw new Error("manifestPath is required")
  const { splitPlan, sourcePath: resolvedSplitPlanPath } = await loadSplitPlan(splitPlanPath)
  const normalizedPriorStrengthRow = Math.max(0, toNumber(priorStrengthRow, 100))
  const normalizedPriorStrengthDate = Math.max(0, toNumber(priorStrengthDate, 50))
  const foldContexts = splitPlan.outerFolds.map((fold) => ({
    fold,
    trainDates: new Set(fold.trainDates),
    validationDates: new Set(fold.validationDates),
    statsByPattern: new Map(),
    rowCount: 0,
    hitRowCount: 0,
    matchedDates: new Set(),
    hitDates: new Set(),
    validationLeakRowCount: 0,
  }))
  let inputRowCount = 0
  await iterateJsonlMaybeGzip(eventsPath, {
    strict: true,
    onRow: async (row, context) => {
      inputRowCount += 1
      const patternId = resolvePatternId(row)
      const decisionDateKey = supportDateKey(row)
      if (!patternId) throw new Error(`event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`event row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
        throw new Error(`event row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
      }
      const hitTarget = row.hitTarget === true
      for (const contextRow of foldContexts) {
        if (contextRow.validationDates.has(decisionDateKey)) {
          contextRow.validationLeakRowCount += contextRow.trainDates.has(decisionDateKey) ? 1 : 0
        }
        if (!contextRow.trainDates.has(decisionDateKey)) continue
        const stats = contextRow.statsByPattern.get(patternId) ?? emptyStats()
        stats.matchRows += 1
        stats.matchedDates.add(decisionDateKey)
        contextRow.rowCount += 1
        contextRow.matchedDates.add(decisionDateKey)
        if (hitTarget) {
          stats.hitRows += 1
          stats.hitDates.add(decisionDateKey)
          contextRow.hitRowCount += 1
          contextRow.hitDates.add(decisionDateKey)
          incrementMap(stats.yearHitDateCounts, decisionDateKey.slice(0, 4))
        }
        contextRow.statsByPattern.set(patternId, stats)
      }
    },
  })
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  const foldSummaries = []
  let outputRowCount = 0
  const failures = []
  try {
    for (const contextRow of foldContexts) {
      if (contextRow.validationLeakRowCount > 0) {
        failures.push(`${contextRow.fold.foldId}:validation_leak_rows:${contextRow.validationLeakRowCount}`)
      }
      const rowBaseRate = safeRatio(contextRow.hitRowCount, contextRow.rowCount)
      const dateBaseRate = safeRatio(contextRow.hitDates.size, contextRow.matchedDates.size)
      const rows = [...contextRow.statsByPattern.entries()]
        .map(([patternId, stats]) =>
          finalizeStats({
            fold: contextRow.fold,
            patternId,
            stats,
            rowBaseRate,
            dateBaseRate,
            priorStrengthRow: normalizedPriorStrengthRow,
            priorStrengthDate: normalizedPriorStrengthDate,
          }),
        )
        .sort((left, right) => left.foldId.localeCompare(right.foldId) || left.patternId.localeCompare(right.patternId))
      for (const row of rows) {
        await writeJsonlRow(stream, row)
        outputRowCount += 1
      }
      foldSummaries.push({
        foldId: contextRow.fold.foldId,
        validationYears: contextRow.fold.validationYears ?? [contextRow.fold.validationYear].filter(Boolean),
        trainDateRange: contextRow.fold.trainDateRange,
        validationDateRange: contextRow.fold.validationDateRange,
        patternCount: rows.length,
        trainEventRowCount: contextRow.rowCount,
        trainHitRowCount: contextRow.hitRowCount,
        rowBaseRate,
        matchedDateCount: contextRow.matchedDates.size,
        hitDateCount: contextRow.hitDates.size,
        dateBaseRate,
        validationLeakRowCount: contextRow.validationLeakRowCount,
      })
    }
  } finally {
    await closeWriteStream(stream)
  }
  const manifest = {
    kind: "tp12_pattern_reliability_by_fold_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    eventsPath: path.resolve(eventsPath),
    splitPlanPath: resolvedSplitPlanPath,
    outPath: path.resolve(outPath),
    options: {
      priorStrengthRow: normalizedPriorStrengthRow,
      priorStrengthDate: normalizedPriorStrengthDate,
    },
    inputRowCount,
    outputRowCount,
    foldCount: foldContexts.length,
    foldSummaries,
    failures,
  }
  await writeJson(manifestPath, manifest)
  if (failures.length > 0) throw new Error(`tp12 pattern reliability by fold failed: ${failures.join("; ")}`)
  return manifest
}
