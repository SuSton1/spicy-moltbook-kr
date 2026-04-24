#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { verifyTp12OperationalVetoSeeds } from "../src/lib/tp12_operational_veto_term_miner.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const supportRowsPath = toText(getFlag(flags, "support-rows", ""))
  const candidatesPath = toText(getFlag(flags, "candidates", ""))
  const outVerifiedPath = toText(getFlag(flags, "out-verified", ""))
  if (!contractPath || !supportRowsPath || !candidatesPath || !outVerifiedPath) {
    throw new Error("verify_tp12_operational_veto_seeds requires --contract-path, --support-rows, --candidates, and --out-verified")
  }
  const { summary } = await verifyTp12OperationalVetoSeeds({
    contractPath: path.resolve(cwd, contractPath),
    supportRowsPath: path.resolve(cwd, supportRowsPath),
    candidatesPath: path.resolve(cwd, candidatesPath),
    outVerifiedPath: path.resolve(cwd, outVerifiedPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : undefined,
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        inputCandidateCount: summary.inputCandidateCount,
        verifiedOperational100SeedCount: summary.verifiedOperational100SeedCount,
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

