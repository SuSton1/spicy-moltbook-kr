#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { mineTp12Train100ExactCandidates } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const atomEventsPath = toText(getFlag(flags, "atom-events", getFlag(flags, "atoms", "")))
  const outCatalogPath = toText(getFlag(flags, "out-catalog", ""))
  const outManifestPath = toText(getFlag(flags, "out-manifest", getFlag(flags, "manifest", "")))
  const outProgressPath = toText(getFlag(flags, "out-progress", getFlag(flags, "progress", "")))
  if (!contractPath || !atomEventsPath || !outCatalogPath || !outManifestPath) {
    throw new Error("mine_tp12_train100_exact_candidates requires --contract, --atom-events, --out-catalog, and --out-manifest")
  }
  const manifest = await mineTp12Train100ExactCandidates({
    contractPath: path.resolve(cwd, contractPath),
    atomEventsPath: path.resolve(cwd, atomEventsPath),
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outManifestPath: path.resolve(cwd, outManifestPath),
    outProgressPath: outProgressPath ? path.resolve(cwd, outProgressPath) : "",
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        searchComplete: manifest.searchComplete,
        evaluatedCandidateCount: manifest.evaluatedCandidateCount,
        acceptedCandidateCount: manifest.acceptedCandidateCount,
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
