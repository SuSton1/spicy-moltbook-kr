#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100AtomTable } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const tokenizedEventsPath = toText(getFlag(flags, "tokenized-events", ""))
  const contextFeaturesPath = toText(getFlag(flags, "context-features", ""))
  const outAtomsPath = toText(getFlag(flags, "out-atoms", getFlag(flags, "out", "")))
  const outManifestPath = toText(getFlag(flags, "out-manifest", getFlag(flags, "manifest", "")))
  if (!contractPath || !tokenizedEventsPath || !outAtomsPath || !outManifestPath) {
    throw new Error("build_tp12_train100_atom_table requires --contract, --tokenized-events, --out-atoms, and --out-manifest")
  }
  const manifest = await buildTp12Train100AtomTable({
    contractPath: path.resolve(cwd, contractPath),
    tokenizedEventsPath: path.resolve(cwd, tokenizedEventsPath),
    contextFeaturesPath: contextFeaturesPath ? path.resolve(cwd, contextFeaturesPath) : "",
    outAtomsPath: path.resolve(cwd, outAtomsPath),
    outManifestPath: path.resolve(cwd, outManifestPath),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outputRowCount: manifest.outputRowCount,
        atomCount: manifest.atomCount,
        outAtomsPath: path.resolve(cwd, outAtomsPath),
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
