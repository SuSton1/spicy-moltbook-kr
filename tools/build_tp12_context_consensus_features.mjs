#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12ContextConsensusFeatures } from "../src/lib/tp12_context_consensus_joiner.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const consensusPath = toText(getFlag(flags, "consensus", getFlag(flags, "consensus-path", "")))
  const contextPath = toText(getFlag(flags, "context", getFlag(flags, "context-path", "")))
  const outPath = toText(getFlag(flags, "out", getFlag(flags, "out-path", "")))
  const summaryPath = toText(getFlag(flags, "summary", getFlag(flags, "summary-path", "")))
  const foldId = toText(getFlag(flags, "fold-id", ""))
  if (!consensusPath || !contextPath || !outPath || !summaryPath) {
    throw new Error("build_tp12_context_consensus_features requires --consensus, --context, --out, and --summary")
  }
  const summary = await buildTp12ContextConsensusFeatures({
    consensusPath: path.resolve(cwd, consensusPath),
    contextPath: path.resolve(cwd, contextPath),
    outPath: path.resolve(cwd, outPath),
    summaryPath: path.resolve(cwd, summaryPath),
    foldId,
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        foldId: summary.foldId,
        consensusRowCount: summary.consensusRowCount,
        outputRowCount: summary.outputRowCount,
        missingContextRowCount: summary.missingContextRowCount,
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
