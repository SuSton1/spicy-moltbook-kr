import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const dateDiffDays = (left, right) => {
  const leftMs = Date.parse(`${left}T00:00:00Z`)
  const rightMs = Date.parse(`${right}T00:00:00Z`)
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return NaN
  return Math.round((rightMs - leftMs) / 86400000)
}

const rowDateKey = (row) => toText(row?.dateKey ?? row?.tradingDateKey ?? row?.decisionDateKey)
const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const entrySetKey = (symbol, dateKey) => `${symbol}\t${dateKey}`

const loadCalendar = async ({ calendarPath = "", candlePath = "" } = {}) => {
  const dates = new Set()
  const sourcePath = toText(calendarPath) || toText(candlePath)
  if (!sourcePath) throw new Error("calendarPath or candlePath is required for entry feasibility audit")
  if (!fs.existsSync(sourcePath)) throw new Error(`calendar source not found: ${sourcePath}`)
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row, context) => {
      const dateKey = rowDateKey(row)
      if (!validDateKey(dateKey)) {
        throw new Error(`invalid calendar date at ${context.filePath}:${context.lineNumber}: ${dateKey || "missing"}`)
      }
      dates.add(dateKey)
    },
  })
  const sorted = [...dates].sort()
  if (sorted.length < 2) throw new Error(`calendar source has fewer than two dates: ${sourcePath}`)
  const nextByDate = new Map()
  const indexByDate = new Map()
  for (let index = 0; index < sorted.length; index += 1) {
    indexByDate.set(sorted[index], index)
  }
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    nextByDate.set(sorted[index], sorted[index + 1])
  }
  return { dates: sorted, indexByDate, nextByDate, sourcePath: path.resolve(sourcePath) }
}

const loadEntryBarSet = async (candlePath) => {
  const sourcePath = toText(candlePath)
  if (!sourcePath) throw new Error("candlePath is required when checkEntryBar=true")
  if (!fs.existsSync(sourcePath)) throw new Error(`candle path not found: ${sourcePath}`)
  const entries = new Set()
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row, context) => {
      const symbol = rowSymbol(row)
      const dateKey = rowDateKey(row)
      if (!symbol) throw new Error(`candle row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(dateKey)) {
        throw new Error(`candle row invalid date at ${context.filePath}:${context.lineNumber}: ${dateKey || "missing"}`)
      }
      entries.add(entrySetKey(symbol, dateKey))
    },
  })
  return entries
}

const topCounts = (map, limit = 50) =>
  [...map.entries()]
    .map(([key, rowCount]) => ({ key, rowCount }))
    .sort((left, right) => right.rowCount - left.rowCount || left.key.localeCompare(right.key))
    .slice(0, limit)

export const buildTp12EntryFeasibilityAudit = async ({
  eventsPath,
  calendarPath = "",
  candlePath = "",
  outSummaryPath,
  outInvalidPath = "",
  maxEntryGapCalendarDays = 7,
  checkEntryBar = false,
  failOnInvalid = true,
} = {}) => {
  if (!toText(eventsPath)) throw new Error("eventsPath is required")
  if (!fs.existsSync(eventsPath)) throw new Error(`events path not found: ${eventsPath}`)
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const maxGap = Math.max(0, Math.trunc(toNumber(maxEntryGapCalendarDays, 7)))
  const calendar = await loadCalendar({ calendarPath, candlePath })
  const entryBars = toBool(checkEntryBar, false) ? await loadEntryBarSet(candlePath) : null
  const reasonCounts = new Map()
  const invalidSymbolCounts = new Map()
  let inputRowCount = 0
  let auditedRowCount = 0
  let validRowCount = 0
  let invalidRowCount = 0
  let missingEntryDateRowCount = 0
  let missingNextSessionRowCount = 0
  let maxObservedEntryGapCalendarDays = 0
  let maxObservedEntryGapTradingSessions = 0
  let longGlobalNextSessionCalendarGapRowCount = 0
  const invalidSamples = []
  let invalidStream = null
  try {
    if (toText(outInvalidPath)) {
      await ensureDir(path.dirname(outInvalidPath))
      invalidStream = fs.createWriteStream(outInvalidPath, { encoding: "utf8" })
    }
    await iterateJsonlMaybeGzip(eventsPath, {
      strict: true,
      onRow: async (row, context) => {
        inputRowCount += 1
        const symbol = rowSymbol(row)
        const decisionDateKey = toText(row?.decisionDateKey)
        const entryDateKey = toText(row?.entryDateKey)
        if (!symbol) throw new Error(`event row missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`event row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
        }
        auditedRowCount += 1
        const reasons = []
        if (!validDateKey(entryDateKey)) {
          missingEntryDateRowCount += 1
          reasons.push("missing_or_invalid_entry_date")
        }
        const expectedEntryDateKey = calendar.nextByDate.get(decisionDateKey) ?? null
        if (!expectedEntryDateKey) {
          missingNextSessionRowCount += 1
          reasons.push("missing_global_next_session")
        }
        if (validDateKey(entryDateKey) && expectedEntryDateKey && entryDateKey !== expectedEntryDateKey) {
          reasons.push("entry_not_global_next_session")
        }
        if (validDateKey(entryDateKey) && entryDateKey <= decisionDateKey) {
          reasons.push("entry_not_after_decision")
        }
        const expectedEntryMatches =
          validDateKey(entryDateKey) && Boolean(expectedEntryDateKey) && entryDateKey === expectedEntryDateKey
        const decisionIndex = calendar.indexByDate.get(decisionDateKey)
        const entryIndex = validDateKey(entryDateKey) ? calendar.indexByDate.get(entryDateKey) : undefined
        const gapTradingSessions =
          Number.isInteger(decisionIndex) && Number.isInteger(entryIndex) ? entryIndex - decisionIndex : null
        if (Number.isInteger(gapTradingSessions)) {
          maxObservedEntryGapTradingSessions = Math.max(maxObservedEntryGapTradingSessions, gapTradingSessions)
        }
        const gapCalendarDays = validDateKey(entryDateKey) ? dateDiffDays(decisionDateKey, entryDateKey) : null
        if (Number.isFinite(gapCalendarDays)) {
          maxObservedEntryGapCalendarDays = Math.max(maxObservedEntryGapCalendarDays, gapCalendarDays)
          if (gapCalendarDays > maxGap) {
            if (expectedEntryMatches) {
              longGlobalNextSessionCalendarGapRowCount += 1
            } else {
              reasons.push("entry_gap_calendar_days_above_max")
            }
          }
        }
        if (entryBars && validDateKey(entryDateKey) && !entryBars.has(entrySetKey(symbol, entryDateKey))) {
          reasons.push("missing_symbol_entry_bar")
        }
        if (reasons.length > 0) {
          invalidRowCount += 1
          incrementMap(invalidSymbolCounts, symbol)
          for (const reason of reasons) incrementMap(reasonCounts, reason)
          const invalidRow = {
            kind: "tp12_entry_feasibility_invalid_event_v1",
            symbol,
            patternId: toText(row?.patternId),
            decisionDateKey,
            entryDateKey: entryDateKey || null,
            expectedEntryDateKey,
            gapCalendarDays,
            gapTradingSessions,
            reasons,
          }
          if (invalidSamples.length < 50) invalidSamples.push(invalidRow)
          if (invalidStream) await writeJsonlRow(invalidStream, invalidRow)
          return
        }
        validRowCount += 1
      },
    })
  } finally {
    if (invalidStream) await closeWriteStream(invalidStream)
  }
  const failures = []
  if (invalidRowCount > 0) failures.push(`invalid_entry_rows:${invalidRowCount}`)
  const summary = {
    kind: "tp12_entry_feasibility_audit_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    eventsPath: path.resolve(eventsPath),
    calendarSourcePath: calendar.sourcePath,
    candlePath: toText(candlePath) ? path.resolve(candlePath) : null,
    outInvalidPath: toText(outInvalidPath) ? path.resolve(outInvalidPath) : null,
    options: {
      maxEntryGapCalendarDays: maxGap,
      checkEntryBar: toBool(checkEntryBar, false),
      calendarGapPolicy: "diagnostic_when_entry_is_global_next_session",
    },
    calendarDateCount: calendar.dates.length,
    inputRowCount,
    auditedRowCount,
    validRowCount,
    invalidRowCount,
    missingEntryDateRowCount,
    missingNextSessionRowCount,
    maxObservedEntryGapCalendarDays,
    maxObservedEntryGapTradingSessions,
    longGlobalNextSessionCalendarGapRowCount,
    invalidReasonCounts: mapToSortedObject(reasonCounts),
    topInvalidSymbols: topCounts(invalidSymbolCounts),
    invalidSamples,
    failures,
  }
  await writeJson(outSummaryPath, summary)
  if (summary.status !== "passed" && toBool(failOnInvalid, false)) {
    throw new Error(`tp12 entry feasibility audit failed: ${failures.join("; ")}`)
  }
  return summary
}
