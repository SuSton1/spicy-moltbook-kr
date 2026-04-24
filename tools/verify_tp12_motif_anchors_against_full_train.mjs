#!/usr/bin/env node
import { parseCliArgs, verifyTp12MotifAnchorsAgainstFullTrain } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/verify_tp12_motif_anchors_against_full_train.mjs --contract=<path> [--anchors=<path>] [--catalog=<path>] [--features=<path>] [--out=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await verifyTp12MotifAnchorsAgainstFullTrain({
  contractPath: args.contract,
  anchorsPath: args.anchors,
  motifCatalogPath: args.catalog,
  motifFeaturesPath: args.features,
  outPath: args.out,
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({ anchorCount: summary.anchorCount, train100AnchorCount: summary.train100AnchorCount }, null, 2))

