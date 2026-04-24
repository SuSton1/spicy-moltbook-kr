#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { pruneTp12Train100FrontierDominance } from "../src/lib/tp12_train100_dominance_pruner.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("prune_tp12_train100_frontier_dominance requires --contract")
  const summary = await pruneTp12Train100FrontierDominance({
    contractPath: path.resolve(cwd, contractPath),
    frontierPath: toText(getFlag(flags, "frontier", "")),
    normalizationSummaryPath: toText(getFlag(flags, "normalization-summary", "")),
    outFrontierPath: toText(getFlag(flags, "out-frontier", "")),
    outSummaryPath: toText(getFlag(flags, "out-summary", getFlag(flags, "out", ""))),
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        status: summary.status,
        proofMode: summary.proofMode,
        outputFrontierSize: summary.outputFrontierSize,
        unresolvedFrontierCount: summary.unresolvedFrontierCount,
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

