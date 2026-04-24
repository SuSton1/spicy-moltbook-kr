#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitCandidateReplayReport } from "../src/lib/tp12_year2hit_candidate_replay_report.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")
const parseList = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const candidateEventsPath = toText(getFlag(flags, "candidate-events", ""))
  const candidateCatalogPath = toText(getFlag(flags, "candidate-catalog", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  if (!candidateEventsPath || !candidateCatalogPath || !outSummaryPath) {
    throw new Error(
      "build_tp12_year2hit_candidate_replay_report requires --candidate-events, --candidate-catalog, and --out-summary",
    )
  }
  const summary = await buildTp12Year2hitCandidateReplayReport({
    candidateEventsPath: path.resolve(cwd, candidateEventsPath),
    candidateCatalogPath: path.resolve(cwd, candidateCatalogPath),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outReportPath: resolveOptional(cwd, getFlag(flags, "out-report", "")),
    outSymbolDateUnionPath: resolveOptional(cwd, getFlag(flags, "out-symbol-date-union", "")),
    outOnePickPerDayPath: resolveOptional(cwd, getFlag(flags, "out-one-pick-per-day", "")),
    labelSummaryPath: resolveOptional(cwd, getFlag(flags, "label-summary", "")),
    tokenizedSummaryPath: resolveOptional(cwd, getFlag(flags, "tokenized-summary", "")),
    materializeSummaryPath: resolveOptional(cwd, getFlag(flags, "materialize-summary", "")),
    preflightSummaryPath: resolveOptional(cwd, getFlag(flags, "preflight-summary", "")),
    dateFrom: toText(getFlag(flags, "date-from", "")),
    dateTo: toText(getFlag(flags, "date-to", "")),
    hitDefinition: toText(getFlag(flags, "hit-definition", "")),
    hitField: toText(getFlag(flags, "hit-field", "hitTarget")),
    minExecutableRecommendationsPerFullMonth: Number(getFlag(flags, "min-executable-recommendations-per-full-month", 5)),
    fullMonthKeys: parseList(getFlag(flags, "full-month-keys", "")),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
        catalogPatternCount: summary.catalogPatternCount,
        catalogMatchedPatternCount: summary.catalogMatchedPatternCount,
        rawPatternMatch: summary.rawPatternMatch,
        symbolDateUnion: summary.symbolDateUnion,
        onePickPerDay: summary.onePickPerDay,
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
