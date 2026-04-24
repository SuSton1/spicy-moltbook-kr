#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitQualityGateSummary } from "../src/lib/tp12_year2hit_quality_gate.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const trainGateSummaryPath = toText(getFlag(flags, "train-gate-summary", ""))
  const candidateEventsPath = toText(getFlag(flags, "candidate-events", ""))
  const candidateCatalogPath = toText(getFlag(flags, "candidate-catalog", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", ""))
  if (!trainGateSummaryPath || !candidateEventsPath || !candidateCatalogPath || !outSummaryPath) {
    throw new Error(
      "build_tp12_year2hit_quality_gate_summary requires --train-gate-summary, --candidate-events, --candidate-catalog, and --out-summary",
    )
  }
  const summary = await buildTp12Year2hitQualityGateSummary({
    trainGateSummaryPath: path.resolve(cwd, trainGateSummaryPath),
    candidateEventsPath: path.resolve(cwd, candidateEventsPath),
    candidateCatalogPath: path.resolve(cwd, candidateCatalogPath),
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outSurvivorsPath: toText(getFlag(flags, "out-survivors", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-survivors", "")))
      : null,
    outRejectedPath: toText(getFlag(flags, "out-rejected", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-rejected", "")))
      : null,
    outFilteredTrainGateSummaryPath: toText(getFlag(flags, "out-filtered-train-gate-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-filtered-train-gate-summary", "")))
      : null,
    minRowPrecision: optionalNumber(getFlag(flags, "min-row-precision", "")),
    minDatePrecision: optionalNumber(getFlag(flags, "min-date-precision", "")),
    minHitRows: optionalNumber(getFlag(flags, "min-hit-rows", "")),
    minUniqueHitDates: optionalNumber(getFlag(flags, "min-unique-hit-dates", "")),
    minUniqueHitSymbols: optionalNumber(getFlag(flags, "min-unique-hit-symbols", "")),
    maxTop1HitDateShare: optionalNumber(getFlag(flags, "max-top1-hit-date-share", "")),
    maxTop1MatchDateShare: optionalNumber(getFlag(flags, "max-top1-match-date-share", "")),
    maxMatchRows: optionalNumber(getFlag(flags, "max-match-rows", "")),
    hitDefinition: toText(getFlag(flags, "hit-definition", "")),
    hitField: toText(getFlag(flags, "hit-field", "")),
    failOnZeroQualitySurvivors: optionalBool(getFlag(flags, "fail-on-zero-quality-survivors", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
        trainGateSurvivorCount: summary.trainGateSurvivorCount,
        passedSurvivorCount: summary.passedSurvivorCount,
        rejectedSurvivorCount: summary.rejectedSurvivorCount,
        passedPatternIdsSha256: summary.passedPatternIdsSha256,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
