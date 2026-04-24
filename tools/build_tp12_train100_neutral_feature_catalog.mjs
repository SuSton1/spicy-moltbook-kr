#!/usr/bin/env node

import { buildTp12Train100NeutralFeatureCatalog } from "../src/lib/tp12_train100_neutral_feature_catalog.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/build_tp12_train100_neutral_feature_catalog.mjs --contract=<path> [--out-catalog=<path>] [--out-manifest=<path>]")
  process.exit(0)
}

const summary = await buildTp12Train100NeutralFeatureCatalog({
  contractPath: args.contract,
  outCatalogPath: args["out-catalog"],
  outManifestPath: args["out-manifest"],
})
console.log(JSON.stringify({
  status: summary.atomSpecCount > 0 ? "passed" : "empty",
  atomSpecCount: summary.atomSpecCount,
  featureSpaceCount: summary.featureSpaceCount,
}, null, 2))

