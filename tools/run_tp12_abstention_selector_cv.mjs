#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { runTp12AbstentionSelectorCv } from "../src/lib/tp12_abstention_selector_cv.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const featuresPath = toText(getFlag(flags, "features", getFlag(flags, "features-path", "")))
  const selectorConfigPath = toText(getFlag(flags, "selector-config", getFlag(flags, "selector-config-path", "")))
  const outPredictionsPath = toText(getFlag(flags, "out-pred", getFlag(flags, "out-predictions", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "summary", "")))
  if (!featuresPath || !selectorConfigPath || !outPredictionsPath || !outSummaryPath) {
    throw new Error("run_tp12_abstention_selector_cv requires --features, --selector-config, --out-pred, and --out-summary")
  }
  const summary = await runTp12AbstentionSelectorCv({
    featuresPath: path.resolve(cwd, featuresPath),
    selectorConfigPath: path.resolve(cwd, selectorConfigPath),
    outPredictionsPath: path.resolve(cwd, outPredictionsPath),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        selectionPolicyId: summary.selectionPolicyId,
        selectedRows: summary.selectedRows,
        hitRows: summary.hitRows,
        wilsonLower95: summary.wilsonLower95,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
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
