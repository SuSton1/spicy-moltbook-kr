#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { runTp12Year2hitPrecisionFirstDailyOnly } from "../src/lib/tp12_year2hit_precision_first_daily_only.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const candidatesPath = toText(getFlag(flags, "candidates", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", ""))
  if (!contractPath || !candidatesPath || !outSummaryPath) {
    throw new Error("run_tp12_year2hit_precision_first_daily_only requires --contract, --candidates, and --out-summary")
  }
  const summary = await runTp12Year2hitPrecisionFirstDailyOnly({
    contractPath: path.resolve(cwd, contractPath),
    candidatesPath: path.resolve(cwd, candidatesPath),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outSelectedPath: toText(getFlag(flags, "out-selected", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-selected", "")))
      : "",
    outRejectedPath: toText(getFlag(flags, "out-rejected", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-rejected", "")))
      : "",
    outRuleReportPath: toText(getFlag(flags, "out-rule-report", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-rule-report", "")))
      : "",
  })
  console.log(JSON.stringify({
    status: summary.status,
    verdict: summary.verdict,
    candidateRows: summary.candidateRows,
    candidateHitRate: summary.candidateHitRate,
    ruleCount: summary.ruleCount,
    researchPassedRuleCount: summary.researchPassedRuleCount,
    promotionPassedRuleCount: summary.promotionPassedRuleCount,
    bestRuleId: summary.bestRule?.ruleId ?? null,
    bestRuleHitRate: summary.bestRule?.hitRate ?? null,
    bestRuleSelectedRows: summary.bestRule?.selectedRows ?? null,
    oosRead: summary.oosRead,
    sideDailyUsed: summary.sideDailyUsed,
    lockedSelectorEmitted: summary.lockedSelectorEmitted,
  }, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}

