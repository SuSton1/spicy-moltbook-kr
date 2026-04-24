#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { assertTp12Train100Preflight } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const tokenizedEventsPath = toText(getFlag(flags, "tokenized-events", ""))
  const contextFeaturesPath = toText(getFlag(flags, "context-features", ""))
  const entryFeasibilitySummaryPath = toText(getFlag(flags, "entry-feasibility-summary", ""))
  const outPath = toText(getFlag(flags, "out", getFlag(flags, "out-summary", "")))
  if (!contractPath || !tokenizedEventsPath || !outPath) {
    throw new Error("assert_tp12_train100_preflight requires --contract, --tokenized-events, and --out")
  }
  const summary = await assertTp12Train100Preflight({
    contractPath: path.resolve(cwd, contractPath),
    tokenizedEventsPath: path.resolve(cwd, tokenizedEventsPath),
    contextFeaturesPath: contextFeaturesPath ? path.resolve(cwd, contextFeaturesPath) : "",
    entryFeasibilitySummaryPath: entryFeasibilitySummaryPath ? path.resolve(cwd, entryFeasibilitySummaryPath) : "",
    outPath: path.resolve(cwd, outPath),
  })
  console.log(JSON.stringify({ status: summary.status, inputRowCount: summary.inputRowCount, hitRowCount: summary.hitRowCount }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
