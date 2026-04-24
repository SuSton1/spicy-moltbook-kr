#!/usr/bin/env node
import { buildTp12TrainLabelUniverse, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/build_tp12_train_label_universe.mjs --contract=<path> --label-events=<path> [--out=<path>] [--summary=<path>]")
  process.exit(0)
}
const summary = await buildTp12TrainLabelUniverse({
  contractPath: args.contract,
  labelEventsPath: args["label-events"],
  outPath: args.out,
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({ rowCount: summary.rowCount, hitRowCount: summary.hitRowCount, hitRate: summary.hitRate }, null, 2))

