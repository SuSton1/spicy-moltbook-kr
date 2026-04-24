#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitOperatingGateSummary } from "../src/lib/tp12_year2hit_operating_gate.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const replaySummaryPath = toText(getFlag(flags, "replay-summary", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  if (!replaySummaryPath || !outSummaryPath) {
    throw new Error("build_tp12_year2hit_operating_gate_summary requires --replay-summary and --out-summary")
  }
  const summary = await buildTp12Year2hitOperatingGateSummary({
    replaySummaryPath: path.resolve(cwd, replaySummaryPath),
    contractPath: resolveOptional(cwd, getFlag(flags, "contract-path", "")),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outReportPath: resolveOptional(cwd, getFlag(flags, "out-report", "")),
    targetSelectionKey: toText(getFlag(flags, "target-selection-key", "")),
    targetObservedHitRate: getFlag(flags, "target-observed-hit-rate", undefined),
    minWilsonLowerBound95: getFlag(flags, "min-wilson-lower-bound95", undefined),
    minSelectedRows: getFlag(flags, "min-selected-rows", undefined),
    minUniqueMatchedDates: getFlag(flags, "min-unique-matched-dates", undefined),
    minUniqueMatchedSymbols: getFlag(flags, "min-unique-matched-symbols", undefined),
    maxTop1DateShare: getFlag(flags, "max-top1-date-share", undefined),
    hitDefinition: toText(getFlag(flags, "hit-definition", "")),
    hitField: toText(getFlag(flags, "hit-field", "")),
    requireMonthlyCadence: toBool(getFlag(flags, "require-monthly-cadence", undefined), undefined),
    minExecutableRecommendationsPerFullMonth: getFlag(flags, "min-executable-recommendations-per-full-month", undefined),
    failOnGateFailure: toBool(getFlag(flags, "fail-on-gate-failure", undefined), undefined),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
        selectionKey: summary.selected.selectionKey,
        selectedRows: summary.selected.selectedRows,
        hitRows: summary.selected.hitRows,
        observedHitRate: summary.selected.observedHitRate,
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
