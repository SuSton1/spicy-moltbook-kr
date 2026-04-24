#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12PathQualityLabelAudit } from "../src/lib/tp12_path_quality_label_audit.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const pathLabelPath = toText(getFlag(flags, "path-labels", getFlag(flags, "path-label-path", "")))
  const candidatePath = toText(getFlag(flags, "candidates", getFlag(flags, "candidate-path", "")))
  const predictionsPath = toText(getFlag(flags, "predictions", getFlag(flags, "prediction-path", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "summary", "")))
  const outSelectedPath = toText(getFlag(flags, "out-selected", getFlag(flags, "selected-out", "")))
  const outDailyPath = toText(getFlag(flags, "out-daily", getFlag(flags, "daily-out", "")))
  if (!pathLabelPath || !candidatePath || !predictionsPath || !outSummaryPath || !outSelectedPath || !outDailyPath) {
    throw new Error(
      "build_tp12_path_quality_label_audit requires --path-labels, --candidates, --predictions, --out-summary, --out-selected, and --out-daily",
    )
  }
  const summary = await buildTp12PathQualityLabelAudit({
    pathLabelPath: path.resolve(cwd, pathLabelPath),
    candidatePath: path.resolve(cwd, candidatePath),
    predictionsPath: path.resolve(cwd, predictionsPath),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outSelectedPath: path.resolve(cwd, outSelectedPath),
    outDailyPath: path.resolve(cwd, outDailyPath),
    dateFrom: toText(getFlag(flags, "from", getFlag(flags, "date-from", ""))),
    dateTo: toText(getFlag(flags, "to", getFlag(flags, "date-to", ""))),
    forbiddenDateFrom: toText(getFlag(flags, "forbidden-date-from", "")),
    forbiddenDateTo: toText(getFlag(flags, "forbidden-date-to", "")),
    targetPct: toNumber(getFlag(flags, "target-pct", 0.12), 0.12),
    nearMissMinPct: toNumber(getFlag(flags, "near-miss-min-pct", 0.08), 0.08),
    hardNegativeMaxForwardReturnPct: toNumber(getFlag(flags, "hard-negative-max-forward-return-pct", 0.04), 0.04),
    conflictTolerance: toNumber(getFlag(flags, "conflict-tolerance", 1e-9), 1e-9),
    sampleLimit: toNumber(getFlag(flags, "sample-limit", 20), 20),
    separabilityMinComparisonCount: toNumber(getFlag(flags, "separability-min-comparison-count", 25), 25),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        selectedRows: summary.selectedRows,
        hitRows: summary.hitRows,
        hitRate: summary.hitRate,
        wilsonLower95: summary.wilsonLower95,
        falsePositiveWithSameDateHitCount: summary.falsePositiveWithSameDateHitCount,
        falsePositiveNoSameDateHitCount: summary.falsePositiveNoSameDateHitCount,
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
