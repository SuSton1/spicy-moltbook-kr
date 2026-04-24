#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12ContextFeatures } from "../src/lib/tp12_context_feature_builder.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const candidatePath = toText(getFlag(flags, "candidates", getFlag(flags, "candidate-path", getFlag(flags, "input", ""))))
  const candlePath = toText(getFlag(flags, "candles", getFlag(flags, "candle-path", "")))
  const outPath = toText(getFlag(flags, "out", ""))
  const manifestPath = toText(getFlag(flags, "manifest", getFlag(flags, "manifest-path", "")))
  const streamBySymbol = toBool(getFlag(flags, "stream-by-symbol", false), false)
  if (!candidatePath || !candlePath || !outPath || !manifestPath) {
    throw new Error("build_tp12_context_features requires --candidates, --candles, --out, and --manifest")
  }
  const manifest = await buildTp12ContextFeatures({
    candidatePath: path.resolve(cwd, candidatePath),
    candlePath: path.resolve(cwd, candlePath),
    outPath: path.resolve(cwd, outPath),
    manifestPath: path.resolve(cwd, manifestPath),
    streamBySymbol,
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        contextMode: manifest.contextMode ?? "in_memory_v1",
        outputRowCount: manifest.outputRowCount,
        outPath: path.resolve(cwd, outPath),
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
