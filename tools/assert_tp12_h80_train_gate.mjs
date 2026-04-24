#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { assertTp12H80TrainGate } from "../src/lib/tp12_h80_train_gate.mjs"
import { toBool, toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const selectorSummaryPath = toText(getFlag(flags, "selector-summary", getFlag(flags, "selector-summary-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!selectorSummaryPath || !outPath) {
    throw new Error("assert_tp12_h80_train_gate requires --selector-summary and --out")
  }
  const summary = await assertTp12H80TrainGate({
    selectorSummaryPath: path.resolve(cwd, selectorSummaryPath),
    outPath: path.resolve(cwd, outPath),
    selectorKey: toText(getFlag(flags, "selector-key", getFlag(flags, "selectorKey", ""))),
    minSelectedRows: toNumber(getFlag(flags, "min-selected-rows", 100), 100),
    minWilsonLower95: toNumber(getFlag(flags, "min-wilson-lower95", 0.8), 0.8),
    minObservedHitRate: toNumber(getFlag(flags, "min-observed-hit-rate", 0.8), 0.8),
    minActiveYears: toNumber(getFlag(flags, "min-active-years", 4), 4),
    minActiveMonths: toNumber(getFlag(flags, "min-active-months", 24), 24),
    maxTopSymbolShare: toNumber(getFlag(flags, "max-top-symbol-share", 0.1), 0.1),
    maxTopPatternClusterShare: toNumber(getFlag(flags, "max-top-pattern-cluster-share", 0.35), 0.35),
    maxTopRegimeShare: toNumber(getFlag(flags, "max-top-regime-share", 0.5), 0.5),
    maxTopMonthShare: toNumber(getFlag(flags, "max-top-month-share", 0.2), 0.2),
    requireConcentration: toBool(getFlag(flags, "require-concentration", true), true),
    requireCoverage: toBool(getFlag(flags, "require-coverage", true), true),
    failOnGateFailure: toBool(getFlag(flags, "fail-on-gate-failure", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        selectedRows: summary.selected.selectedRows,
        hitRows: summary.selected.hitRows,
        wilsonLower95: summary.selected.wilsonLower95,
        rejectReasons: summary.rejectReasons,
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
