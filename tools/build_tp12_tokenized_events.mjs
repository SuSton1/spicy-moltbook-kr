#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12TokenizedEvents } from "../src/lib/tp12_feature_tokenizer.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, false))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const labelEventsPath = toText(getFlag(flags, "label-events", ""))
  const candlePath = toText(getFlag(flags, "candle-path", ""))
  const outEventsPath = toText(getFlag(flags, "out-events", ""))
  const outSummaryPath = toText(getFlag(flags, "out-summary", ""))
  if (!labelEventsPath || !candlePath || !outEventsPath) {
    throw new Error("build_tp12_tokenized_events requires --label-events, --candle-path, and --out-events")
  }
  const summary = await buildTp12TokenizedEvents({
    labelEventsPath: path.resolve(cwd, labelEventsPath),
    candlePath: path.resolve(cwd, candlePath),
    universePath: toText(getFlag(flags, "universe-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "universe-path", "")))
      : "",
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outEventsPath: path.resolve(cwd, outEventsPath),
    outSummaryPath: outSummaryPath ? path.resolve(cwd, outSummaryPath) : null,
    tokenizerVersion: toText(getFlag(flags, "tokenizer-version", "")) || undefined,
    requireUniverse: optionalBool(getFlag(flags, "require-universe", undefined)),
    includeFeatureSnapshot: optionalBool(getFlag(flags, "include-feature-snapshot", undefined)),
    minTokenCount: optionalNumber(getFlag(flags, "min-token-count", "")),
    belowMinTokenPolicy: toText(getFlag(flags, "below-min-token-policy", "")) || undefined,
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        outEventsPath: path.resolve(cwd, outEventsPath),
        outSummaryPath: outSummaryPath ? path.resolve(cwd, outSummaryPath) : null,
        tokenizerVersion: summary.tokenizerVersion,
        outputRowCount: summary.outputRowCount,
        hitRowCount: summary.hitRowCount,
        tokenCount: summary.tokenCount,
        zeroTokenRowCount: summary.zeroTokenRowCount,
        skippedBelowMinTokenRowCount: summary.skippedBelowMinTokenRowCount,
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
