#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { mineTp12Year2hitCandidates } from "../src/lib/tp12_year2hit_candidate_miner.mjs"
import { toBool, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumber = (value) => {
  const text = toText(value)
  return text ? Number(text) : undefined
}

const parseYears = (value) =>
  toText(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item))

const optionalBool = (value) => (value === undefined || value === null ? undefined : toBool(value, false))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const tokenizedEventsPath = toText(getFlag(flags, "tokenized-events", ""))
  const outCatalogPath = toText(getFlag(flags, "out-catalog", ""))
  if (!tokenizedEventsPath || !outCatalogPath) {
    throw new Error("mine_tp12_year2hit_candidates requires --tokenized-events and --out-catalog")
  }
  const { manifest } = await mineTp12Year2hitCandidates({
    tokenizedEventsPath: path.resolve(cwd, tokenizedEventsPath),
    contractPath: toText(getFlag(flags, "contract-path", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "contract-path", "")))
      : null,
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outManifestPath: toText(getFlag(flags, "out-manifest", ""))
      ? path.resolve(cwd, toText(getFlag(flags, "out-manifest", "")))
      : null,
    trainDateFrom: toText(getFlag(flags, "train-from", "")) || undefined,
    trainDateTo: toText(getFlag(flags, "train-to", "")) || undefined,
    coreYears: toText(getFlag(flags, "core-years", "")) ? parseYears(getFlag(flags, "core-years", "")) : undefined,
    minHitsPerYear: optionalNumber(getFlag(flags, "min-hits-per-year", "")),
    maxPatternSize: optionalNumber(getFlag(flags, "max-pattern-size", "")),
    minSeedHitRows: optionalNumber(getFlag(flags, "min-seed-hit-rows", "")),
    minSeedMatchRows: optionalNumber(getFlag(flags, "min-seed-match-rows", "")),
    minSeedPrecision: optionalNumber(getFlag(flags, "min-seed-precision", "")),
    maxTokensPerPositiveEvent: optionalNumber(getFlag(flags, "max-tokens-per-positive-event", "")),
    maxPairCandidates: optionalNumber(getFlag(flags, "max-pair-candidates", "")),
    beamWidthPerSize: optionalNumber(getFlag(flags, "beam-width-per-size", "")),
    maxExtensionsPerParent: optionalNumber(getFlag(flags, "max-extensions-per-parent", "")),
    minCandidatePrecision: optionalNumber(getFlag(flags, "min-candidate-precision", "")),
    minCandidateDatePrecision: optionalNumber(getFlag(flags, "min-candidate-date-precision", "")),
    minCandidateHitRows: optionalNumber(getFlag(flags, "min-candidate-hit-rows", "")),
    minCandidateHitDates: optionalNumber(getFlag(flags, "min-candidate-hit-dates", "")),
    maxTop1HitDateShare: optionalNumber(getFlag(flags, "max-top1-hit-date-share", "")),
    maxTop1MatchDateShare: optionalNumber(getFlag(flags, "max-top1-match-date-share", "")),
    maxCandidateMatchRows: optionalNumber(getFlag(flags, "max-candidate-match-rows", "")),
    minUniqueHitSymbols: optionalNumber(getFlag(flags, "min-unique-hit-symbols", "")),
    emitRejected: optionalBool(getFlag(flags, "emit-rejected", undefined)),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outCatalogPath: manifest.outCatalogPath,
        trainEventCount: manifest.trainEventCount,
        tokenCount: manifest.tokenCount,
        seedTokenCount: manifest.seedTokenCount,
        evaluatedCandidateCount: manifest.evaluatedCandidateCount,
        emittedCandidateCount: manifest.emittedCandidateCount,
        survivorCount: manifest.survivorCount,
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
