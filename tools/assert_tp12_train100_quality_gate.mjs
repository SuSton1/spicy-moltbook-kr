#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { assertTp12Train100QualityGate } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const parseCatalogs = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const catalogArg = toText(getFlag(flags, "candidate-catalogs", getFlag(flags, "candidate-catalog", "")))
  const outAcceptedPath = toText(getFlag(flags, "out-accepted", ""))
  const outRejectedPath = toText(getFlag(flags, "out-rejected", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "summary", "")))
  if (!contractPath || !catalogArg || !outAcceptedPath || !outSummaryPath) {
    throw new Error("assert_tp12_train100_quality_gate requires --contract, --candidate-catalogs, --out-accepted, and --out-summary")
  }
  const summary = await assertTp12Train100QualityGate({
    contractPath: path.resolve(cwd, contractPath),
    candidateCatalogPaths: parseCatalogs(catalogArg).map((item) => path.resolve(cwd, item)),
    outAcceptedPath: path.resolve(cwd, outAcceptedPath),
    outRejectedPath: outRejectedPath ? path.resolve(cwd, outRejectedPath) : "",
    outSummaryPath: path.resolve(cwd, outSummaryPath),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        inputCandidateCount: summary.inputCandidateCount,
        acceptedCount: summary.acceptedCount,
        rejectedCount: summary.rejectedCount,
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
