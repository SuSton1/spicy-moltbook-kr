#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12PatternClusters } from "../src/lib/tp12_pattern_cluster_dedupe.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const catalogPath = toText(getFlag(flags, "catalog", getFlag(flags, "catalog-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  const summaryPath = toText(getFlag(flags, "summary", getFlag(flags, "summary-path", "")))
  if (!catalogPath || !outPath || !summaryPath) {
    throw new Error("build_tp12_pattern_clusters requires --catalog, --out, and --summary")
  }
  const summary = await buildTp12PatternClusters({
    catalogPath: path.resolve(cwd, catalogPath),
    eventsPath: resolveOptional(cwd, getFlag(flags, "events", getFlag(flags, "events-path", ""))),
    outPath: path.resolve(cwd, outPath),
    summaryPath: path.resolve(cwd, summaryPath),
    tokenJaccardThreshold: toNumber(getFlag(flags, "token-jaccard-threshold", 0.8), 0.8),
    supportJaccardThreshold: toNumber(getFlag(flags, "support-jaccard-threshold", 0.85), 0.85),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        patternCount: summary.patternCount,
        clusterCount: summary.clusterCount,
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
