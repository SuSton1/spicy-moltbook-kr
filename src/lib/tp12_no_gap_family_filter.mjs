import path from "node:path"

import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, readJson, writeJson } from "./io.mjs"
import {
  buildTp12NoGapAddonFeatureMap,
  TP12_NO_GAP_ADDON_BASE,
  TP12_NO_GAP_ADDON_IDS,
  TP12_NO_GAP_BASE_FAMILY_CLOSE,
  TP12_NO_GAP_BASE_FAMILY_IDS,
  TP12_NO_GAP_BASE_FAMILY_JUMP,
} from "./tp12_no_gap_addon_features.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN,
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION,
} from "./perfect_prototype_rule_family_spec.mjs"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
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
      .map((value) => toText(value))
      .filter(Boolean),
  )

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

const filterObjectKeys = (input, predicate) =>
  Object.fromEntries(
    Object.entries(input && typeof input === "object" && !Array.isArray(input) ? input : {}).filter(([key]) => predicate(key)),
  )

const shouldKeepToken = (token) => {
  const normalized = toText(token).toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith("tag:xsec.gaprank:")) return false
  if (normalized.startsWith("tag:event.")) return false
  if (normalized.startsWith("tag:lowgaptop.")) return false
  return true
}

const stripGaplessVectors = ({ row, addonFeatureMap } = {}) => {
  const gaplessFeatureVec = filterObjectKeys(row?.featureVec, (key) => !toText(key).toLowerCase().startsWith("gap."))
  const gaplessNumericFeatureMap = filterObjectKeys(row?.numericFeatureMap, (key) => {
    const normalized = toText(key).toLowerCase()
    if (!normalized) return false
    if (normalized.startsWith("feature.gap.")) return false
    if (normalized.startsWith("event.gap")) return false
    if (normalized.startsWith("market.gap")) return false
    if (normalized.startsWith("xsec.gap")) return false
    return true
  })
  const gaplessXsecEventVec = filterObjectKeys(row?.xsecEventVec, (key) => {
    const normalized = toText(key).toLowerCase()
    return normalized !== "gaprankpct" && normalized !== "absgaprankpct"
  })
  const gaplessMarketContextVec = filterObjectKeys(row?.marketContextVec, (key) => {
    const normalized = toText(key).toLowerCase()
    return !["gapmedian", "absgapmedian", "gapupshare", "widegapshare"].includes(normalized)
  })
  return {
    ...row,
    featureVec: {
      ...gaplessFeatureVec,
      ...(addonFeatureMap ?? {}),
    },
    eventFeatureVec: {},
    xsecEventVec: gaplessXsecEventVec,
    marketContextVec: gaplessMarketContextVec,
    numericFeatureMap: gaplessNumericFeatureMap,
    categoricalTokens: uniqueSorted((row?.categoricalTokens ?? []).filter((token) => shouldKeepToken(token))),
    contextualTokens: uniqueSorted((row?.contextualTokens ?? []).filter((token) => shouldKeepToken(token))),
    disableDerivedEventTagTokens: true,
    disableGapRankContextTokens: true,
    disableLowGapTopGeneralizationTokens: true,
  }
}

const normalizeRowContract = (value) => {
  const text = toText(value)
  return text || "open_eval_recent_impulse_1d"
}

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

export const matchTp12NoGapBaseFamilyRow = ({ row, baseFamilyId, rowContract } = {}) => {
  const normalizedBaseFamilyId = assertNonEmpty(baseFamilyId, "baseFamilyId")
  if (!TP12_NO_GAP_BASE_FAMILY_IDS.includes(normalizedBaseFamilyId)) {
    throw new Error(`unknown TP12 no-gap baseFamilyId=${baseFamilyId}`)
  }
  const normalizedRowContract = normalizeRowContract(rowContract)
  if (normalizedRowContract !== "open_eval_recent_impulse_1d") {
    throw new Error(`unsupported TP12 no-gap row contract: ${normalizedRowContract}`)
  }
  const tokenSet = readRowTokenSet(row)
  if (!tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_RANK_TOKEN)) return false
  const hasGapTop = tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_TOP_TOKEN)
  const hasGapHigh = tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_GAP_RANK_HIGH_TOKEN)
  const hasJumpBelow = tokenSet.has(PERFECT_PROTOTYPE_RULE_FAMILY_JUMP_VS_MEDIAN_BELOW_TOKEN)
  if (normalizedBaseFamilyId === TP12_NO_GAP_BASE_FAMILY_CLOSE) {
    return !hasGapTop && !hasGapHigh && !hasJumpBelow
  }
  if (normalizedBaseFamilyId === TP12_NO_GAP_BASE_FAMILY_JUMP) {
    return !hasGapTop && !hasGapHigh && hasJumpBelow
  }
  return false
}

const resolveBaseFamilyIds = (baseFamilyId) => {
  if (baseFamilyId === TP12_NO_GAP_BASE_FAMILY_CLOSE) {
    return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_CLOSE_CONTINUATION]
  }
  if (baseFamilyId === TP12_NO_GAP_BASE_FAMILY_JUMP) {
    return [PERFECT_PROTOTYPE_RULE_FAMILY_LOW_JUMP_BELOW_CONTINUATION]
  }
  return []
}

const toSummary = ({
  inputPath,
  outputPath,
  sourceRunId,
  sourceStageLabel,
  rowContract,
  candidateSpec,
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
    candidateId: candidateSpec?.candidateId ?? null,
    candidateLabel: candidateSpec?.label ?? null,
    baseFamilyId: candidateSpec?.baseFamilyId ?? null,
    addonId: candidateSpec?.addonId ?? null,
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

export const filterTp12NoGapAddonPack = async ({
  inputPath,
  outDir,
  candidateSpec,
  sourceRunId = null,
  sourceStageLabel = null,
  rowContract = "open_eval_recent_impulse_1d",
  requireNonEmpty = true,
} = {}) => {
  const normalizedInputPath = path.resolve(toText(inputPath))
  const normalizedOutDir = path.resolve(toText(outDir))
  if (!normalizedInputPath || !normalizedOutDir) {
    throw new Error("filterTp12NoGapAddonPack requires inputPath and outDir")
  }
  const normalizedCandidateSpec =
    candidateSpec && typeof candidateSpec === "object"
      ? candidateSpec
      : null
  if (!normalizedCandidateSpec) {
    throw new Error("candidateSpec is required")
  }
  if (!TP12_NO_GAP_BASE_FAMILY_IDS.includes(normalizedCandidateSpec.baseFamilyId)) {
    throw new Error(`unknown candidateSpec.baseFamilyId=${normalizedCandidateSpec.baseFamilyId}`)
  }
  if (!TP12_NO_GAP_ADDON_IDS.includes(normalizedCandidateSpec.addonId)) {
    throw new Error(`unknown candidateSpec.addonId=${normalizedCandidateSpec.addonId}`)
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
        if (!matchTp12NoGapBaseFamilyRow({ row, baseFamilyId: normalizedCandidateSpec.baseFamilyId, rowContract: normalizedRowContract })) {
          return
        }
        matchedRows += 1
        const outcomeHitTarget = readOutcomeHitTarget(row)
        if (outcomeHitTarget === true) {
          matchedHitRows += 1
        } else if (outcomeHitTarget === false) {
          matchedNegativeRows += 1
        } else {
          matchedNullOutcomeRows += 1
        }
        const dateKey = toText(row?.decisionDateKey ?? row?.dateKey)
        if (dateKey) {
          dateKeys.add(dateKey)
          const monthKey = buildMonthKey(dateKey)
          if (monthKey) monthKeys.add(monthKey)
        }
        const symbol = toText(row?.symbol)
        if (symbol) symbolKeys.add(symbol)
        for (const familyId of resolveBaseFamilyIds(normalizedCandidateSpec.baseFamilyId)) {
          familyRowCounts.set(familyId, Number(familyRowCounts.get(familyId) ?? 0) + 1)
        }
        const addonFeatureMap =
          normalizedCandidateSpec.addonId === TP12_NO_GAP_ADDON_BASE
            ? {}
            : buildTp12NoGapAddonFeatureMap({
                row,
                addonId: normalizedCandidateSpec.addonId,
              })
        await writer.writeRow(stripGaplessVectors({ row, addonFeatureMap }))
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
    candidateSpec: normalizedCandidateSpec,
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
    candidateId: summary.candidateId,
    candidateLabel: summary.candidateLabel,
    baseFamilyId: summary.baseFamilyId,
    addonId: summary.addonId,
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
    throw new Error(`TP12 no-gap addon filter produced zero rows for ${summary.candidateId}: ${normalizedInputPath}`)
  }
  return summary
}
