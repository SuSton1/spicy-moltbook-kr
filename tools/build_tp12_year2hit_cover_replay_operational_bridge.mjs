#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitCoverReplayOperationalBridge } from "../src/lib/tp12_year2hit_cover_replay_operational_bridge.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const parseList = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const coverReplayPath = maybePath(getFlag(flags, "cover-replay", getFlag(flags, "cover-replay-path", "")), cwd)
  const matchedRowsPath = maybePath(getFlag(flags, "matched-rows", getFlag(flags, "matched-rows-path", "")), cwd)
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  const outPatternsPath = maybePath(getFlag(flags, "out-patterns", ""), cwd)
  const outEventsPath = maybePath(getFlag(flags, "out-events", ""), cwd)
  if (!coverReplayPath || !matchedRowsPath || !outSummaryPath || !outPatternsPath || !outEventsPath) {
    throw new Error(
      "build_tp12_year2hit_cover_replay_operational_bridge requires --cover-replay, --matched-rows, --out-summary, --out-patterns, and --out-events",
    )
  }
  const summary = await buildTp12Year2hitCoverReplayOperationalBridge({
    coverReplayPath,
    matchedRowsPath,
    outSummaryPath,
    outPatternsPath,
    outEventsPath,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    coreYears: toText(getFlag(flags, "core-years", "")) ? parseList(getFlag(flags, "core-years", "")) : undefined,
    minOperationalHitDatesPerYearRequired: optionalNumber(getFlag(flags, "min-operational-hit-dates-per-year", "")),
    minOperationalHitSymbolDatesPerYearRequired: optionalNumber(getFlag(flags, "min-operational-hit-symbol-dates-per-year", "")),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        coverReplayRowCount: summary.coverReplayRowCount,
        passedPatternCount: summary.passedPatternCount,
        eventRowCount: summary.eventRowCount,
        eventOperationalHitRows: summary.eventOperationalHitRows,
        eventOperationalMissRows: summary.eventOperationalMissRows,
        outSummaryPath,
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
