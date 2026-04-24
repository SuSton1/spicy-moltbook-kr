#!/usr/bin/env node
import { assertTp12PositiveMotifContract, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/assert_tp12_positive_motif_contract.mjs --contract=<path> [--out=<path>]")
  process.exit(0)
}
const summary = await assertTp12PositiveMotifContract({
  contractPath: args.contract,
  outSummaryPath: args.out,
})
console.log(JSON.stringify({ status: summary.status, patchKey: summary.patchKey }, null, 2))

