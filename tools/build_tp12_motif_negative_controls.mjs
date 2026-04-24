#!/usr/bin/env node
import { buildTp12MotifNegativeControls, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/build_tp12_motif_negative_controls.mjs --contract=<path> [--anchors=<path>] [--catalog=<path>] [--features=<path>] [--max-anchors=N] [--out=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await buildTp12MotifNegativeControls({
  contractPath: args.contract,
  anchorsPath: args.anchors,
  motifCatalogPath: args.catalog,
  motifFeaturesPath: args.features,
  maxAnchors: args["max-anchors"] ?? args.maxAnchors,
  outPath: args.out,
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({
  anchorCount: summary.anchorCount,
  processedAnchorCount: summary.processedAnchorCount,
  emittedNegativeRows: summary.emittedNegativeRows,
  classCounts: summary.classCounts,
}, null, 2))
