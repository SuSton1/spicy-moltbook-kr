#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100ExistenceCertificate } from "../src/lib/tp12_train100_existence_certificate.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  const outReportPath = toText(getFlag(flags, "out-report", getFlag(flags, "out-md", "")))
  if (!contractPath) throw new Error("build_tp12_train100_existence_certificate requires --contract")
  const summary = await buildTp12Train100ExistenceCertificate({
    contractPath: path.resolve(cwd, contractPath),
    outSummaryPath: outSummaryPath ? path.resolve(cwd, outSummaryPath) : "",
    outReportPath: outReportPath ? path.resolve(cwd, outReportPath) : "",
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        conclusion: summary.conclusion.code,
        existenceResolved: summary.conclusion.existenceResolved,
        scopes: summary.scopes.map((scope) => ({
          scopeId: scope.scopeId,
          absenceStatus: scope.absenceStatus,
          searchComplete: scope.searchComplete,
        })),
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

