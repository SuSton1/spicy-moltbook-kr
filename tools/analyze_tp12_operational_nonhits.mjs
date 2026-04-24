#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12OperationalNonhitAnatomyReport } from "../src/lib/tp12_operational_nonhit_anatomy_report.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const supportRowsPath = toText(getFlag(flags, "support-rows", ""))
  const outReportPath = toText(getFlag(flags, "out-report", ""))
  if (!contractPath || !supportRowsPath || !outReportPath) {
    throw new Error("analyze_tp12_operational_nonhits requires --contract-path, --support-rows, and --out-report")
  }
  const { report } = await buildTp12OperationalNonhitAnatomyReport({
    contractPath: path.resolve(cwd, contractPath),
    supportRowsPath: path.resolve(cwd, supportRowsPath),
    outReportPath: path.resolve(cwd, outReportPath),
  })
  console.log(
    JSON.stringify(
      {
        status: "passed",
        rows: report.rows,
        hits: report.hits,
        misses: report.misses,
        candidateCount: report.candidateCount,
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

