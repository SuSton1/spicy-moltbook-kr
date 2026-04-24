#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitExecutablePatternBank } from "../src/lib/tp12_year2hit_executable_pattern_bank.mjs"
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
  const operationalEventsPath = maybePath(getFlag(flags, "operational-events", getFlag(flags, "events", "")), cwd)
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  if (!operationalEventsPath || !outSummaryPath) {
    throw new Error("build_tp12_year2hit_executable_pattern_bank requires --operational-events and --out-summary")
  }
  const summary = await buildTp12Year2hitExecutablePatternBank({
    operationalEventsPath,
    contractPath: maybePath(getFlag(flags, "contract", getFlag(flags, "contract-path", "")), cwd),
    outSummaryPath,
    outBankPath: maybePath(getFlag(flags, "out-bank", ""), cwd),
    outRejectedPath: maybePath(getFlag(flags, "out-rejected", ""), cwd),
    dateFrom: toText(getFlag(flags, "date-from", "")) || undefined,
    dateTo: toText(getFlag(flags, "date-to", "")) || undefined,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    coreYears: toText(getFlag(flags, "core-years", "")) ? parseYears(getFlag(flags, "core-years", "")) : undefined,
    minOperationalHitDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-dates-per-year", "")),
    minOperationalHitSymbolDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-symbol-dates-per-year", "")),
    failOnZeroSurvivors: optionalBool(getFlag(flags, "fail-on-zero-survivors", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outSummaryPath,
        patternCount: summary.patternCount,
        survivorCount: summary.survivorCount,
        survivorPatternIdsSha256: summary.survivorPatternIdsSha256,
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
