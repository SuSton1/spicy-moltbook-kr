#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { materializeTp12CandidateEvents } from "../src/lib/tp12_candidate_event_materializer.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const candidateCatalogPath = toText(getFlag(flags, "candidate-catalog", ""))
  const tokenizedEventsPath = toText(getFlag(flags, "tokenized-events", ""))
  const outEventsPath = toText(getFlag(flags, "out-events", ""))
  if (!candidateCatalogPath || !tokenizedEventsPath || !outEventsPath) {
    throw new Error("materialize_tp12_candidate_events requires --candidate-catalog, --tokenized-events, and --out-events")
  }
  const summary = await materializeTp12CandidateEvents({
    candidateCatalogPath: path.resolve(cwd, candidateCatalogPath),
    tokenizedEventsPath: path.resolve(cwd, tokenizedEventsPath),
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outEventsPath: path.resolve(cwd, outEventsPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : null,
    dateFrom: toText(getFlag(flags, "date-from", "")) || undefined,
    dateTo: toText(getFlag(flags, "date-to", "")) || undefined,
    requireYear2hitPassed: optionalBool(getFlag(flags, "require-year2hit-passed", undefined)),
    requireCandidateQualityPassed: optionalBool(getFlag(flags, "require-candidate-quality-passed", undefined)),
    failOnZeroMatchCandidates: optionalBool(getFlag(flags, "fail-on-zero-match-candidates", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outEventsPath: path.resolve(cwd, outEventsPath),
        inputCandidateCount: summary.inputCandidateCount,
        candidateCount: summary.candidateCount,
        rejectedByQualityCount: summary.rejectedByQualityCount,
        outputRowCount: summary.outputRowCount,
        hitRowCount: summary.hitRowCount,
        rowHitRate: summary.rowHitRate,
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
