#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { mineTp12Train100CounterexampleExactCompletion } from "../src/lib/tp12_train100_year2hit_discovery.mjs"
import { toBool, toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

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
  const outProgressPath = toText(getFlag(flags, "out-progress", getFlag(flags, "progress", "")))
  const outCheckpointPath = toText(getFlag(flags, "out-checkpoint", ""))
  const resumeCheckpointPath = toText(getFlag(flags, "resume-checkpoint", ""))
  if (!contractPath || !atomEventsPath || !outCatalogPath || !outManifestPath) {
    throw new Error(
      "mine_tp12_train100_counterexample_exact_completion requires --contract, --atom-events, --out-catalog, and --out-manifest",
    )
  }
  const manifest = await mineTp12Train100CounterexampleExactCompletion({
    contractPath: path.resolve(cwd, contractPath),
    atomEventsPath: path.resolve(cwd, atomEventsPath),
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outTracePath: outTracePath ? path.resolve(cwd, outTracePath) : "",
    outManifestPath: path.resolve(cwd, outManifestPath),
    outProgressPath: outProgressPath ? path.resolve(cwd, outProgressPath) : "",
    outCheckpointPath: outCheckpointPath ? path.resolve(cwd, outCheckpointPath) : "",
    resumeCheckpointPath: resumeCheckpointPath ? path.resolve(cwd, resumeCheckpointPath) : "",
    maxVisitedStates: optionalNumber(getFlag(flags, "max-visited-states", ""), 50000),
    maxAdditionalVisitedStates: optionalNumber(getFlag(flags, "max-additional-visited-states", ""), 0),
    maxSeeds: optionalNumber(getFlag(flags, "max-seeds", ""), 0),
    maxCounterexampleScan: optionalNumber(getFlag(flags, "max-counterexample-scan", ""), 16),
    frontierPartitionCount: optionalNumber(getFlag(flags, "frontier-partition-count", ""), 1),
    frontierPartitionIndex: optionalNumber(getFlag(flags, "frontier-partition-index", ""), 0),
    progressEveryStates: optionalNumber(getFlag(flags, "progress-every-states", ""), 1000),
    checkpointEveryStates: optionalNumber(getFlag(flags, "checkpoint-every-states", ""), 0),
    allowIncomplete: toBool(getFlag(flags, "allow-incomplete", ""), false),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        searchComplete: manifest.searchComplete,
        completionReason: manifest.completionReason,
        seedAtomCount: manifest.seedAtomCount,
        visitedStateCount: manifest.visitedStateCount,
        newVisitedStateCount: manifest.newVisitedStateCount,
        acceptedCandidateCount: manifest.acceptedCandidateCount,
        newAcceptedCandidateCount: manifest.newAcceptedCandidateCount,
        remainingFrontierSize: manifest.remainingFrontierSize,
        frontierPartition: manifest.options?.frontierPartition ?? null,
        checkpointPath: manifest.checkpointPath,
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
