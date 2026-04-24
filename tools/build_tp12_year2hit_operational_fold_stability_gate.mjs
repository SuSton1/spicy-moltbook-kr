#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildTp12Year2hitOperationalFoldStabilityGate,
  DEFAULT_TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_CONTRACT_PATH,
} from "../src/lib/tp12_year2hit_operational_fold_stability_gate.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const parseCsv = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const operationalEventsPath = toText(getFlag(flags, "operational-events", getFlag(flags, "operational-events-path", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "out", "")))
  if (!operationalEventsPath) throw new Error("build_tp12_year2hit_operational_fold_stability_gate requires --operational-events")
  if (!outSummaryPath) throw new Error("build_tp12_year2hit_operational_fold_stability_gate requires --out-summary")
  const summary = await buildTp12Year2hitOperationalFoldStabilityGate({
    operationalEventsPath: path.resolve(cwd, operationalEventsPath),
    patternMetadataPath: toText(getFlag(flags, "pattern-metadata", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "pattern-metadata", "")))
      : "",
    contractPath: path.resolve(
      cwd,
      toText(getFlag(flags, "contract-path", DEFAULT_TP12_TRAIN_INTERNAL_VALIDATION_PROTOCOL_CONTRACT_PATH)),
    ),
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outStablePatternsPath: toText(getFlag(flags, "out-stable-patterns", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-stable-patterns", "")))
      : "",
    outRejectedPatternsPath: toText(getFlag(flags, "out-rejected-patterns", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-rejected-patterns", "")))
      : "",
    fullMonthKeys: parseCsv(getFlag(flags, "full-month-keys", "")),
    failOnGateFailure:
      getFlag(flags, "fail-on-gate-failure", undefined) === undefined
        ? undefined
        : toBool(getFlag(flags, "fail-on-gate-failure", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        stablePatternCount: summary.stablePatternCount,
        selectedPatternIdsSha256: summary.selectedPatternIdsSha256,
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
