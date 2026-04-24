#!/usr/bin/env node
import { buildTp12SymbolicMotifFeatures, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/build_tp12_symbolic_motif_features.mjs --contract=<path> [--snapshots=<path>] [--out=<path>] [--manifest=<path>]")
  process.exit(0)
}
const summary = await buildTp12SymbolicMotifFeatures({
  contractPath: args.contract,
  snapshotsPath: args.snapshots,
  outPath: args.out,
  outManifestPath: args.manifest,
})
console.log(JSON.stringify({ rowCount: summary.rowCount, uniqueMotifAtomCount: summary.uniqueMotifAtomCount }, null, 2))

