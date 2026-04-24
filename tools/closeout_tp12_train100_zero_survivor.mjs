#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100Closeout } from "../src/lib/tp12_train100_closeout.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const resolveRequired = (cwd, value, label) => {
  const text = toText(value)
  if (!text) throw new Error(`${label} is required`)
  return path.resolve(cwd, text)
}

const resolveOptional = (cwd, value) => {
  const text = toText(value)
  return text ? path.resolve(cwd, text) : ""
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const outPath = resolveRequired(cwd, getFlag(flags, "out", ""), "--out")
  const summary = await buildTp12Train100Closeout({
    partitionSummaryPath: resolveRequired(cwd, getFlag(flags, "partition-summary", ""), "--partition-summary"),
    discoverySummaryPath: resolveRequired(cwd, getFlag(flags, "discovery-summary", ""), "--discovery-summary"),
    resumeManifestPath: resolveOptional(cwd, getFlag(flags, "resume-manifest", "")),
    outPath,
    patchKey: toText(getFlag(flags, "patch-key", "tp12_train100_closeout_zero_survivor_v1")),
    failOnUnsafe: toBool(getFlag(flags, "fail-on-unsafe", true), true),
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        closeoutStatus: summary.closeoutStatus,
        acceptedTrain100PatternCount: summary.acceptedTrain100PatternCount,
        globalVisitedStateCount: summary.globalVisitedStateCount,
        remainingFrontierSize: summary.remainingFrontierSize,
        outPath,
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
