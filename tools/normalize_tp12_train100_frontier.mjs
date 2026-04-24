#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { normalizeTp12Train100Frontier } from "../src/lib/tp12_train100_frontier_normalizer.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("normalize_tp12_train100_frontier requires --contract")
  const summary = await normalizeTp12Train100Frontier({
    contractPath: path.resolve(cwd, contractPath),
    outFrontierPath: toText(getFlag(flags, "out-frontier", "")),
    outSummaryPath: toText(getFlag(flags, "out-summary", getFlag(flags, "out", ""))),
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        status: summary.status,
        sourceAvailable: summary.sourceAvailable,
        outputFrontierSize: summary.outputFrontierSize,
        unresolvedFrontierCount: summary.unresolvedFrontierCount,
        blockedReason: summary.blockedReason ?? null,
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

