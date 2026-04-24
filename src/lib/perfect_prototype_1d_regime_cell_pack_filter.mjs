import path from "node:path"

import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, readJson, writeJson } from "./io.mjs"
import {
  matchPerfectPrototype1dRegimeCellRow,
  resolvePerfectPrototype1dRegimeCellSpec,
  resolvePerfectPrototype1dRegimeRowFamilyIds,
} from "./perfect_prototype_1d_regime_cell_contract.mjs"
import {
  PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW,
  PERFECT_PROTOTYPE_1D_REGIME_CELL_MID,
  PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP,
} from "./perfect_prototype_1d_regime_cell_contract.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN,
} from "./perfect_prototype_rule_family_spec.mjs"

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
  return text || "root_tokens"
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

const matchOpenEvalRecentImpulse1dCellRow = ({ row, cellSpec } = {}) => {
  const tokenSet = readRowTokenSet(row)
  switch (String(cellSpec?.cellId ?? "").trim()) {
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP:
      return tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN)
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_MID:
      return tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN)
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW:
      return tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)
    default:
      return false
  }
}

const resolveOpenEvalRecentImpulse1dRowFamilyIds = ({ row, cellSpec } = {}) => {
  const tokenSet = readRowTokenSet(row)
  switch (String(cellSpec?.cellId ?? "").trim()) {
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_TOP:
      return tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RANK_TOKEN)
        ? [PERFECT_PROTOTYPE_RULE_FAMILY_TOP_CLOSE_RECENT]
        : []
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_MID:
      return tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_RANK_TOKEN)
        ? [PERFECT_PROTOTYPE_RULE_FAMILY_MID_CLOSE_CONTINUATION]
        : []
    case PERFECT_PROTOTYPE_1D_REGIME_CELL_LOW:
      if (!tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)) return []
      if (tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN)) {
        return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION]
      }
      if (tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN)) {
        return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_HIGH_CONTINUATION]
      }
      if (tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN)) {
        return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION]
      }
      return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION]
    default:
      return []
  }
}

const matchRowByContract = ({ row, cellSpec, rowContract } = {}) => {
  const normalizedRowContract = normalizeRowContract(rowContract)
  if (normalizedRowContract === "open_eval_recent_impulse_1d") {
    return matchOpenEvalRecentImpulse1dCellRow({ row, cellSpec })
  }
  return matchPerfectPrototype1dRegimeCellRow({ row, cellSpec })
}

const resolveRowFamilyIdsByContract = ({ row, cellSpec, rowContract } = {}) => {
  const normalizedRowContract = normalizeRowContract(rowContract)
  if (normalizedRowContract === "open_eval_recent_impulse_1d") {
    return resolveOpenEvalRecentImpulse1dRowFamilyIds({ row, cellSpec })
  }
  return resolvePerfectPrototype1dRegimeRowFamilyIds({ row, cellSpec })
}

const toSummary = ({
  inputPath,
  outputPath,
  sourceRunId,
  sourceStageLabel,
  rowContract,
  cellSpec,
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
    cellId: cellSpec?.cellId ?? null,
    cellLabel: cellSpec?.label ?? null,
    regime: cellSpec?.regime ?? null,
    horizonId: cellSpec?.horizonId ?? null,
    familyIds: Array.isArray(cellSpec?.familyIds) ? Array.from(cellSpec.familyIds) : [],
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

export const filterPerfectPrototype1dRegimeCellPack = async ({
  inputPath,
  outDir,
  cellId,
  sourceRunId = null,
  sourceStageLabel = null,
  rowContract = "root_tokens",
  requireNonEmpty = true,
} = {}) => {
  const cellSpec = resolvePerfectPrototype1dRegimeCellSpec(cellId)
  if (!cellSpec) {
    throw new Error(`unknown 1d regime cell: ${cellId}`)
  }
  const normalizedInputPath = path.resolve(String(inputPath ?? "").trim())
  const normalizedOutDir = path.resolve(String(outDir ?? "").trim())
  if (!normalizedInputPath || !normalizedOutDir) {
    throw new Error("filterPerfectPrototype1dRegimeCellPack requires inputPath and outDir")
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
        if (!matchRowByContract({ row, cellSpec, rowContract: normalizedRowContract })) return
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
        for (const familyId of resolveRowFamilyIdsByContract({ row, cellSpec, rowContract: normalizedRowContract })) {
          familyRowCounts.set(familyId, Number(familyRowCounts.get(familyId) ?? 0) + 1)
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
    cellSpec,
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
    cellId: summary.cellId,
    cellLabel: summary.cellLabel,
    regime: summary.regime,
    horizonId: summary.horizonId,
    familyIds: summary.familyIds,
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
    throw new Error(`1d regime cell filter produced zero rows for ${summary.cellId}: ${normalizedInputPath}`)
  }

  return summary
}
