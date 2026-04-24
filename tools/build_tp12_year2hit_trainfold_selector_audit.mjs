#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitTrainfoldSelectorAudit } from "../src/lib/tp12_year2hit_trainfold_selector_audit.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveOptional = (cwd, value) => (toText(value) ? path.resolve(cwd, toText(value)) : "")

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const survivorCatalogPath = toText(getFlag(flags, "survivor-catalog", ""))
  const candidateEventsPath = toText(getFlag(flags, "candidate-events", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  if (!survivorCatalogPath || !candidateEventsPath || !outSummaryPath) {
    throw new Error(
      "build_tp12_year2hit_trainfold_selector_audit requires --survivor-catalog, --candidate-events, and --out-summary",
    )
  }
  const summary = await buildTp12Year2hitTrainfoldSelectorAudit({
    survivorCatalogPath: path.resolve(cwd, survivorCatalogPath),
    candidateEventsPath: path.resolve(cwd, candidateEventsPath),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outReportPath: resolveOptional(cwd, getFlag(flags, "out-report", "")),
    coreYears: toText(getFlag(flags, "core-years", "")),
    targetHitRate: toNumber(getFlag(flags, "target-hit-rate", 0.8), 0.8),
    minSelectedRowsForTarget: toNumber(getFlag(flags, "min-selected-rows-for-target", 20), 20),
    dateFrom: toText(getFlag(flags, "date-from", "")),
    dateTo: toText(getFlag(flags, "date-to", "")),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
        survivorCount: summary.survivorCount,
        trainDateCount: summary.trainDateCount,
        targetHitRate: summary.targetHitRate,
        bestNoAbstainPolicy: summary.bestNoAbstainPolicy,
        bestNoAbstainHitRate: summary.bestNoAbstainHitRate,
        bestTopCutPolicy: summary.bestTopCutPolicy,
        bestTopCut: summary.bestTopCut,
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
