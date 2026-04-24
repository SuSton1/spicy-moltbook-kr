#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { mineTp12OperationalVetoSeedCandidates } from "../src/lib/tp12_operational_veto_term_miner.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const supportRowsPath = toText(getFlag(flags, "support-rows", ""))
  const outCandidatesPath = toText(getFlag(flags, "out-candidates", ""))
  if (!contractPath || !supportRowsPath || !outCandidatesPath) {
    throw new Error("mine_tp12_operational_nonhit_veto_terms requires --contract-path, --support-rows, and --out-candidates")
  }
  const { summary } = await mineTp12OperationalVetoSeedCandidates({
    contractPath: path.resolve(cwd, contractPath),
    supportRowsPath: path.resolve(cwd, supportRowsPath),
    outCandidatesPath: path.resolve(cwd, outCandidatesPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : undefined,
  })
  console.log(
    JSON.stringify(
      {
        status: "passed",
        patternCount: summary.patternCount,
        evaluatedRuleCount: summary.evaluatedRuleCount,
        acceptedCount: summary.acceptedCount,
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

