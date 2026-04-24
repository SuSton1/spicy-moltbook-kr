#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildTp12MonthlyQuotaPrecisionSchedulerSummary,
  DEFAULT_TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_CONTRACT_PATH,
} from "../src/lib/tp12_monthly_quota_precision_scheduler.mjs"
import { toBool, toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const candidatesPath = toText(getFlag(flags, "candidates", getFlag(flags, "candidate-rows", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "summary", "")))
  if (!candidatesPath || !outSummaryPath) {
    throw new Error("build_tp12_monthly_quota_precision_scheduler requires --candidates and --out-summary")
  }
  const summary = await buildTp12MonthlyQuotaPrecisionSchedulerSummary({
    candidatesPath: path.resolve(cwd, candidatesPath),
    contractPath: path.resolve(
      cwd,
      toText(getFlag(flags, "contract", getFlag(flags, "contract-path", DEFAULT_TP12_MONTHLY_QUOTA_PRECISION_SCHEDULER_CONTRACT_PATH))),
    ),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outSelectionsPath: resolveOptional(cwd, getFlag(flags, "out-selections", "")),
    fullMonthKeys: toText(getFlag(flags, "full-months", getFlag(flags, "full-month-keys", ""))),
    scoreField: toText(getFlag(flags, "score-field", "")),
    targetRecommendationsPerFullMonth: getFlag(flags, "target-recommendations-per-full-month", undefined),
    maxRecommendationsPerFullMonth: getFlag(flags, "max-recommendations-per-full-month", undefined),
    maxRecommendationsPerDay: getFlag(flags, "max-recommendations-per-day", undefined),
    minSchedulerScore: getFlag(flags, "min-scheduler-score", undefined),
    targetObservedHitRate: getFlag(flags, "target-observed-hit-rate", undefined),
    minWilsonLowerBound95: getFlag(flags, "min-wilson-lower95", undefined),
    minSelectedRows: getFlag(flags, "min-selected-rows", undefined),
    maxTopSymbolShare: getFlag(flags, "max-top-symbol-share", undefined),
    maxTopPatternShare: getFlag(flags, "max-top-pattern-share", undefined),
    maxTopMonthShare: getFlag(flags, "max-top-month-share", undefined),
    maxSymbolPerFullMonth: getFlag(flags, "max-symbol-per-full-month", undefined),
    maxPatternPerFullMonth: getFlag(flags, "max-pattern-per-full-month", undefined),
    failOnGateFailure: toBool(getFlag(flags, "fail-on-gate-failure", false), false),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        selectedRowCount: summary.selectedRowCount,
        monthlyDiagnostics: summary.monthlyDiagnostics,
        rejectReasons: summary.rejectReasons,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
        targetRecommendationsPerFullMonth: toNumber(summary.options?.targetRecommendationsPerFullMonth, null),
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
