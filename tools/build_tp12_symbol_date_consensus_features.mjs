#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12SymbolDateConsensusFeatures } from "../src/lib/tp12_symbol_date_consensus_features.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const eventsPath = toText(getFlag(flags, "events", getFlag(flags, "events-path", "")))
  const patternReliabilityPath = toText(getFlag(flags, "pattern-reliability", getFlag(flags, "pattern-reliability-path", "")))
  const clustersPath = toText(getFlag(flags, "clusters", getFlag(flags, "clusters-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  const summaryPath = toText(getFlag(flags, "summary", getFlag(flags, "summary-path", "")))
  if (!eventsPath || !patternReliabilityPath || !clustersPath || !outPath || !summaryPath) {
    throw new Error("build_tp12_symbol_date_consensus_features requires --events, --pattern-reliability, --clusters, --out, and --summary")
  }
  const summary = await buildTp12SymbolDateConsensusFeatures({
    eventsPath: path.resolve(cwd, eventsPath),
    patternReliabilityPath: path.resolve(cwd, patternReliabilityPath),
    clustersPath: path.resolve(cwd, clustersPath),
    outPath: path.resolve(cwd, outPath),
    summaryPath: path.resolve(cwd, summaryPath),
    foldId: toText(getFlag(flags, "fold-id", getFlag(flags, "foldId", ""))),
    splitPlanPath: toText(getFlag(flags, "split-plan", getFlag(flags, "split-plan-path", "")))
      ? path.resolve(cwd, toText(getFlag(flags, "split-plan", getFlag(flags, "split-plan-path", ""))))
      : "",
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        symbolDateRowCount: summary.symbolDateRowCount,
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
