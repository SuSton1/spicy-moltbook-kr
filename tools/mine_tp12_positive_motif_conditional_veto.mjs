#!/usr/bin/env node
import { mineTp12PositiveMotifConditionalVeto, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/mine_tp12_positive_motif_conditional_veto.mjs --contract=<path> [--anchors=<path>] [--catalog=<path>] [--features=<path>] [--out-found=<path>] [--out-rejected=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await mineTp12PositiveMotifConditionalVeto({
  contractPath: args.contract,
  anchorsPath: args.anchors,
  motifCatalogPath: args.catalog,
  motifFeaturesPath: args.features,
  outFoundPath: args["out-found"],
  outRejectedPath: args["out-rejected"],
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({ foundPatternCount: summary.foundPatternCount, rejectedPatternCount: summary.rejectedPatternCount, searchComplete: summary.searchComplete }, null, 2))

