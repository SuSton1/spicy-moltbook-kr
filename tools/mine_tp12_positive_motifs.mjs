#!/usr/bin/env node
import { mineTp12PositiveMotifs, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/mine_tp12_positive_motifs.mjs --contract=<path> [--catalog=<path>] [--features=<path>] [--out=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await mineTp12PositiveMotifs({
  contractPath: args.contract,
  motifCatalogPath: args.catalog,
  motifFeaturesPath: args.features,
  outPath: args.out,
  outSummaryPath: args.summary,
  maxAnchorAtoms: args["max-anchor-atoms"],
  maxAnchorStates: args["max-anchor-states"],
  maxGeneratedAnchors: args["max-generated-anchors"],
})
console.log(JSON.stringify({ status: summary.status, generatedAnchorCount: summary.generatedAnchorCount, searchComplete: summary.searchComplete }, null, 2))

