#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildTp12SelectorFeatureSourceRepairRows,
  DEFAULT_SELECTOR_FEATURE_SOURCE_CONTRACT_PATH,
} from "../src/lib/tp12_selector_feature_source_repair.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const baseFeaturePath = toText(getFlag(flags, "base-features", getFlag(flags, "base-feature-path", "")))
  const sideFeaturePath = toText(getFlag(flags, "side-features", getFlag(flags, "side-feature-path", "")))
  const intradayFeaturePath = toText(getFlag(flags, "intraday-features", getFlag(flags, "intraday-feature-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  const summaryPath = toText(getFlag(flags, "summary", getFlag(flags, "summary-path", "")))
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", DEFAULT_SELECTOR_FEATURE_SOURCE_CONTRACT_PATH)))
  const gateId = toText(getFlag(flags, "gate-id", "d0_close"))
  if (!baseFeaturePath || !sideFeaturePath || !intradayFeaturePath || !outPath || !summaryPath) {
    throw new Error(
      "build_tp12_selector_feature_source_repair requires --base-features, --side-features, --intraday-features, --out, and --summary",
    )
  }
  const summary = await buildTp12SelectorFeatureSourceRepairRows({
    baseFeaturePath: path.resolve(cwd, baseFeaturePath),
    sideFeaturePath: path.resolve(cwd, sideFeaturePath),
    intradayFeaturePath: path.resolve(cwd, intradayFeaturePath),
    outPath: path.resolve(cwd, outPath),
    summaryPath: path.resolve(cwd, summaryPath),
    contractPath: path.resolve(cwd, contractPath),
    gateId,
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outputRowCount: summary.outputRowCount,
        coverage: summary.coverage,
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
