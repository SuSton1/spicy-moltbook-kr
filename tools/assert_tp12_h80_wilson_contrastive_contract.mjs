#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { assertTp12H80WilsonContrastiveContract } from "../src/lib/tp12_h80_wilson_contrastive_contract.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!contractPath || !outPath) {
    throw new Error("assert_tp12_h80_wilson_contrastive_contract requires --contract and --out")
  }
  const summary = await assertTp12H80WilsonContrastiveContract({
    contractPath: path.resolve(cwd, contractPath),
    outPath: path.resolve(cwd, outPath),
    failOnViolation: toBool(getFlag(flags, "fail-on-violation", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        patchKey: summary.patchKey,
        targetWilsonLower95: summary.targetWilsonLower95,
        minSelectedRows: summary.minSelectedRows,
        failures: summary.failures,
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
