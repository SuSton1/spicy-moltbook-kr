#!/usr/bin/env node
import { buildTp12SymbolicMotifCatalog, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/build_tp12_symbolic_motif_catalog.mjs --contract=<path> [--features=<path>] [--out=<path>] [--manifest=<path>]")
  process.exit(0)
}
const summary = await buildTp12SymbolicMotifCatalog({
  contractPath: args.contract,
  motifFeaturesPath: args.features,
  outCatalogPath: args.out,
  outManifestPath: args.manifest,
})
console.log(JSON.stringify({ rowCount: summary.rowCount, emittedAtomCount: summary.emittedAtomCount }, null, 2))

