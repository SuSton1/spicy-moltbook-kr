#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildTp12Year2hitMonthlyCoverageBundleOptimizer,
  DEFAULT_TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_CONTRACT_PATH,
} from "../src/lib/tp12_year2hit_monthly_coverage_bundle_optimizer.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

const parseList = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const eligiblePatternsPath = maybePath(getFlag(flags, "eligible-patterns", getFlag(flags, "patterns", "")), cwd)
  const operationalEventsPath = maybePath(getFlag(flags, "operational-events", getFlag(flags, "events", "")), cwd)
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", ""), cwd)
  if (!eligiblePatternsPath || !operationalEventsPath || !outSummaryPath) {
    throw new Error(
      "build_tp12_year2hit_monthly_coverage_bundle_optimizer requires --eligible-patterns, --operational-events, and --out-summary",
    )
  }
  const summary = await buildTp12Year2hitMonthlyCoverageBundleOptimizer({
    eligiblePatternsPath,
    operationalEventsPath,
    contractPath: maybePath(
      getFlag(flags, "contract", getFlag(flags, "contract-path", DEFAULT_TP12_YEAR2HIT_MONTHLY_COVERAGE_BUNDLE_OPTIMIZER_CONTRACT_PATH)),
      cwd,
    ),
    outSummaryPath,
    outBundlePath: maybePath(getFlag(flags, "out-bundle", getFlag(flags, "out-bundles", "")), cwd),
    outSelectedPatternsPath: maybePath(getFlag(flags, "out-selected-patterns", ""), cwd),
    outUnionRowsPath: maybePath(getFlag(flags, "out-union-rows", ""), cwd),
    outRejectedPatternsPath: maybePath(getFlag(flags, "out-rejected-patterns", ""), cwd),
    dateFrom: toText(getFlag(flags, "date-from", "")) || undefined,
    dateTo: toText(getFlag(flags, "date-to", "")) || undefined,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    coreYears: toText(getFlag(flags, "core-years", "")) ? parseList(getFlag(flags, "core-years", "")) : undefined,
    fullMonthKeys: toText(getFlag(flags, "full-months", getFlag(flags, "full-month-keys", ""))) || undefined,
    minOperationalHitDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-dates-per-year", "")),
    minOperationalHitSymbolDatesPerYear: optionalNumber(getFlag(flags, "min-operational-hit-symbol-dates-per-year", "")),
    minPatternOperationalPrecision: optionalNumber(getFlag(flags, "min-pattern-operational-precision", "")),
    maxPatternOperationalMissRows: optionalNumber(getFlag(flags, "max-pattern-operational-miss-rows", "")),
    maxPatternNonExecutableRows: optionalNumber(getFlag(flags, "max-pattern-non-executable-rows", "")),
    minPatternOperationalHitRows: optionalNumber(getFlag(flags, "min-pattern-operational-hit-rows", "")),
    minPatterns: optionalNumber(getFlag(flags, "min-patterns", "")),
    maxPatterns: optionalNumber(getFlag(flags, "max-patterns", "")),
    targetRecommendationsPerFullMonth: optionalNumber(getFlag(flags, "target-recommendations-per-full-month", "")),
    targetOperationalHitsPerFullMonth: optionalNumber(getFlag(flags, "target-operational-hits-per-full-month", "")),
    minBundleOperationalPrecision: optionalNumber(getFlag(flags, "min-bundle-operational-precision", "")),
    requireExplicitFullMonthKeys: optionalBool(getFlag(flags, "require-explicit-full-month-keys", undefined)),
    failOnGateFailure: optionalBool(getFlag(flags, "fail-on-gate-failure", undefined)),
    maxTopPatternHitShare: optionalNumber(getFlag(flags, "max-top-pattern-hit-share", "")),
    maxTopPatternRecommendationShare: optionalNumber(getFlag(flags, "max-top-pattern-recommendation-share", "")),
    maxTopSymbolRecommendationShare: optionalNumber(getFlag(flags, "max-top-symbol-recommendation-share", "")),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        bundleCount: summary.bundleCount,
        candidatePatternCount: summary.candidatePatternCount,
        selectedPatternCount: summary.selectedPatternCount,
        selectedPatternIdsSha256: summary.selectedPatternIdsSha256,
        minOperationalHitsPerFullMonth: summary.bundle?.unionMetrics?.minOperationalHitsPerFullMonth ?? 0,
        minRecommendationsPerFullMonth: summary.bundle?.unionMetrics?.minRecommendationsPerFullMonth ?? 0,
        outSummaryPath,
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
