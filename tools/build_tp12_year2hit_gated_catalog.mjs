#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitGatedCatalog } from "../src/lib/tp12_year2hit_gated_catalog.mjs"

const toText = (value) => String(value ?? "").trim()

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const sourceCatalogPath = toText(getFlag(flags, "source-catalog", ""))
  const trainGateSummaryPath = toText(getFlag(flags, "train-gate-summary", ""))
  const outCatalogPath = toText(getFlag(flags, "out-catalog", ""))
  const outManifestPath = toText(getFlag(flags, "out-manifest", ""))
  if (!sourceCatalogPath || !trainGateSummaryPath || !outCatalogPath) {
    throw new Error(
      "build_tp12_year2hit_gated_catalog requires --source-catalog, --train-gate-summary, and --out-catalog",
    )
  }
  const { manifest } = await buildTp12Year2hitGatedCatalog({
    sourceCatalogPath: path.resolve(cwd, sourceCatalogPath),
    trainGateSummaryPath: path.resolve(cwd, trainGateSummaryPath),
    outCatalogPath: path.resolve(cwd, outCatalogPath),
    outManifestPath: outManifestPath ? path.resolve(cwd, outManifestPath) : null,
    catalogArrayKey: toText(getFlag(flags, "catalog-array-key", "")),
    expectedGateSha256: toText(getFlag(flags, "expected-gate-sha256", "")),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outCatalogPath: manifest.outCatalogPath,
        outCatalogSha256: manifest.outCatalogSha256,
        survivorCount: manifest.survivorCount,
        gatedPatternCount: manifest.gatedPatternCount,
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
