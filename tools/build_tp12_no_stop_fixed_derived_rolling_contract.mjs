#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_PATH,
  buildTp12NoStopFixedDerivedRollingContract,
  loadTp12NoStopFixedResearchContract,
} from "../src/lib/tp12_no_stop_fixed_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const fixedContractPath = toText(
    getFlag(flags, "fixed-contract-path", DEFAULT_TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_PATH),
  )
  const splitGroup = toText(getFlag(flags, "split-group", "screen"))
  const splitIds = String(getFlag(flags, "split-ids", ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const contractIdSuffix = toText(getFlag(flags, "contract-id-suffix", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!outPath) {
    throw new Error("build_tp12_no_stop_fixed_derived_rolling_contract requires --out")
  }
  return {
    cwd,
    fixedContractPath,
    splitGroup,
    splitIds,
    contractIdSuffix,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const fixedContract = await loadTp12NoStopFixedResearchContract({
    contractPath: args.fixedContractPath,
    cwd,
  })
  const contract = buildTp12NoStopFixedDerivedRollingContract({
    fixedContract,
    splitGroup: args.splitGroup,
    splitIds: args.splitIds,
    contractIdSuffix: args.contractIdSuffix || null,
  })
  await writeJson(args.outPath, contract)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        contractId: contract.contractId,
        splitGroup: args.splitGroup,
        windowCount: Array.isArray(contract.windows) ? contract.windows.length : 0,
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
