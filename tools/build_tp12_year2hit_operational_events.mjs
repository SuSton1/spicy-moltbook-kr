#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitOperationalEvents } from "../src/lib/tp12_year2hit_operational_event_enricher.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const inputPath = maybePath(getFlag(flags, "input", getFlag(flags, "input-path", "")), cwd)
  const outEventsPath = maybePath(getFlag(flags, "out-events", getFlag(flags, "out", "")), cwd)
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  if (!inputPath || !outEventsPath || !outSummaryPath) {
    throw new Error("build_tp12_year2hit_operational_events requires --input, --out-events, and --out-summary")
  }
  const summary = await buildTp12Year2hitOperationalEvents({
    inputPath,
    outEventsPath,
    outSummaryPath,
    contractPath: maybePath(getFlag(flags, "contract", getFlag(flags, "contract-path", "")), cwd),
    dateFrom: toText(getFlag(flags, "date-from", "")) || undefined,
    dateTo: toText(getFlag(flags, "date-to", "")) || undefined,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    explodeSupportPatternIds: optionalBool(getFlag(flags, "explode-support-pattern-ids", undefined)),
    keepNonExecutableRows: optionalBool(getFlag(flags, "keep-non-executable-rows", undefined)),
    failOnZeroEvents: optionalBool(getFlag(flags, "fail-on-zero-events", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outEventsPath,
        outSummaryPath,
        outputEventRowCount: summary.outputEventRowCount,
        patternCount: summary.patternCount,
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
