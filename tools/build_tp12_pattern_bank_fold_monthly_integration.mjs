#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildTp12PatternBankFoldMonthlyIntegration,
  DEFAULT_TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_CONTRACT_PATH,
} from "../src/lib/tp12_pattern_bank_fold_monthly_integration.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const maybePath = (value, cwd) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, true))

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const outSummaryPath = maybePath(getFlag(flags, "out-summary", getFlag(flags, "out", "")), cwd)
  if (!outSummaryPath) throw new Error("build_tp12_pattern_bank_fold_monthly_integration requires --out-summary")
  const summary = await buildTp12PatternBankFoldMonthlyIntegration({
    contractPath: maybePath(
      getFlag(flags, "contract", getFlag(flags, "contract-path", DEFAULT_TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_CONTRACT_PATH)),
      cwd,
    ),
    patternBankSummaryPath: maybePath(getFlag(flags, "pattern-bank-summary", ""), cwd),
    nonhitPurgeSummaryPath: maybePath(getFlag(flags, "nonhit-purge-summary", ""), cwd),
    foldStabilitySummaryPath: maybePath(getFlag(flags, "fold-stability-summary", ""), cwd),
    monthlyCoverageSummaryPath: maybePath(getFlag(flags, "monthly-coverage-summary", ""), cwd),
    patternBundleSummaryPath: maybePath(getFlag(flags, "pattern-bundle-summary", ""), cwd),
    monthlyQuotaSummaryPath: maybePath(getFlag(flags, "monthly-quota-summary", ""), cwd),
    outSummaryPath,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    minSelectedPatterns: optionalNumber(getFlag(flags, "min-selected-patterns", "")),
    targetRecommendationsPerFullMonth: optionalNumber(getFlag(flags, "target-recommendations-per-full-month", "")),
    targetOperationalHitsPerFullMonth: optionalNumber(getFlag(flags, "target-operational-hits-per-full-month", "")),
    minOperationalPrecision: optionalNumber(getFlag(flags, "min-operational-precision", "")),
    requirePatternBundleSummary: optionalBool(getFlag(flags, "require-pattern-bundle-summary", undefined)),
    requireMonthlyQuotaSummary: optionalBool(getFlag(flags, "require-monthly-quota-summary", undefined)),
    failOnGateFailure: optionalBool(getFlag(flags, "fail-on-gate-failure", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        selectedPatternCount: summary.counts.selectedPatternCount,
        selectedPatternIdsSha256: summary.finalSelection.selectedPatternIdsSha256,
        integrationGateHash: summary.integrationGateHash,
        failures: summary.failures,
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
