#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12NestedSplitPlan } from "../src/lib/tp12_nested_split_plan.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const outPath = toText(getFlag(flags, "out", ""))
  if (!outPath) throw new Error("build_tp12_nested_split_plan requires --out")
  const summary = await buildTp12NestedSplitPlan({
    candidateEventsPath: resolveOptional(cwd, getFlag(flags, "candidate-events", getFlag(flags, "events", ""))),
    calendarPath: resolveOptional(cwd, getFlag(flags, "calendar-path", "")),
    outPath: path.resolve(cwd, outPath),
    dateFrom: toText(getFlag(flags, "from", "")),
    dateTo: toText(getFlag(flags, "to", "")),
    validationYears: toText(getFlag(flags, "validation-years", "")),
    purgeBars: toNumber(getFlag(flags, "purge-bars", 5), 5),
    embargoBars: toNumber(getFlag(flags, "embargo-bars", 5), 5),
    labelHorizonBars: toNumber(getFlag(flags, "label-horizon-bars", 3), 3),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outerFoldCount: summary.outerFoldCount,
        outPath: path.resolve(cwd, outPath),
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
