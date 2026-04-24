#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { assertTp12PrecisionFirstDailyOnlyContract } from "../src/lib/tp12_precision_first_contract_assert.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("assert_tp12_precision_first_daily_only_contract requires --contract")
  const { summary } = await assertTp12PrecisionFirstDailyOnlyContract({
    contractPath: path.resolve(cwd, contractPath),
    candidatePath: toText(getFlag(flags, "candidates", "")),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : "",
  })
  console.log(JSON.stringify({
    status: summary.status,
    patchKey: summary.patchKey,
    dailyOnly: summary.dailyOnly,
    sideDailyAllowed: summary.sideDailyAllowed,
    lockedSelectorEmitted: summary.lockedSelectorEmitted,
  }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}

