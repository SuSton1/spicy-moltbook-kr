#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { freezeTp12Year2hitSurvivorCatalog } from "../src/lib/tp12_survivor_catalog_freeze.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const candidateCatalogPath = toText(getFlag(flags, "candidate-catalog", ""))
  const qualityGateSummaryPath = toText(getFlag(flags, "quality-gate-summary", ""))
  const outCatalogPath = toText(getFlag(flags, "out-catalog", ""))
  const outManifestPath = toText(getFlag(flags, "out-manifest", ""))
  if (!candidateCatalogPath || !qualityGateSummaryPath || !outCatalogPath) {
    throw new Error(
      "freeze_tp12_year2hit_survivor_catalog requires --candidate-catalog, --quality-gate-summary, and --out-catalog",
    )
  }
  const { manifest } = await freezeTp12Year2hitSurvivorCatalog({
    candidateCatalogPath: path.resolve(cwd, candidateCatalogPath),
    qualityGateSummaryPath: path.resolve(cwd, qualityGateSummaryPath),
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outManifestPath: outManifestPath ? path.resolve(cwd, outManifestPath) : null,
    freezePolicyId: toText(getFlag(flags, "freeze-policy-id", "")) || undefined,
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outCatalogPath: manifest.outCatalogPath,
        outCatalogSha256: manifest.outCatalogSha256,
        survivorCount: manifest.survivorCount,
        survivorPatternIdsSha256: manifest.survivorPatternIdsSha256,
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
