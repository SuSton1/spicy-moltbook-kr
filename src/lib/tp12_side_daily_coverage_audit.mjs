import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

export const TP12_SIDE_DAILY_COVERAGE_AUDIT_KIND = "tp12_side_daily_coverage_audit_summary_v1"
export const TP12_SIDE_DAILY_COVERAGE_AUDIT_PATCH_KEY = "tp12_h80_side_daily_coverage_audit_v1"

const DEFAULT_DATASET_SPECS = Object.freeze({
  investor_daily: Object.freeze({
    datasetId: "investor_daily",
    candidateFields: ["ind_invsr", "ind_netprps_amt", "ind_netprps_qty"],
  }),
  program_daily: Object.freeze({
    datasetId: "program_daily",
    candidateFields: ["prm_netprps_amt", "prm_netprps_qty"],
  }),
  trade_strength_daily: Object.freeze({
    datasetId: "trade_strength_daily",
    candidateFields: ["cntr_str", "tday_cntr_str"],
  }),
})

const safeDiv = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const assertDateKey = (value, label) => {
  const text = toText(value)
  if (!validDateKey(text)) throw new Error(`${label} must be YYYY-MM-DD: ${text || "missing"}`)
  return text
}

const normalizeSymbol = (value, label) => {
  const text = toText(value).toUpperCase()
  if (!text) throw new Error(`${label} missing symbol`)
  return text
}

const parseNumberOrNull = (value) => {
  const text = toText(value).replaceAll(",", "")
  if (!text) return null
  const normalized = text.replace(/^([+-])\1+/, "$1")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const pairKey = (symbol, dateKey) => `${symbol}::${dateKey}`

const compareDate = (left, right) => left.localeCompare(right)

const binarySearchLastIndexLtOrEq = (sortedValues, target) => {
  let lo = 0
  let hi = sortedValues.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (sortedValues[mid] <= target) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const binarySearchLastIndexLt = (sortedValues, target) => {
  let lo = 0
  let hi = sortedValues.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (sortedValues[mid] < target) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const makeDatasetSpec = (datasetId) => {
  const normalized = toText(datasetId)
  const spec = DEFAULT_DATASET_SPECS[normalized]
  if (!spec) throw new Error(`Unsupported side-daily datasetId=${normalized || "missing"}`)
  return spec
}

const resolveDatasetInputs = (datasets = []) => {
  if (!Array.isArray(datasets) || datasets.length < 1) {
    throw new Error("At least one --dataset=datasetId:path side-daily input is required")
  }
  const seen = new Set()
  return datasets.map((item) => {
    const text = toText(item)
    const splitAt = text.indexOf(":")
    if (splitAt <= 0 || splitAt === text.length - 1) {
      throw new Error(`Invalid dataset input; expected datasetId:path, got ${text}`)
    }
    const datasetId = text.slice(0, splitAt)
    const filePath = text.slice(splitAt + 1)
    const spec = makeDatasetSpec(datasetId)
    if (seen.has(spec.datasetId)) throw new Error(`Duplicate dataset input: ${spec.datasetId}`)
    seen.add(spec.datasetId)
    if (!fs.existsSync(filePath)) throw new Error(`Missing side-daily dataset ${spec.datasetId}: ${filePath}`)
    return {
      ...spec,
      filePath,
    }
  })
}

const validateForbiddenRange = ({ decisionDateKey, forbiddenDateFrom, forbiddenDateTo, contextLabel }) => {
  if (forbiddenDateFrom && forbiddenDateTo && decisionDateKey >= forbiddenDateFrom && decisionDateKey <= forbiddenDateTo) {
    throw new Error(`${contextLabel} date ${decisionDateKey} is inside forbidden range ${forbiddenDateFrom}..${forbiddenDateTo}`)
  }
}

const loadCandidateRows = async ({
  candidatesPath,
  dateFrom = null,
  dateTo = null,
  forbiddenDateFrom = null,
  forbiddenDateTo = null,
}) => {
  if (!toText(candidatesPath)) throw new Error("candidatesPath is required")
  if (!fs.existsSync(candidatesPath)) throw new Error(`Missing candidates path: ${candidatesPath}`)
  const rows = []
  const seen = new Set()
  const symbolSet = new Set()
  const dateSet = new Set()
  let candidateDateFrom = null
  let candidateDateTo = null
  await iterateJsonlMaybeGzip(candidatesPath, {
    strict: true,
    onRow: async (raw, context) => {
      const contextLabel = `${context.filePath}:${context.lineNumber}`
      const decisionDateKey = assertDateKey(raw?.decisionDateKey ?? raw?.dateKey, `${contextLabel} decisionDateKey`)
      if (dateFrom && decisionDateKey < dateFrom) return
      if (dateTo && decisionDateKey > dateTo) return
      validateForbiddenRange({ decisionDateKey, forbiddenDateFrom, forbiddenDateTo, contextLabel })
      const symbol = normalizeSymbol(raw?.symbol, `${contextLabel} candidate`)
      const key = pairKey(symbol, decisionDateKey)
      if (seen.has(key)) throw new Error(`Duplicate candidate symbol/date row: ${key}`)
      seen.add(key)
      rows.push({ symbol, decisionDateKey })
      symbolSet.add(symbol)
      dateSet.add(decisionDateKey)
      candidateDateFrom = candidateDateFrom === null || decisionDateKey < candidateDateFrom ? decisionDateKey : candidateDateFrom
      candidateDateTo = candidateDateTo === null || decisionDateKey > candidateDateTo ? decisionDateKey : candidateDateTo
    },
  })
  if (rows.length < 1) throw new Error(`No candidate rows loaded from ${candidatesPath}`)
  rows.sort((left, right) => {
    const dateCmp = compareDate(left.decisionDateKey, right.decisionDateKey)
    if (dateCmp !== 0) return dateCmp
    return left.symbol.localeCompare(right.symbol)
  })
  return {
    rows,
    symbolSet,
    dateSet,
    candidateDateFrom,
    candidateDateTo,
  }
}

const loadSideDailyDatasetIndex = async ({ datasetSpec, symbolSet }) => {
  const bySymbol = new Map()
  let sourceRowCount = 0
  let usableRowCount = 0
  const sourceDateSet = new Set()
  const sourceSymbolSet = new Set()
  let sourceDateFrom = null
  let sourceDateTo = null
  await iterateJsonlMaybeGzip(datasetSpec.filePath, {
    strict: true,
    onRow: async (raw, context) => {
      sourceRowCount += 1
      const rowDataset = toText(raw?.dataset)
      if (rowDataset && rowDataset !== datasetSpec.datasetId) {
        throw new Error(
          `Dataset mismatch at ${context.filePath}:${context.lineNumber}; expected ${datasetSpec.datasetId}, got ${rowDataset}`,
        )
      }
      const symbol = normalizeSymbol(raw?.symbol, `${context.filePath}:${context.lineNumber} ${datasetSpec.datasetId}`)
      const dateKey = assertDateKey(raw?.dateKey, `${context.filePath}:${context.lineNumber} ${datasetSpec.datasetId} dateKey`)
      sourceDateSet.add(dateKey)
      sourceSymbolSet.add(symbol)
      sourceDateFrom = sourceDateFrom === null || dateKey < sourceDateFrom ? dateKey : sourceDateFrom
      sourceDateTo = sourceDateTo === null || dateKey > sourceDateTo ? dateKey : sourceDateTo
      if (!symbolSet.has(symbol)) return
      const rawRow = raw?.rawRow ?? {}
      let numericValue = null
      for (const field of datasetSpec.candidateFields) {
        numericValue = parseNumberOrNull(rawRow?.[field])
        if (numericValue !== null) break
      }
      if (numericValue === null) {
        throw new Error(`${datasetSpec.datasetId} row missing supported numeric field for ${symbol}:${dateKey}`)
      }
      const symbolMap = bySymbol.get(symbol) ?? new Map()
      if (symbolMap.has(dateKey)) {
        throw new Error(`Duplicate ${datasetSpec.datasetId} row for ${symbol}:${dateKey}`)
      }
      symbolMap.set(dateKey, numericValue)
      bySymbol.set(symbol, symbolMap)
      usableRowCount += 1
    },
  })
  const sortedDateKeysBySymbol = new Map()
  for (const [symbol, rowsByDate] of bySymbol.entries()) {
    sortedDateKeysBySymbol.set(symbol, [...rowsByDate.keys()].sort(compareDate))
  }
  return {
    bySymbol,
    sortedDateKeysBySymbol,
    sourceRowCount,
    usableRowCount,
    sourceDateCount: sourceDateSet.size,
    sourceSymbolCount: sourceSymbolSet.size,
    sourceDateFrom,
    sourceDateTo,
    sourceDateSet,
    sourceSymbolSet,
    indexedSymbolCount: bySymbol.size,
  }
}

const summarizeDatasetCoverage = async ({
  datasetSpec,
  candidateRows,
  candidateDateSet,
  candidateSymbolSet,
  index,
  missingStream,
  maxMissingExamplesPerDataset,
}) => {
  let sameDateCoveredRows = 0
  let strictPriorCoveredRows = 0
  let priorOrSameCoveredRows = 0
  let missingSameDateRows = 0
  let missingStrictPriorRows = 0
  let missingPriorOrSameRows = 0
  let missingExampleCount = 0
  const missingSameByDate = new Map()
  const missingSameBySymbol = new Map()
  let maxStrictPriorCalendarGapDays = 0
  let maxPriorOrSameCalendarGapDays = 0
  let strictPriorGapSum = 0
  let priorOrSameGapSum = 0

  for (const row of candidateRows) {
    const rowsByDate = index.bySymbol.get(row.symbol)
    const sortedDates = index.sortedDateKeysBySymbol.get(row.symbol) ?? []
    const sameDateCovered = Boolean(rowsByDate?.has(row.decisionDateKey))
    if (sameDateCovered) sameDateCoveredRows += 1
    else {
      missingSameDateRows += 1
      missingSameByDate.set(row.decisionDateKey, (missingSameByDate.get(row.decisionDateKey) ?? 0) + 1)
      missingSameBySymbol.set(row.symbol, (missingSameBySymbol.get(row.symbol) ?? 0) + 1)
    }

    const strictPriorIndex = binarySearchLastIndexLt(sortedDates, row.decisionDateKey)
    const strictPriorDateKey = strictPriorIndex >= 0 ? sortedDates[strictPriorIndex] : null
    if (strictPriorDateKey) {
      strictPriorCoveredRows += 1
      const gapDays = Math.max(0, Math.round((Date.parse(row.decisionDateKey) - Date.parse(strictPriorDateKey)) / 86400000))
      strictPriorGapSum += gapDays
      maxStrictPriorCalendarGapDays = Math.max(maxStrictPriorCalendarGapDays, gapDays)
    } else {
      missingStrictPriorRows += 1
    }

    const priorOrSameIndex = binarySearchLastIndexLtOrEq(sortedDates, row.decisionDateKey)
    const priorOrSameDateKey = priorOrSameIndex >= 0 ? sortedDates[priorOrSameIndex] : null
    if (priorOrSameDateKey) {
      priorOrSameCoveredRows += 1
      const gapDays = Math.max(0, Math.round((Date.parse(row.decisionDateKey) - Date.parse(priorOrSameDateKey)) / 86400000))
      priorOrSameGapSum += gapDays
      maxPriorOrSameCalendarGapDays = Math.max(maxPriorOrSameCalendarGapDays, gapDays)
    } else {
      missingPriorOrSameRows += 1
    }

    if ((!sameDateCovered || !strictPriorDateKey || !priorOrSameDateKey) && missingExampleCount < maxMissingExamplesPerDataset) {
      await writeJsonlRow(missingStream, {
        kind: "tp12_side_daily_coverage_missing_example_v1",
        patchKey: TP12_SIDE_DAILY_COVERAGE_AUDIT_PATCH_KEY,
        datasetId: datasetSpec.datasetId,
        symbol: row.symbol,
        decisionDateKey: row.decisionDateKey,
        missingSameDate: !sameDateCovered,
        missingStrictPrior: !strictPriorDateKey,
        missingPriorOrSame: !priorOrSameDateKey,
        strictPriorDateKey,
        priorOrSameDateKey,
      })
      missingExampleCount += 1
    }
  }

  const candidateRowCount = candidateRows.length
  const topMissingDates = [...missingSameByDate.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([dateKey, missingRows]) => ({ dateKey, missingRows }))
  const topMissingSymbols = [...missingSameBySymbol.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([symbol, missingRows]) => ({ symbol, missingRows }))

  return {
    datasetId: datasetSpec.datasetId,
    sourcePath: path.resolve(datasetSpec.filePath),
    sourceRowCount: index.sourceRowCount,
    sourceDateCount: index.sourceDateCount,
    sourceSymbolCount: index.sourceSymbolCount,
    sourceDateFrom: index.sourceDateFrom,
    sourceDateTo: index.sourceDateTo,
    candidateDateOverlapCount: [...candidateDateSet].filter((dateKey) => index.sourceDateSet.has(dateKey)).length,
    candidateSymbolOverlapCount: [...candidateSymbolSet].filter((symbol) => index.sourceSymbolSet.has(symbol)).length,
    usableIndexedRowCount: index.usableRowCount,
    indexedSymbolCount: index.indexedSymbolCount,
    candidateRowCount,
    sameDateCoveredRows,
    strictPriorCoveredRows,
    priorOrSameCoveredRows,
    missingSameDateRows,
    missingStrictPriorRows,
    missingPriorOrSameRows,
    sameDateCoverageRate: safeDiv(sameDateCoveredRows, candidateRowCount),
    strictPriorCoverageRate: safeDiv(strictPriorCoveredRows, candidateRowCount),
    priorOrSameCoverageRate: safeDiv(priorOrSameCoveredRows, candidateRowCount),
    averageStrictPriorCalendarGapDays: safeDiv(strictPriorGapSum, strictPriorCoveredRows),
    averagePriorOrSameCalendarGapDays: safeDiv(priorOrSameGapSum, priorOrSameCoveredRows),
    maxStrictPriorCalendarGapDays,
    maxPriorOrSameCalendarGapDays,
    missingExampleCount,
    topMissingSameDateDates: topMissingDates,
    topMissingSameDateSymbols: topMissingSymbols,
  }
}

export const auditTp12SideDailyCoverage = async ({
  candidatesPath,
  datasets,
  outSummaryPath,
  outMissingPath,
  dateFrom = null,
  dateTo = null,
  forbiddenDateFrom = null,
  forbiddenDateTo = null,
  minSameDateCoverage = 0.95,
  minStrictPriorCoverage = 0.95,
  minPriorOrSameCoverage = 0.95,
  maxMissingExamplesPerDataset = 100,
} = {}) => {
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  if (!toText(outMissingPath)) throw new Error("outMissingPath is required")
  const normalizedDateFrom = dateFrom ? assertDateKey(dateFrom, "dateFrom") : null
  const normalizedDateTo = dateTo ? assertDateKey(dateTo, "dateTo") : null
  const normalizedForbiddenFrom = forbiddenDateFrom ? assertDateKey(forbiddenDateFrom, "forbiddenDateFrom") : null
  const normalizedForbiddenTo = forbiddenDateTo ? assertDateKey(forbiddenDateTo, "forbiddenDateTo") : null
  const datasetSpecs = resolveDatasetInputs(datasets)
  const candidateState = await loadCandidateRows({
    candidatesPath,
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
    forbiddenDateFrom: normalizedForbiddenFrom,
    forbiddenDateTo: normalizedForbiddenTo,
  })
  await ensureDir(path.dirname(outMissingPath))
  const missingWriter = createJsonlWriteStreamMaybeGzip(outMissingPath)
  const datasetSummaries = []
  try {
    for (const datasetSpec of datasetSpecs) {
      const index = await loadSideDailyDatasetIndex({
        datasetSpec,
        symbolSet: candidateState.symbolSet,
      })
      datasetSummaries.push(
        await summarizeDatasetCoverage({
          datasetSpec,
          candidateRows: candidateState.rows,
          candidateDateSet: candidateState.dateSet,
          candidateSymbolSet: candidateState.symbolSet,
          index,
          missingStream: missingWriter.stream,
          maxMissingExamplesPerDataset,
        }),
      )
    }
  } finally {
    await missingWriter.close()
  }

  const failedDatasets = datasetSummaries
    .filter(
      (summary) =>
        summary.sameDateCoverageRate < minSameDateCoverage ||
        summary.strictPriorCoverageRate < minStrictPriorCoverage ||
        summary.priorOrSameCoverageRate < minPriorOrSameCoverage,
    )
    .map((summary) => summary.datasetId)

  const summary = {
    kind: TP12_SIDE_DAILY_COVERAGE_AUDIT_KIND,
    patchKey: TP12_SIDE_DAILY_COVERAGE_AUDIT_PATCH_KEY,
    status: failedDatasets.length === 0 ? "passed_coverage_gate" : "failed_coverage_gate",
    mode: "train_only_side_daily_join_coverage_audit",
    candidatesPath: path.resolve(candidatesPath),
    outSummaryPath: path.resolve(outSummaryPath),
    outMissingPath: path.resolve(outMissingPath),
    dateFrom: normalizedDateFrom,
    dateTo: normalizedDateTo,
    forbiddenDateRange: {
      from: normalizedForbiddenFrom,
      to: normalizedForbiddenTo,
    },
    candidateRows: candidateState.rows.length,
    candidateDateCount: candidateState.dateSet.size,
    candidateSymbolCount: candidateState.symbolSet.size,
    candidateDateFrom: candidateState.candidateDateFrom,
    candidateDateTo: candidateState.candidateDateTo,
    coverageGate: {
      minSameDateCoverage,
      minStrictPriorCoverage,
      minPriorOrSameCoverage,
      maxMissingExamplesPerDataset,
      failedDatasets,
    },
    datasetSummaries,
    oosRead: false,
    lockedSelectorEmitted: false,
    notes: [
      "This audit only measures explicit side-daily join coverage; it does not train, tune, or emit a selector.",
      "sameDate, strictPrior, and priorOrSame coverage are reported separately so the next feature patch must choose a single explicit as-of policy.",
    ],
  }
  await writeJson(outSummaryPath, summary)
  return summary
}
