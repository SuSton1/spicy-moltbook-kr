#!/usr/bin/env node
import { parseCliArgs, verifyTp12Train100PositiveMotifSurvivors } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/verify_tp12_train100_positive_motif_survivors.mjs --contract=<path> [--patterns=<path>] [--catalog=<path>] [--features=<path>] [--out-summary=<path>] [--out-survivors=<path>]")
  process.exit(0)
}
const summary = await verifyTp12Train100PositiveMotifSurvivors({
  contractPath: args.contract,
  patternsPath: args.patterns,
  motifCatalogPath: args.catalog,
  motifFeaturesPath: args.features,
  outSummaryPath: args["out-summary"],
  outSurvivorsPath: args["out-survivors"],
})
console.log(JSON.stringify({ verifiedPatternCount: summary.verifiedPatternCount, rejectedPatternCount: summary.rejectedPatternCount }, null, 2))

