import path from "node:path"

import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, readJson, writeJson } from "./io.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
} from "./perfect_prototype_rule_family_spec.mjs"

export const PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_TOP = "LOW_GAP_TOP"
export const PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_HIGH = "LOW_GAP_HIGH"
export const PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_JUMP_BELOW = "LOW_JUMP_BELOW"

const LOW_SUBSCOPE_SPECS = Object.freeze([
  Object.freeze({
    subscopeId: PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_TOP,
    label: "LOW recent x gapRank TOP",
    familyIds: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION]),
    requiredAllTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN, PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN]),
    requiredAnyTokens: Object.freeze([]),
  }),
  Object.freeze({
    subscopeId: PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_GAP_HIGH,
    label: "LOW recent x gapRank HIGH",
    familyIds: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION]),
    requiredAllTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN, PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN]),
    requiredAnyTokens: Object.freeze([]),
  }),
  Object.freeze({
    subscopeId: PERFECT_PROTOTYPE_TP12_LOW_SUBSCOPE_JUMP_BELOW,
    label: "LOW recent x jumpVsMedian BELOW",
    familyIds: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION]),
    requiredAllTokens: Object.freeze([PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN, PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN]),
    requiredAnyTokens: Object.freeze([]),
  }),
])



const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const readOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const readRowTokenSet = (row) =>
  new Set(
    [
      ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
      ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )

const normalizeRowContract = (value) => {
  const text = String(value ?? "").trim()
  return text || "open_eval_recent_impulse_1d"
}

const readOptionalJson = async (filePath) => {
  if (!pathExists(filePath)) return null
  return readJson(filePath, null)
}

const readSourcePackMetadata = async (inputPath) => {
  const inputDir = path.dirname(String(inputPath ?? "").trim())
  const summary = await readOptionalJson(path.join(inputDir, "summary.json"))
  const manifest = await readOptionalJson(path.join(inputDir, "manifest.json"))
  const manifestSummary = manifest?.summary && typeof manifest.summary === "object" ? manifest.summary : null
  const datasetContract =
    (summary?.datasetContract && typeof summary.datasetContract === "object" ? summary.datasetContract : null) ??
    (manifest?.datasetContract && typeof manifest.datasetContract === "object" ? manifest.datasetContract : null) ??
    null
  const sourceSummary = (summary && typeof summary === "object" ? summary : null) ?? manifestSummary ?? null
  return {
    summary: sourceSummary,
    manifest: manifest && typeof manifest === "object" ? manifest : null,
    datasetContract,
  }
}

const buildCompatDatasetContract = ({ sourceDatasetContract, matchedRows, coverageFrom, coverageTo } = {}) => {
  if (!sourceDatasetContract || typeof sourceDatasetContract !== "object") return null
  return {
    ...sourceDatasetContract,
    rowCount: Number(matchedRows ?? 0) || 0,
    minDateKey: coverageFrom ?? sourceDatasetContract.minDateKey ?? null,
    maxDateKey: coverageTo ?? sourceDatasetContract.maxDateKey ?? null,
  }
}

const buildCompatSummary = ({
  sourceSummary,
  datasetContract,
  outputPath,
  summaryPath,
  matchedRows,
  matchedHitRows,
  matchedNegativeRows,
  matchedNullOutcomeRows,
  matchedSymbolCount,
  coverageFrom,
  coverageTo,
  matchedDateCount,
  matchedMonthCount,
} = {}) => {
  const requestedPeriod =
    (sourceSummary?.requestedPeriod && typeof sourceSummary.requestedPeriod === "object" ? sourceSummary.requestedPeriod : null) ??
    (sourceSummary?.period && typeof sourceSummary.period === "object" ? sourceSummary.period : null) ??
    null
  const sourceBoundaryFilter = sourceSummary?.boundaryFilter && typeof sourceSummary.boundaryFilter === "object"
    ? sourceSummary.boundaryFilter
    : null
  return {
    ...(sourceSummary && typeof sourceSummary === "object" ? sourceSummary : {}),
    period: requestedPeriod ? { ...requestedPeriod } : sourceSummary?.period ?? null,
    requestedPeriod: requestedPeriod ? { ...requestedPeriod } : null,
    rowsWritten: Number(matchedRows ?? 0) || 0,
    positiveRows: Number(matchedHitRows ?? 0) || 0,
    negativeRows: Number(matchedNegativeRows ?? 0) || 0,
    nullOutcomeRows: Number(matchedNullOutcomeRows ?? 0) || 0,
    uniqueSymbols: Number(matchedSymbolCount ?? 0) || 0,
    selectedDecisionDateCount: Number(matchedDateCount ?? 0) || 0,
    selectedDecisionMonthCount: Number(matchedMonthCount ?? 0) || 0,
    outputCoverage:
      coverageFrom && coverageTo
        ? {
            from: coverageFrom,
            to: coverageTo,
            count: Number(matchedDateCount ?? 0) || 0,
          }
        : null,
    coverageComplete: true,
    outputPath,
    summaryPath,
    datasetContract,
    boundaryFilter: sourceBoundaryFilter
      ? {
          ...sourceBoundaryFilter,
          rowsAfter: Number(matchedRows ?? 0) || 0,
          droppedForBoundaryCount: 0,
          droppedEntryBeforeBoundaryCount: 0,
          droppedExitAfterBoundaryCount: 0,
          boundaryFilteringApplied: sourceBoundaryFilter.boundaryFilteringApplied !== false,
        }
      : sourceBoundaryFilter,
  }
}

export const buildPerfectPrototypeTp12LowSubscopeSpecs = () =>
  LOW_SUBSCOPE_SPECS.map((entry) => ({
    ...entry,
    familyIds: Array.from(entry.familyIds),
    requiredAllTokens: Array.from(entry.requiredAllTokens),
    requiredAnyTokens: Array.from(entry.requiredAnyTokens),
  }))

export const listPerfectPrototypeTp12LowSubscopeIds = () =>
  LOW_SUBSCOPE_SPECS.map((entry) => entry.subscopeId)

export const resolvePerfectPrototypeTp12LowSubscopeSpec = (subscopeId) =>
  buildPerfectPrototypeTp12LowSubscopeSpecs().find((entry) => entry.subscopeId === String(subscopeId ?? "").trim()) ?? null

export const matchPerfectPrototypeTp12LowSubscopeRow = ({ row, subscopeSpec, rowContract } = {}) => {
  const normalizedRowContract = normalizeRowContract(rowContract)
  if (normalizedRowContract !== "open_eval_recent_impulse_1d") {
    throw new Error(`unsupported TP12 LOW subscope row contract: ${normalizedRowContract}`)
  }
  const normalizedSpec =
    subscopeSpec && typeof subscopeSpec === "object"
      ? subscopeSpec
      : resolvePerfectPrototypeTp12LowSubscopeSpec(subscopeSpec)
  if (!normalizedSpec) return false
  const tokenSet = readRowTokenSet(row)
  if (!normalizedSpec.requiredAllTokens.every((token) => tokenSet.has(token))) return false
  if (normalizedSpec.requiredAnyTokens.length > 0 && !normalizedSpec.requiredAnyTokens.some((token) => tokenSet.has(token))) {
    return false
  }
  return true
}

const toSummary = ({
  inputPath,
  outputPath,
  sourceRunId,
  sourceStageLabel,
  rowContract,
  subscopeSpec,
  inputRows,
  matchedRows,
  matchedHitRows,
  matchedNegativeRows,
  matchedNullOutcomeRows,
  dateKeys,
  monthKeys,
  symbolKeys,
  familyRowCounts,
} = {}) => {
  const orderedDates = uniqueSorted(Array.from(dateKeys ?? []))
  return {
    sourceRunId: sourceRunId ? String(sourceRunId) : null,
    sourceStageLabel: sourceStageLabel ? String(sourceStageLabel) : null,
    rowContract: normalizeRowContract(rowContract),
    inputPath,
    outputPath,
    subscopeId: subscopeSpec?.subscopeId ?? null,
    subscopeLabel: subscopeSpec?.label ?? null,
    regime: "LOW",
    horizonId: "1D",
    familyIds: Array.isArray(subscopeSpec?.familyIds) ? Array.from(subscopeSpec.familyIds) : [],
    requiredAllTokens: Array.isArray(subscopeSpec?.requiredAllTokens) ? Array.from(subscopeSpec.requiredAllTokens) : [],
    requiredAnyTokens: Array.isArray(subscopeSpec?.requiredAnyTokens) ? Array.from(subscopeSpec.requiredAnyTokens) : [],
    inputRows,
    matchedRows,
    matchedHitRows,
    matchedNegativeRows,
    matchedNullOutcomeRows,
    matchedDateCount: orderedDates.length,
    matchedMonthCount: monthKeys?.size ?? 0,
    matchedSymbolCount: symbolKeys?.size ?? 0,
    coverageFrom: orderedDates[0] ?? null,
    coverageTo: orderedDates[orderedDates.length - 1] ?? null,
    familyRowCounts: Object.fromEntries(
      Array.from(familyRowCounts?.entries?.() ?? []).sort((left, right) => left[0].localeCompare(right[0])),
    ),
  }
}

export const filterPerfectPrototypeTp12LowSubscopePack = async ({
  inputPath,
  outDir,
  subscopeId,
  sourceRunId = null,
  sourceStageLabel = null,
  rowContract = "open_eval_recent_impulse_1d",
  requireNonEmpty = true,
} = {}) => {
  const subscopeSpec = resolvePerfectPrototypeTp12LowSubscopeSpec(subscopeId)
  if (!subscopeSpec) {
    throw new Error(`unknown TP12 LOW subscope: ${subscopeId}`)
  }
  const normalizedInputPath = path.resolve(String(inputPath ?? "").trim())
  const normalizedOutDir = path.resolve(String(outDir ?? "").trim())
  if (!normalizedInputPath || !normalizedOutDir) {
    throw new Error("filterPerfectPrototypeTp12LowSubscopePack requires inputPath and outDir")
  }
  const normalizedRowContract = normalizeRowContract(rowContract)
  await ensureDir(normalizedOutDir)
  const outputPath = path.join(normalizedOutDir, "daily_pack.jsonl")
  const writer = await createJsonlWriter(outputPath)

  const dateKeys = new Set()
  const monthKeys = new Set()
  const symbolKeys = new Set()
  const familyRowCounts = new Map()
  let inputRows = 0
  let matchedRows = 0
  let matchedHitRows = 0
  let matchedNegativeRows = 0
  let matchedNullOutcomeRows = 0

  try {
    await iterateJsonl(normalizedInputPath, {
      strict: true,
      onRow: async (row) => {
        inputRows += 1
        if (!matchPerfectPrototypeTp12LowSubscopeRow({ row, subscopeSpec, rowContract: normalizedRowContract })) return
        matchedRows += 1
        const outcomeHitTarget = readOutcomeHitTarget(row)
        if (outcomeHitTarget === true) {
          matchedHitRows += 1
        } else if (outcomeHitTarget === false) {
          matchedNegativeRows += 1
        } else {
          matchedNullOutcomeRows += 1
        }
        const dateKey = String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()
        if (dateKey) {
          dateKeys.add(dateKey)
          const monthKey = buildMonthKey(dateKey)
          if (monthKey) monthKeys.add(monthKey)
        }
        const symbol = String(row?.symbol ?? "").trim()
        if (symbol) symbolKeys.add(symbol)
        const matchedFamilyId = Array.isArray(subscopeSpec?.familyIds) ? String(subscopeSpec.familyIds[0] ?? "").trim() : ""
        if (matchedFamilyId) {
          familyRowCounts.set(matchedFamilyId, Number(familyRowCounts.get(matchedFamilyId) ?? 0) + 1)
        }
        await writer.writeRow(row)
      },
    })
  } finally {
    await writer.close()
  }

  const summary = toSummary({
    inputPath: normalizedInputPath,
    outputPath,
    sourceRunId,
    sourceStageLabel,
    rowContract: normalizedRowContract,
    subscopeSpec,
    inputRows,
    matchedRows,
    matchedHitRows,
    matchedNegativeRows,
    matchedNullOutcomeRows,
    dateKeys,
    monthKeys,
    symbolKeys,
    familyRowCounts,
  })

  const sourceMetadata = await readSourcePackMetadata(normalizedInputPath)
  const compatDatasetContract = buildCompatDatasetContract({
    sourceDatasetContract: sourceMetadata.datasetContract,
    matchedRows,
    coverageFrom: summary.coverageFrom,
    coverageTo: summary.coverageTo,
  })
  const compatSummaryPath = path.join(normalizedOutDir, "summary.json")
  const compatSummary = buildCompatSummary({
    sourceSummary: sourceMetadata.summary,
    datasetContract: compatDatasetContract,
    outputPath,
    summaryPath: compatSummaryPath,
    matchedRows,
    matchedHitRows,
    matchedNegativeRows,
    matchedNullOutcomeRows,
    matchedSymbolCount: summary.matchedSymbolCount,
    coverageFrom: summary.coverageFrom,
    coverageTo: summary.coverageTo,
    matchedDateCount: summary.matchedDateCount,
    matchedMonthCount: summary.matchedMonthCount,
  })

  await writeJson(path.join(normalizedOutDir, "filter_summary.json"), summary)
  await writeJson(path.join(normalizedOutDir, "filter_manifest.json"), {
    sourceRunId: summary.sourceRunId,
    sourceStageLabel: summary.sourceStageLabel,
    rowContract: summary.rowContract,
    inputPath: normalizedInputPath,
    outputPath,
    subscopeId: summary.subscopeId,
    subscopeLabel: summary.subscopeLabel,
    regime: summary.regime,
    horizonId: summary.horizonId,
    familyIds: summary.familyIds,
    requiredAllTokens: summary.requiredAllTokens,
    requiredAnyTokens: summary.requiredAnyTokens,
    requireNonEmpty: requireNonEmpty === true,
  })
  await writeJson(compatSummaryPath, compatSummary)
  await writeJson(path.join(normalizedOutDir, "manifest.json"), {
    ...(sourceMetadata.manifest && typeof sourceMetadata.manifest === "object" ? sourceMetadata.manifest : {}),
    outputPath,
    summaryPath: compatSummaryPath,
    datasetContract: compatDatasetContract,
    discoveryUniverseId:
      compatDatasetContract?.discoveryUniverseId ?? sourceMetadata.manifest?.discoveryUniverseId ?? sourceMetadata.summary?.discoveryUniverseId ?? null,
    requestedLookbackTradingDays:
      compatDatasetContract?.requestedLookbackTradingDays ??
      sourceMetadata.manifest?.requestedLookbackTradingDays ??
      sourceMetadata.summary?.requestedLookbackTradingDays ??
      null,
    enabledRecentImpulseLanes:
      compatDatasetContract?.enabledRecentImpulseLanes ??
      sourceMetadata.manifest?.enabledRecentImpulseLanes ??
      sourceMetadata.summary?.enabledRecentImpulseLanes ??
      [],
    allowedStepALanes:
      compatDatasetContract?.allowedStepALanes ??
      sourceMetadata.manifest?.allowedStepALanes ??
      sourceMetadata.summary?.allowedStepALanes ??
      [],
    includeSameDayHigh8:
      compatDatasetContract?.includeSameDayHigh8 ??
      sourceMetadata.manifest?.includeSameDayHigh8 ??
      sourceMetadata.summary?.includeSameDayHigh8 ??
      null,
    summary: compatSummary,
  })

  if (requireNonEmpty === true && matchedRows < 1) {
    throw new Error(`TP12 LOW subscope filter produced zero rows for ${summary.subscopeId}: ${normalizedInputPath}`)
  }

  return summary
}
