#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12OperationalSeedSupportRows } from "../src/lib/tp12_operational_seed_support_materializer.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const outSupportRowsPath = toText(getFlag(flags, "out-support-rows", ""))
  if (!contractPath || !outSupportRowsPath) {
    throw new Error("build_tp12_operational_seed_support_rows requires --contract-path and --out-support-rows")
  }
  const { summary } = await buildTp12OperationalSeedSupportRows({
    contractPath: path.resolve(cwd, contractPath),
    candidateCatalogPath: toText(getFlag(flags, "candidate-catalog", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "candidate-catalog", "")))
      : undefined,
    tokenizedEventsPath: toText(getFlag(flags, "tokenized-events", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "tokenized-events", "")))
      : undefined,
    candlePath: toText(getFlag(flags, "candle-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "candle-path", "")))
      : undefined,
    outSupportRowsPath: path.resolve(cwd, outSupportRowsPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : undefined,
  })
  console.log(
    JSON.stringify(
      {
        status: "passed",
        selectedCandidateCount: summary.selectedCandidateCount,
        supportRows: summary.supportRows,
        hitRows: summary.hitRows,
        missRows: summary.missRows,
        rowPrecision: summary.rowPrecision,
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

