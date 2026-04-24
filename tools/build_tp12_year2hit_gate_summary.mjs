#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { writeTp12Year2hitGateSummary } from "../src/lib/tp12_year2hit_overlay_control.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const controlSummaryPath = toText(getFlag(flags, "control-summary-path", ""))
  const gatedSummaryPath = toText(getFlag(flags, "gated-summary-path", ""))
  const comparisonLabel = toText(getFlag(flags, "comparison-label", "primary"))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!controlSummaryPath || !gatedSummaryPath || !outPath) {
    throw new Error(
      "build_tp12_year2hit_gate_summary requires --control-summary-path, --gated-summary-path, and --out",
    )
  }
  return {
    controlSummaryPath: path.resolve(cwd, controlSummaryPath),
    gatedSummaryPath: path.resolve(cwd, gatedSummaryPath),
    comparisonLabel,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const summary = await writeTp12Year2hitGateSummary(args)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        controlRunId: summary.controlRunId,
        gatedRunId: summary.gatedRunId,
        screenDeltaHitRate: summary.screen.deltaHitRate,
        finalConfirmDeltaHitRate: summary.finalConfirm.deltaHitRate,
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
