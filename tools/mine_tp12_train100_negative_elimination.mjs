#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { mineTp12Train100NegativeEliminationCandidates } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value, fallback) => {
  const text = toText(value)
  return text ? toNumber(text, fallback) : fallback
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  const atomEventsPath = toText(getFlag(flags, "atom-events", getFlag(flags, "atoms", "")))
  const outCatalogPath = toText(getFlag(flags, "out-catalog", ""))
  const outTracePath = toText(getFlag(flags, "out-trace", ""))
  const outManifestPath = toText(getFlag(flags, "out-manifest", getFlag(flags, "manifest", "")))
  if (!contractPath || !atomEventsPath || !outCatalogPath || !outTracePath || !outManifestPath) {
    throw new Error(
      "mine_tp12_train100_negative_elimination requires --contract, --atom-events, --out-catalog, --out-trace, and --out-manifest",
    )
  }
  const manifest = await mineTp12Train100NegativeEliminationCandidates({
    contractPath: path.resolve(cwd, contractPath),
    atomEventsPath: path.resolve(cwd, atomEventsPath),
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outTracePath: path.resolve(cwd, outTracePath),
    outManifestPath: path.resolve(cwd, outManifestPath),
    maxSteps: optionalNumber(getFlag(flags, "max-steps", ""), 6),
    maxSeeds: optionalNumber(getFlag(flags, "max-seeds", ""), 200),
    beamWidth: optionalNumber(getFlag(flags, "beam-width", ""), 1),
    branchCount: optionalNumber(getFlag(flags, "branch-count", ""), 1),
    maxVisitedStates: optionalNumber(getFlag(flags, "max-visited-states", ""), 50000),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        seedAtomCount: manifest.seedAtomCount,
        acceptedCandidateCount: manifest.acceptedCandidateCount,
        traceRowCount: manifest.traceRowCount,
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
