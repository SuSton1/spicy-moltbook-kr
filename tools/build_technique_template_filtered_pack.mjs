#!/usr/bin/env node

import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTechniqueEventMatchesForRow } from "../src/lib/technique_event_row_builder.mjs"
import { createJsonlWriter, iterateJsonl, pathExists, readJson, writeJson } from "../src/lib/io.mjs"
import { toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const parseCsv = (value) => uniqueSortedStrings(String(value ?? "").split(","))

const toBoolean = (value, defaultValue = false) => {
  const text = String(value ?? "").trim().toLowerCase()
  if (!text) return defaultValue
  if (["1", "true", "yes", "y"].includes(text)) return true
  if (["0", "false", "no", "n"].includes(text)) return false
  throw new Error(`Invalid boolean flag value: ${value}`)
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

const validateSourcePackMetadata = ({ inputPath, sourceMetadata } = {}) => {
  const period = sourceMetadata?.summary?.period && typeof sourceMetadata.summary.period === "object"
    ? sourceMetadata.summary.period
    : null
  if (!sourceMetadata?.summary || !period?.from || !period?.to) {
    throw new Error(
      `Technique template filter requires source pack summary.json with period.from/to: ${inputPath}`,
    )
  }
  if (!sourceMetadata?.manifest || typeof sourceMetadata.manifest !== "object") {
    throw new Error(`Technique template filter requires source pack manifest.json: ${inputPath}`)
  }
  if (!sourceMetadata?.datasetContract || typeof sourceMetadata.datasetContract !== "object") {
    throw new Error(`Technique template filter requires source pack datasetContract: ${inputPath}`)
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
  const sourceBoundaryFilter =
    sourceSummary?.boundaryFilter && typeof sourceSummary.boundaryFilter === "object"
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

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const inputPath = toText(getFlag(flags, "input", ""))
  const outDir = toText(getFlag(flags, "out-dir", ""))
  const candidateTemplateId = toText(getFlag(flags, "candidate-template-id", ""))
  const mechanismId = toText(getFlag(flags, "mechanism-id", ""))
  const scopeId = toText(getFlag(flags, "scope-id", ""))
  const lookbackCandidateId = toText(getFlag(flags, "lookback-candidate-id", ""))
  if (!inputPath || !outDir || !candidateTemplateId || !mechanismId || !scopeId || !lookbackCandidateId) {
    throw new Error(
      "build_technique_template_filtered_pack requires --input, --out-dir, --candidate-template-id, --mechanism-id, --scope-id, and --lookback-candidate-id",
    )
  }
  return {
    cwd,
    inputPath: path.resolve(cwd, inputPath),
    outDir: path.resolve(cwd, outDir),
    candidateTemplateId,
    seedId: toText(getFlag(flags, "seed-id", "")),
    bankId: toText(getFlag(flags, "bank-id", "")),
    mechanismId,
    scopeId,
    lookbackCandidateId,
    labelId: toText(getFlag(flags, "label-id", "tp12_no_stop_hit_3d")),
    sourceRunId: toText(getFlag(flags, "source-run-id", "")),
    sourceStageLabel: toText(getFlag(flags, "source-stage-label", "")),
    rowContract: toText(getFlag(flags, "row-contract", "")),
    anchorClauseIds: parseCsv(getFlag(flags, "anchor-clause-ids", "")),
    retestClauseIds: parseCsv(getFlag(flags, "retest-clause-ids", "")),
    compressionClauseIds: parseCsv(getFlag(flags, "compression-clause-ids", "")),
    confirmClauseIds: parseCsv(getFlag(flags, "confirm-clause-ids", "")),
    invalidateClauseIds: parseCsv(getFlag(flags, "invalidate-clause-ids", "")),
    allClauseIds: parseCsv(getFlag(flags, "all-clause-ids", "")),
    requireNonempty: toBoolean(getFlag(flags, "require-nonempty", "false"), false),
  }
}

const buildTemplate = (args) => {
  const clauseSet = {
    anchor: args.anchorClauseIds,
    retest: args.retestClauseIds,
    compression: args.compressionClauseIds,
    confirm: args.confirmClauseIds,
    invalidate: args.invalidateClauseIds,
  }
  const allClauseIds =
    args.allClauseIds.length > 0
      ? args.allClauseIds
      : uniqueSortedStrings([
          ...clauseSet.anchor,
          ...clauseSet.retest,
          ...clauseSet.compression,
          ...clauseSet.confirm,
          ...clauseSet.invalidate,
        ])
  if (allClauseIds.length < 1) {
    throw new Error("Template filter requires at least one clause id")
  }
  return {
    candidateTemplateId: args.candidateTemplateId,
    seedId: args.seedId,
    mechanismId: args.mechanismId,
    clauseSet,
    allClauseIds,
    scopeCandidates: [args.scopeId],
    lookbackCandidateIds: [args.lookbackCandidateId],
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const template = buildTemplate(args)
  const outPath = path.join(args.outDir, "daily_pack.jsonl")
  const filterSummaryPath = path.join(args.outDir, "filter_summary.json")
  const compatSummaryPath = path.join(args.outDir, "summary.json")
  const compatManifestPath = path.join(args.outDir, "manifest.json")
  const writer = await createJsonlWriter(outPath)
  let inputRows = 0
  let matchedRows = 0
  let matchedHitRows = 0
  let matchedNegativeRows = 0
  let matchedNullOutcomeRows = 0
  const matchedDecisionDates = new Set()
  const matchedMonths = new Set()
  const matchedSymbols = new Set()
  try {
    await iterateJsonl(args.inputPath, {
      strict: true,
      onRow: async (row) => {
        inputRows += 1
        const matches = buildTechniqueEventMatchesForRow({
          row,
          templates: [template],
          labelId: args.labelId,
          defaultScopeId: args.scopeId,
          defaultLookbackCandidateId: args.lookbackCandidateId,
        })
        if (matches.length < 1) return
        matchedRows += 1
        const match = matches[0]
        if (match.hitTarget === true) {
          matchedHitRows += 1
        } else if (match.hitTarget === false) {
          matchedNegativeRows += 1
        } else {
          matchedNullOutcomeRows += 1
        }
        matchedDecisionDates.add(match.decisionDateKey)
        const monthKey = String(match.decisionDateKey ?? "").slice(0, 7)
        if (monthKey.length === 7) matchedMonths.add(monthKey)
        matchedSymbols.add(match.symbol)
        await writer.writeRow(row)
      },
    })
  } finally {
    await writer.close()
  }

  const summary = {
    kind: "technique_template_filtered_pack_summary_v1",
    generatedAt: new Date().toISOString(),
    candidateTemplateId: args.candidateTemplateId,
    bankId: args.bankId,
    mechanismId: args.mechanismId,
    scopeId: args.scopeId,
    lookbackCandidateId: args.lookbackCandidateId,
    labelId: args.labelId,
    sourceRunId: args.sourceRunId,
    sourceStageLabel: args.sourceStageLabel,
    rowContract: args.rowContract,
    inputRows,
    matchedRows,
    matchedHitRows,
    matchedNegativeRows,
    matchedNullOutcomeRows,
    matchedDecisionDayCount: matchedDecisionDates.size,
    matchedMonthCount: matchedMonths.size,
    matchedSymbolCount: matchedSymbols.size,
    allClauseIds: template.allClauseIds,
    anchorClauseIds: template.clauseSet.anchor,
    retestClauseIds: template.clauseSet.retest,
    compressionClauseIds: template.clauseSet.compression,
    confirmClauseIds: template.clauseSet.confirm,
    invalidateClauseIds: template.clauseSet.invalidate,
  }

  const orderedDates = Array.from(matchedDecisionDates).sort((left, right) => String(left).localeCompare(String(right)))
  const sourceMetadata = await readSourcePackMetadata(args.inputPath)
  validateSourcePackMetadata({ inputPath: args.inputPath, sourceMetadata })
  const compatDatasetContract = buildCompatDatasetContract({
    sourceDatasetContract: sourceMetadata.datasetContract,
    matchedRows,
    coverageFrom: orderedDates[0] ?? null,
    coverageTo: orderedDates[orderedDates.length - 1] ?? null,
  })
  const compatSummary = buildCompatSummary({
    sourceSummary: sourceMetadata.summary,
    datasetContract: compatDatasetContract,
    outputPath: outPath,
    summaryPath: compatSummaryPath,
    matchedRows,
    matchedHitRows,
    matchedNegativeRows,
    matchedNullOutcomeRows,
    matchedSymbolCount: matchedSymbols.size,
    coverageFrom: orderedDates[0] ?? null,
    coverageTo: orderedDates[orderedDates.length - 1] ?? null,
    matchedDateCount: matchedDecisionDates.size,
    matchedMonthCount: matchedMonths.size,
  })

  await writeJson(filterSummaryPath, summary)
  await writeJson(compatSummaryPath, compatSummary)
  await writeJson(compatManifestPath, {
    ...(sourceMetadata.manifest && typeof sourceMetadata.manifest === "object" ? sourceMetadata.manifest : {}),
    outputPath: outPath,
    summaryPath: compatSummaryPath,
    datasetContract: compatDatasetContract,
    discoveryUniverseId:
      compatDatasetContract?.discoveryUniverseId ??
      sourceMetadata.manifest?.discoveryUniverseId ??
      sourceMetadata.summary?.discoveryUniverseId ??
      null,
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

  if (args.requireNonempty && matchedRows < 1) {
    throw new Error(`Template filter produced zero rows for candidateTemplateId=${args.candidateTemplateId}`)
  }
  console.log(
    JSON.stringify(
      {
        outDir: args.outDir,
        candidateTemplateId: args.candidateTemplateId,
        inputRows,
        matchedRows,
        matchedDecisionDayCount: matchedDecisionDates.size,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
