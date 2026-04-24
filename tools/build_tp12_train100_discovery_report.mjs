#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100DiscoveryReport } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const csvPaths = (value, cwd) =>
  toText(value)
    .split(",")
    .map((item) => toText(item).trim())
    .filter(Boolean)
    .map((item) => path.resolve(cwd, item))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const qualitySummaryPath = toText(getFlag(flags, "quality-summary", ""))
  const outJsonPath = toText(getFlag(flags, "out-json", getFlag(flags, "out", "")))
  const outMarkdownPath = toText(getFlag(flags, "out-md", getFlag(flags, "out-markdown", "")))
  if (!contractPath || !qualitySummaryPath || !outJsonPath) {
    throw new Error("build_tp12_train100_discovery_report requires --contract, --quality-summary, and --out-json")
  }
  const summary = await buildTp12Train100DiscoveryReport({
    contractPath: path.resolve(cwd, contractPath),
    preflightSummaryPath: toText(getFlag(flags, "preflight-summary", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "preflight-summary", "")))
      : "",
    atomManifestPath: toText(getFlag(flags, "atom-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "atom-manifest", "")))
      : "",
    exactManifestPath: toText(getFlag(flags, "exact-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "exact-manifest", "")))
      : "",
    negativeManifestPath: toText(getFlag(flags, "negative-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "negative-manifest", "")))
      : "",
    negativeManifestPaths: csvPaths(getFlag(flags, "negative-manifests", ""), cwd),
    counterexampleManifestPath: toText(getFlag(flags, "counterexample-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "counterexample-manifest", "")))
      : "",
    counterexampleManifestPaths: csvPaths(getFlag(flags, "counterexample-manifests", ""), cwd),
    qualitySummaryPath: path.resolve(cwd, qualitySummaryPath),
    outJsonPath: path.resolve(cwd, outJsonPath),
    outMarkdownPath: outMarkdownPath ? path.resolve(cwd, outMarkdownPath) : "",
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        acceptedTrain100PatternCount: summary.acceptedTrain100PatternCount,
        qualityStatus: summary.qualityStatus,
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
