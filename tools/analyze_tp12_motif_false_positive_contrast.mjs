#!/usr/bin/env node
import { analyzeTp12MotifFalsePositiveContrast, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/analyze_tp12_motif_false_positive_contrast.mjs --contract=<path> [--anchors=<path>] [--catalog=<path>] [--out-clauses=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await analyzeTp12MotifFalsePositiveContrast({
  contractPath: args.contract,
  anchorsPath: args.anchors,
  motifCatalogPath: args.catalog,
  outClausesPath: args["out-clauses"],
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({ processedAnchorCount: summary.processedAnchorCount, emittedClauseCount: summary.emittedClauseCount }, null, 2))

