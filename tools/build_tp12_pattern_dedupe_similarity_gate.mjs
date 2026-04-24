#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12PatternDedupeSimilarityGate } from "../src/lib/tp12_pattern_dedupe_similarity_gate.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, false))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const patternsPath = toText(getFlag(flags, "patterns", ""))
  const operationalEventsPath = toText(getFlag(flags, "operational-events", ""))
  const outSurvivorsPath = toText(getFlag(flags, "out-survivors", ""))
  const outRejectedPath = toText(getFlag(flags, "out-rejected", ""))
  if (!patternsPath || !operationalEventsPath || !outSurvivorsPath || !outRejectedPath) {
    throw new Error(
      "build_tp12_pattern_dedupe_similarity_gate requires --patterns, --operational-events, --out-survivors, and --out-rejected",
    )
  }
  const { summary } = await buildTp12PatternDedupeSimilarityGate({
    patternsPath: path.resolve(cwd, patternsPath),
    operationalEventsPath: path.resolve(cwd, operationalEventsPath),
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outSurvivorsPath: path.resolve(cwd, outSurvivorsPath),
    outRejectedPath: path.resolve(cwd, outRejectedPath),
    outSummaryPath: toText(getFlag(flags, "out-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-summary", "")))
      : null,
    trainDateFrom: toText(getFlag(flags, "train-from", "")) || undefined,
    trainDateTo: toText(getFlag(flags, "train-to", "")) || undefined,
    lockedFutureFrom: toText(getFlag(flags, "locked-future-from", "")) || undefined,
    hitField: toText(getFlag(flags, "hit-field", "")) || undefined,
    requireEntryExecutable: optionalBool(getFlag(flags, "require-entry-executable", undefined)),
    exactSupport: optionalBool(getFlag(flags, "exact-support", undefined)),
    nearSupportJaccard: optionalNumber(getFlag(flags, "near-support-jaccard", "")),
    sameFamilyJaccard: optionalNumber(getFlag(flags, "same-family-jaccard", "")),
    tokenJaccard: optionalNumber(getFlag(flags, "token-jaccard", "")),
    containment: optionalNumber(getFlag(flags, "containment", "")),
    patternTopSymbolShareMax: optionalNumber(getFlag(flags, "pattern-top-symbol-share-max", "")),
    patternTopYearShareMax: optionalNumber(getFlag(flags, "pattern-top-year-share-max", "")),
    failOnMissingConditionAtoms: optionalBool(getFlag(flags, "fail-on-missing-condition-atoms", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        survivorCount: summary.survivorCount,
        rejectedCount: summary.rejectedCount,
        rejectReasonCounts: summary.rejectReasonCounts,
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
