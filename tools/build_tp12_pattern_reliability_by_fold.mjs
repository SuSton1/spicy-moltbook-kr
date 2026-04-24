#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12PatternReliabilityByFold } from "../src/lib/tp12_pattern_reliability_by_fold.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const eventsPath = toText(getFlag(flags, "events", getFlag(flags, "events-path", "")))
  const splitPlanPath = toText(getFlag(flags, "split-plan", getFlag(flags, "split-plan-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  const manifestPath = toText(getFlag(flags, "manifest", getFlag(flags, "manifest-path", "")))
  if (!eventsPath || !splitPlanPath || !outPath || !manifestPath) {
    throw new Error("build_tp12_pattern_reliability_by_fold requires --events, --split-plan, --out, and --manifest")
  }
  const manifest = await buildTp12PatternReliabilityByFold({
    eventsPath: path.resolve(cwd, eventsPath),
    splitPlanPath: path.resolve(cwd, splitPlanPath),
    outPath: path.resolve(cwd, outPath),
    manifestPath: path.resolve(cwd, manifestPath),
    priorStrengthRow: toNumber(getFlag(flags, "prior-strength-row", 100), 100),
    priorStrengthDate: toNumber(getFlag(flags, "prior-strength-date", 50), 50),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outputRowCount: manifest.outputRowCount,
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
