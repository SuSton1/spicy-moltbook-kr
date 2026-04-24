#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100UnsatCompletionCertificate } from "../src/lib/tp12_train100_unsat_completion_certificate.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("build_tp12_train100_unsat_completion_certificate requires --contract")
  const summary = await buildTp12Train100UnsatCompletionCertificate({
    contractPath: path.resolve(cwd, contractPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", getFlag(flags, "out", ""))),
    outReportPath: toText(getFlag(flags, "out-report", getFlag(flags, "out-md", ""))),
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        conclusion: summary.conclusion.code,
        existenceResolved: summary.conclusion.existenceResolved,
        absenceProvenInScope: summary.conclusion.absenceProvenInScope,
        verifiedSurvivorCount: summary.metrics.verifiedSurvivorCount,
        remainingFrontierSize: summary.metrics.remainingFrontierSize,
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

