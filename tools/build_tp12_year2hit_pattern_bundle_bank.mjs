#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitPatternBundleBank } from "../src/lib/tp12_year2hit_pattern_bundle_selector.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

const parseYears = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const purgedPatternsPath = maybePath(getFlag(flags, "purged-patterns", getFlag(flags, "patterns", "")), cwd)
  const operationalEventsPath = maybePath(getFlag(flags, "operational-events", getFlag(flags, "events", "")), cwd)
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  if (!purgedPatternsPath || !operationalEventsPath || !outSummaryPath) {
    throw new Error("build_tp12_year2hit_pattern_bundle_bank requires --purged-patterns, --operational-events, and --out-summary")
  }
  const summary = await buildTp12Year2hitPatternBundleBank({
    purgedPatternsPath,
    operationalEventsPath,
    contractPath: maybePath(getFlag(flags, "contract", getFlag(flags, "contract-path", "")), cwd),
    outSummaryPath,
    outBundlesPath: maybePath(getFlag(flags, "out-bundles", ""), cwd),
    outSelectedPatternsPath: maybePath(getFlag(flags, "out-selected-patterns", ""), cwd),
    outUnionRowsPath: maybePath(getFlag(flags, "out-union-rows", ""), cwd),
    dateFrom: toText(getFlag(flags, "date-from", "")) || undefined,
    dateTo: toText(getFlag(flags, "date-to", "")) || undefined,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    coreYears: toText(getFlag(flags, "core-years", "")) ? parseYears(getFlag(flags, "core-years", "")) : undefined,
    minOperationalHitDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-dates-per-year", "")),
    minOperationalHitSymbolDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-symbol-dates-per-year", "")),
    minPatterns: optionalNumber(getFlag(flags, "min-patterns", "")),
    maxPatterns: optionalNumber(getFlag(flags, "max-patterns", "")),
    maxTopPatternHitShare: optionalNumber(getFlag(flags, "max-top-pattern-hit-share", "")),
    forbidYearFillerFragments: optionalBool(getFlag(flags, "forbid-year-filler-fragments", undefined)),
    failOnZeroBundles: optionalBool(getFlag(flags, "fail-on-zero-bundles", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outSummaryPath,
        candidatePatternCount: summary.candidatePatternCount,
        selectedPatternCount: summary.selectedPatternCount,
        bundleCount: summary.bundleCount,
        selectedPatternIdsSha256: summary.selectedPatternIdsSha256,
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
