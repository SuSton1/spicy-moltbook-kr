#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12EntryFeasibilityAudit } from "../src/lib/tp12_entry_feasibility_audit.mjs"
import { toBool, toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const eventsPath = toText(getFlag(flags, "events", getFlag(flags, "events-path", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  if (!eventsPath || !outSummaryPath) {
    throw new Error("build_tp12_entry_feasibility_audit requires --events and --out-summary")
  }
  const summary = await buildTp12EntryFeasibilityAudit({
    eventsPath: path.resolve(cwd, eventsPath),
    calendarPath: resolveOptional(cwd, getFlag(flags, "calendar-path", "")),
    candlePath: resolveOptional(cwd, getFlag(flags, "candle-path", "")),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outInvalidPath: resolveOptional(cwd, getFlag(flags, "out-invalid", "")),
    maxEntryGapCalendarDays: toNumber(getFlag(flags, "max-entry-gap-calendar-days", 7), 7),
    checkEntryBar: toBool(getFlag(flags, "check-entry-bar", false), false),
    failOnInvalid: toBool(getFlag(flags, "fail-on-invalid", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        invalidRowCount: summary.invalidRowCount,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
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
